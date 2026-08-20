// ══════════════════════════════════════════════════════════════════
// Reportes Dinámicos — Pivot Table
// ══════════════════════════════════════════════════════════════════

const { useState, useMemo, useRef, useEffect, useCallback } = React;

// ─── Dimension catalog ────────────────────────────────────────────
const _DIMS = [
  { id: 'dia',          label: 'Período (Día)',        fn: r => r.fecha            },
  { id: 'mes',          label: 'Período (Mes)',        fn: r => r.mes              },
  { id: 'trim',         label: 'Período (Trimestre)',  fn: r => r.trim             },
  { id: 'año',          label: 'Año',                  fn: r => r.año              },
  { id: 'vendedor',     label: 'Vendedor',             fn: r => r.vendedor         },
  { id: 'cliente',      label: 'Cliente',              fn: r => r.clienteNombre    },
  { id: 'tipo_cliente', label: 'Tipo de cliente',      fn: r => r.clienteTipo      },
  { id: 'lista',        label: 'Lista de precios',     fn: r => r.clienteLista     },
  { id: 'producto',     label: 'Producto',             fn: r => r.producto         },
  { id: 'sku',          label: 'SKU',                  fn: r => r.sku              },
  { id: 'categoria',    label: 'Categoría',            fn: r => r.categoria        },
  { id: 'marca',        label: 'Marca',                fn: r => r.marca            },
  { id: 'estado',       label: 'Estado doc.',          fn: r => r.estado           },
  { id: 'empresa',      label: 'Empresa',              fn: r => r.empresa          },
  { id: 'almacen',      label: 'Almacén',              fn: r => r.almacen          },
  { id: 'fuente',          label: 'Fuente de venta',      fn: r => r.fuente_venta     },
  { id: 'tipo_entrega',   label: 'Tipo de entrega',      fn: r => r.tipo_entrega     },
  { id: 'modalidad_pago', label: 'Modalidad de pago',    fn: r => r.modalidad_pago   },
  // El documento en sí (la factura) y la ORDEN que lo generó. Sin `orden_origen` no se puede
  // pedir "las órdenes que generaron las ventas del mes": cambiar la etapa a `orden` mide otra
  // cosa (todas las órdenes, incluidas las que nunca se facturaron).
  { id: 'documento',    label: 'Documento (N°)',       fn: r => r.doc_id           },
  { id: 'orden_origen', label: 'Orden de origen',      fn: r => r.ordenOrigen      },
];
const _DIM_MAP = Object.fromEntries(_DIMS.map(d => [d.id, d]));

// ─── Measure catalog ──────────────────────────────────────────────
const _MEASURES = [
  { id: 'monto_usd',  label: 'Monto USD',        fmtFn: v => fmt.usd(v)                                },
  { id: 'monto_ves',  label: 'Monto VES',         fmtFn: v => fmt.ves(v)                                },
  { id: 'num_docs',   label: '# Documentos',      fmtFn: v => Math.round(v).toLocaleString('es-VE')    },
  { id: 'unidades',   label: 'Unidades',          fmtFn: v => Math.round(v).toLocaleString('es-VE')    },
  { id: 'promedio',   label: 'Promedio/Doc',      fmtFn: v => fmt.usd(v)                                },
  // Costo y ganancia en plata, no solo el porcentaje: "cuánto costó" y "cuánto quedó" es la
  // pregunta de la que sale el % y la que hay que poder exportar.
  { id: 'costo_usd',    label: 'Costo USD',       fmtFn: v => fmt.usd(v)                             },
  { id: 'ganancia_usd', label: 'Ganancia USD',    fmtFn: v => fmt.usd(v)                             },
  { id: 'margen_pct', label: '% Margen',          fmtFn: v => (isFinite(v) ? v : 0).toFixed(1) + '%'   },
];
const _MEAS_MAP = Object.fromEntries(_MEASURES.map(m => [m.id, m]));

// ─── Histórico server-side (RPC get_ventas_pivot) ─────────────────
// La RPC get_ventas_pivot soporta 1 o 2 dimensiones de fila con CUALQUIER dimensión del catálogo
// y agrega sobre TODO el histórico (evita el cap de 90 días de SSData.documentos). Se usa siempre
// que la vista sea de filas (1-2 dims) sin pivote de columna ni filtros que la RPC no honra.
const _SERVER_DIMS = new Set(_DIMS.map(d => d.id));
// dimId → campo que lee la función fn del pivote (para armar las filas sintéticas del server).
const _DIM_FIELD = {
  dia:'fecha', mes:'mes', trim:'trim', 'año':'año', vendedor:'vendedor', cliente:'clienteNombre',
  tipo_cliente:'clienteTipo', lista:'clienteLista', producto:'producto', sku:'sku',
  categoria:'categoria', marca:'marca', estado:'estado', empresa:'empresa',
  almacen:'almacen', fuente:'fuente_venta', tipo_entrega:'tipo_entrega', modalidad_pago:'modalidad_pago',
  documento:'doc_id', orden_origen:'ordenOrigen',
};

// Tipos de documento (columna documentos.tipo — la ETAPA, no el estado).
const _TIPOS_DOC = [
  { id: 'factura',    label: 'Facturas'     },
  { id: 'orden',      label: 'Órdenes'      },
  { id: 'cotizacion', label: 'Cotizaciones' },
];

// Rango por defecto del modo server = TODO el histórico (la RPC agrega server-side en ~0.5s, y
// el propósito de F4 es escapar el cap de 90 días). Si el usuario pone fechas, se respetan.
function _currentYearRange() {
  const y = new Date().getFullYear();
  return { desde: '2015-01-01', hasta: `${y}-12-31` };
}

// ─── Aggregation ──────────────────────────────────────────────────
function _agg(rows, mid, tasa) {
  if (!rows || !rows.length) return 0;
  // ── Server-side pre-aggregated rows (get_ventas_resumen) ──
  // Cada fila trae totales ya agregados por dimensión; se suman entre grupos.
  if (rows[0] && rows[0]._pa) {
    const s = f => rows.reduce((a, r) => a + (Number(r[f]) || 0), 0);
    switch (mid) {
      case 'monto_usd':  return s('_monto');
      case 'monto_ves':  return s('_monto') * tasa;
      case 'num_docs':   return s('_docs');
      case 'unidades':   return s('_unidades');
      case 'promedio': { const d = s('_docs'); return d ? s('_monto') / d : 0; }
      case 'costo_usd':    return s('_costo');
      case 'ganancia_usd': return s('_margen');
      // El % se mide contra la venta SIN cobertura BCV (`_ventaMargen`), no contra el monto
      // facturado: la cobertura es ajuste de tasa y no ganancia. Si el server no la mandó
      // (respuesta vieja), se cae al monto para no dividir por cero.
      case 'margen_pct': { const m = s('_ventaMargen') || s('_monto'); return m > 0 ? (s('_margen') / m) * 100 : 0; }
      default: return 0;
    }
  }
  switch (mid) {
    case 'monto_usd':  return rows.reduce((s, r) => s + (r.subtotal || 0), 0);
    case 'monto_ves':  return rows.reduce((s, r) => s + (r.subtotal || 0), 0) * tasa;
    case 'num_docs':   return new Set(rows.map(r => r.doc_id)).size;
    case 'unidades':   return rows.reduce((s, r) => s + (r.qty || 0), 0);
    case 'promedio': {
      const docs = new Set(rows.map(r => r.doc_id)).size;
      const tot  = rows.reduce((s, r) => s + (r.subtotal || 0), 0);
      return docs ? tot / docs : 0;
    }
    case 'costo_usd':    return rows.reduce((s, r) => s + (r.costo_total || 0), 0);
    case 'ganancia_usd': return rows.reduce((s, r) => s + ((r.subtotal_margen ?? r.subtotal ?? 0) - (r.costo_total || 0)), 0);
    case 'margen_pct': {
      // Usar subtotal_margen (base sin cobertura BCV) para no inflar el margen.
      // Fallback a subtotal por compatibilidad con filas sin el campo.
      const v = rows.reduce((s, r) => s + (r.subtotal_margen ?? r.subtotal ?? 0), 0);
      const c = rows.reduce((s, r) => s + (r.costo_total|| 0), 0);
      return v > 0 ? ((v - c) / v) * 100 : 0;
    }
    default: return 0;
  }
}

function _sortKeys(keys, dimId) {
  const chrono = ['dia', 'mes', 'trim', 'año'];
  if (chrono.includes(dimId)) return [...keys].sort();
  return [...keys].sort((a, b) => String(a).localeCompare(String(b), 'es'));
}

// Nombre de producto → SKU, para el paréntesis de la dimensión "producto". La RPC del pivote
// agrupa por NOMBRE (`dim1='producto'` no trae el sku), así que hay que resolverlo del catálogo
// en memoria. Cacheado por referencia de `SSData.productos` — se reconstruye solo si el arreglo
// cambia (llega una tanda nueva de datos), no en cada fila.
let _skuPorNombreCache = null;
let _skuPorNombreSrc   = null;
function _skuPorNombre(nombre) {
  if (_skuPorNombreSrc !== SSData.productos) {
    _skuPorNombreSrc = SSData.productos;
    _skuPorNombreCache = new Map();
    (SSData.productos || []).forEach(p => {
      if (p.nombre && !_skuPorNombreCache.has(p.nombre)) _skuPorNombreCache.set(p.nombre, p.sku);
    });
  }
  return _skuPorNombreCache.get(nombre) || null;
}

// Etiqueta de fila/columna legible: para 'mes'/'dia' añade el nombre (Julio 2026 / Miércoles)
// junto a la clave cronológica, que se mantiene como valor base para no perder el orden/búsqueda.
// Para 'producto' agrega el SKU entre paréntesis — pedido explícito, para poder identificar el
// producto exacto cuando dos nombres se parecen (o distinguirlo del todo si el nombre cambió).
function _fmtDimLabel(dimId, key) {
  if (key == null || key === '—' || key === '') return key;
  if (dimId === 'mes') return `${key} · ${fmt.mesNombre(key)}`;
  if (dimId === 'dia') return `${key} · ${fmt.diaNombre(key)}`;
  if (dimId === 'producto') {
    const sku = _skuPorNombre(key);
    return sku ? `${key} (${sku})` : key;
  }
  return key;
}

// ══════════════════════════════════════════════════════════════════
// ReportesPage
// ══════════════════════════════════════════════════════════════════
window.ReportesPage = function ReportesPage() {
  // ── Config
  const [rowDim1,    setRowDim1]    = useState('mes');
  const [rowDim2,    setRowDim2]    = useState('');
  const [colDim,     setColDim]     = useState('');
  const [colDim2,    setColDim2]    = useState('');
  const [measures,   setMeasures]   = useState(['monto_usd', 'num_docs']);
  // ── Filters
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [estadoF,    setEstadoF]    = useState('');
  const [tipoCliF,   setTipoCliF]   = useState('');
  const [empresaF,   setEmpresaF]   = useState('');
  const [skuF,       setSkuF]       = useState('');
  const [clienteIdF, setClienteIdF] = useState('');
  const [tasa,       setTasa]       = useState('bcv');
  const [tipoDoc,    setTipoDoc]    = useState('factura'); // etapa: factura|orden|cotizacion
  // Tercer nivel de filas. Con dos se llega a "el mes y sus órdenes"; el margen aparece en el
  // tercero (los productos de esa orden), que es donde se ve qué línea se está regalando.
  const [rowDim3,    setRowDim3]    = useState('');
  // ── Histórico server-side (get_ventas_resumen)
  const [serverAgg,     setServerAgg]     = useState(null);  // null = no cargado / no aplica
  const [serverLoading, setServerLoading] = useState(false);
  // ── UI
  const [expanded,      setExpanded]      = useState(new Set());
  const [showMedidas,   setShowMedidas]   = useState(false);
  const [dataVersion,   setDataVersion]   = useState(0);
  // Búsqueda sobre los resultados ya calculados (post filas/columnas) — no vuelve a pegarle al
  // server, solo filtra qué filas del pivote ya construido se muestran.
  const [searchQuery,   setSearchQuery]   = useState('');
  // ── Paginación de filas del pivote (puede tener muchas filas por SKU/cliente)
  const [page,          setPage]          = useState(1);
  const [pageSize,      setPageSize]      = useState(() => {
    const v = parseInt(localStorage.getItem('ss-reportes-pagesize')) || 50;
    return [50, 100, 200].includes(v) ? v : 50;
  });
  useEffect(() => { localStorage.setItem('ss-reportes-pagesize', String(pageSize)); }, [pageSize]);
  // ── Reportes guardados
  const [savedReports,  setSavedReports]  = useState([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showReportsList, setShowReportsList] = useState(false);
  const [saveName,      setSaveName]      = useState('');
  const [saveDesc,      setSaveDesc]      = useState('');
  const [saving,        setSaving]        = useState(false);
  const [editingReport, setEditingReport] = useState(null); // reporte a sobrescribir
  const [reportToast,   setReportToast]   = useState(null);

  function showRToast(msg, type = 'success') {
    setReportToast({ msg, type });
    setTimeout(() => setReportToast(null), 3000);
  }

  useEffect(() => {
    window.loadReportesGuardados?.().then(list => setSavedReports(list));

    // Asegurar que el cache de empresas esté disponible para pre-poblar colKeys
    if (!window.__ssEmpresasCache?.length) {
      window.loadEmpresas?.().then(list => {
        window.__ssEmpresasCache = list || [];
        setDataVersion(v => v + 1); // recompute pivot con empresas pre-pobladas
      });
    }

    function onDataReady() { setDataVersion(v => v + 1); }
    window.addEventListener('ss-data-extra-loaded', onDataReady);
    if ((SSData.documentos || []).length > 0) setDataVersion(v => v + 1);
    return () => window.removeEventListener('ss-data-extra-loaded', onDataReady);
  }, []);

  useEffect(() => {
    if (!showReportsList) return;
    function handleClick() { setShowReportsList(false); }
    setTimeout(() => document.addEventListener('click', handleClick), 0);
    return () => document.removeEventListener('click', handleClick);
  }, [showReportsList]);

  function getCurrentConfig() {
    return { rowDim1, rowDim2, rowDim3, colDim, colDim2, measures, fechaDesde, fechaHasta, estadoF, tipoCliF, empresaF, skuF, clienteIdF, tasa, tipoDoc };
  }

  // ── Presets built-in
  const BUILT_IN_PRESETS = [
    {
      id: 'preset-ventas-mes',
      nombre: 'Ventas por mes',
      descripcion: 'Facturación mensual (histórico completo server-side)',
      config: {
        rowDim1: 'mes', rowDim2: '', colDim: '', colDim2: '',
        measures: ['monto_usd', 'num_docs', 'unidades'],
        fechaDesde: '', fechaHasta: '', estadoF: '', tipoCliF: '', empresaF: '',
        skuF: '', clienteIdF: '', tasa: 'bcv', tipoDoc: 'factura',
      },
    },
    {
      id: 'preset-rotacion-productos',
      nombre: 'Rotación de Productos',
      descripcion: 'Top productos por unidades vendidas (SKU, histórico completo)',
      config: {
        rowDim1: 'sku', rowDim2: '', colDim: '', colDim2: '',
        measures: ['unidades', 'num_docs', 'monto_usd'],
        fechaDesde: '', fechaHasta: '', estadoF: '', tipoCliF: '', empresaF: '',
        skuF: '', clienteIdF: '', tasa: 'bcv', tipoDoc: 'factura',
      },
    },
    // Recuperados de los reportes personalizados de Odoo (pivots de ventas por vendedor/moneda).
    {
      id: 'preset-ventas-vendedor',
      nombre: 'Ventas por vendedor',
      descripcion: 'Monto y # docs facturados por vendedor (histórico completo)',
      config: {
        rowDim1: 'vendedor', rowDim2: '', colDim: '', colDim2: '',
        measures: ['monto_usd', 'num_docs', 'unidades'],
        fechaDesde: '', fechaHasta: '', estadoF: '', tipoCliF: '', empresaF: '',
        skuF: '', clienteIdF: '', tasa: 'bcv', tipoDoc: 'factura',
      },
    },
    {
      id: 'preset-ventas-vendedor-mes',
      nombre: 'Ventas vendedor × mes',
      descripcion: 'Facturación por mes desglosada por vendedor (histórico completo)',
      config: {
        rowDim1: 'mes', rowDim2: 'vendedor', colDim: '', colDim2: '',
        measures: ['monto_usd', 'num_docs'],
        fechaDesde: '', fechaHasta: '', estadoF: '', tipoCliF: '', empresaF: '',
        skuF: '', clienteIdF: '', tasa: 'bcv', tipoDoc: 'factura',
      },
    },
    {
      // El pedido literal: "las ventas del mes + las órdenes que generaron esas ventas + los
      // costos de esas ventas". Tres niveles: mes › orden de origen › producto, con costo,
      // ganancia y % de margen al lado de la venta.
      id: 'preset-ventas-ordenes-costos',
      nombre: 'Ventas del mes, sus órdenes y sus costos',
      descripcion: 'Mes › orden que generó la venta › producto, con costo, ganancia y margen',
      config: {
        rowDim1: 'mes', rowDim2: 'orden_origen', rowDim3: 'producto', colDim: '', colDim2: '',
        measures: ['monto_usd', 'costo_usd', 'ganancia_usd', 'margen_pct'],
        fechaDesde: '', fechaHasta: '', estadoF: '', tipoCliF: '', empresaF: '',
        skuF: '', clienteIdF: '', tasa: 'bcv', tipoDoc: 'factura',
      },
    },
    {
      id: 'preset-ventas-modalidad',
      nombre: 'Ventas por moneda',
      descripcion: 'Facturación por modalidad de pago / moneda (divisas / BCV / paralelo)',
      config: {
        rowDim1: 'modalidad_pago', rowDim2: '', colDim: '', colDim2: '',
        measures: ['monto_usd', 'num_docs'],
        fechaDesde: '', fechaHasta: '', estadoF: '', tipoCliF: '', empresaF: '',
        skuF: '', clienteIdF: '', tasa: 'bcv', tipoDoc: 'factura',
      },
    },
  ];

  function loadReport(rep) {
    const c = rep.config || {};
    if (c.rowDim1)    setRowDim1(c.rowDim1);
    if (c.rowDim2 !== undefined) setRowDim2(c.rowDim2 || '');
    if (c.rowDim3 !== undefined) setRowDim3(c.rowDim3 || ''); else setRowDim3('');
    if (c.colDim  !== undefined) setColDim(c.colDim   || '');
    if (c.colDim2 !== undefined) setColDim2(c.colDim2 || ''); else setColDim2('');
    if (c.measures?.length)      setMeasures(c.measures);
    if (c.fechaDesde !== undefined) setFechaDesde(c.fechaDesde || '');
    if (c.fechaHasta !== undefined) setFechaHasta(c.fechaHasta || '');
    if (c.estadoF    !== undefined) setEstadoF(c.estadoF    || '');
    if (c.tipoCliF   !== undefined) setTipoCliF(c.tipoCliF  || '');
    if (c.empresaF   !== undefined) setEmpresaF(c.empresaF  || '');
    if (c.skuF       !== undefined) setSkuF(c.skuF       || ''); else setSkuF('');
    if (c.clienteIdF !== undefined) setClienteIdF(c.clienteIdF || ''); else setClienteIdF('');
    if (c.tasa)       setTasa(c.tasa);
    if (c.tipoDoc)    setTipoDoc(c.tipoDoc); else setTipoDoc('factura');
    setExpanded(new Set());
    setShowReportsList(false);
    showRToast('Reporte "' + rep.nombre + '" cargado');
  }

  async function handleSaveReport() {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      if (editingReport) {
        const { error } = await window.updateReporteGuardado(editingReport.id, saveName.trim(), saveDesc.trim(), getCurrentConfig());
        if (error) { showRToast('Error al actualizar', 'error'); return; }
        setSavedReports(prev => prev.map(r => r.id === editingReport.id ? { ...r, nombre: saveName.trim(), descripcion: saveDesc.trim(), config: getCurrentConfig() } : r));
        showRToast('Reporte actualizado');
      } else {
        const { data, error } = await window.saveReporteGuardado(saveName.trim(), saveDesc.trim(), getCurrentConfig());
        if (error) { showRToast('Error al guardar', 'error'); return; }
        if (data) setSavedReports(prev => [data, ...prev]);
        showRToast('Reporte guardado');
      }
      setShowSaveModal(false); setSaveName(''); setSaveDesc(''); setEditingReport(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteReport(rep, e) {
    e.stopPropagation();
    if (!confirm('¿Eliminar el reporte "' + rep.nombre + '"?')) return;
    const { error } = await window.deleteReporteGuardado(rep.id);
    if (error) { showRToast('Error al eliminar', 'error'); return; }
    setSavedReports(prev => prev.filter(r => r.id !== rep.id));
    showRToast('Reporte eliminado');
  }

  function openEditModal(rep, e) {
    e.stopPropagation();
    setEditingReport(rep);
    setSaveName(rep.nombre);
    setSaveDesc(rep.descripcion || '');
    setShowSaveModal(true);
    setShowReportsList(false);
  }

  const tasaVal = useMemo(() =>
    tasa === 'bcv'
      ? (SSData.tasaBCV     || 1)
      : (SSData.tasaParalelo || SSData.tasaBCV || 1)
  , [tasa]);

  // ── Build item-level base dataset (join docs × items × clients × products)
  const baseRows = useMemo(() => {
    const cliMap  = Object.fromEntries((SSData.clientes  || []).map(c => [c.id,  c]));
    const prodMap = Object.fromEntries((SSData.productos || []).map(p => [p.sku, p]));
    const almMap  = Object.fromEntries((SSData.almacenes || []).map(a => [a.id,  a]));
    const empMap  = Object.fromEntries((window.__ssEmpresasCache || []).map(e => [e.id, e]));
    const rows = [];

    for (const doc of (SSData.documentos || [])) {
      const cli   = cliMap[doc.cliente_id || doc.cliente];
      const alm   = almMap[doc.almacen_id];
      const emp   = empMap[doc.empresa_id];
      const fecha = (doc.fecha || '').slice(0, 10);
      const mes   = fecha.slice(0, 7) || '—';
      const año   = fecha.slice(0, 4) || '—';
      const mNum  = parseInt(fecha.slice(5, 7)) || 1;
      const trim  = año !== '—' ? `${año}-Q${Math.ceil(mNum / 3)}` : '—';

      const meta = {
        doc_id:        doc.id,
        ordenOrigen:   doc.documento_origen_id || '(sin orden)',
        docTipo:       doc.tipo                      || '',
        fecha, mes, año, trim,
        estado:        doc.estado                   || '—',
        vendedor:      doc.vendedor || doc.creado_por|| '—',
        clienteId:     cli?.id      || doc.cliente_id || doc.cliente || '',
        clienteNombre: cli?.nombre  || doc.cliente_id|| '—',
        clienteTipo:   cli?.tipo    || cli?.tipo_cliente || '—',
        clienteLista:  cli?.listaPrecio || '—',
        empresa:       emp?.nombre  || doc.empresa_id|| '—',
        almacen:        alm?.nombre  || '—',
        fuente_venta:   doc.fuente   || doc.fuente_venta || '—',
        tipo_entrega:   doc.tipo_entrega   || '—',
        modalidad_pago: doc.modalidad_pago || '—',
      };

      // Para BCV, subtotal/precio llevan incorporada la cobertura (markup BCV).
      // El margen real va sobre la base sin cobertura (alineado con _margenDoc de comisiones.jsx).
      const esBCV     = doc.modalidad_pago === 'bcv';
      const cobDoc    = esBCV ? (Number(doc.cobertura_pct) || SSData.tasa?.cobertura || 0) : 0;
      const factorCob = cobDoc > 0 ? 1 + cobDoc / 100 : 1;

      const lines = Array.isArray(doc.lines) ? doc.lines : [];
      if (lines.length === 0) {
        const subDoc = parseFloat(doc.total) || 0;
        rows.push({ ...meta, sku:'—', producto:'—', categoria:'—', marca:'—',
                    qty:0, precio_unit:0, subtotal: subDoc, subtotal_margen: subDoc / factorCob, costo_unit:0, costo_total:0 });
      } else {
        for (const item of lines) {
          const prod       = prodMap[item.sku];
          const qty        = parseFloat(item.qty || item.cantidad) || 0;
          const precio     = parseFloat(item.precio || item.precio_unit || item.precio_unitario) || 0;
          const subtotal   = parseFloat(item.subtotal) || precio * qty;
          // Mismo criterio que la RPC: el costo que se cargó en la línea (el de un proveedor
          // tercero para ESA venta) manda; si no hay, el del catálogo.
          const costo_unit = parseFloat(item.costo) || parseFloat(prod?.costo) || 0;
          rows.push({
            ...meta,
            sku:         item.sku    || '—',
            producto:    item.nombre || prod?.nombre || item.sku || '—',
            categoria:   prod?.categoria || '—',
            marca:       prod?.marca     || '—',
            qty,
            precio_unit: precio,
            subtotal,
            // base sin cobertura para el cálculo de margen (BCV); = subtotal cuando no hay cobertura
            subtotal_margen: subtotal / factorCob,
            costo_unit,
            costo_total: costo_unit * qty,
          });
        }
      }
    }
    return rows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  // ── FASE 4: ¿aplica el histórico server-side? ────────────────────
  // Solo para vistas de UNA dimensión soportada, sin sub-fila/columna ni
  // filtros que la RPC no puede honrar (tipo de cliente/empresa/sku/cliente/estado).
  // Server-side (histórico completo) para vistas de 1-2 dimensiones de FILA de cualquier tipo,
  // sin pivote de columna ni filtros que la RPC no honra.
  const canUseServer = _SERVER_DIMS.has(rowDim1)
    && (!rowDim2 || _SERVER_DIMS.has(rowDim2))
    && (!rowDim3 || (rowDim2 && _SERVER_DIMS.has(rowDim3)))
    && !colDim && !colDim2
    && !estadoF && !tipoCliF && !empresaF && !skuF && !clienteIdF;

  // ── Fetch de la RPC (histórico completo, sin cap de 90 días) ──────
  useEffect(() => {
    if (!canUseServer) { setServerAgg(null); setServerLoading(false); return; }
    let cancelled = false;
    const yr = _currentYearRange();
    const p_desde = fechaDesde || yr.desde;
    const p_hasta = fechaHasta || yr.hasta;
    setServerLoading(true);
    (async () => {
      try {
        const { data, error } = await window.sb.rpc('get_ventas_pivot', {
          p_empresa_id: window.currentEmpresa || 'demo1',
          p_desde, p_hasta,
          p_tipo: tipoDoc,
          p_dim1: rowDim1,
          p_dim2: rowDim2 || null,
          p_dim3: rowDim3 || null,
        });
        if (cancelled) return;
        if (error || !Array.isArray(data)) { setServerAgg(null); }  // fallback a memoria
        else setServerAgg(data);
      } catch (_e) {
        if (!cancelled) setServerAgg(null);  // fallback a memoria
      } finally {
        if (!cancelled) setServerLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canUseServer, rowDim1, rowDim2, rowDim3, tipoDoc, fechaDesde, fechaHasta]);

  const serverMode = canUseServer && Array.isArray(serverAgg);

  // Reset a la primera página cuando cambian dimensiones, filtros o tamaño de página
  useEffect(() => { setPage(1); }, [rowDim1, rowDim2, rowDim3, colDim, colDim2, fechaDesde, fechaHasta, estadoF, tipoCliF, empresaF, skuF, clienteIdF, tipoDoc, pageSize, serverMode, searchQuery]);

  // ── Synthetic rows a partir del agregado server (uno por grupo) ──
  // Reusan el motor de pivote: _agg detecta `_pa` y suma los totales.
  const serverRows = useMemo(() => {
    if (!serverMode) return [];
    const f1 = _DIM_FIELD[rowDim1];
    const f2 = rowDim2 ? _DIM_FIELD[rowDim2] : null;
    const f3 = rowDim3 ? _DIM_FIELD[rowDim3] : null;
    return serverAgg.map((r, i) => {
      const row = {
        _pa: true,
        doc_id: '__srv_' + i,
        [f1]: (r.dim1 == null ? '—' : String(r.dim1)),
        _monto:    Number(r.monto)    || 0,
        _docs:     Number(r.docs)     || 0,
        _unidades: Number(r.unidades) || 0,
        _costo:    Number(r.costo)    || 0,
        // Venta sin la cobertura BCV: es contra ESTA que se mide el margen.
        _ventaMargen: Number(r.venta_margen) || 0,
        _margen:   Number(r.margen)   || 0,
      };
      if (f2) row[f2] = (r.dim2 == null ? '—' : String(r.dim2));
      if (f3) row[f3] = (r.dim3 == null ? '—' : String(r.dim3));
      return row;
    });
  }, [serverMode, serverAgg, rowDim1, rowDim2, rowDim3]);

  // ── Apply filters ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (serverMode) return serverRows;  // ya filtrado/agregado en el server
    return baseRows.filter(r => {
      // Filtro de etapa (tipo) + excluir canceladas — alineado con la RPC.
      if (tipoDoc  && r.docTipo && r.docTipo !== tipoDoc) return false;
      if (r.estado === 'cancelada' && estadoF !== 'cancelada') return false;
      if (fechaDesde && r.fecha < fechaDesde) return false;
      if (fechaHasta && r.fecha > fechaHasta) return false;
      if (estadoF    && r.estado      !== estadoF)   return false;
      if (tipoCliF   && r.clienteTipo !== tipoCliF)  return false;
      if (empresaF   && r.empresa     !== empresaF)  return false;
      if (skuF       && r.sku         !== skuF)      return false;
      if (clienteIdF && String(r.clienteId) !== String(clienteIdF)) return false;
      return true;
    });
  }, [serverMode, serverRows, baseRows, tipoDoc, fechaDesde, fechaHasta, estadoF, tipoCliF, empresaF, skuF, clienteIdF]);

  // ── Header stats (docs/líneas) — respeta modo server ──────────────
  const headerStats = useMemo(() => {
    if (serverMode) {
      const docs = filtered.reduce((a, r) => a + (r._docs || 0), 0);
      return { docs, lines: filtered.length };
    }
    return { docs: new Set(filtered.map(r => r.doc_id)).size, lines: filtered.length };
  }, [serverMode, filtered]);

  // ── Build pivot structure
  // Map: r1key → r2key → colkey → rows[]
  const pivot = useMemo(() => {
    const d1  = _DIM_MAP[rowDim1];
    const d2  = rowDim2  ? _DIM_MAP[rowDim2]  : null;
    // El 3er nivel solo existe si hay 2do: "mes › (nada) › producto" no significa nada.
    const d3  = (rowDim2 && rowDim3) ? _DIM_MAP[rowDim3] : null;
    const dc  = colDim   ? _DIM_MAP[colDim]   : null;
    const dc2 = colDim2  ? _DIM_MAP[colDim2]  : null;

    const dataMap = new Map();
    const r1Set   = new Set();
    const colSet  = new Set();
    const col2Set = new Set();

    // dataMap: k1 → k2 → k3 → columna → filas. El nivel 3 usa '__' cuando no hay dimensión,
    // igual que ya hacían el 2 y la columna: así getRows recorre siempre la misma forma.
    for (const r of filtered) {
      const k1 = d1.fn(r);
      const k2 = d2  ? d2.fn(r)  : '__';
      const k3 = d3  ? d3.fn(r)  : '__';
      const kc = dc  ? dc.fn(r)  : '__';
      r1Set.add(k1);
      if (dc)  colSet.add(kc);
      if (dc2) col2Set.add(dc2.fn(r));

      if (!dataMap.has(k1)) dataMap.set(k1, new Map());
      const m2 = dataMap.get(k1);
      if (!m2.has(k2)) m2.set(k2, new Map());
      const m3 = m2.get(k2);
      if (!m3.has(k3)) m3.set(k3, new Map());
      const mc = m3.get(k3);
      if (!mc.has(kc)) mc.set(kc, []);
      mc.get(kc).push(r);
    }

    // Pre-populate empresa dimension with all known empresas (show even if 0 data)
    function _prePopEmpresa(set) {
      for (const e of (window.__ssEmpresasCache || [])) {
        const label = e.nombre || e.id;
        if (label && label !== '—') set.add(label);
      }
    }
    if (dc  && colDim  === 'empresa') _prePopEmpresa(colSet);
    if (dc2 && colDim2 === 'empresa') _prePopEmpresa(col2Set);

    // Pre-populate modalidad_pago with known values
    const _MODALIDADES = ['bcv', 'paralelo', 'divisas'];
    if (dc  && colDim  === 'modalidad_pago') _MODALIDADES.forEach(v => colSet.add(v));
    if (dc2 && colDim2 === 'modalidad_pago') _MODALIDADES.forEach(v => col2Set.add(v));

    const r1Keys   = _sortKeys([...r1Set],  rowDim1);
    const colKeys  = dc  ? _sortKeys([...colSet],  colDim)  : [];
    const col2Keys = dc2 ? _sortKeys([...col2Set], colDim2) : [];

    const subKeys = {};
    const subKeys3 = {};   // clave 'k1|k2' → keys del 3er nivel
    if (d2) {
      for (const k1 of r1Keys) {
        const m2 = dataMap.get(k1) || new Map();
        subKeys[k1] = _sortKeys([...m2.keys()].filter(k => k !== '__'), rowDim2);
        if (d3) {
          for (const k2 of subKeys[k1]) {
            const m3 = m2.get(k2) || new Map();
            subKeys3[k1 + '|' + k2] = _sortKeys([...m3.keys()].filter(k => k !== '__'), rowDim3);
          }
        }
      }
    }
    return { d1, d2, d3, dc, dc2, dataMap, r1Keys, colKeys, col2Keys, subKeys, subKeys3 };
  }, [filtered, rowDim1, rowDim2, rowDim3, colDim, colDim2]);

  // ── Row data helpers
  // r2/r3 en null = "todos los de ese nivel" (para los totales de la fila padre).
  function getRows(r1, r2, col, col2 = null, r3 = null) {
    const m2 = pivot.dataMap.get(r1);
    if (!m2) return [];
    const r2keys = r2 !== null ? [r2] : [...m2.keys()];
    const result = [];
    for (const rk of r2keys) {
      const m3 = m2.get(rk);
      if (!m3) continue;
      const r3keys = r3 !== null ? [r3] : [...m3.keys()];
      for (const rk3 of r3keys) {
        const mc = m3.get(rk3);
        if (!mc) continue;
        if (col === null) {
          for (const rows of mc.values()) result.push(...rows);
        } else {
          result.push(...(mc.get(col) || []));
        }
      }
    }
    if (col2 !== null && pivot.dc2) return result.filter(r => pivot.dc2.fn(r) === col2);
    return result;
  }

  // Returns filtered rows matching a colSpec for the grand-total row
  function getSpecGlobalRows(spec) {
    if (!spec.col) return filtered;
    const base = filtered.filter(r => pivot.dc && pivot.dc.fn(r) === spec.col);
    if (!spec.col2) return base;
    return base.filter(r => pivot.dc2 && pivot.dc2.fn(r) === spec.col2);
  }

  // ── Column specs: each entry describes one leaf column group
  // { col, col2, isGrand }  — no intermediate subtotals
  const colSpecs = useMemo(() => {
    if (!pivot.colKeys.length) return [{ col: null, col2: null, isGrand: true }];
    if (!pivot.col2Keys.length) {
      return [
        ...pivot.colKeys.map(k => ({ col: k, col2: null })),
        { col: null, col2: null, isGrand: true },
      ];
    }
    return [
      ...pivot.colKeys.flatMap(k =>
        pivot.col2Keys.map(k2 => ({ col: k, col2: k2 }))
      ),
      { col: null, col2: null, isGrand: true },
    ];
  }, [pivot]);

  const numCols = colSpecs.length * measures.length;

  // ── Búsqueda sobre los resultados: filtra las filas de nivel 1 ya calculadas por el pivote.
  // Una fila queda si su propia etiqueta matchea, O si alguna de sus sub-filas (nivel 2) matchea
  // — así "buscar un producto específico" funciona tanto si Filas=Producto como si Producto es
  // la sub-fila de otra dimensión (ej. Mes › Producto).
  const searchLower = searchQuery.trim().toLowerCase();
  // Matchea contra la clave cruda Y la etiqueta formateada (con nombre de mes/día) — el usuario
  // busca por lo que VE en pantalla ("julio", "miércoles"), no por la clave interna "2026-07".
  function _matchesSearch(dimId, key) {
    if (String(key).toLowerCase().includes(searchLower)) return true;
    return String(_fmtDimLabel(dimId, key)).toLowerCase().includes(searchLower);
  }
  const searchedR1Keys = useMemo(() => {
    if (!searchLower) return pivot.r1Keys;
    return pivot.r1Keys.filter(k1 => {
      if (_matchesSearch(rowDim1, k1)) return true;
      if (!pivot.d2) return false;
      return (pivot.subKeys[k1] || []).some(k2 => _matchesSearch(rowDim2, k2));
    });
  }, [pivot, searchLower, rowDim1, rowDim2]);

  // Sub-filas a mostrar para un k1 expandido: si el propio k1 ya matcheó, se muestran todas;
  // si k1 solo quedó por tener un hijo que matchea, se filtran a solo los hijos que matchean.
  function subRowsFor(k1) {
    const subs = pivot.subKeys[k1] || [];
    if (!searchLower || _matchesSearch(rowDim1, k1)) return subs;
    return subs.filter(k2 => _matchesSearch(rowDim2, k2));
  }

  // ── Paginación de las filas de nivel 1 del pivote (sobre el resultado ya buscado) ──
  const totalPages   = Math.max(1, Math.ceil(searchedR1Keys.length / pageSize));
  const pageClamped  = Math.min(page, totalPages);
  const pagedR1Keys  = searchedR1Keys.slice((pageClamped - 1) * pageSize, pageClamped * pageSize);

  // ── Below-average detection (based on monto_usd)
  const belowAvg = useMemo(() => {
    const vals = Object.fromEntries(
      pivot.r1Keys.map(k => [k, _agg(getRows(k, null, null), 'monto_usd', tasaVal)])
    );
    const all = Object.values(vals).filter(v => v > 0);
    const avg = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
    return {
      avg,
      below: new Set(pivot.r1Keys.filter(k => avg > 0 && vals[k] < avg * 0.8)),
    };
  }, [pivot, tasaVal]);

  // ── Filter option lists
  const estadoOpts  = [...new Set(baseRows.map(r => r.estado).filter(Boolean))].sort();
  const tipoCliOpts = [...new Set(baseRows.map(r => r.clienteTipo).filter(x => x && x !== '—'))].sort();
  const empresaOpts = [...new Set(baseRows.map(r => r.empresa).filter(x => x && x !== '—'))].sort();

  function fmtCell(rows, mid) {
    if (!rows || !rows.length) return <span style={{ color:'var(--text-muted)' }}>—</span>;
    const v = _agg(rows, mid, tasaVal);
    return _MEAS_MAP[mid].fmtFn(v);
  }

  // ── Toggle row expansion
  function toggleExpand(k1) {
    setExpanded(prev => {
      const s = new Set(prev);
      s.has(k1) ? s.delete(k1) : s.add(k1);
      return s;
    });
  }

  // ── PDF Export
  function exportPDF() {
    const emp = window.getEmpresaConfig?.() || {};
    const empresa = emp.nombre_empresa || emp.razon_social || 'Distribuidora Demo';
    const rif     = emp.rif || '';

    const thStyle = 'background:#1a56db;color:#fff;padding:6px 10px;font-size:10.5px;font-weight:600;text-align:right;white-space:nowrap;';
    const thLStyle= 'background:#1a56db;color:#fff;padding:6px 10px;font-size:10.5px;font-weight:600;text-align:left;';
    const tdStyle = 'padding:5px 10px;font-size:11px;text-align:right;border-bottom:1px solid #f0f0f0;';
    const tdLStyle= 'padding:5px 10px;font-size:11px;border-bottom:1px solid #f0f0f0;';

    // Build header rows (1, 2, or 3 levels)
    const hasCol  = pivot.colKeys.length > 0;
    const hasCol2 = pivot.col2Keys.length > 0;
    const dimLabel = `${_DIM_MAP[rowDim1]?.label}${rowDim2?' › '+_DIM_MAP[rowDim2]?.label:''}${rowDim2&&rowDim3?' › '+_DIM_MAP[rowDim3]?.label:''}`;

    let pdfHeaders = `<tr><th style="${thLStyle}" rowspan="${hasCol2?3:hasCol?2:1}">${dimLabel}</th>`;
    if (hasCol2) {
      // Row 1: colDim groups (colSpan = col2Keys.length per group, no subtotal)
      for (const k of pivot.colKeys) {
        pdfHeaders += `<th style="${thStyle}text-align:center;border-left:2px solid rgba(255,255,255,.3)" colspan="${pivot.col2Keys.length * measures.length}">${_fmtDimLabel(colDim, k)}</th>`;
      }
      pdfHeaders += `<th style="${thStyle}text-align:center;border-left:2px solid rgba(255,255,255,.3)" colspan="${measures.length}">Total</th></tr>`;
      // Row 2: colDim2 sub-cols only (no subtotal per group)
      pdfHeaders += `<tr>`;
      for (const _k of pivot.colKeys) {
        for (const k2 of pivot.col2Keys) {
          pdfHeaders += `<th style="${thStyle}text-align:center" colspan="${measures.length}">${_fmtDimLabel(colDim2, k2)}</th>`;
        }
      }
      pdfHeaders += `</tr>`;
      // Row 3: measures
      pdfHeaders += `<tr>`;
      for (const _spec of colSpecs) {
        for (const mid of measures) {
          pdfHeaders += `<th style="${thStyle}">${_MEAS_MAP[mid]?.label}</th>`;
        }
      }
      pdfHeaders += `</tr>`;
    } else if (hasCol) {
      // Row 1: colDim values + Total
      for (const spec of colSpecs) {
        pdfHeaders += `<th style="${thStyle}text-align:center;border-left:2px solid rgba(255,255,255,.3)" colspan="${measures.length}">${spec.isGrand?'Total':_fmtDimLabel(colDim, spec.col)}</th>`;
      }
      pdfHeaders += `</tr><tr>`;
      // Row 2: measures per group
      for (const _spec of colSpecs) {
        for (const mid of measures) {
          pdfHeaders += `<th style="${thStyle}">${_MEAS_MAP[mid]?.label}</th>`;
        }
      }
      pdfHeaders += `</tr>`;
    } else {
      // Single-level: just measures
      for (const mid of measures) {
        pdfHeaders += `<th style="${thStyle}">${_MEAS_MAP[mid]?.label}</th>`;
      }
      pdfHeaders += `</tr>`;
    }

    let bodyRows = '';
    for (const k1 of pivot.r1Keys) {
      const isBelow = belowAvg.below.has(k1);
      const rowStyle = isBelow ? 'background:#fef2f2;' : '';
      let row = `<tr style="${rowStyle}"><td style="${tdLStyle}font-weight:600;">${_fmtDimLabel(rowDim1, k1)}${isBelow?' ↓':''}</td>`;
      for (const spec of colSpecs) {
        const rows = spec.isGrand ? getRows(k1, null, null) : getRows(k1, null, spec.col, spec.col2 || null);
        for (const mid of measures) {
          const v = _agg(rows, mid, tasaVal);
          row += `<td style="${tdStyle}${spec.isGrand?'font-weight:600;background:#f3f4f6;':''}">${_MEAS_MAP[mid].fmtFn(v)}</td>`;
        }
      }
      bodyRows += row + '</tr>';

      if (pivot.d2) {
        for (const k2 of (pivot.subKeys[k1] || [])) {
          let subRow = `<tr style="background:#f9fafb"><td style="${tdLStyle}padding-left:22px;">${_fmtDimLabel(rowDim2, k2)}</td>`;
          for (const spec of colSpecs) {
            const rows = spec.isGrand ? getRows(k1, k2, null) : getRows(k1, k2, spec.col, spec.col2 || null);
            for (const mid of measures) {
              const v = _agg(rows, mid, tasaVal);
              subRow += `<td style="${tdStyle}${spec.isGrand?'font-weight:600;background:#f3f4f6;':''}">${_MEAS_MAP[mid].fmtFn(v)}</td>`;
            }
          }
          bodyRows += subRow + '</tr>';
          // Tercer nivel: el PDF lo imprime SIEMPRE (no depende de qué esté expandido en pantalla).
          // Un reporte impreso a medio desplegar no le sirve a nadie.
          if (pivot.d3) {
            for (const k3 of (pivot.subKeys3[k1 + '|' + k2] || [])) {
              let subRow3 = `<tr style="background:#fbfcfd"><td style="${tdLStyle}padding-left:40px;font-size:10.5px;color:#6b7280;">${_fmtDimLabel(rowDim3, k3)}</td>`;
              for (const spec of colSpecs) {
                const rows3 = spec.isGrand ? getRows(k1, k2, null, null, k3) : getRows(k1, k2, spec.col, spec.col2 || null, k3);
                for (const mid of measures) {
                  const v = _agg(rows3, mid, tasaVal);
                  subRow3 += `<td style="${tdStyle}font-size:10.5px;${spec.isGrand?'background:#f6f7f9;':''}">${_MEAS_MAP[mid].fmtFn(v)}</td>`;
                }
              }
              bodyRows += subRow3 + '</tr>';
            }
          }
        }
      }
    }

    // Grand total
    let totalRow = `<tr style="border-top:2px solid #1a56db;font-weight:700;background:#f3f4f6;"><td style="${tdLStyle}font-weight:700;">Total</td>`;
    for (const spec of colSpecs) {
      const rows = getSpecGlobalRows(spec);
      for (const mid of measures) {
        const v = _agg(rows, mid, tasaVal);
        totalRow += `<td style="${tdStyle}font-weight:700;">${_MEAS_MAP[mid].fmtFn(v)}</td>`;
      }
    }
    bodyRows += totalRow + '</tr>';

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
    <title>Reporte Dinámico</title>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:'Segoe UI',Arial,sans-serif; font-size:12px; color:#111; background:#fff; padding:24px; }
      .hdr { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #1a56db; padding-bottom:14px; margin-bottom:18px; }
      .co-name { font-size:16px; font-weight:800; color:#1a56db; }
      .co-info { font-size:10px; color:#6b7280; margin-top:2px; }
      .title { font-size:13px; font-weight:700; text-align:right; }
      .sub { font-size:10px; color:#6b7280; text-align:right; margin-top:3px; }
      table { width:100%; border-collapse:collapse; }
      .footer { margin-top:20px; border-top:1px solid #e5e7eb; padding-top:8px; display:flex; justify-content:space-between; font-size:9.5px; color:#9ca3af; }
      @media print { body { padding:14px; } }
    </style></head><body>
    <div class="hdr">
      <div><div class="co-name">${empresa}</div><div class="co-info">${rif ? 'RIF: '+rif : ''}</div></div>
      <div><div class="title">Reporte Dinámico de Ventas</div>
        <div class="sub">Agrupado por: ${dimLabel}${colDim?' · Columnas: '+_DIM_MAP[colDim]?.label+(colDim2?' › '+_DIM_MAP[colDim2]?.label:''):''}</div>
        <div class="sub">Generado: ${new Date().toLocaleString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'America/Caracas' })} · Tasa: ${tasa.toUpperCase()} ${fmt.ves(tasaVal)}/USD</div>
      </div>
    </div>
    <table><thead>${pdfHeaders}</thead><tbody>${bodyRows}</tbody></table>
    <div class="footer">
      <span>${empresa}${rif?' · RIF: '+rif:''}</span>
      <span>${headerStats.lines} ${serverMode ? 'grupos' : 'líneas'} · ${headerStats.docs.toLocaleString('es-VE')} documentos</span>
    </div>
    <script>window.onload=()=>{ window.print(); setTimeout(()=>window.close(),800); }<\/script>
    </body></html>`;

    const w = window.open('', '_blank', 'width=1200,height=800');
    if (w) { w.document.write(html); w.document.close(); }
  }

  // ── Excel: EXACTAMENTE lo que está en pantalla ─────────────────────────────────────────────
  // Antes solo se podía sacar PDF, que sirve para archivar pero no para seguir analizando. El
  // Excel sale con las mismas dimensiones, medidas, columnas y filtros que estén puestos: si se
  // exportara el universo, el archivo no respondería la pregunta que el usuario acaba de armar
  // en pantalla.
  //
  // Los tres niveles de fila van en TRES COLUMNAS separadas (no indentados con espacios como en
  // el PDF): así se pueden filtrar y hacer tabla dinámica en Excel, que es para lo que se baja.
  function exportExcel() {
    const dimCols = [{ key: '_d1', label: _DIM_MAP[rowDim1]?.label || 'Grupo' }];
    if (pivot.d2) dimCols.push({ key: '_d2', label: _DIM_MAP[rowDim2]?.label || 'Nivel 2' });
    if (pivot.d3) dimCols.push({ key: '_d3', label: _DIM_MAP[rowDim3]?.label || 'Nivel 3' });

    // Una columna por (grupo de columna × medida). Sin columnas cruzadas es una por medida.
    const medCols = [];
    for (const spec of colSpecs) {
      const grupo = spec.isGrand ? 'Total'
        : _fmtDimLabel(colDim, spec.col) + (spec.col2 != null ? ' › ' + _fmtDimLabel(colDim2, spec.col2) : '');
      for (const mid of measures) {
        medCols.push({
          key: `m_${medCols.length}`,
          label: colSpecs.length > 1 ? `${grupo} — ${_MEAS_MAP[mid]?.label}` : (_MEAS_MAP[mid]?.label || mid),
          spec, mid,
        });
      }
    }
    // Los montos van como NÚMERO, no como el texto ya formateado que muestra la pantalla: en
    // Excel un "$ 1.234,56" es una cadena y no se puede sumar, que es lo primero que se hace.
    const celdas = (getterRows) => {
      const o = {};
      for (const c of medCols) o[c.key] = Math.round((_agg(getterRows(c.spec), c.mid, tasaVal) || 0) * 100) / 100;
      return o;
    };

    const filas = [];
    for (const k1 of pivot.r1Keys) {
      filas.push({ _d1: _fmtDimLabel(rowDim1, k1), _d2: '', _d3: '',
        ...celdas(spec => spec.isGrand ? getRows(k1, null, null) : getRows(k1, null, spec.col, spec.col2 || null)) });
      if (!pivot.d2) continue;
      for (const k2 of (pivot.subKeys[k1] || [])) {
        filas.push({ _d1: _fmtDimLabel(rowDim1, k1), _d2: _fmtDimLabel(rowDim2, k2), _d3: '',
          ...celdas(spec => spec.isGrand ? getRows(k1, k2, null) : getRows(k1, k2, spec.col, spec.col2 || null)) });
        if (!pivot.d3) continue;
        for (const k3 of (pivot.subKeys3[k1 + '|' + k2] || [])) {
          filas.push({ _d1: _fmtDimLabel(rowDim1, k1), _d2: _fmtDimLabel(rowDim2, k2), _d3: _fmtDimLabel(rowDim3, k3),
            ...celdas(spec => spec.isGrand ? getRows(k1, k2, null, null, k3) : getRows(k1, k2, spec.col, spec.col2 || null, k3)) });
        }
      }
    }
    if (!filas.length) { showRToast('No hay datos para exportar con estos filtros.', 'error'); return; }

    // Los totales van ARRIBA: el archivo tiene que decir de cuánto se está hablando antes de la
    // parrilla de filas. Se calculan sobre el conjunto global, no sumando las filas de arriba
    // (con tres niveles, sumar filas contaría cada venta tres veces).
    const total = colSpecs.find(s => s.isGrand) || colSpecs[0];
    const filasTotal = total ? getSpecGlobalRows(total) : [];
    const resumen = [
      { label: 'Agrupado por', valor: dimCols.map(c => c.label).join(' › ') },
      ...(colDim ? [{ label: 'Columnas', valor: _DIM_MAP[colDim]?.label + (colDim2 ? ' › ' + _DIM_MAP[colDim2]?.label : '') }] : []),
      { label: 'Período', valor: (fechaDesde || fechaHasta) ? `${fechaDesde || 'inicio'} a ${fechaHasta || 'hoy'}` : 'histórico completo' },
      ...(hasFilter ? [{ label: 'Filtros aplicados', valor: [
        estadoF && `estado: ${estadoF}`, tipoCliF && `tipo de cliente: ${tipoCliF}`,
        empresaF && `empresa: ${empresaF}`, skuF && `producto: ${skuF}`, clienteIdF && `cliente: ${clienteIdF}`,
      ].filter(Boolean).join(' · ') || '—' }] : []),
      { label: 'Tasa usada', valor: `${tasa.toUpperCase()} ${tasaVal} Bs/USD` },
      { sep: true },
      ...measures.map(mid => ({
        label: 'TOTAL ' + (_MEAS_MAP[mid]?.label || mid).toUpperCase(),
        valor: Math.round((_agg(filasTotal, mid, tasaVal) || 0) * 100) / 100,
      })),
      { label: 'Documentos', valor: headerStats.docs },
      { label: 'Filas del reporte', valor: filas.length },
    ];

    const ok = window.exportToXLSX(filas, [...dimCols, ...medCols],
      `reporte_${dimCols.map(c => c.key.replace('_', '')).join('-')}_${fechaDesde || 'inicio'}_a_${fechaHasta || 'hoy'}`,
      'Reporte', { resumen });
    if (ok && ok.then) return;   // se estaba cargando la librería; reintenta solo
    window.logActivity?.({ modulo: 'reportes', accion: 'exportar', entidad_label: 'Reporte dinámico',
      detalles: { dim1: rowDim1, dim2: rowDim2, dim3: rowDim3, colDim, medidas: measures, filas: filas.length,
                  desde: fechaDesde, hasta: fechaHasta } });
  }

  // ── Shared cell style helpers
  const TH = {
    background:'var(--brand)', color:'#fff', padding:'8px 10px',
    fontWeight:600, fontSize:11, textAlign:'center', whiteSpace:'nowrap',
    position:'sticky', top:0, zIndex:10, borderRight:'1px solid rgba(255,255,255,.12)',
  };
  function tdS(isTotal, isBelow) {
    return {
      padding:'6px 10px', fontSize:12, textAlign:'right',
      borderBottom:'1px solid var(--border)', borderRight:'1px solid var(--border)',
      fontWeight: isTotal ? 700 : 400,
      background: isTotal ? 'var(--bg-sunken)' : isBelow ? '#fef2f2' : 'transparent',
      color: isBelow ? '#dc2626' : 'var(--text-1)',
    };
  }

  const clearFilters = () => { setFechaDesde(''); setFechaHasta(''); setEstadoF(''); setTipoCliF(''); setEmpresaF(''); setSkuF(''); setClienteIdF(''); };
  const hasFilter = fechaDesde || fechaHasta || estadoF || tipoCliF || empresaF || skuF || clienteIdF;

  return (
    <div className="page">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Reportes Dinámicos</h1>
          <div className="page-subtitle">
            {headerStats.docs.toLocaleString('es-VE')} documentos · {headerStats.lines.toLocaleString('es-VE')} {serverMode ? _DIM_MAP[rowDim1]?.label?.toLowerCase() || 'grupos' : 'líneas'}
            {serverMode && <span style={{ marginLeft:8, background:'var(--brand)', color:'#fff', borderRadius:6, padding:'1px 7px', fontSize:10.5, fontWeight:700 }}>histórico completo</span>}
            {serverLoading && <span style={{ marginLeft:8, color:'var(--text-muted)' }}>· cargando…</span>}
          </div>
        </div>
        <div className="page-actions" style={{ position:'relative' }}>
          {/* Presets built-in */}
          {BUILT_IN_PRESETS.map(p => (
            <button key={p.id} className="btn ghost" onClick={() => loadReport(p)} title={p.descripcion}
              style={{ display:'flex', alignItems:'center', gap:5 }}>
              <Icon name="chart" size={14}/>{p.nombre}
            </button>
          ))}
          <button className="btn ghost" onClick={exportExcel} title="Excel con lo que está en pantalla: mismas dimensiones, medidas y filtros">
            <Icon name="download" size={14}/>Excel
          </button>
          <button className="btn ghost" onClick={exportPDF}>
            <Icon name="download" size={14}/>PDF
          </button>
          {/* Mis Reportes dropdown */}
          <div style={{ position:'relative' }}>
            <button className="btn ghost" onClick={() => setShowReportsList(v => !v)}
              style={{ display:'flex', alignItems:'center', gap:5 }}>
              <Icon name="doc" size={14}/>
              Mis reportes
              {savedReports.length > 0 && (
                <span style={{ background:'var(--brand)', color:'#fff', borderRadius:10, padding:'1px 6px', fontSize:10, fontWeight:700 }}>
                  {savedReports.length}
                </span>
              )}
              <Icon name="chevronD" size={11}/>
            </button>
            {showReportsList && (
              <div style={{ position:'absolute', top:'calc(100% + 6px)', right:0, background:'var(--bg-card)', border:'1px solid var(--border)',
                            borderRadius:10, boxShadow:'0 8px 28px rgba(0,0,0,.15)', padding:'10px 0', zIndex:500, minWidth:280, maxWidth:360 }}>
                <div style={{ padding:'0 14px 8px', fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.05em', borderBottom:'1px solid var(--border)' }}>
                  Reportes guardados
                </div>
                {savedReports.length === 0 ? (
                  <div style={{ padding:'20px 14px', color:'var(--text-muted)', fontSize:13, textAlign:'center' }}>
                    Sin reportes guardados aún
                  </div>
                ) : (
                  <div style={{ maxHeight:320, overflowY:'auto' }}>
                    {savedReports.map(rep => (
                      <div key={rep.id} onClick={() => loadReport(rep)}
                        style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 14px', cursor:'pointer', borderBottom:'1px solid var(--border-subtle, #f0f0f0)' }}
                        onMouseEnter={e => e.currentTarget.style.background='var(--bg-hover, #f5f7fa)'}
                        onMouseLeave={e => e.currentTarget.style.background=''}>
                        <Icon name="chart" size={15} style={{ color:'var(--brand)', flexShrink:0 }}/>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:600, fontSize:13, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{rep.nombre}</div>
                          {rep.descripcion && <div style={{ fontSize:11, color:'var(--text-muted)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{rep.descripcion}</div>}
                          <div style={{ fontSize:10.5, color:'var(--text-muted)' }}>
                            {new Date(rep.created_at).toLocaleDateString('es-VE', { day:'2-digit', month:'short', year:'numeric', timeZone:'America/Caracas' })}
                            {rep.creado_por ? ' · ' + rep.creado_por : ''}
                          </div>
                        </div>
                        <div style={{ display:'flex', gap:2, flexShrink:0 }}>
                          {window.canUser?.('editar', 'reportes') !== false && (
                            <button className="icon-btn" title="Editar nombre" onClick={e => openEditModal(rep, e)} style={{ padding:3 }}>
                              <Icon name="edit" size={13}/>
                            </button>
                          )}
                          {window.canUser?.('eliminar', 'reportes') !== false && (
                            <button className="icon-btn" title="Eliminar" onClick={e => handleDeleteReport(rep, e)} style={{ padding:3, color:'var(--danger)' }}>
                              <Icon name="trash" size={13}/>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {window.canUser?.('crear', 'reportes') !== false && (
            <button className="btn primary" onClick={() => { setEditingReport(null); setSaveName(''); setSaveDesc(''); setShowSaveModal(true); }}
              style={{ display:'flex', alignItems:'center', gap:5 }}>
              <Icon name="plus" size={14}/>Guardar reporte
            </button>
          )}
        </div>
      </div>

      {/* ── Toast ───────────────────────────────────────────────── */}
      {reportToast && (
        <div style={{ position:'fixed', bottom:24, right:24, zIndex:9000, background: reportToast.type === 'error' ? 'var(--danger)' : '#18a058',
          color:'#fff', borderRadius:8, padding:'10px 18px', fontSize:13, fontWeight:600, boxShadow:'0 4px 16px rgba(0,0,0,.2)', display:'flex', alignItems:'center', gap:8 }}>
          {reportToast.msg}
        </div>
      )}

      {/* ── Modal guardar reporte ────────────────────────────────── */}
      {showSaveModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && (setShowSaveModal(false), setEditingReport(null))}>
          <div className="modal" style={{ width:420, maxWidth:'95vw' }}>
            <div className="modal-head">
              <span className="modal-title">{editingReport ? 'Editar reporte' : 'Guardar reporte'}</span>
              <button className="icon-btn" onClick={() => { setShowSaveModal(false); setEditingReport(null); }}><Icon name="x" size={16}/></button>
            </div>
            <div className="modal-body" style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {!editingReport && (
                <div style={{ background:'var(--bg-sunken)', borderRadius:8, padding:'10px 12px', fontSize:12, color:'var(--text-muted)', lineHeight:1.5 }}>
                  Se guardará la configuración actual: <strong>{_DIM_MAP[rowDim1]?.label}</strong>
                  {rowDim2 ? <> › <strong>{_DIM_MAP[rowDim2]?.label}</strong></> : ''}
                  {rowDim2 && rowDim3 ? <> › <strong>{_DIM_MAP[rowDim3]?.label}</strong></> : ''}
                  {colDim ? <> · Columnas: <strong>{_DIM_MAP[colDim]?.label}</strong>{colDim2 ? <> › <strong>{_DIM_MAP[colDim2]?.label}</strong></> : ''}</> : ''}
                  · {measures.length} medida{measures.length !== 1 ? 's' : ''}
                  {(fechaDesde || fechaHasta) ? <> · Fechas filtradas</> : ''}
                </div>
              )}
              <div>
                <label className="form-label">Nombre del reporte *</label>
                <input className="input" style={{ width:'100%' }} placeholder="Ej: Ventas por mes 2026"
                  value={saveName} onChange={e => setSaveName(e.target.value)}
                  autoFocus onKeyDown={e => e.key === 'Enter' && handleSaveReport()} />
              </div>
              <div>
                <label className="form-label">Descripción (opcional)</label>
                <input className="input" style={{ width:'100%' }} placeholder="Ej: Comparativo mensual de monto y documentos"
                  value={saveDesc} onChange={e => setSaveDesc(e.target.value)} />
              </div>
              <div style={{ display:'flex', justifyContent:'flex-end', gap:8, paddingTop:4 }}>
                <button className="btn ghost" onClick={() => { setShowSaveModal(false); setEditingReport(null); }}>Cancelar</button>
                <button className="btn primary" onClick={handleSaveReport} disabled={!saveName.trim() || saving}>
                  {saving ? 'Guardando…' : (editingReport ? 'Actualizar' : 'Guardar')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Config panel ────────────────────────────────────────── */}
      <div className="report-config" style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, padding:'14px 16px', marginBottom:16 }}>

        {/* Row 1: Dimensions */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:12 }}>

          {/* MEDIDAS dropdown */}
          <div style={{ position:'relative' }}>
            <button className="btn primary sm" onClick={() => setShowMedidas(v => !v)}
              style={{ display:'flex', alignItems:'center', gap:5, letterSpacing:'.04em' }}>
              <Icon name="chart" size={13}/>
              MEDIDAS ({measures.length})
              <Icon name="chevronD" size={11}/>
            </button>
            {showMedidas && (
              <div style={{ position:'absolute', top:'calc(100% + 6px)', left:0, background:'#fff', border:'1px solid var(--border)',
                            borderRadius:10, boxShadow:'0 8px 28px rgba(0,0,0,.13)', padding:'12px 14px', zIndex:400, minWidth:228 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', marginBottom:8, textTransform:'uppercase', letterSpacing:'.05em' }}>
                  Seleccionar medidas
                </div>
                {_MEASURES.map(m => (
                  <label key={m.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 2px', cursor:'pointer', fontSize:13 }}>
                    <input type="checkbox" checked={measures.includes(m.id)}
                      onChange={e => setMeasures(prev => e.target.checked ? [...prev, m.id] : prev.filter(x => x !== m.id))}
                    />
                    {m.label}
                  </label>
                ))}
                <button className="btn ghost sm" style={{ width:'100%', marginTop:10 }} onClick={() => setShowMedidas(false)}>
                  Listo
                </button>
              </div>
            )}
          </div>

          <div style={{ width:1, height:24, background:'var(--border)' }}/>

          {/* Row dimensions */}
          <span style={{ fontSize:11, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em' }}>Filas:</span>
          <select className="select" style={{ width:180 }} value={rowDim1}
            onChange={e => { setRowDim1(e.target.value); setExpanded(new Set()); }}>
            {_DIMS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>

          {rowDim2 ? (
            <>
              <span style={{ fontSize:13, color:'var(--text-muted)' }}>›</span>
              <select className="select" style={{ width:180 }} value={rowDim2}
                onChange={e => { setRowDim2(e.target.value); setExpanded(new Set()); }}>
                {_DIMS.filter(d => d.id !== rowDim1).map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
              <button className="icon-btn" onClick={() => { setRowDim2(''); setRowDim3(''); setExpanded(new Set()); }} title="Quitar sub-fila">
                <Icon name="x" size={13}/>
              </button>
              {/* Tercer nivel: solo tiene sentido colgado del segundo. */}
              {rowDim3 ? (
                <>
                  <span style={{ fontSize:13, color:'var(--text-muted)' }}>›</span>
                  <select className="select" style={{ width:180 }} value={rowDim3}
                    onChange={e => { setRowDim3(e.target.value); setExpanded(new Set()); }}>
                    {_DIMS.filter(d => d.id !== rowDim1 && d.id !== rowDim2).map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </select>
                  <button className="icon-btn" onClick={() => { setRowDim3(''); setExpanded(new Set()); }} title="Quitar el tercer nivel">
                    <Icon name="x" size={13}/>
                  </button>
                </>
              ) : (
                <button className="btn ghost sm"
                  onClick={() => { setRowDim3(_DIMS.find(d => d.id !== rowDim1 && d.id !== rowDim2)?.id || ''); setExpanded(new Set()); }}
                  style={{ display:'flex', alignItems:'center', gap:4 }} title="Agregar un tercer nivel de filas">
                  <Icon name="plus" size={12}/>3er nivel
                </button>
              )}
            </>
          ) : (
            <button className="btn ghost sm"
              onClick={() => setRowDim2(_DIMS.find(d => d.id !== rowDim1)?.id || '')}
              style={{ display:'flex', alignItems:'center', gap:4 }}>
              <Icon name="plus" size={12}/>Sub-fila
            </button>
          )}

          <div style={{ width:1, height:24, background:'var(--border)' }}/>

          {/* Column dimension */}
          <span style={{ fontSize:11, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em' }}>Columnas:</span>
          {colDim ? (
            <>
              <select className="select" style={{ width:180 }} value={colDim}
                onChange={e => { setColDim(e.target.value); setColDim2(''); }}>
                {_DIMS.filter(d => d.id !== rowDim1 && d.id !== rowDim2).map(d =>
                  <option key={d.id} value={d.id}>{d.label}</option>
                )}
              </select>
              <button className="icon-btn" onClick={() => { setColDim(''); setColDim2(''); }} title="Quitar columna">
                <Icon name="x" size={13}/>
              </button>

              {/* Sub-column (colDim2) */}
              {colDim2 ? (
                <>
                  <span style={{ fontSize:13, color:'var(--text-muted)' }}>›</span>
                  <select className="select" style={{ width:180 }} value={colDim2} onChange={e => setColDim2(e.target.value)}>
                    {_DIMS.filter(d => d.id !== rowDim1 && d.id !== rowDim2 && d.id !== colDim).map(d =>
                      <option key={d.id} value={d.id}>{d.label}</option>
                    )}
                  </select>
                  <button className="icon-btn" onClick={() => setColDim2('')} title="Quitar sub-columna">
                    <Icon name="x" size={13}/>
                  </button>
                </>
              ) : (
                <button className="btn ghost sm"
                  onClick={() => setColDim2(_DIMS.find(d => d.id !== rowDim1 && d.id !== rowDim2 && d.id !== colDim)?.id || '')}
                  style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <Icon name="plus" size={12}/>Sub-col
                </button>
              )}
            </>
          ) : (
            <button className="btn ghost sm"
              onClick={() => setColDim('empresa')}
              style={{ display:'flex', alignItems:'center', gap:4 }}>
              <Icon name="plus" size={12}/>Columna
            </button>
          )}
        </div>

        {/* Row 2: Filters */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', paddingTop:12, borderTop:'1px solid var(--border)' }}>
          <span style={{ fontSize:11, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em' }}>Etapa:</span>
          <div className="seg">
            {_TIPOS_DOC.map(t => (
              <button key={t.id} className={tipoDoc === t.id ? 'on' : ''} onClick={() => setTipoDoc(t.id)}>{t.label}</button>
            ))}
          </div>
          <div style={{ width:1, height:24, background:'var(--border)' }}/>
          <span style={{ fontSize:11, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em' }}>Filtros:</span>
          <input type="date" className="input" style={{ width:140 }} value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}/>
          <span style={{ fontSize:12, color:'var(--text-muted)' }}>—</span>
          <input type="date" className="input" style={{ width:140 }} value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}/>
          <select className="select" style={{ width:150 }} value={estadoF} onChange={e => setEstadoF(e.target.value)}>
            <option value="">Todo estado</option>
            {estadoOpts.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
          <select className="select" style={{ width:168 }} value={tipoCliF} onChange={e => setTipoCliF(e.target.value)}>
            <option value="">Tipo de cliente</option>
            {tipoCliOpts.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="select" style={{ width:168 }} value={empresaF} onChange={e => setEmpresaF(e.target.value)}>
            <option value="">Todas las empresas</option>
            {empresaOpts.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          {/* SKU específico — input con autocomplete via datalist */}
          <input className="input" style={{ width:160 }} list="reportes-sku-list" placeholder="SKU específico"
            value={skuF} onChange={e => setSkuF(e.target.value)} />
          <datalist id="reportes-sku-list">
            {(SSData.productos || []).map(p => (
              <option key={p.sku} value={p.sku}>{p.nombre || ''}</option>
            ))}
          </datalist>
          {/* Cliente específico — SearchSelect */}
          <div style={{ width:200 }}>
            <SearchSelect
              value={clienteIdF}
              onChange={v => setClienteIdF(v || '')}
              options={[{ value:'', label:'Todos los clientes' }, ...(SSData.clientes || []).map(c => ({ value:c.id, label:c.nombre || c.id }))]}
              placeholder="Cliente específico"
            />
          </div>

          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:11, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase' }}>Tasa:</span>
            <div className="seg">
              <button className={tasa === 'bcv'      ? 'on' : ''} onClick={() => setTasa('bcv')}>BCV</button>
              <button className={tasa === 'paralelo' ? 'on' : ''} onClick={() => setTasa('paralelo')}>Paralelo</button>
            </div>
            <span style={{ fontSize:11, color:'var(--text-muted)' }}>{fmt.ves(tasaVal)} / USD</span>
          </div>

          {hasFilter && (
            <button className="btn ghost sm" onClick={clearFilters} style={{ display:'flex', alignItems:'center', gap:4 }}>
              <Icon name="x" size={12}/>Limpiar
            </button>
          )}
        </div>
      </div>

      {/* ── Búsqueda en resultados: filtra las filas ya calculadas por Filas/Columnas ── */}
      <div style={{ display:'flex', alignItems:'center', gap:8, margin:'12px 0' }}>
        <div style={{ position:'relative', width:320 }}>
          <Icon name="search" size={14} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }}/>
          <input
            className="input" style={{ width:'100%', paddingLeft:32 }}
            placeholder={`Buscar en resultados (${_DIM_MAP[rowDim1]?.label || 'filas'}${rowDim2 ? ' › '+_DIM_MAP[rowDim2]?.label : ''}${rowDim2 && rowDim3 ? ' › '+_DIM_MAP[rowDim3]?.label : ''})…`}
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="icon-btn" style={{ position:'absolute', right:4, top:'50%', transform:'translateY(-50%)', width:22, height:22 }}
              onClick={() => setSearchQuery('')} title="Limpiar búsqueda">
              <Icon name="x" size={12}/>
            </button>
          )}
        </div>
        {searchQuery && (
          <span className="small muted">{searchedR1Keys.length} de {pivot.r1Keys.length} filas coinciden</span>
        )}
      </div>

      {/* ── Pivot Table ─────────────────────────────────────────── */}
      <div className="tbl-wrap" style={{ overflowX:'auto' }}>
        <table style={{ borderCollapse:'collapse', minWidth:'100%', fontSize:12 }}>
          <thead>
            {/* ── Level 1: colDim groups (only when colDim active) ── */}
            {pivot.colKeys.length > 0 && (
              <tr>
                <th rowSpan={pivot.col2Keys.length > 0 ? 3 : 2}
                    style={{ ...TH, textAlign:'left', minWidth:220, borderRight:'3px solid rgba(255,255,255,.3)' }}>
                  {_DIM_MAP[rowDim1]?.label}
                  {rowDim2 ? <span style={{ opacity:.7 }}> › {_DIM_MAP[rowDim2]?.label}</span> : ''}
                  {rowDim2 && rowDim3 ? <span style={{ opacity:.7 }}> › {_DIM_MAP[rowDim3]?.label}</span> : ''}
                </th>
                {pivot.colKeys.map(ck => (
                  <th key={ck}
                    colSpan={pivot.col2Keys.length > 0 ? pivot.col2Keys.length * measures.length : measures.length}
                    style={{ ...TH, borderLeft:'3px solid rgba(255,255,255,.3)', textAlign:'center' }}>
                    {_fmtDimLabel(colDim, ck)}
                  </th>
                ))}
                <th rowSpan={pivot.col2Keys.length > 0 ? 3 : 2}
                    colSpan={measures.length}
                    style={{ ...TH, borderLeft:'3px solid rgba(255,255,255,.3)', textAlign:'center' }}>
                  Total
                </th>
              </tr>
            )}
            {/* ── Level 2: colDim2 sub-columns + Subtotal (only when colDim2 active) ── */}
            {pivot.col2Keys.length > 0 && (
              <tr>
                {pivot.colKeys.map(ck => (
                  <React.Fragment key={ck}>
                    {pivot.col2Keys.map(k2 => (
                      <th key={k2} colSpan={measures.length}
                        style={{ ...TH, borderLeft:'1px solid rgba(255,255,255,.2)', textAlign:'center', fontSize:10 }}>
                        {_fmtDimLabel(colDim2, k2)}
                      </th>
                    ))}
                  </React.Fragment>
                ))}
              </tr>
            )}
            {/* ── Measure label row ── */}
            <tr>
              {/* Row-dim label: shown here only when colDim inactive (no rowSpan used above) */}
              {!pivot.colKeys.length && (
                <th style={{ ...TH, textAlign:'left', minWidth:220, borderRight:'3px solid rgba(255,255,255,.3)' }}>
                  {_DIM_MAP[rowDim1]?.label}
                  {rowDim2 ? <span style={{ opacity:.7 }}> › {_DIM_MAP[rowDim2]?.label}</span> : ''}
                  {rowDim2 && rowDim3 ? <span style={{ opacity:.7 }}> › {_DIM_MAP[rowDim3]?.label}</span> : ''}
                </th>
              )}
              {colSpecs.map((spec, si) => {
                // isGrand column is already covered by rowSpan on the Total <th> in row 1
                if (spec.isGrand && pivot.colKeys.length > 0) return null;
                return measures.map(mid => (
                  <th key={si + mid} style={{ ...TH, minWidth:110 }}>
                    {_MEAS_MAP[mid]?.label}
                  </th>
                ));
              })}
            </tr>
          </thead>

          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={1 + numCols} className="empty" style={{ padding:48, textAlign:'center', color:'var(--text-muted)' }}>
                  {(SSData.documentos || []).length === 0
                    ? 'Cargando documentos…'
                    : 'Sin datos para los filtros seleccionados'}
                </td>
              </tr>
            ) : searchedR1Keys.length === 0 ? (
              <tr>
                <td colSpan={1 + numCols} className="empty" style={{ padding:48, textAlign:'center', color:'var(--text-muted)' }}>
                  Sin resultados para "{searchQuery}" — prueba con otro término o <a href="#" onClick={e => { e.preventDefault(); setSearchQuery(''); }}>limpia la búsqueda</a>.
                </td>
              </tr>
            ) : (
              <>
                {pagedR1Keys.map(k1 => {
                  const isExp   = expanded.has(k1);
                  const isBelow = belowAvg.below.has(k1);
                  const rowsK1  = getRows(k1, null, null);

                  return (
                    <React.Fragment key={k1}>
                      {/* ── Row level 1 ── */}
                      <tr style={{ background: isBelow ? '#fff8f8' : 'transparent' }}>
                        <td
                          style={{ padding:'7px 12px', fontWeight:600, fontSize:13,
                                   borderBottom:'1px solid var(--border)', borderRight:'3px solid var(--border)',
                                   maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                                   cursor: pivot.d2 ? 'pointer' : 'default' }}
                          onClick={() => pivot.d2 && toggleExpand(k1)}
                        >
                          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                            {pivot.d2 && (
                              <Icon name={isExp ? 'chevronD' : 'chevronR'} size={12}
                                style={{ color:'var(--text-muted)', flexShrink:0 }}/>
                            )}
                            <span title={k1}>{_fmtDimLabel(rowDim1, k1)}</span>
                            {isBelow && (
                              <span style={{ fontSize:10, background:'#fecaca', color:'#dc2626',
                                             borderRadius:4, padding:'1px 5px', fontWeight:700, flexShrink:0 }}
                                    title={`Por debajo del promedio (${fmt.usd(belowAvg.avg)})`}>
                                ↓ bajo prom.
                              </span>
                            )}
                          </div>
                        </td>
                        {colSpecs.map((spec, si) => (
                          measures.map(mid => {
                            const rows = spec.isGrand ? rowsK1 : getRows(k1, null, spec.col, spec.col2 || null);
                            const highlight = isBelow && mid === 'monto_usd' && spec.isGrand;
                            return (
                              <td key={si + mid} style={{ ...tdS(spec.isGrand, highlight),
                                borderLeft: spec.isGrand ? '2px solid var(--border)' : undefined }}>
                                {fmtCell(rows, mid)}
                              </td>
                            );
                          })
                        ))}
                      </tr>

                      {/* ── Sub-filas (nivel 2) y, colgado de cada una, el nivel 3 ── */}
                      {pivot.d2 && isExp && subRowsFor(k1).map(k2 => {
                        const clave2 = k1 + '|' + k2;
                        const isExp2 = expanded.has(clave2);
                        return (
                        <React.Fragment key={clave2}>
                        <tr style={{ background:'#f8fafc' }}>
                          <td title={k2} style={{ padding:'5px 12px 5px 32px', fontSize:12, color:'var(--text-2)',
                                       borderBottom:'1px solid var(--border)', borderRight:'3px solid var(--border)',
                                       maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                                       cursor: pivot.d3 ? 'pointer' : 'default' }}
                              onClick={() => pivot.d3 && toggleExpand(clave2)}>
                            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                              {pivot.d3 && <Icon name={isExp2 ? 'chevronD' : 'chevronR'} size={11} style={{ color:'var(--text-muted)', flexShrink:0 }}/>}
                              <span>{_fmtDimLabel(rowDim2, k2)}</span>
                            </div>
                          </td>
                          {colSpecs.map((spec, si) => (
                            measures.map(mid => {
                              const rows = spec.isGrand ? getRows(k1, k2, null) : getRows(k1, k2, spec.col, spec.col2 || null);
                              return (
                                <td key={si + mid} style={{ ...tdS(spec.isGrand, false),
                                  borderLeft: spec.isGrand ? '2px solid var(--border)' : undefined }}>
                                  {fmtCell(rows, mid)}
                                </td>
                              );
                            })
                          ))}
                        </tr>
                        {pivot.d3 && isExp2 && (pivot.subKeys3[clave2] || []).map(k3 => (
                          <tr key={clave2 + '|' + k3} style={{ background:'#f1f5f9' }}>
                            <td title={k3} style={{ padding:'4px 12px 4px 52px', fontSize:11.5, color:'var(--text-muted)',
                                         borderBottom:'1px solid var(--border)', borderRight:'3px solid var(--border)',
                                         maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              {_fmtDimLabel(rowDim3, k3)}
                            </td>
                            {colSpecs.map((spec, si) => (
                              measures.map(mid => {
                                const rows = spec.isGrand ? getRows(k1, k2, null, null, k3) : getRows(k1, k2, spec.col, spec.col2 || null, k3);
                                return (
                                  <td key={si + mid} style={{ ...tdS(spec.isGrand, false), fontSize:11.5,
                                    borderLeft: spec.isGrand ? '2px solid var(--border)' : undefined }}>
                                    {fmtCell(rows, mid)}
                                  </td>
                                );
                              })
                            ))}
                          </tr>
                        ))}
                        </React.Fragment>
                        );
                      })}
                    </React.Fragment>
                  );
                })}

                {/* ── Grand Total row ── */}
                <tr style={{ borderTop:'2px solid var(--brand)' }}>
                  <td style={{ padding:'8px 12px', fontWeight:700, fontSize:13,
                               background:'var(--bg-sunken)', borderRight:'3px solid var(--border)' }}>
                    Total general
                  </td>
                  {colSpecs.map((spec, si) => (
                    measures.map(mid => (
                      <td key={si + mid} style={{ ...tdS(true, false),
                        borderLeft: spec.isGrand ? '2px solid var(--border)' : undefined }}>
                        {fmtCell(getSpecGlobalRows(spec), mid)}
                      </td>
                    ))
                  ))}
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Paginador de filas del pivote ──────────────────────── */}
      {pivot.r1Keys.length > 0 && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginTop:12, flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span className="small muted">Filas por página:</span>
            {[50, 100, 200].map(n => (
              <button key={n} className={'btn ghost sm' + (pageSize === n ? ' on' : '')} onClick={() => { setPageSize(n); setPage(1); }}>{n}</button>
            ))}
            <span className="small muted">· {searchedR1Keys.length.toLocaleString('es-VE')} filas</span>
          </div>
          {totalPages > 1 && (
            <div style={{ display:'flex', alignItems:'center', gap:4 }}>
              <span className="small muted" style={{ marginRight:6 }}>Página {pageClamped} de {totalPages}</span>
              <button className="btn ghost sm" disabled={pageClamped===1} onClick={()=>setPage(1)}>«</button>
              <button className="btn ghost sm" disabled={pageClamped===1} onClick={()=>setPage(p=>Math.max(1,p-1))}>‹</button>
              <button className="btn ghost sm" disabled={pageClamped===totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>›</button>
              <button className="btn ghost sm" disabled={pageClamped===totalPages} onClick={()=>setPage(totalPages)}>»</button>
            </div>
          )}
        </div>
      )}

      {/* ── Below-average legend ──────────────────────────────── */}
      {belowAvg.avg > 0 && pivot.r1Keys.length > 1 && (
        <div style={{ marginTop:12, fontSize:12, color:'var(--text-muted)', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          <span style={{ background:'#fecaca', color:'#dc2626', borderRadius:4, padding:'2px 7px', fontWeight:700 }}>
            ↓ bajo prom.
          </span>
          Filas con Monto USD más de 20% por debajo del promedio general —
          <strong style={{ color:'var(--text-1)' }}>{fmt.usd(belowAvg.avg)}</strong>.
          {belowAvg.below.size > 0 && (
            <span>{belowAvg.below.size} de {pivot.r1Keys.length} {['dia','mes','trim','año'].includes(rowDim1) ? 'períodos' : 'filas'} detectados.</span>
          )}
        </div>
      )}
    </div>
  );
};
