// POS: Compositor + Pipeline navegable (Cotización → Orden → Factura → Nota de Despacho)
const { useState, useMemo, useRef, useEffect } = React;

// Ítems REALES de un documento (doc.lines, mapeados desde documentos_items en
// supabase.js:518). ANTES esta función FABRICABA líneas pseudoaleatorias a partir
// del número del id — un mock del prototipo que hacía que Devoluciones y el portal
// del cliente mostraran productos inexistentes (o vacío cuando doc.items venía
// null → n=NaN). Ahora devuelve los ítems reales, sin las filas de sección.
function linesFor(doc) {
  return ((doc && doc.lines) || []).filter(l => l && l.sku && l.sku !== '__SECTION__');
}
window.linesFor = linesFor;

// ====================== Activity Log ======================
const ACT_LOG_KEY = 'ss-activity-log';
window.ssActivityLog = {
  _getAll() {
    try { return JSON.parse(localStorage.getItem(ACT_LOG_KEY) || '{}'); } catch(e) { return {}; }
  },
  add(docId, action, detail) {
    const all = this._getAll();
    if (!all[docId]) all[docId] = [];
    const user = window.__ssCurrentUser?.nombre || window.currentUserRole || 'Sistema';
    all[docId].unshift({
      id: Date.now() + '-' + Math.random().toString(36).slice(2),
      action, detail, user,
      ts: new Date().toISOString(),
    });
    if (all[docId].length > 100) all[docId] = all[docId].slice(0, 100);
    try { localStorage.setItem(ACT_LOG_KEY, JSON.stringify(all)); } catch(e) {}
  },
  getForDoc(docId) {
    return (this._getAll()[docId] || []);
  },
};

// ====================== Inventory helpers ======================
// ¿Puede registrar el cobro de una factura desde el módulo de facturas?
// Lo puede quien administra CxC (`cxc.editar`) y también quien tenga el permiso especial
// `pos_cobro`: un vendedor cobra lo que factura, pero no necesita la cartera completa de la
// empresa. Sin `canUser` (contextos sin permisos cargados) se deja pasar, como el resto del POS.
window.puedeCobrarFactura = function () {
  if (!window.canUser) return true;
  return window.canUser('editar', 'cxc') || window.canUser('crear', 'pos_cobro');
};

// Abrir un documento en el detalle del POS desde CUALQUIER módulo. La mecánica —dejarlo en
// `__ssPosOpenDoc`, navegar a la lista de SU etapa y avisar por evento— ya estaba copiada en el
// command palette y en el detalle de CxC; acá vive una sola vez.
// La ruta sale del TIPO del documento: no se puede asumir /facturas, el kardex referencia también
// despachos y órdenes. Devuelve false si el documento no existe o su tipo no tiene lista propia,
// para que el llamador avise en vez de dejar al usuario en una pantalla que no era.
window.abrirDocumentoPorId = async function (id) {
  if (!id) return false;
  const { data } = await window.sb.from('documentos').select('*').eq('id', id).maybeSingle();
  if (!data) return false;
  const RUTA = { cotizacion: '/cotizaciones', orden: '/ordenes', factura: '/facturas', despacho: '/despachos' };
  const ruta = RUTA[data.tipo];
  if (!ruta) return false;
  const doc = { ...data, cliente: data.cliente_id, total: parseFloat(data.total) || 0, lines: [] };
  window.__ssPosOpenDoc = doc;
  window.__ssNavigate?.(ruta);
  // El evento llega después de que POSPage montó; el drenaje de `__ssPosOpenDoc` cubre el caso
  // contrario (que monte después). Con los dos, el orden deja de importar.
  setTimeout(() => window.dispatchEvent(new CustomEvent('ss-open-doc', { detail: doc })), 60);
  return true;
};

window.getDisponible = function(sku, almacenId) {
  // Solo usar almacenes de la empresa activa (SSData.almacenes ya está filtrado en loadAppData)
  const almacenes = SSData.almacenes || [];
  const slot = (a) => (SSData.inventario[sku]?.[a] || {});
  let stock, reservado;
  if (almacenId) {
    stock     = slot(almacenId).cantidad  || 0;
    reservado = slot(almacenId).reservado || 0;
  } else {
    stock     = almacenes.reduce((s, a) => s + (slot(a.id).cantidad  || 0), 0);
    reservado = almacenes.reduce((s, a) => s + (slot(a.id).reservado || 0), 0);
  }
  // enOrden = reservado REAL de la tabla inventario (mantenido server-side por triggers y migrado
  // de Odoo reserved_quantity). ANTES se re-derivaba sumando las líneas de órdenes 'generada' en
  // memoria (ventana 90d), pero la investigación en Odoo confirmó que el 99.9% de esas órdenes
  // migradas YA fueron ENTREGADAS (picking 'done') → NO reservan. La reserva real son ~81 uds
  // (= inventario.reservado = Odoo). Re-derivar de las órdenes entregadas subestimaba disponible.
  // QUÉ órdenes retienen el stock ya NO se deriva de la memoria: lo responde el server con la RPC
  // `ordenes_con_reserva` (helper `window.ordenesConReserva`, componente `HoldDeOrdenes`), que ve
  // TODAS las órdenes y no solo las de una ventana. Este `ordenes: []` queda por compatibilidad con
  // quien lea el retorno; el POS no carga documentos.
  return { stock, enOrden: reservado, disponible: Math.max(0, stock - reservado), ordenes: [] };
};
const getDisponible = window.getDisponible;

// Almacén por defecto del POS. Antes era el literal 'alm-01' repetido por todo el archivo, un id
// que NO existe en `almacenes` (los reales son alm-alp, alm-alt, …): getDisponible devolvía 0 para
// todo y, como "solo con stock" viene activo, el catálogo abría VACÍO — y el <select> mostraba un
// almacén distinto del que tenía el estado. Se resuelve contra los almacenes reales de la empresa
// activa (SSData.almacenes ya viene filtrado): primero la Tienda, que es donde se vende de
// mostrador, y si no hay, el Principal.
// `preferido` (el almacén del documento que se edita, o el del borrador guardado) gana solo si
// existe de verdad, así un borrador viejo con 'alm-01' no revive el bug.
window.getAlmacenDefault = function getAlmacenDefault(preferido) {
  const alms = (window.SSData && window.SSData.almacenes) || [];
  if (preferido && alms.some(a => a.id === preferido)) return preferido;
  const porTipo = t => alms.find(a => String(a.tipo || '').toLowerCase() === t);
  return (porTipo('tienda') || porTipo('principal') || alms[0] || {}).id || '';
};
const getAlmacenDefault = window.getAlmacenDefault;

// Stock físico en OTROS almacenes (≠ almacenId), solo cantidad > 0, ordenado desc.
// Sirve para indicarle al vendedor dónde está la pieza (transferir o avisar al cliente).
window.getStockOtrosAlmacenes = function(sku, almacenId) {
  const almNombres = Object.fromEntries((SSData.almacenes || []).map(a => [a.id, a.nombre]));
  const invSku = (SSData.inventario || {})[sku] || {};
  return Object.entries(invSku)
    .filter(([aid, v]) => aid !== almacenId && (v?.cantidad ?? 0) > 0)
    .map(([aid, v]) => ({ id: aid, nombre: almNombres[aid] || aid, cantidad: v.cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad);
};
const getStockOtrosAlmacenes = window.getStockOtrosAlmacenes;

// TODOS los almacenes con stock físico > 0 para un SKU (incluye el activo).
// activeId va primero, luego por cantidad desc. Sirve para mostrar siempre dónde está la pieza.
window.getStockTodosAlmacenes = function(sku, activeId) {
  const almNombres = Object.fromEntries((SSData.almacenes || []).map(a => [a.id, a.nombre]));
  const invSku = (SSData.inventario || {})[sku] || {};
  return Object.entries(invSku)
    .filter(([aid, v]) => (v?.cantidad ?? 0) > 0)
    .map(([aid, v]) => ({ id: aid, nombre: almNombres[aid] || aid, cantidad: v.cantidad }))
    .sort((a, b) => ((b.id === activeId) - (a.id === activeId)) || (b.cantidad - a.cantidad));
};
const getStockTodosAlmacenes = window.getStockTodosAlmacenes;

function getNextFacturaId(tipo) {
  const key    = tipo === 'fiscal' ? 'ss-fac-counter' : 'ss-ndf-counter';
  const prefix = tipo === 'fiscal' ? 'FAC' : 'NDF';
  const n = parseInt(localStorage.getItem(key) || '0') + 1;
  localStorage.setItem(key, String(n));
  return prefix + '-' + String(n).padStart(6, '0');
}

// ====================== Flying doc animation ======================
function FlyingDoc({ startX, startY, endX, endY, onDone }) {
  const ref = useRef(null);
  const animName = `ssfly_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const dx = endX - startX;
    const dy = endY - startY;
    const ax = dx * 0.5;
    const ay = Math.min(dy * 0.3 - 80, -60);
    const s = document.createElement('style');
    s.textContent = `@keyframes ${animName}{0%{transform:translate(0,0)scale(1);opacity:1}55%{transform:translate(${ax}px,${ay}px)scale(1.3);opacity:1}100%{transform:translate(${dx}px,${dy}px)scale(.12);opacity:0}}`;
    document.head.appendChild(s);
    el.style.animation = `${animName} .72s cubic-bezier(.4,0,.2,1) forwards`;
    const t = setTimeout(onDone, 780);
    return () => { clearTimeout(t); if (s.parentNode) s.parentNode.removeChild(s); };
  }, []);

  return (
    <div ref={ref} style={{
      position:'fixed', left:startX, top:startY, zIndex:9999,
      pointerEvents:'none', width:30, height:30, borderRadius:7,
      background:'var(--brand)', color:'#fff', display:'grid',
      placeItems:'center', boxShadow:'0 4px 16px rgba(0,0,0,.3)',
    }}>
      <Icon name="doc" size={15}/>
    </div>
  );
}

// ====================== LocalStorage ======================
// Borrador de cotización segmentado por empresa (multi-tenant): evita que el
// borrador de una empresa se cargue en el composer de otra al cambiar de tenant.
function lsKey() {
  let emp = window.currentEmpresa;
  if (!emp) { try { emp = localStorage.getItem('ss-empresa-activa'); } catch {} }
  return `ss-pos-cart-${emp || 'demo1'}`;
}
function lsLoad() {
  try { const s = localStorage.getItem(lsKey()); return s ? JSON.parse(s) : null; }
  catch { return null; }
}
function lsSave(v) { try { localStorage.setItem(lsKey(), JSON.stringify(v)); } catch {} }
function lsClear() { try { localStorage.removeItem(lsKey()); } catch {} }

// Hora local (Caracas) de un timestamp (created_at) → "HH:MM". '' si no hay.
// d.fecha solo guarda la fecha (YYYY-MM-DD); la hora de creación vive en created_at.
function fmtHora(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' });
  } catch { return ''; }
}

// Fecha DD/MM/YYYY (solo lista de documentos). Parseo manual de 'YYYY-MM-DD' para
// evitar el corrimiento de día por timezone que produce new Date('YYYY-MM-DD').
function fmtFechaDMY(s) {
  if (!s) return '';
  const str = String(s).substring(0, 10);
  const [y, m, d] = str.split('-').map(Number);
  if (!y || !m || !d) return str;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

// Vista plana de items no entregados: aplana `items_faltantes` de las incidencias
// (creadas por DeliveryFlowModal en drivers.jsx cuando el driver entrega menos de
// lo esperado) para que el almacenista vea de un vistazo qué faltó y de qué
// despacho/orden, sin entrar incidencia por incidencia.
function ItemsNoEntregadosTable({ docs, onOpen }) {
  // Se deriva de TODAS las incidencias no resueltas (ya scope-eadas por empresa en SSData), no de la
  // página cargada — con paginación server-side `docs` es solo la página visible (≤50) y perdería
  // incidencias de despachos fuera de página. El despacho se carga on-demand al abrir la fila.
  const rows = React.useMemo(() => {
    const out = [];
    (SSData.incidencias || []).forEach(inc => {
      if (inc.estado === 'resuelto') return;
      (inc.items_faltantes || []).forEach(it => {
        out.push({
          incidenciaId: inc.id, despachoId: inc.despacho_id, clienteId: inc.cliente_id,
          estadoIncidencia: inc.estado, fecha: inc.fecha,
          sku: it.sku, nombre: it.nombre, esperado: it.esperado, entregado: it.entregado,
          faltante: (it.esperado || 0) - (it.entregado || 0),
        });
      });
    });
    return out.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  }, [SSData.incidencias]);

  // Abrir el despacho de la fila: se busca primero en la página cargada; si no está, se pide a Supabase.
  const openDespacho = React.useCallback(async (despachoId) => {
    const inPage = (docs || []).find(d => d.id === despachoId);
    if (inPage) { onOpen(inPage); return; }
    const { data } = await window.sb.from('documentos').select('*').eq('id', despachoId).maybeSingle();
    if (data) onOpen({ ...data, cliente: data.cliente_id, total: parseFloat(data.total) || 0, lines: [] });
  }, [docs, onOpen]);

  const estadoLabel = { pendiente: 'Pendiente', en_proceso: 'En proceso' };
  const estadoColor = { pendiente: '#dc2626', en_proceso: '#d97706' };

  // Paginación (estándar #2). localStorage: ss-docs-noentregados-pagesize · 50/100/200.
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(() => {
    const v = parseInt(localStorage.getItem('ss-docs-noentregados-pagesize'));
    return [50,100,200].includes(v) ? v : 50;
  });
  React.useEffect(() => { localStorage.setItem('ss-docs-noentregados-pagesize', String(pageSize)); }, [pageSize]);
  React.useEffect(() => { setPage(1); }, [rows.length, pageSize]);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const startIdx   = (safePage - 1) * pageSize;
  const pageRows   = rows.slice(startIdx, startIdx + pageSize);

  return (
    <div>
    <div className="tbl-scroll">
      <table className="tbl">
        <thead>
          <tr>
            <th>Despacho</th><th>Cliente</th><th className="hide-sm">SKU</th><th>Producto</th>
            <th className="num hide-sm">Esperado</th><th className="num hide-sm">Entregado</th><th className="num">Faltante</th>
            <th className="hide-sm">Incidencia</th><th className="hide-sm">Fecha</th><th style={{width:36}}></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={10} className="empty">Sin items pendientes por entregar</td></tr>}
          {pageRows.map((r, i) => {
            const cli = SSData.clientes.find(c => c.id === r.clienteId);
            return (
              <tr key={r.incidenciaId + '-' + r.sku + '-' + i} style={{cursor:'pointer'}} onClick={() => openDespacho(r.despachoId)}>
                <td className="mono-cell" style={{fontWeight:500}}>{r.despachoId}</td>
                <td>{cli?.nombre || '—'}</td>
                <td className="mono-cell hide-sm">{r.sku}</td>
                <td>{r.nombre}</td>
                <td className="num hide-sm">{r.esperado}</td>
                <td className="num hide-sm">{r.entregado}</td>
                <td className="num" style={{fontWeight:700, color:'#dc2626'}}>{r.faltante}</td>
                <td className="hide-sm">
                  <span className="chip" style={{background:(estadoColor[r.estadoIncidencia]||'#64748b')+'18', color:estadoColor[r.estadoIncidencia]||'#64748b'}}>
                    <span className="chip-dot" style={{background:estadoColor[r.estadoIncidencia]||'#64748b'}}/>
                    {estadoLabel[r.estadoIncidencia] || r.estadoIncidencia}
                  </span>
                </td>
                <td className="muted hide-sm">{fmtFechaDMY(r.fecha)}</td>
                <td><button className="icon-btn" style={{width:26,height:26}} onClick={e=>{e.stopPropagation(); openDespacho(r.despachoId);}}><Icon name="chevronR" size={13}/></button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    {rows.length > 0 && (
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10, padding:'10px 16px', borderTop:'1px solid var(--border)', fontSize:12}}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <span className="muted">
            {rows.length} item{rows.length===1?'':'s'} · mostrando {startIdx+1}–{Math.min(startIdx+pageSize, rows.length)}
          </span>
          <select className="select" value={pageSize} onChange={e => { setPageSize(parseInt(e.target.value)); setPage(1); }} style={{fontSize:12, padding:'3px 6px'}}>
            {[50,100,200].map(n => <option key={n} value={n}>{n} / pág.</option>)}
          </select>
        </div>
        {totalPages > 1 && (
          <div style={{display:'flex', gap:4, alignItems:'center'}}>
            <button className="btn ghost sm" disabled={safePage===1} onClick={() => setPage(p => Math.max(1, p-1))}><Icon name="chevronL" size={13}/></button>
            <span className="muted" style={{padding:'0 6px'}}>Página {safePage} de {totalPages}</span>
            <button className="btn ghost sm" disabled={safePage===totalPages} onClick={() => setPage(p => Math.min(totalPages, p+1))}><Icon name="chevronR" size={13}/></button>
          </div>
        )}
      </div>
    )}
    </div>
  );
}

// ====================== Modal: Pedido por Voz ======================
function VoiceOrderModal({ onClose, onApply, allProductos, allClientes, apiKey }) {
  const [phase, setPhase] = React.useState('idle');
  const [liveText, setLiveText] = React.useState('');
  const [transcript, setTranscript] = React.useState('');
  const [parsed, setParsed] = React.useState(null);
  const [errorMsg, setErrorMsg] = React.useState('');
  const recognRef     = React.useRef(null);
  const finalRef      = React.useRef('');
  const interimRef    = React.useRef('');
  const userStoppedRef = React.useRef(false);  // true cuando el usuario clickea Detener
  const restartCountRef = React.useRef(0);     // contador anti-loop infinito

  const supported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  async function startRec() {
    if (!supported) { setErrorMsg('Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge.'); setPhase('error'); return; }
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
      }
    } catch (err) {
      setErrorMsg('Permiso de micrófono denegado. Habilítalo en el candado de la barra de direcciones.');
      setPhase('error');
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.lang = 'es-ES'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    finalRef.current = '';
    interimRef.current = '';
    userStoppedRef.current = false;
    restartCountRef.current = 0;
    r.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) { finalRef.current += e.results[i][0].transcript + ' '; interimRef.current = ''; }
        else interim = e.results[i][0].transcript;
      }
      interimRef.current = interim;
      setLiveText(finalRef.current + interim);
    };
    r.onerror = e => {
      console.error('[VoiceOrder] SpeechRecognition error:', e.error, e);
      // no-speech y aborted son transitorios — onend los manejará
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setErrorMsg('Permiso de micrófono denegado. Habilítalo en el candado de la barra de direcciones.');
      } else if (e.error === 'audio-capture') {
        setErrorMsg('No se detectó micrófono. Verifica que esté conectado y activo.');
      } else if (e.error === 'network') {
        setErrorMsg('Error de red. El reconocimiento de voz requiere conexión a Internet.');
      } else if (e.error === 'language-not-supported') {
        setErrorMsg('Idioma no soportado por el navegador.');
      } else {
        setErrorMsg('Error de audio: ' + e.error);
      }
      setPhase('error');
    };
    r.onend = () => {
      const txt = (finalRef.current + interimRef.current).trim();
      // Si el usuario NO clickeó Detener y no hay texto → Chrome cerró por no-speech: reiniciamos
      if (!userStoppedRef.current && !txt) {
        if (restartCountRef.current < 30) {  // limit: ~5 min asumiendo 10s por sesión
          restartCountRef.current++;
          console.log('[VoiceOrder] no-speech timeout, reiniciando sesión (', restartCountRef.current, ')');
          try { r.start(); return; } catch (err) { console.error('[VoiceOrder] re-start falló:', err); }
        } else {
          console.warn('[VoiceOrder] Máximo de reintentos alcanzado, parando.');
        }
        setPhase('idle');
        return;
      }
      if (!txt) { setPhase('idle'); return; }
      setTranscript(txt);
      setPhase('processing');
      parseTranscript(txt);
    };
    recognRef.current = r;
    try {
      r.start();
      setPhase('recording');
      setLiveText('');
    } catch (err) {
      console.error('[VoiceOrder] start() falló:', err);
      setErrorMsg('No se pudo iniciar el reconocimiento: ' + (err.message || err.name || 'error desconocido'));
      setPhase('error');
    }
  }

  function stopRec() {
    userStoppedRef.current = true;
    recognRef.current?.stop();
  }

  async function parseTranscript(text) {
    const empresaId = window.currentEmpresa;
    if (!empresaId) { setErrorMsg('No hay empresa activa.'); setPhase('error'); return; }
    const words = text.toLowerCase().split(/[\s,]+/).filter(w => w.length > 2);

    // Filtrar productos relevantes (fonética incluida)
    const filtered = allProductos.filter(p =>
      words.some(w => p.nombre.toLowerCase().includes(w) || p.sku.toLowerCase().includes(w) ||
        (p.marca||'').toLowerCase().includes(w) || (p.categoria||'').toLowerCase().includes(w))
    );
    const prodsToSend = (filtered.length > 0 ? filtered : allProductos).slice(0, 350);

    // Filtrar clientes relevantes por palabras de la transcripción, fallback a todos
    const filteredCli = (allClientes||[]).filter(c =>
      words.some(w => c.nombre.toLowerCase().includes(w) || (c.rif||'').toLowerCase().includes(w))
    );
    const clientesToSend = (filteredCli.length > 0 ? filteredCli : (allClientes||[])).slice(0, 150);

    const prompt = `Eres un asistente de punto de venta para una empresa de seguridad electrónica en Venezuela.
El usuario habló por micrófono y el sistema transcribió su voz — puede haber errores fonéticos típicos del español venezolano.

TRANSCRIPCIÓN: "${text}"

Extrae tres cosas:

━━ 1. PRODUCTOS Y CANTIDADES ━━
Solo incluye SKUs que existan EXACTAMENTE en la lista de abajo. Si no especifica cantidad, asume 1.
Considera errores fonéticos comunes: "hick vision"=Hikvision, "dahúa"=Dahua, "tplink"=TP-Link, "ruter"=router, "poe"=PoE, "cámara bala"=bullet, "domo"=domo, "cuatro canales"=4ch, etc.
Si el modelo es ambiguo (ej. "cámara Hikvision 5MP" sin modelo específico), elige el más probable y anótalo en notas.

PRODUCTOS DISPONIBLES (SKU | Nombre | Marca | Categoría):
${prodsToSend.map(p => `${p.sku} | ${p.nombre}${p.marca?' | '+p.marca:''}${p.categoria?' | '+p.categoria:''}`).join('\n')}

━━ 2. CLIENTE ━━
Si la transcripción menciona un cliente (empresa, razón social o persona), encuéntralo en la lista y devuelve su ID exacto.
Considera errores fonéticos en nombres propios (ej. "vos te digital"="Voice Digital", "thunder net"="Thundernet").
Si no hay coincidencia clara, devuelve null.

CLIENTES DISPONIBLES (ID | Nombre):
${clientesToSend.map(c => `${c.id} | ${c.nombre}`).join('\n')}

━━ 3. MODALIDAD DE PAGO ━━
Mapea exactamente a uno de estos valores (o null si no se menciona):
- "bcv"          → BCV cobertura, tasa BCV más cobertura, BCV más porcentaje
- "bcv_fijo"     → nota BCV, nota mercado libre, ML, tasa BCV exacta, BCV sin cobertura, BCV fijo
- "paralelo"     → paralelo, tasa paralela, dólar paralelo
- "divisas"      → divisas, dólares, USD, dólar efectivo
- "efectivo_bs"  → efectivo bolívares, cash bs
- "efectivo_usd" → efectivo dólares, cash dólares
- "transferencia"→ transferencia, transferir

Responde ÚNICAMENTE con JSON válido, sin markdown ni texto adicional:
{"items":[{"sku":"SKU exacto","qty":número}],"clienteId":"ID exacto o null","modalidadPago":"valor exacto o null","notas":"texto breve sobre ambigüedades o null"}`;

    try {
      // Reusa la key publicada por supabase.js — nunca copiar el literal acá otra vez: ya pasó
      // que esta copia quedó con la anon key legacy mientras la fuente única se actualizaba.
      const res = await fetch(`${window.SUPABASE_URL}/functions/v1/ai-proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}`,
          'apikey': window.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ empresa_id: empresaId, prompt }),
      });
      const json = await res.json();
      if (!json.success) {
        if (json.error === 'NO_API_KEY') throw new Error('No hay clave de API de Claude configurada. Configúrala en Ajustes → Sistema → IA.');
        throw new Error(json.error || 'HTTP ' + res.status);
      }
      const raw = json.data?.content?.[0]?.text || '';
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Respuesta inesperada de la IA');
      setParsed(JSON.parse(match[0]));
      setPhase('result');
    } catch (e) {
      setErrorMsg('Error al procesar con IA: ' + e.message);
      setPhase('error');
    }
  }

  function retry() { setPhase('idle'); setLiveText(''); setParsed(null); setErrorMsg(''); setTranscript(''); }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{width: 520, maxWidth:'98vw', maxHeight:'90vh', overflowY:'auto'}}>
        <div className="modal-head">
          <div style={{display:'flex', alignItems:'center', gap:10}}>
            <Icon name="mic" size={18} style={{color:'var(--danger)'}}/>
            <span className="modal-title">Pedido por voz</span>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body" style={{display:'flex', flexDirection:'column', gap:16}}>

          {(phase === 'idle' || phase === 'recording') && (
            <div style={{textAlign:'center', padding:'12px 0'}}>
              <div style={{marginBottom:16, fontSize:13, color:'var(--text-muted)', lineHeight:1.55}}>
                {phase === 'idle'
                  ? 'Dicta los productos y cantidades a agregar al carrito. Ejemplo: "Agregar 3 cámaras Dahua bullet y 2 cables UTP 100 metros".'
                  : 'Escuchando… Habla con claridad y haz clic en Detener al terminar.'}
              </div>
              <button
                onClick={phase === 'idle' ? startRec : stopRec}
                disabled={!supported}
                style={{
                  width:72, height:72, borderRadius:'50%', border:'none', cursor:'pointer',
                  background: phase === 'recording' ? 'var(--danger)' : 'var(--brand)',
                  color:'#fff', display:'grid', placeItems:'center',
                  animation: phase === 'recording' ? 'voice-pulse 1.4s ease-in-out infinite' : 'none',
                  transition:'background .2s',
                  opacity: supported ? 1 : 0.4,
                }}>
                <Icon name="mic" size={28}/>
              </button>
              <div style={{marginTop:10, fontSize:12, color:'var(--text-subtle)'}}>
                {phase === 'idle' ? (supported ? 'Clic para grabar' : 'Usa Chrome o Edge') : 'Clic para detener'}
              </div>
              {phase === 'recording' && liveText && (
                <div style={{marginTop:14, padding:'10px 14px', background:'var(--bg-sunken)', borderRadius:8, textAlign:'left', fontSize:13, lineHeight:1.5, border:'1px solid var(--border)', minHeight:52}}>
                  {liveText}
                </div>
              )}
            </div>
          )}

          {phase === 'processing' && (
            <div style={{textAlign:'center', padding:'24px 0'}}>
              <div style={{fontSize:14, marginBottom:10, fontWeight:500}}>Procesando con IA…</div>
              <div className="small muted" style={{fontStyle:'italic'}}>"{transcript}"</div>
            </div>
          )}

          {phase === 'error' && (
            <div>
              <div style={{color:'var(--danger)', fontSize:13, marginBottom:12, padding:'10px 12px', background:'var(--danger-soft)', borderRadius:8}}>
                {errorMsg}
              </div>
              {transcript && <div className="small muted" style={{marginBottom:12}}>Transcripción: "{transcript}"</div>}
              <button className="btn secondary" onClick={retry}>Reintentar</button>
            </div>
          )}

          {phase === 'result' && parsed && (() => {
            const foundItems = (parsed.items || []).map(item => {
              const p = allProductos.find(pp => pp.sku === item.sku);
              return { ...item, nombre: p?.nombre || '(producto no encontrado)', found: !!p };
            });
            const validItems   = foundItems.filter(i => i.found);
            const invalidItems = foundItems.filter(i => !i.found);
            const clienteDet   = parsed.clienteId ? (allClientes||[]).find(c => c.id === parsed.clienteId) : null;
            const modalLabels  = { bcv:'BCV (Tasa Oficial)', bcv_fijo:'Nota BCV (BCV exacto)', paralelo:'Paralelo', divisas:'Divisas USD', efectivo_bs:'Efectivo Bs.', efectivo_usd:'Efectivo USD', transferencia:'Transferencia' };
            return (
              <div style={{display:'flex', flexDirection:'column', gap:12}}>
                <div className="small muted" style={{fontStyle:'italic', padding:'8px 12px', background:'var(--bg-sunken)', borderRadius:6, lineHeight:1.45}}>
                  "{transcript}"
                </div>

                {/* Cliente y modalidad detectados */}
                {(clienteDet || parsed.modalidadPago) && (
                  <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                    {clienteDet && (
                      <div style={{display:'flex', alignItems:'center', gap:6, padding:'5px 10px', borderRadius:6, background:'var(--brand-soft)', border:'1px solid var(--brand)', fontSize:12}}>
                        <Icon name="clients" size={12} style={{color:'var(--brand)'}}/>
                        <span style={{color:'var(--brand)', fontWeight:600}}>Cliente:</span>
                        <span>{clienteDet.nombre}</span>
                      </div>
                    )}
                    {parsed.modalidadPago && (
                      <div style={{display:'flex', alignItems:'center', gap:6, padding:'5px 10px', borderRadius:6, background:'var(--success-soft,#d1fae5)', border:'1px solid var(--success,#10b981)', fontSize:12}}>
                        <Icon name="dollar" size={12} style={{color:'var(--success,#10b981)'}}/>
                        <span style={{color:'var(--success,#10b981)', fontWeight:600}}>Modalidad:</span>
                        <span>{modalLabels[parsed.modalidadPago] || parsed.modalidadPago}</span>
                      </div>
                    )}
                  </div>
                )}

                {foundItems.length === 0 ? (
                  <div style={{padding:'20px 16px', textAlign:'center', background:'var(--warn-soft)', border:'1px solid var(--warn)', borderRadius:8, fontSize:13, color:'var(--warn)'}}>
                    <Icon name="info" size={14}/> No se identificaron productos. Probá nombrar el modelo, marca o SKU con más claridad.
                  </div>
                ) : (
                  <div>
                    <div className="small muted" style={{marginBottom:6, display:'flex', justifyContent:'space-between'}}>
                      <span>Productos detectados</span>
                      <span style={{color: validItems.length > 0 ? 'var(--success)' : 'var(--danger)', fontWeight:600}}>
                        {validItems.length} se agregarán al carrito{invalidItems.length > 0 ? ` · ${invalidItems.length} no encontrados` : ''}
                      </span>
                    </div>
                    <div style={{display:'flex', flexDirection:'column', gap:4, maxHeight:260, overflowY:'auto'}}>
                      {foundItems.map((item, i) => (
                        <div key={i} style={{display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderRadius:7, background: item.found ? 'var(--bg-sunken)' : 'var(--danger-soft)', border:`1px solid ${item.found ? 'var(--border)' : 'var(--danger)'}`, fontSize:13}}>
                          <span style={{fontWeight:700, minWidth:32, textAlign:'center', color: item.found ? 'var(--brand)' : 'var(--danger)'}}>{item.qty}×</span>
                          <div style={{flex:1, minWidth:0}}>
                            <div style={{fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{item.nombre}</div>
                            <div style={{fontSize:10.5, fontFamily:'var(--mono)', color:'var(--text-muted)'}}>{item.sku}</div>
                          </div>
                          {!item.found && <span style={{fontSize:11, color:'var(--danger)', flexShrink:0, fontWeight:600}}>SKU no encontrado</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {parsed.notas && (
                  <div style={{fontSize:12, color:'var(--text-muted)', fontStyle:'italic', padding:'7px 10px', background:'var(--warn-soft)', borderRadius:6, border:'1px solid var(--warn)'}}>
                    ⚠ {parsed.notas}
                  </div>
                )}

                <div style={{display:'flex', gap:8, justifyContent:'flex-end', paddingTop:4, borderTop:'1px solid var(--border)'}}>
                  <button className="btn ghost" onClick={retry}>Grabar de nuevo</button>
                  <button className="btn primary" onClick={() => { onApply(parsed); onClose(); }} disabled={validItems.length === 0}>
                    <Icon name="plus" size={13}/>Aplicar al carrito
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ═══ Un documento se CONGELA cuando la etapa siguiente ya existe ══════════════
// Regla del negocio (2026-08-19). El flujo son cuatro documentos —cotización → orden → factura →
// despacho— y cada uno queda amarrado al que le sigue. En cuanto un documento tiene su hijo vivo,
// lo que hay que corregir es el HIJO, no él: editarlo lo deja diciendo algo distinto de lo que ya
// está comprometido aguas abajo, y nadie se entera. Es exactamente lo que pasó con S38323 — la
// cotización se editó DESPUÉS de haberse convertido y su orden se quedó con la versión vieja: la
// pantalla mostraba 3 productos y la orden, 1.
//
// EL DATO ES `documentos.has_child`, que mantiene el trigger `trg_documentos_has_child` ("tiene al
// menos un hijo vivo colgando por `documento_origen_id`, con estado fuera de cancelada/anulada").
// Se verificó contra el linaje en las tres etapas y **no hay una sola discrepancia** (0 cotizaciones
// y 0 facturas con hijo vivo marcadas en false), así que no hace falta un segundo criterio ni un
// viaje extra para pintar la lista.
//
// A propósito NO mira el TIPO del hijo. Que una cotización tenga colgado un despacho en vez de una
// orden (2 casos, migrados) no la hace más editable: hubo mercancía que salió contra ese linaje.
// El despacho no congela a nadie porque es el final del flujo: no tiene etapa siguiente.
const SIGUIENTE_ETAPA = { cotizacion: 'orden', orden: 'factura', factura: 'despacho' };
const ROTULO_ETAPA    = { orden: 'una orden', factura: 'una factura', despacho: 'un despacho' };
const ROTULO_DOC      = { cotizacion: 'Esta cotización', orden: 'Esta orden', factura: 'Esta factura' };

window.ssDocCongelado = function (doc) {
  if (!doc) return false;
  const t = doc.tipo || doc.estado || '';
  if (!SIGUIENTE_ETAPA[t]) return false;      // despacho (o algo que no es del flujo): nada que congelar
  return doc.has_child === true;
};

// El motivo, en el idioma del usuario. Vive acá al lado del predicado para que el aviso de la lista,
// el del detalle y el error del guardado no se puedan separar de la regla que los produce.
window.ssMotivoCongelado = function (doc) {
  const t = doc?.tipo || doc?.estado || '';
  const sig = SIGUIENTE_ETAPA[t];
  if (!sig) return '';
  return `${ROTULO_DOC[t] || 'Este documento'} ya generó ${ROTULO_ETAPA[sig]} y no se puede editar. `
       + `Si hay que corregir algo, se corrige en ${sig === 'orden' ? 'la orden' : sig === 'factura' ? 'la factura' : 'el despacho'}.`;
};

// ====================== Página principal POS ======================
// subRoute: '' | 'cotizaciones' | 'ordenes' | 'despachos' | 'facturas'
window.POSPage = function POSPage({ subRoute }) {
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [editingDoc, setEditingDoc]   = useState(null);
  // Pedido explícito: navegar con flechas entre los documentos de la MISMA tabla filtrada, sin
  // volver a salir a la lista. Se guardan los ids de la página que estaba filtrada al abrir el
  // documento (no toda la etapa) — "puede que ese filtro tenga 6 documentos", el caso de uso es
  // un conjunto chico que ya cabe en una página.
  const [navCtx, setNavCtx] = useState(null); // { ids: [...] } | null

  // Solo limpiar selectedDoc al cambiar de stage — editingDoc se limpia en openList/backToCompose
  // Effect C — subRoute reset (must be declared FIRST)
  useEffect(() => { setSelectedDoc(null); }, [subRoute]);
  // Effect A — mount-only global drain
  useEffect(() => {
    if (window.__ssPosOpenDoc) {
      setSelectedDoc(window.__ssPosOpenDoc);
      window.__ssPosOpenDoc = null;
    }
  }, []);
  // Effect B — persistent ss-open-doc listener
  // `editingDoc` gana en el render de abajo, así que abrir un documento SIN soltar el compositor
  // dejaba la pantalla exactamente igual: el botón "Ver orden · ORD-…" del compositor navegaba y
  // no pasaba nada (reportado el 2026-08-11). Y se drena `__ssPosOpenDoc`: lo deja puesto quien
  // dispara el evento, y si nadie lo limpia el próximo montaje de POSPage reabre un documento viejo.
  useEffect(() => {
    function handler(e) { setEditingDoc(null); setSelectedDoc(e.detail); window.__ssPosOpenDoc = null; }
    window.addEventListener('ss-open-doc', handler);
    return () => window.removeEventListener('ss-open-doc', handler);
  }, []);

  const SUB_TO_STAGE  = { cotizaciones:'cotizacion', ordenes:'orden', despachos:'despacho', facturas:'factura' };
  const STAGE_TO_PATH = { cotizacion:'/cotizaciones', orden:'/ordenes', despacho:'/despachos', factura:'/facturas' };

  const listStage = SUB_TO_STAGE[subRoute] || null;
  const EDITABLE  = ['cotizacion', 'orden', 'despacho', 'factura'];
  const [editingDespacho, setEditingDespacho] = useState(null);

  function openList(stage) {
    window.__ssNavigate && window.__ssNavigate(STAGE_TO_PATH[stage]);
    setSelectedDoc(null); setEditingDoc(null);
  }
  function openDetail(doc, navInfo) { setSelectedDoc(doc); setEditingDoc(null); setNavCtx(navInfo || null); }
  function backToList()    { setSelectedDoc(null); setNavCtx(null); }
  // Ir al documento anterior/siguiente DENTRO del mismo filtro (navCtx.ids), sin volver a la
  // tabla. Reusa el mismo mecanismo que ya movía `selectedDoc` al promover/cancelar un documento
  // (DocumentDetail no se desmonta: solo cambia `doc.id` y su propio efecto vuelve a pedir el
  // detalle completo — ver `getDocumentoDetalle` en DocumentDetail).
  function gotoSibling(delta) {
    if (!navCtx || !Array.isArray(navCtx.ids) || !selectedDoc) return;
    const i = navCtx.ids.indexOf(selectedDoc.id);
    if (i === -1) return;
    const j = i + delta;
    if (j < 0 || j >= navCtx.ids.length) return;
    setSelectedDoc({ id: navCtx.ids[j] });
  }
  function backToCompose() {
    window.__ssNavigate && window.__ssNavigate('/pos');
    setSelectedDoc(null); setEditingDoc(null);
    try { sessionStorage.removeItem('ss-pos-docs-search'); } catch {}
  }
  async function startEdit(docOriginal)  {
    let doc = docOriginal;
    const stage = doc.tipo || doc.estado || '';
    // La fila de la lista viene PROYECTADA (solo lo que pinta la tabla), así que para editar se
    // pide la completa: el composer guarda observaciones, direcciones, términos, tasas… y con la
    // proyectada las habría borrado al guardar.
    const completo = await window.cargarDocumentoCompleto?.(doc.id);
    if (completo) doc = { ...doc, ...completo };
    // Esa fila completa trae un `has_child` FRESCO, así que acá sale gratis frenar el caso que la
    // lista no puede ver: la página se pintó hace media hora y mientras tanto alguien convirtió el
    // documento en otra pestaña. Avisar antes de abrir el compositor es mejor que dejar rehacer todo
    // el carrito para chocar recién contra el candado del guardado.
    if (window.ssDocCongelado(doc)) { alert(window.ssMotivoCongelado(doc)); return; }
    // CRÍTICO: el listado es headers-only (`lines: []`), así que las líneas se cargan on-demand
    // ANTES de editar. Sin esto, editar abriría el carrito VACÍO y al guardar updateDocumento
    // BORRARÍA todas sus líneas.
    let lines = doc.lines || [];
    if (!lines.length && window.loadDocumentoItems) {
      lines = await window.loadDocumentoItems(doc.id) || [];
    }
    const fresh = { ...doc, lines };
    if (stage === 'cotizacion' || stage === 'orden') {
      // Edición completa en el composer POS
      window.__ssNavigate && window.__ssNavigate('/pos');
      setSelectedDoc(null);
      setEditingDoc(fresh);
    } else {
      // Despacho / factura: edición rápida con modal
      setEditingDespacho(fresh);
    }
  }

  const despachoModal = editingDespacho && (
    <EditDespachoModal
      doc={editingDespacho}
      onClose={() => setEditingDespacho(null)}
      onSaved={async () => {
        const editedId = editingDespacho.id;
        await window.loadAppData?.();
        // Refrescar SOLO el doc editado (la lista es server-side y puede no estar en la página actual)
        const { data: fresh } = await window.sb.from('documentos').select('*').eq('id', editedId).maybeSingle();
        if (fresh && selectedDoc?.id === editedId) setSelectedDoc(fresh);
        window.dispatchEvent(new Event('ss-doc-version-bump'));
        setEditingDespacho(null);
      }}
    />
  );

  if (subRoute === 'flujo')
    return <>{despachoModal}<PipelineHubPage onOpenList={openList} onBack={backToCompose} /></>;
  if (editingDoc)
    // Bug real: `editingDoc.estado` es el SUB-estado ('creada', 'generada', 'convertida'…), no la
    // etapa — `STAGE_TO_PATH` solo conoce 'cotizacion'/'orden'/'despacho'/'factura'. Con `.estado`,
    // `openList` recibía un valor que no mapea a ninguna ruta y `window.__ssNavigate(undefined)` no
    // hacía nada: el botón "Cancelar edición" (arriba del carrito) se veía muerto. Es `.tipo`.
    return <POSCompose onOpenList={openList} editingDoc={editingDoc} onEditDone={() => openList(editingDoc.tipo || editingDoc.estado)} />;
  if (selectedDoc)
    return <>{despachoModal}<DocumentDetail doc={selectedDoc} onBack={backToList} onHome={backToCompose} onPromote={openDetail}
             navInfo={navCtx && Array.isArray(navCtx.ids) ? { total: navCtx.ids.length, index: navCtx.ids.indexOf(selectedDoc.id) } : null}
             onNavSibling={gotoSibling}
             onEdit={(() => {
               // El gate usaba selectedDoc.estado (ej. 'generada') contra una lista de TIPOS → nunca
               // matcheaba y la orden no mostraba "Editar". Correcto es comparar contra el tipo.
               const t = selectedDoc.tipo || selectedDoc.estado;
               if (!EDITABLE.includes(t)) return null;
               // "Orden ya facturada → no editar" ya NO se decide acá: se resolvía mirando
               // SSData.documentos, que el POS dejó de cargar (y que además solo veía 90 días). Lo
               // decide DocumentDetail con el linaje que trae del server (`yaPromovido`).
               return startEdit;
             })()}
             onDuplicate={startEdit} /></>;
  if (listStage)
    return <>{despachoModal}<DocumentList stage={listStage} onOpen={openDetail} onBack={backToCompose} onSwitchStage={openList}
             onEdit={EDITABLE.includes(listStage) ? startEdit : null} /></>;
  return <POSCompose onOpenList={openList} />;
};

// Helper compartido: deriva el destino "atrás" según de dónde vino el usuario
function getContextualBack(fallbackPath = '/pos/flujo', fallbackLabel = 'Flujo de documentos') {
  let prev = '';
  try { prev = sessionStorage.getItem('ss-prev-route') || ''; } catch (e) {}
  const KNOWN = {
    '/pos':            { label: 'Punto de Venta',      path: '/pos' },
    '/pos/flujo':      { label: 'Flujo de documentos', path: '/pos/flujo' },
    '/cotizaciones':   { label: 'Cotizaciones',        path: '/cotizaciones' },
    '/ordenes':        { label: 'Órdenes',             path: '/ordenes' },
    '/facturas':       { label: 'Facturas',            path: '/facturas' },
    '/despachos':      { label: 'Notas de Despacho',   path: '/despachos' },
    '/clientes':       { label: 'Clientes',            path: '/clientes' },
    '/inventario':     { label: 'Inventarios',         path: '/inventario' },
    '/reportes':       { label: 'Reportes',            path: '/reportes' },
    '/cxc':            { label: 'Cuentas por Cobrar',  path: '/cxc' },
    '/cxp':            { label: 'Cuentas por Pagar',   path: '/cxp' },
    '/comisiones':     { label: 'Comisiones',          path: '/comisiones' },
  };
  return KNOWN[prev] || { label: fallbackLabel, path: fallbackPath };
}

// ====================== Página HUB del flujo (pipeline + accesos) ======================
function PipelineHubPage({ onOpenList, onBack }) {
  const stages = [
    { id:'cotizacion', label:'Cotización', desc:'Propuestas comerciales pendientes de aprobación', icon:'doc',     path:'/cotizaciones' },
    { id:'orden',      label:'Orden',      desc:'Órdenes confirmadas listas para facturar',         icon:'check',   path:'/ordenes' },
    { id:'factura',    label:'Factura',    desc:'Facturas emitidas antes del despacho',             icon:'receipt', path:'/facturas' },
    { id:'despacho',   label:'Despacho',   desc:'Notas de despacho en preparación o ruta',          icon:'truck',   path:'/despachos' },
  ];
  const [counts, setCounts] = useState({});
  useEffect(() => { window.countDocumentos?.().then(setCounts); }, []);

  // ── Ventas trabadas ────────────────────────────────────────────────────────────────────────
  // Pedido del 2026-08-07: *"las notas que no están en el proceso completo deberían darnos una
  // alerta o algo en rojo"*. El caso concreto: una factura cobrada y sin despachar figura en la
  // lista bajo "Cobradas" —o sea, sana— y nada avisa que el cliente pagó y no recibió nada.
  //
  // Se pide de nuevo al entrar (además del arranque) para que el panel no muestre lo de ayer
  // después de facturar o despachar algo.
  // TRES estados, no dos. La primera versión tenía "cargando" y "listo", así que un fallo de la
  // consulta caía en "listo" con la lista vacía y la pantalla anunciaba **"Ninguna venta parada"**
  // — buenas noticias inventadas. Lo cazó el usuario preguntando "¿seguro?". Ahora un fallo se
  // dice, con el motivo y un botón para reintentar.
  const [trabados, setTrabados] = useState(() => SSData.docsTrabados || null);
  const [trabError, setTrabError] = useState(null);
  const [trabCargando, setTrabCargando] = useState(!SSData.docsTrabados);
  const pedirTrabados = React.useCallback(async () => {
    setTrabCargando(true); setTrabError(null);
    const r = await window.loadDocsTrabados?.();
    if (!window.loadDocsTrabados) {
      // Ni siquiera existe el cargador: es un problema de despliegue, no "todo al día".
      setTrabError('No se pudo consultar (falta el cargador de datos).');
    } else if (r?.error) {
      setTrabError(r.error.message || String(r.error));
    } else {
      setTrabados(SSData.docsTrabados || []);
    }
    setTrabCargando(false);
  }, []);
  useEffect(() => { pedirTrabados(); }, [pedirTrabados]);
  // SE MUESTRAN TODAS. La primera versión escondía lo migrado de Odoo en un desplegable, con el
  // argumento de que seguramente ya estaba entregado. Estaba mal, y lo dice el corte por
  // antigüedad: **$34.348,94 de los $35.182 parados son de 2026**, incluida una orden de junio
  // por $25.375. Odoo fue el sistema en uso hasta el 2026-08-02, así que "migrada" significa
  // "nació antes del 3 de agosto", no "vieja". Queda como chip informativo (MIG), nada más.
  // Pedido explícito: *"necesito que ahí aparezcan todas las que presenten este mismo caso"*.
  // La carga trae TODO (Cuentas por Cobrar necesita la lista completa desde el minuto cero); acá
  // se filtra por antigüedad, para no marcar como "trabado" lo que se facturó hoy.
  const trabTodas = (trabados || []).filter(d => (Number(d.dias) || 0) >= (window.DIAS_TRABADO || 7));
  const sumaUsd = (ds) => ds.reduce((s, d) => s + (Number(d.total) || 0), 0);
  const CASO_LABEL = {
    cobrada_sin_despachar: 'Cobrada y sin despachar',
    factura_sin_despachar: 'Facturada y sin despachar',
    orden_sin_facturar:    'Orden sin facturar',
    // Tiene monto y NINGUNA línea, así que no se puede despachar ni facturar: no está trabado,
    // está roto. Con el rótulo anterior ("sin despachar") el aviso mandaba a generar un despacho
    // que contesta "no quedan unidades pendientes" — un callejón sin salida que Jorge recorrió
    // entero el 2026-08-11. Ver migracion-odoo/50.
    documento_sin_lineas:  'Sin productos cargados',
  };
  // `abrirDocumentoPorId` abre el DETALLE del documento (no la lista filtrada): desde acá lo que
  // se quiere es resolverlo —facturar la orden, despachar la factura—, y esos botones están en el
  // detalle. Si el documento no existe avisa, en vez de dejar al usuario en otra pantalla.
  const abrirTrabado = async (id) => {
    const ok = await window.abrirDocumentoPorId?.(id);
    if (!ok) alert('No se pudo abrir ' + id + '. Puede que lo hayan eliminado.');
  };

  const filaTrabada = (d) => (
    <tr key={d.id} style={{cursor:'pointer'}}
        onClick={() => abrirTrabado(d.id)}
        title={`Abrir ${d.id}`}>
      <td className="mono" style={{fontWeight:600}}>{d.id}</td>
      <td>
        <span className="chip" style={{fontSize:10.5, fontWeight:700,
          background: d.nivel === 'critico' ? '#dc262618' : '#d9770618',
          color:      d.nivel === 'critico' ? '#dc2626'   : '#b45309'}}>
          {CASO_LABEL[d.caso] || d.caso}
        </span>
      </td>
      <td className="dt-hide-mobile">{d.cliente || '—'}</td>
      <td className="mono" style={{textAlign:'right', fontWeight:700}}>{fmt.usd(Number(d.total) || 0)}</td>
      <td className="dt-hide-mobile">
        {fmt.date(d.fecha)}
        {/* MIG solo informa dónde nació el documento (Odoo fue el sistema en uso hasta el
            2026-08-02). NO quiere decir que sea vieja ni que importe menos. */}
        {d.migrada && <span className="chip" style={{marginLeft:6, fontSize:9.5, fontWeight:700, background:'var(--bg-sunken)', color:'var(--text-muted)'}} title="Nació en Odoo, antes del 3 de agosto">MIG</span>}
      </td>
      <td style={{textAlign:'right', fontWeight:600, color: d.dias > 30 ? 'var(--danger)' : 'var(--text-muted)'}}>
        {d.dias} d
      </td>
    </tr>
  );

  const tablaTrabadas = (ds) => (
    <div style={{overflowX:'auto'}}>
      <table className="tbl">
        <thead><tr>
          <th>Documento</th><th>Qué le falta</th><th className="dt-hide-mobile">Cliente</th>
          <th style={{textAlign:'right'}}>Monto</th><th className="dt-hide-mobile">Fecha</th>
          <th style={{textAlign:'right'}}>Parada</th>
        </tr></thead>
        <tbody>{ds.map(filaTrabada)}</tbody>
      </table>
    </div>
  );
  // [clave en porFlujo, etiqueta, color] — dos chips por card para diferenciar el sub-estado
  const SUB_BREAKDOWN = {
    cotizacion: [['creadas', 'Creadas', '#2563eb'], ['convertidas', 'Convertidas', '#16a34a']],
    orden:      [['generadas', 'Generadas', '#2563eb'], ['facturadas', 'Facturadas', '#16a34a']],
    despacho:   [['por_despachar', 'Por despachar', '#b45309'], ['despachadas', 'Despachadas', '#16a34a']],
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Flujo de documentos</h1>
          <div className="page-subtitle">Cotización → Orden → Factura → Despacho · clic en cada paso para ver el listado</div>
        </div>
        <div className="page-actions">
          <button className="btn secondary" onClick={() => { const b = getContextualBack('/pos', 'Punto de Venta'); window.__ssNavigate?.(b.path); }} title="Volver">
            <Icon name="chevronL" size={14}/>Volver
          </button>
          <button className="btn primary" onClick={() => window.__ssNavigate('/pos')}><Icon name="plus" size={14}/>Nueva cotización</button>
        </div>
      </div>

      {/* ── Ventas trabadas: lo que se quedó a mitad del camino ─────────────────
          TODAS, ordenadas por gravedad y monto. Vienen así de la RPC. */}
      {!trabCargando && trabTodas.length > 0 && (
        <div style={{background:'var(--danger-soft, #fef2f2)', border:'1px solid var(--danger)',
                     borderRadius:10, padding:'14px 16px', marginBottom:18}}>
          <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:4}}>
            <Icon name="info" size={17}/>
            <span style={{fontWeight:700, fontSize:14.5, color:'var(--danger)'}}>
              {trabTodas.length} venta{trabTodas.length !== 1 ? 's' : ''} parada{trabTodas.length !== 1 ? 's' : ''} a mitad del flujo
            </span>
            <span className="mono" style={{fontWeight:700, fontSize:14}}>{fmt.usd(sumaUsd(trabTodas))}</span>
          </div>
          <div className="small muted" style={{marginBottom:10}}>
            Sin movimiento hace más de {window.DIAS_TRABADO || 7} días · de mayor a menor ·
            clic en una fila para abrir el documento y resolverlo
          </div>
          {tablaTrabadas(trabTodas)}
        </div>
      )}

      {/* NO SE PUDO VERIFICAR ≠ TODO BIEN. Este bloque existe porque la versión anterior mostraba
          "Ninguna venta parada" cuando la consulta fallaba. */}
      {!trabCargando && trabError && (
        <div style={{background:'#fffbeb', border:'1px solid #d97706', borderRadius:10,
                     padding:'12px 14px', marginBottom:18, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
          <Icon name="info" size={16}/>
          <span style={{fontWeight:600, fontSize:13}}>No se pudo verificar si hay ventas paradas.</span>
          <span className="small muted" style={{minWidth:0, flex:'1 1 240px'}}>{trabError}</span>
          <button className="btn secondary" onClick={pedirTrabados}>Reintentar</button>
        </div>
      )}

      {/* Vacío VERIFICADO: solo cuando la consulta respondió bien y no trajo nada. */}
      {!trabCargando && !trabError && trabTodas.length === 0 && (
        <div className="small muted" style={{border:'1px solid var(--border)', borderRadius:10,
                     padding:'10px 14px', marginBottom:18, display:'flex', alignItems:'center', gap:8}}>
          <Icon name="check" size={14}/>
          Ninguna venta parada: todas las órdenes están facturadas y todas las facturas, despachadas.
        </div>
      )}

      {/* Pipeline visual grande */}
      <div className="pipeline-hub">
        {stages.map((s, i) => (
          <React.Fragment key={s.id}>
            <div className="pipeline-hub-step" onClick={() => onOpenList(s.id)} title={`Ver lista de ${s.label.toLowerCase()}s`}>
              <div className="pipeline-hub-icon"><Icon name={s.icon} size={22}/></div>
              <div className="pipeline-hub-num">Paso {i+1}</div>
              <div className="pipeline-hub-label">{s.label}</div>
              <div className="pipeline-hub-count">{counts.porTipo?.[s.id] ?? '—'} <span style={{fontSize:11, fontWeight:400, color:'var(--text-muted)'}}>doc.</span></div>
              {SUB_BREAKDOWN[s.id] && (
                <div style={{display:'flex', gap:6, marginTop:3, flexWrap:'wrap'}}>
                  {SUB_BREAKDOWN[s.id].map(([k, label, color]) => (
                    <span key={k} style={{fontSize:10.5, fontWeight:600, padding:'2px 8px', borderRadius:99, background:color+'18', color, whiteSpace:'nowrap'}}>
                      {counts.porFlujo?.[s.id]?.[k] ?? 0} {label}
                    </span>
                  ))}
                </div>
              )}
              <div className="pipeline-hub-desc">{s.desc}</div>
              <div className="pipeline-hub-cta">Ver listado <Icon name="chevronR" size={12}/></div>
            </div>
            {i < stages.length - 1 && <div className="pipeline-hub-arrow"><Icon name="chevronR" size={20}/></div>}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
window.PipelineHubPage = PipelineHubPage;

// ====================== Quick-create: Cliente desde POS ======================
function QuickNewClientModal({ initialNombre, onClose, onCreated }) {
  const [persona, setPersona] = useState('juridica');
  const tiposCliente  = SSData.tiposCliente  || [];
  const listasPrecios = SSData.listasPrecios || [];

  // Devuelve el id de la lista_precio que corresponde a un tipo_cliente_id, o null si no hay
  function listaParaTipo(tipoId) {
    const lp = listasPrecios.find(l => l.tipo_cliente_id === tipoId);
    return lp ? lp.id : null;
  }

  const tipoDefault = tiposCliente[0]?.id || '';
  const [form, setForm] = useState(() => ({
    nombre:      initialNombre || '',
    rif:         'J-',
    tipo:        tipoDefault,
    lista_precio: listaParaTipo(tipoDefault),
    telefono:    '+58 ',
    email:       '',
    direccion:   '',
  }));
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');
  // El homónimo avisa y deja seguir; el RIF repetido sí deniega (2026-08-18).
  const [homonimo, setHomonimo] = useState(null);

  function cambiarPersona(p) {
    setPersona(p);
    setForm(f => ({ ...f, rif: p === 'juridica' ? (f.rif.startsWith('V-')||f.rif.startsWith('E-')?'J-':f.rif) : (f.rif.startsWith('J-')||f.rif.startsWith('G-')?'V-':f.rif) }));
  }

  function onTipoChange(tipoId) {
    setForm(f => ({ ...f, tipo: tipoId, lista_precio: listaParaTipo(tipoId) }));
  }

  async function save({ confirmado = false } = {}) {
    const telV = form.telefono.trim();
    if (!form.nombre.trim()) { setErr('El nombre es obligatorio.'); return; }
    if (persona === 'juridica' && (!form.rif.trim() || form.rif.length < 4)) { setErr('Ingresa un RIF válido.'); return; }
    // Todo cliente nace con ≥1 contacto (nombre + teléfono); acá el teléfono del cliente se
    // reutiliza como teléfono del contacto principal, así que es obligatorio. Se valida por
    // dígitos normalizados (no basta con que el texto no sea exactamente "+58") para que un valor
    // como "-" o "N/A" no cuele como "teléfono válido" y burle el chequeo de duplicados.
    if (!window.ssNormTel(telV)) { setErr('El teléfono es obligatorio (se usa como contacto principal).'); return; }
    // RIF/cédula único — aplica a ambos tipos de persona (jurídica y natural), no solo empresas.
    const rifV = form.rif.trim();
    // Contra el SERVER, no contra SSData: acá, en el POS, el catálogo de clientes no está
    // cargado (se pide solo en /clientes), así que el chequeo en memoria podía no encontrar
    // nada y dejar entrar un RIF repetido.
    const dup = await window.buscarDuplicadoCliente({ nombre: form.nombre, rif: rifV });
    if (dup.porRif) { setErr(`Ya existe un cliente con este ${persona === 'juridica' ? 'RIF' : 'RIF/cédula'}: ${dup.porRif.nombre}`); return; }
    if (dup.porNombre && !confirmado) { setHomonimo(dup.porNombre); return; }
    setHomonimo(null);
    const dupTel = window.ssFindDupContactoTelefono(telV, null);
    if (dupTel) { setErr(`Ese teléfono ya lo usa el contacto: ${dupTel.nombre}`); return; }
    const emailV = form.email.trim();
    const dupEmail = emailV ? window.ssFindDupContactoEmail(emailV, null) : null;
    if (dupEmail) { setErr(`Ese email ya lo usa el contacto: ${dupEmail.nombre}`); return; }
    setErr(''); setSaving(true);
    const id      = 'CLI-' + Date.now();
    const empresa = window.currentEmpresa || 'demo1';
    const row = {
      id,
      nombre:       form.nombre.trim(),
      rif:          form.rif.trim() || null,
      tipo:         form.tipo || null,
      lista_precio: form.lista_precio || null,
      telefono:     telV || null,
      email:        emailV || null,
      direccion:    form.direccion.trim() || null,
      activo:       true,
      empresas:     [empresa],
      persona,
    };
    const { error } = await window.sb.from('clientes').insert(row);
    if (error) { setSaving(false); setErr('Error al guardar: ' + error.message); return; }
    // Contacto principal obligatorio: se crea con los mismos datos de contacto del cliente.
    const contactoId = 'CT-C-' + id;
    const { error: cErr } = await window.sb.from('contactos').insert({
      id: contactoId, cliente_id: id, nombre: form.nombre.trim(),
      cargo: persona === 'juridica' ? 'Contacto principal' : 'Titular',
      telefono: telV, email: emailV || null, activo: true, empresa_id: empresa,
      creado_por: window.__ssCurrentUser?.nombre || null,
    });
    setSaving(false);
    if (cErr) { alert('Cliente creado, pero falló el contacto principal: ' + cErr.message); }
    else { window.SSData.contactos = [{ id:contactoId, cliente_id:id, nombre:form.nombre.trim(), cargo: persona==='juridica'?'Contacto principal':'Titular', telefono:telV, email:emailV||null, activo:true, empresa_id:empresa }, ...(window.SSData.contactos || [])]; }
    const localRow = { ...row, listaPrecio: row.lista_precio, limiteCredito: 0, deuda: 0, ventasYTD: 0 };
    window.SSData.clientes = [localRow, ...(window.SSData.clientes || [])];
    window.logActivity?.({ modulo:'clientes', accion:'crear', entidad_id:id, entidad_label:row.nombre, detalles:{ origen:'pos_quick', persona } });
    onCreated(id);
    onClose();
  }

  const listaSeleccionada = listasPrecios.find(l => l.id === form.lista_precio);

  return (
    <div className="modal-overlay" onClick={onClose} style={{zIndex:300}}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{width:'min(520px, 96vw)'}}>
        <div className="modal-header">
          <div style={{width:38,height:38,borderRadius:9,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}>
            <Icon name="clients" size={18}/>
          </div>
          <div style={{flex:1}}>
            <div className="modal-title">Nuevo cliente rápido</div>
            <div className="small">{persona === 'juridica' ? 'Persona jurídica (empresa)' : 'Persona natural (individuo)'}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <div className="modal-body">
          <div className="seg" style={{marginBottom:14, width:'100%'}}>
            <button className={persona==='juridica'?'on':''} onClick={()=>cambiarPersona('juridica')} style={{flex:1}}>
              <Icon name="clients" size={12}/> Empresa (jurídica)
            </button>
            <button className={persona==='natural'?'on':''} onClick={()=>cambiarPersona('natural')} style={{flex:1}}>
              <Icon name="user" size={12}/> Individual (natural)
            </button>
          </div>
          <div className="grid-2">
            <div>
              <label className="form-label">{persona === 'juridica' ? 'Razón social' : 'Nombre completo'} <span style={{color:'var(--danger)'}}>*</span></label>
              <input className="input" autoFocus placeholder={persona === 'juridica' ? 'Distribuidora El Globo C.A.' : 'Juan Pérez'} value={form.nombre} onChange={e=>setForm(f=>({...f,nombre:e.target.value}))}/>
            </div>
            <div>
              <label className="form-label">{persona === 'juridica' ? 'RIF' : 'Cédula / RIF'} {persona === 'juridica' && <span style={{color:'var(--danger)'}}>*</span>}</label>
              <input className="input mono" placeholder={persona === 'juridica' ? 'J-12345678-9' : 'V-12345678'} value={form.rif} onChange={e=>setForm(f=>({...f,rif:e.target.value}))}/>
            </div>
            <div>
              <label className="form-label">Teléfono <span style={{color:'var(--danger)'}}>*</span> <span className="small" style={{color:'var(--text-muted)'}}>— usado como contacto principal</span></label>
              <input className="input" placeholder="+58 414-0000000" value={form.telefono} onChange={e=>setForm(f=>({...f,telefono:e.target.value}))}/>
            </div>
            <div>
              <label className="form-label">Email <span className="small" style={{color:'var(--text-muted)'}}>— opcional</span></label>
              <input className="input" placeholder="ventas@empresa.com" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))}/>
            </div>
          </div>
          <div style={{marginTop:12}}>
            <label className="form-label">Dirección</label>
            <input className="input" placeholder="Av. Principal, Edif. Torre Norte, Piso 3" value={form.direccion} onChange={e=>setForm(f=>({...f,direccion:e.target.value}))}/>
          </div>
          <div style={{marginTop:12}}>
            <label className="form-label">Tipo de cliente</label>
            <div style={{display:'flex', gap:8, flexWrap:'wrap', marginTop:4}}>
              {tiposCliente.map(t => (
                <div key={t.id} onClick={()=>onTipoChange(t.id)}
                  style={{padding:'6px 14px', borderRadius:8, cursor:'pointer', fontSize:12.5, fontWeight:500,
                    border: form.tipo===t.id ? '2px solid '+(t.color||'var(--brand)') : '1px solid var(--border)',
                    background: form.tipo===t.id ? (t.color||'var(--brand)')+'18' : 'var(--bg-elev)',
                    color: form.tipo===t.id ? (t.color||'var(--brand)') : 'var(--text)'}}>
                  {t.nombre}
                </div>
              ))}
            </div>
          </div>
          <div style={{marginTop:12}}>
            <label className="form-label">Lista de precios</label>
            <select className="input" value={form.lista_precio || ''} onChange={e=>setForm(f=>({...f,lista_precio:e.target.value||null}))}>
              <option value="">Sin lista asignada</option>
              {listasPrecios.map(l => (
                <option key={l.id} value={l.id}>{l.nombre}{l.descuento ? ` (${l.descuento}% dto.)` : ''}</option>
              ))}
            </select>
            {listaSeleccionada && (
              <div className="small" style={{marginTop:4,color:'var(--text-2)'}}>
                Asignada automáticamente por tipo de cliente · puedes cambiarla
              </div>
            )}
          </div>
          {err && <div style={{marginTop:10,padding:'8px 12px',background:'#fee2e2',border:'1px solid var(--danger)',borderRadius:8,fontSize:12,color:'#b91c1c'}}>{err}</div>}
          <window.AvisoHomonimo
            cliente={homonimo}
            creando={saving}
            onContinuar={() => save({ confirmado: true })}
            onCancelar={() => setHomonimo(null)}
          />
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={() => save()} disabled={saving || !form.nombre || (persona==='juridica' && form.rif.length < 4) || !window.ssNormTel(form.telefono)}>
            {saving ? 'Guardando…' : <><Icon name="plus" size={13}/>Crear y seleccionar</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ====================== Quick-create: Contacto desde POS ======================
// Soporta dos modos:
//  - 'empresa'   → contacto asociado a un cliente jurídico existente
//  - 'individual' → cliente persona natural (auto-crea un cliente y un contacto vinculado)
function QuickNewContactModal({ initialNombre, onClose, onCreated }) {
  const [modo, setModo] = useState('individual'); // 'individual' | 'empresa'
  const [form, setForm] = useState({
    nombre: initialNombre || '',
    cliente_id: '',
    cargo: '',
    cedula: '',
    telefono: '+58 ',
    email: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');
  const [homonimo, setHomonimo] = useState(null);

  // Memoizado: son 13k clientes y el modal re-renderiza en cada tecla del formulario.
  const clientOptions = useMemo(
    () => (SSData.clientes || []).map(c => ({ value: c.id, label: c.nombre, sublabel: c.rif })),
    [SSData.clientes, SSData.clientes?.length]);

  async function save({ confirmado = false } = {}) {
    const telV = form.telefono.trim();
    const emailV = form.email.trim();
    if (!form.nombre.trim()) { setErr('El nombre es obligatorio.'); return; }
    if (modo === 'empresa' && !form.cliente_id) { setErr('Selecciona la empresa a la que pertenece.'); return; }
    // Teléfono obligatorio: todo contacto nuevo debe tener uno (email/tel de contacto son únicos).
    // Se valida por dígitos normalizados para que "-"/"N/A" no cuele como teléfono válido.
    if (!window.ssNormTel(telV)) { setErr('El teléfono es obligatorio.'); return; }
    const dupTel = window.ssFindDupContactoTelefono(telV, null);
    if (dupTel) { setErr(`Ese teléfono ya lo usa el contacto: ${dupTel.nombre}`); return; }
    const dupEmail = emailV ? window.ssFindDupContactoEmail(emailV, null) : null;
    if (dupEmail) { setErr(`Ese email ya lo usa el contacto: ${dupEmail.nombre}`); return; }
    if (modo === 'individual') {
      // Misma regla y mismo motivo que en el alta rápida: la cédula deniega, el nombre avisa.
      const dup = await window.buscarDuplicadoCliente({ nombre: form.nombre, rif: form.cedula });
      if (dup.porRif) { setErr(`Ya existe un cliente con esta cédula/RIF: ${dup.porRif.nombre}`); return; }
      if (dup.porNombre && !confirmado) { setHomonimo(dup.porNombre); return; }
      setHomonimo(null);
    }
    setErr(''); setSaving(true);
    const empresa = window.currentEmpresa || 'demo1';

    let clienteIdVinculado = form.cliente_id;

    // Modo individual → crear primero el cliente persona natural
    if (modo === 'individual') {
      const cliId = 'CLI-' + Date.now();
      const tiposCliente  = SSData.tiposCliente  || [];
      const listasPrecios = SSData.listasPrecios || [];
      const tipoFinal     = tiposCliente.find(t => t.id === 'final') || tiposCliente[tiposCliente.length - 1];
      const lpFinal       = listasPrecios.find(l => l.tipo_cliente_id === tipoFinal?.id);
      const cliRow = {
        id:           cliId,
        nombre:       form.nombre.trim(),
        rif:          form.cedula.trim() || null,
        tipo:         tipoFinal?.id || null,
        lista_precio: lpFinal?.id || null,
        telefono:     telV || null,
        email:        emailV || null,
        activo:       true,
        empresas:     [empresa],
        persona:      'natural',
      };
      const { error: cliErr } = await window.sb.from('clientes').insert(cliRow);
      if (cliErr) { setSaving(false); setErr('Error creando cliente: ' + cliErr.message); return; }
      window.SSData.clientes = [{ ...cliRow, listaPrecio: cliRow.lista_precio, limiteCredito: 0, deuda: 0, ventasYTD: 0 }, ...(window.SSData.clientes || [])];
      clienteIdVinculado = cliId;
      window.logActivity?.({ modulo:'clientes', accion:'crear', entidad_id:cliId, entidad_label:cliRow.nombre, detalles:{ origen:'pos_quick', persona:'natural' } });
    }

    // Crear el contacto (siempre, vinculado al cliente)
    const id = 'CT-' + Date.now();
    const row = {
      id,
      cliente_id: clienteIdVinculado,
      nombre:     form.nombre.trim(),
      cargo:      modo === 'empresa' ? (form.cargo.trim() || null) : null,
      telefono:   telV || null,
      email:      emailV || null,
      activo:     true,
      empresa_id: empresa,
    };
    const { error } = await window.sb.from('contactos').insert(row);
    setSaving(false);
    if (error) {
      // En modo individual el cliente YA se creó en la DB (paso anterior). Si el contacto falla acá,
      // no lo dejamos "atrapado": avisamos y igual cerramos con el cliente seleccionable, en vez de
      // volver a mostrar el formulario (donde el cliente recién creado dispararía los chequeos de
      // duplicado de nombre/RIF y el usuario no podría reintentar).
      if (modo === 'individual') {
        alert('Cliente creado, pero falló el contacto principal: ' + error.message);
        onCreated(clienteIdVinculado);
        onClose();
      } else {
        setErr('Error al guardar contacto: ' + error.message);
      }
      return;
    }
    window.SSData.contactos = [row, ...(window.SSData.contactos || [])];
    window.logActivity?.({ modulo:'contactos', accion:'crear', entidad_id:id, entidad_label:row.nombre, detalles:{ origen:'pos_quick', modo, cliente_id:clienteIdVinculado } });
    onCreated(id);
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{zIndex:300}}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{width:'min(540px, 96vw)'}}>
        <div className="modal-header">
          <div style={{width:38,height:38,borderRadius:9,background:'var(--accent-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}>
            <Icon name="contact" size={18}/>
          </div>
          <div style={{flex:1}}>
            <div className="modal-title">Nuevo contacto rápido</div>
            <div className="small">{modo === 'individual' ? 'Cliente persona natural' : 'Contacto dentro de una empresa'}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <div className="modal-body">
          <div className="seg" style={{marginBottom:14, width:'100%'}}>
            <button className={modo==='individual'?'on':''} onClick={()=>setModo('individual')} style={{flex:1}}>
              <Icon name="user" size={12}/> Cliente individual
            </button>
            <button className={modo==='empresa'?'on':''} onClick={()=>setModo('empresa')} style={{flex:1}}>
              <Icon name="clients" size={12}/> Pertenece a empresa
            </button>
          </div>

          <div className="grid-2">
            <div>
              <label className="form-label">Nombre completo <span style={{color:'var(--danger)'}}>*</span></label>
              <input className="input" autoFocus placeholder="Ana Martínez" value={form.nombre} onChange={e=>setForm(f=>({...f,nombre:e.target.value}))}/>
            </div>
            {modo === 'individual' ? (
              <div>
                <label className="form-label">Cédula / RIF</label>
                <input className="input mono" placeholder="V-12345678" value={form.cedula} onChange={e=>setForm(f=>({...f,cedula:e.target.value}))}/>
              </div>
            ) : (
              <div>
                <label className="form-label">Cargo</label>
                <input className="input" placeholder="Gerente de compras" value={form.cargo} onChange={e=>setForm(f=>({...f,cargo:e.target.value}))}/>
              </div>
            )}
            <div>
              <label className="form-label">Teléfono <span style={{color:'var(--danger)'}}>*</span></label>
              <input className="input" placeholder="+58 414-0000000" value={form.telefono} onChange={e=>setForm(f=>({...f,telefono:e.target.value}))}/>
            </div>
            <div>
              <label className="form-label">Email <span className="small" style={{color:'var(--text-muted)'}}>— opcional</span></label>
              <input className="input" placeholder="ana@empresa.com" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))}/>
            </div>
          </div>

          {modo === 'empresa' && (
            <div className="mt-3">
              <label className="form-label">Empresa a la que pertenece <span style={{color:'var(--danger)'}}>*</span></label>
              <SearchSelect value={form.cliente_id} onChange={v=>setForm(f=>({...f,cliente_id:v}))} options={clientOptions} placeholder="Seleccionar empresa..." style={{width:'100%'}}/>
            </div>
          )}

          {modo === 'individual' && (
            <div style={{marginTop:12, padding:'8px 12px', background:'var(--bg-sunken)', border:'1px solid var(--border)', borderRadius:6, fontSize:11.5, color:'var(--text-muted)'}}>
              <Icon name="info" size={11} style={{marginRight:4, verticalAlign:'-1px'}}/>
              Se creará automáticamente un cliente persona natural a nombre de <strong style={{color:'var(--text)'}}>{form.nombre || '…'}</strong> con su contacto asociado.
            </div>
          )}

          {err && <div style={{marginTop:10,padding:'8px 12px',background:'#fee2e2',border:'1px solid var(--danger)',borderRadius:8,fontSize:12,color:'#b91c1c'}}>{err}</div>}
          <window.AvisoHomonimo
            cliente={homonimo}
            creando={saving}
            onContinuar={() => save({ confirmado: true })}
            onCancelar={() => setHomonimo(null)}
          />
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={() => save()} disabled={saving || !form.nombre || (modo==='empresa' && !form.cliente_id) || !form.telefono.trim() || form.telefono.trim()==='+58'}>
            {saving ? 'Guardando…' : <><Icon name="plus" size={13}/>Crear y seleccionar</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ====================== Compositor POS ======================
function POSCompose({ onOpenList, editingDoc, onEditDone }) {
  const isEditing = !!editingDoc;
  const ed = editingDoc || {};
  const preselect = !isEditing && window.__ssPosPreselect;
  if (preselect) window.__ssPosPreselect = null;
  const saved = (!isEditing && !preselect) ? lsLoad() : null;
  // Borrador recuperado: true si al montar había una cotización sin guardar con ítems.
  const [draftRecovered, setDraftRecovered] = useState(
    !!(saved && Array.isArray(saved.cart) && saved.cart.length > 0)
  );

  // ── Tasa activa (BCV, paralelo, cobertura) ─────────────────────────────────────
  // Dos bugs reportados el 2026-08-04, los dos de acá:
  //
  //  1. Un vendedor veía "BCV +33%" con el sistema en 35%. El 33 nunca fue global: alguien lo
  //     tipeó una vez y el BORRADOR lo arrastraba a cada cotización nueva de ese navegador. Un
  //     ajuste manual es del DOCUMENTO que se está armando, no una preferencia del vendedor.
  //  2. Otro veía 15% — el valor que `data.js` traía escrito a mano como arranque. El POS
  //     congelaba la tasa al montarse y solo la refrescaba si alguien abría el modal de tasas, así
  //     que abrir el POS antes de que llegue la tasa del server (arranque frío, o la pestaña
  //     abierta desde ayer) dejaba ese 15% para TODA la sesión… y se facturaba con él.
  //
  // Ahora: la tasa se re-lee cuando llegan datos (`ss-appdata-loaded`) y cuando cambia por el modal
  // (`ss-tasa-changed`); el ajuste manual vive en `coberturaManual` y **no se guarda en el
  // borrador**, así que no puede filtrarse a la cotización siguiente. Y si no hay cobertura del
  // sistema todavía, no se inventa ninguna: la modalidad BCV avisa y no deja cobrar con un número
  // que nadie configuró.
  const [tasa, setTasa] = useState(() => window.currentTasa || SSData.tasa);
  useEffect(() => {
    const refrescar = () => { const t = window.currentTasa || SSData.tasa; if (t) setTasa({ ...t }); };
    const onTasaChanged = (e) => setTasa({ ...(e.detail || window.currentTasa || SSData.tasa) });
    window.addEventListener('ss-tasa-changed', onTasaChanged);
    const off = window.ssOnDatos ? window.ssOnDatos(refrescar) : null;
    return () => {
      window.removeEventListener('ss-tasa-changed', onTasaChanged);
      if (off) off();
    };
  }, []);
  // La cobertura del SISTEMA. `null` = todavía no llegó (o no está configurada): no se inventa.
  const coberturaSistema = (tasa && tasa.cobertura != null && tasa.cobertura !== '' && Number(tasa.cobertura) > 0)
    ? parseFloat(tasa.cobertura) : null;
  // Ajuste manual de ESTE documento. Al editar uno guardado manda lo que ese documento tenía.
  const [coberturaManual, setCoberturaManual] = useState(() =>
    (isEditing && ed.modalidad_pago === 'bcv' && ed.cobertura_pct != null) ? parseFloat(ed.cobertura_pct) : null);
  const coberturaDoc = coberturaManual != null ? coberturaManual : coberturaSistema;
  const cobertura = coberturaDoc;
  // Compatibilidad: el resto del componente llama a setCoberturaDoc para el ajuste manual.
  const setCoberturaDoc = (v) => {
    const n = (typeof v === 'function') ? v(coberturaDoc) : v;
    const num = parseFloat(n);
    // Volver al valor del sistema (o escribir exactamente ese valor) deja de ser "manual".
    setCoberturaManual(!isFinite(num) || num === coberturaSistema ? null : num);
  };
  const tasaCobertura = coberturaSistema;
  // Tasa paralelo de ESTE documento — mismo patrón que la cobertura BCV: el sistema trae una,
  // pero un vendedor con el permiso especial puede pisarla para esta cotización/orden puntual
  // (p.ej. una tasa ya negociada con el cliente). No se guarda en el borrador de localStorage
  // por la misma razón que la cobertura: filtrarse a la próxima cotización sería un bug.
  const tasaParaleloSistema = (tasa && Number(tasa.paralelo) > 0) ? Number(tasa.paralelo) : null;
  const [tasaParaleloManual, setTasaParaleloManual] = useState(() =>
    (isEditing && ed.modalidad_pago === 'paralelo' && ed.tasa_paralelo != null) ? parseFloat(ed.tasa_paralelo) : null);
  const tasaParaleloDoc = tasaParaleloManual != null ? tasaParaleloManual : tasaParaleloSistema;
  const setTasaParaleloDoc = (v) => {
    const num = parseFloat(v);
    setTasaParaleloManual(!isFinite(num) || num === tasaParaleloSistema ? null : num);
  };
  const canEditTasaParalelo = window.canUser?.('editar', 'pos_tasa_paralelo') ?? false;

  // Configuración de campos obligatorios/opcionales/ocultos
  const camposConfig = window.getCamposConfig ? window.getCamposConfig() : {};
  const isRequired = id => (camposConfig[id] || 'opcional') === 'obligatorio';
  const isHidden   = id => (camposConfig[id] || 'opcional') === 'oculto';

  const [camposErrors, setCamposErrors] = useState([]);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [showConfirmCot, setShowConfirmCot] = useState(false);
  const [showConfirmAction, setShowConfirmAction] = useState(false);
  const [pendingActionId, setPendingActionId] = useState(null);
  const [posToast, setPosToast] = useState(null);
  function showPosToast(msg, type = 'error') {
    setPosToast({ msg, type });
    setTimeout(() => setPosToast(null), 3500);
  }
  // Alerta bloqueante por stock insuficiente vs reservas en otras órdenes
  const [blockingReservaAlert, setBlockingReservaAlert] = useState(null);
  // Aviso (NO bloqueante) de orden ya cargada con el mismo cliente y los mismos productos.
  // { docs, continuar } — `continuar` reanuda la creación si el usuario insiste.
  const [ordenDup, setOrdenDup] = useState(null);

  // Pedido por voz
  function getAnthropicKey() {
    return window.getEmpresaConfig?.()?.anthropic_api_key || '';
  }
  function applyVoiceOrder(parsed) {
    if (parsed.clienteId && SSData.clientes.find(c => c.id === parsed.clienteId)) setClienteId(parsed.clienteId);
    if (parsed.modalidadPago) setModalidadPago(parsed.modalidadPago);
    if (parsed.terminosPago) setTerminosPago(parsed.terminosPago);
    if (parsed.tipoEntrega) setTipoEntrega(parsed.tipoEntrega);
    if (parsed.observaciones) setObservaciones(o => o ? o + '\n' + parsed.observaciones : parsed.observaciones);
    if (parsed.items && parsed.items.length > 0) {
      const newItems = parsed.items.map(item => {
        const p = SSData.productos.find(pp => pp.sku === item.sku);
        if (!p) return null;
        return { sku: p.sku, qty: Math.max(1, Math.round(Number(item.qty) || 1)), extraDescuento: 0, precioManual: null };
      }).filter(Boolean);
      if (newItems.length > 0) {
        setCart(prev => {
          // Fix bug #39: no mutar los objetos de línea del estado anterior (ex.qty += ...).
          // Creamos objetos nuevos con spread para respetar el modelo inmutable de React.
          let next = prev.filter(c => !c._section).concat(prev.filter(c => c._section));
          newItems.forEach(ni => {
            const ex = next.find(c => !c._section && c.sku === ni.sku);
            if (ex) next = next.map(c => (c === ex ? { ...c, qty: c.qty + ni.qty } : c));
            else next.unshift(ni);
          });
          return next;
        });
      }
    }
    showPosToast('Pedido por voz aplicado', 'success');
  }

  // Cart + selector state
  const [modalidadPago, setModalidadPago] = useState(
    isEditing ? (ed.modalidad_pago || 'divisas') : (saved?.modalidadPago || 'divisas')
  );
  const [cart, setCart] = useState(
    isEditing
      ? (ed.lines || []).map((l, idx) => {
          if (l.sku === '__SECTION__') return { _section: true, id: 'sec-' + idx, label: l.nombre || '' };
          const extra = parseFloat(l.descuento_extra) || 0;
          const p = (SSData.productos || []).find(pp => pp.sku === l.sku);
          const docDesc = parseFloat(ed.descuento_pct) || 0;
          const cob = ed.modalidad_pago === 'bcv' ? (parseFloat(ed.cobertura_pct) || 0) : 0;
          let precioManual = null;
          if (p && l.precio != null) {
            const expected = p.base * (1 - docDesc/100) * (1 - extra/100) * (1 + cob/100);
            if (Math.abs(parseFloat(l.precio) - expected) > 0.01) {
              precioManual = ed.modalidad_pago === 'bcv'
                ? parseFloat(l.precio) / (1 + cob/100)
                : parseFloat(l.precio);
            }
          }
          return { sku: l.sku, qty: l.qty, extraDescuento: extra, precioManual };
        })
      : (saved?.cart || [])
  );
  // Preserve proveedor_id/costo per SKU when editing — buildItems() reads this map
  const editingInternosMap = useMemo(() => {
    const m = {};
    if (isEditing) (ed.lines || []).forEach(l => { if (l.sku && l.sku !== '__SECTION__') m[l.sku] = { proveedor_id: l.proveedor_id || null, costo: parseFloat(l.costo) || 0 }; });
    return m;
  }, [isEditing, ed.id]);

  // Campos internos editables en el carrito (proveedor_id y costo por SKU)
  const [cartInternos, setCartInternos] = useState(() => {
    if (isEditing) {
      const m = {};
      (ed.lines || []).forEach(l => {
        if (l.sku && l.sku !== '__SECTION__')
          m[l.sku] = { proveedor_id: l.proveedor_id || '', costo: l.costo != null ? String(l.costo) : '' };
      });
      return m;
    }
    return (saved && saved.cartInternos) ? saved.cartInternos : {};
  });
  // Namespacing estándar #4: 'ss-pos-cart-show-internos'. Migración: se lee la clave nueva y,
  // si no existe, la vieja 'ss-cart-show-internos' (para no perder la preferencia del usuario).
  const [showCartInternos, setShowCartInternos] = useState(() => {
    const v = localStorage.getItem('ss-pos-cart-show-internos') ?? localStorage.getItem('ss-cart-show-internos');
    return v === 'true';
  });
  function toggleCartInternos() {
    setShowCartInternos(v => { const next = !v; localStorage.setItem('ss-pos-cart-show-internos', String(next)); return next; });
  }
  function updateCartInterno(sku, field, value) {
    setCartInternos(prev => ({ ...prev, [sku]: { ...(prev[sku] || {}), [field]: value } }));
  }

  // Garantía editable por línea (meses + condiciones). Default: hereda de producto al agregar.
  const [cartGarantias, setCartGarantias] = useState(() => {
    if (isEditing) {
      const m = {};
      (ed.lines || []).forEach(l => {
        if (l.sku && l.sku !== '__SECTION__')
          m[l.sku] = {
            meses:        l.garantia_meses != null ? String(l.garantia_meses) : '',
            condiciones:  l.garantia_condiciones || '',
          };
      });
      return m;
    }
    return (saved && saved.cartGarantias) ? saved.cartGarantias : {};
  });
  const [garantiaOpenSku, setGarantiaOpenSku] = useState(null);
  function updateCartGarantia(sku, field, value) {
    setCartGarantias(prev => ({ ...prev, [sku]: { ...(prev[sku] || {}), [field]: value } }));
  }

  const [clienteId, setClienteId] = useState(
    isEditing ? (ed.cliente_id || '') : (preselect?.clienteId || saved?.clienteId || '')
  );
  const [almacenId, setAlmacenId] = useState(
    () => getAlmacenDefault(isEditing ? ed.almacen_id : saved?.almacenId)
  );
  // SSData.almacenes puede estar vacío al montar (la data llega async y se re-emite por chunks).
  // Si no se re-resuelve cuando llega, el almacén queda en '' y el catálogo se ve vacío para
  // siempre. getAlmacenDefault es idempotente: si el actual ya es válido, lo respeta.
  useEffect(() => {
    const resolver = () => setAlmacenId(prev => getAlmacenDefault(prev));
    resolver();
    window.addEventListener('ss-appdata-loaded', resolver);
    return () => window.removeEventListener('ss-appdata-loaded', resolver);
  }, []);
  // stage es la ETAPA del documento (= su tipo), no el sub-estado. Antes usaba ed.estado
  // ('generada'/'creada'/…) → stageIdx=-1 y buildDocData escribía tipo='generada' corrupto.
  const [stage, setStage] = useState(isEditing ? (ed.tipo || ed.estado) : 'cotizacion');
  const [searchTerms, setSearchTerms] = useState([]);
  const [categoria, setCategoria] = useState('');
  const [marcaFilter, setMarcaFilter] = useState('');
  const [soloConStock, setSoloConStock] = useState(true);
  const [docId, setDocId] = useState(
    isEditing ? ed.id : (preselect?.docId || '')
  );
  // Antes acá se pedía el número de cotización AL MONTAR, y eso tenía dos problemas: un viaje a la
  // red en el camino de apertura del POS, y —peor— `siguiente_correlativo` INCREMENTA el contador,
  // así que abrir la pantalla sin guardar nada quemaba un número de la serie. Se detectó midiendo:
  // el contador `S` iba en 38006 con solo 27 cotizaciones guardadas por encima de 37921, o sea ~58
  // números perdidos. El id no se necesita antes de guardar: `handleSave*` pide el correlativo justo
  // antes del INSERT (y ya lo hacía, así que el número del montaje se descartaba igual).

  // Document form fields
  const [tipoVenta, setTipoVenta]       = useState(isEditing ? (ed.tipo_venta     || 'regular')   : (saved?.tipoVenta    || 'regular'));
  const [vencimiento, setVencimiento]   = useState(isEditing ? (ed.vencimiento    || '')           : (saved?.vencimiento  || ''));
  const [terminosPago, setTerminosPago] = useState(isEditing ? (ed.terminos_pago  || 'inmediato')  : (saved?.terminosPago || 'inmediato'));
  const [vendedor, setVendedor]         = useState(isEditing ? (ed.vendedor       || '')           : (saved?.vendedor     || ''));
  const [fuente, setFuente]             = useState(isEditing ? (ed.fuente         || '')           : (saved?.fuente       || ''));
  const [idCrm, setIdCrm]               = useState(isEditing ? (ed.id_crm         || '')           : (saved?.idCrm        || ''));
  const [tipoEntrega, setTipoEntrega]   = useState(isEditing ? (ed.tipo_entrega   || window.ssEntregaPorDefecto()) : (saved?.tipoEntrega  || window.ssEntregaPorDefecto()));
  const [zonaDelivery, setZonaDelivery] = useState(isEditing ? (ed.zona_delivery  || '')           : (saved?.zonaDelivery || ''));
  const [nroDespacho, setNroDespacho]   = useState(isEditing ? (ed.nro_despacho   || '')           : (saved?.nroDespacho  || ''));
  const [observaciones, setObservaciones] = useState(isEditing ? (ed.observaciones || '')          : (saved?.observaciones|| ''));
  const [dirFactura, setDirFactura]     = useState(isEditing ? (ed.dir_factura    || '')           : (saved?.dirFactura   || ''));
  const [dirEntrega, setDirEntrega]     = useState(isEditing ? (ed.dir_entrega    || '')           : (saved?.dirEntrega   || ''));

  // Descuento general del documento e IVA
  const [docDescuento, setDocDescuento] = useState(
    isEditing ? (ed.descuento_doc || 0) : (saved?.docDescuento || 0)
  );
  // Editando: se respeta lo que tiene el documento. Cotización NUEVA: SIEMPRE apagado — ya no se
  // lee del borrador (ver el efecto de lsSave más abajo).
  const [aplicarIva, setAplicarIva] = useState(
    isEditing ? (ed.aplica_iva !== false) : false
  );

  // Condiciones expandidas/colapsadas
  const [showConditions, setShowConditions] = useState(false);
  // El catálogo tiene UNA vista (tabla). Se borra la preferencia de la vista de tarjetas para no
  // dejar la clave muerta en el navegador de quien la había elegido.
  React.useEffect(() => { try { localStorage.removeItem('ss-pos-catalogview2'); } catch (e) {} }, []);
  const [listSort, setListSort] = React.useState({ key: 'nombre', dir: 'asc' });
  function toggleListSort(key) { setListSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }); }
  // Override manual de lista de precios — null = usa la del cliente
  const [listaPrecioOverride, setListaPrecioOverride] = React.useState(saved?.listaPrecioOverride ?? null);
  // Drawer del carrito. En móvil arranca CERRADO: a ese ancho es un bottom-sheet a pantalla
  // completa que tapa todo el catálogo, y abrirlo antes de que el usuario haya agregado nada
  // (o siquiera visto qué hay para vender) es peor que mostrarlo bajo demanda con el FAB.
  const [cartOpen, setCartOpen] = useState(() => window.innerWidth > 768);
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth <= 768);
  useEffect(() => {
    function onResize() { setIsMobileViewport(window.innerWidth <= 768); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // Ancho por defecto más generoso (2026-08-14, pedido explícito con captura): 380px dejaba el
  // carrito muy angosto ni bien se abría; 520 es el que antes había que pedir a mano con "Expandir".
  const [cartWidth, setCartWidth] = useState(() => parseInt(localStorage.getItem('ss-pos-cart-width')) || 520);
  // Modo del carrito: 'drawer' (panel lateral, default) | 'popup' (modal flotante).
  // Solo se cambia con el botón ↗ del header del carrito mientras está abierto.
  // Cualquier botón "Carrito" siempre abre en modo drawer.
  const [cartMode, setCartMode] = React.useState('drawer');
  // X en popup → vuelve al drawer (posición original); X en drawer → cierra el carrito.
  function dismissCart() {
    if (cartMode === 'popup') { setCartMode('drawer'); return; }
    setCartOpen(false);
  }
  const isDragging = React.useRef(false);
  const dragStartX = React.useRef(0);
  const dragStartW = React.useRef(0);

  function onResizerMouseDown(e) {
    e.preventDefault();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartW.current = cartWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onResizerMouseMove);
    document.addEventListener('mouseup', onResizerMouseUp);
  }
  function onResizerMouseMove(e) {
    if (!isDragging.current) return;
    const delta = dragStartX.current - e.clientX;
    const newW = Math.max(280, Math.min(700, dragStartW.current + delta));
    setCartWidth(newW);
  }
  function onResizerMouseUp() {
    isDragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onResizerMouseMove);
    document.removeEventListener('mouseup', onResizerMouseUp);
    setCartWidth(w => { localStorage.setItem('ss-pos-cart-width', String(w)); return w; });
  }
  // Ancho del carrito en modo popup (centrado con translate(-50%)): se guarda aparte del ancho del
  // drawer porque son dos anclajes distintos (lateral vs flotante centrado).
  const [cartPopupWidth, setCartPopupWidth] = useState(() => parseInt(localStorage.getItem('ss-pos-cart-popup-width')) || 560);
  const isDraggingPopup = React.useRef(false);
  const dragStartXPopup = React.useRef(0);
  const dragStartWPopup = React.useRef(0);
  function onPopupResizerMouseDown(e) {
    e.preventDefault();
    isDraggingPopup.current = true;
    dragStartXPopup.current = e.clientX;
    dragStartWPopup.current = cartPopupWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onPopupResizerMouseMove);
    document.addEventListener('mouseup', onPopupResizerMouseUp);
  }
  function onPopupResizerMouseMove(e) {
    if (!isDraggingPopup.current) return;
    // Centrado (translate -50%): agrandar de un solo borde corre el ancho el doble a cada lado.
    const delta = (e.clientX - dragStartXPopup.current) * 2;
    const newW = Math.max(420, Math.min(window.innerWidth * 0.96, dragStartWPopup.current + delta));
    setCartPopupWidth(newW);
  }
  function onPopupResizerMouseUp() {
    isDraggingPopup.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onPopupResizerMouseMove);
    document.removeEventListener('mouseup', onPopupResizerMouseUp);
    setCartPopupWidth(w => { localStorage.setItem('ss-pos-cart-popup-width', String(w)); return w; });
  }
  // Quick-create cliente/contacto desde el selector
  const [quickCreate, setQuickCreate] = useState(null); // null | { type:'cliente'|'contacto', nombre:string }

  // Flying icon + saving
  const [flyIcon, setFlyIcon] = useState(null);
  const [saving, setSaving]   = useState(false);
  // { id, slug, lines } — el documento "vivo" del compositor. EDITANDO arranca con el que se abrió:
  // ya tiene id, slug y tipo, así que la barra de acciones (PDF, copiar enlace, confirmar pedido,
  // ir a la orden) tiene que estar desde el primer render. Antes solo se llenaba al guardar, y
  // editar una cotización mostraba el carrito sin ninguna de esas acciones hasta pulsar Guardar
  // — reportado el 2026-08-11 sobre S38169: "ya no me salen los botones de abajo".
  const [savedCot, setSavedCot] = useState(
    editingDoc ? { id: editingDoc.id, slug: editingDoc.slug || null,
                   tipo: editingDoc.tipo || editingDoc.estado, lines: editingDoc.lines || [] }
               : null);
  const pipeRefs    = useRef({});
  const saveCotRef  = useRef(null);
  const actionRef   = useRef(null);
  const verFlujoRef = useRef(null);

  // Client resolution
  const contacto = (SSData.contactos || []).find(c => c.id === clienteId);
  const cliente = contacto
    ? SSData.clientes.find(c => c.id === contacto.cliente_id)
    : SSData.clientes.find(c => c.id === clienteId);
  const cliListaId = cliente?.listaPrecio;
  const effectiveListaId = listaPrecioOverride || cliListaId;
  const listaPrecio = SSData.listasPrecios.find(l => l.id === effectiveListaId);
  const descuento = listaPrecio?.valor || 0;

  // El catálogo de clientes ya no se descarga completo al iniciar (el selector busca contra el
  // servidor), así que el cliente del borrador guardado o del documento que se está editando
  // puede no estar en memoria. Sin él el composer no muestra su nombre y —más grave— no
  // aplica su lista de precios, sus condiciones de crédito ni sus direcciones: se cotizaría a
  // precio de lista general sin que nadie lo note. Se hidrata por id.
  useEffect(() => {
    if (!clienteId || cliente || contacto) return;
    window.ensureClienteOContacto?.(clienteId);
  }, [clienteId, cliente, contacto]);

  // Auto-fill from client defaults when client is first selected
  useEffect(() => {
    if (!cliente || isEditing) return;
    if (!dirFactura) setDirFactura(cliente.dir_factura || cliente.direccion || cliente.ciudad || '');
    if (!dirEntrega) setDirEntrega(cliente.dir_entrega || cliente.direccion || cliente.ciudad || '');
    // Adoptar términos a crédito solo si el cliente tiene línea de crédito (límite > 0); si no,
    // inmediato. Y nunca por encima de los días aprobados en su ficha: si el plazo guardado quedó
    // más alto que su línea (dato viejo o mal cargado), se recorta al tope real en vez de arrastrar
    // un plazo que el cliente no tiene.
    const _lim   = parseFloat(cliente.limiteCredito) || 0;
    const _dias  = parseInt(cliente.diasCredito) || 0;
    const _plazo = parseInt(cliente.terminos_pago) || 0;
    setTerminosPago((_lim > 0 && _dias > 0 && _plazo > 0) ? String(Math.min(_plazo, _dias)) : 'inmediato');
    // La entrega y su zona se REEMPLAZAN, no se completan solo si están vacías: al cambiar de
    // cliente a mitad del documento, un `if (cliente.tipo_entrega)` dejaba puesto el delivery
    // —y la zona de envío— del cliente ANTERIOR. Se despacharía a la dirección equivocada.
    // El cliente sin entrega asignada vuelve al valor por defecto, no hereda el de nadie.
    setTipoEntrega(cliente.tipo_entrega || window.ssEntregaPorDefecto());
    setZonaDelivery(cliente.zona_delivery || '');
    if (cliente.vendedor)      setVendedor(cliente.vendedor);
    if (cliente.fuente)        setFuente(cliente.fuente);
    if (cliente.tipo_venta)    setTipoVenta(cliente.tipo_venta);
    if (cliente.observaciones) setObservaciones(obs => obs || cliente.observaciones);
  }, [clienteId]);

  // Limpiar entradas stale: SKUs en cart que ya no existen en SSData.productos
  // (típico al rehidratar de localStorage tras borrar/cambiar productos)
  useEffect(() => {
    if (!SSData.productos || SSData.productos.length === 0) return;
    const validSkus = new Set(SSData.productos.map(p => p.sku));
    const pruned = cart.filter(ci => validSkus.has(ci.sku));
    if (pruned.length !== cart.length) setCart(pruned);
  }, [SSData.productos]);

  // Persist to localStorage (omitir en modo edición)
  useEffect(() => {
    if (isEditing) return;
    // La cobertura NO va al borrador. Un ajuste manual es de ESTE documento; guardarlo lo
    // arrastraba a todas las cotizaciones siguientes de ese navegador (así nació el "BCV +33%"
    // con el sistema en 35%). El borrador conserva el carrito, no la política de precios.
    //
    // El IVA tampoco, por lo mismo: cobrar IVA es una decisión de ESA venta (depende del cliente y
    // del tipo de factura), no una preferencia del navegador. Guardándolo, quien lo prendía una vez
    // arrancaba TODAS sus cotizaciones siguientes con IVA — y el monto salía mal sin que nadie
    // tocara el botón. Una cotización nueva siempre arranca con el IVA apagado.
    lsSave({ cart, cartInternos, cartGarantias, clienteId, almacenId, tipoVenta, vencimiento, terminosPago,
      vendedor, fuente, idCrm, tipoEntrega, zonaDelivery, nroDespacho,
      observaciones, dirFactura, dirEntrega, modalidadPago, docDescuento,
      listaPrecioOverride });
  }, [cart, cartInternos, cartGarantias, clienteId, almacenId, tipoVenta, vencimiento, terminosPago,
      vendedor, fuente, idCrm, tipoEntrega, zonaDelivery, nroDespacho,
      observaciones, dirFactura, dirEntrega, modalidadPago, docDescuento,
      listaPrecioOverride]);

  // Options
  // Índice cliente_id → cliente. Mismo criterio que el `clienteMap` de DocumentList:
  // O(1) en vez de un find por fila.
  const clientesById = useMemo(() => {
    const m = new Map();
    (SSData.clientes || []).forEach(c => m.set(c.id, c));
    return m;
  }, [SSData.clientes, SSData.clientes?.length]);

  // ESTO ERA EL CUELLO DE BOTELLA DEL COMPOSER. Se armaba en cada render y hacía un
  // `find` lineal sobre clientes por cada contacto: con los 13.091 clientes y 13.140
  // contactos de `demo1` son ~86 millones de comparaciones = **422 ms medidos**.
  // Como React re-renderiza POSPage ante cualquier cambio de estado, ese costo se
  // pagaba al tocar +/− en una cantidad, al agregar un producto o al cambiar la lista
  // de precios — de ahí la sensación de que "el POS tarda en cargar" al hacer clic.
  // Con el Map baja a ~3 ms, y el useMemo hace que solo se recalcule cuando de verdad
  // cambian los clientes o los contactos.
  const clientContactOptions = useMemo(() => [
    ...(SSData.clientes || []).map(c => ({ value: c.id, label: c.nombre, sublabel: c.rif, group: 'Clientes' })),
    ...(SSData.contactos || []).map(ct => {
      const cl = clientesById.get(ct.cliente_id);
      return { value: ct.id, label: ct.nombre, sublabel: `${ct.cargo || ''} · ${cl?.nombre || ''}`, group: 'Contactos' };
    }),
  ], [clientesById, SSData.contactos, SSData.contactos?.length]);

  const productos = useMemo(() => SSData.productos.filter(p => {
    if (categoria) {
      const a = (p.categoria||'').trim().toLowerCase();
      const b = categoria.trim().toLowerCase();
      if (a !== b) return false;
    }
    if (marcaFilter) {
      const a = (p.marca||'').trim().toLowerCase();
      const b = marcaFilter.trim().toLowerCase();
      if (a !== b) return false;
    }
    if (!window.AdvancedSearch.matches(searchTerms, p.nombre, p.sku, p.marca)) return false;
    // Los SERVICIOS (flete, mano de obra) no tienen existencias: el filtro "solo con stock" los
    // escondía siempre, o sea que con el filtro puesto el flete no se podía encontrar nunca.
    if (soloConStock && !p.servicio) {
      const inv = getDisponible(p.sku, almacenId);
      if (inv.disponible <= 0) return false;
    }
    return true;
    // SSData.productos en deps: con el snapshot slim los productos se aplican async
    // (fuera del gate de Fase 1), DESPUÉS del primer render. Sin esta dep el useMemo
    // conservaba la lista filtrada vacía aunque SSData.productos ya estuviera poblado.
  }), [searchTerms, categoria, marcaFilter, soloConStock, almacenId, SSData.productos]);

  // Orden de la vista lista. Estaba inline en `items={(() => {...})()}` del VirtualList,
  // o sea que ordenaba los 6.587 productos en cada render (12 ms medidos con
  // localeCompare) aunque el cambio de estado no tuviera nada que ver con el orden.
  // El comparador se elige una vez, fuera del sort, en lugar de encadenar 6 ifs por
  // comparación (~13 por elemento).
  const productosOrdenados = useMemo(() => {
    const d = listSort.dir === 'asc' ? 1 : -1;
    // Collator cacheado en vez de `localeCompare` por comparación (misma semántica,
    // ~35% más rápido). Opciones por defecto a propósito: activar `numeric` o
    // `sensitivity` cambiaría el orden que hoy ve el vendedor, y acá solo se buscaba
    // dejar de reordenar en cada render.
    const coll = new Intl.Collator('es');
    const precioOf = p => p.base * (1 - descuento / 100);
    const margenOf = p => {
      const bp = precioOf(p);
      const cu = p.costo || 0;
      return bp > 0 && cu > 0 ? ((bp - cu) / bp) * 100 : -Infinity;
    };
    const cmp = {
      sku:    (a, b) => coll.compare(a.sku, b.sku),
      cat:    (a, b) => coll.compare((a.marca||'')+(a.categoria||''), (b.marca||'')+(b.categoria||'')),
      costo:  (a, b) => (a.costo||0) - (b.costo||0),
      precio: (a, b) => precioOf(a) - precioOf(b),
      margen: (a, b) => margenOf(a) - margenOf(b),
      stock:  (a, b) => getDisponible(a.sku, almacenId).disponible - getDisponible(b.sku, almacenId).disponible,
    }[listSort.key] || ((a, b) => coll.compare(a.nombre, b.nombre));
    return productos.slice().sort((a, b) => d * cmp(a, b));
  }, [productos, listSort, descuento, almacenId]);

  // Los dos <select> del catálogo recorrían los 6.587 productos (dos Set + dos sort con
  // localeCompare) en cada render para armar opciones que solo cambian si cambia el
  // catálogo.
  const categoriaOptions = useMemo(
    () => [...new Set((SSData.productos || []).map(p => p.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')),
    [SSData.productos, SSData.productos?.length]);
  const marcaOptions = useMemo(
    () => [...new Set((SSData.productos || []).map(p => p.marca).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')),
    [SSData.productos, SSData.productos?.length]);

  const canEditPrice     = window.canUser?.('editar', 'pos_precio')     ?? true;
  const canEditVendedor  = window.canUser?.('editar', 'pos_vendedor')  ?? true;
  const canEditCobertura = window.canUser?.('editar', 'pos_cobertura') ?? false;
  const cartDetails = cart.map(ci => {
    const p = SSData.productos.find(pp => pp.sku === ci.sku);
    if (!p) return null;
    const listaPrice = p.base * (1 - descuento/100);
    const itemPrice = listaPrice * (1 - (ci.extraDescuento || 0)/100);
    const baseManual = ci.precioManual != null ? ci.precioManual : itemPrice;
    const precio = modalidadPago === 'bcv' ? baseManual * (1 + cobertura/100) : baseManual;
    const inv = getDisponible(ci.sku, almacenId);
    // In editing mode, the current doc's own committed qty doesn't count as hold
    const disponible = isEditing
      ? Math.min(inv.stock, inv.disponible + (ci.qty || 0))
      : inv.disponible;
    return { ...p, ...ci, precio, precioBase: baseManual, subtotal: precio * ci.qty,
      stock: inv.stock, enOrden: inv.enOrden, disponible };
  }).filter(Boolean);

  const subtotal = cartDetails.reduce((s, i) => s + i.subtotal, 0);
  const docDescuentoAmt = subtotal * (docDescuento / 100);
  const subtotalNet = subtotal - docDescuentoAmt;
  const iva = aplicarIva ? subtotalNet * 0.16 : 0;
  const total = subtotalNet + iva;

  // Crédito: el cliente puede comprar a crédito solo si tiene línea (límite > 0).
  // El SALDO A FAVOR (anticipos sin consumir) SUMA al disponible: es plata que el
  // cliente ya entregó, así que no tiene sentido que su límite la ignore.
  const saldoAnticipos      = window.getSaldoAnticipos?.(clienteId) || 0;
  const clientePuedeCredito = (parseFloat(cliente?.limiteCredito) || 0) > 0;
  const creditoDisponible   = (parseFloat(cliente?.limiteCredito) || 0)
                            - (parseFloat(cliente?.deuda) || 0)
                            + saldoAnticipos;
  const esVentaCredito      = !!(terminosPago && terminosPago !== 'inmediato');
  const excedeCredito       = clientePuedeCredito && esVentaCredito && total > creditoDisponible;
  const diasCredito         = parseInt(cliente?.diasCredito) || 0;

  // Plazos ofrecidos = SOLO hasta los días que el cliente tiene en su ficha (módulo Clientes).
  // Antes la lista era fija (7/15/30/45/60) sin mirar al cliente, así que a uno con 7 días de
  // crédito se le podía emitir a 60. Se agregan dos casos aparte de los plazos estándar:
  //  - el plazo exacto del cliente, si no es uno de los estándar (ej. 20 días);
  //  - el plazo del documento que se está editando, para no perder (ni reescribir en silencio)
  //    el de un documento viejo cuyo cliente después cambió de condiciones.
  const PLAZOS_STD = [7, 15, 30, 45, 60];
  const plazosCredito = useMemo(() => {
    const set = new Set();
    if (clientePuedeCredito && diasCredito > 0) {
      PLAZOS_STD.forEach(d => { if (d <= diasCredito) set.add(d); });
      set.add(diasCredito);
    }
    const actual = parseInt(terminosPago) || 0;
    if (actual > 0) set.add(actual);
    return [...set].sort((a, b) => a - b);
  }, [clientePuedeCredito, diasCredito, terminosPago]);
  const tasaRef = modalidadPago === 'paralelo' ? (tasaParaleloDoc || 0) : tasa.bcv;
  const totalBs = total * tasaRef;

  function _doAddProduct(p) {
    const ex = cart.find(c => c.sku === p.sku);
    if (ex) setCart(cart.map(c => c.sku === p.sku ? {...c, qty: c.qty + 1} : c));
    else {
      setCart([...cart, { sku: p.sku, qty: 1, extraDescuento: 0, precioManual: null }]);
      // Default garantía solo al agregar la primera vez (no sobreescribir si ya hay valor)
      setCartGarantias(prev => prev[p.sku] ? prev : {
        ...prev,
        [p.sku]: { meses: p.garantia_meses != null ? String(p.garantia_meses) : '', condiciones: '' }
      });
    }
  }
  function addProduct(p) {
    // Aviso NO bloqueante de sobregiro. Una cotización/orden PUEDE crearse aunque no haya
    // disponible: las cantidades quedan en hold (disponible negativo) hasta reponer inventario.
    // El stock solo se EXIGE al FACTURAR (ver executePromote / doAction nextSt==='factura').
    try {
      // Un servicio (flete, mano de obra) no tiene existencias: el aviso de sobregiro diría
      // "disponible 0 · no vas a poder facturar", que es falso y asusta. Ver migración 42.
      if (p.servicio) { _doAddProduct(p); return; }
      const info = window.getDisponible(p.sku, almacenId);
      const enOrden = info?.enOrden || 0;
      const ex = cart.find(c => c.sku === p.sku && !c._section);
      const cartQty = (ex ? ex.qty : 0) + 1; // qty resultante después del add
      const stockTotal = info.stock || 0;
      if (cartQty + enOrden > stockTotal) {
        const disponibleParaMi = Math.max(0, stockTotal - enOrden);
        showPosToast(
          `⚠ ${p.nombre}: disponible ${disponibleParaMi}. Podés crear la orden (queda en hold), pero NO podrás facturar hasta reponer inventario.`,
          'error'
        );
      }
    } catch (_) { /* fail-safe: no bloquear el flujo si algo falla */ }
    _doAddProduct(p);
  }
  function updateQty(sku, qty) {
    if (qty <= 0) setCart(cart.filter(c => c.sku !== sku));
    else setCart(cart.map(c => c.sku === sku ? {...c, qty} : c));
  }
  function updateExtraDescuento(sku, pct) {
    const v = Math.max(0, Math.min(100, Number(pct) || 0));
    setCart(cart.map(c => c.sku === sku ? {...c, extraDescuento: v} : c));
  }
  function updatePrecio(sku, val) {
    if (val === '' || val === null) { setCart(cart.map(c => c.sku === sku ? {...c, precioManual: null} : c)); return; }
    const typed = Math.max(0, parseFloat(val) || 0);
    // El precio tipeado es siempre la base USD. La cobertura BCV se aplica
    // por encima en el render (cartDetails) y en los totales.
    setCart(cart.map(c => c.sku === sku ? {...c, precioManual: typed} : c));
  }
  function addSection() {
    const newSec = { _section: true, id: 'sec-' + Date.now(), label: '' };
    if (addBtnPos == null) {
      setCart(prev => [...prev, newSec]);
    } else {
      setCart(prev => { const arr = prev.slice(); arr.splice(addBtnPos, 0, newSec); return arr; });
      setAddBtnPos(addBtnPos + 1);
    }
  }
  function updateSection(id, label) { setCart(prev => prev.map(c => (c._section && c.id === id) ? {...c, label} : c)); }
  function removeSection(id) { setCart(prev => prev.filter(c => !(c._section && c.id === id))); }
  function vaciarCarrito() {
    const n = cart.filter(c => !c._section).length;
    if (n === 0) return;
    if (!confirm(`¿Vaciar el carrito? Se quitarán ${n} producto(s).`)) return;
    setCart([]); setCartInternos({}); setCartGarantias({});
  }

  // Drag-and-drop reordering del carrito (items, secciones y barra "+ Añadir sección")
  const [dragIdx, setDragIdx]         = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [addBtnPos, setAddBtnPos]     = useState(null);  // null = al final; número = ANTES del cart[idx]
  const [draggingAddBtn, setDraggingAddBtn] = useState(false);
  function onCartDragStart(e, idx) {
    setDragIdx(idx);
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); } catch (_) {}
  }
  function onCartDragOver(e, idx) {
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
    if (dragOverIdx !== idx) setDragOverIdx(idx);
  }
  function onCartDragLeave() { setDragOverIdx(null); }
  function onCartDrop(e, toIdx) {
    e.preventDefault();
    const data = (() => { try { return e.dataTransfer.getData('text/plain'); } catch (_) { return ''; }})();
    if (data === '__addbtn__' || draggingAddBtn) {
      setAddBtnPos(toIdx);
      setDraggingAddBtn(false); setDragIdx(null); setDragOverIdx(null);
      return;
    }
    const from = dragIdx != null ? dragIdx : Number(data);
    setDragIdx(null); setDragOverIdx(null);
    if (from == null || Number.isNaN(from) || from === toIdx) return;
    setCart(prev => {
      const arr = prev.slice();
      const [m] = arr.splice(from, 1);
      const target = from < toIdx ? toIdx - 1 : toIdx;
      arr.splice(target, 0, m);
      return arr;
    });
    // Si el botón "+Añadir sección" estaba después del item movido, ajustar su posición
    if (addBtnPos != null) {
      let next = addBtnPos;
      if (from < addBtnPos) next -= 1;
      if (toIdx <= next)    next += 1;
      if (next !== addBtnPos) setAddBtnPos(next);
    }
  }
  function onCartDragEnd() { setDragIdx(null); setDragOverIdx(null); setDraggingAddBtn(false); }
  function cartDragProps(idx) {
    const isDragging = dragIdx === idx;
    const isOver     = dragOverIdx === idx && dragIdx !== idx;
    return {
      draggable: true,
      onDragStart: e => onCartDragStart(e, idx),
      onDragOver:  e => onCartDragOver(e, idx),
      onDragLeave: onCartDragLeave,
      onDrop:      e => onCartDrop(e, idx),
      onDragEnd:   onCartDragEnd,
      style: {
        opacity:   isDragging ? 0.4 : undefined,
        borderTop: isOver ? '2px solid var(--brand)' : undefined,
        cursor:    'grab',
      },
    };
  }
  function addBtnDragProps() {
    return {
      draggable: true,
      onDragStart: e => {
        setDraggingAddBtn(true);
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', '__addbtn__'); } catch (_) {}
      },
      onDragEnd: onCartDragEnd,
      style: { opacity: draggingAddBtn ? 0.4 : undefined, cursor: 'grab' },
    };
  }

  const stages = ['cotizacion','orden','factura','despacho'];
  const stageLabel = { cotizacion: 'Cotización', orden: 'Orden', factura: 'Factura', despacho: 'Despacho' };
  const stageIdx = stages.indexOf(stage);

  function advance() {
    const next = stages[stageIdx + 1];
    if (!next) return;
    setStage(next);
    const pfx = { orden:'ORD', despacho:'DSP', factura:'NDE' };
    setDocId(`${pfx[next]}-2026-${2000 + Math.floor(Math.random()*900)}`);
  }

  function triggerFly(btnRef, target) {
    const btn = btnRef.current;
    const pipe = target?.current !== undefined ? target.current : pipeRefs.current[target];
    if (!btn || !pipe) return;
    const b = btn.getBoundingClientRect();
    const p = pipe.getBoundingClientRect();
    setFlyIcon({
      key: Date.now(),
      startX: b.left + b.width / 2 - 15,
      startY: b.top - 15,
      endX: p.left + p.width / 2 - 15,
      endY: p.top + p.height / 2 - 15,
    });
  }

  function resetPOS() {
    setCart([]); setCartInternos({}); setCartGarantias({}); setClienteId(''); setAlmacenId(getAlmacenDefault());
    setStage('cotizacion'); setCategoria('');
    setDocId(`COT-2026-${Math.floor(Math.random()*900)+100}`);
    setTipoVenta('regular'); setVencimiento(''); setTerminosPago('inmediato');
    setVendedor(''); setFuente(''); setIdCrm(''); setTipoEntrega('retiro');
    setZonaDelivery(''); setNroDespacho(''); setObservaciones('');
    setDirFactura(''); setDirEntrega(''); setShowConditions(false);
    setModalidadPago('divisas');
    setDocDescuento(0); setAplicarIva(false);
    setCoberturaDoc(tasaCobertura); setListaPrecioOverride(null);
    lsClear();
    setSavedCot(null);
    setDraftRecovered(false);
  }

  // Descartar el borrador recuperado y arrancar de cero (acción del banner).
  function discardDraft() {
    resetPOS();
    showPosToast('Borrador descartado', 'success');
  }

  function buildDocData(tipo, id) {
    const actualClienteId = contacto ? contacto.cliente_id : clienteId;
    const contactoId = contacto ? clienteId : null;
    const estado0 = { cotizacion: 'creada', orden: 'generada', factura: 'por_cobrar', despacho: 'por_despachar' }[tipo] || tipo;
    return {
      id, tipo, estado: estado0,
      cliente_id:   actualClienteId,
      contacto_id:  contactoId,
      almacen_id:   almacenId,
      fecha:        window.localDateStr(),
      vencimiento:  vencimiento || null,
      tipo_venta:   tipoVenta,
      terminos_pago: terminosPago,
      vendedor:     vendedor || null,
      fuente:       fuente || null,
      id_crm:       idCrm || null,
      tipo_entrega: tipoEntrega,
      zona_delivery: zonaDelivery || null,
      nro_despacho: nroDespacho || null,
      observaciones: observaciones || null,
      dir_factura:  dirFactura || null,
      dir_entrega:  dirEntrega || null,
      subtotal:     Math.round(subtotalNet * 100) / 100,
      iva:          Math.round(iva * 100) / 100,
      total:        Math.round(total * 100) / 100,
      descuento_pct: descuento,
      descuento_doc: docDescuento,
      aplica_iva:   aplicarIva,
      modalidad_pago: modalidadPago,
      cobertura_pct: modalidadPago === 'bcv' ? cobertura : 0,
      tasa_bcv:     tasa.bcv,
      tasa_paralelo: modalidadPago === 'paralelo' ? tasaParaleloDoc : tasa.paralelo,
      items:        cart.filter(ci => !ci._section).reduce((s, ci) => s + (Math.round(ci.qty) || 1), 0),
      creado_por:   isEditing ? (ed.creado_por || null) : (window.__ssCurrentUser?.nombre || window.currentUserRole || null),
    };
  }

  function buildItems() {
    return cart.map(ci => {
      if (ci._section) return { sku: '__SECTION__', nombre: ci.label || '', qty: 0, precio: 0, descuento: 0, descuento_extra: 0, subtotal: 0 };
      const d = cartDetails.find(x => x.sku === ci.sku);
      if (!d) return null;
      const interno = cartInternos[d.sku] || {};
      const gar     = cartGarantias[d.sku] || {};
      const garMeses = (gar.meses !== '' && gar.meses != null && !isNaN(parseInt(gar.meses))) ? parseInt(gar.meses) : null;
      return { sku: d.sku, nombre: d.nombre, qty: d.qty, precio: Math.round(d.precio * 100) / 100, descuento, descuento_extra: d.extraDescuento || 0, subtotal: Math.round(d.subtotal * 100) / 100, proveedor_id: interno.proveedor_id || null, costo: parseFloat(interno.costo) || 0, garantia_meses: garMeses, garantia_condiciones: (gar.condiciones || '').trim() || null };
    }).filter(Boolean);
  }

  function validateCampos() {
    const errs = [];
    if (cart.filter(c => !c._section).length === 0) errs.push('Carrito vacío — agrega al menos un producto');
    // El cliente es OBLIGATORIO siempre, fuera de camposConfig: no es una preferencia de la
    // empresa sino una invariante del documento. Un documento sin cliente no se puede cobrar,
    // despachar ni reportar, y no hay forma de recuperarlo después salvo yendo a la fuente
    // original (así aparecieron los 1.350 documentos huérfanos de la migración de Odoo).
    if (!clienteId) errs.push('Cliente — es obligatorio, ningún documento puede quedar sin cliente');
    // En BCV el precio ES precio × (1 + cobertura). Si la cobertura del sistema no llegó, guardar
    // significaría cobrar de menos sin que nadie se enterara: se bloquea en vez de asumir un valor.
    if (modalidadPago === 'bcv' && cobertura == null) {
      errs.push('Cobertura BCV — no hay un porcentaje configurado; abrí el panel de tasas antes de cotizar en BCV');
    }
    const checks = [
      ['cliente',        clienteId,    'Cliente / Contacto'],
      ['modalidad_pago', modalidadPago,'Modalidad de pago'],
      ['tipo_venta',     tipoVenta,    'Tipo de venta'],
      ['vencimiento',    vencimiento,  'Fecha de vencimiento'],
      ['terminos_pago',  terminosPago, 'Términos de pago'],
      ['vendedor',       vendedor,     'Vendedor asignado'],
      ['fuente',         fuente,       'Fuente / Canal'],
      ['tipo_entrega',   tipoEntrega,  'Tipo de entrega'],
      ['zona_delivery',  zonaDelivery, 'Zona de delivery'],
      ['nro_despacho',   nroDespacho,  'Nro. despacho SOS'],
      ['dir_factura',    dirFactura,   'Dirección de factura'],
      ['dir_entrega',    dirEntrega,   'Dirección de entrega'],
      ['observaciones',  observaciones,'Observaciones'],
    ];
    for (const [id, val, label] of checks) {
      if (isRequired(id) && !val) errs.push(label);
    }
    return errs;
  }

  function handleSaveCot() {
    const errs = validateCampos();
    if (errs.length > 0) { setCamposErrors(errs); showPosToast(errs[0]); return; }
    setCamposErrors([]);
    setShowConfirmCot(true);
  }

  // ── Confirmar el pedido SIN salir del POS ──────────────────────────────────────────────────
  // La barra de éxito solo ofrecía PDF y link. Para convertir la cotización en orden había que
  // salir del POS, esperar que cargara la lista, buscar la cotización de nuevo y recién ahí
  // aparecía el botón. Es el paso más repetido del flujo y era el más largo.
  const [confirmandoPedido, setConfirmandoPedido] = useState(false);
  const confirmarLock = React.useRef(false);
  const [ordenCreada, setOrdenCreada] = useState(null);

  // ── El carrito ya generó su documento ─────────────────────────────────────────────────────
  //
  // El compositor NO avanza `stage` al crear el hijo (`advance()` quedó sin usar), así que
  // después de convertir una cotización el botón grande seguía diciendo "Convertir a Orden"
  // sobre un carrito que YA era una orden. Reportado el 2026-08-07: "cuando estamos en la etapa
  // orden de venta no puede aparecer el botón de convertir a orden".
  //
  // No es solo confuso: un segundo clic crea una SEGUNDA orden con su propia reserva de
  // inventario sobre el mismo stock. El aviso de contenido repetido (`ordenesConMismoContenido`)
  // no bloquea a propósito —repetir una compra idéntica es legítimo—, así que el freno va acá.
  //
  // El botón chico del banner ya se había arreglado mirando `savedCot.tipo`; el principal no.
  // Mismo criterio que el detalle del documento: en vez del botón, a dónde fue.
  const _HIJO_NOMBRE = { orden: 'la orden de venta', factura: 'la factura', despacho: 'la nota de despacho' };
  const _HIJO_HECHO  = { orden: 'convertida', factura: 'facturada', despacho: 'despachada' };
  const _HIJO_RUTA   = { orden: '/ordenes', factura: '/facturas', despacho: '/despachos' };
  // `isEditing ? null` es OBLIGATORIO acá: editando, `savedCot` ES el documento abierto (se inicia
  // con él), así que sin el guard una orden en edición diría "Ya facturada · <ella misma>". En modo
  // edición el botón primario ni se renderiza; el aviso de "ya se convirtió" vive en el banner.
  const docHijo = isEditing ? null : (
    ordenCreada ? { ...ordenCreada, tipo: 'orden' }
    : (savedCot && savedCot.tipo && savedCot.tipo !== 'cotizacion') ? savedCot
    : null);
  // "Ver orden · ORD-…" tiene que abrir ESA orden, no su lista. Antes navegaba a `/ordenes` y el
  // usuario quedaba buscando su documento entre miles; peor todavía si el compositor estaba en modo
  // edición, porque `editingDoc` gana en el render de POSPage y la pantalla no cambiaba en absoluto
  // ("no hace nada en ningún momento", 2026-08-11). `abrirDocumentoPorId` lee el tipo del server y
  // abre el detalle; si el documento ya no existe, se cae a la lista antes que dejar el clic muerto.
  async function abrirHijo(id, tipoHijo) {
    if (!id) return;
    window.invalidateDocCounts?.();
    const ok = await window.abrirDocumentoPorId?.(id);
    if (ok) return;
    const ruta = _HIJO_RUTA[tipoHijo] || '/pos/flujo';
    (window.__ssNavigate || window.location.assign.bind(window.location))(ruta);
  }
  function irAlDocHijo() { if (docHijo) abrirHijo(docHijo.id, docHijo.tipo); }

  // EDITANDO, el carrito no sabe nada del linaje del documento abierto: `ordenCreada` solo conoce
  // lo creado en ESTA sesión del compositor. Por eso una cotización que YA tenía su orden seguía
  // ofreciendo "Confirmar pedido" —y un clic ahí crea una SEGUNDA orden con su propia reserva de
  // inventario sobre el mismo stock—. Se le pregunta al SERVER, que es lo único que ve las otras
  // pestañas y a los otros usuarios; `hijosVivosDe` ya excluye las canceladas, así que una orden
  // anulada no bloquea rehacerla. Si la consulta falla devuelve {error} y el guard la descarta:
  // se cae al camino de siempre, donde `confirmarPedido` vuelve a preguntar antes de crear nada.
  useEffect(() => {
    if (!isEditing || !ed.id || (ed.tipo || ed.estado) !== 'cotizacion') return;
    let vivo = true;
    Promise.resolve(window.hijosVivosDe?.(ed.id, 'orden'))
      .then(hijos => { if (vivo && Array.isArray(hijos) && hijos.length) setOrdenCreada({ id: hijos[0].id }); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [isEditing, ed.id]);

  // Al EDITAR una cotización y guardarla se pregunta si se confirma el pedido acá mismo. Antes
  // guardar cerraba el compositor y para pasarla a orden había que volver a la lista, buscar el
  // cliente y abrir el documento otra vez — el paso más repetido del flujo era el más largo.
  const [preguntarOrden, setPreguntarOrden] = useState(false);
  async function confirmarPedido(omitirChequeoDup) {
    // El estado no corta dos clics del mismo tick (no cambia hasta el próximo render): el ref sí.
    if (confirmarLock.current) return;
    confirmarLock.current = true;
    setConfirmandoPedido(true);
    try {
      // Mismo guard que el detalle: se pregunta al SERVER si ya existe la orden (doble clic, otra
      // pestaña, otro usuario). Sin esto una cotización podía terminar con dos órdenes.
      const yaOrd = await window.hijosVivosDe?.(savedCot.id, 'orden');
      if (Array.isArray(yaOrd) && yaOrd.length > 0) {
        setOrdenCreada({ id: yaOrd[0].id });
        showPosToast(`Esta cotización ya se convirtió · ${yaOrd[0].id}`, 'error');
        return;
      }
      // Y el guard por CONTENIDO: el de linaje no ve la misma venta cargada desde otra cotización
      // ni suelta desde el compositor, que es como se acumularon las órdenes repetidas.
      if (!omitirChequeoDup) {
        const cid = contacto ? contacto.cliente_id : clienteId;
        const lineas = savedCot.lines || [];
        const dups = await window.ordenesConMismoContenido?.({ clienteId: cid, items: lineas });
        if (Array.isArray(dups) && dups.length) {
          const uds = lineas.filter(l => l.sku && l.sku !== '__SECTION__')
                            .reduce((s, l) => s + (Number(l.qty ?? l.cantidad) || 0), 0);
          setOrdenDup({ docs: dups, uds, continuar: () => confirmarPedido(true) });
          return;
        }
      }
      // La cotización se relee del server: el POS no carga documentos y `promoverDocumento` copia
      // la cabecera del padre (direcciones, términos, tasas), que en el borrador no están completas.
      const full = await window.cargarDocumentoCompleto?.(savedCot.id);
      if (!full) { showPosToast('No se pudo leer la cotización para confirmarla', 'error'); return; }
      const lineas = (full.lines && full.lines.length) ? full.lines : savedCot.lines;
      const { doc: orden, error } = await window.promoverDocumento(full, 'orden', lineas, {});
      if (error || !orden) {
        console.error('[POS] confirmarPedido', error);
        showPosToast('No se pudo confirmar el pedido', 'error');
        return;
      }
      setOrdenCreada({ id: orden.id });
      showPosToast(`Orden ${orden.id} creada`, 'success');
      window.ssActivityLog?.add(orden.id, 'creado', `Orden creada desde ${savedCot.id}`);
      window.logActivity?.({ modulo:'documentos', accion:'crear', entidad_id:orden.id, entidad_label:orden.id, detalles:{ tipo:'orden', desde: savedCot.id } });
      // El caché de páginas guarda la lista ya consultada: sin invalidar, la orden nueva no
      // aparece hasta que venza el TTL.
      window.invalidateDocCounts?.();
    } finally {
      confirmarLock.current = false;
      setConfirmandoPedido(false);
    }
  }

  async function doSaveCot() {
    setShowConfirmCot(false);
    if (isEditing) { handleUpdate(); return; }
    setSaving(true);
    // Generar ID fresco justo antes del insert para evitar colisiones por tiempo de espera
    // Sin correlativo NO se guarda: antes el respaldo era el número pedido al montar el POS, que
    // ya no se pide (quemaba un número de la serie por cada apertura).
    const currentIdBase = await window.nextDocId?.('COT');
    if (!currentIdBase) { setSaving(false); showPosToast('No se pudo obtener el número de cotización. Reintentá.'); return; }
    let currentId = currentIdBase;
    setDocId(currentId);
    let error, savedDoc;
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await window.saveDocumento(buildDocData('cotizacion', currentId), buildItems());
      error = result.error;
      if (!error) { savedDoc = result.doc; break; }
      const isConflict = error.code === '23505' || error.status === 409 || (error.message || '').includes('duplicate');
      if (!isConflict) break;
      currentId = await window.nextDocId?.('COT') || currentId;
      setDocId(currentId);
    }
    if (error) {
      setSaving(false);
      showPosToast('Error al guardar la cotización', 'error');
      console.error('[POS] Error guardando cotización:', error);
      return;
    }
    setSaving(false);
    triggerFly(saveCotRef, verFlujoRef);
    showPosToast('Cotización creada con éxito', 'success');
    window.ssActivityLog.add(currentId, 'creado', 'Cotización creada');
    window.logActivity?.({ modulo:'documentos', accion:'crear', entidad_id:currentId, entidad_label:currentId, detalles:{ tipo:'cotizacion' } });
    setSavedCot({ id: currentId, slug: savedDoc?.slug, lines: buildItems(), tipo: 'cotizacion' });
    setOrdenCreada(null);   // documento nuevo → vuelve a ofrecerse "Confirmar pedido"
    lsClear(); setDraftRecovered(false); // borrador consumido: la cotización ya está en la DB
  }

  async function handleSaveAndContinue() {
    const errs = validateCampos();
    if (errs.length > 0) { setCamposErrors(errs); showPosToast(errs[0]); return; }
    setCamposErrors([]);
    setSaving(true);
    // Sin correlativo NO se guarda: antes el respaldo era el número pedido al montar el POS, que
    // ya no se pide (quemaba un número de la serie por cada apertura).
    const currentIdBase = await window.nextDocId?.('COT');
    if (!currentIdBase) { setSaving(false); showPosToast('No se pudo obtener el número de cotización. Reintentá.'); return; }
    let currentId = currentIdBase;
    setDocId(currentId);
    let error, savedDoc;
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await window.saveDocumento(buildDocData('cotizacion', currentId), buildItems());
      error = result.error;
      if (!error) { savedDoc = result.doc; break; }
      const isConflict = error.code === '23505' || error.status === 409 || (error.message || '').includes('duplicate');
      if (!isConflict) break;
      currentId = await window.nextDocId?.('COT') || currentId;
      setDocId(currentId);
    }
    if (error) {
      setSaving(false);
      showPosToast('Error al guardar la cotización', 'error');
      console.error('[POS] Error guardando cotización:', error);
      return;
    }
    setSaving(false);
    showPosToast('Cambios guardados', 'success');
    window.ssActivityLog.add(currentId, 'creado', 'Cotización guardada');
    window.logActivity?.({ modulo:'documentos', accion:'crear', entidad_id:currentId, entidad_label:currentId, detalles:{ tipo:'cotizacion' } });
    setSavedCot({ id: currentId, slug: savedDoc?.slug, lines: buildItems(), tipo: 'cotizacion' });
    setOrdenCreada(null);   // documento nuevo → vuelve a ofrecerse "Confirmar pedido"
    lsClear(); setDraftRecovered(false); // borrador consumido: la cotización ya está en la DB
  }

  async function handleUpdateAndContinue() {
    if (!isEditing) return;
    const errs = validateCampos();
    if (errs.length > 0) { setCamposErrors(errs); showPosToast(errs[0]); return; }
    setCamposErrors([]);
    setSaving(true);
    const { error } = await window.updateDocumento(ed.id, buildDocData(stage, ed.id), buildItems(), ed);
    setSaving(false);
    // El mensaje del candado de linaje dice cuál es el documento hijo y qué hay que corregir. Un
    // "Error al guardar" pelado ahí manda a reintentar lo que nunca va a andar.
    if (error) { showPosToast(error.message || 'Error al guardar', 'error'); return; }
    triggerFly(saveCotRef, stage);
    showPosToast('Cambios guardados', 'success');
    window.ssActivityLog.add(ed.id, 'editado', 'Guardado intermedio');
    // El log con el diff (campos/líneas antes-después) ya lo escribe `updateDocumento` — repetirlo
    // acá solo duplicaba la entrada en el timeline con una versión sin detalle.
  }

  async function handleUpdate() {
    if (!isEditing) return;
    const errs = validateCampos();
    if (errs.length > 0) { setCamposErrors(errs); showPosToast(errs[0]); return; }
    setCamposErrors([]);
    setSaving(true);
    const { error } = await window.updateDocumento(ed.id, buildDocData(stage, ed.id), buildItems(), ed);
    setSaving(false);
    if (error) { showPosToast(error.message || 'Error al guardar cambios', 'error'); return; }
    triggerFly(saveCotRef, stage);
    showPosToast('Documento actualizado', 'success');
    window.ssActivityLog.add(ed.id, 'editado', 'Documento actualizado');
    // El log con el diff (campos/líneas antes-después) ya lo escribe `updateDocumento`.
    setSavedCot({ id: ed.id, slug: ed.slug || '', lines: buildItems(), tipo: stage });
    // Guardar una cotización es el momento en que se decide si ya es un pedido. Se pregunta acá
    // mismo, pero SOLO si todavía no tiene orden — y eso se consulta al server, que es lo único
    // que ve las órdenes creadas en otra pestaña o por otro usuario.
    if (stage === 'cotizacion') {
      const yaOrd = await window.hijosVivosDe?.(ed.id, 'orden');
      if (Array.isArray(yaOrd) && yaOrd.length > 0) setOrdenCreada({ id: yaOrd[0].id });
      else setPreguntarOrden(true);
    }
  }

  async function handleAction() {
    if (stageIdx >= 3) return;
    const errs = validateCampos();
    if (errs.length > 0) { setCamposErrors(errs); showPosToast(errs[0]); return; }
    setCamposErrors([]);
    if (stageIdx === 0) {
      // El número NO se inventa acá. Antes esta línea era
      //   setPendingActionId(`ORD-2026-${2000 + Math.floor(Math.random()*900)}`)
      // y ese id de mentira viajaba como `overrideId` a doAction, que lo usaba de PK real: la
      // orden nacía fuera de la serie fiscal (900 números posibles, repartidos al azar) y podía
      // chocar contra una orden ya existente. El correlativo lo asigna `nextDocId` al confirmar,
      // que es atómico y race-free.
      setPendingActionId(null);
      setShowConfirmAction(true);
      return;
    }
    await doAction();
  }

  // Crea un despacho REAL desde el compositor ruteando por crearDespacho/crear_despacho_parcial
  // (debita inventario + marca seriales). NUNCA usa saveDocumento para 'despacho': eso dejaba
  // el stock SIN descontar (fuga). Exige una factura padre PERSISTIDA con sus documentos_items
  // reales para poder pasar factura_item_id a la RPC. Si no la hay, BLOQUEA con toast.
  async function dispatchFromCompositor() {
    setShowConfirmAction(false);

    // 1) Localizar la factura padre persistida. En el flujo del compositor, el paso previo
    //    (Emitir Factura) dejó su id en savedCot. La validamos contra la DB como tipo='factura'.
    const facturaId = savedCot?.id;
    if (!facturaId) {
      showPosToast('Primero debe existir la factura para poder despachar. Emití la factura y volvé a intentar.', 'error');
      return;
    }
    setSaving(true);
    const { data: facturaRow, error: facErr } = await window.sb
      .from('documentos')
      .select('id,tipo,almacen_id,tipo_entrega,cliente_id')
      .eq('id', facturaId)
      .eq('tipo', 'factura')
      .maybeSingle();
    if (facErr) {
      setSaving(false);
      showPosToast('No se pudo verificar la factura padre. Reintentá.', 'error');
      console.error('[POS] Error verificando factura padre para despacho:', facErr);
      return;
    }
    if (!facturaRow) {
      setSaving(false);
      showPosToast('No hay factura persistida para despachar. Despachá desde el flujo de la factura, no se creó nada.', 'error');
      return;
    }

    // 2) Traer los documentos_items REALES de la factura (con su id = factura_item_id que exige la RPC).
    const { data: facItems, error: itemsErr } = await window.sb
      .from('documentos_items')
      .select('id,sku,nombre,cantidad,cantidad_despachada,precio_unitario,descuento,descuento_extra,subtotal,proveedor_id,costo,garantia_meses,garantia_condiciones')
      .eq('documento_id', facturaId);
    if (itemsErr) {
      setSaving(false);
      showPosToast('No se pudieron leer las líneas de la factura. No se despachó nada.', 'error');
      console.error('[POS] Error leyendo documentos_items de factura:', itemsErr);
      return;
    }

    const almId = getAlmacenDefault(facturaRow.almacen_id || almacenId);
    const almNombre = (SSData.almacenes || []).find(a => a.id === almId)?.nombre || almId;

    // 3) Construir lineasDespacho desde las líneas REALES de la factura, despachando el pendiente
    //    de cada una. Usamos los items de la factura (no buildItems()) porque solo ahí tenemos
    //    factura_item_id y cantidad_despachada correctos.
    const lineasDespacho = (facItems || [])
      .filter(fi => fi.sku && fi.sku !== '__SECTION__')
      .map(fi => ({
        fi,
        pendiente: Math.max(0, (Math.round(fi.cantidad) || 0) - (fi.cantidad_despachada || 0)),
      }))
      .filter(x => x.pendiente > 0)
      .map(({ fi, pendiente }) => ({
        factura_item_id: fi.id,
        sku: fi.sku, nombre: fi.nombre, qty: pendiente,
        precio: parseFloat(fi.precio_unitario) || 0,
        descuento: fi.descuento || 0, descuento_extra: fi.descuento_extra || 0,
        subtotal: (parseFloat(fi.precio_unitario) || 0) * pendiente,
        proveedor_id: fi.proveedor_id || null, costo: fi.costo || 0,
        garantia_meses: fi.garantia_meses ?? null, garantia_condiciones: fi.garantia_condiciones || null,
      }));

    if (lineasDespacho.length === 0) {
      setSaving(false);
      showPosToast('No quedan unidades pendientes por despachar en esta factura.', 'error');
      return;
    }

    // 4a) Validar stock físico suficiente en el almacén (igual que NuevoDespachoModal.handleConfirm).
    // Fix bug #5: disponible real = cantidad - reservado_de_OTROS docs (no cantidad cruda).
    // Sumamos de vuelta la reserva propia de esta factura (≈ l.qty) para no auto-bloquear.
    // Un SERVICIO (flete) no tiene fila de inventario: sin excluirlo, `cantidad 0 < qty 1` y el
    // despacho se bloqueaba con "Stock insuficiente" por el envío. La línea SÍ va al despacho —
    // tiene que ir, o la factura nunca llega a `despachada` (recalc_estado_despacho_factura suma
    // TODAS las líneas). Ver migracion-odoo/42_productos_servicio.sql.
    const sinStock = lineasDespacho.filter(l => {
      if (window.esProductoServicio?.(l.sku)) return false;
      const inv = ((SSData.inventario || {})[l.sku] || {})[almId] || {};
      const cantidad = inv.cantidad ?? 0;
      const reservadoOtros = Math.max(0, (inv.reservado ?? 0) - l.qty);
      return (cantidad - reservadoOtros) < l.qty;
    });
    if (sinStock.length) {
      setSaving(false);
      showPosToast('Stock insuficiente en ' + almNombre + ' para: ' + sinStock.map(l => l.sku).join(', '), 'error');
      return;
    }

    // 4b) SKUs serializados: se ARRASTRAN los S/N que ya estén asignados a la factura, pero
    // NO se exigen para crear el despacho (cambio de protocolo). El serial se pide al declarar
    // la entrega, en el detalle del despacho — ahí sí es obligatorio.
    const seriales = [];
    for (const l of lineasDespacho) {
      const prod = (SSData.productos || []).find(p => p.sku === l.sku);
      if (!prod?.serializado) continue;
      const { data: yaAsig } = await window.sb.from('inventario_seriales')
        .select('serial, sku').eq('sku', l.sku).eq('almacen_id', almId)
        .eq('estado', 'vendido').eq('documento_id', facturaId);
      seriales.push(...(yaAsig || []).slice(0, l.qty).map(s => ({ serial: s.serial, sku: s.sku })));
    }

    // 5) Crear el despacho vía RPC atómica (debita inventario + marca seriales en DB).
    const r = await window.crearDespacho(facturaRow, lineasDespacho, {
      almacen_id: almId,
      tipo_entrega: facturaRow.tipo_entrega || tipoEntrega || null,
      seriales: seriales.length ? seriales : null,
      nro_despacho: nroDespacho || null,
      observaciones: observaciones || null,
    });
    setSaving(false);
    if (r.error) {
      showPosToast('Error al despachar: ' + (r.error.message || JSON.stringify(r.error)), 'error');
      console.error('[POS] Error en crearDespacho desde compositor:', r.error);
      return;
    }

    triggerFly(actionRef, verFlujoRef);
    showPosToast('Nota de Despacho creada con éxito', 'success');
    window.ssActivityLog.add(r.despachoId, 'creado', `Nota de Despacho creada desde compositor POS (factura ${facturaId})`);
    window.logActivity?.({ modulo:'documentos', accion:'crear', entidad_id:r.despachoId, entidad_label:r.despachoId, detalles:{ tipo:'despacho', factura_id:facturaId } });
    setSavedCot({ id: r.despachoId, slug: '', lines: lineasDespacho, tipo: 'despacho' });
  }

  // Un clic en "Convertir a Orden" no puede terminar sin decir nada. `doAction` es async y se
  // llama sin await desde el onClick: cualquier excepción adentro se perdía como promesa
  // rechazada y la pantalla quedaba igual que antes de tocar el botón — el modal se cerraba y
  // ya. Es el mismo agujero que `executePromote` tapó en el detalle ("dejaba el botón MUDO"),
  // y acá encima dejaba `saving` en true, o sea el botón muerto hasta recargar.
  async function doAction(overrideId, omitirChequeoDup) {
    try {
      return await _doAction(overrideId, omitirChequeoDup);
    } catch (err) {
      console.error('[POS] doAction', err);
      setSaving(false);
      showPosToast('No se pudo crear el documento: ' + (err?.message || String(err)), 'error');
    }
  }

  async function _doAction(overrideId, omitirChequeoDup) {
    setShowConfirmAction(false);
    const nextSt = stages[stageIdx + 1];
    // El despacho NO se crea con saveDocumento (no debita inventario ni marca seriales → fuga de stock).
    // Se rutea por crearDespacho/crear_despacho_parcial. Ver dispatchFromCompositor().
    if (nextSt === 'despacho') { await dispatchFromCompositor(); return; }
    // No se puede FACTURAR sin stock disponible (las órdenes sí pueden quedar en hold).
    if (nextSt === 'factura') {
      const almId = getAlmacenDefault(almacenId);
      const short = buildItems()
        .filter(it => it.sku && it.sku !== '__SECTION__')
        .filter(it => {
          const inv = ((SSData.inventario || {})[it.sku] || {})[almId] || {};
          const cantidad = inv.cantidad ?? 0;
          const reservadoOtros = Math.max(0, (inv.reservado ?? 0) - (it.qty || 0));
          return (cantidad - reservadoOtros) < (it.qty || 0);
        });
      if (short.length) {
        showPosToast('No se puede facturar sin stock disponible: ' + short.map(i => i.sku).join(', ') + '. Repón el inventario primero.', 'error');
        return;
      }
      // Y contra la BASE: lo de arriba usa la memoria, que no sabe cuántas unidades ya
      // prometieron otras facturas emitidas y sin despachar (el stock se debita al despachar,
      // así que la misma unidad podía facturarse varias veces). Falla cerrada a propósito.
      const val = await window.validarStockFacturar?.(buildItems(), almId);
      if (val?.error) {
        showPosToast('No se pudo verificar el stock disponible; no se emitió la factura. Intentá de nuevo.', 'error');
        return;
      }
      if (val?.faltantes?.length) {
        showPosToast('No se puede facturar: ' + val.faltantes.map(f =>
          `${f.sku} (existen ${f.fisico}, ${f.comprometido} comprometido(s) por otras facturas sin despachar, disponible ${f.disponible})`
        ).join(' · '), 'error');
        return;
      }
    }
    // La orden RESERVA inventario al crearse (trigger de reserva). Si la misma venta se carga dos
    // veces, el stock queda comprometido dos veces y la segunda factura no puede emitirse por
    // "stock insuficiente" contra un hold que se puso sola. Se avisa ANTES de crear; el aviso NO
    // bloquea, porque repetir una compra idéntica es legítimo — solo tiene que ser una decisión.
    if (nextSt === 'orden' && !omitirChequeoDup) {
      const cid = contacto ? contacto.cliente_id : clienteId;
      const its = buildItems();
      const dups = await window.ordenesConMismoContenido?.({ clienteId: cid, items: its });
      if (Array.isArray(dups) && dups.length) {
        const uds = its.filter(i => i.sku && i.sku !== '__SECTION__')
                       .reduce((s, i) => s + (Number(i.qty) || 0), 0);
        setOrdenDup({ docs: dups, uds, continuar: () => doAction(overrideId, true) });
        return;
      }
    }
    setSaving(true);
    const pfx = { orden:'ORD', despacho:'DSP', factura:'NDE' };
    let finalId = overrideId || await window.nextDocId(pfx[nextSt]);
    let finalData = buildDocData(nextSt, finalId);
    let saveError, finalDoc;
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await window.saveDocumento(finalData, buildItems());
      saveError = result.error;
      if (!saveError) { finalDoc = result.doc; break; }
      const isConflict = saveError.code === '23505' || saveError.status === 409 || (saveError.message || '').includes('duplicate');
      if (!isConflict) break;
      finalId = await window.nextDocId(pfx[nextSt]);
      finalData = buildDocData(nextSt, finalId);
    }
    if (saveError) {
      setSaving(false);
      // Con el motivo, no solo "Error": un rechazo de la base (una columna obligatoria, un id
      // repetido que ya no se pudo reintentar) es lo único que explica por qué no se creó nada,
      // y sin él el usuario solo puede reportar "no pasa nada".
      showPosToast('No se creó el documento: ' + (saveError.message || saveError.code || 'error desconocido'), 'error');
      console.error('[POS] Error guardando documento:', saveError);
      return;
    }
    setSaving(false);
    if (nextSt === 'factura') {
      // Fix bug #6: la factura YA está persistida. createCxCFromFactura retorna {error}
      // (no throw); antes su resultado se descartaba y el usuario veía "creada con éxito"
      // aunque la Cuenta por Cobrar no se hubiera creado (cobro perdido, inconsistencia POS↔CxC).
      // Ahora inspeccionamos el error y avisamos sin reportar éxito falso.
      const cxcRes = await window.createCxCFromFactura?.(finalData);
      // Reedición de una factura ya emitida: createCxCFromFactura sale por idempotencia sin tocar
      // nada, así que el ajuste del monto (ej. descuento por pronto pago) lo hace syncCxCFactura.
      // Solo aplica mientras la CxC sigue abierta; si está saldada no se reescribe.
      if (cxcRes?.dup) {
        const sync = await window.syncCxCFactura?.(finalData);
        if (sync?.error) {
          showPosToast(sync.error.message || 'No se pudo actualizar la Cuenta por Cobrar.', 'error');
          console.error('[POS] Error sincronizando CxC:', sync.error);
        } else if (sync?.ok) {
          showPosToast(`Factura actualizada. Deuda ajustada de ${fmt.usd(sync.monto_anterior)} a ${fmt.usd(sync.monto_nuevo)}.`, 'success');
        }
      }
      if (cxcRes?.error) {
        showPosToast('Factura guardada, pero NO se creó la Cuenta por Cobrar. Revisá CxC manualmente.', 'error');
        console.error('[POS] Error creando CxC desde factura:', cxcRes.error);
        window.ssActivityLog.add(finalId, 'creado', `Factura creada SIN CxC (error): ${finalId}`);
        setSavedCot({ id: finalId, slug: finalDoc?.slug || '', lines: buildItems(), tipo: nextSt });
        return;
      }
      // El débito de inventario ocurre ÚNICAMENTE al despachar (crearDespacho/crear_despacho_parcial),
      // igual que el flujo canónico promoverDocumento. Antes había aquí un ajustarInventario('debitar')
      // que causaba DOBLE débito cuando la factura del compositor se despachaba después.
    }
    if (nextSt === 'orden' && almacenId) {
      // Fix bug #21: el composer creaba la orden sin reservar inventario, mientras que
      // el flujo canónico promoverDocumento sí ejecuta reservarInventario('reservar').
      // La asimetría dejaba inventario.reservado subcontado (stock aparece libre estando
      // comprometido) y desbalanceaba la liberación al cancelar. Reservamos aquí también.
      const resRes = await window.reservarInventario?.(buildItems(), almacenId, 'reservar');
      if (resRes?.error) {
        showPosToast('Orden guardada, pero NO se reservó el inventario. Revisá stock manualmente.', 'error');
        console.error('[POS] Error reservando inventario desde orden:', resRes.error);
        window.ssActivityLog.add(finalId, 'creado', `Orden creada SIN reserva (error): ${finalId}`);
        setSavedCot({ id: finalId, slug: finalDoc?.slug || '', lines: buildItems(), tipo: nextSt });
        return;
      }
    }
    triggerFly(actionRef, verFlujoRef);
    const _snm = { orden:'Orden de Venta', despacho:'Nota de Despacho', factura:'Factura' };
    showPosToast(`${_snm[nextSt] || nextSt} creada con éxito`, 'success');
    window.ssActivityLog.add(finalId, 'creado', `${_snm[nextSt] || nextSt} creada desde compositor POS`);
    window.logActivity?.({ modulo:'documentos', accion:'crear', entidad_id:finalId, entidad_label:finalId, detalles:{ tipo:nextSt } });
    setSavedCot({ id: finalId, slug: finalDoc?.slug || '', lines: buildItems(), tipo: nextSt });
  }

  const vendedoresList = (SSData.vendedores || []);
  const fuentesVenta   = (SSData.fuentesVenta  || []).filter(f => f.activo !== false);
  // Las opciones y el "¿pide zona?" salen de `pos_tipos_entrega` vía core.jsx (migración 81).
  // Antes esto preguntaba por `t.requiere_zona`, una columna que NO existía en la tabla: elegir
  // "Delivery" de la lista administrable no pedía zona ni agregaba la línea de flete, y solo el
  // código legado 'delivery' lo hacía — el que la lista ya no ofrecía.
  const tiposEntregaOpts = window.ssOpcionesEntrega();
  const needsDelivery = window.ssRequiereZona(tipoEntrega);
  const [showPosOpciones, setShowPosOpciones] = useState(false);

  // ── Línea de flete automática ──────────────────────────────────────────────────────────────
  // Pedido en la reunión del 2026-08-05, con la decisión explícita del usuario: "aparece la línea
  // y él pone el precio". El flete se cobraba y se olvidaba de cargar, porque había que acordarse
  // de buscarlo en el catálogo.
  //
  // El producto es `FLETE` y está marcado `servicio` (migración 42): no reserva inventario, no
  // bloquea la factura por stock y no se debita al despachar. Su `base` es 0 a propósito — la
  // línea nace en cero y el vendedor escribe el monto.
  //
  // AL DESACTIVAR el delivery la línea se quita SOLO SI sigue en cero. Si ya le pusieron precio,
  // se deja: borrar un cobro que alguien tipeó, sin avisar, es peor que dejar una línea de más
  // que se ve en el carrito y se puede sacar a mano.
  const SKU_FLETE = 'FLETE';
  // El catálogo llega en tandas: si el POS se abre antes, `SSData.productos` está vacío y el
  // efecto no encuentra el flete. Este contador lo vuelve a correr cuando los datos aterrizan.
  const [datosTick, setDatosTick] = useState(0);
  useEffect(() => window.ssOnDatos?.(() => setDatosTick(t => t + 1)), []);
  // Se actúa SOLO cuando `needsDelivery` cambia de valor, no en cada corrida del efecto. Sin este
  // ref, un vendedor que borra la línea a mano se la encontraba de vuelta en la próxima tanda de
  // datos (`ssOnDatos` dispara varias veces por arranque): la pantalla peleando contra el usuario.
  const fleteUltimoEstado = React.useRef(null);
  React.useEffect(() => {
    // No tocar el carrito mientras se edita un documento ya guardado: su flete (o su ausencia)
    // es un hecho del documento, no algo que este efecto deba corregir por su cuenta.
    if (isEditing) return;
    const hayProducto = (SSData.productos || []).some(p => p.sku === SKU_FLETE);
    // El catálogo llega en tandas: si todavía no está, se sale SIN marcar el estado, así la
    // próxima tanda vuelve a intentarlo.
    if (!hayProducto) return;
    if (fleteUltimoEstado.current === !!needsDelivery) return;
    fleteUltimoEstado.current = !!needsDelivery;
    setCart(prev => {
      const idx = prev.findIndex(c => !c._section && c.sku === SKU_FLETE);
      if (needsDelivery) {
        if (idx !== -1) return prev;
        return [...prev, { sku: SKU_FLETE, qty: 1, extraDescuento: 0, precioManual: null }];
      }
      if (idx === -1) return prev;
      const tocada = (Number(prev[idx].precioManual) || 0) > 0;
      if (tocada) return prev;
      return prev.filter((_, i) => i !== idx);
    });
  }, [needsDelivery, isEditing, datosTick]);

  // ¿Falta algún campo obligatorio que vive en el modal de Condiciones? → aura de alerta
  // en el botón. Espejo del subconjunto de validateCampos() que se edita ahí dentro
  // (cliente y modalidad_pago se excluyen porque tienen su propia UI fuera del modal).
  const condicionesFaltan = (() => {
    const checks = [
      ['tipo_venta',    tipoVenta],
      ['vencimiento',   vencimiento],
      ['terminos_pago', terminosPago],
      ['vendedor',      vendedor],
      ['fuente',        fuente],
      ['tipo_entrega',  tipoEntrega],
      ['dir_factura',   dirFactura],
      ['dir_entrega',   dirEntrega],
      ['observaciones', observaciones],
      ...(needsDelivery ? [['zona_delivery', zonaDelivery], ['nro_despacho', nroDespacho]] : []),
    ];
    return checks.some(([id, val]) => isRequired(id) && !isHidden(id) && !val);
  })();

  return (
    <div className="page pos-page-mobile" style={{paddingBottom: 24}}>
      <div className="page-header">
        <div>
          <h1 className="page-title">{isEditing ? `Editando ${docId}` : 'POS / Órdenes'}</h1>
          <div className="page-subtitle">
            {isEditing
              ? <><span style={{color:'var(--brand)'}}>Modo edición</span> · Modifica los campos y guarda los cambios</>
              : <>Cotización → Orden → Factura → Despacho · <span style={{color:'var(--text-subtle)'}}>Clic en el pipeline para listar</span></>
            }
          </div>
        </div>
        <div className="page-actions">
          {isEditing
            ? <button className="btn secondary" onClick={onEditDone}><Icon name="x" size={14}/>Cancelar edición</button>
            : <>
                <button ref={verFlujoRef} className="btn secondary" onClick={() => window.__ssNavigate('/pos/flujo')}><Icon name="pos" size={14}/>Ver flujo</button>
                <button className="btn ghost" title="Administrar fuentes de venta y tipos de entrega" onClick={() => setShowPosOpciones(true)}><Icon name="settings" size={14}/>Configurar</button>
                <button className="btn primary" onClick={() => { setCart([]); setStage('cotizacion'); setDocId(''); }}>
                  <Icon name="plus" size={14}/>Nueva cotización
                </button>
              </>
          }
        </div>
      </div>

      {/* ── Borrador recuperado (autosave local) ── */}
      {draftRecovered && !isEditing && (
        <div className="card" style={{padding:'10px 14px', marginBottom:12, background:'color-mix(in srgb,var(--brand) 7%,transparent)', border:'1px solid color-mix(in srgb,var(--brand) 28%,transparent)', borderRadius:8, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
          <Icon name="refresh" size={15} style={{color:'var(--brand)', flexShrink:0}}/>
          <span style={{fontSize:12.5, fontWeight:600, color:'var(--brand)'}}>Borrador recuperado</span>
          <span style={{fontSize:12, color:'var(--text-muted)'}}>
            Retomamos tu cotización sin guardar, tal como la dejaste{(() => { const n = cart.filter(c => !c._section).length; return n ? ` · ${n} ítem${n !== 1 ? 's' : ''}` : ''; })()}.
          </span>
          <button className="btn ghost" style={{marginLeft:'auto', fontSize:12, padding:'4px 10px', height:'auto'}} onClick={discardDraft} title="Vaciar el borrador y empezar una cotización de cero">
            <Icon name="x" size={12}/>Descartar
          </button>
        </div>
      )}

      {/* ── Modalidad de pago ── */}
      <div className="card" style={{padding:'12px 16px', marginBottom:16, display:'flex', alignItems:'center', gap:14, flexWrap:'wrap'}}>
        <div style={{fontSize:13, fontWeight:600, whiteSpace:'nowrap', color:'var(--text)'}}>Modalidad de pago:</div>
        <div style={{display:'flex', gap:0, borderRadius:8, overflow:'hidden', border:'1px solid var(--border)', flexShrink:0}}>
          {[
            { id:'divisas',   label:'Divisas USD',          hint:'Precio en USD sin ajuste' },
            { id:'bcv',       label: cobertura == null ? 'BCV + Cob.' : `BCV +${cobertura}%`,
              hint: cobertura == null ? 'Falta configurar la cobertura BCV' : `USD +${cobertura}% cobertura · Bs ${tasa.bcv}` },
            { id:'bcv_fijo',  label:'Nota BCV',              hint:`BCV exacto sin cobertura · Bs ${tasa.bcv}` },
            { id:'paralelo',  label:'Paralelo',              hint:`USD sin ajuste · Bs ${tasa.paralelo}` },
          ].map(m => (
            <button
              key={m.id}
              onClick={() => setModalidadPago(m.id)}
              style={{
                padding:'7px 16px', fontSize:12.5, fontWeight: modalidadPago===m.id ? 600 : 400,
                background: modalidadPago===m.id ? 'var(--brand)' : 'transparent',
                color: modalidadPago===m.id ? '#fff' : 'var(--text)',
                border:'none', cursor:'pointer', whiteSpace:'nowrap', transition:'background .12s, color .12s',
              }}
            >{m.label}</button>
          ))}
        </div>
        <div style={{fontSize:11.5, color:'var(--text-muted)'}}>
          {modalidadPago==='divisas'  && 'Precio base en dólares · sin ajuste de tasa'}
          {modalidadPago==='bcv'     && (cobertura == null
            ? '⚠ No hay cobertura BCV configurada — no se puede cotizar en esta modalidad hasta definirla en el panel de tasas'
            : `Precio USD + ${cobertura}% cobertura · el cliente paga en bolívares a Bs. ${tasa.bcv} por USD`)}
          {modalidadPago==='bcv_fijo'&& `BCV exacto sin cobertura · el cliente paga en bolívares a Bs. ${tasa.bcv} por USD · para notas Mercado Libre`}
          {modalidadPago==='paralelo'&& `Precio base en dólares · el cliente paga en bolívares a Bs. ${tasaParaleloDoc ?? tasa.paralelo} por USD`}
        </div>
      </div>

      <div className={"pos-layout" + (cartOpen && cartMode === 'drawer' ? " with-cart" : "")}>
        {/* Columna principal: cliente bar + filtros + catálogo */}
        <div className="pos-main" style={{flex:'1 1 0', minWidth:0}}>
          {/* Barra cliente compacta */}
          <div className="pos-clientebar card">
            <div className="pos-clientebar-select">
              <div className="small muted" style={{marginBottom: 4}}>
                Cliente / Contacto <span style={{color:'var(--danger)'}} title="Obligatorio: ningún documento puede quedar sin cliente">*</span>
              </div>
              <SearchSelect
                value={clienteId}
                onChange={v => { setClienteId(v); setDirFactura(''); setDirEntrega(''); }}
                options={clientContactOptions}
                /* Búsqueda contra el servidor: el POS ya no descarga los 13.092 clientes ni
                   los 13.140 contactos para poder elegir uno. `options` sigue pasándose con
                   lo que haya en memoria, que aparece al instante mientras vuelve la consulta. */
                onSearchRemote={window.buscarClientesContactos}
                selectedLabel={cliente?.nombre || contacto?.nombre || ''}
                placeholder="Buscar cliente o contacto por nombre o RIF..."
                style={{width: '100%'}}
                createOptions={[
                  { label: 'Crear cliente "{q}"', icon: 'clients', onSelect: q => setQuickCreate({ type: 'cliente', nombre: q }) },
                  { label: 'Crear contacto "{q}"', icon: 'contact', onSelect: q => setQuickCreate({ type: 'contacto', nombre: q }) },
                ]}
              />
            </div>
            <div className="pos-clientebar-info">
              {!cliente && !contacto && (
                <div className="small muted">Selecciona un cliente para aplicar precios y condiciones</div>
              )}
              {cliente && (
                <div className="pos-clientebar-chips">
                  <span className="chip neutral">{SSData.tiposCliente.find(t => t.id === cliente?.tipo)?.nombre}</span>
                  <span className="chip blue">{listaPrecio?.nombre}</span>
                  <span className="chip amber">Dcto {descuento}%</span>
                  <span className="muted mono" style={{fontSize:11.5}}>{cliente.rif}</span>
                  {cliente.telefono && <span className="muted mono" style={{fontSize:11.5}}>📞 {cliente.telefono}</span>}
                  {(cliente.dir_factura || cliente.direccion) && (
                    <span className="muted" style={{fontSize:11.5, maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}
                          title={cliente.dir_factura || cliente.direccion}>
                      📍 {cliente.dir_factura || cliente.direccion}
                    </span>
                  )}
                  {contacto && <span className="chip neutral"><Icon name="contact" size={11}/> {contacto.cargo}</span>}
                  <span className="muted" style={{fontSize:11.5}}>
                    Crédito: <span className="mono">{fmt.usd(cliente?.deuda || 0)}/{fmt.usd(cliente?.limiteCredito || 0)}</span>
                  </span>
                  {/* Saldo a favor: el cliente ya entregó esta plata como anticipo. Se MUESTRA
                      pero NUNCA se aplica solo — la aplicación es manual desde Finanzas → Anticipos
                      o al cobrar la factura, para que cobranza no se encuentre con sorpresas. */}
                  {saldoAnticipos > 0.005 && (
                    <span className="chip green" title="Anticipos sin consumir. Se aplican manualmente desde Finanzas → Anticipos.">
                      <Icon name="cash" size={11}/> A favor: {fmt.usd(saldoAnticipos)}
                    </span>
                  )}
                </div>
              )}

              {/* Tipo de entrega acá mismo, sin abrir Condiciones (pedido del 2026-08-17).
                  Es el MISMO estado `tipoEntrega` que el select de Condiciones — no una copia:
                  dos fuentes para el mismo dato se desincronizan y se termina despachando distinto
                  de lo que dice el documento. Cambiarlo acá dispara la línea de flete igual que
                  allá, porque el efecto escucha `needsDelivery`, no al control que lo cambió.
                  Respeta `camposConfig`: si el campo está oculto en Ajustes, acá tampoco aparece. */}
              {!isHidden('tipo_entrega') && (
                <div className="pos-clientebar-entrega">
                  <span className="small muted">
                    Entrega {isRequired('tipo_entrega') && <span style={{color:'var(--danger)'}}>*</span>}
                  </span>
                  <select
                    className="select"
                    value={tipoEntrega}
                    onChange={e => { setTipoEntrega(e.target.value); setCamposErrors([]); }}
                    title="Cómo recibe el cliente la mercancía"
                  >
                    {tiposEntregaOpts.map(t => <option key={t.id} value={t.valor}>{t.nombre}</option>)}
                    {/* Un valor que ya no está en la lista (opción borrada de Ajustes, documento
                        viejo) se agrega como opción para no cambiarlo en silencio al abrirlo. */}
                    {tipoEntrega && !tiposEntregaOpts.some(t => t.valor === tipoEntrega) && (
                      <option value={tipoEntrega}>{window.ssLabelEntrega(tipoEntrega)}</option>
                    )}
                  </select>
                  {needsDelivery && (
                    <input
                      className="input"
                      style={{ fontSize: 12, padding: '4px 8px', maxWidth: 190 }}
                      placeholder="Zona / dirección de envío"
                      value={zonaDelivery}
                      onChange={e => { setZonaDelivery(e.target.value); setCamposErrors([]); }}
                    />
                  )}
                </div>
              )}
            </div>
            <div className="pos-clientebar-actions">
              <button className={"btn secondary" + (condicionesFaltan ? " pos-cond-alert" : "")}
                style={{padding:'6px 12px', fontSize:12, position:'relative'}}
                title={condicionesFaltan ? 'Faltan campos obligatorios en Condiciones' : 'Condiciones del documento'}
                onClick={() => setShowConditions(true)}>
                <Icon name="edit" size={12}/>Condiciones
                {condicionesFaltan && <span className="pos-cond-alert-dot" />}
              </button>
              {!cartOpen && (
                <button className="btn secondary" style={{padding:'6px 12px', fontSize:12, position:'relative'}} onClick={() => setCartOpen(true)}>
                  <Icon name="box" size={12}/>Carrito
                  {cart.length > 0 && (
                    <span style={{background:'var(--brand)', color:'#fff', borderRadius:10, padding:'1px 6px', fontSize:10.5, fontWeight:600, marginLeft:3}}>{cart.length}</span>
                  )}
                </button>
              )}
            </div>
          </div>

          <div className="pos-filter-bar card">
            {/* El buscador es donde se escribe el SKU y donde más falta el espacio; Categoría y
                Marca son desplegables que se leen igual cortos. Por eso el buscador crece el doble
                de rápido que el resto (`flex-grow: 2`) y arranca de una base bastante más ancha,
                y las categorías tienen tope. Pedido del 2026-08-17. */}
            <div className="filtro-mini" style={{flex:'2 1 300px', minWidth:220}}>
              <div className="filtro-mini-label">Buscar</div>
              <AdvancedSearch
                terms={searchTerms}
                onTermsChange={setSearchTerms}
                storageKey="ss-saved-search-productos"
                placeholder="Nombre, SKU o marca..."
                style={{width:'100%'}}
              />
            </div>
            <div className="filtro-mini" style={{flex:'0 1 140px', minWidth:0}}>
              <div className="filtro-mini-label">Categoría</div>
              <select className="select" style={{maxWidth:140}} value={categoria} onChange={e=>setCategoria(e.target.value)}>
                <option value="">Todas</option>
                {categoriaOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="filtro-mini">
              <div className="filtro-mini-label">Marca</div>
              <select className="select" value={marcaFilter} onChange={e=>setMarcaFilter(e.target.value)}>
                <option value="">Todas</option>
                {marcaOptions.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="filtro-mini">
              <div className="filtro-mini-label">Almacén</div>
              <select className="select" value={almacenId} onChange={e=>setAlmacenId(e.target.value)}>
                {SSData.almacenes.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </div>
            <div className="filtro-mini">
              <div className="filtro-mini-label">Lista precios</div>
              <select className="select"
                value={effectiveListaId || ''}
                onChange={e=>setListaPrecioOverride(e.target.value || null)}
                title="Lista de precios aplicada al catálogo">
                <option value="">Del cliente</option>
                {(SSData.listasPrecios || []).map(lp => (
                  <option key={lp.id} value={lp.id}>{lp.nombre} ({lp.valor}%)</option>
                ))}
              </select>
            </div>
            {listaPrecioOverride && cliListaId && listaPrecioOverride !== cliListaId && (
              <button className="btn ghost" style={{padding:'5px 8px', fontSize:11, flexShrink:0, alignSelf:'flex-end'}}
                onClick={() => setListaPrecioOverride(null)}
                title="Restaurar lista del cliente">↺</button>
            )}
            <button
              className={"btn " + (soloConStock ? "primary" : "secondary")}
              style={{padding:'5px 10px', fontSize:12, flexShrink:0, whiteSpace:'nowrap', alignSelf:'flex-end'}}
              onClick={() => setSoloConStock(v => !v)}
              title="Mostrar solo productos con existencia">
              <Icon name="box" size={13}/>Stock
            </button>
            {(searchTerms.length > 0 || categoria || marcaFilter || soloConStock) && (
              <button className="btn ghost" style={{padding:'5px 8px', fontSize:12, flexShrink:0, alignSelf:'flex-end'}} title="Limpiar filtros"
                onClick={() => { setSearchTerms([]); setCategoria(''); setMarcaFilter(''); setSoloConStock(false); }}>
                <Icon name="x" size={12}/>
              </button>
            )}
            <button onClick={() => setShowVoiceModal(true)} title="Pedido por voz (IA)"
              style={{padding:'4px 8px', borderRadius:6, border:'1px solid var(--danger)', background:'var(--danger-soft)', color:'var(--danger)', cursor:'pointer', lineHeight:1, display:'flex', alignItems:'center', gap:4, fontSize:11.5, fontWeight:600, flexShrink:0, alignSelf:'flex-end'}}>
              <Icon name="mic" size={13}/>Voz
            </button>
            <span className="small muted" style={{flexShrink:0, whiteSpace:'nowrap', alignSelf:'flex-end', marginLeft:'auto'}}>
              {productos.length} / {SSData.productos.length}
            </span>
          </div>
          {/* Catálogo SIEMPRE en tabla. La vista de tarjetas se eliminó: su miniatura no mostraba
              el producto (solo marca/categoría en texto), ocupaba el triple de alto por ítem y
              obligaba a arrastrar del catálogo columnas que solo servían para ella. */}
          <div className="pos-catalog">
              <div className="product-list">
                {/* Sortable header */}
                {(() => {
                  const arr = [
                    { key: 'sku',    label: 'SKU' },
                    { key: 'nombre', label: 'Nombre' },
                    { key: 'cat',    label: 'Marca / Cat.' },
                    { key: 'costo',  label: 'Costo',   w: 58 },
                    { key: 'precio', label: 'Precio',  w: 60 },
                    { key: 'margen', label: '% Gan.',  w: 54 },
                    { key: 'stock',  label: 'Stock',   w: 48 },
                  ];
                  const sa = c => listSort.key === c ? (listSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
                  return (
                    <div className="prod-list-header">
                      <div className="prod-list-info" style={{flexDirection:'row', gap:12}}>
                        {arr.slice(0,3).map(col => (
                          <span key={col.key} className={`prod-list-hcol${listSort.key===col.key?' active':''}`}
                            onClick={() => toggleListSort(col.key)}>
                            {col.label}<span className="prod-list-sort-arrow">{sa(col.key)}</span>
                          </span>
                        ))}
                      </div>
                      <div className="prod-list-right">
                        {arr.slice(3).map(col => (
                          <span key={col.key} className={`prod-list-hcol${listSort.key===col.key?' active':''}`}
                            style={{minWidth: col.w, flexShrink:0, textAlign:'center', justifyContent:'center'}}
                            onClick={() => toggleListSort(col.key)}>
                            {col.label}<span className="prod-list-sort-arrow">{sa(col.key)}</span>
                          </span>
                        ))}
                        <span style={{flex:'0 0 28px'}}/>
                      </div>
                    </div>
                  );
                })()}
                <VirtualList
                  items={productosOrdenados}
                  rowHeight={56}
                  keyOf={p => p.sku}
                  renderItem={p => {
                    const inv = getDisponible(p.sku, almacenId);
                    const basePrice = p.base * (1 - descuento/100);
                    const precio = modalidadPago === 'bcv' ? basePrice * (1 + cobertura/100) : basePrice;
                    const costo = p.costo || 0;
                    const margen = basePrice > 0 && costo > 0 ? ((basePrice - costo) / basePrice) * 100 : null;
                    const margenColor = margen == null ? 'var(--text-muted)' : margen < 10 ? 'var(--danger)' : margen < 25 ? 'var(--warn)' : 'var(--success)';
                    const sinStock = inv.disponible === 0;
                    const otrosAlm = getStockOtrosAlmacenes(p.sku, almacenId);
                    const enCarrito = cart.find(c => c.sku === p.sku);
                    return (
                      <div className="prod-list-row" onClick={() => addProduct(p)}
                        style={sinStock ? {opacity:0.55, height:'100%', boxSizing:'border-box'} : {height:'100%', boxSizing:'border-box'}}>
                        <div className="prod-list-info">
                          <span className="prod-list-sku">{p.sku}</span>
                          <span className="prod-list-name">{p.nombre}</span>
                          <span className="prod-list-cat">{[p.marca, p.categoria].filter(Boolean).join(' · ')}</span>
                        </div>
                        <div className="prod-list-right">
                          <span className="prod-list-cost mono" style={{minWidth:58, flexShrink:0, textAlign:'center', color:'var(--text-muted)', fontSize:12, fontVariantNumeric:'tabular-nums'}}>
                            {costo > 0 ? fmt.usd(costo) : '—'}
                          </span>
                          <span className="prod-list-price" style={{flexShrink:0}}>{fmt.usd(precio)}</span>
                          <span className="prod-list-margen mono" style={{minWidth:54, flexShrink:0, textAlign:'center', color: margenColor, fontSize:12, fontWeight:600, fontVariantNumeric:'tabular-nums'}}>
                            {margen != null ? `${margen.toFixed(1)}%` : '—'}
                          </span>
                          {/* Color reforzado (pedido explícito, captura "no se distingue bien"):
                              el disponible normal pasa de `--text-muted` a `--text` — el tamaño y
                              peso ya igualan al precio, así que un gris apagado seguía perdiéndose
                              al lado de un número en negrita. */}
                          <span className="prod-list-stock" style={{flexShrink:0, color: p.servicio ? 'var(--brand)' : sinStock ? 'var(--danger)' : inv.disponible < 5 ? 'oklch(0.55 0.16 75)' /* --warn (oklch 0.68) es liviano para texto chico: mismo tono, más oscuro */ : 'var(--text)'}}>
                            {/* Un servicio no tiene existencias: decir "Sin stock" haría pensar
                                que no se puede vender, que es exactamente lo contrario. */}
                            {p.servicio ? 'Servicio' : sinStock ? 'Sin stock' : `${inv.disponible}u`}
                          </span>
                          {otrosAlm.length > 0 && (
                            <span
                              title={'En otros almacenes:\n' + otrosAlm.map(o => `• ${o.nombre}: ${o.cantidad}u`).join('\n')}
                              onClick={e => e.stopPropagation()}
                              style={{flexShrink:0, fontSize:13, lineHeight:1, color:'var(--brand)', cursor:'help', marginLeft:-3}}>
                              ⓘ
                            </span>
                          )}
                          <button className="prod-list-add" style={{flexShrink:0, background: enCarrito ? 'var(--brand)' : 'var(--bg-sunken)', color: enCarrito ? '#fff' : 'var(--text-muted)'}}>
                            {enCarrito ? `+${enCarrito.qty}` : '+'}
                          </button>
                        </div>
                      </div>
                    );
                  }}
                />
              </div>
          </div>
        </div>

        {/* Resizer handle */}
        {cartOpen && cartMode === 'drawer' && <div className="pos-resizer" onMouseDown={onResizerMouseDown} title="Arrastrar para redimensionar"/>}

        {/* Backdrop del popup (y del bottom-sheet en móvil) — click afuera cierra el carrito */}
        {cartOpen && (cartMode === 'popup' || isMobileViewport) && (
          <div onClick={dismissCart}
            style={{position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:199}}/>
        )}

        {/* Carrito — drawer lateral o popup flotante (mismo contenido, diferente wrapper) */}
        {cartOpen && <aside className="pos-cart-drawer" data-mode={cartMode}
          style={cartMode === 'popup'
            ? {position:'fixed', top:'50%', left:'50%', transform:'translate(-50%, -50%)', zIndex:200, width:`min(${cartPopupWidth}px, 96vw)`, height:'88vh', maxHeight:'88vh', boxShadow:'0 20px 60px rgba(0,0,0,.35)'}
            : {width: cartWidth, flexShrink:0}}>

          {cartMode === 'popup' && (
            <div className="pos-cart-popup-resizer" title="Arrastrar para redimensionar"
              onMouseDown={onPopupResizerMouseDown}
              style={{position:'absolute', top:0, right:0, width:8, height:'100%', cursor:'col-resize', zIndex:5}}/>
          )}

          <div className="pos-cart-drawer-header">
            <div style={{fontWeight:600, fontSize:13, display:'flex', alignItems:'center', gap:8}}>
              <Icon name="box" size={14}/>
              Carrito
              <span style={{background:'var(--brand)', color:'#fff', borderRadius:10, padding:'1px 8px', fontSize:11, fontWeight:600}}>{cart.length}</span>
              {cartMode === 'popup' && <span style={{fontSize:10.5, color:'var(--text-muted)', fontWeight:500}}>· vista popup</span>}
            </div>
            <div style={{display:'flex', gap:4}}>
              <button className="icon-btn"
                onClick={toggleCartInternos}
                title={showCartInternos ? 'Ocultar proveedor y costo' : 'Ver proveedor y costo (interno)'}
                style={{width:'auto', padding:'0 8px', gap:5, display:'flex', alignItems:'center', fontSize:11.5, fontWeight:600,
                        ...(showCartInternos ? {color:'#15803d', background:'#dcfce7'} : {})}}>
                <Icon name="lock" size={14}/>
                Costos
              </button>
              <button className="icon-btn"
                onClick={() => setCartMode(cartMode === 'drawer' ? 'popup' : 'drawer')}
                title={cartMode === 'drawer' ? 'Abrir carrito como popup' : 'Anclar carrito al lateral'}
                style={{width:'auto', padding:'0 8px', gap:5, display:'flex', alignItems:'center', fontSize:11.5, fontWeight:600}}>
                <Icon name="external" size={14}/>
                {cartMode === 'drawer' ? 'Expandir' : 'Anclar'}
              </button>
              {cart.filter(c => !c._section).length > 0 && (
                <button className="icon-btn" onClick={vaciarCarrito}
                  title="Vaciar carrito"
                  style={{color:'#b91c1c'}}>
                  <Icon name="trash" size={14}/>
                </button>
              )}
              <button className="icon-btn" onClick={dismissCart}
                title={cartMode === 'popup' ? 'Volver al lateral' : 'Cerrar carrito'}>
                <Icon name="x" size={14}/>
              </button>
            </div>
          </div>

          {/* Carrito */}
          <div className="cart">
            <div className="cart-items">
              {cart.filter(c => !c._section).length === 0 && <div className="empty">Agrega productos del catálogo</div>}
              {(() => {
                const tBcv = tasa.bcv || 0;
                const tPar = tasaParaleloDoc || 0;
                const renderAddBtn = () => (
                  <div key="addbtn" className="cart-add-section-row" {...addBtnDragProps()}>
                    <span className="cart-drag-handle" title="Arrastrar para reposicionar">⋮⋮</span>
                    <button className="cart-add-section-btn" onClick={addSection}>+ Añadir sección</button>
                  </div>
                );
                const renderRow = (ci, idx) => {
                  if (ci._section) {
                    return (
                      <div key={ci.id} className="cart-section-row" {...cartDragProps(idx)}>
                        <span className="cart-drag-handle" title="Arrastrar para reordenar">⋮⋮</span>
                        <span className="cart-section-label">§</span>
                        <input
                          className="cart-section-input"
                          value={ci.label}
                          placeholder="Nombre de sección…"
                          onChange={e => updateSection(ci.id, e.target.value)}
                          draggable={false}
                          onMouseDown={e => e.stopPropagation()}
                        />
                        <button className="icon-btn" onClick={() => removeSection(ci.id)} title="Quitar sección"><Icon name="x" size={12}/></button>
                      </div>
                    );
                  }
                  const i = cartDetails.find(x => x.sku === ci.sku);
                  if (!i) return null;
                  const precioUnit = i.precio || 0;
                  const precioBcv  = precioUnit * tBcv;
                  const precioPar  = precioUnit * tPar;
                  const subtotalBcv = (i.subtotal || 0) * tBcv;
                  const subtotalPar = (i.subtotal || 0) * tPar;
                  return (
                    <div key={i.sku} className="cart-row" {...cartDragProps(idx)}>
                      <div className="cart-row-head">
                        <span className="cart-drag-handle" title="Arrastrar para reordenar">⋮⋮</span>
                        <div className="cart-row-name copy-host">
                          {i.nombre}
                          {/* Mismo copiar que en la ficha del producto: acá se arma el pedido y es
                              donde más se pega el título en un chat con el cliente. */}
                          <window.CopyBtn text={i.nombre} title="Copiar el nombre del producto" />
                          {/* Un SERVICIO (flete, mano de obra) no tiene existencias: "sin stock"
                              en la línea de flete es ruido que asusta al vendedor por algo que no
                              es un problema. Ver migracion-odoo/42_productos_servicio.sql. */}
                          {i.servicio && (
                            <span style={{fontSize:10.5, fontWeight:600, color:'var(--brand)', background:'var(--brand-soft)', borderRadius:4, padding:'1px 5px', flexShrink:0, marginLeft:6}}>
                              Servicio
                            </span>
                          )}
                          {!i.servicio && i.qty > i.disponible && (
                            <span style={{fontSize:10.5, fontWeight:600, color:'var(--danger)', background:'#dc262618', borderRadius:4, padding:'1px 5px', flexShrink:0, marginLeft:6}}>
                              ⚠ Sin stock
                            </span>
                          )}
                        </div>
                        <button className="icon-btn cart-row-remove" onClick={()=>updateQty(i.sku, 0)} title="Quitar"><Icon name="x" size={12}/></button>
                      </div>
                      <div className="cart-row-meta small mono copy-host">
                        <span style={{color:'var(--text-muted)'}}>{i.sku}</span>
                        <window.CopyBtn text={i.sku} title="Copiar SKU" />
                        <span style={{color:'var(--border)'}}>·</span>
                        {canEditPrice ? (
                          <input
                            type="text" inputMode="decimal"
                            key={`price-${i.sku}-${i.precioManual}`}
                            defaultValue={Math.round((i.precioBase || 0) * 100) / 100}
                            onBlur={e => {
                              const v = e.target.value.replace(',', '.');
                              updatePrecio(i.sku, v === '' ? null : v);
                            }}
                            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                            title="Editar precio manualmente"
                            style={{width:68, padding:'1px 4px', fontSize:11.5, textAlign:'right', borderRadius:5, border:'1px solid var(--brand)', background:'var(--bg-input, var(--bg))', color:'var(--text)', fontFamily:'var(--font-mono)'}}
                          />
                        ) : (
                          <span style={{fontWeight:600}}>{fmt.usd(i.precio)}</span>
                        )}
                        <span style={{color:'var(--text-muted)'}}>/u</span>
                        {i.precioManual != null && canEditPrice && (
                          <button onClick={() => updatePrecio(i.sku, null)} title="Restaurar precio" style={{fontSize:10, color:'var(--text-muted)', cursor:'pointer', background:'none', border:'none', padding:'0 2px', lineHeight:1}}>↺</button>
                        )}
                        {i.extraDescuento > 0 && <span style={{color:'var(--success)'}}>−{i.extraDescuento}%</span>}
                        {!i.servicio && (
                          <span style={{color: i.disponible === 0 ? 'var(--danger)' : i.disponible < i.qty ? 'var(--warn)' : 'var(--text-muted)', marginLeft:'auto'}}>
                            stk {i.stock}{i.enOrden > 0 ? ` (${i.disponible} disp)` : ''}
                          </span>
                        )}
                      </div>
                      {(() => {
                        if (i.servicio) return null;   // no tiene existencias en ningún almacén, y está bien
                        const todos = getStockTodosAlmacenes(i.sku, almacenId);
                        if (todos.length === 0) {
                          return (
                            <div className="small" style={{display:'flex', alignItems:'center', gap:4, marginTop:3, color:'var(--danger)', fontWeight:600, fontSize:11, lineHeight:1.3}}>
                              <span style={{flexShrink:0}}>📍</span>
                              <span>Sin stock en ningún almacén</span>
                            </div>
                          );
                        }
                        return (
                          <div className="small" style={{display:'flex', alignItems:'center', gap:4, marginTop:3, fontWeight:600, fontSize:11, lineHeight:1.3, flexWrap:'wrap'}}>
                            <span style={{flexShrink:0}}>📍</span>
                            {todos.map((o, ix) => (
                              <span key={o.id} style={{color: o.id === almacenId ? 'var(--text-muted)' : 'var(--brand)'}}>
                                {o.nombre} ({o.cantidad}u){ix < todos.length - 1 ? ' ·' : ''}
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                      {(modalidadPago === 'bcv' || modalidadPago === 'bcv_fijo') && tBcv > 0 && (
                        <div className="cart-row-rates">
                          <span className="rate-pill rate-bcv" title={`Tasa BCV ${tBcv}`}>
                            <span className="rate-tag">BCV</span>
                            <span className="rate-val mono">{fmt.ves(precioBcv)}</span>
                          </span>
                          <span className="muted" style={{fontSize:10}}>/u</span>
                          {modalidadPago === 'bcv' && cobertura > 0 && (
                            <>
                              <span className="rate-pill" style={{background:'var(--bg-sunken)',border:'1px solid var(--border)',marginLeft:4}} title={`BCV + ${cobertura}% cobertura en USD`}>
                                <span className="rate-tag" style={{color:'var(--text-muted)'}}>BCV$</span>
                                <span className="rate-val mono">{fmt.usd(precioUnit)}</span>
                              </span>
                              <span className="muted" style={{fontSize:10}}>/u</span>
                            </>
                          )}
                        </div>
                      )}
                      {modalidadPago === 'paralelo' && tPar > 0 && (
                        <div className="cart-row-rates">
                          <span className="rate-pill rate-par" title={`Tasa Paralelo ${tPar}`}>
                            <span className="rate-tag">Par.</span>
                            <span className="rate-val mono">{fmt.ves(precioPar)}</span>
                          </span>
                          <span className="muted" style={{fontSize:10}}>/u</span>
                          <span className="rate-pill" style={{background:'var(--bg-sunken)',border:'1px solid var(--border)',marginLeft:4}} title={`Referencia BCV + ${cobertura}% cobertura en USD`}>
                            <span className="rate-tag" style={{color:'var(--text-muted)'}}>BCV$</span>
                            <span className="rate-val mono">{fmt.usd(precioUnit * (1 + cobertura / 100))}</span>
                          </span>
                          <span className="muted" style={{fontSize:10}}>/u</span>
                        </div>
                      )}
                      <div className="cart-row-controls">
                        <div className="cart-qty">
                          <button onClick={()=>updateQty(i.sku, i.qty-1)}>−</button>
                          <input value={i.qty} onChange={e=>updateQty(i.sku, Number(e.target.value)||0)} />
                          <button onClick={()=>updateQty(i.sku, i.qty+1)}>+</button>
                        </div>
                        <div className="cart-pct">
                          <input
                            type="number" min="0" max="100" step="1"
                            value={i.extraDescuento || ''}
                            onChange={e => updateExtraDescuento(i.sku, e.target.value)}
                            placeholder="0"
                            title="Descuento adicional %"
                          />
                          <span>%</span>
                        </div>
                        <div className="cart-row-total">
                          <div className="mono cart-row-total-usd">{fmt.usd(i.subtotal)}</div>
                          {(modalidadPago === 'bcv' || modalidadPago === 'bcv_fijo') && tBcv > 0 && (
                            <div className="cart-row-total-bs">
                              <span className="mono"><span className="rate-tag-sm">BCV</span> {fmt.ves(subtotalBcv)}</span>
                            </div>
                          )}
                          {modalidadPago === 'paralelo' && tPar > 0 && (
                            <div className="cart-row-total-bs">
                              <span className="mono"><span className="rate-tag-sm">Par.</span> {fmt.ves(subtotalPar)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      {(() => {
                        const gar = cartGarantias[i.sku] || {};
                        const isOpen = garantiaOpenSku === i.sku;
                        const mesesShow = gar.meses !== '' && gar.meses != null ? gar.meses + 'm' : (i.garantia_meses ? i.garantia_meses + 'm' : '—');
                        const hasCond = !!(gar.condiciones && gar.condiciones.trim());
                        return (
                          <div style={{padding:'3px 4px 0', marginTop:4}}>
                            <button
                              type="button"
                              onClick={() => setGarantiaOpenSku(isOpen ? null : i.sku)}
                              title="Editar garantía de esta línea"
                              style={{fontSize:10.5, padding:'2px 7px', borderRadius:10, border:'1px solid var(--border)', background: isOpen ? 'var(--brand)' : 'var(--bg-sunken, transparent)', color: isOpen ? '#fff' : 'var(--text-muted)', cursor:'pointer', display:'inline-flex', alignItems:'center', gap:4}}
                            >
                              <span>🛡 Gar: <strong style={{fontFamily:'var(--font-mono)'}}>{mesesShow}</strong></span>
                              {hasCond && <span style={{fontSize:9, opacity:0.8}}>· cond.</span>}
                            </button>
                            {isOpen && (
                              <div style={{display:'flex', flexDirection:'column', gap:4, padding:'6px 4px 4px', marginTop:4, borderTop:'1px dashed var(--border)'}}>
                                <div style={{display:'flex', gap:6, alignItems:'center'}}>
                                  <label style={{fontSize:10.5, color:'var(--text-muted)', minWidth:50}}>Meses</label>
                                  <input
                                    type="number" min="0" step="1"
                                    value={gar.meses ?? ''}
                                    onChange={e => updateCartGarantia(i.sku, 'meses', e.target.value)}
                                    placeholder={i.garantia_meses ? String(i.garantia_meses) : '0'}
                                    style={{width:62, fontSize:11, padding:'2px 4px', border:'1px solid var(--border)', borderRadius:4, textAlign:'right', fontFamily:'var(--font-mono)'}}
                                  />
                                  <span style={{fontSize:10, color:'var(--text-muted)'}}>(default producto: {i.garantia_meses || 0}m)</span>
                                </div>
                                <textarea
                                  value={gar.condiciones ?? ''}
                                  onChange={e => updateCartGarantia(i.sku, 'condiciones', e.target.value.slice(0, 500))}
                                  placeholder="Condiciones de garantía (opcional)"
                                  rows={2}
                                  maxLength={500}
                                  style={{fontSize:11, padding:'3px 5px', border:'1px solid var(--border)', borderRadius:4, resize:'vertical', minHeight:38, fontFamily:'inherit'}}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {showCartInternos && (
                        <div style={{display:'flex', gap:5, padding:'5px 4px 3px', borderTop:'1px dashed #bbf7d0', marginTop:5}}>
                          {/* SearchSelect en vez de <select> plano: con cientos de
                              proveedores buscar en la lista desplegada era lento. */}
                          <SearchSelect
                            className="ss-btn-mini"
                            style={{flex:1, minWidth:0}}
                            value={cartInternos[i.sku]?.proveedor_id || ''}
                            onChange={v => updateCartInterno(i.sku, 'proveedor_id', v)}
                            placeholder="🔒 proveedor —"
                            options={(SSData.proveedores || []).map(p => ({ value: p.id, label: p.nombre }))}
                          />
                          <input
                            type="number" min="0" step="0.01"
                            value={cartInternos[i.sku]?.costo ?? ''}
                            onChange={e => updateCartInterno(i.sku, 'costo', e.target.value)}
                            placeholder="costo $"
                            style={{width:66, fontSize:11, padding:'2px 4px', border:'1px solid #bbf7d0', borderRadius:4, background:'#f0fdf4', color:'#15803d', textAlign:'right', fontFamily:'var(--font-mono)'}}
                          />
                          {(() => {
                            const costo = parseFloat(cartInternos[i.sku]?.costo);
                            const gan = (costo > 0 && i.precio > 0) ? ((i.precio - costo) / costo * 100) : null;
                            return <span style={{fontSize:11, fontWeight:600, color: gan != null ? '#15803d' : 'var(--text-muted)', minWidth:44, textAlign:'right', alignSelf:'center', fontFamily:'var(--font-mono)', fontVariantNumeric:'tabular-nums', flexShrink:0}}>
                              {gan != null ? `${gan.toFixed(1)}%` : '—'}
                            </span>;
                          })()}
                        </div>
                      )}
                    </div>
                  );
                };
                const out = [];
                cart.forEach((ci, idx) => {
                  if (addBtnPos === idx) out.push(renderAddBtn());
                  out.push(renderRow(ci, idx));
                });
                if (addBtnPos == null || addBtnPos >= cart.length) out.push(renderAddBtn());
                return out;
              })()}
            </div>
            <div className="cart-totals">
              <div className="total-row"><span className="muted">Subtotal items</span><span className="mono">{fmt.usd(subtotal)}</span></div>
              <div className="total-row" style={{alignItems:'center'}}>
                {modalidadPago === 'bcv' ? (
                  <>
                    <span className="muted" style={{flex:1, display:'flex', alignItems:'center', gap:4}}>
                      Cob. BCV
                      {!canEditCobertura && <span title="Solo administradores pueden modificar la cobertura" style={{fontSize:10, padding:'1px 5px', borderRadius:99, background:'var(--bg-sunken)', color:'var(--text-muted)'}}>🔒</span>}
                    </span>
                    {canEditCobertura ? (
                      <div style={{display:'flex', alignItems:'center', gap:3}}>
                        <span className="mono" style={{color:'var(--warn)'}}>+</span>
                        <input
                          type="number" min="0" max="100" step="0.5"
                          value={coberturaDoc == null ? '' : coberturaDoc}
                          placeholder="—"
                          onChange={e => setCoberturaDoc(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
                          style={{width:46, padding:'2px 5px', fontSize:12, textAlign:'center', borderRadius:5, border:`1px solid var(--${coberturaDoc == null ? 'danger' : 'warn'})`, background:'var(--bg-input, var(--bg))', color:`var(--${coberturaDoc == null ? 'danger' : 'warn'})`, fontFamily:'var(--font-mono)', fontWeight:700}}
                          title={coberturaDoc == null ? 'No hay cobertura BCV configurada en el sistema' : 'Cobertura BCV para esta cotización'}
                        />
                        <span className="mono" style={{color:'var(--warn)'}}>%</span>
                        {/* Un valor distinto al del sistema se ANUNCIA. Antes no se distinguía de la
                            cobertura oficial y un 33% tipeado una vez pasaba por normal. */}
                        {coberturaManual != null && coberturaSistema != null && (
                          <>
                            <span style={{fontSize:9.5, fontWeight:700, padding:'1px 5px', borderRadius:99, background:'var(--warn)', color:'#111'}}
                                  title={`Ajuste manual de esta cotización · el sistema tiene ${coberturaSistema}%`}>MANUAL</span>
                            <button onClick={() => setCoberturaDoc(coberturaSistema)} title={`Volver al ${coberturaSistema}% del sistema`} style={{background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:11, padding:'0 2px'}}>↺</button>
                          </>
                        )}
                      </div>
                    ) : (
                      <span className="mono" style={{color: cobertura == null ? 'var(--danger)' : 'var(--warn)'}}>
                        {cobertura == null ? 'sin definir' : '+' + cobertura + '%'}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="muted">Dcto. lista</span>
                    <span className="mono" style={{color:'var(--success)'}}>−{descuento}%</span>
                  </>
                )}
              </div>
              {/* Descuento global del documento */}
              <div className="total-row" style={{alignItems:'center'}}>
                <span className="muted" style={{flex:1}}>Dcto. cotización</span>
                <div style={{display:'flex', alignItems:'center', gap:4}}>
                  <input
                    type="number" min="0" max="100" step="1"
                    value={docDescuento || ''}
                    onChange={e => setDocDescuento(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                    placeholder="0"
                    style={{width:44, padding:'2px 5px', fontSize:12, textAlign:'center', borderRadius:5, border:'1px solid var(--border)', background:'var(--bg-input, var(--bg))', color:'var(--text)', fontFamily:'var(--font-mono)'}}
                  />
                  <span style={{fontSize:12, color:'var(--text-muted)'}}>%</span>
                  <span className="mono" style={{color:'var(--success)', marginLeft:4, minWidth:60, textAlign:'right'}}>
                    {docDescuento > 0 ? `−${fmt.usd(docDescuentoAmt)}` : '—'}
                  </span>
                </div>
              </div>
              {docDescuento > 0 && (
                <div className="total-row"><span className="muted">Subtotal neto</span><span className="mono">{fmt.usd(subtotalNet)}</span></div>
              )}
              {/* IVA con toggle */}
              <div className="total-row" style={{alignItems:'center'}}>
                <span className="muted" style={{display:'flex', alignItems:'center', gap:6}}>
                  IVA 16%
                  <label style={{display:'flex', alignItems:'center', gap:4, cursor:'pointer', userSelect:'none'}}>
                    <div
                      onClick={() => setAplicarIva(v => !v)}
                      style={{
                        width:28, height:16, borderRadius:8, cursor:'pointer',
                        background: aplicarIva ? 'var(--brand)' : 'var(--border)',
                        position:'relative', transition:'background .15s', flexShrink:0,
                      }}
                    >
                      <div style={{
                        position:'absolute', top:2, left: aplicarIva ? 14 : 2,
                        width:12, height:12, borderRadius:6,
                        background:'#fff', transition:'left .15s',
                        boxShadow:'0 1px 3px rgba(0,0,0,.2)',
                      }}/>
                    </div>
                    <span style={{fontSize:11, color: aplicarIva ? 'var(--brand)' : 'var(--text-muted)'}}>
                      {aplicarIva ? 'sí' : 'no'}
                    </span>
                  </label>
                </span>
                <span className="mono" style={{color: aplicarIva ? 'var(--text)' : 'var(--text-muted)'}}>
                  {aplicarIva ? fmt.usd(iva) : '—'}
                </span>
              </div>
              <div className="total-row grand"><span>Total USD</span><span className="mono">{fmt.usd(total)}</span></div>
              {(modalidadPago === 'bcv' || modalidadPago === 'bcv_fijo') && tasa.bcv > 0 && (
                <div className="total-row" style={{marginTop:2}}>
                  <span className="muted" style={{fontSize:11.5, display:'flex', alignItems:'center', gap:6}}>
                    <span className="rate-tag-sm" style={{background:'var(--bg-sunken)', color:'var(--text-muted)'}}>BCV</span>
                    <span>Bs. ({tasa.bcv})</span>
                  </span>
                  <span className="mono" style={{fontSize:12, color:'var(--text-muted)', fontWeight:700}}>{fmt.ves(total * tasa.bcv)}</span>
                </div>
              )}
              {modalidadPago === 'paralelo' && (
                <div className="total-row" style={{alignItems:'center'}}>
                  <span className="muted" style={{fontSize:11.5, display:'flex', alignItems:'center', gap:6}}>
                    <span className="rate-tag-sm" style={{background:'var(--accent-soft, #ede9fe)', color:'var(--accent)'}}>Par.</span>
                    Tasa
                    {!canEditTasaParalelo && <span title="Solo con permiso especial se puede modificar la tasa paralelo" style={{fontSize:10, padding:'1px 5px', borderRadius:99, background:'var(--bg-sunken)', color:'var(--text-muted)'}}>🔒</span>}
                  </span>
                  {canEditTasaParalelo ? (
                    <div style={{display:'flex', alignItems:'center', gap:3}}>
                      <input
                        type="number" min="0" step="0.01"
                        value={tasaParaleloDoc == null ? '' : tasaParaleloDoc}
                        placeholder="—"
                        onChange={e => setTasaParaleloDoc(e.target.value)}
                        style={{width:64, padding:'2px 5px', fontSize:12, textAlign:'center', borderRadius:5, border:`1px solid var(--${tasaParaleloDoc == null ? 'danger' : 'accent'})`, background:'var(--bg-input, var(--bg))', color:'var(--accent)', fontFamily:'var(--font-mono)', fontWeight:700}}
                        title={tasaParaleloDoc == null ? 'No hay tasa paralelo configurada en el sistema' : 'Tasa paralelo para esta cotización'}
                      />
                      {tasaParaleloManual != null && tasaParaleloSistema != null && (
                        <>
                          <span style={{fontSize:9.5, fontWeight:700, padding:'1px 5px', borderRadius:99, background:'var(--accent)', color:'#fff'}}
                                title={`Ajuste manual de esta cotización · el sistema tiene ${tasaParaleloSistema}`}>MANUAL</span>
                          <button onClick={() => setTasaParaleloDoc(tasaParaleloSistema)} title={`Volver a la tasa ${tasaParaleloSistema} del sistema`} style={{background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:11, padding:'0 2px'}}>↺</button>
                        </>
                      )}
                    </div>
                  ) : (
                    <span className="mono" style={{color: tasaParaleloDoc == null ? 'var(--danger)' : 'var(--accent)'}}>
                      {tasaParaleloDoc == null ? 'sin definir' : tasaParaleloDoc}
                    </span>
                  )}
                </div>
              )}
              {modalidadPago === 'paralelo' && tasaParaleloDoc > 0 && (
                <div className="total-row">
                  <span className="muted" style={{fontSize:11.5, paddingLeft:24}}>Equiv. Bs.</span>
                  <span className="mono" style={{fontSize:12, color:'var(--accent)', fontWeight:700}}>{fmt.ves(total * tasaParaleloDoc)}</span>
                </div>
              )}
              {camposErrors.length > 0 && (
                <div style={{background:'#fee2e2',border:'1px solid var(--danger)',borderRadius:8,padding:'10px 12px',marginBottom:8,fontSize:12}}>
                  <div style={{fontWeight:600,color:'var(--danger)',marginBottom:5,display:'flex',alignItems:'center',gap:6}}>
                    <Icon name="info" size={13}/>Campos obligatorios incompletos:
                  </div>
                  <ul style={{margin:0,paddingLeft:18,color:'#b91c1c',lineHeight:1.8}}>
                    {camposErrors.map(e => <li key={e}>{e}</li>)}
                  </ul>
                </div>
              )}
              <div className="flex gap-2 mt-3">
                {isEditing ? (
                  <>
                    <button className="btn secondary" style={{flex:1}} onClick={onEditDone} disabled={saving}>Cancelar</button>
                    <button className="btn secondary" style={{flex:1.5}} onClick={handleUpdateAndContinue} disabled={saving}><Icon name="check" size={14}/>{saving ? 'Guardando…' : 'Guardar y Seguir'}</button>
                    <button ref={saveCotRef} className="btn primary" style={{flex:2}} onClick={handleUpdate} disabled={saving}>
                      {saving ? 'Guardando…' : <><Icon name="check" size={14}/>Guardar cambios</>}
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn secondary" style={{flex: 1}} onClick={handleSaveAndContinue} disabled={saving}><Icon name="check" size={14}/>Guardar y Seguir</button>
                    {stageIdx === 0 && !docHijo && (
                      <button ref={saveCotRef} className="btn secondary" style={{flex: 1.5}} onClick={handleSaveCot} disabled={saving}>
                        {saving ? '…' : <><Icon name="doc" size={14}/>Guardar Cot.</>}
                      </button>
                    )}
                    {docHijo ? (
                      <button className="btn secondary" style={{flex: 2}} onClick={irAlDocHijo}
                              title={`Este carrito ya generó ${_HIJO_NOMBRE[docHijo.tipo] || 'un documento'} — ir a verla`}>
                        <Icon name="chevronR" size={14}/> Ya {_HIJO_HECHO[docHijo.tipo] || 'creada'} · {docHijo.id}
                      </button>
                    ) : (
                      <button ref={actionRef} className="btn primary" style={{flex: 2}} disabled={stageIdx === 3 || saving} onClick={handleAction}>
                        {saving && <>Guardando…</>}
                        {!saving && stageIdx === 0 && <>Convertir a Orden <Icon name="chevronR" size={14}/></>}
                        {!saving && stageIdx === 1 && <>Emitir Factura <Icon name="receipt" size={14}/></>}
                        {!saving && stageIdx === 2 && <>Generar Despacho <Icon name="truck" size={14}/></>}
                        {!saving && stageIdx === 3 && <><Icon name="check" size={14}/> Despachada</>}
                      </button>
                    )}
                  </>
                )}
              </div>
              {savedCot && (
                <div style={{marginTop:10,padding:'10px 14px',background:'color-mix(in srgb,var(--brand) 8%,transparent)',border:'1px solid color-mix(in srgb,var(--brand) 30%,transparent)',borderRadius:8,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                  <span style={{fontWeight:600,fontSize:12.5,color:'var(--brand)'}}>✓ {savedCot.id}</span>
                  <div style={{display:'flex',gap:6,marginLeft:'auto',flexWrap:'wrap'}}>
                    <button className="btn secondary" style={{fontSize:12,padding:'4px 10px',height:'auto'}}
                      onClick={async ()=>{
                        // El documento recién guardado se pide al server (una fila) en vez de
                        // buscarlo en memoria: el POS no carga documentos. Si la consulta falla, se
                        // imprime con lo que hay en pantalla antes que no imprimir nada.
                        const doc = await window.cargarDocumentoCompleto?.(savedCot.id);
                        const fullDoc = doc || {...savedCot, estado:'cotizacion'};
                        window.generateDocumentPDF&&window.generateDocumentPDF(fullDoc, fullDoc.lines?.length?fullDoc.lines:savedCot.lines,'usd');
                      }}>
                      <Icon name="download" size={12}/> PDF
                    </button>
                    {savedCot.slug && (
                      <button className="btn secondary" style={{fontSize:12,padding:'4px 10px',height:'auto'}}
                        onClick={()=>{
                          const url=window.location.origin+'/public/'+savedCot.slug;
                          navigator.clipboard.writeText(url).then(()=>showPosToast('Enlace copiado','success'));
                        }}>
                        <Icon name="link" size={12}/> Copiar link
                      </button>
                    )}
                    {/* Confirmar el pedido acá mismo: es el paso siguiente del flujo y antes
                        obligaba a salir del POS, esperar la lista y buscar la cotización.
                        Se mira `savedCot.tipo`, no `isEditing`: el compositor no avanza `stage`
                        al crear la orden/factura, así que con `!isEditing` el botón seguía
                        ofreciéndose sobre un documento que ya no era una cotización. */}
                    {savedCot.tipo === 'cotizacion' && !ordenCreada && (
                      <button className="btn primary" style={{fontSize:12,padding:'4px 10px',height:'auto'}}
                        onClick={confirmarPedido} disabled={confirmandoPedido}
                        title="Convertir esta cotización en orden de venta">
                        <Icon name="check" size={12}/> {confirmandoPedido ? 'Confirmando…' : 'Confirmar pedido'}
                      </button>
                    )}
                    {ordenCreada && (
                      <button className="btn secondary" style={{fontSize:12,padding:'4px 10px',height:'auto'}}
                        onClick={()=>abrirHijo(ordenCreada.id, 'orden')}
                        title="Abrir la orden de venta">
                        <Icon name="chevronR" size={12}/> Ver orden · {ordenCreada.id}
                      </button>
                    )}
                    {isEditing ? (
                      <button className="btn primary" style={{fontSize:12,padding:'4px 10px',height:'auto'}}
                        onClick={()=>{ setSavedCot(null); if (onEditDone) onEditDone(); }}>
                        Cerrar edición
                      </button>
                    ) : (
                      <button className="btn primary" style={{fontSize:12,padding:'4px 10px',height:'auto'}}
                        onClick={()=>resetPOS()}>
                        + Nueva cotización
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>}
      </div>

      {/* Modales quick-create cliente/contacto */}
      {quickCreate?.type === 'cliente' && (
        <QuickNewClientModal
          initialNombre={quickCreate.nombre}
          onClose={() => setQuickCreate(null)}
          onCreated={id => { setClienteId(id); setDirFactura(''); setDirEntrega(''); }}
        />
      )}
      {quickCreate?.type === 'contacto' && (
        <QuickNewContactModal
          initialNombre={quickCreate.nombre}
          onClose={() => setQuickCreate(null)}
          onCreated={id => { setClienteId(id); setDirFactura(''); setDirEntrega(''); }}
        />
      )}

      {/* Modal de condiciones del documento */}
      {showConditions && (
        <div className="modal-overlay" onClick={() => setShowConditions(false)} style={{zIndex:200}}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{width:'min(640px, 96vw)', maxHeight:'90vh', display:'flex', flexDirection:'column'}}>
            <div className="modal-header" style={{padding:'14px 18px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:10}}>
              <div className="modal-title" style={{fontWeight:600, fontSize:14}}>Condiciones del documento</div>
              <button className="icon-btn" onClick={() => setShowConditions(false)}><Icon name="x" size={14}/></button>
            </div>
            <div className="modal-body" style={{padding:'16px 18px', overflowY:'auto', flex:1}}>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px 14px'}}>
                {!isHidden('tipo_venta') && <div>
                  <div className="small muted" style={{marginBottom:3}}>Tipo de venta {isRequired('tipo_venta') && <span style={{color:'var(--danger)'}}>*</span>}</div>
                  <select className="select" value={tipoVenta} onChange={e=>{setTipoVenta(e.target.value);setCamposErrors([]);}} style={{width:'100%', borderColor: isRequired('tipo_venta') && !tipoVenta ? 'var(--danger)' : ''}}>
                    <option value="regular">Regular</option>
                    <option value="especial">Especial</option>
                    <option value="consignacion">Consignación</option>
                    <option value="muestra">Muestra</option>
                  </select>
                </div>}
                {!isHidden('vencimiento') && <div>
                  <div className="small muted" style={{marginBottom:3}}>Vencimiento {isRequired('vencimiento') && <span style={{color:'var(--danger)'}}>*</span>}</div>
                  <input type="date" className="input" value={vencimiento} onChange={e=>{setVencimiento(e.target.value);setCamposErrors([]);}} style={{width:'100%', borderColor: isRequired('vencimiento') && !vencimiento ? 'var(--danger)' : ''}} />
                </div>}
                {!isHidden('terminos_pago') && <div>
                  <div className="small muted" style={{marginBottom:3}}>Términos de pago {isRequired('terminos_pago') && <span style={{color:'var(--danger)'}}>*</span>}</div>
                  <select className="select" value={terminosPago} onChange={e=>{setTerminosPago(e.target.value);setCamposErrors([]);}} style={{width:'100%'}}>
                    <option value="inmediato">Pago inmediato</option>
                    {plazosCredito.map(d => (
                      <option key={d} value={String(d)}>Crédito {d} días</option>
                    ))}
                  </select>
                  {!clientePuedeCredito && (
                    <div className="small muted" style={{marginTop:3,fontSize:11}}>Este cliente no tiene línea de crédito — solo pago inmediato.</div>
                  )}
                  {clientePuedeCredito && diasCredito <= 0 && (
                    <div className="small muted" style={{marginTop:3,fontSize:11}}>
                      Tiene límite de crédito pero no días configurados — defínelos en su ficha de Clientes.
                    </div>
                  )}
                  {clientePuedeCredito && diasCredito > 0 && (
                    <div className="small muted" style={{marginTop:3,fontSize:11}}>
                      Máximo {diasCredito} días de crédito según su ficha de Clientes.
                    </div>
                  )}
                  {clientePuedeCredito && esVentaCredito && (
                    <div className="small" style={{marginTop:4,fontSize:11.5,fontWeight:excedeCredito?600:400,color: excedeCredito ? 'var(--danger)' : 'var(--text-muted)'}}>
                      {excedeCredito
                        ? `⚠ Excede el crédito disponible (${fmt.usd(creditoDisponible)}) — puedes emitir igual.`
                        : `Crédito disponible: ${fmt.usd(creditoDisponible)}`}
                    </div>
                  )}
                </div>}
                {!isHidden('vendedor') && <div>
                  <div className="small muted" style={{marginBottom:3}}>
                    Vendedor asignado {isRequired('vendedor') && <span style={{color:'var(--danger)'}}>*</span>}
                    {!canEditVendedor && <span title="Se asigna desde el cliente. Requiere permiso para cambiar." style={{marginLeft:6, fontSize:10, padding:'1px 6px', borderRadius:99, background:'var(--bg-sunken)', color:'var(--text-muted)'}}>🔒 Solo lectura</span>}
                  </div>
                  <select className="select" value={vendedor} disabled={!canEditVendedor} onChange={e=>{setVendedor(e.target.value);setCamposErrors([]);}} style={{width:'100%', borderColor: isRequired('vendedor') && !vendedor ? 'var(--danger)' : '', opacity: canEditVendedor ? 1 : 0.7, cursor: canEditVendedor ? 'pointer' : 'not-allowed'}} title={!canEditVendedor ? 'Solo usuarios con permiso "Cambiar vendedor en cotización" pueden modificar este campo.' : ''}>
                    <option value="">— Seleccionar —</option>
                    {vendedoresList.map(v => <option key={v.id} value={v.nombre}>{v.nombre}</option>)}
                  </select>
                </div>}
                {!isHidden('tipo_entrega') && <div>
                  <div className="small muted" style={{marginBottom:3}}>Tipo de entrega {isRequired('tipo_entrega') && <span style={{color:'var(--danger)'}}>*</span>}</div>
                  <select className="select" value={tipoEntrega} onChange={e=>{setTipoEntrega(e.target.value);setCamposErrors([]);}} style={{width:'100%'}}>
                    {tiposEntregaOpts.map(t => <option key={t.id} value={t.valor}>{t.nombre}</option>)}
                    {tipoEntrega && !tiposEntregaOpts.some(t => t.valor === tipoEntrega) && (
                      <option value={tipoEntrega}>{window.ssLabelEntrega(tipoEntrega)}</option>
                    )}
                  </select>
                </div>}
                {!isHidden('fuente') && <div>
                  <div className="small muted" style={{marginBottom:3}}>Fuente {isRequired('fuente') && <span style={{color:'var(--danger)'}}>*</span>}</div>
                  <select className="select" value={fuente} onChange={e=>{setFuente(e.target.value);setCamposErrors([]);}} style={{width:'100%', borderColor: isRequired('fuente') && !fuente ? 'var(--danger)' : ''}}>
                    <option value="">— Ninguna —</option>
                    {fuentesVenta.length === 0
                      ? <>
                          <option value="whatsapp">WhatsApp</option>
                          <option value="web">Web</option>
                          <option value="telefono">Teléfono</option>
                          <option value="referido">Referido</option>
                          <option value="presencial">Presencial</option>
                        </>
                      : fuentesVenta.map(f => <option key={f.id} value={f.nombre}>{f.nombre}</option>)
                    }
                  </select>
                </div>}
                {fuente === 'crm' && (
                  <div style={{gridColumn:'1/-1'}}>
                    <div className="small muted" style={{marginBottom:3}}>ID CRM</div>
                    <input className="input" value={idCrm} onChange={e=>setIdCrm(e.target.value)} placeholder="Ej. 15286351" style={{width:'100%'}} />
                  </div>
                )}
                {needsDelivery && !isHidden('zona_delivery') && (
                  <>
                    <div>
                      <div className="small muted" style={{marginBottom:3}}>Zona delivery {isRequired('zona_delivery') && <span style={{color:'var(--danger)'}}>*</span>}</div>
                      <input className="input" value={zonaDelivery} onChange={e=>{setZonaDelivery(e.target.value);setCamposErrors([]);}} placeholder="Zona..." style={{width:'100%', borderColor: isRequired('zona_delivery') && !zonaDelivery ? 'var(--danger)' : ''}} />
                    </div>
                    {!isHidden('nro_despacho') && <div>
                      <div className="small muted" style={{marginBottom:3}}>Nro Despacho SOS {isRequired('nro_despacho') && <span style={{color:'var(--danger)'}}>*</span>}</div>
                      <input className="input" value={nroDespacho} onChange={e=>{setNroDespacho(e.target.value);setCamposErrors([]);}} placeholder="SOS-..." style={{width:'100%', borderColor: isRequired('nro_despacho') && !nroDespacho ? 'var(--danger)' : ''}} />
                    </div>}
                  </>
                )}
                {!isHidden('dir_factura') && <div style={{gridColumn:'1/-1'}}>
                  <div className="small muted" style={{marginBottom:3}}>Dirección de factura {isRequired('dir_factura') && <span style={{color:'var(--danger)'}}>*</span>}</div>
                  <input className="input" value={dirFactura} onChange={e=>{setDirFactura(e.target.value);setCamposErrors([]);}} placeholder="Dirección fiscal del cliente..." style={{width:'100%', borderColor: isRequired('dir_factura') && !dirFactura ? 'var(--danger)' : ''}} />
                </div>}
                {!isHidden('dir_entrega') && <div style={{gridColumn:'1/-1'}}>
                  <div className="small muted" style={{marginBottom:3}}>Dirección de entrega {isRequired('dir_entrega') && <span style={{color:'var(--danger)'}}>*</span>}</div>
                  <input className="input" value={dirEntrega} onChange={e=>{setDirEntrega(e.target.value);setCamposErrors([]);}} placeholder="Dirección de entrega..." style={{width:'100%', borderColor: isRequired('dir_entrega') && !dirEntrega ? 'var(--danger)' : ''}} />
                </div>}
                {!isHidden('observaciones') && <div style={{gridColumn:'1/-1'}}>
                  <div className="small muted" style={{marginBottom:3}}>Observaciones {isRequired('observaciones') && <span style={{color:'var(--danger)'}}>*</span>}</div>
                  <textarea className="input" rows={2} value={observaciones} onChange={e=>{setObservaciones(e.target.value);setCamposErrors([]);}}
                    placeholder="Notas internas o instrucciones para el cliente..."
                    style={{width:'100%', resize:'vertical', fontFamily:'inherit', fontSize:12.5, lineHeight:1.4, borderColor: isRequired('observaciones') && !observaciones ? 'var(--danger)' : ''}} />
                </div>}
              </div>
            </div>
            <div className="modal-footer" style={{padding:'12px 18px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:8}}>
              <button className="btn primary" onClick={() => setShowConditions(false)}>
                <Icon name="check" size={14}/>Listo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Icono volador */}
      {flyIcon && (
        <FlyingDoc
          key={flyIcon.key}
          startX={flyIcon.startX}
          startY={flyIcon.startY}
          endX={flyIcon.endX}
          endY={flyIcon.endY}
          onDone={() => setFlyIcon(null)}
        />
      )}

      {/* Modal pedido por voz */}
      {showVoiceModal && (
        <VoiceOrderModal
          onClose={() => setShowVoiceModal(false)}
          onApply={applyVoiceOrder}
          allProductos={SSData.productos}
          allClientes={SSData.clientes}
          apiKey={getAnthropicKey()}
        />
      )}

      {/* Modal de confirmación al guardar cotización */}
      {showConfirmCot && (() => {
        const nombreCliente = cliente?.nombre || contacto?.nombre || '—';
        const modalidadLabel = { divisas:'Precio USD · cliente paga en dólares', bcv:`Bolívares BCV · tasa ${tasa.bcv}`, bcv_fijo:`Nota BCV · tasa exacta ${tasa.bcv}`, paralelo:`Bolívares paralelo · tasa ${tasaParaleloDoc ?? tasa.paralelo}` }[modalidadPago] || modalidadPago;
        return (
          <div className="modal-overlay" onClick={()=>setShowConfirmCot(false)} style={{zIndex:500}}>
            <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:440, width:'95vw'}}>
              <div className="modal-header">
                <div style={{width:38,height:38,borderRadius:9,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center',flexShrink:0}}>
                  <Icon name="doc" size={18}/>
                </div>
                <div style={{flex:1}}>
                  <div className="modal-title">Confirmar cotización</div>
                  <div className="small muted">Revisa los datos antes de guardar</div>
                </div>
                <button className="icon-btn" onClick={()=>setShowConfirmCot(false)}><Icon name="x" size={14}/></button>
              </div>
              <div className="modal-body" style={{padding:'16px 18px', display:'flex', flexDirection:'column', gap:10}}>
                {/* Cliente */}
                <div style={{display:'flex', justifyContent:'space-between', padding:'10px 12px', background:'var(--bg-sunken)', borderRadius:8}}>
                  <span className="small muted">Cliente</span>
                  <span style={{fontWeight:600, fontSize:13}}>{nombreCliente}</span>
                </div>
                {/* Modalidad de pago */}
                <div style={{display:'flex', justifyContent:'space-between', padding:'10px 12px', background: 'var(--brand-soft)', borderRadius:8, border:'1px solid var(--brand)'}}>
                  <span className="small" style={{color:'var(--brand)', fontWeight:500}}>Modalidad de pago</span>
                  <span style={{fontWeight:700, fontSize:13, color:'var(--brand)'}}>{modalidadLabel}</span>
                </div>
                {/* Productos */}
                <div style={{padding:'10px 12px', background:'var(--bg-sunken)', borderRadius:8}}>
                  <div style={{display:'flex', justifyContent:'space-between', marginBottom:6}}>
                    <span className="small muted">Productos</span>
                    <span className="small muted">{cartDetails.length} ítem(s) · {cartDetails.reduce((s,i)=>s+i.qty,0)} unidades</span>
                  </div>
                  {cartDetails.slice(0,4).map(i=>(
                    <div key={i.sku} style={{display:'flex', justifyContent:'space-between', fontSize:12, padding:'3px 0', borderBottom:'1px solid var(--border)'}}>
                      <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'60%'}}>{i.nombre}</span>
                      <span className="mono" style={{color:'var(--text-muted)'}}>×{i.qty} · {fmt.usd(i.subtotal)}</span>
                    </div>
                  ))}
                  {cartDetails.length > 4 && <div className="small muted mt-2">…y {cartDetails.length-4} más</div>}
                </div>
                {/* Totales */}
                <div style={{padding:'10px 12px', background:'var(--bg-sunken)', borderRadius:8, display:'flex', flexDirection:'column', gap:4}}>
                  {descuento > 0 && <div style={{display:'flex', justifyContent:'space-between', fontSize:12}}><span className="muted">Dcto. lista ({descuento}%)</span><span className="mono" style={{color:'var(--success)'}}>−{fmt.usd(subtotal*(descuento/100))}</span></div>}
                  {docDescuento > 0 && <div style={{display:'flex', justifyContent:'space-between', fontSize:12}}><span className="muted">Dcto. cotización ({docDescuento}%)</span><span className="mono" style={{color:'var(--success)'}}>−{fmt.usd(docDescuentoAmt)}</span></div>}
                  {aplicarIva && <div style={{display:'flex', justifyContent:'space-between', fontSize:12}}><span className="muted">IVA 16%</span><span className="mono">{fmt.usd(iva)}</span></div>}
                  <div style={{display:'flex', justifyContent:'space-between', fontWeight:700, fontSize:15, borderTop:'1px solid var(--border)', paddingTop:6, marginTop:2}}>
                    <span>Total USD</span><span className="mono" style={{color:'var(--brand)'}}>{fmt.usd(total)}</span>
                  </div>
                  {modalidadPago !== 'divisas' && (
                    <div style={{display:'flex', justifyContent:'space-between', fontSize:12}}>
                      <span className="muted">Equivalente Bs.</span>
                      <span className="mono">{fmt.ves(totalBs)}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn ghost" onClick={()=>setShowConfirmCot(false)}>Revisar</button>
                <button className="btn primary" onClick={doSaveCot}>
                  <Icon name="check" size={14}/>Confirmar y guardar
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ¿Confirmar el pedido? — sale al GUARDAR CAMBIOS de una cotización que todavía no tiene
          orden. Es el momento en que se decide; antes había que cerrar el compositor, volver a la
          lista, buscar el cliente y abrir el documento otra vez para que apareciera el botón. */}
      {preguntarOrden && savedCot && (
        <div className="modal-overlay" onClick={()=>setPreguntarOrden(false)} style={{zIndex:520}}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:420, width:'95vw'}}>
            <div className="modal-header">
              <div style={{width:38,height:38,borderRadius:9,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center',flexShrink:0}}>
                <Icon name="check" size={18}/>
              </div>
              <div style={{flex:1}}>
                <div className="modal-title">¿Convertir a orden de venta?</div>
                <div className="small muted">Cotización {savedCot.id} guardada</div>
              </div>
              <button className="icon-btn" onClick={()=>setPreguntarOrden(false)} disabled={confirmandoPedido}><Icon name="x" size={14}/></button>
            </div>
            <div className="modal-body" style={{padding:'16px 18px'}}>
              <div style={{padding:'12px 14px', background:'var(--bg-sunken)', borderRadius:8, fontSize:13, lineHeight:1.65}}>
                Los cambios ya están guardados. Si confirmás el pedido se crea la orden de venta y
                el inventario queda reservado para este cliente.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn ghost" onClick={()=>setPreguntarOrden(false)} disabled={confirmandoPedido}>
                No, seguir en cotización
              </button>
              <button className="btn primary" disabled={confirmandoPedido}
                onClick={async ()=>{ await confirmarPedido(); setPreguntarOrden(false); }}>
                <Icon name="check" size={14}/>{confirmandoPedido ? 'Convirtiendo…' : 'Sí, convertir a orden'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación al convertir cotización → orden */}
      {showPosOpciones && (
        <PosOpcionesModal onClose={() => setShowPosOpciones(false)}/>
      )}

      {showConfirmAction && (() => {
        const nombreCliente = cliente?.nombre || contacto?.nombre || '—';
        const modalidadLabel = { divisas:'Precio USD · cliente paga en dólares', bcv:`Bolívares BCV · tasa ${tasa.bcv}`, bcv_fijo:`Nota BCV · tasa exacta ${tasa.bcv}`, paralelo:`Bolívares paralelo · tasa ${tasaParaleloDoc ?? tasa.paralelo}` }[modalidadPago] || modalidadPago;
        return (
          <div className="modal-overlay" onClick={()=>setShowConfirmAction(false)} style={{zIndex:500}}>
            <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:440, width:'95vw'}}>
              <div className="modal-header">
                <div style={{width:38,height:38,borderRadius:9,background:'var(--success-soft,#dcfce7)',color:'var(--success,#16a34a)',display:'grid',placeItems:'center',flexShrink:0}}>
                  <Icon name="check" size={18}/>
                </div>
                <div style={{flex:1}}>
                  <div className="modal-title">Convertir a Orden de Venta</div>
                  <div className="small muted">{pendingActionId || 'El número se asigna al confirmar'}</div>
                </div>
                <button className="icon-btn" onClick={()=>setShowConfirmAction(false)}><Icon name="x" size={14}/></button>
              </div>
              <div className="modal-body" style={{padding:'16px 18px', display:'flex', flexDirection:'column', gap:10}}>
                <div style={{display:'flex', justifyContent:'space-between', padding:'10px 12px', background:'var(--bg-sunken)', borderRadius:8}}>
                  <span className="small muted">Cliente</span>
                  <span style={{fontWeight:600, fontSize:13}}>{nombreCliente}</span>
                </div>
                <div style={{display:'flex', justifyContent:'space-between', padding:'10px 12px', background:'var(--brand-soft)', borderRadius:8, border:'1px solid var(--brand)'}}>
                  <span className="small" style={{color:'var(--brand)', fontWeight:500}}>Modalidad de pago</span>
                  <span style={{fontWeight:700, fontSize:13, color:'var(--brand)'}}>{modalidadLabel}</span>
                </div>
                <div style={{padding:'10px 12px', background:'var(--bg-sunken)', borderRadius:8}}>
                  <div style={{display:'flex', justifyContent:'space-between', marginBottom:6}}>
                    <span className="small muted">Productos</span>
                    <span className="small muted">{cartDetails.length} ítem(s) · {cartDetails.reduce((s,i)=>s+i.qty,0)} unidades</span>
                  </div>
                  {cartDetails.slice(0,4).map(i=>(
                    <div key={i.sku} style={{display:'flex', justifyContent:'space-between', fontSize:12, padding:'3px 0', borderBottom:'1px solid var(--border)'}}>
                      <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'60%'}}>{i.nombre}</span>
                      <span className="mono" style={{color:'var(--text-muted)'}}>×{i.qty} · {fmt.usd(i.subtotal)}</span>
                    </div>
                  ))}
                  {cartDetails.length > 4 && <div className="small muted mt-2">…y {cartDetails.length-4} más</div>}
                </div>
                <div style={{padding:'10px 12px', background:'var(--bg-sunken)', borderRadius:8, display:'flex', flexDirection:'column', gap:4}}>
                  {descuento > 0 && <div style={{display:'flex', justifyContent:'space-between', fontSize:12}}><span className="muted">Dcto. lista ({descuento}%)</span><span className="mono" style={{color:'var(--success)'}}>−{fmt.usd(subtotal*(descuento/100))}</span></div>}
                  {docDescuento > 0 && <div style={{display:'flex', justifyContent:'space-between', fontSize:12}}><span className="muted">Dcto. orden ({docDescuento}%)</span><span className="mono" style={{color:'var(--success)'}}>−{fmt.usd(docDescuentoAmt)}</span></div>}
                  {aplicarIva && <div style={{display:'flex', justifyContent:'space-between', fontSize:12}}><span className="muted">IVA 16%</span><span className="mono">{fmt.usd(iva)}</span></div>}
                  <div style={{display:'flex', justifyContent:'space-between', fontWeight:700, fontSize:15, borderTop:'1px solid var(--border)', paddingTop:6, marginTop:2}}>
                    <span>Total USD</span><span className="mono" style={{color:'var(--brand)'}}>{fmt.usd(total)}</span>
                  </div>
                  {modalidadPago !== 'divisas' && (
                    <div style={{display:'flex', justifyContent:'space-between', fontSize:12}}>
                      <span className="muted">Equivalente Bs.</span>
                      <span className="mono">{fmt.ves(totalBs)}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn ghost" onClick={()=>setShowConfirmAction(false)}>Revisar</button>
                <button className="btn primary" onClick={()=>doAction()}>
                  <Icon name="check" size={14}/>Confirmar y convertir
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal bloqueante: stock insuficiente por reservas en otras órdenes */}
      {ordenDup && (() => {
        // Cuánta mercancía se va a comprometer DE NUEVO si insiste. Es el número que explica el
        // problema: sin esto el aviso es "ya existe" y no dice por qué importa. Lo pasa el
        // llamador porque en "Confirmar pedido" el carrito ya se vació y sale de la cotización.
        const uds = ordenDup.uds || 0;
        const hace = d => {
          const min = Math.round((Date.now() - new Date(d.created_at).getTime()) / 60000);
          if (!isFinite(min) || min < 0) return '';
          if (min < 60) return `hace ${min} min`;
          if (min < 1440) return `hace ${Math.round(min / 60)} h`;
          return `hace ${Math.round(min / 1440)} d`;
        };
        return (
          <div className="modal-overlay" onClick={() => setOrdenDup(null)} style={{zIndex:10001}}>
            <div className="modal" style={{width:'min(560px,96vw)'}} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div style={{width:38,height:38,borderRadius:9,background:'#fef3c718',color:'#b45309',display:'grid',placeItems:'center',flexShrink:0}}>
                  <Icon name="alert" size={20}/>
                </div>
                <div style={{flex:1}}>
                  <div className="modal-title" style={{color:'#b45309'}}>
                    {ordenDup.docs.length === 1 ? 'Ya existe esta misma orden' : 'Ya existen órdenes iguales'}
                  </div>
                  <div className="small muted">Mismo cliente, mismos productos y mismas cantidades</div>
                </div>
                <button className="icon-btn" onClick={() => setOrdenDup(null)}><Icon name="x" size={14}/></button>
              </div>
              <div className="modal-body">
                <div style={{display:'flex', flexDirection:'column', gap:6, marginBottom:14}}>
                  {ordenDup.docs.map(d => (
                    <button key={d.id} className="btn secondary" style={{justifyContent:'space-between'}}
                            onClick={async () => { setOrdenDup(null); const ok = await window.abrirDocumentoPorId?.(d.id); if (!ok) alert('No se pudo abrir ' + d.id + '. Puede que lo hayan anulado.'); }}>
                      <span style={{display:'flex', alignItems:'center', gap:7}}>
                        <Icon name="chevronR" size={13}/><span className="mono">{d.id}</span>
                        <span className="muted small">{hace(d)}</span>
                      </span>
                      <span className="muted small">
                        {fmt.date(d.fecha)}{d.total != null ? ' · ' + fmt.usd(parseFloat(d.total) || 0) : ''}
                        {d.estado ? ' · ' + d.estado : ''}
                      </span>
                    </button>
                  ))}
                </div>
                <div style={{background:'rgba(251,191,36,.09)', border:'1px solid rgba(251,191,36,.3)', borderRadius:10, padding:'12px 14px'}}>
                  <div style={{fontSize:13, lineHeight:1.55}}>
                    Si la creas igual, se van a reservar <strong>{uds} unidad{uds === 1 ? '' : 'es'} más</strong> de
                    inventario. Esa mercancía queda en <strong>hold</strong> a nombre de las dos órdenes y deja de
                    estar disponible para facturar, hasta que canceles la que sobra.
                  </div>
                </div>
              </div>
              <div className="modal-footer" style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
                <button className="btn secondary" onClick={() => setOrdenDup(null)}>Cancelar</button>
                <button className="btn primary" style={{background:'#d97706', borderColor:'#d97706'}}
                        onClick={() => { const go = ordenDup.continuar; setOrdenDup(null); go && go(); }}>
                  Crear de todas formas
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {blockingReservaAlert && (
        <div className="modal-backdrop" onClick={() => setBlockingReservaAlert(null)} style={{position:'fixed', inset:0, background:'rgba(0,0,0,.65)', display:'grid', placeItems:'center', zIndex:10000}}>
          <div onClick={e => e.stopPropagation()} style={{background:'#1c1c1e', color:'var(--text, #fff)', border:'1px solid rgba(255,255,255,.1)', borderRadius:16, padding:'24px 26px', width:'min(480px, 92vw)', boxShadow:'0 24px 64px rgba(0,0,0,.7), 0 0 0 1px rgba(251,191,36,.15)'}}>

            {/* Header */}
            <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:20}}>
              <div style={{width:44, height:44, borderRadius:11, background:'rgba(251,191,36,.15)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, color:'#fbbf24'}}>
                <Icon name="info" size={22}/>
              </div>
              <div>
                <div style={{fontWeight:700, fontSize:16}}>Stock insuficiente</div>
                <div style={{fontSize:12.5, marginTop:2}}>
                  <strong style={{color:'var(--text)'}}>{blockingReservaAlert.nombre}</strong>
                  <span style={{color:'var(--text-muted)'}}> · {blockingReservaAlert.sku}</span>
                </div>
              </div>
            </div>

            {/* Hero: faltan — ámbar, no rojo */}
            <div style={{background:'linear-gradient(135deg, rgba(251,191,36,.12) 0%, rgba(245,158,11,.08) 100%)', border:'1.5px solid rgba(251,191,36,.35)', borderRadius:12, padding:'20px 20px 18px', marginBottom:14, textAlign:'center'}}>
              <div style={{fontSize:11, fontWeight:700, color:'#fbbf24', letterSpacing:1.2, textTransform:'uppercase', marginBottom:8}}>Unidades faltantes</div>
              <div style={{fontSize:56, fontWeight:900, color:'#f59e0b', lineHeight:1, fontVariantNumeric:'tabular-nums'}}>
                {(blockingReservaAlert.cartQty + blockingReservaAlert.enOrden) - blockingReservaAlert.stockTotal}
              </div>
            </div>

            {/* Semáforo: verde · ámbar · rojo */}
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:22}}>
              {/* Verde — stock disponible */}
              <div style={{background:'rgba(34,197,94,.08)', border:'1px solid rgba(34,197,94,.25)', borderRadius:10, padding:'12px 10px', textAlign:'center'}}>
                <div style={{fontSize:10, color:'#4ade80', marginBottom:5, textTransform:'uppercase', letterSpacing:.6, fontWeight:600}}>Stock total</div>
                <div style={{fontSize:26, fontWeight:800, color:'#4ade80'}}>{blockingReservaAlert.stockTotal}</div>
                <div style={{fontSize:9.5, color:'rgba(74,222,128,.6)', marginTop:3}}>disponible</div>
              </div>
              {/* Ámbar — tu pedido */}
              <div style={{background:'rgba(251,191,36,.08)', border:'1px solid rgba(251,191,36,.25)', borderRadius:10, padding:'12px 10px', textAlign:'center'}}>
                <div style={{fontSize:10, color:'#fbbf24', marginBottom:5, textTransform:'uppercase', letterSpacing:.6, fontWeight:600}}>Tu carrito</div>
                <div style={{fontSize:26, fontWeight:800, color:'#fbbf24'}}>{blockingReservaAlert.cartQty}</div>
                <div style={{fontSize:9.5, color:'rgba(251,191,36,.6)', marginTop:3}}>solicitado</div>
              </div>
              {/* Rojo — reservado por otras órdenes */}
              <div style={{background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.3)', borderRadius:10, padding:'12px 10px', textAlign:'center'}}>
                <div style={{fontSize:10, color:'#f87171', marginBottom:5, textTransform:'uppercase', letterSpacing:.6, fontWeight:600}}>Reservado</div>
                <div style={{fontSize:26, fontWeight:800, color:'#f87171'}}>{blockingReservaAlert.enOrden}</div>
                <div style={{fontSize:9.5, color:'rgba(248,113,113,.6)', marginTop:3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{blockingReservaAlert.ordenesStr}</div>
              </div>
            </div>

            {/* Acciones */}
            <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
              <button className="btn secondary" onClick={() => setBlockingReservaAlert(null)}>Cancelar</button>
              <button className="btn primary" style={{background:'#d97706', borderColor:'#d97706'}} onClick={() => {
                const p = blockingReservaAlert.producto;
                setBlockingReservaAlert(null);
                _doAddProduct(p);
                showPosToast(`Agregado pese a reserva en ${blockingReservaAlert.ordenesStr}`, 'error');
              }}>Agregar de todos modos</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast de validación */}
      {posToast && (
        <div style={{
          position:'fixed', bottom:28, left:'50%', transform:'translateX(-50%)',
          background: posToast.type === 'error' ? '#1e1e1e' : '#14532d',
          border: `1.5px solid ${posToast.type === 'error' ? 'var(--danger)' : 'var(--success)'}`,
          borderRadius:10, padding:'12px 20px',
          display:'flex', alignItems:'center', gap:10,
          boxShadow:'0 6px 28px rgba(0,0,0,.35)',
          zIndex:9999, fontSize:13, fontWeight:500, color:'#fff',
          maxWidth:'min(480px, 90vw)', whiteSpace:'pre-wrap',
        }}>
          <Icon name={posToast.type === 'error' ? 'info' : 'check'} size={16}/>
          {posToast.msg}
        </div>
      )}

      {/* FAB carrito — solo móvil, solo cuando hay items y el cart está cerrado */}
      {!cartOpen && cart.length > 0 && (
        <button className="pos-cart-fab" onClick={() => setCartOpen(true)} aria-label="Abrir carrito">
          <span style={{display:'flex', alignItems:'center', gap:10}}>
            <Icon name="box" size={18}/>
            <span>Ver carrito</span>
            <span className="fab-count">{cart.length}</span>
          </span>
          <span className="fab-total">{fmt.usd(total)}</span>
        </button>
      )}
    </div>
  );
}

// ====================== Estado de envío (driver_despachos) ======================
// Se calcula cruzando el doc con SSData.driverDespachos por despacho_id === doc.id.
// Aplica a stage='despacho' y stage='factura' (la factura conserva el mismo id del despacho).
const ENVIO_META = {
  recibido:             { label: 'Recibido',             color: '#0891b2' },
  preparando:           { label: 'Preparando',           color: '#d97706' },
  pendiente_por_enviar: { label: 'Pendiente por enviar', color: '#b45309' },
  en_ruta:              { label: 'En ruta',              color: '#2563eb' },
  entregado:            { label: 'Entregado',            color: '#16a34a' },
  no_entregado:         { label: 'No entregado',         color: '#dc2626' },
};
const ENVIO_ORDER = { recibido: 0, preparando: 1, pendiente_por_enviar: 2, en_ruta: 3, entregado: 4, no_entregado: 5 };
// Acepta el DOC (preferido) o su id. La entrega migrada de Odoo (y la entrega real registrada en
// el despacho) vive en documentos.entregado_en, que SIEMPRE viaja con la fila del listado — no
// depende de driver_despachos (ventana 60d que dejaba los despachos viejos como 'pendiente').
function getEstadoEnvio(docOrId) {
  const doc = (docOrId && typeof docOrId === 'object') ? docOrId : null;
  const docId = doc ? doc.id : docOrId;
  const dd = (SSData.driverDespachos || []).find(x => x.despacho_id === docId);
  if (dd) {
    if (dd.estado === 'recibido')   return 'recibido';
    if (dd.estado === 'preparando') return 'preparando';
    if (dd.estado === 'en_ruta')    return 'en_ruta';
    if (dd.estado === 'entregado')  return 'entregado';
    if (dd.estado === 'incidencia') return 'no_entregado';
  }
  // Sin registro de driver (o 'pendiente'): si el despacho está marcado entregado en el doc → entregado.
  if (doc && doc.entregado_en) return 'entregado';
  return 'pendiente_por_enviar';
}

// UI → DB. Inverso del mapeo en getEstadoEnvio.
const ENVIO_UI_TO_DB = { recibido:'recibido', preparando:'preparando', pendiente_por_enviar:'pendiente', en_ruta:'en_ruta', entregado:'entregado', no_entregado:'incidencia' };

// Fecha/hora exacta (timestamptz) en que el despacho fue declarado entregado.
// driver_despachos.fecha es solo DATE y se reescribe en cada cambio de estado;
// entregado_en es el único campo confiable para el momento real de la entrega.
function getEntregadoEn(docOrId) {
  const doc = (docOrId && typeof docOrId === 'object') ? docOrId : null;
  const docId = doc ? doc.id : docOrId;
  const dd = (SSData.driverDespachos || []).find(x => x.despacho_id === docId);
  // Preferir el momento real registrado por el driver; si no, el entregado_en del doc (migrado Odoo).
  return dd?.entregado_en || (doc ? doc.entregado_en : null) || null;
}
function fmtFechaHora(ts) {
  if (!ts) return '';
  const f = fmtFechaDMY(ts), h = fmtHora(ts);
  return h ? `${f} · ${h}` : f;
}

// Fecha/hora estimada de entrega, editable inline. El almacenista la programa por despacho.
// Color por urgencia (vencida/hoy/próxima). timestamp naive local (Caracas).
function FechaEntregaCell({ doc, onSaved }) {
  const [val, setVal]       = React.useState((doc.fecha_entrega_estimada || '').slice(0, 16));
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { setVal((doc.fecha_entrega_estimada || '').slice(0, 16)); }, [doc.fecha_entrega_estimada]);

  async function guardar(v) {
    const nuevo = v || null;
    if (((doc.fecha_entrega_estimada || '').slice(0, 16)) === (nuevo ? nuevo.slice(0, 16) : '')) return;
    setSaving(true);
    await window.updateDocCampos?.(doc.id, { fecha_entrega_estimada: nuevo });
    doc.fecha_entrega_estimada = nuevo;
    setSaving(false);
    window.logActivity?.({ modulo:'documentos', accion:'editar', entidad_id:doc.id, entidad_label:doc.id, detalles:{ fecha_entrega_estimada: nuevo } });
    onSaved?.();
  }

  let color = 'var(--text-muted)';
  if (val) {
    const fechaDia = val.slice(0, 10), hoy = window.localDateStr();
    const entregado = getEstadoEnvio(doc) === 'entregado';
    color = entregado ? 'var(--text-muted)' : fechaDia < hoy ? 'var(--danger)' : fechaDia === hoy ? '#d97706' : 'var(--success)';
  }

  return (
    <input type="datetime-local" value={val} disabled={saving}
      onClick={e => e.stopPropagation()} onChange={e => setVal(e.target.value)} onBlur={e => guardar(e.target.value)}
      title="Fecha y hora estimada de entrega"
      style={{ fontSize: 11.5, padding: '3px 7px', borderRadius: 6, width: 168, cursor: 'pointer',
        border: `1px solid ${val ? color : 'var(--border)'}`, color: val ? color : 'var(--text-muted)', background: 'var(--bg-elev)' }}/>
  );
}

// Chip de envío. editable=true permite cambiarlo manualmente (uso típico: factura, ej. retiro en tienda).
function EnvioChipEditable({ doc, editable, onSaved }) {
  const [open, setOpen]     = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [dropPos, setDropPos] = React.useState({ top: 0, left: 0 });
  const btnRef = React.useRef(null);
  const k    = getEstadoEnvio(doc);
  const meta = ENVIO_META[k];

  function toggleOpen() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen(o => !o);
  }

  async function setEstado(newKey) {
    if (saving || newKey === k) { setOpen(false); return; }
    setSaving(true);
    const dbEstado  = ENVIO_UI_TO_DB[newKey];
    const empresaId = window.currentEmpresa || 'demo1';
    const existing  = (SSData.driverDespachos || []).find(x => x.despacho_id === doc.id);
    const entregadoEn = newKey === 'entregado' ? new Date().toISOString() : undefined;
    const payload   = existing
      ? { ...existing, estado: dbEstado, ...(entregadoEn ? { entregado_en: entregadoEn } : {}) }
      : { id: 'da-' + doc.id + '-' + Date.now(), empresa_id: empresaId, despacho_id: doc.id, driver_id: null, estado: dbEstado, fecha: window.localDateStr(), ...(entregadoEn ? { entregado_en: entregadoEn } : {}) };
    const { error } = await window.saveDriverDespacho(payload);
    if (error) { setSaving(false); alert('Error al cambiar estado de envío: ' + (error.message || JSON.stringify(error))); return; }
    if (existing) Object.assign(existing, payload);
    else (SSData.driverDespachos = SSData.driverDespachos || []).push(payload);
    // Sincronización: el estado del propio despacho (lo que clasifica el Kanban)
    // se persiste según el envío. 'entregado' → despachado; resto → por_despachar.
    if (doc.tipo === 'despacho') {
      const nuevoEstadoDoc = newKey === 'entregado' ? 'despachado' : 'por_despachar';
      if (doc.estado !== nuevoEstadoDoc) {
        await window.updateDocCampos?.(doc.id, { estado: nuevoEstadoDoc });
        doc.estado = nuevoEstadoDoc;
      }
      // El trigger en DB recalcula estado_despacho de la factura; avisamos a las vistas
      window.dispatchEvent(new CustomEvent('ss-doc-version-bump', { detail: { id: doc.documento_origen_id, despachoId: doc.id } }));
    }
    setSaving(false);
    window.logActivity?.({ modulo:'documentos', accion:'editar', entidad_id:doc.id, entidad_label:doc.id, detalles:{ envio_estado: dbEstado, manual: true } });
    window.ssActivityLog?.add(doc.id, 'editado', `Estado de envío → ${ENVIO_META[newKey]?.label || newKey}`);
    setOpen(false);
    onSaved?.();
  }

  if (!editable) {
    return (
      <span className="chip" style={{background: meta.color+'18', color: meta.color}}>
        <span className="chip-dot" style={{background: meta.color}}/>
        {meta.label}
      </span>
    );
  }

  return (
    <span style={{position:'relative', display:'inline-block'}} onClick={e => e.stopPropagation()}>
      <button ref={btnRef} onClick={toggleOpen} disabled={saving} className="chip"
        style={{background: meta.color+'18', color: meta.color, border:'none', cursor: saving?'wait':'pointer', display:'inline-flex', alignItems:'center', gap:5}}>
        <span className="chip-dot" style={{background: meta.color}}/>
        {meta.label}
        <Icon name="chevronD" size={11} style={{opacity:0.7}}/>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{position:'fixed', inset:0, zIndex:50}}/>
          <div style={{position:'fixed', top: dropPos.top, left: dropPos.left, background:'var(--bg-elev)', border:'1px solid var(--border)', borderRadius:8, boxShadow:'0 8px 24px rgba(0,0,0,0.18)', zIndex:51, minWidth:200, padding:4}}>
            {Object.entries(ENVIO_META).map(([key, m]) => (
              <button key={key} onClick={() => setEstado(key)} disabled={saving}
                style={{width:'100%', display:'flex', alignItems:'center', gap:8, padding:'7px 10px', border:'none', borderRadius:6, background: k===key ? 'var(--brand-soft)' : 'transparent', cursor:'pointer', fontSize:13, color:'var(--text)', textAlign:'left'}}>
                <span className="chip-dot" style={{background: m.color}}/>
                <span style={{flex:1}}>{m.label}</span>
                {k===key && <Icon name="check" size={12} style={{color: m.color}}/>}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

// Chip de estado de despacho de una FACTURA (agregado mantenido por trigger en DB)
const ESTADO_DESPACHO_META = {
  no_aplica:     { label: 'Sin despacho',  color: '#94a3b8' },
  por_despachar: { label: 'Por despachar', color: '#b45309' },
  parcial:       { label: 'Parcial',       color: '#2563eb' },
  despachada:    { label: 'Despachada',    color: '#16a34a' },
};
function EstadoDespachoChip({ estado, lines }) {
  // Fallback defensivo si estado_despacho llega vacío: derivar de las líneas
  let k = estado;
  if (!k || !ESTADO_DESPACHO_META[k]) {
    const fact = (lines || []).filter(l => l.sku && l.sku !== '__SECTION__');
    const totF = fact.reduce((s, l) => s + (Math.round(l.qty) || 0), 0);
    const totD = fact.reduce((s, l) => s + (l.cantidad_despachada || 0), 0);
    k = !fact.length ? 'no_aplica' : totD <= 0 ? 'por_despachar' : totD >= totF ? 'despachada' : 'parcial';
  }
  const m = ESTADO_DESPACHO_META[k] || ESTADO_DESPACHO_META.por_despachar;
  return (
    <span className="chip" style={{background: m.color+'18', color: m.color}}>
      <span className="chip-dot" style={{background: m.color}}/>{m.label}
    </span>
  );
}
window.EstadoDespachoChip = EstadoDespachoChip;

// ====================== Vista previa lateral del PDF ======================
// Panel acoplado a la derecha que renderiza el PDF del documento en un <iframe>, sin descargarlo:
// generateDocumentPDF devuelve una blob URL (opts.output:'bloburl') y el visor nativo del navegador
// se encarga de mostrarlo, con su propio zoom/paginado. Lo abren el ícono de cada fila de las
// listas y el botón del detalle.
// No lleva backdrop a propósito: la idea es ver el PDF SIN perder de vista la lista/el detalle que
// quedan a la izquierda (como la vista previa de Odoo), no un modal que tape todo.
function DocumentPreviewPanel({ doc, onClose }) {
  // Arranca en la modalidad con la que se emitió el documento (misma lógica que PdfModoModal):
  // la vista previa debe mostrar el documento como es, no como podría ser.
  // El despacho no lleva precios: elegir moneda no significa nada ahí (mismo criterio que el
  // botón PDF del detalle, que en despacho salta el selector y emite directo en 'original').
  const esDespacho = (doc.tipo || doc.estado) === 'despacho';
  // bcv_fijo (Nota BCV) es su propia modalidad: antes mapeaba a 'divisas' y la vista previa de
  // una Nota BCV mostraba dólares, no los bolívares con los que se emitió.
  const modalMap = { divisas:'divisas', bcv:'bcv', paralelo:'paralelo', bcv_fijo:'bcv_fijo' };
  const [modo, setModo] = useState(esDespacho ? 'original' : (modalMap[doc.modalidad_pago] || 'divisas'));
  const [url,  setUrl]  = useState('');
  const [err,  setErr]  = useState('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true, creada = '';
    setBusy(true); setErr(''); setUrl('');
    (async () => {
      try {
        // Las filas de la lista no traen los ítems (la carga es paginada y sin joins): si el
        // documento llega sin `lines`, se piden acá antes de generar.
        const ls = (doc.lines && doc.lines.length)
          ? doc.lines
          : (window.loadDocumentoItems ? await window.loadDocumentoItems(doc.id) : []);
        if (!alive) return;
        // `await`: la primera vez el generador puede tener que traer jsPDF (ya no viene en el
        // arranque). Con la librería cargada devuelve la URL directo y el await no cuesta nada.
        const u = await window.generateDocumentPDF?.(doc, ls || [], modo, null, { output: 'bloburl' });
        if (!alive) { if (u) URL.revokeObjectURL(u); return; }
        if (!u) { setErr('No se pudo generar el PDF de este documento.'); setBusy(false); return; }
        creada = u; setUrl(u); setBusy(false);
      } catch (e) {
        if (alive) { setErr(e?.message || 'Error generando el PDF.'); setBusy(false); }
      }
    })();
    // Revocar la blob URL al cambiar de modalidad/documento o al cerrar: sin esto cada
    // regeneración deja el PDF anterior retenido en memoria hasta recargar la página.
    return () => { alive = false; if (creada) URL.revokeObjectURL(creada); };
  }, [doc.id, modo]);

  const tipoLabel = ({ cotizacion:'Cotización', orden:'Orden', factura:'Factura', despacho:'Despacho' })[doc.tipo || doc.estado] || 'Documento';
  const MODOS = [
    { id:'divisas',  label:'USD' },
    { id:'bcv',      label:'BCV' },
    { id:'bcv_usd',  label:'BCV en USD' },
    { id:'bcv_fijo', label:'Nota BCV' },
    { id:'paralelo', label:'Paralelo' },
  ];

  return (
    <>
      {/* Backdrop: cierra al hacer clic afuera. Va tenue (no el .45 de los modales) para que la
          lista/el detalle de la izquierda sigan legibles mientras se mira el PDF. */}
      <div onClick={onClose}
        style={{ position:'fixed', inset:0, background:'rgba(20,20,15,.32)', zIndex:940 }}/>
      <div onClick={e => e.stopPropagation()} style={{
        position:'fixed', top:0, right:0, bottom:0, width:'min(760px, 94vw)', zIndex:941,
        background:'var(--bg-elev)', borderLeft:'1px solid var(--border)',
        boxShadow:'-10px 0 30px rgba(0,0,0,.20)', display:'flex', flexDirection:'column',
      }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
        <Icon name="eye" size={16}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:700, fontSize:13 }}>Vista previa</div>
          <div className="small muted" style={{ fontSize:11, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {tipoLabel} {doc.id}
          </div>
        </div>
        <div style={{ display:'flex', gap:2, background:'var(--bg-sunken)', padding:2, borderRadius:6 }} hidden={esDespacho}>
          {!esDespacho && MODOS.map(m => (
            <button key={m.id}
              className={'btn ' + (modo === m.id ? 'primary' : 'ghost')}
              style={{ padding:'3px 9px', fontSize:11, height:'auto' }}
              onClick={() => setModo(m.id)}>{m.label}</button>
          ))}
        </div>
        <button className="icon-btn" title="Descargar PDF"
          onClick={async () => {
            const ls = (doc.lines && doc.lines.length) ? doc.lines
              : (window.loadDocumentoItems ? await window.loadDocumentoItems(doc.id) : []);
            window.generateDocumentPDF?.(doc, ls || [], modo);
          }}>
          <Icon name="download" size={14}/>
        </button>
        <button className="icon-btn" title="Cerrar (Esc)" onClick={onClose}><Icon name="x" size={16}/></button>
      </div>

      <div style={{ flex:1, minHeight:0, background:'var(--bg-sunken)', position:'relative' }}>
        {busy && (
          <div style={{ position:'absolute', inset:0, display:'grid', placeItems:'center' }}>
            <div className="small muted">Generando la vista previa…</div>
          </div>
        )}
        {err && !busy && (
          <div style={{ position:'absolute', inset:0, display:'grid', placeItems:'center', padding:20, textAlign:'center' }}>
            <div className="small" style={{ color:'var(--danger)' }}>{err}</div>
          </div>
        )}
        {url && !busy && (
          <iframe src={url} title={'Vista previa ' + doc.id}
            style={{ width:'100%', height:'100%', border:0, display:'block' }}/>
        )}
        </div>
      </div>
    </>
  );
}
window.DocumentPreviewPanel = DocumentPreviewPanel;

// ====================== Exportar todo (los 4 módulos en un solo xlsx) ======================
// Vuelca cotizaciones + órdenes + facturas + despachos completos a un único archivo. NO usa los
// filtros de la lista (es un volcado del módulo entero); solo ofrece el rango de fechas activo
// como límite opcional, más "incluir canceladas".
const EXPORT_ALL_TIPOS = [
  { k: 'cotizacion', label: 'Cotizaciones', sheet: 'Cotizaciones', icon: 'doc',     color: '#64748b' },
  { k: 'orden',      label: 'Órdenes',      sheet: 'Ordenes',      icon: 'receipt', color: '#2563eb' },
  { k: 'factura',    label: 'Facturas',     sheet: 'Facturas',     icon: 'receipt', color: '#047857' },
  { k: 'despacho',   label: 'Despachos',    sheet: 'Despachos',    icon: 'truck',   color: '#b45309' },
];

// La hoja consolidada lleva "Tipo" adelante; las hojas por módulo usan el resto (el tipo es la hoja).
const EXPORT_ALL_COLS = [
  { key: 'tipo',         label: 'Tipo' },
  { key: 'id',           label: 'ID' },
  { key: 'fecha',        label: 'Fecha' },
  { key: 'cliente',      label: 'Cliente' },
  { key: 'rif',          label: 'RIF' },
  { key: 'vendedor',     label: 'Vendedor' },
  { key: 'creado_por',   label: 'Creado por' },
  { key: 'estado',       label: 'Estado' },
  { key: 'estado_cobro', label: 'Estado cobro' },
  { key: 'items',        label: 'Items' },
  { key: 'subtotal',     label: 'Subtotal USD' },
  { key: 'iva',          label: 'IVA USD' },
  { key: 'total_usd',    label: 'Total USD' },
  { key: 'tasa_bcv',     label: 'Tasa BCV' },
  { key: 'total_bs',     label: 'Total Bs' },
  { key: 'modalidad',    label: 'Modalidad pago' },
  { key: 'tipo_entrega', label: 'Tipo entrega' },
  { key: 'tipo_factura', label: 'Tipo factura' },
  { key: 'almacen',      label: 'Almacén' },
  { key: 'fuente',       label: 'Fuente' },
  { key: 'nro_despacho', label: 'Nro despacho' },
  { key: 'entregado_en', label: 'Entregado' },
  { key: 'vencimiento',  label: 'Vencimiento' },
  { key: 'raiz_id',      label: 'Raíz (linaje)' },
  { key: 'origen_id',    label: 'Documento origen' },
  { key: 'odoo_ref',     label: 'Ref. Odoo' },
];
const EXPORT_RESUMEN_COLS = [
  { key: 'modulo',     label: 'Módulo' },
  { key: 'documentos', label: 'Documentos' },
  { key: 'items',      label: 'Items' },
  { key: 'total_usd',  label: 'Total USD' },
];
const EXPORT_ESTADO_LABEL = {
  creada: 'Creada', convertida: 'Convertida', generada: 'Generada', facturada: 'Facturada',
  despachado: 'Despachado', cancelada: 'Cancelada', pagada: 'Pagada', por_cobrar: 'Por cobrar',
  parcial: 'Parcial',
};

function ExportAllDocsModal({ fechaDesde, fechaHasta, onClose }) {
  const hayRango = !!(fechaDesde || fechaHasta);
  const [sel, setSel]               = useState(() => new Set(EXPORT_ALL_TIPOS.map(t => t.k)));
  const [usarRango, setUsarRango]   = useState(hayRango);
  const [canceladas, setCanceladas] = useState(false);
  const [unaHoja, setUnaHoja]       = useState(false);
  const [counts, setCounts]         = useState(null);
  const [busy, setBusy]             = useState(false);
  const [prog, setProg]             = useState(null);   // { tipo, loaded, total }

  const filtros = useMemo(() => ({
    showCanceladas: canceladas,
    fechaDesde: usarRango ? fechaDesde : '',
    fechaHasta: usarRango ? fechaHasta : '',
  }), [canceladas, usarRango, fechaDesde, fechaHasta]);

  useEffect(() => {
    let alive = true;
    setCounts(null);
    window.countDocumentosExport(filtros).then(c => { if (alive) setCounts(c); });
    return () => { alive = false; };
  }, [filtros]);

  const tiposSel = EXPORT_ALL_TIPOS.filter(t => sel.has(t.k));
  const totalSel = counts ? tiposSel.reduce((s, t) => s + (counts[t.k] || 0), 0) : null;
  const nfmt = (n) => Number(n || 0).toLocaleString('es-VE');
  const r2   = (n) => Math.round((Number(n) || 0) * 100) / 100;

  function toggle(k) {
    setSel(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }

  async function run() {
    if (!tiposSel.length || busy) return;
    if (totalSel > 60000 && !confirm(
      `Vas a exportar ${nfmt(totalSel)} documentos a un solo archivo (unos 70 MB). Puede tardar ` +
      `hasta un minuto y consumir bastante memoria del navegador. ¿Continuar?`)) return;
    setBusy(true);
    setProg({ tipo: tiposSel[0].k, loaded: 0, total: totalSel || 0 });
    try {
      const { porTipo } = await window.loadDocumentosExport({
        ...filtros,
        tipos: tiposSel.map(t => t.k),
        counts,
        onProgress: p => setProg(p),
      });
      // El armado del xlsx es síncrono y bloquea el hilo varios segundos: se cede un frame para
      // que el navegador alcance a pintar "Generando el archivo…" antes de congelarse.
      setProg({ tipo: null, loaded: totalSel, total: totalSel });
      await new Promise(r => setTimeout(r, 60));

      const cliMap  = new Map((SSData.clientes  || []).map(c => [c.id, c]));
      const almMap  = new Map((SSData.almacenes || []).map(a => [a.id, a.nombre]));
      const tasaHoy = Number(SSData.tasa?.bcv) || 0;
      // Total en Bs con la tasa DEL documento (la del día en que se emitió); solo si el documento
      // no la trae se cae a la tasa vigente.
      const mapRow = (d, t) => {
        const cli   = cliMap.get(d.cliente_id);
        const tasa  = Number(d.tasa_bcv) || tasaHoy;
        const total = Number(d.total) || 0;
        return {
          tipo: t.label,
          id: d.id,
          fecha: (d.fecha || '').substring(0, 10),
          cliente: cli?.nombre || d.cliente_id || '',
          rif: cli?.rif || '',
          vendedor: d.vendedor || '',
          creado_por: d.creado_por || '',
          estado: EXPORT_ESTADO_LABEL[d.estado] || d.estado || '',
          estado_cobro: EXPORT_ESTADO_LABEL[d.estado_cobro] || d.estado_cobro || '',
          items: Number(d.items) || 0,
          subtotal: r2(d.subtotal),
          iva: r2(d.iva),
          total_usd: r2(total),
          tasa_bcv: tasa ? r2(tasa) : '',
          total_bs: r2(total * tasa),
          modalidad: d.modalidad_pago || '',
          tipo_entrega: d.tipo_entrega || '',
          tipo_factura: d.tipo_factura || '',
          almacen: almMap.get(d.almacen_id) || d.almacen_id || '',
          fuente: d.fuente || '',
          nro_despacho: d.nro_despacho || '',
          entregado_en: d.entregado_en ? String(d.entregado_en).substring(0, 10) : '',
          vencimiento: d.vencimiento || '',
          raiz_id: d.raiz_id || '',
          origen_id: d.documento_origen_id || '',
          odoo_ref: d.odoo_ref || '',
        };
      };

      const resumen = [];
      const hojas = [];
      const consolidado = [];
      for (const t of tiposSel) {
        const rows = (porTipo[t.k] || []).map(d => mapRow(d, t));
        resumen.push({
          modulo: t.label,
          documentos: rows.length,
          items: rows.reduce((s, r) => s + r.items, 0),
          total_usd: r2(rows.reduce((s, r) => s + r.total_usd, 0)),
        });
        // push en bucle, no spread: con 27k filas el spread revienta el límite de argumentos.
        if (unaHoja) for (const r of rows) consolidado.push(r);
        else hojas.push({ name: t.sheet, rows, columns: EXPORT_ALL_COLS.slice(1) });
      }
      // El TOTAL suma documentos e ítems, pero NO montos: la misma venta aparece como cotización,
      // orden y factura, así que sumar las cuatro etapas daría una cifra de ventas inflada.
      resumen.push({
        modulo: 'TOTAL',
        documentos: resumen.reduce((s, r) => s + r.documentos, 0),
        items: resumen.reduce((s, r) => s + r.items, 0),
        total_usd: '',
      });
      resumen.push({ modulo: '' });
      resumen.push({ modulo: 'Montos no sumables entre módulos: la misma venta se repite.' });
      resumen.push({ modulo: 'Los despachos no llevan monto propio (está en la factura).' });

      const sheets = [{ name: 'Resumen', rows: resumen, columns: EXPORT_RESUMEN_COLS }];
      if (unaHoja) sheets.push({ name: 'Documentos', rows: consolidado, columns: EXPORT_ALL_COLS });
      else sheets.push(...hojas);

      const ok = window.exportSheetsToXLSX(sheets, 'documentos_todos');
      if (ok) {
        window.logActivity?.({
          modulo: 'documentos', accion: 'exportar',
          entidad_label: `Exportar todo (${nfmt(totalSel)} documentos)`,
          detalles: {
            tipos: tiposSel.map(t => t.k), total: totalSel,
            hoja_unica: unaHoja, incluye_canceladas: canceladas,
            desde: filtros.fechaDesde || null, hasta: filtros.fechaHasta || null,
          },
        });
        onClose();
      }
    } catch (err) {
      console.error('[Exportar todo] Falló la exportación:', err);
      alert('No se pudo completar la exportación: ' + (err?.message || err));
    } finally {
      setBusy(false);
      setProg(null);
    }
  }

  const pct = prog && prog.total ? Math.min(100, Math.round(prog.loaded / prog.total * 100)) : 0;
  const progLabel = prog ? (EXPORT_ALL_TIPOS.find(t => t.k === prog.tipo)?.label || '') : '';

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" style={{maxWidth: 520}} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{display:'flex', alignItems:'center', gap:10}}>
            <div style={{width:34, height:34, borderRadius:10, background:'var(--brand-soft)', display:'grid', placeItems:'center'}}>
              <Icon name="download" size={16} style={{color:'var(--brand)'}}/>
            </div>
            <div>
              <div style={{fontWeight:700, fontSize:15}}>Exportar todo</div>
              <div className="small muted">Los 4 módulos del flujo en un solo archivo Excel</div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} disabled={busy}><Icon name="x" size={14}/></button>
        </div>

        <div className="modal-body" style={{padding:'16px 18px', display:'flex', flexDirection:'column', gap:14}}>
          <div style={{display:'flex', flexDirection:'column', gap:8}}>
            {EXPORT_ALL_TIPOS.map(t => {
              const n = counts?.[t.k];
              const on = sel.has(t.k);
              return (
                <label key={t.k} style={{
                  display:'flex', alignItems:'center', gap:10, padding:'9px 12px', borderRadius:8,
                  border:'1px solid ' + (on ? t.color + '55' : 'var(--border)'),
                  background: on ? t.color + '0d' : 'transparent',
                  cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
                }}>
                  <input type="checkbox" checked={on} disabled={busy} onChange={() => toggle(t.k)}/>
                  <Icon name={t.icon} size={15} style={{color: t.color, flexShrink:0}}/>
                  <span style={{fontSize:13, fontWeight:600, flex:1}}>{t.label}</span>
                  <span className="small muted">{counts ? `${nfmt(n)} docs` : '…'}</span>
                </label>
              );
            })}
          </div>

          <div style={{display:'flex', flexDirection:'column', gap:8, fontSize:13}}>
            {hayRango && (
              <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer'}}>
                <input type="checkbox" checked={usarRango} disabled={busy} onChange={e => setUsarRango(e.target.checked)}/>
                <span>Limitar al rango del filtro ({[fechaDesde && `desde ${fechaDesde}`, fechaHasta && `hasta ${fechaHasta}`].filter(Boolean).join(' ')})</span>
              </label>
            )}
            <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer'}}>
              <input type="checkbox" checked={canceladas} disabled={busy} onChange={e => setCanceladas(e.target.checked)}/>
              <span>Incluir documentos cancelados</span>
            </label>
            <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer'}}>
              <input type="checkbox" checked={unaHoja} disabled={busy} onChange={e => setUnaHoja(e.target.checked)}/>
              <span>Todo en una sola hoja <span className="muted">(en vez de una hoja por módulo)</span></span>
            </label>
          </div>

          {busy ? (
            <div style={{display:'flex', flexDirection:'column', gap:6}}>
              <div style={{display:'flex', justifyContent:'space-between', fontSize:12}}>
                <span>{prog && prog.loaded >= prog.total ? 'Generando el archivo…' : `Cargando ${progLabel}…`}</span>
                <span className="muted">{prog ? `${nfmt(prog.loaded)} / ${nfmt(prog.total)}` : ''}</span>
              </div>
              <div style={{height:6, borderRadius:99, background:'var(--bg-sunken)', overflow:'hidden'}}>
                <div style={{height:'100%', width: pct + '%', background:'var(--brand)', transition:'width .2s'}}/>
              </div>
            </div>
          ) : (
            <div style={{padding:'10px 12px', background:'var(--bg-sunken)', borderRadius:8, fontSize:12.5, lineHeight:1.5}}>
              {totalSel == null
                ? 'Contando documentos…'
                : <>Se exportarán <strong>{nfmt(totalSel)}</strong> documentos. Los filtros de la lista (vendedor, almacén, búsqueda…) no se aplican.</>}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn primary" onClick={run} disabled={busy || !tiposSel.length || !totalSel}>
            {busy ? <><Icon name="refresh" size={13}/>Exportando…</> : <><Icon name="download" size={13}/>Exportar Excel</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ====================== Vista LISTA por estado ======================
function DocumentList({ stage, onOpen, onBack, onSwitchStage, onEdit }) {
  // Breadcrumb "atrás" contextual
  const backInfo = useMemo(() => getContextualBack(), [stage]);
  // Para el selector de columnas (mostrar/ocultar y ancho). Ver `window.TablaColumnas`.
  const tablaListaRef = React.useRef(null);
  // Contenedor con el scroll horizontal — encabezado sticky (.doclist-scroll en theme.css) +
  // barra de scroll flotante para no tener que bajar hasta el pie de la tabla.
  const scrollWrapRef = React.useRef(null);

  const [copiedId, setCopiedId] = useState(null);
  function copyLink(e, d) {
    e.stopPropagation();
    const url = window.location.origin + '/public/' + d.slug;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(d.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }
  // LA BÚSQUEDA NO SE GUARDA — excepción deliberada al estándar #4 (los filtros sí se recuerdan).
  // Se guardaba con UNA clave compartida por las cuatro listas, a propósito, para que la búsqueda
  // global viajara con el usuario. En la práctica se lee al revés: reportado el 2026-08-11, "busco
  // 'flo' en cotización, me paso a órdenes y sigue eso mismo, debería reiniciarse". Llegar a un
  // módulo con la lista ya filtrada por algo que uno no acaba de escribir se entiende como "acá no
  // hay nada" — y en una lista paginada en el server ni siquiera se ve por qué.
  // Tampoco se arregla con una clave POR etapa: `usePersistedState` lee la clave UNA sola vez (en
  // el inicializador del estado) y este componente no se desmonta al cambiar de etapa, así que la
  // clave nueva se escribiría con el valor viejo — el mismo arrastre, con más piezas.
  // Y hay una razón de fondo: una búsqueda es un acto del momento ("¿dónde está Flores?"), no una
  // preferencia. Los filtros de la etapa (vendedor, fechas, modalidad) sí se siguen recordando.
  const [search, setSearch] = useState('');
  // Clave muerta del esquema anterior: si queda escrita, el navegador de quien ya la tenía arrastra
  // su última búsqueda para siempre (ya no hay nadie que la lea ni que la limpie).
  useEffect(() => { try { localStorage.removeItem('ss-pos-docs-f-search'); } catch {} }, []);
  // Los filtros se RECUERDAN por etapa: cambiar de módulo y volver ya no los borra.
  const fk = (n) => `ss-pos${stage ? '-' + stage : ''}-f-${n}`;
  const [vendedorF, setVendedorF] = window.usePersistedState(fk('vendedor'), '');
  const [creadoPorF, setCreadoPorF] = window.usePersistedState(fk('creado'), '');   // usuario que cargó el doc
  const [fechaDesde, setFechaDesde] = window.usePersistedState(fk('desde'), '');
  const [fechaHasta, setFechaHasta] = window.usePersistedState(fk('hasta'), '');
  const [actLogDoc, setActLogDoc] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);   // documento con la vista previa abierta a la derecha
  const [pagoTarget, setPagoTarget] = useState(null); // { doc, cxc }
  const [modalidadF, setModalidadF] = window.usePersistedState(fk('modalidad'), '');
  const [cobroF, setCobroF] = window.usePersistedState(fk('cobro'), '');
  const [almacenF, setAlmacenF] = window.usePersistedState(fk('almacen'), '');
  const [tipoEntregaF, setTipoEntregaF] = window.usePersistedState(fk('entrega'), '');
  const [tipoFacturaF, setTipoFacturaF] = window.usePersistedState(fk('tipofact'), '');
  const [envioF, setEnvioF] = window.usePersistedState(fk('envio'), '');
  const [despachoPanelF, setDespachoPanelF] = useState(''); // panel almacén: '' | preparar | entregar | entregado | vencido
  // El filtro de entrega se recuerda en localStorage y pudo quedar con el RÓTULO viejo
  // ('Delivery'). La migración 81 pasó los documentos al código, así que ese valor guardado ya
  // no filtra nada: la lista saldría vacía sin decir por qué. Se traduce una vez, al montar.
  useEffect(() => {
    if (!tipoEntregaF) return;
    const o = window.ssOpcionesEntrega().find(t =>
      window.ssSlugOpcion(t.nombre) === window.ssSlugOpcion(tipoEntregaF));
    if (o && o.valor !== tipoEntregaF) setTipoEntregaF(o.valor);
  }, []);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stageCounts, setStageCounts] = useState({});
  // Cuántos documentos matchea la búsqueda en CADA etapa (no solo la activa) — pedido: sin esto
  // el usuario ve la página de 50 de la etapa en la que está y no tiene forma de saber que hay
  // más en otra etapa (o más allá de esa página), y lo reporta como "no salen todas". Antes esto
  // leía `SSData.documentos` completo (ya no se carga) vía `allDocs`/`allDocsLoaded`, que quedaron
  // muertos —siempre `false`— desde que se sacó esa carga; ver `window.countDocumentosBusqueda`.
  const [searchCounts, setSearchCounts] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [showExportAll, setShowExportAll] = useState(false);   // "Exportar todo": los 4 módulos en un xlsx
  const [envioTick, setEnvioTick] = useState(0);
  // Re-render cuando otra vista crea/entrega/cancela un despacho (mutación optimista)
  const [docVersion, setDocVersion] = useState(0);

  // Paginación SERVER-SIDE: `total` = count real del universo (no de lo cargado). `docs` = la página.
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    const v = parseInt(localStorage.getItem('ss-docs-pagesize'));
    return [50,100,200].includes(v) ? v : 50;
  });
  useEffect(() => { localStorage.setItem('ss-docs-pagesize', String(pageSize)); }, [pageSize]);
  // Orden server-side (columnas reales). Persistido por stage.
  const [sortKey, setSortKey] = useState(() => { try { return localStorage.getItem(`ss-docs-sort-${stage}-k`) || 'fecha'; } catch { return 'fecha'; } });
  const [sortDir, setSortDir] = useState(() => { try { return localStorage.getItem(`ss-docs-sort-${stage}-d`) || 'desc'; } catch { return 'desc'; } });
  const requestSort = (key) => {
    setSortDir(prev => (sortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'desc'));
    setSortKey(key); setPage(1);
  };
  useEffect(() => { try { localStorage.setItem(`ss-docs-sort-${stage}-k`, sortKey); localStorage.setItem(`ss-docs-sort-${stage}-d`, sortDir); } catch {} }, [stage, sortKey, sortDir]);

  // Cambiar de etapa REINICIA la búsqueda. Hace falta aunque ya no se persista: POSPage reusa esta
  // misma instancia entre las cuatro listas (solo cambia `stage`), así que sin esto lo tecleado en
  // cotizaciones sigue aplicándose en órdenes dentro de la misma sesión. El ref distingue el cambio
  // real del primer montaje. `page` vuelve a 1: la página 7 de la lista filtrada no existe en la nueva.
  const stagePrevRef = React.useRef(stage);
  useEffect(() => {
    if (stagePrevRef.current === stage) return;
    stagePrevRef.current = stage;
    setSearch('');
    setPage(1);
  }, [stage]);

  // La búsqueda global (la lupa del header / Ctrl+K) puede mandar acá con el término ya puesto:
  // "Ver las 210 cotizaciones de THUNDERNET". Se pasa por `window.__ssDocListPreset` porque
  // `navigate` no lleva estado, y se CONSUME (se borra al leerlo): si quedara escrito, volver al
  // módulo por cualquier otro camino reaplicaría una búsqueda que nadie acaba de pedir — que es
  // exactamente el arrastre por el que la búsqueda dejó de persistirse (ver arriba).
  // Va DESPUÉS del efecto que resetea al cambiar de etapa, así el preset no se pisa a sí mismo.
  useEffect(() => {
    const p = window.__ssDocListPreset;
    if (!p || p.stage !== stage) return;
    window.__ssDocListPreset = null;
    setSearch(p.search || '');
    setPage(1);
  }, [stage]);

  // Sub-pestañas por etapa, derivadas del linaje (has_child) y sub-estados.
  const cobroEstado = React.useCallback((d) => {
    // CxC viva (pagos gestionados en la app) tiene prioridad; si no hay CxC, se usa el estado_cobro
    // del propio documento (backfill de Odoo: 26,625 facturas migradas están 'pagada', solo ~1,275
    // siguen por cobrar). Antes, sin CxC devolvía null → toda factura pagada salía en "Por cobrar".
    const cxc = (SSData.cuentasCobrar || []).find(c => c.factura === d.id);
    if (cxc) return cxc.estado || 'por_cobrar';
    return d.estado_cobro || null;
  }, []);
  // Cada etapa termina en una pestaña de "esto ya no sigue vivo" — reemplaza al checkbox global
  // "Mostrar canceladas" (retirado 2026-08-13): cotización/orden usan `estado='cancelada'`,
  // factura/despacho usan `estado='anulada'` (ver `window.anularDocumento`). Ninguna de las dos
  // borra la fila, así que esta pestaña es la única forma de verlas — y mantiene el correlativo
  // visible en vez del hueco invisible que dejaba el viejo "Eliminar".
  const SUBTABS = {
    cotizacion: [
      { k: 'creadas',     label: 'Creadas',     f: d => !d.has_child },
      { k: 'convertidas', label: 'Convertidas', f: d => d.has_child },
      { k: 'todas',       label: 'Todas',       f: () => true },
      { k: 'canceladas',  label: 'Canceladas',  f: d => d.estado === 'cancelada' },
    ],
    orden: [
      { k: 'generadas',  label: 'Generadas',  f: d => !d.has_child },
      { k: 'facturadas', label: 'Facturadas', f: d => d.has_child },
      { k: 'todas',      label: 'Todas',      f: () => true },
      { k: 'canceladas', label: 'Canceladas', f: d => d.estado === 'cancelada' },
    ],
    factura: [
      { k: 'por_cobrar', label: 'Por cobrar', f: d => cobroEstado(d) !== 'pagada' },
      { k: 'cobradas',   label: 'Cobradas',   f: d => cobroEstado(d) === 'pagada' },
      { k: 'todas',      label: 'Todas',      f: () => true },
      { k: 'anuladas',   label: 'Anuladas',   f: d => d.estado === 'anulada' },
    ],
    despacho: [
      { k: 'por_despachar', label: 'Por despachar', f: d => d.estado !== 'despachado' },
      { k: 'despachadas',   label: 'Despachadas',   f: d => d.estado === 'despachado' },
      { k: 'todas',         label: 'Todas',         f: () => true },
      { k: 'anuladas',      label: 'Anuladas',      f: d => d.estado === 'anulada' },
    ],
  };
  // El sub-tab por defecto de cada etapa: en despacho es "Todas" (es lo que mostraba antes de que
  // existieran las pestañas, así que abrir el módulo no cambia de comportamiento).
  const subTabDefault = (st) => (st === 'despacho' ? 'todas' : (SUBTABS[st]?.[0]?.k || null));
  const [subTab, setSubTab] = window.usePersistedState(`ss-pos-${stage}-f-subtab`, subTabDefault(stage));
  useEffect(() => {
    // Al cambiar de etapa se respeta lo recordado de ESA etapa; si no hay nada, su default.
    let guardado = null;
    try { guardado = JSON.parse(localStorage.getItem(`ss-pos-${stage}-f-subtab`)); } catch (e) {}
    const valido = (SUBTABS[stage] || []).some(t => t.k === guardado);
    setSubTab(valido ? guardado : subTabDefault(stage));
  }, [stage]);

  function toggleSelect(id, e) {
    e.stopPropagation();
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected(prev => prev.size === filtrados.length ? new Set() : new Set(filtrados.map(d => d.id)));
  }
  function clearSelection() { setSelected(new Set()); }

  async function handleExportCSV() {
    let selDocs;
    if (selected.size > 0) {
      selDocs = filtrados.filter(d => selected.has(d.id));
    } else {
      // Sin selección → exportar TODO el universo filtrado (no solo la página) trayendo páginas de 1000.
      if (total > 5000 && !confirm(`Vas a exportar ${total.toLocaleString('es-VE')} documentos. Puede tardar unos segundos. ¿Continuar?`)) return;
      // subTab se null-ea para despacho (el panel de almacén filtra distinto) EXCEPTO en "Anuladas":
      // esa sí tiene que llegar, o exportar desde esa pestaña traería despachos vivos en vez de los
      // anulados que se estaban mirando.
      const baseOpts = { sortCol: sortKey, sortDir, subTab: (stage !== 'despacho' || subTab === 'anuladas' || subTab === 'todas') ? subTab : null, vendedor: vendedorF || null, creadoPor: creadoPorF || null };
      if (fechaDesde) baseOpts.fechaDesde = fechaDesde;
      if (fechaHasta) baseOpts.fechaHasta = fechaHasta;
      if (modalidadF) baseOpts.modalidad = modalidadF;
      if (almacenF)      baseOpts.almacen = almacenF;
      if (tipoEntregaF)  baseOpts.tipoEntrega = tipoEntregaF;
      if (stage === 'factura') {
        if (cobroF)       baseOpts.cobro = cobroF;
        if (tipoFacturaF) baseOpts.tipoFactura = tipoFacturaF;
      }
      if (stage === 'despacho' && despachoPanelF) baseOpts.envioEntregado = (despachoPanelF === 'entregado');
      else if (stage === 'despacho' && envioF)    baseOpts.envioEntregado = (envioF === 'entregado');
      const term = (search || '').trim();
      if (term) {
        const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const nq = norm(term);
        baseOpts.search = term;
        baseOpts.clienteIds = (SSData.clientes || []).filter(c => norm(c.nombre).includes(nq) || norm(c.rif).includes(nq)).map(c => c.id);
      }
      selDocs = [];
      const PS = 1000;
      for (let p = 0; p < 200; p++) {
        const { rows } = await window.loadDocumentos(stage, { ...baseOpts, page: p, pageSize: PS });
        selDocs.push(...rows);
        if (rows.length < PS) break;
      }
    }
    if (selDocs.length === 0) { alert('No hay documentos para exportar.'); return; }
    const rows = selDocs.map(d => {
      const cli = clienteMap.get(d.cliente || d.cliente_id);
      const cxc = stage === 'factura' ? (SSData.cuentasCobrar||[]).find(c => c.factura === d.id) : null;
      return {
        id: d.id,
        cliente: cli?.nombre || '',
        rif: cli?.rif || '',
        vendedor: d.vendedor || '',
        fuente: d.fuente || '',
        fecha: d.fecha || '',
        items: d.items,
        total_usd: parseFloat(Number(d.total).toFixed(2)),
        total_bs: parseFloat((d.total * (SSData.tasa?.bcv || 0)).toFixed(2)),
        modalidad: d.modalidad_pago || '',
        tipo_entrega: d.tipo_entrega || '',
        estado_cobro: cxc?.estado || d.estado_cobro || '',
      };
    });
    const cols = [
      { key:'id',           label:'ID' },
      { key:'cliente',      label:'Cliente' },
      { key:'rif',          label:'RIF' },
      { key:'vendedor',     label:'Vendedor' },
      { key:'fuente',       label:'Fuente' },
      { key:'fecha',        label:'Fecha' },
      { key:'items',        label:'Items' },
      { key:'total_usd',    label:'Total USD' },
      { key:'total_bs',     label:'Total Bs' },
      { key:'modalidad',    label:'Modalidad pago' },
      { key:'tipo_entrega', label:'Tipo entrega' },
    ];
    if (stage === 'factura') cols.push({ key:'estado_cobro', label:'Estado cobro' });
    const label = { cotizacion:'cotizaciones', orden:'ordenes', despacho:'despachos', factura:'facturas' }[stage] || stage;
    window.exportToXLSX(rows, cols, label, label.charAt(0).toUpperCase()+label.slice(1));
  }

  // El "Eliminar" masivo (hard-delete + papelera) se retiró el 2026-08-13: anular/cancelar piden
  // motivo y quedan trazables, así que se hacen documento por documento desde el detalle (arriba,
  // `handleConfirmCancel`/`handleConfirmAnular`) — una acción masiva sin motivo individual por
  // documento no tendría dónde guardar el porqué de cada anulación.

  // Mapa cliente_id → cliente (O(1)). Reemplaza los SSData.clientes.find por-fila que con
  // 13k clientes × 1000 docs congelaban el render al ordenar/buscar.
  const clienteMap = React.useMemo(() => {
    const m = new Map();
    (SSData.clientes || []).forEach(c => m.set(c.id, c));
    return m;
  }, [SSData.clientes, SSData.clientes?.length]);

  // Selección y conteos del pipeline se resetean al cambiar de etapa.
  useEffect(() => {
    setSelected(new Set());
    window.countDocumentos().then(counts => setStageCounts(counts));
  }, [stage]);

  // Carga SERVER-DRIVEN: la página, el orden, los sub-tabs y todos los filtros se resuelven en
  // Supabase (.range + count exact). `docs` = la página actual; `total` = el count real del universo.
  // Cualquier cambio de filtro/orden/página vuelve a pedir a Supabase (con debounce si hay búsqueda).
  useEffect(() => {
    let alive = true;
    // OJO: `setLoading(true)` NO va acá. Se decide dentro de `run`, después de mirar el
    // caché: si hay una respuesta guardada para esta misma consulta se pinta al instante y
    // el refresco va por detrás, sin dejar la tabla en "Cargando…" al volver al módulo.
    const run = (extra) => {
      const opts = {
        page: Math.max(0, page - 1), pageSize,
        sortCol: sortKey, sortDir,
        // Despacho resuelve por_despachar/despachadas con `envioEntregado` más abajo (evita
        // filtrar dos veces por lo mismo) — pero "Anuladas" y "Todas" no tienen otro camino para
        // decidir si incluyen los anulados, así que esas dos sí pasan el subTab tal cual.
        subTab: (stage !== 'despacho' || subTab === 'anuladas' || subTab === 'todas') ? subTab : null,
        vendedor: vendedorF || null,
        creadoPor: creadoPorF || null,
        // Permiso `documentos_ver_todos`: sin él, esta lista solo muestra los documentos donde el
        // usuario logueado es el vendedor o quien lo cargó — no toda la empresa.
        soloMios: window.canUser ? !window.canUser('ver', 'documentos_ver_todos') : false,
        miNombre: window.__ssCurrentUser?.nombre || null,
        ...extra,
      };
      // Fecha, modalidad, almacén y tipo de entrega aplican a las 4 etapas (todas comparten estos
      // campos en `documentos`, aunque solo algunas los muestren como columna propia).
      if (fechaDesde) opts.fechaDesde = fechaDesde;
      if (fechaHasta) opts.fechaHasta = fechaHasta;
      if (modalidadF) opts.modalidad = modalidadF;
      if (almacenF)      opts.almacen = almacenF;
      if (tipoEntregaF)  opts.tipoEntrega = tipoEntregaF;
      if (stage === 'factura') {
        if (cobroF)       opts.cobro = cobroF;
        if (tipoFacturaF) opts.tipoFactura = tipoFacturaF;
      }
      // Envío del despacho: panel y select comparten la columna entregado_en (entregado vs pendiente).
      // 'entregado' → entregado_en not null; cualquier otro estado pendiente → entregado_en null.
      if (stage === 'despacho' && despachoPanelF) opts.envioEntregado = (despachoPanelF === 'entregado');
      else if (stage === 'despacho' && envioF)    opts.envioEntregado = (envioF === 'entregado');
      // 1) Lo que ya se vio de esta misma consulta, de una vez (localStorage).
      const ck = window.ssDocsCache?.key(stage, opts);
      const hit = ck ? window.ssDocsCache.get(ck) : null;
      if (hit) { setDocs(hit.rows); setTotal(hit.total); setLoading(false); }
      else setLoading(true);
      // 2) Y siempre se revalida contra el server: el caché evita la pantalla en blanco,
      //    no reemplaza los datos frescos (alguien pudo facturar hace un minuto).
      window.loadDocumentos(stage, opts).then(res => {
        if (!alive) return;
        setDocs(res.rows || []); setTotal(res.total || 0); setLoading(false);
        if (ck) window.ssDocsCache.set(ck, res);
      });
    };
    const term = (search || '').trim();
    if (!term) { setSearchCounts(null); run({}); return () => { alive = false; }; }
    const t = setTimeout(async () => {
      // Los ids de cliente se resuelven EN EL SERVER. Antes se filtraba `SSData.clientes` en
      // memoria, así que buscar un documento por nombre de cliente exigía tener los 13.096
      // clientes cargados — y si no estaban, la búsqueda no encontraba nada en silencio.
      const clienteIds = await (window.buscarClienteIds?.(term) || Promise.resolve([]));
      if (!alive) return;
      run({ search: term, clienteIds });
      const soloMios = window.canUser ? !window.canUser('ver', 'documentos_ver_todos') : false;
      window.countDocumentosBusqueda?.({ search: term, clienteIds, soloMios, miNombre: window.__ssCurrentUser?.nombre || null })
        .then(c => { if (alive) setSearchCounts(c); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [stage, subTab, page, pageSize, sortKey, sortDir, search, vendedorF, creadoPorF, fechaDesde, fechaHasta, modalidadF, almacenF, tipoEntregaF, tipoFacturaF, envioF, cobroF, despachoPanelF, docVersion]);

  // Reaccionar a cambios de despacho disparados por otras vistas (detalle, chip de envío):
  // bumpea docVersion (que está en las deps del effect de carga) para re-pedir la página actual.
  useEffect(() => {
    const handler = () => {
      window.countDocumentos().then(counts => setStageCounts(counts));
      setDocVersion(v => v + 1);
    };
    window.addEventListener('ss-doc-version-bump', handler);
    return () => window.removeEventListener('ss-doc-version-bump', handler);
  }, [stage]);

  // NOTA: la búsqueda ahora es server-side dentro de loadDocumentos (opts.search) sobre TODO el
  // universo del tipo activo. Se eliminó la carga de loadDocumentosAll (capada a 1000 → contaba
  // mal): los conteos del pipeline usan los totales exactos de countDocumentos (RPC), no la muestra.

  // Conteos por stage filtrados por búsqueda — se muestran en el pipeline visual cuando hay query.
  // Vienen del server (`window.countDocumentosBusqueda`, pedido en el efecto de arriba), no de un
  // escaneo en memoria: `SSData.documentos` no se carga completo.
  const searchStageCounts = search.trim() ? searchCounts : null;


  function formatWaPhone(tel) {
    if (!tel) return null;
    let d = String(tel).replace(/\D/g, '');
    if (d.startsWith('58')) return d;
    if (d.startsWith('0')) d = d.slice(1);
    return '58' + d;
  }
  function buildWaUrl(d, cli) {
    const phone = formatWaPhone(cli?.telefono);
    if (!phone || !d.slug) return null;
    const cfg = window.getEmpresaConfig?.() || {};
    const docUrl = window.location.origin + '/public/' + d.slug;
    const tipoLabel = d.tipo === 'cotizacion' ? 'cotización' : 'orden de venta';
    const tpl = cfg.whatsapp_cotizacion_template || 'Hola {nombre}, le comparto el enlace de su {tipo}:\n{url}';
    const text = tpl
      .replace(/\{nombre\}/g, cli?.nombre || '')
      .replace(/\{tipo\}/g,   tipoLabel)
      .replace(/\{id\}/g,     d.id || '')
      .replace(/\{url\}/g,    docUrl)
      .replace(/\{total\}/g,  d.total ? '$' + Number(d.total).toFixed(2) : '');
    return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text);
  }

  const stageLabel = { cotizacion: 'Cotizaciones', orden: 'Órdenes', despacho: 'Despachos', factura: 'Facturas' };
  const stageTitle = { cotizacion: 'Cotización', orden: 'Orden de Venta', despacho: 'Despacho', factura: 'Factura Fiscal' };
  const stageIcon  = { cotizacion: 'doc', orden: 'receipt', despacho: 'truck', factura: 'receipt' };
  const stageColor = { cotizacion: '#64748b', orden: '#2563eb', despacho: '#b45309', factura: '#047857' };
  const modalidadLabel = { divisas: 'Divisas USD', bcv: 'Tasa BCV', bcv_fijo: 'Nota BCV', paralelo: 'Tasa Paralelo' };
  const modalidadColor = { divisas: 'var(--brand)', bcv: '#92400e', bcv_fijo: '#15803d', paralelo: 'var(--accent)' };

  const vendedores = [...new Set(docs.map(d => d.vendedor).filter(Boolean))];
  const creadores  = [...new Set(docs.map(d => d.creado_por).filter(Boolean))];

  // ── Panel de control de despachos (almacén) ──────────────────────────────
  // Días desde la fecha del despacho (0 si ya entregado o sin fecha) — mismo cálculo
  // que la columna "Días" y el ordenamiento. Plazo de entrega: 3 días.
  const PLAZO_ENTREGA_DIAS = 3;
  const diasDespacho = (d) => {
    if (getEstadoEnvio(d) === 'entregado' || !d.fecha) return 0;
    const f = new Date(d.fecha.substring(0, 10) + 'T12:00:00');  // mediodía: evita off-by-one por UTC
    const fLocal = new Date(f.getFullYear(), f.getMonth(), f.getDate());
    const hoy = new Date(window.localDateStr() + 'T12:00:00');
    const hoyLocal = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    return Math.max(0, Math.floor((hoyLocal - fLocal) / 86400000));
  };
  const despachoPanelPred = {
    preparar:     d => getEstadoEnvio(d) === 'pendiente_por_enviar',
    entregar:     d => getEstadoEnvio(d) === 'en_ruta',
    entregado:    d => getEstadoEnvio(d) === 'entregado',
    vencido:      d => getEstadoEnvio(d) !== 'entregado' && diasDespacho(d) > PLAZO_ENTREGA_DIAS,
    no_entregado: d => getEstadoEnvio(d) === 'no_entregado',
  };

  // SERVER-DRIVEN: `docs` YA viene filtrado, ordenado y paginado por Supabase. Passthrough.
  const filtrados = docs;
  const sortedDocs = docs;
  const sortState = { key: sortKey, dir: sortDir };

  // Conteos del panel de despacho sobre el UNIVERSO (no la página). El estado de envío fino
  // (preparar/en_ruta/no_entregado) vive en driver_despachos (tabla local), no en una columna;
  // los ENTREGADOS son la mayoría (migrados Odoo con entregado_en) → count server-side directo.
  // Los PENDIENTES son un set chico → se cargan y clasifican client-side con getEstadoEnvio.
  const [despachoCounts, setDespachoCounts] = useState({ preparar:0, entregar:0, entregado:0, vencido:0, no_entregado:0 });
  useEffect(() => {
    if (stage !== 'despacho') return;
    let alive = true;
    (async () => {
      // Los cinco números vienen del server en un viaje (migracion-odoo/29). Antes eran dos
      // consultas, y una bajaba hasta 5.000 despachos pendientes para clasificarlos acá.
      const r = await window.getDespachoPanelCounts?.(PLAZO_ENTREGA_DIAS);
      if (!alive) return;
      if (r) { setDespachoCounts(r); return; }
      // Respaldo: el camino de siempre si la RPC no responde.
      const e = window.currentEmpresa || 'demo1';
      const [entRes, pendRes] = await Promise.all([
        window.sb.from('documentos').select('id', { count:'exact', head:true }).eq('empresa_id', e).eq('tipo','despacho').neq('estado','cancelada').not('entregado_en','is', null),
        window.sb.from('documentos').select('id,fecha,entregado_en,estado').eq('empresa_id', e).eq('tipo','despacho').neq('estado','cancelada').is('entregado_en', null).limit(5000),
      ]);
      if (!alive) return;
      const pend = pendRes.data || [];
      const c = { preparar:0, entregar:0, entregado: entRes.count || 0, vencido:0, no_entregado:0 };
      for (const d of pend) {
        const est = getEstadoEnvio(d);
        if (est === 'entregado') { c.entregado++; continue; }
        if (est === 'en_ruta') c.entregar++;
        else if (est !== 'no_entregado') c.preparar++;
        if (diasDespacho(d) > PLAZO_ENTREGA_DIAS) c.vencido++;
      }
      const idsInc = new Set(pend.filter(d => getEstadoEnvio(d) === 'no_entregado').map(d => d.id));
      c.no_entregado = (SSData.incidencias || []).filter(i => i.estado !== 'resuelto' && idsInc.has(i.despacho_id)).reduce((s2,i) => s2 + (i.items_faltantes || []).length, 0);
      setDespachoCounts(c);
    })().catch(() => {});
    return () => { alive = false; };
  }, [stage, docVersion, envioTick]);

  // Conteos de los sub-tabs (Creadas/Convertidas, Por cobrar/Cobradas, …) sobre el UNIVERSO,
  // respetando los filtros activos (vendedor/fecha/modalidad/cobro/búsqueda) pero SIN el propio
  // subtab. Antes se contaba sobre la página cargada → cifras cortadas a ≤1000. Ahora count exact.
  const [subTabCounts, setSubTabCounts] = useState({});
  useEffect(() => {
    const subs = SUBTABS[stage] || [];
    if (!subs.length) { setSubTabCounts({}); return; }
    let alive = true;
    const t = setTimeout(async () => {
      // UN viaje para los tres contadores. Antes era un HEAD count POR pestaña, y los tres se
      // repetían con cada cambio de filtro. Los filtros van tal cual los aplica la lista: si acá
      // se agrega uno, hay que agregarlo también en la RPC (migracion-odoo/28).
      const term = (search || '').trim().replace(/[(),]/g, ' ').trim();
      const filtros = {
        vendedor: vendedorF || null,
        creadoPor: creadoPorF || null,
        search: term || null,
      };
      // Fecha, modalidad y cobro solo aplican en facturas, igual que antes.
      if (stage === 'factura') {
        filtros.fechaDesde = fechaDesde || null;
        filtros.fechaHasta = fechaHasta || null;
        filtros.modalidad  = modalidadF || null;
        filtros.cobro      = cobroF || null;
      }
      // Los ids de cliente de la búsqueda se resuelven en el server, mismo criterio que la lista
      // (antes se filtraba SSData.clientes en memoria: sin catálogo cargado no encontraba nada).
      const cids = term ? await (window.buscarClienteIds?.(term) || Promise.resolve([])) : null;
      if (!alive) return;
      const r = await window.getSubtabCounts?.(stage, filtros, cids);
      if (!alive) return;
      // Si la RPC falla, los contadores quedan en '…' en vez de mostrar ceros, que serían mentira.
      setSubTabCounts(r || Object.fromEntries(subs.map(x => [x.k, null])));
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [stage, search, vendedorF, creadoPorF, fechaDesde, fechaHasta, modalidadF, cobroF, docVersion]);

  // Paginación SERVER-SIDE: totalPages sobre el count real del universo.
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage   = Math.min(page, totalPages);
  const startIdx   = (safePage - 1) * pageSize;
  const pageDocs   = docs;
  const pageBtns   = (() => {
    const max = 5; let to = Math.min(totalPages, Math.max(1, safePage - 2) + max - 1);
    let from = Math.max(1, to - max + 1); const arr = []; for (let i = from; i <= to; i++) arr.push(i); return arr;
  })();
  // Volver a la página 1 cuando cambian etapa, sub-pestaña, búsqueda o filtros.
  useEffect(() => { setPage(1); }, [stage, subTab, search, vendedorF, fechaDesde, fechaHasta, modalidadF, cobroF, almacenF, tipoEntregaF, envioF, despachoPanelF, sortKey, sortDir, pageSize]);

  return (
    <div className="page">
      <div className="flex items-center gap-2" style={{marginBottom: 12, fontSize: 13}}>
        <button className="btn ghost sm" onClick={() => window.__ssNavigate?.(backInfo.path)} title={`Volver a ${backInfo.label}`}>
          <Icon name="chevronL" size={14}/>{backInfo.label}
        </button>
        <span className="muted">/</span>
        <strong>{stageLabel[stage]}</strong>
      </div>

      <div className="page-header doclist-header doclist-header-actions-only">
        <div className="page-actions">
          <button className="btn secondary sm" onClick={handleExportCSV} title={`Exportar ${stageLabel[stage].toLowerCase()} (con los filtros actuales)`}>
            <Icon name="download" size={13}/>Exportar
          </button>
          <button className="btn secondary sm" onClick={() => setShowExportAll(true)} title="Exportar cotizaciones, órdenes, facturas y despachos en un solo Excel">
            <Icon name="grid" size={13}/>Exportar todo
          </button>
          {window.canUser?.('crear', stage) !== false && (
            <button className="btn primary sm" onClick={onBack}><Icon name="plus" size={13}/>Nuevo {stageTitle[stage]}</button>
          )}
        </div>
      </div>

      {stage === 'despacho' ? (
        // Panel de control del almacén: tarjetas-filtro por estado del despacho
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))', gap:6, marginTop:4}}>
          {[
            { k:'preparar',  label:'Por preparar',          sub:'Esperando preparación', color:'#b45309', bg:'#fffbeb', icon:'box',   n:despachoCounts.preparar },
            { k:'entregar',  label:'Por entregar',                     sub:'En ruta hacia el cliente',         color:'#2563eb', bg:'#eff6ff', icon:'truck', n:despachoCounts.entregar },
            { k:'entregado', label:'Entregados',                       sub:'Entrega confirmada',               color:'#16a34a', bg:'#f0fdf4', icon:'check', n:despachoCounts.entregado },
            { k:'vencido',   label:`Vencidos (+${PLAZO_ENTREGA_DIAS}d)`, sub:'Fuera de plazo',  color:'#dc2626', bg:'#fef2f2', icon:'clock', n:despachoCounts.vencido },
            { k:'no_entregado', label:'No entregados', sub:'Con incidencia', color:'#9333ea', bg:'#faf5ff', icon:'alert', n:despachoCounts.no_entregado },
          ].map(c => {
            const active = despachoPanelF === c.k;
            return (
              <button key={c.k} type="button"
                onClick={() => { setDespachoPanelF(active ? '' : c.k); setEnvioF(''); }}
                title={active ? 'Quitar filtro' : `Filtrar: ${c.label}`}
                style={{
                  textAlign:'left', cursor:'pointer', padding:'5px 8px', borderRadius:8,
                  border: active ? `2px solid ${c.color}` : '1px solid var(--border)',
                  background: active ? c.bg : 'var(--bg-elev)',
                  boxShadow: active ? `0 0 0 3px ${c.color}22` : 'none',
                  display:'flex', alignItems:'center', gap:8,
                  transition:'border-color .15s, box-shadow .15s, background .15s',
                }}>
                <span style={{width:24, height:24, borderRadius:7, background:c.bg, color:c.color, display:'grid', placeItems:'center', flexShrink:0}}>
                  <Icon name={c.icon} size={13}/>
                </span>
                <div style={{minWidth:0, flex:1}}>
                  <div style={{fontSize:11, fontWeight:600, color:'var(--text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{c.label}</div>
                  <div style={{fontSize:9.5, color:'var(--text-muted)'}}>{c.sub}</div>
                </div>
                <span style={{fontSize:18, fontWeight:800, lineHeight:1, color: c.n>0 ? c.color : 'var(--text-subtle)', flexShrink:0}}>{c.n}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {(SUBTABS[stage] || []).length > 0 && (
        <div className="doc-subtabs" style={{display:'flex', gap:4, marginTop:4}}>
          {(SUBTABS[stage] || []).map(t => {
            const n = subTabCounts[t.k];   // count server-side del universo (no la página)
            const active = subTab === t.k;
            return (
              <button key={t.k} onClick={() => setSubTab(t.k)}
                className="doc-subtab-pill"
                style={{
                  padding:'6px 14px', cursor:'pointer', borderRadius:8, whiteSpace:'nowrap',
                  border: active ? `1px solid ${stageColor[stage]}` : '1px solid transparent',
                  background: active ? stageColor[stage]+'14' : 'transparent',
                  color: active ? stageColor[stage] : 'var(--text-muted)',
                  fontWeight: active ? 700 : 500, fontSize:13,
                }}>
                {t.label}
                <span className="chip" style={{marginLeft:6, fontSize:10.5, padding:'0 6px', background: active ? stageColor[stage]+'22' : 'var(--bg)', color: active ? stageColor[stage] : 'var(--text-muted)'}}>{n == null ? '…' : n.toLocaleString('es-VE')}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="tbl-wrap mt-2">
        <div className="doclist-filtros">
          <div className="filtro-mini" style={{position:'relative', width: 190}}>
            <div className="filtro-mini-label">Buscar</div>
            <input
              className="input search"
              placeholder="Buscar cliente, RIF, ID..."
              value={search}
              onChange={e=>setSearch(e.target.value)}
              style={{width:'100%', paddingRight: search ? 24 : 10}}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                title="Limpiar búsqueda"
                style={{position:'absolute', right:4, bottom:3, background:'transparent', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:13, padding:'2px 5px', borderRadius:4}}
              >✕</button>
            )}
          </div>
          <div className="filtro-mini">
            <div className="filtro-mini-label">Vendedor</div>
            <select className="select" value={vendedorF} onChange={e=>setVendedorF(e.target.value)}>
              <option value="">Todos</option>
              {vendedores.map(v => <option key={v}>{v}</option>)}
            </select>
          </div>
          <div className="filtro-mini">
            <div className="filtro-mini-label">Creado por</div>
            <select className="select" value={creadoPorF} onChange={e=>setCreadoPorF(e.target.value)}>
              <option value="">Todos</option>
              {creadores.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="filtro-mini">
            <div className="filtro-mini-label">Fecha</div>
            <DateRangeFilter desde={fechaDesde} hasta={fechaHasta} onChange={(d,h) => { setFechaDesde(d); setFechaHasta(h); }}/>
          </div>
          <div className="filtro-mini">
            <div className="filtro-mini-label">Modalidad</div>
            <select className="select" value={modalidadF} onChange={e=>setModalidadF(e.target.value)}>
              <option value="">Todas</option>
              <option value="divisas">Divisas USD</option>
              <option value="bcv">Tasa BCV</option>
              <option value="bcv_fijo">Nota BCV</option>
              <option value="paralelo">Tasa Paralelo</option>
            </select>
          </div>
          <div className="filtro-mini">
            <div className="filtro-mini-label">Almacén</div>
            <select className="select" value={almacenF} onChange={e=>setAlmacenF(e.target.value)}>
              <option value="">Todos</option>
              {(SSData.almacenes||[]).map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </div>
          <div className="filtro-mini">
            <div className="filtro-mini-label">Entrega</div>
            <select className="select" value={tipoEntregaF} onChange={e=>setTipoEntregaF(e.target.value)}>
              <option value="">Todos</option>
              {/* Por CÓDIGO, no por rótulo: mezclar los dos daba dos entradas para la misma
                  entrega ("Delivery" y "delivery"), y cada una filtraba una parte. */}
              {[...new Set([
                ...window.ssOpcionesEntrega().map(t => t.valor),
                ...((docs||[]).map(d => d.tipo_entrega).filter(Boolean)),
              ])].map(t => <option key={t} value={t}>{window.ssLabelEntrega(t)}</option>)}
            </select>
          </div>
          {stage === 'factura' && (
            <>
              <div className="filtro-mini">
                <div className="filtro-mini-label">Cobro</div>
                <select className="select" value={cobroF} onChange={e=>setCobroF(e.target.value)}>
                  <option value="">Todos</option>
                  <option value="pendiente">Pendiente</option>
                  <option value="parcial">Parcial</option>
                  <option value="pagada">Cobrada</option>
                  <option value="vencida">Vencida</option>
                  <option value="__sincxc__">Sin CxC</option>
                </select>
              </div>
              <div className="filtro-mini">
                <div className="filtro-mini-label">Tipo factura</div>
                <select className="select" value={tipoFacturaF} onChange={e=>setTipoFacturaF(e.target.value)}>
                  <option value="">Todas</option>
                  <option value="nota">Nota de Factura</option>
                  <option value="fiscal">Factura Fiscal</option>
                </select>
              </div>
            </>
          )}
          {stage === 'despacho' && (
            <div className="filtro-mini">
              <div className="filtro-mini-label">Envío</div>
              <select className="select" value={envioF} onChange={e=>{setEnvioF(e.target.value); setDespachoPanelF('');}}>
                <option value="">Todos</option>
                {Object.entries(ENVIO_META).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          )}
          {(modalidadF || almacenF || tipoEntregaF || cobroF || tipoFacturaF || envioF) && (
            <button className="btn ghost sm" title="Limpiar filtros de esta fila"
              onClick={() => { setModalidadF(''); setAlmacenF(''); setTipoEntregaF(''); setCobroF(''); setTipoFacturaF(''); setEnvioF(''); }}
              style={{fontSize:11, padding:'3px 7px', color:'var(--danger)', alignSelf:'flex-end'}}>✕ filtros</button>
          )}
          <div className="ml-auto" style={{display:'flex', alignItems:'center', gap:10}}>
            {searchStageCounts && (
              <span className="small" style={{padding:'4px 10px', background:'var(--brand-soft)', color:'var(--brand)', borderRadius:6, fontWeight:600, whiteSpace:'nowrap'}}>
                Total global: {Object.values(searchStageCounts).reduce((a,b)=>a+b,0)} docs
              </span>
            )}
            <span className="small muted" style={{whiteSpace:'nowrap'}}>Pág. {safePage}/{totalPages} · {total.toLocaleString('es-VE')}</span>
            <window.TablaColumnas moduloId={`doclist-${stage}`} tablaRef={tablaListaRef}/>
          </div>
        </div>
        {stage === 'despacho' && despachoPanelF === 'no_entregado' ? (
          <ItemsNoEntregadosTable docs={filtrados} onOpen={onOpen}/>
        ) : (
        <div className="tbl-scroll doclist-scroll" ref={scrollWrapRef}>
          {/* Una preferencia POR ETAPA: las columnas de cotizaciones no son las de despachos, así
              que compartir el guardado escondería la columna equivocada al cambiar de módulo. */}
          <table className="tbl" ref={tablaListaRef}>
            <thead>
              <tr>
                <th style={{width:36,padding:'4px 10px'}}>
                  <input type="checkbox"
                    ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < filtrados.length; }}
                    checked={filtrados.length > 0 && selected.size === filtrados.length}
                    onChange={toggleAll}
                    style={{cursor:'pointer'}}
                  />
                </th>
                <SortHeader sortKey="id" current={sortState} onSort={requestSort}>Documento</SortHeader>
                <SortHeader sortKey="cliente" current={sortState} onSort={requestSort}>Cliente</SortHeader>
                <SortHeader sortKey="vendedor" current={sortState} onSort={requestSort} className="hide-sm">Vendedor</SortHeader>
                <th className="dt-hide-mobile">Creado por</th>
                <SortHeader sortKey="fecha" current={sortState} onSort={requestSort} className="hide-sm">Fecha</SortHeader>
                {stage === 'despacho' && <SortHeader sortKey="dias" current={sortState} onSort={requestSort} align="center" className="hide-sm" style={{textAlign:'center'}}>Días</SortHeader>}
                {stage === 'despacho' && <th className="hide-sm">Almacén</th>}
                {stage === 'despacho' && <th className="hide-sm">Entrega estimada</th>}
                {stage === 'despacho' && <th className="hide-sm">Entregado</th>}
                {stage === 'factura' && <th className="hide-sm">Tipo entrega</th>}
                {stage === 'factura' && <th className="hide-sm">Almacén</th>}
                <SortHeader sortKey="items" current={sortState} onSort={requestSort} align="right" className="num hide-sm">Items</SortHeader>
                {/* Despacho = documento logístico: sin montos (Total USD / Equiv. Bs). */}
                {stage !== 'despacho' && <SortHeader sortKey="total" current={sortState} onSort={requestSort} align="right" className="num">Total USD</SortHeader>}
                {stage !== 'despacho' && <SortHeader sortKey="totalBs" current={sortState} onSort={requestSort} align="right" className="num hide-sm">Equiv. Bs</SortHeader>}
                <SortHeader sortKey="estado" current={sortState} onSort={requestSort}>Estado</SortHeader>
                {(stage==='despacho' || stage==='factura') && <SortHeader sortKey="envio" current={sortState} onSort={requestSort} className="hide-sm">{stage==='factura' ? 'Despacho' : 'Envío'}</SortHeader>}
                {stage==='factura' && <SortHeader sortKey="cobro" current={sortState} onSort={requestSort}>Cobro</SortHeader>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageDocs.map(d => {
                const cli = clienteMap.get(d.cliente || d.cliente_id);
                const isSel = selected.has(d.id);
                return (
                  <tr key={d.id}
                    onClick={e => { if (selected.size > 0) { toggleSelect(d.id, e); } else {
                      // Se manda la página completa (los mismos documentos que se están viendo
                      // filtrados): el detalle usa esto para ofrecer flechas ← → sin volver a la
                      // tabla. Pedido explícito: "navegar por los documentos del filtro".
                      onOpen(d, { ids: pageDocs.map(x => x.id), stage });
                    } }}
                    style={{cursor:'pointer', background: isSel ? 'var(--brand-soft)' : ''}}
                  >
                    <td style={{padding:'4px 10px',width:36}} onClick={e=>toggleSelect(d.id,e)}>
                      <input type="checkbox" checked={isSel} onChange={()=>{}} style={{cursor:'pointer',pointerEvents:'none'}}/>
                    </td>
                    <td className="mono-cell" style={{fontWeight: 500}}>{window.dispIdDespacho(d)}{d.odoo_ref && <span title={'Migrado de Odoo · ' + d.odoo_ref} style={{marginLeft:6, fontSize:9, padding:'1px 5px', borderRadius:4, background:'var(--bg-elev)', color:'var(--text-muted)', fontWeight:700, letterSpacing:'0.04em', verticalAlign:'middle'}}>MIG</span>}</td>
                    <td>
                      <div style={{fontWeight: 500}}>
                        <window.ClienteLink clienteId={cli?.id} nombre={cli?.nombre}>{cli?.nombre || '—'}</window.ClienteLink>
                      </div>
                      <div className="small mono">{cli?.rif}</div>
                    </td>
                    <td className="hide-sm">{d.vendedor || '—'}</td>
                    <td className="dt-hide-mobile"><CreadoPorCell nombre={d.creado_por}/></td>
                    <td className="muted hide-sm">{fmtFechaDMY(d.fecha)}{d.created_at && <span style={{opacity:0.6}}> · {fmtHora(d.created_at)}</span>}</td>
                    {stage === 'despacho' && (() => {
                      const entregado = getEstadoEnvio(d) === 'entregado';
                      const dias = (() => {
                        if (entregado || !d.fecha) return 0;
                        const f = new Date(d.fecha.substring(0, 10) + 'T12:00:00');
                        const fLocal = new Date(f.getFullYear(), f.getMonth(), f.getDate());
                        const hoy = new Date(window.localDateStr() + 'T12:00:00');
                        const hoyLocal = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
                        return Math.max(0, Math.floor((hoyLocal - fLocal) / 86400000));
                      })();
                      const color = dias === 0 ? '#16a34a' : dias <= 3 ? '#b45309' : dias <= 7 ? '#ea580c' : '#dc2626';
                      return (
                        <td className="hide-sm" style={{textAlign:'center'}}>
                          <span className="chip" style={{background: color+'18', color, fontWeight:700, fontSize:12}}>
                            {dias}d
                          </span>
                        </td>
                      );
                    })()}
                    {stage === 'despacho' && (
                      <td className="hide-sm small" style={{whiteSpace:'nowrap'}}>
                        {(SSData.almacenes||[]).find(a=>a.id===d.almacen_id)?.nombre || <span className="muted">—</span>}
                      </td>
                    )}
                    {stage === 'despacho' && (
                      <td className="hide-sm" onClick={e=>e.stopPropagation()}>
                        <FechaEntregaCell doc={d} onSaved={() => setEnvioTick(t => t + 1)}/>
                      </td>
                    )}
                    {stage === 'despacho' && (
                      <td className="hide-sm small" style={{whiteSpace:'nowrap', fontWeight:600, color: getEstadoEnvio(d) === 'entregado' ? '#16a34a' : 'var(--text-subtle)'}}>
                        {getEstadoEnvio(d) === 'entregado'
                          ? (getEntregadoEn(d) ? fmtFechaHora(getEntregadoEn(d)) : '—')
                          : <span className="muted">—</span>}
                      </td>
                    )}
                    {stage === 'factura' && (
                      <td className="hide-sm small" style={{whiteSpace:'nowrap'}}>
                        {d.tipo_entrega
                          ? window.ssLabelEntrega(d.tipo_entrega)
                          : <span className="muted">—</span>}
                      </td>
                    )}
                    {stage === 'factura' && (
                      <td className="hide-sm small" style={{whiteSpace:'nowrap'}}>
                        {(SSData.almacenes||[]).find(a=>a.id===d.almacen_id)?.nombre || <span className="muted">—</span>}
                      </td>
                    )}
                    <td className="num hide-sm">{d.items}</td>
                    {/* Despacho sin montos: ocultar Total USD / Equiv. Bs (alineado con el header). */}
                    {stage !== 'despacho' && <td className="num strong-num">{fmt.usd(d.total)}</td>}
                    {stage !== 'despacho' && <td className="num muted hide-sm" style={{fontSize: 12}}>{fmt.ves(d.total * SSData.tasa.bcv)}</td>}
                    <td>
                      {/* Cancelada/anulada pisa cualquier otro rótulo de estado: en su propia pestaña
                          (ver SUBTABS) es lo único que hay, y el color rojo es el mismo que usa el
                          badge del detalle — misma familia visual para "esto ya no sigue vivo". */}
                      {(d.estado === 'cancelada' || d.estado === 'anulada')
                        ? <span className="chip" style={{background:'#fee2e2', color:'#dc2626'}}>
                            <span className="chip-dot" style={{background:'#dc2626'}}/>
                            {d.estado === 'anulada' ? 'Anulada' : 'Cancelada'}
                            <span title={window.textoEstadoInfo(d)} style={{marginLeft:4, display:'inline-flex'}}>
                              <Icon name="info" size={10}/>
                            </span>
                          </span>
                        : stage === 'factura'
                        ? <span className="chip" style={{background: stageColor[stage]+'18', color: stageColor[stage]}}>
                            <span className="chip-dot" style={{background: stageColor[stage]}}/>
                            {window.ssRotuloFactura(d)}
                          </span>
                        : stage === 'despacho'
                        ? (() => {
                            // Estado = espejo del Envío (se actualiza en vivo al cambiar el dropdown de Envío).
                            const m = ENVIO_META[getEstadoEnvio(d)] || ENVIO_META.pendiente_por_enviar;
                            return <span className="chip" style={{background: m.color+'18', color: m.color}}><span className="chip-dot" style={{background: m.color}}/>{m.label}</span>;
                          })()
                        : <span className="chip" style={{background: stageColor[stage]+'18', color: stageColor[stage]}}><span className="chip-dot" style={{background: stageColor[stage]}}/>{stageTitle[stage]}</span>
                      }
                      {stage === 'factura' && d.modalidad_pago && (
                        <div style={{marginTop:3}}>
                          <span className="chip" style={{fontSize:10.5, padding:'1px 6px', background: (modalidadColor[d.modalidad_pago]||'var(--brand)')+'18', color: modalidadColor[d.modalidad_pago]||'var(--brand)'}}>
                            {modalidadLabel[d.modalidad_pago] || d.modalidad_pago}
                          </span>
                        </div>
                      )}
                    </td>
                    {(stage === 'despacho' || stage === 'factura') && (
                      <td className="hide-sm">
                        {stage === 'factura'
                          ? <EstadoDespachoChip estado={d.estado_despacho} lines={d.lines}/>
                          : <EnvioChipEditable doc={d} editable onSaved={() => setEnvioTick(t => t + 1)}/>}
                      </td>
                    )}
                    {stage === 'factura' && (() => {
                      const cxc = (SSData.cuentasCobrar||[]).find(c => c.factura === d.id);
                      if (!cxc) {
                        // Sin CxC: usar el estado_cobro del doc (migrado de Odoo). Antes toda factura
                        // pagada salía "Sin CxC" gris aunque estuviera cobrada.
                        const ec = d.estado_cobro;
                        if (ec === 'pagada')     return <td><span className="chip" style={{fontSize:11,background:'#16a34a18',color:'#16a34a',fontWeight:700}}><span className="chip-dot" style={{background:'#16a34a'}}/>Cobrada</span></td>;
                        if (ec === 'parcial')    return <td><span className="chip" style={{fontSize:11,background:'#d9770618',color:'#d97706',fontWeight:700}}>Parcial</span></td>;
                        if (ec === 'por_cobrar') return <td><span className="chip" style={{fontSize:11,background:'#2563eb18',color:'#2563eb'}}>Por cobrar</span></td>;
                        return <td><span className="chip" style={{fontSize:11,background:'#64748b18',color:'#64748b'}}>Sin CxC</span></td>;
                      }
                      const pct = cxc.monto > 0 ? Math.min(100,(cxc.pagado/cxc.monto)*100) : 0;
                      const colorMap = { pagada:'var(--success)', parcial:'var(--warn)', pendiente:'#2563eb', vencida:'var(--danger)' };
                      const labelMap = { pagada:'Cobrada', parcial:'Parcial', pendiente:'Pendiente', vencida:'Vencida' };
                      const color = colorMap[cxc.estado] || 'var(--text-muted)';
                      const saldo = (cxc.monto||0) - (cxc.pagado||0);
                      return (
                        <td onClick={e=>e.stopPropagation()} style={{minWidth:140}}>
                          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:4}}>
                            <div>
                              <span className="chip" style={{fontSize:11,background:color+'18',color,fontWeight:700}}>
                                <span className="chip-dot" style={{background:color}}/>{labelMap[cxc.estado]||cxc.estado}
                              </span>
                              {cxc.estado !== 'pagada' && <div className="pbar mt-1" style={{height:3,borderRadius:2}}><span style={{width:`${pct}%`,background:color,borderRadius:2}}/></div>}
                              <div style={{fontSize:10.5,color:'var(--text-muted)',marginTop:2}}>
                                {cxc.estado==='pagada' ? fmt.usd(cxc.monto)+' cobrado' : saldo>0 ? fmt.usd(saldo)+' saldo' : fmt.usd(cxc.monto)+' total'}
                              </div>
                            </div>
                            {cxc.estado !== 'pagada' && window.puedeCobrarFactura() && (
                              <button className="icon-btn" style={{width:26,height:26,flexShrink:0,color:'var(--brand)'}}
                                title="Registrar pago" onClick={e=>{e.stopPropagation();setPagoTarget({doc:d,cxc});}}>
                                <Icon name="dollar" size={13}/>
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    })()}
                    <td>
                      <div style={{display:'flex',gap:4,justifyContent:'flex-end'}}>
                        {/* El lápiz de la lista NO miraba el linaje: desde acá se podía editar una
                            cotización ya convertida sin ningún aviso, que es por donde entró el caso
                            S38323. Congelado se muestra el candado en vez de esconder el botón — un
                            ícono que desaparece parece un problema de permisos, y el candado dice por
                            qué al pasar el mouse. */}
                        {onEdit && window.canUser?.('editar', stage) !== false && (
                          window.ssDocCongelado(d)
                            ? <span className="icon-btn" style={{width:26,height:26,opacity:.4,cursor:'not-allowed'}}
                                    title={window.ssMotivoCongelado(d)}
                                    onClick={e=>e.stopPropagation()}><Icon name="lock" size={13}/></span>
                            : <button className="icon-btn" style={{width:26,height:26}} title="Editar" onClick={e=>{e.stopPropagation();onEdit(d)}}><Icon name="edit" size={13}/></button>
                        )}
                        {(() => { const waUrl = buildWaUrl(d, cli); return waUrl ? (
                          <a href={waUrl} target="_blank" rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            title={`Enviar por WhatsApp a ${cli?.nombre || ''}`}
                            style={{width:26,height:26,display:'grid',placeItems:'center',borderRadius:6,border:'1px solid var(--border)',color:'#25D366',background:'var(--bg)',textDecoration:'none',flexShrink:0}}>
                            <Icon name="wa" size={13}/>
                          </a>
                        ) : null; })()}
                        {d.slug && <button className="icon-btn" style={{width:26,height:26,color:copiedId===d.id?'var(--brand)':''}} title={copiedId===d.id?'¡Copiado!':'Copiar enlace público'} onClick={e=>copyLink(e,d)}><Icon name="link" size={13}/></button>}
                        <button className="icon-btn" style={{width:26,height:26,color:previewDoc?.id===d.id?'var(--brand)':''}} title="Vista previa del PDF" onClick={e=>{e.stopPropagation(); setPreviewDoc(d);}}><Icon name="eye" size={13}/></button>
                        <button className="icon-btn" style={{width:26,height:26}} title="Descargar PDF" onClick={async e=>{e.stopPropagation(); const ls=(d.lines&&d.lines.length)?d.lines:(window.loadDocumentoItems?await window.loadDocumentoItems(d.id):[]); window.generateDocumentPDF&&window.generateDocumentPDF(d,ls,'usd');}}><Icon name="download" size={13}/></button>
                        <button className="icon-btn" style={{width:26,height:26}} title="Ver actividad" onClick={e=>{e.stopPropagation();setActLogDoc(d)}}><Icon name="clock" size={13}/></button>
                        <button className="icon-btn" style={{width:26,height:26}} onClick={e=>{e.stopPropagation();onOpen(d, { ids: pageDocs.map(x => x.id), stage });}}><Icon name="chevronR" size={14}/></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {(() => {
                // -2 en despacho: se ocultan las columnas Total USD y Equiv. Bs.
                const totalCols = 11 + (stage==='despacho'?3:0) + ((stage==='despacho'||stage==='factura')?1:0) + (stage==='factura'?1:0) - (stage==='despacho'?2:0);
                if (loading) return <tr><td colSpan={totalCols} className="empty">Cargando documentos…</td></tr>;
                if (filtrados.length === 0) return <tr><td colSpan={totalCols} className="empty">Sin documentos</td></tr>;
                return null;
              })()}
            </tbody>
          </table>
        </div>
        )}
        {!(stage === 'despacho' && despachoPanelF === 'no_entregado') && <window.FloatingHScrollbar targetRef={scrollWrapRef}/>}
        {/* Paginación — solo en la tabla de documentos (no en el panel de items no entregados) */}
        {!(stage === 'despacho' && despachoPanelF === 'no_entregado') && !loading && total > 0 && (
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10, padding:'10px 16px', borderTop:'1px solid var(--border)', fontSize:12}}>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <span className="muted">
                {total.toLocaleString('es-VE')} documento{total===1?'':'s'} · mostrando {startIdx+1}–{Math.min(startIdx+pageSize, total)}
              </span>
              <select className="select" value={pageSize} onChange={e => { setPageSize(parseInt(e.target.value)); setPage(1); }} style={{fontSize:12, padding:'3px 6px'}}>
                {[50,100,200].map(n => <option key={n} value={n}>{n} / pág.</option>)}
              </select>
            </div>
            {totalPages > 1 && (
              <div style={{display:'flex', gap:4, alignItems:'center'}}>
                <button className="btn ghost sm" disabled={safePage===1} onClick={() => setPage(1)}><Icon name="chevronL" size={11}/><Icon name="chevronL" size={11}/></button>
                <button className="btn ghost sm" disabled={safePage===1} onClick={() => setPage(p => Math.max(1, p-1))}><Icon name="chevronL" size={13}/></button>
                {pageBtns.map(p => (
                  <button key={p} className={'btn sm '+(p===safePage?'primary':'ghost')} style={{minWidth:32}} onClick={() => setPage(p)}>{p}</button>
                ))}
                <button className="btn ghost sm" disabled={safePage===totalPages} onClick={() => setPage(p => Math.min(totalPages, p+1))}><Icon name="chevronR" size={13}/></button>
                <button className="btn ghost sm" disabled={safePage===totalPages} onClick={() => setPage(totalPages)}><Icon name="chevronR" size={11}/><Icon name="chevronR" size={11}/></button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Floating bulk action bar ── */}
      {selected.size > 0 && (
        <div className="docs-bulk-bar" style={{
          position:'fixed', bottom:28, left:'50%', transform:'translateX(-50%)',
          background:'var(--bg-elev)', border:'1px solid var(--border)',
          borderRadius:16, boxShadow:'0 12px 40px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.15)',
          display:'flex', alignItems:'center', gap:6, padding:'10px 14px',
          zIndex:300, backdropFilter:'blur(12px)',
        }}>
          {/* Count + stage color accent */}
          <div style={{display:'flex',alignItems:'center',gap:8,paddingRight:10,borderRight:'1px solid var(--border)',marginRight:4}}>
            <div style={{width:24,height:24,borderRadius:8,background:stageColor[stage],display:'grid',placeItems:'center',color:'#fff',fontSize:11,fontWeight:700}}>
              {selected.size}
            </div>
            <span style={{fontSize:13,fontWeight:600,whiteSpace:'nowrap'}}>
              {stageTitle[stage]}{selected.size !== 1 ? 's' : ''} seleccionado{selected.size !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Total of selected */}
          <div style={{paddingRight:10,borderRight:'1px solid var(--border)',marginRight:4}}>
            <div style={{fontSize:12,color:'var(--text-muted)',lineHeight:1}}>Total selección</div>
            <div style={{fontSize:13,fontWeight:700,color:'var(--brand)'}}>
              {fmt.usd(filtrados.filter(d=>selected.has(d.id)).reduce((s,d)=>s+d.total,0))}
            </div>
          </div>

          {/* Exportar Excel */}
          <button className="btn ghost sm" onClick={handleExportCSV} style={{height:32}}>
            <Icon name="download" size={13}/>Exportar Excel
          </button>

          {/* Clear */}
          <button className="icon-btn" onClick={clearSelection} title="Deseleccionar todo" style={{marginLeft:4}}>
            <Icon name="x" size={15}/>
          </button>
        </div>
      )}
      {actLogDoc && <DocActivityLogModal doc={actLogDoc} onClose={() => setActLogDoc(null)}/>}
      {previewDoc && <DocumentPreviewPanel doc={previewDoc} onClose={() => setPreviewDoc(null)}/>}
      {pagoTarget && (
        <RegistrarPagoModal
          doc={pagoTarget.doc}
          cxc={pagoTarget.cxc}
          onClose={() => setPagoTarget(null)}
          onPaid={() => {
            setPagoTarget(null);
            window.dispatchEvent(new Event('ss-doc-version-bump'));  // re-pide la página actual server-side
          }}
        />
      )}

      {/* ── Modal confirmación anulación de facturas ── */}
      {showExportAll && (
        <ExportAllDocsModal
          fechaDesde={fechaDesde}
          fechaHasta={fechaHasta}
          onClose={() => setShowExportAll(false)}
        />
      )}

    </div>
  );
}

// ====================== Activity Log Modal ======================
function DocActivityLogModal({ doc, onClose }) {
  const [supaRows, setSupaRows] = React.useState([]);
  const [loading, setLoading]   = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const rows = await window.fetchActivityLog?.({ modulo: 'documentos', entidad_id: doc.id, limit: 200 }) || [];
      if (!cancelled) { setSupaRows(rows); setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [doc.id]);

  const actionMeta = {
    creado:        { color:'#047857', label:'Creación' },
    crear:         { color:'#047857', label:'Creación' },
    editado:       { color:'#2563eb', label:'Edición' },
    editar:        { color:'#2563eb', label:'Edición' },
    promovido:     { color:'#b45309', label:'Conversión' },
    completado:    { color:'#7c3aed', label:'Entrega completada' },
    eliminar:      { color:'#dc2626', label:'Eliminación' },
    bulk_eliminar: { color:'#dc2626', label:'Eliminación masiva' },
  };

  function fmtDetalles(detalles, accion) {
    if (!detalles) return accion;
    const d = typeof detalles === 'string' ? {} : detalles;
    if (d.envio_estado) {
      const lbl = { pendiente:'Por enviar', en_ruta:'En ruta', entregado:'Entregado', incidencia:'Incidencia' };
      return `Estado de envío → ${lbl[d.envio_estado] || d.envio_estado}${d.manual ? ' (manual)' : ''}`;
    }
    if (d.conversion) return `Conversión: ${d.conversion}`;
    if (d.duplicado_desde) return `Duplicado desde ${d.duplicado_desde}`;
    // Las ediciones con diff de verdad (campos/líneas antes-después) se renderizan aparte, no acá.
    if (Array.isArray(d.campos) || Array.isArray(d.lineas_modificadas) || Array.isArray(d.lineas_agregadas) || Array.isArray(d.lineas_eliminadas)) return '';
    const pairs = Object.entries(d).filter(([k,v]) => v !== null && !['manual'].includes(k) && k !== 'items');
    return pairs.length ? pairs.map(([k,v]) => `${k}: ${v}`).join(' · ') : accion;
  }

  // Valor legible para el "antes → después".
  function fmtValorCambio(v) {
    if (v == null || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'sí' : 'no';
    return String(v);
  }

  // Diff detallado de una edición de documento: campos de cabecera y líneas — cada cambio con su
  // valor ANTES y DESPUÉS, pedido explícito ("si cambió el precio de un producto, cuánto estaba
  // antes y a cuánto lo cambió"). Devuelve null si el registro no trae este formato (log viejo o
  // de otro tipo de acción), y en ese caso el timeline sigue mostrando el texto de `fmtDetalles`.
  function renderCambiosDocumento(detalles) {
    const d = detalles && typeof detalles === 'object' ? detalles : {};
    const hayCampos = Array.isArray(d.campos) && d.campos.length;
    const hayMod = Array.isArray(d.lineas_modificadas) && d.lineas_modificadas.length;
    const hayAdd = Array.isArray(d.lineas_agregadas) && d.lineas_agregadas.length;
    const hayDel = Array.isArray(d.lineas_eliminadas) && d.lineas_eliminadas.length;
    if (!hayCampos && !hayMod && !hayAdd && !hayDel) return null;
    return (
      <div style={{display:'flex', flexDirection:'column', gap:6, marginBottom:6}}>
        {hayCampos && d.campos.map((c, i) => (
          <div key={'c'+i} style={{fontSize:12.5}}>
            <strong>{c.campo}:</strong>{' '}
            <span style={{color:'var(--text-muted)', textDecoration:'line-through'}}>{fmtValorCambio(c.antes)}</span>
            {' → '}
            <span style={{fontWeight:600}}>{fmtValorCambio(c.despues)}</span>
          </div>
        ))}
        {hayMod && d.lineas_modificadas.map((l, i) => (
          <div key={'m'+i} style={{fontSize:12.5}}>
            <div style={{fontWeight:600}}>{l.nombre || l.sku}</div>
            {l.cambios.map((c, j) => (
              <div key={j} style={{marginLeft:10, color:'var(--text-muted)'}}>
                {c.campo}: <span style={{textDecoration:'line-through'}}>{fmtValorCambio(c.antes)}</span>
                {' → '}<span style={{color:'var(--text)', fontWeight:500}}>{fmtValorCambio(c.despues)}</span>
              </div>
            ))}
          </div>
        ))}
        {hayAdd && (
          <div style={{fontSize:12.5, color:'var(--success)'}}>
            + Agregado: {d.lineas_agregadas.map(l => `${l.nombre || l.sku} (x${l.cantidad}, $${l.precio})`).join(', ')}
          </div>
        )}
        {hayDel && (
          <div style={{fontSize:12.5, color:'var(--danger)'}}>
            − Quitado: {d.lineas_eliminadas.map(l => `${l.nombre || l.sku} (x${l.cantidad}, $${l.precio})`).join(', ')}
          </div>
        )}
      </div>
    );
  }

  function fmtTs(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('es-VE',{day:'2-digit',month:'short',year:'numeric',timeZone:'America/Caracas'}) + ' ' +
           d.toLocaleTimeString('es-VE',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'America/Caracas'});
  }

  const localEntries = (window.ssActivityLog?.getForDoc(doc.id) || []).map(e => ({
    id: e.id, action: e.action, detail: e.detail, user: e.user, ts: e.ts, src: 'local',
  }));
  const supaEntries = supaRows.map(r => ({
    id: String(r.id), action: r.accion,
    detail: fmtDetalles(r.detalles, r.accion),
    rawDetalles: r.detalles,
    user: r.usuario_nombre || 'Sistema',
    ts: r.created_at, src: 'supabase',
  }));

  const seenIds = new Set();
  const entries = [...localEntries, ...supaEntries]
    .filter(e => { if (seenIds.has(e.id)) return false; seenIds.add(e.id); return true; })
    .sort((a, b) => new Date(b.ts) - new Date(a.ts));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{maxWidth:520, maxHeight:'82vh', display:'flex', flexDirection:'column'}} onClick={e=>e.stopPropagation()}>
        <div className="modal-header" style={{flexShrink:0}}>
          <div style={{display:'flex', alignItems:'center', gap:12}}>
            <div style={{width:36, height:36, borderRadius:9, background:'var(--brand-soft)', color:'var(--brand)', display:'grid', placeItems:'center', flexShrink:0}}>
              <Icon name="clock" size={18}/>
            </div>
            <div>
              <h3 style={{margin:0}}>Log de actividad</h3>
              <div className="small muted">{doc.id} · {loading ? '…' : `${entries.length} evento${entries.length !== 1 ? 's' : ''}`}</div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div style={{overflow:'auto', flex:1, padding:'20px 24px'}}>
          {loading ? (
            <div style={{textAlign:'center', padding:'48px 0', color:'var(--text-muted)', fontSize:13}}>Cargando actividad…</div>
          ) : entries.length === 0 ? (
            <div style={{textAlign:'center', padding:'48px 0', color:'var(--text-muted)'}}>
              <Icon name="clock" size={38} style={{opacity:0.25, display:'block', margin:'0 auto 12px'}}/>
              <div style={{fontSize:14, fontWeight:500, marginBottom:4}}>Sin actividad registrada</div>
              <div style={{fontSize:12}}>Los cambios futuros aparecerán aquí</div>
            </div>
          ) : (
            <div style={{position:'relative'}}>
              {entries.map((e, i) => {
                const meta = actionMeta[e.action] || {color:'var(--brand)', label: e.action};
                return (
                  <div key={e.id} style={{display:'flex', gap:16, marginBottom: i < entries.length-1 ? 22 : 0, position:'relative'}}>
                    {i < entries.length-1 && (
                      <div style={{position:'absolute', left:13, top:28, bottom:-22, width:2, background:'var(--border)', zIndex:0}}/>
                    )}
                    <div style={{
                      width:28, height:28, borderRadius:'50%', flexShrink:0, zIndex:1,
                      background:'var(--bg-card)', border:`2px solid ${meta.color}`,
                      display:'grid', placeItems:'center',
                    }}>
                      <div style={{width:8, height:8, borderRadius:'50%', background:meta.color}}/>
                    </div>
                    <div style={{flex:1, minWidth:0, paddingTop:2}}>
                      <div style={{display:'flex', alignItems:'center', gap:7, flexWrap:'wrap', marginBottom:3}}>
                        <span style={{fontWeight:600, fontSize:13}}>{meta.label}</span>
                        <span style={{fontSize:10.5, padding:'1px 8px', borderRadius:20, background:meta.color+'18', color:meta.color, fontWeight:500}}>{e.action}</span>
                      </div>
                      {renderCambiosDocumento(e.rawDetalles) || (
                        e.detail && <div style={{fontSize:13, color:'var(--text)', lineHeight:1.5, marginBottom:6}}>{e.detail}</div>
                      )}
                      <div style={{display:'flex', alignItems:'center', gap:14, fontSize:11.5, color:'var(--text-muted)'}}>
                        <span style={{display:'flex', alignItems:'center', gap:4}}><Icon name="user" size={11}/>{e.user}</span>
                        <span style={{display:'flex', alignItems:'center', gap:4}}><Icon name="clock" size={11}/>{fmtTs(e.ts)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ====================== Modal Editar Despacho (solo 3 campos: dirección entrega, observaciones, driver) ======================
function EditDespachoModal({ doc, onClose, onSaved }) {
  const tasa  = SSData.tasa || { paralelo: 0 };
  const stage = doc.tipo || doc.estado || 'despacho';
  const stageMeta = {
    cotizacion: { title: 'Editar cotización',  icon: 'doc',     bg: '#e0f2fe', color: '#0369a1' },
    orden:      { title: 'Editar orden',       icon: 'receipt', bg: '#dbeafe', color: '#1e40af' },
    despacho:   { title: 'Editar despacho',    icon: 'truck',   bg: '#fef3c7', color: '#b45309' },
    factura:    { title: 'Editar factura',     icon: 'receipt', bg: '#d1fae5', color: '#047857' },
  };
  const meta = stageMeta[stage] || stageMeta.despacho;
  const [dirEntrega, setDirEntrega]       = useState(doc.dir_entrega    || '');
  const [observaciones, setObservaciones] = useState(doc.observaciones || '');
  const [driverId, setDriverId]           = useState(doc.driver_id      || '');
  const [tipoEntrega, setTipoEntrega]     = useState(doc.tipo_entrega   || 'retiro');
  const [zonaDelivery, setZonaDelivery]   = useState(doc.zona_delivery  || '');
  const [fuente, setFuente]               = useState(doc.fuente         || '');
  const [tasaParalelo, setTasaParalelo]   = useState(String(doc.tasa_paralelo ?? tasa.paralelo ?? ''));
  const [transportista, setTransportista] = useState(doc.transportista  || '');
  const [guiaEnvio, setGuiaEnvio]         = useState(doc.guia_envio     || '');
  const [nroDespacho, setNroDespacho]     = useState(doc.nro_despacho   || '');
  const [saving, setSaving]               = useState(false);

  // Modalidad de pago editable SOLO en factura y SOLO si todavía no le cobraron nada — cambiarla
  // con cobros ya registrados dejaría esos abonos convertidos a una tasa/base que no es la que
  // se usó para calcularlos. Pedido explícito 2026-08-14.
  const cxcAsociada = (SSData.cuentasCobrar || []).find(c => c.factura === doc.id) || null;
  const sinCobros = stage === 'factura' && doc.estado_cobro !== 'pagada'
    && (!cxcAsociada || (Number(cxcAsociada.pagado) || 0) <= 0.005);
  const [modalidadPago, setModalidadPagoEdit] = useState(doc.modalidad_pago || 'divisas');

  const drivers     = (SSData.drivers || []).filter(d => d.activo !== false);
  const fuentes     = SSData.fuentesVenta || [];
  const cli         = SSData.clientes.find(c => c.id === (doc.cliente_id || doc.cliente));
  // `esDelivery` sigue siendo el código 'delivery' porque la lista que abre es la de los
  // drivers PROPIOS de la empresa — eso es de esa opción y de ninguna otra. Lo que sí sale de la
  // tabla es si la entrega va por transportista tercero (transportista + guía) y si pide zona.
  const esDelivery   = tipoEntrega === 'delivery';
  const esEncomienda = window.ssRequiereGuia(tipoEntrega);
  const necesitaZona = window.ssRequiereZona(tipoEntrega);

  // Sugerencias comunes de transportista en Venezuela (datalist)
  const transportistasComunes = ['MRW Express', 'Zoom', 'Tealca', 'Domesa', 'Liberty Express', 'Mensajeros Aliados'];

  async function handleSave({ withPDF = false } = {}) {
    if (saving) return;
    const tpVal = parseFloat(tasaParalelo);
    if (tasaParalelo !== '' && (isNaN(tpVal) || tpVal <= 0)) { alert('La tasa paralela debe ser un número positivo.'); return; }
    setSaving(true);
    const payload = {
      dir_entrega:    dirEntrega    || null,
      observaciones:  observaciones || null,
      driver_id:      esDelivery ? (driverId || null) : null,
      tipo_entrega:   tipoEntrega,
      zona_delivery:  necesitaZona ? (zonaDelivery || null) : null,
      fuente:         fuente || null,
      tasa_paralelo:  tasaParalelo === '' ? null : tpVal,
      transportista:  esEncomienda ? (transportista || null) : null,
      guia_envio:     esEncomienda ? (guiaEnvio || null) : null,
      nro_despacho:   nroDespacho || null,
      // Solo se toca si la sección está habilitada (factura sin cobros, y no estaba ya en BCV) —
      // de lo contrario no se manda nada de esto, y `modalidad_pago` queda tal como estaba.
      ...(sinCobros && doc.modalidad_pago !== 'bcv' ? { modalidad_pago: modalidadPago } : {}),
    };
    const { error } = await window.sb.from('documentos').update(payload).eq('id', doc.id);
    if (error) { alert('Error al guardar: ' + error.message); setSaving(false); return; }

    // Sincronizar driver_despachos solo en stage despacho
    if (stage === 'despacho') {
      const driverPrev = doc.driver_id || '';
      const driverNew  = esDelivery ? (driverId || '') : '';
      if (driverNew !== driverPrev) {
        await window.sb.from('driver_despachos').update({ driver_id: driverNew || null }).eq('documento_id', doc.id);
      }
    }

    const camposCambiados = Object.keys(payload).filter(k => (payload[k] ?? null) !== (doc[k] ?? null));
    window.logActivity?.({
      modulo: 'documentos', accion: 'editar',
      entidad_id: doc.id, entidad_label: doc.id,
      detalles: { stage, campos_editados: camposCambiados }
    });
    setSaving(false);
    if (withPDF) {
      const ls = (doc.lines && doc.lines.length) ? doc.lines : (window.loadDocumentoItems ? await window.loadDocumentoItems(doc.id) : []);
      window.generateDocumentPDF?.({ ...doc, ...payload }, ls, 'usd');
    }
    onSaved && onSaved();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{width: 620, maxHeight:'90vh', display:'flex', flexDirection:'column'}}>
        <div className="modal-header">
          <div style={{width:40, height:40, borderRadius:10, background: meta.bg, color: meta.color, display:'grid', placeItems:'center'}}>
            <Icon name={meta.icon} size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">{meta.title}</h3>
            <div className="small muted">{doc.id} · {cli?.nombre || '—'} · Edita logística, transportista y datos del envío</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        <div className="modal-body" style={{flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:14}}>
          {/* Sección: Logística */}
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
            <div>
              <label className="form-label">Tipo de entrega</label>
              <select className="select" value={tipoEntrega} onChange={e=>setTipoEntrega(e.target.value)} style={{width:'100%'}}>
                {window.ssOpcionesEntrega().map(t => <option key={t.id} value={t.valor}>{t.nombre}</option>)}
                {tipoEntrega && !window.ssOpcionesEntrega().some(t => t.valor === tipoEntrega) && (
                  <option value={tipoEntrega}>{window.ssLabelEntrega(tipoEntrega)}</option>
                )}
              </select>
            </div>
            <div>
              <label className="form-label">Fuente / Canal</label>
              <select className="select" value={fuente} onChange={e=>setFuente(e.target.value)} style={{width:'100%'}}>
                <option value="">— Sin fuente —</option>
                {fuentes.map(f => <option key={f.id} value={f.nombre}>{f.nombre}</option>)}
                {/* Si la fuente actual es un ID legacy (fv-xxx) no presente como nombre, mostrarlo */}
                {fuente && !fuentes.some(f => f.nombre === fuente) && <option value={fuente}>{fuente}</option>}
              </select>
            </div>
          </div>

          {necesitaZona && (
            <div>
              <label className="form-label">Zona delivery</label>
              <input className="input" value={zonaDelivery} onChange={e=>setZonaDelivery(e.target.value)}
                placeholder="Ej: Caracas Este, Maracaibo Norte..."
                style={{width:'100%'}}/>
            </div>
          )}

          {esDelivery && (
            <div>
              <label className="form-label">Driver asignado</label>
              <select className="select" value={driverId} onChange={e=>setDriverId(e.target.value)} style={{width:'100%'}}>
                <option value="">— Sin asignar —</option>
                {drivers.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.nombre}{d.vehiculo ? ` · ${d.vehiculo}` : ''}{d.placa ? ` (${d.placa})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Sección: Información de envío (solo encomienda) */}
          {esEncomienda && (
            <div style={{padding:12, background:'var(--bg-sunken)', borderRadius:8, border:'1px solid var(--border)', display:'flex', flexDirection:'column', gap:10}}>
              <div className="small" style={{fontWeight:600, color:'var(--text)', textTransform:'uppercase', letterSpacing:0.5, fontSize:11}}>
                <Icon name="truck" size={11}/> Información de envío
              </div>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
                <div>
                  <label className="form-label">Transportista</label>
                  <input className="input" list="ed-transportistas" value={transportista} onChange={e=>setTransportista(e.target.value)}
                    placeholder="MRW Express, Zoom..." style={{width:'100%'}}/>
                  <datalist id="ed-transportistas">
                    {transportistasComunes.map(t => <option key={t} value={t}/>)}
                  </datalist>
                </div>
                <div>
                  <label className="form-label">Guía de transporte</label>
                  <input className="input mono" value={guiaEnvio} onChange={e=>setGuiaEnvio(e.target.value)}
                    placeholder="Nro. de guía..." style={{width:'100%'}}/>
                </div>
              </div>
            </div>
          )}

          {/* Sección: Modalidad de pago — solo factura y solo si no le cobraron nada todavía */}
          {sinCobros && (
            <div style={{padding:12, background:'var(--bg-sunken)', borderRadius:8, border:'1px solid var(--border)', display:'flex', flexDirection:'column', gap:10}}>
              <div className="small" style={{fontWeight:600, color:'var(--text)', textTransform:'uppercase', letterSpacing:0.5, fontSize:11}}>
                <Icon name="cash" size={11}/> Modalidad de pago
              </div>
              <div className="small muted" style={{fontSize:11.5, marginTop:-4}}>
                Esta factura todavía no tiene ningún cobro registrado, así que se puede corregir la modalidad.
                Una vez que se registre el primer pago, este campo se bloquea.
                {doc.modalidad_pago === 'bcv' && (
                  <> <strong>Nota:</strong> ya está en BCV + Cobertura — el precio de cada línea quedó calculado
                  con esa cobertura, así que cambiarla desde acá dejaría los montos guardados desactualizados.
                  Para eso hay que editarla completa desde una Orden.</>
                )}
              </div>
              <div>
                <label className="form-label">Modalidad</label>
                <select className="select" value={modalidadPago} onChange={e=>setModalidadPagoEdit(e.target.value)}
                  disabled={doc.modalidad_pago === 'bcv'} style={{width:'100%'}}>
                  <option value="divisas">Divisas USD</option>
                  <option value="bcv_fijo">Nota BCV (exacta)</option>
                  <option value="paralelo">Paralelo</option>
                  {/* "BCV + Cobertura" queda afuera a propósito: el precio de la línea YA lleva esa
                      cobertura horneada adentro (ver CLAUDE.md "Cobertura BCV"). Cambiar HACIA o
                      DESDE bcv sin recalcular cada línea dejaría el total guardado mintiendo sobre
                      lo que de verdad se cobra. Las otras tres comparten el mismo precio base en
                      USD — solo cambia en qué moneda/tasa se cobra — así que entre ellas sí es
                      seguro cambiar sin tocar ninguna línea. */}
                </select>
              </div>
            </div>
          )}

          {/* Sección: Tasa y referencia */}
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
            <div>
              <label className="form-label">Tasa paralela <span className="small muted" style={{textTransform:'none', fontWeight:400}}>(VES por USD)</span></label>
              <div style={{position:'relative'}}>
                <span style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', fontSize:12, color:'var(--text-muted)', fontFamily:'var(--mono)'}}>Bs.</span>
                <input className="input mono" type="number" step="0.01" min="0" value={tasaParalelo}
                  onChange={e=>setTasaParalelo(e.target.value)}
                  style={{width:'100%', paddingLeft:30}}/>
              </div>
            </div>
            <div>
              <label className="form-label">Nro. despacho / SOS</label>
              <input className="input mono" value={nroDespacho} onChange={e=>setNroDespacho(e.target.value)}
                placeholder="SOS-..." style={{width:'100%'}}/>
            </div>
          </div>

          {/* Sección: Dirección + observaciones */}
          <div>
            <label className="form-label">Dirección de entrega</label>
            <textarea className="input" rows={2} value={dirEntrega} onChange={e=>setDirEntrega(e.target.value)}
              placeholder={cli?.dir_entrega || cli?.direccion || 'Sin dirección registrada en el cliente'}
              style={{width:'100%', resize:'vertical', fontFamily:'inherit', fontSize:13, lineHeight:1.4}}/>
          </div>

          <div>
            <label className="form-label">Observaciones</label>
            <textarea className="input" rows={2} value={observaciones} onChange={e=>setObservaciones(e.target.value)}
              placeholder="Instrucciones, notas para el driver o transportista, etc."
              style={{width:'100%', resize:'vertical', fontFamily:'inherit', fontSize:13, lineHeight:1.4}}/>
          </div>

          <div className="card" style={{padding:10, background:'var(--bg-sunken)', fontSize:11.5, color:'var(--text-muted)', lineHeight:1.5}}>
            <Icon name="info" size={11}/> Esta edición rápida NO modifica productos ni datos del cliente — solo logística, envío y referencias{sinCobros ? ' (y la modalidad de pago, mientras no tenga cobros)' : ''}. Los números de serie se gestionan desde la tabla de productos del despacho.
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          {stage === 'despacho' && (
            <button className="btn secondary" onClick={() => handleSave({ withPDF: true })} disabled={saving} style={{gap:6}}>
              <Icon name="download" size={13}/>{saving ? 'Guardando…' : 'Guardar y PDF'}
            </button>
          )}
          <button className="btn primary" onClick={handleSave} disabled={saving}>
            <Icon name="check" size={14}/>{saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ====================== Modal Asignar Seriales (por línea de un despacho) ======================
function AsignarSerialesModal({ doc, line, onClose, onSaved, readOnly = false }) {
  const empresa  = window.currentEmpresa || 'demo1';
  const clienteId = doc.cliente_id || doc.cliente || null;
  const almId    = doc.almacen_id || null;
  const totalQty = line.qty || 1;

  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [seriales, setSeriales]       = useState([]);  // todos los del SKU (disponibles, vendidos, etc.)
  const [asignados, setAsignados]     = useState([]);  // S/N ya asociados a ESTE doc
  const [seleccion, setSeleccion]     = useState([]);  // ids seleccionados para este despacho
  const [nuevoSerial, setNuevoSerial]           = useState('');
  const [nuevaGarantia, setNuevaGarantia]       = useState(String(line.garantia_meses ?? 12));
  const [nuevaGarantiaCond, setNuevaGarantiaCond] = useState(line.garantia_condiciones || '');
  const [err, setErr] = useState('');

  async function reload() {
    setLoading(true);
    // Fix bug #7: filtrar por el almacén del documento. Antes la query traía S/N
    // 'disponible' de CUALQUIER almacén, permitiendo despachar un serial físicamente
    // ubicado en otro almacén. El flujo de auto-asignación ya filtra por almacén
    // (.eq('almacen_id', almId)); replicamos ese invariante en el override manual.
    // Conservamos los S/N ya asignados a ESTE doc aunque estén en otro almacén,
    // para no perder la capacidad de des-asignarlos.
    let q = window.sb.from('inventario_seriales')
      .select('*').eq('empresa_id', empresa).eq('sku', line.sku);
    if (almId) q = q.or(`almacen_id.eq.${almId},documento_id.eq.${doc.id}`);
    const { data } = await q.order('created_at', { ascending: true });
    const rows = data || [];
    setSeriales(rows);
    // Los ya asignados a este doc: estado=vendido + documento_id=doc.id
    const yaEnDoc = rows.filter(s => s.documento_id === doc.id);
    setAsignados(yaEnDoc);
    setSeleccion(yaEnDoc.map(s => s.id));
    setLoading(false);
  }
  useEffect(() => { reload(); }, []);

  const disponibles = seriales.filter(s => s.estado === 'disponible' || s.documento_id === doc.id);

  function toggleSel(id) {
    if (readOnly) return;
    setErr('');
    setSeleccion(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= totalQty) {
        setErr(`Solo puedes asignar ${totalQty} S/N para esta línea (cantidad = ${totalQty}).`);
        return prev;
      }
      return [...prev, id];
    });
  }

  async function agregarNuevo() {
    if (readOnly) return;
    const sn = nuevoSerial.trim();
    if (!sn) return;
    if (seriales.some(s => s.serial === sn)) {
      setErr(`El S/N "${sn}" ya existe para este SKU.`);
      return;
    }
    setErr(''); setSaving(true);
    const { data: inserted, error } = await window.agregarSeriales({
      sku: line.sku, almacenId: almId,
      garantiaMeses: parseInt(nuevaGarantia) || 0,
      garantiaCondiciones: nuevaGarantiaCond.trim() || null,
      seriales: [sn],
    });
    setSaving(false);
    if (error) { setErr('Error: ' + (error.message || JSON.stringify(error))); return; }
    setNuevoSerial('');
    // Recargar y auto-seleccionar el serial recién agregado (mismo filtro por almacén — fix bug #7)
    let rq = window.sb.from('inventario_seriales')
      .select('*').eq('empresa_id', empresa).eq('sku', line.sku);
    if (almId) rq = rq.or(`almacen_id.eq.${almId},documento_id.eq.${doc.id}`);
    const { data: rows } = await rq.order('created_at', { ascending: true });
    const allRows = rows || [];
    setSeriales(allRows);
    const yaEnDoc = allRows.filter(s => s.documento_id === doc.id);
    setAsignados(yaEnDoc);
    // Auto-seleccionar el nuevo S/N si hay espacio
    const newRow = allRows.find(s => s.serial === sn);
    if (newRow) {
      setSeleccion(prev => {
        if (prev.includes(newRow.id)) return prev;
        if (prev.length >= totalQty) return prev;
        return [...prev, newRow.id];
      });
    }
    setLoading(false);
  }

  async function guardar() {
    if (readOnly) return;
    if (window.canUser && !window.canUser('editar', 'pos_seriales')) {
      setErr('No tienes permiso para cambiar seriales (pos_seriales.editar).');
      return;
    }
    setErr(''); setSaving(true);

    // Si hay S/N escrito pero no agregado aún, insertarlo primero y obtener su id
    let seleccionFinal = [...seleccion];
    if (nuevoSerial.trim()) {
      const sn = nuevoSerial.trim();
      if (!seriales.some(s => s.serial === sn)) {
        const { error: addErr } = await window.agregarSeriales({
          sku: line.sku, almacenId: almId,
          garantiaMeses: parseInt(nuevaGarantia) || 0,
          garantiaCondiciones: nuevaGarantiaCond.trim() || null,
          seriales: [sn],
        });
        if (addErr) { setSaving(false); setErr('Error al agregar S/N: ' + (addErr.message || JSON.stringify(addErr))); return; }
        setNuevoSerial('');
      }
      // Buscar el id del serial recién insertado o ya existente
      const { data: snRow } = await window.sb.from('inventario_seriales')
        .select('id').eq('empresa_id', empresa).eq('sku', line.sku).eq('serial', sn).single();
      if (snRow && !seleccionFinal.includes(snRow.id)) {
        if (seleccionFinal.length < totalQty) seleccionFinal.push(snRow.id);
      }
    }
    const fechaVenta = window.localDateStr();

    // 1) Liberar los que estaban asignados y ya no están seleccionados (vuelven a disponible)
    const aLiberar = asignados.filter(s => !seleccionFinal.includes(s.id)).map(s => s.id);
    if (aLiberar.length > 0) {
      await window.liberarSeriales({ serialIds: aLiberar, motivo: `desasignación desde doc ${doc.id}` });
    }

    // 2) Marcar los seleccionados como vendidos a este doc
    const nuevos = seleccionFinal.filter(id => !asignados.some(a => a.id === id));
    if (nuevos.length > 0) {
      const { error: markErr } = await window.marcarSerialesVendidos({
        serialIds: nuevos,
        documentoId: doc.id,
        clienteId,
        fechaVenta,
      });
      if (markErr) {
        setSaving(false);
        setErr('Error al guardar S/N: ' + (markErr.message || JSON.stringify(markErr)));
        return;
      }
    }

    setSaving(false);
    // Log en módulo documentos (compat) + log dedicado pos_seriales para trazabilidad de cambios
    window.logActivity?.({
      modulo:'documentos', accion:'editar',
      entidad_id: doc.id, entidad_label: doc.id,
      detalles:{ sku: line.sku, seriales_asignados: seleccionFinal.length, seriales_liberados: aLiberar.length }
    });
    const serialesAntes = asignados.map(s => s.serial).sort();
    const serialesDespues = seriales.filter(s => seleccionFinal.includes(s.id)).map(s => s.serial).sort();
    const cambio = JSON.stringify(serialesAntes) !== JSON.stringify(serialesDespues);
    if (cambio) {
      window.logActivity?.({
        modulo:'pos_seriales', accion: aLiberar.length > 0 ? 'cambiar' : 'crear',
        entidad_id: doc.id, entidad_label: `${doc.id} · ${line.sku}`,
        detalles:{
          sku: line.sku,
          seriales_antes: serialesAntes,
          seriales_despues: serialesDespues,
          liberados: aLiberar.length,
          nuevos: nuevos.length,
        }
      });
    }
    onSaved && onSaved();
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{zIndex:210}}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width:'min(720px, 96vw)', maxHeight:'90vh', display:'flex', flexDirection:'column'}}>
        <div className="modal-header">
          <div style={{width:40, height:40, borderRadius:10, background:'var(--brand-soft)', color:'var(--brand)', display:'grid', placeItems:'center'}}>
            <Icon name="check" size={20}/>
          </div>
          <div style={{flex:1, minWidth:0}}>
            <h3 className="modal-title">{readOnly ? 'Ver seriales' : 'Asignar seriales'} · {line.sku}</h3>
            <div className="small muted" style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
              {line.nombre} · {totalQty} unidad{totalQty!==1?'es':''} · Despacho {doc.id}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        <div className="modal-body" style={{overflowY:'auto'}}>
          {loading && <div className="empty">Cargando seriales...</div>}

          {!loading && (
            <>
              {/* Progreso */}
              <div style={{padding:'10px 12px', background: seleccion.length === totalQty ? 'var(--success)15' : 'var(--warn)15', borderRadius:8, marginBottom:14, display:'flex', alignItems:'center', gap:10}}>
                <Icon name={seleccion.length === totalQty ? 'check' : 'alert'} size={16} color={seleccion.length === totalQty ? 'var(--success)' : 'var(--warn)'}/>
                <div style={{flex:1}}>
                  <div style={{fontWeight:600, fontSize:13, color: seleccion.length === totalQty ? 'var(--success)' : 'var(--warn)'}}>
                    {seleccion.length} de {totalQty} S/N asignados
                  </div>
                  <div className="small muted">
                    {seleccion.length === totalQty
                      ? 'Todos los equipos tienen S/N asignado.'
                      : `Faltan ${totalQty - seleccion.length} para completar la entrega.`}
                  </div>
                </div>
              </div>

              {/* Lista de seriales disponibles */}
              <div style={{marginBottom:14}}>
                <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8}}>
                  <strong style={{fontSize:12, textTransform:'uppercase', letterSpacing:0.5}}>S/N disponibles para este SKU</strong>
                  <span className="small muted">({disponibles.length})</span>
                </div>
                {disponibles.length === 0 ? (
                  <div className="empty" style={{padding:'18px', textAlign:'center', background:'var(--bg-sunken)', borderRadius:8}}>
                    No hay S/N registrados disponibles. Usa "Registrar S/N nuevo" abajo para agregar uno.
                  </div>
                ) : (
                  <div style={{border:'1px solid var(--border)', borderRadius:8, overflow:'hidden', maxHeight:280, overflowY:'auto'}}>
                    {disponibles.map((s, i) => {
                      const selected = seleccion.includes(s.id);
                      const asignadoOtroDoc = s.documento_id && s.documento_id !== doc.id;
                      return (
                        <label key={s.id} style={{
                          display:'grid', gridTemplateColumns:'30px 1fr 110px 100px', gap:10, alignItems:'center',
                          padding:'10px 12px', borderTop: i===0 ? 'none' : '1px solid var(--border)',
                          background: selected ? 'var(--brand-soft)' : 'transparent',
                          cursor: asignadoOtroDoc ? 'not-allowed' : 'pointer',
                          opacity: asignadoOtroDoc ? 0.5 : 1,
                        }}>
                          <input type="checkbox" checked={selected} disabled={asignadoOtroDoc || readOnly}
                            onChange={() => toggleSel(s.id)} style={{width:16, height:16, cursor: readOnly ? 'not-allowed' : 'pointer'}}/>
                          <div>
                            <div style={{fontFamily:'var(--mono)', fontSize:13, fontWeight:500}}>{s.serial}</div>
                            <div className="small muted">Ingresó {fmt.date(s.fecha_ingreso || s.created_at?.slice(0,10))}</div>
                          </div>
                          <div style={{fontSize:12}}>
                            <span className="muted">Garantía: </span>
                            <strong>{s.garantia_meses || 0} m</strong>
                          </div>
                          <div>
                            {asignadoOtroDoc
                              ? <span className="chip amber" style={{fontSize:10}}>otro doc</span>
                              : selected ? <span className="chip blue" style={{fontSize:10}}>seleccionado</span>
                              : <span className="chip green" style={{fontSize:10}}>libre</span>}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Registrar nuevo S/N (oculto en modo solo lectura) */}
              {!readOnly && <div style={{border:'1px dashed var(--border)', borderRadius:8, padding:12, background:'var(--bg-sunken)'}}>
                <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:10}}>
                  <Icon name="plus" size={13}/>
                  <strong style={{fontSize:12, textTransform:'uppercase', letterSpacing:0.5}}>Registrar S/N nuevo</strong>
                  <span className="small muted">(caja física no registrada antes)</span>
                </div>
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr auto', gap:8, alignItems:'end', marginBottom:8}}>
                  <div>
                    <label className="form-label">Número de serie</label>
                    <input className="input mono" value={nuevoSerial} onChange={e=>setNuevoSerial(e.target.value)}
                      placeholder="SN-XXXX..." onKeyDown={e => e.key === 'Enter' && agregarNuevo()}/>
                  </div>
                  <div>
                    <label className="form-label">Garantía (meses)</label>
                    {(() => {
                      const PRESETS = ['0','3','6','12','24'];
                      const isCustom = !PRESETS.includes(String(nuevaGarantia));
                      return <div style={{display:'flex', gap:5, alignItems:'center'}}>
                        <select className="select" style={{flex:1}}
                          value={isCustom ? '__custom__' : String(nuevaGarantia)}
                          onChange={e => setNuevaGarantia(e.target.value === '__custom__' ? '' : e.target.value)}>
                          <option value="0">Sin garantía</option>
                          <option value="3">3 meses</option>
                          <option value="6">6 meses</option>
                          <option value="12">12 meses</option>
                          <option value="24">24 meses</option>
                          <option value="__custom__">Otro...</option>
                        </select>
                        {isCustom && <input className="input mono" type="number" min="0" style={{width:60}}
                          autoFocus value={nuevaGarantia} onChange={e=>setNuevaGarantia(e.target.value)} placeholder="meses"/>}
                      </div>;
                    })()}
                  </div>
                  <button className="btn secondary" onClick={agregarNuevo} disabled={!nuevoSerial.trim() || saving}
                    style={{alignSelf:'flex-end'}}>
                    <Icon name="plus" size={12}/>Agregar
                  </button>
                </div>
                <div>
                  <label className="form-label">Condiciones de garantía <span className="muted">(opcional)</span></label>
                  <textarea className="input" rows={2} style={{width:'100%', fontSize:12.5, resize:'vertical'}}
                    placeholder="Ej: Cubre defectos de fábrica. Excluye daños por humedad o mal uso."
                    value={nuevaGarantiaCond} onChange={e=>setNuevaGarantiaCond(e.target.value)}/>
                </div>
              </div>}

              {err && (
                <div style={{marginTop:12, padding:'8px 12px', background:'#fee2e2', borderRadius:6, color:'#b91c1c', fontSize:12.5}}>
                  {err}
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>{readOnly ? 'Cerrar' : 'Cancelar'}</button>
          {!readOnly && (
            <button className="btn primary" onClick={guardar} disabled={saving || loading}>
              <Icon name="check" size={14}/>{saving ? 'Guardando...' : `Guardar (${seleccion.length}/${totalQty})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ====================== Modal selección moneda PDF ======================
function PdfModoModal({ doc, onClose, onConfirm, tipoLabel }) {
  const _tipoNombre = tipoLabel || ({ cotizacion:'Cotización', orden:'Orden', factura:'Factura', despacho:'Despacho' }[doc.tipo || doc.estado]) || 'Documento';
  const tasa = window.currentTasa || window.SSData?.tasa || {};
  // Modalidad con la que se creó el documento. El popup permite reimprimir el PDF
  // "como si se hubiese hecho" en cualquiera de las modalidades de pago, sin rehacer
  // la cotización (ej: el cliente pregunta "¿y en paralelo cuánto sería?").
  //
  // 'bcv_fijo' (Nota BCV = BCV exacto SIN cobertura) FALTABA como opción: un documento
  // emitido en Nota BCV no se podía imprimir en su propia modalidad — caía en 'divisas'
  // y salía en dólares. Ahora es una opción más y es el default de esos documentos, que
  // no infla nada (la cobertura es 0 por definición en esta modalidad).
  const modalMap    = { divisas:'divisas', bcv:'bcv', paralelo:'paralelo', bcv_fijo:'bcv_fijo' };
  const currentModo = modalMap[doc.modalidad_pago] || 'divisas';
  const exactModo   = modalMap[doc.modalidad_pago] || null;
  const [modo, setModo] = useState(currentModo);

  // Tasa guardada en el documento (la que estaba vigente al crearlo)
  const docTasaBcv      = Number(doc.tasa_bcv)      || tasa.bcv      || 0;
  const docTasaParalelo = Number(doc.tasa_paralelo)  || tasa.paralelo || 0;
  // Cobertura para BCV+Cobertura: la del doc si ya era BCV, o la vigente del sistema.
  const bcvCob = (doc.modalidad_pago === 'bcv' && Number(doc.cobertura_pct))
    ? Number(doc.cobertura_pct)
    : (Number(tasa.cobertura) || 0);

  function fmtBs(n) { return n ? 'Bs. ' + Number(n).toLocaleString('es-VE', {minimumFractionDigits:2, maximumFractionDigits:2}) : '—'; }

  // Etiqueta legible de la modalidad actual (incluye Nota BCV para bcv_fijo)
  const modalidadActualLabel = ({
    divisas:'Divisas (USD)', bcv:'BCV + Cobertura', bcv_fijo:'Nota BCV (BCV exacto)', paralelo:'Paralelo',
  })[doc.modalidad_pago] || 'Divisas (USD)';

  const opciones = [
    {
      id: 'divisas',
      titulo: 'Divisas (USD)',
      desc: 'Montos solo en dólares — sin bolívares',
      icon: 'dollar',
    },
    {
      id: 'bcv',
      titulo: 'BCV + Cobertura',
      desc: `Montos en Bs. con ${bcvCob}% de cobertura · tasa BCV ${fmtBs(docTasaBcv)}/USD`,
      icon: 'bank',
    },
    {
      // El cliente que no paga hoy: acepta la tasa BCV del día en que pague, así que los
      // bolívares de hoy no le sirven. Pasarle la cotización a "Divisas (USD)" NO es lo
      // mismo — ahí el precio no lleva cobertura y el monto le baja.
      id: 'bcv_usd',
      titulo: 'BCV en dólares',
      desc: `El precio BCV (con ${bcvCob}% de cobertura) expresado en USD · se paga en Bs. a la tasa BCV del día de pago`,
      icon: 'dollar',
    },
    {
      id: 'bcv_fijo',
      titulo: 'Nota BCV',
      desc: `Montos en Bs. a tasa BCV exacta, sin cobertura · ${fmtBs(docTasaBcv)}/USD`,
      icon: 'bank',
    },
    {
      id: 'paralelo',
      titulo: 'Paralelo',
      desc: `Montos en Bs. a tasa paralelo · ${fmtBs(docTasaParalelo)}/USD`,
      icon: 'bank',
    },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{width:460}} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center',flexShrink:0}}>
            <Icon name="download" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">Descargar PDF</h3>
            <div className="small muted">{doc.id} · Elegí la modalidad de pago del PDF</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        <div className="modal-body" style={{display:'flex',flexDirection:'column',gap:8}}>
          {/* Badge: modalidad con la que se creó esta cotización */}
          <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', padding:'9px 12px', background:'var(--bg-sunken)', border:'1px solid var(--border)', borderRadius:8, fontSize:12.5}}>
            <span style={{color:'var(--text-muted)'}}>Modalidad de esta {_tipoNombre.toLowerCase()}:</span>
            <span className="chip blue" style={{fontWeight:700}}>{modalidadActualLabel}</span>
            <span style={{color:'var(--text-muted)', fontSize:11, flexBasis:'100%'}}>Podés reimprimirla en otra modalidad sin rehacerla.</span>
          </div>
          {opciones.map(op => (
            <label key={op.id} onClick={() => setModo(op.id)} style={{
              display:'flex', alignItems:'center', gap:12, padding:'12px 14px',
              border: `2px solid ${modo===op.id ? 'var(--brand)' : 'var(--border)'}`,
              borderRadius:10, cursor:'pointer',
              background: modo===op.id ? 'var(--brand-soft)' : 'var(--bg-elev)',
              transition:'all .15s',
            }}>
              <div style={{width:36,height:36,borderRadius:8,background:modo===op.id?'var(--brand)':'var(--bg-sunken)',color:modo===op.id?'#fff':'var(--text-muted)',display:'grid',placeItems:'center',flexShrink:0,transition:'all .15s'}}>
                <Icon name={op.icon} size={18}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:13,color:modo===op.id?'var(--brand)':'var(--text)', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap'}}>
                  {op.titulo}
                  {op.id === exactModo && <span className="chip green" style={{fontSize:9.5, padding:'1px 6px', fontWeight:700}}>Actual</span>}
                </div>
                <div style={{fontSize:11.5,color:'var(--text-muted)',marginTop:2}}>{op.desc}</div>
              </div>
              <div style={{width:18,height:18,borderRadius:'50%',border:`2px solid ${modo===op.id?'var(--brand)':'var(--border)'}`,background:modo===op.id?'var(--brand)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                {modo===op.id && <div style={{width:7,height:7,borderRadius:'50%',background:'#fff'}}/>}
              </div>
            </label>
          ))}
        </div>

        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose}>Cancelar</button>
          <button className="btn primary" onClick={() => onConfirm(modo)}>
            <Icon name="download" size={14}/>Descargar PDF
          </button>
        </div>
      </div>
    </div>
  );
}

// ====================== Modal: Registrar pago de factura ======================
function RegistrarPagoModal({ doc, cxc, onClose, onPaid }) {
  // Métodos desde el catálogo gestionable (Bancos → "Métodos de pago"), con fallback.
  const METODOS = (window.getMetodosPago?.() || [])
    .filter(m => m.activo !== false)
    .map(m => ({ id: m.codigo, l: m.label, monedas: m.monedas || ['USD','VES'], sin_banco: !!m.sin_banco }));
  const today = window.localDateStr();
  const saldo = (cxc.monto||0) - (cxc.pagado||0);

  // ── Restricción por la MODALIDAD de la factura (idéntica a Cuentas por Cobrar) ──
  // bcv/bcv_fijo → SOLO Bs. a tasa BCV · paralelo → SOLO Bs. a tasa paralelo ·
  // divisas → USD (o, opcionalmente, Bs. a tasa paralelo, igual que CxC).
  const modalidad  = doc?.modalidad_pago || cxc?.modalidad_pago || 'divisas';
  const esBcv      = modalidad === 'bcv' || modalidad === 'bcv_fijo';
  const esParalelo = modalidad === 'paralelo';
  const esDivisas  = !esBcv && !esParalelo;
  const [modoDivisas, setModoDivisas] = useState('usd'); // 'usd' | 'paralelo' (solo divisas)
  const monedaForzada = (esBcv || esParalelo) ? 'VES' : (modoDivisas === 'paralelo' ? 'VES' : 'USD');

  // ── Pago que ENTRÓ un día anterior ────────────────────────────────────────────────────────
  // Pedido del negocio: hay pagos que el cliente hizo el lunes y acá se registran el jueves.
  // Cobrarlos a la tasa del jueves descuadra la caja contra lo que de verdad salió del banco del
  // cliente. Al marcarlo se eligen los últimos días CON tasa y se usa la de ESE día.
  //
  // Elegir un día cambia DOS cosas juntas —la tasa y la fecha del pago— a propósito: son el mismo
  // hecho. Un pago fechado hoy pero valuado al lunes es exactamente la incoherencia que esto viene
  // a resolver.
  // La carga de los días vive en `window.SelectorTasaPrevia` (core.jsx); acá solo el estado que el
  // padre necesita poder deshacer (mover la fecha a mano, cambiar a cobro en dólares).
  const [usarTasaPrevia, setUsarTasaPrevia] = useState(false);
  const [diaElegido, setDiaElegido]         = useState(null);

  // Tasa de una línea EN BOLÍVARES según la modalidad. Es independiente de la moneda global
  // porque un cobro puede tener líneas en las dos monedas (100 en efectivo USD + 100 por pago
  // móvil en Bs): si dependiera del toggle global, la línea en Bs se convertiría a tasa 1.
  const tasaDeHoy = esParalelo ? (SSData.tasa?.paralelo || 1)
                  : esBcv      ? (SSData.tasa?.bcv      || 1)
                  : (SSData.tasa?.paralelo || 1);   // divisas cobrada en Bs → paralelo
  // De la fila del día se toma la tasa QUE CORRESPONDE A LA MODALIDAD, no siempre el BCV: cobrar
  // una factura en paralelo con el BCV de ese día sería cobrar de menos.
  const tasaDelDia = (d) => (esParalelo ? d?.paralelo : esBcv ? d?.bcv : d?.paralelo);
  const tasaPrevia = diaElegido ? tasaDelDia(diaElegido) : null;
  // Ojo con el nombre: `tasaModalidad` es la tasa de las líneas EN BOLÍVARES. Una línea en USD
  // convierte con 1 — eso lo resuelve `tasaDe(l)`, no este valor.
  const tasaModalidad = (tasaPrevia != null && tasaPrevia > 0) ? tasaPrevia : tasaDeHoy;
  const modalidadLabel = esBcv ? 'BCV' : esParalelo ? 'Paralelo' : 'Divisas (USD)';
  // El nombre de la tasa que se está eligiendo, para no rotular "BCV" un valor que es paralelo.
  const nombreTasa = esBcv ? 'BCV' : 'paralelo';

  function toggleTasaPrevia(on) {
    setUsarTasaPrevia(on);
    if (!on) { setDiaElegido(null); setFecha(today); }
  }
  // Elegir el día fija la tasa Y la fecha, y re-sugiere el monto en bolívares (el que estaba
  // calculado con la tasa de hoy ya no corresponde).
  function elegirDia(d, t) {
    if (!(t > 0)) return;
    setDiaElegido(d);
    setFecha(d.dia);
    setLineas(prev => prev.map((l, i) => i === 0 ? { ...l, monto: montoSugerido(monedaForzada, t) } : l));
  }
  // Métodos válidos para una moneda: según monedas[] de cada método (catálogo gestionable).
  const metodosDispDe = (mon) => METODOS.filter(m => (m.monedas || ['USD','VES']).includes(mon));
  const metodosDisp   = metodosDispDe(monedaForzada);

  const bancos    = (SSData.cuentasBancarias||[]);
  const bancosDe  = (mon) => bancos.filter(b => mon==='USD' ? b.moneda!=='VES' : b.moneda==='VES');
  const bancosDisp = bancosDe(monedaForzada);

  // Métodos que OFRECE un banco (∩ los permitidos por la moneda). Sin banco → efectivo.
  // Si el banco no tiene métodos configurados, se permiten todos los de la moneda.
  // `mon` se pasa explícito al alternar moneda (evita leer un metodosDisp stale).
  function metodosDeBanco(bancoNombre, mon) {
    const moneda = mon || monedaForzada;
    const md = metodosDispDe(moneda);
    if (!bancoNombre) return md.filter(m => m.sin_banco);   // sin banco → solo métodos "sin banco" (efectivo)
    // Desambiguar por moneda: dos cuentas pueden compartir nombre (ej. Banesco USD/VES).
    const b = bancos.find(x => x.banco === bancoNombre && (moneda==='USD' ? x.moneda!=='VES' : x.moneda==='VES'));
    const ids = (b?.metodos_pago && b.metodos_pago.length) ? b.metodos_pago : null;
    const lista = md.filter(m => !m.sin_banco && (ids ? ids.includes(m.id) : true));
    return lista.length ? lista : md.filter(m => !m.sin_banco);
  }

  function montoSugerido(mon, rate) {
    if (!(saldo > 0)) return '';
    return mon === 'VES' ? (saldo * rate).toFixed(2) : saldo.toFixed(2);
  }
  function emptyLinea() {
    const banco  = bancosDisp[0]?.banco || '';
    const metodo = metodosDeBanco(banco)[0]?.id || 'efectivo';
    return { _k: Date.now()+Math.random(), metodo, banco, moneda: monedaForzada,
             monto: montoSugerido(monedaForzada, tasaModalidad), referencia:'', notas:'' };
  }

  const [fecha,   setFecha]   = useState(today);
  const [lineas,  setLineas]  = useState([emptyLinea()]);
  const [errores, setErrores] = useState({});
  const [saving,  setSaving]  = useState(false);

  // ── PAGO MIXTO: la moneda es POR LÍNEA ────────────────────────────────────────────────────
  // "Me pagaron 200: 100 en efectivo y 100 por pago móvil" son dos bancos, dos formas y —lo que
  // faltaba— DOS MONEDAS. Antes el selector de moneda era global y cambiaba todas las líneas a la
  // vez, así que ese cobro no se podía registrar de una: había que partirlo en dos cobros y la
  // factura quedaba con dos abonos que no reflejaban la operación real.
  //
  // MEZCLAR SE PUEDE EN TODAS LAS NOTAS, no solo en `divisas`. Antes bcv/paralelo forzaban Bs. en
  // todas las líneas "por regla de negocio", y eso NO es lo que pasa en el mostrador. Jorge, en la
  // llamada del 2026-08-11: "en todas las notas hay que tener el pago mixto en todas". Amanda,
  // explicando por qué: "acá casi no hay billetes de un dólar ni monedas, así que todo lo que no
  // sea una cifra redonda se paga en bolívares a la tasa del día; la cuenta nunca da redonda,
  // siempre queda un remanente en Bs.". Sus dos notas de Pettit son BCV, así que la restricción
  // pegaba justo en el caso que reportó.
  //
  // La modalidad sigue mandando en el DEFAULT de cada línea (`monedaForzada`) y en la tasa con la
  // que se convierte a USD; lo que deja de hacer es prohibir la otra moneda. Un billete de $10
  // contra una nota BCV son $10 de deuda menos: no hay tasa que aplicar ni nada que se distorsione.
  const monedaDe = (l) => l?.moneda || monedaForzada;
  const tasaDe   = (l) => (monedaDe(l) === 'VES' ? tasaModalidad : 1);
  // A CENTAVOS. `45.402,00 Bs / 756,7` da 59,99999999999999, no 60: sin redondear, un cobro que
  // salda la factura exacta dejaba la cuenta en 'parcial' con saldo 0,00 mientras el historial
  // mostraba $60,00 (ver ssRound2/ssSaldada en supabase.js). No es un caso de borde: el monto en
  // bolívares se sugiere como `saldo × tasa` redondeado, así que la vuelta casi nunca cae exacta.
  function lineaToUSD(l) {
    const n = parseFloat(l.monto) || 0;
    return monedaDe(l) === 'VES' ? window.ssRound2(n / (tasaDe(l) || 1)) : window.ssRound2(n);
  }
  // ¿Hay líneas en las dos monedas? Se avisa en el resumen: un cobro mixto conviene revisarlo.
  const esMixto = new Set(lineas.map(monedaDe)).size > 1;
  // Con moneda por linea ya no hay una sola 'moneda del cobro'. Para lo que necesita UNA (los
  // anticipos, que se ofrecen en la moneda en que entraron) se usa la de la primera linea; para
  // lo que necesita saber si hay bolivares (el selector de tasa del dia anterior), si HAY alguna.
  const monedaCobro = monedaDe(lineas[0] || {});
  const hayLineaVES = lineas.some(l => monedaDe(l) === 'VES');

  // ── Anticipos del cliente ─────────────────────────────────────────────────────────────────
  // Este modal es el que usa el vendedor para cobrar la factura sin salir del POS, y era el único
  // de los dos caminos de cobro que NO ofrecía el saldo a favor: cobrar de nuevo sin descontarlo
  // es cobrarle dos veces al cliente. Cuentas por Cobrar ya lo tenía; acá se replica con el mismo
  // criterio de moneda (un anticipo en bolívares no salda un cobro en dólares: la conversión ya
  // ocurrió a la tasa del anticipo, y mezclarlas inventa plata).
  const clienteIdCobro = cxc?.cliente || cxc?.cliente_id || doc?.cliente_id || null;
  const [antVersion, setAntVersion]     = useState(0);
  // Cuánto de cada vuelto se aplica (vacío = el tope). Pedido en la llamada: poder aplicar solo
  // una parte y dejar el resto como crédito.
  const [vueltoMonto, setVueltoMonto]   = useState({});
  const [destinoExcedente, setDestinoExcedente] = useState('anticipo'); // 'anticipo' | 'vuelto'
  const [antAplicando, setAntAplicando] = useState('');
  const [antError, setAntError]         = useState('');
  const [antHecho, setAntHecho]         = useState('');
  useEffect(() => {
    // Los anticipos no viajan en la carga inicial: se piden al abrir, una vez.
    if (Array.isArray(SSData.anticipos)) return;
    window.loadAnticipos?.().then(() => setAntVersion(v => v + 1));
  }, []);
  // Un crédito en DÓLARES vale para cualquier cobro (la deuda de `cuentas_cobrar` está en USD y
  // `aplicar_anticipo` descuenta en USD: es restar dólares a dólares, sin tasa de por medio). Uno
  // en BOLÍVARES congeló su tasa al entrar, así que solo salda un cobro en bolívares. La condición
  // era simétrica y por eso escondía los saldos en dólares al cobrar una nota BCV — el muro que
  // reportó Jorge el 2026-08-11. Espejo de `creditoAplicable` en business.jsx: al cambiar una,
  // cambiar la otra.
  const creditoAplicable = React.useCallback((c) => {
    const moneda = c.moneda || 'USD';
    if (moneda !== 'VES') return true;
    return monedaCobro === 'VES' && (parseFloat(c.tasa) || 0) > 0;
  }, [monedaCobro]);

  const anticiposDisp = React.useMemo(() => {
    if (!clienteIdCobro) return [];
    return (SSData.anticipos || []).filter(a =>
      a.cliente_id === clienteIdCobro &&
      (parseFloat(a.saldo_usd) || 0) > 0.005 &&
      creditoAplicable(a));
  }, [clienteIdCobro, creditoAplicable, antVersion, SSData.anticipos]);

  // Vueltos pendientes del cliente: plata que ya es suya porque pagó de más. Usarlos los pasa a
  // saldo a favor y los aplica a esta factura. Ver migracion-odoo/49.
  const vueltosDisp = React.useMemo(() => {
    if (!clienteIdCobro) return [];
    return (SSData.cuentasPagar || []).filter(c =>
      c.tipo === 'vuelto' &&
      (c.cliente_id || c.cliente) === clienteIdCobro &&
      ((parseFloat(c.monto) || 0) - (parseFloat(c.pagado) || 0)) > 0.005 &&
      creditoAplicable(c));
  }, [clienteIdCobro, creditoAplicable, antVersion, SSData.cuentasPagar]);
  const saldoVuelto = (v) => Math.round(((parseFloat(v.monto) || 0) - (parseFloat(v.pagado) || 0)) * 100) / 100;

  // Pasar el vuelto a saldo a favor y aplicarlo, en un clic. Dos pasos atómicos: si falla el
  // segundo queda un saldo a favor sin aplicar, que es un estado válido y que este mismo modal
  // vuelve a ofrecer. Al revés —aplicar sin dar de baja el vuelto— sería contar la plata dos veces.
  async function aplicarVueltoAcá(v, montoPedido) {
    setAntError(''); setAntHecho('');
    const monto = Math.round(Math.min(montoPedido, saldoVuelto(v), (cxc?.monto || 0) - (cxc?.pagado || 0)) * 100) / 100;
    if (monto <= 0.005) { setAntError('No queda saldo por cobrar en esta factura.'); return; }
    setAntAplicando(v.id);
    const { data, error } = await window.vueltoASaldoAFavor({ vueltoId: v.id, monto });
    if (error) { setAntAplicando(''); setAntError('No se pudo usar el vuelto: ' + (error.message || String(error))); return; }
    setAntAplicando('');
    await aplicarAnticipoAcá({ pago_id: data.pago_id, saldo_usd: data.monto_usd,
                               moneda: data.moneda, tasa: data.tasa }, monto);
  }
  const saldoAFavor = clienteIdCobro ? (window.getSaldoAnticipos?.(clienteIdCobro) || 0) : 0;
  const antVista = (a) => (parseFloat(a.saldo_usd) || 0) * (parseFloat(a.tasa) || 0);

  // `montoPedido` deja aplicar MENOS que el tope y que el resto siga a favor del cliente. Sin él
  // el saldo a favor se iba entero siempre: no había forma de usar 35 de 70 y dejarle los otros 35.
  async function aplicarAnticipoAcá(a, montoPedido) {
    setAntError(''); setAntHecho('');
    const facturaId = cxc?.factura || doc?.id;
    if (!facturaId) { setAntError('No se pudo identificar la factura.'); return; }
    const tope  = Math.min(parseFloat(a.saldo_usd) || 0, (cxc.monto || 0) - (cxc.pagado || 0));
    const monto = Math.round(Math.min(montoPedido == null ? tope : montoPedido, tope) * 100) / 100;
    if (monto <= 0.005) { setAntError('No queda saldo por cobrar en esta factura.'); return; }
    setAntAplicando(a.pago_id);
    const { error } = await window.aplicarAnticipo({ pagoId: a.pago_id, documentoId: facturaId, monto,
                                                     notas: 'Aplicado al cobrar desde el POS' });
    setAntAplicando('');
    if (error) { setAntError('No se pudo aplicar: ' + (error.message || String(error))); return; }
    // La RPC ya bajó la deuda en la base. Se refleja en memoria para que el saldo y el monto
    // sugerido se recalculen sin cerrar el modal.
    cxc.pagado = Math.min(cxc.monto, (cxc.pagado || 0) + monto);
    if (window.ssSaldada(cxc.pagado, cxc.monto)) cxc.estado = 'pagada';
    const resta = Math.max(0, (cxc.monto || 0) - (cxc.pagado || 0));
    setAntHecho(`Se aplicaron ${fmt.usd(monto)} del anticipo. ` +
      (resta > 0.005 ? `Queda por cobrar ${fmt.usd(resta)}.` : 'La factura queda saldada.'));
    setAntVersion(v => v + 1);
    setLineas(prev => prev.map((l, i) => i === 0
      // Con la moneda de ESA línea, no la global: si la línea está en Bs, re-sugerir en dólares
      // le deja un número cientos de veces más chico sin decir nada.
      // Se usa `resta` (recalculado recién) y no `montoSugerido`, que cierra sobre el `saldo` del
      // render — para este punto ya está viejo, porque acabamos de aplicar el anticipo.
      ? { ...l, monto: resta > 0.005
            ? (monedaDe(l) === 'VES' ? (resta * (tasaDe(l) || 1)).toFixed(2) : resta.toFixed(2))
            : '' }
      : l));
  }

  // Venta a crédito (términos != 'inmediato'): permite elegir explícitamente abono parcial,
  // pago total, o dejar la factura a crédito (sin registrar pago; la CxC queda pendiente).
  const esCredito = !!(doc?.terminos_pago && doc.terminos_pago !== 'inmediato');
  const [modoCredito, setModoCredito] = useState(esCredito ? 'credito' : 'total'); // 'total' | 'abono' | 'credito'
  function cambiarModoCredito(m) {
    setModoCredito(m); setErrores({});
    if (m === 'total')      setLineas(prev => prev.map((l,i) => i===0 ? { ...l, monto: montoSugerido(monedaDe(l), tasaDe(l)) } : l));
    else if (m === 'abono') setLineas(prev => prev.map((l,i) => i===0 ? { ...l, monto: '' } : l));
  }
  function dejarACredito() {
    window.logActivity?.({ modulo:'documentos', accion:'a_credito', entidad_id:doc.id, entidad_label:doc.id, detalles:{ cxc_id:cxc.id, saldo, vence:cxc.vence } });
    onClose();
  }

  function bancoRequerido(m) { return !METODOS.find(x => x.id === m)?.sin_banco; }


  const totalUSD = lineas.reduce((s,l) => s + lineaToUSD(l), 0);
  const aplicar  = Math.min(saldo, totalUSD);
  // ── PAGÓ DE MÁS ────────────────────────────────────────────────────────────────────────────
  // El monto se recortaba al saldo y el sobrante DESAPARECÍA: se avisaba "se aplican $X" y nada
  // más. Reportado el 2026-08-11: una factura en divisas con retención quedaba en $296,70, el
  // cliente pagaba $300 y no había forma de que esos $3,30 quedaran como vuelto. Cuentas por
  // Cobrar ya lo resolvía; este camino —cobrar la factura desde el POS— no.
  // Mismo criterio que allá: por defecto queda A FAVOR del cliente (casi siempre tiene otra nota),
  // y devolverlo en efectivo es la excepción explícita.
  const excedente = window.ssRound2 ? window.ssRound2(totalUSD - saldo) : Math.round((totalUSD - saldo) * 100) / 100;
  const hayExcedente = excedente > 0.005 && saldo > 0;

  function upd(i, k, v) {
    setLineas(prev => prev.map((l,idx) => idx === i ? { ...l, [k]: v } : l));
  }

  // Solo divisas: al alternar USD↔Bs, re-sugerir el monto y resetear banco/método
  // (los bancos disponibles cambian con la moneda).
  // El toggle GLOBAL de moneda se reemplazó por uno POR LÍNEA (`cambiarMonedaLinea`): cambiar la
  // moneda de todas las líneas a la vez es justamente lo que impedía registrar un cobro mixto.

  // Al elegir un banco, el método se restringe a los que ofrece ese banco.
  function cambiarBanco(i, banco) {
    setLineas(prev => prev.map((l, idx) => {
      if (idx !== i) return l;
      const ids = metodosDeBanco(banco, monedaDe(l)).map(m => m.id);
      return { ...l, banco, metodo: ids.includes(l.metodo) ? l.metodo : (ids[0] || 'efectivo') };
    }));
  }

  // Cambiar la moneda de UNA línea: el banco y el método de la anterior casi nunca sirven (una
  // cuenta en Bs no recibe dólares), así que se reeligen. El monto se limpia en vez de convertirse:
  // el usuario está tipeando lo que dice un comprobante concreto, y convertirle el número que
  // acaba de escribir es peor que pedirle que lo escriba de nuevo.
  function cambiarMonedaLinea(i, mon) {
    setLineas(prev => prev.map((l, idx) => {
      if (idx !== i) return l;
      const banco0  = bancosDe(mon)[0]?.banco || '';
      const metodo0 = metodosDeBanco(banco0, mon)[0]?.id || 'efectivo';
      return { ...l, moneda: mon, banco: banco0, metodo: metodo0, monto: '' };
    }));
  }

  function validar() {
    const errs = {};
    lineas.forEach((l,i) => {
      if (!(parseFloat(l.monto) > 0))              errs[`${i}_monto`] = 'Ingresa el monto';
      if (bancoRequerido(l.metodo) && !l.banco.trim()) errs[`${i}_banco`] = 'Selecciona el banco';
      // Efectivo (sin banco) no tiene N° de operación → referencia no obligatoria.
      // La referencia NUNCA bloquea (decisión del usuario, 2026-08-11): el N° de operación no
      // siempre está a mano cuando se registra el pago (el cliente lo manda después, el punto lo
      // imprime más tarde), y frenar el cobro por eso obliga a inventar un número — un dato
      // inventado en una columna de conciliación es peor que uno vacío, porque el que lo lea
      // después le va a creer. El banco sí se sigue exigiendo: sin él el movimiento no tiene dónde ir.
    });
    setErrores(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit() {
    if (!validar()) return;
    setSaving(true);
    const pagosNuevos = lineas.map(l => ({
      id:        'PAG-'+Date.now()+'-'+Math.floor(Math.random()*1000),
      fecha,
      metodo:    l.metodo,
      banco:     l.banco,
      referencia:l.referencia,
      monto:     parseFloat(l.monto)||0,
      // La moneda y la tasa son LAS DE LA LÍNEA, no las globales: en un cobro mixto una línea va
      // en USD (tasa 1) y otra en Bs. Con el valor global, la de bolívares se guardaba a tasa 1 y
      // el equivalente en dólares quedaba inflado cientos de veces.
      moneda:    monedaDe(l),
      monto_usd: lineaToUSD(l),
      tasa_usada:tasaDe(l),
      notas:     l.notas,
    }));
    const results = await window.registrarPagosCxC?.([{ cxcId: cxc.id, montoUsd: aplicar, pagosNuevos }]) || [];
    if (results[0]?.error) { setSaving(false); alert('Error al registrar pago: '+(results[0].error.message||JSON.stringify(results[0].error))); return; }

    // El sobrante NO se puede perder: o queda a favor del cliente, o queda como vuelto por
    // devolver. Va DESPUÉS del cobro y su error no lo deshace —el cobro en sí se registró bien—,
    // pero se dice exactamente qué faltó en vez de cerrar el modal como si todo hubiera salido.
    if (hayExcedente) {
      const clienteId = clienteIdCobro;
      let exErr = null;
      if (!clienteId) {
        exErr = { message: 'no se pudo determinar el cliente de esta factura' };
      } else if (destinoExcedente === 'vuelto' && window.crearVueltoCliente) {
        const r = await window.crearVueltoCliente({
          clienteId, monto: excedente,
          concepto: 'Vuelto por sobrepago en ' + (cxc.factura || doc.id),
          pagoOrigenId: pagosNuevos[0]?.id || null,
        });
        exErr = r?.error || null;
      } else if (window.crearAnticipo) {
        // SIN `cuentaBancariaId`: la plata YA entró al banco con el movimiento de ESTE cobro.
        // Pasarlo crearía un segundo ingreso y el saldo del banco quedaría inflado.
        const r = await window.crearAnticipo({
          clienteId, monto: excedente, montoUsd: excedente, moneda: 'USD', tasa: null,
          metodo: pagosNuevos[0]?.metodo || null, banco: null, cuentaBancariaId: null,
          fecha: pagosNuevos[0]?.fecha || fecha,
          referencia: pagosNuevos[0]?.referencia || null,
          notas: 'Saldo a favor por sobrepago en ' + (cxc.factura || doc.id),
        });
        exErr = r?.error || null;
      }
      if (exErr) {
        setSaving(false);
        alert('El cobro se registró bien, pero no se pudo dejar ' + fmt.usd(excedente) +
              (destinoExcedente === 'vuelto' ? ' como vuelto: ' : ' a favor del cliente: ') +
              (exErr.message || JSON.stringify(exErr)));
        onPaid(); onClose();
        return;
      }
      window.logActivity?.({ modulo: destinoExcedente === 'vuelto' ? 'cxp' : 'cxc', accion:'crear',
        entidad_id: cxc.id, entidad_label: cxc.factura || doc.id,
        detalles:{ tipo: destinoExcedente === 'vuelto' ? 'vuelto' : 'saldo_a_favor', monto: excedente } });
    }
    setSaving(false);
    window.logActivity?.({ modulo:'documentos', accion:'pago_registrado', entidad_id:doc.id, entidad_label:doc.id,
      detalles:{ cxc_id:cxc.id, monto_usd:aplicar, metodos: lineas.map(l=>l.metodo) } });
    onPaid();
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{maxWidth:520, width:'100%'}} onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <strong>Registrar pago — {doc.id}</strong>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body" style={{display:'flex',flexDirection:'column',gap:14}}>

          {/* CxC summary */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,padding:'10px 12px',background:'var(--bg-sunken)',borderRadius:8,fontSize:12.5}}>
            <div><div className="muted" style={{fontSize:11,marginBottom:2}}>Total</div><strong>{fmt.usd(cxc.monto)}</strong></div>
            <div><div className="muted" style={{fontSize:11,marginBottom:2}}>Cobrado</div><strong style={{color:'var(--success)'}}>{fmt.usd(cxc.pagado||0)}</strong></div>
            <div><div className="muted" style={{fontSize:11,marginBottom:2}}>Saldo</div><strong style={{color:saldo>0?'var(--danger)':'var(--success)'}}>{fmt.usd(saldo)}</strong></div>
          </div>

          {/* Modalidad de la factura: restringe en qué moneda se puede pagar (igual que CxC). */}
          <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', padding:'8px 12px', background: esDivisas ? 'var(--brand-soft)' : 'var(--warn-soft,#fef3c7)', border:'1px solid', borderColor: esDivisas ? 'var(--brand)' : 'var(--warn)', borderRadius:8, fontSize:12.5}}>
            <span style={{color:'var(--text-muted)'}}>Modalidad:</span>
            <span className="chip" style={{fontWeight:700, background: esDivisas ? 'var(--brand-soft)' : 'var(--warn-soft,#fef3c7)', color: esDivisas ? 'var(--brand)' : '#92400e'}}>{modalidadLabel}</span>
            <span style={{color:'var(--text-muted)', fontSize:11, flexBasis:'100%'}}>
              {esDivisas
                ? 'Se cobra en USD, y lo que entre en Bs. va a tasa paralelo. Se puede repartir entre varias formas de pago.'
                : `Lo que entre en Bs. va a tasa ${modalidadLabel} (${tasaModalidad}); lo que entre en dólares se descuenta tal cual. Se puede repartir entre varias formas de pago.`}
            </span>
          </div>

          {/* ── El pago entró un día anterior ────────────────────────────────────────────
              Solo tiene sentido cobrando en bolívares: en dólares no hay tasa que elegir.
              El componente vive en core.jsx porque Cuentas por Cobrar usa el mismo. */}
          {hayLineaVES && window.SelectorTasaPrevia && (
            <window.SelectorTasaPrevia
              usar={usarTasaPrevia} onUsar={toggleTasaPrevia}
              diaElegido={diaElegido} onElegir={elegirDia}
              tasaDelDia={tasaDelDia} nombreTasa={nombreTasa}
              tasaHoy={tasaDeHoy} saldoUsd={saldo}/>
          )}

          {/* ── Saldo a favor del cliente ─────────────────────────────────────────────────
              Si ya dejó plata adelantada, lo primero es usarla: cobrarle otra vez sin descontarla
              es cobrarle dos veces. Solo se ofrecen los anticipos en la MISMA moneda del cobro. */}
          {saldoAFavor > 0.005 && (
            <div style={{border:'1px solid var(--success)', borderRadius:8, overflow:'hidden'}}>
              <div style={{padding:'8px 12px', background:'var(--success-soft,#dcfce7)', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                <Icon name="cash" size={14} style={{color:'var(--success)'}}/>
                <span style={{fontWeight:600, fontSize:12.5, color:'var(--success)'}}>
                  Este cliente tiene {fmt.usd(saldoAFavor)} a favor en anticipos
                </span>
              </div>
              <div style={{padding:'10px 12px', display:'flex', flexDirection:'column', gap:8}}>
                {anticiposDisp.length === 0 ? (
                  <div className="small muted">
                    Su saldo a favor entró en bolívares y quedó valuado a la tasa de ese día, así que solo puede saldar un cobro en bolívares. Para usarlo, poné una línea en Bs. o aplicalo desde Finanzas → Anticipos.
                  </div>
                ) : anticiposDisp.map(a => {
                  // Se puede aplicar MENOS que el tope y dejar el resto a favor: "tengo 70 a
                  // favor, esta nota es de 80, le aplico 35 y le dejo 35".
                  const topeAnt   = Math.round(Math.min(parseFloat(a.saldo_usd) || 0, saldo) * 100) / 100;
                  const tecleadoA = vueltoMonto[a.pago_id];
                  const aplicable = (tecleadoA === '' || tecleadoA == null || isNaN(parseFloat(tecleadoA)))
                                    ? topeAnt : Math.min(Math.max(parseFloat(tecleadoA), 0), topeAnt);
                  return (
                    <div key={a.pago_id} style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
                                                 padding:'8px 10px', border:'1px solid var(--border)', borderRadius:8, background:'var(--bg-elev)'}}>
                      {/* En SU moneda, no en la del cobro: un anticipo en dólares mostrado con
                          `saldo_usd × tasa` daba "Bs. 0,00" (su tasa es NULL, no la necesita). */}
                      <div style={{flex:1, minWidth:160}}>
                        <div style={{fontSize:12.5, fontWeight:600}}>
                          {(a.moneda || 'USD') === 'VES' ? fmt.bs(antVista(a)) : fmt.usd(parseFloat(a.saldo_usd) || 0)}
                          {(a.moneda || 'USD') === 'VES' && <span className="muted" style={{fontWeight:400}}> ({fmt.usd(parseFloat(a.saldo_usd) || 0)} @ {a.tasa})</span>}
                        </div>
                        <div className="small muted">{a.fecha} · {a.referencia || a.metodo || 'anticipo'}</div>
                      </div>
                      {/* `ss-credito-monto` lo distingue del monto del PAGO: los dos son
                          `input[type=number]` y este va más arriba en el DOM. */}
                      <input className="input ss-credito-monto" type="number" step="0.01" min="0" max={topeAnt}
                             style={{width:92, textAlign:'right'}} placeholder={topeAnt.toFixed(2)}
                             value={tecleadoA ?? ''}
                             onChange={e => setVueltoMonto(pv => ({ ...pv, [a.pago_id]: e.target.value }))}/>
                      <button className="btn secondary sm" disabled={!!antAplicando || aplicable <= 0.005}
                              onClick={() => aplicarAnticipoAcá(a, aplicable)}
                              title={`Aplicar ${fmt.usd(aplicable)} a esta factura`}>
                        {antAplicando === a.pago_id ? 'Aplicando…' : `Aplicar ${fmt.usd(aplicable)}`}
                      </button>
                    </div>
                  );
                })}
                {antError && <div className="small" style={{color:'var(--danger)'}}>{antError}</div>}
                {antHecho && <div className="small" style={{color:'var(--success)'}}>{antHecho}</div>}
              </div>
            </div>
          )}

          {/* ── Vuelto pendiente del cliente ───────────────────────────────────────────────
              Pagó de más en otra nota y ese excedente quedó para devolvérselo. En vez de
              devolverlo se puede descontar de esta factura; lo que no se aplique sigue como
              vuelto. Se puede elegir cuánto. */}
          {vueltosDisp.length > 0 && (
            <div style={{border:'1px solid var(--success)', borderRadius:8, overflow:'hidden'}}>
              <div style={{padding:'8px 12px', background:'var(--success-soft,#dcfce7)', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                <Icon name="cash" size={14} style={{color:'var(--success)'}}/>
                <span style={{fontWeight:600, fontSize:12.5, color:'var(--success)'}}>
                  Tiene {fmt.usd(vueltosDisp.reduce((s,v)=>s+saldoVuelto(v), 0))} de vuelto pendiente
                </span>
              </div>
              <div style={{padding:'10px 12px', display:'flex', flexDirection:'column', gap:8}}>
                {vueltosDisp.map(v => {
                  const tope = Math.round(Math.min(saldoVuelto(v), saldo) * 100) / 100;
                  const tecleado = vueltoMonto[v.id];
                  const aplica = (tecleado === '' || tecleado == null || isNaN(parseFloat(tecleado)))
                                 ? tope : Math.min(Math.max(parseFloat(tecleado), 0), tope);
                  return (
                    <div key={v.id} style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
                                            padding:'8px 10px', border:'1px solid var(--border)', borderRadius:8, background:'var(--bg-elev)'}}>
                      <div style={{flex:1, minWidth:150}}>
                        <div style={{fontSize:12.5, fontWeight:600}}>{fmt.usd(saldoVuelto(v))}</div>
                        <div className="small muted">{v.concepto || 'Vuelto por sobrepago'}</div>
                      </div>
                      <input className="input ss-credito-monto" type="number" step="0.01" min="0" max={tope}
                             style={{width:92, textAlign:'right'}} placeholder={tope.toFixed(2)}
                             value={tecleado ?? ''}
                             onChange={e => setVueltoMonto(pv => ({ ...pv, [v.id]: e.target.value }))}/>
                      <button className="btn secondary sm" disabled={!!antAplicando || aplica <= 0.005}
                              onClick={() => aplicarVueltoAcá(v, aplica)}
                              title={`Descontar ${fmt.usd(aplica)} de esta factura`}>
                        {antAplicando === v.id ? 'Aplicando…' : `Usar ${fmt.usd(aplica)}`}
                      </button>
                    </div>
                  );
                })}
                {antError && <div className="small" style={{color:'var(--danger)'}}>{antError}</div>}
                {antHecho && <div className="small" style={{color:'var(--success)'}}>{antHecho}</div>}
              </div>
            </div>
          )}

          {/* Modo de registro cuando la venta es a crédito */}
          {esCredito && (
            <div style={{display:'flex',flexDirection:'column',gap:6,padding:'10px 12px',background:'var(--bg-sunken)',borderRadius:8}}>
              <span style={{fontSize:11.5,color:'var(--text-muted)'}}>Venta a crédito · vence {cxc.vence || '—'} — ¿cómo lo registrás?</span>
              <div className="seg" style={{border:'none',gap:4,flexWrap:'wrap'}}>
                <button className={modoCredito==='abono'?'on':''} style={{fontSize:12,padding:'5px 12px'}} onClick={()=>cambiarModoCredito('abono')}>Abono parcial</button>
                <button className={modoCredito==='total'?'on':''} style={{fontSize:12,padding:'5px 12px'}} onClick={()=>cambiarModoCredito('total')}>Pago total</button>
                <button className={modoCredito==='credito'?'on':''} style={{fontSize:12,padding:'5px 12px'}} onClick={()=>cambiarModoCredito('credito')}>Dejar a crédito</button>
              </div>
            </div>
          )}

          {modoCredito === 'credito' ? (
            /* A crédito: sin pago ahora, la CxC queda pendiente al vencimiento */
            <div style={{padding:'12px 14px',background:'var(--warn-soft,#fef3c7)',border:'1px solid var(--warn)',borderRadius:8,fontSize:12.5,color:'#92400e'}}>
              No se registra pago ahora. La factura <strong>{doc.id}</strong> queda <strong>a crédito</strong> por {fmt.usd(saldo)}, con vencimiento el <strong>{cxc.vence || '—'}</strong>. Registrás el abono cuando el cliente pague.
            </div>
          ) : (
          <>
          {/* Fecha */}
          <div>
            <label className="field-label">Fecha del pago</label>
            <input type="date" className="input" value={fecha} style={{width:180}}
                   onChange={e => {
                     setFecha(e.target.value);
                     // Mover la fecha a mano deshace la elección del día: si no, quedaría un pago
                     // fechado en un día y valuado a la tasa de otro, que es justo la incoherencia
                     // que esta función viene a evitar.
                     if (diaElegido && e.target.value !== diaElegido.dia) {
                       setDiaElegido(null); setUsarTasaPrevia(false);
                     }
                   }}/>
            {diaElegido && (
              <div className="small" style={{fontSize:11, color:'#92400e', marginTop:3}}>
                Fecha tomada del día elegido arriba.
              </div>
            )}
          </div>

          {/* Líneas de pago */}
          {lineas.map((l,i) => {
            // Bancos y métodos de LA LÍNEA, según SU moneda: un pago móvil (Bs) no puede
            // ofrecerse en una línea en dólares, ni al revés.
            const monLinea     = monedaDe(l);
            const bancosLinea  = bancosDe(monLinea);
            const metodosLinea = metodosDeBanco(l.banco, monLinea);
            const soloEfectivo = !l.banco;  // sin banco → efectivo
            return (
              <div key={l._k} style={{border:'1px solid var(--border)',borderRadius:8,padding:12,display:'flex',flexDirection:'column',gap:10}}>
                {lineas.length > 1 && (
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span style={{fontSize:12,fontWeight:600,color:'var(--text-muted)'}}>Pago {i+1}</span>
                    <button className="icon-btn" style={{width:22,height:22}} onClick={()=>setLineas(p=>p.filter((_,idx)=>idx!==i))}><Icon name="x" size={13}/></button>
                  </div>
                )}

                {/* Banco — al elegirlo se establecen los métodos que admite ese banco */}
                <div>
                  <label className="field-label">Banco / Cuenta</label>
                  <select className={`input${errores[`${i}_banco`]?' input-error':''}`} value={l.banco} onChange={e=>cambiarBanco(i, e.target.value)}>
                    {/* Pedido explícito (2026-08-14): todo pago va a una cuenta real, incluido el
                        efectivo — ya existe una cuenta "Efectivo"/"Caja" en cada empresa y moneda
                        para eso. Ningún método del catálogo está marcado `sin_banco` (verificado
                        en producción), así que este bucket quedaba seleccionable pero vacío de
                        métodos (`metodosDeBanco('')` solo devuelve métodos `sin_banco`, y no hay
                        ninguno) — un callejón sin salida, no una opción real. */}
                    {!l.banco && <option value="">— Selecciona un banco —</option>}
                    {bancosLinea.map(b => <option key={b.id} value={b.banco}>{b.banco}{b.cuenta?' · '+b.cuenta:''}</option>)}
                  </select>
                  {errores[`${i}_banco`] && <div className="field-error">{errores[`${i}_banco`]}</div>}
                </div>

                {/* Método — restringido a los que OFRECE el banco elegido (sin banco → métodos "sin banco" del catálogo) */}
                <div>
                  <label className="field-label">Método</label>
                  {soloEfectivo && metodosLinea.length === 1 ? (
                    <div style={{fontSize:12.5, padding:'6px 0', fontWeight:600}}>{metodosLinea[0].l}</div>
                  ) : (
                    <div className="seg" style={{border:'none',gap:4, flexWrap:'wrap'}}>
                      {metodosLinea.map(m => (
                        <button key={m.id} className={l.metodo===m.id?'on':''} style={{fontSize:12,padding:'4px 10px'}}
                          onClick={()=>upd(i,'metodo',m.id)}>{m.l}</button>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                  {/* Moneda POR LÍNEA, en TODAS las modalidades — así se puede cobrar 80 en
                      efectivo y los 3 de vuelto en Bs. por pago móvil, en el mismo cobro. El
                      rótulo del botón dice a qué tasa se convierte esa línea, que es lo que
                      cambia según la nota (BCV, paralelo o vuelto). */}
                  <div>
                    <label className="field-label">Moneda</label>
                    <div className="seg" style={{border:'none',gap:4}}>
                      <button className={monedaDe(l)==='USD'?'on':''} style={{fontSize:12,padding:'4px 10px'}}
                              onClick={()=>cambiarMonedaLinea(i,'USD')}>USD $</button>
                      <button className={monedaDe(l)==='VES'?'on':''} style={{fontSize:12,padding:'4px 10px'}}
                              onClick={()=>cambiarMonedaLinea(i,'VES')}
                              title={`Bs. a tasa ${nombreTasa} (${tasaModalidad})`}>
                        Bs. ({nombreTasa})
                      </button>
                    </div>
                  </div>

                  {/* Monto */}
                  <div>
                    <label className="field-label">Monto ({monedaDe(l)==='VES'?'Bs.':'$'})</label>
                    <input type="number" min="0" step="0.01" className={`input${errores[`${i}_monto`]?' input-error':''}`}
                      value={l.monto} onChange={e=>upd(i,'monto',e.target.value)} placeholder="0.00"/>
                    {monedaDe(l)==='VES' && parseFloat(l.monto)>0 && (
                      <div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>
                        ≈ {fmt.usd(lineaToUSD(l))} · tasa {tasaDe(l)}
                      </div>
                    )}
                    {errores[`${i}_monto`] && <div className="field-error">{errores[`${i}_monto`]}</div>}
                  </div>
                </div>

                {/* Referencia (no obligatoria en efectivo: no hay N° de operación) */}
                <div>
                  <label className="field-label">Referencia <span className="muted" style={{fontSize:11}}>(opcional)</span></label>
                  <input className={`input mono${errores[`${i}_ref`]?' input-error':''}`} value={l.referencia}
                    onChange={e=>upd(i,'referencia',e.target.value)} placeholder={soloEfectivo ? 'Opcional' : 'N° operación'}/>
                  {errores[`${i}_ref`] && <div className="field-error">{errores[`${i}_ref`]}</div>}
                </div>

                {/* Notas */}
                <div>
                  <label className="field-label">Notas (opcional)</label>
                  <input className="input" value={l.notas} onChange={e=>upd(i,'notas',e.target.value)} placeholder="Observaciones"/>
                </div>
              </div>
            );
          })}

          <button className="btn ghost sm" style={{alignSelf:'flex-start'}} onClick={()=>setLineas(p=>[...p,emptyLinea()])}>
            <Icon name="plus" size={13}/>Agregar otra forma de pago
          </button>

          {/* Cobro MIXTO: se dice explícitamente, con el desglose por moneda. Un cobro de dos
              monedas se revisa distinto que uno normal, y el total en dólares por sí solo esconde
              que una parte entró en bolívares a una tasa. */}
          {esMixto && (
            <div style={{padding:'9px 12px', borderRadius:8, fontSize:12.5,
                         background:'var(--brand-soft)', border:'1px solid var(--brand)'}}>
              <div style={{fontWeight:600, color:'var(--brand)', marginBottom:3}}>Pago mixto — dos monedas</div>
              {['USD','VES'].map(m => {
                const ls = lineas.filter(l => monedaDe(l) === m);
                if (!ls.length) return null;
                const enMoneda = ls.reduce((s,l) => s + (parseFloat(l.monto) || 0), 0);
                const enUsd    = ls.reduce((s,l) => s + lineaToUSD(l), 0);
                return (
                  <div key={m} style={{display:'flex', justifyContent:'space-between'}}>
                    <span className="muted">
                      {ls.length} {ls.length === 1 ? 'pago' : 'pagos'} en {m === 'VES' ? 'bolívares' : 'dólares'}
                      {m === 'VES' ? ` · tasa ${tasaModalidad}` : ''}
                    </span>
                    <span className="mono">
                      {m === 'VES' ? fmt.bs(enMoneda) : fmt.usd(enMoneda)}
                      {m === 'VES' && <span className="muted"> = {fmt.usd(enUsd)}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Resumen a aplicar */}
          {totalUSD > 0 && (
            <div style={{padding:'10px 12px',background: aplicar>=saldo?'var(--success-soft,#f0fdf4)':'var(--warn-soft,#fffbeb)',borderRadius:8,border:`1px solid ${aplicar>=saldo?'var(--success)':'var(--warn)'}`,fontSize:12.5}}>
              <div style={{display:'flex',justifyContent:'space-between'}}>
                <span>Total a aplicar</span>
                <strong>{fmt.usd(aplicar)}</strong>
              </div>
              {aplicar >= saldo && <div style={{fontSize:11,color:'var(--success)',marginTop:3,fontWeight:600}}>✓ Factura quedará totalmente cobrada</div>}
            </div>
          )}

          {/* ── Pagó de más: a dónde va el sobrante ──────────────────────────────────────────
              Antes acá solo decía "el monto supera el saldo · se aplican $X" y esos centavos no
              iban a ningún lado. Ahora se elige, con el mismo default que Cuentas por Cobrar. */}
          {hayExcedente && (
            <div style={{padding:'11px 13px', border:'1.5px solid var(--warn)', borderRadius:8,
                         background:'var(--warn-soft,#fef3c7)', display:'flex', flexDirection:'column', gap:9}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                <span style={{fontWeight:600, fontSize:12.5, color:'#92400e'}}>Pagó {fmt.usd(excedente)} de más</span>
                <span className="small" style={{color:'#92400e'}}>Se aplican {fmt.usd(saldo)} a la factura</span>
              </div>
              <div className="seg" style={{border:'none', gap:4, flexWrap:'wrap'}}>
                <button className={destinoExcedente === 'anticipo' ? 'on' : ''} style={{fontSize:12, padding:'5px 12px'}}
                        onClick={() => setDestinoExcedente('anticipo')}>Dejar a favor del cliente</button>
                <button className={destinoExcedente === 'vuelto' ? 'on' : ''} style={{fontSize:12, padding:'5px 12px'}}
                        onClick={() => setDestinoExcedente('vuelto')}>Devolver en efectivo</button>
              </div>
              <div className="small" style={{fontSize:11, color:'#92400e'}}>
                {destinoExcedente === 'anticipo'
                  ? 'Queda como saldo a favor y se le puede descontar de cualquier otra nota suya.'
                  : 'Queda registrado como vuelto por devolver. También se puede aplicar después a otra nota.'}
              </div>
            </div>
          )}
          </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          {modoCredito === 'credito' ? (
            <button className="btn primary" onClick={dejarACredito} disabled={saving}>
              <Icon name="check" size={14}/>Dejar a crédito
            </button>
          ) : (
            <button className="btn primary" onClick={handleSubmit} disabled={saving||saldo<=0}>
              <Icon name="check" size={14}/>{saving?'Guardando…':(modoCredito==='abono'?'Registrar abono':'Confirmar pago')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ====================== Vista DETALLE de documento ======================
// ====================== Modal: Nueva Nota de Despacho (posiblemente parcial) ======================
// `reactivarId`: si esta factura tiene un despacho ANULADO reactivable (mismo documento, ver
// window.reactivarDespacho), se pasa su id acá — el modal arma las líneas exactamente igual, solo
// cambia a QUÉ función llama al confirmar.
function NuevoDespachoModal({ factura, lines, onClose, onCreated, reactivarId }) {
  const keyOf = l => (l.id != null ? l.id : l.sku);
  const pendienteDe = l => Math.max(0, (Math.round(l.qty) || 0) - (l.cantidad_despachada || 0));

  // Las líneas se leen de la BD, NO del prop. Lo que se despacha tiene que ser lo que la factura
  // tiene realmente: su id de `documentos_items` y su `cantidad_despachada` al día. El prop podía
  // traer las líneas de otro documento del mismo linaje (las promociones arrastraban las del
  // padre) o quedar viejo si alguien despachó desde otra pantalla — y en los dos casos el
  // problema se descubría recién al confirmar, con la RPC rechazando el id.
  const [dbLines, setDbLines] = useState(null);
  const [qtys, setQtys]       = useState({});
  useEffect(() => {
    let alive = true;
    (async () => {
      const ls = (await window.loadDocumentoItems?.(factura.id)) || [];
      if (!alive) return;
      const reales = ls.filter(l => l.sku && l.sku !== '__SECTION__');
      setDbLines(reales);
      const m = {}; reales.forEach(l => { m[keyOf(l)] = pendienteDe(l); });
      setQtys(m);
    })();
    return () => { alive = false; };
  }, [factura.id]);
  const realLines = dbLines || [];
  const [driverId, setDriverId]       = useState('');
  const [tipoEntrega, setTipoEntrega] = useState(factura.tipo_entrega || 'retiro');
  const [nroDespacho, setNroDespacho] = useState('');
  const [obs, setObs]                 = useState('');
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  const drivers = (SSData.drivers || []).filter(d => d.activo !== false);
  const almId = getAlmacenDefault(factura.almacen_id);
  const almNombre = (SSData.almacenes || []).find(a => a.id === almId)?.nombre || almId;

  function setQty(key, v, max) {
    let n = parseInt(v); if (isNaN(n)) n = 0;
    n = Math.max(0, Math.min(n, max));
    setQtys(prev => ({ ...prev, [key]: n }));
  }
  const totalADespachar = realLines.reduce((s, l) => s + (qtys[keyOf(l)] || 0), 0);
  const lineasPendientes = realLines.filter(l => pendienteDe(l) > 0);

  async function handleConfirm() {
    setError('');
    if (totalADespachar <= 0) { setError('Indicá al menos una unidad para despachar.'); return; }
    setSaving(true);

    const lineasDespacho = realLines
      .map(l => ({ l, cantidad: qtys[keyOf(l)] || 0 }))
      .filter(x => x.cantidad > 0)
      .map(({ l, cantidad }) => ({
        factura_item_id: l.id,
        sku: l.sku, nombre: l.nombre, qty: cantidad,
        precio: l.precio, descuento: l.descuento || 0, descuento_extra: l.descuento_extra || 0,
        subtotal: (l.precio || 0) * cantidad,
        proveedor_id: l.proveedor_id || null, costo: l.costo || 0,
        garantia_meses: l.garantia_meses ?? null, garantia_condiciones: l.garantia_condiciones || null,
      }));

    // Cinturón y tirantes: la RPC exige que cada `factura_item_id` sea una línea DE ESTA factura.
    // Si por cualquier camino llegara una línea sin id numérico, se corta acá con un mensaje
    // entendible en vez de dejar que el error salga del servidor a mitad del despacho.
    const sinId = lineasDespacho.filter(l => !Number.isFinite(l.factura_item_id));
    if (sinId.length) {
      setSaving(false);
      setError('No se pudieron identificar las líneas de la factura (' + sinId.map(l => l.sku).join(', ') +
               '). Recarga la factura e intenta de nuevo.');
      return;
    }

    // Validar stock disponible
    // Fix bug #5: comparar contra disponible real (cantidad - reservado_de_OTROS docs),
    // no contra cantidad cruda, para no sobrevender entre órdenes/facturas. La reserva de
    // ESTE documento sigue viva hasta el despacho, así que la sumamos de vuelta (≈ l.qty).
    const sinStock = lineasDespacho.filter(l => {
      // Un servicio (flete) no tiene existencias — mismo criterio que dispatchFromCompositor.
      if (window.esProductoServicio?.(l.sku)) return false;
      const inv = ((SSData.inventario || {})[l.sku] || {})[almId] || {};
      const cantidad = inv.cantidad ?? 0;
      const reservadoOtros = Math.max(0, (inv.reservado ?? 0) - l.qty);
      return (cantidad - reservadoOtros) < l.qty;
    });
    if (sinStock.length) { setSaving(false); setError('Stock insuficiente en ' + almNombre + ' para: ' + sinStock.map(l => l.sku).join(', ')); return; }

    // SKUs serializados: se arrastran los S/N ya asignados a la factura, pero NO se exigen para
    // generar la nota de despacho (cambio de protocolo). El S/N es obligatorio al DECLARAR
    // ENTREGADO, en el detalle del despacho.
    const seriales = [];
    for (const l of lineasDespacho) {
      const prod = (SSData.productos || []).find(p => p.sku === l.sku);
      if (!prod?.serializado) continue;
      const { data: yaAsig } = await window.sb.from('inventario_seriales')
        .select('serial, sku').eq('sku', l.sku).eq('almacen_id', almId)
        .eq('estado', 'vendido').eq('documento_id', factura.id);
      seriales.push(...(yaAsig || []).slice(0, l.qty).map(s => ({ serial: s.serial, sku: s.sku })));
    }

    const extra = {
      almacen_id: almId, driver_id: driverId || null, tipo_entrega: tipoEntrega,
      seriales: seriales.length ? seriales : null, nro_despacho: nroDespacho || null, observaciones: obs || null,
    };
    const r = reactivarId
      ? await window.reactivarDespacho(reactivarId, factura, lineasDespacho, extra)
      : await window.crearDespacho(factura, lineasDespacho, extra);
    setSaving(false);
    if (r.error) { setError(r.error.message || JSON.stringify(r.error)); return; }
    onCreated?.(r.despachoId);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{maxWidth: 600}} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{width:38,height:38,borderRadius:9,background:'#b4530918',color:'#b45309',display:'grid',placeItems:'center'}}>
            <Icon name="truck" size={18}/>
          </div>
          <div style={{flex:1}}>
            <div className="modal-title">{reactivarId ? `Volver a despachar ${reactivarId}` : 'Generar Nota de Despacho'}</div>
            <div className="small">
              Factura {factura.id} · {almNombre} · podés despachar parcial
              {reactivarId && ' · el documento anulado se reactiva con una versión nueva'}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div style={{padding:'16px 20px', maxHeight:'60vh', overflowY:'auto'}}>
          {dbLines === null ? (
            <div className="empty" style={{padding:20, display:'flex', alignItems:'center', justifyContent:'center', gap:8}}>
              <span className="ss-busy-spin"/>Cargando las líneas de la factura…
            </div>
          ) : lineasPendientes.length === 0 ? (
            <div className="empty" style={{padding:20}}>No quedan unidades pendientes por despachar.</div>
          ) : (
            <table className="tbl" style={{width:'100%'}}>
              <thead><tr>
                <th>Producto</th>
                <th className="num" style={{width:80}}>Facturado</th>
                <th className="num" style={{width:80}}>Despachado</th>
                <th className="num" style={{width:80}}>Pendiente</th>
                <th className="num" style={{width:90}}>A despachar</th>
              </tr></thead>
              <tbody>
                {realLines.map(l => {
                  const pend = pendienteDe(l);
                  const k = keyOf(l);
                  return (
                    <tr key={k} style={pend === 0 ? {opacity:0.5} : {}}>
                      <td><div style={{fontWeight:500}}>{l.nombre}</div><div className="small mono">{l.sku}</div></td>
                      <td className="num">{Math.round(l.qty) || 0}</td>
                      <td className="num">{l.cantidad_despachada || 0}</td>
                      <td className="num strong-num">{pend}</td>
                      <td className="num">
                        <input type="number" className="input" min={0} max={pend} value={qtys[k] ?? 0}
                          disabled={pend === 0}
                          onChange={e => setQty(k, e.target.value, pend)}
                          style={{width:70, textAlign:'right', padding:'4px 6px'}}/>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div className="grid-2 mt-4" style={{gap:12}}>
            <div>
              <label className="small" style={{display:'block', marginBottom:4}}>Tipo de entrega</label>
              {/* Antes ofrecía solo retiro/delivery: un despacho por encomienda o MRW no se
                  podía declarar como tal y quedaba registrado como delivery propio. */}
              <select className="select" value={tipoEntrega} onChange={e => setTipoEntrega(e.target.value)} style={{width:'100%'}}>
                {window.ssOpcionesEntrega().map(t => <option key={t.id} value={t.valor}>{t.nombre}</option>)}
                {tipoEntrega && !window.ssOpcionesEntrega().some(t => t.valor === tipoEntrega) && (
                  <option value={tipoEntrega}>{window.ssLabelEntrega(tipoEntrega)}</option>
                )}
              </select>
            </div>
            <div>
              <label className="small" style={{display:'block', marginBottom:4}}>Driver (opcional)</label>
              <select className="select" value={driverId} onChange={e => setDriverId(e.target.value)} style={{width:'100%'}}>
                <option value="">Sin asignar</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="small" style={{display:'block', marginBottom:4}}>Nro. despacho (opcional)</label>
              <input className="input" value={nroDespacho} onChange={e => setNroDespacho(e.target.value)} style={{width:'100%'}} placeholder="Ej. guía externa"/>
            </div>
            <div>
              <label className="small" style={{display:'block', marginBottom:4}}>Observaciones</label>
              <input className="input" value={obs} onChange={e => setObs(e.target.value)} style={{width:'100%'}}/>
            </div>
          </div>

          {error && <div style={{marginTop:12, padding:'8px 12px', background:'#fee2e2', color:'#dc2626', borderRadius:8, fontSize:12.5}}>{error}</div>}
        </div>
        <div className="modal-footer">
          <div className="small muted" style={{marginRight:'auto'}}>{totalADespachar} unidad(es) en esta nota</div>
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" onClick={handleConfirm} disabled={saving || totalADespachar <= 0}>
            <Icon name="truck" size={14}/>{saving ? (reactivarId ? 'Reactivando…' : 'Generando…') : (reactivarId ? 'Volver a despachar' : 'Generar despacho')}
          </button>
        </div>
      </div>
    </div>
  );
}
window.NuevoDespachoModal = NuevoDespachoModal;

// ====================== Panel: despachos asociados a una factura ======================
function DespachosDeFacturaPanel({ factura, lines, onOpenDoc }) {
  const [despachos, setDespachos] = useState(null);
  const realLines = (lines || []).filter(l => l.sku && l.sku !== '__SECTION__');

  async function reload() {
    const d = await window.getDespachosDeFactura?.(factura.id);
    setDespachos(d || []);
  }
  useEffect(() => {
    reload();
    const h = () => reload();
    window.addEventListener('ss-doc-version-bump', h);
    return () => window.removeEventListener('ss-doc-version-bump', h);
  }, [factura.id]);

  async function descargarPDF(desp) {
    const seriales = await window.cargarSerialesDoc?.(desp.id);
    window.generateDocumentPDF?.(desp, desp.lines || [], 'usd', seriales || {});
  }

  const legacyDespachada = factura.estado_despacho === 'despachada' && despachos && despachos.length === 0;

  return (
    <div className="card" style={{padding:16, marginTop:16}}>
      <div className="flex items-center gap-2" style={{marginBottom:12}}>
        <Icon name="truck" size={16} style={{color:'#b45309'}}/>
        <strong>Notas de despacho</strong>
        <EstadoDespachoChip estado={factura.estado_despacho} lines={lines}/>
      </div>

      <div className="tbl-scroll" style={{marginBottom:12}}>
      <table className="tbl" style={{width:'100%'}}>
        <thead><tr><th>Producto</th><th className="num">Facturado</th><th className="num">Despachado</th><th className="num">Pendiente</th></tr></thead>
        <tbody>
          {realLines.map(l => {
            const fact = Math.round(l.qty) || 0;
            // Facturas migradas totalmente despachadas no traen cantidad_despachada por línea;
            // si la factura está 'despachada' se asume la línea despachada completa.
            const desp = l.cantidad_despachada || (factura.estado_despacho === 'despachada' ? fact : 0);
            const pend = Math.max(0, fact - desp);
            return (
              <tr key={l.id != null ? l.id : l.sku}>
                <td><div style={{fontWeight:500}}>{l.nombre}</div><div className="small mono">{l.sku}</div></td>
                <td className="num">{fact}</td>
                <td className="num">{desp}</td>
                <td className="num strong-num" style={{color: pend > 0 ? '#b45309' : '#16a34a'}}>{pend}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {despachos === null ? <div className="small muted">Cargando despachos…</div>
        : legacyDespachada ? <div className="small muted" style={{padding:8, background:'var(--bg)', borderRadius:8}}>Despacho registrado bajo el modelo anterior, sin nota independiente.</div>
        : despachos.length === 0 ? <div className="small muted">Aún no hay notas de despacho para esta factura.</div>
        : (
          <div style={{display:'flex', flexDirection:'column', gap:8}}>
            {despachos.map(desp => (
              <div key={desp.id} className="flex items-center gap-2" style={{padding:'8px 12px', border:'1px solid var(--border)', borderRadius:8}}>
                <Icon name="truck" size={14} style={{color:'#b45309'}}/>
                <div style={{flex:1}}>
                  <div style={{fontWeight:600, fontSize:13}}>{desp.id}</div>
                  <div className="small muted">{fmt.date(desp.fecha)} · {desp.items} ítems · {desp.estado === 'despachado' ? 'Despachado' : 'Por despachar'}</div>
                </div>
                <button className="btn ghost sm" onClick={() => descargarPDF(desp)} title="Descargar nota de despacho"><Icon name="download" size={13}/>PDF</button>
                {onOpenDoc && <button className="btn ghost sm" onClick={() => onOpenDoc(desp)}>Ver</button>}
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// Declaración de entrega de un despacho: estado + botón con comentarios.
// Persiste en driver_despachos (estado='entregado'|'incidencia', notas=comentarios)
// y sincroniza el estado del documento a 'despachado'.
// Igual que en el portal del driver (DeliveryFlowModal, drivers.jsx): si alguna
// línea se entrega en menor cantidad que la esperada, el despacho queda en
// 'incidencia' (no "entregado" completo) y se crea automáticamente una fila en
// `incidencias` con los items faltantes — así el flujo manual de oficina/almacén
// queda consistente con el del driver.
function DeclararEntrega({ doc, lines, onSaved }) {
  const k        = getEstadoEnvio(doc);
  const meta     = ENVIO_META[k];
  const existing = (SSData.driverDespachos || []).find(x => x.despacho_id === doc.id);
  const [open, setOpen]               = useState(false);
  const [comentarios, setComentarios] = useState('');
  const [receptor, setReceptor]       = useState('');
  const [motivoFaltante, setMotivoFaltante] = useState('');
  const [items, setItems]             = useState([]);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  // S/N: se piden ACÁ (no al facturar ni al despachar). Un serial por unidad entregada; sin ellos
  // no se puede declarar la entrega de un producto serializado.
  const [serialLines, setSerialLines] = useState([]);   // [{sku,nombre,qty,garantia_meses,garantia_condiciones}]
  const [serialesIn, setSerialesIn]   = useState({});   // { sku: ['SN1','SN2', …] }
  const [serCargando, setSerCargando] = useState(false);
  const yaEntregado = k === 'entregado';
  const hasFaltantes = items.some(i => i.entregado < i.qty);

  function abrirModal() {
    setComentarios(existing?.notas || '');
    setReceptor(existing?.receptor_nombre || '');
    setMotivoFaltante('');
    setError('');
    const itemLines = (lines || []).filter(l => l.sku && l.sku !== '__SECTION__');
    setItems(itemLines.map(l => ({ sku: l.sku, nombre: l.nombre || l.sku, qty: l.qty || l.cantidad || 1, entregado: l.qty || l.cantidad || 1 })));
    const serLines = itemLines.filter(l => (SSData.productos || []).find(p => p.sku === l.sku)?.serializado === true)
      .map(l => ({
        sku: l.sku, nombre: l.nombre || l.sku, qty: l.qty || l.cantidad || 1,
        garantia_meses: l.garantia_meses, garantia_condiciones: l.garantia_condiciones,
      }));
    setSerialLines(serLines);
    setSerialesIn(Object.fromEntries(serLines.map(l => [l.sku, Array.from({ length: l.qty }, () => '')])));
    setOpen(true);
    // Prellenar con los S/N que ya estén ligados a este despacho (legado o segunda apertura).
    if (serLines.length > 0) {
      setSerCargando(true);
      window.sb.from('inventario_seriales')
        .select('serial,sku').eq('documento_id', doc.id).in('sku', serLines.map(l => l.sku))
        .then(({ data }) => {
          setSerCargando(false);
          if (!data || data.length === 0) return;
          setSerialesIn(prev => {
            const next = { ...prev };
            serLines.forEach(l => {
              const ya = data.filter(s => s.sku === l.sku).map(s => s.serial);
              next[l.sku] = Array.from({ length: l.qty }, (_, i) => ya[i] || (next[l.sku] || [])[i] || '');
            });
            return next;
          });
        });
    }
  }

  function setEntregadoQty(idx, v) {
    setItems(prev => prev.map((p, i) => i === idx ? { ...p, entregado: Math.max(0, Math.min(p.qty, v)) } : p));
  }

  function setSerial(sku, i, v) {
    setSerialesIn(prev => {
      const arr = (prev[sku] || []).slice();
      arr[i] = v;
      return { ...prev, [sku]: arr };
    });
  }

  // Cuántas unidades de ese SKU se están entregando (el faltante no necesita S/N).
  function entregadoDe(sku) {
    const it = items.find(i => i.sku === sku);
    return it ? it.entregado : 0;
  }

  // Devuelve el primer problema de S/N, o '' si están completos. Bloquea la entrega.
  function validarSeriales() {
    const vistos = new Map();
    for (const l of serialLines) {
      const n = entregadoDe(l.sku);
      const arr = (serialesIn[l.sku] || []).slice(0, n).map(s => String(s || '').trim());
      const llenos = arr.filter(Boolean);
      if (llenos.length < n) {
        return `Falta el número de serie de ${l.sku} (${llenos.length} de ${n}). Sin S/N no se puede declarar la entrega.`;
      }
      for (const s of llenos) {
        const key = l.sku + '|' + s.toUpperCase();
        if (vistos.has(key)) return `El serial ${s} de ${l.sku} está repetido.`;
        vistos.set(key, true);
      }
    }
    return '';
  }

  async function confirmar() {
    // Los S/N van PRIMERO: si algo falla ahí (serial repetido, ya entregado en otra venta) nada
    // más se escribió todavía y la entrega queda sin declarar.
    const problema = validarSeriales();
    if (problema) { setError(problema); return; }
    setSaving(true);
    setError('');
    if (serialLines.length > 0) {
      const seriales = [];
      serialLines.forEach(l => {
        (serialesIn[l.sku] || []).slice(0, entregadoDe(l.sku)).forEach(s => {
          const v = String(s || '').trim();
          if (v) seriales.push({ sku: l.sku, serial: v, garantia_meses: l.garantia_meses, garantia_condiciones: l.garantia_condiciones });
        });
      });
      const rs = await window.asignarSerialesEntrega({ despachoId: doc.id, seriales });
      if (rs.error) {
        setSaving(false);
        setError('No se pudieron registrar los seriales: ' + (rs.error.message || JSON.stringify(rs.error)));
        return;
      }
    }
    const empresaId = window.currentEmpresa || 'demo1';
    // Buscar la fila existente: la RPC crear_despacho_parcial ya crea una; si no
    // está en SSData (filtro de 60 días), la traemos de DB para NO duplicarla.
    let ex = (SSData.driverDespachos || []).find(x => x.despacho_id === doc.id);
    if (!ex) {
      const { data } = await window.sb.from('driver_despachos').select('*').eq('despacho_id', doc.id).limit(1);
      if (data && data[0]) { ex = data[0]; (SSData.driverDespachos = SSData.driverDespachos || []).push(ex); }
    }
    const nuevoEstado  = hasFaltantes ? 'incidencia' : 'entregado';
    const entregadoEn  = new Date().toISOString();
    // Los S/N entregados quedan también en el registro de entrega (además de inventario_seriales),
    // así el acta dice qué pieza exacta recibió el cliente.
    const itemsEnt = items.map(i => {
      const sn = (serialesIn[i.sku] || []).slice(0, i.entregado).map(s => String(s || '').trim()).filter(Boolean);
      return sn.length ? { ...i, seriales: sn } : i;
    });
    const payload = ex
      ? { ...ex, estado: nuevoEstado, notas: comentarios.trim() || ex.notas || null, receptor_nombre: receptor.trim() || ex.receptor_nombre || null, fecha: window.localDateStr(), entregado_en: entregadoEn, items_entregados: itemsEnt }
      : { id: 'da-' + doc.id + '-' + Date.now(), empresa_id: empresaId, despacho_id: doc.id, driver_id: null, estado: nuevoEstado, notas: comentarios.trim() || null, receptor_nombre: receptor.trim() || null, fecha: window.localDateStr(), entregado_en: entregadoEn, items_entregados: itemsEnt };
    const { error: errDD } = await window.saveDriverDespacho(payload);
    if (errDD) { setSaving(false); setError('Error al declarar la entrega: ' + (errDD.message || JSON.stringify(errDD))); return; }
    if (ex) Object.assign(ex, payload); else (SSData.driverDespachos = SSData.driverDespachos || []).push(payload);

    if (hasFaltantes) {
      const faltantes = items.filter(i => i.entregado < i.qty).map(i => ({ sku: i.sku, nombre: i.nombre, esperado: i.qty, entregado: i.entregado }));
      const maxInc = (SSData.incidencias || []).map(i => parseInt((i.id || '').replace('INC-', ''), 10) || 0).reduce((a, b) => Math.max(a, b), 0);
      const newInc = {
        id: 'INC-' + String(maxInc + 1).padStart(4, '0'),
        empresa_id: empresaId, driver_id: null, despacho_id: doc.id, cliente_id: doc.cliente,
        descripcion: motivoFaltante.trim() ? motivoFaltante.trim() : `Entrega parcial — ${faltantes.length} producto(s) con faltante`,
        items_faltantes: faltantes, foto: null, firma: null, estado: 'pendiente', fecha: entregadoEn, notas: '',
      };
      const { error: incErr } = await window.saveIncidencia(newInc);
      if (incErr) { alert('La entrega se guardó, pero no se pudo crear la incidencia: ' + (incErr.message || JSON.stringify(incErr))); }
      else { (SSData.incidencias = SSData.incidencias || []).push(newInc); window.ssActivityLog?.add(newInc.id, 'creado', `Incidencia por entrega parcial de ${doc.id}`); }
    }

    // Sincronizar el estado del despacho (clasifica el Kanban) — igual que EnvioChipEditable.
    if (doc.estado !== 'despachado') { await window.updateDocCampos?.(doc.id, { estado: 'despachado' }); doc.estado = 'despachado'; }
    window.dispatchEvent(new CustomEvent('ss-doc-version-bump', { detail: { id: doc.documento_origen_id, despachoId: doc.id } }));
    window.logActivity?.({ modulo: 'documentos', accion: 'editar', entidad_id: doc.id, entidad_label: doc.id, detalles: { envio_estado: nuevoEstado, comentarios: comentarios.trim() || undefined, faltantes: hasFaltantes ? items.filter(i => i.entregado < i.qty).length : 0 } });
    setSaving(false); setOpen(false);
    onSaved?.();
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="muted" style={{ fontSize: 12.5 }}>Estado de entrega:</span>
          <span className="chip" style={{ background: meta.color + '18', color: meta.color }}>
            <span className="chip-dot" style={{ background: meta.color }}/>{meta.label}
          </span>
        </div>
        {!yaEntregado && (
          <button className="btn primary sm" onClick={abrirModal}>
            <Icon name="check" size={14}/>Declarar entregado
          </button>
        )}
      </div>
      {yaEntregado && existing?.notas && (
        <div style={{ marginTop: 8, fontSize: 12.5 }}>
          <span className="muted">Comentarios de entrega: </span>{existing.notas}
        </div>
      )}
      {open && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal" style={{ width: 480, maxWidth: '96vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Declarar entrega — {doc.id}</span>
              <button className="icon-btn" onClick={() => setOpen(false)}><Icon name="x" size={16}/></button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label className="form-label">Recibido por <span className="muted small">(opcional)</span></label>
                <input className="input" style={{ width: '100%' }} value={receptor} onChange={e => setReceptor(e.target.value)} placeholder="Nombre de quien recibió" autoFocus/>
              </div>
              {items.length > 0 && (
                <div>
                  <label className="form-label">Items entregados</label>
                  <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:220, overflowY:'auto', border:'1px solid var(--border)', borderRadius:8, padding:8 }}>
                    {items.map((it, idx) => (
                      <div key={it.sku} style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <div style={{ flex:1, fontSize:12.5, minWidth:0 }}>
                          <div style={{ fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{it.nombre}</div>
                          <div className="muted mono" style={{ fontSize:11 }}>{it.sku}</div>
                        </div>
                        <input type="number" min={0} max={it.qty} className="input" style={{ width:64, textAlign:'center', flexShrink:0 }}
                          value={it.entregado}
                          onChange={e => setEntregadoQty(idx, parseInt(e.target.value) || 0)}/>
                        <span className="muted small" style={{ flexShrink:0 }}>/ {it.qty}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {serialLines.length > 0 && (
                <div>
                  <label className="form-label">
                    Números de serie <span style={{color:'#dc2626'}}>*</span>
                    <span className="muted small"> — uno por unidad entregada{serCargando ? ' · cargando los ya registrados…' : ''}</span>
                  </label>
                  <div style={{ display:'flex', flexDirection:'column', gap:10, maxHeight:260, overflowY:'auto', border:'1px solid var(--border)', borderRadius:8, padding:10 }}>
                    {serialLines.map(l => {
                      const n = entregadoDe(l.sku);
                      const arr = serialesIn[l.sku] || [];
                      const llenos = arr.slice(0, n).filter(s => String(s || '').trim()).length;
                      return (
                        <div key={l.sku}>
                          <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:5 }}>
                            <div style={{ fontSize:12.5, fontWeight:500, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{l.nombre}</div>
                            <span className="muted mono" style={{ fontSize:11 }}>{l.sku}</span>
                            <span className="small" style={{ color: llenos >= n ? '#16a34a' : '#b45309', fontWeight:600, flexShrink:0 }}>{llenos}/{n}</span>
                          </div>
                          {n === 0 && <div className="muted small">No se entrega ninguna unidad — no requiere S/N.</div>}
                          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                            {Array.from({ length: n }, (_, i) => (
                              <div key={i} style={{ display:'flex', alignItems:'center', gap:7 }}>
                                <span className="muted small mono" style={{ width:20, textAlign:'right', flexShrink:0 }}>{i+1}.</span>
                                <input className="input" style={{ flex:1, fontFamily:'var(--font-mono, monospace)' }}
                                  value={arr[i] || ''} placeholder="Escanea o escribe el S/N"
                                  onChange={e => setSerial(l.sku, i, e.target.value)}/>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="small muted" style={{ marginTop:6, display:'flex', alignItems:'center', gap:5 }}>
                    <Icon name="info" size={12}/>
                    La garantía y la trazabilidad post-venta se registran contra estos S/N. Si el serial no estaba cargado en inventario, se crea al entregar.
                  </div>
                </div>
              )}
              {hasFaltantes && (
                <div>
                  <label className="form-label">Motivo del faltante <span className="muted small">(opcional)</span></label>
                  <textarea className="input" rows={2} style={{ width:'100%', resize:'vertical' }} value={motivoFaltante} onChange={e => setMotivoFaltante(e.target.value)} placeholder="Ej: producto dañado, cliente rechazó parte del pedido…"/>
                  <div className="small" style={{ marginTop:6, color:'#dc2626', display:'flex', alignItems:'center', gap:5 }}>
                    <Icon name="alert" size={13}/>
                    Se creará una incidencia por {items.filter(i => i.entregado < i.qty).length} producto(s) con faltante — el despacho quedará como "No entregado" en vez de "Entregado".
                  </div>
                </div>
              )}
              <div>
                <label className="form-label">Comentarios de la entrega</label>
                <textarea className="input" rows={3} style={{ width: '100%', resize: 'vertical' }} value={comentarios} onChange={e => setComentarios(e.target.value)} placeholder="Observaciones de la entrega (estado, novedades, etc.)…"/>
              </div>
            </div>
            {error && (
              <div style={{ margin:'0 18px 10px', padding:'9px 11px', borderRadius:8, background:'#dc262614', color:'#dc2626', fontSize:12.5, display:'flex', alignItems:'flex-start', gap:7 }}>
                <Icon name="alert" size={14}/><span>{error}</span>
              </div>
            )}
            <div className="modal-footer">
              <button className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button>
              <button className="btn primary" disabled={saving} onClick={confirmar} style={hasFaltantes ? { background:'#dc2626', borderColor:'#dc2626' } : undefined}>
                <Icon name={hasFaltantes ? 'alert' : 'check'} size={14}/>{saving ? 'Guardando…' : (hasFaltantes ? 'Confirmar entrega parcial' : 'Confirmar entrega')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Se expone para el banco de pruebas visual (mismo patrón que NuevoDespachoModal).
window.DeclararEntrega = DeclararEntrega;

// ─── ¿Qué órdenes tienen este producto en hold? ─────────────────────────────────────────────
// Se usa en el aviso de "stock insuficiente" y en el detalle de Inventario (window.HoldDeOrdenes).
// El reservado sin orden que lo respalde se muestra aparte: es reserva fantasma (órdenes borradas o
// despachos que no la liberaron) y bloquea facturar mercancía que en realidad está libre.
function HoldDeOrdenes({ items, almacenId, docId, sku, reservado, titulo }) {
  const skus = React.useMemo(() => (
    sku ? [{ sku, reservado }] : (items || []).filter(i => (i.hold || 0) > 0).map(i => ({ sku: i.sku, reservado: i.hold }))
  ), [items, sku, reservado]);
  const [data, setData] = useState({});     // { sku: {rows, sinOrden} | 'cargando' | 'error' }

  useEffect(() => {
    if (!almacenId || skus.length === 0) return;
    let alive = true;
    setData(prev => {
      const n = { ...prev };
      skus.forEach(s => { if (!n[s.sku]) n[s.sku] = 'cargando'; });
      return n;
    });
    (async () => {
      for (const s of skus) {
        const r = await window.ordenesConReserva?.(s.sku, almacenId, s.reservado);
        if (!alive) return;
        setData(prev => ({ ...prev, [s.sku]: r?.error ? 'error' : { rows: r?.data || [], sinOrden: r?.sinOrden || 0 } }));
      }
    })();
    return () => { alive = false; };
  }, [almacenId, skus.map(s => s.sku).join('|')]);

  if (!almacenId || skus.length === 0) return null;
  return (
    <div className="card" style={{marginTop:14, padding:'10px 12px', background:'var(--bg-sunken)'}}>
      <div style={{fontSize:11.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.04em', color:'var(--text-muted)', marginBottom:7}}>
        {titulo || 'Quién tiene el hold'}
      </div>
      {skus.map(s => {
        const d = data[s.sku];
        return (
          <div key={s.sku} style={{marginBottom:8}}>
            {skus.length > 1 && <div className="mono" style={{fontSize:11.5, fontWeight:600, marginBottom:3}}>{s.sku}</div>}
            {d === 'cargando' && <div className="small muted" style={{display:'flex',alignItems:'center',gap:6}}><span className="ss-busy-spin"/>Buscando las órdenes…</div>}
            {d === 'error' && <div className="small" style={{color:'var(--danger)'}}>No se pudieron cargar las órdenes que lo retienen.</div>}
            {d && d !== 'cargando' && d !== 'error' && (
              <>
                {d.rows.length === 0 && d.sinOrden === 0 && <div className="small muted">Ninguna orden lo retiene.</div>}
                {d.rows.map(o => (
                  <div key={o.orden} style={{display:'flex', alignItems:'baseline', gap:8, fontSize:12.5, padding:'2px 0'}}>
                    <button type="button" className="mono"
                      onClick={() => { if (o.orden !== docId) window.__ssNavigate?.('/ordenes/' + o.orden); }}
                      title={o.orden === docId ? 'Es esta orden' : 'Abrir ' + o.orden}
                      style={{background:'none', border:'none', padding:0, cursor: o.orden === docId ? 'default' : 'pointer',
                              color: o.orden === docId ? 'var(--text-muted)' : 'var(--brand)', fontWeight:600,
                              textDecoration: o.orden === docId ? 'none' : 'underline', textUnderlineOffset:2}}>
                      {o.orden}{o.orden === docId ? ' (esta)' : ''}
                    </button>
                    <span style={{flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                      {o.cliente_nombre || o.cliente_id || '—'}
                      {/* QUIÉN hizo la reservación (pedido el 2026-08-13). `ordenes_con_reserva`
                          ya devolvía `vendedor` desde la migración 20 — solo faltaba mostrarlo.
                          Sin el nombre, para saber quién comprometió el stock había que abrir las
                          órdenes una por una, que es justo lo que este bloque vino a evitar. */}
                      {o.vendedor && <span className="muted"> · Vendedor: {o.vendedor}</span>}
                      {o.facturas && <span className="muted"> · facturada {o.facturas}</span>}
                    </span>
                    <span className="muted small">{fmt.date(o.fecha)}</span>
                    <strong style={{whiteSpace:'nowrap'}}>{o.en_hold} u</strong>
                  </div>
                ))}
                {d.sinOrden > 0 && (
                  <div style={{fontSize:12, color:'#b45309', marginTop:4}}>
                    <Icon name="alert" size={11}/> {d.sinOrden} u en hold que ninguna orden respalda.
                    Se limpia con <span className="mono">recompute_reservado</span> (ver
                    migracion-odoo/22): recalcula el hold contra las órdenes vivas.
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
window.HoldDeOrdenes = HoldDeOrdenes;

// La lista manda la fila PROYECTADA (solo las columnas que pinta la tabla). El detalle necesita el
// resto —observaciones, direcciones, retenciones, tasas— y lo trae en su propio viaje
// (`get_documento_detalle` devuelve la fila completa). Se fusiona acá y todo el componente sigue
// leyendo `doc` como antes: la fila de la lista pinta al instante y se completa al llegar la RPC.
function DocumentDetail({ doc: docLista, onBack, onHome, onPromote, onEdit, onDuplicate, navInfo, onNavSibling }) {
  const [docCompleto, setDocCompleto] = useState(null);
  const doc = useMemo(
    () => (docCompleto && docCompleto.id === docLista.id ? { ...docLista, ...docCompleto } : docLista),
    [docLista, docCompleto]);
  // Breadcrumb "atrás" contextual para el primer crumb (donde antes decía "POS" fijo)
  const homeBack = useMemo(() => getContextualBack('/pos', 'Punto de Venta'), [doc?.id]);
  // doc.cliente_id || doc.cliente: loadDocumentos mapea cliente_id→cliente, pero algunos caminos
  // que abren el detalle (asistente IA, enlaces directos) pasan el registro crudo de `documentos`
  // con solo cliente_id. Sin este fallback, esos casos mostraban la tarjeta de cliente en blanco.
  const cli = SSData.clientes.find(c => c.id === (doc.cliente_id || doc.cliente));
  const tc  = SSData.tiposCliente.find(t => t.id === cli?.tipo);
  const lp  = SSData.listasPrecios.find(l => l.id === cli?.listaPrecio);
  // Líneas del documento: el listado ya no embebe items (causaba 500), así que se cargan
  // on-demand al abrir el detalle. Si el doc ya trae lines (flujo de composición), se usan.
  const [lines, setLines] = useState(() => (doc.lines && doc.lines.length > 0) ? doc.lines : []);
  const [linesLoading, setLinesLoading] = useState(() => !(doc.lines && doc.lines.length > 0));
  // Abrir un documento costaba 3 consultas (4 en despacho): ítems, linaje y seriales. Es la acción
  // más repetida del sistema, así que las tres van en UN viaje con `get_documento_detalle`
  // (migracion-odoo/28). La RPC también resuelve el caso del DESPACHO, que no guarda líneas propias:
  // sus productos son los de la factura de su linaje.
  const [detalleRpc, setDetalleRpc] = useState(null);
  // 'cargando' hasta que la RPC contesta. Sin esto los efectos de linaje y seriales salían a
  // consultar por su cuenta en el primer render y el viaje ahorrado se perdía igual.
  const [detalleEstado, setDetalleEstado] = useState('cargando');
  useEffect(() => {
    let alive = true;
    setDetalleEstado('cargando');
    setDocCompleto(null);
    // También se sueltan el detalle y el linaje del documento ANTERIOR. Navegando por el
    // breadcrumb del linaje el componente no se desmonta —solo cambia `doc.id`—, así que sin esto
    // el nuevo documento se dibujaba un instante con los datos del que se venía mirando.
    setDetalleRpc(null);
    setSiblings([]);
    const traeLines = !(doc.lines && doc.lines.length > 0);
    if (!traeLines) { setLines(doc.lines); setLinesLoading(false); }
    else setLinesLoading(true);
    (async () => {
      const det = await window.getDocumentoDetalle?.(doc.id);
      if (!alive) return;
      if (det) {
        setDetalleRpc(det); setDetalleEstado('rpc');
        if (det.doc) setDocCompleto(det.doc);
        if (traeLines) { setLines(det.items || []); setLinesLoading(false); }
        return;
      }
      // Respaldo: si la RPC falla, el camino de siempre. Es la pantalla que más se abre; que un
      // problema del server la deje en blanco sería peor que hacer tres consultas.
      setDetalleRpc(null); setDetalleEstado('fallback');
      if (!traeLines) return;
      let ls = window.loadDocumentoItems ? await window.loadDocumentoItems(doc.id) : [];
      if ((!ls || ls.length === 0) && (doc.tipo || doc.estado) === 'despacho') {
        const raiz = doc.raiz_id || doc.id;
        const e = window.currentEmpresa || 'demo1';
        const { data: fam } = await window.sb.from('documentos')
          .select('id, tipo, estado')
          .or(`raiz_id.eq.${raiz},id.eq.${raiz}`).eq('empresa_id', e).in('tipo', ['factura', 'orden']);
        const src = (fam || []).find(f => f.tipo === 'factura' && f.estado !== 'cancelada' && f.estado !== 'anulada')
                 || (fam || []).find(f => f.tipo === 'factura')
                 || (fam || []).find(f => f.tipo === 'orden');
        if (src && window.loadDocumentoItems) ls = await window.loadDocumentoItems(src.id);
      }
      if (alive) { setLines(ls || []); setLinesLoading(false); }
    })();
    return () => { alive = false; };
  }, [doc.id]);
  // Etapa del documento (en el modelo de linaje, doc.estado es un sub-estado: creada/por_cobrar/...)
  const tipo = doc.tipo || doc.estado;
  // Estado local para campos internos (proveedor_id y costo) por SKU — se puebla al cargar líneas.
  const [internosState, setInternosState] = useState({});
  useEffect(() => {
    const m = {};
    lines.forEach(l => { if (l.sku && l.sku !== '__SECTION__') m[l.sku] = { proveedor_id: l.proveedor_id || '', costo: l.costo != null ? l.costo : '' }; });
    setInternosState(m);
  }, [lines]);
  const [savingInterno, setSavingInterno] = useState({});
  // Namespacing estándar #4: 'ss-pos-doc-show-costos' (default ON). Migración desde la clave vieja
  // 'ss-doc-show-costos' para no perder la preferencia. Default true salvo que esté explícito 'false'.
  const [showCostos, setShowCostos] = useState(() => {
    const v = localStorage.getItem('ss-pos-doc-show-costos') ?? localStorage.getItem('ss-doc-show-costos');
    return v !== 'false';
  });
  function toggleCostos() { setShowCostos(v => { const next = !v; localStorage.setItem('ss-pos-doc-show-costos', String(next)); return next; }); }
  // Nota de despacho = documento logístico: nunca muestra montos ni costos.
  const showCostosEff = showCostos && (doc.tipo || doc.estado) !== 'despacho';

  // ── Fabricación (solo Distribuidora Demo 1) — botón "Enviar a fabricar" por línea de cotización/orden ──
  // El modal vive en fabricacion.jsx (chunk lazy, distinto al de pos.jsx): se trae bajo demanda
  // con __loadChunk, mismo patrón que window.AplicarAnticipoModal desde Bancos.
  const puedeVerFabricacion = (window.currentEmpresa || 'demo1') === 'demo1';
  const puedeFabricar = puedeVerFabricacion && ['cotizacion', 'orden'].includes(tipo) && (window.canUser ? window.canUser('crear', 'fabricacion') : false);
  const [fabricarLinea, setFabricarLinea] = useState(null);   // una línea (botón de la fila)
  const [fabricarTodo, setFabricarTodo]   = useState(null);   // todas (botón "Fabricar todo")
  const [ofsDelDoc, setOfsDelDoc] = useState([]);
  // Las líneas de la OF viajan anidadas: desde la migración 79 una orden lleva varios productos y
  // el `sku` de la cabecera ya no se llena. Sin traer los ítems, el chip "En fabricación" de cada
  // fila dejaría de aparecer y se podría mandar dos veces lo mismo al taller.
  const OF_SELECT = '*, items:ordenes_fabricacion_items(*)';
  const recargarOFs = React.useCallback(() => {
    if (!puedeVerFabricacion || !doc?.id) return Promise.resolve();
    return window.sb.from('ordenes_fabricacion').select(OF_SELECT).eq('documento_id', doc.id)
      .then(({ data }) => setOfsDelDoc(data || []));
  }, [puedeVerFabricacion, doc?.id]);
  useEffect(() => {
    if (!puedeVerFabricacion || !doc?.id) return;
    let alive = true;
    window.sb.from('ordenes_fabricacion').select(OF_SELECT).eq('documento_id', doc.id)
      .then(({ data }) => { if (alive) setOfsDelDoc(data || []); });
    return () => { alive = false; };
  }, [puedeVerFabricacion, doc?.id]);

  // ¿Esta línea del documento ya se mandó a fabricar? Se busca por la línea de origen y, como
  // respaldo, por SKU (las órdenes sueltas no guardan `documento_item_id`).
  function ofDeLinea(l) {
    return ofsDelDoc.find(o =>
      (window.ofLineas ? window.ofLineas(o) : [o]).some(it =>
        (it.documento_item_id != null && String(it.documento_item_id) === String(l.id)) || it.sku === l.sku));
  }

  async function abrirEnviarAFabricar(linea) {
    if (window.__loadChunk) await window.__loadChunk('fabricacion');
    setFabricarLinea(linea);
  }
  // "Fabricar todo": UNA orden de taller con todos los productos que faltan mandar. Se excluye lo
  // que ya tiene OF viva (mandar dos veces la misma pieza es fabricarla dos veces), las secciones
  // y los servicios — mismo criterio que el botón por fila.
  // Recibe las líneas por parámetro: `lines` se arma más abajo en el render (el despacho usa las
  // de la factura de su linaje, no las propias) y no está en el scope de esta función.
  function lineasFabricables(lineasDoc) {
    return (lineasDoc || []).filter(l =>
      l.sku && l.sku !== '__SECTION__' && !window.esProductoServicio?.(l.sku) && !ofDeLinea(l));
  }
  async function abrirFabricarTodo(lineasDoc) {
    const pendientes = lineasFabricables(lineasDoc);
    if (!pendientes.length) return;
    if (window.__loadChunk) await window.__loadChunk('fabricacion');
    setFabricarTodo(pendientes);
  }
  async function onOFCreada() {
    setFabricarLinea(null);
    setFabricarTodo(null);
    // Si nace de una cotización, se promueve a orden de una vez: el compromiso de fabricar ya es
    // una venta real. La OF queda igual apuntando a la cotización original (documento_id) — la
    // cotización sigue existiendo, solo pasa a "Convertida"; no hace falta re-vincular.
    if (tipo === 'cotizacion') { await executePromote('orden'); }
    recargarOFs();
  }

  // ── Costo del CATÁLOGO y margen real (permiso `pos_costo_producto`) ───────────────────────────
  // Las columnas verdes de al lado son otra cosa: el costo que el vendedor le carga a un proveedor
  // tercero para ESA venta, línea por línea. Estas dos salen del costo que el producto ya tiene en
  // el catálogo (`productos.costo`, que viaja en el arranque) y no las escribe nadie acá. Es el
  // costo de la empresa, así que va detrás de su propio permiso.
  const verCostoProd = showCostosEff && (window.canUser ? window.canUser('ver', 'pos_costo_producto') : false);
  const prodBySku = React.useMemo(() => {
    const m = new Map();
    (SSData.productos || []).forEach(p => m.set(p.sku, p));
    return m;
  }, [SSData.productos, SSData.productos?.length]);
  // En BCV el precio de la línea YA lleva la cobertura, que es un ajuste de tasa y no ganancia: el
  // margen se mide sobre la base sin cobertura. Mismo criterio que comisiones.jsx y reportes.jsx —
  // si no, un documento BCV al 35% aparenta 35 puntos de margen que no existen.
  const factorCob = React.useMemo(() => {
    if (doc.modalidad_pago !== 'bcv') return 1;
    const c = Number(doc.cobertura_pct) || 0;
    return 1 + c / 100;
  }, [doc.modalidad_pago, doc.cobertura_pct]);
  // Margen del documento completo: se suma línea por línea y solo con las líneas que TIENEN costo,
  // porque un producto sin costo cargado daría 100% de margen y ensuciaría el total. Se dice cuántas
  // quedaron afuera en vez de disimularlo.
  const margenDoc = React.useMemo(() => {
    if (!verCostoProd) return null;
    let venta = 0, costo = 0, conCosto = 0, sinCosto = 0, ventaSinCosto = 0, peor = null;
    (lines || []).forEach(l => {
      if (!l.sku || l.sku === '__SECTION__') return;
      const sub = (Number(l.subtotal) || 0) / factorCob;     // base sin cobertura
      const cu  = Number(prodBySku.get(l.sku)?.costo) || 0;
      if (cu <= 0) { sinCosto++; ventaSinCosto += sub; return; }
      const ct = cu * (Number(l.qty) || 0);
      venta += sub; costo += ct; conCosto++;
      const m = sub > 0 ? ((sub - ct) / sub) * 100 : null;
      if (m != null && (peor == null || m < peor.margen)) peor = { sku: l.sku, nombre: l.nombre, margen: m };
    });
    const ganancia = venta - costo;
    return { venta, costo, ganancia, conCosto, sinCosto, ventaSinCosto, peor,
             pct: venta > 0 ? (ganancia / venta) * 100 : null };
  }, [verCostoProd, lines, prodBySku, factorCob]);
  const colorMargen = (m) => m == null ? 'var(--text-muted)' : m < 10 ? 'var(--danger)' : m < 25 ? 'var(--warn)' : 'var(--success)';

  async function handleInternoChange(sku, field, value) {
    setInternosState(prev => ({ ...prev, [sku]: { ...(prev[sku] || {}), [field]: value } }));
  }

  async function handleInternoBlur(sku, field, value) {
    const parsed = field === 'costo' ? (parseFloat(value) || 0) : (value || null);
    setSavingInterno(prev => ({ ...prev, [sku]: true }));
    await window.updateItemInterno?.(doc.id, sku, { [field]: parsed });
    setSavingInterno(prev => ({ ...prev, [sku]: false }));
  }
  const [actLogOpen, setActLogOpen] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [showDespachoModal, setShowDespachoModal] = useState(false);
  const [showFacturarModal, setShowFacturarModal] = useState(false);
  // Momento en que se abrió el selector de tipo de factura (ver el overlay más abajo).
  const facturarAbiertoEn = React.useRef(0);
  useEffect(() => { if (showFacturarModal) facturarAbiertoEn.current = Date.now(); }, [showFacturarModal]);
  const [showPdfModal, setShowPdfModal]   = useState(false);
  const [previewOpen, setPreviewOpen]     = useState(false);
  const [showStats, setShowStats]         = useState(false);
  const [linkCopied, setLinkCopied]       = useState(false);
  const [showPagoModal, setShowPagoModal] = useState(false);
  // Cobrar la factura desde su detalle: lo puede hacer quien administra CxC (`cxc.editar`) y también
  // quien tenga el permiso especial `pos_cobro` — pensado para los vendedores, que cobran lo que
  // facturan pero no tienen (ni necesitan) el módulo de Cuentas por Cobrar completo.
  const puedeCobrarFactura = window.puedeCobrarFactura();
  const [stockAlert, setStockAlert]       = useState(null); // array de items con stock insuficiente
  const [yaGenerado, setYaGenerado]       = useState(null); // { etapa, docs } — el hijo ya existe
  // { docs, continuar } — ya hay una orden con el MISMO contenido, aunque de otro linaje.
  // A diferencia de `yaGenerado`, este aviso NO bloquea: repetir una compra idéntica es legítimo.
  const [ordenDupDetalle, setOrdenDupDetalle] = useState(null);
  // Cerrojo SINCRÓNICO del doble clic. `promoting` es estado y no cambia hasta el próximo render:
  // dos clics seguidos pasaban los dos y creaban dos documentos.
  const promoteLock = React.useRef(false);
  const [cancelOpen, setCancelOpen]       = useState(false);
  const [cancelMotivo, setCancelMotivo]   = useState('');
  const [canceling, setCanceling]         = useState(false);
  // Anular (factura/despacho) — igual que cancelar pero además puede toparse con un pago ya
  // registrado en banco: `pagoOpciones` guarda esa pausa hasta que el usuario elige qué hacer.
  const [anularOpen, setAnularOpen]       = useState(false);
  const [anularMotivo, setAnularMotivo]   = useState('');
  const [anulando, setAnulando]           = useState(false);
  const [pagoOpciones, setPagoOpciones]   = useState(null);   // movs del banco ligados a este doc
  const [, setEntregaVer]                 = useState(0);  // re-render tras declarar entrega

  // ── Navegación por LINAJE (la cadena cotización→orden→factura→despacho de ESTE documento) ──
  // Todos los documentos de una misma venta comparten `raiz_id` (la orden/cotización raíz).
  // Antes este navegador cargaba TODOS los docs del cliente (por eso salían decenas); ahora trae
  // solo la cadena relacionada, y los botones COT/ORD/FAC/DSP saltan al documento de cada etapa.
  const [siblings, setSiblings] = useState([]);
  const raizId = doc.raiz_id || doc.id;
  useEffect(() => {
    if (!raizId) return;
    // El linaje viene en el detalle (un viaje). Solo se consulta aparte si la RPC no respondió.
    if (detalleEstado === 'cargando') return;                       // esperar la RPC
    if (detalleRpc) { setSiblings(detalleRpc.linaje || []); return; }
    setSiblings([]);
    const e = window.currentEmpresa || 'demo1';
    // Se INCLUYEN las canceladas: un despacho de una venta anulada en Odoo cuelga de una orden y
    // factura canceladas (importadas de Odoo) y el usuario necesita verlas para saber de qué es.
    window.sb.from('documentos')
      .select('id, tipo, estado, estado_cobro, estado_despacho, entregado_en, fecha, total, items, raiz_id, documento_origen_id')
      .or(`raiz_id.eq.${raizId},id.eq.${raizId}`)
      .eq('empresa_id', e)
      .then(({ data }) => setSiblings(data || []));
  }, [raizId, detalleRpc, detalleEstado]);

  // ¿La etapa siguiente YA existe? Una orden facturada seguía ofreciendo "Generar Factura" (y una
  // cotización ya convertida, "Convertir a Orden"): el documento hijo ya estaba en el linaje. El
  // bloqueo duro sigue en executePromote (facturasDeOrden), pero ofrecer el botón para que después
  // avise que no se puede es hacerle perder el clic al usuario.
  // Para la factura se usa `documento_origen_id` (lleno en las 27.156 facturas, migradas y nativas);
  // para la orden alcanza el linaje: las cotizaciones no guardan origen, solo `raiz_id`.
  const hijoEtapa = { cotizacion: 'orden', orden: 'factura', factura: 'despacho' }[tipo] || null;
  const hijosDeEsteDoc = useMemo(() => {
    if (!hijoEtapa) return [];
    return siblings.filter(s => s.tipo === hijoEtapa && s.estado !== 'cancelada' && s.estado !== 'anulada' &&
      (hijoEtapa === 'orden' ? true : s.documento_origen_id === doc.id));
  }, [siblings, hijoEtapa, doc.id]);
  const yaPromovido = hijosDeEsteDoc.length > 0;

  // CONGELADO ≠ yaPromovido, y por eso son dos variables y no una:
  //  · `yaPromovido` mira el hijo de LA ETAPA SIGUIENTE y necesita tenerlo en la mano — alimenta el
  //    botón "Ya convertida · {id}", que hace `hijosDeEsteDoc[0].id`. Ensancharlo lo rompería.
  //  · `congelado` es la regla de EDICIÓN: alcanza con que exista cualquier hijo vivo.
  // El `|| doc.has_child` no es redundante: `siblings` arranca vacío y el linaje llega en un segundo
  // viaje, así que sin él el botón "Editar" aparece un instante y un clic rápido se cuela. `has_child`
  // viene en la fila, sincrónico, desde el primer render.
  const congelado = yaPromovido || window.ssDocCongelado(doc);

  const STAGE_ORDER = { cotizacion: 0, orden: 1, factura: 2, despacho: 3 };
  // La cadena ordenada canónicamente (etapa, luego fecha) para prev/siguiente y saltos por etapa.
  const sibFiltered = useMemo(() =>
    [...siblings].sort((a, b) =>
      ((STAGE_ORDER[a.tipo] ?? 9) - (STAGE_ORDER[b.tipo] ?? 9)) ||
      (new Date(a.fecha || 0) - new Date(b.fecha || 0)) ||
      String(a.id).localeCompare(String(b.id))),
    [siblings]);
  const sibIdx  = sibFiltered.findIndex(s => s.id === doc.id);
  const sibPrev = sibIdx > 0 ? sibFiltered[sibIdx - 1] : null;
  const sibNext = sibIdx >= 0 && sibIdx < sibFiltered.length - 1 ? sibFiltered[sibIdx + 1] : null;
  const sibCounts = useMemo(() => ({
    cotizacion: siblings.filter(s => s.tipo === 'cotizacion').length,
    orden:      siblings.filter(s => s.tipo === 'orden').length,
    factura:    siblings.filter(s => s.tipo === 'factura').length,
    despacho:   siblings.filter(s => s.tipo === 'despacho').length,
  }), [siblings]);
  // Salta a la etapa pedida dentro del linaje (al primer doc NO cancelado de esa etapa; si todos
  // están cancelados, al primero — así desde un despacho se llega a su factura real si existe).
  function goToStage(stageKey) {
    const docsOfStage = sibFiltered.filter(s => s.tipo === stageKey);
    if (!docsOfStage.length) return;
    const target = docsOfStage.find(s => s.id !== doc.id && s.estado !== 'cancelada' && s.estado !== 'anulada')
                || docsOfStage.find(s => s.id !== doc.id)
                || docsOfStage[0];
    if (target && target.id !== doc.id) navigateToSibling(target);
  }

  async function navigateToSibling(sib) {
    const { data } = await window.sb.from('documentos')
      .select('*, documentos_items(*)').eq('id', sib.id).single();
    if (!data) return;
    const processed = {
      ...data,
      cliente: data.cliente_id,
      total:   parseFloat(data.total) || 0,
      items:   (data.documentos_items || []).filter(i => i.sku !== '__SECTION__').reduce((s, i) => s + (i.cantidad || 1), 0),
      lines:   (data.documentos_items || []).map(i => ({
        sku: i.sku, nombre: i.nombre, qty: i.cantidad,
        precio: parseFloat(i.precio_unitario), descuento: parseFloat(i.descuento) || 0,
        descuento_extra: parseFloat(i.descuento_extra) || 0, subtotal: parseFloat(i.subtotal),
        proveedor_id: i.proveedor_id || null, costo: parseFloat(i.costo) || 0,
        garantia_meses: i.garantia_meses != null ? parseInt(i.garantia_meses) : null,
        garantia_condiciones: i.garantia_condiciones || null,
      })),
    };
    onPromote(processed);
  }

  // Nombre histórico (`isCancelada`): cubre TANTO 'cancelada' (cotización/orden) como 'anulada'
  // (factura/despacho, ver `window.anularDocumento`) — las dos son "esto ya no sigue vivo" y todos
  // los botones de acción de más abajo se apagan igual para las dos.
  const isCancelada = doc.estado === 'cancelada' || doc.estado === 'anulada';
  // Fail-CLOSED: si no se puede verificar el permiso, NO se ofrece el botón. `tipo` YA es el id del
  // módulo (cotizacion/orden/factura/despacho, ver ROLES_MODULES en settings.jsx).
  const canCancel = window.canUser ? window.canUser('cancelar', tipo) : false;
  const canAnular = window.canUser ? window.canUser('anular', tipo) : false;

  async function handleConfirmCancel() {
    const motivo = (cancelMotivo || '').trim();
    if (motivo.length < 10) { alert('Motivo requerido: mínimo 10 caracteres.'); return; }
    setCanceling(true);
    const cu = window.__ssCurrentUser || { nombre: window.currentUserRole };
    const { error } = await window.cancelarDocumento(doc.id, motivo, cu);
    setCanceling(false);
    if (error) { alert('Error al cancelar: ' + (error.message || JSON.stringify(error))); return; }
    setCancelOpen(false);
    setCancelMotivo('');
    window.ssActivityLog?.add(doc.id, 'cancelado', `Cancelada — ${motivo}`);
    window.logActivity?.({ modulo:'documentos', accion:'cancelar', entidad_id:doc.id, entidad_label:doc.id, detalles:{ tipo, motivo } });
    onPromote && onPromote({ ...doc, estado: 'cancelada', motivo_cancelacion: motivo, cancelado_por: cu?.nombre || null, cancelado_at: new Date().toISOString() });
  }

  // `opcionPago` llega null en el primer intento; si el documento tiene un pago ya registrado en
  // banco, `anularDocumento` lo detiene y devuelve `pagoAsociado` en vez de anular — acá se muestra
  // esa decisión (eliminar el pago / dejarlo desvinculado) y se reintenta con la elección.
  async function handleConfirmAnular(opcionPago) {
    const motivo = (anularMotivo || '').trim();
    if (motivo.length < 10) { alert('Motivo requerido: mínimo 10 caracteres.'); return; }
    setAnulando(true);
    const cu = window.__ssCurrentUser || { nombre: window.currentUserRole };
    const res = await window.anularDocumento(doc.id, motivo, cu, opcionPago);
    setAnulando(false);
    if (res?.pagoAsociado) { setPagoOpciones(res.pagoAsociado); return; }
    if (res?.error) { alert('Error al anular: ' + (res.error.message || JSON.stringify(res.error))); return; }
    setAnularOpen(false);
    setAnularMotivo('');
    setPagoOpciones(null);
    window.ssActivityLog?.add(doc.id, 'anulado', `Anulada — ${motivo}`);
    onPromote && onPromote({ ...doc, estado: 'anulada', motivo_cancelacion: motivo, cancelado_por: cu?.nombre || null, cancelado_at: new Date().toISOString() });
  }

  // ¿Esta factura tiene un despacho ANULADO que se puede reactivar en el mismo documento (en vez
  // de generar uno nuevo)? Ver window.reactivarDespacho. Se re-consulta con cada bump de versión
  // del documento (anular/reactivar un despacho dispara ese evento).
  const [despachoReactivable, setDespachoReactivable] = useState(null);
  useEffect(() => {
    if (tipo !== 'factura') { setDespachoReactivable(null); return; }
    let alive = true;
    const buscar = async () => {
      const e = window.currentEmpresa || 'demo1';
      const { data } = await window.sb.from('documentos')
        .select('id, version').eq('tipo', 'despacho').eq('estado', 'anulada')
        .eq('documento_origen_id', doc.id).eq('empresa_id', e)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (alive) setDespachoReactivable(data || null);
    };
    buscar();
    window.addEventListener('ss-doc-version-bump', buscar);
    return () => { alive = false; window.removeEventListener('ss-doc-version-bump', buscar); };
  }, [tipo, doc.id]);

  const [cxcDoc, setCxcDoc]               = useState(() => (SSData.cuentasCobrar||[]).find(c => c.factura === doc.id) || null);
  // El inicializador de arriba corre UNA sola vez, y las CxC llegan en FASE 2 (asíncrona). Si el
  // detalle se montaba antes de que aterrizara —URL directa, navegación rápida, conexión lenta—
  // `cxcDoc` quedaba en null PARA SIEMPRE en ese montaje y el botón "Registrar pago" no aparecía
  // nunca: había que salir del documento y volver a entrar. Se reintenta con cada tanda de datos.
  useEffect(() => {
    const buscar = () => (SSData.cuentasCobrar || []).find(c => c.factura === doc.id) || null;
    // Al cambiar de documento se reevalúa de cero: el navegador de linaje reusa el componente y
    // arrastrar la CxC del documento anterior mostraría el cobro de otra factura.
    setCxcDoc(buscar());
    const refrescar = () => {
      const hallada = buscar();
      if (!hallada) return;                       // todavía no llegó: no pisar lo que ya se tenga
      setCxcDoc(prev => (prev && prev.id === hallada.id && prev.estado === hallada.estado)
        ? prev                                    // sin cambios: no forzar re-render
        : { ...hallada });
    };
    const off = window.ssOnDatos ? window.ssOnDatos(refrescar) : null;
    return () => { if (off) off(); };
  }, [doc.id]);
  const [asignarSerLine, setAsignarSerLine] = useState(null); // línea activa para asignar S/N
  const [serialesByDoc, setSerialesByDoc]   = useState({});   // { sku: [{id, serial, garantia_meses, garantia_vence}] } asignados a este doc
  const [serialesReloadKey, setSerialesReloadKey] = useState(0);

  useEffect(() => {
    // S/N viven en el despacho; en orden/factura puede haber asignación previa (legado)
    if (!['orden','factura','despacho'].includes(tipo)) { setSerialesByDoc({}); return; }
    const skusSerial = (lines || [])
      .filter(l => l.sku && l.sku !== '__SECTION__')
      .filter(l => {
        const p = (SSData.productos || []).find(x => x.sku === l.sku);
        return p?.serializado === true;
      })
      .map(l => l.sku);
    if (skusSerial.length === 0) { setSerialesByDoc({}); return; }
    const empresa = window.currentEmpresa || 'demo1';
    // Los seriales del documento vienen en el mismo viaje del detalle; si la RPC no respondió, se
    // consultan aparte.
    const agrupar = (filas) => {
      const map = {};
      (filas || []).forEach(sn => { if (!map[sn.sku]) map[sn.sku] = []; map[sn.sku].push(sn); });
      setSerialesByDoc(map);
      window.__ssDocSeriales = window.__ssDocSeriales || {};
      window.__ssDocSeriales[doc.id] = map;
    };
    // Tras declarar la entrega (serialesReloadKey) se vuelve a consultar: los del detalle ya son viejos.
    if (detalleEstado === 'cargando' && !serialesReloadKey) return;   // esperar la RPC
    if (detalleRpc && !serialesReloadKey) { agrupar(detalleRpc.seriales); return; }
    window.sb.from('inventario_seriales')
      .select('id,serial,sku,garantia_meses,garantia_vence,documento_id')
      .eq('empresa_id', empresa).eq('documento_id', doc.id)
      .in('sku', skusSerial)
      .then(({ data }) => agrupar(data));
  }, [doc.id, doc.estado, serialesReloadKey, lines, detalleRpc, detalleEstado]);

  const publicUrl = doc.slug ? (window.location.origin + '/public/' + doc.slug) : null;

  function copyPublicLink() {
    if (!publicUrl) return;
    try { navigator.clipboard.writeText(publicUrl); } catch(e) {}
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2500);
  }

  async function handleDuplicate() {
    const stL = { cotizacion:'Cotización', orden:'Orden', despacho:'Despacho', factura:'Factura' };
    if (!confirm(`¿Duplicar ${stL[tipo]} ${doc.id} como nueva Cotización?`)) return;
    setDuplicating(true);
    const newId = await window.nextDocId('COT');
    const today = window.localDateStr();
    const docData = {
      id: newId, tipo: 'cotizacion', estado: 'cotizacion',
      cliente_id:    doc.cliente_id || doc.cliente || null,
      contacto_id:   doc.contacto_id || null,
      almacen_id:    getAlmacenDefault(doc.almacen_id),
      fecha:         today,
      vencimiento:   null,
      tipo_venta:    doc.tipo_venta    || null,
      terminos_pago: doc.terminos_pago || null,
      vendedor:      doc.vendedor      || null,
      fuente:        doc.fuente        || null,
      id_crm:        doc.id_crm        || null,
      tipo_entrega:  doc.tipo_entrega  || null,
      zona_delivery: doc.zona_delivery || null,
      nro_despacho:  null,
      observaciones: doc.observaciones || null,
      dir_factura:   doc.dir_factura   || null,
      dir_entrega:   doc.dir_entrega   || null,
      subtotal:      doc.subtotal, iva: doc.iva, total: doc.total,
      descuento_pct: doc.descuento_pct || 0,
      descuento_doc: doc.descuento_doc || 0,
      aplica_iva:    doc.aplica_iva !== false,
      modalidad_pago: doc.modalidad_pago || 'divisas',
      cobertura_pct: doc.cobertura_pct  || 0,
      tasa_bcv:      doc.tasa_bcv, tasa_paralelo: doc.tasa_paralelo,
      items:         lines.length,
      creado_por:    window.__ssCurrentUser?.nombre || window.currentUserRole || null,
    };
    const items = lines.map(l => {
      // La línea trae proveedor_id/costo del estado editable (`internosState`) cuando el usuario
      // los tocó en ESTA sesión de detalle — no en `l`, que es la foto con la que se cargó el
      // documento. Sin mirar los dos, duplicar perdía el proveedor/costo recién tipeado.
      const interno = internosState[l.sku];
      return {
        sku: l.sku, nombre: l.nombre, qty: l.qty || l.cantidad || 1,
        precio: l.precio || l.precio_unitario || 0,
        descuento: l.descuento || doc.descuento_pct || 0,
        descuento_extra: l.descuento_extra || 0,
        subtotal: l.subtotal,
        // Antes se perdían al duplicar: el proveedor/costo interno de cada línea y la garantía.
        proveedor_id: (interno ? interno.proveedor_id : l.proveedor_id) || null,
        costo: parseFloat(interno ? interno.costo : l.costo) || 0,
        garantia_meses: (l.garantia_meses != null && l.garantia_meses !== '') ? parseInt(l.garantia_meses) : null,
        garantia_condiciones: l.garantia_condiciones || null,
      };
    });
    const { doc: newDoc, error } = await window.saveDocumento(docData, items);
    setDuplicating(false);
    if (error) { alert('Error al duplicar: ' + (error.message || JSON.stringify(error))); return; }
    window.ssActivityLog?.add(newId, 'creado', `Duplicado desde ${stL[tipo]} ${doc.id}`);
    window.logActivity?.({ modulo:'documentos', accion:'crear', entidad_id:newId, entidad_label:newId, detalles:{ duplicado_desde:doc.id } });
    onDuplicate && onDuplicate({ ...(newDoc || docData), lines: items.map(i => ({ ...i, qty: i.qty, precio: i.precio })) });
  }

  const _hasLines = lines.length > 0;
  const subtotal = _hasLines ? lines.reduce((s, l) => s + l.subtotal, 0) : (parseFloat(doc.subtotal) || 0);
  const docDcto  = doc.descuento_doc || 0;
  const subtotalNet = _hasLines ? subtotal * (1 - docDcto/100) : subtotal;
  // Fix bug #22: el detalle recomputaba 16% con `aplica_iva !== false`, tratando
  // null/undefined (docs legados/importados/copiados por RPC) como IVA APLICADO, aunque
  // el total guardado (doc.total) y la CxC NO lo incluyan → descuadre fiscal/cobranza.
  // Alineamos al criterio de escritura del compose (default false): IVA solo si === true.
  const iva   = _hasLines ? (doc.aplica_iva === true ? subtotalNet * 0.16 : 0) : (parseFloat(doc.iva) || 0);
  const total = _hasLines ? subtotalNet + iva : (parseFloat(doc.total) || 0);

  // Una nota CON IVA se rotula como factura: si el documento desglosa un tributo que se declara,
  // llamarlo "Nota de Factura" —el documento interno, sin número de control— se contradice con lo
  // que el propio documento dice. Vale para cualquier modalidad. Ver `window.ssRotuloFactura`.
  const facturaTitle = window.ssRotuloFactura(doc);
  const stageLabel = { cotizacion: 'Cotización', orden: 'Orden de Venta', despacho: 'Nota de Despacho', factura: facturaTitle };
  const stageColor = { cotizacion: '#64748b', orden: '#2563eb', despacho: '#b45309', factura: '#047857' };
  const nextLabel  = { cotizacion: 'Convertir a Orden', orden: 'Generar Factura', factura: 'Generar Despacho' };
  const nextIcon   = { cotizacion: 'chevronR', orden: 'receipt', factura: 'truck' };
  // El módulo de permisos que hay que chequear al promover: el de la etapa que se está por CREAR.
  const nextTipo   = { cotizacion: 'orden', orden: 'factura', factura: 'despacho' };

  // Orden canónico del flujo (cada etapa es un documento independiente encadenado)
  const stepOrder = ['cotizacion','orden','factura','despacho'];
  const curIdx = stepOrder.indexOf(tipo);

  // Promueve creando un documento HIJO encadenado (INSERT). NO muta el documento actual.
  //
  // El try/catch de afuera no es decorativo: cualquier excepción acá (una RPC que revienta, un
  // `undefined.id`) dejaba el botón MUDO —sin mensaje— y encima con `promoting` en true, o sea
  // muerto para siempre hasta recargar. Un fallo tiene que verse; y el estado tiene que soltarse
  // pase lo que pase.
  async function executePromote(tipoDestino, extraFields = {}) {
    // Segundo cerrojo, ahora sobre la creación en sí: el botón del selector de tipo de factura
    // también se puede clickear dos veces antes de que el primer INSERT termine.
    if (promoteLock.current) return;
    promoteLock.current = true;
    try {
      return await _executePromote(tipoDestino, extraFields);
    } catch (err) {
      console.error('[executePromote]', err);
      alert('No se pudo generar el documento y no se creó nada:\n\n' + (err?.message || String(err)) +
            '\n\nSi se repite, avisá con el id del documento (' + doc.id + ').');
    } finally {
      setPromoting(false);
      promoteLock.current = false;
    }
  }

  async function _executePromote(tipoDestino, extraFields = {}) {
    const _sln = { orden: 'Orden de Venta', factura: 'Factura' };
    // ── Cerrojo de líneas: NUNCA promover con el carrito vacío ────────────────────────────
    // Segunda defensa (la primera es el botón deshabilitado mientras `linesLoading`). Sin esto,
    // un clic ganándole a `get_documento_detalle` creaba el hijo SIN productos: el total se copia
    // de la cabecera del padre, así que el documento salía con monto y con cero líneas, se le
    // generaba su CxC y el cliente pagaba una factura que en PDF imprime $0.00. Además el chequeo
    // de stock de más abajo se saltaba solo (sin ítems no hay nada que validar) y la orden no
    // reservaba nada. Falla CERRADA: si no hay líneas, no se promueve.
    if (linesLoading) {
      alert('Todavía se están cargando los productos de este documento.\n\nEsperá un segundo y volvé a intentar.');
      return;
    }
    if (!lines.some(it => it.sku && it.sku !== '__SECTION__')) {
      alert('Este documento no tiene productos, así que no se puede convertir.\n\n' +
            'Si ves productos en pantalla, recargá (Ctrl+Shift+R) y probá de nuevo; si sigue vacío, ' +
            'avisá con el id del documento (' + doc.id + ').');
      return;
    }
    const almId = getAlmacenDefault(doc.almacen_id);
    const invItems = lines.filter(it => it.sku && it.sku !== '__SECTION__');

    // Al facturar: bloquear si no hay stock suficiente para respaldar la venta.
    // CAMBIO DE PROTOCOLO: facturar ya NO exige los seriales. El serial se pide al DECLARAR
    // ENTREGADO, que es el momento en que la pieza sale físicamente y se sabe cuál se entregó
    // (antes había que adivinarlo al facturar, con la mercancía todavía en el almacén).
    if (tipoDestino === 'factura') {
      const almNombres = Object.fromEntries((SSData.almacenes || []).map(a => [a.id, a.nombre]));
      const short = invItems.filter(it => {
        const inv = ((SSData.inventario || {})[it.sku] || {})[almId] || {};
        // Fix bug #5: comparar contra el disponible real (cantidad - reservado_de_OTRAS_órdenes),
        // no contra cantidad cruda. Antes dos órdenes podían facturar el mismo stock porque
        // el chequeo ignoraba inv.reservado. Sumamos de vuelta la reserva propia de esta orden
        // (≈ it.qty, que ya reservó al crearse) para no auto-bloquear su propia facturación.
        const cantidad = inv.cantidad ?? 0;
        const reservadoOtros = Math.max(0, (inv.reservado ?? 0) - (it.qty || 0));
        return (cantidad - reservadoOtros) < (it.qty || 0);
      }).map(it => {
        const invSku = (SSData.inventario || {})[it.sku] || {};
        const cant = (invSku[almId] || {}).cantidad ?? 0;
        // Lo que retienen OTRAS órdenes (la propia reserva de esta orden no cuenta contra ella).
        const holdOtros = Math.max(0, ((invSku[almId] || {}).reservado ?? 0) - (it.qty || 0));
        // Otros almacenes con stock físico (para no confundir al usuario: el producto SÍ existe, está en otro lado)
        const otros = Object.entries(invSku)
          .filter(([aid, v]) => aid !== almId && (v?.cantidad ?? 0) > 0)
          .map(([aid, v]) => ({ almacen: almNombres[aid] || aid, cantidad: v.cantidad }));
        // `disponible` es lo que de verdad se puede facturar (físico menos el hold ajeno), no el
        // físico crudo: con 20 en existencia y 40 en hold el aviso decía "En stock 20 · Faltante 0",
        // que no explica nada y parecía un error del sistema.
        const disponible = cant - holdOtros;
        return { sku: it.sku, nombre: it.nombre, qty: it.qty, disponible, hold: holdOtros, fisico: cant,
                 faltante: (it.qty || 0) - disponible, otros };
      });
      if (short.length > 0) { setStockAlert(short); return; }

      // ── Verificación CONTRA LA BASE, no contra la memoria ──────────────────
      // Lo de arriba mira `SSData.inventario`, que puede estar viejo y —sobre todo— no sabe
      // nada de lo que otras facturas ya prometieron. El inventario se debita al DESPACHAR,
      // así que con 1 unidad en existencia se podía facturar N veces: cada factura pasaba el
      // chequeo contra la MISMA unidad (así aparecieron 4 facturas de una orden de 1 unidad).
      setPromoting(true);
      const val = await window.validarStockFacturar?.(invItems, almId);
      setPromoting(false);
      if (val?.error) {
        alert('No se pudo verificar el stock disponible, así que NO se emitió la factura.\n\n' +
              (val.error.message || val.error) + '\n\nIntentá de nuevo.');
        return;
      }
      if (val?.faltantes?.length) {
        // QUIÉN retiene, no cuántas. Un "1 ya comprometido" sin nombre deja a quien vende sin
        // nada que hacer salvo preguntar; con el id de la factura se ve al toque si es una entrega
        // pendiente real o una que ya salió y quedó mal marcada (ver migracion-odoo/90).
        const retenedores = await window.facturasComprometiendo?.(
          almId, val.faltantes.map(f => f.sku), doc.id) || [];
        setStockAlert(val.faltantes.map(f => ({
          sku: f.sku,
          nombre: (invItems.find(i => i.sku === f.sku) || {}).nombre || f.sku,
          qty: f.pedido, disponible: f.disponible, faltante: f.faltante,
          fisicoReal: f.fisico, comprometido: f.comprometido,
          retenidoPor: retenedores.filter(r => r.sku === f.sku),
          otros: [],
        })));
        return;
      }

      // Una orden ya facturada NO se vuelve a facturar. Es la causa directa de las facturas
      // duplicadas: mientras el despacho fallaba se reintentaba desde acá y cada intento
      // emitía una factura nueva, con su CxC y su promesa de mercancía.
      const yaFact = await window.facturasDeOrden?.(doc.id);
      if (yaFact?.error) {
        alert('No se pudo verificar si esta orden ya fue facturada; no se emitió nada. Intentá de nuevo.');
        return;
      }
      if (Array.isArray(yaFact) && yaFact.length > 0) {
        setYaGenerado({ etapa: 'factura', docs: yaFact });
        return;
      }
    }

    setPromoting(true);
    const { doc: hijo, error } = await window.promoverDocumento(doc, tipoDestino, lines, extraFields);
    setPromoting(false);
    if (error) { alert('Error al convertir: ' + (error.message || JSON.stringify(error))); return; }
    window.ssActivityLog.add(doc.id, 'promovido', `${doc.id} → ${hijo.id} · ${_sln[tipoDestino] || tipoDestino}`);
    onPromote?.(hijo);  // navegar al nuevo documento hijo (el padre queda vivo)
  }

  async function promote() {
    // `promoting` es estado: dos clics en el mismo tick pasan los dos antes del re-render. El ref
    // corta en el acto — es la diferencia entre bloquear el doble clic y no bloquearlo.
    if (promoting || promoteLock.current) return;
    // Con las líneas en vuelo no se abre NADA: ni el modal de despacho ni el selector de tipo de
    // factura. Los dos caminos terminan leyendo `lines`, y vacío significa un hijo sin productos.
    if (linesLoading) return;
    // factura → despacho(s): abrir modal de despacho (posiblemente parcial). Un despacho parcial es
    // legítimo, así que acá no se bloquea por "ya existe": el modal solo ofrece lo que falta.
    if (tipo === 'factura') { setShowDespachoModal(true); return; }
    if (tipo === 'orden') {
      // Chequeo contra el SERVER antes de abrir el selector de tipo de factura: si ya se generó
      // (doble clic, otra pestaña, otro usuario), se avisa y no se abre nada.
      promoteLock.current = true;
      setPromoting(true);
      const yaFact = await window.hijosVivosDe?.(doc.id, 'factura');
      setPromoting(false);
      promoteLock.current = false;
      if (Array.isArray(yaFact) && yaFact.length > 0) { setYaGenerado({ etapa: 'factura', docs: yaFact }); return; }
      setShowFacturarModal(true);
      return;
    }
    if (tipo === 'cotizacion') {
      promoteLock.current = true;
      setPromoting(true);
      const yaOrd = await window.hijosVivosDe?.(doc.id, 'orden');
      // El chequeo de linaje solo ve hermanos: no detecta la misma venta cargada por otro camino
      // (suelta en el compositor, o desde otra cotización). Ese es el caso que dejó 3 órdenes
      // iguales reservando 3 veces el mismo producto. Se busca también por contenido.
      const dupOrd = (Array.isArray(yaOrd) && yaOrd.length > 0)
        ? null
        : await window.ordenesConMismoContenido?.({ clienteId: doc.cliente_id || doc.cliente, items: lines });
      setPromoting(false);
      promoteLock.current = false;
      if (Array.isArray(yaOrd) && yaOrd.length > 0) { setYaGenerado({ etapa: 'orden', docs: yaOrd }); return; }
      if (Array.isArray(dupOrd) && dupOrd.length > 0) {
        setOrdenDupDetalle({ docs: dupOrd, continuar: () => executePromote('orden', {}) });
        return;
      }
      if (!confirm(`¿Convertir Cotización ${doc.id} a Orden de Venta?`)) return;
      await executePromote('orden', {});
    }
  }

  // `handleDelete`/hard-delete se retiró el 2026-08-13: cotización/orden se CANCELAN
  // (`window.cancelarDocumento`, botón de arriba), nunca se borran.

  return (
    <>
    <div className="page">
      <div className="flex items-center gap-2" style={{marginBottom: 12, fontSize: 13}}>
        <button className="btn ghost sm" onClick={() => window.__ssNavigate?.(homeBack.path)} title={`Volver a ${homeBack.label}`}>
          <Icon name="chevronL" size={14}/>{homeBack.label}
        </button>
        <span className="muted">/</span>
        <button className="btn ghost sm" onClick={onBack}>{stageLabel[tipo]}s</button>
        <span className="muted">/</span>
        <strong className="mono">{window.dispIdDespacho(doc)}</strong>
        {/* Navegar entre los documentos de la tabla filtrada de donde se vino, sin volver a
            salir a la lista (pedido explícito 2026-08-14). `navInfo.index` puede dar -1 un
            instante mientras el nuevo doc.id todavía no llegó por completo. */}
        {navInfo && navInfo.total > 1 && (
          <span style={{ display:'flex', alignItems:'center', gap:2, marginLeft:'auto' }}>
            <button className="icon-btn" style={{width:24,height:24}} title="Documento anterior de este filtro"
                    disabled={navInfo.index <= 0} onClick={() => onNavSibling?.(-1)}>
              <Icon name="chevronL" size={14}/>
            </button>
            <span className="small muted" style={{whiteSpace:'nowrap'}}>
              {navInfo.index >= 0 ? navInfo.index + 1 : '—'} de {navInfo.total}
            </span>
            <button className="icon-btn" style={{width:24,height:24}} title="Documento siguiente de este filtro"
                    disabled={navInfo.index < 0 || navInfo.index >= navInfo.total - 1} onClick={() => onNavSibling?.(1)}>
              <Icon name="chevronR" size={14}/>
            </button>
          </span>
        )}
      </div>

      {siblings.length > 1 && (
        <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:14, padding:'8px 14px', background:'var(--bg-sunken)', borderRadius:10, border:'1px solid var(--border)', flexWrap:'wrap'}}>
          <span className="small muted" style={{marginRight:2, whiteSpace:'nowrap'}}>Documentos de esta venta:</span>
          <div style={{display:'flex', gap:4, flexWrap:'wrap'}}>
            {[
              {key:'cotizacion',  label:'COT'},
              {key:'orden',       label:'ORD'},
              {key:'factura',     label:'FAC'},
              {key:'despacho',    label:'DSP'},
            ].map(s => {
              const count   = sibCounts[s.key];
              const isHere  = tipo === s.key;
              const has     = count > 0;
              // ¿Todos los docs de esta etapa están anulados? (venta cancelada en Odoo)
              const anulada = has && !siblings.some(x => x.tipo === s.key && x.estado !== 'cancelada' && x.estado !== 'anulada');
              const stColor = anulada ? 'var(--danger)' : stageColor[s.key];
              return (
                <button key={s.key}
                  disabled={!has || (isHere && count === 1)}
                  onClick={() => goToStage(s.key)}
                  title={!has ? `Esta venta no tiene ${s.label}` : isHere ? 'Estás viendo este documento' : `Ir a ${s.label}${anulada?' (anulada)':''}${count>1?` — ${count} docs`:''}`}
                  style={{fontSize:12.5, padding:'4px 12px', lineHeight:1.4, borderRadius:6, cursor: (!has || (isHere && count===1)) ? 'default' : 'pointer',
                    fontWeight: isHere ? 700 : 500,
                    border: `1px solid ${isHere ? stColor : has ? 'var(--border)' : 'transparent'}`,
                    background: isHere ? stColor+'18' : has ? 'var(--bg-elev)' : 'transparent',
                    color: isHere ? stColor : anulada ? 'var(--danger)' : has ? 'var(--text)' : 'var(--text-subtle)',
                    textDecoration: anulada ? 'line-through' : 'none',
                    opacity: has ? 1 : 0.45}}>
                  {isHere && '● '}{s.label}{count > 1 ? <span style={{fontSize:11, opacity:0.7}}> ({count})</span> : ''}
                </button>
              );
            })}
          </div>
          <div style={{width:1, height:20, background:'var(--border)', margin:'0 4px', flexShrink:0}}/>
          <button disabled={!sibPrev} onClick={() => sibPrev && navigateToSibling(sibPrev)}
            title={sibPrev?.id}
            style={{display:'flex', alignItems:'center', gap:5, fontSize:12.5, padding:'4px 12px', borderRadius:6,
              border:'1px solid var(--border)', background: sibPrev ? 'var(--bg-elev)' : 'transparent',
              color: sibPrev ? 'var(--text)' : 'var(--text-subtle)', cursor: sibPrev ? 'pointer' : 'default'}}>
            ‹ <span className="mono" style={{fontSize:12}}>{sibPrev?.id || 'Anterior'}</span>
          </button>
          <span style={{fontSize:12.5, color:'var(--text-muted)', minWidth:52, textAlign:'center', fontWeight:500}}>
            {sibIdx >= 0 ? `${sibIdx + 1} / ${sibFiltered.length}` : `— / ${sibFiltered.length}`}
          </span>
          <button disabled={!sibNext} onClick={() => sibNext && navigateToSibling(sibNext)}
            title={sibNext?.id}
            style={{display:'flex', alignItems:'center', gap:5, fontSize:12.5, padding:'4px 12px', borderRadius:6,
              border:'1px solid var(--border)', background: sibNext ? 'var(--bg-elev)' : 'transparent',
              color: sibNext ? 'var(--text)' : 'var(--text-subtle)', cursor: sibNext ? 'pointer' : 'default'}}>
            <span className="mono" style={{fontSize:12}}>{sibNext?.id || 'Siguiente'}</span> ›
          </button>
        </div>
      )}

      <div className="doc-header">
        <div className="flex items-center gap-4">
          <div style={{width: 52, height: 52, borderRadius: 12, background: stageColor[tipo]+'18', color: stageColor[tipo], display:'grid', placeItems:'center'}}>
            <Icon name={tipo === 'despacho' ? 'truck' : tipo === 'factura' ? 'receipt' : 'doc'} size={26}/>
          </div>
          <div>
            <div className="small" style={{textTransform:'uppercase', letterSpacing:'0.06em', display:'flex', alignItems:'center', gap:8}}>
              {stageLabel[tipo] || stageLabel[doc.tipo] || ''}
              {isCancelada && (
                <span style={{background:'#dc2626', color:'#fff', padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:700, letterSpacing:'0.05em', display:'inline-flex', alignItems:'center', gap:5}}>
                  {doc.estado === 'anulada' ? 'ANULADA' : 'CANCELADA'}
                  <span title={window.textoEstadoInfo(doc)} style={{display:'inline-flex'}}>
                    <Icon name="info" size={11}/>
                  </span>
                </span>
              )}
            </div>
            <h1 className="mono" style={{fontSize: 22, fontWeight: 600, margin: '2px 0'}}>{window.dispIdDespacho(doc)}
              {doc.odoo_ref && <span title={'Migrado de Odoo · ' + doc.odoo_ref} style={{marginLeft:8, fontSize:11, padding:'2px 7px', borderRadius:5, background:'var(--bg-elev)', color:'var(--text-muted)', fontWeight:700, letterSpacing:'0.04em', verticalAlign:'middle'}}>MIG</span>}
            </h1>
            <div className="small">
              Emitida el {fmt.date(doc.fecha)}
              {doc.odoo_ref && <> · <span className="muted">Ref. Odoo: {doc.odoo_ref}</span></>}
              {doc.vendedor && <> · Vendedor: {doc.vendedor}</>}
              {doc.creado_por && doc.creado_por !== doc.vendedor && <> · <span style={{color:'var(--text-muted)'}}>Creado por: <strong style={{color:'var(--text)'}}>{doc.creado_por}</strong></span></>}
            </div>
            {isCancelada && (
              <div style={{marginTop:6, padding:'8px 12px', background:'#fee2e2', border:'1px solid #fecaca', borderRadius:6, fontSize:12, color:'#991b1b', maxWidth:680}}>
                <div><strong>{doc.estado === 'anulada' ? 'Anulada por' : 'Cancelada por'}:</strong> {doc.cancelado_por || '—'} {doc.cancelado_at && <>· {fmt.date(doc.cancelado_at)}</>}</div>
                {doc.motivo_cancelacion && <div style={{marginTop:3}}><strong>Motivo:</strong> {doc.motivo_cancelacion}</div>}
              </div>
            )}
            {!isCancelada && tipo === 'despacho' && getEstadoEnvio(doc) === 'entregado' && (
              <div style={{marginTop:6, padding:'8px 12px', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:6, fontSize:12, color:'#15803d', maxWidth:680, display:'flex', alignItems:'center', gap:6}}>
                <Icon name="check" size={14}/>
                <strong>Entregada</strong>{getEntregadoEn(doc) && <>· {fmtFechaHora(getEntregadoEn(doc))}</>}
              </div>
            )}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn ghost" onClick={() => setActLogOpen(true)} title="Ver log de actividad"><Icon name="clock" size={14}/>Actividad</button>
          <button className="btn ghost" onClick={() => setPreviewOpen(true)} title="Ver el PDF a la derecha, sin descargarlo">
            <Icon name="eye" size={14}/>Vista previa
          </button>
          <button className="btn ghost" onClick={() => {
            // El despacho no maneja precios → no tiene sentido elegir moneda; PDF directo
            if (tipo === 'despacho') window.generateDocumentPDF?.(doc, lines, 'original');
            else setShowPdfModal(true);
          }}><Icon name="download" size={14}/>PDF</button>
          {/* Botón "Compartir" eliminado: el enlace público de abajo ya tiene su botón "Copiar" (misma acción copyPublicLink). */}
          {publicUrl && (tipo === 'cotizacion' || tipo === 'orden') && (
            <button className="btn ghost" onClick={() => setShowStats(true)} title="Estadísticas de vistas">
              <Icon name="chart" size={14}/>Stats
            </button>
          )}
          {/* Duplicar cotización/orden crea OTRA del mismo tipo → permiso de `tipo`. */}
          {(tipo === 'cotizacion' || tipo === 'orden') && window.canUser?.('crear', tipo) !== false && (
            <button className="btn secondary" onClick={handleDuplicate} disabled={duplicating}>
              <Icon name="doc" size={14}/>{duplicating ? 'Duplicando…' : 'Duplicar'}
            </button>
          )}
          {/* "Nueva Cotización" desde una factura crea una COTIZACIÓN → permiso de 'cotizacion', no
              de 'factura' (antes los dos caían en el mismo 'pos' y no se distinguía). */}
          {tipo === 'factura' && window.canUser?.('crear','cotizacion') !== false && (
            <button className="btn secondary" onClick={handleDuplicate} disabled={duplicating}>
              <Icon name="doc" size={14}/>{duplicating ? 'Creando…' : 'Nueva Cotización'}
            </button>
          )}
          {/* Un documento con la etapa siguiente ya creada NO se edita (ver `ssDocCongelado`): lo que
              hay que corregir vive en el hijo. Antes esto solo frenaba a la orden facturada, así que
              una cotización ya convertida se seguía editando y su orden quedaba desalineada en
              silencio. En vez de esconder el botón se dice por qué, con el documento a dónde ir —
              un botón que desaparece se lee como falta de permisos. */}
          {onEdit && !isCancelada && tipo !== 'despacho' && !congelado
            && window.canUser?.('editar', tipo) !== false && <button className="btn secondary" onClick={() => onEdit(doc)}><Icon name="edit" size={14}/>Editar</button>}
          {onEdit && !isCancelada && tipo !== 'despacho' && congelado
            && window.canUser?.('editar', tipo) !== false && (
            <span className="small muted" title={window.ssMotivoCongelado(doc)}
                  style={{alignSelf:'center',display:'inline-flex',alignItems:'center',gap:5}}>
              <Icon name="lock" size={13}/>
              No se edita: ya generó {({ orden:'una orden', factura:'una factura', despacho:'un despacho' })[hijoEtapa] || 'la etapa siguiente'}
              {hijosDeEsteDoc[0] && <>
                {' · '}
                <a className="cliente-link" href="#" title={`Ir a ${hijosDeEsteDoc[0].id}`}
                   onClick={e => { e.preventDefault(); navigateToSibling(hijosDeEsteDoc[0]); }}>
                  {hijosDeEsteDoc[0].id}
                </a>
              </>}
            </span>
          )}
          {/* Cotización/orden: CANCELAR (soft, `estado='cancelada'`). Factura/despacho: ANULAR
              (soft, `estado='anulada'`, ver `window.anularDocumento`) — puede toparse con un pago ya
              registrado en banco, y ahí pausa a preguntar qué hacer con él antes de confirmar.
              Ninguno de los dos borra la fila: el documento sigue en el correlativo, visible en su
              pestaña "Canceladas"/"Anuladas". No existe más un botón "Eliminar" en este flujo. */}
          {(tipo === 'cotizacion' || tipo === 'orden') && canCancel && !isCancelada && (
            <button className="btn" onClick={() => setCancelOpen(true)}
              title="Cancelar — quedará registrado con motivo y trazabilidad"
              style={{color:'#dc2626', borderColor:'#dc2626', background:'transparent'}}>
              <Icon name="x" size={14}/>Cancelar {tipo === 'orden' ? 'orden' : 'cotización'}
            </button>
          )}
          {(tipo === 'factura' || tipo === 'despacho') && canAnular && !isCancelada && (
            <button className="btn" onClick={() => setAnularOpen(true)}
              title="Anular — quedará registrado con motivo y trazabilidad, sin borrar el documento"
              style={{color:'#dc2626', borderColor:'#dc2626', background:'transparent'}}>
              <Icon name="x" size={14}/>Anular {tipo === 'despacho' ? 'despacho' : 'factura'}
            </button>
          )}
          {/* Promover crea el documento SIGUIENTE (cotización→orden, orden→factura) → el permiso se
              chequea contra ESE módulo destino (`nextTipo[tipo]`), no contra el actual. */}
          {(tipo === 'cotizacion' || tipo === 'orden') && !isCancelada && !yaPromovido && window.canUser?.('crear', nextTipo[tipo]) !== false && (
            // `linesLoading` NO es decorativo: promover con las líneas todavía en vuelo crea el hijo
            // VACÍO (ver _executePromote). Pasó de verdad — 3 ventas de agosto quedaron con factura
            // sin productos y una de ellas cobrada. El botón espera a que el detalle llegue.
            <button className="btn primary" onClick={promote} disabled={promoting || linesLoading}
              title={linesLoading ? 'Cargando los productos del documento…' : undefined}>
              <Icon name={nextIcon[tipo]} size={14}/>{promoting ? 'Procesando…' : linesLoading ? 'Cargando…' : nextLabel[tipo]}
            </button>
          )}
          {(tipo === 'cotizacion' || tipo === 'orden') && !isCancelada && yaPromovido && (
            // En vez del botón, a dónde fue: el usuario quería llegar al documento siguiente.
            <button className="btn secondary" onClick={() => navigateToSibling(hijosDeEsteDoc[0])}
                    title={`Esta ${tipo === 'orden' ? 'orden ya se facturó' : 'cotización ya se convirtió'} — ir al documento`}>
              <Icon name={tipo === 'orden' ? 'receipt' : 'chevronR'} size={14}/>
              {tipo === 'orden' ? 'Ya facturada' : 'Ya convertida'} · {hijosDeEsteDoc[0].id}
            </button>
          )}
          {tipo === 'factura' && !isCancelada && doc.estado_despacho !== 'despachada' && window.canUser?.('crear','despacho') !== false && (
            // Mismo motivo que arriba: el modal de despacho ofrece lo que hay en `lines`. Abrirlo
            // antes de tiempo mostraría "nada que despachar" en una factura que sí tiene productos.
            // Si hay un despacho anulado reactivable, el label lo dice — el modal decide solo
            // (via `reactivarId`) si reactiva ese mismo documento o crea uno nuevo.
            <button className="btn primary" onClick={promote} disabled={promoting || linesLoading}
              title={linesLoading ? 'Cargando los productos del documento…' : undefined}>
              <Icon name="truck" size={14}/>{promoting ? 'Procesando…' : linesLoading ? 'Cargando…' :
                despachoReactivable ? `Volver a despachar (v${(despachoReactivable.version || 1) + 1})`
                : (doc.estado_despacho === 'parcial' ? 'Despachar resto' : 'Generar Despacho')}
            </button>
          )}
          {/* Sin CxC no hay nada que cobrar, pero antes el botón simplemente NO estaba y no había
              forma de saber por qué. Si la factura no está saldada y aun así no tiene cuenta, se
              dice: es el caso de las facturas anuladas y de algunas migradas. */}
          {tipo === 'factura' && !isCancelada && !cxcDoc && doc.estado_cobro !== 'pagada' && puedeCobrarFactura && (
            <span className="small muted" style={{ alignSelf: 'center' }} title="Esta factura no tiene cuenta por cobrar asociada, así que no hay saldo que registrar.">
              Sin cuenta por cobrar
            </span>
          )}
          {tipo === 'factura' && cxcDoc && cxcDoc.estado !== 'pagada' && puedeCobrarFactura && (
            <button className="btn primary" onClick={() => setShowPagoModal(true)}>
              <Icon name="dollar" size={14}/>Registrar pago
            </button>
          )}
        </div>
      </div>

      {(() => {
        // ── Estado REAL de cada etapa según el LINAJE (no solo la posición del doc actual) ──
        // Una factura puede estar ya despachada y con cobro pendiente: el paso Despacho debe salir
        // completado (verde) y el paso Factura en ámbar ("Cobro pendiente"), no azul/pendiente.
        // UN DOCUMENTO CANCELADO NO COMPLETA SU ETAPA. La frontera contaba `siblings.some(tipo ===
        // 'orden')` sin mirar el estado, y `facturaSib`/`despachoSib` se caían a la cancelada si no
        // había otra: una cotización cuya única orden se anuló mostraba "Orden ✓ Completado" Y al
        // lado el botón "Convertir a Orden" —que sí filtra las canceladas (`yaPromovido`)—, o sea
        // la pantalla se contradecía a sí misma. Medido el 2026-08-11: 2.086 linajes con la única
        // orden cancelada y 1.888 con la única factura cancelada. Reportado por el usuario.
        // La etapa no queda en "Pendiente" (sería mentir al revés): se rotula CANCELADA.
        const vivos = (t) => siblings.filter(s => s.tipo === t && s.estado !== 'cancelada' && s.estado !== 'anulada').length;
        const anulados = (t) => siblings.filter(s => s.tipo === t && (s.estado === 'cancelada' || s.estado === 'anulada')).length;
        const facturaSib  = (tipo === 'factura'  && !isCancelada) ? doc : (siblings.find(s => s.tipo === 'factura'  && s.estado !== 'cancelada' && s.estado !== 'anulada') || null);
        const despachoSib = (tipo === 'despacho' && !isCancelada) ? doc : (siblings.find(s => s.tipo === 'despacho' && s.estado !== 'cancelada' && s.estado !== 'anulada') || null);
        const facturaCobro = (tipo === 'factura' && !isCancelada)
          ? (cxcDoc?.estado || doc.estado_cobro || null)
          : (facturaSib?.estado_cobro || null);
        const facturaCobrada = facturaCobro === 'pagada';
        const despachoHecho = !!despachoSib || facturaSib?.estado_despacho === 'despachada'
          || (!isCancelada && doc.estado_despacho === 'despachada');
        const despFecha = despachoSib ? getEntregadoEn(despachoSib) : null;
        const despachoEntregadoLin = despachoSib
          ? (getEstadoEnvio(despachoSib) === 'entregado' || !!despachoSib.entregado_en)
          : false;
        // Frontera del flujo: la etapa más avanzada realmente alcanzada por el linaje. El documento
        // que se está viendo solo la empuja si NO está cancelado, por lo mismo de arriba.
        let frontier = isCancelada ? -1 : curIdx;
        if (vivos('orden'))  frontier = Math.max(frontier, 1);
        if (facturaSib)      frontier = Math.max(frontier, 2);
        if (despachoHecho)   frontier = Math.max(frontier, 3);
        return (
      <div className="doc-timeline">
        {stepOrder.map((s, i) => {
          const reached   = i <= frontier;
          const isViewing = i === curIdx;
          const navigable = (sibCounts[s] > 0) && !isViewing;   // hay un doc de esa etapa al que saltar
          let color = 'var(--text-subtle)', node = i + 1, sub = 'Pendiente';
          // Etapa que existió y se anuló: ni completada ni pendiente. Sin esto la única lectura
          // posible era "todavía no pasó", y el paso siguiente (que sí ocurrió) quedaba colgando.
          const anulado = !reached && anulados(s) > 0 && vivos(s) === 0;
          if (anulado) { color = '#dc2626'; node = '✕'; sub = 'Cancelada'; }
          if (reached) {
            node = '✓';
            if (s === 'despacho') {
              color = 'var(--success)';
              sub = despachoEntregadoLin
                ? <>Entregado{despFecha && <> · {fmtFechaHora(despFecha)}</>}</>
                : 'Despachado';
            } else if (s === 'factura' && facturaCobro && !facturaCobrada) {
              color = '#d97706';  // ámbar: facturada pero con cobro pendiente
              sub = facturaCobro === 'parcial' ? 'Cobro parcial' : 'Cobro pendiente';
            } else if (s === 'factura' && facturaCobrada) {
              color = 'var(--success)'; sub = 'Cobrada';
            } else {
              color = 'var(--success)'; sub = (isViewing && i === frontier) ? 'En este paso' : 'Completado';
            }
          }
          return (
            <div key={s} className="doc-tl-step"
              onClick={() => navigable && goToStage(s)}
              title={navigable ? `Ir a ${stageLabel[s]}` : ''}
              style={{cursor: navigable ? 'pointer' : 'default'}}>
              <div className="doc-tl-node" style={{
                background: reached ? color : 'var(--bg-sunken)',
                borderColor: (reached || isViewing || anulado) ? color : 'var(--border)',
                color: reached ? '#fff' : anulado ? color : 'var(--text-muted)',
                boxShadow: isViewing ? `0 0 0 4px ${color}22` : 'none',
              }}>{node}</div>
              <div className="doc-tl-label">
                <div style={{fontSize: 12, fontWeight: isViewing ? 700 : 500, color: reached ? 'var(--text)' : 'var(--text-muted)', textDecoration: navigable ? 'underline' : 'none'}}>{stageLabel[s]}</div>
                <div className="small" style={{color: (reached || anulado) ? color : 'var(--text-subtle)', fontWeight: ((reached && s === 'factura' && facturaCobro && !facturaCobrada) || anulado) ? 600 : 400}}>{sub}</div>
              </div>
              {i < stepOrder.length - 1 && <div className="doc-tl-line" style={{background: i < frontier ? 'var(--success)' : 'var(--border)'}}/>}
            </div>
          );
        })}
      </div>
        );
      })()}

      {/* Public link banner */}
      {publicUrl && (tipo === 'cotizacion' || tipo === 'orden') && (
        <div style={{display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'var(--brand-soft)', border:'1px solid var(--brand)', borderRadius:8, margin:'12px 0', fontSize:12.5}}>
          <Icon name="link" size={14} style={{color:'var(--brand)', flexShrink:0}}/>
          <div style={{flex:1}}>
            <span style={{fontWeight:600, color:'var(--brand)'}}>Enlace público del cliente: </span>
            <span style={{fontFamily:'monospace', color:'var(--text-muted)', wordBreak:'break-all'}}>{publicUrl}</span>
          </div>
          <button className="btn secondary sm" onClick={copyPublicLink} style={{flexShrink:0}}>
            {linkCopied ? '✓ Copiado' : 'Copiar'}
          </button>
          <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="btn ghost sm" style={{flexShrink:0}}>Abrir ↗</a>
        </div>
      )}

      {tipo === 'factura' && <DespachosDeFacturaPanel factura={doc} lines={lines} onOpenDoc={onPromote}/>}

      <div className="doc-grid">
        <div>
          <div className="grid-2 mb-4">
            <div className="card" style={{padding: 14}}>
              <div className="small" style={{textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 6}}>Cliente</div>
              {cli ? (<>
                <div style={{fontWeight: 600, fontSize: 14}}>
                  <window.ClienteLink clienteId={cli.id} nombre={cli.nombre}/>
                </div>
                <div className="small mono">{cli.rif}</div>
                <div className="small">{cli.direccion || cli.ciudad}</div>
                {cli.telefono && <div className="small muted" style={{marginTop:2}}>📞 {cli.telefono}</div>}
                {cli.email    && <div className="small muted" style={{marginTop:1}}>✉ {cli.email}</div>}
                <div className="flex gap-2 mt-2">
                  <span className="chip" style={{background: tc?.color+'20', color: tc?.color}}><span className="chip-dot"/>{tc?.nombre}</span>
                  <span className="chip blue">{lp?.nombre}</span>
                </div>
              </>) : (
                // Documento sin cliente vinculado (típicamente migrados de Odoo donde el vínculo se
                // perdió). El POS actual exige cliente para crear documentos nuevos — esto no puede
                // volver a pasar con documentos creados en la app.
                <div className="small muted" style={{fontStyle:'italic'}}>Cliente no especificado</div>
              )}
            </div>
            <div className="card" style={{padding: 14}}>
              <div className="small" style={{textTransform:'uppercase', letterSpacing:'0.06em', marginBottom: 10}}>Condiciones del documento</div>
              {/* Modalidad de pago badge — NO se muestra en despacho (doc logístico). */}
              {doc.modalidad_pago && tipo !== 'despacho' && (
                <div style={{marginBottom:10}}>
                  <span className="chip" style={{
                    background: (doc.modalidad_pago==='bcv'||doc.modalidad_pago==='bcv_fijo') ? 'var(--warn-soft,#fef3c7)' : doc.modalidad_pago==='paralelo' ? 'var(--accent-soft)' : 'var(--brand-soft)',
                    color: (doc.modalidad_pago==='bcv'||doc.modalidad_pago==='bcv_fijo') ? '#92400e' : doc.modalidad_pago==='paralelo' ? 'var(--accent)' : 'var(--brand)',
                    fontWeight:600, fontSize:12,
                  }}>
                    {doc.modalidad_pago==='bcv' ? `Tasa BCV +${doc.cobertura_pct||0}% cob.` : doc.modalidad_pago==='bcv_fijo' ? 'Nota BCV (exacto)' : doc.modalidad_pago==='paralelo' ? 'Tasa Paralelo' : 'Divisas USD'}
                  </span>
                </div>
              )}
              {[
                tipo !== 'orden' ? ['Tipo de venta', doc.tipo_venta ? doc.tipo_venta.charAt(0).toUpperCase()+doc.tipo_venta.slice(1) : 'Regular'] : null,
                ['Términos de pago',  doc.terminos_pago === 'inmediato' ? 'Pago inmediato' : doc.terminos_pago ? `Crédito ${doc.terminos_pago} días` : (tipo === 'cotizacion' ? 'Por definir' : `Crédito ${cli?.diasCredito||30}d`)],
                ['Vencimiento',       doc.vencimiento ? doc.vencimiento : '—'],
                // 'Moneda' (modalidad de pago) NO se muestra en despacho (doc logístico).
                tipo !== 'despacho' ? ['Moneda', (() => {
                  const m = doc.modalidad_pago || 'divisas';
                  if (m === 'paralelo') return `USD @ ${doc.tasa_paralelo || SSData.tasa.paralelo} Bs/USD (Paralelo)`;
                  if (m === 'divisas')  return 'USD (Divisas)';
                  if (m === 'bcv_fijo') return `USD @ ${doc.tasa_bcv || SSData.tasa.bcv} Bs/USD (BCV exacto)`;
                  return `USD @ ${doc.tasa_bcv || SSData.tasa.bcv} Bs/USD (BCV)`;
                })()] : null,
                // 'Tasa paralela' eliminada: antes salía SIEMPRE (aun en órdenes no-paralelo);
                // la tasa de la modalidad activa ya aparece en 'Moneda'.
                ['Vendedor',          doc.vendedor || '—'],
                tipo !== 'despacho' ? ['Almacén', (SSData.almacenes||[]).find(a=>a.id===doc.almacen_id)?.nombre || '—'] : null,
                ['Fuente',            (() => {
                  if (!doc.fuente) return '—';
                  const f = (SSData.fuentesVenta||[]).find(x => x.id === doc.fuente || x.nombre === doc.fuente);
                  if (f) return f.nombre;
                  return doc.fuente.charAt(0).toUpperCase() + doc.fuente.slice(1);
                })()],
                ['Tipo de entrega',   window.ssLabelEntrega(doc.tipo_entrega)],
                ['Driver asignado',   (() => { const drv = (SSData.drivers||[]).find(d=>d.id===doc.driver_id); return drv ? `${drv.nombre}${drv.vehiculo ? ' · '+drv.vehiculo : ''}${drv.placa ? ' ('+drv.placa+')' : ''}` : null; })()],
                ['Zona delivery',     doc.zona_delivery || (window.ssRequiereZona(doc.tipo_entrega) ? '—' : null)],
                ['Transportista',     window.ssRequiereGuia(doc.tipo_entrega) ? (doc.transportista || '—') : null],
                ['Guía de transporte',window.ssRequiereGuia(doc.tipo_entrega) ? (doc.guia_envio    || '—') : null],
                ['Nro. despacho SOS', doc.nro_despacho || null],
                ['Ref.',              tipo === 'despacho' ? `G-${doc.id.slice(-4)}-VE` : tipo === 'factura' ? `00-${doc.id.slice(-6)}` : doc.id],
              ].filter(item => item !== null && item[1] !== null).map(([label, val]) => (
                <div key={label} className="flex items-center justify-between" style={{fontSize: 12.5, marginBottom: 5}}>
                  <span className="muted">{label}</span>
                  <span style={{fontWeight: 500, textAlign:'right', maxWidth:'60%'}}>{val}</span>
                </div>
              ))}
              {(doc.dir_factura || cli?.direccion) && (
                <div style={{fontSize: 12.5, marginTop: 8, paddingTop: 8, borderTop:'1px solid var(--border)'}}>
                  <div className="muted" style={{fontSize:11, marginBottom:3}}>Dirección de factura</div>
                  <div style={{fontWeight:500}}>{doc.dir_factura || cli?.direccion || '—'}</div>
                </div>
              )}
              {(doc.dir_entrega || doc.dir_factura) && doc.dir_entrega !== doc.dir_factura && (
                <div style={{fontSize: 12.5, marginTop: 6}}>
                  <div className="muted" style={{fontSize:11, marginBottom:3}}>Dirección de entrega</div>
                  <div style={{fontWeight:500}}>{doc.dir_entrega || '—'}</div>
                </div>
              )}
              {doc.observaciones && (
                <div style={{fontSize: 12.5, marginTop: 8, paddingTop: 8, borderTop:'1px solid var(--border)'}}>
                  <div className="muted" style={{fontSize:11, marginBottom:3}}>Observaciones</div>
                  <div style={{fontWeight:500, lineHeight:1.4}}>{doc.observaciones}</div>
                </div>
              )}
            </div>
          </div>

          {tipo === 'factura' && (() => {
            const cxc = cxcDoc;
            if (!cxc) return (
              <div className="card mb-4" style={{padding:14, borderLeft:'3px solid #64748b'}}>
                <div className="small" style={{textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6}}>Estado de cobro</div>
                <span className="chip" style={{background:'#64748b18', color:'#64748b'}}>Sin cuenta por cobrar registrada</span>
              </div>
            );
            const saldo = (cxc.monto||0) - (cxc.pagado||0);
            const pct   = cxc.monto > 0 ? Math.min(100, (cxc.pagado/cxc.monto)*100) : 0;
            const colorMap = { pagada:'var(--success)', parcial:'var(--warn)', pendiente:'#2563eb', vencida:'var(--danger)' };
            const color = colorMap[cxc.estado] || 'var(--text-muted)';
            const labelMap = { pagada:'Cobrada', parcial:'Cobro parcial', pendiente:'Pendiente de cobro', vencida:'Vencida' };
            return (
              <div className="card mb-4" style={{padding:14, borderLeft:`3px solid ${color}`}}>
                <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10}}>
                  <div style={{display:'flex', alignItems:'center', gap:8}}>
                    <div className="small" style={{textTransform:'uppercase', letterSpacing:'0.06em'}}>Estado de cobro</div>
                    <span className="chip" style={{background:color+'18', color, fontWeight:700, fontSize:12}}>
                      <span className="chip-dot" style={{background:color}}/>
                      {labelMap[cxc.estado] || cxc.estado}
                    </span>
                    <span className="chip" style={{fontSize:11, background:'var(--bg-sunken)', color:'var(--text-muted)'}}>CxC {cxc.id}</span>
                  </div>
                  {cxc.estado !== 'pagada' && window.puedeCobrarFactura() && (
                    <button className="btn primary sm" onClick={() => setShowPagoModal(true)}>
                      <Icon name="dollar" size={13}/>Registrar pago
                    </button>
                  )}
                </div>
                <div className="grid-3" style={{gap:10, marginBottom: cxc.estado !== 'pagada' ? 10 : 0}}>
                  <div>
                    <div className="small muted" style={{marginBottom:2}}>Total factura</div>
                    <div style={{fontWeight:700, fontSize:14}}>{fmt.usd(cxc.monto)}</div>
                  </div>
                  <div>
                    <div className="small muted" style={{marginBottom:2}}>Cobrado</div>
                    <div style={{fontWeight:700, fontSize:14, color:'var(--success)'}}>{fmt.usd(cxc.pagado||0)}</div>
                  </div>
                  <div>
                    <div className="small muted" style={{marginBottom:2}}>Saldo pendiente</div>
                    <div style={{fontWeight:700, fontSize:14, color: saldo > 0 ? color : 'var(--text-muted)'}}>{fmt.usd(saldo)}</div>
                  </div>
                </div>
                {cxc.estado !== 'pagada' && (
                  <>
                    <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:4}}>
                      <div className="pbar" style={{flex:1, height:6, borderRadius:3}}>
                        <span style={{width:`${pct}%`, background:color, borderRadius:3}}/>
                      </div>
                      <span style={{fontSize:11, color:'var(--text-muted)', minWidth:36}}>{pct.toFixed(0)}%</span>
                    </div>
                    <div style={{fontSize:12, color:'var(--text-muted)'}}>
                      Vence: <strong style={{color: cxc.estado==='vencida' ? 'var(--danger)' : 'var(--text)'}}>{fmt.date(cxc.vence)}</strong>
                      {cxc.dias != null && cxc.dias > 0 && <span style={{color:'var(--danger)', marginLeft:6}}> · {cxc.dias} día{cxc.dias!==1?'s':''} vencida</span>}
                      {cxc.dias != null && cxc.dias < 0 && <span style={{color:'var(--text-muted)', marginLeft:6}}> · vence en {Math.abs(cxc.dias)} día{Math.abs(cxc.dias)!==1?'s':''}</span>}
                    </div>
                  </>
                )}
                {/* Historial completo: cada abono con el monto EN LA MONEDA EN QUE SE PAGÓ (un
                    cobro en bolívares no se encuentra buscando dólares), su banco y su referencia,
                    y las retenciones intercaladas. Reemplaza a la lista que mostraba solo
                    `fecha · método` y el monto en USD — que era justo el dato con el que NO se
                    puede cruzar contra el comprobante del banco. Ver `window.HistorialPagos`. */}
                {window.HistorialPagos && (
                  <div style={{marginTop:10}}>
                    <window.HistorialPagos cxc={cxc} documentoId={doc.id} compacto/>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="tbl-wrap">
            <div className="tbl-toolbar">
              <strong style={{fontSize: 13}}>Detalle de productos</strong>
              <span className="ml-auto small">{(lines||[]).filter(l=>l.sku && l.sku!=='__SECTION__').length} líneas</span>
              {tipo !== 'despacho' && (
                <button className="btn ghost" style={{fontSize:11, padding:'2px 8px', marginLeft:8}} onClick={toggleCostos}>
                  {showCostos ? '🔒 Ocultar costos' : '🔒 Ver costos'}
                </button>
              )}
              {/* "Fabricar todo": UNA orden de taller con todos los productos que faltan mandar,
                  en vez de una orden por línea (pedido del 2026-08-17). Solo aparece si queda algo
                  por mandar — lo ya enviado no se vuelve a ofrecer, porque mandarlo dos veces es
                  fabricarlo dos veces. Con una sola línea pendiente no aporta nada sobre el botón
                  de la fila, así que se muestra a partir de dos. */}
              {puedeFabricar && lineasFabricables(lines).length > 1 && (
                <button className="btn secondary" style={{fontSize:11, padding:'3px 10px', marginLeft:8, borderColor:'var(--brand)', color:'var(--brand)'}}
                  onClick={() => abrirFabricarTodo(lines)}
                  title="Crear una sola orden de taller con todos los productos pendientes">
                  <Icon name="box" size={12}/>Fabricar todo ({lineasFabricables(lines).length})
                </button>
              )}
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{width: 40}}>#</th><th>SKU</th><th>Descripción</th>
                  <th className="num">Cant.</th>
                  {tipo !== 'despacho' && <th className="num">P. Unit</th>}
                  {showCostosEff && <th className="num" style={{background:'#f0fdf4', color:'#15803d', fontSize:11, fontWeight:700, minWidth:70}}>% Gan. 🔒</th>}
                  {tipo !== 'despacho' && <><th className="num">Dcto.</th><th className="num">Subtotal</th></>}
                  {['orden','factura','despacho'].includes(tipo) && <th style={{minWidth:110}}>S/N</th>}
                  {showCostosEff && <th style={{background:'#f0fdf4', color:'#15803d', fontSize:11, fontWeight:700, minWidth:130}}>Proveedor 🔒</th>}
                  {showCostosEff && <th className="num" style={{background:'#f0fdf4', color:'#15803d', fontSize:11, fontWeight:700, minWidth:80}}>Costo 🔒</th>}
                  {/* Azul = costo del catálogo (no se edita acá). Verde = el que se le carga a un
                      proveedor tercero para esta venta. Colores distintos porque son datos distintos. */}
                  {verCostoProd && <th className="num" style={{background:'#eff6ff', color:'#1d4ed8', fontSize:11, fontWeight:700, minWidth:80}} title="Costo unitario del producto en el catálogo">Costo prod. 🔒</th>}
                  {verCostoProd && <th className="num" style={{background:'#eff6ff', color:'#1d4ed8', fontSize:11, fontWeight:700, minWidth:78}} title="Margen real sobre el costo del catálogo (base sin cobertura BCV)">Margen prod. 🔒</th>}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let rowNum = 0;
                  return lines.map((l, i) => {
                    if (l.sku === '__SECTION__') return (
                      <tr key={i} style={{background:'var(--bg-sunken)'}}>
                        <td colSpan={2} style={{padding:'5px 0'}}/>
                        <td colSpan={(tipo === 'despacho' ? 2 : 5) + (showCostosEff ? 3 : 0) + (verCostoProd ? 2 : 0) + (['orden','factura','despacho'].includes(tipo) ? 1 : 0)} style={{fontWeight:700, fontSize:11.5, padding:'5px 6px 5px 0', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.04em'}}>
                          {l.nombre || '—'}
                        </td>
                      </tr>
                    );
                    rowNum++;
                    const interno = internosState[l.sku] || { proveedor_id: l.proveedor_id || '', costo: l.costo != null ? l.costo : '' };
                    const saving = savingInterno[l.sku];
                    const provSel = (SSData.proveedores || []).find(p => p.id === interno.proveedor_id);
                    return (
                      <tr key={i}>
                        <td className="muted">{rowNum}</td>
                        <td className="mono-cell">{l.sku}</td>
                        <td style={{minWidth: 180}}>
                          <div>{l.nombre}</div>
                          {(() => {
                            const snList = serialesByDoc[l.sku] || [];
                            if (!snList.length) return null;
                            return (
                              <div style={{marginTop:3, display:'flex', flexWrap:'wrap', gap:3}}>
                                {snList.map(s => (
                                  <span key={s.id} style={{
                                    fontFamily:'var(--mono)', fontSize:10.5, padding:'1px 6px',
                                    borderRadius:4, background:'var(--success)15',
                                    border:'1px solid var(--success)', color:'var(--success)',
                                    fontWeight:600, whiteSpace:'nowrap',
                                  }}>
                                    S/N {s.serial}
                                  </span>
                                ))}
                              </div>
                            );
                          })()}
                          {/* Nunca en __SECTION__ ni en líneas de servicio (flete, mano de obra) — no hay
                              nada físico que fabricar ahí, mismo criterio que el resto de los chequeos
                              de stock/servicio del documento. */}
                          {puedeFabricar && l.sku && l.sku !== '__SECTION__' && !window.esProductoServicio?.(l.sku) && (() => {
                            const ofLinea = ofDeLinea(l);
                            if (ofLinea) {
                              const color = ofLinea.estado === 'listo' ? '#059669' : ofLinea.estado === 'cancelada' ? '#dc2626' : '#7c3aed';
                              const label = ofLinea.estado === 'listo' ? 'Fabricación lista' : ofLinea.estado === 'cancelada' ? 'Fabricación cancelada' : `En fabricación (${ofLinea.etapa})`;
                              // `window.__ssNavigate` es el puente que app-bootstrap publica al montar
                              // (ssNavClick/ssHrefRuta viven como const de módulo en shell.jsx, no
                              // son globales — no se pueden usar desde este chunk).
                              return (
                                <div style={{ marginTop: 6 }}>
                                  <a href={window.ssBase ? window.ssBase(`/${window.currentEmpresa || 'demo1'}/fabricacion`) : `/${window.currentEmpresa || 'demo1'}/fabricacion`}
                                    onClick={e => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button !== 1 && window.__ssNavigate) { e.preventDefault(); window.__ssNavigate('/fabricacion'); } }}
                                    className="chip" style={{ background: color + '18', color, textDecoration: 'none', fontWeight: 600 }}>
                                    <Icon name="box" size={11} /> #{ofLinea.numero_taller} · {label}
                                  </a>
                                </div>
                              );
                            }
                            // Botón real (no "ghost" gris): pedido explícito tras reportarse que el
                            // botón anterior era demasiado sutil y pasaba desapercibido en la tabla.
                            return (
                              <button className="btn secondary sm" style={{ marginTop: 6, fontSize: 12, padding: '4px 10px', borderColor: 'var(--brand)', color: 'var(--brand)' }}
                                onClick={() => abrirEnviarAFabricar(l)}>
                                <Icon name="box" size={13} />Enviar a fabricar
                              </button>
                            );
                          })()}
                        </td>
                        <td className="num">
                          {(() => {
                            // Semáforo de stock — solo tiene sentido en cotización/orden: es donde
                            // todavía se puede reponer o ajustar antes de facturar/despachar. El
                            // servicio (flete, mano de obra) no tiene inventario que mirar.
                            if ((tipo !== 'cotizacion' && tipo !== 'orden') || window.esProductoServicio?.(l.sku)) return l.qty;
                            const inv = window.getDisponible ? window.getDisponible(l.sku, getAlmacenDefault(doc.almacen_id)) : null;
                            if (!inv) return l.qty;
                            const falta = Math.max(0, (l.qty || 0) - inv.disponible);
                            return (
                              <span style={{display:'inline-flex', alignItems:'center', gap:5}}>
                                <span style={{color: falta > 0 ? 'var(--danger)' : 'var(--success)', fontWeight:600}}>{l.qty}</span>
                                {falta > 0
                                  ? <span style={{fontSize:10, fontWeight:700, color:'var(--danger)'}} title={`Disponible ${inv.disponible} de ${l.qty} pedidos — faltan ${falta}`}>−{falta}</span>
                                  : <span style={{fontSize:10, fontWeight:700, color:'var(--success)'}} title={`Stock disponible: ${inv.disponible}`}>✓</span>}
                              </span>
                            );
                          })()}
                        </td>
                        {tipo !== 'despacho' && <td className="num">{fmt.usd(l.precio)}</td>}
                        {showCostosEff && (() => {
                          const costo = parseFloat(interno.costo);
                          const gan = (costo > 0 && l.precio > 0) ? ((l.precio - costo) / costo * 100) : null;
                          return <td className="num" style={{background:'#f0fdf4', color: gan != null ? '#15803d' : 'var(--text-muted)', fontWeight: gan != null ? 600 : 400}}>
                            {gan != null ? `${gan.toFixed(1)}%` : '—'}
                          </td>;
                        })()}
                        {tipo !== 'despacho' && <td className="num" style={{color: (l.descuento_extra||0) > 0 ? 'var(--success)' : 'var(--text-muted)'}}>
                          {(l.descuento_extra||0) > 0 ? `−${l.descuento_extra}%` : '—'}
                        </td>}
                        {tipo !== 'despacho' && <td className="num strong-num">{fmt.usd(l.subtotal)}</td>}
                        {['orden','factura','despacho'].includes(tipo) && (() => {
                          const prod = (SSData.productos || []).find(p => p.sku === l.sku);
                          if (!prod?.serializado) return <td className="muted small">—</td>;
                          const asignados = (serialesByDoc[l.sku] || []).length;
                          const total = l.qty || 1;
                          const completo = asignados >= total;
                          const parcial  = asignados > 0 && asignados < total;
                          const puedeEditarSer = window.canUser ? window.canUser('editar', 'pos_seriales') : true;
                          return (
                            <td>
                              <button
                                onClick={() => setAsignarSerLine(l)}
                                title={!puedeEditarSer
                                  ? 'Ver S/N asignados (sin permiso para cambiar)'
                                  : (completo ? 'Revisar S/N asignados' : 'Asignar S/N a este ítem')}
                                style={{
                                  padding:'3px 9px', borderRadius:10, fontSize:11, fontWeight:600, cursor:'pointer',
                                  border:'1px solid',
                                  background: completo ? 'var(--success)15' : parcial ? 'var(--warn)15' : 'var(--danger)15',
                                  borderColor: completo ? 'var(--success)' : parcial ? 'var(--warn)' : 'var(--danger)',
                                  color: completo ? 'var(--success)' : parcial ? 'var(--warn)' : 'var(--danger)',
                                  display:'inline-flex', alignItems:'center', gap:4,
                                }}>
                                {!puedeEditarSer ? '👁' : (completo ? '✓' : '⚠')} {asignados}/{total} S/N{!puedeEditarSer ? ' · ver' : ''}
                              </button>
                            </td>
                          );
                        })()}
                        {/* Columnas internas — no aparecen en PDF */}
                        {showCostosEff && <td style={{background:'#f0fdf4', padding:'3px 6px'}}>
                          {/* Igual que en el carrito: buscador en vez de lista larga. */}
                          <SearchSelect
                            className="ss-btn-mini"
                            style={{width:'100%', minWidth:110, opacity: saving ? 0.5 : 1}}
                            value={interno.proveedor_id || ''}
                            onChange={v => { handleInternoChange(l.sku, 'proveedor_id', v); handleInternoBlur(l.sku, 'proveedor_id', v); }}
                            placeholder="— proveedor —"
                            options={(SSData.proveedores || []).map(p => ({ value: p.id, label: p.nombre }))}
                          />
                        </td>}
                        {showCostosEff && <td style={{background:'#f0fdf4', padding:'3px 6px'}}>
                          <input
                            type="number" min="0" step="0.01"
                            value={interno.costo === '' ? '' : interno.costo}
                            onChange={e => handleInternoChange(l.sku, 'costo', e.target.value)}
                            onBlur={e => handleInternoBlur(l.sku, 'costo', e.target.value)}
                            placeholder="0.00"
                            style={{fontSize:11.5, padding:'2px 4px', border:'1px solid #bbf7d0', borderRadius:4, background:'#f0fdf4', color:'#15803d', width:70, textAlign:'right', fontFamily:'var(--font-mono)', opacity: saving ? 0.5 : 1}}
                          />
                        </td>}
                        {/* Costo del catálogo + margen real de la línea (solo lectura). */}
                        {verCostoProd && (() => {
                          const cu = Number(prodBySku.get(l.sku)?.costo) || 0;
                          const base = (Number(l.precio) || 0) / factorCob;    // sin cobertura BCV
                          const m = (cu > 0 && base > 0) ? ((base - cu) / base) * 100 : null;
                          return (
                            <>
                              <td className="num mono" style={{background:'#eff6ff', color: cu > 0 ? '#1d4ed8' : 'var(--text-muted)', fontSize:11.5}}
                                  title={cu > 0 ? 'Costo del catálogo' : 'El producto no tiene costo cargado'}>
                                {cu > 0 ? fmt.usd(cu) : '—'}
                              </td>
                              <td className="num mono" style={{background:'#eff6ff', color: colorMargen(m), fontSize:11.5, fontWeight: m != null ? 700 : 400}}
                                  title={m != null ? `Venta ${fmt.usd(base)} − costo ${fmt.usd(cu)}${factorCob !== 1 ? ' · base sin la cobertura BCV' : ''}` : 'Sin costo en el catálogo'}>
                                {m != null ? `${m.toFixed(1)}%` : '—'}
                              </td>
                            </>
                          );
                        })()}
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>

          {/* ── Analítica de margen del documento (permiso `pos_costo_producto`) ──────────────
              Para responder "¿esta venta dejó plata?" sin exportar nada. Se mide con el costo del
              catálogo y sobre la base SIN cobertura BCV (la cobertura es tasa, no ganancia). Las
              líneas sin costo cargado quedan fuera del cálculo y se dicen: incluirlas daría 100% de
              margen y el número sería una mentira útil para nadie. */}
          {margenDoc && margenDoc.conCosto + margenDoc.sinCosto > 0 && (
            <div className="card mt-4" style={{padding:16, borderLeft:'3px solid #1d4ed8'}}>
              <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:10}}>
                <div className="card-title" style={{margin:0}}>Margen del documento 🔒</div>
                <span style={{fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:99, background:'#eff6ff', color:'#1d4ed8'}}>
                  costo del catálogo
                </span>
                {/* La salvedad: el margen se mide en dólares referenciales, pero esta venta se
                    COBRÓ en bolívares a tasa BCV. Sin decirlo, el porcentaje se lee como si
                    hubieran entrado dólares. En `bcv` el precio de la línea trae la cobertura y
                    se descuenta (factorCob); en `bcv_fijo` el precio ya es el referencial. */}
                {(doc.modalidad_pago === 'bcv' || doc.modalidad_pago === 'bcv_fijo') && (
                  <span style={{fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:99, background:'#fef3c7', color:'#92400e'}}
                        title={doc.modalidad_pago === 'bcv'
                          ? `Cobrado en bolívares a tasa BCV. El margen se mide sobre la venta sin la cobertura del ${doc.cobertura_pct || 0}%, que es ajuste de tasa y no ganancia.`
                          : 'Cobrado en bolívares a tasa BCV exacta. El precio de la línea ya es el dólar referencial, así que el margen se mide sobre él.'}>
                    cobrado en BCV
                  </span>
                )}
              </div>
              <div className="grid-4" style={{gap:10}}>
                <div>
                  <div className="small muted" style={{marginBottom:2}}>Venta {factorCob !== 1 ? '(sin cobertura)' : ''}</div>
                  <div style={{fontWeight:700, fontSize:14}}>{fmt.usd(margenDoc.venta)}</div>
                </div>
                <div>
                  <div className="small muted" style={{marginBottom:2}}>Costo</div>
                  <div style={{fontWeight:700, fontSize:14, color:'#1d4ed8'}}>{fmt.usd(margenDoc.costo)}</div>
                </div>
                <div>
                  <div className="small muted" style={{marginBottom:2}}>Ganancia</div>
                  <div style={{fontWeight:700, fontSize:14, color: colorMargen(margenDoc.pct)}}>{fmt.usd(margenDoc.ganancia)}</div>
                </div>
                <div>
                  <div className="small muted" style={{marginBottom:2}}>% Margen</div>
                  <div style={{fontWeight:800, fontSize:16, color: colorMargen(margenDoc.pct)}}>
                    {margenDoc.pct != null ? `${margenDoc.pct.toFixed(1)}%` : '—'}
                  </div>
                </div>
              </div>
              <div style={{marginTop:10, paddingTop:10, borderTop:'1px solid var(--border)', fontSize:12, color:'var(--text-muted)', display:'flex', flexWrap:'wrap', gap:'4px 14px'}}>
                <span>{margenDoc.conCosto} línea{margenDoc.conCosto !== 1 ? 's' : ''} con costo cargado</span>
                {margenDoc.sinCosto > 0 && (
                  <span style={{color:'var(--warn)'}}>
                    ⚠ {margenDoc.sinCosto} sin costo en el catálogo ({fmt.usd(margenDoc.ventaSinCosto)} de venta fuera del cálculo)
                  </span>
                )}
                {margenDoc.peor && (
                  <span>
                    Línea más floja: <strong style={{color: colorMargen(margenDoc.peor.margen)}}>{margenDoc.peor.margen.toFixed(1)}%</strong>
                    {' · '}{margenDoc.peor.sku}
                  </span>
                )}
              </div>
            </div>
          )}

          {tipo === 'despacho' && (() => {
            const esEncomienda = window.ssRequiereGuia(doc.tipo_entrega);
            const almacenNombre = (SSData.almacenes||[]).find(a=>a.id===doc.almacen_id)?.nombre || '—';
            return (
              <div className="card mt-4" style={{padding: 16}}>
                <div className="card-title" style={{marginBottom: 10}}>Información de envío</div>
                <div className="grid-3" style={{fontSize: 12.5}}>
                  <div><div className="muted">Almacén origen</div><div style={{fontWeight: 500}}>{almacenNombre}</div></div>
                  {esEncomienda && (
                    <>
                      <div><div className="muted">Transportista</div><div style={{fontWeight: 500}}>{doc.transportista || '—'}</div></div>
                      <div><div className="muted">Guía de transporte</div><div className="mono">{doc.guia_envio || '—'}</div></div>
                      <div><div className="muted">Destino</div><div style={{fontWeight: 500}}>{doc.zona_delivery || cli?.ciudad || '—'}</div></div>
                    </>
                  )}
                  {doc.nro_despacho && <div><div className="muted">Nro. despacho SOS</div><div className="mono">{doc.nro_despacho}</div></div>}
                </div>
                {!isCancelada && <DeclararEntrega doc={doc} lines={lines} onSaved={() => setEntregaVer(v => v + 1)} />}
              </div>
            );
          })()}

          {/* Información fiscal. Esta tarjeta mostraba "Retención IVA 75% aplicado" e "ISLR 2%
              retenido" ESCRITOS A MANO, en todas las facturas, y un "N° Control SENIAT" armado con
              los últimos 6 dígitos del id. Verificado contra producción el 2026-08-05: NINGUNA de
              las 30.259 facturas tiene retención cargada. O sea que la pantalla afirmaba un dato
              fiscal que no existía. Ahora muestra lo que hay de verdad, y cuando no hay, lo dice. */}
          {tipo === 'factura' && (
            <div className="card mt-4" style={{padding: 16}}>
              <div className="card-title" style={{marginBottom: 10}}>Información fiscal</div>
              <div className="grid-3" style={{fontSize: 12.5}}>
                <div><div className="muted">N° Factura</div><div className="mono">{doc.id}</div></div>
                <div><div className="muted">Fecha emisión</div><div>{fmt.date(doc.fecha)}</div></div>
                <div><div className="muted">IVA</div>
                  <div>{doc.aplica_iva === false ? 'Exenta' : (parseFloat(doc.iva) > 0 ? fmt.usd(doc.iva) : 'Sin IVA discriminado')}</div></div>
                <div><div className="muted">Retención IVA</div>
                  <div>{parseFloat(doc.retencion_iva) > 0 ? fmt.usd(doc.retencion_iva) : '—'}</div></div>
                <div><div className="muted">Retención ISLR</div>
                  <div>{parseFloat(doc.retencion_islr) > 0 ? fmt.usd(doc.retencion_islr) : '—'}</div></div>
                <div><div className="muted">Modalidad</div><div>{doc.modalidad_pago || '—'}</div></div>
              </div>
              <div className="small muted" style={{marginTop:10, lineHeight:1.6}}>
                Las retenciones se cargan al registrar el cobro y se consultan en Finanzas → Retenciones.
              </div>
            </div>
          )}
        </div>

        <div>
          {tipo === 'despacho' ? (
          <div className="card" style={{padding: 16, position: 'sticky', top: 12}}>
            {/* Nota de despacho = documento logístico: NO se muestran montos, solo el resumen de entrega. */}
            <div className="card-title" style={{marginBottom: 12}}>Resumen de entrega</div>
            {(() => {
              const reales = (lines || []).filter(l => l.sku && l.sku !== '__SECTION__');
              const unidades = reales.reduce((s, l) => s + (Number(l.qty) || 0), 0);
              const entregado = getEstadoEnvio(doc) === 'entregado';
              return <>
                <div className="flex justify-between" style={{fontSize: 12.5, marginBottom: 6}}><span className="muted">Productos</span><span className="mono">{reales.length}</span></div>
                <div className="flex justify-between" style={{fontSize: 12.5, marginBottom: 6}}><span className="muted">Unidades</span><span className="mono">{unidades}</span></div>
                <div style={{height: 1, background: 'var(--border)', margin: '10px 0'}}/>
                <div className="flex justify-between items-center">
                  <span style={{fontWeight: 600}}>Estado de entrega</span>
                  <span className="chip" style={{background: (entregado?'#16a34a':'#b45309')+'18', color: entregado?'#16a34a':'#b45309'}}>{entregado ? 'Entregado' : 'Pendiente'}</span>
                </div>
                {entregado && getEntregadoEn(doc) && <div className="small muted" style={{marginTop:8, textAlign:'right'}}>{fmtFechaHora(getEntregadoEn(doc))}</div>}
              </>;
            })()}
          </div>
          ) : (
          <div className="card" style={{padding: 16, position: 'sticky', top: 12}}>
            <div className="card-title" style={{marginBottom: 12}}>Resumen</div>
            <div className="flex justify-between" style={{fontSize: 12.5, marginBottom: 6}}><span className="muted">Subtotal items</span><span className="mono">{fmt.usd(subtotal)}</span></div>
            <div className="flex justify-between" style={{fontSize: 12.5, marginBottom: 6}}><span className="muted">Dcto. lista ({lp?.valor}%)</span><span className="mono" style={{color: 'var(--success)'}}>Incluido</span></div>
            {docDcto > 0 && <div className="flex justify-between" style={{fontSize: 12.5, marginBottom: 6}}><span className="muted">Dcto. cotización ({docDcto}%)</span><span className="mono" style={{color:'var(--success)'}}>−{fmt.usd(subtotal * docDcto/100)}</span></div>}
            {docDcto > 0 && <div className="flex justify-between" style={{fontSize: 12.5, marginBottom: 6}}><span className="muted">Subtotal neto</span><span className="mono">{fmt.usd(subtotalNet)}</span></div>}
            <div className="flex justify-between" style={{fontSize: 12.5, marginBottom: 6}}>
              {/* Fix bug #22: coherente con el recálculo de IVA (solo === true aplica). */}
              <span className="muted">IVA 16% {doc.aplica_iva !== true && <span style={{color:'var(--text-muted)',fontSize:11}}>(exento)</span>}</span>
              <span className="mono">{doc.aplica_iva === true ? fmt.usd(iva) : '—'}</span>
            </div>
            <div style={{height: 1, background: 'var(--border)', margin: '10px 0'}}/>
            <div className="flex justify-between items-baseline" style={{marginBottom: 4}}>
              <span style={{fontWeight: 600}}>Total USD</span>
              <span className="mono" style={{fontSize: 18, fontWeight: 600}}>{fmt.usd(total)}</span>
            </div>
            {/* Equivalente en Bs SEGÚN la modalidad (igual que POS): bcv/bcv_fijo a
                tasa BCV, paralelo a tasa paralelo, divisas NO muestra Bs. */}
            {(() => {
              if (tipo === 'despacho') return null;  // despacho: sin modalidad de pago
              const m = doc.modalidad_pago || 'divisas';
              if (m === 'divisas') return null;
              const esPar = m === 'paralelo';
              const rate  = esPar ? (doc.tasa_paralelo || SSData.tasa.paralelo) : (doc.tasa_bcv || SSData.tasa.bcv);
              if (!rate) return null;
              const col   = esPar ? 'var(--accent)' : 'var(--warn)';
              return (
                <div className="flex justify-between items-center" style={{fontSize: 12, marginTop: 2}}>
                  <span className="muted" style={{display:'flex', alignItems:'center', gap:6}}>
                    <span className="rate-tag-sm" style={{background:'var(--bg-sunken)', color:col}}>{esPar ? 'Par.' : 'BCV'}</span>
                    <span>Bs. ({rate})</span>
                  </span>
                  <span className="mono" style={{color:col, fontWeight:700}}>{fmt.ves(total * rate)}</span>
                </div>
              );
            })()}

          </div>
          )}
        </div>
      </div>
    </div>

    {stockAlert && (
      <div className="modal-overlay" onClick={() => setStockAlert(null)}>
        <div className="modal" style={{width:'min(680px,96vw)'}} onClick={e=>e.stopPropagation()}>
          <div className="modal-header">
            <div style={{width:38,height:38,borderRadius:9,background:'#fef2f218',color:'#dc2626',display:'grid',placeItems:'center',flexShrink:0}}>
              <Icon name="alert" size={20}/>
            </div>
            <div style={{flex:1}}>
              <div className="modal-title" style={{color:'#dc2626'}}>Stock insuficiente</div>
              <div className="small muted">No se puede generar la factura</div>
            </div>
            <button className="icon-btn" onClick={() => setStockAlert(null)}><Icon name="x" size={14}/></button>
          </div>
          <div className="modal-body">
            <p style={{fontSize:13,marginBottom:14,lineHeight:1.5}}>
              Los siguientes productos no tienen suficiente stock físico en{' '}
              <strong>{(SSData.almacenes || []).find(a => a.id === getAlmacenDefault(doc.almacen_id))?.nombre || '—'}</strong>{' '}
              (el almacén de esta orden) para cubrir la factura. Si el stock está en otro almacén,
              transfiérelo o cambia el almacén de la orden; si no existe en ninguno, ingrésalo al inventario.
              <br/><strong>Tocá el SKU</strong> para abrir una transferencia directa en el módulo de Inventario.
            </p>
            <table className="tbl" style={{fontSize:12.5, width:'100%'}}>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th className="num">Necesario</th>
                  <th className="num">En stock</th>
                  <th className="num" style={{color:'#dc2626'}}>Faltante</th>
                </tr>
              </thead>
              <tbody>
                {stockAlert.map(it => (
                  <tr key={it.sku}>
                    <td className="mono-cell">
                      <button type="button"
                        onClick={() => { try { sessionStorage.setItem('ss-inv-open-transfer', it.sku); } catch(e){} setStockAlert(null); window.__ssNavigate?.('/inventario'); }}
                        title={`Abrir transferencia de ${it.sku} en Inventario`}
                        style={{background:'none', border:'none', padding:0, cursor:'pointer', color:'var(--brand)', fontFamily:'var(--mono)', fontSize:'inherit', fontWeight:600, textDecoration:'underline', textUnderlineOffset:2, display:'inline-flex', alignItems:'center', gap:3}}>
                        {it.sku}<Icon name="external" size={11}/>
                      </button>
                    </td>
                    <td style={{maxWidth:180}}>
                      <div style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{it.nombre}</div>
                      {it.otros && it.otros.length > 0
                        ? <div style={{fontSize:11, color:'var(--success)', whiteSpace:'normal', marginTop:2}}>
                            Disponible en: {it.otros.map(o => `${o.almacen} (${o.cantidad})`).join(', ')}
                          </div>
                        : (it.comprometido > 0
                            ? null   // el desglose va abajo, con nombre y apellido
                            : <div style={{fontSize:11, color:'var(--text-muted)', marginTop:2}}>Sin stock en ningún almacén</div>)}
                      {/* Quién retiene la mercancía. Antes esto salía bajo el rótulo "Disponible en:"
                          y EN VERDE — el rótulo decía lo contrario de lo que pasaba, y el número no
                          venía con el id de la factura, así que no se podía actuar. Una factura con
                          su despacho ya entregado se marca aparte: esa retiene mercancía que salió
                          y hay que corregirla, no esperarla (ver migracion-odoo/90). */}
                      {it.comprometido > 0 && (
                        <div style={{fontSize:11, color:'var(--warn)', whiteSpace:'normal', marginTop:2}}>
                          {it.fisicoReal} en existencia · {it.comprometido} retenida(s) por:{' '}
                          {it.retenidoPor && it.retenidoPor.length > 0
                            ? it.retenidoPor.map((r, i) => (
                                <React.Fragment key={r.documento_id}>
                                  {i > 0 && ', '}
                                  <a href={window.ssHrefRuta('/facturas')} className="mono"
                                     title={r.ya_entregada
                                       ? `${r.documento_id} ya tiene su despacho entregado: retiene mercancía que salió. Hay que corregirla.`
                                       : `${r.documento_id} (${r.fecha}) está emitida y todavía sin despachar.`}
                                     onClick={e => { e.preventDefault(); setStockAlert(null);
                                       window.__ssDocListPreset = { stage: 'factura', search: r.documento_id };
                                       window.__ssNavigate?.('/facturas'); }}>
                                    {r.documento_id}
                                  </a>
                                  {' '}({r.pendiente}){r.ya_entregada && <strong title="Su despacho ya fue entregado"> · ya entregada</strong>}
                                </React.Fragment>
                              ))
                            : 'otras facturas emitidas y sin despachar'}
                        </div>
                      )}
                    </td>
                    <td className="num">{it.qty}</td>
                    <td className="num">
                      {it.disponible}
                      {/* Con 20 físicas y 40 en hold, "En stock 20" era engañoso: lo que importa es
                          cuánto se puede facturar. Se desglosa para que se entienda de dónde sale. */}
                      {it.fisico != null && it.hold > 0 && (
                        <div className="small muted" style={{fontSize:10.5, fontWeight:400}}>
                          {it.fisico} físicas − {it.hold} en hold
                        </div>
                      )}
                    </td>
                    <td className="num" style={{color:'#dc2626',fontWeight:700}}>−{it.faltante}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Y de QUÉ órdenes viene ese hold: sin esto el aviso dice que no se puede facturar y no
                dónde está la mercancía comprometida. */}
            <HoldDeOrdenes items={stockAlert} almacenId={getAlmacenDefault(doc.almacen_id)} docId={doc.id}/>
          </div>
          <div className="modal-footer">
            <button className="btn primary" onClick={() => setStockAlert(null)}>Entendido</button>
          </div>
        </div>
      </div>
    )}
    {yaGenerado && (() => {
      // Doble clic (o dos pestañas, o dos usuarios): el documento ya existe. Se dice cuál es y se
      // ofrece abrirlo, en vez de crear un segundo con su CxC y su promesa de mercancía.
      const et = yaGenerado.etapa === 'factura'
        ? { titulo: 'Esta orden ya está facturada', que: 'factura', icono: 'receipt' }
        : { titulo: 'Esta cotización ya se convirtió', que: 'orden de venta', icono: 'chevronR' };
      return (
        <div className="modal-overlay" onClick={() => setYaGenerado(null)} style={{zIndex:320}}>
          <div className="modal" style={{width:'min(520px,96vw)'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <div style={{width:38,height:38,borderRadius:9,background:'#fef3c718',color:'#b45309',display:'grid',placeItems:'center',flexShrink:0}}>
                <Icon name="alert" size={20}/>
              </div>
              <div style={{flex:1}}>
                <div className="modal-title" style={{color:'#b45309'}}>{et.titulo}</div>
                <div className="small muted">No se genera otra para no duplicar</div>
              </div>
              <button className="icon-btn" onClick={() => setYaGenerado(null)}><Icon name="x" size={14}/></button>
            </div>
            <div className="modal-body">
              <p style={{fontSize:13, lineHeight:1.5, marginBottom:12}}>
                {yaGenerado.docs.length === 1
                  ? <>Ya existe la {et.que} <strong>{yaGenerado.docs[0].id}</strong> para {doc.id}.</>
                  : <>Ya existen {yaGenerado.docs.length} {et.que}s para {doc.id}.</>}
                {' '}Si la anterior está mal, cancelala o eliminala primero — así no queda una venta
                cobrada dos veces ni mercancía prometida de más.
              </p>
              <div style={{display:'flex', flexDirection:'column', gap:6}}>
                {yaGenerado.docs.map(h => (
                  <button key={h.id} className="btn secondary" style={{justifyContent:'space-between'}}
                          onClick={() => { setYaGenerado(null); navigateToSibling(h); }}>
                    <span style={{display:'flex', alignItems:'center', gap:7}}>
                      <Icon name={et.icono} size={13}/><span className="mono">{h.id}</span>
                    </span>
                    <span className="muted small">{fmt.date(h.fecha)}{h.total != null ? ' · ' + fmt.usd(parseFloat(h.total) || 0) : ''}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn primary" onClick={() => setYaGenerado(null)}>Entendido</button>
            </div>
          </div>
        </div>
      );
    })()}
    {ordenDupDetalle && (() => {
      // Mismo aviso que en el compositor, pero acá la mercancía sale de las líneas del documento.
      const uds = (lines || []).reduce((s, l) => s + (Number(l.qty ?? l.cantidad) || 0), 0);
      return (
        <div className="modal-overlay" onClick={() => setOrdenDupDetalle(null)} style={{zIndex:320}}>
          <div className="modal" style={{width:'min(560px,96vw)'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{width:38,height:38,borderRadius:9,background:'#fef3c718',color:'#b45309',display:'grid',placeItems:'center',flexShrink:0}}>
                <Icon name="alert" size={20}/>
              </div>
              <div style={{flex:1}}>
                <div className="modal-title" style={{color:'#b45309'}}>
                  {ordenDupDetalle.docs.length === 1 ? 'Ya existe esta misma orden' : 'Ya existen órdenes iguales'}
                </div>
                <div className="small muted">Mismo cliente, mismos productos y mismas cantidades</div>
              </div>
              <button className="icon-btn" onClick={() => setOrdenDupDetalle(null)}><Icon name="x" size={14}/></button>
            </div>
            <div className="modal-body">
              <p style={{fontSize:13, lineHeight:1.5, marginBottom:12}}>
                Esta cotización no se convirtió todavía, pero la misma mercancía ya está pedida para
                este cliente en {ordenDupDetalle.docs.length === 1 ? 'otra orden' : 'otras órdenes'}:
              </p>
              <div style={{display:'flex', flexDirection:'column', gap:6, marginBottom:14}}>
                {ordenDupDetalle.docs.map(d => (
                  <button key={d.id} className="btn secondary" style={{justifyContent:'space-between'}}
                          onClick={() => { setOrdenDupDetalle(null); navigateToSibling(d); }}>
                    <span style={{display:'flex', alignItems:'center', gap:7}}>
                      <Icon name="chevronR" size={13}/><span className="mono">{d.id}</span>
                    </span>
                    <span className="muted small">
                      {fmt.date(d.fecha)}{d.total != null ? ' · ' + fmt.usd(parseFloat(d.total) || 0) : ''}
                      {d.estado ? ' · ' + d.estado : ''}
                    </span>
                  </button>
                ))}
              </div>
              <div style={{background:'rgba(251,191,36,.09)', border:'1px solid rgba(251,191,36,.3)', borderRadius:10, padding:'12px 14px'}}>
                <div style={{fontSize:13, lineHeight:1.55}}>
                  Si la conviertes igual, se van a reservar <strong>{uds} unidad{uds === 1 ? '' : 'es'} más</strong> de
                  inventario. Esa mercancía queda en <strong>hold</strong> a nombre de las dos órdenes y deja de estar
                  disponible para facturar, hasta que canceles la que sobra.
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
              <button className="btn secondary" onClick={() => setOrdenDupDetalle(null)}>Cancelar</button>
              <button className="btn primary" style={{background:'#d97706', borderColor:'#d97706'}}
                      onClick={() => { const go = ordenDupDetalle.continuar; setOrdenDupDetalle(null); go && go(); }}>
                Convertir de todas formas
              </button>
            </div>
          </div>
        </div>
      );
    })()}
    {actLogOpen && <DocActivityLogModal doc={doc} onClose={() => setActLogOpen(false)}/>}
    {showPdfModal && (
      <PdfModoModal
        doc={doc}
        tipoLabel={stageLabel[tipo]}
        onClose={() => setShowPdfModal(false)}
        onConfirm={modo => { setShowPdfModal(false); window.generateDocumentPDF && window.generateDocumentPDF(doc, lines, modo); }}
      />
    )}
    {previewOpen && <DocumentPreviewPanel doc={{ ...doc, lines }} onClose={() => setPreviewOpen(false)}/>}
    {showStats && <DocVistasModal docId={doc.id} onClose={() => setShowStats(false)}/>}
    {fabricarTodo && window.EnviarAFabricarModal && (
      <window.EnviarAFabricarModal doc={doc} cliente={cli} lineas={fabricarTodo} onClose={() => setFabricarTodo(null)} onCreated={onOFCreada} />
    )}
    {fabricarLinea && window.EnviarAFabricarModal && (
      <window.EnviarAFabricarModal doc={doc} cliente={cli} linea={fabricarLinea} onClose={() => setFabricarLinea(null)} onCreated={onOFCreada} />
    )}
    {showFacturarModal && (
      // El overlay ignora los clics de los primeros 300 ms: con un doble clic sobre "Generar
      // Factura", el segundo caía sobre el overlay recién abierto y lo cerraba — el usuario veía
      // "no pasó nada", que es justo lo que se estaba tratando de evitar.
      <div className="modal-overlay" onClick={() => { if (Date.now() - facturarAbiertoEn.current > 300) setShowFacturarModal(false); }} style={{zIndex:300}}>
        <div className="modal" onClick={e => e.stopPropagation()} style={{width:'min(560px,96vw)'}}>
          <div className="modal-header">
            <div style={{width:38,height:38,borderRadius:9,background:'#d1fae518',color:'#047857',display:'grid',placeItems:'center'}}>
              <Icon name="receipt" size={18}/>
            </div>
            <div style={{flex:1}}>
              <div className="modal-title">Generar Factura</div>
              <div className="small">Orden {doc.id} · selecciona el tipo de factura</div>
            </div>
            <button className="icon-btn" onClick={() => setShowFacturarModal(false)}><Icon name="x" size={14}/></button>
          </div>
          <div className="modal-body" style={{display:'flex', gap:12, flexWrap:'wrap'}}>
            {[{v:'fiscal',label:'Factura Fiscal',desc:'Documento oficial con número de control'},{v:'nota',label:'Nota de Factura',desc:'Documento interno sin número de control'}].map(op => (
              <button key={op.v} className="btn secondary" style={{flex:'1 1 200px', minWidth:0, flexDirection:'column', padding:'16px 14px', gap:5, height:'auto', alignItems:'flex-start', whiteSpace:'normal', textAlign:'left'}}
                onClick={async () => { setShowFacturarModal(false); await executePromote('factura', { tipo_factura: op.v }); }}>
                <span style={{fontWeight:600, fontSize:13}}>{op.label}</span>
                <span style={{fontSize:11, color:'var(--text-2)', fontWeight:400, whiteSpace:'normal', lineHeight:1.4}}>{op.desc}</span>
              </button>
            ))}
          </div>
          <div className="modal-footer">
            <button className="btn ghost" onClick={() => setShowFacturarModal(false)}>Cancelar</button>
          </div>
        </div>
      </div>
    )}
    {showDespachoModal && (
      <NuevoDespachoModal
        factura={doc}
        lines={lines}
        reactivarId={despachoReactivable?.id || null}
        onClose={() => setShowDespachoModal(false)}
        onCreated={(despachoId) => {
          setShowDespachoModal(false);
          window.dispatchEvent(new CustomEvent('ss-doc-version-bump', { detail: { id: doc.id, despachoId } }));
          if (despachoId) window.__ssNavigate?.(`/despachos`);
        }}
      />
    )}
    {showPagoModal && cxcDoc && (
      <RegistrarPagoModal
        doc={doc}
        cxc={cxcDoc}
        onClose={() => setShowPagoModal(false)}
        onPaid={() => {
          const updated = (SSData.cuentasCobrar||[]).find(c => c.factura === doc.id);
          if (updated) setCxcDoc({...updated});
          setShowPagoModal(false);
        }}
      />
    )}
    {asignarSerLine && (
      <AsignarSerialesModal
        doc={doc}
        line={asignarSerLine}
        readOnly={window.canUser ? !window.canUser('editar', 'pos_seriales') : false}
        onClose={() => setAsignarSerLine(null)}
        onSaved={() => setSerialesReloadKey(k => k + 1)}
      />
    )}
    {cancelOpen && (
      <div className="modal-overlay" onClick={() => !canceling && setCancelOpen(false)} style={{zIndex:320}}>
        <div className="modal" onClick={e => e.stopPropagation()} style={{width:'min(520px,96vw)'}}>
          <div className="modal-header">
            <div style={{width:38,height:38,borderRadius:9,background:'#fee2e2',color:'#dc2626',display:'grid',placeItems:'center'}}>
              <Icon name="x" size={18}/>
            </div>
            <div style={{flex:1}}>
              {/* Este modal solo se ofrece para cotización/orden (ver botón de arriba) — el título
                  antes decía "orden" siempre, aunque se abriera desde una cotización. */}
              <div className="modal-title">Cancelar {tipo === 'orden' ? 'orden' : 'cotización'} {doc.id}</div>
              <div className="small">Quedará marcada como CANCELADA, visible en su pestaña propia. Esta acción libera los S/N asignados.</div>
            </div>
            <button className="icon-btn" disabled={canceling} onClick={() => setCancelOpen(false)}><Icon name="x" size={14}/></button>
          </div>
          <div className="modal-body" style={{display:'flex', flexDirection:'column', gap:10}}>
            <label className="small" style={{fontWeight:600}}>Motivo de cancelación <span style={{color:'#dc2626'}}>*</span></label>
            <textarea
              className="input"
              rows={4}
              autoFocus
              placeholder="Indica el motivo de la cancelación (mínimo 10 caracteres). Ej: cliente desistió, error en pedido, falta de stock confirmado…"
              value={cancelMotivo}
              onChange={e => setCancelMotivo(e.target.value)}
              style={{resize:'vertical', minHeight:90, fontSize:13}}
            />
            <div className="small" style={{color: cancelMotivo.trim().length < 10 ? '#dc2626' : 'var(--text-2)'}}>
              {cancelMotivo.trim().length}/10 caracteres mínimos
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn ghost" disabled={canceling} onClick={() => setCancelOpen(false)}>No cancelar</button>
            <button className="btn danger" disabled={canceling || cancelMotivo.trim().length < 10} onClick={handleConfirmCancel}>
              <Icon name="x" size={14}/>{canceling ? 'Cancelando…' : 'Confirmar cancelación'}
            </button>
          </div>
        </div>
      </div>
    )}
    {anularOpen && (
      <div className="modal-overlay" onClick={() => { if (!anulando && !pagoOpciones) { setAnularOpen(false); setPagoOpciones(null); } }} style={{zIndex:320}}>
        <div className="modal" onClick={e => e.stopPropagation()} style={{width:'min(520px,96vw)'}}>
          <div className="modal-header">
            <div style={{width:38,height:38,borderRadius:9,background:'#fee2e2',color:'#dc2626',display:'grid',placeItems:'center'}}>
              <Icon name="x" size={18}/>
            </div>
            <div style={{flex:1}}>
              <div className="modal-title">Anular {tipo === 'despacho' ? 'despacho' : 'factura'} {doc.id}</div>
              <div className="small">Quedará marcada como ANULADA, visible en su pestaña propia — el documento NO se borra.</div>
            </div>
            <button className="icon-btn" disabled={anulando} onClick={() => { setAnularOpen(false); setPagoOpciones(null); }}><Icon name="x" size={14}/></button>
          </div>
          {pagoOpciones ? (
            // El documento tiene un pago ya registrado en banco: hay que decidir su destino ANTES
            // de que la anulación siga (window.anularDocumento se detuvo justo acá).
            <>
              <div className="modal-body" style={{display:'flex', flexDirection:'column', gap:10}}>
                <div className="small" style={{background:'#fef3c7', border:'1px solid #fde68a', borderRadius:6, padding:'8px 12px', color:'#92400e'}}>
                  Este documento tiene {pagoOpciones.length > 1 ? `${pagoOpciones.length} pagos registrados` : 'un pago registrado'} en banco.
                  ¿Qué hacemos con {pagoOpciones.length > 1 ? 'ellos' : 'él'} antes de anular?
                </div>
                <button className="btn secondary" disabled={anulando} onClick={() => handleConfirmAnular('eliminar')}>
                  Eliminar el pago — la deuda vuelve a quedar pendiente
                </button>
                <button className="btn secondary" disabled={anulando} onClick={() => handleConfirmAnular('desvincular')}>
                  Dejarlo como ingreso desvinculado — pendiente de aplicar
                </button>
              </div>
              <div className="modal-footer">
                <button className="btn ghost" disabled={anulando} onClick={() => setPagoOpciones(null)}>Atrás</button>
              </div>
            </>
          ) : (
            <>
              <div className="modal-body" style={{display:'flex', flexDirection:'column', gap:10}}>
                <label className="small" style={{fontWeight:600}}>Motivo de anulación <span style={{color:'#dc2626'}}>*</span></label>
                <textarea
                  className="input"
                  rows={4}
                  autoFocus
                  placeholder="Indica el motivo de la anulación (mínimo 10 caracteres). Ej: error de facturación, pedido duplicado…"
                  value={anularMotivo}
                  onChange={e => setAnularMotivo(e.target.value)}
                  style={{resize:'vertical', minHeight:90, fontSize:13}}
                />
                <div className="small" style={{color: anularMotivo.trim().length < 10 ? '#dc2626' : 'var(--text-2)'}}>
                  {anularMotivo.trim().length}/10 caracteres mínimos
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn ghost" disabled={anulando} onClick={() => setAnularOpen(false)}>No anular</button>
                <button className="btn danger" disabled={anulando || anularMotivo.trim().length < 10} onClick={() => handleConfirmAnular(null)}>
                  <Icon name="x" size={14}/>{anulando ? 'Anulando…' : 'Confirmar anulación'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )}
    </>
  );
}

// ====================== Modal estadísticas de vistas URL pública ======================
function DocVistasModal({ docId, onClose }) {
  const [vistas, setVistas]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.getDocVistas(docId).then(data => { setVistas(data); setLoading(false); });
  }, [docId]);

  function fmtDur(seg) {
    if (seg == null) return '—';
    if (seg < 60)   return seg + 's';
    const m = Math.floor(seg / 60), s = seg % 60;
    return m + 'm ' + (s > 0 ? s + 's' : '');
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString('es-VE', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'America/Caracas' });
    } catch(e) { return ts; }
  }

  // Aggregate stats
  const totalVistas    = vistas?.length || 0;
  const uniqueIPs      = new Set((vistas || []).map(v => v.ip).filter(Boolean)).size;
  const avgDur         = (() => {
    const vals = (vistas || []).map(v => v.duracion_seg).filter(v => v != null);
    return vals.length ? Math.round(vals.reduce((a,b) => a+b, 0) / vals.length) : null;
  })();
  const topCiudad = (() => {
    const map = {};
    (vistas || []).forEach(v => { if (v.ciudad) map[v.ciudad] = (map[v.ciudad] || 0) + 1; });
    const sorted = Object.entries(map).sort((a,b) => b[1]-a[1]);
    return sorted[0]?.[0] || null;
  })();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 680 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ width:40, height:40, borderRadius:10, background:'var(--brand-soft)', color:'var(--brand)', display:'grid', placeItems:'center', flexShrink:0 }}>
            <Icon name="chart" size={20}/>
          </div>
          <div style={{ flex:1 }}>
            <h3 className="modal-title">Estadísticas de vistas</h3>
            <div className="small muted">URL pública · {docId}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div style={{ textAlign:'center', padding:'32px 0', color:'var(--text-muted)', fontSize:13 }}>Cargando estadísticas…</div>
          ) : totalVistas === 0 ? (
            <div style={{ textAlign:'center', padding:'32px 0' }}>
              <div style={{ fontSize:36, marginBottom:8 }}>👁</div>
              <div style={{ fontWeight:600, marginBottom:4 }}>Sin vistas aún</div>
              <div className="small muted">Nadie ha abierto el enlace público todavía.</div>
            </div>
          ) : (
            <>
              {/* KPI cards */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:18 }}>
                {[
                  ['Vistas totales', totalVistas, 'var(--brand)'],
                  ['IPs únicas',     uniqueIPs,   'var(--success)'],
                  ['Tiempo promedio', fmtDur(avgDur), 'var(--warn)'],
                  ['Ciudad top',     topCiudad || '—', 'var(--text-muted)'],
                ].map(([lbl, val, color]) => (
                  <div key={lbl} className="stat" style={{ background:'var(--bg-sunken)', borderRadius:8, padding:'10px 12px' }}>
                    <div className="stat-label">{lbl}</div>
                    <div className="stat-val" style={{ fontSize:18, color }}>{val}</div>
                  </div>
                ))}
              </div>

              {/* Detail table */}
              <div className="tbl-wrap">
                <div className="tbl-scroll">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Fecha y hora</th>
                        <th>IP</th>
                        <th>Ciudad</th>
                        <th>País / Región</th>
                        <th className="num">Duración</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vistas.map(v => (
                        <tr key={v.id}>
                          <td className="small">{fmtDate(v.created_at)}</td>
                          <td className="mono-cell">{v.ip || '—'}</td>
                          <td>{v.ciudad || '—'}</td>
                          <td className="small muted">{[v.pais, v.region].filter(Boolean).join(' · ') || '—'}</td>
                          <td className="num">{fmtDur(v.duracion_seg)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose}>Cerrar</button>
          {!loading && totalVistas > 0 && (
            <button className="btn ghost" onClick={() => window.getDocVistas(docId).then(d => { setVistas(d); })}>
              <Icon name="refresh" size={13}/>Actualizar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// PosOpcionesModal — Administrar fuentes de venta y tipos de entrega
// ══════════════════════════════════════════════════════════════════════════
function PosOpcionesModal({ onClose }) {
  const [tab, setTab]       = useState('fuentes');
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editItem, setEditItem] = useState(null); // null | { tabla, item }
  const [saving, setSaving]   = useState(false);

  // Carga datos frescos al abrir el modal
  React.useEffect(() => {
    let alive = true;
    window.loadAppData().then(() => { if (alive) { setLoading(false); setVersion(v => v + 1); } });
    return () => { alive = false; };
  }, []);

  // Live data from SSData (reloads after mutations)
  const fuentes = (SSData.fuentesVenta  || []);
  const tipos   = (SSData.tiposEntrega  || []);

  const items   = tab === 'fuentes' ? fuentes : tipos;
  const tabla   = tab === 'fuentes' ? 'pos_fuentes_venta' : 'pos_tipos_entrega';

  function newId(prefix) {
    return prefix + '-' + Date.now().toString(36);
  }

  async function handleSave(nombre, extra = {}) {
    if (!nombre.trim()) return;
    setSaving(true);
    const isNew = !editItem?.item?.id;
    const item  = {
      id:     editItem?.item?.id || newId(tab === 'fuentes' ? 'fv' : 'te'),
      nombre: nombre.trim(),
      orden:  editItem?.item?.orden ?? items.length + 1,
      activo: true,
      // El código se calcula UNA vez, al crear, y no se recalcula al renombrar: es lo que
      // quedó escrito en cada documento emitido. Renombrar cambia el rótulo, no la historia.
      valor:  editItem?.item?.valor || window.ssSlugOpcion(nombre),
    };
    if (tab !== 'fuentes') {
      item.requiere_zona = !!extra.requiere_zona;
      item.requiere_guia = !!extra.requiere_guia;
    }
    // Dos opciones con el mismo código son ambiguas en el desplegable (y la base las rechaza
    // con el índice único de la migración 81): se avisa acá, con nombre y todo.
    const choque = items.find(o => o.activo !== false && o.id !== item.id && (o.valor || window.ssSlugOpcion(o.nombre)) === item.valor);
    if (choque) {
      alert(`Ya existe una opción con ese nombre: "${choque.nombre}".`);
      setSaving(false);
      return;
    }
    const { error } = await window.savePosOpcion(tabla, item);
    if (error) { alert('Error: ' + error.message); setSaving(false); return; }
    window.logActivity?.({ modulo:'pos', accion: isNew ? 'crear' : 'editar', entidad_label: nombre.trim(), detalles: { tipo: tab } });
    await window.loadAppData();
    setSaving(false);
    setEditItem(null);
    setVersion(v => v+1);
  }

  async function handleDelete(item) {
    if (!confirm(`¿Eliminar "${item.nombre}"?`)) return;
    const { error } = await window.deletePosOpcion(tabla, item.id);
    if (error) { alert('Error: ' + error.message); return; }
    window.logActivity?.({ modulo:'pos', accion:'eliminar', entidad_label: item.nombre, detalles: { tipo: tab } });
    await window.loadAppData();
    setVersion(v => v+1);
  }

  // Solo cerrar si mousedown Y mouseup ocurren sobre el overlay (no sobre un hijo).
  const overlayMouseDownRef = React.useRef(false);
  return (
    <div
      className="modal-overlay"
      onMouseDown={e => { overlayMouseDownRef.current = (e.target === e.currentTarget); }}
      onMouseUp={e => {
        if (overlayMouseDownRef.current && e.target === e.currentTarget) onClose();
        overlayMouseDownRef.current = false;
      }}
    >
      <div className="modal" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} style={{ width: 520 }}>
        <div className="modal-header">
          <div style={{ width:40, height:40, borderRadius:10, background:'var(--brand-soft)', color:'var(--brand)', display:'grid', placeItems:'center' }}>
            <Icon name="settings" size={20}/>
          </div>
          <div style={{ flex:1 }}>
            <h3 className="modal-title">Opciones del POS</h3>
            <div className="small muted">Configura las listas de Fuentes de venta y Tipos de entrega</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', borderBottom:'1px solid var(--border)', padding:'0 20px' }}>
          {[['fuentes','Fuentes de venta'],['tipos','Tipos de entrega']].map(([id,label]) => (
            <button key={id} onClick={() => { setTab(id); setEditItem(null); }} style={{
              padding:'10px 16px', border:'none', background:'transparent', cursor:'pointer', fontSize:13,
              fontWeight: tab===id ? 600 : 400,
              color: tab===id ? 'var(--brand)' : 'var(--text-muted)',
              borderBottom: tab===id ? '2px solid var(--brand)' : '2px solid transparent',
            }}>
              {label}
              <span style={{ marginLeft:6, fontSize:11, padding:'1px 6px', borderRadius:99, background:'var(--bg-sunken)', color:'var(--text-muted)' }}>
                {tab===id ? items.length : (id==='fuentes' ? fuentes.length : tipos.length)}
              </span>
            </button>
          ))}
        </div>

        <div className="modal-body" style={{ maxHeight:460, overflowY:'auto' }}>
          {/* Add / edit form */}
          <OpcionForm
            key={editItem?.item?.id || 'new-'+tab}
            item={editItem?.item || null}
            saving={saving}
            esEntrega={tab !== 'fuentes'}
            onSave={handleSave}
            onCancel={() => setEditItem(null)}
          />

          {/* List */}
          <div style={{ marginTop:16 }}>
            {items.filter(i => i.activo !== false).length === 0 && (
              loading
                ? <div style={{ textAlign:'center', padding:'24px 0', color:'var(--text-muted)', fontSize:13 }}>Cargando…</div>
                : <div style={{ textAlign:'center', padding:'24px 0', color:'var(--text-muted)', fontSize:13 }}>Sin opciones. Agrega la primera arriba.</div>
            )}
            {items.filter(i => i.activo !== false).map(item => (
              <div key={item.id} style={{
                display:'flex', alignItems:'center', gap:10, padding:'10px 12px',
                border:'1px solid var(--border)', borderRadius:8, marginBottom:6,
                background: editItem?.item?.id===item.id ? 'var(--brand-soft)' : 'var(--bg-card)',
              }}>
                <div style={{ width:28, height:28, borderRadius:8, background:'var(--bg-sunken)', display:'grid', placeItems:'center', flexShrink:0 }}>
                  <Icon name={tab==='fuentes' ? 'link' : 'truck'} size={14}/>
                </div>
                <div style={{ flex:1, fontWeight:500, fontSize:14 }}>{item.nombre}</div>
                {tab !== 'fuentes' && item.requiere_zona && (
                  <span className="chip" title="Pide zona de envío y agrega la línea de flete">
                    <Icon name="truck" size={10}/> Con envío
                  </span>
                )}
                {tab !== 'fuentes' && item.requiere_guia && (
                  <span className="chip" title="Pide transportista y número de guía">
                    <Icon name="box" size={10}/> Con guía
                  </span>
                )}
                <div style={{ display:'flex', gap:4 }}>
                  <button className="icon-btn" title="Editar" onClick={() => setEditItem({ tabla, item })}>
                    <Icon name="edit" size={14}/>
                  </button>
                  <button className="icon-btn danger" title="Eliminar" onClick={() => handleDelete(item)}>
                    <Icon name="trash" size={14}/>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn primary" onClick={onClose}>Listo</button>
        </div>
      </div>
    </div>
  );
}

function OpcionForm({ item, saving, onSave, onCancel, esEntrega }) {
  const isEdit = !!item;
  const [nombre, setNombre] = useState(item?.nombre || '');
  const [zona, setZona]     = useState(!!item?.requiere_zona);
  const [guia, setGuia]     = useState(!!item?.requiere_guia);
  const guardar = () => { if (nombre.trim()) onSave(nombre, { requiere_zona: zona, requiere_guia: guia }); };

  return (
    <div>
      <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
        <div style={{ flex:1 }}>
          <label className="form-label">{isEdit ? 'Editar opción' : 'Nueva opción'}</label>
          <input
            className="input"
            placeholder="Nombre de la opción…"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') guardar(); }}
            autoFocus
            style={{ width:'100%' }}
          />
        </div>
        {isEdit && (
          <button className="btn ghost" onClick={onCancel} disabled={saving}>Cancelar</button>
        )}
        <button
          className="btn primary"
          disabled={saving || !nombre.trim()}
          onClick={guardar}
          style={{ whiteSpace:'nowrap' }}
        >
          <Icon name={isEdit ? 'check' : 'plus'} size={14}/>
          {saving ? 'Guardando…' : isEdit ? 'Guardar' : 'Agregar'}
        </button>
      </div>
      {/* Lo que antes estaba escrito en el código (`delivery` y `encomienda` a mano) y por eso
          una entrega nueva como MRW nacía sin pedir dirección de envío. */}
      {esEntrega && (
        <label style={{ display:'flex', alignItems:'center', gap:7, marginTop:8, fontSize:12.5, cursor:'pointer' }}>
          <input type="checkbox" checked={zona} onChange={e => setZona(e.target.checked)}/>
          <span>Pide zona / dirección de envío <span className="muted">(y agrega la línea de flete en el POS)</span></span>
        </label>
      )}
      {esEntrega && (
        <label style={{ display:'flex', alignItems:'center', gap:7, marginTop:5, fontSize:12.5, cursor:'pointer' }}>
          <input type="checkbox" checked={guia} onChange={e => setGuia(e.target.checked)}/>
          <span>Va por transportista <span className="muted">(pide transportista y número de guía)</span></span>
        </label>
      )}
      {isEdit && item?.valor && (
        <div className="small muted" style={{ marginTop:6 }}>
          Código guardado en los documentos: <code>{item.valor}</code> — no cambia al renombrar la opción.
        </div>
      )}
    </div>
  );
}

Object.assign(window, { POSPage: window.POSPage, PdfModoModal });

// Se expone para el banco de pruebas visual (mismo patrón que NuevoDespachoModal/DeclararEntrega).
window.DocumentDetail = DocumentDetail;
// El modo EDICIÓN del compositor solo se alcanza desde la lista (startEdit): montarlo directo es la
// única forma de fijar su comportamiento en el banco de pruebas.
window.POSCompose = POSCompose;
