// Distribuidora Demo — capa de datos (demo estatica, SIN backend real)
//
// Esta es la misma lógica de negocio del ERP original: se conserva casi intacta a propósito,
// porque es lo que hace creíble la demo (correlativos, cascadas, candados, saldos). Lo único que
// cambia es de dónde sale `window.sb`: en vez de un cliente real de Supabase, es un cliente FALSO
// (`src/demo/mock-sb.js`) que imita la misma API (`from().select()...`, `rpc()`, `auth.*`) contra
// un dataset generado en memoria para las 2 empresas demo. Ver `src/demo/` para el motor completo.
(function () {
  // Sin URL ni credenciales: no hay ningún servidor detrás. Quedan como strings vacíos porque el
  // resto de este archivo todavía arma URLs de Edge Functions con ellas (fetch-bcv-rate, pin-login,
  // admin-users, ai-assistant, shopify-proxy, actualizar_duracion_vista) — esas 5 rutas las
  // intercepta `src/demo/mock-sb.js` parcheando `window.fetch`, así que nunca navegan a la red real.
  const SUPABASE_URL  = '';
  const SUPABASE_ANON = '';
  window.SUPABASE_URL = SUPABASE_URL;
  window.SUPABASE_ANON_KEY = SUPABASE_ANON;

  // Cliente falso: mismo shape que supabase-js (`from/rpc/auth`), resuelto contra el dataset mock.
  window.sb = window.__ssCreateMockClient();

  // DINERO: `window.ssRound2` (a centavos) y `window.ssSaldada` (medio centavo de tolerancia)
  // viven en core.jsx, con el porqué completo. Se usan acá en TODA comparación de saldo: sin
  // ellas, `45.402 Bs / 756,7` = 59,99999999999999 dejaba saldada una cuenta en 'parcial'.

  // ZONA HORARIA DEL SISTEMA. Es la de la empresa (Caracas por defecto) y manda para TODA la app:
  // el "hoy" de los documentos, la hora que se muestra en los movimientos y los correlativos por
  // año. Se guarda en `configuracion_sistema.zona_horaria` y se puede cambiar en Ajustes → Sistema;
  // si la config todavía no cargó se usa Caracas, que es lo que era antes de existir el campo.
  window.ssZonaHoraria = function () {
    const e = window.currentEmpresa || 'demo1';
    const z = (window.__ssEmpresaConfigCache || {})[e]?.zona_horaria;
    return (typeof z === 'string' && z.includes('/')) ? z : 'America/Caracas';
  };
  // Fecha del sistema como 'YYYY-MM-DD', sin importar la zona del dispositivo ni UTC.
  // 'en-CA' produce el formato ISO YYYY-MM-DD. Es el helper canónico de "hoy"/fecha de negocio.
  window.localDateStr = function(date) {
    const d = date || new Date();
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: window.ssZonaHoraria(), year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(d);
  };
  // 'HH:MM' del instante en la zona del sistema (para mostrar la hora de registro).
  window.localTimeStr = function(date) {
    const d = date ? new Date(date) : new Date();
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('es-VE', {
      timeZone: window.ssZonaHoraria(), hour: '2-digit', minute: '2-digit', hour12: false
    }).format(d);
  };
  // Hora de Venezuela (0-23) de un instante — para saludos/lógica horaria.
  window.caracasHour = function(date) {
    return Number(new Intl.DateTimeFormat('en-US', {
      timeZone: window.ssZonaHoraria(), hour: '2-digit', hour12: false
    }).format(date || new Date())) % 24;
  };
  // Año de Venezuela (para correlativos por año, etc.).
  window.caracasYear = function(date) { return Number(window.localDateStr(date).slice(0, 4)); };

  // ─── Activity log ──────────────────────────────────────────────────────────
  // Uso: window.logActivity({ modulo:'productos', accion:'crear', entidad_id:'P-001', entidad_label:'Cámara X', detalles:{...} })
  window.logActivity = async function ({ modulo, accion, entidad_id, entidad_label, detalles } = {}) {
    if (!modulo || !accion) return;
    const u = window.__ssCurrentUser || {};
    try {
      await window.sb.from('actividad_log').insert({
        empresa_id:     window.currentEmpresa || 'demo1',
        usuario_id:     u.id || null,
        usuario_nombre: u.nombre || u.email || 'Sistema',
        modulo,
        accion,
        entidad_id:     entidad_id != null ? String(entidad_id) : null,
        entidad_label:  entidad_label || null,
        detalles:       detalles || {},
      });
    } catch (err) {
      console.warn('[logActivity] fallo silencioso:', err);
    }
  };

  window.fetchActivityLog = async function ({ modulo, entidad_id, limit = 100 } = {}) {
    let q = window.sb.from('actividad_log').select('*')
      .eq('empresa_id', window.currentEmpresa || 'demo1')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (modulo)     q = q.eq('modulo', modulo);
    if (entidad_id) q = q.eq('entidad_id', String(entidad_id));
    const { data, error } = await q;
    if (error) { console.error('[fetchActivityLog]', error); return []; }
    return data || [];
  };

  // Devuelve el último log 'editar' por entidad_id en módulo 'documentos'.
  // Útil para badges de "cambios recientes" en portal de drivers.
  window.fetchLatestDocEdits = async function (entidadIds) {
    if (!entidadIds || entidadIds.length === 0) return {};
    const { data, error } = await window.sb.from('actividad_log').select('*')
      .eq('empresa_id', window.currentEmpresa || 'demo1')
      .eq('modulo', 'documentos')
      .eq('accion', 'editar')
      .in('entidad_id', entidadIds.map(String))
      .order('created_at', { ascending: false });
    if (error) { console.error('[fetchLatestDocEdits]', error); return {}; }
    const map = {};
    (data || []).forEach(log => { if (!map[log.entidad_id]) map[log.entidad_id] = log; });
    return map;
  };

  // ─── Empresa activa (multi-tenant) ─────────────────────────────────────────
  const EMPRESA_KEY = 'ss-empresa-activa';
  window.currentEmpresa = localStorage.getItem(EMPRESA_KEY) || 'demo1';

  window.setEmpresaActiva = async function (empresaId) {
    if (!empresaId || empresaId === window.currentEmpresa) return;
    window.currentEmpresa = empresaId;
    localStorage.setItem(EMPRESA_KEY, empresaId);
    window.clearFase1Cache?.();
    await window.loadAppData();
    window.dispatchEvent(new CustomEvent('ss-empresa-changed', { detail: empresaId }));
  };

  window.loadEmpresas = async function () {
    const { data, error } = await window.sb.from('empresas').select('*').eq('activo', true).order('nombre');
    if (error) { console.error('[Supabase] Error cargando empresas:', error); return []; }
    return data || [];
  };

  // ─── Portal cliente: cargar docs de TODAS las empresas del cliente ────────
  window.loadClientePortalData = async function (cliente) {
    if (!cliente) return null;
    const empresasCliente = (cliente.empresas && cliente.empresas.length) ? cliente.empresas : ['demo1'];
    const { data: docs } = await window.sb.from('documentos').select('*').eq('cliente_id', cliente.id).in('empresa_id', empresasCliente).order('fecha', { ascending: false });
    // Items SOLO de los documentos del cliente (antes: select('*') global sobre 135k items → PostgREST
    // cortaba a 1000 arbitrarios y la mayoría de los docs del portal salían sin líneas).
    const docIds = (docs || []).map(d => d.id);
    let items = [];
    for (let i = 0; i < docIds.length; i += 300) {
      const { data } = await window.sb.from('documentos_items').select('*')
        .in('documento_id', docIds.slice(i, i + 300)).order('id');
      if (data) items = items.concat(data);
    }
    const itemsByDoc = {};
    (items || []).forEach(i => { (itemsByDoc[i.documento_id] = itemsByDoc[i.documento_id] || []).push(i); });
    const mapped = (docs || []).map(d => ({
      ...d,
      cliente: d.cliente_id,
      total: parseFloat(d.total) || 0,
      lines: (itemsByDoc[d.id] || []).map(i => ({
        sku: i.sku, nombre: i.nombre, qty: i.cantidad,
        precio: parseFloat(i.precio_unitario), subtotal: parseFloat(i.subtotal),
        proveedor_id: i.proveedor_id || null, costo: parseFloat(i.costo) || 0,
      })),
    }));
    // Sustituye SSData.documentos por las del cliente (portal aislado)
    window.SSData.documentos = mapped;
    return mapped;
  };

  window.loadConfigSistema = async function (empresaId) {
    const e = empresaId || window.currentEmpresa;
    const { data, error } = await window.sb.from('configuracion_sistema').select('*').eq('empresa_id', e).maybeSingle();
    if (error) { console.error('[Supabase] Error cargando config sistema:', error); return null; }
    return data;
  };

  window.saveConfigSistema = async function (empresaId, config) {
    const { error } = await window.sb.from('configuracion_sistema')
      .upsert({ empresa_id: empresaId, ...config, updated_at: new Date().toISOString() });
    if (error) console.error('[Supabase] Error guardando config sistema:', error);
    return { error };
  };

  // ─── Cache IndexedDB para carga instantánea de Fase 1 ────────────────────
  const DB_NAME = 'ss-cache';
  const DB_VERSION = 1;
  const STORE = 'fase1';
  const FASE1_KEY = 'snapshot';
  const FASE1_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 horas

  let _dbPromise = null;
  function _getDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _dbPromise;
  }

  async function _idbGet(key) {
    const db = await _getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function _idbPut(key, value) {
    const db = await _getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function _idbDel(key) {
    const db = await _getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // IMPORTANTE: loadFase1Cache se llama SÍNCRONO en index.html (App init).
  // IndexedDB es async → necesitamos cambiar la semántica:
  //   - saveFase1Cache: fire-and-forget (await internamente, sin esperar caller)
  //   - loadFase1Cache: ahora retorna Promise<boolean> (caller debe await)
  // El index.html actual hace `if (loadFase1Cache())` → hay que ajustarlo a await.

  // Se llama en cada tanda que llega (Fase 1, el catálogo aparte, y al agregar seriales), y cada
  // llamada copia el catálogo entero a IndexedDB: con 6.593 productos el `put` mide 24 ms más el clone
  // estructurado. Se agrupa: la última llamada de la ráfaga es la que graba, 400 ms después. Guardar
  // el estado más nuevo una vez es exactamente lo que se quiere; grabar los intermedios era trabajo
  // tirado.
  let _timerCache = null;
  window.saveFase1Cache = function () {
    if (_timerCache) clearTimeout(_timerCache);
    _timerCache = setTimeout(() => { _timerCache = null; _saveFase1CacheYa(); }, 400);
  };
  async function _saveFase1CacheYa() {
    const e = window.currentEmpresa || 'demo1';
    const payload = {
      v: 5, e,
      ts: Date.now(),
      d: {
        productos:     window.SSData.productos,
        clientes:      window.SSData.clientes,
        almacenes:     window.SSData.almacenes,
        tiposCliente:  window.SSData.tiposCliente,
        fuentesVenta:  window.SSData.fuentesVenta,
        inventario:    window.SSData.inventario,
        listasPrecios: window.SSData.listasPrecios,
        marcas:        window.SSData.marcas,
        categorias:    window.SSData.categorias,
        empresaCfg:    window.__ssEmpresaConfigCache?.[e] || null,
      },
    };
    try {
      await _idbPut(FASE1_KEY, payload);
      console.log('[Cache] ✓ Guardado (IndexedDB) — productos:', payload.d.productos.length);
    } catch (err) {
      console.warn('[Cache] Error guardando:', err.message);
    }
  }

  window.loadFase1Cache = async function () {
    try {
      const p = await _idbGet(FASE1_KEY);
      if (!p) return false;
      const e = window.currentEmpresa || 'demo1';
      if (p.v !== 5 || p.e !== e || Date.now() - p.ts > FASE1_CACHE_TTL) return false;
      const d = p.d;
      // Solo confiar en el catálogo cacheado si NO está vacío: el save de Fase 1 puede correr
      // antes de que la carga async de productos resuelva y persistir un [] prematuro. Un [] del
      // cache NO es señal de "listo" (a diferencia de applyProductos, donde [] = tenant sin productos);
      // se deja el stub y __ssProductosReady sin marcar → el overlay espera el refetch real.
      if (d.productos && d.productos.length) { window.SSData.productos = d.productos; window.__ssProductosReady = true; }
      if (d.clientes)      window.SSData.clientes     = d.clientes;
      if (d.almacenes)     window.SSData.almacenes    = d.almacenes;
      if (d.tiposCliente)  window.SSData.tiposCliente = d.tiposCliente;
      if (d.fuentesVenta)  window.SSData.fuentesVenta = d.fuentesVenta;
      if (d.inventario)    window.SSData.inventario   = d.inventario;
      if (d.listasPrecios) window.SSData.listasPrecios= d.listasPrecios;
      if (d.marcas)        window.SSData.marcas       = d.marcas;
      if (d.categorias)    window.SSData.categorias   = d.categorias;
      if (d.empresaCfg)    { if (!window.__ssEmpresaConfigCache) window.__ssEmpresaConfigCache = {}; window.__ssEmpresaConfigCache[e] = d.empresaCfg; }
      window.__ssDataReady = true;
      console.log('[Cache] ✓ Restaurado (IndexedDB) — productos:', (d.productos||[]).length, '| clientes:', (d.clientes||[]).length);
      return true;
    } catch (err) {
      console.warn('[Cache] Error leyendo:', err.message);
      return false;
    }
  };

  window.clearFase1Cache = async function () {
    try { await _idbDel(FASE1_KEY); } catch(e){}
    // Borrar el cache viejo de localStorage si todavía existe
    try { localStorage.removeItem('ss-f1-v3'); } catch(e){}
  };

  // Migración 1-shot: limpiar localStorage viejo en cuanto se cargue IndexedDB
  try { localStorage.removeItem('ss-f1-v3'); } catch(e){}

  // ─── Load all app data from Supabase ───────────────────────────────────────
  // Carga en 2 fases para optimizar latencia en 3G/celular:
  //   FASE 1 (await): datos críticos para POS + dashboard + sidebar + login
  //   FASE 2 (background): documentos, cuentas, chat, drivers, banco, devoluciones
  //                       Dispara evento 'ss-data-extra-loaded' al terminar.
  const has = arr => Array.isArray(arr);

  // Pagina automáticamente para superar el límite de 1000 filas de Supabase.
  // queryFn debe ser una función que devuelve un nuevo query builder cada vez.
  // Optimización (E3): las páginas 2..N se piden en OLEADAS PARALELAS (antes: 1 por 1 en serie
  // → ~12 RTT para clientes). Gap-safe: se corta en la primera página con error/corta y NO se
  // acepta nada posterior a ella (mismo resultado que el bucle secuencial, sin huecos).
  async function fetchAll(queryFn, pageSize = 1000) {
    const first = await queryFn().range(0, pageSize - 1);
    if (first.error) { console.warn('[fetchAll] error página 0:', first.error.message); return { data: [] }; }
    let all = first.data || [];
    if (all.length < pageSize) return { data: all };   // caso común: tabla chica → 1 sola query

    const BATCH = 6;               // páginas por oleada paralela
    let next = 1, done = false;
    while (!done) {
      const reqs = [];
      for (let i = 0; i < BATCH; i++) {
        const p = next + i;
        reqs.push(queryFn().range(p * pageSize, p * pageSize + pageSize - 1));
      }
      const results = await Promise.all(reqs);
      for (const r of results) {   // en orden: acepta un prefijo contiguo, corta al primer hueco
        if (r.error || !r.data || r.data.length === 0) { done = true; break; }
        all = all.concat(r.data);
        if (r.data.length < pageSize) { done = true; break; }
      }
      next += BATCH;
    }
    return { data: all };
  }
  window.fetchAll = fetchAll;

  // Mapea filas crudas de `clientes` al shape de SSData. Extraído para poder aplicarlo tanto
  // en el camino legacy (inline) como en la carga diferida fuera del gate de Fase 1.
  function mapCliente(c) {
    return {
      ...c,
      listaPrecio:   c.lista_precio,
      limiteCredito: parseFloat(c.limite_credito) || 0,
      deuda:         parseFloat(c.deuda) || 0,
      diasCredito:   c.dias_credito,
      ventasYTD:     parseFloat(c.ventas_ytd) || 0,
      ultimaCompra:  c.ultima_compra,
      rating:        parseFloat(c.rating) || 0,
    };
  }
  function applyClientes(data) {
    window.SSData.clientes = (data || []).map(mapCliente);
  }
  // Suma filas al catálogo en memoria sin perder lo que ya estaba. Necesario desde que el
  // catálogo completo es diferido: antes de él pueden haber entrado clientes puntuales por
  // `ensureClientes` (hidratación por id, que a propósito NO filtra por activo ni empresa —
  // un documento viejo puede apuntar a un cliente desactivado). Un `applyClientes` pelado
  // los borraría y esos documentos volverían a quedar sin nombre.
  function mergeClientes(data) {
    const prev = window.SSData.clientes || [];
    const byId = new Map(prev.map(c => [c.id, c]));
    (data || []).forEach(c => byId.set(c.id, mapCliente(c)));
    window.SSData.clientes = [...byId.values()];
    return window.SSData.clientes.length;
  }
  function mergeContactos(data) {
    const prev = window.SSData.contactos || [];
    const byId = new Map(prev.map(c => [c.id, c]));
    (data || []).forEach(c => byId.set(c.id, c));
    window.SSData.contactos = [...byId.values()];
    return window.SSData.contactos.length;
  }

  // Aplica productos + deriva marcas/categorías. Usado inline (legacy) y diferido (RPC slim).
  // ─── Columnas del catálogo de productos ──────────────────────────────────────
  // `select('*')` traía las 27 columnas de los 6.593 productos: 5,6 MB de JSON en cada arranque.
  // Y la mitad de ese peso es el NOMBRE de cada columna repetido fila por fila (PostgREST manda un
  // objeto por registro), así que pedir menos columnas descuenta doble.
  //
  // Lo que se queda es lo que se lee del catálogo en memoria: el POS (precio, costo, stock,
  // garantía), las listas y buscadores, el PDF y los reportes. Lo que se va son las columnas que
  // solo miran dos pantallas:
  //   · shopify_* (7 columnas, 1,2 MB — `shopify_images` sola son 775 kB) → Sync y Dropshipping
  //   · imagenes (188 kB), etiquetas (332 kB), peso → miniaturas, columna de etiquetas y ficha, en Inventario
  //   · garantia_condiciones (181 kB), minimo (70 kB), empresa_id (154 kB), creado_por (116 kB) → solo
  //     Inventario: la ficha del producto, el filtro "bajo stock" y el selector de empresas del alta
  // Esas pantallas las piden al entrar con `ensureProductosInventario()` / `ensureProductosShopify()`.
  // Y se fueron del todo dos columnas que NADIE leía: `requiere_serial` (154 kB) y `odoo_ref` (122 kB
  // del producto; el badge MIG que se ve en las tablas es el de CxC/CxP, no el del catálogo).
  //
  // Ojo con dos que parecen candidatas y no lo son: `garantia_meses` la usa el POS (es el default de
  // garantía de cada línea) y `descripcion` la usa la búsqueda global (Ctrl+K) — sacarla no ahorra
  // 110 kB, degrada una función.
  //
  // `activo` tampoco viaja: la consulta ya filtra `activo = true`, así que era la misma constante
  // repetida 6.593 veces (90 kB). La estampa `applyProductos`, porque hay pantallas que la miran.
  //
  // Si hace falta un campo nuevo en una pantalla de uso general, va acá; si es de una sola pantalla,
  // va por ensureProductosExtra.
  // `servicio` viaja para TODO el catálogo (un booleano son ~13 kB en 6.593 productos, contra el
  // nombre de la columna repetido fila por fila) porque lo mira el POS en cada línea del carrito:
  // un servicio no descuenta stock ni dispara el aviso de faltante. Pedirlo por ruta llegaría
  // tarde — el chequeo corre al agregar la línea. Ver migracion-odoo/42_productos_servicio.sql.
  window.PRODUCTO_COLS = [
    'sku', 'nombre', 'marca', 'categoria', 'costo', 'base', 'empresas',
    'serializado', 'garantia_meses', 'descripcion', 'servicio',
  ].join(',');

  // ¿Este sku es un servicio (flete, mano de obra)? Se resuelve contra el catálogo en memoria.
  // Fail-CLOSED a propósito: si el producto no está cargado devuelve false, o sea "es mercancía"
  // → se le sigue verificando el stock. Equivocarse hacia "es servicio" saltearía el chequeo de
  // existencias de un producto real, que es el error caro.
  window.esProductoServicio = function (sku) {
    if (!sku || sku === '__SECTION__') return false;
    const p = (window.SSData?.productos || []).find(x => x.sku === sku);
    return !!(p && p.servicio);
  };

  // Completa el catálogo YA cargado con columnas que no viajan en el arranque. Mezcla sobre los
  // objetos existentes (no reemplaza el arreglo) para no invalidar las referencias que ya tienen
  // los componentes montados. Idempotente: la segunda llamada con los mismos campos no pide nada.
  const _extraCargado = new Set();
  window.ensureProductosExtra = async function (campos) {
    const e = window.currentEmpresa || 'demo1';
    const cols = (Array.isArray(campos) ? campos : String(campos).split(',')).map(c => c.trim()).filter(Boolean);
    const clave = e + '|' + cols.slice().sort().join(',');
    if (_extraCargado.has(clave)) return true;
    const prods = window.SSData.productos || [];
    if (!prods.length) return false;   // todavía no llegó el catálogo: que lo pida de nuevo después
    const { data } = await fetchAll(() => window.sb.from('productos')
      .select(['sku'].concat(cols).join(','))
      .eq('activo', true).overlaps('empresas', [e]).order('sku'));
    // `fetchAll` avisa del error y devuelve [] — sin filas NO se marca como cargado, así la próxima
    // visita a la pantalla lo reintenta en vez de quedarse sin miniaturas para siempre.
    if (!data || !data.length) { console.warn('[ensureProductosExtra] sin datos para', cols); return false; }
    const porSku = new Map(data.map(r => [r.sku, r]));
    prods.forEach(p => { const r = porSku.get(p.sku); if (r) Object.assign(p, r); });
    _extraCargado.add(clave);
    window.dispatchEvent(new CustomEvent('ss-data-extra-loaded'));
    return true;
  };
  // Inventario: de las columnas que solo usa ese módulo, la ÚNICA que necesita el catálogo completo es
  // `minimo` (el filtro "bajo stock" y su contador miran los 6.593 productos). El resto —imágenes,
  // etiquetas, quién lo creó, garantía, peso, dueño— se muestra por FILA, así que se pide para las 50
  // de la página visible con `ensureProductosCampos`. Traerlas todas eran 2,3 MB cada vez que se abría
  // Inventario, de los cuales 1,3 MB son imágenes que solo se ven en 50 miniaturas.
  window.ensureProductosInventario = () => window.ensureProductosExtra(['minimo']);

  // Columnas de UNOS productos (la página visible, o el que se acaba de abrir). Se recuerda por
  // sku+campos, así que pasar de página solo pide lo que falta y volver atrás no pide nada.
  const _extraPorSku = new Set();
  window.ensureProductosCampos = async function (skus, campos) {
    const lista = [...new Set((skus || []).filter(Boolean))];
    const cols = (Array.isArray(campos) ? campos : String(campos).split(',')).map(c => c.trim()).filter(Boolean);
    if (!lista.length || !cols.length) return false;
    const clave = cols.slice().sort().join(',');
    const faltan = lista.filter(s => !_extraPorSku.has(s + '|' + clave));
    if (!faltan.length) return true;
    const e = window.currentEmpresa || 'demo1';
    const porSku = new Map((window.SSData.productos || []).map(p => [p.sku, p]));
    let algo = false;
    // En tandas de 300: un `.in()` con miles de sku no cabe en la URL.
    for (let i = 0; i < faltan.length; i += 300) {
      const chunk = faltan.slice(i, i + 300);
      const { data, error } = await window.sb.from('productos')
        .select(['sku'].concat(cols).join(','))
        .in('sku', chunk).overlaps('empresas', [e]);
      if (error) { console.warn('[ensureProductosCampos]', error.message); return algo; }
      (data || []).forEach(r => { const p = porSku.get(r.sku); if (p) { Object.assign(p, r); algo = true; } });
      // Se marcan TODOS los pedidos, no solo los que volvieron: si un sku no está en el catálogo en
      // memoria, volver a pedirlo en cada render sería un bucle de consultas.
      chunk.forEach(s => _extraPorSku.add(s + '|' + clave));
    }
    if (algo) window.dispatchEvent(new CustomEvent('ss-data-extra-loaded'));
    return true;
  };
  window.ensureProductosShopify  = () => window.ensureProductosExtra(
    ['shopify_product_id', 'shopify_variant_id', 'shopify_inventory_item_id', 'shopify_handle', 'shopify_status', 'shopify_last_sync']);

  // ─── Documentos en memoria: SOLO donde se agregan o se eligen ────────────────
  // `SSData.documentos` era lo más pesado que bajaba la app: 90 días de documentos CON sus ítems
  // embebidos = 9,3 MB de JSON (4.601 filas × 59 columnas + 2,7 MB de ítems), en cada arranque y para
  // todos. Y el POS no los usa: las cuatro listas del flujo (cotizaciones/órdenes/facturas/despachos)
  // piden su página al server desde que se paginaron, y el detalle carga su propio linaje e ítems.
  //
  // Ahora no los carga nadie por defecto. Los piden al entrar las pantallas que de verdad necesitan
  // el conjunto en memoria para AGREGAR (dashboard, comisiones, vendedores, reportes en modo cliente)
  // o para ELEGIR de una lista (drivers: despachos por asignar; devoluciones: facturas). Ver el
  // efecto por ruta en app-bootstrap.
  //
  // `items: true` suma los ítems (2,7 MB): solo lo pide quien desglosa por producto.
  function mapDocumento(d) {
    return {
      ...d,
      cliente: d.cliente_id,
      lines: (d.documentos_items || []).map(i => ({
        sku:             i.sku,
        nombre:          i.nombre,
        qty:             i.cantidad,
        precio:          parseFloat(i.precio_unitario),
        descuento:       i.descuento || 0,
        descuento_extra: parseFloat(i.descuento_extra) || 0,
        subtotal:        parseFloat(i.subtotal),
        proveedor_id:    i.proveedor_id || null,
        costo:           parseFloat(i.costo) || 0,
        garantia_meses:        i.garantia_meses != null ? parseInt(i.garantia_meses) : null,
        garantia_condiciones:  i.garantia_condiciones || null,
      })),
    };
  }
  window.mapDocumento = mapDocumento;

  // Lo cargado hasta ahora, por empresa: así una segunda pantalla que pide MENOS no pisa lo que ya
  // hay (pedir 90 días sin ítems no puede borrar los ítems que el dashboard ya cargó).
  let _docsEnMemoria = null;     // { empresa, dias, items }
  const _docsEnVuelo = new Map();

  window.ensureDocumentos = function (opts = {}) {
    const e = window.currentEmpresa || 'demo1';
    const dias = opts.dias || 90;
    const items = !!opts.items;
    if (_docsEnMemoria && _docsEnMemoria.empresa === e
        && _docsEnMemoria.dias >= dias && (_docsEnMemoria.items || !items)) return Promise.resolve(true);
    const clave = e + '|' + dias + '|' + items;
    if (_docsEnVuelo.has(clave)) return _docsEnVuelo.get(clave);   // dos pantallas a la vez → una sola carga
    const desde = new Date(Date.now() - dias * 86400000).toISOString().split('T')[0];
    const cols = 'id,tipo,cliente_id,fecha,estado,total,items,vendedor,almacen_id,contacto_id,tipo_venta,'
      + 'terminos_pago,tipo_entrega,zona_delivery,nro_despacho,dir_entrega,vencimiento,subtotal,iva,'
      + 'descuento_pct,descuento_doc,aplica_iva,modalidad_pago,cobertura_pct,tasa_bcv,tasa_paralelo,'
      + 'documento_origen_id,raiz_id,has_child,created_at,creado_por,empresa_id,driver_id,tipo_factura,'
      + 'comision_estado,comision_cxp_id,transportista,guia_envio,fecha_entrega_estimada,entregado_en,'
      + 'estado_cobro,estado_despacho,fecha_cobro,cobrado_at,odoo_ref,slug,fuente'
      + (items ? ',documentos_items(*)' : '');
    const p = fetchAll(() => window.sb.from('documentos').select(cols)
        .eq('empresa_id', e).gte('fecha', desde).order('fecha', { ascending: false }))
      .then(({ data }) => {
        if (!data || !data.length) { _docsEnVuelo.delete(clave); return false; }
        window.SSData.documentos = data.map(mapDocumento);
        _docsEnMemoria = { empresa: e, dias, items };
        _docsEnVuelo.delete(clave);
        window.dispatchEvent(new CustomEvent('ss-data-extra-loaded'));
        console.log('[Supabase] ✓ Documentos en memoria:', data.length, '(' + dias + 'd' + (items ? ', con ítems' : '') + ')');
        return true;
      })
      .catch(err => { console.warn('[ensureDocumentos] falló', err); _docsEnVuelo.delete(clave); return false; });
    _docsEnVuelo.set(clave, p);
    return p;
  };

  // ─── Órdenes de compra: SOLO en Compras ──────────────────────────────────────
  // Fase 2 bajaba TODAS las OCs con TODOS sus ítems en cada arranque: 1,4 MB de cabeceras + 2,6 MB
  // de ítems (10.628 filas) para dos pantallas — el módulo de Compras (dentro de Proveedores) y la
  // pestaña de trazabilidad de la ficha de producto, que solo necesita las de UN sku.
  let _ocEnMemoria = null;      // empresa cargada
  let _ocEnVuelo = null;
  window.ensureOrdenesCompra = function () {
    const e = window.currentEmpresa || 'demo1';
    if (_ocEnMemoria === e) return Promise.resolve(true);
    if (_ocEnVuelo) return _ocEnVuelo;
    _ocEnVuelo = Promise.all([
      fetchAll(() => window.sb.from('ordenes_compra').select('*').eq('empresa_id', e).order('fecha', { ascending: false })),
      fetchAll(() => window.sb.from('ordenes_compra_items').select('*').eq('empresa_id', e)),
    ]).then(([{ data: ocs }, { data: ocItems }]) => {
      _ocEnVuelo = null;
      if (!Array.isArray(ocs)) return false;
      window.SSData.ordenesCompra = mapOrdenesCompra(ocs, ocItems);
      _ocEnMemoria = e;
      window.dispatchEvent(new CustomEvent('ss-data-extra-loaded'));
      console.log('[Supabase] ✓ Órdenes de compra:', ocs.length, '| ítems:', (ocItems || []).length);
      return true;
    }).catch(err => { console.warn('[ensureOrdenesCompra] falló', err); _ocEnVuelo = null; return false; });
    return _ocEnVuelo;
  };

  function mapOrdenesCompra(ocs, ocItems) {
    const itemsMap = {};
    (ocItems || []).forEach(it => {
      if (!itemsMap[it.oc_id]) itemsMap[it.oc_id] = [];
      itemsMap[it.oc_id].push(it);
    });
    return (ocs || []).map(o => ({
      ...o,
      proveedor: o.proveedor_id,
      monto: parseFloat(o.monto_total ?? o.monto) || 0,
      items: (itemsMap[o.id] || []),
      items_count: typeof o.items === 'number' ? o.items : null,
    }));
  }

  // Trazabilidad de UN producto: qué proveedores lo vendieron, a qué precio y cuándo. Antes se
  // filtraba el set completo en memoria; ahora se preguntan las líneas de ese sku (unas pocas).
  window.comprasDeProducto = async function (sku) {
    if (!sku) return [];
    const e = window.currentEmpresa || 'demo1';
    const { data: items } = await fetchAll(() => window.sb.from('ordenes_compra_items')
      .select('oc_id,sku,cantidad_pedida,precio_unitario').eq('empresa_id', e).eq('sku', sku));
    const ids = [...new Set((items || []).map(i => i.oc_id).filter(Boolean))];
    if (!ids.length) return [];
    const { data: ocs } = await fetchAll(() => window.sb.from('ordenes_compra')
      .select('id,proveedor_id,fecha,estado').eq('empresa_id', e).in('id', ids));
    const porId = new Map((ocs || []).map(o => [o.id, o]));
    return (items || []).map(i => {
      const oc = porId.get(i.oc_id) || {};
      return { ocId: i.oc_id, proveedor_id: oc.proveedor_id, fecha: oc.fecha, estado: oc.estado,
               cantidad: parseFloat(i.cantidad_pedida) || 0, precio: parseFloat(i.precio_unitario) || 0 };
    }).filter(r => r.proveedor_id);
  };

  // Un documento COMPLETO (con sus líneas) por id. Es lo que se usa cuando hay que imprimir o
  // reimprimir algo que no está en pantalla: el POS ya no guarda documentos en memoria, así que se
  // pide la fila —una— en el momento en que el usuario la pide.
  window.cargarDocumentoCompleto = async function (id) {
    if (!id) return null;
    const e = window.currentEmpresa || 'demo1';
    // Ordenadas por id: el ORDEN de las líneas es información del documento (las SECCIONES separan
    // bloques y solo significan algo en su lugar). Sin `order` PostgREST devuelve lo que salga del
    // índice por `documento_id`, que no es el de inserción.
    const { data } = await window.sb.from('documentos')
      .select('*, documentos_items(*)').eq('id', id).eq('empresa_id', e)
      .order('id', { referencedTable: 'documentos_items' }).maybeSingle();
    if (!data) return null;
    const doc = mapDocumento(data);
    doc.total = parseFloat(data.total) || 0;
    return doc;
  };

  // Ventas del año y última compra de los clientes de UNA página de la lista. Antes se calculaba
  // sobre `SSData.documentos`, o sea sobre la ventana de 90 días: la columna decía "ventas YTD" pero
  // sumaba tres meses, y "última compra" no veía nada más viejo que eso. Ahora se pregunta al server
  // por esos clientes y por el año en curso — son pocas filas de 3 columnas.
  window.statsClientesPagina = async function (ids) {
    const lista = (ids || []).filter(Boolean);
    if (!lista.length) return {};
    const e = window.currentEmpresa || 'demo1';
    const yr = window.caracasYear();
    const { data } = await fetchAll(() => window.sb.from('documentos')
      .select('cliente_id,total,fecha')
      .eq('empresa_id', e).eq('tipo', 'factura').not('estado', 'in', '(cancelada,anulada)')
      .in('cliente_id', lista).gte('fecha', yr + '-01-01').order('fecha', { ascending: false }));
    const out = {};
    lista.forEach(id => { out[id] = { ventasYTD: 0, ultimaCompra: null }; });
    (data || []).forEach(d => {
      const s = out[d.cliente_id]; if (!s) return;
      s.ventasYTD += Number(d.total) || 0;
      if (!s.ultimaCompra || String(d.fecha) > String(s.ultimaCompra)) s.ultimaCompra = d.fecha;
    });
    return out;
  };

  function applyProductos(data) {
    // `activo: true` se estampa acá y no viaja por la red: la consulta filtra por activo, así que era
    // la misma constante repetida 6.593 veces (90 kB de JSON). Hay pantallas que miran `p.activo`.
    const prods = (data || []).map(p => (p.activo === undefined ? { ...p, activo: true } : p));
    window.SSData.productos  = prods;
    window.SSData.marcas     = [...new Set(prods.map(p => p.marca).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    window.SSData.categorias = [...new Set(prods.map(p => p.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    // Señal de "catálogo aplicado" (aunque venga vacío) — el dashboard la usa para no apagar su
    // overlay antes de tener productos (donut de categorías / alerta de stock). true una vez cargado.
    window.__ssProductosReady = true;
  }

  window.loadAppData = async function () {
    const e = window.currentEmpresa || 'demo1';
    window.__ssDataReady = false;
    window.__ssExtrasReady = false;   // FASE 2 (bancos, movimientos, etc.) aún no cargada

    // ─── FASE 1: crítica — RPC consolidado (1 sola llamada) con fallback ───
    let tasas, productos, clientes, almacenes, invRows, listas, tipos, listaDetalle, fuentesVenta, empresaCfg;
    let usedRpc = false;
    // PRODUCTOS ya no viaja en el gate. El snapshot sin productos pesa 186 kB (vs 5.8 MB); productos
    // (~5 MB) se carga en paralelo y se aplica FUERA del gate (async), así el shell pinta con el
    // snapshot chico. La promesa se reutiliza en el camino RPC y el legacy.
    //
    // CLIENTES ya no se carga acá en absoluto: son 13.092 filas (~2,4 MB crudos, varias páginas de
    // 1000) que el POS —donde más importa arrancar rápido— no necesita, porque su selector busca
    // contra el servidor. El catálogo completo pasó a `ensureClientesCatalogo()`, que lo pide la
    // ruta que de verdad lo usa (ver app-bootstrap). Ojo: NO agregarlo de vuelta acá.
    const productosPromise = fetchAll(() => window.sb.from('productos').select(window.PRODUCTO_COLS).eq('activo', true).overlaps('empresas', [e]).order('nombre'));
    try {
      // Timeout de 5s para abandonar la RPC y caer al fallback. p_incluir_productos=false → snapshot slim.
      const rpcPromise = window.sb.rpc('get_fase1_snapshot', { p_empresa_id: e, p_incluir_productos: false });
      const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('rpc-timeout-5s')), 5000));
      const { data: snap, error: snapErr } = await Promise.race([
        rpcPromise,
        timeoutPromise.then(() => { throw new Error('rpc-timeout-5s'); }),
      ]).then(r => r, err => ({ data: null, error: err }));

      if (snapErr || !snap) {
        console.warn('[loadAppData] Fase 1 RPC falló, fallback a queries:', snapErr?.message || snapErr);
      } else {
        usedRpc = true;
        // productos y clientes NO viajan en el snapshot slim: se aplican FUERA del gate (bloque async
        // abajo). Quedan `undefined` → has() los salta en el procesamiento de abajo.
        almacenes    = snap.almacenes || [];
        invRows      = snap.inventario || [];
        listas       = snap.listas_precios || [];
        tipos        = snap.tipos_cliente || [];
        listaDetalle = snap.lista_precios_detalle || [];
        fuentesVenta = snap.pos_fuentes_venta || snap.fuentes_venta || [];
        empresaCfg   = snap.configuracion_sistema || null;
        tasas        = snap.tasa_cambio ? [snap.tasa_cambio] : [];
        console.log('[Supabase] ✓ Fase 1 (RPC slim) — productos y clientes: (async, fuera del gate) | inventario:', invRows.length);
      }
    } catch (rpcOuterErr) {
      console.warn('[loadAppData] Fase 1 RPC excepción, fallback a queries:', rpcOuterErr.message);
    }

    try {
      if (!usedRpc) {
        // LEGACY fallback: 10 queries paralelas (se mantiene por si RPC falla)
        const res = await Promise.all([
          window.sb.from('tasa_cambio').select('*').order('created_at', { ascending: false }).limit(1),
          fetchAll(() => window.sb.from('productos').select(window.PRODUCTO_COLS).eq('activo', true).overlaps('empresas', [e]).order('nombre')),
          // Clientes NO: el catálogo completo es diferido (ensureClientesCatalogo). Se deja el hueco
          // para no renumerar los índices de `res` de abajo.
          Promise.resolve({ data: undefined }),
          window.sb.from('almacenes').select('*').eq('empresa_id', e).order('nombre'),
          fetchAll(() => window.sb.from('inventario').select('*')),
          window.sb.from('listas_precios').select('*').eq('empresa_id', e),
          window.sb.from('tipos_cliente').select('*').eq('empresa_id', e),
          // E8 fix: fetchAll — un select plano cortaba a 1000 filas → precios truncados en empresas
          // con muchas líneas de lista (bug de correctitud, no solo perf). El snapshot RPC ya trae todo.
          fetchAll(() => window.sb.from('lista_precios_detalle').select('*').eq('empresa_id', e)),
          window.sb.from('pos_fuentes_venta').select('*').eq('empresa_id', e).eq('activo', true).order('orden'),
          window.sb.from('configuracion_sistema').select('*').eq('empresa_id', e).maybeSingle(),
        ]);
        tasas        = res[0].data;
        productos    = res[1].data;
        clientes     = res[2].data;
        almacenes    = res[3].data;
        invRows      = res[4].data;
        listas       = res[5].data;
        tipos        = res[6].data;
        listaDetalle = res[7].data;
        fuentesVenta = res[8].data;
        empresaCfg   = res[9].data;
        console.log('[Supabase] ✓ Fase 1 (LEGACY 10 queries) — productos:', (productos || []).length);
      }

      if (tasas && tasas.length > 0) {
        const t = tasas[0];
        let paralelo = parseFloat(t.paralelo);
        let vuelto   = parseFloat(t.vuelto ?? t.paralelo);

        // Fallback: si la última fila tiene paralelo/vuelto null/0/NaN,
        // buscar el último valor NO-NULL conocido (evita "Bs. 0.00" al inicio del día).
        if (!paralelo || isNaN(paralelo) || paralelo <= 0) {
          const { data: rowsP } = await window.sb
            .from('tasa_cambio').select('paralelo')
            .not('paralelo', 'is', null)
            .order('created_at', { ascending: false }).limit(1);
          if (rowsP && rowsP.length > 0) paralelo = parseFloat(rowsP[0].paralelo);
        }
        if (!vuelto || isNaN(vuelto) || vuelto <= 0) {
          const { data: rowsV } = await window.sb
            .from('tasa_cambio').select('vuelto')
            .not('vuelto', 'is', null)
            .order('created_at', { ascending: false }).limit(1);
          if (rowsV && rowsV.length > 0) vuelto = parseFloat(rowsV[0].vuelto);
          else if (paralelo && !isNaN(paralelo)) vuelto = paralelo;
        }

        // Sin `|| 15`: si la fila no trae cobertura queda null y el POS avisa. Un default acá se
        // convierte en precios cobrados de menos.
        const cobertura = (t.cobertura == null || t.cobertura === '') ? null : parseFloat(t.cobertura);
        window.SSData.tasa = { bcv: parseFloat(t.bcv), paralelo, cobertura, vuelto };
        window.currentTasa = window.SSData.tasa;
      }

      if (has(almacenes))    window.SSData.almacenes    = almacenes;
      if (has(tipos))        window.SSData.tiposCliente = tipos;
      if (has(fuentesVenta)) window.SSData.fuentesVenta = fuentesVenta;

      // productos y clientes: en LEGACY vienen resueltos (res[1]/res[2]) → aplicar inline.
      // En el camino RPC quedan undefined y se aplican en el bloque async de abajo (fuera del gate).
      if (has(productos)) applyProductos(productos);
      if (has(clientes))  applyClientes(clientes);

      if (has(invRows)) {
        const almacenesEmpresa = new Set((almacenes || []).map(a => a.id));
        const inv = {};
        invRows.forEach(row => {
          if (!almacenesEmpresa.has(row.almacen_id)) return;
          if (!inv[row.sku]) inv[row.sku] = {};
          inv[row.sku][row.almacen_id] = { cantidad: row.cantidad, reservado: row.reservado, locacion: row.locacion, minimo: row.minimo, maximo: row.maximo };
        });
        window.SSData.inventario = inv;
      }

      if (has(listas)) {
        const detalleMap = {};
        (listaDetalle || []).forEach(d => { if (!detalleMap[d.lista_id]) detalleMap[d.lista_id] = {}; detalleMap[d.lista_id][d.sku] = parseFloat(d.precio); });
        window.SSData.listasPrecios = listas.map(l => ({ ...l, tipo: l.tipo_cliente_id, preciosManuales: detalleMap[l.id] || {} }));
      }

      if (empresaCfg) { if (!window.__ssEmpresaConfigCache) window.__ssEmpresaConfigCache = {}; window.__ssEmpresaConfigCache[e] = empresaCfg; }

      window.__ssDataReady = true;
      window.saveFase1Cache?.();
      window.dispatchEvent(new CustomEvent('ss-appdata-loaded'));
      console.log('[Supabase] ✓ Fase 1 procesada — inventario:', (invRows || []).length, '| fuente:', usedRpc ? 'RPC' : 'LEGACY');

      // Productos y clientes FUERA del gate (RPC path): el shell ya pintó con el snapshot slim
      // (186 kB). Cada uno llega aparte (~5/8 MB) y al aplicarse re-emite ss-appdata-loaded para
      // re-render. En warm-load ya vienen del cache → no se ven vacíos.
      if (!has(productos)) {
        productosPromise
          .then(r => {
            applyProductos(r.data);
            window.saveFase1Cache?.();
            window.dispatchEvent(new CustomEvent('ss-appdata-loaded'));
            console.log('[Supabase] ✓ Productos (fuera del gate):', (r.data || []).length);
          })
          .catch(err => {
            console.warn('[Supabase] carga async de productos falló:', err);
            // Marcar "settled" aunque falle → no dejar el overlay del dashboard colgado esperando productos.
            window.__ssProductosReady = true;
            window.dispatchEvent(new CustomEvent('ss-appdata-loaded'));
          });
      }
      // Clientes: ya no se cargan acá. Los pide la ruta que necesita el catálogo completo
      // (ensureClientesCatalogo) y, en el POS, el propio selector contra el servidor.

    } catch (err) {
      console.error('[Supabase] Fallo Fase 1:', err);
    }

    // ─── FASE 2: diferida (background, no bloquea render) ─────────────────
    loadAppDataExtras(e).catch(err => {
      console.warn('[Supabase] Fallo Fase 2:', err);
      // Señal para que el overlay del dashboard se libere de inmediato (en vez de esperar su timeout).
      window.dispatchEvent(new CustomEvent('ss-data-extra-failed'));
    });

    return window.SSData;
  };

  async function loadAppDataExtras(e) {
    // Límites para 3G: docs/cxc/cxp/devoluciones/incidencias/despachos por
    // ventana de tiempo; chat/movs banco con limit() para evitar payloads
    // que crecen sin tope.
    const dayMs = 86400000;
    const isoDaysAgo = (n) => new Date(Date.now() - n*dayMs).toISOString();
    const dateDaysAgo = (n) => isoDaysAgo(n).split('T')[0];

    // ── Un solo viaje: RPC consolidada, con el camino de siempre como respaldo ──
    // Lo que queda de Fase 2 son 18 consultas chicas. El peso ya no es el problema (576 kB en
    // total): son 18 idas y vueltas, cada una con su verificación de JWT y su turno en el pool de
    // PostgREST. Con Fase 1 ya se había medido que consolidar baja de ~2,5 s a ~700 ms; la RPC
    // tarda 62 ms en el server. Si falla, se cae al camino de siempre — los filtros y las ventanas
    // de tiempo son los MISMOS en los dos lados (ver migracion-odoo/26_fase2_snapshot.sql).
    let proveedores, contactos, vendedores, docs, cxc, cxp, bancos, movs, canales, mensajes, canalMiembros, drivers, incidencias, driverDespachos, devoluciones, categoriasCuenta, ocs, ocItems, usuarios, tiposEntrega, rolesData, camposConfigData, categorias, marcasRows, anticipos;
    let usoRpcFase2 = false;
    try {
      const { data: snap, error: snapErr } = await window.sb.rpc('get_fase2_snapshot', { p_empresa_id: e });
      if (snapErr || !snap) {
        console.warn('[loadAppDataExtras] RPC falló, fallback a consultas:', snapErr?.message || snapErr);
      } else {
        usoRpcFase2 = true;
        proveedores = snap.proveedores || [];
        vendedores = snap.vendedores || [];
        cxc = snap.cuentas_cobrar || [];
        cxp = snap.cuentas_pagar || [];
        bancos = snap.cuentas_bancarias || [];
        canales = snap.canales_chat || [];
        mensajes = snap.mensajes_chat || [];
        canalMiembros = snap.canal_miembros || [];
        drivers = snap.drivers || [];
        incidencias = snap.incidencias || [];
        driverDespachos = snap.driver_despachos || [];
        devoluciones = snap.devoluciones || [];
        categoriasCuenta = snap.categorias_cuenta || [];
        usuarios = snap.usuarios || [];
        tiposEntrega = snap.pos_tipos_entrega || [];
        rolesData = snap.roles || [];
        camposConfigData = snap.campos_config || [];
        categorias = snap.categorias || [];
        marcasRows = snap.marcas || [];
        anticipos = snap.anticipos || [];
        console.log('[Supabase] ✓ Fase 2 (RPC) — CxC:', cxc.length, '| proveedores:', proveedores.length);
      }
    } catch (err) {
      console.warn('[loadAppDataExtras] excepción en la RPC, fallback a consultas:', err?.message || err);
    }

    if (!usoRpcFase2) {
    [{ data: proveedores },
      { data: contactos },
      { data: vendedores },
      { data: docs },
      { data: cxc },
      { data: cxp },
      { data: bancos },
      { data: movs },
      { data: canales },
      { data: mensajes },
      { data: canalMiembros },
      { data: drivers },
      { data: incidencias },
      { data: driverDespachos },
      { data: devoluciones },
      { data: categoriasCuenta },
      { data: ocs },
      { data: ocItems },
      { data: usuarios },
      { data: tiposEntrega },
      { data: rolesData },
      { data: camposConfigData },
      { data: categorias },
      { data: marcasRows },
      { data: anticipos }
    ] = await Promise.all([
      window.sb.from('proveedores').select('*').eq('activo', true).eq('empresa_id', e).order('nombre'),
      // Contactos NO: son 13.140 filas (varias páginas) y este Promise.all termina cuando acaba la
      // MÁS LENTA, así que retrasaban bancos, CxC, usuarios y todo lo demás de Fase 2. Pasaron a
      // `ensureContactosCatalogo()`, pedido por la ruta que los lista; el POS los busca en el server.
      Promise.resolve({ data: undefined }),
      window.sb.from('vendedores').select('*').eq('activo', true).eq('empresa_id', e).order('nombre'),
      // Documentos NO: eran 9,3 MB de JSON (90 días × 59 columnas + los ítems embebidos) en el
      // arranque de TODOS, y el POS no los usa — sus cuatro listas piden su página al server y el
      // detalle carga su propio linaje. Pasaron a `ensureDocumentos()`, que piden al entrar las
      // pantallas que agregan (dashboard, comisiones, vendedores, reportes) o eligen de una lista
      // (drivers, devoluciones). Ojo: NO agregarlo de vuelta acá.
      Promise.resolve({ data: undefined }),
      fetchAll(() => window.sb.from('cuentas_cobrar').select('*').eq('empresa_id', e).order('vence')),
      // Columnas explícitas SIN `foto`: la carga masiva de TODAS las CxP (sin ventana de fecha) no
      // puede incluir la foto de la factura (base64) sin inflar el arranque de sesión de todos los
      // usuarios. La foto se carga on-demand vía window.getCxpFoto al abrir el detalle de una CxP.
      // Las columnas van EXPLÍCITAS (sin `foto`, que es base64 y no puede viajar en la carga
      // masiva). Esta lista tiene que quedar igual a la proyección de `get_fase2_snapshot`
      // (migración 69): si una columna nueva se agrega en un solo lado, aparece o desaparece
      // según qué camino de carga se haya usado, que es peor que no estar en ninguno.
      fetchAll(() => window.sb.from('cuentas_pagar').select('id,factura,proveedor_id,monto,pagado,vence,dias,estado,empresa_id,cliente_id,tipo,concepto,pago_origen_id,pagos,categoria,doc_ids,vendedor_id,vendedor_nombre,odoo_ref,creado_por,moneda,tasa,created_at,fecha_emision,pago_eliminado_por,pago_eliminado_en,pago_eliminado_motivo').eq('empresa_id', e).order('vence')),
      window.sb.from('cuentas_bancarias').select('*').eq('empresa_id', e),
      // Movimientos bancarios NO: la ventana de 365 días son 2,4 MB (5.469 filas) y solo los usa
      // Bancos, que los pide al entrar con `ensureMovsBancarios()`. El badge del sidebar y el aviso
      // del dashboard salen de `movsPendientes` (sin conciliar, sin ventana: 34 filas).
      Promise.resolve({ data: undefined }),
      window.sb.from('canales_chat').select('*').eq('empresa_id', e),
      window.sb.from('mensajes_chat').select('*').order('created_at', { ascending: false }).limit(500),
      window.sb.from('canal_miembros').select('*'),
      window.sb.from('drivers').select('*').eq('empresa_id', e).eq('activo', true).order('nombre'),
      window.sb.from('incidencias').select('*').eq('empresa_id', e).gte('created_at', isoDaysAgo(180)).order('created_at', { ascending: false }),
      window.sb.from('driver_despachos').select('*').eq('empresa_id', e).gte('fecha', dateDaysAgo(60)),
      window.sb.from('devoluciones').select('*').eq('empresa_id', e).gte('fecha', dateDaysAgo(365)).order('fecha', { ascending: false }),
      window.sb.from('categorias_cuenta').select('*').eq('empresa_id', e).order('nombre'),
      // Órdenes de compra NO: eran 1,4 MB de cabeceras + 2,6 MB de ítems (10.628 filas) en el
      // arranque de TODOS, para dos pantallas. Pasaron a `ensureOrdenesCompra()` (el módulo de
      // Compras, dentro de Proveedores) y a `comprasDeProducto(sku)` (trazabilidad de la ficha de
      // producto, que solo necesita las de UN sku). Ojo: NO agregarlas de vuelta acá.
      Promise.resolve({ data: undefined }),
      Promise.resolve({ data: undefined }),
      // `telefono` va en la lista: es el contacto del vendedor que se imprime en los PDF. Sin él,
      // los pasos 2 y 3 de la cadena de `pdf.jsx` leen una propiedad que no existe y no resuelven
      // nunca — el dato estaba en la base desde la migración 75 y jamás llegaba (ver migración 89).
      // Esta consulta es el ESPEJO de la proyección de `usuarios` en `get_fase2_snapshot`: al
      // agregar una columna hay que tocar las dos.
      window.sb.from('usuarios').select('id, nombre, rol, avatar, online, iniciales, email, auth_id, activo, cliente_id, empresas, tiene_pin, telefono, pin_digitos, pin_prompt_omitido_en').order('nombre'),
      window.sb.from('pos_tipos_entrega').select('*').eq('empresa_id', e).eq('activo', true).order('orden'),
      window.sb.from('roles').select('*').eq('empresa_id', e).order('nombre'),
      window.sb.from('campos_config').select('*').eq('empresa_id', e),
      window.sb.from('categorias').select('*').eq('empresa_id', e).order('nombre'),
      window.sb.from('marcas').select('nombre').eq('empresa_id', e).eq('activo', true).order('nombre'),
      // Anticipos: la vista ya trae el saldo disponible calculado. Sin ventana de fecha —
      // un anticipo puede quedarse meses sin consumir y debe seguir visible.
      fetchAll(() => window.sb.from('v_anticipos').select('*').eq('empresa_id', e).order('fecha', { ascending: false })),
    ]);
    }

    if (has(categoriasCuenta)) window.SSData.categoriasCuenta = categoriasCuenta;

    // Órdenes de compra: ya NO se cargan acá (ver ensureOrdenesCompra). `ocs` llega undefined.
    if (Array.isArray(ocs)) window.SSData.ordenesCompra = mapOrdenesCompra(ocs, ocItems);

    // Proveedores
    if (has(proveedores)) window.SSData.proveedores = proveedores.map(p => ({
      ...p, diasPago: p.dias_pago, deuda: parseFloat(p.deuda) || 0,
      // Normalizar categorias a array: en datos importados/legados puede venir null
      // o string, lo que rompía .slice/.map en la tabla de proveedores.
      categorias: Array.isArray(p.categorias) ? p.categorias : (p.categorias ? [p.categorias] : []),
    }));

    // Vendedores
    if (has(vendedores)) window.SSData.vendedores = vendedores.map(v => ({
      ...v,
      metaMensual: parseFloat(v.meta_mensual) || 0,
      comisionPct: parseFloat(v.comision_pct) || 0,
    }));

    // Contactos
    if (contactos) window.SSData.contactos = contactos;

    // Drivers / incidencias / despachos / devoluciones (mutación in-place)
    if (has(drivers))         { if (!window.SSData.drivers) window.SSData.drivers = []; window.SSData.drivers.length = 0; drivers.forEach(d => window.SSData.drivers.push(d)); }
    if (has(incidencias))     { if (!window.SSData.incidencias) window.SSData.incidencias = []; window.SSData.incidencias.length = 0; incidencias.forEach(i => window.SSData.incidencias.push(i)); }
    if (has(driverDespachos)) { if (!window.SSData.driverDespachos) window.SSData.driverDespachos = []; window.SSData.driverDespachos.length = 0; driverDespachos.forEach(dd => window.SSData.driverDespachos.push(dd)); }
    if (has(devoluciones))    { if (!window.SSData.devoluciones) window.SSData.devoluciones = []; window.SSData.devoluciones.length = 0; devoluciones.forEach(d => window.SSData.devoluciones.push(d)); }

    // Documentos: ya NO se cargan acá (ver ensureDocumentos). `docs` llega undefined.
    if (has(docs)) window.SSData.documentos = docs.map(mapDocumento);

    // Cuentas por Cobrar
    if (has(cxc)) {
      const hoy = new Date(); hoy.setHours(0,0,0,0);
      window.SSData.cuentasCobrar = cxc.map(c => {
        const monto  = parseFloat(c.monto)  || 0;
        const pagado = parseFloat(c.pagado) || 0;
        const venceDate = c.vence ? new Date(c.vence + 'T00:00:00') : null;
        const dias = venceDate ? Math.round((hoy - venceDate) / dayMs) : (c.dias || 0);
        const estado = (window.ssSaldada(pagado, monto) && monto > 0) ? 'pagada' : dias > 0 ? 'vencida' : (c.estado === 'pagada' ? 'pagada' : 'pendiente');
        // fecha_emision ahora es columna persistida en cuentas_cobrar (viene en select *).
        return { ...c, cliente: c.cliente_id, monto, pagado, pagos: Array.isArray(c.pagos) ? c.pagos : [], dias, estado };
      });
    }

    // Cuentas por Pagar
    if (has(cxp)) {
      const hoy = new Date(); hoy.setHours(0,0,0,0);
      window.SSData.cuentasPagar = cxp.map(c => {
        const monto  = parseFloat(c.monto)  || 0;
        const pagado = parseFloat(c.pagado) || 0;
        const venceDate = c.vence ? new Date(c.vence + 'T00:00:00') : null;
        const dias = venceDate ? Math.round((hoy - venceDate) / dayMs) : (c.dias || 0);
        const estado = (window.ssSaldada(pagado, monto) && monto > 0) ? 'pagada' : dias > 0 ? 'vencida' : (c.estado === 'pagada' ? 'pagada' : 'pendiente');
        return { ...c, proveedor: c.proveedor_id, cliente: c.cliente_id, tipo: c.tipo || 'proveedor', monto, pagado, dias, estado };
      });
    }

    // Cuentas bancarias / movimientos
    if (has(bancos)) window.SSData.cuentasBancarias = bancos.map(b => ({
      ...b,
      saldo:       parseFloat(b.saldo) || 0,
      saldoPrevio: parseFloat(b.saldo_previo) || 0,
    }));
    if (has(movs)) window.SSData.movsBancarios = movs.map(m => ({
      ...m, monto: parseFloat(m.monto) || 0, matchId: m.match_id,
    }));

    // Pagos: ya NO se cargan acá. Eran 2,8 MB (5.625 filas de la ventana de 365 días) en el arranque
    // de todos, y solo los muestran las pantallas de plata. Los pide `ensurePagos()` en /cxc, /cxp,
    // /clientes, /banco y /anticipos. Ojo: NO agregarlos de vuelta acá.

    // Chat — canales con miembros agrupados
    if (has(canales)) {
      const miembrosByCh = {};
      if (has(canalMiembros)) {
        canalMiembros.forEach(m => {
          if (!miembrosByCh[m.canal_id]) miembrosByCh[m.canal_id] = [];
          miembrosByCh[m.canal_id].push(m.usuario_id);
        });
      }
      window.SSData.canalesChat = canales.map(c => ({
        ...c, miembros: miembrosByCh[c.id] || [],
      }));
    }

    // Chat — mensajes (vienen desc por limit, revertir a asc por canal)
    if (has(mensajes)) {
      const chatMap = {};
      mensajes.slice().reverse().forEach(m => {
        const cid = m.canal_id;
        if (!chatMap[cid]) chatMap[cid] = [];
        chatMap[cid].push({
          id:   m.id,
          user: m.usuario_id,
          ts:   m.ts || new Date(m.created_at).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' }),
          text: m.texto || m.contenido || m.text || '',
        });
      });
      window.SSData.mensajesChat = chatMap;
    }

    // Anticipos de cliente (vista con saldo ya calculado)
    if (has(anticipos)) window.SSData.anticipos = anticipos;

    // Movimientos por conciliar SIN ventana de fecha: el badge y los contadores por
    // banco deben reflejar todo, no solo el último año. No se espera (`await`) para
    // no retrasar el pintado; el badge aparece en cuanto llega.
    window.loadMovsPendientes?.();

    // Ventas trabadas (órdenes sin facturar / facturas sin despachar). Una consulta chica que
    // devuelve decenas de filas, no miles; alimenta la Torre de Control y el panel del flujo.
    // Tampoco se espera: es un aviso, no puede retrasar el pintado.
    window.loadDocsTrabados?.();

    // Datos que eran Fase 1 — ahora se cargan en background
    if (has(usuarios))       window.SSData.usuarios     = usuarios;
    if (has(tiposEntrega))   window.SSData.tiposEntrega = tiposEntrega;
    if (has(rolesData))      window.SSData.roles        = rolesData;
    if (has(camposConfigData)) {
      const map = {};
      camposConfigData.forEach(row => { map[row.modulo] = row.config; });
      window.SSData.camposConfig = map;
      if (map.pos) window.__ssCamposConfig = map.pos;
    }
    // Refinar marcas y categorías con las tablas dedicadas (mergeando con lo derivado de productos)
    if (Array.isArray(marcasRows)) {
      window.SSData.marcas = marcasRows.map(m => m.nombre);
    }
    if (has(categorias)) {
      const fromProducts = (window.SSData.productos || []).map(p => p.categoria).filter(Boolean);
      const fromTable = categorias.map(c => c.nombre);
      window.SSData.categorias = [...new Set([...fromTable, ...fromProducts])].sort((a, b) => a.localeCompare(b, 'es'));
    }

    // Catálogo de métodos de pago (CRUD) — por empresa. Se cargan TODOS (los consumidores filtran activo).
    try {
      const { data: metodos } = await window.sb.from('metodos_pago').select('*').eq('empresa_id', e).order('orden');
      if (Array.isArray(metodos)) window.SSData.metodosPago = metodos;
    } catch (err) { console.warn('[loadAppData] metodos_pago:', err?.message || err); }

    // ─── Nombres de cliente: hidratar SOLO los referenciados ──────────────────
    // El catálogo completo (13.096 clientes) ya no se descarga en cada módulo: lo piden
    // únicamente las pantallas que lo LISTAN. Pero muchas pantallas muestran el NOMBRE del
    // cliente de sus filas (CxC, devoluciones, garantías, incidencias, documentos, anticipos,
    // dashboard), y sin catálogo esas celdas saldrían vacías.
    //
    // Acá se juntan los ids que de verdad aparecen en lo que cargó Fase 2 y se traen esos
    // clientes en una sola pasada: son unos cientos (CxC sola tiene 402 distintos de 13.096),
    // así que es ~3% del peso y cubre todas las pantallas de una vez, sin tocar cada módulo.
    try {
      const ids = new Set();
      const add = (arr, ...campos) => (arr || []).forEach(r => campos.forEach(c => { if (r && r[c]) ids.add(r[c]); }));
      add(cxc, 'cliente_id', 'cliente');
      add(docs, 'cliente_id', 'cliente');
      add(devoluciones, 'cliente_id');
      add(incidencias, 'cliente_id');
      add(anticipos, 'cliente_id');
      add(window.SSData.garantias, 'cliente_id');
      const lista = [...ids];
      if (lista.length) {
        // En tandas: `ensureClientes` corta a 500 por llamada (límite del filtro .in()).
        for (let i = 0; i < lista.length; i += 500) await window.ensureClientes(lista.slice(i, i + 500));
        console.log('[Supabase] ✓ Nombres de cliente hidratados por id:', lista.length);
      }
    } catch (err) { console.warn('[loadAppData] hidratación de clientes:', err?.message || err); }

    window.__ssExtrasReady = true;
    window.dispatchEvent(new CustomEvent('ss-data-extra-loaded'));
    console.log('[Supabase] ✓ Fase 2 (extras) —',
      'docs:', (docs || []).length,
      '| cxc:', (cxc || []).length,
      '| msgs:', (mensajes || []).length);
  }

  // ─── Refrescar SOLO la Fase 2, después de guardar algo ───────────────────
  // Casi todas las pantallas llamaban a `loadAppData()` para refrescar lo que acababan de
  // guardar. Eso es un ARRANQUE EN FRÍO COMPLETO: Fase 1 (RPC + 1,8 MB de catálogo de productos)
  // + Fase 2 + la hidratación de clientes por id, con el overlay bloqueante "Actualizando datos…"
  // encima — para reflejar una cuenta bancaria, un proveedor o un cobro.
  //
  // Nada de lo que esas pantallas mutan vive en Fase 1. Cuentas por cobrar y pagar, bancos y sus
  // movimientos, proveedores, vendedores, drivers, incidencias, devoluciones, categorías de
  // cuenta, usuarios, roles, tipos de entrega, anticipos y el chat son TODOS Fase 2: un viaje,
  // 62 ms de servidor, 576 kB. Esto recarga exactamente eso.
  //
  // NO sirve para productos, clientes, inventario, almacenes, listas de precios ni la tasa: esos
  // son Fase 1 y siguen necesitando `loadAppData()`.
  //
  // Va SIN el indicador bloqueante a propósito (no está en la lista de funciones decoradas del
  // final del archivo): la operación ya dio su propia señal al guardarse, y tapar la pantalla
  // medio segundo después es justo lo que se sentía como "el sistema se queda cargando".
  window.refrescarFase2 = async function () {
    const e = window.currentEmpresa || 'demo1';
    try {
      await loadAppDataExtras(e);
      return { ok: true };
    } catch (err) {
      // Que falle el refresco no invalida la operación que YA se guardó bien: se avisa por
      // consola y la pantalla se queda con lo que tiene hasta la próxima carga.
      console.warn('[refrescarFase2]', err?.message || err);
      return { error: err };
    }
  };

  // ─── Generar próximo ID de documento sin colisión ────────────────────────────
  // Seeds altos para quedar siempre por encima de IDs generados aleatoriamente:
  //   COT: antiguo rango 100-999  → seed 1000 → nuevos IDs desde 1001
  //   ORD/FAC/DSP: antiguo rango 2000-2899 → seed 3000 → nuevos IDs desde 3001
  window.nextDocId = async function (prefix) {
    // Primero el asignador ATÓMICO server-side (tabla `correlativos`, sembrada con
    // el máximo real de cada serie/empresa). Dos razones:
    //  1. El escaneo de abajo trae hasta 5.000 ids y toma el máximo: con la serie NDE
    //     —27.143 documentos migrados— eso se rompe en silencio y reasigna números ya
    //     usados. Un correlativo fiscal no puede depender de un LIMIT.
    //  2. Es race-free: dos usuarios facturando a la vez no obtienen el mismo número.
    // Si el RPC falla se cae al escaneo (modo degradado), que sigue sirviendo para las
    // series chicas.
    const atomico = await window.nextCorrelativo?.(prefix);
    if (atomico) return atomico;

    const year = window.caracasYear();  // año de Venezuela
    const pattern = `${prefix}-${year}-%`;
    // Seeds independientes por serie (legibilidad: el id revela la etapa).
    const seed = { COT: 1000, ORD: 3000, FAC: 5000, DSP: 7000 }[prefix] ?? 3000;
    const { data, error } = await window.sb
      .from('documentos').select('id').like('id', pattern).limit(5000);
    if (error) console.warn('[nextDocId] Error consultando IDs:', error);
    let max = seed;
    (data || []).forEach(row => {
      const n = parseInt(row.id.split('-').pop(), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return `${prefix}-${year}-${max + 1}`;
  };

  // ─── Correlativo ATÓMICO server-side (race-free) ─────────────────────────────
  // Por defecto devuelve `${serie}-${año}-${n}` (ej. "DEV-2026-1") usando el RPC
  // siguiente_correlativo (INSERT..ON CONFLICT DO UPDATE RETURNING => sin race
  // y sin choque entre empresas). Devuelve null si el RPC falla, para que el
  // llamador caiga al generador client-side legacy (modo degradado).
  //
  // Series que CONTINÚAN la numeración de Odoo y por eso no llevan año (ver
  // migracion-odoo/10_correlativo_cotizaciones_despachos.sql):
  //   COT → serie 'S', formato S##### (S37921). Contador COMPARTIDO por las dos
  //         empresas, porque en Odoo lo generaba una sola secuencia de sale_order y
  //         los rangos de demo1 y demo2 se entrelazan; con un contador por
  //         empresa, demo2 acabaría pisando un id que demo1 ya usó (y
  //         `documentos.id` es PK). El RPC resuelve el compartido con empresa '*'.
  //   Despachos → no están acá: su serie depende del ALMACÉN (ver nextDespachoId).
  const SERIE_SPEC = {
    COT: { serie: 'S', porAnio: false, fmt: n => 'S' + String(n).padStart(5, '0') },
    // AJUSTE DE INVENTARIO. Pedido de Pedro el 2026-08-12: "al realizar el ajuste no genera ningún
    // documento; sería importante que tuviese un número correlativo para revisión futura". Antes la
    // referencia era `AJU-${Date.now()}` (un epoch, ilegible e imposible de dictar por teléfono) y
    // solo se generaba cuando el ajuste tenía MÁS DE UNA línea — o sea que el ajuste de un solo
    // producto no dejaba ninguna referencia con la cual volver a encontrarlo.
    // Va con año y relleno a 4: `AJU-2026-0001` se lee, se dicta y ordena bien en una lista.
    AJU: { serie: 'AJU', porAnio: true, fmt: (n, year) => `AJU-${year}-` + String(n).padStart(4, '0') },
  };

  window.nextCorrelativo = async function (prefijo) {
    const empresa = window.currentEmpresa || 'demo1';
    const year = window.caracasYear();  // año de Venezuela
    const spec = SERIE_SPEC[prefijo];
    const serie = spec ? spec.serie : prefijo;
    const anio  = (spec && spec.porAnio === false) ? 0 : year;   // 0 = serie sin año
    const { data, error } = await window.sb.rpc('siguiente_correlativo', {
      p_empresa_id: empresa, p_serie: serie, p_anio: anio,
    });
    if (error || data == null) {
      console.warn('[nextCorrelativo] RPC falló, fallback client-side:', error);
      return null;
    }
    return spec ? spec.fmt(data, year) : `${serie}-${year}-${data}`;
  };

  // ─── Id de despacho: continúa la serie de Odoo del ALMACÉN que despacha ──────
  // En Odoo cada tipo de operación tenía su contador: ALT/OUT/21484 (Tienda Solano),
  // ALP/OUT/05199 (Principal), Metal/OUT/03177… El prefijo vigente de cada almacén
  // vive en `almacenes.prefijo_despacho` — es el único lugar donde se puede saber,
  // porque el número lo determina de dónde sale la mercancía, no el tipo de documento.
  // Un almacén sin prefijo (nunca despachó en Odoo) usa la serie propia DSP-{año}-{n}.
  window.nextDespachoId = async function (almacenId) {
    const alm = (window.SSData.almacenes || []).find(a => a.id === almacenId);
    const pref = (alm && alm.prefijo_despacho) || null;
    if (!pref) return window.nextDocId('DSP');
    const empresa = window.currentEmpresa || 'demo1';
    const { data, error } = await window.sb.rpc('siguiente_correlativo', {
      p_empresa_id: empresa, p_serie: String(pref).toUpperCase(), p_anio: 0,
    });
    if (error || data == null) {
      // Degradado a la serie propia antes que arriesgar un número repetido: el id de
      // un despacho es la referencia que el cliente firma al recibir.
      console.warn('[nextDespachoId] RPC falló, cae a la serie DSP:', error);
      return window.nextDocId('DSP');
    }
    return `${pref}-OUT-${String(data).padStart(5, '0')}`;
  };

  // ─── Guardar nueva tasa en DB (INSERT = historial) ─────────────────────────
  // INSERT, NO upsert: la tabla acumula varias filas por día (el cron
  // fetch-bcv-rate inserta 6/día) y `fecha` NO tiene constraint único. El upsert
  // con onConflict:'fecha' fallaba siempre con 42P10 ("no unique or exclusion
  // constraint matching the ON CONFLICT specification"). `id` es serial.
  window.saveTasaToDB = async function (bcv, paralelo, cobertura, vuelto) {
    const { error } = await window.sb.from('tasa_cambio').insert({
      fecha:     window.localDateStr(),
      bcv,
      paralelo,
      cobertura,
      vuelto: vuelto ?? paralelo,
      source:    'manual',
      creado_por: window.__ssCurrentUser?.nombre || null,
    });
    if (error) console.error('[Supabase] Error guardando tasa:', error);
    return !error;
  };

  // ─── Forzar actualización del BCV desde la fuente oficial ──────────────────
  // Invoca la Edge Function fetch-bcv-rate (verify_jwt=false), que consulta
  // vcoud/dolarapi, elige la fuente con timestamp más reciente e inserta una
  // nueva fila en tasa_cambio heredando paralelo/cobertura/vuelto previos.
  // Devuelve { success, data:{ rate, source, sourceUpdatedAt, fetchedAt }, sources }.
  window.refreshBcvFromSource = async function () {
    let res, body;
    try {
      res = await fetch(SUPABASE_URL + '/functions/v1/fetch-bcv-rate', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        SUPABASE_ANON,
          'Authorization': 'Bearer ' + SUPABASE_ANON,
        },
      });
      body = await res.json();
    } catch (e) {
      return { success: false, error: 'No se pudo contactar el servicio de tasa BCV (revisá tu conexión): ' + e.message };
    }
    if (!res.ok || !body?.success) {
      return { success: false, error: body?.error || ('El servicio respondió HTTP ' + res.status) };
    }
    return body;
  };

  // ─── PIN login ────────────────────────────────────────────────────────────
  // PIN login: valida el PIN server-side (Edge Function pin-login) y establece
  // una sesión JWT real. El PIN nunca se consulta desde el cliente.
  window.loginWithPin = async function (pin) {
    if (!pin || pin.length !== 4) return { error: { message: 'PIN inválido' } };
    let res, body;
    try {
      res = await fetch(SUPABASE_URL + '/functions/v1/pin-login', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        SUPABASE_ANON,
          'Authorization': 'Bearer ' + SUPABASE_ANON,
        },
        body: JSON.stringify({ pin }),
      });
      body = await res.json();
    } catch (e) {
      return { error: { message: 'No se pudo contactar el servicio de acceso.' } };
    }
    if (!res.ok) return { error: { message: body?.error || 'PIN incorrecto.' } };
    // Establecer la sesión JWT real (persiste vía supabase-js).
    const { error: sessErr } = await window.sb.auth.setSession({
      access_token:  body.access_token,
      refresh_token: body.refresh_token,
    });
    if (sessErr) return { error: { message: 'No se pudo iniciar sesión: ' + sessErr.message } };
    return { user: body.user };
  };

  window.setUserPin = async function (userId, pin) {
    if (pin && !/^\d{4}$/.test(pin)) return { error: { message: 'El PIN debe tener 4 dígitos.' } };
    // La escritura de `usuarios` vive server-side (admin-users): el cliente nunca
    // escribe pins/roles directamente.
    const r = await window.callAdminUsers('update', { id: userId, fields: { pin: pin || null } });
    return { error: r.error || null };
  };

  // ─── Auth helpers ───────────────────────────────────────────────────────────
  window.authGetSession = async function () {
    const { data } = await window.sb.auth.getSession();
    return data.session;
  };

  window.authSignOut = async function () {
    await window.sb.auth.signOut();
  };

  // Invoca la Edge Function admin-users con el JWT del usuario actual.
  // Centraliza las operaciones privilegiadas (auth.admin.*) que antes corrían
  // en el cliente con la SERVICE_ROLE key.
  window.callAdminUsers = async function (action, params = {}) {
    const { data: { session } } = await window.sb.auth.getSession();
    const token = session?.access_token;
    if (!token) return { error: { message: 'No autenticado. Inicia sesión de nuevo.' } };
    let res, body;
    try {
      res = await fetch(SUPABASE_URL + '/functions/v1/admin-users', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        SUPABASE_ANON,
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({ action, ...params }),
      });
      body = await res.json();
    } catch (e) {
      return { error: { message: 'No se pudo contactar el servicio: ' + e.message } };
    }
    if (!res.ok) return { error: { message: body?.error || ('HTTP ' + res.status) } };
    return body;
  };

  // ─── Corregir el nombre de una persona (en cascada) ─────────────────────────
  // El nombre de una persona NO vive en un solo lado: `documentos.vendedor` y `creado_por`,
  // `actividad_log.usuario_nombre`, `movimientos_inventario.usuario`, `pagos.creado_por`… son
  // TEXTO, y Comisiones y Reportes agrupan por ese texto. Corregir solo la ficha parte a la
  // persona en dos con la mitad de las ventas cada una. Por eso el renombrado va por RPC y toca
  // todas las columnas de actor en una transacción. Ver migracion-odoo/77.
  //
  // NO va por `admin-users`: esa Edge Function tiene una whitelist de campos de `usuarios` y esto
  // no es escribir un campo, es reescribir el historial entero.

  // Grafías con las que una persona aparece hoy (por similitud), con el uso de cada una.
  // Un typo no se detecta solo ('Pachecho' vs 'PACHECO' no normalizan igual): esto SUGIERE y el
  // humano marca cuáles son suyas.
  window.variantesPersona = async function (nombre, { umbral = 0.4 } = {}) {
    const { data, error } = await window.sb.rpc('variantes_persona', {
      p_nombre: String(nombre || '').trim(), p_umbral: umbral,
    });
    if (error) { console.warn('[variantesPersona]', error.message); return { error, variantes: [] }; }
    return { variantes: data || [] };
  };

  // Cuántos registros tocaría el cambio, para avisarlo ANTES de confirmar.
  window.contarReferenciasPersona = async function (nombres) {
    const { data, error } = await window.sb.rpc('contar_referencias_persona', {
      p_nombres: (nombres || []).filter(Boolean),
    });
    if (error) return { error, total: 0, detalle: {} };
    return { total: data?.total || 0, detalle: data?.detalle || {} };
  };

  // El cambio. `nombres` son las grafías anteriores que el humano marcó como de esta persona.
  window.renombrarPersona = async function (nombres, nombreNuevo) {
    const lista = (nombres || []).map(n => String(n || '').trim()).filter(Boolean);
    const nuevo = String(nombreNuevo || '').trim().replace(/\s+/g, ' ');
    if (!lista.length) return { error: { message: 'No se indicó ningún nombre anterior a corregir.' } };
    if (!nuevo) return { error: { message: 'El nombre nuevo no puede estar vacío.' } };
    const { data, error } = await window.sb.rpc('renombrar_persona', {
      p_nombres_actuales: lista, p_nombre_nuevo: nuevo,
    });
    if (error) return { error };
    // El nombre viejo quedó en memoria en media app (documentos ya cargados, vendedores, usuarios).
    // Se parchea en SSData en vez de recargar todo: lo que se ve tiene que coincidir con la base.
    const cambia = v => (lista.includes(v) ? nuevo : v);
    (window.SSData.usuarios   || []).forEach(u => { u.nombre = cambia(u.nombre); });
    (window.SSData.vendedores || []).forEach(v => { v.nombre = cambia(v.nombre); });
    (window.SSData.documentos || []).forEach(d => {
      d.vendedor = cambia(d.vendedor); d.creado_por = cambia(d.creado_por);
    });
    window.dispatchEvent(new Event('ss-data-extra-loaded'));
    return { ok: true, registros: data?.registros || 0, detalle: data?.detalle || {} };
  };

  // Crear usuario en Auth + tabla usuarios (server-side vía admin-users)
  window.authCreateUser = async function ({ email, password, nombre, rol, iniciales, avatar }) {
    const r = await window.callAdminUsers('create', {
      email, password, nombre, rol, iniciales, avatar,
      empresa_id: window.currentEmpresa || 'demo1',
    });
    if (r.error) return { error: r.error };
    return { userId: r.userId, authId: r.authId };
  };

  // Desactivar / reactivar usuario
  window.authToggleUser = async function (authId, activo) {
    const r = await window.callAdminUsers('toggle', { authId, activo });
    if (r.error) return { error: r.error };
    return { ok: true };
  };

  // Reset de contraseña (envía email) — solo disponible con usuario autenticado
  window.authResetPassword = async function (email) {
    const { error } = await window.sb.auth.resetPasswordForEmail(email);
    return { error };
  };

  // Cambio de contraseña directo (admin) — server-side vía admin-users
  window.authSetPassword = async function (authId, newPassword) {
    const r = await window.callAdminUsers('setPassword', { authId, password: newPassword });
    return { error: r.error || null };
  };

  // Una SECCIÓN es un rótulo entre líneas, no mercancía: va con cantidad 0. El `|| 1` de las
  // líneas normales existe porque una cantidad vacía es un error de tipeo y 1 es lo más probable;
  // aplicado a una sección la convertía en "1 unidad" de un sku que no existe, y eso después se
  // cuela en cualquier suma que no filtre `__SECTION__`.
  const esSeccionItem = (i) => i && i.sku === '__SECTION__';
  const cantidadItem  = (i) => esSeccionItem(i) ? 0 : (Math.round(i.qty) || 1);

  // Nombres legibles de los campos de cabecera que puede tocar el compositor — para el detalle
  // de "qué cambió" en el log de actividad (antes/después), no solo la lista de claves.
  const CAMPO_DOC_LABELS = {
    cliente_id: 'Cliente', vendedor: 'Vendedor', creado_por: 'Registrado por',
    observaciones: 'Observaciones', dir_entrega: 'Dirección de entrega',
    dir_factura: 'Dirección de facturación', fecha_entrega: 'Fecha de entrega',
    tipo_entrega: 'Tipo de entrega', zona_delivery: 'Zona de delivery',
    modalidad_pago: 'Modalidad de pago', cobertura_manual: 'Cobertura manual',
    descuento_doc: 'Descuento del documento', terminos: 'Términos', driver_id: 'Chofer',
    almacen_id: 'Almacén', vigencia_dias: 'Vigencia (días)', numero_control: 'Número de control',
  };

  // Diff de líneas entre lo que había (`prevLines`, formato `{sku,nombre,qty,precio,...}`) y lo
  // que se acaba de guardar (`curItems`, mismo formato de entrada que arma el compositor). Sirve
  // para el log de actividad: "el precio de X pasó de $10 a $12", no solo "se editó el documento".
  function diffLineasDocumento(prevLines, curItems) {
    const norm = ls => (ls || []).filter(l => l && l.sku && l.sku !== '__SECTION__');
    const prev = norm(prevLines), cur = norm(curItems);
    const prevBySku = new Map(prev.map(l => [l.sku, l]));
    const curBySku  = new Map(cur.map(l => [l.sku, l]));
    const agregadas = [], eliminadas = [], modificadas = [];
    const num = v => Math.round((parseFloat(v) || 0) * 100) / 100;
    for (const l of cur) {
      const p = prevBySku.get(l.sku);
      const cantN = Math.round(l.qty) || 1, precN = num(l.precio), descN = num(l.descuento);
      if (!p) { agregadas.push({ sku: l.sku, nombre: l.nombre, cantidad: cantN, precio: precN }); continue; }
      const cantP = Math.round(p.qty) || 1, precP = num(p.precio), descP = num(p.descuento);
      const cambios = [];
      if (cantP !== cantN) cambios.push({ campo: 'Cantidad', antes: cantP, despues: cantN });
      if (precP !== precN) cambios.push({ campo: 'Precio', antes: precP, despues: precN });
      if (descP !== descN) cambios.push({ campo: 'Descuento %', antes: descP, despues: descN });
      if (cambios.length) modificadas.push({ sku: l.sku, nombre: l.nombre, cambios });
    }
    for (const l of prev) {
      if (!curBySku.has(l.sku)) eliminadas.push({ sku: l.sku, nombre: l.nombre, cantidad: Math.round(l.qty) || 1, precio: num(l.precio) });
    }
    return { agregadas, eliminadas, modificadas };
  }

  // ─── Guardar documento + items en DB ──────────────────────────────────────
  window.saveDocumento = async function (docData, items) {
    window.invalidateDocCounts && window.invalidateDocCounts(); // conteos del pipeline cambian
    // Generate public slug for cotizacion, orden y factura (por tipo, no estado:
    // con sub-estados estado='creada'/'por_cobrar' y nunca generaría slug).
    let slug = docData.slug || null;
    if (!slug && ['cotizacion', 'orden', 'factura'].includes(docData.tipo)) {
      const clienteNombre = (window.SSData?.clientes || []).find(c => c.id === docData.cliente_id)?.nombre || '';
      const raw = `${docData.tipo}-${clienteNombre}-${docData.id}`;
      slug = raw.normalize('NFD').replace(/[̀-ͯ]/g, '')
               .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }
    const payload = { empresa_id: window.currentEmpresa || 'demo1', ...(slug ? { slug } : {}), ...docData };
    // Una factura nace POR DESPACHAR. La columna tiene default 'no_aplica' y nadie la seteaba
    // al insertar, así que la factura recién emitida mostraba el chip "No aplica" teniendo todas
    // sus unidades pendientes — y en memoria decía `por_despachar` (lo que arma promoverDocumento),
    // de modo que el chip cambiaba al refrescar. Se setea acá para cubrir los dos caminos que
    // crean facturas (el composer y promoverDocumento). El trigger de la DB se encarga después
    // de moverla a parcial/despachada según lo que se despache.
    if (payload.tipo === 'factura' && payload.estado_despacho == null) payload.estado_despacho = 'por_despachar';
    // Y nace POR COBRAR. `estado_cobro` es la columna con la que el server filtra los sub-tabs de la
    // lista de facturas, y quedaba en NULL: la factura recién emitida no aparecía ni en "Por cobrar"
    // ni en "Cobradas" (solo en "Todas") aunque su CxC existiera. El trigger de `cuentas_cobrar`
    // (migracion-odoo/16) la mantiene después; esto la deja bien desde el INSERT.
    if (payload.tipo === 'factura' && payload.estado_cobro == null) payload.estado_cobro = 'por_cobrar';
    // Linaje: un documento RAÍZ (sin origen) se apunta a sí mismo en raiz_id, para que la cadena
    // cotización→orden→factura→despacho comparta raiz_id y el navegador por linaje funcione.
    if (!payload.raiz_id && !payload.documento_origen_id && payload.id) payload.raiz_id = payload.id;
    // ── Última línea de defensa: un documento con MONTO no puede nacer sin líneas ─────────
    // Va ANTES del insert, a propósito: más abajo el bloque de ítems es un `if (length > 0)` que
    // simplemente no hace nada, así que la cabecera quedaba guardada igual y la función reportaba
    // éxito. Así nacieron 3 ventas de agosto con factura sin productos (una cobrada, con su PDF en
    // $0.00). El despacho SÍ puede traer total 0, y un documento en 0 sin líneas no hace daño:
    // lo que se corta es la combinación imposible —hay plata pero no hay qué entregar—.
    if (Number(payload.total) > 0 && !(items || []).some(i => i && i.sku && i.sku !== '__SECTION__')) {
      const msg = `No se guardó ${payload.id}: el documento tiene monto (${payload.total}) pero ninguna línea de producto.`;
      console.error('[saveDocumento]', msg, { tipo: payload.tipo, items });
      return { error: { message: msg } };
    }
    const { data: doc, error: docErr } = await window.sb
      .from('documentos').insert(payload).select().single();
    if (docErr) { console.error('[Supabase] Error guardando documento:', docErr); return { error: docErr }; }

    let insertedLines = null;
    const realItems = (items || []).filter(i => i.sku);
    if (realItems.length > 0) {
      const itemRows = realItems.map(i => ({
        documento_id:    doc.id,
        sku:             i.sku,
        nombre:          i.nombre,
        cantidad:        cantidadItem(i),
        precio_unitario: i.precio,
        descuento:       i.descuento || 0,
        descuento_extra: i.descuento_extra || 0,
        subtotal:        i.subtotal,
        proveedor_id:    i.proveedor_id || null,
        costo:           parseFloat(i.costo) || 0,
        factura_item_id:       i.factura_item_id != null ? parseInt(i.factura_item_id) : null,
        garantia_meses:        (i.garantia_meses != null && i.garantia_meses !== '') ? parseInt(i.garantia_meses) : null,
        garantia_condiciones:  i.garantia_condiciones || null,
      }));
      // `.select()`: hay que devolver las líneas con SU id real de `documentos_items`. Sin eso
      // quien promueve un documento se queda con las líneas del PADRE (ver promoverDocumento) y
      // termina mandando el id de la línea de la cotización como línea de la factura. No cuesta
      // un viaje extra: es el mismo INSERT.
      const { data: inserted, error: itemsErr } = await window.sb.from('documentos_items').insert(itemRows).select();
      if (itemsErr) { console.error('[Supabase] Error guardando items:', itemsErr); return { error: itemsErr }; }
      if (inserted && inserted.length) insertedLines = mapDocItems(inserted);
    }

    const savedLines = insertedLines || (items || []).filter(i => i.sku).map(i => ({
      sku: i.sku, nombre: i.nombre, qty: Math.round(i.qty) || 1,
      precio: parseFloat(i.precio), descuento: i.descuento || 0,
      descuento_extra: i.descuento_extra || 0, subtotal: parseFloat(i.subtotal),
      proveedor_id: i.proveedor_id || null, costo: parseFloat(i.costo) || 0,
      garantia_meses: (i.garantia_meses != null && i.garantia_meses !== '') ? parseInt(i.garantia_meses) : null,
      garantia_condiciones: i.garantia_condiciones || null,
    }));
    window.SSData.documentos = [{ ...doc, cliente: doc.cliente_id, lines: savedLines }, ...(window.SSData.documentos || [])];
    // Se expone en el retorno: promoverDocumento las necesita para no arrastrar las del padre.
    doc.__lines = savedLines;
    window.logActivity?.({
      modulo: 'documentos', accion: 'crear',
      entidad_id: doc.id, entidad_label: doc.id,
      detalles: { tipo: doc.estado, cliente_id: doc.cliente_id, total: doc.total, items: items?.length || 0 }
    });
    return { doc };
  };

  // ─── Cargar documento público por slug (sin auth) ─────────────────────────
  window.loadDocumentoBySlug = async function (slug) {
    // Visor público: una sola RPC SECURITY DEFINER devuelve SOLO este documento
    // (doc + items + marcas + cliente seguro + branding). anon NO tiene SELECT
    // directo sobre documentos/clientes/productos (no se puede enumerar).
    const { data, error } = await window.sb.rpc('get_documento_publico', { p_slug: slug });
    if (error || !data || !data.documento) return { error: error || { message: 'Documento no encontrado' } };
    const marcaBySku = data.marcas || {};
    const doc = {
      ...data.documento,
      cliente: data.documento.cliente_id,
      vendedor_telefono: data.vendedor_telefono || null,
      lines: (data.items || []).map(i => ({
        sku:             i.sku,
        nombre:          i.nombre,
        marca:           marcaBySku[i.sku] || '',
        qty:             i.cantidad,
        precio:          parseFloat(i.precio_unitario) || 0,
        descuento:       parseFloat(i.descuento) || 0,
        descuento_extra: parseFloat(i.descuento_extra) || 0,
        subtotal:        parseFloat(i.subtotal) || 0,
      })),
    };
    return { doc, cliente: data.cliente || null, empresaCfg: data.empresaCfg || null };
  };

  // ─── Lista precios detalle (precios manuales por SKU) ────────────────────
  window.saveListaDetalle = async function (listaId, preciosManuales) {
    const empresa = window.currentEmpresa || 'demo1';
    // Delete existing rows for this lista, then re-insert
    await window.sb.from('lista_precios_detalle').delete().eq('lista_id', listaId);
    const rows = Object.entries(preciosManuales || {})
      .filter(([, precio]) => precio != null && !isNaN(precio))
      .map(([sku, precio]) => ({
        id:         listaId + '-' + sku,
        lista_id:   listaId,
        sku,
        precio:     parseFloat(precio),
        empresa_id: empresa,
      }));
    if (rows.length === 0) return null;
    const { error } = await window.sb.from('lista_precios_detalle').insert(rows);
    return error || null;
  };

  // ─── Devoluciones ─────────────────────────────────────────────────────────
  window.saveDev = async function (dev) {
    const empresa = window.currentEmpresa || 'demo1';
    const payload = {
      id:               dev.id,
      empresa_id:       empresa,
      factura_id:       dev.factura_id || null,
      cliente_id:       dev.cliente_id || null,
      fecha:            dev.fecha || new Date().toISOString(),
      motivo:           dev.motivo || null,
      items:            dev.items || [],
      subtotal:         parseFloat(dev.subtotal) || 0,
      iva:              parseFloat(dev.iva)       || 0,
      total:            parseFloat(dev.total)     || 0,
      almacen_id:       dev.almacen_id || null,
      estado:           dev.estado || 'pendiente',
      nota_credito_id:  dev.nota_credito_id || null,
      reembolso:        dev.reembolso || {},
      notas:            dev.notas || null,
      creado_por:       dev.creado_por || null,
      aprobado_por:     dev.aprobado_por || null,
      fecha_aprobacion: dev.fecha_aprobacion || null,
      motivo_rechazo:   dev.motivo_rechazo || null,
    };
    const { error } = await window.sb.from('devoluciones').upsert([payload]);
    return { error };
  };

  window.deleteDev = async function (ids) {
    if (!ids?.length) return { error: null };
    const { error } = await window.sb.from('devoluciones').delete().in('id', ids);
    return { error };
  };

  // ─── POS Opciones (Fuentes de venta / Tipos de entrega) ─────────────────

  window.savePosOpcion = async function (tabla, item) {
    const payload = { ...item, empresa_id: window.currentEmpresa || 'demo1' };
    const { error } = await window.sb.from(tabla).upsert([payload]);
    return { error };
  };

  window.deletePosOpcion = async function (tabla, id) {
    const { error } = await window.sb.from(tabla).update({ activo: false }).eq('id', id);
    return { error };
  };

  // ─── Drivers / Despachos / Incidencias ───────────────────────────────────

  window.saveDriver = async function (drv) {
    const payload = { ...drv, empresa_id: window.currentEmpresa || 'demo1' };
    const { data, error } = await window.sb.from('drivers').upsert([payload]).select('id').single();
    return { id: data?.id, error };
  };

  window.deleteDriver = async function (id) {
    const { error } = await window.sb.from('drivers').update({ activo: false }).eq('id', id);
    return { error };
  };

  window.saveDriverDespacho = async function (da) {
    const payload = { ...da, empresa_id: window.currentEmpresa || 'demo1' };
    const { error } = await window.sb.from('driver_despachos').upsert([payload]);
    return { error };
  };

  window.deleteDriverDespacho = async function (id) {
    const { error } = await window.sb.from('driver_despachos').delete().eq('id', id);
    return { error };
  };

  window.saveIncidencia = async function (inc) {
    const payload = { ...inc, empresa_id: window.currentEmpresa || 'demo1' };
    const { error } = await window.sb.from('incidencias').upsert([payload]);
    return { error };
  };

  window.deleteIncidencia = async function (id) {
    const { error } = await window.sb.from('incidencias').delete().eq('id', id);
    return { error };
  };

  window.bulkUpdateIncidencias = async function (ids, fields) {
    if (!ids?.length) return { error: null };
    const { error } = await window.sb.from('incidencias').update(fields).in('id', ids);
    return { error };
  };

  // ─── Doc vistas analytics ─────────────────────────────────────────────────
  // Sin servidor real: la RPC-por-REST de abajo también la intercepta el shim de fetch de
  // src/demo/mock-sb.js (mismo motivo que SUPABASE_URL/SUPABASE_ANON más arriba).
  const SUPABASE_URL_PUB = SUPABASE_URL;

  window.logDocVista = async function (docId, empresaId) {
    try {
      // Demo sin backend: no hay geo-IP real (el sistema original consulta ipapi.co). Se registra
      // la vista igual, con un origen ficticio fijo — el analytics de "quién vio el documento" se
      // sigue viendo poblado en pantalla, sin ninguna llamada de red a un tercero.
      const geo = { ip: null, city: 'Caracas', country_name: 'Venezuela', region: 'Distrito Capital' };
      const id = 'vista-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      await window.sb.from('doc_vistas').insert([{
        id,
        doc_id:     docId,
        empresa_id: empresaId || 'demo1',
        ip:         geo.ip         || null,
        ciudad:     geo.city       || null,
        pais:       geo.country_name || null,
        region:     geo.region     || null,
        user_agent: (navigator.userAgent || '').slice(0, 250),
      }]);
      return id;
    } catch (e) {
      return null;
    }
  };

  window.updateDocVistaDuracion = function (vistaId, duracionSeg) {
    if (!vistaId) return;
    // Vía RPC, no UPDATE directo por tabla: un UPDATE de tabla por REST para el rol `anon`
    // no persiste (0 filas, sin error) — efecto de plataforma post-deshabilitar API keys legacy,
    // confirmado con SELECT/INSERT/DELETE funcionando normal para anon y solo UPDATE fallando en
    // cualquier tabla. Las RPC sí andan bien para anon, así que el UPDATE vive en
    // `actualizar_duracion_vista` (SECURITY DEFINER, valida ventana de 2h server-side).
    // keepalive fetch so it survives page unload
    try {
      fetch(SUPABASE_URL_PUB + '/rest/v1/rpc/actualizar_duracion_vista', {
        method:    'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        SUPABASE_ANON,
          'Authorization': 'Bearer ' + SUPABASE_ANON,
        },
        body:      JSON.stringify({ p_id: vistaId, p_duracion_seg: duracionSeg }),
        keepalive: true,
      });
    } catch (e) {}
  };

  window.getDocVistas = async function (docId) {
    const { data } = await window.sb
      .from('doc_vistas')
      .select('*')
      .eq('doc_id', docId)
      .order('created_at', { ascending: false });
    return data || [];
  };

  // ─── Cargar documentos por tipo con sus items ──────────────────────────────
  // Carga documentos por etapa. Incluye también los cancelados cuyo `tipo`
  // original coincide con la etapa solicitada (estado='cancelada', tipo=stage).
  // El filtro de UI decide si mostrarlos u ocultarlos por defecto.
  // Modelo de linaje: cada etapa es un documento independiente (filtra solo por
  // tipo; las canceladas se incluyen y se filtran en cliente por sub-estado).
  // has_child se calcula server-side (query fresca de hijos) para alimentar los
  // tabs Creadas/Convertidas (cotizacion) y Generadas/Facturadas (orden) sin
  // depender de SSData (que tendría timing divergente).
  const CHILD_TYPE = { cotizacion: 'orden', orden: 'factura' };
  // Carga una lista de documentos de un tipo. Post-migración hay ~25k por tipo y PostgREST
  // capa a 1000, así que se ordena por `fecha` DESC para traer las MÁS RECIENTES (antes se
  // ordenaba por created_at, idéntico en toda la data migrada → 1000 arbitrarias). Para
  // encontrar documentos fuera de ese tope se usa búsqueda server-side (opts.search):
  //   opts.search    — texto a buscar en id/vendedor
  //   opts.clienteIds— ids de cliente ya resueltos por nombre/rif en memoria (SSData.clientes)
  //   opts.limit     — tope (default 1000)
  // Mapea filas de documentos_items al shape de líneas que espera la UI.
  function mapDocItems(rows) {
    return (rows || []).map(i => ({
      id:              i.id,
      sku:             i.sku,
      nombre:          i.nombre,
      qty:             i.cantidad,
      precio:          parseFloat(i.precio_unitario),
      descuento:       parseFloat(i.descuento) || 0,
      descuento_extra: parseFloat(i.descuento_extra) || 0,
      subtotal:        parseFloat(i.subtotal),
      proveedor_id:    i.proveedor_id || null,
      costo:           parseFloat(i.costo) || 0,
      cantidad_despachada:   i.cantidad_despachada != null ? parseInt(i.cantidad_despachada) : 0,
      factura_item_id:       i.factura_item_id != null ? parseInt(i.factura_item_id) : null,
      garantia_meses:        i.garantia_meses != null ? parseInt(i.garantia_meses) : null,
      garantia_condiciones:  i.garantia_condiciones || null,
    }));
  }
  // Líneas de UN documento (on-demand, al abrir el detalle). Antes el listado embebía
  // documentos_items(*) para 1000 docs → PostgREST/RLS devolvía 500 (timeout 8s). Ahora el
  // listado trae solo cabeceras (rápido) y las líneas se piden por documento aquí.
  window.loadDocumentoItems = async function (docId) {
    if (!docId) return [];
    const { data, error } = await window.sb.from('documentos_items').select('*')
      .eq('documento_id', docId).order('id');
    if (error) { console.error('[loadDocumentoItems]', error); return []; }
    return mapDocItems(data || []);
  };

  // Columnas de orden válidas server-side (mapeo desde las keys de la UI). Las columnas computadas
  // (cliente nombre, dias) caen a 'fecha' — el orden se afina en el cliente sobre la página.
  const DOC_SORT_COL = { id:'id', fecha:'fecha', total:'total', totalBs:'total', vendedor:'vendedor', items:'items',
    cliente:'cliente_id', cobro:'estado_cobro', envio:'estado_despacho', estado:'tipo_factura', dias:'fecha' };

  // Paginación SERVER-SIDE real: devuelve { rows, total } usando .range(from,to)+{count:'exact'}.
  // Antes capaba a 1000 (la tabla nunca mostraba las 25k facturas ni paginaba más allá). Ahora el
  // total es el real y cada página se pide a Supabase. Todos los filtros/orden/subtab van al server.
  // ─── Clientes que faltan en el catálogo local ──────────────────────────────
  // El catálogo en memoria puede estar incompleto por dos razones: ya no se carga
  // entero al iniciar sesión (es diferido, ver `ensureClientesCatalogo`), y aun
  // cargado queda congelado — un cliente creado después por otro usuario no está.
  // Las listas resuelven el nombre con `clienteMap.get(d.cliente_id)` contra ese
  // catálogo, así que el documento aparecía SIN CLIENTE.
  //
  // Esto trae solo los que faltan y los agrega, así se arregla la lista y también
  // el detalle, el PDF y cualquier otro lugar que lea SSData.
  window.ensureClientes = async function (ids) {
    const faltan = [...new Set((ids || []).filter(Boolean))]
      .filter(id => !(window.SSData.clientes || []).some(c => c.id === id));
    if (!faltan.length) return 0;
    // Sin filtro de empresa ni de activo: si un documento de esta empresa apunta a
    // ese cliente, hay que poder mostrarlo (puede estar desactivado o compartido).
    const { data, error } = await window.sb.from('clientes').select('*').in('id', faltan.slice(0, 500));
    if (error) { console.warn('[ensureClientes]', error.message); return 0; }
    if (!data || !data.length) return 0;
    // mapCliente (el mismo del catálogo) y no un subconjunto a mano: al mapear sólo
    // algunos campos, un cliente hidratado por id quedaba sin `diasCredito` y el POS
    // no le ofrecía ningún plazo de crédito. Ahora que el POS depende de esta vía,
    // un cliente hidratado tiene que ser indistinguible de uno del catálogo.
    mergeClientes(data);
    return data.length;
  };

  // Contactos que faltan, por id. Mismo motivo que `ensureClientes`, y además trae el
  // cliente de cada contacto: el contacto se muestra siempre con su empresa.
  window.ensureContactos = async function (ids) {
    const faltan = [...new Set((ids || []).filter(Boolean))]
      .filter(id => !(window.SSData.contactos || []).some(c => c.id === id));
    if (!faltan.length) return 0;
    const { data, error } = await window.sb.from('contactos').select('*').in('id', faltan.slice(0, 500));
    if (error) { console.warn('[ensureContactos]', error.message); return 0; }
    if (!data || !data.length) return 0;
    mergeContactos(data);
    await window.ensureClientes(data.map(c => c.cliente_id));
    return data.length;
  };

  // Resuelve un id que puede ser de cliente O de contacto (el selector del POS mezcla los
  // dos). Se usa al abrir un borrador guardado o un documento en edición: sin el cliente en
  // memoria el composer no muestra el nombre ni aplica su lista de precios, sus condiciones
  // de crédito ni sus direcciones. Las dos consultas van en paralelo (una vuelve vacía) para
  // no pagar dos viajes seguidos. Avisa por `ss-data-extra-loaded` para que la UI repinte.
  window.ensureClienteOContacto = async function (id) {
    if (!id) return false;
    const yaEsta = (window.SSData.clientes || []).some(c => c.id === id)
                || (window.SSData.contactos || []).some(c => c.id === id);
    if (yaEsta) return true;
    const [nc, nt] = await Promise.all([window.ensureClientes([id]), window.ensureContactos([id])]);
    if (nc || nt) window.dispatchEvent(new CustomEvent('ss-data-extra-loaded'));
    return !!(nc || nt);
  };

  // ─── Habilitar un cliente en la otra empresa (migración 85) ────────────────
  // Comparte la MISMA ficha (agrega la empresa a `clientes.empresas`), no la clona: dos fichas
  // con el mismo RIF es el duplicado que la migración 83 vino a evitar, y partiría el historial
  // del cliente en dos. Lo que es plata o mercancía sigue separado por `empresa_id` —documentos,
  // CxC, CxP, pagos, anticipos, contactos, almacenes— así que habilitarla no mueve nada de una
  // empresa a la otra. Verificado en la migración.
  window.habilitarClienteEnEmpresa = async function (clienteId, empresaId) {
    const { data, error } = await window.sb.rpc('habilitar_cliente_en_empresa', {
      p_cliente_id: clienteId, p_empresa_id: empresaId,
    });
    if (error) { console.error('[habilitarClienteEnEmpresa]', error); return { error }; }
    // Se parcha la ficha en memoria para que el selector de la otra empresa la ofrezca ya, sin
    // recargar: `buscarClientesContactos` filtra por `empresas` contra lo que hay en SSData.
    const cli = (window.SSData.clientes || []).find(c => c.id === clienteId);
    if (cli && Array.isArray(data?.empresas)) cli.empresas = data.empresas;
    window.dispatchEvent(new CustomEvent('ss-data-extra-loaded'));
    return { data };
  };

  // ─── ¿Este cliente ya existe? ──────────────────────────────────────────────
  // Dos reglas distintas, a pedido del usuario (2026-08-18): el **RIF repetido se deniega**
  // (es el mismo cliente) y el **nombre repetido solo avisa** (dos personas pueden llamarse
  // igual — en la base hay CUATRO "CARLOS RODRIGUEZ", cada uno con su cédula).
  //
  // Va al SERVER y no contra `SSData.clientes` porque el catálogo solo se carga en /clientes y
  // /contactos: desde el POS —que es donde más se crean clientes al vuelo— el chequeo corría
  // contra un catálogo casi vacío, así que la regla dura podía no dispararse nunca y dejar
  // entrar un duplicado real. Compara el RIF normalizado: 'V-17299446' y 'V17299446' son la
  // misma cédula.
  //
  // Falla ABIERTA a propósito: si la consulta no responde no se puede probar que haya
  // duplicado, y bloquear un alta por una consulta caída es peor que el duplicado (que además
  // se detecta después con la herramienta de fusión). Se avisa por consola.
  window.buscarDuplicadoCliente = async function ({ nombre, rif, excluirId } = {}) {
    try {
      const { data, error } = await window.sb.rpc('buscar_duplicado_cliente', {
        p_nombre: nombre || null, p_rif: rif || null, p_excluir: excluirId || null,
      });
      if (error) { console.warn('[buscarDuplicadoCliente]', error.message); return { porRif: null, porNombre: null, sinVerificar: true }; }
      return { porRif: data?.por_rif || null, porNombre: data?.por_nombre || null };
    } catch (e) {
      console.warn('[buscarDuplicadoCliente]', e?.message || e);
      return { porRif: null, porNombre: null, sinVerificar: true };
    }
  };

  // ─── Buscar por PALABRAS, no por la cadena entera ──────────────────────────
  // El término se limpia antes de mandarlo (las comas y los paréntesis rompen el `.or()` de
  // PostgREST, y '%' y '_' son comodines de LIKE), pero EL DATO GUARDADO CONSERVA ESOS
  // CARACTERES. Buscar la cadena limpia completa contra el dato sucio no coincide nunca:
  // pegar "SUPPLYPARTS VENEZUELA, C.A." buscaba '%SUPPLYPARTS VENEZUELA C.A.%' contra
  // 'SUPPLYPARTS VENEZUELA, C.A.' y devolvía CERO. No era un cliente: 1.543 clientes activos
  // tienen coma en el nombre y ninguno se encontraba pegando su razón social completa, que es
  // justo lo que uno hace cuando la copia de una factura.
  //
  // Exigiendo TODAS las palabras en vez de la cadena entera, la coma deja de importar — y de
  // paso deja de importar el orden ("perez juan" encuentra a "JUAN PEREZ").
  // `ss_palabras`/`ss_contiene_todas` (migración 82) son el espejo de esto en la base, para que
  // las tarjetas del encabezado cuenten lo mismo que muestra la tabla.
  function palabrasBusqueda(term) {
    return limpiarBusqueda(term).split(' ').filter(Boolean);
  }
  // Filtro PostgREST: (todas las palabras en campo1) OR (todas en campo2) OR …
  function orTodasLasPalabras(campos, palabras) {
    return campos.map(c => palabras.length === 1
      ? `${c}.ilike.*${palabras[0]}*`
      : `and(${palabras.map(w => `${c}.ilike.*${w}*`).join(',')})`).join(',');
  }

  // Ids de clientes que coinciden con un texto, resueltos EN EL SERVER.
  // Las listas de documentos y de cuentas buscan por nombre/RIF de cliente y traducían el texto
  // a ids filtrando `SSData.clientes` en memoria — o sea que necesitaban el catálogo completo
  // (13.096 filas) solo para poder buscar. Con esto la búsqueda funciona sin catálogo.
  window.buscarClienteIds = async function (term, { limit = 300 } = {}) {
    const palabras = palabrasBusqueda(term);
    if (!palabras.length || limpiarBusqueda(term).length < 2) return [];
    const e = window.currentEmpresa || 'demo1';
    const { data, error } = await window.sb.from('clientes').select('id')
      .contains('empresas', [e]).or(orTodasLasPalabras(['nombre', 'rif'], palabras)).limit(limit);
    if (error) { console.warn('[buscarClienteIds]', error.message); return []; }
    return (data || []).map(c => c.id);
  };

  // ─── Catálogo COMPLETO de clientes / contactos — diferido y una sola vez ────
  // Antes se cargaban en el arranque: 13.092 clientes + 13.140 contactos. El POS no
  // los necesita (su selector busca contra el servidor) y era lo más pesado del
  // arranque, así que ahora los pide la ruta que de verdad los lista.
  //
  // La promesa se memoriza: varias pantallas pueden pedirlo a la vez (y el usuario
  // puede navegar rápido entre módulos) y debe resultar en UNA sola descarga.
  // Al terminar se dispara `ss-data-extra-loaded`, que ya re-renderiza el árbol.
  let _catClientes = null, _catContactos = null;
  window.ensureClientesCatalogo = function () {
    if (window.__ssClientesCatalogoReady) return Promise.resolve(window.SSData.clientes || []);
    if (_catClientes) return _catClientes;
    const e = window.currentEmpresa || 'demo1';
    _catClientes = (window.ssBusy ? window.ssBusy.wrap('Cargando clientes…', run) : run())
      .catch(err => { _catClientes = null; console.warn('[ensureClientesCatalogo]', err?.message || err); return window.SSData.clientes || []; });
    return _catClientes;
    async function run() {
      const { data } = await fetchAll(() => window.sb.from('clientes').select('*')
        .eq('activo', true).contains('empresas', [e]).order('nombre'));
      // merge, no reemplazo: preserva los que entraron por `ensureClientes` (pueden
      // estar inactivos o ser de otra empresa y aun así tener documentos acá).
      const total = mergeClientes(data);
      window.__ssClientesCatalogoReady = true;
      window.saveFase1Cache?.();
      window.dispatchEvent(new CustomEvent('ss-data-extra-loaded'));
      console.log('[Supabase] ✓ Catálogo de clientes (diferido):', total);
      return window.SSData.clientes;
    }
  };
  window.ensureContactosCatalogo = function () {
    if (window.__ssContactosCatalogoReady) return Promise.resolve(window.SSData.contactos || []);
    if (_catContactos) return _catContactos;
    const e = window.currentEmpresa || 'demo1';
    _catContactos = (window.ssBusy ? window.ssBusy.wrap('Cargando contactos…', run) : run())
      .catch(err => { _catContactos = null; console.warn('[ensureContactosCatalogo]', err?.message || err); return window.SSData.contactos || []; });
    return _catContactos;
    async function run() {
      const { data } = await fetchAll(() => window.sb.from('contactos').select('*')
        .eq('activo', true).eq('empresa_id', e).order('nombre'));
      const total = mergeContactos(data);
      window.__ssContactosCatalogoReady = true;
      window.dispatchEvent(new CustomEvent('ss-data-extra-loaded'));
      console.log('[Supabase] ✓ Catálogo de contactos (diferido):', total);
      return window.SSData.contactos;
    }
  };

  // ─── Clientes y contactos PAGINADOS server-side ─────────────────────────────
  // Las dos últimas pantallas que bajaban su tabla completa (13.096 y 13.150 filas) para
  // paginar en el navegador. Mismo patrón que `loadDocumentos`: la página, el filtro y el
  // orden se resuelven en la base y vuelve { rows, total }.
  //
  // El texto de búsqueda se limpia igual que en el resto: los comodines de LIKE y los
  // caracteres que parten el `.or()` de PostgREST se cambian por espacios, y los espacios se
  // colapsan (si no, "perez, c.a." queda con dos espacios y no coincide con nada).
  function limpiarBusqueda(term) {
    return String(term || '').trim().replace(/[,()%_\\]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const CLI_SORT = { nombre:'nombre', rif:'rif', tipo:'tipo', ciudad:'ciudad',
                     credito:'limite_credito', deuda:'deuda', ventas:'ventas_ytd', ultima:'ultima_compra' };
  window.loadClientes = async function (opts = {}) {
    const e = window.currentEmpresa || 'demo1';
    const page = Math.max(1, opts.page || 1);
    const pageSize = opts.pageSize || 50;
    const from = (page - 1) * pageSize, to = from + pageSize - 1;
    const term = limpiarBusqueda(opts.search);
    const palabras = palabrasBusqueda(opts.search);
    const aplicar = (q) => {
      q = q.eq('activo', true).contains('empresas', [e]);
      if (opts.tipo) q = q.eq('tipo', opts.tipo);
      if (palabras.length) q = q.or(orTodasLasPalabras(['nombre', 'rif'], palabras));
      return q;
    };
    const col = CLI_SORT[opts.sortCol] || 'nombre';
    const asc = opts.sortDir !== 'desc';
    const [pag, res] = await Promise.all([
      // Mismo criterio que en `loadDocumentos`: `nulls last` no coincide con el orden del índice y
      // obliga a Postgres a ordenar en memoria todo el conjunto filtrado. `nombre` no tiene NULL en
      // las 14.394 filas (verificado), así que en el orden por defecto se omite y el resultado es
      // idéntico. En `rif` sí hay 1.240 nulos: ahí la cláusula se conserva porque cambia lo que se ve.
      aplicar(window.sb.from('clientes').select('*', { count: 'exact' }))
        .order(col, col === 'nombre' || col === 'id' ? { ascending: asc } : { ascending: asc, nullsFirst: false })
        .order('id', { ascending: true }).range(from, to),
      // Las tarjetas del encabezado se agregan en la base con los MISMOS filtros: sumar la
      // página daría un total que no coincide con lo que la tabla dice que hay.
      window.sb.rpc('clientes_resumen', { p_empresa_id: e, p_search: term || null, p_tipo: opts.tipo || null }),
    ]);
    if (pag.error) { console.error('[loadClientes]', pag.error); return { rows: [], total: 0, resumen: null }; }
    const rows = (pag.data || []).map(mapCliente);
    // Se mezclan en SSData: el detalle del cliente, el POS y los PDF siguen leyendo de ahí.
    mergeClientes(pag.data || []);
    const r = Array.isArray(res.data) ? res.data[0] : res.data;
    return {
      rows,
      total: pag.count || 0,
      resumen: r ? { total: Number(r.total) || 0, credito: parseFloat(r.credito) || 0,
                     deuda: parseFloat(r.deuda) || 0, ventasYTD: parseFloat(r.ventas_ytd) || 0 } : null,
    };
  };

  const CON_SORT = { nombre:'nombre', cargo:'cargo', email:'email', telefono:'telefono', cliente:'cliente_id' };
  window.loadContactos = async function (opts = {}) {
    const e = window.currentEmpresa || 'demo1';
    const page = Math.max(1, opts.page || 1);
    const pageSize = opts.pageSize || 50;
    const from = (page - 1) * pageSize, to = from + pageSize - 1;
    const term = limpiarBusqueda(opts.search);
    const palabras = palabrasBusqueda(opts.search);
    const aplicar = (q) => {
      q = q.eq('activo', true).eq('empresa_id', e);
      if (opts.clienteId) q = q.eq('cliente_id', opts.clienteId);
      if (palabras.length) {
        const ors = [orTodasLasPalabras(['nombre', 'email', 'telefono', 'cargo'], palabras)];
        // Buscar por EMPRESA del contacto: el nombre del cliente no está en `contactos`, así que
        // se resuelve a ids en el server y se agrega al OR. Sin esto, buscar por la empresa del
        // contacto no encontraba nada (antes funcionaba porque el catálogo estaba en memoria).
        const ids = opts.clienteIds || [];
        if (ids.length) ors.push(`cliente_id.in.(${ids.slice(0, 300).join(',')})`);
        q = q.or(ors.join(','));
      }
      return q;
    };
    const col = CON_SORT[opts.sortCol] || 'nombre';
    const asc = opts.sortDir !== 'desc';
    // Ver la nota en `loadClientes`: se omite `nulls last` solo en el orden por defecto (`nombre`),
    // donde no hay nulos y por lo tanto el resultado no cambia.
    const { data, count, error } = await aplicar(window.sb.from('contactos').select('*', { count: 'exact' }))
      .order(col, col === 'nombre' || col === 'id' ? { ascending: asc } : { ascending: asc, nullsFirst: false })
      .order('id', { ascending: true }).range(from, to);
    if (error) { console.error('[loadContactos]', error); return { rows: [], total: 0 }; }
    mergeContactos(data || []);
    // Los clientes de estos contactos, para poder mostrar la empresa de cada uno.
    await window.ensureClientes((data || []).map(c => c.cliente_id));
    return { rows: data || [], total: count || 0 };
  };

  // ─── Búsqueda de clientes y contactos CONTRA EL SERVIDOR ───────────────────
  // Lo que usa el selector del POS. Devuelve opciones ya listas para <SearchSelect>
  // y —clave— MEZCLA lo encontrado en SSData: al elegir un cliente, el resto del
  // composer (chips, lista de precios, crédito, dirección, PDF) lo sigue leyendo de
  // SSData.clientes como siempre, sin enterarse de que vino de una búsqueda.
  // `soloClientes`: para los campos que guardan un `cliente_id` de verdad (ej. el dueño
  // de un anticipo). Sin eso se podría elegir un contacto y guardar su id donde va un
  // cliente → violación de FK, o peor, plata atribuida a algo que no es un cliente.
  window.buscarClientesContactos = async function (q, { limit = 25, soloClientes = false, empresaId } = {}) {
    const term = String(q || '').trim();
    if (term.length < 2) return [];
    const e = empresaId || window.currentEmpresa || 'demo1';
    // Por PALABRAS: ver la nota en `palabrasBusqueda`. Sin esto, el selector de cliente del POS
    // tampoco encontraba a nadie con coma en la razón social.
    const palabras = palabrasBusqueda(term);
    if (!palabras.length || limpiarBusqueda(term).length < 2) return [];
    const [rc, rt] = await Promise.all([
      window.sb.from('clientes').select('*').eq('activo', true).contains('empresas', [e])
        .or(orTodasLasPalabras(['nombre', 'rif'], palabras)).order('nombre').limit(limit),
      soloClientes ? Promise.resolve({ data: [] })
        : window.sb.from('contactos').select('*').eq('activo', true).eq('empresa_id', e)
            .or(orTodasLasPalabras(['nombre', 'email', 'telefono'], palabras)).order('nombre').limit(limit),
    ]);
    if (rc.error) console.warn('[buscarClientesContactos] clientes:', rc.error.message);
    if (rt.error) console.warn('[buscarClientesContactos] contactos:', rt.error.message);
    const clientes = rc.data || [], contactos = rt.data || [];
    mergeClientes(clientes);
    mergeContactos(contactos);
    // Un contacto se muestra con el nombre de su empresa: si ese cliente no está en
    // memoria hay que traerlo, o el contacto sale sin empresa y no se puede distinguir
    // de otro homónimo.
    const faltantes = contactos.map(c => c.cliente_id).filter(Boolean);
    if (faltantes.length) await window.ensureClientes(faltantes);
    const nombreDe = id => (window.SSData.clientes || []).find(c => c.id === id)?.nombre || '';
    return [
      ...clientes.map(c => ({ value: c.id, label: c.nombre, sublabel: c.rif, group: 'Clientes' })),
      ...contactos.map(ct => ({ value: ct.id, label: ct.nombre,
        sublabel: `${ct.cargo || ''} · ${nombreDe(ct.cliente_id)}`, group: 'Contactos' })),
    ];
  };

  // ─── Caché de páginas de documentos (localStorage) ──────────────────────────
  // Las listas son 100% server-driven, así que al volver a entrar a un módulo la tabla
  // arrancaba vacía con "Cargando documentos…" aunque fuera la misma página de siempre.
  // Acá se guarda la ÚLTIMA respuesta por combinación (empresa+tipo+página+filtros) para
  // pintarla al instante y refrescar por detrás (stale-while-revalidate): el usuario ve
  // datos de inmediato y un segundo después los frescos, sin pantalla en blanco.
  //
  // NO reemplaza la paginación server-side: se cachea lo que el usuario ya pidió, página
  // por página. Nunca se descarga el universo completo.
  const DOCS_CACHE_KEY  = 'ss-docs-cache';
  const DOCS_CACHE_MAX  = 10;                    // entradas (páginas) que se conservan
  const DOCS_CACHE_TTL  = 12 * 3600 * 1000;      // 12 h
  const DOCS_CACHE_TOPE = 1500000;               // ~1,5 MB de JSON: localStorage son 5 MB
  window.ssDocsCache = {
    // Clave estable: las claves del opts se ordenan, si no {page,tipo} y {tipo,page}
    // generarían dos entradas para la misma consulta.
    key(tipo, opts) {
      const e = window.currentEmpresa || 'demo1';
      const o = {};
      Object.keys(opts || {}).sort().forEach(k => { if (opts[k] !== undefined && opts[k] !== null && opts[k] !== '') o[k] = opts[k]; });
      return 'v1|' + e + '|' + tipo + '|' + JSON.stringify(o);
    },
    _read() {
      try { return JSON.parse(localStorage.getItem(DOCS_CACHE_KEY) || '{}') || {}; }
      catch { return {}; }
    },
    get(key) {
      const all = this._read();
      const hit = all[key];
      if (!hit || !Array.isArray(hit.rows)) return null;
      if (Date.now() - (hit.t || 0) > DOCS_CACHE_TTL) return null;
      return { rows: hit.rows, total: hit.total || 0 };
    },
    set(key, res) {
      if (!res || !Array.isArray(res.rows)) return;
      try {
        const all = this._read();
        all[key] = { t: Date.now(), rows: res.rows, total: res.total || 0 };
        // Poda por antigüedad ANTES de medir: sin esto el caché crece hasta reventar la
        // cuota y a partir de ahí no vuelve a guardar nada (falla en silencio).
        // La entrada que se acaba de guardar va SIEMPRE primero: `Date.now()` tiene resolución
        // de milisegundos, así que dos guardados seguidos empatan y el orden queda a merced de
        // la estabilidad del sort — se llegaba a borrar justo la nueva.
        let claves = Object.keys(all).sort((a, b) => (all[b].t || 0) - (all[a].t || 0));
        claves = [key].concat(claves.filter(k => k !== key));
        claves.slice(DOCS_CACHE_MAX).forEach(k => delete all[k]);
        let txt = JSON.stringify(all);
        while (txt.length > DOCS_CACHE_TOPE && Object.keys(all).length > 1) {
          const masViejo = Object.keys(all).sort((a, b) => (all[a].t || 0) - (all[b].t || 0))[0];
          delete all[masViejo];
          txt = JSON.stringify(all);
        }
        localStorage.setItem(DOCS_CACHE_KEY, txt);
      } catch (err) {
        // Cuota llena u otro problema: se descarta el caché entero y se sigue. Que no se
        // pueda cachear no puede impedir que la lista funcione.
        try { localStorage.removeItem(DOCS_CACHE_KEY); } catch {}
      }
    },
    clear() { try { localStorage.removeItem(DOCS_CACHE_KEY); } catch {} },
  };

  window.loadDocumentos = async function (tipo, opts = {}) {
    const e = window.currentEmpresa || 'demo1';
    const page = Math.max(0, opts.page || 0);
    const pageSize = opts.pageSize || 50;
    const from = page * pageSize, to = from + pageSize - 1;

    // Filtros compartidos entre la query de DATOS y la de CONTEO (misma cláusula WHERE).
    const applyFilters = (q) => {
      q = q.eq('tipo', tipo).eq('empresa_id', e);
      // "Cancelada"/"Anulada" tienen su PROPIA pestaña (reemplazó al checkbox global "Mostrar
      // canceladas" el 2026-08-13, ver SUBTABS en pos.jsx) para poder filtrar SOLO esas — pero
      // "Todas" es todas de verdad: tiene que mostrar el correlativo completo, canceladas/anuladas
      // incluidas (con su badge rojo en la fila), o si no la pestaña miente sobre lo que existe.
      // Las pestañas EN VIVO (creadas/generadas/por_cobrar/...) sí las excluyen siempre.
      if (opts.subTab === 'canceladas')    q = q.eq('estado', 'cancelada');
      else if (opts.subTab === 'anuladas') q = q.eq('estado', 'anulada');
      else if (opts.subTab === 'todas') { /* sin filtro de estado: todo, incluidas canceladas/anuladas */ }
      else                                 q = q.not('estado', 'in', '(cancelada,anulada)');
      if (opts.fechaDesde)  q = q.gte('fecha', opts.fechaDesde);
      if (opts.fechaHasta)  q = q.lte('fecha', opts.fechaHasta);
      if (opts.vendedor)    q = q.eq('vendedor', opts.vendedor);
      if (opts.creadoPor)   q = q.eq('creado_por', opts.creadoPor);
      if (opts.modalidad)   q = q.eq('modalidad_pago', opts.modalidad);
      if (opts.almacen)     q = q.eq('almacen_id', opts.almacen);
      if (opts.tipoEntrega) q = q.eq('tipo_entrega', opts.tipoEntrega);
      if (opts.tipoFactura) q = q.eq('tipo_factura', opts.tipoFactura);
      // Sub-tabs (columnas server-filtrables): has_child (cotización/orden), estado_cobro (factura).
      if (opts.subTab === 'creadas' || opts.subTab === 'generadas')       q = q.eq('has_child', false);
      else if (opts.subTab === 'convertidas' || opts.subTab === 'facturadas') q = q.eq('has_child', true);
      else if (opts.subTab === 'por_cobrar') q = q.in('estado_cobro', ['por_cobrar', 'parcial']);
      else if (opts.subTab === 'cobradas')   q = q.eq('estado_cobro', 'pagada');
      // Despachos: "entregado" es el estado final del documento; el resto está por despachar.
      else if (opts.subTab === 'por_despachar') q = q.neq('estado', 'despachado');
      else if (opts.subTab === 'despachadas')   q = q.eq('estado', 'despachado');
      // Filtro explícito de cobro
      if (opts.cobro === '__sincxc__') q = q.is('estado_cobro', null);
      else if (opts.cobro)             q = q.eq('estado_cobro', opts.cobro);
      // Filtro de envío del despacho (entregado_en columna)
      if (opts.envioEntregado === true)  q = q.not('entregado_en', 'is', null);
      if (opts.envioEntregado === false) q = q.is('entregado_en', null);
      // Búsqueda server-side sobre TODO el universo.
      const term = (opts.search || '').trim().replace(/[(),]/g, ' ').trim();
      if (term) {
        const ors = [`id.ilike.*${term}*`, `vendedor.ilike.*${term}*`];
        const cids = (opts.clienteIds || []).filter(Boolean);
        if (cids.length) ors.push(`cliente_id.in.(${cids.slice(0, 300).join(',')})`);
        q = q.or(ors.join(','));
      }
      // Permiso `documentos_ver_todos`: sin él, un rol solo ve SUS documentos (donde es el
      // vendedor o quien lo cargó) — no toda la empresa. Es un `.or()` APARTE del de búsqueda de
      // arriba: supabase-js encadena cada `.or()` como su propio grupo, así que el resultado es
      // (id/vendedor/cliente ilike) AND (vendedor=yo OR creado_por=yo), no una mezcla de las dos.
      if (opts.soloMios && opts.miNombre) {
        q = q.or(`vendedor.eq.${opts.miNombre},creado_por.eq.${opts.miNombre}`);
      }
      return q;
    };

    // DATOS: solo la página. Sin count → sin `count(*) OVER()` que materializaba las 25k filas
    // (antes ~107 ms + derrame a temp). Ahora es un range simple sobre índice.
    const sortCol = DOC_SORT_COL[opts.sortCol] || 'fecha';
    // Columnas: LAS QUE PINTA LA TABLA (36 de 59). Traer `select(*)` eran 65 kB por página para
    // mostrar la mitad. El detalle no depende de esto: `get_documento_detalle` le devuelve la fila
    // completa en su propio viaje, y `startEdit` la pide antes de editar — sin eso, guardar desde
    // el composer habría borrado observaciones, direcciones y términos que no viajaban.
    const LISTA_COLS = 'id,tipo,estado,fecha,total,items,cliente_id,contacto_id,vendedor,creado_por,almacen_id,modalidad_pago,tipo_entrega,tipo_factura,nro_despacho,fuente,has_child,estado_cobro,estado_despacho,entregado_en,fecha_cobro,cobrado_at,raiz_id,documento_origen_id,slug,odoo_ref,created_at,driver_id,guia_envio,transportista,zona_delivery,fecha_entrega_estimada,comision_estado,empresa_id,cancelado_at,cancelado_por,motivo_cancelacion,version';
    // `nullsFirst: false` es carísimo y casi siempre inútil acá. Un índice `col desc` es
    // `nulls first`: pedir `nulls last` no coincide con el orden del índice, así que Postgres
    // escanea TODO el conjunto filtrado y lo ordena en memoria. Medido sobre facturas de
    // `demo1`: 65 ms y 25.449 filas escaneadas contra 0,31 ms y 51 filas sin la cláusula
    // (top-N heapsort vs. index scan backward). Es la misma lección que ya se había aprendido en
    // la pestaña "Cobrados" (ver más abajo) y que nunca se aplicó a la lista principal, que es la
    // pantalla más abierta del sistema.
    //
    // Solo se omite en las columnas que NO tienen NULL, así el resultado es idéntico. Verificado
    // sobre las 88.480 filas: fecha 0, total 0, created_at 0, estado_despacho 0 nulos; en cambio
    // estado_cobro y tipo_factura tienen 67.718, vendedor 417, items 3.999 y cliente_id 33 — en
    // esas el `nulls last` sí cambia lo que se ve, así que se conserva.
    const SORT_SIN_NULOS = ['fecha', 'id', 'total', 'created_at', 'estado_despacho'];
    const ordenOpts = { ascending: opts.sortDir === 'asc' };
    if (!SORT_SIN_NULOS.includes(sortCol)) ordenOpts.nullsFirst = false;
    // DESEMPATE POR HORA, no por id. `fecha` es un `date`: todo lo del día empata, y el desempate
    // era `id desc` comparado como TEXTO. Eso ordena bien solo mientras los ids sean monótonos, y
    // no lo son: demo2 va por ORD-2026-3 y ORD-2026-4 (su correlativo arrancó de cero), los
    // despachos llevan la serie de su almacén (ALT-OUT-, ALP-…) y lo migrado de Odoo usa S#####.
    // Con ids que no crecen parejo, el documento recién creado se hunde entre los del mismo día:
    // medido el 2026-08-05, una orden de las 20:26 caía en la FILA 19, debajo de una de las 12:52,
    // y el usuario reportó "le doy a convertir orden y no se crea nada" — sí se creaba, no estaba
    // donde miraba. `created_at` no tiene un solo NULL en las 98.063 filas, y el plan no cambia:
    // Incremental Sort sobre el índice de fecha, 0,36 ms contra 0,37 ms del orden anterior.
    let dataQ = applyFilters(window.sb.from('documentos').select(LISTA_COLS)).order(sortCol, ordenOpts);
    if (sortCol !== 'created_at') dataQ = dataQ.order('created_at', { ascending: false });
    dataQ = dataQ.order('id', { ascending: false }).range(from, to);

    // CONTEO: exacto pero barato (HEAD, sin traer filas → puede resolver con index-only scan, ~6 ms).
    // El total sigue siendo el REAL. Se puede saltar en cambios de página (opts.skipCount) reusando el
    // total ya conocido; corre en PARALELO con los datos, así el wall-clock ≈ max(datos, conteo).
    const countP = opts.skipCount
      ? Promise.resolve({ count: null })
      : applyFilters(window.sb.from('documentos').select('id', { count: 'exact', head: true }));

    const [dataRes, countRes] = await Promise.all([dataQ, countP]);
    if (dataRes.error) { console.error('[Supabase] Error cargando documentos:', dataRes.error); return { rows: [], total: 0 }; }
    const rows = (dataRes.data || []).map(d => ({
      ...d,
      cliente: d.cliente_id,
      total:   parseFloat(d.total) || 0,
      has_child: !!d.has_child,
      items:   d.items || 0,
      lines:   [],   // loadDocumentoItems(id) al abrir el detalle
    }));
    const total = opts.skipCount
      ? (typeof opts.knownTotal === 'number' ? opts.knownTotal : (from + rows.length))
      : (countRes.count || 0);

    // Rellenar los clientes de esta página que no estén en el catálogo local
    // (creados por otro usuario después de que arrancó esta sesión). Solo hace
    // una consulta extra cuando de verdad falta alguno.
    await window.ensureClientes(rows.map(r => r.cliente_id));

    return { rows, total };
  };

  // ─── Cuántos documentos matchea la búsqueda, EN CADA ETAPA ────────────────────────────────
  // Pedido: "no salen todas" — reportado con ThunderNet, que en la BD son 5 clientes DISTINTOS
  // con RIF casi igual (dedup pendiente, ver CLAUDE.md). `loadDocumentos` sí trae la página
  // completa contra las 3 con documentos (213 cotizaciones, 122 órdenes…), pero el usuario solo ve
  // la página actual de la etapa en la que está parado — sin un total visible se ve como "faltan".
  // Antes existía `searchStageCounts` en pos.jsx: leía `SSData.documentos` completo, que YA NO SE
  // CARGA (por eso `allDocsLoaded` nunca pasaba de `false` — quedó muerto). Este reemplazo pide
  // 4 HEAD counts en paralelo (uno por etapa), MISMO criterio de búsqueda que `loadDocumentos`
  // (id/vendedor ilike + cliente_id in clienteIds) — barato: index-only scan, sin traer filas.
  window.countDocumentosBusqueda = async function ({ search, clienteIds, soloMios, miNombre } = {}) {
    const term = (search || '').trim().replace(/[(),]/g, ' ').trim();
    if (!term) return null;
    const e = window.currentEmpresa || 'demo1';
    const ors = [`id.ilike.*${term}*`, `vendedor.ilike.*${term}*`];
    const cids = (clienteIds || []).filter(Boolean);
    if (cids.length) ors.push(`cliente_id.in.(${cids.slice(0, 300).join(',')})`);
    const orClause = ors.join(',');
    const tipos = ['cotizacion', 'orden', 'factura', 'despacho'];
    const counts = await Promise.all(tipos.map(tipo => {
      let q = window.sb.from('documentos').select('id', { count: 'exact', head: true })
        .eq('tipo', tipo).eq('empresa_id', e).not('estado', 'in', '(cancelada,anulada)')
        .or(orClause);
      // Mismo permiso `documentos_ver_todos` que `loadDocumentos` — si no, el "total global" del
      // buscador contaría documentos que el rol ni siquiera puede abrir.
      if (soloMios && miNombre) q = q.or(`vendedor.eq.${miNombre},creado_por.eq.${miNombre}`);
      return q.then(r => r.count || 0);
    }));
    return Object.fromEntries(tipos.map((t, i) => [t, counts[i]]));
  };

  // ─── Exportación multi-módulo ("Exportar todo" del POS) ────────────────────
  // Trae TODOS los documentos de varios tipos para volcarlos a un único xlsx. El universo es
  // grande (~87k filas en demo1), así que: se seleccionan SOLO las columnas del reporte (no `*`,
  // que arrastra observaciones/direcciones/comprobantes) y se pagina en oleadas paralelas como
  // fetchAll, reportando avance para la barra de progreso del modal.
  const DOC_EXPORT_COLS = [
    'id', 'tipo', 'fecha', 'cliente_id', 'vendedor', 'creado_por', 'estado', 'estado_cobro', 'items',
    'subtotal', 'iva', 'total', 'tasa_bcv', 'modalidad_pago', 'tipo_entrega', 'tipo_factura',
    'almacen_id', 'fuente', 'nro_despacho', 'entregado_en', 'vencimiento', 'raiz_id',
    'documento_origen_id', 'odoo_ref',
  ].join(',');
  const DOC_EXPORT_TIPOS = ['cotizacion', 'orden', 'factura', 'despacho'];

  // Filtros del export: SOLO tipo/empresa/fecha/canceladas (es un volcado completo del módulo,
  // no la vista filtrada de la lista).
  function docExportFilters(q, tipo, opts) {
    q = q.eq('empresa_id', window.currentEmpresa || 'demo1').eq('tipo', tipo);
    // `showCanceladas` acá significa "incluir lo que ya no está vivo" (canceladas Y anuladas) — el
    // export es un volcado masivo, no necesita la distinción por pestaña que sí tiene la lista.
    if (!opts.showCanceladas) q = q.not('estado', 'in', '(cancelada,anulada)');
    if (opts.fechaDesde) q = q.gte('fecha', opts.fechaDesde);
    if (opts.fechaHasta) q = q.lte('fecha', opts.fechaHasta);
    return q;
  }

  // Conteo exacto por tipo (HEAD, sin traer filas) — alimenta el modal antes de exportar.
  window.countDocumentosExport = async function (opts = {}) {
    const tipos = opts.tipos || DOC_EXPORT_TIPOS;
    const res = await Promise.all(tipos.map(t =>
      docExportFilters(window.sb.from('documentos').select('id', { count: 'exact', head: true }), t, opts)));
    const out = {};
    tipos.forEach((t, i) => {
      if (res[i].error) console.warn('[countDocumentosExport]', t, res[i].error.message);
      out[t] = res[i].error ? 0 : (res[i].count || 0);
    });
    return out;
  };

  // Devuelve { porTipo: { cotizacion: [...], orden: [...] , ... }, total }.
  // El orden (fecha desc, id desc) es determinista → las páginas no se solapan ni dejan huecos.
  window.loadDocumentosExport = async function (opts = {}) {
    const tipos  = opts.tipos || DOC_EXPORT_TIPOS;
    const counts = opts.counts || await window.countDocumentosExport({ ...opts, tipos });
    const total  = tipos.reduce((s, t) => s + (counts[t] || 0), 0);
    const PS = 1000, BATCH = 4;
    const porTipo = {};
    let loaded = 0;
    for (const tipo of tipos) {
      const rows = [];
      const paginas = Math.ceil((counts[tipo] || 0) / PS);
      for (let p = 0; p < paginas; p += BATCH) {
        const reqs = [];
        for (let i = p; i < Math.min(p + BATCH, paginas); i++) {
          reqs.push(docExportFilters(window.sb.from('documentos').select(DOC_EXPORT_COLS), tipo, opts)
            .order('fecha', { ascending: false })
            .order('id', { ascending: false })
            .range(i * PS, i * PS + PS - 1));
        }
        const res = await Promise.all(reqs);
        for (const r of res) {
          if (r.error) { console.warn('[loadDocumentosExport]', tipo, r.error.message); continue; }
          rows.push(...(r.data || []));
        }
        loaded += res.reduce((s, r) => s + ((r.data || []).length), 0);
        opts.onProgress?.({ tipo, loaded, total });
      }
      porTipo[tipo] = rows;
    }
    return { porTipo, total };
  };

  // ─── CxC: resumen agregado (cobrado vs pendiente) server-side ──────────────
  // Las facturas COBRADAS no viven en cuentas_cobrar (solo las pendientes); están en
  // documentos.estado_cobro='pagada'. Este RPC da el % cobrado real y los totales para el header.
  window.getCxcResumen = async function () {
    const e = window.currentEmpresa || 'demo1';
    const { data, error } = await window.sb.rpc('get_cxc_resumen', { p_empresa_id: e });
    if (error) { console.warn('[getCxcResumen]', error.message); return null; }
    return data;
  };

  // ─── Asistente IA: conversaciones + mensajes + invocación de la Edge Function ───────────────
  window.aiListConversaciones = async function () {
    const e = window.currentEmpresa || 'demo1';
    const { data, error } = await window.sb.from('ai_conversaciones')
      .select('*').eq('empresa_id', e).order('updated_at', { ascending: false });
    if (error) { console.warn('[aiListConversaciones]', error.message); return []; }
    return data || [];
  };
  window.aiCrearConversacion = async function (titulo) {
    const e = window.currentEmpresa || 'demo1';
    const cu = window.__ssCurrentUser || {};
    const id = 'CONV-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const row = { id, empresa_id: e, usuario_id: cu.id || null, usuario_nombre: cu.nombre || window.currentUserRole || null, titulo: titulo || 'Nueva conversación' };
    const { data, error } = await window.sb.from('ai_conversaciones').insert(row).select().single();
    if (error) { console.warn('[aiCrearConversacion]', error.message); return null; }
    return data;
  };
  window.aiRenombrarConversacion = async function (id, titulo) {
    await window.sb.from('ai_conversaciones').update({ titulo, updated_at: new Date().toISOString() }).eq('id', id);
  };
  window.aiTocarConversacion = async function (id) {
    await window.sb.from('ai_conversaciones').update({ updated_at: new Date().toISOString() }).eq('id', id);
  };
  window.aiBorrarConversacion = async function (id) {
    const { error } = await window.sb.from('ai_conversaciones').delete().eq('id', id);
    return { error };
  };
  window.aiCargarMensajes = async function (convId) {
    const { data, error } = await window.sb.from('ai_mensajes')
      .select('*').eq('conversacion_id', convId).order('created_at', { ascending: true });
    if (error) { console.warn('[aiCargarMensajes]', error.message); return []; }
    return data || [];
  };
  window.aiGuardarMensaje = async function (convId, rol, contenido, meta) {
    const { data, error } = await window.sb.from('ai_mensajes')
      .insert({ conversacion_id: convId, rol, contenido, meta: meta || null }).select().single();
    if (error) { console.warn('[aiGuardarMensaje]', error.message); return null; }
    return data;
  };
  // Invoca la Edge Function agéntica ai-assistant. Mismo patrón que ai-proxy (fetch + anon key,
  // que es un JWT válido para verify_jwt). Se adjunta el access_token del usuario si hay sesión.
  window.aiPreguntar = async function (messages) {
    const e = window.currentEmpresa || 'demo1';
    try {
      let token = SUPABASE_ANON;
      try { const { data: s } = await window.sb.auth.getSession(); if (s?.session?.access_token) token = s.session.access_token; } catch (_e) {}
      const res = await fetch(SUPABASE_URL + '/functions/v1/ai-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON },
        body: JSON.stringify({ empresa_id: e, messages }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) {
        if (json.error === 'NO_API_KEY') return { error: 'No hay clave de API de Claude configurada (Ajustes → Sistema).' };
        return { error: json.error || ('HTTP ' + res.status) };
      }
      return { answer: json.answer || '', sqls: json.sqls || [] };
    } catch (err) {
      return { error: err?.message || 'Error de conexión con el asistente' };
    }
  };

  // ─── CxC: cargar las cuentas COBRADAS (facturas pagadas) como filas tipo-CxC ────────────────
  // On-demand (solo al abrir la pestaña "Cobrados"), vía fetchAll para traer TODAS (no cap 1000)
  // y permitir orden/agrupación/paginación client-side uniforme con las pendientes.
  window.loadCuentasCobradasAll = async function () {
    const e = window.currentEmpresa || 'demo1';
    const { data } = await window.fetchAll(() => window.sb
      .from('documentos')
      .select('id, cliente_id, total, iva, fecha, vencimiento, modalidad_pago, odoo_ref, fecha_cobro, cobrado_at')
      .eq('tipo', 'factura').eq('empresa_id', e).eq('estado_cobro', 'pagada')
      .order('fecha', { ascending: false }));
    return (data || []).map(f => {
      const monto = parseFloat(f.total) || 0;
      return {
        id: f.id, factura: f.id, cliente: f.cliente_id, cliente_id: f.cliente_id,
        monto, pagado: monto, saldo: 0, estado: 'pagada',
        vence: f.vencimiento || f.fecha, fecha: f.fecha, dias: 0,
        fecha_cobro: f.fecha_cobro || null,
        cobrado_at: f.cobrado_at || null,
        modalidad_pago: f.modalidad_pago || 'divisas', categoria: null,
        odoo_ref: f.odoo_ref || null, iva: parseFloat(f.iva) || 0, _cobrada: true,
      };
    });
  };

  // CxC cobradas PAGINADAS server-side (patrón loadDocumentos): para la vista por defecto de la
  // pestaña "Cobrados" (sin agrupar/buscar). El total real viene por HEAD count barato. Cuando el
  // usuario agrupa/busca/ordena por entidad, AccountsPage usa loadCuentasCobradasAll (necesita todo).
  // `emision` es el orden por defecto de la pestaña "Todas" (ver ordenPorTab en business.jsx).
  // Estaba cayendo al fallback 'fecha' — que da el mismo resultado, pero por casualidad: cualquier
  // campo que la pantalla ofrezca y no esté acá se ordena por fecha sin avisar.
  const _COB_SORT = { vence:'fecha', fecha:'fecha', emision:'fecha', saldo:'total', monto:'total', pagado:'total', progreso:'total', id:'id', factura:'id', modalidad:'modalidad_pago', estado:'fecha', fechaCobro:'fecha_cobro' };
  window.loadCuentasCobradas = async function (opts = {}) {
    const e = window.currentEmpresa || 'demo1';
    const page = Math.max(1, opts.page || 1);
    const pageSize = opts.pageSize || 50;
    const from = (page - 1) * pageSize, to = from + pageSize - 1;
    const applyF = (q) => {
      q = q.eq('tipo', 'factura').eq('empresa_id', e);
      // `incluirPendientes` = pestaña "Todas": cobradas MÁS las que tienen una cuenta abierta en
      // el módulo. `en_cxc` es una columna generada (migración 84) justamente porque el predicado
      // real ("cobrada o con cuenta viva") es un `exists` contra `cuentas_cobrar` y eso no se
      // puede expresar en un filtro de PostgREST — y tenerlo como columna evita que el criterio
      // quede escrito dos veces, una acá y otra en SQL.
      q = opts.incluirPendientes ? q.eq('en_cxc', true) : q.eq('estado_cobro', 'pagada');
      // Fechas y BÚSQUEDA server-side. Antes, con cualquiera de las dos, AccountsPage caía a
      // `loadCuentasCobradasAll` y bajaba las 25.085 facturas cobradas: escanear un código de
      // barras (que escribe y da Enter) disparaba justamente eso. Ahora la consulta se resuelve
      // en el server y devuelve una página.
      // El filtro de la UI dice "Vencimiento desde/hasta" y comparaba `vence`, que para estas
      // filas se arma como `vencimiento || fecha`. Verificado en la BD: las 24.865 facturas
      // cobradas tienen `vencimiento` NULL, o sea que `vence` ES `fecha` siempre — filtrar por
      // `fecha` da el mismo resultado. Si algún día se empiezan a guardar vencimientos, esto hay
      // que revisarlo (PostgREST no puede expresar el coalesce en un filtro).
      if (opts.fechaDesde) q = q.gte('fecha', opts.fechaDesde);
      if (opts.fechaHasta) q = q.lte('fecha', opts.fechaHasta);
      // Rango por FECHA DE COBRO (columna denormalizada `documentos.fecha_cobro`, ver
      // migracion-odoo/16). Es el filtro que tiene sentido en esta pestaña: cuándo entró la plata.
      if (opts.cobroDesde) q = q.gte('fecha_cobro', opts.cobroDesde);
      if (opts.cobroHasta) q = q.lte('fecha_cobro', opts.cobroHasta);
      const term = String(opts.search || '').trim().replace(/[(),]/g, ' ').trim();
      if (term) {
        // Por id de factura (lo que trae el lector) y por cliente, resolviendo el nombre a ids
        // contra el catálogo en memoria — mismo criterio que loadDocumentos.
        const ors = [`id.ilike.*${term}*`];
        const cids = (opts.clienteIds || []).filter(Boolean);
        if (cids.length) ors.push(`cliente_id.in.(${cids.slice(0, 300).join(',')})`);
        q = q.or(ors.join(','));
      }
      return q;
    };
    const sortCol = _COB_SORT[opts.sortField] || 'fecha';
    const asc = opts.sortDir === 'asc';
    // SIN `nullsFirst`: los índices parciales de la pestaña son (empresa_id, fecha desc, id desc) y
    // (empresa_id, fecha_cobro desc, id desc). Pedir `nulls last` no coincide con el orden del
    // índice, así que Postgres tenía que escanear las 25.078 filas y ordenarlas en memoria: 2 s por
    // página. Sin la cláusula el plan camina el índice y corta en 50 → 0,2 ms. Ninguna de las dos
    // columnas es NULL en las cobradas (ver migracion-odoo/16), así que no cambia el resultado.
    // Desempate por HORA dentro del mismo día: `fecha_cobro` y `fecha` son columnas `date`, así que
    // con 40 cobros en una jornada el más reciente podía salir décimo. El instante existe
    // (`cobrado_at` / `created_at`, migración 24) y acá se usa como segunda clave. El índice
    // `idx_docs_cobradas_fcobro_hora` (migración 27) tiene las tres columnas en este orden, así que
    // el plan sigue siendo un Index Scan y no vuelve el sort en memoria de 25 mil filas.
    const tieCol = { fecha_cobro: 'cobrado_at', fecha: 'created_at' }[sortCol] || null;
    let dataQ = applyF(window.sb.from('documentos').select('id, cliente_id, total, iva, fecha, vencimiento, modalidad_pago, odoo_ref, fecha_cobro, cobrado_at, estado_cobro'))
      .order(sortCol, { ascending: asc });
    if (tieCol) dataQ = dataQ.order(tieCol, { ascending: asc });
    dataQ = dataQ.order('id', { ascending: false }).range(from, to);
    const countQ = applyF(window.sb.from('documentos').select('id', { count: 'exact', head: true }));
    const [dataRes, countRes] = await Promise.all([dataQ, countQ]);
    if (dataRes.error) { console.error('[Supabase] Error cargando cobradas paginadas:', dataRes.error); return { rows: [], total: 0 }; }
    // La fila se arma desde la FACTURA, así que solo se puede afirmar lo que la factura sabe. Para
    // una cobrada eso alcanza (saldo 0). Para una con cuenta abierta NO: el monto cobrado vive en
    // `cuentas_cobrar`, y esas 323 filas ya están en memoria — `AccountsPage` las pisa por id.
    // Poner `pagado: monto` en una pendiente diría que está saldada.
    const rows = (dataRes.data || []).map(f => {
      const monto    = parseFloat(f.total) || 0;
      const cobrada  = f.estado_cobro === 'pagada';
      return {
        id: f.id, factura: f.id, cliente: f.cliente_id, cliente_id: f.cliente_id,
        monto, pagado: cobrada ? monto : 0, saldo: cobrada ? 0 : monto,
        estado: cobrada ? 'pagada' : (f.estado_cobro === 'parcial' ? 'parcial' : 'pendiente'),
        vence: f.vencimiento || f.fecha, fecha: f.fecha, dias: 0,
        fecha_cobro: f.fecha_cobro || null,
        cobrado_at: f.cobrado_at || null,
        modalidad_pago: f.modalidad_pago || 'divisas', categoria: null,
        odoo_ref: f.odoo_ref || null, iva: parseFloat(f.iva) || 0, _cobrada: cobrada,
      };
    });
    return { rows, total: countRes.count || 0 };
  };

  // (loadDocumentosAll eliminado: código muerto — capaba a 1000 y la búsqueda ahora es
  //  server-side dentro de loadDocumentos(tipo, {search}).)

  // ─── Actualizar documento + reemplazar items ──────────────────────────────
  // `prevDocHint` (opcional): el documento COMPLETO desde el que se está editando (el `editingDoc`
  // del compositor, ya trae `.lines` vía `cargarDocumentoCompleto` en `startEdit`). Sin esto se caía
  // a `SSData.documentos`, que casi nunca tiene el documento (no se carga en el arranque, ver
  // CLAUDE.md) o lo tiene proyectado con `lines:[]` — el diff de "qué cambió" para el log de
  // actividad comparaba contra nada y marcaba TODAS las líneas como si fueran nuevas.
  window.updateDocumento = async function (docId, docData, items, prevDocHint) {
    // ── Candado: no se edita un documento cuya etapa siguiente ya existe ──────────
    // Regla del negocio: cotización → orden → factura → despacho; el que ya tiene hijo vivo queda
    // congelado y lo que se corrige es el hijo. La UI ya esconde el botón, pero eso no alcanza: el
    // compositor puede estar abierto desde ANTES de la conversión (otra pestaña, otro usuario), y en
    // ese caso la fila que tiene en memoria dice `has_child: false` con toda sinceridad. Es el mismo
    // motivo por el que `hijosVivosDe` existe para promover.
    //
    // Se pregunta por los hijos REALES en vez de leer `has_child`: la columna la mantiene un trigger
    // y acá estamos justo en el momento de decidir si se pisa contenido — vale el viaje.
    //
    // Falla CERRADA, igual que `validarStockFacturar`: si no se puede verificar, no se guarda.
    // Dejar pasar la edición de un documento que quizá ya está convertido es exactamente el daño
    // que este candado viene a evitar, y se manifiesta callado (dos documentos que dicen cosas
    // distintas y nadie se entera hasta que el cliente reclama).
    {
      const { data: hijos, error: hijoErr } = await window.sb.from('documentos')
        .select('id, tipo')
        .eq('documento_origen_id', docId)
        .not('estado', 'in', '(cancelada,anulada)')
        .limit(1);
      if (hijoErr) {
        console.error('[updateDocumento] No se pudo verificar el linaje:', hijoErr);
        return { error: { message: 'No se pudo verificar si este documento ya avanzó de etapa. No se guardó nada — probá de nuevo.' } };
      }
      if (hijos && hijos.length) {
        const h = hijos[0];
        const rotulo = { orden: 'una orden', factura: 'una factura', despacho: 'un despacho' }[h.tipo] || 'un documento';
        return { error: { message: `Este documento ya generó ${rotulo} (${h.id}) y no se puede editar. Corregí ${h.id}.`, hijo: h } };
      }
    }

    // Snapshot previo para reconciliar reservas de inventario (solo las ÓRDENES reservan stock).
    const prevDoc     = prevDocHint || (window.SSData.documentos || []).find(d => d.id === docId);
    const prevLines   = (prevDoc?.lines || []).slice();
    const prevAlmacen = prevDoc?.almacen_id || null;
    const tipoDoc     = prevDoc?.tipo || docData.tipo || null;
    // No actualizar campos inmutables (id, fecha, created_at)
    const { id, fecha, created_at, ...updateFields } = docData;
    const { error: docErr } = await window.sb
      .from('documentos').update(updateFields).eq('id', docId);
    if (docErr) { console.error('[Supabase] Error actualizando documento:', docErr); return { error: docErr }; }

    // Reemplazar items: borrar los anteriores e insertar los nuevos
    const { error: delErr } = await window.sb.from('documentos_items').delete().eq('documento_id', docId);
    if (delErr) console.warn('[Supabase] Aviso borrando items:', delErr);
    // Las SECCIONES (`__SECTION__`) son líneas del documento como cualquier otra: separan el
    // presupuesto en bloques ("UPS 6KVA 220VAC", "ALTERNATIVAS DE UPS 2KVA") y el PDF las imprime
    // como banda gris. Acá se filtraban, así que EDITAR un documento las borraba en silencio —
    // este bloque borra todos los ítems y reinserta— y por eso no había NI UNA fila `__SECTION__`
    // en toda la base: el vendedor las ponía, guardaba, y el PDF salía sin ellas.
    const realItems = (items || []).filter(i => i.sku);
    if (realItems.length > 0) {
      const itemRows = realItems.map(i => ({
        documento_id:    docId,
        sku:             i.sku,
        nombre:          i.nombre,
        cantidad:        cantidadItem(i),
        precio_unitario: i.precio,
        descuento:       i.descuento || 0,
        descuento_extra: i.descuento_extra || 0,
        subtotal:        i.subtotal,
        proveedor_id:    i.proveedor_id || null,
        costo:           parseFloat(i.costo) || 0,
        garantia_meses:        (i.garantia_meses != null && i.garantia_meses !== '') ? parseInt(i.garantia_meses) : null,
        garantia_condiciones:  i.garantia_condiciones || null,
      }));
      const { error: itemsErr } = await window.sb.from('documentos_items').insert(itemRows);
      if (itemsErr) { console.error('[Supabase] Error actualizando items:', itemsErr); return { error: itemsErr }; }
    }

    // ── Reconciliar reservas de inventario al editar una ORDEN ───────────────
    // Una orden reserva stock al crearse. Si al editarla se baja una cantidad o se elimina un
    // ítem, hay que LIBERAR el reservado sobrante; si sube o se agrega, RESERVAR la diferencia.
    // Sin esto quedaban reservas huérfanas (stock que aparece comprometido sin orden que lo use).
    // Las cotizaciones NO reservan, así que se omiten. prevDoc requerido para conocer el delta.
    if (tipoDoc === 'orden' && prevDoc) {
      const sumBySku = (ls) => {
        const m = {};
        (ls || []).filter(l => l.sku && l.sku !== '__SECTION__').forEach(l => {
          const q = Math.round(l.qty != null ? l.qty : l.cantidad) || 0;
          if (q > 0) m[l.sku] = (m[l.sku] || 0) + q;
        });
        return m;
      };
      const oldMap = sumBySku(prevLines);
      const newMap = sumBySku(realItems);
      const newAlmacen = updateFields.almacen_id || prevAlmacen;
      // Aplica y PROPAGA el error del upsert (RLS/red): si la reserva falla, el caller debe
      // enterarse en vez de quedar con el reservado inconsistente en silencio.
      const aplicar = async (its, alm, modo) => {
        if (!its.length || !alm) return null;
        const r = await window.reservarInventario(its, alm, modo);
        return r?.error || null;
      };
      let recErr = null;
      if (prevAlmacen && newAlmacen && prevAlmacen !== newAlmacen) {
        // Cambió el almacén: liberar todo en el origen anterior y reservar todo en el nuevo.
        recErr = await aplicar(Object.entries(oldMap).map(([sku, qty]) => ({ sku, qty })), prevAlmacen, 'liberar');
        if (!recErr) recErr = await aplicar(Object.entries(newMap).map(([sku, qty]) => ({ sku, qty })), newAlmacen, 'reservar');
      } else if (newAlmacen) {
        // Mismo almacén: aplicar el delta por SKU.
        const skus = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
        const toReserve = [], toLiberate = [];
        skus.forEach(sku => {
          const delta = (newMap[sku] || 0) - (oldMap[sku] || 0);
          if (delta > 0) toReserve.push({ sku, qty: delta });
          else if (delta < 0) toLiberate.push({ sku, qty: -delta });
        });
        recErr = await aplicar(toLiberate, newAlmacen, 'liberar');
        if (!recErr) recErr = await aplicar(toReserve, newAlmacen, 'reservar');
      }
      if (recErr) { console.error('[updateDocumento] Error reconciliando reservas:', recErr); return { error: recErr }; }
    }

    // Actualizar caché local (incluye lines para que detail view no quede stale)
    const newLines = realItems.map(i => ({
      sku: i.sku, nombre: i.nombre, qty: Math.round(i.qty) || 1,
      precio: i.precio, descuento: i.descuento || 0,
      descuento_extra: i.descuento_extra || 0, subtotal: i.subtotal,
      proveedor_id: i.proveedor_id || null, costo: parseFloat(i.costo) || 0,
      garantia_meses: (i.garantia_meses != null && i.garantia_meses !== '') ? parseInt(i.garantia_meses) : null,
      garantia_condiciones: i.garantia_condiciones || null,
    }));
    window.SSData.documentos = window.SSData.documentos.map(d =>
      d.id === docId
        ? { ...d, ...updateFields, cliente: updateFields.cliente_id, lines: newLines, items: newLines.filter(i => i.sku !== '__SECTION__').reduce((s, i) => s + (Math.round(i.qty) || 1), 0) }
        : d
    );
    // Antes/después de la cabecera: solo los campos que de verdad cambiaron, y solo si había un
    // `prevDoc` con qué comparar (si no está en memoria — ver CLAUDE.md, la mayoría de rutas no
    // cargan el catálogo de documentos — se cae a la lista de claves de antes, sin inventar valores).
    const camposCambiados = prevDoc
      ? Object.keys(updateFields)
          .filter(k => k !== 'lines' && JSON.stringify(prevDoc[k] ?? null) !== JSON.stringify(updateFields[k] ?? null))
          .map(k => ({ campo: CAMPO_DOC_LABELS[k] || k, antes: prevDoc[k] ?? null, despues: updateFields[k] ?? null }))
      : null;
    const diffLineas = diffLineasDocumento(prevLines, realItems);
    window.logActivity?.({
      modulo: 'documentos', accion: 'editar',
      entidad_id: docId, entidad_label: docId,
      detalles: {
        campos: camposCambiados && camposCambiados.length ? camposCambiados : undefined,
        campos_modificados: camposCambiados ? undefined : Object.keys(updateFields),
        lineas_agregadas:   diffLineas.agregadas.length   ? diffLineas.agregadas   : undefined,
        lineas_eliminadas:  diffLineas.eliminadas.length  ? diffLineas.eliminadas  : undefined,
        lineas_modificadas: diffLineas.modificadas.length ? diffLineas.modificadas : undefined,
        items: items?.length || 0,
      }
    });
    return { ok: true };
  };

  // ─── Actualizar campos internos de un item (proveedor_id, costo) ─────────
  window.updateItemInterno = async function (docId, sku, fields) {
    const { error } = await window.sb
      .from('documentos_items')
      .update(fields)
      .eq('documento_id', docId)
      .eq('sku', sku);
    if (error) { console.error('[Supabase] Error actualizando item interno:', error); return { error }; }
    // Actualizar caché local
    window.SSData.documentos = window.SSData.documentos.map(d => {
      if (d.id !== docId) return d;
      return { ...d, lines: (d.lines || []).map(l => l.sku === sku ? { ...l, ...fields } : l) };
    });
    return { ok: true };
  };

  // ─── Cancelar documento (estado='cancelada' con trazabilidad) ─────────────
  // Flujo NUEVO, separado de eliminación. Bloqueable por permiso pos.cancelar.
  // Libera S/N asociados al doc (si los hubo) y registra motivo + usuario + timestamp.
  // `opts.estado` permite reutilizar TODA esta mecánica (RPC atómica de despacho, cascada de
  // despachos hijos de una factura, liberar seriales, liberar reserva) para "anular" factura/despacho
  // sin duplicar código: anular es exactamente esto + estado='anulada' en vez de 'cancelada', más los
  // efectos propios de una anulación (CxC, devolución automática) que agrega `window.anularDocumento`.
  window.cancelarDocumento = async function (id, motivo, currentUser, opts = {}) {
    if (!id) return { error: { message: 'ID requerido' } };
    if (!motivo || String(motivo).trim().length < 10) {
      return { error: { message: 'Motivo de cancelación requerido (mínimo 10 caracteres)' } };
    }
    // Se relee SIEMPRE de la BASE (nunca de SSData.documentos): la mayoría de las rutas no cargan
    // el catálogo global de documentos (ver CLAUDE.md — CxC, la lista de facturas, etc. NO lo
    // traen), así que `prevDoc` salía `undefined` ahí y TODO lo que depende de él —cascada a
    // despachos hijos, liberar seriales, liberar el hold de inventario— se saltaba en silencio: la
    // factura quedaba "cancelada" en el nombre nomás, con su CxC y su inventario intactos. Bug
    // real encontrado el 2026-08-14 (factura NDE-2026-646 de demo2). También sirve de guard de
    // idempotencia (si ya está cancelada/anulada, no repite efectos).
    const { data: freshDoc, error: eFresh } = await window.sb.from('documentos').select('*').eq('id', id).maybeSingle();
    if (eFresh) return { error: eFresh };
    if (!freshDoc) return { error: { message: 'Documento no encontrado.' } };
    if (freshDoc.estado === 'cancelada' || freshDoc.estado === 'anulada') {
      return { ok: true, skipped: true };
    }
    window.invalidateDocCounts && window.invalidateDocCounts();
    const usuarioNombre = (currentUser?.nombre || currentUser?.email || window.__ssCurrentUser?.nombre || window.currentUserRole || 'desconocido');
    const estadoFinal = opts.estado || 'cancelada';
    const accionLog = opts.accion || 'cancelar';

    // Snapshot del estado previo para auditoría — y los ítems reales (no los que vinieran de
    // SSData) para poder liberar seriales/reserva con la cantidad exacta de la BASE.
    const { data: itemsFrescos } = await window.sb.from('documentos_items').select('*').eq('documento_id', id);
    const prevDoc = {
      ...freshDoc,
      lines: (itemsFrescos || []).filter(i => i.sku && i.sku !== '__SECTION__').map(i => ({
        sku: i.sku, qty: i.cantidad, cantidad: i.cantidad, cantidad_despachada: i.cantidad_despachada,
      })),
    };
    const estadoPrevio = prevDoc.estado || null;
    const tipoDoc = prevDoc.tipo || null;
    const motivoTxt = String(motivo).trim();

    // Despacho → RPC atómica: restaura inventario simétrico (cantidad+reservado) y libera seriales
    if (tipoDoc === 'despacho') {
      const r = await window.cancelarDespacho(id, motivoTxt, usuarioNombre, accionLog);
      if (r.error) { console.error('[Supabase] Error cancelando despacho:', r.error); return { error: r.error }; }
      // La RPC escribe estado='cancelada' (es lo que sabe hacer); si se pidió 'anulada' se ajusta
      // acá con un UPDATE aparte — la reversa atómica de inventario/seriales no se toca.
      if (estadoFinal !== 'cancelada') {
        const { error: eEst } = await window.sb.from('documentos').update({ estado: estadoFinal }).eq('id', id);
        if (eEst) { console.error('[Supabase] Error ajustando estado de despacho anulado:', eEst); return { error: eEst }; }
      }
      const patchD = { estado: estadoFinal, cancelado_por: usuarioNombre, cancelado_at: new Date().toISOString(), motivo_cancelacion: motivoTxt };
      if (window.SSData?.documentos) {
        window.SSData.documentos = window.SSData.documentos.map(d => d.id === id ? { ...d, ...patchD } : d);
      }
      // Reflejar restauración local de inventario (la RPC ya lo hizo en DB)
      const almD = prevDoc?.almacen_id;
      if (almD && window.SSData.inventario) {
        (prevDoc.lines || []).filter(l => l.sku && l.sku !== '__SECTION__').forEach(l => {
          const inv = (window.SSData.inventario[l.sku] || {})[almD];
          if (inv) { const q = Math.round(l.qty || l.cantidad) || 0; inv.cantidad = (inv.cantidad || 0) + q; inv.reservado = (inv.reservado || 0) + q; }
        });
      }
      window.dispatchEvent(new CustomEvent('ss-doc-version-bump', { detail: { id: prevDoc?.documento_origen_id, despachoId: id } }));
      return { ok: true, doc: { ...(prevDoc || {}), id, ...patchD } };
    }

    const nowIso = new Date().toISOString();
    const patch = {
      estado: estadoFinal,
      cancelado_por: usuarioNombre,
      cancelado_at: nowIso,
      motivo_cancelacion: motivoTxt,
    };
    const { error } = await window.sb.from('documentos').update(patch).eq('id', id);
    if (error) { console.error('[Supabase] Error cancelando documento:', error); return { error }; }

    // Cascada: si es una FACTURA con despachos activos, cancelarlos/anularlos primero (mismo
    // estado final que la factura — un despacho "cancelado" de una factura "anulada" leería raro).
    // cancelarDespacho (RPC) restaura inventario simétrico (cantidad+reservado) y
    // libera los S/N del despacho (cuyo documento_id = despachoId, no el de la factura).
    // Sin esto, el stock físico despachado quedaba descontado para siempre, los S/N
    // seguían 'vendido' y las notas de despacho quedaban huérfanas (bug #23).
    let despachosCancelados = 0;
    if (tipoDoc === 'factura') {
      try {
        // soloDirectos: cancelar únicamente los despachos nacidos de ESTA factura (flujo nativo).
        // NUNCA los hermanos por raiz_id (pertenecen a otra factura de la misma orden que sigue viva).
        const hijos = await window.getDespachosDeFactura?.(id, { soloDirectos: true }) || [];
        for (const dsp of hijos) {
          const rd = await window.cancelarDespacho(dsp.id, `${accionLog === 'anular' ? 'Anulación' : 'Cancelación'} de factura ${id}: ${motivoTxt}`, usuarioNombre, accionLog);
          if (rd?.error) { console.error('[cancelarDocumento] Error cancelando despacho hijo:', dsp.id, rd.error); return { error: rd.error }; }
          if (estadoFinal !== 'cancelada') {
            const { error: eEstD } = await window.sb.from('documentos').update({ estado: estadoFinal }).eq('id', dsp.id);
            if (eEstD) { console.error('[cancelarDocumento] Error ajustando estado de despacho hijo:', dsp.id, eEstD); return { error: eEstD }; }
          }
          despachosCancelados++;
          // Reflejar restauración local de inventario del despacho hijo (la RPC ya lo hizo en DB)
          const almD = dsp.almacen_id || prevDoc?.almacen_id;
          if (almD && window.SSData.inventario) {
            (dsp.lines || []).filter(l => l.sku && l.sku !== '__SECTION__').forEach(l => {
              const inv = (window.SSData.inventario[l.sku] || {})[almD];
              if (inv) { const q = Math.round(l.qty || l.cantidad) || 0; inv.cantidad = (inv.cantidad || 0) + q; inv.reservado = (inv.reservado || 0) + q; }
            });
          }
          if (window.SSData?.documentos) {
            window.SSData.documentos = window.SSData.documentos.map(d => d.id === dsp.id ? { ...d, estado: estadoFinal } : d);
          }
        }
      } catch (e) { console.error('[cancelarDocumento] aviso cancelando despachos hijos:', e); return { error: { message: 'No se pudieron cancelar los despachos de la factura: ' + (e?.message || e) } }; }
    }

    // Liberar S/N asignados a este doc (BR-INV-S06)
    let serialesLiberados = 0;
    try {
      const { data: snAsignados } = await window.sb.from('inventario_seriales')
        .select('id').eq('documento_id', id);
      const snIds = (snAsignados || []).map(s => s.id);
      if (snIds.length > 0) {
        await window.liberarSeriales?.({ serialIds: snIds, motivo: `Cancelación de documento ${id}` });
        serialesLiberados = snIds.length;
      }
    } catch (e) { console.warn('[cancelarDocumento] aviso liberando seriales:', e); }

    // Liberar reserva de inventario: orden = todo lo reservado.
    // factura SIN despachos cancelados en cascada = solo el PENDIENTE (lo despachado ya
    //   descontó su reservado de forma permanente, no hay que liberarlo de nuevo).
    // factura CON despachos cancelados en cascada = TODO el qty: cada cancelarDespacho ya
    //   restauró (sumó de vuelta) el reservado de la porción despachada, así que ahora el
    //   reservado vivo equivale al qty completo y debe liberarse íntegro (bug #23: evita
    //   dejar reservado huérfano = qty despachado tras la cascada).
    if ((tipoDoc === 'orden' || tipoDoc === 'factura') && prevDoc?.almacen_id && Array.isArray(prevDoc.lines)) {
      const liberarTodo = tipoDoc === 'orden' || despachosCancelados > 0;
      const aLiberar = prevDoc.lines
        .filter(l => l.sku && l.sku !== '__SECTION__')
        .map(l => ({ sku: l.sku, qty: liberarTodo ? (Math.round(l.qty) || 0) : Math.max(0, (Math.round(l.qty) || 0) - (l.cantidad_despachada || 0)) }))
        .filter(l => l.qty > 0);
      if (aLiberar.length) await window.reservarInventario(aLiberar, prevDoc.almacen_id, 'liberar');
    }

    // Actualizar caché local
    if (window.SSData?.documentos) {
      window.SSData.documentos = window.SSData.documentos.map(d => d.id === id ? { ...d, ...patch } : d);
    }

    window.logActivity?.({
      modulo: 'pos', accion: accionLog,
      entidad_id: id, entidad_label: id,
      detalles: { motivo: patch.motivo_cancelacion, estado_previo: estadoPrevio, cancelado_por: usuarioNombre, seriales_liberados: serialesLiberados, despachos_cancelados: despachosCancelados }
    });

    return { ok: true, doc: { ...(prevDoc || {}), id, ...patch } };
  };

  // ─── Anular factura/despacho: reemplaza al viejo "Eliminar" (hard-delete + papelera) ───────
  // Antes, anular una factura BORRABA la fila (`anularFacturas`, ahora retirado): el correlativo
  // quedaba con huecos invisibles y un bug de select-incompleto dejaba la devolución automática sin
  // cliente_id (13 casos encontrados el 2026-08-13). Ahora "anular" reutiliza TODA la mecánica de
  // `cancelarDocumento` (RPC atómica de despacho, cascada de despachos hijos, liberar seriales y
  // reserva) con `estado='anulada'` — el documento SIGUE VIVO en la tabla, nunca va a papelera, y
  // aparece en su propia pestaña "Anuladas" de la lista (ver SUBTABS en pos.jsx).
  //
  // A diferencia de cancelar, anular además: (a) puede tener un pago de banco ya registrado — hace
  // falta `opcionPago` ('eliminar' | 'desvincular') para decidir qué hacer con él ANTES de anular, y
  // (b) borra la CxC y crea la devolución automática (una factura anulada no debe seguir generando
  // cobranza, y lo vendido/despachado se documenta como devuelto).
  //
  // Relee la fila COMPLETA por id en vez de confiar en lo que le pasa el llamador — es justo lo que
  // eliminó la clase de bug del `cliente_id` faltante (antes cada caller armaba su propio `select`
  // parcial).
  window.anularDocumento = async function (id, motivo, currentUser, opcionPago) {
    if (!id) return { error: { message: 'ID requerido' } };
    const { data: doc, error: eDoc } = await window.sb.from('documentos').select('*').eq('id', id).maybeSingle();
    if (eDoc) return { error: eDoc };
    if (!doc) return { error: { message: 'Documento no encontrado (puede que ya haya sido anulado).' } };
    if (doc.tipo !== 'factura' && doc.tipo !== 'despacho') {
      return { error: { message: 'Anular solo aplica a facturas y despachos. Para cotizaciones/órdenes usá Cancelar.' } };
    }

    // ¿Hay un pago de banco ya registrado contra este documento? Si sí, hace falta decidir qué
    // hacer con él ANTES de tocar nada — por eso esto corre primero y no al final.
    const { data: movs, error: eMov } = await window.sb.from('movimientos_bancarios')
      .select('id, monto, conciliado').eq('documento_id', id);
    if (eMov) return { error: eMov };
    if (movs && movs.length) {
      if (!opcionPago) {
        return { pagoAsociado: movs, error: { message: 'Este documento tiene un pago registrado en banco. Elegí qué hacer con él antes de anular.' } };
      }
      const infoDesvinculo = {
        por: currentUser?.nombre || currentUser?.email || window.__ssCurrentUser?.nombre || 'desconocido',
        en: new Date().toISOString(),
        motivo: `Anulación de ${id}: ${motivo}`,
      };
      for (const m of movs) {
        const r = opcionPago === 'eliminar'
          ? await window.eliminarMovimientoBancario(m.id)
          : await window.desvincularMovimiento(m.id, infoDesvinculo);
        if (r.error) return { error: r.error };
      }
    }

    const r = await window.cancelarDocumento(id, motivo, currentUser, { estado: 'anulada', accion: 'anular' });
    if (r.error) return r;

    if (doc.tipo === 'factura') {
      // Borrar la CxC (si "eliminar el pago" ya la revirtió a pendiente, se borra igual: una
      // factura anulada no debe seguir generando cobranza) y crear la devolución automática.
      const { data: itemsData } = await window.sb.from('documentos_items').select('*').eq('documento_id', id);
      const docItems = (itemsData || []).filter(i => i.sku && i.sku !== '__SECTION__').map(i => ({
        sku: i.sku, nombre: i.nombre, qty: i.cantidad, precio: i.precio_unitario, subtotal: i.subtotal,
      }));
      const { error: eCxc } = await window.deleteCxCByFactura(id);
      if (eCxc) console.error('[anularDocumento] aviso borrando CxC:', eCxc);
      await window.crearDevolucionAutomatica?.(doc, docItems);

      // ── Cascada hacia arriba: 1 cotización → 1 orden → 1 factura → 1 despacho ────────────────
      // Regla de negocio confirmada (2026-08-13): una orden nunca tiene más de una factura viva.
      // Si esta factura se anula, su orden y la cotización de origen se CANCELAN de verdad (no
      // solo un badge) — una corrección real empieza de una cotización nueva, no de refacturar la
      // misma orden. `cancelarDocumento` ya libera el hold de inventario para tipo 'orden', y su
      // guard de idempotencia evita romper si alguna ya estaba cancelada.
      const motivoCascada = `Cancelada automáticamente: la factura ${id} fue anulada (${motivo})`;
      if (doc.documento_origen_id) {
        const { data: orden } = await window.sb.from('documentos').select('*').eq('id', doc.documento_origen_id).maybeSingle();
        if (orden) {
          const rOrden = await window.cancelarDocumento(orden.id, motivoCascada, currentUser);
          if (rOrden.error) console.error('[anularDocumento] aviso cancelando orden en cascada:', rOrden.error);
          if (orden.documento_origen_id) {
            const rCot = await window.cancelarDocumento(orden.documento_origen_id, motivoCascada, currentUser);
            if (rCot.error) console.error('[anularDocumento] aviso cancelando cotización en cascada:', rCot.error);
          }
        }
      }
    }

    if (doc.tipo === 'despacho' && doc.documento_origen_id) {
      // La factura vuelve a estar "por despachar"/"parcial" — recalcula sobre los despachos vivos
      // que le queden (ya excluye 'anulada' desde la migración 52), en vez de dejarla congelada en
      // 'despachada' con un despacho que ya no existe de verdad.
      const { error: eRecalc } = await window.sb.rpc('recalc_estado_despacho_factura', { p_factura_id: doc.documento_origen_id });
      if (eRecalc) console.error('[anularDocumento] aviso recalculando estado_despacho de la factura:', eRecalc);

      // Devolución SOLO si ya se había declarado entregado — antes de eso la mercancía nunca salió
      // de verdad hacia el cliente, así que anularlo es una simple reversa, no una devolución.
      if (doc.entregado_en) {
        const { data: itemsDsp } = await window.sb.from('documentos_items').select('*').eq('documento_id', id);
        const docItemsDsp = (itemsDsp || []).filter(i => i.sku && i.sku !== '__SECTION__').map(i => ({
          sku: i.sku, nombre: i.nombre, qty: i.cantidad, precio: i.precio_unitario, subtotal: i.subtotal,
        }));
        await window.crearDevolucionAutomatica?.(doc, docItemsDsp, {
          facturaId: doc.documento_origen_id,
          notaOrigen: `Devolución automática — despacho ${id} anulado (ya había sido entregado)`,
        });
      }
    }

    window.invalidateDocCounts?.();
    return r;
  };

  // ─── Crear CxC desde factura ──────────────────────────────────────────────
  window.createCxCFromFactura = async function (doc) {
    // Idempotencia: una sola CxC por factura. Si ya existe (doble click, re-emisión
    // o ambos paths de promoción), no duplicar la deuda. Respaldado por el índice
    // único ux_cuentas_cobrar_empresa_factura (migración 20260708).
    const { data: yaExiste } = await window.sb.from('cuentas_cobrar')
      .select('id').eq('empresa_id', window.currentEmpresa || 'demo1').eq('factura', doc.id).limit(1);
    if (yaExiste && yaExiste.length) return { id: yaExiste[0].id, dup: true };
    // Los términos vienen del selector como 'inmediato' | '15' | '30' | '45' | '60'.
    // parseInt tolera además valores legacy tipo '30dias'. Sin match numérico → 30 días.
    const days = doc.terminos_pago === 'inmediato' ? 0 : (parseInt(doc.terminos_pago, 10) || 30);
    // Vencimiento desde la fecha de Caracas (mediodía evita cruces de día) + plazo.
    const vence = new Date(window.localDateStr() + 'T12:00:00'); vence.setDate(vence.getDate() + days);
    const cxcId = 'CXC-' + Date.now();
    const payload = {
      id: cxcId,
      empresa_id: window.currentEmpresa || 'demo1',
      factura: doc.id,
      cliente_id: doc.cliente_id || doc.cliente || null,
      monto: parseFloat(doc.total) || 0,
      // El IVA se denormaliza acá para que Cuentas por Cobrar pueda mostrarlo y filtrarlo sin
      // abrir cada factura y sin perder la paginación server-side. NO se usa `aplica_iva` como
      // señal: es true por default en el 96% de lo migrado. Ver migracion-odoo/41_cxc_iva.sql.
      iva: parseFloat(doc.iva) || 0,
      pagado: 0,
      vence: window.localDateStr(vence),
      dias: -days,
      estado: 'pendiente',
      pagos: [],
      modalidad_pago: doc.modalidad_pago || 'divisas',
      categoria: 'Pedidos',
      creado_por: doc.creado_por || window.__ssCurrentUser?.nombre || null,
    };
    const { error } = await window.sb.from('cuentas_cobrar').insert(payload);
    // Carrera de doble-click: el índice único rechaza el 2º INSERT (23505). No es
    // error real — la CxC ya la creó el primer llamado.
    if (error) return error.code === '23505' ? { dup: true } : { error };
    window.SSData.cuentasCobrar = [{ ...payload, cliente: payload.cliente_id }, ...(window.SSData.cuentasCobrar || [])];
    window.logActivity?.({ modulo:'cxc', accion:'crear', entidad_id:cxcId, entidad_label:doc.id, detalles:{ monto:payload.monto, vence:payload.vence, categoria:'Pedidos' } });
    return { id: cxcId };
  };

  // ─── Sincronizar la CxC cuando se edita una factura ya emitida ────────────
  // createCxCFromFactura es idempotente (una CxC por factura), así que al reeditar una factura el
  // documento cambiaba de total pero la deuda seguía en el monto viejo. Caso real: factura de
  // $1.000 con saldo abierto a la que se le da un descuento por pronto pago a $950 — sin esto el
  // cliente seguía debiendo $1.000.
  //
  // Solo se toca mientras la factura está ABIERTA en cobro: si ya está saldada, cambiarle el monto
  // reescribiría un cobro cerrado (y dejaría pagos sin respaldo). El piso es lo YA PAGADO: no se
  // puede descontar por debajo de lo que el cliente entregó — eso sería una devolución, no un
  // descuento, y va por nota de crédito.
  window.syncCxCFactura = async function (doc) {
    if (!doc || !doc.id) return { skipped: 'sin_documento' };
    const empresa = window.currentEmpresa || 'demo1';
    const { data: filas, error: qErr } = await window.sb.from('cuentas_cobrar')
      .select('id, monto, pagado, estado').eq('empresa_id', empresa).eq('factura', doc.id).limit(1);
    if (qErr) return { error: qErr };
    if (!filas || !filas.length) return { skipped: 'sin_cxc' };   // factura ya cobrada o sin CxC

    const cxc    = filas[0];
    const pagado = parseFloat(cxc.pagado) || 0;
    const nuevo  = Math.round((parseFloat(doc.total) || 0) * 100) / 100;
    const actual = Math.round((parseFloat(cxc.monto) || 0) * 100) / 100;
    if (cxc.estado === 'pagada') return { skipped: 'cxc_pagada' };
    if (Math.abs(nuevo - actual) < 0.005) return { skipped: 'sin_cambio' };
    if (nuevo < pagado - 0.005) {
      return { error: { message: `El nuevo total ($${nuevo.toFixed(2)}) es menor que lo ya pagado ($${pagado.toFixed(2)}). Para devolver dinero usá una nota de crédito, no un descuento.` } };
    }

    // Saldado por el descuento (nuevo <= pagado) → pagada; con abonos previos → parcial.
    const estado = (nuevo <= pagado + 0.005)
      ? (pagado > 0.005 ? 'pagada' : 'anulada')
      : (pagado > 0.005 ? 'parcial' : 'pendiente');

    // El IVA viaja junto con el monto: reeditar la factura puede prender o apagar el IVA, y la
    // columna de Cuentas por Cobrar quedaría mostrando el de antes.
    const ivaNuevo = parseFloat(doc.iva) || 0;
    const { error } = await window.sb.from('cuentas_cobrar')
      .update({ monto: nuevo, estado, iva: ivaNuevo }).eq('id', cxc.id);
    if (error) return { error };

    const lista = window.SSData.cuentasCobrar || [];
    const idx = lista.findIndex(c => c.id === cxc.id);
    if (idx >= 0) lista[idx] = { ...lista[idx], monto: nuevo, estado, iva: ivaNuevo };

    window.logActivity?.({
      modulo: 'cxc', accion: 'editar', entidad_id: cxc.id, entidad_label: doc.id,
      detalles: { motivo: 'Ajuste por edición de la factura', monto_anterior: actual, monto_nuevo: nuevo, pagado, estado },
    });
    return { ok: true, monto_anterior: actual, monto_nuevo: nuevo, estado };
  };

  // ====================================================================
  // LINAJE — documentos independientes encadenados (rediseño del flujo)
  // Cotización → Orden → Factura → Nota(s) de Despacho. Cada promoción CREA
  // un documento hijo (INSERT) y deja vivo al padre, marcándole su sub-estado.
  // ====================================================================
  // La factura usa la serie NDE para CONTINUAR el correlativo de Odoo (la última
  // fue NDE/2026/27248). Con 'FAC' arrancaba una serie paralela desde 5001.
  const PREFIX_BY_TIPO  = { cotizacion: 'COT', orden: 'ORD', factura: 'NDE', despacho: 'DSP' };
  const ESTADO_INICIAL  = { cotizacion: 'creada', orden: 'generada', factura: 'por_cobrar', despacho: 'por_despachar' };
  const SUBESTADO_PADRE = { orden: 'convertida', factura: 'facturada' }; // sub-estado que toma el PADRE al generar un hijo de este tipo

  // Mapea una fila de documentos (con documentos_items embebidos) al formato de la app
  function mapDocRow(d) {
    return {
      ...d,
      cliente: d.cliente_id,
      total:   parseFloat(d.total) || 0,
      items:   (d.documentos_items || []).filter(i => i.sku !== '__SECTION__').reduce((s, i) => s + (i.cantidad || 1), 0),
      lines:   (d.documentos_items || []).map(i => ({
        id:              i.id,
        sku:             i.sku,
        nombre:          i.nombre,
        qty:             i.cantidad,
        precio:          parseFloat(i.precio_unitario),
        descuento:       parseFloat(i.descuento) || 0,
        descuento_extra: parseFloat(i.descuento_extra) || 0,
        subtotal:        parseFloat(i.subtotal),
        proveedor_id:    i.proveedor_id || null,
        costo:           parseFloat(i.costo) || 0,
        cantidad_despachada: i.cantidad_despachada != null ? parseInt(i.cantidad_despachada) : 0,
        factura_item_id:     i.factura_item_id != null ? parseInt(i.factura_item_id) : null,
        garantia_meses:        i.garantia_meses != null ? parseInt(i.garantia_meses) : null,
        garantia_condiciones:  i.garantia_condiciones || null,
      })),
    };
  }
  window.__mapDocRow = mapDocRow;

  // Campos de cabecera que se copian del padre al promover (sin id/tipo/estado/linaje)
  function copiarCabecera(padre) {
    const keys = ['cliente_id','contacto_id','vendedor','almacen_id','tipo_venta','terminos_pago',
      'fuente','id_crm','tipo_entrega','zona_delivery','dir_factura','dir_entrega','vencimiento',
      'aplica_iva','descuento_doc','descuento_pct','subtotal','iva','total','modalidad_pago',
      'cobertura_pct','tasa_bcv','tasa_paralelo','creado_por','transportista','guia_envio','observaciones'];
    const out = {};
    keys.forEach(k => { if (padre[k] !== undefined && padre[k] !== null) out[k] = padre[k]; });
    return out;
  }
  window.copiarCabecera = copiarCabecera;

  // Actualiza SOLO campos de cabecera del documento (sin tocar items)
  window.updateDocCampos = async function (docId, fields) {
    const { error } = await window.sb.from('documentos').update(fields).eq('id', docId);
    if (error) { console.error('[updateDocCampos]', error); return { error }; }
    if (window.SSData?.documentos) {
      window.SSData.documentos = window.SSData.documentos.map(d => d.id === docId ? { ...d, ...fields } : d);
    }
    return { ok: true };
  };

  // Promueve un documento creando un HIJO encadenado (INSERT, no mutación in-place).
  // padre: doc origen; tipoDestino: 'orden'|'factura'; lines: líneas a copiar; extra: overrides (tipo_factura, etc.)
  window.promoverDocumento = async function (padre, tipoDestino, lines, extra) {
    // ── Las líneas del padre, o no hay promoción ──────────────────────────────────────────
    // `lines || padre.lines || []` NUNCA caía al padre: un array vacío es TRUTHY en JS, así que
    // `[] || padre.lines` devuelve `[]`. La red de seguridad no cubría el único caso para el que
    // servía —promover con las líneas todavía en vuelo— y el hijo nacía SIN productos, con el
    // total copiado de la cabecera: monto sin líneas, CxC emitida y PDF en $0.00.
    const conSku = a => (a || []).filter(i => i && i.sku && i.sku !== '__SECTION__');
    let useLines = conSku(lines).length ? lines
                 : conSku(padre.lines).length ? padre.lines
                 : [];
    if (!conSku(useLines).length) {
      // Último recurso: preguntarle a la BASE. Si el padre sí tiene líneas, el vacío es un
      // problema de carga del cliente y no del documento — se recuperan y la venta sigue.
      const delPadre = window.loadDocumentoItems ? await window.loadDocumentoItems(padre.id) : [];
      if (conSku(delPadre).length) useLines = delPadre;
    }
    if (!conSku(useLines).length) {
      // Falla CERRADA: promover un documento sin productos solo puede terminar en una venta que
      // no se puede despachar. Mejor no crear nada que crear algo que hay que reparar a mano.
      return { error: { message: `El documento ${padre.id} no tiene productos que copiar, así que no se generó nada.` } };
    }
    const nuevoId = await window.nextDocId(PREFIX_BY_TIPO[tipoDestino]);
    const docData = {
      ...copiarCabecera(padre),
      ...(extra || {}),
      id: nuevoId,
      tipo: tipoDestino,
      estado: ESTADO_INICIAL[tipoDestino],
      documento_origen_id: padre.id,
      raiz_id: padre.raiz_id || padre.id,
      fecha: window.localDateStr(),
      // `items` es un contador DENORMALIZADO en la cabecera — la lista lo lee así, sin sumar
      // documentos_items en cada fila. `copiarCabecera` no lo copia (no es un dato del padre, es
      // del hijo) y nadie más lo calculaba acá: toda promoción nacía con esta columna en NULL,
      // la lista mostraba "0" y el detalle —que sí lee las líneas reales— mostraba el producto
      // correcto. Se recalcula de `useLines` (lo que de VERDAD se está por insertar), no se copia
      // del padre: mismo criterio que usa el compositor (`buildDocData`, pos.jsx).
      items: conSku(useLines).reduce((s, l) => s + (Math.round(l.qty ?? l.cantidad) || 1), 0),
    };
    const { doc, error } = await window.saveDocumento(docData, useLines);
    if (error) return { error };

    // Marcar sub-estado consumido en el padre (cotización→convertida, orden→facturada)
    const subPadre = SUBESTADO_PADRE[tipoDestino];
    if (subPadre) await window.updateDocCampos(padre.id, { estado: subPadre });

    // Efectos por etapa: orden reserva inventario; factura crea CxC (NO debita: el débito ocurre al despachar)
    // Verificar el resultado de cada efecto: ambos retornan { error } (no throw).
    // Sin esto, una reserva/CxC fallida pasaba inadvertida y la función reportaba éxito,
    // dejando una orden sin reserva (sobreventa) o una factura sin su CxC (deuda no registrada).
    const alm = docData.almacen_id;
    if (tipoDestino === 'orden' && alm) {
      const rRes = await window.reservarInventario(useLines, alm, 'reservar');
      if (rRes?.error) return { error: rRes.error };
    } else if (tipoDestino === 'factura') {
      const cRes = await window.createCxCFromFactura({ ...docData, ...(doc || {}) });
      if (cRes?.error) return { error: cRes.error };
    }

    // Re-vincular los seriales (S/N) ya asignados al PADRE hacia el nuevo documento.
    // orden→factura debe MANTENER los seriales asignados en la orden; antes quedaban
    // pegados a la orden (documento_id = orden) y la factura aparecía sin serial.
    // (El despacho luego los re-vincula a su vez vía crear_despacho_parcial.)
    // No bloquea la promoción si falla: el doc/CxC ya quedaron creados.
    {
      const { error: snErr } = await window.sb.from('inventario_seriales')
        .update({ documento_id: nuevoId })
        .eq('documento_id', padre.id);
      if (snErr) console.warn('[promoverDocumento] aviso re-vinculando seriales:', snErr);
    }

    window.logActivity?.({ modulo: 'documentos', accion: 'crear', entidad_id: nuevoId, entidad_label: nuevoId,
      detalles: { promocion: `${padre.tipo} → ${tipoDestino}`, origen: padre.id } });
    // `lines` del HIJO, no del padre. Antes iba `lines: useLines` —las líneas que se recibieron
    // del padre, con SU id de documentos_items— y el detalle del hijo se queda con ellas (no
    // recarga si el doc ya trae lines). Promoviendo COT→ORD→FAC, la factura terminaba mostrando
    // el id de línea de la COTIZACIÓN, y al despachar se mandaba ese id a crear_despacho_parcial:
    // "Línea de factura 187237 no encontrada en NDE-2026-27252". Las líneas reales del hijo las
    // devuelve saveDocumento desde el INSERT ... RETURNING.
    const hijoLines = (doc && doc.__lines) || useLines;
    if (doc) delete doc.__lines;
    const hijo = { ...docData, ...(doc || {}), cliente: docData.cliente_id, total: parseFloat(docData.total) || 0, lines: hijoLines, has_child: false, estado_despacho: tipoDestino === 'factura' ? 'por_despachar' : 'no_aplica' };
    return { doc: hijo };
  };

  // Crea una nota de despacho (posiblemente parcial) vía RPC atómica.
  // factura: doc factura; lineasDespacho: [{factura_item_id,sku,nombre,cantidad,...}];
  // extra: { almacen_id, driver_id, tipo_entrega, seriales:[{serial,sku}], nro_despacho, observaciones }
  // Compartido por crearDespacho y reactivarDespacho: arma el jsonb `p_items` que espera
  // `crear_despacho_parcial`, filtrando líneas sin sku/sin cantidad.
  function _despachoPItems(lineasDespacho) {
    return (lineasDespacho || []).filter(l => l.sku && l.sku !== '__SECTION__').map(l => ({
      factura_item_id: l.factura_item_id,
      sku: l.sku, nombre: l.nombre,
      cantidad: Math.round(l.qty || l.cantidad) || 0,
      precio_unitario: l.precio ?? l.precio_unitario ?? 0,
      descuento: l.descuento || 0, descuento_extra: l.descuento_extra || 0,
      subtotal: l.subtotal || 0, proveedor_id: l.proveedor_id || null,
      costo: parseFloat(l.costo) || 0,
      garantia_meses: (l.garantia_meses != null && l.garantia_meses !== '') ? parseInt(l.garantia_meses) : null,
      garantia_condiciones: l.garantia_condiciones || null,
    })).filter(l => l.cantidad > 0);
  }

  window.crearDespacho = async function (factura, lineasDespacho, extra = {}) {
    window.invalidateDocCounts && window.invalidateDocCounts();
    // El id sale de la serie del almacén que despacha (ALT-OUT-21485), continuando la
    // numeración de Odoo. Antes era DSP-{año}-{n}, una serie paralela.
    const despachoId = await window.nextDespachoId(extra.almacen_id || factura.almacen_id);
    const p_items = _despachoPItems(lineasDespacho);
    if (p_items.length === 0) return { error: { message: 'No hay cantidades para despachar' } };

    const { data, error } = await window.sb.rpc('crear_despacho_parcial', {
      p_despacho_id:   despachoId,
      p_factura_id:    factura.id,
      p_items,
      p_almacen_id:    extra.almacen_id || factura.almacen_id || null,
      p_driver_id:     extra.driver_id || null,
      p_tipo_entrega:  extra.tipo_entrega || null,
      p_seriales:      extra.seriales || null,
      p_nro_despacho:  extra.nro_despacho || null,
      p_observaciones: extra.observaciones || null,
    });
    if (error) { console.error('[crearDespacho]', error); return { error }; }

    // Débito local de inventario en SSData (la RPC ya lo persistió en DB)
    const alm = extra.almacen_id || factura.almacen_id;
    if (alm && window.SSData.inventario) {
      p_items.forEach(it => {
        const inv = (window.SSData.inventario[it.sku] || {})[alm];
        if (inv) { inv.cantidad = Math.max(0, (inv.cantidad || 0) - it.cantidad); inv.reservado = Math.max(0, (inv.reservado || 0) - it.cantidad); }
      });
    }

    window.logActivity?.({ modulo: 'documentos', accion: 'crear', entidad_id: despachoId, entidad_label: despachoId,
      detalles: { despacho_de: factura.id, items: p_items.length } });
    window.dispatchEvent(new CustomEvent('ss-doc-version-bump', { detail: { id: factura.id, despachoId } }));
    return { ok: true, despachoId, data };
  };

  // ─── Reactivar un despacho devuelto: MISMO documento, no uno nuevo ─────────
  // Un despacho anulado con su factura viva puede volver a montarse en la MISMA fila (mismo id
  // físico) en vez de generar un despacho nuevo — así el correlativo de esa venta no acumula
  // documentos por cada intento. Se ve en pantalla como `{id}-v{version}`; el id real no cambia
  // (evita romper FKs de documentos_items/inventario_seriales/driver_despachos). La historia de la
  // anulación previa NO se guarda en el documento (que vuelve a estar "recién creado") sino en
  // logActivity/ssActivityLog, capturada ANTES de que la RPC la limpie.
  window.reactivarDespacho = async function (despachoId, factura, lineasDespacho, extra = {}) {
    const { data: previo, error: ePrev } = await window.sb.from('documentos').select('*').eq('id', despachoId).maybeSingle();
    if (ePrev) return { error: ePrev };
    if (!previo || previo.tipo !== 'despacho' || previo.estado !== 'anulada') {
      return { error: { message: 'Este despacho no está anulado — no se puede reactivar.' } };
    }
    window.invalidateDocCounts && window.invalidateDocCounts();
    const p_items = _despachoPItems(lineasDespacho);
    if (p_items.length === 0) return { error: { message: 'No hay cantidades para despachar' } };

    const { data, error } = await window.sb.rpc('crear_despacho_parcial', {
      p_despacho_id:   despachoId,
      p_factura_id:    factura.id,
      p_items,
      p_almacen_id:    extra.almacen_id || factura.almacen_id || null,
      p_driver_id:     extra.driver_id || null,
      p_tipo_entrega:  extra.tipo_entrega || null,
      p_seriales:      extra.seriales || null,
      p_nro_despacho:  extra.nro_despacho || null,
      p_observaciones: extra.observaciones || null,
      p_reactivar:     true,
    });
    if (error) { console.error('[reactivarDespacho]', error); return { error }; }

    const alm = extra.almacen_id || factura.almacen_id;
    if (alm && window.SSData.inventario) {
      p_items.forEach(it => {
        const inv = (window.SSData.inventario[it.sku] || {})[alm];
        if (inv) { inv.cantidad = Math.max(0, (inv.cantidad || 0) - it.cantidad); inv.reservado = Math.max(0, (inv.reservado || 0) - it.cantidad); }
      });
    }

    const nuevaVersion = (previo.version || 1) + 1;
    window.logActivity?.({ modulo: 'documentos', accion: 'reactivar', entidad_id: despachoId, entidad_label: despachoId,
      detalles: { despacho_de: factura.id, items: p_items.length, version: nuevaVersion,
                  version_anterior: previo.version || 1, anulado_por: previo.cancelado_por,
                  anulado_at: previo.cancelado_at, motivo_anulacion: previo.motivo_cancelacion } });
    window.ssActivityLog?.add(despachoId, 'reactivado',
      `Vuelto a despachar — v${nuevaVersion}. Anulación anterior (${previo.cancelado_por || 'desconocido'}` +
      `${previo.cancelado_at ? ', ' + (window.fmt?.dateTime(previo.cancelado_at) || previo.cancelado_at) : ''}): ${previo.motivo_cancelacion || '—'}`);
    window.dispatchEvent(new CustomEvent('ss-doc-version-bump', { detail: { id: factura.id, despachoId } }));
    return { ok: true, despachoId, version: nuevaVersion, data };
  };

  // Cancela un despacho vía RPC (restaura inventario simétrico + libera seriales)
  window.cancelarDespacho = async function (despachoId, motivo, usuario, accion = 'cancelar') {
    const { data, error } = await window.sb.rpc('cancelar_despacho', { p_despacho_id: despachoId, p_motivo: motivo || 'Cancelación de despacho', p_usuario: usuario || null });
    if (error) { console.error('[cancelarDespacho]', error); return { error }; }
    window.logActivity?.({ modulo: 'pos', accion, entidad_id: despachoId, entidad_label: despachoId, detalles: { motivo } });
    return { ok: true, data };
  };

  // Toda la familia de un documento (linaje): el raíz + todos sus descendientes
  window.getLinaje = async function (raizId) {
    if (!raizId) return [];
    const e = window.currentEmpresa || 'demo1';
    const { data, error } = await window.sb.from('documentos')
      .select('*, documentos_items(*)')
      .or(`id.eq.${raizId},raiz_id.eq.${raizId}`)
      .eq('empresa_id', e)
      .order('created_at', { ascending: true });
    if (error) { console.error('[getLinaje]', error); return []; }
    return (data || []).map(mapDocRow);
  };

  // Despachos (no cancelados) asociados a una factura.
  // Linaje PLANO (migración Odoo): factura y despachos son HERMANOS que cuelgan de la MISMA
  // orden; ningún despacho apunta a la factura. Comparten `raiz_id` (= la orden). Se busca por
  // el raiz_id de la factura; con fallback a `documento_origen_id === facturaId` para el flujo
  // nativo de la app (donde el despacho SÍ nace de la factura).
  // opts.soloDirectos=true → SOLO despachos que nacen de ESA factura (documento_origen_id===facturaId,
  // flujo nativo). Se usa en la cascada de cancelación: NO debe tocar despachos hermanos de OTRA
  // factura de la misma orden (linaje plano), o restauraría inventario/seriales de una venta viva.
  // El modo por defecto (display) sí trae los hermanos por raiz_id compartido.
  window.getDespachosDeFactura = async function (facturaId, opts = {}) {
    if (!facturaId) return [];
    const e = window.currentEmpresa || 'demo1';
    let q = window.sb.from('documentos')
      .select('*, documentos_items(*)')
      .eq('tipo', 'despacho')
      .not('estado', 'in', '(cancelada,anulada)')
      .eq('empresa_id', e)
      .order('created_at', { ascending: true });
    if (opts.soloDirectos) {
      q = q.eq('documento_origen_id', facturaId);
    } else {
      const { data: fac } = await window.sb.from('documentos')
        .select('id, raiz_id, documento_origen_id').eq('id', facturaId).eq('empresa_id', e).maybeSingle();
      const raiz = fac?.raiz_id || fac?.documento_origen_id || null;
      if (raiz) {
        q = q.or(`raiz_id.eq.${raiz},documento_origen_id.eq.${raiz},documento_origen_id.eq.${facturaId}`);
      } else {
        q = q.eq('documento_origen_id', facturaId);
      }
    }
    const { data, error } = await q;
    if (error) { console.error('[getDespachosDeFactura]', error); return []; }
    return (data || []).map(mapDocRow);
  };

  // Seriales vinculados a un documento, agrupados por sku (para PDF de despacho)
  window.cargarSerialesDoc = async function (docId) {
    if (!docId) return {};
    const { data, error } = await window.sb.from('inventario_seriales')
      .select('sku, serial, garantia_meses, garantia_vence').eq('documento_id', docId);
    if (error) { console.error('[cargarSerialesDoc]', error); return {}; }
    const bySku = {};
    (data || []).forEach(s => { (bySku[s.sku] = bySku[s.sku] || []).push({ serial: s.serial, garantia_meses: s.garantia_meses, garantia_vence: s.garantia_vence }); });
    return bySku;
  };

  // ─── Devolución de OC al proveedor (total o parcial) ──────────────────────
  // Baja el inventario (salida) de lo devuelto y reduce la deuda (CxP pendiente de la OC).
  // items: [{ oci_id, sku, descripcion, cantidad, precio_unitario, motivo }]
  // Devuelve { ok, id, monto, deudaReducida, sobranteSinCxp, invErrores }.
  window.devolverOC = async function ({ ocId, almacenId, fecha, motivo, items }) {
    const e = window.currentEmpresa || 'demo1';
    const oc = (window.SSData.ordenesCompra || []).find(o => o.id === ocId) || { id: ocId };
    const validItems = (items || [])
      .map(it => ({ ...it, cantidad: Math.round((parseFloat(it.cantidad) || 0) * 1000) / 1000 }))
      .filter(it => it.cantidad > 0);
    if (validItems.length === 0) return { error: { message: 'Indicá al menos una cantidad a devolver.' } };
    if (!almacenId) return { error: { message: 'Seleccioná el almacén de donde sale la mercancía.' } };

    const devId = 'DEV-OC-' + Date.now();
    const itemsJson = validItems.map(it => ({
      oci_id: it.oci_id || null, sku: it.sku || null, descripcion: it.descripcion || null,
      cantidad: it.cantidad, precio_unitario: parseFloat(it.precio_unitario) || 0,
      subtotal: Math.round(it.cantidad * (parseFloat(it.precio_unitario) || 0) * 100) / 100,
      motivo: (it.motivo || '').trim() || null,
    }));

    // TODO atómico en el server: valida stock → reduce CxP (leída de BD) → inserta devolución →
    // decremento atómico de inventario → marca seriales 'devuelto' → baja monto_total. Rollback total ante error.
    const { data, error } = await window.sb.rpc('devolver_oc', {
      p_id: devId, p_oc_id: ocId, p_empresa_id: e, p_fecha: fecha || window.localDateStr(),
      p_almacen_id: almacenId, p_items: itemsJson, p_motivo: (motivo || '').trim() || null,
      p_creado_por: window.__ssCurrentUser?.nombre || null,
    });
    if (error) return { error: { message: 'No se pudo procesar la devolución: ' + error.message } };
    if (data && data.error) return { error: { message: data.error } };
    if (!data || !data.ok) return { error: { message: 'La devolución no se completó (respuesta inesperada del servidor).' } };

    // Parchar memoria desde el retorno de la RPC (los cambios YA están commiteados en BD).
    (data.cxp_ajustes || []).forEach(aj => {
      const c = (window.SSData.cuentasPagar || []).find(x => x.id === aj.cxp_id);
      if (c) { c.monto = aj.nuevo_monto; c.estado = aj.nuevo_estado; }
    });
    (data.inv_nuevos || []).forEach(inv => {
      if (!window.SSData.inventario) window.SSData.inventario = {};
      if (!window.SSData.inventario[inv.sku]) window.SSData.inventario[inv.sku] = {};
      window.SSData.inventario[inv.sku][inv.almacen_id] = {
        ...(window.SSData.inventario[inv.sku][inv.almacen_id] || {}), cantidad: inv.cantidad };
    });
    const idxOc = (window.SSData.ordenesCompra || []).findIndex(o => o.id === ocId);
    if (idxOc !== -1) window.SSData.ordenesCompra[idxOc].monto = data.monto_total;

    // Bitácora (no crítica: si falla no corrompe estado ya persistido).
    const almNombre  = (window.SSData.almacenes || []).find(a => a.id === almacenId)?.nombre || almacenId;
    const provNombre = (window.SSData.proveedores || []).find(p => p.id === (oc.proveedor_id || oc.proveedor))?.nombre || null;
    validItems.forEach(it => {
      if (!it.sku) return;
      window.logActivity?.({
        modulo: 'inventario', accion: 'salida', entidad_id: it.sku, entidad_label: it.descripcion || it.sku,
        detalles: { sku: it.sku, cantidad: it.cantidad, almacen_origen_id: almacenId, almacen_origen: almNombre, origen: 'devolucion_oc', ref: devId, oc: ocId, proveedor_id: oc.proveedor_id || oc.proveedor || null, proveedor: provNombre },
      });
    });
    window.logActivity?.({
      modulo: 'ordenes_compra', accion: 'devolucion', entidad_id: ocId, entidad_label: ocId,
      detalles: { devolucion_id: devId, monto: data.monto, items: validItems.length, deuda_reducida: data.deuda_reducida, almacen: almNombre, motivo: (motivo || '').trim() || null },
    });

    return { ok: true, id: devId, monto: data.monto, deudaReducida: data.deuda_reducida, sobranteSinCxp: data.sobrante_sin_cxp || 0, invErrores: [] };
  };

  // ─── Crear CxC/CxP manual ────────────────────────────────────────────────
  window.crearCuentaManual = async function ({ tipo, clienteId, proveedorId, factura, concepto, monto, vence, fecha_emision, modalidad_pago, categoria, moneda, tasa, foto }) {
    const empresa = window.currentEmpresa || 'demo1';
    const today   = new Date(); today.setHours(0,0,0,0);
    const venceDate = new Date(vence + 'T00:00:00');
    const dias    = Math.round((today - venceDate) / 86400000); // pos=vencida, neg=por vencer
    const estado  = dias > 0 ? 'vencida' : 'pendiente';

    if (tipo === 'cobrar') {
      const id = 'CXC-' + Date.now();
      const payload = {
        id, empresa_id: empresa,
        factura: factura || null, cliente_id: clienteId,
        monto: parseFloat(monto) || 0, pagado: 0,
        vence, dias, estado, pagos: [], modalidad_pago: modalidad_pago || 'divisas',
        categoria: categoria || null,
        creado_por: window.__ssCurrentUser?.nombre || null,
      };
      const { error } = await window.sb.from('cuentas_cobrar').insert(payload);
      if (error) return { error };
      window.SSData.cuentasCobrar = [{ ...payload, cliente: clienteId }, ...(window.SSData.cuentasCobrar || [])];
      const cliNombre = (window.SSData.clientes || []).find(c => c.id === clienteId)?.nombre || clienteId;
      window.logActivity?.({ modulo:'cxc', accion:'crear', entidad_id:id, entidad_label:factura||id, detalles:{ cliente: cliNombre, monto: payload.monto, vence, categoria } });
      return { id };
    } else {
      const id = 'CXP-' + Date.now();
      const payload = {
        id, empresa_id: empresa, tipo: 'proveedor',
        factura: factura || null, proveedor_id: proveedorId,
        concepto: concepto || null,
        monto: parseFloat(monto) || 0, pagado: 0,
        vence, dias, estado, pagos: [],
        categoria: categoria || null,
        moneda: moneda || 'USD',                              // moneda de registro (el monto igual va en USD)
        // Fecha de la factura del proveedor (migración 67). Distinta de created_at, que es cuándo
        // se cargó la cuenta acá; puede quedar en null y la pantalla muestra '—'.
        fecha_emision: fecha_emision || null,
        tasa: (moneda === 'VES' && parseFloat(tasa) > 0) ? parseFloat(tasa) : null,
        foto: foto || null,   // foto de la factura (base64) — excluida de la carga masiva, ver getCxpFoto
        creado_por: window.__ssCurrentUser?.nombre || null,
      };
      const { error } = await window.sb.from('cuentas_pagar').insert(payload);
      if (error) return { error };
      window.SSData.cuentasPagar = [{ ...payload, proveedor: proveedorId }, ...(window.SSData.cuentasPagar || [])];
      const provNombre = (window.SSData.proveedores || []).find(p => p.id === proveedorId)?.nombre || proveedorId;
      window.logActivity?.({ modulo:'cxp', accion:'crear', entidad_id:id, entidad_label:factura||id, detalles:{ proveedor: provNombre, monto: payload.monto, vence, categoria } });
      return { id };
    }
  };

  // Editar una CxP ya cargada — SOLO antes de que se marque pagada (fail-closed: se revalida acá,
  // no solo en el botón, porque una cuenta puede pagarse en otra pestaña mientras el modal está
  // abierto). Pedido explícito: "puede que haya errores de tasa o de moneda" al cargar la cuenta,
  // y hoy no había forma de corregirlos sin borrar y recrear (perdiendo la fecha de creación y
  // cualquier cosa que ya la referenciara). No toca `pagado`/`pagos`/`estado` de cobro — eso es
  // registrar un pago, una acción aparte.
  window.editarCuentaManual = async function ({ id, factura, concepto, monto, vence, fecha_emision, categoria, moneda, tasa }) {
    const { data: actual, error: eSel } = await window.sb.from('cuentas_pagar').select('*').eq('id', id).maybeSingle();
    if (eSel) return { error: eSel };
    if (!actual) return { error: { message: 'La cuenta no existe (puede que ya se haya eliminado).' } };
    if (actual.estado === 'pagada') {
      return { error: { message: 'Esta cuenta ya está pagada — no se puede editar. Si el pago fue un error, revertilo primero desde su historial.' } };
    }
    const today = new Date(); today.setHours(0,0,0,0);
    const venceDate = new Date(vence + 'T00:00:00');
    const dias = Math.round((today - venceDate) / 86400000);
    const pagado = parseFloat(actual.pagado) || 0;
    const montoNum = parseFloat(monto) || 0;
    const estado = pagado > 0 ? (window.ssSaldada(pagado, montoNum) ? 'pagada' : 'parcial') : (dias > 0 ? 'vencida' : 'pendiente');
    const patch = {
      factura: factura || null, concepto: concepto || null,
      monto: montoNum, vence, dias, estado, categoria: categoria || null,
      moneda: moneda || 'USD',
      tasa: (moneda === 'VES' && parseFloat(tasa) > 0) ? parseFloat(tasa) : null,
      fecha_emision: fecha_emision || null,
    };
    const { error } = await window.sb.from('cuentas_pagar').update(patch).eq('id', id);
    if (error) return { error };
    const mem = (window.SSData.cuentasPagar || []).find(c => c.id === id);
    if (mem) Object.assign(mem, patch);
    window.logActivity?.({ modulo: 'cxp', accion: 'editar', entidad_id: id, entidad_label: factura || id,
      detalles: { antes: { monto: actual.monto, moneda: actual.moneda, tasa: actual.tasa, vence: actual.vence },
                  despues: { monto: montoNum, moneda: patch.moneda, tasa: patch.tasa, vence } } });
    return { ok: true };
  };

  // Foto de la factura de una CxP — on-demand (excluida de la carga masiva de cuentas_pagar).
  // Si la cuenta se creó/editó en esta sesión, ya está en memoria (evita el round-trip).
  window.getCxpFoto = async function (cxpId) {
    const enMemoria = (window.SSData.cuentasPagar || []).find(c => c.id === cxpId);
    if (enMemoria?.foto) return { data: enMemoria.foto };
    const { data, error } = await window.sb.from('cuentas_pagar').select('foto').eq('id', cxpId).maybeSingle();
    if (error) return { error };
    return { data: data?.foto || null };
  };

  // ─── Merma de residuo (CxC / CxP) ─────────────────────────────────────────
  // Cuando queda un saldo mínimo incobrable/impagable (típicamente por diferencias
  // cambiarias) se da de baja: se registra la merma y se cierra la cuenta
  // (pagado = monto, estado = 'pagada'). NO cuenta como cobro/pago real (no toca
  // `pagos` ni bancos) — solo salda el residuo y deja traza en `mermas_residuo`.
  window.registrarMermaResiduo = async function ({ tipo, cuenta, motivo }) {
    const emp = window.currentEmpresa || 'demo1';
    const esCobrar = tipo === 'cobrar';
    const saldo = Math.round((((cuenta.monto || 0) - (cuenta.pagado || 0))) * 100) / 100;
    if (!(saldo > 0)) return { error: { message: 'La cuenta no tiene saldo pendiente para dar de baja.' } };
    const tabla   = esCobrar ? 'cuentas_cobrar' : 'cuentas_pagar';
    const entId   = esCobrar ? (cuenta.cliente_id || cuenta.cliente) : (cuenta.proveedor_id || cuenta.proveedor);
    const entNombre = esCobrar
      ? ((window.SSData.clientes || []).find(c => c.id === entId)?.nombre || entId || '')
      : ((window.SSData.proveedores || []).find(p => p.id === entId)?.nombre || entId || '');
    const row = {
      id: 'MERMA-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      empresa_id: emp, tipo, cuenta_id: cuenta.id, factura: cuenta.factura || null,
      entidad_id: entId || null, entidad_nombre: entNombre || null,
      monto: saldo, motivo: (motivo || '').trim() || null,
      fecha: window.localDateStr(), creado_por: window.__ssCurrentUser?.nombre || null,
    };
    const { error: insErr } = await window.sb.from('mermas_residuo').insert(row);
    if (insErr) return { error: insErr };
    const { error: updErr } = await window.sb.from(tabla)
      .update({ pagado: cuenta.monto, estado: 'pagada' }).eq('id', cuenta.id);
    if (updErr) {
      // Rollback manual (no hay transacción vía PostgREST): si no se pudo cerrar la cuenta,
      // borrar la merma recién insertada para no dejar un registro huérfano que doble-cuente
      // el total ni corrompa `pagado` al revertirse luego.
      await window.sb.from('mermas_residuo').delete().eq('id', row.id);
      return { error: updErr };
    }
    // Reflejar en memoria (la lista lee SSData en vivo).
    const arr = esCobrar ? window.SSData.cuentasCobrar : window.SSData.cuentasPagar;
    const local = (arr || []).find(c => c.id === cuenta.id);
    if (local) { local.pagado = cuenta.monto; local.estado = 'pagada'; }
    window.logActivity?.({
      modulo: esCobrar ? 'cxc' : 'cxp', accion: 'editar',
      entidad_id: cuenta.id, entidad_label: cuenta.factura || cuenta.id,
      detalles: { tipo: 'merma_residuo', monto: saldo, entidad: entNombre, motivo: row.motivo },
    });
    return { ok: true, id: row.id, monto: saldo };
  };

  window.loadMermas = async function (tipo) {
    const emp = window.currentEmpresa || 'demo1';
    let q = window.sb.from('mermas_residuo').select('*').eq('empresa_id', emp).order('created_at', { ascending: false });
    if (tipo) q = q.eq('tipo', tipo);
    const { data, error } = await q;
    if (error) { console.error('[Supabase] Error cargando mermas:', error); return []; }
    return data || [];
  };

  // Revertir una merma: reabre la cuenta (resta el residuo de pagado y recomputa estado)
  // y borra la fila de merma.
  window.eliminarMermaResiduo = async function (merma) {
    const esCobrar = merma.tipo === 'cobrar';
    const tabla = esCobrar ? 'cuentas_cobrar' : 'cuentas_pagar';
    if (merma.cuenta_id) {
      const { data: cur } = await window.sb.from(tabla).select('monto,pagado').eq('id', merma.cuenta_id).maybeSingle();
      if (cur) {
        const nuevoPagado = Math.max(0, Math.round((((cur.pagado || 0) - (merma.monto || 0))) * 100) / 100);
        const nuevoEstado = nuevoPagado <= 0 ? 'pendiente' : (window.ssSaldada(nuevoPagado, cur.monto || 0) ? 'pagada' : 'parcial');
        await window.sb.from(tabla).update({ pagado: nuevoPagado, estado: nuevoEstado }).eq('id', merma.cuenta_id);
        const arr = esCobrar ? window.SSData.cuentasCobrar : window.SSData.cuentasPagar;
        const local = (arr || []).find(c => c.id === merma.cuenta_id);
        if (local) { local.pagado = nuevoPagado; local.estado = nuevoEstado; }
      }
    }
    const { error } = await window.sb.from('mermas_residuo').delete().eq('id', merma.id);
    if (error) return { error };
    window.logActivity?.({
      modulo: esCobrar ? 'cxc' : 'cxp', accion: 'eliminar',
      entidad_id: merma.cuenta_id, entidad_label: merma.factura || merma.cuenta_id,
      detalles: { tipo: 'merma_residuo_revertida', monto: merma.monto },
    });
    return { ok: true };
  };

  // ─── Registrar pagos en CxC ───────────────────────────────────────────────
  window.registrarPagosCxC = async function (pagosLines) {
    // pagosLines: [{ cxcId, montoUsd, pagosNuevos: [{id,fecha,metodo,banco,referencia,monto,moneda,monto_usd,notas}] }]
    const emp = window.currentEmpresa || 'demo1';
    const results = [];
    const movimientosNuevos = [];
    const pagoIdsSeen = new Set(); // deduplicate movements when same pagosNuevos shared across CxCs

    for (const line of pagosLines) {
      const cxc = window.SSData.cuentasCobrar.find(c => c.id === line.cxcId);
      if (!cxc) continue;
      // A centavos ANTES de guardar: `pagado` es una columna de dinero y un 59,99999999999999
      // ahí adentro se arrastra a cada pantalla que reste `monto - pagado` (saldos de 0,00 que
      // no se pueden cobrar). Y cerrado por arriba con el saldo real, para que sobre-pagar no
      // deje `pagado > monto`.
      const nuevoPagado = Math.min(window.ssRound2(cxc.monto), window.ssRound2((cxc.pagado || 0) + line.montoUsd));
      const nuevoEstado = window.ssSaldada(nuevoPagado, cxc.monto) ? 'pagada' : 'parcial';
      const cxcCliente = cxc.cliente || cxc.cliente_id || null;
      // Fila de ASIGNACIÓN de este pago a ESTA factura (su porción line.montoUsd). Se guarda con
      // el MISMO id en el jsonb cc.pagos y en la tabla `pagos` para que mergePagos (loadAppData)
      // no la duplique. Un pago que cubre varias facturas → una fila por factura.
      // UNA FILA POR MÉTODO FÍSICO, no una sola por cuenta. Antes se elegía un método
      // "representante" (el primero con banco) y toda la porción de esta factura se le colgaba a
      // él, mientras que los MOVIMIENTOS bancarios sí se creaban uno por método. Con un cobro
      // repartido entre dos bancos eso abría dos agujeros: borrar el movimiento del SEGUNDO banco
      // no encontraba ninguna fila que revertir (la plata salía del banco y la deuda no volvía), y
      // borrar el del PRIMERO revertía el total —incluida la parte del otro banco, que seguía en
      // el banco—. Ahora cada movimiento tiene su fila `${pago.id}::${cxcId}` y revertirlo devuelve
      // exactamente lo suyo.
      const metodos  = (line.pagosNuevos || []).filter(Boolean);
      const totalMet = metodos.reduce((s, p) => s + (Math.abs(parseFloat(p.monto_usd ?? p.monto)) || 0), 0);
      const filasPago = [];
      if ((line.montoUsd || 0) > 0) {
        const base = metodos.length ? metodos : [{}];
        let repartido = 0;
        base.forEach((pago, i) => {
          const cuentaB = pago.banco ? (window.SSData.cuentasBancarias || []).find(b => b.banco === pago.banco) : null;
          const peso = totalMet > 0 ? (Math.abs(parseFloat(pago.monto_usd ?? pago.monto)) || 0) / totalMet : 1 / base.length;
          // El ÚLTIMO se lleva el resto: repartir redondeando a 2 decimales y después sumar puede
          // no dar exactamente line.montoUsd, y esa diferencia dejaría la cuenta sin saldar por un
          // centavo (estado 'parcial' con saldo 0,01).
          const usd = (i === base.length - 1)
            ? Math.round((line.montoUsd - repartido) * 100) / 100
            : Math.round(line.montoUsd * peso * 100) / 100;
          repartido += usd;
          const moneda = pago.moneda || cuentaB?.moneda || 'USD';
          const ratio  = (pago.monto_usd && pago.monto_usd > 0) ? (usd / pago.monto_usd) : 1;
          filasPago.push({
            comprobante: pago.comprobante || null,
            row: {
              id: `${pago.id || ('PAG-' + Date.now() + '-' + i)}::${line.cxcId}`, empresa_id: emp, tipo: 'cobro',
              cliente_id: cxcCliente, proveedor_id: null,
              documento_id: cxc.factura || null, fecha: pago.fecha,
              monto: Math.round(((pago.monto ?? usd) * ratio) * 100) / 100, moneda,
              // Instante del cobro (el `fecha` es solo el día): con esto la tabla puede mostrar la hora.
              fecha_hora: new Date().toISOString(),
              monto_usd: usd, tasa: pago.tasa_usada ?? pago.tasa ?? null,
              metodo: pago.metodo || null, banco: pago.banco || null,
              cuenta_bancaria_id: cuentaB?.id || null, referencia: pago.referencia || null, notas: pago.notas || null,
            },
          });
        });
      }
      // El jsonb cc.pagos (dentro de cuentas_cobrar, que se carga MASIVO sin ventana de fecha) NO
      // lleva el comprobante (base64) — solo la tabla `pagos` (canónica, con ventana 365d + fetch
      // on-demand por id vía getPagoComprobante) lo guarda. Mismo id en ambos lados (ver arriba).
      const nuevosPagesList = [...(cxc.pagos || []), ...filasPago.map(f => f.row)];

      // El LEDGER se inserta PRIMERO — la cuenta no se toca si esto falla. Antes era al revés (se
      // marcaba 'pagada'/'parcial' y el ledger se insertaba en un lote al final): un solo error en
      // CUALQUIER fila de ese lote (id duplicado, columna faltante) tiraba TODO el insert y dejaba
      // la cuenta cobrando algo que la tabla `pagos` nunca llegó a tener. Auditado el 2026-08-14:
      // 220 filas así en producción — ver migracion-odoo/58 para la reparación de lo ya roto.
      const filasLedger = filasPago.map(f => ({ ...f.row, comprobante: f.comprobante, creado_por: window.__ssCurrentUser?.nombre || null }));
      const { error: eLedger } = await _persistirPagos(filasLedger);
      if (eLedger) { results.push({ cxcId: line.cxcId, error: eLedger }); continue; }

      const { error } = await window.sb.from('cuentas_cobrar').update({
        pagado: nuevoPagado, pagos: nuevosPagesList, estado: nuevoEstado,
      }).eq('id', line.cxcId);
      if (error) {
        // Rollback del ledger que se acaba de insertar: sin esto quedaría un pago "fantasma" que
        // no respalda ninguna cuenta (menos grave que el bug de arriba, pero igual de espurio).
        if (filasLedger.length) await window.sb.from('pagos').delete().in('id', filasLedger.map(r => r.id));
        results.push({ cxcId: line.cxcId, error });
        continue;
      }
      cxc.pagado = nuevoPagado;
      cxc.pagos  = nuevosPagesList;
      cxc.estado = nuevoEstado;

      const cliente = (window.SSData.clientes || []).find(c => c.id === cxc.cliente);
      // MOVIMIENTO bancario: uno por método FÍSICO (pago.id), deduped globalmente (el banco
      // recibió el pago completo una vez, no una porción por factura).
      for (const pago of line.pagosNuevos) {
        if (!pago.banco || pagoIdsSeen.has(pago.id)) continue;
        pagoIdsSeen.add(pago.id);
        const cuentaBanco = (window.SSData.cuentasBancarias || []).find(b => b.banco === pago.banco);
        const monedaPago  = pago.moneda || cuentaBanco?.moneda || 'USD';
        const montoUsd    = pago.monto_usd ?? pago.monto;
        const montoMov = monedaPago === 'VES' ? pago.monto : montoUsd;
        movimientosNuevos.push({
          id:          'MOV-' + Date.now() + '-' + Math.floor(Math.random() * 1000000),
          fecha:       pago.fecha,
          descripcion: `Cobro${cliente ? ' - ' + cliente.nombre : ''}`,
          monto:       montoMov,
          banco:       pago.banco,
          tipo:        'ingreso',
          conciliado:  false,
          match_id:    null,
          origen_app:  true,   // creado por la app (suma al saldo al crearse; conciliar es solo un flag)
          moneda:      monedaPago,
          monto_usd:   montoUsd,
          tasa:        pago.tasa_usada ?? pago.tasa ?? null,
          cuenta_bancaria_id: cuentaBanco?.id || null,
          // Quién registró el pago. Un movimiento bancario "creado por el sistema" no
          // dice nada útil: hay que poder saber qué persona lo gestionó.
          creado_por:  window.__ssCurrentUser?.nombre || null,
          pago_id:     pago.id,
          documento_id: cxc.factura || null,
          cliente_id:  cxcCliente,
        });
      }
      results.push({ cxcId: line.cxcId, error: null });
    }

    // El ledger (`pagos`) ya se insertó línea por línea, ANTES de tocar cada cuenta (ver arriba).

    // Insertar todos los movimientos bancarios en DB y en SSData local
    if (movimientosNuevos.length > 0) {
      const { error: movErr } = await window.sb.from('movimientos_bancarios').insert(movimientosNuevos.map(m => ({ ...m, empresa_id: window.currentEmpresa || 'demo1' })));
      if (!movErr) {
        (window.SSData.movsBancarios = window.SSData.movsBancarios || []).unshift(
          ...movimientosNuevos.map(m => ({ ...m, matchId: m.match_id }))
        );
        // Saldo = Σ movimientos: el cobro suma al saldo desde que se crea (no al conciliar).
        for (const cid of [...new Set(movimientosNuevos.map(m => m.cuenta_bancaria_id).filter(Boolean))]) await recomputeSaldoCuenta(cid);
      } else {
        console.error('[Supabase] Error creando movimientos bancarios:', movErr);
      }
    }

    return results;
  };

  // Persiste filas en la tabla `pagos` y las refleja en SSData.pagos + __ssPagosPorDoc. Devuelve
  // `{error}` — antes se tragaba el error en un `console.error` y seguía como si nada, así que
  // `registrarPagosCxC/CxP` ya habían marcado la cuenta 'pagada'/'parcial' con un pago que NUNCA
  // llegó a existir en la tabla canónica (huérfano desde el nacimiento, no por borrado posterior).
  // Auditado el 2026-08-14: 220 filas en CxC + 125 en CxP, repartidas en 8 días distintos — no un
  // incidente puntual, un bug estructural. Por eso ahora se llama ANTES de tocar la cuenta (ver
  // abajo), no después en un solo lote al final.
  async function _persistirPagos(pagosRows) {
    if (!pagosRows || pagosRows.length === 0) return { ok: true };
    // `fecha_hora` vive en el jsonb `pagos` de CxC/CxP (ver "Hora del sistema" en CLAUDE.md) — la
    // tabla `pagos` (este ledger) NO tiene esa columna. Mandarla en el insert lo rechaza siempre
    // (PGRST204), y como el ledger se inserta ANTES de tocar la cuenta, esto bloqueaba CUALQUIER
    // pago (CxC y CxP, las dos empresas) desde el 2026-08-04. Se limpia acá, en el único punto de
    // inserción, para que ningún llamador tenga que acordarse.
    const rowsParaDb = pagosRows.map(({ fecha_hora, ...resto }) => resto);
    const { error } = await window.sb.from('pagos').insert(rowsParaDb);
    if (error) { console.error('[Supabase] Error insertando en pagos:', error); return { error }; }
    (window.SSData.pagos = window.SSData.pagos || []).unshift(...pagosRows);
    window.__ssPagosPorDoc = window.__ssPagosPorDoc || {};
    pagosRows.forEach(p => {
      if (!p.documento_id) return;
      (window.__ssPagosPorDoc[p.documento_id] = window.__ssPagosPorDoc[p.documento_id] || []).push(p);
    });
    return { ok: true };
  }

  // Comprobante de un pago (cobro CxC) — on-demand (excluido de la carga masiva de `pagos`).
  // Si el pago se registró en esta sesión, ya está en memoria (evita el round-trip).
  window.getPagoComprobante = async function (pagoId) {
    const enMemoria = (window.SSData.pagos || []).find(p => p.id === pagoId);
    if (enMemoria?.comprobante) return { data: enMemoria.comprobante };
    const { data, error } = await window.sb.from('pagos').select('comprobante').eq('id', pagoId).maybeSingle();
    if (error) return { error };
    return { data: data?.comprobante || null };
  };

  // ─── Registrar pagos en CxP (egresos: pagos a proveedores o vueltos a clientes) ───
  window.registrarPagosCxP = async function (pagosLines) {
    // pagosLines: [{ cxpId, montoUsd, pagosNuevos: [{id,fecha,metodo,banco,referencia,monto,moneda,monto_usd,notas}] }]
    const emp = window.currentEmpresa || 'demo1';
    const results = [];
    const movimientosNuevos = [];
    const pagoIdsSeen = new Set();

    for (const line of pagosLines) {
      const cxp = (window.SSData.cuentasPagar || []).find(c => c.id === line.cxpId);
      if (!cxp) continue;
      // Mismo criterio que en CxC: a centavos antes de escribir (ver ssRound2/ssSaldada).
      const nuevoPagado = Math.min(window.ssRound2(cxp.monto), window.ssRound2((cxp.pagado || 0) + line.montoUsd));
      const nuevoEstado = window.ssSaldada(nuevoPagado, cxp.monto) ? 'pagada' : 'parcial';
      const cxpCliente = cxp.tipo === 'vuelto' ? (cxp.cliente || cxp.cliente_id || null) : null;
      const cxpProveedor = cxp.tipo === 'vuelto' ? null : (cxp.proveedor || cxp.proveedor_id || null);
      const concepto = cxp.tipo === 'vuelto' ? 'Vuelto' : 'Pago';
      // Fila de asignación de este egreso a ESTE documento (mismo id en jsonb y tabla → sin duplicar).
      // Una fila por método físico — mismo criterio que en CxC (ver el comentario largo allá): con
      // un pago repartido entre dos bancos, una sola fila deja el egreso del segundo banco sin nada
      // que revertir al borrarlo.
      const metodosP  = (line.pagosNuevos || []).filter(Boolean);
      const totalMetP = metodosP.reduce((s, p) => s + (Math.abs(parseFloat(p.monto_usd ?? p.monto)) || 0), 0);
      const filasPagoP = [];
      if ((line.montoUsd || 0) > 0) {
        const baseP = metodosP.length ? metodosP : [{}];
        let repartidoP = 0;
        baseP.forEach((pago, i) => {
          const cuentaB = pago.banco ? (window.SSData.cuentasBancarias || []).find(b => b.banco === pago.banco) : null;
          const peso = totalMetP > 0 ? (Math.abs(parseFloat(pago.monto_usd ?? pago.monto)) || 0) / totalMetP : 1 / baseP.length;
          const usd = (i === baseP.length - 1)
            ? Math.round((line.montoUsd - repartidoP) * 100) / 100
            : Math.round(line.montoUsd * peso * 100) / 100;
          repartidoP += usd;
          const moneda = pago.moneda || cuentaB?.moneda || 'USD';
          const ratio  = (pago.monto_usd && pago.monto_usd > 0) ? (usd / pago.monto_usd) : 1;
          filasPagoP.push({
            id: `${pago.id || ('PAG-' + Date.now() + '-' + i)}::${line.cxpId}`, empresa_id: emp, tipo: 'egreso',
            cliente_id: cxpCliente, proveedor_id: cxpProveedor,
            documento_id: cxp.factura || null, fecha: pago.fecha,
            monto: Math.round(((pago.monto ?? usd) * ratio) * 100) / 100, moneda,
            // Instante del pago (el `fecha` es solo el día).
            fecha_hora: new Date().toISOString(),
            monto_usd: usd, tasa: pago.tasa_usada ?? pago.tasa ?? null,
            metodo: pago.metodo || null, banco: pago.banco || null,
            cuenta_bancaria_id: cuentaB?.id || null, referencia: pago.referencia || null, notas: pago.notas || null,
          });
        });
      }
      const nuevosPagesList = [...(Array.isArray(cxp.pagos) ? cxp.pagos : []), ...filasPagoP];

      // El LEDGER se inserta PRIMERO — mismo motivo que en registrarPagosCxC (ver ese comentario):
      // sin esto, un solo error en el insert en lote de fin de función dejaba la CxP 'pagada' con
      // un pago que nunca existió en la tabla `pagos`. 125 filas así auditadas el 2026-08-14.
      const filasLedgerP = filasPagoP.map(f => ({ ...f, creado_por: window.__ssCurrentUser?.nombre || null }));
      const { error: eLedgerP } = await _persistirPagos(filasLedgerP);
      if (eLedgerP) { results.push({ cxpId: line.cxpId, error: eLedgerP }); continue; }

      const { error } = await window.sb.from('cuentas_pagar').update({
        pagado: nuevoPagado, pagos: nuevosPagesList, estado: nuevoEstado,
      }).eq('id', line.cxpId);
      if (error) {
        if (filasLedgerP.length) await window.sb.from('pagos').delete().in('id', filasLedgerP.map(r => r.id));
        results.push({ cxpId: line.cxpId, error });
        continue;
      }
      cxp.pagado = nuevoPagado;
      cxp.pagos  = nuevosPagesList;
      cxp.estado = nuevoEstado;

      // Si es CxP de comisión y quedó pagada, marcar docs vinculados como comisión pagada
      if (nuevoEstado === 'pagada' && Array.isArray(cxp.doc_ids) && cxp.doc_ids.length > 0) {
        await window.sb.from('documentos').update({ comision_estado: 'pagada' }).in('id', cxp.doc_ids);
        (window.SSData.documentos || []).forEach(d => {
          if (cxp.doc_ids.includes(d.id)) d.comision_estado = 'pagada';
        });
      }

      // EGRESO bancario.
      const beneficiario = cxp.tipo === 'vuelto'
        ? (window.SSData.clientes || []).find(c => c.id === cxp.cliente)
        : (window.SSData.proveedores || []).find(p => p.id === cxp.proveedor);
      // EGRESO bancario: uno por método FÍSICO (pago.id), deduped. La moneda se deriva de
      // pago.moneda (no del match por nombre, que puede dar cuenta de moneda equivocada — bug #31).
      for (const pago of line.pagosNuevos) {
        if (!pago.banco || pagoIdsSeen.has(pago.id)) continue;
        pagoIdsSeen.add(pago.id);
        const cuentaBanco = (window.SSData.cuentasBancarias || []).find(b => b.banco === pago.banco);
        const monedaPago = pago.moneda || cuentaBanco?.moneda || 'USD';
        const montoUsd   = pago.monto_usd ?? pago.monto;
        const montoMov = monedaPago === 'VES' ? pago.monto : montoUsd;
        movimientosNuevos.push({
          id:          'MOV-' + Date.now() + '-' + Math.floor(Math.random() * 1000000),
          fecha:       pago.fecha,
          descripcion: `${concepto}${beneficiario ? ' - ' + beneficiario.nombre : ''}`,
          monto:       -Math.abs(montoMov), // egreso = negativo
          banco:       pago.banco,
          tipo:        'egreso',
          conciliado:  false,
          match_id:    null,
          origen_app:  true,   // creado por la app (suma al saldo al crearse; conciliar es solo un flag)
          moneda:      monedaPago,
          monto_usd:   montoUsd,
          tasa:        pago.tasa_usada ?? pago.tasa ?? null,
          cuenta_bancaria_id: cuentaBanco?.id || null,
          // Quién registró el pago. Un movimiento bancario "creado por el sistema" no
          // dice nada útil: hay que poder saber qué persona lo gestionó.
          creado_por:  window.__ssCurrentUser?.nombre || null,
          pago_id:     pago.id,
          documento_id: cxp.factura || null,
          cliente_id:  cxpCliente,
          // El rubro del gasto viaja DESDE la cuenta por pagar. Sin esto el movimiento nace sin
          // categoría y el desglose "En qué se gastó" lo tira a "Sin categoría": la migración 38
          // clasificó lo que había en ese momento, pero era un backfill de una sola vez y nada
          // mantenía el dato vivo — cada gasto nuevo degradaba el reporte. Mismo criterio que
          // usó la 38 (la categoría de la CxP que el pago salda).
          // Ojo: un pago físico puede saldar VARIAS CxP (por eso el dedup por `pago.id`); el
          // movimiento se queda con la categoría de la primera, igual que ya hace con
          // `documento_id` y `cliente_id`.
          categoria:   cxp.categoria || null,
        });
      }
      results.push({ cxpId: line.cxpId, error: null });
    }

    // El ledger (`pagos`) ya se insertó línea por línea, ANTES de tocar cada cuenta (ver arriba).

    if (movimientosNuevos.length > 0) {
      const { error: movErr } = await window.sb.from('movimientos_bancarios').insert(movimientosNuevos.map(m => ({ ...m, empresa_id: window.currentEmpresa || 'demo1' })));
      if (!movErr) {
        (window.SSData.movsBancarios = window.SSData.movsBancarios || []).unshift(
          ...movimientosNuevos.map(m => ({ ...m, matchId: m.match_id }))
        );
        // Saldo = Σ movimientos: el egreso resta del saldo desde que se crea (no al conciliar).
        for (const cid of [...new Set(movimientosNuevos.map(m => m.cuenta_bancaria_id).filter(Boolean))]) await recomputeSaldoCuenta(cid);
      } else {
        console.error('[Supabase] Error creando egresos bancarios:', movErr);
      }
    }

    return results;
  };

  // ─── Listas del flujo: los contadores de las sub-pestañas en UN viaje ──────
  // Eran 3 HEAD counts (uno por pestaña) al abrir la lista, y otros 3 con cada cambio de filtro.
  // Ninguno pesa —son counts— pero son viajes en la pantalla donde más se trabaja. Los filtros que
  // se mandan tienen que ser los mismos que aplica la lista (ver migracion-odoo/28).
  window.getSubtabCounts = async function (tipo, filtros = {}, clienteIds = null) {
    const e = window.currentEmpresa || 'demo1';
    const limpio = {};
    Object.entries(filtros).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== '') limpio[k] = v; });
    const { data, error } = await window.sb.rpc('get_subtab_counts', {
      p_empresa_id: e, p_tipo: tipo, p_filtros: limpio,
      p_cliente_ids: (clienteIds && clienteIds.length) ? clienteIds.slice(0, 300) : null,
    });
    if (error) { console.warn('[getSubtabCounts]', error.message); return null; }
    return data || null;
  };

  // ─── Seriales de un producto: conteos + una página, en UN viaje ────────────
  // El modal traía TODOS los seriales del sku (1.733 filas / 976 kB en el más movido) para mostrar
  // una tabla paginada y cinco contadores. Los contadores necesitan el total, así que se cuentan en
  // el server y solo viaja la página. Ver migracion-odoo/30.
  window.getSerialesProducto = async function (sku, opts = {}) {
    if (!sku) return null;
    const e = window.currentEmpresa || 'demo1';
    const pageSize = opts.pageSize || 50;
    const page = Math.max(1, opts.page || 1);
    const { data, error } = await window.sb.rpc('get_seriales_producto', {
      p_empresa_id: e, p_sku: sku,
      p_estado: opts.estado && opts.estado !== 'todos' ? opts.estado : null,
      p_buscar: (opts.buscar || '').trim() || null,
      p_limit: pageSize, p_offset: (page - 1) * pageSize,
    });
    if (error) { console.warn('[getSerialesProducto]', error.message); return null; }
    return data || null;
  };

  // ─── Panel de almacén de Despachos: los 5 números en UN viaje ──────────────
  // Eran dos consultas, una de ellas bajando hasta 5.000 despachos pendientes (333 filas, 29 kB)
  // para clasificarlos en el navegador. La clasificación depende de `driver_despachos` y de
  // `entregado_en`, las dos en la base: la hace el server (migracion-odoo/29). El plazo de entrega
  // se pasa desde la UI para no tener el número escrito en dos lados.
  window.getDespachoPanelCounts = async function (plazoDias) {
    const e = window.currentEmpresa || 'demo1';
    const { data, error } = await window.sb.rpc('get_despacho_panel_counts', {
      p_empresa_id: e, p_plazo_dias: plazoDias || 3,
    });
    if (error) { console.warn('[getDespachoPanelCounts]', error.message); return null; }
    return data || null;
  };

  // ─── Detalle de un documento: ítems + linaje + seriales en UN viaje ────────
  // Abrir un documento es la acción más repetida del sistema y costaba 3 consultas (4 en despacho,
  // que no guarda líneas propias y tiene que ir a buscar las de su factura). La RPC resuelve eso
  // server-side, incluido el caso del despacho.
  // Las líneas vuelven mapeadas al shape que usa la UI (`qty`, `precio`, …), el mismo que devuelve
  // `loadDocumentoItems`: así el detalle no tiene que saber de dónde vinieron.
  window.getDocumentoDetalle = async function (id) {
    if (!id) return null;
    const { data, error } = await window.sb.rpc('get_documento_detalle', { p_id: id });
    if (error) { console.warn('[getDocumentoDetalle]', error.message); return null; }
    if (!data) return null;
    return {
      doc: data.doc || null,          // la fila COMPLETA: la lista viaja proyectada
      items: mapDocItems(data.items || []),
      items_de: data.items_de || id,       // de qué documento salieron (un despacho usa los de su factura)
      linaje: data.linaje || [],
      seriales: data.seriales || [],
    };
  };

  // ─── Pagos (365 d): SOLO en las pantallas de plata ─────────────────────────
  // El ledger `pagos` es la fuente de los abonos: se indexa por factura y se UNE al jsonb de
  // CxC/CxP (sin sobrescribir, dedup por id) para que el detalle y las columnas de "Cobrados/Pagados"
  // muestren banco, forma de pago y fecha. Eran 2,8 MB en cada arranque; lo piden /cxc, /cxp,
  // /clientes, /banco y /anticipos.
  let _pagosEnMemoria = null;
  let _pagosEnVuelo = null;
  // UNIR jsonb (el histórico de cc.pagos) + tabla `pagos` sin sobrescribir: dedup por id. Antes se
  // reemplazaba cc.pagos con la tabla y desaparecían los abonos guardados solo en el jsonb.
  const mergePagos = (existing, fromTable) => {
    const arr = Array.isArray(existing) ? existing.slice() : [];
    const seen = new Set(arr.map(p => p && p.id).filter(Boolean));
    (fromTable || []).forEach(p => { if (!p.id || !seen.has(p.id)) { arr.push(p); if (p.id) seen.add(p.id); } });
    return arr;
  };
  function aplicarPagosACuentas() {
    const porDoc = window.__ssPagosPorDoc || {};
    (window.SSData.cuentasCobrar || []).forEach(cc => {
      const ps = porDoc[cc.factura]; if (ps && ps.length) cc.pagos = mergePagos(cc.pagos, ps);
    });
    (window.SSData.cuentasPagar || []).forEach(cp => {
      const ps = porDoc[cp.factura]; if (ps && ps.length) cp.pagos = mergePagos(cp.pagos, ps);
    });
  }
  window.ensurePagos = function () {
    const e = window.currentEmpresa || 'demo1';
    if (_pagosEnMemoria === e) return Promise.resolve(true);
    if (_pagosEnVuelo) return _pagosEnVuelo;
    // Columnas explícitas SIN `comprobante`: el comprobante (base64) se trae on-demand con
    // window.getPagoComprobante al abrir el pago.
    const cols = 'id,empresa_id,tipo,cliente_id,proveedor_id,documento_id,cuenta_ref,fecha,monto,moneda,'
      + 'monto_usd,tasa,metodo,banco,cuenta_bancaria_id,referencia,is_igtf,monto_igtf,origin_odoo,notas,'
      + 'created_at,categoria,creado_por';
    _pagosEnVuelo = fetchAll(() => window.sb.from('pagos').select(cols)
        .eq('empresa_id', e).gte('fecha', new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0])
        .order('fecha', { ascending: false }))
      .then(({ data }) => {
        _pagosEnVuelo = null;
        if (!Array.isArray(data)) return false;
        // Normalizar los nombres que espera la UI (metodo/tasa_usada/monto_usd/montoUsd)
        window.SSData.pagos = data.map(p => ({
          ...p,
          monto: parseFloat(p.monto) || 0,
          monto_usd: parseFloat(p.monto_usd) || 0,
          montoUsd: parseFloat(p.monto_usd) || 0,
          tasa_usada: p.tasa,
          metodo: p.metodo || p.banco || '—',
        }));
        const porDoc = {};
        window.SSData.pagos.forEach(p => { if (p.documento_id) (porDoc[p.documento_id] = porDoc[p.documento_id] || []).push(p); });
        window.__ssPagosPorDoc = porDoc;
        aplicarPagosACuentas();
        // Si CxC/CxP todavía no llegaron (Fase 2 va en paralelo), se rehace la unión cuando lleguen:
        // sin esto el detalle abriría sin los abonos y no habría nada que lo corrigiera.
        if (!window.__ssExtrasReady) {
          const alLlegar = () => { aplicarPagosACuentas(); window.removeEventListener('ss-data-extra-loaded', alLlegar); };
          window.addEventListener('ss-data-extra-loaded', alLlegar);
        }
        _pagosEnMemoria = e;
        window.dispatchEvent(new CustomEvent('ss-data-extra-loaded'));
        console.log('[Supabase] ✓ Pagos (365d):', data.length);
        return true;
      })
      .catch(err => { console.warn('[ensurePagos] falló', err); _pagosEnVuelo = null; return false; });
    return _pagosEnVuelo;
  };

  // ─── Movimientos bancarios (365 d): SOLO en Bancos ─────────────────────────
  // Eran 2,4 MB (5.469 filas) en el arranque de todos, y quien los usa es Bancos. El badge del
  // sidebar y el aviso del dashboard salen de `movsPendientes` (los sin conciliar, sin ventana: 34
  // filas, 17 kB), que sí se sigue cargando.
  let _movsEnMemoria = null;
  let _movsEnVuelo = null;
  window.ensureMovsBancarios = function () {
    const e = window.currentEmpresa || 'demo1';
    if (_movsEnMemoria === e) return Promise.resolve(true);
    if (_movsEnVuelo) return _movsEnVuelo;
    _movsEnVuelo = fetchAll(() => window.sb.from('movimientos_bancarios').select('*')
        .eq('empresa_id', e).gte('fecha', new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0])
        .order('fecha', { ascending: false }))
      .then(({ data }) => {
        _movsEnVuelo = null;
        if (!Array.isArray(data)) return false;
        window.SSData.movsBancarios = data.map(m => ({ ...m, monto: parseFloat(m.monto) || 0, matchId: m.match_id }));
        _movsEnMemoria = e;
        window.dispatchEvent(new CustomEvent('ss-data-extra-loaded'));
        console.log('[Supabase] ✓ Movimientos bancarios (365d):', data.length);
        return true;
      })
      .catch(err => { console.warn('[ensureMovsBancarios] falló', err); _movsEnVuelo = null; return false; });
    return _movsEnVuelo;
  };

  // ─── Movimientos por conciliar: TODOS, sin ventana de fecha ────────────────
  // `SSData.movsBancarios` está acotado a 365 días para no reventar el arranque
  // (25.595 movimientos). Pero el badge del sidebar y el contador por banco se
  // calculaban sobre ESA ventana, así que afuera decía 3 y adentro había 129: el
  // detalle del banco hace su propia consulta sin ventana.
  //
  // Los pendientes son POCOS por definición (se concilian y dejan de estar), así
  // que traerlos todos cuesta nada y da el número exacto. Se piden solo las
  // columnas que hacen falta para contar y sumar.
  window.loadMovsPendientes = async function () {
    const e = window.currentEmpresa || 'demo1';
    const { data, error } = await fetchAll(() => window.sb.from('movimientos_bancarios')
      .select('id, cuenta_bancaria_id, banco, monto, tipo, moneda, fecha, conciliado')
      .eq('empresa_id', e).eq('conciliado', false).order('fecha', { ascending: false }));
    if (error) { console.warn('[loadMovsPendientes]', error.message); return { error }; }
    window.SSData.movsPendientes = data || [];
    return { data };
  };

  // ─── Ventas trabadas: lo que se quedó a mitad del flujo ───────────────────
  //
  // Pedido del 2026-08-07: *"las notas que no están en el proceso completo deberían darnos una
  // alerta o algo en rojo"*. Una orden que nunca se facturó y una factura que nunca se despachó
  // están cada una en su lista, pero **nada dice que están paradas**: una factura cobrada y sin
  // despachar figura bajo "Cobradas", que se ve perfectamente sana.
  //
  // Va por RPC (`get_documentos_trabados`, migración 44) y no sobre `SSData.documentos` por dos
  // razones: los documentos no se cargan en el arranque, y la ventana de 90 días se perdería
  // justamente lo más viejo, que es lo que importa (la orden parada más vieja es de 2025-10-08).
  //
  // Son POCAS filas por definición (49 en las dos empresas juntas), así que se traen enteras: el
  // panel las lista con nombre y monto, no solo el número.
  // NO PUEDE FALLAR EN SILENCIO. La primera versión hacía `console.warn` y volvía sin tocar
  // `SSData.docsTrabados`; el panel leía "sin datos" y pintaba **"Ninguna venta parada: todas las
  // órdenes están facturadas"**. O sea: un fallo de red o de permisos se mostraba como buenas
  // noticias. Lo cazó el usuario el 2026-08-07 preguntando "¿seguro?" — y tenía razón.
  //
  // Ahora el resultado queda registrado en `SSData.docsTrabadosError`, y la pantalla distingue
  // TRES estados: cargando · no se pudo verificar · verificado y vacío. Un aviso que no sabe no
  // tiene derecho a decir que todo está bien.
  // Se piden SIN umbral de días (`p_dias: 0`) y cada pantalla decide qué mostrar:
  //  · Cuentas por Cobrar (pestaña "Por despachar") las quiere TODAS desde el minuto cero — es la
  //    lista operativa: cobré y todavía no salió la mercancía.
  //  · El panel del flujo y la Torre filtran por `DIAS_TRABADO` para no gritar por lo de hoy,
  //    que es operación normal.
  // Una sola consulta, dos lentes, cada una honesta sobre lo que muestra.
  window.DIAS_TRABADO = 7;
  window.loadDocsTrabados = async function (dias) {
    const e = window.currentEmpresa || 'demo1';
    const pedir = () => window.sb.rpc('get_documentos_trabados', {
      p_empresa: e, p_dias: dias ?? 0,
    });
    let { data, error } = await pedir();
    // Un reintento: en el arranque esta llamada compite con la restauración de la sesión, y sin
    // JWT la RPC (que es `security invoker`) muere con 42501 "permission denied for table
    // documentos". Reintentar una vez cubre esa carrera sin agregar un viaje en el caso normal.
    if (error) {
      await new Promise(r => setTimeout(r, 1200));
      ({ data, error } = await pedir());
    }
    if (error) {
      console.warn('[loadDocsTrabados]', error.message);
      window.SSData.docsTrabadosError = error.message || 'Error desconocido';
      window.dispatchEvent(new Event('ss-data-extra-loaded'));
      return { error };
    }
    window.SSData.docsTrabados = data || [];
    window.SSData.docsTrabadosError = null;
    window.dispatchEvent(new Event('ss-data-extra-loaded'));
    return { data };
  };

  // ─── Recálculo de saldo (MODELO: saldo = Σ movimientos) ───────────────────
  // El saldo de una cuenta SIEMPRE es la suma de sus movimientos (ingreso +, egreso −),
  // incluidos los históricos migrados de Odoo. Tras CUALQUIER cambio de movimientos se
  // recalcula server-side (RPC recompute_saldo_cuenta) y se refleja en memoria. Conciliar NO
  // mueve el saldo (es solo un flag): el movimiento ya cuenta desde que se crea.
  async function recomputeSaldoCuenta(cuentaId) {
    if (!cuentaId) return null;
    const { data, error } = await window.sb.rpc('recompute_saldo_cuenta', { p_cuenta_id: cuentaId });
    if (error) { console.warn('[recomputeSaldo]', cuentaId, error.message); return null; }
    const nuevo = (data == null ? null : parseFloat(data));
    const cta = (window.SSData.cuentasBancarias || []).find(c => c.id === cuentaId);
    if (cta && nuevo != null) cta.saldo = nuevo;
    return nuevo;
  }
  window.recomputeSaldoCuenta = recomputeSaldoCuenta;

  // ─── Métodos de pago (catálogo CRUD por empresa) ──────────────────────────
  // El código (`codigo`) es lo que guarda cuentas_bancarias.metodos_pago y consumen los modales de
  // pago; es INMUTABLE al editar (renombrar solo cambia el label). Fallback (con `id`, para que el
  // CRUD funcione sobre él) si el catálogo aún no cargó o la empresa no tiene ninguno.
  const _METODOS_DEFAULT = [
    { id:'_def_transferencia', codigo:'transferencia', label:'Transferencia', icon:'bank',    monedas:['USD','VES'], sin_banco:false, activo:true, orden:1 },
    { id:'_def_zelle',         codigo:'zelle',         label:'Zelle',         icon:'dollar',  monedas:['USD'],       sin_banco:false, activo:true, orden:2 },
    { id:'_def_binance',       codigo:'binance',       label:'Binance',       icon:'binance', monedas:['USD'],       sin_banco:false, activo:true, orden:3 },
    { id:'_def_movil',         codigo:'movil',         label:'Pago Móvil',    icon:'phone',   monedas:['VES'],       sin_banco:false, activo:true, orden:4 },
    { id:'_def_efectivo',      codigo:'efectivo',      label:'Efectivo',      icon:'cash',    monedas:['USD','VES'], sin_banco:true,  activo:true, orden:5 },
  ];
  // window.SSData.metodosPago queda `undefined` hasta que Fase 2 carga (fallback a defaults) y
  // pasa a ser un array real (incl. []) una vez cargado — así "el usuario borró todos" ([] real)
  // no se confunde con "aún no cargó" (undefined) y no resucita los defaults tras vaciar la lista.
  window.getMetodosPago = function () {
    const arr = window.SSData?.metodosPago;
    return Array.isArray(arr) ? (arr.length ? arr : []) : _METODOS_DEFAULT;
  };
  window.saveMetodoPago = async function (m) {
    const e = window.currentEmpresa || 'demo1';
    if (!(m.label || '').trim()) return { error: { message: 'El nombre del método es obligatorio.' } };
    let codigo = m.codigo;   // inmutable al editar
    if (!codigo) codigo = (m.label || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
    if (!codigo) return { error: { message: 'Nombre inválido.' } };
    // Al CREAR: si el código generado ya existe en el catálogo (colisión de nombre → mismo slug),
    // rechazar explícitamente. Sin este check, el upsert por id (abajo) pisaría en silencio la fila
    // existente (mismo id = empresa+codigo) antes de que la constraint unique pudiera avisar.
    if (!m.id) {
      const existente = (window.getMetodosPago() || []).find(x => x.codigo === codigo);
      if (existente) return { error: { message: `Ya existe un método con ese nombre ("${existente.label}"). Usa otro nombre o edita el existente.` } };
    }
    const monedas = Array.isArray(m.monedas) && m.monedas.length ? m.monedas : ['USD', 'VES'];
    const row = {
      id: m.id || (e + '_' + codigo),
      codigo, label: m.label.trim(), icon: m.icon || '', monedas,
      sin_banco: !!m.sin_banco, activo: m.activo !== false, orden: Number(m.orden) || 0, empresa_id: e,
    };
    const { error } = await window.sb.from('metodos_pago').upsert(row, { onConflict: 'id' });
    if (error) return { error };
    const list = (window.SSData.metodosPago = Array.isArray(window.SSData.metodosPago) ? window.SSData.metodosPago : []);
    const i = list.findIndex(x => x.id === row.id);
    if (i >= 0) list[i] = { ...list[i], ...row }; else list.push(row);
    list.sort((a, b) => (a.orden || 0) - (b.orden || 0));
    window.logActivity?.({ modulo: 'bank', accion: m.id ? 'editar' : 'crear', entidad_id: row.id, entidad_label: row.label, detalles: { tipo: 'metodo_pago', monedas } });
    return { ok: true, metodo: row };
  };
  // Cuántas cuentas bancarias tienen este método asignado (para advertir antes de borrar).
  window.contarBancosConMetodo = function (codigo) {
    return (window.SSData.cuentasBancarias || []).filter(b => (b.metodos_pago || []).includes(codigo)).length;
  };
  window.deleteMetodoPago = async function (id) {
    if (!id) return { error: { message: 'Falta el id del método.' } };
    if (id.startsWith('_def_')) return { error: { message: 'Este método aún no existe en tu catálogo (es un valor por defecto) — créalo primero para poder editarlo o borrarlo.' } };
    const metodo = (window.SSData.metodosPago || []).find(x => x.id === id);
    const { data, error } = await window.sb.from('metodos_pago').delete().eq('id', id).select('id');
    if (error) return { error };
    if (!data || data.length === 0) return { error: { message: 'No se encontró el método (puede que ya haya sido eliminado).' } };
    if (Array.isArray(window.SSData.metodosPago)) window.SSData.metodosPago = window.SSData.metodosPago.filter(x => x.id !== id);
    if (metodo) window.ssTrash?.add('metodoPago', metodo.label, metodo);
    window.logActivity?.({ modulo: 'bank', accion: 'eliminar', entidad_id: id, entidad_label: metodo?.label, detalles: { tipo: 'metodo_pago' } });
    return { ok: true };
  };
  window.ssTrashHandlers = window.ssTrashHandlers || {};
  window.ssTrashHandlers.metodoPago = async function (data) {
    const { id, ...rest } = data;
    return await window.saveMetodoPago({ ...rest, id: null, codigo: null });   // restaura como método nuevo (código puede regenerar distinto si el original fue reusado)
  };
  // Restaurar un movimiento bancario: re-insertar la fila y recomputar el saldo de su cuenta.
  window.ssTrashHandlers.movimientoBancario = async function (data) {
    if (!data?.id) return { error: 'Sin ID para restaurar' };
    // Las claves con `_` son del snapshot, no columnas de la tabla: el insert las rechazaría.
    const fila = {}; Object.keys(data).forEach(k => { if (k[0] !== '_') fila[k] = data[k]; });
    const { error } = await window.sb.from('movimientos_bancarios').insert([fila]);
    if (error && error.code !== '23505') return { error: error.message };
    // Si al borrarlo se revirtió un cobro/pago, restaurarlo tiene que volver a saldarlo: si no,
    // la plata vuelve al banco y la factura queda por cobrar (la misma inconsistencia al revés).
    const pagos = Array.isArray(data._pagosRevertidos) ? data._pagosRevertidos : [];
    if (pagos.length) {
      const { error: ePag } = await window.sb.from('pagos').upsert(pagos, { onConflict: 'id' });
      if (ePag) return { error: 'Se restauró el movimiento pero NO el cobro: ' + ePag.message };
      for (const p of pagos) {
        const cuentaId = String(p.id).split('::')[1];
        if (!cuentaId) continue;
        const tabla = p.tipo === 'cobro' ? 'cuentas_cobrar' : 'cuentas_pagar';
        const { data: cuenta } = await window.sb.from(tabla)
          .select('id, monto, pagado, pagos').eq('id', cuentaId).maybeSingle();
        if (!cuenta) continue;
        const antes = Array.isArray(cuenta.pagos) ? cuenta.pagos : [];
        if (antes.some(x => x && x.id === p.id)) continue;   // ya estaba: no sumar dos veces
        const jsonb  = [...antes, p];
        const monto  = parseFloat(cuenta.monto) || 0;
        const pagado = Math.round(((parseFloat(cuenta.pagado) || 0) + (parseFloat(p.monto_usd) || 0)) * 100) / 100;
        const estado = pagado <= 0 ? 'pendiente' : (monto > 0 && window.ssSaldada(pagado, monto) ? 'pagada' : 'parcial');
        await window.sb.from(tabla).update({ pagado, pagos: jsonb, estado }).eq('id', cuentaId);
      }
    }
    if (data.cuenta_bancaria_id && window.recomputeSaldoCuenta) await window.recomputeSaldoCuenta(data.cuenta_bancaria_id);
    await window.loadAppData?.();
    return { ok: true };
  };

  // ─── Ajuste de saldo de cuenta bancaria ──────────────────────────────────
  // Crea un movimiento de ajuste; el saldo se recalcula como Σ movimientos.
  // modo 'objetivo': saldoObjetivo es el saldo real deseado (se calcula el delta).
  // modo 'monto': tipo ('ingreso'|'egreso') + monto directo.
  window.crearAjusteBancario = async function ({ cuentaId, modo, saldoObjetivo, monto, tipo, motivo }) {
    const e = window.currentEmpresa || 'demo1';
    const cta = (window.SSData.cuentasBancarias || []).find(c => c.id === cuentaId);
    if (!cta) return { error: { message: 'Cuenta no encontrada' } };
    // 'objetivo': recalcular el saldo real (Σ movimientos) ANTES del delta, para que "fijar saldo
    // a X" sea exacto aunque la memoria del cliente esté desactualizada.
    const saldoActual = (modo === 'objetivo' ? await recomputeSaldoCuenta(cuentaId) : null) ?? (parseFloat(cta.saldo) || 0);
    let delta;
    if (modo === 'objetivo') delta = (parseFloat(saldoObjetivo) || 0) - saldoActual;
    else delta = (tipo === 'egreso' ? -1 : 1) * Math.abs(parseFloat(monto) || 0);
    delta = Math.round(delta * 100) / 100;
    if (!delta) return { error: { message: 'El ajuste resultante es 0.' } };
    const bcv = window.SSData?.tasa?.bcv || null;
    const abs = Math.abs(delta);
    const monto_usd = cta.moneda === 'USD' ? abs : (bcv ? Math.round((abs / bcv) * 100) / 100 : null);
    const id = 'MOV-AJU-' + Date.now();
    const row = {
      id, fecha: window.localDateStr(), banco: cta.banco,
      descripcion: 'Ajuste de saldo' + (motivo ? ' — ' + motivo : ''),
      monto: delta, tipo: delta > 0 ? 'ingreso' : 'egreso', conciliado: true, origen_app: true,
      empresa_id: e, moneda: cta.moneda, monto_usd, tasa: cta.moneda === 'USD' ? null : bcv,
      cuenta_bancaria_id: cuentaId,
      creado_por: window.__ssCurrentUser?.nombre || null,
    };
    const { error } = await window.sb.from('movimientos_bancarios').insert(row);
    if (error) return { error };
    // Saldo = Σ movimientos: recalcular tras insertar el ajuste (el movimiento ya lo refleja).
    const nuevoSaldo = await recomputeSaldoCuenta(cuentaId);
    window.logActivity?.({ modulo: 'bank', accion: 'editar', entidad_id: cuentaId, entidad_label: cta.banco, detalles: { tipo: 'ajuste', delta, saldo_anterior: saldoActual, saldo_nuevo: nuevoSaldo, motivo: motivo || null } });
    return { ok: true, delta, nuevoSaldo };
  };

  // ─── Traspaso entre cuentas bancarias ─────────────────────────────────────
  // Crea 2 movimientos (egreso origen + ingreso destino) enlazados por match_id,
  // y actualiza ambos saldos. Si las monedas difieren = compra de divisas: `tasa`
  // (Bs/USD) convierte el monto (VES→USD = /tasa, USD→VES = *tasa).
  // Cuentas bancarias de TODAS las empresas a las que el usuario tiene acceso (la RLS ya recorta:
  // `empresa_id = any(jwt_empresas())`). Se usa para el traspaso entre empresas — `SSData
  // .cuentasBancarias` solo trae las de la empresa activa.
  window.loadCuentasBancariasTodas = async function () {
    const { data, error } = await window.sb.from('cuentas_bancarias')
      .select('id, banco, cuenta, moneda, saldo, empresa_id, tipo, titular, metodos_pago')
      .order('empresa_id').order('banco');
    if (error) { console.error('[loadCuentasBancariasTodas]', error); return { error }; }
    return { data: data || [] };
  };

  // ─── Reporte de gastos del período (el que se le manda a la contadora) ─────────────────────
  // Trae los EGRESOS de banco y los separa en GASTOS REALES vs AJUSTES DE SALDO. Los ajustes se
  // reconocen por el prefijo del id (`MOV-AJU-`), que es como los crea la app; no por la
  // descripción, que es texto libre y se edita.
  //
  // La separación no es cosmética: medido el 2026-08-04 sobre julio-agosto, `demo1` tenía
  // $3.697.330 en ajustes de apertura del go-live contra $20.899 de gasto real. Sumarlos —que es
  // lo que hacía el panel— informa 177 veces el gasto. Ver migracion-odoo/34.
  //
  // Se piden las empresas explícitas porque a la contadora se le manda Demo 1 Y Demo 2; la RLS
  // recorta igual a las que el usuario tenga (`empresa_id = any(jwt_empresas())`).
  // Son ~171 egresos en TODA la historia, así que no hace falta paginar.
  window.loadGastosPeriodo = async function ({ desde, hasta, empresas } = {}) {
    const emps = (empresas && empresas.length) ? empresas : [window.currentEmpresa || 'demo1'];
    let q = window.sb.from('movimientos_bancarios')
      .select('id, fecha, empresa_id, descripcion, monto, monto_usd, moneda, tasa, conciliado, categoria, ' +
              'creado_por, created_at, pago_id, documento_id, cuentas_bancarias(banco, cuenta, moneda)')
      .in('empresa_id', emps).eq('tipo', 'egreso');
    if (desde) q = q.gte('fecha', desde);
    if (hasta) q = q.lte('fecha', hasta);
    const { data, error } = await q.order('fecha', { ascending: false }).limit(5000);
    if (error) { console.error('[loadGastosPeriodo]', error); return { error }; }
    const filas = (data || []).map(m => ({
      id: m.id,
      fecha: m.fecha,
      empresa: m.empresa_id,
      banco: m.cuentas_bancarias?.banco || '(sin banco)',
      cuenta: m.cuentas_bancarias?.cuenta || '',
      moneda: m.cuentas_bancarias?.moneda || m.moneda || '',
      // `monto` viene NEGATIVO en los egresos (convención de la tabla). Para un reporte de gastos
      // se informa el valor absoluto: la columna ya dice que es un gasto.
      monto: Math.abs(Number(m.monto) || 0),
      monto_usd: Math.abs(Number(m.monto_usd) || 0),
      tasa: m.tasa == null ? '' : Number(m.tasa),
      categoria: m.categoria || '(sin categoria)',
      descripcion: m.descripcion || '',
      conciliado: m.conciliado ? 'Sí' : 'No',
      registrado_por: m.creado_por || '',
      documento: m.documento_id || '',
    }));
    // Las INVERSIONES (capex) tampoco son gasto operativo: salen del banco pero compran un activo.
    // `get_finanzas_reporte` las excluye con el mismo prefijo (`MOV-INV-`), y acá se colaban en
    // `gastos` — el Excel que se le manda a la contadora informaba más gasto que el panel que la
    // contadora tiene al lado. Se separan igual que los ajustes: no se esconden, se nombran.
    // Los TRASPASOS entre cuentas propias (`crearTraspasoBancario`, id `MOV-TRF-<epoch>-O/-D`)
    // tampoco son gasto: la plata sigue siendo de la empresa, solo cambió de banco. Se colaban acá
    // como "Sin categoría" (un traspaso nunca lleva rubro) e inflaban tanto el total de gastos como
    // el bucket de sin-clasificar — reportado el 2026-08-14 viendo $2.000 traspasos entre BINANCE/
    // BANESCO mezclados con gasto real.
    const esAjuste    = (f) => /^MOV-AJU-/.test(f.id);
    const esInversion = (f) => /^MOV-INV-/.test(f.id);
    const esTraspaso  = (f) => /^MOV-TRF-/.test(f.id);
    return {
      gastos:      filas.filter(f => !esAjuste(f) && !esInversion(f) && !esTraspaso(f)),
      ajustes:     filas.filter(esAjuste),
      inversiones: filas.filter(esInversion),
      traspasos:   filas.filter(esTraspaso),
    };
  };

  // Cambiar la categoría de una cuenta desde la tabla, sin abrir el detalle. Es el campo que hay
  // que corregir en tanda —clasificar lo que quedó sin categoría— y abrir un modal por cuenta
  // hacía inviable la tarea. `null` la deja sin categoría, que es un estado legítimo.
  window.updateCategoriaCuenta = async function (esCobrar, id, categoria) {
    const tabla = esCobrar ? 'cuentas_cobrar' : 'cuentas_pagar';
    const valor = categoria || null;
    const { error } = await window.sb.from(tabla).update({ categoria: valor }).eq('id', id);
    if (error) { console.error('[updateCategoriaCuenta]', error); return { error }; }
    // Reflejo en memoria: la tabla se pinta desde SSData y sin esto el cambio no se ve hasta
    // recargar el módulo.
    const lista = esCobrar ? window.SSData.cuentasCobrar : window.SSData.cuentasPagar;
    const i = (lista || []).findIndex(c => c.id === id);
    if (i !== -1) lista[i] = { ...lista[i], categoria: valor };
    window.logActivity?.({ modulo: esCobrar ? 'cxc' : 'cxp', accion: 'editar', entidad_id: id,
      entidad_label: id, detalles: { categoria: valor } });
    return { ok: true };
  };

  // ─── Inversiones (capex) ───────────────────────────────────────────────────────────────────
  // Una inversión saca plata del banco pero NO es gasto de la operación ni deuda con un proveedor:
  // por eso no vive en CxP y por eso su egreso bancario lleva el prefijo `MOV-INV-`, que es lo que
  // hace que `get_finanzas_reporte` la cuente en su propio renglón (migraciones 35-37).
  window.loadInversiones = async function ({ desde, hasta } = {}) {
    const e = window.currentEmpresa || 'demo1';
    let q = window.sb.from('inversiones')
      .select('*, cuentas_bancarias(banco, cuenta, moneda)')
      .eq('empresa_id', e);
    if (desde) q = q.gte('fecha', desde);
    if (hasta) q = q.lte('fecha', hasta);
    const { data, error } = await q.order('fecha', { ascending: false }).limit(2000);
    if (error) { console.error('[loadInversiones]', error); return { error }; }
    return { data: (data || []).map(r => ({ ...r, banco: r.cuentas_bancarias?.banco || '—' })) };
  };

  // Alta ATÓMICA: la inversión, su egreso bancario y el recálculo del saldo van en una sola
  // transacción. Con tres llamadas sueltas, si fallaba la segunda quedaba plata saliendo del banco
  // sin inversión que la explicara.
  window.crearInversion = async function (f) {
    const { data, error } = await window.sb.rpc('crear_inversion', {
      p_empresa_id:         window.currentEmpresa || 'demo1',
      p_fecha:              f.fecha,
      p_concepto:           f.concepto,
      p_categoria:          f.categoria || 'otro',
      p_beneficiario:       f.beneficiario || null,
      p_monto:              Number(f.monto) || 0,
      p_cuenta_bancaria_id: f.cuentaBancariaId,
      p_tasa:               f.tasa == null || f.tasa === '' ? null : Number(f.tasa),
      p_notas:              f.notas || null,
      p_creado_por:         window.__ssCurrentUser?.nombre || null,
    });
    if (error) { console.error('[crearInversion]', error); return { error }; }
    await window.ensureMovsBancarios?.();   // el saldo del banco cambió
    return { data };
  };

  // Baja: se lleva también el movimiento bancario, que existía solo para reflejarla. Borrar solo
  // la inversión dejaría un egreso huérfano en el banco.
  window.eliminarInversion = async function (id) {
    const { data, error } = await window.sb.rpc('eliminar_inversion', { p_id: id });
    if (error) { console.error('[eliminarInversion]', error); return { error }; }
    return { data };
  };

  window.crearTraspasoBancario = async function ({ origenId, destinoId, montoOrigen, tasa, descripcion, cuentas, anticipoCliente, anticipoOrigen }) {
    const e = window.currentEmpresa || 'demo1';
    // `cuentas` permite pasar las de otras empresas (traspaso entre empresas). Si no viene, se usan
    // las de la empresa activa y, como último recurso, se leen de la base: el destino puede no estar
    // en memoria justamente porque es de la otra empresa.
    let cs = (Array.isArray(cuentas) && cuentas.length) ? cuentas : (window.SSData.cuentasBancarias || []);
    let o = cs.find(c => c.id === origenId), d = cs.find(c => c.id === destinoId);
    if (!o || !d) {
      const { data } = await window.sb.from('cuentas_bancarias')
        .select('id, banco, moneda, saldo, empresa_id').in('id', [origenId, destinoId].filter(Boolean));
      cs = data || [];
      o = o || cs.find(c => c.id === origenId);
      d = d || cs.find(c => c.id === destinoId);
    }
    if (!o || !d) return { error: { message: 'Cuenta no encontrada.' } };
    if (origenId === destinoId) return { error: { message: 'El origen y el destino deben ser distintos.' } };
    const mo = Math.round((Math.abs(parseFloat(montoOrigen) || 0)) * 100) / 100;
    if (!mo) return { error: { message: 'El monto a traspasar debe ser mayor a 0.' } };
    // El traspaso es un egreso en la cuenta origen: valida que el saldo (= Σ movimientos) alcance.
    const saldoO0 = parseFloat(o.saldo) || 0;
    if (saldoO0 - mo < -0.001) {
      const disp = o.moneda === 'USD' ? ('$' + saldoO0.toFixed(2)) : ('Bs. ' + saldoO0.toFixed(2));
      return { error: { message: `Saldo insuficiente en ${o.banco}. Disponible: ${disp}. Registra los ingresos que falten o traspasa un monto menor.` } };
    }
    const distintaMoneda = o.moneda !== d.moneda;
    const t = parseFloat(tasa) || 0;
    if (distintaMoneda && t <= 0) return { error: { message: 'Falta la tasa para el traspaso entre monedas distintas.' } };
    let md; // monto destino
    if (!distintaMoneda) md = mo;
    else if (o.moneda === 'VES' && d.moneda === 'USD') md = mo / t;
    else if (o.moneda === 'USD' && d.moneda === 'VES') md = mo * t;
    else md = mo;
    md = Math.round(md * 100) / 100;
    const bcv = window.SSData?.tasa?.bcv || null;
    // Valor USD del traspaso: el lado en USD si hay cambio de moneda; si ambas iguales, se estima al BCV.
    let usdVal;
    if (distintaMoneda) usdVal = (o.moneda === 'USD') ? mo : md;
    else usdVal = (o.moneda === 'USD') ? mo : (bcv ? Math.round((mo / bcv) * 100) / 100 : null);
    const ref = 'TRF-' + Date.now();
    const tasaOrigen  = distintaMoneda ? t : (o.moneda === 'VES' ? bcv : null);
    const tasaDestino = distintaMoneda ? t : (d.moneda === 'VES' ? bcv : null);
    const nota = descripcion ? ' (' + descripcion + ')' : '';
    // ENTRE EMPRESAS: cada movimiento va con la empresa de SU cuenta, no con la empresa activa. Si
    // ambos se guardaran en la activa, el ingreso no aparecería en los libros de la otra empresa (la
    // RLS lo esconde) y su saldo quedaría descuadrado contra el banco real.
    const empO = o.empresa_id || e;
    const empD = d.empresa_id || e;
    const entreEmpresas = empO !== empD;
    const rotulo = (emp) => entreEmpresas ? ' [' + emp + ']' : '';
    const salida = {
      id: 'MOV-' + ref + '-O', fecha: window.localDateStr(), banco: o.banco, cuenta_bancaria_id: origenId,
      descripcion: 'Traspaso a ' + d.banco + rotulo(empD) + nota, monto: -mo, tipo: 'egreso', conciliado: true, origen_app: true,
      empresa_id: empO, moneda: o.moneda, monto_usd: usdVal, tasa: tasaOrigen, match_id: ref,
      creado_por: window.__ssCurrentUser?.nombre || null,
    };
    const entrada = {
      id: 'MOV-' + ref + '-D', fecha: window.localDateStr(), banco: d.banco, cuenta_bancaria_id: destinoId,
      descripcion: 'Traspaso desde ' + o.banco + rotulo(empO) + nota, monto: md, tipo: 'ingreso', conciliado: true, origen_app: true,
      empresa_id: empD, moneda: d.moneda, monto_usd: usdVal, tasa: tasaDestino, match_id: ref,
      creado_por: window.__ssCurrentUser?.nombre || null,
    };

    // Traspaso que además acredita el dinero como ANTICIPO de un cliente en la empresa DESTINO: el
    // objetivo no es solo mover plata entre bancos, es que ese cliente quede con saldo a favor allá.
    // Se inserta el `pago` (mismo modelo que `crearAnticipo`) y se enlaza por `pago_id` al movimiento
    // de ENTRADA que ya se iba a crear — no un movimiento nuevo, para no duplicar el ingreso.
    let pagoAnticipo = null;
    if (anticipoCliente?.clienteId) {
      const pagoId = 'PAG-ANT-' + ref;
      pagoAnticipo = {
        id: pagoId, empresa_id: empD, tipo: 'cobro', categoria: 'anticipo',
        cliente_id: anticipoCliente.clienteId, documento_id: null,
        fecha: window.localDateStr(), monto: md, moneda: d.moneda,
        monto_usd: d.moneda === 'USD' ? md : usdVal,
        tasa: tasaDestino, metodo: 'transferencia', banco: d.banco, cuenta_bancaria_id: destinoId,
        referencia: ref, notas: anticipoCliente.notas || ('Traspaso entre empresas desde ' + o.banco + rotulo(empO)),
        creado_por: window.__ssCurrentUser?.nombre || null,
      };
      entrada.pago_id = pagoId;
      entrada.cliente_id = anticipoCliente.clienteId;
      entrada.descripcion = 'Anticipo (traspaso) — ' + (anticipoCliente.clienteNombre || anticipoCliente.clienteId);
    }

    // ── DEBITAR el saldo a favor del cliente en la empresa de ORIGEN ────────────────────────
    // Pedido el 2026-08-13: "a lo mejor sigue quedando en anticipo en demo1; tendría que
    // debitarse el monto que se está pasando hacia demo2 de ese cliente también". Sin esto la
    // plata quedaba acreditada DOS veces: como saldo a favor en la empresa origen (donde el
    // cliente lo dejó) y otra vez en la destino.
    //
    // Va PRIMERO y por la RPC `aplicar_anticipo`: es la que bloquea el anticipo (`for update`) y
    // valida que el saldo alcance. Si no alcanza, se corta acá sin haber movido un peso. Se le
    // pasa `p_documento_id = null`: no se está pagando una factura, se está sacando la plata.
    let aplicacionOrigen = null;
    if (anticipoOrigen?.pagoId) {
      const montoDeb = Math.round((parseFloat(anticipoOrigen.montoUsd) || 0) * 100) / 100;
      if (!(montoDeb > 0)) return { error: { message: 'El monto a descontar del saldo a favor debe ser mayor a 0.' } };
      const { data: apl, error: eApl } = await window.sb.rpc('aplicar_anticipo', {
        p_pago_id: anticipoOrigen.pagoId, p_documento_id: null, p_monto: montoDeb,
        p_usuario: window.__ssCurrentUser?.nombre || null,
        p_notas: 'Traspasado a ' + d.banco + rotulo(empD) + (anticipoCliente?.clienteNombre ? ' (saldo a favor de ' + anticipoCliente.clienteNombre + ')' : ''),
      });
      if (eApl) return { error: eApl };
      aplicacionOrigen = apl?.aplicacion_id || null;
    }
    // Si algo falla más adelante hay que DESHACER el débito: si no, el cliente perdería saldo a
    // favor sin que la plata haya llegado a ningún lado.
    const deshacerDebito = async () => {
      if (!aplicacionOrigen) return;
      try { await window.sb.rpc('revertir_aplicacion_anticipo', { p_aplicacion_id: aplicacionOrigen, p_usuario: window.__ssCurrentUser?.nombre || null }); }
      catch (e) { console.error('[crearTraspasoBancario] no se pudo revertir el débito del anticipo', aplicacionOrigen, e); }
    };

    if (pagoAnticipo) {
      const { error: ePago } = await window.sb.from('pagos').insert(pagoAnticipo);
      if (ePago) { await deshacerDebito(); return { error: ePago }; }
    }
    const { error } = await window.sb.from('movimientos_bancarios').insert([salida, entrada]);
    if (error) {
      if (pagoAnticipo) await window.sb.from('pagos').delete().eq('id', pagoAnticipo.id);
      await deshacerDebito();
      return { error };
    }
    // Saldo = Σ movimientos: recalcular ambas cuentas tras insertar los 2 movimientos del traspaso.
    await recomputeSaldoCuenta(origenId);
    await recomputeSaldoCuenta(destinoId);
    window.logActivity?.({ modulo: 'bank', accion: 'editar', entidad_id: origenId,
      entidad_label: o.banco + ' → ' + d.banco,
      detalles: { tipo: entreEmpresas ? 'traspaso_entre_empresas' : 'traspaso', montoOrigen: mo, montoDestino: md,
                  tasa: distintaMoneda ? t : null, empresa_origen: empO, empresa_destino: empD, ref,
                  anticipo_cliente_id: anticipoCliente?.clienteId || null } });
    if (pagoAnticipo) {
      window.logActivity?.({ modulo: 'anticipos', accion: 'crear', entidad_id: pagoAnticipo.id,
        entidad_label: 'Anticipo ' + (pagoAnticipo.monto_usd || 0).toFixed(2) + ' USD (traspaso entre empresas)',
        detalles: { cliente_id: pagoAnticipo.cliente_id, monto: pagoAnticipo.monto, moneda: pagoAnticipo.moneda, empresa_id: empD } });
    }
    if (aplicacionOrigen) {
      window.logActivity?.({ modulo: 'anticipos', accion: 'aplicar', entidad_id: anticipoOrigen.pagoId,
        entidad_label: 'Saldo a favor descontado por traspaso a ' + d.banco,
        detalles: { aplicacion_id: aplicacionOrigen, monto: anticipoOrigen.montoUsd, empresa_id: empO, ref } });
    }
    // Los anticipos EN MEMORIA son los de la empresa activa: se recargan si el traspaso tocó
    // alguno (el crédito del destino o el débito del origen).
    if (pagoAnticipo || aplicacionOrigen) await window.loadAnticipos?.();
    return { ok: true, montoDestino: md, ref, entreEmpresas, pagoAnticipoId: pagoAnticipo?.id || null,
             aplicacionOrigenId: aplicacionOrigen };
  };

  // ─── Conciliar / desconciliar un movimiento bancario ─────────────────────
  // MODELO saldo = Σ movimientos: conciliar es SOLO un flag de reconciliación con el estado de
  // cuenta del banco. NO cambia el saldo — el movimiento ya cuenta desde que se crea. (Antes se
  // posteaba al saldo al conciliar; con el modelo actual eso duplicaría contra el recompute.)
  window.conciliarMovimientoBancario = async function ({ id, conciliado, matchId = null }) {
    if (!id) return { error: { message: 'Falta el id del movimiento.' } };
    const con = !!conciliado;
    const { data: mov, error: eSel } = await window.sb.from('movimientos_bancarios')
      .select('monto, cuenta_bancaria_id, conciliado, origen_app').eq('id', id).maybeSingle();
    if (eSel) return { error: eSel };
    if (!mov) return { error: { message: 'Movimiento no encontrado.' } };
    const { error } = await window.sb.from('movimientos_bancarios')
      .update({ conciliado: con, match_id: con ? (matchId || null) : null })
      .eq('id', id);
    if (error) return { error };
    // MODELO saldo = Σ movimientos: conciliar es SOLO un flag (el movimiento ya cuenta en el saldo
    // desde que se creó). No se toca el saldo aquí. Se refleja el flag en memoria para la UI.
    const movMem = (window.SSData.movsBancarios || []).find(m => m.id === id);
    if (movMem) { movMem.conciliado = con; movMem.match_id = con ? (matchId || null) : null; movMem.matchId = movMem.match_id; }
    // `movsPendientes` alimenta el badge del sidebar y el contador por banco: si no se
    // actualiza acá, los números quedan viejos hasta recargar la página.
    if (Array.isArray(window.SSData.movsPendientes)) {
      window.SSData.movsPendientes = con
        ? window.SSData.movsPendientes.filter(m => m.id !== id)
        : (window.SSData.movsPendientes.some(m => m.id === id)
            ? window.SSData.movsPendientes
            : [{ ...mov, id, conciliado: false }, ...window.SSData.movsPendientes]);
    }
    window.logActivity?.({ modulo: 'bank', accion: 'editar', entidad_id: id, detalles: { tipo: 'conciliacion', conciliado: con, match_id: con ? matchId : null } });
    return { ok: true };
  };

  // ─── Revertir el cobro/pago que respalda un movimiento bancario ───────────
  // Registrar un cobro escribe en CUATRO lugares (ver registrarPagosCxC): la cuenta
  // (pagado/pagos/estado), el ledger `pagos`, el movimiento bancario y —por el trigger
  // trg_cxc_sync_factura_cobro— documentos.estado_cobro/fecha_cobro. Borrar el movimiento
  // deshacía SOLO el tercero: la plata salía del banco y la factura seguía diciendo "Cobrada",
  // sin ninguna forma de deshacerlo desde la app. Esto deshace los otros dos; el cuarto se
  // arregla solo, porque el trigger reacciona al UPDATE de la cuenta.
  //
  // Corre ANTES de borrar el movimiento a propósito. Si algo falla a mitad queda "la deuda
  // volvió y el movimiento sigue en el banco": visible, y el reintento la termina. Al revés
  // quedaría "plata fuera del banco y factura cobrada", que es exactamente el bug.
  window.revertirCobroDeMovimiento = async function (mov) {
    const pagoId = mov && mov.pago_id;
    if (!pagoId) return { ok: true, revertidos: 0 };

    // Las filas de `pagos` son la ASIGNACIÓN del pago a cada cuenta: su id es
    // `${idFísico}::${cuentaId}` porque un mismo pago puede saldar varias facturas. El
    // movimiento bancario guarda el id FÍSICO, sin sufijo. Se piden las dos formas por
    // separado: el `::` evita que `PAG-123` se lleve puesto a `PAG-1234`.
    // Las filas van COMPLETAS (select *): son las que se guardan en la papelera para que
    // restaurar el movimiento pueda volver a poner el cobro tal cual estaba.
    const [exacta, asignadas] = await Promise.all([
      window.sb.from('pagos').select('*').eq('id', pagoId),
      window.sb.from('pagos').select('*').like('id', pagoId + '::%'),
    ]);
    if (exacta.error)    return { error: exacta.error };
    if (asignadas.error) return { error: asignadas.error };
    const filas = [...(exacta.data || []), ...(asignadas.data || [])];
    if (!filas.length) return { ok: true, revertidos: 0 };

    // Un anticipo NO se revierte por acá. Su saldo puede estar consumido por facturas
    // (`anticipos_aplicaciones`, con FK on delete restrict), y deshacer eso a ciegas movería
    // la deuda de documentos que no son este. Tiene su propio flujo en Finanzas → Anticipos.
    if (filas.some(f => f.categoria === 'anticipo')) {
      return { error: { message: 'Este movimiento es un ANTICIPO. Para eliminarlo entrá a Finanzas → Anticipos: si ya se aplicó a alguna factura, primero hay que revertir esa aplicación.' } };
    }

    // FALLA CERRADA: si alguna fila del ledger no dice a QUÉ cuenta se aplicó, no se borra nada.
    // El id de una asignación es `${idFísico}::${cuentaId}`; los pagos migrados de Odoo no llevan
    // ese sufijo (`PAG-<odoo_id>`, ver migracion-odoo/02_promover.sql). Antes esas filas caían en
    // un `continue` que salteaba la reversión —pero seguían en `filas` y se borraban igual abajo—,
    // así que borrar el movimiento DESTRUÍA el registro del pago y no devolvía ninguna deuda, con
    // el confirm prometiendo lo contrario. Medido contra producción el 2026-08-05: 25.561 de los
    // 25.740 movimientos con `pago_id` están en ese estado. Recuperarlo solo se podía desde la
    // papelera, y solo por 30 días.
    const sinCuenta = filas.filter(f => !String(f.id).split('::')[1]);
    if (sinCuenta.length) {
      return { error: { message:
        'Este movimiento respalda un pago histórico migrado de Odoo (' + sinCuenta[0].id + '), que no ' +
        'guarda a qué cuenta se aplicó. Borrarlo destruiría el registro del pago sin devolver la deuda, ' +
        'así que se bloquea. Si hay que corregirlo, hacelo desde la cuenta por cobrar o por pagar.' } };
    }

    const afectadas = [];
    for (const fila of filas) {
      const cuentaId = String(fila.id).split('::')[1];
      if (!cuentaId) continue;
      const esCobrar = fila.tipo === 'cobro';
      const tabla = esCobrar ? 'cuentas_cobrar' : 'cuentas_pagar';
      // La cuenta se relee de la BASE, no de SSData: pudo cobrar otra persona desde que se
      // cargó la pantalla, y restar sobre un `pagado` viejo la dejaría descuadrada.
      const { data: cuenta, error: eC } = await window.sb.from(tabla)
        .select(esCobrar ? 'id, monto, pagado, pagos, factura' : 'id, monto, pagado, pagos, factura, doc_ids')
        .eq('id', cuentaId).maybeSingle();
      if (eC) return { error: eC };
      // FALLA CERRADA (mismo criterio que `sinCuenta` arriba): la cuenta ya no existe — alguien la
      // borró por otro lado mientras este pago seguía vivo. Seguir de largo (como hacía antes,
      // `continue`) borraba el ledger igual al final y la plata "desaparecía" sin dejar deuda en
      // ningún lado. Bloquear es honesto: alguien tiene que decidir a mano si esa cuenta se
      // recrea o si el movimiento se queda desvinculado.
      if (!cuenta) {
        return { error: { message:
          `Este movimiento respalda un pago de la ${esCobrar ? 'cuenta por cobrar' : 'cuenta por pagar'} ` +
          `${cuentaId}, que ya no existe (fue eliminada). Borrar el movimiento dejaría esa plata sin ` +
          `ninguna deuda asociada. Si la cuenta se borró por error, restaurala desde la papelera antes ` +
          `de eliminar este movimiento; si el borrado fue correcto, desvinculá el movimiento en vez de eliminarlo.` } };
      }

      const antes  = Array.isArray(cuenta.pagos) ? cuenta.pagos : [];
      const jsonb  = antes.filter(p => p && p.id !== fila.id);
      // Si la entrada ya no estaba en el jsonb, un intento anterior llegó hasta acá: no se
      // vuelve a restar. Sin esto, reintentar tras un fallo dejaría la cuenta cobrando de menos.
      const yaQuitada = jsonb.length === antes.length;
      const previo = parseFloat(cuenta.pagado) || 0;
      const quitado = parseFloat(fila.monto_usd) || 0;
      const pagado = yaQuitada ? previo : Math.round(Math.max(0, previo - quitado) * 100) / 100;
      const monto  = parseFloat(cuenta.monto) || 0;
      const estado = pagado <= 0 ? 'pendiente' : (monto > 0 && window.ssSaldada(pagado, monto) ? 'pagada' : 'parcial');

      // Badge "Eliminado de banco": denormalizado (mismo patrón que `desvinculado_por/en/motivo`
      // de movimientos_bancarios) para que la lista/detalle lo muestren sin una consulta aparte.
      // Se estampa SIEMPRE que se quita una entrada de verdad (no en el reintento `yaQuitada`,
      // que no vuelve a tocar la cuenta) — es justo el rastro que faltaba de esta reversa.
      const patchBadge = yaQuitada ? {} : {
        pago_eliminado_por: window.__ssCurrentUser?.nombre || null,
        pago_eliminado_en: new Date().toISOString(),
        pago_eliminado_motivo: `Se eliminó el movimiento bancario del pago ${fila.id} ($${quitado.toFixed(2)})`,
      };
      const { error: eU } = await window.sb.from(tabla)
        .update({ pagado, pagos: jsonb, estado, ...patchBadge }).eq('id', cuentaId);
      if (eU) return { error: eU };
      afectadas.push({ tabla, cuentaId, factura: cuenta.factura || null, quitado, estado });

      // Una CxP de COMISIÓN, al saldarse, marca `comision_estado='pagada'` en los documentos que
      // cubre (ver registrarPagosCxP). Si la cuenta deja de estar pagada hay que deshacer eso: si
      // no, la comisión sigue figurando como cobrada en el módulo de Comisiones aunque la plata
      // haya vuelto al banco.
      if (!esCobrar && estado !== 'pagada' && Array.isArray(cuenta.doc_ids) && cuenta.doc_ids.length) {
        const { error: eCom } = await window.sb.from('documentos')
          .update({ comision_estado: 'pendiente' }).in('id', cuenta.doc_ids);
        if (eCom) return { error: eCom };
        (window.SSData.documentos || []).forEach(d => {
          if (cuenta.doc_ids.includes(d.id)) d.comision_estado = 'pendiente';
        });
      }

      // Espejo en memoria: CxC/CxP no se recargan solas al volver de Bancos.
      const lista = esCobrar ? window.SSData.cuentasCobrar : window.SSData.cuentasPagar;
      const mem = (lista || []).find(c => c.id === cuentaId);
      if (mem) { mem.pagado = pagado; mem.pagos = jsonb; mem.estado = estado; Object.assign(mem, patchBadge); }
    }

    // El ledger se borra AL FINAL: si algo de arriba falló, las filas siguen ahí y el reintento
    // las vuelve a encontrar. Borrarlas primero dejaría el cobro sin rastro y sin revertir.
    const ids = filas.map(f => f.id);
    const { error: eDel } = await window.sb.from('pagos').delete().in('id', ids);
    if (eDel) return { error: eDel };
    window.SSData.pagos = (window.SSData.pagos || []).filter(p => !ids.includes(p.id));
    const idx = window.__ssPagosPorDoc || {};
    Object.keys(idx).forEach(k => { idx[k] = (idx[k] || []).filter(p => !ids.includes(p.id)); });

    window.logActivity?.({
      modulo: 'bank', accion: 'revertir_cobro', entidad_id: pagoId,
      entidad_label: afectadas.map(a => a.factura || a.cuentaId).join(', ') || pagoId,
      detalles: { movimiento: mov.id, pagos: ids, cuentas: afectadas },
    });
    // Las 4 listas del flujo pintan la última respuesta guardada y revalidan por detrás, y el
    // trigger acaba de mover `estado_cobro` de la factura. Sin invalidar, la factura sigue
    // diciendo "Cobrada" hasta que venza el TTL del caché.
    window.invalidateDocCounts?.();
    window.dispatchEvent(new CustomEvent('ss-data-extra-loaded'));
    return { ok: true, revertidos: ids.length, afectadas, pagos: filas };
  };

  // ─── Eliminar un movimiento bancario ─────────────────────────────────────
  // MODELO saldo = Σ movimientos: al borrar CUALQUIER movimiento se recalcula el saldo de la cuenta.
  window.eliminarMovimientoBancario = async function (id) {
    if (!id) return { error: { message: 'Falta el id del movimiento.' } };
    // Fila COMPLETA (select *) para poder restaurarla íntegra desde la papelera.
    const { data: mov, error: eSel } = await window.sb.from('movimientos_bancarios')
      .select('*').eq('id', id).maybeSingle();
    if (eSel) return { error: eSel };
    if (!mov) return { error: { message: 'Movimiento no encontrado.' } };

    // ── Un traspaso son DOS movimientos: se van los dos o no se va ninguno ────────────────────
    // Borrar una sola pata deja media operación (la plata salió de una cuenta y no entró en
    // ninguna). La RPC borra las dos y recalcula LAS DOS cuentas en una transacción; hace falta
    // que sea server-side porque en un traspaso entre empresas la otra pata puede estar fuera de
    // la RLS del usuario, y entonces un delete desde acá afectaría 0 filas en silencio.
    // Ver migracion-odoo/48_borrar_traspaso_completo.sql.
    if (mov.match_id && String(mov.match_id).startsWith('TRF-')) {
      const { data: r, error: eRpc } = await window.sb.rpc('eliminar_traspaso_bancario', { p_id: id });
      if (eRpc) return { error: eRpc };
      if (r && r.error) return { error: { message: r.error } };
      const borradas = (r && r.borradas) || [];
      // Una sola entrada de papelera con las DOS filas: restaurar media transferencia sería
      // volver a crear el problema que este borrado arregla.
      window.ssTrash?.add('traspasoBancario', mov.descripcion || id, { _traspaso: borradas, ...mov });
      const ids = borradas.map(m => m.id);
      if (Array.isArray(window.SSData.movsBancarios))
        window.SSData.movsBancarios = window.SSData.movsBancarios.filter(m => !ids.includes(m.id));
      if (Array.isArray(window.SSData.movsPendientes))
        window.SSData.movsPendientes = window.SSData.movsPendientes.filter(m => !ids.includes(m.id));
      // Los saldos ya los recalculó la RPC; se refrescan en memoria para que la pantalla no mienta.
      const cuentas = (r && r.cuentas) || [];
      const { data: ctas } = await window.sb.from('cuentas_bancarias').select('id, saldo').in('id', cuentas);
      let nuevoSaldo = null;
      (ctas || []).forEach(c => {
        const local = (window.SSData.cuentasBancarias || []).find(x => x.id === c.id);
        if (local) local.saldo = parseFloat(c.saldo) || 0;
        if (c.id === mov.cuenta_bancaria_id) nuevoSaldo = parseFloat(c.saldo) || 0;
      });
      window.logActivity?.({ modulo: 'bank', accion: 'eliminar', entidad_id: id,
        entidad_label: mov.descripcion || id,
        detalles: { tipo: 'traspaso', patas: ids, monto: parseFloat(mov.monto) || 0, banco: mov.banco } });
      return { ok: true, nuevoSaldo, traspaso: ids };
    }

    // Si el movimiento respalda un cobro o un pago, la deuda vuelve ANTES de sacar la plata
    // del banco. Si esto falla, no se borra nada (ver revertirCobroDeMovimiento).
    const rev = await window.revertirCobroDeMovimiento(mov);
    if (rev && rev.error) return { error: rev.error };
    const { error } = await window.sb.from('movimientos_bancarios').delete().eq('id', id);
    if (error) return { error };
    // A papelera 30 días (movimiento financiero — antes se borraba sin recuperación). Se
    // guardan también los pagos revertidos: sin ellos, restaurar devolvería la plata al banco
    // dejando la factura por cobrar, que es la misma inconsistencia al revés.
    window.ssTrash?.add('movimientoBancario', mov.descripcion || id,
      (rev && rev.pagos && rev.pagos.length) ? { ...mov, _pagosRevertidos: rev.pagos } : mov);
    // Saldo = Σ movimientos: al borrar CUALQUIER movimiento se recalcula (ya no cuenta en el saldo).
    const cuentaId = mov.cuenta_bancaria_id;
    const monto = parseFloat(mov.monto) || 0;
    const nuevoSaldo = cuentaId ? await recomputeSaldoCuenta(cuentaId) : null;
    if (Array.isArray(window.SSData.movsBancarios)) {
      window.SSData.movsBancarios = window.SSData.movsBancarios.filter(m => m.id !== id);
    }
    if (Array.isArray(window.SSData.movsPendientes)) {
      window.SSData.movsPendientes = window.SSData.movsPendientes.filter(m => m.id !== id);
    }
    window.logActivity?.({ modulo: 'bank', accion: 'eliminar', entidad_id: id, entidad_label: mov.descripcion || id, detalles: { banco: mov.banco, monto, conciliado: mov.conciliado, saldo_nuevo: nuevoSaldo } });
    return { ok: true, nuevoSaldo };
  };

  // ─── Desvincular un movimiento bancario de un documento ────────────────────
  // El dinero es real y ya está conciliado; lo único que dejó de ser válido es la referencia al
  // documento (se anuló, o ya no existe). A diferencia de `eliminarMovimientoBancario`, esto NO borra
  // el movimiento ni revierte ninguna deuda: solo cambia a qué apunta. Queda como "ingreso manual,
  // pendiente de aplicar" — la UI lo distingue por `desvinculado_de` (ver migración 51).
  // `info` = { por, en, motivo } para denormalizar quién/cuándo/por qué se desvinculó (así el
  // tooltip de Bancos no depende de que el documento anulado siga cargado en memoria — ver
  // migración 53). Si no se pasa, se usa el usuario actual y el instante de ahora (caso: alguien
  // desvincula a mano desde Bancos, sin pasar por una anulación).
  window.desvincularMovimiento = async function (id, info = {}) {
    if (!id) return { error: { message: 'Falta el id del movimiento.' } };
    const { data: mov, error: eSel } = await window.sb.from('movimientos_bancarios')
      .select('id, documento_id').eq('id', id).maybeSingle();
    if (eSel) return { error: eSel };
    if (!mov) return { error: { message: 'Movimiento no encontrado.' } };
    if (!mov.documento_id) return { ok: true, yaDesvinculado: true };
    const docId = mov.documento_id;
    const { error } = await window.sb.from('movimientos_bancarios')
      .update({
        documento_id: null, desvinculado_de: docId,
        desvinculado_por: info.por || window.__ssCurrentUser?.nombre || window.currentUserRole || 'desconocido',
        desvinculado_en: info.en || new Date().toISOString(),
        desvinculado_motivo: info.motivo || null,
      }).eq('id', id);
    if (error) return { error };
    if (Array.isArray(window.SSData.movsBancarios)) {
      const m = window.SSData.movsBancarios.find(x => x.id === id);
      if (m) { m.documento_id = null; m.desvinculado_de = docId; }
    }
    if (Array.isArray(window.SSData.movsPendientes)) {
      const m = window.SSData.movsPendientes.find(x => x.id === id);
      if (m) { m.documento_id = null; m.desvinculado_de = docId; }
    }
    window.logActivity?.({ modulo: 'bank', accion: 'editar', entidad_id: id,
      detalles: { tipo: 'desvincular', documento_previo: docId } });
    return { ok: true };
  };

  // ─── Movimiento bancario manual (comisión, interés, gasto/ingreso vario) ──
  // Inserta un movimiento y ajusta el saldo de la cuenta. `tipo` = 'ingreso' | 'egreso'.
  // `categoria` solo aplica a los egresos (es el rubro del gasto en "En qué se gastó"). Un ingreso
  // no se clasifica por rubro de gasto, así que se descarta en vez de guardarse y ensuciar el
  // desglose. Sin este parámetro, todo egreso cargado a mano desde Bancos nacía sin rubro.
  window.crearMovimientoBancario = async function ({ cuentaId, fecha, tipo, monto, descripcion, categoria }) {
    const e = window.currentEmpresa || 'demo1';
    const cta = (window.SSData.cuentasBancarias || []).find(c => c.id === cuentaId);
    if (!cta) return { error: { message: 'Cuenta no encontrada' } };
    const abs = Math.round(Math.abs(parseFloat(monto) || 0) * 100) / 100;
    if (!abs) return { error: { message: 'El monto debe ser mayor a 0.' } };
    const signed = (tipo === 'egreso' ? -1 : 1) * abs;
    // No se puede ejecutar un egreso si el saldo (= Σ movimientos) no alcanza.
    const saldoDisp = parseFloat(cta.saldo) || 0;
    if (signed < 0 && (saldoDisp + signed) < -0.001) {
      const disp = cta.moneda === 'USD' ? ('$' + saldoDisp.toFixed(2)) : ('Bs. ' + saldoDisp.toFixed(2));
      return { error: { message: `Saldo insuficiente en ${cta.banco}. Disponible: ${disp}. Registra los ingresos que falten o reduce el monto del egreso.` } };
    }
    const bcv = window.SSData?.tasa?.bcv || null;
    const monto_usd = cta.moneda === 'USD' ? abs : (bcv ? Math.round((abs / bcv) * 100) / 100 : null);
    const row = {
      id: 'MOV-MAN-' + Date.now(),
      fecha: fecha || window.localDateStr(),
      banco: cta.banco,
      descripcion: (descripcion || '').trim() || (tipo === 'egreso' ? 'Egreso manual' : 'Ingreso manual'),
      monto: signed, tipo: tipo === 'egreso' ? 'egreso' : 'ingreso', conciliado: true, origen_app: true,
      empresa_id: e, moneda: cta.moneda, monto_usd, tasa: cta.moneda === 'USD' ? null : bcv,
      cuenta_bancaria_id: cuentaId,
      creado_por: window.__ssCurrentUser?.nombre || null,
      categoria: tipo === 'egreso' ? ((categoria || '').trim() || null) : null,
    };
    const { error } = await window.sb.from('movimientos_bancarios').insert(row);
    if (error) return { error };
    // Saldo = Σ movimientos: recalcular tras insertar el movimiento manual.
    const saldoActual = parseFloat(cta.saldo) || 0;
    const nuevoSaldo = await recomputeSaldoCuenta(cuentaId);
    window.logActivity?.({ modulo: 'bank', accion: 'crear', entidad_id: cuentaId, entidad_label: cta.banco, detalles: { tipo: 'movimiento_manual', movimiento: row.tipo, monto: signed, descripcion: row.descripcion, saldo_anterior: saldoActual, saldo_nuevo: nuevoSaldo } });
    return { ok: true, nuevoSaldo };
  };

  // ─── Crear CxP de comisión de vendedor ───────────────────────────────────
  // Pedido explícito (2026-08-14): seleccionar comisiones de VARIOS vendedores y crearlas como
  // **un solo asiento** en Cuentas por Pagar (antes se creaba una CxP POR vendedor — "separadas").
  // `vendedores` es la lista de {id, nombre} presentes en la selección: con uno solo, el
  // concepto y el proveedor de la CxP quedan atados a ese vendedor (se preserva la trazabilidad de
  // antes); con varios, la CxP queda genérica ("Comisiones de venta") y sin proveedor único —
  // `doc_ids` es lo que de verdad ata cada documento a su comisión, no el campo proveedor.
  window.crearComisionCxP = async function ({ docIds, montoUSD, vence, vendedores }) {
    const id = 'COM-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const unico = Array.isArray(vendedores) && vendedores.length === 1 ? vendedores[0] : null;
    const nombres = (vendedores || []).map(v => v.nombre).join(', ');
    const concepto = unico
      ? `Comisión · ${unico.nombre} · ${docIds.length} doc${docIds.length !== 1 ? 's' : ''}`
      : `Comisiones de venta · ${(vendedores || []).length} vendedores · ${docIds.length} doc${docIds.length !== 1 ? 's' : ''}`;
    const payload = {
      id,
      empresa_id: window.currentEmpresa || 'demo1',
      tipo: 'comision',
      // OJO: la columna es `proveedor_id`, no `proveedor` — con el nombre equivocado el insert
      // fallaba siempre (columna inexistente) y ninguna CxP de comisión llegó a crearse.
      proveedor_id: unico?.id || null,
      vendedor_id: unico?.id || null,
      vendedor_nombre: nombres,
      concepto,
      monto: Math.round(montoUSD * 100) / 100,
      pagado: 0,
      vence,
      dias: 0,
      estado: 'pendiente',
      pagos: [],
      modalidad_pago: 'divisas',
      doc_ids: docIds,
      creado_por: window.__ssCurrentUser?.nombre || null,
    };
    const { data, error } = await window.sb.from('cuentas_pagar').insert([payload]).select().single();
    if (error) return { error };
    // Marcar documentos con estado cxp_creada
    await window.sb.from('documentos')
      .update({ comision_estado: 'cxp_creada', comision_cxp_id: data.id })
      .in('id', docIds);
    (window.SSData.documentos || []).forEach(d => {
      if (docIds.includes(d.id)) { d.comision_estado = 'cxp_creada'; d.comision_cxp_id = data.id; }
    });
    // Mismo mapeo que `loadAppData` (proveedor_id → proveedor): sin esto, la fila recién creada
    // no tiene `.proveedor` hasta el próximo recargo completo y el resto de CxP la lee mal.
    (window.SSData.cuentasPagar = window.SSData.cuentasPagar || []).unshift({ ...data, proveedor: data.proveedor_id });
    window.logActivity?.({
      modulo: 'comisiones', accion: 'crear', entidad_id: data.id,
      entidad_label: unico ? `CxP comisión · ${unico.nombre}` : `CxP comisiones de venta · ${(vendedores || []).length} vendedores`,
      detalles: { vendedores: (vendedores || []).map(v => v.id), doc_ids: docIds, monto_usd: payload.monto },
    });
    return { data };
  };

  // Permiso especial (2026-08-14): eliminar una CxP de comisión — antes esto solo se podía hacer
  // desde el módulo de CxP genérico (bulkDelete de business.jsx), que borra la fila pero NUNCA
  // revertía `documentos.comision_estado` a 'pendiente': los documentos quedaban con
  // `comision_estado='cxp_creada'` apuntando a una CxP que ya no existe, y como
  // `selectableDocs` (comisiones.jsx) solo ofrece los 'pendiente', esas comisiones quedaban
  // huérfanas para siempre (no se podían volver a agrupar). Solo se deja borrar si la CxP sigue
  // 'pendiente' — una ya pagada es plata que salió de verdad, y anularla es otra operación
  // (reversarPagoCxP), no un simple borrado.
  window.eliminarComisionCxP = async function (cxpId) {
    const cxp = (window.SSData.cuentasPagar || []).find(c => c.id === cxpId);
    if (!cxp) return { error: { message: 'No se encontró la CxP.' } };
    if (cxp.estado === 'pagada' || (Number(cxp.pagado) || 0) > 0) {
      return { error: { message: 'Esta CxP ya tiene un pago registrado — no se puede eliminar así.' } };
    }
    const docIds = Array.isArray(cxp.doc_ids) ? cxp.doc_ids : [];
    const { error } = await window.sb.from('cuentas_pagar').delete().eq('id', cxpId);
    if (error) return { error };
    if (docIds.length) {
      await window.sb.from('documentos')
        .update({ comision_estado: 'pendiente', comision_cxp_id: null })
        .in('id', docIds);
      (window.SSData.documentos || []).forEach(d => {
        if (docIds.includes(d.id)) { d.comision_estado = 'pendiente'; d.comision_cxp_id = null; }
      });
    }
    window.SSData.cuentasPagar = (window.SSData.cuentasPagar || []).filter(c => c.id !== cxpId);
    window.ssTrash?.add('cuentaPagar', cxp.concepto || cxpId, cxp);
    window.logActivity?.({
      modulo: 'comisiones', accion: 'eliminar', entidad_id: cxpId,
      entidad_label: cxp.concepto || cxpId, detalles: { doc_ids: docIds, monto_usd: cxp.monto },
    });
    return { ok: true };
  };

  // ─── Etiquetas (tags) ─────────────────────────────────────────────────────
  // ─── Filtros guardados (AdvancedSearch) ────────────────────────────────────
  // Persistidos por empresa + usuario + storage_key. Antes vivían en localStorage.
  window.loadFiltrosGuardados = async function (storageKey) {
    if (!storageKey) return [];
    const empresa = window.currentEmpresa || 'demo1';
    const userId  = window.__ssCurrentUser?.id || null;
    let q = window.sb.from('filtros_guardados').select('nombre, terminos')
      .eq('empresa_id', empresa).eq('storage_key', storageKey).order('nombre');
    q = userId ? q.eq('usuario_id', userId) : q.is('usuario_id', null);
    const { data, error } = await q;
    if (error) { console.error('[Supabase] Error cargando filtros guardados:', error); return []; }
    return (data || []).map(r => ({ nombre: r.nombre, terms: Array.isArray(r.terminos) ? r.terminos : [] }));
  };

  window.guardarFiltro = async function (storageKey, nombre, terms) {
    if (!storageKey || !nombre) return { error: { message: 'storageKey/nombre requeridos' } };
    const empresa = window.currentEmpresa || 'demo1';
    const userId  = window.__ssCurrentUser?.id || null;
    const payload = {
      empresa_id: empresa, usuario_id: userId, storage_key: storageKey,
      nombre: String(nombre).trim(), terminos: Array.isArray(terms) ? terms : [],
      updated_at: new Date().toISOString(),
    };
    const { error } = await window.sb.from('filtros_guardados')
      .upsert(payload, { onConflict: 'empresa_id,usuario_id,storage_key,nombre' });
    return { error };
  };

  window.eliminarFiltroGuardado = async function (storageKey, nombre) {
    if (!storageKey || !nombre) return { error: { message: 'storageKey/nombre requeridos' } };
    const empresa = window.currentEmpresa || 'demo1';
    const userId  = window.__ssCurrentUser?.id || null;
    let q = window.sb.from('filtros_guardados').delete()
      .eq('empresa_id', empresa).eq('storage_key', storageKey).eq('nombre', nombre);
    q = userId ? q.eq('usuario_id', userId) : q.is('usuario_id', null);
    const { error } = await q;
    return { error };
  };

  window.loadEtiquetas = async function () {
    const e = window.currentEmpresa || 'demo1';
    const { data, error } = await window.sb
      .from('etiquetas').select('*').eq('empresa_id', e).order('nombre');
    if (error) { console.error('[Supabase] Error cargando etiquetas:', error); return []; }
    return data || [];
  };

  window.crearEtiqueta = async function ({ nombre, color }) {
    const empresa = window.currentEmpresa || 'demo1';
    const id = 'TAG-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const payload = { id, empresa_id: empresa, nombre: String(nombre).trim(), color: color || '#3b82f6' };
    const { error } = await window.sb.from('etiquetas').insert(payload);
    return { error, id };
  };

  window.actualizarEtiqueta = async function (id, fields) {
    const { error } = await window.sb.from('etiquetas').update(fields).eq('id', id);
    return { error };
  };

  window.eliminarEtiqueta = async function (id, nombre) {
    const empresa = window.currentEmpresa || 'demo1';
    // Quitar la etiqueta de todos los productos que la tengan
    const { data: prods } = await window.sb
      .from('productos').select('sku, etiquetas')
      .overlaps('empresas', [empresa]).contains('etiquetas', [nombre]);
    for (const p of (prods || [])) {
      const nuevo = (p.etiquetas || []).filter(t => t !== nombre);
      await window.sb.from('productos').update({ etiquetas: nuevo }).eq('sku', p.sku).overlaps('empresas', [empresa]);
    }
    const { error } = await window.sb.from('etiquetas').delete().eq('id', id);
    return { error };
  };

  window.actualizarEtiquetasProducto = async function (sku, etiquetas) {
    const empresa = window.currentEmpresa || 'demo1';
    const { error } = await window.sb.from('productos')
      .update({ etiquetas: Array.isArray(etiquetas) ? etiquetas : [] })
      .eq('sku', sku).overlaps('empresas', [empresa]);
    return { error };
  };

  // ─── Crear vuelto (CxP tipo='vuelto') a un cliente por sobrepago ──────────
  window.crearVueltoCliente = async function ({ clienteId, monto, concepto, pagoOrigenId }) {
    const id = 'VLT-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const payload = {
      id,
      empresa_id:    window.currentEmpresa || 'demo1',
      tipo:          'vuelto',
      cliente_id:    clienteId,
      proveedor_id:  null,
      factura:       null,
      monto:         parseFloat(monto) || 0,
      pagado:        0,
      vence:         window.localDateStr(),
      dias:          0,
      estado:        'pendiente',
      concepto:      concepto || 'Vuelto por sobrepago',
      pago_origen_id: pagoOrigenId || null,
      creado_por:    window.__ssCurrentUser?.nombre || null,
    };
    const { error } = await window.sb.from('cuentas_pagar').insert(payload);
    if (error) { console.error('[Supabase] Error creando vuelto:', error); return { error }; }
    (window.SSData.cuentasPagar = window.SSData.cuentasPagar || []).unshift({
      ...payload,
      cliente: clienteId, // alias usado por SSData
    });
    return { id };
  };

  // ─── Un VUELTO pendiente pasa a SALDO A FAVOR ─────────────────────────────
  // Pedido de Jorge (2026-08-11): el excedente que quedó como vuelto solo se podía devolver en
  // efectivo, y él necesita aplicarlo a otra nota del mismo cliente. Un vuelto y un saldo a favor
  // son la MISMA deuda con el cliente: lo único que cambia es cómo se salda. En vez de duplicar
  // toda la aplicación de anticipos para los vueltos, el vuelto se PASA a saldo a favor (total o
  // parcial) y de ahí sigue el camino de anticipos que ya existe. NO mueve plata ni toca bancos:
  // el dinero ya entró cuando se cobró el sobrepago. Ver migracion-odoo/49.
  window.vueltoASaldoAFavor = async function ({ vueltoId, monto }) {
    const { data, error } = await window.sb.rpc('vuelto_a_saldo_a_favor', {
      p_vuelto_id: vueltoId,
      p_monto: (monto == null || monto === '') ? null : (parseFloat(monto) || 0),
    });
    if (error) { console.error('[Supabase] vueltoASaldoAFavor:', error); return { error }; }
    if (data && data.error) return { error: { message: data.error } };
    // Los anticipos se re-piden (aparece el nuevo) y la CxP del vuelto se refleja en memoria para
    // que la lista de vueltos no siga ofreciendo un saldo que ya se acreditó.
    await window.loadAnticipos?.();
    const cp = (window.SSData.cuentasPagar || []).find(c => c.id === vueltoId);
    if (cp) {
      cp.pagado = (parseFloat(cp.pagado) || 0) + (parseFloat(data.monto) || 0);
      if (window.ssSaldada ? window.ssSaldada(cp.pagado, parseFloat(cp.monto) || 0)
                           : cp.pagado >= (parseFloat(cp.monto) || 0) - 0.005) cp.estado = 'pagada';
      else cp.estado = 'parcial';
    }
    window.logActivity?.({ modulo: 'cxp', accion: 'editar', entidad_id: vueltoId,
      entidad_label: 'Vuelto → saldo a favor',
      detalles: { monto: data.monto, pago_id: data.pago_id, saldo_restante: data.vuelto_saldo } });
    return { data };
  };

  // ══════════════════════════════════════════════════════════════════════════
  //  ANTICIPOS DE CLIENTE
  //  Un anticipo es dinero recibido SIN pedido: se modela como un `pago` de tipo
  //  'cobro' con categoria='anticipo' y documento_id NULL. No es una cuenta por
  //  cobrar (esa es un activo; el anticipo es un pasivo: se debe mercancía).
  //  El consumo contra facturas vive en `anticipos_aplicaciones`.
  // ══════════════════════════════════════════════════════════════════════════

  // Recarga los anticipos desde la vista (que ya calcula el saldo disponible).
  window.loadAnticipos = async function () {
    const e = window.currentEmpresa || 'demo1';
    const { data, error } = await window.sb.from('v_anticipos')
      .select('*').eq('empresa_id', e).order('fecha', { ascending: false });
    if (error) { console.error('[Supabase] loadAnticipos:', error); return { error }; }
    window.SSData.anticipos = data || [];
    return { data };
  };

  // Registrar un anticipo. El dinero SÍ entra al banco: se crea el pago y su
  // movimiento bancario, igual que cualquier cobro. La moneda la dicta el banco.
  window.crearAnticipo = async function ({ clienteId, monto, montoUsd, moneda, tasa, metodo, cuentaBancariaId, banco, fecha, referencia, notas }) {
    const empresa = window.currentEmpresa || 'demo1';
    const id = 'PAG-ANT-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const usuario = window.__ssCurrentUser?.nombre || null;
    const f = fecha || window.localDateStr();
    // Cliente OPCIONAL: entra plata a la cuenta y a veces no se sabe de quién es. Se
    // registra sin cliente y se identifica después (asignarClienteAnticipo). Normalizar
    // '' a null importa: un string vacío rompería el FK en vez de guardar "sin dueño".
    const cliId = clienteId || null;
    const pago = {
      id, empresa_id: empresa, tipo: 'cobro', categoria: 'anticipo',
      cliente_id: cliId, documento_id: null,
      fecha: f,
      monto: parseFloat(monto) || 0,
      moneda: moneda || 'USD',
      monto_usd: parseFloat(montoUsd) || parseFloat(monto) || 0,
      tasa: tasa ? parseFloat(tasa) : null,
      metodo: metodo || null, banco: banco || null,
      cuenta_bancaria_id: cuentaBancariaId || null,
      referencia: referencia || null, notas: notas || null,
      creado_por: usuario,
    };
    const { error } = await window.sb.from('pagos').insert(pago);
    if (error) { console.error('[Supabase] crearAnticipo:', error); return { error }; }

    // Movimiento bancario del ingreso (mismo contrato que el resto de cobros:
    // `monto` con signo, `monto_usd` en absoluto).
    if (cuentaBancariaId) {
      const cli = (window.SSData.clientes || []).find(c => c.id === cliId);
      const { error: mErr } = await window.sb.from('movimientos_bancarios').insert({
        id: 'MOV-ANT-' + id,
        fecha: f, banco: banco || null,
        // Sin cliente lo dice explícito: en el extracto del banco "Anticipo" a secas no
        // se distingue de uno ya identificado, y este hay que ir a averiguarlo.
        descripcion: 'Anticipo' + (cli?.nombre ? ' - ' + cli.nombre : ' - sin identificar'),
        monto: pago.monto, tipo: 'ingreso', moneda: pago.moneda, monto_usd: pago.monto_usd,
        cuenta_bancaria_id: cuentaBancariaId, pago_id: id, cliente_id: cliId,
        empresa_id: empresa, conciliado: false, origen_app: true, creado_por: usuario,
      });
      // MODELO saldo = Σ movimientos: se recalcula server-side tras crear el movimiento.
      if (mErr) console.warn('[Supabase] anticipo sin movimiento bancario:', mErr.message);
      else await window.recomputeSaldoCuenta?.(cuentaBancariaId);
    }

    await window.loadAnticipos();
    window.logActivity?.({ modulo: 'anticipos', accion: 'crear', entidad_id: id,
      entidad_label: 'Anticipo ' + (pago.monto_usd || 0).toFixed(2) + ' USD',
      detalles: { cliente_id: clienteId, monto: pago.monto, moneda: pago.moneda } });
    return { id };
  };

  // ─── Un ingreso del banco que nadie reclamó → anticipo de un cliente ─────────────────────────
  // Pedido el 2026-08-13: "cómo entró el pago se queda, pero tiene que hacer match con el cliente
  // y automáticamente se debe ir a anticipo". El caso es plata que aparece en la cuenta (una
  // transferencia que el cliente hizo sin avisar, un ingreso cargado a mano) y que no está atada a
  // ninguna factura: hasta ahora quedaba como un movimiento suelto y el saldo a favor del cliente
  // había que cargarlo APARTE en Anticipos — lo que duplicaba el ingreso, porque crear un anticipo
  // con cuenta bancaria genera su propio movimiento.
  //
  // Por eso acá NO se crea movimiento bancario: la plata ya entró. Se crea el `pagos`
  // (categoria='anticipo') y se ENLAZA al movimiento que ya existe, igual que hace el traspaso
  // entre empresas que acredita a un cliente. El movimiento conserva su descripción original —
  // "cómo entró el pago se queda" es literal: el extracto no se reescribe.
  window.movimientoAAnticipo = async function ({ movId, clienteId, notas }) {
    if (!movId)     return { error: { message: 'Falta el movimiento.' } };
    if (!clienteId) return { error: { message: 'Elegí el cliente al que pertenece este ingreso.' } };
    // Se relee de la base (no de memoria): entre que se abrió el panel y se confirmó, otro usuario
    // pudo haberlo asignado. Sin esto se crearían dos anticipos por el mismo ingreso.
    const { data: mov, error: eMov } = await window.sb.from('movimientos_bancarios')
      .select('*').eq('id', movId).maybeSingle();
    if (eMov) return { error: eMov };
    if (!mov) return { error: { message: 'El movimiento ya no existe.' } };
    if (parseFloat(mov.monto) <= 0) return { error: { message: 'Solo un INGRESO puede convertirse en saldo a favor de un cliente.' } };
    if (mov.pago_id)      return { error: { message: 'Este movimiento ya está asociado a un pago o anticipo.' } };
    if (mov.documento_id) return { error: { message: 'Este movimiento ya está asociado a un documento.' } };

    const usuario = window.__ssCurrentUser?.nombre || null;
    const id = 'PAG-ANT-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const monto = Math.abs(parseFloat(mov.monto) || 0);
    const moneda = mov.moneda || 'USD';
    const pago = {
      id, empresa_id: mov.empresa_id, tipo: 'cobro', categoria: 'anticipo',
      cliente_id: clienteId, documento_id: null,
      fecha: mov.fecha, monto, moneda,
      // `monto_usd` es lo que consume `aplicar_anticipo`: si el movimiento no lo trae (los cargados
      // a mano en Bs. pueden no tenerlo) se deriva de la tasa, y si tampoco hay tasa se deja el
      // monto — en USD es correcto y en Bs. queda visible para corregirlo, que es mejor que 0.
      monto_usd: mov.monto_usd != null ? Math.abs(parseFloat(mov.monto_usd))
                 : (moneda === 'VES' && parseFloat(mov.tasa) > 0 ? Math.round((monto / parseFloat(mov.tasa)) * 100) / 100 : monto),
      tasa: mov.tasa || null,
      metodo: 'transferencia', banco: mov.banco || null,
      cuenta_bancaria_id: mov.cuenta_bancaria_id || null,
      referencia: mov.id, notas: notas || ('Ingreso del banco identificado: ' + (mov.descripcion || mov.id)),
      creado_por: usuario,
    };
    const { error: ePago } = await window.sb.from('pagos').insert(pago);
    if (ePago) return { error: ePago };
    const { error: eUpd } = await window.sb.from('movimientos_bancarios')
      .update({ pago_id: id, cliente_id: clienteId, conciliado: true }).eq('id', movId);
    if (eUpd) {
      // Compensación: un anticipo sin su movimiento sería un saldo a favor duplicado (el ingreso
      // seguiría suelto y volvería a ofrecerse para asignar).
      await window.sb.from('pagos').delete().eq('id', id);
      return { error: eUpd };
    }
    const mem = (window.SSData.movimientosBancarios || []).find(m => m.id === movId);
    if (mem) { mem.pago_id = id; mem.cliente_id = clienteId; mem.conciliado = true; }
    await window.loadAnticipos?.();
    const cliNombre = (window.SSData.clientes || []).find(c => c.id === clienteId)?.nombre || clienteId;
    window.logActivity?.({ modulo: 'bank', accion: 'editar', entidad_id: movId,
      entidad_label: 'Ingreso → anticipo de ' + cliNombre,
      detalles: { movimiento: movId, pago_id: id, cliente_id: clienteId, monto, moneda } });
    return { id };
  };

  // Aplicar saldo de un anticipo a una factura. Todo el control (saldo suficiente,
  // no exceder lo que debe la factura, bloqueo contra doble aplicación) vive en la
  // RPC, no acá: dos usuarios podrían intentar consumir el mismo saldo a la vez.
  window.aplicarAnticipo = async function ({ pagoId, documentoId, monto, notas }) {
    const usuario = window.__ssCurrentUser?.nombre || null;
    const { data, error } = await window.sb.rpc('aplicar_anticipo', {
      p_pago_id: pagoId, p_documento_id: documentoId,
      p_monto: parseFloat(monto) || 0, p_usuario: usuario, p_notas: notas || null,
    });
    if (error) { console.error('[Supabase] aplicarAnticipo:', error); return { error }; }
    await window.loadAnticipos();
    window.logActivity?.({ modulo: 'anticipos', accion: 'aplicar', entidad_id: pagoId,
      entidad_label: 'Anticipo → ' + documentoId,
      detalles: { documento_id: documentoId, monto: parseFloat(monto) || 0 } });
    return { data };
  };

  // Editar un anticipo ya registrado (monto/tasa/fecha/referencia/notas/método — NO cliente ni
  // banco: cambiar de cuenta bancaria es mover plata de verdad, eso es un traspaso, no una edición).
  // El movimiento bancario (mismo `pago_id`) se actualiza en el mismo golpe para que banco y
  // anticipo nunca queden desincronizados, y ambos quedan con el badge "Editado" (denormalizado,
  // igual patrón que `desvinculado_por/en/motivo` — sin eso el badge dispararía una consulta aparte).
  window.editarAnticipo = async function ({ pagoId, monto, moneda, tasa, fecha, referencia, notas, metodo }) {
    const { data: prev, error: eRead } = await window.sb.from('pagos').select('*').eq('id', pagoId).single();
    if (eRead || !prev) return { error: eRead || { message: 'Anticipo no encontrado.' } };

    const mon = moneda || prev.moneda;
    const montoNum = parseFloat(monto);
    const montoFinal = Number.isFinite(montoNum) ? montoNum : parseFloat(prev.monto) || 0;
    const tasaNum = tasa != null ? parseFloat(tasa) : (prev.tasa != null ? parseFloat(prev.tasa) : null);
    const montoUsdFinal = mon === 'VES'
      ? (tasaNum > 0 ? Math.round((montoFinal / tasaNum) * 100) / 100 : parseFloat(prev.monto_usd) || 0)
      : montoFinal;

    // No se puede dejar el anticipo por debajo de lo que YA se aplicó a facturas — reventaría el
    // saldo a favor a negativo, que `v_anticipos` no contempla.
    const { data: aps } = await window.sb.from('anticipos_aplicaciones').select('monto_aplicado').eq('pago_id', pagoId);
    const aplicado = (aps || []).reduce((s, a) => s + (parseFloat(a.monto_aplicado) || 0), 0);
    if (montoUsdFinal < aplicado - 0.005) {
      return { error: { message: `No se puede bajar de ${aplicado.toFixed(2)} USD: ya se aplicaron ${aplicado.toFixed(2)} de este anticipo.` } };
    }

    const usuario = window.__ssCurrentUser?.nombre || null;
    const ahora = new Date().toISOString();
    const patch = {
      monto: montoFinal, moneda: mon, monto_usd: montoUsdFinal,
      tasa: mon === 'VES' ? tasaNum : null,
      fecha: fecha || prev.fecha, referencia: referencia ?? prev.referencia,
      notas: notas ?? prev.notas, metodo: metodo || prev.metodo,
      editado_por: usuario, editado_at: ahora,
    };
    const { error } = await window.sb.from('pagos').update(patch).eq('id', pagoId);
    if (error) { console.error('[Supabase] editarAnticipo:', error); return { error }; }

    if (prev.cuenta_bancaria_id) {
      const { error: mErr } = await window.sb.from('movimientos_bancarios').update({
        monto: montoFinal, moneda: mon, monto_usd: montoUsdFinal, tasa: patch.tasa,
        fecha: patch.fecha, editado_por: usuario, editado_at: ahora,
      }).eq('pago_id', pagoId);
      if (mErr) console.warn('[Supabase] editarAnticipo: movimiento no se pudo sincronizar:', mErr.message);
      else await window.recomputeSaldoCuenta?.(prev.cuenta_bancaria_id);
    }

    await window.loadAnticipos();
    window.logActivity?.({ modulo: 'anticipos', accion: 'editar', entidad_id: pagoId,
      entidad_label: 'Anticipo ' + montoUsdFinal.toFixed(2) + ' USD',
      detalles: { antes: { monto: prev.monto, moneda: prev.moneda, tasa: prev.tasa, fecha: prev.fecha },
                  despues: { monto: montoFinal, moneda: mon, tasa: patch.tasa, fecha: patch.fecha } } });
    return { ok: true };
  };

  // ═══ RETENCIONES (IVA / ISLR) ═══════════════════════════════════════════════
  // La retención NO es un cobro: es plata que el cliente le entera al SENIAT y que nunca va a
  // entrar al banco. Por eso REDUCE el monto de la cuenta en vez de sumarse a `pagado` — así la
  // cuenta se cierra y los reportes de cobranza siguen diciendo lo que de verdad se cobró.
  // Toda la lógica (lock de la cuenta, tope contra el saldo, estado, registro) vive en la RPC
  // `aplicar_retencion`, que es atómica. Ver migracion-odoo/40_retenciones.sql.
  window.aplicarRetencion = async function ({ cuentaTipo, cuentaId, tipo, montoUsd, numero, fecha, moneda, monto, tasa, notas }) {
    const { data, error } = await window.sb.rpc('aplicar_retencion', {
      p_cuenta_tipo: cuentaTipo, p_cuenta_id: cuentaId, p_tipo: tipo || 'iva',
      p_monto_usd: parseFloat(montoUsd) || 0,
      p_numero: numero || null, p_fecha: fecha || null,
      p_moneda: moneda || 'USD', p_monto: monto != null ? parseFloat(monto) : null,
      p_tasa: tasa != null ? parseFloat(tasa) : null,
      p_usuario: window.__ssCurrentUser?.nombre || null, p_notas: notas || null,
    });
    if (error) { console.error('[Supabase] aplicarRetencion:', error); return { error }; }
    // Espejo en memoria: CxC/CxP no se recargan solas después de aplicar.
    const lista = cuentaTipo === 'cobrar' ? window.SSData.cuentasCobrar : window.SSData.cuentasPagar;
    const mem = (lista || []).find(c => c.id === cuentaId);
    if (mem && data) { mem.monto = Number(data.monto_nuevo); mem.estado = data.estado; }
    // El estado de cobro de la factura lo movió el trigger; el caché de las listas hay que
    // invalidarlo o la factura sigue pintándose "Por cobrar".
    window.invalidateDocCounts?.();
    window.logActivity?.({ modulo: 'retenciones', accion: 'crear', entidad_id: data?.id,
      entidad_label: (data?.factura || cuentaId) + ' · ' + (tipo || 'iva').toUpperCase(),
      detalles: { cuenta_id: cuentaId, monto_usd: parseFloat(montoUsd) || 0, numero: numero || null } });
    window.dispatchEvent(new CustomEvent('ss-data-extra-loaded'));
    return { data };
  };

  window.revertirRetencion = async function (id) {
    const { data, error } = await window.sb.rpc('revertir_retencion', { p_id: id });
    if (error) { console.error('[Supabase] revertirRetencion:', error); return { error }; }
    const cid = data?.cuenta_id;
    [window.SSData.cuentasCobrar, window.SSData.cuentasPagar].forEach(l => {
      const mem = (l || []).find(c => c.id === cid);
      if (mem && data?.monto_nuevo != null) { mem.monto = Number(data.monto_nuevo); mem.estado = data.estado; }
    });
    window.invalidateDocCounts?.();
    window.logActivity?.({ modulo: 'retenciones', accion: 'eliminar', entidad_id: id,
      entidad_label: id, detalles: { devuelto: data?.monto_devuelto } });
    window.dispatchEvent(new CustomEvent('ss-data-extra-loaded'));
    return { data };
  };

  // Las retenciones NO viajan en el arranque: solo importan en su módulo y en el detalle de la
  // cuenta. `desde`/`hasta` filtran por la fecha del comprobante.
  window.loadRetenciones = async function ({ desde, hasta } = {}) {
    const e = window.currentEmpresa || 'demo1';
    let q = window.sb.from('retenciones').select('*').eq('empresa_id', e);
    if (desde) q = q.gte('fecha', desde);
    if (hasta) q = q.lte('fecha', hasta);
    const { data, error } = await q.order('fecha', { ascending: false }).order('created_at', { ascending: false });
    if (error) { console.error('[Supabase] loadRetenciones:', error); return { error }; }
    window.SSData.retenciones = data || [];
    return { data };
  };

  // Las retenciones de UNA cuenta (o de su documento), para el historial de la nota. Se pide por
  // cuenta Y por documento porque no siempre se tienen las dos referencias a mano: desde la factura
  // se conoce el documento; desde el módulo de cuentas, la cuenta. `SSData.retenciones` NO sirve
  // acá: lo llena `loadRetenciones` con la ventana de fechas del módulo de Retenciones, así que
  // una retención vieja no estaría cargada y el historial la escondería sin decir nada.
  window.retencionesDeCuenta = async function ({ cuentaId, documentoId } = {}) {
    if (!cuentaId && !documentoId) return { data: [] };
    const e = window.currentEmpresa || 'demo1';
    const ors = [];
    if (cuentaId)    ors.push(`cuenta_id.eq.${cuentaId}`);
    if (documentoId) ors.push(`documento_id.eq.${documentoId}`);
    const { data, error } = await window.sb.from('retenciones')
      .select('id, tipo, cuenta_tipo, cuenta_id, documento_id, monto_usd, monto, moneda, tasa, numero_comprobante, fecha, periodo, notas, creado_por, created_at')
      .eq('empresa_id', e).or(ors.join(','))
      .order('fecha', { ascending: true });
    if (error) { console.error('[retencionesDeCuenta]', error); return { error }; }
    return { data: data || [] };
  };

  window.getRetencionesResumen = async function ({ desde, hasta } = {}) {
    const { data, error } = await window.sb.rpc('get_retenciones_resumen', {
      p_empresa_id: window.currentEmpresa || 'demo1',
      p_desde: desde || null, p_hasta: hasta || null,
    });
    if (error) { console.error('[Supabase] getRetencionesResumen:', error); return { error }; }
    return { data };
  };

  // ─── Identificar al dueño de un anticipo registrado sin cliente ─────────────
  // Se permite SOLO mientras no se haya aplicado nada. Una vez que parte del saldo fue
  // a la factura de alguien, `anticipos_aplicaciones` ya guardó a ese cliente: cambiarle
  // el dueño al anticipo dejaría las aplicaciones atribuidas a otra persona. Para
  // corregir en ese caso hay que revertir la aplicación primero.
  window.asignarClienteAnticipo = async function ({ pagoId, clienteId }) {
    if (!pagoId || !clienteId) return { error: { message: 'Falta el anticipo o el cliente.' } };
    const { data: pago, error: eSel } = await window.sb.from('pagos')
      .select('id, cliente_id, categoria, tipo, banco, monto, moneda').eq('id', pagoId).maybeSingle();
    if (eSel)  return { error: eSel };
    if (!pago) return { error: { message: 'El anticipo no existe.' } };
    if (pago.categoria !== 'anticipo' || pago.tipo !== 'cobro') return { error: { message: 'Ese pago no es un anticipo.' } };

    const { data: aplic, error: eAp } = await window.sb.from('anticipos_aplicaciones')
      .select('id').eq('pago_id', pagoId).limit(1);
    if (eAp) return { error: eAp };
    if (aplic && aplic.length) {
      return { error: { message: 'Este anticipo ya tiene aplicaciones a facturas. Revierte esas aplicaciones antes de cambiarle el cliente.' } };
    }

    const { error } = await window.sb.from('pagos').update({ cliente_id: clienteId }).eq('id', pagoId);
    if (error) { console.error('[Supabase] asignarClienteAnticipo:', error); return { error }; }

    // El movimiento bancario también: si queda con "sin identificar" y sin cliente, el
    // libro de bancos sigue diciendo que ese ingreso no tiene dueño.
    const cli = (window.SSData.clientes || []).find(c => c.id === clienteId);
    const { error: mErr } = await window.sb.from('movimientos_bancarios')
      .update({ cliente_id: clienteId, descripcion: 'Anticipo' + (cli?.nombre ? ' - ' + cli.nombre : '') })
      .eq('pago_id', pagoId);
    if (mErr) console.warn('[Supabase] anticipo identificado, movimiento bancario sin actualizar:', mErr.message);

    await window.loadAnticipos();
    window.logActivity?.({ modulo: 'anticipos', accion: 'editar', entidad_id: pagoId,
      entidad_label: 'Anticipo identificado',
      detalles: { cliente_id: clienteId, cliente: cli?.nombre || clienteId, antes: pago.cliente_id || 'sin identificar' } });
    return { ok: true };
  };

  // Cambiarle el cliente a un anticipo YA identificado (migración 86). Es otra operación que
  // identificar uno sin dueño: mueve deuda de un cliente a otro, así que va por RPC —todo-o-nada—
  // y solo la puede hacer un Administrador.
  //
  // Revierte las aplicaciones del anticipo antes de reasignarlo: cada una había bajado la deuda de
  // una nota del cliente ANTERIOR, y dejarlas ahí le regalaría el pago a alguien que no pagó.
  window.reasignarAnticipoCliente = async function ({ pagoId, clienteId }) {
    if (!pagoId || !clienteId) return { error: { message: 'Falta el anticipo o el cliente.' } };
    const { data, error } = await window.sb.rpc('reasignar_anticipo_cliente', {
      p_pago_id: pagoId, p_cliente_id: clienteId,
      p_usuario: window.__ssCurrentUser?.nombre || null,
    });
    if (error) { console.error('[reasignarAnticipoCliente]', error); return { error }; }
    await window.loadAnticipos();
    // Las CxC que volvieron a tener saldo: se recargan para que la cartera del cliente anterior
    // muestre la deuda de vuelta sin tener que refrescar la pantalla.
    if ((data?.aplicaciones_revertidas || 0) > 0) await window.loadAppData?.();
    window.logActivity?.({ modulo: 'anticipos', accion: 'editar', entidad_id: pagoId,
      entidad_label: 'Anticipo reasignado',
      detalles: { de: data?.cliente_anterior || 'sin identificar', a: clienteId,
                  cliente: data?.cliente_nombre || clienteId,
                  aplicaciones_revertidas: data?.aplicaciones_revertidas || 0,
                  monto_devuelto: data?.monto_devuelto || 0 } });
    return { data };
  };

  window.revertirAplicacionAnticipo = async function (aplicacionId) {
    const usuario = window.__ssCurrentUser?.nombre || null;
    const { data, error } = await window.sb.rpc('revertir_aplicacion_anticipo', {
      p_aplicacion_id: aplicacionId, p_usuario: usuario,
    });
    if (error) { console.error('[Supabase] revertirAplicacionAnticipo:', error); return { error }; }
    await window.loadAnticipos();
    window.logActivity?.({ modulo: 'anticipos', accion: 'revertir_aplicacion',
      entidad_id: aplicacionId, entidad_label: 'Reverso de aplicación', detalles: {} });
    return { data };
  };

  // Anticipos CON SALDO de un cliente, en la empresa que se pida (no necesariamente la activa: el
  // traspaso entre empresas necesita los de la empresa de ORIGEN). `SSData.anticipos` solo tiene
  // los de la empresa activa, por eso esto va al server.
  window.anticiposDisponiblesCliente = async function (clienteId, empresaId) {
    if (!clienteId) return { data: [] };
    const e = empresaId || window.currentEmpresa || 'demo1';
    const { data, error } = await window.sb.from('v_anticipos').select('*')
      .eq('empresa_id', e).eq('cliente_id', clienteId).gt('saldo_usd', 0.005)
      .order('fecha', { ascending: true });   // el más viejo primero: se consume en orden
    if (error) { console.warn('[anticiposDisponiblesCliente]', error.message); return { error, data: [] }; }
    return { data: data || [] };
  };

  // Aplicaciones de un anticipo (para el detalle).
  window.getAplicacionesAnticipo = async function (pagoId) {
    const { data, error } = await window.sb.from('anticipos_aplicaciones')
      .select('*').eq('pago_id', pagoId).order('fecha', { ascending: false });
    if (error) { console.error('[Supabase] getAplicacionesAnticipo:', error); return { error, data: [] }; }
    return { data: data || [] };
  };

  // ─── Vincular un anticipo con un traspaso YA HECHO entre empresas ───────────────────────────
  // `crearTraspasoBancario` (con `anticipoCliente`/`anticipoOrigen`) ya resuelve esto EN EL
  // MOMENTO de crear el traspaso: acredita el anticipo en destino y descuenta el de origen en un
  // solo paso atómico. Esto es para el caso que queda afuera — un traspaso que se hizo ANTES de
  // marcarlo como anticipo del cliente en destino (o antes de que existiera esa opción), y cuyo
  // anticipo de origen sigue "abierto" sin que nadie lo haya cerrado. Pedido explícito 2026-08-14.
  //
  // "Candidato" = el lado ENTRADA (en la OTRA empresa) de un traspaso cuyo `pago_id` ya quedó
  // marcado como anticipo (`PAG-ANT-`), cuyo lado SALIDA está en la empresa de origen, y que
  // TODAVÍA no cerró ningún anticipo de esa empresa. No hay columna para "ya vinculado" — se marca
  // con un prefijo `[TRF:<ref>]` en `anticipos_aplicaciones.notas` (evita una migración más para
  // algo que un texto ya resuelve) y se descarta cualquier `match_id` que ya aparezca ahí.
  window.getTraspasosAnticipoSinVincular = async function (empresaOrigen) {
    const eo = empresaOrigen || window.currentEmpresa || 'demo1';
    const { data: entradas, error: e1 } = await window.sb.from('movimientos_bancarios')
      .select('id, match_id, empresa_id, banco, monto, monto_usd, moneda, tasa, cliente_id, pago_id, fecha, descripcion')
      .like('pago_id', 'PAG-ANT-%').neq('empresa_id', eo);
    if (e1) { console.warn('[getTraspasosAnticipoSinVincular]', e1.message); return { error: e1, data: [] }; }
    const refs = [...new Set((entradas || []).map(m => m.match_id).filter(Boolean))];
    if (!refs.length) return { data: [] };
    const { data: egresos, error: e2 } = await window.sb.from('movimientos_bancarios')
      .select('id, match_id, banco, monto, moneda, fecha')
      .eq('empresa_id', eo).eq('tipo', 'egreso').in('match_id', refs);
    if (e2) { console.warn('[getTraspasosAnticipoSinVincular]', e2.message); return { error: e2, data: [] }; }
    const egresoPorRef = new Map((egresos || []).map(m => [m.match_id, m]));
    const { data: aplicadas, error: e3 } = await window.sb.from('anticipos_aplicaciones')
      .select('notas').eq('empresa_id', eo);
    if (e3) { console.warn('[getTraspasosAnticipoSinVincular]', e3.message); return { error: e3, data: [] }; }
    const yaVinculados = new Set((aplicadas || [])
      .map(a => (a.notas || '').match(/\[TRF:(TRF-\d+)\]/)?.[1]).filter(Boolean));
    const empresas = window.loadEmpresas ? await window.loadEmpresas() : [];
    const nombreEmpresa = (id) => empresas.find(x => x.id === id)?.nombre || id;
    const clientesCache = window.SSData.clientes || [];
    const candidatos = (entradas || [])
      .filter(m => egresoPorRef.has(m.match_id) && !yaVinculados.has(m.match_id))
      .map(m => ({
        matchId: m.match_id, egreso: egresoPorRef.get(m.match_id),
        empresaDestino: m.empresa_id, empresaDestinoNombre: nombreEmpresa(m.empresa_id),
        bancoDestino: m.banco, montoDestino: m.monto, monedaDestino: m.moneda,
        montoUsd: parseFloat(m.monto_usd) || 0, fecha: m.fecha, descripcion: m.descripcion,
        clienteId: m.cliente_id, clienteNombre: clientesCache.find(c => c.id === m.cliente_id)?.nombre || null,
      }));
    candidatos.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    return { data: candidatos };
  };

  window.vincularTraspasoAnticipo = async function ({ pagoId, matchId, montoUsd, empresaDestinoNombre, clienteDestinoNombre }) {
    if (!pagoId || !matchId) return { error: { message: 'Falta el anticipo o el traspaso a vincular.' } };
    const monto = Math.round((parseFloat(montoUsd) || 0) * 100) / 100;
    if (!(monto > 0)) return { error: { message: 'El monto a cerrar debe ser mayor a 0.' } };
    const notas = `[TRF:${matchId}] Cerrado por traspaso a ${empresaDestinoNombre || 'otra empresa'}`
      + (clienteDestinoNombre ? ` (anticipo de ${clienteDestinoNombre})` : '');
    const { data, error } = await window.sb.rpc('aplicar_anticipo', {
      p_pago_id: pagoId, p_documento_id: null, p_monto: monto,
      p_usuario: window.__ssCurrentUser?.nombre || null, p_notas: notas,
    });
    if (error) { console.error('[vincularTraspasoAnticipo]', error); return { error }; }
    await window.loadAnticipos();
    window.logActivity?.({ modulo: 'anticipos', accion: 'editar', entidad_id: pagoId,
      entidad_label: 'Anticipo vinculado a traspaso', detalles: { match_id: matchId, monto } });
    return { data };
  };

  // Saldo a favor de un cliente, en USD. Lee de SSData (ya cargado) para que el
  // POS pueda consultarlo en cada render sin ir a la red.
  window.getSaldoAnticipos = function (clienteId) {
    if (!clienteId) return 0;
    return (window.SSData.anticipos || [])
      .filter(a => a.cliente_id === clienteId && (parseFloat(a.saldo_usd) || 0) > 0.005)
      .reduce((s, a) => s + (parseFloat(a.saldo_usd) || 0), 0);
  };

  // ─── Seriales: cargar todos para una empresa ───────────────────────────────
  // fetchAll: hay 5,363 seriales migrados y PostgREST corta a 1000 — sin paginar
  // SerialesModal/Garantías mostraban solo un subconjunto arbitrario.
  window.loadSeriales = async function () {
    const e = window.currentEmpresa || 'demo1';
    try {
      const { data } = await fetchAll(() => window.sb
        .from('inventario_seriales').select('*').eq('empresa_id', e).order('created_at', { ascending: false }));
      return data || [];
    } catch (err) { console.error('[Supabase] Error cargando seriales:', err); return []; }
  };

  // ─── Seriales en garantía: lista PAGINADA server-side (patrón loadDocumentos) ──────────────
  // Reemplaza la carga completa (~9.9k filas / 5.3 MB) en Garantías. Todos los filtros van al
  // server: estado='vendido', vigencia, SKU, búsqueda; orden por garantia_vence (= días restantes).
  // Devuelve { rows, total } — el total real vía HEAD count barato.
  window.loadSerialesVigentes = async function (opts = {}) {
    const e = window.currentEmpresa || 'demo1';
    const page = Math.max(1, opts.page || 1);
    const pageSize = opts.pageSize || 50;
    const from = (page - 1) * pageSize, to = from + pageSize - 1;
    const hoy = opts.hoy || (window.localDateStr ? window.localDateStr() : new Date().toISOString().slice(0, 10));

    const applyFilters = (q) => {
      q = q.eq('empresa_id', e).eq('estado', 'vendido').not('garantia_vence', 'is', null);
      if (!opts.incluirVencidas) q = q.gte('garantia_vence', hoy);
      if (opts.maxDias != null) {
        const d = new Date(hoy + 'T00:00:00'); d.setDate(d.getDate() + opts.maxDias);
        q = q.lte('garantia_vence', d.toISOString().slice(0, 10));
      }
      if (opts.filtroSku) q = q.ilike('sku', `*${opts.filtroSku}*`);
      const term = (opts.search || '').trim().replace(/[(),]/g, ' ').trim();
      if (term) {
        const ors = [`serial.ilike.*${term}*`, `sku.ilike.*${term}*`, `documento_id.ilike.*${term}*`];
        const cids = (opts.clienteIds || []).filter(Boolean);
        if (cids.length) ors.push(`cliente_id.in.(${cids.slice(0, 300).join(',')})`);
        q = q.or(ors.join(','));
      }
      return q;
    };

    const asc = opts.sortDir !== 'desc'; // 'asc' = menos días restantes primero (vence antes)
    const dataQ = applyFilters(window.sb.from('inventario_seriales').select('*'))
      .order('garantia_vence', { ascending: asc, nullsFirst: false })
      .range(from, to);
    const countQ = applyFilters(window.sb.from('inventario_seriales').select('id', { count: 'exact', head: true }));
    const [dataRes, countRes] = await Promise.all([dataQ, countQ]);
    if (dataRes.error) { console.error('[Supabase] Error cargando seriales vigentes:', dataRes.error); return { rows: [], total: 0 }; }
    return { rows: dataRes.data || [], total: countRes.count || 0 };
  };

  // Trae solo los seriales referenciados por una lista de ids (para enriquecer reclamos de garantía
  // sin cargar toda la tabla). Chunk en IN(...) por si son muchos.
  window.loadSerialesByIds = async function (ids) {
    const list = [...new Set((ids || []).filter(Boolean))];
    if (!list.length) return [];
    const e = window.currentEmpresa || 'demo1';
    const { data } = await fetchAll(() => window.sb
      .from('inventario_seriales').select('*').eq('empresa_id', e).in('id', list));
    return data || [];
  };

  // ─── Seriales: agregar uno o varios (bulk) ────────────────────────────────
  // BR-INV-S09: toda mutación loguea a actividad_log
  // BR-INV-S04: unique constraint (empresa_id, serial) WHERE estado IN (disponible,vendido)
  window.agregarSeriales = async function ({ sku, almacenId, garantiaMeses, garantiaCondiciones, seriales, notas }) {
    if (!Array.isArray(seriales) || seriales.length === 0) return { error: { message: 'Lista de seriales vacía' } };
    const empresa = window.currentEmpresa || 'demo1';
    const limpios = seriales.map(s => String(s).trim()).filter(Boolean);
    if (limpios.length === 0) return { error: { message: 'Lista de seriales vacía' } };

    // Pre-check de unicidad para mensaje de error claro (evita pegar contra la BD con error 23505).
    // Incluye 'devuelto' y 'reparar': son unidades físicas reales con ese S/N (no scrap). Si solo se
    // chequea disponible/vendido, re-registrar un S/N en esos estados crea una fila duplicada
    // (la unicidad parcial de DB no lo bloquea) y rompe la identidad física del serial.
    // 'chatarra' se omite a propósito: la unidad fue desechada, su S/N puede reutilizarse.
    const { data: existentes } = await window.sb.from('inventario_seriales')
      .select('serial').eq('empresa_id', empresa).in('serial', limpios).in('estado', ['disponible', 'vendido', 'devuelto', 'reparar']);
    const duplicados = (existentes || []).map(x => x.serial);
    if (duplicados.length > 0) {
      return { error: { message: 'Ya existen estos S/N en la empresa: ' + duplicados.join(', '), duplicados } };
    }

    const rows = limpios.map(s => ({
      id:             'SER-' + Date.now() + '-' + Math.floor(Math.random() * 1e6),
      empresa_id:     empresa,
      sku,
      serial:         s,
      almacen_id:     almacenId,
      estado:         'disponible',
      garantia_meses:       parseInt(garantiaMeses) || 0,
      garantia_condiciones: garantiaCondiciones || null,
      notas:                notas || null,
      creado_por:           window.__ssCurrentUser?.nombre || null,
    }));
    const { error } = await window.sb.from('inventario_seriales').insert(rows);
    if (error) {
      console.error('[Supabase] Error agregando seriales:', error);
      // 23505 = unique_violation (por si la pre-check tuvo race condition)
      if (error.code === '23505') return { error: { ...error, message: 'Conflicto de unicidad: alguno de los S/N ya existe en esta empresa.' } };
      return { error };
    }

    // Log de actividad — uno por S/N para trazabilidad fina
    for (const r of rows) {
      window.logActivity?.({
        modulo:'inventario_seriales', accion:'crear',
        entidad_id: r.id, entidad_label: r.serial,
        detalles: { sku, almacen_id: almacenId, garantia_meses: r.garantia_meses, notas: notas || null }
      });
    }
    return { count: rows.length };
  };

  // ─── Seriales: actualizar uno ─────────────────────────────────────────────
  window.actualizarSerial = async function (id, fields) {
    // Capturar estado anterior para log diff
    const { data: antes } = await window.sb.from('inventario_seriales').select('*').eq('id', id).maybeSingle();
    const { error } = await window.sb.from('inventario_seriales')
      .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { console.error('[Supabase] Error actualizando serial:', error); return { error }; }

    const cambios = {};
    for (const k of Object.keys(fields)) {
      if ((antes?.[k] ?? null) !== (fields[k] ?? null)) cambios[k] = { antes: antes?.[k] ?? null, despues: fields[k] };
    }
    if (Object.keys(cambios).length > 0) {
      window.logActivity?.({
        modulo:'inventario_seriales', accion:'editar',
        entidad_id: id, entidad_label: antes?.serial || id,
        detalles: { sku: antes?.sku, cambios }
      });
    }
    return { error: null };
  };

  // ─── Seriales: eliminar ───────────────────────────────────────────────────
  window.eliminarSerial = async function (id) {
    const { data: antes } = await window.sb.from('inventario_seriales').select('*').eq('id', id).maybeSingle();
    const { error } = await window.sb.from('inventario_seriales').delete().eq('id', id);
    if (error) { console.error('[Supabase] Error eliminando serial:', error); return { error }; }
    if (antes) {
      // A papelera 30 días — el snapshot es la fila completa (restaurable con re-insert).
      window.ssTrash?.add('serial', antes.serial, antes);
      window.logActivity?.({
        modulo:'inventario_seriales', accion:'eliminar',
        entidad_id: id, entidad_label: antes.serial,
        detalles: { sku: antes.sku, almacen_id: antes.almacen_id, estado: antes.estado, documento_id: antes.documento_id, cliente_id: antes.cliente_id, garantia_meses: antes.garantia_meses }
      });
    }
    return { error: null };
  };
  // Restaurar un serial eliminado: re-insertar la fila completa.
  window.ssTrashHandlers = window.ssTrashHandlers || {};
  window.ssTrashHandlers.serial = async function (data) {
    if (!data?.id) return { error: 'Sin ID para restaurar' };
    const { error } = await window.sb.from('inventario_seriales').insert([data]);
    if (error && error.code !== '23505') return { error: error.message };
    await window.loadAppData?.();
    return { ok: true };
  };

  // ─── Seriales: marcar varios como vendidos al confirmar factura ───────────
  window.marcarSerialesVendidos = async function ({ serialIds, documentoId, clienteId, fechaVenta }) {
    if (!Array.isArray(serialIds) || serialIds.length === 0) return { ok: true };
    const fecha = fechaVenta || window.localDateStr();
    const { data: prev } = await window.sb.from('inventario_seriales')
      .select('id,serial,sku,garantia_meses,estado,documento_id').in('id', serialIds);
    // UPDATE individual por serial — upsert sin empresa_id viola RLS WITH CHECK
    for (const p of (prev || [])) {
      const meses = p.garantia_meses || 0;
      const d = new Date(fecha + 'T12:00:00'); d.setMonth(d.getMonth() + meses);
      const venceDate = window.localDateStr(d);
      const { error } = await window.sb.from('inventario_seriales').update({
        estado:        'vendido',
        documento_id:  documentoId,
        cliente_id:    clienteId,
        fecha_venta:   fecha,
        garantia_vence: meses > 0 ? venceDate : null,
        updated_at:    new Date().toISOString(),
      }).eq('id', p.id);
      if (error) return { error };
    }
    // Log por S/N
    for (const p of (prev || [])) {
      window.logActivity?.({
        modulo:'inventario_seriales', accion:'vender',
        entidad_id: p.id, entidad_label: p.serial,
        detalles: { sku: p.sku, documento_id: documentoId, cliente_id: clienteId, fecha_venta: fecha, estado_anterior: p.estado }
      });
    }
    return { error: null };
  };

  // ─── Seriales: registrarlos al DECLARAR LA ENTREGA del despacho ───
  // Cambio de protocolo (2026-08-03): facturar y despachar ya no piden S/N; se exigen acá, cuando
  // la pieza sale físicamente y el almacenista tiene el equipo en la mano. La RPC liga cada serial
  // al despacho (o lo crea si nunca se cargó) en UNA transacción y rechaza los ya entregados.
  // seriales: [{ sku, serial, garantia_meses?, garantia_condiciones? }]
  window.asignarSerialesEntrega = async function ({ despachoId, seriales }) {
    const limpios = (seriales || [])
      .map(s => ({
        sku: s.sku,
        serial: String(s.serial || '').trim(),
        garantia_meses: (s.garantia_meses != null && s.garantia_meses !== '') ? parseInt(s.garantia_meses, 10) : null,
        garantia_condiciones: s.garantia_condiciones || null,
      }))
      .filter(s => s.sku && s.serial);
    if (limpios.length === 0) return { ok: true, ligados: 0, creados: 0 };
    const { data, error } = await window.sb.rpc('asignar_seriales_entrega', {
      p_despacho_id: despachoId, p_seriales: limpios,
    });
    if (error) { console.error('[asignarSerialesEntrega]', error); return { error }; }
    limpios.forEach(s => {
      window.logActivity?.({
        modulo: 'inventario_seriales', accion: 'vender',
        entidad_id: despachoId, entidad_label: s.serial,
        detalles: { sku: s.sku, despacho_id: despachoId, origen: 'declarar_entrega' },
      });
    });
    return { ok: true, ...(data || {}) };
  };

  // ─── Seriales: liberar (vendido → disponible) — usado en reversión/eliminación de docs ───
  // BR-INV-S06: toda reversión/eliminación de documento debe liberar los S/N asociados
  window.liberarSeriales = async function ({ serialIds, motivo }) {
    if (!Array.isArray(serialIds) || serialIds.length === 0) return { ok: true };
    const { data: prev } = await window.sb.from('inventario_seriales')
      .select('id,serial,sku,documento_id,cliente_id,estado').in('id', serialIds);
    const { error } = await window.sb.from('inventario_seriales')
      .update({ estado:'disponible', documento_id:null, cliente_id:null, fecha_venta:null, garantia_vence:null, updated_at: new Date().toISOString() })
      .in('id', serialIds);
    if (error) return { error };
    for (const p of (prev || [])) {
      window.logActivity?.({
        modulo:'inventario_seriales', accion:'liberar',
        entidad_id: p.id, entidad_label: p.serial,
        detalles: { sku: p.sku, motivo: motivo || 'liberación manual', estado_anterior: p.estado, documento_id_anterior: p.documento_id, cliente_id_anterior: p.cliente_id }
      });
    }
    return { error: null };
  };

  // ─── Seriales: marcar devueltos al procesar una devolución (BR-INV-S07) ───
  // estado: vendido → devuelto + inspeccion_estado='pendiente' + snapshot de cliente/doc originales
  window.devolverSeriales = async function ({ serialIds, devolucionId, motivo }) {
    if (!Array.isArray(serialIds) || serialIds.length === 0) return { ok: true };
    const { data: prev } = await window.sb.from('inventario_seriales')
      .select('id,serial,sku,documento_id,cliente_id,estado').in('id', serialIds);
    // Solo permitir devolver S/N que estén vendidos
    const noVendidos = (prev || []).filter(p => p.estado !== 'vendido');
    if (noVendidos.length > 0) {
      return { error: { message: 'Solo se pueden devolver S/N vendidos. Bloqueados: ' + noVendidos.map(x => `${x.serial} (${x.estado})`).join(', ') } };
    }
    const updates = (prev || []).map(p => ({
      id: p.id,
      estado: 'devuelto',
      inspeccion_estado: 'pendiente',
      documento_id_original: p.documento_id,
      cliente_id_original: p.cliente_id,
      devolucion_id: devolucionId,
      documento_id: null,
      cliente_id: null,
      fecha_venta: null,
      garantia_vence: null,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await window.sb.from('inventario_seriales').upsert(updates, { onConflict: 'id' });
    if (error) return { error };
    for (const p of (prev || [])) {
      window.logActivity?.({
        modulo:'inventario_seriales', accion:'devolver',
        entidad_id: p.id, entidad_label: p.serial,
        detalles: { sku: p.sku, devolucion_id: devolucionId, motivo, documento_original: p.documento_id, cliente_original: p.cliente_id }
      });
    }
    return { error: null };
  };

  // ─── Seriales: inspeccionar devuelto → ok | reparar | chatarra ─────────────
  // BR-INV-S07: solo 'ok' permite volver a estado='disponible'. 'reparar' y 'chatarra' quedan bloqueados.
  window.inspeccionarSerial = async function ({ serialId, resultado, notas }) {
    if (!['ok', 'reparar', 'chatarra'].includes(resultado)) {
      return { error: { message: 'Resultado de inspección inválido. Debe ser ok | reparar | chatarra.' } };
    }
    const { data: prev } = await window.sb.from('inventario_seriales').select('*').eq('id', serialId).maybeSingle();
    if (!prev) return { error: { message: 'S/N no encontrado.' } };
    if (prev.estado !== 'devuelto') return { error: { message: 'Solo se pueden inspeccionar S/N en estado devuelto.' } };

    const patch = {
      inspeccion_estado: resultado,
      notas: notas ? (prev.notas ? prev.notas + '\n' : '') + `[Inspección ${window.localDateStr()} → ${resultado}] ${notas}` : prev.notas,
      updated_at: new Date().toISOString(),
    };
    // Solo 'ok' devuelve al stock disponible
    if (resultado === 'ok') patch.estado = 'disponible';

    const { error } = await window.sb.from('inventario_seriales').update(patch).eq('id', serialId);
    if (error) return { error };
    window.logActivity?.({
      modulo:'inventario_seriales', accion:'inspeccionar',
      entidad_id: serialId, entidad_label: prev.serial,
      detalles: { sku: prev.sku, resultado, notas: notas || null, devolucion_id: prev.devolucion_id }
    });
    return { error: null };
  };

  // ─── Seriales: transferir entre almacenes (BR-INV-S05) ────────────────────
  window.transferirSeriales = async function ({ serialIds, almacenDestinoId, motivo }) {
    if (!Array.isArray(serialIds) || serialIds.length === 0) return { ok: true };
    const { data: prev } = await window.sb.from('inventario_seriales')
      .select('id,serial,sku,almacen_id,estado').in('id', serialIds);
    // Validación: solo se pueden transferir S/N disponibles
    const noDisponibles = (prev || []).filter(p => p.estado !== 'disponible');
    if (noDisponibles.length > 0) {
      return { error: { message: 'Solo se pueden transferir S/N en estado disponible. Bloqueados: ' + noDisponibles.map(x => `${x.serial} (${x.estado})`).join(', ') } };
    }
    const { error } = await window.sb.from('inventario_seriales')
      .update({ almacen_id: almacenDestinoId, updated_at: new Date().toISOString() })
      .in('id', serialIds);
    if (error) return { error };
    for (const p of (prev || [])) {
      window.logActivity?.({
        modulo:'inventario_seriales', accion:'transferir',
        entidad_id: p.id, entidad_label: p.serial,
        detalles: { sku: p.sku, almacen_origen: p.almacen_id, almacen_destino: almacenDestinoId, motivo: motivo || 'transferencia entre almacenes' }
      });
    }
    return { error: null };
  };

  // ─── Seriales: lookup por número (consulta de garantía) ───────────────────
  window.buscarSerial = async function (serialNum) {
    const e = window.currentEmpresa || 'demo1';
    const { data, error } = await window.sb
      .from('inventario_seriales').select('*')
      .eq('empresa_id', e).eq('serial', String(serialNum).trim()).limit(5);
    if (error) { console.error('[Supabase] Error buscando serial:', error); return []; }
    return data || [];
  };

  // ─── Garantías: cargar ────────────────────────────────────────────────────
  window.loadGarantias = async function () {
    const e = window.currentEmpresa || 'demo1';
    const { data, error } = await window.sb
      .from('garantias').select('*').eq('empresa_id', e).order('fecha_reclamo', { ascending: false });
    if (error) { console.error('[Supabase] Error cargando garantías:', error); return []; }
    return data || [];
  };

  // ─── Garantías: crear reclamo ─────────────────────────────────────────────
  window.crearGarantia = async function ({ serialId, clienteId, documentoOrigenId, motivo, descripcion, responsable }) {
    const empresa = window.currentEmpresa || 'demo1';
    const id = 'GAR-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const payload = {
      id,
      empresa_id:        empresa,
      serial_id:         serialId,
      cliente_id:        clienteId || null,
      documento_origen_id: documentoOrigenId || null,
      fecha_reclamo:     window.localDateStr(),
      motivo:            motivo || null,
      descripcion:       descripcion || null,
      estado:            'pendiente',
      responsable:       responsable || null,
      creado_por:        window.__ssCurrentUser?.nombre || null,
    };
    const { error } = await window.sb.from('garantias').insert(payload);
    if (error) { console.error('[Supabase] Error creando garantía:', error); return { error }; }
    return { id };
  };

  // ─── Garantías: actualizar (estado, resolución, etc.) ─────────────────────
  window.actualizarGarantia = async function (id, fields) {
    const { error } = await window.sb.from('garantias')
      .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
    return { error };
  };

  // ─── Contar documentos por estado ─────────────────────────────────────────
  // Devuelve dos dimensiones:
  //   porTipo:      conteo por etapa (cotizacion/orden/factura/despacho), EXCLUYE canceladas → pipeline switcher / hub
  //   porSubestado: conteo por sub-estado (creada/convertida/generada/facturada/por_cobrar/cobrada/por_despachar/despachado/cancelada) → desgloses de tabs
  // Cache por empresa de los conteos del pipeline. get_documento_counts es la query más pesada
  // del sistema (~450 ms, derrama a disco) y se re-llamaba en CADA cambio de etapa del POS.
  // TTL corto + invalidación explícita tras mutaciones (window.invalidateDocCounts).
  const __docCountsCache = {};
  const DOC_COUNTS_TTL = 90 * 1000;
  window.invalidateDocCounts = function (empresa) {
    delete __docCountsCache[empresa || window.currentEmpresa || 'demo1'];
    // Y el caché de páginas de las listas: lo llaman los mismos sitios que crean, editan,
    // cancelan o borran documentos, así que es el punto exacto donde las páginas guardadas
    // dejaron de ser ciertas. Sin esto, tras facturar se vería un instante la lista vieja.
    window.ssDocsCache?.clear();
  };
  window.countDocumentos = async function (opts = {}) {
    const e = window.currentEmpresa || 'demo1';
    const cached = __docCountsCache[e];
    if (!opts.force && cached && (Date.now() - cached.ts) < DOC_COUNTS_TTL) return cached.data;
    const cacheAndReturn = (r) => { __docCountsCache[e] = { data: r, ts: Date.now() }; return r; };
    // Preferir la RPC agregada server-side: cuenta sobre los 92k documentos completos
    // (el escaneo por filas de abajo estaba capado a 1000 → pipeline con cifras falsas).
    try {
      const { data: agg, error: aggErr } = await window.sb.rpc('get_documento_counts', { p_empresa_id: e });
      if (!aggErr && agg && agg.porTipo) {
        return cacheAndReturn({ porTipo: agg.porTipo || {}, porSubestado: agg.porSubestado || {}, porFlujo: agg.porFlujo || {} });
      }
    } catch (err) { console.warn('[Supabase] get_documento_counts falló, usando fallback:', err); }

    // Fallback legacy (capado a 1000; solo si la RPC no está disponible)
    const { data } = await window.sb.from('documentos')
      .select('id, tipo, estado, documento_origen_id').eq('empresa_id', e);
    const rows = data || [];
    const porTipo = {}, porSubestado = {};

    // Padres con hijo NO cancelado del tipo siguiente — MISMA lógica que has_child en
    // loadDocumentos. La "conversión" NO es un estado: una cotización convertida sigue
    // con estado 'creada'; se distingue por tener una orden hija (idem orden→factura).
    const convertidos = { orden: new Set(), factura: new Set() }; // key = tipo del HIJO
    rows.forEach(d => {
      if (d.estado !== 'cancelada' && d.estado !== 'anulada' && d.documento_origen_id && convertidos[d.tipo]) {
        convertidos[d.tipo].add(d.documento_origen_id);
      }
    });

    // Desglose por flujo (coincide exactamente con los sub-tabs de la tabla)
    const porFlujo = {
      cotizacion: { creadas: 0, convertidas: 0 },
      orden:      { generadas: 0, facturadas: 0 },
      despacho:   { por_despachar: 0, despachadas: 0 },
    };
    rows.forEach(d => {
      porSubestado[d.estado] = (porSubestado[d.estado] || 0) + 1;
      if (d.estado === 'cancelada') return;
      porTipo[d.tipo] = (porTipo[d.tipo] || 0) + 1;
      if (d.tipo === 'cotizacion') {
        convertidos.orden.has(d.id) ? porFlujo.cotizacion.convertidas++ : porFlujo.cotizacion.creadas++;
      } else if (d.tipo === 'orden') {
        convertidos.factura.has(d.id) ? porFlujo.orden.facturadas++ : porFlujo.orden.generadas++;
      } else if (d.tipo === 'despacho') {
        d.estado === 'despachado' ? porFlujo.despacho.despachadas++ : porFlujo.despacho.por_despachar++;
      }
    });
    return cacheAndReturn({ porTipo, porSubestado, porFlujo });
  };

  // ─── Eliminar vendedores por IDs (soft delete) ───────────────────────────
  window.deleteVendedores = async function (ids) {
    if (!ids || ids.length === 0) return { error: null };
    const { error } = await window.sb.from('vendedores').update({ activo: false }).in('id', ids);
    if (!error) {
      window.SSData.vendedores = (window.SSData.vendedores || []).filter(v => !ids.includes(v.id));
    }
    return { error };
  };

  // ─── Eliminar productos por SKUs (soft delete) ────────────────────────────
  window.deleteProductos = async function (skus) {
    if (!skus || skus.length === 0) return { error: null };
    const empresa = window.currentEmpresa || 'demo1';
    // Scope por empresa para no tocar filas de otras empresas
    const { data, error } = await window.sb
      .from('productos')
      .update({ activo: false })
      .in('sku', skus)
      .overlaps('empresas', [empresa])
      .select('sku');
    if (error) {
      console.error('[Supabase] deleteProductos error:', error);
      return { error };
    }
    const updated = (data || []).map(d => d.sku);
    console.info('[Supabase] deleteProductos: solicitado', skus.length, '· actualizados', updated.length);
    if (updated.length === 0) {
      return { error: { message: `No se actualizó ningún producto. Verifica que los SKUs pertenezcan a la empresa "${empresa}".` } };
    }
    window.SSData.productos = (window.SSData.productos || []).filter(p => !updated.includes(p.sku));
    return { error: null, count: updated.length };
  };

  // ─── Eliminar documentos por IDs ──────────────────────────────────────────
  // BR-INV-S06: si el documento tenía S/N asociados, liberarlos antes de eliminar
  window.deleteDocumentos = async function (ids, opts = {}) {
    if (!ids || ids.length === 0) return { error: null };
    // opts.extraByDoc[docId] = campos extra a fusionar en el snapshot de ese doc (ej. datos para
    // revertir la anulación de una factura: _facturaAnulada/_cxc/_invItems/_invAlmacen).
    const extraByDoc = opts.extraByDoc || {};
    window.invalidateDocCounts && window.invalidateDocCounts();
    // Snapshot para papelera antes de borrar. Se traen las filas COMPLETAS de la DB (no de
    // SSData.documentos) porque la lista es server-driven: un doc fuera de la ventana en memoria
    // (~90d) igual debe snapshotearse antes de hard-borrarlo (bug: antes se borraba sin papelera).
    let targets = [];
    { const { data: dbDocs } = await window.sb.from('documentos').select('*').in('id', ids);
      targets = dbDocs || (window.SSData.documentos || []).filter(d => ids.includes(d.id)); }
    // Cargar items para poder restaurar fielmente
    const { data: itemsData } = await window.sb.from('documentos_items').select('*').in('documento_id', ids);
    const itemsByDoc = {};
    (itemsData || []).forEach(i => { (itemsByDoc[i.documento_id] = itemsByDoc[i.documento_id] || []).push(i); });

    // BR-INV-S06: liberar S/N asignados a estos documentos.
    // Se capturan los S/N POR DOCUMENTO antes de liberarlos, para poder re-vincularlos al restaurar.
    const { data: snAsignados } = await window.sb.from('inventario_seriales')
      .select('id, documento_id').in('documento_id', ids);
    const snIds = (snAsignados || []).map(s => s.id);
    const snByDoc = {};
    (snAsignados || []).forEach(s => { (snByDoc[s.documento_id] = snByDoc[s.documento_id] || []).push(s.id); });
    if (snIds.length > 0) {
      await window.liberarSeriales({ serialIds: snIds, motivo: `Eliminación de documento(s): ${ids.join(', ')}` });
    }

    await window.sb.from('documentos_items').delete().in('documento_id', ids);
    const { error } = await window.sb.from('documentos').delete().in('id', ids);
    if (!error) {
      targets.forEach(d => window.ssTrash?.add('documento', d.id, { ...d, _items: itemsByDoc[d.id] || [], _serialIds: snByDoc[d.id] || [], ...(extraByDoc[d.id] || {}) }));
      window.SSData.documentos = (window.SSData.documentos || []).filter(d => !ids.includes(d.id));
      window.logActivity?.({
        modulo: 'documentos', accion: targets.length === 1 ? 'eliminar' : 'bulk_eliminar',
        entidad_id: targets.length === 1 ? targets[0].id : null,
        entidad_label: targets.length === 1 ? targets[0].id : `${targets.length} documentos`,
        detalles: { ids, seriales_liberados: snIds.length }
      });
    }
    return { error };
  };

  // ─── Ajustar inventario por movimiento de factura ─────────────────────────
  // modo='debitar': resta qty de cantidad+reservado (al crear factura)
  // modo='restaurar': suma qty a cantidad (al anular factura)
  window.ajustarInventario = async function (items, almacenId, modo, empresaId) {
    if (!items?.length || !almacenId) return { error: null };
    for (const item of items) {
      const qty = item.qty || item.cantidad || 0;
      if (!qty) continue;
      const inv = ((window.SSData.inventario || {})[item.sku] || {})[almacenId];
      const curCantidad  = inv?.cantidad  ?? 0;
      const curReservado = inv?.reservado ?? 0;
      // Modos:
      //  'debitar'          → resta a cantidad Y reservado (al crear/postear factura).
      //  'debitar_cantidad' → resta SOLO a cantidad (inverso EXACTO de 'restaurar'; usado al
      //                       restaurar una factura anulada, para no comerse reservas de otras órdenes).
      //  (default)'restaurar' → suma a cantidad, no toca reservado (al anular factura).
      const esDebito = modo === 'debitar' || modo === 'debitar_cantidad';
      if (modo === 'debitar_cantidad' && (curCantidad - qty) < 0) {
        console.warn(`[ajustarInventario] posible sobre-venta al restaurar: ${item.sku}@${almacenId} cantidad ${curCantidad} - ${qty} < 0 (se trunca a 0)`);
      }
      const newCantidad  = esDebito ? Math.max(0, curCantidad - qty) : curCantidad + qty;
      const newReservado = modo === 'debitar' ? Math.max(0, curReservado - qty) : curReservado;
      // Capturar el error del upsert: si la DB falla (RLS/red) NO mutamos SSData
      // para no divergir el estado local del persistido (bug #24).
      const { error } = await window.sb.from('inventario')
        .upsert({ sku: item.sku, almacen_id: almacenId, cantidad: newCantidad, reservado: newReservado },
                 { onConflict: 'sku,almacen_id' });
      if (error) { console.error('[ajustarInventario]', error); return { error }; }
      if (!window.SSData.inventario) window.SSData.inventario = {};
      if (!window.SSData.inventario[item.sku]) window.SSData.inventario[item.sku] = {};
      if (!window.SSData.inventario[item.sku][almacenId]) window.SSData.inventario[item.sku][almacenId] = {};
      window.SSData.inventario[item.sku][almacenId].cantidad  = newCantidad;
      window.SSData.inventario[item.sku][almacenId].reservado = newReservado;
    }
    return { error: null };
  };

  // ═══ Transferencias de inventario con recepción (envío → tránsito → recepción → cierre) ═══
  // Refleja SSData.inventario para la empresa activa; el cambio real en DB va vía inv_ajustar_cantidad
  // (atómico, cross-empresa). estado del inventario en memoria se sincroniza solo si es la empresa activa.
  function _reflectInv(sku, almacenId, delta, empresa) {
    if (empresa !== (window.currentEmpresa || 'demo1')) return;   // otra empresa: no está en SSData
    const inv = window.SSData.inventario = window.SSData.inventario || {};
    inv[sku] = inv[sku] || {}; inv[sku][almacenId] = inv[sku][almacenId] || { cantidad: 0, reservado: 0 };
    inv[sku][almacenId].cantidad = Math.max(0, (inv[sku][almacenId].cantidad || 0) + delta);
  }

  // Crear = ENVIAR: descuenta cada item del almacén origen (queda en tránsito) y crea la transferencia.
  window.crearTransferencia = async function ({ empresaOrigen, empresaDest, almacenOrigen, almacenDest, items, notas }) {
    if (!almacenOrigen || !almacenDest) return { error: { message: 'Falta almacén origen o destino.' } };
    if (almacenOrigen === almacenDest && empresaOrigen === empresaDest) return { error: { message: 'El origen y el destino deben ser distintos.' } };
    const limpios = (items || []).map(i => ({ sku: i.sku, nombre: i.nombre || '', cantidad: parseInt(i.cantidad) || 0 })).filter(i => i.sku && i.cantidad > 0);
    if (!limpios.length) return { error: { message: 'Agrega al menos un producto con cantidad.' } };

    // Cross-empresa: el producto se COMPARTE con la empresa destino (se le agrega a `empresas`), no
    // se clona. Antes se insertaba una copia, y con `productos.sku` como PK global eso fallaba en
    // silencio cuando el SKU ya existía: la transferencia quedaba apuntando a un producto que el
    // destino no veía. Ver migracion-odoo/17_productos_multiempresa.sql.
    if (empresaOrigen !== empresaDest) {
      const skus = limpios.map(i => i.sku);
      const { data: prods } = await window.sb.from('productos').select('sku, empresas').in('sku', skus);
      for (const p of (prods || [])) {
        const ya = Array.isArray(p.empresas) ? p.empresas : [];
        if (ya.includes(empresaDest)) continue;
        const { error: eComp } = await window.sb.from('productos')
          .update({ empresas: [...ya, empresaDest] }).eq('sku', p.sku);
        if (eComp) console.warn('[crearTransferencia] no se pudo compartir', p.sku, eComp);
      }
    }

    // El id se arma ANTES de tocar el stock para poder referenciarlo en el asiento del kardex
    // (cada movimiento queda hermanado a su transferencia por ref_documento).
    const id = 'TRF-' + Date.now();
    const usuario = window.__ssCurrentUser?.nombre || null;

    // Descontar el origen item por item (atómico por fila). Si uno falla, revertir los ya descontados
    // en DB Y en SSData (para no dejar memoria mostrando stock reducido de forma fantasma).
    // Kardex: ésta es la pata de SALIDA del traslado (la de ENTRADA la asienta
    // recibir_transferencia_item al recibir). Ver "Kardex de inventario" en CLAUDE.md.
    const hechos = [];
    const revertirTodo = async () => {
      for (const h of hechos) {
        // El descuento ya quedó asentado como salida; devolverlo asienta la entrada que lo compensa.
        // Se asienta el reverso en vez de borrar el asiento original: un libro de auditoría no reescribe historia.
        await window.sb.rpc('inv_ajustar_cantidad', {
          p_sku: h.sku, p_almacen: almacenOrigen, p_empresa: empresaOrigen, p_delta: h.cantidad,
          p_tipo: 'entrada', p_ref_tipo: 'traslado', p_ref_documento: id,
          p_motivo: 'Reverso: falló el envío de la transferencia', p_usuario: usuario,
        });
        _reflectInv(h.sku, almacenOrigen, h.cantidad, empresaOrigen);
      }
    };
    for (const it of limpios) {
      const { data: r, error } = await window.sb.rpc('inv_ajustar_cantidad', {
        p_sku: it.sku, p_almacen: almacenOrigen, p_empresa: empresaOrigen, p_delta: -it.cantidad,
        p_tipo: 'salida', p_ref_tipo: 'traslado', p_ref_documento: id,
        p_motivo: 'Envío de transferencia', p_usuario: usuario,
      });
      if (error || r?.error) {
        await revertirTodo();
        const msg = r?.error === 'sin_stock' ? `Sin stock suficiente de ${it.sku} en el origen (disponible ${r.disponible ?? 0}).` : (error?.message || 'Error descontando el origen.');
        return { error: { message: msg } };
      }
      hechos.push(it);
      _reflectInv(it.sku, almacenOrigen, -it.cantidad, empresaOrigen);
    }

    const { error: tErr } = await window.sb.from('transferencias').insert({
      id, empresa_origen: empresaOrigen, empresa_destino: empresaDest,
      almacen_origen: almacenOrigen, almacen_destino: almacenDest,
      estado: 'en_transito', notas: notas || null,
      enviado_por: usuario,
    });
    if (tErr) { await revertirTodo(); return { error: tErr }; }
    // Insertar los items; si falla, revertir stock y borrar la cabecera (no dejar transferencia sin items).
    const { error: iErr } = await window.sb.from('transferencias_items').insert(limpios.map((it, idx) => ({
      id: id + '-' + idx, transferencia_id: id, empresa_origen: empresaOrigen, empresa_destino: empresaDest,
      sku: it.sku, nombre: it.nombre, cantidad_enviada: it.cantidad, cantidad_recibida: 0,
    })));
    if (iErr) {
      await revertirTodo();
      await window.sb.from('transferencias').delete().eq('id', id);
      return { error: iErr };
    }
    window.logActivity?.({ modulo: 'transferencias', accion: 'crear', entidad_id: id, entidad_label: id, detalles: { almacen_origen: almacenOrigen, almacen_destino: almacenDest, items: limpios.length, unidades: limpios.reduce((s, i) => s + i.cantidad, 0) } });
    return { ok: true, id };
  };

  // RECIBIR: recepciones = [{itemId, sku, cantidad}] (cantidad = lo recibido AHORA). Acredita el destino
  // y suma a cantidad_recibida. Recalcula el estado (parcial/recibida). `firma` = base64 png (obligatoria).
  window.recibirTransferencia = async function (transfId, recepciones, firma) {
    const { data: t } = await window.sb.from('transferencias').select('*').eq('id', transfId).maybeSingle();
    if (!t) return { error: { message: 'Transferencia no encontrada.' } };
    if (t.estado === 'cerrada' || t.estado === 'cancelada') return { error: { message: 'La transferencia ya está cerrada/cancelada.' } };
    if (!firma) return { error: { message: 'La recepción debe firmarse digitalmente.' } };
    const { data: itemsDB } = await window.sb.from('transferencias_items').select('*').eq('transferencia_id', transfId);
    const byId = {}; (itemsDB || []).forEach(i => byId[i.id] = i);
    for (const rec of (recepciones || [])) {
      const it = byId[rec.itemId]; const qty = parseInt(rec.cantidad) || 0;
      if (!it || qty <= 0) continue;
      // RPC ATÓMICO: lock de fila + clamp a lo pendiente + update condicional + acredita destino,
      // todo en una transacción → sin doble-crédito por recepciones concurrentes.
      const { data: r, error } = await window.sb.rpc('recibir_transferencia_item', { p_item_id: it.id, p_cantidad: qty, p_usuario: window.__ssCurrentUser?.nombre || null });
      if (error || r?.error) return { error: { message: (r?.error === 'transferencia_cerrada' ? 'La transferencia ya está cerrada.' : error?.message) || 'Error acreditando el destino.' } };
      const recibido = r?.recibido || 0;
      if (recibido > 0) { _reflectInv(it.sku, t.almacen_destino, recibido, t.empresa_destino); it.cantidad_recibida = r.cantidad_recibida; }
    }
    const todo = (itemsDB || []).every(i => (i.cantidad_recibida || 0) >= (i.cantidad_enviada || 0));
    const algo = (itemsDB || []).some(i => (i.cantidad_recibida || 0) > 0);
    const nuevoEstado = todo ? 'recibida' : (algo ? 'recibida_parcial' : 'en_transito');
    const ahora = new Date().toISOString();
    await window.sb.from('transferencias').update({ estado: nuevoEstado, fecha_recepcion: ahora, recibido_por: window.__ssCurrentUser?.nombre || null, firma_recepcion: firma, firma_recepcion_fecha: ahora }).eq('id', transfId);
    window.logActivity?.({ modulo: 'transferencias', accion: 'recibir', entidad_id: transfId, entidad_label: transfId, detalles: { estado: nuevoEstado, firmado: true } });
    return { ok: true, estado: nuevoEstado };
  };

  // CERRAR: lo aún faltante (enviada - recibida) queda documentado como merma. No mueve stock.
  // Guarda de estado: no re-cerrar ni cerrar una cancelada (evita habilitar devolver-faltante sobre
  // una transferencia ya restaurada → doble crédito).
  window.cerrarTransferencia = async function (transfId) {
    const { data: t } = await window.sb.from('transferencias').select('estado').eq('id', transfId).maybeSingle();
    if (!t) return { error: { message: 'No encontrada.' } };
    if (t.estado === 'cerrada' || t.estado === 'cancelada') return { error: { message: 'La transferencia ya está ' + t.estado + '.' } };
    const { error } = await window.sb.from('transferencias').update({ estado: 'cerrada', fecha_cierre: new Date().toISOString(), cerrado_por: window.__ssCurrentUser?.nombre || null }).eq('id', transfId);
    if (error) return { error };
    window.logActivity?.({ modulo: 'transferencias', accion: 'cerrar', entidad_id: transfId, entidad_label: transfId });
    return { ok: true };
  };

  // CANCELAR: solo si no se recibió nada Y sigue abierta — re-ingresa TODO al origen y marca cancelada.
  window.cancelarTransferencia = async function (transfId) {
    const { data: t } = await window.sb.from('transferencias').select('*').eq('id', transfId).maybeSingle();
    if (!t) return { error: { message: 'No encontrada.' } };
    if (t.estado === 'cerrada' || t.estado === 'cancelada') return { error: { message: 'La transferencia ya está ' + t.estado + '.' } };
    const { data: items } = await window.sb.from('transferencias_items').select('*').eq('transferencia_id', transfId);
    if ((items || []).some(i => (i.cantidad_recibida || 0) > 0)) return { error: { message: 'No se puede cancelar: ya hay mercancía recibida. Ciérrala en su lugar.' } };
    // Marcar cancelada PRIMERO (guarda contra doble cancelación concurrente); si falla, abortar.
    const { error } = await window.sb.from('transferencias').update({ estado: 'cancelada', cerrado_por: window.__ssCurrentUser?.nombre || null }).eq('id', transfId).eq('estado', t.estado);
    if (error) return { error };
    for (const it of (items || [])) {
      // Kardex: la mercancía nunca salió de circulación, vuelve al origen → entrada que compensa
      // la salida asentada al enviar.
      await window.sb.rpc('inv_ajustar_cantidad', {
        p_sku: it.sku, p_almacen: t.almacen_origen, p_empresa: t.empresa_origen, p_delta: it.cantidad_enviada || 0,
        p_tipo: 'entrada', p_ref_tipo: 'traslado', p_ref_documento: transfId,
        p_motivo: 'Cancelación de transferencia', p_usuario: window.__ssCurrentUser?.nombre || null,
      });
      _reflectInv(it.sku, t.almacen_origen, it.cantidad_enviada || 0, t.empresa_origen);
    }
    window.logActivity?.({ modulo: 'transferencias', accion: 'cancelar', entidad_id: transfId, entidad_label: transfId });
    return { ok: true };
  };

  // DEVOLVER FALTANTE: re-ingresa la merma (enviada - recibida) de una transferencia CERRADA a un
  // almacén elegido (p.ej. el principal). Marca faltante_devuelto para no repetir.
  window.devolverFaltanteTransferencia = async function (transfId, almacenDestinoId, empresaDestinoId) {
    const { data: t } = await window.sb.from('transferencias').select('*').eq('id', transfId).maybeSingle();
    if (!t) return { error: { message: 'No encontrada.' } };
    if (t.estado !== 'cerrada') return { error: { message: 'Solo se puede devolver el faltante de una transferencia cerrada.' } };
    if (t.faltante_devuelto) return { error: { message: 'El faltante ya fue devuelto.' } };
    const empresa = empresaDestinoId || t.empresa_origen;
    // Marcar la bandera PRIMERO con guarda condicional (faltante_devuelto=false): si otra llamada
    // concurrente ya la marcó, este update no afecta filas y abortamos → sin doble crédito.
    const { data: flagRows, error: flagErr } = await window.sb.from('transferencias')
      .update({ faltante_devuelto: true }).eq('id', transfId).eq('faltante_devuelto', false).select('id');
    if (flagErr) return { error: flagErr };
    if (!flagRows || flagRows.length === 0) return { error: { message: 'El faltante ya fue devuelto.' } };
    const { data: items } = await window.sb.from('transferencias_items').select('*').eq('transferencia_id', transfId);
    let unidades = 0;
    for (const it of (items || [])) {
      const falt = (it.cantidad_enviada || 0) - (it.cantidad_recibida || 0);
      if (falt <= 0) continue;
      // Kardex: la merma documentada al cerrar reaparece físicamente y se reincorpora al almacén elegido.
      await window.sb.rpc('inv_ajustar_cantidad', {
        p_sku: it.sku, p_almacen: almacenDestinoId, p_empresa: empresa, p_delta: falt,
        p_tipo: 'entrada', p_ref_tipo: 'traslado', p_ref_documento: transfId,
        p_motivo: 'Devolución del faltante de la transferencia', p_usuario: window.__ssCurrentUser?.nombre || null,
      });
      _reflectInv(it.sku, almacenDestinoId, falt, empresa);
      unidades += falt;
    }
    window.logActivity?.({ modulo: 'transferencias', accion: 'editar', entidad_id: transfId, entidad_label: transfId, detalles: { faltante_devuelto_a: almacenDestinoId, unidades } });
    return { ok: true, unidades };
  };

  // Cargar transferencias (cabeceras + items) visibles para la empresa activa (origen o destino).
  window.loadTransferencias = async function () {
    const e = window.currentEmpresa || 'demo1';
    const { data: heads } = await window.sb.from('transferencias').select('*')
      .or(`empresa_origen.eq.${e},empresa_destino.eq.${e}`).order('fecha_envio', { ascending: false });
    const ids = (heads || []).map(h => h.id);
    let items = [];
    if (ids.length) { const { data } = await window.sb.from('transferencias_items').select('*').in('transferencia_id', ids); items = data || []; }
    const byT = {}; items.forEach(i => { (byT[i.transferencia_id] = byT[i.transferencia_id] || []).push(i); });
    return (heads || []).map(h => ({ ...h, items: byT[h.id] || [] }));
  };

  // Reserva (on hold) por orden — actualización OPTIMISTA de SSData únicamente.
  // La PERSISTENCIA de `reservado` la hacen triggers de DB confiables (migración
  // 20260626_reserva_inventario_orden): al insertar/borrar líneas de una orden y
  // al cancelarla/des-cancelarla. Antes esto hacía el upsert desde el cliente y
  // se saltaba en silencio (0/72 reservados). Acá solo reflejamos el cambio en
  // memoria para que la UI muestre el hold de inmediato; el trigger es la verdad.
  window.reservarInventario = async function (items, almacenId, modo) {
    if (!items?.length || !almacenId) return { error: null };
    for (const item of items) {
      if (!item.sku || item.sku === '__SECTION__') continue;
      const qty = item.qty || item.cantidad || 0;
      if (!qty) continue;
      if (!window.SSData.inventario) window.SSData.inventario = {};
      if (!window.SSData.inventario[item.sku]) window.SSData.inventario[item.sku] = {};
      if (!window.SSData.inventario[item.sku][almacenId]) window.SSData.inventario[item.sku][almacenId] = {};
      const cur = window.SSData.inventario[item.sku][almacenId].reservado ?? 0;
      window.SSData.inventario[item.sku][almacenId].reservado = modo === 'reservar' ? cur + qty : Math.max(0, cur - qty);
    }
    return { error: null };
  };

  // ─── "No se puede facturar sin stock disponible" — verificación REAL ────────
  // El inventario se debita al DESPACHAR, no al facturar. El chequeo previo comparaba la
  // cantidad física contra la cantidad de ESTA factura y nada más, así que con 1 unidad en
  // existencia se podía facturar N veces: cada factura pasaba el chequeo contra la MISMA
  // unidad (caso real: 4 facturas para una orden de 1 unidad de P032).
  //
  // Acá se pregunta al SERVER —no a `SSData.inventario`, que puede estar viejo— cuántas
  // unidades hay y cuántas ya prometieron otras facturas emitidas y sin despachar
  // (RPC stock_comprometido). Ver migracion-odoo/12_stock_comprometido.sql.
  //
  // FALLA CERRADA: si no se puede verificar, NO se factura. Prometer mercancía que no está
  // es un problema físico; un bloqueo de más solo cuesta reintentar. Mismo criterio que la
  // exigencia de seriales al recibir, que antes fallaba abierta y se corrigió.
  window.validarStockFacturar = async function (items, almacenId, excluirDocumentoId) {
    const pedido = {};
    (items || []).forEach(i => {
      if (!i.sku || i.sku === '__SECTION__') return;
      // Un SERVICIO (flete, mano de obra) no tiene existencias: no hay nada que verificar. Sin
      // este corte, la línea de flete pedía 1 contra un disponible de 0 y BLOQUEABA la factura
      // entera — la venta se caía por el envío. Ver migracion-odoo/42_productos_servicio.sql.
      if (window.esProductoServicio?.(i.sku)) return;
      // Un mismo SKU puede venir en dos líneas: se suma, no se evalúa por línea.
      pedido[i.sku] = (pedido[i.sku] || 0) + (Math.round(i.qty ?? i.cantidad ?? 0) || 0);
    });
    const skus = Object.keys(pedido);
    if (!skus.length) return { faltantes: [] };
    if (!almacenId) return { error: { message: 'La factura no tiene almacén: no se puede verificar el stock.' } };
    const e = window.currentEmpresa || 'demo1';
    const [invRes, compRes] = await Promise.all([
      // `inventario` no tiene empresa_id; el almacén ya la determina.
      window.sb.from('inventario').select('sku, cantidad').eq('almacen_id', almacenId).in('sku', skus),
      window.sb.rpc('stock_comprometido', { p_empresa_id: e, p_almacen_id: almacenId, p_skus: skus,
                                            p_excluir_documento: excluirDocumentoId || null }),
    ]);
    if (invRes.error || compRes.error) {
      console.error('[validarStockFacturar]', invRes.error || compRes.error);
      return { error: invRes.error || compRes.error };
    }
    const fisico = {}; (invRes.data  || []).forEach(r => { fisico[r.sku] = parseFloat(r.cantidad) || 0; });
    const comp   = {}; (compRes.data || []).forEach(r => { comp[r.sku]   = parseFloat(r.comprometido) || 0; });
    const faltantes = [];
    skus.forEach(sku => {
      const disponible = (fisico[sku] || 0) - (comp[sku] || 0);
      if (disponible < pedido[sku]) {
        faltantes.push({ sku, pedido: pedido[sku], fisico: fisico[sku] || 0,
                         comprometido: comp[sku] || 0, disponible,
                         faltante: pedido[sku] - disponible });
      }
    });
    return { faltantes };
  };

  // ─── ¿QUÉ facturas están reteniendo el stock? ──────────────────────────────
  // El aviso de "Stock insuficiente" decía cuántas unidades estaban comprometidas y no POR QUIÉN.
  // Con un número pelado, quien vende no puede hacer nada más que preguntar — así llegó el reporte
  // de la pintura UNITEC (2026-08-19), donde la unidad la retenía una factura de agosto cuya
  // mercancía YA había salido. Con el id a la vista se ve en el acto si es una entrega pendiente de
  // verdad o un fantasma. `ya_entregada` marca justamente eso: su linaje ya tiene despacho
  // entregado, o sea que retiene mercancía que no está. Ver migracion-odoo/90.
  //
  // No es crítica: si falla, el aviso pierde el detalle pero sigue diciendo que falta stock.
  window.facturasComprometiendo = async function (almacenId, skus, excluirDocumento) {
    if (!almacenId || !Array.isArray(skus) || !skus.length) return [];
    const e = window.currentEmpresa || 'demo1';
    const { data, error } = await window.sb.rpc('facturas_comprometiendo', {
      p_empresa_id: e, p_almacen_id: almacenId, p_skus: skus,
      p_excluir_documento: excluirDocumento || null,
    });
    if (error) { console.warn('[facturasComprometiendo]', error); return []; }
    return data || [];
  };

  // ─── ¿Qué órdenes tienen este producto en hold? ────────────────────────────
  // `inventario.reservado` era un número sin trazabilidad ("60 en hold y no se sabe de qué órdenes").
  // La RPC devuelve las órdenes vivas que lo retienen (ver migracion-odoo/20_ordenes_con_reserva.sql).
  // `sinOrden` es lo que el inventario dice tener reservado y ninguna orden respalda: reserva
  // fantasma de órdenes borradas o de despachos que no la liberaron. Se informa, no se esconde:
  // bloquea facturación de mercancía que en realidad está libre.
  window.ordenesConReserva = async function (sku, almacenId, reservadoActual) {
    if (!sku || !almacenId) return { data: [], total: 0, sinOrden: 0 };
    const e = window.currentEmpresa || 'demo1';
    // El `reservado` se lee DE LA BASE, no de `SSData.inventario`: la memoria se congela al entrar a
    // la pantalla y después de borrar una orden mostraba el hold viejo — el panel acusaba "reserva
    // fantasma" cuando en realidad ya se había liberado.
    const [{ data, error }, invRes] = await Promise.all([
      window.sb.rpc('ordenes_con_reserva', { p_empresa_id: e, p_sku: sku, p_almacen_id: almacenId }),
      window.sb.from('inventario').select('reservado').eq('sku', sku).eq('almacen_id', almacenId).maybeSingle(),
    ]);
    if (error) { console.error('[ordenesConReserva]', error); return { error }; }
    if (invRes && !invRes.error && invRes.data) {
      reservadoActual = parseFloat(invRes.data.reservado) || 0;
      // Y se corrige la memoria, así la tabla de stock de al lado deja de mostrar el número viejo.
      const slot = ((window.SSData.inventario || {})[sku] || {})[almacenId];
      if (slot) slot.reservado = reservadoActual;
    }
    const rows = (data || []).map(r => ({
      ...r,
      cantidad:   parseFloat(r.cantidad)   || 0,
      despachado: parseFloat(r.despachado) || 0,
      en_hold:    parseFloat(r.en_hold)    || 0,
    }));
    const total = rows.reduce((s, r) => s + r.en_hold, 0);
    const reservado = (reservadoActual != null) ? (parseFloat(reservadoActual) || 0) : total;
    return { data: rows, total, sinOrden: Math.max(0, Math.round((reservado - total) * 100) / 100) };
  };

  // ─── Hijos VIVOS de un documento (para no duplicar por doble clic) ─────────
  // Se pregunta al SERVER, no a la memoria: dos clics seguidos pueden ir más rápido que el
  // re-render, y el segundo tiene que encontrar lo que creó el primero. Busca por origen directo y
  // por linaje (las órdenes migradas de Odoo no guardan `documento_origen_id`).
  window.hijosVivosDe = async function (padreId, tipoHijo) {
    if (!padreId || !tipoHijo) return [];
    const e = window.currentEmpresa || 'demo1';
    const { data, error } = await window.sb.from('documentos')
      .select('id, tipo, estado, fecha, total, created_at')
      .eq('empresa_id', e).eq('tipo', tipoHijo).not('estado', 'in', '(cancelada,anulada)')
      .or(`documento_origen_id.eq.${padreId},raiz_id.eq.${padreId}`)
      .order('created_at', { nullsFirst: false });
    if (error) { console.error('[hijosVivosDe]', error); return { error }; }
    return (data || []).filter(d => d.id !== padreId);
  };

  // ─── Órdenes con el MISMO contenido (duplicado real, no de linaje) ─────────
  // `hijosVivosDe` solo ve hermanos: impide convertir DOS VECES la misma cotización. No sirve
  // cuando la misma venta se carga por caminos distintos — que es como aparecieron las 24 órdenes
  // repetidas de los primeros 4 días (16 unidades de stock en hold de más). Un caso real: dos
  // órdenes sueltas del compositor y una tercera convertida de una cotización, mismo cliente y
  // mismo producto, en 2 minutos; para el linaje son tres ventas sin relación.
  //
  // Se compara por CONTENIDO: mismo cliente + mismo conjunto de (sku, cantidad). El total se deja
  // afuera a propósito — dos cargas de la misma venta pueden diferir en un descuento y seguir
  // siendo la misma mercancía comprometida, que es lo que duele en el inventario.
  //
  // Ventana de 72 h, medida sobre los datos y no elegida a ojo: contando pares de órdenes con el
  // mismo cliente y la misma firma desde el 1-jul salen 45 dentro de 1 h, 45 a las 24 h, 46 a las
  // 72 h, 47 a la semana y 54 al mes. O sea: lo accidental ocurre en minutos, y estirar la ventana
  // solo agrega compras repetidas legítimas (un cliente que pide lo mismo cada tres semanas). 72 h
  // cubre además el "¿lo cargué ayer?" y el lunes después de un fin de semana.
  // Devuelve TODAS las coincidencias con su estado, para que quien decide vea si la anterior sigue viva.
  window.ordenesConMismoContenido = async function ({ clienteId, items, excluirId } = {}) {
    if (!clienteId || !Array.isArray(items) || !items.length) return [];
    // Firma = sku:cantidad ordenados. Insensible al orden de carga en el carrito.
    const firma = ls => (ls || [])
      .filter(l => l && l.sku && l.sku !== '__SECTION__' && (Number(l.qty ?? l.cantidad) || 0) > 0)
      .map(l => `${String(l.sku).trim().toUpperCase()}:${Number(l.qty ?? l.cantidad) || 0}`)
      .sort().join('|');
    const miFirma = firma(items);
    if (!miFirma) return [];

    const e = window.currentEmpresa || 'demo1';
    // `fecha` es el prefiltro barato (entra por el índice empresa+tipo+fecha) y se abre un día de
    // más porque es la fecha del documento y puede venir puesta a mano; `created_at` es el corte
    // real de las 72 h.
    const msVentana = 72 * 3600 * 1000;
    const desdeFecha = new Date(Date.now() - msVentana - 24 * 3600 * 1000).toISOString().slice(0, 10);
    const desdeTs = Date.now() - msVentana;
    const { data: cands, error } = await window.sb.from('documentos')
      .select('id, estado, estado_despacho, fecha, total, created_at, creado_por, almacen_id')
      .eq('empresa_id', e).eq('tipo', 'orden').eq('cliente_id', clienteId)
      .neq('estado', 'cancelada').gte('fecha', desdeFecha)
      .order('created_at', { ascending: false }).limit(40);
    if (error) { console.error('[ordenesConMismoContenido]', error); return { error }; }

    const enVentana = (cands || []).filter(d =>
      d.id !== excluirId && (!d.created_at || new Date(d.created_at).getTime() >= desdeTs));
    const ids = enVentana.map(d => d.id);
    if (!ids.length) return [];
    const { data: its, error: e2 } = await window.sb.from('documentos_items')
      .select('documento_id, sku, cantidad').in('documento_id', ids);
    if (e2) { console.error('[ordenesConMismoContenido] items', e2); return { error: e2 }; }

    const porDoc = new Map();
    for (const it of (its || [])) {
      if (!porDoc.has(it.documento_id)) porDoc.set(it.documento_id, []);
      porDoc.get(it.documento_id).push({ sku: it.sku, qty: it.cantidad });
    }
    return enVentana
      .filter(d => firma(porDoc.get(d.id)) === miFirma)
      .map(d => ({ ...d, _lineas: porDoc.get(d.id) || [] }));
  };

  // Facturas VIVAS que ya salieron de esta orden. Una orden facturada no se vuelve a
  // facturar: así aparecieron las 4 facturas de una misma orden (se reintentaba desde el
  // detalle mientras el despacho fallaba, y cada intento emitía una factura nueva).
  window.facturasDeOrden = async function (ordenId) {
    if (!ordenId) return [];
    const e = window.currentEmpresa || 'demo1';
    const { data, error } = await window.sb.from('documentos')
      .select('id, estado, estado_despacho, total, created_at')
      .eq('empresa_id', e).eq('tipo', 'factura')
      .eq('documento_origen_id', ordenId).not('estado', 'in', '(cancelada,anulada)')
      .order('created_at');
    if (error) { console.error('[facturasDeOrden]', error); return { error }; }
    return data || [];
  };

  // ─── Eliminar CxC asociada a una factura ─────────────────────────────────
  window.deleteCxCByFactura = async function (facturaId) {
    if (!facturaId) return { error: null };
    let ids = (window.SSData.cuentasCobrar || []).filter(c => c.factura === facturaId).map(c => c.id);
    if (!ids.length) {
      const { data } = await window.sb.from('cuentas_cobrar').select('id').eq('factura', facturaId);
      ids = (data || []).map(c => c.id);
    }
    if (!ids.length) return { error: null };
    const { error } = await window.sb.from('cuentas_cobrar').delete().in('id', ids);
    if (!error) window.SSData.cuentasCobrar = (window.SSData.cuentasCobrar || []).filter(c => !ids.includes(c.id));
    return { error };
  };

  // `window.anularFacturas` (hard-delete + papelera) se retiró el 2026-08-13: reemplazado por
  // `window.anularDocumento` (ver junto a `cancelarDocumento`), que anula SIN borrar la fila —
  // el documento queda visible en su pestaña "Anuladas" en vez de desaparecer del correlativo.

  // ─── Crear devolución automática al anular factura ────────────────────────
  // `origenDoc` es lo que se anuló (una factura, o un despacho cuando la devolución la dispara
  // `anularDocumento` porque el despacho ya había sido declarado entregado) — pero `factura_id`
  // SIEMPRE tiene que ser la factura de verdad, nunca el despacho, porque es lo que usan el resto
  // de las pantallas de Devoluciones para ubicar la venta. `opts.facturaId` la fija explícita
  // cuando `origenDoc` no es la factura; `opts.notaOrigen` reemplaza el texto por defecto de
  // `notas` para que quede claro si vino de anular la factura o de anular su despacho.
  window.crearDevolucionAutomatica = async function (origenDoc, items, opts = {}) {
    if (!window.SSData.devoluciones) window.SSData.devoluciones = [];
    const max = window.SSData.devoluciones
      .map(d => parseInt((d.id || '').replace('DEV-', ''), 10) || 0)
      .reduce((a, b) => Math.max(a, b), 0);
    const devId = 'DEV-' + String(max + 1).padStart(4, '0');
    const subtotal = (items || []).reduce((s, i) => s + (i.subtotal || (i.precio || i.precio_unitario || 0) * (i.qty || i.cantidad || 0)), 0);
    const iva   = Math.round(subtotal * 0.16 * 100) / 100;
    const total = Math.round((subtotal + iva) * 100) / 100;
    const facturaId = opts.facturaId || origenDoc.id;
    const dev = {
      id: devId,
      factura_id: facturaId,
      cliente_id: origenDoc.cliente_id || origenDoc.cliente || null,
      fecha: new Date().toISOString(),
      motivo: 'Error de facturación',
      items: (items || []).map(i => ({ sku: i.sku, nombre: i.nombre, qty: i.qty || i.cantidad || 0, precio: i.precio || i.precio_unitario || 0, subtotal: i.subtotal || 0, entregado: i.qty || i.cantidad || 0 })),
      subtotal: Math.round(subtotal * 100) / 100,
      iva,
      total,
      almacen_id: origenDoc.almacen_id || null,
      // Nace 'procesada', NO 'pendiente': el inventario ya se restituyó como PARTE de la anulación
      // (cancelarDocumento/cancelar_despacho, antes de llegar acá), no de un "Aprobar" manual en
      // este módulo. Si naciera 'pendiente' y alguien la aprobara desde acá, `aprobarDevolucion`
      // volvería a sumarle el inventario — doble restitución. `aprobado_por`/`fecha_aprobacion` se
      // llenan para que el timeline de la ficha (que los lee) no quede vacío.
      estado: 'procesada',
      nota_credito_id: null,
      reembolso: { metodo: 'credito_cuenta', banco: '', referencia: '', estado: 'procesado' },
      notas: opts.notaOrigen || `Devolución automática — anulación de ${facturaId}`,
      creado_por: window.__ssCurrentUser?.nombre || 'Sistema',
      aprobado_por: window.__ssCurrentUser?.nombre || 'Sistema',
      fecha_aprobacion: new Date().toISOString(),
    };
    await window.saveDev(dev);
    return dev;
  };

  // ─── Dropshipping ─────────────────────────────────────────────────────────
  window.loadDropshippingData = async function () {
    const e = window.currentEmpresa || 'demo1';
    const [{ data: proveedores }, { data: productos }, { data: precios }] = await Promise.all([
      window.sb.from('ds_proveedores').select('*').eq('empresa_id', e).order('nombre'),
      window.sb.from('ds_productos').select('*').eq('empresa_id', e).order('nombre'),
      window.sb.from('ds_precios').select('*').eq('empresa_id', e),
    ]);
    return { proveedores: proveedores || [], productos: productos || [], precios: precios || [] };
  };

  window.saveDsProv = async function (prov) {
    const e = window.currentEmpresa || 'demo1';
    const id = prov.id || ('dsp-' + Date.now());
    const { error } = await window.sb.from('ds_proveedores').upsert([{
      id, empresa_id: e,
      nombre:       prov.nombre,
      pais:         prov.pais         || null,
      bandera:      prov.bandera      || '🌐',
      contacto:     prov.contacto     || null,
      email:        prov.email        || null,
      whatsapp:     prov.whatsapp     || null,
      color:        prov.color        || '#6366f1',
      activo:       prov.activo !== false,
      dias_entrega: prov.dias_entrega || null,
      notas:        prov.notas        || null,
    }]);
    return { id, error };
  };

  window.deleteDsProv = async function (id) {
    const { error } = await window.sb.from('ds_proveedores').delete().eq('id', id);
    return { error };
  };

  window.saveDsProducto = async function (prod) {
    const e = window.currentEmpresa || 'demo1';
    const { error } = await window.sb.from('ds_productos').upsert([{
      sku:            prod.sku,
      empresa_id:     e,
      nombre:         prod.nombre,
      categoria:      prod.categoria      || null,
      marca:          prod.marca          || null,
      shopify_id:     prod.shopify_id     || null,
      shopify_status: prod.shopify_status || 'no_publicado',
      shopify_precio: prod.shopify_precio ? parseFloat(prod.shopify_precio) : null,
      ultima_sync:    prod.ultima_sync    || null,
    }], { onConflict: 'sku,empresa_id' });
    return { error };
  };

  window.bulkSaveDsPrecios = async function (provId, preciosArr) {
    // preciosArr: [{ sku, precio, nombre, categoria, marca }]
    const e = window.currentEmpresa || 'demo1';
    // Remove all existing prices for this proveedor
    await window.sb.from('ds_precios').delete().eq('proveedor_id', provId).eq('empresa_id', e);
    if (!preciosArr.length) return { error: null };
    const rows = preciosArr.map(p => ({
      id:          provId + '-' + p.sku,
      empresa_id:  e,
      proveedor_id: provId,
      sku:         p.sku,
      precio:      parseFloat(p.precio),
    }));
    const { error } = await window.sb.from('ds_precios').insert(rows);
    return { error };
  };

  window.saveDsPrecio = async function (provId, sku, precio) {
    const e = window.currentEmpresa || 'demo1';
    const { error } = await window.sb.from('ds_precios').upsert([{
      id:           provId + '-' + sku,
      empresa_id:   e,
      proveedor_id: provId,
      sku,
      precio: parseFloat(precio),
      updated_at: new Date().toISOString(),
    }], { onConflict: 'proveedor_id,sku' });
    return { error };
  };

  window.saveDsShopifyBulk = async function (updates) {
    // updates: [{ sku, shopify_status, shopify_precio, ultima_sync }]
    const e = window.currentEmpresa || 'demo1';
    const rows = updates.map(u => ({
      sku:            u.sku,
      empresa_id:     e,
      nombre:         u.nombre || u.sku,
      shopify_status: u.shopify_status,
      shopify_precio: u.shopify_precio ? parseFloat(u.shopify_precio) : null,
      ultima_sync:    u.ultima_sync || window.localDateStr(),
    }));
    const { error } = await window.sb.from('ds_productos').upsert(rows, { onConflict: 'sku,empresa_id' });
    return { error };
  };

  // ─── Tasa vigente en cada uno de los últimos N días ────────────────────────────────────────
  // Para cobrar un pago que ENTRÓ un día anterior: si el cliente pagó el lunes y el negocio se
  // entera el jueves, aplicar la tasa del jueves descuadra la caja contra lo que de verdad salió
  // del banco del cliente.
  //
  // POR QUÉ EL ÚLTIMO VALOR DEL DÍA Y NO EL PRIMERO NI UN PROMEDIO: el cron corre 6 veces al día
  // (`fetch-bcv-rate`), así que hay varias filas por fecha. El BCV publica UNA tasa por día; las
  // filas repetidas son sondeos. Cuando de verdad cambió a mitad del día (pasó el 2026-08-04:
  // 752,09 → 755,16), el valor que el sistema tenía al cerrar es el último — es el que vio quien
  // cobró ese día. Un promedio sería un número que nunca existió. Cuando hubo más de un valor se
  // devuelve `vario: true` y la pantalla lo dice, en vez de elegir por el usuario en silencio.
  window.loadTasasDiasPrevios = async function (dias = 3) {
    const hoy = window.localDateStr();
    // Se pide una ventana más ancha que `dias` porque puede haber fechas sin corrida (el cron
    // falló, el servidor estuvo caído): se quieren los últimos N días CON tasa, no los últimos N
    // del calendario.
    const desde = new Date(Date.parse(hoy + 'T00:00:00Z') - (dias + 7) * 86400000)
      .toISOString().slice(0, 10);
    const { data, error } = await window.sb
      .from('tasa_cambio')
      .select('fecha, bcv, paralelo, vuelto, created_at')
      .gte('fecha', desde).lt('fecha', hoy)
      .order('created_at', { ascending: true });
    if (error) { console.error('[loadTasasDiasPrevios]', error); return { error }; }
    const porDia = new Map();
    for (const r of (data || [])) {
      const d = String(r.fecha).slice(0, 10);
      const bcv = parseFloat(r.bcv);
      if (!porDia.has(d)) porDia.set(d, { dia: d, valores: new Set() });
      const o = porDia.get(d);
      // Se recorre en orden ascendente, así que el ÚLTIMO asignado es el del cierre del día.
      if (isFinite(bcv)) { o.bcv = bcv; o.valores.add(bcv); }
      const par = parseFloat(r.paralelo); if (isFinite(par)) o.paralelo = par;
      const vue = parseFloat(r.vuelto);   if (isFinite(vue)) o.vuelto = vue;
    }
    const filas = [...porDia.values()]
      .filter(o => o.bcv != null)
      .map(o => ({ dia: o.dia, bcv: o.bcv, paralelo: o.paralelo ?? null, vuelto: o.vuelto ?? null,
                   vario: o.valores.size > 1 }))
      .sort((a, b) => b.dia.localeCompare(a.dia))
      .slice(0, dias);
    return { data: filas };
  };

  // ─── Cargar historial de tasas desde DB ────────────────────────────────────
  window.loadTasasHistorial = async function () {
    const { data, error } = await window.sb
      .from('tasa_cambio')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) { console.error('[Supabase] Error cargando historial tasas:', error); return []; }
    return (data || []).map(t => ({
      fecha:      t.created_at,
      fechaDate:  t.fecha,
      bcv:        parseFloat(t.bcv),
      paralelo:   parseFloat(t.paralelo),
      cobertura:  (t.cobertura == null ? null : parseFloat(t.cobertura)),
      vuelto:     parseFloat(t.vuelto ?? t.paralelo),
      source:     t.source || 'manual',
      creado_por: t.creado_por || null,
    }));
  };

  // ─── Historial de ventas de un producto (RPC get_ventas_producto_detalle) ──
  // Devuelve TODAS las líneas de factura de ese SKU (histórico completo, no acotado a
  // 90 días como SSData.documentos) — usado en el tab "Ventas" del detalle de producto.
  window.getVentasProducto = async function (sku) {
    const { data, error } = await window.sb.rpc('get_ventas_producto_detalle', {
      p_empresa_id: window.currentEmpresa || 'demo1',
      p_sku: sku,
    });
    if (error) { console.error('[Supabase] Error cargando ventas del producto:', error); return []; }
    return (data || []).map(r => ({
      documentoId:  r.documento_id,
      fecha:        r.fecha,
      clienteNombre: r.cliente_nombre,
      clienteId:    r.cliente_id,
      vendedor:     r.vendedor,
      cantidad:     parseFloat(r.cantidad) || 0,
      precioUnit:   parseFloat(r.precio_unitario) || 0,
      subtotal:     parseFloat(r.subtotal) || 0,
      estado:       r.estado,
    }));
  };

  // ─── Reporte consolidado de finanzas (RPC get_finanzas_reporte) ────────────
  // Un solo JSON con KPIs, serie mensual, top clientes/vendedores/productos,
  // categorías y aging CxC/CxP — histórico completo server-side, sin cap de 90d.
  window.getFinanzasReporte = async function (desde, hasta) {
    const { data, error } = await window.sb.rpc('get_finanzas_reporte', {
      p_empresa_id: window.currentEmpresa || 'demo1',
      p_desde: desde,
      p_hasta: hasta,
    });
    if (error) { console.error('[Supabase] Error cargando reporte de finanzas:', error); return null; }
    return data;
  };

  // Pivote de ventas agregado en el server (1 a 3 dimensiones). Lo usa Reportes de Finanzas para
  // abrir un mes: las órdenes que lo generaron y, dentro de cada una, sus productos con margen —
  // un viaje por mes desplegado, no uno por orden. `venta_margen` es la base sin cobertura BCV;
  // el % de ganancia se mide contra ESA (ver `migracion-odoo/32_pivot_tres_niveles.sql`).
  window.getVentasPivot = async function (desde, hasta, { tipo = 'factura', dim1, dim2 = null, dim3 = null } = {}) {
    const { data, error } = await window.sb.rpc('get_ventas_pivot', {
      p_empresa_id: window.currentEmpresa || 'demo1',
      p_desde: desde, p_hasta: hasta, p_tipo: tipo,
      p_dim1: dim1, p_dim2: dim2, p_dim3: dim3,
    });
    if (error) { console.error('[Supabase] Error en get_ventas_pivot:', error); return null; }
    return Array.isArray(data) ? data : null;
  };

  // ─── Marcas (administración desde Inventario) ──────────────────────────────
  window.loadMarcas = async function (empresaId) {
    const e = empresaId || window.currentEmpresa || 'demo1';
    const { data, error } = await window.sb.from('marcas')
      .select('id,nombre,activo,empresa_id').eq('empresa_id', e).eq('activo', true).order('nombre');
    if (error) return { error, data: [] };
    return { data: data || [] };
  };
  window.createMarca = async function (nombre) {
    const e = window.currentEmpresa || 'demo1';
    const n = (nombre || '').trim();
    if (!n) return { error: 'Nombre vacío' };
    const { data, error } = await window.sb.from('marcas')
      .insert({ empresa_id: e, nombre: n, activo: true }).select().single();
    if (error) return { error };
    window.logActivity?.({ modulo:'productos', accion:'crear', entidad_label:'Marca: '+n });
    return { data };
  };
  window.renameMarca = async function (id, oldNombre, nuevoNombre) {
    const e = window.currentEmpresa || 'demo1';
    const n = (nuevoNombre || '').trim();
    if (!n) return { error: 'Nombre vacío' };
    const { error } = await window.sb.from('marcas').update({ nombre: n }).eq('id', id);
    if (error) return { error };
    // Propagar cambio a productos que usan la marca anterior
    if (oldNombre && oldNombre !== n) {
      await window.sb.from('productos').update({ marca: n }).overlaps('empresas', [e]).eq('marca', oldNombre);
    }
    window.logActivity?.({ modulo:'productos', accion:'editar', entidad_label:'Marca: '+oldNombre+' → '+n });
    return { ok: true };
  };
  window.deleteMarca = async function (id, nombre) {
    const e = window.currentEmpresa || 'demo1';
    // Validar uso — con head:true PostgREST devuelve data:null y el conteo viene en `count`.
    // Antes se leía `uso.length` (siempre null) → la guarda nunca disparaba y borraba marcas en uso.
    const { count } = await window.sb.from('productos')
      .select('sku', { count: 'exact', head: true }).overlaps('empresas', [e]).eq('marca', nombre);
    if (count && count > 0) return { error: 'En uso por '+count+' productos' };
    const { error } = await window.sb.from('marcas').delete().eq('id', id);
    if (error) return { error };
    window.logActivity?.({ modulo:'productos', accion:'eliminar', entidad_label:'Marca: '+nombre });
    return { ok: true };
  };

  // ─── Shopify integration ───────────────────────────────────────────────────
  // Demo: sin app real registrada en Shopify. El botón "Conectar" de Ajustes → Integraciones no
  // navega a este client_id — src/demo/mock-sb.js simula la conexión completa sin salir del sitio.
  window.SHOPIFY_CLIENT_ID = 'demo-shopify-app';
  window.SHOPIFY_SCOPES = 'read_products,write_products,read_inventory,write_inventory,read_locations,read_orders,read_all_orders,read_customers,write_customers';

  // URL que el usuario abre para autorizar la app en su tienda Shopify.
  window.shopifyInstallUrl = function (shop, empresaId) {
    const s = (shop || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const redirect = `${SUPABASE_URL}/functions/v1/shopify-oauth-callback`;
    const empresa = empresaId || window.currentEmpresa || 'demo1';
    return `https://${s}/admin/oauth/authorize?client_id=${window.SHOPIFY_CLIENT_ID}` +
      `&scope=${encodeURIComponent(window.SHOPIFY_SCOPES)}` +
      `&redirect_uri=${encodeURIComponent(redirect)}` +
      `&state=${encodeURIComponent(empresa)}`;
  };

  // Lee la config Shopify guardada para la empresa activa.
  window.loadShopifyConfig = async function (empresaId) {
    const e = empresaId || window.currentEmpresa || 'demo1';
    const { data, error } = await window.sb
      .from('configuracion_sistema')
      .select('shopify_enabled,shopify_store,shopify_api_version,shopify_connected_at,shopify_shop_info')
      .eq('empresa_id', e).maybeSingle();
    if (error) return { error };
    if (data?.shopify_store) window.shopifyDefaultStore = data.shopify_store;
    return { data: data || {} };
  };

  // Llama a la Admin API de Shopify vía el proxy Edge Function.
  // path debe empezar con "/" (ej: "/shop.json", "/products.json?limit=10")
  window.shopifyFetch = async function (path, { method = 'GET', body, empresaId } = {}) {
    const e = empresaId || window.currentEmpresa || 'demo1';
    const res = await fetch(`${SUPABASE_URL}/functions/v1/shopify-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
      body: JSON.stringify({ empresa_id: e, path, method, body }),
    });
    return res.json(); // { status, ok, data }
  };

  // ─── Shopify sync de productos ─────────────────────────────────────────────
  // Carga TODOS los productos con su estado Shopify (paginando, no se queda en 1000).
  window.loadProductosShopify = async function (empresaId) {
    const e = empresaId || window.currentEmpresa || 'demo1';
    const cols = 'sku,nombre,descripcion,base,costo,marca,categoria,activo,etiquetas,imagenes,shopify_product_id,shopify_variant_id,shopify_inventory_item_id,shopify_handle,shopify_status,shopify_last_sync,shopify_images';
    const PAGE = 1000;
    const all = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await window.sb
        .from('productos').select(cols)
        .overlaps('empresas', [e]).eq('activo', true)
        .order('nombre').range(from, from + PAGE - 1);
      if (error) return { error, data: all };
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
    }
    return { data: all };
  };

  // ─── Shopify: colecciones (custom + smart) ────────────────────────────────
  // Devuelve [{ id, title, type:'custom'|'smart', handle, products_count }]
  window.loadShopifyCollections = async function (empresaId) {
    try {
      const [custom, smart] = await Promise.all([
        window.shopifyFetch('/custom_collections.json?limit=250&fields=id,title,handle,products_count', { empresaId }),
        window.shopifyFetch('/smart_collections.json?limit=250&fields=id,title,handle,products_count',  { empresaId }),
      ]);
      const c = (custom?.data?.custom_collections || []).map(x => ({ ...x, type:'custom' }));
      const s = (smart?.data?.smart_collections   || []).map(x => ({ ...x, type:'smart'  }));
      return [...c, ...s].sort((a,b) => (a.title||'').localeCompare(b.title||'', 'es'));
    } catch (err) {
      console.error('[Shopify] Error cargando colecciones:', err);
      return [];
    }
  };

  // ─── Shopify: IDs de productos de una colección (paginado por since_id) ──
  window.loadShopifyCollectionProducts = async function (collectionId, empresaId) {
    if (!collectionId) return [];
    const ids = [];
    let sinceId = 0;
    try {
      for (let i = 0; i < 50; i++) { // hard cap 50 páginas (12500 productos)
        const r = await window.shopifyFetch(
          `/products.json?collection_id=${collectionId}&limit=250&fields=id&since_id=${sinceId}`,
          { empresaId }
        );
        const arr = r?.data?.products || [];
        if (!arr.length) break;
        arr.forEach(p => ids.push(String(p.id)));
        sinceId = arr[arr.length - 1].id;
        if (arr.length < 250) break;
      }
    } catch (err) { console.error('[Shopify] Error cargando productos de colección:', err); }
    return ids;
  };

  // Stock total local sumando todos los almacenes para un SKU
  window.loadStockLocal = async function (sku) {
    const { data, error } = await window.sb
      .from('inventario').select('cantidad').eq('sku', sku);
    if (error) return 0;
    return (data || []).reduce((s, r) => s + (r.cantidad || 0), 0);
  };

  // Sumar stock de varios SKUs (chunked, evita URL gigante y límite 1000 filas)
  window.loadStockMap = async function (skus) {
    if (!skus || !skus.length) return {};
    const map = {};
    const CHUNK = 200;
    for (let i = 0; i < skus.length; i += CHUNK) {
      const slice = skus.slice(i, i + CHUNK);
      // .range() para asegurar que aunque haya >1000 filas de inventario por estos SKUs, las traigamos todas.
      let from = 0;
      const PAGE = 1000;
      for (;;) {
        const { data } = await window.sb
          .from('inventario').select('sku,cantidad').in('sku', slice)
          .range(from, from + PAGE - 1);
        (data || []).forEach(r => { map[r.sku] = (map[r.sku] || 0) + (r.cantidad || 0); });
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
    }
    return map;
  };

  // Guardar/actualizar el vínculo Shopify de un producto
  window.linkProductoShopify = async function (sku, fields) {
    const e = window.currentEmpresa || 'demo1';
    const { error } = await window.sb.from('productos')
      .update({ ...fields, shopify_last_sync: new Date().toISOString() })
      .eq('sku', sku).overlaps('empresas', [e]);
    return { error };
  };

  // Cache de location_id de Shopify (la primera location activa)
  window.shopifyDefaultLocationId = null;
  window.shopifyGetDefaultLocation = async function () {
    if (window.shopifyDefaultLocationId) return window.shopifyDefaultLocationId;
    const r = await window.shopifyFetch('/locations.json');
    if (!r.ok || !r.data?.locations?.length) return null;
    const loc = r.data.locations.find(l => l.active) || r.data.locations[0];
    window.shopifyDefaultLocationId = loc.id;
    return loc.id;
  };

  // Buscar producto en Shopify por SKU (devuelve {product, variant} o null)
  window.shopifyFindBySku = async function (sku) {
    // Shopify no tiene endpoint directo por SKU en REST.
    // Usamos GraphQL con el filtro de variants.
    const query = `query($q: String!) {
      productVariants(first: 5, query: $q) {
        edges { node {
          id sku inventoryItem { id }
          product { id title handle status images(first:10){edges{node{id url altText}}} }
        }}
      }
    }`;
    const r = await window.shopifyFetch('/graphql.json', {
      method: 'POST', body: { query, variables: { q: `sku:${sku}` } }
    });
    if (!r.ok) return { error: r.data };
    const edges = r.data?.data?.productVariants?.edges || [];
    if (!edges.length) return { found: false };
    const v = edges[0].node;
    const numId = (gid) => gid && gid.split('/').pop();
    return {
      found: true,
      shopify_product_id:        numId(v.product.id),
      shopify_variant_id:        numId(v.id),
      shopify_inventory_item_id: numId(v.inventoryItem.id),
      shopify_handle:            v.product.handle,
      shopify_status:            v.product.status === 'ACTIVE' ? 'publicado' : 'borrador',
      shopify_images: (v.product.images?.edges || []).map(e => ({ id: numId(e.node.id), src: e.node.url, alt: e.node.altText })),
    };
  };

  // Crear producto en Shopify (REST) y vincular
  window.shopifyCreateProduct = async function (p) {
    const body = {
      product: {
        title: p.nombre,
        body_html: p.descripcion || '',
        vendor: p.marca || '',
        product_type: p.categoria || '',
        tags: (p.etiquetas || []).join(', '),
        status: 'active',
        variants: [{
          sku: p.sku,
          price: String(p.base || 0),
          inventory_management: 'shopify',
        }],
      },
    };
    const r = await window.shopifyFetch('/products.json', { method: 'POST', body });
    if (!r.ok) return { error: r.data };
    const prod = r.data.product;
    const variant = prod.variants[0];
    const link = {
      shopify_product_id:        String(prod.id),
      shopify_variant_id:        String(variant.id),
      shopify_inventory_item_id: String(variant.inventory_item_id),
      shopify_handle:            prod.handle,
      shopify_status:            'publicado',
    };
    await window.linkProductoShopify(p.sku, link);
    return { ok: true, shopify: link, raw: prod };
  };

  // Actualizar campos de un producto ya vinculado
  window.shopifyPushProduct = async function (p, { campos = ['precio','titulo','descripcion','stock'] } = {}) {
    if (!p.shopify_product_id) return { error: 'no_vinculado' };
    const errors = [];
    // Title + descripcion + tags + product
    if (campos.includes('titulo') || campos.includes('descripcion')) {
      const productPayload = { product: { id: Number(p.shopify_product_id) } };
      if (campos.includes('titulo'))      productPayload.product.title = p.nombre;
      if (campos.includes('descripcion')) productPayload.product.body_html = p.descripcion || '';
      const r = await window.shopifyFetch(`/products/${p.shopify_product_id}.json`,
        { method: 'PUT', body: productPayload });
      if (!r.ok) errors.push({ campo: 'producto', detail: r.data });
    }
    // Precio (variante)
    if (campos.includes('precio') && p.shopify_variant_id) {
      const r = await window.shopifyFetch(`/variants/${p.shopify_variant_id}.json`, {
        method: 'PUT',
        body: { variant: { id: Number(p.shopify_variant_id), price: String(p.base || 0) } }
      });
      if (!r.ok) errors.push({ campo: 'precio', detail: r.data });
    }
    // Stock
    if (campos.includes('stock') && p.shopify_inventory_item_id) {
      const locationId = await window.shopifyGetDefaultLocation();
      const stock = await window.loadStockLocal(p.sku);
      if (locationId) {
        const r = await window.shopifyFetch('/inventory_levels/set.json', {
          method: 'POST',
          body: {
            location_id: Number(locationId),
            inventory_item_id: Number(p.shopify_inventory_item_id),
            available: stock,
          }
        });
        if (!r.ok) errors.push({ campo: 'stock', detail: r.data });
      }
    }
    await window.linkProductoShopify(p.sku, {});
    return errors.length ? { error: errors } : { ok: true };
  };

  // Importar imagenes de Shopify al sistema (guarda URLs en productos.imagenes)
  window.shopifyImportImages = async function (p) {
    if (!p.shopify_product_id) return { error: 'no_vinculado' };
    const r = await window.shopifyFetch(`/products/${p.shopify_product_id}/images.json`);
    if (!r.ok) return { error: r.data };
    const imgs = (r.data.images || []).map(img => ({
      id:  String(img.id), src: img.src, alt: img.alt || null, position: img.position
    }));
    const e = window.currentEmpresa || 'demo1';
    const { error } = await window.sb.from('productos')
      .update({ imagenes: imgs, shopify_images: imgs, shopify_last_sync: new Date().toISOString() })
      .eq('sku', p.sku).overlaps('empresas', [e]);
    if (error) return { error };
    return { ok: true, count: imgs.length };
  };

  // Borra el token y desconecta.
  window.shopifyDisconnect = async function (empresaId) {
    const e = empresaId || window.currentEmpresa || 'demo1';
    const { error } = await window.sb.from('configuracion_sistema')
      .update({ shopify_enabled: false, shopify_token: null, shopify_connected_at: null, shopify_shop_info: null })
      .eq('empresa_id', e);
    return { error };
  };

  // ─── Reportes guardados ────────────────────────────────────────────────────
  window.loadReportesGuardados = async function (empresaId) {
    const e = empresaId || window.currentEmpresa || 'demo1';
    const { data, error } = await window.sb.from('reportes_guardados')
      .select('*').eq('empresa_id', e).order('created_at', { ascending: false });
    if (error) { console.error('[Supabase] Error cargando reportes:', error); return []; }
    return data || [];
  };

  window.saveReporteGuardado = async function (nombre, descripcion, config, empresaId) {
    const e = empresaId || window.currentEmpresa || 'demo1';
    const usuario = window.__ssCurrentUser?.nombre || window.__ssCurrentUser?.email || window.currentUserRole || null;
    const { data, error } = await window.sb.from('reportes_guardados')
      .insert({ empresa_id: e, nombre, descripcion: descripcion || null, config, creado_por: usuario })
      .select().single();
    if (error) { console.error('[Supabase] Error guardando reporte:', error); }
    return { data, error };
  };

  window.updateReporteGuardado = async function (id, nombre, descripcion, config) {
    const { data, error } = await window.sb.from('reportes_guardados')
      .update({ nombre, descripcion: descripcion || null, config, updated_at: new Date().toISOString() })
      .eq('id', id).select().single();
    if (error) { console.error('[Supabase] Error actualizando reporte:', error); }
    return { data, error };
  };

  window.deleteReporteGuardado = async function (id) {
    const { error } = await window.sb.from('reportes_guardados').delete().eq('id', id);
    if (error) { console.error('[Supabase] Error eliminando reporte:', error); }
    return { error };
  };

  // ─── Vistas de columnas guardadas, POR USUARIO ────────────────────────────
  // `window.TablaColumnas` (core.jsx) ya recuerda ocultas/anchos en localStorage
  // (`ss-{modulo}-cols`), pero eso es por NAVEGADOR: otro equipo, u otro usuario en el mismo
  // navegador, no lo hereda. Pedido explícito (2026-08-14): poder guardar esa selección con un
  // nombre y que quede atada al usuario. Ver migracion-odoo/71_vistas_columnas.sql.
  window.loadVistasColumnas = async function (modulo) {
    const uid = window.__ssCurrentUser?.id;
    if (!uid) return [];
    const { data, error } = await window.sb.from('vistas_columnas')
      .select('id, nombre, config, created_at')
      .eq('usuario_id', uid).eq('modulo', modulo)
      .order('nombre');
    if (error) { console.error('[loadVistasColumnas]', error); return []; }
    return data || [];
  };
  // `on conflict` sobre (usuario_id, modulo, nombre): guardar con un nombre ya usado reemplaza esa
  // vista en vez de duplicarla — es lo que espera alguien que hace clic en "Guardar" de nuevo.
  window.guardarVistaColumnas = async function (modulo, nombre, config) {
    const uid = window.__ssCurrentUser?.id;
    if (!uid) return { error: { message: 'Sin sesión' } };
    const row = { empresa_id: window.currentEmpresa || 'demo1', usuario_id: uid, modulo, nombre, config };
    const { data, error } = await window.sb.from('vistas_columnas')
      .upsert(row, { onConflict: 'usuario_id,modulo,nombre' })
      .select('id, nombre, config').single();
    if (error) { console.error('[guardarVistaColumnas]', error); return { error }; }
    window.logActivity?.({ modulo: 'config_usuarios', accion: 'crear', entidad_label: nombre, detalles: { tipo: 'vista_columnas', modulo_tabla: modulo } });
    return { data };
  };
  window.eliminarVistaColumnas = async function (id) {
    const { error } = await window.sb.from('vistas_columnas').delete().eq('id', id);
    if (error) { console.error('[eliminarVistaColumnas]', error); return { error }; }
    return { ok: true };
  };

  // ─── Editar el SKU de un producto (permiso especial `producto_sku`) ───────
  // El SKU es la PK global del catálogo: solo es seguro renombrarlo si el producto nunca se
  // vendió ni tuvo movimiento de inventario. La validación real vive en el servidor
  // (`renombrar_sku_producto`, security definer — ver migracion-odoo/72); esto solo llama a las
  // RPC y refleja el resultado en `SSData.productos` para no forzar un recargo completo.
  window.puedeRenombrarSku = async function (sku) {
    const { data, error } = await window.sb.rpc('puede_renombrar_sku', { p_sku: sku });
    if (error) { console.error('[puedeRenombrarSku]', error); return { error }; }
    return data || { ventas: 0, movimientos: 0 };
  };
  window.renombrarSkuProducto = async function (skuActual, skuNuevo) {
    const { data, error } = await window.sb.rpc('renombrar_sku_producto', { p_sku_actual: skuActual, p_sku_nuevo: skuNuevo });
    if (error) { console.error('[renombrarSkuProducto]', error); return { error }; }
    const nuevo = (data?.sku_nuevo || skuNuevo).toUpperCase();
    // Refleja el cambio en memoria: el producto sigue siendo el mismo objeto de SSData.productos,
    // solo cambió su clave — así los componentes montados (ficha abierta) ven el sku nuevo sin
    // recargar todo el catálogo.
    const prod = (window.SSData.productos || []).find(p => p.sku === skuActual);
    if (prod) prod.sku = nuevo;
    window.logActivity?.({ modulo: 'inventory', accion: 'editar', entidad_id: nuevo, entidad_label: prod?.nombre || nuevo,
      detalles: { tipo: 'renombrar_sku', sku_anterior: skuActual, sku_nuevo: nuevo } });
    return { ok: true, sku_nuevo: nuevo };
  };

  // ─── Aviso de carga en las consultas que hacen esperar ────────────────────
  // Se decoran las funciones ya definidas en vez de meter start/end adentro de cada
  // una: el indicador es transversal, no lógica de la consulta, y así no hay forma de
  // olvidarse un `end()` en un camino de error (ssBusy.wrap lo apaga en el finally).
  //
  // Solo las que de verdad tardan. Poner el aviso en cada llamada suelta lo volvería
  // ruido permanente y dejaría de significar algo. `window.ssBusy` se resuelve en cada
  // llamada porque core.js se evalúa después de este archivo.
  [
    ['loadAppData',            'Actualizando datos…'],
    ['loadDocumentos',         'Cargando documentos…'],
    ['loadMovsPendientes',     'Cargando movimientos…'],
    ['loadTransferencias',     'Cargando transferencias…'],
    // Cada página de "Cobrados" es un viaje al server: el aviso tiene que salir también al pedir
    // la siguiente, no solo al abrir la pestaña.
    ['loadCuentasCobradas',    'Cargando cobradas…'],
    ['loadCuentasCobradasAll', 'Cargando todas las cobradas…'],
    // Las que dejaron de venir en el arranque y ahora las pide la pantalla al entrar: sin aviso
    // parecería que el módulo abrió vacío.
    ['ensureDocumentos',       'Cargando documentos…'],
    ['ensureOrdenesCompra',    'Cargando órdenes de compra…'],
    ['ensureMovsBancarios',   'Cargando movimientos bancarios…'],
    ['ensurePagos',            'Cargando pagos…'],
  ].forEach(([fn, label]) => {
    const orig = window[fn];
    if (typeof orig !== 'function') return;
    window[fn] = function (...args) {
      if (!window.ssBusy) return orig.apply(this, args);
      return window.ssBusy.wrap(label, () => orig.apply(this, args));
    };
  });

})();
