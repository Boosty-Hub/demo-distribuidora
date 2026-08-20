// DataTable — componente reusable que cumple los estándares 1, 2, 6, 7
//
// Props:
//   moduloId       string  — namespace para localStorage (ss-{moduloId}-pagesize, etc.)
//   rows           array   — filas filtradas (el padre aplica filtros antes)
//   columns        array   — [{ key, label, render?, className?, hideOnMobile? }]
//   getRowId       fn(row) — id único de cada fila (default row.id)
//   onRowClick     fn(row) — abre modal de detalle (estándar #6). Si null, click no hace nada
//   bulkActions    array   — [{ label, icon, onClick(selectedRows), variant?:'danger'|'primary' }]
//   emptyText      string  — mensaje cuando rows.length === 0
//   defaultPageSize number — opcional, default 50
//
// Uso típico:
//   <DataTable
//     moduloId="productos"
//     rows={productosFiltrados}
//     columns={[
//       { key: 'sku', label: 'SKU', render: r => <code>{r.sku}</code> },
//       { key: 'nombre', label: 'Nombre' },
//       { key: 'stock', label: 'Stock', className:'num', hideOnMobile:true },
//     ]}
//     onRowClick={r => setSelected(r)}
//     bulkActions={[
//       { label:'Eliminar', icon:'trash', variant:'danger', onClick: rows => handleBulkDelete(rows) },
//     ]}
//   />

const DEFAULT_PAGE_SIZE_OPTIONS = [50, 100, 200];

window.DataTable = function DataTable({
  moduloId,
  rows = [],
  columns = [],
  getRowId,
  onRowClick,
  bulkActions = [],
  emptyText = 'Sin registros',
  defaultPageSize = 50,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  toolbar,           // contenido extra arriba a la izquierda (filtros, etc.)
  rightToolbar,      // contenido extra arriba a la derecha (botones)
}) {
  const rowId = getRowId || (r => r.id);
  const PAGE_SIZE_OPTIONS = pageSizeOptions;

  const psKey  = `ss-${moduloId}-pagesize`;
  const [pageSize, setPageSize] = React.useState(() => {
    const saved = parseInt(localStorage.getItem(psKey));
    return PAGE_SIZE_OPTIONS.includes(saved) ? saved : defaultPageSize;
  });
  const [page, setPage]         = React.useState(1);
  const [selected, setSelected] = React.useState(() => new Set());

  // Persistir page size
  React.useEffect(() => { localStorage.setItem(psKey, String(pageSize)); }, [pageSize, psKey]);

  // Reset a página 1 cuando el dataset cambie de tamaño (filtros)
  React.useEffect(() => { setPage(1); }, [rows.length]);

  // Limpiar selección si las filas seleccionadas ya no están
  React.useEffect(() => {
    const ids = new Set(rows.map(rowId));
    setSelected(prev => {
      const next = new Set();
      prev.forEach(id => { if (ids.has(id)) next.add(id); });
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const startIdx   = (safePage - 1) * pageSize;
  const pageRows   = rows.slice(startIdx, startIdx + pageSize);

  // El check de la cabecera selecciona TODAS las filas filtradas, no solo la
  // página. Antes era page-scoped: con 50 por página marcaba 50 de N y parecía
  // que el "seleccionar todo" estaba roto. La barra de acciones masivas muestra
  // el conteo, así que siempre queda claro cuántas quedaron marcadas.
  const allSelected  = rows.length > 0 && selected.size >= rows.length;
  const someSelected = !allSelected && selected.size > 0;

  function toggleAllRows() {
    setSelected(prev => (prev.size >= rows.length ? new Set() : new Set(rows.map(rowId))));
  }

  function toggleOne(id) {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function clearSel() { setSelected(new Set()); }

  const selectedRows = rows.filter(r => selected.has(rowId(r)));

  // Página adyacentes para paginador
  function pageButtons() {
    const max = 5;
    let from = Math.max(1, safePage - 2);
    let to   = Math.min(totalPages, from + max - 1);
    from = Math.max(1, to - max + 1);
    const arr = [];
    for (let i = from; i <= to; i++) arr.push(i);
    return arr;
  }

  return (
    <div className="data-table">
      {/* Toolbar superior (filtros y acciones del padre) */}
      {(toolbar || rightToolbar) && (
        <div className="dt-toolbar" style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'center', marginBottom:10 }}>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'center', flex:'1 1 300px' }}>{toolbar}</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6, alignItems:'center' }}>{rightToolbar}</div>
        </div>
      )}

      {/* Barra de acciones masivas */}
      {selected.size > 0 && bulkActions.length > 0 && (
        <div className="dt-bulkbar" style={{
          display:'flex', alignItems:'center', gap:8, padding:'8px 12px',
          background: 'var(--brand-soft, #2563eb14)', border:'1px solid var(--brand)', borderRadius:8,
          marginBottom:10, flexWrap:'wrap'
        }}>
          <span style={{ fontWeight:600, fontSize:13 }}>{selected.size} seleccionado{selected.size!==1?'s':''}</span>
          <button className="btn ghost sm" onClick={clearSel}><Icon name="x" size={12}/>Limpiar</button>
          <span style={{ width:1, height:18, background:'var(--border)', margin:'0 4px' }}></span>
          {bulkActions.map((a, i) => (
            <button key={i}
              className={'btn sm ' + (a.variant === 'danger' ? 'danger' : a.variant === 'primary' ? 'primary' : 'secondary')}
              title={a.tooltip || ''}
              onClick={() => a.onClick(selectedRows, clearSel)}>
              {a.icon && <Icon name={a.icon} size={13}/>}{a.label}
            </button>
          ))}
        </div>
      )}

      {/* Tabla */}
      <div className="tbl-wrap">
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                {bulkActions.length > 0 && (
                  <th style={{ width:36, padding:'4px 10px' }}>
                    <input
                      type="checkbox"
                      ref={el => { if (el) el.indeterminate = someSelected; }}
                      checked={allSelected}
                      onChange={toggleAllRows}
                    />
                  </th>
                )}
                {columns.map(c => (
                  <th key={c.key} className={(c.className || '') + (c.hideOnMobile ? ' dt-hide-mobile' : '')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr><td colSpan={columns.length + (bulkActions.length > 0 ? 1 : 0)} className="empty" style={{ textAlign:'center', padding:'32px 8px', color:'var(--text-muted)' }}>{emptyText}</td></tr>
              )}
              {pageRows.map(row => {
                const id = rowId(row);
                const isSel = selected.has(id);
                return (
                  <tr key={id}
                      className={isSel ? 'selected' : ''}
                      style={{ cursor: onRowClick ? 'pointer' : 'default' }}
                      onClick={() => onRowClick && onRowClick(row)}>
                    {bulkActions.length > 0 && (
                      <td style={{ width:36, padding:'4px 10px' }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={isSel} onChange={() => toggleOne(id)} />
                      </td>
                    )}
                    {columns.map(c => (
                      <td key={c.key} className={(c.className || '') + (c.hideOnMobile ? ' dt-hide-mobile' : '')}>
                        {c.render ? c.render(row) : (row[c.key] ?? '')}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Paginación + selector */}
      <div className="dt-footer" style={{
        display:'flex', alignItems:'center', justifyContent:'space-between', gap:10,
        marginTop:10, flexWrap:'wrap', fontSize:12
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span className="muted">Filas por página:</span>
          <select className="select" value={pageSize} onChange={e => { setPageSize(parseInt(e.target.value)); setPage(1); }} style={{ fontSize:12, padding:'3px 6px' }}>
            {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="muted">
            {rows.length === 0 ? '0 filas' :
             `Mostrando ${startIdx + 1}–${Math.min(startIdx + pageSize, rows.length)} de ${rows.length}`}
          </span>
        </div>

        {totalPages > 1 && (
          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
            <button className="btn ghost sm" disabled={safePage === 1} onClick={() => setPage(1)} title="Primera"><Icon name="chevronL" size={11}/><Icon name="chevronL" size={11}/></button>
            <button className="btn ghost sm" disabled={safePage === 1} onClick={() => setPage(p => Math.max(1, p - 1))} title="Anterior"><Icon name="chevronL" size={13}/></button>
            {pageButtons().map(p => (
              <button key={p} className={'btn sm ' + (p === safePage ? 'primary' : 'ghost')} style={{ minWidth:30, padding:'3px 8px' }} onClick={() => setPage(p)}>{p}</button>
            ))}
            <button className="btn ghost sm" disabled={safePage === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} title="Siguiente"><Icon name="chevronR" size={13}/></button>
            <button className="btn ghost sm" disabled={safePage === totalPages} onClick={() => setPage(totalPages)} title="Última"><Icon name="chevronR" size={11}/><Icon name="chevronR" size={11}/></button>
          </div>
        )}
      </div>
    </div>
  );
};

Object.assign(window, { DataTable: window.DataTable });
