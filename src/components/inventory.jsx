// Inventarios multi-almacén, Listas de precios, Cargas masivas
const { useState, useMemo, useRef, useEffect, useCallback } = React;

const getAlmacenes = () => window.getAlmacenes?.() || SSData.almacenes;
const safeInv = (sku, almId) => SSData.inventario[sku]?.[almId] || { cantidad: 0, reservado: 0, minimo: 0, maximo: 0, locacion: '' };

function getCategorias() {
  // Source of truth: SSData.categorias (loaded from DB + products on loadAppData)
  if (Array.isArray(SSData.categorias) && SSData.categorias.length > 0) return [...new Set(SSData.categorias)];
  const fromProducts = [...new Set(SSData.productos.map(p => p.categoria).filter(Boolean))];
  try {
    const CATS_KEY = 'ss-categorias'; // legacy fallback
    const s = localStorage.getItem(CATS_KEY);
    if (s) {
      const local = JSON.parse(s);
      const merged = [...new Set([...fromProducts, ...local])].sort((a,b)=>a.localeCompare(b,'es'));
      return merged;
    }
  } catch(e) {}
  return fromProducts.sort((a,b)=>a.localeCompare(b,'es'));
}
function saveCategorias(list) {
  if (!Array.isArray(SSData.categorias)) SSData.categorias = [];
  SSData.categorias.length = 0;
  list.forEach(c => SSData.categorias.push(c));
}

// ── Listas de precios persistence (Supabase) ───────────────────────────────
async function saveLista(lista) {
  const empresa = window.currentEmpresa || 'demo1';
  const payload = {
    id:              lista.id,
    nombre:          lista.nombre,
    tipo_cliente_id: lista.tipo || null,
    modo:            lista.modo || 'descuento',
    valor:           parseFloat(lista.valor) || 0,
    empresa_id:      empresa,
  };
  const { error } = await window.sb.from('listas_precios').upsert([payload]);
  return error;
}

async function deleteLista(id) {
  // Limpia FK en clientes (clientes no tiene empresa_id, usa array empresas)
  const { error: cliErr } = await window.sb.from('clientes').update({ lista_precio: null }).eq('lista_precio', id);
  if (cliErr) return cliErr;
  // Borra el detalle de precios por SKU
  await window.sb.from('lista_precios_detalle').delete().eq('lista_id', id);
  const { error } = await window.sb.from('listas_precios').delete().eq('id', id);
  return error;
}

const PHOTOS_KEY = 'ss-product-photos';
function getProductPhoto(sku) {
  try { const s = localStorage.getItem(PHOTOS_KEY); if (s) { const m = JSON.parse(s)[sku]; if (m) return m; } } catch(e) {}
  // Fallback: imágenes guardadas en producto (importadas de Shopify u otra fuente)
  const p = (window.SSData?.productos || []).find(x => x.sku === sku);
  const imgs = p?.imagenes || p?.shopify_images || [];
  return imgs[0]?.src || null;
}
// Devuelve TODAS las imágenes del producto: foto local primero, luego las de la BD
function getProductImages(producto) {
  const out = [];
  const seen = new Set();
  const local = (() => { try { return JSON.parse(localStorage.getItem(PHOTOS_KEY) || '{}')[producto.sku]; } catch { return null; } })();
  if (local) { out.push({ src: local, alt: producto.nombre, source: 'local' }); seen.add(local); }
  const remote = producto?.imagenes || producto?.shopify_images || [];
  for (const img of remote) {
    if (img?.src && !seen.has(img.src)) { out.push({ src: img.src, alt: img.alt || producto.nombre, source: 'shopify' }); seen.add(img.src); }
  }
  return out;
}
function saveProductPhoto(sku, dataUrl) {
  try {
    const all = JSON.parse(localStorage.getItem(PHOTOS_KEY) || '{}');
    if (dataUrl) all[sku] = dataUrl; else delete all[sku];
    localStorage.setItem(PHOTOS_KEY, JSON.stringify(all));
  } catch(e) {}
}

// Carrusel de imágenes con miniaturas, navegación y zoom modal
function ImageCarousel({ images }) {
  const [idx, setIdx] = React.useState(0);
  const [zoom, setZoom] = React.useState(false);
  if (!images || !images.length) return null;
  const cur = images[idx];
  const next = () => setIdx(i => (i + 1) % images.length);
  const prev = () => setIdx(i => (i - 1 + images.length) % images.length);

  React.useEffect(() => {
    if (!zoom) return;
    const onKey = (e) => { if (e.key === 'Escape') setZoom(false); if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft') prev(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom, images.length]);

  return (
    <div style={{marginBottom:16}}>
      <div style={{position:'relative', width:'100%', background:'var(--bg-sunken,#f1f5f9)', borderRadius:10, overflow:'hidden', aspectRatio:'16/9', maxHeight:340}}>
        <img src={cur.src} alt={cur.alt || ''} onClick={()=>setZoom(true)}
          style={{width:'100%', height:'100%', objectFit:'contain', cursor:'zoom-in', display:'block'}}/>
        {images.length > 1 && (
          <>
            <button onClick={prev} style={navBtn('left')}>‹</button>
            <button onClick={next} style={navBtn('right')}>›</button>
            <div style={{position:'absolute', top:8, right:10, background:'rgba(0,0,0,.55)', color:'#fff', padding:'2px 8px', borderRadius:4, fontSize:11}}>
              {idx+1} / {images.length}
            </div>
          </>
        )}
        {cur.source === 'shopify' && (
          <div style={{position:'absolute', top:8, left:10, background:'rgba(0,0,0,.55)', color:'#fff', padding:'2px 8px', borderRadius:4, fontSize:10}}>
            <Icon name="external" size={10}/> Shopify
          </div>
        )}
      </div>
      {images.length > 1 && (
        <div style={{display:'flex', gap:6, marginTop:8, overflowX:'auto', paddingBottom:4}}>
          {images.map((img, i) => (
            <div key={i} onClick={()=>setIdx(i)}
              style={{flexShrink:0, width:60, height:60, borderRadius:6, overflow:'hidden', cursor:'pointer',
                border: i === idx ? '2px solid var(--brand)' : '2px solid transparent',
                background:'var(--bg-sunken,#f1f5f9)'}}>
              <img src={img.src} alt="" style={{width:'100%', height:'100%', objectFit:'cover', display:'block'}}/>
            </div>
          ))}
        </div>
      )}
      {zoom && (
        <div onClick={()=>setZoom(false)}
          style={{position:'fixed', inset:0, background:'rgba(0,0,0,.92)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:40, cursor:'zoom-out'}}>
          <img src={cur.src} alt="" style={{maxWidth:'100%', maxHeight:'100%', objectFit:'contain'}}/>
          {images.length > 1 && (
            <>
              <button onClick={(e)=>{e.stopPropagation(); prev();}} style={{...navBtn('left'), top:'50%', fontSize:40, width:60, height:60}}>‹</button>
              <button onClick={(e)=>{e.stopPropagation(); next();}} style={{...navBtn('right'), top:'50%', fontSize:40, width:60, height:60}}>›</button>
            </>
          )}
          <button onClick={()=>setZoom(false)} style={{position:'absolute', top:20, right:24, background:'rgba(255,255,255,.15)', color:'#fff', border:'none', width:42, height:42, borderRadius:'50%', fontSize:22, cursor:'pointer'}}>×</button>
        </div>
      )}
    </div>
  );
}
function navBtn(side) {
  return {
    position:'absolute', top:'50%', transform:'translateY(-50%)', [side]:8,
    width:36, height:36, borderRadius:'50%', border:'none',
    background:'rgba(0,0,0,.55)', color:'#fff', fontSize:24, cursor:'pointer',
    display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1,
  };
}

// Celda de etiquetas compacta: en vez de listar todas las etiquetas (ensancha la tabla) muestra
// un badge contador. Al pasar el mouse (title) lista los nombres; al hacer clic las despliega
// todas como chips de color en línea (sin popover flotante, para no chocar con el scroll de la tabla).
function EtiquetasCell({ tags, defs }) {
  const [open, setOpen] = useState(false);
  const list = [...new Set(tags || [])].filter(Boolean);
  if (list.length === 0) return <span className="muted small">—</span>;
  const chip = (t) => {
    const color = (defs || []).find(e => e.nombre === t)?.color || '#6b7280';
    return <span key={t} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: color + '22', color, fontWeight: 500, whiteSpace: 'nowrap' }}>{t}</span>;
  };
  if (open) {
    return (
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', maxWidth: 240, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
        {list.map(chip)}
        <button className="icon-btn" style={{ width: 18, height: 18 }} title="Ocultar etiquetas" onClick={() => setOpen(false)}><Icon name="x" size={11} /></button>
      </div>
    );
  }
  return (
    <button
      type="button"
      title={list.join(' · ')}
      onClick={e => { e.stopPropagation(); setOpen(true); }}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, padding: '2px 8px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--bg-sunken)', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
    >
      <Icon name="link" size={10} />{list.length}
    </button>
  );
}

window.InventoryPage = function InventoryPage() {
  // Filtros y búsqueda RECORDADOS: cambiar de módulo y volver ya no los borra.
  const [almacenFilter, setAlmacenFilter] = window.usePersistedState('ss-inventario-f-almacen', 'all');
  const [catFilter, setCatFilter] = window.usePersistedState('ss-inventario-f-cat', '');
  const [marcaFilter, setMarcaFilter] = window.usePersistedState('ss-inventario-f-marca', '');
  const [stockFilter, setStockFilter] = window.usePersistedState('ss-inventario-f-stock', '');
  const [searchTerms, setSearchTerms] = window.usePersistedState('ss-inventario-f-busqueda', []);
  const [view, setView] = window.usePersistedState('ss-inventario-f-vista', 'grid');
  const [selProd, setSelProd] = useState(null);
  const [showBulk, setShowBulk] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showCats, setShowCats] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  // La tabla, para que `window.TablaColumnas` lea sus encabezados y les aplique ancho o las
  // esconda. Va por ref y no por una lista declarada: las columnas cambian con los permisos.
  const tablaRef = React.useRef(null);
  // El contenedor con el scroll horizontal (distinto de `tablaRef`, que apunta al <table>): lo usa
  // la barra flotante para no tener que bajar al final de la página para desplazarse a los lados
  // (mismo componente que ya usan las 4 listas de documentos, pedido 2026-08-14).
  const scrollWrapRef = React.useRef(null);
  const [prodVersion, setProdVersion] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [showTransfer, setShowTransfer] = useState(false);
  const [showBulkTransfer, setShowBulkTransfer] = useState(false);
  const [showAjuste, setShowAjuste] = useState(false);
  const [showTags, setShowTags] = useState(false);
  // movimientos now lives at /inventario/movimientos
  const [etiquetas, setEtiquetas] = useState([]);
  const [tagFilter, setTagFilter] = useState('');
  useEffect(() => { window.loadEtiquetas?.().then(list => setEtiquetas(list || [])); }, [prodVersion]);
  const [transferProd, setTransferProd] = useState(null);
  // Paginación (estándar #2). localStorage: ss-inventario-pagesize
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    const v = parseInt(localStorage.getItem('ss-inventario-pagesize'));
    return [50,100,200].includes(v) ? v : 50;
  });
  useEffect(() => { localStorage.setItem('ss-inventario-pagesize', String(pageSize)); }, [pageSize]);

  // Apertura directa de transferencia desde otro módulo (p. ej. la alerta de stock en POS):
  // el SKU llega por sessionStorage y aquí abrimos el modal ya cargado con ese producto.
  useEffect(() => {
    let sku = null;
    try { sku = sessionStorage.getItem('ss-inv-open-transfer'); } catch (e) {}
    if (!sku) return;
    try { sessionStorage.removeItem('ss-inv-open-transfer'); } catch (e) {}
    setTransferProd((SSData.productos || []).find(p => p.sku === sku) || { sku });
    setShowTransfer(true);
  }, []);

  useEffect(() => {
    const nav = window.__ssCmdNav;
    if (nav?.kind === 'Producto' && nav.id) {
      window.__ssCmdNav = null;
      const target = (SSData.productos || []).find(p => p.sku === nav.id || p.id === nav.id);
      if (target) setSelProd(target);
    }
    // M-02: abrir detalle de producto desde CmdK /sn <serial> — autoabre tab Seriales.
    // Bug reportado ("clic en un serial desde Ctrl+K deja una página en blanco"): antes esto se
    // resolvía con un evento (`ss-open-serial`) que shell.jsx disparaba con `setTimeout(fn, 0)`
    // justo después de `navigate('/inventario')`. Si el usuario YA estaba en /inventario,
    // `navigate` a la MISMA ruta fuerza un REMOUNT (ver `navTick` en app-bootstrap: "volver a
    // hacer clic en el módulo activo" bumpea la key) — el remount desregistra el listener viejo
    // y registra el nuevo de forma asíncrona (efectos corren después del commit), así que el
    // `setTimeout(0)` casi siempre ganaba la carrera y el evento se disparaba al vacío. Se lee un
    // GLOBAL seteado ANTES de navegar (mismo patrón que `ss-inv-open-transfer`, un poco más
    // arriba): no importa si esto corre en el primer mount o en un remount, el dato ya está ahí.
    const pendienteSerial = window.__ssOpenSerialInventario;
    if (pendienteSerial?.sku) {
      window.__ssOpenSerialInventario = null;
      const target = (SSData.productos || []).find(p => p.sku === pendienteSerial.sku);
      if (target) setSelProd({ ...target, _autoOpenSeriales: true, _highlightSerial: pendienteSerial.serial });
    }
    // Recomputar rows cuando termine la carga de Fase 1/2 (SSData.productos cambia). Por
    // `ssOnDatos` y no evento por evento: los datos llegan en 4-6 tandas por arranque y cada
    // aviso recalculaba las filas de los 6.593 productos. Agrupadas, son dos repintados.
    const off = window.ssOnDatos(() => setProdVersion(v => v + 1));
    return off;
  }, []);

  function toggleSelect(sku, e) {
    e.stopPropagation();
    setSelected(prev => { const n = new Set(prev); n.has(sku) ? n.delete(sku) : n.add(sku); return n; });
  }
  function toggleAll() {
    setSelected(prev => prev.size === rows.length ? new Set() : new Set(rows.map(r => r.sku)));
  }
  function clearSelection() { setSelected(new Set()); }

  function handleBulkCat(cat) {
    const skus = [...selected];
    skus.forEach(sku => { const p = SSData.productos.find(x => x.sku === sku); if (p) p.categoria = cat; });
    setProdVersion(v => v + 1);
    window.logActivity?.({ modulo:'inventario', accion:'bulk_editar', detalles:{ campo:'categoria', valor:cat, skus, total:skus.length } });
  }
  function handleBulkMarca(marca) {
    const skus = [...selected];
    skus.forEach(sku => { const p = SSData.productos.find(x => x.sku === sku); if (p) p.marca = marca; });
    setProdVersion(v => v + 1);
    window.logActivity?.({ modulo:'inventario', accion:'bulk_editar', detalles:{ campo:'marca', valor:marca, skus, total:skus.length } });
  }
  async function handleBulkAddTag(tag) {
    const skus = [...selected];
    await Promise.all(skus.map(async sku => {
      const p = SSData.productos.find(x => x.sku === sku);
      if (!p) return;
      const next = Array.from(new Set([...(p.etiquetas || []), tag]));
      p.etiquetas = next;
      await window.actualizarEtiquetasProducto?.(sku, next);
    }));
    setProdVersion(v => v + 1);
    window.logActivity?.({ modulo:'inventario', accion:'bulk_editar', detalles:{ campo:'etiquetas', operacion:'agregar', valor:tag, skus, total:skus.length } });
  }
  async function handleBulkRemoveTag(tag) {
    const skus = [...selected];
    await Promise.all(skus.map(async sku => {
      const p = SSData.productos.find(x => x.sku === sku);
      if (!p) return;
      const next = (p.etiquetas || []).filter(t => t !== tag);
      p.etiquetas = next;
      await window.actualizarEtiquetasProducto?.(sku, next);
    }));
    setProdVersion(v => v + 1);
    window.logActivity?.({ modulo:'inventario', accion:'bulk_editar', detalles:{ campo:'etiquetas', operacion:'quitar', valor:tag, skus, total:skus.length } });
  }
  function exportInventoryXLSX(targetRows, filename) {
    if (!window.XLSX) { alert('Librería XLSX no disponible. Recargá la página.'); return; }
    const almacenes = getAlmacenes();
    const headers = [
      'SKU', 'Nombre', 'Marca', 'Categoría',
      'Costo USD', 'Precio Base', 'Stock Total', 'Disponible', 'En Orden',
      ...almacenes.map(a => 'Stock: ' + a.nombre),
      ...almacenes.map(a => 'Reservado: ' + a.nombre),
      ...almacenes.map(a => 'Mínimo: ' + a.nombre),
    ];
    const data = targetRows.map(r => [
      r.sku,
      r.nombre    || '',
      r.marca     || '',
      r.categoria || '',
      Number(r.costo)      || 0,
      Number(r.base)       || 0,
      Number(r.total)      || 0,
      Number(r.disponible) || 0,
      Number(r.enOrden)    || 0,
      ...almacenes.map(a => { const s = (r.stocks || []).find(x => x.a.id === a.id); return s ? (Number(s.cantidad)  || 0) : 0; }),
      ...almacenes.map(a => { const s = (r.stocks || []).find(x => x.a.id === a.id); return s ? (Number(s.reservado) || 0) : 0; }),
      ...almacenes.map(a => { const s = (r.stocks || []).find(x => x.a.id === a.id); return s ? (Number(s.minimo)    || 0) : 0; }),
    ]);
    const ws = window.XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = [
      { wch: 16 }, { wch: 44 }, { wch: 20 }, { wch: 20 },
      { wch: 12 }, { wch: 12 }, { wch: 13 }, { wch: 13 }, { wch: 11 },
      ...almacenes.flatMap(() => [{ wch: 16 }, { wch: 14 }, { wch: 12 }]),
    ];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    window.XLSX.writeFile(wb, filename);
  }

  function handleBulkExport() {
    const targets = rows.filter(r => selected.has(r.sku));
    const date = window.localDateStr();
    exportInventoryXLSX(targets, `inventario_seleccion_${date}.xlsx`);
  }

  function handleExportAll() {
    const date = window.localDateStr();
    exportInventoryXLSX(rows, `inventario_${date}.xlsx`);
  }
  async function handleBulkDelete() {
    if (!confirm(`¿Eliminar ${selected.size} producto${selected.size !== 1 ? 's' : ''}? Se enviarán a la papelera por 30 días.`)) return;
    const skus = [...selected];
    const targets = SSData.productos.filter(p => skus.includes(p.sku));
    if (targets.length === 0) { setSelected(new Set()); return; }

    // 1) Persistir soft-delete en DB primero
    const { error } = await window.deleteProductos(skus);
    if (error) {
      console.error('[Inventario] Error eliminando productos:', error);
      alert('No se pudieron eliminar los productos: ' + (error.message || 'error desconocido'));
      return;
    }

    // 2) Solo si DB confirmó: agregar cada producto a papelera (uno por uno)
    targets.forEach(p => window.ssTrash?.add('producto', p.nombre, p));

    // 3) Refrescar UI desde DB para garantizar consistencia 100% con el backend
    setSelected(new Set());
    await window.loadAppData();
    setProdVersion(v => v + 1);

    window.logActivity?.({
      modulo:'inventario', accion: targets.length === 1 ? 'eliminar' : 'bulk_eliminar',
      entidad_id: targets.length === 1 ? targets[0].sku : null,
      entidad_label: targets.length === 1 ? targets[0].nombre : `${targets.length} productos`,
      detalles:{ skus, nombres: targets.map(t => t.nombre) }
    });
  }

  // Hold por SKU = `reservado` REAL de la tabla inventario (mantenido server-side por triggers y
  // liberado al despachar). Es la MISMA fuente que window.getDisponible.
  // ANTES se re-derivaba sumando las líneas de órdenes en estado 'generada'/'orden', pero un
  // despacho NO cambia el estado de la orden → esas unidades quedaban "pegadas" en hold para
  // siempre aunque la mercancía ya salió (bug ACC-ABR25: 20 uds despachadas seguían en hold).
  const enOrdenBySku = useMemo(() => {
    const m = {};
    const almacenes = getAlmacenes();
    const targetAlms = (almacenFilter && almacenFilter !== 'all')
      ? almacenes.filter(a => a.id === almacenFilter)
      : almacenes;
    (SSData.productos || []).forEach(p => {
      let r = 0;
      targetAlms.forEach(a => { r += (safeInv(p.sku, a.id).reservado || 0); });
      if (r > 0) m[p.sku] = r;
    });
    return m;
  }, [prodVersion, almacenFilter]);

  const rows = useMemo(() => {
    const almacenes = getAlmacenes();
    return SSData.productos.filter(p => {
      if (catFilter) {
        const a = (p.categoria||'').trim().toLowerCase();
        const b = catFilter.trim().toLowerCase();
        if (a !== b) return false;
      }
      if (marcaFilter) {
        const a = (p.marca||'').trim().toLowerCase();
        const b = marcaFilter.trim().toLowerCase();
        if (a !== b) return false;
      }
      if (!window.AdvancedSearch.matches(searchTerms, p.nombre, p.sku, p.marca)) return false;
      return true;
    }).map(p => {
      const filteredAlmacenes = almacenFilter === 'all' ? almacenes : almacenes.filter(a => a.id === almacenFilter);
      const stocks = almacenes.map(a => ({ a, ...safeInv(p.sku, a.id) }));
      const totalGeneral = stocks.reduce((s, x) => s + x.cantidad, 0);
      const total = almacenFilter === 'all'
        ? totalGeneral
        : filteredAlmacenes.reduce((s, a) => s + (safeInv(p.sku, a.id).cantidad || 0), 0);
      const enOrden = enOrdenBySku[p.sku] || 0;
      const disponible = Math.max(0, total - enOrden);
      return { ...p, stocks, total, totalGeneral, enOrden, disponible };
    }).filter(p => {
      if (!stockFilter) return true;
      if (stockFilter === 'con') return p.disponible > 0;
      if (stockFilter === 'sin') return p.disponible === 0;
      if (stockFilter === 'bajo') {
        const min = Number(p.minimo) || 0;
        return min > 0 && p.disponible <= min;
      }
      // 'hold': el card "En hold (órdenes)" filtra a los productos con algo reservado — para
      // poder revisarlos uno por uno (p. ej. detectar reservas fantasma, ver bitácora 2026-08-14).
      if (stockFilter === 'hold') return p.enOrden > 0;
      return true;
    });
  }, [catFilter, marcaFilter, stockFilter, almacenFilter, searchTerms, prodVersion]);

  const totalValorizado = rows.reduce((s, r) => s + r.total * r.costo, 0);
  const totalUnidades = rows.reduce((s, r) => s + r.total, 0);

  // Bajo stock: productos con mínimo definido (>0) cuyo disponible cae al mínimo o por debajo
  const bajoStockCount = useMemo(() => {
    const alm = getAlmacenes();
    return (SSData.productos || []).reduce((n, p) => {
      const min = Number(p.minimo) || 0;
      if (min <= 0) return n;
      const stock = alm.reduce((s, a) => s + (safeInv(p.sku, a.id).cantidad || 0), 0);
      const disp = Math.max(0, stock - (enOrdenBySku[p.sku] || 0));
      return disp <= min ? n + 1 : n;
    }, 0);
  }, [prodVersion, enOrdenBySku]);

  // Ordenamiento — todas las columnas (incluidas stocks por almacén)
  const sortAccessors = useMemo(() => {
    const acc = {
      sku: r => r.sku || '',
      nombre: r => r.nombre || '',
      marca: r => r.marca || '',
      categoria: r => r.categoria || '',
      etiquetas: r => (r.etiquetas || []).join(', '),
      costo: r => Number(r.costo) || 0,
      base: r => Number(r.base) || 0,
      total: r => Number(r.total) || 0,
      enOrden: r => Number(r.enOrden) || 0,
      disponible: r => Number(r.disponible) || 0,
    };
    getAlmacenes().forEach(a => {
      acc['stock:' + a.id] = r => {
        const s = (r.stocks || []).find(x => x.a.id === a.id);
        return s ? Number(s.cantidad) || 0 : 0;
      };
    });
    return acc;
  }, [prodVersion]);

  const { sorted: sortedRows, sortKey, sortDir, requestSort } = window.useSortableData(
    rows, sortAccessors,
    { storageKey: 'ss-inventario-sort', defaultKey: null, defaultDir: 'asc' }
  );
  const sortState = { key: sortKey, dir: sortDir };

  // Reset a página 1 cuando cambia el conjunto filtrado o el orden
  useEffect(() => { setPage(1); }, [rows.length, sortKey, sortDir]);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const startIdx   = (safePage - 1) * pageSize;
  const pageRows   = sortedRows.slice(startIdx, startIdx + pageSize);
  // Las columnas que se muestran POR FILA (miniatura, etiquetas, quién lo creó) se piden solo para la
  // página visible: 50 sku son 36 kB contra los 2,3 MB que costaba traerlas de los 6.593 productos.
  // Se recuerda por sku, así que pasar de página pide solo lo nuevo y volver atrás no pide nada.
  const skusPagina = pageRows.map(r => r.sku).join(',');
  useEffect(() => {
    if (!skusPagina) return;
    window.ensureProductosCampos?.(skusPagina.split(','),
      ['imagenes', 'shopify_images', 'etiquetas', 'creado_por']);
  }, [skusPagina]);
  const pageBtns   = (() => {
    const max = 5; let from = Math.max(1, safePage - 2); let to = Math.min(totalPages, from + max - 1);
    from = Math.max(1, to - max + 1); const arr = []; for (let i = from; i <= to; i++) arr.push(i); return arr;
  })();

  // Skeleton loader: mientras no haya productos en SSData y la carga inicial no haya marcado __ssDataReady
  const isLoading = (SSData.productos || []).length === 0 && !window.__ssDataReady;
  const almacenesCount = getAlmacenes().length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Inventarios</h1>
          <div className="page-subtitle">{getAlmacenes().length} almacenes · {SSData.productos.length} SKUs</div>
        </div>
        <div className="page-actions">
          <button className="btn ghost" onClick={()=>window.__ssNavigate?.('/inventario/movimientos')}><Icon name="chart" size={14}/>Movimientos</button>
          {window.canUser?.('editar', 'inventory') !== false && (
            <button className="btn ghost" onClick={()=>setShowCats(true)}><Icon name="inventory" size={14}/>Categorías</button>
          )}
          {window.canUser?.('editar', 'inventory') !== false && (
            <button className="btn ghost" onClick={()=>setShowTags(true)}><Icon name="link" size={14}/>Etiquetas</button>
          )}
          {window.canUser?.('crear', 'inventory') !== false && (
            <button className="btn secondary" onClick={()=>setShowBulk(true)}><Icon name="upload" size={14} />Carga masiva</button>
          )}
          {window.canUser?.('editar', 'inventory') !== false && (
            <button className="btn secondary" onClick={() => setShowAjuste(true)}><Icon name="edit" size={14} />Ajustes</button>
          )}
          {window.canUser?.('editar', 'inventory') !== false && (
            <button className="btn secondary" onClick={() => { setTransferProd(null); setShowTransfer(true); }}><Icon name="truck" size={14} />Transferencia</button>
          )}
          {window.canUser?.('crear', 'inventory') !== false && (
            <button className="btn primary" onClick={()=>setShowNew(true)}><Icon name="plus" size={14} />Nuevo producto</button>
          )}
        </div>
      </div>

      {/* Pedido explícito (2026-08-14): un clic en cada card filtra la tabla de abajo, no solo
          "Bajo stock" (que ya lo hacía). "Valorizado total" queda afuera a propósito: es una suma
          en dólares, no hay un solo criterio de fila que reproduzca ese número al filtrar. */}
      <div className="stat-grid hide-sm">
        <div className="stat" style={{cursor:'pointer'}}
             onClick={() => { setCatFilter(''); setMarcaFilter(''); setStockFilter(''); setAlmacenFilter('all'); setSearchTerms([]); }}
             title="Quitar todos los filtros">
          <div className="stat-label">SKUs activos</div>
          <div className="stat-val">{isLoading ? <span className="ss-skel-stat-val"/> : SSData.productos.length}</div>
          <div className="small">{isLoading ? '…' : `${getCategorias().length} categorías · ${SSData.marcas.length} marcas`}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Valorizado total</div>
          <div className="stat-val">{isLoading ? <span className="ss-skel-stat-val"/> : fmt.usd(totalValorizado)}</div>
          <div className="small">Al costo · {isLoading ? '…' : totalUnidades.toLocaleString()} unidades</div>
        </div>
        <div className="stat" style={{cursor:'pointer'}} onClick={()=>setStockFilter(stockFilter==='bajo'?'':'bajo')} title="Filtrar por bajo mínimo">
          <div className="stat-label">Bajo stock</div>
          <div className="stat-val" style={{color: bajoStockCount > 0 ? 'var(--warn)' : 'var(--text)'}}>{isLoading ? <span className="ss-skel-stat-val"/> : bajoStockCount}</div>
          <div className="small">Disponible ≤ mínimo · por reponer</div>
        </div>
        <div className="stat" style={{cursor:'pointer'}} onClick={()=>setStockFilter(stockFilter==='hold'?'':'hold')} title="Filtrar por productos con hold">
          <div className="stat-label">En hold (órdenes)</div>
          <div className="stat-val" style={{color:'var(--warn)'}}>{isLoading ? <span className="ss-skel-stat-val"/> : rows.reduce((s,r)=>s+r.enOrden,0)}</div>
          <div className="small">Comprometidos en órdenes abiertas</div>
        </div>
      </div>

      <div className="tbl-wrap mt-4">
        <div className="tbl-toolbar inv-filter-bar" style={{flexWrap:'wrap', gap:'6px 8px'}}>
          <AdvancedSearch
            terms={searchTerms}
            onTermsChange={setSearchTerms}
            storageKey="ss-saved-search-productos"
            placeholder="Buscar SKU, nombre o marca... (Enter para añadir)"
            style={{flex:'1 1 240px', minWidth:200}}
          />
          <window.MobileFilters count={[catFilter, marcaFilter, stockFilter, almacenFilter !== 'all' ? almacenFilter : ''].filter(Boolean).length}>
          <select className="select" value={catFilter} onChange={e=>setCatFilter(e.target.value)}>
            <option value="">Todas categorías</option>
            {getCategorias().map(c => <option key={c}>{c}</option>)}
          </select>
          <select className="select" value={marcaFilter} onChange={e=>setMarcaFilter(e.target.value)}>
            <option value="">Todas marcas</option>
            {SSData.marcas.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select className="select" value={almacenFilter} onChange={e=>setAlmacenFilter(e.target.value)}>
            <option value="all">Todos los almacenes</option>
            {getAlmacenes().map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
          <select className="select" value={stockFilter} onChange={e=>setStockFilter(e.target.value)}>
            <option value="">Todo stock</option>
            <option value="con">Con existencia</option>
            <option value="sin">Sin existencia</option>
            <option value="bajo">Bajo mínimo</option>
            <option value="hold">En hold (órdenes)</option>
          </select>
          {(searchTerms.length > 0 || catFilter || marcaFilter || stockFilter || almacenFilter !== 'all') && (
            <button className="btn ghost" style={{padding:'5px 10px', fontSize:12}} title="Limpiar filtros"
              onClick={() => { setSearchTerms([]); setCatFilter(''); setMarcaFilter(''); setStockFilter(''); setAlmacenFilter('all'); }}>
              <Icon name="x" size={12}/>Limpiar
            </button>
          )}
          </window.MobileFilters>
          <span className="small muted ml-auto" style={{whiteSpace:'nowrap', alignSelf:'center'}}>
            {rows.length} / {SSData.productos.length} productos
          </span>
          <button className="btn ghost sm" onClick={() => setShowActivity(true)} title="Ver registro de actividad"><Icon name="receipt" size={13}/>Actividad</button>
          <button className="btn ghost sm" onClick={handleExportAll} title={`Exportar ${rows.length} productos a Excel`}><Icon name="download" size={13}/>Exportar</button>
          {/* Ocultar columnas y ajustar su ancho — el nombre del producto es el caso que lo pidió:
              con la columna angosta se corta y no se sabe qué producto es. */}
          <window.TablaColumnas moduloId="inventario" tablaRef={tablaRef}/>
        </div>
        <div className="tbl-scroll inv-scroll" ref={scrollWrapRef}>
          <table className="tbl" ref={tablaRef}>
            <thead>
              <tr>
                <th style={{width:36,padding:'4px 10px'}}>
                  <input type="checkbox"
                    ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < pageRows.length; }}
                    checked={pageRows.length > 0 && pageRows.every(r => selected.has(r.sku))}
                    onChange={() => {
                      setSelected(prev => {
                        const all = pageRows.every(r => prev.has(r.sku));
                        const n = new Set(prev);
                        if (all) pageRows.forEach(r => n.delete(r.sku));
                        else pageRows.forEach(r => n.add(r.sku));
                        return n;
                      });
                    }}
                    style={{cursor:'pointer'}}
                  />
                </th>
                <th style={{width:44,padding:'4px 8px'}}></th>
                <SortHeader sortKey="sku" current={sortState} onSort={requestSort} className="hide-sm" style={{width:118}}>SKU</SortHeader>
                <SortHeader sortKey="nombre" current={sortState} onSort={requestSort}>Producto</SortHeader>
                <SortHeader sortKey="marca" current={sortState} onSort={requestSort} className="hide-sm" style={{width:110}}>Marca</SortHeader>
                <SortHeader sortKey="categoria" current={sortState} onSort={requestSort} className="hide-sm" style={{width:150}}>Categoría</SortHeader>
                <SortHeader sortKey="etiquetas" current={sortState} onSort={requestSort} className="hide-sm" style={{width:66}} title="Etiquetas — clic en el badge para ver todas">Etiq.</SortHeader>
                <SortHeader sortKey="costo" current={sortState} onSort={requestSort} align="right" className="num hide-sm">Costo</SortHeader>
                <SortHeader sortKey="base" current={sortState} onSort={requestSort} align="right" className="num hide-sm">Base</SortHeader>
                {/* Total/Hold/Disp. van ACÁ, antes de los almacenes: son el resumen que se quiere
                    ver de un vistazo, sin tener que escanear toda la fila hasta el final. */}
                <SortHeader sortKey="total" current={sortState} onSort={requestSort} align="right" className="num">Total</SortHeader>
                <SortHeader sortKey="enOrden" current={sortState} onSort={requestSort} align="right" className="num hide-sm" title="Comprometido en órdenes abiertas">Hold</SortHeader>
                <SortHeader sortKey="disponible" current={sortState} onSort={requestSort} align="right" className="num">Disp.</SortHeader>
                {getAlmacenes().map(a => (
                  <SortHeader key={a.id} sortKey={'stock:' + a.id} current={sortState} onSort={requestSort}
                    align="right" className="num hide-sm" title={a.nombre}>
                    {a.nombre.replace('Almacén ','').replace('Sucursal ','').replace('Showroom ','').replace('Depósito ','').slice(0,10)}
                  </SortHeader>
                ))}
                <th className="dt-hide-mobile">Creado por</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({length: 8}).map((_, i) => (
                <tr key={`skel-${i}`} className="ss-skel-row">
                  <td style={{width:36}}><span className="ss-skel-cell" style={{width:14, height:14}}/></td>
                  <td style={{width:44}}><span className="ss-skel-cell" style={{width:32, height:32, borderRadius:6}}/></td>
                  <td className="hide-sm"><span className="ss-skel-line" style={{width:80}}/></td>
                  <td><span className="ss-skel-line" style={{width:'70%'}}/></td>
                  <td className="hide-sm"><span className="ss-skel-line" style={{width:60}}/></td>
                  <td className="hide-sm"><span className="ss-skel-line" style={{width:80}}/></td>
                  <td className="hide-sm"><span className="ss-skel-line" style={{width:90}}/></td>
                  <td className="num hide-sm"><span className="ss-skel-line" style={{width:50}}/></td>
                  <td className="num hide-sm"><span className="ss-skel-line" style={{width:50}}/></td>
                  <td className="num"><span className="ss-skel-line" style={{width:32}}/></td>
                  <td className="num hide-sm"><span className="ss-skel-line" style={{width:32}}/></td>
                  <td className="num"><span className="ss-skel-line" style={{width:32}}/></td>
                  {Array.from({length: almacenesCount}).map((_, j) => (
                    <td key={j} className="num hide-sm"><span className="ss-skel-line" style={{width:28}}/></td>
                  ))}
                  <td className="dt-hide-mobile"><span className="ss-skel-line" style={{width:80}}/></td>
                </tr>
              ))}
              {!isLoading && pageRows.map(r => {
                const photo = getProductPhoto(r.sku);
                const isSel = selected.has(r.sku);
                return (
                <tr key={r.sku}
                  onClick={e => { if (selected.size > 0) { toggleSelect(r.sku, e); } else { setSelProd(r); } }}
                  style={{cursor:'pointer', background: isSel ? 'var(--brand-soft)' : ''}}
                >
                  <td style={{padding:'4px 10px',width:36}} onClick={e=>toggleSelect(r.sku,e)}>
                    <input type="checkbox" checked={isSel} onChange={()=>{}} style={{cursor:'pointer',pointerEvents:'none'}}/>
                  </td>
                  <td style={{padding:'4px 8px',width:44}}>
                    {photo
                      ? <img src={photo} style={{width:32,height:32,borderRadius:6,objectFit:'cover',display:'block'}}/>
                      : <div style={{width:32,height:32,borderRadius:6,background:'var(--bg-sunken)',display:'grid',placeItems:'center',color:'var(--text-muted)',fontSize:8,fontWeight:600,letterSpacing:.5}}>{r.sku.slice(0,3)}</div>
                    }
                  </td>
                  <td className="mono-cell hide-sm" style={{maxWidth:118, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={r.sku}>{r.sku}</td>
                  <td style={{maxWidth: 230, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={r.nombre}>
                    <div style={{fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{r.nombre}</div>
                    <div className="small muted show-sm-only" style={{fontFamily:'var(--mono)', fontSize:10.5}}>{r.sku} · {r.marca}</div>
                  </td>
                  <td className="hide-sm"><span className="chip neutral">{r.marca}</span></td>
                  <td className="muted hide-sm" style={{fontSize: 12, maxWidth:150, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={r.categoria}>{r.categoria}</td>
                  <td className="hide-sm"><EtiquetasCell tags={r.etiquetas} defs={etiquetas}/></td>
                  <td className="num muted hide-sm">{fmt.usd(r.costo)}</td>
                  <td className="num hide-sm">{fmt.usd(r.base)}</td>
                  <td className="num strong-num">{r.total}</td>
                  <td className="num hide-sm" style={{color: r.enOrden > 0 ? 'var(--warn)' : 'var(--text-muted)', fontWeight: r.enOrden > 0 ? 600 : 400}}>
                    {r.enOrden > 0 ? <span className="chip amber" style={{fontSize:11}}>{r.enOrden}</span> : <span style={{opacity:0.4}}>—</span>}
                  </td>
                  <td className="num" style={{color: r.disponible === 0 ? 'var(--danger)' : r.disponible < 5 ? 'var(--warn)' : 'var(--success)', fontWeight: 600}}>{r.disponible}</td>
                  {r.stocks.map(s => (
                    <td key={s.a.id} className="num hide-sm" style={{color: s.cantidad < 10 ? 'var(--danger)' : s.cantidad < 20 ? 'var(--warn)' : 'inherit'}}>
                      {s.cantidad}
                    </td>
                  ))}
                  <td className="dt-hide-mobile"><CreadoPorCell nombre={r.creado_por}/></td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Footer paginación (estándar #2) */}
        <div className="dt-footer" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, padding:'10px 12px', borderTop:'1px solid var(--border)', flexWrap:'wrap', fontSize:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span className="muted">Filas por página:</span>
            <select className="select" value={pageSize} onChange={e => { setPageSize(parseInt(e.target.value)); setPage(1); }} style={{ fontSize:12, padding:'3px 6px' }}>
              {[50,100,200].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="muted">
              {rows.length === 0 ? '0 productos' : `Mostrando ${startIdx+1}–${Math.min(startIdx+pageSize, rows.length)} de ${rows.length}`}
            </span>
          </div>
          {totalPages > 1 && (
            <div style={{ display:'flex', alignItems:'center', gap:4 }}>
              <button className="btn ghost sm" disabled={safePage===1} onClick={() => setPage(1)}><Icon name="chevronL" size={11}/><Icon name="chevronL" size={11}/></button>
              <button className="btn ghost sm" disabled={safePage===1} onClick={() => setPage(p => Math.max(1, p-1))}><Icon name="chevronL" size={13}/></button>
              {pageBtns.map(p => (
                <button key={p} className={'btn sm ' + (p===safePage?'primary':'ghost')} style={{minWidth:30, padding:'3px 8px'}} onClick={() => setPage(p)}>{p}</button>
              ))}
              <button className="btn ghost sm" disabled={safePage===totalPages} onClick={() => setPage(p => Math.min(totalPages, p+1))}><Icon name="chevronR" size={13}/></button>
              <button className="btn ghost sm" disabled={safePage===totalPages} onClick={() => setPage(totalPages)}><Icon name="chevronR" size={11}/><Icon name="chevronR" size={11}/></button>
            </div>
          )}
        </div>
      </div>
      <window.FloatingHScrollbar targetRef={scrollWrapRef}/>

      {showActivity && <ActivityLogModal modulo="inventario" onClose={() => setShowActivity(false)}/>}

      {selProd && <ProductDetailModal producto={selProd} onClose={()=>setSelProd(null)} onUpdate={p=>{ setSelProd(p); setProdVersion(v=>v+1); }} onTransfer={p=>{ setTransferProd(p); setShowTransfer(true); }} />}
      {showBulk && <BulkImportModal onClose={()=>setShowBulk(false)} />}
      {showNew && <NewProductModal onClose={()=>{ setShowNew(false); setProdVersion(v=>v+1); }} />}
      {showCats && <CategoriasModal onClose={()=>setShowCats(false)} />}
      {showTags && <EtiquetasModal etiquetas={etiquetas} onClose={()=>{ setShowTags(false); setProdVersion(v=>v+1); }} />}
      {showTransfer && <TransferenciaModal productoInicial={transferProd} onClose={()=>{ setShowTransfer(false); setTransferProd(null); setProdVersion(v=>v+1); }} />}
      {showBulkTransfer && (
        <NuevaTransferenciaModal
          preItems={[...selected].map(sku => { const p = SSData.productos.find(x => x.sku === sku); return { sku, nombre: p?.nombre || sku }; })}
          onClose={() => setShowBulkTransfer(false)}
          onDone={() => { setShowBulkTransfer(false); clearSelection(); }}
        />
      )}
      {showAjuste && <AjusteInventarioModal onClose={()=>{ setShowAjuste(false); setProdVersion(v=>v+1); }} />}

      {/* ── Floating bulk action bar ── */}
      {/* Oculta mientras el modal de transferencia está abierto: la barra tiene z-index:300 y el
          overlay de los modales es 90 — sin esto quedaba flotando POR ENCIMA del modal (reportado
          2026-08-16 al revisar en móvil). Ningún otro botón de esta barra abre un modal bloqueante,
          por eso el conflicto no se había visto antes. */}
      {selected.size > 0 && !showBulkTransfer && (
        <div className="docs-bulk-bar" style={{
          position:'fixed', bottom:28, left:'50%', transform:'translateX(-50%)',
          background:'var(--bg-elev)', border:'1px solid var(--border)',
          borderRadius:16, boxShadow:'0 12px 40px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.15)',
          display:'flex', alignItems:'center', gap:6, padding:'10px 14px',
          zIndex:300, backdropFilter:'blur(12px)', flexWrap:'wrap',
        }}>
          {/* Count badge */}
          <div style={{display:'flex',alignItems:'center',gap:8,paddingRight:10,borderRight:'1px solid var(--border)',marginRight:4}}>
            <div style={{width:24,height:24,borderRadius:8,background:'var(--brand)',display:'grid',placeItems:'center',color:'#fff',fontSize:11,fontWeight:700}}>
              {selected.size}
            </div>
            <span style={{fontSize:13,fontWeight:600,whiteSpace:'nowrap'}}>
              {selected.size === 1 ? 'producto seleccionado' : 'productos seleccionados'}
            </span>
          </div>

          {/* Cambiar categoría */}
          {window.canUser?.('editar','inventory') !== false && (
          <select className="select" style={{height:32,fontSize:12,minWidth:150}}
            value=""
            onChange={e => { if (e.target.value) { handleBulkCat(e.target.value); e.target.value = ''; } }}
          >
            <option value="">Cambiar categoría…</option>
            {getCategorias().map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          )}

          {/* Cambiar marca */}
          {window.canUser?.('editar','inventory') !== false && (
          <select className="select" style={{height:32,fontSize:12,minWidth:140}}
            value=""
            onChange={e => { if (e.target.value) { handleBulkMarca(e.target.value); e.target.value = ''; } }}
          >
            <option value="">Cambiar marca…</option>
            {SSData.marcas.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          )}

          {/* Agregar etiqueta */}
          {window.canUser?.('editar','inventory') !== false && (
          <select className="select" style={{height:32,fontSize:12,minWidth:160}}
            value=""
            onChange={e => { if (e.target.value) { handleBulkAddTag(e.target.value); e.target.value = ''; } }}
          >
            <option value="">Agregar etiqueta…</option>
            {etiquetas.map(t => <option key={t.id || t.nombre} value={t.nombre}>{t.nombre}</option>)}
          </select>
          )}

          {/* Quitar etiqueta — solo tags presentes en al menos uno de los seleccionados */}
          {window.canUser?.('editar','inventory') !== false && (() => {
            const presentes = new Set();
            selected.forEach(sku => {
              const p = SSData.productos.find(x => x.sku === sku);
              (p?.etiquetas || []).forEach(t => presentes.add(t));
            });
            if (presentes.size === 0) return null;
            const lista = [...presentes].sort((a,b)=>a.localeCompare(b,'es'));
            return (
              <select className="select" style={{height:32,fontSize:12,minWidth:160}}
                value=""
                onChange={e => { if (e.target.value) { handleBulkRemoveTag(e.target.value); e.target.value = ''; } }}
              >
                <option value="">Quitar etiqueta…</option>
                {lista.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            );
          })()}

          {/* Transferir (a otro almacén de esta empresa, o a otra empresa habilitada del usuario) */}
          {window.canUser?.('crear','inventory') !== false && (
            <button className="btn ghost sm" onClick={() => setShowBulkTransfer(true)} style={{height:32}}>
              <Icon name="truck" size={13}/>Transferir
            </button>
          )}

          <div style={{width:1,height:20,background:'var(--border)',margin:'0 2px'}}/>

          {/* Exportar */}
          <button className="btn ghost sm" onClick={handleBulkExport} style={{height:32}}>
            <Icon name="download" size={13}/>Exportar
          </button>

          {/* Eliminar */}
          {window.canUser?.('eliminar','inventory') !== false && (
            <button className="btn ghost sm" style={{height:32,color:'var(--danger)'}} onClick={handleBulkDelete}>
              <Icon name="trash" size={13}/>Eliminar
            </button>
          )}

          {/* Clear */}
          <button className="icon-btn" onClick={clearSelection} title="Deseleccionar todo" style={{marginLeft:4}}>
            <Icon name="x" size={15}/>
          </button>
        </div>
      )}
    </div>
  );
};

// ======= Modal gestión de etiquetas =======
function EtiquetasModal({ etiquetas: initial, onClose }) {
  const [tags, setTags]       = useState(initial || []);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm]   = useState({ nombre: '', color: '#3b82f6' });
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');

  // Conteo de productos con cada etiqueta
  const counts = {};
  (SSData.productos || []).forEach(p => {
    (p.etiquetas || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
  });

  async function reload() {
    const list = await window.loadEtiquetas?.() || [];
    setTags(list);
  }

  async function crear() {
    if (!newName.trim()) { setErr('Ingresa un nombre'); return; }
    if (tags.some(t => t.nombre.toLowerCase() === newName.trim().toLowerCase())) {
      setErr('Ya existe una etiqueta con ese nombre');
      return;
    }
    setErr(''); setSaving(true);
    const { error, id } = await window.crearEtiqueta({ nombre: newName.trim(), color: newColor });
    setSaving(false);
    if (error) { setErr('Error: ' + error.message); return; }
    window.logActivity?.({ modulo:'inventario', accion:'crear', entidad_id:id, entidad_label:'Etiqueta: '+newName.trim(), detalles:{ color:newColor } });
    setNewName(''); setNewColor('#3b82f6');
    await reload();
  }

  async function guardarEdit(id) {
    if (!editForm.nombre.trim()) return;
    const oldName = tags.find(t => t.id === id)?.nombre;
    const { error } = await window.actualizarEtiqueta(id, { nombre: editForm.nombre.trim(), color: editForm.color });
    if (error) { alert('Error: ' + error.message); return; }
    window.logActivity?.({ modulo:'inventario', accion:'editar', entidad_id:id, entidad_label:'Etiqueta: '+editForm.nombre.trim(), detalles:{ nombre_anterior:oldName, color:editForm.color } });
    // Si cambió el nombre, propagar a productos que la tengan
    if (oldName && oldName !== editForm.nombre.trim()) {
      const empresa = window.currentEmpresa || 'demo1';
      const { data: prods } = await window.sb
        .from('productos').select('sku, etiquetas')
        .overlaps('empresas', [empresa]).contains('etiquetas', [oldName]);
      for (const p of (prods || [])) {
        const nuevo = (p.etiquetas || []).map(t => t === oldName ? editForm.nombre.trim() : t);
        await window.sb.from('productos').update({ etiquetas: nuevo }).eq('sku', p.sku).overlaps('empresas', [empresa]);
      }
    }
    setEditingId(null);
    await reload();
  }

  async function eliminar(t) {
    const c = counts[t.nombre] || 0;
    if (!confirm(`¿Eliminar la etiqueta «${t.nombre}»?${c > 0 ? `\nSe quitará de ${c} producto${c!==1?'s':''}.` : ''}`)) return;
    const { error } = await window.eliminarEtiqueta(t.id, t.nombre);
    if (error) { alert('Error: ' + error.message); return; }
    window.logActivity?.({ modulo:'inventario', accion:'eliminar', entidad_id:t.id, entidad_label:'Etiqueta: '+t.nombre, detalles:{ productos_afectados:c } });
    await reload();
  }

  const COLORES = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#6366f1','#84cc16','#f97316'];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width:'min(640px, 96vw)', maxHeight:'90vh', display:'flex', flexDirection:'column'}}>
        <div className="modal-header">
          <div style={{width:38,height:38,borderRadius:9,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}>
            <Icon name="link" size={18}/>
          </div>
          <div style={{flex:1}}>
            <div className="modal-title">Etiquetas de productos</div>
            <div className="small">{tags.length} etiqueta{tags.length!==1?'s':''} · {Object.values(counts).reduce((s,n)=>s+n,0)} asignaciones</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        <div className="modal-body" style={{overflowY:'auto'}}>
          <div className="card" style={{padding:14, background:'var(--bg-sunken)', marginBottom:14}}>
            <div className="form-section-title" style={{marginTop:0}}>Crear etiqueta</div>
            <div style={{display:'flex', gap:8, alignItems:'flex-end', flexWrap:'wrap'}}>
              <div style={{flex:1, minWidth:180}}>
                <label className="form-label">Nombre</label>
                <input className="input" value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Hogar"
                  onKeyDown={e => e.key === 'Enter' && crear()}/>
              </div>
              <div>
                <label className="form-label">Color</label>
                <div style={{display:'flex', gap:4}}>
                  {COLORES.map(c => (
                    <div key={c} onClick={()=>setNewColor(c)}
                      style={{width:22, height:22, borderRadius:5, background:c, cursor:'pointer', border: newColor===c ? '2px solid var(--text)' : '2px solid transparent'}}/>
                  ))}
                </div>
              </div>
              <button className="btn primary" onClick={crear} disabled={saving || !newName.trim()}>
                <Icon name="plus" size={13}/>Crear
              </button>
            </div>
            {err && <div style={{marginTop:8, padding:'6px 10px', background:'#fee2e2', borderRadius:6, fontSize:12, color:'#b91c1c'}}>{err}</div>}
          </div>

          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Etiqueta</th><th className="num">Productos</th><th></th></tr>
              </thead>
              <tbody>
                {tags.length === 0 && <tr><td colSpan={3} className="empty">Sin etiquetas creadas</td></tr>}
                {tags.map(t => {
                  const c = counts[t.nombre] || 0;
                  const isEditing = editingId === t.id;
                  return (
                    <tr key={t.id}>
                      <td>
                        {isEditing ? (
                          <div style={{display:'flex', gap:6, alignItems:'center'}}>
                            <input className="input" style={{width:160, padding:'2px 6px'}} value={editForm.nombre}
                              onChange={e=>setEditForm(f=>({...f,nombre:e.target.value}))}/>
                            <div style={{display:'flex', gap:3}}>
                              {COLORES.map(c => (
                                <div key={c} onClick={()=>setEditForm(f=>({...f,color:c}))}
                                  style={{width:18, height:18, borderRadius:4, background:c, cursor:'pointer', border: editForm.color===c ? '2px solid var(--text)' : '1px solid var(--border)'}}/>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <span style={{padding:'3px 10px', borderRadius:5, background: t.color + '22', color: t.color, fontWeight:600, fontSize:12}}>{t.nombre}</span>
                        )}
                      </td>
                      <td className="num">{c}</td>
                      <td style={{textAlign:'right'}}>
                        {isEditing ? (
                          <>
                            <button className="btn primary sm" onClick={()=>guardarEdit(t.id)}><Icon name="check" size={12}/></button>
                            <button className="btn ghost sm" onClick={()=>setEditingId(null)} style={{marginLeft:4}}>Cancelar</button>
                          </>
                        ) : (
                          <>
                            <button className="btn ghost sm" onClick={()=>{ setEditingId(t.id); setEditForm({ nombre: t.nombre, color: t.color }); }}><Icon name="edit" size={12}/></button>
                            <button className="btn ghost sm" style={{color:'var(--danger)'}} onClick={()=>eliminar(t)}><Icon name="trash" size={12}/></button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

// ======= Modal gestión de categorías =======
function CategoriasModal({ onClose }) {
  const [cats, setCats] = useState(() => getCategorias());
  const [editing, setEditing] = useState(null); // { cat: string, value: string }
  const [newName, setNewName] = useState('');
  const [search, setSearch] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  function productCount(cat) {
    return SSData.productos.filter(p => p.categoria === cat).length;
  }

  const empresa = () => window.currentEmpresa || 'demo1';

  function commit(list) {
    setCats(list);
    saveCategorias(list);
  }

  async function handleAdd() {
    const name = newName.trim();
    if (!name || cats.includes(name)) return;
    const id = 'cat-' + Date.now();
    const { error } = await window.sb.from('categorias')
      .insert([{ id, nombre: name, empresa_id: empresa() }]);
    if (error) { alert('Error al crear categoría: ' + error.message); return; }
    commit([...cats, name].sort((a,b) => a.localeCompare(b,'es')));
    setNewName('');
    window.logActivity?.({ modulo:'inventario', accion:'crear', entidad_id:id, entidad_label:'Categoría: '+name });
  }

  async function handleRename() {
    const name = editing.value.trim();
    if (!name) { setEditing(null); return; }
    const old = editing.cat;
    if (name !== old) {
      // Rename in categorias table (buscar por nombre+empresa)
      const { data: existing } = await window.sb.from('categorias')
        .select('id').eq('nombre', old).eq('empresa_id', empresa()).maybeSingle();
      if (existing) {
        await window.sb.from('categorias').update({ nombre: name }).eq('id', existing.id);
      } else {
        // era una cat derivada de producto, crearla standalone con el nuevo nombre
        await window.sb.from('categorias')
          .insert([{ id: 'cat-' + Date.now(), nombre: name, empresa_id: empresa() }]);
      }
      // Actualizar productos en DB
      await window.sb.from('productos').update({ categoria: name }).eq('categoria', old).overlaps('empresas', [empresa()]);
      SSData.productos.forEach(p => { if (p.categoria === old) p.categoria = name; });
      window.logActivity?.({ modulo:'inventario', accion:'editar', entidad_label:'Categoría: '+old+' → '+name });
    }
    commit(cats.map(c => c === old ? name : c).sort((a,b) => a.localeCompare(b,'es')));
    setEditing(null);
  }

  async function handleDelete(cat) {
    // Borrar de tabla categorias si existe standalone
    const { error: errCat } = await window.sb.from('categorias').delete().eq('nombre', cat).eq('empresa_id', empresa());
    if (errCat) { alert('Error al eliminar categoría: ' + errCat.message); return; }
    // Limpiar categoria en productos
    const { error: errProd } = await window.sb.from('productos').update({ categoria: null }).eq('categoria', cat).overlaps('empresas', [empresa()]);
    if (errProd) { alert('Error al limpiar categoría de productos: ' + errProd.message); return; }
    SSData.productos.forEach(p => { if (p.categoria === cat) p.categoria = null; });
    commit(cats.filter(c => c !== cat));
    setDeleteConfirm(null);
    window.logActivity?.({ modulo:'inventario', accion:'eliminar', entidad_label:'Categoría: '+cat });
  }

  const filtered = cats.filter(c => !search || c.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width:560, maxHeight:'85vh', display:'flex', flexDirection:'column' }}>
        <div className="modal-header">
          <div style={{ width:40, height:40, borderRadius:10, background:'var(--brand-soft)', color:'var(--brand)', display:'grid', placeItems:'center', flexShrink:0 }}>
            <Icon name="inventory" size={20}/>
          </div>
          <div style={{ flex:1 }}>
            <h3 className="modal-title">Categorías de productos</h3>
            <div className="small">{cats.length} categorías registradas</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        <div className="modal-body" style={{ flex:1, overflowY:'auto' }}>
          {/* Add new */}
          <div style={{ display:'flex', gap:8, marginBottom:16 }}>
            <input
              className="input"
              style={{ flex:1 }}
              placeholder="Nombre de nueva categoría…"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
            <button
              className="btn primary"
              disabled={!newName.trim() || cats.includes(newName.trim())}
              onClick={handleAdd}
            >
              <Icon name="plus" size={14}/>Agregar
            </button>
          </div>

          {/* Search - only show if many categories */}
          {cats.length > 8 && (
            <input
              className="input search"
              style={{ width:'100%', marginBottom:12 }}
              placeholder="Buscar categoría…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          )}

          {/* List */}
          <div style={{ border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
            {filtered.length === 0 && (
              <div className="empty" style={{ padding:'24px 0' }}>Sin categorías</div>
            )}
            {filtered.map((cat, i) => {
              const count = productCount(cat);
              const isEditing = editing?.cat === cat;
              return (
                <div
                  key={cat + '-' + i}
                  style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none', background: isEditing ? 'var(--brand-soft)' : 'var(--bg-elev)', transition:'background .1s' }}
                >
                  {isEditing ? (
                    <>
                      <input
                        className="input"
                        style={{ flex:1, height:32, padding:'0 10px' }}
                        value={editing.value}
                        onChange={e => setEditing({ ...editing, value: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setEditing(null); }}
                        autoFocus
                      />
                      <button className="btn primary sm" onClick={handleRename} disabled={!editing.value.trim()}>
                        <Icon name="check" size={13}/>Guardar
                      </button>
                      <button className="btn ghost sm" onClick={() => setEditing(null)}>Cancelar</button>
                    </>
                  ) : (
                    <>
                      <span style={{ flex:1, fontSize:13.5, fontWeight:500 }}>{cat}</span>
                      <span className="chip neutral" style={{ fontSize:11 }}>
                        {count} producto{count !== 1 ? 's' : ''}
                      </span>
                      <button className="icon-btn" onClick={() => setEditing({ cat, value: cat })} title="Renombrar">
                        <Icon name="edit" size={14}/>
                      </button>
                      <button
                        className="icon-btn"
                        style={{ color:'var(--danger)' }}
                        onClick={() => setDeleteConfirm(cat)}
                        title="Eliminar"
                      >
                        <Icon name="trash" size={14}/>
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>

      {/* Delete confirm — nested overlay with stopPropagation */}
      {deleteConfirm && (
        <div className="modal-overlay" style={{ zIndex:1010 }} onClick={e => { e.stopPropagation(); setDeleteConfirm(null); }}>
          <div className="modal" style={{ maxWidth:420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin:0 }}>¿Eliminar categoría?</h3>
              <button className="icon-btn" onClick={() => setDeleteConfirm(null)}><Icon name="x" size={16}/></button>
            </div>
            <div style={{ padding:'16px 24px', fontSize:13.5, color:'var(--text-muted)', lineHeight:1.6 }}>
              Se eliminará <strong style={{ color:'var(--text)' }}>{deleteConfirm}</strong>.
              {productCount(deleteConfirm) > 0 && (
                <div style={{ marginTop:8, padding:'8px 12px', background:'var(--warn-soft)', borderRadius:6, color:'var(--warn)', fontSize:12.5 }}>
                  ⚠ {productCount(deleteConfirm)} producto{productCount(deleteConfirm) !== 1 ? 's' : ''} tiene{productCount(deleteConfirm) !== 1 ? 'n' : ''} esta categoría asignada y quedarán sin categoría.
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn secondary" onClick={() => setDeleteConfirm(null)}>Cancelar</button>
              <button className="btn ghost" style={{ color:'var(--danger)' }} onClick={() => handleDelete(deleteConfirm)}>
                <Icon name="trash" size={14}/>Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SerializadoToggle({ serializado, saving, onToggle }) {
  return (
    <div style={{display:'flex', alignItems:'center', gap:10, cursor: saving ? 'wait' : 'pointer', userSelect:'none', opacity: saving ? 0.7 : 1}}
      onClick={saving ? undefined : onToggle}>
      <div style={{width:36, height:20, borderRadius:10, background: serializado ? 'var(--brand)' : 'var(--border)', position:'relative', transition:'background .2s', flexShrink:0}}>
        <div style={{width:16, height:16, borderRadius:'50%', background:'#fff', position:'absolute', top:2, left: serializado ? 18 : 2, transition:'left .2s'}}/>
      </div>
      <div>
        <div style={{fontWeight:500, fontSize:13}}>Requiere número de serie</div>
        <div style={{fontSize:11, color:'var(--text-muted)'}}>
          {serializado
            ? 'Activo — S/N se registra en entradas y despachos'
            : 'Inactivo — actívalo para equipos con S/N (cámaras, UPS, routers, etc.)'}
        </div>
      </div>
      {saving && <span style={{marginLeft:'auto', fontSize:11, color:'var(--text-muted)'}}>Guardando…</span>}
    </div>
  );
}

// ======= Modal de detalle de producto =======
function ProductDetailModal({ producto, onClose, onUpdate, onTransfer }) {
  // M-02: si viene con flag _autoOpenSeriales (desde CmdK /sn), abrir Seriales de una
  const [showSeriales, setShowSeriales] = useState(!!producto._autoOpenSeriales);
  const [showAjuste, setShowAjuste]     = useState(false);
  const [showEditSku, setShowEditSku]   = useState(false);
  const [tab, setTab] = useState('general');
  const [isEditing, setIsEditing] = useState(false);

  // Historial de ventas REAL del producto (RPC get_ventas_producto_detalle — TODO el histórico,
  // no acotado a 90 días). Se carga al montar el modal, igual que kardexProd para "Movimientos".
  const [ventas,        setVentas]        = useState([]);
  const [ventasLoading, setVentasLoading] = useState(true);
  const [ventasGroupBy, setVentasGroupBy] = useState('');   // '' | cliente | mes
  const [ventasPage,    setVentasPage]    = useState(1);
  const ventasPageSize = 50;
  useEffect(() => {
    let alive = true;
    setVentasLoading(true);
    window.getVentasProducto(producto.sku).then(rows => {
      if (!alive) return;
      setVentas(rows);
      setVentasLoading(false);
    });
    return () => { alive = false; };
  }, [producto.sku]);
  useEffect(() => { setVentasPage(1); }, [ventasGroupBy]);

  // Las columnas que solo se ven en la FICHA (garantía, peso, dueño) se piden para este producto al
  // abrirlo: son 27 columnas por 1 sku, no por 6.593. Las imágenes y etiquetas ya vinieron con la
  // página de la lista, pero se piden igual por si se llegó acá desde otro lado (Ctrl+K, un serial).
  useEffect(() => {
    window.ensureProductosCampos?.([producto.sku],
      ['garantia_condiciones', 'peso', 'empresa_id', 'imagenes', 'shopify_images', 'etiquetas', 'creado_por']);
  }, [producto.sku]);

  // serializado is handled independently — immediate save on toggle
  const [localSerializado, setLocalSerializado] = useState(!!producto.serializado);
  const [savingSerial, setSavingSerial]         = useState(false);

  async function toggleSerializado() {
    const next = !localSerializado;
    setLocalSerializado(next);
    setSavingSerial(true);
    const { error } = await window.sb.from('productos')
      .update({ serializado: next })
      .eq('sku', producto.sku)
      .overlaps('empresas', [window.currentEmpresa || 'demo1']);
    setSavingSerial(false);
    if (error) { setLocalSerializado(!next); alert('Error: ' + error.message); return; }
    const prod = SSData.productos.find(p => p.sku === producto.sku);
    if (prod) prod.serializado = next;
    window.logActivity?.({ modulo:'inventario', accion:'editar', entidad_id:producto.sku, entidad_label:producto.nombre, detalles:{ serializado:next } });
    onUpdate?.({ ...producto, serializado: next });
  }

  const [editForm, setEditForm] = useState({
    nombre: producto.nombre,
    marca: producto.marca,
    categoria: producto.categoria,
    costo: producto.costo,
    base: producto.base,
    peso: producto.peso || '',
    minimo: producto.minimo ?? 0,
    unidad: producto.unidad || 'Unidad',
    iva: producto.iva || '16% general',
    etiquetas: producto.etiquetas || [],
    garantia_meses: producto.garantia_meses ?? 12,
    garantia_condiciones: producto.garantia_condiciones || '',
    // Empresas que ven el producto (puede estar compartido: en Odoo las dos lo veían).
    empresas: Array.isArray(producto.empresas) && producto.empresas.length
      ? producto.empresas
      : [producto.empresa_id || window.currentEmpresa || 'demo1'],
  });
  const [tagInput, setTagInput] = useState('');
  const [tagCatalog, setTagCatalog] = useState([]);
  useEffect(() => { if (isEditing) window.loadEtiquetas?.().then(list => setTagCatalog(list || [])); }, [isEditing]);

  const [priceEdits,  setPriceEdits]  = useState({});  // { listaId: string }
  const [savingRow,   setSavingRow]   = useState(null); // listaId guardando
  const [savedRow,    setSavedRow]    = useState(null); // listaId recién guardado
  const [savingEdit,  setSavingEdit]  = useState(false);
  const [saveEditErr, setSaveEditErr] = useState('');

  async function handleSaveOnePrice(listaId, rawVal) {
    const lp = SSData.listasPrecios.find(l => l.id === listaId);
    if (!lp) return;
    const updated = { ...(lp.preciosManuales || {}) };
    const num = rawVal === '' || rawVal == null ? null : parseFloat(rawVal);
    if (num === null || isNaN(num)) {
      delete updated[producto.sku];
    } else {
      updated[producto.sku] = num;
    }
    setSavingRow(listaId);
    try {
      await window.saveListaDetalle(listaId, updated);
      lp.preciosManuales = updated;
      setPriceEdits(prev => { const n = {...prev}; delete n[listaId]; return n; });
      setSavedRow(listaId);
      setTimeout(() => setSavedRow(r => r === listaId ? null : r), 1800);
      window.logActivity?.({ modulo:'inventario', accion:'precio_actualizado',
        entidad_id: producto.sku, entidad_label: producto.nombre,
        detalles:{ lista_id: listaId, lista_nombre: lp.nombre, sku: producto.sku, precio: num } });
    } finally {
      setSavingRow(null);
    }
  }
  const [photoPreview, setPhotoPreview] = useState(() => getProductPhoto(producto.sku));
  const [photoData, setPhotoData] = useState(undefined); // undefined = no change, null = remove, string = new photo
  const [showMarcasMgr, setShowMarcasMgr] = useState(false);
  const fileRef = useRef(null);

  const stocks = getAlmacenes().map(a => ({ a, ...safeInv(producto.sku, a.id) }));
  const totalStock = stocks.reduce((s,x)=>s+x.cantidad,0);
  const totalReservado = stocks.reduce((s,x)=>s+x.reservado,0);
  const dispProducto = window.getDisponible(producto.sku).disponible;
  const valorizado = totalStock * producto.costo;
  const margen = ((producto.base - producto.costo) / producto.base * 100).toFixed(1);

  // Trazabilidad: proveedores desde órdenes de compra. Se preguntan las líneas de ESTE sku
  // (`comprasDeProducto`) en vez de filtrar todas las OCs en memoria — el arranque dejó de bajarlas.
  const [comprasSku, setComprasSku] = useState([]);
  useEffect(() => {
    let vivo = true;
    setComprasSku([]);
    window.comprasDeProducto?.(producto.sku).then(r => { if (vivo) setComprasSku(r || []); }).catch(() => {});
    return () => { vivo = false; };
  }, [producto.sku]);
  const proveedorTraza = useMemo(() => {
    const byProv = {};
    comprasSku.forEach(c => {
      if (!byProv[c.proveedor_id]) byProv[c.proveedor_id] = { ocs: [], totalUnidades: 0 };
      byProv[c.proveedor_id].ocs.push({ fecha: c.fecha, precio: c.precio, ocId: c.ocId, estado: c.estado });
      byProv[c.proveedor_id].totalUnidades += c.cantidad;
    });
    return Object.entries(byProv).map(([provId, d]) => {
      const prov = (SSData.proveedores || []).find(p => p.id === provId);
      const sorted = [...d.ocs].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
      return { provId, nombre: prov?.nombre || provId, rif: prov?.rif, totalOcs: d.ocs.length, totalUnidades: d.totalUnidades, ultimaOc: sorted[0] };
    }).sort((a, b) => (b.ultimaOc?.fecha || '').localeCompare(a.ultimaOc?.fecha || ''));
  }, [comprasSku]);

  function upd(k, v) { setEditForm(f => ({...f, [k]: v})); }

  function handlePhoto(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => { setPhotoPreview(ev.target.result); setPhotoData(ev.target.result); };
    reader.readAsDataURL(f);
  }

  async function handleSave() {
    setSavingEdit(true);
    setSaveEditErr('');
    const prod = SSData.productos.find(p => p.sku === producto.sku);
    const before = prod ? { nombre:prod.nombre, marca:prod.marca, categoria:prod.categoria, costo:prod.costo, base:prod.base } : null;
    // `|| fallback` trata un 0 tipeado a propósito como "vacío" y lo pisa con el valor viejo —
    // Number.isFinite no tiene ese problema (costo/precio en 0 es válido: producto de cortesía, etc).
    const newCosto = Number.isFinite(parseFloat(editForm.costo)) ? parseFloat(editForm.costo) : (prod?.costo ?? 0);
    const newBase  = Number.isFinite(parseFloat(editForm.base))  ? parseFloat(editForm.base)  : (prod?.base  ?? 0);
    const newPeso  = editForm.peso ? parseFloat(editForm.peso) : (prod?.peso ?? null);
    const newMinimo = Math.max(0, parseInt(editForm.minimo) || 0);

    // La empresa activa nunca se quita de la lista: el producto no puede desaparecer de la pantalla
    // en la que se está editando.
    const empActual = window.currentEmpresa || 'demo1';
    const newEmpresas = [...new Set([empActual, ...(editForm.empresas || [])])];

    const { error: dbErr } = await window.sb.from('productos').update({
      nombre:                editForm.nombre,
      marca:                 editForm.marca    || null,
      categoria:             editForm.categoria || null,
      costo:                 newCosto,
      base:                  newBase,
      peso:                  newPeso,
      minimo:                newMinimo,
      empresas:              newEmpresas,
      garantia_meses:        localSerializado ? (parseInt(editForm.garantia_meses) || 0) : null,
      garantia_condiciones:  localSerializado ? (editForm.garantia_condiciones || null) : null,
    }).eq('sku', producto.sku).overlaps('empresas', [empActual]);

    if (dbErr) {
      setSaveEditErr('Error al guardar: ' + dbErr.message);
      setSavingEdit(false);
      return;
    }

    // Solo actualizamos SSData y UI después de confirmar el DB
    if (prod) {
      prod.nombre    = editForm.nombre;
      prod.marca     = editForm.marca;
      prod.categoria = editForm.categoria;
      prod.costo     = newCosto;
      prod.base      = newBase;
      prod.peso      = newPeso;
      prod.minimo    = newMinimo;
      prod.unidad    = editForm.unidad;
      prod.iva       = editForm.iva;
      prod.etiquetas = editForm.etiquetas || [];
    }
    window.actualizarEtiquetasProducto?.(producto.sku, editForm.etiquetas || []);
    if (photoData !== undefined) saveProductPhoto(producto.sku, photoData);
    const updated = { ...producto, ...editForm, costo: newCosto, base: newBase, serializado: localSerializado };
    onUpdate?.(updated);
    setSavingEdit(false);
    setIsEditing(false);
    window.logActivity?.({
      modulo:'inventario', accion:'editar',
      entidad_id: producto.sku, entidad_label: editForm.nombre,
      detalles:{ before, after: { nombre:editForm.nombre, marca:editForm.marca, categoria:editForm.categoria, costo:newCosto, base:newBase } }
    });
  }

  const editMargen = editForm.costo && editForm.base
    ? (((editForm.base - editForm.costo) / editForm.base) * 100).toFixed(1)
    : '—';

  // Movimientos REALES del producto. Fuente principal = tabla movimientos_inventario (kardex
  // histórico migrado, la MISMA que usa la página de Movimientos) para TODOS los movimientos del
  // SKU, no solo los documentos recientes en memoria. Se complementa con actividad_log para los
  // movimientos generados por la app tras la migración (transferencias/ajustes/importaciones).
  const [movsExtra, setMovsExtra] = useState([]);
  const [kardexProd, setKardexProd] = useState(null);   // null = cargando
  const [proveedorFilter, setProveedorFilter] = useState('');
  const [movGroupBy, setMovGroupBy] = useState('');   // '' | cliente | almacen | tipo | mes
  // Mapa ref_documento (despacho/factura/orden) → cliente_id, resuelto contra `documentos`.
  // Permite mostrar a qué cliente pertenece cada salida en el Kardex.
  const [clienteByDoc, setClienteByDoc] = useState({});
  // Cuántos movimientos del kardex se traen. Un sku con años de historia tiene 1.737 (783 kB en dos
  // viajes) y la ficha muestra los últimos: se piden 200 y hay un botón para traer el resto. Además
  // acota las tandas que resuelven el cliente de cada documento (eran 9, ahora 1).
  const KARDEX_PAGINA = 200;
  const [kardexTodo, setKardexTodo] = useState(false);
  const [kardexHayMas, setKardexHayMas] = useState(false);
  useEffect(() => {
    let alive = true;
    const e = window.currentEmpresa || 'demo1';
    setKardexProd(null);
    setClienteByDoc({});
    (async () => {
      const [log, kx] = await Promise.all([
        window.fetchActivityLog?.({ modulo: 'inventario', entidad_id: producto.sku, limit: 200 }) || [],
        kardexTodo
          ? window.fetchAll(() => window.sb.from('movimientos_inventario')
              .select('*').eq('empresa_id', e).eq('sku', producto.sku)
              .order('fecha', { ascending: false }))
          : window.sb.from('movimientos_inventario')
              .select('*').eq('empresa_id', e).eq('sku', producto.sku)
              .order('fecha', { ascending: false }).limit(KARDEX_PAGINA + 1),
      ]);
      if (!alive) return;
      let kardex = (kx && kx.data) || [];
      // Se pide uno más que la página para saber si hay más sin necesidad de un count aparte.
      if (!kardexTodo && kardex.length > KARDEX_PAGINA) { kardex = kardex.slice(0, KARDEX_PAGINA); setKardexHayMas(true); }
      else setKardexHayMas(false);
      setMovsExtra(log);
      setKardexProd(kardex);
      // Resolver el cliente de los movimientos ligados a un documento de venta.
      const docIds = [...new Set(kardex
        .filter(m => ['despacho', 'factura', 'orden'].includes(m.ref_tipo) && m.ref_documento)
        .map(m => m.ref_documento))];
      if (docIds.length) {
        const map = {};
        for (let i = 0; i < docIds.length; i += 200) {
          const chunk = docIds.slice(i, i + 200);
          const { data } = await window.sb.from('documentos').select('id, cliente_id').in('id', chunk);
          (data || []).forEach(d => { if (d.cliente_id) map[d.id] = d.cliente_id; });
        }
        if (alive) setClienteByDoc(map);
      }
    })();
    return () => { alive = false; };
  }, [producto.sku, kardexTodo]);

  const movimientos = useMemo(() => {
    const arr = [];
    const almById = (id) => (SSData.almacenes || []).find(a => a.id === id);

    // 1) Kardex (tabla movimientos_inventario) — fuente histórica principal, TODOS los movimientos
    //    del SKU (ventas, recepciones, devoluciones, traslados, ajustes migrados). Mismo criterio
    //    que la página de Movimientos: cada movimiento físico modelado una sola vez.
    for (const m of (kardexProd || [])) {
      const t = m.tipo; let tipo, signo;
      if      (t === 'salida')          { tipo = 'salida';        signo = -1; }
      else if (t === 'entrada')         { tipo = 'entrada';       signo =  1; }
      else if (t === 'devolucion')      { tipo = 'entrada';       signo =  1; }
      else if (t === 'transferencia')   { tipo = 'transferencia'; signo =  1; }
      else if (t === 'ajuste_positivo') { tipo = 'ajuste';        signo =  1; }
      else if (t === 'ajuste_negativo') { tipo = 'ajuste';        signo = -1; }
      else                              { tipo = 'ajuste';        signo =  1; }
      const almo = almById(m.almacen_origen), almd = almById(m.almacen_destino);
      const cid = clienteByDoc[m.ref_documento] || null;
      const cli = cid ? (SSData.clientes || []).find(c => c.id === cid) : null;
      arr.push({
        id:        'MI-' + m.id,
        fecha:     (m.fecha || '').slice(0, 10),
        tipo,
        cantidad:  signo * Math.abs(Number(m.cantidad) || 0),
        motivo:    (m.ref_tipo ? m.ref_tipo.toUpperCase() + ' · ' : '') + (m.ref_documento || m.motivo || '—'),
        almacen:   (tipo === 'transferencia' && almo && almd) ? { nombre: almo.nombre + ' → ' + almd.nombre } : (almo || almd || null),
        usuario:   { nombre: m.usuario || '—' },
        proveedor: null, proveedor_id: null,
        cliente:   cli ? cli.nombre : (cid || null),
      });
    }

    // 3) Actividad log (transferencias, importaciones y ajustes sobre este SKU)
    for (const ev of (movsExtra || [])) {
      const det = ev.detalles || {};
      const isImport = det.origen === 'importacion' || det.almacen_origen === 'IMPORT';
      const isSaldoIni = det.origen === 'saldo_inicial' || ev.accion === 'saldo_inicial';
      const isAjusteEntrada = det.origen === 'ajuste_manual';
      const isAjusteSalida  = det.destino === 'ajuste_manual';
      const isAjuste = isAjusteEntrada || isAjusteSalida;
      const rawQty = Number(det.cantidad) || 0;
      let tipo, motivo, cantidad;
      if (isSaldoIni) {
        tipo = 'entrada';
        cantidad = Math.abs(rawQty);
        motivo = `Saldo inicial → ${almById(det.almacen_destino)?.nombre || det.almacen_destino || '—'}`;
      } else if (isImport) {
        tipo = 'entrada';
        cantidad = Math.abs(rawQty);
        motivo = `Importación masiva → ${det.almacen_destino || '—'}${det.import_batch_id ? ' · ' + det.import_batch_id : ''}`;
      } else if (isAjuste) {
        tipo = isAjusteEntrada ? 'entrada' : 'salida';
        cantidad = isAjusteEntrada ? Math.abs(rawQty) : -Math.abs(rawQty);
        motivo = `Ajuste manual · ${det.motivo_label || det.motivo || '—'}${det.notas ? ' · ' + det.notas : ''}`;
      } else if (det.origen === 'orden_compra') {
        tipo = 'entrada';
        cantidad = Math.abs(rawQty);
        motivo = `Recepción OC ${det.ref || '—'} → ${det.almacen_destino || '—'}`;
      } else if (ev.accion === 'transferencia') {
        tipo = 'transferencia';
        cantidad = rawQty;
        motivo = `${det.almacen_origen || '—'} → ${det.almacen_destino || '—'}${det.empresa_origen && det.empresa_destino && det.empresa_origen !== det.empresa_destino ? ` (${det.empresa_origen} → ${det.empresa_destino})` : ''}`;
      } else {
        tipo = 'ajuste';
        cantidad = rawQty;
        motivo = det.notas || ev.accion || 'Ajuste';
      }
      arr.push({
        id:           ev.id || ev.created_at,
        fecha:        ev.created_at ? window.localDateStr(new Date(ev.created_at)) : '',
        tipo,
        cantidad,
        motivo,
        almacen:      almById(det.almacen_destino_id) || (det.almacen_destino ? { nombre: det.almacen_destino } : null),
        usuario:      { nombre: ev.usuario_nombre || '—' },
        proveedor_id: det.proveedor_id || null,
        proveedor:    det.proveedor || null,
        cliente:      det.cliente_nombre || det.cliente || null,
      });
    }

    return arr.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  }, [producto.sku, movsExtra, kardexProd, clienteByDoc]);

  const headerPhoto = isEditing ? photoPreview : getProductPhoto(producto.sku);
  const allImages = useMemo(() => getProductImages(producto), [producto, photoData]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width: 1000, maxHeight: '90vh', display:'flex', flexDirection:'column'}}>
        <div className="modal-header">
          <div style={{width: 56, height: 56, borderRadius: 10, background: 'var(--bg-sunken)', display:'grid', placeItems:'center', color:'var(--text-muted)', fontSize: 11, textAlign:'center', lineHeight: 1.2, padding: 4, flexShrink: 0, overflow:'hidden'}}>
            {headerPhoto
              ? <img src={headerPhoto} style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:10}}/>
              : <>{producto.marca}<br/>{producto.categoria}</>
            }
          </div>
          <div style={{flex: 1, minWidth: 0}}>
            {/* SKU y título con botón de copiar: son los dos datos que se pegan todo el tiempo en
                un chat, un correo o el buscador del proveedor. Aparece al pasar el mouse. */}
            <div className="mono small copy-host">
              {producto.sku}<window.CopyBtn text={producto.sku} title="Copiar SKU" />
              {/* Permiso especial y aparte: editar el SKU (la PK del catálogo) solo es seguro si
                  el producto nunca se vendió ni tuvo movimiento de inventario — se revalida en el
                  servidor al guardar, esto solo decide si se ofrece el botón. */}
              {(window.canUser ? window.canUser('editar', 'producto_sku') : false) && (
                <button type="button" className="icon-btn" style={{ width: 18, height: 18, padding: 0, marginLeft: 2 }}
                        title="Editar SKU" onClick={() => setShowEditSku(true)}>
                  <Icon name="edit" size={11} />
                </button>
              )}
            </div>
            <h3 className="modal-title copy-host" style={{marginTop: 2}}>
              {producto.nombre}<window.CopyBtn text={producto.nombre} title="Copiar el nombre del producto" size={13} />
            </h3>
            <div className="flex gap-2 mt-2">
              <span className="chip neutral">{producto.marca}</span>
              <span className="chip blue">{producto.categoria}</span>
              {(Number(producto.minimo) || 0) > 0 && dispProducto <= (Number(producto.minimo) || 0) && totalStock > 0 && <span className="chip amber">Bajo stock</span>}
              {totalStock === 0 && <span className="chip red">Agotado</span>}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        {!isEditing && (
        <div style={{padding: '0 20px', borderBottom:'1px solid var(--border)'}}>
          <div className="seg" style={{border:'none'}}>
            {[{id:'general',l:'General'},{id:'stock',l:'Stock por almacén'},{id:'movs',l:'Movimientos'},{id:'precios',l:'Precios'},{id:'ventas',l:'Ventas'}].map(t => (
              <button key={t.id} className={tab===t.id?'on':''} onClick={()=>setTab(t.id)}>{t.l}</button>
            ))}
          </div>
        </div>
        )}

        <div className="modal-body" style={{flex: 1, overflowY:'auto'}}>

          {/* ── Edit mode ── */}
          {isEditing && (
            <div>
              <div style={{display:'flex', gap:24, alignItems:'flex-start', marginBottom:20}}>
                {/* Photo upload */}
                <div style={{flexShrink:0}}>
                  <div className="form-label" style={{marginBottom:6}}>Foto del producto</div>
                  <div
                    style={{width:120,height:120,borderRadius:12,border:'2px dashed var(--border)',display:'grid',placeItems:'center',cursor:'pointer',overflow:'hidden',background:'var(--bg-sunken)',position:'relative'}}
                    onClick={()=>fileRef.current?.click()}
                    title="Haz clic para subir foto"
                  >
                    {photoPreview
                      ? <img src={photoPreview} style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                      : <div style={{textAlign:'center',color:'var(--text-muted)'}}>
                          <Icon name="upload" size={28}/>
                          <div style={{fontSize:11,marginTop:4}}>Subir foto</div>
                        </div>
                    }
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={handlePhoto}/>
                  {photoPreview && (
                    <button className="btn ghost sm" style={{marginTop:6,width:120,color:'var(--danger)',fontSize:11}} onClick={()=>{setPhotoPreview(null);setPhotoData(null);}}>
                      Quitar foto
                    </button>
                  )}
                </div>

                {/* Fields */}
                <div style={{flex:1,minWidth:0}}>
                  <div className="form-section-title" style={{marginTop:0}}>Información básica</div>
                  <div className="mt-2">
                    <label className="form-label">Nombre del producto</label>
                    <input className="input" value={editForm.nombre} onChange={e=>upd('nombre',e.target.value)}/>
                  </div>
                  <div className="grid-2 mt-3">
                    <div>
                      <label className="form-label" style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                        <span>Marca</span>
                        <button type="button" onClick={()=>setShowMarcasMgr(true)} className="btn ghost" style={{padding:'2px 8px', fontSize:11, height:'auto'}}>
                          <Icon name="settings" size={11}/> Administrar
                        </button>
                      </label>
                      <select className="select" value={editForm.marca} onChange={e=>upd('marca',e.target.value)}>
                        {SSData.marcas.map(m=><option key={m}>{m}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Categoría</label>
                      <select className="select" value={editForm.categoria} onChange={e=>upd('categoria',e.target.value)}>
                        {getCategorias().map(c=><option key={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="form-section-title">Precios y costos</div>
              <div className="grid-3 mt-2">
                <div>
                  <label className="form-label">Costo USD</label>
                  <input className="input" type="number" step="0.01" value={editForm.costo} onChange={e=>upd('costo',e.target.value)}/>
                </div>
                <div>
                  <label className="form-label">Precio base USD</label>
                  <input className="input" type="number" step="0.01" value={editForm.base} onChange={e=>upd('base',e.target.value)}/>
                </div>
                <div>
                  <label className="form-label">Margen calculado</label>
                  <div className="input" style={{background:'var(--bg-sunken)',display:'flex',alignItems:'center',fontWeight:600,color:editMargen==='—'?'var(--text-muted)':editMargen>20?'var(--success)':editMargen>10?'var(--warn)':'var(--danger)'}}>
                    {editMargen}{editMargen!=='—'&&'%'}
                  </div>
                </div>
              </div>

              <div className="form-section-title mt-4">Características</div>
              <div className="grid-3 mt-2">
                <div>
                  <label className="form-label">Peso (kg)</label>
                  <input className="input" type="number" step="0.01" value={editForm.peso} onChange={e=>upd('peso',e.target.value)}/>
                </div>
                <div>
                  <label className="form-label">Stock mínimo <span className="muted small" title="Dispara la alerta de bajo stock cuando el disponible cae a este nivel o menos. 0 = sin alerta.">(alerta)</span></label>
                  <input className="input" type="number" min="0" step="1" value={editForm.minimo} onChange={e=>upd('minimo',e.target.value)} placeholder="0"/>
                </div>
                <div>
                  <label className="form-label">Unidad</label>
                  <select className="select" value={editForm.unidad} onChange={e=>upd('unidad',e.target.value)}>
                    <option>Unidad</option><option>Caja</option><option>Metro</option><option>Rollo</option><option>Paquete</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">IVA</label>
                  <select className="select" value={editForm.iva} onChange={e=>upd('iva',e.target.value)}>
                    <option>16% general</option><option>8% reducido</option><option>Exento</option>
                  </select>
                </div>
              </div>

              <SerializadoToggle serializado={localSerializado} saving={savingSerial} onToggle={toggleSerializado}/>

              {localSerializado && (
                <div style={{marginTop:12, padding:'12px 14px', background:'var(--bg-sunken)', borderRadius:8, border:'1px solid var(--border)'}}>
                  <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10}}>
                    <div className="small" style={{fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', color:'var(--text-muted)'}}>
                      <Icon name="check" size={12}/> Garantía y números de serie
                    </div>
                    <button type="button" className="btn secondary sm" onClick={() => setShowSeriales(true)}>
                      <Icon name="check" size={13}/> Gestionar S/N
                    </button>
                  </div>
                  <div style={{display:'flex', gap:12, alignItems:'flex-start', flexWrap:'wrap'}}>
                    <div>
                      <label className="form-label">Meses de garantía</label>
                      {(() => {
                        const PRESETS = ['0','3','6','12','24'];
                        const val = String(editForm.garantia_meses ?? 12);
                        const isCustom = !PRESETS.includes(val);
                        return <div style={{display:'flex', gap:6, alignItems:'center'}}>
                          <select className="select" style={{width:130}}
                            value={isCustom ? '__custom__' : val}
                            onChange={e => upd('garantia_meses', e.target.value === '__custom__' ? '' : e.target.value)}>
                            <option value="0">Sin garantía</option>
                            <option value="3">3 meses</option>
                            <option value="6">6 meses</option>
                            <option value="12">12 meses</option>
                            <option value="24">24 meses</option>
                            <option value="__custom__">Otro...</option>
                          </select>
                          {isCustom && <input className="input mono" type="number" min="0" style={{width:70}}
                            autoFocus value={editForm.garantia_meses}
                            onChange={e=>upd('garantia_meses', e.target.value)} placeholder="meses"/>}
                        </div>;
                      })()}
                    </div>
                    <div style={{flex:1, minWidth:220}}>
                      <label className="form-label">Condiciones de garantía</label>
                      <textarea className="input" rows={3} style={{width:'100%', fontSize:12.5, resize:'vertical'}}
                        placeholder="Ej: Garantía cubre defectos de fábrica. Excluye daños por mal uso, humedad o golpes."
                        value={editForm.garantia_condiciones}
                        onChange={e=>upd('garantia_condiciones', e.target.value)}/>
                    </div>
                  </div>
                </div>
              )}

              <div style={{marginTop:14}}>
                <EmpresasProductoPicker value={editForm.empresas} onChange={v => upd('empresas', v)} disabled={savingEdit}/>
              </div>

              <div style={{marginTop:14}}>
                <label className="form-label">Etiquetas</label>
                <div style={{padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, background:'var(--bg-input, var(--bg))', display:'flex', flexWrap:'wrap', gap:6, alignItems:'center', minHeight:36}}>
                  {(editForm.etiquetas || []).map(t => {
                    const def = tagCatalog.find(e => e.nombre === t);
                    const color = def?.color || '#6b7280';
                    return (
                      <span key={t} style={{padding:'3px 8px', borderRadius:5, background: color+'22', color, fontWeight:500, fontSize:12, display:'inline-flex', alignItems:'center', gap:4}}>
                        {t}
                        <button onClick={() => upd('etiquetas', editForm.etiquetas.filter(x => x !== t))}
                          style={{background:'none', border:'none', cursor:'pointer', padding:0, color, lineHeight:1, fontSize:14}}>×</button>
                      </span>
                    );
                  })}
                  <input
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => {
                      if ((e.key === 'Enter' || e.key === ',' || e.key === '/') && tagInput.trim()) {
                        e.preventDefault();
                        const t = tagInput.trim();
                        if (!editForm.etiquetas.includes(t)) upd('etiquetas', [...(editForm.etiquetas || []), t]);
                        setTagInput('');
                      }
                      if (e.key === 'Backspace' && !tagInput && editForm.etiquetas.length > 0) {
                        upd('etiquetas', editForm.etiquetas.slice(0, -1));
                      }
                    }}
                    placeholder={(editForm.etiquetas || []).length === 0 ? 'Escribe una etiqueta y presiona Enter' : ''}
                    style={{border:'none', outline:'none', background:'transparent', flex:1, minWidth:120, fontSize:12.5, padding:'2px 0'}}
                  />
                </div>
                {tagCatalog.length > 0 && (
                  <div style={{marginTop:6, display:'flex', flexWrap:'wrap', gap:4}}>
                    <span className="small muted" style={{marginRight:4}}>Sugerencias:</span>
                    {tagCatalog.filter(t => !(editForm.etiquetas || []).includes(t.nombre)).slice(0, 12).map(t => (
                      <button key={t.id} type="button"
                        onClick={() => upd('etiquetas', [...(editForm.etiquetas || []), t.nombre])}
                        style={{padding:'2px 8px', fontSize:11, borderRadius:4, background: t.color + '15', color: t.color, border: '1px solid ' + t.color + '40', cursor:'pointer'}}>
                        + {t.nombre}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {!isEditing && tab === 'general' && (
            <div>
              {allImages.length > 0 && <ImageCarousel images={allImages} />}
              <div className="grid-2">
                <div className="stat">
                  <div className="stat-label">Stock total</div>
                  <div className="stat-val" style={{fontSize: 22}}>{totalStock} <span className="small" style={{fontWeight:400}}>unidades</span></div>
                  <div className="small mt-2">Disponible {totalStock - totalReservado} · Reservado {totalReservado}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Valorizado (costo)</div>
                  <div className="stat-val" style={{fontSize: 22}}>{fmt.usd(valorizado)}</div>
                  <div className="small mt-2">Margen {margen}%</div>
                </div>
              </div>
              <div className="card mt-4" style={{padding: 16}}>
                <div className="card-title" style={{marginBottom: 10}}>Ficha técnica</div>
                <div className="grid-3" style={{fontSize: 12.5}}>
                  <div><div className="muted">SKU</div><div className="mono" style={{fontWeight:500}}>{producto.sku}</div></div>
                  <div><div className="muted">Marca</div><div style={{fontWeight:500}}>{producto.marca}</div></div>
                  <div><div className="muted">Categoría</div><div style={{fontWeight:500}}>{producto.categoria}</div></div>
                  <div><div className="muted">Costo unitario</div><div className="mono" style={{fontWeight:500}}>{fmt.usd(producto.costo)}</div></div>
                  <div><div className="muted">Precio base (USD)</div><div className="mono" style={{fontWeight:500}}>{fmt.usd(producto.base)}</div></div>
                  <div><div className="muted">Precio base (Bs)</div><div className="mono muted">{fmt.ves(producto.base * SSData.tasa.bcv)}</div></div>
                  <div><div className="muted">Peso</div><div>{producto.peso || '—'} kg</div></div>
                  <div><div className="muted">Unidad</div><div>Unidad</div></div>
                  <div><div className="muted">IVA</div><div>16% general</div></div>
                  <div>
                    <div className="muted">Stock mínimo</div>
                    <div style={{fontWeight:500}}>
                      {(Number(producto.minimo) || 0) > 0
                        ? <>{producto.minimo} <span className="small muted">uds · disp. {dispProducto}</span>{dispProducto <= producto.minimo && <span className="chip amber" style={{marginLeft:6}}>Bajo</span>}</>
                        : <span className="muted">Sin alerta</span>}
                    </div>
                  </div>
                </div>
                <div style={{marginTop:12, paddingTop:12, borderTop:'1px solid var(--border)'}}>
                  <SerializadoToggle serializado={localSerializado} saving={savingSerial} onToggle={toggleSerializado}/>
                  {localSerializado && (producto.garantia_meses > 0 || producto.garantia_condiciones) && (
                    <div style={{marginTop:10, padding:'8px 10px', background:'var(--bg-sunken)', borderRadius:6, fontSize:12.5}}>
                      <span className="muted">Garantía por defecto: </span>
                      <strong>{producto.garantia_meses ? `${producto.garantia_meses} meses` : 'Sin garantía'}</strong>
                      {producto.garantia_condiciones && <div className="small muted" style={{marginTop:3}}>{producto.garantia_condiciones}</div>}
                    </div>
                  )}
                </div>
              </div>

              {/* Trazabilidad de proveedores */}
              <div className="card mt-4" style={{padding:16}}>
                <div className="card-title" style={{marginBottom:10, display:'flex', alignItems:'center', gap:8}}>
                  <Icon name="suppliers" size={14}/> Proveedores
                  {proveedorTraza.length > 0 && <span className="chip neutral" style={{fontSize:11}}>{proveedorTraza.length}</span>}
                </div>
                {proveedorTraza.length === 0
                  ? <div className="small muted">Sin órdenes de compra registradas para este producto.</div>
                  : <table className="tbl" style={{fontSize:12.5}}>
                      <thead>
                        <tr>
                          <th>Proveedor</th>
                          <th>RIF</th>
                          <th className="num">OCs</th>
                          <th className="num">Uds. compradas</th>
                          <th>Última OC</th>
                          <th className="num">Último precio</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {proveedorTraza.map(p => (
                          <tr key={p.provId}>
                            <td style={{fontWeight:500}}>{p.nombre}</td>
                            <td className="small mono muted">{p.rif || '—'}</td>
                            <td className="num">{p.totalOcs}</td>
                            <td className="num">{p.totalUnidades}</td>
                            <td className="small muted">{p.ultimaOc?.fecha ? fmt.date(p.ultimaOc.fecha) : '—'}</td>
                            <td className="num mono">{p.ultimaOc?.precio ? fmt.usd(p.ultimaOc.precio) : '—'}</td>
                            <td>{p.ultimaOc?.estado
                              ? <span className={`chip ${p.ultimaOc.estado === 'recibida' ? 'green' : p.ultimaOc.estado === 'parcial' ? 'amber' : 'neutral'}`}>{p.ultimaOc.estado}</span>
                              : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                }
              </div>
            </div>
          )}

          {!isEditing && tab === 'stock' && (
            <div className="tbl-wrap">
              <table className="tbl">
                {/* Orden de columnas pedido el 2026-08-13: primero DISPONIBLE (lo que de verdad se
                    puede vender, que es lo que se viene a mirar), después RESERVADO, y al final el
                    total físico. "Cantidad" se rotula "Total a la mano" porque el número que la
                    gente llama "cantidad" es el vendible, y tenerlo primero con ese nombre invitaba
                    a prometer mercancía que ya está comprometida en una orden. */}
                <thead><tr><th>Almacén</th><th>Dirección</th><th className="num">Disponible</th><th className="num">Reservado</th><th className="num">Total a la mano</th><th>Estado</th></tr></thead>
                <tbody>
                  {stocks.map(s => {
                    const disp = s.cantidad - s.reservado;
                    return (
                      <tr key={s.a.id}>
                        <td style={{fontWeight: 500}}>{s.a.nombre}</td>
                        <td className="small muted">{s.a.direccion}</td>
                        <td className="num strong-num" style={{color: disp < 5 ? 'var(--danger)' : disp < 15 ? 'var(--warn)' : 'var(--success)'}}>{disp}</td>
                        <td className="num muted">{s.reservado}</td>
                        <td className="num">{s.cantidad}</td>
                        <td>{s.cantidad === 0 ? <span className="chip red">Agotado</span> : s.cantidad < 10 ? <span className="chip amber">Bajo</span> : <span className="chip green">OK</span>}</td>
                      </tr>
                    );
                  })}
                  <tr style={{background:'var(--bg-sunken)', fontWeight: 600}}>
                    <td>Total</td><td></td>
                    <td className="num">{totalStock - totalReservado}</td>
                    <td className="num">{totalReservado}</td>
                    <td className="num">{totalStock}</td><td></td>
                  </tr>
                </tbody>
              </table>
              {/* De QUÉ órdenes viene el hold. "Reservado: 60" sin decir de dónde no sirve para
                  decidir nada: hay que poder abrir esas órdenes (y ver si alguna no existe ya). */}
              {totalReservado > 0 && window.HoldDeOrdenes && stocks.filter(s => s.reservado > 0).map(s => (
                <window.HoldDeOrdenes key={s.a.id} sku={producto.sku} almacenId={s.a.id} reservado={s.reservado}
                  titulo={`En hold en ${s.a.nombre} — ${s.reservado} u`}/>
              ))}
            </div>
          )}

          {!isEditing && tab === 'movs' && (() => {
            const proveedoresEnMovs = [...new Map(
              movimientos.filter(m => m.proveedor_id).map(m => [m.proveedor_id, m.proveedor || m.proveedor_id])
            ).entries()].map(([id, nombre]) => ({ id, nombre }));
            const movsFiltrados = proveedorFilter
              ? movimientos.filter(m => m.proveedor_id === proveedorFilter)
              : movimientos;
            const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
            const grupoDe = (m) => {
              if (movGroupBy === 'cliente')  return m.cliente || 'Sin cliente';
              if (movGroupBy === 'almacen')  return m.almacen?.nombre || 'Sin almacén';
              if (movGroupBy === 'tipo')     return ({entrada:'Entradas', salida:'Salidas', transferencia:'Transferencias', ajuste:'Ajustes', reservado:'Reservas', 'cotización':'Cotizaciones'})[m.tipo] || m.tipo;
              if (movGroupBy === 'mes') {
                const f = (m.fecha || '').slice(0,7);      // YYYY-MM
                const [y, mm] = f.split('-');
                return mm ? `${MESES[parseInt(mm,10)-1]}. ${y}` : 'Sin fecha';
              }
              return null;
            };
            // Agrupa preservando el orden (movimientos ya vienen por fecha desc).
            const grupos = [];
            if (movGroupBy) {
              const idx = {};
              movsFiltrados.forEach(m => {
                const k = grupoDe(m);
                if (idx[k] == null) { idx[k] = grupos.length; grupos.push({ key: k, rows: [], net: 0 }); }
                const g = grupos[idx[k]];
                g.rows.push(m);
                g.net += (m.cantidad || 0);
              });
            }
            const renderRow = (m) => (
              <tr key={m.id}>
                <td className="muted">{fmt.date(m.fecha)}</td>
                <td className="mono-cell">{m.id}</td>
                <td>
                  {m.tipo === 'entrada' && <span className="chip green"><Icon name="arrDn" size={10}/>Entrada</span>}
                  {m.tipo === 'salida' && <span className="chip red"><Icon name="arrUp" size={10}/>Salida</span>}
                  {m.tipo === 'reservado' && <span className="chip amber">Reserva</span>}
                  {m.tipo === 'cotización' && <span className="chip neutral">Cotización</span>}
                  {m.tipo === 'ajuste' && <span className="chip amber">Ajuste</span>}
                  {m.tipo === 'transferencia' && <span className="chip blue"><Icon name="truck" size={10}/>Transfer.</span>}
                </td>
                <td style={{fontSize: 12}}>{m.motivo}</td>
                <td className="small">{m.cliente || <span className="muted">—</span>}</td>
                <td className="small">{m.proveedor || <span className="muted">—</span>}</td>
                <td className="small">{m.almacen?.nombre || <span className="muted">—</span>}</td>
                <td className="small">{m.usuario?.nombre?.split(' ')[0] || '—'}</td>
                <td className="num strong-num" style={{color: m.cantidad > 0 ? 'var(--success)' : m.cantidad < 0 ? 'var(--danger)' : 'var(--text-muted)'}}>
                  {m.cantidad > 0 ? '+' : ''}{m.cantidad}
                </td>
              </tr>
            );
            return (
              <div className="tbl-wrap">
                <div className="tbl-toolbar">
                  <strong style={{fontSize:13}}>Kardex del producto</strong>
                  <select className="select" value={movGroupBy} onChange={e => setMovGroupBy(e.target.value)} style={{fontSize:12, minWidth:150}} title="Agrupar movimientos">
                    <option value="">Sin agrupar</option>
                    <option value="cliente">Agrupar por cliente</option>
                    <option value="almacen">Agrupar por almacén</option>
                    <option value="tipo">Agrupar por tipo</option>
                    <option value="mes">Agrupar por mes</option>
                  </select>
                  {proveedoresEnMovs.length > 0 && (
                    <select className="select" value={proveedorFilter} onChange={e => setProveedorFilter(e.target.value)} style={{fontSize:12, minWidth:160}}>
                      <option value="">Todos los proveedores</option>
                      {proveedoresEnMovs.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                  )}
                  {proveedorFilter && (
                    <button className="btn ghost sm" onClick={() => setProveedorFilter('')} style={{fontSize:11, color:'var(--danger)'}}>✕ proveedor</button>
                  )}
                  <span className="ml-auto small">{kardexProd === null ? 'Cargando kardex…' : `${movsFiltrados.length} de ${movimientos.length} movimiento${movimientos.length!==1?'s':''}`}</span>
                  {/* Un sku con años de historia tiene más de mil movimientos (783 kB): se traen los
                      últimos 200 y el resto a pedido. Se dice, para que nadie crea que eso es todo. */}
                  {kardexHayMas && !kardexTodo && (
                    <button className="btn ghost sm" onClick={() => setKardexTodo(true)} style={{fontSize:11}}
                      title="Se muestran los últimos 200 movimientos">
                      Ver historial completo
                    </button>
                  )}
                </div>
                <table className="tbl">
                  <thead><tr>
                    <th>Fecha</th><th>ID</th><th>Tipo</th><th>Motivo</th>
                    <th>Cliente</th><th>Proveedor</th><th>Almacén</th><th>Usuario</th><th className="num">Cantidad</th>
                  </tr></thead>
                  <tbody>
                    {movsFiltrados.length === 0 && (
                      <tr><td colSpan={9} className="empty" style={{padding:24, textAlign:'center', color:'var(--text-muted)'}}>
                        {kardexProd === null ? 'Cargando movimientos…' : <>Sin movimientos{proveedorFilter ? ' para este proveedor' : ' registrados para este SKU'}.</>}
                      </td></tr>
                    )}
                    {!movGroupBy && movsFiltrados.map(renderRow)}
                    {movGroupBy && grupos.map(g => (
                      <React.Fragment key={g.key}>
                        <tr style={{background:'var(--bg-sunken)'}}>
                          <td colSpan={8} style={{fontWeight:600, fontSize:12.5}}>{g.key} <span className="muted" style={{fontWeight:400}}>· {g.rows.length} mov.</span></td>
                          <td className="num strong-num" style={{color: g.net > 0 ? 'var(--success)' : g.net < 0 ? 'var(--danger)' : 'var(--text-muted)'}}>{g.net > 0 ? '+' : ''}{g.net}</td>
                        </tr>
                        {g.rows.map(renderRow)}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}

          {!isEditing && tab === 'precios' && (
            <div>
              <div style={{ padding:'0 0 10px', fontSize:12, color:'var(--text-muted)' }}>
                Todos los precios son editables · Enter o blur para guardar · dejar vacío para volver al precio calculado
              </div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr>
                    <th>Lista de precios</th>
                    <th>Tipo cliente</th>
                    <th className="num">Descuento</th>
                    <th className="num">Precio USD</th>
                    <th className="num">Precio Bs</th>
                    <th className="num">Margen</th>
                  </tr></thead>
                  <tbody>
                    {SSData.listasPrecios.map(lp => {
                      const tc       = SSData.tiposCliente.find(t => t.id === lp.tipo);
                      const isCustom = lp.modo === 'custom';
                      const manual   = lp.preciosManuales?.[producto.sku];
                      const precio   = manual != null ? manual : producto.base * (1 - (lp.valor || 0) / 100);
                      const editVal  = priceEdits[lp.id];
                      const displayPrice  = editVal !== undefined ? (parseFloat(editVal) || 0) : precio;
                      const displayMargen = displayPrice > 0 ? ((displayPrice - producto.costo) / displayPrice * 100) : 0;
                      const isSaving = savingRow === lp.id;
                      const isSaved  = savedRow  === lp.id;
                      return (
                        <tr key={lp.id} style={{ background: isCustom ? 'var(--brand-soft, #eff6ff)' : 'transparent' }}>
                          <td style={{ fontWeight:500 }}>
                            {lp.nombre}
                            {isCustom && (
                              <span style={{ marginLeft:6, fontSize:10, background:'var(--brand)', color:'#fff', borderRadius:4, padding:'1px 5px', fontWeight:700 }}>custom</span>
                            )}
                          </td>
                          <td>
                            {tc && <span className="chip" style={{ background: tc.color+'20', color: tc.color }}>{tc.nombre}</span>}
                          </td>
                          <td className="num">{isCustom && manual != null ? '—' : `−${lp.valor || 0}%`}</td>
                          <td className="num strong-num">
                            <div style={{ display:'flex', alignItems:'center', gap:5, justifyContent:'flex-end' }}>
                              <input
                                type="number" min="0" step="0.01"
                                placeholder={precio.toFixed(2)}
                                value={editVal !== undefined ? editVal : (manual != null ? manual : '')}
                                onChange={e => setPriceEdits(prev => ({ ...prev, [lp.id]: e.target.value }))}
                                onBlur={e => handleSaveOnePrice(lp.id, e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                                disabled={isSaving}
                                style={{ width:88, textAlign:'right', padding:'3px 6px', fontSize:12,
                                         border:`1px solid ${isCustom ? 'var(--brand)' : 'var(--border)'}`,
                                         borderRadius:6, outline:'none',
                                         background: isSaving ? 'var(--bg-sunken)' : '#fff' }}
                              />
                              {isSaving && <span style={{ fontSize:10, color:'var(--text-muted)' }}>…</span>}
                              {isSaved  && <span style={{ fontSize:13, color:'var(--success)' }}>✓</span>}
                            </div>
                          </td>
                          <td className="num muted">{fmt.ves(displayPrice * (SSData.tasa?.bcv || 1))}</td>
                          <td className="num" style={{ color: displayMargen < 10 ? 'var(--danger)' : displayMargen < 20 ? 'var(--warn)' : 'var(--success)' }}>
                            {displayMargen.toFixed(1)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!isEditing && tab === 'ventas' && (() => {
            const hoy    = window.localDateStr ? window.localDateStr() : new Date().toISOString().slice(0, 10);
            const d30    = new Date(hoy + 'T12:00:00'); d30.setDate(d30.getDate() - 30);
            const hace30 = window.localDateStr ? window.localDateStr(d30) : d30.toISOString().slice(0, 10);

            const ventas30d    = ventas.filter(v => v.fecha >= hace30);
            const unidades30d  = ventas30d.reduce((s, v) => s + v.cantidad, 0);
            const ingresos30d  = ventas30d.reduce((s, v) => s + v.subtotal, 0);
            const totalUnidades = ventas.reduce((s, v) => s + v.cantidad, 0);
            const totalFacturas = new Set(ventas.map(v => v.documentoId)).size;
            const mesesConVenta = new Set(ventas.map(v => (v.fecha || '').slice(0, 7))).size || 1;
            const rotacionMensual = totalUnidades / mesesConVenta;

            // Agrupación opcional por cliente o mes (sobre TODO el histórico cargado).
            let grupos = null;
            if (ventasGroupBy === 'cliente' || ventasGroupBy === 'mes') {
              const map = new Map();
              for (const v of ventas) {
                const k = ventasGroupBy === 'cliente' ? (v.clienteNombre || '(sin cliente)') : ((v.fecha || '').slice(0, 7) || '(sin fecha)');
                if (!map.has(k)) map.set(k, []);
                map.get(k).push(v);
              }
              grupos = [...map.entries()].map(([key, rows]) => ({
                key, rows,
                unidades: rows.reduce((s, r) => s + r.cantidad, 0),
                monto:    rows.reduce((s, r) => s + r.subtotal, 0),
                facturas: new Set(rows.map(r => r.documentoId)).size,
              })).sort((a, b) => ventasGroupBy === 'mes' ? b.key.localeCompare(a.key) : b.monto - a.monto);
            }

            const totalPagesV  = Math.max(1, Math.ceil(ventas.length / ventasPageSize));
            const pageVClamped = Math.min(ventasPage, totalPagesV);
            const pagedVentas  = ventas.slice((pageVClamped - 1) * ventasPageSize, pageVClamped * ventasPageSize);

            // Exporta lo que la pantalla está mostrando: si hay agrupación puesta (cliente/mes),
            // el Excel sale agrupado igual — no el detalle línea por línea que el usuario acaba de
            // ocultar al elegir "Agrupar por". Mismas columnas que la tabla en pantalla.
            function exportarVentasExcel() {
              if (grupos) {
                window.exportToXLSX(
                  grupos.map(g => ({ ...g, etiqueta: ventasGroupBy === 'mes' ? fmt.mesNombre(g.key) : g.key })),
                  [
                    { key: 'etiqueta', label: ventasGroupBy === 'cliente' ? 'Cliente' : 'Mes' },
                    { key: 'facturas', label: 'Facturas' },
                    { key: 'unidades', label: 'Unidades' },
                    { key: 'monto',    label: 'Monto',    format: v => Number(v) || 0 },
                  ],
                  `ventas-${producto.sku}-por-${ventasGroupBy}`,
                  'Ventas'
                );
              } else {
                window.exportToXLSX(
                  ventas,
                  [
                    { key: 'documentoId',  label: 'Factura' },
                    { key: 'clienteNombre',label: 'Cliente' },
                    { key: 'fecha',        label: 'Fecha',  format: fmt.date },
                    { key: 'cantidad',     label: 'Cant.' },
                    { key: 'precioUnit',   label: 'Precio', format: v => Number(v) || 0 },
                    { key: 'subtotal',     label: 'Total',  format: v => Number(v) || 0 },
                  ],
                  `ventas-${producto.sku}`,
                  'Ventas'
                );
              }
            }

            return (
              <div>
                <div className="grid-3">
                  <div className="stat"><div className="stat-label">Vendidas últimos 30 días</div><div className="stat-val" style={{fontSize: 22}}>{unidades30d.toLocaleString('es-VE')}</div></div>
                  <div className="stat"><div className="stat-label">Ingresos últimos 30 días</div><div className="stat-val" style={{fontSize: 22}}>{fmt.usd(ingresos30d)}</div></div>
                  <div className="stat"><div className="stat-label">Rotación</div><div className="stat-val" style={{fontSize: 22}}>{rotacionMensual.toFixed(1)}x</div><div className="small">unidades/mes prom.</div></div>
                </div>
                <div className="card mt-4">
                  <div className="card-header" style={{display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8}}>
                    <h3 className="card-title">
                      Historial de ventas
                      {!ventasLoading && <span className="small muted" style={{marginLeft:8, fontWeight:400}}>{ventas.length} línea{ventas.length!==1?'s':''} · {totalFacturas} factura{totalFacturas!==1?'s':''}</span>}
                    </h3>
                    <div style={{display:'flex', alignItems:'center', gap:6}}>
                      <span className="small muted">Agrupar por:</span>
                      <select className="select" value={ventasGroupBy} onChange={e => setVentasGroupBy(e.target.value)} style={{fontSize:12, minWidth:130}} title="Agrupar ventas">
                        <option value="">Sin agrupar</option>
                        <option value="cliente">Cliente</option>
                        <option value="mes">Mes</option>
                      </select>
                      {ventas.length > 0 && (
                        <button className="btn ghost sm" onClick={exportarVentasExcel}
                                title={ventasGroupBy ? `Exportar agrupado por ${ventasGroupBy}` : 'Exportar el detalle de ventas'}>
                          <Icon name="download" size={13}/>Excel
                        </button>
                      )}
                    </div>
                  </div>
                  {ventasLoading ? (
                    <div style={{padding:32, textAlign:'center', color:'var(--text-muted)'}}>Cargando ventas…</div>
                  ) : ventas.length === 0 ? (
                    <div className="empty" style={{padding:32, textAlign:'center'}}>Este producto no tiene ventas registradas.</div>
                  ) : grupos ? (
                    <table className="tbl">
                      <thead><tr><th>{ventasGroupBy === 'cliente' ? 'Cliente' : 'Mes'}</th><th className="num">Facturas</th><th className="num">Unidades</th><th className="num">Monto</th></tr></thead>
                      <tbody>
                        {grupos.map(g => (
                          <tr key={g.key}>
                            <td style={{fontWeight:500}}>{ventasGroupBy === 'mes' ? fmt.mesNombre(g.key) : g.key}</td>
                            <td className="num">{g.facturas}</td>
                            <td className="num">{g.unidades.toLocaleString('es-VE')}</td>
                            <td className="num strong-num">{fmt.usd(g.monto)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <>
                      <table className="tbl">
                        <thead><tr><th>Factura</th><th>Cliente</th><th>Fecha</th><th className="num">Cant.</th><th className="num">Precio</th><th className="num">Total</th></tr></thead>
                        <tbody>
                          {pagedVentas.map((v, i) => (
                            <tr key={v.documentoId + '-' + i}>
                              <td className="mono-cell">{v.documentoId}</td>
                              <td style={{fontWeight:500}}>{v.clienteNombre}</td>
                              <td className="muted">{fmt.date(v.fecha)}</td>
                              <td className="num">{v.cantidad}</td>
                              <td className="num">{fmt.usd(v.precioUnit)}</td>
                              <td className="num strong-num">{fmt.usd(v.subtotal)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {totalPagesV > 1 && (
                        <div style={{display:'flex', justifyContent:'flex-end', alignItems:'center', gap:6, padding:'10px 14px'}}>
                          <span className="small muted">Página {pageVClamped} de {totalPagesV}</span>
                          <button className="btn ghost sm" disabled={pageVClamped===1} onClick={() => setVentasPage(p => Math.max(1, p - 1))}>‹</button>
                          <button className="btn ghost sm" disabled={pageVClamped===totalPagesV} onClick={() => setVentasPage(p => Math.min(totalPagesV, p + 1))}>›</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })()}
        </div>

        <div className="modal-footer" style={{flexDirection:'column', alignItems:'stretch', gap:0}}>
          {saveEditErr && (
            <div style={{padding:'8px 12px', background:'#fee2e2', border:'1px solid var(--danger)', borderRadius:6, fontSize:12, color:'#b91c1c', marginBottom:8}}>
              {saveEditErr}
            </div>
          )}
          <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
          {isEditing ? (
            <>
              <button className="btn ghost" disabled={savingEdit} onClick={()=>{ setIsEditing(false); setSaveEditErr(''); }}>Cancelar</button>
              <button className="btn primary"
                      disabled={savingEdit || !editForm.nombre || editForm.costo === '' || editForm.costo == null || editForm.base === '' || editForm.base == null}
                      onClick={handleSave}>
                <Icon name="check" size={14}/>{savingEdit ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </>
          ) : (
            <>
              <button className="btn ghost"><Icon name="download" size={14}/>Ficha PDF</button>
              <button className="btn secondary" onClick={() => onTransfer?.(producto)}><Icon name="truck" size={14}/>Transferir</button>
              {localSerializado && <button className="btn secondary" onClick={() => setShowSeriales(true)}><Icon name="check" size={14}/>Seriales</button>}
              <button className="btn secondary" onClick={() => setShowAjuste(true)}>Ajustar stock</button>
              {window.canUser?.('editar','inventory') !== false && (
                <button className="btn primary" onClick={()=>setIsEditing(true)}><Icon name="edit" size={14}/>Editar producto</button>
              )}
            </>
          )}
          </div>
        </div>
      </div>
      {showSeriales && <SerialesModal producto={producto} onClose={() => setShowSeriales(false)}/>}
      {showAjuste && <AjusteInventarioModal skuInicial={producto.sku} onClose={() => setShowAjuste(false)} onUpdate={() => onUpdate?.(producto)}/>}
      {showMarcasMgr && <MarcasManager onClose={() => setShowMarcasMgr(false)} onPicked={(m) => { setEditForm(f => ({...f, marca: m})); setShowMarcasMgr(false); }}/>}
      {showEditSku && <EditarSkuModal producto={producto} onClose={() => setShowEditSku(false)}
                                      onDone={(nuevo) => { setShowEditSku(false); onUpdate?.({ ...producto, sku: nuevo }); }}/>}
    </div>
  );
}

// ======= Modal: editar el SKU de un producto (permiso especial `producto_sku`) =======
// Solo tiene sentido si el producto NUNCA se vendió ni tuvo movimiento de inventario — el SKU es
// la PK global (documentos_items, inventario, movimientos_inventario, órdenes de compra,
// transferencias, precios y dropshipping lo referencian por texto). La validación real vive en el
// servidor (`renombrar_sku_producto`, ver migracion-odoo/72); acá solo se pide el conteo primero
// para explicar por qué no se puede, en vez de dejar que el usuario tipee y se entere al guardar.
function EditarSkuModal({ producto, onClose, onDone }) {
  const [conteo, setConteo] = useState(null);   // { ventas, movimientos } | null mientras carga
  const [cargando, setCargando] = useState(true);
  const [nuevo, setNuevo] = useState(producto.sku);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    window.puedeRenombrarSku?.(producto.sku).then(r => {
      if (!alive) return;
      if (r?.error) setError('No se pudo verificar el historial del producto.');
      else setConteo(r);
      setCargando(false);
    });
    return () => { alive = false; };
  }, [producto.sku]);

  const bloqueado = conteo && ((conteo.ventas || 0) > 0 || (conteo.movimientos || 0) > 0);

  async function guardar() {
    const sku = (nuevo || '').trim().toUpperCase();
    if (!sku || sku === producto.sku) return;
    setGuardando(true); setError('');
    const res = await window.renombrarSkuProducto(producto.sku, sku);
    setGuardando(false);
    if (res?.error) { setError(res.error.message || 'No se pudo cambiar el SKU.'); return; }
    onDone?.(res.sku_nuevo);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 440 }}>
        <div className="modal-header">
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center' }}>
            <Icon name="edit" size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <h3 className="modal-title">Editar SKU</h3>
            <div className="small">{producto.nombre}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {cargando ? (
            <div className="small muted">Verificando ventas y movimientos…</div>
          ) : bloqueado ? (
            <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: 'var(--danger)' }}>
              <strong>Este SKU no se puede editar.</strong>
              <ul style={{ marginTop: 6, paddingLeft: 16 }}>
                {conteo.ventas > 0 && <li>{conteo.ventas} línea{conteo.ventas === 1 ? '' : 's'} de venta</li>}
                {conteo.movimientos > 0 && <li>{conteo.movimientos} movimiento{conteo.movimientos === 1 ? '' : 's'} de inventario</li>}
              </ul>
              El SKU es la clave con la que ese historial identifica al producto — cambiarlo lo dejaría apuntando a un producto que ya no existe.
            </div>
          ) : (
            <>
              <div className="small muted">Sin ventas ni movimientos registrados: se puede renombrar con seguridad.</div>
              <div>
                <label className="form-label">SKU actual</label>
                <div className="mono small muted">{producto.sku}</div>
              </div>
              <div>
                <label className="form-label">SKU nuevo *</label>
                <input className="input" value={nuevo} onChange={e => setNuevo(e.target.value.toUpperCase())} autoFocus />
              </div>
            </>
          )}
          {error && (
            <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: 'var(--danger)' }}>
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose} disabled={guardando}>Cancelar</button>
          {!bloqueado && !cargando && (
            <button className="btn primary" onClick={guardar} disabled={guardando || !nuevo.trim() || nuevo.trim().toUpperCase() === producto.sku}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ======= Modal: Seriales de un producto =======
function SerialesModal({ producto, onClose }) {
  const [seriales, setSeriales]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [bulkInput, setBulkInput] = useState('');
  const [almacenId, setAlmacenId] = useState('');
  const [garantia, setGarantia]   = useState(String(producto.garantia_meses || 12));
  const [filterEstado, setFilterEstado] = useState('todos');
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState('');
  const [stockDb, setStockDb]     = useState(null);
  const [conteos, setConteos]     = useState(null);        // conteos por estado, del server
  const [totalFiltrado, setTotalFiltrado] = useState(0);   // filas que matchean el filtro actual

  // M-05: paginación + búsqueda dentro del listado. Declarados ACÁ (antes del efecto de `reload`
  // más abajo) a propósito: ese efecto los usa en su arreglo de dependencias, y un arreglo de
  // dependencias se evalúa en cada render en el momento en que se llama a `useEffect` — si estas
  // constantes se declaraban más abajo en el cuerpo de la función, la evaluación caía en su
  // temporal dead zone y tiraba `ReferenceError: Cannot access 'snSearch' before initialization`
  // EN TODOS LOS RENDERS. Sin un error boundary en la app (ver app-bootstrap.jsx,
  // `ModuleErrorBoundary`), eso tumbaba TODA la pantalla a blanco — el bug reportado el
  // 2026-08-14 ("al revisar el serial de un equipo me arroja otra página en blanco").
  const [snSearch, setSnSearch] = useState('');
  const [snPage, setSnPage]     = useState(1);
  const [SN_PAGE_SIZE, setSnPageSize] = useState(() => {
    const v = parseInt(localStorage.getItem('ss-seriales-pagesize'));
    return [50,100,200].includes(v) ? v : 50;
  });
  useEffect(() => { localStorage.setItem('ss-seriales-pagesize', String(SN_PAGE_SIZE)); }, [SN_PAGE_SIZE]);

  // Deriva el almacén efectivo en cada render — no depende del timing del mount
  const efectivoAlmacenId = almacenId || (SSData.almacenes || [])[0]?.id || '';

  async function reload() {
    setLoading(true);
    // Un viaje: los conteos por estado sobre TODO el sku (son los de las tarjetas) y solo la página
    // que se está mirando, ya filtrada por estado y por lo que se buscó. Ver migracion-odoo/30.
    const r = await window.getSerialesProducto?.(producto.sku, {
      estado: filterEstado, buscar: snSearch, page: snPage, pageSize: SN_PAGE_SIZE,
    });
    if (r) {
      setSeriales(r.filas || []);
      setConteos(r.conteos || null);
      setTotalFiltrado(r.total_filtrado || 0);
    } else {
      // Respaldo: si la RPC no responde, el camino de antes (todos los del sku).
      const filas = await window.sb.from('inventario_seriales').select('*')
        .eq('empresa_id', window.currentEmpresa || 'demo1')
        .eq('sku', producto.sku)
        .order('created_at', { ascending: false })
        .then(x => x.data || []);
      setSeriales(filas);
      setConteos(null);
      setTotalFiltrado(filas.length);
    }
    // Stock desde SSData.inventario (ya filtrado por empresa en loadAppData). La tabla `inventario`
    // no tiene empresa_id y su RLS deja ver almacenes de TODAS las empresas del JWT → un query crudo
    // sumaría el stock de otra empresa para un multi-empresa (Administrador).
    const invSku = SSData.inventario[producto.sku] || {};
    setStockDb(Object.values(invSku).reduce((sum, slot) => sum + (slot.cantidad || 0), 0));
    setLoading(false);
  }
  // Se recarga al cambiar de página, de filtro o de búsqueda (con un respiro para no consultar en
  // cada tecla).
  useEffect(() => {
    const t = setTimeout(() => { reload(); }, snSearch ? 300 : 0);
    return () => clearTimeout(t);
  }, [producto.sku, filterEstado, snSearch, snPage, SN_PAGE_SIZE]);

  const stockTotal = stockDb ?? Object.values(SSData.inventario[producto.sku] || {})
    .reduce((sum, slot) => sum + (slot.cantidad || 0), 0);

  // De la RPC (cuenta sobre TODO el sku). El respaldo cuenta sobre lo que haya en memoria, que en
  // ese camino son todos.
  const dispSerial = conteos ? conteos.disponible : seriales.filter(s => s.estado === 'disponible').length;
  const vendido    = conteos ? conteos.vendido    : seriales.filter(s => s.estado === 'vendido').length;
  const devuelto   = conteos ? conteos.devuelto   : seriales.filter(s => s.estado === 'devuelto').length;
  // BR-INV-S02: sinSerial = stockTotal - seriales físicamente en almacén (disponibles + devueltos)
  // Los vendidos NO cuentan porque ya no están físicamente. Antes restábamos seriales.length → bug.
  const enStockConSerial = dispSerial + devuelto;
  const sinSerial = Math.max(0, stockTotal - enStockConSerial);
  const stats = {
    stock:      stockTotal,
    total:      conteos ? conteos.total : seriales.length,
    disponible: dispSerial + sinSerial,
    vendido,
    devuelto,
    sinSerial,
  };

  // El server ya filtró por estado y por la búsqueda, y devolvió solo esta página: `seriales` ES la
  // página. Con el respaldo (todos en memoria) se filtra y se corta acá, como antes.
  const servidor = !!conteos;
  const filteredAll = servidor ? seriales : seriales.filter(s => {
    if (filterEstado !== 'todos' && s.estado !== filterEstado) return false;
    if (!snSearch.trim()) return true;
    const t = snSearch.trim().toLowerCase();
    return (s.serial || '').toLowerCase().includes(t) ||
           (s.documento_id || '').toLowerCase().includes(t);
  });
  const snTotalPages = Math.max(1, Math.ceil((servidor ? totalFiltrado : filteredAll.length) / SN_PAGE_SIZE));
  useEffect(() => { setSnPage(1); }, [filterEstado, snSearch, SN_PAGE_SIZE]);
  const filtered = servidor ? filteredAll : filteredAll.slice((snPage - 1) * SN_PAGE_SIZE, snPage * SN_PAGE_SIZE);

  async function agregar() {
    if (!bulkInput.trim()) return;
    setErr(''); setSaving(true);
    const list = bulkInput.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
    if (list.length === 0) { setSaving(false); return; }
    const { error, count } = await window.agregarSeriales({
      sku: producto.sku, almacenId: efectivoAlmacenId, garantiaMeses: parseInt(garantia) || 0, seriales: list,
    });
    setSaving(false);
    if (error) { setErr('Error: ' + (error.message || JSON.stringify(error))); return; }
    setBulkInput('');
    window.logActivity?.({ modulo:'inventario', accion:'crear', entidad_id:producto.sku, entidad_label:producto.nombre, detalles:{ tipo:'seriales', count } });
    await reload();
  }

  async function eliminar(id, serial) {
    if (!confirm(`¿Eliminar serial ${serial}?`)) return;
    const { error } = await window.eliminarSerial(id);
    if (error) { alert('Error: ' + (error.message || JSON.stringify(error))); return; }
    await reload();
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{zIndex:200}}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width:'min(820px, 96vw)', maxHeight:'90vh', display:'flex', flexDirection:'column'}}>
        <div className="modal-header">
          <div style={{width:38,height:38,borderRadius:9,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}>
            <Icon name="check" size={18}/>
          </div>
          <div style={{flex:1}}>
            <div className="modal-title">Seriales · {producto.nombre}</div>
            <div className="small">SKU {producto.sku} · {stats.stock} en stock · {stats.total} serial{stats.total!==1?'es':''} registrado{stats.total!==1?'s':''}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        <div className="modal-body" style={{overflowY:'auto'}}>
          <div className="stat-grid" style={{gridTemplateColumns:'repeat(5, 1fr)', marginBottom:16}}>
            <div className="stat">
              <div className="stat-label">Stock</div>
              <div className="stat-val">{stats.stock}</div>
              <div className="small muted" style={{marginTop:2}}>en inventario</div>
            </div>
            <div className="stat">
              <div className="stat-label">Disponibles</div>
              <div className="stat-val" style={{color:'var(--success)'}}>{stats.disponible}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Vendidos</div>
              <div className="stat-val" style={{color:'var(--brand)'}}>{stats.vendido}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Devueltos</div>
              <div className="stat-val" style={{color:'var(--warn)'}}>{stats.devuelto}</div>
            </div>
            <div className="stat" title="Unidades en stock sin número de serie registrado">
              <div className="stat-label">Sin S/N</div>
              <div className="stat-val" style={{color: stats.sinSerial > 0 ? 'var(--warn)' : 'var(--text-muted)'}}>{stats.sinSerial}</div>
              {stats.sinSerial > 0 && <div className="small" style={{color:'var(--warn)', marginTop:2}}>registrar S/N</div>}
            </div>
          </div>

          {window.canUser?.('editar','pos_seriales') !== false && (
          <div className="card" style={{padding:14, background:'var(--bg-sunken)', marginBottom:16}}>
            <div className="form-section-title" style={{marginTop:0}}>Agregar seriales</div>
            <div className="grid-2" style={{gap:12, marginBottom:10}}>
              <div>
                <label className="form-label">Almacén</label>
                <select className="select" value={efectivoAlmacenId} onChange={e=>setAlmacenId(e.target.value)} style={{width:'100%'}}>
                  {(SSData.almacenes || []).map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Garantía (meses)</label>
                <input className="input mono" type="number" min="0" value={garantia} onChange={e=>setGarantia(e.target.value)}/>
              </div>
            </div>
            <label className="form-label">Seriales (uno por línea o separados por coma)</label>
            <textarea className="input mono" rows={4} value={bulkInput} onChange={e=>setBulkInput(e.target.value)}
              placeholder="SN-A1B2C3&#10;SN-D4E5F6&#10;SN-G7H8I9"
              style={{fontSize:12, fontFamily:'var(--mono)'}}/>
            {err && <div style={{marginTop:8, padding:'6px 10px', background:'#fee2e2', borderRadius:6, fontSize:12, color:'#b91c1c'}}>{err}</div>}
            <div style={{marginTop:10, display:'flex', justifyContent:'flex-end'}}>
              <button className="btn primary" onClick={agregar} disabled={saving || !bulkInput.trim() || !efectivoAlmacenId}>
                <Icon name="plus" size={13}/>{saving ? 'Guardando…' : 'Agregar'}
              </button>
            </div>
          </div>
          )}

          <div style={{display:'flex', gap:10, marginBottom:8, alignItems:'center'}}>
            <input className="input" placeholder="Buscar S/N o documento…" value={snSearch} onChange={e=>setSnSearch(e.target.value)}
              style={{flex:1, fontSize:12.5}}/>
            <span className="small muted" style={{whiteSpace:'nowrap'}}>{filteredAll.length} resultado{filteredAll.length!==1?'s':''}</span>
          </div>

          <div className="seg" style={{marginBottom:8}}>
            <button className={filterEstado==='todos'?'on':''} onClick={()=>setFilterEstado('todos')}>Todos ({stats.total})</button>
            <button className={filterEstado==='disponible'?'on':''} onClick={()=>setFilterEstado('disponible')}>Disponibles ({stats.disponible})</button>
            <button className={filterEstado==='vendido'?'on':''} onClick={()=>setFilterEstado('vendido')}>Vendidos ({stats.vendido})</button>
            <button className={filterEstado==='devuelto'?'on':''} onClick={()=>setFilterEstado('devuelto')}>Devueltos ({stats.devuelto})</button>
          </div>

          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Serial</th><th>Estado</th><th>Almacén</th><th>Vendido en</th><th>Cliente</th><th>Vence</th><th className="dt-hide-mobile">Creado por</th><th></th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={8} className="empty">Cargando…</td></tr>}
                {!loading && filteredAll.length === 0 && <tr><td colSpan={8} className="empty">Sin seriales{snSearch ? ` que coincidan con "${snSearch}"` : ''}</td></tr>}
                {!loading && filtered.map(s => {
                  const alm = (SSData.almacenes || []).find(a => a.id === s.almacen_id);
                  const cli = SSData.clientes.find(c => c.id === s.cliente_id);
                  const vigente = s.garantia_vence && new Date(s.garantia_vence) > new Date();
                  const highlight = producto._highlightSerial && s.serial === producto._highlightSerial;
                  return (
                    <tr key={s.id} style={highlight ? {background:'var(--brand-soft)', outline:'2px solid var(--brand)'} : null}>
                      <td className="mono-cell" style={{fontWeight:600}}>{s.serial}</td>
                      <td><span className={`chip ${s.estado==='disponible'?'green':s.estado==='vendido'?'blue':s.estado==='devuelto'?'amber':'gray'}`}>{s.estado}</span></td>
                      <td className="small">{alm?.nombre || '—'}</td>
                      <td className="mono-cell small">{s.documento_id || '—'}</td>
                      <td className="small">{cli?.nombre || '—'}</td>
                      <td className="small" style={{color: vigente ? 'var(--success)' : s.garantia_vence ? 'var(--danger)' : 'var(--text-muted)'}}>
                        {s.garantia_vence ? fmt.date(s.garantia_vence) : '—'}
                      </td>
                      <td className="dt-hide-mobile"><CreadoPorCell nombre={s.creado_por}/></td>
                      <td>
                        {s.estado === 'disponible' && window.canUser?.('editar','pos_seriales') !== false && (
                          <button className="icon-btn" onClick={()=>eliminar(s.id, s.serial)} title="Eliminar"><Icon name="trash" size={12}/></button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filteredAll.length > 0 && (
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:10, padding:'8px 12px', background:'var(--bg-sunken)', borderRadius:6, gap:8, flexWrap:'wrap'}}>
              <div style={{display:'flex', alignItems:'center', gap:8}}>
                <select className="select" value={SN_PAGE_SIZE} onChange={e => { setSnPageSize(parseInt(e.target.value)); setSnPage(1); }} style={{ fontSize:12, padding:'3px 6px' }}>
                  {[50,100,200].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <span className="small muted">
                  Página {snPage} de {snTotalPages} · mostrando {filtered.length} de {filteredAll.length}
                </span>
              </div>
              {snTotalPages > 1 && (
                <div style={{display:'flex', gap:6}}>
                  <button className="btn ghost sm" onClick={()=>setSnPage(1)} disabled={snPage===1}>«</button>
                  <button className="btn ghost sm" onClick={()=>setSnPage(p=>Math.max(1, p-1))} disabled={snPage===1}>‹</button>
                  <button className="btn ghost sm" onClick={()=>setSnPage(p=>Math.min(snTotalPages, p+1))} disabled={snPage===snTotalPages}>›</button>
                  <button className="btn ghost sm" onClick={()=>setSnPage(snTotalPages)} disabled={snPage===snTotalPages}>»</button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

// ======= Selector "Disponible en" (empresas del producto) =======
// Un producto puede estar en varias empresas: en Odoo no tenía compañía y las dos lo veían (los racks
// y bandejas los fabrica Demo 2 y Demo 1 los revende). Se comparte UN registro, así que editarlo
// lo cambia en todas las empresas marcadas — eso se dice en el mismo control, no en la documentación.
function EmpresasProductoPicker({ value, onChange, disabled }) {
  const [empresas, setEmpresas] = useState(() => window.__ssEmpresasCache || []);
  useEffect(() => {
    if (empresas.length) return;
    window.loadEmpresas?.().then(list => { window.__ssEmpresasCache = list || []; setEmpresas(list || []); });
  }, []);
  const permitidas = (() => {
    const delUsuario = window.__ssCurrentUser?.empresas;
    const base = empresas.length ? empresas : [{ id: window.currentEmpresa || 'demo1', nombre: window.currentEmpresa || 'demo1' }];
    return Array.isArray(delUsuario) && delUsuario.length ? base.filter(e => delUsuario.includes(e.id)) : base;
  })();
  const sel = Array.isArray(value) ? value : [];
  const actual = window.currentEmpresa || 'demo1';
  function toggle(id) {
    // La empresa activa no se puede desmarcar: dejaría el producto fuera de la pantalla donde se edita.
    if (id === actual) return;
    onChange(sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]);
  }
  if (permitidas.length <= 1) return null;   // una sola empresa → nada que elegir
  return (
    <div>
      <label className="label">Disponible en</label>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        {permidasSafe(permitidas).map(e => {
          const on = sel.includes(e.id);
          const fijo = e.id === actual;
          return (
            <label key={e.id} title={fijo ? 'Es la empresa en la que estás trabajando' : undefined}
                   style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 10px', borderRadius:8, fontSize:12.5,
                            border:`1.5px solid ${on ? 'var(--brand)' : 'var(--border)'}`,
                            background: on ? 'var(--brand-soft)' : 'var(--bg-sunken)',
                            color: on ? 'var(--brand)' : 'var(--text-muted)',
                            cursor: (disabled || fijo) ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
              <input type="checkbox" checked={on} disabled={disabled || fijo} onChange={() => toggle(e.id)} style={{ cursor:'inherit' }}/>
              {e.nombre || e.id}
            </label>
          );
        })}
      </div>
      {sel.length > 1 && (
        <div className="small muted" style={{ marginTop:5 }}>
          Es el MISMO producto en las {sel.length} empresas: si cambiás nombre, costo o precio, cambia en todas.
          El stock sigue siendo de cada almacén.
        </div>
      )}
    </div>
  );
}
// Orden estable (la activa primero) sin mutar el arreglo que viene del caché.
function permidasSafe(lista) {
  const actual = window.currentEmpresa || 'demo1';
  return [...lista].sort((a, b) => (a.id === actual ? -1 : b.id === actual ? 1 : String(a.nombre || a.id).localeCompare(String(b.nombre || b.id), 'es')));
}

// ======= Modal de nuevo producto =======
function NewProductModal({ onClose }) {
  const [form, setForm] = useState({
    sku: '',
    nombre: '',
    marca: SSData.marcas[0],
    categoria: getCategorias()[0] || '',
    costo: '',
    base: '',
    peso: '',
    minimo: '',
    unidad: 'Unidad',
    iva: '16%',
    stockInicial: {},
    serializado: false,
    // El producto nace en la empresa activa; se pueden marcar otras para compartirlo.
    empresas: [window.currentEmpresa || 'demo1'],
  });
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoData, setPhotoData] = useState(null);
  const [showMarcasMgr, setShowMarcasMgr] = useState(false);
  const fileRef = useRef(null);

  const margen = form.costo && form.base ? (((form.base - form.costo) / form.base) * 100).toFixed(1) : '—';

  const camposConfig = window.getCamposConfig?.('inventarios') ?? {};
  const isReqP  = id => camposConfig[id] === 'obligatorio';
  const isHideP = id => camposConfig[id] === 'oculto';
  const reqLblP = id => isReqP(id) ? <span style={{color:'var(--danger)'}}>*</span> : null;
  const reqBorderP = (id, val) => isReqP(id) && !val ? {borderColor:'var(--danger)'} : {};
  const prodValid = (() => {
    if (isReqP('sku') && !form.sku) return false;
    if (isReqP('nombre_inv') && !form.nombre) return false;
    if (isReqP('marca') && !form.marca) return false;
    if (isReqP('categoria') && !form.categoria) return false;
    if (isReqP('costo') && !form.costo) return false;
    if (isReqP('base') && !form.base) return false;
    return true;
  })();

  function update(k, v) { setForm({...form, [k]: v}); }

  function handlePhoto(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => { setPhotoPreview(ev.target.result); setPhotoData(ev.target.result); };
    reader.readAsDataURL(f);
  }

  const [serialesIniciales, setSerialesIniciales] = useState({});  // { almacenId: string }
  const [garantiaInicial, setGarantiaInicial]     = useState('12');
  const [createErr, setCreateErr]                 = useState('');
  const almacenesConStock = getAlmacenes().filter(a => parseInt(form.stockInicial[a.id]) > 0);

  const [saving, setSaving] = useState(false);
  async function handleCreate() {
    setCreateErr('');
    if (!form.sku || !form.nombre) return;
    const sku = form.sku.trim().toUpperCase();
    if (SSData.productos.some(p => p.sku === sku)) {
      setCreateErr('Ya existe un producto con SKU ' + sku);
      return;
    }

    // BR-INV-S10: validar cantSeriales[almacen] ≤ stockInicial[almacen]
    if (form.serializado) {
      const violaciones = [];
      for (const [almacenId, raw] of Object.entries(serialesIniciales)) {
        const lista = (raw || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
        if (lista.length === 0) continue;
        const stock = parseInt(form.stockInicial[almacenId]) || 0;
        if (lista.length > stock) {
          const alm = getAlmacenes().find(a => a.id === almacenId);
          violaciones.push(`${alm?.nombre || almacenId}: ${lista.length} S/N pero solo ${stock} unidades de stock`);
        }
        // Validar duplicados dentro de la misma lista
        const setLista = new Set(lista);
        if (setLista.size !== lista.length) {
          const alm = getAlmacenes().find(a => a.id === almacenId);
          violaciones.push(`${alm?.nombre || almacenId}: hay S/N duplicados en la lista`);
        }
      }
      if (violaciones.length > 0) {
        setCreateErr('No se puede crear el producto:\n• ' + violaciones.join('\n• '));
        return;
      }
    }

    setSaving(true);
    try {
      const empresa = window.currentEmpresa || 'demo1';
      const payload = {
        sku,
        nombre:          form.nombre.trim(),
        marca:           form.marca || null,
        categoria:       form.categoria || null,
        costo:           parseFloat(form.costo) || 0,
        base:            parseFloat(form.base) || 0,
        peso:            parseFloat(form.peso) || 0,
        minimo:          Math.max(0, parseInt(form.minimo) || 0),
        garantia_meses:  parseInt(garantiaInicial) || 0,
        serializado:     !!form.serializado,
        activo:          true,
        empresa_id:      empresa,
        // Visibilidad: la empresa activa siempre, más las que se hayan marcado.
        empresas:        [...new Set([empresa, ...(form.empresas || [])])],
        creado_por:      window.__ssCurrentUser?.nombre || null,
      };
      const { error: prodErr } = await window.sb.from('productos').insert(payload);
      if (prodErr) { alert('Error al crear producto: ' + prodErr.message); setSaving(false); return; }

      // Stock inicial por almacén
      const stockRows = Object.entries(form.stockInicial || {})
        .filter(([_, v]) => parseInt(v) > 0)
        .map(([almacenId, cant]) => ({ sku, almacen_id: almacenId, cantidad: parseInt(cant) || 0, reservado: 0 }));
      if (stockRows.length) {
        // Vía RPC para que el kardex asiente el saldo inicial con su causa (si no, entraría como
        // un ajuste_positivo sin explicación el día que se creó el producto).
        const invErrs = [];
        for (const r of stockRows) {
          const { data: res, error: e } = await window.sb.rpc('inv_ajustar_cantidad', {
            p_sku: sku, p_almacen: r.almacen_id, p_empresa: empresa, p_delta: r.cantidad,
            p_tipo: 'entrada', p_ref_tipo: 'ajuste', p_motivo: 'Saldo inicial del producto',
            p_usuario: window.__ssCurrentUser?.nombre || null,
          });
          if (e || res?.error) invErrs.push(r.almacen_id + ': ' + (e?.message || res.error));
        }
        const invErr = invErrs.length ? { message: invErrs.join(' · ') } : null;
        if (invErr) console.warn('[stock inicial]', invErr);
        for (const r of stockRows) {
          await window.logActivity?.({
            modulo:'inventario', accion:'saldo_inicial',
            entidad_id: sku, entidad_label: form.nombre,
            detalles:{ origen:'saldo_inicial', almacen_destino: r.almacen_id, cantidad: r.cantidad, sku }
          });
        }
      }

      // Seriales iniciales (solo si serializado y hay S/N ingresados)
      if (form.serializado) {
        const garantiaMeses = parseInt(garantiaInicial) || 0;
        const erroresSeriales = [];
        for (const [almacenId, raw] of Object.entries(serialesIniciales)) {
          const lista = (raw || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
          if (lista.length === 0) continue;
          const res = await window.agregarSeriales?.({ sku, almacenId, garantiaMeses, seriales: lista });
          if (res?.error) {
            const alm = getAlmacenes().find(a => a.id === almacenId);
            erroresSeriales.push(`${alm?.nombre || almacenId}: ${res.error.message}`);
          }
        }
        if (erroresSeriales.length > 0) {
          // Producto e inventario ya fueron creados, pero seriales fallaron
          setCreateErr('Producto creado, pero hubo errores con los S/N:\n• ' + erroresSeriales.join('\n• ') + '\n\nPodés registrarlos manualmente desde el detalle del producto.');
          await window.loadAppData?.();
          window.dispatchEvent(new CustomEvent('ss-productos-changed'));
          setSaving(false);
          return;
        }
      }

      if (photoData) saveProductPhoto(sku, photoData);
      window.logActivity?.({
        modulo:'inventario', accion:'crear',
        entidad_id: sku, entidad_label: form.nombre,
        detalles:{ marca: form.marca, categoria: form.categoria, costo: form.costo, base: form.base, serializado: !!form.serializado }
      });
      await window.loadAppData?.();
      window.dispatchEvent(new CustomEvent('ss-productos-changed'));
      onClose();
    } catch (e) {
      setCreateErr('Error inesperado: ' + (e.message || String(e)));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width: 760}}>
        <div className="modal-header">
          <div style={{width: 40, height: 40, borderRadius: 10, background: 'var(--brand-soft)', color: 'var(--brand)', display:'grid', placeItems:'center', overflow:'hidden'}}>
            {photoPreview
              ? <img src={photoPreview} style={{width:'100%',height:'100%',objectFit:'cover'}}/>
              : <Icon name="plus" size={20}/>
            }
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">Nuevo producto</h3>
            <div className="small">Registra un nuevo SKU en el catálogo</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        <div className="modal-body">
          <div className="form-section-title">Foto del producto</div>
          <div style={{display:'flex', alignItems:'center', gap:14, marginBottom:8}}>
            <div
              style={{width:80,height:80,borderRadius:10,border:'2px dashed var(--border)',display:'grid',placeItems:'center',cursor:'pointer',overflow:'hidden',background:'var(--bg-sunken)',flexShrink:0}}
              onClick={()=>fileRef.current?.click()}
            >
              {photoPreview
                ? <img src={photoPreview} style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                : <div style={{textAlign:'center',color:'var(--text-muted)'}}><Icon name="upload" size={22}/><div style={{fontSize:10,marginTop:2}}>Subir</div></div>
              }
            </div>
            <div>
              <div className="small" style={{color:'var(--text-muted)'}}>Haz clic para seleccionar una imagen (JPG, PNG, WEBP).</div>
              {photoPreview && <button className="btn ghost sm" style={{marginTop:4,color:'var(--danger)',fontSize:11}} onClick={()=>{setPhotoPreview(null);setPhotoData(null);}}>Quitar</button>}
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={handlePhoto}/>
          </div>

          <div className="form-section-title mt-3">Información básica</div>
          <div className="grid-2">
            <div>
              <label className="form-label">SKU {reqLblP('sku') || <span style={{color:'var(--danger)'}}>*</span>}</label>
              <input className="input" placeholder="HIK-CAM-4MP-B" value={form.sku} onChange={e=>update('sku', e.target.value.toUpperCase())} style={reqBorderP('sku', form.sku)}/>
            </div>
            {!isHideP('marca') && <div>
              <label className="form-label" style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                <span>Marca {reqLblP('marca')}</span>
                <button type="button" onClick={()=>setShowMarcasMgr(true)} className="btn ghost" style={{padding:'2px 8px', fontSize:11, height:'auto'}}>
                  <Icon name="settings" size={11}/> Administrar
                </button>
              </label>
              <select className="select" value={form.marca} onChange={e=>update('marca', e.target.value)} style={reqBorderP('marca', form.marca)}>
                <option value="">— Seleccionar marca —</option>
                {SSData.marcas.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>}
          </div>
          <div className="mt-3">
            <label className="form-label">Nombre del producto {reqLblP('nombre_inv') || <span style={{color:'var(--danger)'}}>*</span>}</label>
            <input className="input" placeholder="Cámara Bullet 4MP IP IR 30m" value={form.nombre} onChange={e=>update('nombre', e.target.value)} style={reqBorderP('nombre_inv', form.nombre)}/>
          </div>
          {!isHideP('categoria') && <div className="mt-3">
            <label className="form-label">Categoría {reqLblP('categoria')}</label>
            <select className="select" value={form.categoria} onChange={e=>update('categoria', e.target.value)} style={{width:'100%', ...reqBorderP('categoria', form.categoria)}}>
              {getCategorias().map(c => <option key={c}>{c}</option>)}
            </select>
          </div>}

          <div className="form-section-title mt-4">Precios y costos</div>
          <div className="grid-3">
            <div>
              <label className="form-label">Costo USD {reqLblP('costo') || <span style={{color:'var(--danger)'}}>*</span>}</label>
              <input className="input" placeholder="0.00" type="number" step="0.01" value={form.costo} onChange={e=>update('costo', e.target.value)} style={reqBorderP('costo', form.costo)}/>
            </div>
            <div>
              <label className="form-label">Precio base USD {reqLblP('base') || <span style={{color:'var(--danger)'}}>*</span>}</label>
              <input className="input" placeholder="0.00" type="number" step="0.01" value={form.base} onChange={e=>update('base', e.target.value)} style={reqBorderP('base', form.base)}/>
            </div>
            <div>
              <label className="form-label">Margen calculado</label>
              <div className="input" style={{background:'var(--bg-sunken)', display:'flex', alignItems:'center', color: margen === '—' ? 'var(--text-muted)' : (margen > 20 ? 'var(--success)' : margen > 10 ? 'var(--warn)' : 'var(--danger)'), fontWeight: 600}}>{margen}{margen !== '—' && '%'}</div>
            </div>
          </div>
          {form.base > 0 && <div className="small mt-2" style={{color:'var(--text-muted)'}}>Equivalente en Bs: <span className="mono">{fmt.ves(form.base * SSData.tasa.bcv)}</span></div>}

          <div className="form-section-title mt-4">Características</div>
          <div className="grid-3">
            <div>
              <label className="form-label">Peso (kg)</label>
              <input className="input" placeholder="0.5" type="number" step="0.01" value={form.peso} onChange={e=>update('peso', e.target.value)}/>
            </div>
            <div>
              <label className="form-label">Stock mínimo <span className="muted small" title="Dispara la alerta de bajo stock cuando el disponible cae a este nivel o menos. 0 = sin alerta.">(alerta)</span></label>
              <input className="input" placeholder="0" type="number" min="0" step="1" value={form.minimo} onChange={e=>update('minimo', e.target.value)}/>
            </div>
            <div>
              <label className="form-label">Unidad</label>
              <select className="select" value={form.unidad} onChange={e=>update('unidad', e.target.value)}>
                <option>Unidad</option><option>Caja</option><option>Metro</option><option>Rollo</option><option>Paquete</option>
              </select>
            </div>
            <div>
              <label className="form-label">IVA</label>
              <select className="select" value={form.iva} onChange={e=>update('iva', e.target.value)}>
                <option>16% general</option><option>8% reducido</option><option>Exento</option>
              </select>
            </div>
          </div>

          <div style={{marginTop:14, display:'flex', alignItems:'center', gap:10, padding:'10px 12px', border:'1px solid var(--border)', borderRadius:6, cursor:'pointer', userSelect:'none'}}
            onClick={() => update('serializado', !form.serializado)}>
            <div style={{width:36, height:20, borderRadius:10, background: form.serializado ? 'var(--brand)' : 'var(--border)', position:'relative', transition:'background .2s', flexShrink:0}}>
              <div style={{width:16, height:16, borderRadius:'50%', background:'#fff', position:'absolute', top:2, left: form.serializado ? 18 : 2, transition:'left .2s'}}/>
            </div>
            <div>
              <div style={{fontWeight:500, fontSize:13}}>Requiere número de serie</div>
              <div style={{fontSize:11, color:'var(--text-muted)'}}>Activa registro de S/N en entradas y despachos (equipos electrónicos, cámaras, UPS, etc.)</div>
            </div>
          </div>

          <div className="mt-4">
            <EmpresasProductoPicker value={form.empresas} onChange={v => update('empresas', v)}/>
          </div>

          <div className="form-section-title mt-4">Stock inicial por almacén</div>
          <div className="stock-grid">
            {getAlmacenes().map(a => (
              <div key={a.id} className="stock-inp">
                <label>{a.nombre}</label>
                <input className="input" type="number" placeholder="0" value={form.stockInicial[a.id] || ''} onChange={e=>update('stockInicial', {...form.stockInicial, [a.id]: e.target.value})}/>
              </div>
            ))}
          </div>
          <div className="small mt-2">Puedes dejar todos en 0 si vas a cargar stock después vía OC o carga masiva.</div>

          {form.serializado && (
            <div style={{marginTop:16, border:'1px solid var(--brand)', borderRadius:8, overflow:'hidden'}}>
              <div style={{padding:'9px 12px', background:'var(--brand-soft)', display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid var(--brand)'}}>
                <Icon name="check" size={13}/>
                <span style={{fontWeight:600, fontSize:12, textTransform:'uppercase', letterSpacing:0.5, color:'var(--brand)'}}>Números de serie</span>
                <span style={{marginLeft:'auto', fontSize:11, color:'var(--brand)'}}>Opcional — puedes registrarlos ahora o después desde Inventario</span>
              </div>
              <div style={{padding:'12px 12px 8px', display:'flex', flexDirection:'column', gap:12}}>
                <div style={{display:'flex', alignItems:'center', gap:10}}>
                  <label className="form-label" style={{margin:0, whiteSpace:'nowrap'}}>Garantía (meses)</label>
                  {(() => {
                    const PRESETS = ['0','3','6','12','24'];
                    const isCustom = !PRESETS.includes(garantiaInicial);
                    return <>
                      <select className="select" style={{width:130}}
                        value={isCustom ? '__custom__' : garantiaInicial}
                        onChange={e => {
                          if (e.target.value === '__custom__') setGarantiaInicial('');
                          else setGarantiaInicial(e.target.value);
                        }}>
                        <option value="0">Sin garantía</option>
                        <option value="3">3 meses</option>
                        <option value="6">6 meses</option>
                        <option value="12">12 meses</option>
                        <option value="24">24 meses</option>
                        <option value="__custom__">Otro...</option>
                      </select>
                      {isCustom && <input className="input mono" type="number" min="0" style={{width:70}}
                        autoFocus value={garantiaInicial}
                        onChange={e=>setGarantiaInicial(e.target.value)}
                        placeholder="meses"/>}
                    </>;
                  })()}
                  <span className="small muted">aplica a todos los S/N de este lote</span>
                </div>
                <div style={{padding:'8px 10px', background:'var(--bg-sunken)', borderRadius:6, fontSize:11.5, color:'var(--text-muted)', lineHeight:1.5}}>
                  <Icon name="info" size={11}/> Puedes ingresar los S/N ahora o dejarlos vacíos — el sistema los pedirá al momento del despacho físico.
                </div>
                {getAlmacenes().map(a => {
                  const qty = parseInt(form.stockInicial[a.id]) || 0;
                  const raw = serialesIniciales[a.id] || '';
                  const ingresados = raw.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean).length;
                  const completo = qty > 0 && ingresados >= qty;
                  const parcial  = qty > 0 && ingresados > 0 && ingresados < qty;
                  const vacio    = ingresados === 0;
                  return (
                    <div key={a.id} style={{border:'1px solid var(--border)', borderRadius:6, overflow:'hidden'}}>
                      <div style={{padding:'6px 10px', background:'var(--bg-sunken)', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid var(--border)'}}>
                        <span style={{fontWeight:500, fontSize:12}}>{a.nombre}</span>
                        <span style={{
                          fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:10,
                          background: completo ? 'var(--success)15' : parcial ? 'var(--warn)15' : 'var(--border)',
                          color: completo ? 'var(--success)' : parcial ? 'var(--warn)' : 'var(--text-muted)',
                        }}>
                          {qty > 0 ? `${ingresados}/${qty} S/N` : ingresados > 0 ? `${ingresados} S/N` : 'Sin S/N'}
                        </span>
                      </div>
                      <div style={{padding:8}}>
                        <textarea className="input mono" rows={Math.min(Math.max(qty, 2), 5)}
                          value={raw}
                          onChange={e => setSerialesIniciales(prev => ({...prev, [a.id]: e.target.value}))}
                          placeholder={qty > 0
                            ? Array.from({length:Math.min(qty,3)}, (_,i)=>`SN-EQUIPO-00${i+1}`).join('\n') + (qty>3?'\n…':'')
                            : 'SN-A1B2C3\nSN-D4E5F6'}
                          style={{fontSize:12, resize:'vertical', width:'100%'}}/>
                        {qty > 0 && !completo && (
                          <div style={{marginTop:4, fontSize:11, color: vacio ? 'var(--text-muted)' : 'var(--warn)'}}>
                            {vacio
                              ? `${qty} unidad${qty!==1?'es':''} — S/N se solicitarán en el despacho`
                              : `Faltan ${qty - ingresados} S/N — los restantes se pedirán en el despacho`}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {createErr && (
            <div style={{marginTop:14, padding:'10px 14px', background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:6, color:'#b91c1c', fontSize:12.5, whiteSpace:'pre-wrap'}}>
              {createErr}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn secondary">Guardar y crear otro</button>
          <button className="btn primary" disabled={saving || !prodValid || !form.sku || !form.nombre} onClick={handleCreate}>
            <Icon name="check" size={14}/>{saving ? 'Creando…' : 'Crear producto'}
          </button>
        </div>
      </div>

      {showMarcasMgr && <MarcasManager onClose={()=>setShowMarcasMgr(false)} onPicked={(nombre)=>{ update('marca', nombre); setShowMarcasMgr(false); }}/>}
    </div>
  );
}

// ======= Marcas Manager (admin de marcas en Supabase) =======
function MarcasManager({ onClose, onPicked }) {
  const [list, setList]   = useState([]);
  const [loading, setLoad]= useState(true);
  const [nuevo, setNuevo] = useState('');
  const [editId, setEditId] = useState(null);
  const [editVal, setEditVal] = useState('');
  const [busy, setBusy]   = useState(false);

  async function reload() {
    setLoad(true);
    const { data } = await window.loadMarcas();
    setList(data || []);
    setLoad(false);
  }
  useEffect(() => { reload(); }, []);

  async function handleCreate() {
    const n = nuevo.trim();
    if (!n) return;
    if (list.some(m => m.nombre.toLowerCase() === n.toLowerCase())) { alert('Esa marca ya existe'); return; }
    setBusy(true);
    const { error } = await window.createMarca(n);
    setBusy(false);
    if (error) { alert('Error: ' + (error.message || error)); return; }
    setNuevo('');
    await reload();
    // refrescar lista global SSData.marcas (dirigido, sin recargar todo el catálogo)
    const { data } = await window.loadMarcas();
    window.SSData.marcas = data || [];
    window.dispatchEvent(new Event('ss-data-extra-loaded'));
  }
  async function handleSaveEdit() {
    const n = editVal.trim();
    if (!n) return;
    const orig = list.find(m => m.id === editId);
    if (!orig) return;
    if (n === orig.nombre) { setEditId(null); return; }
    setBusy(true);
    const { error } = await window.renameMarca(editId, orig.nombre, n);
    setBusy(false);
    if (error) { alert('Error: ' + (error.message || error)); return; }
    setEditId(null);
    await reload();
    const { data } = await window.loadMarcas();
    window.SSData.marcas = data || [];
    window.dispatchEvent(new Event('ss-data-extra-loaded'));
  }
  async function handleDelete(m) {
    if (!confirm(`¿Eliminar la marca "${m.nombre}"?`)) return;
    setBusy(true);
    const { error } = await window.deleteMarca(m.id, m.nombre);
    setBusy(false);
    if (error) { alert(typeof error === 'string' ? error : (error.message || JSON.stringify(error))); return; }
    // deleteMarca solo permite borrar marcas SIN productos → restaurar = re-insertar la fila.
    window.ssTrash?.add('marca', m.nombre, m);
    await reload();
    const { data } = await window.loadMarcas();
    window.SSData.marcas = data || [];
    window.dispatchEvent(new Event('ss-data-extra-loaded'));
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{maxWidth:520}} onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Administrar marcas</h3>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          <div style={{display:'flex', gap:8, marginBottom:14}}>
            <input className="input" placeholder="Nombre de la nueva marca…" value={nuevo}
              onChange={e=>setNuevo(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter') handleCreate(); }}
              style={{flex:1}} disabled={busy}/>
            {window.canUser?.('crear','inventory') !== false && (
            <button className="btn primary" onClick={handleCreate} disabled={busy || !nuevo.trim()}>
              <Icon name="plus" size={14}/> Agregar
            </button>
            )}
          </div>
          <div style={{border:'1px solid var(--border)', borderRadius:8, maxHeight:340, overflow:'auto'}}>
            {loading ? <div style={{padding:24, textAlign:'center', color:'var(--text-muted)'}}>Cargando…</div>
              : list.length === 0 ? <div style={{padding:24, textAlign:'center', color:'var(--text-muted)'}}>Sin marcas. Crea la primera arriba.</div>
              : list.map(m => (
                <div key={m.id} style={{display:'flex', alignItems:'center', gap:8, padding:'8px 12px', borderBottom:'1px solid var(--border)'}}>
                  {editId === m.id ? (
                    <>
                      <input className="input" value={editVal} onChange={e=>setEditVal(e.target.value)}
                        onKeyDown={e=>{ if(e.key==='Enter') handleSaveEdit(); if(e.key==='Escape') setEditId(null); }}
                        style={{flex:1}} autoFocus disabled={busy}/>
                      <button className="btn primary sm" onClick={handleSaveEdit} disabled={busy}>Guardar</button>
                      <button className="btn ghost sm" onClick={()=>setEditId(null)} disabled={busy}>×</button>
                    </>
                  ) : (
                    <>
                      <span style={{flex:1, fontSize:14}}>{m.nombre}</span>
                      {onPicked && <button className="btn secondary sm" onClick={()=>onPicked(m.nombre)} title="Usar esta marca">Usar</button>}
                      {window.canUser?.('editar','inventory') !== false && (
                      <button className="btn ghost sm" onClick={()=>{ setEditId(m.id); setEditVal(m.nombre); }} title="Renombrar">
                        <Icon name="edit" size={12}/>
                      </button>
                      )}
                      {window.canUser?.('eliminar','inventory') !== false && (
                      <button className="btn ghost sm" onClick={()=>handleDelete(m)} title="Eliminar" style={{color:'var(--danger)'}}>
                        <Icon name="trash" size={12}/>
                      </button>
                      )}
                    </>
                  )}
                </div>
              ))
            }
          </div>
          <div className="small" style={{marginTop:10, color:'var(--text-muted)'}}>
            Las marcas se guardan en Supabase (tabla <code>marcas</code>). Renombrarlas actualiza también todos los productos que las usan.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn primary" onClick={onClose}>Listo</button>
        </div>
      </div>
    </div>
  );
}

// ======= Modal de carga masiva (compactada desde BulkPage) =======
function BulkImportModal({ onClose }) {
  const [drop, setDrop] = useState(false);
  const [file, setFile] = useState(null);
  const [tipo, setTipo] = useState('productos');

  function simulate() {
    setFile({ name: tipo === 'productos' ? 'productos_abril.xlsx' : tipo === 'stock' ? 'inventario_abril.xlsx' : 'precios_abril.xlsx', size: 128, rows: Math.floor(Math.random()*400) + 200 });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width: 820}}>
        <div className="modal-header">
          <div style={{width: 40, height: 40, borderRadius: 10, background: 'var(--brand-soft)', color:'var(--brand)', display:'grid', placeItems:'center'}}>
            <Icon name="upload" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">Carga masiva</h3>
            <div className="small">Importa productos, inventarios o listas de precios desde Excel o CSV</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        <div className="modal-body">
          <div className="form-section-title">Tipo de carga</div>
          <div className="grid-3">
            {[
              {id:'productos',t:'Productos', s:'Crea o actualiza SKUs', i:'inventory'},
              {id:'stock', t:'Inventario', s:'Ajusta stock por almacén', i:'warehouse'},
              {id:'precios', t:'Precios', s:'Actualiza listas', i:'price'}
            ].map(o => (
              <div key={o.id} onClick={()=>setTipo(o.id)} className="card" style={{padding: 12, cursor: 'pointer', border: tipo === o.id ? '2px solid var(--brand)' : '1px solid var(--border)', background: tipo === o.id ? 'var(--brand-soft)' : 'var(--bg-elev)'}}>
                <div className="flex items-center gap-2">
                  <Icon name={o.i} size={16}/>
                  <div>
                    <div style={{fontSize: 13, fontWeight: 600}}>{o.t}</div>
                    <div className="small">{o.s}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {!file && (
            <div
              onDragOver={e=>{e.preventDefault(); setDrop(true);}}
              onDragLeave={()=>setDrop(false)}
              onDrop={e=>{e.preventDefault(); setDrop(false); simulate();}}
              onClick={simulate}
              style={{
                marginTop: 16,
                border: '2px dashed ' + (drop ? 'var(--brand)' : 'var(--border-strong)'),
                borderRadius: 12,
                padding: 32,
                textAlign: 'center',
                background: drop ? 'var(--brand-soft)' : 'var(--bg-sunken)',
                cursor: 'pointer',
              }}>
              <div style={{width: 44, height: 44, borderRadius: 10, background: 'var(--bg-elev)', color: 'var(--text-muted)', display:'grid', placeItems:'center', margin: '0 auto 10px'}}>
                <Icon name="upload" size={20}/>
              </div>
              <div style={{fontSize: 14, fontWeight: 500}}>Arrastra tu archivo aquí o haz clic para buscar</div>
              <div className="small mt-2">Acepta .xlsx, .xls, .csv · máx 10MB · hasta 5,000 filas</div>
              <button className="btn ghost sm mt-3" onClick={e=>{e.stopPropagation();}}><Icon name="download" size={12}/>Descargar plantilla</button>
            </div>
          )}

          {file && (
            <>
              <div className="card mt-4" style={{padding: 12}}>
                <div className="flex items-center gap-3">
                  <div style={{width: 36, height: 36, borderRadius: 8, background:'var(--success-soft)', color:'var(--success)', display:'grid', placeItems:'center'}}><Icon name="doc" size={16}/></div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:500, fontSize: 13}}>{file.name}</div>
                    <div className="small">{file.size} KB · {file.rows} filas detectadas</div>
                  </div>
                  <div className="flex gap-2">
                    <span className="chip green">{file.rows - 42} válidas</span>
                    <span className="chip amber">38 advertencias</span>
                    <span className="chip red">4 errores</span>
                  </div>
                  <button className="btn ghost sm" onClick={()=>setFile(null)}><Icon name="x" size={14}/></button>
                </div>
              </div>

              <div className="tbl-wrap mt-3">
                <div className="tbl-toolbar"><strong style={{fontSize:13}}>Vista previa</strong><span className="ml-auto small">Mostrando 5 de {file.rows}</span></div>
                <table className="tbl">
                  <thead><tr><th></th><th>SKU</th><th>Nombre</th><th>Marca</th><th className="num">Costo</th><th className="num">Base</th><th>Estado</th></tr></thead>
                  <tbody>
                    {[
                      {sku:'HIK-CAM-4MP-N',n:'Cámara 4MP IP Nocturna',m:'HIKVISION',c:42.00,b:62.00,e:'nuevo'},
                      {sku:'DAH-SW-16',n:'Switch DAHUA 16 puertos',m:'DAHUA',c:58.00,b:84.00,e:'nuevo'},
                      {sku:'HIK-DVR-8C2MP',n:'DVR 8CH 2MP',m:'HIKVISION',c:54.20,b:76.05,e:'actualizar'},
                      {sku:'TPL-AX73',n:'Router TP-Link AX73',m:'TP-LINK',c:75.00,b:108.00,e:'nuevo'},
                      {sku:'BAD-ROW-01',n:'',m:'',c:0,b:0,e:'error'},
                    ].map((r,i) => (
                      <tr key={i} style={{background: r.e==='error'?'var(--danger-soft)':''}}>
                        <td>
                          {r.e==='nuevo' && <Icon name="plus" size={14}/>}
                          {r.e==='actualizar' && <Icon name="edit" size={14}/>}
                          {r.e==='error' && <Icon name="x" size={14}/>}
                        </td>
                        <td className="mono-cell">{r.sku}</td>
                        <td>{r.n || <span style={{color:'var(--danger)',fontStyle:'italic'}}>Falta</span>}</td>
                        <td><span className="chip neutral">{r.m||'—'}</span></td>
                        <td className="num">{r.c ? fmt.usd(r.c) : '—'}</td>
                        <td className="num">{r.b ? fmt.usd(r.b) : '—'}</td>
                        <td>
                          {r.e==='nuevo' && <span className="chip green">Nuevo</span>}
                          {r.e==='actualizar' && <span className="chip blue">Actualizar</span>}
                          {r.e==='error' && <span className="chip red">Error</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          {file && <button className="btn secondary">Descargar errores</button>}
          <button className="btn primary" disabled={!file} onClick={onClose}><Icon name="check" size={14}/>Importar {file ? file.rows - 4 : ''} {file ? 'registros' : ''}</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Movimientos de Inventario
// ══════════════════════════════════════════════════════════════
// De dónde vino el cambio — separado de la DIRECCIÓN (entrada/salida, ver `allMovs`). `ref_tipo`
// ya trae casi todo (kardex_ctx lo declara por transacción, ver CLAUDE.md "Kardex de inventario");
// 'devolucion' es el único ambiguo (lo usan tanto la devolución DE cliente migrada de Odoo —
// entrada— como `devolver_oc`, la devolución A proveedor —salida—), así que ahí desempata la
// dirección ya calculada.
const ORIGEN_LABEL = {
  despacho: 'Despacho', transferencia: 'Transferencia', ajuste: 'Ajuste manual',
  devolucion_cliente: 'Devolución de cliente', devolucion_proveedor: 'Devolución a proveedor',
  recepcion: 'Recepción de compra', orden: 'Orden', importacion: 'Importación', otro: 'Otro',
};
const ORIGEN_COLOR = {
  despacho: 'var(--danger)', transferencia: 'var(--brand)', ajuste: 'oklch(0.65 0.15 200)',
  devolucion_cliente: 'var(--accent)', devolucion_proveedor: 'var(--accent)',
  recepcion: 'var(--success)', orden: 'var(--text-muted)', importacion: 'var(--success)', otro: 'var(--text-muted)',
};
function derivarOrigen(refTipoRaw, tipoRaw, direccion) {
  const rt = (refTipoRaw || '').toLowerCase();
  if (rt === 'despacho')   return 'despacho';
  if (rt === 'traslado')   return 'transferencia';
  if (rt === 'ajuste')     return 'ajuste';
  if (rt === 'devolucion') return direccion === 'salida' ? 'devolucion_proveedor' : 'devolucion_cliente';
  if (rt === 'recepcion')  return 'recepcion';
  if (rt === 'orden')      return 'orden';
  // Sin ref_tipo: legado migrado de Odoo, donde el propio `tipo` ya decía el motivo.
  if (tipoRaw === 'transferencia') return 'transferencia';
  if (tipoRaw === 'devolucion')    return 'devolucion_cliente';
  if (tipoRaw === 'ajuste_positivo' || tipoRaw === 'ajuste_negativo') return 'ajuste';
  return 'otro';
}

window.MovimientosInventarioPage =
function MovimientosInventarioPage({ onBack }) {
  const today     = window.localDateStr();
  const monthStart = (() => { const d = new Date(today + 'T12:00:00'); d.setDate(1); return window.localDateStr(d); })();
  const [periodo,  setPeriodo]  = useState('mes');       // hoy|ayer|semana|mes|exacta|rango (default mes: el histórico migrado no cae en "hoy")
  const [fechaEx,  setFechaEx]  = useState(today);
  const [fechaDesde, setFechaDesde] = useState(monthStart);  // rango arbitrario
  const [fechaHasta, setFechaHasta] = useState(today);
  const [logs,     setLogs]     = useState(null);        // null = loading
  const [localDocs, setLocalDocs] = useState(null);      // null = loading; { devs:[] }
  const [kardex,   setKardex]   = useState(null);        // filas de movimientos_inventario (tabla histórica)
  // Recordados (el período NO: un rango viejo pegado haría creer que no hay movimientos nuevos).
  const [search,   setSearch]   = window.usePersistedState('ss-movimientos-f-search', '');
  const [tipoF,    setTipoF]    = window.usePersistedState('ss-movimientos-f-tipo', '');
  const [origenF,  setOrigenF]  = window.usePersistedState('ss-movimientos-f-origen', '');
  const [almF,     setAlmF]     = window.usePersistedState('ss-movimientos-f-almacen', '');
  const [page,     setPage]     = useState(1);
  const [groupBy,  setGroupBy]  = window.usePersistedState('ss-movimientos-f-group', '');
  const [expanded, setExpanded] = useState(new Set());
  const [PAGE_SZ, setPageSize] = useState(() => {
    const v = parseInt(localStorage.getItem('ss-movimientos-pagesize'));
    return [50,100,200].includes(v) ? v : 50;
  });
  useEffect(() => { localStorage.setItem('ss-movimientos-pagesize', String(PAGE_SZ)); }, [PAGE_SZ]);

  // El kardex referencia varias cosas en `ref_documento`, no solo documentos del flujo: en un
  // traslado es la transferencia y en un ajuste no hay nada. Solo estos tres tipos viven en
  // `documentos` y por lo tanto se pueden abrir (es el mismo criterio que usa la resolución de
  // cliente por documento, más arriba en este archivo).
  const DOC_REF_TIPOS = ['despacho', 'factura', 'orden'];
  const [abriendoDoc, setAbriendoDoc] = useState(null);
  async function abrirDocumento(refDoc) {
    if (!refDoc || abriendoDoc) return;
    setAbriendoDoc(refDoc);
    try {
      const ok = await window.abrirDocumentoPorId?.(refDoc);
      // Si no está, se dice: el kardex migrado puede referenciar documentos que se borraron
      // después, y dejar el botón "cargando" para siempre sería peor que avisar.
      if (!ok) alert(`No se encontró el documento ${refDoc} en el sistema.`);
    } finally { setAbriendoDoc(null); }
  }

  // Fuente principal = tabla movimientos_inventario (kardex histórico migrado, 84k filas).
  // Se carga SOLO el rango del periodo elegido (no todo el histórico). actividad_log se
  // mantiene para movimientos generados por la app tras la migración (aún no en la tabla).
  // Recarga al cambiar el periodo/fecha.
  useEffect(() => {
    const e = window.currentEmpresa || 'demo1';
    const d = new Date(today + 'T12:00:00'); let desde, hasta;
    if (periodo === 'ayer')        { const y = new Date(d); y.setDate(y.getDate()-1); desde = hasta = window.localDateStr(y); }
    else if (periodo === 'semana') { const s = new Date(d); s.setDate(s.getDate()-6); desde = window.localDateStr(s); hasta = today; }
    else if (periodo === 'mes')    { const s = new Date(d); s.setDate(1); desde = window.localDateStr(s); hasta = today; }
    else if (periodo === 'exacta') { desde = hasta = fechaEx; }
    else if (periodo === 'rango')  { desde = fechaDesde; hasta = fechaHasta; }
    else                           { desde = hasta = today; }
    setKardex(null); setLogs(null);
    Promise.all([
      window.fetchActivityLog?.({ modulo: 'inventario', limit: 2000 }),
      window.fetchAll(() => window.sb.from('movimientos_inventario').select('*').eq('empresa_id', e).gte('fecha', desde).lte('fecha', hasta + 'T23:59:59').order('fecha', { ascending: false })),
      window.sb.from('devoluciones').select('*').eq('empresa_id', e).gte('fecha', desde).order('fecha', { ascending: false }),
    ]).then(([actLog, kardexRes, dev]) => {
      setLogs(actLog || []);
      setKardex((kardexRes && kardexRes.data) || []);   // fetchAll devuelve { data: [...] }
      setLocalDocs({ devs: (dev && dev.data) || [] });
    }).catch(err => { console.warn('[Movimientos] carga:', err?.message || err); setKardex([]); setLogs([]); setLocalDocs({ devs: [] }); });
  }, [periodo, fechaEx, fechaDesde, fechaHasta, today]);

  // ── Build unified movement list from all sources ──────────────
  const allMovs = useMemo(() => {
    const arr = [];
    const almById = id => (SSData.almacenes || []).find(a => a.id === id);
    const prodBySku = sku => (SSData.productos || []).find(p => p.sku === sku);

    // 1. Kardex (tabla movimientos_inventario) — fuente histórica principal migrada.
    // `tipo` acá es SOLO dirección física (entrada/salida) — antes mezclaba dirección y motivo
    // (p.ej. "transferencia"/"devolución"/"ajuste" pisaban la dirección real), lo que impedía
    // filtrar/agrupar por el motivo sin perder la columna de dirección. El motivo/origen ahora
    // vive aparte en `origen` (derivado de `ref_tipo`, ver `derivarOrigen` más abajo).
    for (const m of (kardex || [])) {
      const t = m.tipo; let tipo, signo;
      // Legado migrado de Odoo: 'devolucion' (devolución DE cliente → entra) y 'transferencia'
      // (traspaso en una sola fila) nunca los escribe el código actual (ver kardex_ctx), solo
      // están en las 84k filas migradas — ahí la dirección real siempre fue "entra".
      if (t === 'salida' || t === 'ajuste_negativo') { tipo = 'salida'; signo = -1; }
      else                                           { tipo = 'entrada'; signo = 1; }
      const origen = derivarOrigen(m.ref_tipo, t, tipo);
      const almo = almById(m.almacen_origen), almd = almById(m.almacen_destino);
      arr.push({
        id:       'MI-' + m.id,
        fecha:    (m.fecha || '').slice(0, 10),
        tipo,
        origen,
        sku:      m.sku,
        nombre:   m.producto_nombre || prodBySku(m.sku)?.nombre || m.sku,
        cantidad: signo * Math.abs(Number(m.cantidad) || 0),
        motivo:   m.ref_documento || m.motivo || '—',
        almacen:  (t === 'transferencia' && almo && almd) ? (almo.nombre + ' → ' + almd.nombre) : (almo?.nombre || almd?.nombre || '—'),
        usuario:  m.usuario || '—',
        ref:      m.ref_documento || '—',
        refTipo:  (m.ref_tipo || '').toLowerCase(),
        refDoc:   m.ref_documento || '',
      });
    }

    // (Ventas y devoluciones ya están en el kardex; no se re-derivan de documentos.)

    // 2. actividad_log (movimientos generados por la app tras la migración)
    for (const ev of (logs || [])) {
      const det = ev.detalles || {};
      const skus = det.sku ? [det.sku] : (det.skus || []);
      if (!skus.length) continue;
      for (const sku of skus) {
        const rawQty = Number(det.cantidad) || 0;
        let tipo, origen, cantidad, motivo;
        if (det.origen === 'importacion' || det.almacen_origen === 'IMPORT') {
          tipo = 'entrada'; origen = 'importacion'; cantidad = Math.abs(rawQty);
          motivo = 'Importación → ' + (det.almacen_destino || '—');
        } else if (det.origen === 'ajuste_manual') {
          tipo = 'entrada'; origen = 'ajuste'; cantidad = Math.abs(rawQty);
          motivo = det.motivo_label || det.motivo || '—';
        } else if (det.destino === 'ajuste_manual') {
          tipo = 'salida'; origen = 'ajuste'; cantidad = -Math.abs(rawQty);
          motivo = det.motivo_label || det.motivo || '—';
        } else if (ev.accion === 'transferencia') {
          // Legado (antes del kardex automático): un solo evento sin dirección propia, igual que
          // el 'transferencia' migrado de Odoo — se cuenta como entrada, ver nota arriba.
          tipo = 'entrada'; origen = 'transferencia'; cantidad = rawQty;
          motivo = (det.almacen_origen || '—') + ' → ' + (det.almacen_destino || '—');
        } else if (det.origen === 'orden_compra') {
          tipo = 'entrada'; origen = 'recepcion'; cantidad = Math.abs(rawQty);
          motivo = det.ref || '—';
        } else if (ev.accion === 'precio_actualizado') {
          continue; // cambios de precio no son movimientos de inventario
        } else {
          tipo = rawQty < 0 ? 'salida' : 'entrada'; origen = 'ajuste'; cantidad = rawQty;
          motivo = det.notas || ev.accion || 'Ajuste';
        }
        const prod = prodBySku(sku);
        arr.push({
          id:       (ev.id || ev.created_at) + '-' + sku,
          fecha:    ev.created_at ? window.localDateStr(new Date(ev.created_at)) : '',
          tipo,
          origen,
          sku,
          nombre:   prod?.nombre || sku,
          cantidad,
          motivo,
          almacen:  almById(det.almacen_destino_id)?.nombre || det.almacen_destino || '—',
          usuario:  ev.usuario_nombre || '—',
          ref:      ev.entidad_id || '—',
          refTipo:  '',
          refDoc:   ev.entidad_id || '',
        });
      }
    }

    return arr.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  }, [kardex, logs]);

  // ── Date range filter ──────────────────────────────────────────
  const dateRange = useMemo(() => {
    const d = new Date(today + 'T12:00:00');
    if (periodo === 'hoy')    return { desde: today, hasta: today };
    if (periodo === 'ayer')   { const y = new Date(d); y.setDate(y.getDate()-1); const s = window.localDateStr(y); return { desde:s, hasta:s }; }
    if (periodo === 'semana') { const s = new Date(d); s.setDate(s.getDate()-6); return { desde:window.localDateStr(s), hasta:today }; }
    if (periodo === 'mes')    { const s = new Date(d); s.setDate(1); return { desde:window.localDateStr(s), hasta:today }; }
    if (periodo === 'exacta') return { desde: fechaEx, hasta: fechaEx };
    if (periodo === 'rango')  return { desde: fechaDesde, hasta: fechaHasta };
    return { desde: today, hasta: today };
  }, [periodo, fechaEx, fechaDesde, fechaHasta, today]);

  const periodoLabel = {
    hoy: 'Hoy, ' + new Date(today+'T12:00:00').toLocaleDateString('es-VE',{day:'2-digit',month:'long',year:'numeric'}),
    ayer: 'Ayer',
    semana: 'Últimos 7 días',
    mes: 'Este mes',
    exacta: 'Fecha: ' + new Date(fechaEx+'T12:00:00').toLocaleDateString('es-VE',{day:'2-digit',month:'long',year:'numeric'}),
    rango: 'Del ' + new Date(fechaDesde+'T12:00:00').toLocaleDateString('es-VE',{day:'2-digit',month:'short',year:'numeric'}) + ' al ' + new Date(fechaHasta+'T12:00:00').toLocaleDateString('es-VE',{day:'2-digit',month:'short',year:'numeric'}),
  }[periodo];

  // ── Apply all filters ─────────────────────────────────────────
  const filtered = useMemo(() => {
    return allMovs.filter(m => {
      if (m.fecha < dateRange.desde || m.fecha > dateRange.hasta) return false;
      if (tipoF   && m.tipo   !== tipoF) return false;
      if (origenF && m.origen !== origenF) return false;
      if (almF  && m.almacen !== almF) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!m.sku.toLowerCase().includes(q) && !m.nombre.toLowerCase().includes(q) && !m.motivo.toLowerCase().includes(q) && !m.usuario.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [allMovs, dateRange, tipoF, origenF, almF, search]);

  // ── Stats ─────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let entradas = 0, salidas = 0, transferencias = 0;
    filtered.forEach(m => {
      if (m.tipo === 'entrada') entradas += Math.abs(m.cantidad);
      else if (m.tipo === 'salida') salidas += Math.abs(m.cantidad);
      else if (m.tipo === 'transferencia') transferencias++;
    });
    return { entradas, salidas, transferencias, total: filtered.length };
  }, [filtered]);

  const almacenes  = [...new Set((SSData.almacenes || []).map(a => a.nombre))];
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SZ));
  const paginated  = filtered.slice((page-1)*PAGE_SZ, page*PAGE_SZ);

  // Resolución despacho→factura para "Agrupar por factura": los movimientos de inventario
  // referencian el DESPACHO (la salida física), no la factura; la factura se resuelve por el
  // raiz_id compartido de la cadena. Se cachea por despacho y se pide a Supabase en bloques.
  const [facturaByDespacho, setFacturaByDespacho] = useState({});
  useEffect(() => {
    if (groupBy !== 'factura') return;
    const despIds = [...new Set(filtered.filter(m => (m.refTipo || '').includes('despacho') && m.refDoc).map(m => m.refDoc))];
    const pending = despIds.filter(id => !(id in facturaByDespacho));
    if (!pending.length) return;
    let alive = true;
    (async () => {
      const acc = {};
      for (let i = 0; i < pending.length; i += 300) {
        const chunk = pending.slice(i, i + 300);
        const { data: desps } = await window.sb.from('documentos').select('id, raiz_id').in('id', chunk);
        const raizByDesp = {}; const raices = new Set();
        (desps || []).forEach(d => { raizByDesp[d.id] = d.raiz_id; if (d.raiz_id) raices.add(d.raiz_id); });
        const facByRaiz = {};
        if (raices.size) {
          const { data: facs } = await window.sb.from('documentos').select('id, raiz_id, estado').eq('tipo', 'factura').in('raiz_id', [...raices]);
          (facs || []).forEach(f => {
            const cur = facByRaiz[f.raiz_id];
            if (!cur || (cur.estado === 'cancelada' && f.estado !== 'cancelada')) facByRaiz[f.raiz_id] = f;
          });
        }
        chunk.forEach(did => { const r = raizByDesp[did]; acc[did] = (r && facByRaiz[r]) ? facByRaiz[r].id : null; });
      }
      if (alive) setFacturaByDespacho(prev => ({ ...prev, ...acc }));
    })();
    return () => { alive = false; };
  }, [groupBy, filtered]);

  // ── Grouped data ─────────────────────────────────────────────
  const groups = useMemo(() => {
    if (!groupBy) return null;
    const isDoc = groupBy === 'factura' || groupBy === 'despacho';
    const sinKey = groupBy === 'factura' ? '(Sin factura)' : '(Sin nota de despacho)';
    const keyFn = m => {
      if (groupBy === 'producto') return (m.sku + ' — ' + m.nombre);
      if (groupBy === 'almacen')  return (m.almacen || '—');
      if (groupBy === 'usuario')  return (m.usuario || '—');
      if (groupBy === 'origen')   return ORIGEN_LABEL[m.origen] || 'Otro';
      if (groupBy === 'despacho') return ((m.refTipo || '').includes('despacho') && m.refDoc) ? m.refDoc : sinKey;
      // factura: resolver desde el despacho referenciado (comparten raiz_id)
      if ((m.refTipo || '').includes('despacho') && m.refDoc) {
        const fac = facturaByDespacho[m.refDoc];
        if (fac) return fac;
        if (m.refDoc in facturaByDespacho) return sinKey;   // resuelto: no tiene factura
        return m.refDoc;                                     // provisional mientras resuelve
      }
      return sinKey;
    };
    const map = new Map();
    for (const m of filtered) {
      const k = keyFn(m);
      if (!map.has(k)) map.set(k, { key: k, movs: [], entradas: 0, salidas: 0 });
      const g = map.get(k);
      g.movs.push(m);
      if (m.cantidad > 0) g.entradas += m.cantidad;
      else if (m.cantidad < 0) g.salidas += Math.abs(m.cantidad);
    }
    const out = [...map.values()].sort((a, b) => b.movs.length - a.movs.length);
    // Al agrupar por documento, empujar el grupo "(Sin …)" al final
    if (isDoc) out.sort((a, b) => (a.key === sinKey ? 1 : 0) - (b.key === sinKey ? 1 : 0));
    return out;
  }, [filtered, groupBy, facturaByDespacho]);

  // Puramente dirección física ahora — el motivo/origen vive en ORIGEN_LABEL/ORIGEN_COLOR (arriba).
  const tipoColor = { entrada:'var(--success)', salida:'var(--danger)' };
  const tipoLabel = { entrada:'Entrada', salida:'Salida' };

  function fmtDate(s) {
    if (!s) return '—';
    try { return new Date(s+'T12:00:00').toLocaleDateString('es-VE',{day:'2-digit',month:'short',year:'numeric'}); } catch(e) { return s; }
  }

  // ── Reporte: PDF o Excel, del período que se elija ───────────────────────────
  // El PDF lo arma window.generateMovimientosPDF (pdf.jsx, jsPDF + pdf.save): antes esto volcaba
  // HTML a una ventana nueva y disparaba window.print(), que abria el dialogo de impresion en vez
  // de descargar el archivo.
  //
  // La data se pide por período (ver el fetch de arriba), así que el reporte no puede generarse
  // sobre un período distinto del que está en pantalla sin recargar: al elegir uno se cambia el
  // filtro y se deja pendiente el pedido; el efecto de abajo emite el archivo cuando llegó esa data.
  // Se espera comparando el RANGO (`desde`/`hasta`) y no el nombre del período: con un rango
  // arbitrario "rango" ya podía estar seleccionado con otras fechas y el reporte salía con los
  // movimientos viejos.
  const [reportOpen, setReportOpen]       = useState(false);
  const [pendingReport, setPendingReport] = useState(null);   // { desde, hasta, formato, label }
  // Formato y rango del modal. El rango arranca en lo que está en pantalla: lo más común es querer
  // exactamente eso, y así el modal no obliga a reescribir dos fechas que ya se eligieron.
  const [repFormato, setRepFormato] = useState('pdf');        // pdf | xlsx
  const [repDesde,   setRepDesde]   = useState(dateRange.desde);
  const [repHasta,   setRepHasta]   = useState(dateRange.hasta);
  useEffect(() => { if (reportOpen) { setRepDesde(dateRange.desde); setRepHasta(dateRange.hasta); } }, [reportOpen]);

  // Las columnas del Excel: las mismas que la tabla, más el signo de la cantidad (que en la pantalla
  // es color y acá tiene que ser un número con su signo, para poder sumar la columna).
  const COLS_XLSX = [
    { key:'fecha',    label:'Fecha' },
    { key:'tipo',     label:'Tipo',     format: v => tipoLabel[v] || v },
    { key:'sku',      label:'SKU' },
    { key:'nombre',   label:'Producto' },
    { key:'cantidad', label:'Cantidad' },
    { key:'almacen',  label:'Almacén' },
    { key:'motivo',   label:'Motivo / Referencia' },
    { key:'ref',      label:'Documento' },
    { key:'usuario',  label:'Usuario' },
  ];

  useEffect(() => {
    if (!pendingReport) return;
    // El filtro todavía no se movió al rango pedido.
    if (dateRange.desde !== pendingReport.desde || dateRange.hasta !== pendingReport.hasta) return;
    if (kardex === null || logs === null) return;   // sigue cargando el rango pedido
    const p = pendingReport;
    setPendingReport(null);
    if (p.formato === 'xlsx') {
      // Dos hojas: el resumen (lo que en el PDF es el encabezado) y el detalle. Con una sola hoja
      // los totales se perderían entre miles de filas.
      window.exportSheetsToXLSX?.([
        { name:'Resumen', rows:[
            { concepto:'Período',        valor:p.label },
            { concepto:'Movimientos',    valor:stats.total },
            { concepto:'Entradas (u)',   valor:stats.entradas },
            { concepto:'Salidas (u)',    valor:stats.salidas },
            { concepto:'Transferencias', valor:stats.transferencias },
            { concepto:'Empresa',        valor:window.currentEmpresa || 'demo1' },
          ], columns:[{ key:'concepto', label:'Concepto' }, { key:'valor', label:'Valor' }] },
        { name:'Movimientos', rows:filtered, columns:COLS_XLSX },
      ], `movimientos-inventario-${p.desde}_${p.hasta}`);
    } else {
      window.generateMovimientosPDF?.(filtered, {
        periodoLabel: p.label,
        stats,
        empresaId: window.currentEmpresa || 'demo1',
      });
    }
  }, [pendingReport, dateRange, kardex, logs, filtered, stats]);

  // Un preset (hoy / ayer / este mes) o el rango tecleado en el modal.
  function pedirReporte(p) {
    setReportOpen(false);
    if (p === 'rango') {
      const desde = repDesde <= repHasta ? repDesde : repHasta;   // si están al revés, se ordenan
      const hasta = repDesde <= repHasta ? repHasta : repDesde;
      setPeriodo('rango'); setFechaDesde(desde); setFechaHasta(hasta); setPage(1);
      setPendingReport({ desde, hasta, formato: repFormato,
        label: 'Del ' + fmtDate(desde) + ' al ' + fmtDate(hasta) });
      return;
    }
    const d = new Date(today + 'T12:00:00');
    let desde = today, hasta = today;
    if (p === 'ayer') { const y = new Date(d); y.setDate(y.getDate()-1); desde = hasta = window.localDateStr(y); }
    else if (p === 'mes') { const s = new Date(d); s.setDate(1); desde = window.localDateStr(s); hasta = today; }
    setPeriodo(p); setPage(1);
    setPendingReport({ desde, hasta, formato: repFormato, label: { hoy:'Hoy', ayer:'Ayer', mes:'Este mes' }[p] || p });
  }

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header">
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <button className="icon-btn" onClick={onBack} title="Volver al inventario">
            <Icon name="chevronL" size={18}/>
          </button>
          <div>
            <h1 className="page-title">Movimientos de Inventario</h1>
            <div className="page-subtitle">{periodoLabel} · {filtered.length} movimiento{filtered.length!==1?'s':''}</div>
          </div>
        </div>
        <div className="page-actions">
          <button className="btn primary" onClick={() => setReportOpen(true)}>
            <Icon name="download" size={14}/>Reporte
          </button>
        </div>
      </div>

      {/* KPI row — compacto para dar más espacio a la tabla */}
      <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
        {[
          { lbl:'Total', val:stats.total, color:'var(--text)' },
          { lbl:'Entradas', val:'+'+stats.entradas, color:'var(--success)' },
          { lbl:'Salidas', val:'-'+stats.salidas, color:'var(--danger)' },
          { lbl:'Transferencias', val:stats.transferencias, color:'var(--brand)' },
        ].map(k => (
          <div key={k.lbl} style={{ display:'flex', alignItems:'baseline', gap:6, padding:'6px 12px', border:'1px solid var(--border)', borderRadius:8, background:'var(--bg-elev)' }}>
            <span style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.03em' }}>{k.lbl}</span>
            <span style={{ fontSize:16, fontWeight:800, color:k.color }}>{k.val}</span>
          </div>
        ))}
      </div>

      {/* Toolbar: periodo + rango + filtros (compacto, 1–2 líneas) */}
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:12, flexWrap:'wrap' }}>
        <div className="seg">
          {[['hoy','Hoy'],['ayer','Ayer'],['semana','Última semana'],['mes','Este mes']].map(([v,l]) => (
            <button key={v} className={periodo===v?'on':''} onClick={()=>{ setPeriodo(v); setPage(1); }}>{l}</button>
          ))}
        </div>
        <input type="date" className="input" title="Desde" style={{ width:138 }} value={fechaDesde}
          onChange={e=>{ setFechaDesde(e.target.value); setPeriodo('rango'); setPage(1); }}/>
        <span style={{ color:'var(--text-muted)', fontSize:12 }}>–</span>
        <input type="date" className="input" title="Hasta" style={{ width:138 }} value={fechaHasta}
          onChange={e=>{ setFechaHasta(e.target.value); setPeriodo('rango'); setPage(1); }}/>
        <div style={{ position:'relative', flex:1, minWidth:150 }}>
          <Icon name="search" size={14} style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }}/>
          <input className="input" style={{ paddingLeft:30 }} placeholder="SKU, producto, motivo, usuario…" value={search} onChange={e=>{ setSearch(e.target.value); setPage(1); }}/>
        </div>
        <window.MobileFilters count={[tipoF, origenF, almF, groupBy].filter(Boolean).length}>
        <select className="select" style={{ width:110 }} value={tipoF} onChange={e=>{ setTipoF(e.target.value); setPage(1); }}>
          <option value="">Todos los tipos</option>
          {['entrada','salida'].map(t => (
            <option key={t} value={t}>{tipoLabel[t]}</option>
          ))}
        </select>
        <select className="select" style={{ width:170 }} value={origenF} onChange={e=>{ setOrigenF(e.target.value); setPage(1); }}>
          <option value="">Todos los orígenes</option>
          {Object.keys(ORIGEN_LABEL).map(o => (
            <option key={o} value={o}>{ORIGEN_LABEL[o]}</option>
          ))}
        </select>
        <select className="select" style={{ width:150 }} value={almF} onChange={e=>{ setAlmF(e.target.value); setPage(1); }}>
          <option value="">Todos los almacenes</option>
          {almacenes.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="select" style={{ width:172 }} value={groupBy} onChange={e=>{ setGroupBy(e.target.value); setExpanded(new Set()); setPage(1); }}>
          <option value="">Sin agrupar</option>
          <option value="producto">Agrupar por producto</option>
          <option value="almacen">Agrupar por almacén</option>
          <option value="usuario">Agrupar por usuario</option>
          <option value="origen">Agrupar por origen</option>
          <option value="factura">Agrupar por factura</option>
          <option value="despacho">Agrupar por nota de despacho</option>
        </select>
        {(search||tipoF||origenF||almF) && (
          <button className="btn ghost sm" onClick={()=>{ setSearch(''); setTipoF(''); setOrigenF(''); setAlmF(''); setPage(1); }}>
            <Icon name="x" size={12}/>Limpiar
          </button>
        )}
        </window.MobileFilters>
      </div>

      {/* Grouped view */}
      {groupBy && groups && (
        <div>
          {groups.length === 0 && (
            <div className="tbl-wrap" style={{ padding:'32px 0', textAlign:'center', color:'var(--text-muted)' }}>Sin movimientos en el período seleccionado</div>
          )}
          {groups.map(g => {
            const open = expanded.has(g.key);
            return (
              <div key={g.key} className="tbl-wrap" style={{ marginBottom:8 }}>
                <div
                  style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', cursor:'pointer', userSelect:'none' }}
                  onClick={() => setExpanded(prev => { const s = new Set(prev); s.has(g.key) ? s.delete(g.key) : s.add(g.key); return s; })}
                >
                  <Icon name={open ? 'chevronD' : 'chevronR'} size={14} style={{ color:'var(--text-muted)', flexShrink:0 }}/>
                  <div style={{ flex:1, fontWeight:600, fontSize:14 }}>{g.key}</div>
                  <div style={{ display:'flex', gap:16, fontSize:12 }}>
                    <span style={{ color:'var(--text-muted)' }}>{g.movs.length} mov.</span>
                    {g.entradas > 0 && <span style={{ color:'var(--success)', fontWeight:600 }}>+{g.entradas}</span>}
                    {g.salidas  > 0 && <span style={{ color:'var(--danger)',  fontWeight:600 }}>−{g.salidas}</span>}
                  </div>
                </div>
                {open && (
                  <div className="tbl-scroll">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Tipo</th>
                          {groupBy !== 'origen' && <th className="dt-hide-mobile">Origen</th>}
                          {groupBy !== 'producto' && <th>SKU / Producto</th>}
                          <th className="num">Cantidad</th>
                          {groupBy !== 'almacen'  && <th className="dt-hide-mobile">Almacén</th>}
                          <th className="dt-hide-mobile">Motivo / Referencia</th>
                          {groupBy !== 'usuario'  && <th className="dt-hide-mobile">Usuario</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {g.movs.map(m => (
                          <tr key={m.id}>
                            <td className="small" style={{ whiteSpace:'nowrap' }}>{fmtDate(m.fecha)}</td>
                            <td>
                              <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:700, background:(tipoColor[m.tipo]||'var(--text-muted)')+'22', color:tipoColor[m.tipo]||'var(--text-muted)' }}>{tipoLabel[m.tipo]||m.tipo}</span>
                            </td>
                            {groupBy !== 'origen' && (
                              <td className="dt-hide-mobile">
                                <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:600, background:(ORIGEN_COLOR[m.origen]||'var(--text-muted)')+'18', color:ORIGEN_COLOR[m.origen]||'var(--text-muted)' }}>{ORIGEN_LABEL[m.origen]||'Otro'}</span>
                              </td>
                            )}
                            {groupBy !== 'producto' && (
                              <td style={{ maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                <span className="mono-cell" style={{ fontSize:11, color:'var(--text-muted)' }}>{m.sku}</span> {m.nombre}
                              </td>
                            )}
                            <td className="num" style={{ fontWeight:700, color: m.cantidad>0?'var(--success)':m.cantidad<0?'var(--danger)':'var(--text-muted)' }}>
                              {m.cantidad>0?'+':''}{m.cantidad}
                            </td>
                            {groupBy !== 'almacen' && <td className="small dt-hide-mobile">{m.almacen}</td>}
                            <td className="small muted dt-hide-mobile" style={{ maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.motivo}</td>
                            {groupBy !== 'usuario' && <td className="small muted dt-hide-mobile">{m.usuario}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Flat table (no grouping) */}
      {!groupBy && (
        <div className="tbl-wrap">
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th className="dt-hide-mobile">Origen</th>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th className="num">Cantidad</th>
                  <th className="dt-hide-mobile">Almacén</th>
                  <th className="dt-hide-mobile">Motivo / Referencia</th>
                  <th className="dt-hide-mobile">Documento</th>
                  <th className="dt-hide-mobile">Creado por</th>
                </tr>
              </thead>
              <tbody>
                {logs === null || kardex === null ? (
                  <tr><td colSpan={10} className="empty">Cargando movimientos…</td></tr>
                ) : paginated.length === 0 ? (
                  <tr><td colSpan={10} className="empty">Sin movimientos en el período seleccionado</td></tr>
                ) : paginated.map(m => (
                  <tr key={m.id}>
                    <td className="small" style={{ whiteSpace:'nowrap' }}>{fmtDate(m.fecha)}</td>
                    <td>
                      <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:700, background:(tipoColor[m.tipo]||'var(--text-muted)')+'22', color:tipoColor[m.tipo]||'var(--text-muted)' }}>{tipoLabel[m.tipo]||m.tipo}</span>
                    </td>
                    <td className="dt-hide-mobile">
                      <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:600, background:(ORIGEN_COLOR[m.origen]||'var(--text-muted)')+'18', color:ORIGEN_COLOR[m.origen]||'var(--text-muted)' }}>{ORIGEN_LABEL[m.origen]||'Otro'}</span>
                    </td>
                    <td className="mono-cell">{m.sku}</td>
                    <td style={{ maxWidth:240, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.nombre}</td>
                    <td className="num" style={{ fontWeight:700, color: m.cantidad>0?'var(--success)':m.cantidad<0?'var(--danger)':'var(--text-muted)' }}>
                      {m.cantidad>0?'+':''}{m.cantidad}
                    </td>
                    <td className="small dt-hide-mobile">{m.almacen}</td>
                    <td className="small muted dt-hide-mobile" style={{ maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.motivo}</td>
                    {/* De dónde salió el producto. Solo es un documento del flujo cuando el
                        ref_tipo es despacho/factura/orden: en un traslado el ref es la
                        transferencia y en un ajuste no hay documento, así que ahí no se ofrece
                        un enlace que llevaría a una pantalla equivocada. */}
                    <td className="small dt-hide-mobile mono-cell" style={{ whiteSpace:'nowrap' }}>
                      {m.refDoc && DOC_REF_TIPOS.includes(m.refTipo) ? (
                        <button type="button" className="link-btn" disabled={abriendoDoc === m.refDoc}
                                onClick={() => abrirDocumento(m.refDoc)}
                                title={`Abrir ${m.refDoc} en el detalle`}>
                          {abriendoDoc === m.refDoc ? 'Abriendo…' : m.refDoc}
                          {/* Icon no acepta `style`, solo name/size/className: el espaciado va en .link-btn svg */}
                          {abriendoDoc !== m.refDoc && <Icon name="external" size={11} />}
                        </button>
                      ) : (
                        <span className="muted">{m.refDoc || '—'}</span>
                      )}
                    </td>
                    <td className="dt-hide-mobile"><CreadoPorCell nombre={m.creado_por || m.usuario}/></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {filtered.length > 0 && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 16px', borderTop:'1px solid var(--border)', fontSize:12, gap:8, flexWrap:'wrap' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <select className="select" value={PAGE_SZ} onChange={e => { setPageSize(parseInt(e.target.value)); setPage(1); }} style={{ fontSize:12, padding:'3px 6px' }}>
                  {[50,100,200].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <span className="muted">{filtered.length} registros · página {page} de {totalPages}</span>
              </div>
              {totalPages > 1 && (
                <div style={{ display:'flex', gap:4 }}>
                  <button className="btn ghost sm" disabled={page===1} onClick={()=>setPage(p=>p-1)}><Icon name="chevronL" size={13}/></button>
                  {Array.from({length:Math.min(5,totalPages)},(_,i)=>Math.max(1,Math.min(totalPages-4,page-2))+i).filter(p=>p>=1&&p<=totalPages).map(p=>(
                    <button key={p} className={'btn sm '+(p===page?'primary':'ghost')} style={{minWidth:32}} onClick={()=>setPage(p)}>{p}</button>
                  ))}
                  <button className="btn ghost sm" disabled={page===totalPages} onClick={()=>setPage(p=>p+1)}><Icon name="chevronR" size={13}/></button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {reportOpen && (
        <div className="modal-overlay" onClick={() => setReportOpen(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{flex:1}}>
                <h3 className="modal-title">Reporte de movimientos</h3>
                <div className="small">Elegí el formato y el período — se descarga el archivo</div>
              </div>
              <button className="icon-btn" onClick={() => setReportOpen(false)}><Icon name="x" size={16}/></button>
            </div>
            <div className="modal-body">
              {/* Formato. El PDF es para firmar en el almacén; el Excel, para cruzar números. */}
              <label className="label">Formato</label>
              <div className="seg" style={{ width:'100%', marginBottom:14 }}>
                <button className={repFormato==='pdf'?'on':''}  onClick={()=>setRepFormato('pdf')}  style={{flex:1}}>
                  <Icon name="doc" size={13}/> PDF
                </button>
                <button className={repFormato==='xlsx'?'on':''} onClick={()=>setRepFormato('xlsx')} style={{flex:1}}>
                  <Icon name="download" size={13}/> Excel (XLSX)
                </button>
              </div>
              <div className="small muted" style={{ marginTop:-10, marginBottom:14, fontSize:11 }}>
                {repFormato === 'pdf'
                  ? 'Hoja lista para que el almacenista la revise y firme.'
                  : 'Dos hojas: Resumen (totales del período) y Movimientos (una fila por movimiento).'}
              </div>

              {/* Rango exacto de fechas — el pedido más común y lo que faltaba. */}
              <label className="label">Período</label>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
                <input type="date" className="input" style={{ flex:1 }} value={repDesde} max={today}
                       onChange={e => setRepDesde(e.target.value)} title="Desde"/>
                <span className="muted">→</span>
                <input type="date" className="input" style={{ flex:1 }} value={repHasta} max={today}
                       onChange={e => setRepHasta(e.target.value)} title="Hasta"/>
              </div>
              <button className="btn primary" style={{ width:'100%', marginBottom:14 }}
                      disabled={!repDesde || !repHasta}
                      onClick={() => pedirReporte('rango')}>
                <Icon name="download" size={14}/>Descargar {repFormato === 'pdf' ? 'PDF' : 'Excel'} de este rango
              </button>

              <div className="small muted" style={{ marginBottom:8, fontSize:11 }}>O un período rápido:</div>
              {[
                { id:'hoy',  label:'Día de hoy',  desc:'Movimientos registrados hoy' },
                { id:'ayer', label:'Día de ayer', desc:'Movimientos del día anterior' },
                { id:'mes',  label:'Mes actual',  desc:'Desde el día 1 hasta hoy' },
              ].map(o => (
                <button
                  key={o.id}
                  className="btn secondary"
                  onClick={() => pedirReporte(o.id)}
                  style={{ width:'100%', justifyContent:'flex-start', textAlign:'left', padding:'12px 14px', marginBottom:8, height:'auto' }}>
                  <Icon name="download" size={15}/>
                  <span style={{ display:'flex', flexDirection:'column', gap:2, marginLeft:4 }}>
                    <span style={{ fontWeight:600 }}>{o.label}</span>
                    <span className="small muted" style={{ fontSize:11 }}>{o.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {pendingReport && (
        <div className="modal-overlay" style={{ pointerEvents:'none' }}>
          <div className="modal" style={{ maxWidth:280, textAlign:'center', padding:'22px 18px' }}>
            <div className="small" style={{ fontWeight:600 }}>Generando el reporte…</div>
            <div className="small muted" style={{ marginTop:4, fontSize:11 }}>Cargando los movimientos del período</div>
          </div>
        </div>
      )}
    </div>
  );
}

window.PricesPage = function PricesPage() {
  const [sel, setSel] = useState(() => SSData.listasPrecios[0]?.id || '');
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [editLista, setEditLista] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [listVersion, setListVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [mobileListsOpen, setMobileListsOpen] = useState(false);
  // Filtros de la tabla de productos (mismo patrón que Inventario)
  const [searchTerms, setSearchTerms] = useState([]);
  const [liveSearch, setLiveSearch]   = useState(''); // texto que se está tipeando, sin necesidad de Enter
  const [catFilter, setCatFilter]     = useState('');
  const [marcaFilter, setMarcaFilter] = useState('');
  const [margenFilter, setMargenFilter] = useState(''); // '', 'bajo' (<10%), 'medio' (10-20%), 'alto' (>20%)
  const [ppPage, setPpPage] = useState(1);
  const [ppPageSize, setPpPageSize] = useState(() => {
    const v = parseInt(localStorage.getItem('ss-listasprecios-pagesize'));
    return [50,100,200].includes(v) ? v : 50;
  });
  useEffect(() => { localStorage.setItem('ss-listasprecios-pagesize', String(ppPageSize)); }, [ppPageSize]);

  const lista = SSData.listasPrecios.find(l => l.id === sel);
  const tipoCl = lista ? SSData.tiposCliente.find(t => t.id === lista.tipo) : null;
  const clientes = lista ? SSData.clientes.filter(c => c.listaPrecio === sel) : [];

  const productosFiltrados = React.useMemo(() => {
    if (!lista) return [];
    const liveTerm = liveSearch.trim();
    const allTerms = liveTerm ? [...searchTerms, liveTerm] : searchTerms;
    return (SSData.productos || []).filter(p => {
      if (catFilter   && (p.categoria||'').trim().toLowerCase() !== catFilter.trim().toLowerCase())   return false;
      if (marcaFilter && (p.marca||'').trim().toLowerCase()     !== marcaFilter.trim().toLowerCase()) return false;
      if (!window.AdvancedSearch.matches(allTerms, p.nombre, p.sku, p.marca, p.categoria)) return false;
      if (margenFilter) {
        const isCustom = lista.modo === 'custom';
        const manual   = isCustom ? (lista.preciosManuales || {})[p.sku] : undefined;
        const precio   = manual != null ? manual : p.base * (1 - (lista.valor || 0) / 100);
        const margen   = precio > 0 ? ((precio - p.costo) / precio) * 100 : 0;
        if (margenFilter === 'bajo'  && !(margen < 10))             return false;
        if (margenFilter === 'medio' && !(margen >= 10 && margen <= 20)) return false;
        if (margenFilter === 'alto'  && !(margen > 20))             return false;
      }
      return true;
    });
  }, [lista, catFilter, marcaFilter, searchTerms, liveSearch, margenFilter, listVersion]);

  useEffect(() => { setPpPage(1); }, [sel, catFilter, marcaFilter, searchTerms, liveSearch, margenFilter, ppPageSize, listVersion]);
  const ppTotalPages = Math.max(1, Math.ceil(productosFiltrados.length / ppPageSize));
  const ppSafePage   = Math.min(ppPage, ppTotalPages);
  const ppPageRows   = productosFiltrados.slice((ppSafePage - 1) * ppPageSize, ppSafePage * ppPageSize);

  async function handleDelete(l) {
    const assignedCount = SSData.clientes.filter(c => c.listaPrecio === l.id).length;
    if (assignedCount > 0 && deleteConfirm !== l.id + '-confirm') {
      setDeleteConfirm(l.id + '-confirm'); return;
    }
    setSaving(true);
    const err = await deleteLista(l.id);
    if (err) { alert('Error al eliminar: ' + err.message); setSaving(false); return; }
    window.ssTrash?.add('listaPrecio', l.nombre, l);
    await window.loadAppData();
    if (sel === l.id) setSel(SSData.listasPrecios[0]?.id || '');
    setDeleteConfirm(null);
    setListVersion(v => v + 1);
    setSaving(false);
    window.logActivity?.({ modulo:'listas_precios', accion:'eliminar', entidad_id:l.id, entidad_label:l.nombre });
  }

  async function handleSaveNew(newLista, clientesAsignados = [], preciosManuales = {}) {
    setSaving(true);
    const err = await saveLista(newLista);
    if (err) { alert('Error al guardar: ' + err.message); setSaving(false); return; }
    if (newLista.modo === 'custom' && Object.keys(preciosManuales).length > 0) {
      const detalleErr = await window.saveListaDetalle(newLista.id, preciosManuales);
      if (detalleErr) { alert('Lista creada pero error guardando precios: ' + detalleErr.message); }
    }
    for (const cid of clientesAsignados) {
      await window.sb.from('clientes').update({ lista_precio: newLista.id }).eq('id', cid);
    }
    await window.loadAppData();
    setSel(newLista.id);
    setShowNew(false);
    setListVersion(v => v + 1);
    setSaving(false);
    window.logActivity?.({ modulo:'listas_precios', accion:'crear', entidad_id:newLista.id, entidad_label:newLista.nombre, detalles:{ tipo:newLista.tipo, modo:newLista.modo, valor:newLista.valor, precios_manuales: Object.keys(preciosManuales).length } });
  }

  async function handleSaveEdit(updated, preciosManuales = null) {
    setSaving(true);
    const before = SSData.listasPrecios.find(x => x.id === updated.id);
    const err = await saveLista(updated);
    if (err) { alert('Error al guardar: ' + err.message); setSaving(false); return; }
    if (updated.modo === 'custom' && preciosManuales !== null) {
      const detalleErr = await window.saveListaDetalle(updated.id, preciosManuales);
      if (detalleErr) alert('Error guardando precios manuales: ' + detalleErr.message);
    }
    await window.loadAppData();
    setEditLista(null);
    setListVersion(v => v + 1);
    setSaving(false);
    window.logActivity?.({ modulo:'listas_precios', accion:'editar', entidad_id:updated.id, entidad_label:updated.nombre, detalles:{ before: before ? { nombre:before.nombre, tipo:before.tipo, valor:before.valor } : null, after: { nombre:updated.nombre, tipo:updated.tipo, valor:updated.valor } } });
  }

  if (!lista) return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Listas de Precios</h1></div>
        <div className="page-actions">
          {window.canUser?.('crear','prices') !== false && (
            <button className="btn primary" onClick={()=>setShowNew(true)}><Icon name="plus" size={14}/>Nueva lista</button>
          )}
        </div>
      </div>
      <div className="empty" style={{marginTop:80}}>No hay listas de precios. Crea la primera.</div>
      {showNew && <NewPriceListModal onClose={()=>setShowNew(false)} onSave={(l,ca,pm)=>handleSaveNew(l,ca,pm)}/>}
    </div>
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Listas de Precios</h1>
          <div className="page-subtitle">{SSData.listasPrecios.length} listas · {SSData.tiposCliente.length} tipos de cliente</div>
        </div>
        <div className="page-actions">
          {window.canUser?.('crear','prices') !== false && (
            <button className="btn secondary" onClick={()=>setShowImport(true)}><Icon name="upload" size={14}/>Importar lista</button>
          )}
          {window.canUser?.('crear','prices') !== false && (
            <button className="btn primary" onClick={()=>setShowNew(true)} disabled={saving}><Icon name="plus" size={14}/>{saving ? 'Guardando…' : 'Nueva lista'}</button>
          )}
          <button className="btn ghost" onClick={() => setShowActivity(true)} title="Ver registro de actividad"><Icon name="receipt" size={14}/>Actividad</button>
        </div>
      </div>
      {showNew && <NewPriceListModal onClose={()=>setShowNew(false)} onSave={(l,ca,pm)=>handleSaveNew(l,ca,pm)}/>}
      {showImport && <ImportPriceListModal onClose={()=>setShowImport(false)}/>}
      {editLista && <EditPriceListModal lista={editLista} onClose={()=>setEditLista(null)} onSave={(updated, pm)=>handleSaveEdit(updated, pm)}/>}
      {showActivity && <ActivityLogModal modulo="listas_precios" onClose={()=>setShowActivity(false)}/>}

      <div className="split">
        {/* Left — product price table for selected list */}
        <div>
          <div className="tbl-wrap">
            <div className="tbl-toolbar">
              <h3 style={{margin:0, fontSize:14, fontWeight:600}}>{lista.nombre}</h3>
              <span className="chip blue">{tipoCl?.nombre}</span>
              <span className="chip amber">Dcto. {lista.valor}% sobre base</span>
              <span className="ml-auto small">
                {productosFiltrados.length === SSData.productos.length
                  ? `${SSData.productos.length} productos`
                  : `${productosFiltrados.length} de ${SSData.productos.length} productos`}
              </span>
              {window.canUser?.('editar','prices') !== false && (
                <button className="btn ghost sm" onClick={()=>setEditLista({...lista})}><Icon name="edit" size={13}/>Editar lista</button>
              )}
              <button className="btn secondary sm show-sm-only" onClick={()=>setMobileListsOpen(true)}>
                <Icon name="price" size={13}/>Listas ({SSData.listasPrecios.length})
              </button>
            </div>
            {/* Barra de búsqueda + filtros (igual que Inventario) */}
            <div className="tbl-toolbar" style={{ borderTop:'1px solid var(--border)', flexWrap:'wrap', gap:8 }}>
              <div style={{ flex:'1 1 280px', minWidth:240 }}>
                <AdvancedSearch
                  terms={searchTerms}
                  onTermsChange={setSearchTerms}
                  onInputChange={setLiveSearch}
                  storageKey="ss-saved-search-listasprecios"
                  placeholder="Buscá en tiempo real (Enter para fijar como filtro)…"
                />
              </div>
              <window.MobileFilters count={[catFilter, marcaFilter, margenFilter].filter(Boolean).length}>
              <select className="select sm" value={catFilter} onChange={e=>setCatFilter(e.target.value)} title="Filtrar por categoría">
                <option value="">Todas categorías</option>
                {[...new Set((SSData.productos||[]).map(p=>p.categoria).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es')).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className="select sm" value={marcaFilter} onChange={e=>setMarcaFilter(e.target.value)} title="Filtrar por marca">
                <option value="">Todas marcas</option>
                {[...new Set((SSData.productos||[]).map(p=>p.marca).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es')).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <select className="select sm" value={margenFilter} onChange={e=>setMargenFilter(e.target.value)} title="Filtrar por rango de margen">
                <option value="">Todos márgenes</option>
                <option value="bajo">Margen bajo (&lt;10%)</option>
                <option value="medio">Margen medio (10-20%)</option>
                <option value="alto">Margen alto (&gt;20%)</option>
              </select>
              {(searchTerms.length > 0 || liveSearch || catFilter || marcaFilter || margenFilter) && (
                <button className="btn ghost sm" onClick={()=>{ setSearchTerms([]); setLiveSearch(''); setCatFilter(''); setMarcaFilter(''); setMargenFilter(''); }} title="Limpiar todos los filtros">
                  <Icon name="x" size={12}/>Limpiar
                </button>
              )}
              </window.MobileFilters>
            </div>
            <div className="tbl-scroll" style={{maxHeight:560}}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Producto</th>
                    <th className="num">Costo</th>
                    <th className="num">Base</th>
                    <th className="num">Precio lista</th>
                    <th className="num">Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {productosFiltrados.length === 0 && (
                    <tr><td colSpan={6} style={{textAlign:'center', padding:'32px 0', color:'var(--text-muted)', fontSize:13}}>
                      Sin resultados con los filtros activos.
                    </td></tr>
                  )}
                  {ppPageRows.map(p => {
                    const isCustom = lista.modo === 'custom';
                    const manualPrecio = isCustom ? (lista.preciosManuales || {})[p.sku] : undefined;
                    const precioLista = manualPrecio != null ? manualPrecio : p.base * (1 - (lista.valor || 0) / 100);
                    const margen = precioLista > 0 ? ((precioLista - p.costo) / precioLista) * 100 : 0;
                    return (
                      <tr key={p.sku}>
                        <td className="mono-cell">{p.sku}</td>
                        <td style={{maxWidth:240, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                          <div style={{fontWeight:500}}>{p.nombre}</div>
                        </td>
                        <td className="num muted">{fmt.usd(p.costo)}</td>
                        <td className="num">{fmt.usd(p.base)}</td>
                        <td className="num strong-num" style={{color: manualPrecio != null ? 'var(--success)' : 'var(--brand)'}}>
                          {fmt.usd(precioLista)}
                          {manualPrecio != null && <span className="chip blue" style={{fontSize:9,marginLeft:4}}>manual</span>}
                        </td>
                        <td className="num" style={{color: margen < 10 ? 'var(--danger)' : margen < 20 ? 'var(--warn)' : 'var(--success)'}}>{margen.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {productosFiltrados.length > 0 && (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderTop:'1px solid var(--border)', fontSize:12, gap:8, flexWrap:'wrap' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <select className="select" value={ppPageSize} onChange={e => { setPpPageSize(parseInt(e.target.value)); setPpPage(1); }} style={{ fontSize:12, padding:'3px 6px' }}>
                    {[50,100,200].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <span className="muted">Mostrando {(ppSafePage-1)*ppPageSize+1}–{Math.min(ppSafePage*ppPageSize, productosFiltrados.length)} de {productosFiltrados.length}</span>
                </div>
                {ppTotalPages > 1 && (
                  <div style={{ display:'flex', gap:4 }}>
                    <button className="btn ghost sm" disabled={ppSafePage===1} onClick={()=>setPpPage(1)}><Icon name="chevronL" size={11}/><Icon name="chevronL" size={11}/></button>
                    <button className="btn ghost sm" disabled={ppSafePage===1} onClick={()=>setPpPage(p=>Math.max(1,p-1))}><Icon name="chevronL" size={13}/></button>
                    {Array.from({length:Math.min(5,ppTotalPages)},(_,i)=>Math.max(1,Math.min(ppTotalPages-4,ppSafePage-2))+i).filter(p=>p>=1&&p<=ppTotalPages).map(p=>(
                      <button key={p} className={'btn sm '+(p===ppSafePage?'primary':'ghost')} style={{minWidth:30, padding:'3px 8px'}} onClick={()=>setPpPage(p)}>{p}</button>
                    ))}
                    <button className="btn ghost sm" disabled={ppSafePage===ppTotalPages} onClick={()=>setPpPage(p=>Math.min(ppTotalPages,p+1))}><Icon name="chevronR" size={13}/></button>
                    <button className="btn ghost sm" disabled={ppSafePage===ppTotalPages} onClick={()=>setPpPage(ppTotalPages)}><Icon name="chevronR" size={11}/><Icon name="chevronR" size={11}/></button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right — list selector + assigned clients (slide-over en móvil) */}
        {mobileListsOpen && <div className="prices-right-backdrop" onClick={()=>setMobileListsOpen(false)}/>}
        <div className={`prices-right${mobileListsOpen ? ' mobile-open' : ''}`}>
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Listas disponibles</h3>
              <button className="icon-btn show-sm-only" onClick={()=>setMobileListsOpen(false)} title="Cerrar"><Icon name="x" size={14}/></button>
            </div>
            <div style={{padding:4}}>
              {SSData.listasPrecios.map(l => {
                const tc = SSData.tiposCliente.find(t => t.id === l.tipo);
                const activa = l.id === sel;
                const confirmKey = l.id + '-confirm';
                const confirming = deleteConfirm === l.id || deleteConfirm === confirmKey;
                const assignedCount = SSData.clientes.filter(c => c.listaPrecio === l.id).length;
                return (
                  <div key={l.id} className="flex items-center gap-2"
                    style={{padding:'8px 12px', borderRadius:6, margin:2, cursor:'pointer', background: activa ? 'var(--brand-soft)' : 'transparent', transition:'background .1s'}}
                    onClick={()=>{ if (!confirming) setSel(l.id); }}
                  >
                    <div style={{width:8, height:8, borderRadius:2, background:tc?.color, flexShrink:0}}/>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontSize:13, fontWeight:500, color: activa ? 'var(--brand)' : 'inherit'}}>{l.nombre}</div>
                      <div className="small">{tc?.nombre}{assignedCount > 0 ? ` · ${assignedCount} cliente${assignedCount>1?'s':''}` : ''}</div>
                    </div>
                    {confirming ? (
                      <div style={{display:'flex', alignItems:'center', gap:4}} onClick={e=>e.stopPropagation()}>
                        <span style={{fontSize:11, color:'var(--danger)', fontWeight:600}}>
                          {deleteConfirm === confirmKey ? `¿Eliminar? (${assignedCount} cliente${assignedCount>1?'s':''} asignados)` : '¿Confirmar?'}
                        </span>
                        <button className="btn ghost sm" style={{color:'var(--danger)', height:26, fontSize:11}} onClick={()=>handleDelete(l)}>Sí</button>
                        <button className="btn ghost sm" style={{height:26, fontSize:11}} onClick={()=>setDeleteConfirm(null)}>No</button>
                      </div>
                    ) : (
                      <div style={{display:'flex', alignItems:'center', gap:2}} onClick={e=>e.stopPropagation()}>
                        <span className="mono" style={{fontSize:12, color: activa ? 'var(--brand)' : 'var(--text-muted)', marginRight:4}}>−{l.valor}%</span>
                        {window.canUser?.('editar','prices') !== false && (
                          <button className="icon-btn" style={{width:26,height:26}} onClick={()=>setEditLista({...l})} title="Editar">
                            <Icon name="edit" size={13}/>
                          </button>
                        )}
                        {window.canUser?.('eliminar','prices') !== false && (
                          <button className="icon-btn" style={{width:26,height:26,color:'var(--danger)'}} onClick={()=>setDeleteConfirm(l.id)} title="Eliminar">
                            <Icon name="trash" size={13}/>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card mt-4">
            <div className="card-header"><h3 className="card-title">Clientes asignados</h3></div>
            <div style={{padding:4}}>
              {clientes.length === 0 && <div className="empty">Sin clientes asignados</div>}
              {clientes.map(c => (
                <div key={c.id} className="flex items-center gap-2" style={{padding:'8px 12px', borderRadius:6, margin:2}}>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:12.5, fontWeight:500}}>{c.nombre}</div>
                    <div className="small mono">{c.rif}</div>
                  </div>
                  <span className="chip neutral">{c.ciudad}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════ Transferencias de inventario (con recepción) ═══════════════════
const TRANSF_ESTADOS = {
  en_transito:      { label: 'En tránsito',      color: '#ca8a04', icon: 'truck' },
  recibida_parcial: { label: 'Recibida parcial', color: '#0369a1', icon: 'box' },
  recibida:         { label: 'Recibida',         color: '#16a34a', icon: 'check' },
  cerrada:          { label: 'Cerrada',          color: '#475569', icon: 'check' },
  cancelada:        { label: 'Cancelada',        color: '#dc2626', icon: 'x' },
};
function TransfEstadoChip({ estado }) {
  const e = TRANSF_ESTADOS[estado] || { label: estado, color: 'var(--brand)', icon: 'doc' };
  return <span className="chip" style={{ background: e.color + '18', color: e.color, fontSize: 11.5 }}><Icon name={e.icon} size={10} /> {e.label}</span>;
}
function transfStockDisp(sku, almacenId) {
  const inv = ((SSData.inventario || {})[sku] || {})[almacenId];
  return (inv?.cantidad || 0) - (inv?.reservado || 0);
}
function almNombre(id) { return (SSData.almacenes || []).find(a => a.id === id)?.nombre || id; }

window.TransferenciasPage = function TransferenciasPage({ onBack }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNueva, setShowNueva] = useState(false);
  const [detalle, setDetalle] = useState(null);
  const [search, setSearch]   = useState('');
  const [estadoF, setEstadoF] = useState('');
  const puedeCrear = window.canUser?.('crear', 'inventory') !== false;

  async function reload() {
    setLoading(true);
    const data = await window.loadTransferencias?.() || [];
    setRows(data);
    setLoading(false);
    if (detalle) setDetalle(data.find(t => t.id === detalle.id) || null);
  }
  useEffect(() => { reload(); }, []);

  const filtradas = rows.filter(t => {
    if (estadoF && t.estado !== estadoF) return false;
    if (search) { const q = search.toLowerCase(); if (!(t.id.toLowerCase().includes(q) || almNombre(t.almacen_origen).toLowerCase().includes(q) || almNombre(t.almacen_destino).toLowerCase().includes(q))) return false; }
    return true;
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          {onBack && <button className="btn ghost sm" onClick={onBack} style={{ marginBottom: 6 }}><Icon name="chevronL" size={13} />Inventario</button>}
          <h1 className="page-title">Transferencias de inventario</h1>
          <div className="page-subtitle">{loading ? 'Cargando…' : `${filtradas.length} transferencia${filtradas.length !== 1 ? 's' : ''}`} · envío → recepción → cierre</div>
        </div>
        {puedeCrear && <div className="page-actions"><button className="btn primary" onClick={() => setShowNueva(true)}><Icon name="plus" size={14} />Nueva transferencia</button></div>}
      </div>

      <div className="flex gap-2" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <input className="input search" placeholder="Buscar por ID o almacén…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 260 }} />
        <select className="select" value={estadoF} onChange={e => setEstadoF(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(TRANSF_ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr>
            <th>Transferencia</th><th>Origen → Destino</th><th>Estado</th>
            <th className="num">Enviado</th><th className="num">Recibido</th><th className="num">Faltante</th><th className="hide-sm">Por</th><th>Fecha</th>
          </tr></thead>
          <tbody>
            {filtradas.map(t => {
              const env = (t.items || []).reduce((s, i) => s + (i.cantidad_enviada || 0), 0);
              const rec = (t.items || []).reduce((s, i) => s + (i.cantidad_recibida || 0), 0);
              const falt = env - rec;
              return (
                <tr key={t.id} onClick={() => setDetalle(t)} style={{ cursor: 'pointer' }}>
                  <td className="mono-cell">{t.id}</td>
                  <td>{almNombre(t.almacen_origen)} <span className="muted">→</span> {almNombre(t.almacen_destino)}</td>
                  <td><TransfEstadoChip estado={t.estado} /></td>
                  <td className="num">{env}</td>
                  <td className="num">{rec}</td>
                  <td className="num" style={{ color: falt > 0 && (t.estado === 'cerrada') ? 'var(--danger)' : 'var(--text-muted)' }}>{falt}{t.faltante_devuelto ? ' ↩' : ''}</td>
                  <td className="hide-sm"><CreadoPorCell nombre={t.recibido_por || t.enviado_por} size={20} showName={false} /></td>
                  <td className="muted" style={{ fontSize: 12.5 }}>{fmt.date(t.fecha_envio)}</td>
                </tr>
              );
            })}
            {!loading && filtradas.length === 0 && <tr><td colSpan={8} className="empty">Sin transferencias</td></tr>}
          </tbody>
        </table>
      </div>

      {showNueva && <NuevaTransferenciaModal onClose={() => setShowNueva(false)} onDone={async () => { setShowNueva(false); await reload(); }} />}
      {detalle && <DetalleTransferenciaModal transf={detalle} onClose={() => setDetalle(null)} onChanged={reload} />}
    </div>
  );
};

// ─── Modal: nueva transferencia (crear = enviar) ─────────────────────────────
function NuevaTransferenciaModal({ onClose, onDone, preItems }) {
  const empresa = window.currentEmpresa || 'demo1';
  // Solo entre las empresas QUE ESE USUARIO tiene habilitadas (pedido explícito 2026-08-16) — un
  // vendedor con acceso solo a Demo 2 no debe poder mover mercancía hacia/desde Demo 1 aunque
  // exista en el sistema.
  const misEmpresas = window.__ssCurrentUser?.empresas?.length ? window.__ssCurrentUser.empresas : [empresa];
  const almacenes = (window.getAlmacenes?.() || SSData.almacenes || []).filter(a => (a.empresa_id || empresa) === empresa);
  const [origen, setOrigen] = useState('');
  // El ORIGEN siempre es la empresa activa: es la única cuyo stock está cargado en memoria
  // (SSData.inventario solo trae la empresa con la que se inició sesión en esta pestaña) — validar
  // disponible de un almacén de otra empresa daría siempre 0 sin este límite. El DESTINO sí puede
  // cruzar de empresa; ahí no hace falta saber cuánto stock tiene, solo a dónde entra.
  const [empresaDestino, setEmpresaDestino] = useState(empresa);
  const [empresasInfo, setEmpresasInfo] = useState([]);
  const [destAlmacenes, setDestAlmacenes] = useState(almacenes);
  const [destAlmacenesLoading, setDestAlmacenesLoading] = useState(false);
  const [destino, setDestino] = useState('');
  const [lineas, setLineas] = useState([]);   // [{sku, nombre, cantidad}]
  const [omitidosSinStock, setOmitidosSinStock] = useState(0);
  const [buscar, setBuscar] = useState('');
  const [notas, setNotas] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const cruzaEmpresas = empresaDestino !== empresa;

  useEffect(() => { if (misEmpresas.length > 1) window.loadEmpresas?.().then(list => setEmpresasInfo(list || [])); }, []);

  // Almacenes del destino: si sigue en la misma empresa son los mismos de siempre; si cambia a
  // otra, hay que pedirlos aparte (SSData no trae los almacenes de una empresa que no es la activa).
  useEffect(() => {
    setDestino('');
    if (empresaDestino === empresa) { setDestAlmacenes(almacenes); return; }
    let alive = true;
    setDestAlmacenesLoading(true);
    window.sb.from('almacenes').select('*').eq('empresa_id', empresaDestino).then(({ data }) => {
      if (alive) { setDestAlmacenes(data || []); setDestAlmacenesLoading(false); }
    });
    return () => { alive = false; };
  }, [empresaDestino]);

  // Precarga desde la selección masiva de Inventario (botón "Transferir" con productos ya
  // marcados) — recién cuando se elige el origen, porque el disponible depende del almacén.
  useEffect(() => {
    if (!origen || !preItems?.length || lineas.length > 0) return;
    const conStock = [];
    let sinStock = 0;
    preItems.forEach(p => {
      const disp = transfStockDisp(p.sku, origen);
      if (disp > 0) conStock.push({ sku: p.sku, nombre: p.nombre, cantidad: disp, disp });
      else sinStock++;
    });
    setLineas(conStock);
    setOmitidosSinStock(sinStock);
  }, [origen]);

  const encontrados = React.useMemo(() => {
    const q = buscar.trim().toLowerCase();
    if (!q || !origen) return [];
    return (SSData.productos || []).filter(p => p.activo !== false && (String(p.nombre || '').toLowerCase().includes(q) || String(p.sku || '').toLowerCase().includes(q)))
      .slice(0, 8);
  }, [buscar, origen]);

  function addLinea(p) {
    if (lineas.find(l => l.sku === p.sku)) { setBuscar(''); return; }
    const disp = transfStockDisp(p.sku, origen);
    setLineas([...lineas, { sku: p.sku, nombre: p.nombre, cantidad: 1, disp }]);
    setBuscar('');
  }
  function updLinea(sku, cant) { setLineas(lineas.map(l => l.sku === sku ? { ...l, cantidad: cant } : l)); }
  function delLinea(sku) { setLineas(lineas.filter(l => l.sku !== sku)); }

  async function submit() {
    setErr('');
    if (!origen) return setErr('Selecciona el almacén origen.');
    if (!destino) return setErr('Selecciona el almacén destino.');
    if (origen === destino) return setErr('El origen y el destino deben ser distintos.');
    if (!lineas.length) return setErr('Agrega al menos un producto.');
    for (const l of lineas) {
      const c = parseInt(l.cantidad) || 0;
      if (c <= 0) return setErr(`Cantidad inválida en ${l.sku}.`);
      const disp = transfStockDisp(l.sku, origen);
      if (c > disp) return setErr(`${l.sku}: cantidad (${c}) supera el disponible en origen (${disp}).`);
    }
    setSaving(true);
    const res = await window.crearTransferencia({ empresaOrigen: empresa, empresaDest: empresaDestino, almacenOrigen: origen, almacenDest: destino, items: lineas, notas });
    setSaving(false);
    if (res?.error) { setErr(res.error.message || 'Error al crear.'); return; }
    onDone();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 720, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center' }}><Icon name="truck" size={20} /></div>
          <div style={{ flex: 1 }}><h3 className="modal-title">Nueva transferencia</h3><div className="small">{cruzaEmpresas ? 'La mercancía sale de tu almacén y queda en tránsito hasta que la otra empresa la reciba.' : 'La mercancía sale del origen y queda en tránsito hasta que el destino la reciba.'}</div></div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body" style={{ flex: 1, overflowY: 'auto' }}>
          {misEmpresas.length > 1 && (
            <div className="mb-3">
              <label className="form-label">Empresa destino</label>
              <select className="select" style={{ width: '100%' }} value={empresaDestino} onChange={e => setEmpresaDestino(e.target.value)}>
                {misEmpresas.map(id => {
                  const info = empresasInfo.find(e => e.id === id);
                  return <option key={id} value={id}>{info?.nombre || id}{id === empresa ? ' (esta empresa)' : ''}</option>;
                })}
              </select>
            </div>
          )}
          {cruzaEmpresas && (
            <div className="card" style={{ padding: 10, marginBottom: 12, background: 'var(--brand-soft)', color: 'var(--brand)' }}>
              <div className="small"><Icon name="info" size={12} /> Los productos que no estén habilitados en {empresasInfo.find(e => e.id === empresaDestino)?.nombre || empresaDestino} se comparten con esa empresa automáticamente (mismo SKU, no se duplica el producto).</div>
            </div>
          )}
          <div className="grid-2">
            <div><label className="form-label">Almacén origen *</label>
              <select className="select" style={{ width: '100%' }} value={origen} onChange={e => { setOrigen(e.target.value); setLineas([]); }}>
                <option value="">Seleccionar…</option>{almacenes.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select></div>
            <div><label className="form-label">Almacén destino *</label>
              <select className="select" style={{ width: '100%' }} value={destino} onChange={e => setDestino(e.target.value)} disabled={destAlmacenesLoading}>
                <option value="">{destAlmacenesLoading ? 'Cargando…' : 'Seleccionar…'}</option>
                {destAlmacenes.filter(a => a.id !== origen).map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select></div>
          </div>
          {omitidosSinStock > 0 && (
            <div className="small muted mt-2">{omitidosSinStock} producto{omitidosSinStock !== 1 ? 's' : ''} de la selección sin stock disponible en este almacén — no se incluyeron.</div>
          )}

          <div className="mt-4">
            <label className="form-label">Agregar productos {!origen && <span className="small muted">— elige primero el origen</span>}</label>
            <input className="input" style={{ width: '100%' }} placeholder="Buscar por nombre o SKU…" value={buscar} disabled={!origen} onChange={e => setBuscar(e.target.value)} />
            {encontrados.length > 0 && (
              <div className="card" style={{ marginTop: 4, padding: 4, maxHeight: 200, overflowY: 'auto' }}>
                {encontrados.map(p => { const d = transfStockDisp(p.sku, origen); return (
                  <div key={p.sku} onClick={() => d > 0 && addLinea(p)} style={{ padding: '6px 10px', borderRadius: 6, cursor: d > 0 ? 'pointer' : 'not-allowed', opacity: d > 0 ? 1 : 0.5, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12.5 }}>{p.nombre} <span className="mono muted">{p.sku}</span></span>
                    <span className="small" style={{ color: d > 0 ? 'var(--success)' : 'var(--danger)' }}>disp: {d}</span>
                  </div>
                ); })}
              </div>
            )}
          </div>

          {lineas.length > 0 && (
            <div className="card mt-3" style={{ padding: 0, overflow: 'hidden' }}>
              <table className="tbl"><thead><tr><th>Producto</th><th className="num">Disp.</th><th className="num" style={{ width: 120 }}>Cantidad</th><th></th></tr></thead>
                <tbody>{lineas.map(l => (
                  <tr key={l.sku}>
                    <td><div style={{ fontSize: 12.5 }}>{l.nombre}</div><div className="mono small muted">{l.sku}</div></td>
                    <td className="num">{transfStockDisp(l.sku, origen)}</td>
                    <td className="num"><input className="input mono" type="number" min="1" value={l.cantidad} onChange={e => updLinea(l.sku, e.target.value)} style={{ width: 90, textAlign: 'right' }} /></td>
                    <td><button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => delLinea(l.sku)}><Icon name="x" size={13} /></button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          <div className="mt-3"><label className="form-label">Notas</label><input className="input" style={{ width: '100%' }} value={notas} onChange={e => setNotas(e.target.value)} placeholder="Referencia, motivo…" /></div>
          <div className="card mt-3" style={{ padding: 10, background: 'var(--bg-sunken)' }}><div className="small muted"><Icon name="info" size={12} /> Productos serializados (S/N): por ahora se transfieren por cantidad; el detalle de S/N por transferencia llegará en una fase posterior.</div></div>
          {err && <div style={{ marginTop: 12, padding: '8px 12px', background: '#fee2e2', color: '#b91c1c', borderRadius: 8, fontSize: 13 }}>{err}</div>}
        </div>
        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <div className="small muted">{lineas.length} producto{lineas.length !== 1 ? 's' : ''} · {lineas.reduce((s, l) => s + (parseInt(l.cantidad) || 0), 0)} unidades</div>
          <div className="flex gap-2">
            <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
            <button className="btn primary" onClick={submit} disabled={saving}><Icon name="truck" size={14} />{saving ? 'Enviando…' : 'Crear y enviar'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: detalle + recepción + cierre de una transferencia ────────────────
function DetalleTransferenciaModal({ transf, onClose, onChanged }) {
  const [recibiendo, setRecibiendo] = useState(false);
  const [recQty, setRecQty] = useState({});   // itemId → cantidad a recibir ahora
  const [firma, setFirma] = useState(null);   // base64 png de la firma del receptor
  const [showActividad, setShowActividad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [devolverAlm, setDevolverAlm] = useState('');
  // Filtrar por la empresa origen (devolverFaltante re-ingresa a esa empresa); en v1 same-empresa
  // coincide con la activa, pero deja el select correcto si se habilita cross-empresa.
  const almacenes = (window.getAlmacenes?.() || SSData.almacenes || []).filter(a => (a.empresa_id || transf.empresa_origen) === transf.empresa_origen);
  const t = transf;
  const items = t.items || [];
  const abierta = t.estado === 'en_transito' || t.estado === 'recibida_parcial' || t.estado === 'recibida';
  const puedeEditar = window.canUser?.('editar', 'inventory') !== false;
  const faltanteTotal = items.reduce((s, i) => s + ((i.cantidad_enviada || 0) - (i.cantidad_recibida || 0)), 0);
  const nadaRecibido = items.every(i => (i.cantidad_recibida || 0) === 0);

  function startRecibir() {
    const init = {}; items.forEach(i => { const pend = (i.cantidad_enviada || 0) - (i.cantidad_recibida || 0); if (pend > 0) init[i.id] = pend; });
    setRecQty(init); setRecibiendo(true); setFirma(null); setErr('');
  }
  async function confirmarRecepcion() {
    setErr('');
    const recepciones = Object.entries(recQty).map(([itemId, cantidad]) => ({ itemId, cantidad: parseInt(cantidad) || 0 })).filter(r => r.cantidad > 0);
    if (!recepciones.length) { setErr('Indica al menos una cantidad a recibir.'); return; }
    if (!firma) { setErr('El receptor debe firmar digitalmente la recepción.'); return; }
    setBusy(true);
    const res = await window.recibirTransferencia(t.id, recepciones, firma);
    setBusy(false);
    if (res?.error) { setErr(res.error.message); return; }
    setRecibiendo(false); setFirma(null); await onChanged();
  }
  async function cerrar() {
    if (!confirm(faltanteTotal > 0 ? `Se cerrará la transferencia. Quedan ${faltanteTotal} unidades sin recibir que se registrarán como faltante/merma. ¿Continuar?` : '¿Cerrar la transferencia?')) return;
    setBusy(true); const res = await window.cerrarTransferencia(t.id); setBusy(false);
    if (res?.error) { setErr(res.error.message); return; } await onChanged();
  }
  async function cancelar() {
    if (!confirm('¿Cancelar la transferencia? La mercancía enviada se re-ingresa al almacén origen.')) return;
    setBusy(true); const res = await window.cancelarTransferencia(t.id); setBusy(false);
    if (res?.error) { setErr(res.error.message); return; } await onChanged();
  }
  async function devolverFaltante() {
    if (!devolverAlm) { setErr('Elige el almacén donde re-ingresar el faltante.'); return; }
    setBusy(true); const res = await window.devolverFaltanteTransferencia(t.id, devolverAlm, t.empresa_origen); setBusy(false);
    if (res?.error) { setErr(res.error.message); return; } await onChanged();
  }
  function pdf(modo) { window.generateTransferenciaPDF?.(t, items, modo); }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 760, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center' }}><Icon name="truck" size={20} /></div>
          <div style={{ flex: 1 }}><h3 className="modal-title">{t.id}</h3><div className="small">{almNombre(t.almacen_origen)} → {almNombre(t.almacen_destino)} · <TransfEstadoChip estado={t.estado} /></div></div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body" style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
            <div><div className="small muted">Enviado por</div><div style={{ marginTop: 2 }}><CreadoPorCell nombre={t.enviado_por} size={22} /></div><div className="small muted" style={{ marginTop: 2 }}>{fmt.date(t.fecha_envio)}</div></div>
            {t.recibido_por && <div><div className="small muted">Recibido por</div><div style={{ marginTop: 2 }}><CreadoPorCell nombre={t.recibido_por} size={22} /></div><div className="small muted" style={{ marginTop: 2 }}>{fmt.date(t.fecha_recepcion)}</div></div>}
            {t.cerrado_por && <div><div className="small muted">Cerrado por</div><div style={{ marginTop: 2 }}><CreadoPorCell nombre={t.cerrado_por} size={22} /></div><div className="small muted" style={{ marginTop: 2 }}>{fmt.date(t.fecha_cierre)}</div></div>}
          </div>
          {t.notas && <div className="card" style={{ padding: 10, marginBottom: 12, background: 'var(--bg-sunken)' }}><div className="small">{t.notas}</div></div>}
          {t.firma_recepcion && !recibiendo && (
            <div className="card" style={{ padding: 10, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div><div className="small muted" style={{ marginBottom: 4 }}>Firma de recepción</div><img src={t.firma_recepcion} alt="firma" style={{ width: 160, height: 60, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }} /></div>
              <div className="small muted">Firmado por <strong style={{ color: 'var(--text)' }}>{t.recibido_por || '—'}</strong>{t.firma_recepcion_fecha ? ' · ' + fmt.date(t.firma_recepcion_fecha) : ''}</div>
            </div>
          )}

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Producto</th><th className="num">Enviado</th><th className="num">Recibido</th><th className="num">Pendiente</th>{recibiendo && <th className="num" style={{ width: 120 }}>Recibir ahora</th>}</tr></thead>
              <tbody>{items.map(i => { const pend = (i.cantidad_enviada || 0) - (i.cantidad_recibida || 0); return (
                <tr key={i.id}>
                  <td><div style={{ fontSize: 12.5 }}>{i.nombre}</div><div className="mono small muted">{i.sku}</div></td>
                  <td className="num">{i.cantidad_enviada}</td>
                  <td className="num">{i.cantidad_recibida}</td>
                  <td className="num" style={{ color: pend > 0 ? 'var(--warn)' : 'var(--success)' }}>{pend}</td>
                  {recibiendo && <td className="num">{pend > 0 ? <input className="input mono" type="number" min="0" max={pend} value={recQty[i.id] ?? ''} onChange={e => setRecQty({ ...recQty, [i.id]: e.target.value })} style={{ width: 90, textAlign: 'right' }} /> : <span className="muted">—</span>}</td>}
                </tr>
              ); })}</tbody>
            </table>
          </div>

          {recibiendo && (
            <div className="card mt-3" style={{ padding: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Firma de recepción <span style={{ color: 'var(--danger)' }}>*</span></div>
              <div className="small muted" style={{ marginBottom: 8 }}>Quien recibe ({window.__ssCurrentUser?.nombre || 'usuario actual'}) debe firmar para confirmar la mercancía recibida.</div>
              {firma ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <img src={firma} alt="firma" style={{ width: 220, height: 70, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }} />
                  <button className="btn ghost sm" onClick={() => setFirma(null)}><Icon name="edit" size={13} />Volver a firmar</button>
                </div>
              ) : (
                <SignaturePad height={160} onConfirm={png => setFirma(png)} />
              )}
            </div>
          )}

          {t.estado === 'cerrada' && faltanteTotal > 0 && !t.faltante_devuelto && puedeEditar && (
            <div className="card mt-3" style={{ padding: 12, border: '1px solid var(--warn)' }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Faltante documentado: {faltanteTotal} unidades</div>
              <div className="small muted" style={{ marginBottom: 8 }}>Si la mercancía apareció, puedes re-ingresar el faltante a un almacén.</div>
              <div className="flex gap-2">
                <select className="select" value={devolverAlm} onChange={e => setDevolverAlm(e.target.value)}>
                  <option value="">Almacén destino del faltante…</option>{almacenes.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select>
                <button className="btn secondary" onClick={devolverFaltante} disabled={busy}><Icon name="arrDn" size={13} />Devolver faltante</button>
              </div>
            </div>
          )}
          {t.estado === 'cerrada' && t.faltante_devuelto && <div className="small muted mt-2">↩ El faltante ya fue re-ingresado a un almacén.</div>}
          {err && <div style={{ marginTop: 12, padding: '8px 12px', background: '#fee2e2', color: '#b91c1c', borderRadius: 8, fontSize: 13 }}>{err}</div>}
        </div>
        <div className="modal-footer" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div className="flex gap-2">
            <button className="btn ghost sm" onClick={() => setShowActividad(true)} title="Historial de actividad"><Icon name="clock" size={13} />Actividad</button>
            <button className="btn ghost sm" onClick={() => pdf('recepcion')}><Icon name="download" size={13} />PDF recepción</button>
            {(t.estado === 'cerrada') && <button className="btn ghost sm" onClick={() => pdf('cierre')}><Icon name="download" size={13} />PDF cierre</button>}
          </div>
          <div className="flex gap-2">
            {!recibiendo && abierta && nadaRecibido && puedeEditar && <button className="btn ghost" style={{ color: 'var(--danger)' }} onClick={cancelar} disabled={busy}>Cancelar transferencia</button>}
            {!recibiendo && abierta && puedeEditar && <button className="btn secondary" onClick={cerrar} disabled={busy}>Cerrar</button>}
            {!recibiendo && (t.estado === 'en_transito' || t.estado === 'recibida_parcial') && puedeEditar && <button className="btn primary" onClick={startRecibir}><Icon name="check" size={14} />Recibir</button>}
            {recibiendo && <><button className="btn ghost" onClick={() => { setRecibiendo(false); setFirma(null); }} disabled={busy}>Cancelar</button><button className="btn primary" onClick={confirmarRecepcion} disabled={busy || !firma}><Icon name="check" size={14} />{busy ? 'Recibiendo…' : (firma ? 'Confirmar recepción' : 'Firma para confirmar')}</button></>}
          </div>
        </div>
      </div>
      {showActividad && <ActivityLogModal modulo="transferencias" entidadId={t.id} entidadLabel={t.id} onClose={() => setShowActividad(false)} />}
    </div>
  );
}

// ─── BulkPage helpers ────────────────────────────────────────────────────────
const BULK_HISTORY_KEY = 'ss-import-history';
const BULK_BATCH_SIZE  = 500;

function getBulkHistory() {
  try { return JSON.parse(localStorage.getItem(BULK_HISTORY_KEY) || '[]'); } catch(e) { return []; }
}
function addBulkHistoryEntry(entry) {
  try {
    const hist = getBulkHistory();
    hist.unshift(entry);
    localStorage.setItem(BULK_HISTORY_KEY, JSON.stringify(hist.slice(0, 200)));
  } catch(e) {}
}
function getNextImportId(tipo) {
  const hist = getBulkHistory();
  const prefix = tipo === 'productos' ? 'IMP-PROD-' : tipo === 'inventario' ? 'IMP-INV-' : 'IMP-PRC-';
  const max = hist.filter(h => h.id && h.id.startsWith(prefix))
    .map(h => parseInt(h.id.replace(prefix,''),10) || 0)
    .reduce((a,b) => Math.max(a,b), 0);
  return prefix + String(max + 1).padStart(4, '0');
}

const BULK_TEMPLATES = {
  productos: {
    label: 'Productos',
    filename: 'plantilla_productos.xlsx',
    headers: ['sku','nombre','marca','categoria','etiquetas','descripcion','costo','base','activo'],
    example: () => ['HIK-CAM-2MP-D','Cámara Domo HIKVISION 2MP','HIKVISION','Cámaras IP','Hogar / Seguridad / Cámaras','Descripción opcional',45.00,64.00,true],
  },
  inventario: {
    label: 'Inventario',
    filename: 'plantilla_inventario.xlsx',
    headers: ['sku','almacen_id','cantidad','minimo','maximo','locacion'],
    example: () => {
      const almacenes = window.getAlmacenes ? window.getAlmacenes() : SSData.almacenes;
      const first = almacenes[0] || { id: 'alm-01' };
      const locs = window.getLocaciones ? window.getLocaciones(first.id) : (SSData.locaciones?.[first.id] || []);
      const locExample = locs[0] || 'A-01-01';
      return ['HIK-CAM-2MP-D', first.id, 50, 5, 200, locExample];
    },
  },
  precios: {
    label: 'Listas de Precios',
    filename: 'plantilla_precios.xlsx',
    headers: ['lista_id','sku','precio'],
    example: () => {
      const firstLista = SSData.listasPrecios?.[0];
      return [firstLista?.id || 'lp-mayor', 'HIK-CAM-2MP-D', 58.00];
    },
  },
  seriales: {
    label: 'Seriales',
    filename: 'plantilla_seriales.xlsx',
    headers: ['sku','serial','almacen_id','garantia_meses','notas'],
    example: () => {
      const almacenes = window.getAlmacenes ? window.getAlmacenes() : SSData.almacenes;
      const first = almacenes[0] || { id: 'alm-01' };
      return ['HIK-CAM-2MP-D', 'SN-A1B2C3', first.id, 12, ''];
    },
  },
};

function bulkDownloadTemplate(tipo) {
  const tpl = BULK_TEMPLATES[tipo];
  if (!tpl) return;
  if (typeof XLSX === 'undefined') { alert('La librería XLSX no se ha cargado. Recarga la página.'); return; }

  const wb = XLSX.utils.book_new();
  const aoa = [tpl.headers];

  if (tipo === 'inventario') {
    const almacenes = window.getAlmacenes ? window.getAlmacenes() : SSData.almacenes;
    almacenes.forEach(a => {
      const locs = window.getLocaciones ? window.getLocaciones(a.id) : (SSData.locaciones?.[a.id] || []);
      const locEx = locs[0] || '';
      aoa.push(['HIK-CAM-2MP-D', a.id, 50, 5, 200, locEx]);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = tpl.headers.map(h => ({ wch: Math.max(14, h.length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario');

    // Hoja secundaria: referencia de almacenes y locaciones
    const refAoa = [['Almacén ID', 'Nombre', 'Empresa', 'Locaciones disponibles']];
    almacenes.forEach(a => {
      const locs = window.getLocaciones ? window.getLocaciones(a.id) : (SSData.locaciones?.[a.id] || []);
      refAoa.push([a.id, a.nombre, a.empresa_id || '', locs.join(' · ') || 'sin locaciones']);
    });
    const refWs = XLSX.utils.aoa_to_sheet(refAoa);
    refWs['!cols'] = [{ wch: 25 }, { wch: 32 }, { wch: 14 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, refWs, 'Referencia');
  } else if (tipo === 'seriales') {
    // Mostrar varios seriales para el MISMO sku (un serial por fila), y luego cómo
    // distribuir seriales del mismo sku en distintos almacenes / con distinta garantía.
    const almacenes = window.getAlmacenes ? window.getAlmacenes() : SSData.almacenes;
    const skuA = SSData.productos?.[0]?.sku || 'HIK-CAM-2MP-D';
    const skuB = SSData.productos?.[1]?.sku || 'DAH-CAM-5MP-D';
    const alm1 = almacenes[0]?.id || 'alm-01';
    const alm2 = almacenes[1]?.id || almacenes[0]?.id || 'alm-02';

    // Bloque 1: 5 seriales del mismo SKU en el mismo almacén (caso típico al recibir lote)
    aoa.push([skuA, 'SN-A-001', alm1, 12, 'Lote recibido OC-2026-001']);
    aoa.push([skuA, 'SN-A-002', alm1, 12, 'Lote recibido OC-2026-001']);
    aoa.push([skuA, 'SN-A-003', alm1, 12, 'Lote recibido OC-2026-001']);
    aoa.push([skuA, 'SN-A-004', alm1, 12, 'Lote recibido OC-2026-001']);
    aoa.push([skuA, 'SN-A-005', alm1, 12, 'Lote recibido OC-2026-001']);
    // Bloque 2: mismo SKU pero distribuido en otro almacén (mostrando que cada serial es único)
    aoa.push([skuA, 'SN-A-006', alm2, 12, 'Lote recibido OC-2026-001']);
    aoa.push([skuA, 'SN-A-007', alm2, 24, 'Garantía extendida']);
    // Bloque 3: otro SKU para mostrar que la plantilla mezcla SKUs sin problema
    aoa.push([skuB, 'SN-B-001', alm1, 12, '']);
    aoa.push([skuB, 'SN-B-002', alm1, 12, '']);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch:20 }, { wch:22 }, { wch:22 }, { wch:14 }, { wch:38 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Seriales');

    // Hoja Instrucciones — explicación al usuario de cómo cargar varios seriales
    const insAoa = [
      ['Cómo cargar varios seriales para un mismo producto'],
      [''],
      ['1. Cada serial va en SU PROPIA fila — un serial por línea.'],
      ['2. Para 100 unidades del mismo SKU recibidas en un mismo almacén:'],
      ['   repite el sku y el almacen_id en 100 filas, cambiando solo el campo "serial".'],
      ['3. El campo "serial" debe ser único por (empresa + sku). Un duplicado se rechaza al guardar.'],
      ['4. La garantía (en meses) puede variar por unidad — útil cuando un lote recibe extensión.'],
      ['5. Las "notas" son libres: número de orden de compra, lote, condición física, etc.'],
      ['6. Si el almacen_id no existe en la empresa actual, la fila se omite (revisar hoja "Almacenes").'],
      ['7. Si el sku no existe en productos, la fila se omite (revisar hoja "Productos").'],
      [''],
      ['Ejemplo de la hoja "Seriales":'],
      ['  • Filas 1-5 → 5 unidades del mismo SKU "' + skuA + '" recibidas en el mismo almacén'],
      ['  • Filas 6-7 → 2 unidades del mismo SKU pero en otro almacén (mismo lote distribuido)'],
      ['  • Filas 8-9 → otro SKU "' + skuB + '" — puedes mezclar varios SKUs en la misma plantilla'],
    ];
    const insWs = XLSX.utils.aoa_to_sheet(insAoa);
    insWs['!cols'] = [{ wch: 90 }];
    XLSX.utils.book_append_sheet(wb, insWs, 'Instrucciones');

    // Hoja Almacenes (referencia)
    const almAoa = [['Almacén ID', 'Nombre', 'Empresa']];
    almacenes.forEach(a => almAoa.push([a.id, a.nombre, a.empresa_id || '']));
    const almWs = XLSX.utils.aoa_to_sheet(almAoa);
    almWs['!cols'] = [{ wch: 25 }, { wch: 32 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, almWs, 'Almacenes');

    // Hoja Productos (referencia, primeros 200)
    const prodAoa = [['SKU', 'Nombre', 'Garantía meses (default)']];
    (SSData.productos || []).slice(0, 200).forEach(p => prodAoa.push([p.sku, p.nombre, p.garantia_meses || 0]));
    const prodWs = XLSX.utils.aoa_to_sheet(prodAoa);
    prodWs['!cols'] = [{ wch: 22 }, { wch: 40 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, prodWs, 'Productos');
  } else if (tipo === 'productos' && (SSData.productos || []).length > 0) {
    // Pedido explícito: "que tenga la plantilla para actualizar masivamente los precios de TODOS
    // los productos". Un header + una fila de ejemplo obliga a armar la lista de SKUs a mano;
    // con el catálogo ACTUAL ya precargado, actualizar precios es solo editar la columna `base`
    // (el precio de venta — ver pos.jsx, `p.base` es lo que arma el precio del POS) y volver a
    // subir el mismo archivo.
    (SSData.productos || []).forEach(p => aoa.push([
      p.sku, p.nombre || '', p.marca || '', p.categoria || '',
      Array.isArray(p.etiquetas) ? p.etiquetas.join(' / ') : (p.etiquetas || ''),
      p.descripcion || '', Number(p.costo) || 0, Number(p.base) || 0, p.activo !== false,
    ]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = tpl.headers.map(h => ({ wch: Math.max(14, h.length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, tpl.label);
  } else {
    aoa.push(tpl.example());
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = tpl.headers.map(h => ({ wch: Math.max(14, h.length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, tpl.label);

    // Hoja de listas para referencia (solo precios)
    if (tipo === 'precios' && SSData.listasPrecios?.length) {
      const refAoa = [['lista_id', 'nombre', 'descuento_%']];
      SSData.listasPrecios.forEach(l => refAoa.push([l.id, l.nombre || '', l.valor || 0]));
      const refWs = XLSX.utils.aoa_to_sheet(refAoa);
      refWs['!cols'] = [{ wch: 18 }, { wch: 28 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, refWs, 'Listas');
    }
  }

  XLSX.writeFile(wb, tpl.filename);
}

function bulkParseCSV(text) {
  const rows = [];
  let cur = '', inQ = false, row = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i+1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else { cur += ch; }
    } else if (ch === '"') { inQ = true; }
    else if (ch === ',') { row.push(cur.trim()); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (cur || row.length) { row.push(cur.trim()); rows.push(row); cur = ''; row = []; }
      if (ch === '\r' && text[i+1] === '\n') i++;
    } else { cur += ch; }
  }
  if (cur || row.length) { row.push(cur.trim()); rows.push(row); }
  return rows;
}

function bulkValidate(tipo, rawRows, extraSkus = null) {
  if (!rawRows.length) return [];
  const headers = rawRows[0].map(h => h.toLowerCase().trim());
  const dataRows = rawRows.slice(1).filter(r => r.some(c => c !== ''));
  const existing = SSData.productos || [];
  // Combinar SKUs de SSData con los traidos de DB (puede ser mucho más grande)
  const existingSkus = new Set(existing.map(p => p.sku));
  if (extraSkus) extraSkus.forEach(s => existingSkus.add(s));
  const almacenes = window.getAlmacenes ? window.getAlmacenes() : SSData.almacenes;
  const almIds = new Set(almacenes.map(a => a.id));
  const listas = SSData.listasPrecios || [];
  const listaIds = new Set(listas.map(l => l.id));

  return dataRows.map((raw, idx) => {
    const r = {};
    headers.forEach((h, i) => { r[h] = raw[i] !== undefined ? raw[i] : ''; });
    const errors = [], warns = [];

    if (tipo === 'productos') {
      if (!r.sku) errors.push('SKU requerido');
      if (!r.nombre) errors.push('Nombre requerido');
      const costo = parseFloat(r.costo);
      const base  = parseFloat(r.base);
      if (r.costo && isNaN(costo))  errors.push('Costo no es número');
      if (r.base  && isNaN(base))   errors.push('Base no es número');
      if (!isNaN(base) && base <= 0) errors.push('Base debe ser > 0');
      if (r.sku && !r.marca) warns.push('Sin marca');
      if (r.sku && !r.categoria) warns.push('Sin categoría');
      const isUpdate = r.sku && existingSkus.has(r.sku);
      // "Sin cambios" — el pedido explícito de ver qué precio SUBE/BAJA de verdad y qué queda
      // igual: sin esto, re-subir el mismo archivo (o uno con 2 SKUs tocados de 500) marcaba
      // TODO como "Actualizar" — cualquier SKU existente, cambiara algo o no.
      let sinCambio = false;
      if (isUpdate && !errors.length) {
        const prod = existing.find(p => p.sku === r.sku);
        if (prod) {
          const numIgual = (raw, actual) => raw === '' || raw == null || Math.abs((parseFloat(raw)||0) - (parseFloat(actual)||0)) < 0.005;
          const txtIgual = (raw, actual) => !raw || String(raw).trim() === String(actual||'').trim();
          sinCambio = numIgual(r.costo, prod.costo) && numIgual(r.base, prod.base)
            && txtIgual(r.nombre, prod.nombre) && txtIgual(r.marca, prod.marca) && txtIgual(r.categoria, prod.categoria);
        }
      }
      const status = errors.length ? 'error' : !isUpdate ? 'new' : sinCambio ? 'sin_cambio' : 'update';
      return { ...r, _idx: idx + 2, _status: status, _errors: errors, _warns: warns };
    }

    if (tipo === 'inventario') {
      if (!r.sku) errors.push('SKU requerido');
      if (!r.almacen_id) errors.push('almacen_id requerido');
      if (!r.cantidad && r.cantidad !== '0') errors.push('cantidad requerida');
      const qty = parseFloat(r.cantidad);
      if (!isNaN(qty) && qty < 0) errors.push('cantidad negativa');
      if (r.sku && !existingSkus.has(r.sku)) errors.push('SKU no existe en catálogo (será omitido)');
      if (r.almacen_id && !almIds.has(r.almacen_id)) errors.push('almacen_id no existe');
      if (r.almacen_id && almIds.has(r.almacen_id) && r.locacion) {
        const validLocs = window.getLocaciones ? window.getLocaciones(r.almacen_id) : [];
        if (validLocs.length > 0 && !validLocs.includes(r.locacion)) warns.push(`Locación "${r.locacion}" no está definida en el almacén`);
      }
      const isUpdate = r.sku && r.almacen_id && existingSkus.has(r.sku);
      return { ...r, _idx: idx + 2, _status: errors.length ? 'error' : isUpdate ? 'update' : 'new', _errors: errors, _warns: warns };
    }

    if (tipo === 'precios') {
      if (!r.lista_id) errors.push('lista_id requerido');
      if (!r.sku) errors.push('SKU requerido');
      if (!r.precio) errors.push('precio requerido');
      const precio = parseFloat(r.precio);
      if (r.precio && isNaN(precio)) errors.push('precio no es número');
      if (!isNaN(precio) && precio <= 0) errors.push('precio debe ser > 0');
      if (r.lista_id && !listaIds.has(r.lista_id)) errors.push('lista_id no existe');
      if (r.sku && !existingSkus.has(r.sku)) errors.push('SKU no existe en catálogo (será omitido)');
      const isUpdate = r.lista_id && r.sku && listaIds.has(r.lista_id);
      return { ...r, _idx: idx + 2, _status: errors.length ? 'error' : isUpdate ? 'update' : 'new', _errors: errors, _warns: warns };
    }

    if (tipo === 'seriales') {
      if (!r.sku)        errors.push('SKU requerido');
      if (!r.serial)     errors.push('serial requerido');
      if (!r.almacen_id) errors.push('almacen_id requerido');
      if (r.sku && !existingSkus.has(r.sku))             warns.push('SKU no existe en catálogo');
      if (r.almacen_id && !almIds.has(r.almacen_id))     errors.push('almacen_id no existe');
      const meses = r.garantia_meses === '' ? null : parseInt(r.garantia_meses);
      if (r.garantia_meses && isNaN(meses)) errors.push('garantia_meses no es número');
      if (meses !== null && !isNaN(meses) && meses < 0)  errors.push('garantia_meses no puede ser negativo');
      // Detectar duplicados dentro del mismo lote
      // (la unicidad real contra DB se valida al insertar)
      return { ...r, _idx: idx + 2, _status: errors.length ? 'error' : 'new', _errors: errors, _warns: warns };
    }

    return { ...r, _idx: idx + 2, _status: 'error', _errors: ['Tipo desconocido'], _warns: [] };
  });
}

async function bulkImportToSupabase(tipo, rows, onProgress) {
  const valid = rows.filter(r => r._status !== 'error');
  if (!valid.length) return { ok: 0, err: 0 };
  const tableMap = { productos: 'productos', inventario: 'inventario', precios: 'lista_precios_detalle', seriales: 'inventario_seriales' };
  const table = tableMap[tipo];
  if (!table) return { ok: 0, err: 0 };

  const empresa = window.currentEmpresa || 'demo1';
  const chunks = [];
  for (let i = 0; i < valid.length; i += BULK_BATCH_SIZE) chunks.push(valid.slice(i, i + BULK_BATCH_SIZE));

  let ok = 0, err = 0;
  for (let c = 0; c < chunks.length; c++) {
    onProgress && onProgress({ batch: c + 1, total: chunks.length, done: ok, errors: err });

    // ─── INVENTARIO: SUMA al stock existente y registra movimiento por fila ───
    if (tipo === 'inventario') {
      // Fetch stock actual para todas las filas del lote en una sola query
      const skus      = [...new Set(chunks[c].map(r => r.sku))];
      const almacenes = [...new Set(chunks[c].map(r => r.almacen_id))];
      const { data: existing } = await window.sb.from('inventario').select('*')
        .in('sku', skus).in('almacen_id', almacenes);
      const key = (sku, alm) => sku + '||' + alm;
      const existingMap = {};
      (existing || []).forEach(row => { existingMap[key(row.sku, row.almacen_id)] = row; });

      const importBatchId = 'IMP-' + Date.now() + '-' + c;
      const upserts = chunks[c].map(r => {
        const cur = existingMap[key(r.sku, r.almacen_id)] || {};
        const nuevaCantidad = (cur.cantidad || 0) + (parseFloat(r.cantidad) || 0);
        return {
          sku:        r.sku,
          almacen_id: r.almacen_id,
          cantidad:   nuevaCantidad,
          reservado:  cur.reservado || 0,
          minimo:     parseFloat(r.minimo) > 0 ? parseFloat(r.minimo) : (cur.minimo || 0),
          maximo:     parseFloat(r.maximo) > 0 ? parseFloat(r.maximo) : (cur.maximo || 0),
          locacion:   r.locacion || cur.locacion || '',
        };
      });
      try {
        const resp = await window.sb.from('inventario').upsert(upserts, { onConflict: 'sku,almacen_id' });
        if (resp.error) {
          err += chunks[c].length;
          console.error('[Bulk] Inventario error en lote', c+1, '·', resp.error.message);
        } else {
          ok += chunks[c].length;
          // Log de movimientos por cada fila (no awaiteamos el batch para no bloquear el progreso)
          const empresaActual = window.currentEmpresa || 'demo1';
          const usuario = window.__ssCurrentUser?.nombre || 'Sistema';
          const movRows = chunks[c].map(r => ({
            empresa_id:    empresaActual,
            usuario_id:    window.__ssCurrentUser?.id || null,
            usuario_nombre: usuario,
            modulo:        'inventario',
            accion:        'transferencia', // se renderiza como ingreso por bulk
            entidad_id:    r.sku,
            entidad_label: SSData.productos.find(p => p.sku === r.sku)?.nombre || r.sku,
            detalles: {
              tipo:             'ingreso',
              origen:           'importacion',
              cantidad:         parseFloat(r.cantidad) || 0,
              almacen_origen:   'IMPORT',
              almacen_destino:  (SSData.almacenes.find(a => a.id === r.almacen_id)?.nombre) || r.almacen_id,
              empresa_destino:  empresaActual,
              import_batch_id:  importBatchId,
              locacion:         r.locacion || null,
            },
          }));
          // Insertar todos los logs en lote
          window.sb.from('actividad_log').insert(movRows).then(({ error }) => {
            if (error) console.warn('[Bulk] No se pudo registrar log de movimientos:', error.message);
          });
        }
      } catch(e) { err += chunks[c].length; console.error('[Bulk] Excepción inventario lote', c+1, e); }
      await new Promise(res => setTimeout(res, 30));
      continue;
    }

    // ─── Resto de tipos: upsert simple (productos, precios, seriales) ───
    const payload = chunks[c].map((r, idx) => {
      if (tipo === 'productos') {
        const tags = String(r.etiquetas || '').split('/').map(s => s.trim()).filter(Boolean);
        return { sku: r.sku, nombre: r.nombre, marca: r.marca, categoria: r.categoria, descripcion: r.descripcion, costo: parseFloat(r.costo)||0, base: parseFloat(r.base)||0, activo: r.activo !== 'false', etiquetas: tags, empresa_id: window.currentEmpresa || 'demo1' };
      }
      if (tipo === 'precios') return { lista_id: r.lista_id, sku: r.sku, precio: parseFloat(r.precio)||0 };
      if (tipo === 'seriales') return {
        id:             'SER-' + Date.now() + '-' + c + '-' + idx,
        empresa_id:     empresa,
        sku:            r.sku,
        serial:         String(r.serial).trim(),
        almacen_id:     r.almacen_id,
        estado:         'disponible',
        garantia_meses: parseInt(r.garantia_meses) || 0,
        notas:          r.notas || null,
      };
      return r;
    });
    try {
      let resp;
      if (tipo === 'seriales') {
        resp = await window.sb.from(table).insert(payload);
      } else {
        const conflictKey = {
          productos:  'sku',
          precios:    'lista_id,sku',
        }[tipo] || 'sku';
        resp = await window.sb.from(table).upsert(payload, { onConflict: conflictKey });
      }
      if (resp.error) {
        err += chunks[c].length;
        console.error('[Bulk] Error en lote', c+1, '·', resp.error.message || resp.error, '· hint:', resp.error.hint, '· details:', resp.error.details);
      } else { ok += chunks[c].length; }
    } catch(e) { err += chunks[c].length; console.error('[Bulk] Excepción en lote', c+1, e); }
    await new Promise(res => setTimeout(res, 30));
  }

  // Productos: auto-crear etiquetas que no existan en el catálogo
  if (tipo === 'productos' && ok > 0) {
    try {
      const allTags = new Set();
      valid.forEach(r => {
        String(r.etiquetas || '').split('/').map(s => s.trim()).filter(Boolean).forEach(t => allTags.add(t));
      });
      if (allTags.size > 0) {
        const { data: existingTags } = await window.sb.from('etiquetas').select('nombre').eq('empresa_id', empresa);
        const existingLower = new Set((existingTags || []).map(t => (t.nombre || '').toLowerCase()));
        const toCreate = [...allTags].filter(t => !existingLower.has(t.toLowerCase()));
        if (toCreate.length > 0) {
          const COLOR_PALETTE = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#6366f1','#84cc16','#f97316'];
          const newRows = toCreate.map((nombre, i) => ({
            id:         'TAG-' + Date.now() + '-' + i,
            empresa_id: empresa,
            nombre,
            color:      COLOR_PALETTE[i % COLOR_PALETTE.length],
          }));
          const { error: tagErr } = await window.sb.from('etiquetas').insert(newRows);
          if (tagErr) console.warn('[Bulk] No se pudieron crear etiquetas nuevas:', tagErr.message);
          else console.info('[Bulk] Etiquetas creadas en catálogo:', toCreate);
        }
      }
    } catch(e) { console.warn('[Bulk] Error sincronizando etiquetas:', e); }
  }

  onProgress && onProgress({ batch: chunks.length, total: chunks.length, done: ok, errors: err });
  return { ok, err };
}

// ─── BulkPage component ───────────────────────────────────────────────────────
window.BulkPage = function BulkPage() {
  const [step, setStep]       = useState('home');  // home | preview | importing | done | history
  const [tipo, setTipo]       = useState(null);
  const [drop, setDrop]       = useState(false);
  const [fileName, setFileName] = useState('');
  const [rows, setRows]       = useState([]);
  const [filter, setFilter]   = useState('all');   // all | new | update | warn | error
  const [progress, setProgress] = useState(null);  // { batch, total, done, errors }
  const [result, setResult]   = useState(null);    // { ok, err, id, ts }
  const [history, setHistory] = useState(() => getBulkHistory());
  const [selDetail, setSelDetail] = useState(null);
  const [histPage, setHistPage] = useState(1);
  const [histPageSize, setHistPageSize] = useState(() => {
    const v = parseInt(localStorage.getItem('ss-bulkhist-pagesize'));
    return [50,100,200].includes(v) ? v : 50;
  });
  useEffect(() => { localStorage.setItem('ss-bulkhist-pagesize', String(histPageSize)); }, [histPageSize]);
  const fileInputRef = useRef(null);

  const validRows  = rows.filter(r => r._status !== 'error');
  const countMap   = { all: rows.length, new: 0, update: 0, sin_cambio: 0, warn: 0, error: 0 };
  rows.forEach(r => {
    if (r._status === 'new')        countMap.new++;
    if (r._status === 'update')     countMap.update++;
    if (r._status === 'sin_cambio') countMap.sin_cambio++;
    if (r._status === 'warn' || r._warns?.length) countMap.warn++;
    if (r._status === 'error')      countMap.error++;
  });
  const displayed  = filter === 'all' ? rows : rows.filter(r => {
    if (filter === 'warn')   return r._warns?.length > 0;
    return r._status === filter;
  });

  async function handleFile(file) {
    if (!file) return;
    if (!tipo) { alert('Selecciona primero el tipo de importación'); return; }
    setFileName(file.name);
    const isXlsx = /\.(xlsx|xls)$/i.test(file.name);

    // Pre-fetch valid SKUs from DB (current empresa) for tipos que dependen de productos.sku
    let extraSkus = null;
    if (tipo === 'inventario' || tipo === 'precios' || tipo === 'seriales') {
      try {
        const empresa = window.currentEmpresa || 'demo1';
        const { data } = await window.sb.from('productos').select('sku').overlaps('empresas', [empresa]);
        extraSkus = new Set((data || []).map(r => r.sku));
      } catch (e) {
        console.warn('[Bulk] No se pudo prefetch de SKUs, usando solo SSData:', e);
      }
    }

    const reader = new FileReader();
    reader.onload = e => {
      let parsed;
      if (isXlsx) {
        if (typeof XLSX === 'undefined') { alert('La librería XLSX no se ha cargado. Recarga la página.'); return; }
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
        parsed = aoa.map(row => row.map(c => c == null ? '' : String(c).trim()));
      } else {
        parsed = bulkParseCSV(e.target.result);
      }
      const validated = bulkValidate(tipo, parsed, extraSkus);
      setRows(validated);
      setFilter('all');
      setStep('preview');
    };
    if (isXlsx) reader.readAsArrayBuffer(file);
    else reader.readAsText(file, 'UTF-8');
  }

  function onDrop(e) {
    e.preventDefault(); setDrop(false);
    handleFile(e.dataTransfer.files[0]);
  }

  async function handleImport(skipErrors) {
    // Siempre filtrar errores: filas con SKU inválido o datos malos NUNCA se envían a DB.
    // "sin_cambio" tampoco se envía: escribir el mismo valor que ya está no aporta nada y son
    // justo las filas que el preview promete no tocar.
    const importRows = rows.filter(r => r._status !== 'error' && r._status !== 'sin_cambio');
    const skippedRows = rows.filter(r => r._status === 'error');
    if (!importRows.length) {
      alert(rows.some(r => r._status === 'sin_cambio')
        ? 'No hay nada que importar: todas las filas ya coinciden con el catálogo actual (o tienen errores).'
        : 'No hay filas válidas para importar. Todas tienen errores.');
      return;
    }
    const docId = getNextImportId(tipo);
    setStep('importing');
    setProgress({ batch: 0, total: Math.ceil(importRows.length / BULK_BATCH_SIZE), done: 0, errors: 0 });
    // Antes se aplicaba a SSData ANTES de confirmar el resultado en Supabase: un batch
    // fallido (RLS, red, constraint) dejaba productos/inventario fantasma en memoria,
    // sin persistir y sin forma de saber cuáles. bulkImportToSupabase ya reintenta/loguea
    // por batch; al terminar recargamos desde la DB para reflejar SOLO lo que sí se guardó.
    const res = await bulkImportToSupabase(tipo, importRows, p => setProgress({ ...p }));
    await window.loadAppData();

    // Resumen por status para el detalle
    const summary = { new: 0, update: 0, error: 0, warn: 0, skipped: skippedRows.length };
    rows.forEach(r => {
      if (r._status === 'new')    summary.new++;
      if (r._status === 'update') summary.update++;
      if (r._status === 'error')  summary.error++;
      if (r._warns?.length)       summary.warn++;
    });
    // Guardar las filas (capped a 1000 para no reventar localStorage)
    const rowsForHistory = rows.slice(0, 1000).map(r => {
      const { _status, _idx, _errors, _warns, ...data } = r;
      return { _status, _idx, _errors, _warns, data };
    });

    const entry = {
      id: docId, tipo, filename: fileName,
      total: importRows.length, ok: res.ok, err: res.err,
      ts: new Date().toISOString(),
      empresa: window.currentEmpresa || 'demo1',
      summary,
      headers: BULK_TEMPLATES[tipo]?.headers || [],
      rows: rowsForHistory,
      truncated: rows.length > 1000,
    };
    addBulkHistoryEntry(entry);
    setHistory(getBulkHistory());
    setResult({ ...res, id: docId, ts: entry.ts });
    window.logActivity?.({ modulo:'inventario', accion:'bulk_editar', entidad_id:docId, entidad_label:'Importación: '+tipo, detalles:{ total: importRows.length, tipo:'import', entidad:tipo, ok:res.ok, err:res.err } });
    setStep('done');
  }

  function reset() { setStep('home'); setTipo(null); setFileName(''); setRows([]); setProgress(null); setResult(null); setFilter('all'); }

  function renderStatusIcon(r) {
    if (r._status === 'new')        return <span style={{color:'var(--success)', display:'flex'}}><Icon name="plus" size={14}/></span>;
    if (r._status === 'update')     return <span style={{color:'var(--brand)', display:'flex'}}><Icon name="edit" size={14}/></span>;
    if (r._status === 'sin_cambio') return <span style={{color:'var(--text-muted)', display:'flex'}}><Icon name="check" size={14}/></span>;
    if (r._status === 'error')      return <span style={{color:'var(--danger)', display:'flex'}}><Icon name="x" size={14}/></span>;
    return <span style={{color:'var(--warn)', display:'flex'}}><Icon name="info" size={14}/></span>;
  }

  function renderRowChip(r) {
    if (r._errors?.length) return <span className="chip red" title={r._errors.join(', ')}>{r._errors[0]}</span>;
    if (r._warns?.length)  return <span className="chip amber" title={r._warns.join(', ')}>{r._warns[0]}</span>;
    if (r._status === 'new')        return <span className="chip green">Nuevo</span>;
    if (r._status === 'update')     return <span className="chip blue">Actualizar</span>;
    if (r._status === 'sin_cambio') return <span className="chip neutral">Sin cambios</span>;
    return null;
  }

  const tipoOpts = [
    { id: 'productos',   label: 'Productos',         sub: 'Crea o actualiza SKUs masivamente', icon: 'inventory' },
    { id: 'inventario',  label: 'Inventario',        sub: 'Ajustes de stock por almacén',      icon: 'warehouse' },
    { id: 'precios',     label: 'Listas de Precios', sub: 'Actualiza precios por lista',       icon: 'price'    },
    { id: 'seriales',    label: 'Seriales',          sub: 'Carga seriales por SKU y almacén',  icon: 'check'    },
  ];

  // ── HOME ──────────────────────────────────────────────────────────────────
  if (step === 'home') return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Cargas Masivas</h1>
          <div className="page-subtitle">Importa productos, inventarios y listas de precios desde CSV</div>
        </div>
        <div className="page-actions">
          <button className="btn ghost" onClick={() => setStep('history')}><Icon name="doc" size={14}/>Historial</button>
        </div>
      </div>

      <div className="grid-3 mt-2">
        {tipoOpts.map(o => (
          <div key={o.id} className="card" onClick={() => setTipo(o.id)}
            style={{padding:16, cursor:'pointer', border: tipo === o.id ? '2px solid var(--brand)' : '2px solid transparent', transition:'border .1s'}}>
            <div className="flex items-center gap-3">
              <div style={{width:36,height:36,borderRadius:8,background: tipo===o.id ? 'var(--brand)' : 'var(--brand-soft)',color: tipo===o.id ? '#fff' : 'var(--brand)',display:'grid',placeItems:'center',transition:'all .1s'}}>
                <Icon name={o.icon} size={18}/>
              </div>
              <div>
                <div style={{fontWeight:600,fontSize:14}}>{o.label}</div>
                <div className="small">{o.sub}</div>
              </div>
              {tipo === o.id && <Icon name="check" size={16} style={{marginLeft:'auto',color:'var(--brand)'}}/>}
            </div>
          </div>
        ))}
      </div>

      {tipo && (
        <div className="card mt-4" style={{padding:16}}>
          <div className="flex items-center gap-3 mb-3">
            <strong style={{fontSize:13}}>Plantilla CSV para {BULK_TEMPLATES[tipo]?.label}</strong>
            <button className="btn secondary sm" style={{marginLeft:'auto'}} onClick={() => bulkDownloadTemplate(tipo)}>
              <Icon name="download" size={13}/>Descargar plantilla
            </button>
          </div>
          <div style={{background:'var(--bg-sunken)',borderRadius:8,padding:'10px 14px',fontFamily:'var(--font-mono)',fontSize:12,color:'var(--text-muted)',overflowX:'auto',whiteSpace:'nowrap'}}>
            {BULK_TEMPLATES[tipo]?.headers.join(',')}<br/>
            <span style={{color:'var(--text-2)'}}>{BULK_TEMPLATES[tipo]?.example().join(',')}</span>
          </div>
          {tipo === 'productos' && (
            <div className="small mt-2">
              La plantilla trae <strong>todo el catálogo actual</strong> (los {(SSData.productos||[]).length.toLocaleString('es-VE')} SKU), listo para editar —
              para actualizar precios de forma masiva, edita la columna <code>base</code> (precio de venta) o <code>costo</code> y vuelve a subir el archivo.
              El preview te muestra qué SKU sube, cuál baja y cuál queda igual antes de confirmar.
            </div>
          )}
        </div>
      )}

      <div
        className="bulk-dropzone"
        onDragOver={e=>{e.preventDefault();setDrop(true);}}
        onDragLeave={()=>setDrop(false)}
        onDrop={onDrop}
        onClick={() => tipo && fileInputRef.current?.click()}
        style={{
          marginTop:16, border:'2px dashed '+(drop?'var(--brand)':'var(--border-strong)'),
          borderRadius:12, padding:40, textAlign:'center',
          background: drop?'var(--brand-soft)':'var(--bg-elev)',
          cursor: tipo?'pointer':'not-allowed', opacity: tipo?1:0.5, transition:'all .1s',
        }}>
        <div style={{width:48,height:48,borderRadius:12,background:'var(--bg-sunken)',color:'var(--text-muted)',display:'grid',placeItems:'center',margin:'0 auto 12px'}}>
          <Icon name="upload" size={22}/>
        </div>
        <div style={{fontSize:15,fontWeight:500}}>
          {tipo ? 'Arrastra tu CSV aquí o haz clic para buscar' : 'Selecciona un tipo de importación primero'}
        </div>
        <div className="small mt-2">Acepta .xlsx, .xls, .csv · máximo 50 MB · ilimitado de filas (procesado en lotes de {BULK_BATCH_SIZE})</div>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" style={{display:'none'}} onChange={e => handleFile(e.target.files[0])}/>
      </div>
    </div>
  );

  // ── PREVIEW ───────────────────────────────────────────────────────────────
  if (step === 'preview') {
    const cols = rows.length ? Object.keys(rows[0]).filter(k => !k.startsWith('_')) : [];
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Vista Previa · {BULK_TEMPLATES[tipo]?.label}</h1>
            <div className="page-subtitle">{fileName}</div>
          </div>
          <div className="page-actions">
            <button className="btn ghost" onClick={reset}>Cancelar</button>
          </div>
        </div>

        <div className="card" style={{padding:14,marginBottom:12}}>
          <div className="flex items-center gap-3">
            <div style={{width:40,height:40,borderRadius:8,background:'var(--success-soft)',color:'var(--success)',display:'grid',placeItems:'center'}}>
              <Icon name="doc" size={18}/>
            </div>
            <div style={{flex:1}}>
              <div style={{fontWeight:500}}>{fileName}</div>
              <div className="small">{rows.length} filas analizadas</div>
            </div>
            <div className="flex gap-2">
              {countMap.new        > 0 && <span className="chip green">{countMap.new} nuevos</span>}
              {countMap.update     > 0 && <span className="chip blue">{countMap.update} actualizar</span>}
              {countMap.sin_cambio > 0 && <span className="chip neutral">{countMap.sin_cambio} sin cambios</span>}
              {countMap.warn       > 0 && <span className="chip amber">{countMap.warn} advertencias</span>}
              {countMap.error      > 0 && <span className="chip red">{countMap.error} errores</span>}
            </div>
          </div>
        </div>

        <div className="tbl-wrap">
          <div className="tbl-toolbar">
            <div className="bulk-filter-tabs flex gap-1" style={{overflowX:'auto', flexWrap:'nowrap'}}>
              {['all','new','update','sin_cambio','warn','error'].filter(f => f==='all' || countMap[f] > 0).map(f => (
                <button key={f} className={'btn sm '+(filter===f?'primary':'ghost')} onClick={() => setFilter(f)} style={{whiteSpace:'nowrap', flexShrink:0}}>
                  {f==='all'?'Todos':f==='new'?'Nuevos':f==='update'?'Actualizar':f==='sin_cambio'?'Sin cambios':f==='warn'?'Adv.':'Errores'}
                  {f!=='all' && <span style={{marginLeft:4,background:'rgba(255,255,255,.25)',borderRadius:99,padding:'1px 5px',fontSize:10}}>{countMap[f]}</span>}
                </button>
              ))}
            </div>
            <span className="small ml-auto">{displayed.length} de {rows.length} filas</span>
          </div>
          <div className="tbl-scroll" style={{maxHeight:400}}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{width:32}}></th>
                  <th style={{width:48}}>#</th>
                  {cols.map(c => <th key={c}>{c}</th>)}
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {displayed.slice(0,200).map((r,i) => (
                  <tr key={i} style={{background: r._status==='error'?'var(--danger-soft)': r._warns?.length?'var(--warn-soft)':'inherit'}}>
                    <td>{renderStatusIcon(r)}</td>
                    <td className="muted mono-cell">{r._idx}</td>
                    {cols.map(c => <td key={c} className={typeof r[c]==='number'?'num':''}>{r[c]??''}</td>)}
                    <td>{renderRowChip(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bulk-preview-actions flex gap-2 mt-4 justify-between" style={{flexWrap:'wrap'}}>
          <button className="btn secondary" onClick={reset}>Cancelar</button>
          <div className="flex gap-2 items-center" style={{flexWrap:'wrap'}}>
            {countMap.error > 0 && (
              <span className="small muted">{countMap.error} {countMap.error === 1 ? 'fila será omitida' : 'filas serán omitidas'}</span>
            )}
            {window.canUser?.('crear','bulk') !== false && (
            <button className="btn primary" disabled={validRows.length === 0} onClick={() => handleImport(true)}>
              <Icon name="check" size={14}/>Procesar {validRows.length} {BULK_TEMPLATES[tipo]?.label}
            </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── IMPORTING ─────────────────────────────────────────────────────────────
  if (step === 'importing') {
    const pct = progress ? Math.round((progress.batch / Math.max(progress.total, 1)) * 100) : 0;
    return (
      <div className="page">
        <div style={{maxWidth:500,margin:'80px auto',textAlign:'center'}}>
          <div style={{width:64,height:64,borderRadius:16,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center',margin:'0 auto 24px'}}>
            <Icon name="upload" size={28}/>
          </div>
          <h2 style={{fontSize:20,fontWeight:700,marginBottom:8}}>Importando {BULK_TEMPLATES[tipo]?.label}…</h2>
          <div className="small mb-6" style={{marginBottom:24}}>
            Lote {progress?.batch || 0} de {progress?.total || 1} · {progress?.done || 0} filas procesadas
          </div>
          <div style={{height:8,borderRadius:99,background:'var(--border)',overflow:'hidden',marginBottom:12}}>
            <div style={{height:'100%',borderRadius:99,background:'var(--brand)',width:pct+'%',transition:'width .3s'}}/>
          </div>
          <div className="small">{pct}% completado</div>
          {progress?.errors > 0 && <div className="small mt-2" style={{color:'var(--danger)'}}>{progress.errors} errores al importar</div>}
        </div>
      </div>
    );
  }

  // ── DONE ──────────────────────────────────────────────────────────────────
  if (step === 'done' && result) return (
    <div className="page">
      <div style={{maxWidth:480,margin:'80px auto',textAlign:'center'}}>
        <div style={{width:64,height:64,borderRadius:16,background: result.err===0?'var(--success-soft)':'var(--warn-soft)',color:result.err===0?'var(--success)':'var(--warn)',display:'grid',placeItems:'center',margin:'0 auto 24px'}}>
          <Icon name={result.err===0?'check':'info'} size={28}/>
        </div>
        <h2 style={{fontSize:20,fontWeight:700,marginBottom:8}}>{result.err===0?'Importación completada':'Importación con errores'}</h2>
        <div style={{fontSize:13,color:'var(--text-2)',marginBottom:24}}>
          Documento: <strong style={{fontFamily:'var(--font-mono)'}}>{result.id}</strong>
        </div>
        <div className="card" style={{padding:20,textAlign:'left',marginBottom:24}}>
          <div className="flex justify-between mb-2"><span className="small">Tipo</span><strong>{BULK_TEMPLATES[tipo]?.label}</strong></div>
          <div className="flex justify-between mb-2"><span className="small">Archivo</span><strong>{fileName}</strong></div>
          <div className="flex justify-between mb-2"><span className="small">Procesadas OK</span><strong style={{color:'var(--success)'}}>{result.ok}</strong></div>
          {result.err > 0 && <div className="flex justify-between"><span className="small">Con error</span><strong style={{color:'var(--danger)'}}>{result.err}</strong></div>}
          <div className="flex justify-between mt-2"><span className="small">Fecha</span><span className="small">{fmt.date(result.ts)}</span></div>
        </div>
        <div className="flex gap-3 justify-center">
          <button className="btn secondary" onClick={() => { setStep('history'); setHistory(getBulkHistory()); }}>Ver historial</button>
          <button className="btn primary" onClick={reset}>Nueva importación</button>
        </div>
      </div>
    </div>
  );

  // ── HISTORY ───────────────────────────────────────────────────────────────
  if (step === 'history') return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Historial de Importaciones</h1>
          <div className="page-subtitle">{history.length} importaciones registradas</div>
        </div>
        <div className="page-actions">
          <button className="btn secondary" onClick={reset}><Icon name="plus" size={14}/>Nueva importación</button>
        </div>
      </div>
      <div className="tbl-wrap mt-2">
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Documento</th>
                <th className="hide-sm">Tipo</th>
                <th className="hide-sm">Archivo</th>
                <th className="num">Total</th>
                <th className="num">OK</th>
                <th className="num">Errores</th>
                <th className="hide-sm">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr><td colSpan={7} style={{textAlign:'center',padding:'32px 0',color:'var(--text-muted)'}}>Sin importaciones aún</td></tr>
              )}
              {history.slice((histPage-1)*histPageSize, histPage*histPageSize).map((h,i) => (
                <tr key={i} onClick={() => setSelDetail(h)} style={{cursor:'pointer'}} className="tbl-row-hover">
                  <td className="mono-cell">
                    <div>{h.id}</div>
                    <div className="show-sm-only small muted" style={{fontSize:10.5}}>
                      {BULK_TEMPLATES[h.tipo]?.label || h.tipo} · {fmt.date(h.ts)}
                    </div>
                  </td>
                  <td className="hide-sm"><span className="chip neutral">{BULK_TEMPLATES[h.tipo]?.label || h.tipo}</span></td>
                  <td className="muted hide-sm">{h.filename}</td>
                  <td className="num">{h.total}</td>
                  <td className="num" style={{color:'var(--success)'}}>{h.ok}</td>
                  <td className="num" style={{color: h.err>0?'var(--danger)':'var(--text-muted)'}}>{h.err}</td>
                  <td className="muted hide-sm">{fmt.date(h.ts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {history.length > 0 && (() => {
          const histTotalPages = Math.max(1, Math.ceil(history.length / histPageSize));
          const safeHistPage = Math.min(histPage, histTotalPages);
          return (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 16px', borderTop:'1px solid var(--border)', fontSize:12, gap:8, flexWrap:'wrap' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <select className="select" value={histPageSize} onChange={e => { setHistPageSize(parseInt(e.target.value)); setHistPage(1); }} style={{ fontSize:12, padding:'3px 6px' }}>
                  {[50,100,200].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <span className="muted">{history.length} importaciones · página {safeHistPage} de {histTotalPages}</span>
              </div>
              {histTotalPages > 1 && (
                <div style={{ display:'flex', gap:4 }}>
                  <button className="btn ghost sm" disabled={safeHistPage===1} onClick={()=>setHistPage(p=>Math.max(1,p-1))}><Icon name="chevronL" size={13}/></button>
                  {Array.from({length:Math.min(5,histTotalPages)},(_,i)=>Math.max(1,Math.min(histTotalPages-4,safeHistPage-2))+i).filter(p=>p>=1&&p<=histTotalPages).map(p=>(
                    <button key={p} className={'btn sm '+(p===safeHistPage?'primary':'ghost')} style={{minWidth:32}} onClick={()=>setHistPage(p)}>{p}</button>
                  ))}
                  <button className="btn ghost sm" disabled={safeHistPage===histTotalPages} onClick={()=>setHistPage(p=>Math.min(histTotalPages,p+1))}><Icon name="chevronR" size={13}/></button>
                </div>
              )}
            </div>
          );
        })()}
      </div>
      {selDetail && <BulkHistoryDetailModal entry={selDetail} onClose={() => setSelDetail(null)}/>}
    </div>
  );

  return null;
};

// ======= Modal: Ajuste de inventario (conteo: cuánto queda) =======
// SE CUENTA, NO SE SUMA NI SE RESTA. Por línea se escribe LA CANTIDAD QUE QUEDA y el sistema calcula
// la diferencia. Antes había un interruptor Entrada/Salida para todo el ajuste, y eso rompía el caso
// que lo motivó (2026-08-11): "necesito rebajar 1000 unidades de MVT-RJ45-CAT6-1000 y aumentar 10 de
// MVT-RJ45-CAT6-100 — pasar 1 bobina a 10 cajas. Tendría que hacer 2 operaciones y quiero hacerlo
// ahí mismo". Un reempaque es UN hecho con dos patas; partirlo deja el kardex con dos movimientos
// sin relación y a quien audite sin forma de saber que uno explica al otro.
//
// Contar es además como se trabaja de verdad: quien está en el almacén sabe cuántas hay, no cuántas
// cambiaron. La dirección la deduce el signo de la diferencia, así que el mismo ajuste puede subir
// unos códigos y bajar otros. Motivo, notas y almacén son del ajuste (un evento) y las líneas
// comparten `ref_documento`, así que en el kardex quedan casadas.
//
// NO es atómico —son N llamadas a `inv_ajustar_cantidad`— y por eso hay dos reglas: se valida TODO
// antes de escribir nada, y si aun así una línea falla se dice exactamente cuáles entraron y cuáles
// no. Un "listo" sobre un ajuste a medio aplicar es peor que el error: nadie va a volver a contar el
// almacén para descubrirlo.
function AjusteInventarioModal({ onClose, skuInicial, onUpdate }) {
  const [lineas, setLineas]     = useState([{ sku: skuInicial || '', queda: '' }]);
  const [almacenId, setAlmacenId] = useState('');
  const [motivo, setMotivo]     = useState('');
  const [notas, setNotas]       = useState('');
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState('');
  const [ok, setOk]             = useState('');
  const [parcial, setParcial]   = useState(null);   // { hechas: [...], fallidas: [{sku, motivo}] }
  // Número del último ajuste hecho en este modal. Se muestra aparte del mensaje —que se borra a los
  // 6 segundos— porque es el dato que hay que anotar: con él se vuelve a encontrar el ajuste en
  // Movimientos de Inventario meses después.
  const [ultimoAjuste, setUltimoAjuste] = useState('');
  // Los datos del comprobante del último ajuste, para poder VOLVER a bajarlo sin rehacer nada. Se
  // guardan aparte del mensaje de éxito —que se borra a los 6 segundos— por el mismo motivo que el
  // número: el papel es lo que se archiva, y el navegador puede haber bloqueado la descarga.
  const [ultimoComprobante, setUltimoComprobante] = useState(null);
  const [serialesInput, setSerialesInput]     = useState('');
  const [garantiaMesesAdj, setGarantiaMesesAdj] = useState('12');

  const productos = SSData.productos || [];
  const almacenes = window.getAlmacenes ? window.getAlmacenes() : (SSData.almacenes || []);
  // Con UN solo almacén no hay nada que elegir: dejarlo vacío solo consigue que la columna "Hay"
  // salga sin número y parezca que no hay stock. Con varios NO se elige por el usuario — ajustar el
  // almacén equivocado es un descuadre que después hay que salir a buscar.
  useEffect(() => { if (!almacenId && almacenes.length === 1) setAlmacenId(almacenes[0].id); }, [almacenes.length]);
  const slotDe    = (s) => (s && almacenId) ? safeInv(s, almacenId) : { cantidad: 0, reservado: 0 };
  // DÓNDE MÁS HAY. Pedido el 2026-08-11: "si hay 0, un mensajito que me diga en cuáles sí tengo,
  // unas letras abajito, solo informativo". Ver 0 en el almacén elegido no dice si el producto se
  // acabó o si está en otro lado, y esas dos cosas se resuelven distinto: una es reponer, la otra
  // es traerlo. Es informativo — no cambia el ajuste, que sigue siendo contra el almacén elegido.
  function otrosAlmacenes(sku) {
    if (!sku) return [];
    return almacenes
      .filter(a => a.id !== almacenId)
      .map(a => ({ nombre: a.nombre, cantidad: (safeInv(sku, a.id) || {}).cantidad || 0 }))
      .filter(x => x.cantidad > 0)
      .sort((a, b) => b.cantidad - a.cantidad);
  }
  const actualDe  = (l) => slotDe(l.sku).cantidad || 0;
  // Solo cuenta como línea llena si escribieron un número: "0" es una cuenta válida (se acabó), y
  // por eso no se puede usar `parseInt(...) || 0` para saber si el campo está lleno.
  const lleno     = (l) => l.sku && String(l.queda).trim() !== '' && !isNaN(parseInt(l.queda));
  const quedaDe   = (l) => parseInt(l.queda) || 0;
  const deltaDe   = (l) => lleno(l) ? quedaDe(l) - actualDe(l) : 0;

  function setLinea(i, patch) { setLineas(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l)); }
  function addLinea()  { setLineas(ls => [...ls, { sku: '', queda: '' }]); }
  function delLinea(i) { setLineas(ls => ls.length === 1 ? [{ sku: '', queda: '' }] : ls.filter((_, j) => j !== i)); }

  const lineasLlenas = lineas.filter(lleno);
  const conCambio    = lineasLlenas.filter(l => deltaDe(l) !== 0);
  const suben  = conCambio.filter(l => deltaDe(l) > 0);
  const bajan  = conCambio.filter(l => deltaDe(l) < 0);
  // Los S/N son de UN producto: pedirlos en una grilla de varios sería inmanejable y quedarían
  // ambiguos. Con una sola línea el modal sigue haciendo exactamente lo de antes.
  const unicaSku  = lineas.length === 1 ? lineas[0].sku : '';
  const prodUnico = unicaSku ? productos.find(p => p.sku === unicaSku) : null;
  const unicaSube = lineas.length === 1 && deltaDe(lineas[0]) > 0;

  // El motivo tiene que servir a las dos direcciones: un mismo ajuste puede subir unos códigos y
  // bajar otros. Se unifican las dos listas (conteo físico, transferencia y otro estaban repetidos).
  const MOTIVOS = [
    { id:'conteo_fisico',  l:'Ajuste por conteo físico' },
    { id:'reempaque',      l:'Reempaque / cambio de presentación' },
    { id:'compra',         l:'Compra a proveedor' },
    { id:'devolucion',     l:'Devolución de cliente' },
    { id:'transferencia',  l:'Recepción de transferencia' },
    { id:'merma',          l:'Merma / pérdida' },
    { id:'dano',           l:'Daño físico' },
    { id:'robo',           l:'Robo / sustracción' },
    { id:'consumo_interno',l:'Consumo interno' },
    { id:'donacion',       l:'Donación (recibida o entregada)' },
    { id:'otro',           l:'Otro' },
  ];

  async function handleSave() {
    setErr(''); setParcial(null);
    if (!almacenId) { setErr('Selecciona un almacén.'); return; }
    if (!motivo)    { setErr('Selecciona un motivo.'); return; }
    if (!lineasLlenas.length) { setErr('Agrega al menos un producto y escribe cuánto queda.'); return; }
    // Una línea a medio llenar es un descuido, no una línea vacía: ignorarla en silencio dejaría el
    // ajuste incompleto y nadie se enteraría hasta el próximo conteo.
    const aMedias = lineas.find(l => (l.sku && String(l.queda).trim() === '') || (!l.sku && String(l.queda).trim() !== ''));
    if (aMedias) { setErr('Hay una línea incompleta: cada producto necesita cuánto queda (y viceversa).'); return; }
    const repetido = lineasLlenas.map(l => l.sku).find((s, i, arr) => arr.indexOf(s) !== i);
    if (repetido) { setErr(`El producto ${repetido} está dos veces. Deja una sola línea con la cantidad final.`); return; }
    if (!conCambio.length) { setErr('Ninguna línea cambia el stock: la cantidad que escribiste es la que ya hay.'); return; }

    // ── Se valida TODO antes de escribir la primera línea ──────────────────────────
    const problemas = [];
    for (const l of conCambio) {
      const prodSel = productos.find(p => p.sku === l.sku);
      const s = slotDe(l.sku);
      if (quedaDe(l) < 0) { problemas.push(`${l.sku}: la cantidad final no puede ser negativa.`); continue; }
      if (deltaDe(l) < 0) {
        // Bug #11: una salida sobre un producto serializado NO da de baja los S/N (el bloque de
        // seriales solo corre en entradas), dejando seriales_disponibles > cantidad física. Como este
        // modal no pide qué S/N salen, se bloquea para no romper la trazabilidad serial.
        if (prodSel?.serializado) {
          problemas.push(`${l.sku}: producto serializado, bajarlo necesita decir QUÉ S/N salen (usá despacho / devolución / inspección de seriales).`);
        } else if (quedaDe(l) < (s.reservado || 0)) {
          problemas.push(`${l.sku}: hay ${s.reservado} unidades reservadas por órdenes, no puede quedar en ${quedaDe(l)}.`);
        }
      }
    }
    // Bug #26: en entradas de producto serializado con S/N ingresados, la cantidad de S/N debe
    // coincidir con lo que sube. Antes la UI solo advertía (chip amarillo) pero no bloqueaba: con
    // +5 y 8 S/N pegados entraban 5 al stock y 8 S/N quedaban 'disponible' → seriales > stock.
    if (unicaSube && prodUnico?.serializado && serialesInput.trim()) {
      const listaSn = serialesInput.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
      const dupSn = listaSn.filter((s, i) => listaSn.indexOf(s) !== i);
      if (dupSn.length > 0) problemas.push(`Hay S/N duplicados en la lista: ${[...new Set(dupSn)].join(', ')}.`);
      else if (listaSn.length !== deltaDe(lineas[0])) {
        problemas.push(`La cantidad de S/N (${listaSn.length}) debe coincidir con las ${deltaDe(lineas[0])} unidades que entran.`);
      }
    }
    if (problemas.length) { setErr(problemas.join(' · ')); return; }

    setSaving(true);
    const motivoLbl     = MOTIVOS.find(m => m.id === motivo)?.l || motivo;
    const empresaActual = window.currentEmpresa || 'demo1';
    const usuario       = window.__ssCurrentUser?.nombre || 'Sistema';
    const almacen       = almacenes.find(a => a.id === almacenId);
    // ── NÚMERO DEL AJUSTE ────────────────────────────────────────────────────────────────────
    // Pedido de Pedro el 2026-08-12: "al realizar el ajuste no genera ningún documento; sería
    // importante que tuviese un número correlativo para revisión futura". Antes era
    // `AJU-${Date.now()}` —un epoch de 13 dígitos, ilegible e imposible de dictar— y SOLO se
    // generaba cuando el ajuste tenía más de una línea: un ajuste de un producto no dejaba
    // ninguna referencia con la cual volver a encontrarlo.
    // Ahora sale de la misma máquina de correlativos que los documentos (`siguiente_correlativo`,
    // atómico y sin choques entre dos terminales ajustando a la vez) → `AJU-2026-0001`.
    // Todas las líneas del ajuste comparten el número: en el kardex, la salida de la bobina y la
    // entrada de las cajas quedan hermanadas y se ve que una explica a la otra.
    // Si el correlativo fallara NO se corta el ajuste: se cae al epoch, que es feo pero único —
    // quedarse sin poder contar el almacén por no poder numerar el papel sería peor.
    let loteId = null;
    try { loteId = await window.nextCorrelativo?.('AJU'); } catch (e) { loteId = null; }
    if (!loteId) loteId = 'AJU-' + Date.now();
    const hechas = [], fallidas = [];

    try {
      for (const l of conCambio) {
        const delta     = deltaDe(l);
        const isEntrada = delta > 0;
        const { data: row } = await window.sb.from('inventario').select('*').eq('sku', l.sku).eq('almacen_id', almacenId).maybeSingle();
        const cantOrig    = row?.cantidad  || 0;
        const reservadoDb = row?.reservado || 0;
        // Bug #10: re-validar contra el valor REAL de DB (no contra SSData stale). El conteo se hizo
        // sobre lo que se vio en pantalla; si otra terminal movió el stock mientras tanto, aplicar la
        // diferencia calculada acá dejaría un número que nadie contó. Se rechaza y se dice.
        if (cantOrig !== actualDe(l)) {
          fallidas.push({ sku: l.sku, motivo: `el stock cambió mientras contabas (era ${actualDe(l)}, ahora ${cantOrig})` });
          continue;
        }
        if (!isEntrada && quedaDe(l) < reservadoDb) {
          fallidas.push({ sku: l.sku, motivo: `hay ${reservadoDb} reservadas, no puede quedar en ${quedaDe(l)}` });
          continue;
        }
        // El ajuste va por DELTA vía RPC en vez de reescribir la fila entera: el upsert anterior
        // devolvía reservado/minimo/maximo/locacion con los valores leídos al abrir el modal, pisando
        // lo que otra terminal hubiera cambiado. Además declara el motivo, para que el kardex asiente
        // el ajuste con su causa real y no como uno sin explicación.
        const { data: ajRes, error } = await window.sb.rpc('inv_ajustar_cantidad', {
          p_sku: l.sku, p_almacen: almacenId, p_empresa: empresaActual,
          p_delta: delta,
          p_tipo: isEntrada ? 'entrada' : 'salida', p_ref_tipo: 'ajuste', p_motivo: motivoLbl,
          p_ref_documento: loteId,
          p_usuario: window.__ssCurrentUser?.nombre || null,
        });
        if (error || ajRes?.error) { fallidas.push({ sku: l.sku, motivo: error?.message || ajRes.error }); continue; }
        const cantNueva = ajRes.cantidad;   // valor autoritativo que devuelve la RPC

        if (!SSData.inventario[l.sku]) SSData.inventario[l.sku] = {};
        SSData.inventario[l.sku][almacenId] = { ...slotDe(l.sku), cantidad: cantNueva };

        // Log para que aparezca en el kardex del producto (uno por línea: el kardex es por sku)
        const producto = productos.find(p => p.sku === l.sku);
        await window.sb.from('actividad_log').insert({
          empresa_id:     empresaActual,
          usuario_id:     window.__ssCurrentUser?.id || null,
          usuario_nombre: usuario,
          modulo:         'inventario',
          accion:         'transferencia', // se renderiza como movimiento en el kardex
          entidad_id:     l.sku,
          entidad_label:  producto?.nombre || l.sku,
          detalles: {
            tipo:             isEntrada ? 'ingreso' : 'egreso',
            origen:           isEntrada ? 'ajuste_manual' : null,
            destino:          isEntrada ? null : 'ajuste_manual',
            motivo:           motivo,
            motivo_label:     motivoLbl,
            cantidad:         delta,
            almacen_origen:   isEntrada ? 'AJUSTE' : (almacen?.nombre || almacenId),
            almacen_destino:  isEntrada ? (almacen?.nombre || almacenId) : 'AJUSTE',
            empresa_destino:  empresaActual,
            stock_anterior:   cantOrig,
            stock_nuevo:      cantNueva,
            notas:            notas || null,
            lote:             loteId,
          },
        });

        // Seriales: solo con una línea que SUBE (ver el gate de arriba).
        if (isEntrada && lineas.length === 1 && serialesInput.trim()) {
          const lista = serialesInput.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
          if (lista.length > 0) {
            await window.agregarSeriales({ sku: l.sku, almacenId, garantiaMeses: parseInt(garantiaMesesAdj) || 0, seriales: lista, notas: notas || null });
          }
        }
        hechas.push({ sku: l.sku, nombre: producto?.nombre || l.sku, delta, cantNueva, antes: cantOrig });
      }

      // ── EL COMPROBANTE ───────────────────────────────────────────────────────────────────────
      // Pedido: "cada vez que se haga un ajuste debe generar su PDF". Se arma con las líneas que
      // REALMENTE entraron (`hechas`), no con lo tipeado: el ajuste no es atómico y puede quedar
      // parcial — un papel que declare líneas que no se aplicaron se archiva y se le cree.
      // Se construye siempre (aunque sea parcial) y se guarda para poder re-descargarlo.
      const comprobante = hechas.length ? {
        id: loteId,
        fecha: window.localDateStr ? window.localDateStr() : new Date().toISOString().slice(0, 10),
        almacen: almacen?.nombre || almacenId,
        motivo: motivoLbl,
        usuario,
        notas: notas || null,
        empresa_id: empresaActual,
        parcial: fallidas.length > 0,
        seriales: (lineas.length === 1 && serialesInput.trim())
          ? serialesInput.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : [],
        lineas: hechas.map(h => ({ sku: h.sku, nombre: h.nombre, antes: h.antes, queda: h.cantNueva, delta: h.delta })),
      } : null;
      if (comprobante) {
        setUltimoComprobante(comprobante);
        // Falla en silencio a propósito: el ajuste YA está aplicado en la base y no se puede
        // deshacer por un problema de PDF. El botón "Comprobante" queda para reintentar.
        try { await window.generateAjustePDF?.(comprobante); } catch (e) { console.warn('[ajuste] PDF', e); }
      }

      onUpdate?.();
      setSaving(false);
      if (fallidas.length) {
        // Ni "listo" ni "error": lo que pasó. El ajuste no es atómico, así que decir cuáles entraron
        // es la única forma de arreglar el resto sin volver a contar el almacén.
        setParcial({ hechas, fallidas });
        setErr(`Ajuste ${loteId}: se aplicaron ${hechas.length} de ${conCambio.length} líneas. Las demás NO se registraron.`);
        setUltimoAjuste(loteId);
        setLineas(fallidas.map(f => ({ sku: f.sku, queda: String(conCambio.find(l => l.sku === f.sku)?.queda ?? '') })));
        return;
      }
      const sube = hechas.filter(h => h.delta > 0).reduce((s, h) => s + h.delta, 0);
      const baja = hechas.filter(h => h.delta < 0).reduce((s, h) => s - h.delta, 0);
      const detalle = hechas.length === 1
        ? `${hechas[0].sku} queda en ${hechas[0].cantNueva} (${hechas[0].delta > 0 ? '+' : ''}${hechas[0].delta}).`
        : `${hechas.length} productos` + (sube ? ` · +${sube}` : '') + (baja ? ` · −${baja}` : '') + '.';
      setOk(`Ajuste ${loteId} registrado: ${detalle}`);
      setUltimoAjuste(loteId);
      // Reset pero manteniendo el almacén: se suelen encadenar ajustes del mismo conteo.
      setLineas([{ sku: '', queda: '' }]); setMotivo(''); setNotas(''); setSerialesInput('');
      setTimeout(() => setOk(''), 6000);
    } catch (e) {
      setErr('Excepción: ' + (e.message || String(e)) + (hechas.length ? ` — ojo: ${hechas.length} línea(s) YA se aplicaron.` : ''));
      if (hechas.length) setParcial({ hechas, fallidas });
      setSaving(false);
    }
  }

  const productOptions = productos.map(p => ({ value: p.sku, label: p.nombre, sublabel: p.sku }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width:'min(820px, 96vw)', maxHeight:'92vh', display:'flex', flexDirection:'column'}}>
        <div className="modal-header">
          <div style={{width:42,height:42,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}>
            <Icon name="edit" size={20}/>
          </div>
          <div style={{flex:1}}>
            <div className="modal-title">Ajuste de inventario</div>
            <div className="small">Escribí cuánto QUEDA de cada producto — el sistema calcula la diferencia</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        {/* El cuerpo scrollea, así que el desplegable del buscador de la ÚLTIMA línea quedaba contra
            el borde inferior. El respiro de abajo le deja lugar para abrirse sin pelear con el pie. */}
        <div className="modal-body" style={{overflowY:'auto', paddingBottom:180}}>
          <div>
            <label className="form-label">Almacén *</label>
            <select className="select" value={almacenId} onChange={e=>setAlmacenId(e.target.value)} style={{width:'100%'}}>
              <option value="">— Seleccionar —</option>
              {almacenes.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
            <div className="muted small" style={{marginTop:4}}>El ajuste entero va contra este almacén.</div>
          </div>

          {/* Las líneas: producto y cuánto queda. La dirección la da el signo de la diferencia, así
              que el mismo ajuste puede subir unos códigos y bajar otros (reempaque, canje, conteo). */}
          <div style={{marginTop:14}}>
            <label className="form-label">Productos contados *</label>
            {/* SIN `overflow:hidden`: el desplegable del buscador es `position:absolute` y un ancestro
                recortado lo corta por más z-index que tenga (era el reporte "el desplegable se
                esconde y no me deja ver la lista hacia abajo"). Las esquinas se redondean en el
                borde del contenedor, que es lo único que ese overflow estaba resolviendo. */}
            <div style={{border:'1px solid var(--border)', borderRadius:8}}>
              <div style={{display:'grid', gridTemplateColumns:'minmax(0,1fr) 80px 96px 96px 34px', gap:8, padding:'7px 10px',
                           background:'var(--bg-sunken)', borderBottom:'1px solid var(--border)',
                           fontSize:10.5, textTransform:'uppercase', letterSpacing:0.5, color:'var(--text-muted)', fontWeight:600}}>
                <div>Producto</div>
                <div style={{textAlign:'right'}}>Hay</div>
                <div style={{textAlign:'right'}}>Queda en</div>
                <div style={{textAlign:'right'}}>Diferencia</div>
                <div/>
              </div>
              {lineas.map((l, i) => {
                const s = slotDe(l.sku);
                const d = deltaDe(l);
                const prodL = l.sku ? productos.find(p => p.sku === l.sku) : null;
                const malo  = lleno(l) && d < 0 && (prodL?.serializado || quedaDe(l) < (s.reservado || 0) || quedaDe(l) < 0);
                return (
                  <div key={i} style={{display:'grid', gridTemplateColumns:'minmax(0,1fr) 80px 96px 96px 34px', gap:8,
                                       padding:'8px 10px', alignItems:'center',
                                       borderBottom: i < lineas.length - 1 ? '1px solid var(--border)' : 'none',
                                       background: malo ? 'color-mix(in srgb, var(--danger) 7%, transparent)' : undefined}}>
                    <div style={{minWidth:0}}>
                      <SearchSelect value={l.sku} onChange={v => setLinea(i, { sku: v })} options={productOptions}
                        placeholder="Buscar por nombre o SKU..." style={{width:'100%'}}/>
                    </div>
                    {/* Sin almacén no hay stock que mostrar, y "—" no dice por qué: quien elige el
                        producto primero (lo normal) veía la columna vacía y creía que no hay nada. */}
                    <div className="mono muted" style={{textAlign:'right', fontSize:12.5}}>
                      {!l.sku ? '—'
                        : !almacenId ? <span className="small" style={{color:'var(--warn)'}}>elegí almacén</span>
                        : (s.cantidad || 0)}
                      {l.sku && almacenId && (s.reservado || 0) > 0 && <div className="small" style={{color:'var(--warn)'}}>{s.reservado} res.</div>}
                    </div>
                    <input className="input mono" type="number" min="0" value={l.queda}
                      onChange={e => setLinea(i, { queda: e.target.value })} placeholder="—"
                      style={{width:'100%', textAlign:'right'}}/>
                    <div className="mono" style={{textAlign:'right', fontSize:13, fontWeight:700,
                          color: !lleno(l) || d === 0 ? 'var(--text-subtle)' : d > 0 ? 'var(--success)' : 'var(--danger)'}}>
                      {!lleno(l) ? '—' : d === 0 ? 'sin cambio' : (d > 0 ? '+' : '') + d}
                    </div>
                    <button className="icon-btn" onClick={() => delLinea(i)} title="Quitar esta línea"
                      disabled={lineas.length === 1 && !lineas[0].sku && !String(lineas[0].queda).trim()}>
                      <Icon name="trash" size={13}/>
                    </button>
                    {/* Dónde MÁS hay. Solo informativo: el ajuste sigue siendo contra el almacén
                        elegido arriba. Ver 0 acá no dice si el producto se acabó o si está en otro
                        lado, y una cosa se resuelve reponiendo y la otra trayéndolo. */}
                    {(() => {
                      if (!l.sku || !almacenId) return null;
                      const otros = otrosAlmacenes(l.sku);
                      if (!otros.length) {
                        return (s.cantidad || 0) === 0
                          ? <div className="small muted" style={{gridColumn:'1/-1', marginTop:2}}>
                              Sin existencias en ningún almacén.
                            </div>
                          : null;
                      }
                      return (
                        <div className="small muted" style={{gridColumn:'1/-1', marginTop:2}}>
                          {(s.cantidad || 0) === 0 ? 'Acá no hay, pero sí en: ' : 'También hay en: '}
                          {otros.map(o => `${o.nombre} (${o.cantidad})`).join(' · ')}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
            <div style={{display:'flex', alignItems:'center', gap:10, marginTop:8, flexWrap:'wrap'}}>
              <button className="btn secondary sm" onClick={addLinea}><Icon name="plus" size={12}/>Agregar producto</button>
              {conCambio.length > 0 && (
                <span className="muted small">
                  {conCambio.length} producto{conCambio.length !== 1 ? 's' : ''} cambia{conCambio.length !== 1 ? 'n' : ''}
                  {suben.length > 0 && <span style={{color:'var(--success)'}}> · +{suben.reduce((s, l) => s + deltaDe(l), 0)}</span>}
                  {bajan.length > 0 && <span style={{color:'var(--danger)'}}> · −{bajan.reduce((s, l) => s - deltaDe(l), 0)}</span>}
                </span>
              )}
            </div>
            {suben.length > 0 && bajan.length > 0 && (
              <div className="small" style={{marginTop:8, padding:'8px 12px', background:'var(--bg-sunken)', borderRadius:6}}>
                Este ajuste sube unos códigos y baja otros — queda como <b>una sola operación</b>, con el
                mismo motivo y hermanada en el kardex. Es lo que hay que usar para un reempaque
                (por ejemplo, 1 bobina que se convierte en 10 cajas).
              </div>
            )}
          </div>

          <div style={{marginTop:14}}>
            <label className="form-label">Motivo *</label>
            <select className="select" value={motivo} onChange={e=>setMotivo(e.target.value)} style={{width:'100%'}}>
              <option value="">— Seleccionar —</option>
              {MOTIVOS.map(m => <option key={m.id} value={m.id}>{m.l}</option>)}
            </select>
          </div>

          <div style={{marginTop:14}}>
            <label className="form-label">Notas</label>
            <textarea className="input" rows={3} value={notas} onChange={e=>setNotas(e.target.value)}
              placeholder="Detalles adicionales del ajuste (factura, número de OC, condición física, etc.)"/>
          </div>

          {/* Los S/N son de UN producto. Con varias líneas el bloque se esconde: pedir tres listas de
              seriales en una grilla sería inmanejable y quedaría ambiguo cuál es de cuál. */}
          {lineas.length > 1 && conCambio.some(l => deltaDe(l) > 0 && productos.find(p => p.sku === l.sku)?.serializado) && (
            <div className="muted small" style={{marginTop:12, padding:'8px 12px', background:'var(--bg-sunken)', borderRadius:6}}>
              Hay productos con seriales que suben en este ajuste. Los S/N no se cargan acá cuando son
              varios productos: entrá al producto para registrarlos, o hacé ese ajuste solo.
            </div>
          )}
          {unicaSube && prodUnico?.serializado && (
            <div style={{marginTop:14, border:'1px solid var(--border)', borderRadius:8, overflow:'hidden'}}>
              <div style={{padding:'8px 12px', background:'var(--bg-sunken)', display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid var(--border)'}}>
                <Icon name="check" size={12}/>
                <span style={{fontWeight:600, fontSize:12, textTransform:'uppercase', letterSpacing:0.5}}>Seriales</span>
              </div>
              <div style={{padding:12, display:'flex', flexDirection:'column', gap:10}}>
                <div style={{display:'grid', gridTemplateColumns:'1fr 110px', gap:10, alignItems:'start'}}>
                  <div>
                    <label className="form-label">S/N — uno por línea o separados por coma</label>
                    <textarea className="input mono" rows={3} value={serialesInput} onChange={e=>setSerialesInput(e.target.value)}
                      placeholder={'SN-A1B2C3\nSN-D4E5F6\nSN-G7H8I9'}
                      style={{fontSize:12, resize:'vertical'}}/>
                  </div>
                  <div>
                    <label className="form-label">Garantía (meses)</label>
                    <input className="input mono" type="number" min="0" value={garantiaMesesAdj}
                      onChange={e=>setGarantiaMesesAdj(e.target.value)} placeholder="12"/>
                  </div>
                </div>
                {serialesInput.trim() && (() => {
                  const count = serialesInput.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean).length;
                  const entran = deltaDe(lineas[0]);
                  const mismatch = entran > 0 && count !== entran;
                  return (
                    <div style={{fontSize:11, color: mismatch ? 'var(--warn)' : 'var(--success)'}}>
                      {count} serial{count!==1?'es':''} ingresado{count!==1?'s':''}
                      {mismatch ? ` · ⚠ entran ${entran} unidades pero hay ${count} seriales` : ' · ✓'}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {err && <div style={{marginTop:10, padding:'8px 12px', background:'#fee2e2', border:'1px solid var(--danger)', borderRadius:6, fontSize:12, color:'#b91c1c'}}>{err}</div>}
          {/* Ajuste a medias: QUÉ entró y QUÉ no. Sin este detalle habría que recontar el almacén
              para saberlo, porque las líneas aplicadas ya movieron el stock de verdad. */}
          {parcial && (
            <div style={{marginTop:10, border:'1px solid var(--border)', borderRadius:8, overflow:'hidden', fontSize:12}}>
              {parcial.hechas.length > 0 && (
                <div style={{padding:'8px 12px', background:'var(--success-soft, #dcfce7)', color:'var(--success)'}}>
                  <b>Sí se aplicaron ({parcial.hechas.length}):</b> {parcial.hechas.map(h => `${h.sku} (${h.delta > 0 ? '+' : ''}${h.delta} → ${h.cantNueva})`).join(' · ')}
                </div>
              )}
              <div style={{padding:'8px 12px', background:'#fef2f2', color:'#b91c1c'}}>
                <b>NO se aplicaron ({parcial.fallidas.length}):</b> {parcial.fallidas.map(f => `${f.sku} — ${f.motivo}`).join(' · ')}
                <div className="muted small" style={{marginTop:4, color:'#b91c1c'}}>Quedaron cargadas arriba para reintentar solo esas.</div>
              </div>
            </div>
          )}
          {ok  && <div style={{marginTop:10, padding:'8px 12px', background:'var(--success-soft, #dcfce7)', border:'1px solid var(--success)', borderRadius:6, fontSize:12, color:'var(--success)'}}>{ok}</div>}
          {/* EL NÚMERO DEL AJUSTE. Va aparte del mensaje de "listo" —que se borra a los 6 segundos—
              porque es el dato que hay que anotar: con él se vuelve a encontrar el ajuste en
              Movimientos de Inventario dentro de seis meses. Pedido de Pedro, 2026-08-12. */}
          {ultimoAjuste && (
            <div style={{marginTop:10, padding:'10px 12px', border:'1.5px solid var(--brand)', borderRadius:8,
                         background:'var(--brand-soft)', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
              <Icon name="receipt" size={15} style={{color:'var(--brand)'}}/>
              <div style={{flex:1, minWidth:180}}>
                <div className="small" style={{color:'var(--brand)', fontWeight:600}}>N° de ajuste</div>
                <div className="mono" style={{fontSize:15, fontWeight:700}}>{ultimoAjuste}</div>
              </div>
              <button className="btn secondary sm" type="button"
                      onClick={() => { try { navigator.clipboard.writeText(ultimoAjuste); } catch (e) {} }}>
                Copiar
              </button>
              {/* El PDF se descarga solo al aplicar el ajuste, pero el navegador puede bloquear esa
                  descarga y el comprobante es lo que se archiva. Queda el botón para rehacerlo sin
                  volver a contar nada. */}
              {ultimoComprobante && ultimoComprobante.id === ultimoAjuste && (
                <button className="btn secondary sm" type="button"
                        onClick={() => { try { window.generateAjustePDF?.(ultimoComprobante); } catch (e) { alert('No se pudo generar el comprobante: ' + (e.message || e)); } }}>
                  <Icon name="doc" size={13}/> Comprobante
                </button>
              )}
              <div className="small muted" style={{flexBasis:'100%', fontSize:11}}>
                Queda registrado en Inventario → Movimientos, buscando por este número. El comprobante
                en PDF se descarga solo al aplicar el ajuste.
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cerrar</button>
          <button className="btn primary" onClick={handleSave} disabled={saving || !conCambio.length}>
            <Icon name="check" size={14}/>
            {saving ? 'Guardando…'
              : conCambio.length > 1 ? `Registrar ajuste de ${conCambio.length} productos`
              : 'Registrar ajuste'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ======= Modal: detalle de una importación del historial =======
function BulkHistoryDetailModal({ entry, onClose }) {
  const [filter, setFilter] = useState('all');
  const tipoLabel = BULK_TEMPLATES[entry.tipo]?.label || entry.tipo;
  const headers   = entry.headers || [];
  const rows      = entry.rows || [];
  const summary   = entry.summary || { new: 0, update: 0, error: 0, warn: 0 };

  const filtered = rows.filter(r => {
    if (filter === 'all')    return true;
    if (filter === 'new')    return r._status === 'new';
    if (filter === 'update') return r._status === 'update';
    if (filter === 'error')  return r._status === 'error';
    if (filter === 'warn')   return (r._warns || []).length > 0;
    return true;
  });

  function statusChip(s, warns) {
    if (s === 'error')  return <span className="chip amber"><Icon name="x" size={10}/>Omitida</span>;
    if (s === 'update') return <span className="chip blue"><Icon name="edit" size={10}/>Actualiza</span>;
    if (s === 'new')    return <span className="chip green"><Icon name="plus" size={10}/>Nuevo</span>;
    return <span className="chip neutral">{s}</span>;
  }

  function downloadCsv() {
    if (typeof XLSX === 'undefined') return;
    const wb = XLSX.utils.book_new();
    const aoa = [['#','status','errores','warnings', ...headers]];
    rows.forEach(r => {
      aoa.push([
        r._idx,
        r._status,
        (r._errors || []).join(' · '),
        (r._warns  || []).join(' · '),
        ...headers.map(h => r.data?.[h] ?? ''),
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, 'Detalle');
    XLSX.writeFile(wb, `${entry.id}_detalle.xlsx`);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width:'min(960px, 96vw)', maxHeight:'92vh', display:'flex', flexDirection:'column'}}>
        <div className="modal-header">
          <div style={{width:42,height:42,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}>
            <Icon name="doc" size={20}/>
          </div>
          <div style={{flex:1, minWidth:0}}>
            <div className="modal-title mono">{entry.id}</div>
            <div className="small">{tipoLabel} · {entry.filename || '—'} · {fmt.date(entry.ts)} {entry.empresa && <>· empresa <strong style={{color:'var(--text)'}}>{entry.empresa}</strong></>}</div>
          </div>
          <button className="btn ghost sm" onClick={downloadCsv} title="Descargar detalle"><Icon name="download" size={13}/>Descargar</button>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        <div className="modal-body" style={{overflowY:'auto'}}>
          {/* Stat cards */}
          <div className="stat-grid" style={{gridTemplateColumns:'repeat(5, 1fr)', marginBottom:14}}>
            <div className="stat"><div className="stat-label">Total filas</div><div className="stat-val">{rows.length}</div></div>
            <div className="stat"><div className="stat-label">Importadas OK</div><div className="stat-val" style={{color:'var(--success)'}}>{entry.ok || 0}</div></div>
            <div className="stat"><div className="stat-label">Omitidas</div><div className="stat-val" style={{color:'var(--warn)'}}>{summary.skipped ?? summary.error ?? 0}</div><div className="small muted">no enviadas a DB</div></div>
            <div className="stat"><div className="stat-label">Errores DB</div><div className="stat-val" style={{color: (entry.err||0) > 0 ? 'var(--danger)' : 'var(--text-muted)'}}>{entry.err || 0}</div></div>
            <div className="stat"><div className="stat-label">Nuevos / Actualiza</div><div className="stat-val">{summary.new}<span className="muted small" style={{margin:'0 4px'}}>/</span>{summary.update}</div></div>
          </div>

          {entry.truncated && (
            <div style={{padding:'8px 12px', background:'#fef3c7', border:'1px solid var(--warn)', borderRadius:6, fontSize:12, marginBottom:12}}>
              <Icon name="info" size={12} style={{marginRight:4, verticalAlign:'-1px'}}/>
              Mostrando las primeras 1.000 filas. La importación completa fue mayor.
            </div>
          )}

          <div className="seg" style={{marginBottom:8}}>
            <button className={filter==='all'?'on':''} onClick={()=>setFilter('all')}>Todas ({rows.length})</button>
            <button className={filter==='new'?'on':''} onClick={()=>setFilter('new')}>Procesadas - nuevas ({summary.new})</button>
            <button className={filter==='update'?'on':''} onClick={()=>setFilter('update')}>Procesadas - actualizadas ({summary.update})</button>
            <button className={filter==='warn'?'on':''} onClick={()=>setFilter('warn')}>Con warnings ({summary.warn})</button>
            <button className={filter==='error'?'on':''} onClick={()=>setFilter('error')}>Omitidas ({summary.skipped ?? summary.error})</button>
          </div>

          <div className="tbl-wrap">
            <div className="tbl-scroll" style={{maxHeight:480}}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{width:48}}>#</th>
                    <th style={{width:110}}>Estado</th>
                    {headers.map(h => <th key={h}>{h}</th>)}
                    <th>Mensajes</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={headers.length + 3} className="empty" style={{padding:24, textAlign:'center'}}>Sin filas en este filtro</td></tr>
                  )}
                  {filtered.map((r, i) => (
                    <tr key={i} style={{background: r._status === 'error' ? '#fee2e220' : (r._warns?.length ? '#fef3c715' : '')}}>
                      <td className="muted small">{r._idx}</td>
                      <td>{statusChip(r._status)}</td>
                      {headers.map(h => (
                        <td key={h} style={{fontSize:12, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                          {String(r.data?.[h] ?? '')}
                        </td>
                      ))}
                      <td style={{fontSize:11.5}}>
                        {(r._errors || []).map((e, ix) => <div key={'e'+ix} style={{color:'var(--danger)'}}>✕ {e}</div>)}
                        {(r._warns  || []).map((w, ix) => <div key={'w'+ix} style={{color:'var(--warn)'}}>⚠ {w}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { InventoryPage: window.InventoryPage, PricesPage: window.PricesPage, BulkPage: window.BulkPage });

// ======= Modal de transferencia entre almacenes =======
function TransferenciaModal({ productoInicial, onClose }) {
  const [empresas, setEmpresas] = useState([]);
  const [empresaOrigen, setEmpresaOrigen] = useState(window.currentEmpresa || 'demo1');
  const [empresaDest, setEmpresaDest] = useState(window.currentEmpresa || 'demo1');
  const [almacenesOrigen, setAlmacenesOrigen] = useState([]);
  const [almacenesDest, setAlmacenesDest] = useState([]);
  const [almacenOrigen, setAlmacenOrigen] = useState('');
  const [almacenDest, setAlmacenDest] = useState('');
  const [sku, setSku] = useState(productoInicial?.sku || '');
  const [cantidad, setCantidad] = useState('');
  const [notas, setNotas] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [productosOrig, setProductosOrig] = useState([]); // productos del empresaOrigen
  const [productosDest, setProductosDest] = useState([]); // productos del empresaDest
  const [stockOrigenDB, setStockOrigenDB] = useState(0);
  // Búsqueda inteligente (igual que Inventario): multi-término con chips + live
  const [searchTerms, setSearchTerms] = useState([]);
  const [liveSearch, setLiveSearch]   = useState('');
  // BR-INV-S05: S/N específicos a transferir cuando producto.serializado
  const [serialesDisponibles, setSerialesDisponibles] = useState([]);
  const [serialesSel, setSerialesSel] = useState(new Set());

  const cruzaEmpresas = empresaOrigen !== empresaDest;

  useEffect(() => {
    window.loadEmpresas?.().then(list => setEmpresas(list || []));
  }, []);

  useEffect(() => {
    if (!empresaOrigen) return;
    window.sb.from('almacenes').select('*').eq('empresa_id', empresaOrigen).order('nombre')
      .then(({ data }) => { setAlmacenesOrigen(data || []); setAlmacenOrigen(''); });
    // Paginar para superar el límite de 1000 filas de PostgREST.
    (async () => {
      const all = [];
      const PAGE = 1000;
      for (let page = 0; ; page++) {
        const from = page * PAGE, to = from + PAGE - 1;
        const { data, error } = await window.sb.from('productos')
          .select('sku, nombre, marca, categoria, costo, base, peso, garantia_meses, serializado')
          .overlaps('empresas', [empresaOrigen]).eq('activo', true).order('nombre').range(from, to);
        if (error) { console.error('[Transferencia] error cargando productos:', error); break; }
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
      }
      setProductosOrig(all);
    })();
  }, [empresaOrigen]);

  useEffect(() => {
    if (!empresaDest) return;
    window.sb.from('almacenes').select('*').eq('empresa_id', empresaDest).order('nombre')
      .then(({ data }) => { setAlmacenesDest(data || []); setAlmacenDest(''); });
    (async () => {
      const all = [];
      const PAGE = 1000;
      for (let page = 0; ; page++) {
        const from = page * PAGE, to = from + PAGE - 1;
        const { data, error } = await window.sb.from('productos')
          .select('sku').overlaps('empresas', [empresaDest]).eq('activo', true).range(from, to);
        if (error || !data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
      }
      setProductosDest(all);
    })();
  }, [empresaDest]);

  // Stock en origen — leer directo de DB para soportar empresas distintas a la activa
  useEffect(() => {
    if (!sku || !almacenOrigen) { setStockOrigenDB(0); return; }
    window.sb.from('inventario').select('cantidad,reservado').eq('sku', sku).eq('almacen_id', almacenOrigen).maybeSingle()
      .then(({ data }) => setStockOrigenDB((data?.cantidad || 0) - (data?.reservado || 0)));
  }, [sku, almacenOrigen]);

  // Cargar S/N disponibles del SKU + almacén origen (solo si serializado y misma empresa)
  useEffect(() => {
    setSerialesSel(new Set());
    setSerialesDisponibles([]);
    const prod = productosOrig.find(p => p.sku === sku);
    if (!prod?.serializado || !sku || !almacenOrigen || cruzaEmpresas) return;
    window.sb.from('inventario_seriales')
      .select('id,serial,garantia_meses').eq('empresa_id', empresaOrigen)
      .eq('sku', sku).eq('almacen_id', almacenOrigen).eq('estado', 'disponible')
      .order('created_at', { ascending: true })
      .then(({ data }) => setSerialesDisponibles(data || []));
  }, [sku, almacenOrigen, empresaOrigen, cruzaEmpresas, productosOrig]);

  function toggleSerial(id) {
    setSerialesSel(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    // Sincronizar cantidad con cantidad seleccionada
    const qty = serialesSel.has(id) ? serialesSel.size - 1 : serialesSel.size + 1;
    setCantidad(String(qty));
  }

  const productos    = productosOrig; // productos seleccionables = del empresa origen
  const selectedProd = productos.find(p => p.sku === sku);
  const skuExistsInDest = productosDest.some(p => p.sku === sku);

  const productosFiltrados = React.useMemo(() => {
    const liveTerm = liveSearch.trim();
    const allTerms = liveTerm ? [...searchTerms, liveTerm] : searchTerms;
    if (allTerms.length === 0) return productos;
    return productos.filter(p =>
      window.AdvancedSearch.matches(allTerms, p.nombre, p.sku, p.marca, p.categoria)
    );
  }, [productos, searchTerms, liveSearch]);

  async function handleSubmit() {
    setErrorMsg('');
    const qty = parseInt(cantidad);
    if (!almacenOrigen) { setErrorMsg('Selecciona el almacén origen.'); return; }
    if (!almacenDest) { setErrorMsg('Selecciona el almacén destino.'); return; }
    if (almacenOrigen === almacenDest) { setErrorMsg('El almacén origen y destino deben ser diferentes.'); return; }
    if (!sku) { setErrorMsg('Selecciona un producto.'); return; }
    if (!qty || qty <= 0) { setErrorMsg('La cantidad debe ser mayor a 0.'); return; }

    // BR-INV-S05: si producto serializado y misma empresa, debe seleccionar S/N exactos
    const prodSel = productosOrig.find(p => p.sku === sku);
    if (prodSel?.serializado && !cruzaEmpresas) {
      if (serialesSel.size !== qty) {
        setErrorMsg(`Producto serializado: debes seleccionar exactamente ${qty} S/N (seleccionados: ${serialesSel.size}).`);
        return;
      }
    }

    setSaving(true);
    try {
      // Cross-empresa: el producto se COMPARTE con el destino (se agrega a `empresas`), no se
      // duplica. `productos.sku` es la PK global, así que el INSERT de antes fallaba si el SKU ya
      // existía y la transferencia quedaba apuntando a un producto invisible en el destino.
      if (cruzaEmpresas && !skuExistsInDest && selectedProd) {
        const nomDest = empresas.find(e => e.id === empresaDest)?.nombre || empresaDest;
        const ok = confirm(`El producto «${selectedProd.nombre}» todavía no está disponible en ${nomDest}.\n\n¿Compartirlo con esa empresa? Es el mismo producto (mismo SKU, mismo precio); el stock sigue siendo de cada almacén.`);
        if (!ok) { setSaving(false); return; }
        const { data: prodRow } = await window.sb.from('productos').select('empresas').eq('sku', selectedProd.sku).maybeSingle();
        const ya = Array.isArray(prodRow?.empresas) ? prodRow.empresas : [];
        const { error: prodErr } = await window.sb.from('productos')
          .update({ empresas: [...new Set([...ya, empresaDest])] }).eq('sku', selectedProd.sku);
        if (prodErr) { setErrorMsg('No se pudo compartir el producto con la empresa destino: ' + prodErr.message); setSaving(false); return; }
      }

      // Transferencia atómica: row lock en origen + upsert incremental en destino,
      // todo dentro de una sola transacción PostgreSQL vía RPC.
      const { data: rpcResult, error: rpcError } = await window.sb.rpc('transferir_stock', {
        p_sku:        sku,
        p_origen_id:  almacenOrigen,
        p_destino_id: almacenDest,
        p_cantidad:   qty,
      });

      if (rpcError) throw rpcError;
      if (rpcResult?.error) { setErrorMsg(rpcResult.error); setSaving(false); return; }

      // BR-INV-S05: mover S/N específicos si producto serializado y misma empresa
      if (prodSel?.serializado && !cruzaEmpresas && serialesSel.size > 0) {
        const { error: snErr } = await window.transferirSeriales({
          serialIds: [...serialesSel],
          almacenDestinoId: almacenDest,
          motivo: `Transferencia ${almacenOrigen} → ${almacenDest}${notas ? ' · ' + notas : ''}`,
        });
        if (snErr) {
          // Bug #25: el stock ya se movió atómicamente por la RPC, pero los S/N fallaron en una
          // llamada separada no transaccional. Antes quedaba inconsistencia físico-vs-serial sin rollback.
          // Compensamos revirtiendo el stock con la misma RPC origen↔destino invertidos. transferirSeriales
          // falla en su pre-check o antes de commitear el update, así que los S/N siguen en origen → seguro revertir.
          let revertNota = '';
          const { data: revResult, error: revError } = await window.sb.rpc('transferir_stock', {
            p_sku:        sku,
            p_origen_id:  almacenDest,
            p_destino_id: almacenOrigen,
            p_cantidad:   qty,
          });
          if (revError || revResult?.error) {
            revertNota = ' · ADVERTENCIA: no se pudo revertir el stock automáticamente, el inventario quedó inconsistente, corregilo manualmente.';
          }
          setErrorMsg('Error moviendo S/N: ' + (snErr.message || JSON.stringify(snErr)) + (revertNota || ' · El stock fue revertido automáticamente.'));
          setSaving(false);
          return;
        }
      }

      const cantOrigen = rpcResult.cant_origen;
      const cantDest   = rpcResult.cant_destino;

      // Actualizar SSData en memoria para almacenes de la empresa activa
      if (!SSData.inventario[sku]) SSData.inventario[sku] = {};
      if (SSData.inventario[sku][almacenOrigen] !== undefined)
        SSData.inventario[sku][almacenOrigen] = { ...safeInv(sku, almacenOrigen), cantidad: cantOrigen };
      if (SSData.inventario[sku][almacenDest] !== undefined)
        SSData.inventario[sku][almacenDest] = { ...safeInv(sku, almacenDest), cantidad: cantDest };
      else if (empresaDest === window.currentEmpresa)
        SSData.inventario[sku][almacenDest] = { cantidad: cantDest, reservado: 0, locacion: '', minimo: 0, maximo: 0 };

      const almOrigNombre = almacenesOrigen.find(a => a.id === almacenOrigen)?.nombre || almacenOrigen;
      const almDestNombre = almacenesDest.find(a => a.id === almacenDest)?.nombre || almacenDest;
      const empOrigNombre = empresas.find(e => e.id === empresaOrigen)?.nombre || empresaOrigen;
      const empDestNombre = empresas.find(e => e.id === empresaDest)?.nombre || empresaDest;

      window.logActivity?.({
        modulo: 'inventario',
        accion: 'transferencia',
        entidad_id: sku,
        entidad_label: selectedProd?.nombre || sku,
        detalles: { sku, cantidad: qty, almacen_origen: almOrigNombre, empresa_origen: empOrigNombre, almacen_destino: almDestNombre, empresa_destino: empDestNombre, notas },
      });

      onClose();
    } catch(e) {
      setErrorMsg('Error al guardar: ' + (e?.message || String(e)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-fullscreen-mobile" style={{ width: 'min(560px, 96vw)', overflow: 'visible' }}>
        <div className="modal-header">
          <h2 className="modal-title"><Icon name="truck" size={18}/>Transferencia de mercancía</h2>
          <button className="btn ghost icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body" style={{ display:'flex', flexDirection:'column', gap:14, overflow:'visible' }}>

          <div style={{background:'var(--bg-elev)', borderRadius:10, padding:'14px 16px'}}>
            <div style={{fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:10}}>Origen</div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
              <div className="form-field">
                <label className="form-label">Empresa</label>
                <select className="form-control" value={empresaOrigen} onChange={e => setEmpresaOrigen(e.target.value)}>
                  {empresas.map(em => <option key={em.id} value={em.id}>{em.nombre}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">Almacén</label>
                <select className="form-control" value={almacenOrigen} onChange={e => setAlmacenOrigen(e.target.value)}>
                  <option value="">-- Seleccionar --</option>
                  {almacenesOrigen.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div style={{background:'var(--bg-elev)', borderRadius:10, padding:'14px 16px'}}>
            <div style={{fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:10}}>Destino</div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
              <div className="form-field">
                <label className="form-label">Empresa</label>
                <select className="form-control" value={empresaDest} onChange={e => setEmpresaDest(e.target.value)}>
                  {empresas.map(em => <option key={em.id} value={em.id}>{em.nombre}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">Almacén</label>
                <select className="form-control" value={almacenDest} onChange={e => setAlmacenDest(e.target.value)}>
                  <option value="">-- Seleccionar --</option>
                  {almacenesDest.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">
              Producto
              <span className="muted" style={{fontWeight:400, fontSize:11, marginLeft:6}}>
                {selectedProd
                  ? '— 1 seleccionado'
                  : productos.length === 0
                    ? '— cargando…'
                    : `· ${productosFiltrados.length} de ${productos.length} disponibles`}
              </span>
            </label>
            {selectedProd ? (
              <div style={{
                display:'flex', alignItems:'center', gap:10,
                padding:'10px 12px', background:'var(--brand-soft)', border:'1px solid var(--brand)', borderRadius:8,
              }}>
                <Icon name="check" size={14} style={{color:'var(--brand)', flexShrink:0}}/>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontWeight:600, fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{selectedProd.nombre}</div>
                  <div className="mono" style={{fontSize:11, color:'var(--text-muted)'}}>
                    {[selectedProd.sku, selectedProd.marca, selectedProd.categoria].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <button className="btn ghost sm" onClick={() => setSku('')} title="Cambiar producto">
                  <Icon name="x" size={12}/>Cambiar
                </button>
              </div>
            ) : (
              <>
                <AdvancedSearch
                  terms={searchTerms}
                  onTermsChange={setSearchTerms}
                  onInputChange={setLiveSearch}
                  storageKey="ss-saved-search-transferencia"
                  placeholder="Buscar por SKU, nombre, marca o categoría… (Enter para fijar término)"
                />
                <div style={{
                  marginTop:6,
                  border:'1px solid var(--border)', borderRadius:8,
                  maxHeight:240, overflowY:'auto',
                  background:'var(--bg-elev)',
                }}>
                  {productosFiltrados.length === 0 ? (
                    <div style={{padding:'14px 12px', fontSize:12, color:'var(--text-muted)', textAlign:'center'}}>
                      {productos.length === 0 ? 'Cargando productos…' : 'Sin coincidencias.'}
                    </div>
                  ) : (
                    productosFiltrados.slice(0, 200).map(p => (
                      <div
                        key={p.sku}
                        onClick={() => { setSku(p.sku); setLiveSearch(''); }}
                        style={{
                          padding:'8px 12px', cursor:'pointer',
                          borderBottom:'1px solid var(--border)',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-sunken)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <div style={{fontWeight:500, fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{p.nombre}</div>
                        <div className="mono" style={{fontSize:11, color:'var(--text-muted)'}}>
                          {[p.sku, p.marca, p.categoria].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                    ))
                  )}
                  {productosFiltrados.length > 200 && (
                    <div style={{padding:'8px 12px', fontSize:11, color:'var(--text-muted)', background:'var(--bg-sunken)', textAlign:'center'}}>
                      Mostrando 200 de {productosFiltrados.length}. Refiná la búsqueda.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="form-field" style={{ maxWidth: 180 }}>
            <label className="form-label">Cantidad</label>
            <input
              className="form-control"
              type="number"
              min="1"
              value={cantidad}
              onChange={e => setCantidad(e.target.value)}
              placeholder="0"
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          {sku && almacenOrigen && (
            <div style={{fontSize:12, color:'var(--text-muted)'}}>
              Disponible en origen: <strong style={{color: stockOrigenDB === 0 ? 'var(--danger)' : 'inherit'}}>{stockOrigenDB}</strong> unidades
            </div>
          )}

          {/* BR-INV-S05: selección de S/N para productos serializados (misma empresa) */}
          {(() => {
            const prodSel = productosOrig.find(p => p.sku === sku);
            if (!prodSel?.serializado) return null;
            if (cruzaEmpresas) {
              return (
                <div style={{padding:'10px 12px', background:'var(--warn-soft, #fef3c7)', border:'1px solid var(--warn)', borderRadius:8, fontSize:12, display:'flex', alignItems:'flex-start', gap:8}}>
                  <Icon name="alert" size={14} style={{color:'var(--warn)', marginTop:1, flexShrink:0}}/>
                  <div>
                    <strong style={{color:'var(--warn)'}}>SKU serializado entre empresas</strong> — los números de serie NO se transferirán automáticamente (cambia el dueño legal). Solo se mueve el stock bulk. Si necesitas mantener trazabilidad de S/N entre empresas, registrá los seriales en la empresa destino manualmente después.
                  </div>
                </div>
              );
            }
            const qtyNum = parseInt(cantidad) || 0;
            const completo = serialesSel.size === qtyNum && qtyNum > 0;
            return (
              <div style={{border:'1px solid var(--brand)', borderRadius:8, overflow:'hidden'}}>
                <div style={{padding:'9px 12px', background:'var(--brand-soft)', display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid var(--brand)'}}>
                  <Icon name="check" size={13} style={{color:'var(--brand)'}}/>
                  <strong style={{fontSize:12, textTransform:'uppercase', letterSpacing:0.5, color:'var(--brand)'}}>Números de serie a transferir</strong>
                  <span style={{marginLeft:'auto', fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:10, background: completo ? 'var(--success)' : 'var(--warn)', color:'#fff'}}>
                    {serialesSel.size}/{qtyNum || '?'}
                  </span>
                </div>
                {serialesDisponibles.length === 0 ? (
                  <div className="empty" style={{padding:'16px', textAlign:'center', fontSize:12.5}}>
                    No hay S/N disponibles en el almacén origen. {stockOrigenDB > 0 && <span style={{color:'var(--warn)'}}>Hay stock bulk sin S/N registrado — registralo primero en Inventario.</span>}
                  </div>
                ) : (
                  <div style={{maxHeight:200, overflowY:'auto'}}>
                    {serialesDisponibles.map(s => {
                      const selected = serialesSel.has(s.id);
                      const disabled = !selected && qtyNum > 0 && serialesSel.size >= qtyNum;
                      return (
                        <label key={s.id} style={{
                          display:'grid', gridTemplateColumns:'30px 1fr 90px', gap:8, alignItems:'center',
                          padding:'8px 12px', borderTop:'1px solid var(--border)',
                          background: selected ? 'var(--brand-soft)' : 'transparent',
                          cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
                        }}>
                          <input type="checkbox" checked={selected} disabled={disabled}
                            onChange={() => toggleSerial(s.id)} style={{width:16, height:16}}/>
                          <span style={{fontFamily:'var(--mono)', fontSize:12.5, fontWeight:500}}>{s.serial}</span>
                          <span className="small muted">Gar: {s.garantia_meses || 0}m</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {cruzaEmpresas && (
            <div style={{padding:'10px 12px', background:'var(--brand-soft)', border:'1px solid var(--brand)', borderRadius:8, fontSize:12, display:'flex', alignItems:'flex-start', gap:8}}>
              <Icon name="info" size={14} style={{color:'var(--brand)', marginTop:1, flexShrink:0}}/>
              <div>
                <strong style={{color:'var(--brand)'}}>Transferencia entre empresas</strong> — el stock saldrá de {empresas.find(e=>e.id===empresaOrigen)?.nombre || empresaOrigen} hacia {empresas.find(e=>e.id===empresaDest)?.nombre || empresaDest}.
                {sku && !skuExistsInDest && <> Como el SKU no existe en la empresa destino, se ofrecerá clonar el producto al confirmar.</>}
              </div>
            </div>
          )}

          <div className="form-field">
            <label className="form-label">Notas</label>
            <input className="form-control" value={notas} onChange={e => setNotas(e.target.value)} placeholder="Motivo de la transferencia..."/>
          </div>

          {errorMsg && <div style={{padding:'10px 14px', background:'var(--danger-soft)', color:'var(--danger)', borderRadius:8, fontSize:13}}>{errorMsg}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={saving || !almacenOrigen || !almacenDest || !sku || !cantidad} onClick={handleSubmit}>
            {saving ? 'Procesando...' : <><Icon name="truck" size={14}/>Ejecutar transferencia</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ======= Modal: Editar lista de precios =======
function EditPriceListModal({ lista, onClose, onSave }) {
  const isCustom = lista.modo === 'custom';
  const [form, setForm]   = useState({
    nombre:          lista.nombre,
    tipo:            lista.tipo,
    valor:           lista.valor,
    preciosManuales: isCustom ? { ...(lista.preciosManuales || {}) } : {},
  });
  const [tab,          setTab]          = useState(isCustom ? 'precios' : 'config');
  const [customSearch, setCustomSearch] = useState('');
  const [saving,       setSaving]       = useState(false);

  function upd(k, v) { setForm(f => ({...f, [k]: v})); }
  const tc = SSData.tiposCliente.find(t => t.id === form.tipo);

  function calcPrecio(p) {
    if (isCustom) return form.preciosManuales[p.sku] ?? p.base;
    return p.base * (1 - form.valor / 100);
  }
  const preview = SSData.productos.slice(0, 4).map(p => {
    const pr = calcPrecio(p);
    return { ...p, precioLista: pr, margen: pr > 0 ? ((pr - p.costo) / pr * 100) : 0 };
  });

  const customRows = SSData.productos.filter(p =>
    !customSearch ||
    p.sku.toLowerCase().includes(customSearch.toLowerCase()) ||
    p.nombre.toLowerCase().includes(customSearch.toLowerCase())
  );
  const manualCount = Object.keys(form.preciosManuales).length;

  async function handleSave() {
    if (!form.nombre.trim()) return;
    setSaving(true);
    onSave({ ...lista, ...form, valor: parseFloat(form.valor) || 0 }, form.preciosManuales);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width: isCustom ? 900 : 620, maxHeight:'90vh', display:'flex', flexDirection:'column'}}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center',flexShrink:0}}>
            <Icon name="edit" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">Editar lista de precios</h3>
            <div className="small mono">{lista.id} · {isCustom ? 'Personalizada' : lista.modo}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        {isCustom && (
          <div style={{padding:'0 20px', borderBottom:'1px solid var(--border)'}}>
            <div className="seg" style={{border:'none'}}>
              <button className={tab==='config'?'on':''} onClick={()=>setTab('config')}>Configuración</button>
              <button className={tab==='precios'?'on':''} onClick={()=>setTab('precios')}>Precios manuales ({manualCount})</button>
            </div>
          </div>
        )}

        <div className="modal-body" style={{flex:1, overflowY:'auto'}}>
          {/* Config tab */}
          {tab === 'config' && (
            <>
              <div className="mt-1">
                <label className="form-label">Nombre de la lista</label>
                <input className="input" value={form.nombre} onChange={e=>upd('nombre',e.target.value)}/>
              </div>
              <div className="grid-2 mt-3">
                <div>
                  <label className="form-label">Tipo de cliente</label>
                  <select className="select" value={form.tipo} onChange={e=>upd('tipo',e.target.value)}>
                    {SSData.tiposCliente.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                  </select>
                </div>
                {!isCustom && (
                  <div>
                    <label className="form-label">Descuento sobre precio base (%)</label>
                    <input className="input" type="number" min="0" max="99" step="0.5" value={form.valor} onChange={e=>upd('valor', parseFloat(e.target.value)||0)}/>
                  </div>
                )}
              </div>
              {tc && !isCustom && (
                <div style={{marginTop:12,padding:'8px 12px',borderRadius:8,background:'var(--brand-soft)',display:'flex',alignItems:'center',gap:8}}>
                  <div style={{width:10,height:10,borderRadius:3,background:tc.color,flexShrink:0}}/>
                  <span style={{fontSize:13}}><strong>{tc.nombre}</strong> · Descuento de <strong>{form.valor}%</strong> sobre precio base</span>
                </div>
              )}
              {!isCustom && (
                <>
                  <div className="form-section-title mt-4">Vista previa de precios</div>
                  <div className="tbl-wrap mt-2">
                    <table className="tbl">
                      <thead><tr><th>SKU</th><th>Producto</th><th className="num">Base</th><th className="num">Precio lista</th><th className="num">Margen</th></tr></thead>
                      <tbody>
                        {preview.map(p => (
                          <tr key={p.sku}>
                            <td className="mono-cell">{p.sku}</td>
                            <td style={{fontSize:12,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.nombre}</td>
                            <td className="num muted">{fmt.usd(p.base)}</td>
                            <td className="num strong-num" style={{color:'var(--brand)'}}>{fmt.usd(p.precioLista)}</td>
                            <td className="num" style={{color:p.margen<10?'var(--danger)':p.margen<20?'var(--warn)':'var(--success)'}}>{p.margen.toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}

          {/* Custom prices tab */}
          {tab === 'precios' && isCustom && (
            <>
              <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:10}}>
                <input className="input search" style={{flex:1}} placeholder="Buscar SKU o nombre…" value={customSearch} onChange={e=>setCustomSearch(e.target.value)}/>
                <span className="chip blue">{manualCount} con precio manual</span>
                <span className="chip amber">{SSData.productos.length - manualCount} usarán precio base</span>
                <button className="btn ghost sm" style={{color:'var(--danger)'}} onClick={()=>upd('preciosManuales',{})}>Limpiar todos</button>
              </div>
              <div className="tbl-wrap">
                <div className="tbl-scroll" style={{maxHeight:460}}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Producto</th>
                        <th className="num">Precio base</th>
                        <th className="num" style={{width:160}}>Precio en esta lista</th>
                        <th className="num">Margen</th>
                        <th style={{width:36}}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {customRows.map(p => {
                        const manual = form.preciosManuales[p.sku];
                        const precio = manual ?? p.base;
                        const margen = precio > 0 ? ((precio - p.costo) / precio * 100) : 0;
                        const hasManual = manual != null;
                        return (
                          <tr key={p.sku} style={{background: hasManual ? 'var(--brand-soft)' : ''}}>
                            <td className="mono-cell" style={{fontSize:11}}>{p.sku}</td>
                            <td style={{fontSize:12,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.nombre}</td>
                            <td className="num muted">{fmt.usd(p.base)}</td>
                            <td className="num">
                              <div style={{position:'relative'}}>
                                <span style={{position:'absolute',left:8,top:'50%',transform:'translateY(-50%)',fontSize:12,color:'var(--text-muted)'}}>$</span>
                                <input
                                  type="number" min="0" step="0.01"
                                  className="input"
                                  style={{paddingLeft:18, textAlign:'right', fontWeight: hasManual ? 700 : 400, color: hasManual ? 'var(--brand)' : 'inherit', width:130}}
                                  placeholder={fmt.usd(p.base).replace('$','')}
                                  value={manual != null ? manual : ''}
                                  onChange={e => {
                                    const v = e.target.value;
                                    const copia = {...form.preciosManuales};
                                    if (v === '' || isNaN(parseFloat(v))) { delete copia[p.sku]; }
                                    else { copia[p.sku] = parseFloat(v); }
                                    upd('preciosManuales', copia);
                                  }}
                                />
                              </div>
                            </td>
                            <td className="num" style={{color: margen<10?'var(--danger)':margen<20?'var(--warn)':'var(--success)'}}>{margen.toFixed(1)}%</td>
                            <td>
                              {hasManual && (
                                <button className="icon-btn" style={{color:'var(--text-muted)'}} title="Quitar precio manual"
                                  onClick={()=>{ const c={...form.preciosManuales}; delete c[p.sku]; upd('preciosManuales',c); }}>
                                  <Icon name="x" size={12}/>
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

        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!form.nombre || saving} onClick={handleSave}>
            <Icon name="check" size={14}/>{saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ======= Modal: Nueva lista de precios =======
function NewPriceListModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    nombre: '',
    tipo: 'inst',
    modo: 'descuento', // 'descuento' | 'markup' | 'fijo' | 'custom'
    valor: 15,
    baseReferencia: 'base',
    redondeo: '0.01',
    activa: true,
    clientesAsignados: [],
    preciosManuales: {}, // { sku: precio }
  });
  const [tab, setTab] = useState('config');
  const [customSearch, setCustomSearch] = useState('');

  function update(k, v) { setForm({...form, [k]: v}); }
  function toggleCliente(id) {
    setForm({...form, clientesAsignados: form.clientesAsignados.includes(id) ? form.clientesAsignados.filter(x=>x!==id) : [...form.clientesAsignados, id]});
  }

  function handleCreate() {
    if (!form.nombre.trim()) return;
    const id = 'lp-' + form.nombre.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 20) + '-' + Date.now().toString(36);
    const effectiveValor = form.modo === 'descuento' || form.modo === 'fijo' ? parseFloat(form.valor) || 0
      : form.modo === 'markup' ? -(parseFloat(form.valor) || 0)
      : 0;
    const newLista = { id, nombre: form.nombre, tipo: form.tipo, modo: form.modo, valor: effectiveValor };
    onSave?.(newLista, form.clientesAsignados, form.modo === 'custom' ? form.preciosManuales : {});
  }

  const tc = SSData.tiposCliente.find(t => t.id === form.tipo);
  function calcPrice(p) {
    if (form.modo === 'custom') return form.preciosManuales[p.sku] ?? p.base;
    if (form.modo === 'descuento') return p.base * (1 - form.valor/100);
    if (form.modo === 'markup') return p.costo * (1 + form.valor/100);
    if (form.modo === 'fijo') return p.base * (1 - form.valor/100);
    return p.base;
  }
  const preview = SSData.productos.slice(0, 6).map(p => {
    const precio = calcPrice(p);
    const margen = precio > 0 ? ((precio - p.costo) / precio * 100) : 0;
    return { ...p, precio, margen };
  });
  const manualCount = Object.keys(form.preciosManuales).length;
  const customRows = SSData.productos.filter(p =>
    !customSearch ||
    p.sku.toLowerCase().includes(customSearch.toLowerCase()) ||
    p.nombre.toLowerCase().includes(customSearch.toLowerCase())
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width: 860, maxHeight:'90vh', display:'flex', flexDirection:'column'}}>
        <div className="modal-header">
          <div style={{width: 40, height: 40, borderRadius: 10, background: 'var(--brand-soft)', color: 'var(--brand)', display:'grid', placeItems:'center'}}>
            <Icon name="price" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">Nueva lista de precios</h3>
            <div className="small">Define precios por tipo de cliente, con descuento sobre base o markup sobre costo</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        <div style={{padding: '0 20px', borderBottom:'1px solid var(--border)'}}>
          <div className="seg" style={{border:'none'}}>
            <button className={tab==='config'?'on':''} onClick={()=>setTab('config')}>Configuración</button>
            {form.modo === 'custom' && <button className={tab==='manual'?'on':''} onClick={()=>setTab('manual')}>Precios manuales ({manualCount})</button>}
            <button className={tab==='clientes'?'on':''} onClick={()=>setTab('clientes')}>Clientes ({form.clientesAsignados.length})</button>
            <button className={tab==='preview'?'on':''} onClick={()=>setTab('preview')}>Vista previa</button>
          </div>
        </div>

        <div className="modal-body" style={{flex:1, overflowY:'auto'}}>
          {tab === 'config' && (
            <>
              <div className="form-section-title">Información de la lista</div>
              <div className="grid-2">
                <div>
                  <label className="form-label">Nombre <span style={{color:'var(--danger)'}}>*</span></label>
                  <input className="input" placeholder="Lista Instalador VIP" value={form.nombre} onChange={e=>update('nombre', e.target.value)}/>
                </div>
                <div>
                  <label className="form-label">Tipo de cliente</label>
                  <select className="select" value={form.tipo} onChange={e=>update('tipo', e.target.value)} style={{width:'100%'}}>
                    {SSData.tiposCliente.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-section-title mt-4">Cálculo de precios</div>
              <div className="grid-4">
                {[
                  {id:'descuento', t:'Descuento sobre base', s:'Precio base − %'},
                  {id:'markup', t:'Markup sobre costo', s:'Costo + %'},
                  {id:'fijo', t:'Factor fijo', s:'Multiplicador único'},
                  {id:'custom', t:'Personalizada', s:'Precio manual por producto'},
                ].map(m => (
                  <div key={m.id} onClick={()=>update('modo', m.id)} className="card" style={{padding: 12, cursor: 'pointer', border: form.modo === m.id ? '2px solid var(--brand)' : '1px solid var(--border)', background: form.modo === m.id ? 'var(--brand-soft)' : 'var(--bg-elev)'}}>
                    <div style={{fontSize: 13, fontWeight: 600}}>{m.t}</div>
                    <div className="small mt-2">{m.s}</div>
                  </div>
                ))}
              </div>

              {form.modo !== 'custom' && (
              <div className="grid-2 mt-4">
                <div>
                  <label className="form-label">{form.modo === 'markup' ? 'Markup (%)' : 'Descuento (%)'}</label>
                  <div className="flex items-center gap-3">
                    <input type="range" min="0" max="50" step="1" value={form.valor} onChange={e=>update('valor', Number(e.target.value))} style={{flex:1}}/>
                    <input className="input" type="number" value={form.valor} onChange={e=>update('valor', Number(e.target.value))} style={{width: 80}}/>
                    <span className="mono" style={{fontSize: 13, minWidth: 20}}>%</span>
                  </div>
                </div>
                <div>
                  <label className="form-label">Redondeo</label>
                  <select className="select" value={form.redondeo} onChange={e=>update('redondeo', e.target.value)} style={{width:'100%'}}>
                    <option value="0.01">Dos decimales (0.01)</option>
                    <option value="0.1">Un decimal (0.10)</option>
                    <option value="1">Entero (1.00)</option>
                    <option value="0.99">Terminación .99</option>
                    <option value="0.5">Medio (0.50)</option>
                  </select>
                </div>
              </div>
              )}

              {form.modo === 'custom' && (
                <div className="card mt-4" style={{padding: 14, background: 'var(--brand-soft)', border: '1px solid var(--brand)'}}>
                  <div className="flex items-center gap-3">
                    <Icon name="edit" size={16}/>
                    <div style={{flex:1, fontSize: 12.5}}>
                      <strong>Modo personalizado</strong> — Ve a la pestaña <strong>Precios manuales</strong> para asignar un precio por SKU. Los productos sin precio usarán su precio base por defecto.
                    </div>
                    <button className="btn primary sm" onClick={()=>setTab('manual')}>Ir a Precios →</button>
                  </div>
                </div>
              )}

              <div className="card mt-4" style={{padding: 12, background: 'var(--bg-sunken)'}}>
                <div className="flex items-center gap-3">
                  <div style={{width: 8, height: 8, borderRadius: 2, background: tc?.color, flexShrink: 0}}/>
                  <div style={{flex:1, fontSize: 12.5}}>
                    <strong>{form.nombre || 'Nueva lista'}</strong> · {tc?.nombre} · <span className="mono">
                      {form.modo === 'custom' ? `${manualCount} precios manuales` : `${form.modo === 'markup' ? '+' : '−'}${form.valor}%`}
                    </span>
                  </div>
                  <label className="flex items-center gap-2" style={{fontSize: 12.5, cursor: 'pointer'}}>
                    <input type="checkbox" checked={form.activa} onChange={e=>update('activa', e.target.checked)}/>
                    Activar al crear
                  </label>
                </div>
              </div>
            </>
          )}

          {tab === 'manual' && (
            <>
              <div className="flex items-center gap-3" style={{marginBottom: 12}}>
                <div style={{flex:1}}>
                  <div className="form-section-title" style={{margin:0}}>Precios manuales por producto</div>
                  <div className="small">Escribe el precio de venta deseado para cada SKU. Deja vacío para usar el precio base.</div>
                </div>
                <button className="btn ghost sm" onClick={()=>update('preciosManuales', {})}>Limpiar todos</button>
                <button className="btn secondary sm" onClick={()=>{
                  const copia = {};
                  SSData.productos.forEach(p => copia[p.sku] = Number((p.base * 0.9).toFixed(2)));
                  update('preciosManuales', copia);
                }}>Copiar base −10%</button>
              </div>
              <input className="input search mb-3" placeholder="Buscar SKU, nombre o marca..." value={customSearch} onChange={e=>setCustomSearch(e.target.value)} style={{width:'100%'}}/>
              <div className="flex gap-2 mb-3" style={{fontSize:12}}>
                <span className="chip neutral">{SSData.productos.length} productos totales</span>
                <span className="chip blue">{manualCount} con precio manual</span>
                <span className="chip amber">{SSData.productos.length - manualCount} usarán precio base</span>
              </div>
              <div className="tbl-wrap">
                <div className="tbl-scroll" style={{maxHeight: 440}}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Producto</th>
                        <th className="num">Costo</th>
                        <th className="num">Base</th>
                        <th className="num" style={{width: 140}}>Precio manual</th>
                        <th className="num">Margen</th>
                        <th style={{width:30}}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {customRows.map(p => {
                        const val = form.preciosManuales[p.sku];
                        const precio = val ?? p.base;
                        const margen = precio > 0 ? ((precio - p.costo) / precio * 100) : 0;
                        const tiene = val !== undefined;
                        return (
                          <tr key={p.sku} style={{background: tiene ? 'var(--brand-soft)' : ''}}>
                            <td className="mono-cell">{p.sku}</td>
                            <td style={{maxWidth: 240, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{p.nombre}</td>
                            <td className="num muted">{fmt.usd(p.costo)}</td>
                            <td className="num">{fmt.usd(p.base)}</td>
                            <td className="num">
                              <input
                                className="input mono"
                                type="number"
                                step="0.01"
                                value={val ?? ''}
                                placeholder={p.base.toFixed(2)}
                                onChange={e => {
                                  const v = e.target.value;
                                  const copia = {...form.preciosManuales};
                                  if (v === '' || isNaN(Number(v))) delete copia[p.sku];
                                  else copia[p.sku] = Number(v);
                                  update('preciosManuales', copia);
                                }}
                                style={{width: '100%', textAlign:'right', padding:'4px 8px'}}
                              />
                            </td>
                            <td className="num" style={{color: margen < 10 ? 'var(--danger)' : margen < 20 ? 'var(--warn)' : 'var(--success)', fontWeight: tiene ? 600 : 400}}>{margen.toFixed(1)}%</td>
                            <td>
                              {tiene && <button className="icon-btn" onClick={()=>{
                                const copia = {...form.preciosManuales};
                                delete copia[p.sku];
                                update('preciosManuales', copia);
                              }} style={{width:20, height:20}}><Icon name="x" size={10}/></button>}
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

          {tab === 'clientes' && (
            <>
              <div className="form-section-title">Asignar clientes a esta lista</div>
              <div className="small mb-3">Los clientes seleccionados usarán esta lista por defecto en cotizaciones y facturas.</div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th style={{width:40}}></th><th>Cliente</th><th>RIF</th><th>Tipo actual</th><th>Lista actual</th><th className="num">Ventas YTD</th></tr></thead>
                  <tbody>
                    {SSData.clientes.map(c => {
                      const tc2 = SSData.tiposCliente.find(t => t.id === c.tipo);
                      const lp2 = SSData.listasPrecios.find(l => l.id === c.listaPrecio);
                      const sel = form.clientesAsignados.includes(c.id);
                      return (
                        <tr key={c.id} onClick={()=>toggleCliente(c.id)} style={{cursor:'pointer', background: sel ? 'var(--brand-soft)' : ''}}>
                          <td><input type="checkbox" checked={sel} onChange={()=>toggleCliente(c.id)}/></td>
                          <td style={{fontWeight: 500}}>{c.nombre}</td>
                          <td className="mono-cell">{c.rif}</td>
                          <td><span className="chip" style={{background: tc2.color+'20', color: tc2.color}}>{tc2.nombre}</span></td>
                          <td className="small muted">{lp2?.nombre}</td>
                          <td className="num">{fmt.usd(c.ventasYTD)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === 'preview' && (
            <>
              <div className="form-section-title">Vista previa de precios calculados</div>
              <div className="small mb-3">Muestra de 6 productos con el cálculo actual. Los márgenes en rojo indican riesgo.</div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>SKU</th><th>Producto</th><th className="num">Costo</th><th className="num">Base</th><th className="num">Nuevo precio</th><th className="num">Diferencia</th><th className="num">Margen</th></tr></thead>
                  <tbody>
                    {preview.map(p => {
                      const diff = p.precio - p.base;
                      return (
                        <tr key={p.sku}>
                          <td className="mono-cell">{p.sku}</td>
                          <td style={{maxWidth: 240, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{p.nombre}</td>
                          <td className="num muted">{fmt.usd(p.costo)}</td>
                          <td className="num">{fmt.usd(p.base)}</td>
                          <td className="num strong-num" style={{color:'var(--brand)'}}>{fmt.usd(p.precio)}</td>
                          <td className="num" style={{color: diff < 0 ? 'var(--success)' : 'var(--warn)'}}>{diff > 0 ? '+' : ''}{fmt.usd(diff)}</td>
                          <td className="num" style={{color: p.margen < 10 ? 'var(--danger)' : p.margen < 20 ? 'var(--warn)' : 'var(--success)', fontWeight: 600}}>{p.margen.toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="small mt-3">Se aplicará a {SSData.productos.length} productos del catálogo.</div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!form.nombre} onClick={handleCreate}>
            <Icon name="check" size={14}/>Crear lista {form.clientesAsignados.length > 0 && `· ${form.clientesAsignados.length} clientes`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ======= Modal: Importar lista de precios =======
function ImportPriceListModal({ onClose }) {
  const STEPS = ['upload', 'config', 'preview', 'done'];
  const [step,       setStep]       = useState('upload');
  const [drop,       setDrop]       = useState(false);
  const [fileInfo,   setFileInfo]   = useState(null);   // { name, rows: [{sku,precio,...}], headers }
  const [parseErr,   setParseErr]   = useState('');
  const [skuCol,     setSkuCol]     = useState('');
  const [precioCol,  setPrecioCol]  = useState('');
  const [destino,    setDestino]    = useState('new');
  const [destinoId,  setDestinoId]  = useState('');
  const [newNombre,  setNewNombre]  = useState('');
  const [newTipo,    setNewTipo]    = useState(() => SSData.tiposCliente[0]?.id || '');
  const [saving,     setSaving]     = useState(false);
  const [result,     setResult]     = useState(null);  // { ok, skip }
  const fileRef = useRef(null);

  // Solo listas personalizadas (modo=custom) son válidas como destino existente
  const customListas = (SSData.listasPrecios || []).filter(l => l.modo === 'custom');

  // ── Parsing ──────────────────────────────────────────────────
  function parseFile(file) {
    setParseErr('');
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb   = window.XLSX.read(data, { type: 'uint8array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const raw  = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (!raw || raw.length < 2) { setParseErr('El archivo está vacío o no tiene filas de datos.'); return; }
        const headers = raw[0].map(h => String(h).trim()).filter(Boolean);
        if (headers.length < 2) { setParseErr('No se encontraron columnas en el archivo.'); return; }
        const rows = raw.slice(1).filter(r => r.some(c => c !== ''));
        setFileInfo({ name: file.name, headers, rows });
        // Auto-detect columns
        const skuGuess   = headers.find(h => /sku|codigo|código|ref|referencia/i.test(h)) || headers[0];
        const precioGuess = headers.find(h => /precio|price|costo|importe|valor/i.test(h)) || headers[1];
        setSkuCol(skuGuess);
        setPrecioCol(precioGuess);
        setStep('config');
      } catch(err) {
        setParseErr('No se pudo leer el archivo: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleDrop(e) {
    e.preventDefault(); setDrop(false);
    const f = e.dataTransfer.files[0];
    if (f) parseFile(f);
  }
  function handlePick(e) {
    const f = e.target.files[0];
    if (f) parseFile(f);
  }

  // ── Build preview rows ─────────────────────────────────────
  const previewRows = useMemo(() => {
    if (!fileInfo || !skuCol || !precioCol) return [];
    const hIdx = k => fileInfo.headers.indexOf(k);
    const si = hIdx(skuCol), pi = hIdx(precioCol);
    if (si < 0 || pi < 0) return [];
    const destLista = destino === 'existing' ? SSData.listasPrecios.find(l => l.id === destinoId) : null;
    return fileInfo.rows.map(row => {
      const sku    = String(row[si] || '').trim();
      const rawPx  = String(row[pi] || '').replace(/[^0-9.,]/g, '').replace(',', '.');
      const precio = parseFloat(rawPx);
      const prod   = SSData.productos.find(p => p.sku === sku);
      const actual = destLista ? ((destLista.preciosManuales || {})[sku] ?? prod?.base ?? null) : (prod?.base ?? null);
      let estado;
      if (!sku)            estado = 'sin_sku';
      else if (!prod)      estado = 'no_encontrado';
      else if (isNaN(precio) || precio <= 0) estado = 'precio_invalido';
      else if (actual !== null && Math.abs(precio - actual) < 0.001) estado = 'sin_cambio';
      else                 estado = precio > (actual || 0) ? 'sube' : 'baja';
      return { sku, precio: isNaN(precio) ? null : precio, prod, actual, estado };
    });
  }, [fileInfo, skuCol, precioCol, destino, destinoId]);

  const stats = useMemo(() => ({
    validas:      previewRows.filter(r => r.estado === 'sube' || r.estado === 'baja' || r.estado === 'sin_cambio').length,
    cambios:      previewRows.filter(r => r.estado === 'sube' || r.estado === 'baja').length,
    no_encontrado: previewRows.filter(r => r.estado === 'no_encontrado').length,
    errores:      previewRows.filter(r => r.estado === 'precio_invalido' || r.estado === 'sin_sku').length,
  }), [previewRows]);

  // ── Template download ─────────────────────────────────────
  function descargarPlantilla() {
    const rows = [['SKU', 'Nombre', 'Precio_Base', 'Precio_Importar']];
    SSData.productos.forEach(p => rows.push([p.sku, p.nombre, p.base, '']));
    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Precios');
    window.XLSX.writeFile(wb, 'plantilla_precios.xlsx');
  }

  // ── Apply import ──────────────────────────────────────────
  async function handleApply() {
    setSaving(true);
    const empresa = window.currentEmpresa || 'demo1';
    // Build preciosManuales from valid rows only
    const preciosManuales = {};
    previewRows.forEach(r => {
      if ((r.estado === 'sube' || r.estado === 'baja' || r.estado === 'sin_cambio') && r.precio != null) {
        preciosManuales[r.sku] = r.precio;
      }
    });

    let listaId;
    if (destino === 'new') {
      const nombre = newNombre.trim() || 'Lista importada ' + new Date().toLocaleDateString('es-VE');
      listaId = 'lp-' + nombre.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').slice(0,24) + '-' + Date.now().toString(36);
      const err = await saveLista({ id: listaId, nombre, tipo: newTipo, modo: 'custom', valor: 0, empresa_id: empresa });
      if (err) { alert('Error creando lista: ' + err.message); setSaving(false); return; }
    } else {
      listaId = destinoId;
    }

    const detalleErr = await window.saveListaDetalle?.(listaId, preciosManuales);
    if (detalleErr) { alert('Error guardando precios: ' + detalleErr.message); setSaving(false); return; }

    await window.loadAppData();
    window.logActivity?.({
      modulo: 'listas_precios', accion: destino === 'new' ? 'crear' : 'editar',
      entidad_id: listaId,
      entidad_label: destino === 'new' ? (newNombre || 'Lista importada') : (SSData.listasPrecios.find(l=>l.id===listaId)?.nombre || listaId),
      detalles: { origen: 'importacion', precios_importados: stats.validas, archivo: fileInfo?.name }
    });
    setResult({ ok: stats.validas, skip: stats.no_encontrado + stats.errores });
    setStep('done');
    setSaving(false);
  }

  const stepIdx = STEPS.indexOf(step);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width:860, maxHeight:'90vh', display:'flex', flexDirection:'column'}}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center',flexShrink:0}}>
            <Icon name="upload" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">Importar lista de precios personalizada</h3>
            <div className="small muted">Asigna precios específicos por SKU desde un archivo Excel o CSV</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        {/* Stepper */}
        {step !== 'done' && (
          <div style={{padding:'10px 20px',borderBottom:'1px solid var(--border)',display:'flex',gap:8,alignItems:'center'}}>
            {[['upload','Archivo'],['config','Configurar'],['preview','Previsualizar']].map(([id,lbl],i) => {
              const done = i < stepIdx, active = step === id;
              return (
                <React.Fragment key={id}>
                  <div style={{display:'flex',alignItems:'center',gap:6,fontSize:12.5,color:active?'var(--brand)':done?'var(--success)':'var(--text-muted)',fontWeight:active||done?600:400}}>
                    <div style={{width:22,height:22,borderRadius:'50%',display:'grid',placeItems:'center',background:active?'var(--brand)':done?'var(--success)':'var(--bg-sunken)',color:(active||done)?'#fff':'var(--text-muted)',fontSize:11,fontWeight:700}}>
                      {done ? '✓' : i+1}
                    </div>
                    {lbl}
                  </div>
                  {i < 2 && <div style={{flex:1,height:1,background:done?'var(--success)':'var(--border)'}}/>}
                </React.Fragment>
              );
            })}
          </div>
        )}

        <div className="modal-body" style={{flex:1,overflowY:'auto'}}>

          {/* ── Step 1: upload ── */}
          {step === 'upload' && (
            <>
              <div
                onDragOver={e=>{e.preventDefault();setDrop(true);}}
                onDragLeave={()=>setDrop(false)}
                onDrop={handleDrop}
                onClick={()=>fileRef.current?.click()}
                style={{border:'2px dashed '+(drop?'var(--brand)':'var(--border-strong)'),borderRadius:12,padding:48,textAlign:'center',background:drop?'var(--brand-soft)':'var(--bg-sunken)',cursor:'pointer',transition:'all .15s'}}>
                <div style={{width:52,height:52,borderRadius:14,background:'var(--bg-elev)',color:'var(--text-muted)',display:'grid',placeItems:'center',margin:'0 auto 14px'}}>
                  <Icon name="upload" size={24}/>
                </div>
                <div style={{fontSize:15,fontWeight:600,marginBottom:6}}>Arrastra tu archivo aquí o haz clic para buscar</div>
                <div className="small muted">Acepta .xlsx, .xls, .csv · Debe contener columnas de SKU y precio</div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}} onChange={handlePick}/>
              </div>
              {parseErr && <div style={{marginTop:12,padding:'10px 14px',background:'var(--danger-soft)',border:'1px solid var(--danger)',borderRadius:8,fontSize:12.5,color:'var(--danger)'}}>{parseErr}</div>}
              <div className="card mt-4" style={{padding:14,background:'var(--bg-sunken)'}}>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <Icon name="info" size={16} style={{flexShrink:0,color:'var(--text-muted)'}}/>
                  <div style={{flex:1,fontSize:12.5}}>Descarga la plantilla con todos los SKUs del catálogo para completar los precios.</div>
                  <button className="btn ghost sm" onClick={e=>{e.stopPropagation();descargarPlantilla();}}><Icon name="download" size={13}/>Plantilla .xlsx</button>
                </div>
              </div>
              <div style={{marginTop:12,padding:'10px 14px',background:'var(--brand-soft)',border:'1px solid var(--brand)',borderRadius:8,fontSize:12.5}}>
                <strong style={{color:'var(--brand)'}}>Solo listas personalizadas:</strong> la importación crea o actualiza listas de tipo <em>Personalizada</em>, donde cada producto tiene un precio específico.
              </div>
            </>
          )}

          {/* ── Step 2: config ── */}
          {step === 'config' && fileInfo && (
            <>
              {/* File card */}
              <div className="card" style={{padding:12,marginBottom:16}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:36,height:36,borderRadius:8,background:'var(--success-soft)',color:'var(--success)',display:'grid',placeItems:'center',flexShrink:0}}><Icon name="doc" size={16}/></div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:13}}>{fileInfo.name}</div>
                    <div className="small muted">{fileInfo.rows.length} filas · {fileInfo.headers.length} columnas detectadas</div>
                  </div>
                  <button className="btn ghost sm" onClick={()=>{setFileInfo(null);setStep('upload');}}>Cambiar</button>
                </div>
              </div>

              {/* Column mapping */}
              <div className="form-section-title">Mapeo de columnas</div>
              <div className="grid-2 mt-2">
                <div>
                  <label className="form-label">Columna de SKU *</label>
                  <select className="select" style={{width:'100%'}} value={skuCol} onChange={e=>setSkuCol(e.target.value)}>
                    {fileInfo.headers.map(h=><option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Columna de precio (USD) *</label>
                  <select className="select" style={{width:'100%'}} value={precioCol} onChange={e=>setPrecioCol(e.target.value)}>
                    {fileInfo.headers.map(h=><option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              </div>

              {/* Destination */}
              <div className="form-section-title mt-4">Destino</div>
              <div className="grid-2 mt-2">
                <div onClick={()=>setDestino('new')} className="card" style={{padding:14,cursor:'pointer',border:destino==='new'?'2px solid var(--brand)':'1px solid var(--border)',background:destino==='new'?'var(--brand-soft)':'var(--bg-elev)'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,fontWeight:600,fontSize:13}}><Icon name="plus" size={14}/>Crear lista nueva</div>
                  <div className="small mt-2 muted">Se creará una lista personalizada con los precios del archivo</div>
                </div>
                <div onClick={()=>{setDestino('existing');if(!destinoId&&customListas[0])setDestinoId(customListas[0].id);}} className="card" style={{padding:14,cursor:'pointer',border:destino==='existing'?'2px solid var(--brand)':'1px solid var(--border)',background:destino==='existing'?'var(--brand-soft)':'var(--bg-elev)',opacity:customListas.length===0?0.45:1}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,fontWeight:600,fontSize:13}}><Icon name="edit" size={14}/>Actualizar lista existente</div>
                  <div className="small mt-2 muted">{customListas.length===0?'No hay listas personalizadas creadas aún':'Sobreescribe los precios de una lista personalizada existente'}</div>
                </div>
              </div>

              {destino === 'new' && (
                <div className="grid-2 mt-3">
                  <div>
                    <label className="form-label">Nombre de la lista *</label>
                    <input className="input" placeholder="Lista Mayorista Abril 2026" value={newNombre} onChange={e=>setNewNombre(e.target.value)}/>
                  </div>
                  <div>
                    <label className="form-label">Tipo de cliente</label>
                    <select className="select" style={{width:'100%'}} value={newTipo} onChange={e=>setNewTipo(e.target.value)}>
                      {SSData.tiposCliente.map(t=><option key={t.id} value={t.id}>{t.nombre}</option>)}
                    </select>
                  </div>
                </div>
              )}
              {destino === 'existing' && customListas.length > 0 && (
                <div className="mt-3">
                  <label className="form-label">Lista a actualizar</label>
                  <select className="select" style={{width:'100%'}} value={destinoId} onChange={e=>setDestinoId(e.target.value)}>
                    {customListas.map(l=><option key={l.id} value={l.id}>{l.nombre} · {Object.keys(l.preciosManuales||{}).length} precios</option>)}
                  </select>
                </div>
              )}
            </>
          )}

          {/* ── Step 3: preview ── */}
          {step === 'preview' && (
            <>
              {/* Stats */}
              <div className="stat-grid" style={{gridTemplateColumns:'repeat(4,1fr)',marginBottom:16}}>
                {[
                  ['Válidas',       stats.validas,       'var(--success)'],
                  ['Con cambio',    stats.cambios,       'var(--brand)'],
                  ['No encontrado', stats.no_encontrado, 'var(--warn)'],
                  ['Errores',       stats.errores,       'var(--danger)'],
                ].map(([lbl,val,color])=>(
                  <div key={lbl} className="stat"><div className="stat-label">{lbl}</div><div className="stat-val" style={{color}}>{val}</div></div>
                ))}
              </div>

              <div className="tbl-wrap">
                <div className="tbl-toolbar">
                  <strong style={{fontSize:13}}>Vista previa · {previewRows.length} filas</strong>
                  <span className="ml-auto small muted">Solo se importarán las filas "Válidas"</span>
                </div>
                <div className="tbl-scroll" style={{maxHeight:400}}>
                  <table className="tbl">
                    <thead><tr>
                      <th>SKU</th><th>Producto</th>
                      <th className="num">Precio actual</th>
                      <th className="num">Precio nuevo</th>
                      <th className="num">Variación</th>
                      <th>Estado</th>
                    </tr></thead>
                    <tbody>
                      {previewRows.map((r,i)=>{
                        const pct = r.precio != null && r.actual != null && r.actual > 0
                          ? ((r.precio - r.actual) / r.actual * 100) : null;
                        const bg = (r.estado==='no_encontrado'||r.estado==='precio_invalido'||r.estado==='sin_sku') ? 'var(--danger-soft)' : '';
                        return (
                          <tr key={i} style={{background:bg}}>
                            <td className="mono-cell">{r.sku || <span className="muted">—</span>}</td>
                            <td style={{fontSize:12,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.prod?.nombre || <span className="muted small">No encontrado</span>}</td>
                            <td className="num muted">{r.actual != null ? fmt.usd(r.actual) : '—'}</td>
                            <td className="num strong-num">{r.precio != null ? fmt.usd(r.precio) : <span style={{color:'var(--danger)'}}>—</span>}</td>
                            <td className="num" style={{color: pct===null?'var(--text-muted)':pct>0?'var(--warn)':pct<0?'var(--success)':'var(--text-muted)'}}>
                              {pct===null ? '—' : `${pct>0?'+':''}${pct.toFixed(1)}%`}
                            </td>
                            <td>
                              {r.estado==='sube'          && <span className="chip amber" style={{fontSize:10}}><Icon name="arrUp" size={9}/>Sube</span>}
                              {r.estado==='baja'          && <span className="chip green"  style={{fontSize:10}}><Icon name="arrDn" size={9}/>Baja</span>}
                              {r.estado==='sin_cambio'    && <span className="chip neutral" style={{fontSize:10}}>Sin cambio</span>}
                              {r.estado==='no_encontrado' && <span className="chip red"    style={{fontSize:10}}>SKU no existe</span>}
                              {r.estado==='precio_invalido'&&<span className="chip red"    style={{fontSize:10}}>Precio inválido</span>}
                              {r.estado==='sin_sku'       && <span className="chip red"    style={{fontSize:10}}>Sin SKU</span>}
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

          {/* ── Step 4: done ── */}
          {step === 'done' && result && (
            <div style={{textAlign:'center',padding:'40px 0'}}>
              <div style={{fontSize:48,marginBottom:16}}>✅</div>
              <div style={{fontWeight:700,fontSize:18,marginBottom:8}}>Importación completada</div>
              <div className="small muted" style={{marginBottom:20}}>
                <strong style={{color:'var(--success)'}}>{result.ok} precios</strong> guardados en Supabase
                {result.skip > 0 && <> · <strong style={{color:'var(--warn)'}}>{result.skip} omitidos</strong> (SKU no encontrado o precio inválido)</>}
              </div>
              <button className="btn primary" onClick={onClose}><Icon name="check" size={14}/>Cerrar</button>
            </div>
          )}
        </div>

        {/* Footer */}
        {step !== 'done' && (
          <div className="modal-footer">
            <button className="btn ghost" onClick={onClose}>Cancelar</button>
            {step === 'upload' && <button className="btn primary" disabled>Continuar</button>}
            {step === 'config' && <>
              <button className="btn secondary" onClick={()=>setStep('upload')}>← Atrás</button>
              <button className="btn primary"
                disabled={!skuCol || !precioCol || (destino==='new' && !newNombre.trim()) || (destino==='existing' && !destinoId)}
                onClick={()=>setStep('preview')}>
                Previsualizar →
              </button>
            </>}
            {step === 'preview' && <>
              <button className="btn secondary" onClick={()=>setStep('config')}>← Atrás</button>
              <button className="btn primary" disabled={stats.validas === 0 || saving} onClick={handleApply}>
                <Icon name="check" size={14}/>{saving ? 'Guardando…' : `Importar ${stats.validas} precios`}
              </button>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}
