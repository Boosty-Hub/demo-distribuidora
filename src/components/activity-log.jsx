// ActivityLogModal — modal reusable para mostrar historial de un módulo o entidad
// Uso:
//   <ActivityLogModal modulo="productos" onClose={...}/>
//   <ActivityLogModal modulo="productos" entidadId="P-001" entidadLabel="Cámara X" onClose={...}/>

const ACCION_COLORS = {
  crear:      'green',
  editar:     'blue',
  eliminar:   'red',
  restaurar:  'amber',
  bulk_eliminar: 'red',
  bulk_editar:   'blue',
  login:      'neutral',
  recepcion:  'green',
  devolucion: 'amber',
  cancelar:   'red',
  salida:     'amber',
  vender:     'blue',
  liberar:    'neutral',
  exportar:   'neutral',
};

const ACCION_LABELS = {
  crear:      'Creación',
  editar:     'Edición',
  eliminar:   'Eliminación',
  restaurar:  'Restauración',
  bulk_eliminar: 'Eliminación masiva',
  bulk_editar:   'Edición masiva',
  login:      'Inicio de sesión',
  recepcion:  'Recepción',
  devolucion: 'Devolución al proveedor',
  cancelar:   'Cancelación',
  salida:     'Salida de inventario',
  vender:     'Venta (seriales)',
  liberar:    'Liberación (seriales)',
  exportar:   'Exportación',
};

window.ActivityLogModal = function ActivityLogModal({ modulo, entidadId, entidadLabel, onClose }) {
  const [items, setItems]     = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState(null); // log entry para popup de detalle
  const [filtroAccion, setFiltroAccion] = React.useState('');
  const [filtroUsuario, setFiltroUsuario] = React.useState('');

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    window.fetchActivityLog?.({ modulo, entidad_id: entidadId, limit: 200 }).then(data => {
      if (alive) { setItems(data); setLoading(false); }
    });
    return () => { alive = false; };
  }, [modulo, entidadId]);

  // Esc para cerrar
  React.useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const usuarios = [...new Set(items.map(i => i.usuario_nombre).filter(Boolean))].sort();
  const acciones = [...new Set(items.map(i => i.accion).filter(Boolean))].sort();

  const filtered = items.filter(i =>
    (!filtroAccion  || i.accion === filtroAccion) &&
    (!filtroUsuario || i.usuario_nombre === filtroUsuario)
  );

  function fmtDate(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Caracas' });
    } catch { return iso; }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 820, width: '92vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title" style={{ fontSize: 16 }}>Registro de actividad</h2>
            <div className="small muted">
              {modulo}{entidadLabel ? ` · ${entidadLabel}` : ''}
              {entidadId && !entidadLabel ? ` · ${entidadId}` : ''}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} title="Cerrar"><Icon name="x" size={16}/></button>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <select className="select" value={filtroAccion} onChange={e => setFiltroAccion(e.target.value)} style={{ fontSize: 12 }}>
            <option value="">Todas las acciones</option>
            {acciones.map(a => <option key={a} value={a}>{ACCION_LABELS[a] || a}</option>)}
          </select>
          <select className="select" value={filtroUsuario} onChange={e => setFiltroUsuario(e.target.value)} style={{ fontSize: 12 }}>
            <option value="">Todos los usuarios</option>
            {usuarios.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <span className="small muted" style={{ marginLeft: 'auto', alignSelf: 'center' }}>
            {filtered.length} de {items.length}
          </span>
        </div>

        <div className="modal-body" style={{ overflow: 'auto', padding: 0, flex: 1 }}>
          {loading && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Cargando…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Sin registros de actividad{filtroAccion || filtroUsuario ? ' con esos filtros' : ''}.
            </div>
          )}
          {!loading && filtered.length > 0 && (
            <table className="tbl" style={{ width: '100%' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-elevated)', zIndex: 1 }}>
                <tr>
                  <th style={{ width: 130 }}>Fecha</th>
                  <th>Usuario</th>
                  <th>Acción</th>
                  <th>Entidad</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(log => (
                  <tr key={log.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(log)}>
                    <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(log.created_at)}</td>
                    <td style={{ fontSize: 12.5 }}>
                      {window.CreadoPorCell
                        ? <CreadoPorCell nombre={log.usuario_nombre} size={22}/>
                        : (log.usuario_nombre || '—')}
                    </td>
                    <td><span className={'chip ' + (ACCION_COLORS[log.accion] || 'neutral')} style={{ fontSize: 11 }}>{ACCION_LABELS[log.accion] || log.accion}</span></td>
                    <td style={{ fontSize: 12.5 }}>
                      {log.entidad_label || log.entidad_id || <span className="muted">—</span>}
                    </td>
                    <td><Icon name="chevronR" size={12}/></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>

      {selected && <LogEntryDetailModal log={selected} onClose={() => setSelected(null)}/>}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
function LogEntryDetailModal({ log, onClose }) {
  React.useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fmtDate = (iso) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('es-VE', { dateStyle: 'long', timeStyle: 'medium', timeZone: 'America/Caracas' });
    } catch { return iso; }
  };

  const detalles = log.detalles && typeof log.detalles === 'object' ? log.detalles : {};
  const detalleKeys = Object.keys(detalles);

  function renderValue(v) {
    if (v == null) return <span className="muted">—</span>;
    if (typeof v === 'boolean') return v ? 'sí' : 'no';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) {
      if (v.length === 0) return <span className="muted">vacío</span>;
      if (v.every(x => typeof x === 'string' || typeof x === 'number')) {
        return <span style={{display:'flex', flexWrap:'wrap', gap:4}}>{v.map((x, i) => <span key={i} className="chip neutral" style={{fontSize:10.5}}>{String(x)}</span>)}</span>;
      }
      return <pre style={{margin:0, fontSize:11, fontFamily:'var(--mono)', whiteSpace:'pre-wrap'}}>{JSON.stringify(v, null, 2)}</pre>;
    }
    if (typeof v === 'object') {
      return <pre style={{margin:0, fontSize:11, fontFamily:'var(--mono)', whiteSpace:'pre-wrap'}}>{JSON.stringify(v, null, 2)}</pre>;
    }
    return String(v);
  }

  function prettyKey(k) {
    return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  const meta = ACCION_COLORS[log.accion] || 'neutral';

  return (
    <div className="modal-overlay" onClick={onClose} style={{zIndex: 350}}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 580, width: '92vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <div style={{width:42, height:42, borderRadius:10, background:'var(--brand-soft)', color:'var(--brand)', display:'grid', placeItems:'center'}}>
            <Icon name="receipt" size={20}/>
          </div>
          <div style={{flex:1, minWidth:0}}>
            <div className="modal-title" style={{fontSize:15}}>{ACCION_LABELS[log.accion] || log.accion}</div>
            <div className="small muted">{fmtDate(log.created_at)}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        <div className="modal-body" style={{overflowY:'auto', padding:'14px 18px'}}>
          <div className="card" style={{padding:14, background:'var(--bg-sunken)', marginBottom:14}}>
            <div className="grid-2" style={{fontSize:12.5, gap:'10px 14px'}}>
              <div>
                <div className="muted" style={{fontSize:11, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:2}}>Acción</div>
                <span className={'chip ' + meta}>{ACCION_LABELS[log.accion] || log.accion}</span>
              </div>
              <div>
                <div className="muted" style={{fontSize:11, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:2}}>Módulo</div>
                <div style={{fontWeight:500}}>{log.modulo || '—'}</div>
              </div>
              <div>
                <div className="muted" style={{fontSize:11, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:2}}>Usuario</div>
                {window.CreadoPorCell
                  ? <CreadoPorCell nombre={log.usuario_nombre} size={24}/>
                  : <div style={{fontWeight:500}}>{log.usuario_nombre || '—'}</div>}
              </div>
              <div>
                <div className="muted" style={{fontSize:11, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:2}}>Entidad</div>
                <div style={{fontWeight:500}}>{log.entidad_label || log.entidad_id || '—'}</div>
                {log.entidad_id && log.entidad_label && (
                  <div className="mono muted" style={{fontSize:11, marginTop:1}}>{log.entidad_id}</div>
                )}
              </div>
              {log.ip && (
                <div>
                  <div className="muted" style={{fontSize:11, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:2}}>IP</div>
                  <div className="mono" style={{fontSize:12}}>{log.ip}</div>
                </div>
              )}
              <div>
                <div className="muted" style={{fontSize:11, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:2}}>Empresa</div>
                <div style={{fontWeight:500}}>{log.empresa_id || '—'}</div>
              </div>
            </div>
          </div>

          {detalleKeys.length > 0 ? (
            <>
              <div className="form-section-title" style={{marginTop:0, marginBottom:8}}>Detalles</div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <tbody>
                    {detalleKeys.map(k => (
                      <tr key={k}>
                        <td style={{width:160, color:'var(--text-muted)', fontSize:12, verticalAlign:'top', padding:'8px 12px'}}>{prettyKey(k)}</td>
                        <td style={{fontSize:12.5, padding:'8px 12px'}}>{renderValue(detalles[k])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="empty" style={{padding:'24px 0', textAlign:'center', color:'var(--text-muted)', fontSize:12.5}}>
              Este registro no tiene detalles adicionales.
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

Object.assign(window, { ActivityLogModal: window.ActivityLogModal });
