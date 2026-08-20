// ══════════════════════════════════════════════════════════════════════════
//  returns.jsx — Módulo de Devoluciones + Notas de Crédito + Reembolsos
// ══════════════════════════════════════════════════════════════════════════
const { useState, useMemo, useRef, useEffect, useCallback } = React;

const IVA_RATE = 0.16;

// ─── SSData extensions (vacío por defecto, se hidrata desde Supabase) ───────
if (!SSData.devoluciones) SSData.devoluciones = [];

// ─── ID generators ────────────────────────────────────────────────────────
function getNextDevId() {
  const max = (SSData.devoluciones || []).map(d => parseInt((d.id||'').replace('DEV-',''),10)||0).reduce((a,b)=>Math.max(a,b),0);
  return 'DEV-' + String(max+1).padStart(4,'0');
}
function getNextNcId() {
  const year = window.caracasYear();  // año de Venezuela para el correlativo NC-{año}-N
  const max = (SSData.devoluciones || [])
    .map(d => d.nota_credito_id)
    .filter(id => id && id.startsWith(`NC-${year}-`))
    .map(id => parseInt(id.split('-').pop()) || 0)
    .reduce((a, b) => Math.max(a, b), 0);
  return `NC-${year}-${String(max+1).padStart(4,'0')}`;
}

// ─── Lookup helpers ───────────────────────────────────────────────────────
const MOTIVOS = [
  'Producto defectuoso / dañado',
  'Producto incorrecto',
  'Error de facturación',
  'Desistimiento del cliente',
  'Garantía',
  'Exceso de cantidad facturada',
  'Otro',
];

const METODOS_REEMBOLSO = [
  { id: 'credito_cuenta', label: 'Crédito en cuenta (reduce deuda)' },
  { id: 'transferencia',  label: 'Transferencia bancaria' },
  { id: 'efectivo',       label: 'Efectivo en caja' },
  { id: 'cheque',         label: 'Cheque' },
  { id: 'no_recogido',    label: 'No recogido por el cliente (reingresa a stock)' },
];

const ESTADO_COLOR = { pendiente:'amber', aprobada:'blue', procesada:'green', rechazada:'red' };
const ESTADO_LABEL = { pendiente:'Pendiente', aprobada:'Aprobada', procesada:'Procesada', rechazada:'Rechazada' };

// Aprobación COMPLETA de una devolución — compartida por el aprobar individual y el masivo.
// Restaura inventario (el stock vuelve), crea la nota de crédito, procesa el reembolso y
// marca los S/N como devueltos. Devuelve { ncId } o { error } / { serialError }.
async function aprobarDevolucion(dev) {
  const ncId = (await window.nextCorrelativo?.('NC')) || getNextNcId();
  const aprobado_por = window.__ssCurrentUser?.nombre || window.currentUserRole || 'Admin';

  // 1. Restaurar inventario: la cantidad devuelta vuelve al stock del almacén.
  for (const item of dev.items || []) {
    const { data: invRow } = await window.sb
      .from('inventario').select('cantidad').eq('sku', item.sku).eq('almacen_id', dev.almacen_id).maybeSingle();
    const nuevaCantidad = (invRow?.cantidad || 0) + item.qty_devuelta;
    await window.sb.from('inventario')
      .upsert([{ sku: item.sku, almacen_id: dev.almacen_id, cantidad: nuevaCantidad }], { onConflict: 'sku,almacen_id' });
  }

  // 2. Crear la nota de crédito.
  // `documentos` no tiene columnas `cliente` ni `referencia` (son `cliente_id` y
  // `documento_origen_id`) — el insert fallaba con 42703 en cada aprobación y el
  // error nunca se chequeaba, dejando nota_credito_id apuntando a un doc inexistente.
  const { error: ncError } = await window.sb.from('documentos').insert([{
    id: ncId, empresa_id: window.currentEmpresa || 'demo1',
    tipo: 'nota_credito', cliente_id: dev.cliente_id,
    fecha: window.localDateStr(),
    estado: 'nota_credito', total: dev.total,
    vendedor: dev.creado_por, documento_origen_id: dev.factura_id,
  }]);
  if (ncError) return { error: ncError };

  // 3. Reembolso: 'credito_cuenta' y 'no_recogido' no requieren acción monetaria posterior.
  const reembolsoActualizado = ['credito_cuenta', 'no_recogido'].includes(dev.reembolso?.metodo)
    ? { ...dev.reembolso, estado: 'procesado' }
    : dev.reembolso;

  const updated = {
    ...dev, estado: 'aprobada', nota_credito_id: ncId, aprobado_por,
    fecha_aprobacion: new Date().toISOString(), reembolso: reembolsoActualizado,
  };
  const { error } = await window.saveDev(updated);
  if (error) return { error };

  // 4. Marcar S/N como devueltos (solo al aprobar — BR-INV-S07).
  const allSerialIds = (dev.items || []).flatMap(i => i.seriales_devueltos || []);
  if (allSerialIds.length > 0) {
    const res = await window.devolverSeriales({ serialIds: allSerialIds, devolucionId: dev.id, motivo: dev.motivo });
    if (res?.error) return { ncId, serialError: res.error };
  }
  return { ncId };
}

function getFacturas() {
  return SSData.documentos.filter(d => d.tipo === 'factura' || d.estado === 'factura');
}

function calcTotals(items) {
  const subtotal = items.reduce((s,i) => s + i.subtotal, 0);
  const iva      = subtotal * IVA_RATE;
  const total    = subtotal + iva;
  return { subtotal, iva, total };
}

// ══════════════════════════════════════════════════════════════════════════
//  DevolucionesPage
// ══════════════════════════════════════════════════════════════════════════
const DEV_PAGE_SIZE = 50;

window.DevolucionesPage = function DevolucionesPage() {
  const [version, setVersion]   = useState(0);
  const [filter, setFilter]     = useState('all');
  const [search, setSearch]     = useState('');
  const [showNueva, setShowNueva] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [detail, setDetail]     = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading]   = useState(false);
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    const v = parseInt(localStorage.getItem('ss-devoluciones-pagesize'));
    return [50,100,200].includes(v) ? v : 50;
  });
  React.useEffect(() => { localStorage.setItem('ss-devoluciones-pagesize', String(pageSize)); }, [pageSize]);
  const refresh = () => setVersion(v => v+1);

  // Las devoluciones se cargan en FASE 2 (evento 'ss-data-extra-loaded'), DESPUÉS
  // del montaje. El useMemo `rows` solo depende de [version, filter, search] y
  // SSData.devoluciones se muta in-place (no cambia de referencia), así que sin
  // esto la tabla quedaba VACÍA aunque SSData.devoluciones ya tuviera filas — el
  // contador inline sí las veía. Mismo patrón que inventory.jsx y reportes.jsx.
  React.useEffect(() => window.ssOnDatos(() => refresh()), []);

  const rows = useMemo(() => {
    return SSData.devoluciones
      .filter(d => {
        if (filter !== 'all' && d.estado !== filter) return false;
        if (search) {
          const q = search.toLowerCase();
          const cli = SSData.clientes.find(c => c.id === d.cliente_id);
          return d.id.toLowerCase().includes(q) || d.factura_id.toLowerCase().includes(q) || cli?.nombre.toLowerCase().includes(q);
        }
        return true;
      })
      .sort((a,b) => new Date(b.fecha) - new Date(a.fecha))
      .map(d => ({
        ...d,
        cliente: SSData.clientes.find(c => c.id === d.cliente_id),
      }));
  }, [version, filter, search]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const paginated  = rows.slice((page-1)*pageSize, page*pageSize);

  const toggleAll = () => {
    if (selected.size === paginated.length) { setSelected(new Set()); }
    else { setSelected(new Set(paginated.map(d => d.id))); }
  };
  const toggleOne = (id) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  const allChecked  = paginated.length > 0 && selected.size === paginated.length;
  const someChecked = selected.size > 0 && selected.size < paginated.length;

  async function handleBulkApprove() {
    const ids = [...selected];
    const targets = SSData.devoluciones.filter(d => ids.includes(d.id) && d.estado === 'pendiente');
    if (!targets.length) return;
    setLoading(true);
    // Aprobación completa por cada devolución (secuencial: evita carreras de correlativo NC
    // y de inventario cuando dos devoluciones tocan el mismo SKU).
    for (const d of targets) {
      const r = await aprobarDevolucion(d);
      if (r.error) console.error('[devoluciones] error aprobando', d.id, r.error);
    }
    await window.refrescarFase2();
    setLoading(false);
    setSelected(new Set());
    refresh();
    window.logActivity?.({
      modulo:'devoluciones', accion:'bulk_editar',
      entidad_label: `${targets.length} devoluciones`,
      detalles:{ campo:'estado', valor:'aprobada', ids: targets.map(d=>d.id) }
    });
  }

  async function handleBulkDelete() {
    if (!confirm(`¿Eliminar ${selected.size} devolución${selected.size!==1?'es':''}? Se enviarán a la papelera.`)) return;
    const targets = SSData.devoluciones.filter(d => selected.has(d.id));
    setLoading(true);
    const { error } = await window.deleteDev(targets.map(d => d.id));
    if (error) { alert('Error al eliminar: ' + error.message); setLoading(false); return; }
    targets.forEach(d => window.ssTrash?.add('devolucion', d.id, d));
    await window.refrescarFase2();
    setLoading(false);
    setSelected(new Set());
    refresh();
    window.logActivity?.({
      modulo:'devoluciones', accion: targets.length===1?'eliminar':'bulk_eliminar',
      entidad_id: targets.length===1?targets[0].id:null,
      entidad_label: targets.length===1?targets[0].id:`${targets.length} devoluciones`,
      detalles:{ ids: targets.map(d=>d.id) }
    });
  }

  function exportCSV() {
    const sel = rows.filter(d => selected.has(d.id));
    const header = 'ID,Factura,Cliente,Estado,Total,Fecha';
    const lines = sel.map(d => [d.id, d.factura_id, d.cliente?.nombre||d.cliente_id, d.estado, d.total, d.fecha].join(','));
    const blob = new Blob([header+'\n'+lines.join('\n')], { type:'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'devoluciones.csv'; a.click();
  }

  const counts = { all: SSData.devoluciones.length, pendiente:0, aprobada:0, procesada:0, rechazada:0 };
  SSData.devoluciones.forEach(d => { if (counts[d.estado]!==undefined) counts[d.estado]++; });

  const totalMonto = SSData.devoluciones.reduce((s,d) => s + d.total, 0);
  const totalPendiente = SSData.devoluciones.filter(d => d.estado === 'pendiente').reduce((s,d) => s + d.total, 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Devoluciones</h1>
          <div className="page-subtitle">{SSData.devoluciones.length} devoluciones · {counts.pendiente} pendientes de aprobación</div>
        </div>
        <div className="page-actions">
          <button className="btn secondary"><Icon name="download" size={14}/>Exportar</button>
          {window.canUser?.('crear','devoluciones') !== false && (
            <button className="btn primary" onClick={() => setShowNueva(true)}><Icon name="plus" size={14}/>Nueva devolución</button>
          )}
          <button className="btn ghost" onClick={() => setShowActivity(true)} title="Ver registro de actividad"><Icon name="receipt" size={14}/>Actividad</button>
        </div>
      </div>

      {showActivity && <ActivityLogModal modulo="devoluciones" onClose={()=>setShowActivity(false)}/>}

      <div className="stat-grid hide-sm">
        <div className="stat">
          <div className="stat-label">Total devuelto</div>
          <div className="stat-val" style={{color:'var(--danger)'}}>{fmt.usd(totalMonto)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Pendientes aprobación</div>
          <div className="stat-val" style={{color:'var(--warn)'}}>{counts.pendiente}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Monto pendiente</div>
          <div className="stat-val" style={{color:'var(--warn)'}}>{fmt.usd(totalPendiente)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Procesadas este mes</div>
          <div className="stat-val">{counts.procesada + counts.aprobada}</div>
        </div>
      </div>

      <div className="tbl-wrap mt-4">
        <div className="tbl-toolbar">
          <div className="search-box">
            <Icon name="search" size={14}/>
            <input className="search-input" placeholder="Buscar por ID, factura o cliente…" value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <div style={{display:'flex', gap:4, marginLeft:8}}>
            {['all','pendiente','aprobada','procesada','rechazada'].map(f => (
              <button key={f} className={'btn sm '+(filter===f?'primary':'ghost')} onClick={() => { setFilter(f); setPage(1); setSelected(new Set()); }}>
                {f==='all'?'Todas':ESTADO_LABEL[f]}
                {f!=='all' && counts[f]>0 && <span style={{marginLeft:4, background:'rgba(255,255,255,.25)', borderRadius:99, padding:'1px 5px', fontSize:10}}>{counts[f]}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{width:36}}>
                  <input type="checkbox" checked={allChecked} ref={el => { if (el) el.indeterminate = someChecked; }}
                    onChange={toggleAll} style={{cursor:'pointer'}}/>
                </th>
                <th>Devolución</th>
                <th className="hide-sm">Factura</th>
                <th>Cliente</th>
                <th className="hide-sm">Motivo</th>
                <th className="num hide-sm">Ítems</th>
                <th className="num hide-sm">Subtotal</th>
                <th className="num hide-sm">IVA 16%</th>
                <th className="num">Total NC</th>
                <th className="hide-sm">Reembolso</th>
                <th>Estado</th>
                <th className="hide-sm">Fecha</th>
                <th className="dt-hide-mobile">Creado por</th>
                <th style={{width:48}}></th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 && (
                <tr><td colSpan={14} style={{textAlign:'center', padding:'32px 0', color:'var(--text-muted)'}}>Sin devoluciones{filter !== 'all' ? ' con este filtro' : ''}</td></tr>
              )}
              {paginated.map(d => {
                const isSel  = selected.has(d.id);
                const metodo = METODOS_REEMBOLSO.find(m => m.id === d.reembolso?.metodo);
                return (
                  <tr key={d.id} style={{cursor:'pointer', background: isSel ? 'var(--brand-soft, #eff6ff)' : ''}}
                      onClick={() => selected.size > 0 ? toggleOne(d.id) : setDetail(d)}>
                    <td onClick={e=>e.stopPropagation()}>
                      <input type="checkbox" checked={isSel} onChange={() => toggleOne(d.id)} style={{cursor:'pointer'}}/>
                    </td>
                    <td className="mono-cell">
                      <div>{d.id}</div>
                      <div className="show-sm-only small muted" style={{fontSize:11, marginTop:2, fontFamily:'var(--mono)'}}>
                        {d.factura_id} · {fmt.date(d.fecha)} · {d.items.length} ítems
                      </div>
                    </td>
                    <td className="mono-cell muted hide-sm">{d.factura_id}</td>
                    <td>
                      <div style={{fontWeight:500, fontSize:13}}>{d.cliente?.nombre || d.cliente_id}</div>
                      <div className="small muted">{d.cliente?.rif}</div>
                      <div className="show-sm-only small muted" style={{fontSize:11, marginTop:2}}>{d.motivo}</div>
                    </td>
                    <td className="hide-sm" style={{fontSize:13, color:'var(--text-2)'}}>{d.motivo}</td>
                    <td className="num hide-sm">{d.items.length}</td>
                    <td className="num hide-sm">{fmt.usd(d.subtotal)}</td>
                    <td className="num muted hide-sm">{fmt.usd(d.iva)}</td>
                    <td className="num" style={{fontWeight:700}}>{fmt.usd(d.total)}</td>
                    <td className="hide-sm">
                      <div style={{fontSize:12}}>{metodo?.label.split('(')[0].trim() || d.reembolso?.metodo}</div>
                      {d.reembolso?.estado === 'procesado'
                        ? <span className="chip green" style={{fontSize:10}}>Procesado</span>
                        : <span className="chip amber" style={{fontSize:10}}>Pendiente</span>}
                    </td>
                    <td>
                      <span className={'chip '+(ESTADO_COLOR[d.estado]||'neutral')}>{ESTADO_LABEL[d.estado]||d.estado}</span>
                      {/* Devoluciones automáticas (anular factura/despacho) ya entran 'procesada' —
                          el inventario se restituyó como PARTE de esa anulación, no de un aprobar
                          manual acá. El tooltip explica por qué no pasó por el flujo normal. */}
                      {d.notas && /^Devolución automática/.test(d.notas) && (
                        <span title={d.notas} style={{marginLeft:5, display:'inline-flex', verticalAlign:'middle'}}>
                          <Icon name="info" size={10}/>
                        </span>
                      )}
                    </td>
                    <td className="muted hide-sm">{fmt.date(d.fecha)}</td>
                    <td className="dt-hide-mobile"><CreadoPorCell nombre={d.creado_por}/></td>
                    <td onClick={e=>e.stopPropagation()}>
                      <div style={{display:'flex', gap:4}}>
                        <button className="icon-btn" onClick={() => setDetail(d)}><Icon name="external" size={14}/></button>
                        {window.canUser?.('eliminar','devoluciones') !== false && <button className="icon-btn danger" title="Eliminar" onClick={() => {
                          if (!confirm('¿Eliminar esta devolución? Se enviará a la papelera.')) return;
                          window.deleteDev([d.id]).then(({ error }) => {
                            if (error) { alert('Error al eliminar: ' + error.message); return; }
                            window.ssTrash?.add('devolucion', d.id, d);
                            window.refrescarFase2().then(() => refresh());
                          });
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
            <span className="muted">{rows.length===0?'0':`Mostrando ${(page-1)*pageSize+1}–${Math.min(page*pageSize,rows.length)} de ${rows.length}`}</span>
          </div>
          {totalPages>1&&<div style={{display:'flex',gap:4}}>
            <button className="btn sm ghost" disabled={page===1} onClick={() => setPage(p=>p-1)}>‹</button>
            {Array.from({length:Math.min(5,totalPages)}, (_,idx) => {
              const start = Math.max(1, Math.min(page-2, totalPages-4));
              const p = start+idx;
              return p>=1 && p<=totalPages ? (<button key={p} className={'btn sm '+(page===p?'primary':'ghost')} onClick={()=>setPage(p)}>{p}</button>) : null;
            })}
            <button className="btn sm ghost" disabled={page===totalPages} onClick={() => setPage(p=>p+1)}>›</button>
          </div>}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="docs-bulk-bar" style={{position:'fixed',bottom:28,left:'50%',transform:'translateX(-50%)',background:'var(--bg-elev)',border:'1px solid var(--border)',borderRadius:16,boxShadow:'0 12px 40px rgba(0,0,0,.35)',display:'flex',alignItems:'center',gap:6,padding:'10px 14px',zIndex:300,backdropFilter:'blur(12px)',flexWrap:'wrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,paddingRight:10,borderRight:'1px solid var(--border)',marginRight:4}}>
            <div style={{width:24,height:24,borderRadius:8,background:'var(--brand)',display:'grid',placeItems:'center',color:'#fff',fontSize:11,fontWeight:700}}>{selected.size}</div>
            <span style={{fontSize:13,fontWeight:600}}>devolución{selected.size!==1?'es':''} seleccionada{selected.size!==1?'s':''}</span>
          </div>
          <button className="btn ghost sm" onClick={exportCSV}><Icon name="download" size={13}/>Exportar CSV</button>
          {window.canUser?.('editar','devoluciones') !== false && <button className="btn ghost sm" style={{color:'var(--success)'}} onClick={handleBulkApprove}><Icon name="check" size={13}/>Aprobar</button>}
          {window.canUser?.('eliminar','devoluciones') !== false && <button className="btn ghost sm" style={{color:'var(--danger)'}} onClick={handleBulkDelete}><Icon name="trash" size={13}/>Eliminar</button>}
          <button className="icon-btn" onClick={() => setSelected(new Set())} style={{marginLeft:4}}><Icon name="x" size={15}/></button>
        </div>
      )}

      {showNueva && (
        <NuevaDevolucionModal
          onClose={() => setShowNueva(false)}
          onSave={async (dev) => {
            const { error } = await window.saveDev(dev);
            if (error) { alert('Error al guardar: ' + error.message); return; }
            window.logActivity?.({ modulo:'devoluciones', accion:'crear', entidad_id: dev.id, entidad_label: dev.id, detalles:{ factura: dev.factura_id, total: dev.total } });
            await window.refrescarFase2();
            refresh();
            setShowNueva(false);
          }}
        />
      )}

      {detail && (
        <DevolucionDetailModal
          devolucion={detail}
          onClose={() => setDetail(null)}
          onUpdate={async () => { await window.refrescarFase2(); refresh(); setDetail(null); }}
        />
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════
//  NuevaDevolucionModal — 4-step wizard
// ══════════════════════════════════════════════════════════════════════════
function NuevaDevolucionModal({ onClose, onSave }) {
  const STEPS = ['factura', 'items', 'detalles', 'resumen'];
  const [step, setStep]         = useState('factura');
  const [factSearch, setFactSearch] = useState('');
  const [factura, setFactura]   = useState(null);
  const [factLines, setFactLines] = useState([]);
  const [selItems, setSelItems] = useState([]);
  const [motivo, setMotivo]     = useState('');
  // 'alm-01' no existe en `almacenes` (ver getAlmacenDefault en pos.jsx, que es eager y expone el
  // helper): la devolución entraba a un almacén fantasma. Se resuelve al de la empresa activa.
  const [almacenId, setAlmacenId] = useState(() => window.getAlmacenDefault?.() || '');
  const [reembolso, setReembolso] = useState({ metodo: 'credito_cuenta', banco: '', referencia: '' });
  const [notas, setNotas]       = useState('');
  const [saving, setSaving]     = useState(false);
  // BR-INV-S07: S/N vendidos en esta factura (por SKU) y selección por item
  const [serialesFactura, setSerialesFactura] = useState({});  // { sku: [{id, serial, garantia_meses}] }
  const [serialesSelByItem, setSerialesSelByItem] = useState({});  // { sku: Set<id> }

  const stepIdx   = STEPS.indexOf(step);
  const pct       = ((stepIdx + 1) / STEPS.length) * 100;
  const almacenes = window.getAlmacenes ? window.getAlmacenes() : SSData.almacenes;

  // Invoice search
  const facturaResults = useMemo(() => {
    if (!factSearch.trim()) return getFacturas().slice(0, 8);
    const q = factSearch.toLowerCase();
    return getFacturas().filter(f => {
      const cli = SSData.clientes.find(c => c.id === f.cliente);
      return f.id.toLowerCase().includes(q) || cli?.nombre.toLowerCase().includes(q);
    }).slice(0, 10);
  }, [factSearch]);

  function selectFactura(f) {
    setFactura(f);
    const lines = (window.linesFor ? window.linesFor(f) : []);
    setFactLines(lines);
    setSelItems(lines.map(l => ({ ...l, qty_facturada: l.qty, qty_devuelta: l.qty, checked: false, subtotal: l.qty * l.precio })));
    setSerialesSelByItem({});
    // BR-INV-S07: cargar S/N vendidos asociados a esta factura/despacho
    const empresa = window.currentEmpresa || 'demo1';
    const docIds = [f.id];
    // Si la factura tiene despachos asociados, los S/N pueden estar contra el despacho
    window.sb.from('inventario_seriales')
      .select('id,serial,sku,garantia_meses,documento_id')
      .eq('empresa_id', empresa).eq('estado', 'vendido').in('documento_id', docIds)
      .then(({ data }) => {
        const map = {};
        (data || []).forEach(s => { if (!map[s.sku]) map[s.sku] = []; map[s.sku].push(s); });
        setSerialesFactura(map);
      });
  }

  function toggleSerialDev(sku, id, maxQty) {
    setSerialesSelByItem(prev => {
      const cur = new Set(prev[sku] || []);
      if (cur.has(id)) cur.delete(id);
      else if (cur.size < maxQty) cur.add(id);
      return { ...prev, [sku]: cur };
    });
  }

  function toggleItem(idx) {
    setSelItems(items => items.map((it, i) => i===idx ? { ...it, checked: !it.checked, qty_devuelta: it.checked ? 0 : it.qty_facturada, subtotal: it.checked ? 0 : it.qty_facturada * it.precio } : it));
  }
  function toggleAllItems() {
    const marcar = !(selItems.length > 0 && selItems.every(i => i.checked));
    setSelItems(items => items.map(it => ({ ...it, checked: marcar, qty_devuelta: marcar ? it.qty_facturada : 0, subtotal: marcar ? it.qty_facturada * it.precio : 0 })));
  }

  function setQty(idx, val) {
    setSelItems(items => items.map((it, i) => {
      if (i !== idx) return it;
      const q = Math.max(1, Math.min(it.qty_facturada, parseInt(val)||1));
      return { ...it, qty_devuelta: q, subtotal: q * it.precio };
    }));
  }

  const checkedItems = selItems.filter(i => i.checked);
  const totals = calcTotals(checkedItems);

  function canGoNext() {
    if (step === 'factura')  return !!factura;
    if (step === 'items') {
      if (checkedItems.length === 0) return false;
      // BR-INV-S07: si hay items serializados checked, cada uno debe tener qty_devuelta S/N seleccionados
      for (const it of checkedItems) {
        const prod = (SSData.productos || []).find(p => p.sku === it.sku);
        if (!prod?.serializado) continue;
        const sel = serialesSelByItem[it.sku] || new Set();
        if (sel.size < it.qty_devuelta) return false;
      }
      return true;
    }
    if (step === 'detalles') return !!motivo && !!almacenId;
    return true;
  }

  async function handleSubmit() {
    setSaving(true);
    const items = checkedItems.map(i => {
      const selSet = serialesSelByItem[i.sku] || new Set();
      return {
        sku: i.sku, nombre: i.nombre,
        qty_facturada: i.qty_facturada, qty_devuelta: i.qty_devuelta,
        precio: i.precio, subtotal: i.subtotal,
        // BR-INV-S07: persistir IDs de S/N devueltos para auditoría y display
        seriales_devueltos: [...selSet],
      };
    });
    // Correlativo atómico server-side (DEV-2026-N, único por empresa+año).
    // Fallback al generador client-side legacy si el RPC no está disponible.
    const devId = (await window.nextCorrelativo?.('DEV')) || getNextDevId();
    const dev = {
      id: devId,
      factura_id: factura.id,
      cliente_id: factura.cliente,
      fecha: new Date().toISOString(),
      motivo,
      items,
      ...totals,
      almacen_id: almacenId,
      estado: 'pendiente',
      nota_credito_id: null,
      reembolso: { ...reembolso, estado: 'pendiente' },
      notas,
      creado_por: window.__ssCurrentUser?.nombre || window.currentUserRole || 'Usuario',
      aprobado_por: null,
      fecha_aprobacion: null,
    };
    await onSave(dev);

    // BR-INV-S07: los S/N seleccionados se persisten en items[].seriales_devueltos,
    // pero NO se marcan 'devuelto' al crear (la devolución nace 'pendiente'). El cambio
    // de estado del serial se difiere a la APROBACIÓN (DevolucionDetailModal.handleApprove)
    // para que una devolución RECHAZADA no deje los S/N huérfanos (estado 'devuelto' sin
    // cliente ni garantía, irreversible desde la UI). Ver bug #16 del audit 2026-06-19.
    setSaving(false);
  }

  const cli = factura ? SSData.clientes.find(c => c.id === factura.cliente) : null;

  // ── Step header ───────────────────────────────────────────────────────
  function StepHeader() {
    const labels = ['Seleccionar Factura', 'Ítems a devolver', 'Detalles', 'Resumen y confirmación'];
    return (
      <div style={{marginBottom:20}}>
        <div style={{display:'flex', justifyContent:'space-between', marginBottom:6}}>
          {labels.map((l,i) => (
            <span key={i} style={{fontSize:11, fontWeight: i===stepIdx?700:400, color: i<=stepIdx?'var(--brand)':'var(--text-muted)'}}>
              {i+1}. {l}
            </span>
          ))}
        </div>
        <div style={{height:4, borderRadius:99, background:'var(--border)'}}>
          <div style={{height:'100%', width:pct+'%', borderRadius:99, background:'var(--brand)', transition:'width .25s'}}/>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width:720, maxHeight:'92vh', display:'flex', flexDirection:'column'}}>
        <div className="modal-header" style={{flexShrink:0}}>
          <div style={{width:40,height:40,borderRadius:10,background:'var(--danger-soft)',color:'var(--danger)',display:'grid',placeItems:'center'}}>
            <Icon name="arrDn" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">Nueva Devolución</h3>
            <div className="small muted">Paso {stepIdx+1} de {STEPS.length}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        <div className="modal-body" style={{flex:1, overflowY:'auto'}}>
          <StepHeader/>

          {/* ── STEP 1: Seleccionar factura ── */}
          {step === 'factura' && (
            <div>
              <div style={{marginBottom:16}}>
                <label className="form-label">Buscar factura por ID o cliente</label>
                <div className="search-box" style={{width:'100%', marginTop:4}}>
                  <Icon name="search" size={14}/>
                  <input className="search-input" style={{flex:1}} placeholder="FAC-2026-… o nombre del cliente" value={factSearch} onChange={e=>setFactSearch(e.target.value)}/>
                </div>
              </div>

              <div style={{border:'1px solid var(--border)', borderRadius:10, overflow:'hidden', marginBottom: factura ? 16 : 0}}>
                {facturaResults.map((f, i) => {
                  const c = SSData.clientes.find(cl => cl.id === f.cliente);
                  const isSelected = factura?.id === f.id;
                  return (
                    <div key={f.id} onClick={() => selectFactura(f)} style={{
                      display:'flex', alignItems:'center', gap:12, padding:'12px 16px',
                      borderBottom: i < facturaResults.length-1 ? '1px solid var(--border)' : 'none',
                      cursor:'pointer', background: isSelected ? 'var(--brand-soft)' : 'inherit',
                      transition:'background .1s',
                    }}>
                      <div style={{width:36,height:36,borderRadius:8,background: isSelected?'var(--brand)':'var(--bg-sunken)',color:isSelected?'#fff':'var(--text-muted)',display:'grid',placeItems:'center',flexShrink:0}}>
                        <Icon name="receipt" size={16}/>
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:600, fontSize:13, fontFamily:'var(--font-mono)'}}>{f.id}</div>
                        <div className="small">{c?.nombre || f.cliente} · {fmt.date(f.fecha)}</div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontWeight:700, fontSize:14}}>{fmt.usd(f.total)}</div>
                        <div className="small muted">{f.items} ítems</div>
                      </div>
                      {isSelected && <Icon name="check" size={16} style={{color:'var(--brand)', flexShrink:0}}/>}
                    </div>
                  );
                })}
                {facturaResults.length === 0 && (
                  <div style={{textAlign:'center', padding:'24px 0', color:'var(--text-muted)', fontSize:13}}>No se encontraron facturas</div>
                )}
              </div>

              {factura && (
                <div className="card" style={{padding:16, background:'var(--bg-sunken)', border:'2px solid var(--brand)'}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                    <div>
                      <div style={{fontWeight:700, fontSize:15, fontFamily:'var(--font-mono)'}}>{factura.id}</div>
                      <div style={{fontSize:13, marginTop:2}}>{cli?.nombre} · {fmt.date(factura.fecha)}</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontWeight:700, fontSize:18, color:'var(--brand)'}}>{fmt.usd(factura.total)}</div>
                      <div className="small muted">{factura.items} ítems facturados</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: Seleccionar ítems ── */}
          {step === 'items' && (
            <div>
              <div style={{fontSize:13, color:'var(--text-2)', marginBottom:12}}>
                Selecciona los productos a devolver y ajusta las cantidades.
                La cantidad máxima devuelta no puede superar la cantidad facturada.
              </div>
              <div className="tbl-wrap" style={{marginBottom:12}}>
                <div className="tbl-scroll">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th style={{width:40}}>
                          <input type="checkbox" title="Seleccionar todos los ítems"
                            checked={selItems.length > 0 && selItems.every(i => i.checked)}
                            ref={el => { if (el) el.indeterminate = selItems.some(i => i.checked) && !selItems.every(i => i.checked); }}
                            onChange={toggleAllItems} style={{cursor:'pointer'}}/>
                        </th>
                        <th>Producto</th>
                        <th className="num">Fact.</th>
                        <th className="num" style={{width:140}}>Cant. a devolver</th>
                        <th className="num">Precio unit.</th>
                        <th className="num">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selItems.map((it, idx) => {
                        const prod = (SSData.productos || []).find(p => p.sku === it.sku);
                        const esSerializado = prod?.serializado;
                        const seriales = serialesFactura[it.sku] || [];
                        const selSet = serialesSelByItem[it.sku] || new Set();
                        return (
                          <React.Fragment key={idx}>
                            <tr style={{background: it.checked ? 'var(--brand-soft)' : 'inherit', opacity: it.checked ? 1 : 0.6}}>
                              <td>
                                <input type="checkbox" checked={it.checked} onChange={() => toggleItem(idx)}
                                  style={{width:16, height:16, cursor:'pointer'}}/>
                              </td>
                              <td>
                                <div style={{fontWeight:500, fontSize:13}}>{it.nombre}</div>
                                <div className="small mono-cell muted">{it.sku}{esSerializado && <span style={{marginLeft:6, fontSize:10, padding:'1px 6px', borderRadius:8, background:'var(--brand-soft)', color:'var(--brand)', fontWeight:600}}>serializado</span>}</div>
                              </td>
                              <td className="num">{it.qty_facturada}</td>
                              <td className="num">
                                {it.checked ? (
                                  <div style={{display:'flex', alignItems:'center', justifyContent:'flex-end', gap:6}}>
                                    <button onClick={() => setQty(idx, it.qty_devuelta-1)}
                                      style={{width:26,height:26,borderRadius:99,border:'1px solid var(--border)',background:'var(--bg-sunken)',cursor:'pointer',display:'grid',placeItems:'center'}}>
                                      <Icon name="dash" size={12}/>
                                    </button>
                                    <input type="number" value={it.qty_devuelta} min={1} max={it.qty_facturada}
                                      onChange={e => setQty(idx, e.target.value)}
                                      style={{width:48, textAlign:'center', border:'1px solid var(--border)', borderRadius:6, padding:'4px 0', fontSize:14, fontWeight:700}}/>
                                    <button onClick={() => setQty(idx, it.qty_devuelta+1)}
                                      style={{width:26,height:26,borderRadius:99,border:'1px solid var(--border)',background:'var(--bg-sunken)',cursor:'pointer',display:'grid',placeItems:'center'}}>
                                      <Icon name="plus" size={12}/>
                                    </button>
                                  </div>
                                ) : <span className="muted">—</span>}
                              </td>
                              <td className="num">{fmt.usd(it.precio)}</td>
                              <td className="num" style={{fontWeight:700, color: it.checked ? 'var(--danger)' : 'var(--text-muted)'}}>
                                {it.checked ? fmt.usd(it.subtotal) : '—'}
                              </td>
                            </tr>
                            {/* BR-INV-S07: selección de S/N para items serializados */}
                            {it.checked && esSerializado && (
                              <tr style={{background:'var(--bg-sunken)'}}>
                                <td></td>
                                <td colSpan={5} style={{padding:'10px 12px'}}>
                                  <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8}}>
                                    <Icon name="check" size={12} style={{color:'var(--brand)'}}/>
                                    <strong style={{fontSize:11.5, textTransform:'uppercase', letterSpacing:0.5}}>S/N a devolver</strong>
                                    <span style={{marginLeft:'auto', fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:10,
                                      background: selSet.size === it.qty_devuelta ? 'var(--success)' : 'var(--warn)', color:'#fff'}}>
                                      {selSet.size}/{it.qty_devuelta}
                                    </span>
                                  </div>
                                  {seriales.length === 0 ? (
                                    <div className="small muted" style={{padding:'8px 0', fontStyle:'italic'}}>
                                      No hay S/N registrados como vendidos en esta factura para este SKU. Si el cliente tiene un equipo físico con S/N, registralo manualmente en Inventario primero, o continúa sin selección si el ítem se vendió sin S/N.
                                    </div>
                                  ) : (
                                    <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))', gap:6}}>
                                      {seriales.map(s => {
                                        const checked = selSet.has(s.id);
                                        const disabled = !checked && selSet.size >= it.qty_devuelta;
                                        return (
                                          <label key={s.id} style={{
                                            display:'flex', alignItems:'center', gap:6, padding:'5px 8px', borderRadius:5,
                                            background: checked ? 'var(--brand-soft)' : 'var(--bg-elev)',
                                            border: '1px solid ' + (checked ? 'var(--brand)' : 'var(--border)'),
                                            cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
                                          }}>
                                            <input type="checkbox" checked={checked} disabled={disabled}
                                              onChange={() => toggleSerialDev(it.sku, s.id, it.qty_devuelta)}
                                              style={{width:14, height:14}}/>
                                            <span style={{fontFamily:'var(--mono)', fontSize:11.5, fontWeight:500}}>{s.serial}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              {checkedItems.length > 0 && (
                <div style={{display:'flex', justifyContent:'flex-end'}}>
                  <div style={{background:'var(--bg-sunken)', borderRadius:10, padding:'12px 20px', minWidth:280}}>
                    <div style={{display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:4}}>
                      <span className="muted">Subtotal devolución</span>
                      <span>{fmt.usd(totals.subtotal)}</span>
                    </div>
                    <div style={{display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:8}}>
                      <span className="muted">IVA 16%</span>
                      <span>{fmt.usd(totals.iva)}</span>
                    </div>
                    <div style={{display:'flex', justifyContent:'space-between', fontSize:16, fontWeight:700, paddingTop:8, borderTop:'1px solid var(--border)'}}>
                      <span>Total Nota Crédito</span>
                      <span style={{color:'var(--danger)'}}>{fmt.usd(totals.total)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Detalles ── */}
          {step === 'detalles' && (
            <div>
              <div className="grid-2" style={{marginBottom:16}}>
                <div>
                  <label className="form-label">Motivo de devolución *</label>
                  <select className="select" style={{width:'100%'}} value={motivo} onChange={e=>setMotivo(e.target.value)}>
                    <option value="">— Seleccionar motivo —</option>
                    {MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Almacén destino de la mercancía *</label>
                  <select className="select" style={{width:'100%'}} value={almacenId} onChange={e=>setAlmacenId(e.target.value)}>
                    {almacenes.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select>
                </div>
              </div>

              <div style={{marginBottom:16, padding:14, background:'var(--bg-sunken)', borderRadius:10}}>
                <div style={{fontWeight:600, fontSize:13, marginBottom:12}}>Método de reembolso</div>
                <div style={{display:'flex', flexDirection:'column', gap:10}}>
                  {METODOS_REEMBOLSO.map(m => (
                    <label key={m.id} style={{display:'flex', alignItems:'center', gap:10, cursor:'pointer', padding:'10px 14px', borderRadius:8, border:'1.5px solid '+(reembolso.metodo===m.id?'var(--brand)':'var(--border)'), background:reembolso.metodo===m.id?'var(--brand-soft)':'var(--bg-elev)', transition:'all .1s'}}>
                      <input type="radio" name="metodo" value={m.id} checked={reembolso.metodo===m.id} onChange={() => setReembolso(r => ({...r, metodo:m.id}))} style={{accentColor:'var(--brand)'}}/>
                      <div>
                        <div style={{fontWeight:500, fontSize:13}}>{m.label}</div>
                        {m.id === 'credito_cuenta' && <div className="small muted">Se abona a la cuenta del cliente y reduce su deuda pendiente</div>}
                        {m.id === 'transferencia'  && <div className="small muted">Transferencia bancaria directa al cliente</div>}
                      </div>
                    </label>
                  ))}
                </div>

                {(reembolso.metodo === 'transferencia' || reembolso.metodo === 'cheque') && (
                  <div className="grid-2" style={{marginTop:14}}>
                    <div>
                      <label className="form-label">Banco</label>
                      <input className="input" value={reembolso.banco} onChange={e=>setReembolso(r=>({...r,banco:e.target.value}))} placeholder="Banesco USD"/>
                    </div>
                    <div>
                      <label className="form-label">N° cuenta / referencia</label>
                      <input className="input" value={reembolso.referencia} onChange={e=>setReembolso(r=>({...r,referencia:e.target.value}))} placeholder="0134-****"/>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="form-label">Notas internas</label>
                <textarea className="input" rows={3} style={{resize:'vertical', width:'100%', boxSizing:'border-box'}}
                  value={notas} onChange={e=>setNotas(e.target.value)}
                  placeholder="Descripción del estado del producto, observaciones de recepción…"/>
              </div>
            </div>
          )}

          {/* ── STEP 4: Resumen ── */}
          {step === 'resumen' && (
            <div>
              {/* Header info */}
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:20}}>
                <div style={{background:'var(--bg-sunken)', borderRadius:10, padding:'12px 16px'}}>
                  <div className="form-label">Factura original</div>
                  <div style={{fontWeight:700, fontFamily:'var(--font-mono)', fontSize:14, marginTop:4}}>{factura?.id}</div>
                  <div className="small muted">{fmt.usd(factura?.total||0)}</div>
                </div>
                <div style={{background:'var(--bg-sunken)', borderRadius:10, padding:'12px 16px'}}>
                  <div className="form-label">Cliente</div>
                  <div style={{fontWeight:600, fontSize:13, marginTop:4}}>{cli?.nombre}</div>
                  <div className="small muted">{cli?.rif}</div>
                </div>
                <div style={{background:'var(--bg-sunken)', borderRadius:10, padding:'12px 16px'}}>
                  <div className="form-label">Almacén destino</div>
                  <div style={{fontWeight:600, fontSize:13, marginTop:4}}>{almacenes.find(a=>a.id===almacenId)?.nombre}</div>
                  <div className="small muted">Inventario se restituirá al aprobar</div>
                </div>
              </div>

              {/* Items */}
              <div style={{fontWeight:600, fontSize:13, marginBottom:8}}>Ítems a devolver</div>
              <table className="tbl" style={{marginBottom:16}}>
                <thead><tr><th>Producto</th><th className="num">Cant. devuelta</th><th className="num">Precio</th><th className="num">Subtotal</th></tr></thead>
                <tbody>
                  {checkedItems.map((it,i) => (
                    <tr key={i}>
                      <td><div style={{fontWeight:500, fontSize:13}}>{it.nombre}</div><div className="small mono-cell muted">{it.sku}</div></td>
                      <td className="num">{it.qty_devuelta} <span className="muted">/ {it.qty_facturada}</span></td>
                      <td className="num">{fmt.usd(it.precio)}</td>
                      <td className="num" style={{fontWeight:700, color:'var(--danger)'}}>{fmt.usd(it.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Financial + inventory side by side */}
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16}}>
                {/* Nota crédito */}
                <div style={{background:'var(--bg-sunken)', borderRadius:10, padding:16}}>
                  <div style={{fontWeight:600, fontSize:13, marginBottom:12, display:'flex', alignItems:'center', gap:6}}>
                    <Icon name="receipt" size={15} style={{color:'var(--brand)'}}/>Nota de Crédito
                  </div>
                  <div style={{fontSize:13}}>
                    <div style={{display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid var(--border)'}}>
                      <span className="muted">Subtotal</span><span>{fmt.usd(totals.subtotal)}</span>
                    </div>
                    <div style={{display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid var(--border)'}}>
                      <span className="muted">IVA 16%</span><span>{fmt.usd(totals.iva)}</span>
                    </div>
                    <div style={{display:'flex', justifyContent:'space-between', padding:'8px 0 0', fontWeight:700, fontSize:15}}>
                      <span>Total NC</span><span style={{color:'var(--danger)'}}>{fmt.usd(totals.total)}</span>
                    </div>
                  </div>
                </div>

                {/* Inventario */}
                <div style={{background:'var(--bg-sunken)', borderRadius:10, padding:16}}>
                  <div style={{fontWeight:600, fontSize:13, marginBottom:12, display:'flex', alignItems:'center', gap:6}}>
                    <Icon name="warehouse" size={15} style={{color:'var(--success)'}}/>Impacto en Inventario
                  </div>
                  <div className="small muted" style={{marginBottom:8}}>Al aprobar, se restituirán:</div>
                  {checkedItems.map((it,i) => (
                    <div key={i} style={{display:'flex', justifyContent:'space-between', fontSize:12, padding:'4px 0', borderBottom:'1px solid var(--border)'}}>
                      <span className="muted">{it.sku}</span>
                      <span style={{color:'var(--success)', fontWeight:600}}>+{it.qty_devuelta} uds</span>
                    </div>
                  ))}
                  <div className="small muted" style={{marginTop:8}}>→ {almacenes.find(a=>a.id===almacenId)?.nombre}</div>
                </div>
              </div>

              {/* Reembolso */}
              <div style={{background:'var(--bg-sunken)', borderRadius:10, padding:16, marginBottom:16}}>
                <div style={{fontWeight:600, fontSize:13, marginBottom:8, display:'flex', alignItems:'center', gap:6}}>
                  <Icon name="cash" size={15} style={{color:'var(--warn)'}}/>Solicitud de Reembolso
                </div>
                <div style={{display:'flex', gap:20, fontSize:13}}>
                  <div><span className="muted">Método:</span> <strong>{METODOS_REEMBOLSO.find(m=>m.id===reembolso.metodo)?.label}</strong></div>
                  {reembolso.banco && <div><span className="muted">Banco:</span> <strong>{reembolso.banco}</strong></div>}
                  <div><span className="muted">Monto:</span> <strong style={{color:'var(--danger)'}}>{fmt.usd(totals.total)}</strong></div>
                </div>
              </div>

              {/* Motivo + notas */}
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
                <div style={{background:'var(--bg-sunken)', borderRadius:8, padding:'10px 14px'}}>
                  <div className="form-label">Motivo</div>
                  <div style={{fontSize:13, marginTop:4}}>{motivo}</div>
                </div>
                {notas && (
                  <div style={{background:'var(--bg-sunken)', borderRadius:8, padding:'10px 14px'}}>
                    <div className="form-label">Notas</div>
                    <div style={{fontSize:13, marginTop:4}}>{notas}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer navigation */}
        <div className="modal-footer" style={{flexShrink:0, justifyContent:'space-between'}}>
          <div>
            {stepIdx > 0 && <button className="btn ghost" onClick={() => setStep(STEPS[stepIdx-1])}>← Atrás</button>}
          </div>
          <div style={{display:'flex', gap:8}}>
            <button className="btn secondary" onClick={onClose}>Cancelar</button>
            {stepIdx < STEPS.length - 1 && (
              <button className="btn primary" disabled={!canGoNext()} onClick={() => setStep(STEPS[stepIdx+1])}>
                Siguiente →
              </button>
            )}
            {stepIdx === STEPS.length - 1 && (
              <button className="btn primary" disabled={saving} onClick={handleSubmit}>
                {saving ? <><Icon name="refresh" size={13}/>Guardando…</> : <><Icon name="check" size={14}/>Crear devolución pendiente</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  DevolucionDetailModal
// ══════════════════════════════════════════════════════════════════════════
function DevolucionDetailModal({ devolucion, onClose, onUpdate }) {
  const [dev, setDev]               = useState({ ...devolucion });
  const [rechazarOpen, setRechazarOpen] = useState(false);
  const [motivoRechazo, setMotivoRechazo] = useState('');
  const [refInput, setRefInput]     = useState(dev.reembolso?.referencia || '');
  const [saving, setSaving]         = useState(false);

  const cliente  = SSData.clientes.find(c => c.id === dev.cliente_id);
  const almacen  = (window.getAlmacenes ? window.getAlmacenes() : SSData.almacenes).find(a => a.id === dev.almacen_id);
  const metodo   = METODOS_REEMBOLSO.find(m => m.id === dev.reembolso?.metodo);

  // Imprimir comprobante de devolución (PDF con firma del almacenista "Recibido por").
  function handlePrint() {
    const lines = (dev.items || []).map(it => ({
      sku: it.sku, nombre: it.nombre,
      qty: it.qty_devuelta, precio: it.precio, subtotal: it.subtotal,
    }));
    const obs = [
      dev.motivo ? `Motivo: ${dev.motivo}` : '',
      almacen?.nombre ? `Almacén receptor: ${almacen.nombre}` : '',
      dev.factura_id ? `Factura de origen: ${dev.factura_id}` : '',
      dev.nota_credito_id ? `Nota de crédito: ${dev.nota_credito_id}` : '',
      dev.notas ? `Notas: ${dev.notas}` : '',
    ].filter(Boolean).join('\n');
    const docShape = {
      id: dev.id,
      tipo: 'devolucion',
      empresa_id: window.currentEmpresa || 'demo1',
      cliente_id: dev.cliente_id,
      cliente: cliente?.nombre,
      fecha: (dev.fecha || '').slice(0, 10),
      vendedor: dev.creado_por,
      almacen_id: dev.almacen_id,
      aplica_iva: true,
      observaciones: obs,
    };
    window.generateDocumentPDF?.(docShape, lines, 'original');
    window.logActivity?.({ modulo:'devoluciones', accion:'editar', entidad_id: dev.id, entidad_label: dev.id, detalles:{ accion:'imprimir' } });
  }

  async function handleApprove() {
    setSaving(true);
    const res = await aprobarDevolucion(dev);
    if (res.error) { alert('Error al aprobar: ' + (res.error.message || JSON.stringify(res.error))); setSaving(false); return; }
    if (res.serialError) {
      alert('Devolución aprobada, pero error marcando S/N como devueltos: ' + (res.serialError.message || res.serialError) + '\nPodés marcarlos manualmente desde inventario.');
    }
    window.logActivity?.({ modulo:'devoluciones', accion:'editar', entidad_id: dev.id, entidad_label: dev.id, detalles:{ campo:'estado', valor:'aprobada', nota_credito: res.ncId } });
    setSaving(false);
    onUpdate();
  }

  async function handleReject() {
    if (!motivoRechazo.trim()) { alert('Ingresa el motivo de rechazo.'); return; }
    setSaving(true);
    const updated = { ...dev, estado: 'rechazada', motivo_rechazo: motivoRechazo, aprobado_por: window.__ssCurrentUser?.nombre || window.currentUserRole || 'Admin', fecha_aprobacion: new Date().toISOString() };
    const { error } = await window.saveDev(updated);
    if (error) { alert('Error al rechazar: ' + error.message); setSaving(false); return; }
    window.logActivity?.({ modulo:'devoluciones', accion:'editar', entidad_id: dev.id, entidad_label: dev.id, detalles:{ campo:'estado', valor:'rechazada' } });
    setSaving(false);
    onUpdate();
  }

  async function handleProcessReembolso() {
    setSaving(true);
    const updated = { ...dev, estado: 'procesada', reembolso: { ...dev.reembolso, estado: 'procesado', referencia: refInput } };
    const { error } = await window.saveDev(updated);
    if (error) { alert('Error al procesar reembolso: ' + error.message); setSaving(false); return; }
    window.logActivity?.({ modulo:'devoluciones', accion:'editar', entidad_id: dev.id, entidad_label: dev.id, detalles:{ campo:'estado', valor:'procesada' } });
    setSaving(false);
    onUpdate();
  }

  const isPendiente = dev.estado === 'pendiente';
  const isAprobada  = dev.estado === 'aprobada';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width:720, maxHeight:'92vh', display:'flex', flexDirection:'column'}}>
        <div className="modal-header" style={{flexShrink:0}}>
          <div style={{width:44, height:44, borderRadius:10, background:'var(--danger-soft)', color:'var(--danger)', display:'grid', placeItems:'center'}}>
            <Icon name="arrDn" size={22}/>
          </div>
          <div style={{flex:1}}>
            <div style={{display:'flex', alignItems:'center', gap:10}}>
              <h3 className="modal-title">{dev.id}</h3>
              <span className={'chip '+(ESTADO_COLOR[dev.estado]||'neutral')}>{ESTADO_LABEL[dev.estado]}</span>
              {dev.nota_credito_id && <span className="chip blue" style={{fontFamily:'var(--font-mono)', fontSize:11}}>{dev.nota_credito_id}</span>}
            </div>
            <div className="small muted">Factura {dev.factura_id} · {fmt.date(dev.fecha)}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        <div className="modal-body" style={{flex:1, overflowY:'auto'}}>
          {/* Client + meta */}
          <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:20}}>
            <div style={{background:'var(--bg-sunken)', borderRadius:10, padding:'12px 16px'}}>
              <div className="form-label">Cliente</div>
              <div style={{fontWeight:600, fontSize:14, marginTop:4}}>{cliente?.nombre}</div>
              <div className="small muted">{cliente?.rif}</div>
            </div>
            <div style={{background:'var(--bg-sunken)', borderRadius:10, padding:'12px 16px'}}>
              <div className="form-label">Motivo</div>
              <div style={{fontWeight:500, fontSize:13, marginTop:4}}>{dev.motivo}</div>
            </div>
            <div style={{background:'var(--bg-sunken)', borderRadius:10, padding:'12px 16px'}}>
              <div className="form-label">Almacén destino</div>
              <div style={{fontWeight:500, fontSize:13, marginTop:4}}>{almacen?.nombre || dev.almacen_id}</div>
              <div className="small" style={{color: dev.estado==='aprobada'||dev.estado==='procesada' ? 'var(--success)' : 'var(--text-muted)'}}>
                {dev.estado==='aprobada'||dev.estado==='procesada' ? 'Inventario restituido ✓' : 'Pendiente de aprobación'}
              </div>
            </div>
          </div>

          {/* Items table */}
          <div style={{fontWeight:600, fontSize:13, marginBottom:8}}>Ítems devueltos</div>
          <table className="tbl" style={{marginBottom:20}}>
            <thead><tr><th>Producto</th><th className="num">Fact.</th><th className="num">Devuelto</th><th className="num">Precio</th><th className="num">Subtotal</th></tr></thead>
            <tbody>
              {dev.items.map((item,i) => (
                <tr key={i}>
                  <td><div style={{fontWeight:500, fontSize:13}}>{item.nombre}</div><div className="small mono-cell muted">{item.sku}</div></td>
                  <td className="num muted">{item.qty_facturada}</td>
                  <td className="num"><span className="chip red">{item.qty_devuelta}</span></td>
                  <td className="num">{fmt.usd(item.precio)}</td>
                  <td className="num" style={{fontWeight:700}}>{fmt.usd(item.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Financials + reembolso */}
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:20}}>
            <div style={{background:'var(--bg-sunken)', borderRadius:10, padding:16}}>
              <div style={{fontWeight:600, fontSize:13, marginBottom:10}}>Nota de Crédito</div>
              <DetailRow label="Subtotal"  value={fmt.usd(dev.subtotal)}/>
              <DetailRow label="IVA 16%"   value={fmt.usd(dev.iva)}/>
              <div style={{display:'flex', justifyContent:'space-between', paddingTop:8, borderTop:'1px solid var(--border)', fontWeight:700, fontSize:15}}>
                <span>Total</span>
                <span style={{color:'var(--danger)'}}>{fmt.usd(dev.total)}</span>
              </div>
            </div>
            <div style={{background:'var(--bg-sunken)', borderRadius:10, padding:16}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                <div style={{fontWeight:600, fontSize:13}}>Reembolso</div>
                {dev.reembolso?.estado === 'procesado'
                  ? <span className="chip green">Procesado</span>
                  : <span className="chip amber">Pendiente</span>}
              </div>
              <DetailRow label="Método"   value={metodo?.label.split('(')[0].trim()}/>
              {dev.reembolso?.banco && <DetailRow label="Banco" value={dev.reembolso.banco}/>}
              {dev.reembolso?.referencia && <DetailRow label="Referencia" value={dev.reembolso.referencia}/>}
              <DetailRow label="Monto"    value={fmt.usd(dev.total)} bold danger/>

              {/* Process reembolso if approved and not yet done */}
              {isAprobada && dev.reembolso?.metodo !== 'credito_cuenta' && dev.reembolso?.estado !== 'procesado' && window.canUser?.('editar','devoluciones') !== false && (
                <div style={{marginTop:12, paddingTop:12, borderTop:'1px solid var(--border)'}}>
                  <label className="form-label">Referencia del pago</label>
                  <div style={{display:'flex', gap:8, marginTop:4}}>
                    <input className="input" style={{flex:1}} placeholder="N° de transacción / referencia" value={refInput} onChange={e=>setRefInput(e.target.value)}/>
                    <button className="btn primary sm" onClick={handleProcessReembolso} disabled={!refInput.trim() || saving}>
                      {saving ? 'Guardando…' : <><Icon name="check" size={13}/>Marcar pagado</>}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div style={{fontWeight:600, fontSize:13, marginBottom:10}}>Historial</div>
          <div style={{background:'var(--bg-sunken)', borderRadius:10, padding:'8px 16px'}}>
            <TimelineItem icon="plus"  color="var(--brand)"   label={`Creada por ${dev.creado_por}`}    date={dev.fecha}/>
            {dev.estado === 'aprobada' && <TimelineItem icon="check" color="var(--success)" label={`Aprobada por ${dev.aprobado_por}`} date={dev.fecha_aprobacion}/>}
            {dev.estado === 'procesada' && (
              <>
                <TimelineItem icon="check"  color="var(--success)" label={`Aprobada por ${dev.aprobado_por}`}  date={dev.fecha_aprobacion}/>
                <TimelineItem icon="dollar" color="var(--success)" label="Reembolso procesado" date={new Date().toISOString()}/>
              </>
            )}
            {dev.estado === 'rechazada' && <TimelineItem icon="x" color="var(--danger)" label={`Rechazada por ${dev.aprobado_por}${dev.motivo_rechazo ? ': '+dev.motivo_rechazo : ''}`} date={dev.fecha_aprobacion}/>}
          </div>

          {dev.notas && (
            <div style={{marginTop:16, padding:'12px 16px', background:'var(--bg-sunken)', borderRadius:8}}>
              <div className="form-label">Notas</div>
              <div style={{fontSize:13, marginTop:4, color:'var(--text-2)'}}>{dev.notas}</div>
            </div>
          )}
        </div>

        <div className="modal-footer" style={{flexShrink:0, justifyContent:'space-between'}}>
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cerrar</button>
          <div style={{display:'flex', gap:8}}>
            <button className="btn ghost" disabled={saving} onClick={handlePrint} title="Imprimir comprobante para firma del almacenista">
              <Icon name="download" size={14}/>Imprimir
            </button>
            {isPendiente && window.canUser?.('editar','devoluciones') !== false && (
              <>
                <button className="btn danger" disabled={saving} onClick={() => setRechazarOpen(true)}><Icon name="x" size={14}/>Rechazar</button>
                <button className="btn primary" disabled={saving} onClick={handleApprove}>
                  {saving ? <><Icon name="refresh" size={13}/>Guardando…</> : <><Icon name="check" size={14}/>Aprobar devolución</>}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {rechazarOpen && (
        <div className="modal-overlay" style={{zIndex:1100}} onClick={() => setRechazarOpen(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{width:420}}>
            <div className="modal-header">
              <h3 className="modal-title">Rechazar devolución</h3>
              <button className="icon-btn" onClick={() => setRechazarOpen(false)}><Icon name="x" size={16}/></button>
            </div>
            <div className="modal-body">
              <label className="form-label">Motivo del rechazo</label>
              <textarea className="input" rows={3} style={{resize:'vertical', width:'100%', boxSizing:'border-box', marginTop:4}} value={motivoRechazo} onChange={e=>setMotivoRechazo(e.target.value)} placeholder="Explica por qué se rechaza la devolución…"/>
            </div>
            <div className="modal-footer">
              <button className="btn ghost" onClick={() => setRechazarOpen(false)} disabled={saving}>Cancelar</button>
              <button className="btn danger" disabled={saving || !motivoRechazo.trim()} onClick={handleReject}>
                {saving ? 'Guardando…' : <><Icon name="x" size={14}/>Confirmar rechazo</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, bold, danger }) {
  return (
    <div style={{display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid var(--border)', fontSize:13}}>
      <span className="muted">{label}</span>
      <span style={{fontWeight: bold?700:400, color: danger?'var(--danger)':'inherit'}}>{value}</span>
    </div>
  );
}

function TimelineItem({ icon, color, label, date }) {
  return (
    <div style={{display:'flex', alignItems:'center', gap:12, padding:'10px 0', borderBottom:'1px solid var(--border)'}}>
      <div style={{width:28, height:28, borderRadius:99, background:color+'20', color, display:'grid', placeItems:'center', flexShrink:0}}>
        <Icon name={icon} size={13}/>
      </div>
      <div style={{flex:1, fontSize:13}}>{label}</div>
      <div className="small muted">{fmt.date(date)}</div>
    </div>
  );
}

Object.assign(window, { DevolucionesPage: window.DevolucionesPage });
