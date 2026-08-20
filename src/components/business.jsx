// Clientes, Proveedores, CxC/CxP, Bancos
const { useState, useMemo, useEffect } = React;
const PAGE_SIZE = 50; // legacy fallback
const PAGE_SIZE_OPTS = [50, 100, 200];
function loadPageSize(modulo, def = 50) {
  const v = parseInt(localStorage.getItem('ss-' + modulo + '-pagesize'));
  return PAGE_SIZE_OPTS.includes(v) ? v : def;
}

// ── Normalizadores + chequeos de unicidad de clientes/contactos ──
// Definidos en core.jsx (window.ss*) porque pos.jsx (eager) también los necesita y business.jsx
// es lazy — un chunk lazy no puede exponer globals a uno que puede cargar antes. Alias locales
// para no tener que prefijar cada call site con `window.`.
const ssNormTel               = window.ssNormTel;
const ssNormEmail             = window.ssNormEmail;
const ssNormNombre            = window.ssNormNombre;
const findDupContactoEmail    = window.ssFindDupContactoEmail;
const findDupContactoTelefono = window.ssFindDupContactoTelefono;
const findDupClienteRif       = window.ssFindDupClienteRif;
const findDupClienteNombre    = window.ssFindDupClienteNombre;

window.ClientsPage = function ClientsPage({ clienteId } = {}) {
  // Para el selector de columnas (mostrar/ocultar y ancho). Ver `window.TablaColumnas`.
  const tablaClientesRef = React.useRef(null);
  const [detalle, setDetalle]   = useState(null);
  // Otro módulo puede pedir "abrime este cliente" dejando su id en `window.__ssOpenCliente` y
  // navegando acá (lo usa Retenciones). Se consume UNA vez: si quedara puesto, volver a Clientes
  // por cualquier otro camino reabriría la ficha sola. Misma convención que `__ssOpenOC`.
  const [search, setSearch]     = useState('');
  // Dos formas de llegar a una ficha: la URL /clientes/{id} —que es la que usan los enlaces al
  // cliente de CxC, CxP, las listas del flujo y Anticipos, y la única que sobrevive a un
  // Ctrl+clic o al botón "atrás"— y la variable `window.__ssOpenCliente`, que dejó puesta otro
  // módulo (Retenciones). La variable se consume UNA vez: si quedara escrita, volver a Clientes
  // por cualquier otro camino reabriría la ficha sola.
  React.useEffect(() => {
    const id = clienteId || window.__ssOpenCliente;
    if (!id) { setDetalle(null); return; }
    window.__ssOpenCliente = null;
    let vivo = true;
    (async () => {
      // Puede no estar en memoria: el catálogo de clientes no viaja en el arranque.
      await window.ensureClientes?.([id]);
      if (!vivo) return;
      const c = (SSData.clientes || []).find(x => x.id === id);
      if (c) setDetalle(c);
      else setDetalle({ id, nombre: id, _noEncontrado: true });
      // Y se deja el buscador apuntando a él, así al cerrar la ficha la lista queda en su fila
      // en vez de en la primera página de 13.096.
      setSearch(c?.rif || c?.nombre || id);
    })();
    return () => { vivo = false; };
  }, [clienteId]);
  const [tipoF, setTipoF]       = useState('');
  const [showNew, setShowNew]   = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(() => loadPageSize('clientes', 50));
  // Contador para volver a pedir la página tras crear/editar/eliminar (la lista ya no vive en
  // memoria, así que mutar SSData no alcanza: hay que re-consultar).
  const [version, setVersion]   = useState(0);
  useEffect(() => { localStorage.setItem('ss-clientes-pagesize', String(pageSize)); }, [pageSize]);
  // Un cliente nuevo o editado (NewClientModal escribe y llama a loadAppData) tiene que
  // aparecer sin recargar la pantalla.
  useEffect(() => {
    const bump = () => setVersion(v => v + 1);
    window.addEventListener('ss-data-extra-loaded', bump);
    return () => window.removeEventListener('ss-data-extra-loaded', bump);
  }, []);

  useEffect(() => {
    const nav = window.__ssCmdNav;
    if (nav?.kind === 'Cliente' && nav.id) {
      window.__ssCmdNav = null;
      const target = (SSData.clientes || []).find(c => c.id === nav.id);
      if (target) setDetalle(target);
    }
  }, []);

  // ── Carga PAGINADA server-side ──────────────────────────────────────────────
  // Antes se bajaban los 13.096 clientes y se paginaba en el navegador. Ahora se pide solo la
  // página, con el filtro y la búsqueda resueltos en la base (con debounce al tipear).
  const [paginaClientes, setPaginaClientes] = useState([]);
  const [totalFilas, setTotalFilas]         = useState(0);
  const [resumen, setResumen]               = useState(null);
  const [cargando, setCargando]             = useState(true);
  useEffect(() => {
    if (!window.loadClientes) return;
    let vivo = true;
    setCargando(true);
    const pedir = () => window.loadClientes({ page, pageSize, search, tipo: tipoF })
      .then(r => { if (!vivo) return; setPaginaClientes(r.rows); setTotalFilas(r.total); if (r.resumen) setResumen(r.resumen); setCargando(false); })
      .catch(() => { if (vivo) setCargando(false); });
    if (!search.trim()) { pedir(); return () => { vivo = false; }; }
    const t = setTimeout(pedir, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [page, pageSize, search, tipoF, version]);

  // ── Stats en vivo por cliente (ventasYTD, deuda, última compra) ──
  // Se calculan solo para los clientes DE LA PÁGINA: es lo único que se muestra, y así no hace
  // falta tener el catálogo entero en memoria.
  const añoActual = window.caracasYear();
  // Ventas del año y última compra: las trae el SERVER para los clientes de esta página. Antes se
  // sumaban sobre `SSData.documentos` (ventana de 90 días), así que la columna "ventas YTD" en
  // realidad mostraba tres meses. La deuda sí sale de memoria: CxC se carga completa.
  const [ventasByCliente, setVentasByCliente] = useState({});
  const idsPagina = paginaClientes.map(c => c.id).join(',');
  useEffect(() => {
    if (!idsPagina) { setVentasByCliente({}); return; }
    let vivo = true;
    window.statsClientesPagina?.(idsPagina.split(','))
      .then(r => { if (vivo) setVentasByCliente(r || {}); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [idsPagina]);
  const statsByCliente = useMemo(() => {
    const map = {};
    paginaClientes.forEach(c => {
      const v = ventasByCliente[c.id] || {};
      map[c.id] = { ventasYTD: v.ventasYTD || 0, deuda: 0, ultimaCompra: v.ultimaCompra || null };
    });
    SSData.cuentasCobrar.forEach(cxc => {
      const s = map[cxc.cliente]; if (!s) return;
      s.deuda += (cxc.monto - cxc.pagado);
    });
    return map;
  }, [paginaClientes, ventasByCliente, SSData.cuentasCobrar]);

  if (detalle) return <ClientDetailPage cliente={detalle} desdeEnlace={!!clienteId} onBack={() => {
    setDetalle(null);
    if (clienteId) window.__ssNavigate?.('/clientes');
  }} />;

  // Los totales del encabezado vienen AGREGADOS de la base (RPC clientes_resumen), con los
  // mismos filtros que la lista. Antes se sumaban en memoria sobre los 13.096 clientes y sobre
  // `SSData.documentos`, que solo trae 90 días — así que además de exigir el catálogo completo,
  // las ventas YTD salían cortas.
  const totalDeuda   = resumen ? resumen.deuda      : 0;
  const totalVentas  = resumen ? resumen.ventasYTD  : 0;
  const totalCredito = resumen ? resumen.credito    : 0;

  const rows = paginaClientes;                 // la página que devolvió el server
  const totalPages = Math.max(1, Math.ceil(totalFilas / pageSize));
  const paginated  = rows;

  // "Seleccionar todo" marca la PÁGINA visible. Antes marcaba todas las filas filtradas porque
  // estaban todas en memoria; con paginación server-side eso significaría traer el universo solo
  // para seleccionarlo — y una acción masiva sobre 13.096 clientes que no se ven en pantalla es
  // justamente lo que no conviene poder hacer de un clic.
  function toggleAll() { if (selected.size >= rows.length) setSelected(new Set()); else setSelected(new Set(rows.map(c=>c.id))); }
  function toggleOne(id,e) { e.stopPropagation(); setSelected(prev=>{const s=new Set(prev);s.has(id)?s.delete(id):s.add(id);return s;}); }

  function exportCSV() {
    const data = (selected.size > 0 ? rows.filter(c => selected.has(c.id)) : rows);
    if (data.length === 0) { alert('No hay clientes para exportar.'); return; }
    const cols = [
      { key:'nombre',    label:'Nombre' },
      { key:'rif',       label:'RIF' },
      { key:'tipo',      label:'Tipo' },
      { key:'persona',   label:'Persona' },
      { key:'telefono',  label:'Teléfono' },
      { key:'email',     label:'Email' },
      { key:'ciudad',    label:'Ciudad' },
      { key:'direccion', label:'Dirección' },
      { key:'ventasYTD', label:'Ventas YTD' },
      { key:'deuda',     label:'Deuda' },
      { key:'fuente',    label:'Fuente' },
      { key:'vendedor',  label:'Vendedor' },
    ];
    window.exportToXLSX(data, cols, 'clientes', 'Clientes');
  }

  async function bulkDelete() {
    if (!confirm(`¿Eliminar ${selected.size} cliente${selected.size!==1?'s':''}? Se enviarán a la papelera por 30 días.`)) return;
    const targets = SSData.clientes.filter(c => selected.has(c.id));
    const ok = [], fail = [];
    for (const c of targets) {
      const { error } = await window.sb.from('clientes').update({ activo: false }).eq('id', c.id);
      if (!error) { window.ssTrash?.add('cliente', c.nombre, c); ok.push(c); }
      else fail.push(c);
    }
    // Fix bug #29: antes se mutaba SSData filtrando por `selected` (no por `ok`), así que un
    // soft-delete fallido en DB igual desaparecía de la UI (fila quedaba activo=true e invisible).
    // Ahora quitamos SOLO los que sí se desactivaron y avisamos los fallidos.
    const okIds = new Set(ok.map(c => c.id));
    SSData.clientes = SSData.clientes.filter(c => !okIds.has(c.id));
    setSelected(new Set());
    if (fail.length) alert(`No se pudieron eliminar ${fail.length} cliente${fail.length!==1?'s':''}: ` + fail.map(c=>c.nombre).join(', '));
    if (ok.length) {
      window.logActivity?.({
        modulo:'clientes', accion: ok.length === 1 ? 'eliminar' : 'bulk_eliminar',
        entidad_id: ok.length === 1 ? ok[0].id : null,
        entidad_label: ok.length === 1 ? ok[0].nombre : `${ok.length} clientes`,
        detalles:{ ids: ok.map(c => c.id), nombres: ok.map(c => c.nombre) }
      });
      setVersion(v => v + 1);   // re-pedir la página (la lista es server-side)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Clientes</h1>
          <div className="page-subtitle">{totalFilas.toLocaleString('es-VE')} clientes · {fmt.usd(totalDeuda)} en deuda activa</div>
        </div>
        <div className="page-actions">
          <button className="btn secondary" onClick={exportCSV}><Icon name="download" size={14}/>Exportar</button>
          {window.canUser?.('crear', 'clients') !== false && (
            <button className="btn primary" onClick={()=>setShowNew(true)}><Icon name="plus" size={14}/>Nuevo cliente</button>
          )}
        </div>
      </div>
      {showNew && <NewClientModal onClose={()=>setShowNew(false)}/>}

      <div className="stat-grid hide-sm">
        <div className="stat"><div className="stat-label">Clientes activos</div><div className="stat-val">{totalFilas.toLocaleString('es-VE')}</div></div>
        <div className="stat"><div className="stat-label">Crédito otorgado</div><div className="stat-val">{fmt.usd(totalCredito)}</div></div>
        <div className="stat"><div className="stat-label">Deuda activa</div><div className="stat-val" style={{color: totalDeuda > 0 ? 'var(--warn)' : 'inherit'}}>{fmt.usd(totalDeuda)}</div></div>
        <div className="stat"><div className="stat-label">Ventas YTD ({añoActual})</div><div className="stat-val">{fmt.usd(totalVentas)}</div></div>
      </div>

      <div className="tbl-wrap mt-4">
        <div className="tbl-toolbar">
          <input className="input search" placeholder="Buscar cliente, RIF o contacto..." value={search} onChange={e=>{setSearch(e.target.value);setPage(1);setSelected(new Set());}} style={{width:280}}/>
          <select className="select" value={tipoF} onChange={e=>{setTipoF(e.target.value);setPage(1);setSelected(new Set());}}>
            <option value="">Todos los tipos</option>
            {SSData.tiposCliente.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
          <span className="ml-auto small">{cargando ? 'Cargando…' : `${totalFilas.toLocaleString('es-VE')} clientes`}{selected.size>0?` · ${selected.size} seleccionados`:''}</span>
          <button className="btn ghost sm" onClick={() => setShowActivity(true)} title="Ver registro de actividad"><Icon name="receipt" size={13}/>Actividad</button>
          <window.TablaColumnas moduloId="clientes" tablaRef={tablaClientesRef}/>
        </div>
        <div className="tbl-scroll">
          <table className="tbl" ref={tablaClientesRef}>
            <thead>
              <tr>
                <th style={{width:36,padding:'4px 10px'}}>
                  <input type="checkbox"
                    ref={el=>{if(el)el.indeterminate=selected.size>0&&selected.size<rows.length;}}
                    checked={rows.length>0&&selected.size>=rows.length}
                    onChange={toggleAll} style={{cursor:'pointer'}}/>
                </th>
                <th>Cliente</th><th className="hide-sm">RIF</th><th className="hide-sm">Tipo</th><th className="hide-sm">Ciudad</th><th className="hide-sm">Vendedor</th><th className="hide-sm">Lista de precios</th><th className="num">Ventas YTD</th><th className="hide-sm">Crédito usado</th><th className="num hide-sm">Últ. compra</th><th className="dt-hide-mobile">Creado por</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(c => {
                const tc = SSData.tiposCliente.find(t => t.id === c.tipo);
                const lp = SSData.listasPrecios.find(l => l.id === c.listaPrecio);
                const st = statsByCliente[c.id] || { ventasYTD: 0, deuda: 0, ultimaCompra: null };
                const pct = c.limiteCredito > 0 ? (st.deuda/c.limiteCredito)*100 : 0;
                const isSel = selected.has(c.id);
                return (
                  <tr key={c.id}
                    onClick={e=>{if(selected.size>0)toggleOne(c.id,e);else setDetalle(c);}}
                    style={{cursor:'pointer',background:isSel?'var(--brand-soft)':''}}>
                    <td style={{padding:'4px 10px',width:36}} onClick={e=>toggleOne(c.id,e)}>
                      <input type="checkbox" checked={isSel} onChange={()=>{}} style={{cursor:'pointer',pointerEvents:'none'}}/>
                    </td>
                    <td>
                      <div style={{fontWeight:500}}>{c.nombre}</div>
                      <div className="small">{c.contacto}</div>
                      <div className="show-sm-only small" style={{marginTop:3, display:'flex', gap:5, flexWrap:'wrap', alignItems:'center'}}>
                        <span className="mono" style={{color:'var(--text-muted)', fontSize:11}}>{c.rif}</span>
                        <span className="chip" style={{background: (tc?.color||'var(--text-muted)')+'20', color: tc?.color||'var(--text-muted)', fontSize:10, padding:'1px 6px'}}>{tc?.nombre||'—'}</span>
                        {c.ciudad && <span className="muted" style={{fontSize:11}}>· {c.ciudad}</span>}
                      </div>
                    </td>
                    <td className="mono-cell hide-sm">{c.rif}</td>
                    <td className="hide-sm"><span className="chip" style={{background: (tc?.color||'var(--text-muted)')+'20', color: tc?.color||'var(--text-muted)'}}><span className="chip-dot"/>{tc?.nombre||'—'}</span></td>
                    <td className="hide-sm">{c.ciudad}</td>
                    <td className="hide-sm" style={{fontSize:12}}>{c.vendedor || <span className="muted">—</span>}</td>
                    <td className="muted hide-sm" style={{fontSize:12}}>{lp?.nombre}</td>
                    <td className="num strong-num">{fmt.usd(st.ventasYTD)}</td>
                    <td className="hide-sm">
                      <div className="flex items-center gap-2">
                        <span className="credit-bar"><span className={pct>80?'danger':pct>50?'warn':''} style={{width:`${Math.min(100,pct)}%`}}/></span>
                        <span className="mono small">{fmt.usd(st.deuda)}</span>
                      </div>
                    </td>
                    <td className="num muted hide-sm">{st.ultimaCompra ? fmt.date(st.ultimaCompra) : '—'}</td>
                    <td className="dt-hide-mobile"><CreadoPorCell nombre={c.creado_por}/></td>
                  </tr>
                );
              })}
              {paginated.length===0&&<tr><td colSpan={11} className="empty">Sin clientes</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px',borderTop:'1px solid var(--border)',fontSize:12,gap:10,flexWrap:'wrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span className="muted">Filas por página:</span>
            <select className="select" value={pageSize} onChange={e=>{setPageSize(parseInt(e.target.value));setPage(1);}} style={{fontSize:12,padding:'3px 6px'}}>
              {PAGE_SIZE_OPTS.map(n=><option key={n} value={n}>{n}</option>)}
            </select>
            <span className="muted">{totalFilas===0?'0 clientes':`Mostrando ${(page-1)*pageSize+1}–${Math.min(page*pageSize,totalFilas)} de ${totalFilas.toLocaleString('es-VE')}`}</span>
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

      {showActivity && <ActivityLogModal modulo="clientes" onClose={()=>setShowActivity(false)}/>}

      {selected.size>0&&(
        <div className="docs-bulk-bar" style={{position:'fixed',bottom:28,left:'50%',transform:'translateX(-50%)',background:'var(--bg-elev)',border:'1px solid var(--border)',borderRadius:16,boxShadow:'0 12px 40px rgba(0,0,0,.35)',display:'flex',alignItems:'center',gap:6,padding:'10px 14px',zIndex:300,backdropFilter:'blur(12px)',flexWrap:'wrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,paddingRight:10,borderRight:'1px solid var(--border)',marginRight:4}}>
            <div style={{width:24,height:24,borderRadius:8,background:'var(--brand)',display:'grid',placeItems:'center',color:'#fff',fontSize:11,fontWeight:700}}>{selected.size}</div>
            <span style={{fontSize:13,fontWeight:600}}>cliente{selected.size!==1?'s':''} seleccionado{selected.size!==1?'s':''}</span>
          </div>
          <button className="btn ghost sm" onClick={exportCSV}><Icon name="download" size={13}/>Exportar CSV</button>
          {window.canUser?.('eliminar','clients') !== false && <button className="btn ghost sm" onClick={bulkDelete} style={{color:'var(--danger)'}}><Icon name="trash" size={13}/>Eliminar</button>}
          <button className="icon-btn" onClick={()=>setSelected(new Set())} style={{marginLeft:4}}><Icon name="x" size={15}/></button>
        </div>
      )}
    </div>
  );
};

// Registrar un vuelto manualmente (devolución de excedente al cliente). El vuelto nace pendiente
// (cuentas_pagar tipo='vuelto') y se procesa/paga después a la tasa de vuelto.
function NuevoVueltoModal({ cliente, onClose }) {
  const [monto, setMonto] = useState('');
  const [concepto, setConcepto] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  async function guardar() {
    const m = parseFloat(monto) || 0;
    if (m <= 0) { setErr('Ingresá un monto mayor a 0.'); return; }
    setSaving(true); setErr('');
    const { error } = await window.crearVueltoCliente({
      clienteId: cliente.id, monto: m,
      concepto: concepto.trim() || 'Vuelto por excedente',
      pagoOrigenId: null,
    });
    if (error) { setSaving(false); setErr('Error al registrar el vuelto: ' + (error.message || '')); return; }
    window.logActivity?.({ modulo: 'cxp', accion: 'crear', entidad_label: cliente.nombre, detalles: { tipo: 'vuelto', monto: m, manual: true } });
    setSaving(false); onClose(true);
  }
  return (
    <div className="modal-overlay" onClick={() => onClose(false)}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 480 }}>
        <div className="modal-header">
          <div style={{ width:40, height:40, borderRadius:10, background:'var(--warn-soft, #fef3c7)', color:'var(--warn)', display:'grid', placeItems:'center' }}><Icon name="dollar" size={20}/></div>
          <div style={{ flex:1 }}>
            <h3 className="modal-title">Registrar vuelto</h3>
            <div className="small">{cliente.nombre} · devolución de excedente</div>
          </div>
          <button className="icon-btn" onClick={() => onClose(false)}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          <div>
            <label className="form-label">Monto a devolver (USD) <span style={{color:'var(--danger)'}}>*</span></label>
            <input className="input mono" type="number" min="0" step="0.01" placeholder="5.00" value={monto} onChange={e => setMonto(e.target.value)} autoFocus/>
          </div>
          <div className="mt-3">
            <label className="form-label">Concepto</label>
            <input className="input" placeholder="Vuelto por sobrepago en factura…" value={concepto} onChange={e => setConcepto(e.target.value)}/>
          </div>
          <div className="small muted mt-3">Se creará como vuelto pendiente. Al procesarlo se paga a la tasa de vuelto Bs. {SSData.tasa?.vuelto || SSData.tasa?.paralelo}/USD.</div>
          {err && <div style={{ color:'var(--danger)', fontSize:12, marginTop:8 }}>{err}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={() => onClose(false)}>Cancelar</button>
          <button className="btn primary" disabled={saving || !(parseFloat(monto) > 0)} onClick={guardar}>
            <Icon name="check" size={14}/>{saving ? 'Guardando…' : 'Registrar vuelto'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ClientDetailPage({ cliente: clienteInit, onBack, desdeEnlace = false }) {
  const [cliente, setCliente]         = useState(clienteInit);
  // De dónde se vino. Se lee UNA vez al montar: mientras se navega dentro de la ficha (editar,
  // cobrar) `ss-prev-route` se reescribe, y el botón terminaría ofreciendo volver a sí mismo.
  //
  // Solo cuando se llegó por un ENLACE a /clientes/{id}. Abriendo una fila desde la propia lista
  // de Clientes, `ss-prev-route` guarda el módulo anterior de la sesión —el que se visitó antes
  // de entrar a Clientes— y ofrecer volver ahí no tiene nada que ver con lo que el usuario hizo.
  const [origen] = useState(() =>
    (desdeEnlace && window.ssOrigenNavegacion) ? window.ssOrigenNavegacion() : null);
  // ── Habilitar la ficha en la otra empresa ──────────────────────────────────────────────────
  // El caso que lo pidió: un cliente que debe en demo2 pagó a una cuenta de demo1, y al
  // querer identificar ese anticipo el buscador no lo ofrecía porque la ficha existe solo en
  // demo2. Solo se ofrecen las empresas que el usuario tiene habilitadas — nunca todas las
  // del sistema (mismo criterio que las transferencias cross-empresa).
  const [empresasSis, setEmpresasSis] = useState([]);
  const [habilitando, setHabilitando] = useState(null);   // empresa elegida, esperando confirmación
  const [habilitandoBusy, setHabilitandoBusy] = useState(false);
  useEffect(() => { window.loadEmpresas?.().then(l => setEmpresasSis(l || [])); }, []);
  const empresasDelUsuario = (window.__ssCurrentUser?.empresas || []);
  const empresasFaltantes = empresasSis.filter(e =>
    empresasDelUsuario.includes(e.id) && !(cliente.empresas || []).includes(e.id));
  async function confirmarHabilitar() {
    if (!habilitando) return;
    setHabilitandoBusy(true);
    const { data, error } = await window.habilitarClienteEnEmpresa(cliente.id, habilitando.id);
    setHabilitandoBusy(false);
    if (error) { alert('No se pudo habilitar: ' + (error.message || error)); return; }
    setCliente(c => ({ ...c, empresas: data?.empresas || c.empresas }));
    window.logActivity?.({ modulo:'clientes', accion:'editar', entidad_id: String(cliente.id),
                           entidad_label: cliente.nombre,
                           detalles:{ habilitado_en: habilitando.id } });
    const notas = (data?.notas || []).join(' ');
    alert([`${cliente.nombre} ya está disponible en ${habilitando.nombre}.`, notas].filter(Boolean).join('\n\n'));
    setHabilitando(null);
  }
  const [tab, setTab]                 = useState('info');
  const [showPayment, setShowPayment] = useState(false);
  const [editing, setEditing]         = useState(false);
  const [selDeuda, setSelDeuda]       = useState(null);
  const [selPago, setSelPago]         = useState(null);
  const [pagandoVuelto, setPagandoVuelto] = useState(null);
  const [showNuevoVuelto, setShowNuevoVuelto] = useState(false);
  const [showReporteModal, setShowReporteModal] = useState(false);
  const [showActivity, setShowActivity] = useState(false);

  const tc      = SSData.tiposCliente.find(t => t.id === cliente.tipo);
  const lp      = SSData.listasPrecios.find(l => l.id === cliente.listaPrecio);
  // Histórico COMPLETO del cliente on-demand (SSData.documentos está capado a 90 días → antes
  // el detalle solo mostraba ~3 meses de un cliente con años de operación). Fallback al slice.
  const [compras, setCompras] = useState(() => SSData.documentos.filter(d => d.cliente === cliente.id));
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // fetchAll: un cliente puede tener >1000 documentos → sin esto PostgREST cortaría a 1000.
        const { data } = await window.fetchAll(() => window.sb.from('documentos')
          .select('id, tipo, estado, estado_despacho, cliente_id, vendedor, fecha, total, items, modalidad_pago, tipo_factura, slug, created_at')
          .eq('cliente_id', cliente.id)
          .eq('empresa_id', window.currentEmpresa || 'demo1')
          .order('fecha', { ascending: false, nullsFirst: false }));
        if (alive && Array.isArray(data)) {
          setCompras(data.map(d => ({ ...d, cliente: d.cliente_id, total: parseFloat(d.total) || 0 })));
        }
      } catch (e) { /* conserva el slice de 90 días de SSData */ }
    })();
    return () => { alive = false; };
  }, [cliente.id]);
  const deudas  = SSData.cuentasCobrar.filter(d => d.cliente === cliente.id);

  // ── Cálculos en vivo (no usar campos persistidos del cliente que están desactualizados) ──
  const añoActual    = window.caracasYear();
  const ventasYTD    = compras
    // Fix bug #42: forzar hora local antes de getFullYear() para evitar desfase de zona horaria
    // (fechas 'YYYY-MM-DD' se parsean como UTC y en UTC-4 caen en el año anterior).
    .filter(d => (d.tipo === 'factura' || d.estado === 'factura') && new Date(d.fecha + (typeof d.fecha === 'string' && d.fecha.length === 10 ? 'T00:00:00' : '')).getFullYear() === añoActual)
    .reduce((s, d) => s + (d.total || 0), 0);
  const deudaActiva  = deudas.reduce((s, d) => s + (d.monto - d.pagado), 0);
  const limCredito   = cliente.limiteCredito || 0;
  const pct          = limCredito > 0 ? (deudaActiva / limCredito) * 100 : 0;

  // Historial de pagos: carga ON-DEMAND de TODOS los cobros del cliente. SSData.pagos está acotado
  // a 365d, así que subestimaba el total cobrado (ej. cliente con 214 cobros mostraba 7). Se
  // filtra tipo='cobro' (los egresos/vueltos son salidas, no cobros → no deben sumar).
  const [pagosDelCliente, setPagosDelCliente] = useState(() =>
    (SSData.pagos || []).filter(p => p.cliente_id === cliente.id && p.tipo !== 'egreso'));
  useEffect(() => {
    let alive = true;
    window.fetchAll(() => window.sb.from('pagos').select('*').eq('cliente_id', cliente.id).eq('tipo', 'cobro').order('fecha', { ascending: false }))
      .then(({ data }) => {
        if (alive && Array.isArray(data)) setPagosDelCliente(data.map(p => ({
          ...p, monto: parseFloat(p.monto) || 0, monto_usd: parseFloat(p.monto_usd) || 0,
          montoUsd: parseFloat(p.monto_usd) || 0, tasa_usada: p.tasa, metodo: p.metodo || p.banco || '—',
        })));
      }).catch(() => {});
    return () => { alive = false; };
  }, [cliente.id]);
  const pagosHistorial = (pagosDelCliente.length
    ? pagosDelCliente.map(p => ({ ...p, _factura: p.documento_id }))
    : deudas.flatMap(d => (Array.isArray(d.pagos) ? d.pagos : []).map(p => ({ ...p, _factura: d.factura, _deuda_id: d.id })))
  ).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  const totalCobradoUSD  = pagosHistorial.reduce((s, p) => s + (p.monto_usd ?? p.monto ?? 0), 0);
  const deudasPendientes = deudas.filter(d => d.monto > d.pagado);
  const vueltos          = (SSData.cuentasPagar || []).filter(c => c.tipo === 'vuelto' && c.cliente === cliente.id);
  const vueltosPendientes= vueltos.filter(v => (v.monto - (v.pagado || 0)) > 0.001);
  const totalVueltos     = vueltosPendientes.reduce((s, v) => s + (v.monto - (v.pagado || 0)), 0);

  const metodoColor = { transferencia:'var(--brand)', efectivo:'var(--success)', zelle:'var(--accent)', cheque:'var(--warn)', pago_movil:'var(--accent)', binance:'#f0b90b' };

  const STAGE_TO_PATH = { cotizacion:'/cotizaciones', orden:'/ordenes', despacho:'/despachos', factura:'/facturas' };
  function openDoc(d) {
    window.__ssPosOpenDoc = d;
    // La etapa está en `tipo` (estado guarda el sub-status post-migración).
    const path = STAGE_TO_PATH[d.tipo] || STAGE_TO_PATH[d.estado] || '/pos';
    if (window.__ssNavigate) window.__ssNavigate(path);
  }

  function startCotizacion() {
    window.__ssPosPreselect = { clienteId: cliente.id, docId: `COT-2026-${Math.floor(Math.random()*900)+100}` };
    onBack();
    if (window.__ssNavigate) window.__ssNavigate('pos');
  }

  // Datos derivados para el resumen visual
  const ultimoPago    = pagosHistorial[0];
  const ultimaCompra  = compras.reduce((max, d) => (!max || new Date(d.fecha) > new Date(max)) ? d.fecha : max, null);
  const docsPorEstado = compras.reduce((acc, d) => { acc[d.estado] = (acc[d.estado] || 0) + 1; return acc; }, {});
  const totalVencido  = deudasPendientes.filter(d => d.dias > 0).reduce((s,d) => s + (d.monto - d.pagado), 0);

  // Genera el PDF y lo DESCARGA directo (jsPDF). Antes se abría una ventana con
  // window.print(), así que el usuario caía en el diálogo de impresión y tenía que
  // elegir "Guardar como PDF" a mano. El layout vive en pdf.jsx junto al resto de
  // los reportes del sistema.
  async function generarReportePDF(tipoReporte = 'historial') {
    if (!window.generateClienteReportePDF) {
      alert('El generador de PDF no ha cargado aún. Recarga la página e intenta de nuevo.');
      return;
    }
    // `await`: la primera vez el generador puede tener que traer jsPDF (ya no viene en el arranque).
    const ok = await window.generateClienteReportePDF(cliente, {
      deudas:       deudasPendientes,
      compras:      compras,
      pagos:        pagosHistorial,
      ventasYTD:    ventasYTD,
      deudaActiva:  deudaActiva,
      totalVencido: totalVencido,
      totalCobrado: totalCobradoUSD,
    }, tipoReporte);
    if (ok) window.logActivity?.({ modulo:'clientes', accion:'reporte', entidad_id: cliente.id,
      entidad_label: cliente.nombre, detalles:{ tipo: tipoReporte } });
  }

  return (
    <div className="page">
      {/* ── Breadcrumb ── */}
      {/* Cuando se llegó desde otro módulo (CxC, una factura, Anticipos…) el "volver" tiene que
          devolver AHÍ, no a la lista de clientes: el pedido fue textual — "si desde cotizaciones
          le di al cliente y me devuelvo, me debe aparecer en cotizaciones". El origen sale de
          `ss-prev-route`, que `navigate` deja escrito en cada salto. */}
      <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:14, fontSize:12.5, flexWrap:'wrap'}}>
        <button className="btn ghost sm" onClick={onBack} style={{gap:4, padding:'4px 8px'}}>
          <Icon name="chevronL" size={13}/>Clientes
        </button>
        {origen && (
          <button className="btn ghost sm" onClick={() => window.__ssNavigate?.(origen.path)}
                  style={{gap:4, padding:'4px 8px'}} title={'Volver a ' + origen.label}>
            <Icon name="chevronL" size={13}/>{origen.label}
          </button>
        )}
        <span className="muted">/</span>
        <span className="muted">{cliente.nombre}</span>
      </div>

      {/* ── Hero del cliente ── */}
      <div className="card" style={{padding:18, marginBottom:16, display:'flex', alignItems:'flex-start', gap:16, flexWrap:'wrap'}}>
        <div style={{width:56, height:56, borderRadius:14, background:`linear-gradient(135deg, ${tc?.color||'var(--brand)'} 0%, ${tc?.color||'var(--brand)'}cc 100%)`, color:'#fff', display:'grid', placeItems:'center', fontWeight:700, fontSize:20, flexShrink:0, boxShadow:`0 4px 12px ${tc?.color||'var(--brand)'}40`}}>
          {cliente.nombre.slice(0,2).toUpperCase()}
        </div>
        <div style={{flex:1, minWidth:200}}>
          <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:4}}>
            <h1 style={{fontSize:22, fontWeight:700, margin:0, lineHeight:1.2}}>{cliente.nombre}</h1>
            {tc && <span className="chip" style={{background:tc.color+'20', color:tc.color}}>{tc.nombre}</span>}
            {totalVencido > 0 && <span className="chip red" style={{fontSize:11}}>⚠ {fmt.usd(totalVencido)} vencido</span>}
            {/* En qué empresas existe la ficha. Se muestra siempre que haya más de una en el
                sistema: sin esto, "no me aparece el cliente" no tiene explicación visible. */}
            {(cliente.empresas || []).length > 0 && empresasSis.length > 1 && (cliente.empresas || []).map(eid => (
              <span key={eid} className="chip" style={{fontSize:10.5}}
                    title="La ficha del cliente está habilitada en esta empresa">
                {(empresasSis.find(e => e.id === eid)?.nombre) || eid}
              </span>
            ))}
          </div>
          <div style={{display:'flex', gap:14, flexWrap:'wrap', fontSize:12.5, color:'var(--text-muted)'}}>
            <span><strong style={{fontFamily:'monospace', color:'var(--text)'}}>{cliente.rif}</strong></span>
            {cliente.ciudad && <span>📍 {cliente.ciudad}</span>}
            {cliente.contacto && <span>👤 {cliente.contacto}</span>}
            {cliente.telefono && <span style={{fontFamily:'monospace'}}>📞 {cliente.telefono}</span>}
            {cliente.vendedor && <span>🛍 {cliente.vendedor}</span>}
          </div>
        </div>
        <div style={{display:'flex', gap:6, flexShrink:0, flexWrap:'wrap'}}>
          {window.canUser?.('editar', 'clients') !== false && (
          <button className="btn secondary sm" onClick={() => setEditing(true)}><Icon name="edit" size={13}/>Editar</button>
          )}
          <button className="btn secondary sm" onClick={startCotizacion}><Icon name="receipt" size={13}/>Nueva cotización</button>
          <button className="btn secondary sm" onClick={() => setShowReporteModal(true)}><Icon name="download" size={13}/>Reporte</button>
          {window.canUser?.('editar', 'clients') !== false && empresasFaltantes.map(e => (
            <button key={e.id} className="btn secondary sm" onClick={() => setHabilitando(e)}
                    title={'Que este mismo cliente se pueda usar también en ' + e.nombre}>
              <Icon name="external" size={13}/>Habilitar en {e.nombre}
            </button>
          ))}
          <button className="btn ghost sm" onClick={() => setShowActivity(true)} title="Ver actividad de este cliente"><Icon name="clock" size={13}/>Actividad</button>
          {deudasPendientes.length > 0 && (
            <button className="btn primary sm" onClick={() => setShowPayment(true)}><Icon name="dollar" size={13}/>Registrar cobro</button>
          )}
        </div>
      </div>

      {/* ── Stats con indicadores visuales ── */}
      <div className="stat-grid hide-sm" style={{marginBottom:16}}>
        <div className="stat" style={{borderTop:'3px solid var(--brand)'}}>
          <div className="stat-label">Ventas YTD ({añoActual})</div>
          <div className="stat-val">{fmt.usd(ventasYTD)}</div>
          <div className="small mt-1 muted">Última compra: {ultimaCompra ? fmt.date(ultimaCompra) : '—'}</div>
        </div>
        <div className="stat" style={{borderTop:`3px solid ${deudaActiva > 0 ? 'var(--warn)' : 'var(--success)'}`}}>
          <div className="stat-label">Deuda activa</div>
          <div className="stat-val" style={{color: deudaActiva > 0 ? 'var(--warn)' : 'var(--success)'}}>{fmt.usd(deudaActiva)}</div>
          <div className="pbar mt-2" style={{height:4}}><span className={pct>80?'danger':pct>50?'warn':''} style={{width:`${Math.min(100,pct)}%`}}/></div>
          <div className="small mt-1 muted">Límite {fmt.usd(limCredito)} · {cliente.diasCredito || 0}d</div>
        </div>
        <div className="stat" style={{borderTop:'3px solid var(--success)'}}>
          <div className="stat-label">Total cobrado</div>
          <div className="stat-val" style={{color:'var(--success)'}}>{fmt.usd(totalCobradoUSD)}</div>
          <div className="small mt-1 muted">{pagosHistorial.length} pago{pagosHistorial.length!==1?'s':''}{ultimoPago ? ` · últ. ${fmt.date(ultimoPago.fecha)}` : ''}</div>
        </div>
        <div className="stat" style={{borderTop:'3px solid var(--accent)'}}>
          <div className="stat-label">Lista de precios</div>
          <div style={{fontSize:16, fontWeight:600, marginTop:4}}>{lp?.nombre || '—'}</div>
          <div className="small mt-1 muted">{lp?.valor ? `Descuento ${lp.valor}% sobre base` : 'Sin descuento'}</div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{display:'flex', gap:2, borderBottom:'1px solid var(--border)', marginBottom:0, position:'sticky', top:0, background:'var(--bg)', zIndex:10}}>
        {[
          { id:'info',       label:'Información',          count:null },
          { id:'pagos',      label:'Historial de pagos',   count:pagosHistorial.length },
          { id:'documentos', label:'Documentos',           count:compras.length },
          { id:'deudas',     label:'CxC activas',          count:deudasPendientes.length },
          { id:'vueltos',    label:'Vueltos',              count:vueltosPendientes.length },
        ].map(t => (
          <button key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding:'10px 16px', background:'transparent', border:'none',
              borderBottom: tab===t.id ? '2px solid var(--brand)' : '2px solid transparent',
              color: tab===t.id ? 'var(--brand)' : 'var(--text-muted)',
              fontWeight: tab===t.id ? 600 : 500, fontSize:13, cursor:'pointer',
              display:'flex', alignItems:'center', gap:6, marginBottom:-1, transition:'all 0.15s'
            }}>
            {t.label}
            {t.count > 0 && <span style={{background: tab===t.id ? 'var(--brand)' : 'var(--bg-sunken)', color: tab===t.id ? '#fff' : 'var(--text-muted)', borderRadius:8, padding:'1px 7px', fontSize:11, fontWeight:600, minWidth:20, textAlign:'center'}}>{t.count}</span>}
          </button>
        ))}
      </div>

      {/* ── INFO ── */}
      {tab === 'info' && (
        <div className="grid-2 mt-4" style={{gap:16, alignItems:'start'}}>
          <div className="card">
            <div className="card-header"><h3 className="card-title">Condiciones comerciales</h3></div>
            <div className="card-body" style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px 20px', fontSize:13}}>
              <div>
                <div className="muted" style={{fontSize:11, marginBottom:3, textTransform:'uppercase', letterSpacing:'0.03em'}}>Términos de pago</div>
                <div style={{fontWeight:500}}>{cliente.terminos_pago === 'inmediato' ? 'Pago inmediato' : cliente.terminos_pago ? `Crédito ${cliente.terminos_pago}d` : '—'}</div>
              </div>
              <div>
                <div className="muted" style={{fontSize:11, marginBottom:3, textTransform:'uppercase', letterSpacing:'0.03em'}}>Tipo de venta</div>
                <div style={{fontWeight:500, textTransform:'capitalize'}}>{cliente.tipo_venta || '—'}</div>
              </div>
              <div>
                <div className="muted" style={{fontSize:11, marginBottom:3, textTransform:'uppercase', letterSpacing:'0.03em'}}>Tipo de entrega</div>
                {/* El rótulo sale de `pos_tipos_entrega` (migración 81): lo guardado es el
                    código ('retiro'), y mostrarlo crudo obligaba a traducirlo de memoria. */}
                <div style={{fontWeight:500}}>{window.ssLabelEntrega(cliente.tipo_entrega)}</div>
              </div>
              <div>
                <div className="muted" style={{fontSize:11, marginBottom:3, textTransform:'uppercase', letterSpacing:'0.03em'}}>Vendedor asignado</div>
                <div style={{fontWeight:500}}>{cliente.vendedor || '—'}</div>
              </div>
              <div>
                <div className="muted" style={{fontSize:11, marginBottom:3, textTransform:'uppercase', letterSpacing:'0.03em'}}>Canal / Fuente</div>
                <div style={{fontWeight:500}}>{window.ssLabelFuente(cliente.fuente)}</div>
              </div>
              <div>
                <div className="muted" style={{fontSize:11, marginBottom:3, textTransform:'uppercase', letterSpacing:'0.03em'}}>Zona delivery</div>
                <div style={{fontWeight:500}}>{cliente.zona_delivery || '—'}</div>
              </div>
              {cliente.observaciones && (
                <div style={{gridColumn:'1/-1', paddingTop:10, borderTop:'1px solid var(--border)'}}>
                  <div className="muted" style={{fontSize:11, marginBottom:3, textTransform:'uppercase', letterSpacing:'0.03em'}}>Observaciones</div>
                  <div style={{fontWeight:500, lineHeight:1.5}}>{cliente.observaciones}</div>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="card-title">Datos de contacto</h3></div>
            <div className="card-body" style={{display:'flex', flexDirection:'column', gap:14, fontSize:13}}>
              {cliente.contacto && <div><div className="muted" style={{fontSize:11, marginBottom:3, textTransform:'uppercase', letterSpacing:'0.03em'}}>Persona de contacto</div><div style={{fontWeight:500}}>{cliente.contacto}</div></div>}
              {cliente.telefono && <div><div className="muted" style={{fontSize:11, marginBottom:3, textTransform:'uppercase', letterSpacing:'0.03em'}}>Teléfono</div><div style={{fontWeight:500, fontFamily:'monospace'}}>{cliente.telefono}</div></div>}
              {cliente.email && <div><div className="muted" style={{fontSize:11, marginBottom:3, textTransform:'uppercase', letterSpacing:'0.03em'}}>Email</div><div style={{fontWeight:500, wordBreak:'break-all'}}>{cliente.email}</div></div>}
              {(cliente.dir_factura || cliente.direccion) && <div><div className="muted" style={{fontSize:11, marginBottom:3, textTransform:'uppercase', letterSpacing:'0.03em'}}>Dir. facturación</div><div style={{fontWeight:500, lineHeight:1.5}}>{cliente.dir_factura || cliente.direccion}</div></div>}
              {cliente.dir_entrega && cliente.dir_entrega !== (cliente.dir_factura || cliente.direccion) && <div><div className="muted" style={{fontSize:11, marginBottom:3, textTransform:'uppercase', letterSpacing:'0.03em'}}>Dir. entrega</div><div style={{fontWeight:500, lineHeight:1.5}}>{cliente.dir_entrega}</div></div>}
              {!cliente.contacto && !cliente.telefono && !cliente.email && !cliente.dir_factura && !cliente.direccion && (
                <div className="muted" style={{textAlign:'center', padding:'20px 0'}}>Sin datos de contacto registrados</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── PAGOS ── */}
      {tab === 'pagos' && (
        <div className="mt-4">
          {pagosHistorial.length === 0 ? (
            <div className="card" style={{padding:48, textAlign:'center'}}>
              <div style={{fontSize:32, marginBottom:8}}>💳</div>
              <div style={{fontWeight:600, marginBottom:4}}>Sin pagos registrados</div>
              <div className="small muted">Los pagos que reciba este cliente aparecerán aquí con todo el detalle.</div>
            </div>
          ) : (
            <>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10, padding:'10px 0'}}>
                <div className="small muted">
                  Mostrando <strong style={{color:'var(--text)'}}>{pagosHistorial.length}</strong> pago{pagosHistorial.length!==1?'s':''} · Total cobrado:&nbsp;
                  <strong style={{color:'var(--success)'}}>{fmt.usd(totalCobradoUSD)}</strong>
                </div>
                <div className="small muted">Clic en una fila para ver detalle completo</div>
              </div>
              <div className="tbl-wrap">
                <div className="tbl-scroll">
                  <table className="tbl tbl-hover">
                    <thead>
                      <tr>
                        <th>Recibo</th><th>Fecha</th><th>Factura</th><th>Método</th><th>Banco</th><th>Referencia</th><th className="num">Monto recibido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagosHistorial.map(p => (
                        <tr key={p.id} onClick={() => setSelPago(p)} style={{cursor:'pointer'}}>
                          <td className="mono-cell" style={{fontSize:11}}>{p.id}</td>
                          <td className="muted">{fmt.date(p.fecha)}</td>
                          <td className="mono-cell" style={{fontSize:11}}>{p._factura || '—'}</td>
                          <td>
                            <span className="chip" style={{background:(metodoColor[p.metodo]||'var(--brand)')+'18', color:metodoColor[p.metodo]||'var(--brand)', fontSize:11}}>
                              {p.metodo}
                            </span>
                          </td>
                          <td className="small">{p.banco || '—'}</td>
                          <td className="mono-cell" style={{fontSize:11}}>{p.referencia || p.ref || '—'}</td>
                          <td className="num">
                            <div className="strong-num" style={{color:'var(--success)'}}>{fmt.usd(p.monto_usd ?? p.monto)}</div>
                            {p.moneda === 'VES' && p.monto > 0 && (
                              <div className="muted" style={{fontSize:10, marginTop:2}}>
                                {fmt.ves(p.monto)} · tasa {p.tasa_usada}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{background:'var(--bg-sunken)'}}>
                        <td colSpan={6} style={{fontWeight:600, fontSize:12, padding:'10px 12px', textAlign:'right', color:'var(--text-muted)'}}>Total cobrado</td>
                        <td className="num strong-num" style={{color:'var(--success)', padding:'10px 12px', fontSize:14}}>{fmt.usd(totalCobradoUSD)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── DOCUMENTOS ── */}
      {tab === 'documentos' && (
        <div className="mt-4">
          {compras.length === 0 ? (
            <div className="card" style={{padding:48, textAlign:'center'}}>
              <div style={{fontSize:32, marginBottom:8}}>📄</div>
              <div style={{fontWeight:600, marginBottom:4}}>Sin documentos registrados</div>
              <div className="small muted">Las cotizaciones, órdenes y facturas aparecerán aquí.</div>
            </div>
          ) : (
            <>
              {/* Resumen rápido por estado */}
              <div style={{display:'flex', gap:8, flexWrap:'wrap', marginBottom:10, padding:'10px 0'}}>
                {Object.entries(docsPorEstado).map(([estado, count]) => (
                  <div key={estado} style={{display:'flex', alignItems:'center', gap:6, padding:'4px 10px', background:'var(--bg-elev)', borderRadius:8, fontSize:12}}>
                    <StatusChip estado={estado}/>
                    <strong>{count}</strong>
                  </div>
                ))}
                <div className="ml-auto small muted" style={{alignSelf:'center'}}>Clic para abrir el documento</div>
              </div>
              <div className="tbl-wrap">
                <div className="tbl-scroll">
                  <table className="tbl tbl-hover">
                    <thead><tr><th>Doc.</th><th>Fecha</th><th>Estado</th><th>Items</th><th className="num">Total</th></tr></thead>
                    <tbody>
                      {compras.map(d => (
                        <tr key={d.id} onClick={() => openDoc(d)} style={{cursor:'pointer'}}>
                          <td className="mono-cell">{d.id}</td>
                          <td className="muted">{fmt.date(d.fecha)}</td>
                          <td><StatusChip estado={d.estado}/></td>
                          <td className="small muted">{Array.isArray(d.lines) && d.lines.length ? `${d.lines.length} item${d.lines.length!==1?'s':''}` : (typeof d.items === 'number' && d.items > 0 ? `${d.items} item${d.items!==1?'s':''}` : '—')}</td>
                          <td className="num strong-num">{fmt.usd(d.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── CxC ACTIVAS ── */}
      {tab === 'deudas' && (
        <div className="mt-4">
          {deudas.length === 0 ? (
            <div className="card" style={{padding:48, textAlign:'center'}}>
              <div style={{fontSize:32, marginBottom:8}}>✅</div>
              <div style={{fontWeight:600, marginBottom:4}}>Sin cuentas por cobrar</div>
              <div className="small muted">Este cliente no tiene facturas pendientes.</div>
            </div>
          ) : (
            <>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10, padding:'10px 0'}}>
                <div className="small muted">
                  <strong style={{color:'var(--text)'}}>{deudas.length}</strong> factura{deudas.length!==1?'s':''} ·
                  Pendiente: <strong style={{color:'var(--warn)'}}>{fmt.usd(deudas.reduce((s,d)=>s+(d.monto-d.pagado),0))}</strong>
                  {totalVencido > 0 && <> · Vencido: <strong style={{color:'var(--danger)'}}>{fmt.usd(totalVencido)}</strong></>}
                </div>
                <div className="small muted">Clic para ver pagos y cobrar</div>
              </div>
              <div className="tbl-wrap">
                <div className="tbl-scroll">
                  <table className="tbl tbl-hover">
                    <thead>
                      <tr><th>Factura</th><th>Modalidad</th><th>Emisión</th><th>Vence</th><th className="num">Total</th><th className="num">Pagado</th><th className="num">Saldo</th></tr>
                    </thead>
                    <tbody>
                      {deudas.map(d => (
                        <tr key={d.id} onClick={() => setSelDeuda({ doc: d, ent: cliente })} style={{cursor:'pointer'}}>
                          <td className="mono-cell">{d.factura}</td>
                          <td><span className="chip" style={{fontSize:10}}>{d.modalidad_pago || 'divisas'}</span></td>
                          <td className="muted">{fmt.date(d.fecha || d.vence)}</td>
                          <td>
                            <div>{fmt.date(d.vence)}</div>
                            {d.dias > 0 && <span className="chip red" style={{fontSize:10}}>+{d.dias}d vencida</span>}
                            {d.dias < 0 && <span className="small muted">en {Math.abs(d.dias)}d</span>}
                          </td>
                          <td className="num">{fmt.usd(d.monto)}</td>
                          <td className="num" style={{color:'var(--success)'}}>{fmt.usd(d.pagado)}</td>
                          <td className="num strong-num" style={{color: d.monto > d.pagado ? 'var(--warn)' : 'var(--success)'}}>{fmt.usd(d.monto - d.pagado)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{background:'var(--bg-sunken)'}}>
                        <td colSpan={4} style={{fontWeight:600, fontSize:12, padding:'10px 12px', textAlign:'right', color:'var(--text-muted)'}}>Total</td>
                        <td className="num" style={{fontWeight:600, padding:'10px 12px'}}>{fmt.usd(deudas.reduce((s,d)=>s+d.monto,0))}</td>
                        <td className="num" style={{fontWeight:600, padding:'10px 12px', color:'var(--success)'}}>{fmt.usd(deudas.reduce((s,d)=>s+d.pagado,0))}</td>
                        <td className="num strong-num" style={{padding:'10px 12px', color:'var(--warn)', fontSize:14}}>{fmt.usd(deudas.reduce((s,d)=>s+(d.monto-d.pagado),0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── VUELTOS ── */}
      {tab === 'vueltos' && (
        <div className="mt-4">
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
            <div className="small muted">Devolución de excedentes cuando el cliente paga de más. Se procesan a tasa de vuelto Bs. {SSData.tasa?.vuelto || SSData.tasa?.paralelo}/USD.</div>
            <button className="btn primary sm" onClick={() => setShowNuevoVuelto(true)}><Icon name="plus" size={13}/>Registrar vuelto</button>
          </div>
          {vueltos.length === 0 ? (
            <div className="card" style={{padding:48, textAlign:'center'}}>
              <div style={{fontSize:32, marginBottom:8}}>↩️</div>
              <div style={{fontWeight:600, marginBottom:4}}>Sin vueltos registrados</div>
              <div className="small muted">No hay sobrepagos pendientes de devolución para este cliente. Usá "Registrar vuelto" para crear uno manualmente.</div>
            </div>
          ) : (
            <>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10, padding:'10px 0'}}>
                <div className="small muted">
                  <strong style={{color:'var(--text)'}}>{vueltos.length}</strong> vuelto{vueltos.length!==1?'s':''} ·
                  Pendiente: <strong style={{color:'var(--warn)'}}>{fmt.usd(totalVueltos)}</strong>
                </div>
                <div className="small muted">Pagado a tasa Bs. {SSData.tasa?.vuelto || SSData.tasa?.paralelo}/USD</div>
              </div>
              <div className="tbl-wrap">
                <div className="tbl-scroll">
                  <table className="tbl">
                    <thead>
                      <tr><th>ID</th><th>Fecha</th><th>Concepto</th><th>Estado</th><th className="num">Monto</th><th className="num">Pagado</th><th className="num">Saldo</th><th></th></tr>
                    </thead>
                    <tbody>
                      {vueltos.map(v => {
                        const saldo = v.monto - (v.pagado || 0);
                        return (
                          <tr key={v.id}>
                            <td className="mono-cell">{v.id}</td>
                            <td className="muted">{fmt.date(v.vence)}</td>
                            <td className="small">{v.concepto || '—'}</td>
                            <td>{saldo > 0.001 ? <span className="chip amber">Pendiente</span> : <span className="chip green">Procesado</span>}</td>
                            <td className="num">{fmt.usd(v.monto)}</td>
                            <td className="num" style={{color:'var(--success)'}}>{fmt.usd(v.pagado || 0)}</td>
                            <td className="num strong-num" style={{color: saldo > 0.001 ? 'var(--warn)' : 'var(--success)'}}>{fmt.usd(saldo)}</td>
                            <td>
                              {saldo > 0.001 && (
                                <button className="btn ghost sm" style={{color:'var(--brand)'}} onClick={() => setPagandoVuelto(v)}>
                                  <Icon name="check" size={12}/>Procesar
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {showPayment && <RegisterPaymentModal cliente={cliente} deudas={deudasPendientes} onClose={() => setShowPayment(false)}/>}
      {showActivity && <ActivityLogModal modulo="clientes" entidadId={cliente.id} entidadLabel={cliente.nombre} onClose={() => setShowActivity(false)}/>}
      {pagandoVuelto && (
        <RegisterPaymentModal
          cliente={cliente}
          tipo="pagar"
          deudas={[pagandoVuelto]}
          onClose={() => setPagandoVuelto(null)}
        />
      )}
      {showNuevoVuelto && (
        <NuevoVueltoModal cliente={cliente} onClose={async (created) => { setShowNuevoVuelto(false); if (created) await window.refrescarFase2?.(); }} />
      )}
      {editing && <NewClientModal cliente={cliente} onClose={() => { setEditing(false); const fresh = SSData.clientes.find(c => c.id === cliente.id); if (fresh) setCliente(fresh); }} />}
      {selDeuda && (
        <AccountDetailModal
          sel={selDeuda} esCobrar={true}
          entities={SSData.clientes} entKey="cliente"
          allRows={SSData.cuentasCobrar}
          onClose={() => setSelDeuda(null)}
          onPay={() => { setSelDeuda(null); setShowPayment(true); }}
        />
      )}
      {selPago && <PaymentDetailModal pago={selPago} cliente={cliente} onClose={() => setSelPago(null)}/>}

      {/* Habilitar la ficha en la otra empresa. Se explica QUÉ se comparte y QUÉ no: la duda que
          motivó el pedido fue exactamente esa ("que todo siga separado"), y una confirmación que
          no lo dice deja al usuario aceptando algo que no puede verificar. */}
      {habilitando && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setHabilitando(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{width: 520}}>
            <div className="modal-header">
              <div style={{width:40, height:40, borderRadius:10, background:'var(--brand-soft)', color:'var(--brand)', display:'grid', placeItems:'center'}}>
                <Icon name="external" size={20}/>
              </div>
              <div style={{flex:1}}>
                <h3 className="modal-title">Habilitar en {habilitando.nombre}</h3>
                <div className="small muted">{cliente.nombre} · {cliente.rif || 'sin RIF'}</div>
              </div>
              <button className="icon-btn" onClick={() => setHabilitando(null)}><Icon name="x" size={16}/></button>
            </div>
            <div className="modal-body" style={{display:'flex', flexDirection:'column', gap:12}}>
              <div className="small">
                Es <strong>el mismo cliente</strong>, disponible también en {habilitando.nombre}. No se
                crea una ficha nueva: así no queda el mismo RIF cargado dos veces ni se parte su
                historial.
              </div>
              <div className="card" style={{padding:12, background:'var(--bg-sunken)'}}>
                <div className="small" style={{fontWeight:600, marginBottom:6}}>Sigue separado por empresa</div>
                <div className="small muted" style={{lineHeight:1.6}}>
                  Documentos · Cuentas por cobrar y por pagar · Pagos y anticipos · Contactos ·
                  Almacenes e inventario · Historial de actividad.
                  <br/>Habilitar la ficha no mueve ni un movimiento de una empresa a la otra.
                </div>
              </div>
              <div className="card" style={{padding:12, background:'var(--warn-soft,#fef3c7)', border:'1px solid var(--warn,#f59e0b)'}}>
                <div className="small" style={{fontWeight:600, marginBottom:6}}>Queda compartido</div>
                <div className="small" style={{lineHeight:1.6}}>
                  Nombre, RIF, teléfono, email, dirección, condiciones comerciales y límite de
                  crédito. <strong>Editarlos en una empresa los cambia en las dos</strong>, porque es
                  un solo cliente.
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn ghost" onClick={() => setHabilitando(null)} disabled={habilitandoBusy}>Cancelar</button>
              <button className="btn primary" onClick={confirmarHabilitar} disabled={habilitandoBusy}>
                <Icon name="check" size={14}/>{habilitandoBusy ? 'Habilitando…' : 'Habilitar en ' + habilitando.nombre}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal selección de tipo de reporte */}
      {showReporteModal && (
        <div className="modal-overlay" onClick={() => setShowReporteModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{width: 480}}>
            <div className="modal-header">
              <div style={{width:40, height:40, borderRadius:10, background:'var(--brand-soft)', color:'var(--brand)', display:'grid', placeItems:'center'}}>
                <Icon name="download" size={20}/>
              </div>
              <div style={{flex:1}}>
                <h3 className="modal-title">Descargar reporte</h3>
                <div className="small muted">{cliente.nombre} — elige el contenido del PDF</div>
              </div>
              <button className="icon-btn" onClick={() => setShowReporteModal(false)}><Icon name="x" size={16}/></button>
            </div>
            <div className="modal-body" style={{display:'flex', flexDirection:'column', gap:10}}>
              <button
                style={{display:'flex', alignItems:'flex-start', gap:14, padding:'16px 18px', border:'1.5px solid var(--border)', borderRadius:10, background:'var(--bg-card)', cursor:'pointer', textAlign:'left', width:'100%'}}
                onClick={() => { setShowReporteModal(false); generarReportePDF('historial'); }}
              >
                <div style={{width:38, height:38, borderRadius:9, background:'var(--brand-soft)', color:'var(--brand)', display:'grid', placeItems:'center', flexShrink:0}}>
                  <Icon name="receipt" size={18}/>
                </div>
                <div>
                  <div style={{fontWeight:700, fontSize:14, marginBottom:3}}>Historial de compras</div>
                  <div className="small muted">Incluye CxC activas, historial de compras y registro de pagos</div>
                </div>
              </button>
              <button
                style={{display:'flex', alignItems:'flex-start', gap:14, padding:'16px 18px', border:'1.5px solid var(--border)', borderRadius:10, background:'var(--bg-card)', cursor:'pointer', textAlign:'left', width:'100%'}}
                onClick={() => { setShowReporteModal(false); generarReportePDF('cxc'); }}
              >
                <div style={{width:38, height:38, borderRadius:9, background:'var(--success-soft,#dcfce7)', color:'var(--success)', display:'grid', placeItems:'center', flexShrink:0}}>
                  <Icon name="dollar" size={18}/>
                </div>
                <div>
                  <div style={{fontWeight:700, fontSize:14, marginBottom:3}}>Solo CxC activas</div>
                  <div className="small muted">Solo las facturas pendientes de cobro · {deudasPendientes.length} factura{deudasPendientes.length !== 1 ? 's' : ''} · {fmt.usd(deudaActiva)}</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PaymentDetailModal({ pago, cliente, onClose }) {
  const metodoColor = { transferencia:'var(--brand)', efectivo:'var(--success)', zelle:'var(--accent)', cheque:'var(--warn)', pago_movil:'var(--accent)', binance:'#f0b90b' };
  const color = metodoColor[pago.metodo] || 'var(--brand)';
  const esVES = pago.moneda === 'VES';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{width: 520}}>
        <div className="modal-header">
          <div style={{width:44, height:44, borderRadius:10, background:color+'20', color:color, display:'grid', placeItems:'center'}}>
            <Icon name="dollar" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">Recibo {pago.id}</h3>
            <div className="small">{cliente.nombre} · Factura {pago._factura || '—'}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        <div className="modal-body">
          {/* Hero del monto */}
          <div className="card" style={{padding:18, textAlign:'center', background:'var(--bg-sunken)', marginBottom:14}}>
            <div className="small muted" style={{textTransform:'uppercase', letterSpacing:'0.05em', fontSize:10.5, marginBottom:6}}>Monto recibido</div>
            <div style={{fontSize:30, fontWeight:700, color:'var(--success)', fontVariantNumeric:'tabular-nums'}}>
              {fmt.usd(pago.monto_usd ?? pago.monto)}
            </div>
            {esVES && pago.monto > 0 && (
              <div style={{display:'flex', justifyContent:'center', gap:14, marginTop:10, padding:'10px 0 0', borderTop:'1px solid var(--border)', fontSize:13}}>
                <div>
                  <div className="small muted" style={{fontSize:10.5}}>Recibido en Bs</div>
                  <div style={{fontWeight:600, fontFamily:'monospace'}}>{fmt.ves(pago.monto)}</div>
                </div>
                <div>
                  <div className="small muted" style={{fontSize:10.5}}>Tasa aplicada</div>
                  <div style={{fontWeight:600, fontFamily:'monospace', color:'var(--accent)'}}>{pago.tasa_usada}</div>
                </div>
              </div>
            )}
          </div>

          {/* Detalles */}
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 16px', fontSize:13}}>
            <div>
              <div className="muted" style={{fontSize:11, marginBottom:2}}>Fecha</div>
              <div style={{fontWeight:500}}>{fmt.date(pago.fecha)}</div>
            </div>
            <div>
              <div className="muted" style={{fontSize:11, marginBottom:2}}>Método</div>
              <div><span className="chip" style={{background:color+'18', color:color, fontSize:11, textTransform:'capitalize'}}>{pago.metodo}</span></div>
            </div>
            <div>
              <div className="muted" style={{fontSize:11, marginBottom:2}}>Moneda</div>
              <div style={{fontWeight:500}}>{esVES ? 'Bolívares (VES)' : 'Dólares (USD)'}</div>
            </div>
            <div>
              <div className="muted" style={{fontSize:11, marginBottom:2}}>Modalidad CxC</div>
              <div style={{fontWeight:500, textTransform:'capitalize'}}>{pago.modalidad_pago || '—'}</div>
            </div>
            <div>
              <div className="muted" style={{fontSize:11, marginBottom:2}}>Banco / cuenta</div>
              <div style={{fontWeight:500}}>{pago.banco || '—'}</div>
            </div>
            <div>
              <div className="muted" style={{fontSize:11, marginBottom:2}}>Referencia</div>
              <div style={{fontWeight:500, fontFamily:'monospace'}}>{pago.referencia || pago.ref || '—'}</div>
            </div>
            {pago.notas && (
              <div style={{gridColumn:'1/-1'}}>
                <div className="muted" style={{fontSize:11, marginBottom:2}}>Notas</div>
                <div style={{fontWeight:500, padding:'8px 10px', background:'var(--bg-sunken)', borderRadius:6}}>{pago.notas}</div>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
          <button className="btn secondary"><Icon name="download" size={14}/>Descargar recibo</button>
        </div>
      </div>
    </div>
  );
}

function ProveedorFormFields({ form, upd }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
      <div style={{ gridColumn:'1/-1' }}>
        <label className="form-label">Nombre / Razón social *</label>
        <input className="input" style={{ width:'100%', textTransform:'uppercase' }} placeholder="EJ: DISTRIBUIDORA ABC"
          value={form.nombre} onChange={e => upd('nombre', e.target.value)} autoFocus/>
      </div>
      <div>
        <label className="form-label">RIF</label>
        <input className="input" style={{ width:'100%' }} placeholder="J-12345678-9"
          value={form.rif} onChange={e => upd('rif', e.target.value)}/>
      </div>
      <div>
        <label className="form-label">País</label>
        <input className="input" style={{ width:'100%' }} placeholder="Venezuela"
          value={form.pais} onChange={e => upd('pais', e.target.value)}/>
      </div>
      <div style={{ gridColumn:'1/-1' }}>
        <label className="form-label">Dirección</label>
        <input className="input" style={{ width:'100%' }} placeholder="Av. Principal, Local 5, Caracas"
          value={form.direccion} onChange={e => upd('direccion', e.target.value)}/>
      </div>
      <div>
        <label className="form-label">Teléfono 1</label>
        <input className="input" style={{ width:'100%' }} placeholder="+58 212 555 0000"
          value={form.telefono1} onChange={e => upd('telefono1', e.target.value)}/>
      </div>
      <div>
        <label className="form-label">Teléfono 2</label>
        <input className="input" style={{ width:'100%' }} placeholder="+58 414 555 0000"
          value={form.telefono2} onChange={e => upd('telefono2', e.target.value)}/>
      </div>
      <div>
        <label className="form-label">Contacto principal</label>
        <input className="input" style={{ width:'100%' }} placeholder="Nombre del contacto"
          value={form.contacto} onChange={e => upd('contacto', e.target.value)}/>
      </div>
      <div>
        <label className="form-label">Email</label>
        <input className="input" type="email" style={{ width:'100%' }} placeholder="proveedor@ejemplo.com"
          value={form.email} onChange={e => upd('email', e.target.value)}/>
      </div>
      <div>
        <label className="form-label">Días de pago</label>
        <input className="input" type="number" min="0" style={{ width:'100%' }} placeholder="0"
          value={form.diasPago} onChange={e => upd('diasPago', e.target.value)}/>
      </div>
      <div>
        <label className="form-label">Categorías (separadas por coma)</label>
        <input className="input" style={{ width:'100%' }} placeholder="Ej: Electrónica, Cables"
          value={form.categorias} onChange={e => upd('categorias', e.target.value)}/>
      </div>
    </div>
  );
}

function NewProveedorModal({ onClose, onSave, initialNombre = '' }) {
  const [form, setForm] = useState({
    nombre: initialNombre, rif: '', pais: 'Venezuela', contacto: '',
    email: '', diasPago: '0', categorias: '',
    direccion: '', telefono1: '', telefono2: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  function upd(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    const upperNorm = s => (s || '').toUpperCase().replace(/\s+/g, ' ').trim();
    const nombreUP  = upperNorm(form.nombre);
    const contactoUP = upperNorm(form.contacto);
    if (!nombreUP) { setError('El nombre es obligatorio.'); return; }
    // Contacto OBLIGATORIO: todo proveedor debe tener un contacto asignado.
    if (!contactoUP) { setError('El contacto es obligatorio: todo proveedor debe tener un contacto asignado.'); return; }
    // El contacto del proveedor se inserta en la misma tabla `contactos` que los de clientes —
    // el email/teléfono debe ser único en TODO el sistema, no solo entre proveedores.
    const telV = form.telefono1.trim();
    const dupTel = telV ? window.ssFindDupContactoTelefono(telV, null) : null;
    if (dupTel) { setError(`Ese teléfono ya lo usa el contacto: ${dupTel.nombre}`); return; }
    const emailV = form.email.trim();
    const dupEmail = emailV ? window.ssFindDupContactoEmail(emailV, null) : null;
    if (dupEmail) { setError(`Ese email ya lo usa el contacto: ${dupEmail.nombre}`); return; }
    setSaving(true); setError('');
    const id        = 'prov-' + Date.now();
    const diasPago  = parseInt(form.diasPago) || 0;
    const categorias = form.categorias ? form.categorias.split(',').map(c => c.trim()).filter(Boolean) : [];

    const dbPayload = {
      id,
      nombre:    nombreUP,
      rif:       form.rif.trim(),
      pais:      form.pais.trim() || 'Venezuela',
      contacto:  contactoUP,
      email:     form.email.trim(),
      dias_pago: diasPago,
      categorias,
      direccion: form.direccion.trim(),
      telefono1: form.telefono1.trim(),
      telefono2: form.telefono2.trim(),
      deuda:     0,
      activo:    true,
      empresa_id: window.currentEmpresa,
      creado_por: window.__ssCurrentUser?.nombre || null,
    };

    if (window.sb) {
      const { error: dbErr } = await window.sb.from('proveedores').insert([dbPayload]);
      if (dbErr) { setError(dbErr.message); setSaving(false); return; }
      // Contacto principal obligatorio del proveedor.
      await window.sb.from('contactos').insert({
        id: 'CT-P-' + id, proveedor_id: id, nombre: contactoUP, cargo: 'Contacto principal',
        telefono: form.telefono1.trim() || null, email: form.email.trim() || null,
        activo: true, empresa_id: window.currentEmpresa,
      });
    }

    const newProv = { ...dbPayload, diasPago };
    SSData.proveedores = [newProv, ...SSData.proveedores];
    window.logActivity?.({
      modulo: 'proveedores', accion: 'crear',
      entidad_id: id, entidad_label: newProv.nombre,
      detalles: { rif: newProv.rif, pais: newProv.pais },
    });
    setSaving(false);
    onSave(newProv);
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 540, maxWidth: '96vw' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Nuevo proveedor</span>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body" style={{ display:'flex', flexDirection:'column', gap:13 }}>
          <ProveedorFormFields form={form} upd={upd}/>
          {error && <div style={{ color:'var(--danger)', fontSize:12, padding:'6px 10px', background:'#fef2f2', borderRadius:6 }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!form.nombre.trim() || saving} onClick={handleSave}>
            <Icon name="plus" size={14}/>{saving ? 'Guardando…' : 'Crear proveedor'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProveedorDetailPage({ proveedor: provInit, onBack }) {
  const [tab,    setTab]    = useState('info');
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState('');
  const [showActivity, setShowActivity] = useState(false);
  const [form, setForm] = useState({
    nombre:    provInit.nombre    || '',
    rif:       provInit.rif       || '',
    pais:      provInit.pais      || 'Venezuela',
    contacto:  provInit.contacto  || '',
    email:     provInit.email     || '',
    diasPago:  String(provInit.diasPago != null ? provInit.diasPago : (provInit.dias_pago != null ? provInit.dias_pago : 0)),
    categorias: Array.isArray(provInit.categorias) ? provInit.categorias.join(', ') : (provInit.categorias || ''),
    direccion: provInit.direccion || '',
    telefono1: provInit.telefono1 || '',
    telefono2: provInit.telefono2 || '',
  });

  function upd(k, v) { setForm(f => ({ ...f, [k]: v })); setSaved(false); }

  // Computed data
  const ocs      = (SSData.ordenesCompra || []).filter(o => (o.proveedor_id || o.proveedor) === provInit.id);
  const cxps     = (SSData.cuentasPagar  || []).filter(c => c.proveedor_id === provInit.id && c.tipo !== 'vuelto' && c.tipo !== 'comision');
  const deudaCxP = cxps.reduce((s, c) => s + ((c.monto || 0) - (c.pagado || 0)), 0);
  const totalOCsMonto  = ocs.reduce((s, o) => s + (o.monto ?? o.monto_total ?? 0), 0);
  const ocsEnTransito  = ocs.filter(o => o.estado !== 'recibida' && o.estado !== 'cancelada').length;
  const diasPagoNum    = parseInt(form.diasPago) || 0;
  const cxpsPendientes = cxps.filter(c => c.monto > (c.pagado || 0));


  async function handleSave() {
    if (!form.nombre.trim()) { setError('El nombre es obligatorio.'); return; }
    setSaving(true); setError('');
    const diasPago   = parseInt(form.diasPago) || 0;
    const categorias = form.categorias ? form.categorias.split(',').map(c => c.trim()).filter(Boolean) : [];
    const upperNorm = s => (s || '').toUpperCase().replace(/\s+/g, ' ').trim();
    const dbPayload  = {
      nombre:    upperNorm(form.nombre),
      rif:       form.rif.trim(),
      pais:      form.pais.trim() || 'Venezuela',
      contacto:  upperNorm(form.contacto),
      email:     form.email.trim(),
      dias_pago: diasPago,
      categorias,
      direccion: form.direccion.trim(),
      telefono1: form.telefono1.trim(),
      telefono2: form.telefono2.trim(),
    };
    if (window.sb) {
      const { error: dbErr } = await window.sb.from('proveedores').update(dbPayload).eq('id', provInit.id);
      if (dbErr) { setError(dbErr.message); setSaving(false); return; }
    }
    const idx = SSData.proveedores.findIndex(p => p.id === provInit.id);
    if (idx !== -1) SSData.proveedores[idx] = { ...SSData.proveedores[idx], ...dbPayload, diasPago };
    window.logActivity?.({
      modulo: 'proveedores', accion: 'editar',
      entidad_id: provInit.id, entidad_label: form.nombre.trim(),
      detalles: { rif: form.rif, pais: form.pais },
    });
    setSaving(false); setSaved(true);
  }

  return (
    <div className="page">
      {/* Breadcrumb */}
      <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:14, fontSize:12.5}}>
        <button className="btn ghost sm" onClick={onBack} style={{gap:4, padding:'4px 8px'}}>
          <Icon name="chevronL" size={13}/>Proveedores
        </button>
        <span className="muted">/</span>
        <span className="muted">{form.nombre}</span>
      </div>

      {/* Hero */}
      <div className="card" style={{padding:18, marginBottom:16, display:'flex', alignItems:'flex-start', gap:16, flexWrap:'wrap'}}>
        <div style={{width:56, height:56, borderRadius:14, background:'linear-gradient(135deg, var(--brand) 0%, var(--accent) 100%)', color:'#fff', display:'grid', placeItems:'center', fontWeight:700, fontSize:20, flexShrink:0, boxShadow:'0 4px 12px var(--brand)40'}}>
          {form.nombre.slice(0,2).toUpperCase()}
        </div>
        <div style={{flex:1, minWidth:200}}>
          <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:4}}>
            <h1 style={{fontSize:22, fontWeight:700, margin:0, lineHeight:1.2}}>{form.nombre}</h1>
            {deudaCxP > 0 && <span className="chip red" style={{fontSize:11}}>⚠ {fmt.usd(deudaCxP)} por pagar</span>}
          </div>
          <div style={{display:'flex', gap:14, flexWrap:'wrap', fontSize:12.5, color:'var(--text-muted)'}}>
            {provInit.rif && <span><strong style={{fontFamily:'monospace', color:'var(--text)'}}>{provInit.rif}</strong></span>}
            {form.pais && form.pais !== 'Venezuela' && <span>🌍 {form.pais}</span>}
            {form.contacto && <span>👤 {form.contacto}</span>}
            {form.telefono1 && <span style={{fontFamily:'monospace'}}>📞 {form.telefono1}</span>}
            {form.email && <span>✉ {form.email}</span>}
          </div>
        </div>
        <div style={{display:'flex', gap:6, flexShrink:0, flexWrap:'wrap'}}>
          {window.canUser?.('editar', 'suppliers') !== false && (
          <button className="btn secondary sm" onClick={() => setTab('info')}><Icon name="edit" size={13}/>Editar</button>
          )}
          <button className="btn ghost sm" onClick={() => setShowActivity(true)} title="Ver actividad de este proveedor"><Icon name="clock" size={13}/>Actividad</button>
        </div>
      </div>

      {showActivity && <ActivityLogModal modulo="proveedores" entidadId={provInit.id} entidadLabel={form.nombre} onClose={() => setShowActivity(false)}/>}

      {/* Stats */}
      <div className="stat-grid hide-sm" style={{marginBottom:16}}>
        <div className="stat" style={{borderTop:`3px solid ${deudaCxP > 0 ? 'var(--warn)' : 'var(--success)'}`}}>
          <div className="stat-label">Deuda CxP</div>
          <div className="stat-val" style={{color: deudaCxP > 0 ? 'var(--warn)' : 'var(--success)'}}>{fmt.usd(deudaCxP)}</div>
          <div className="small mt-1 muted">{cxpsPendientes.length} cuenta{cxpsPendientes.length !== 1 ? 's' : ''} pendiente{cxpsPendientes.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="stat" style={{borderTop:'3px solid var(--brand)'}}>
          <div className="stat-label">Total OCs generadas</div>
          <div className="stat-val">{fmt.usd(totalOCsMonto)}</div>
          <div className="small mt-1 muted">{ocs.length} orden{ocs.length !== 1 ? 'es' : ''} de compra</div>
        </div>
        <div className="stat" style={{borderTop:`3px solid ${ocsEnTransito > 0 ? 'var(--accent)' : 'var(--border)'}`}}>
          <div className="stat-label">OCs en tránsito</div>
          <div className="stat-val" style={{color: ocsEnTransito > 0 ? 'var(--accent)' : 'var(--text-muted)'}}>{ocsEnTransito}</div>
          <div className="small mt-1 muted">{ocs.filter(o => o.estado === 'recibida').length} recibida{ocs.filter(o => o.estado === 'recibida').length !== 1 ? 's' : ''}</div>
        </div>
        <div className="stat" style={{borderTop:'3px solid var(--accent)'}}>
          <div className="stat-label">Días de pago</div>
          <div style={{fontSize:16, fontWeight:600, marginTop:4}}>{diasPagoNum > 0 ? `${diasPagoNum} días` : 'Pago inmediato'}</div>
          <div className="small mt-1 muted">{Array.isArray(provInit.categorias) && provInit.categorias.length ? provInit.categorias.join(', ') : (provInit.categorias || '—')}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:'flex', gap:2, borderBottom:'1px solid var(--border)', marginBottom:0, position:'sticky', top:0, background:'var(--bg)', zIndex:10}}>
        {[
          { id:'info', label:'Información',        count:null      },
          { id:'ocs',  label:'Órdenes de compra',  count:ocs.length },
        ].map(t => (
          <button key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding:'10px 16px', background:'transparent', border:'none',
              borderBottom: tab===t.id ? '2px solid var(--brand)' : '2px solid transparent',
              color: tab===t.id ? 'var(--brand)' : 'var(--text-muted)',
              fontWeight: tab===t.id ? 600 : 500, fontSize:13, cursor:'pointer',
              display:'flex', alignItems:'center', gap:6, marginBottom:-1, transition:'all 0.15s',
            }}>
            {t.label}
            {t.count > 0 && (
              <span style={{background: tab===t.id ? 'var(--brand)' : 'var(--bg-sunken)', color: tab===t.id ? '#fff' : 'var(--text-muted)', borderRadius:8, padding:'1px 7px', fontSize:11, fontWeight:600, minWidth:20, textAlign:'center'}}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab: Información */}
      {tab === 'info' && (
        <div className="grid-2 mt-4" style={{gap:16, alignItems:'start'}}>
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Datos del proveedor</h3>
              <div style={{display:'flex', gap:8, alignItems:'center'}}>
                {saved && <span style={{color:'var(--success)', fontSize:13, fontWeight:500}}>✓ Guardado</span>}
                <button className="btn primary sm" disabled={!form.nombre.trim() || saving} onClick={handleSave}>
                  <Icon name="check" size={13}/>{saving ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>
            </div>
            <div className="card-body">
              <ProveedorFormFields form={form} upd={upd}/>
              {error && <div style={{color:'var(--danger)', fontSize:12, padding:'6px 10px', background:'#fef2f2', borderRadius:6, marginTop:12}}>{error}</div>}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="card-title">Resumen de actividad</h3></div>
            <div className="card-body" style={{display:'flex', flexDirection:'column', gap:14, fontSize:13}}>
              <div>
                <div className="muted" style={{fontSize:11, marginBottom:3, textTransform:'uppercase', letterSpacing:'0.03em'}}>Deuda pendiente CxP</div>
                <div style={{fontWeight:600, color: deudaCxP > 0 ? 'var(--warn)' : 'var(--success)'}}>{fmt.usd(deudaCxP)}</div>
              </div>
              <div>
                <div className="muted" style={{fontSize:11, marginBottom:3, textTransform:'uppercase', letterSpacing:'0.03em'}}>Total en órdenes de compra</div>
                <div style={{fontWeight:600}}>{fmt.usd(totalOCsMonto)}</div>
              </div>
              <div>
                <div className="muted" style={{fontSize:11, marginBottom:3, textTransform:'uppercase', letterSpacing:'0.03em'}}>Órdenes generadas</div>
                <div style={{fontWeight:600}}>{ocs.length}</div>
              </div>
              <div>
                <div className="muted" style={{fontSize:11, marginBottom:3, textTransform:'uppercase', letterSpacing:'0.03em'}}>Términos de pago</div>
                <div style={{fontWeight:600}}>{diasPagoNum > 0 ? `Crédito ${diasPagoNum}d` : 'Pago inmediato'}</div>
              </div>
              {(form.direccion || form.telefono2) && (
                <div style={{paddingTop:10, borderTop:'1px solid var(--border)'}}>
                  {form.direccion && (
                    <div style={{marginBottom:10}}>
                      <div className="muted" style={{fontSize:11, marginBottom:3, textTransform:'uppercase', letterSpacing:'0.03em'}}>Dirección</div>
                      <div style={{fontWeight:500, lineHeight:1.5}}>{form.direccion}</div>
                    </div>
                  )}
                  {form.telefono2 && (
                    <div>
                      <div className="muted" style={{fontSize:11, marginBottom:3, textTransform:'uppercase', letterSpacing:'0.03em'}}>Teléfono 2</div>
                      <div style={{fontWeight:500, fontFamily:'monospace'}}>{form.telefono2}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Órdenes de compra */}
      {tab === 'ocs' && (
        <div className="mt-4">
          {ocs.length === 0 ? (
            <div className="card" style={{padding:48, textAlign:'center'}}>
              <div style={{fontSize:32, marginBottom:8}}>📦</div>
              <div style={{fontWeight:600, marginBottom:4}}>Sin órdenes de compra</div>
              <div className="small muted">Las órdenes generadas a este proveedor aparecerán aquí.</div>
            </div>
          ) : (
            <div className="tbl-wrap">
              <div className="tbl-scroll">
                <table className="tbl tbl-hover">
                  <thead>
                    <tr>
                      <th>OC</th><th>Fecha</th><th>ETA</th><th>Estado</th><th className="num">Pedido</th><th className="num">Ajustado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ocs.slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).map(o => {
                      // Pedido = suma de ítems (cant×precio) o el monto canónico como fallback.
                      // Ajustado = o.monto (= monto_total, que recepción actualiza al valor real).
                      const pedido = Array.isArray(o.items) && o.items.length
                        ? o.items.reduce((s, it) => s + (parseFloat(it.cantidad_pedida)||0) * (parseFloat(it.precio_unitario)||0), 0)
                        : (o.monto ?? o.monto_total ?? 0);
                      const ajustado = o.monto ?? o.monto_total ?? 0;
                      return (
                      <tr key={o.id}>
                        <td className="mono-cell" style={{fontSize:11}}>{o.id}</td>
                        <td className="muted">{fmt.date(o.fecha)}</td>
                        <td className="muted">{o.eta ? fmt.date(o.eta) : '—'}</td>
                        <td><StatusChip estado={o.estado}/></td>
                        <td className="num">{fmt.usd(pedido)}</td>
                        <td className="num" style={{fontWeight:600}}>{fmt.usd(ajustado)}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{background:'var(--bg-sunken)'}}>
                      <td colSpan={5} style={{fontWeight:600, fontSize:12, padding:'10px 12px', textAlign:'right', color:'var(--text-muted)'}}>Total ajustado</td>
                      <td className="num strong-num" style={{padding:'10px 12px', fontSize:14}}>{fmt.usd(totalOCsMonto)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewOCModal({ onClose, onSave, initialData }) {
  const today = window.localDateStr();
  const [form, setForm] = useState({
    proveedor_id: initialData?.proveedor_id || SSData.proveedores[0]?.id || '',
    fecha: today,
    eta: '',
    fecha_vencimiento: '',
    // doc_proveedor NO se hereda de initialData: cada OC tiene su propio nº de
    // documento del proveedor; al duplicar una OC ese número no debe copiarse.
    doc_proveedor: '',
    notas: initialData?.notas || '',
  });
  const [lineas, setLineas] = useState(() => {
    if (initialData?.items?.length > 0) {
      return initialData.items.map((it, i) => ({
        _k: Date.now() + i,
        sku: it.sku || '',
        descripcion: it.descripcion || '',
        cantidad: String(it.cantidad_pedida || 1),
        precio: String(it.precio_unitario || ''),
      }));
    }
    return [{ _k: Date.now(), sku: '', descripcion: '', cantidad: '1', precio: '' }];
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function updForm(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function updLinea(idx, k, v) {
    setLineas(prev => prev.map((l, i) => i === idx ? { ...l, [k]: v } : l));
  }
  function addLinea() {
    setLineas(prev => [...prev, { _k: Date.now(), sku: '', descripcion: '', cantidad: '1', precio: '' }]);
  }
  function removeLinea(idx) {
    setLineas(prev => prev.filter((_, i) => i !== idx));
  }

  // SKU options: catálogo + último precio de este proveedor
  const skuOptions = useMemo(() => {
    const map = {};
    SSData.productos.forEach(p => {
      if (p.sku) map[p.sku] = { descripcion: p.nombre || p.descripcion || '', lastPrecio: '' };
    });
    if (form.proveedor_id) {
      const provOCs = (SSData.ordenesCompra || []).filter(o =>
        (o.proveedor_id || o.proveedor) === form.proveedor_id
      );
      provOCs.forEach(oc => {
        (oc.items || []).forEach(it => {
          if (!it.sku) return;
          if (!map[it.sku]) map[it.sku] = { descripcion: it.descripcion || '', lastPrecio: '' };
          if (!map[it.sku].lastPrecio && parseFloat(it.precio_unitario) > 0)
            map[it.sku].lastPrecio = String(it.precio_unitario);
        });
      });
    }
    return map;
  }, [form.proveedor_id]);

  function selectSku(idx, sku) {
    const opt = skuOptions[sku];
    if (!opt) { updLinea(idx, 'sku', sku); return; }
    setLineas(prev => prev.map((l, i) => i !== idx ? l : {
      ...l,
      sku,
      descripcion: opt.descripcion || l.descripcion,
      precio: opt.lastPrecio || l.precio,
    }));
  }

  const montoTotal = lineas.reduce((s, l) => {
    const qty = parseFloat(l.cantidad) || 0;
    const prc = parseFloat(l.precio) || 0;
    return s + qty * prc;
  }, 0);

  async function handleSave() {
    if (!form.proveedor_id || !form.fecha) { setError('Proveedor y fecha son obligatorios.'); return; }
    const validLineas = lineas.filter(l => l.descripcion.trim() && (parseFloat(l.cantidad) || 0) > 0);
    if (validLineas.length === 0) { setError('Agregá al menos una línea con descripción y cantidad.'); return; }
    setSaving(true); setError('');

    const year  = form.fecha.slice(0, 4);
    // Fix bug #14: el seq NO debe derivarse de `length+1` (se reusa al borrar OCs,
    // no namespacea por año y colisiona entre empresas). Lo derivamos del máximo
    // correlativo existente del MISMO año (`OC-{year}-NNNN`) y, ante colisión de PK
    // (23505, p.ej. otra empresa con el mismo conteo), reintentamos bumpeando el seq.
    const prefix  = `OC-${year}-`;
    const maxSeqAnio = (SSData.ordenesCompra || []).reduce((mx, o) => {
      if (typeof o.id !== 'string' || !o.id.startsWith(prefix)) return mx;
      const n = parseInt(o.id.slice(prefix.length), 10);
      return (isNaN(n) || n <= mx) ? mx : n;
    }, 0);

    let ocId, ocErr;
    for (let nextSeq = maxSeqAnio + 1, intentos = 0; intentos < 20; nextSeq++, intentos++) {
      ocId = `${prefix}${String(nextSeq).padStart(4, '0')}`;
      const ocPayload = {
        id:           ocId,
        empresa_id:   window.currentEmpresa || 'demo1',
        proveedor_id: form.proveedor_id,
        fecha:        form.fecha,
        eta:          form.eta || null,
        fecha_vencimiento: form.fecha_vencimiento || null,
        estado:       'borrador',
        notas:        form.notas.trim() || null,
        monto_total:  montoTotal,
        doc_proveedor: form.doc_proveedor.trim() || null,
        creado_por:   window.__ssCurrentUser?.nombre || null,
      };
      const res = await window.sb.from('ordenes_compra').insert([ocPayload]);
      ocErr = res.error;
      if (!ocErr) break;                 // insert OK
      if (ocErr.code !== '23505') break; // error real (no colisión de PK) → no reintentar
      // colisión de PK: el id ya existe → probar el siguiente correlativo
    }
    if (ocErr) { setError(ocErr.message); setSaving(false); return; }

    const itemPayloads = validLineas.map((l, i) => ({
      id:              `${ocId}-IT-${i + 1}`,
      oc_id:           ocId,
      sku:             l.sku.trim() || null,
      descripcion:     l.descripcion.trim(),
      cantidad_pedida: parseFloat(l.cantidad) || 1,
      precio_unitario: parseFloat(l.precio)   || 0,
    }));

    const { error: itemsErr } = await window.sb.from('ordenes_compra_items').insert(itemPayloads);
    if (itemsErr) { setError(itemsErr.message); setSaving(false); return; }

    const newOC = {
      // ocPayload quedó block-scoped dentro del loop de reintento (fix bug #14);
      // reconstruimos el shape canónico explícitamente con el ocId finalmente usado.
      id:           ocId,
      empresa_id:   window.currentEmpresa || 'demo1',
      proveedor_id: form.proveedor_id,
      fecha:        form.fecha,
      eta:          form.eta || null,
      fecha_vencimiento: form.fecha_vencimiento || null,
      estado:       'borrador',
      notas:        form.notas.trim() || null,
      monto_total:  montoTotal,
      doc_proveedor: form.doc_proveedor.trim() || null,
      proveedor: form.proveedor_id,
      monto: montoTotal,
      items: itemPayloads,
    };
    SSData.ordenesCompra = [newOC, ...(SSData.ordenesCompra || [])];
    window.logActivity?.({
      modulo: 'ordenes_compra', accion: 'crear',
      entidad_id: ocId, entidad_label: ocId,
      detalles: { proveedor: SSData.proveedores.find(p => p.id === form.proveedor_id)?.nombre, monto: montoTotal },
    });
    setSaving(false);
    onSave(newOC);
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 680, maxWidth: '96vw' }}>
        <div className="modal-header">
          <span className="modal-title">Nueva Orden de Compra</span>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div>
            <label className="form-label">Proveedor *</label>
            <select className="select" style={{ width: '100%' }} value={form.proveedor_id} onChange={e => updForm('proveedor_id', e.target.value)}>
              <option value="">— Seleccionar —</option>
              {SSData.proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label className="form-label">Fecha de emisión *</label>
              <input className="input" type="date" style={{ width: '100%' }} value={form.fecha} onChange={e => updForm('fecha', e.target.value)}/>
            </div>
            <div>
              <label className="form-label">ETA (entrega estimada)</label>
              <input className="input" type="date" style={{ width: '100%' }} value={form.eta} onChange={e => updForm('eta', e.target.value)}/>
            </div>
            <div>
              <label className="form-label">Vencimiento del pago</label>
              <input className="input" type="date" style={{ width: '100%' }} value={form.fecha_vencimiento} onChange={e => updForm('fecha_vencimiento', e.target.value)}/>
              <div className="small muted" style={{ marginTop: 3, fontSize: 10.5 }}>
                Opcional. Si se deja vacío, la fecha de vencimiento de la CxP se calcula sola con los días de pago del proveedor al recibir.
              </div>
            </div>
          </div>

          <div>
            <label className="form-label">N° de documento del proveedor</label>
            <input className="input" style={{ width: '100%' }}
              placeholder="N° de factura/documento que emite el proveedor (opcional)"
              value={form.doc_proveedor} onChange={e => updForm('doc_proveedor', e.target.value)}/>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label className="form-label" style={{ margin: 0 }}>Ítems de la orden</label>
              <button className="btn ghost sm" type="button" onClick={addLinea}><Icon name="plus" size={12}/>Agregar</button>
            </div>
            <datalist id="oc-sku-datalist">
              {Object.entries(skuOptions).map(([sku, opt]) => (
                <option key={sku} value={sku}>{opt.descripcion}</option>
              ))}
            </datalist>
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-sunken)' }}>
                    <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'left', width: 90 }}>SKU</th>
                    <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'left' }}>Descripción *</th>
                    <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right', width: 70 }}>Cant.</th>
                    <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right', width: 100 }}>Precio USD</th>
                    <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right', width: 90 }}>Subtotal</th>
                    <th style={{ width: 32 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l, idx) => {
                    const sub = (parseFloat(l.cantidad) || 0) * (parseFloat(l.precio) || 0);
                    return (
                      <tr key={l._k} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '4px 6px' }}>
                          <input className="input" style={{ padding: '4px 6px', fontSize: 12 }}
                            placeholder="SKU" list="oc-sku-datalist" value={l.sku}
                            onChange={e => selectSku(idx, e.target.value)}/>
                        </td>
                        <td style={{ padding: '4px 6px' }}>
                          <input className="input" style={{ padding: '4px 6px', fontSize: 12, width: '100%' }}
                            placeholder="Descripción" value={l.descripcion} onChange={e => updLinea(idx, 'descripcion', e.target.value)}/>
                        </td>
                        <td style={{ padding: '4px 6px' }}>
                          <input className="input" type="number" min="0" step="0.01" style={{ padding: '4px 6px', fontSize: 12, textAlign: 'right', width: '100%' }}
                            value={l.cantidad} onChange={e => updLinea(idx, 'cantidad', e.target.value)}/>
                        </td>
                        <td style={{ padding: '4px 6px' }}>
                          <input className="input" type="number" min="0" step="0.01" style={{ padding: '4px 6px', fontSize: 12, textAlign: 'right', width: '100%' }}
                            placeholder="0.00" value={l.precio} onChange={e => updLinea(idx, 'precio', e.target.value)}/>
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12.5 }}>
                          {sub > 0 ? fmt.usd(sub) : '—'}
                        </td>
                        <td style={{ padding: '4px 4px' }}>
                          {lineas.length > 1 && (
                            <button className="icon-btn" type="button" style={{ color: 'var(--danger)' }} onClick={() => removeLinea(idx)}>
                              <Icon name="x" size={13}/>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-sunken)' }}>
                    <td colSpan={4} style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right', fontSize: 12.5 }}>TOTAL</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{fmt.usd(montoTotal)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div>
            <label className="form-label">Notas</label>
            <textarea className="input" rows={2} style={{ width: '100%', resize: 'vertical' }}
              placeholder="Observaciones opcionales…"
              value={form.notas} onChange={e => updForm('notas', e.target.value)}/>
          </div>

          {error && <div style={{ color: 'var(--danger)', fontSize: 13, background: 'var(--danger-soft, #fee)', padding: '8px 12px', borderRadius: 6 }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!form.proveedor_id || !form.fecha || saving} onClick={handleSave}>
            <Icon name="plus" size={14}/>{saving ? 'Guardando…' : 'Crear OC'}
          </button>
        </div>
      </div>
    </div>
  );
}

function OCDetailModal({ oc, onClose, onUpdate, onDuplicate }) {
  const [showRecepcion, setShowRecepcion] = useState(false);
  const [showDevolucion, setShowDevolucion] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [recepciones, setRecepciones] = useState([]);
  const [devoluciones, setDevoluciones] = useState([]);
  const [loadingRec, setLoadingRec]   = useState(true);
  const [notasEdit,   setNotasEdit]   = useState(oc.notas || '');
  const [savingNotas, setSavingNotas] = useState(false);
  const [notasSaved,  setNotasSaved]  = useState(false);
  const [docProvEdit,   setDocProvEdit]   = useState(oc.doc_proveedor || '');
  const [savingDocProv, setSavingDocProv] = useState(false);
  const [docProvSaved,  setDocProvSaved]  = useState(false);
  const prov = SSData.proveedores.find(p => p.id === oc.proveedor_id || p.id === oc.proveedor);

  async function saveDocProv() {
    setSavingDocProv(true);
    const val = docProvEdit.trim() || null;
    const { error } = await window.sb.from('ordenes_compra').update({ doc_proveedor: val }).eq('id', oc.id);
    if (error) { alert(error.message); setSavingDocProv(false); return; }
    oc.doc_proveedor = val;
    const idx = (SSData.ordenesCompra || []).findIndex(o => o.id === oc.id);
    if (idx !== -1) SSData.ordenesCompra[idx].doc_proveedor = val;
    window.logActivity?.({ modulo: 'ordenes_compra', accion: 'editar', entidad_id: oc.id, entidad_label: oc.id, detalles: { campo: 'doc_proveedor', valor: val } });
    setSavingDocProv(false); setDocProvSaved(true);
    setTimeout(() => setDocProvSaved(false), 2500);
  }

  async function saveNotas() {
    setSavingNotas(true);
    const { error } = await window.sb.from('ordenes_compra').update({ notas: notasEdit.trim() }).eq('id', oc.id);
    if (error) { alert(error.message); setSavingNotas(false); return; }
    oc.notas = notasEdit.trim();
    const idx = (SSData.ordenesCompra || []).findIndex(o => o.id === oc.id);
    if (idx !== -1) SSData.ordenesCompra[idx].notas = notasEdit.trim();
    window.logActivity?.({ modulo: 'ordenes_compra', accion: 'editar', entidad_id: oc.id, entidad_label: oc.id, detalles: { campo: 'notas' } });
    setSavingNotas(false); setNotasSaved(true);
    setTimeout(() => setNotasSaved(false), 2500);
  }

  function generarPDFOC() {
    const emp = window.getEmpresaConfig ? window.getEmpresaConfig() : {};
    const fd  = s => s ? new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—';
    const usd = v => '$ ' + Number(v || 0).toLocaleString('es-VE', { minimumFractionDigits:2, maximumFractionDigits:2 });
    const fGen = new Date().toLocaleString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'America/Caracas' });

    const itemsArr = Array.isArray(oc.items) ? oc.items : [];
    const montoPed = itemsArr.length > 0
      ? itemsArr.reduce((s, it) => s + (parseFloat(it.cantidad_pedida) || 0) * (parseFloat(it.precio_unitario) || 0), 0)
      : (parseFloat(oc.monto) || parseFloat(oc.monto_total) || 0);

    const rowsHTML = itemsArr.length === 0
      ? `<tr><td colspan="6" class="empty">Orden sin detalle de ítems — monto total: <strong>${usd(montoPed)}</strong></td></tr>`
      : itemsArr.map((it, i) => `<tr>
          <td class="center">${i + 1}</td>
          <td class="mono">${it.sku || '—'}</td>
          <td>${it.descripcion || ''}</td>
          <td class="num">${it.cantidad_pedida || 0}</td>
          <td class="num mono">${usd(it.precio_unitario)}</td>
          <td class="num mono bold">${usd((it.cantidad_pedida || 0) * (it.precio_unitario || 0))}</td>
        </tr>`).join('');

    const notasTexto = notasEdit.trim();
    const docProvTexto = docProvEdit.trim();

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>OC — ${oc.id}</title>
<style>
@page { size: A4; margin: 14mm 14mm 24mm; }
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#111;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;min-height:252mm;display:flex;flex-direction:column;}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:10px;border-bottom:3px solid #1a56db;margin-bottom:14px;}
.co-name{font-size:15px;font-weight:800;color:#1a56db;}
.co-sub{font-size:9px;color:#6b7280;margin-top:2px;}
.doc-title{font-size:20px;font-weight:800;text-align:right;color:#1a56db;letter-spacing:.02em;}
.doc-id{font-size:13px;font-weight:700;text-align:right;font-family:monospace;color:#111;margin-top:2px;}
.doc-sub{font-size:9px;color:#6b7280;text-align:right;margin-top:2px;}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;}
.meta-box{border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;}
.meta-box .lbl{font-size:8.5px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:3px;}
.meta-box .val{font-weight:600;font-size:12px;}
.meta-box .val2{font-size:10.5px;color:#6b7280;margin-top:1px;}
.status{display:inline-block;padding:2px 9px;border-radius:10px;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;background:#dbeafe;color:#1e40af;}
table{width:100%;border-collapse:collapse;margin-bottom:12px;}
th{background:#1a56db;color:#fff;padding:6px 8px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:left;}
th.num,td.num{text-align:right;}
th.center,td.center{text-align:center;}
td{padding:5px 8px;border-bottom:1px solid #f3f4f6;font-size:10.5px;vertical-align:middle;}
td.mono{font-family:monospace;font-size:10px;}
td.bold{font-weight:700;}
tfoot td{background:#f3f4f6;font-weight:700;padding:7px 8px;border-top:2px solid #d1d5db;font-size:12px;}
tr:nth-child(even) td{background:#f9fafb;}
.notes-box{border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;margin-bottom:16px;min-height:40px;}
.notes-lbl{font-size:8.5px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:5px;}
.notes-text{font-size:11px;line-height:1.6;color:#374151;}
.sig-section{margin-top:auto;padding-top:32px;margin-bottom:8px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;}
.sig-box{text-align:center;padding-top:4px;}
.sig-box .sig-label{font-size:8.5px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:40px;}
.sig-box .sig-line{border-top:1.5px solid #374151;padding-top:5px;font-size:9px;color:#374151;font-weight:600;}
.sig-box .sig-sub{font-size:8.5px;color:#9ca3af;margin-top:2px;}
.sig-main .sig-label{font-weight:700;color:#1a56db;}
.sig-main .sig-line{border-color:#1a56db;color:#1a56db;}
.ftr{position:fixed;bottom:0;left:0;right:0;background:#fff;padding-top:7px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:8px;color:#9ca3af;}
.empty{text-align:center;color:#9ca3af;padding:14px;font-size:11px;}
td.empty{background:#fff;}
</style>
</head>
<body>

<div class="hdr">
  <div>
    <div class="co-name">${emp.razon_social || 'Distribuidora Demo 1, C.A.'}</div>
    <div class="co-sub">RIF: ${emp.rif || 'J-40123456-7'} &nbsp;·&nbsp; ${emp.telefono || ''}</div>
    <div class="co-sub">${emp.dir_fiscal || ''}</div>
  </div>
  <div>
    <div class="doc-title">ORDEN DE COMPRA</div>
    <div class="doc-id">${oc.id}</div>
    <div class="doc-sub">Generado: ${fGen}</div>
  </div>
</div>

<div class="meta">
  <div class="meta-box">
    <div class="lbl">Proveedor</div>
    <div class="val">${prov?.nombre || oc.proveedor_id || '—'}</div>
    ${prov?.rif ? `<div class="val2">RIF: ${prov.rif}</div>` : ''}
    ${prov?.contacto ? `<div class="val2">Contacto: ${prov.contacto}</div>` : ''}
    ${prov?.telefono1 ? `<div class="val2">Tel: ${prov.telefono1}</div>` : ''}
    ${docProvTexto ? `<div class="val2">Doc. Proveedor: ${docProvTexto}</div>` : ''}
  </div>
  <div class="meta-box">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div>
        <div class="lbl">Fecha de emisión</div>
        <div class="val">${fd(oc.fecha)}</div>
        <div style="margin-top:8px;">
          <div class="lbl">ETA estimado</div>
          <div class="val">${oc.eta ? fd(oc.eta) : '—'}</div>
        </div>
      </div>
      <div>
        <span class="status">${oc.estado || 'borrador'}</span>
      </div>
    </div>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th class="center" style="width:30px">#</th>
      <th style="width:80px">SKU</th>
      <th>Descripción</th>
      <th class="num" style="width:55px">Cant.</th>
      <th class="num" style="width:80px">P. Unitario</th>
      <th class="num" style="width:85px">Subtotal</th>
    </tr>
  </thead>
  <tbody>
    ${rowsHTML}
  </tbody>
  ${itemsArr.length > 0 ? `<tfoot>
    <tr>
      <td colspan="5" style="text-align:right;color:#6b7280;font-size:10px;letter-spacing:.04em;">TOTAL PEDIDO</td>
      <td class="num">${usd(montoPed)}</td>
    </tr>
  </tfoot>` : ''}
</table>

${notasTexto ? `<div class="notes-box">
  <div class="notes-lbl">Notas / Observaciones</div>
  <div class="notes-text">${notasTexto.replace(/\n/g, '<br/>')}</div>
</div>` : ''}

<div class="sig-section">
  <div class="sig-box">
    <div class="sig-label">Elaborado por</div>
    <div class="sig-line">___________________________</div>
    <div class="sig-sub">Nombre y firma</div>
  </div>
  <div class="sig-box">
    <div class="sig-label">Autorizado por</div>
    <div class="sig-line">___________________________</div>
    <div class="sig-sub">Nombre y firma</div>
  </div>
  <div class="sig-box sig-main">
    <div class="sig-label">Almacenista — Conforme recibido</div>
    <div class="sig-line">___________________________</div>
    <div class="sig-sub">Nombre, firma y fecha de recepción</div>
  </div>
</div>

<div class="ftr">
  <span>${emp.razon_social || 'Distribuidora Demo 1, C.A.'} &nbsp;·&nbsp; RIF ${emp.rif || 'J-40123456-7'}</span>
  <span>OC: ${oc.id} &nbsp;·&nbsp; Generado ${fGen}</span>
</div>

<script>window.onload = function(){ window.print(); }</script>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { alert('Permitir ventanas emergentes para imprimir.'); return; }
    win.document.write(html);
    win.document.close();
  }

  function reloadRecDev() {
    setLoadingRec(true);
    Promise.all([
      window.sb.from('recepciones_oc').select('*').eq('oc_id', oc.id).order('created_at', { ascending: false }),
      window.sb.from('devoluciones_oc').select('*').eq('oc_id', oc.id).order('created_at', { ascending: false }),
    ]).then(([r, d]) => {
      setRecepciones(r.data || []);
      setDevoluciones(d.data || []);
      setLoadingRec(false);
    });
  }
  useEffect(() => { reloadRecDev(); }, [oc.id]);

  const estadoColor = {
    borrador: 'var(--text-muted)',
    confirmada: 'var(--accent)',
    'tránsito': '#f59e0b',
    recibida: 'var(--success)',
    cancelada: 'var(--danger)',
    'parcialmente recibida': '#8b5cf6',
  };

  async function cambiarEstado(nuevoEstado) {
    if (!confirm(`¿Cambiar estado a "${nuevoEstado}"?`)) return;
    const { error } = await window.sb.from('ordenes_compra').update({ estado: nuevoEstado }).eq('id', oc.id);
    if (error) { alert(error.message); return; }
    oc.estado = nuevoEstado;
    const idx = (SSData.ordenesCompra || []).findIndex(o => o.id === oc.id);
    if (idx !== -1) SSData.ordenesCompra[idx].estado = nuevoEstado;
    window.logActivity?.({ modulo: 'ordenes_compra', accion: 'editar', entidad_id: oc.id, entidad_label: oc.id, detalles: { estado: nuevoEstado } });
    onUpdate?.();
    onClose();
  }

  const items = Array.isArray(oc.items) ? oc.items : [];
  // Monto pedido ORIGINAL (no se sobreescribe al recibir). Si hay ítems → suma; si no, usa oc.monto.
  const montoPedido = items.length > 0
    ? items.reduce((s, it) => s + (parseFloat(it.cantidad_pedida) || 0) * (parseFloat(it.precio_unitario) || 0), 0)
    : (parseFloat(oc.monto) || parseFloat(oc.monto_total) || 0);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 680, maxWidth: '96vw' }}>
        <div className="modal-header" style={{ alignItems: 'flex-start' }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 17, letterSpacing: '0.04em', color: 'var(--brand)', lineHeight: 1.2 }}>{oc.id}</span>
              <span className="chip" style={{ background: (estadoColor[oc.estado] || 'var(--text-muted)') + '20', color: estadoColor[oc.estado] || 'var(--text-muted)', fontSize: 11, textTransform: 'capitalize' }}>{oc.estado}</span>
            </span>
            <span className="muted" style={{ display: 'block', fontSize: 12, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {prov?.nombre || '—'}
              {prov?.rif && <span style={{ marginLeft: 6, opacity: 0.75 }}>· {prov.rif}</span>}
              {oc.fecha && <span style={{ marginLeft: 6, opacity: 0.75 }}>· {fmt.date(oc.fecha)}</span>}
            </span>
          </span>
          <button className="icon-btn" onClick={onClose} style={{ marginTop: 2, flexShrink: 0 }}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, fontSize: 13 }}>
            <div>
              <div className="muted" style={{ fontSize: 11, marginBottom: 3 }}>PROVEEDOR</div>
              <div style={{ fontWeight: 600 }}>{prov?.nombre || oc.proveedor_id || '—'}</div>
              {prov?.rif && <div className="muted" style={{ fontSize: 11 }}>{prov.rif}</div>}
            </div>
            <div>
              <div className="muted" style={{ fontSize: 11, marginBottom: 3 }}>EMITIDA</div>
              <div>{fmt.date(oc.fecha)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 11, marginBottom: 3 }}>ETA</div>
              <div>{oc.eta ? fmt.date(oc.eta) : '—'}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 11, marginBottom: 3 }}>VENCIMIENTO DEL PAGO</div>
              <div>{oc.fecha_vencimiento ? fmt.date(oc.fecha_vencimiento) : <span className="muted">Según días de pago del proveedor</span>}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 11, marginBottom: 3 }}>CREADA POR</div>
              <CreadoPorCell nombre={oc.creado_por} size={22}/>
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>N° DOC. PROVEEDOR</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {docProvSaved && <span style={{ color: 'var(--success)', fontSize: 12, fontWeight: 500 }}>✓ Guardado</span>}
                <button className="btn ghost sm" disabled={savingDocProv || docProvEdit.trim() === (oc.doc_proveedor || '')} onClick={saveDocProv} style={{ padding: '3px 10px' }}>
                  {savingDocProv ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
            <input
              className="input"
              value={docProvEdit}
              onChange={e => { setDocProvEdit(e.target.value); setDocProvSaved(false); }}
              placeholder="N° de factura/documento que emite el proveedor"
              style={{ width: '100%', fontSize: 13, fontFamily: 'monospace' }}
            />
          </div>

          <div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 6, fontWeight: 600 }}>ÍTEMS PEDIDOS</div>
            {items.length === 0 ? (
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ padding: '16px 18px', background: 'var(--bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {oc.items_count > 0 ? `${oc.items_count} ítem${oc.items_count !== 1 ? 's' : ''} en esta orden` : 'Sin detalle de ítems'}
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                      Esta OC fue creada antes del sistema de ítems detallados. Solo está disponible el monto total.
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>MONTO TOTAL</div>
                    <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 20 }}>{fmt.usd(oc.monto)}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-sunken)' }}>
                      <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600 }}>SKU</th>
                      <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600 }}>Descripción</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>Cant.</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>P. Unit.</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={it.id || i} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '5px 10px', fontFamily: 'monospace', fontSize: 11.5 }}>{it.sku || '—'}</td>
                        <td style={{ padding: '5px 10px' }}>{it.descripcion}</td>
                        <td style={{ padding: '5px 10px', textAlign: 'right' }}>{it.cantidad_pedida}</td>
                        <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{((it.precio_unitario || 0) === 0 && (it.subtotal || 0) === 0) ? '—' : fmt.usd(it.precio_unitario)}</td>
                        <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{((it.precio_unitario || 0) === 0 && (it.subtotal || 0) === 0) ? '—' : fmt.usd((it.cantidad_pedida || 0) * (it.precio_unitario || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-sunken)' }}>
                      <td colSpan={4} style={{ padding: '6px 10px', fontWeight: 700, textAlign: 'right' }}>TOTAL PEDIDO</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{fmt.usd(montoPedido)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>NOTAS</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {notasSaved && <span style={{ color: 'var(--success)', fontSize: 12, fontWeight: 500 }}>✓ Guardado</span>}
                <button className="btn ghost sm" disabled={savingNotas || notasEdit === (oc.notas || '')} onClick={saveNotas} style={{ padding: '3px 10px' }}>
                  {savingNotas ? 'Guardando…' : 'Guardar notas'}
                </button>
              </div>
            </div>
            <textarea
              className="input"
              value={notasEdit}
              onChange={e => { setNotasEdit(e.target.value); setNotasSaved(false); }}
              placeholder="Agregar notas u observaciones para esta orden de compra…"
              rows={3}
              style={{ width: '100%', resize: 'vertical', fontSize: 13, fontFamily: 'inherit' }}
            />
          </div>

          <div>
            <div className="muted" style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>HISTORIAL DE RECEPCIONES</div>
            {loadingRec ? (
              <div className="muted" style={{ fontSize: 13, textAlign: 'center', padding: '12px 0' }}>Cargando…</div>
            ) : recepciones.length === 0 ? (
              <div className="muted" style={{ fontSize: 13, textAlign: 'center', padding: '12px 0' }}>Sin recepciones registradas</div>
            ) : recepciones.map(rec => {
              const montoOrig = montoPedido;
              // Recepción migrada de Odoo: solo cabecera (monto_ajustado=0, items=[]).
              // Se asume recibido = pedido para no mostrar un engañoso "$0 recibido".
              const esMigradaSinDetalle = (!parseFloat(rec.monto_ajustado)) && (!Array.isArray(rec.items) || rec.items.length === 0);
              const montoRec  = esMigradaSinDetalle ? montoOrig : (parseFloat(rec.monto_ajustado) || 0);
              const diff      = montoRec - montoOrig;
              const hayDisc   = rec.motivo_discrepancia || (Array.isArray(rec.items) && rec.items.some(i => i.estado !== 'ok' || i.cantidad_recibida < i.cantidad_pedida));
              return (
                <div key={rec.id} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ background: 'var(--bg-sunken)', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{rec.id}</span>
                    <span className="muted" style={{ fontSize: 12 }}>{fmt.date(rec.fecha)}</span>
                    {hayDisc && <span className="chip" style={{ background: '#fef3c7', color: '#92400e', fontSize: 11 }}>⚠ Con discrepancias</span>}
                    <span title="Recibido por" style={{ display: 'flex', alignItems: 'center' }}><CreadoPorCell nombre={rec.creado_por} size={18}/></span>
                    <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>{fmt.usd(montoRec)}</span>
                    <button className="btn ghost sm" style={{ padding: '2px 8px' }} title="Descargar comprobante de esta recepción (PDF)"
                      onClick={() => window.generateRecepcionPDF?.(oc, { modo: 'recibo', rec, prov })}>
                      <Icon name="download" size={12}/>PDF
                    </button>
                  </div>
                  {/* Comparativo */}
                  <div style={{ padding: '10px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, fontSize: 12.5 }}>
                    <div>
                      <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>EMITIDO</div>
                      <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>{fmt.usd(montoOrig)}</div>
                    </div>
                    <div>
                      <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>RECIBIDO</div>
                      <div style={{ fontFamily: 'monospace', fontWeight: 600, color: montoRec < montoOrig ? 'var(--success)' : '' }}>{fmt.usd(montoRec)}</div>
                    </div>
                    <div>
                      <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>DIFERENCIA</div>
                      <div style={{ fontFamily: 'monospace', fontWeight: 600, color: diff < 0 ? 'var(--success)' : diff > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                        {diff === 0 ? '—' : fmt.usd(diff)}
                      </div>
                    </div>
                  </div>
                  {/* Motivo */}
                  {rec.motivo_discrepancia && (
                    <div style={{ padding: '0 12px 10px', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                      <div className="muted" style={{ fontSize: 10, marginBottom: 3, fontWeight: 600 }}>MOTIVO DE DISCREPANCIA</div>
                      <div style={{ fontSize: 12.5, background: '#fffbeb', borderRadius: 6, padding: '6px 10px', color: '#92400e' }}>{rec.motivo_discrepancia}</div>
                    </div>
                  )}
                  {/* Items detalle */}
                  {Array.isArray(rec.items) && rec.items.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px' }}>
                      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ color: 'var(--text-muted)' }}>
                            <th style={{ textAlign: 'left', fontWeight: 600, padding: '3px 0' }}>Ítem</th>
                            <th style={{ textAlign: 'right', fontWeight: 600, padding: '3px 6px' }}>Pedido</th>
                            <th style={{ textAlign: 'right', fontWeight: 600, padding: '3px 6px' }}>Recibido</th>
                            <th style={{ textAlign: 'center', fontWeight: 600, padding: '3px 6px' }}>Estado</th>
                            <th style={{ textAlign: 'right', fontWeight: 600, padding: '3px 0' }}>Subtotal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rec.items.map((it, i) => {
                            const esDisc = it.estado !== 'ok' || it.cantidad_recibida < it.cantidad_pedida;
                            const col = { ok: 'var(--success)', dañado: '#f59e0b', faltante: 'var(--danger)' }[it.estado] || '';
                            return (
                              <tr key={i} style={{ borderTop: '1px solid var(--border)', background: esDisc ? '#fffbeb' : '' }}>
                                <td style={{ padding: '4px 0' }}>{it.descripcion}{it.sku ? <span className="muted" style={{ fontSize: 10, marginLeft: 4 }}>({it.sku})</span> : ''}</td>
                                <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--text-muted)' }}>{it.cantidad_pedida}</td>
                                <td style={{ padding: '4px 6px', textAlign: 'right', fontWeight: esDisc ? 600 : 400, color: esDisc ? '#92400e' : '' }}>{it.cantidad_recibida}</td>
                                <td style={{ padding: '4px 6px', textAlign: 'center', color: col, fontWeight: 600, fontSize: 11 }}>{it.estado?.toUpperCase()}</td>
                                <td style={{ padding: '4px 0', textAlign: 'right', fontFamily: 'monospace' }}>{fmt.usd(it.subtotal_ajustado)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {devoluciones.length > 0 && (
            <div>
              <div className="muted" style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>DEVOLUCIONES AL PROVEEDOR</div>
              {devoluciones.map(dev => (
                <div key={dev.id} style={{ border: '1px solid #fbbf24', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ background: '#fffbeb', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: '#92400e' }}>{dev.id}</span>
                    <span className="muted" style={{ fontSize: 12 }}>{fmt.date(dev.fecha)}</span>
                    <span className="chip" style={{ background: '#fef3c7', color: '#92400e', fontSize: 11 }}>↩ Devuelto al proveedor</span>
                    <span title="Devuelto por" style={{ display: 'flex', alignItems: 'center' }}><CreadoPorCell nombre={dev.creado_por} size={18}/></span>
                    <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: '#92400e' }}>− {fmt.usd(parseFloat(dev.monto) || 0)}</span>
                  </div>
                  {dev.motivo && (
                    <div style={{ padding: '6px 12px', fontSize: 12, borderTop: '1px solid var(--border)' }}>
                      <span className="muted" style={{ fontWeight: 600, fontSize: 10 }}>MOTIVO: </span>{dev.motivo}
                    </div>
                  )}
                  {Array.isArray(dev.items) && dev.items.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px' }}>
                      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                        <tbody>
                          {dev.items.map((it, i) => (
                            <tr key={i} style={{ borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                              <td style={{ padding: '4px 0' }}>{it.descripcion}{it.sku ? <span className="muted" style={{ fontSize: 10, marginLeft: 4 }}>({it.sku})</span> : ''}{it.motivo ? <div className="muted" style={{ fontSize: 10 }}>↳ {it.motivo}</div> : ''}</td>
                              <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--text-muted)' }}>× {it.cantidad}</td>
                              <td style={{ padding: '4px 0', textAlign: 'right', fontFamily: 'monospace' }}>{fmt.usd(it.subtotal)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

        </div>
        <div className="modal-footer" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
          <button className="btn secondary" onClick={() => setShowActivity(true)} title="Ver todo el historial de actividad de esta orden de compra">
            <Icon name="clock" size={14}/>Actividad
          </button>
          <button className="btn secondary" onClick={generarPDFOC} title="Genera PDF para imprimir y firmar">
            <Icon name="download" size={14}/>Imprimir OC
          </button>
          <button className="btn secondary" onClick={() => window.generateRecepcionPDF?.(oc, { modo: 'checklist', prov })}
            title="Descarga la hoja de recepción (en blanco) para que el almacenista verifique lo recibido">
            <Icon name="download" size={14}/>Hoja de recepción
          </button>
          {onDuplicate && (
            <button className="btn secondary" onClick={() => onDuplicate(oc)} title="Duplicar esta OC como nueva borrador">
              <Icon name="doc" size={14}/>Duplicar OC
            </button>
          )}
          {oc.estado === 'borrador' && window.canUser?.('editar','suppliers') !== false && (
            <button className="btn secondary" onClick={() => cambiarEstado('confirmada')}>Confirmar OC</button>
          )}
          {oc.estado === 'confirmada' && window.canUser?.('editar','suppliers') !== false && (
            <button className="btn secondary" onClick={() => cambiarEstado('tránsito')}>Marcar en tránsito</button>
          )}
          {(oc.estado === 'confirmada' || oc.estado === 'tránsito' || oc.estado === 'parcialmente recibida') && window.canUser?.('editar','suppliers') !== false && (
            <button className="btn primary" onClick={() => setShowRecepcion(true)}>
              <Icon name="check" size={14}/>Registrar recepción
            </button>
          )}
          {(oc.estado === 'recibida' || oc.estado === 'parcialmente recibida') && window.canUser?.('editar','suppliers') !== false && (
            <button className="btn secondary" style={{ color: '#92400e', borderColor: '#fbbf24' }} onClick={() => setShowDevolucion(true)} title="Devolver mercancía recibida al proveedor (baja inventario y deuda)">
              <Icon name="arrUp" size={14}/>Devolver al proveedor
            </button>
          )}
          {oc.estado !== 'cancelada' && oc.estado !== 'recibida' && window.canUser?.('editar','suppliers') !== false && (
            <button className="btn ghost" style={{ color: 'var(--danger)', marginLeft: 'auto' }} onClick={() => cambiarEstado('cancelada')}>Cancelar OC</button>
          )}
        </div>
        {showRecepcion && (
          <RecepcionOCModal
            oc={oc}
            onClose={() => setShowRecepcion(false)}
            onDone={() => { setShowRecepcion(false); onUpdate?.(); onClose(); }}
          />
        )}
        {showDevolucion && (
          <DevolucionOCModal
            oc={oc}
            prov={prov}
            onClose={() => setShowDevolucion(false)}
            onDone={() => { setShowDevolucion(false); reloadRecDev(); onUpdate?.(); }}
          />
        )}
        {showActivity && (
          <ActivityLogModal
            modulo="ordenes_compra"
            entidadId={oc.id}
            entidadLabel={`OC ${oc.id}`}
            onClose={() => setShowActivity(false)}
          />
        )}
      </div>
    </div>
  );
}

function RecepcionOCModal({ oc, onClose, onDone }) {
  const items = Array.isArray(oc.items) ? oc.items : [];
  const esLegacy = items.length === 0;

  const [lineas, setLineas] = useState(() =>
    esLegacy
      ? [{ _k: Date.now(), sku: '', descripcion: '', cantidad_pedida: '', cantidad_recibida: '', precio_unitario: '', estado_item: 'ok', notas_item: '' }]
      : items.map(it => ({ ...it, cantidad_recibida: String(it.cantidad_pedida), estado_item: 'ok', notas_item: '' }))
  );
  const [almacenId, setAlmacenId] = useState(SSData.almacenes[0]?.id || '');
  const [fechaRec, setFechaRec]   = useState(window.localDateStr());
  const [notas, setNotas]         = useState('');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  // Seriales por SKU serializado: { [sku]: 'SN001\nSN002\n...' }
  const [seriales, setSeriales]   = useState({});
  // Ficha de los productos de esta OC traída de la BASE, no del catálogo en memoria.
  // `SSData.productos` (~5 MB) se carga async y FUERA del gate inicial: si la recepción
  // se abre antes de que termine, un producto serializado se leía como NO serializado
  // y la exigencia de seriales se saltaba EN SILENCIO — se recibía completo sin S/N.
  // Con esto la condición no depende de que el catálogo esté cargado.
  const [prodInfo, setProdInfo]   = useState(null);   // null = cargando
  useEffect(() => {
    let alive = true;
    const skus = [...new Set(lineas.map(l => l.sku).filter(Boolean))];
    if (skus.length === 0) { setProdInfo({}); return; }
    window.sb.from('productos').select('sku, serializado, garantia_meses, nombre')
      .eq('empresa_id', window.currentEmpresa || 'demo1').in('sku', skus)
      .then(({ data, error: e }) => {
        if (!alive) return;
        if (e || !Array.isArray(data)) { setProdInfo({}); return; }   // se cae al catálogo local
        setProdInfo(Object.fromEntries(data.map(p => [p.sku, p])));
      });
    return () => { alive = false; };
    // Solo al montar: en modo legacy el SKU se tipea y se resuelve con el catálogo local.
  }, []);
  // Recepciones previas de esta OC: cantidad ya recibida por línea (oci_id) y monto
  // ya recibido. Permite acumular y evitar sobre-recepción / estado 'recibida'
  // inalcanzable en envíos múltiples (Bug audit 2026-06-26).
  const [yaRecibido, setYaRecibido]                   = useState({});
  const [montoRecibidoPrevio, setMontoRecibidoPrevio] = useState(0);
  const [loadingPrev, setLoadingPrev]                 = useState(!esLegacy);
  // Si falla la carga de recepciones previas, bloqueamos confirmar: continuar
  // asumiendo "sin previas" rompería la acumulación (sobre-recepción + pérdida de
  // monto previo) justo en el caso que este fix resuelve.
  const [prevError, setPrevError]                     = useState(false);

  React.useEffect(() => {
    if (esLegacy) return;
    let cancel = false;
    window.sb.from('recepciones_oc').select('items, monto_ajustado').eq('oc_id', oc.id)
      .then(({ data, error: qErr }) => {
        if (cancel) return;
        if (qErr) {
          setPrevError(true);
          setError('No se pudieron cargar las recepciones previas de esta OC: ' + qErr.message + '. Cerrá y reintentá antes de confirmar.');
          setLoadingPrev(false);
          return;
        }
        const acc = {};
        let montoPrev = 0;
        (Array.isArray(data) ? data : []).forEach(rec => {
          montoPrev += parseFloat(rec.monto_ajustado) || 0;
          (Array.isArray(rec.items) ? rec.items : []).forEach(it => {
            if (it.estado === 'faltante') return;   // 'faltante' no ingresó stock
            if (!it.oci_id) return;
            acc[it.oci_id] = (acc[it.oci_id] || 0) + (parseFloat(it.cantidad_recibida) || 0);
          });
        });
        setYaRecibido(acc);
        setMontoRecibidoPrevio(montoPrev);
        // Default de cantidad_recibida = PENDIENTE (no la pedida completa).
        setLineas(prev => prev.map(l => ({
          ...l,
          cantidad_recibida: String(Math.max(0, (parseFloat(l.cantidad_pedida) || 0) - (acc[l.id] || 0))),
        })));
        setLoadingPrev(false);
      }, (err) => {
        if (cancel) return;
        setPrevError(true);
        setError('No se pudieron cargar las recepciones previas: ' + (err?.message || 'error de conexión') + '. Cerrá y reintentá.');
        setLoadingPrev(false);
      });
    return () => { cancel = true; };
  }, []);

  // Helper: parsear textarea -> array deduplicado
  function parseSeriales(raw) {
    if (!raw) return [];
    const lines = String(raw).split('\n').map(s => s.trim()).filter(Boolean);
    return Array.from(new Set(lines));
  }
  // Ficha del producto: primero lo traído de la base para esta OC, si no el catálogo
  // local (necesario en modo legacy, donde el SKU se tipea a mano).
  function getProducto(sku) {
    if (!sku) return null;
    if (prodInfo && prodInfo[sku]) return prodInfo[sku];
    return (SSData.productos || []).find(p => p.sku === sku) || null;
  }

  function updLinea(idx, k, v) {
    setLineas(prev => prev.map((l, i) => i === idx ? { ...l, [k]: v } : l));
  }
  function addLinea() {
    setLineas(prev => [...prev, { _k: Date.now(), sku: '', descripcion: '', cantidad_pedida: '', cantidad_recibida: '', precio_unitario: '', estado_item: 'ok', notas_item: '' }]);
  }
  function removeLinea(idx) {
    setLineas(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
  }

  const montoAjustado = lineas.reduce((s, l) => {
    const recibido = parseFloat(l.cantidad_recibida) || 0;
    const precio   = parseFloat(l.precio_unitario)   || 0;
    if (l.estado_item === 'faltante') return s;
    return s + recibido * precio;
  }, 0);

  async function handleConfirmar() {
    setSaving(true); setError('');
    if (lineasSinMotivo.length > 0) {
      setError('Indicá el motivo en cada producto donde se recibe menos de lo esperado (o que llegó dañado/faltante).');
      setSaving(false);
      return;
    }
    // Validación de seriales: para cada línea OK con SKU serializado, los seriales deben coincidir con la cantidad recibida
    const problemas = [];
    const serialesParsed = {}; // { sku: [..] }
    for (const l of lineas) {
      if (l.estado_item !== 'ok') continue;
      if (!l.sku) continue;
      const prod = getProducto(l.sku);
      if (!prod || !prod.serializado) continue;
      const qty = parseFloat(l.cantidad_recibida) || 0;
      if (qty <= 0) continue;
      const parsed = parseSeriales(seriales[l.sku] || '');
      if (parsed.length !== qty) {
        problemas.push(`${l.sku} (${l.descripcion}): ${parsed.length} de ${qty} seriales`);
      }
      serialesParsed[l.sku] = parsed;
    }
    if (problemas.length > 0) {
      setError('Faltan seriales para confirmar la recepción:\n• ' + problemas.join('\n• '));
      setSaving(false);
      return;
    }
    if (!almacenId && Object.keys(serialesParsed).length > 0) {
      setError('Debés seleccionar un almacén destino para registrar los seriales.');
      setSaving(false);
      return;
    }
    // Sobre-recepción: no recibir más de lo PENDIENTE por línea (pedida − ya recibido).
    const sobre = [];
    for (const l of lineas) {
      if (l.estado_item === 'faltante') continue;
      const pedida = parseFloat(l.cantidad_pedida) || 0;
      if (pedida <= 0) continue;
      const pend   = pedida - (yaRecibido[l.id] || 0);
      const recibe = parseFloat(l.cantidad_recibida) || 0;
      if (recibe > pend + 0.001) {
        sobre.push(`${l.sku || l.descripcion}: recibís ${recibe} pero solo quedan ${pend} pendiente(s)`);
      }
    }
    if (sobre.length > 0) {
      setError('No podés recibir más de lo pendiente:\n• ' + sobre.join('\n• '));
      setSaving(false);
      return;
    }
    try {
      const recId = 'REC-' + Date.now();
      const itemsJson = lineas.map(l => ({
        oci_id:            l.id,
        sku:               l.sku || null,
        descripcion:       l.descripcion,
        cantidad_pedida:   parseFloat(l.cantidad_pedida) || 0,
        cantidad_recibida: parseFloat(l.cantidad_recibida) || 0,
        estado:            l.estado_item,
        precio_unitario:   parseFloat(l.precio_unitario) || 0,
        subtotal_ajustado: l.estado_item === 'faltante'
          ? 0
          : (parseFloat(l.cantidad_recibida) || 0) * (parseFloat(l.precio_unitario) || 0),
        notas: l.notas_item || null,
      }));

      // Motivo compuesto a partir de las razones por-producto (para el historial de la OC).
      const motivoCompuesto = lineas.filter(lineaNecesitaMotivo)
        .map(l => `${l.sku || l.descripcion || 'ítem'}: ${(l.notas_item || '').trim()}`).join(' | ');

      // 1) Guardar recepción
      const { error: recErr } = await window.sb.from('recepciones_oc').insert([{
        id:             recId,
        oc_id:          oc.id,
        empresa_id:     window.currentEmpresa || 'demo1',
        fecha:          fechaRec,
        items:          itemsJson,
        monto_ajustado: montoAjustado,
        notas:              notas.trim() || null,
        motivo_discrepancia: hayDiscrepancias ? (motivoCompuesto || null) : null,
      }]);
      if (recErr) { setError(recErr.message); setSaving(false); return; }

      // 2) Determinar nuevo estado OC — ACUMULANDO lo recibido en recepciones
      // previas (yaRecibido). Se marca 'recibida' solo cuando TODAS las líneas
      // alcanzan su cantidad pedida sumando recepciones anteriores + esta; si no,
      // 'parcialmente recibida'. (Bug audit 2026-06-26: antes comparaba solo la
      // recepción actual contra el pedido total → nunca llegaba a 'recibida' en
      // envíos parciales y permitía sobre-recibir.)
      const todasCompletas = lineas.every(l => {
        const pedida = parseFloat(l.cantidad_pedida) || 0;
        if (pedida <= 0) return true;  // legacy / línea sin cantidad
        const prev  = yaRecibido[l.id] || 0;
        const ahora = l.estado_item === 'faltante' ? 0 : (parseFloat(l.cantidad_recibida) || 0);
        return (prev + ahora) >= pedida - 0.001;
      });
      const nuevoEstado = todasCompletas ? 'recibida' : 'parcialmente recibida';

      // monto_total ACUMULA lo recibido en todas las recepciones (previas + esta),
      // no se pisa con el de una sola. Queda consistente con la suma de CxP.
      const montoTotalAcum = montoRecibidoPrevio + montoAjustado;
      await window.sb.from('ordenes_compra')
        .update({ estado: nuevoEstado, monto_total: montoTotalAcum })
        .eq('id', oc.id);

      // 3) Generar CxP por monto ajustado
      if (montoAjustado > 0) {
        const prov    = SSData.proveedores.find(p => p.id === (oc.proveedor_id || oc.proveedor));
        const diasP   = prov?.diasPago || prov?.dias_pago || 0;
        // La OC puede traer SU PROPIA fecha de vencimiento (negociada para esa compra puntual);
        // si la trae, manda por encima de los días de pago genéricos del proveedor.
        const venceMs = new Date(fechaRec).getTime() + diasP * 86400000;
        const vence   = oc.fecha_vencimiento || new Date(venceMs).toISOString().split('T')[0];
        const cxpId   = 'CXP-OC-' + Date.now();

        const { error: cxpErr } = await window.sb.from('cuentas_pagar').insert([{
          id:          cxpId,
          empresa_id:  window.currentEmpresa || 'demo1',
          factura:     oc.id,
          proveedor_id: oc.proveedor_id || oc.proveedor,
          monto:       montoAjustado,
          pagado:      0,
          vence:       vence,
          dias:        diasP,
          estado:      'pendiente',
          tipo:        'proveedor',
          concepto:    `Recepción OC ${oc.id}`,
          pagos:       [],
          creado_por:  window.__ssCurrentUser?.nombre || null,
        }]);
        if (!cxpErr) {
          // Fix bug #27: `dias` POSITIVO = vencido, NEGATIVO = días hasta vencer (convención
          // de supabase.js loadAppData). `diasP` es el PLAZO de pago, no el aging; usarlo crudo
          // hacía que la CxP recién creada saliera con chip rojo "+30d vencida" en memoria.
          // Calculamos el aging desde `vence` igual que loadAppData (signo correcto: negativo).
          // Medianoche de HOY en Venezuela (no del dispositivo) para el aging.
          const _hoyMid = new Date(window.localDateStr() + 'T00:00:00');
          const diasMem = Math.round((_hoyMid - new Date(vence + 'T00:00:00')) / 86400000);
          (window.SSData.cuentasPagar = window.SSData.cuentasPagar || []).unshift({
            id: cxpId, factura: oc.id, proveedor_id: oc.proveedor_id || oc.proveedor,
            // Fix bug #13: loadAppData normaliza cada CxP con `proveedor: c.proveedor_id`,
            // y AccountsPage/RegisterPaymentModal identifican la entidad por `proveedor`,
            // no por `proveedor_id`. Sin esto la CxP optimista sale sin nombre y no es pagable hasta recargar.
            proveedor: oc.proveedor_id || oc.proveedor,
            monto: montoAjustado, pagado: 0, vence, dias: diasMem,
            estado: 'pendiente', tipo: 'proveedor',
            concepto: `Recepción OC ${oc.id}`, pagos: [],
            empresa_id: window.currentEmpresa || 'demo1',
          });
        }
      }

      // 4) Actualizar inventario (solo items ok, sku definido, almacen definido)
      const inventarioErrores = [];
      if (almacenId) {
        const almNombre = (SSData.almacenes || []).find(a => a.id === almacenId)?.nombre || almacenId;
        for (const l of lineas) {
          if (l.estado_item !== 'ok') continue;
          if (!l.sku) continue;
          const qty = parseFloat(l.cantidad_recibida) || 0;
          if (qty <= 0) continue;
          // Fix bug #28: NO reescribir `reservado` en la entrada — escribirlo con el valor stale
          // de memoria pisaba reservas hechas por ventas entre la carga de SSData y este confirm.
          // La RPC va un paso más allá: suma un DELTA sobre el valor real en DB (no sobre el que
          // teníamos en memoria), así dos recepciones simultáneas no se pisan entre sí. Y declara
          // el motivo, para que el kardex la asiente como recepción y no como un ajuste sin causa.
          const { data: invRes, error: invErr } = await window.sb.rpc('inv_ajustar_cantidad', {
            p_sku: l.sku, p_almacen: almacenId, p_empresa: window.currentEmpresa || 'demo1', p_delta: qty,
            p_tipo: 'entrada', p_ref_tipo: 'recepcion', p_ref_documento: oc.id,
            p_motivo: 'Recepción de OC', p_usuario: window.__ssCurrentUser?.nombre || null,
          });
          // Bug audit 2026-06-26: antes el error se ignoraba y SSData se actualizaba igual → el
          // stock subía en pantalla pero no en DB. Ahora si falla NO mutamos memoria y se reporta.
          if (invErr || invRes?.error) { inventarioErrores.push(`${l.sku}: ${invErr?.message || invRes.error}`); continue; }
          if (!SSData.inventario) SSData.inventario = {};
          if (!SSData.inventario[l.sku]) SSData.inventario[l.sku] = {};
          SSData.inventario[l.sku][almacenId] = {
            ...(SSData.inventario[l.sku][almacenId] || {}),
            cantidad: invRes.cantidad,   // valor autoritativo que devuelve la RPC
          };
          // Registrar entrada en log de inventario para que aparezca en /movimientos
          const provNombre = (SSData.proveedores || []).find(p => p.id === (oc.proveedor_id || oc.proveedor))?.nombre || null;
          window.logActivity?.({
            modulo:        'inventario',
            accion:        'entrada',
            entidad_id:    l.sku,
            entidad_label: l.descripcion || l.sku,
            detalles: {
              sku:                 l.sku,
              cantidad:            qty,
              almacen_destino_id:  almacenId,
              almacen_destino:     almNombre,
              origen:              'orden_compra',
              ref:                 oc.id,
              proveedor_id:        oc.proveedor_id || oc.proveedor || null,
              proveedor:           provNombre,
            },
          });
        }
      }

      // 5) Actualizar SSData: estado + monto total acumulado (la lista refleja el total recibido)
      const idx = (SSData.ordenesCompra || []).findIndex(o => o.id === oc.id);
      if (idx !== -1) {
        SSData.ordenesCompra[idx].estado = nuevoEstado;
        SSData.ordenesCompra[idx].monto = montoTotalAcum;
      }

      // 6) Insertar seriales (solo SKUs serializados con seriales válidos ya validados arriba)
      const serialesRegistrados = {}; // { sku: count }
      const serialesErrores = [];
      if (almacenId) {
        for (const sku of Object.keys(serialesParsed)) {
          const lista = serialesParsed[sku];
          if (!lista || lista.length === 0) continue;
          const prod = getProducto(sku);
          const res = await window.agregarSeriales({
            sku,
            almacenId,
            seriales: lista,
            garantiaMeses: prod?.garantia_meses || null,
            notas: 'OC ' + oc.id,
          });
          if (res?.error) {
            serialesErrores.push(`${sku}: ${res.error.message}`);
          } else {
            serialesRegistrados[sku] = res?.count || lista.length;
          }
        }
      }

      window.logActivity?.({
        modulo: 'ordenes_compra', accion: 'recepcion',
        entidad_id: oc.id, entidad_label: oc.id,
        detalles: {
          estado: nuevoEstado,
          monto_ajustado: montoAjustado,
          almacen: almacenId,
          seriales_registrados: serialesRegistrados,
          seriales_errores: serialesErrores.length ? serialesErrores : undefined,
          inventario_errores: inventarioErrores.length ? inventarioErrores : undefined,
        },
      });

      const avisos = [];
      if (inventarioErrores.length > 0) avisos.push('No se pudo actualizar el stock de:\n• ' + inventarioErrores.join('\n• '));
      if (serialesErrores.length > 0)   avisos.push('Errores al registrar seriales:\n• ' + serialesErrores.join('\n• ') + '\n\nPodés agregarlos manualmente desde inventario.');
      if (avisos.length > 0) {
        alert('Recepción confirmada, pero con observaciones:\n\n' + avisos.join('\n\n'));
      }

      onDone?.();
    } catch (err) {
      setError(err.message || 'Error inesperado');
      setSaving(false);
    }
  }

  const estadoColors = { ok: 'var(--success)', 'dañado': '#f59e0b', faltante: 'var(--danger)' };

  // Mientras no se sepa qué productos son serializados no se puede confirmar: en esa
  // ventana un serializado se vería como normal y pasaría sin S/N.
  const prodInfoCargando = prodInfo === null;

  // Validación de seriales en vivo para deshabilitar el botón Confirmar
  const serialesFaltantes = lineas.some(l => {
    if (l.estado_item !== 'ok') return false;
    if (!l.sku) return false;
    const prod = getProducto(l.sku);
    if (!prod || !prod.serializado) return false;
    const qty = parseFloat(l.cantidad_recibida) || 0;
    if (qty <= 0) return false;
    return parseSeriales(seriales[l.sku] || '').length !== qty;
  });

  // Una línea necesita MOTIVO cuando: llegó dañada/faltante, O se recibe MENOS de lo pendiente
  // (recibir menos de lo esperado exige justificar el porqué, justo en ese producto). El motivo se
  // captura por-producto (l.notas_item) y se compone en motivo_discrepancia al guardar.
  function lineaNecesitaMotivo(l) {
    if (l.estado_item !== 'ok') return true;
    const pedido = parseFloat(l.cantidad_pedida) || 0;
    const pend   = Math.max(0, pedido - (yaRecibido[l.id] || 0));
    const recibe = parseFloat(l.cantidad_recibida) || 0;
    return pend > 0 && recibe < pend - 0.001;
  }
  const hayDiscrepancias = lineas.some(lineaNecesitaMotivo);
  const lineasSinMotivo  = lineas.filter(l => lineaNecesitaMotivo(l) && !(l.notas_item || '').trim());
  const montoOriginal = lineas.reduce((s, l) =>
    s + (parseFloat(l.cantidad_pedida) || 0) * (parseFloat(l.precio_unitario) || 0), 0);

  return (
    <div className="modal-overlay" style={{ zIndex: 1010 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 720, maxWidth: '96vw' }}>
        <div className="modal-header" style={{ alignItems: 'flex-start' }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="modal-title">Registrar recepción — {oc.id}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }} className="muted" title="Usuario que registra la recepción">
              Registra: <CreadoPorCell nombre={window.__ssCurrentUser?.nombre} size={18}/>
            </span>
          </span>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="form-label">Fecha de recepción</label>
              <input className="input" type="date" style={{ width: '100%' }} value={fechaRec} onChange={e => setFechaRec(e.target.value)}/>
            </div>
            <div>
              <label className="form-label">Almacén destino</label>
              <select className="select" style={{ width: '100%' }} value={almacenId} onChange={e => setAlmacenId(e.target.value)}>
                <option value="">— Sin almacén (solo CxP) —</option>
                {SSData.almacenes.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>
                {esLegacy ? 'ÍTEMS RECIBIDOS — ingresá lo que llegó' : 'VERIFICACIÓN DE ÍTEMS'}
              </div>
              {esLegacy && (
                <button className="btn ghost sm" onClick={addLinea}><Icon name="plus" size={12}/>Agregar ítem</button>
              )}
            </div>
            {esLegacy && (
              <div style={{ background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 8, color: '#92400e' }}>
                Esta OC no tiene ítems detallados. Ingresá cada producto recibido con la cantidad pedida y la cantidad real que llegó.
              </div>
            )}
            {!esLegacy && Object.keys(yaRecibido).length > 0 && (
              <div style={{ background: 'var(--brand-soft)', border: '1px solid var(--brand)', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 8, color: 'var(--brand)' }}>
                Esta OC ya tiene recepciones previas: las cantidades por defecto muestran solo lo <strong>pendiente</strong>. Al completar todas las líneas, la OC pasará a "Recibida".
              </div>
            )}
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-sunken)' }}>
                    {esLegacy && <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, width: 80 }}>SKU</th>}
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600 }}>Descripción</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, width: 70 }}>Pedido</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, width: 80 }}>Recibido</th>
                    {esLegacy && <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, width: 90 }}>P. Unit.</th>}
                    <th style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 600, width: 110 }}>Estado</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, width: 90 }}>Subtotal</th>
                    {esLegacy && <th style={{ width: 28 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l, idx) => {
                    const recibido  = parseFloat(l.cantidad_recibida) || 0;
                    const pedido    = parseFloat(l.cantidad_pedida)   || 0;
                    const precio    = parseFloat(l.precio_unitario)   || 0;
                    const subtotal  = l.estado_item === 'faltante' ? 0 : recibido * precio;
                    const prevRec   = yaRecibido[l.id] || 0;           // recibido en recepciones anteriores
                    const pendiente = Math.max(0, pedido - prevRec);   // lo que falta por recibir
                    // Borde ámbar: recibís menos de lo PENDIENTE (no de lo pedido total).
                    const hayDiff   = pendiente > 0 && recibido < pendiente;
                    const prodLinea = getProducto(l.sku);
                    const esSerializado = !!(prodLinea && prodLinea.serializado);
                    const mostrarSeriales = esSerializado && l.estado_item === 'ok' && recibido > 0;
                    const serialesActuales = parseSeriales(seriales[l.sku] || '');
                    const seriesOk = serialesActuales.length === recibido;
                    const colSpanSeriales = esLegacy ? 8 : 6;
                    const necesitaMotivo = lineaNecesitaMotivo(l);
                    return (
                      <React.Fragment key={l.id || l._k || idx}>
                      <tr style={{ borderTop: '1px solid var(--border)', background: l.estado_item === 'faltante' ? 'var(--danger-soft, #fef2f2)' : l.estado_item === 'dañado' ? '#fffbeb' : '' }}>
                        {esLegacy && (
                          <td style={{ padding: '4px 6px' }}>
                            <input className="input" style={{ padding: '3px 6px', fontSize: 11, width: '100%' }}
                              placeholder="SKU" value={l.sku || ''} onChange={e => updLinea(idx, 'sku', e.target.value)}/>
                          </td>
                        )}
                        <td style={{ padding: esLegacy ? '4px 6px' : '6px 10px' }}>
                          {esLegacy ? (
                            <input className="input" style={{ padding: '3px 6px', fontSize: 12, width: '100%' }}
                              placeholder="Descripción del producto *" value={l.descripcion || ''} onChange={e => updLinea(idx, 'descripcion', e.target.value)}/>
                          ) : (
                            <>
                              {l.sku && <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l.sku}</div>}
                              <div>{l.descripcion}</div>
                            </>
                          )}
                        </td>
                        <td style={{ padding: esLegacy ? '4px 6px' : '6px 10px', textAlign: 'right' }}>
                          {esLegacy ? (
                            <input className="input" type="number" min="0" step="0.01"
                              style={{ padding: '3px 6px', fontSize: 12, textAlign: 'right', width: '100%' }}
                              placeholder="0" value={l.cantidad_pedida || ''} onChange={e => updLinea(idx, 'cantidad_pedida', e.target.value)}/>
                          ) : (
                            <div>
                              <span style={{ color: 'var(--text-muted)' }}>{l.cantidad_pedida}</span>
                              {prevRec > 0 && (
                                <div style={{ fontSize: 10, color: 'var(--accent)', whiteSpace: 'nowrap', marginTop: 1 }}>
                                  ya {prevRec} · falta {pendiente}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '4px 6px' }}>
                          <input className="input" type="number" min="0" step="0.01"
                            style={{ padding: '3px 6px', fontSize: 12, textAlign: 'right', width: '100%', borderColor: hayDiff && l.estado_item !== 'faltante' ? 'var(--accent)' : '' }}
                            value={l.cantidad_recibida}
                            onChange={e => updLinea(idx, 'cantidad_recibida', e.target.value)}/>
                        </td>
                        {esLegacy && (
                          <td style={{ padding: '4px 6px' }}>
                            <input className="input" type="number" min="0" step="0.01"
                              style={{ padding: '3px 6px', fontSize: 12, textAlign: 'right', width: '100%' }}
                              placeholder="0.00" value={l.precio_unitario || ''} onChange={e => updLinea(idx, 'precio_unitario', e.target.value)}/>
                          </td>
                        )}
                        <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                          <select className="select" style={{ fontSize: 11, padding: '3px 6px', color: estadoColors[l.estado_item] || '' }}
                            value={l.estado_item} onChange={e => updLinea(idx, 'estado_item', e.target.value)}>
                            <option value="ok">&#10003; OK</option>
                            <option value="dañado">&#9888; Dañado</option>
                            <option value="faltante">&#10007; Faltante</option>
                          </select>
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: l.estado_item === 'faltante' ? 'var(--danger)' : '' }}>
                          {l.estado_item === 'faltante' ? '—' : fmt.usd(subtotal)}
                        </td>
                        {esLegacy && (
                          <td style={{ padding: '4px 4px' }}>
                            <button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => removeLinea(idx)}>
                              <Icon name="x" size={12}/>
                            </button>
                          </td>
                        )}
                      </tr>
                      {necesitaMotivo && (
                        <tr style={{ background: '#fffbeb', borderTop: '1px dashed var(--border)' }}>
                          <td colSpan={colSpanSeriales} style={{ padding: '6px 10px' }}>
                            <label style={{ fontSize: 11, fontWeight: 600, color: '#92400e', display: 'block', marginBottom: 3 }}>
                              {l.estado_item === 'faltante' ? 'Motivo del faltante' : l.estado_item === 'dañado' ? 'Motivo del daño' : 'Motivo — se recibe menos de lo esperado'} <span style={{ color: 'var(--danger)' }}>*</span>
                            </label>
                            <input className="input" style={{ width: '100%', fontSize: 12, borderColor: !(l.notas_item || '').trim() ? 'var(--danger)' : '' }}
                              placeholder="Ej: el proveedor solo envió parte del pedido; resto en el próximo despacho…"
                              value={l.notas_item || ''} onChange={e => updLinea(idx, 'notas_item', e.target.value)}/>
                          </td>
                        </tr>
                      )}
                      {mostrarSeriales && (
                        <tr style={{ background: seriesOk ? '#f0fdf4' : '#fef2f2', borderTop: '1px dashed var(--border)' }}>
                          <td colSpan={colSpanSeriales} style={{ padding: '8px 10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                                SERIALES RECIBIDOS (uno por línea) — {l.sku}
                              </label>
                              <span style={{ fontSize: 11, fontWeight: 700, color: seriesOk ? 'var(--success)' : 'var(--danger)' }}>
                                {serialesActuales.length} de {recibido} seriales
                                {!seriesOk && ` — faltan ${Math.max(0, recibido - serialesActuales.length)}`}
                              </span>
                            </div>
                            <textarea
                              className="input"
                              rows={Math.min(Math.max(2, recibido), 6)}
                              style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: 12, borderColor: seriesOk ? 'var(--success)' : 'var(--danger)' }}
                              placeholder={`SN001\nSN002\n...`}
                              value={seriales[l.sku] || ''}
                              onChange={e => setSeriales(prev => ({ ...prev, [l.sku]: e.target.value }))}
                            />
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-sunken)' }}>
                    <td colSpan={esLegacy ? 6 : 4} style={{ padding: '8px 10px', fontWeight: 700, textAlign: 'right' }}>TOTAL A PAGAR</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 14 }}>{fmt.usd(montoAjustado)}</td>
                    {esLegacy && <td/>}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Comparativo emitido vs recibido */}
          <div style={{ background: 'var(--bg-sunken)', borderRadius: 8, padding: '12px 14px' }}>
            <div className="muted" style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>COMPARATIVO OC EMITIDA vs RECIBIDA</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13 }}>
              <div style={{ textAlign: 'center' }}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>EMITIDO</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 16 }}>{fmt.usd(montoOriginal)}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>A PAGAR</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 16, color: montoAjustado < montoOriginal ? 'var(--success)' : '' }}>{fmt.usd(montoAjustado)}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>DIFERENCIA</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 16, color: (montoAjustado - montoOriginal) < 0 ? 'var(--success)' : (montoAjustado - montoOriginal) > 0 ? 'var(--danger)' : '' }}>
                  {montoAjustado === montoOriginal ? '—' : fmt.usd(montoAjustado - montoOriginal)}
                </div>
              </div>
            </div>
          </div>

          {hayDiscrepancias && (
            <div className="muted" style={{ fontSize: 11.5, background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 6, padding: '8px 12px', color: '#92400e' }}>
              Indicá el <strong>motivo en cada producto</strong> con diferencia (dañado, faltante o recibido de menos) — el campo aparece debajo de cada línea afectada.
            </div>
          )}

          <div>
            <label className="form-label">Notas de recepción</label>
            <textarea className="input" rows={2} style={{ width: '100%', resize: 'vertical' }}
              placeholder="Observaciones sobre la recepción, daños, discrepancias…"
              value={notas} onChange={e => setNotas(e.target.value)}/>
          </div>

          {lineas.some(l => l.estado_item !== 'ok') && (
            <div style={{ background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 8, padding: '10px 14px', fontSize: 12.5 }}>
              <strong>Discrepancias detectadas:</strong>
              <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                {lineas.filter(l => l.estado_item === 'dañado').map((l, i) => (
                  <li key={i} style={{ color: '#92400e' }}>Dañado: {l.descripcion} ({l.cantidad_recibida} unidades) — se genera CxP pero no entra al inventario</li>
                ))}
                {lineas.filter(l => l.estado_item === 'faltante').map((l, i) => (
                  <li key={i} style={{ color: 'var(--danger)' }}>Faltante: {l.descripcion} — no entra al inventario ni a CxP</li>
                ))}
              </ul>
            </div>
          )}

          {error && <div style={{ color: 'var(--danger)', fontSize: 13, background: 'var(--danger-soft, #fee)', padding: '8px 12px', borderRadius: 6 }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={saving || serialesFaltantes || loadingPrev || prevError || prodInfoCargando} onClick={handleConfirmar} title={prevError ? 'Error cargando recepciones previas — cerrá y reintentá' : loadingPrev ? 'Cargando recepciones previas…' : prodInfoCargando ? 'Verificando qué productos llevan serial…' : serialesFaltantes ? 'Faltan seriales por completar' : ''}>
            <Icon name="check" size={14}/>{saving ? 'Procesando…' : loadingPrev ? 'Cargando…' : prodInfoCargando ? 'Verificando…' : prevError ? 'Error de carga' : serialesFaltantes ? 'Faltan seriales' : `Confirmar recepción — ${fmt.usd(montoAjustado)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: devolver OC al proveedor (total o parcial) ──────────────────────
// Baja el inventario (salida) y reduce la deuda (CxP pendiente) — ver window.devolverOC.
function DevolucionOCModal({ oc, prov, onClose, onDone }) {
  const [almacenId, setAlmacenId] = useState(SSData.almacenes?.[0]?.id || '');
  const [fecha, setFecha]         = useState(window.localDateStr());
  const [motivo, setMotivo]       = useState('');
  const [lineas, setLineas]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  useEffect(() => {
    let cancel = false;
    (async () => {
      const [{ data: recs, error: e1 }, { data: devs, error: e2 }] = await Promise.all([
        window.sb.from('recepciones_oc').select('items').eq('oc_id', oc.id),
        window.sb.from('devoluciones_oc').select('items').eq('oc_id', oc.id),
      ]);
      if (cancel) return;
      if (e1 || e2) { setLoadError((e1 || e2).message); setLoading(false); return; }
      // Devolvible por ítem = recibido OK (entró a inventario) − ya devuelto.
      const map = {};
      (recs || []).forEach(r => (Array.isArray(r.items) ? r.items : []).forEach(it => {
        if (it.estado !== 'ok') return;   // dañado/faltante no entraron al inventario
        const key = it.oci_id || ('sku:' + (it.sku || it.descripcion));
        if (!map[key]) map[key] = { oci_id: it.oci_id || null, sku: it.sku || null, descripcion: it.descripcion || it.sku || 'ítem', precio: parseFloat(it.precio_unitario) || 0, recibido: 0, yaDev: 0 };
        map[key].recibido += parseFloat(it.cantidad_recibida) || 0;
        if (it.precio_unitario) map[key].precio = parseFloat(it.precio_unitario);
      }));
      (devs || []).forEach(d => (Array.isArray(d.items) ? d.items : []).forEach(it => {
        const key = it.oci_id || ('sku:' + (it.sku || it.descripcion));
        if (map[key]) map[key].yaDev += parseFloat(it.cantidad) || 0;
      }));
      const ls = Object.values(map)
        .map(m => ({ ...m, devolvible: Math.round(Math.max(0, m.recibido - m.yaDev) * 1000) / 1000, cantidad: '', nota: '' }))
        // Solo productos con SKU: una línea de servicio/flete sin SKU no mueve inventario (no es una "devolución de mercancía").
        .filter(l => l.devolvible > 0.001 && l.sku);
      setLineas(ls);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [oc.id]);

  function updLinea(i, k, v) { setLineas(prev => prev.map((l, idx) => idx === i ? { ...l, [k]: v } : l)); }
  function devolverTodo() { setLineas(prev => prev.map(l => ({ ...l, cantidad: String(l.devolvible) }))); }

  const total = lineas.reduce((s, l) => s + (parseFloat(l.cantidad) || 0) * (l.precio || 0), 0);
  const stockDe = (sku) => (sku && almacenId) ? (SSData.inventario?.[sku]?.[almacenId]?.cantidad || 0) : null;

  async function handleConfirmar() {
    setError('');
    if (!almacenId) { setError('Seleccioná el almacén de donde sale la mercancía.'); return; }
    const over = lineas.filter(l => (parseFloat(l.cantidad) || 0) > l.devolvible + 0.001);
    if (over.length) { setError('No podés devolver más de lo disponible:\n• ' + over.map(l => `${l.sku || l.descripcion}: ${l.cantidad} > ${l.devolvible}`).join('\n• ')); return; }
    const items = lineas.filter(l => (parseFloat(l.cantidad) || 0) > 0)
      .map(l => ({ oci_id: l.oci_id, sku: l.sku, descripcion: l.descripcion, cantidad: parseFloat(l.cantidad) || 0, precio_unitario: l.precio, motivo: l.nota }));
    if (items.length === 0) { setError('Indicá al menos una cantidad a devolver.'); return; }
    if (!motivo.trim()) { setError('Indicá el motivo de la devolución al proveedor.'); return; }
    setSaving(true);
    try {
      const res = await window.devolverOC({ ocId: oc.id, almacenId, fecha, motivo, items });
      if (res.error) { setError(res.error.message); return; }
      const avisos = [];
      if (res.sobranteSinCxp > 0) avisos.push(`Se devolvió por ${fmt.usd(res.monto)}, pero la deuda solo se bajó en ${fmt.usd(res.deudaReducida)}. El resto (${fmt.usd(res.sobranteSinCxp)}) corresponde a mercancía ya pagada — gestioná el reembolso o nota de crédito con el proveedor.`);
      if (avisos.length) alert('Devolución registrada, con observaciones:\n\n' + avisos.join('\n\n'));
      onDone?.();
    } catch (err) {
      setError('Error inesperado procesando la devolución: ' + (err?.message || err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 1010 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 700, maxWidth: '96vw' }}>
        <div className="modal-header" style={{ alignItems: 'flex-start' }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="modal-title">Devolver al proveedor — {oc.id}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }} className="muted" title="Usuario que registra la devolución">
              Registra: <CreadoPorCell nombre={window.__ssCurrentUser?.nombre} size={18}/>
            </span>
          </span>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#92400e' }}>
            Devolver baja el <strong>inventario</strong> (salida) de lo devuelto y reduce la <strong>deuda (CxP pendiente)</strong> con {prov?.nombre || 'el proveedor'}. Solo se puede devolver lo recibido en buen estado que aún no fue devuelto.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="form-label">Fecha de devolución</label>
              <input className="input" type="date" style={{ width: '100%' }} value={fecha} onChange={e => setFecha(e.target.value)}/>
            </div>
            <div>
              <label className="form-label">Almacén de origen (de donde sale)</label>
              <select className="select" style={{ width: '100%' }} value={almacenId} onChange={e => setAlmacenId(e.target.value)}>
                <option value="">— Seleccionar almacén —</option>
                {SSData.almacenes.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </div>
          </div>

          {loading ? (
            <div className="muted" style={{ textAlign: 'center', padding: '16px 0', fontSize: 13 }}>Cargando lo recibido…</div>
          ) : loadError ? (
            <div style={{ color: 'var(--danger)', fontSize: 13 }}>Error cargando datos: {loadError}. Cerrá y reintentá.</div>
          ) : lineas.length === 0 ? (
            <div className="muted" style={{ textAlign: 'center', padding: '16px 0', fontSize: 13 }}>Esta OC no tiene mercancía recibida (en buen estado) disponible para devolver.</div>
          ) : (<>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>PRODUCTOS A DEVOLVER</div>
                <button className="btn ghost sm" onClick={devolverTodo}>Devolver todo</button>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-sunken)' }}>
                      <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600 }}>Producto</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, width: 90 }}>Devolvible</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, width: 90 }}>Devolver</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, width: 80 }}>P. Unit.</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, width: 90 }}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineas.map((l, i) => {
                      const cant = parseFloat(l.cantidad) || 0;
                      const stock = stockDe(l.sku);
                      const sinStock = stock != null && cant > stock + 0.001;
                      return (
                        <React.Fragment key={l.oci_id || l.sku || i}>
                          <tr style={{ borderTop: '1px solid var(--border)' }}>
                            <td style={{ padding: '6px 10px' }}>
                              {l.sku && <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l.sku}</div>}
                              <div>{l.descripcion}</div>
                              {l.yaDev > 0 && <div style={{ fontSize: 10, color: 'var(--accent)' }}>ya devuelto: {l.yaDev}</div>}
                            </td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{l.devolvible}</td>
                            <td style={{ padding: '4px 6px' }}>
                              <input className="input" type="number" min="0" step="0.01" max={l.devolvible}
                                style={{ padding: '3px 6px', fontSize: 12, textAlign: 'right', width: '100%', borderColor: (cant > l.devolvible + 0.001 || sinStock) ? 'var(--danger)' : '' }}
                                value={l.cantidad} onChange={e => updLinea(i, 'cantidad', e.target.value)}/>
                            </td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt.usd(l.precio)}</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{fmt.usd(cant * l.precio)}</td>
                          </tr>
                          {sinStock && (
                            <tr><td colSpan={5} style={{ padding: '2px 10px 6px', fontSize: 11, color: 'var(--danger)' }}>Solo hay {stock} en {SSData.almacenes.find(a=>a.id===almacenId)?.nombre} — no podés devolver más de lo que hay físicamente.</td></tr>
                          )}
                          {cant > 0 && (
                            <tr style={{ background: '#fafafa' }}>
                              <td colSpan={5} style={{ padding: '4px 10px 8px' }}>
                                <input className="input" style={{ width: '100%', fontSize: 11.5 }} placeholder="Motivo/nota para este producto (opcional)…"
                                  value={l.nota} onChange={e => updLinea(i, 'nota', e.target.value)}/>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-sunken)' }}>
                      <td colSpan={4} style={{ padding: '8px 10px', fontWeight: 700, textAlign: 'right' }}>TOTAL A DEVOLVER (baja de deuda)</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 14 }}>{fmt.usd(total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div>
              <label className="form-label">Motivo de la devolución <span style={{ color: 'var(--danger)' }}>*</span></label>
              <textarea className="input" rows={2} style={{ width: '100%', resize: 'vertical', borderColor: !motivo.trim() ? 'var(--danger)' : '' }}
                placeholder="Ej: producto defectuoso, sobrestock, error en el pedido…"
                value={motivo} onChange={e => setMotivo(e.target.value)}/>
            </div>
          </>)}

          {error && <div style={{ color: 'var(--danger)', fontSize: 13, background: 'var(--danger-soft, #fee)', padding: '8px 12px', borderRadius: 6, whiteSpace: 'pre-line' }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={saving || loading || lineas.length === 0} onClick={handleConfirmar}>
            <Icon name="arrUp" size={14}/>{saving ? 'Procesando…' : `Confirmar devolución — ${fmt.usd(total)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

window.SuppliersPage = function SuppliersPage() {
  const [tab, setTab]           = useState('proveedores');
  const [searchP, setSearchP]   = useState('');
  const [selP, setSelP]         = useState(new Set());
  const [pageP, setPageP]       = useState(1);
  const [selOC, setSelOC]       = useState(new Set());
  const [pageOC, setPageOC]     = useState(1);
  const [showActivity, setShowActivity] = useState(false);
  const [showNewOC, setShowNewOC]       = useState(false);
  const [showNewProv, setShowNewProv]   = useState(false);
  const [detalleProv, setDetalleProv]   = useState(null);
  const [selectedOC, setSelectedOC]     = useState(null);
  const [duplicateOC, setDuplicateOC]   = useState(null);
  const [recepcionOC, setRecepcionOC]   = useState(null);
  const [ocSubTab, setOcSubTab]         = useState('ordenes');
  const [, forceRender]                 = useState(0);
  const [pageSize, setPageSize] = useState(() => loadPageSize('proveedores', 50));
  useEffect(() => { localStorage.setItem('ss-proveedores-pagesize', String(pageSize)); }, [pageSize]);

  // Deep-link desde /cxp: si window.__ssOpenOC tiene un id, abrir esa OC al montar
  useEffect(() => {
    const ocId = window.__ssOpenOC;
    if (!ocId) return;
    window.__ssOpenOC = null;
    setTab('oc');
    setOcSubTab('ordenes');
    let vivo = true;
    (async () => {
      // Las OC NO están en memoria al montar: se piden al entrar a este módulo
      // (`ensureOrdenesCompra`, ver CLAUDE.md — son 4 MB y no viajan en el arranque). Este efecto
      // buscaba de inmediato, así que el enlace desde CxP fallaba SIEMPRE con "no se encontró la
      // orden", aunque la orden existiera. Hay que esperar la carga.
      await window.ensureOrdenesCompra?.();
      if (!vivo) return;
      let target = (SSData.ordenesCompra || []).find(o => o.id === ocId);
      if (!target) {
        // Última red: pedirla puntualmente por id. La carga del módulo puede tener su propia
        // ventana y dejar afuera una OC vieja; el enlace tiene que funcionar igual.
        const { data } = await window.sb.from('ordenes_compra').select('*').eq('id', ocId).maybeSingle();
        if (!vivo) return;
        if (data) { target = data; SSData.ordenesCompra = [data, ...(SSData.ordenesCompra || [])]; }
      }
      if (target) setSelectedOC(target);
      else alert(`No se encontró la orden ${ocId} en el sistema.`);
    })();
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    const nav = window.__ssCmdNav;
    if (nav?.kind === 'Proveedor' && nav.id) {
      window.__ssCmdNav = null;
      const target = (SSData.proveedores || []).find(p => p.id === nav.id);
      if (target) setDetalleProv(target);
    }
  }, []);

  // Filtros OC
  const [searchOC, setSearchOC]           = useState('');
  const [filterProvOC, setFilterProvOC]   = useState('');
  const [filterEstadoOC, setFilterEstadoOC] = useState('');
  const [filterFechaDesde, setFilterFechaDesde] = useState('');
  const [filterFechaHasta, setFilterFechaHasta] = useState('');

  if (detalleProv) return <ProveedorDetailPage proveedor={detalleProv} onBack={() => setDetalleProv(null)} />;

  // Deuda real por proveedor desde CxP (la columna proveedores.deuda nunca se
  // mantiene → siempre 0). Misma lógica que ProveedorDetailPage: suma saldos de
  // cuentas_pagar excluyendo 'vuelto' y 'comision'. Recalculado cada render
  // (SSData.cuentasPagar muta en sitio, un useMemo no invalidaría confiablemente).
  const deudaPorProv = {};
  (SSData.cuentasPagar || []).forEach(c => {
    if (c.tipo === 'vuelto' || c.tipo === 'comision') return;
    const k = c.proveedor_id || c.proveedor;
    if (!k) return;
    deudaPorProv[k] = (deudaPorProv[k] || 0) + ((c.monto || 0) - (c.pagado || 0));
  });

  const provRows = SSData.proveedores.filter(p => {
    if (!searchP) return true;
    const q = searchP.toLowerCase();
    // Guards anti-crash: nombre/rif pueden venir null en datos importados/legados.
    return (p.nombre||'').toLowerCase().includes(q)
        || (p.rif||'').toLowerCase().includes(q)
        || (p.contacto||'').toLowerCase().includes(q)
        || (p.email||'').toLowerCase().includes(q);
  });
  const ocRows   = (SSData.ordenesCompra || []).filter(o => {
    const prov = SSData.proveedores.find(p => p.id === (o.proveedor_id || o.proveedor));
    if (searchOC) {
      const q = searchOC.toLowerCase();
      if (!o.id.toLowerCase().includes(q) && !(prov?.nombre || '').toLowerCase().includes(q) && !(o.doc_proveedor || '').toLowerCase().includes(q)) return false;
    }
    if (filterProvOC && (o.proveedor_id || o.proveedor) !== filterProvOC) return false;
    if (filterEstadoOC && o.estado !== filterEstadoOC) return false;
    if (filterFechaDesde && o.fecha < filterFechaDesde) return false;
    if (filterFechaHasta && o.fecha > filterFechaHasta) return false;
    return true;
  });
  const totalPP  = Math.max(1, Math.ceil(provRows.length / pageSize));
  const totalOCP = Math.max(1, Math.ceil(ocRows.length / pageSize));
  const pagProv  = provRows.slice((pageP-1)*pageSize, pageP*pageSize);
  const pagOC    = ocRows.slice((pageOC-1)*pageSize, pageOC*pageSize);

  function tgAllP() { if(selP.size===pagProv.length)setSelP(new Set());else setSelP(new Set(pagProv.map(p=>p.id))); }
  function tgOneP(id,e) { e.stopPropagation();setSelP(prev=>{const s=new Set(prev);s.has(id)?s.delete(id):s.add(id);return s;}); }
  function tgAllOC() { if(selOC.size===pagOC.length)setSelOC(new Set());else setSelOC(new Set(pagOC.map(o=>o.id))); }
  function tgOneOC(id,e) { e.stopPropagation();setSelOC(prev=>{const s=new Set(prev);s.has(id)?s.delete(id):s.add(id);return s;}); }

  const activeSelected = tab==='proveedores' ? selP : selOC;

  function bulkExportXLSX() {
    if (tab === 'proveedores') {
      const data = (selP.size > 0 ? provRows.filter(p => selP.has(p.id)) : provRows);
      if (data.length === 0) { alert('No hay proveedores para exportar.'); return; }
      // Mapear a las columnas REALES del modelo. Antes exportaba tipo/telefono/ciudad
      // (inexistentes → siempre vacías) y omitía teléfonos, días de pago, categorías
      // y deuda. categorias se aplana; deuda se calcula desde CxP (no p.deuda).
      window.exportToXLSX(data.map(p => ({
        nombre:    p.nombre || '',
        rif:       p.rif || '',
        pais:      p.pais || '',
        contacto:  p.contacto || '',
        email:     p.email || '',
        telefono1: p.telefono1 || '',
        telefono2: p.telefono2 || '',
        direccion: p.direccion || '',
        diasPago:  p.diasPago ?? p.dias_pago ?? 0,
        categorias: (Array.isArray(p.categorias) ? p.categorias.join(', ') : (p.categorias || '')),
        deuda:     parseFloat(Number(deudaPorProv[p.id] || 0).toFixed(2)),
      })), [
        { key:'nombre',     label:'Nombre' },
        { key:'rif',        label:'RIF' },
        { key:'pais',       label:'País' },
        { key:'contacto',   label:'Contacto' },
        { key:'email',      label:'Email' },
        { key:'telefono1',  label:'Teléfono 1' },
        { key:'telefono2',  label:'Teléfono 2' },
        { key:'direccion',  label:'Dirección' },
        { key:'diasPago',   label:'Días de pago' },
        { key:'categorias', label:'Categorías' },
        { key:'deuda',      label:'Deuda' },
      ], 'proveedores', 'Proveedores');
    } else {
      const data = (selOC.size > 0 ? ocRows.filter(o => selOC.has(o.id)) : ocRows);
      if (data.length === 0) { alert('No hay órdenes de compra para exportar.'); return; }
      window.exportToXLSX(data.map(o => {
        const prov = SSData.proveedores.find(p => p.id === (o.proveedor_id || o.proveedor));
        return {
          id: o.id,
          proveedor: prov?.nombre || '',
          doc_proveedor: o.doc_proveedor || '',
          fecha: o.fecha || '',
          estado: o.estado || '',
          // o.total no existe en el shape; el monto real es o.monto (← monto_total).
          total: parseFloat(Number(o.monto ?? o.monto_total ?? 0).toFixed(2)),
          // o.items es el array de líneas mapeado; exportamos su largo, no el array.
          items: Array.isArray(o.items) ? o.items.length : (o.items_count || 0),
          moneda: o.moneda || 'USD',
        };
      }), [
        { key:'id',            label:'ID' },
        { key:'proveedor',     label:'Proveedor' },
        { key:'doc_proveedor', label:'Doc. Proveedor' },
        { key:'fecha',         label:'Fecha' },
        { key:'estado',        label:'Estado' },
        { key:'items',         label:'Items' },
        { key:'total',         label:'Total' },
        { key:'moneda',        label:'Moneda' },
      ], 'ordenes_compra', 'Órdenes de Compra');
    }
  }

  async function bulkDelete() {
    if (tab === 'proveedores') {
      if (!confirm(`¿Eliminar ${selP.size} proveedor${selP.size!==1?'es':''}? Se enviarán a la papelera.`)) return;
      const targets = SSData.proveedores.filter(p => selP.has(p.id));
      const ok = [], fail = [];
      for (const p of targets) {
        const { error } = await window.sb.from('proveedores').update({ activo: false }).eq('id', p.id);
        if (!error) { window.ssTrash?.add('proveedor', p.nombre, p); ok.push(p); }
        else fail.push(p);
      }
      // Fix bug #29: mutar SSData por `selP` (no por `ok`) ocultaba proveedores cuyo soft-delete
      // falló en DB (quedaban activo=true e invisibles). Filtramos solo los exitosos y avisamos los fallidos.
      const okIds = new Set(ok.map(p => p.id));
      SSData.proveedores = SSData.proveedores.filter(p => !okIds.has(p.id));
      setSelP(new Set());
      if (fail.length) alert(`No se pudieron eliminar ${fail.length} proveedor${fail.length!==1?'es':''}: ` + fail.map(p=>p.nombre).join(', '));
      if (ok.length) {
        window.logActivity?.({
          modulo:'proveedores', accion: ok.length===1?'eliminar':'bulk_eliminar',
          entidad_id: ok.length===1?ok[0].id:null,
          entidad_label: ok.length===1?ok[0].nombre:`${ok.length} proveedores`,
          detalles:{ ids: ok.map(p=>p.id), nombres: ok.map(p=>p.nombre) }
        });
        await window.refrescarFase2?.();
      }
    } else {
      if (!confirm(`¿Eliminar ${selOC.size} orden${selOC.size!==1?'es':''} de compra?`)) return;
      const targets = SSData.ordenesCompra.filter(o => selOC.has(o.id));
      // Fix bug #15: antes solo se mandaba a papelera y se mutaba SSData, SIN tocar la DB
      // → la OC reaparecía al recargar. Ahora borramos en DB (items primero por la FK,
      // luego la cabecera), validamos error y SOLO entonces vamos a papelera/SSData.
      const ok = [];
      for (const o of targets) {
        // Capturar las líneas hijas ANTES de borrarlas, para poder restaurarlas completas.
        const { data: ocItems } = await window.sb.from('ordenes_compra_items').select('*').eq('oc_id', o.id);
        const { error: itemsErr } = await window.sb.from('ordenes_compra_items').delete().eq('oc_id', o.id);
        if (itemsErr) continue;
        const { error: ocErr } = await window.sb.from('ordenes_compra').delete().eq('id', o.id);
        if (ocErr) continue;
        window.ssTrash?.add('ordenCompra', o.id, { ...o, _items: ocItems || [] });
        ok.push(o);
      }
      if (ok.length < targets.length) {
        alert(`No se pudieron eliminar ${targets.length - ok.length} de ${targets.length} órdenes de compra.`);
      }
      const okIds = new Set(ok.map(o => o.id));
      SSData.ordenesCompra = SSData.ordenesCompra.filter(o => !okIds.has(o.id));
      setSelOC(new Set());
      if (ok.length) window.logActivity?.({
        modulo:'ordenes_compra', accion: ok.length===1?'eliminar':'bulk_eliminar',
        entidad_label: ok.length===1?ok[0].id:`${ok.length} OCs`,
        detalles:{ ids: ok.map(o=>o.id) }
      });
    }
  }

  async function bulkChangeEstadoOC(nuevoEstado) {
    const targets = (SSData.ordenesCompra || []).filter(o => selOC.has(o.id));
    if (!targets.length) return;
    // Bug audit 2026-06-26: 'recibida'/'parcialmente recibida' NO pueden asignarse
    // por acción masiva — requieren RecepcionOCModal, que es quien genera la CxP,
    // incrementa inventario y registra seriales. Marcarlas acá dejaría stock y CxP
    // sin generar (inconsistencia financiera/inventario).
    const ADMIN_ESTADOS = ['confirmada', 'tránsito', 'cancelada'];
    if (!ADMIN_ESTADOS.includes(nuevoEstado)) {
      alert('El estado "recibida" solo se asigna desde el flujo de recepción (genera CxP, inventario y seriales).');
      return;
    }
    // No revertir en masa OCs ya recibidas/parciales: cambiarlas sin deshacer sus
    // efectos (stock ingresado, CxP creada) dejaría datos inconsistentes.
    const conEfectos = targets.filter(o => o.estado === 'recibida' || o.estado === 'parcialmente recibida');
    const aplicar    = targets.filter(o => o.estado !== 'recibida' && o.estado !== 'parcialmente recibida');
    if (conEfectos.length) {
      alert(`${conEfectos.length} orden${conEfectos.length!==1?'es':''} ya recibida(s)/parcial(es) se omitió/omitieron: su cambio afectaría inventario y CxP ya generados.`);
    }
    if (!aplicar.length) { setSelOC(new Set()); return; }
    const ok = [];
    for (const o of aplicar) {
      const { error } = await window.sb.from('ordenes_compra').update({ estado: nuevoEstado }).eq('id', o.id);
      if (!error) { o.estado = nuevoEstado; ok.push(o); }
    }
    if (ok.length) window.logActivity?.({
      modulo: 'ordenes_compra', accion: 'bulk_editar',
      entidad_label: `${ok.length} OC${ok.length!==1?'s':''}`,
      detalles: { estado: nuevoEstado, ids: ok.map(o=>o.id) },
    });
    setSelOC(new Set());
    forceRender(n => n + 1);
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Proveedores y Órdenes de Compra</h1>
          <div className="page-subtitle">{SSData.proveedores.length} proveedores · {SSData.ordenesCompra.filter(o=>o.estado!=='recibida').length} OC en tránsito</div>
        </div>
        <div className="page-actions">
          <div className="seg">
            <button className={tab==='proveedores'?'on':''} onClick={()=>{setTab('proveedores');setSelOC(new Set());}}>Proveedores</button>
            <button className={tab==='oc'?'on':''} onClick={()=>{setTab('oc');setSelP(new Set());}}>Órdenes de compra</button>
          </div>
          <button className="btn secondary" onClick={bulkExportXLSX}><Icon name="download" size={14}/>Exportar</button>
          {window.canUser?.('crear', 'suppliers') !== false && tab === 'oc' && ocSubTab === 'ordenes' && (
            <button className="btn primary" onClick={() => setShowNewOC(true)}>
              <Icon name="plus" size={14}/>Nueva OC
            </button>
          )}
          {window.canUser?.('crear', 'suppliers') !== false && tab !== 'oc' && (
            <button className="btn primary" onClick={() => setShowNewProv(true)}>
              <Icon name="plus" size={14}/>Nuevo proveedor
            </button>
          )}
          <button className="btn ghost" onClick={() => setShowActivity(true)} title="Ver registro de actividad"><Icon name="receipt" size={14}/>Actividad</button>
        </div>
      </div>

      {/* ── Sub-tabs OC: barra secundaria separada del header ── */}
      {tab === 'oc' && (() => {
        const pendCount = (SSData.ordenesCompra||[]).filter(o=>['confirmada','tránsito','parcialmente recibida'].includes(o.estado)).length;
        return (
          <div style={{display:'flex', alignItems:'center', gap:0, borderBottom:'2px solid var(--border)', background:'var(--bg-elev)', padding:'0 16px'}}>
            <button
              onClick={()=>setOcSubTab('ordenes')}
              style={{padding:'10px 16px', fontSize:13, fontWeight:600, border:'none', background:'none', cursor:'pointer', borderBottom: ocSubTab==='ordenes' ? '2px solid var(--brand)' : '2px solid transparent', color: ocSubTab==='ordenes' ? 'var(--brand)' : 'var(--text-muted)', marginBottom:'-2px', display:'flex', alignItems:'center', gap:6}}>
              <Icon name="receipt" size={14}/>Órdenes
            </button>
            <button
              onClick={()=>setOcSubTab('recepcion')}
              style={{padding:'10px 16px', fontSize:13, fontWeight:600, border:'none', background:'none', cursor:'pointer', borderBottom: ocSubTab==='recepcion' ? '2px solid #f59e0b' : '2px solid transparent', color: ocSubTab==='recepcion' ? '#b45309' : 'var(--text-muted)', marginBottom:'-2px', display:'flex', alignItems:'center', gap:6}}>
              <Icon name="check" size={14}/>Recepción
              {pendCount > 0 && (
                <span style={{background:'#f59e0b', color:'#fff', fontSize:10, fontWeight:700, borderRadius:10, padding:'1px 6px', lineHeight:'16px'}}>{pendCount}</span>
              )}
            </button>
          </div>
        );
      })()}

      {showActivity && <ActivityLogModal modulo={tab==='proveedores'?'proveedores':'ordenes_compra'} onClose={()=>setShowActivity(false)}/>}
      {showNewProv && (
        <NewProveedorModal
          onClose={() => setShowNewProv(false)}
          onSave={() => { setShowNewProv(false); forceRender(n => n + 1); }}
        />
      )}
      {(showNewOC || duplicateOC) && (
        <NewOCModal
          initialData={duplicateOC || null}
          onClose={() => { setShowNewOC(false); setDuplicateOC(null); }}
          onSave={() => { setShowNewOC(false); setDuplicateOC(null); setTab('oc'); forceRender(n => n + 1); }}
        />
      )}
      {selectedOC && (
        <OCDetailModal
          oc={selectedOC}
          onClose={() => setSelectedOC(null)}
          onUpdate={() => { setSelectedOC(null); forceRender(n => n + 1); }}
          onDuplicate={oc => { setSelectedOC(null); setDuplicateOC(oc); }}
        />
      )}
      {recepcionOC && (
        <RecepcionOCModal
          oc={recepcionOC}
          onClose={() => setRecepcionOC(null)}
          onDone={() => { setRecepcionOC(null); forceRender(n => n + 1); }}
        />
      )}

      {tab === 'proveedores' && (
        <div className="tbl-wrap">
          <div className="tbl-toolbar">
            <input className="input search" placeholder="Buscar..." style={{width:280}} value={searchP} onChange={e=>{setSearchP(e.target.value);setPageP(1);setSelP(new Set());}}/>
            <span className="ml-auto small">{provRows.length} proveedores{selP.size>0?` · ${selP.size} seleccionados`:''}</span>
          </div>
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{width:36,padding:'4px 10px'}}>
                    <input type="checkbox"
                      ref={el=>{if(el)el.indeterminate=selP.size>0&&selP.size<pagProv.length;}}
                      checked={pagProv.length>0&&selP.size===pagProv.length}
                      onChange={tgAllP} style={{cursor:'pointer'}}/>
                  </th>
                  <th>Proveedor</th><th className="hide-sm">RIF</th><th className="hide-sm">País</th><th className="hide-sm">Contacto</th><th className="hide-sm">Categorías</th><th className="num hide-sm">Días pago</th><th className="num">Deuda</th><th className="dt-hide-mobile">Creado por</th>
                </tr>
              </thead>
              <tbody>
                {pagProv.map(p => {
                  const isSel = selP.has(p.id);
                  return (
                    <tr key={p.id}
                      onClick={e=>{if(selP.size>0){tgOneP(p.id,e);}else{setDetalleProv(p);}}}
                      style={{cursor:'pointer',background:isSel?'var(--brand-soft)':''}}>
                      <td style={{padding:'4px 10px',width:36}} onClick={e=>tgOneP(p.id,e)}>
                        <input type="checkbox" checked={isSel} onChange={()=>{}} style={{cursor:'pointer',pointerEvents:'none'}}/>
                      </td>
                      <td>
                        <div style={{fontWeight:500}}>{p.nombre}</div>
                        <div className="show-sm-only small" style={{marginTop:3, display:'flex', flexWrap:'wrap', gap:5, alignItems:'center'}}>
                          <span className="mono" style={{fontSize:11, color:'var(--text-muted)'}}>{p.rif}</span>
                          {p.pais && <span className="muted" style={{fontSize:11}}>· {p.pais}</span>}
                          {p.diasPago != null && <span className="chip neutral" style={{fontSize:10, padding:'1px 6px'}}>{p.diasPago}d pago</span>}
                        </div>
                      </td>
                      <td className="mono-cell hide-sm">{p.rif}</td>
                      <td className="hide-sm"><span className="chip neutral">{p.pais}</span></td>
                      <td className="hide-sm"><div>{p.contacto}</div><div className="small mono">{p.email}</div></td>
                      <td className="hide-sm">
                        <div className="flex gap-2" style={{flexWrap:'wrap'}}>
                          {(Array.isArray(p.categorias)?p.categorias:[]).slice(0,2).map(c => <span key={c} className="chip blue" style={{fontSize:10}}>{c}</span>)}
                          {(Array.isArray(p.categorias)?p.categorias:[]).length > 2 && <span className="small">+{p.categorias.length-2}</span>}
                        </div>
                      </td>
                      <td className="num hide-sm">{p.diasPago}d</td>
                      {(() => {
                        // Deuda real desde CxP (p.deuda es siempre 0). Rojo solo si hay saldo.
                        const deuda = deudaPorProv[p.id] || 0;
                        return <td className="num strong-num" style={{color: deuda > 0 ? 'var(--danger)' : 'var(--text-muted)'}}>{fmt.usd(deuda)}</td>;
                      })()}
                      <td className="dt-hide-mobile"><CreadoPorCell nombre={p.creado_por}/></td>
                    </tr>
                  );
                })}
                {pagProv.length===0&&<tr><td colSpan={9} className="empty">Sin proveedores</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px',borderTop:'1px solid var(--border)',fontSize:12,gap:10,flexWrap:'wrap'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span className="muted">Filas por página:</span>
              <select className="select" value={pageSize} onChange={e=>{setPageSize(parseInt(e.target.value));setPageP(1);}} style={{fontSize:12,padding:'3px 6px'}}>
                {PAGE_SIZE_OPTS.map(n=><option key={n} value={n}>{n}</option>)}
              </select>
              <span className="muted">{provRows.length===0?'0':`Mostrando ${(pageP-1)*pageSize+1}–${Math.min(pageP*pageSize,provRows.length)} de ${provRows.length}`}</span>
            </div>
            {totalPP>1&&<div style={{display:'flex',gap:4}}>
              <button className="btn ghost sm" disabled={pageP===1} onClick={()=>setPageP(p=>p-1)}><Icon name="chevronL" size={13}/></button>
              {Array.from({length:Math.min(5,totalPP)},(_,i)=>Math.max(1,Math.min(totalPP-4,pageP-2))+i).filter(p=>p>=1&&p<=totalPP).map(p=>(
                <button key={p} className={'btn sm '+(p===pageP?'primary':'ghost')} style={{minWidth:32}} onClick={()=>setPageP(p)}>{p}</button>
              ))}
              <button className="btn ghost sm" disabled={pageP===totalPP} onClick={()=>setPageP(p=>p+1)}><Icon name="chevronR" size={13}/></button>
            </div>}
          </div>
        </div>
      )}

      {tab === 'oc' && ocSubTab === 'ordenes' && (
        /* ── Filtro de estado: control segmentado con contadores ────
           Reemplaza el viejo "pipeline" de círculos (parecía un stepper de
           flujo). Una sola fuente de verdad del filtro de estado: pills unidas,
           accesibles (button + aria-pressed), con el conteo real por estado.
           'Recepción' ya NO vive acá: es una vista propia (pestaña real). */
        <div style={{padding:'10px 16px', borderBottom:'1px solid var(--border)', background:'var(--bg-elev)'}}>
          <div className="ocfilter" role="group" aria-label="Filtrar órdenes por estado">
            {[
              { key:'',                      label:'Todas',       color:'var(--brand)' },
              { key:'borrador',              label:'Borrador',    color:'var(--text-muted)' },
              { key:'confirmada',            label:'Confirmada',  color:'var(--brand)' },
              { key:'tránsito',              label:'En tránsito', color:'var(--accent)' },
              { key:'parcialmente recibida', label:'Parcial',     color:'oklch(0.45 0.18 295)' },
              { key:'recibida',              label:'Recibida',    color:'var(--success)' },
              { key:'cancelada',             label:'Cancelada',   color:'var(--danger)' },
            ].map(s => {
              const allOCs = SSData.ordenesCompra || [];
              const count = s.key === '' ? allOCs.length : allOCs.filter(o => o.estado === s.key).length;
              const isActive = filterEstadoOC === s.key;
              return (
                <button key={s.key || 'all'} type="button"
                  className={isActive ? 'on' : ''}
                  aria-pressed={isActive}
                  aria-label={`Filtrar por estado: ${s.label} (${count})`}
                  style={{ '--ocf-color': s.color }}
                  /* 'Todas' resetea SOLO el filtro de estado; búsqueda, proveedor
                     y fechas se preservan (el botón 'Limpiar' limpia todo). */
                  onClick={() => { setFilterEstadoOC(s.key); setPageOC(1); }}>
                  <span className="ocf-lbl">{s.label}</span>
                  <span className="ocf-cnt">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'oc' && ocSubTab === 'recepcion' && (
        /* ── Pestaña Recepción ───────────────────────────────────── */
        <div className="tbl-wrap">
          <div style={{padding:'12px 16px', borderBottom:'1px solid var(--border)', background:'var(--bg-sunken)'}}>
            <div style={{fontWeight:600, fontSize:13}}>Órdenes pendientes de recepción</div>
            <div className="muted" style={{fontSize:12}}>Seleccioná una OC confirmada o en tránsito para registrar la entrada de mercancía al almacén</div>
          </div>
          {(() => {
            const pendientes = (SSData.ordenesCompra || []).filter(o =>
              ['confirmada', 'tránsito', 'parcialmente recibida'].includes(o.estado)
            );
            if (pendientes.length === 0) return (
              <div style={{padding:'48px 24px', textAlign:'center', color:'var(--text-muted)'}}>
                <div style={{fontSize:32, marginBottom:8}}>📦</div>
                <div style={{fontWeight:600, fontSize:14}}>Sin órdenes pendientes</div>
                <div style={{fontSize:13, marginTop:4}}>Todas las OC confirmadas ya fueron recibidas</div>
              </div>
            );
            return (
              <div style={{display:'flex', flexDirection:'column', gap:0}}>
                {pendientes.map((o, idx) => {
                  const prov = SSData.proveedores.find(p => p.id === (o.proveedor_id || o.proveedor));
                  const items = Array.isArray(o.items) ? o.items : [];
                  const esVencida = o.eta && o.eta < window.localDateStr();
                  const esParcial = o.estado === 'parcialmente recibida';
                  const estadoCol = o.estado === 'tránsito' ? '#f59e0b' : esParcial ? '#8b5cf6' : 'var(--brand)';
                  return (
                    <div key={o.id} style={{display:'flex', alignItems:'center', gap:14, padding:'14px 16px', borderBottom:'1px solid var(--border)', background: esVencida ? '#fffbeb' : ''}}>
                      <div style={{flex:1, minWidth:0}}>
                        <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                          <span style={{fontFamily:'monospace', fontWeight:700, fontSize:14, color:'var(--brand)'}}>{o.id}</span>
                          <span className="chip" style={{background:estadoCol+'20', color:estadoCol, fontSize:11}}>{o.estado}</span>
                          {esVencida && <span className="chip" style={{background:'#fef3c7', color:'#92400e', fontSize:11}}>⚠ ETA vencida</span>}
                          {esParcial && <span className="chip" style={{background:'#ede9fe', color:'#7c3aed', fontSize:11}}>Parcialmente recibida</span>}
                        </div>
                        <div style={{fontSize:13, marginTop:4, fontWeight:500}}>{prov?.nombre || '—'}</div>
                        <div style={{fontSize:12, color:'var(--text-muted)', marginTop:2, display:'flex', gap:12, flexWrap:'wrap'}}>
                          <span>Emitida: {fmt.date(o.fecha)}</span>
                          {o.eta && <span style={{color: esVencida ? '#92400e' : ''}}>ETA: {fmt.date(o.eta)}</span>}
                          <span>{items.length} ítem{items.length!==1?'s':''}</span>
                          <span style={{fontFamily:'monospace', fontWeight:600}}>{fmt.usd(o.monto)}</span>
                        </div>
                      </div>
                      <div style={{display:'flex', gap:8, flexShrink:0}}>
                        <button className="btn ghost sm" onClick={()=>setSelectedOC(o)}>Ver OC</button>
                        {window.canUser?.('editar','suppliers') !== false && (
                        <button className="btn primary sm" onClick={()=>setRecepcionOC(o)}>
                          <Icon name="check" size={13}/>Recibir
                        </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          {/* Recepciones recientes */}
          {(() => {
            const recibidas = (SSData.ordenesCompra || []).filter(o => o.estado === 'recibida').slice(0, 10);
            if (recibidas.length === 0) return null;
            return (
              <div>
                <div style={{padding:'10px 16px', borderTop:'2px solid var(--border)', borderBottom:'1px solid var(--border)', background:'var(--bg-sunken)', fontWeight:600, fontSize:12, color:'var(--text-muted)'}}>
                  RECEPCIONES COMPLETADAS RECIENTES
                </div>
                {recibidas.map(o => {
                  const prov = SSData.proveedores.find(p => p.id === (o.proveedor_id || o.proveedor));
                  return (
                    <div key={o.id} style={{display:'flex', alignItems:'center', gap:14, padding:'10px 16px', borderBottom:'1px solid var(--border)', opacity:0.75}}>
                      <div style={{flex:1}}>
                        <div style={{display:'flex', alignItems:'center', gap:8}}>
                          <span style={{fontFamily:'monospace', fontWeight:700, fontSize:13, color:'var(--brand)'}}>{o.id}</span>
                          <span className="chip green" style={{fontSize:11}}>Recibida</span>
                        </div>
                        <div style={{fontSize:12, color:'var(--text-muted)', marginTop:2}}>{prov?.nombre} · {fmt.usd(o.monto)}</div>
                      </div>
                      <button className="btn ghost sm" onClick={()=>setSelectedOC(o)}>Ver detalle</button>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {tab === 'oc' && ocSubTab === 'ordenes' && (
        <div className="tbl-wrap">
          {/* Barra de búsqueda y filtros */}
          <div style={{padding:'10px 14px', borderBottom:'1px solid var(--border)', display:'flex', flexWrap:'wrap', gap:8, alignItems:'center'}}>
            <input
              className="input" placeholder="Buscar por N° OC, proveedor o N° doc. proveedor…"
              style={{flex:'1 1 200px', minWidth:160, padding:'5px 10px', fontSize:13}}
              value={searchOC} onChange={e=>{setSearchOC(e.target.value);setPageOC(1);}}/>
            <select className="select" style={{fontSize:13, padding:'5px 8px', minWidth:150}}
              value={filterProvOC} onChange={e=>{setFilterProvOC(e.target.value);setPageOC(1);}}>
              <option value="">Todos los proveedores</option>
              {SSData.proveedores.map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            {/* El filtro de estado vive ahora en el control segmentado de arriba
               (única fuente de verdad); se eliminó el dropdown redundante. */}
            <input className="input" type="date" title="Fecha desde"
              style={{fontSize:13, padding:'5px 8px', width:140}}
              value={filterFechaDesde} onChange={e=>{setFilterFechaDesde(e.target.value);setPageOC(1);}}/>
            <input className="input" type="date" title="Fecha hasta"
              style={{fontSize:13, padding:'5px 8px', width:140}}
              value={filterFechaHasta} onChange={e=>{setFilterFechaHasta(e.target.value);setPageOC(1);}}/>
            {(searchOC||filterProvOC||filterEstadoOC||filterFechaDesde||filterFechaHasta) && (
              <button className="btn ghost sm" onClick={()=>{setSearchOC('');setFilterProvOC('');setFilterEstadoOC('');setFilterFechaDesde('');setFilterFechaHasta('');setPageOC(1);}}>
                <Icon name="x" size={13}/>Limpiar
              </button>
            )}
          </div>
          <div className="tbl-toolbar">
            {/* Los conteos por estado ya están en el control segmentado; acá solo
               el resultado del filtrado activo y la selección. */}
            {ocRows.length !== (SSData.ordenesCompra||[]).length && (
              <span className="chip neutral">{ocRows.length} resultado{ocRows.length!==1?'s':''}</span>
            )}
            <span className="ml-auto small">{selOC.size>0?`${selOC.size} seleccionadas`:''}</span>
          </div>
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{width:36,padding:'4px 10px'}}>
                    <input type="checkbox"
                      ref={el=>{if(el)el.indeterminate=selOC.size>0&&selOC.size<pagOC.length;}}
                      checked={pagOC.length>0&&selOC.size===pagOC.length}
                      onChange={tgAllOC} style={{cursor:'pointer'}}/>
                  </th>
                  <th>OC</th><th className="hide-sm">Proveedor</th><th className="hide-sm">Doc. Prov.</th><th className="hide-sm">Emitida</th><th className="hide-sm">ETA</th><th>Estado</th><th className="num hide-sm">Items</th><th className="num">Monto</th><th className="dt-hide-mobile">Creado por</th>
                </tr>
              </thead>
              <tbody>
                {pagOC.map(o => {
                  const prov = SSData.proveedores.find(p => p.id === o.proveedor);
                  const isSel = selOC.has(o.id);
                  return (
                    <tr key={o.id}
                      onClick={e=>{if(selOC.size>0){tgOneOC(o.id,e);}else{setSelectedOC(o);}}}
                      style={{cursor:'pointer',background:isSel?'var(--brand-soft)':''}}>
                      <td style={{padding:'4px 10px',width:36}} onClick={e=>tgOneOC(o.id,e)}>
                        <input type="checkbox" checked={isSel} onChange={()=>{}} style={{cursor:'pointer',pointerEvents:'none'}}/>
                      </td>
                      <td>
                        <div style={{fontFamily:'monospace', fontWeight:700, fontSize:13, letterSpacing:'0.03em', color:'var(--brand)'}}>{o.id}</div>
                        <div className="show-sm-only small muted" style={{fontSize:11, marginTop:2}}>{prov?.nombre}{o.doc_proveedor ? ` · Doc ${o.doc_proveedor}` : ''} · {fmt.date(o.eta)}</div>
                      </td>
                      <td className="hide-sm" style={{fontWeight:500}}>{prov?.nombre}</td>
                      <td className="hide-sm muted" style={{fontFamily:'monospace', fontSize:12}}>{o.doc_proveedor || '—'}</td>
                      <td className="muted hide-sm">{fmt.date(o.fecha)}</td>
                      <td className="muted hide-sm">{fmt.date(o.eta)}</td>
                      <td>
                        <StatusChip estado={o.estado}/>
                      </td>
                      <td className="num hide-sm">{Array.isArray(o.items) ? (o.items.length || o.items_count || 0) : (o.items_count || o.items || 0)}</td>
                      <td className="num strong-num">{fmt.usd(o.monto)}</td>
                      <td className="dt-hide-mobile"><CreadoPorCell nombre={o.creado_por}/></td>
                    </tr>
                  );
                })}
                {pagOC.length===0&&<tr><td colSpan={10} className="empty">Sin órdenes de compra</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px',borderTop:'1px solid var(--border)',fontSize:12,gap:10,flexWrap:'wrap'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span className="muted">Filas por página:</span>
              <select className="select" value={pageSize} onChange={e=>{setPageSize(parseInt(e.target.value));setPageOC(1);}} style={{fontSize:12,padding:'3px 6px'}}>
                {PAGE_SIZE_OPTS.map(n=><option key={n} value={n}>{n}</option>)}
              </select>
              <span className="muted">{ocRows.length===0?'0':`Mostrando ${(pageOC-1)*pageSize+1}–${Math.min(pageOC*pageSize,ocRows.length)} de ${ocRows.length}`}</span>
            </div>
            {totalOCP>1&&<div style={{display:'flex',gap:4}}>
              <button className="btn ghost sm" disabled={pageOC===1} onClick={()=>setPageOC(p=>p-1)}><Icon name="chevronL" size={13}/></button>
              {Array.from({length:Math.min(5,totalOCP)},(_,i)=>Math.max(1,Math.min(totalOCP-4,pageOC-2))+i).filter(p=>p>=1&&p<=totalOCP).map(p=>(
                <button key={p} className={'btn sm '+(p===pageOC?'primary':'ghost')} style={{minWidth:32}} onClick={()=>setPageOC(p)}>{p}</button>
              ))}
              <button className="btn ghost sm" disabled={pageOC===totalOCP} onClick={()=>setPageOC(p=>p+1)}><Icon name="chevronR" size={13}/></button>
            </div>}
          </div>
        </div>
      )}

      {activeSelected.size>0&&(
        <div className="docs-bulk-bar" style={{position:'fixed',bottom:28,left:'50%',transform:'translateX(-50%)',background:'var(--bg-elev)',border:'1px solid var(--border)',borderRadius:16,boxShadow:'0 12px 40px rgba(0,0,0,.35)',display:'flex',alignItems:'center',gap:6,padding:'10px 14px',zIndex:300,backdropFilter:'blur(12px)',flexWrap:'wrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,paddingRight:10,borderRight:'1px solid var(--border)',marginRight:4}}>
            <div style={{width:24,height:24,borderRadius:8,background:'var(--brand)',display:'grid',placeItems:'center',color:'#fff',fontSize:11,fontWeight:700}}>{activeSelected.size}</div>
            <span style={{fontSize:13,fontWeight:600}}>{activeSelected.size} seleccionado{activeSelected.size!==1?'s':''}</span>
          </div>
          {tab==='oc' && window.canUser?.('editar','suppliers') !== false && (<>
            <span className="muted" style={{fontSize:11,paddingRight:2}}>Cambiar estado:</span>
            <button className="btn ghost sm" style={{color:'var(--brand)',borderColor:'var(--brand)'}} onClick={()=>bulkChangeEstadoOC('confirmada')}>Confirmada</button>
            <button className="btn ghost sm" style={{color:'var(--accent)',borderColor:'var(--accent)'}} onClick={()=>bulkChangeEstadoOC('tránsito')}>En tránsito</button>
            {/* 'Recibida' se quitó: debe ir por el flujo de recepción (CxP + inventario + seriales). */}
            <button className="btn ghost sm" style={{color:'var(--danger)',borderColor:'var(--danger)'}} onClick={()=>bulkChangeEstadoOC('cancelada')}>Cancelada</button>
            <div style={{width:1,height:20,background:'var(--border)',margin:'0 2px'}}/>
          </>)}
          <button className="btn ghost sm" onClick={bulkExportXLSX}><Icon name="download" size={13}/>Exportar Excel</button>
          {window.canUser?.('eliminar','suppliers') !== false && <button className="btn ghost sm" onClick={bulkDelete} style={{color:'var(--danger)'}}><Icon name="trash" size={13}/>Eliminar</button>}
          <button className="icon-btn" onClick={()=>{setSelP(new Set());setSelOC(new Set());}} style={{marginLeft:4}}><Icon name="x" size={15}/></button>
        </div>
      )}
    </div>
  );
};

// Celda "Creado por": avatar del usuario que creó el registro; si fue el sistema
// (migración: creado_por null/"Sistema") muestra un avatar de sistema (gris + ícono).
function CreadoPorCell({ nombre }) {
  const esSistema = !nombre || nombre === 'Sistema' || nombre === 'sistema';
  if (esSistema) {
    return (
      <div title="Creado por el sistema (migración)" style={{display:'flex', alignItems:'center', gap:6}}>
        <div className="user-avatar" style={{width:22, height:22, background:'#64748b', display:'grid', placeItems:'center'}}>
          <Icon name="settings" size={12} style={{color:'#fff'}}/>
        </div>
        <span className="small muted hide-sm">Sistema</span>
      </div>
    );
  }
  const u = (SSData.usuarios || []).find(x => x.nombre === nombre);
  const user = u || { nombre, avatar:'#64748b', iniciales: nombre.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) };
  return (
    <div title={nombre} style={{display:'flex', alignItems:'center', gap:6}}>
      <Avatar user={user} size={22}/>
      <span className="small hide-sm" style={{maxWidth:110, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{nombre}</span>
    </div>
  );
}

// Enlace "ver el movimiento bancario de este pago" (CxP/CxC → /banco/{cuenta}).
// El id de transacción viaja por sessionStorage porque la navegación cambia de ruta y monta otro
// componente (BankDetailView lo lee, filtra por ese id y resalta la fila).
function irAMovimientoBancario(cuentaId, movId) {
  if (!movId) return;
  try { sessionStorage.setItem('ss-bank-focus', JSON.stringify({ cuentaId: cuentaId || null, movId })); } catch (e) {}
  if (!cuentaId) { alert('Este pago no tiene una cuenta bancaria asociada, así que no se puede abrir el movimiento.'); return; }
  if (window.__ssNavigate) { window.__ssNavigate('/banco/' + cuentaId); return; }
  history.pushState(null, '', (window.ssBase ? window.ssBase('/' + (window.currentEmpresa || 'demo1') + '/banco/' + cuentaId) : ('/' + (window.currentEmpresa || 'demo1') + '/banco/' + cuentaId)));
  window.dispatchEvent(new PopStateEvent('popstate'));
}
// Expuesto en window: otros chunks lazy (ej. anticipos.jsx) se compilan como IIFE aparte y no ven
// esta función de módulo — lo mismo que pasó con `navigate` (ver CLAUDE.md "Ojo con navigate").
window.irAMovimientoBancario = irAMovimientoBancario;

window.CxCPage = function CxCPage() {
  return <AccountsPage tipo="cobrar"/>;
};
window.CxPPage = function CxPPage() {
  return <AccountsPage tipo="pagar"/>;
};

function AccountsPage({ tipo }) {
  const esCobrar = tipo === 'cobrar';
  // Para el selector de columnas (mostrar/ocultar y ancho). Ver `window.TablaColumnas`.
  const tablaCuentasRef = React.useRef(null);
  const rows = esCobrar ? SSData.cuentasCobrar : SSData.cuentasPagar;
  const entities = esCobrar ? SSData.clientes : SSData.proveedores;
  const title = esCobrar ? 'Cuentas por Cobrar' : 'Cuentas por Pagar';
  const entLabel = esCobrar ? 'Cliente' : 'Proveedor';
  const entKey = esCobrar ? 'cliente' : 'proveedor';
  // Los filtros se RECUERDAN por módulo: cambiar de pantalla y volver ya no los borra.
  const fk = (n) => `ss-${tipo === 'cobrar' ? 'cxc' : 'cxp'}-f-${n}`;
  const [filterTab, setFilterTab] = window.usePersistedState(fk('tab'), 'pendientes');
  const [sel, setSel] = useState(null);
  const [payEntity, setPayEntity] = useState(null);
  const [pickPago, setPickPago]   = useState(false);   // selector de a quién cobrar/pagar
  const [selected, setSelected]   = useState(new Set());
  const [page, setPage]           = useState(1);
  const [showActivity, setShowActivity] = useState(false);
  const [showMermas, setShowMermas] = useState(false);
  // Orden por defecto de CADA pestaña: al abrirla tiene que estar arriba lo que se viene a ver.
  // Pendientes → vencimiento; Pagados/Cobrados → la fecha del pago/cobro; Todas → lo último cargado
  // (emisión en CxC; creación en CxP, que no tiene emisión propia). Siempre descendente.
  const ordenPorTab = (tab) => {
    if (tab === 'pagados') return { field: 'fechaCobro', dir: 'desc' };
    if (tab === 'todos')   return { field: esCobrar ? 'emision' : 'creacion', dir: 'desc' };
    return { field: 'vence', dir: 'desc' };
  };
  // El orden NO se recuerda entre visitas (los filtros y la búsqueda sí): lo fija la pestaña, que es
  // lo pedido. Dentro de la visita el usuario puede reordenar clicando la cabecera.
  // El orden vive junto a la pestaña a la que pertenece. Así, al cambiar de pestaña, el orden nuevo
  // ya vale en el MISMO render: con un efecto que lo ajustaba después, entrar a "Cobrados" —que es
  // server-paginada— pedía la página DOS veces (una con el orden de la pestaña anterior, que se
  // descartaba). Lo detectó la traza de pestañas del banco de pruebas.
  const [orden, setOrden] = useState(() => ({ tab: filterTab, ...ordenPorTab(filterTab) }));
  const ordenEfectivo = orden.tab === filterTab ? orden : ordenPorTab(filterTab);
  const sortField = ordenEfectivo.field;
  const sortDir   = ordenEfectivo.dir;
  useEffect(() => {   // limpia las claves de cuando el orden se persistía
    try { localStorage.removeItem(fk('sortf')); localStorage.removeItem(fk('sortd')); } catch (e) {}
  }, []);
  const [showNueva, setShowNueva] = useState(false);
  const [version, setVersion]     = useState(0);
  // Al registrar un pago/cobro, loadAppData() dispara su Fase 2 (cuentas, bancos, movimientos) en
  // background sin esperarla — este listener fuerza el re-render cuando esa fase realmente termina,
  // igual que BankPage, así la lista y el % cobrado quedan al día sin refrescar la página manualmente.
  // Agrupado por tanda (ssOnDatos): las cuentas se re-filtran, re-ordenan y se les recalcula el
  // aging en cada render, y los datos llegan en varias tandas seguidas.
  useEffect(() => window.ssOnDatos(() => setVersion(v => v + 1)), []);
  const moduloId = esCobrar ? 'cxc' : 'cxp';
  const [pageSize, setPageSize] = useState(() => loadPageSize(moduloId, 50));
  useEffect(() => { localStorage.setItem('ss-' + moduloId + '-pagesize', String(pageSize)); }, [pageSize, moduloId]);
  const [search, setSearch] = window.usePersistedState(fk('search'), '');
  // Agrupación de la tabla (persistida por módulo): ''|entidad|modalidad|estado
  const [groupBy, setGroupBy] = useState(() => { try { return localStorage.getItem('ss-'+moduloId+'-groupby') || ''; } catch { return ''; } });
  useEffect(() => { try { localStorage.setItem('ss-'+moduloId+'-groupby', groupBy); } catch {} }, [groupBy, moduloId]);
  // "Agrupar por día de cobro" solo existe en la pestaña de saldados: en las demás, la fecha de
  // cobro está vacía y TODAS las filas caerían en un grupo "— Sin cobrar". Se suelta al salir (y al
  // arrancar, porque el agrupado se recuerda en localStorage y podría venir de la sesión anterior).
  const [expandedG, setExpandedG] = useState(new Set());
  // Filtro por categoría: VARIAS a la vez. Lista vacía = todas (no "ninguna"), que es lo que
  // espera quien nunca tocó el filtro. `'__sin__'` representa las cuentas sin categoría.
  // Al pasar de string a arreglo, `usePersistedState` descarta solo lo guardado con la forma vieja.
  const [catF, setCatF] = window.usePersistedState(fk('categorias'), []);
  const [catOpen, setCatOpen] = useState(false);
  // El panel se porta a document.body (mismo patrón que SearchSelect en core.jsx) — antes era
  // `position:absolute` dentro del propio contenedor de filtros, y cualquier ancestro con
  // overflow (el wrapper de scroll horizontal de la tabla) lo recortaba por abajo, dejándolo
  // "metido" detrás de la tabla en vez de flotar libre sobre todo (reportado 2026-08-16).
  const catBtnRef = React.useRef(null);
  const [catPos, setCatPos] = useState(null);
  React.useLayoutEffect(() => {
    if (!catOpen || !catBtnRef.current) { setCatPos(null); return; }
    function calc() {
      const r = catBtnRef.current.getBoundingClientRect();
      const width = Math.max(r.width, 240);
      const espacioAbajo = window.innerHeight - r.bottom;
      const arriba = espacioAbajo < 320 && r.top > 320;
      setCatPos({
        left: Math.min(r.left, window.innerWidth - width - 8),
        width,
        top: arriba ? null : r.bottom + 4,
        bottom: arriba ? (window.innerHeight - r.top + 4) : null,
      });
    }
    calc();
    window.addEventListener('scroll', calc, true);
    window.addEventListener('resize', calc);
    return () => { window.removeEventListener('scroll', calc, true); window.removeEventListener('resize', calc); };
  }, [catOpen]);
  // Edición inline de la categoría en la tabla: qué fila está abierta y cuál se está guardando.
  const [catEdit, setCatEdit] = useState(null);
  const [catSaving, setCatSaving] = useState(null);
  const [catVersion, setCatVersion] = useState(0);   // fuerza el repintado tras guardar
  // Rango de fechas (inclusive). No se persiste: es un filtro de sesión.
  const [fechaDesde, setFechaDesde] = window.usePersistedState(fk('desde'), '');
  const [fechaHasta, setFechaHasta] = window.usePersistedState(fk('hasta'), '');
  // Qué fecha filtra el rango. En Pendientes solo tiene sentido el vencimiento; en Cobrados/Pagados
  // lo que se busca es CUÁNDO entró (o salió) la plata, así que ahí arranca en la fecha de cobro/pago
  // y se puede volver al vencimiento con el selector.
  const [fechaCampo, setFechaCampo] = window.usePersistedState(fk('fcampo'), 'cobro');   // 'cobro' | 'vence'
  // Mismo problema fuera de la pestaña de saldados, pero solo pedido para CxP: "vencimiento" y
  // "creación" (cuándo se cargó la cuenta) son preguntas distintas y antes el rango SIEMPRE
  // filtraba por vencimiento sin poder elegir. CxC no lo pidió — se deja igual (además ahí
  // "creación" es menos útil: la fecha del negocio es la emisión, que ya se ordena por defecto).
  const [fechaCampoPend, setFechaCampoPend] = window.usePersistedState(fk('fcampop'), 'vence');   // 'vence' | 'creacion'
  // Filtro de IVA. Por MONTO, no por `documentos.aplica_iva`: esa bandera está en true en 1.386 de
  // las 1.445 cuentas por ser el default de la columna, así que filtrar por ella no filtraría nada.
  const [ivaF, setIvaF] = window.usePersistedState(fk('iva'), '');   // '' | 'con' | 'sin'
  // Cobradas (facturas pagadas) — NO están en cuentas_cobrar; se cargan on-demand al abrir la pestaña.
  const [cobrados, setCobrados]           = useState(null);   // null = aún no cargadas (full-load: agrupar/buscar)
  const [cobradosLoading, setCobradosLoading] = useState(false);
  const [cobradosPag, setCobradosPag]     = useState({ rows: [], total: 0 }); // paginado server-side
  const [cobradosPagLoading, setCobradosPagLoading] = useState(false);
  const [resumen, setResumen]             = useState(null);   // agregado server-side (% cobrado real)
  // Pestaña "Cobrados": server-paginada en la vista por defecto (sin agrupar/buscar y orden
  // server-sortable). Cuando se agrupa/busca/ordena por entidad → full-load (necesita todo el set).
  // ── Facturas cobradas que todavía NO salieron del almacén ──────────────────────────────────
  // Reportado el 2026-08-07: al registrar el cobro la factura se va de "Pendientes" y no queda en
  // ningún lado que diga "pagada pero sin despachar" — en "Cobrados" se ve perfectamente sana.
  // Los ids salen de `SSData.docsTrabados` (RPC `get_documentos_trabados`, ya cargada al arrancar),
  // que lo resuelve por LINAJE: ¿existe un despacho vivo colgando de esta factura? La columna
  // `estado_despacho` no sirve — mintió en las migraciones 11 y 19 y hoy hay 396 facturas en
  // 'no_aplica' que sí tienen despacho.
  const [trabVersion, setTrabVersion] = useState(0);
  useEffect(() => window.ssOnDatos?.(() => setTrabVersion(v => v + 1)), []);
  // Sin umbral de días: acá se quiere ver desde el minuto cero. El panel del flujo y la campana
  // sí filtran por antigüedad, para no gritar por la operación del día.
  const sinDespachar = React.useMemo(() => {
    if (!esCobrar) return [];
    void trabVersion;
    return (SSData.docsTrabados || []).filter(d => d.tipo === 'factura');
  }, [esCobrar, trabVersion]);
  const sinDespacharIds = React.useMemo(() => new Set(sinDespachar.map(d => d.id)), [sinDespachar]);
  // Órdenes confirmadas que nunca se facturaron. Vivían solo en Flujo de documentos y el usuario
  // pidió tenerlas acá: es plata comprometida que todavía no llegó a ser una cuenta por cobrar —
  // al 2026-08-07, $35.646 en `demo1`. Es la venta ANTES de la cartera, y quien mira la cartera
  // es el que puede reclamarla.
  const sinFacturar = React.useMemo(() => {
    if (!esCobrar) return [];
    void trabVersion;
    return (SSData.docsTrabados || []).filter(d => d.tipo === 'orden');
  }, [esCobrar, trabVersion]);

  // "Cobrados" y "Todas" de CxC se sirven del server (sobre `documentos`). "Todas" pasó a hacerlo
  // en la migración 84: leía `cuentas_cobrar` y por eso mostraba 1.142 —las cuentas del módulo—
  // cuando la pestaña de al lado mostraba 25.342 facturas cobradas. Una pestaña llamada "Todas" que
  // muestra menos que "Cobrados" se contradice sola.
  const usaCobrados = esCobrar && (filterTab === 'pagados' || filterTab === 'todos');
  // Pestaña de saldados (Cobrados en CxC / Pagados en CxP): ahí va la columna de fecha de cobro/pago
  // en lugar de "Progreso" (que en una cuenta saldada siempre es 100%: no informa nada).
  const esTabSaldados = filterTab === 'pagados';
  const esTabTodas = filterTab === 'todos';
  // Ver el comentario de `groupBy`: fuera de la pestaña de saldados, agrupar por día de cobro
  // metería todas las filas en "— Sin cobrar".
  useEffect(() => { if (groupBy === 'dia_cobro' && !esTabSaldados) setGroupBy(''); }, [esTabSaldados, groupBy]);
  // (El orden por pestaña se resuelve arriba con `ordenEfectivo`: sin efecto, así no hay un render
  //  intermedio con el orden viejo que dispare una consulta al server que después se descarta.)
  const labelFechaPago = esCobrar ? 'Fecha cobro' : 'Fecha pago';
  // Campo de fecha efectivo del rango: fuera de la pestaña de saldados el rango es de vencimiento
  // por default — salvo en CxP, donde se puede elegir "creación" con `fechaCampoPend`.
  const fechaCampoEf = esTabSaldados ? fechaCampo : (!esCobrar ? fechaCampoPend : 'vence');
  // Sigue paginado también CON búsqueda y CON rango de fechas: eso ahora se resuelve en el
  // server (ver loadCuentasCobradas). Antes cualquiera de las dos cosas disparaba el full-load
  // de las 25.085 facturas cobradas — y escanear un código de barras es escribir + Enter, o sea
  // que el lector era la forma más rápida de bajarse la tabla entera.
  // Solo quedan en full-load los dos casos que de verdad necesitan todo el conjunto en memoria:
  // agrupar (los grupos se arman sobre el total, no sobre una página) y ordenar por nombre de
  // entidad (el nombre vive en `clientes`, no en `documentos`, así que el server no lo ordena).
  // `loadCuentasCobradasAll` solo sabe traer las cobradas, así que agrupar u ordenar por entidad
  // en "Todas" cae al camino de memoria (las cuentas del módulo) en vez de mentir con un subconjunto.
  const cobradosPaginado = usaCobrados && !groupBy && sortField !== 'entidad'
                           && (filterTab === 'pagados' || filterTab === 'todos');
  const todasServer = esCobrar && filterTab === 'todos' && cobradosPaginado;
  useEffect(() => {
    if (!esCobrar) return;
    window.getCxcResumen?.().then(r => setResumen(r));
  }, [esCobrar, version]);

  // Los nombres de las entidades de ESTAS filas se hidratan por id. CxC son 896 cuentas con 402
  // clientes distintos (3% del catálogo) y CxP 117 con 9 proveedores: bajar los 13.096 clientes
  // para mostrar 402 nombres era lo que hacía aparecer "Cargando clientes…" al entrar acá.
  useEffect(() => {
    if (!esCobrar) return;
    const ids = [...new Set((SSData.cuentasCobrar || []).map(c => c.cliente_id || c.cliente).filter(Boolean))];
    if (!ids.length) return;
    window.ensureClientes?.(ids).then(n => { if (n) setVersion(v => v + 1); });
  }, [esCobrar, SSData.cuentasCobrar]);
  // Full-load SOLO cuando se agrupa/busca/ordena por entidad (necesita el set completo).
  useEffect(() => {
    if (!usaCobrados || cobradosPaginado || cobrados !== null || filterTab === 'todos') return;
    let alive = true;
    setCobradosLoading(true);
    window.loadCuentasCobradasAll?.().then(rows => { if (alive) { setCobrados(rows || []); setCobradosLoading(false); } });
    return () => { alive = false; };
  }, [usaCobrados, cobradosPaginado, cobrados]);
  // Carga PAGINADA server-side de la página actual (vista por defecto de Cobrados).
  useEffect(() => {
    if (!cobradosPaginado || !window.loadCuentasCobradas) return;
    let alive = true;
    setCobradosPagLoading(true);
    const term = (search || '').trim();
    // El nombre del cliente se resuelve a ids contra el catálogo en memoria y se manda al
    // server; el término suelto igual busca por id de factura (que es lo que da el lector).
    const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const nq = norm(term);
    const clienteIds = term
      ? (SSData.clientes || []).filter(c => norm(c.nombre).includes(nq) || norm(c.rif).includes(nq)).map(c => c.id)
      : [];
    // Debounce solo si hay término: sin él no hace falta esperar (cambio de página/orden).
    // El rango de fechas viaja al server sobre el campo elegido: `fecha` (vencimiento) o
    // `fecha_cobro`. Son columnas distintas, no se pueden mandar en el mismo par de parámetros.
    const porCobro = fechaCampoEf === 'cobro';
    const lanzar = () => window.loadCuentasCobradas({ page, pageSize, sortField, sortDir,
                                                      incluirPendientes: filterTab === 'todos',
                                                      search: term || null, clienteIds,
                                                      fechaDesde: porCobro ? null : (fechaDesde || null),
                                                      fechaHasta: porCobro ? null : (fechaHasta || null),
                                                      cobroDesde: porCobro ? (fechaDesde || null) : null,
                                                      cobroHasta: porCobro ? (fechaHasta || null) : null })
      .then(r => { if (alive) { setCobradosPag(r || { rows: [], total: 0 }); setCobradosPagLoading(false); } })
      .catch(() => { if (alive) setCobradosPagLoading(false); });
    if (!term) { lanzar(); return () => { alive = false; }; }
    const t = setTimeout(lanzar, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [cobradosPaginado, page, pageSize, sortField, sortDir, version, search, fechaDesde, fechaHasta, fechaCampoEf]);

  useEffect(() => {
    const nav = window.__ssCmdNav;
    const kind = esCobrar ? 'CxC' : 'CxP';
    if (nav?.kind === kind && nav.id) {
      window.__ssCmdNav = null;
      const doc = rows.find(r => String(r.id) === String(nav.id));
      if (doc) {
        const ent = entities.find(e => e.id === doc[entKey]);
        setSel({ doc, ent });
      }
    }
  }, []);

  const totalPend = rows.reduce((s,r) => s + (r.monto - r.pagado), 0);
  const vencidas = rows.filter(r => r.estado === 'vencida');
  const totalVencido = vencidas.reduce((s,r) => s + (r.monto - r.pagado), 0);
  // Fix bug #41: si no hay cuentas (o todos los montos son 0) el denominador es 0 → NaN
  // ('NaN%' en el stat y width:NaN% en la barra). Guardamos el denominador.
  const _totalMonto = rows.reduce((s,r)=>s+r.monto,0);
  const pctCobrado = _totalMonto > 0 ? (rows.reduce((s,r)=>s+r.pagado,0) / _totalMonto) * 100 : 0;

  // Fuente de la pestaña: "Cobrados" (CxC) = facturas pagadas. En modo paginado viene la página
  // server-side; agrupando/buscando viene el full-load; el resto de cuentas desde memoria.
  const rowsTab = cobradosPaginado ? (todasServer ? cobradosPag.rows.map(f => {
                    // La fila server-side se arma desde la FACTURA y no conoce el cobro parcial ni
                    // los pagos: eso vive en `cuentas_cobrar`, y esas filas ya están en memoria.
                    // Sin este pisado, una cuenta cobrada a medias aparecería con saldo completo.
                    const enMemoria = rows.find(r => r.factura === f.factura || r.id === f.id);
                    return enMemoria ? { ...f, ...enMemoria } : f;
                  }) : cobradosPag.rows)
                : usaCobrados ? (cobrados || [])
                : rows.filter(r => {
                    // Con tolerancia de centavo: una cuenta con saldo 0,00 por redondeo está
                    // saldada, y mostrarla en "Pendientes" manda a alguien a perseguirla.
                    const isPagada = r.estado === 'pagada' || window.ssSaldada(r.pagado, r.monto);
                    if (filterTab === 'pendientes') return !isPagada;
                    if (filterTab === 'pagados')    return isPagada;
                    return true;
                  });

  // Fecha en que se cobró/pagó la cuenta.
  // CxC: `documentos.fecha_cobro`, columna denormalizada que mantiene un trigger (migracion-odoo/16)
  // — así se puede ordenar y filtrar con paginación server-side.
  // CxP: la fecha del ÚLTIMO pago del jsonb `pagos` (esas filas están completas en memoria).
  function fechaPagoDe(r) {
    if (!r) return null;
    if (r.fecha_cobro) return String(r.fecha_cobro).slice(0, 10);
    const fs = (Array.isArray(r.pagos) ? r.pagos : [])
      .map(p => (p && p.fecha ? String(p.fecha).slice(0, 10) : null)).filter(Boolean).sort();
    return fs.length ? fs[fs.length - 1] : null;
  }
  // El INSTANTE del cobro/pago, cuando se registró con hora. En CxC es `documentos.cobrado_at`
  // (columna par de `fecha_cobro`); en CxP, el `fecha_hora` del último pago del jsonb. Lo migrado
  // de Odoo no tiene hora: ahí devuelve null y la tabla muestra solo la fecha.
  function instantePagoDe(r) {
    if (!r) return null;
    if (r.cobrado_at) return r.cobrado_at;
    const ts = (Array.isArray(r.pagos) ? r.pagos : [])
      .map(p => (p && p.fecha_hora ? String(p.fecha_hora) : null)).filter(Boolean).sort();
    return ts.length ? ts[ts.length - 1] : null;
  }

  // Búsqueda: por ID, factura/concepto, nombre/RIF de la entidad, modalidad o estado.
  const rowsFiltradas = (() => {
    let base = rowsTab;
    // En modo paginado el SERVER ya aplicó búsqueda y fechas: volver a filtrar acá vaciaría la
    // tabla sin motivo. Una fila que el server encontró por `cliente_id` se descartaría si el
    // catálogo de clientes todavía no está en memoria (es diferido), y el server filtra por
    // `fecha` mientras esto compara `vence` — dos criterios distintos sobre los mismos datos.
    if (cobradosPaginado) return base;
    // Filtro por rango de fechas (inclusive) sobre el campo elegido: vencimiento o fecha de
    // cobro/pago. Fechas 'YYYY-MM-DD' → comparación de strings ISO.
    if (fechaDesde || fechaHasta) {
      base = base.filter(r => {
        const v = fechaCampoEf === 'cobro' ? fechaPagoDe(r)
                : fechaCampoEf === 'creacion' ? (r.created_at ? String(r.created_at).slice(0, 10) : null)
                : (r.vence ? String(r.vence).slice(0, 10) : null);
        if (!v) return false;
        if (fechaDesde && v < fechaDesde) return false;
        if (fechaHasta && v > fechaHasta) return false;
        return true;
      });
    }
    if (ivaF) {
      base = base.filter(r => (ivaF === 'con') === ((parseFloat(r.iva) || 0) > 0));
    }
    if (Array.isArray(catF) && catF.length) {
      base = base.filter(r => catF.includes(r.categoria || '__sin__'));
    }
    const q = search.trim();
    if (!q) return base;
    const norm = s => (s == null ? '' : String(s)).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const nq = norm(q);
    return base.filter(r => {
      const ent = entities.find(e => e.id === r[entKey] || e.id === r.cliente_id)
               || (SSData.clientes || []).find(c => c.id === r.cliente);
      return norm([r.id, r.factura, r.concepto, ent?.nombre, ent?.rif, r.modalidad_pago, r.estado, r.vendedor_nombre].filter(Boolean).join(' ')).includes(nq);
    });
  })();

  // Sorting
  function handleSort(field) {
    // El orden elegido queda atado a ESTA pestaña: al cambiar de pestaña vuelve a mandar su default.
    setOrden(sortField === field
      ? { tab: filterTab, field, dir: sortDir === 'asc' ? 'desc' : 'asc' }
      : { tab: filterTab, field, dir: 'asc' });
  }
  function sortVal(r, field) {
    if (field === 'entidad') {
      const isVuelto   = !esCobrar && r.tipo === 'vuelto';
      const isComision = !esCobrar && r.tipo === 'comision';
      const ent = isVuelto
        ? (SSData.clientes || []).find(c => c.id === r.cliente)
        : isComision
          ? { nombre: r.vendedor_nombre || '' }
          : entities.find(e => e.id === r[entKey]);
      return (ent?.nombre || '').toLowerCase();
    }
    if (field === 'saldo')    return r.monto - r.pagado;
    if (field === 'progreso') return r.monto > 0 ? r.pagado / r.monto : 0;
    if (field === 'fechaCobro') {
      // El día del cobro/pago manda, y la HORA desempata dentro de ese día (el instante puede caer
      // en otro día que la fecha del pago si se registró con fecha atrasada: ahí gana la del negocio).
      const f = fechaPagoDe(r);
      if (!f) return '';                       // '' ordena antes que cualquier fecha
      const ts = String(instantePagoDe(r) || '');
      return f + (ts.slice(0, 10) === f ? 'T' + ts.slice(11, 19) : '');
    }
    // Creación: el instante real si está, si no la fecha de emisión/vencimiento (lo migrado).
    if (field === 'creacion') return String(r.created_at || r.fecha_emision || r.fecha || r.vence || '');
    if (field === 'emision') {
      const f = String(r.fecha_emision || r.fecha || '');
      if (!f) return '';
      // La hora solo desempata DENTRO del mismo día: `created_at` puede caer en otro día que la
      // emisión (una cuenta cargada a mano con fecha atrasada) y no puede mandar sobre la fecha
      // del negocio. Se compara como texto ISO, que ordena cronológicamente.
      const ts = String(r.created_at || '');
      return f + (ts.slice(0, 10) === f ? 'T' + ts.slice(11, 19) : '');
    }
    if (field === 'vence')    return r.vence ? new Date(r.vence).getTime() : 0;
    if (field === 'estado')   return r.estado || '';
    if (field === 'creado')   return (r.creado_por || '').toLowerCase();
    if (field === 'factura')  return (r.factura || r.concepto || '').toLowerCase();
    if (field === 'id')       return (r.id || '').toLowerCase();
    if (field === 'modalidad') {
      if (!esCobrar && r.tipo === 'vuelto')   return 'zz_vuelto';
      if (!esCobrar && r.tipo === 'comision') return 'zz_comision';
      return r.modalidad_pago || 'divisas';
    }
    return r[field] ?? 0;
  }
  // El INSTANTE de la fila, para desempatar. Las columnas de fecha de estas tablas son `date`
  // (`vence`, `fecha_emision`, la fecha del pago), así que todas las filas del mismo día quedaban en
  // un orden arbitrario: con 40 cobros en una jornada, el más reciente podía salir décimo. La hora
  // existe desde la migración 24 y acá se usa como segunda clave, respetando la dirección elegida.
  // Prioridad: el instante del cobro/pago si la fila está saldada, si no cuándo se cargó la cuenta.
  function instanteDe(r) {
    return instantePagoDe(r) || r.created_at || r.cobrado_at || '';
  }
  const rowsOrdenadas = [...rowsFiltradas].sort((a, b) => {
    const va = sortVal(a, sortField);
    const vb = sortVal(b, sortField);
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    // Empate en la columna: manda la hora. Se compara como texto ISO (ordena cronológicamente) y
    // una fila sin instante —lo migrado, que nunca tuvo hora— queda al final del día en desc.
    const ia = String(instanteDe(a)), ib = String(instanteDe(b));
    if (ia === ib) return 0;
    if (!ia) return 1;
    if (!ib) return -1;
    return ia < ib ? (sortDir === 'asc' ? -1 : 1) : (sortDir === 'asc' ? 1 : -1);
  });

  // En modo paginado, rowsOrdenadas ya ES la página (server) y el total viene del server.
  const totalDocs  = cobradosPaginado ? cobradosPag.total : rowsOrdenadas.length;
  const totalPages = Math.max(1, Math.ceil(totalDocs / pageSize));
  const paginated  = cobradosPaginado ? rowsOrdenadas : rowsOrdenadas.slice((page-1)*pageSize, page*pageSize);
  // Catálogo de categorías para el filtro Y para la edición inline: el configurado, más las que
  // realmente aparecen en las cuentas cargadas (hay categorías en uso que el catálogo no tiene,
  // como "vuelto"). Una sola fuente para los dos, o el filtro ofrecería opciones que el editor no.
  const catsDisponibles = React.useMemo(() => {
    const delCatalogo = (SSData.categoriasCuenta || [])
      .filter(c => c.tipo === (esCobrar ? 'cobrar' : 'pagar')).map(c => c.nombre);
    const enDatos = (rowsTab || []).map(r => r.categoria).filter(Boolean);
    return [...new Set([...delCatalogo, ...enDatos])]
      .sort((a, b) => String(a).localeCompare(String(b), 'es'));
  }, [rowsTab, esCobrar, catVersion]);
  // ── CxP pagados: banco / forma de pago / id de transacción ────────────────────
  // El pago guarda banco, método y `cuenta_bancaria_id` dentro de `pagos` (jsonb), pero el ID DE
  // TRANSACCIÓN es el id del movimiento bancario, que vive en otra tabla. Se resuelve por
  // `movimientos_bancarios.pago_id` = la parte del id del pago antes de '::' (el sufijo '::CXP-…'
  // existe porque un mismo pago puede saldar varias cuentas). Solo para la página visible.
  const pagosDeCxp = !esCobrar && filterTab === 'pagados';
  const [movsPorPago, setMovsPorPago] = useState({});   // { pago_id: {id, cuenta_bancaria_id, fecha} }
  const pagoIdsVisibles = useMemo(() => {
    if (!pagosDeCxp) return [];
    const ids = new Set();
    paginated.forEach(r => (r.pagos || []).forEach(p => {
      const base = String(p.id || '').split('::')[0];
      if (base) ids.add(base);
    }));
    return [...ids];
  }, [pagosDeCxp, paginated]);
  const pagoIdsKey = pagoIdsVisibles.join('|');
  useEffect(() => {
    if (!pagosDeCxp || pagoIdsVisibles.length === 0) return;
    const faltan = pagoIdsVisibles.filter(id => movsPorPago[id] === undefined);
    if (faltan.length === 0) return;
    let alive = true;
    (async () => {
      const encontrados = {};
      // De a 200 ids por request: un .in() con cientos de ids revienta el largo de la URL.
      for (let i = 0; i < faltan.length; i += 200) {
        const chunk = faltan.slice(i, i + 200);
        const { data } = await window.sb.from('movimientos_bancarios')
          .select('id,pago_id,cuenta_bancaria_id,fecha,banco').in('pago_id', chunk);
        (data || []).forEach(m => { encontrados[m.pago_id] = m; });
      }
      if (!alive) return;
      // `null` = ya se buscó y ese pago no tiene movimiento (no se vuelve a pedir).
      setMovsPorPago(prev => {
        const next = { ...prev };
        faltan.forEach(id => { next[id] = encontrados[id] || null; });
        return next;
      });
    })();
    return () => { alive = false; };
  }, [pagosDeCxp, pagoIdsKey]);

  // Selecciona TODAS las filas filtradas, no solo la página visible.
  // OJO: en el tab de Cobradas con paginación de servidor, `rowsOrdenadas` ES la
  // página (el resto no está en memoria), así que ahí el alcance es la página.
  const seleccionables = rowsOrdenadas;
  function toggleAll() { if(selected.size>=seleccionables.length)setSelected(new Set());else setSelected(new Set(seleccionables.map(r=>r.id))); }
  function toggleOne(id,e) { e.stopPropagation();setSelected(prev=>{const s=new Set(prev);s.has(id)?s.delete(id):s.add(id);return s;}); }

  // ── Agrupación (cliente / modalidad / estado) sobre las filas ya filtradas+ordenadas ──
  const modalidadLbl = { divisas:'💵 Divisas USD', bcv:'🏦 BCV', bcv_fijo:'🏦 Nota BCV', paralelo:'📊 Paralelo' };
  const estadoLbl    = { pendiente:'Pendiente', parcial:'Parcial', vencida:'Vencida', pagada:'Pagada' };
  // Mes de una fecha → { label:'Julio 2026', sort:'2026-07' } (sort para orden cronológico).
  function mesInfo(dateVal, sinLabel) {
    if (!dateVal) return { label: sinLabel, sort: '0000-00' };
    const s = String(dateVal).slice(0, 10);
    const d = new Date(s + 'T00:00:00');
    if (isNaN(d.getTime())) return { label: sinLabel, sort: '0000-00' };
    const lbl = d.toLocaleDateString('es-VE', { month: 'long', year: 'numeric' });
    return { label: lbl.charAt(0).toUpperCase() + lbl.slice(1), sort: s.slice(0, 7) };
  }
  // AGRUPAR POR DÍA (pedido del 2026-08-07: "donde dice agrupar por mes, que diga agrupar por día").
  // El mes sirve para el cierre; el día es la pregunta del día a día ("¿qué cobré el martes?",
  // "¿qué me vence mañana?"). Se rotula con el día de la semana adelante porque es así como se
  // pregunta, y ordena por la fecha ISO, no por el texto.
  function diaInfo(s, sinLabel) {
    if (!s) return { label: sinLabel, sort: '0000-00-00' };
    const d = new Date(String(s).slice(0, 10) + 'T00:00:00');
    if (isNaN(d.getTime())) return { label: sinLabel, sort: '0000-00-00' };
    const lbl = d.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return { label: lbl.charAt(0).toUpperCase() + lbl.slice(1), sort: String(s).slice(0, 10) };
  }
  const esMes = groupBy === 'mes' || groupBy === 'mes_emision';
  const esDia = groupBy === 'dia' || groupBy === 'dia_emision' || groupBy === 'dia_cobro';
  const esPeriodo = esMes || esDia;
  // Qué fecha mira cada agrupado por período, y cómo se llama el grupo cuando esa fecha falta.
  // Una sola fuente: el mes y el día de un mismo agrupado tienen que salir de la MISMA columna, o
  // un día de agosto podría caer bajo el mes de julio.
  function fechaAgrup(r) {
    if (groupBy === 'dia_cobro')                              return { s: fechaPagoDe(r),                sin: esCobrar ? '— Sin cobrar' : '— Sin pagar' };
    if (groupBy === 'dia_emision' || groupBy === 'mes_emision') return { s: r.fecha_emision || r.fecha,   sin: '— Sin fecha de emisión' };
    return { s: r.vence, sin: '— Sin fecha de vencimiento' };
  }
  function mesInfoDe(r)     { const f = fechaAgrup(r); return mesInfo(f.s, f.sin); }
  function periodoInfoDe(r) { const f = fechaAgrup(r); return esDia ? diaInfo(f.s, f.sin) : mesInfo(f.s, f.sin); }
  function groupKey(r) {
    if (groupBy === 'entidad')   { const ent = entities.find(e => e.id === r[entKey] || e.id === r.cliente_id); return ent?.nombre || ('— Sin ' + entLabel.toLowerCase()); }
    if (groupBy === 'modalidad') return modalidadLbl[r.modalidad_pago || 'divisas'] || (r.modalidad_pago || 'divisas');
    if (groupBy === 'estado')    return estadoLbl[r.estado] || (r.estado || '—');
    // Agrupar por DÍA arma el grupo de primer nivel por MES: los días viven adentro (ver abajo).
    if (esDia)                   return mesInfoDe(r).label;
    if (esPeriodo)               return periodoInfoDe(r).label;
    return '';
  }
  const grouped = useMemo(() => {
    if (!groupBy) return null;
    const map = new Map();
    for (const r of rowsOrdenadas) {
      const k = groupKey(r);
      if (!map.has(k)) map.set(k, { key:k, rows:[], monto:0, pagado:0, saldo:0,
                                    minEmision:Infinity, minVence:Infinity,
                                    subMap: esDia ? new Map() : null,
                                    sortKey: esPeriodo ? (esDia ? mesInfoDe(r).sort : periodoInfoDe(r).sort) : k });
      const g = map.get(k);
      g.rows.push(r);
      g.monto  += (r.monto || 0);
      g.pagado += (r.pagado || 0);
      g.saldo  += (r.monto || 0) - (r.pagado || 0);
      const fe = sortVal(r, 'emision'); if (fe) g.minEmision = Math.min(g.minEmision, fe);
      const fv = sortVal(r, 'vence');   if (fv) g.minVence   = Math.min(g.minVence,   fv);
      // ── DÍAS DENTRO DEL MES ────────────────────────────────────────────────────────────────
      // Jorge, 2026-08-11, describiendo cómo lo hacía en la contabilidad de Odoo: "si lo pongo por
      // día me va a salir agosto; cliqueo y me sale 1, 2, 3, 4, 5, desplegables cada uno. Entonces
      // yo voy chequeando por día contra lo que tengo en físico". Antes el agrupado por día era
      // PLANO: todos los días de todos los meses en una sola lista, que con un año de cuentas es
      // una parrilla imposible de recorrer.
      if (g.subMap) {
        const d = periodoInfoDe(r);
        let sg = g.subMap.get(d.label);
        if (!sg) { sg = { key: k + ' · ' + d.label, label: d.label, sort: d.sort,
                          rows: [], monto: 0, pagado: 0, saldo: 0 };
                   g.subMap.set(d.label, sg); }
        sg.rows.push(r);
        sg.monto  += (r.monto || 0);
        sg.pagado += (r.pagado || 0);
        sg.saldo  += (r.monto || 0) - (r.pagado || 0);
      }
    }
    const arr = [...map.values()];
    // Los días van del 1 al 31 SIEMPRE, sin importar cómo estén ordenados los meses. Pedido
    // explícito de Amanda en la misma llamada: "que te lo despliegue en filas de todo el mes y por
    // orden, del 1 al 30 o 31 según aplique". Adentro de un mes el día es un eje de calendario que
    // se recorre de arriba abajo como una lista de chequeo, no una columna que se ordena.
    arr.forEach(g => {
      if (!g.subMap) return;
      g.sub = [...g.subMap.values()].sort((a, b) => String(a.sort).localeCompare(String(b.sort)));
      g.subMap = null;
    });

    // El orden de los GRUPOS sigue la columna que se clickeó. Antes estaba fijo
    // (saldo desc, o mes desc al agrupar por mes) y `sortField`/`sortDir` ni figuraban
    // en las dependencias: agrupado, el clic en la cabecera solo reordenaba las filas
    // DENTRO de cada grupo, así que parecía que no hacía nada.
    const dir = sortDir === 'asc' ? 1 : -1;
    const claveGrupo = (g) => {
      switch (sortField) {
        case 'monto':    return g.monto;
        case 'pagado':   return g.pagado;
        case 'saldo':    return g.saldo;
        case 'progreso': return g.monto > 0 ? g.pagado / g.monto : 0;
        // En fechas manda la MÁS ANTIGUA del grupo: es la que define su urgencia.
        case 'emision':  return g.minEmision === Infinity ? 0 : g.minEmision;
        case 'vence':    return g.minVence   === Infinity ? 0 : g.minVence;
        // Estado, modalidad, id, factura y creado no tienen un agregado que signifique
        // algo a nivel de grupo: se ordena por el nombre del grupo (o cronológico si son
        // meses), que al menos responde al clic de forma predecible.
        default:         return esPeriodo ? g.sortKey : String(g.key).toLowerCase();
      }
    };
    return arr.sort((a, b) => {
      const va = claveGrupo(a), vb = claveGrupo(b);
      const cmp = (typeof va === 'string' || typeof vb === 'string')
        ? String(va).localeCompare(String(vb))
        : (va - vb);
      // Desempate estable por saldo, para que grupos con la misma clave no salten.
      return cmp * dir || (b.saldo - a.saldo);
    });
  }, [rowsOrdenadas, groupBy, entities, sortField, sortDir]);

  function renderRow(r) {
    const isVuelto   = !esCobrar && r.tipo === 'vuelto';
    const isComision = !esCobrar && r.tipo === 'comision';
    const ent = isVuelto
      ? (SSData.clientes || []).find(c => c.id === r.cliente)
      : isComision ? { nombre: r.vendedor_nombre || '—' } : entities.find(e => e.id === r[entKey]);
    // En CxP la entidad es un PROVEEDOR y no tiene ficha a la que ir; el vuelto sí es de un
    // cliente. Un enlace que no lleva a ningún lado es peor que texto plano.
    const entClienteId = (esCobrar || isVuelto) ? ent?.id : null;
    const pct = (r.pagado / r.monto) * 100;
    const isSel = selected.has(r.id);
    return (
      <tr key={r.id}
        onClick={e=>{if(selected.size>0)toggleOne(r.id,e);else setSel({doc:r,ent,entClienteId});}}
        style={{cursor:'pointer',background:isSel?'var(--brand-soft)':''}}>
        <td style={{padding:'4px 10px',width:36}} onClick={e=>toggleOne(r.id,e)}>
          <input type="checkbox" checked={isSel} onChange={()=>{}} style={{cursor:'pointer',pointerEvents:'none'}}/>
        </td>
        <td className="mono-cell">
          {r.id}
          {isVuelto   && <div><span className="chip amber"  style={{fontSize:10, marginTop:2}}>Vuelto cliente</span></div>}
          {isComision && <div><span className="chip"        style={{fontSize:10, marginTop:2, background:'#ede9fe', color:'#7c3aed'}}>Comisión vendedor</span></div>}
          <div className="show-sm-only small muted" style={{fontSize:11, marginTop:2}}>
            {r.factura ? r.factura + ' · ' : ''}vence {fmt.date(r.vence)}
            {r.dias > 0 && <span className="chip red" style={{fontSize:9, padding:'1px 5px', marginLeft:5}}>+{r.dias}d</span>}
          </div>
        </td>
        <td className="mono-cell hide-sm">
          {r.factura || ((isVuelto || isComision) ? <span className="muted small">{r.concepto || '—'}</span> : '—')}
          {r.odoo_ref && <span title={'Migrado de Odoo · ' + r.odoo_ref} style={{marginLeft:6, fontSize:9, padding:'1px 5px', borderRadius:4, background:'var(--bg-sunken)', color:'var(--text-muted)', fontWeight:700, letterSpacing:'0.04em', verticalAlign:'middle'}}>MIG</span>}
          {/* Chip de IVA: se pidió poder distinguir de un vistazo las facturas con impuesto sin
              abrir cada documento. Va como chip y no como columna nueva porque la tabla ya tiene
              16 y solo 10 de las 1.445 cuentas llevan IVA — una columna estaría vacía casi siempre
              y ensancharía justo la tabla que causaba el desborde horizontal.
              El criterio es el MONTO, no `aplica_iva`: esa bandera está en true por default en el
              96% de lo migrado. Ver migracion-odoo/41_cxc_iva.sql. */}
          {(parseFloat(r.iva) || 0) > 0 && (
            <span title={'Factura con IVA · ' + fmt.usd(r.iva)}
                  style={{marginLeft:6, fontSize:9, padding:'1px 5px', borderRadius:4, background:'var(--accent-soft,#ede9fe)', color:'var(--accent,#7c3aed)', fontWeight:700, letterSpacing:'0.04em', verticalAlign:'middle'}}>IVA</span>
          )}
        </td>
        <td style={{fontWeight: 500}}>
          {ent?.nombre
            ? <window.ClienteLink clienteId={entClienteId} nombre={ent.nombre}/>
            : <span className="muted small">—</span>}
        </td>
        {esCobrar && (
          <td>
            {(() => {
              const m = r.modalidad_pago || 'divisas';
              const cfg = {
                divisas:  { l:'💵 Divisas USD', c:'var(--success)' },
                bcv:      { l:'🏦 BCV',         c:'var(--warn)'    },
                bcv_fijo: { l:'🏦 Nota BCV',    c:'var(--warn)'    },
                paralelo: { l:'📊 Paralelo',    c:'var(--accent)'  },
              }[m] || { l: m, c:'var(--text-muted)' };
              return <span style={{fontSize:10.5, fontWeight:600, padding:'2px 8px', borderRadius:99, background:cfg.c+'1a', color:cfg.c, whiteSpace:'nowrap'}}>{cfg.l}</span>;
            })()}
          </td>
        )}
        {!esCobrar && (
          <td className="dt-hide-mobile">
            {(() => {
              const bs = r.moneda === 'VES';
              const cfg = bs ? { l:'Bs.', c:'var(--warn)' } : { l:'USD', c:'var(--success)' };
              return <span style={{fontSize:10.5, fontWeight:600, padding:'2px 8px', borderRadius:99, background:cfg.c+'1a', color:cfg.c, whiteSpace:'nowrap'}}>{cfg.l}</span>;
            })()}
          </td>
        )}
        <td className="hide-sm" style={{whiteSpace:'nowrap'}}>
          {(r.fecha_emision || r.fecha)
            ? <>{fmt.date(r.fecha_emision || r.fecha)}
                {/* La hora sale de `created_at`; lo migrado no la tiene y muestra solo la fecha.
                    En CxP la hora es cuándo se CARGÓ la cuenta, no cuándo se emitió el papel, así
                    que solo acompaña a la fecha de emisión en CxC (donde sí es el mismo hecho). */}
                {esCobrar && r.created_at && <div className="small mono" style={{fontSize:10.5, opacity:.75}}>{fmt.hora(r.created_at)}</div>}</>
            : <span className="muted small">—</span>}
        </td>
        {/* `fmt.dia` da el día EN la zona del sistema: recortar el ISO daría el día UTC y a las
            22:30 de Caracas la fecha contradiría la hora de abajo. */}
        {!esCobrar && esTabTodas && (
          <td className="hide-sm" style={{whiteSpace:'nowrap'}}>
            {r.created_at
              ? <>{fmt.dia(r.created_at)}
                  <div className="small mono" style={{fontSize:10.5, opacity:.75}}>{fmt.hora(r.created_at)}</div></>
              : <span className="muted small">—</span>}
          </td>
        )}
        <td className="hide-sm">
          <div>{fmt.date(r.vence)}</div>
          {r.dias > 0 && <span className="chip red" style={{fontSize:10}}>+{r.dias}d vencida</span>}
          {r.dias < 0 && <span className="small">en {Math.abs(r.dias)}d</span>}
        </td>
        {/* Categoría editable EN LA TABLA. Clasificar lo que quedó sin categoría es una tarea de
            tanda —hoy hay decenas— y abrir el detalle de cada cuenta para un solo campo la hacía
            inviable. El clic no propaga: la fila abre el detalle. */}
        <td className="dt-hide-mobile" onClick={e => e.stopPropagation()}>
          {catEdit === r.id ? (
            <select className="select" autoFocus style={{ fontSize: 11, padding: '2px 4px', maxWidth: 190 }}
                    value={r.categoria || ''} disabled={catSaving === r.id}
                    onBlur={() => setCatEdit(null)}
                    onChange={async e => {
                      const val = e.target.value;
                      setCatSaving(r.id);
                      const res = await window.updateCategoriaCuenta(esCobrar, r.id, val);
                      setCatSaving(null); setCatEdit(null);
                      if (res?.error) alert('No se pudo guardar la categoría: ' + (res.error.message || ''));
                      else setCatVersion(v => v + 1);
                    }}>
              {/* La categoría es obligatoria desde acá en adelante: la opción en blanco solo
                  aparece para las cuentas migradas/legacy que ya están sin clasificar, y sirve
                  de placeholder — no se puede volver a elegir "sin categoría" a propósito. */}
              {!r.categoria && <option value="" disabled>Selecciona una categoría…</option>}
              {catsDisponibles.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <span onClick={() => setCatEdit(r.id)} title="Clic para cambiar la categoría"
                  style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {r.categoria
                ? <span className="chip" style={{fontSize:11}}>{r.categoria}</span>
                : <span className="muted small" style={{ borderBottom: '1px dashed var(--border)' }}>+ categoría</span>}
              {catSaving === r.id && <span className="small muted">…</span>}
            </span>
          )}
        </td>
        <td>
          <StatusChip estado={r.estado}/>
          {/* La cuenta volvió a "pendiente" porque alguien borró en Bancos el movimiento que la
              respaldaba — no porque nunca se hubiera cobrado/pagado. Sin esto se ve igual que
              cualquier otra pendiente y nadie se entera de que hubo un pago que desapareció. */}
          {r.pago_eliminado_en && (
            <span className="chip" style={{background:'#fee2e2', color:'#dc2626', marginLeft:5, fontSize:10.5}}
                  title={`${r.pago_eliminado_motivo || 'Se eliminó un movimiento bancario de esta cuenta'} — ${r.pago_eliminado_por || 'desconocido'} · ${fmt.dateTime ? fmt.dateTime(r.pago_eliminado_en) : r.pago_eliminado_en}`}>
              <Icon name="alert" size={10}/> Eliminado de banco
            </span>
          )}
          {/* Debajo del estado del COBRO, el del DESPACHO. Una factura cobrada y sin despachar se
              veía perfectamente sana acá: el cliente pagó y no recibió nada, y nada lo decía. */}
          {esCobrar && r.factura && sinDespacharIds.has(r.factura) && (
            <div className="small" style={{color:'var(--danger)', fontWeight:600, marginTop:2, whiteSpace:'nowrap'}}
                 title="Esta factura todavía no tiene nota de despacho">
              Pendiente por despachar
            </div>
          )}
        </td>
        <td className="dt-hide-mobile"><CreadoPorCell nombre={r.creado_por}/></td>
        <td className="num hide-sm">
          {fmt.usd(r.monto)}
          {!esCobrar && r.moneda === 'VES' && r.tasa > 0 && (
            <div className="small muted" style={{fontSize:10, fontWeight:400}}>{fmt.bs(r.monto * r.tasa)} @ {r.tasa}</div>
          )}
        </td>
        <td className="num muted hide-sm">{fmt.usd(r.pagado)}</td>
        {pagosDeCxp && renderCeldasPago(r)}
        <td className="num strong-num">{fmt.usd(r.monto - r.pagado)}</td>
        {esTabSaldados ? (
          <td className="hide-sm" style={{whiteSpace:'nowrap'}}>
            {(() => {
              const f = fechaPagoDe(r);
              if (!f) return <span className="muted small">—</span>;
              const ts = instantePagoDe(r);
              return <>{fmt.date(f)}{ts && <div className="small mono" style={{fontSize:10.5, opacity:.75}}>{fmt.hora(ts)}</div>}</>;
            })()}
          </td>
        ) : (
          <td className="hide-sm" style={{width: 120}}>
            <div className="pbar" style={{height:6}}><span className={r.estado==='vencida'?'danger':''} style={{width:`${pct}%`, background: pct === 100 ? 'var(--success)' : r.estado==='vencida'?'var(--danger)':'var(--brand)'}}/></div>
          </td>
        )}
      </tr>
    );
  }

  // Celdas Banco / Forma de pago / ID transacción de la pestaña "Pagados" de CxP.
  // Una CxP puede tener varios pagos (abonos): se listan todos, cada uno con su enlace.
  function renderCeldasPago(r) {
    const pagos = (r.pagos || []).filter(Boolean);
    if (pagos.length === 0) {
      return <>
        <td className="hide-sm"><span className="muted small">—</span></td>
        <td className="hide-sm"><span className="muted small">—</span></td>
        <td className="hide-sm"><span className="muted small">—</span></td>
      </>;
    }
    const metodoLbl = (m) => {
      const k = String(m || '').toLowerCase();
      const map = { transferencia:'Transferencia', efectivo:'Efectivo', zelle:'Zelle', binance:'Binance',
                    pago_movil:'Pago móvil', 'pago-movil':'Pago móvil', cheque:'Cheque', tarjeta:'Tarjeta',
                    divisas:'Divisas', deposito:'Depósito' };
      return map[k] || (m ? String(m) : '—');
    };
    return <>
      <td className="hide-sm" style={{fontSize:12}}>
        {pagos.map((p, i) => (
          <div key={i} style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:170}}
               title={p.banco || ''}>{p.banco || <span className="muted small">—</span>}</div>
        ))}
      </td>
      <td className="hide-sm" style={{fontSize:12}}>
        {pagos.map((p, i) => (
          <div key={i} style={{whiteSpace:'nowrap'}}>
            <span className="chip" style={{fontSize:10.5}}>{metodoLbl(p.metodo)}</span>
            {p.referencia && <div className="muted mono" style={{fontSize:10}}>ref {p.referencia}</div>}
          </div>
        ))}
      </td>
      <td className="hide-sm" style={{fontSize:12}} onClick={e => e.stopPropagation()}>
        {pagos.map((p, i) => {
          const base = String(p.id || '').split('::')[0];
          const mov = base ? movsPorPago[base] : null;
          if (mov === undefined) return <div key={i} className="muted small">cargando…</div>;
          if (!mov) return <div key={i} className="muted small" title={'Pago ' + base + ' sin movimiento bancario asociado'}>sin movimiento</div>;
          return (
            <div key={i}>
              <a href="#" className="mono" style={{fontSize:11, color:'var(--brand)', fontWeight:600, textDecoration:'underline'}}
                 title={'Ver este movimiento en ' + (mov.banco || 'el banco')}
                 onClick={ev => { ev.preventDefault(); irAMovimientoBancario(mov.cuenta_bancaria_id || p.cuenta_bancaria_id, mov.id); }}>
                {mov.id}
              </a>
            </div>
          );
        })}
      </td>
    </>;
  }
  // +1 en CxP: la columna "Emisión" pasó a mostrarse también ahí (migración 67).
  const colSpanTotal = (esCobrar ? 14 : 14) + (pagosDeCxp ? 3 : 0) + (!esCobrar && esTabTodas ? 1 : 0);

  function exportAccountsXLSX() {
    const source = (selected.size > 0 ? rowsOrdenadas.filter(r => selected.has(r.id)) : rowsOrdenadas);
    if (source.length === 0) { alert('No hay cuentas para exportar.'); return; }
    // Las cuentas en bolívares guardan el `monto` en USD y la tasa a la que se registraron: los
    // bolívares —que es la cifra que de verdad salió del banco— no estaban en la exportación por
    // ningún lado. Se agregan solo si alguna fila trae tasa, para no ensuciar la de CxC (que es
    // toda en dólares) con tres columnas vacías.
    // El criterio es la MONEDA de la cuenta, no "tiene tasa": una cuenta en dólares puede traer
    // `tasa: 1` y multiplicar por eso daría una columna "Bs." con la cifra en dólares adentro.
    const esVes = r => r.moneda === 'VES' && Number(r.tasa) > 0;
    const hayBs = source.some(esVes);
    const bs = (v, r) => (esVes(r) ? parseFloat((Number(v || 0) * Number(r.tasa)).toFixed(2)) : '');
    const data = source.map(r => {
      const ent = entities.find(e => e.id === r[entKey] || e.id === r.cliente_id || e.id === r.proveedor_id);
      const saldoUsd = (r.monto || 0) - (r.pagado || 0);
      return {
        id: r.id,
        factura: r.factura || '',
        // 125 de las 176 CxP no tienen número de factura (gasto, adelanto, comisión bancaria) pero
        // sí concepto: sin esta columna, 7 de cada 10 filas salían sin nada que las identifique.
        concepto: r.concepto || '',
        entidad: ent?.nombre || '',
        rif: ent?.rif || '',
        moneda: r.moneda === 'VES' ? 'Bs.' : (r.moneda || 'USD'),
        tasa: Number(r.tasa) > 0 ? parseFloat(Number(r.tasa).toFixed(4)) : '',
        monto: parseFloat(Number(r.monto||0).toFixed(2)),
        pagado: parseFloat(Number(r.pagado||0).toFixed(2)),
        saldo: parseFloat(Number(saldoUsd).toFixed(2)),
        monto_bs:  bs(r.monto, r),
        pagado_bs: bs(r.pagado, r),
        saldo_bs:  bs(saldoUsd, r),
        // El IVA de la factura: es lo que la contadora necesita para separar las gravadas.
        iva: (parseFloat(r.iva) || 0) > 0 ? parseFloat(Number(r.iva).toFixed(2)) : '',
        emision: (r.fecha_emision || r.fecha || ''),
        vence: r.vence || '',
        fecha_pago: fechaPagoDe(r) || '',
        dias: r.dias != null ? r.dias : '',
        estado: r.estado || '',
        modalidad_pago: r.modalidad_pago || '',
        categoria: r.categoria || '',
        creado_por: r.creado_por || 'Sistema',
      };
    });
    const cols = [
      { key:'id',             label:'ID' },
      { key:'factura',        label:'Factura' },
      ...(esCobrar ? [] : [{ key:'concepto', label:'Concepto' }]),
      { key:'entidad',        label: entLabel },
      { key:'rif',            label:'RIF' },
      ...(hayBs ? [{ key:'moneda', label:'Moneda' }, { key:'tasa', label:'Tasa' }] : []),
      ...(esCobrar ? [{ key:'iva', label:'IVA (USD)' }] : []),
      { key:'monto',          label:'Monto (USD)' },
      { key:'pagado',         label: (esCobrar ? 'Cobrado' : 'Pagado') + ' (USD)' },
      { key:'saldo',          label:'Saldo (USD)' },
      ...(hayBs ? [
        { key:'monto_bs',  label:'Monto (Bs.)' },
        { key:'pagado_bs', label: (esCobrar ? 'Cobrado' : 'Pagado') + ' (Bs.)' },
        { key:'saldo_bs',  label:'Saldo (Bs.)' },
      ] : []),
      { key:'emision',        label:'Emisión' },
      { key:'vence',          label:'Vence' },
      { key:'fecha_pago',     label: labelFechaPago },
      { key:'dias',           label:'Días' },
      { key:'estado',         label:'Estado' },
      { key:'modalidad_pago', label:'Modalidad' },
      { key:'categoria',      label:'Categoría' },
      { key:'creado_por',     label:'Creado por' },
    ];
    window.exportToXLSX(data, cols, moduloId, esCobrar ? 'Cuentas por Cobrar' : 'Cuentas por Pagar');
  }

  // Resuelve a quién se le cobra/paga una fila. CxP mezcla tres cosas en la misma
  // tabla: deuda a proveedor, vuelto a cliente y comisión a vendedor.
  function entidadDeFila(r) {
    const isVuelto   = !esCobrar && r.tipo === 'vuelto';
    const isComision = !esCobrar && r.tipo === 'comision';
    const ent = isVuelto
      ? (SSData.clientes || []).find(c => c.id === r.cliente)
      : isComision
        ? { id: r.vendedor_id, nombre: r.vendedor_nombre || '—' }
        : entities.find(e => e.id === r[entKey]);
    return ent ? { ...ent, _esVuelto: isVuelto, _esComision: isComision } : null;
  }

  function openPagoGlobal() {
    // SIN selección no se puede adivinar a quién cobrarle: antes tomaba la primera
    // cuenta pendiente de la lista y abría ese cliente, que es arbitrario. Ahora
    // se pregunta.
    if (selected.size === 0) { setPickPago(true); return; }

    const candidatos = rows.filter(r => selected.has(r.id) && r.monto > r.pagado);
    const primera = candidatos[0];
    if (!primera) return;
    const isVuelto   = !esCobrar && primera.tipo === 'vuelto';
    const isComision = !esCobrar && primera.tipo === 'comision';

    // Bloquear mezcla de modalidades — solo aplica en CxC (CxP no maneja modalidad)
    let modalidadFiltro = null;
    if (esCobrar && !isVuelto && !isComision) {
      const mods = [...new Set(candidatos.map(c => c.modalidad_pago || 'divisas'))];
      if (mods.length > 1) {
        const labels = { divisas:'Divisas USD', bcv:'Bs. BCV', bcv_fijo:'Bs. Nota BCV', paralelo:'Bs. Paralelo' };
        const lista = mods.map(m => labels[m] || m).join(', ');
        alert(`No se pueden agrupar facturas de distintas modalidades de pago.\n\nSeleccionaste: ${lista}\n\nAgrupá únicamente facturas del mismo cliente y misma modalidad.`);
        return;
      }
      modalidadFiltro = mods[0] || 'divisas';
    }

    const ent = isVuelto
      ? (SSData.clientes || []).find(c => c.id === primera.cliente)
      : isComision
        ? { id: primera.vendedor_id, nombre: primera.vendedor_nombre || '—' }
        : entities.find(e => e.id === primera[entKey]);
    const selIds = selected.size > 0 ? [...selected] : null;
    if (ent) setPayEntity({ ...ent, _esVuelto: isVuelto, _esComision: isComision, _selIds: selIds, _modalidadFiltro: modalidadFiltro });
  }

  // Borrar una CxC que salió de una factura deja la venta a medias: la factura sigue viva
  // (con su mercancía prometida) pero ya no hay nada que cobrar. Antes se borraba con un
  // confirm() a secas. Ahora se avisa y se ofrece anular la factura completa, que es lo que
  // devuelve el inventario. `pendienteBorrado` guarda la decisión hasta que el usuario elige.
  const [pendienteBorrado, setPendienteBorrado] = useState(null);   // { targets, conFactura }

  async function bulkDelete() {
    const targets0 = rows.filter(r => selected.has(r.id));
    if (!targets0.length) return;
    if (esCobrar) {
      // Se comprueba contra la BASE que esas facturas existan de verdad: una CxC puede
      // apuntar a una factura ya borrada, y ahí no hay nada que ofrecer.
      const facturas = [...new Set(targets0.map(r => r.factura).filter(Boolean))];
      let vivas = [];
      if (facturas.length) {
        const { data } = await window.sb.from('documentos')
          .select('id, total, estado, estado_despacho, almacen_id')
          .eq('empresa_id', window.currentEmpresa || 'demo1').eq('tipo', 'factura').in('id', facturas);
        vivas = data || [];
      }
      if (vivas.length) { setPendienteBorrado({ targets: targets0, conFactura: vivas }); return; }
    }
    if (!confirm(`¿Eliminar ${selected.size} registro${selected.size!==1?'s':''} de ${esCobrar?'CxC':'CxP'}? Se enviarán a la papelera.`)) return;
    await ejecutarBorrado(targets0, false);
  }

  async function ejecutarBorrado(targets, tambienFactura, facturasVivas, motivo) {
    // Anular la factura ya borra su CxC (deleteCxCByFactura) y devuelve el inventario si
    // había salido, así que en ese camino no hay que borrar la cuenta por separado.
    // `window.anularDocumento` es por-documento (releyendo la fila completa, así ya no puede
    // repetir el bug de select-incompleto que dejaba la devolución sin cliente_id) — con varias
    // facturas en la selección se llama una vez por cada una.
    if (tambienFactura && facturasVivas?.length) {
      for (const f of facturasVivas) {
        const res = await window.anularDocumento(f.id, motivo, window.__ssCurrentUser);
        if (res?.pagoAsociado) {
          // Caso poco común (factura con un pago ya registrado en banco) — se resuelve acá con un
          // confirm nativo en vez de un modal propio: la vía principal para esta decisión es el
          // popup del detalle de factura (más frecuente); acá alcanza con preguntar una vez por doc.
          const eliminar = confirm(`La factura ${f.id} tiene un pago registrado en banco.\n\nAceptar = eliminar ese pago (la deuda vuelve a quedar pendiente).\nCancelar = dejarlo como ingreso desvinculado, pendiente de aplicar.`);
          const res2 = await window.anularDocumento(f.id, motivo, window.__ssCurrentUser, eliminar ? 'eliminar' : 'desvincular');
          if (res2?.error) { alert('No se pudo anular la factura ' + f.id + ': ' + (res2.error.message || res2.error)); return; }
          continue;
        }
        if (res?.error) { alert('No se pudo anular la factura ' + f.id + ': ' + (res.error.message || res.error)); return; }
      }
      setSelected(new Set());
      setPendienteBorrado(null);
      await window.loadAppData?.();
      setVersion(v => v + 1);
      return;
    }
    const tableName = esCobrar ? 'cuentas_cobrar' : 'cuentas_pagar';
    const tipo = esCobrar ? 'cuentaCobrar' : 'cuentaPagar';
    const ok = [], fail = [];
    for (const r of targets) {
      const { error } = await window.sb.from(tableName).delete().eq('id', r.id);
      if (!error) { window.ssTrash?.add(tipo, r.factura || r.id, r); ok.push(r); }
      else fail.push(r);
    }
    // Fix bug #29 (mismo patrón que clientes/proveedores): mutar SSData por `selected`
    // (no por `ok`) ocultaba registros cuyo delete falló en DB.
    const okIds = new Set(ok.map(r => r.id));
    if (esCobrar) SSData.cuentasCobrar = SSData.cuentasCobrar.filter(r => !okIds.has(r.id));
    else SSData.cuentasPagar = SSData.cuentasPagar.filter(r => !okIds.has(r.id));
    setSelected(new Set());
    if (fail.length) alert(`No se pudieron eliminar ${fail.length} registro${fail.length!==1?'s':''}: ` + fail.map(r=>r.factura||r.id).join(', '));
    if (ok.length) {
      window.logActivity?.({
        modulo: moduloId, accion: ok.length===1?'eliminar':'bulk_eliminar',
        entidad_id: ok.length===1?ok[0].id:null,
        entidad_label: ok.length===1?(ok[0].factura||ok[0].id):`${ok.length} registros`,
        detalles:{ ids: ok.map(r=>r.id), montos: ok.map(r=>r.monto) }
      });
      await window.refrescarFase2?.();
    }
    setPendienteBorrado(null);
  }

  return (
    <div className="page">
      {pendienteBorrado && (
        <BorrarCxcConFacturaModal
          info={pendienteBorrado}
          onClose={() => setPendienteBorrado(null)}
          onSoloCuenta={() => ejecutarBorrado(pendienteBorrado.targets, false)}
          onConFactura={(motivo) => ejecutarBorrado(pendienteBorrado.targets, true, pendienteBorrado.conFactura, motivo)}
        />
      )}
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <div className="page-subtitle">{rows.length} documentos · {vencidas.length} vencidos</div>
        </div>
        <div className="page-actions">
          <button className="btn secondary" onClick={exportAccountsXLSX}><Icon name="download" size={14}/>Exportar</button>
          {window.canUser?.('crear', esCobrar?'cxc':'cxp') !== false && (
          <button className="btn secondary" onClick={() => setShowNueva(true)}>
            <Icon name="plus" size={14}/>{esCobrar ? 'Nueva CxC' : 'Nueva CxP'}
          </button>
          )}
          {window.canUser?.('editar', esCobrar?'cxc':'cxp') !== false && (
          <button className="btn primary" onClick={openPagoGlobal}>
            <Icon name="dollar" size={14}/>{esCobrar ? 'Registrar cobro' : 'Registrar pago'}
          </button>
          )}
          <button className="btn ghost" onClick={() => setShowMermas(true)} title="Gestionar mermas de residuo (saldos dados de baja)"><Icon name="dash" size={14}/>Mermas</button>
          <button className="btn ghost" onClick={() => setShowActivity(true)} title="Ver registro de actividad"><Icon name="receipt" size={14}/>Actividad</button>
        </div>
      </div>

      {showActivity && <ActivityLogModal modulo={moduloId} onClose={()=>setShowActivity(false)}/>}

      {/* Cards compactas (fila delgada) — más espacio para la tabla */}
      {(() => {
        const pctReal = (esCobrar && resumen && resumen.total_monto > 0) ? (resumen.cobrado_monto / resumen.total_monto) * 100 : pctCobrado;
        const cards = [
          { l:'Saldo pendiente', v: fmt.usd(totalPend) },
          { l:'Vencido', v: fmt.usd(totalVencido), c:'var(--danger)', sub:`${vencidas.length} docs` },
          { l:'Por vencer 30d', v: fmt.usd(rows.filter(r=>r.dias>-30 && r.dias<0).reduce((s,r)=>s+r.monto-r.pagado,0)), c:'var(--warn)' },
          ...(esCobrar && resumen ? [{ l:'Cobrado', v: fmt.usd(resumen.cobrado_monto), c:'var(--success)', sub:`${(resumen.cobrado_count||0).toLocaleString('es-VE')} facturas` }] : []),
          { l:`% ${esCobrar?'cobrado':'pagado'}`, v:`${pctReal.toFixed(0)}%`, bar:pctReal },
        ];
        return (
          <div className="hide-sm" style={{display:'flex', gap:8, flexWrap:'wrap', marginBottom:12}}>
            {cards.map(s => (
              <div key={s.l} style={{flex:'1 1 130px', minWidth:120, background:'var(--bg-elev)', border:'1px solid var(--border)', borderRadius:8, padding:'7px 12px'}}>
                <div className="muted" style={{fontSize:10.5, textTransform:'uppercase', letterSpacing:'0.04em'}}>{s.l}</div>
                <div style={{fontSize:16, fontWeight:700, color:s.c||'var(--text)', lineHeight:1.3}}>{s.v}</div>
                {s.sub && <div className="muted" style={{fontSize:10.5}}>{s.sub}</div>}
                {s.bar != null && <div className="pbar mt-1" style={{height:3}}><span style={{width:`${s.bar}%`, background:'var(--success)'}}/></div>}
              </div>
            ))}
          </div>
        );
      })()}

      <div className="tbl-wrap mt-4">
        <div className="tbl-toolbar" style={{flexWrap:'wrap', gap:8}}>
          <div className="seg">
            {(() => {
              const pendCount = rows.filter(r => !(r.estado === 'pagada' || r.pagado >= r.monto)).length;
              // CxC: "Cobrados" (facturas pagadas, del resumen server-side) reemplaza a Pagados+Todos.
              const tabs = esCobrar
                ? [ { id:'pendientes', label:'Pendientes', count: pendCount },
                    { id:'pagados',    label:'Cobrados',   count: resumen?.cobrado_count },
                    // "Cobré y todavía no salió la mercancía". Pedido del 2026-08-07: *"las
                    // pendientes por cobrar ya sé cuáles son, pero por despachar no sé cuántas
                    // tengo"*. Al registrar el cobro la factura se va de "Pendientes" y no
                    // aparecía en ningún lado — en "Cobrados" se ve perfectamente sana.
                    { id:'por_despachar', label:'Por despachar', count: sinDespacharIds.size,
                      title:'Facturas de este módulo que ya se cobraron (o se emitieron) y todavía no tienen despacho.' },
                    { id:'sin_facturar', label:'Sin facturar', count: sinFacturar.length,
                      title:'Órdenes de venta confirmadas que nunca se facturaron: plata comprometida que todavía no llegó a ser una cuenta por cobrar.' },
                    { id:'todos',      label:'Todas',      count: (resumen?.cobrado_count != null ? resumen.cobrado_count + pendCount : null),
                      title:'Cobradas + pendientes: todo lo que este módulo puede mostrar.' } ]
                : [ { id:'pendientes', label:'Pendientes', count: pendCount },
                    { id:'pagados',    label:'Pagados',    count: rows.filter(r => (r.estado === 'pagada' || r.pagado >= r.monto)).length },
                    { id:'todos',      label:'Todas',      count: rows.length } ];
              return tabs.map(t => (
                <button key={t.id} className={filterTab===t.id?'on':''} title={t.title || undefined}
                        onClick={()=>{setFilterTab(t.id);setPage(1);setSelected(new Set());setExpandedG(new Set());}}>
                  {t.label} <span style={{opacity:.7, fontSize:11}}>({t.count == null ? '…' : t.count.toLocaleString('es-VE')})</span>
                </button>
              ));
            })()}
          </div>
          {/* Búsqueda */}
          <div style={{position:'relative', minWidth:200, flex:'0 1 260px', alignSelf:'center', height:32, display:'flex', alignItems:'center'}}>
            <Icon name="search" size={14} style={{position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)', pointerEvents:'none', zIndex:1}}/>
            <input className="input" style={{paddingLeft:30, paddingRight: search?26:12, width:'100%', fontSize:12.5, height:32, boxSizing:'border-box'}}
              placeholder={`Buscar ${esCobrar?'cliente':'proveedor'} / RIF / ID / factura…`}
              value={search} onChange={e=>{ setSearch(e.target.value); setPage(1); }}/>
            {search && <button onClick={()=>{setSearch('');setPage(1);}} title="Limpiar"
              style={{position:'absolute', right:6, top:'50%', transform:'translateY(-50%)', background:'transparent', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:13, padding:'2px 4px', lineHeight:1}}>✕</button>}
          </div>
          {/* Agrupar por (cliente / modalidad / estado) */}
          <select className="select" value={groupBy} onChange={e=>{setGroupBy(e.target.value);setExpandedG(new Set());setPage(1);}} style={{fontSize:12, padding:'4px 8px'}}>
            <option value="">Sin agrupar</option>
            <option value="entidad">Agrupar por {esCobrar?'cliente':'proveedor'}</option>
            {/* Por DÍA arriba del mes: es la pregunta del día a día ("¿qué cobré el martes?"). */}
            <option value="dia">Agrupar por mes y día (vencimiento)</option>
            {/* También en CxP desde el 2026-08-13: ya tiene `fecha_emision` propia. */}
            <option value="dia_emision">Agrupar por mes y día (emisión)</option>
            {/* En la pestaña de saldados, agrupar por el día en que ENTRÓ la plata: es la vista de
                caja, y es la única fecha que responde "qué se cobró tal día". */}
            {esTabSaldados && <option value="dia_cobro">Agrupar por mes y día ({esCobrar ? 'cobro' : 'pago'})</option>}
            <option value="mes">Agrupar por mes (vencimiento)</option>
            <option value="mes_emision">Agrupar por mes (emisión)</option>
            <option value="modalidad">Agrupar por modalidad</option>
            <option value="estado">Agrupar por estado</option>
          </select>
          {/* Categoría. Las opciones NO salen solo del catálogo configurado: se unen con las que
              realmente aparecen en las cuentas cargadas. Hay categorías que el catálogo no tiene
              (p. ej. "vuelto", 106 cuentas) y un filtro que no puede seleccionar lo que está en
              pantalla no sirve para nada. */}
          {(() => {
            const delCatalogo = (SSData.categoriasCuenta || [])
              .filter(c => c.tipo === (esCobrar ? 'cobrar' : 'pagar')).map(c => c.nombre);
            const enDatos = (rowsTab || []).map(r => r.categoria).filter(Boolean);
            const opciones = [...new Set([...delCatalogo, ...enDatos])]
              .sort((a, b) => String(a).localeCompare(String(b), 'es'));
            const haySin = (rowsTab || []).some(r => !r.categoria);
            if (!opciones.length && !haySin) return null;
            const todas = haySin ? [...opciones, '__sin__'] : opciones;
            const sel = Array.isArray(catF) ? catF : [];
            const etiqueta = (c) => c === '__sin__' ? 'Sin categoría' : c;
            const toggle = (c) => {
              setCatF(sel.includes(c) ? sel.filter(x => x !== c) : [...sel, c]);
              setPage(1);
            };
            // Checkboxes y no <select multiple>: el nativo obliga a ctrl+clic para sumar y a
            // arrastrar para deseleccionar, y basta un clic mal dado para perder toda la selección.
            return (
              <div style={{ position: 'relative' }}>
                <button ref={catBtnRef} className="select" type="button" onClick={() => setCatOpen(o => !o)}
                        style={{ fontSize: 12, padding: '4px 8px', cursor: 'pointer', textAlign: 'left', minWidth: 150 }}
                        title="Filtrar por una o varias categorías">
                  {sel.length === 0 ? 'Todas las categorías'
                    : sel.length === 1 ? etiqueta(sel[0])
                    : `${sel.length} categorías`}
                  <Icon name="chevronD" size={11} />
                </button>
                {catOpen && catPos && ReactDOM.createPortal(
                  <>
                    {/* Capa de cierre: sin esto el panel queda abierto tapando la tabla. */}
                    <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setCatOpen(false)} />
                    {/* Portado a document.body (mismo patrón que SearchSelect): `position:fixed` con
                        coordenadas de getBoundingClientRect(), así ningún contenedor con overflow
                        (el scroll horizontal de la tabla) lo recorta ni lo deja detrás de nada. */}
                    <div className="card" style={{ position: 'fixed', top: catPos.top ?? 'auto', bottom: catPos.bottom ?? 'auto',
                                                   left: catPos.left, width: catPos.width, zIndex: 9999,
                                                   maxHeight: 320, overflowY: 'auto', padding: 6, boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,.14))' }}>
                      <div style={{ display: 'flex', gap: 6, padding: '2px 4px 6px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
                        <button className="btn ghost sm" style={{ fontSize: 11 }}
                                onClick={() => { setCatF(todas.slice()); setPage(1); }}>Todas</button>
                        <button className="btn ghost sm" style={{ fontSize: 11 }}
                                onClick={() => { setCatF([]); setPage(1); }}>Limpiar</button>
                      </div>
                      {todas.map(c => (
                        <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 6px', cursor: 'pointer',
                                                fontSize: 12.5, borderRadius: 5, color: c === '__sin__' ? 'var(--warn)' : undefined }}>
                          <input type="checkbox" checked={sel.includes(c)} onChange={() => toggle(c)} />
                          <span style={{ flex: 1 }}>{etiqueta(c)}</span>
                        </label>
                      ))}
                    </div>
                  </>,
                  document.body
                )}
              </div>
            );
          })()}
          {/* Filtro de IVA (solo CxC): "qué notas son facturas con impuesto". Va por MONTO — la
              bandera `aplica_iva` es true en 1.386 de 1.445 cuentas por ser el default. */}
          {esCobrar && (
            <select className="select" value={ivaF} onChange={e=>{setIvaF(e.target.value); setPage(1);}}
                    style={{fontSize:12, padding:'4px 8px'}} title="Facturas con o sin IVA">
              <option value="">Con y sin IVA</option>
              <option value="con">Solo con IVA</option>
              <option value="sin">Solo sin IVA</option>
            </select>
          )}
          {/* En la pestaña de saldados el rango puede aplicarse a la fecha de cobro/pago o al
              vencimiento: son preguntas distintas ("qué cobré en julio" vs "qué vencía en julio"). */}
          {esTabSaldados && (
            <select className="select" value={fechaCampo} onChange={e=>{setFechaCampo(e.target.value); setPage(1);}}
                    style={{fontSize:12, padding:'4px 8px'}} title="Sobre qué fecha aplica el rango">
              <option value="cobro">Rango por {esCobrar ? 'fecha de cobro' : 'fecha de pago'}</option>
              <option value="vence">Rango por vencimiento</option>
            </select>
          )}
          {!esTabSaldados && !esCobrar && (
            <select className="select" value={fechaCampoPend} onChange={e=>{setFechaCampoPend(e.target.value); setPage(1);}}
                    style={{fontSize:12, padding:'4px 8px'}} title="Sobre qué fecha aplica el rango">
              <option value="vence">Rango por vencimiento</option>
              <option value="creacion">Rango por fecha de creación</option>
            </select>
          )}
          {/* Rango de fechas — pasa al selector compartido (`window.DateRangeFilter`): trae los
              presets (Hoy, Ayer, Esta semana, Este mes…) y el botón "Solo el <fecha>" para un día
              único. Antes eran dos <input type=date> pelados: para ver UN día había que escribir la
              misma fecha dos veces, y quien ponía solo "Desde" creía estar mirando ese día cuando en
              realidad miraba desde ese día en adelante. Pedido del 2026-08-07. */}
          <div title={fechaCampoEf === 'cobro' ? `Filtrar por ${esCobrar ? 'fecha de cobro' : 'fecha de pago'}` : fechaCampoEf === 'creacion' ? 'Filtrar por fecha de creación' : 'Filtrar por fecha de vencimiento'}>
            <window.DateRangeFilter desde={fechaDesde} hasta={fechaHasta}
              onChange={(d, h) => { setFechaDesde(d || ''); setFechaHasta(h || ''); setPage(1); }}/>
          </div>
          <span className="ml-auto small">
            {(cobradosLoading || cobradosPagLoading) && usaCobrados ? 'Cargando cobradas…' : `${totalDocs.toLocaleString('es-VE')} documentos`}
            {selected.size>0?` · ${selected.size} seleccionados`:''}
          </span>
          {/* Preferencia separada por CxC y CxP: no tienen las mismas columnas. */}
          <window.TablaColumnas moduloId={esCobrar ? 'cxc' : 'cxp'} tablaRef={tablaCuentasRef}/>
        </div>
        {/* ── Por despachar: cobré y todavía no salió la mercancía ──────────────────────────
            Tabla propia y no la de cuentas: estas filas NO son cuentas por cobrar (varias ya
            están saldadas y viven en la consulta paginada de "Cobrados"), son FACTURAS sin
            despacho. La fuente es `SSData.docsTrabados`, que ya trae cliente, monto y días. */}
        {esCobrar && (filterTab === 'por_despachar' || filterTab === 'sin_facturar') && (() => {
          const esDesp = filterTab === 'por_despachar';
          const filas  = esDesp ? sinDespachar : sinFacturar;
          const total  = filas.reduce((s, d) => s + (Number(d.total) || 0), 0);
          return (
            <div className="tbl-scroll">
              {filas.length === 0 ? (
                <div className="small muted" style={{padding:'18px 14px', display:'flex', alignItems:'center', gap:8}}>
                  <Icon name="check" size={14}/>
                  {/* "No se pudo consultar" NO es "todo al día" — la misma regla que costó un
                      reporte del usuario en el panel del flujo. */}
                  {SSData.docsTrabadosError
                    ? `No se pudo verificar: ${SSData.docsTrabadosError}`
                    : esDesp ? 'Ninguna factura pendiente por despachar.'
                             : 'Ninguna orden sin facturar.'}
                </div>
              ) : (
                <table className="tbl">
                  <thead><tr>
                    <th>{esDesp ? 'Factura' : 'Orden'}</th><th>Cliente</th>
                    <th>{esDesp ? 'Estado del cobro' : 'Qué le falta'}</th>
                    <th style={{textAlign:'right'}}>Monto</th><th>Fecha</th>
                    <th style={{textAlign:'right'}}>Esperando</th>
                  </tr></thead>
                  <tbody>
                    {filas.map(d => (
                      <tr key={d.id} style={{cursor:'pointer'}} title={`Abrir ${d.id}`}
                          onClick={() => window.abrirDocumentoPorId?.(d.id)}>
                        <td className="mono" style={{fontWeight:600}}>{d.id}</td>
                        <td>{d.cliente || '—'}</td>
                        <td>
                          {esDesp ? (
                            <>
                              <span className="chip" style={{fontSize:10.5, fontWeight:700,
                                background: d.estado_cobro === 'pagada' ? '#16a34a18' : '#d9770618',
                                color:      d.estado_cobro === 'pagada' ? '#16a34a'   : '#b45309'}}>
                                {d.estado_cobro === 'pagada' ? 'Cobrada' : 'Por cobrar'}
                              </span>
                              <div className="small" style={{color:'var(--danger)', fontWeight:600, marginTop:2}}>
                                Pendiente por despachar
                              </div>
                            </>
                          ) : (
                            <span className="chip" style={{fontSize:10.5, fontWeight:700, background:'#d9770618', color:'#b45309'}}>
                              Falta facturarla
                            </span>
                          )}
                        </td>
                        <td className="mono" style={{textAlign:'right', fontWeight:700}}>{fmt.usd(Number(d.total) || 0)}</td>
                        <td>{fmt.date(d.fecha)}</td>
                        <td style={{textAlign:'right', fontWeight:600, color: d.dias > 30 ? 'var(--danger)' : 'var(--text-muted)'}}>{d.dias} d</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr>
                    <td colSpan={3} style={{fontWeight:600}}>Total · {filas.length} documento{filas.length !== 1 ? 's' : ''}</td>
                    <td className="mono" style={{textAlign:'right', fontWeight:700}}>{fmt.usd(total)}</td>
                    <td colSpan={2}/>
                  </tr></tfoot>
                </table>
              )}
            </div>
          );
        })()}

        <div className="tbl-scroll" style={{display: (esCobrar && (filterTab === 'por_despachar' || filterTab === 'sin_facturar')) ? 'none' : undefined}}>
          <table className="tbl" ref={tablaCuentasRef}>
            <thead>
              <tr>
                <th style={{width:36,padding:'4px 10px'}}>
                  <input type="checkbox"
                    ref={el=>{if(el)el.indeterminate=selected.size>0&&selected.size<seleccionables.length;}}
                    checked={seleccionables.length>0&&selected.size>=seleccionables.length}
                    onChange={toggleAll} style={{cursor:'pointer'}}/>
                </th>
                {(() => {
                  const arrow = (f) => sortField === f ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
                  const Th = ({ f, children, className }) => (
                    <th className={className} onClick={() => handleSort(f)} style={{cursor:'pointer', userSelect:'none'}}>
                      {children}<span style={{color:'var(--brand)', fontWeight:700}}>{arrow(f)}</span>
                    </th>
                  );
                  return <>
                    <Th f="id">ID</Th>
                    <Th f="factura" className="hide-sm">Factura</Th>
                    <Th f="entidad">{entLabel}</Th>
                    {esCobrar && <Th f="modalidad">Modalidad</Th>}
                    {!esCobrar && <th className="dt-hide-mobile">Tipo</th>}
                    {/* Emisión: la fecha del documento del proveedor/cliente, no la de carga. En CxP
                        la columna `fecha_emision` se agregó el 2026-08-13 (migración 67) — antes solo
                        existía en CxC, y era el dato con el que se cruza la factura contra el papel. */}
                    <Th f="emision" className="hide-sm">Emisión</Th>
                    {/* CxP no tenía cuándo se cargó la cuenta: en "Todas" es justo lo que se busca. */}
                    {!esCobrar && esTabTodas && <Th f="creacion" className="hide-sm">Creación</Th>}
                    <Th f="vence" className="hide-sm">Vencimiento</Th>
                    <th className="dt-hide-mobile">Categoría</th>
                    <Th f="estado">Estado</Th>
                    <Th f="creado" className="dt-hide-mobile">Creado por</Th>
                    <Th f="monto" className="num hide-sm">Monto</Th>
                    <Th f="pagado" className="num hide-sm">Pagado</Th>
                    {/* En "Pagados" interesa CÓMO se pagó: van junto al monto pagado, no al final
                        de una tabla de 16 columnas donde habría que scrollear para verlas. */}
                    {pagosDeCxp && <>
                      <th className="hide-sm">Banco</th>
                      <th className="hide-sm">Forma de pago</th>
                      <th className="hide-sm">ID transacción</th>
                    </>}
                    <Th f="saldo" className="num">Saldo</Th>
                    {/* En la pestaña de saldados, "Progreso" (siempre 100%) cede el lugar a la
                        fecha en que se cobró/pagó, que es el dato que se busca ahí. */}
                    {esTabSaldados
                      ? <Th f="fechaCobro" className="hide-sm">{labelFechaPago}</Th>
                      : <Th f="progreso" className="hide-sm">Progreso</Th>}
                  </>;
                })()}
              </tr>
            </thead>
            <tbody>
              {groupBy && grouped ? (
                grouped.length === 0
                  ? <tr><td colSpan={colSpanTotal} className="empty">Sin documentos</td></tr>
                  : grouped.map(g => {
                      const open = expandedG.has(g.key);
                      const colKeySpan = (esCobrar ? 10 : 8) - 1;
                      return (
                        <React.Fragment key={g.key}>
                          <tr onClick={() => setExpandedG(prev => { const s=new Set(prev); s.has(g.key)?s.delete(g.key):s.add(g.key); return s; })}
                              style={{cursor:'pointer', background:'var(--bg-sunken)'}}>
                            <td style={{padding:'7px 10px'}}><Icon name={open?'chevronD':'chevronR'} size={13} style={{color:'var(--text-muted)'}}/></td>
                            <td colSpan={colKeySpan} style={{padding:'7px 10px', fontWeight:600}}>
                              {g.key} <span className="muted" style={{fontWeight:400, fontSize:11}}>· {g.rows.length} doc{g.rows.length!==1?'s':''}</span>
                            </td>
                            <td className="num hide-sm" style={{fontWeight:700}}>{fmt.usd(g.monto)}</td>
                            <td className="num hide-sm"></td>
                            {pagosDeCxp && <><td className="hide-sm"></td><td className="hide-sm"></td><td className="hide-sm"></td></>}
                            {!esCobrar && esTabTodas && <td className="hide-sm"></td>}
                            <td className="num strong-num" style={{fontWeight:700}}>{fmt.usd(g.saldo)}</td>
                            <td className="hide-sm"></td>
                          </tr>
                          {/* Agrupado por día: adentro del mes van los días, cada uno desplegable.
                              El resto de los agrupados abre directo en las filas. */}
                          {open && (g.sub
                            ? g.sub.map(sg => {
                                const sOpen = expandedG.has(sg.key);
                                return (
                                  <React.Fragment key={sg.key}>
                                    <tr onClick={() => setExpandedG(prev => { const s=new Set(prev); s.has(sg.key)?s.delete(sg.key):s.add(sg.key); return s; })}
                                        style={{cursor:'pointer', background:'var(--bg-elev)'}}>
                                      <td style={{padding:'6px 10px', paddingLeft:26}}>
                                        <Icon name={sOpen?'chevronD':'chevronR'} size={12} style={{color:'var(--text-muted)'}}/>
                                      </td>
                                      <td colSpan={colKeySpan} style={{padding:'6px 10px', fontWeight:600, fontSize:12.5}}>
                                        {sg.label} <span className="muted" style={{fontWeight:400, fontSize:11}}>· {sg.rows.length} doc{sg.rows.length!==1?'s':''}</span>
                                      </td>
                                      <td className="num hide-sm" style={{fontWeight:600}}>{fmt.usd(sg.monto)}</td>
                                      <td className="num hide-sm"></td>
                                      {pagosDeCxp && <><td className="hide-sm"></td><td className="hide-sm"></td><td className="hide-sm"></td></>}
                                      {!esCobrar && esTabTodas && <td className="hide-sm"></td>}
                                      <td className="num strong-num" style={{fontWeight:600}}>{fmt.usd(sg.saldo)}</td>
                                      <td className="hide-sm"></td>
                                    </tr>
                                    {sOpen && sg.rows.map(renderRow)}
                                  </React.Fragment>
                                );
                              })
                            : g.rows.map(renderRow))}
                        </React.Fragment>
                      );
                    })
              ) : (
                <>
                  {paginated.map(renderRow)}
                  {paginated.length===0 && <tr><td colSpan={colSpanTotal} className="empty">{(cobradosLoading || cobradosPagLoading) && usaCobrados ? 'Cargando cobradas…' : 'Sin documentos'}</td></tr>}
                </>
              )}
            </tbody>
          </table>
        </div>
        {/* ── Totales de lo FILTRADO ────────────────────────────────────────────────────────
            Se calculan sobre `rowsOrdenadas`, que es el conjunto ya filtrado por pestaña,
            categorías, rango de fechas y búsqueda — NO sobre la página visible: el total de las
            50 filas que se ven, de 300 que cumplen el filtro, no le sirve a nadie.
            Va en una barra y no en un <tfoot>: las columnas de esta tabla son condicionales
            (cambian por pestaña, por empresa y por si se muestran los datos del pago), y un pie
            espejado se desalinearía en silencio la próxima vez que alguien agregue una columna.
            Acá cada cifra dice a qué columna corresponde, así que no puede mentir. */}
        {rowsOrdenadas.length > 0 && (() => {
          const n = (v) => Number(v) || 0;
          const tot = rowsOrdenadas.reduce((a, r) => {
            const monto = n(r.monto), pagado = n(r.pagado);
            a.monto += monto; a.pagado += pagado; a.saldo += (monto - pagado);
            return a;
          }, { monto: 0, pagado: 0, saldo: 0 });
          const hayFiltro = (Array.isArray(catF) && catF.length) || search.trim() || fechaDesde || fechaHasta;
          const Cifra = ({ label, valor, fuerte }) => (
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>
              <span className="muted">{label}</span>
              <span className="mono" style={{ fontWeight: fuerte ? 700 : 600, fontSize: 13 }}>{fmt.usd(valor)}</span>
            </span>
          );
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '9px 16px',
                          borderTop: '2px solid var(--border)', background: 'var(--bg-sunken)', flexWrap: 'wrap', fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>
                Total{hayFiltro ? ' de lo filtrado' : ''}
                <span className="muted" style={{ fontWeight: 400 }}> · {rowsOrdenadas.length.toLocaleString('es-VE')} cuenta{rowsOrdenadas.length === 1 ? '' : 's'}</span>
              </span>
              <div style={{ display: 'flex', gap: 18, marginLeft: 'auto', flexWrap: 'wrap' }}>
                <Cifra label="Monto" valor={tot.monto} />
                <Cifra label={esCobrar ? 'Cobrado' : 'Pagado'} valor={tot.pagado} />
                <Cifra label="Saldo" valor={tot.saldo} fuerte />
              </div>
            </div>
          );
        })()}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px',borderTop:'1px solid var(--border)',fontSize:12,gap:10,flexWrap:'wrap'}}>
          {groupBy ? (
            <div className="muted">
              {(grouped||[]).length} {esDia ? 'mes' : 'grupo'}{(grouped||[]).length!==1?(esDia?'es':'s'):''} · {rowsOrdenadas.length.toLocaleString('es-VE')} documentos ·
              {esDia ? ' clic en un mes para ver sus días, y en un día para ver sus documentos' : ' clic en un grupo para expandir'}
            </div>
          ) : (
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span className="muted">Filas por página:</span>
            <select className="select" value={pageSize} onChange={e=>{setPageSize(parseInt(e.target.value));setPage(1);}} style={{fontSize:12,padding:'3px 6px'}}>
              {PAGE_SIZE_OPTS.map(n=><option key={n} value={n}>{n}</option>)}
            </select>
            <span className="muted">{rowsOrdenadas.length===0?'0':`Mostrando ${(page-1)*pageSize+1}–${Math.min(page*pageSize,rowsOrdenadas.length)} de ${rowsOrdenadas.length}`}</span>
          </div>
          )}
          {!groupBy && totalPages>1&&<div style={{display:'flex',gap:4}}>
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
            <span style={{fontSize:13,fontWeight:600}}>{selected.size} seleccionado{selected.size!==1?'s':''}</span>
          </div>
          <button className="btn ghost sm" onClick={exportAccountsXLSX}><Icon name="download" size={13}/>Exportar Excel</button>
          {window.canUser?.('editar', esCobrar?'cxc':'cxp') !== false && <button className="btn ghost sm" style={{color:'var(--success)'}} onClick={openPagoGlobal}><Icon name="dollar" size={13}/>{esCobrar?'Registrar cobros':'Registrar pagos'}</button>}
          {window.canUser?.('eliminar', esCobrar?'cxc':'cxp') !== false && <button className="btn ghost sm" onClick={bulkDelete} style={{color:'var(--danger)'}}><Icon name="trash" size={13}/>Eliminar</button>}
          <button className="icon-btn" onClick={()=>setSelected(new Set())} style={{marginLeft:4}}><Icon name="x" size={15}/></button>
        </div>
      )}

      {showNueva && (
        <NuevaCuentaModal
          esCobrar={esCobrar}
          onClose={() => setShowNueva(false)}
          onSaved={() => { setShowNueva(false); setVersion(v => v + 1); }}
        />
      )}
      {sel && <AccountDetailModal sel={sel} esCobrar={esCobrar} entities={entities} entKey={entKey} allRows={rows} onClose={()=>setSel(null)} onPay={(ent)=>{ setSel(null); setPayEntity(ent); }}/>}
      {showMermas && <MermasModal tipo={esCobrar ? 'cobrar' : 'pagar'} onClose={()=>setShowMermas(false)}/>}
      {pickPago && (
        <PickEntidadPagoModal
          rows={rows} esCobrar={esCobrar} entidadDeFila={entidadDeFila}
          onClose={() => setPickPago(false)}
          onPick={(g) => {
            setPickPago(false);
            // _selIds = las cuentas de ese grupo, así el modal abre con ellas marcadas
            // en vez de con todo lo del cliente.
            setPayEntity({ ...g.ent, _selIds: g.ids, _modalidadFiltro: g.mod });
          }}/>
      )}
      {payEntity && (esCobrar
        ? <RegisterPaymentModal cliente={payEntity} tipo="cobrar"
            deudas={rows.filter(r => r.cliente === payEntity.id && r.monto > r.pagado
              && (!payEntity._modalidadFiltro || (r.modalidad_pago || 'divisas') === payEntity._modalidadFiltro))}
            initialSel={payEntity._selIds}
            onClose={()=>{ setPayEntity(null); setSelected(new Set()); }}/>
        : <RegisterPaymentModal cliente={payEntity} tipo="pagar"
            deudas={rows.filter(r => (
              payEntity._esVuelto   ? (r.tipo === 'vuelto'   && r.cliente    === payEntity.id)
              : payEntity._esComision ? (r.tipo === 'comision' && r.vendedor_id === payEntity.id)
                                      : ((r.tipo || 'proveedor') !== 'vuelto' && (r.tipo || 'proveedor') !== 'comision' && r.proveedor === payEntity.id)
            ) && r.monto > r.pagado
              && (!payEntity._modalidadFiltro || (r.modalidad_pago || 'divisas') === payEntity._modalidadFiltro))}
            initialSel={payEntity._selIds}
            onClose={()=>{ setPayEntity(null); setSelected(new Set()); }}/>
      )}
    </div>
  );
}

// ── Modal: elegir a quién registrarle el cobro / pago ────────────────────────
// Se abre cuando se pulsa "Registrar cobros" sin haber seleccionado filas. Antes
// el botón tomaba la primera cuenta pendiente de la lista y abría ese cliente,
// que es arbitrario y confunde.
//
// En CxC se lista una fila por (cliente × modalidad de pago): un cliente puede
// deber en divisas y en Bs. a la vez, y esas facturas no se pueden cobrar juntas.
// Separarlas acá evita el segundo diálogo de "elegí modalidad".
const MODALIDAD_LABEL = { divisas: 'Divisas USD', bcv: 'Bs. BCV', paralelo: 'Bs. Paralelo' };

function PickEntidadPagoModal({ rows, esCobrar, entidadDeFila, onPick, onClose }) {
  const [q, setQ] = useState('');

  const grupos = React.useMemo(() => {
    const map = new Map();
    rows.filter(r => r.monto > r.pagado).forEach(r => {
      const ent = entidadDeFila(r);
      if (!ent) return;
      // La modalidad solo agrupa en CxC; en CxP no aplica.
      const mod = (esCobrar && !ent._esVuelto && !ent._esComision)
        ? (r.modalidad_pago || 'divisas') : null;
      const key = `${ent._esVuelto ? 'V' : ent._esComision ? 'C' : 'E'}|${ent.id}|${mod || ''}`;
      if (!map.has(key)) map.set(key, { ent, mod, n: 0, total: 0, ids: [] });
      const g = map.get(key);
      g.n += 1;
      g.total += (parseFloat(r.monto) || 0) - (parseFloat(r.pagado) || 0);
      g.ids.push(r.id);
    });
    // Cuántas modalidades tiene cada entidad, para mostrar la etiqueta solo si hay más de una.
    const modsPorEnt = new Map();
    [...map.values()].forEach(g => {
      const k = g.ent.id;
      modsPorEnt.set(k, (modsPorEnt.get(k) || new Set()).add(g.mod));
    });
    return [...map.values()]
      .map(g => ({ ...g, mostrarMod: (modsPorEnt.get(g.ent.id)?.size || 1) > 1 }))
      .sort((a, b) => b.total - a.total);
  }, [rows, esCobrar]);

  const term = q.trim().toLowerCase();
  const visibles = term
    ? grupos.filter(g => (g.ent.nombre || '').toLowerCase().includes(term)
                      || (g.ent.rif || '').toLowerCase().includes(term))
    : grupos;

  const totalGeneral = grupos.reduce((s, g) => s + g.total, 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-fullscreen-mobile" onClick={e => e.stopPropagation()}
           style={{ width: 620, maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--success-soft)',color:'var(--success)',display:'grid',placeItems:'center'}}>
            <Icon name="dollar" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">{esCobrar ? '¿A quién le vas a cobrar?' : '¿A quién le vas a pagar?'}</h3>
            <div className="small">
              {grupos.length} con saldo pendiente · total {fmt.usd(totalGeneral)}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        <div style={{padding:'12px 20px 0'}}>
          <input className="input" autoFocus placeholder={esCobrar ? 'Buscar cliente por nombre o RIF...' : 'Buscar proveedor...'}
                 value={q} onChange={e => setQ(e.target.value)}/>
          <div className="small muted" style={{marginTop:6}}>
            Tip: también podés seleccionar facturas en la tabla y pulsar el botón — se abre directo con esas.
          </div>
        </div>

        <div className="modal-body" style={{flex:1, overflowY:'auto'}}>
          {visibles.length === 0 && (
            <div className="small muted" style={{padding:'24px 0', textAlign:'center'}}>
              {grupos.length === 0 ? 'No hay cuentas con saldo pendiente.' : `Nadie coincide con «${q}».`}
            </div>
          )}
          <div style={{display:'flex', flexDirection:'column', gap:6}}>
            {visibles.map((g, i) => (
              <button key={i} className="btn ghost"
                      onClick={() => onPick(g)}
                      style={{display:'flex', alignItems:'center', gap:10, width:'100%',
                              justifyContent:'flex-start', textAlign:'left', padding:'10px 12px', height:'auto'}}>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontWeight:600, fontSize:13, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                    {g.ent.nombre || g.ent.id}
                    {g.ent._esVuelto   && <span className="chip amber" style={{marginLeft:6}}>Vuelto</span>}
                    {g.ent._esComision && <span className="chip blue"  style={{marginLeft:6}}>Comisión</span>}
                    {g.mostrarMod && g.mod && (
                      <span className="chip neutral" style={{marginLeft:6}}>{MODALIDAD_LABEL[g.mod] || g.mod}</span>
                    )}
                  </div>
                  <div className="small muted">
                    {g.n} {g.n === 1 ? 'cuenta' : 'cuentas'} pendiente{g.n === 1 ? '' : 's'}
                    {g.ent.rif ? ' · ' + g.ent.rif : ''}
                  </div>
                </div>
                <div style={{fontWeight:700, fontSize:14, whiteSpace:'nowrap'}}>{fmt.usd(g.total)}</div>
                <Icon name="chevronR" size={14}/>
              </button>
            ))}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: administrar categorías de CxC / CxP ───────────────────────────────
function CategoriasCtaModal({ tipo, onClose }) {
  const empresa = () => window.currentEmpresa || 'demo1';
  const getCats = () => (SSData.categoriasCuenta || []).filter(c => c.tipo === tipo);

  const [cats, setCats]   = useState(() => getCats());
  const [nueva, setNueva] = useState('');
  const [editing, setEditing]     = useState(null); // { id, nombre }
  const [deleteId, setDeleteId]   = useState(null);
  const [saving, setSaving]       = useState(false);
  const titulo = tipo === 'cobrar' ? 'Categorías de CxC' : 'Categorías de CxP';

  function refresh() {
    const updated = getCats();
    setCats(updated);
  }

  async function handleAdd() {
    const nombre = nueva.trim();
    if (!nombre || cats.some(c => c.nombre === nombre)) return;
    setSaving(true);
    const id = 'catcta-' + Date.now();
    const { error } = await window.sb.from('categorias_cuenta')
      .insert([{ id, nombre, tipo, empresa_id: empresa() }]);
    if (error) { alert('Error: ' + error.message); setSaving(false); return; }
    if (!SSData.categoriasCuenta) SSData.categoriasCuenta = [];
    SSData.categoriasCuenta.push({ id, nombre, tipo, empresa_id: empresa() });
    setNueva('');
    refresh();
    setSaving(false);
  }

  async function handleRename() {
    const nombre = editing.nombre.trim();
    if (!nombre || !editing.id) { setEditing(null); return; }
    setSaving(true);
    const { error } = await window.sb.from('categorias_cuenta')
      .update({ nombre }).eq('id', editing.id);
    if (error) { alert('Error: ' + error.message); setSaving(false); return; }
    const cat = SSData.categoriasCuenta.find(c => c.id === editing.id);
    if (cat) cat.nombre = nombre;
    setEditing(null);
    refresh();
    setSaving(false);
  }

  async function handleDelete(id) {
    setSaving(true);
    const cat = (SSData.categoriasCuenta || []).find(c => c.id === id);
    const { error } = await window.sb.from('categorias_cuenta').delete().eq('id', id);
    if (error) { alert('Error: ' + error.message); setSaving(false); return; }
    if (cat) window.ssTrash?.add('categoriaCuenta', cat.nombre, cat);   // a papelera tras borrar OK
    SSData.categoriasCuenta = (SSData.categoriasCuenta || []).filter(c => c.id !== id);
    window.logActivity?.({ modulo:'cxc', accion:'eliminar', entidad_id:id, entidad_label:cat?.nombre, detalles:{ tipo:'categoria_cuenta' } });
    setDeleteId(null);
    refresh();
    setSaving(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width:460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ width:40,height:40,borderRadius:10,background:'var(--accent-soft,var(--brand-soft))',color:'var(--accent,var(--brand))',display:'grid',placeItems:'center',flexShrink:0 }}>
            <Icon name="inventory" size={20}/>
          </div>
          <div style={{ flex:1 }}>
            <h3 className="modal-title">{titulo}</h3>
            <div className="small muted">{cats.length} categoría{cats.length!==1?'s':''}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        <div className="modal-body" style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {/* Agregar nueva */}
          <div style={{ display:'flex', gap:8 }}>
            <input
              className="input" style={{ flex:1 }}
              placeholder="Nueva categoría…"
              value={nueva}
              onChange={e => setNueva(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
            <button className="btn primary" disabled={!nueva.trim() || saving || cats.some(c=>c.nombre===nueva.trim())} onClick={handleAdd}>
              <Icon name="plus" size={14}/>Agregar
            </button>
          </div>

          {/* Lista */}
          <div style={{ border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
            {cats.length === 0 && (
              <div className="empty" style={{ padding:'20px 0' }}>Sin categorías — agrega la primera</div>
            )}
            {cats.map((cat, i) => (
              <div key={cat.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 12px', borderBottom: i < cats.length-1 ? '1px solid var(--border)' : 'none', background:'var(--bg-elev)' }}>
                {editing?.id === cat.id ? (
                  <>
                    <input
                      className="input" style={{ flex:1, padding:'4px 8px', fontSize:13 }}
                      value={editing.nombre}
                      onChange={e => setEditing(v => ({ ...v, nombre: e.target.value }))}
                      onKeyDown={e => { if(e.key==='Enter') handleRename(); if(e.key==='Escape') setEditing(null); }}
                      autoFocus
                    />
                    <button className="btn primary sm" disabled={saving} onClick={handleRename}>Guardar</button>
                    <button className="btn ghost sm" onClick={() => setEditing(null)}>Cancelar</button>
                  </>
                ) : deleteId === cat.id ? (
                  <>
                    <span style={{ flex:1, fontSize:13, color:'var(--danger)' }}>¿Eliminar «{cat.nombre}»?</span>
                    <button className="btn sm" style={{ background:'var(--danger)', color:'#fff' }} disabled={saving} onClick={() => handleDelete(cat.id)}>Eliminar</button>
                    <button className="btn ghost sm" onClick={() => setDeleteId(null)}>Cancelar</button>
                  </>
                ) : (
                  <>
                    <span style={{ flex:1, fontSize:13, fontWeight:500 }}>{cat.nombre}</span>
                    <button className="icon-btn" title="Renombrar" onClick={() => setEditing({ id:cat.id, nombre:cat.nombre })}><Icon name="edit" size={14}/></button>
                    <button className="icon-btn" title="Eliminar" style={{ color:'var(--danger)' }} onClick={() => setDeleteId(cat.id)}><Icon name="trash" size={14}/></button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: crear CxC / CxP manual ────────────────────────────────────────────
function NuevaCuentaModal({ esCobrar, onClose, onSaved }) {
  const hoy = window.localDateStr();
  const [form, setForm] = useState({
    entidadId:      '',
    factura:        '',
    concepto:       '',
    monto:          '',
    vence:          '',
    fecha_emision:  '',                                 // CxP: la fecha de la factura del proveedor
    modalidad_pago: 'divisas',
    categoria:      '',
    moneda:         'USD',                              // CxP: permite registrar en Bs.
    // Tasa Bs/USD para convertir a dólares — por defecto la tasa VUELTO (la misma que usa el pago
    // de la CxP en Bs., ver RegisterPaymentModal/esCompraProv), no la BCV. Editable por el usuario.
    tasa:           String(SSData.tasa?.vuelto || SSData.tasa?.paralelo || ''),
  });
  const [saving, setSaving]       = useState(false);
  const [errors, setErrors]       = useState([]);
  const [showCatAdmin, setShowCatAdmin] = useState(false);
  const [catVersion, setCatVersion]     = useState(0);
  const [quickCreateProv, setQuickCreateProv] = useState(null);   // null | nombre tecleado que no existe
  // "Registrar el pago ahora": una CxP muchas veces se carga cuando YA se pagó (compra de
  // contado, pago adelantado). Antes esto encadenaba el RegisterPaymentModal —un segundo modal
  // encima del primero— y había que volver a decir monto y fecha. Ahora el banco y la forma de
  // pago se eligen ACÁ y el resto (monto, moneda, tasa, proveedor) sale de la cuenta que se está
  // creando: un solo modal, un solo guardado. Los pagos parciales o en varios bancos siguen
  // haciéndose desde la lista con RegisterPaymentModal, que es el que sabe repartir.
  const [pagarAhora, setPagarAhora] = useState(false);
  // `montoBs` + `montoBsTocado`: el monto en bolívares es un dato propio del pago, no una conversión.
  // Mientras no se toque se sugiere (el de la cuenta si se registró en Bs.), y una vez editado manda
  // lo escrito — el banco tiene que reflejar el monto exacto que salió.
  const [pago, setPago] = useState({ cuentaId: '', metodo: '', referencia: '', fecha: hoy, tasa: '', montoBs: '', montoBsTocado: false });
  function setPagoCampo(k, v) { setPago(p => ({ ...p, [k]: v })); }
  const erroresRef = React.useRef(null);
  // Foto de la factura (solo CxP) — se guarda como base64 (redimensionada) en cuentas_pagar.foto.
  const [fotoFactura, setFotoFactura] = useState(null);
  const [fotoLoading, setFotoLoading] = useState(false);
  const [fotoError, setFotoError]     = useState('');
  async function handleFotoFactura(e) {
    const f = e.target.files?.[0];
    e.target.value = '';   // permite volver a elegir el mismo archivo
    if (!f) return;
    setFotoError(''); setFotoLoading(true);
    try { setFotoFactura(await window.resizeImageFile(f)); }
    catch (err) { setFotoError('No se pudo procesar la imagen: ' + (err.message || err)); }
    setFotoLoading(false);
  }

  const entidades   = esCobrar ? (SSData.clientes || []) : (SSData.proveedores || []);
  const entLabel    = esCobrar ? 'Cliente' : 'Proveedor';
  const titulo      = esCobrar ? 'Nueva Cuenta por Cobrar' : 'Nueva Cuenta por Pagar';
  const tipoStr     = esCobrar ? 'cobrar' : 'pagar';
  const categorias  = ((SSData.categoriasCuenta || []).filter(c => c.tipo === tipoStr)).map(c => c.nombre);
  const entidadOptions = entidades.map(e => ({ value: e.id, label: e.nombre, sublabel: e.rif || '' }));

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  // CxP puede registrarse en Bs.: se ingresa monto en Bs. + tasa y se guarda el equivalente en USD
  // (la moneda del sistema siempre es el dólar; con Bs. solo se convive convirtiendo por la tasa).
  const esBsCxP       = !esCobrar && form.moneda === 'VES';
  const tasaNum       = parseFloat(form.tasa) || 0;
  const montoIngresado = parseFloat(form.monto) || 0;
  const montoUSD      = esBsCxP ? (tasaNum > 0 ? Math.round((montoIngresado / tasaNum) * 100) / 100 : 0) : montoIngresado;

  // ── Pago en el mismo modal (solo CxP) ──────────────────────────────────────────────────────
  const bancosAll   = SSData.cuentasBancarias || [];
  const cuentaPago  = bancosAll.find(b => b.id === pago.cuentaId) || null;
  const monedaPago  = cuentaPago?.moneda || 'USD';
  // La tasa del pago en Bs.: si la CxP se registró en Bs. es LA MISMA tasa de la cuenta; si la CxP
  // está en USD, arranca en la de vuelto. Es SOLO referencia para saber a cuántos dólares equivale.
  const tasaPagoDef = esBsCxP ? tasaNum : (SSData.tasa?.vuelto || SSData.tasa?.paralelo || 0);
  const tasaPagoNum = monedaPago === 'VES' ? (parseFloat(pago.tasa) || tasaPagoDef) : 1;
  // EN BOLÍVARES MANDA EL MONTO EN BOLÍVARES. Antes el pago en Bs. se calculaba como
  // `montoUSD * tasa`, y `montoUSD` ya venía redondeado a 2 decimales: escribir 11.500 Bs terminaba
  // registrando 11.496,40 (y 10 Bs → 8,20). El banco tiene que decir exactamente lo que salió; la
  // tasa solo sirve para la referencia en dólares.
  const montoBsSugerido = esBsCxP ? montoIngresado : (Math.round(montoUSD * tasaPagoNum * 100) / 100);
  const montoPagoBs = pago.montoBsTocado
    ? (parseFloat(pago.montoBs) || 0)
    : montoBsSugerido;
  const montoPago = monedaPago === 'VES' ? montoPagoBs : montoUSD;
  // Dólares que el pago abona a la cuenta: en Bs. sale de dividir el monto exacto por la tasa.
  const usdDelPago = monedaPago === 'VES'
    ? (tasaPagoNum > 0 ? Math.round((montoPagoBs / tasaPagoNum) * 100) / 100 : 0)
    : montoUSD;
  // Métodos compatibles con la moneda de la cuenta elegida, y con la cuenta si ésta declara los suyos.
  const metodosPago = (() => {
    const cat = metodosPagoUI().filter(m => m.monedas.includes(monedaPago));
    const delBanco = (cuentaPago?.metodos_pago && cuentaPago.metodos_pago.length) ? cuentaPago.metodos_pago : null;
    return delBanco ? cat.filter(m => m.sin_banco || delBanco.includes(m.id)) : cat;
  })();
  const metodoSinBanco = !!metodosPagoUI().find(m => m.id === pago.metodo)?.sin_banco;

  function validate() {
    const e = [];
    if (!form.entidadId) e.push(esCobrar ? 'Selecciona un cliente' : 'Selecciona un proveedor');
    if (!form.monto || isNaN(parseFloat(form.monto)) || parseFloat(form.monto) <= 0) e.push('Ingresa un monto válido mayor a 0');
    if (esBsCxP && !(tasaNum > 0)) e.push('Ingresa la tasa (Bs/USD) para convertir a dólares');
    if (!form.vence) e.push('Selecciona la fecha de vencimiento');
    if (!form.factura && !form.concepto) e.push('Ingresa un N° de factura o un concepto');
    if (!form.categoria) e.push('Selecciona una categoría');
    if (!esCobrar && pagarAhora) {
      if (!pago.cuentaId && !metodoSinBanco) e.push('Elige el banco / cuenta desde donde se pagó');
      if (!pago.metodo) e.push('Elige la forma de pago');
      if (!pago.fecha)  e.push('Indica la fecha del pago');
      if (monedaPago === 'VES' && !(tasaPagoNum > 0)) e.push('Indica la tasa (Bs/USD) de referencia del pago');
      if (monedaPago === 'VES' && !(montoPagoBs > 0)) e.push('Indica el monto pagado en bolívares');
    }
    return e;
  }

  async function handleSave() {
    if (fotoLoading) return;   // defensa extra: no guardar mientras la foto aún se está procesando
    const e = validate();
    if (e.length) {
      setErrors(e);
      // Con el pago dentro del modal el cuerpo es alto y el aviso queda abajo, fuera de vista: se
      // hace visible o el usuario ve que el botón "no hace nada".
      setTimeout(() => erroresRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0);
      return;
    }
    setErrors([]);
    setSaving(true);
    const res = await window.crearCuentaManual({
      tipo:            esCobrar ? 'cobrar' : 'pagar',
      clienteId:       esCobrar ? form.entidadId : null,
      proveedorId:     esCobrar ? null : form.entidadId,
      factura:         form.factura || null,
      concepto:        form.concepto || null,
      monto:           montoUSD,
      vence:           form.vence,
      fecha_emision:   esCobrar ? null : (form.fecha_emision || null),
      modalidad_pago:  esCobrar ? form.modalidad_pago : null,
      categoria:       form.categoria || null,
      moneda:          esCobrar ? null : form.moneda,
      tasa:            esBsCxP ? tasaNum : null,
      foto:            esCobrar ? null : fotoFactura,
    });
    setSaving(false);
    if (res.error) { setErrors([res.error.message || 'Error al guardar']); return; }

    // CxP con "pagar ahora": el pago se registra acá mismo, con el monto y la moneda de la cuenta
    // que se acaba de crear. `crearCuentaManual` ya la dejó en SSData, que es de donde
    // registrarPagosCxP la lee para actualizar saldo, ledger `pagos` y el egreso bancario.
    if (!esCobrar && pagarAhora) {
      setSaving(true);
      const row = (SSData.cuentasPagar || []).find(c => c.id === res.id);
      if (!row) {
        setSaving(false);
        alert('La cuenta se creó, pero no se pudo registrar el pago acá. Regístralo desde la lista de CxP.');
        onSaved();
        return;
      }
      const pagoId = 'PAG-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
      const results = await window.registrarPagosCxP([{
        cxpId: res.id,
        // Lo que abona a la cuenta (en USD, que es como se lleva el saldo). En Bs. sale del monto
        // exacto en bolívares dividido por la tasa, no al revés.
        montoUsd: usdDelPago,
        pagosNuevos: [{
          id: pagoId, fecha: pago.fecha, metodo: pago.metodo,
          banco: cuentaPago?.banco || null, referencia: pago.referencia || null,
          // `monto` es lo que salió del banco EN SU MONEDA: en Bs. es el monto tal como se escribió.
          monto: montoPago, moneda: monedaPago, monto_usd: usdDelPago,
          tasa: monedaPago === 'VES' ? tasaPagoNum : null,
          notas: null,
        }],
      }]);
      setSaving(false);
      if ((results || []).some(r => r.error)) {
        // La CxP quedó creada y pendiente — que es un estado correcto, no data corrupta.
        alert('La cuenta se creó, pero el pago no se pudo registrar. Intentalo desde la lista de CxP.');
        onSaved();
        return;
      }
      window.logActivity?.({
        modulo: 'cxp', accion: 'editar', entidad_id: res.id, entidad_label: form.factura || res.id,
        // Queda el monto en la moneda en que se pagó, no solo su equivalente: si el dato original no
        // se registra, después no hay de dónde recuperarlo (pasó con los pagos en Bs. del 2026-08-03).
        detalles: { pago_al_crear: true, monto: montoPago, moneda: monedaPago,
                    tasa: monedaPago === 'VES' ? tasaPagoNum : null, monto_usd: usdDelPago,
                    banco: cuentaPago?.banco || null, metodo: pago.metodo },
      });
      // El pago mueve bancos y el saldo de la cuenta: recargar para que ambos queden al día.
      await window.refrescarFase2?.();
    }
    onSaved();
  }

  const hoyDate   = new Date(hoy + 'T00:00:00');
  const venceDate = form.vence ? new Date(form.vence + 'T00:00:00') : null;
  const diasHasta = venceDate ? Math.round((venceDate - hoyDate) / 86400000) : null;

  // Los modales anidados (crear proveedor, administrar categorías) van FUERA del overlay de este
  // modal, no adentro. Adentro, cualquier clic en ellos burbujeaba hasta el `onClick` del overlay
  // —que cerraba sin mirar el destino— y el modal de CxP se cerraba llevándose el de adelante: era
  // literalmente imposible terminar de registrar un proveedor nuevo (se reportó al hacer clic en el
  // campo RIF, pero pasaba con cualquier campo). El overlay además ahora solo cierra cuando el clic
  // es EN él (`e.target === e.currentTarget`), que es el criterio del resto de los modales.
  return (
    <>
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ width:40, height:40, borderRadius:10, background:'var(--brand-soft)', color:'var(--brand)', display:'grid', placeItems:'center', flexShrink:0 }}>
            <Icon name="dollar" size={20}/>
          </div>
          <div style={{ flex:1 }}>
            <h3 className="modal-title">{titulo}</h3>
            <div className="small muted">Registro manual · {esCobrar ? 'CxC' : 'CxP'}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        <div className="modal-body" style={{ display:'flex', flexDirection:'column', gap:14 }}>

          {/* Entidad — con búsqueda; si el proveedor no existe, se puede crear sin salir del modal */}
          <div>
            <label className="label">{entLabel} *</label>
            <SearchSelect
              value={form.entidadId}
              onChange={v => set('entidadId', v)}
              options={entidadOptions}
              placeholder={`Buscar ${entLabel.toLowerCase()}...`}
              style={{ width:'100%' }}
              createOptions={esCobrar ? [] : [
                { label: 'Crear proveedor "{q}"', icon: 'plus', onSelect: q => setQuickCreateProv(q) },
              ]}
            />
          </div>

          {/* Factura y concepto */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div>
              <label className="label">N° Factura / Doc.</label>
              <input className="input" placeholder="FAC-2026-001" value={form.factura} onChange={e => set('factura', e.target.value)}/>
            </div>
            <div>
              <label className="label">Concepto{!esCobrar ? '' : ' (opcional)'}</label>
              <input className="input" placeholder={esCobrar ? 'Descripción opcional…' : 'Descripción del cargo'} value={form.concepto} onChange={e => set('concepto', e.target.value)}/>
            </div>
          </div>

          {/* Foto de la factura — solo CxP */}
          {!esCobrar && (
            <div>
              <label className="label">Foto de la factura (opcional)</label>
              {fotoFactura ? (
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <img src={fotoFactura} alt="Factura" style={{ width:64, height:64, objectFit:'cover', borderRadius:8, border:'1px solid var(--border)', cursor:'pointer' }}
                    onClick={() => window.open(fotoFactura, '_blank')}/>
                  <button type="button" className="btn ghost sm" onClick={() => setFotoFactura(null)}>
                    <Icon name="trash" size={13}/>Quitar
                  </button>
                </div>
              ) : (
                <label className="btn secondary sm" style={{ display:'inline-flex', cursor: fotoLoading ? 'wait' : 'pointer' }}>
                  <Icon name="upload" size={13}/>{fotoLoading ? 'Procesando…' : 'Subir foto'}
                  <input type="file" accept="image/*" capture="environment" style={{ display:'none' }} disabled={fotoLoading} onChange={handleFotoFactura}/>
                </label>
              )}
              {fotoError && <div className="small mt-1" style={{ color:'var(--danger)' }}>{fotoError}</div>}
            </div>
          )}

          {/* Monto, emisión y vencimiento */}
          <div style={{ display:'grid', gridTemplateColumns: esCobrar ? '1fr 1fr' : '1fr 1fr 1fr', gap:12 }}>
            <div>
              <label className="label">Monto {esBsCxP ? '(Bs.)' : '(USD)'} *</label>
              {!esCobrar && (
                <div className="seg" style={{ marginBottom:6 }}>
                  <button type="button" className={form.moneda==='USD'?'on':''} onClick={()=>set('moneda','USD')}>$ USD</button>
                  <button type="button" className={form.moneda==='VES'?'on':''} onClick={()=>set('moneda','VES')}>Bs. VES</button>
                </div>
              )}
              <div style={{ position:'relative' }}>
                <span style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)', fontSize:13 }}>{esBsCxP ? 'Bs' : '$'}</span>
                <input className="input" style={{ paddingLeft: esBsCxP?26:22 }} type="number" min="0" step="0.01" placeholder="0.00" value={form.monto} onChange={e => set('monto', e.target.value)}/>
              </div>
              {esBsCxP && (
                <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:6 }}>
                  <span className="small muted" style={{ whiteSpace:'nowrap' }} title="Por defecto la tasa Vuelto del header — editable">Tasa Bs/USD (Vuelto):</span>
                  <input className="input mono" type="number" min="0" step="0.01" value={form.tasa} onChange={e=>set('tasa', e.target.value)} style={{ width:104, padding:'3px 8px', fontSize:12 }}/>
                  <span className="small" style={{ fontWeight:600, color:'var(--brand)' }}>≈ ${montoUSD.toFixed(2)}</span>
                </div>
              )}
            </div>
            {/* Fecha de EMISIÓN de la factura del proveedor (pedido el 2026-08-13). No es
                `created_at` —cuándo se cargó acá— ni el vencimiento: es la fecha del papel, que es
                con la que se cruza contra el proveedor y con la que la contadora arma el período.
                Opcional: hay cuentas que se cargan sin la factura a la vista. */}
            {!esCobrar && (
              <div>
                <label className="label">Fecha de emisión</label>
                <input className="input" type="date" max={hoy} value={form.fecha_emision}
                       onChange={e => set('fecha_emision', e.target.value)}/>
                <div className="small muted mt-1">La de la factura del proveedor</div>
              </div>
            )}
            <div>
              <label className="label">Fecha de vencimiento *</label>
              <input className="input" type="date" value={form.vence} onChange={e => set('vence', e.target.value)}/>
              {diasHasta !== null && (
                <div className="small mt-1" style={{ color: diasHasta < 0 ? 'var(--danger)' : diasHasta <= 7 ? 'var(--warn)' : 'var(--text-muted)' }}>
                  {diasHasta < 0 ? `Vencida hace ${Math.abs(diasHasta)} día${Math.abs(diasHasta)!==1?'s':''}` :
                   diasHasta === 0 ? 'Vence hoy' :
                   `Vence en ${diasHasta} día${diasHasta!==1?'s':''}`}
                </div>
              )}
            </div>
          </div>

          {/* Modalidad — solo CxC */}
          {esCobrar && (
            <div>
              <label className="label">Modalidad de pago *</label>
              <div style={{ display:'flex', gap:8 }}>
                {[['divisas','Divisas USD'],['bcv','Tasa BCV'],['paralelo','Tasa Paralelo']].map(([v,l]) => (
                  <label key={v} onClick={() => set('modalidad_pago', v)} style={{
                    flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                    padding:'9px 10px', border:`2px solid ${form.modalidad_pago===v?'var(--brand)':'var(--border)'}`,
                    borderRadius:8, cursor:'pointer', fontSize:12.5, fontWeight:500,
                    background: form.modalidad_pago===v ? 'var(--brand-soft)' : 'var(--bg-elev)',
                    color: form.modalidad_pago===v ? 'var(--brand)' : 'var(--text)',
                    transition:'all .15s',
                  }}>
                    <div style={{ width:14, height:14, borderRadius:'50%', border:`2px solid ${form.modalidad_pago===v?'var(--brand)':'var(--border)'}`, background: form.modalidad_pago===v?'var(--brand)':'transparent', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      {form.modalidad_pago===v && <div style={{ width:6, height:6, borderRadius:'50%', background:'#fff' }}/>}
                    </div>
                    {l}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Categoría */}
          <div>
            <label className="label">Categoría *</label>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <select key={catVersion} className="select" style={{ flex:1 }} value={form.categoria} onChange={e => set('categoria', e.target.value)}>
                <option value="" disabled>Selecciona una categoría…</option>
                {categorias.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button type="button" className="btn ghost sm" onClick={() => setShowCatAdmin(true)} title="Administrar categorías" style={{ whiteSpace:'nowrap', flexShrink:0 }}>
                <Icon name="settings" size={13}/> Administrar
              </button>
            </div>
          </div>

          {/* Pagar de una vez — solo CxP. El pago se completa ACÁ, sin abrir otro modal. */}
          {!esCobrar && (
            <div style={{ background: pagarAhora ? 'var(--brand-soft)' : 'var(--bg-sunken)',
                          border:`1px solid ${pagarAhora ? 'var(--brand)' : 'var(--border)'}`,
                          borderRadius:8, padding:'10px 13px', transition:'all .15s' }}>
              <label style={{ display:'flex', alignItems:'flex-start', gap:9, cursor:'pointer' }}>
                <input type="checkbox" checked={pagarAhora} onChange={e => setPagarAhora(e.target.checked)}
                       style={{ marginTop:2, flexShrink:0 }}/>
                <div>
                  <div style={{ fontSize:12.5, fontWeight:600 }}>Registrar el pago ahora</div>
                  <div className="small muted" style={{ marginTop:2 }}>
                    Para una compra que ya está pagada. Elige el banco y la forma de pago acá mismo:
                    el monto, la moneda y la tasa los toma de esta cuenta.
                  </div>
                </div>
              </label>

              {pagarAhora && (
                <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:10 }}>
                  {/* Banco / cuenta — define la moneda del pago (igual que en el modal de pagos) */}
                  <div>
                    <label className="label">Banco / cuenta {metodoSinBanco ? '' : '*'}</label>
                    {bancosAll.length === 0 && !window.__ssExtrasReady ? (
                      // Las cuentas llegan en Fase 2. Sin ellas no se ofrece un campo libre: un pago
                      // sin `cuenta_bancaria_id` no aparece en ninguna cuenta de Bancos.
                      <div className="small muted" style={{ display:'flex', alignItems:'center', gap:7, padding:'8px 10px', background:'var(--bg-sunken)', borderRadius:8 }}>
                        <span className="ss-busy-spin"/>Cargando las cuentas bancarias…
                      </div>
                    ) : (
                      <select className="select" style={{ width:'100%' }} value={pago.cuentaId}
                              onChange={e => { setPagoCampo('cuentaId', e.target.value); setPagoCampo('metodo', ''); }}>
                        <option value="">— Seleccionar banco —</option>
                        {bancosAll.map(b => (
                          <option key={b.id} value={b.id}>{b.banco} · {b.moneda}{b.cuenta ? ' — ' + String(b.cuenta).slice(-4) : ''}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Forma de pago — filtrada por la moneda de la cuenta y por lo que ese banco ofrece */}
                  <div>
                    <label className="label">Forma de pago *</label>
                    <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
                      {metodosPago.map(m => (
                        <div key={m.id} onClick={() => setPagoCampo('metodo', m.id)} style={{
                          display:'flex', alignItems:'center', gap:6, padding:'6px 11px',
                          border:`1.5px solid ${pago.metodo === m.id ? 'var(--brand)' : 'var(--border)'}`,
                          borderRadius:8, cursor:'pointer', fontSize:12, fontWeight: pago.metodo === m.id ? 600 : 400,
                          background: pago.metodo === m.id ? 'var(--brand-soft)' : 'var(--bg-elev)',
                          color: pago.metodo === m.id ? 'var(--brand)' : 'var(--text-muted)',
                        }}>
                          <Icon name={m.icon} size={13}/>{m.l}
                        </div>
                      ))}
                      {metodosPago.length === 0 && (
                        <div className="small muted">Elige primero el banco para ver sus formas de pago.</div>
                      )}
                    </div>
                  </div>

                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                    <div>
                      <label className="label">Fecha del pago *</label>
                      <input type="date" className="input" style={{ width:'100%' }} value={pago.fecha}
                             onChange={e => setPagoCampo('fecha', e.target.value)}/>
                    </div>
                    <div>
                      <label className="label">Referencia</label>
                      <input className="input" style={{ width:'100%' }} value={pago.referencia}
                             onChange={e => setPagoCampo('referencia', e.target.value)} placeholder="N° de transferencia, Zelle…"/>
                    </div>
                  </div>

                  {/* En bolívares MANDA el monto en bolívares: es lo que salió del banco. La tasa
                      solo dice a cuántos dólares equivale (y es lo que abona a la cuenta). */}
                  {monedaPago === 'VES' && (
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                      <div>
                        <label className="label">Monto pagado (Bs.) *</label>
                        <input className="input mono" type="number" min="0" step="0.01" style={{ width:'100%' }}
                               value={pago.montoBsTocado ? pago.montoBs : (montoBsSugerido ? String(montoBsSugerido) : '')}
                               placeholder="0.00"
                               onChange={e => { setPagoCampo('montoBs', e.target.value); setPagoCampo('montoBsTocado', true); }}/>
                        <div className="small muted" style={{ marginTop:3 }}>
                          Exactamente lo que salió del banco. Equivale a <strong>{fmt.usd(usdDelPago)}</strong>.
                        </div>
                      </div>
                      <div>
                        <label className="label">Tasa de referencia (Bs/USD) *</label>
                        <input className="input mono" type="number" min="0" step="0.0001" style={{ width:'100%' }}
                               value={pago.tasa} placeholder={tasaPagoDef ? String(tasaPagoDef) : '0.00'}
                               onChange={e => setPagoCampo('tasa', e.target.value)}/>
                        <div className="small muted" style={{ marginTop:3 }}>
                          {esBsCxP ? 'La misma con la que se registró la cuenta.' : 'Por defecto, la tasa de vuelto.'}
                          {' '}Solo convierte a dólares; no cambia el monto en Bs.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Qué se va a registrar, en una línea */}
                  {montoUSD > 0 && (
                    <div style={{ background:'var(--bg-elev)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 12px', fontSize:12.5, display:'flex', justifyContent:'space-between', gap:10, alignItems:'center' }}>
                      <span className="muted">
                        Sale del banco{cuentaPago ? ' ' + cuentaPago.banco : ''}
                        {monedaPago === 'VES' && tasaPagoNum > 0 ? ` · abona ${fmt.usd(usdDelPago)} @ ${tasaPagoNum}` : ''}
                      </span>
                      <span style={{ fontWeight:700, fontFamily:'monospace', color:'var(--brand)', whiteSpace:'nowrap' }}>
                        {monedaPago === 'VES' ? fmt.bs(montoPago) : fmt.usd(montoPago)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Preview */}
          {form.monto && parseFloat(form.monto) > 0 && form.entidadId && (
            <div style={{ background:'var(--bg-sunken)', borderRadius:8, padding:'10px 14px', fontSize:12.5, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span className="muted">
                {entidades.find(e => e.id === form.entidadId)?.nombre || '—'}
                {form.factura ? ` · ${form.factura}` : ''}
              </span>
              <span style={{ fontWeight:700, fontSize:15, color:'var(--brand)', fontFamily:'monospace' }}>
                {fmt.usd(parseFloat(form.monto) || 0)}
              </span>
            </div>
          )}

          {/* Errores */}
          {errors.length > 0 && (
            <div ref={erroresRef} style={{ background:'var(--danger-soft)', border:'1px solid var(--danger)', borderRadius:8, padding:'10px 14px', fontSize:12.5, color:'var(--danger)' }}>
              <strong>Corrige lo siguiente:</strong>
              <ul style={{ marginTop:4, paddingLeft:16 }}>
                {errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose}>Cancelar</button>
          <button className="btn primary" onClick={handleSave} disabled={saving || fotoLoading} title={fotoLoading ? 'Espera a que termine de procesarse la foto' : undefined}>
            <Icon name="plus" size={14}/>{saving ? 'Guardando…' : fotoLoading ? 'Procesando foto…'
              : (esCobrar ? 'Crear CxC' : (pagarAhora ? 'Crear y pagar' : 'Crear CxP'))}
          </button>
        </div>
      </div>
    </div>
    {showCatAdmin && (
      <CategoriasCtaModal
        tipo={tipoStr}
        onClose={() => { setShowCatAdmin(false); setCatVersion(v => v + 1); }}
      />
    )}
    {quickCreateProv !== null && (
      <NewProveedorModal
        initialNombre={quickCreateProv}
        onClose={() => setQuickCreateProv(null)}
        onSave={newProv => { set('entidadId', newProv.id); setQuickCreateProv(null); }}
      />
    )}
    </>
  );
}

// ─── Modal: editar una CxP antes de que se pague ─────────────────────────────
// Pedido explícito: "puede que haya errores de tasa o de moneda" al cargar la cuenta — antes no
// había forma de corregirlos sin borrar y recrear. Solo monto/moneda/tasa/vencimiento/categoría/
// factura — NO el proveedor (cambiar el dueño de la deuda es otra operación) y NO se puede tocar
// si ya está 'pagada' (ver `window.editarCuentaManual`, que revalida esto en el servidor).
function EditarCxPModal({ cuenta, onClose, onSaved }) {
  const [form, setForm] = React.useState({
    factura: cuenta.factura || '', concepto: cuenta.concepto || '',
    monto: String(cuenta.monto ?? ''), vence: cuenta.vence || '',
    fecha_emision: cuenta.fecha_emision || '',
    categoria: cuenta.categoria || '', moneda: cuenta.moneda || 'USD',
    tasa: String(cuenta.tasa ?? ''),
  });
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState([]);
  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }
  const categorias = (SSData.categoriasCuenta || []).filter(c => c.tipo === 'pagar').map(c => c.nombre);
  const esBs = form.moneda === 'VES';
  const tasaNum = parseFloat(form.tasa) || 0;
  const montoIngresado = parseFloat(form.monto) || 0;
  const montoUSD = esBs ? (tasaNum > 0 ? Math.round((montoIngresado / tasaNum) * 100) / 100 : 0) : montoIngresado;

  function validate() {
    const e = [];
    if (!form.monto || montoIngresado <= 0) e.push('Ingresa un monto válido mayor a 0');
    if (esBs && tasaNum <= 0) e.push('Ingresa la tasa (Bs/USD) para convertir a dólares');
    if (!form.vence) e.push('Selecciona la fecha de vencimiento');
    if (!form.factura && !form.concepto) e.push('Ingresa un N° de factura o un concepto');
    if (!form.categoria) e.push('Selecciona una categoría');
    return e;
  }
  async function handleSave() {
    const e = validate();
    if (e.length) { setErrors(e); return; }
    setErrors([]); setSaving(true);
    const { error } = await window.editarCuentaManual({
      id: cuenta.id, factura: form.factura || null, concepto: form.concepto || null,
      monto: montoUSD, vence: form.vence, categoria: form.categoria || null,
      moneda: form.moneda, tasa: esBs ? tasaNum : null,
      // Editable a propósito: las 268 cuentas que ya existían (y las migradas de Odoo) nacieron
      // sin fecha de emisión y este es el único camino para completarla.
      fecha_emision: form.fecha_emision || null,
    });
    setSaving(false);
    if (error) { setErrors([error.message || 'Error al guardar']); return; }
    onSaved?.();
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-fullscreen-mobile" onClick={e => e.stopPropagation()} style={{ width: 480 }}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}>
            <Icon name="edit" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">Editar cuenta por pagar</h3>
            <div className="small">{(SSData.proveedores || []).find(p => p.id === cuenta.proveedor_id)?.nombre || cuenta.proveedor_id}</div>
          </div>
          <button className="btn ghost sm" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <div className="modal-body" style={{display:'flex', flexDirection:'column', gap:12}}>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
            <div>
              <label className="form-label">N° de factura</label>
              <input className="input" value={form.factura} onChange={e => set('factura', e.target.value)}/>
            </div>
            <div>
              <label className="form-label">Concepto</label>
              <input className="input" value={form.concepto} onChange={e => set('concepto', e.target.value)}/>
            </div>
          </div>
          <div style={{display:'grid', gridTemplateColumns: esBs ? '1fr 1fr 1fr' : '1fr 1fr', gap:10}}>
            <div>
              <label className="form-label">Moneda</label>
              <select className="input" value={form.moneda} onChange={e => set('moneda', e.target.value)}>
                <option value="USD">USD</option>
                <option value="VES">Bolívares</option>
              </select>
            </div>
            <div>
              <label className="form-label">Monto ({form.moneda}) *</label>
              <input className="input" type="number" step="0.01" value={form.monto} onChange={e => set('monto', e.target.value)}/>
            </div>
            {esBs && (
              <div>
                <label className="form-label">Tasa (Bs/USD) *</label>
                <input className="input" type="number" step="0.01" value={form.tasa} onChange={e => set('tasa', e.target.value)}/>
              </div>
            )}
          </div>
          {esBs && (
            <div style={{background:'var(--bg-sunken)', borderRadius:8, padding:'8px 12px', fontSize:12.5}}>
              Equivale a <strong>{fmt.usd(montoUSD)}</strong>
            </div>
          )}
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10}}>
            <div>
              <label className="form-label">Emisión</label>
              <input className="input" type="date" value={form.fecha_emision} onChange={e => set('fecha_emision', e.target.value)}/>
            </div>
            <div>
              <label className="form-label">Vencimiento *</label>
              <input className="input" type="date" value={form.vence} onChange={e => set('vence', e.target.value)}/>
            </div>
            <div>
              <label className="form-label">Categoría *</label>
              <select className="input" value={form.categoria} onChange={e => set('categoria', e.target.value)}>
                <option value="" disabled>Selecciona una categoría…</option>
                {categorias.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          {errors.length > 0 && (
            <div style={{ background:'var(--danger-soft)', border:'1px solid var(--danger)', borderRadius:8, padding:'10px 14px', fontSize:12.5, color:'var(--danger)' }}>
              <strong>Corrige lo siguiente:</strong>
              <ul style={{ marginTop:4, paddingLeft:16 }}>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: la CxC que se quiere borrar salió de una factura ─────────────────
// Borrar solo la cuenta deja la venta a medias: la factura sigue viva, con su mercancía
// prometida, y ya no hay nada que cobrar. Se muestran las dos salidas con su consecuencia
// escrita, porque son decisiones distintas y ninguna es obviamente la correcta.
function BorrarCxcConFacturaModal({ info, onClose, onSoloCuenta, onConFactura }) {
  const [obrando, setObrando] = React.useState('');
  const [motivo, setMotivo] = React.useState('');
  const facturas = info.conFactura || [];
  const cuentas  = info.targets || [];
  // Solo devuelve inventario lo que YA salió del almacén: una factura `por_despachar` nunca
  // descontó nada (el débito ocurre al despachar), así que ahí no hay nada que devolver.
  const salieron = facturas.filter(f => f.estado_despacho === 'despachada' || f.estado_despacho === 'parcial');
  const cobrado  = cuentas.reduce((s, c) => s + (parseFloat(c.pagado) || 0), 0);
  const motivoOk = motivo.trim().length >= 10;

  async function correr(fn, cual) { setObrando(cual); await fn(cual === 'factura' ? motivo.trim() : undefined); setObrando(''); }

  return (
    <div className="modal-overlay" onClick={obrando ? undefined : onClose}>
      <div className="modal" style={{ width: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--warn-soft,#fef3c7)',color:'var(--warn)',display:'grid',placeItems:'center',flexShrink:0}}>
            <Icon name="alert" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">Esta cuenta por cobrar salió de una factura</h3>
            <div className="small muted">
              {cuentas.length} cuenta{cuentas.length!==1?'s':''} · factura{facturas.length!==1?'s':''}{' '}
              <span className="mono">{facturas.map(f => f.id).join(', ')}</span>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} disabled={!!obrando}><Icon name="x" size={16}/></button>
        </div>

        <div className="modal-body" style={{display:'flex',flexDirection:'column',gap:12}}>
          {cobrado > 0.005 && (
            <div style={{background:'var(--danger-soft,#fee2e2)',border:'1px solid var(--danger)',borderRadius:8,padding:'10px 13px',fontSize:12.5,color:'var(--danger)'}}>
              <strong>Ojo:</strong> ya hay {fmt.usd(cobrado)} cobrado{cuentas.length>1?'s':''} en esta{cuentas.length>1?'s':''} cuenta{cuentas.length>1?'s':''}.
              Borrarla no devuelve ese dinero ni toca el banco — el pago queda registrado sin cuenta a la que imputarse.
            </div>
          )}

          <div style={{border:'1px solid var(--border)',borderRadius:9,padding:'12px 14px'}}>
            <div style={{fontWeight:600,fontSize:13}}>Eliminar solo la cuenta por cobrar</div>
            <div className="small muted" style={{marginTop:3}}>
              La factura <strong>sigue existiendo</strong> y su mercancía sigue prometida, pero deja de figurar
              como algo por cobrar. Sirve si la cuenta se creó de más y la factura es correcta.
            </div>
            <button className="btn secondary sm" style={{marginTop:9}} disabled={!!obrando}
                    onClick={() => correr(onSoloCuenta, 'cuenta')}>
              {obrando === 'cuenta' ? 'Eliminando…' : 'Eliminar solo la cuenta'}
            </button>
          </div>

          <div style={{border:'1px solid var(--danger)',borderRadius:9,padding:'12px 14px'}}>
            <div style={{fontWeight:600,fontSize:13,color:'var(--danger)'}}>Anular también la factura completa</div>
            <div className="small muted" style={{marginTop:3}}>
              Anula la{facturas.length!==1?'s':''} factura{facturas.length!==1?'s':''}, borra su cuenta por cobrar y genera la
              devolución. {salieron.length > 0
                ? <>Devuelve al inventario lo de <strong>{salieron.map(f => f.id).join(', ')}</strong>, que ya había salido del almacén.</>
                : <>No devuelve inventario: {facturas.length!==1?'ninguna':'la factura'} llegó a despacharse, así que la mercancía nunca se descontó.</>}
              {' '}La factura NO se borra: queda visible en la pestaña "Anuladas" de Facturas, con su
              correlativo intacto.
            </div>
            <textarea className="input" rows={2} placeholder="Motivo de la anulación (mínimo 10 caracteres)…"
              value={motivo} onChange={e => setMotivo(e.target.value)}
              style={{marginTop:9, resize:'vertical', minHeight:52, fontSize:12.5, width:'100%'}}/>
            <button className="btn sm" style={{marginTop:9, background:'var(--danger)', color:'#fff'}}
                    disabled={!!obrando || !motivoOk}
                    onClick={() => correr(onConFactura, 'factura')}>
              {obrando === 'factura' ? 'Anulando…' : 'Anular cuenta y factura'}
            </button>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={!!obrando}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function AccountDetailModal({ sel, esCobrar, entities, entKey, allRows, onClose, onPay }) {
  const { doc, ent } = sel;
  const saldo = doc.monto - doc.pagado;
  const pct = (doc.pagado / doc.monto) * 100;
  const otrasDeudas = allRows.filter(r => r[entKey] === doc[entKey] && r.id !== doc.id);
  const totalEntidad = allRows.filter(r => r[entKey] === doc[entKey]).reduce((s,r)=>s+(r.monto-r.pagado),0);
  // La pestaña "Cobradas" es paginada server-side (`loadCuentasCobradas`) y arma cada fila desde
  // `documentos` sin traer `pagos` ni el `id` real de la cuenta (usa el id de la FACTURA, más
  // liviano para 25 mil filas) — por eso `doc.pagos` viene vacío acá y el historial no salía. Se
  // busca la cuenta real on-demand, mismo patrón que ya usan retenciones/anticipos abajo.
  const [ccReal, setCcReal] = React.useState(null);
  const [editando, setEditando] = React.useState(false);
  React.useEffect(() => {
    if (!esCobrar || !doc._cobrada || !doc.factura) { setCcReal(null); return; }
    let vivo = true;
    window.sb.from('cuentas_cobrar').select('id, pagos').eq('factura', doc.factura).maybeSingle()
      .then(({ data }) => { if (vivo) setCcReal(data || null); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [esCobrar, doc._cobrada, doc.factura]);
  const cuentaId = ccReal?.id || doc.id;
  const pagos = Array.isArray(ccReal?.pagos) ? ccReal.pagos : (Array.isArray(doc.pagos) ? doc.pagos : []);
  const [abriendoFactura, setAbriendoFactura] = React.useState(false);
  // Las retenciones NO viven en el jsonb `pagos` sino en su propia tabla, así que no aparecían en
  // ningún historial: la cuenta se saldaba y no se veía por qué. Se piden por cuenta y por
  // documento (una retención puede haberse cargado por cualquiera de los dos caminos).
  const [retenciones, setRetenciones] = React.useState([]);
  React.useEffect(() => {
    let vivo = true;
    window.retencionesDeCuenta?.({ cuentaId, documentoId: doc.factura })
      .then(r => { if (vivo && !r?.error) setRetenciones(r.data || []); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [cuentaId, doc.factura]);
  const totalRetenido = retenciones.reduce((s, r) => s + (Math.abs(parseFloat(r.monto_usd)) || 0), 0);
  // Anticipos aplicados a ESTA cuenta: no viven en el jsonb `pagos` (aplicar_anticipo actualiza
  // `pagado` directo, sin pasar por el ledger de pagos), así que "Pagado" podía no cuadrar contra
  // lo que mostraba el historial — el cliente pagó parte por banco y parte con saldo a favor, y
  // solo se veía la parte de banco. Se piden aparte, mismo patrón que `retenciones` arriba.
  const [anticiposAplicados, setAnticiposAplicados] = React.useState([]);
  React.useEffect(() => {
    if (!esCobrar) return;
    let vivo = true;
    window.sb.from('anticipos_aplicaciones').select('*').eq('cuenta_cobrar_id', cuentaId)
      .then(({ data }) => { if (vivo) setAnticiposAplicados(data || []); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [cuentaId, esCobrar]);
  // Movimiento bancario de cada pago del historial — el id del pago (antes de '::') es
  // `movimientos_bancarios.pago_id`. Se resuelve on-demand: son a lo sumo un puñado de pagos por
  // cuenta, no se justifica el mecanismo por-página que ya tiene la lista de CxP (`movsPorPago`).
  const [movsDePagos, setMovsDePagos] = React.useState({});
  React.useEffect(() => {
    const bases = [...new Set(pagos.map(p => String(p.id || '').split('::')[0]).filter(Boolean))];
    if (!bases.length) return;
    let vivo = true;
    window.sb.from('movimientos_bancarios').select('id,pago_id,cuenta_bancaria_id').in('pago_id', bases)
      .then(({ data }) => {
        if (!vivo) return;
        const m = {};
        (data || []).forEach(r => { m[r.pago_id] = r; });
        setMovsDePagos(m);
      }).catch(() => {});
    return () => { vivo = false; };
  }, [pagos]);
  // Merma de residuo: dar de baja el saldo mínimo incobrable/impagable (diferencia cambiaria).
  const [mermaOpen, setMermaOpen]     = React.useState(false);
  const [mermaMotivo, setMermaMotivo] = React.useState('');
  const [mermaSaving, setMermaSaving] = React.useState(false);
  const [mermaErr, setMermaErr]       = React.useState('');
  const canMerma = window.canUser?.('editar', esCobrar ? 'cxc' : 'cxp') !== false;
  // Visor de imagen (foto de factura CxP / comprobante de pago CxC) — carga on-demand: ninguna
  // de las dos viaja en la carga masiva de cuentas_pagar/pagos (ver getCxpFoto/getPagoComprobante).
  const [imgViewer, setImgViewer]   = React.useState(null); // dataURL | null
  const [imgLoading, setImgLoading] = React.useState(false);
  async function verFotoFactura() {
    setImgLoading(true);
    const { data, error } = await window.getCxpFoto(doc.id);
    setImgLoading(false);
    if (error) { alert('Error al cargar la foto: ' + (error.message || 'intenta de nuevo.')); return; }
    if (!data) { alert('Esta cuenta no tiene foto de factura adjunta.'); return; }
    setImgViewer(data);
  }
  async function verComprobante(pagoId) {
    setImgLoading(true);
    const { data, error } = await window.getPagoComprobante(pagoId);
    setImgLoading(false);
    if (error) { alert('Error al cargar el comprobante: ' + (error.message || 'intenta de nuevo.')); return; }
    if (!data) { alert('Este pago no tiene comprobante adjunto.'); return; }
    setImgViewer(data);
  }
  // Abrir la factura de esta cuenta directamente en el detalle del POS (misma mecánica que el
  // command palette: __ssPosOpenDoc + navigate + evento ss-open-doc).
  async function verFactura() {
    if (!doc.factura) return;
    setAbriendoFactura(true);
    const { data } = await window.sb.from('documentos').select('*').eq('id', doc.factura).maybeSingle();
    setAbriendoFactura(false);
    if (!data) { alert('No se encontró la factura ' + doc.factura + ' en el sistema.'); return; }
    const fdoc = { ...data, cliente: data.cliente_id, total: parseFloat(data.total) || 0, lines: [] };
    window.__ssPosOpenDoc = fdoc;
    onClose();
    window.__ssNavigate?.('/facturas');
    setTimeout(() => window.dispatchEvent(new CustomEvent('ss-open-doc', { detail: fdoc })), 60);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width: 820, maxHeight:'90vh', display:'flex', flexDirection:'column'}}>
        <div className="modal-header">
          <div style={{width:44,height:44,borderRadius:10,background: doc.estado==='vencida' ? 'var(--danger-soft)' : 'var(--brand-soft)', color: doc.estado==='vencida' ? 'var(--danger)' : 'var(--brand)', display:'grid',placeItems:'center'}}>
            <Icon name="doc" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title" style={{display:'flex', alignItems:'center', gap:8}}>
              {doc.factura}
              {doc.odoo_ref && <span title={'Migrado de Odoo · ' + doc.odoo_ref} style={{fontSize:10, padding:'2px 6px', borderRadius:4, background:'var(--bg-sunken)', color:'var(--text-muted)', fontWeight:700, letterSpacing:'0.04em'}}>MIG</span>}
            </h3>
            <div className="small">{ent?.nombre} · {doc.id} · Vence {fmt.date(doc.vence)}</div>
          </div>
          {esCobrar && doc.factura && (
            <button className="btn secondary sm" onClick={verFactura} disabled={abriendoFactura} title="Abrir la factura en el POS">
              <Icon name="receipt" size={13}/>{abriendoFactura ? 'Abriendo…' : 'Ver factura'}
            </button>
          )}
          {!esCobrar && (
            <button className="btn secondary sm" onClick={verFotoFactura} disabled={imgLoading} title="Ver la foto de la factura adjunta">
              <Icon name="receipt" size={13}/>{imgLoading ? 'Cargando…' : 'Ver foto de factura'}
            </button>
          )}
          <StatusChip estado={doc.estado}/>
          {doc.pago_eliminado_en && (
            <span className="chip" style={{background:'#fee2e2', color:'#dc2626', fontSize:10.5}}
                  title={`${doc.pago_eliminado_motivo || 'Se eliminó un movimiento bancario de esta cuenta'} — ${doc.pago_eliminado_por || 'desconocido'} · ${fmt.dateTime ? fmt.dateTime(doc.pago_eliminado_en) : doc.pago_eliminado_en}`}>
              <Icon name="alert" size={10}/> Eliminado de banco
            </span>
          )}
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        <div className="modal-body" style={{flex:1, overflowY:'auto'}}>
          <div className="grid-4">
            <div className="stat"><div className="stat-label">Monto</div><div className="stat-val" style={{fontSize:18}}>{fmt.usd(doc.monto)}</div></div>
            <div className="stat"><div className="stat-label">Pagado</div><div className="stat-val" style={{fontSize:18, color:'var(--success)'}}>{fmt.usd(doc.pagado)}</div></div>
            <div className="stat"><div className="stat-label">Saldo</div><div className="stat-val" style={{fontSize:18, color: saldo > 0 ? 'var(--warn)' : 'var(--success)'}}>{fmt.usd(saldo)}</div></div>
            <div className="stat">
              <div className="stat-label">Estado</div>
              <div className="stat-val" style={{fontSize:18}}>{pct.toFixed(0)}%</div>
              <div className="pbar mt-2" style={{height:4}}><span style={{width:`${pct}%`, background: pct===100?'var(--success)':doc.estado==='vencida'?'var(--danger)':'var(--brand)'}}/></div>
            </div>
          </div>

          <div className="form-section-title mt-4">Detalle del documento</div>
          <div className="grid-2">
            <div className="card" style={{padding:14}}>
              <div className="small mb-2" style={{fontWeight:600, color:'var(--text-muted)'}}>{esCobrar ? 'CLIENTE' : 'PROVEEDOR'}</div>
              {/* Navegable solo si es un cliente: en CxP la entidad es un proveedor (sin ficha)
                  salvo en los vueltos, que sí son de un cliente. */}
              <div style={{fontSize:14, fontWeight:600}}>
                <window.ClienteLink
                  clienteId={sel.entClienteId ?? (esCobrar ? ent?.id : null)}
                  nombre={ent?.nombre}>{ent?.nombre}</window.ClienteLink>
              </div>
              <div className="small mt-1">{ent?.rif}</div>
              {ent?.contacto && <div className="small mt-1">{ent.contacto}</div>}
              {ent?.telefono && <div className="small mono mt-1">{ent.telefono}</div>}
            </div>
            <div className="card" style={{padding:14}}>
              <div className="small mb-2" style={{fontWeight:600, color:'var(--text-muted)'}}>CONDICIONES</div>
              <div className="flex justify-between" style={{padding:'4px 0'}}><span className="small">Fecha emisión</span><span style={{fontSize:13}}>{fmt.date(doc.fecha || doc.vence)}</span></div>
              <div className="flex justify-between" style={{padding:'4px 0'}}><span className="small">Vencimiento</span><span style={{fontSize:13}}>{fmt.date(doc.vence)}</span></div>
              <div className="flex justify-between" style={{padding:'4px 0'}}><span className="small">Días de crédito</span><span style={{fontSize:13}}>{ent?.diasCredito || ent?.diasPago || '—'}d</span></div>
              {doc.dias > 0 && <div className="flex justify-between" style={{padding:'4px 0'}}><span className="small">Atraso</span><span className="chip red" style={{fontSize:10}}>+{doc.dias} días</span></div>}
              {doc.categoria && <div className="flex justify-between" style={{padding:'4px 0'}}><span className="small">Categoría</span><span className="chip" style={{fontSize:11}}>{doc.categoria}</span></div>}
              {doc.modalidad_pago && <div className="flex justify-between" style={{padding:'4px 0'}}><span className="small">Modalidad</span><span style={{fontSize:13}}>{doc.modalidad_pago}</span></div>}
            </div>
          </div>

          {pagos.length > 0 && <>
            <div className="form-section-title mt-4">Historial de pagos</div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Recibo</th><th>Fecha</th><th>Método</th><th>Banco</th><th>Referencia</th><th>Movimiento</th><th className="num">Monto</th>{esCobrar && <th></th>}</tr></thead>
                <tbody>
                  {pagos.map(p => {
                    const base = String(p.id || '').split('::')[0];
                    const mov = movsDePagos[base];
                    return (
                    <tr key={p.id}>
                      <td className="mono-cell">{p.id}</td>
                      <td className="muted">{fmt.date(p.fecha)}</td>
                      <td>{p.metodo}</td>
                      <td className="small">{p.banco}</td>
                      <td className="mono-cell">{p.referencia || p.ref || '—'}</td>
                      <td>
                        {mov ? (
                          <a href="#" className="mono" style={{fontSize:11, color:'var(--brand)', fontWeight:600, textDecoration:'underline'}}
                             title="Ver este movimiento en Bancos, filtrado y resaltado"
                             onClick={ev => { ev.preventDefault(); irAMovimientoBancario(mov.cuenta_bancaria_id || p.cuenta_bancaria_id, mov.id); }}>
                            {mov.id}
                          </a>
                        ) : <span className="muted small">—</span>}
                      </td>
                      <td className="num strong-num" style={{color:'var(--success)'}}>
                        {fmt.usd(p.monto_usd ?? p.monto)}
                        {p.moneda === 'VES' && p.monto > 0 && (
                          <div className="muted" style={{fontSize:10, fontWeight:400, marginTop:1}}>
                            {fmt.ves(p.monto)} · tasa {p.tasa_usada}
                          </div>
                        )}
                      </td>
                      {esCobrar && (
                        <td>
                          <button className="icon-btn" title="Ver comprobante" disabled={imgLoading} onClick={() => verComprobante(p.id)}>
                            <Icon name="receipt" size={13}/>
                          </button>
                        </td>
                      )}
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          </>}

          {/* Anticipos aplicados: plata que ya había entregado el cliente antes (saldo a favor),
              no un pago nuevo por banco — por eso no sale en "Historial de pagos". Sin esto una
              cuenta pagada en parte con anticipo mostraba menos pagos de los que "Pagado" sumaba. */}
          {anticiposAplicados.length > 0 && <>
            <div className="form-section-title mt-4">Anticipos aplicados</div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Fecha</th><th>Aplicó</th><th>Notas</th><th className="num">Monto</th></tr></thead>
                <tbody>
                  {anticiposAplicados.map(a => (
                    <tr key={a.id}>
                      <td className="muted">{fmt.date(a.fecha)}</td>
                      <td className="small">{a.creado_por || '—'}</td>
                      <td className="small muted">{a.notas || 'Saldo a favor del cliente'}</td>
                      <td className="num strong-num" style={{color:'var(--success)'}}>{fmt.usd(a.monto_aplicado)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>}

          {/* Retenciones aplicadas — parte del historial de la cuenta, aunque no sean plata que
              entró al banco. Sin esto la cuenta cerraba y no se veía por qué: es el caso que
              reportó el usuario ("el cliente hizo lo de las retenciones y no lo encuentro"). */}
          {retenciones.length > 0 && <>
            <div className="form-section-title mt-4">Retenciones aplicadas</div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Fecha</th><th>Tipo</th><th>N° comprobante</th><th>Período</th><th>Registró</th><th className="num">Monto</th></tr></thead>
                <tbody>
                  {retenciones.map(r => (
                    <tr key={r.id}>
                      <td className="muted">{fmt.date(r.fecha)}</td>
                      <td><span className="chip" style={{fontSize:10.5, background:'var(--warn-soft,#fef3c7)', color:'#92400e'}}>
                        {String(r.tipo || '').toUpperCase() === 'ISLR' ? 'ISLR' : 'IVA'}
                      </span></td>
                      <td className="mono-cell">{r.numero_comprobante || '—'}</td>
                      <td className="small muted">{r.periodo || '—'}</td>
                      <td className="small muted">{r.creado_por || '—'}</td>
                      <td className="num strong-num" style={{color:'#92400e'}}>
                        {fmt.usd(Math.abs(parseFloat(r.monto_usd)) || 0)}
                        {r.moneda === 'VES' && r.monto > 0 && (
                          <div className="muted" style={{fontSize:10, fontWeight:400, marginTop:1}}>
                            {fmt.ves(Math.abs(parseFloat(r.monto)) || 0) + (r.tasa ? ' · tasa ' + r.tasa : '')}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr style={{background:'var(--bg-sunken)'}}>
                    <td colSpan={5} style={{fontWeight:700}}>Total retenido — no entró al banco, baja la deuda</td>
                    <td className="num strong-num" style={{color:'#92400e', fontWeight:700}}>{fmt.usd(totalRetenido)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>}

          {otrasDeudas.length > 0 && <>
            <div className="form-section-title mt-4">Otros documentos de {ent?.nombre}</div>
            <div className="card" style={{padding:12, background:'var(--bg-sunken)'}}>
              <div className="flex items-center justify-between">
                <div className="small">Total pendiente con esta {esCobrar?'cliente':'proveedor'}</div>
                <div style={{fontWeight:700, fontSize:16, color:'var(--warn)'}}>{fmt.usd(totalEntidad)}</div>
              </div>
              <div className="small mt-2">{otrasDeudas.length} documento(s) adicional(es)</div>
            </div>
          </>}
        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
          {/* Solo CxP y solo mientras no esté pagada — errores de tasa/moneda al cargarla ya no
              obligan a borrar y recrear. `editarCuentaManual` revalida esto mismo en el servidor. */}
          {!esCobrar && doc.estado !== 'pagada' && window.canUser?.('editar', 'cxp') !== false && (
            <button className="btn secondary" onClick={() => setEditando(true)}>
              <Icon name="edit" size={14}/>Editar
            </button>
          )}
          {!esCobrar && typeof doc.factura === 'string' && doc.factura.startsWith('OC-') && (
            <button className="btn secondary" onClick={() => {
              window.__ssOpenOC = doc.factura;
              onClose();
              window.__ssNavigate?.('/proveedores');
            }}>
              <Icon name="external" size={14}/>Ver Orden
            </button>
          )}
          {/* SOLO en Cuentas por Cobrar. En CxP el campo `factura` NO es un documento nuestro: es
              la orden de compra (OC-…) o el número de factura DEL PROVEEDOR, texto libre ("1978",
              "JEAN", "VARIAS COMI"). Nada de eso vive en `documentos`, así que el botón fallaba con
              "Documento original no encontrado" en el 100% de las cuentas por pagar.
              Lo que CxP sí tiene ya está cubierto: "Ver Orden" para las OC (arriba) y "Ver foto de
              la factura" para la del proveedor. */}
          {esCobrar && doc.factura && (
          <button className="btn secondary" onClick={async () => {
            // La factura puede ser de >90 días → no está en SSData.documentos (ventana). Se busca
            // puntualmente por id con sus líneas antes de generar el PDF.
            let originalDoc = (SSData.documentos || []).find(d => d.id === doc.factura);
            let lines = originalDoc?.lines;
            if (!originalDoc) {
              const { data } = await window.sb.from('documentos')
                .select('*, documentos_items(*)').eq('id', doc.factura)
                .eq('empresa_id', window.currentEmpresa || 'demo1').maybeSingle();
              // Decir CUÁL falta: "documento no encontrado" a secas no deja hacer nada con el aviso.
              if (!data) { alert(`No se encontró la factura ${doc.factura} en el sistema. Puede haber sido eliminada o anulada.`); return; }
              originalDoc = { ...data, cliente: data.cliente_id, total: parseFloat(data.total) || 0 };
              lines = (data.documentos_items || []).map(i => ({
                id: i.id, sku: i.sku, nombre: i.nombre, qty: i.cantidad,
                precio: parseFloat(i.precio_unitario), descuento: parseFloat(i.descuento) || 0,
                subtotal: parseFloat(i.subtotal), garantia_meses: i.garantia_meses, garantia_condiciones: i.garantia_condiciones,
              }));
            }
            window.generateDocumentPDF && window.generateDocumentPDF(originalDoc, lines || [], 'usd');
          }}><Icon name="download" size={14}/>Descargar factura</button>
          )}
          {saldo > 0.005 && canMerma && (
            <button className="btn secondary" onClick={() => { setMermaErr(''); setMermaMotivo(''); setMermaOpen(true); }}
              title="Dar de baja el saldo residual (incobrable/impagable por diferencia cambiaria)">
              <Icon name="dash" size={14}/>Merma de residuo
            </button>
          )}
          {saldo > 0 && <button className="btn primary" onClick={()=>{
            const isVuelto   = !esCobrar && doc.tipo === 'vuelto';
            const isComision = !esCobrar && doc.tipo === 'comision';
            onPay({
              ...ent,
              _esVuelto: isVuelto,
              _esComision: isComision,
              _modalidadFiltro: esCobrar ? (doc.modalidad_pago || 'divisas') : null,
              _selIds: [doc.id],
            });
          }}>
            <Icon name="dollar" size={14}/>{esCobrar ? 'Registrar cobro' : 'Registrar pago'}
          </button>}
        </div>
      </div>
      {/* `editarCuentaManual` muta el objeto de SSData.cuentasPagar en el lugar (misma referencia
          que `doc`/`rows` en la lista) — cerrar este modal de edición ya fuerza el re-render que
          hace falta para que el detalle (y, al volver, la lista) se vean con los datos nuevos. */}
      {editando && (
        <EditarCxPModal cuenta={doc} onClose={() => setEditando(false)}/>
      )}
      {imgViewer && (
        <div className="modal-overlay" style={{zIndex:1100}} onClick={e => { e.stopPropagation(); setImgViewer(null); }}>
          <div onClick={e=>e.stopPropagation()} style={{position:'relative', maxWidth:'92vw', maxHeight:'92vh'}}>
            <img src={imgViewer} alt="" style={{maxWidth:'92vw', maxHeight:'92vh', borderRadius:8, display:'block'}}/>
            <button className="icon-btn" onClick={() => setImgViewer(null)} style={{position:'absolute', top:8, right:8, background:'rgba(0,0,0,0.55)', color:'#fff'}}>
              <Icon name="x" size={16}/>
            </button>
          </div>
        </div>
      )}
      {mermaOpen && (
        <div className="modal-overlay" style={{zIndex:1100}} onClick={e => { e.stopPropagation(); if (!mermaSaving) setMermaOpen(false); }}>
          <div className="modal" style={{maxWidth:440}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <div style={{width:38,height:38,borderRadius:9,background:'var(--warn-soft,#fef3c7)',color:'var(--warn)',display:'grid',placeItems:'center'}}><Icon name="dash" size={18}/></div>
              <div style={{flex:1}}>
                <h3 className="modal-title">Merma de residuo</h3>
                <div className="small muted">{esCobrar ? 'Dar de baja saldo incobrable' : 'Dar de baja saldo impagable'}</div>
              </div>
              <button className="icon-btn" onClick={()=>!mermaSaving && setMermaOpen(false)}><Icon name="x" size={16}/></button>
            </div>
            <div className="modal-body" style={{display:'flex', flexDirection:'column', gap:12}}>
              <div style={{background:'var(--bg-sunken)', borderRadius:8, padding:'10px 12px', fontSize:13}}>
                Se dará de baja el saldo pendiente de <strong>{doc.factura || doc.id}</strong> y la cuenta quedará <strong>saldada</strong> (no se volverá a cobrar/pagar).
                <div style={{marginTop:8, display:'flex', justifyContent:'space-between'}}>
                  <span className="muted">Residuo a dar de baja</span>
                  <strong style={{color:'var(--warn)'}}>{fmt.usd(saldo)}</strong>
                </div>
              </div>
              <div>
                <label className="small muted" style={{display:'block', marginBottom:4}}>Motivo (opcional)</label>
                <textarea className="input" rows={2} value={mermaMotivo} onChange={e=>setMermaMotivo(e.target.value)} placeholder="Ej. diferencia cambiaria, redondeo de pago…"/>
              </div>
              {mermaErr && <div style={{color:'var(--danger)', fontSize:13}}>{mermaErr}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn secondary" disabled={mermaSaving} onClick={()=>setMermaOpen(false)}>Cancelar</button>
              <button className="btn primary" disabled={mermaSaving} onClick={async ()=>{
                setMermaSaving(true); setMermaErr('');
                const r = await window.registrarMermaResiduo({ tipo: esCobrar ? 'cobrar' : 'pagar', cuenta: doc, motivo: mermaMotivo });
                if (r?.error) { setMermaSaving(false); setMermaErr(r.error.message || 'No se pudo registrar la merma.'); return; }
                await window.refrescarFase2?.();
                setMermaSaving(false); setMermaOpen(false); onClose();
              }}><Icon name="check" size={14}/>{mermaSaving ? 'Registrando…' : 'Dar de baja'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Gestión de mermas de residuo (saldos dados de baja) de CxC o CxP.
function MermasModal({ tipo, onClose }) {
  const esCobrar = tipo === 'cobrar';
  const [mermas, setMermas]     = useState(null);   // null = cargando
  const [reverting, setReverting] = useState(null); // id en proceso de revertir
  const canRevert = window.canUser?.('eliminar', esCobrar ? 'cxc' : 'cxp') !== false;
  async function load() { setMermas(await window.loadMermas(tipo)); }
  useEffect(() => { load(); }, [tipo]);
  const total = (mermas || []).reduce((s, m) => s + (parseFloat(m.monto) || 0), 0);
  async function revertir(m) {
    if (!window.confirm(`¿Revertir la merma de ${fmt.usd(m.monto)} de ${m.factura || m.cuenta_id}?\n\nLa cuenta se reabrirá con ese saldo pendiente.`)) return;
    setReverting(m.id);
    const r = await window.eliminarMermaResiduo(m);
    setReverting(null);
    if (r?.error) { alert('No se pudo revertir la merma: ' + (r.error.message || 'error')); return; }
    await window.refrescarFase2?.();
    load();
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{ width:780, maxHeight:'88vh', display:'flex', flexDirection:'column' }}>
        <div className="modal-header">
          <div style={{ width:40, height:40, borderRadius:10, background:'var(--warn-soft,#fef3c7)', color:'var(--warn)', display:'grid', placeItems:'center' }}><Icon name="dash" size={20}/></div>
          <div style={{ flex:1 }}>
            <h3 className="modal-title">Mermas de residuo · {esCobrar ? 'Cuentas por Cobrar' : 'Cuentas por Pagar'}</h3>
            <div className="small muted">Saldos {esCobrar ? 'incobrables' : 'impagables'} dados de baja (diferencias cambiarias, redondeos)</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body" style={{ flex:1, overflowY:'auto' }}>
          <div className="grid-2" style={{ marginBottom:14 }}>
            <div className="stat"><div className="stat-label">Total dado de baja</div><div className="stat-val" style={{ fontSize:20, color:'var(--warn)' }}>{fmt.usd(total)}</div></div>
            <div className="stat"><div className="stat-label">Registros</div><div className="stat-val" style={{ fontSize:20 }}>{(mermas || []).length}</div></div>
          </div>
          {mermas === null ? (
            <div className="empty" style={{ padding:30 }}>Cargando…</div>
          ) : mermas.length === 0 ? (
            <div className="empty" style={{ padding:30 }}>Sin mermas registradas todavía.</div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl" style={{ fontSize:12.5 }}>
                <thead><tr>
                  <th>Fecha</th><th>{esCobrar ? 'Cliente' : 'Proveedor'}</th><th>Factura</th><th>Motivo</th><th>Registró</th><th className="num">Monto</th>{canRevert && <th></th>}
                </tr></thead>
                <tbody>
                  {mermas.map(m => (
                    <tr key={m.id}>
                      <td className="muted">{fmt.date(m.fecha)}</td>
                      <td>{m.entidad_nombre || m.entidad_id || '—'}</td>
                      <td className="mono-cell">{m.factura || m.cuenta_id}</td>
                      <td className="small muted" style={{ maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={m.motivo || ''}>{m.motivo || '—'}</td>
                      <td className="small">{m.creado_por || '—'}</td>
                      <td className="num strong-num" style={{ color:'var(--warn)' }}>{fmt.usd(m.monto)}</td>
                      {canRevert && <td><button className="icon-btn" title="Revertir merma (reabrir la cuenta)" disabled={reverting === m.id} onClick={()=>revertir(m)}><Icon name="refresh" size={13}/></button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

window.BankPage = function BankPage({ subRoute = '', navigate } = {}) {
  // El detalle vive en su propia URL: /banco/{id}. La vista general es /banco.
  const nav = navigate || ((p) => {
    const path = p.startsWith('/') ? p : '/' + p;
    history.pushState(null, '', (window.ssBase ? window.ssBase('/' + (window.currentEmpresa || 'demo1') + path) : ('/' + (window.currentEmpresa || 'demo1') + path)));
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  const selectedBank = subRoute || null;                  // id de cuenta desde la URL
  const abrirBanco = (id) => nav('/banco/' + id);
  const volverBancos = () => nav('/banco');
  // Recordado: cambiar de módulo y volver ya no reinicia la pestaña de conciliación.
  const [filterTab, setFilterTab] = window.usePersistedState('ss-bank-f-tab', 'todos'); // todos | pendientes | conciliados
  // Vista de la lista de cuentas: tabla (default) o tarjetas.
  const [vista, setVista] = window.usePersistedState('ss-bank-f-vista', 'tabla');       // tabla | grid
  const [showImport, setShowImport] = useState(false);
  const [showNewCuenta, setShowNewCuenta] = useState(false);
  const [editCuenta, setEditCuenta] = useState(null);
  const [showMetodos, setShowMetodos] = useState(false);
  const [showTraspaso, setShowTraspaso] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const reloadBancos = async () => { await window.refrescarFase2?.(); setTick(t => t + 1); };
  // Mismo permiso especial que el botón "Movimiento" del detalle (bank_movimiento):
  // el traspaso es un movimiento bancario. Visible para todos, con alerta si no hay permiso.
  const abrirTraspaso = () => {
    if (!window.canUser('crear', 'bank_movimiento')) {
      alert('No tienes permiso para registrar movimientos bancarios (movimiento, ajuste o traspaso). Solicítalo a un administrador.');
      return;
    }
    setShowTraspaso(true);
  };

  // Bancos/movimientos cargan en la FASE 2 diferida de loadAppData (y en FASE 1 async). Antes esta
  // página leía `movs` desde un useState congelado en el primer mount (`useState(SSData.movsBancarios)`),
  // que React NUNCA vuelve a inicializar en renders posteriores — si el componente montaba antes de
  // que la Fase 2 terminara, "movs" quedaba vacío PARA SIEMPRE aunque `SSData.cuentasBancarias` (leído
  // en vivo cada render) sí se actualizara — de ahí el bug "saldo correcto pero ingresos/egresos/movs
  // en 0". Fix: no guardar movs en state — leer SIEMPRE `SSData.movsBancarios` en vivo, y usar un
  // contador (`tick`) solo para FORZAR el re-render cuando termina cualquier fase de carga.
  const [tick, setTick] = useState(0);
  React.useEffect(() => window.ssOnDatos(() => setTick(t => t + 1)), []);
  const movs = SSData.movsBancarios || [];

  async function handleDeleteCuenta(b) {
    if (!confirm(`¿Eliminar la cuenta "${b.banco}" (${b.cuenta})?\nSe enviará a la papelera 30 días.`)) return;
    const { error } = await window.sb.from('cuentas_bancarias').delete().eq('id', b.id);
    if (error) { alert('Error al eliminar: ' + error.message); return; }
    // A papelera SOLO tras borrar OK. `_cuentaBancariaSnapshot`: columnas reales, sin los campos
    // calculados del objeto enriquecido (el handler igual hace whitelist, esto lo mantiene liviano).
    const { saldoCalc, movsMes, sinConc, porConciliar, ingresos, egresos, delta, deltaPct, ...limpio } = b;
    window.ssTrash?.add('cuentaBancaria', b.banco, limpio);
    window.logActivity?.({ modulo:'bank', accion:'eliminar', entidad_id: b.id, entidad_label: b.banco });
    await window.refrescarFase2?.();
  }

  // Enriquecer cuentas con movimientos — saldo calculado desde movimientos reales.
  // Match por cuenta_bancaria_id (los movimientos migrados lo traen) con fallback al
  // nombre. Ingresos/egresos por la columna `tipo`, no por el signo del monto (los
  // movimientos migrados son todos monto positivo con tipo='ingreso').
  const _hoyBanco = new Date(window.localDateStr() + 'T12:00:00');
  const _mesIni   = new Date(_hoyBanco.getFullYear(), _hoyBanco.getMonth(), 1);
  const _esEgreso = m => m.tipo === 'egreso' || m.tipo === 'salida' || m.monto < 0;
  const bancosEnriquecidos = SSData.cuentasBancarias.map(b => {
    const movsB = movs.filter(m => (m.cuenta_bancaria_id ? m.cuenta_bancaria_id === b.id : m.banco === b.banco));
    // Los pendientes se cuentan sobre `movsPendientes` (TODOS, sin ventana de fecha).
    // Con `movsB` —acotado a 365 días— el contador de la lista no coincidía con lo que
    // se ve al entrar al banco: 3 afuera contra 129 adentro. Respaldo a la ventana
    // mientras la consulta sin ventana no haya llegado.
    const pendB = SSData.movsPendientes
      ? SSData.movsPendientes.filter(m => (m.cuenta_bancaria_id ? m.cuenta_bancaria_id === b.id : m.banco === b.banco))
      : movsB.filter(m => !m.conciliado);
    const sinConc = pendB.length;
    // MODELO saldo = Σ movimientos: b.saldo se recalcula server-side (RPC) como la suma de TODOS
    // los movimientos del banco. En el cliente solo se lee (los movs en memoria están acotados a
    // 365d). El neto del mes solo alimenta los rótulos "MES".
    const saldo  = (b.saldo != null ? b.saldo : (b.saldoPrevio || 0));
    // Rótulos "MES": SOLO el mes en curso (antes agregaban todo 2023-2026 → cifras infladas).
    const movsMesArr = movsB.filter(m => { const f = new Date((m.fecha || '') + 'T12:00:00'); return f >= _mesIni; });
    const ingresos = movsMesArr.filter(m => !_esEgreso(m)).reduce((s,m)=>s+Math.abs(m.monto), 0);
    const egresos  = movsMesArr.filter(m =>  _esEgreso(m)).reduce((s,m)=>s+Math.abs(m.monto), 0);
    const movsMes  = movsMesArr.length;
    const delta    = ingresos - egresos;                       // neto del mes
    const saldoIniMes = saldo - delta;                          // saldo al inicio del mes
    const deltaPct = saldoIniMes > 0 ? (delta / saldoIniMes) * 100 : (delta !== 0 ? 100 : 0);
    // Monto "por conciliar": neto de movimientos aún sin conciliar (mismo criterio que el badge
    // ámbar). En el modelo saldo=Σ movimientos TODOS ya están sumados al saldo; esto solo indica
    // qué parte del saldo falta conciliar con el estado de cuenta del banco.
    // Mismo criterio que sinConc: sobre TODOS los pendientes, no sobre la ventana.
    const porConciliar = pendB
      .reduce((s, m) => s + (_esEgreso(m) ? -Math.abs(parseFloat(m.monto) || 0) : Math.abs(parseFloat(m.monto) || 0)), 0);
    return { ...b, saldo, movsMes, sinConc, porConciliar, ingresos, egresos, delta, deltaPct };
  });

  // Carga inicial en curso: la FASE 2 (bancos/movimientos) aún no llegó y no hay cuentas en memoria.
  // Mostramos loading hasta que TODO esté listo (evita el parpadeo de página vacía tras el splash).
  if (!window.__ssExtrasReady && (SSData.cuentasBancarias?.length ?? 0) === 0) {
    return (
      <div className="page">
        <div className="page-header"><h1 className="page-title">Bancos</h1></div>
        <div style={{display:'grid', placeItems:'center', gap:14, padding:'90px 20px', color:'var(--text-muted)'}}>
          <div style={{width:30, height:30, border:'3px solid var(--border)', borderTopColor:'var(--brand)', borderRadius:'50%', animation:'ss-spin 0.8s linear infinite'}}/>
          <div style={{fontSize:13}}>Cargando cuentas y movimientos…</div>
        </div>
      </div>
    );
  }

  // Si hay banco seleccionado (vía URL /banco/{id}), vista de detalle
  if (selectedBank) {
    const banco = bancosEnriquecidos.find(b => b.id === selectedBank);
    if (banco) {
      return <BankDetailView banco={banco} cuentas={bancosEnriquecidos} movs={movs.filter(m => (m.cuenta_bancaria_id ? m.cuenta_bancaria_id === banco.id : m.banco === banco.banco))} onBack={volverBancos} filterTab={filterTab} setFilterTab={setFilterTab} reload={reloadBancos}/>;
    }
    // id inexistente (o datos aún cargando) → cae a la vista general
  }

  // Vista general: todos los bancos
  const totalUSD = bancosEnriquecidos.filter(b => b.moneda === 'USD').reduce((s,b)=>s+b.saldo,0);
  const totalVES = bancosEnriquecidos.filter(b => b.moneda === 'VES').reduce((s,b)=>s+b.saldo,0);
  // Sobre TODOS los pendientes, no sobre la ventana de 365 días de `movs`: era la
  // card que mostraba 3 cuando al entrar al banco había muchos más.
  const totalSinConc = SSData.movsPendientes
    ? SSData.movsPendientes.length
    : movs.filter(m => !m.conciliado).length;
  const totalCuentas = bancosEnriquecidos.length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Bancos</h1>
          <div className="page-subtitle">{totalCuentas} cuentas · {movs.length} movimientos · {totalSinConc} sin conciliar</div>
        </div>
        <div className="page-actions">
          <button className="btn ghost" onClick={()=>setShowActivity(true)} title="Ver todo el registro de actividad de Bancos">
            <Icon name="clock" size={14}/><span className="hide-sm">Actividad</span>
          </button>
          <button className="btn secondary" onClick={abrirTraspaso}><Icon name="arrUp" size={14}/><span className="hide-sm">Traspaso</span></button>
          {window.canUser?.('editar', 'bank') !== false && (
            <button className="btn secondary" onClick={()=>setShowMetodos(true)}><Icon name="price" size={14}/><span className="hide-sm">Métodos de pago</span></button>
          )}
          {window.canUser?.('crear','bank_movimiento') !== false && (
          <button className="btn secondary" onClick={()=>setShowImport(true)}><Icon name="upload" size={14}/><span className="hide-sm">Importar estado</span></button>
          )}
          {window.canUser?.('crear','bank') !== false && (
          <button className="btn primary" onClick={()=>setShowNewCuenta(true)}><Icon name="plus" size={14}/><span className="hide-sm">Nueva cuenta</span></button>
          )}
        </div>
      </div>

      {showImport && <ImportStatementModal onClose={()=>setShowImport(false)} bancos={SSData.cuentasBancarias}/>}
      {showTraspaso && <TraspasoModal cuentas={bancosEnriquecidos} onClose={()=>setShowTraspaso(false)} onDone={async()=>{ setShowTraspaso(false); await reloadBancos(); }}/>}
      {showActivity && <ActivityLogModal modulo="bank" onClose={()=>setShowActivity(false)}/>}

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">Saldo consolidado USD</div>
          <div className="stat-val">{fmt.usd(totalUSD)}</div>
          <div className="small mt-2">{bancosEnriquecidos.filter(b=>b.moneda==='USD').length} cuentas en dólares</div>
        </div>
        <div className="stat">
          <div className="stat-label">Saldo consolidado Bs</div>
          <div className="stat-val">{fmt.bs(totalVES)}</div>
          <div className="small mt-2">≈ {fmt.usd(totalVES / SSData.tasa.bcv)} a BCV</div>
        </div>
        <div className="stat">
          <div className="stat-label">Patrimonio bancario total</div>
          <div className="stat-val" style={{color:'var(--brand)'}}>{fmt.usd(totalUSD + totalVES / SSData.tasa.bcv)}</div>
          <div className="small mt-2">Valuado al BCV de hoy</div>
        </div>
        <div className="stat">
          <div className="stat-label">Sin conciliar</div>
          <div className="stat-val" style={{color: totalSinConc > 0 ? 'var(--warn)' : 'var(--success)'}}>{totalSinConc}</div>
          <div className="small mt-2">movimientos pendientes</div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 mb-3" style={{flexWrap:'wrap', gap:8}}>
        <h2 style={{fontSize:15, fontWeight:600, margin:0}}>Cuentas bancarias</h2>
        <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
          <span className="small">Selecciona una cuenta para ver movimientos y conciliar</span>
          {/* Tabla por defecto: con 13 cuentas las tarjetas obligan a scrollear para comparar saldos,
              que es justo lo que se viene a hacer acá. Las tarjetas quedan a un clic. */}
          <div className="seg">
            <button className={vista === 'tabla' ? 'on' : ''} onClick={() => setVista('tabla')} title="Ver en tabla">
              <Icon name="list" size={12}/> Tabla
            </button>
            <button className={vista === 'grid' ? 'on' : ''} onClick={() => setVista('grid')} title="Ver en tarjetas">
              <Icon name="grid" size={12}/> Tarjetas
            </button>
          </div>
        </div>
      </div>

      {vista === 'tabla' && (
        <div className="tbl-wrap">
          <div className="tbl-scroll">
            <table className="tbl">
              <thead><tr>
                <th>Banco / cuenta</th>
                <th className="dt-hide-mobile">Tipo</th>
                <th className="dt-hide-mobile">Titular</th>
                <th>Moneda</th>
                <th className="num">Saldo</th>
                <th className="num hide-sm">Ingresos mes</th>
                <th className="num hide-sm">Egresos mes</th>
                <th className="num hide-sm">Movs mes</th>
                <th className="hide-sm">Sin conciliar</th>
                <th style={{width:86}}></th>
              </tr></thead>
              <tbody>
                {bancosEnriquecidos.map(b => {
                  const m = (v) => b.moneda === 'USD' ? fmt.usd(v) : fmt.bs(v);
                  return (
                    <tr key={b.id} onClick={()=>abrirBanco(b.id)} style={{cursor:'pointer'}}>
                      <td>
                        <div style={{display:'flex', alignItems:'center', gap:9, minWidth:0}}>
                          <div className="bank-logo" style={{background:b.color, width:28, height:28, fontSize:12, flexShrink:0}}>
                            {b.logo === 'binance'
                              ? <img src="/binance.png" alt="Binance" style={{width:18,height:18,borderRadius:'50%',objectFit:'cover'}}/>
                              : b.logo}
                          </div>
                          <div style={{minWidth:0}}>
                            <div style={{fontWeight:600, fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{b.banco}</div>
                            <div className="small mono muted" style={{fontSize:11}}>{b.cuenta}</div>
                          </div>
                        </div>
                      </td>
                      <td className="dt-hide-mobile small">{b.tipo || '—'}</td>
                      <td className="dt-hide-mobile small" style={{maxWidth:170, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{b.titular || '—'}</td>
                      <td>
                        <span className="chip" style={{fontSize:10.5, background:(b.moneda==='USD'?'var(--success)':'var(--warn)')+'1a',
                                                       color:b.moneda==='USD'?'var(--success)':'var(--warn)', fontWeight:600}}>
                          {b.moneda === 'USD' ? 'USD' : 'Bs.'}
                        </span>
                      </td>
                      <td className="num strong-num" style={{whiteSpace:'nowrap'}}>
                        {m(b.saldo)}
                        <div className="small" style={{fontWeight:400, color: b.delta >= 0 ? 'var(--success)' : 'var(--danger)'}}>
                          {b.delta >= 0 ? '↑' : '↓'} {Math.abs(b.deltaPct).toFixed(1)}% mes
                        </div>
                      </td>
                      <td className="num hide-sm" style={{color:'var(--success)', whiteSpace:'nowrap'}}>{m(b.ingresos)}</td>
                      <td className="num hide-sm" style={{color:'var(--danger)', whiteSpace:'nowrap'}}>{m(b.egresos)}</td>
                      <td className="num hide-sm">{b.movsMes}</td>
                      <td className="hide-sm">
                        {b.sinConc > 0
                          ? <span className="chip amber" title={Math.abs(b.porConciliar) > 0.005
                              ? `${b.sinConc} movimiento(s) · ${m(Math.abs(b.porConciliar))} del saldo sin conciliar` : `${b.sinConc} movimiento(s)`}>
                              {b.sinConc}
                            </span>
                          : <span className="chip green">Al día</span>}
                      </td>
                      <td onClick={e=>e.stopPropagation()}>
                        <div style={{display:'flex', gap:4, justifyContent:'flex-end'}}>
                          {window.canUser?.('editar','bank') !== false && (
                            <button className="icon-btn" title="Editar cuenta" onClick={()=>setEditCuenta(b)}><Icon name="edit" size={13}/></button>
                          )}
                          {window.canUser?.('eliminar','bank') !== false && (
                            <button className="icon-btn" title="Eliminar cuenta" onClick={()=>handleDeleteCuenta(b)} style={{color:'var(--danger)'}}><Icon name="trash" size={13}/></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {bancosEnriquecidos.length === 0 && (
                  <tr><td colSpan="10" className="empty">No hay cuentas bancarias registradas.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Las tarjetas quedan montadas pero ocultas en modo tabla: alternar no recarga nada. */}
      <div className="bank-grid" style={vista === 'tabla' ? { display: 'none' } : undefined}>
        {bancosEnriquecidos.map(b => (
          <div key={b.id} className="bank-card" onClick={()=>abrirBanco(b.id)}>
            <div className="bank-card-header">
              <div className="bank-logo" style={{background: b.color}}>{b.logo === 'binance' ? <img src="/binance.png" alt="Binance" style={{width:24,height:24,borderRadius:'50%',objectFit:'cover'}}/> : b.logo}</div>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontSize:14, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{b.banco}</div>
                <div className="small mono" style={{marginTop:2}}>{b.cuenta}</div>
              </div>
              {b.sinConc > 0 && <span className="chip amber" style={{flexShrink:0}}>{b.sinConc}</span>}
              {window.canUser?.('editar','bank') !== false && (
              <button className="icon-btn" title="Editar cuenta" onClick={e=>{e.stopPropagation();setEditCuenta(b);}} style={{flexShrink:0}}><Icon name="edit" size={13}/></button>
              )}
              {window.canUser?.('eliminar','bank') !== false && (
              <button className="icon-btn" title="Eliminar cuenta" onClick={e=>{e.stopPropagation();handleDeleteCuenta(b);}} style={{flexShrink:0,color:'var(--danger)'}}><Icon name="trash" size={13}/></button>
              )}
            </div>
            <div className="bank-card-body">
              <div className="small" style={{fontSize:10.5, textTransform:'uppercase', letterSpacing:'0.05em'}}>Saldo disponible</div>
              <div style={{fontSize:22, fontWeight:700, marginTop:2, fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}
                   title={b.moneda === 'USD' ? fmt.usd(b.saldo) : fmt.bs(b.saldo)}>
                {b.moneda === 'USD' ? fmt.usd(b.saldo) : fmt.bs(b.saldo)}
              </div>
              <div className="small mt-1" style={{display:'flex', alignItems:'center', gap:4}}>
                <span style={{color: b.delta >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight:500}}>
                  {b.delta >= 0 ? '↑' : '↓'} {Math.abs(b.deltaPct).toFixed(1)}%
                </span>
                <span className="muted">vs mes anterior</span>
              </div>
              {Math.abs(b.porConciliar) > 0.005 && (
                <div className="small mt-1" style={{display:'flex', alignItems:'center', gap:6, flexWrap:'wrap'}}
                     title="Parte del saldo aún sin conciliar con el estado de cuenta del banco (ya está sumada al saldo).">
                  <span className="chip amber" style={{fontSize:10}}>Por conciliar</span>
                  <span style={{fontWeight:600, color: b.porConciliar >= 0 ? 'var(--success)' : 'var(--danger)'}}>
                    {b.porConciliar >= 0 ? '+' : '−'}{b.moneda === 'USD' ? fmt.usd(Math.abs(b.porConciliar)) : fmt.bs(Math.abs(b.porConciliar))}
                  </span>
                </div>
              )}
            </div>
            <div className="bank-card-footer">
              <div>
                <div className="small" style={{fontSize:10}}>INGRESOS MES</div>
                <div style={{fontSize:12.5, fontWeight:600, color:'var(--success)'}}>{b.moneda === 'USD' ? fmt.usd(b.ingresos) : fmt.bs(b.ingresos)}</div>
              </div>
              <div>
                <div className="small" style={{fontSize:10}}>EGRESOS MES</div>
                <div style={{fontSize:12.5, fontWeight:600, color:'var(--danger)'}}>{b.moneda === 'USD' ? fmt.usd(b.egresos) : fmt.bs(b.egresos)}</div>
              </div>
              <div>
                <div className="small" style={{fontSize:10}}>MOVS MES</div>
                <div style={{fontSize:12.5, fontWeight:600}}>{b.movsMes}</div>
              </div>
            </div>
            <div className="bank-card-action">
              <span>Ver movimientos</span>
              <Icon name="chevronR" size={14}/>
            </div>
          </div>
        ))}
      </div>

      {showNewCuenta && <CuentaBancariaModal onClose={()=>setShowNewCuenta(false)} onSave={async()=>{await window.refrescarFase2?.();setShowNewCuenta(false);}}/>}
      {editCuenta && <CuentaBancariaModal cuenta={editCuenta} onClose={()=>setEditCuenta(null)} onSave={async()=>{await window.refrescarFase2?.();setEditCuenta(null);}}/>}
      {showMetodos && <MetodosPagoModal onClose={()=>setShowMetodos(false)}/>}
    </div>
  );
};

// ─── Modal: gestión de métodos de pago (CRUD) ────────────────────────────────
function MetodosPagoModal({ onClose }) {
  const [metodos, setMetodos] = useState(() => (window.getMetodosPago?.() || []).slice());
  const [editing, setEditing] = useState(null);   // método en edición, {} para nuevo, null para lista
  const [busy, setBusy] = useState(false);

  function refresh() { setMetodos((window.SSData.metodosPago || window.getMetodosPago?.() || []).slice()); }
  async function handleSave(m) {
    setBusy(true);
    const { error } = await window.saveMetodoPago(m);
    setBusy(false);
    if (error) { alert('Error: ' + (error.message || 'no se pudo guardar')); return; }
    setEditing(null); refresh();
  }
  async function handleDelete(m) {
    if (!m.id) return;
    const nBancos = window.contarBancosConMetodo?.(m.codigo) || 0;
    const aviso = nBancos > 0 ? `\n\n${nBancos} banco(s) lo tienen asignado y dejarán de ofrecerlo.` : '';
    if (!window.confirm(`¿Eliminar el método "${m.label}"?${aviso}`)) return;
    const { error } = await window.deleteMetodoPago(m.id);
    if (error) { alert('Error: ' + (error.message || 'no se pudo eliminar')); return; }
    refresh();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:560}}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}><Icon name="price" size={18}/></div>
          <div style={{flex:1}}>
            <h3 className="modal-title">Métodos de pago</h3>
            <div className="small muted">Define qué métodos existen y en qué moneda. Aparecen en los bancos de esa moneda al registrar pagos.</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          {editing ? (
            <MetodoPagoForm metodo={editing} busy={busy} onCancel={()=>setEditing(null)} onSave={handleSave}/>
          ) : (<>
            <div style={{display:'flex', justifyContent:'flex-end', marginBottom:10}}>
              {window.canUser?.('crear', 'bank') !== false && (
                <button className="btn primary sm" onClick={()=>setEditing({})}><Icon name="plus" size={13}/>Nuevo método</button>
              )}
            </div>
            <div style={{display:'flex', flexDirection:'column', gap:8}}>
              {metodos.length === 0 && <div className="empty" style={{minHeight:60}}>Sin métodos. Crea el primero.</div>}
              {metodos.map(m => (
                <div key={m.id} className="flex items-center gap-3" style={{padding:'10px 12px', border:'1px solid var(--border)', borderRadius:8, opacity: m.activo===false?0.55:1}}>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontWeight:600, fontSize:13}}>{m.label} {m.sin_banco && <span className="chip neutral" style={{fontSize:10}}>sin banco</span>}</div>
                    <div className="small muted">{(m.monedas||[]).join(' · ') || '—'} · <span className="mono">{m.codigo}</span></div>
                  </div>
                  {m.activo === false && <span className="chip amber" style={{fontSize:10}}>inactivo</span>}
                  {window.canUser?.('editar', 'bank') !== false && (
                    <button className="icon-btn" title="Editar" onClick={()=>setEditing(m)}><Icon name="edit" size={13}/></button>
                  )}
                  {window.canUser?.('eliminar', 'bank') !== false && (
                    <button className="icon-btn danger" title="Eliminar" onClick={()=>handleDelete(m)} style={{color:'var(--danger)'}}><Icon name="trash" size={13}/></button>
                  )}
                </div>
              ))}
            </div>
          </>)}
        </div>
      </div>
    </div>
  );
}

function MetodoPagoForm({ metodo, busy, onCancel, onSave }) {
  const isNew = !metodo.id;
  const [form, setForm] = useState({
    id: metodo.id, codigo: metodo.codigo || '', label: metodo.label || '', icon: metodo.icon || 'bank',
    monedas: Array.isArray(metodo.monedas) && metodo.monedas.length ? metodo.monedas : ['USD','VES'],
    sin_banco: !!metodo.sin_banco, activo: metodo.activo !== false, orden: metodo.orden || 0,
  });
  function set(k,v){ setForm(f => ({...f,[k]:v})); }
  function toggleMoneda(mon){ setForm(f => ({...f, monedas: f.monedas.includes(mon) ? f.monedas.filter(x=>x!==mon) : [...f.monedas, mon]})); }
  const ICON_OPTS = ['bank','dollar','binance','cash','phone','price','external'];
  return (
    <div>
      <div className="grid-2">
        <div style={{gridColumn:'1/-1'}}>
          <label className="form-label">Nombre del método *</label>
          <input className="input" value={form.label} onChange={e=>set('label',e.target.value)} placeholder="Transferencia, Zelle, PayPal…"/>
        </div>
        <div style={{gridColumn:'1/-1'}}>
          <label className="form-label">Moneda(s) *</label>
          <div style={{display:'flex', gap:8}}>
            {['USD','VES'].map(mon => {
              const on = form.monedas.includes(mon);
              return (
                <button key={mon} type="button" onClick={()=>toggleMoneda(mon)}
                  style={{padding:'6px 16px', borderRadius:8, fontSize:13, fontWeight:on?600:400, cursor:'pointer',
                    border:`2px solid ${on?'var(--brand)':'var(--border)'}`, background:on?'var(--brand-soft)':'var(--bg-elev)', color:on?'var(--brand)':'var(--text)'}}>
                  {on&&'✓ '}{mon === 'USD' ? 'Dólares (USD)' : 'Bolívares (Bs)'}
                </button>
              );
            })}
          </div>
          <div className="small muted" style={{marginTop:4}}>El método aparecerá solo en los bancos de esa(s) moneda(s).</div>
        </div>
        <div>
          <label className="form-label">Ícono</label>
          <select className="select" value={form.icon} onChange={e=>set('icon',e.target.value)} style={{width:'100%'}}>
            {ICON_OPTS.map(ic => <option key={ic} value={ic}>{ic}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Orden</label>
          <input className="input mono" type="number" value={form.orden} onChange={e=>set('orden', parseInt(e.target.value)||0)}/>
        </div>
        <div style={{gridColumn:'1/-1', display:'flex', gap:16, flexWrap:'wrap', marginTop:4}}>
          <label style={{display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer'}}>
            <input type="checkbox" checked={form.sin_banco} onChange={e=>set('sin_banco', e.target.checked)}/> Sin banco (ej. Efectivo — no se ata a una cuenta)
          </label>
          <label style={{display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer'}}>
            <input type="checkbox" checked={form.activo} onChange={e=>set('activo', e.target.checked)}/> Activo
          </label>
        </div>
      </div>
      <div className="modal-footer" style={{marginTop:16, display:'flex', gap:8, justifyContent:'flex-end'}}>
        <button className="btn secondary" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button className="btn primary" disabled={busy || !form.label.trim() || form.monedas.length===0}
          onClick={()=>onSave(form)}>{busy ? 'Guardando…' : (isNew ? 'Crear método' : 'Guardar')}</button>
      </div>
    </div>
  );
}

function CuentaBancariaModal({ cuenta, onClose, onSave }) {
  const isNew = !cuenta;
  const [form, setForm] = useState(cuenta ? { metodos_pago: [], ...cuenta } : {
    banco: '', cuenta: '', moneda: 'USD', tipo: 'corriente',
    saldo: '', titular: '', color: '#1e40af', logo: '🏦',
    metodos_pago: ['transferencia', 'zelle'],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Métodos atados a un banco = catálogo gestionable (excluye los "sin banco" como Efectivo).
  // La compatibilidad por moneda viene de cada método (monedas[]). Se gestionan en el modal
  // "Métodos de pago" (botón en la página de Bancos).
  const METODOS_BANCO = (window.getMetodosPago?.() || [])
    .filter(m => !m.sin_banco && m.activo !== false)
    .map(m => ({ id: m.codigo, l: m.label, monedas: m.monedas || ['USD','VES'] }));
  const metodosDisponibles = METODOS_BANCO.filter(m => m.monedas.includes(form.moneda));
  function upd(k, v) {
    setForm(f => {
      const next = { ...f, [k]: v };
      // Al cambiar la moneda, descartar métodos incompatibles (ej. Zelle en banco Bs).
      if (k === 'moneda') {
        const compat = METODOS_BANCO.filter(m => m.monedas.includes(v)).map(m => m.id);
        next.metodos_pago = (f.metodos_pago || []).filter(id => compat.includes(id));
      }
      return next;
    });
  }
  function toggleMetodo(id) {
    setForm(f => {
      const cur = f.metodos_pago || [];
      return { ...f, metodos_pago: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] };
    });
  }

  async function handleSave() {
    if (!form.banco.trim() || !form.cuenta.trim()) {
      setError('Completá el Banco/institución y el Número de cuenta — ambos son obligatorios.');
      return;
    }
    // Se valida la lista YA filtrada por moneda: si se eligieron métodos y luego se cambió la
    // moneda, los incompatibles se descartan y la cuenta podría guardarse vacía sin avisar.
    const metodosValidos = (Array.isArray(form.metodos_pago) ? form.metodos_pago : [])
      .filter(id => METODOS_BANCO.find(m => m.id === id)?.monedas.includes(form.moneda));
    // Una cuenta sin métodos NO queda restringida: el POS interpreta la lista vacía como
    // "ofrecer todos" (ver `ofrecidos` en RegisterPaymentModal), así que una caja de efectivo
    // terminaría aceptando Zelle o Binance. Por eso se exige al menos uno.
    if (!metodosValidos.length) {
      setError('Elegí al menos un método de pago. Sin métodos, la cuenta termina aceptando todos.');
      return;
    }
    setError('');
    setSaving(true);
    const saldoInicial = Math.round((parseFloat(form.saldo) || 0) * 100) / 100;
    const payload = {
      banco: form.banco.trim(),
      cuenta: form.cuenta.trim(),
      moneda: form.moneda,
      tipo: form.tipo || 'corriente',
      titular: form.titular || '',
      color: form.color || '#1e40af',
      logo: form.logo || '🏦',
      metodos_pago: metodosValidos,
      empresa_id: window.currentEmpresa || 'demo1',
    };
    let error;
    if (isNew) {
      const id = 'BNK-' + Date.now();
      // MODELO saldo = Σ movimientos: la cuenta nace en 0; el saldo inicial se materializa como
      // un movimiento de "apertura", así el saldo siempre cuadra con los movimientos.
      ({ error } = await window.sb.from('cuentas_bancarias').insert({ id, saldo: 0, saldo_previo: 0, ...payload }));
      if (!error) {
        window.logActivity?.({ modulo:'bank', accion:'crear', entidad_id:id, entidad_label:form.banco });
        if (saldoInicial !== 0) {
          const bcv = window.SSData?.tasa?.bcv || null;
          const { error: eApe } = await window.sb.from('movimientos_bancarios').insert({
            id: 'MOV-APER-' + id, fecha: window.localDateStr(), banco: payload.banco,
            descripcion: 'Saldo inicial (apertura)', monto: saldoInicial,
            tipo: saldoInicial < 0 ? 'egreso' : 'ingreso', conciliado: true, origen_app: true,
            empresa_id: payload.empresa_id, moneda: form.moneda,
            monto_usd: form.moneda === 'USD' ? Math.abs(saldoInicial) : (bcv ? Math.round(Math.abs(saldoInicial)/bcv*100)/100 : null),
            cuenta_bancaria_id: id, creado_por: window.__ssCurrentUser?.nombre || null,
          });
          if (eApe) {
            // No dejar la cuenta creada con saldo 0 en silencio: revertir el insert de la cuenta y avisar.
            await window.sb.from('cuentas_bancarias').delete().eq('id', id);
            error = eApe;
          } else {
            await window.recomputeSaldoCuenta?.(id);
          }
        }
      }
    } else {
      // Editar la cuenta NO toca el saldo (se calcula de los movimientos; se corrige con "Ajuste de saldo").
      ({ error } = await window.sb.from('cuentas_bancarias').update(payload).eq('id', cuenta.id));
      if (!error) window.logActivity?.({ modulo:'bank', accion:'editar', entidad_id:cuenta.id, entidad_label:form.banco });
    }
    setSaving(false);
    if (error) { alert('Error: ' + (error.message || JSON.stringify(error))); return; }
    await window.refrescarFase2?.();
    onSave();
  }

  const MONEDA_OPTS = ['USD', 'VES'];
  const TIPO_OPTS   = ['corriente', 'ahorro', 'zelle', 'binance', 'efectivo'];
  const EMOJI_OPTS  = ['🏦','💵','💳','🏧','📱','🏪','binance'];
  const COLOR_OPTS  = ['#1e40af','#0f766e','#7c3aed','#b45309','#dc2626','#334155','#0891b2','#059669'];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:500}}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center',fontSize:20}}>
            {form.logo === 'binance' ? <img src="/binance.png" alt="Binance" style={{width:26,height:26,borderRadius:'50%',objectFit:'cover'}}/> : (form.logo || '🏦')}
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">{isNew ? 'Nueva cuenta bancaria' : 'Editar cuenta'}</h3>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          <div className="grid-2">
            <div style={{gridColumn:'1/-1'}}>
              <label className="form-label">Banco / institución *</label>
              <input className="input" value={form.banco} onChange={e=>{upd('banco',e.target.value);setError('');}} placeholder="Banesco, Mercantil, Zelle…" style={{borderColor: error && !form.banco.trim() ? 'var(--danger)' : ''}}/>
            </div>
            <div>
              <label className="form-label">Número de cuenta *</label>
              <input className="input mono" value={form.cuenta} onChange={e=>{upd('cuenta',e.target.value);setError('');}} placeholder="0134-0001-XX-XXXXXXXXXX" style={{borderColor: error && !form.cuenta.trim() ? 'var(--danger)' : ''}}/>
            </div>
            <div>
              <label className="form-label">Titular</label>
              <input className="input" value={form.titular} onChange={e=>upd('titular',e.target.value)} placeholder="Distribuidora Demo 1, C.A."/>
            </div>
            <div>
              <label className="form-label">Moneda *</label>
              <div className="seg" style={{width:'100%'}}>
                {MONEDA_OPTS.map(m => <button key={m} className={form.moneda===m?'on':''} onClick={()=>upd('moneda',m)}>{m}</button>)}
              </div>
            </div>
            <div>
              <label className="form-label">Tipo de cuenta</label>
              <select className="select" value={form.tipo} onChange={e=>upd('tipo',e.target.value)} style={{width:'100%'}}>
                {TIPO_OPTS.map(t=><option key={t} value={t} style={{textTransform:'capitalize'}}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">{isNew ? 'Saldo inicial' : 'Saldo actual'} {form.moneda}</label>
              <input className="input mono" type="number" value={form.saldo}
                onChange={e=>upd('saldo',e.target.value)} placeholder="0.00"
                disabled={!isNew}
                title={isNew ? 'Se registrará como movimiento de apertura' : 'El saldo se calcula de los movimientos'}
                style={!isNew ? {opacity:0.65, cursor:'not-allowed'} : undefined}/>
              <div className="small muted" style={{marginTop:4}}>
                {isNew ? 'Se registra como movimiento de apertura.' : 'Calculado de los movimientos — corrígelo con "Ajuste de saldo".'}
              </div>
            </div>
            <div style={{gridColumn:'1/-1'}}>
              <label className="form-label">Métodos de pago que admite <span style={{color:'var(--danger)'}}>*</span></label>
              <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                {metodosDisponibles.map(m => {
                  const on = (form.metodos_pago || []).includes(m.id);
                  return (
                    <button key={m.id} type="button" onClick={()=>toggleMetodo(m.id)}
                      style={{padding:'6px 14px', borderRadius:8, fontSize:13, fontWeight:on?600:400, cursor:'pointer',
                        border:`2px solid ${on?'var(--brand)':'var(--border)'}`, background:on?'var(--brand-soft)':'var(--bg-elev)', color:on?'var(--brand)':'var(--text)'}}>
                      {on && '✓ '}{m.id === 'binance' && <img src="/binance.png" width={14} height={14} alt="" style={{verticalAlign:'middle', marginRight:5, borderRadius:'50%'}}/>}{m.l}
                    </button>
                  );
                })}
              </div>
              <div className="small muted" style={{marginTop:4}}>Obligatorio: al menos uno. Son los únicos que se ofrecerán al cobrar con este banco; si la cuenta queda vacía, se ofrecen todos.</div>
            </div>
            <div style={{gridColumn:'1/-1'}}>
              <label className="form-label">Color de tarjeta</label>
              <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                {COLOR_OPTS.map(c=>(
                  <div key={c} onClick={()=>upd('color',c)} style={{width:28,height:28,borderRadius:7,background:c,cursor:'pointer',border: form.color===c?'3px solid var(--text)':'3px solid transparent',flexShrink:0}}/>
                ))}
              </div>
            </div>
            <div>
              <label className="form-label">Ícono</label>
              <div style={{display:'flex', gap:8}}>
                {EMOJI_OPTS.map(e=>(
                  <div key={e} onClick={()=>upd('logo',e)} style={{width:34,height:34,borderRadius:8,cursor:'pointer',fontSize:18,display:'grid',placeItems:'center',border:`2px solid ${form.logo===e?'var(--brand)':'var(--border)'}`,background:form.logo===e?'var(--brand-soft)':'var(--bg-sunken)'}}>{e === 'binance' ? <img src="/binance.png" alt="Binance" style={{width:22,height:22,borderRadius:'50%',objectFit:'cover'}}/> : e}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
        {error && (
          <div style={{margin:'0 20px', padding:'8px 12px', background:'var(--danger-soft,#fef2f2)', color:'var(--danger)', border:'1px solid var(--danger)', borderRadius:8, fontSize:12.5}}>
            {error}
          </div>
        )}
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={handleSave} disabled={saving}>
            <Icon name="check" size={14}/>{saving?'Guardando…':(isNew?'Crear cuenta':'Guardar cambios')}
          </button>
        </div>
      </div>
    </div>
  );
}

function BankDetailView({ banco, cuentas, movs: movsWindow, onBack, filterTab, setFilterTab, reload }) {
  // Carga on-demand de TODOS los movimientos de la cuenta (SSData.movsBancarios está acotado a 365d
  // → ocultaba el 78% del histórico y el 100% de los egresos/vueltos 2023). El saldo (b.saldo) es
  // autoritativo de Odoo; esto solo completa la LISTA de transacciones.
  const [movsFull, setMovsFull] = useState(null);
  const [showMov, setShowMov] = useState(false);      // modal unificado: movimiento + ajuste + traspaso
  const [matchMov, setMatchMov] = useState(null);      // movimiento a conciliar (modal Match)
  const [asignarMov, setAsignarMov] = useState(null);  // ingreso suelto → saldo a favor de un cliente
  const [showActivity, setShowActivity] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let alive = true;
    window.fetchAll(() => window.sb.from('movimientos_bancarios').select('*').eq('empresa_id', window.currentEmpresa || 'demo1')
      .eq('cuenta_bancaria_id', banco.id).order('fecha', { ascending: false }))
      .then(({ data }) => { if (alive && Array.isArray(data)) setMovsFull(data.map(m => ({ ...m, monto: parseFloat(m.monto) || 0, matchId: m.match_id }))); })
      .catch(() => {});
    return () => { alive = false; };
  }, [banco.id, reloadKey]);
  const afterMov = async () => { setShowMov(false); setReloadKey(k => k + 1); await reload?.(); };
  // El botón "Movimiento" (movimiento / ajuste / traspaso) es un permiso especial (bank_movimiento):
  // visible para todos, pero sin permiso muestra alerta al hacer clic (no abre el modal).
  const abrirMovimiento = () => {
    if (!window.canUser('crear', 'bank_movimiento')) {
      alert('No tienes permiso para registrar movimientos bancarios (movimiento, ajuste o traspaso). Solicítalo a un administrador.');
      return;
    }
    setShowMov(true);
  };
  const movs = movsFull || movsWindow;

  // ── DE DÓNDE VIENE (o a dónde fue) CADA MOVIMIENTO ────────────────────────────────────────
  // Pedido del 2026-08-11: "súper importante de dónde vienen los pagos, explícito" — y en la
  // TABLA, no escondido en un detalle. Hasta acá el único rastro era la `descripcion` ("Cobro -
  // JUAN PEREZ"), un texto: no decía QUÉ factura y no llevaba a ninguna parte.
  //
  // Todo sale de lo que la fila ya trae (`documento_id`, `pago_id`, `match_id`,
  // `cuenta_bancaria_id`) más lo que ya está en memoria: no agrega ni un viaje al server.
  function origenDeMovimiento(m) {
    // TRASPASO: la otra pata es el hermano por `match_id`. Su cuenta puede ser de otra empresa,
    // así que se busca primero entre los movimientos cargados y si no, por el nombre del banco
    // que la propia descripción ya guarda.
    if (String(m.match_id || '').startsWith('TRF-')) {
      const hermano = (movs || []).find(x => x.match_id === m.match_id && x.id !== m.id);
      const nombre  = hermano?.banco
        || (String(m.descripcion || '').match(/Traspaso (?:a|desde) ([^([]+)/) || [])[1]?.trim()
        || 'la otra cuenta';
      const ctaId = hermano?.cuenta_bancaria_id
        || (SSData.cuentasBancarias || []).find(c => c.banco === nombre)?.id;
      return { etiqueta: (m.monto < 0 ? 'Traspaso a ' : 'Traspaso desde ') + nombre,
               detalle: 'Movimiento entre cuentas propias',
               ir: ctaId ? () => irAMovimiento(ctaId, hermano?.id) : null };
    }
    // ANTICIPO: dinero del cliente sin factura todavía. Lleva al módulo que lo administra.
    if (String(m.pago_id || '').startsWith('PAG-ANT-')) {
      return { etiqueta: 'Anticipo de cliente', detalle: 'Sin factura asignada todavía',
               ir: () => navigate && navigate('/anticipos') };
    }
    // COBRO de una factura: es el caso que más se mira. Lleva AL DOCUMENTO.
    if (m.documento_id) {
      const cta = (SSData.cuentasCobrar || []).find(c => c.factura === m.documento_id);
      const cli = (SSData.clientes || []).find(c => c.id === (m.cliente_id || cta?.cliente_id));
      return { etiqueta: m.documento_id,
               detalle: cli?.nombre || (m.monto > 0 ? 'Cobro de factura' : 'Pago'),
               ir: async () => { const ok = await window.abrirDocumentoPorId?.(m.documento_id); if (!ok) alert('No se pudo abrir ' + m.documento_id + '. Puede que lo hayan anulado.'); } };
    }
    // PAGO a proveedor: el `pago_id` del movimiento es la parte previa a '::' del id del pago
    // dentro del jsonb de la CxP (un mismo pago puede saldar varias cuentas).
    if (m.pago_id) {
      const cxp = (SSData.cuentasPagar || []).find(c =>
        (c.pagos || []).some(pg => String(pg.id || '').split('::')[0] === m.pago_id));
      if (cxp) {
        const prov = (SSData.proveedores || []).find(x => x.id === (cxp.proveedor_id || cxp.proveedor));
        return { etiqueta: cxp.factura || cxp.concepto || cxp.id,
                 detalle: prov?.nombre || 'Cuenta por pagar',
                 ir: () => irACuenta(cxp.id) };
      }
      const cta = (SSData.cuentasCobrar || []).find(c =>
        (c.pagos || []).some(pg => String(pg.id || '').split('::')[0] === m.pago_id));
      if (cta) {
        const cli = (SSData.clientes || []).find(x => x.id === cta.cliente_id);
        return { etiqueta: cta.factura || cta.id, detalle: cli?.nombre || 'Cuenta por cobrar',
                 ir: async () => {
                   if (!cta.factura) return irACuenta(cta.id);
                   const ok = await window.abrirDocumentoPorId?.(cta.factura);
                   if (!ok) alert('No se pudo abrir ' + cta.factura + '. Puede que lo hayan anulado.');
                 } };
      }
    }
    // Desvinculado: tenía un documento y ya no — se anuló, o el documento dejó de existir. El dinero
    // es real (no se toca), pero no hay a dónde navegar. Se dice explícito en vez de mostrarlo como
    // "cargado a mano", que sugeriría que nunca tuvo factura.
    if (m.desvinculado_de) {
      const cuando = m.desvinculado_en ? fmt.dateTime(m.desvinculado_en) : null;
      const info = `Anulado por ${m.desvinculado_por || '—'}${cuando ? ' · ' + cuando : ''}` +
        (m.desvinculado_motivo ? `\n${m.desvinculado_motivo}` : '');
      return { etiqueta: 'Desvinculado de ' + m.desvinculado_de, detalle: 'Pendiente de aplicar', ir: null, color: 'var(--warning, #d97706)', info };
    }
    // Sin rastro: se dice, en vez de dejar la celda vacía y que parezca un dato que falta.
    return { etiqueta: null,
             detalle: m.origin_odoo ? 'Movimiento histórico de Odoo' : 'Movimiento cargado a mano',
             ir: null };
  }
  // Ir a otra cuenta y dejar el movimiento resaltado (mismo puente que usan CxC/CxP).
  function irAMovimiento(cuentaId, movId) {
    try { if (movId) sessionStorage.setItem('ss-bank-focus', movId); } catch {}
    if (navigate) navigate('/banco/' + cuentaId);
  }
  function irACuenta(cuentaId) {
    try { sessionStorage.setItem('ss-cx-focus', cuentaId); } catch {}
    if (navigate) navigate(String(cuentaId).startsWith('CXP') ? '/cxp' : '/cxc');
  }

  // Conciliar/desconciliar: actualiza la lista visible (movsFull) y PERSISTE en la BD.
  // Antes llamaba a toggleConciliar del padre, que mutaba otro estado (SSData window) que
  // este detalle no renderiza → el botón "no hacía nada".
  const handleConciliar = async (mov, matchId = null) => {
    const nuevo = !mov.conciliado;
    const nid = nuevo ? (matchId || mov.matchId || mov.match_id || mov.pago_id || mov.documento_id || null) : null;
    setMovsFull(prev => (prev || movs).map(m => m.id === mov.id ? { ...m, conciliado: nuevo, matchId: nid, match_id: nid } : m));
    const { error } = await window.conciliarMovimientoBancario({ id: mov.id, conciliado: nuevo, matchId: nid });
    if (error) { alert('No se pudo actualizar la conciliación: ' + (error.message || 'error')); setReloadKey(k => k + 1); return; }
    await reload?.();   // refrescar la lista (conciliar es solo un flag; no cambia el saldo)
  };

  // Eliminar un movimiento (con confirmación). Saldo = Σ movimientos: borrar recalcula el saldo.
  const handleEliminar = async (mov) => {
    const esEgreso = (parseFloat(mov.monto) || 0) < 0;
    const montoTxt = (banco.moneda === 'USD' ? '$' : 'Bs. ') + Math.abs(parseFloat(mov.monto) || 0).toFixed(2);
    const afectaSaldo = !!mov.cuenta_bancaria_id;
    // Un movimiento con `pago_id` no es plata suelta: respalda un cobro o un pago. Al borrarlo
    // la deuda vuelve (window.revertirCobroDeMovimiento), y eso hay que decirlo ANTES.
    const esAnticipo = String(mov.pago_id || '').startsWith('PAG-ANT-');
    // Un movimiento MIGRADO de Odoo no se puede revertir: su pago no guarda a qué cuenta se aplicó
    // (ver revertirCobroDeMovimiento). El borrado se bloquea del lado de los datos; acá se avisa
    // antes en vez de prometer una reversión que no va a ocurrir.
    const esMigrado  = !!mov.origin_odoo || mov.origen_app === false;
    const revierte   = !!mov.pago_id && !esAnticipo && !esMigrado;
    // Un traspaso son DOS movimientos hermanados. Se avisa acá porque el usuario está mirando UNA
    // cuenta y el borrado también toca la otra — que puede ser de otra empresa.
    const esTraspaso = String(mov.match_id || '').startsWith('TRF-');
    const msg = `¿Eliminar este ${esEgreso ? 'egreso' : 'ingreso'} de ${montoTxt}?\n\n${mov.descripcion || ''}\n\n` +
      (esTraspaso
        ? 'Esto es un TRASPASO entre cuentas: se eliminan LAS DOS PATAS (el egreso de la cuenta de origen y el ingreso de la de destino), aunque sean de empresas distintas. Los dos saldos se recalculan.\n\n'
        : '') +
      (revierte
        ? `Este movimiento respalda un ${esEgreso ? 'pago' : 'cobro'}${mov.documento_id ? ` de ${mov.documento_id}` : ''}. Al eliminarlo, esa cuenta vuelve a quedar ${esEgreso ? 'POR PAGAR' : 'POR COBRAR'} por ${montoTxt}.\n\n`
        : '') +
      (esAnticipo ? 'Este movimiento es un ANTICIPO: se elimina desde Finanzas → Anticipos.\n\n' : '') +
      (esMigrado && mov.pago_id
        ? 'Este movimiento viene MIGRADO de Odoo y respalda un pago histórico que no guarda a qué cuenta se aplicó. No se puede borrar desde acá: borrarlo destruiría el registro del pago sin devolver la deuda.\n\n'
        : '') +
      `Esta acción no se puede deshacer.` +
      (afectaSaldo ? `\n\nEl saldo de la cuenta ${esEgreso ? 'subirá' : 'bajará'} ${montoTxt} (el saldo es la suma de los movimientos).` : '');
    if (!window.confirm(msg)) return;
    setMovsFull(prev => (prev || movs).filter(m => m.id !== mov.id));   // optimista
    const { error } = await window.eliminarMovimientoBancario(mov.id);
    if (error) { alert('No se pudo eliminar el movimiento: ' + (error.message || 'error')); setReloadKey(k => k + 1); return; }
    await reload?.();
  };
  const sinConc = movs.filter(m => !m.conciliado).length;
  const ingresos = movs.filter(m => m.monto > 0).reduce((s,m)=>s+m.monto,0);
  const egresos = movs.filter(m => m.monto < 0).reduce((s,m)=>s+Math.abs(m.monto),0);

  // ─── Filtros, búsqueda y orden de la tabla de movimientos ───────────────────
  // Enlace entrante desde CxP/CxC ("ver el movimiento de este pago"): el id de transacción llega
  // por sessionStorage (sobrevive el cambio de ruta y el chunk lazy) y acá se traduce a búsqueda
  // por ese id + highlight de la fila. Se consume una sola vez.
  const focusInicial = useMemo(() => {
    try {
      const raw = sessionStorage.getItem('ss-bank-focus');
      if (!raw) return '';
      sessionStorage.removeItem('ss-bank-focus');
      const f = JSON.parse(raw);
      if (!f || !f.movId) return '';
      if (f.cuentaId && f.cuentaId !== banco.id) return '';
      return String(f.movId);
    } catch (e) { return ''; }
  }, [banco.id]);
  const [focusMov, setFocusMov]   = useState(focusInicial);
  const [qGuardado, setQGuardado] = window.usePersistedState('ss-bankmov-f-q', '');
  const [q, setQ]                 = useState(focusInicial || qGuardado);
  useEffect(() => { if (!focusMov) setQGuardado(q); }, [q, focusMov]);
  const [fDesde, setFDesde]       = window.usePersistedState('ss-bankmov-f-desde', '');
  const [fHasta, setFHasta]       = window.usePersistedState('ss-bankmov-f-hasta', '');
  const [fCreadoPor, setFCreadoPor] = window.usePersistedState('ss-bankmov-f-usuario', '');
  // Ingresos vs egresos. Se filtra por el SIGNO del monto y no por la columna `tipo`: los egresos se
  // guardan en negativo (es el modelo del libro: saldo = Σ movimientos) y hay filas migradas de Odoo
  // donde `tipo` viene vacío pero el signo sí está.
  const [fTipo, setFTipo] = window.usePersistedState('ss-bankmov-f-tipo', '');   // '' | ingreso | egreso
  // Por defecto la fecha DESCENDENTE: en un libro de banco lo último es lo que se mira.
  const [ordCol, setOrdCol] = window.usePersistedState('ss-bankmov-f-ordcol', 'fecha');
  const [ordDir, setOrdDir] = window.usePersistedState('ss-bankmov-f-orddir', 'desc');
  function ordenarPor(col) {
    if (ordCol === col) setOrdDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setOrdCol(col); setOrdDir(col === 'fecha' || col === 'monto' ? 'desc' : 'asc'); }
  }
  // Quiénes registraron movimientos EN ESTA cuenta: la lista sale de los propios movimientos, no
  // de la tabla de usuarios — así solo aparecen los que de verdad tienen algo acá.
  const creadores = [...new Set(movs.map(m => m.creado_por).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));

  const filtrados = (() => {
    const norm = s => (s == null ? '' : String(s)).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const nq = norm(q.trim());
    let r = movs.filter(m => {
      if (filterTab === 'pendientes'  && m.conciliado) return false;
      if (filterTab === 'conciliados' && !m.conciliado) return false;
      if (fCreadoPor && (m.creado_por || '') !== fCreadoPor) return false;
      if (fTipo) {
        const monto = parseFloat(m.monto) || 0;
        const esIngreso = monto > 0 || (monto === 0 && m.tipo === 'ingreso');
        if (fTipo === 'ingreso' && !esIngreso) return false;
        if (fTipo === 'egreso'  &&  esIngreso) return false;
      }
      if (fDesde || fHasta) {
        const f = String(m.fecha || '').slice(0, 10);
        if (!f) return false;
        if (fDesde && f < fDesde) return false;
        if (fHasta && f > fHasta) return false;
      }
      if (!nq) return true;
      // Se busca en lo que la fila muestra: descripción, referencia, id, quién lo registró y el
      // monto tal como se ve (así "20561" encuentra el movimiento de Bs 20.561,50).
      return norm([m.descripcion, m.referencia, m.id, m.creado_por, m.tipo, m.monto,
                   m.pago_id, m.documento_id, m.created_at ? fmt.hora(m.created_at) : null]
                   .filter(v => v != null).join(' ')).includes(nq);
    });
    const val = (m) => {
      switch (ordCol) {
        case 'monto':       return Math.abs(parseFloat(m.monto) || 0);
        case 'descripcion': return norm(m.descripcion);
        case 'referencia':  return norm(m.referencia);
        case 'estado':      return m.conciliado ? 1 : 0;
        case 'creado_por':  return norm(m.creado_por);
        default:            return String(m.created_at || m.fecha || '');
      }
    };
    const dir = ordDir === 'asc' ? 1 : -1;
    return r.sort((a, b) => {
      const va = val(a), vb = val(b);
      const cmp = (typeof va === 'number' && typeof vb === 'number') ? (va - vb) : String(va).localeCompare(String(vb), 'es');
      // Desempate estable por id: sin esto, dos movimientos de la misma fecha (muy común en lo
      // migrado, que comparte timestamp) se reordenaban solos en cada render.
      return cmp * dir || String(a.id).localeCompare(String(b.id));
    });
  })();
  const hayFiltro = !!(q.trim() || fDesde || fHasta || fCreadoPor || fTipo);
  // Paginación estándar 50/100/200: una cuenta puede tener miles de movimientos; pintarlos todos
  // congelaba el navegador (bug: BANK-20 con 22k <tr>).
  const [pageSize, setPageSize] = useState(() => { const v = parseInt(localStorage.getItem('ss-bankmov-pagesize')); return [50,100,200].includes(v) ? v : 50; });
  const [page, setPage] = useState(1);
  useEffect(() => { localStorage.setItem('ss-bankmov-pagesize', String(pageSize)); }, [pageSize]);
  useEffect(() => { setPage(1); }, [filterTab, banco?.id, pageSize, q, fDesde, fHasta, fCreadoPor, fTipo, ordCol, ordDir]);
  const totalPagesMov = Math.max(1, Math.ceil(filtrados.length / pageSize));
  const pageSafe = Math.min(page, totalPagesMov);
  const visiblesRows = filtrados.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  // Exportar el libro de banco. El botón existía desde siempre SIN `onClick`: se veía habilitado,
  // se podía clickear y no hacía absolutamente nada. Se exporta lo FILTRADO (no la página): el
  // usuario filtró para exportar eso, y llevarle 50 filas de 3.000 sería peor que no exportar.
  // El monto va en la moneda de la cuenta, y aparte el equivalente en USD con su tasa, que es lo
  // que hace falta para cuadrar contra la contabilidad.
  function exportMovimientosXLSX() {
    if (filtrados.length === 0) { alert('No hay movimientos para exportar con los filtros puestos.'); return; }
    const enBs = banco.moneda !== 'USD';
    const data = filtrados.map(m => {
      const monto = parseFloat(m.monto) || 0;
      return {
        fecha:      String(m.fecha || '').slice(0, 10),
        hora:       m.created_at ? fmt.hora(m.created_at) : '',
        id:         m.id,
        descripcion: m.descripcion || '',
        tipo:       monto > 0 ? 'Ingreso' : 'Egreso',
        categoria:  m.categoria || '',
        monto:      parseFloat(monto.toFixed(2)),
        tasa:       m.tasa != null ? parseFloat(Number(m.tasa).toFixed(4)) : '',
        monto_usd:  m.monto_usd != null ? parseFloat(Number(m.monto_usd).toFixed(2)) : (enBs ? '' : parseFloat(monto.toFixed(2))),
        estado:     m.conciliado ? 'Conciliado' : 'Pendiente',
        match:      m.matchId || m.match_id || '',
        creado_por: m.creado_por || 'Sistema',
        origen:     m.origin_odoo ? 'Migrado (' + m.origin_odoo + ')' : 'Sistema',
      };
    });
    window.exportToXLSX(data, [
      { key:'fecha',       label:'Fecha' },
      { key:'hora',        label:'Hora' },
      { key:'id',          label:'ID transacción' },
      { key:'descripcion', label:'Descripción' },
      { key:'tipo',        label:'Tipo' },
      { key:'categoria',   label:'Categoría' },
      { key:'monto',       label: enBs ? 'Monto (Bs.)' : 'Monto (USD)' },
      { key:'tasa',        label:'Tasa' },
      { key:'monto_usd',   label:'Monto (USD)' },
      { key:'estado',      label:'Estado' },
      { key:'match',       label:'Match' },
      { key:'creado_por',  label:'Registrado por' },
      { key:'origen',      label:'Origen' },
    ], 'movimientos-' + (banco.banco || 'banco').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
       (banco.banco || 'Banco') + ' · Movimientos');
  }

  return (
    <div className="page">
      <div className="page-header">
        <div style={{display:'flex', alignItems:'center', gap:12, minWidth:0}}>
          <button className="btn ghost sm" onClick={onBack} style={{padding:'6px 8px'}}><Icon name="chevronL" size={14}/></button>
          <div className="bank-logo" style={{background: banco.color, width:40, height:40, fontSize:14, flexShrink:0}}>{banco.logo === 'binance' ? <img src="/binance.png" alt="Binance" style={{width:24,height:24,borderRadius:'50%',objectFit:'cover'}}/> : banco.logo}</div>
          <div style={{minWidth:0}}>
            <h1 className="page-title">{banco.banco}</h1>
            <div className="page-subtitle mono" style={{fontSize:12}}>{banco.cuenta} · {banco.tipo} · {banco.titular}</div>
          </div>
        </div>
        <div className="page-actions">
          <button className="btn ghost" onClick={()=>setShowActivity(true)} title="Ver todo lo que sucede en Bancos: movimientos creados, editados, eliminados">
            <Icon name="clock" size={14}/><span className="hide-sm">Actividad</span>
          </button>
          <button className="btn secondary" onClick={abrirMovimiento}><Icon name="plus" size={14}/><span className="hide-sm">Movimiento</span></button>
          <button className="btn secondary" onClick={exportMovimientosXLSX} title="Exportar los movimientos filtrados a Excel"><Icon name="download" size={14}/><span className="hide-sm">Exportar</span></button>
          <button className="btn primary"><Icon name="check" size={14}/><span className="hide-sm">Conciliar auto</span></button>
        </div>
      </div>
      {showMov && <MovimientoManualModal cuenta={banco} cuentas={cuentas} onClose={()=>setShowMov(false)} onDone={afterMov}/>}
      {/* Sin filtrar por cuenta: `entidad_id` en el log es a veces el id del MOVIMIENTO y a veces
          el de la CUENTA (según la acción) — no hay una clave común para filtrar "todo lo de esta
          cuenta" sin perder eventos. Se muestra el log completo del módulo, igual que en /banco. */}
      {showActivity && <ActivityLogModal modulo="bank" onClose={()=>setShowActivity(false)}/>}
      {/* Solo los anticipos se "asignan" acá: aplicar el saldo a favor a una cuenta por cobrar.
          Al aplicarlo cambian la CxC y el anticipo, así que se recarga todo. */}
      {asignarMov && (
        <AsignarIngresoClienteModal
          mov={asignarMov}
          onClose={() => setAsignarMov(null)}
          onDone={async () => { setAsignarMov(null); setReloadKey(k => k + 1); await reload?.(); }}
        />
      )}
      {matchMov && (
        <AplicarAnticipoBancoModal
          mov={matchMov}
          onClose={() => setMatchMov(null)}
          onDone={async () => { setMatchMov(null); setReloadKey(k => k + 1); await reload?.(); }}
        />
      )}

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">Saldo actual</div>
          <div className="stat-val">{banco.moneda === 'USD' ? fmt.usd(banco.saldo) : fmt.bs(banco.saldo)}</div>
          <div className="small mt-2" style={{color: banco.delta >= 0 ? 'var(--success)' : 'var(--danger)'}}>
            {banco.delta >= 0 ? '↑' : '↓'} {banco.moneda === 'USD' ? fmt.usd(Math.abs(banco.delta)) : fmt.bs(Math.abs(banco.delta))} ({banco.deltaPct.toFixed(1)}%)
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Ingresos del mes</div>
          <div className="stat-val" style={{color:'var(--success)'}}>{banco.moneda === 'USD' ? fmt.usd(ingresos) : fmt.bs(ingresos)}</div>
          <div className="small mt-2">{movs.filter(m=>m.monto>0).length} depósitos</div>
        </div>
        <div className="stat">
          <div className="stat-label">Egresos del mes</div>
          <div className="stat-val" style={{color:'var(--danger)'}}>{banco.moneda === 'USD' ? fmt.usd(egresos) : fmt.bs(egresos)}</div>
          <div className="small mt-2">{movs.filter(m=>m.monto<0).length} débitos</div>
        </div>
        <div className="stat">
          <div className="stat-label">Sin conciliar</div>
          <div className="stat-val" style={{color: sinConc > 0 ? 'var(--warn)' : 'var(--success)'}}>{sinConc}</div>
          <div className="small mt-2">de {movs.length} movimientos</div>
        </div>
      </div>

      {focusMov && (
        <div className="card mt-4" style={{padding:'10px 14px', display:'flex', alignItems:'center', gap:10, background:'var(--brand-soft)', borderColor:'var(--brand)'}}>
          <Icon name="link" size={15} style={{color:'var(--brand)'}}/>
          <div style={{flex:1, fontSize:12.5}}>
            Mostrando la transacción <span className="mono" style={{fontWeight:700}}>{focusMov}</span>
            {movsFull === null && <span className="muted"> · cargando los movimientos de la cuenta…</span>}
            {movsFull !== null && !movs.some(m => m.id === focusMov) && (
              <span style={{color:'var(--danger)'}}> · no se encontró en esta cuenta</span>
            )}
          </div>
          <button className="btn ghost sm" onClick={()=>{ setFocusMov(''); setQ(''); }}>Ver todos los movimientos</button>
        </div>
      )}
      <div className="tbl-wrap mt-4">
        <div className="tbl-toolbar">
          <div className="seg">
            <button className={filterTab==='todos'?'on':''} onClick={()=>setFilterTab('todos')}>Todos ({movs.length})</button>
            <button className={filterTab==='pendientes'?'on':''} onClick={()=>setFilterTab('pendientes')}>Sin conciliar ({sinConc})</button>
            <button className={filterTab==='conciliados'?'on':''} onClick={()=>setFilterTab('conciliados')}>Conciliados ({movs.length - sinConc})</button>
          </div>
          <div style={{position:'relative'}}>
            <Icon name="search" size={13} style={{position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)', pointerEvents:'none'}}/>
            <input className="input sm" style={{paddingLeft:28, minWidth:210}} value={q} onChange={e=>setQ(e.target.value)}
                   placeholder="Buscar descripción, referencia, monto…"/>
          </div>
          <input className="input sm" type="date" value={fDesde} onChange={e=>setFDesde(e.target.value)} title="Desde"/>
          <span className="small muted">→</span>
          <input className="input sm" type="date" value={fHasta} onChange={e=>setFHasta(e.target.value)} title="Hasta"/>
          <select className="input sm" value={fTipo} onChange={e=>setFTipo(e.target.value)} title="Ingresos o egresos">
            <option value="">Ingresos y egresos</option>
            <option value="ingreso">Solo ingresos</option>
            <option value="egreso">Solo egresos</option>
          </select>
          <select className="input sm" value={fCreadoPor} onChange={e=>setFCreadoPor(e.target.value)} title="Registrado por">
            <option value="">Todos los usuarios</option>
            {creadores.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {hayFiltro && (
            <button className="btn ghost sm" title="Limpiar filtros"
                    onClick={()=>{ setQ(''); setFDesde(''); setFHasta(''); setFCreadoPor(''); setFTipo(''); setFocusMov(''); }}>
              <Icon name="x" size={12}/>Limpiar
            </button>
          )}
          <span className="ml-auto small">
            {filtrados.length.toLocaleString('es-VE')} mov{filtrados.length !== 1 ? 's' : ''}
            {hayFiltro && <span className="muted"> de {movs.length.toLocaleString('es-VE')}</span>}
          </span>
        </div>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead><tr>
              <th style={{width: 40}}></th>
              {/* Cabeceras ordenables: clic alterna asc/desc y la flecha muestra el estado.
                  `Match` no se ordena (es un enlace, no un dato comparable). */}
              {[
                { k:'fecha',       l:'Fecha registro', cls:'hide-sm' },
                { k:'descripcion', l:'Descripción', cls:'' },
                { k:'monto',       l:'Monto',       cls:'num' },
              ].map(c => (
                <th key={c.k} className={c.cls} onClick={()=>ordenarPor(c.k)}
                    style={{cursor:'pointer', whiteSpace:'nowrap', userSelect:'none'}}
                    title={`Ordenar por ${c.l.toLowerCase()}`}>
                  {c.l}<span style={{opacity: ordCol===c.k ? 1 : 0.25, marginLeft:4}}>{ordCol===c.k ? (ordDir==='asc'?'▲':'▼') : '▼'}</span>
                </th>
              ))}
              <th style={{whiteSpace:'nowrap'}}>Origen / Destino</th>
              <th className="hide-sm">Match</th>
              <th onClick={()=>ordenarPor('estado')} style={{cursor:'pointer', whiteSpace:'nowrap', userSelect:'none'}} title="Ordenar por estado">
                Estado<span style={{opacity: ordCol==='estado' ? 1 : 0.25, marginLeft:4}}>{ordCol==='estado' ? (ordDir==='asc'?'▲':'▼') : '▼'}</span>
              </th>
              <th className="hide-sm" style={{width: 160}}></th>
              <th className="dt-hide-mobile" onClick={()=>ordenarPor('creado_por')} style={{cursor:'pointer', whiteSpace:'nowrap', userSelect:'none'}} title="Ordenar por quién lo registró">
                Creado por<span style={{opacity: ordCol==='creado_por' ? 1 : 0.25, marginLeft:4}}>{ordCol==='creado_por' ? (ordDir==='asc'?'▲':'▼') : '▼'}</span>
              </th>
            </tr></thead>
            <tbody>
              {visiblesRows.map(m => (
                // Clic en la fila: solo tiene sentido en un anticipo (hay algo que asignar). Un cobro
                // o un pago ya vino atado a su documento desde CxC/CxP.
                // Clic en la fila: en un anticipo sin conciliar abre la asignación; en cualquier
                // otro movimiento con rastro, LLEVA a donde vino (pedido: "cuando le dé a un cobro
                // me lleve automáticamente a ese cobro específicamente").
                <tr key={m.id}
                    onClick={()=> {
                      if (!m.conciliado && esMovAnticipo(m)) { setMatchMov(m); return; }
                      const o = origenDeMovimiento(m);
                      if (o.ir) o.ir();
                    }}
                    style={{ cursor:'pointer',
                             ...(m.id === focusMov ? {background:'var(--brand-soft)', boxShadow:'inset 3px 0 0 var(--brand)'} : {}) }}>
                  <td>
                    <div style={{width: 24, height: 24, borderRadius: 6, background: m.monto > 0 ? 'var(--success-soft)' : 'var(--danger-soft)', color: m.monto > 0 ? 'var(--success)' : 'var(--danger)', display:'grid', placeItems:'center'}}>
                      <Icon name={m.monto > 0 ? 'arrDn' : 'arrUp'} size={12}/>
                    </div>
                  </td>
                  <td className="muted hide-sm" style={{whiteSpace:'nowrap'}}>
                    {fmt.date(m.fecha)}
                    {/* La HORA del registro sale de `created_at`. Lo migrado de Odoo no la tiene
                        (la columna `fecha` es un date): ahí se muestra solo la fecha. */}
                    {m.created_at && <div className="small mono" style={{fontSize:10.5, opacity:.75}}>{fmt.hora(m.created_at)}</div>}
                  </td>
                  <td style={{fontSize: 12.5, minWidth: 0}}>
                    <div>
                      {m.descripcion}
                      {/* Chip MIG igual que en documentos, CxC y pagos: identifica de un
                          vistazo lo que vino de Odoo, con su referencia original. */}
                      {m.origin_odoo && (
                        <span title={'Migrado de Odoo · ' + m.origin_odoo}
                              style={{marginLeft:6, fontSize:9, padding:'1px 5px', borderRadius:4,
                                      background:'var(--bg-sunken)', color:'var(--text-muted)',
                                      fontWeight:700, letterSpacing:'0.04em', verticalAlign:'middle'}}>MIG</span>
                      )}
                    </div>
                    {/* El id ES el número de transacción: es el que se enlaza desde CxP/CxC. */}
                    <div className="mono muted" style={{fontSize:10.5, marginTop:2}} title="ID de transacción">{m.id}</div>
                    <div className="show-sm-only small muted" style={{fontSize:11, marginTop:2}}>
                      {fmt.date(m.fecha)}{m.matchId ? ' · ' + m.matchId : ''}
                    </div>
                  </td>
                  <td style={{fontSize:12}} onClick={e=>e.stopPropagation()}>
                    {(() => {
                      const o = origenDeMovimiento(m);
                      return (
                        <>
                          {o.etiqueta ? (
                            o.ir ? (
                              <a href="#" onClick={e => { e.preventDefault(); o.ir(); }}
                                 style={{color:'var(--brand)', fontWeight:600, textDecoration:'none'}}
                                 title="Abrir de dónde viene este movimiento">{o.etiqueta}</a>
                            ) : <span style={{fontWeight:600, color: o.color || undefined}}>
                                  {o.etiqueta}
                                  {o.info && (
                                    <span title={o.info} style={{marginLeft:4, display:'inline-flex', verticalAlign:'middle'}}>
                                      <Icon name="info" size={10}/>
                                    </span>
                                  )}
                                </span>
                          ) : null}
                          <div className="small muted" style={{fontSize:10.5, marginTop: o.etiqueta ? 2 : 0}}>{o.detalle}</div>
                        </>
                      );
                    })()}
                  </td>
                  <td className="num strong-num" style={{color: m.monto > 0 ? 'var(--success)' : 'var(--danger)', whiteSpace:'nowrap'}}>{m.monto > 0 ? '+' : ''}{banco.moneda === 'USD' ? fmt.usd(m.monto) : fmt.bs(m.monto)}</td>
                  <td className="hide-sm">{m.matchId ? <span className="chip blue"><Icon name="link" size={10}/> {m.matchId}</span> : <span className="small muted">—</span>}</td>
                  <td>
                    {m.conciliado ? <span className="chip green"><Icon name="check" size={10}/>Conciliado</span> : <span className="chip amber">Pendiente</span>}
                    {!m.origen_app && <div className="small muted" style={{fontSize:10, marginTop:2}} title="Movimiento histórico migrado — conciliar/deshacer no afecta el saldo, solo el estado.">Histórico</div>}
                    {/* Quién gestionó el movimiento. "Creado por el sistema" no alcanza:
                        detrás de un cobro hay una persona que lo registró. */}
                    {m.creado_por && (
                      <div className="small muted" style={{fontSize:10, marginTop:2, display:'flex', alignItems:'center', gap:3}}
                           title={'Registrado por ' + m.creado_por}>
                        <Icon name="user" size={9}/>{m.creado_por}
                      </div>
                    )}
                  </td>
                  <td className="hide-sm" onClick={e=>e.stopPropagation()}>
                    <div className="flex gap-2" style={{alignItems:'center'}}>
                      {!m.conciliado ? (
                        <>
                          {/* "Aplicar" solo en anticipos: es el único movimiento con saldo a favor
                              pendiente de asignar a una factura. */}
                          {esMovAnticipo(m) && window.canUser?.('editar','bank') !== false && (
                            <button className="btn sm ghost" onClick={()=>setMatchMov(m)}
                                    title="Aplicar este anticipo a una cuenta por cobrar">Aplicar</button>
                          )}
                          {/* Un INGRESO que no está atado a nada: plata que llegó y todavía no
                              sabemos de quién es. Asignarle el cliente lo convierte en saldo a
                              favor suyo SIN duplicar el ingreso (ver window.movimientoAAnticipo). */}
                          {esIngresoSinAsignar(m) && window.canUser?.('editar','bank') !== false && (
                            <button className="btn sm ghost" onClick={()=>setAsignarMov(m)}
                                    title="Identificar de qué cliente es este ingreso y dejarlo como saldo a favor">Asignar a cliente</button>
                          )}
                          {window.canUser?.('editar','bank') !== false && <button className="btn sm primary" onClick={()=>handleConciliar(m)}>Conciliar</button>}
                        </>
                      ) : (
                        window.canUser?.('editar','bank') !== false && <button className="btn sm ghost" onClick={()=>handleConciliar(m)}>Deshacer</button>
                      )}
                      {window.canUser?.('crear','bank_movimiento') !== false && (
                      <button className="icon-btn" title="Eliminar movimiento" onClick={()=>handleEliminar(m)} style={{color:'var(--danger)'}}><Icon name="trash" size={13}/></button>
                      )}
                    </div>
                  </td>
                  <td className="dt-hide-mobile"><CreadoPorCell nombre={m.creado_por}/></td>
                </tr>
              ))}
              {filtrados.length === 0 && <tr><td colSpan="9" className="empty">Sin movimientos</td></tr>}
            </tbody>
          </table>
          {filtrados.length > 0 && (
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, padding:'10px 12px', flexWrap:'wrap'}}>
              <div className="small muted" style={{display:'flex', alignItems:'center', gap:6}}>
                Filas por página:
                <select className="select" value={pageSize} onChange={e=>setPageSize(parseInt(e.target.value))} style={{fontSize:12, padding:'3px 6px'}}>
                  {[50,100,200].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="small muted">
                {(pageSafe-1)*pageSize + 1}–{Math.min(pageSafe*pageSize, filtrados.length)} de {filtrados.length}
              </div>
              <div style={{display:'flex', alignItems:'center', gap:4}}>
                <button className="btn ghost sm" disabled={pageSafe<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}><Icon name="chevronL" size={13}/></button>
                <span className="small" style={{minWidth:70, textAlign:'center'}}>Pág. {pageSafe} / {totalPagesMov}</span>
                <button className="btn ghost sm" disabled={pageSafe>=totalPagesMov} onClick={()=>setPage(p=>Math.min(totalPagesMov,p+1))}><Icon name="chevronR" size={13}/></button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Un movimiento de banco que es un ANTICIPO: aplicarlo a una cuenta por cobrar ───────────
// Antes acá vivía un `MatchModal` SIMULADO: listaba `SSData.documentos.slice(0,4)` (los primeros 4
// documentos en memoria, cotizaciones incluidas), los radios no hacían nada, "+ Buscar otro
// documento" no tenía onClick y el monto se imprimía siempre con `fmt.usd` — por eso un anticipo de
// 53.000 Bs. aparecía como $53.000. Se reemplazó por el modal REAL de anticipos
// (`window.AplicarAnticipoModal`), que ya sabe de cliente, facturas pendientes, topes y moneda.
// Los movimientos que NO son anticipos no abren nada: un cobro o un pago ya nació atado a su
// documento desde CxC/CxP, no hay nada que asignarle acá.
function AplicarAnticipoBancoModal({ mov, onClose, onDone }) {
  const [estado, setEstado]     = useState('cargando');   // cargando | listo | error
  const [anticipo, setAnticipo] = useState(null);
  const [detalle, setDetalle]   = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      // El chunk de anticipos es lazy (ruta /anticipos): desde Bancos hay que pedirlo.
      if (!window.AplicarAnticipoModal && window.__loadChunk) {
        try { await window.__loadChunk('anticipos'); } catch (e) {}
      }
      if (!Array.isArray(SSData.anticipos) || SSData.anticipos.length === 0) {
        await window.loadAnticipos?.();
      }
      if (!alive) return;
      const ant = (SSData.anticipos || []).find(a => a.pago_id === mov.pago_id);
      if (!window.AplicarAnticipoModal) { setEstado('error'); setDetalle('No se pudo cargar el módulo de anticipos.'); return; }
      if (!ant) { setEstado('error'); setDetalle('No se encontró el anticipo de este movimiento (¿se eliminó?).'); return; }
      setAnticipo(ant); setEstado('listo');
    })();
    return () => { alive = false; };
  }, [mov.pago_id]);

  if (estado === 'listo' && anticipo) {
    const Modal = window.AplicarAnticipoModal;
    return <Modal anticipo={anticipo} onClose={onClose} onSaved={onDone}/>;
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 420 }}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}>
            <Icon name="link" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">Aplicar anticipo</h3>
            <div className="small">{mov.descripcion}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          {estado === 'cargando'
            ? <div className="small muted" style={{display:'flex',alignItems:'center',gap:8}}><span className="ss-busy-spin"/>Cargando los anticipos…</div>
            : <div style={{color:'var(--danger)',fontSize:13}}>{detalle}</div>}
        </div>
        <div className="modal-footer"><button className="btn ghost" onClick={onClose}>Cerrar</button></div>
      </div>
    </div>
  );
}

// Un movimiento es anticipo si su pago lo es. El id del pago lo dice (`PAG-ANT-…`, ver
// crearAnticipo) sin depender de que los anticipos estén cargados en memoria; y si ya están
// cargados, se confirma contra la lista — así un anticipo que entrara con otro id igual se reconoce.
function esMovAnticipo(mov) {
  if (!mov || typeof mov.pago_id !== 'string' || !mov.pago_id) return false;
  if (mov.pago_id.startsWith('PAG-ANT-')) return true;
  return (SSData.anticipos || []).some(a => a.pago_id === mov.pago_id);
}

// Un INGRESO que no representa a nadie todavía: no está atado a un pago, ni a un documento, ni es
// la pata de un traspaso. Son los que se pueden identificar contra un cliente y dejar como saldo a
// favor suyo.
//
// Se excluyen por PREFIJO DE ID los que no son plata de un cliente: `MOV-AJU-` (ajuste de saldo),
// `MOV-APER-` (saldo inicial de apertura) y `MOV-INV-` (inversión) — la misma separación que hace
// `loadGastosPeriodo` para no contarlos como gasto operativo. Medido el 2026-08-13: los 13 ingresos
// sueltos de 2026 son exactamente esos, así que sin este filtro el botón aparecería solo donde no
// corresponde.
function esIngresoSinAsignar(mov) {
  if (!mov || (parseFloat(mov.monto) || 0) <= 0) return false;
  if (mov.pago_id || mov.documento_id || mov.match_id) return false;
  const id = String(mov.id || '');
  return !/^MOV-(AJU|APER|INV)-/.test(id);
}

// Identificar de quién es un ingreso suelto y dejarlo como saldo a favor de ese cliente.
// Pedido del 2026-08-13: "cómo entró el pago se queda, pero tiene que hacer match con el cliente y
// automáticamente se debe ir a anticipo". No crea un movimiento nuevo: la plata ya está en el banco
// (crear el anticipo desde el módulo de Anticipos SÍ lo crearía, y el ingreso quedaría duplicado).
function AsignarIngresoClienteModal({ mov, onClose, onDone }) {
  const [clienteId, setClienteId] = React.useState('');
  const [notas, setNotas]   = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError]   = React.useState('');
  // El catálogo de clientes es diferido y desde Bancos no está cargado: sin esto el buscador
  // aparecería vacío y parecería que no hay clientes (ver CLAUDE.md, RUTAS_CON_CATALOGO).
  React.useEffect(() => { window.ensureClientesCatalogo?.(); }, []);
  const opciones = React.useMemo(() => (SSData.clientes || [])
    .map(c => ({ value: c.id, label: c.nombre, sublabel: c.rif || '' })), [SSData.clientes, SSData.clientes?.length]);
  const esBs = (mov.moneda || 'USD') === 'VES';
  const monto = Math.abs(parseFloat(mov.monto) || 0);

  async function guardar() {
    if (!clienteId) { setError('Elegí el cliente al que pertenece este ingreso.'); return; }
    setError(''); setSaving(true);
    const r = await window.movimientoAAnticipo({ movId: mov.id, clienteId, notas: notas || null });
    setSaving(false);
    if (r?.error) { setError(r.error.message || 'No se pudo asignar.'); return; }
    onDone?.();
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-fullscreen-mobile" onClick={e => e.stopPropagation()} style={{ width: 520 }}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}>
            <Icon name="clients" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">¿De quién es este ingreso?</h3>
            <div className="small">Queda como saldo a favor del cliente</div>
          </div>
          <button className="btn ghost sm" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <div className="modal-body" style={{display:'flex', flexDirection:'column', gap:12}}>
          <div style={{background:'var(--bg-sunken)', borderRadius:8, padding:'10px 12px', fontSize:12.5}}>
            <div style={{display:'flex', justifyContent:'space-between', gap:10}}>
              <span className="muted">{mov.banco} · {fmt.date(mov.fecha)}</span>
              <strong>{esBs ? fmt.ves(monto) : fmt.usd(monto)}</strong>
            </div>
            <div style={{marginTop:4}}>{mov.descripcion || '—'}</div>
          </div>
          <div>
            <label className="label">Cliente *</label>
            <SearchSelect value={clienteId} onChange={setClienteId} options={opciones}
                          placeholder="Buscar por nombre o RIF…"/>
          </div>
          <div>
            <label className="label">Nota (opcional)</label>
            <input className="input" value={notas} onChange={e => setNotas(e.target.value)}
                   placeholder="Ej: transferencia recibida sin aviso"/>
          </div>
          <div className="small muted">
            El movimiento del banco no se toca: sigue como entró. Lo que se crea es el saldo a favor,
            que después se aplica a cualquier nota de este cliente desde Anticipos o al cobrar.
          </div>
          {error && (
            <div style={{background:'var(--danger-soft)', border:'1px solid var(--danger)', borderRadius:8, padding:'10px 14px', fontSize:12.5, color:'var(--danger)'}}>{error}</div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={guardar} disabled={saving || !clienteId}>
            {saving ? 'Asignando…' : 'Dejar como saldo a favor'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Un traspaso entre empresas que acredita a un cliente en la de DESTINO muchas veces está sacando
// esa plata del saldo a favor que el MISMO cliente tiene en la de ORIGEN. Pedido el 2026-08-13:
// "a lo mejor sigue quedando en anticipo en demo1; tendría que debitarse el monto que se está
// pasando hacia demo2 de ese cliente también". Sin esto el crédito quedaba duplicado: el cliente
// figuraba con saldo a favor en las dos empresas por la misma plata.
//
// Es OPCIONAL a propósito: un traspaso también puede ser plata de la empresa, no de un cliente.
function SaldoOrigenPicker({ clienteId, empresaOrigen, montoUsd, value, onChange }) {
  const [ants, setAnts] = React.useState(null);   // null = todavía buscando
  React.useEffect(() => {
    let alive = true;
    if (!clienteId) { setAnts([]); return; }
    setAnts(null);
    (window.anticiposDisponiblesCliente?.(clienteId, empresaOrigen) || Promise.resolve({ data: [] }))
      .then(r => { if (alive) setAnts(r.data || []); });
    return () => { alive = false; };
  }, [clienteId, empresaOrigen]);

  if (!clienteId) return null;
  if (ants === null) return <div className="small muted" style={{marginTop:8}}>Buscando su saldo a favor en {empresaOrigen}…</div>;
  if (!ants.length) return (
    <div className="small muted" style={{marginTop:8}}>
      Este cliente no tiene saldo a favor en {empresaOrigen}, así que no hay nada que descontar allá.
    </div>
  );

  const sel = ants.find(a => a.pago_id === value);
  const saldoSel = sel ? (parseFloat(sel.saldo_usd) || 0) : 0;
  const alcanza = !sel || saldoSel + 0.005 >= montoUsd;
  return (
    <div style={{marginTop:10, borderTop:'1px dashed var(--border)', paddingTop:10}}>
      <label className="small muted" style={{display:'block', marginBottom:4}}>
        Descontar de su saldo a favor en {empresaOrigen}
      </label>
      <select className="input" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">— No descontar (es plata de la empresa) —</option>
        {ants.map(a => (
          <option key={a.pago_id} value={a.pago_id}>
            {fmt.date(a.fecha)} · disponible {fmt.usd(a.saldo_usd)}{a.referencia ? ' · ref ' + a.referencia : ''}
          </option>
        ))}
      </select>
      {sel && (
        <div className="small" style={{marginTop:5, color: alcanza ? 'var(--text-muted)' : 'var(--danger)'}}>
          {alcanza
            ? <>Se le descuentan <strong>{fmt.usd(montoUsd)}</strong> allá; le quedan {fmt.usd(saldoSel - montoUsd)}.</>
            : <>Ese saldo a favor solo tiene {fmt.usd(saldoSel)} y el traspaso son {fmt.usd(montoUsd)}.</>}
        </div>
      )}
    </div>
  );
}

function ImportStatementModal({ onClose, bancos }) {
  const [banco, setBanco] = useState(bancos[0].id);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width: 560}}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}><Icon name="upload" size={20}/></div>
          <div style={{flex:1}}><h3 className="modal-title">Importar estado de cuenta</h3><div className="small">Carga un archivo .csv, .xlsx o .ofx</div></div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          <label className="form-label">Banco / cuenta</label>
          <select className="select" style={{width:'100%'}} value={banco} onChange={e=>setBanco(e.target.value)}>
            {bancos.map(b => <option key={b.id} value={b.id}>{b.banco} — {b.cuenta}</option>)}
          </select>
          <div className="card mt-4" style={{padding:32, textAlign:'center', border:'2px dashed var(--border-strong)', background:'var(--bg-sunken)', cursor:'pointer'}}>
            <Icon name="upload" size={28}/>
            <div style={{fontSize:13, fontWeight:500, marginTop:8}}>Arrastra el archivo o haz clic para seleccionar</div>
            <div className="small mt-1">CSV, XLSX, OFX · máx. 10 MB</div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" onClick={onClose}><Icon name="check" size={14}/>Procesar</button>
        </div>
      </div>
    </div>
  );
}

window.ContactsPage = function ContactsPage() {
  const [search, setSearch]     = useState('');
  const [clienteF, setClienteF] = useState('');
  const [sel, setSel]           = useState(null);
  const [showNew, setShowNew]   = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(() => loadPageSize('contactos', 50));
  useEffect(() => { localStorage.setItem('ss-contactos-pagesize', String(pageSize)); }, [pageSize]);
  const [v, setV]               = useState(0);
  const refresh = () => setV(x => x+1);

  // ── Carga PAGINADA server-side ──────────────────────────────────────────────
  // Antes se bajaban los 13.150 contactos y se filtraba/paginaba en memoria. Ahora se pide
  // solo la página. La búsqueda por EMPRESA del contacto (el nombre del cliente, que no está
  // en la tabla `contactos`) se resuelve traduciendo el texto a ids de cliente en el server.
  const [paginaContactos, setPaginaContactos] = useState([]);
  const [totalFilas, setTotalFilas]           = useState(0);
  const [cargando, setCargando]               = useState(true);
  useEffect(() => {
    if (!window.loadContactos) return;
    let vivo = true;
    setCargando(true);
    const pedir = async () => {
      const term = search.trim();
      const clienteIds = term ? await (window.buscarClienteIds?.(term) || Promise.resolve([])) : [];
      if (!vivo) return;
      const r = await window.loadContactos({ page, pageSize, search: term, clienteId: clienteF || null, clienteIds });
      if (!vivo) return;
      setPaginaContactos(r.rows); setTotalFilas(r.total); setCargando(false);
    };
    if (!search.trim()) { pedir(); return () => { vivo = false; }; }
    const t = setTimeout(pedir, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [page, pageSize, search, clienteF, v]);

  const clientesById = useMemo(() => new Map((SSData.clientes || []).map(c => [c.id, c])), [SSData.clientes, paginaContactos]);
  const rows = paginaContactos;
  const totalPages = Math.max(1, Math.ceil(totalFilas / pageSize));
  const paginated  = rows;
  // Selecciona la PÁGINA visible (ya no está todo el universo en memoria; y una acción masiva
  // sobre 13.150 contactos que no se ven en pantalla es justo lo que no conviene de un clic).
  function toggleAll() { if(selected.size>=rows.length)setSelected(new Set());else setSelected(new Set(rows.map(c=>c.id))); }
  function toggleOne(id,e) { e.stopPropagation();setSelected(prev=>{const s=new Set(prev);s.has(id)?s.delete(id):s.add(id);return s;}); }

  async function bulkDelete() {
    if (!confirm(`¿Eliminar ${selected.size} contacto${selected.size!==1?'s':''}? Se enviarán a la papelera.`)) return;
    const targets = (window.SSData.contactos || []).filter(c => selected.has(c.id));
    const ok = [], fail = [];
    for (const c of targets) {
      const { error } = await window.sb.from('contactos').delete().eq('id', c.id);
      if (!error) { window.ssTrash?.add('contacto', c.nombre, c); ok.push(c); }
      else fail.push(c);
    }
    // Fix bug #29 (mismo patrón que clientes/proveedores): mutar SSData por `selected`
    // (no por `ok`) ocultaba contactos cuyo delete falló en DB.
    const okIds = new Set(ok.map(c => c.id));
    window.SSData.contactos = (window.SSData.contactos || []).filter(c => !okIds.has(c.id));
    setSelected(new Set()); refresh();
    if (fail.length) alert(`No se pudieron eliminar ${fail.length} contacto${fail.length!==1?'s':''}: ` + fail.map(c=>c.nombre).join(', '));
    if (ok.length) window.logActivity?.({
      modulo:'contactos', accion: ok.length===1?'eliminar':'bulk_eliminar',
      entidad_id: ok.length===1?ok[0].id:null,
      entidad_label: ok.length===1?ok[0].nombre:`${ok.length} contactos`,
      detalles:{ ids: ok.map(c=>c.id), nombres: ok.map(c=>c.nombre) }
    });
  }

  function exportContactosXLSX() {
    const source = (selected.size > 0 ? rows.filter(c => selected.has(c.id)) : rows);
    if (source.length === 0) { alert('No hay contactos para exportar.'); return; }
    const data = source.map(c => {
      const cli = SSData.clientes.find(cl => cl.id === c.cliente_id);
      return {
        nombre: c.nombre || '',
        cargo: c.cargo || '',
        cliente: cli?.nombre || '',
        rif_cliente: cli?.rif || '',
        telefono: c.telefono || '',
        email: c.email || '',
        portal: c.portal_acceso ? 'Sí' : 'No',
      };
    });
    window.exportToXLSX(data, [
      { key:'nombre',      label:'Nombre' },
      { key:'cargo',       label:'Cargo' },
      { key:'cliente',     label:'Cliente' },
      { key:'rif_cliente', label:'RIF Cliente' },
      { key:'telefono',    label:'Teléfono' },
      { key:'email',       label:'Email' },
      { key:'portal',      label:'Acceso Portal' },
    ], 'contactos', 'Contactos');
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Contactos</h1>
          <div className="page-subtitle">{totalFilas.toLocaleString('es-VE')} contactos</div>
        </div>
        <div className="page-actions">
          <button className="btn secondary" onClick={exportContactosXLSX}><Icon name="download" size={14}/>Exportar</button>
          {window.canUser?.('crear','contacts') !== false && (
          <button className="btn primary" onClick={()=>setShowNew(true)}><Icon name="plus" size={14}/>Nuevo contacto</button>
          )}
          <button className="btn ghost" onClick={() => setShowActivity(true)} title="Ver registro de actividad"><Icon name="receipt" size={14}/>Actividad</button>
        </div>
      </div>

      {showActivity && <ActivityLogModal modulo="contactos" onClose={()=>setShowActivity(false)}/>}

      <div className="tbl-wrap mt-4">
        <div className="tbl-toolbar">
          <input className="input search" placeholder="Buscar nombre, cargo, email o empresa..." value={search} onChange={e=>{setSearch(e.target.value);setPage(1);setSelected(new Set());}} style={{width:280}}/>
          {/* Filtro por empresa con búsqueda remota: un <select> con las 13.096 opciones exigía
              tener el catálogo entero cargado (y era inusable de todos modos). */}
          <div style={{minWidth:240}}>
            <SearchSelect value={clienteF} onChange={v=>{setClienteF(v);setPage(1);setSelected(new Set());}}
                          options={[]}
                          onSearchRemote={q => window.buscarClientesContactos(q, { soloClientes: true })}
                          selectedLabel={(SSData.clientes || []).find(c => c.id === clienteF)?.nombre || ''}
                          placeholder="Todas las empresas"/>
          </div>
          <span className="ml-auto small">{cargando ? 'Cargando…' : `${totalFilas.toLocaleString('es-VE')} contactos`}{selected.size>0?` · ${selected.size} seleccionados`:''}</span>
        </div>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{width:36,padding:'4px 10px'}}>
                  <input type="checkbox"
                    ref={el=>{if(el)el.indeterminate=selected.size>0&&selected.size<rows.length;}}
                    checked={rows.length>0&&selected.size>=rows.length}
                    onChange={toggleAll} style={{cursor:'pointer'}}/>
                </th>
                <th>Contacto</th><th className="hide-sm">Cargo</th><th className="hide-sm">Cliente</th><th className="hide-sm">Teléfono</th><th className="hide-sm">Email</th><th className="hide-sm">Portal</th><th className="dt-hide-mobile">Creado por</th><th className="hide-sm"></th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(c => {
                const cli = clientesById.get(c.cliente_id);
                const prov = (!cli && c.proveedor_id) ? (SSData.proveedores || []).find(p => p.id === c.proveedor_id) : null;
                const vinc = cli?.nombre || prov?.nombre || '';
                const tc = SSData.tiposCliente.find(t => t.id === cli?.tipo);
                const isSel = selected.has(c.id);
                return (
                  <tr key={c.id}
                    onClick={e=>{if(selected.size>0)toggleOne(c.id,e);else setSel(c);}}
                    style={{cursor:'pointer',background:isSel?'var(--brand-soft)':''}}>
                    <td style={{padding:'4px 10px',width:36}} onClick={e=>toggleOne(c.id,e)}>
                      <input type="checkbox" checked={isSel} onChange={()=>{}} style={{cursor:'pointer',pointerEvents:'none'}}/>
                    </td>
                    <td>
                      <div style={{display:'flex', alignItems:'center', gap:10}}>
                        <div style={{width:32, height:32, borderRadius:8, background:'var(--brand-soft)', color:'var(--brand)', display:'grid', placeItems:'center', fontWeight:600, fontSize:12, flexShrink:0}}>
                          {c.nombre.slice(0,2).toUpperCase()}
                        </div>
                        <div style={{flex:1, minWidth:0}}>
                          <div style={{fontWeight:500}}>{c.nombre}</div>
                          <div className="show-sm-only small" style={{display:'flex', flexDirection:'column', gap:2, marginTop:2}}>
                            {c.cargo && <span className="muted" style={{fontSize:11}}>{c.cargo}{vinc ? ' · ' + vinc : ''}</span>}
                            {!c.cargo && vinc && <span className="muted" style={{fontSize:11}}>{vinc}</span>}
                            {(c.telefono || c.email) && <span className="mono" style={{fontSize:10.5, color:'var(--text-muted)'}}>{[c.telefono, c.email].filter(Boolean).join(' · ')}</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="muted hide-sm" style={{fontSize:12.5}}>{c.cargo || '—'}</td>
                    <td className="hide-sm">
                      <div style={{fontWeight:500, fontSize:12.5}}>{vinc || '—'}</div>
                      {tc && <span className="chip" style={{background: tc.color+'20', color: tc.color, fontSize:10}}><span className="chip-dot"/>{tc.nombre}</span>}
                      {prov && <span className="chip amber" style={{fontSize:10}}><span className="chip-dot"/>Proveedor</span>}
                    </td>
                    <td className="mono hide-sm" style={{fontSize:12}}>{c.telefono || '—'}</td>
                    <td className="small hide-sm">{c.email || '—'}</td>
                    <td className="hide-sm">
                      {c.usuario_id
                        ? <span className="chip purple" style={{fontSize:11}}>Activado</span>
                        : <span className="chip neutral" style={{fontSize:11}}>—</span>}
                    </td>
                    <td className="dt-hide-mobile"><CreadoPorCell nombre={c.creado_por}/></td>
                    <td className="hide-sm">
                      <button className="btn sm ghost" onClick={e=>{e.stopPropagation(); window.__ssPosPreselect={clienteId:c.id}; if(window.__ssNavigate) window.__ssNavigate('pos');}}>
                        <Icon name="pos" size={12}/>Nueva orden
                      </button>
                    </td>
                  </tr>
                );
              })}
              {paginated.length === 0 && <tr><td colSpan={9} className="empty">Sin contactos</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px',borderTop:'1px solid var(--border)',fontSize:12,gap:10,flexWrap:'wrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span className="muted">Filas por página:</span>
            <select className="select" value={pageSize} onChange={e=>{setPageSize(parseInt(e.target.value));setPage(1);}} style={{fontSize:12,padding:'3px 6px'}}>
              {PAGE_SIZE_OPTS.map(n=><option key={n} value={n}>{n}</option>)}
            </select>
            <span className="muted">{totalFilas===0?'0':`Mostrando ${(page-1)*pageSize+1}–${Math.min(page*pageSize,totalFilas)} de ${totalFilas.toLocaleString('es-VE')}`}</span>
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
            <span style={{fontSize:13,fontWeight:600}}>contacto{selected.size!==1?'s':''} seleccionado{selected.size!==1?'s':''}</span>
          </div>
          <button className="btn ghost sm" onClick={exportContactosXLSX}><Icon name="download" size={13}/>Exportar Excel</button>
          {window.canUser?.('eliminar','contacts') !== false && <button className="btn ghost sm" onClick={bulkDelete} style={{color:'var(--danger)'}}><Icon name="trash" size={13}/>Eliminar</button>}
          <button className="icon-btn" onClick={()=>setSelected(new Set())} style={{marginLeft:4}}><Icon name="x" size={15}/></button>
        </div>
      )}

      {sel && <ContactDetail contacto={sel} onClose={()=>{setSel(null); refresh();}}/>}
      {showNew && <NewContactModal onClose={()=>{setShowNew(false); refresh();}} onSaved={refresh}/>}
    </div>
  );
};

function ContactDetail({ contacto, onClose }) {
  const [editing, setEditing] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const cli = SSData.clientes.find(c => c.id === contacto.cliente_id);
  const tc = SSData.tiposCliente.find(t => t.id === cli?.tipo);
  const lp = SSData.listasPrecios.find(l => l.id === cli?.listaPrecio);

  function startOrder() {
    window.__ssPosPreselect = { clienteId: contacto.id };
    onClose();
    if (window.__ssNavigate) window.__ssNavigate('pos');
  }

  if (editing) return <NewContactModal contacto={contacto} onClose={onClose} onSaved={onClose}/>;

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width: 600}}>
        <div className="modal-header">
          <div style={{width:44, height:44, borderRadius:10, background:'var(--brand-soft)', color:'var(--brand)', display:'grid', placeItems:'center', fontWeight:700, fontSize:16}}>
            {contacto.nombre.slice(0,2).toUpperCase()}
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">{contacto.nombre}</h3>
            <div className="small">{contacto.cargo} · {cli?.nombre}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          <div className="grid-2">
            <div className="card" style={{padding:14}}>
              <div className="small mb-2" style={{fontWeight:600, color:'var(--text-muted)'}}>DATOS DE CONTACTO</div>
              <div className="flex items-center gap-2 mt-2">
                <Icon name="phone" size={14} className="muted"/>
                <span style={{fontSize:13}}>{contacto.telefono || '—'}</span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Icon name="send" size={14} className="muted"/>
                <span style={{fontSize:13}}>{contacto.email || '—'}</span>
              </div>
            </div>
            <div className="card" style={{padding:14}}>
              <div className="small mb-2" style={{fontWeight:600, color:'var(--text-muted)'}}>CLIENTE ASOCIADO</div>
              <div style={{fontWeight:600, fontSize:14}}>{cli?.nombre}</div>
              <div className="small mono mt-1">{cli?.rif}</div>
              {tc && <span className="chip mt-2" style={{background: tc.color+'20', color: tc.color}}><span className="chip-dot"/>{tc.nombre}</span>}
              {lp && <div className="small mt-2">Lista: {lp.nombre} · −{lp.valor}%</div>}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
          <button className="btn ghost" onClick={()=>setShowActivity(true)} title="Ver actividad de este contacto"><Icon name="clock" size={14}/>Actividad</button>
          {window.canUser?.('editar','contacts') !== false && (
          <button className="btn secondary" onClick={()=>setEditing(true)}><Icon name="edit" size={14}/>Editar</button>
          )}
          <button className="btn primary" onClick={startOrder}><Icon name="pos" size={14}/>Nueva orden</button>
        </div>
      </div>
      {showActivity && <ActivityLogModal modulo="contactos" entidadId={contacto.id} entidadLabel={contacto.nombre} onClose={() => setShowActivity(false)}/>}
    </div>
  );
}

function NewContactModal({ onClose, contacto, fixedClienteId, onSaved }) {
  const isEdit = !!contacto;
  const [form, setForm] = useState({
    nombre:    contacto?.nombre    || '',
    cargo:     contacto?.cargo     || '',
    telefono:  contacto?.telefono  || '+58 ',
    email:     contacto?.email     || '',
    cliente_id: contacto?.cliente_id || fixedClienteId || '',
  });
  const [portal, setPortal]       = useState(!!contacto?.usuario_id);
  const [password, setPassword]   = useState('');
  const [pin, setPin]             = useState('');
  const [saving, setSaving]       = useState(false);
  const [errMsg, setErrMsg]       = useState('');
  const hasPortalAlready = !!contacto?.usuario_id;

  function upd(k,v) { setForm(f => ({...f, [k]: v})); }

  const camposConfig = window.getCamposConfig?.('contactos') ?? {};
  const isReqC  = id => camposConfig[id] === 'obligatorio';
  const isHideC = id => camposConfig[id] === 'oculto';
  const reqLblC = id => isReqC(id) ? <span style={{color:'var(--danger)'}}>*</span> : null;
  const reqBorderC = (id, val) => isReqC(id) && !val ? {borderColor:'var(--danger)'} : {};

  async function save() {
    if (!form.nombre || !form.cliente_id) return;
    const telV   = (form.telefono || '').trim();
    const emailV = (form.email || '').trim();
    // Teléfono obligatorio al crear un contacto nuevo (en edición no se fuerza, para no bloquear
    // contactos legacy que quedaron sin teléfono tras la deduplicación).
    if (!isEdit && (!telV || telV === '+58')) { setErrMsg('El teléfono del contacto es obligatorio.'); return; }
    if (isReqC('telefono_cont') && (!telV || telV === '+58')) { setErrMsg('Teléfono es obligatorio.'); return; }
    if (isReqC('email_cont') && !emailV) { setErrMsg('Email es obligatorio.'); return; }
    // Unicidad por empresa: teléfono y email de contactos no pueden repetirse en el sistema.
    const dupTel = findDupContactoTelefono(telV, contacto?.id);
    if (dupTel) { setErrMsg(`Ese teléfono ya está registrado en el contacto: ${dupTel.nombre}.`); return; }
    const dupEmail = findDupContactoEmail(emailV, contacto?.id);
    if (dupEmail) { setErrMsg(`Ese email ya está registrado en el contacto: ${dupEmail.nombre}.`); return; }
    setErrMsg('');

    // Validate portal access fields
    const enablingPortal = portal && !hasPortalAlready;
    if (enablingPortal) {
      if (!form.email.trim())        { setErrMsg('Email obligatorio para acceso al portal.'); return; }
      if (!password || password.length < 8) { setErrMsg('Contraseña mínima de 8 caracteres.'); return; }
      if (pin && !/^\d{4}$/.test(pin)) { setErrMsg('El PIN debe tener exactamente 4 dígitos.'); return; }
    }

    setSaving(true);
    let usuario_id = contacto?.usuario_id || null;

    // Create the linked usuario if enabling portal access
    if (enablingPortal) {
      const initials = form.nombre.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
      const result = await window.authCreateUser({
        email:    form.email.trim(),
        password,
        nombre:   form.nombre.trim(),
        rol:      'Cliente',
        iniciales: initials,
        avatar:   '#a855f7',
      });
      if (result.error) {
        setSaving(false);
        const m = result.error.message || '';
        setErrMsg(m.includes('already') ? 'Este correo ya está registrado.' : (m || 'No se pudo crear el acceso.'));
        return;
      }
      usuario_id = result.userId;
      // Link the usuario to the cliente so the portal knows which cliente to load (server-side)
      await window.callAdminUsers('update', { id: usuario_id, fields: { cliente_id: form.cliente_id } });
      if (pin) {
        await window.setUserPin(usuario_id, pin);
      }
    } else if (hasPortalAlready && pin && /^\d{4}$/.test(pin)) {
      // Update PIN if provided on existing portal user
      await window.setUserPin(contacto.usuario_id, pin);
    }

    const nombreUP = (form.nombre || '').toUpperCase().replace(/\s+/g, ' ').trim();
    if (isEdit) {
      const { error } = await window.sb.from('contactos').update({
        nombre: nombreUP, cargo: form.cargo, telefono: form.telefono,
        email: form.email, cliente_id: form.cliente_id, usuario_id,
      }).eq('id', contacto.id);
      if (error) { setSaving(false); setErrMsg('Error al guardar: '+error.message); return; }
      window.logActivity?.({ modulo:'contacts', accion:'editar', entidad_id: contacto.id, entidad_label: nombreUP, detalles:{ cliente: (SSData.clientes.find(c=>c.id===form.cliente_id)?.nombre) || form.cliente_id } });
      window.SSData.contactos = (window.SSData.contactos || []).map(c =>
        c.id === contacto.id ? { ...c, ...form, nombre: nombreUP, usuario_id } : c
      );
    } else {
      const id = 'CT-' + Date.now();
      const { error } = await window.sb.from('contactos').insert({
        id, cliente_id: form.cliente_id, nombre: nombreUP,
        cargo: form.cargo, telefono: form.telefono, email: form.email,
        activo: true, usuario_id, empresa_id: window.currentEmpresa,
        creado_por: window.__ssCurrentUser?.nombre || null,
      });
      if (error) { setSaving(false); setErrMsg('Error al crear: '+error.message); return; }
      window.logActivity?.({ modulo:'contacts', accion:'crear', entidad_id: id, entidad_label: nombreUP, detalles:{ cliente: (SSData.clientes.find(c=>c.id===form.cliente_id)?.nombre) || form.cliente_id } });
      window.SSData.contactos = [...(window.SSData.contactos || []), { id, ...form, nombre: nombreUP, activo: true, usuario_id }];
    }

    setSaving(false);
    if (onSaved) onSaved();
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width: 560}}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}>
            <Icon name="contact" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">{isEdit ? 'Editar contacto' : 'Nuevo contacto'}</h3>
            <div className="small">{isEdit ? 'Modifica los datos del contacto' : 'Asocia el contacto a un cliente existente'}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          <div className="grid-2">
            <div>
              <label className="form-label">Nombre {reqLblC('nombre_cont') || <span style={{color:'var(--danger)'}}>*</span>}</label>
              <input className="input" placeholder="ING. CARLOS PÉREZ" value={form.nombre} onChange={e=>upd('nombre',e.target.value)} style={{...reqBorderC('nombre_cont', form.nombre), textTransform:'uppercase'}}/>
            </div>
            {!isHideC('cargo') && <div>
              <label className="form-label">Cargo {reqLblC('cargo')}</label>
              <input className="input" placeholder="Gerente de Compras" value={form.cargo} onChange={e=>upd('cargo',e.target.value)} style={reqBorderC('cargo', form.cargo)}/>
            </div>}
          </div>
          {!fixedClienteId && (
            <div className="mt-3">
              <label className="form-label">Cliente <span style={{color:'var(--danger)'}}>*</span></label>
              <select className="select" style={{width:'100%'}} value={form.cliente_id} onChange={e=>upd('cliente_id',e.target.value)}>
                <option value="">Seleccionar cliente...</option>
                {SSData.clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
          )}
          <div className="grid-2 mt-3">
            {!isHideC('telefono_cont') && <div>
              <label className="form-label">Teléfono {reqLblC('telefono_cont')}</label>
              <input className="input" placeholder="+58 414-1234567" value={form.telefono} onChange={e=>upd('telefono',e.target.value)} style={reqBorderC('telefono_cont', form.telefono)}/>
            </div>}
            {!isHideC('email_cont') && <div>
              <label className="form-label">Email {portal ? <span style={{color:'var(--danger)'}}>*</span> : reqLblC('email_cont')}</label>
              <input className="input" placeholder="carlos@empresa.ve" value={form.email} onChange={e=>upd('email',e.target.value)} disabled={hasPortalAlready} style={reqBorderC('email_cont', form.email)}/>
            </div>}
          </div>

          {/* Portal access */}
          <div className="card mt-4" style={{padding:14, background:'var(--bg-sunken)'}}>
            <label style={{display:'flex', alignItems:'center', gap:10, cursor: hasPortalAlready ? 'default' : 'pointer'}}>
              <input type="checkbox" checked={portal} disabled={hasPortalAlready}
                onChange={e => setPortal(e.target.checked)}/>
              <div>
                <div style={{fontSize:13, fontWeight:600}}>Habilitar acceso al portal de cliente</div>
                <div className="small muted" style={{marginTop:2}}>
                  {hasPortalAlready
                    ? 'Este contacto ya tiene acceso al portal. Puedes actualizar el PIN abajo.'
                    : 'Crea un usuario con rol "Cliente" para que pueda iniciar sesión.'}
                </div>
              </div>
            </label>
            {(portal && !hasPortalAlready) && (
              <div className="grid-2 mt-3">
                <div>
                  <label className="form-label">Contraseña <span style={{color:'var(--danger)'}}>*</span></label>
                  <input className="input" type="password" placeholder="Mínimo 8 caracteres" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="new-password"/>
                </div>
                <div>
                  <label className="form-label">PIN (opcional)</label>
                  <input className="input mono" maxLength={4} placeholder="4 dígitos" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,''))}/>
                </div>
              </div>
            )}
            {hasPortalAlready && (
              <div className="mt-3">
                <label className="form-label">Actualizar PIN (opcional)</label>
                <input className="input mono" maxLength={4} placeholder="4 dígitos" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,''))} style={{maxWidth:180}}/>
              </div>
            )}
          </div>

          {errMsg && <div style={{ marginTop:12, padding:'8px 12px', background:'#fee2e2', color:'#b91c1c', borderRadius:8, fontSize:13 }}>{errMsg}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" disabled={saving || !form.nombre || !form.cliente_id} onClick={save}>
            <Icon name="check" size={14}/>{saving ? 'Guardando…' : (isEdit ? 'Guardar' : 'Crear contacto')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal unificado: Movimiento bancario manual + Ajuste de saldo + Traspaso ──
// Un solo modal con tres modos ("Movimiento" | "Ajuste" | "Traspaso"). Antes eran
// tres botones/modales separados (MovimientoManualModal + AjusteCuentaModal +
// TraspasoModal); se fusionaron en el botón único "Movimiento" del detalle de banco.
function MovimientoManualModal({ cuenta, cuentas, onClose, onDone }) {
  const [mode, setMode] = useState('movimiento');   // 'movimiento' | 'ajuste' | 'traspaso'
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fmtMon = v => cuenta.moneda === 'USD' ? fmt.usd(v) : fmt.bs(v);
  const saldoActual = parseFloat(cuenta.saldo) || 0;

  // ── Modo "Movimiento" (comisión, interés, gasto/ingreso) ──
  const [fecha, setFecha] = useState(window.localDateStr());
  const [tipo, setTipo] = useState('egreso');
  const [monto, setMonto] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [catMov, setCatMov] = useState('');
  // Mismo catálogo que las cuentas por pagar: el rubro de un egreso es el rubro de un gasto,
  // no hace falta una lista aparte que después haya que mantener en dos lados.
  const catsEgreso = (SSData.categoriasCuenta || [])
    .filter(c => c.tipo === 'pagar').map(c => c.nombre).sort((a, b) => a.localeCompare(b, 'es'));
  // Conceptos frecuentes — al tocarlos rellenan la descripción.
  const PRESETS = ['Comisión bancaria', 'Comisión Pago Móvil', 'IGTF / impuesto al débito', 'Mantenimiento de cuenta', 'Intereses ganados', 'Nota de débito', 'Nota de crédito'];

  // ── Modo "Ajuste de saldo" (saldo objetivo | por monto) ──
  const [ajTab, setAjTab] = useState('objetivo');   // 'objetivo' | 'monto'
  const [saldoObjetivo, setSaldoObjetivo] = useState(String(cuenta.saldo != null ? cuenta.saldo : 0));
  const [ajTipo, setAjTipo] = useState('ingreso');
  const [ajMonto, setAjMonto] = useState('');
  const [motivo, setMotivo] = useState('');

  // ── Modo "Traspaso" (entre cuentas; compra de divisas si cambia la moneda) ──
  // Incluye las cuentas de las OTRAS empresas del usuario (la RLS recorta): un traspaso entre
  // empresas es plata que se mueve igual, y cada movimiento queda en los libros de su empresa.
  const [cuentasTodas, setCuentasTodas] = useState(null);
  useEffect(() => {
    let alive = true;
    window.loadCuentasBancariasTodas?.().then(r => { if (alive && r?.data?.length) setCuentasTodas(r.data); });
    return () => { alive = false; };
  }, []);
  const cs = ((cuentasTodas && cuentasTodas.length ? cuentasTodas : (cuentas || [])) || []).filter(c => c && c.id);
  const _empAct = window.currentEmpresa || 'demo1';
  // Por defecto el destino solo lista cuentas de la MISMA empresa que el origen (esta cuenta); se
  // cruza a la otra empresa con el check explícito, y ahí el destino pasa a listar solo esa otra.
  const [cruzada, setCruzada] = useState(false);
  const csMisma = cs.filter(c => (c.empresa_id || _empAct) === _empAct);
  const otraEmpId = [...new Set(cs.map(c => c.empresa_id || _empAct))].find(id => id !== _empAct) || '';
  const csOtra = cs.filter(c => (c.empresa_id || _empAct) === otraEmpId);
  const [origen, setOrigen] = useState(cuenta.id);
  const [destino, setDestino] = useState(() => { const f = csMisma.find(c => c.id !== cuenta.id); return f ? f.id : ''; });
  const [montoOrigen, setMontoOrigen] = useState('');
  const [tasa, setTasa] = useState(String((SSData?.tasa?.bcv) != null ? SSData.tasa.bcv : ''));
  const [descTraspaso, setDescTraspaso] = useState('');
  const [esAnticipo, setEsAnticipo] = useState(false);
  const [clienteAnt, setClienteAnt] = useState('');
  const [antResults, setAntResults] = useState([]);
  // Anticipo de la empresa de ORIGEN a debitar (ver SaldoOrigenPicker). '' = no descontar nada.
  const [pagoOrigen, setPagoOrigen] = useState('');

  const absMov = Math.abs(parseFloat(monto) || 0);
  const deltaMov = Math.round(((tipo === 'egreso' ? -1 : 1) * absMov) * 100) / 100;
  const deltaAj = Math.round(((ajTab === 'objetivo'
    ? (parseFloat(saldoObjetivo) || 0) - saldoActual
    : (ajTipo === 'egreso' ? -1 : 1) * Math.abs(parseFloat(ajMonto) || 0))) * 100) / 100;
  const delta = mode === 'ajuste' ? deltaAj : deltaMov;
  const nuevoSaldo = Math.round((saldoActual + delta) * 100) / 100;

  const csDestino = cruzada ? csOtra : csMisma.filter(c => c.id !== origen);
  useEffect(() => {
    if (!csDestino.some(c => c.id === destino)) setDestino(csDestino[0]?.id || '');
    if (!cruzada) { setEsAnticipo(false); setClienteAnt(''); setPagoOrigen(''); }
  }, [cruzada, cuentasTodas]);
  // El anticipo elegido pertenece a UN cliente: al cambiar de cliente deja de tener sentido.
  useEffect(() => { setPagoOrigen(''); }, [clienteAnt]);

  // Traspaso: cálculo de lo que entra al destino (con conversión de moneda).
  const o = cs.find(c => c.id === origen);
  const d = cs.find(c => c.id === destino);
  const distintaMoneda = !!(o && d && o.moneda !== d.moneda);
  const mo = Math.abs(parseFloat(montoOrigen) || 0);
  const t = parseFloat(tasa) || 0;
  let md = 0;
  if (o && d) {
    if (!distintaMoneda) md = mo;
    else if (o.moneda==='VES' && d.moneda==='USD') md = t ? mo / t : 0;
    else if (o.moneda==='USD' && d.moneda==='VES') md = mo * t;
    else md = mo;
  }
  md = Math.round(md * 100) / 100;
  const fmtM = (c,v) => c && c.moneda==='USD' ? fmt.usd(v) : fmt.bs(v);
  const clienteAntNombre = antResults.find(x => x.value === clienteAnt)?.label || '';
  // Valor en USD del traspaso — MISMO criterio que `crearTraspasoBancario`: el lado que está en
  // dólares si hay cambio de moneda; si las dos cuentas son en Bs., se estima al BCV.
  const usdTraspaso = (() => {
    if (!o || !d) return 0;
    if (o.moneda === 'USD') return mo;
    if (d.moneda === 'USD') return md;
    const bcv = SSData.tasa?.bcv || 0;
    return bcv ? Math.round((mo / bcv) * 100) / 100 : 0;
  })();
  const opt = c => `${c.banco} · ${c.moneda}`;
  const entreEmpresas = !!(o && d && (o.empresa_id || _empAct) !== (d.empresa_id || _empAct));

  const canSubmit = mode === 'movimiento' ? !!absMov
    : mode === 'ajuste' ? !!delta
    : !!(o && d && mo && origen!==destino && !(distintaMoneda && t<=0) && !(esAnticipo && !clienteAnt));

  const changeMode = m => { setMode(m); setError(''); };

  async function submit() {
    setError('');
    if (mode === 'traspaso') {
      if (!o || !d) { setError('Selecciona origen y destino.'); return; }
      if (origen===destino) { setError('El origen y el destino deben ser distintos.'); return; }
      if (!mo) { setError('Ingresa el monto a traspasar.'); return; }
      if (distintaMoneda && t<=0) { setError('Ingresa la tasa (Bs/USD).'); return; }
    }
    setSaving(true);
    let r;
    if (mode === 'movimiento') r = await window.crearMovimientoBancario({ cuentaId: cuenta.id, fecha, tipo, monto, descripcion, categoria: catMov });
    else if (mode === 'ajuste') r = await window.crearAjusteBancario({ cuentaId: cuenta.id, modo: ajTab, saldoObjetivo, monto: ajMonto, tipo: ajTipo, motivo });
    else r = await window.crearTraspasoBancario({ origenId: origen, destinoId: destino, montoOrigen: mo, tasa: t, descripcion: descTraspaso, cuentas: cs,
      anticipoCliente: esAnticipo && clienteAnt ? { clienteId: clienteAnt, clienteNombre: clienteAntNombre, notas: descTraspaso } : null,
      anticipoOrigen: esAnticipo && pagoOrigen ? { pagoId: pagoOrigen, montoUsd: usdTraspaso } : null });
    setSaving(false);
    if (r?.error) { setError(r.error.message || 'Error al guardar'); return; }
    onDone?.();
  }
  const titulo = mode==='movimiento' ? 'Registrar movimiento' : mode==='ajuste' ? 'Ajustar saldo' : 'Traspaso entre cuentas';
  const btnLabel = saving ? (mode==='traspaso' ? 'Procesando…' : 'Guardando…')
    : mode==='movimiento' ? 'Registrar movimiento' : mode==='ajuste' ? 'Aplicar ajuste' : 'Confirmar traspaso';
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{maxWidth:480}} onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{margin:0}}>{titulo}{mode!=='traspaso' ? ` · ${cuenta.banco}` : ''}</h3>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div style={{padding:'16px 20px', display:'flex', flexDirection:'column', gap:14}}>
          <div className="seg">
            <button className={mode==='movimiento'?'on':''} onClick={()=>changeMode('movimiento')}>Movimiento</button>
            <button className={mode==='ajuste'?'on':''} onClick={()=>changeMode('ajuste')}>Ajuste</button>
            <button className={mode==='traspaso'?'on':''} onClick={()=>changeMode('traspaso')}>Traspaso</button>
          </div>
          {mode!=='traspaso' && <div className="small muted">Saldo actual: <strong>{fmtMon(saldoActual)}</strong> · {cuenta.moneda}</div>}

          {mode==='movimiento' && (
            <React.Fragment>
              <div className="seg">
                <button className={tipo==='egreso'?'on':''} onClick={()=>setTipo('egreso')}>Egreso (−)</button>
                <button className={tipo==='ingreso'?'on':''} onClick={()=>setTipo('ingreso')}>Ingreso (+)</button>
              </div>
              <div style={{display:'flex', gap:8}}>
                <div style={{flex:1}}>
                  <label className="small muted" style={{display:'block',marginBottom:4}}>Fecha</label>
                  <input className="input" type="date" value={fecha} onChange={e=>setFecha(e.target.value)}/>
                </div>
                <div style={{flex:1}}>
                  <label className="small muted" style={{display:'block',marginBottom:4}}>Monto ({cuenta.moneda})</label>
                  <input className="input" type="number" step="0.01" placeholder="0.00" value={monto} onChange={e=>setMonto(e.target.value)} autoFocus/>
                </div>
              </div>
              <div>
                <label className="small muted" style={{display:'block',marginBottom:4}}>Concepto / descripción</label>
                <input className="input" value={descripcion} onChange={e=>setDescripcion(e.target.value)} placeholder="Ej. comisión bancaria, IGTF, intereses…"/>
                <div style={{display:'flex', flexWrap:'wrap', gap:6, marginTop:8}}>
                  {PRESETS.map(p => (
                    <button key={p} type="button" className="btn ghost sm" style={{fontSize:11, padding:'3px 8px'}} onClick={()=>setDescripcion(p)}>{p}</button>
                  ))}
                </div>
              </div>
              {/* El rubro solo aplica al egreso: es lo que agrupa el desglose "En qué se gastó"
                  de Reportes de Finanzas. Un egreso cargado a mano sin rubro cae en "Sin rubro",
                  que es el renglón que hay que vaciar — por eso se pide acá y no después. Mismo
                  catálogo que usan las cuentas por pagar (`categorias_cuenta` tipo 'pagar'). */}
              {tipo === 'egreso' && (
                <div>
                  <label className="small muted" style={{display:'block',marginBottom:4}}>Rubro del gasto</label>
                  <select className="select" value={catMov} onChange={e=>setCatMov(e.target.value)}>
                    <option value="">— Sin rubro —</option>
                    {catsEgreso.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <div className="small muted" style={{marginTop:4, fontSize:11}}>
                    Con qué renglón aparece en “En qué se gastó”. Se puede dejar vacío, pero entonces
                    el reporte no puede decir en qué se fue la plata.
                  </div>
                </div>
              )}
            </React.Fragment>
          )}

          {mode==='ajuste' && (
            <React.Fragment>
              <div className="seg">
                <button className={ajTab==='objetivo'?'on':''} onClick={()=>setAjTab('objetivo')}>Saldo objetivo</button>
                <button className={ajTab==='monto'?'on':''} onClick={()=>setAjTab('monto')}>Por monto</button>
              </div>
              {ajTab==='objetivo' ? (
                <div>
                  <label className="small muted" style={{display:'block',marginBottom:4}}>Saldo real (objetivo)</label>
                  <input className="input" type="number" step="0.01" value={saldoObjetivo} onChange={e=>setSaldoObjetivo(e.target.value)} autoFocus/>
                </div>
              ) : (
                <div style={{display:'flex', gap:8}}>
                  <select className="select" value={ajTipo} onChange={e=>setAjTipo(e.target.value)} style={{flex:'0 0 130px'}}>
                    <option value="ingreso">Ingreso (+)</option>
                    <option value="egreso">Egreso (−)</option>
                  </select>
                  <input className="input" type="number" step="0.01" placeholder="Monto" value={ajMonto} onChange={e=>setAjMonto(e.target.value)} style={{flex:1}} autoFocus/>
                </div>
              )}
              <div>
                <label className="small muted" style={{display:'block',marginBottom:4}}>Motivo</label>
                <input className="input" value={motivo} onChange={e=>setMotivo(e.target.value)} placeholder="Ej. corrección por comisión bancaria"/>
              </div>
            </React.Fragment>
          )}

          {mode==='traspaso' && (
            <React.Fragment>
              <div>
                <label className="small muted" style={{display:'block',marginBottom:4}}>Desde (origen · {_empAct})</label>
                <select className="select" value={origen} onChange={e=>setOrigen(e.target.value)} style={{width:'100%'}}>
                  {csMisma.map(c => <option key={c.id} value={c.id}>{opt(c)}</option>)}
                </select>
                {o && <div className="small muted" style={{marginTop:3}}>Saldo: {fmtM(o, parseFloat(o.saldo)||0)}</div>}
              </div>
              {otraEmpId && (
                <label style={{display:'flex', alignItems:'center', gap:7, fontSize:12.5, cursor:'pointer'}}>
                  <input type="checkbox" checked={cruzada} onChange={e=>setCruzada(e.target.checked)}/>
                  Traspaso a empresa {otraEmpId}
                </label>
              )}
              <div>
                <label className="small muted" style={{display:'block',marginBottom:4}}>
                  Hacia (destino · {cruzada ? otraEmpId : _empAct})
                </label>
                <select className="select" value={destino} onChange={e=>setDestino(e.target.value)} style={{width:'100%'}}>
                  <option value="">— Selecciona —</option>
                  {csDestino.map(c => <option key={c.id} value={c.id}>{opt(c)}</option>)}
                </select>
                {d && <div className="small muted" style={{marginTop:3}}>Saldo: {fmtM(d, parseFloat(d.saldo)||0)}</div>}
              </div>
              <div>
                <label className="small muted" style={{display:'block',marginBottom:4}}>Monto que sale del origen{o ? ' ('+o.moneda+')' : ''}</label>
                <input className="input" type="number" step="0.01" value={montoOrigen} onChange={e=>setMontoOrigen(e.target.value)} placeholder="0.00" autoFocus/>
              </div>
              {distintaMoneda && (
                <div>
                  <label className="small muted" style={{display:'block',marginBottom:4}}>Tasa (Bs por USD) — compra de divisas</label>
                  <input className="input" type="number" step="0.01" value={tasa} onChange={e=>setTasa(e.target.value)} placeholder="Bs/USD"/>
                </div>
              )}
              <div>
                <label className="small muted" style={{display:'block',marginBottom:4}}>Descripción (opcional)</label>
                <input className="input" value={descTraspaso} onChange={e=>setDescTraspaso(e.target.value)} placeholder="Ej. compra de divisas, movilización de fondos"/>
              </div>
              {entreEmpresas && (
                <div style={{background:'var(--brand-soft)', border:'1px solid var(--brand)', borderRadius:8, padding:'10px 12px', fontSize:12.5, display:'flex', gap:8, alignItems:'flex-start'}}>
                  <Icon name="alert" size={14} style={{color:'var(--brand)', flexShrink:0, marginTop:1}}/>
                  <div>
                    <strong>Traspaso entre empresas.</strong> El egreso queda en {o.empresa_id || _empAct} y el ingreso
                    en {d.empresa_id || _empAct}: cada movimiento en los libros de su empresa. No genera cuenta por
                    cobrar ni por pagar entre ellas.
                  </div>
                </div>
              )}
              {entreEmpresas && (
                <div style={{borderTop:'1px dashed var(--border)', paddingTop:12}}>
                  <label style={{display:'flex', alignItems:'center', gap:7, fontSize:12.5, cursor:'pointer'}}>
                    <input type="checkbox" checked={esAnticipo} onChange={e=>{ setEsAnticipo(e.target.checked); if (!e.target.checked) setClienteAnt(''); }}/>
                    Pertenece a un anticipo de cliente
                  </label>
                  {esAnticipo && (
                    <div style={{marginTop:8}}>
                      <label className="small muted" style={{display:'block',marginBottom:4}}>
                        Cliente en {d.empresa_id || otraEmpId} al que se acredita
                      </label>
                      <SearchSelect value={clienteAnt} onChange={setClienteAnt} options={antResults}
                                    onSearchRemote={q => window.buscarClientesContactos(q, { soloClientes: true, empresaId: d.empresa_id || otraEmpId }).then(opts => { setAntResults(opts); return opts; })}
                                    placeholder="Buscar cliente por nombre o RIF..." />
                      <div className="small muted" style={{marginTop:5, fontSize:11.5}}>
                        El monto que entra al destino queda como saldo a favor de este cliente en {d.empresa_id || otraEmpId} (módulo Anticipos).
                      </div>
                      <SaldoOrigenPicker clienteId={clienteAnt} empresaOrigen={o.empresa_id || _empAct}
                                         montoUsd={usdTraspaso} value={pagoOrigen} onChange={setPagoOrigen}/>
                    </div>
                  )}
                </div>
              )}
            </React.Fragment>
          )}

          {mode!=='traspaso' ? (
            <div style={{background:'var(--bg-sunken)', borderRadius:8, padding:'10px 12px', fontSize:13}}>
              {mode==='movimiento' ? 'Movimiento' : 'Ajuste'}: <strong style={{color: delta>=0?'var(--success)':'var(--danger)'}}>{delta>=0?'+':''}{fmtMon(delta)}</strong>
              <span className="muted"> · Nuevo saldo: </span><strong>{fmtMon(nuevoSaldo)}</strong>
            </div>
          ) : (
            <div style={{background:'var(--bg-sunken)', borderRadius:8, padding:'10px 12px', fontSize:13}}>
              {o && d ? <React.Fragment>
                Entra al destino: <strong>{fmtM(d, md)}</strong>
                {distintaMoneda && <span className="muted"> · a {t>0?t:'—'} Bs/USD</span>}
              </React.Fragment> : <span className="muted">Selecciona ambas cuentas</span>}
            </div>
          )}
          {error && <div style={{color:'var(--danger)', fontSize:13}}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={saving || !canSubmit} onClick={submit}><Icon name="check" size={14}/>{btnLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Traspaso entre cuentas (vista general de Bancos) ──────────────────
// En el DETALLE de un banco el traspaso vive como pestaña dentro de
// MovimientoManualModal; este modal standalone lo usa la vista general (sin
// cuenta origen fija) desde el botón "Traspaso" de la lista de bancos.
function TraspasoModal({ cuentas, origenId, onClose, onDone }) {
  // Traspaso ENTRE EMPRESAS: se cargan las cuentas de todas las empresas del usuario (la RLS recorta).
  // La plata se mueve de verdad entre dos bancos; que sean de empresas distintas no lo cambia, pero
  // cada movimiento tiene que quedar en los libros de SU empresa.
  const empActual = window.currentEmpresa || 'demo1';
  const [todas, setTodas] = useState(null);            // null = cargando
  const [empresas, setEmpresas] = useState(() => window.__ssEmpresasCache || []);
  useEffect(() => {
    let alive = true;
    window.loadCuentasBancariasTodas?.().then(r => { if (alive && r?.data) setTodas(r.data); });
    if (!empresas.length) {
      window.loadEmpresas?.().then(list => { if (alive) { window.__ssEmpresasCache = list || []; setEmpresas(list || []); } });
    }
    return () => { alive = false; };
  }, []);
  const nombreEmp = (id) => (empresas.find(e => e.id === id)?.nombre) || id;
  // Mientras llegan las de todas las empresas se usan las de la activa: el modal abre usable.
  const cs = ((todas && todas.length ? todas : (cuentas || [])) || []).filter(c => c && c.id);
  // Por defecto el traspaso es DENTRO de la misma empresa — origen y destino no se ven mezclados
  // con cuentas de la otra. Se cruza a otra empresa solo con el check explícito, y ahí el destino
  // pasa a listar SOLO las cuentas de esa otra empresa (no las de las dos revueltas).
  const [cruzada, setCruzada] = useState(false);
  const csMisma = cs.filter(c => (c.empresa_id || empActual) === empActual);
  const otraEmpId = [...new Set(cs.map(c => c.empresa_id || empActual))].find(id => id !== empActual) || '';
  const csOtra = cs.filter(c => (c.empresa_id || empActual) === otraEmpId);
  const initOrigen = origenId || (csMisma[0] && csMisma[0].id) || '';
  const [origen, setOrigen] = useState(initOrigen);
  const [destino, setDestino] = useState(() => { const f = csMisma.find(c => c.id !== initOrigen); return f ? f.id : ''; });
  const [montoOrigen, setMontoOrigen] = useState('');
  const [tasa, setTasa] = useState(String((SSData?.tasa?.bcv) != null ? SSData.tasa.bcv : ''));
  const [descripcion, setDescripcion] = useState('');
  const [esAnticipo, setEsAnticipo] = useState(false);
  const [clienteAnt, setClienteAnt] = useState('');
  const [antResults, setAntResults] = useState([]);
  const clienteAntNombre = antResults.find(o => o.value === clienteAnt)?.label || '';
  // Anticipo de la empresa de ORIGEN a debitar (ver SaldoOrigenPicker). '' = no descontar nada.
  const [pagoOrigen, setPagoOrigen] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const csDestino = cruzada ? csOtra : csMisma.filter(c => c.id !== origen);
  // Al alternar el check, el destino vigente puede quedar fuera de la nueva lista — se reacomoda solo.
  useEffect(() => {
    if (!csDestino.some(c => c.id === destino)) setDestino(csDestino[0]?.id || '');
    if (!cruzada) { setEsAnticipo(false); setClienteAnt(''); setPagoOrigen(''); }
  }, [cruzada, todas]);
  useEffect(() => { setPagoOrigen(''); }, [clienteAnt]);

  const o = cs.find(c => c.id === origen);
  const d = cs.find(c => c.id === destino);
  const distintaMoneda = !!(o && d && o.moneda !== d.moneda);
  const mo = Math.abs(parseFloat(montoOrigen) || 0);
  const t = parseFloat(tasa) || 0;
  let md = 0;
  if (o && d) {
    if (!distintaMoneda) md = mo;
    else if (o.moneda==='VES' && d.moneda==='USD') md = t ? mo / t : 0;
    else if (o.moneda==='USD' && d.moneda==='VES') md = mo * t;
    else md = mo;
  }
  md = Math.round(md * 100) / 100;
  const fmtM = (c,v) => c && c.moneda==='USD' ? fmt.usd(v) : fmt.bs(v);
  // Mismo criterio que `crearTraspasoBancario` para el valor en USD del traspaso.
  const usdTraspaso = (() => {
    if (!o || !d) return 0;
    if (o.moneda === 'USD') return mo;
    if (d.moneda === 'USD') return md;
    const bcv = SSData.tasa?.bcv || 0;
    return bcv ? Math.round((mo / bcv) * 100) / 100 : 0;
  })();
  async function submit() {
    if (!o || !d) { setError('Selecciona origen y destino.'); return; }
    if (origen===destino) { setError('El origen y el destino deben ser distintos.'); return; }
    if (!mo) { setError('Ingresa el monto a traspasar.'); return; }
    if (distintaMoneda && t<=0) { setError('Ingresa la tasa (Bs/USD).'); return; }
    if (esAnticipo && !clienteAnt) { setError('Elige a qué cliente se acredita el anticipo.'); return; }
    setSaving(true); setError('');
    const r = await window.crearTraspasoBancario({
      origenId: origen, destinoId: destino, montoOrigen: mo, tasa: t, descripcion, cuentas: cs,
      anticipoCliente: esAnticipo && clienteAnt ? { clienteId: clienteAnt, clienteNombre: clienteAntNombre, notas: descripcion } : null,
      anticipoOrigen: esAnticipo && pagoOrigen ? { pagoId: pagoOrigen, montoUsd: usdTraspaso } : null,
    });
    setSaving(false);
    if (r?.error) { setError(r.error.message || 'Error al guardar'); return; }
    onDone?.();
  }
  const opt = c => `${c.banco} · ${c.moneda}`;
  const entreEmpresas = !!(o && d && (o.empresa_id || empActual) !== (d.empresa_id || empActual));
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{maxWidth:480}} onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{margin:0}}>Traspaso entre cuentas</h3>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div style={{padding:'16px 20px', display:'flex', flexDirection:'column', gap:14}}>
          <div>
            <label className="small muted" style={{display:'block',marginBottom:4}}>Desde (origen · {nombreEmp(empActual)})</label>
            <select className="select" value={origen} onChange={e=>setOrigen(e.target.value)} style={{width:'100%'}}>
              {csMisma.map(c => <option key={c.id} value={c.id}>{opt(c)}</option>)}
            </select>
            {o && <div className="small muted" style={{marginTop:3}}>Saldo: {fmtM(o, parseFloat(o.saldo)||0)}</div>}
          </div>
          {otraEmpId && (
            <label style={{display:'flex', alignItems:'center', gap:7, fontSize:12.5, cursor:'pointer'}}>
              <input type="checkbox" checked={cruzada} onChange={e=>setCruzada(e.target.checked)}/>
              Traspaso a empresa {nombreEmp(otraEmpId)}
            </label>
          )}
          <div>
            <label className="small muted" style={{display:'block',marginBottom:4}}>
              Hacia (destino{cruzada ? ' · ' + nombreEmp(otraEmpId) : ' · ' + nombreEmp(empActual)})
            </label>
            <select className="select" value={destino} onChange={e=>setDestino(e.target.value)} style={{width:'100%'}}>
              <option value="">— Selecciona —</option>
              {csDestino.map(c => <option key={c.id} value={c.id}>{opt(c)}</option>)}
            </select>
            {d && <div className="small muted" style={{marginTop:3}}>Saldo: {fmtM(d, parseFloat(d.saldo)||0)}</div>}
          </div>
          <div>
            <label className="small muted" style={{display:'block',marginBottom:4}}>Monto que sale del origen{o ? ' ('+o.moneda+')' : ''}</label>
            <input className="input" type="number" step="0.01" value={montoOrigen} onChange={e=>setMontoOrigen(e.target.value)} placeholder="0.00" autoFocus/>
          </div>
          {distintaMoneda && (
            <div>
              <label className="small muted" style={{display:'block',marginBottom:4}}>Tasa (Bs por USD) — compra de divisas</label>
              <input className="input" type="number" step="0.01" value={tasa} onChange={e=>setTasa(e.target.value)} placeholder="Bs/USD"/>
            </div>
          )}
          <div>
            <label className="small muted" style={{display:'block',marginBottom:4}}>Descripción (opcional)</label>
            <input className="input" value={descripcion} onChange={e=>setDescripcion(e.target.value)} placeholder="Ej. compra de divisas, movilización de fondos"/>
          </div>
          <div style={{background:'var(--bg-sunken)', borderRadius:8, padding:'10px 12px', fontSize:13}}>
            {o && d ? <React.Fragment>
              Entra al destino: <strong>{fmtM(d, md)}</strong>
              {distintaMoneda && <span className="muted"> · a {t>0?t:'—'} Bs/USD</span>}
            </React.Fragment> : <span className="muted">Selecciona ambas cuentas</span>}
          </div>
          {entreEmpresas && (
            // Que quede a la vista: es plata que sale de los libros de una empresa y entra en los de
            // otra. El egreso queda en la empresa del origen y el ingreso en la del destino.
            <div style={{background:'var(--brand-soft)', border:'1px solid var(--brand)', borderRadius:8, padding:'10px 12px', fontSize:12.5, display:'flex', gap:8, alignItems:'flex-start'}}>
              <Icon name="alert" size={14} style={{color:'var(--brand)', flexShrink:0, marginTop:1}}/>
              <div>
                <strong>Traspaso entre empresas.</strong> El egreso queda en {nombreEmp(o.empresa_id || empActual)} y
                el ingreso en {nombreEmp(d.empresa_id || empActual)}: cada movimiento en los libros de su empresa.
                {' '}No genera cuenta por cobrar ni por pagar entre ellas — si hace falta registrar la deuda, se
                carga aparte.
              </div>
            </div>
          )}
          {entreEmpresas && (
            <div style={{borderTop:'1px dashed var(--border)', paddingTop:12}}>
              <label style={{display:'flex', alignItems:'center', gap:7, fontSize:12.5, cursor:'pointer'}}>
                <input type="checkbox" checked={esAnticipo} onChange={e=>{ setEsAnticipo(e.target.checked); if (!e.target.checked) setClienteAnt(''); }}/>
                Pertenece a un anticipo de cliente
              </label>
              {esAnticipo && (
                <div style={{marginTop:8}}>
                  <label className="small muted" style={{display:'block',marginBottom:4}}>
                    Cliente en {nombreEmp(d.empresa_id || otraEmpId)} al que se acredita
                  </label>
                  <SearchSelect value={clienteAnt} onChange={setClienteAnt} options={antResults}
                                onSearchRemote={q => window.buscarClientesContactos(q, { soloClientes: true, empresaId: d.empresa_id || otraEmpId }).then(opts => { setAntResults(opts); return opts; })}
                                placeholder="Buscar cliente por nombre o RIF..." />
                  <div className="small muted" style={{marginTop:5, fontSize:11.5}}>
                    El monto que entra al destino queda como saldo a favor de este cliente en {nombreEmp(d.empresa_id || otraEmpId)} (módulo Anticipos), además de moverse entre bancos.
                  </div>
                  <SaldoOrigenPicker clienteId={clienteAnt} empresaOrigen={o.empresa_id || empActual}
                                     montoUsd={usdTraspaso} value={pagoOrigen} onChange={setPagoOrigen}/>
                </div>
              )}
            </div>
          )}
          {todas === null && <div className="small muted" style={{display:'flex',alignItems:'center',gap:6}}><span className="ss-busy-spin"/>Cargando las cuentas de las otras empresas…</div>}
          {error && <div style={{color:'var(--danger)', fontSize:13}}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={saving || !mo || !d || origen===destino || (distintaMoneda && t<=0) || (esAnticipo && !clienteAnt)} onClick={submit}><Icon name="check" size={14}/>{saving?'Procesando…':'Confirmar traspaso'}</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ClientsPage: window.ClientsPage, ContactsPage: window.ContactsPage, SuppliersPage: window.SuppliersPage, CxCPage: window.CxCPage, CxPPage: window.CxPPage, BankPage: window.BankPage });

// ======= Contactos tab inside cliente modal =======
function ClienteContactosTab({ cliente, isEdit }) {
  const [v, setV]               = useState(0);
  const [addMode, setAddMode]   = useState(null); // null | 'choose' | 'new' | 'link'
  const [editing, setEditing]   = useState(null);
  const refresh = () => setV(x => x+1);

  if (!isEdit || !cliente) {
    return (
      <div className="card" style={{padding:20, textAlign:'center', background:'var(--bg-sunken)'}}>
        <Icon name="info" size={20} className="muted"/>
        <div style={{fontSize:14, marginTop:8, fontWeight:600}}>Guarda primero el cliente</div>
        <div className="small muted" style={{marginTop:4}}>
          Una vez creado el cliente podrás añadir múltiples contactos y habilitarles acceso al portal.
        </div>
      </div>
    );
  }

  const contactos = (SSData.contactos || []).filter(c => c.cliente_id === cliente.id);

  return (
    <>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12}}>
        <div>
          <div className="form-section-title" style={{margin:0}}>Contactos del cliente</div>
          <div className="small muted">{contactos.length} contacto{contactos.length!==1?'s':''} asociado{contactos.length!==1?'s':''}</div>
        </div>
        <button className="btn primary sm" onClick={()=>setAddMode('choose')}>
          <Icon name="plus" size={13}/>Añadir contacto
        </button>
      </div>

      {contactos.length === 0 ? (
        <div className="card" style={{padding:20, textAlign:'center', background:'var(--bg-sunken)'}}>
          <div className="small muted">Aún no hay contactos asociados a este cliente.</div>
        </div>
      ) : (
        <div className="card" style={{padding:0, overflow:'hidden'}}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Contacto</th>
                <th>Cargo</th>
                <th>Email</th>
                <th>Teléfono</th>
                <th>Portal</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {contactos.map(c => (
                <tr key={c.id} style={{cursor:'pointer'}} onClick={()=>setEditing(c)}>
                  <td>
                    <div style={{display:'flex', alignItems:'center', gap:10}}>
                      <div style={{width:30, height:30, borderRadius:8, background:'var(--brand-soft)', color:'var(--brand)', display:'grid', placeItems:'center', fontWeight:600, fontSize:11}}>
                        {c.nombre.slice(0,2).toUpperCase()}
                      </div>
                      <div style={{fontWeight:500, fontSize:13}}>{c.nombre}</div>
                    </div>
                  </td>
                  <td className="small muted">{c.cargo || '—'}</td>
                  <td className="small">{c.email || '—'}</td>
                  <td className="mono small">{c.telefono || '—'}</td>
                  <td>
                    {c.usuario_id
                      ? <span className="chip purple"><Icon name="check" size={10}/> Activado</span>
                      : <span className="chip neutral">Sin acceso</span>}
                  </td>
                  <td onClick={e=>e.stopPropagation()}>
                    <button className="btn ghost sm" onClick={()=>setEditing(c)}>
                      <Icon name="edit" size={12}/>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addMode === 'choose' && (
        <AddContactChooser
          onClose={()=>setAddMode(null)}
          onChoose={mode => setAddMode(mode)}
        />
      )}
      {addMode === 'new' && (
        <NewContactModal
          fixedClienteId={cliente.id}
          onClose={()=>setAddMode(null)}
          onSaved={refresh}
        />
      )}
      {addMode === 'link' && (
        <LinkExistingContactModal
          cliente={cliente}
          onClose={()=>setAddMode(null)}
          onLinked={refresh}
        />
      )}
      {editing && (
        <NewContactModal
          contacto={editing}
          fixedClienteId={cliente.id}
          onClose={()=>setEditing(null)}
          onSaved={refresh}
        />
      )}
    </>
  );
}

function AddContactChooser({ onClose, onChoose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width: 480}}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}>
            <Icon name="contact" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">Añadir contacto</h3>
            <div className="small">¿Crear uno nuevo o vincular uno existente?</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          <div style={{display:'grid', gap:10}}>
            <button className="card" onClick={()=>onChoose('new')}
              style={{padding:16, textAlign:'left', cursor:'pointer', border:'1px solid var(--border)', background:'var(--bg-elev)', display:'flex', alignItems:'center', gap:12}}>
              <div style={{width:36, height:36, borderRadius:10, background:'var(--brand-soft)', color:'var(--brand)', display:'grid', placeItems:'center', flexShrink:0}}>
                <Icon name="plus" size={18}/>
              </div>
              <div>
                <div style={{fontWeight:600, fontSize:14}}>Crear contacto nuevo</div>
                <div className="small muted">Registra una persona nueva y la vincula a este cliente.</div>
              </div>
            </button>
            <button className="card" onClick={()=>onChoose('link')}
              style={{padding:16, textAlign:'left', cursor:'pointer', border:'1px solid var(--border)', background:'var(--bg-elev)', display:'flex', alignItems:'center', gap:12}}>
              <div style={{width:36, height:36, borderRadius:10, background:'oklch(0.96 0.04 295)', color:'oklch(0.45 0.18 295)', display:'grid', placeItems:'center', flexShrink:0}}>
                <Icon name="link" size={18}/>
              </div>
              <div>
                <div style={{fontWeight:600, fontSize:14}}>Vincular contacto existente</div>
                <div className="small muted">Selecciona un contacto que aún no tenga cliente asignado.</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkExistingContactModal({ cliente, onClose, onLinked }) {
  const [search, setSearch] = useState('');
  const [linking, setLinking] = useState(null);
  const [err, setErr] = useState('');

  const candidates = (SSData.contactos || []).filter(c => !c.cliente_id);
  const filtered = candidates.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [c.nombre, c.cargo, c.email, c.telefono].filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  async function link(c) {
    setLinking(c.id); setErr('');
    const { error } = await window.sb.from('contactos').update({ cliente_id: cliente.id }).eq('id', c.id);
    if (error) { setErr('Error al vincular: '+error.message); setLinking(null); return; }
    window.logActivity?.({ modulo:'contacts', accion:'editar', entidad_id: c.id, entidad_label: c.nombre, detalles:{ vinculado_a: cliente.nombre } });
    window.SSData.contactos = (window.SSData.contactos || []).map(x =>
      x.id === c.id ? { ...x, cliente_id: cliente.id } : x
    );
    setLinking(null);
    if (onLinked) onLinked();
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width: 600, maxHeight:'80vh', display:'flex', flexDirection:'column'}}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'oklch(0.96 0.04 295)',color:'oklch(0.45 0.18 295)',display:'grid',placeItems:'center'}}>
            <Icon name="link" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">Vincular contacto existente</h3>
            <div className="small">{candidates.length} contacto{candidates.length!==1?'s':''} sin cliente asignado</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body" style={{flex:1, overflowY:'auto'}}>
          <input className="input" style={{width:'100%', marginBottom:12}}
            placeholder="Buscar por nombre, cargo o email..."
            value={search} onChange={e=>setSearch(e.target.value)}/>

          {filtered.length === 0 ? (
            <div className="card" style={{padding:24, textAlign:'center', background:'var(--bg-sunken)'}}>
              <div className="small muted">
                {candidates.length === 0
                  ? 'No hay contactos sin cliente. Todos los contactos existentes ya están afiliados.'
                  : 'Ningún contacto coincide con la búsqueda.'}
              </div>
            </div>
          ) : (
            <div style={{display:'grid', gap:6}}>
              {filtered.map(c => (
                <div key={c.id} className="card" style={{padding:10, display:'flex', alignItems:'center', gap:12}}>
                  <div style={{width:34, height:34, borderRadius:8, background:'var(--brand-soft)', color:'var(--brand)', display:'grid', placeItems:'center', fontWeight:600, fontSize:12, flexShrink:0}}>
                    {c.nombre.slice(0,2).toUpperCase()}
                  </div>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontWeight:500, fontSize:13}}>{c.nombre}</div>
                    <div className="small muted" style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                      {[c.cargo, c.email, c.telefono].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  <button className="btn primary sm" disabled={linking===c.id} onClick={()=>link(c)}>
                    {linking===c.id ? 'Vinculando…' : 'Vincular'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {err && <div style={{ marginTop:12, padding:'8px 12px', background:'#fee2e2', color:'#b91c1c', borderRadius:8, fontSize:13 }}>{err}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

// ======= Modal: Nuevo cliente =======
function NewClientModal({ onClose, cliente }) {
  const isEdit = !!cliente;
  const [tab, setTab] = useState('general');
  const [saving, setSaving] = useState(false);
  const [rifError, setRifError] = useState('');
  const [nombreError, setNombreError] = useState('');
  const [contactoTelError, setContactoTelError] = useState('');
  const [contactoEmailError, setContactoEmailError] = useState('');
  const [validationErrors, setValidationErrors] = useState([]);
  // El homónimo NO bloquea: se confirma. Guarda el cliente encontrado para mostrarlo.
  const [homonimo, setHomonimo] = useState(null);
  const [form, setForm] = useState({
    nombre:       cliente?.nombre      || '',
    rif:          cliente?.rif         || 'J-',
    contacto:     cliente?.contacto    || '',
    contacto_tel:   '',
    contacto_email: '',
    contacto_cargo: '',
    telefono:     cliente?.telefono    || '+58 ',
    email:        cliente?.email       || '',
    tipo:         cliente?.tipo        || SSData.tiposCliente[0]?.id || null,
    listaPrecio:  cliente?.listaPrecio || 'base',
    ciudad:       cliente?.ciudad      || 'Caracas',
    direccion:    cliente?.direccion   || '',
    estado:       cliente?.estado      || 'Distrito Capital',
    limiteCredito: cliente?.limiteCredito || 0,
    diasCredito:  cliente?.diasCredito || 0,
    notas:        cliente?.notas       || '',
    activar: true,
    // Condiciones comerciales por defecto
    // Editando, el formulario muestra EXACTAMENTE lo que hay en la base — aunque no haya nada.
    // Con `|| 'retiro'` el desplegable decía "Retiro en tienda" para 13.540 clientes que en la
    // base tienen NULL, y la ficha de al lado mostraba "—": el formulario contradecía al preview
    // y no había forma de saber cuál de los dos mentía. Al CREAR sí se propone el default del
    // negocio (el 99,6% de los documentos son retiro con pago inmediato).
    terminos_pago:  cliente ? (cliente.terminos_pago || '') : 'inmediato',
    tipo_entrega:   cliente ? (cliente.tipo_entrega  || '') : 'retiro',
    tipo_venta:     cliente ? (cliente.tipo_venta    || '') : 'regular',
    vendedor:       cliente?.vendedor       || '',
    fuente:         cliente?.fuente         || '',
    zona_delivery:  cliente?.zona_delivery  || '',
    dir_factura:    cliente?.dir_factura    || cliente?.direccion || '',
    dir_entrega:    cliente?.dir_entrega    || cliente?.direccion || '',
    observaciones:  cliente?.observaciones  || '',
    _sameAddress:   cliente
      ? ((!cliente.dir_factura || cliente.dir_factura === cliente.direccion) && (!cliente.dir_entrega || cliente.dir_entrega === cliente.direccion))
      : true,
  });
  function update(k, v) { setForm({...form, [k]: v}); setValidationErrors([]); }
  function onTipoChange(t) {
    setForm({...form, tipo: t}); setValidationErrors([]);
  }
  function checkRif(val) {
    setForm(f => ({...f, rif: val})); setValidationErrors([]);
    // En edición no marcar si el valor no cambió (tolera duplicados legacy sin bloquear la edición).
    if (isEdit && (val || '').trim().toLowerCase() === (cliente?.rif || '').trim().toLowerCase()) { setRifError(''); return; }
    const dup = findDupClienteRif(val, cliente?.id);
    setRifError(dup ? `Ya existe un cliente con este RIF: ${dup.nombre}` : '');
  }
  function checkNombre(val) {
    setForm(f => ({...f, nombre: val})); setValidationErrors([]);
    if (isEdit && ssNormNombre(val) === ssNormNombre(cliente?.nombre)) { setNombreError(''); return; }
    const dup = findDupClienteNombre(val, cliente?.id);
    setNombreError(dup ? `Ya existe "${dup.nombre}" (${dup.rif || 'sin RIF'}). Si es otra persona, podés continuar.` : '');
  }
  function checkContactoTel(val) {
    setForm(f => ({...f, contacto_tel: val})); setValidationErrors([]);
    const dup = findDupContactoTelefono(val, null);
    setContactoTelError(dup ? `Ese teléfono ya lo usa el contacto: ${dup.nombre}` : '');
  }
  function checkContactoEmail(val) {
    setForm(f => ({...f, contacto_email: val})); setValidationErrors([]);
    const dup = findDupContactoEmail(val, null);
    setContactoEmailError(dup ? `Ese email ya lo usa el contacto: ${dup.nombre}` : '');
  }
  async function handleSave({ confirmado = false } = {}) {
    const missing = [];
    const upperNorm = s => (s || '').toUpperCase().replace(/\s+/g, ' ').trim();
    // Persona/jurídica se deriva del prefijo del RIF (J/G/C = jurídica; V/E/P = natural).
    const rifPfx = (form.rif || '').trim().charAt(0).toUpperCase();
    const persona = ['J','G','C'].includes(rifPfx) ? 'juridica'
                  : ['V','E','P'].includes(rifPfx) ? 'natural'
                  : (form.persona || 'natural');
    const nombreUP = upperNorm(form.nombre);
    // ── Contacto principal OBLIGATORIO al ALTA: todo cliente nace con ≥1 contacto (nombre +
    // teléfono; email opcional). En edición los contactos se gestionan en la pestaña Contactos.
    const contactoNombre = isEdit
      ? (upperNorm(form.contacto) || null)
      : (upperNorm(form.contacto) || nombreUP);   // por defecto = razón social del cliente
    const contactoTel   = (form.contacto_tel   || '').trim();
    const contactoEmail = (form.contacto_email || '').trim();
    const contactoCargo = (form.contacto_cargo || '').trim();
    if (!form.nombre.trim()) missing.push('Razón social / Nombre');
    // Razón social exacta única (además del RIF). En edición solo se valida si el valor cambió,
    // para no bloquear la edición de clientes con nombres duplicados heredados (pendientes de unificar).
    const nombreChanged = !isEdit || ssNormNombre(form.nombre) !== ssNormNombre(cliente?.nombre);
    const rifChanged    = !isEdit || (form.rif || '').trim().toLowerCase() !== (cliente?.rif || '').trim().toLowerCase();
    // La razón social repetida YA NO BLOQUEA (pedido del usuario, 2026-08-18): dos personas
    // pueden llamarse igual — en la base hay cuatro "CARLOS RODRIGUEZ" con cédulas distintas.
    // Se avisa abajo, con el botón "Crear de igual forma". Lo que sí deniega es el RIF.
    // RIF único.
    const dupRif = rifChanged ? findDupClienteRif(form.rif, cliente?.id) : null;
    if (rifError) missing.push('RIF — ' + rifError);
    else if (dupRif) missing.push(`RIF duplicado — ya existe en el cliente: ${dupRif.nombre}`);
    // Contacto principal (solo al ALTA): nombre + teléfono obligatorios, teléfono/email únicos.
    if (!isEdit) {
      if (!contactoNombre) missing.push('Nombre del contacto principal');
      if (!contactoTel || contactoTel === '+58') missing.push('Teléfono del contacto principal (obligatorio)');
      const dupCTel = findDupContactoTelefono(contactoTel, null);
      if (dupCTel) missing.push(`Teléfono del contacto duplicado — ya lo usa: ${dupCTel.nombre}`);
      const dupCEmail = findDupContactoEmail(contactoEmail, null);
      if (dupCEmail) missing.push(`Email del contacto duplicado — ya lo usa: ${dupCEmail.nombre}`);
    }
    if (!form.tipo || !SSData.tiposCliente.find(t => t.id === form.tipo)) missing.push('Tipo de cliente');
    if (isReq('rif') && form.rif.length < 4) missing.push('RIF');
    if (isReq('lista_precios') && !form.listaPrecio) missing.push('Lista de precios');
    if (isReq('telefono') && (!form.telefono || form.telefono.trim() === '+58')) missing.push('Teléfono');
    if (isReq('email') && !form.email) missing.push('Email');
    if (isReq('dir_fiscal') && !form.direccion) missing.push('Dirección fiscal');
    if (isReq('estado') && !form.estado) missing.push('Estado');
    if (isReq('ciudad') && !form.ciudad) missing.push('Ciudad');
    if (isReq('limite_credito') && !form.limiteCredito) missing.push('Límite de crédito');
    if (isReq('dias_credito') && !form.diasCredito) missing.push('Días de crédito');
    if (isReq('observaciones_cli') && !form.notas) missing.push('Notas internas');
    if (missing.length > 0) { setValidationErrors(missing); return; }
    setValidationErrors([]);
    // Chequeo AUTORITATIVO contra el server: `findDup*` recorre SSData.clientes, que fuera de
    // /clientes puede estar casi vacío — la regla dura no puede depender de eso.
    setSaving(true);
    const dup = await window.buscarDuplicadoCliente({
      nombre: nombreUP, rif: form.rif, excluirId: cliente?.id || null,
    });
    if (dup.porRif) {
      setSaving(false);
      setValidationErrors([`RIF duplicado — ya existe en el cliente: ${dup.porRif.nombre} (${dup.porRif.rif})`]);
      return;
    }
    if (dup.porNombre && !confirmado) {
      setSaving(false);
      setHomonimo(dup.porNombre);
      return;
    }
    setHomonimo(null);
    const payload = {
      nombre:         nombreUP,
      persona:        persona,
      rif:            form.rif,
      contacto:       contactoNombre || null,
      // Teléfono general del cliente. Al ALTA, si se deja vacío hereda el del contacto principal.
      telefono:       (form.telefono && form.telefono.trim() !== '+58') ? form.telefono : (isEdit ? null : (contactoTel || null)),
      email:          form.email    || null,
      tipo:           form.tipo,
      lista_precio:   (form.listaPrecio && form.listaPrecio !== 'base') ? form.listaPrecio : null,
      ciudad:         form.ciudad   || null,
      direccion:      form.direccion || null,
      estado:         form.estado   || null,
      limite_credito: form.limiteCredito || 0,
      dias_credito:   form.diasCredito  || 0,
      notas:          form.notas    || null,
      terminos_pago:  form.terminos_pago || null,
      tipo_entrega:   form.tipo_entrega  || null,
      tipo_venta:     form.tipo_venta    || null,
      vendedor:       form.vendedor      || null,
      fuente:         form.fuente        || null,
      zona_delivery:  form.zona_delivery || null,
      dir_factura:    form.dir_factura   || null,
      dir_entrega:    form.dir_entrega   || null,
      observaciones:  form.observaciones || null,
      activo:         true,
    };
    if (isEdit) {
      const { error } = await window.sb.from('clientes').update(payload).eq('id', cliente.id);
      if (error) { alert('Error al guardar: ' + error.message); setSaving(false); return; }
      window.logActivity({ modulo: 'clientes', accion: 'editar', entidad_id: String(cliente.id), entidad_label: form.nombre });
    } else {
      const newId = 'CL-' + Date.now();
      payload.id = newId;
      payload.empresas = [window.currentEmpresa];
      payload.creado_por = window.__ssCurrentUser?.nombre || null;
      const { error } = await window.sb.from('clientes').insert(payload);
      if (error) { alert('Error al crear cliente: ' + error.message); setSaving(false); return; }
      // Contacto principal OBLIGATORIO: todo cliente nace con al menos un contacto (nombre +
      // teléfono; email opcional). Su teléfono/email son únicos por empresa (validado arriba).
      const { error: cErr } = await window.sb.from('contactos').insert({
        id:         'CT-C-' + newId,
        cliente_id: newId,
        nombre:     contactoNombre,
        cargo:      contactoCargo || (persona === 'juridica' ? 'Contacto principal' : 'Titular'),
        telefono:   contactoTel   || null,
        email:      contactoEmail || null,
        activo:     true,
        empresa_id: window.currentEmpresa,
        creado_por: window.__ssCurrentUser?.nombre || null,
      });
      if (cErr) { alert('Cliente creado, pero falló el contacto principal: ' + cErr.message); }
      window.logActivity({ modulo: 'clientes', accion: 'crear', entidad_id: newId, entidad_label: form.nombre });
    }
    await window.loadAppData();
    setSaving(false);
    onClose();
  }
  const tc = SSData.tiposCliente.find(t => t.id === form.tipo);
  const lp = SSData.listasPrecios.find(l => l.id === form.listaPrecio);
  const vendedoresList = (SSData.vendedores || []);
  const canEditVendedor = window.canUser?.('editar', 'pos_vendedor') ?? true;

  const estados = ['Distrito Capital','Miranda','Carabobo','Zulia','Lara','Aragua','Bolívar','Anzoátegui','Táchira','Mérida'];

  const camposConfig = window.getCamposConfig?.('clientes') ?? {};
  const isReq  = id => camposConfig[id] === 'obligatorio';
  const isHide = id => camposConfig[id] === 'oculto';
  const reqLbl = id => isReq(id) ? <span style={{color:'var(--danger)'}}>*</span> : null;
  const reqBorder = (id, val) => isReq(id) && !val ? {borderColor:'var(--danger)'} : {};
  const formValid = (() => {
    if (!form.nombre) return false;
    if (rifError) return false;
    if (isReq('rif') && form.rif.length < 4) return false;
    if (isReq('lista_precios') && !form.listaPrecio) return false;
    if (isReq('telefono') && (!form.telefono || form.telefono.trim() === '+58')) return false;
    if (isReq('email') && !form.email) return false;
    if (isReq('dir_fiscal') && !form.direccion) return false;
    if (isReq('estado') && !form.estado) return false;
    if (isReq('ciudad') && !form.ciudad) return false;
    if (isReq('limite_credito') && !form.limiteCredito) return false;
    if (isReq('dias_credito') && !form.diasCredito) return false;
    if (isReq('observaciones_cli') && !form.notas) return false;
    return true;
  })();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width: 820, maxHeight:'90vh', display:'flex', flexDirection:'column'}}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}>
            <Icon name="clients" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">{isEdit ? 'Editar cliente' : 'Nuevo cliente'}</h3>
            <div className="small">{isEdit ? `Modificando datos de ${cliente.nombre}` : 'Registra un cliente con su tipo, lista de precios y condiciones de crédito'}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        <div style={{padding:'0 20px', borderBottom:'1px solid var(--border)'}}>
          <div className="seg" style={{border:'none'}}>
            <button className={tab==='general'?'on':''} onClick={()=>setTab('general')}>General</button>
            <button className={tab==='credito'?'on':''} onClick={()=>setTab('credito')}>Crédito</button>
            <button className={tab==='condiciones'?'on':''} onClick={()=>setTab('condiciones')}>Condiciones</button>
            <button className={tab==='contactos'?'on':''} onClick={()=>setTab('contactos')}>Contactos</button>
          </div>
        </div>

        <div className="modal-body" style={{flex:1, overflowY:'auto'}}>
          {tab === 'general' && <>
            <div className="form-section-title">Información básica</div>
            <div className="grid-2">
              <div>
                <label className="form-label">Razón social / Nombre {reqLbl('nombre')}</label>
                <input className="input" placeholder="DISTRIBUIDORA EL GLOBO C.A." value={form.nombre} onChange={e=>checkNombre(e.target.value)} style={nombreError ? {borderColor:'var(--warn)', textTransform:'uppercase'} : {...reqBorder('nombre', form.nombre), textTransform:'uppercase'}}/>
                {nombreError && <div style={{fontSize:11, color:'var(--warn)', marginTop:3}}>{nombreError}</div>}
              </div>
              <div>
                <label className="form-label">RIF {reqLbl('rif')}</label>
                <input className="input mono" placeholder="J-12345678-9" value={form.rif} onChange={e=>checkRif(e.target.value)} style={rifError ? {borderColor:'var(--danger)'} : reqBorder('rif', form.rif.length >= 4)}/>
                {rifError && <div style={{fontSize:11, color:'var(--danger)', marginTop:3}}>{rifError}</div>}
              </div>
            </div>
            <div className="grid-2 mt-4">
              {!isHide('email') && <div>
                <label className="form-label">Email de Notificaciones {reqLbl('email')}</label>
                <input className="input" placeholder="ventas@elglobo.com.ve" value={form.email} onChange={e=>update('email', e.target.value)} style={reqBorder('email', form.email)}/>
                <div className="small" style={{color:'var(--text-muted)', marginTop:3}}>Correo para enviar documentos/notificaciones. Puede repetirse en otro cliente.</div>
              </div>}
              {!isHide('telefono') && <div>
                <label className="form-label">Teléfono <span className="small" style={{color:'var(--text-muted)'}}>— general del cliente</span></label>
                <input className="input" placeholder="+58 414-1234567" value={form.telefono} onChange={e=>update('telefono', e.target.value)} style={reqBorder('telefono', form.telefono && form.telefono.trim() !== '+58')}/>
                {!isEdit && <div className="small" style={{color:'var(--text-muted)', marginTop:3}}>Si lo dejas vacío, se usa el teléfono del contacto principal.</div>}
              </div>}
            </div>

            {!isEdit && (<>
              <div className="form-section-title mt-4">
                Contacto principal <span style={{color:'var(--danger)'}}>*</span>
                <span className="small" style={{color:'var(--text-muted)', fontWeight:400}}> — todo cliente debe tener al menos un contacto</span>
              </div>
              <div className="grid-2">
                <div>
                  <label className="form-label">Nombre del contacto <span className="small" style={{color:'var(--text-muted)'}}>— por defecto, la razón social</span></label>
                  <input className="input" placeholder={form.nombre || 'ING. CARLOS PÉREZ'} value={form.contacto} onChange={e=>update('contacto', e.target.value)} style={{textTransform:'uppercase'}}/>
                </div>
                <div>
                  <label className="form-label">Cargo</label>
                  <input className="input" placeholder="Gerente de Compras" value={form.contacto_cargo} onChange={e=>update('contacto_cargo', e.target.value)}/>
                </div>
              </div>
              <div className="grid-2 mt-3">
                <div>
                  <label className="form-label">Teléfono del contacto <span style={{color:'var(--danger)'}}>*</span></label>
                  <input className="input" placeholder="+58 414-1234567" value={form.contacto_tel} onChange={e=>checkContactoTel(e.target.value)} style={contactoTelError ? {borderColor:'var(--danger)'} : {}}/>
                  {contactoTelError && <div style={{fontSize:11, color:'var(--danger)', marginTop:3}}>{contactoTelError}</div>}
                </div>
                <div>
                  <label className="form-label">Email del contacto <span className="small" style={{color:'var(--text-muted)'}}>— opcional, no puede repetirse</span></label>
                  <input className="input" placeholder="carlos@empresa.ve" value={form.contacto_email} onChange={e=>checkContactoEmail(e.target.value)} style={contactoEmailError ? {borderColor:'var(--danger)'} : {}}/>
                  {contactoEmailError && <div style={{fontSize:11, color:'var(--danger)', marginTop:3}}>{contactoEmailError}</div>}
                </div>
              </div>
            </>)}

            {!isHide('tipo_cliente') && <>
              <div className="form-section-title mt-4">Tipo de cliente {reqLbl('tipo_cliente')}</div>
              <div className="grid-4">
                {SSData.tiposCliente.map(t => (
                  <div key={t.id} onClick={()=>onTipoChange(t.id)} className="card" style={{padding:12, cursor:'pointer', border: form.tipo === t.id ? '2px solid '+t.color : '1px solid var(--border)', background: form.tipo === t.id ? t.color+'15' : 'var(--bg-elev)'}}>
                    <div style={{width:8,height:8,borderRadius:2,background:t.color,marginBottom:6}}/>
                    <div style={{fontSize:13, fontWeight:600}}>{t.nombre}</div>
                  </div>
                ))}
              </div>
            </>}
            {!isHide('lista_precios') && <div className="mt-3">
              <label className="form-label">Lista de precios {isReq('lista_precios') ? reqLbl('lista_precios') : <span className="small" style={{color:'var(--text-muted)'}}>— opcional</span>}</label>
              <select className="select" value={form.listaPrecio} onChange={e=>update('listaPrecio', e.target.value)} style={{width:'100%', ...reqBorder('lista_precios', form.listaPrecio)}}>
                <option value="base">Sin lista — usa precios base</option>
                {SSData.listasPrecios.map(l => <option key={l.id} value={l.id}>{l.nombre} (−{l.valor}%)</option>)}
              </select>
            </div>}
            <div className="mt-3">
              <label className="form-label">
                Vendedor asignado{' '}
                <span className="small" style={{color:'var(--text-muted)'}}>
                  {isEdit
                    ? '— solo se cambia con permiso "Cambiar vendedor asignado"'
                    : '— se autocompleta en cotizaciones'}
                </span>
                {isEdit && !canEditVendedor && <span title="Requiere permiso para cambiar el vendedor de un cliente ya registrado." style={{marginLeft:6, fontSize:10, padding:'1px 6px', borderRadius:99, background:'var(--bg-sunken)', color:'var(--text-muted)'}}>🔒 Solo lectura</span>}
              </label>
              <select className="select" value={form.vendedor} disabled={isEdit && !canEditVendedor} onChange={e=>update('vendedor', e.target.value)} style={{width:'100%', opacity: (isEdit && !canEditVendedor) ? 0.7 : 1, cursor: (isEdit && !canEditVendedor) ? 'not-allowed' : 'pointer'}} title={(isEdit && !canEditVendedor) ? 'El vendedor solo se asigna al crear el cliente. Para modificarlo, requerís el permiso "Cambiar vendedor asignado".' : ''}>
                <option value="">— Sin asignar —</option>
                {vendedoresList.map(v => <option key={v.id} value={v.nombre}>{v.nombre}</option>)}
              </select>
            </div>

            <div className="form-section-title mt-4">Ubicación</div>
            {!isHide('dir_fiscal') && <div>
              <label className="form-label">Dirección fiscal {reqLbl('dir_fiscal')}</label>
              <textarea className="input" rows="2" placeholder="Av. Libertador, Edif. Torre Parque, PB, Local 3" value={form.direccion} style={reqBorder('dir_fiscal', form.direccion)} onChange={e=>{
                const v = e.target.value;
                setForm(f => ({...f, direccion: v, ...(f._sameAddress !== false ? { dir_factura: v, dir_entrega: v } : {})}));
              }}/>
            </div>}
            <div className="grid-2 mt-3">
              {!isHide('ciudad') && <div>
                <label className="form-label">Ciudad {reqLbl('ciudad')}</label>
                <input className="input" value={form.ciudad} onChange={e=>update('ciudad', e.target.value)} style={reqBorder('ciudad', form.ciudad)}/>
              </div>}
              {!isHide('estado') && <div>
                <label className="form-label">Estado {reqLbl('estado')}</label>
                <select className="select" value={form.estado} onChange={e=>update('estado', e.target.value)} style={{width:'100%', ...reqBorder('estado', form.estado)}}>
                  {estados.map(es => <option key={es} value={es}>{es}</option>)}
                </select>
              </div>}
            </div>
            <label style={{display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer', marginTop:12}}>
              <input type="checkbox"
                checked={form._sameAddress !== false}
                onChange={e=>{
                  const same = e.target.checked;
                  setForm(f => ({...f, _sameAddress: same, ...(same ? { dir_factura: f.direccion, dir_entrega: f.direccion } : {})}));
                }}/>
              Usar la dirección fiscal para factura y entrega
            </label>
            {form._sameAddress === false && (
              <>
                <div className="mt-3">
                  <label className="form-label">Dirección de factura</label>
                  <input className="input" placeholder="Dirección fiscal para documentos..." value={form.dir_factura} onChange={e=>update('dir_factura', e.target.value)}/>
                </div>
                <div className="mt-3">
                  <label className="form-label">Dirección de entrega</label>
                  <input className="input" placeholder="Dirección de entrega habitual..." value={form.dir_entrega} onChange={e=>update('dir_entrega', e.target.value)}/>
                </div>
              </>
            )}
          </>}

          {tab === 'credito' && <>
            <div className="form-section-title">Condiciones de crédito</div>
            <div className="grid-2">
              {!isHide('limite_credito') && <div>
                <label className="form-label">Límite de crédito (USD) {reqLbl('limite_credito')}</label>
                <input className="input mono" type="number" value={form.limiteCredito} onChange={e=>update('limiteCredito', Number(e.target.value))} style={reqBorder('limite_credito', form.limiteCredito)}/>
                <div className="small mt-2">0 = solo contado</div>
              </div>}
              {!isHide('dias_credito') && <div>
                <label className="form-label">Días de crédito {reqLbl('dias_credito')}</label>
                <select className="select" value={form.diasCredito} onChange={e=>update('diasCredito', Number(e.target.value))} style={{width:'100%', ...reqBorder('dias_credito', form.diasCredito)}}>
                  <option value="0">Contado</option>
                  <option value="7">7 días</option>
                  <option value="15">15 días</option>
                  <option value="30">30 días</option>
                  <option value="45">45 días</option>
                  <option value="60">60 días</option>
                </select>
              </div>}
            </div>
            {!isHide('observaciones_cli') && <div className="mt-4">
              <label className="form-label">Notas internas {reqLbl('observaciones_cli')}</label>
              <textarea className="input" rows="3" placeholder="Observaciones sobre el cliente..." value={form.notas} onChange={e=>update('notas', e.target.value)} style={reqBorder('observaciones_cli', form.notas)}/>
            </div>}
          </>}

          {tab === 'contactos' && (
            <ClienteContactosTab cliente={cliente} isEdit={isEdit}/>
          )}

          {tab === 'condiciones' && <>
            <div className="form-section-title">Condiciones comerciales por defecto</div>
            <div className="card" style={{padding:12, background:'var(--bg-sunken)', marginBottom:16}}>
              <div className="small"><Icon name="info" size={12}/> Estos valores se pre-llenan automáticamente al crear una cotización u orden para este cliente. Se pueden cambiar por documento.</div>
            </div>
            <div className="grid-2">
              <div>
                <label className="form-label">Tipo de venta</label>
                <select className="select" value={form.tipo_venta} onChange={e=>update('tipo_venta', e.target.value)} style={{width:'100%'}}>
                  <option value="">— Sin definir —</option>
                  <option value="regular">Regular</option>
                  <option value="especial">Especial</option>
                  <option value="consignacion">Consignación</option>
                  <option value="muestra">Muestra</option>
                </select>
              </div>
              <div>
                <label className="form-label">Términos de pago</label>
                <select className="select" value={form.terminos_pago} onChange={e=>update('terminos_pago', e.target.value)} style={{width:'100%'}}>
                  <option value="">— Sin definir —</option>
                  <option value="inmediato">Pago inmediato</option>
                  <option value="7">Crédito 7 días</option>
                  <option value="15">Crédito 15 días</option>
                  <option value="30">Crédito 30 días</option>
                  <option value="45">Crédito 45 días</option>
                  <option value="60">Crédito 60 días</option>
                </select>
              </div>
              <div>
                <label className="form-label">Tipo de entrega</label>
                {/* La MISMA lista que el POS (`pos_tipos_entrega`, migración 81). Escrita a mano
                    guardaba 'retiro' mientras el POS ofrecía 'Retiro en tienda': el valor del
                    cliente no coincidía con ninguna opción de allá y el prellenado no ocurría.
                    Se administra en POS → Configurar → Tipos de entrega. */}
                <select className="select" value={form.tipo_entrega} onChange={e=>update('tipo_entrega', e.target.value)} style={{width:'100%'}}>
                  <option value="">— Sin definir —</option>
                  {window.ssOpcionesEntrega().map(t => <option key={t.id} value={t.valor}>{t.nombre}</option>)}
                  {form.tipo_entrega && !window.ssOpcionesEntrega().some(t => t.valor === form.tipo_entrega) && (
                    <option value={form.tipo_entrega}>{window.ssLabelEntrega(form.tipo_entrega)}</option>
                  )}
                </select>
              </div>
              <div>
                <label className="form-label">Fuente / Canal</label>
                <select className="select" value={form.fuente} onChange={e=>update('fuente', e.target.value)} style={{width:'100%'}}>
                  <option value="">— Ninguna —</option>
                  {window.ssOpcionesFuente().map(f => <option key={f.id} value={f.valor}>{f.nombre}</option>)}
                  {form.fuente && !window.ssOpcionesFuente().some(f => f.valor === form.fuente) && (
                    <option value={form.fuente}>{window.ssLabelFuente(form.fuente)}</option>
                  )}
                </select>
              </div>
              <div>
                <label className="form-label">Zona delivery</label>
                <input className="input" placeholder="Ej. Chacao, Los Palos Grandes..." value={form.zona_delivery} onChange={e=>update('zona_delivery', e.target.value)}/>
              </div>
            </div>
            <div className="mt-4">
              <label className="form-label">Observaciones / instrucciones habituales</label>
              <textarea className="input" rows="3" placeholder="Instrucciones que aparecerán por defecto en los documentos de este cliente..." value={form.observaciones} onChange={e=>update('observaciones', e.target.value)} style={{resize:'vertical', fontFamily:'inherit', fontSize:12.5, lineHeight:1.4}}/>
            </div>
            <div className="card mt-3" style={{padding:12, background:'var(--bg-sunken)'}}>
              <div className="small"><Icon name="info" size={12}/> Las direcciones de factura y entrega se gestionan en la sección <strong>Ubicación</strong> de la pestaña General.</div>
            </div>
          </>}
        </div>

        {homonimo && (
          <div style={{padding:'4px 20px 10px'}}>
            <window.AvisoHomonimo
              cliente={homonimo}
              creando={saving}
              onContinuar={() => handleSave({ confirmado: true })}
              onCancelar={() => setHomonimo(null)}
            />
          </div>
        )}
        {validationErrors.length > 0 && (
          <div style={{padding:'10px 20px', background:'#fef2f2', borderTop:'1px solid #fecaca', display:'flex', gap:8, alignItems:'flex-start'}}>
            <span style={{color:'var(--danger)', fontSize:16, lineHeight:1, flexShrink:0}}>⚠</span>
            <div style={{fontSize:12.5, color:'#991b1b', lineHeight:1.5}}>
              <strong>Completá los siguientes campos antes de guardar:</strong>
              <ul style={{margin:'4px 0 0', paddingLeft:16}}>
                {validationErrors.map(e => <li key={e}>{e}</li>)}
              </ul>
            </div>
          </div>
        )}
        <div className="modal-footer" style={{justifyContent:'space-between'}}>
          <div className="small">
            <strong>{form.nombre || 'Sin nombre'}</strong>
            {tc && <> · <span style={{color:tc.color, fontWeight:500}}>{tc.nombre}</span></>}
            {lp && <> · {lp.nombre}</>}
          </div>
          <div className="flex gap-2">
            <button className="btn ghost" onClick={onClose}>Cancelar</button>
            <button className="btn primary" disabled={saving} onClick={() => handleSave()}><Icon name="check" size={14}/>{saving ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Crear cliente')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ======= Modal: Registrar pago =======
// Métodos de pago para los modales de cobro/pago — desde el catálogo gestionable (con fallback).
function metodosPagoUI() {
  return (window.getMetodosPago?.() || [])
    .filter(m => m.activo !== false)
    .map(m => ({ id: m.codigo, l: m.label, icon: m.icon || 'bank', monedas: m.monedas || ['USD','VES'], sin_banco: !!m.sin_banco }));
}
function emptyLinea() {
  return { _k: Date.now() + Math.random(), metodo:'transferencia', moneda:'USD', monto:'', banco:'', referencia:'', notas:'', tasaCustom:'', _autoSync: true };
}

function RegisterPaymentModal({ cliente, deudas, onClose, tipo = 'cobrar', initialSel = null }) {
  // tipo: 'cobrar' = recibir dinero del cliente (CxC) | 'pagar' = enviar dinero (CxP / vuelto)
  const esPagar    = tipo === 'pagar';
  const esVuelto   = esPagar && deudas.some(d => d.tipo === 'vuelto');
  const esComision = esPagar && deudas.some(d => d.tipo === 'comision');
  // CxP normal a proveedor: NO tiene modalidad. Puede pagarse en USD o en Bs.; la tasa Bs. por
  // defecto es la de VUELTO. Si la CxP se registró en Bs. (moneda='VES'), el pago arranca en Bs.
  const esCompraProv = esPagar && !esVuelto && !esComision;
  const tasaVuelto   = SSData.tasa?.vuelto || SSData.tasa?.paralelo || 1;
  // Lock de modalidad solo en CxC — CxP no maneja modalidad de pago.
  const aplicaLockModalidad = !esPagar;
  const diasCredito = cliente?.diasCredito || 0;

  // sel va primero — necesario para derivar isMixed y modalidadCxC antes de otros hooks
  // En CxC/CxP: si no hay pre-selección, sólo marcar facturas de la modalidad de la primera deuda
  // (no se permite agrupar facturas de modalidades distintas).
  const [sel, setSel] = useState(() => {
    if (initialSel) return deudas.filter(d => initialSel.includes(d.id)).map(d => d.id);
    if (aplicaLockModalidad) {
      const modPrimera = deudas[0]?.modalidad_pago || 'divisas';
      return deudas.filter(d => (d.modalidad_pago || 'divisas') === modPrimera).map(d => d.id);
    }
    return deudas.map(d => d.id);
  });
  // 'usd' | 'paralelo' (=Bs.). En CxP registrada en Bs. arranca en Bs.; el resto en USD.
  const [modoPago, setModoPago] = useState(() =>
    (esCompraProv && (deudas[0]?.moneda === 'VES')) ? 'paralelo' : 'usd'
  );

  const selCxCs = deudas.filter(d => sel.includes(d.id));
  const sumaSel = selCxCs.reduce((s,d) => s + (d.monto - d.pagado), 0);
  const selMods = [...new Set(selCxCs.map(d => d.modalidad_pago || 'divisas'))];
  const isMixed = !esVuelto && selMods.length > 1;
  // Modalidad activa de la selección — usada en CxC para bloquear mezcla
  const modalidadActiva = selMods[0] || (deudas[0]?.modalidad_pago || 'divisas');

  // ── Modalidad dominante — solo válida cuando no es mixto ──────────────────
  const modalidadCxC = esVuelto ? 'vuelto' : (selCxCs[0]?.modalidad_pago || deudas[0]?.modalidad_pago || 'divisas');
  // Divisas → el cliente puede pagar en USD o en Bs. a tasa Paralelo
  const necesitaEleccion = !esVuelto && !isMixed && modalidadCxC === 'divisas';

  // 'bcv_fijo' (Nota BCV) es una modalidad EN BOLÍVARES a la tasa BCV exacta, sin cobertura.
  // No estaba contemplada acá: caía al final de cada regla y el cobro se abría en dólares con
  // tasa 1 — se ofrecían los métodos de pago en USD para una factura que el cliente paga en Bs.
  const esBCV = modalidadCxC === 'bcv' || modalidadCxC === 'bcv_fijo';

  // Moneda efectiva y tasa de conversión a USD según contexto
  const monedaEfectiva = (() => {
    if (isMixed) return 'USD';
    if (esVuelto) return 'VES';
    if (esBCV || modalidadCxC === 'paralelo') return 'VES';
    if (modalidadCxC === 'divisas' && !necesitaEleccion) return 'USD';
    return modoPago === 'paralelo' ? 'VES' : 'USD';
  })();
  const tasaUSD = (() => {
    if (isMixed) return SSData.tasa?.paralelo || 1;
    if (esVuelto) return SSData.tasa?.vuelto || SSData.tasa?.paralelo || 1;
    if (esCompraProv) return modoPago === 'paralelo' ? tasaVuelto : 1;   // CxP: Bs. a tasa vuelto
    if (esBCV) return SSData.tasa?.bcv || 1;
    if (modalidadCxC === 'paralelo') return SSData.tasa?.paralelo || 1;
    if (necesitaEleccion && modoPago === 'paralelo') return SSData.tasa?.paralelo || 1;
    return 1;
  })();
  // Tasa aplicable a una LÍNEA en Bs. — independiente del "modo" global (USD/Paralelo).
  // Una factura en Divisas puede cobrarse (parcial o total) en Bs.: la conversión SIEMPRE es a
  // Paralelo, nunca a 1. BCV → tasa BCV; Vuelto → tasa vuelto. Es el valor por defecto del campo
  // "Tasa" de cada pago en Bs. (el usuario puede editarlo).
  const tasaVES = (() => {
    if (esCompraProv) return tasaVuelto;   // CxP: los pagos en Bs. usan la tasa de vuelto
    if (esVuelto) return SSData.tasa?.vuelto || SSData.tasa?.paralelo || 1;
    if (esBCV) return SSData.tasa?.bcv || 1;   // Nota BCV incluida: tasa BCV, sin cobertura
    return SSData.tasa?.paralelo || 1;
  })();

  // ── Anticipos del cliente aplicables a este cobro ─────────────────────────────────────────
  // El saldo a favor se guarda en USD, pero un anticipo en bolívares SOLO puede saldar un cobro en
  // bolívares: la conversión ya ocurrió cuando entró el dinero, a esa tasa. Por eso el filtro es por
  // moneda del anticipo contra la moneda del pago que se está registrando.
  const [antVersion, setAntVersion]   = useState(0);
  const [antAplicando, setAntAplicando] = useState('');
  const [antError, setAntError]       = useState('');
  const [antHecho, setAntHecho]       = useState('');
  const [antTarget, setAntTarget]     = useState('');
  // Cuánto de CADA vuelto se aplica. Amanda, en la misma llamada: "puedes escoger el monto a
  // aplicar; aplico 30 nada más y los otros 30 te los sigo dejando de crédito". Vacío = el tope.
  const [vueltoMonto, setVueltoMonto] = useState({});
  // Retención: la cuenta sobre la que se abre el modal (lazy chunk `retenciones`).
  const [retCuenta, setRetCuenta]     = useState(null);
  const [retCargando, setRetCargando] = useState(false);
  React.useEffect(() => {
    if (esPagar) return;
    // Los anticipos no viajan en la carga inicial (son pocos y solo importan acá y en su módulo).
    if (Array.isArray(SSData.anticipos)) return;
    window.loadAnticipos?.().then(() => setAntVersion(v => v + 1));
  }, [esPagar]);
  // Un crédito EN DÓLARES se puede aplicar a cualquier nota; uno en BOLÍVARES, solo a un cobro en
  // bolívares. La regla no es simétrica y por eso antes estaba mal: se pedía `moneda === moneda del
  // cobro` en los dos sentidos, y como una nota BCV cobra en bolívares (`monedaEfectiva` = 'VES'),
  // un saldo a favor en dólares quedaba escondido justo ahí. Es el muro que reportó Jorge el
  // 2026-08-11: sus dos notas de Francisco Pettit son `modalidad_pago='bcv'` y su saldo a favor de
  // $60 no aparecía por ningún lado.
  //   · La deuda de `cuentas_cobrar.monto` ESTÁ EN USD (medido: las notas BCV de $60 y $138 valen
  //     60,00 y 138,00 en la tabla), y `aplicar_anticipo` descuenta en USD. Aplicar un crédito en
  //     dólares es restar dólares a dólares: no hay ninguna tasa de por medio que pueda mentir.
  //   · Al revés sí importa: un anticipo en bolívares congeló su tasa al entrar, así que solo puede
  //     saldar un cobro que se esté haciendo a esa misma moneda.
  const creditoAplicable = React.useCallback((c) => {
    const moneda = c.moneda || 'USD';
    if (moneda !== 'VES') return true;
    return monedaEfectiva === 'VES' && (parseFloat(c.tasa) || 0) > 0;
  }, [monedaEfectiva]);

  const anticiposDisponibles = React.useMemo(() => {
    if (esPagar || !cliente?.id) return [];
    return (SSData.anticipos || []).filter(a =>
      a.cliente_id === cliente.id &&
      (parseFloat(a.saldo_usd) || 0) > 0.005 &&
      creditoAplicable(a));
  }, [esPagar, cliente?.id, creditoAplicable, antVersion, SSData.anticipos]);

  // ── VUELTOS pendientes del cliente ────────────────────────────────────────────────────────
  // Un vuelto (cuentas_pagar tipo='vuelto') y un saldo a favor son la MISMA deuda con el cliente:
  // lo único que cambia es cómo se salda —devolverle el efectivo o descontárselo de otra nota—.
  // Hasta acá solo se podía lo primero, y por eso Jorge no podía usar los $60 de Pettit: "está bien
  // que me lo ponga como vuelto, pero también me lo tiene que poner aquí". Se ofrecen igual que los
  // anticipos; usarlos los pasa a saldo a favor (RPC `vuelto_a_saldo_a_favor`) y los aplica.
  const vueltosDisponibles = React.useMemo(() => {
    if (esPagar || !cliente?.id) return [];
    return (SSData.cuentasPagar || []).filter(c =>
      c.tipo === 'vuelto' &&
      (c.cliente_id || c.cliente) === cliente.id &&
      ((parseFloat(c.monto) || 0) - (parseFloat(c.pagado) || 0)) > 0.005 &&
      creditoAplicable(c));
  }, [esPagar, cliente?.id, creditoAplicable, antVersion, SSData.cuentasPagar]);
  const saldoVuelto = (v) => Math.round(((parseFloat(v.monto) || 0) - (parseFloat(v.pagado) || 0)) * 100) / 100;
  // Saldo del anticipo en la moneda en que entró (para mostrarlo como lo piensa el usuario).
  const antVista = (a) => (parseFloat(a.saldo_usd) || 0) * (parseFloat(a.tasa) || 0);

  // ── Anticipos FLOTANTES (sin identificar) ─────────────────────────────────────────────────
  // Depósitos que entraron al banco sin que se supiera de quién eran (`cliente_id` NULL). Hasta
  // ahora había que ir al módulo de Anticipos, buscar el depósito, asignarle el cliente y recién
  // después volver a cobrar. Acá se ofrecen en el mismo modal: aplicarlo le asigna el cliente y
  // lo aplica en un paso.
  //
  // Van SEPARADOS de los del cliente y con aviso, a propósito: aplicar un depósito que no se sabe
  // de quién es le adjudica ese dinero a ESTE cliente, y eso es una decisión de cobranza, no un
  // atajo. Por eso no se mezclan en la misma lista.
  const anticiposFlotantes = React.useMemo(() => {
    if (esPagar) return [];
    return (SSData.anticipos || []).filter(a =>
      !a.cliente_id &&
      (parseFloat(a.saldo_usd) || 0) > 0.005 &&
      creditoAplicable(a));
  }, [esPagar, creditoAplicable, antVersion, SSData.anticipos]);

  // Asigna el cliente al depósito flotante y lo aplica. Si la asignación falla no se aplica nada:
  // un anticipo aplicado a una factura pero sin dueño es peor que uno sin identificar.
  async function aplicarFlotante(a, destino, usdAplicable) {
    setAntError(''); setAntHecho('');
    if (!cliente?.id) { setAntError('No se pudo determinar el cliente de esta cuenta.'); return; }
    setAntAplicando(a.pago_id);
    const asig = await window.asignarClienteAnticipo?.({ pagoId: a.pago_id, clienteId: cliente.id });
    if (asig?.error) {
      setAntAplicando('');
      setAntError('No se pudo asignar el depósito a ' + (cliente.nombre || 'este cliente') + ': ' + (asig.error.message || asig.error));
      return;
    }
    setAntAplicando('');
    await aplicarAnticipoAlCobro({ ...a, cliente_id: cliente.id }, destino, usdAplicable);
  }

  // Usar un vuelto = pasarlo a saldo a favor y aplicarlo, en un solo clic. Son DOS pasos y cada uno
  // es atómico por su lado: si el segundo falla, lo que queda es un saldo a favor sin aplicar — un
  // estado legítimo que el propio modal vuelve a ofrecer. Lo contrario (aplicar sin haber dado de
  // baja el vuelto) sí sería plata contada dos veces, y por eso el orden es este y no el otro.
  async function aplicarVueltoAlCobro(v, destino, usdAplicable) {
    setAntError(''); setAntHecho('');
    const facturaId = destino?.factura || destino?.id;
    if (!facturaId) { setAntError('Selecciona la factura a la que se aplica el vuelto.'); return; }
    const monto = Math.round(usdAplicable * 100) / 100;
    if (monto <= 0.005) { setAntError('No queda saldo por aplicar en esa factura.'); return; }
    setAntAplicando(v.id);
    const { data, error } = await window.vueltoASaldoAFavor({ vueltoId: v.id, monto });
    if (error) {
      setAntAplicando('');
      setAntError('No se pudo usar el vuelto: ' + (error.message || String(error)));
      return;
    }
    setAntAplicando('');
    // Ya es un anticipo: de acá en adelante corre el camino de siempre.
    await aplicarAnticipoAlCobro({ pago_id: data.pago_id, saldo_usd: data.monto_usd,
                                   moneda: data.moneda, tasa: data.tasa }, destino, usdAplicable);
  }

  async function aplicarAnticipoAlCobro(a, destino, usdAplicable) {
    setAntError(''); setAntHecho('');
    const facturaId = destino?.factura || destino?.id;
    if (!facturaId) { setAntError('Selecciona la factura a la que se aplica el anticipo.'); return; }
    const monto = Math.round(usdAplicable * 100) / 100;
    if (monto <= 0.005) { setAntError('No queda saldo por aplicar en esa factura.'); return; }
    setAntAplicando(a.pago_id);
    const { error } = await window.aplicarAnticipo({ pagoId: a.pago_id, documentoId: facturaId, monto,
                                                     notas: 'Aplicado al registrar el cobro' });
    setAntAplicando('');
    if (error) { setAntError('No se pudo aplicar: ' + (error.message || String(error))); return; }
    // La RPC ya bajó la deuda en la base; se refleja en memoria para que el monto a cobrar que queda
    // se recalcule sin cerrar el modal (las filas de `deudas` son las de SSData).
    destino.pagado = Math.min(destino.monto, (destino.pagado || 0) + monto);
    if (destino.pagado >= destino.monto - 0.005) destino.estado = 'pagada';
    setAntHecho(`Se aplicaron ${fmt.usd(monto)} a ${facturaId}. Queda por cobrar ${fmt.usd(Math.max(0, destino.monto - destino.pagado))}.`);
    setAntVersion(v => v + 1);
    // Resincroniza el monto de las líneas de pago con la deuda que quedó.
    setLineas(prev => prev.map(l => {
      if (!l._autoSync) return l;
      const suma = deudas.filter(d => sel.includes(d.id)).reduce((s,d) => s + (d.monto - d.pagado), 0);
      const rate = (parseFloat(l.tasaCustom) > 0) ? parseFloat(l.tasaCustom) : tasaVES;
      return { ...l, monto: (l.moneda === 'VES' ? suma * rate : suma).toFixed(2) };
    }));
  }

  const totalDeuda = deudas.reduce((s,d)=>s+(d.monto - d.pagado), 0);
  const [fecha, setFecha] = useState(window.localDateStr());

  // ── El pago entró un día anterior ──────────────────────────────────────────────────────────
  // Mismo caso que en el cobro del POS: el cliente pagó el lunes y acá se registra el jueves.
  // Acá el modal ya dejaba TECLEAR la tasa por línea (`tasaCustom`), pero para eso hay que SABER
  // cuál era la de ese día; el selector la trae. El componente vive en core.jsx porque los dos
  // caminos de cobro lo usan.
  const [usarTasaPrevia, setUsarTasaPrevia] = useState(false);
  const [diaElegido, setDiaElegido]         = useState(null);
  // Qué tasa de ese día corresponde: espejo EXACTO de `tasaVES` de abajo. Si una cambia, cambiar
  // la otra — ofrecer el BCV para una cuenta que se cobra a paralelo sería cobrar de menos.
  const tasaDiaSegunModalidad = (d) => {
    if (!d) return null;
    if (esCompraProv) return d.vuelto ?? d.paralelo ?? null;
    if (esVuelto)     return d.vuelto ?? d.paralelo ?? null;
    if (esBCV)        return d.bcv ?? null;
    return d.paralelo ?? null;
  };
  const nombreTasaPrevia = esBCV ? 'BCV' : (esVuelto || esCompraProv) ? 'de vuelto' : 'paralelo';
  function toggleTasaPrevia(on) {
    setUsarTasaPrevia(on);
    if (!on) { setDiaElegido(null); setFecha(window.localDateStr()); }
  }
  // Elegir el día fija la fecha del cobro y ESCRIBE la tasa en cada línea en bolívares. Es un
  // rellenado, no un candado: después se puede corregir línea por línea (el campo "Tasa" sigue
  // ahí), porque un cobro puede repartirse entre pagos que entraron distinto.
  function elegirDiaPrevio(d, t) {
    if (!(t > 0)) return;
    setDiaElegido(d);
    setFecha(d.dia);
    setLineas(prev => prev.map(l => {
      if (l.moneda !== 'VES') return l;
      const nuevo = { ...l, tasaCustom: String(t) };
      // El monto en Bs. de las líneas que siguen el saldo se recalcula a la tasa nueva; las que el
      // usuario ya tocó (`_autoSync` false) se dejan como están.
      if (l._autoSync) nuevo.monto = (sumaSel * t).toFixed(2);
      return nuevo;
    }));
  }
  const montoInicial = monedaEfectiva === 'VES' ? (sumaSel * tasaUSD).toFixed(2) : sumaSel.toFixed(2);
  const [lineas, setLineas] = useState(() => [{ ...emptyLinea(), moneda: monedaEfectiva, monto: montoInicial, _autoSync: true }]);
  const [saving, setSaving] = useState(false);
  // Comprobante de pago (solo cobros) — UN solo campo para toda la transacción, no por línea: el
  // ledger `pagos` solo persiste UNA fila representativa por CxC ('rep', ver registrarPagosCxC en
  // supabase.js), la misma para todas las líneas/facturas de este cobro. Si se pidiera uno por línea,
  // el de cualquier línea no-representativa se perdería en silencio al guardar.
  const [comprobante, setComprobante]         = useState('');
  const [comprobLoading, setComprobLoading]   = useState(false);
  const [comprobError, setComprobError]       = useState('');
  async function handleComprobante(file) {
    if (!file) return;
    setComprobError(''); setComprobLoading(true);
    try { setComprobante(await window.resizeImageFile(file)); }
    catch (err) { setComprobError('No se pudo procesar la imagen: ' + (err.message || err)); }
    setComprobLoading(false);
  }

  function toggle(id) {
    const deuda = deudas.find(d => d.id === id);
    const ya = sel.includes(id);
    // CxC/CxP: no permitir agrupar facturas con modalidad distinta a la activa (excepto vueltos/comisiones)
    if (aplicaLockModalidad && !ya && deuda) {
      const modDeuda = deuda.modalidad_pago || 'divisas';
      const modActual = sel.length > 0 ? (deudas.find(d => d.id === sel[0])?.modalidad_pago || 'divisas') : modDeuda;
      if (sel.length > 0 && modDeuda !== modActual) {
        const labels = { divisas:'Divisas USD', bcv:'Bs. BCV', bcv_fijo:'Bs. Nota BCV', paralelo:'Bs. Paralelo' };
        alert(`No se pueden agrupar facturas de modalidades distintas.\n\nFactura seleccionada: ${labels[modActual] || modActual}\nFactura a agregar: ${labels[modDeuda] || modDeuda}\n\nDeseleccioná las facturas actuales para cambiar de modalidad.`);
        return;
      }
    }
    setSel(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
    setErrores(e => { const n = {...e}; delete n._facturas; return n; });
  }

  // Sincronizar monto con facturas seleccionadas (solo líneas que el usuario no ha editado manualmente)
  React.useEffect(() => {
    setLineas(prev => prev.map(l => {
      if (!l._autoSync) return l;
      const suma = deudas.filter(d => sel.includes(d.id)).reduce((s,d) => s + (d.monto - d.pagado), 0);
      const rateVES = (parseFloat(l.tasaCustom) > 0) ? parseFloat(l.tasaCustom) : tasaVES;
      const nuevoMonto = l.moneda === 'VES' ? (suma * rateVES).toFixed(2) : suma.toFixed(2);
      return { ...l, monto: nuevoMonto };
    }));
  }, [sel]);

  function updLinea(k, field, val) {
    const idx = lineas.findIndex(l => l._k === k);
    if (idx >= 0) {
      const keyMap = { monto: `l${idx}_monto`, banco: `l${idx}_banco`, referencia: `l${idx}_ref`, moneda: `l${idx}_banco` };
      if (keyMap[field]) setErrores(e => { const n = {...e}; delete n[keyMap[field]]; return n; });
    }
    setLineas(prev => prev.map(l => {
      if (l._k !== k) return l;
      const updated = { ...l, [field]: val };
      if (field === 'monto') updated._autoSync = false;
      if (field === 'moneda') {
        // Cambio manual de moneda en efectivo: convertir monto a la tasa de Bs. (Paralelo/BCV/vuelto)
        const m = parseFloat(l.monto) || 0;
        const rVES = (parseFloat(l.tasaCustom) > 0) ? parseFloat(l.tasaCustom) : tasaVES;
        if (l.moneda === 'USD' && val === 'VES') updated.monto = m > 0 ? (m * rVES).toFixed(2) : '';
        if (l.moneda === 'VES' && val === 'USD') updated.monto = m > 0 ? (m / rVES).toFixed(2) : '';
      }
      if (field === 'metodo') {
        const prevMoneda = l.moneda;
        // Moneda que fuerza el método elegido, según el catálogo (no hardcoded): un método de una
        // sola moneda (Zelle/Binance/PayPal…) fuerza esa moneda; "sin banco" (Efectivo) mantiene la
        // moneda actual; multi-moneda (Transferencia) o método desconocido usa la moneda de la modalidad.
        const _mm = metodosPagoUI().find(x => x.id === val);
        let newMoneda = monedaEfectiva;
        if (val === 'movil') { newMoneda = 'VES'; updated.banco = ''; }   // Pago Móvil: sin cuenta bancaria específica
        else if (_mm?.sin_banco) newMoneda = l.moneda;
        else if (_mm && _mm.monedas.length === 1) newMoneda = _mm.monedas[0];
        if (prevMoneda !== newMoneda) {
          const m = parseFloat(l.monto) || 0;
          const rVES = (parseFloat(l.tasaCustom) > 0) ? parseFloat(l.tasaCustom) : tasaVES;
          if (prevMoneda === 'USD' && newMoneda === 'VES') updated.monto = m > 0 ? (m * rVES).toFixed(2) : '';
          if (prevMoneda === 'VES' && newMoneda === 'USD') updated.monto = m > 0 ? (m / rVES).toFixed(2) : '';
        }
        updated.moneda = newMoneda;
      }
      if (field === 'banco') {
        // El BANCO manda: determina la MONEDA y los MÉTODOS disponibles. `val` = id de la cuenta.
        const cuenta = (SSData.cuentasBancarias || []).find(x => x.id === val)
          || (SSData.cuentasBancarias || []).find(x => x.banco === val);
        if (cuenta) {
          updated.banco = cuenta.banco;
          updated._cuentaId = cuenta.id;
          const nm = cuenta.moneda || l.moneda;
          // Convertir el monto si la moneda del banco difiere de la actual.
          if (nm !== l.moneda) {
            const m = parseFloat(l.monto) || 0;
            const rVES = (parseFloat(l.tasaCustom) > 0) ? parseFloat(l.tasaCustom) : tasaVES;
            if (l.moneda === 'USD' && nm === 'VES') updated.monto = m > 0 ? (m * rVES).toFixed(2) : updated.monto;
            if (l.moneda === 'VES' && nm === 'USD') updated.monto = m > 0 ? (m / rVES).toFixed(2) : updated.monto;
            updated.moneda = nm;
          }
          // Restringir el método a los que ofrece el banco y son compatibles con su moneda (catálogo).
          const _cat = metodosPagoUI();
          const compat = (mid) => { const mm = _cat.find(x => x.id === mid); return mm ? mm.monedas.includes(nm) : true; };
          const ofrecidos = (cuenta.metodos_pago && cuenta.metodos_pago.length) ? cuenta.metodos_pago : _cat.map(m => m.id);
          const permitidos = ofrecidos.filter(compat);
          if (updated.metodo !== 'efectivo' && !permitidos.includes(updated.metodo)) {
            updated.metodo = permitidos[0] || 'efectivo';
          }
        } else {
          updated.banco = val;          // texto libre (empresa sin cuentas registradas)
          updated._cuentaId = null;
        }
      }
      return updated;
    }));
  }
  function addLinea() { setLineas(prev => [...prev, { ...emptyLinea(), moneda: monedaEfectiva }]); }
  function removeLinea(k) { setLineas(prev => prev.filter(l => l._k !== k)); }

  // Cambiar modoPago: actualiza moneda y convierte montos
  function cambiarModoPago(modo) {
    setModoPago(modo);
    const nuevaMoneda = modo === 'paralelo' ? 'VES' : 'USD';
    const tasa = esCompraProv ? tasaVuelto : (SSData.tasa?.paralelo || 1);
    setLineas(prev => prev.map(l => {
      const m = parseFloat(l.monto) || 0;
      let nuevoMonto = l.monto;
      if (l.moneda === 'USD' && nuevaMoneda === 'VES') nuevoMonto = m > 0 ? (m * tasa).toFixed(2) : '';
      if (l.moneda === 'VES' && nuevaMoneda === 'USD') nuevoMonto = m > 0 ? (m / tasa).toFixed(2) : '';
      // Al cambiar de moneda hay que reelegir banco (los bancos se filtran por moneda): limpiar
      // banco y _cuentaId para no dejar una cuenta de la moneda anterior seleccionada.
      return { ...l, moneda: nuevaMoneda, banco: '', _cuentaId: null, monto: nuevoMonto };
    }));
  }

  // Conversión a USD: VES se divide por tasa efectiva (custom o la tasa Bs. por defecto); USD directo
  const tasaEfectiva = (l) => {
    if (l.moneda === 'VES') return (parseFloat(l.tasaCustom) > 0) ? parseFloat(l.tasaCustom) : tasaVES;
    return tasaUSD;
  };
  // A CENTAVOS: dividir bolívares por la tasa casi nunca da un número redondo
  // (45.402 / 756,7 = 59,99999999999999) y ese residuo dejaba la cuenta en 'parcial' con saldo
  // 0,00. Ver ssRound2/ssSaldada en supabase.js.
  const lineaToUSD = (l) => {
    const m = parseFloat(l.monto) || 0;
    return window.ssRound2(l.moneda === 'VES' ? m / tasaEfectiva(l) : m);
  };
  const totalPagoUSD = lineas.reduce((s, l) => s + lineaToUSD(l), 0);
  const restante = sumaSel - totalPagoUSD;
  // Qué se hace con lo que pagó de más. Por defecto queda A FAVOR del cliente (anticipo), que es
  // lo que casi siempre pasa: tiene otra nota pendiente y se le aplica. "Vuelto" —devolverlo en
  // efectivo— pasó a ser la excepción explícita. Decisión del usuario del 2026-08-07.
  const [destinoExcedente, setDestinoExcedente] = useState('anticipo'); // 'anticipo' | 'vuelto'

  // Banco requerido para métodos que no son efectivo
  const bancoRequerido = (metodo) => !metodosPagoUI().find(m => m.id === metodo)?.sin_banco;
  const [errores, setErrores] = useState({});
  function validar() {
    const errs = {};
    if (sel.length === 0) errs._facturas = 'Selecciona al menos una factura';
    lineas.forEach((l, i) => {
      const pre = `l${i}`;
      if (!(parseFloat(l.monto) > 0)) errs[`${pre}_monto`] = 'Ingresa el monto';
      if (bancoRequerido(l.metodo) && !l.banco.trim()) errs[`${pre}_banco`] = 'Selecciona el banco';
      // La referencia es el N° DE OPERACIÓN del banco y NUNCA bloquea (decisión del usuario,
      // 2026-08-11). Ya no se exigía en efectivo —que no tiene número que dar— y ahora tampoco en
      // transferencia: el número llega después (lo manda el cliente, lo imprime el punto más tarde)
      // y frenar el cobro por eso obliga a inventarlo. Un dato inventado en una columna de
      // conciliación es peor que uno vacío, porque el que lo lea después le va a creer.
      // Mismo criterio que el cobro del POS (`bancoRequerido` en pos.jsx).
    });
    setErrores(errs);
    return Object.keys(errs).length === 0;
  }
  const lineasValidas = lineas.every(l => (parseFloat(l.monto) || 0) > 0 && (!bancoRequerido(l.metodo) || l.banco.trim()));

  // Label descriptivo de la modalidad
  const modalidadInfo = {
    bcv:      { label:'Bolívares BCV',     color:'var(--warn)',    tasa:`Tasa BCV: ${SSData.tasa?.bcv}` },
    // Nota BCV: mismos bolívares, misma tasa BCV, pero sin cobertura — se nombra distinto para
    // que quien cobra sepa qué está mirando.
    bcv_fijo: { label:'Bolívares Nota BCV', color:'var(--warn)',   tasa:`Tasa BCV exacta: ${SSData.tasa?.bcv} · sin cobertura` },
    paralelo: { label:'Bolívares Paralelo',color:'var(--accent)',  tasa:`Tasa paralelo: ${SSData.tasa?.paralelo}` },
    divisas:  { label:'Divisas USD',       color:'var(--success)', tasa:'Pago en dólares o Bs. a tasa Paralelo' },
    vuelto:   { label:'Vuelto al cliente', color:'var(--warn)',    tasa:`Tasa vuelto: ${SSData.tasa?.vuelto || SSData.tasa?.paralelo} · editable por línea` },
  }[modalidadCxC] || { label: modalidadCxC, color:'var(--brand)', tasa:'' };

  const modBadge = (mod) => {
    const cfg = { divisas:{l:'💵 Divisas USD',c:'var(--success)'}, bcv:{l:'🏦 BCV',c:'var(--warn)'},
                  bcv_fijo:{l:'🏦 Nota BCV',c:'var(--warn)'}, paralelo:{l:'📊 Paralelo',c:'var(--accent)'} }[mod]
      || { l: mod || '—', c:'var(--text-muted)' };
    return <span style={{fontSize:10.5, fontWeight:600, padding:'2px 7px', borderRadius:99, background:cfg.c+'1a', color:cfg.c, whiteSpace:'nowrap'}}>{cfg.l}</span>;
  };

  // Reportado: se aplicaba un pago en dólares cuando la cuenta era en bolívares (o viceversa) — un
  // error de moneda/tasa se mandaba directo sin que nadie lo releyera primero. Ahora "Pagar"/
  // "Registrar" NO manda nada: valida y abre un resumen (`showConfirm`) con el detalle exacto de
  // cada línea (moneda, banco, tasa, equivalente en USD); solo al confirmar ESE popup se ejecuta
  // `ejecutarPago`, que es el guardado real (antes era todo el cuerpo de este `handleSave`).
  const [showConfirm, setShowConfirm] = useState(false);

  function handleSave() {
    if (!validar() || saving || comprobLoading) return;   // defensa extra: no guardar mientras el comprobante aún se procesa
    // CxP (pago a proveedor): no se puede registrar el pago si el banco no tiene saldo suficiente.
    // Se agrupa por cuenta (el saldo = Σ movimientos: incluye todos los movimientos registrados).
    if (esPagar) {
      const porBanco = {};
      lineas.forEach(l => {
        if (!l.banco) return;   // efectivo sin cuenta bancaria → no valida contra saldo
        const cuenta = (SSData.cuentasBancarias || []).find(b => b.banco === l.banco && b.moneda === l.moneda)
          || (SSData.cuentasBancarias || []).find(b => b.banco === l.banco);
        if (!cuenta) return;
        const monto = parseFloat(l.monto) || 0;
        if (!porBanco[cuenta.id]) porBanco[cuenta.id] = { cuenta, req: 0 };
        porBanco[cuenta.id].req += monto;
      });
      const faltantes = Object.values(porBanco).filter(({ cuenta, req }) => (req - (parseFloat(cuenta.saldo) || 0)) > 0.001);
      if (faltantes.length) {
        const fmtM = (c, v) => c.moneda === 'USD' ? `$${v.toFixed(2)}` : `Bs. ${v.toFixed(2)}`;
        const detalle = faltantes.map(({ cuenta, req }) => `• ${cuenta.banco}: disponible ${fmtM(cuenta, parseFloat(cuenta.saldo) || 0)}, requiere ${fmtM(cuenta, req)}`).join('\n');
        alert(`No se puede registrar el pago: saldo insuficiente en el banco.\n\n${detalle}\n\nRegistra los ingresos que falten o paga desde otra cuenta.`);
        return;
      }
    }
    setShowConfirm(true);
  }

  async function ejecutarPago() {
    setShowConfirm(false);
    setSaving(true);
    let montoRestante = totalPagoUSD;
    const pagosLines = [];
    // Build payment lines once — shared across all CxCs so IDs are unique
    const pagosNuevosBase = lineas.map(l => ({
      id: 'PAG-' + Date.now() + '-' + Math.floor(Math.random()*1000),
      fecha,
      metodo: l.metodo,
      banco:  l.banco,
      referencia: l.referencia,
      monto:  parseFloat(l.monto) || 0,
      moneda: l.moneda,
      monto_usd: lineaToUSD(l),
      tasa_usada: tasaEfectiva(l),
      modalidad_pago: isMixed ? 'mixto' : modalidadCxC,
      modo_pago_efectivo: isMixed ? (l.moneda === 'VES' ? 'paralelo' : 'usd') : (necesitaEleccion ? modoPago : modalidadCxC),
      notas:  l.notas,
      comprobante: comprobante || null,   // UN solo comprobante para toda la transacción (ver arriba)
    }));
    for (const deuda of selCxCs) {
      if (montoRestante <= 0) break;
      const saldo = deuda.monto - deuda.pagado;
      const aplicar = Math.min(saldo, montoRestante);
      if (aplicar <= 0) continue;
      montoRestante -= aplicar;
      const key = esPagar ? 'cxpId' : 'cxcId';
      pagosLines.push({ [key]: deuda.id, montoUsd: aplicar, pagosNuevos: pagosNuevosBase });
    }
    const results = esPagar
      ? (await window.registrarPagosCxP?.(pagosLines) || [])
      : (await window.registrarPagosCxC?.(pagosLines) || []);
    const hasError = results.some(r => r.error);
    if (hasError) {
      // registrarPagosCxC/CxP muta SSData línea por línea a medida que cada pago se confirma — un
      // fallo a mitad de lote puede dejar líneas previas ya aplicadas (saldo/banco actualizados).
      // Recargar igual para que esa parte real ya no quede stale, aunque el modal siga abierto.
      await window.refrescarFase2?.();
      setSaving(false);
      alert('Error al registrar algún pago. Verifica la conexión.');
      return;
    }

    // Solo en cobros: qué se hace con lo que pagó de más. En pagos no aplica.
    if (!esPagar) {
      const excedente = totalPagoUSD - sumaSel;
      if (excedente > 0.001) {
        const facturas = selCxCs.map(c => c.factura || c.id).join(', ');
        let exErr = null;
        if (destinoExcedente === 'vuelto' && window.crearVueltoCliente) {
          const { error } = await window.crearVueltoCliente({
            clienteId:    cliente.id,
            monto:        excedente,
            concepto:     `Vuelto por sobrepago en ${facturas}`,
            pagoOrigenId: pagosNuevosBase[0]?.id || null,
          });
          exErr = error;
          if (!error) window.logActivity?.({ modulo:'cxp', accion:'crear', entidad_label: cliente.nombre, detalles:{ tipo:'vuelto', monto: excedente } });
        } else if (window.crearAnticipo) {
          // SALDO A FAVOR. Se guarda SIEMPRE en USD: el excedente se calcula en dólares
          // (`totalPagoUSD - sumaSel`) y un anticipo en bolívares solo se puede aplicar a cobros
          // en bolívares — encerrarlo ahí sería peor que dejarlo disponible para todo.
          //
          // CRÍTICO — SIN `cuentaBancariaId`: la plata YA entró al banco con el movimiento de
          // ESTE cobro. Pasarlo haría que `crearAnticipo` cree un segundo ingreso y el saldo del
          // banco quedaría inflado por el excedente.
          const { error } = await window.crearAnticipo({
            clienteId:  cliente.id,
            monto:      excedente, montoUsd: excedente, moneda: 'USD', tasa: null,
            metodo:     pagosNuevosBase[0]?.metodo || null,
            banco:      null, cuentaBancariaId: null,
            fecha:      pagosNuevosBase[0]?.fecha || window.localDateStr(),
            referencia: pagosNuevosBase[0]?.referencia || null,
            notas:      `Saldo a favor por sobrepago en ${facturas}`,
          });
          exErr = error;
          if (!error) window.logActivity?.({ modulo:'cxc', accion:'crear', entidad_label: cliente.nombre, detalles:{ tipo:'saldo_a_favor', monto: excedente } });
        }
        if (exErr) {
          // El cobro en sí ya se registró bien; solo falló el destino del excedente. Se recarga
          // para reflejar lo que sí quedó, y se dice exactamente qué faltó.
          await window.refrescarFase2?.();
          setSaving(false);
          alert(`Cobro registrado, pero no se pudo dejar el excedente como ${destinoExcedente === 'vuelto' ? 'vuelto' : 'saldo a favor'}: ` +
                (exErr.message || JSON.stringify(exErr)));
          return;
        }
      }
      window.logActivity?.({ modulo:'cxc', accion:'editar', entidad_label: cliente.nombre, detalles:{ total_pagado: totalPagoUSD, facturas: sel, excedente: excedente > 0 ? excedente : 0 } });
    } else {
      window.logActivity?.({ modulo:'cxp', accion:'editar', entidad_label: cliente.nombre, detalles:{ total_pagado: totalPagoUSD, ids: sel } });
    }

    // El pago afecta bancos (movimientos_bancarios) y la cuenta (pagado/saldo) — recargar para que
    // ambos queden al día sin necesidad de refrescar la página. AccountsPage/BankPage escuchan los
    // eventos que loadAppData dispara y se re-renderizan solos en cuanto termina.
    await window.refrescarFase2?.();
    setSaving(false);
    onClose();
  }

  return (
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width:860, maxHeight:'90vh', display:'flex', flexDirection:'column'}}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--success-soft)',color:'var(--success)',display:'grid',placeItems:'center'}}>
            <Icon name="dollar" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">{esPagar ? 'Registrar pago' : 'Registrar cobro'}</h3>
            <div className="small">{cliente.nombre} · {esPagar ? 'Total a pagar' : 'Deuda total'} {fmt.usd(totalDeuda)}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        <div className="modal-body" style={{flex:1, overflowY:'auto'}}>

          {/* Saldo a favor: el cliente ya entregó plata como anticipo. Se SUGIERE, nunca se aplica
              solo — aplicarlo automáticamente sorprende a cobranza y es difícil de revertir.
              Este aviso decía "aplicalo desde Finanzas → Anticipos" y quedó viejo: el bloque para
              aplicarlo está en ESTE mismo modal, más abajo. Mandaba al usuario a otra pantalla
              justo cuando tenía el botón a un scroll de distancia — que es, casi seguro, el
              "no se puede elegir el anticipo al cobrar" que se reportó en la reunión. */}
          {!esPagar && (window.getSaldoAnticipos?.(cliente?.id) || 0) > 0.005 && (
            <div style={{padding:'10px 14px', borderRadius:8, border:'1.5px solid var(--success)', background:'var(--success-soft,#dcfce7)', marginBottom:16, display:'flex', alignItems:'center', gap:10}}>
              <Icon name="cash" size={16} style={{color:'var(--success)'}}/>
              <div>
                <div style={{fontWeight:600, fontSize:13, color:'var(--success)'}}>
                  Este cliente tiene {fmt.usd(window.getSaldoAnticipos(cliente.id))} a favor en anticipos
                </div>
                <div className="small muted">
                  {anticiposDisponibles.length > 0
                    ? 'Más abajo, en este mismo formulario, podés aplicarlo a la factura en vez de cobrarlo de nuevo.'
                    : 'Su saldo a favor entró en bolívares y quedó valuado a la tasa de ese día, así que solo puede saldar un cobro en bolívares. Para usarlo, cobrá en bolívares o aplicalo desde Finanzas → Anticipos.'}
                </div>
              </div>
            </div>
          )}

          {/* Banner modalidad de pago */}
          {isMixed ? (
            <div style={{padding:'10px 14px', borderRadius:8, border:'1.5px solid var(--accent)', background:'var(--accent-soft,#f0f9ff)', marginBottom:16}}>
              <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:8}}>
                <Icon name="dollar" size={15} style={{color:'var(--accent)'}}/>
                <div>
                  <div style={{fontWeight:600, fontSize:13, color:'var(--accent)'}}>Pago mixto — múltiples modalidades</div>
                  <div className="small muted">Las órdenes seleccionadas tienen modalidades distintas. Puedes pagar en USD o Bs. a tasa Paralelo.{diasCredito > 0 ? ` · Cliente con ${diasCredito} días de crédito` : ''}</div>
                </div>
              </div>
              <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                {selMods.map(mod => {
                  const subtotal = selCxCs.filter(d => (d.modalidad_pago || 'divisas') === mod).reduce((s,d) => s + (d.monto - d.pagado), 0);
                  return (
                    <div key={mod} style={{display:'flex', alignItems:'center', gap:6, padding:'4px 10px', borderRadius:6, background:'var(--bg-sunken)', border:'1px solid var(--border)', fontSize:12}}>
                      {modBadge(mod)}
                      <span className="muted">→</span>
                      <span style={{fontWeight:600}}>{fmt.usd(subtotal)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', borderRadius:8, border:`1.5px solid ${modalidadInfo.color}`, background: modalidadInfo.color + '18', marginBottom:16, flexWrap:'wrap', gap:8}}>
              <div style={{display:'flex', alignItems:'center', gap:10}}>
                <Icon name="dollar" size={15} style={{color: modalidadInfo.color}}/>
                <div>
                  <div style={{fontWeight:600, fontSize:13, color: modalidadInfo.color}}>
                    {esCompraProv ? 'Cuenta por pagar' : `${esVuelto ? 'Modalidad de pago' : 'Modalidad de la factura'}: ${modalidadInfo.label}`}
                  </div>
                  <div className="small muted">
                    {esCompraProv
                      ? `Pago en USD o Bs. a tasa vuelto (Bs. ${tasaVuelto})${deudas[0]?.moneda === 'VES' ? ' · registrada en Bs.' : ''}`
                      : modalidadInfo.tasa}
                    {diasCredito > 0 ? ` · Cliente con ${diasCredito} días de crédito` : ''}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Documentos a aplicar */}
          <div style={{display:'flex', alignItems:'center', gap:12}}>
            <div className="form-section-title" style={{margin:0}}>{esPagar ? 'Documentos a pagar' : 'Facturas a aplicar'}</div>
            {errores._facturas && <span style={{color:'var(--danger)', fontSize:12}}>{errores._facturas}</span>}
          </div>
          {deudas.length === 0 ? (
            <div className="empty">{esPagar ? 'No hay pagos pendientes.' : 'Este cliente no tiene deudas activas.'}</div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr>
                  <th style={{width:36}}></th>
                  <th>{esPagar ? 'Documento' : 'Factura'}</th>
                  <th>Modalidad</th>
                  <th>Vence</th>
                  <th>Estado</th>
                  <th className="num">Monto</th>
                  <th className="num">Pagado</th>
                  <th className="num">Saldo</th>
                </tr></thead>
                <tbody>
                  {deudas.map(d => {
                    const saldo = d.monto - d.pagado;
                    const on = sel.includes(d.id);
                    const modD = d.modalidad_pago || 'divisas';
                    // CxC/CxP: deshabilitar filas de modalidad distinta cuando ya hay alguna seleccionada
                    const bloqueada = aplicaLockModalidad && sel.length > 0 && !on && modD !== modalidadActiva;
                    const handleClick = () => { if (!bloqueada) toggle(d.id); };
                    return (
                      <tr key={d.id} onClick={handleClick} style={{
                        cursor: bloqueada ? 'not-allowed' : 'pointer',
                        background: on ? 'var(--brand-soft)' : '',
                        opacity: bloqueada ? 0.45 : 1,
                      }} title={bloqueada ? 'Modalidad distinta — no se puede agrupar con la selección actual' : ''}>
                        <td><input type="checkbox" checked={on} disabled={bloqueada} onChange={handleClick}/></td>
                        <td className="mono-cell">{d.factura || d.id}{d.tipo === 'vuelto' && <span className="chip amber" style={{fontSize:10, marginLeft:6}}>Vuelto</span>}</td>
                        <td>{modBadge(d.modalidad_pago || 'divisas')}</td>
                        <td className="muted">{fmt.date(d.vence)} {d.dias>0&&<span className="chip red" style={{marginLeft:4}}>+{d.dias}d</span>}</td>
                        <td><StatusChip estado={d.estado}/></td>
                        <td className="num">{fmt.usd(d.monto)}</td>
                        <td className="num muted">{fmt.usd(d.pagado)}</td>
                        <td className="num strong-num">{fmt.usd(saldo)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ¿Cómo paga hoy? — moneda del pago (movido aquí para que quede justo antes de elegir el
              banco). Filtra los bancos disponibles a la moneda elegida. */}
          {necesitaEleccion && (
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginTop:18, padding:'12px 14px', borderRadius:8, border:'1px solid var(--border)', background:'var(--bg-sunken)', flexWrap:'wrap'}}>
              <div>
                <div style={{fontWeight:600, fontSize:13}}>{esCompraProv ? '¿Cómo paga?' : '¿Cómo paga hoy?'}</div>
                <div className="small muted">Define la moneda del pago. Abajo solo aparecerán los bancos de esa moneda.</div>
              </div>
              <div className="seg">
                <button className={modoPago === 'usd' ? 'on' : ''} onClick={() => cambiarModoPago('usd')}>
                  <Icon name="dollar" size={12}/> Dólares USD
                </button>
                <button className={modoPago === 'paralelo' ? 'on' : ''} onClick={() => cambiarModoPago('paralelo')}>
                  {esCompraProv ? `Bs. (${tasaVuelto})` : `Bs. Paralelo (${SSData.tasa?.paralelo})`}
                </button>
              </div>
            </div>
          )}

          {/* ── Anticipos del cliente ────────────────────────────────────────────────────────
              Si el cliente ya dejó dinero adelantado, lo primero es usarlo: cobrarle otra vez sin
              descontarlo es cobrar dos veces. Solo se ofrecen los anticipos en la MISMA moneda que
              el pago que se está registrando (un anticipo en bolívares no salda un cobro en dólares:
              son dos monedas distintas y la tasa las separa). Aplicar baja la deuda al instante, así
              que después solo se registra lo que falte cobrar de verdad. */}
          {!esPagar && anticiposDisponibles.length > 0 && (
            <div style={{marginTop:18, border:'1px solid var(--brand)', borderRadius:8, overflow:'hidden'}}>
              <div style={{padding:'9px 12px', background:'var(--brand-soft)', display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid var(--brand)'}}>
                <Icon name="dollar" size={13} style={{color:'var(--brand)'}}/>
                <span style={{fontWeight:600, fontSize:12.5, color:'var(--brand)'}}>
                  Saldo a favor de {cliente?.nombre || 'este cliente'}
                </span>
                <span className="small" style={{marginLeft:'auto', color:'var(--brand)'}}>
                  {fmt.usd(anticiposDisponibles.reduce((s,a)=>s+(parseFloat(a.saldo_usd)||0),0))} disponibles
                </span>
              </div>
              <div style={{padding:'10px 12px', display:'flex', flexDirection:'column', gap:8}}>
                {selCxCs.length === 0 && <div className="small muted">Selecciona arriba la factura a la que se aplica.</div>}
                {selCxCs.length > 1 && (
                  <div>
                    <label className="form-label">Aplicar a</label>
                    <select className="select" style={{width:'100%'}} value={antTarget || ''} onChange={e => setAntTarget(e.target.value)}>
                      {selCxCs.map(d => (
                        <option key={d.id} value={d.factura || d.id}>{d.factura || d.id} — debe {fmt.usd(d.monto - d.pagado)}</option>
                      ))}
                    </select>
                  </div>
                )}
                {anticiposDisponibles.map(a => {
                  const facturaDest = selCxCs.length > 1 ? (antTarget || (selCxCs[0].factura || selCxCs[0].id)) : (selCxCs[0]?.factura || selCxCs[0]?.id);
                  const destino = selCxCs.find(d => (d.factura || d.id) === facturaDest) || selCxCs[0];
                  const restaDest = destino ? (destino.monto - destino.pagado) : 0;
                  // Cuánto se aplica: por defecto el tope, pero se puede teclear menos y el resto
                  // sigue a favor del cliente. Antes se aplicaba SIEMPRE el tope, así que un saldo
                  // de $70 contra una nota de $80 se iba entero; no había forma de usar $35 y
                  // dejarle los otros $35. Es la misma pregunta que Amanda hizo en la llamada.
                  const topeAnt   = Math.round(Math.min(parseFloat(a.saldo_usd) || 0, restaDest) * 100) / 100;
                  const tecleadoA = vueltoMonto[a.pago_id];
                  const usdAplicable = (tecleadoA === '' || tecleadoA == null || isNaN(parseFloat(tecleadoA)))
                                       ? topeAnt : Math.min(Math.max(parseFloat(tecleadoA), 0), topeAnt);
                  return (
                    <div key={a.pago_id} style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
                                                 padding:'8px 10px', border:'1px solid var(--border)', borderRadius:8, background:'var(--bg-elev)'}}>
                      <div style={{flex:1, minWidth:170}}>
                        <div style={{fontSize:12.5, fontWeight:600}}>
                          {(a.moneda || 'USD') === 'VES' ? fmt.bs(antVista(a)) : fmt.usd(parseFloat(a.saldo_usd) || 0)}
                          {(a.moneda || 'USD') === 'VES' && <span className="muted" style={{fontWeight:400}}> ({fmt.usd(parseFloat(a.saldo_usd) || 0)} @ {a.tasa})</span>}
                        </div>
                        <div className="small muted" style={{fontSize:11}}>
                          {fmt.date(a.fecha)}{a.banco ? ' · ' + a.banco : ''}{a.referencia ? ' · ref ' + a.referencia : ''}
                        </div>
                      </div>
                      <div style={{display:'flex', alignItems:'center', gap:6}}>
                        <span className="small muted">Aplicar</span>
                        <input className="input ss-credito-monto" type="number" step="0.01" min="0" max={topeAnt}
                               style={{width:96, textAlign:'right'}} placeholder={topeAnt.toFixed(2)}
                               value={tecleadoA ?? ''}
                               onChange={e => setVueltoMonto(p => ({ ...p, [a.pago_id]: e.target.value }))}/>
                      </div>
                      <button className="btn sm primary" disabled={!destino || usdAplicable <= 0.005 || antAplicando === a.pago_id}
                              onClick={() => aplicarAnticipoAlCobro(a, destino, usdAplicable)}
                              title={!destino ? 'Elige la factura primero' : `Aplicar ${fmt.usd(usdAplicable)} a ${facturaDest}`}>
                        {antAplicando === a.pago_id ? 'Aplicando…' : `Aplicar ${(a.moneda || 'USD') === 'VES' ? fmt.bs(usdAplicable * (parseFloat(a.tasa) || 0)) : fmt.usd(usdAplicable)}`}
                      </button>
                    </div>
                  );
                })}
                {antError && <div style={{color:'var(--danger)', fontSize:12.5}}>{antError}</div>}
                {antHecho && <div style={{color:'var(--success)', fontSize:12.5}}>{antHecho}</div>}
              </div>
            </div>
          )}

          {/* ── VUELTOS pendientes del cliente ────────────────────────────────────────────────
              Plata que ya es del cliente porque pagó de más. Antes solo se podía devolver en
              efectivo; acá se puede descontar de esta nota. Va en su propio bloque y en verde
              porque no es lo mismo que un anticipo: el cliente puede seguir queriendo su vuelto,
              así que usarlo es una decisión, no un automatismo. */}
          {!esPagar && vueltosDisponibles.length > 0 && (
            <div style={{marginTop:14, border:'1px solid var(--success)', borderRadius:8, overflow:'hidden'}}>
              <div style={{padding:'9px 12px', background:'var(--success-soft,#dcfce7)', display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid var(--success)', flexWrap:'wrap'}}>
                <Icon name="cash" size={13} style={{color:'var(--success)'}}/>
                <span style={{fontWeight:600, fontSize:12.5, color:'var(--success)'}}>
                  {cliente?.nombre || 'Este cliente'} tiene vuelto pendiente
                </span>
                <span className="small" style={{marginLeft:'auto', color:'var(--success)'}}>
                  {fmt.usd(vueltosDisponibles.reduce((s,v)=>s+saldoVuelto(v), 0))} a favor
                </span>
              </div>
              <div style={{padding:'10px 12px', display:'flex', flexDirection:'column', gap:8}}>
                <div className="small muted" style={{fontSize:11.5}}>
                  Pagó de más y ese excedente quedó para devolvérselo. En vez de devolverlo, se puede
                  descontar de esta nota. Lo que no se aplique sigue como vuelto.
                </div>
                {selCxCs.length === 0 && <div className="small muted">Selecciona arriba la factura a la que se aplica.</div>}
                {vueltosDisponibles.map(v => {
                  const facturaDest = selCxCs.length > 1 ? (antTarget || (selCxCs[0].factura || selCxCs[0].id)) : (selCxCs[0]?.factura || selCxCs[0]?.id);
                  const destino   = selCxCs.find(d => (d.factura || d.id) === facturaDest) || selCxCs[0];
                  const restaDest = destino ? (destino.monto - destino.pagado) : 0;
                  const tope      = Math.round(Math.min(saldoVuelto(v), restaDest) * 100) / 100;
                  const tecleado  = vueltoMonto[v.id];
                  // El tope manda: aplicar más que el saldo del vuelto sería inventar crédito, y
                  // más que la deuda dejaría la nota sobrepagada por el mismo camino que originó
                  // este vuelto.
                  const aplica    = (tecleado === '' || tecleado == null || isNaN(parseFloat(tecleado)))
                                    ? tope : Math.min(Math.max(parseFloat(tecleado), 0), tope);
                  return (
                    <div key={v.id} style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
                                            padding:'8px 10px', border:'1px solid var(--border)', borderRadius:8, background:'var(--bg-elev)'}}>
                      <div style={{flex:1, minWidth:170}}>
                        <div style={{fontSize:12.5, fontWeight:600}}>{fmt.usd(saldoVuelto(v))}</div>
                        <div className="small muted" style={{fontSize:11}}>
                          {v.concepto || 'Vuelto por sobrepago'}
                        </div>
                      </div>
                      <div style={{display:'flex', alignItems:'center', gap:6}}>
                        <span className="small muted">Aplicar</span>
                        {/* `ss-credito-monto` lo distingue del monto del PAGO: los dos son
                            `input[type=number]` y este va más arriba en el DOM. */}
                        <input className="input ss-credito-monto" type="number" step="0.01" min="0" max={tope}
                               style={{width:96, textAlign:'right'}}
                               placeholder={tope.toFixed(2)}
                               value={tecleado ?? ''}
                               onChange={e => setVueltoMonto(p => ({ ...p, [v.id]: e.target.value }))}/>
                      </div>
                      <button className="btn sm primary" disabled={!destino || aplica <= 0.005 || antAplicando === v.id}
                              onClick={() => aplicarVueltoAlCobro(v, destino, aplica)}
                              title={!destino ? 'Elige la factura primero' : `Descontar ${fmt.usd(aplica)} de ${facturaDest}`}>
                        {antAplicando === v.id ? 'Aplicando…' : `Usar ${fmt.usd(aplica)}`}
                      </button>
                    </div>
                  );
                })}
                {antError && <div style={{color:'var(--danger)', fontSize:12.5}}>{antError}</div>}
                {antHecho && <div style={{color:'var(--success)', fontSize:12.5}}>{antHecho}</div>}
              </div>
            </div>
          )}

          {/* ── Depósitos SIN IDENTIFICAR ─────────────────────────────────────────────────────
              Plata que entró al banco sin que se supiera de quién era. Antes había que ir al
              módulo de Anticipos, buscar el depósito, asignarle el cliente y volver acá; ahora se
              hace de una. Va en su PROPIO bloque y en ámbar, no mezclado con los del cliente:
              adjudicarle un depósito anónimo a alguien es una decisión de cobranza, no un atajo. */}
          {!esPagar && anticiposFlotantes.length > 0 && (
            <div style={{marginTop:14, border:'1px solid var(--warn)', borderRadius:8, overflow:'hidden'}}>
              <div style={{padding:'9px 12px', background:'var(--warn-soft,#fef3c7)', display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid var(--warn)'}}>
                <Icon name="alert" size={13} style={{color:'#92400e'}}/>
                <span style={{fontWeight:600, fontSize:12.5, color:'#92400e'}}>
                  Depósitos sin identificar
                </span>
                <span className="small" style={{marginLeft:'auto', color:'#92400e'}}>
                  {anticiposFlotantes.length} · {fmt.usd(anticiposFlotantes.reduce((s,a)=>s+(parseFloat(a.saldo_usd)||0),0))}
                </span>
              </div>
              <div style={{padding:'10px 12px', display:'flex', flexDirection:'column', gap:8}}>
                <div className="small" style={{fontSize:11.5, color:'#92400e'}}>
                  Si alguno es de <strong>{cliente?.nombre || 'este cliente'}</strong>, al aplicarlo
                  queda a su nombre y se descuenta de esta cuenta.
                </div>
                {selCxCs.length === 0 && <div className="small muted">Selecciona arriba la factura a la que se aplica.</div>}
                {anticiposFlotantes.map(a => {
                  const facturaDest = selCxCs.length > 1 ? (antTarget || (selCxCs[0].factura || selCxCs[0].id)) : (selCxCs[0]?.factura || selCxCs[0]?.id);
                  const destino = selCxCs.find(d => (d.factura || d.id) === facturaDest) || selCxCs[0];
                  const restaDest = destino ? (destino.monto - destino.pagado) : 0;
                  const usdAplicable = Math.min(parseFloat(a.saldo_usd) || 0, restaDest);
                  return (
                    <div key={a.pago_id} style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
                                                 padding:'8px 10px', border:'1px solid var(--border)', borderRadius:8, background:'var(--bg-elev)'}}>
                      <div style={{flex:1, minWidth:170}}>
                        <div style={{fontSize:12.5, fontWeight:600}}>
                          {(a.moneda || 'USD') === 'VES' ? fmt.bs(antVista(a)) : fmt.usd(parseFloat(a.saldo_usd) || 0)}
                          {(a.moneda || 'USD') === 'VES' && <span className="muted" style={{fontWeight:400}}> ({fmt.usd(parseFloat(a.saldo_usd) || 0)} @ {a.tasa})</span>}
                        </div>
                        <div className="small muted" style={{fontSize:11}}>
                          {/* La REFERENCIA es con lo que se reconoce el depósito en el extracto. */}
                          {fmt.date(a.fecha)}{a.banco ? ' · ' + a.banco : ''}{a.referencia ? ' · ref ' + a.referencia : ' · sin referencia'}
                        </div>
                      </div>
                      <button className="btn sm" style={{background:'#d97706', borderColor:'#d97706', color:'#fff'}}
                              disabled={!destino || usdAplicable <= 0.005 || antAplicando === a.pago_id || !cliente?.id}
                              onClick={() => aplicarFlotante(a, destino, usdAplicable)}
                              title={!destino ? 'Elige la factura primero'
                                     : `Asignar a ${cliente?.nombre || 'este cliente'} y aplicar ${fmt.usd(usdAplicable)} a ${facturaDest}`}>
                        {antAplicando === a.pago_id ? 'Aplicando…' : 'Es de este cliente — aplicar'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Retención ────────────────────────────────────────────────────────────────────
              El cliente retiene parte del IVA y paga menos: esa diferencia NO se va a cobrar
              nunca (la entera al SENIAT). Se aplica acá para que la cuenta cierre y lo retenido
              quede en el módulo Retenciones para la declaración. Ver migracion-odoo/40. */}
          {selCxCs.length === 1 && (selCxCs[0].monto - selCxCs[0].pagado) > 0.005 && (
            <div style={{marginTop:14, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
                         padding:'10px 12px', border:'1px dashed var(--border)', borderRadius:8}}>
              <div style={{flex:1, minWidth:200}}>
                <div style={{fontSize:12.5, fontWeight:600}}>¿Le retuvieron IVA o ISLR?</div>
                <div className="small muted">
                  Lo retenido baja la deuda y se registra aparte: no es plata que vaya a entrar al banco.
                </div>
              </div>
              <button className="btn secondary sm" disabled={retCargando}
                      onClick={async () => {
                        // El chunk de retenciones es lazy (ruta /retenciones): se pide al abrir.
                        if (!window.RetencionModal && window.__loadChunk) {
                          setRetCargando(true);
                          try { await window.__loadChunk('retenciones'); } catch (e) {}
                          setRetCargando(false);
                        }
                        if (!window.RetencionModal) { alert('No se pudo cargar el módulo de retenciones.'); return; }
                        setRetCuenta(selCxCs[0]);
                      }}>
                {retCargando ? 'Abriendo…' : 'Aplicar retención'}
              </button>
            </div>
          )}

          {/* Fecha global */}
          <div style={{display:'flex', alignItems:'center', gap:12, marginTop:20, marginBottom:4}}>
            <div className="form-section-title" style={{margin:0,flex:1}}>Formas de pago</div>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <label className="form-label" style={{margin:0, whiteSpace:'nowrap'}}>Fecha:</label>
              <input className="input" type="date" value={fecha} style={{width:150}}
                     onChange={e => {
                       setFecha(e.target.value);
                       // Mover la fecha a mano deshace la elección: si no, quedaría un pago fechado
                       // en un día y valuado a la tasa de otro. Las tasas ya escritas en las líneas
                       // se dejan — son editables y el usuario puede querer conservarlas.
                       if (diaElegido && e.target.value !== diaElegido.dia) {
                         setDiaElegido(null); setUsarTasaPrevia(false);
                       }
                     }}/>
            </div>
          </div>

          {/* ── El pago entró un día anterior ──────────────────────────────────────────
              Solo con líneas en bolívares: en dólares no hay tasa que elegir. Rellena la tasa de
              cada línea en Bs.; después se puede corregir línea por línea. */}
          {lineas.some(l => l.moneda === 'VES') && window.SelectorTasaPrevia && (
            <div style={{marginBottom:8}}>
              <window.SelectorTasaPrevia
                usar={usarTasaPrevia} onUsar={toggleTasaPrevia}
                diaElegido={diaElegido} onElegir={elegirDiaPrevio}
                tasaDelDia={tasaDiaSegunModalidad} nombreTasa={nombreTasaPrevia}
                tasaHoy={tasaVES} saldoUsd={sumaSel}
                nota={<>Para cuando el cliente pagó antes y el negocio se entera después. Cambia la
                  fecha del cobro y <strong>escribe la tasa</strong> en las líneas en bolívares;
                  después se puede corregir cada una.</>}/>
            </div>
          )}

          {/* Líneas de pago */}
          <div style={{display:'flex', flexDirection:'column', gap:10, marginTop:8}}>
            {lineas.map((l, idx) => {
              // El BANCO va primero y determina la moneda y los métodos.
              const cuentaSel = (SSData.cuentasBancarias || []).find(b => b.id === l._cuentaId)
                || (SSData.cuentasBancarias || []).find(b => b.banco === l.banco && b.moneda === l.moneda);
              const bancosAll  = (SSData.cuentasBancarias || []);
              // TODAS las cuentas, en TODAS las notas. Antes se filtraban a la moneda que fijaba el
              // toggle "¿Cómo paga hoy?", así que un cobro no podía tener una línea en dólares y
              // otra en bolívares salvo en el caso mixto. Y así es como se cobra acá: Amanda,
              // 2026-08-11, "casi no hay billetes de un dólar ni monedas, así que todo lo que no da
              // una cifra redonda se paga en bolívares; la cuenta nunca da redonda". Jorge: "en
              // todas las notas hay que tener el pago mixto en todas".
              // La moneda de la línea NO se pierde: la fija la cuenta elegida (ver `updLinea`,
              // campo 'banco', que además convierte el monto a la tasa de la línea).
              const bancosDisp = bancosAll;
              const metodosBanco = (cuentaSel?.metodos_pago && cuentaSel.metodos_pago.length) ? cuentaSel.metodos_pago : null;
              const metodosDisp = metodosPagoUI().filter(m => {
                if (!m.monedas.includes(l.moneda)) return false;                      // compatible con la moneda de la línea
                if (metodosBanco && !m.sin_banco) return metodosBanco.includes(m.id); // ofrecido por el banco (efectivo es sin banco → siempre)
                return true;
              });
              const errBanco = errores[`l${idx}_banco`];
              return (
              <div key={l._k} style={{border:'1px solid var(--border)', borderRadius:10, padding:'14px 16px', background:'var(--bg-card)'}}>
                <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10}}>
                  <span style={{fontWeight:600, fontSize:13}}>Pago #{idx+1}</span>
                  {lineas.length > 1 && (
                    <button className="icon-btn" onClick={()=>removeLinea(l._k)} style={{color:'var(--danger)'}}><Icon name="x" size={14}/></button>
                  )}
                </div>
                {/* 1) BANCO primero — la moneda ya la fijó el toggle; solo se listan bancos de esa moneda */}
                <div style={{marginBottom:12}}>
                  <label className="form-label">Banco / cuenta ({l.moneda === 'VES' ? 'Bs.' : 'USD'}){bancoRequerido(l.metodo) ? ' *' : ''}</label>
                  {bancosAll.length === 0 && !window.__ssExtrasReady ? (
                    // Las cuentas bancarias llegan en Fase 2. Si todavía no están, NO se ofrece
                    // un campo libre: un pago con el banco tecleado se guarda sin
                    // `cuenta_bancaria_id` y su movimiento no aparece en ninguna cuenta — plata
                    // registrada que no suma en Bancos. Se espera y listo.
                    <div className="small muted" style={{display:'flex',alignItems:'center',gap:7,padding:'8px 10px',
                                                         background:'var(--bg-sunken)',borderRadius:8}}>
                      <span className="ss-busy-spin"/>Cargando las cuentas bancarias…
                    </div>
                  ) : bancosAll.length === 0 ? (
                    <input className="input" value={l.banco} onChange={e=>updLinea(l._k,'banco',e.target.value)} placeholder="Nombre del banco" style={{borderColor: errBanco?'var(--danger)':undefined}}/>
                  ) : (
                    <select className="select" value={l._cuentaId || ''} onChange={e=>updLinea(l._k,'banco',e.target.value)} style={{width:'100%', borderColor: errBanco?'var(--danger)':undefined}}>
                      <option value="">— Seleccionar banco —</option>
                      {bancosDisp.map(b=>(
                        <option key={b.id} value={b.id}>{b.banco} · {b.moneda}{b.cuenta ? ' — ' + b.cuenta.slice(-4) : ''}</option>
                      ))}
                    </select>
                  )}
                  {/* La cuenta elegida define la moneda de ESTA línea: se avisa cuando difiere de
                      la del resto del cobro, porque es justo lo que se quiere poder hacer pero
                      conviene verlo. */}
                  {lineas.length > 1 && lineas.some(x => x.moneda !== l.moneda) && (
                    <div className="small mt-1" style={{color:'var(--brand)'}}>
                      Esta parte del cobro va en {l.moneda === 'VES' ? 'bolívares' : 'dólares'}.
                    </div>
                  )}
                  {errBanco && <div className="small mt-1" style={{color:'var(--danger)'}}>{errBanco}</div>}
                </div>
                {/* 2) Método — filtrado por el banco elegido y su moneda */}
                <div style={{marginBottom:12}}>
                  <label className="form-label">Método de pago</label>
                  <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                    {metodosDisp.map(m => (
                      <div key={m.id} onClick={()=>updLinea(l._k,'metodo',m.id)} style={{
                        display:'flex', alignItems:'center', gap:6, padding:'6px 12px',
                        border:`1.5px solid ${l.metodo===m.id?'var(--brand)':'var(--border)'}`,
                        borderRadius:8, cursor:'pointer', fontSize:12, fontWeight: l.metodo===m.id?600:400,
                        background: l.metodo===m.id?'var(--brand-soft)':'var(--bg-sunken)',
                        color: l.metodo===m.id?'var(--brand)':'var(--text-muted)',
                      }}>
                        <Icon name={m.icon} size={13}/>{m.l}
                      </div>
                    ))}
                  </div>
                </div>
                {/* 3) Moneda (la fija el banco) + Monto + Referencia */}
                <div className="grid-3" style={{display:'grid', gridTemplateColumns:'auto 1fr 1fr', gap:10, alignItems:'start'}}>
                  <div>
                    <label className="form-label">Moneda</label>
                    <div className="seg" style={{width:'100%'}}><button className="on" disabled>{l.moneda === 'VES' ? 'Bs. VES' : '$ USD'}</button></div>
                  </div>
                  <div>
                    <label className="form-label">Monto {l.moneda === 'VES' ? '(Bs.)' : '($)'} *</label>
                    <div style={{display:'flex', alignItems:'stretch'}}>
                      <span style={{
                        padding:'0 10px', display:'flex', alignItems:'center',
                        background: l.moneda === 'VES' ? '#fef3c7' : '#dcfce7',
                        color: l.moneda === 'VES' ? '#b45309' : '#16a34a',
                        border:`1px solid ${errores[`l${idx}_monto`]?'var(--danger)':'var(--border)'}`, borderRight:'none',
                        borderRadius:'var(--radius,6px) 0 0 var(--radius,6px)',
                        fontWeight:700, fontSize:12, whiteSpace:'nowrap',
                      }}>
                        {l.moneda === 'VES' ? 'Bs.' : '$'}
                      </span>
                      <input className="input mono" type="number" min="0" step="0.01" value={l.monto}
                        onChange={e=>updLinea(l._k,'monto',e.target.value)} placeholder="0.00"
                        style={{borderRadius:'0 var(--radius,6px) var(--radius,6px) 0', flex:1, borderColor: errores[`l${idx}_monto`]?'var(--danger)':undefined}}/>
                    </div>
                    {errores[`l${idx}_monto`] && <div className="small mt-1" style={{color:'var(--danger)'}}>{errores[`l${idx}_monto`]}</div>}
                    {!errores[`l${idx}_monto`] && l.moneda==='VES' && (
                      <div style={{display:'flex', alignItems:'center', gap:6, marginTop:6}}>
                        <span className="small muted" style={{whiteSpace:'nowrap'}}>Tasa:</span>
                        <input
                          className="input mono"
                          type="number" min="1" step="0.01"
                          value={l.tasaCustom !== '' ? l.tasaCustom : tasaVES}
                          onChange={e => updLinea(l._k, 'tasaCustom', e.target.value)}
                          style={{width:100, padding:'3px 8px', fontSize:12}}
                          placeholder={String(tasaVES)}
                        />
                        {l.monto && <span className="small muted">≈ {fmt.usd(lineaToUSD(l))} USD</span>}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="form-label">
                      Referencia <span className="muted" style={{fontSize:11, fontWeight:400}}>(opcional)</span>
                    </label>
                    <input className="input mono" value={l.referencia} onChange={e=>updLinea(l._k,'referencia',e.target.value)}
                      placeholder={bancoRequerido(l.metodo) ? 'N° de operación — se puede cargar después' : 'El efectivo no tiene N° de operación'}
                      style={{borderColor: errores[`l${idx}_ref`]?'var(--danger)':undefined}}/>
                    {errores[`l${idx}_ref`] && <div className="small mt-1" style={{color:'var(--danger)'}}>{errores[`l${idx}_ref`]}</div>}
                  </div>
                </div>
                <div style={{marginTop:8}}>
                  <label className="form-label">Notas</label>
                  <input className="input" value={l.notas} onChange={e=>updLinea(l._k,'notas',e.target.value)} placeholder="Observaciones opcionales"/>
                </div>
              </div>
              );
            })}
          </div>
          <button className="btn ghost sm" onClick={addLinea} style={{marginTop:8}}>
            <Icon name="plus" size={13}/>Agregar otra forma de pago
          </button>

          {/* Comprobante de pago — UN solo campo para toda la transacción (solo cobros) */}
          {!esPagar && (
            <div style={{marginTop:12}}>
              <label className="form-label">Comprobante de pago (opcional)</label>
              {comprobante ? (
                <div style={{display:'flex', alignItems:'center', gap:10}}>
                  <img src={comprobante} alt="Comprobante" style={{width:56, height:56, objectFit:'cover', borderRadius:8, border:'1px solid var(--border)', cursor:'pointer'}}
                    onClick={() => window.open(comprobante, '_blank')}/>
                  <button type="button" className="btn ghost sm" onClick={() => setComprobante('')}>
                    <Icon name="trash" size={13}/>Quitar
                  </button>
                </div>
              ) : (
                <label className="btn secondary sm" style={{display:'inline-flex', cursor: comprobLoading ? 'wait' : 'pointer'}}>
                  <Icon name="upload" size={13}/>{comprobLoading ? 'Procesando…' : 'Subir foto'}
                  <input type="file" accept="image/*" capture="environment" style={{display:'none'}}
                    disabled={comprobLoading} onChange={e => { const f = e.target.files?.[0]; e.target.value=''; handleComprobante(f); }}/>
                </label>
              )}
              {comprobError && <div className="small mt-1" style={{color:'var(--danger)'}}>{comprobError}</div>}
            </div>
          )}

          {/* Resumen */}
          <div className="card mt-4" style={{padding:14, background: restante < -0.01 ? '#fef3c7' : restante <= 0.01 ? 'var(--success-soft,#dcfce7)' : 'var(--bg-sunken)'}}>
            <div style={{display:'flex', gap:24, flexWrap:'wrap', alignItems:'center', justifyContent:'space-between'}}>
              <div><div className="small muted">Saldo seleccionado</div><div style={{fontSize:15,fontWeight:600}}>{fmt.usd(sumaSel)}</div></div>
              <div style={{color:'var(--text-muted)',fontSize:20}}>−</div>
              <div><div className="small muted">Total pagos (USD)</div><div style={{fontSize:15,fontWeight:600,color:'var(--brand)'}}>{fmt.usd(totalPagoUSD)}</div></div>
              <div style={{color:'var(--text-muted)',fontSize:20}}>=</div>
              <div style={{textAlign:'right'}}>
                <div className="small muted">{restante>0.01?'Quedará pendiente':restante<-0.01?'Pago en exceso':'Cancelación total ✓'}</div>
                <div style={{fontSize:16,fontWeight:700,color:restante>0.01?'var(--warn)':restante<-0.01?'var(--danger)':'var(--success)'}}>
                  {fmt.usd(Math.abs(restante))}
                </div>
              </div>
            </div>
            {isMixed && selMods.length > 1 && (
              <div style={{marginTop:10, padding:'8px 12px', borderRadius:6, background:'var(--bg-sunken)', border:'1px solid var(--border)', fontSize:12}}>
                <div className="small muted" style={{marginBottom:6}}>Desglose por modalidad:</div>
                <div style={{display:'flex', gap:12, flexWrap:'wrap'}}>
                  {selMods.map(mod => {
                    const sub = selCxCs.filter(d => (d.modalidad_pago || 'divisas') === mod).reduce((s,d) => s + (d.monto - d.pagado), 0);
                    return (
                      <div key={mod} style={{display:'flex', alignItems:'center', gap:6}}>
                        {modBadge(mod)}
                        <span style={{fontWeight:600}}>{fmt.usd(sub)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* ── Qué se hace con el excedente ─────────────────────────────────────────────
                Antes se registraba SIEMPRE como vuelto (una deuda al cliente, pagadera en
                efectivo) y no había forma de aplicarlo a otra nota del mismo cliente. Decisión
                del usuario (2026-08-07): *"que una sea anticipo del cliente y el vuelto sea la
                opción de devolver en efectivo"*. El default es dejarlo a favor.
                NO puede ser las dos cosas: sería contar la misma plata dos veces. */}
            {!esPagar && restante < -0.01 && (
              <div style={{marginTop:10, padding:'10px 12px', background:'#fef3c7', border:'1px solid var(--warn)', borderRadius:6, fontSize:12}}>
                <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8}}>
                  <Icon name="info" size={14} style={{color:'var(--warn)'}}/>
                  <strong style={{color:'var(--warn)'}}>Pagó {fmt.usd(Math.abs(restante))} de más</strong>
                </div>
                <div className="seg" style={{marginBottom:6}}>
                  <button className={destinoExcedente === 'anticipo' ? 'on' : ''}
                          onClick={() => setDestinoExcedente('anticipo')}>
                    Dejar a favor del cliente
                  </button>
                  <button className={destinoExcedente === 'vuelto' ? 'on' : ''}
                          onClick={() => setDestinoExcedente('vuelto')}>
                    Devolver en efectivo
                  </button>
                </div>
                <div className="small muted">
                  {destinoExcedente === 'anticipo'
                    ? 'Queda como saldo a favor y aparece al cobrarle otra nota, para aplicarlo con un clic.'
                    : `Queda como vuelto pendiente: una deuda del negocio con el cliente, a tasa Bs. ${SSData.tasa?.vuelto || SSData.tasa?.paralelo}/USD.`}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" disabled={saving || comprobLoading} onClick={handleSave} title={comprobLoading ? 'Espera a que termine de procesarse el comprobante' : undefined}>
            <Icon name="check" size={14}/>{saving ? 'Guardando…' : comprobLoading ? 'Procesando foto…' : `${esPagar ? 'Pagar' : 'Registrar'} ${fmt.usd(totalPagoUSD)}`}
          </button>
        </div>
      </div>
    </div>
    {/* FUERA del overlay de arriba, como hermano: dentro, el clic burbujea hasta el onClick del
        overlay de atrás y React desmonta los dos juntos. */}
    {retCuenta && window.RetencionModal && (
      <window.RetencionModal
        cuentaTipo={esPagar ? 'pagar' : 'cobrar'}
        cuenta={retCuenta}
        entidadNombre={cliente?.nombre}
        onClose={() => setRetCuenta(null)}
        onDone={() => {
          // La RPC ya bajó la deuda; se resincroniza el monto a cobrar sin cerrar el modal.
          setLineas(prev => prev.map(l => {
            if (!l._autoSync) return l;
            const suma = deudas.filter(d => sel.includes(d.id)).reduce((s, d) => s + (d.monto - d.pagado), 0);
            const rate = (parseFloat(l.tasaCustom) > 0) ? parseFloat(l.tasaCustom) : tasaVES;
            return { ...l, monto: (l.moneda === 'VES' ? suma * rate : suma).toFixed(2) };
          }));
          setAntVersion(v => v + 1);
        }}/>
    )}
    {showConfirm && (
      <div className="modal-overlay" onClick={() => setShowConfirm(false)} style={{zIndex:400}}>
        <div className="modal" onClick={e=>e.stopPropagation()} style={{width:520}}>
          <div className="modal-header">
            <div style={{width:40,height:40,borderRadius:10,background:'var(--warn-soft,#fef3c7)',color:'var(--warn)',display:'grid',placeItems:'center'}}>
              <Icon name="alert" size={20}/>
            </div>
            <div style={{flex:1}}>
              <h3 className="modal-title">Confirmar {esPagar ? 'el pago' : 'el cobro'}</h3>
              <div className="small">Revisa que la moneda y el monto de cada línea sean los correctos antes de mandarlo.</div>
            </div>
            <button className="icon-btn" onClick={() => setShowConfirm(false)}><Icon name="x" size={16}/></button>
          </div>
          <div className="modal-body" style={{display:'flex', flexDirection:'column', gap:10}}>
            <div className="small muted">{esPagar ? 'Proveedor' : 'Cliente'}: <strong style={{color:'var(--text)'}}>{cliente?.nombre}</strong></div>
            <div className="small muted">
              Aplica a {selCxCs.length} cuenta{selCxCs.length !== 1 ? 's' : ''}: {selCxCs.map(d => d.factura || d.id).join(', ')}
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Banco</th><th>Método</th><th className="num">Monto</th><th className="num">Tasa</th><th className="num">Equivale a</th></tr></thead>
                <tbody>
                  {lineas.map((l, i) => (
                    <tr key={l._k ?? i}>
                      <td>{l.banco || (l.moneda === 'VES' ? 'Efectivo Bs.' : 'Efectivo USD')}</td>
                      <td className="small">{l.metodo}</td>
                      <td className="num strong-num" style={{color: l.moneda === 'VES' ? 'var(--warn)' : 'var(--success)'}}>
                        {l.moneda === 'VES' ? fmt.ves(parseFloat(l.monto) || 0) : fmt.usd(parseFloat(l.monto) || 0)}
                      </td>
                      <td className="num small">{l.moneda === 'VES' ? tasaEfectiva(l) : '—'}</td>
                      <td className="num">{fmt.usd(lineaToUSD(l))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{background:'var(--bg-sunken)', borderRadius:8, padding:'10px 12px', fontSize:13, display:'flex', justifyContent:'space-between'}}>
              <span>Total a {esPagar ? 'pagar' : 'cobrar'}</span>
              <strong>{fmt.usd(totalPagoUSD)}</strong>
            </div>
            {lineas.some(l => l.moneda === 'VES') && (
              <div className="small" style={{color:'var(--warn)', display:'flex', gap:6, alignItems:'flex-start'}}>
                <Icon name="alert" size={13} style={{flexShrink:0, marginTop:1}}/>
                Hay línea(s) en <strong>bolívares</strong> — confirma que el monto de arriba es el que de verdad salió/entró en Bs., no un valor en dólares puesto por error.
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button className="btn ghost" onClick={() => setShowConfirm(false)}>Revisar de nuevo</button>
            <button className="btn primary" onClick={ejecutarPago} disabled={saving}>
              <Icon name="check" size={14}/>{saving ? 'Guardando…' : 'Confirmar y registrar'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
