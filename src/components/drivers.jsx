// ══════════════════════════════════════════════════════════════════════════
//  drivers.jsx — Módulo de Drivers + Portal Móvil + Incidencias
// ══════════════════════════════════════════════════════════════════════════
const { useState, useEffect, useRef, useCallback, useMemo } = React;

if (!SSData.drivers)         SSData.drivers = [];
if (!SSData.driverDespachos) SSData.driverDespachos = [];
if (!SSData.incidencias)     SSData.incidencias = [];

// ─── ID generators ───────────────────────────────────────────────────────
function getNextIncId() {
  const max = SSData.incidencias.map(i => parseInt((i.id||'').replace('INC-',''),10)||0).reduce((a,b)=>Math.max(a,b),0);
  return 'INC-' + String(max+1).padStart(4,'0');
}
function getNextDaId() {
  const max = SSData.driverDespachos.map(i => parseInt((i.id||'').replace('DA-',''),10)||0).reduce((a,b)=>Math.max(a,b),0);
  return 'DA-' + String(max+1).padStart(3,'0');
}
function getNextDrvId() {
  const max = SSData.drivers.map(i => parseInt((i.id||'').replace('DRV-',''),10)||0).reduce((a,b)=>Math.max(a,b),0);
  return 'DRV-' + String(max+1).padStart(3,'0');
}

function driverInitials(nombre) {
  return (nombre||'').split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
}

function driverColor(id) {
  const colors = ['#1e40af','#0f766e','#7c3aed','#b45309','#dc2626','#334155'];
  const idx = parseInt((id||'').replace(/\D/g,''))||0;
  return colors[idx % colors.length];
}

// Normaliza ítems de despacho a { sku, nombre, qty, precio } sin importar el origen
// (documentos_items usa `cantidad`/`precio_unitario`; los docs en memoria usan `qty`/`precio`).
function normalizeDespachoLines(raw) {
  return (raw || []).map(l => ({
    sku:    l.sku,
    nombre: l.nombre,
    qty:    l.qty != null ? l.qty : (l.cantidad != null ? l.cantidad : 0),
    precio: l.precio != null ? l.precio : l.precio_unitario,
  }));
}

// Hook: devuelve los ítems REALES de un despacho.
// - Si el documento ya trae `lines` en memoria (docs recientes), los usa directo.
// - Si no (despachos migrados sin lines), consulta documentos_items en Supabase.
// NUNCA fabrica líneas sintéticas/aleatorias.
function useDespachoLines(doc) {
  const hasInline = !!(doc && Array.isArray(doc.lines));
  const docId     = doc && doc.id;
  const [state, setState] = useState(() =>
    hasInline
      ? { lines: normalizeDespachoLines(doc.lines), loading: false }
      : { lines: [], loading: !!docId }
  );
  useEffect(() => {
    let cancelled = false;
    if (!docId)     { setState({ lines: [], loading: false }); return; }
    if (hasInline)  { setState({ lines: normalizeDespachoLines(doc.lines), loading: false }); return; }
    setState({ lines: [], loading: true });
    (async () => {
      try {
        const { data, error } = await window.sb
          .from('documentos_items')
          .select('sku,nombre,cantidad,precio_unitario')
          .eq('documento_id', docId);
        if (cancelled) return;
        setState({ lines: normalizeDespachoLines(error ? [] : data), loading: false });
      } catch {
        if (!cancelled) setState({ lines: [], loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, [docId, hasInline]);
  return state;
}

// ─── SignaturePad ─────────────────────────────────────────────────────────
function SignaturePad({ onConfirm }) {
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPos   = useRef(null);
  const [hasStroke, setHasStroke] = useState(false);

  function getPos(e) {
    const canvas = canvasRef.current;
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const src    = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * scaleX, y: (src.clientY - rect.top) * scaleY };
  }
  function start(e) { e.preventDefault(); isDrawing.current = true; lastPos.current = getPos(e); }
  function move(e) {
    e.preventDefault();
    if (!isDrawing.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const pos = getPos(e);
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
    lastPos.current = pos; setHasStroke(true);
  }
  function end(e) { e.preventDefault(); isDrawing.current = false; }
  function clear() { canvasRef.current.getContext('2d').clearRect(0,0,canvasRef.current.width,canvasRef.current.height); setHasStroke(false); }

  return (
    <div>
      <canvas ref={canvasRef} width={600} height={220}
        style={{ border:'1.5px solid var(--border)', borderRadius:10, touchAction:'none', display:'block', width:'100%', background:'#fff', cursor:'crosshair' }}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}/>
      <div style={{ display:'flex', justifyContent:'space-between', marginTop:8 }}>
        <button className="btn ghost sm" onClick={clear}>Limpiar</button>
        <button className="btn primary sm" disabled={!hasStroke} onClick={() => onConfirm(canvasRef.current.toDataURL('image/png'))}>
          <Icon name="check" size={13}/>Guardar firma
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  DRIVER DETAIL PAGE
// ══════════════════════════════════════════════════════════════════════════
function DriverDetailPage({ driver, onBack, onRefresh }) {
  const [tab, setTab]       = useState('despachos');
  const [version, setVersion] = useState(0);
  const [lightbox, setLightbox] = useState(null); // { src, title }
  const [incDetail, setIncDetail] = useState(null);
  const refresh = () => { setVersion(v => v+1); onRefresh?.(); };

  const color = driverColor(driver.id);

  const despachos = useMemo(() => {
    return SSData.driverDespachos
      .filter(dd => dd.driver_id === driver.id)
      .map(dd => {
        const doc = SSData.documentos.find(d => d.id === dd.despacho_id);
        const cli = doc ? SSData.clientes.find(c => c.id === doc.cliente) : null;
        return { ...dd, doc, cli };
      })
      .filter(dd => dd.doc)
      .sort((a,b) => new Date(b.fecha||0) - new Date(a.fecha||0));
  }, [version, driver.id]);

  const incidencias = useMemo(() => {
    return SSData.incidencias
      .filter(i => i.driver_id === driver.id)
      .map(i => ({ ...i, cliente: SSData.clientes.find(c => c.id === i.cliente_id) }))
      .sort((a,b) => new Date(b.fecha||0) - new Date(a.fecha||0));
  }, [version, driver.id]);

  const pendientes  = despachos.filter(dd => dd.estado === 'pendiente' || dd.estado === 'en_ruta');
  const entregados  = despachos.filter(dd => dd.estado === 'entregado' || dd.estado === 'incidencia');

  const estadoChip = { pendiente:'amber', en_ruta:'blue', entregado:'green', incidencia:'red' };
  const estadoLabel = { pendiente:'Pendiente', en_ruta:'En ruta', entregado:'Entregado', incidencia:'Incidencia' };

  return (
    <div className="page">
      {/* Breadcrumb + back */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16 }}>
        <button className="btn ghost sm" onClick={onBack}><Icon name="chevronL" size={13}/>Drivers</button>
        <span style={{ color:'var(--text-muted)', fontSize:13 }}>/</span>
        <span style={{ fontSize:13, fontWeight:600 }}>{driver.nombre}</span>
      </div>

      {/* Driver header card */}
      <div className="card" style={{ padding:20, marginBottom:20, display:'flex', alignItems:'center', gap:20, flexWrap:'wrap' }}>
        <div style={{ width:64, height:64, borderRadius:99, background:color, color:'#fff', display:'grid', placeItems:'center', fontSize:22, fontWeight:700, flexShrink:0 }}>
          {driverInitials(driver.nombre)}
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:700, fontSize:20 }}>{driver.nombre}</div>
          <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:2 }}>
            {driver.cedula} · {driver.telefono}
            {driver.email && <span> · {driver.email}</span>}
          </div>
          <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
            {driver.vehiculo && <span className="chip neutral">{driver.vehiculo}</span>}
            {driver.placa    && <span className="chip neutral">{driver.placa}</span>}
            {driver.zona     && <span className="chip blue">{driver.zona}</span>}
            {driver.licencia && <span className="chip neutral">Lic. {driver.licencia}</span>}
            <span className={'chip '+(driver.activo?'green':'neutral')}>{driver.activo?'Activo':'Inactivo'}</span>
          </div>
        </div>
        {/* Stats row */}
        <div style={{ display:'flex', gap:12 }}>
          {[
            { label:'Pendientes',  value: pendientes.length,  color:'#f59e0b' },
            { label:'Entregados',  value: entregados.filter(d=>d.estado==='entregado').length, color:'#16a34a' },
            { label:'Incidencias', value: incidencias.length, color:'#dc2626' },
          ].map(s => (
            <div key={s.label} style={{ textAlign:'center', padding:'10px 16px', borderRadius:10, background:'var(--bg-sunken)', border:'1px solid var(--border)', minWidth:80 }}>
              <div style={{ fontSize:22, fontWeight:700, color:s.color }}>{s.value}</div>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:2, borderBottom:'1px solid var(--border)', marginBottom:20 }}>
        {[
          { id:'despachos',   label:'Despachos',   count: despachos.length },
          { id:'incidencias', label:'Incidencias',  count: incidencias.length },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            display:'flex', alignItems:'center', gap:6, padding:'8px 16px', fontSize:13,
            fontWeight: tab===t.id ? 600 : 400, border:'none', background:'transparent', cursor:'pointer',
            borderBottom: tab===t.id ? '2px solid var(--brand)' : '2px solid transparent',
            color: tab===t.id ? 'var(--brand)' : 'var(--text-muted)',
          }}>
            {t.label}
            {t.count > 0 && <span style={{ fontSize:11, padding:'1px 6px', borderRadius:99, background: tab===t.id?'var(--brand)':'var(--bg-sunken)', color: tab===t.id?'#fff':'var(--text-muted)', fontWeight:600 }}>{t.count}</span>}
          </button>
        ))}
      </div>

      {/* DESPACHOS TAB */}
      {tab === 'despachos' && (
        <div>
          {despachos.length === 0 && (
            <div style={{ textAlign:'center', padding:'40px 0', color:'var(--text-muted)' }}>
              <Icon name="truck" size={32}/><div style={{ marginTop:8 }}>Sin despachos asignados</div>
            </div>
          )}

          {pendientes.length > 0 && (
            <div style={{ marginBottom:24 }}>
              <div style={{ fontWeight:600, fontSize:13, color:'var(--text-muted)', marginBottom:10, textTransform:'uppercase', letterSpacing:.5 }}>
                Pendientes / En ruta ({pendientes.length})
              </div>
              {pendientes.map(dd => <DespachoCard key={dd.id} dd={dd} onLightbox={setLightbox} estadoChip={estadoChip} estadoLabel={estadoLabel}/>)}
            </div>
          )}

          {entregados.length > 0 && (
            <div>
              <div style={{ fontWeight:600, fontSize:13, color:'var(--text-muted)', marginBottom:10, textTransform:'uppercase', letterSpacing:.5 }}>
                Historial de entregas ({entregados.length})
              </div>
              {entregados.map(dd => <DespachoCard key={dd.id} dd={dd} onLightbox={setLightbox} estadoChip={estadoChip} estadoLabel={estadoLabel}/>)}
            </div>
          )}
        </div>
      )}

      {/* INCIDENCIAS TAB */}
      {tab === 'incidencias' && (
        <div>
          {incidencias.length === 0 && (
            <div style={{ textAlign:'center', padding:'40px 0', color:'var(--text-muted)' }}>
              <Icon name="check" size={32}/><div style={{ marginTop:8 }}>Sin incidencias registradas</div>
            </div>
          )}
          {incidencias.map(inc => (
            <div key={inc.id} className="card" style={{ padding:16, marginBottom:12, cursor:'pointer' }} onClick={() => setIncDetail(inc)}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                <div>
                  <div style={{ fontWeight:600, fontSize:14, fontFamily:'var(--font-mono)' }}>{inc.id}</div>
                  <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:2 }}>
                    Despacho {inc.despacho_id} · {inc.cliente?.nombre || inc.cliente_id}
                  </div>
                  <div style={{ fontSize:13, marginTop:6 }}>{inc.descripcion}</div>
                </div>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6 }}>
                  <span className={'chip '+({ pendiente:'red', en_proceso:'amber', resuelto:'green' }[inc.estado]||'neutral')}>
                    {{ pendiente:'Pendiente', en_proceso:'En proceso', resuelto:'Resuelto' }[inc.estado]||inc.estado}
                  </span>
                  <span style={{ fontSize:11, color:'var(--text-muted)' }}>{fmt.date(inc.fecha)}</span>
                </div>
              </div>
              {(inc.foto || inc.firma) && (
                <div style={{ display:'flex', gap:8, marginTop:10 }}>
                  {inc.foto  && <span className="chip blue">📷 Foto</span>}
                  {inc.firma && <span className="chip neutral">✍ Firma</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.85)', zIndex:1000, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}
          onClick={() => setLightbox(null)}>
          <div style={{ position:'absolute', top:16, right:16 }}>
            <button onClick={() => setLightbox(null)} style={{ background:'rgba(255,255,255,.15)', border:'none', color:'#fff', borderRadius:99, width:40, height:40, cursor:'pointer', display:'grid', placeItems:'center' }}>
              <Icon name="x" size={18}/>
            </button>
          </div>
          <div style={{ fontSize:12, color:'rgba(255,255,255,.7)', marginBottom:12 }}>{lightbox.title}</div>
          <img src={lightbox.src} alt={lightbox.title} style={{ maxWidth:'90vw', maxHeight:'80vh', borderRadius:12, objectFit:'contain', background:'#fff' }} onClick={e=>e.stopPropagation()}/>
        </div>
      )}

      {/* Incidencia detail modal */}
      {incDetail && (
        <IncidenciaDetailModal
          incidencia={incDetail}
          onClose={() => setIncDetail(null)}
          onUpdate={async () => {
            await window.refrescarFase2();
            refresh();
            setIncDetail(null);
          }}
        />
      )}
    </div>
  );
}

function DespachoCard({ dd, onLightbox, estadoChip, estadoLabel }) {
  const { doc, cli, estado } = dd;
  const { lines, loading: linesLoading } = useDespachoLines(doc);
  const isEntregado = estado === 'entregado' || estado === 'incidencia';

  return (
    <div className="card" style={{ padding:16, marginBottom:12 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
        <div>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--text-muted)' }}>{doc.id}</div>
          <div style={{ fontWeight:700, fontSize:15, marginTop:2 }}>{cli?.nombre || doc.cliente}</div>
          {doc.dir_entrega && <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>{doc.dir_entrega}</div>}
          <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>{fmt.date(dd.fecha)}</div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6 }}>
          <span className={'chip '+(estadoChip[estado]||'neutral')}>{estadoLabel[estado]||estado}</span>
          <span style={{ fontWeight:700, fontSize:15, color:'var(--brand)' }}>{fmt.usd(doc.total)}</span>
        </div>
      </div>

      {/* Items list */}
      <div style={{ background:'var(--bg-sunken)', borderRadius:8, padding:'8px 12px', marginBottom:isEntregado?12:0 }}>
        <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:4 }}>{linesLoading ? 'Cargando productos…' : lines.length+' productos'}</div>
        {linesLoading && <div style={{ fontSize:12, color:'var(--text-muted)' }}>—</div>}
        {!linesLoading && lines.slice(0,4).map((l,i) => (
          <div key={i} style={{ display:'flex', justifyContent:'space-between', fontSize:12, padding:'2px 0', borderBottom: i<Math.min(lines.length,4)-1?'1px solid var(--border)':'none' }}>
            <span style={{ color:'var(--text-2)' }}>{l.nombre}</span>
            <span style={{ fontWeight:600, color:'var(--text-1)' }}>×{l.qty}</span>
          </div>
        ))}
        {!linesLoading && lines.length > 4 && <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>+{lines.length-4} más</div>}
      </div>

      {/* Items entregados si hay diferencia */}
      {isEntregado && dd.items_entregados?.length > 0 && (() => {
        const faltantes = dd.items_entregados.filter(i => i.entregado < i.qty);
        if (!faltantes.length) return null;
        return (
          <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:'8px 12px', marginBottom:12 }}>
            <div style={{ fontSize:11, fontWeight:600, color:'#991b1b', marginBottom:4 }}>Faltantes registrados</div>
            {faltantes.map((f,i) => (
              <div key={i} style={{ fontSize:12, color:'#7f1d1d' }}>• {f.nombre}: esperado {f.qty}, entregado {f.entregado}</div>
            ))}
          </div>
        );
      })()}

      {/* Receptor + evidencias */}
      {isEntregado && (
        <div style={{ display:'flex', gap:12, alignItems:'flex-start', flexWrap:'wrap' }}>
          {dd.receptor_nombre && (
            <div style={{ flex:1, minWidth:120 }}>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:2 }}>Receptor</div>
              <div style={{ fontSize:13, fontWeight:600 }}>{dd.receptor_nombre}</div>
            </div>
          )}
          {dd.foto && (
            <div style={{ cursor:'pointer' }} onClick={() => onLightbox({ src: dd.foto, title: 'Foto de entrega · '+doc.id })}>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:4 }}>Foto de entrega</div>
              <img src={dd.foto} alt="entrega" style={{ width:80, height:60, objectFit:'cover', borderRadius:8, border:'1px solid var(--border)' }}/>
              <div style={{ fontSize:10, color:'var(--brand)', marginTop:2, textAlign:'center' }}>Ver foto</div>
            </div>
          )}
          {dd.firma && (
            <div style={{ cursor:'pointer' }} onClick={() => onLightbox({ src: dd.firma, title: 'Firma del cliente · '+doc.id })}>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:4 }}>Firma del cliente</div>
              <img src={dd.firma} alt="firma" style={{ width:80, height:60, objectFit:'contain', borderRadius:8, border:'1px solid var(--border)', background:'#fff' }}/>
              <div style={{ fontSize:10, color:'var(--brand)', marginTop:2, textAlign:'center' }}>Ver firma</div>
            </div>
          )}
          {!dd.foto && !dd.firma && estado === 'entregado' && (
            <div style={{ fontSize:12, color:'var(--text-muted)', fontStyle:'italic' }}>Sin evidencia fotográfica registrada</div>
          )}
        </div>
      )}
      {isEntregado && dd.notas && (
        <div style={{ marginTop:10, padding:'8px 12px', background:'var(--bg-sunken)', borderRadius:8, borderLeft:'3px solid var(--brand)' }}>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:2 }}>Notas del driver</div>
          <div style={{ fontSize:13, color:'var(--text-1)' }}>{dd.notas}</div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  ADMIN — DriversPage
// ══════════════════════════════════════════════════════════════════════════
window.DriversPage = function DriversPage() {
  const [version, setVersion]       = useState(0);
  const [search, setSearch]         = useState('');
  const [modal, setModal]           = useState(null);
  const [deleteId, setDeleteId]     = useState(null);
  const [showActivity, setShowActivity] = useState(false);
  const [selected, setSelected]     = useState(new Set());
  const [detailDriver, setDetailDriver] = useState(null);
  const [page, setPage]             = useState(1);
  const [pageSize, setPageSize]     = useState(() => {
    const v = parseInt(localStorage.getItem('ss-drivers-pagesize'));
    return [50,100,200].includes(v) ? v : 50;
  });
  useEffect(() => { localStorage.setItem('ss-drivers-pagesize', String(pageSize)); }, [pageSize]);

  const refresh = () => setVersion(v => v+1);

  const drivers = useMemo(() => {
    const q   = search.toLowerCase();
    const emp = window.currentEmpresa || 'demo1';
    return SSData.drivers.filter(d =>
      (!d.empresa_id || d.empresa_id === emp) &&
      (!q || (d.nombre||'').toLowerCase().includes(q) || (d.cedula||'').includes(q) || (d.zona||'').toLowerCase().includes(q))
    );
  }, [version, search]);

  const totalPages = Math.max(1, Math.ceil(drivers.length / pageSize));
  const paginated  = drivers.slice((page-1)*pageSize, page*pageSize);

  function toggleAll() { if(selected.size===paginated.length)setSelected(new Set());else setSelected(new Set(paginated.map(d=>d.id))); }
  function toggleOne(id,e) { e.stopPropagation();setSelected(prev=>{const s=new Set(prev);s.has(id)?s.delete(id):s.add(id);return s;}); }

  async function handleDelete(id) {
    const d = SSData.drivers.find(x => x.id === id);
    if (!d) return;
    // Capturar las asignaciones/evidencia de entrega ANTES de borrarlas, para poder restaurarlas.
    const { data: despachos } = await window.sb.from('driver_despachos').select('*').eq('driver_id', id);
    // Soft-delete del driver PRIMERO (valida error antes de tocar los hijos).
    const { error } = await window.deleteDriver(id);
    if (error) { alert('Error al eliminar: ' + error.message); return; }
    await window.sb.from('driver_despachos').delete().eq('driver_id', id);
    window.ssTrash?.add('driver', d.nombre, { ...d, _despachos: despachos || [] });
    await window.refrescarFase2();
    window.logActivity?.({ modulo:'drivers', accion:'eliminar', entidad_id:d.id, entidad_label:d.nombre });
    refresh(); setDeleteId(null);
  }

  function driverStats(drvId) {
    const asignaciones = SSData.driverDespachos.filter(dd => dd.driver_id === drvId);
    return {
      pendientes:  asignaciones.filter(dd => dd.estado==='pendiente'||dd.estado==='en_ruta').length,
      completados: asignaciones.filter(dd => dd.estado==='entregado').length,
      incidencias: SSData.incidencias.filter(i => i.driver_id === drvId).length,
    };
  }

  // Show detail page when a driver is selected
  if (detailDriver) {
    const liveDriver = SSData.drivers.find(d => d.id === detailDriver.id) || detailDriver;
    return (
      <DriverDetailPage
        driver={liveDriver}
        onBack={() => setDetailDriver(null)}
        onRefresh={refresh}
      />
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Drivers</h1>
          <div className="page-subtitle">{SSData.drivers.filter(d=>d.activo).length} activos · {SSData.drivers.length} registrados</div>
        </div>
        <div className="page-actions">
          {window.canUser?.('crear','drivers') !== false && <button className="btn primary" onClick={() => setModal({ type:'add' })}><Icon name="plus" size={14}/>Nuevo driver</button>}
          <button className="btn ghost" onClick={() => setShowActivity(true)} title="Ver actividad"><Icon name="receipt" size={14}/>Actividad</button>
        </div>
      </div>

      {showActivity && <ActivityLogModal modulo="drivers" onClose={()=>setShowActivity(false)}/>}

      <div className="tbl-wrap">
        <div className="tbl-toolbar">
          <div className="search-box">
            <Icon name="search" size={14}/>
            <input className="search-input" placeholder="Buscar driver…" value={search} onChange={e => setSearch(e.target.value)}/>
          </div>
        </div>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{width:36,padding:'4px 10px'}}>
                  <input type="checkbox"
                    ref={el=>{if(el)el.indeterminate=selected.size>0&&selected.size<paginated.length;}}
                    checked={paginated.length>0&&selected.size===paginated.length}
                    onChange={toggleAll} style={{cursor:'pointer'}}/>
                </th>
                <th>Driver</th><th className="hide-sm">Cédula</th><th className="hide-sm">Teléfono</th><th className="hide-sm">Vehículo · Placa</th><th className="hide-sm">Zona</th>
                <th className="num hide-sm">Pendientes</th><th className="num hide-sm">Entregados</th><th className="num hide-sm">Incidencias</th>
                <th>Estado</th><th className="dt-hide-mobile">Creado por</th><th style={{width:120}}></th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(d => {
                const stats = driverStats(d.id);
                const color = driverColor(d.id);
                const isSel = selected.has(d.id);
                return (
                  <tr key={d.id}
                    onClick={e => { if(selected.size>0)toggleOne(d.id,e); else setDetailDriver(d); }}
                    style={{ cursor:'pointer', background:isSel?'var(--brand-soft)':'' }}>
                    <td style={{padding:'4px 10px',width:36}} onClick={e=>toggleOne(d.id,e)}>
                      <input type="checkbox" checked={isSel} onChange={()=>{}} style={{cursor:'pointer',pointerEvents:'none'}}/>
                    </td>
                    <td>
                      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <div style={{ width:34, height:34, borderRadius:99, background:color, color:'#fff', display:'grid', placeItems:'center', fontSize:12, fontWeight:700, flexShrink:0 }}>
                          {driverInitials(d.nombre)}
                        </div>
                        <div style={{minWidth:0}}>
                          <div style={{ fontWeight:600, fontSize:13 }}>{d.nombre}</div>
                          <div className="small muted">{d.email}</div>
                          <div className="show-sm-only small muted" style={{fontSize:11, marginTop:2, display:'flex', flexWrap:'wrap', gap:5, alignItems:'center'}}>
                            <span className="mono">{d.cedula}</span>
                            {d.telefono && <span>· {d.telefono}</span>}
                            {d.vehiculo && <span>· {d.vehiculo} {d.placa}</span>}
                            {stats.pendientes > 0 && <span className="chip amber" style={{fontSize:10, padding:'1px 5px'}}>{stats.pendientes} pend.</span>}
                            {stats.incidencias > 0 && <span className="chip red" style={{fontSize:10, padding:'1px 5px'}}>{stats.incidencias} inc.</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="mono-cell muted hide-sm">{d.cedula}</td>
                    <td className="muted hide-sm">{d.telefono}</td>
                    <td className="hide-sm">
                      <div style={{ fontWeight:500, fontSize:13 }}>{d.vehiculo}</div>
                      <div className="chip neutral" style={{ marginTop:2 }}>{d.placa}</div>
                    </td>
                    <td className="muted hide-sm">{d.zona}</td>
                    <td className="num hide-sm">
                      {stats.pendientes > 0 ? <span className="chip amber">{stats.pendientes}</span> : <span className="muted">0</span>}
                    </td>
                    <td className="num hide-sm"><span className="chip green">{stats.completados}</span></td>
                    <td className="num hide-sm">
                      {stats.incidencias > 0 ? <span className="chip red">{stats.incidencias}</span> : <span className="muted">0</span>}
                    </td>
                    <td>{d.activo ? <span className="chip green">Activo</span> : <span className="chip neutral">Inactivo</span>}</td>
                    <td className="dt-hide-mobile"><CreadoPorCell nombre={d.creado_por}/></td>
                    <td onClick={e=>e.stopPropagation()}>
                      <div style={{ display:'flex', gap:4, justifyContent:'flex-end' }}>
                        <button className="icon-btn" title="Ver detalle" onClick={() => setDetailDriver(d)}><Icon name="external" size={15}/></button>
                        {window.canUser?.('editar','drivers') !== false && <button className="icon-btn" title="Asignar despacho" onClick={() => setModal({ type:'assign', data: d })}><Icon name="truck" size={15}/></button>}
                        {window.canUser?.('editar','drivers') !== false && <button className="icon-btn" title="Editar" onClick={() => setModal({ type:'edit', data: d })}><Icon name="edit" size={15}/></button>}
                        {window.canUser?.('eliminar','drivers') !== false && <button className="icon-btn danger" title="Eliminar" onClick={() => setDeleteId(d.id)}><Icon name="trash" size={15}/></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {paginated.length === 0 && (
                <tr><td colSpan={12} style={{ textAlign:'center', padding:'32px 0', color:'var(--text-muted)' }}>Sin drivers registrados</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px',borderTop:'1px solid var(--border)',fontSize:12,gap:10,flexWrap:'wrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span className="muted">Filas por página:</span>
            <select className="select" value={pageSize} onChange={e=>{setPageSize(parseInt(e.target.value));setPage(1);}} style={{fontSize:12,padding:'3px 6px'}}>
              {[50,100,200].map(n=><option key={n} value={n}>{n}</option>)}
            </select>
            <span className="muted">{drivers.length===0?'0':`Mostrando ${(page-1)*pageSize+1}–${Math.min(page*pageSize,drivers.length)} de ${drivers.length}`}</span>
          </div>
          {totalPages>1&&<div style={{display:'flex',gap:4}}>
            <button className="btn ghost sm" disabled={page===1} onClick={()=>setPage(p=>p-1)}><Icon name="chevronL" size={13}/></button>
            {Array.from({length:Math.min(5,totalPages)},(_,i)=>Math.max(1,Math.min(totalPages-4,page-2))+i).filter(p=>p>=1&&p<=totalPages).map(p=>(
              <button key={p} className={'btn sm '+(p===page?'primary':'ghost')} style={{minWidth:32}} onClick={()=>setPage(p)}>{p}</button>
            ))}
            <button className="btn ghost sm" disabled={page===totalPages} onClick={()=>setPage(p=>p+1)}><Icon name="chevronR" size={13}/></button>
          </div>}
        </div>
      </div>

      {selected.size>0&&(
        <div className="docs-bulk-bar" style={{position:'fixed',bottom:28,left:'50%',transform:'translateX(-50%)',background:'var(--bg-elev)',border:'1px solid var(--border)',borderRadius:16,boxShadow:'0 12px 40px rgba(0,0,0,.35)',display:'flex',alignItems:'center',gap:6,padding:'10px 14px',zIndex:300,backdropFilter:'blur(12px)',flexWrap:'wrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,paddingRight:10,borderRight:'1px solid var(--border)',marginRight:4}}>
            <div style={{width:24,height:24,borderRadius:8,background:'var(--brand)',display:'grid',placeItems:'center',color:'#fff',fontSize:11,fontWeight:700}}>{selected.size}</div>
            <span style={{fontSize:13,fontWeight:600}}>driver{selected.size!==1?'s':''} seleccionado{selected.size!==1?'s':''}</span>
          </div>
          <button className="btn ghost sm"><Icon name="download" size={13}/>Exportar CSV</button>
          {window.canUser?.('eliminar','drivers') !== false && <button className="btn ghost sm" style={{color:'var(--danger)'}} onClick={()=>{ if(confirm(`¿Eliminar ${selected.size} driver(s)?`)){[...selected].forEach(id=>handleDelete(id));setSelected(new Set());} }}><Icon name="trash" size={13}/>Eliminar</button>}
          <button className="icon-btn" onClick={()=>setSelected(new Set())} style={{marginLeft:4}}><Icon name="x" size={15}/></button>
        </div>
      )}

      {deleteId && (
        <div className="modal-overlay" onClick={() => setDeleteId(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{ width:380 }}>
            <div className="modal-header">
              <h3 className="modal-title">Eliminar driver</h3>
              <button className="icon-btn" onClick={() => setDeleteId(null)}><Icon name="x" size={16}/></button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize:14, color:'var(--text-2)' }}>¿Confirmas la eliminación? Se borrarán también sus asignaciones activas.</p>
            </div>
            <div className="modal-footer">
              <button className="btn ghost" onClick={() => setDeleteId(null)}>Cancelar</button>
              {window.canUser?.('eliminar','drivers') !== false && <button className="btn danger" onClick={() => handleDelete(deleteId)}>Eliminar</button>}
            </div>
          </div>
        </div>
      )}

      {modal?.type === 'add' && (
        <AddEditDriverModal driver={null} onClose={() => setModal(null)}
          onSave={async d => {
            const { error } = await window.saveDriver(d);
            if (error) { alert('No se pudo guardar el driver: ' + error.message); return; }
            window.logActivity?.({ modulo:'drivers', accion:'crear', entidad_id:d.id, entidad_label:d.nombre });
            await window.refrescarFase2();
            refresh(); setModal(null);
          }}
        />
      )}
      {modal?.type === 'edit' && (
        <AddEditDriverModal driver={modal.data} onClose={() => setModal(null)}
          onSave={async updated => {
            const { error } = await window.saveDriver(updated);
            if (error) { alert('No se pudo actualizar el driver: ' + error.message); return; }
            window.logActivity?.({ modulo:'drivers', accion:'editar', entidad_id:updated.id, entidad_label:updated.nombre });
            await window.refrescarFase2();
            refresh(); setModal(null);
          }}
        />
      )}
      {modal?.type === 'assign' && (
        <AssignDespachoModal driver={modal.data} onClose={() => setModal(null)}
          onSave={async () => { await window.refrescarFase2(); refresh(); setModal(null); }}
        />
      )}
    </div>
  );
};

// ─── AddEditDriverModal ────────────────────────────────────────────────────
function AddEditDriverModal({ driver, onClose, onSave }) {
  const isNew = !driver;
  const alreadyHasUser = !!driver?.usuario_id;
  const [form, setForm] = useState(driver ? { ...driver } : {
    nombre:'', cedula:'', telefono:'', email:'', vehiculo:'', placa:'', licencia:'', zona:'', activo: true,
  });
  const [crearUsuario, setCrearUsuario] = useState(false);
  const [password, setPassword] = useState('');
  const [saving, setSaving]     = useState(false);
  const [errMsg, setErrMsg]     = useState('');
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const needsAuth = crearUsuario && !alreadyHasUser;

  async function handleSave() {
    if (!form.nombre.trim() || !form.cedula.trim()) return;
    setErrMsg('');
    if (needsAuth) {
      if (!form.email.trim())              { setErrMsg('Email obligatorio para crear acceso al portal.'); return; }
      if (!password || password.length < 8) { setErrMsg('Contraseña mínima de 8 caracteres.'); return; }
    }
    setSaving(true);
    let usuario_id = driver?.usuario_id || null;
    if (needsAuth) {
      const initials = form.nombre.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
      const result = await window.authCreateUser({ email: form.email.trim(), password, nombre: form.nombre.trim(), rol:'Driver', iniciales: initials, avatar:'#0891b2' });
      if (result.error) {
        setSaving(false);
        const m = result.error.message || '';
        setErrMsg(m.includes('already') ? 'Este correo ya está registrado.' : (m || 'No se pudo crear el acceso.'));
        return;
      }
      usuario_id = result.authId;
    }
    const d = isNew ? { ...form, id: getNextDrvId(), usuario_id, creado_por: window.__ssCurrentUser?.nombre || null } : { ...form, usuario_id };
    setSaving(false);
    onSave(d);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{ width:560 }}>
        <div className="modal-header">
          <div style={{ width:40,height:40,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center' }}>
            <Icon name="truck" size={20}/>
          </div>
          <div style={{ flex:1 }}>
            <h3 className="modal-title">{isNew ? 'Nuevo driver' : 'Editar driver'}</h3>
            {alreadyHasUser && <div className="small muted" style={{color:'var(--success)'}}>Ya tiene acceso al portal Driver</div>}
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          <div className="grid-2">
            <div><label className="form-label">Nombre completo *</label><input className="input" value={form.nombre} onChange={e=>upd('nombre',e.target.value)} placeholder="Carlos Méndez"/></div>
            <div><label className="form-label">Cédula *</label><input className="input" value={form.cedula} onChange={e=>upd('cedula',e.target.value)} placeholder="V-18.456.789"/></div>
            <div><label className="form-label">Teléfono</label><input className="input" value={form.telefono} onChange={e=>upd('telefono',e.target.value)} placeholder="+58 412-000-0000"/></div>
            <div><label className="form-label">Vehículo</label><input className="input" value={form.vehiculo} onChange={e=>upd('vehiculo',e.target.value)} placeholder="Ford Transit Blanca"/></div>
            <div><label className="form-label">Placa</label><input className="input" value={form.placa} onChange={e=>upd('placa',e.target.value)} placeholder="AB1234C"/></div>
            <div><label className="form-label">Licencia de conducir</label><input className="input" value={form.licencia} onChange={e=>upd('licencia',e.target.value)} placeholder="C-5-8234"/></div>
            <div><label className="form-label">Zona de cobertura</label><input className="input" value={form.zona} onChange={e=>upd('zona',e.target.value)} placeholder="Caracas Norte"/></div>
            <div>
              <label className="form-label">Activo</label>
              <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:14, height:38 }}>
                <input type="checkbox" checked={form.activo} onChange={e=>upd('activo',e.target.checked)}/>Driver activo
              </label>
            </div>
          </div>
          {!alreadyHasUser && (
            <div style={{ marginTop:16, padding:'12px 16px', background:'var(--bg-sunken)', borderRadius:10, border:'1px solid var(--border)' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: crearUsuario ? 14 : 0 }}>
                <div>
                  <div style={{ fontWeight:600, fontSize:13 }}>Crear acceso al Portal Driver</div>
                  <div style={{ fontSize:11.5, color:'var(--text-muted)', marginTop:2 }}>El driver podrá iniciar sesión y ver sus despachos</div>
                </div>
                <div onClick={() => setCrearUsuario(v => !v)}
                  style={{ width:40, height:22, borderRadius:11, background: crearUsuario ? 'var(--brand)' : 'var(--border-strong)', position:'relative', cursor:'pointer', transition:'background .2s', flexShrink:0 }}>
                  <div style={{ position:'absolute', top:3, left: crearUsuario ? 21 : 3, width:16, height:16, borderRadius:'50%', background:'#fff', transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,.2)' }}/>
                </div>
              </div>
              {crearUsuario && (
                <div className="grid-2" style={{ marginTop:0 }}>
                  <div><label className="form-label">Email *</label><input className="input" value={form.email} onChange={e=>upd('email',e.target.value)} placeholder="driver@ss.ve" autoComplete="username"/></div>
                  <div><label className="form-label">Contraseña *</label><input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" autoComplete="new-password"/></div>
                </div>
              )}
            </div>
          )}
          {errMsg && <div style={{ marginTop:12, padding:'8px 12px', background:'#fee2e2', color:'#b91c1c', borderRadius:8, fontSize:13 }}>{errMsg}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" disabled={saving||!form.nombre.trim()||!form.cedula.trim()} onClick={handleSave}>
            <Icon name="check" size={14}/>{saving ? 'Guardando…' : (isNew ? 'Crear driver' : 'Guardar cambios')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── AssignDespachoModal ───────────────────────────────────────────────────
function AssignDespachoModal({ driver, onClose, onSave }) {
  const [selDesp, setSelDesp] = useState('');
  const [saving, setSaving]   = useState(false);

  const assignedIds  = new Set(SSData.driverDespachos.filter(dd => dd.driver_id === driver.id).map(dd => dd.despacho_id));
  const allAssigned  = new Set(SSData.driverDespachos.map(dd => dd.despacho_id));
  // Un despacho es asignable mientras no esté entregado/cancelado. (No existe estado 'despacho':
  // los despachos migrados tienen estado='despachado'.) El pool completo de 29.957 despachos se
  // consultará server-side en una fase posterior; aquí filtra los que estén cargados en memoria.
  const available    = SSData.documentos.filter(d => d.tipo === 'despacho' && d.estado !== 'entregado' && d.estado !== 'cancelada' && !allAssigned.has(d.id));
  const current      = SSData.driverDespachos.filter(dd => dd.driver_id === driver.id);

  async function handleAssign() {
    if (!selDesp) return;
    setSaving(true);
    const newDa = {
      id: getNextDaId(), driver_id: driver.id, despacho_id: selDesp, estado: 'pendiente',
      fecha: window.localDateStr(), empresa_id: window.currentEmpresa || 'demo1',
    };
    const { error } = await window.saveDriverDespacho(newDa);
    if (error) { alert('Error al asignar: ' + error.message); setSaving(false); return; }
    await onSave();
    setSaving(false);
    setSelDesp('');
  }

  async function handleUnassign(daId) {
    const { error } = await window.deleteDriverDespacho(daId);
    if (error) { alert('Error: ' + error.message); return; }
    await onSave();
  }

  function getCliente(despachoId) {
    const d = SSData.documentos.find(doc => doc.id === despachoId);
    if (!d) return '';
    const c = SSData.clientes.find(c => c.id === d.cliente);
    return c ? c.nombre : d.cliente;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{ width:520 }}>
        <div className="modal-header">
          <div style={{ width:40,height:40,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center' }}>
            <Icon name="truck" size={20}/>
          </div>
          <div style={{ flex:1 }}><h3 className="modal-title">Asignar despachos — {driver.nombre}</h3></div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          <div style={{ display:'flex', gap:8, marginBottom:16 }}>
            <select className="select" style={{ flex:1 }} value={selDesp} onChange={e=>setSelDesp(e.target.value)}>
              <option value="">— Seleccionar despacho disponible —</option>
              {available.map(d => {
                const c = SSData.clientes.find(cl => cl.id === d.cliente);
                return <option key={d.id} value={d.id}>{d.id} · {c?.nombre || d.cliente} · {fmt.usd(d.total)}</option>;
              })}
            </select>
            <button className="btn primary" disabled={!selDesp||saving} onClick={handleAssign}>
              <Icon name="plus" size={14}/>{saving?'…':'Asignar'}
            </button>
          </div>
          <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Despachos asignados ({current.length})</div>
          {current.length === 0 && <div className="muted small">Sin despachos asignados</div>}
          {current.map(dd => {
            const doc = SSData.documentos.find(d => d.id === dd.despacho_id);
            const estadoColor = { pendiente:'amber', en_ruta:'blue', entregado:'green', incidencia:'red' };
            return (
              <div key={dd.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 0', borderBottom:'1px solid var(--border)' }}>
                <Icon name="doc" size={16} style={{ color:'var(--text-muted)', flexShrink:0 }}/>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:500, fontSize:13 }}>{dd.despacho_id}</div>
                  <div className="small muted">{getCliente(dd.despacho_id)} · {fmt.usd(doc?.total||0)}</div>
                </div>
                <span className={'chip '+(estadoColor[dd.estado]||'neutral')}>{dd.estado}</span>
                {dd.estado !== 'entregado' && (
                  <button className="icon-btn danger" onClick={() => handleUnassign(dd.id)}><Icon name="x" size={14}/></button>
                )}
              </div>
            );
          })}
        </div>
        <div className="modal-footer">
          <button className="btn primary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════
//  PORTAL MÓVIL — DriverPortalPage
// ══════════════════════════════════════════════════════════════════════════
window.DriverPortalPage = function DriverPortalPage({ currentUser }) {
  const [version, setVersion]   = useState(0);
  const [tab, setTab]           = useState('pendientes');
  const [delivery, setDelivery] = useState(null);
  const [empresas, setEmpresas] = useState([]);
  const [edits, setEdits]       = useState({}); // { docId: log }
  useEffect(() => {
    window.loadEmpresas?.().then(list => { setEmpresas(list || []); window.__ssEmpresasCache = list || []; });
  }, []);

  const driver = useMemo(() => {
    if (currentUser?.driver_id) return SSData.drivers.find(d => d.id === currentUser.driver_id);
    if (currentUser?.nombre)    return SSData.drivers.find(d => d.nombre === currentUser.nombre);
    return SSData.drivers.find(d => d.activo) || SSData.drivers[0];
  }, [currentUser]);

  const refresh = () => setVersion(v => v+1);

  const myDespachos = useMemo(() => {
    if (!driver) return [];
    return SSData.driverDespachos
      .filter(dd => dd.driver_id === driver.id)
      .map(dd => {
        const doc = SSData.documentos.find(d => d.id === dd.despacho_id);
        const cli = doc ? SSData.clientes.find(c => c.id === doc.cliente) : null;
        return { ...dd, doc, cli };
      })
      .filter(dd => dd.doc);
  }, [version, driver?.id]);

  // Cargar últimas ediciones de los despachos del driver para mostrar badge "cambios recientes"
  const docIdsKey = myDespachos.map(dd => dd.doc.id).join('|');
  useEffect(() => {
    if (!myDespachos.length) { setEdits({}); return; }
    const ids = myDespachos.map(dd => dd.doc.id);
    window.fetchLatestDocEdits?.(ids).then(map => setEdits(map || {}));
  }, [docIdsKey]);

  const seenMap = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('ss-driver-seen-edits') || '{}'); }
    catch { return {}; }
  }, [version]);

  function markEditSeen(docId, timestamp) {
    try {
      const all = JSON.parse(localStorage.getItem('ss-driver-seen-edits') || '{}');
      all[docId] = timestamp;
      localStorage.setItem('ss-driver-seen-edits', JSON.stringify(all));
    } catch {}
    refresh();
  }

  const pendientes  = myDespachos.filter(dd => dd.estado === 'pendiente' || dd.estado === 'en_ruta');
  const completados = myDespachos.filter(dd => dd.estado === 'entregado' || dd.estado === 'incidencia');

  const portalStyle = { minHeight:'100vh', background:'#f8fafc', fontFamily:'var(--font)', display:'flex', flexDirection:'column', maxWidth:480, margin:'0 auto' };
  const headerStyle = { background:'linear-gradient(135deg, oklch(0.35 0.19 255), oklch(0.45 0.19 260))', padding:'16px 20px 20px', color:'#fff', position:'sticky', top:0, zIndex:10 };

  if (!driver) return (
    <div style={{ ...portalStyle, alignItems:'center', justifyContent:'center' }}>
      <div style={{ textAlign:'center', padding:32 }}>
        <div style={{ fontSize:32, marginBottom:8 }}>🚚</div>
        <div style={{ fontWeight:600, marginBottom:8 }}>No se encontró perfil de driver</div>
        <div style={{ fontSize:13, color:'#666', marginBottom:24 }}>Este usuario no tiene un perfil de conductor asociado.</div>
        <button onClick={() => { if (window.signOutApp) window.signOutApp(); else { localStorage.removeItem('ss-pin-session'); localStorage.removeItem('ss-client-session'); window.sb && window.sb.auth.signOut(); window.location.replace('/'); } }}
          style={{ background:'#ef4444', border:'none', color:'#fff', borderRadius:8, padding:'10px 24px', fontSize:14, cursor:'pointer', fontWeight:600 }}>
          Cerrar sesión
        </button>
      </div>
    </div>
  );

  return (
    <div style={portalStyle}>
      <div style={headerStyle}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ width:44, height:44, borderRadius:99, background:'rgba(255,255,255,.2)', display:'grid', placeItems:'center', fontSize:16, fontWeight:700 }}>
              {driverInitials(driver.nombre)}
            </div>
            <div>
              <div style={{ fontWeight:700, fontSize:16 }}>{driver.nombre}</div>
              <div style={{ fontSize:12, opacity:.8 }}>{driver.vehiculo} · {driver.placa}</div>
            </div>
          </div>
          <button onClick={() => { if (window.signOutApp) window.signOutApp(); else { localStorage.removeItem('ss-pin-session'); window.sb && window.sb.auth.signOut(); window.location.replace('/'); } }}
            style={{ background:'rgba(255,255,255,.15)', border:'none', color:'#fff', borderRadius:8, padding:'6px 12px', fontSize:12, cursor:'pointer' }}>
            Salir
          </button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginTop:16 }}>
          {[
            { label:'Pendientes', value: pendientes.length,  color:'#fbbf24' },
            { label:'Entregados', value: completados.filter(d=>d.estado==='entregado').length, color:'#34d399' },
            { label:'Incidencias', value: SSData.incidencias.filter(i=>i.driver_id===driver.id).length, color:'#f87171' },
          ].map(s => (
            <div key={s.label} style={{ background:'rgba(255,255,255,.12)', borderRadius:10, padding:'10px 12px', textAlign:'center' }}>
              <div style={{ fontSize:22, fontWeight:700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize:11, opacity:.8, marginTop:2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display:'flex', borderBottom:'1px solid #e2e8f0', background:'#fff', position:'sticky', top:138, zIndex:9 }}>
        {[['pendientes','Pendientes'],['completados','Completados']].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            flex:1, padding:'14px 0', background:'none', border:'none', cursor:'pointer',
            fontSize:14, fontWeight: tab===id ? 700 : 400,
            color: tab===id ? 'oklch(0.45 0.19 255)' : '#64748b',
            borderBottom: tab===id ? '2.5px solid oklch(0.45 0.19 255)' : '2.5px solid transparent',
          }}>
            {label}
            {id==='pendientes' && pendientes.length > 0 && (
              <span style={{ marginLeft:6, background:'oklch(0.45 0.19 255)', color:'#fff', borderRadius:99, padding:'1px 6px', fontSize:11 }}>{pendientes.length}</span>
            )}
          </button>
        ))}
      </div>

      <div style={{ flex:1, padding:'16px 16px 100px' }}>
        {tab === 'pendientes' && (
          pendientes.length === 0
            ? <EmptyPortalState icon="✅" text="¡Todo al día! No tienes entregas pendientes."/>
            : pendientes.map(dd => (
                <PortalDespachoCard key={dd.id} dd={dd}
                  onStart={() => { const log = edits[dd.doc.id]; if (log) markEditSeen(dd.doc.id, log.created_at); setDelivery(dd); }}
                  driver={driver}
                  editLog={edits[dd.doc.id]}
                  isUnseen={isUnseenEdit(edits[dd.doc.id], seenMap[dd.doc.id])}
                  onMarkSeen={() => { const log = edits[dd.doc.id]; if (log) markEditSeen(dd.doc.id, log.created_at); }}
                />
              ))
        )}
        {tab === 'completados' && (
          completados.length === 0
            ? <EmptyPortalState icon="📦" text="Aún no tienes entregas completadas."/>
            : completados.map(dd => <PortalDespachoCard key={dd.id} dd={dd} driver={driver}/>)
        )}
      </div>

      {delivery && (
        <DeliveryFlowModal dd={delivery} driver={driver} onClose={() => setDelivery(null)} onDone={() => { setDelivery(null); refresh(); }}/>
      )}
    </div>
  );
};

// Determina si hay un log de edición que el driver no ha visto aún.
function isUnseenEdit(editLog, seenAt) {
  if (!editLog) return false;
  if (!seenAt) return true;
  return new Date(seenAt).getTime() < new Date(editLog.created_at).getTime();
}

// Etiquetas legibles para los campos editados en el log.
const EDIT_FIELD_LABELS = {
  dir_entrega:   'Dirección de entrega',
  observaciones: 'Observaciones',
  driver_id:     'Driver asignado',
};

function EmptyPortalState({ icon, text }) {
  return (
    <div style={{ textAlign:'center', padding:'60px 20px', color:'#94a3b8' }}>
      <div style={{ fontSize:48, marginBottom:12 }}>{icon}</div>
      <div style={{ fontSize:15 }}>{text}</div>
    </div>
  );
}

function PortalDespachoCard({ dd, onStart, driver, editLog, isUnseen, onMarkSeen }) {
  const { doc, cli, estado } = dd;
  const { lines, loading: linesLoading } = useDespachoLines(doc);
  const statusMap = { pendiente:['amber','Pendiente'], en_ruta:['blue','En ruta'], entregado:['green','Entregado'], incidencia:['red','Incidencia'] };
  const [chipColor, chipLabel] = statusMap[estado] || ['neutral',estado];
  const emp = (window.__ssEmpresasCache || []).find(e => e.id === doc.empresa_id);

  // Resumen de campos editados desde el log
  const editedFields = (editLog?.detalles?.campos_editados || []).map(f => EDIT_FIELD_LABELS[f] || f);
  const editedAt    = editLog?.created_at ? new Date(editLog.created_at) : null;
  const editedBy    = editLog?.usuario_nombre || 'Sistema';
  const editedAgo = (() => {
    if (!editedAt) return '';
    const diffMin = Math.round((Date.now() - editedAt.getTime()) / 60000);
    if (diffMin < 1)  return 'recién';
    if (diffMin < 60) return `hace ${diffMin} min`;
    if (diffMin < 1440) return `hace ${Math.round(diffMin/60)} h`;
    return new Date(editLog.created_at).toLocaleDateString("es-VE",{day:"2-digit",month:"short",year:"numeric",timeZone:"America/Caracas"});
  })();

  return (
    <div style={{ background:'#fff', borderRadius:14, padding:18, marginBottom:14, boxShadow: isUnseen ? '0 0 0 2px #2563eb33, 0 1px 4px rgba(0,0,0,.08)' : '0 1px 4px rgba(0,0,0,.08)', border:'1px solid '+(isUnseen?'#2563eb':'#f1f5f9'), position:'relative' }}>
      {isUnseen && (
        <div style={{ background:'#dbeafe', border:'1px solid #93c5fd', borderRadius:10, padding:'10px 12px', marginBottom:12, display:'flex', gap:10, alignItems:'flex-start' }}>
          <div style={{ fontSize:18, lineHeight:1 }}>📬</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:700, color:'#1e3a8a', marginBottom:2 }}>
              {editedFields.includes('Driver asignado') ? 'Despacho reasignado a ti' : 'Cambios recientes en este despacho'}
            </div>
            <div style={{ fontSize:12, color:'#1e40af', lineHeight:1.4 }}>
              {editedFields.length > 0 ? <>Se actualizó: <strong>{editedFields.join(', ')}</strong>. </> : 'Se realizaron actualizaciones. '}
              <span style={{ opacity:.85 }}>Por {editedBy} · {editedAgo}</span>
            </div>
          </div>
          <button onClick={(e)=>{ e.stopPropagation(); onMarkSeen?.(); }} title="Marcar como visto"
            style={{ background:'transparent', border:'none', color:'#1e40af', cursor:'pointer', padding:4, fontSize:11, fontWeight:600 }}>
            ✓ Visto
          </button>
        </div>
      )}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:2 }}>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'#64748b' }}>{doc.id}</div>
            {emp && (
              <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'1px 7px',borderRadius:5,fontSize:10,fontWeight:700,background:(emp.color||'#666')+'18',color:emp.color||'inherit',border:'1px solid '+(emp.color||'#ccc')+'40'}}>
                <span style={{width:5,height:5,borderRadius:'50%',background:emp.color||'#666'}}></span>{emp.nombre}
              </span>
            )}
          </div>
          <div style={{ fontWeight:700, fontSize:16 }}>{cli?.nombre || doc.cliente}</div>
          <div style={{ fontSize:13, color:'#64748b', marginTop:2 }}>
            <Icon name="link" size={12}/> {doc.dir_entrega || doc.direccion || cli?.ciudad || 'Sin dirección'}
          </div>
        </div>
        <span className={'chip '+chipColor}>{chipLabel}</span>
      </div>

      <div style={{ background:'#f8fafc', borderRadius:8, padding:'10px 12px', marginBottom:14 }}>
        <div style={{ fontSize:12, color:'#64748b', marginBottom:6 }}>{linesLoading ? 'Cargando productos…' : lines.length+' productos'}</div>
        {linesLoading && <div style={{ fontSize:13, color:'#94a3b8' }}>—</div>}
        {!linesLoading && lines.map((l,i) => (
          <div key={i} style={{ display:'flex', justifyContent:'space-between', fontSize:13, padding:'3px 0', borderBottom: i<lines.length-1?'1px solid #e2e8f0':'none' }}>
            <span style={{ color:'#334155' }}>{l.nombre}</span>
            <span style={{ fontWeight:600, color:'#1e293b' }}>×{l.qty}</span>
          </div>
        ))}
      </div>

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ fontWeight:700, fontSize:17, color:'oklch(0.35 0.19 255)' }}>{fmt.usd(doc.total)}</div>
        {estado !== 'entregado' && estado !== 'incidencia' && onStart && (
          <button onClick={onStart} style={{ background:'oklch(0.45 0.19 255)', color:'#fff', border:'none', borderRadius:10, padding:'12px 22px', fontSize:14, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:8 }}>
            <Icon name="truck" size={16}/>Iniciar entrega
          </button>
        )}
        {estado === 'entregado' && <span style={{ fontSize:13, color:'#16a34a', fontWeight:600, display:'flex', alignItems:'center', gap:4 }}><Icon name="check" size={14}/>Entregado</span>}
        {estado === 'incidencia' && <span style={{ fontSize:13, color:'#dc2626', fontWeight:600, display:'flex', alignItems:'center', gap:4 }}><Icon name="info" size={14}/>Con incidencia</span>}
      </div>
    </div>
  );
}

// ─── DeliveryFlowModal ─────────────────────────────────────────────────────
function DeliveryFlowModal({ dd, driver, onClose, onDone }) {
  const { doc, cli } = dd;
  const { lines, loading: linesLoading } = useDespachoLines(doc);

  const [step, setStep]             = useState('items');
  const [items, setItems]           = useState([]);
  // Cuando llegan los ítems reales del despacho, inicializa las cantidades entregadas.
  useEffect(() => { setItems(lines.map(l => ({ ...l, entregado: l.qty }))); }, [lines]);
  const [photo, setPhoto]           = useState(null);
  const [firma, setFirma]           = useState(null);
  const [clientName, setClientName] = useState(cli?.contacto || '');
  const [saving, setSaving]         = useState(false);
  const [motivoFaltante, setMotivoFaltante] = useState('');
  const [notasEntrega, setNotasEntrega]     = useState('');
  const photoRef = useRef(null);

  const hasFaltantes = items.some(i => i.entregado < i.qty);

  async function handleSubmit() {
    setSaving(true);
    const nuevoEstado = hasFaltantes ? 'incidencia' : 'entregado';
    const entregadoEn = nuevoEstado === 'entregado' ? new Date().toISOString() : dd.entregado_en;

    const daUpdate = {
      ...dd,
      estado: nuevoEstado,
      firma,
      foto: photo,
      receptor_nombre: clientName,
      items_entregados: items,
      notas: notasEntrega,
      entregado_en: entregadoEn,
    };
    delete daUpdate.doc; delete daUpdate.cli;

    const { error: daErr } = await window.saveDriverDespacho(daUpdate);
    if (daErr) { alert('Error al guardar entrega: ' + daErr.message); setSaving(false); return; }

    // Update SSData in-place for portal refresh
    const da = SSData.driverDespachos.find(d => d.id === dd.id);
    if (da) { Object.assign(da, { estado: nuevoEstado, firma, foto: photo, receptor_nombre: clientName, items_entregados: items, notas: notasEntrega, entregado_en: entregadoEn }); }

    if (hasFaltantes) {
      const faltantes = items.filter(i => i.entregado < i.qty).map(i => ({ sku: i.sku, nombre: i.nombre, esperado: i.qty, entregado: i.entregado }));
      const newInc = {
        id: getNextIncId(),
        empresa_id:      window.currentEmpresa || 'demo1',
        driver_id:       driver.id,
        despacho_id:     doc.id,
        cliente_id:      doc.cliente,
        descripcion:     motivoFaltante.trim() ? motivoFaltante.trim() : `Entrega parcial — ${faltantes.length} producto(s) con faltante`,
        items_faltantes: faltantes,
        foto:  photo,
        firma,
        estado: 'pendiente',
        fecha:  new Date().toISOString(),
        notas:  '',
        creado_por: window.__ssCurrentUser?.nombre || null,
      };
      await window.saveIncidencia(newInc);
      SSData.incidencias.push(newInc);
    }

    setSaving(false);
    onDone();
  }

  const overlayStyle = { position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:1000, display:'flex', alignItems:'flex-end', justifyContent:'center' };
  const sheetStyle   = { background:'#fff', borderRadius:'20px 20px 0 0', width:'100%', maxWidth:480, maxHeight:'92vh', display:'flex', flexDirection:'column', overflow:'hidden' };
  const steps = ['items','photo','signature','confirm'];
  const pct   = ((steps.indexOf(step)+1)/steps.length)*100;

  return (
    <div style={overlayStyle} onClick={e => { if(e.target===e.currentTarget) onClose(); }}>
      <div style={sheetStyle}>
        <div style={{ padding:'16px 20px 0', flexShrink:0 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <div>
              <div style={{ fontWeight:700, fontSize:16 }}>{doc.id}</div>
              <div style={{ fontSize:13, color:'#64748b' }}>{cli?.nombre || doc.cliente}</div>
            </div>
            <button onClick={onClose} style={{ background:'#f1f5f9', border:'none', borderRadius:99, width:32, height:32, cursor:'pointer', display:'grid', placeItems:'center' }}>
              <Icon name="x" size={16}/>
            </button>
          </div>
          <div style={{ height:4, borderRadius:99, background:'#e2e8f0', marginBottom:4 }}>
            <div style={{ height:'100%', width:pct+'%', borderRadius:99, background:'oklch(0.45 0.19 255)', transition:'width .3s' }}/>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'#94a3b8', marginBottom:16 }}>
            {['Productos','Foto','Firma','Confirmar'].map((s,i) => (
              <span key={s} style={{ color: i<=steps.indexOf(step)?'oklch(0.45 0.19 255)':'#94a3b8', fontWeight: steps[i]===step?700:400 }}>{s}</span>
            ))}
          </div>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'0 20px' }}>
          {step === 'items' && (
            <div>
              <div style={{ fontSize:14, fontWeight:600, marginBottom:12 }}>Confirma las cantidades entregadas</div>
              {linesLoading && <div style={{ padding:'24px 0', textAlign:'center', color:'#94a3b8', fontSize:14 }}>Cargando productos…</div>}
              {!linesLoading && items.length === 0 && <div style={{ padding:'24px 0', textAlign:'center', color:'#94a3b8', fontSize:14 }}>Este despacho no tiene productos registrados.</div>}
              {items.map((item, idx) => (
                <div key={idx} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 0', borderBottom:'1px solid #f1f5f9' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:500, fontSize:14 }}>{item.nombre}</div>
                    <div style={{ fontSize:12, color:'#64748b', fontFamily:'var(--font-mono)' }}>{item.sku}</div>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
                    <div style={{ fontSize:11, color:'#94a3b8' }}>Esperado: {item.qty}</div>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <button onClick={() => setItems(it => it.map((x,i)=>i===idx?{...x,entregado:Math.max(0,x.entregado-1)}:x))}
                        style={{ width:32,height:32,borderRadius:99,border:'1px solid #e2e8f0',background:'#f8fafc',cursor:'pointer',fontSize:16,display:'grid',placeItems:'center' }}>−</button>
                      <span style={{ width:28, textAlign:'center', fontWeight:700, fontSize:16, color: item.entregado<item.qty?'#dc2626':'#1e293b' }}>{item.entregado}</span>
                      <button onClick={() => setItems(it => it.map((x,i)=>i===idx?{...x,entregado:Math.min(x.qty,x.entregado+1)}:x))}
                        style={{ width:32,height:32,borderRadius:99,border:'1px solid #e2e8f0',background:'#f8fafc',cursor:'pointer',fontSize:16,display:'grid',placeItems:'center' }}>+</button>
                    </div>
                    {item.entregado < item.qty && <div style={{ fontSize:11, color:'#dc2626' }}>Falta: {item.qty-item.entregado}</div>}
                  </div>
                </div>
              ))}
              {hasFaltantes && (
                <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:12, marginTop:12, fontSize:13, color:'#991b1b' }}>
                  <strong>Atención:</strong> Se generará una incidencia automáticamente por los faltantes.
                  <div style={{ marginTop:10 }}>
                    <label style={{ fontWeight:600, fontSize:12, display:'block', marginBottom:4 }}>¿Por qué hay faltantes? <span style={{ fontWeight:400, color:'#b91c1c' }}>(explica el motivo)</span></label>
                    <textarea
                      value={motivoFaltante}
                      onChange={e => setMotivoFaltante(e.target.value)}
                      placeholder="Ej: El cliente rechazó el producto, estaba dañado en tránsito, no había nadie para recibirlo…"
                      rows={3}
                      style={{ width:'100%', boxSizing:'border-box', borderRadius:8, border:'1px solid #fca5a5', padding:'8px 10px', fontSize:13, color:'#1e293b', background:'#fff', resize:'vertical', fontFamily:'var(--font)' }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 'photo' && (
            <div>
              <div style={{ fontSize:14, fontWeight:600, marginBottom:8 }}>Foto de la entrega</div>
              <div style={{ fontSize:13, color:'#64748b', marginBottom:16 }}>Toma una foto del momento de entrega al cliente.</div>
              {photo ? (
                <div>
                  <img src={photo} alt="entrega" style={{ width:'100%', borderRadius:12, maxHeight:300, objectFit:'cover', border:'1px solid #e2e8f0' }}/>
                  <button onClick={() => setPhoto(null)} style={{ width:'100%', marginTop:12, padding:'12px 0', background:'#f1f5f9', border:'1px solid #e2e8f0', borderRadius:10, fontSize:14, cursor:'pointer' }}>Retomar foto</button>
                </div>
              ) : (
                <div>
                  <div onClick={() => photoRef.current?.click()} style={{ border:'2px dashed #cbd5e1', borderRadius:14, padding:'48px 24px', textAlign:'center', cursor:'pointer', background:'#f8fafc' }}>
                    <div style={{ fontSize:48, marginBottom:8 }}>📷</div>
                    <div style={{ fontWeight:600 }}>Tomar foto</div>
                    <div style={{ fontSize:12, color:'#94a3b8', marginTop:4 }}>Toca para abrir la cámara</div>
                  </div>
                  <input ref={photoRef} type="file" accept="image/*" capture="environment" style={{ display:'none' }}
                    onChange={e => { const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=ev=>setPhoto(ev.target.result); r.readAsDataURL(f); }}/>
                  <button onClick={() => setStep('signature')} style={{ width:'100%', marginTop:12, padding:'12px 0', background:'transparent', border:'1px solid #e2e8f0', borderRadius:10, fontSize:14, cursor:'pointer', color:'#64748b' }}>Omitir foto</button>
                </div>
              )}
            </div>
          )}

          {step === 'signature' && (
            <div>
              <div style={{ fontSize:14, fontWeight:600, marginBottom:4 }}>Firma del cliente</div>
              <div style={{ fontSize:13, color:'#64748b', marginBottom:12 }}>Pide al cliente que firme en el recuadro.</div>
              <label style={{ fontSize:13, fontWeight:500, display:'block', marginBottom:6 }}>Nombre del receptor</label>
              <input className="input" placeholder="Nombre de quien recibe" value={clientName} onChange={e => setClientName(e.target.value)} style={{ marginBottom:12, width:'100%', boxSizing:'border-box' }}/>
              {firma ? (
                <div>
                  <img src={firma} alt="firma" style={{ width:'100%', borderRadius:10, border:'1px solid #e2e8f0', background:'#fff' }}/>
                  <button onClick={() => setFirma(null)} style={{ width:'100%', marginTop:8, padding:'12px 0', background:'#f1f5f9', border:'1px solid #e2e8f0', borderRadius:10, fontSize:14, cursor:'pointer' }}>Limpiar y repetir</button>
                </div>
              ) : <SignaturePad onConfirm={data => { setFirma(data); setStep('confirm'); }}/>}
            </div>
          )}

          {step === 'confirm' && (
            <div>
              <div style={{ fontSize:14, fontWeight:600, marginBottom:12 }}>Resumen de entrega</div>
              <div style={{ background:'#f8fafc', borderRadius:12, padding:16, marginBottom:16 }}>
                <InfoRow label="Despacho" value={doc.id}/>
                <InfoRow label="Cliente"  value={cli?.nombre || doc.cliente}/>
                <InfoRow label="Receptor" value={clientName || '—'}/>
                <InfoRow label="Productos entregados" value={`${items.filter(i=>i.entregado>0).length} / ${items.length}`}/>
                <InfoRow label="Total" value={fmt.usd(doc.total)}/>
              </div>
              {hasFaltantes && (
                <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:10, padding:14, marginBottom:16 }}>
                  <div style={{ fontWeight:600, fontSize:13, color:'#991b1b', marginBottom:8 }}>Faltantes — se creará una incidencia</div>
                  {items.filter(i=>i.entregado<i.qty).map((item,i) => (
                    <div key={i} style={{ fontSize:13, color:'#7f1d1d', padding:'3px 0' }}>• {item.nombre}: esperado {item.qty}, entregado {item.entregado}</div>
                  ))}
                </div>
              )}
              <div style={{ display:'flex', gap:12, marginBottom:12 }}>
                {photo && <div style={{ flex:1 }}><div style={{ fontSize:12, color:'#64748b', marginBottom:4 }}>Foto</div><img src={photo} alt="entrega" style={{ width:'100%', borderRadius:8, maxHeight:120, objectFit:'cover' }}/></div>}
                {firma && <div style={{ flex:1 }}><div style={{ fontSize:12, color:'#64748b', marginBottom:4 }}>Firma</div><img src={firma} alt="firma" style={{ width:'100%', borderRadius:8, background:'#fff', border:'1px solid #e2e8f0' }}/></div>}
              </div>
              <div style={{ marginBottom:8 }}>
                <label style={{ fontSize:12, fontWeight:600, color:'#64748b', display:'block', marginBottom:6 }}>Notas adicionales <span style={{ fontWeight:400 }}>(opcional)</span></label>
                <textarea
                  value={notasEntrega}
                  onChange={e => setNotasEntrega(e.target.value)}
                  placeholder="Cualquier observación sobre la entrega…"
                  rows={3}
                  style={{ width:'100%', boxSizing:'border-box', borderRadius:10, border:'1px solid #e2e8f0', padding:'10px 12px', fontSize:13, color:'#1e293b', background:'#f8fafc', resize:'vertical', fontFamily:'var(--font)' }}
                />
              </div>
            </div>
          )}
        </div>

        <div style={{ padding:'16px 20px', borderTop:'1px solid #f1f5f9', flexShrink:0, background:'#fff' }}>
          {step === 'items' && (
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={onClose} style={{ flex:1, padding:'14px 0', background:'#f1f5f9', border:'none', borderRadius:12, fontSize:15, cursor:'pointer' }}>Cancelar</button>
              <button onClick={() => setStep('photo')} disabled={linesLoading} style={{ flex:2, padding:'14px 0', background:'oklch(0.45 0.19 255)', color:'#fff', border:'none', borderRadius:12, fontSize:15, fontWeight:700, cursor: linesLoading?'not-allowed':'pointer', opacity: linesLoading?.6:1 }}>Siguiente →</button>
            </div>
          )}
          {step === 'photo' && (
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setStep('items')} style={{ flex:1, padding:'14px 0', background:'#f1f5f9', border:'none', borderRadius:12, fontSize:15, cursor:'pointer' }}>← Atrás</button>
              {photo && <button onClick={() => setStep('signature')} style={{ flex:2, padding:'14px 0', background:'oklch(0.45 0.19 255)', color:'#fff', border:'none', borderRadius:12, fontSize:15, fontWeight:700, cursor:'pointer' }}>Siguiente →</button>}
            </div>
          )}
          {step === 'signature' && firma && (
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setStep('photo')} style={{ flex:1, padding:'14px 0', background:'#f1f5f9', border:'none', borderRadius:12, fontSize:15, cursor:'pointer' }}>← Atrás</button>
              <button onClick={() => setStep('confirm')} style={{ flex:2, padding:'14px 0', background:'oklch(0.45 0.19 255)', color:'#fff', border:'none', borderRadius:12, fontSize:15, fontWeight:700, cursor:'pointer' }}>Revisar →</button>
            </div>
          )}
          {step === 'signature' && !firma && (
            <button onClick={() => setStep('photo')} style={{ width:'100%', padding:'14px 0', background:'#f1f5f9', border:'none', borderRadius:12, fontSize:15, cursor:'pointer' }}>← Atrás</button>
          )}
          {step === 'confirm' && (
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setStep('signature')} style={{ flex:1, padding:'14px 0', background:'#f1f5f9', border:'none', borderRadius:12, fontSize:15, cursor:'pointer' }}>← Atrás</button>
              <button onClick={handleSubmit} disabled={saving} style={{ flex:2, padding:'14px 0', background: hasFaltantes?'#dc2626':'#16a34a', color:'#fff', border:'none', borderRadius:12, fontSize:15, fontWeight:700, cursor:'pointer' }}>
                {saving ? 'Guardando…' : hasFaltantes ? '⚠ Confirmar con incidencia' : '✓ Confirmar entrega'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid #e2e8f0', fontSize:14 }}>
      <span style={{ color:'#64748b' }}>{label}</span>
      <span style={{ fontWeight:600 }}>{value}</span>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════
//  ADMIN — IncidenciasPage
// ══════════════════════════════════════════════════════════════════════════
window.IncidenciasPage = function IncidenciasPage() {
  const [version, setVersion]   = useState(0);
  const [filter, setFilter]     = useState('all');
  const [detail, setDetail]     = useState(null);
  const [showActivity, setShowActivity] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    const v = parseInt(localStorage.getItem('ss-incidencias-pagesize'));
    return [50,100,200].includes(v) ? v : 50;
  });
  useEffect(() => { localStorage.setItem('ss-incidencias-pagesize', String(pageSize)); }, [pageSize]);
  const refresh = () => setVersion(v => v+1);

  const incidencias = useMemo(() => {
    return SSData.incidencias
      .filter(i => filter === 'all' || i.estado === filter)
      .map(i => ({ ...i, driver: SSData.drivers.find(d => d.id === i.driver_id), cliente: SSData.clientes.find(c => c.id === i.cliente_id) }))
      .sort((a,b) => new Date(b.fecha) - new Date(a.fecha));
  }, [version, filter]);

  const totalPages = Math.max(1, Math.ceil(incidencias.length / pageSize));
  const paginated  = incidencias.slice((page-1)*pageSize, page*pageSize);

  const toggleAll = () => { if(selected.size===paginated.length)setSelected(new Set());else setSelected(new Set(paginated.map(i=>i.id))); };
  const toggleOne = (id) => { const s=new Set(selected); s.has(id)?s.delete(id):s.add(id); setSelected(s); };
  const allChecked  = paginated.length > 0 && selected.size === paginated.length;
  const someChecked = selected.size > 0 && selected.size < paginated.length;

  const counts = { all: SSData.incidencias.length, pendiente: 0, en_proceso: 0, resuelto: 0 };
  SSData.incidencias.forEach(i => { if (counts[i.estado] !== undefined) counts[i.estado]++; });

  const estadoColor = { pendiente:'red', en_proceso:'amber', resuelto:'green' };
  const estadoLabel = { pendiente:'Pendiente', en_proceso:'En proceso', resuelto:'Resuelto' };

  async function handleBulkResolve() {
    const ids = [...selected];
    const { error } = await window.bulkUpdateIncidencias(ids, { estado: 'resuelto' });
    if (error) { alert('Error: ' + error.message); return; }
    await window.refrescarFase2();
    if (ids.length) window.logActivity?.({ modulo:'incidencias', accion:'bulk_editar', entidad_label:`${ids.length} incidencias`, detalles:{ campo:'estado', valor:'resuelto', ids } });
    setSelected(new Set()); refresh();
  }

  async function handleBulkDelete() {
    if (!confirm(`¿Eliminar ${selected.size} incidencia${selected.size!==1?'s':''}? Se enviarán a la papelera.`)) return;
    const targets = SSData.incidencias.filter(i => selected.has(i.id));
    const ok = [], fail = [];
    for (const inc of targets) {
      const { error } = await window.deleteIncidencia(inc.id);
      if (error) { fail.push(inc); continue; }
      window.ssTrash?.add('incidencia', inc.id, inc);
      ok.push(inc);
    }
    if (fail.length) alert(`No se pudieron eliminar ${fail.length} incidencia${fail.length!==1?'s':''}.`);
    if (ok.length) window.logActivity?.({ modulo:'incidencias', accion: ok.length===1?'eliminar':'bulk_eliminar', entidad_id: ok.length===1?ok[0].id:null, entidad_label: ok.length===1?ok[0].id:`${ok.length} incidencias`, detalles:{ ids: ok.map(i=>i.id) } });
    await window.refrescarFase2();
    setSelected(new Set()); refresh();
  }

  function exportCSV() {
    const rows = incidencias.filter(i => selected.has(i.id));
    const header = 'ID,Despacho,Driver,Cliente,Estado,Fecha';
    const lines = rows.map(i => [i.id, i.despacho_id, i.driver?.nombre||i.driver_id, i.cliente?.nombre||i.cliente_id, i.estado, i.fecha].join(','));
    const blob = new Blob([header+'\n'+lines.join('\n')], { type:'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'incidencias.csv'; a.click();
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Incidencias</h1>
          <div className="page-subtitle">{SSData.incidencias.length} incidencias registradas · {counts.pendiente} pendientes</div>
        </div>
        <div className="page-actions">
          <button className="btn ghost" onClick={() => setShowActivity(true)} title="Ver actividad"><Icon name="receipt" size={14}/>Actividad</button>
        </div>
      </div>

      {showActivity && <ActivityLogModal modulo="incidencias" onClose={()=>setShowActivity(false)}/>}

      <div className="tbl-wrap">
        <div className="tbl-toolbar">
          <div style={{ display:'flex', gap:4 }}>
            {[['all','Todas'],['pendiente','Pendientes'],['en_proceso','En proceso'],['resuelto','Resueltos']].map(([id,label]) => (
              <button key={id} className={'btn sm '+(filter===id?'primary':'ghost')} onClick={() => { setFilter(id); setPage(1); setSelected(new Set()); }}>
                {label}
                {id!=='all' && counts[id]>0 && <span style={{ marginLeft:4, background:'rgba(255,255,255,.25)', borderRadius:99, padding:'1px 5px', fontSize:10 }}>{counts[id]}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{width:36}}><input type="checkbox" checked={allChecked} ref={el => { if (el) el.indeterminate = someChecked; }} onChange={toggleAll} style={{cursor:'pointer'}}/></th>
                <th>ID</th><th className="hide-sm">Despacho</th><th className="hide-sm">Driver</th><th>Cliente</th><th className="hide-sm">Descripción</th>
                <th className="num hide-sm">Faltantes</th><th className="hide-sm">Evidencia</th><th>Estado</th><th className="hide-sm">Fecha</th><th className="dt-hide-mobile">Creado por</th><th style={{width:60}}></th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 && <tr><td colSpan={12} style={{ textAlign:'center', padding:'32px 0', color:'var(--text-muted)' }}>Sin incidencias</td></tr>}
              {paginated.map(i => {
                const isSel = selected.has(i.id);
                return (
                  <tr key={i.id} style={{ cursor:'pointer', background: isSel ? 'var(--brand-soft, #eff6ff)' : '' }}
                    onClick={() => selected.size > 0 ? toggleOne(i.id) : setDetail(i)}>
                    <td onClick={e=>e.stopPropagation()}><input type="checkbox" checked={isSel} onChange={() => toggleOne(i.id)} style={{cursor:'pointer'}}/></td>
                    <td className="mono-cell">
                      <div>{i.id}</div>
                      <div className="show-sm-only small muted" style={{fontSize:11, marginTop:2, fontFamily:'var(--mono)'}}>
                        {i.despacho_id} · {fmt.date(i.fecha)}
                      </div>
                    </td>
                    <td className="mono-cell muted hide-sm">{i.despacho_id}</td>
                    <td className="hide-sm">
                      {i.driver ? (
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <div style={{ width:28,height:28,borderRadius:99,background:driverColor(i.driver_id),color:'#fff',display:'grid',placeItems:'center',fontSize:11,fontWeight:700,flexShrink:0 }}>
                            {driverInitials(i.driver.nombre)}
                          </div>
                          <span style={{ fontSize:13 }}>{i.driver.nombre}</span>
                        </div>
                      ) : <span className="muted">{i.driver_id}</span>}
                    </td>
                    <td style={{ fontSize:13 }}>
                      <div>{i.cliente?.nombre || i.cliente_id}</div>
                      <div className="show-sm-only small muted" style={{fontSize:11, marginTop:2, lineHeight:1.3, maxWidth:'100%'}}>
                        {i.driver?.nombre && <span>{i.driver.nombre} · </span>}
                        {i.descripcion}
                      </div>
                    </td>
                    <td className="hide-sm" style={{ fontSize:13, maxWidth:240 }}>{i.descripcion}</td>
                    <td className="num hide-sm">
                      {(i.items_faltantes||[]).length > 0
                        ? <span className="chip red">{(i.items_faltantes||[]).reduce((s,x)=>s+(x.esperado-x.entregado),0)} uds</span>
                        : <span className="muted">—</span>}
                    </td>
                    <td className="hide-sm">
                      <div style={{ display:'flex', gap:4 }}>
                        {i.foto  && <span className="chip blue">Foto</span>}
                        {i.firma && <span className="chip neutral">Firma</span>}
                        {!i.foto && !i.firma && <span className="muted small">—</span>}
                      </div>
                    </td>
                    <td><span className={'chip '+(estadoColor[i.estado]||'neutral')}>{estadoLabel[i.estado]||i.estado}</span></td>
                    <td className="muted hide-sm">{fmt.date(i.fecha)}</td>
                    <td className="dt-hide-mobile"><CreadoPorCell nombre={i.creado_por}/></td>
                    <td onClick={e=>e.stopPropagation()}>
                      <div style={{display:'flex', gap:4}}>
                        <button className="icon-btn" onClick={() => setDetail(i)}><Icon name="external" size={14}/></button>
                        {window.canUser?.('eliminar','incidencias') !== false && <button className="icon-btn danger" onClick={async () => {
                          if (!confirm('¿Eliminar esta incidencia? Se enviará a la papelera.')) return;
                          const { error } = await window.deleteIncidencia(i.id);
                          if (error) { alert('Error al eliminar: ' + error.message); return; }
                          window.ssTrash?.add('incidencia', i.id, i);
                          await window.refrescarFase2();
                          refresh();
                        }}><Icon name="trash" size={14}/></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px',borderTop:'1px solid var(--border)',fontSize:12,gap:10,flexWrap:'wrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span className="muted">Filas por página:</span>
            <select className="select" value={pageSize} onChange={e=>{setPageSize(parseInt(e.target.value));setPage(1);}} style={{fontSize:12,padding:'3px 6px'}}>
              {[50,100,200].map(n=><option key={n} value={n}>{n}</option>)}
            </select>
            <span className="muted">{incidencias.length===0?'0':`Mostrando ${(page-1)*pageSize+1}–${Math.min(page*pageSize,incidencias.length)} de ${incidencias.length}`}</span>
          </div>
          {totalPages>1&&<div style={{display:'flex',gap:4}}>
            <button className="btn sm ghost" disabled={page===1} onClick={() => setPage(p=>p-1)}>‹</button>
            {Array.from({length:Math.min(5,totalPages)},(_,idx)=>{ const start=Math.max(1,Math.min(page-2,totalPages-4)); const p=start+idx; return p>=1&&p<=totalPages?(<button key={p} className={'btn sm '+(page===p?'primary':'ghost')} onClick={()=>setPage(p)}>{p}</button>):null; })}
            <button className="btn sm ghost" disabled={page===totalPages} onClick={() => setPage(p=>p+1)}>›</button>
          </div>}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="docs-bulk-bar" style={{position:'fixed',bottom:28,left:'50%',transform:'translateX(-50%)',background:'var(--bg-elev)',border:'1px solid var(--border)',borderRadius:16,boxShadow:'0 12px 40px rgba(0,0,0,.35)',display:'flex',alignItems:'center',gap:6,padding:'10px 14px',zIndex:300,backdropFilter:'blur(12px)',flexWrap:'wrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,paddingRight:10,borderRight:'1px solid var(--border)',marginRight:4}}>
            <div style={{width:24,height:24,borderRadius:8,background:'var(--brand)',display:'grid',placeItems:'center',color:'#fff',fontSize:11,fontWeight:700}}>{selected.size}</div>
            <span style={{fontSize:13,fontWeight:600}}>incidencia{selected.size!==1?'s':''} seleccionada{selected.size!==1?'s':''}</span>
          </div>
          <button className="btn ghost sm" onClick={exportCSV}><Icon name="download" size={13}/>Exportar CSV</button>
          {window.canUser?.('editar','incidencias') !== false && <button className="btn ghost sm" style={{color:'var(--success)'}} onClick={handleBulkResolve}><Icon name="check" size={13}/>Marcar resueltas</button>}
          {window.canUser?.('eliminar','incidencias') !== false && <button className="btn ghost sm" style={{color:'var(--danger)'}} onClick={handleBulkDelete}><Icon name="trash" size={13}/>Eliminar</button>}
          <button className="icon-btn" onClick={() => setSelected(new Set())} style={{marginLeft:4}}><Icon name="x" size={15}/></button>
        </div>
      )}

      {detail && (
        <IncidenciaDetailModal
          incidencia={detail}
          onClose={() => setDetail(null)}
          onUpdate={async () => {
            await window.refrescarFase2();
            refresh();
            setDetail(null);
          }}
        />
      )}
    </div>
  );
};

// ─── IncidenciaDetailModal ─────────────────────────────────────────────────
function IncidenciaDetailModal({ incidencia, onClose, onUpdate }) {
  const [estado, setEstado] = useState(incidencia.estado);
  const [notas,  setNotas]  = useState(incidencia.notas || '');
  const [saving, setSaving] = useState(false);
  const driver  = SSData.drivers.find(d => d.id === incidencia.driver_id);
  const cliente = SSData.clientes.find(c => c.id === incidencia.cliente_id);

  async function handleSave() {
    setSaving(true);
    const { error } = await window.saveIncidencia({ ...incidencia, estado, notas });
    if (error) { alert('Error al guardar: ' + error.message); setSaving(false); return; }
    window.logActivity?.({ modulo:'incidencias', accion:'editar', entidad_id: incidencia.id, entidad_label: incidencia.id, detalles:{ estado, notas } });
    setSaving(false);
    onUpdate();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{ width:640 }}>
        <div className="modal-header">
          <div style={{ width:40,height:40,borderRadius:10,background:'var(--danger-soft)',color:'var(--danger)',display:'grid',placeItems:'center' }}>
            <Icon name="info" size={20}/>
          </div>
          <div style={{ flex:1 }}>
            <h3 className="modal-title">Incidencia {incidencia.id}</h3>
            <div className="small mono muted">{incidencia.despacho_id} · {fmt.date(incidencia.fecha)}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          <div className="grid-2" style={{ marginBottom:16 }}>
            <div>
              <div className="form-label">Driver</div>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:4 }}>
                {driver && <div style={{ width:32,height:32,borderRadius:99,background:driverColor(incidencia.driver_id),color:'#fff',display:'grid',placeItems:'center',fontSize:12,fontWeight:700 }}>{driverInitials(driver.nombre)}</div>}
                <div>
                  <div style={{ fontWeight:600, fontSize:14 }}>{driver?.nombre || incidencia.driver_id}</div>
                  <div className="small muted">{driver?.vehiculo} · {driver?.placa}</div>
                </div>
              </div>
            </div>
            <div>
              <div className="form-label">Cliente</div>
              <div style={{ fontWeight:600, fontSize:14, marginTop:4 }}>{cliente?.nombre || incidencia.cliente_id}</div>
              <div className="small muted">{cliente?.ciudad}</div>
            </div>
          </div>

          <div style={{ background:'var(--bg-sunken)', borderRadius:10, padding:14, marginBottom:16 }}>
            <div style={{ fontWeight:600, fontSize:13, marginBottom:4 }}>Descripción</div>
            <div style={{ fontSize:14, color:'var(--text-2)' }}>{incidencia.descripcion}</div>
          </div>

          {(incidencia.items_faltantes||[]).length > 0 && (
            <div style={{ marginBottom:16 }}>
              <div style={{ fontWeight:600, fontSize:13, marginBottom:8 }}>Productos con faltante</div>
              <table className="tbl">
                <thead><tr><th>SKU</th><th>Producto</th><th className="num">Esperado</th><th className="num">Entregado</th><th className="num">Faltante</th></tr></thead>
                <tbody>
                  {(incidencia.items_faltantes||[]).map((item,i) => (
                    <tr key={i}>
                      <td className="mono-cell">{item.sku}</td>
                      <td>{item.nombre}</td>
                      <td className="num">{item.esperado}</td>
                      <td className="num">{item.entregado}</td>
                      <td className="num"><span className="chip red">{item.esperado-item.entregado}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(incidencia.foto || incidencia.firma) && (
            <div style={{ display:'flex', gap:16, marginBottom:16 }}>
              {incidencia.foto && (
                <div style={{ flex:1 }}>
                  <div className="form-label">Foto de entrega</div>
                  <img src={incidencia.foto} alt="entrega" style={{ width:'100%', borderRadius:8, maxHeight:180, objectFit:'cover', marginTop:4, border:'1px solid var(--border)' }}/>
                </div>
              )}
              {incidencia.firma && (
                <div style={{ flex:1 }}>
                  <div className="form-label">Firma del cliente</div>
                  <img src={incidencia.firma} alt="firma" style={{ width:'100%', borderRadius:8, background:'#fff', border:'1px solid var(--border)', marginTop:4 }}/>
                </div>
              )}
            </div>
          )}

          <div className="grid-2">
            <div>
              <label className="form-label">Estado</label>
              <select className="select" style={{ width:'100%' }} value={estado} onChange={e=>setEstado(e.target.value)}>
                <option value="pendiente">Pendiente</option>
                <option value="en_proceso">En proceso</option>
                <option value="resuelto">Resuelto</option>
              </select>
            </div>
            <div>
              <label className="form-label">Notas internas</label>
              <textarea className="input" rows={3} style={{ resize:'vertical', width:'100%', boxSizing:'border-box' }} value={notas} onChange={e=>setNotas(e.target.value)} placeholder="Observaciones, acciones tomadas…"/>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          {window.canUser?.('editar','incidencias') !== false && <button className="btn primary" disabled={saving} onClick={handleSave}>
            <Icon name="check" size={14}/>{saving?'Guardando…':'Guardar cambios'}
          </button>}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  DriversPage:      window.DriversPage,
  DriverPortalPage: window.DriverPortalPage,
  IncidenciasPage:  window.IncidenciasPage,
});
