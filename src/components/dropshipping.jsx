// ====================== DROPSHIPPING MODULE ======================
// Gestión de listas de precios de múltiples proveedores + análisis comparativo + Shopify
const { useState, useEffect, useMemo, useRef } = React;

// ── Helpers de cálculo ───────────────────────────────────────────────────────
function getBestPrice(sku, precios) {
  let best = null;
  for (const [provId, pMap] of Object.entries(precios)) {
    if (pMap[sku] !== undefined) {
      if (best === null || pMap[sku] < best.precio)
        best = { precio: pMap[sku], provId };
    }
  }
  return best;
}

function getWorstPrice(sku, precios) {
  let worst = null;
  for (const [, pMap] of Object.entries(precios)) {
    if (pMap[sku] !== undefined) {
      if (worst === null || pMap[sku] > worst) worst = pMap[sku];
    }
  }
  return worst;
}

// ── Paleta de colores para nuevos proveedores ────────────────────────────────
const COLOR_PALETTE = ['#3b82f6','#8b5cf6','#f59e0b','#10b981','#ef4444','#ec4899','#06b6d4','#84cc16'];

// ════════════════════════════════════════════════════════════════════════════
// PÁGINA PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════
window.DropshippingPage = function DropshippingPage() {
  // Subtab persistido (estándar #4): al recargar conserva la pestaña activa en vez de volver a 'listas'.
  const [tab, setTab]             = useState(() => {
    const v = localStorage.getItem('ss-dropshipping-tab');
    return ['listas','comparador','shopify'].includes(v) ? v : 'listas';
  });
  useEffect(() => { localStorage.setItem('ss-dropshipping-tab', tab); }, [tab]);
  const [proveedores, setProveedores] = useState([]);
  const [productos, setProductos] = useState([]);
  const [precios, setPrecios]     = useState({});   // { provId: { sku: precio } }
  const [loading, setLoading]     = useState(true);
  const [showNuevo, setShowNuevo] = useState(false);
  const [showImport, setShowImport] = useState(false);

  async function reload() {
    setLoading(true);
    const data = await window.loadDropshippingData();
    setProveedores(data.proveedores || []);
    setProductos(data.productos || []);
    const map = {};
    (data.precios || []).forEach(p => {
      if (!map[p.proveedor_id]) map[p.proveedor_id] = {};
      map[p.proveedor_id][p.sku] = parseFloat(p.precio);
    });
    setPrecios(map);
    setLoading(false);
  }

  useEffect(() => { reload(); }, []);

  const totalProductos   = productos.length;
  const totalProveedores = proveedores.filter(p => p.activo).length;
  const publicados       = productos.filter(p => p.shopify_status === 'publicado').length;

  const ahorros = productos.map(p => {
    const best  = getBestPrice(p.sku, precios)?.precio;
    const worst = getWorstPrice(p.sku, precios);
    if (!best || !worst || best === worst) return 0;
    return ((worst - best) / worst) * 100;
  }).filter(v => v > 0);
  const avgAhorro = ahorros.length ? ahorros.reduce((s,v) => s+v, 0) / ahorros.length : 0;

  if (loading) return (
    <div className="page" style={{display:'grid', placeItems:'center', minHeight:300}}>
      <div style={{textAlign:'center', color:'var(--text-muted)'}}>
        <Icon name="sync" size={28}/><div style={{marginTop:10, fontSize:13}}>Cargando dropshipping…</div>
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dropshipping</h1>
          <div className="page-subtitle">Listas de precios de proveedores · Comparador · Sincronización Shopify</div>
        </div>
        <div className="page-actions">
          <button className="btn secondary" onClick={() => setTab('shopify')}><Icon name="sync" size={14}/>Shopify</button>
          {window.canUser?.('crear', 'dropshipping') !== false && (
            <button className="btn secondary" onClick={() => setShowImport(true)}><Icon name="upload" size={14}/>Importar lista</button>
          )}
          {window.canUser?.('crear', 'dropshipping') !== false && (
            <button className="btn primary" onClick={() => setShowNuevo(true)}><Icon name="plus" size={14}/>Nueva lista</button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20}}>
        {[
          { label:'Proveedores activos', value: totalProveedores, sub:'de '+proveedores.length+' registrados', color:'var(--brand)', icon:'suppliers' },
          { label:'Productos en listas', value: totalProductos,  sub:'SKUs únicos', color:'#8b5cf6', icon:'box' },
          { label:'Ahorro promedio',      value: avgAhorro.toFixed(1)+'%', sub:'entre mejor y peor proveedor', color:'var(--success)', icon:'price' },
          { label:'Publicados en Shopify',value: publicados+'/'+totalProductos, sub:productos.filter(p=>p.shopify_status==='error').length+' con error', color:'#f59e0b', icon:'external' },
        ].map(s => (
          <div key={s.label} className="card" style={{padding:14}}>
            <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8}}>
              <div style={{width:30, height:30, borderRadius:8, background:s.color+'18', color:s.color, display:'grid', placeItems:'center'}}>
                <Icon name={s.icon} size={15}/>
              </div>
              <div style={{fontSize:11.5, color:'var(--text-muted)'}}>{s.label}</div>
            </div>
            <div style={{fontSize:22, fontWeight:700, lineHeight:1}}>{s.value}</div>
            <div style={{fontSize:11, color:'var(--text-muted)', marginTop:4}}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{display:'flex', gap:2, borderBottom:'1px solid var(--border)', marginBottom:20}}>
        {[
          { id:'listas',     label:'Listas de proveedores', icon:'doc' },
          { id:'comparador', label:'Comparador de precios',  icon:'price' },
          { id:'shopify',    label:'Shopify Sync',           icon:'sync' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            display:'flex', alignItems:'center', gap:6, padding:'8px 16px', fontSize:13,
            fontWeight: tab===t.id ? 600 : 400, border:'none', background:'transparent', cursor:'pointer',
            borderBottom: tab===t.id ? '2px solid var(--brand)' : '2px solid transparent',
            color: tab===t.id ? 'var(--brand)' : 'var(--text-muted)', transition:'color .12s',
          }}>
            <Icon name={t.icon} size={14}/>{t.label}
          </button>
        ))}
      </div>

      {tab === 'listas'     && <ListasTab     proveedores={proveedores} productos={productos} precios={precios} reload={reload}/>}
      {tab === 'comparador' && <ComparadorTab proveedores={proveedores} productos={productos} precios={precios}/>}
      {tab === 'shopify'    && <ShopifyTab    proveedores={proveedores} productos={productos} precios={precios} reload={reload}/>}

      {showNuevo && (
        <NuevoProveedorModal
          existentes={proveedores}
          onClose={() => setShowNuevo(false)}
          onSave={async (prov) => {
            const { id, error } = await window.saveDsProv(prov);
            if (error) { alert('Error al guardar: ' + error.message); return; }
            window.logActivity?.({ modulo:'dropshipping', accion:'crear', entidad_id: id, entidad_label: prov.nombre, detalles:{ pais: prov.pais } });
            await reload();
            setShowNuevo(false);
            setTab('listas');
          }}
        />
      )}

      {showImport && (
        <DSImportModal
          proveedor={null}
          proveedores={proveedores}
          onClose={() => setShowImport(false)}
          onImport={async () => { setShowImport(false); await reload(); setTab('listas'); }}
        />
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// MODAL — Nuevo Proveedor (nueva lista)
// ════════════════════════════════════════════════════════════════════════════
function NuevoProveedorModal({ existentes, onClose, onSave, proveedorEdit }) {
  const isEdit = !!proveedorEdit;
  const [form, setForm] = useState({
    nombre:       proveedorEdit?.nombre       || '',
    pais:         proveedorEdit?.pais         || '',
    bandera:      proveedorEdit?.bandera      || '🌐',
    contacto:     proveedorEdit?.contacto     || '',
    email:        proveedorEdit?.email        || '',
    whatsapp:     proveedorEdit?.whatsapp     || '',
    dias_entrega: proveedorEdit?.dias_entrega || '',
    color:        proveedorEdit?.color        || COLOR_PALETTE[existentes.length % COLOR_PALETTE.length],
    activo:       proveedorEdit?.activo !== false,
    notas:        proveedorEdit?.notas        || '',
  });
  const [saving, setSaving] = useState(false);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    if (!form.nombre.trim()) { alert('El nombre es obligatorio'); return; }
    setSaving(true);
    await onSave({ ...form, id: proveedorEdit?.id });
    setSaving(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{width:560}}>
        <div className="modal-header">
          <div style={{width:40, height:40, borderRadius:10, background:form.color+'22', color:form.color, display:'grid', placeItems:'center', fontSize:20}}>
            {form.bandera}
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">{isEdit ? 'Editar proveedor' : 'Nuevo proveedor de dropshipping'}</h3>
            <div className="small muted">Se creará una lista de precios vacía que podrás importar</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          <div className="grid-2">
            <div>
              <label className="label">Nombre del proveedor *</label>
              <input className="input" placeholder="Ej. Import Alpha C.A." value={form.nombre} onChange={e => set('nombre', e.target.value)}/>
            </div>
            <div>
              <label className="label">País</label>
              <input className="input" placeholder="Ej. China" value={form.pais} onChange={e => set('pais', e.target.value)}/>
            </div>
          </div>
          <div className="grid-2 mt-3">
            <div>
              <label className="label">Bandera / Emoji</label>
              <input className="input" placeholder="🇨🇳" value={form.bandera} onChange={e => set('bandera', e.target.value)} style={{fontSize:18}}/>
            </div>
            <div>
              <label className="label">Días de entrega</label>
              <input className="input" placeholder="Ej. 15-20" value={form.dias_entrega} onChange={e => set('dias_entrega', e.target.value)}/>
            </div>
          </div>
          <div className="grid-2 mt-3">
            <div>
              <label className="label">Nombre del contacto</label>
              <input className="input" placeholder="Ej. Wei Zhang" value={form.contacto} onChange={e => set('contacto', e.target.value)}/>
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" placeholder="contacto@proveedor.com" value={form.email} onChange={e => set('email', e.target.value)}/>
            </div>
          </div>
          <div className="grid-2 mt-3">
            <div>
              <label className="label">WhatsApp</label>
              <input className="input" placeholder="+1 305 555 9876" value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)}/>
            </div>
            <div>
              <label className="label">Color de identificación</label>
              <div style={{display:'flex', gap:6, alignItems:'center', marginTop:4}}>
                <input type="color" value={form.color} onChange={e => set('color', e.target.value)} style={{width:36, height:36, borderRadius:6, border:'none', cursor:'pointer', padding:2}}/>
                <div style={{display:'flex', gap:4, flexWrap:'wrap'}}>
                  {COLOR_PALETTE.map(c => (
                    <div key={c} onClick={() => set('color', c)} style={{width:20, height:20, borderRadius:4, background:c, cursor:'pointer', border: form.color===c ? '2px solid var(--text)' : '2px solid transparent'}}/>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-3">
            <label className="label">Notas internas</label>
            <textarea className="input" rows={2} style={{resize:'vertical', width:'100%', boxSizing:'border-box'}} placeholder="Condiciones, tiempos de respuesta, etc." value={form.notas} onChange={e => set('notas', e.target.value)}/>
          </div>
          <div className="mt-3" style={{display:'flex', alignItems:'center', gap:8}}>
            <input type="checkbox" id="ds-activo" checked={form.activo} onChange={e => set('activo', e.target.checked)}/>
            <label htmlFor="ds-activo" style={{fontSize:13, cursor:'pointer'}}>Proveedor activo</label>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" disabled={saving || !form.nombre.trim()} onClick={handleSave}>
            {saving ? <><Icon name="refresh" size={13}/>Guardando…</> : <><Icon name="check" size={14}/>{isEdit ? 'Guardar cambios' : 'Crear proveedor'}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB 1 — LISTAS DE PROVEEDORES
// ════════════════════════════════════════════════════════════════════════════
function ListasTab({ proveedores, productos, precios, reload }) {
  const [selectedProv, setSelectedProv] = useState(null);
  const [showImport, setShowImport]     = useState(false);
  const [importProv, setImportProv]     = useState(null);
  const [showEdit, setShowEdit]         = useState(false);
  const [editProv, setEditProv]         = useState(null);
  const [search, setSearch]             = useState(() => localStorage.getItem('ss-dropshipping-listas-search') || '');
  const [editingPrice, setEditingPrice] = useState(null);
  const [toast, setToast]               = useState(null);
  const [saving, setSaving]             = useState(false);
  // Paginación de la lista del proveedor (estándar #2) — antes la tabla usaba scroll sin límite.
  const [page, setPage]                 = useState(1);
  const [pageSize, setPageSize]         = useState(() => { const v = parseInt(localStorage.getItem('ss-dropshipping-listas-pagesize'), 10); return [25,50,100,200].includes(v) ? v : 50; });
  useEffect(() => { localStorage.setItem('ss-dropshipping-listas-search', search); }, [search]);
  useEffect(() => { localStorage.setItem('ss-dropshipping-listas-pagesize', String(pageSize)); }, [pageSize]);
  useEffect(() => { setPage(1); }, [search, selectedProv, pageSize]);

  function showToast(msg, type='success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  }

  function getProductosProveedor(provId) {
    const pMap = precios[provId] || {};
    const skus = Object.keys(pMap);
    return skus.map(sku => {
      const prod = productos.find(p => p.sku === sku) || { sku, nombre: sku, categoria: '—', marca: '—' };
      return { ...prod, costo: pMap[sku] };
    });
  }

  async function handleSavePrice(provId, sku, newVal) {
    const v = parseFloat(newVal);
    if (!isNaN(v) && v > 0) {
      setSaving(true);
      const { error } = await window.saveDsPrecio(provId, sku, v);
      if (error) { showToast('Error al guardar precio', 'error'); }
      else { showToast('Precio actualizado'); await reload(); }
      setSaving(false);
    }
    setEditingPrice(null);
  }

  async function handleDeleteProv(prov) {
    if (!confirm(`¿Eliminar el proveedor "${prov.nombre}" y todos sus precios?`)) return;
    // ds_precios.proveedor_id tiene ON DELETE CASCADE: al borrar el proveedor sus precios
    // desaparecen de la DB también. Snapshot ANTES de borrar para poder restaurar ambos
    // desde la papelera (antes esto era un hard delete permanente, sin recuperación).
    const preciosSnapshot = Object.entries(precios[prov.id] || {}).map(([sku, precio]) => ({ sku, precio }));
    const { error } = await window.deleteDsProv(prov.id);
    if (error) { showToast('Error al eliminar', 'error'); return; }
    window.ssTrash?.add('dsProveedor', prov.nombre, { ...prov, _precios: preciosSnapshot });
    window.logActivity?.({ modulo:'dropshipping', accion:'eliminar', entidad_id: prov.id, entidad_label: prov.nombre });
    if (selectedProv === prov.id) setSelectedProv(null);
    await reload();
    showToast('Proveedor eliminado');
  }

  const prov     = selectedProv ? proveedores.find(p => p.id === selectedProv) : null;
  const allProds = prov ? getProductosProveedor(selectedProv) : [];
  const filtrados = allProds.filter(p =>
    !search || p.nombre.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase())
  );
  const totalPages = Math.max(1, Math.ceil(filtrados.length / pageSize));
  const curPage    = Math.min(page, totalPages);
  const paginados  = filtrados.slice((curPage - 1) * pageSize, curPage * pageSize);

  if (proveedores.length === 0) return (
    <div style={{textAlign:'center', padding:'48px 0', color:'var(--text-muted)'}}>
      <Icon name="suppliers" size={36}/>
      <div style={{marginTop:12, fontWeight:600}}>Sin proveedores de dropshipping</div>
      <div style={{fontSize:13, marginTop:4}}>Haz clic en "Nueva lista" para agregar tu primer proveedor</div>
    </div>
  );

  return (
    <div style={{display:'grid', gridTemplateColumns: selectedProv ? '320px 1fr' : '1fr', gap:16}}>
      {/* Columna izquierda — cards */}
      <div style={{display:'flex', flexDirection:'column', gap:12}}>
        {proveedores.map(p => {
          const count = Object.keys(precios[p.id] || {}).length;
          return (
            <div key={p.id} className="card"
              onClick={() => setSelectedProv(p.id === selectedProv ? null : p.id)}
              style={{
                padding:0, cursor:'pointer', overflow:'hidden',
                border: selectedProv === p.id ? '2px solid '+p.color : '1px solid var(--border)',
                opacity: p.activo ? 1 : 0.55,
                transition:'border-color .15s, box-shadow .15s',
                boxShadow: selectedProv === p.id ? '0 0 0 1px '+p.color+'40' : '',
              }}
            >
              <div style={{height:4, background:p.color}}/>
              <div style={{padding:'12px 14px'}}>
                <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8}}>
                  <div style={{display:'flex', alignItems:'center', gap:8}}>
                    <span style={{fontSize:20}}>{p.bandera || '🌐'}</span>
                    <div>
                      <div style={{fontWeight:600, fontSize:13}}>{p.nombre}</div>
                      <div style={{fontSize:11.5, color:'var(--text-muted)'}}>{p.pais || '—'} · {p.dias_entrega || '—'} días</div>
                    </div>
                  </div>
                  <span className="chip" style={{
                    background: p.activo ? 'var(--success-soft,#dcfce7)' : 'var(--border)',
                    color: p.activo ? 'var(--success)' : 'var(--text-muted)', fontSize:11, flexShrink:0,
                  }}>{p.activo ? 'Activo' : 'Inactivo'}</span>
                </div>
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px 12px', marginTop:10, fontSize:12}}>
                  <div><div className="muted" style={{fontSize:10.5}}>Contacto</div><div>{p.contacto || '—'}</div></div>
                  <div><div className="muted" style={{fontSize:10.5}}>Productos</div><div><strong>{count}</strong> SKUs</div></div>
                  {p.email && <div style={{gridColumn:'1/-1'}}><div className="muted" style={{fontSize:10.5}}>Email</div><div>{p.email}</div></div>}
                </div>
                <div style={{display:'flex', gap:6, marginTop:10}} onClick={e => e.stopPropagation()}>
                  <button className="btn secondary" style={{flex:1, fontSize:11.5, padding:'5px 8px'}}
                    onClick={() => setSelectedProv(p.id)}>
                    <Icon name="doc" size={12}/>Ver lista
                  </button>
                  {window.canUser?.('editar', 'dropshipping') !== false && (
                    <button className="btn ghost" style={{fontSize:11.5, padding:'5px 8px'}}
                      onClick={() => { setImportProv(p); setShowImport(true); }}>
                      <Icon name="upload" size={12}/>Importar
                    </button>
                  )}
                  {window.canUser?.('editar', 'dropshipping') !== false && (
                    <button className="btn ghost" style={{fontSize:11.5, padding:'5px 8px'}}
                      onClick={() => { setEditProv(p); setShowEdit(true); }}>
                      <Icon name="edit" size={12}/>
                    </button>
                  )}
                  {window.canUser?.('eliminar', 'dropshipping') !== false && (
                    <button className="icon-btn danger" style={{padding:'5px 7px'}}
                      onClick={() => handleDeleteProv(p)}>
                      <Icon name="trash" size={12}/>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Columna derecha — detalle */}
      {selectedProv && prov && (
        <div>
          <div className="card" style={{padding:0, overflow:'hidden'}}>
            <div style={{height:4, background:prov.color}}/>
            <div style={{padding:'12px 16px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:12}}>
              <span style={{fontSize:22}}>{prov.bandera || '🌐'}</span>
              <div>
                <div style={{fontWeight:600}}>{prov.nombre}</div>
                <div style={{fontSize:12, color:'var(--text-muted)'}}>{filtrados.length} productos · Lista de precios</div>
              </div>
              <div style={{marginLeft:'auto', display:'flex', gap:8}}>
                <input className="input search" placeholder="Buscar SKU o nombre..." value={search}
                  onChange={e => setSearch(e.target.value)} style={{width:200}}/>
                {window.canUser?.('editar', 'dropshipping') !== false && (
                  <button className="btn secondary" style={{fontSize:12}}
                    onClick={() => { setImportProv(prov); setShowImport(true); }}>
                    <Icon name="upload" size={13}/>Actualizar lista
                  </button>
                )}
                <button className="btn ghost" style={{fontSize:12}} onClick={() => setSelectedProv(null)}>
                  <Icon name="x" size={13}/>
                </button>
              </div>
            </div>

            {filtrados.length === 0 ? (
              <div style={{textAlign:'center', padding:'32px 0', color:'var(--text-muted)'}}>
                <Icon name="upload" size={28}/>
                <div style={{marginTop:8, fontWeight:500}}>Lista vacía</div>
                <div style={{fontSize:12, marginTop:4}}>Importa un CSV/XLSX con los precios de este proveedor</div>
                {window.canUser?.('editar', 'dropshipping') !== false && (
                  <button className="btn primary" style={{marginTop:12}} onClick={() => { setImportProv(prov); setShowImport(true); }}>
                    <Icon name="upload" size={13}/>Importar lista de precios
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="tbl-wrap" style={{maxHeight:500, overflowY:'auto'}}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>SKU</th><th>Nombre</th><th>Categoría</th><th>Marca</th>
                        <th className="num">Costo USD</th><th className="num">vs. Mejor</th><th style={{width:80}}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginados.map(prod => {
                        const best    = getBestPrice(prod.sku, precios);
                        const isBest  = best?.provId === selectedProv;
                        const diff    = best && !isBest ? ((prod.costo - best.precio) / best.precio) * 100 : 0;
                        return (
                          <tr key={prod.sku} style={{background: isBest ? 'oklch(0.95 0.05 150 / 0.4)' : ''}}>
                            <td className="mono-cell">{prod.sku}</td>
                            <td style={{maxWidth:240, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{prod.nombre}</td>
                            <td><span className="chip neutral" style={{fontSize:11}}>{prod.categoria || '—'}</span></td>
                            <td style={{fontSize:12, color:'var(--text-muted)'}}>{prod.marca || '—'}</td>
                            <td className="num">
                              {editingPrice?.sku === prod.sku && editingPrice?.provId === selectedProv
                                ? <input type="number" step="0.01" defaultValue={prod.costo} autoFocus
                                    onBlur={e => handleSavePrice(selectedProv, prod.sku, e.target.value)}
                                    onKeyDown={e => { if (e.key==='Enter') handleSavePrice(selectedProv, prod.sku, e.target.value); if (e.key==='Escape') setEditingPrice(null); }}
                                    style={{width:70, padding:'2px 5px', fontSize:12, textAlign:'right', borderRadius:5, border:'1px solid var(--brand)', fontFamily:'var(--font-mono)'}}
                                  />
                                : <span onClick={() => !saving && window.canUser?.('editar','dropshipping') !== false && setEditingPrice({sku:prod.sku, provId:selectedProv})}
                                    style={{cursor:'pointer', textDecoration:'underline dotted'}}>
                                    {fmt.usd(prod.costo)}
                                  </span>
                              }
                            </td>
                            <td className="num">
                              {isBest
                                ? <span style={{color:'var(--success)', fontWeight:600, fontSize:11.5}}>★ Mejor</span>
                                : <span style={{color: diff < 15 ? 'var(--text-muted)' : 'var(--danger)', fontSize:11.5}}>+{diff.toFixed(1)}%</span>
                              }
                            </td>
                            <td>
                              {window.canUser?.('editar','dropshipping') !== false && (
                                <button className="btn ghost" style={{padding:'3px 8px', fontSize:11}}
                                  onClick={() => setEditingPrice({sku:prod.sku, provId:selectedProv})}>
                                  <Icon name="edit" size={11}/>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{padding:'10px 16px', borderTop:'1px solid var(--border)', fontSize:12, color:'var(--text-muted)', display:'flex', gap:16, alignItems:'center', flexWrap:'wrap'}}>
                  <span>{filtrados.length} productos · pág. {curPage}/{totalPages}</span>
                  <span>Clic en el precio para editar</span>
                  <span style={{color:'var(--success)'}}>
                    {filtrados.filter(p => getBestPrice(p.sku, precios)?.provId === selectedProv).length} con mejor precio
                  </span>
                  <div style={{marginLeft:'auto', display:'flex', gap:8, alignItems:'center'}}>
                    <span className="muted">Filas:</span>
                    <select className="select" value={pageSize} onChange={e => setPageSize(parseInt(e.target.value, 10))} style={{fontSize:12, padding:'2px 5px'}}>
                      {[25,50,100,200].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <button className="btn ghost" disabled={curPage<=1} onClick={()=>setPage(curPage-1)}>←</button>
                    <button className="btn ghost" disabled={curPage>=totalPages} onClick={()=>setPage(curPage+1)}>→</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showImport && importProv && (
        <DSImportModal
          proveedor={importProv}
          onClose={() => { setShowImport(false); setImportProv(null); }}
          onImport={async () => {
            setShowImport(false);
            showToast('Lista importada — ' + importProv.nombre);
            await reload();
          }}
        />
      )}

      {showEdit && editProv && (
        <NuevoProveedorModal
          existentes={proveedores}
          proveedorEdit={editProv}
          onClose={() => { setShowEdit(false); setEditProv(null); }}
          onSave={async (prov) => {
            const { error } = await window.saveDsProv(prov);
            if (error) { showToast('Error al guardar', 'error'); return; }
            window.logActivity?.({ modulo:'dropshipping', accion:'editar', entidad_id: prov.id, entidad_label: prov.nombre });
            await reload();
            setShowEdit(false);
            showToast('Proveedor actualizado');
          }}
        />
      )}

      {toast && (
        <div style={{
          position:'fixed', bottom:24, right:24, background:'var(--bg-elev)',
          border:'1px solid '+(toast.type==='success' ? 'var(--success)' : 'var(--danger)'),
          borderRadius:10, padding:'12px 16px', fontSize:13, fontWeight:500,
          display:'flex', alignItems:'center', gap:8, boxShadow:'0 4px 20px rgba(0,0,0,.25)',
          zIndex:9999,
        }}>
          <Icon name={toast.type==='success' ? 'check' : 'info'} size={14}/>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── Descarga de plantilla XLSX ──────────────────────────────────────────────
function downloadDSTemplate() {
  if (!window.XLSX) { alert('La librería XLSX no está cargada aún. Intenta en un momento.'); return; }
  const wb = window.XLSX.utils.book_new();
  const data = [
    ['SKU',          'Nombre',                    'Precio_USD', 'Categoria',  'Marca'    ],
    ['DS-CAM-4MP',   'Cámara IP Domo 4MP',        38.50,        'Cámaras IP', 'Hikvision'],
    ['DS-CAM-8MP',   'Cámara IP Bullet 8MP',      65.00,        'Cámaras IP', 'Dahua'    ],
    ['DS-NVR-08CH',  'NVR 8 Canales 4K',         120.00,        'Grabadores', 'Hikvision'],
    ['DS-NVR-16CH',  'NVR 16 Canales 4K',        195.00,        'Grabadores', 'Dahua'    ],
    ['DS-PTZ-20X',   'Cámara PTZ 20x Zoom',      220.00,        'Cámaras PTZ','Hikvision'],
    ['DS-CABLE-CAT6','Cable UTP Cat6 (por metro)',  0.85,        'Cables',     'Genérico' ],
    ['DS-SWITCH-8P', 'Switch PoE 8 Puertos 60W',  55.00,        'Redes',      'TP-Link'  ],
    ['DS-HDD-4TB',   'Disco Duro Vigilancia 4TB',  72.00,        'Almacenamiento','Seagate'],
  ];
  const ws = window.XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch:20 }, { wch:36 }, { wch:13 }, { wch:20 }, { wch:14 }];
  // Freeze header row
  ws['!freeze'] = { xSplit:0, ySplit:1 };
  window.XLSX.utils.book_append_sheet(wb, ws, 'Lista de Precios');
  window.XLSX.writeFile(wb, 'plantilla_dropshipping.xlsx');
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL — Importar lista de precios (CSV / XLSX)
// Flujo: upload → config → match → done
// ════════════════════════════════════════════════════════════════════════════
function autoMatchRows(rows) {
  const productos = SSData.productos || [];
  const norm = s => (s||'').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, '').trim();

  return rows.map(row => {
    // 1. Exact SKU (case-insensitive)
    let p = productos.find(q => q.sku.toLowerCase() === row.sku.toLowerCase());
    if (p) return { ...row, sistema_sku: p.sku, match_type: 'sku', match_product: p };

    // 2. Normalized name similarity (min 4 chars)
    const rn = norm(row.nombre);
    if (rn.length >= 4) {
      p = productos.find(q => {
        const pn = norm(q.nombre);
        return pn === rn || pn.includes(rn) || rn.includes(pn);
      });
      if (p) return { ...row, sistema_sku: p.sku, match_type: 'nombre', match_product: p };
    }
    return { ...row, sistema_sku: null, match_type: null, match_product: null };
  });
}

function DSImportModal({ proveedor: proveedorProp, proveedores, onClose, onImport }) {
  const [selectedProvId, setSelectedProvId] = useState(proveedorProp?.id || '');
  const proveedor = proveedorProp || (proveedores || []).find(p => p.id === selectedProvId) || null;

  const [step, setStep]             = useState('upload');
  const [fileInfo, setFileInfo]     = useState(null);
  const [skuCol, setSkuCol]         = useState('');
  const [nombreCol, setNombreCol]   = useState('');
  const [precioCol, setPrecioCol]   = useState('');
  const [catCol, setCatCol]         = useState('');
  const [marcaCol, setMarcaCol]     = useState('');
  const [matchedRows, setMatchedRows] = useState([]);
  const [showMatched, setShowMatched] = useState(false);
  const [applying, setApplying]     = useState(false);
  const [importCount, setImportCount] = useState(0);
  const fileRef = useRef(null);

  function parseFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb   = window.XLSX.read(data, { type:'uint8array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const raw  = window.XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
        if (raw.length < 2) { alert('El archivo está vacío o no tiene datos'); return; }
        const headers = raw[0].map(h => String(h).trim());
        const rows    = raw.slice(1).filter(r => r.some(c => c !== ''));
        const guess   = (patterns) => headers.findIndex(h => patterns.some(p => h.toLowerCase().includes(p)));
        const skuIdx    = guess(['sku','codigo','code','ref','cod']);
        const nombreIdx = guess(['nombre','name','descripcion','product','producto']);
        const precioIdx = guess(['precio','price','costo','cost','usd']);
        const catIdx    = guess(['categoria','category','cat']);
        const marcaIdx  = guess(['marca','brand','fabricante']);
        setSkuCol(skuIdx >= 0 ? headers[skuIdx] : '');
        setNombreCol(nombreIdx >= 0 ? headers[nombreIdx] : '');
        setPrecioCol(precioIdx >= 0 ? headers[precioIdx] : '');
        setCatCol(catIdx >= 0 ? headers[catIdx] : '');
        setMarcaCol(marcaIdx >= 0 ? headers[marcaIdx] : '');
        setFileInfo({ name: file.name, headers, rows });
        setStep('config');
      } catch(err) { alert('Error al leer el archivo: ' + err.message); }
    };
    reader.readAsArrayBuffer(file);
  }

  const previewRows = useMemo(() => {
    if (!fileInfo || !skuCol) return [];
    const skuI    = fileInfo.headers.indexOf(skuCol);
    const nombreI = fileInfo.headers.indexOf(nombreCol);
    const precioI = fileInfo.headers.indexOf(precioCol);
    const catI    = fileInfo.headers.indexOf(catCol);
    const marcaI  = fileInfo.headers.indexOf(marcaCol);
    return fileInfo.rows.slice(0, 5).map(r => ({
      sku:      String(r[skuI]    || '').trim(),
      nombre:   nombreI >= 0 ? String(r[nombreI] || '').trim() : '',
      precio:   precioI >= 0 ? (parseFloat(r[precioI]) || 0) : 0,
      categoria: catI >= 0 ? String(r[catI] || '').trim() : '',
      marca:    marcaI >= 0 ? String(r[marcaI] || '').trim() : '',
    })).filter(r => r.sku);
  }, [fileInfo, skuCol, nombreCol, precioCol, catCol, marcaCol]);

  // All rows with a SKU — precio is optional (0 = no price, still matchable)
  const allRows = useMemo(() => {
    if (!fileInfo || !skuCol) return [];
    const skuI    = fileInfo.headers.indexOf(skuCol);
    const nombreI = fileInfo.headers.indexOf(nombreCol);
    const precioI = fileInfo.headers.indexOf(precioCol);
    const catI    = fileInfo.headers.indexOf(catCol);
    const marcaI  = fileInfo.headers.indexOf(marcaCol);
    return fileInfo.rows.map(r => ({
      sku:      String(r[skuI]    || '').trim(),
      nombre:   nombreI >= 0 ? String(r[nombreI] || '').trim() : '',
      precio:   precioI >= 0 ? (parseFloat(r[precioI]) || 0) : 0,
      categoria: catI >= 0 ? String(r[catI] || '').trim() : '',
      marca:    marcaI >= 0 ? String(r[marcaI] || '').trim() : '',
    })).filter(r => r.sku);
  }, [fileInfo, skuCol, nombreCol, precioCol, catCol, marcaCol]);

  function goToMatch() {
    setMatchedRows(autoMatchRows(allRows));
    setShowMatched(false);
    setStep('match');
  }

  function handleOverride(supplierSku, sistemaSku) {
    setMatchedRows(rows => rows.map(r => {
      if (r.sku !== supplierSku) return r;
      const mp = sistemaSku ? (SSData.productos||[]).find(p => p.sku === sistemaSku) : null;
      return { ...r, sistema_sku: sistemaSku||null, match_type: sistemaSku?'manual':null, match_product: mp||null };
    }));
  }

  async function handleApply() {
    if (!matchedRows.length) { alert('No hay filas para importar'); return; }
    setApplying(true);
    for (const r of matchedRows) {
      await window.saveDsProducto({
        sku: r.sku, nombre: r.nombre || r.sku, categoria: r.categoria, marca: r.marca,
        sistema_sku: r.sistema_sku || null,
      });
    }
    const rowsConPrecio = matchedRows.filter(r => r.precio > 0);
    if (rowsConPrecio.length) {
      const { error } = await window.bulkSaveDsPrecios(proveedor.id, rowsConPrecio);
      if (error) { alert('Error al importar precios: ' + error.message); setApplying(false); return; }
    }
    window.logActivity?.({ modulo:'dropshipping', accion:'bulk_editar', entidad_id: proveedor.id, entidad_label: proveedor.nombre, detalles:{ filas: matchedRows.length, con_precio: rowsConPrecio.length } });
    setImportCount(matchedRows.length);
    setApplying(false);
    setStep('done');
  }

  const SelectCol = ({ label, value, onChange }) => (
    <div>
      <label className="label">{label}</label>
      <select className="select" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">— No usar —</option>
        {(fileInfo?.headers || []).map(h => <option key={h} value={h}>{h}</option>)}
      </select>
    </div>
  );

  // Steps labels for breadcrumb
  const STEPS = [['upload','Archivo'],['config','Columnas'],['match','Coincidencias'],['done','Listo']];
  const stepIdx = STEPS.findIndex(([id]) => id === step);
  const modalW  = step === 'match' ? 800 : 600;

  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,.5)', display:'grid', placeItems:'center', zIndex:9000, padding:16}}>
      <div className="card" style={{width:modalW, maxWidth:'95vw', maxHeight:'92vh', padding:0, overflow:'hidden', display:'flex', flexDirection:'column', transition:'width .2s'}}>

        {/* Header */}
        <div style={{padding:'14px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10, flexShrink:0}}>
          <span style={{fontSize:18}}>{proveedor?.bandera || '📥'}</span>
          <div style={{flex:1}}>
            <div style={{fontWeight:600, fontSize:14}}>Importar lista de precios</div>
            <div style={{fontSize:12, color:'var(--text-muted)'}}>{proveedor ? proveedor.nombre : 'Selecciona un proveedor para comenzar'}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        {/* Provider selector (global mode) */}
        {!proveedorProp && (
          <div style={{padding:'10px 20px', borderBottom:'1px solid var(--border)', background:'var(--bg-sunken)', display:'flex', alignItems:'center', gap:10}}>
            <Icon name="suppliers" size={14} style={{flexShrink:0, color:'var(--text-muted)'}}/>
            <select className="select" style={{flex:1}} value={selectedProvId}
              onChange={e => { setSelectedProvId(e.target.value); setStep('upload'); setFileInfo(null); }}>
              <option value="">— Seleccionar proveedor —</option>
              {(proveedores||[]).map(p => <option key={p.id} value={p.id}>{p.bandera||'🌐'} {p.nombre}</option>)}
            </select>
          </div>
        )}

        {/* Step breadcrumb */}
        <div style={{padding:'8px 20px', borderBottom:'1px solid var(--border)', background:'var(--bg-sunken)', display:'flex', alignItems:'center', gap:2}}>
          {STEPS.map(([id, label], i) => (
            <React.Fragment key={id}>
              <div style={{
                padding:'3px 10px', borderRadius:99, fontSize:11.5, fontWeight: step===id ? 700 : 400,
                background: step===id ? 'var(--brand)' : 'transparent',
                color: step===id ? '#fff' : (i < stepIdx ? 'var(--brand)' : 'var(--text-muted)'),
              }}>{label}</div>
              {i < STEPS.length-1 && <span style={{color:'var(--text-muted)', fontSize:11, padding:'0 2px'}}>›</span>}
            </React.Fragment>
          ))}
          {allRows.length > 0 && step !== 'upload' && (
            <span className="chip neutral" style={{marginLeft:'auto', fontSize:11}}>{allRows.length} filas</span>
          )}
        </div>

        {/* Content */}
        <div style={{padding:20, overflowY:'auto', flex:1}}>

          {/* ── STEP: upload ── */}
          {step === 'upload' && (
            <>
              {!proveedor ? (
                <div style={{textAlign:'center', padding:'32px 0', color:'var(--text-muted)'}}>
                  <Icon name="suppliers" size={32}/>
                  <div style={{marginTop:8, fontSize:13}}>Selecciona un proveedor arriba para continuar</div>
                </div>
              ) : (
                <>
                  <div
                    style={{border:'2px dashed var(--border)', borderRadius:10, padding:'32px 20px', textAlign:'center', cursor:'pointer', transition:'border-color .15s'}}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor='var(--brand)'; }}
                    onDragLeave={e => { e.currentTarget.style.borderColor=''; }}
                    onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor=''; const f=e.dataTransfer.files[0]; if(f) parseFile(f); }}
                  >
                    <Icon name="upload" size={28}/>
                    <div style={{marginTop:8, fontWeight:500}}>Arrastra tu archivo CSV o XLSX aquí</div>
                    <div style={{fontSize:12, color:'var(--text-muted)', marginTop:4}}>o haz clic para seleccionar</div>
                    <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{display:'none'}}
                      onChange={e => { if(e.target.files[0]) parseFile(e.target.files[0]); }}/>
                  </div>
                  <div style={{marginTop:14, border:'1px solid var(--border)', borderRadius:10, overflow:'hidden'}}>
                    <div style={{padding:'10px 14px', background:'var(--bg-sunken)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:8}}>
                      <div>
                        <div style={{fontWeight:600, fontSize:13}}>¿No tienes el formato correcto?</div>
                        <div style={{fontSize:12, color:'var(--text-muted)', marginTop:1}}>Descarga la plantilla XLSX con campos y datos de ejemplo</div>
                      </div>
                      <button className="btn primary" style={{whiteSpace:'nowrap', flexShrink:0}} onClick={downloadDSTemplate}>
                        <Icon name="download" size={13}/>Descargar plantilla
                      </button>
                    </div>
                    <div style={{padding:'10px 14px', fontSize:12, color:'var(--text-muted)'}}>
                      <span style={{fontWeight:600, color:'var(--text-2)'}}>Requerido:</span>{' '}
                      <code style={{background:'var(--bg-sunken)', padding:'1px 5px', borderRadius:4, color:'var(--brand)', fontSize:11}}>SKU</code>{' '}
                      <span style={{marginLeft:6}}>Opcionales:</span>{' '}
                      <code style={{fontSize:11}}>Precio_USD</code>{' · '}
                      <code style={{fontSize:11}}>Nombre</code>{' · '}
                      <code style={{fontSize:11}}>Categoria</code>{' · '}
                      <code style={{fontSize:11}}>Marca</code>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── STEP: config ── */}
          {step === 'config' && fileInfo && (
            <>
              <div style={{background:'var(--bg-sunken)', borderRadius:8, padding:'8px 12px', marginBottom:16, fontSize:12, display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
                <Icon name="doc" size={14}/>
                <span style={{fontWeight:500}}>{fileInfo.name}</span>
                <span className="chip neutral">{fileInfo.rows.length} filas</span>
                <span className="chip neutral">{fileInfo.headers.length} columnas</span>
              </div>
              <div style={{fontWeight:600, fontSize:13, marginBottom:10}}>Mapear columnas del archivo</div>
              <div className="grid-2" style={{gap:10}}>
                <SelectCol label="SKU / Código del proveedor *" value={skuCol} onChange={setSkuCol}/>
                <SelectCol label="Precio USD" value={precioCol} onChange={setPrecioCol}/>
                <SelectCol label="Nombre del producto" value={nombreCol} onChange={setNombreCol}/>
                <SelectCol label="Categoría" value={catCol} onChange={setCatCol}/>
                <SelectCol label="Marca" value={marcaCol} onChange={setMarcaCol}/>
              </div>
              {previewRows.length > 0 && (
                <div style={{marginTop:16}}>
                  <div style={{fontSize:12, fontWeight:600, marginBottom:6}}>Vista previa (5 primeras filas):</div>
                  <table className="tbl" style={{fontSize:11.5}}>
                    <thead><tr><th>SKU proveedor</th><th>Nombre</th><th className="num">Precio</th><th>Categoría</th></tr></thead>
                    <tbody>
                      {previewRows.map((r,i) => (
                        <tr key={i}>
                          <td className="mono-cell">{r.sku}</td>
                          <td style={{maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{r.nombre || <span className="muted">—</span>}</td>
                          <td className="num">{r.precio > 0 ? fmt.usd(r.precio) : <span className="muted">—</span>}</td>
                          <td style={{fontSize:11}}>{r.categoria || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{marginTop:8, fontSize:12, display:'flex', gap:8, alignItems:'center'}}>
                    <span className="chip green"><Icon name="check" size={11}/>{allRows.length} filas con SKU</span>
                    {allRows.filter(r=>r.precio>0).length < allRows.length && (
                      <span className="chip neutral">{allRows.filter(r=>r.precio<=0).length} sin precio (se importan igual)</span>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── STEP: match ── */}
          {step === 'match' && (
            <DSMatchStep
              matchedRows={matchedRows}
              showMatched={showMatched}
              setShowMatched={setShowMatched}
              onOverride={handleOverride}
            />
          )}

          {/* ── STEP: done ── */}
          {step === 'done' && (
            <div style={{textAlign:'center', padding:'32px 0'}}>
              <div style={{width:60, height:60, borderRadius:99, background:'var(--success-soft,#dcfce7)', color:'var(--success,#16a34a)', display:'grid', placeItems:'center', margin:'0 auto 14px'}}>
                <Icon name="check" size={26}/>
              </div>
              <div style={{fontWeight:700, fontSize:16}}>¡Lista importada exitosamente!</div>
              <div style={{fontSize:13, color:'var(--text-muted)', marginTop:6}}>
                {importCount} productos guardados para <strong>{proveedor?.nombre}</strong>
              </div>
              <div style={{marginTop:12, fontSize:12, color:'var(--text-muted)'}}>
                {matchedRows.filter(r=>r.sistema_sku).length} con match al sistema ·{' '}
                {matchedRows.filter(r=>!r.sistema_sku).length} importados con SKU del proveedor
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{padding:'12px 20px', borderTop:'1px solid var(--border)', display:'flex', gap:8, justifyContent:'space-between', alignItems:'center', flexShrink:0}}>
          <button className="btn ghost" style={{fontSize:12}} onClick={downloadDSTemplate}>
            <Icon name="download" size={13}/>Plantilla
          </button>
          <div style={{display:'flex', gap:8}}>
            {step !== 'done' && <button className="btn secondary" onClick={onClose}>Cancelar</button>}
            {step === 'config' && <button className="btn ghost" onClick={() => setStep('upload')}>← Volver</button>}
            {step === 'match'  && <button className="btn ghost" onClick={() => setStep('config')}>← Volver</button>}
            {step === 'upload' && proveedor && (
              <button className="btn ghost" onClick={() => fileRef.current?.click()}>
                <Icon name="upload" size={13}/>Seleccionar archivo
              </button>
            )}
            {step === 'config' && (
              <button className="btn primary" disabled={!skuCol || !allRows.length} onClick={goToMatch}>
                Verificar coincidencias →
              </button>
            )}
            {step === 'match' && (
              <button className="btn primary" disabled={applying} onClick={handleApply}>
                {applying
                  ? <><Icon name="sync" size={13}/>Importando…</>
                  : <><Icon name="upload" size={13}/>Importar {matchedRows.length} productos</>}
              </button>
            )}
            {step === 'done' && <button className="btn primary" onClick={onImport}><Icon name="check" size={13}/>Cerrar</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Match step component ──────────────────────────────────────────────────────
function DSMatchStep({ matchedRows, showMatched, setShowMatched, onOverride }) {
  const autoSku    = matchedRows.filter(r => r.match_type === 'sku');
  const autoNombre = matchedRows.filter(r => r.match_type === 'nombre');
  const manual     = matchedRows.filter(r => r.match_type === 'manual');
  const unmatched  = matchedRows.filter(r => !r.sistema_sku);
  const allMatched = [...autoSku, ...autoNombre, ...manual];

  const [searchProd, setSearchProd] = useState(''); // filter for product picker per row

  return (
    <div>
      {/* Summary cards */}
      <div style={{display:'flex', gap:10, marginBottom:20}}>
        <div style={{flex:1, padding:'12px 14px', borderRadius:10, background:'#f0fdf4', border:'1px solid #86efac'}}>
          <div style={{fontWeight:700, fontSize:22, color:'#16a34a', lineHeight:1}}>{allMatched.length}</div>
          <div style={{fontSize:11, color:'#15803d', marginTop:4}}>
            {autoSku.length > 0 && <span>{autoSku.length} por SKU exacto{autoNombre.length || manual.length ? ' · ' : ''}</span>}
            {autoNombre.length > 0 && <span>{autoNombre.length} por nombre{manual.length ? ' · ' : ''}</span>}
            {manual.length > 0 && <span>{manual.length} manual{manual.length!==1?'es':''}</span>}
            {allMatched.length === 0 && 'Ninguno'}
          </div>
          <div style={{fontSize:12, fontWeight:600, color:'#15803d', marginTop:2}}>Coincidencias encontradas</div>
        </div>
        <div style={{flex:1, padding:'12px 14px', borderRadius:10, background: unmatched.length?'#fefce8':'#f8fafc', border:'1px solid '+(unmatched.length?'#fde047':'var(--border)')}}>
          <div style={{fontWeight:700, fontSize:22, color: unmatched.length?'#ca8a04':'var(--text-muted)', lineHeight:1}}>{unmatched.length}</div>
          <div style={{fontSize:11, color: unmatched.length?'#92400e':'var(--text-muted)', marginTop:4}}>
            {unmatched.length ? 'Se importarán con SKU del proveedor' : 'Todos los productos tienen coincidencia'}
          </div>
          <div style={{fontSize:12, fontWeight:600, color: unmatched.length?'#92400e':'var(--text-muted)', marginTop:2}}>Sin coincidencia en el sistema</div>
        </div>
      </div>

      {/* Unmatched rows — manual assignment */}
      {unmatched.length > 0 && (
        <div style={{marginBottom:20}}>
          <div style={{fontWeight:600, fontSize:13, marginBottom:10, display:'flex', alignItems:'center', gap:6}}>
            <span style={{width:8, height:8, borderRadius:'50%', background:'#f59e0b', display:'inline-block', flexShrink:0}}/>
            Asigna producto del sistema (opcional) — o importa tal como está
          </div>
          <div style={{display:'flex', flexDirection:'column', gap:6, maxHeight:320, overflowY:'auto'}}>
            {unmatched.map(row => (
              <DSUnmatchedRow key={row.sku} row={row} onOverride={onOverride}/>
            ))}
          </div>
        </div>
      )}

      {/* Matched rows — collapsible */}
      {allMatched.length > 0 && (
        <div>
          <button className="btn ghost sm" style={{fontSize:12, marginBottom:8}} onClick={() => setShowMatched(v => !v)}>
            <Icon name={showMatched ? 'chevronL' : 'chevronR'} size={12}/>
            {showMatched ? 'Ocultar' : 'Ver'} {allMatched.length} coincidencia{allMatched.length!==1?'s':''} automática{allMatched.length!==1?'s':''}
          </button>
          {showMatched && (
            <div style={{display:'flex', flexDirection:'column', gap:4, maxHeight:260, overflowY:'auto'}}>
              {allMatched.map(row => (
                <div key={row.sku} style={{display:'flex', alignItems:'center', gap:10, padding:'7px 10px', border:'1px solid #86efac', borderRadius:7, background:'#f0fdf4'}}>
                  <Icon name="check" size={13} style={{color:'#16a34a', flexShrink:0}}/>
                  <div style={{flex:1, minWidth:0, display:'flex', alignItems:'center', gap:6, flexWrap:'wrap'}}>
                    <code style={{fontSize:11, color:'#92400e', background:'#fef9c3', padding:'1px 4px', borderRadius:3}}>{row.sku}</code>
                    <span style={{color:'var(--text-muted)', fontSize:11}}>→</span>
                    <code style={{fontSize:11, fontWeight:700, color:'var(--brand)'}}>{row.sistema_sku}</code>
                    <span style={{fontSize:12, color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{row.match_product?.nombre}</span>
                  </div>
                  <div style={{display:'flex', gap:6, alignItems:'center', flexShrink:0}}>
                    <span style={{fontSize:10, padding:'1px 6px', borderRadius:99, fontWeight:600,
                      background: row.match_type==='sku'?'#dbeafe':row.match_type==='manual'?'#fce7f3':'#f3e8ff',
                      color:      row.match_type==='sku'?'#1e40af':row.match_type==='manual'?'#9d174d':'#7c3aed',
                    }}>
                      {row.match_type==='sku' ? 'SKU exacto' : row.match_type==='manual' ? 'Manual' : 'Nombre similar'}
                    </span>
                    {row.precio > 0 && <span style={{fontSize:12, fontWeight:600}}>{fmt.usd(row.precio)}</span>}
                    {/* Allow overriding a matched row too */}
                    <button className="icon-btn" style={{padding:'2px 4px'}} title="Cambiar match"
                      onClick={() => onOverride(row.sku, null)}>
                      <Icon name="x" size={11}/>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DSUnmatchedRow({ row, onOverride }) {
  const [inputVal, setInputVal] = useState('');
  const productos = SSData.productos || [];

  // Filter products by input
  const filtered = useMemo(() => {
    if (!inputVal.trim()) return productos.slice(0, 80);
    const q = inputVal.toLowerCase();
    return productos.filter(p =>
      p.sku.toLowerCase().includes(q) || (p.nombre||'').toLowerCase().includes(q)
    ).slice(0, 80);
  }, [inputVal]);

  function handleSelect(sku) {
    if (sku) {
      const p = productos.find(q => q.sku === sku);
      setInputVal(p ? `${p.sku} — ${p.nombre}` : sku);
      onOverride(row.sku, sku);
    } else {
      setInputVal('');
      onOverride(row.sku, null);
    }
  }

  return (
    <div style={{display:'flex', alignItems:'center', gap:10, padding:'10px 12px', border:'1px solid #fde047', borderRadius:8, background:'#fefce8', flexWrap:'wrap'}}>
      {/* Supplier info */}
      <div style={{flex:'0 0 auto', minWidth:150, maxWidth:220}}>
        <div style={{fontFamily:'var(--font-mono)', fontSize:11, color:'#92400e', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}
          title={row.sku}>{row.sku}</div>
        <div style={{fontSize:12, fontWeight:500, color:'var(--text-1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}
          title={row.nombre}>{row.nombre || <span style={{color:'var(--text-muted)'}}>Sin nombre</span>}</div>
        {row.precio > 0 && <div style={{fontSize:11, color:'var(--brand)', fontWeight:600, marginTop:1}}>{fmt.usd(row.precio)}</div>}
      </div>

      <div style={{color:'var(--text-muted)', fontSize:13, flexShrink:0}}>→</div>

      {/* System product picker */}
      <div style={{flex:1, minWidth:200, position:'relative'}}>
        <input
          className="input"
          style={{fontSize:12, width:'100%', boxSizing:'border-box'}}
          placeholder="Buscar producto del sistema…"
          value={inputVal}
          onChange={e => { setInputVal(e.target.value); if (!e.target.value) onOverride(row.sku, null); }}
          list={`ds-prod-${row.sku.replace(/[^a-z0-9]/gi,'-')}`}
        />
        <datalist id={`ds-prod-${row.sku.replace(/[^a-z0-9]/gi,'-')}`}>
          {filtered.map(p => (
            <option key={p.sku} value={`${p.sku} — ${p.nombre}`}/>
          ))}
        </datalist>
        {/* Detect when user selects from datalist */}
        {inputVal && (() => {
          const match = inputVal.match(/^([^ ]+) — /);
          if (match) {
            const sku = match[1];
            const p   = productos.find(q => q.sku === sku);
            if (p && row.sistema_sku !== sku) {
              setTimeout(() => onOverride(row.sku, sku), 0);
            }
          }
          return null;
        })()}
      </div>

      {/* Skip badge */}
      <span style={{fontSize:11, color:'var(--text-muted)', fontStyle:'italic', flexShrink:0, whiteSpace:'nowrap'}}>
        {row.sistema_sku ? <span style={{color:'#16a34a', fontStyle:'normal', fontWeight:600}}>✓ Asignado</span> : 'Sin match — OK'}
      </span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB 2 — COMPARADOR DE PRECIOS
// ════════════════════════════════════════════════════════════════════════════
function ComparadorTab({ proveedores, productos, precios }) {
  // Filtros persistidos (estándar #4) — se conservan al recargar.
  const [search, setSearch]       = useState(() => localStorage.getItem('ss-dropshipping-comparador-search') || '');
  const [categoria, setCategoria] = useState(() => localStorage.getItem('ss-dropshipping-comparador-cat') || '');
  const [margen, setMargen]       = useState(() => { const v = parseInt(localStorage.getItem('ss-dropshipping-comparador-margen'), 10); return isNaN(v) ? 35 : v; });
  const [selected, setSelected]   = useState(null);
  // Paginación (estándar #2) — antes la tabla renderizaba TODOS los productos filtrados sin límite
  // (problema real con catálogos grandes: Demo 1 ~6452 SKUs).
  const [page, setPage]           = useState(1);
  const [pageSize, setPageSize]   = useState(() => { const v = parseInt(localStorage.getItem('ss-dropshipping-comparador-pagesize'), 10); return [25,50,100,200].includes(v) ? v : 50; });
  useEffect(() => { localStorage.setItem('ss-dropshipping-comparador-search', search); }, [search]);
  useEffect(() => { localStorage.setItem('ss-dropshipping-comparador-cat', categoria); }, [categoria]);
  useEffect(() => { localStorage.setItem('ss-dropshipping-comparador-margen', String(margen)); }, [margen]);
  useEffect(() => { localStorage.setItem('ss-dropshipping-comparador-pagesize', String(pageSize)); }, [pageSize]);
  useEffect(() => { setPage(1); }, [search, categoria, pageSize]);

  const categorias = [...new Set(productos.map(p => p.categoria).filter(Boolean))].sort();

  const filtrados = productos.filter(p => {
    if (categoria && p.categoria !== categoria) return false;
    if (search && !p.nombre.toLowerCase().includes(search.toLowerCase()) && !p.sku.toLowerCase().includes(search.toLowerCase())) return false;
    // Only show products with at least one price
    return Object.values(precios).some(pMap => pMap[p.sku] !== undefined);
  });
  const totalPages = Math.max(1, Math.ceil(filtrados.length / pageSize));
  const curPage    = Math.min(page, totalPages);
  const paginados  = filtrados.slice((curPage - 1) * pageSize, curPage * pageSize);

  if (productos.length === 0) return (
    <div style={{textAlign:'center', padding:'48px 0', color:'var(--text-muted)'}}>
      <Icon name="price" size={36}/>
      <div style={{marginTop:12}}>Importa listas de precios en la pestaña "Listas de proveedores" para comparar</div>
    </div>
  );

  return (
    <div>
      <div style={{display:'flex', gap:10, alignItems:'center', marginBottom:16, flexWrap:'wrap'}}>
        <input className="input search" placeholder="Buscar producto o SKU..." value={search}
          onChange={e => setSearch(e.target.value)} style={{flex:'1 1 200px'}}/>
        <select className="select" value={categoria} onChange={e => setCategoria(e.target.value)} style={{minWidth:160}}>
          <option value="">Todas las categorías</option>
          {categorias.map(c => <option key={c}>{c}</option>)}
        </select>
        <div style={{display:'flex', alignItems:'center', gap:8, background:'var(--bg-sunken)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 12px'}}>
          <span style={{fontSize:12.5, color:'var(--text-muted)', whiteSpace:'nowrap'}}>Margen objetivo:</span>
          <input type="number" min="0" max="100" value={margen} onChange={e => setMargen(Number(e.target.value)||0)}
            style={{width:44, padding:'2px 4px', fontSize:12.5, textAlign:'center', borderRadius:5, border:'1px solid var(--border)', background:'transparent', color:'var(--text)', fontFamily:'var(--font-mono)'}}/>
          <span style={{fontSize:12.5, color:'var(--text-muted)'}}>%</span>
        </div>
      </div>

      <div className="tbl-wrap" style={{overflowX:'auto'}}>
        <table className="tbl" style={{minWidth: 600 + proveedores.length * 100}}>
          <thead>
            <tr>
              <th style={{minWidth:80}}>SKU</th>
              <th style={{minWidth:200}}>Nombre</th>
              <th>Categoría</th>
              {proveedores.map(p => (
                <th key={p.id} className="num" style={{minWidth:100}}>
                  <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end', gap:1}}>
                    <span style={{fontSize:10, fontWeight:400, color:'var(--text-muted)'}}>{p.bandera || '🌐'}</span>
                    <span style={{fontSize:11, color:p.color}}>{p.nombre.split(' ')[0]}</span>
                  </div>
                </th>
              ))}
              <th className="num" style={{minWidth:100, color:'var(--success)'}}>Mejor USD</th>
              <th className="num" style={{minWidth:110}}>P. Venta sug.</th>
              <th className="num" style={{minWidth:80}}>Margen</th>
              <th style={{width:40}}></th>
            </tr>
          </thead>
          <tbody>
            {paginados.map(prod => {
              const provPrecios  = proveedores.map(p => ({ prov:p, precio: (precios[p.id] || {})[prod.sku] || null }));
              const disponibles  = provPrecios.filter(pp => pp.precio !== null);
              if (!disponibles.length) return null;
              const bestPrecio   = Math.min(...disponibles.map(pp => pp.precio));
              const worstPrecio  = Math.max(...disponibles.map(pp => pp.precio));
              const bestProv     = disponibles.find(pp => pp.precio === bestPrecio)?.prov;
              const precioVenta  = bestPrecio / (1 - margen/100);
              const margenReal   = prod.shopify_precio
                ? ((prod.shopify_precio - bestPrecio) / prod.shopify_precio * 100) : margen;
              const spread       = worstPrecio > bestPrecio ? ((worstPrecio - bestPrecio) / bestPrecio * 100) : 0;
              const isSelected   = selected === prod.sku;

              return (
                <React.Fragment key={prod.sku}>
                  <tr style={{cursor:'pointer', background: isSelected ? 'var(--brand-soft)' : ''}}
                    onClick={() => setSelected(isSelected ? null : prod.sku)}>
                    <td className="mono-cell">{prod.sku}</td>
                    <td style={{maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontWeight:500}}>{prod.nombre}</td>
                    <td><span className="chip neutral" style={{fontSize:10.5}}>{prod.categoria || '—'}</span></td>
                    {proveedores.map(p => {
                      const precio = (precios[p.id] || {})[prod.sku];
                      if (!precio) return <td key={p.id} className="num" style={{color:'var(--text-muted)'}}>—</td>;
                      const isBest  = precio === bestPrecio;
                      const isWorst = precio === worstPrecio && disponibles.length > 1;
                      return (
                        <td key={p.id} className="num" style={{
                          fontWeight: isBest ? 700 : 400,
                          background: isBest ? 'oklch(0.92 0.09 150 / 0.35)' : isWorst ? 'oklch(0.92 0.09 20 / 0.2)' : '',
                          color: isBest ? 'var(--success)' : isWorst ? 'var(--danger)' : 'var(--text)', borderRadius:4,
                        }}>
                          {fmt.usd(precio)}{isBest && disponibles.length > 1 && <span style={{fontSize:9, marginLeft:2}}>★</span>}
                        </td>
                      );
                    })}
                    <td className="num" style={{fontWeight:700, color:'var(--success)'}}>
                      <div>{fmt.usd(bestPrecio)}</div>
                      <div style={{fontSize:10.5, fontWeight:400, color:'var(--text-muted)'}}>{bestProv?.nombre.split(' ')[0]}</div>
                    </td>
                    <td className="num">{fmt.usd(precioVenta)}</td>
                    <td className="num">
                      <span style={{color: margenReal >= margen ? 'var(--success)' : margenReal >= margen*0.7 ? 'var(--warn)' : 'var(--danger)', fontWeight:600}}>
                        {margenReal.toFixed(1)}%
                      </span>
                    </td>
                    <td><Icon name={isSelected ? 'chevronU' : 'chevronD'} size={12}/></td>
                  </tr>
                  {isSelected && (
                    <tr>
                      <td colSpan={proveedores.length + 6} style={{padding:0}}>
                        <ProductAnalysis prod={prod} provPrecios={provPrecios} bestPrecio={bestPrecio}
                          worstPrecio={worstPrecio} spread={spread} margen={margen}
                          precioVenta={precioVenta} bestProv={bestProv}/>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {filtrados.length === 0 && (
              <tr><td colSpan={proveedores.length + 6} style={{textAlign:'center', padding:32, color:'var(--text-muted)'}}>
                Sin productos que coincidan
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {filtrados.length > 0 && (
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:12, fontSize:12.5, flexWrap:'wrap', gap:10}}>
          <div className="muted">{filtrados.length} producto(s) · página {curPage} de {totalPages}</div>
          <div style={{display:'flex', gap:8, alignItems:'center'}}>
            <span className="muted">Filas:</span>
            <select className="select" value={pageSize} onChange={e => setPageSize(parseInt(e.target.value, 10))} style={{fontSize:12, padding:'3px 6px'}}>
              {[25,50,100,200].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <button className="btn ghost" disabled={curPage<=1} onClick={()=>setPage(curPage-1)}>← Anterior</button>
            <button className="btn ghost" disabled={curPage>=totalPages} onClick={()=>setPage(curPage+1)}>Siguiente →</button>
          </div>
        </div>
      )}
      <div style={{display:'flex', gap:16, marginTop:12, fontSize:11.5, color:'var(--text-muted)'}}>
        <span><span style={{background:'oklch(0.92 0.09 150 / 0.35)', padding:'1px 6px', borderRadius:3}}>verde</span> = mejor precio</span>
        <span><span style={{background:'oklch(0.92 0.09 20 / 0.2)', padding:'1px 6px', borderRadius:3}}>rojo</span> = precio más alto</span>
        <span>★ = proveedor recomendado · clic en fila para análisis</span>
      </div>
    </div>
  );
}

function ProductAnalysis({ prod, provPrecios, bestPrecio, worstPrecio, spread, margen, precioVenta, bestProv }) {
  const tasa = window.currentTasa || SSData.tasa || { bcv: 1 };
  const disponibles = provPrecios.filter(pp => pp.precio !== null);
  return (
    <div style={{background:'var(--bg-sunken)', borderTop:'1px solid var(--border)', borderBottom:'1px solid var(--border)', padding:'16px 20px'}}>
      <div style={{display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:16}}>
        <div>
          <div style={{fontSize:12.5, fontWeight:600, marginBottom:10}}>Comparación de precios</div>
          {disponibles.sort((a,b) => a.precio - b.precio).map(({ prov, precio }) => {
            const pct    = worstPrecio > bestPrecio ? ((precio - bestPrecio) / (worstPrecio - bestPrecio)) * 100 : 0;
            const isBest = precio === bestPrecio;
            return (
              <div key={prov.id} style={{marginBottom:8}}>
                <div style={{display:'flex', justifyContent:'space-between', marginBottom:3, fontSize:12}}>
                  <span style={{display:'flex', alignItems:'center', gap:5}}>
                    <span style={{width:8, height:8, borderRadius:'50%', background:prov.color, display:'inline-block'}}/>
                    {prov.nombre} {prov.bandera || '🌐'}
                  </span>
                  <span style={{fontWeight: isBest ? 700 : 400, color: isBest ? 'var(--success)' : 'var(--text)'}}>
                    {fmt.usd(precio)} {isBest && '★'}
                  </span>
                </div>
                <div style={{height:6, background:'var(--border)', borderRadius:3, overflow:'hidden'}}>
                  <div style={{width: isBest ? '2%' : (pct+'%'), height:'100%', background: isBest ? 'var(--success)' : prov.color, borderRadius:3, transition:'width .3s'}}/>
                </div>
              </div>
            );
          })}
          {spread > 0 && <div style={{marginTop:8, fontSize:11.5, color:'var(--text-muted)'}}>Spread: <strong style={{color:'var(--warn)'}}>{spread.toFixed(1)}%</strong>{spread > 20 && ' · Diferencia significativa'}</div>}
        </div>
        <div>
          <div style={{fontSize:12.5, fontWeight:600, marginBottom:10}}>Escenarios de precio</div>
          {[
            { label:'Margen 20%', precio: bestPrecio / 0.80 },
            { label:'Margen 30%', precio: bestPrecio / 0.70 },
            { label:`Margen ${margen}% (objetivo)`, precio: precioVenta, highlight:true },
            { label:'Margen 50%', precio: bestPrecio / 0.50 },
          ].map(esc => (
            <div key={esc.label} style={{display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:5,
              padding:'4px 6px', borderRadius:5, background: esc.highlight ? 'var(--brand-soft)' : ''}}>
              <span style={{color: esc.highlight ? 'var(--brand)' : 'var(--text-muted)'}}>{esc.label}</span>
              <span style={{fontWeight:600, fontFamily:'var(--font-mono)'}}>{fmt.usd(esc.precio)}</span>
            </div>
          ))}
          <div style={{marginTop:8, paddingTop:8, borderTop:'1px solid var(--border)', fontSize:11.5, color:'var(--text-muted)'}}>
            Costo mínimo: {fmt.usd(bestPrecio)} · {bestProv?.nombre.split(' ')[0]}<br/>
            Bs equiv. (BCV): {fmt.ves(bestPrecio * (tasa.bcv || 1))}
          </div>
        </div>
        <div>
          <div style={{fontSize:12.5, fontWeight:600, marginBottom:10}}>Resumen</div>
          <div style={{fontSize:12, display:'flex', flexDirection:'column', gap:5}}>
            <div style={{display:'flex', justifyContent:'space-between'}}><span className="muted">SKU</span><span className="mono">{prod.sku}</span></div>
            <div style={{display:'flex', justifyContent:'space-between'}}><span className="muted">Categoría</span><span>{prod.categoria || '—'}</span></div>
            <div style={{display:'flex', justifyContent:'space-between'}}><span className="muted">Marca</span><span>{prod.marca || '—'}</span></div>
            <div style={{display:'flex', justifyContent:'space-between'}}><span className="muted">Proveedores</span><span>{disponibles.length}</span></div>
            <div style={{display:'flex', justifyContent:'space-between'}}><span className="muted">Shopify</span>
              <ShopifyStatusBadge status={prod.shopify_status}/>
            </div>
            {prod.shopify_precio && (
              <div style={{display:'flex', justifyContent:'space-between'}}><span className="muted">Precio Shopify</span>
                <span className="mono">{fmt.usd(prod.shopify_precio)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB 3 — SHOPIFY SYNC
// ════════════════════════════════════════════════════════════════════════════
function ShopifyTab({ proveedores, productos, precios, reload }) {
  const [localProds, setLocalProds]   = useState(() => productos.map(p => ({ ...p })));
  const [search, setSearch]           = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [selected, setSelected]       = useState(new Set());
  const [syncing, setSyncing]         = useState(false);
  const [syncLog, setSyncLog]         = useState([]);
  const [syncProgress, setSyncProgress] = useState(0);
  // Paginación (estándar de módulo #2) — antes esta tabla renderizaba TODOS los
  // productos filtrados sin límite, un problema real con catálogos grandes.
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(() => { const v = parseInt(localStorage.getItem('ss-dropshipping-shopify-pagesize') || '50', 10); return [50,100,200].includes(v) ? v : 50; });
  useEffect(() => { localStorage.setItem('ss-dropshipping-shopify-pagesize', String(pageSize)); }, [pageSize]);

  // Keep localProds in sync when productos prop changes
  useEffect(() => { setLocalProds(productos.map(p => ({ ...p }))); }, [productos]);
  useEffect(() => { setPage(1); }, [search, filtroStatus]);

  const statusColors = {
    publicado:    { bg:'#dcfce7', color:'#166534', label:'Publicado'    },
    pendiente:    { bg:'#fef9c3', color:'#854d0e', label:'Pendiente'    },
    no_publicado: { bg:'var(--border)', color:'var(--text-muted)', label:'No publicado' },
    error:        { bg:'#fee2e2', color:'#991b1b', label:'Error'        },
  };
  const stats = {
    publicado:    localProds.filter(p => p.shopify_status === 'publicado').length,
    pendiente:    localProds.filter(p => p.shopify_status === 'pendiente').length,
    no_publicado: localProds.filter(p => p.shopify_status === 'no_publicado').length,
    error:        localProds.filter(p => p.shopify_status === 'error').length,
  };
  const filtrados = localProds.filter(p => {
    if (filtroStatus && p.shopify_status !== filtroStatus) return false;
    if (search && !p.nombre.toLowerCase().includes(search.toLowerCase()) && !p.sku.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const totalPages    = Math.max(1, Math.ceil(filtrados.length / pageSize));
  const curPage       = Math.min(page, totalPages);
  const paginatedProds = filtrados.slice((curPage - 1) * pageSize, curPage * pageSize);

  function addLog(msg) {
    const ts = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' });
    setSyncLog(prev => [{ ts, msg }, ...prev].slice(0, 20));
  }

  function updateLocal(sku, updates) {
    setLocalProds(prev => prev.map(p => p.sku === sku ? { ...p, ...updates } : p));
  }

  async function handlePublish(sku) {
    const prod = localProds.find(p => p.sku === sku);
    const best = getBestPrice(sku, precios);
    const precio = best ? Math.ceil(best.precio / 0.65 * 100) / 100 : null;
    const updates = { shopify_status:'publicado', shopify_precio: precio, ultima_sync: window.localDateStr() };
    updateLocal(sku, updates);
    await window.saveDsProducto({ ...prod, ...updates });
    addLog('✓ Publicado: ' + prod.nombre + (precio ? ' — ' + fmt.usd(precio) : ''));
    await reload();
  }

  async function handleUnpublish(sku) {
    const prod = localProds.find(p => p.sku === sku);
    const updates = { shopify_status:'no_publicado', shopify_precio: null };
    updateLocal(sku, updates);
    await window.saveDsProducto({ ...prod, ...updates });
    addLog('✗ Despublicado: ' + prod.nombre);
    await reload();
  }

  async function handleBulkSync() {
    const toSync = filtrados.filter(p => selected.has(p.sku));
    if (!toSync.length) return;
    setSyncing(true); setSyncProgress(0);
    addLog(`Iniciando sincronización de ${toSync.length} productos…`);
    const updates = [];
    for (let i = 0; i < toSync.length; i++) {
      await new Promise(r => setTimeout(r, 300));
      const prod  = toSync[i];
      const best  = getBestPrice(prod.sku, precios);
      const precio = best ? Math.ceil(best.precio / 0.65 * 100) / 100 : null;
      const upd   = { shopify_status:'publicado', shopify_precio: precio, ultima_sync: window.localDateStr() };
      updateLocal(prod.sku, upd);
      updates.push({ ...prod, ...upd });
      setSyncProgress(Math.round(((i+1) / toSync.length) * 100));
      addLog(`✓ ${prod.sku} — ${prod.nombre}`);
    }
    await window.saveDsShopifyBulk(updates);
    setSyncing(false); setSelected(new Set());
    addLog(`✅ Sincronización completada — ${toSync.length} productos`);
    await reload();
  }

  if (localProds.length === 0) return (
    <div style={{textAlign:'center', padding:'48px 0', color:'var(--text-muted)'}}>
      <Icon name="sync" size={36}/>
      <div style={{marginTop:12}}>Importa productos a través de las listas de proveedores para sincronizar con Shopify</div>
    </div>
  );

  return (
    <div>
      <div className="card" style={{padding:14, marginBottom:16, display:'flex', alignItems:'center', gap:16, flexWrap:'wrap'}}>
        <div style={{width:36, height:36, borderRadius:8, background:'#96bf48', display:'grid', placeItems:'center'}}>
          <Icon name="external" size={18}/>
        </div>
        <div>
          <div style={{fontWeight:600, fontSize:13}}>Shopify · Distribuidora Demo Store</div>
          <div style={{fontSize:12, color:'var(--text-muted)'}}>Conecta tu tienda Shopify en Configuración del Sistema</div>
        </div>
        <div style={{display:'flex', gap:20, marginLeft:'auto', flexWrap:'wrap'}}>
          {Object.entries(stats).map(([status, count]) => (
            <div key={status} style={{textAlign:'center', cursor:'pointer'}} onClick={() => setFiltroStatus(filtroStatus===status?'':status)}>
              <div style={{fontSize:20, fontWeight:700, color: statusColors[status]?.color}}>{count}</div>
              <div style={{fontSize:11, color:'var(--text-muted)'}}>{statusColors[status]?.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{display:'flex', gap:8, marginBottom:12, flexWrap:'wrap', alignItems:'center'}}>
        <input className="input search" placeholder="Buscar producto..." value={search}
          onChange={e => setSearch(e.target.value)} style={{flex:'1 1 180px'}}/>
        <select className="select" value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(statusColors).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="select" value={pageSize} onChange={e => { setPageSize(parseInt(e.target.value,10)); setPage(1); }}>
          {[50,100,200].map(n => <option key={n} value={n}>{n}/pág</option>)}
        </select>
        {selected.size > 0 && window.canUser?.('editar', 'dropshipping') !== false && (
          <button className="btn primary" onClick={handleBulkSync} disabled={syncing}>
            {syncing ? `Sincronizando… ${syncProgress}%` : <><Icon name="sync" size={13}/>Sincronizar {selected.size} seleccionados</>}
          </button>
        )}
        {selected.size > 0 && window.canUser?.('editar', 'dropshipping') !== false && (
          <button className="btn secondary" onClick={async () => {
            for (const sku of [...selected]) await handleUnpublish(sku);
            setSelected(new Set());
          }}>
            <Icon name="x" size={13}/>Despublicar selección
          </button>
        )}
      </div>

      {syncing && <div style={{marginBottom:12, background:'var(--border)', borderRadius:4, height:6}}><div style={{height:'100%', background:'var(--brand)', borderRadius:4, width:syncProgress+'%', transition:'width .3s'}}/></div>}

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{width:36}}>
                <input type="checkbox" checked={selected.size === filtrados.length && filtrados.length > 0}
                  onChange={() => selected.size === filtrados.length ? setSelected(new Set()) : setSelected(new Set(filtrados.map(p=>p.sku)))}/>
              </th>
              <th>SKU</th><th>Nombre</th><th>Categoría</th>
              <th className="num">Costo min.</th><th className="num">Precio Shopify</th>
              <th className="num">Margen</th><th>Estado</th><th>Última sync</th><th style={{width:120}}></th>
            </tr>
          </thead>
          <tbody>
            {paginatedProds.map(prod => {
              const best = getBestPrice(prod.sku, precios);
              const bestProv = best ? proveedores.find(p => p.id === best.provId) : null;
              const margenPct = prod.shopify_precio && best ? ((prod.shopify_precio - best.precio) / prod.shopify_precio * 100) : null;
              return (
                <tr key={prod.sku}>
                  <td><input type="checkbox" checked={selected.has(prod.sku)} onChange={() => {
                    const n = new Set(selected); n.has(prod.sku) ? n.delete(prod.sku) : n.add(prod.sku); setSelected(n);
                  }}/></td>
                  <td className="mono-cell">{prod.sku}</td>
                  <td style={{maxWidth:240, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{prod.nombre}</td>
                  <td><span className="chip neutral" style={{fontSize:10.5}}>{prod.categoria || '—'}</span></td>
                  <td className="num">
                    {best ? <span>{fmt.usd(best.precio)}<span style={{fontSize:10.5, color: bestProv?.color || 'var(--text-muted)', marginLeft:4}}>{bestProv?.nombre.split(' ')[0]}</span></span> : '—'}
                  </td>
                  <td className="num">{prod.shopify_precio ? <strong>{fmt.usd(prod.shopify_precio)}</strong> : <span className="muted">—</span>}</td>
                  <td className="num">
                    {margenPct !== null ? <span style={{color: margenPct >= 30 ? 'var(--success)' : margenPct >= 15 ? 'var(--warn)' : 'var(--danger)', fontWeight:600}}>{margenPct.toFixed(1)}%</span> : <span className="muted">—</span>}
                  </td>
                  <td><ShopifyStatusBadge status={prod.shopify_status}/></td>
                  <td style={{fontSize:11.5, color:'var(--text-muted)'}}>{prod.ultima_sync || '—'}</td>
                  <td>
                    <div style={{display:'flex', gap:4}}>
                      {window.canUser?.('editar', 'dropshipping') !== false && (
                        prod.shopify_status !== 'publicado'
                          ? <button className="btn ghost" style={{fontSize:11, padding:'3px 8px'}} onClick={() => handlePublish(prod.sku)}><Icon name="external" size={11}/>Publicar</button>
                          : <button className="btn ghost" style={{fontSize:11, padding:'3px 8px'}} onClick={() => handleUnpublish(prod.sku)}><Icon name="x" size={11}/>Quitar</button>
                      )}
                      {window.canUser?.('editar', 'dropshipping') !== false && prod.shopify_status === 'error' && (
                        <button className="btn ghost" style={{fontSize:11, padding:'3px 8px', color:'var(--danger)'}} onClick={() => handlePublish(prod.sku)}><Icon name="sync" size={11}/>Reintentar</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtrados.length > 0 && (
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 12px', fontSize:12.5}}>
          <div className="muted">{filtrados.length} producto(s) · página {curPage} de {totalPages}</div>
          <div style={{display:'flex', gap:6}}>
            <button className="btn ghost" disabled={curPage<=1} onClick={()=>setPage(p=>p-1)}>← Anterior</button>
            <button className="btn ghost" disabled={curPage>=totalPages} onClick={()=>setPage(p=>p+1)}>Siguiente →</button>
          </div>
        </div>
      )}

      {syncLog.length > 0 && (
        <div className="card" style={{marginTop:16, padding:0, overflow:'hidden'}}>
          <div style={{padding:'10px 14px', borderBottom:'1px solid var(--border)', fontWeight:600, fontSize:12.5}}>Registro de sincronización</div>
          <div style={{maxHeight:160, overflowY:'auto', padding:'8px 0'}}>
            {syncLog.map((entry, i) => (
              <div key={i} style={{padding:'3px 14px', fontSize:12, display:'flex', gap:12}}>
                <span className="mono" style={{color:'var(--text-muted)', fontSize:11, flexShrink:0}}>{entry.ts}</span>
                <span>{entry.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ShopifyStatusBadge({ status }) {
  const map = {
    publicado:    { bg:'#dcfce7', color:'#166534', label:'Publicado'    },
    pendiente:    { bg:'#fef9c3', color:'#854d0e', label:'Pendiente'    },
    no_publicado: { bg:'var(--border)', color:'var(--text-muted)', label:'No publicado' },
    error:        { bg:'#fee2e2', color:'#991b1b', label:'Error'        },
  };
  const s = map[status] || map['no_publicado'];
  return <span className="chip" style={{background:s.bg, color:s.color, fontSize:11}}>{s.label}</span>;
}

Object.assign(window, { DropshippingPage: window.DropshippingPage });
