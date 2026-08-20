// Distribuidora Demo — generador del dataset relacional (Distribuidora Demo 1 + Suplementos Demo 2)
//
// Se ejecuta UNA sola vez, la primera vez que algo pide datos (ver ensureBuilt() en mock-sb.js) —
// nunca al cargar este script: en ese momento settings.jsx (que define ROLES_MODULES) todavía no
// corrió. Todo lo que arma vive en `window.__ssDemoDB` con los MISMOS nombres de tabla/columna que
// Postgres, para que src/supabase.js —que sí se conserva intacto— no note la diferencia.
//
// Las fechas de negocio (documentos, pagos, movimientos) se anclan a HOY (new Date()), restando
// días hacia atrás: así la demo nunca se ve vieja, se presente cuando se presente. La ALEATORIEDAD
// (qué cliente, qué producto, qué monto) sí usa el PRNG con semilla de prng.js, para que el dataset
// sea el mismo en cada carga dentro de una sesión y la demo sea predecible al mostrarla.
(function () {
  function pad(n, len) { return String(n).padStart(len || 2, '0'); }
  function isoDate(d) { return d.toISOString().slice(0, 10); }
  function daysAgo(n) { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d; }
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  function buildEmpresa(empresaId, nombre, color, rng, cat, opts) {
    const db = window.__ssDemoDB;
    const T = db.table;

    // ── Almacenes ──────────────────────────────────────────────────────────
    const almacenesSpec = opts.almacenes; // [[nombre, ciudad, prefijo], ...]
    const almacenes = almacenesSpec.map((a, i) => ({
      id: `${empresaId}-ALM-${i + 1}`,
      nombre: a[0],
      direccion: `${a[1]}, Venezuela`,
      empresa_id: empresaId,
      tipo: i === 0 ? 'principal' : 'sucursal',
      prefijo_despacho: a[2],
      activo: true,
    }));
    db.insert('almacenes', almacenes);
    const almacenPrincipal = almacenes[0];

    // ── Categorias / marcas ──────────────────────────────────────────────────
    const categorias = opts.categorias.map((nombre, i) => ({ id: `${empresaId}-CAT-${i + 1}`, nombre, empresa_id: empresaId }));
    db.insert('categorias', categorias);
    const marcas = opts.marcas.map((nombre, i) => ({ id: `${empresaId}-MAR-${i + 1}`, nombre, empresa_id: empresaId, activo: true }));
    db.insert('marcas', marcas);

    // ── Tipos de cliente ─────────────────────────────────────────────────────
    const tiposClienteSpec = [
      ['Mayorista', '#2563eb', 15], ['Distribuidor', '#7c3aed', 10],
      ['Detal', '#0369a1', 0], ['Corporativo', '#b45309', 5],
    ];
    const tiposCliente = tiposClienteSpec.map((t, i) => ({
      id: `${empresaId}-TC-${i + 1}`, nombre: t[0], color: t[1], descuento: t[2], empresa_id: empresaId,
    }));
    db.insert('tipos_cliente', tiposCliente);

    // ── Listas de precios (una por tipo de cliente) ──────────────────────────
    const listasPrecios = tiposCliente.map((t, i) => ({
      id: `${empresaId}-LP-${i + 1}`, nombre: 'Precio ' + t.nombre, tipo_cliente_id: t.id,
      modo: 'descuento', valor: t.descuento, empresa_id: empresaId, activo: true,
    }));
    db.insert('listas_precios', listasPrecios);

    // ── Productos ────────────────────────────────────────────────────────────
    // `minimo` es el umbral GLOBAL de reposición del producto (lo que lee inventory.jsx para su
    // KPI "Bajo Stock" y lo que lee la Torre de IA — el mismo campo en los dos lados a propósito,
    // para que el número que muestra la IA nunca contradiga al que ya muestra el módulo).
    const productos = opts.productos.map((p, i) => {
      const [nombre, categoria, costo, base, peso] = p;
      const serializado = opts.serializablePrefix && rng.chance(opts.serialProb || 0);
      return {
        sku: `${opts.skuPrefix}-${pad(i + 1, 4)}`,
        nombre, categoria, marca: rng.pick(opts.marcas), costo: round2(costo), base: round2(base),
        peso, empresas: [empresaId], serializado: !!serializado,
        garantia_meses: serializado ? 12 : 0, minimo: rng.int(5, 15),
        descripcion: nombre, servicio: false, activo: true,
      };
    });
    db.insert('productos', productos);

    // ── Inventario (no toda combinacion sku/almacen — variedad real) ────────
    // ~15% de los productos se generan deliberadamente en quiebre (bajo su `minimo` global): sin
    // esto, el KPI "Bajo Stock" del módulo real —y lo que reporta la Torre de IA sobre el mismo
    // dato— siempre daría 0, que es menos convincente para la demo que un puñado de casos reales.
    const skusBajoStock = new Set(rng.pickN(productos, Math.round(productos.length * 0.15)).map(p => p.sku));
    const invRows = [];
    productos.forEach(p => {
      const forzarBajo = skusBajoStock.has(p.sku);
      almacenes.forEach((a, ai) => {
        // el almacen principal siempre tiene stock; las sucursales, la mayoria de las veces
        if (ai > 0 && !rng.chance(0.75)) return;
        const cantidad = forzarBajo ? (ai === 0 ? rng.int(0, p.minimo - 1) : 0) : rng.int(0, ai === 0 ? 180 : 60);
        const reservado = rng.chance(0.15) ? rng.int(1, Math.min(5, cantidad)) : 0;
        invRows.push({
          sku: p.sku, almacen_id: a.id, cantidad, reservado,
          locacion: `${String.fromCharCode(65 + rng.int(0, 4))}-${pad(rng.int(1, 12))}-${pad(rng.int(1, 4))}`,
          minimo: rng.int(3, 10), maximo: rng.int(80, 220),
        });
      });
    });
    db.insert('inventario', invRows);

    // ── POS: fuentes de venta / tipos de entrega ─────────────────────────────
    db.insert('pos_fuentes_venta', ['Tienda fisica', 'WhatsApp', 'Instagram', 'Pagina web', 'Referido'].map((n, i) => ({
      id: `${empresaId}-FV-${i + 1}`, nombre: n, empresa_id: empresaId, activo: true, orden: i + 1,
    })));
    db.insert('pos_tipos_entrega', ['Retiro en tienda', 'Delivery propio', 'Envio nacional', 'Mensajeria'].map((n, i) => ({
      id: `${empresaId}-TE-${i + 1}`, nombre: n, empresa_id: empresaId, activo: true, orden: i + 1,
    })));

    // ── Configuracion del sistema (branding, ya sin datos reales) ────────────
    db.insert('configuracion_sistema', [{
      empresa_id: empresaId,
      razon_social: opts.razonSocial, rif: opts.rif, telefono: opts.telefono,
      email: opts.email, email_info: opts.emailInfo, website: opts.website, whatsapp: opts.whatsapp,
      dir_fiscal: opts.dirFiscal, dir_fiscal2: opts.dirFiscal2, ciudad: opts.ciudad, pais: 'Venezuela',
      logo: null, favicon: null, modo_historia_activo: true, zona_horaria: 'America/Caracas',
      shopify_enabled: false, shopify_store: null,
    }]);

    // ── Metodos de pago ──────────────────────────────────────────────────────
    db.insert('metodos_pago', [
      ['efectivo', 'Efectivo', 'cash', ['USD', 'VES'], true],
      ['transferencia', 'Transferencia', 'bank', ['VES'], false],
      ['zelle', 'Zelle', 'dollar', ['USD'], true],
      ['pago_movil', 'Pago Movil', 'phone', ['VES'], false],
      ['binance', 'Binance', 'binance', ['USD'], true],
    ].map((m, i) => ({
      id: `${empresaId}-MP-${m[0]}`, empresa_id: empresaId, codigo: m[0], label: m[1],
      icon: m[2], monedas: m[3], sin_banco: m[4], activo: true, orden: i + 1,
    })));

    // ── Categorias de cuenta (CxC/CxP) ──────────────────────────────────────
    db.insert('categorias_cuenta', ['Ventas', 'Servicios', 'Compras', 'Nomina', 'Otros'].map((n, i) => ({
      id: `${empresaId}-CC-${i + 1}`, nombre: n, empresa_id: empresaId,
    })));

    // ── Roles: se siembran SIN permisos — settings.jsx aplica buildDefaultPerms()
    // por nombre de rol en cuanto detecta `permisos` vacio (ver getRolesConfig). ──
    const ROLES_BASE = [
      ['Administrador', 'Acceso total al sistema', '#2563eb'],
      ['Gerente de Operaciones', 'Gestion completa sin configuracion ni Dashboard', '#7c3aed'],
      ['Ventas Senior', 'Ventas con privilegios ampliados', '#059669'],
      ['Ventas', 'Punto de venta basico', '#0369a1'],
      ['Contadora', 'Finanzas, CxC, CxP y banca', '#b45309'],
      ['Compras', 'Inventario y proveedores', '#0f766e'],
      ['CxC / CxP', 'Cuentas por cobrar y pagar', '#7c3aed'],
      ['Almacen Central', 'Almacen central', '#6d28d9'],
      ['Almacen Valencia', 'Almacen Valencia', '#6d28d9'],
      ['Driver', 'Conductor - acceso solo al portal de drivers', '#0891b2'],
      ['Cliente', 'Contacto de cliente - acceso solo al portal de clientes', '#a855f7'],
      ['Vendedor', 'Vendedor - acceso equivalente a Ventas', '#0369a1'],
    ];
    db.insert('roles', ROLES_BASE.map((r, i) => ({
      id: `${empresaId}-ROL-${i + 1}`, empresa_id: empresaId, nombre: r[0], descripcion: r[1],
      color: r[2], builtin: true, permisos: {},
    })));
    db.insert('campos_config', [{ id: `${empresaId}-CFG-pos`, empresa_id: empresaId, modulo: 'pos', config: {} }]);

    // ── Vendedores ───────────────────────────────────────────────────────────
    const nombresVend = rng.pickN(cruzaNombres(cat), opts.numVendedores);
    const vendedores = nombresVend.map((nombre, i) => ({
      id: `${empresaId}-VEN-${i + 1}`, nombre, telefono: telefonoVe(rng), email: emailDe(nombre),
      activo: true, empresa_id: empresaId, meta_mensual: rng.int(8, 30) * 1000, comision_pct: rng.pick([2, 3, 4, 5]),
    }));
    db.insert('vendedores', vendedores);

    // ── Clientes ─────────────────────────────────────────────────────────────
    const clientes = [];
    for (let i = 0; i < opts.numClientes; i++) {
      const nombre = nombreEmpresaCliente(rng, cat, opts.rubros);
      const tipo = rng.weighted([[tiposCliente[0], 0.15], [tiposCliente[1], 0.25], [tiposCliente[2], 0.5], [tiposCliente[3], 0.1]]);
      const lista = listasPrecios.find(l => l.tipo_cliente_id === tipo.id);
      const limite = rng.pick([500, 1000, 2000, 5000, 8000]);
      clientes.push({
        id: `${empresaId}-CLI-${pad(i + 1, 3)}`, nombre, rif: rifVe(rng),
        tipo: tipo.id, tipo_cliente_id: tipo.id, lista_precio_id: lista.id, listaPrecio: lista.id,
        contacto: rng.pick(cat.NOMBRES) + ' ' + rng.pick(cat.APELLIDOS), telefono: telefonoVe(rng),
        email: emailDe(nombre), ciudad: rng.pick(cat.CIUDADES_VE), direccion: 'Zona ' + rng.int(1, 20),
        limite_credito: limite, dias_credito: rng.pick([0, 15, 30, 45]), empresas: [empresaId],
        activo: true, created_at: daysAgo(rng.int(30, 700)).toISOString(),
      });
    }
    db.insert('clientes', clientes);

    // ── Proveedores ──────────────────────────────────────────────────────────
    const proveedores = [];
    for (let i = 0; i < opts.numProveedores; i++) {
      const nombre = nombreEmpresaProveedor(rng, cat, opts.skuPrefix);
      proveedores.push({
        id: `${empresaId}-PRO-${pad(i + 1, 2)}`, nombre, rif: rifVe(rng), pais: rng.chance(0.8) ? 'Venezuela' : rng.pick(['China', 'Estados Unidos', 'Panama']),
        contacto: rng.pick(cat.NOMBRES) + ' ' + rng.pick(cat.APELLIDOS), telefono: telefonoVe(rng),
        email: emailDe(nombre), deuda: 0, dias_pago: rng.pick([15, 30, 45, 60]),
        categorias: rng.pickN(opts.categorias, 2), activo: true, empresa_id: empresaId,
      });
    }
    db.insert('proveedores', proveedores);

    // ── Contactos (uno o dos por cliente) ───────────────────────────────────
    const contactos = [];
    clientes.forEach((c, i) => {
      const n = rng.chance(0.4) ? 2 : 1;
      for (let j = 0; j < n; j++) {
        contactos.push({
          id: `${empresaId}-CON-${i}-${j}`, cliente_id: c.id, nombre: rng.pick(cat.NOMBRES) + ' ' + rng.pick(cat.APELLIDOS),
          telefono: telefonoVe(rng), email: emailDe(c.nombre), cargo: rng.pick(['Compras', 'Administracion', 'Gerencia']),
          empresa_id: empresaId,
        });
      }
    });
    db.insert('contactos', contactos);

    // ── Bancos + movimientos (saldo = suma real de sus movimientos) ─────────
    const bancosSel = rng.pickN(cat.BANCOS_VE, opts.numBancos);
    const cuentasBancarias = bancosSel.map((b, i) => ({
      id: `${empresaId}-BAN-${i + 1}`, banco: b.banco, cuenta: '0' + rng.int(100, 999) + '-****-' + rng.int(1000, 9999),
      moneda: b.moneda, tipo: b.banco === 'Zelle' ? 'zelle' : (b.banco === 'Binance' ? 'binance' : (b.banco === 'Caja chica' ? 'efectivo' : 'corriente')),
      saldo: 0, saldo_previo: 0, titular: opts.razonSocial, color: b.color,
      logo: b.banco.toLowerCase().includes('binance') ? 'binance' : null, empresa_id: empresaId, activo: true,
    }));
    db.insert('cuentas_bancarias', cuentasBancarias);

    // Categorías de EGRESO variadas: alimentan el desglose "En qué se gastó" de Reportes de
    // Finanzas — con una sola categoría ("gastos") ese panel se veía como una sola barra enorme.
    const CATEGORIAS_EGRESO = ['Nómina', 'Servicios', 'Alquiler', 'Transporte', 'Impuestos', 'Mantenimiento', 'Mercadeo'];
    const movs = [];
    cuentasBancarias.forEach((cta, ci) => {
      const n = rng.int(8, 22);
      let saldo = 0;
      for (let i = 0; i < n; i++) {
        const ingreso = rng.chance(0.6);
        const monto = round2(rng.int(20, 900) * (ingreso ? 1 : -1));
        saldo += monto;
        movs.push({
          id: `MOV-${empresaId}-${ci}-${pad(i, 3)}`, cuenta_id: cta.id, empresa_id: empresaId,
          fecha: isoDate(daysAgo(rng.int(0, 180))), tipo: ingreso ? 'ingreso' : 'egreso',
          monto, monto_usd: monto, moneda: 'USD', tasa: null,
          descripcion: ingreso ? 'Cobro de cliente' : rng.pick(['Pago a proveedor', 'Nómina quincenal', 'Servicio eléctrico', 'Flete', 'Impuesto municipal', 'Mantenimiento de local']),
          categoria: ingreso ? 'ventas' : rng.pick(CATEGORIAS_EGRESO),
          conciliado: rng.chance(0.7), match_id: null, creado_por: null, documento_id: null, pago_id: null,
        });
      }
      cta.saldo = round2(saldo);
      cta.saldo_previo = round2(saldo - (movs.length ? movs[movs.length - 1].monto : 0));
    });
    movs.sort((a, b) => a.fecha < b.fecha ? -1 : 1);
    db.insert('movimientos_bancarios', movs);

    // ── Dropshipping: proveedores internacionales + comparador de precios ────
    // El módulo compara, para el MISMO sku, lo que cobra cada proveedor externo — así que el
    // dataset tiene que sembrar de verdad la tabla de precios (ds_precios) con variación real
    // entre proveedores, no solo la lista de proveedores vacía.
    const DS_PROVEEDORES_BASE = [
      ['China Direct Supply', 'China', '🇨🇳', 30],
      ['USA Wholesale Import', 'Estados Unidos', '🇺🇸', 10],
      ['Panama Free Zone', 'Panama', '🇵🇦', 14],
      ['Miami Cargo Express', 'Estados Unidos', '🇺🇸', 8],
    ];
    const dsProveedores = DS_PROVEEDORES_BASE.map((p, i) => ({
      id: `${empresaId}-DSP-${i + 1}`, empresa_id: empresaId, nombre: p[0], pais: p[1], bandera: p[2],
      contacto: rng.pick(cat.NOMBRES) + ' ' + rng.pick(cat.APELLIDOS), email: emailDe(p[0]), whatsapp: telefonoVe(rng),
      color: rng.pick(['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#ec4899', '#06b6d4', '#84cc16']),
      activo: true, dias_entrega: p[3], notas: '',
    }));
    db.insert('ds_proveedores', dsProveedores);

    // ~60% del catálogo son candidatos de dropshipping (mismos SKU que ya se venden — el
    // comparador tiene sentido justamente porque son productos que la empresa YA compra).
    const dsCandidatos = rng.pickN(productos, Math.round(productos.length * 0.6));
    const dsProductos = dsCandidatos.map(p => ({
      sku: p.sku, empresa_id: empresaId, nombre: p.nombre, categoria: p.categoria, marca: p.marca,
      shopify_id: rng.chance(0.4) ? ('shopify-' + rng.token(8)) : null,
      shopify_status: rng.weighted([['publicado', 0.35], ['no_publicado', 0.5], ['error', 0.15]]),
      shopify_precio: p.base,
      ultima_sync: rng.chance(0.4) ? isoDate(daysAgo(rng.int(0, 20))) : null,
    }));
    db.insert('ds_productos', dsProductos);

    const dsPrecios = [];
    dsCandidatos.forEach(p => {
      const provs = rng.pickN(dsProveedores, rng.int(2, dsProveedores.length));
      provs.forEach(prov => {
        // Precio del proveedor externo relativo al COSTO actual: entre 65% (mejor que lo que se
        // paga hoy — vale la pena cambiar) y 125% (peor). Así el comparador siempre tiene algo
        // real que mostrar, no todos los proveedores cobrando lo mismo.
        const factor = 0.65 + rng.float() * 0.6;
        dsPrecios.push({
          id: prov.id + '-' + p.sku, empresa_id: empresaId, proveedor_id: prov.id, sku: p.sku,
          precio: round2(p.costo * factor),
        });
      });
    });
    db.insert('ds_precios', dsPrecios);

    // ── Chat interno ─────────────────────────────────────────────────────────
    const canales = ['General', 'Ventas', 'Almacen'].map((n, i) => ({
      id: `${empresaId}-CH-${i + 1}`, nombre: n, tipo: 'grupo', empresa_id: empresaId,
    }));
    db.insert('canales_chat', canales);
    const usuariosDemoIds = window.__ssDemoDB.table('usuarios'); // se llena despues; se linkea al final

    // ── Documentos: cadena completa cotizacion->orden->factura->despacho + historico de facturas ──
    const docsCtx = { empresaId, almacenPrincipal, almacenes, clientes, productos, vendedores, rng };
    generarDocumentos(docsCtx, opts.numCadenas, opts.numFacturasHistoricas);

    return { almacenes, categorias, marcas, tiposCliente, listasPrecios, productos, clientes, proveedores, vendedores, cuentasBancarias };
  }

  // ── Helpers de nombres/datos ficticios ─────────────────────────────────────
  function cruzaNombres(cat) {
    const out = [];
    cat.NOMBRES.forEach(n => cat.APELLIDOS.forEach(a => out.push(n + ' ' + a)));
    return out;
  }
  function telefonoVe(rng) {
    return '0' + rng.pick(['412', '414', '416', '424', '426']) + '-' + rng.int(1000000, 9999999);
  }
  function emailDe(nombre) {
    const slug = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/(^\.|\.$)/g, '');
    return slug + '@ejemplo-demo.com';
  }
  function rifVe(rng) {
    return rng.pick(['J', 'V']) + '-' + rng.int(10000000, 45999999) + '-' + rng.int(0, 9);
  }
  function nombreEmpresaCliente(rng, cat, rubros) {
    return rng.pick(rubros) + ' ' + rng.pick(cat.APELLIDOS) + ' ' + rng.pick(cat.SUFIJOS_EMPRESA);
  }
  function nombreEmpresaProveedor(rng, cat, prefix) {
    return 'Suministros ' + prefix + ' ' + rng.pick(cat.APELLIDOS) + ' ' + rng.pick(cat.SUFIJOS_EMPRESA);
  }

  // ── Documentos (cotizacion / orden / factura / despacho) ───────────────────
  let __docSeq = { COT: 0, ORD: 0, FAC: 0, DSP: 0 };
  function nextId(prefix, year) { __docSeq[prefix] += 1; return `${prefix}-${year}-${__docSeq[prefix]}`; }

  function lineasAlAzar(ctx) {
    const n = ctx.rng.int(1, 5);
    const productos = ctx.rng.pickN(ctx.productos, n);
    return productos.map(p => {
      const cantidad = ctx.rng.int(1, 8);
      const precio = p.base;
      return {
        sku: p.sku, nombre: p.nombre, cantidad, precio_unitario: precio,
        subtotal: round2(cantidad * precio), costo: p.costo, cantidad_despachada: 0,
      };
    });
  }
  function totalDe(lineas) { return round2(lineas.reduce((s, l) => s + l.subtotal, 0)); }

  function crearDocumento(ctx, tipo, fecha, extra) {
    const db = window.__ssDemoDB;
    const year = fecha.getFullYear();
    const prefix = { cotizacion: 'COT', orden: 'ORD', factura: 'FAC', despacho: 'DSP' }[tipo];
    const id = nextId(prefix, year);
    const cliente = ctx.rng.pick(ctx.clientes);
    const vendedor = ctx.rng.pick(ctx.vendedores);
    const lineas = extra?.lineas || lineasAlAzar(ctx);
    const total = totalDe(lineas);
    const doc = {
      id, tipo, cliente_id: cliente.id, fecha: isoDate(fecha), created_at: fecha.toISOString(),
      estado: 'activo', total, moneda: 'USD', vendedor: vendedor.nombre, vendedor_id: vendedor.id,
      creado_por: vendedor.nombre, almacen_id: ctx.almacenPrincipal.id, empresa_id: ctx.empresaId,
      raiz_id: extra?.raizId || id, parent_id: extra?.parentId || null, has_child: false,
      estado_cobro: tipo === 'factura' ? 'pendiente' : null,
      estado_despacho: (tipo === 'factura') ? 'pendiente' : (tipo === 'despacho' ? 'entregado' : null),
      modalidad: ctx.rng.pick(['contado', 'credito']), tipo_entrega: ctx.rng.pick(['Retiro en tienda', 'Delivery propio']),
      tipo_factura: tipo === 'factura' ? ctx.rng.pick(['fiscal', 'nota_entrega']) : null,
      envio_entregado: tipo === 'despacho', version: 1,
      slug: id.toLowerCase() + '-' + ctx.rng.token(6), observaciones: '',
    };
    db.insert('documentos', [doc]);
    db.insert('documentos_items', lineas.map((l, i) => ({ id: `${id}-IT-${i + 1}`, documento_id: id, ...l })));
    if (extra?.parentId) db.update('documentos', r => r.id === extra.parentId, { has_child: true });
    return doc;
  }

  function generarDocumentos(ctx, numCadenas, numFacturas) {
    const db = window.__ssDemoDB;
    // Cadenas completas (para el flujo cotizacion -> orden -> factura -> despacho)
    for (let i = 0; i < numCadenas; i++) {
      const fecha = daysAgo(ctx.rng.int(1, 200));
      const lineas = lineasAlAzar(ctx);
      const cot = crearDocumento(ctx, 'cotizacion', fecha, { lineas });
      if (ctx.rng.chance(0.85)) {
        const orden = crearDocumento(ctx, 'orden', new Date(fecha.getTime() + 86400000), { lineas, raizId: cot.id, parentId: cot.id });
        if (ctx.rng.chance(0.85)) {
          const factura = crearDocumento(ctx, 'factura', new Date(fecha.getTime() + 2 * 86400000), { lineas, raizId: cot.id, parentId: orden.id });
          const pagada = ctx.rng.chance(0.6);
          db.update('documentos', r => r.id === factura.id, { estado_cobro: pagada ? 'pagada' : 'pendiente' });
          if (ctx.rng.chance(0.7)) {
            crearDocumento(ctx, 'despacho', new Date(fecha.getTime() + 3 * 86400000), { lineas, raizId: cot.id, parentId: factura.id });
            db.update('documentos', r => r.id === factura.id, { estado_despacho: 'entregado' });
          }
          if (pagada) crearCxCPagada(ctx, factura);
          else crearCxCPendiente(ctx, factura);
        }
      }
    }
    // Historico de facturas sueltas (para dashboard/reportes/CxC con volumen)
    for (let i = 0; i < numFacturas; i++) {
      const fecha = daysAgo(ctx.rng.int(0, 365));
      const factura = crearDocumento(ctx, 'factura', fecha);
      const pagada = ctx.rng.chance(0.55);
      db.update('documentos', r => r.id === factura.id, { estado_cobro: pagada ? 'pagada' : 'pendiente', estado_despacho: ctx.rng.chance(0.8) ? 'entregado' : 'pendiente' });
      if (pagada) crearCxCPagada(ctx, factura); else crearCxCPendiente(ctx, factura);
    }
  }

  function crearCxCPendiente(ctx, factura) {
    const db = window.__ssDemoDB;
    const vence = new Date(new Date(factura.created_at).getTime() + ctx.rng.int(15, 45) * 86400000);
    db.insert('cuentas_cobrar', [{
      id: 'CXC-' + factura.id, factura: factura.id, cliente_id: factura.cliente_id, empresa_id: ctx.empresaId,
      monto: factura.total, pagado: 0, vence: isoDate(vence), estado: 'pendiente', pagos: [],
      moneda: 'USD', tasa: 1, created_at: factura.created_at, fecha_emision: factura.fecha,
    }]);
  }
  function crearCxCPagada(ctx, factura) {
    const db = window.__ssDemoDB;
    const vence = new Date(new Date(factura.created_at).getTime() + ctx.rng.int(5, 20) * 86400000);
    db.insert('cuentas_cobrar', [{
      id: 'CXC-' + factura.id, factura: factura.id, cliente_id: factura.cliente_id, empresa_id: ctx.empresaId,
      monto: factura.total, pagado: factura.total, vence: isoDate(vence), estado: 'pagada',
      pagos: [{ id: 'PAG-' + factura.id, fecha: isoDate(vence), monto: factura.total, metodo: 'transferencia' }],
      moneda: 'USD', tasa: 1, created_at: factura.created_at, fecha_emision: factura.fecha,
    }]);
  }

  // ── Usuarios de acceso rapido de la demo (globales, ambas empresas) ─────────
  function buildUsuariosDemo() {
    const db = window.__ssDemoDB;
    const specs = [
      ['admin@demo.local', 'Alejandra Gomez', 'Administrador', null],
      ['gerente@demo.local', 'Roberto Suarez', 'Gerente de Operaciones', null],
      ['ventas@demo.local', 'Camila Rivas', 'Ventas', null],
      ['contadora@demo.local', 'Beatriz Herrera', 'Contadora', null],
      ['compras@demo.local', 'Diego Torres', 'Compras', null],
      ['almacen@demo.local', 'Manuel Ortiz', 'Almacen Central', null],
      ['driver@demo.local', 'Jesus Medina', 'Driver', null],
      ['cliente@demo.local', 'Cliente Demo', 'Cliente', 'demo1-CLI-001'],
    ];
    db.insert('usuarios', specs.map((s, i) => ({
      id: 'USR-' + (i + 1), auth_id: 'auth-' + (i + 1), email: s[0], nombre: s[1], rol: s[2],
      avatar: null, online: true, iniciales: s[1].split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase(),
      activo: true, cliente_id: s[3], empresas: ['demo1', 'demo2'], tiene_pin: false, telefono: '0412-1234567',
      pin_digitos: null, pin_prompt_omitido_en: null,
    })));
  }

  function buildDataset() {
    if (window.__ssDemoGenerator.built) return;
    window.__ssDemoGenerator.built = true;
    const rngLib = window.__ssDemoRng;
    const cat = window.__ssDemoCatalogos;
    const db = window.__ssDemoDB;

    db.insert('empresas', [
      { id: 'demo1', nombre: 'Distribuidora Demo 1', color: '#f97316', activo: true },
      { id: 'demo2', nombre: 'Suplementos Demo 2', color: '#94a3b8', activo: true },
    ]);

    buildEmpresa('demo1', 'Distribuidora Demo 1', '#f97316', rngLib.make(rngLib.SEED_DEMO1), cat, {
      almacenes: [['Almacen Principal Caracas', 'Caracas', 'ALC'], ['Sucursal Valencia', 'Valencia', 'ALV'], ['Sucursal Maracaibo', 'Maracaibo', 'ALM'], ['Showroom Caracas', 'Caracas', 'SHC'], ['Deposito Guarenas', 'Guarenas', 'ALG']],
      categorias: cat.CATEGORIAS_DEMO1, marcas: cat.MARCAS_DEMO1, productos: cat.PRODUCTOS_DEMO1,
      skuPrefix: 'D1', serialProb: 0.12, rubros: cat.RUBROS_CLIENTE_DEMO1,
      razonSocial: 'Distribuidora Demo 1, C.A.', rif: 'J-40123456-7', telefono: '0212-555-0101',
      email: 'no-reply@distribuidorademo.com', emailInfo: 'info@distribuidorademo.com',
      website: 'http://www.distribuidorademo.com', whatsapp: '+58 412-555-0101',
      dirFiscal: 'Av. Principal, Centro Empresarial Norte, Piso 3, Of. 3-B.', dirFiscal2: 'Zona Industrial La Yaguara.', ciudad: 'Caracas DC 1050',
      numVendedores: 6, numClientes: 55, numProveedores: 12, numBancos: 5,
      numCadenas: 14, numFacturasHistoricas: 140,
    });

    buildEmpresa('demo2', 'Suplementos Demo 2', '#94a3b8', rngLib.make(rngLib.SEED_DEMO2), cat, {
      almacenes: [['Almacen Principal Caracas', 'Caracas', 'SPC'], ['Sucursal Maracay', 'Maracay', 'SPM'], ['Deposito Valencia', 'Valencia', 'SPV']],
      categorias: cat.CATEGORIAS_DEMO2, marcas: cat.MARCAS_DEMO2, productos: cat.PRODUCTOS_DEMO2,
      skuPrefix: 'D2', serialProb: 0, rubros: cat.RUBROS_CLIENTE_DEMO2,
      razonSocial: 'Suplementos Demo 2, C.A.', rif: 'J-40987654-3', telefono: '0212-555-0202',
      email: 'no-reply@suplementosdemo.com', emailInfo: 'info@suplementosdemo.com',
      website: 'http://www.suplementosdemo.com', whatsapp: '+58 424-555-0202',
      dirFiscal: 'Av. Bolivar Norte, Centro Comercial Fitness Plaza, Local 12.', dirFiscal2: 'Zona Industrial Sur.', ciudad: 'Valencia, Carabobo',
      numVendedores: 4, numClientes: 40, numProveedores: 9, numBancos: 4,
      numCadenas: 10, numFacturasHistoricas: 90,
    });

    buildUsuariosDemo();

    // tasa de cambio: GLOBAL (no por empresa) — unas pocas filas historicas ancladas a hoy
    const tasaRows = [];
    let bcv = 178.4;
    for (let i = 6; i >= 0; i--) {
      bcv = round2(bcv + (i === 6 ? 0 : (i % 2 === 0 ? 0.6 : -0.2)));
      const paralelo = round2(bcv * 1.03);
      tasaRows.push({
        id: 'TASA-' + i, bcv, paralelo, cobertura: 0.95, vuelto: paralelo,
        created_at: daysAgo(i).toISOString(), source: 'demo',
      });
    }
    db.insert('tasa_cambio', tasaRows);

    console.log('[DemoData] Dataset generado — empresas: demo1, demo2');
  }

  window.__ssDemoGenerator = { build: buildDataset, built: false };
})();
