// ====================== Garantías (serial tracking) ======================
const { useState, useEffect, useMemo } = React;

const GAR_ESTADO_LABEL = {
  pendiente:    { label: 'Pendiente',    color: 'amber' },
  en_revision:  { label: 'En revisión',  color: 'blue'  },
  aprobada:     { label: 'Aprobada',     color: 'green' },
  rechazada:    { label: 'Rechazada',    color: 'red'   },
  reemplazo:    { label: 'Reemplazada',  color: 'green' },
  reembolso:    { label: 'Reembolsada',  color: 'green' },
  reparado:     { label: 'Reparada',     color: 'green' },
};

// Parsea una fecha DATE ('YYYY-MM-DD') como medianoche LOCAL, no UTC.
// new Date('2026-06-19') se interpreta como 00:00 UTC → en Caracas (UTC-4) cae el día anterior 20:00,
// lo que marcaba garantías vigentes como vencidas un día antes. Mismo criterio que fmt.date (core.jsx).
const parseFechaLocal = (s) => {
  if (!s) return null;
  const [y, m, d] = String(s).substring(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};
// Suma N meses a una fecha ISO (YYYY-MM-DD) y devuelve ISO. Maneja overflow de fin de mes.
const addMonthsISO = (dateStr, months) => {
  const d = parseFechaLocal(dateStr); if (!d) return null;
  const day = d.getDate();
  d.setMonth(d.getMonth() + (parseInt(months) || 0));
  if (d.getDate() < day) d.setDate(0); // ej. 31 ene + 1 mes → 28/29 feb
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

window.GarantiasPage = function GarantiasPage() {
  const [garantias, setGarantias] = useState([]);
  const [serialStats, setSerialStats] = useState({ registrados: 0, vendidos: 0, vigentes: 0, porVencer: 0 });
  const [serialesRec, setSerialesRec] = useState([]);   // solo los seriales referenciados por reclamos
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState('vigentes');
  const [search, setSearch]       = useState('');
  const [creating, setCreating]   = useState(null); // null | true | serialObject (preseleccionado)
  const [detail, setDetail]       = useState(null);
  const [serialDetail, setSerialDetail] = useState(null);
  const [incluirVencidas, setIncluirVencidas] = useState(true);
  const [filtroSku, setFiltroSku] = useState('');
  const [garPeriodo, setGarPeriodo] = useState('todas'); // filtro de vigencia: todas|7d|30d|90d|6m|1a
  const [sortDir, setSortDir]     = useState('asc');     // orden lista vigentes (server-side, por días restantes)
  const [pageSize, setPageSize]   = useState(() => { const v = parseInt(localStorage.getItem('ss-garantias-vigentes-pagesize'), 10); return [50,100,200].includes(v) ? v : 50; });
  const [page, setPage]           = useState(1);
  // Lista de seriales en garantía: PAGINADA server-side (antes cargaba ~9.9k filas / 5.3 MB en cliente).
  const [vigRows, setVigRows]     = useState([]);
  const [vigTotal, setVigTotal]   = useState(0);
  const [vigLoading, setVigLoading] = useState(false);
  const [vigReloadKey, setVigReloadKey] = useState(0);
  useEffect(() => { localStorage.setItem('ss-garantias-vigentes-pagesize', String(pageSize)); }, [pageSize]);

  // Selección masiva + paginación de la tabla de Reclamos (estándar de módulo #1/#2
  // — antes solo la pestaña "vigentes" tenía esto, Pendientes/Resueltas/Todas
  // renderizaban la lista completa sin límite ni acciones masivas).
  const [selectedRec, setSelectedRec]   = useState(() => new Set());
  const [pageRec, setPageRec]           = useState(1);
  const [pageSizeRec, setPageSizeRec]   = useState(() => { const v = parseInt(localStorage.getItem('ss-garantias-pagesize'), 10); return [50,100,200].includes(v) ? v : 50; });
  useEffect(() => { localStorage.setItem('ss-garantias-pagesize', String(pageSizeRec)); }, [pageSizeRec]);
  useEffect(() => { setPageRec(1); setSelectedRec(new Set()); }, [tab, search]);

  async function reload() {
    setLoading(true);
    const g = window.loadGarantias ? await window.loadGarantias() : [];
    setGarantias(g);
    // Cards: RPC agregada (antes se calculaba sobre TODOS los seriales cargados en cliente).
    const e = window.currentEmpresa || 'demo1';
    window.sb.rpc('get_garantia_stats', { p_empresa_id: e, p_hoy: window.localDateStr() })
      .then(({ data }) => { if (data) setSerialStats(data); }).catch(() => {});
    // Solo los seriales referenciados por reclamos (para enriquecer las tabs de reclamos).
    const ids = g.map(x => x.serial_id).filter(Boolean);
    setSerialesRec(window.loadSerialesByIds ? await window.loadSerialesByIds(ids) : []);
    setLoading(false);
    setVigReloadKey(k => k + 1);
  }
  useEffect(() => { reload(); }, []);

  // Reset de página al cambiar cualquier filtro de la lista vigentes.
  useEffect(() => { setPage(1); }, [search, filtroSku, incluirVencidas, garPeriodo, sortDir]);

  // Carga PAGINADA server-side de la lista "Seriales en garantía".
  const GAR_PERIODO_DIAS_MAP = { '7d': 7, '30d': 30, '90d': 90, '6m': 182, '1a': 365 };
  useEffect(() => {
    if (tab !== 'vigentes' || !window.loadSerialesVigentes) return;
    let alive = true;
    setVigLoading(true);
    // Búsqueda por nombre de cliente → resolver a ids (server filtra por cliente_id IN).
    let clienteIds = [];
    const q = (search || '').trim().toLowerCase();
    if (q) clienteIds = (SSData.clientes || []).filter(c => (c.nombre || '').toLowerCase().includes(q)).map(c => c.id);
    window.loadSerialesVigentes({
      page, pageSize, search, filtroSku, incluirVencidas,
      maxDias: GAR_PERIODO_DIAS_MAP[garPeriodo] ?? null,
      sortDir, clienteIds,
    })
      .then(({ rows, total }) => { if (alive) { setVigRows(rows); setVigTotal(total); setVigLoading(false); } })
      .catch(() => { if (alive) setVigLoading(false); });
    return () => { alive = false; };
  }, [tab, page, pageSize, search, filtroSku, incluirVencidas, garPeriodo, sortDir, vigReloadKey]);

  const serialesById = useMemo(() => {
    const m = {}; serialesRec.forEach(s => { m[s.id] = s; }); return m;
  }, [serialesRec]);

  const enriched = garantias.map(g => {
    const ser = serialesById[g.serial_id];
    const prod = ser ? SSData.productos.find(p => p.sku === ser.sku) : null;
    const cli  = SSData.clientes.find(c => c.id === g.cliente_id);
    return { ...g, _serial: ser, _producto: prod, _cliente: cli };
  });

  const filtered = enriched.filter(g => {
    if (tab === 'pendientes' && !['pendiente','en_revision'].includes(g.estado)) return false;
    if (tab === 'resueltas' && !['aprobada','rechazada','reemplazo','reembolso','reparado'].includes(g.estado)) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = [
        g.id, g._serial?.serial, g._producto?.nombre, g._cliente?.nombre,
        g.documento_origen_id, g.motivo,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const counts = {
    pendientes: enriched.filter(g => ['pendiente','en_revision'].includes(g.estado)).length,
    resueltas:  enriched.filter(g => ['aprobada','rechazada','reemplazo','reembolso','reparado'].includes(g.estado)).length,
    todas:      enriched.length,
  };

  const totalPagesRec = Math.max(1, Math.ceil(filtered.length / pageSizeRec));
  const curPageRec    = Math.min(pageRec, totalPagesRec);
  const pagedRec      = filtered.slice((curPageRec - 1) * pageSizeRec, curPageRec * pageSizeRec);

  function toggleRecOne(id) {
    setSelectedRec(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }
  function toggleRecAll() {
    setSelectedRec(prev => prev.size === pagedRec.length ? new Set() : new Set(pagedRec.map(g => g.id)));
  }
  function exportRecSeleccionados() {
    const rowsSel = filtered.filter(g => selectedRec.has(g.id));
    const cols = [
      { key: 'id', label: 'ID' },
      { key: 'serial', label: 'Serial' },
      { key: 'producto', label: 'Producto' },
      { key: 'cliente', label: 'Cliente' },
      { key: 'documento_origen_id', label: 'Factura origen' },
      { key: 'fecha_reclamo', label: 'Fecha reclamo' },
      { key: 'estado', label: 'Estado' },
    ];
    const data = rowsSel.map(g => ({
      id: g.id, serial: g._serial?.serial || '', producto: g._producto?.nombre || g._serial?.sku || '',
      cliente: g._cliente?.nombre || '', documento_origen_id: g.documento_origen_id || '',
      fecha_reclamo: g.fecha_reclamo, estado: GAR_ESTADO_LABEL[g.estado]?.label || g.estado,
    }));
    window.exportToXLSX(data, cols, 'garantias_reclamos', 'Reclamos');
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Garantías</h1>
          <div className="page-subtitle">Tracking de seriales · {garantias.length} reclamo(s) · {serialStats.registrados} serial(es) registrados</div>
        </div>
        <div className="page-actions">
          {window.canUser?.('crear', 'garantias') !== false && (
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={14}/>Nueva garantía
            </button>
          )}
        </div>
      </div>

      <div className="stat-grid hide-sm">
        <div className="stat">
          <div className="stat-label">Pendientes</div>
          <div className="stat-val" style={{color:'var(--warn)'}}>{counts.pendientes}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Resueltas</div>
          <div className="stat-val" style={{color:'var(--success)'}}>{counts.resueltas}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Seriales vendidos</div>
          <div className="stat-val">{serialStats.vendidos}</div>
        </div>
        <div className="stat">
          <div className="stat-label">En garantía vigente</div>
          <div className="stat-val">{serialStats.vigentes}</div>
        </div>
      </div>

      <div className="tbl-wrap mt-4">
        <div className="tbl-toolbar" style={{gap:12, flexWrap:'wrap'}}>
          <div className="seg">
            <button className={tab==='vigentes'?'on':''} onClick={()=>setTab('vigentes')}>Seriales en garantía</button>
            <button className={tab==='pendientes'?'on':''} onClick={()=>setTab('pendientes')}>Pendientes <span style={{opacity:.7,fontSize:11}}>({counts.pendientes})</span></button>
            <button className={tab==='resueltas'?'on':''} onClick={()=>setTab('resueltas')}>Resueltas <span style={{opacity:.7,fontSize:11}}>({counts.resueltas})</span></button>
            <button className={tab==='todas'?'on':''} onClick={()=>setTab('todas')}>Reclamos <span style={{opacity:.7,fontSize:11}}>({counts.todas})</span></button>
          </div>
          {tab !== 'vigentes' && (
            <>
              <div style={{position:'relative', flex:1, minWidth:240, maxWidth:400}}>
                <input className="input" placeholder="Buscar por serial, producto, cliente, factura…" value={search} onChange={e=>setSearch(e.target.value)} style={{paddingLeft:34, width:'100%'}}/>
                <Icon name="search" size={14} style={{position:'absolute', left:11, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)'}}/>
              </div>
              <select className="select" value={pageSizeRec} onChange={e=>{setPageSizeRec(parseInt(e.target.value,10)); setPageRec(1);}}>
                {[50,100,200].map(n=><option key={n} value={n}>{n}/pág</option>)}
              </select>
            </>
          )}
          {tab === 'vigentes' && (
            <>
              <div style={{position:'relative', flex:1, minWidth:240, maxWidth:380}}>
                <input className="input" placeholder="Buscar por serial, SKU o cliente…" value={search} onChange={e=>{setSearch(e.target.value); setPage(1);}} style={{paddingLeft:34, width:'100%'}}/>
                <Icon name="search" size={14} style={{position:'absolute', left:11, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)'}}/>
              </div>
              <input className="input" placeholder="Filtrar SKU…" value={filtroSku} onChange={e=>{setFiltroSku(e.target.value); setPage(1);}} style={{maxWidth:160}}/>
              <select className="select" value={garPeriodo} onChange={e=>{setGarPeriodo(e.target.value); setPage(1);}} title="Filtrar por vigencia restante" style={{maxWidth:170}}>
                <option value="todas">Toda vigencia</option>
                <option value="7d">Vence en 7 días</option>
                <option value="30d">Vence en 30 días</option>
                <option value="90d">Vence en 90 días</option>
                <option value="6m">Vence en 6 meses</option>
                <option value="1a">Vence en 1 año</option>
              </select>
              <label style={{display:'flex', alignItems:'center', gap:6, fontSize:12.5, cursor:'pointer'}}>
                <input type="checkbox" checked={incluirVencidas} onChange={e=>{setIncluirVencidas(e.target.checked); setPage(1);}}/>
                Incluir vencidas
              </label>
              <select className="select" value={pageSize} onChange={e=>{setPageSize(parseInt(e.target.value,10)); setPage(1);}}>
                {[50,100,200].map(n=><option key={n} value={n}>{n}/pág</option>)}
              </select>
            </>
          )}
        </div>
        {tab === 'vigentes' && (
          <SerialesVigentesTable
            rows={vigRows}
            total={vigTotal}
            loading={vigLoading}
            incluirVencidas={incluirVencidas}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            sortDir={sortDir}
            onSortToggle={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            onOpenSerial={setSerialDetail}
            onCreateReclamo={(s) => setCreating(s)}
          />
        )}
        {tab !== 'vigentes' && selectedRec.size > 0 && (
          <div style={{display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'var(--brand-soft)', borderTop:'1px solid var(--border)', fontSize:12.5}}>
            <span style={{fontWeight:600}}>{selectedRec.size} seleccionado{selectedRec.size!==1?'s':''}</span>
            <button className="btn ghost sm" onClick={exportRecSeleccionados}><Icon name="download" size={13}/>Exportar</button>
            <button className="btn ghost sm" onClick={()=>setSelectedRec(new Set())}>Deseleccionar</button>
          </div>
        )}
        {tab !== 'vigentes' && (
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{width:36}}>
                  <input type="checkbox" checked={pagedRec.length>0 && selectedRec.size===pagedRec.length}
                    ref={el => { if (el) el.indeterminate = selectedRec.size>0 && selectedRec.size<pagedRec.length; }}
                    onChange={toggleRecAll} style={{cursor:'pointer'}}/>
                </th>
                <th>ID</th>
                <th>Serial</th>
                <th>Producto</th>
                <th>Cliente</th>
                <th>Factura origen</th>
                <th>Reclamo</th>
                <th>Estado</th>
                <th>Garantía vence</th>
                <th className="dt-hide-mobile">Creado por</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={10} className="empty">Cargando…</td></tr>}
              {!loading && pagedRec.length === 0 && <tr><td colSpan={10} className="empty">Sin reclamos</td></tr>}
              {!loading && pagedRec.map(g => {
                const meta = GAR_ESTADO_LABEL[g.estado] || { label: g.estado, color: 'gray' };
                const vence = g._serial?.garantia_vence;
                const venceDate = parseFechaLocal(vence); // local, no UTC (ver parseFechaLocal)
                const vigente = venceDate && venceDate > new Date();
                const isSel = selectedRec.has(g.id);
                return (
                  <tr key={g.id} onClick={()=> selectedRec.size>0 ? toggleRecOne(g.id) : setDetail(g)}
                    style={{cursor:'pointer', background: isSel ? 'var(--brand-soft)' : ''}}>
                    <td onClick={e=>{e.stopPropagation(); toggleRecOne(g.id);}}>
                      <input type="checkbox" checked={isSel} onChange={()=>{}} style={{cursor:'pointer', pointerEvents:'none'}}/>
                    </td>
                    <td className="mono-cell">{g.id}</td>
                    <td className="mono-cell" style={{fontWeight:600}}>{g._serial?.serial || '—'}</td>
                    <td>{g._producto?.nombre || g._serial?.sku || '—'}</td>
                    <td>{g._cliente?.nombre || '—'}</td>
                    <td className="mono-cell small">{g.documento_origen_id || '—'}</td>
                    <td className="muted">{fmt.date(g.fecha_reclamo)}</td>
                    <td><span className={`chip ${meta.color}`}>{meta.label}</span></td>
                    <td>
                      {vence ? (
                        <span className={vigente ? '' : 'muted'} style={{color: vigente ? 'var(--success)' : 'var(--danger)'}}>
                          {fmt.date(vence)} {!vigente && <span className="small">(expirada)</span>}
                        </span>
                      ) : <span className="muted small">—</span>}
                    </td>
                    <td className="dt-hide-mobile"><CreadoPorCell nombre={g.creado_por}/></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
        {tab !== 'vigentes' && !loading && filtered.length > 0 && (
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 12px', fontSize:12.5}}>
            <div className="muted">{filtered.length} reclamo(s) · página {curPageRec} de {totalPagesRec}</div>
            <div style={{display:'flex', gap:6}}>
              <button className="btn ghost" disabled={curPageRec<=1} onClick={()=>setPageRec(p=>p-1)}>← Anterior</button>
              <button className="btn ghost" disabled={curPageRec>=totalPagesRec} onClick={()=>setPageRec(p=>p+1)}>Siguiente →</button>
            </div>
          </div>
        )}
      </div>

      {creating && <NuevaGarantiaModal preselected={typeof creating === 'object' ? creating : null} onClose={()=>setCreating(null)} onCreated={async ()=>{ setCreating(null); await reload(); }}/>}
      {detail && <GarantiaDetailModal garantia={detail} onClose={()=>setDetail(null)} onUpdate={async ()=>{ await reload(); }}/>}
      {serialDetail && <SerialDetailModal serial={serialDetail} onClose={()=>setSerialDetail(null)} onCreateReclamo={(s) => { setSerialDetail(null); setCreating(s); }} onSaved={async (patch) => { setSerialDetail(prev => prev ? { ...prev, ...patch } : prev); await reload(); }}/>}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const GAR_PERIODO_DIAS = { '7d':7, '30d':30, '90d':90, '6m':182, '1a':365 };

function SerialesVigentesTable({ rows, total, loading, incluirVencidas, page, pageSize, onPageChange, sortDir, onSortToggle, onOpenSerial, onCreateReclamo }) {
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const DAY = 86400000;
  // Los datos vienen YA filtrados/ordenados/paginados del server (loadSerialesVigentes).
  // Solo se calcula _dias por fila para el chip de días restantes.
  const paged = (rows || []).map(s => {
    const vence = parseFechaLocal(s.garantia_vence);
    return { ...s, _dias: vence ? Math.ceil((vence - hoy) / DAY) : 0 };
  });
  const totalPages = Math.max(1, Math.ceil((total || 0) / pageSize));
  const cur = Math.min(page, totalPages);

  function diasChip(d) {
    if (d <= 0)  return <span className="chip red">Vencida {Math.abs(d)}d</span>;
    if (d <= 7)  return <span className="chip red">{d} día{d!==1?'s':''}</span>;
    if (d <= 30) return <span className="chip amber">{d} días</span>;
    return <span className="chip green">{d} días</span>;
  }

  return (
    <>
      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Serial</th>
              <th>Producto</th>
              <th className="dt-hide-mobile">Cliente</th>
              <th className="dt-hide-mobile">Factura</th>
              <th className="dt-hide-mobile">Fecha venta</th>
              <th onClick={onSortToggle} style={{cursor:'pointer', userSelect:'none', whiteSpace:'nowrap'}} title="Ordenar por vencimiento">
                Vence {sortDir==='asc' ? '▲' : '▼'}
              </th>
              <th>Días restantes</th>
              <th style={{width:120}}></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="empty">Cargando…</td></tr>}
            {!loading && paged.length === 0 && <tr><td colSpan={8} className="empty">Sin seriales en garantía {incluirVencidas ? '' : 'vigente'}.</td></tr>}
            {!loading && paged.map(s => {
              const prod = SSData.productos.find(p => p.sku === s.sku);
              const cli  = SSData.clientes.find(c => c.id === s.cliente_id);
              const vencido = s._dias <= 0;
              return (
                <tr key={s.id} onClick={()=>onOpenSerial(s)} style={{cursor:'pointer'}}>
                  <td className="mono-cell" style={{fontWeight:600}}>{s.serial}</td>
                  <td>{prod?.nombre || s.sku}</td>
                  <td className="dt-hide-mobile">{cli?.nombre || '—'}</td>
                  <td className="mono-cell small dt-hide-mobile">{s.documento_id || '—'}</td>
                  <td className="dt-hide-mobile">{s.fecha_venta ? fmt.date(s.fecha_venta) : '—'}</td>
                  <td style={{color: vencido ? 'var(--danger)' : 'var(--success)', fontWeight:600}}>{fmt.date(s.garantia_vence)}</td>
                  <td>{diasChip(s._dias)}</td>
                  <td onClick={e => e.stopPropagation()}>
                    {!vencido && onCreateReclamo && window.canUser?.('crear', 'garantias') !== false && (
                      <button className="btn ghost" style={{padding:'4px 10px', fontSize:11.5}} onClick={() => onCreateReclamo(s)} title="Crear reclamo RMA para este serial">
                        <Icon name="plus" size={11}/> Reclamo
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 12px', fontSize:12.5}}>
        <div className="muted">{total} serial(es) · página {cur} de {totalPages}</div>
        <div style={{display:'flex', gap:6}}>
          <button className="btn ghost" disabled={cur<=1} onClick={()=>onPageChange(cur-1)}>← Anterior</button>
          <button className="btn ghost" disabled={cur>=totalPages} onClick={()=>onPageChange(cur+1)}>Siguiente →</button>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function SerialDetailModal({ serial, onClose, onCreateReclamo, onSaved }) {
  const s = serial;
  const prod = SSData.productos.find(p => p.sku === s.sku);
  const cli  = SSData.clientes.find(c => c.id === s.cliente_id);
  const [logs, setLogs] = useState(null);
  // Meses de garantía editable por serial (default 12, puede ser menos). Recalcula el vencimiento.
  const [meses, setMeses]   = useState(s.garantia_meses ?? 12);
  const [vence, setVence]   = useState(s.garantia_vence || null);
  const [editM, setEditM]   = useState(false);
  const [savingM, setSaving]= useState(false);
  useEffect(() => { setMeses(s.garantia_meses ?? 12); setVence(s.garantia_vence || null); setEditM(false); }, [s.id]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await (window.fetchActivityLog?.({ modulo:'inventario_seriales', entidad_id: s.id, limit: 50 }) || Promise.resolve([]));
      if (alive) setLogs(Array.isArray(res) ? res : (res?.data || []));
    })();
    return () => { alive = false; };
  }, [s.id]);

  const venceDate = vence ? parseFechaLocal(vence) : null; // local, no UTC (ver parseFechaLocal)
  const vigente = venceDate && venceDate > new Date();

  async function guardarMeses() {
    const m = Math.max(0, parseInt(meses) || 0);
    if (!s.fecha_venta) { alert('Este serial no tiene fecha de venta; no se puede calcular el vencimiento.'); return; }
    const nuevoVence = addMonthsISO(s.fecha_venta, m);
    setSaving(true);
    const { error } = await window.actualizarSerial(s.id, { garantia_meses: m, garantia_vence: nuevoVence });
    setSaving(false);
    if (error) { alert('No se pudo guardar la garantía: ' + (error.message || error)); return; }
    setMeses(m); setVence(nuevoVence); setEditM(false);
    onSaved && onSaved({ id: s.id, garantia_meses: m, garantia_vence: nuevoVence });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-fullscreen-mobile" onClick={e=>e.stopPropagation()} style={{width:'min(680px, 96vw)', maxHeight:'90vh', display:'flex', flexDirection:'column'}}>
        <div className="modal-header">
          <div style={{width:42,height:42,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}>
            <Icon name="box" size={20}/>
          </div>
          <div style={{flex:1}}>
            <div className="modal-title mono">{s.serial}</div>
            <div className="small">{prod?.nombre || s.sku} · <span className={`chip ${s.estado==='vendido'?'green':'gray'}`}>{s.estado}</span></div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <div className="modal-body" style={{overflowY:'auto'}}>
          <div className="card" style={{padding:14, background:'var(--bg-sunken)', marginBottom:14}}>
            <div className="grid-2" style={{fontSize:12.5}}>
              <div><div className="muted">SKU</div><div className="mono">{s.sku}</div></div>
              <div><div className="muted">Cliente</div><div>{cli?.nombre || '—'}</div></div>
              <div><div className="muted">Factura</div><div className="mono">{s.documento_id || '—'}</div></div>
              <div><div className="muted">Fecha venta</div><div>{s.fecha_venta ? fmt.date(s.fecha_venta) : '—'}</div></div>
              <div><div className="muted">Garantía vence</div>
                <div style={{color: vigente ? 'var(--success)' : 'var(--danger)'}}>
                  {vence ? fmt.date(vence) : '—'} {!vigente && vence && <span className="small">(expirada)</span>}
                </div>
              </div>
              <div><div className="muted">Meses garantía</div>
                {s.estado === 'vendido' ? (
                  editM ? (
                    <div style={{display:'flex', gap:6, alignItems:'center'}}>
                      <input type="number" min="0" value={meses} autoFocus
                        onChange={e => setMeses(e.target.value)}
                        style={{width:60, padding:'2px 6px', fontSize:12.5}}/>
                      <button className="btn primary" style={{padding:'3px 8px', fontSize:11}} disabled={savingM} onClick={guardarMeses}>{savingM ? '…' : 'Guardar'}</button>
                      <button className="btn ghost" style={{padding:'3px 6px', fontSize:11}} onClick={() => { setEditM(false); setMeses(s.garantia_meses ?? 12); }}><Icon name="x" size={11}/></button>
                    </div>
                  ) : (
                    <div style={{display:'flex', gap:8, alignItems:'center'}}>
                      <span>{meses || 0} meses</span>
                      {window.canUser?.('editar', 'pos_seriales') !== false && (
                        <button className="btn ghost" style={{padding:'2px 6px', fontSize:11}} onClick={() => setEditM(true)}><Icon name="edit" size={11}/> Editar</button>
                      )}
                    </div>
                  )
                ) : <div>{meses || 0}</div>}
              </div>
            </div>
          </div>

          <SerialTimeline logs={logs}/>
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
          {s.estado === 'vendido' && vigente && onCreateReclamo && window.canUser?.('crear', 'garantias') !== false && (
            <button className="btn primary" onClick={() => onCreateReclamo(s)}>
              <Icon name="plus" size={13}/> Crear reclamo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SerialTimeline({ logs }) {
  if (logs === null) return <div className="small muted">Cargando historial…</div>;
  if (!logs.length) return (
    <div>
      <div className="form-section-title">Historial del serial</div>
      <div className="empty" style={{padding:14, background:'var(--bg-sunken)', borderRadius:8}}>Sin historial registrado.</div>
    </div>
  );
  return (
    <div>
      <div className="form-section-title">Historial del serial</div>
      <div style={{display:'flex', flexDirection:'column', gap:8}}>
        {logs.map(l => {
          const det = l.detalles && typeof l.detalles === 'object' ? l.detalles : {};
          const resumen = [
            det.documento_id && `doc ${det.documento_id}`,
            det.motivo,
            det.estado_anterior && `prev: ${det.estado_anterior}`,
            det.sku && `SKU ${det.sku}`,
          ].filter(Boolean).join(' · ');
          return (
            <div key={l.id} style={{display:'grid', gridTemplateColumns:'140px 110px 1fr', gap:10, padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12.5, background:'var(--bg-sunken)'}}>
              <div className="muted small">{new Date(l.created_at).toLocaleDateString("es-VE",{day:"2-digit",month:"short",timeZone:"America/Caracas"})} {new Date(l.created_at).toLocaleTimeString("es-VE",{hour:"2-digit",minute:"2-digit",timeZone:"America/Caracas"})}</div>
              <div><span className="chip blue">{l.accion}</span></div>
              <div>
                <div>{l.usuario_nombre || '—'}</div>
                {resumen && <div className="small muted">{resumen}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function NuevaGarantiaModal({ onClose, onCreated, preselected }) {
  const [serialNum, setSerialNum]     = useState(preselected?.serial || '');
  const [matches, setMatches]         = useState([]);
  const [searching, setSearching]     = useState(false);
  const [selected, setSelected]       = useState(preselected || null);
  const [motivo, setMotivo]           = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [saving, setSaving]           = useState(false);
  const [err, setErr]                 = useState('');
  const fromPreset = !!preselected;

  async function buscar() {
    if (!serialNum.trim()) return;
    setSearching(true); setErr('');
    const found = await window.buscarSerial?.(serialNum) || [];
    setSearching(false);
    setMatches(found);
    if (found.length === 0) setErr('No se encontró ningún serial con ese número.');
    else if (found.length === 1) setSelected(found[0]);
  }

  async function save() {
    if (!selected) { setErr('Selecciona un serial.'); return; }
    if (selected.estado !== 'vendido') { setErr('Este serial no ha sido vendido aún.'); return; }
    if (!motivo.trim()) { setErr('Indica el motivo del reclamo.'); return; }
    setSaving(true);
    const { id: newId, error } = await window.crearGarantia({
      serialId:           selected.id,
      clienteId:          selected.cliente_id,
      documentoOrigenId:  selected.documento_id,
      motivo,
      descripcion,
      responsable:        window.__ssCurrentUser?.nombre || null,
    });
    setSaving(false);
    if (error) { setErr('Error: ' + (error.message || JSON.stringify(error))); return; }
    // entidad_id es obligatorio: sin él, GarantiaDetailModal nunca puede filtrar
    // este evento de vuelta en su propio timeline (ver fetch en GarantiaDetailModal).
    window.logActivity?.({ modulo:'garantias', accion:'crear', entidad_id:newId, entidad_label:selected.serial, detalles:{ motivo } });
    onCreated();
  }

  const prod = selected ? SSData.productos.find(p => p.sku === selected.sku) : null;
  const cli  = selected ? SSData.clientes.find(c => c.id === selected.cliente_id) : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width:'min(620px, 96vw)'}}>
        <div className="modal-header">
          <div style={{width:38,height:38,borderRadius:9,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}>
            <Icon name="check" size={18}/>
          </div>
          <div style={{flex:1}}>
            <div className="modal-title">Nueva garantía</div>
            <div className="small">{fromPreset ? `Reclamo para serial ${preselected.serial}` : 'Buscar serial → registrar reclamo'}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        <div className="modal-body">
          {!fromPreset && (
            <>
              <label className="form-label">Número de serial *</label>
              <div style={{display:'flex', gap:8}}>
                <input className="input mono" autoFocus value={serialNum}
                  onChange={e => { setSerialNum(e.target.value); setSelected(null); setMatches([]); }}
                  onKeyDown={e => e.key === 'Enter' && buscar()}
                  placeholder="Ej. SN-A1B2C3" style={{flex:1}}/>
                <button className="btn primary" onClick={buscar} disabled={searching || !serialNum.trim()}>
                  <Icon name="search" size={13}/>{searching ? 'Buscando…' : 'Buscar'}
                </button>
              </div>
            </>
          )}

          {matches.length > 1 && (
            <div className="mt-3">
              <div className="small muted mb-2">Múltiples coincidencias — elegir una:</div>
              {matches.map(m => (
                <div key={m.id} onClick={()=>setSelected(m)}
                  style={{padding:10, borderRadius:6, border: selected?.id===m.id ? '2px solid var(--brand)' : '1px solid var(--border)', cursor:'pointer', marginBottom:6}}>
                  <div className="mono" style={{fontWeight:600}}>{m.serial}</div>
                  <div className="small muted">SKU {m.sku} · {m.estado}</div>
                </div>
              ))}
            </div>
          )}

          {selected && (
            <div className="card mt-3" style={{padding:14, background:'var(--bg-sunken)'}}>
              <div className="small muted mb-2">Información del serial</div>
              <div className="grid-2" style={{fontSize:12.5}}>
                <div><div className="muted">Producto</div><div>{prod?.nombre || selected.sku}</div></div>
                <div><div className="muted">SKU</div><div className="mono">{selected.sku}</div></div>
                <div><div className="muted">Estado</div><div><span className={`chip ${selected.estado==='vendido'?'green':selected.estado==='disponible'?'blue':'gray'}`}>{selected.estado}</span></div></div>
                <div><div className="muted">Cliente</div><div>{cli?.nombre || '—'}</div></div>
                <div><div className="muted">Factura origen</div><div className="mono">{selected.documento_id || '—'}</div></div>
                <div><div className="muted">Fecha venta</div><div>{selected.fecha_venta ? fmt.date(selected.fecha_venta) : '—'}</div></div>
                <div><div className="muted">Garantía vence</div>
                  <div style={{color: selected.garantia_vence && parseFechaLocal(selected.garantia_vence) > new Date() ? 'var(--success)' : 'var(--danger)'}}>
                    {selected.garantia_vence ? fmt.date(selected.garantia_vence) : '—'}
                  </div>
                </div>
                <div><div className="muted">Meses</div><div>{selected.garantia_meses || 0}</div></div>
              </div>
            </div>
          )}

          {selected && selected.estado === 'vendido' && (
            <>
              <div className="mt-3">
                <label className="form-label">Motivo *</label>
                <select className="select" value={motivo} onChange={e=>setMotivo(e.target.value)} style={{width:'100%'}}>
                  <option value="">— Seleccionar —</option>
                  <option value="defecto_fabrica">Defecto de fábrica</option>
                  <option value="falla_funcionamiento">Falla de funcionamiento</option>
                  <option value="dano_fisico">Daño físico</option>
                  <option value="no_enciende">No enciende / no responde</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
              <div className="mt-3">
                <label className="form-label">Descripción</label>
                <textarea className="input" rows={3} value={descripcion} onChange={e=>setDescripcion(e.target.value)}
                  placeholder="Detalles del reclamo, condiciones de uso, etc."/>
              </div>
            </>
          )}

          {err && <div style={{marginTop:10, padding:'8px 12px', background:'#fee2e2', border:'1px solid var(--danger)', borderRadius:6, fontSize:12, color:'#b91c1c'}}>{err}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={save} disabled={saving || !selected || selected.estado !== 'vendido' || !motivo}>
            <Icon name="check" size={13}/>{saving ? 'Creando…' : 'Crear reclamo'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function GarantiaDetailModal({ garantia, onClose, onUpdate }) {
  const g = garantia;
  const [estado, setEstado] = useState(g.estado);
  const [resolucion, setResolucion] = useState(g.resolucion || '');
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      // El timeline necesita DOS streams: los eventos propios del reclamo (crear/editar,
      // logueados con modulo:'garantias' + entidad_id=g.id) y los del serial subyacente
      // (vender/liberar/devolver, modulo:'inventario_seriales' + entidad_id=g.serial_id).
      // Antes solo se pedía el segundo → crear/editar el reclamo nunca aparecía aquí.
      const [resGar, resSer] = await Promise.all([
        window.fetchActivityLog?.({ modulo:'garantias', entidad_id: g.id, limit: 50 }) || Promise.resolve([]),
        g.serial_id
          ? (window.fetchActivityLog?.({ modulo:'inventario_seriales', entidad_id: g.serial_id, limit: 50 }) || Promise.resolve([]))
          : Promise.resolve([]),
      ]);
      const arrGar = Array.isArray(resGar) ? resGar : (resGar?.data || []);
      const arrSer = Array.isArray(resSer) ? resSer : (resSer?.data || []);
      const merged = [...arrGar, ...arrSer].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      if (alive) setLogs(merged);
    })();
    return () => { alive = false; };
  }, [g.id, g.serial_id]);

  async function guardar() {
    setSaving(true);
    const fields = { estado, resolucion };
    if (['aprobada','rechazada','reemplazo','reembolso','reparado'].includes(estado) && !g.fecha_resolucion) {
      fields.fecha_resolucion = window.localDateStr();
    }
    const { error } = await window.actualizarGarantia(g.id, fields);
    setSaving(false);
    if (error) { alert('Error: ' + (error.message || JSON.stringify(error))); return; }
    window.logActivity?.({ modulo:'garantias', accion:'editar', entidad_id:g.id, entidad_label:g._serial?.serial, detalles:{ estado, resolucion } });
    onUpdate();
    onClose();
  }

  const meta = GAR_ESTADO_LABEL[g.estado] || { label: g.estado, color: 'gray' };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width:'min(680px, 96vw)', maxHeight:'90vh', display:'flex', flexDirection:'column'}}>
        <div className="modal-header">
          <div style={{width:42,height:42,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}>
            <Icon name="check" size={20}/>
          </div>
          <div style={{flex:1}}>
            <div className="modal-title mono">{g.id}</div>
            <div className="small">Reclamo de {fmt.date(g.fecha_reclamo)} · <span className={`chip ${meta.color}`}>{meta.label}</span></div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        <div className="modal-body" style={{overflowY:'auto'}}>
          <div className="card" style={{padding:14, background:'var(--bg-sunken)', marginBottom:14}}>
            <div className="small muted mb-2">Producto / serial</div>
            <div className="grid-2" style={{fontSize:12.5}}>
              <div><div className="muted">Serial</div><div className="mono" style={{fontWeight:600}}>{g._serial?.serial || '—'}</div></div>
              <div><div className="muted">SKU / producto</div><div>{g._producto?.nombre || g._serial?.sku || '—'}</div></div>
              <div><div className="muted">Cliente</div><div>{g._cliente?.nombre || '—'}</div></div>
              <div><div className="muted">Factura origen</div><div className="mono">{g.documento_origen_id || '—'}</div></div>
              <div><div className="muted">Fecha venta</div><div>{g._serial?.fecha_venta ? fmt.date(g._serial.fecha_venta) : '—'}</div></div>
              <div><div className="muted">Garantía vence</div>
                <div style={{color: g._serial?.garantia_vence && parseFechaLocal(g._serial.garantia_vence) > new Date() ? 'var(--success)' : 'var(--danger)'}}>
                  {g._serial?.garantia_vence ? fmt.date(g._serial.garantia_vence) : '—'}
                </div>
              </div>
            </div>
          </div>

          <div className="grid-2" style={{gap:14, marginBottom:14}}>
            <div>
              <label className="form-label">Motivo</label>
              <div style={{padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, background:'var(--bg-sunken)', fontSize:12.5}}>
                {g.motivo || '—'}
              </div>
            </div>
            <div>
              <label className="form-label">Responsable</label>
              <div style={{padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, background:'var(--bg-sunken)', fontSize:12.5}}>
                {g.responsable || '—'}
              </div>
            </div>
          </div>

          <label className="form-label">Descripción del reclamo</label>
          <div style={{padding:10, border:'1px solid var(--border)', borderRadius:6, background:'var(--bg-sunken)', fontSize:12.5, whiteSpace:'pre-wrap', minHeight:60, marginBottom:14}}>
            {g.descripcion || <span className="muted">Sin descripción</span>}
          </div>

          <div style={{borderTop:'1px solid var(--border)', paddingTop:14}}>
            <div className="form-section-title">Gestión</div>
            <div className="grid-2" style={{gap:14}}>
              <div>
                <label className="form-label">Estado</label>
                <select className="select" value={estado} onChange={e=>setEstado(e.target.value)} style={{width:'100%'}}>
                  <option value="pendiente">Pendiente</option>
                  <option value="en_revision">En revisión</option>
                  <option value="aprobada">Aprobada</option>
                  <option value="rechazada">Rechazada</option>
                  <option value="reemplazo">Reemplazada</option>
                  <option value="reembolso">Reembolsada</option>
                  <option value="reparado">Reparada</option>
                </select>
              </div>
              <div>
                <label className="form-label">Fecha resolución</label>
                <div style={{padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, background:'var(--bg-sunken)', fontSize:12.5}}>
                  {g.fecha_resolucion ? fmt.date(g.fecha_resolucion) : <span className="muted">Pendiente</span>}
                </div>
              </div>
            </div>
            <div className="mt-3">
              <label className="form-label">Resolución / notas</label>
              <textarea className="input" rows={3} value={resolucion} onChange={e=>setResolucion(e.target.value)}
                placeholder="Decisión tomada, número de RMA, etc."/>
            </div>
          </div>

          <div style={{borderTop:'1px solid var(--border)', paddingTop:14, marginTop:14}}>
            <SerialTimeline logs={logs}/>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cerrar</button>
          {window.canUser?.('editar', 'garantias') !== false && (
            <button className="btn primary" onClick={guardar} disabled={saving}>
              <Icon name="check" size={13}/>{saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { GarantiasPage: window.GarantiasPage });
