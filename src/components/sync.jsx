// Sincronización Shopify ↔ Sistema central — implementación real con Admin API
const { useState: uS, useEffect: uE, useMemo: uM } = React;

// ── Confirm dialog reutilizable ───────────────────────────────────────────────
function SyncConfirmDialog({ title, desc, icon, variant, count, onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-fullscreen-mobile" style={{maxWidth:460}} onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title" style={{display:'flex', alignItems:'center', gap:8}}>
            <Icon name={icon||'info'} size={18}/>{title}
          </h3>
        </div>
        <div className="modal-body">
          <p style={{margin:0, fontSize:14, lineHeight:1.6, color:'var(--text)'}}>{desc}</p>
          {count != null && (
            <div style={{marginTop:12, padding:'10px 14px', background:'var(--bg-soft,#f1f5f9)', borderRadius:8, fontSize:13, display:'flex', alignItems:'center', gap:8}}>
              <Icon name="inventory" size={15}/> Afectará <strong>{count}</strong> producto{count!==1?'s':''}.
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn secondary" onClick={onCancel}>Cancelar</button>
          <button className={'btn ' + (variant==='danger' ? 'danger' : 'primary')} onClick={onConfirm}>Continuar</button>
        </div>
      </div>
    </div>
  );
}

function useConfirm() {
  const [pending, setPending] = uS(null);
  const confirm = (opts) => new Promise(resolve => setPending({ ...opts, resolve }));
  const node = pending ? (
    <SyncConfirmDialog
      {...pending}
      onConfirm={() => { pending.resolve(true); setPending(null); }}
      onCancel={()  => { pending.resolve(false); setPending(null); }}
    />
  ) : null;
  return [node, confirm];
}

// ── Descripciones de acciones ─────────────────────────────────────────────────
const ACTION_META = {
  vincular: {
    title: 'Vincular productos por SKU',
    tooltip: 'Busca en Shopify un producto con el mismo SKU y lo enlaza al sistema. Solo aplica a los que aún no están vinculados.',
    desc: 'El sistema buscará en Shopify un producto con el mismo SKU para cada seleccionado y lo vinculará automáticamente si existe. Esta acción solo lee datos de Shopify, no modifica nada en tu tienda.',
    icon: 'link',
  },
  crear: {
    title: 'Crear productos en Shopify',
    tooltip: 'Publica los productos seleccionados como nuevos productos en Shopify. Solo aplica a los que aún no están vinculados.',
    desc: 'Se creará un nuevo producto en Shopify por cada seleccionado sin vincular, usando el nombre, precio base y descripción del sistema. Una vez creados quedarán vinculados automáticamente.',
    icon: 'plus',
  },
  syncPrecioStock: {
    title: 'Sincronizar precio y stock',
    tooltip: 'Envía el precio base y el stock actual del sistema hacia Shopify. Sobreescribe los valores actuales en la tienda.',
    desc: 'Se actualizarán el precio y el stock en Shopify con los valores que tiene el sistema actualmente. Solo aplica a productos ya vinculados. Los valores actuales en Shopify serán reemplazados.',
    icon: 'upload',
  },
  syncTodo: {
    title: 'Sincronizar todo',
    tooltip: 'Envía precio, stock, título y descripción a Shopify. Sobreescribe todo el contenido del producto en la tienda.',
    desc: 'Se actualizarán en Shopify el precio, stock, título y descripción con los datos actuales del sistema. Todo el contenido previo del producto en Shopify será reemplazado. Solo aplica a productos vinculados.',
    icon: 'upload',
    variant: 'danger',
  },
  importarImagenes: {
    title: 'Importar imágenes desde Shopify',
    tooltip: 'Descarga las imágenes de Shopify y las guarda en el sistema. Solo aplica a productos vinculados.',
    desc: 'Se descargarán las imágenes actuales de Shopify y se guardarán en el sistema para cada producto vinculado seleccionado. Las imágenes previas en el sistema serán reemplazadas por las de Shopify.',
    icon: 'image',
  },
  pushTodo: {
    title: 'Enviar todo a Shopify',
    tooltip: 'Sobreescribe precio, stock, título y descripción en Shopify con los datos del sistema.',
    desc: 'Se actualizarán en Shopify el precio, stock, título y descripción de este producto con los datos actuales del sistema. El contenido previo en Shopify será reemplazado.',
    icon: 'upload',
    variant: 'danger',
  },
  pushPrecio: {
    title: 'Actualizar precio en Shopify',
    tooltip: 'Envía solo el precio base del sistema a Shopify.',
    desc: 'Se actualizará únicamente el precio de este producto en Shopify con el precio base registrado en el sistema.',
    icon: 'upload',
  },
  pushStock: {
    title: 'Actualizar stock en Shopify',
    tooltip: 'Envía solo el stock actual del sistema a Shopify.',
    desc: 'Se actualizará únicamente el inventario de este producto en Shopify con el stock actual registrado en el sistema.',
    icon: 'upload',
  },
  pushTextos: {
    title: 'Actualizar título y descripción',
    tooltip: 'Envía el título y la descripción del sistema a Shopify.',
    desc: 'Se actualizarán el título y la descripción de este producto en Shopify con los textos registrados en el sistema.',
    icon: 'upload',
  },
};

window.SyncPage = function SyncPage() {
  const [shopCfg, setShopCfg]     = uS(null);
  const [productos, setProds]     = uS([]);
  const [stockMap, setStockMap]   = uS({});
  const [loading, setLoading]     = uS(true);
  const [estado, setEstado]       = uS('todos');
  const [search, setSearch]       = uS('');
  const [marcaFil, setMarcaFil]   = uS('');
  const [catFil, setCatFil]       = uS('');
  const [tagFil, setTagFil]       = uS('');
  const [colFil, setColFil]       = uS('');
  const [collections, setCols]    = uS([]);
  const [colCache, setColCache]   = uS({});
  const [busy, setBusy]           = uS(false);
  const [progress, setProgress]   = uS(null);
  const [drawer, setDrawer]       = uS(null);
  const [ConfirmNode, confirm]    = useConfirm();

  async function reload() {
    setLoading(true);
    const [{ data: cfg }, { data: prods }] = await Promise.all([
      window.loadShopifyConfig(),
      window.loadProductosShopify(),
    ]);
    setShopCfg(cfg || {});
    setProds(prods || []);
    setStockMap(await window.loadStockMap((prods || []).map(p => p.sku)));
    setLoading(false);
    if (cfg?.shopify_enabled) {
      window.loadShopifyCollections().then(c => setCols(c || []));
    }
  }
  uE(() => { reload(); }, []);

  const conectado = !!shopCfg?.shopify_enabled;

  uE(() => {
    if (!colFil || colCache[colFil]) return;
    window.loadShopifyCollectionProducts(colFil).then(ids => {
      setColCache(c => ({ ...c, [colFil]: new Set(ids) }));
    });
  }, [colFil]);

  const opts = uM(() => {
    const marcas = new Set(), cats = new Set(), tags = new Set();
    productos.forEach(p => {
      if (p.marca) marcas.add(p.marca);
      if (p.categoria) cats.add(p.categoria);
      (p.etiquetas || []).forEach(t => t && tags.add(t));
    });
    const sortEs = arr => [...arr].sort((a,b) => a.localeCompare(b,'es'));
    return { marcas: sortEs(marcas), cats: sortEs(cats), tags: sortEs(tags) };
  }, [productos]);

  const rows = uM(() => {
    const q = search.trim().toLowerCase();
    const colSet = colFil ? colCache[colFil] : null;
    return productos.filter(p => {
      if (estado === 'conectados'    && !p.shopify_product_id) return false;
      if (estado === 'no_conectados' &&  p.shopify_product_id) return false;
      if (q && !((p.nombre||'').toLowerCase().includes(q) || (p.sku||'').toLowerCase().includes(q))) return false;
      if (marcaFil && p.marca !== marcaFil) return false;
      if (catFil   && p.categoria !== catFil) return false;
      if (tagFil   && !(p.etiquetas || []).includes(tagFil)) return false;
      if (colSet) {
        if (!p.shopify_product_id) return false;
        if (!colSet.has(String(p.shopify_product_id))) return false;
      }
      return true;
    });
  }, [productos, estado, search, marcaFil, catFil, tagFil, colFil, colCache]);

  const stats = uM(() => ({
    total:        productos.length,
    conectados:   productos.filter(p => p.shopify_product_id).length,
    no_conect:    productos.filter(p => !p.shopify_product_id).length,
    sin_imagenes: productos.filter(p => p.shopify_product_id && (!p.imagenes || p.imagenes.length === 0)).length,
  }), [productos]);

  // ── Bulk ops ──────────────────────────────────────────────────────────────
  async function runBulk(label, items, fn, clearSel, meta = {}) {
    if (!items.length) { alert('Ninguno de los seleccionados aplica para esta acción.'); return; }
    const ok = await confirm({
      title:   meta.title   || label,
      desc:    meta.desc    || '¿Deseas continuar con esta acción?',
      icon:    meta.icon    || 'info',
      variant: meta.variant || 'primary',
      count:   items.length,
    });
    if (!ok) return;
    setBusy(true);
    setProgress({ total: items.length, done: 0, label, log: [] });
    let okN = 0, errN = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      try {
        const r = await fn(it);
        if (r?.error) {
          errN++;
          setProgress(p => ({ ...p, done: i+1, log: [...p.log, { sku: it.sku, ok: false, msg: typeof r.error === 'string' ? r.error : JSON.stringify(r.error).slice(0,180) }] }));
        } else {
          okN++;
          setProgress(p => ({ ...p, done: i+1, log: [...p.log, { sku: it.sku, ok: true, msg: r?.count != null ? `${r.count} imágenes` : 'OK' }] }));
        }
      } catch (e) {
        errN++;
        setProgress(p => ({ ...p, done: i+1, log: [...p.log, { sku: it.sku, ok: false, msg: e.message }] }));
      }
    }
    setProgress(p => ({ ...p, done: items.length, summary: { ok: okN, err: errN } }));
    window.logActivity?.({ modulo:'sync', accion:'bulk_'+label.toLowerCase().replace(/\s+/g,'_'), detalles:{ ok: okN, err: errN, total: items.length }});
    await reload();
    if (clearSel) clearSel();
    setBusy(false);
  }

  // ── Columnas DataTable ────────────────────────────────────────────────────
  const columns = [
    { key: 'foto', label: '', render: p => {
        const img = (p.imagenes || p.shopify_images || [])[0];
        return img
          ? <img src={img.src} alt="" style={{width:42, height:42, objectFit:'cover', borderRadius:4, background:'var(--bg-soft,#f1f5f9)'}}/>
          : <div style={{width:42, height:42, borderRadius:4, background:'var(--bg-soft,#f1f5f9)', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-muted)'}}><Icon name="image" size={14}/></div>;
      }},
    { key: 'sku', label: 'SKU / Nombre', render: p => (
        <div>
          <div className="mono small" style={{color:'var(--text-muted)'}}>{p.sku}</div>
          <div style={{fontWeight:500}}>{p.nombre}</div>
          {(p.marca || p.categoria) && <div className="small" style={{color:'var(--text-muted)', marginTop:2}}>{[p.marca, p.categoria].filter(Boolean).join(' · ')}</div>}
          <div className="show-sm-only small" style={{marginTop:4, display:'flex', gap:6, alignItems:'center', flexWrap:'wrap'}}>
            {p.shopify_product_id
              ? <span className="badge" style={{background:'rgba(34,197,94,.15)', color:'#22c55e', fontSize:10, padding:'1px 6px'}}>● Shopify</span>
              : <span className="badge" style={{background:'rgba(148,163,184,.15)', color:'#94a3b8', fontSize:10, padding:'1px 6px'}}>○ Sin vincular</span>}
            <span className="mono" style={{color:'var(--text-muted)', fontSize:11}}>{stockMap[p.sku] || 0}u · {fmt.usd(p.base || 0)}</span>
          </div>
        </div>
      )},
    { key: 'estado', label: 'Estado Shopify', hideOnMobile: true, render: p => p.shopify_product_id ? (
        <div>
          <span className="badge" style={{background:'rgba(34,197,94,.15)', color:'#22c55e'}}>● Conectado</span>
          <div className="mono small" style={{color:'var(--text-muted)', marginTop:2}}>ID {p.shopify_product_id}</div>
        </div>
      ) : <span className="badge" style={{background:'rgba(148,163,184,.15)', color:'#94a3b8'}}>○ Sin vincular</span>
    },
    { key: 'stock',  label: 'Stock',  className: 'num', hideOnMobile: true, render: p => <span className="mono">{stockMap[p.sku] || 0}</span> },
    { key: 'precio', label: 'Precio', className: 'num', hideOnMobile: true, render: p => <span className="mono">{fmt.usd(p.base || 0)}</span> },
    { key: 'sync',   label: 'Última sync', hideOnMobile: true, render: p => <span className="small" style={{color:'var(--text-muted)'}}>{p.shopify_last_sync ? new Date(p.shopify_last_sync).toLocaleString("es-VE",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"America/Caracas"}) : '—'}</span> },
    { key: 'acciones', label: '', render: p => <div onClick={e => e.stopPropagation()}><RowActions p={p} reload={reload} confirm={confirm}/></div> },
  ];

  // ── Bulk actions del DataTable ────────────────────────────────────────────
  const puedeCrear  = window.canUser?.('crear',  'sync') !== false;
  const puedeEditar = window.canUser?.('editar', 'sync') !== false;
  const bulkActions = [
    puedeEditar && {
      label: 'Vincular por SKU', icon: 'link',
      tooltip: ACTION_META.vincular.tooltip,
      onClick: (sel, clearSel) => runBulk('Vincular por SKU', sel.filter(p => !p.shopify_product_id), async (p) => {
        const r = await window.shopifyFindBySku(p.sku);
        if (r.error) return { error: r.error };
        if (!r.found) return { error: 'no encontrado en Shopify' };
        await window.linkProductoShopify(p.sku, {
          shopify_product_id: r.shopify_product_id, shopify_variant_id: r.shopify_variant_id,
          shopify_inventory_item_id: r.shopify_inventory_item_id, shopify_handle: r.shopify_handle,
          shopify_status: r.shopify_status, shopify_images: r.shopify_images || [],
        });
        return { ok: true };
      }, clearSel, ACTION_META.vincular),
    },
    puedeCrear && {
      label: 'Crear en Shopify', icon: 'plus',
      tooltip: ACTION_META.crear.tooltip,
      onClick: (sel, clearSel) => runBulk('Crear en Shopify', sel.filter(p => !p.shopify_product_id), p => window.shopifyCreateProduct(p), clearSel, ACTION_META.crear),
    },
    puedeEditar && {
      label: 'Sync precio+stock', icon: 'upload',
      tooltip: ACTION_META.syncPrecioStock.tooltip,
      onClick: (sel, clearSel) => runBulk('Sync precio+stock', sel.filter(p => p.shopify_product_id), p => window.shopifyPushProduct(p, { campos:['precio','stock'] }), clearSel, ACTION_META.syncPrecioStock),
    },
    puedeEditar && {
      label: 'Sync TODO', icon: 'upload', variant: 'danger',
      tooltip: ACTION_META.syncTodo.tooltip,
      onClick: (sel, clearSel) => runBulk('Sync TODO', sel.filter(p => p.shopify_product_id), p => window.shopifyPushProduct(p, { campos:['precio','stock','titulo','descripcion'] }), clearSel, ACTION_META.syncTodo),
    },
    puedeEditar && {
      label: 'Importar imágenes', icon: 'image',
      tooltip: ACTION_META.importarImagenes.tooltip,
      onClick: (sel, clearSel) => runBulk('Importar imágenes', sel.filter(p => p.shopify_product_id), p => window.shopifyImportImages(p), clearSel, ACTION_META.importarImagenes),
    },
  ].filter(Boolean);

  if (!conectado && !loading) {
    return (
      <div className="page">
        <div className="page-header"><h1 className="page-title">Sincronización Shopify</h1></div>
        <div className="card"><div className="card-body" style={{textAlign:'center', padding:40}}>
          <Icon name="external" size={32}/>
          <h3 style={{margin:'12px 0'}}>Shopify no está conectado</h3>
          <p className="small" style={{marginBottom:20}}>Conecta tu tienda desde Ajustes → Sistema → Integraciones para usar este módulo.</p>
        </div></div>
      </div>
    );
  }

  const colSelected = collections.find(c => String(c.id) === String(colFil));
  const filtersApplied = !!(marcaFil || catFil || tagFil || colFil || estado !== 'todos' || search);

  const toolbar = (
    <>
      <input className="input" placeholder="Buscar SKU o nombre…" value={search} onChange={e=>setSearch(e.target.value)} style={{minWidth:200, flex:'1 1 200px'}}/>
      <select className="select" value={estado} onChange={e=>setEstado(e.target.value)}>
        <option value="todos">Todos ({stats.total})</option>
        <option value="conectados">Conectados ({stats.conectados})</option>
        <option value="no_conectados">Sin vincular ({stats.no_conect})</option>
      </select>
      <select className="select" value={marcaFil} onChange={e=>setMarcaFil(e.target.value)}>
        <option value="">Marca: todas</option>
        {opts.marcas.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <select className="select" value={catFil} onChange={e=>setCatFil(e.target.value)}>
        <option value="">Categoría: todas</option>
        {opts.cats.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <select className="select" value={tagFil} onChange={e=>setTagFil(e.target.value)}>
        <option value="">Etiqueta: todas</option>
        {opts.tags.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      {conectado && (
        <select className="select" value={colFil} onChange={e=>setColFil(e.target.value)} title="Filtrar por colección Shopify">
          <option value="">Colección Shopify: todas</option>
          {collections.map(c => <option key={c.id} value={c.id}>{c.title}{c.products_count != null ? ` (${c.products_count})` : ''}</option>)}
        </select>
      )}
      {filtersApplied && (
        <button className="btn ghost sm" onClick={() => { setSearch(''); setEstado('todos'); setMarcaFil(''); setCatFil(''); setTagFil(''); setColFil(''); }}>
          <Icon name="x" size={12}/>Limpiar filtros
        </button>
      )}
      {colSelected && !colCache[colFil] && (
        <span className="small" style={{color:'var(--text-muted)'}}>Cargando colección…</span>
      )}
    </>
  );

  const rightToolbar = (
    <button className="btn ghost" onClick={reload} disabled={busy} title="Recargar la lista de productos desde el sistema"><Icon name="sync" size={14}/>Refrescar</button>
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Sincronización Shopify</h1>
          <div className="page-subtitle" style={{display:'flex', alignItems:'center', gap:6, flexWrap:'wrap'}}>
            <span style={{width:8, height:8, borderRadius:'50%', background:'var(--success)'}}/>
            <strong style={{color:'var(--text)'}}>{shopCfg?.shopify_store}</strong>
            <span>· {stats.total} productos · {stats.conectados} conectados · {stats.no_conect} sin vincular</span>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="sync-stats" style={{display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:12, marginBottom:16}}>
        <StatCard icon="inventory" label="Total productos" value={stats.total}/>
        <StatCard icon="check" label="Conectados" value={stats.conectados} color="#22c55e"/>
        <StatCard icon="x" label="Sin vincular" value={stats.no_conect} color="#f59e0b"/>
        <StatCard icon="image" label="Sin imágenes" value={stats.sin_imagenes} color="#94a3b8"/>
      </div>

      {loading ? (
        <div className="card"><div className="card-body" style={{padding:40, textAlign:'center', color:'var(--text-muted)'}}>Cargando productos…</div></div>
      ) : (
        <DataTable
          moduloId="shopify-sync"
          rows={rows}
          columns={columns}
          getRowId={r => r.sku}
          onRowClick={p => setDrawer(p)}
          bulkActions={bulkActions}
          toolbar={toolbar}
          rightToolbar={rightToolbar}
          emptyText="Sin resultados con los filtros actuales"
          defaultPageSize={50}
          pageSizeOptions={[50, 100, 200]}
        />
      )}

      {ConfirmNode}
      {progress && <ProgressModal progress={progress} onClose={()=>setProgress(null)} busy={busy}/>}
      {drawer && <ProductDrawer p={drawer} onClose={()=>setDrawer(null)} reload={reload} stock={stockMap[drawer.sku] || 0}/>}
    </div>
  );
};

function StatCard({ icon, label, value, color }) {
  return (
    <div className="card" style={{margin:0}}>
      <div className="card-body" style={{padding:14, display:'flex', alignItems:'center', gap:12}}>
        <div style={{width:36, height:36, borderRadius:8, background:(color||'var(--brand)')+'20', color:color||'var(--brand)', display:'flex', alignItems:'center', justifyContent:'center'}}>
          <Icon name={icon} size={18}/>
        </div>
        <div>
          <div className="small" style={{color:'var(--text-muted)'}}>{label}</div>
          <div style={{fontSize:22, fontWeight:600}}>{value}</div>
        </div>
      </div>
    </div>
  );
}

function RowActions({ p, reload, confirm }) {
  const [open, setOpen] = uS(false);
  const [busy, setBusy] = uS(false);
  const puedeCrear  = window.canUser?.('crear',  'sync') !== false;
  const puedeEditar = window.canUser?.('editar', 'sync') !== false;

  async function run(meta, fn) {
    setOpen(false);
    const ok = await confirm({
      title:   meta.title,
      desc:    meta.desc,
      icon:    meta.icon    || 'info',
      variant: meta.variant || 'primary',
    });
    if (!ok) return;
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r?.error) {
      alert(meta.title + ': ' + (typeof r.error === 'string' ? r.error : JSON.stringify(r.error).slice(0,300)));
    } else {
      window.logActivity?.({modulo:'sync', accion:meta.title.toLowerCase().replace(/\s+/g,'_'), entidad_id:p.sku, entidad_label:p.nombre});
      await reload();
    }
  }

  return (
    <div style={{position:'relative'}}>
      <button className="btn ghost sm" onClick={()=>setOpen(o=>!o)} disabled={busy} title="Ver acciones disponibles para este producto">
        {busy ? '…' : '⋯'}
      </button>
      {open && (
        <>
          <div onClick={()=>setOpen(false)} style={{position:'fixed', inset:0, zIndex:30}}/>
          <div style={{position:'absolute', top:'100%', right:0, background:'var(--bg)', border:'1px solid var(--border)', borderRadius:8, boxShadow:'0 10px 30px rgba(0,0,0,.2)', zIndex:31, minWidth:240, padding:6}}>
            {!p.shopify_product_id ? (
              <>
                {puedeEditar && <Item icon="link" label="Vincular por SKU" desc={ACTION_META.vincular.tooltip} onClick={()=>run(
                  { ...ACTION_META.vincular, desc: `Se buscará en Shopify un producto con SKU "${p.sku}" y se vinculará al sistema si existe. No se modifica nada en tu tienda.` },
                  async () => {
                    const r = await window.shopifyFindBySku(p.sku);
                    if (r.error) return { error: r.error };
                    if (!r.found) return { error: 'No existe en Shopify' };
                    await window.linkProductoShopify(p.sku, {
                      shopify_product_id: r.shopify_product_id, shopify_variant_id: r.shopify_variant_id,
                      shopify_inventory_item_id: r.shopify_inventory_item_id, shopify_handle: r.shopify_handle,
                      shopify_status: r.shopify_status, shopify_images: r.shopify_images || [],
                    });
                    return { ok: true };
                  }
                )}/>}
                {puedeCrear && <Item icon="plus" label="Crear en Shopify" desc={ACTION_META.crear.tooltip} onClick={()=>run(
                  { ...ACTION_META.crear, desc: `Se publicará "${p.nombre}" como nuevo producto en Shopify con el precio base ${fmt.usd(p.base||0)} y la descripción registrada en el sistema.` },
                  () => window.shopifyCreateProduct(p)
                )}/>}
              </>
            ) : (
              <>
                {puedeEditar && <Item icon="upload" label="Enviar TODO" desc={ACTION_META.pushTodo.tooltip} onClick={()=>run(
                  { ...ACTION_META.pushTodo, desc: `Se sobreescribirán en Shopify el precio (${fmt.usd(p.base||0)}), stock, título y descripción de "${p.nombre}" con los datos actuales del sistema.` },
                  () => window.shopifyPushProduct(p, { campos:['precio','stock','titulo','descripcion'] })
                )}/>}
                {puedeEditar && <Item icon="upload" label="Solo precio" desc={ACTION_META.pushPrecio.tooltip} onClick={()=>run(
                  { ...ACTION_META.pushPrecio, desc: `Se actualizará el precio de "${p.nombre}" en Shopify a ${fmt.usd(p.base||0)}, que es el precio base actual en el sistema.` },
                  () => window.shopifyPushProduct(p, { campos:['precio'] })
                )}/>}
                {puedeEditar && <Item icon="upload" label="Solo stock" desc={ACTION_META.pushStock.tooltip} onClick={()=>run(
                  { ...ACTION_META.pushStock, desc: `Se actualizará el inventario de "${p.nombre}" en Shopify con el stock actual registrado en el sistema.` },
                  () => window.shopifyPushProduct(p, { campos:['stock'] })
                )}/>}
                {puedeEditar && <Item icon="upload" label="Título y descripción" desc={ACTION_META.pushTextos.tooltip} onClick={()=>run(
                  { ...ACTION_META.pushTextos, desc: `Se actualizarán el título y la descripción de "${p.nombre}" en Shopify con los textos del sistema.` },
                  () => window.shopifyPushProduct(p, { campos:['titulo','descripcion'] })
                )}/>}
                {puedeEditar && <div style={{height:1, background:'var(--border)', margin:'4px 0'}}/>}
                {puedeEditar && <Item icon="image" label="Importar imágenes" desc={ACTION_META.importarImagenes.tooltip} onClick={()=>run(
                  { ...ACTION_META.importarImagenes, desc: `Se descargarán las imágenes actuales de "${p.nombre}" desde Shopify y reemplazarán las imágenes guardadas en el sistema.` },
                  () => window.shopifyImportImages(p)
                )}/>}
                <Item icon="external" label="Ver en Shopify" desc="Abre la página de administración de este producto en Shopify." onClick={()=>{
                  setOpen(false);
                  window.open(`https://admin.shopify.com/store/${(window.shopifyDefaultStore||'').replace(/\.myshopify\.com$/,'')}/products/${p.shopify_product_id}`, '_blank');
                }}/>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Item({ icon, label, desc, onClick }) {
  return (
    <div onClick={onClick}
      style={{padding:'8px 10px', borderRadius:4, cursor:'pointer', display:'flex', alignItems:'flex-start', gap:8}}
      onMouseEnter={e=>e.currentTarget.style.background='var(--bg-soft, #f1f5f9)'}
      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
      <span style={{marginTop:2, flexShrink:0}}><Icon name={icon} size={14}/></span>
      <div>
        <div style={{fontSize:13, fontWeight:500}}>{label}</div>
        {desc && <div style={{fontSize:11, color:'var(--text-muted)', marginTop:2, lineHeight:1.4}}>{desc}</div>}
      </div>
    </div>
  );
}

function ProgressModal({ progress, onClose, busy }) {
  const pct = progress.total ? Math.round(progress.done * 100 / progress.total) : 0;
  return (
    <div className="modal-overlay" onClick={busy ? null : onClose}>
      <div className="modal modal-fullscreen-mobile" style={{maxWidth:580}} onClick={e=>e.stopPropagation()}>
        <div className="modal-header"><h3 className="modal-title">{progress.label}</h3></div>
        <div className="modal-body">
          <div style={{marginBottom:12}}>
            <div style={{display:'flex', justifyContent:'space-between', marginBottom:6, fontSize:13}}>
              <span>{progress.done} / {progress.total}</span>
              <span>{pct}%</span>
            </div>
            <div style={{height:8, background:'var(--bg-soft, #f1f5f9)', borderRadius:4, overflow:'hidden'}}>
              <div style={{height:'100%', width:pct+'%', background:'var(--brand)', transition:'width .2s'}}/>
            </div>
          </div>
          {progress.summary && (
            <div style={{margin:'12px 0', padding:10, borderRadius:6, background:'var(--bg-soft, #f1f5f9)', fontSize:13}}>
              ✓ {progress.summary.ok} OK · ✗ {progress.summary.err} errores
            </div>
          )}
          <div style={{maxHeight:240, overflow:'auto', border:'1px solid var(--border)', borderRadius:6, fontSize:12}}>
            {progress.log.slice().reverse().map((l, i) => (
              <div key={i} style={{padding:'6px 10px', borderBottom:'1px solid var(--border)', display:'flex', gap:8}}>
                <span style={{color: l.ok ? '#22c55e' : '#ef4444'}}>{l.ok?'✓':'✗'}</span>
                <span className="mono" style={{minWidth:120}}>{l.sku}</span>
                <span style={{flex:1, color:'var(--text-muted)'}}>{l.msg}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn primary" onClick={onClose} disabled={busy}>{busy ? 'En curso…' : 'Cerrar'}</button>
        </div>
      </div>
    </div>
  );
}

function ProductDrawer({ p, onClose, reload, stock }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-fullscreen-mobile" style={{maxWidth:680}} onClick={e=>e.stopPropagation()}>
        <div className="modal-header"><h3 className="modal-title">{p.nombre}</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div style={{display:'grid', gridTemplateColumns:'120px 1fr', gap:16}}>
            <div>
              {(p.imagenes || p.shopify_images || []).slice(0,4).map((img, i) => (
                <img key={i} src={img.src} alt="" style={{width:'100%', borderRadius:6, marginBottom:6}}/>
              ))}
              {!(p.imagenes || p.shopify_images || []).length && <div style={{padding:30, background:'var(--bg-soft, #f1f5f9)', borderRadius:6, textAlign:'center', color:'var(--text-muted)'}}><Icon name="image" size={20}/></div>}
            </div>
            <div style={{fontSize:13, lineHeight:1.7}}>
              <div><strong>SKU:</strong> <span className="mono">{p.sku}</span></div>
              <div><strong>Marca:</strong> {p.marca || '—'}</div>
              <div><strong>Categoría:</strong> {p.categoria || '—'}</div>
              <div><strong>Precio:</strong> {fmt.usd(p.base || 0)}</div>
              <div><strong>Stock:</strong> {stock}</div>
              <div style={{marginTop:8}}><strong>Estado Shopify:</strong> {p.shopify_product_id ? <span style={{color:'#22c55e'}}>● Conectado · ID {p.shopify_product_id}</span> : <span style={{color:'#94a3b8'}}>○ Sin vincular</span>}</div>
              {p.shopify_handle && <div><strong>Handle:</strong> <span className="mono">{p.shopify_handle}</span></div>}
              {p.shopify_last_sync && <div><strong>Última sync:</strong> {new Date(p.shopify_last_sync).toLocaleString("es-VE",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"America/Caracas"})}</div>}
              {p.descripcion && <div style={{marginTop:8}}><strong>Descripción:</strong><br/>{p.descripcion}</div>}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
