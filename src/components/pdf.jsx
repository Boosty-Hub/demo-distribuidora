// PDF Generator — jsPDF 2.5.1, automatic download via pdf.save()
// window.generateDocumentPDF(doc, lines, modo, serialesPorSku?, opts?)
//
// opts.output === 'bloburl' devuelve una blob URL en vez de descargar el archivo: lo usa la vista
// previa lateral (DocumentPreviewPanel en pos.jsx), que la mete en un <iframe> y así renderiza el
// mismo PDF sin escribir nada en disco. Quien la pide es el dueño de la URL y debe llamar a
// URL.revokeObjectURL al cerrar, o el blob queda retenido en memoria hasta recargar la página.

window.generateDocumentPDF = function generateDocumentPDF(doc, lines, modo, serialesPorSku, opts) {
  // serialesPorSku: { sku: [{serial, garantia_meses, garantia_vence}] } — opcional, solo despacho
  serialesPorSku = serialesPorSku || (window.__ssDocSeriales && window.__ssDocSeriales[doc.id]) || {};
  opts = opts || {};
  // jsPDF ya no viene en el arranque: se trae al primer uso y se REINTENTA la misma llamada
  // (normalmente ya está: se precarga cuando el navegador queda libre — ver index.html).
  if (!window.jspdf || !window.jspdf.jsPDF) {
    return window.ssVendor('jspdf')
      .then(() => window.generateDocumentPDF(doc, lines, modo, serialesPorSku, opts))
      .catch(() => { alert('No se pudo cargar la librería de PDF. Revisá la conexión e intentá de nuevo.'); return false; });
  }

  // modo: 'original' | 'usd' | 'divisas' | 'bcv' | 'bcv_usd' | 'bcv_fijo' | 'paralelo'
  //
  // 'bcv_usd' = la venta BCV expresada EN DÓLARES. Es el caso del cliente que no paga hoy:
  // acepta la tasa BCV del día en que pague, así que los bolívares de hoy no le sirven —
  // el número que no se mueve es el dólar. NO es 'divisas': ahí el precio es otro (el de
  // divisas no lleva cobertura), y pasar una cotización BCV a divisas BAJA el monto.
  modo = modo || 'original';
  // 'original' = "como se emitió". Se resuelve a la modalidad real del documento: si no, la
  // tarjeta de condiciones rotulaba (por ejemplo) "Nota BCV" mientras los montos salían en
  // dólares. En despacho no aplica —no lleva precios— y 'usd' sigue siendo el modo explícito
  // "imprimir en dólares" que usan los botones rápidos de las listas.
  if (modo === 'original' && (doc.tipo || doc.estado) !== 'despacho') {
    modo = ({ bcv:'bcv', bcv_fijo:'bcv_fijo', paralelo:'paralelo' })[doc.modalidad_pago] || 'divisas';
  }

  const { jsPDF } = window.jspdf;
  const empresa = window.getEmpresaConfig ? window.getEmpresaConfig(doc.empresa_id) : {};
  const tasa    = window.currentTasa || (window.SSData ? window.SSData.tasa : { bcv: 143.82, paralelo: 151.20 });
  const ssData  = window.SSData || {};

  // Tasa activa según modalidad original del documento
  const tasaDocRef = doc.modalidad_pago === 'paralelo'
    ? (Number(doc.tasa_paralelo) || tasa.paralelo)
    : (Number(doc.tasa_bcv)     || tasa.bcv);

  // Tasa de conversión según el modo seleccionado
  const tasaBCV      = Number(doc.tasa_bcv)      || tasa.bcv      || 1;
  const tasaParalelo = Number(doc.tasa_paralelo)  || tasa.paralelo || 1;
  // 'bcv_fijo' (Nota BCV) = tasa BCV EXACTA, sin cobertura. Es una modalidad más, no un caso
  // de 'bcv': si cae en el else, el PDF de una Nota BCV sale en dólares.
  const tasaModo     = (modo === 'bcv' || modo === 'bcv_fijo') ? tasaBCV : modo === 'paralelo' ? tasaParalelo : tasaDocRef;

  // Resolve client
  // opts.clienteOverride: para el visor público (/public/…), donde SSData.clientes/contactos
  // NUNCA se cargan (visitante anónimo, sin catálogo) — sin esto todo PDF descargado desde un
  // link público salía con "Cliente no especificado" aunque la página sí lo mostrara.
  const contacto = (ssData.contactos || []).find(c => c.id === doc.contacto_id);
  const cliente  = opts.clienteOverride || (contacto
    ? (ssData.clientes || []).find(c => c.id === contacto.cliente_id)
    : (ssData.clientes || []).find(c => c.id === (doc.cliente_id || doc.cliente)));

  // Totals — siempre calculamos en USD primero, luego convertimos si hace falta
  const subtotalItems = lines.reduce((s, l) => s + (Number(l.subtotal) || 0), 0);
  const descuentoDoc  = Number(doc.descuento_doc) || 0;
  const subtotalNet   = subtotalItems * (1 - descuentoDoc / 100);
  const ivaAmt        = doc.aplica_iva !== false ? subtotalNet * 0.16 : 0;
  const totalUSD      = subtotalNet + ivaAmt;
  // Reimpresión "como si la cotización se hubiese hecho en otra modalidad".
  // Los montos guardados están en USD, pero si el documento se creó en modalidad
  // 'bcv' YA incluyen la cobertura. Para reimprimir en otra modalidad: normalizamos
  // a USD base (sin cobertura) y reaplicamos la modalidad destino (modo):
  //   divisas  → USD base, SIN bolívares
  //   bcv      → (USD base + cobertura) × tasa BCV  → Bs.
  //   paralelo → USD base × tasa paralelo           → Bs.
  const origModalidad  = doc.modalidad_pago || 'divisas';
  const origCob        = origModalidad === 'bcv' ? (Number(doc.cobertura_pct) || 0) : 0;
  const stripCobFactor = origCob > 0 ? 1 / (1 + origCob / 100) : 1;   // quita cobertura original
  // Cobertura a aplicar cuando el destino es BCV+Cobertura: la del doc si ya era
  // BCV (su propia cobertura, incluido 0 → round-trip bcv→bcv EXACTO), o la
  // cobertura vigente del sistema para docs creados en otra modalidad.
  const targetCob = (modo === 'bcv' || modo === 'bcv_usd')
    ? (origModalidad === 'bcv' ? origCob : (Number(tasa.cobertura) || 0))
    : 0;
  function convertir(usdVal) {
    const baseUsd = (Number(usdVal) || 0) * stripCobFactor;          // USD base sin cobertura
    if (modo === 'bcv')      return baseUsd * (1 + targetCob / 100) * tasaBCV;  // Bs. con cobertura
    // BCV en dólares: el precio BCV (cobertura incluida) SIN convertir a bolívares. En un
    // documento que ya era BCV el round-trip es exacto: se le quita su cobertura y se le
    // vuelve a poner la misma, así que sale el mismo número con el que se emitió.
    if (modo === 'bcv_usd')  return baseUsd * (1 + targetCob / 100);             // USD con cobertura
    if (modo === 'bcv_fijo') return baseUsd * tasaBCV;                           // Bs. a BCV exacto
    if (modo === 'paralelo') return baseUsd * tasaParalelo;                      // Bs. a paralelo
    if (modo === 'divisas')  return baseUsd;                                     // USD base (sin Bs.)
    return Number(usdVal) || 0;  // legacy 'usd'/'original' → tal cual (despacho, botones rápidos)
  }
  const totalBs = totalUSD * tasaDocRef; // referencia Bs original (no usada en render)

  const enBs = modo === 'bcv' || modo === 'bcv_fijo' || modo === 'paralelo';
  const simbolo = enBs ? 'Bs.' : '$';

  // Helpers de formato
  function fmtAmt(v)  {
    const n = Number(v || 0);
    return simbolo + ' ' + (enBs ? n.toFixed(2) : n.toFixed(2)).replace(/\d(?=(\d{3})+\.)/g, '$&,');
  }
  function usd(v)    { return '$ '   + Number(v || 0).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,'); }
  function ves(v)    { return 'Bs. ' + Number(v || 0).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,'); }
  function dateStr(d) {
    if (!d) return '--';
    try { return new Date(d + 'T12:00:00').toLocaleDateString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric' }); }
    catch(e) { return d; }
  }
  function cap(s)         { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function trunc(s, n)    { return s && s.length > n ? s.substring(0, n - 1) + '...' : (s || ''); }
  function stripAccents(s){ return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  // Truncate text so it fits within colW mm using actual font metrics
  function fitText(str, colW) {
    if (!str) return '';
    var avail = colW - 3;
    var fs    = pdf.getFontSize();
    var sc    = 2.8346;
    var w     = pdf.getStringUnitWidth(str) * fs / sc;
    if (w <= avail) return str;
    var cut = Math.max(1, Math.floor(str.length * avail / w) - 1);
    var s   = str.slice(0, cut);
    while (s.length > 1 && pdf.getStringUnitWidth(s + '…') * fs / sc > avail) s = s.slice(0, -1);
    return s + (s.length < str.length ? '…' : '');
  }

  // Tasa efectiva BCV (cobertura ya está en l.precio para docs BCV, solo para referencia visual)
  const cobPct = Number(doc.cobertura_pct) || 0;
  const tasaBcvEfectiva = tasaBCV * (1 + cobPct / 100);

  // Etiquetas cortas: se imprimen en la tarjeta de condiciones, que trunca a 24 caracteres.
  const modoLabel = {
    // 'original' = la modalidad con la que se emitió el documento. bcv_fijo estaba ausente y
    // caía en el else: una Nota BCV se rotulaba "Divisas USD".
    original:  ({ bcv:'BCV + Cobertura', bcv_fijo:'Nota BCV (exacto)', paralelo:'Paralelo' })[doc.modalidad_pago] || 'Divisas (USD)',
    usd:       'Divisas (USD)',
    divisas:   'Divisas (USD)',
    bcv:       'BCV + Cobertura',
    bcv_usd:   'BCV en dólares',
    bcv_fijo:  'Nota BCV (exacto)',
    paralelo:  'Paralelo',
  };

  // UNA NOTA CON IVA SE MUESTRA COMO FACTURA (pedido del 2026-08-07, repetido dos veces).
  // El IVA es un tributo que se declara: si el documento lo desglosa, rotularlo "Nota de Factura"
  // —que en este sistema es el documento INTERNO, sin número de control— es contradictorio con lo
  // que el documento mismo dice. Manda el IVA sobre el tipo elegido, y vale para cualquier
  // modalidad (divisas, paralelo, BCV): el impuesto no depende de en qué se pague.
  // El tipo guardado (`tipo_factura`) NO se toca: esto es cómo se ROTULA, no un cambio de dato.
  // La regla vive UNA sola vez, en `window.ssRotuloFactura` (src/money.js): la usan también la
  // lista y el detalle del POS. Acá solo se pasa a mayúsculas, que es como va en el PDF.
  const facturaLabel = (window.ssRotuloFactura(doc) === 'Nota de Factura')
    ? 'NOTA DE FACTURA' : 'FACTURA FISCAL';
  const stageLabel   = { cotizacion:'COTIZACION', orden:'ORDEN DE VENTA', despacho:'NOTA DE DESPACHO', factura: facturaLabel, devolucion:'NOTA DE DEVOLUCION' };
  const docLabel     = stageLabel[doc.tipo] || stageLabel[doc.estado] || 'DOCUMENTO';
  const isDespacho   = (doc.tipo || doc.estado) === 'despacho';
  const isDevolucion = (doc.tipo || doc.estado) === 'devolucion';
  const isDespachoOFactura = ['despacho', 'factura'].includes(doc.tipo || doc.estado);
  const modalidadLabel = modoLabel[modo] || modoLabel.original;

  const {
    razon_social = 'Distribuidora Demo 1, C.A.',
    rif: _rif    = null,
    telefono     = '0212-555-0101',
    email        = 'no-reply@distribuidorademo.com',
    email_info   = 'info@distribuidorademo.com',
    website      = 'http://www.distribuidorademo.com',
    whatsapp     = '+58 412-555-0101',
    dir_fiscal   = 'Av. Principal, Centro Empresarial Norte, Piso 3, Of. 3-B.',
    dir_fiscal2  = 'Zona Industrial La Yaguara.',
    ciudad       = 'Caracas DC 1050',
    pais         = 'Venezuela',
    logo         = null,
  } = empresa;
  const rif = _rif || 'J-40123456-7';

  // ── CREATE PDF ───────────────────────────────────────────────────
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const L = 15, T = 13, R = 195, W = 180;

  // Color shortcuts
  const NAVY   = [30, 58, 95];
  const BLUE_LT= [244, 246, 250];
  const GRAY_R = [249, 250, 251];
  const INK    = [17, 17, 17];
  const MUTED  = [85, 85, 85];
  const LIGHT  = [180, 180, 180];
  const GREEN  = [22, 101, 52];
  const BORDER = [220, 222, 228];
  const GRAY_L = [240, 240, 240];

  function setColor(c) { pdf.setTextColor(c[0], c[1], c[2]); }
  function setFill(c)  { pdf.setFillColor(c[0], c[1], c[2]); }
  function setDraw(c)  { pdf.setDrawColor(c[0], c[1], c[2]); }
  function bold(sz)    { pdf.setFont('helvetica', 'bold');   pdf.setFontSize(sz); }
  function normal(sz)  { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(sz); }
  function mono(sz)    { pdf.setFont('courier',   'normal'); pdf.setFontSize(sz); }
  function monoBold(sz){ pdf.setFont('courier',   'bold');   pdf.setFontSize(sz); }

  let y = T;

  // ── HEADER ──────────────────────────────────────────────────────
  if (logo) {
    try {
      const fmt = logo.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      pdf.addImage(logo, fmt, L, y, 28, 18);
    } catch(e) {
      setFill(NAVY); pdf.roundedRect(L, y, 22, 15, 2, 2, 'F');
      bold(12); setColor([255,255,255]); pdf.text('SS', L + 11, y + 10, { align: 'center' });
    }
  } else {
    setFill(NAVY); pdf.roundedRect(L, y, 22, 15, 2, 2, 'F');
    bold(12); setColor([255,255,255]); pdf.text('SS', L + 11, y + 10, { align: 'center' });
  }

  bold(12);   setColor(NAVY);  pdf.text(stripAccents(razon_social), R, y + 5, { align: 'right' });
  normal(7.5);setColor(MUTED); pdf.text(stripAccents(dir_fiscal), R, y + 10, { align: 'right' });
  const addr2 = [dir_fiscal2, ciudad, pais].filter(Boolean).map(stripAccents).join(', ');
  pdf.text(addr2, R, y + 14.5, { align: 'right' });
  normal(7);  setColor([136,136,136]); pdf.text('RIF: ' + rif, R, y + 19, { align: 'right' });

  // Navy divider
  y += 24;
  setFill(NAVY); setDraw(NAVY); pdf.rect(L, y, W, 0.7, 'F');
  y += 4;

  // ── TITLE BAR ───────────────────────────────────────────────────
  setFill(NAVY); pdf.roundedRect(L, y, W, 11, 1.5, 1.5, 'F');
  bold(13);  setColor([255,255,255]); pdf.text(docLabel, L + 6, y + 7.5);
  mono(11);  setColor([255,255,255]); pdf.text(doc.id, R - 4, y + 7.5, { align: 'right' });
  y += 15;

  // ── META GRID ───────────────────────────────────────────────────
  const cellW = (W - 6) / 3;
  // Teléfono del vendedor. `doc.vendedor` es el NOMBRE (texto), así que hay que buscar su ficha.
  // Dos cosas que estaban mal y por las que nunca salía impreso:
  //   1. Solo se buscaba en cotización y orden. El cliente que recibe la FACTURA o la nota de
  //      despacho es el que más suele necesitar a quién llamar.
  //   2. La comparación era exacta y los nombres NO son estables: en `demo1` conviven "Pedro
  //      Diaz" y "Pedro Díaz" como dos vendedores distintos, y el documento guarda uno u otro
  //      según cuándo se cargó. Se compara sin acentos, sin may/min y sin espacios de más.
  // (Al 2026-08-11 los 28 vendedores de `demo1` tienen `telefono` en NULL: el campo existe en
  //  Ajustes → Vendedores y está sin llenar. Sin ese dato no hay nada que imprimir.)
  const normNom = function (s) {
    return stripAccents(String(s || '')).toLowerCase().replace(/\s+/g, ' ').trim();
  };
  // El teléfono se resuelve en TRES pasos, en este orden:
  //   1. `vendedores.telefono` — el propio de la ficha de venta.
  //   2. el `usuarios.telefono` del usuario VINCULADO por `vendedores.usuario_id`.
  //   3. como último recurso, un usuario cuyo nombre coincida con el del documento.
  // El paso 2 es el que importa y es por ID, no por texto: una misma persona puede llamarse
  // "Pedro" como usuario y "Pedro Díaz" como vendedor, y `documentos.vendedor` guarda la segunda.
  // Ningún match por nombre cruza esas dos — no es un tema de acentos, son nombres distintos. Ver
  // migracion-odoo/80; el vínculo se administra en Ajustes → Vendedores.
  // Un `find` a secas devuelve la PRIMERA ficha homónima, y con dos fichas de la misma persona
  // ("Pedro Diaz" y "Pedro Díaz" conviven en `demo1`) la vacía puede tapar a la que tiene el
  // número. Se prefiere siempre la que trae teléfono, y recién si ninguna lo tiene se usa la
  // primera — porque de esa igual sale el `usuario_id` del paso 2.
  const tel = function (x) { return x && x.telefono ? String(x.telefono).trim() || null : null; };
  const fichas = doc.vendedor
    ? (ssData.vendedores || []).filter(function (v) { return normNom(v.nombre) === normNom(doc.vendedor); })
    : [];
  const vendedorObj = fichas.find(tel) || fichas[0] || null;
  // El paso 2 se busca sobre TODAS las fichas homónimas, no solo sobre la elegida: puede estar
  // vinculada una y la otra no, y el vínculo es lo único que cruza "Pedro" (usuario) con
  // "Pedro Díaz" (vendedor).
  const usuarioLigado = (ssData.usuarios || []).find(function (u) {
    return tel(u) && fichas.some(function (v) { return v.usuario_id === u.id; });
  }) || null;
  const usuarioPorNombre = doc.vendedor
    ? (ssData.usuarios || []).find(function (u) { return normNom(u.nombre) === normNom(doc.vendedor); })
    : null;
  const vendedorTel = tel(vendedorObj) || tel(usuarioLigado) || tel(usuarioPorNombre) || null;
  const cellH = vendedorTel ? 18 : 14;
  const metaItems = [
    { label: 'Fecha de emision', value: dateStr(doc.fecha) },
    { label: 'Vencimiento',      value: dateStr(doc.vencimiento) },
    { label: 'Vendedor',         value: doc.vendedor || '--' },
  ];
  metaItems.forEach(function(item, i) {
    const cx = L + i * (cellW + 3);
    setFill(BLUE_LT); setDraw(BORDER); pdf.setLineWidth(0.1);
    pdf.rect(cx, y, cellW, cellH, 'F');
    setFill(NAVY); pdf.rect(cx, y, 0.8, cellH, 'F');
    normal(6);  setColor([136,136,136]); pdf.text(item.label.toUpperCase(), cx + 3, y + 5);
    bold(9);    setColor(INK);           pdf.text(trunc(stripAccents(item.value), 22), cx + 3, y + 11);
    // Teléfono debajo del nombre del vendedor, en todos los tipos de documento.
    if (i === 2 && vendedorTel) {
      normal(7); setColor([100,116,139]); pdf.text(stripAccents(vendedorTel), cx + 3, y + 15.5);
    }
  });
  y += cellH + 5;

  // ── INFO CARDS ──────────────────────────────────────────────────
  const cardW = (W - 6) / 2;
  const cardX2 = L + cardW + 6;

  // Build client lines
  const clientRows = [];
  if (cliente) {
    // El nombre WRAPEA: una razón social completa ("INDUSTRIAS ALIMENTICIAS HERMO DE VENEZUELA,
    // C.A.") no entra en una línea a cuerpo 10 y se desbordaba fuera de la tarjeta. Se le da un
    // tope propio de 3 líneas —más alto que el de la dirección— porque en una factura el nombre
    // legal del cliente no se puede recortar a la ligera.
    clientRows.push({ bold: true,  size: 10,  text: cliente.nombre, wrap: true, maxLines: 3 });
    clientRows.push({ bold: false, size: 7.5, text: 'RIF: ' + cliente.rif, color: MUTED });
    if (cliente.telefono) clientRows.push({ bold: false, size: 7.5, text: 'Tel: ' + cliente.telefono, color: MUTED });
    const addr = doc.dir_factura || cliente.direccion;
    if (addr) clientRows.push({ bold: false, size: 7, text: addr, color: MUTED, wrap: true });
    if (cliente.ciudad) clientRows.push({ bold: false, size: 7, text: cliente.ciudad, color: MUTED });
  } else {
    clientRows.push({ bold: false, size: 8, text: 'Cliente no especificado', color: LIGHT });
  }

  // Build conditions lines
  const condRows = [];
  condRows.push({ label: 'Terminos de pago', value: doc.terminos_pago === 'inmediato' ? 'Pago inmediato' : doc.terminos_pago ? 'Credito ' + doc.terminos_pago + ' d.' : 'Inmediato' });
  // El rótulo sale de `pos_tipos_entrega` (migración 81). Imprimir el código crudo ponía
  // "Solano" o "Mrw" en el documento que se le entrega al cliente.
  condRows.push({ label: 'Tipo de entrega', value: doc.tipo_entrega ? window.ssLabelEntrega(doc.tipo_entrega) : 'Retiro' });
  // De qué almacén sale la mercancía. Antes solo se veía en pantalla (el detalle sí lo muestra);
  // el documento que se le entrega al cliente —o el remito que firma el despachador— no lo decía.
  if (doc.almacen_id) {
    const almNombrePdf = (window.SSData?.almacenes || []).find(a => a.id === doc.almacen_id)?.nombre || doc.almacen_id;
    condRows.push({ label: 'Almacen', value: almNombrePdf });
  }
  if (doc.fuente) {
    const fObj = (window.SSData?.fuentesVenta || []).find(x => x.id === doc.fuente || x.nombre === doc.fuente);
    condRows.push({ label: 'Canal', value: fObj ? fObj.nombre : cap(doc.fuente) });
  }
  // MODALIDAD. Importa sobre todo en una Nota BCV: quien recibe el documento tiene que saber que
  // los montos están en bolívares a la tasa BCV exacta, no en dólares ni con cobertura, y con la
  // tasa al lado el monto es reproducible. El despacho no lleva precios, así que no aplica.
  //
  // EXCEPCIÓN — PARALELO NUNCA SE IMPRIME (pedido del 2026-08-07, textual: *"no le podemos
  // entregar eso al cliente, se presta para que nos sancionen ante el Seniat"*). Rotular un
  // documento que se le entrega al cliente con "Modalidad: Paralelo" y su tasa es dejar por
  // escrito que se facturó a una tasa distinta de la oficial. El BCV sí se imprime: es la tasa
  // legal y el cliente necesita poder reproducir el monto.
  //
  // OJO CON EL ALCANCE: esto saca el rótulo y la tasa, no el rastro. Si el documento se imprime
  // con los totales en bolívares, dividir el monto en Bs por el monto en USD sigue dando la tasa
  // usada. Para no dejar rastro hay que emitir el documento en divisas o en BCV, no en paralelo.
  // ALCANCE AMPLIADO A COTIZACIÓN (pedido del 2026-08-10): al principio se dejó la cotización
  // afuera porque no es documento fiscal y el cliente necesita poder reproducir el monto ofertado.
  // El usuario pidió sacarla también: aplica a CUALQUIER etapa (cotización, orden, factura), sin
  // distinción — el motivo original (no dejar por escrito una tasa distinta de la oficial) no
  // depende de si el papel es fiscal o no.
  const esParaleloPdf = (modo === 'paralelo') ||
                        (modo === 'original' && doc.modalidad_pago === 'paralelo');
  if (!isDespacho && !esParaleloPdf) {
    condRows.push({ label: 'Modalidad', value: modalidadLabel });
    if (enBs) condRows.push({ label: 'Tasa aplicada', value: 'Bs. ' + Number(tasaModo || 0).toFixed(2) + '/USD' });
    // En 'BCV en dólares' la tasa NO está fijada: ese es el punto del documento. Decirlo es
    // obligatorio — sin esta línea el cliente puede leer el monto como si fuera precio en
    // divisas, que es más barato, y reclamar la diferencia el día que pague.
    else if (modo === 'bcv_usd') condRows.push({ label: 'Tasa aplicada', value: 'BCV del dia de pago' });
  }

  // Estimate total client card height usando wrap real de jsPDF
  var clientRowsH = 0;
  clientRows.forEach(function(row) {
    if (row.wrap) {
      // Aplicar la misma fuente/tamaño que se usará al render para que splitTextToSize mida correcto
      if (row.bold) { bold(row.size); } else { normal(row.size); }
      var wrLines = pdf.splitTextToSize(stripAccents(row.text || ''), cardW - 10);
      // Tope por fila: 4 líneas para direcciones (el default), el que pida la fila si lo trae.
      var maxL = row.maxLines || 4;
      if (wrLines.length > maxL) wrLines = wrLines.slice(0, maxL);
      row._wrLines = wrLines;
      clientRowsH += wrLines.length * (row.size * 0.55 + 2) + 1;
    } else {
      clientRowsH += row.size * 0.55 + 3;
    }
  });
  const cardH = Math.max(clientRowsH + 18, condRows.length * 7 + 18, 42);

  // Client card
  setFill([255,255,255]); setDraw(BORDER); pdf.setLineWidth(0.2);
  pdf.rect(L, y, cardW, cardH, 'FD');
  normal(6); setColor([136,136,136]); pdf.text('DATOS DEL CLIENTE', L + 5, y + 6);
  setDraw(GRAY_L); pdf.setLineWidth(0.2); pdf.line(L + 5, y + 8.5, L + cardW - 5, y + 8.5);
  var cy = y + 14;
  clientRows.forEach(function(row) {
    if (row.bold) { bold(row.size); } else { normal(row.size); }
    setColor(row.color || INK);
    if (row.wrap) {
      var wrLines = row._wrLines || pdf.splitTextToSize(stripAccents(row.text), cardW - 10);
      pdf.text(wrLines, L + 5, cy);
      cy += wrLines.length * (row.size * 0.55 + 2) + 1;
    } else {
      pdf.text(stripAccents(row.text), L + 5, cy);
      cy += row.size * 0.55 + 3;
    }
  });

  // Conditions card
  setFill([255,255,255]); setDraw(BORDER); pdf.setLineWidth(0.2);
  pdf.rect(cardX2, y, cardW, cardH, 'FD');
  normal(6); setColor([136,136,136]); pdf.text('CONDICIONES DEL DOCUMENTO', cardX2 + 5, y + 6);
  setDraw(GRAY_L); pdf.setLineWidth(0.2); pdf.line(cardX2 + 5, y + 8.5, cardX2 + cardW - 5, y + 8.5);
  cy = y + 14;
  condRows.forEach(function(row) {
    normal(7.5); setColor(MUTED);
    pdf.text(stripAccents(row.label) + ':', cardX2 + 5, cy);
    bold(7.5); setColor(INK);
    pdf.text(stripAccents(trunc(row.value, 24)), cardX2 + cardW - 5, cy, { align: 'right' });
    cy += 7;
  });

  y += cardH + 6;

  // ── PRODUCTS TABLE ───────────────────────────────────────────────
  // Column widths sum = 180mm
  const cols = isDespacho ? [
    { label: '#',           w:  8, align: 'center' },
    { label: 'SKU',         w: 30, align: 'left'   },
    { label: 'Descripcion', w: 126, align: 'left'  },
    { label: 'Cant.',       w: 16, align: 'right'  },
  ] : enBs ? [
    // En bolívares los montos son grandes (6–8 dígitos): columnas de precio más
    // anchas para que Cant. / Prec. Unit. / Subtotal no se solapen entre sí.
    { label: '#',           w:  8, align: 'center' },
    { label: 'SKU',         w: 24, align: 'left'   },
    { label: 'Descripcion', w: 55, align: 'left'   },
    { label: 'Marca',       w: 18, align: 'left'   },
    { label: 'Cant.',       w: 12, align: 'right'  },
    { label: 'Prec. Unit.', w: 31, align: 'right'  },
    { label: 'Subtotal',    w: 32, align: 'right'  },
  ] : [
    { label: '#',           w:  8, align: 'center' },
    { label: 'SKU',         w: 26, align: 'left'   },
    { label: 'Descripcion', w: 72, align: 'left'   },
    { label: 'Marca',       w: 22, align: 'left'   },
    { label: 'Cant.',       w: 12, align: 'right'  },
    { label: 'Prec. Unit.', w: 22, align: 'right'  },
    { label: 'Subtotal',    w: 18, align: 'right'  },
  ];
  const hdrH = 8;
  const rowH = 7;

  // Header row
  setFill(NAVY); pdf.rect(L, y, W, hdrH, 'F');
  bold(7.5); setColor([255,255,255]);
  var cx = L;
  cols.forEach(function(col) {
    var px = col.align === 'right'  ? cx + col.w - 2
           : col.align === 'center' ? cx + col.w / 2
           : cx + 2;
    pdf.text(col.label, px, y + 5.5, { align: col.align === 'center' ? 'center' : col.align === 'right' ? 'right' : 'left' });
    cx += col.w;
  });
  y += hdrH;

  // Data rows
  var productRowNum = 0;
  lines.forEach(function(l) {
    var isSection = l.sku === '__SECTION__';

    // Pre-calc description and SKU wrap, dynamic row height
    var descLines = [];
    var skuLines  = [];
    var dynRowH   = rowH;
    if (!isSection) {
      normal(8);
      descLines = pdf.splitTextToSize(stripAccents(l.nombre || ''), cols[2].w - 4);
      mono(7.5);
      skuLines  = pdf.splitTextToSize(l.sku || '', cols[1].w - 3);
      dynRowH   = Math.max(rowH, descLines.length * 5.2 + 2.5, skuLines.length * 5.2 + 2.5);
    }

    // Page break (with header repeat)
    if (y + (isSection ? 7 : dynRowH) > 273) {
      pdf.addPage(); y = T;
      setFill(NAVY); pdf.rect(L, y, W, hdrH, 'F');
      bold(7.5); setColor([255,255,255]);
      var hx = L;
      cols.forEach(function(col) {
        var hpx = col.align === 'right' ? hx + col.w - 2 : col.align === 'center' ? hx + col.w / 2 : hx + 2;
        pdf.text(col.label, hpx, y + 5.5, { align: col.align === 'center' ? 'center' : col.align === 'right' ? 'right' : 'left' });
        hx += col.w;
      });
      y += hdrH;
    }

    // Section divider row
    if (isSection) {
      setFill([235,237,240]); pdf.rect(L, y, W, 7, 'F');
      bold(7.5); setColor([80,90,110]);
      var secX = L + cols[0].w + cols[1].w;
      pdf.text(trunc(stripAccents(l.nombre || ''), 80).toUpperCase(), secX, y + 5);
      y += 7;
      return;
    }

    // Product row
    productRowNum++;
    if (productRowNum % 2 !== 0) { setFill(GRAY_R); pdf.rect(L, y, W, dynRowH, 'F'); }
    setDraw(GRAY_L); pdf.setLineWidth(0.1); pdf.line(L, y + dynRowH, L + W, y + dynRowH);

    var marca = l.marca || ((window.SSData?.productos || []).find(function(p){ return p.sku === l.sku; }) || {}).marca || '';
    var cellY = y + 5;

    var cells = isDespacho ? [
      { fn: function() { normal(7.5); setColor(LIGHT); }, text: String(productRowNum), align: 'center' },
      { fn: function() { mono(7.5);   setColor(MUTED); }, sku: true,  align: 'left' },
      { fn: function() { normal(8);   setColor(INK);   }, desc: true, align: 'left' },
      { fn: function() { bold(8);     setColor(INK);   }, text: String(l.qty), align: 'right' },
    ] : [
      { fn: function() { normal(7.5);  setColor(LIGHT); },               text: String(productRowNum),          align: 'center' },
      { fn: function() { mono(7.5);    setColor(MUTED); },               sku: true,                            align: 'left'   },
      { fn: function() { normal(8);    setColor(INK);   },               desc: true,                           align: 'left'   },
      { fn: function() { normal(7.5);  setColor(marca ? INK : LIGHT); }, text: stripAccents(trunc(marca || '--', 14)), align: 'left' },
      { fn: function() { normal(8);    setColor(INK);   },               text: String(l.qty),                  align: 'right'  },
      { fn: function() { mono(7.5);    setColor(INK);   },               text: fmtAmt(convertir(l.precio)),    align: 'right'  },
      { fn: function() { monoBold(7.5);setColor(INK);   },               text: fmtAmt(convertir(l.subtotal)), align: 'right'  },
    ];

    cx = L;
    cells.forEach(function(cell, ci) {
      var cw = cols[ci].w;
      var px = cell.align === 'right' ? cx + cw - 2 : cell.align === 'center' ? cx + cw / 2 : cx + 2;
      cell.fn();
      if (cell.desc) {
        pdf.text(descLines, px, cellY);
      } else if (cell.sku) {
        pdf.text(skuLines, px, cellY);
      } else {
        pdf.text(cell.text, px, cellY, { align: cell.align === 'center' ? 'center' : cell.align === 'right' ? 'right' : 'left' });
      }
      cx += cw;
    });
    y += dynRowH;

    // Sub-row: Garantía de la LÍNEA (todas las líneas, con o sin seriales).
    // Sólo en despacho/factura. Fallback a producto.garantia_meses si la línea no define.
    if (isDespachoOFactura) {
      var prodForGar = (window.SSData?.productos || []).find(function(p){ return p.sku === l.sku; }) || {};
      var garLineMeses = (l.garantia_meses != null && l.garantia_meses !== '') ? parseInt(l.garantia_meses) : null;
      if (garLineMeses == null && prodForGar.garantia_meses != null) garLineMeses = parseInt(prodForGar.garantia_meses) || 0;
      var garLineCond  = (l.garantia_condiciones || '').trim();
      if ((garLineMeses && garLineMeses > 0) || garLineCond) {
        var garStartX = L + cols[0].w + cols[1].w;  // alineado a Descripción
        var garLineH  = 4.5;
        // Wrap condiciones para medir altura
        normal(6.8);
        var condLines = garLineCond ? pdf.splitTextToSize(stripAccents(garLineCond), W - (garStartX - L) - 4) : [];
        var totalGarH = garLineH + (condLines.length * 3.6);
        if (y + totalGarH > 273) { pdf.addPage(); y = T; }
        setFill([248, 250, 252]); pdf.rect(L, y, W, garLineH, 'F');
        mono(7); setColor([55, 65, 81]);
        var garTxt = (garLineMeses && garLineMeses > 0) ? ('Garantia: ' + garLineMeses + ' meses') : 'Garantia: --';
        pdf.text(garTxt, garStartX, y + 3.2);
        y += garLineH;
        if (condLines.length > 0) {
          setFill([248, 250, 252]); pdf.rect(L, y, W, condLines.length * 3.6 + 0.5, 'F');
          normal(6.8); setColor(MUTED);
          pdf.text('Cond.: ' + condLines[0], garStartX, y + 2.8);
          for (var ci2 = 1; ci2 < condLines.length; ci2++) {
            pdf.text(condLines[ci2], garStartX + 7, y + 2.8 + ci2 * 3.6);
          }
          y += condLines.length * 3.6 + 0.5;
        }
        y += 0.5;
      }
    }

    // Sub-rows: S/N — solo en la nota de despacho (los S/N son evidencia de entrega física)
    if (isDespacho && serialesPorSku[l.sku] && serialesPorSku[l.sku].length > 0) {
      var snList = serialesPorSku[l.sku];
      var snStartX = L + cols[0].w + cols[1].w;  // alinear con columna Descripción
      var snRowH = 4.5;
      snList.forEach(function(s, idx) {
        if (y + snRowH > 273) {
          pdf.addPage(); y = T;
        }
        setFill([248, 250, 252]); pdf.rect(L, y, W, snRowH, 'F');
        mono(7); setColor([55, 65, 81]);
        var venceTxt = s.garantia_vence ? ' · vence ' + dateStr(s.garantia_vence) : '';
        var garTxt   = s.garantia_meses ? s.garantia_meses + ' meses' + venceTxt : 'sin garantía';
        pdf.text('S/N ' + (idx + 1) + ': ' + (s.serial || '—'), snStartX, y + 3.2);
        normal(6.8); setColor(MUTED);
        pdf.text('Garantía: ' + garTxt, snStartX + 70, y + 3.2);
        y += snRowH;
      });
      y += 1;
    }
  });
  y += 5;

  // If totals + observations won't fit before footer, push to new page
  if (!isDespacho) {
    var totNeeded = (descuentoDoc > 0 ? 38 : 25) + (doc.observaciones ? 26 : 0);
    if (y + totNeeded > 273) {
      pdf.addPage(); y = T;
    }
  }

  // ── TOTALS (not shown on dispatch notes) ────────────────────────
  if (!isDespacho) {
    var totalConv    = convertir(totalUSD);
    var subtotalConv = convertir(subtotalItems);
    var subtotalNetConv = convertir(subtotalNet);
    var ivaConv      = convertir(ivaAmt);
    var totalLabel   = enBs ? 'TOTAL Bs.' : 'TOTAL USD';

    // Pre-compute filas para poder medir y elegir un ancho que evite solapamiento
    var totRows = [];
    totRows.push({ label: 'Subtotal', value: fmtAmt(subtotalConv), opts: {} });
    if (descuentoDoc > 0) {
      totRows.push({ label: 'Descuento cotizacion (' + descuentoDoc + '%)', value: '-' + fmtAmt(subtotalConv * descuentoDoc / 100), opts: { green: true } });
      totRows.push({ label: 'Subtotal neto', value: fmtAmt(subtotalNetConv), opts: {} });
    }
    // IVA: la fila SOLO si el documento lo lleva. Antes se imprimía siempre, y en un documento
    // exento salía "IVA 16% (exento) --": una línea de impuesto en un documento que no lo tiene
    // se lee como si se hubiese cobrado y no aparece en el total, o como un error de cálculo.
    // Si no hay IVA, lo correcto es que no haya fila.
    if (doc.aplica_iva !== false) {
      totRows.push({ label: 'IVA 16%', value: fmtAmt(ivaConv), opts: {} });
    }
    totRows.push({ label: totalLabel, value: fmtAmt(totalConv), opts: { divider: true, grand: true } });

    // Medir el ancho máximo necesario (label + value + gap)
    var maxTotW = 82;
    totRows.forEach(function(r) {
      if (r.opts.grand) { bold(11); }
      else              { normal(8.5); }
      var lw = pdf.getTextWidth(r.label);
      if (r.opts.grand) { monoBold(12); }
      else if (r.opts.green) { monoBold(8.5); }
      else { mono(8.5); }
      var vw = pdf.getTextWidth(r.value);
      var need = lw + vw + 6; // 6mm de aire entre label y value
      if (need > maxTotW) maxTotW = need;
    });
    // Cap al ancho útil para no salirse del margen izquierdo
    if (maxTotW > W) maxTotW = W;
    var totW = maxTotW;
    var totX = R - totW;

    function totRow(label, value, opts) {
      opts = opts || {};
      var rH = 6.5;
      if (opts.divider) {
        setDraw(NAVY); pdf.setLineWidth(0.4);
        pdf.line(totX, y, R, y);
        y += 2;
      } else {
        setDraw(GRAY_L); pdf.setLineWidth(0.1);
        pdf.line(totX, y + rH, R, y + rH);
      }
      if (opts.grand) {
        bold(11);    setColor(NAVY); pdf.text(label, totX, y + 7.5);
        monoBold(12);setColor(NAVY); pdf.text(value, R, y + 7.5, { align: 'right' });
        y += 10;
      } else {
        normal(8.5); setColor(MUTED); pdf.text(label, totX, y + 5);
        if (opts.green) { setColor(GREEN); monoBold(8.5); }
        else            { setColor(INK);   mono(8.5); }
        pdf.text(value, R, y + 5, { align: 'right' });
        y += rH;
      }
    }

    totRows.forEach(function(r) { totRow(r.label, r.value, r.opts); });
    // No se imprime tasa ni cobertura: la cobertura es información interna de
    // precio de la empresa y los PDFs se comparten con el cliente.
  }

  // ── OBSERVATIONS ────────────────────────────────────────────────
  if (doc.observaciones) {
    // En devoluciones las observaciones llevan datos clave (motivo, almacén
    // receptor, factura origen, nota de crédito): mostramos hasta 5 líneas.
    var obsMaxLines = isDevolucion ? 5 : 2;
    var obsTitle = isDevolucion ? 'DETALLE DE LA DEVOLUCION' : 'OBSERVACIONES';
    var obsLines = pdf.splitTextToSize(stripAccents(doc.observaciones), W - 12).slice(0, obsMaxLines);
    var obsH = 10 + obsLines.length * 4.5;
    setFill([255,255,255]); setDraw(BORDER); pdf.setLineWidth(0.2);
    pdf.rect(L, y, W, obsH, 'FD');
    normal(6); setColor([136,136,136]); pdf.text(obsTitle, L + 5, y + 6);
    normal(8.5); setColor(INK);
    pdf.text(obsLines, L + 5, y + 12);
    y += obsH + 6;
  }

  // ── SIGNATURES ──────────────────────────────────────────────────
  // Push to near bottom if we have room
  var sigY = Math.max(y + 6, 245);
  if (sigY < 265) {
    var sigW = (W - 16) / 3;
    var sigLabels = isDevolucion
      ? ['Entregado por', 'Autorizado por', 'Recibido por (Almacenista)']
      : ['Elaborado por', 'Aprobado por', 'Recibido conforme'];
    sigLabels.forEach(function(label, i) {
      var sx = L + i * (sigW + 8);
      setDraw([190,190,190]); pdf.setLineWidth(0.3);
      pdf.line(sx, sigY + 22, sx + sigW, sigY + 22);
      normal(8); setColor(MUTED);
      pdf.text(label, sx + sigW / 2, sigY + 8, { align: 'center' });
      bold(8.5); setColor(INK);
      var sigName = i === 0 ? stripAccents(doc.vendedor || '___________') : '___________';
      pdf.text(sigName, sx + sigW / 2, sigY + 27, { align: 'center' });
    });
  }

  // ── FOOTER on every page ─────────────────────────────────────────
  var totalPgs = pdf.getNumberOfPages();
  for (var pg = 1; pg <= totalPgs; pg++) {
    pdf.setPage(pg);
    var footY = 278;
    setDraw(BORDER); pdf.setLineWidth(0.2);
    pdf.line(L, footY, R, footY);
    normal(7); setColor([100,100,100]);
    var footParts = [telefono, email, website].filter(Boolean).join('  |  ');
    pdf.text(footParts, L, footY + 5);
    pdf.text('Pag. ' + pg + ' / ' + totalPgs, R, footY + 5, { align: 'right' });
    normal(6.5); setColor([155,155,155]);
    var footAddr = [dir_fiscal, dir_fiscal2].filter(Boolean).map(stripAccents).join(' ');
    if (ciudad) footAddr += ' · ' + stripAccents(ciudad);
    var addrLines = pdf.splitTextToSize(footAddr, W - 30);
    addrLines.slice(0, 2).forEach(function(line, idx) {
      pdf.text(line, L, footY + 10 + idx * 4.5);
    });
    pdf.text(doc.id, R, footY + 10, { align: 'right' });
  }

  // ── SALIDA ──────────────────────────────────────────────────────
  // 'bloburl' → vista previa en <iframe> (no toca el disco); por defecto, descarga.
  if (opts.output === 'bloburl') return pdf.output('bloburl');
  pdf.save(doc.id + '.pdf');
};

// ── PDF de RECEPCIÓN de OC — descarga automática (pdf.save) ─────────────────────────────────
// modo 'checklist': hoja EN BLANCO para que el almacenista haga la recepción (columnas Recibido /
//   Estado / Motivo vacías). modo 'recibo': soporte de una recepción YA registrada (usa rec.items).
// opts: { modo, rec?, prov?, almacenNombre?, usuario? }
window.generateRecepcionPDF = function generateRecepcionPDF(oc, opts) {
  opts = opts || {};
  const modo = opts.modo === 'recibo' ? 'recibo' : 'checklist';
  // jsPDF ya no viene en el arranque: se trae al primer uso y se REINTENTA la misma llamada
  // (normalmente ya está: se precarga cuando el navegador queda libre — ver index.html).
  if (!window.jspdf || !window.jspdf.jsPDF) {
    return window.ssVendor('jspdf')
      .then(() => window.generateRecepcionPDF(oc, opts))
      .catch(() => { alert('No se pudo cargar la librería de PDF. Revisá la conexión e intentá de nuevo.'); return false; });
  }
  const { jsPDF } = window.jspdf;
  const ssData  = window.SSData || {};
  const empresa = window.getEmpresaConfig ? window.getEmpresaConfig(oc.empresa_id) : {};
  const prov    = opts.prov || (ssData.proveedores || []).find(p => p.id === (oc.proveedor_id || oc.proveedor)) || {};
  const rec     = opts.rec || null;

  const {
    razon_social = 'Distribuidora Demo 1, C.A.', rif: _rif = null,
    dir_fiscal = 'Av. Principal, Centro Empresarial Norte, Piso 3, Of. 3-B.',
    dir_fiscal2 = 'Zona Industrial La Yaguara.', ciudad = 'Caracas DC 1050',
    pais = 'Venezuela', logo = null,
  } = empresa;
  const rif = _rif || 'J-40123456-7';

  // Fuente de las líneas: en 'recibo' usa lo registrado en la recepción; en 'checklist' usa los ítems de la OC.
  const ocItems = Array.isArray(oc.items) ? oc.items : [];
  let lineas = (modo === 'recibo' && rec && Array.isArray(rec.items) && rec.items.length)
    ? rec.items.map(it => ({ sku: it.sku, descripcion: it.descripcion, pedida: it.cantidad_pedida, recibida: it.cantidad_recibida, precio: it.precio_unitario, estado: it.estado, motivo: it.notas, subtotal: it.subtotal_ajustado }))
    : ocItems.map(it => ({ sku: it.sku, descripcion: it.descripcion, pedida: it.cantidad_pedida, recibida: null, precio: it.precio_unitario, estado: null, motivo: null, subtotal: null }));
  // OC sin ítems detallados (legacy/migrada): en la hoja de recepción emitimos filas en blanco para llenar a mano.
  if (modo === 'checklist' && lineas.length === 0) lineas = Array.from({ length: 14 }, () => ({ _blank: true }));

  const stripAccents = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const usd = v => '$ ' + Number(v || 0).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
  const dateStr = d => { if (!d) return '—'; try { return new Date(String(d).slice(0,10) + 'T12:00:00').toLocaleDateString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric' }); } catch(e){ return d; } };
  const fGen = (() => { try { return new Date().toLocaleString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'America/Caracas' }); } catch(e){ return ''; } })();

  const pdf = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
  const L = 15, R = 195, W = 180;
  const NAVY=[30,58,95], MUTED=[85,85,85], INK=[17,17,17], BORDER=[210,214,222], SUNK=[244,246,250], AMBER=[146,64,14];
  const setColor=c=>pdf.setTextColor(c[0],c[1],c[2]);
  const setFill=c=>pdf.setFillColor(c[0],c[1],c[2]);
  const setDraw=c=>pdf.setDrawColor(c[0],c[1],c[2]);
  const bold=s=>{pdf.setFont('helvetica','bold');pdf.setFontSize(s);};
  const normal=s=>{pdf.setFont('helvetica','normal');pdf.setFontSize(s);};
  const fitText=(str,colW)=>{ if(!str) return ''; str=String(str); const avail=colW-2, fs=pdf.getFontSize(), sc=2.8346; let w=pdf.getStringUnitWidth(str)*fs/sc; if(w<=avail) return str; let cut=Math.max(1,Math.floor(str.length*avail/w)-1), s=str.slice(0,cut); while(s.length>1 && pdf.getStringUnitWidth(s+'…')*fs/sc>avail) s=s.slice(0,-1); return s+(s.length<str.length?'…':''); };

  let y = 13;
  // Header
  if (logo) { try { pdf.addImage(logo, logo.startsWith('data:image/png')?'PNG':'JPEG', L, y, 26, 16); } catch(e){ setFill(NAVY); pdf.roundedRect(L,y,22,15,2,2,'F'); bold(12); setColor([255,255,255]); pdf.text('SS', L+11, y+10, {align:'center'}); } }
  else { setFill(NAVY); pdf.roundedRect(L,y,22,15,2,2,'F'); bold(12); setColor([255,255,255]); pdf.text('SS', L+11, y+10, {align:'center'}); }
  bold(11); setColor(NAVY); pdf.text(stripAccents(razon_social), R, y+5, {align:'right'});
  normal(7.5); setColor(MUTED);
  pdf.text(stripAccents(dir_fiscal), R, y+9.5, {align:'right'});
  pdf.text(stripAccents([dir_fiscal2, ciudad, pais].filter(Boolean).join(', ')), R, y+13.5, {align:'right'});
  normal(7); setColor([136,136,136]); pdf.text('RIF: ' + rif, R, y+17.5, {align:'right'});
  y += 24;

  // Título del documento
  const titulo = modo === 'recibo' ? 'COMPROBANTE DE RECEPCION' : 'HOJA DE RECEPCION';
  setFill(NAVY); pdf.rect(L, y, W, 9, 'F');
  bold(11); setColor([255,255,255]); pdf.text(titulo, L+3, y+6);
  bold(11); pdf.text('OC ' + (oc.id || ''), R-3, y+6, {align:'right'});
  y += 9;
  if (modo === 'checklist') {
    setFill([255,251,235]); setDraw([251,191,36]); pdf.rect(L, y, W, 6.5, 'FD');
    normal(7.5); setColor(AMBER);
    pdf.text('Marque la cantidad REALMENTE recibida por producto. Si recibe menos de lo pedido, anote el MOTIVO.', L+3, y+4.4);
    y += 6.5;
  }
  y += 5;

  // Bloque de datos (proveedor / OC)
  const rowInfo = (label, val, x, ww) => { normal(7); setColor([120,120,120]); pdf.text(label, x, y); bold(9); setColor(INK); pdf.text(fitText(stripAccents(val || '—'), ww), x, y+4.5); };
  rowInfo('PROVEEDOR', prov.nombre || (oc.proveedor_id || '—'), L, 88);
  rowInfo('RIF', prov.rif || '—', L+92, 40);
  rowInfo('FECHA RECEPCION', modo === 'recibo' ? dateStr(rec && rec.fecha) : '____ / ____ / ______', L+136, 44);
  y += 10;
  rowInfo('OC EMITIDA', dateStr(oc.fecha), L, 40);
  rowInfo('DOC. PROVEEDOR', oc.doc_proveedor || '—', L+44, 44);
  rowInfo('ALMACEN', opts.almacenNombre || (rec && (ssData.almacenes||[]).find(a=>a.id===rec.almacen_id)?.nombre) || '________________', L+92, 44);
  rowInfo('RECEPCION Nº', modo === 'recibo' ? (rec && rec.id || '—') : '____________', L+136, 44);
  y += 12;

  // Tabla de ítems
  const cols = modo === 'recibo'
    ? [ {t:'#',w:8,a:'center'}, {t:'SKU',w:26}, {t:'Descripcion',w:66}, {t:'Ped.',w:12,a:'right'}, {t:'Recib.',w:14,a:'right'}, {t:'Estado',w:18,a:'center'}, {t:'Subtotal',w:36,a:'right'} ]
    : [ {t:'#',w:8,a:'center'}, {t:'SKU',w:28}, {t:'Descripcion',w:74}, {t:'Pedido',w:16,a:'right'}, {t:'Recibido',w:20,a:'center'}, {t:'Estado / Motivo',w:34} ];
  const colX = []; let acc = L; cols.forEach(c => { colX.push(acc); acc += c.w; });

  const drawHead = () => {
    setFill(SUNK); setDraw(BORDER); pdf.rect(L, y, W, 7, 'FD');
    bold(7.5); setColor(NAVY);
    cols.forEach((c,i) => { const x = c.a==='right' ? colX[i]+c.w-2 : c.a==='center' ? colX[i]+c.w/2 : colX[i]+2; pdf.text(c.t, x, y+4.7, {align: c.a==='right'?'right':c.a==='center'?'center':'left'}); });
    y += 7;
  };
  drawHead();
  normal(8);
  lineas.forEach((l, i) => {
    // salto de página
    if (y > 250) { pdf.addPage(); y = 15; drawHead(); normal(8); }
    const rowH = modo === 'recibo' ? (l.motivo ? 11 : 7) : 9;
    if (i % 2 === 1) { setFill([250,250,251]); pdf.rect(L, y, W, rowH, 'F'); }
    setDraw(BORDER); pdf.setLineWidth(0.1); pdf.line(L, y+rowH, L+W, y+rowH);
    setColor(INK);
    const cell = (idx, txt, opt) => { const c = cols[idx]; normal(opt&&opt.sz||8); if(opt&&opt.bold) bold(opt.sz||8); if(opt&&opt.color) setColor(opt.color); const x = c.a==='right'?colX[idx]+c.w-2:c.a==='center'?colX[idx]+c.w/2:colX[idx]+2; pdf.text(fitText(txt,c.w), x, y+ (modo==='recibo'?4.7:4.5), {align:c.a==='right'?'right':c.a==='center'?'center':'left'}); setColor(INK); };
    cell(0, l._blank ? '' : String(i+1));
    if (l._blank) {
      // Fila totalmente en blanco (OC sin ítems): subrayados llenables en todas las columnas.
      setDraw([170,170,170]); pdf.setLineWidth(0.3);
      pdf.line(colX[1]+2, y+rowH-2.5, colX[1]+cols[1].w-2, y+rowH-2.5); // sku
      pdf.line(colX[2]+2, y+rowH-2.5, colX[2]+cols[2].w-2, y+rowH-2.5); // descripción
      pdf.line(colX[3]+2, y+rowH-2.5, colX[3]+cols[3].w-2, y+rowH-2.5); // pedido
      pdf.rect(colX[4]+c4pad(cols[4].w), y+2, 14, rowH-4);               // recibido box
      pdf.line(colX[5]+2, y+rowH-2.5, colX[5]+cols[5].w-2, y+rowH-2.5);  // estado/motivo
      y += rowH; return;
    }
    cell(1, l.sku || '—');
    cell(2, stripAccents(l.descripcion || ''));
    cell(3, String(l.pedida != null ? l.pedida : '—'));
    if (modo === 'recibo') {
      const disc = l.estado !== 'ok' || (Number(l.recibida) < Number(l.pedida));
      cell(4, String(l.recibida != null ? l.recibida : '—'), disc ? {color:AMBER, bold:true} : null);
      cell(5, (l.estado || 'ok').toUpperCase(), {sz:7, color: l.estado==='faltante'?[185,28,28]:l.estado==='dañado'?[180,83,9]:[22,101,52]});
      cell(6, usd(l.subtotal));
      if (l.motivo) { normal(6.5); setColor(AMBER); pdf.text(fitText('↳ ' + stripAccents(l.motivo), W-30), colX[2]+2, y+rowH-1.2); setColor(INK); }
    } else {
      // casillas en blanco para llenar a mano
      setDraw([170,170,170]); pdf.setLineWidth(0.3);
      pdf.rect(colX[4]+c4pad(cols[4].w), y+2, 14, rowH-4); // recibido box
      // línea para estado/motivo
      pdf.line(colX[5]+2, y+rowH-2.5, colX[5]+cols[5].w-2, y+rowH-2.5);
    }
    y += rowH;
  });
  function c4pad(w){ return (w-14)/2; }

  y += 2;
  if (modo === 'recibo') {
    const totalRec = lineas.reduce((s,l)=> s + (l.estado==='faltante'?0:(Number(l.subtotal)||0)), 0);
    const totalPed = ocItems.reduce((s,it)=> s + (Number(it.cantidad_pedida)||0)*(Number(it.precio_unitario)||0), 0) || (Number(oc.monto)||0);
    setFill(SUNK); setDraw(BORDER); pdf.rect(L+W-90, y, 90, 15, 'FD');
    normal(8); setColor(MUTED); pdf.text('Total pedido', L+W-88, y+5.5); bold(8); setColor(INK); pdf.text(usd(totalPed), R-3, y+5.5, {align:'right'});
    normal(8); setColor(MUTED); pdf.text('Total recibido (a pagar)', L+W-88, y+11); bold(10); setColor(NAVY); pdf.text(usd(totalRec), R-3, y+11, {align:'right'});
    y += 20;
  } else { y += 4; }

  // Notas
  if (modo === 'recibo' && rec && rec.notas) {
    normal(7); setColor([120,120,120]); pdf.text('OBSERVACIONES', L, y); y += 4;
    normal(8.5); setColor(INK);
    pdf.splitTextToSize(stripAccents(rec.notas), W).slice(0,4).forEach(line => { pdf.text(line, L, y); y += 4.5; });
    y += 4;
  }

  // Firmas
  if (y > 250) { pdf.addPage(); y = 20; }
  y = Math.max(y, 250);
  const sigW = (W - 10) / 2;
  setDraw([120,120,120]); pdf.setLineWidth(0.3);
  [0,1].forEach(k => {
    const x = L + k*(sigW+10);
    pdf.line(x, y+10, x+sigW, y+10);
    normal(7.5); setColor(MUTED);
    pdf.text(k===0 ? 'Recibido por (almacenista)' : 'Verificado / Conforme', x, y+14, {align:'left'});
    pdf.text('Nombre, firma y fecha', x, y+18, {align:'left'});
  });
  y += 24;

  // Footer
  setDraw(BORDER); pdf.setLineWidth(0.2); pdf.line(L, 285, R, 285);
  normal(6.5); setColor([150,150,150]);
  pdf.text(stripAccents(razon_social) + ' · RIF ' + rif, L, 289);
  pdf.text('OC ' + oc.id + ' · ' + titulo + ' · Generado ' + fGen, R, 289, {align:'right'});

  const nombreArchivo = (modo === 'recibo' && rec ? 'Recepcion_' + rec.id : 'HojaRecepcion_' + oc.id) + '.pdf';
  pdf.save(nombreArchivo);
};

// ─── PDF de transferencia de inventario (recepción / cierre) ─────────────────
// modo='recepcion' → hoja/soporte de recepción de mercancía (enviado vs recibido vs pendiente).
// modo='cierre'    → soporte del cierre del proceso (documenta el faltante/merma final).
window.generateTransferenciaPDF = function generateTransferenciaPDF(transf, items, modo) {
  modo = modo === 'cierre' ? 'cierre' : 'recepcion';
  // jsPDF ya no viene en el arranque: se trae al primer uso y se REINTENTA la misma llamada
  // (normalmente ya está: se precarga cuando el navegador queda libre — ver index.html).
  if (!window.jspdf || !window.jspdf.jsPDF) {
    return window.ssVendor('jspdf')
      .then(() => window.generateTransferenciaPDF(transf, items, modo))
      .catch(() => { alert('No se pudo cargar la librería de PDF. Revisá la conexión e intentá de nuevo.'); return false; });
  }
  const { jsPDF } = window.jspdf;
  const ssData  = window.SSData || {};
  const empresa = window.getEmpresaConfig ? window.getEmpresaConfig(transf.empresa_origen) : {};
  const almNom  = id => (ssData.almacenes || []).find(a => a.id === id)?.nombre || id || '—';
  const {
    razon_social = 'Distribuidora Demo 1, C.A.', rif: _rif = null,
    dir_fiscal = 'Av. Principal, Centro Empresarial Norte, Piso 3, Of. 3-B.',
    dir_fiscal2 = 'Zona Industrial La Yaguara.', ciudad = 'Caracas DC 1050',
    pais = 'Venezuela', logo = null,
  } = empresa;
  const rif = _rif || 'J-40123456-7';
  const stripAccents = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const dateStr = d => { if (!d) return '—'; try { return new Date(String(d).slice(0,10) + 'T12:00:00').toLocaleDateString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric' }); } catch(e){ return d; } };
  const fGen = (() => { try { return new Date().toLocaleString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'America/Caracas' }); } catch(e){ return ''; } })();

  const pdf = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
  const L = 15, R = 195, W = 180;
  const NAVY=[30,58,95], MUTED=[85,85,85], INK=[17,17,17], BORDER=[210,214,222], SUNK=[244,246,250], AMBER=[146,64,14];
  const setColor=c=>pdf.setTextColor(c[0],c[1],c[2]);
  const setFill=c=>pdf.setFillColor(c[0],c[1],c[2]);
  const setDraw=c=>pdf.setDrawColor(c[0],c[1],c[2]);
  const bold=s=>{pdf.setFont('helvetica','bold');pdf.setFontSize(s);};
  const normal=s=>{pdf.setFont('helvetica','normal');pdf.setFontSize(s);};
  const fitText=(str,colW)=>{ if(!str) return ''; str=String(str); const avail=colW-2, fs=pdf.getFontSize(), sc=2.8346; let w=pdf.getStringUnitWidth(str)*fs/sc; if(w<=avail) return str; let cut=Math.max(1,Math.floor(str.length*avail/w)-1), s=str.slice(0,cut); while(s.length>1 && pdf.getStringUnitWidth(s+'…')*fs/sc>avail) s=s.slice(0,-1); return s+(s.length<str.length?'…':''); };

  let y = 13;
  if (logo) { try { pdf.addImage(logo, logo.startsWith('data:image/png')?'PNG':'JPEG', L, y, 26, 16); } catch(e){ setFill(NAVY); pdf.roundedRect(L,y,22,15,2,2,'F'); bold(12); setColor([255,255,255]); pdf.text('SS', L+11, y+10, {align:'center'}); } }
  else { setFill(NAVY); pdf.roundedRect(L,y,22,15,2,2,'F'); bold(12); setColor([255,255,255]); pdf.text('SS', L+11, y+10, {align:'center'}); }
  bold(11); setColor(NAVY); pdf.text(stripAccents(razon_social), R, y+5, {align:'right'});
  normal(7.5); setColor(MUTED);
  pdf.text(stripAccents(dir_fiscal), R, y+9.5, {align:'right'});
  pdf.text(stripAccents([dir_fiscal2, ciudad, pais].filter(Boolean).join(', ')), R, y+13.5, {align:'right'});
  normal(7); setColor([136,136,136]); pdf.text('RIF: ' + rif, R, y+17.5, {align:'right'});
  y += 24;

  const titulo = modo === 'cierre' ? 'SOPORTE DE CIERRE DE TRANSFERENCIA' : 'RECEPCION DE MERCANCIA';
  setFill(NAVY); pdf.rect(L, y, W, 9, 'F');
  bold(11); setColor([255,255,255]); pdf.text(titulo, L+3, y+6);
  bold(11); pdf.text(transf.id || '', R-3, y+6, {align:'right'});
  y += 9 + 5;

  const rowInfo = (label, val, x, ww) => { normal(7); setColor([120,120,120]); pdf.text(label, x, y); bold(9); setColor(INK); pdf.text(fitText(stripAccents(val || '—'), ww), x, y+4.5); };
  rowInfo('ALMACEN ORIGEN', almNom(transf.almacen_origen), L, 82);
  rowInfo('ALMACEN DESTINO', almNom(transf.almacen_destino), L+92, 82);
  y += 10;
  rowInfo('FECHA ENVIO', dateStr(transf.fecha_envio), L, 40);
  rowInfo('ENVIADO POR', transf.enviado_por || '—', L+44, 44);
  rowInfo(modo === 'cierre' ? 'FECHA CIERRE' : 'FECHA RECEPCION', dateStr(modo === 'cierre' ? transf.fecha_cierre : transf.fecha_recepcion), L+92, 44);
  rowInfo(modo === 'cierre' ? 'CERRADO POR' : 'RECIBIDO POR', (modo === 'cierre' ? transf.cerrado_por : transf.recibido_por) || '—', L+136, 44);
  y += 12;

  const cols = [ {t:'#',w:8,a:'center'}, {t:'SKU',w:30}, {t:'Descripcion',w:74}, {t:'Enviado',w:20,a:'right'}, {t:'Recibido',w:20,a:'right'}, {t:'Faltante',w:20,a:'right'} ];
  const colX = []; let acc = L; cols.forEach(c => { colX.push(acc); acc += c.w; });
  const drawHead = () => {
    setFill(SUNK); setDraw(BORDER); pdf.rect(L, y, W, 7, 'FD');
    bold(7.5); setColor(NAVY);
    cols.forEach((c,i) => { const x = c.a==='right' ? colX[i]+c.w-2 : c.a==='center' ? colX[i]+c.w/2 : colX[i]+2; pdf.text(c.t, x, y+4.7, {align: c.a==='right'?'right':c.a==='center'?'center':'left'}); });
    y += 7;
  };
  drawHead();
  let tEnv=0, tRec=0;
  (items || []).forEach((it, i) => {
    if (y > 250) { pdf.addPage(); y = 15; drawHead(); }
    const env = it.cantidad_enviada||0, rec = it.cantidad_recibida||0, falt = env-rec;
    tEnv += env; tRec += rec;
    const rowH = 8;
    if (i % 2 === 1) { setFill([250,250,251]); pdf.rect(L, y, W, rowH, 'F'); }
    setDraw(BORDER); pdf.setLineWidth(0.1); pdf.line(L, y+rowH, L+W, y+rowH);
    const cell = (idx, txt, color) => { const c = cols[idx]; normal(8); setColor(color||INK); const x = c.a==='right'?colX[idx]+c.w-2:colX[idx]+2; pdf.text(fitText(String(txt),c.w), x, y+5.2, {align:c.a==='right'?'right':'left'}); setColor(INK); };
    cell(0, i+1); cell(1, it.sku||'—'); cell(2, stripAccents(it.nombre||''));
    cell(3, env); cell(4, rec, rec<env?AMBER:INK); cell(5, falt, falt>0?[185,28,28]:INK);
    y += rowH;
  });
  y += 3;
  setFill(SUNK); setDraw(BORDER); pdf.rect(L+W-100, y, 100, 8, 'FD');
  bold(8.5); setColor(NAVY); pdf.text('TOTALES', L+W-98, y+5.3);
  pdf.text(String(tEnv), colX[3]+cols[3].w-2, y+5.3, {align:'right'});
  pdf.text(String(tRec), colX[4]+cols[4].w-2, y+5.3, {align:'right'});
  setColor(tEnv-tRec>0?[185,28,28]:NAVY); pdf.text(String(tEnv-tRec), colX[5]+cols[5].w-2, y+5.3, {align:'right'});
  y += 13;

  if (modo === 'cierre' && (tEnv - tRec) > 0) {
    setFill([255,251,235]); setDraw([251,191,36]); pdf.rect(L, y, W, 9, 'FD');
    normal(8); setColor(AMBER);
    pdf.text('Faltante documentado como merma: ' + (tEnv - tRec) + ' unidades' + (transf.faltante_devuelto ? ' (re-ingresado a un almacen).' : '.'), L+3, y+5.7);
    y += 13;
  }
  if (transf.notas) { normal(7); setColor([120,120,120]); pdf.text('OBSERVACIONES', L, y); y += 4; normal(8.5); setColor(INK); pdf.splitTextToSize(stripAccents(transf.notas), W).slice(0,4).forEach(line => { pdf.text(line, L, y); y += 4.5; }); }

  y = Math.max(y + 6, 250);
  const sigW = (W - 10) / 2;
  setDraw([120,120,120]); pdf.setLineWidth(0.3);
  [0,1].forEach(k => {
    const x = L + k*(sigW+10);
    // Firma digital del receptor embebida sobre la línea del bloque destino (k===1).
    if (k === 1 && transf.firma_recepcion) {
      try { pdf.addImage(transf.firma_recepcion, 'PNG', x + (sigW-46)/2, y-8, 46, 17); } catch(e){}
    }
    pdf.line(x, y+10, x+sigW, y+10);
    normal(7.5); setColor(MUTED);
    pdf.text(k===0 ? 'Entregado por (origen)' : 'Recibido / Conforme (destino)', x, y+14, {align:'left'});
    const sub = k===1 && transf.recibido_por ? (stripAccents(transf.recibido_por) + (transf.firma_recepcion_fecha ? ' · ' + dateStr(transf.firma_recepcion_fecha) : '')) : 'Nombre, firma y fecha';
    pdf.text(sub, x, y+18, {align:'left'});
  });

  setDraw(BORDER); pdf.setLineWidth(0.2); pdf.line(L, 285, R, 285);
  normal(6.5); setColor([150,150,150]);
  pdf.text(stripAccents(razon_social) + ' · RIF ' + rif, L, 289);
  pdf.text(transf.id + ' · ' + titulo + ' · Generado ' + fGen, R, 289, {align:'right'});

  pdf.save((modo === 'cierre' ? 'Cierre_' : 'Recepcion_') + transf.id + '.pdf');
};

// ── COMPROBANTE DE AJUSTE DE INVENTARIO — descarga automática (pdf.save) ────────────────────
// Pedido de Pedro: *"al realizar el ajuste no genera ningún documento"*. El correlativo `AJU-2026-…`
// ya existía; lo que faltaba era el papel. Un ajuste mueve existencias sin que haya una venta ni una
// compra detrás, así que es el movimiento que más necesita quedar firmado: es la única prueba de
// quién contó, qué había antes, qué quedó y por qué.
//
// Se imprime lo que REALMENTE se aplicó (las líneas `hechas`), no lo que se tipeó: un ajuste no es
// atómico y puede quedar parcial. Un comprobante que declare líneas que no entraron es peor que no
// tenerlo, porque se archiva y se le cree.
//
// ajuste: { id, fecha, almacen, motivo, usuario, notas, empresa_id, parcial,
//           lineas: [{ sku, nombre, antes, queda, delta }], seriales: [] }
window.generateAjustePDF = function generateAjustePDF(ajuste, opts) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    return window.ssVendor('jspdf')
      .then(() => window.generateAjustePDF(ajuste, opts))
      .catch(() => { alert('No se pudo cargar la librería de PDF. Revisá la conexión e intentá de nuevo.'); return false; });
  }
  const { jsPDF } = window.jspdf;
  const empresa = window.getEmpresaConfig ? window.getEmpresaConfig(ajuste.empresa_id) : {};
  const {
    razon_social = 'Distribuidora Demo 1, C.A.', rif: _rif = null,
    dir_fiscal = 'Av. Principal, Centro Empresarial Norte, Piso 3, Of. 3-B.',
    dir_fiscal2 = 'Zona Industrial La Yaguara.', ciudad = 'Caracas DC 1050',
    pais = 'Venezuela', logo = null,
  } = empresa;
  const rif = _rif || 'J-40123456-7';
  const stripAccents = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const dateStr = d => { if (!d) return '—'; try { return new Date(String(d).slice(0,10) + 'T12:00:00').toLocaleDateString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric' }); } catch(e){ return d; } };
  const fGen = (() => { try { return new Date().toLocaleString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone: (window.ssZonaHoraria && window.ssZonaHoraria()) || 'America/Caracas' }); } catch(e){ return ''; } })();

  const pdf = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
  const L = 15, R = 195, W = 180;
  const NAVY=[30,58,95], MUTED=[85,85,85], INK=[17,17,17], BORDER=[210,214,222], SUNK=[244,246,250],
        AMBER=[146,64,14], GREEN=[21,128,61], RED=[185,28,28];
  const setColor=c=>pdf.setTextColor(c[0],c[1],c[2]);
  const setFill=c=>pdf.setFillColor(c[0],c[1],c[2]);
  const setDraw=c=>pdf.setDrawColor(c[0],c[1],c[2]);
  const bold=s=>{pdf.setFont('helvetica','bold');pdf.setFontSize(s);};
  const normal=s=>{pdf.setFont('helvetica','normal');pdf.setFontSize(s);};
  const fitText=(str,colW)=>{ if(!str) return ''; str=String(str); const avail=colW-2, fs=pdf.getFontSize(), sc=2.8346; let w=pdf.getStringUnitWidth(str)*fs/sc; if(w<=avail) return str; let cut=Math.max(1,Math.floor(str.length*avail/w)-1), s=str.slice(0,cut); while(s.length>1 && pdf.getStringUnitWidth(s+'…')*fs/sc>avail) s=s.slice(0,-1); return s+(s.length<str.length?'…':''); };

  let y = 13;
  if (logo) { try { pdf.addImage(logo, logo.startsWith('data:image/png')?'PNG':'JPEG', L, y, 26, 16); } catch(e){ setFill(NAVY); pdf.roundedRect(L,y,22,15,2,2,'F'); bold(12); setColor([255,255,255]); pdf.text('SS', L+11, y+10, {align:'center'}); } }
  else { setFill(NAVY); pdf.roundedRect(L,y,22,15,2,2,'F'); bold(12); setColor([255,255,255]); pdf.text('SS', L+11, y+10, {align:'center'}); }
  bold(11); setColor(NAVY); pdf.text(stripAccents(razon_social), R, y+5, {align:'right'});
  normal(7.5); setColor(MUTED);
  pdf.text(stripAccents(dir_fiscal), R, y+9.5, {align:'right'});
  pdf.text(stripAccents([dir_fiscal2, ciudad, pais].filter(Boolean).join(', ')), R, y+13.5, {align:'right'});
  normal(7); setColor([136,136,136]); pdf.text('RIF: ' + rif, R, y+17.5, {align:'right'});
  y += 24;

  setFill(NAVY); pdf.rect(L, y, W, 9, 'F');
  bold(11); setColor([255,255,255]); pdf.text('COMPROBANTE DE AJUSTE DE INVENTARIO', L+3, y+6);
  bold(11); pdf.text(ajuste.id || '', R-3, y+6, {align:'right'});
  y += 9 + 5;

  const rowInfo = (label, val, x, ww) => { normal(7); setColor([120,120,120]); pdf.text(label, x, y); bold(9); setColor(INK); pdf.text(fitText(stripAccents(val || '—'), ww), x, y+4.5); };
  rowInfo('ALMACEN', ajuste.almacen, L, 82);
  rowInfo('FECHA', dateStr(ajuste.fecha), L+92, 40);
  rowInfo('REALIZADO POR', ajuste.usuario, L+136, 44);
  y += 11;
  rowInfo('MOTIVO', ajuste.motivo, L, 178);
  y += 12;

  const cols = [ {t:'#',w:8,a:'center'}, {t:'SKU',w:32}, {t:'Descripcion',w:72},
                 {t:'Habia',w:22,a:'right'}, {t:'Contado',w:22,a:'right'}, {t:'Diferencia',w:24,a:'right'} ];
  const colX = []; let acc = L; cols.forEach(c => { colX.push(acc); acc += c.w; });
  const drawHead = () => {
    setFill(SUNK); setDraw(BORDER); pdf.rect(L, y, W, 7, 'FD');
    bold(7.5); setColor(NAVY);
    cols.forEach((c,i) => { const x = c.a==='right' ? colX[i]+c.w-2 : c.a==='center' ? colX[i]+c.w/2 : colX[i]+2; pdf.text(c.t, x, y+4.7, {align: c.a==='right'?'right':c.a==='center'?'center':'left'}); });
    y += 7;
  };
  drawHead();
  let suben = 0, bajan = 0;
  (ajuste.lineas || []).forEach((it, i) => {
    if (y > 240) { pdf.addPage(); y = 15; drawHead(); }
    const d = Number(it.delta) || 0;
    if (d > 0) suben += d; else bajan += -d;
    const rowH = 8;
    if (i % 2 === 1) { setFill([250,250,251]); pdf.rect(L, y, W, rowH, 'F'); }
    setDraw(BORDER); pdf.setLineWidth(0.1); pdf.line(L, y+rowH, L+W, y+rowH);
    const cell = (idx, txt, color) => { const c = cols[idx]; normal(8); setColor(color||INK); const x = c.a==='right'?colX[idx]+c.w-2:colX[idx]+2; pdf.text(fitText(String(txt),c.w), x, y+5.2, {align:c.a==='right'?'right':'left'}); setColor(INK); };
    cell(0, i+1); cell(1, it.sku||'—'); cell(2, stripAccents(it.nombre||''));
    cell(3, it.antes); cell(4, it.queda);
    cell(5, (d > 0 ? '+' : '') + d, d > 0 ? GREEN : d < 0 ? RED : MUTED);
    y += rowH;
  });
  y += 3;
  setFill(SUNK); setDraw(BORDER); pdf.rect(L+W-110, y, 110, 8, 'FD');
  bold(8.5); setColor(NAVY); pdf.text('TOTAL DE UNIDADES', L+W-108, y+5.3);
  setColor(GREEN); pdf.text('+' + suben, colX[4]+cols[4].w-2, y+5.3, {align:'right'});
  setColor(RED);   pdf.text('-' + bajan, colX[5]+cols[5].w-2, y+5.3, {align:'right'});
  y += 13;

  // Un ajuste PARCIAL no puede parecer completo: el papel se archiva y después se le cree.
  if (ajuste.parcial) {
    setFill([255,251,235]); setDraw([251,191,36]); pdf.rect(L, y, W, 9, 'FD');
    normal(8); setColor(AMBER);
    pdf.text(stripAccents('Ajuste PARCIAL: este comprobante solo incluye las lineas que se aplicaron.'), L+3, y+5.7);
    y += 13;
  }
  if ((ajuste.seriales || []).length) {
    normal(7); setColor([120,120,120]); pdf.text('SERIALES INGRESADOS', L, y); y += 4;
    normal(8); setColor(INK);
    pdf.splitTextToSize(stripAccents((ajuste.seriales || []).join(', ')), W).slice(0,6).forEach(line => { pdf.text(line, L, y); y += 4.5; });
    y += 2;
  }
  if (ajuste.notas) {
    normal(7); setColor([120,120,120]); pdf.text('OBSERVACIONES', L, y); y += 4;
    normal(8.5); setColor(INK);
    pdf.splitTextToSize(stripAccents(ajuste.notas), W).slice(0,4).forEach(line => { pdf.text(line, L, y); y += 4.5; });
  }

  // Dos firmas: quien contó y quien autoriza. Un ajuste sin responsable es un descuadre sin dueño.
  y = Math.max(y + 6, 250);
  const sigW = (W - 10) / 2;
  setDraw([120,120,120]); pdf.setLineWidth(0.3);
  [0,1].forEach(k => {
    const x = L + k*(sigW+10);
    pdf.line(x, y+10, x+sigW, y+10);
    normal(7.5); setColor(MUTED);
    pdf.text(k===0 ? 'Realizado por (conteo)' : 'Autorizado por', x, y+14, {align:'left'});
    pdf.text(k===0 ? stripAccents(ajuste.usuario || 'Nombre, firma y fecha') : 'Nombre, firma y fecha', x, y+18, {align:'left'});
  });

  setDraw(BORDER); pdf.setLineWidth(0.2); pdf.line(L, 285, R, 285);
  normal(6.5); setColor([150,150,150]);
  pdf.text(stripAccents(razon_social) + ' · RIF ' + rif, L, 289);
  pdf.text((ajuste.id || '') + ' · Ajuste de inventario · Generado ' + fGen, R, 289, {align:'right'});

  // `output` existe para poder VERIFICAR el contenido en las pruebas (mismo contrato que
  // generateDocumentPDF): sin él, el único camino es la descarga y no hay forma de afirmar que el
  // comprobante dice lo que tiene que decir.
  if (opts && opts.output === 'bloburl') return pdf.output('bloburl');
  pdf.save('Ajuste_' + (ajuste.id || 'inventario') + '.pdf');
  return true;
};

// ── REPORTE DE MOVIMIENTOS DE INVENTARIO — descarga automática (pdf.save) ───────────────────
// Reemplaza al volcado HTML + window.print() que abría una ventana de impresión: acá el PDF se
// renderiza y se descarga solo, igual que el resto de los documentos del sistema.
// Apaisado porque son 8 columnas; con las 6 de los otros reportes no entraban sin recortar.
// movs: filas ya normalizadas por MovimientosInventarioPage
//       ({ fecha, tipo, sku, nombre, cantidad, almacen, motivo, usuario }); `cantidad` viene con
//       signo (negativo = salida).
// opts: { periodoLabel, stats:{total,entradas,salidas,transferencias}, empresaId, usuario }
window.generateMovimientosPDF = function generateMovimientosPDF(movs, opts) {
  opts = opts || {};
  // jsPDF ya no viene en el arranque: se trae al primer uso y se REINTENTA la misma llamada
  // (normalmente ya está: se precarga cuando el navegador queda libre — ver index.html).
  if (!window.jspdf || !window.jspdf.jsPDF) {
    return window.ssVendor('jspdf')
      .then(() => window.generateMovimientosPDF(movs, opts))
      .catch(() => { alert('No se pudo cargar la librería de PDF. Revisá la conexión e intentá de nuevo.'); return false; });
  }
  const { jsPDF } = window.jspdf;
  const empresa = window.getEmpresaConfig ? window.getEmpresaConfig(opts.empresaId) : {};
  const {
    razon_social = 'Distribuidora Demo 1, C.A.', rif: _rif = null, logo = null,
  } = empresa;
  const rif = _rif || 'J-40123456-7';
  const filas  = Array.isArray(movs) ? movs : [];
  const stats  = opts.stats || {};
  const perLbl = opts.periodoLabel || '';

  const stripAccents = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const dateStr = d => { if (!d) return '—'; try { return new Date(String(d).slice(0,10) + 'T12:00:00').toLocaleDateString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric' }); } catch(e){ return String(d); } };
  const fGen = (() => { try { return new Date().toLocaleString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'America/Caracas' }); } catch(e){ return ''; } })();

  const pdf = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });
  const L = 15, R = 282, W = 267, BOTTOM = 190;
  const NAVY=[30,58,95], MUTED=[85,85,85], INK=[17,17,17], BORDER=[210,214,222], SUNK=[244,246,250];
  const GREEN=[22,101,52], RED=[185,28,28], BLUE=[37,99,235];
  const setColor=c=>pdf.setTextColor(c[0],c[1],c[2]);
  const setFill=c=>pdf.setFillColor(c[0],c[1],c[2]);
  const setDraw=c=>pdf.setDrawColor(c[0],c[1],c[2]);
  const bold=s=>{pdf.setFont('helvetica','bold');pdf.setFontSize(s);};
  const normal=s=>{pdf.setFont('helvetica','normal');pdf.setFontSize(s);};
  const fitText=(str,colW)=>{ if(!str) return ''; str=String(str); const avail=colW-2, fs=pdf.getFontSize(), sc=2.8346; let w=pdf.getStringUnitWidth(str)*fs/sc; if(w<=avail) return str; let cut=Math.max(1,Math.floor(str.length*avail/w)-1), s=str.slice(0,cut); while(s.length>1 && pdf.getStringUnitWidth(s+'…')*fs/sc>avail) s=s.slice(0,-1); return s+(s.length<str.length?'…':''); };

  let y = 12;
  // Header
  if (logo) { try { pdf.addImage(logo, logo.startsWith('data:image/png')?'PNG':'JPEG', L, y, 26, 16); } catch(e){ setFill(NAVY); pdf.roundedRect(L,y,22,15,2,2,'F'); bold(12); setColor([255,255,255]); pdf.text('SS', L+11, y+10, {align:'center'}); } }
  else { setFill(NAVY); pdf.roundedRect(L,y,22,15,2,2,'F'); bold(12); setColor([255,255,255]); pdf.text('SS', L+11, y+10, {align:'center'}); }
  bold(11); setColor(NAVY); pdf.text(stripAccents(razon_social), R, y+5, {align:'right'});
  normal(7); setColor([136,136,136]); pdf.text('RIF: ' + rif, R, y+10, {align:'right'});
  normal(7); setColor(MUTED); pdf.text('Generado: ' + fGen, R, y+14.5, {align:'right'});
  y += 22;

  // Título
  setFill(NAVY); pdf.rect(L, y, W, 9, 'F');
  bold(11); setColor([255,255,255]); pdf.text('REPORTE DE MOVIMIENTOS DE INVENTARIO', L+3, y+6);
  bold(10); pdf.text(stripAccents(perLbl), R-3, y+6, {align:'right'});
  y += 14;

  // KPIs
  const kpis = [
    { l:'Total movimientos', v: String(stats.total != null ? stats.total : filas.length), c: INK },
    { l:'Entradas',          v: '+' + (stats.entradas || 0),        c: GREEN },
    { l:'Salidas',           v: '-' + (stats.salidas || 0),         c: RED },
    { l:'Transferencias',    v: String(stats.transferencias || 0),  c: BLUE },
  ];
  const kw = W / 4;
  kpis.forEach((k, i) => {
    const x = L + i * kw;
    setFill(SUNK); setDraw(BORDER); pdf.rect(x, y, kw - 2, 14, 'FD');
    normal(6.5); setColor(MUTED); pdf.text(stripAccents(k.l).toUpperCase(), x + 3, y + 5);
    bold(12); setColor(k.c); pdf.text(k.v, x + 3, y + 11.5);
  });
  y += 20;

  // Tabla
  const cols = [
    {t:'Fecha',    w:22}, {t:'Tipo',    w:24}, {t:'SKU',     w:32}, {t:'Producto', w:72},
    {t:'Cant.',    w:18, a:'right'},
    {t:'Almacen',  w:38}, {t:'Motivo',  w:40}, {t:'Usuario', w:21},
  ];
  const colX = []; let acc = L; cols.forEach(c => { colX.push(acc); acc += c.w; });
  const drawHead = () => {
    setFill(SUNK); setDraw(BORDER); pdf.rect(L, y, W, 7, 'FD');
    bold(7.5); setColor(NAVY);
    cols.forEach((c,i) => { const x = c.a==='right' ? colX[i]+c.w-2 : colX[i]+2; pdf.text(c.t, x, y+4.7, {align: c.a==='right'?'right':'left'}); });
    y += 7;
  };
  drawHead();

  const TIPO_LBL = { entrada:'Entrada', salida:'Salida', transferencia:'Transferencia', devolucion:'Devolucion', ajuste:'Ajuste' };
  const TIPO_COL = { entrada:GREEN, salida:RED, transferencia:BLUE, devolucion:GREEN, ajuste:MUTED };

  if (filas.length === 0) {
    normal(9); setColor(MUTED);
    pdf.text('No hubo movimientos de inventario en este periodo.', L + W/2, y + 12, {align:'center'});
    y += 20;
  }
  filas.forEach((m, i) => {
    if (y > BOTTOM) { pdf.addPage(); y = 15; drawHead(); }
    const rowH = 6.5;
    if (i % 2 === 1) { setFill([250,250,251]); pdf.rect(L, y, W, rowH, 'F'); }
    setDraw(BORDER); pdf.setLineWidth(0.1); pdf.line(L, y+rowH, L+W, y+rowH);
    const cell = (idx, txt, color, isBold) => {
      const c = cols[idx];
      isBold ? bold(7.5) : normal(7.5);
      setColor(color || INK);
      const x = c.a==='right' ? colX[idx]+c.w-2 : colX[idx]+2;
      pdf.text(fitText(stripAccents(txt), c.w), x, y+4.3, {align: c.a==='right'?'right':'left'});
      setColor(INK);
    };
    const qty = Number(m.cantidad) || 0;
    cell(0, dateStr(m.fecha));
    cell(1, TIPO_LBL[m.tipo] || m.tipo || '—', TIPO_COL[m.tipo]);
    cell(2, m.sku || '—');
    cell(3, m.nombre || '—');
    cell(4, (qty > 0 ? '+' : '') + qty, qty > 0 ? GREEN : qty < 0 ? RED : INK, true);
    cell(5, m.almacen || '—');
    cell(6, m.motivo || '—');
    cell(7, m.usuario || '—');
    y += rowH;
  });

  // Bloque de conformidad: este reporte existe para que el almacenista revise el día y firme.
  // Necesita ~30mm; si no entran en la página actual, va en una nueva (nunca partido).
  if (y > BOTTOM - 26) { pdf.addPage(); y = 20; }
  y += 10;
  setDraw(BORDER); pdf.setLineWidth(0.2); pdf.line(L, y, R, y);
  y += 8;
  const firmas = [
    { t:'Revisado por (almacenista)', s:'Nombre, C.I. y firma' },
    { t:'Conforme / Supervisor',      s:'Nombre, C.I. y firma' },
  ];
  firmas.forEach((f, i) => {
    const x = L + i * (W / 2) + 6;
    const ancho = W / 2 - 30;
    setDraw([170,170,170]); pdf.setLineWidth(0.3);
    pdf.line(x, y + 14, x + ancho, y + 14);
    bold(8); setColor(INK); pdf.text(stripAccents(f.t), x, y + 18.5);
    normal(6.5); setColor([150,150,150]); pdf.text(stripAccents(f.s), x, y + 22.5);
  });

  // Pie con numeración (se recorre al final para saber el total de páginas)
  const total = pdf.internal.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    pdf.setPage(p);
    setDraw(BORDER); pdf.setLineWidth(0.2); pdf.line(L, 200, R, 200);
    normal(6.5); setColor([150,150,150]);
    pdf.text(stripAccents(razon_social) + ' · RIF ' + rif, L, 204);
    pdf.text('Movimientos de Inventario · ' + stripAccents(perLbl) + ' · Pagina ' + p + ' de ' + total, R, 204, {align:'right'});
  }

  const slug = String(perLbl).normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-zA-Z0-9]+/g,'_').replace(/^_|_$/g,'').toLowerCase();
  pdf.save('Movimientos_' + (slug || 'reporte') + '.pdf');
  return true;
};

// ── Reporte de cliente ───────────────────────────────────────────────────────
// Antes se armaba un HTML y se abría una ventana con window.print(), así que el
// usuario caía en el diálogo de impresión y tenía que elegir "Guardar como PDF".
// Ahora se genera el PDF con jsPDF y se descarga directo, igual que el resto de
// los reportes del sistema.
//
//   tipo: 'historial' = CxC + compras + pagos | 'cxc' = solo CxC activas
//   data: { deudas, compras, pagos, ventasYTD, deudaActiva, totalVencido, totalCobrado }
window.generateClienteReportePDF = function generateClienteReportePDF(cliente, data, tipo) {
  // jsPDF ya no viene en el arranque: se trae al primer uso y se REINTENTA la misma llamada
  // (normalmente ya está: se precarga cuando el navegador queda libre — ver index.html).
  if (!window.jspdf || !window.jspdf.jsPDF) {
    return window.ssVendor('jspdf')
      .then(() => window.generateClienteReportePDF(cliente, data, tipo))
      .catch(() => { alert('No se pudo cargar la librería de PDF. Revisá la conexión e intentá de nuevo.'); return false; });
  }
  const { jsPDF } = window.jspdf;
  const soloCxC = tipo === 'cxc';
  const d = data || {};
  const deudas  = Array.isArray(d.deudas)  ? d.deudas  : [];
  const compras = Array.isArray(d.compras) ? d.compras : [];
  const pagos   = Array.isArray(d.pagos)   ? d.pagos   : [];

  const empresa = window.getEmpresaConfig ? window.getEmpresaConfig() : {};
  const razon = empresa.razon_social || 'Distribuidora Demo 1, C.A.';
  const rif   = empresa.rif || 'J-40123456-7';
  const logo  = empresa.logo || null;

  const strip = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const usd = v => '$ ' + Number(v || 0).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
  const fd  = s => { if (!s) return '—'; try { return new Date(String(s).slice(0,10) + 'T12:00:00').toLocaleDateString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric' }); } catch(e){ return String(s); } };
  const fGen = (() => { try { return new Date().toLocaleString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'America/Caracas' }); } catch(e){ return ''; } })();

  const pdf = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
  const L = 15, R = 195, W = 180, BOTTOM = 262;
  const NAVY=[30,58,95], MUTED=[85,85,85], INK=[17,17,17], BORDER=[210,214,222], SUNK=[244,246,250];
  const GREEN=[22,101,52], RED=[185,28,28], AMBER=[180,83,9];
  const setColor=c=>pdf.setTextColor(c[0],c[1],c[2]);
  const setFill=c=>pdf.setFillColor(c[0],c[1],c[2]);
  const setDraw=c=>pdf.setDrawColor(c[0],c[1],c[2]);
  const bold=s=>{pdf.setFont('helvetica','bold');pdf.setFontSize(s);};
  const normal=s=>{pdf.setFont('helvetica','normal');pdf.setFontSize(s);};
  const fitText=(str,colW)=>{ if(!str) return ''; str=String(str); const avail=colW-2, fs=pdf.getFontSize(), sc=2.8346; let w=pdf.getStringUnitWidth(str)*fs/sc; if(w<=avail) return str; let cut=Math.max(1,Math.floor(str.length*avail/w)-1), s=str.slice(0,cut); while(s.length>1 && pdf.getStringUnitWidth(s+'…')*fs/sc>avail) s=s.slice(0,-1); return s+(s.length<str.length?'…':''); };

  let y = 12;
  // ── Encabezado
  if (logo) { try { pdf.addImage(logo, logo.startsWith('data:image/png')?'PNG':'JPEG', L, y, 26, 16); } catch(e){ setFill(NAVY); pdf.roundedRect(L,y,22,15,2,2,'F'); bold(12); setColor([255,255,255]); pdf.text('SS', L+11, y+10, {align:'center'}); } }
  else { setFill(NAVY); pdf.roundedRect(L,y,22,15,2,2,'F'); bold(12); setColor([255,255,255]); pdf.text('SS', L+11, y+10, {align:'center'}); }
  bold(11); setColor(NAVY); pdf.text(strip(razon), R, y+5, {align:'right'});
  normal(7); setColor([136,136,136]); pdf.text('RIF: ' + rif, R, y+10, {align:'right'});
  normal(7); setColor(MUTED); pdf.text('Generado: ' + fGen, R, y+14.5, {align:'right'});
  y += 22;

  // ── Título
  setFill(NAVY); pdf.rect(L, y, W, 9, 'F');
  bold(11); setColor([255,255,255]);
  pdf.text(soloCxC ? 'CUENTAS POR COBRAR ACTIVAS' : 'REPORTE DE CLIENTE', L+3, y+6);
  bold(9); pdf.text(fd(new Date().toISOString()), R-3, y+6, {align:'right'});
  y += 13;

  // ── Datos del cliente
  setFill(SUNK); setDraw(BORDER); pdf.rect(L, y, W, 18, 'FD');
  bold(11); setColor(INK); pdf.text(fitText(strip(cliente.nombre), W-70), L+3, y+7);
  normal(7.5); setColor(MUTED);
  const linea2 = ['RIF ' + (cliente.rif || '—'), cliente.telefono || null, cliente.email || null, cliente.ciudad || null]
    .filter(Boolean).join('   ·   ');
  pdf.text(fitText(strip(linea2), W-6), L+3, y+13);
  normal(7); setColor([136,136,136]);
  pdf.text(strip(cliente.tipo || ''), R-3, y+7, {align:'right'});
  y += 24;

  // ── KPIs
  const kpis = [
    { l:'Ventas YTD',    v: usd(d.ventasYTD),    c: NAVY },
    { l:'Deuda activa',  v: usd(d.deudaActiva),  c: (d.deudaActiva||0) > 0 ? AMBER : GREEN },
    { l:'Total vencido', v: usd(d.totalVencido), c: (d.totalVencido||0) > 0 ? RED : GREEN },
    { l:'Total cobrado', v: usd(d.totalCobrado), c: GREEN },
  ];
  const kw = W / 4;
  kpis.forEach((k, i) => {
    const x = L + i * kw;
    setFill(SUNK); setDraw(BORDER); pdf.rect(x, y, kw - 2, 14, 'FD');
    normal(6.5); setColor(MUTED); pdf.text(strip(k.l).toUpperCase(), x + 3, y + 5);
    bold(10); setColor(k.c); pdf.text(k.v, x + 3, y + 11.5);
  });
  y += 20;

  // Dibuja una tabla y devuelve la nueva `y`. Reutilizable para las tres.
  function tabla(titulo, cols, filas, render, vacio) {
    const colX = []; let acc = L; cols.forEach(c => { colX.push(acc); acc += c.w; });
    const drawHead = () => {
      setFill(SUNK); setDraw(BORDER); pdf.rect(L, y, W, 7, 'FD');
      bold(7.5); setColor(NAVY);
      cols.forEach((c,i) => { const x = c.a==='right' ? colX[i]+c.w-2 : colX[i]+2; pdf.text(c.t, x, y+4.7, {align: c.a==='right'?'right':'left'}); });
      y += 7;
    };
    if (y > BOTTOM - 24) { pdf.addPage(); y = 15; }
    bold(9.5); setColor(NAVY); pdf.text(strip(titulo) + ' (' + filas.length + ')', L, y+4); y += 8;
    drawHead();
    if (filas.length === 0) {
      normal(8); setColor(MUTED); pdf.text(strip(vacio), L + W/2, y + 8, {align:'center'}); y += 16;
      return;
    }
    filas.forEach((f, i) => {
      if (y > BOTTOM) { pdf.addPage(); y = 15; drawHead(); }
      const rowH = 6.2;
      if (i % 2 === 1) { setFill([250,250,251]); pdf.rect(L, y, W, rowH, 'F'); }
      setDraw(BORDER); pdf.setLineWidth(0.1); pdf.line(L, y+rowH, L+W, y+rowH);
      const cell = (idx, txt, color, isBold) => {
        const c = cols[idx];
        isBold ? bold(7.5) : normal(7.5);
        setColor(color || INK);
        const x = c.a==='right' ? colX[idx]+c.w-2 : colX[idx]+2;
        pdf.text(fitText(strip(txt), c.w), x, y+4.2, {align: c.a==='right'?'right':'left'});
        setColor(INK);
      };
      render(cell, f);
      y += rowH;
    });
    y += 6;
  }

  // ── CxC activas (siempre)
  const totalSaldo = deudas.reduce((s,x) => s + ((x.monto||0) - (x.pagado||0)), 0);
  tabla('Cuentas por cobrar activas',
    [{t:'Factura',w:40},{t:'Emitida',w:24},{t:'Vence',w:24},{t:'Dias',w:18,a:'right'},
     {t:'Monto',w:26,a:'right'},{t:'Pagado',w:24,a:'right'},{t:'Saldo',w:24,a:'right'}],
    deudas,
    (cell, x) => {
      const saldo = (x.monto||0) - (x.pagado||0);
      const dias  = Number(x.dias) || 0;
      cell(0, x.factura || x.id || '—');
      cell(1, fd(x.fecha_emision || x.fecha || x.vence));
      cell(2, fd(x.vence));
      cell(3, dias > 0 ? '+' + dias : dias < 0 ? String(dias) : '0', dias > 0 ? RED : MUTED);
      cell(4, usd(x.monto));
      cell(5, usd(x.pagado), GREEN);
      cell(6, usd(saldo), saldo > 0 ? AMBER : INK, true);
    },
    'Sin deuda pendiente.');
  if (deudas.length) {
    setFill(SUNK); setDraw(BORDER); pdf.rect(L, y-4, W, 8, 'FD');
    bold(8); setColor(NAVY); pdf.text('TOTAL POR COBRAR', L+3, y+1.5);
    bold(9); setColor(AMBER); pdf.text(usd(totalSaldo), R-3, y+1.5, {align:'right'});
    y += 12;
  }

  // ── Historial (solo en el reporte completo)
  if (!soloCxC) {
    const ETAPA = { cotizacion:'Cotizacion', orden:'Orden', despacho:'Despacho', factura:'Factura', anulado:'Anulado', cancelada:'Anulado' };
    tabla('Historial de compras',
      [{t:'Documento',w:44},{t:'Fecha',w:26},{t:'Etapa',w:34},{t:'Items',w:20,a:'right'},{t:'Total',w:56,a:'right'}],
      compras.slice().sort((a,b) => new Date(b.fecha) - new Date(a.fecha)),
      (cell, x) => {
        cell(0, x.id || '—');
        cell(1, fd(x.fecha));
        cell(2, ETAPA[x.tipo] || ETAPA[x.estado] || x.estado || '—');
        cell(3, String(Array.isArray(x.items) ? x.items.length : (x.items || x.documentos_items?.length || '—')));
        cell(4, usd(x.total), INK, true);
      },
      'Este cliente no tiene compras registradas.');

    const METODO = { transferencia:'Transferencia', efectivo:'Efectivo', zelle:'Zelle', cheque:'Cheque', pago_movil:'Pago Movil', movil:'Pago Movil', binance:'Binance', tarjeta:'Tarjeta' };
    tabla('Pagos recibidos',
      [{t:'Pago',w:32},{t:'Fecha',w:22},{t:'Factura',w:32},{t:'Metodo',w:26},{t:'Banco',w:30},{t:'Referencia',w:18},{t:'Monto',w:20,a:'right'}],
      pagos,
      (cell, x) => {
        cell(0, x.id || '—');
        cell(1, fd(x.fecha));
        cell(2, x._factura || x.documento_id || '—');
        cell(3, METODO[x.metodo] || x.metodo || '—');
        cell(4, x.banco || '—');
        cell(5, x.referencia || '—');
        cell(6, usd(x.monto_usd != null ? x.monto_usd : x.monto), GREEN, true);
      },
      'Sin pagos registrados.');
  }

  // ── Pie con numeración
  const totalPag = pdf.internal.getNumberOfPages();
  for (let p = 1; p <= totalPag; p++) {
    pdf.setPage(p);
    setDraw(BORDER); pdf.setLineWidth(0.2); pdf.line(L, 283, R, 283);
    normal(6.5); setColor([150,150,150]);
    pdf.text(strip(razon) + ' · RIF ' + rif, L, 287);
    pdf.text(strip(cliente.nombre) + ' · Pagina ' + p + ' de ' + totalPag, R, 287, {align:'right'});
  }

  const slug = strip(cliente.nombre).replace(/[^a-zA-Z0-9]+/g,'_').replace(/^_|_$/g,'');
  pdf.save((soloCxC ? 'CxC_' : 'Reporte_') + (slug || 'cliente') + '.pdf');
  return true;
};

Object.assign(window, { generateDocumentPDF: window.generateDocumentPDF, generateRecepcionPDF: window.generateRecepcionPDF, generateTransferenciaPDF: window.generateTransferenciaPDF, generateMovimientosPDF: window.generateMovimientosPDF, generateClienteReportePDF: window.generateClienteReportePDF });
