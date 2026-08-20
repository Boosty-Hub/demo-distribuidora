// app-bootstrap.jsx — extraido del bloque inline de index.html
// Contiene la App raiz, routing multi-empresa y el mount de React.
const { useState, useEffect } = React;

// Sin esto, un error de render en CUALQUIER módulo (sidebar y topbar incluidos, si no se acota)
// tumbaba TODO el árbol de React a una página en blanco — reportado el 2026-08-14 ("al revisar
// un serial me arroja otra página en blanco"). Se acota SOLO al contenido de la ruta actual
// (`renderPage()`): el sidebar y el topbar siguen de pie, así que "Volver al sistema" / navegar
// a otro módulo sigue siendo posible sin recargar. `getDerivedStateFromError` es obligatorio para
// que un error boundary de clase funcione; no hay equivalente en componentes de función todavía.
class ModuleErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[ModuleErrorBoundary]', error, info); }
  componentDidUpdate(prevProps) {
    // Si la ruta cambió (navegó a otro módulo), reintentar: el error queda atrás con la ruta vieja.
    if (this.state.error && prevProps.routeKey !== this.props.routeKey) this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
            Esta pantalla tuvo un error y no se pudo mostrar.
          </div>
          <div style={{ fontSize: 13, marginBottom: 4 }}>{String(this.state.error?.message || this.state.error)}</div>
          <div style={{ fontSize: 12.5 }}>Prueba navegar a otro módulo, o recarga la página. Si se repite, avisa a soporte.</div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Para los overlays flotantes (Ctrl+K, aviso de versión nueva, tour guiado) que viven FUERA de
// `ModuleErrorBoundary` — están al nivel de <App>, no de la ruta actual, así que un error ahí
// tumbaba TODO el árbol igual que antes de tener boundaries (pasó el 2026-08-14: un bug de orden
// de hooks en CmdPalette dejaba el sistema entero en blanco apenas alguien abría Ctrl+K). Acá no
// tiene sentido mostrar un cartel de error en el medio de la pantalla por un popup que se supone
// que es descartable: mejor que ese overlay puntual desaparezca (`null`) a que se lleve puesta
// toda la sesión de quien estaba trabajando en otra cosa.
class SilentErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[SilentErrorBoundary]', error, info); }
  render() { return this.state.error ? null : this.props.children; }
}

// ── Rutas: path → módulo ───────────────────────────────────────────────────
const PATH_TO_MODULE = {
  '':           'pos',
  'pos':        'pos',
  'cotizaciones': 'cotizaciones',
  'ordenes':      'ordenes',
  'facturas':     'facturas',
  'despachos':    'despachos',
  'inventario': 'inventory',
  'precios':    'prices',
  'cargas':        'bulk',
  'dropshipping':  'dropshipping',
  'sync':       'sync',
  'clientes':   'clients',
  'contactos':  'contacts',
  'proveedores':'suppliers',
  'vendedores': 'vendedores',
  'cxc':        'cxc',
  'cxp':        'cxp',
  'banco':      'bank',
  'anticipos':  'anticipos',
  'inversiones': 'inversiones',
  'retenciones': 'retenciones',
  'chat':        'chat',
  'asistente':   'asistente',
  'drivers':      'drivers',
  'incidencias':  'incidencias',
  'portal':       'portal',
  'devoluciones': 'devoluciones',
  'garantias':    'garantias',
  'fabricacion':  'fabricacion',
  'portal-cliente': 'portal-cliente',
  'config':      'config',
  // Ruta NO-config a propósito: /config/papelera dispararía isConfigRoute y reemplazaría TODO el
  // sidebar por el de Configuración (ver ConfigSidebar en shell.jsx). Papelera vive ahora como grupo
  // propio del sidebar principal, arriba del footer de Configuración — necesita su propia ruta.
  'papelera':    'papelera',
  'reportes':    'reportes',
  'comisiones':  'comisiones',
  'finanzas-reportes': 'finanzas_reportes',
};

// Listas de documentos independientes de POS: /cotizaciones, /ordenes, /facturas, /despachos.
// /pos = compositor (donde nace la cotización/orden). Cada lista la renderiza POSPage por subRoute.
const MODULE_PATHS = {
  'pos':          '/pos',
  'cotizaciones': '/cotizaciones',
  'ordenes':      '/ordenes',
  'facturas':     '/facturas',
  'despachos':    '/despachos',
  'inventory':    '/inventario',
  'inventory-movimientos': '/inventario/movimientos',
  'inventory-transferencias': '/inventario/transferencias',
  'reportes':     '/reportes',
  'comisiones':   '/comisiones',
  'finanzas_reportes': '/finanzas-reportes',
  'prices':       '/precios',
  'bulk':          '/cargas',
  'dropshipping':  '/dropshipping',
  'sync':         '/sync',
  'clients':      '/clientes',
  'contacts':     '/contactos',
  'suppliers':    '/proveedores',
  'vendedores':   '/vendedores',
  'cxc':          '/cxc',
  'cxp':          '/cxp',
  'bank':         '/banco',
  'anticipos':    '/anticipos',
  'inversiones':  '/inversiones',
  'retenciones':  '/retenciones',
  'chat':         '/chat',
  'asistente':    '/asistente',
  'drivers':      '/drivers',
  'incidencias':  '/incidencias',
  'portal':       '/portal',
  'devoluciones': '/devoluciones',
  'garantias':    '/garantias',
  'fabricacion':  '/fabricacion',
  'portal-cliente': '/portal-cliente',
  'config-users':     '/config/usuarios',
  'config-roles':     '/config/roles',
  'config-system':    '/config/sistema',
  'config-campos':    '/config/campos',
  'config-almacenes': '/config/almacenes',
  'config-papelera':  '/config/papelera',
  'papelera':         '/papelera',
};

// ── Multi-empresa: URL con prefijo /{empresa}/{modulo} ─────────────────────
// Rutas que NO llevan prefijo de empresa (portales/visor público)
const BYPASS_EMPRESA = new Set(['portal-cliente', 'public']);

function getActiveEmpresaSlug() {
  return (window.currentEmpresa || localStorage.getItem('ss-empresa-activa') || 'demo1');
}

// Demo estatica (GitHub Pages): el sitio se sirve bajo /demo-distribuidora/, no en la raiz. El
// prefijo lo calcula index.html (window.ssBase/ssPath, a partir del hostname) — acá solo se usa,
// porque history.pushState/replaceState con un path absoluto IGNORA el <base> del documento.
const ssBase = (p) => (window.ssBase ? window.ssBase(p) : p);
const ssPath = (p) => (window.ssPath ? window.ssPath(p) : p);

function parseRoute(pathname) {
  const segs = (pathname || '/').replace(/^\//, '').split('/').filter(Boolean);
  const seg0 = segs[0] || '';
  if (BYPASS_EMPRESA.has(seg0)) {
    return { bypass: true, empresa: null, modulePath: '/' + segs.join('/'), needsRedirect: false };
  }
  if (!seg0) {
    return { bypass: false, empresa: getActiveEmpresaSlug(), modulePath: '/pos', needsRedirect: true };
  }
  if (Object.prototype.hasOwnProperty.call(PATH_TO_MODULE, seg0)) {
    return { bypass: false, empresa: getActiveEmpresaSlug(), modulePath: '/' + segs.join('/'), needsRedirect: true };
  }
  const modulePath = '/' + (segs.slice(1).join('/') || 'pos');
  return { bypass: false, empresa: seg0, modulePath, needsRedirect: false };
}

function parsePath() {
  const r = parseRoute(ssPath(window.location.pathname));
  return r.bypass ? r.modulePath : r.modulePath;
}

function navigate(pathOrId) {
  const path = pathOrId.startsWith('/')
    ? pathOrId
    : (MODULE_PATHS[pathOrId] || '/' + pathOrId);
  const seg0 = path.replace(/^\//, '').split('/')[0];
  const fullPath = BYPASS_EMPRESA.has(seg0)
    ? path
    : `/${getActiveEmpresaSlug()}${path}`;
  // Trackear ruta previa (sin prefijo empresa) para breadcrumbs "atrás" contextuales
  try {
    const r = parseRoute(ssPath(window.location.pathname));
    if (!r.bypass) sessionStorage.setItem('ss-prev-route', r.modulePath);
  } catch (e) {}
  history.pushState(null, '', ssBase(fullPath));
  window.dispatchEvent(new PopStateEvent('popstate'));
  // Dispara carga lazy de la nueva ruta, avisando mientras tanto. El indicador se
  // apaga tras DOS requestAnimationFrame, no al resolverse la promesa: cuando el
  // chunk termina de bajar el módulo todavía no se pintó (React tiene que montarlo),
  // y apagarlo ahí devuelve la pantalla vieja sin aviso durante ese hueco.
  const busy = window.ssBusy?.start('Cambiando de módulo…');
  const done = () => requestAnimationFrame(() => requestAnimationFrame(() => window.ssBusy?.end(busy)));
  if (window.__loadRouteChunks) window.__loadRouteChunks(fullPath).then(done, done);
  else done();
}

function App() {
  const [authState, setAuthState]     = useState('checking');
  const [currentUser, setCurrentUser] = useState(null);
  const [pathname, setPathname]       = useState(parsePath);
  // Clic en el sidebar sobre el módulo en el que YA se está: `setPathname` con el mismo valor no
  // dispara un re-render (React bail-out de estado igual), así que el módulo se quedaba tal cual
  // estaba —listas con el mismo filtro, mismo scroll— y parecía que el clic no hacía nada. `navTick`
  // fuerza el remount pasándolo en el `key` del componente de la ruta (ver `lazyEl`); el ref evita
  // que `onPopState` (registrado una sola vez, deps `[]`) lea un `pathname` viejo por closure.
  const [navTick, setNavTick]         = useState(0);
  const pathnameRef = React.useRef(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);
  const [collapsed, setCollapsed]     = useState(false);
  const [mobileOpen, setMobileOpen]   = useState(false);
  const [cmdOpen, setCmdOpen]         = useState(false);
  const [chatOpen, setChatOpen]       = useState(false);
  const [chatUnread, setChatUnread]   = useState(11);
  const [dataVersion, setDataVersion] = useState(0);
  const [chunkVersion, setChunkVersion] = useState(0);
  const [dataReady, setDataReady] = useState(!!window.__ssDataReady);

  // Un repintado por TANDA de datos, no uno por aviso: los datos llegan en varias tandas y cada
  // aviso re-renderizaba todo el árbol (ver `window.ssOnDatos` en core.jsx).
  useEffect(() => {
    return window.ssOnDatos(() => { setDataVersion(v => v + 1); setDataReady(!!window.__ssDataReady); });
  }, []);

  // Re-render cuando carga un chunk lazy
  useEffect(() => {
    const onChunk = () => setChunkVersion(v => v + 1);
    window.addEventListener('ss-chunk-loaded', onChunk);
    return () => window.removeEventListener('ss-chunk-loaded', onChunk);
  }, []);

  // ─── Catálogo de clientes/contactos: SOLO donde se listan ───────────────────────
  // Son 13.096 clientes + 13.150 contactos: lo más pesado del arranque. Antes se cargaban en
  // el boot; después pasaron a "toda ruta menos el POS", y eso seguía siendo demasiado — al
  // refrescar CUALQUIER módulo salía "Cargando contactos… / Cargando clientes…" para algo que
  // esa pantalla no usa.
  //
  // NINGUNA ruta lo carga ya. Clientes y Contactos eran las dos últimas que bajaban su tabla
  // completa para paginar en el navegador; ahora piden solo la página al server
  // (`loadClientes` / `loadContactos`), buscan contra la base y agregan los totales con la RPC
  // `clientes_resumen`. Lo que necesita NOMBRES se hidrata por id (`ensureClientes`, unos
  // cientos de filas al terminar Fase 2) y lo que necesita ELEGIR un cliente usa búsqueda
  // remota (`buscarClientesContactos`).
  //
  // `ensureClientesCatalogo` / `ensureContactosCatalogo` siguen existiendo para quien de verdad
  // necesite el universo (hoy: Ctrl+K, que lo pide al abrirse). Si aparece una pantalla nueva
  // que liste clientes, la respuesta correcta es paginarla, no volver a cargar 13.096 filas.

  // ─── Columnas pesadas de productos: SOLO donde se ven ───────────────────────────
  // El catálogo del arranque va sin `imagenes`/`shopify_*` (ver PRODUCTO_COLS en supabase.js): son
  // ~2,2 MB de JSON que el POS no usa. Las dos pantallas que sí las muestran las piden al entrar.
  useEffect(() => {
    if (!currentUser) return;
    const p = pathname || '';
    // `dataVersion` en las deps y no `dataReady`: el catálogo llega DESPUÉS del gate de Fase 1, así
    // que al entrar directo a /inventario todavía puede estar vacío. Cada `ss-appdata-loaded` lo
    // reintenta y la función es idempotente (no vuelve a pedir lo que ya mezcló).
    if (/^\/(inventario|cargas)/.test(p)) window.ensureProductosInventario?.();
    // /sync no está acá: ya carga su propio juego de columnas con `loadProductosShopify`.
    if (/^\/dropshipping/.test(p)) window.ensureProductosShopify?.();
  }, [pathname, currentUser, dataVersion]);

  // ─── Documentos en memoria: SOLO donde se agregan o se eligen ────────────────────
  // Eran 9,3 MB en el arranque de todos. El POS y las 4 listas del flujo NO los necesitan (piden su
  // página al server); estas pantallas sí, porque agregan sobre el conjunto o hacen elegir de una
  // lista. `items: true` suma el desglose por producto (2,7 MB) — solo quien lo desglosa.
  useEffect(() => {
    if (!currentUser) return;
    const p = pathname || '';
    if (/^\/(comisiones|reportes)/.test(p)) window.ensureDocumentos?.({ items: true });
    else if (/^\/(drivers|incidencias|devoluciones|vendedores)/.test(p)) window.ensureDocumentos?.();
    // Compras vive dentro de Proveedores; la ficha de producto NO carga el set (usa comprasDeProducto).
    if (/^\/proveedores/.test(p)) window.ensureOrdenesCompra?.();
    // Los 365 días de movimientos bancarios: solo Bancos. El badge del sidebar usa movsPendientes.
    if (/^\/banco/.test(p)) window.ensureMovsBancarios?.();
    // El ledger de pagos (2,8 MB): las pantallas que muestran abonos, banco y forma de pago.
    if (/^\/(cxc|cxp|clientes|banco|anticipos)/.test(p)) window.ensurePagos?.();
  }, [pathname, currentUser]);

  // El sistema real monta acá un widget de soporte de terceros (3rd-party, con su propia key y
  // dominio). Esta demo no tiene soporte al cliente ni credenciales de terceros: se quita entero
  // para que la demo no dispare ninguna llamada de red fuera de este mismo sitio estático.

  useEffect(() => {
    const r0 = parseRoute(ssPath(window.location.pathname));
    if (!r0.bypass) {
      if (r0.empresa && r0.empresa !== window.currentEmpresa) {
        window.currentEmpresa = r0.empresa;
        localStorage.setItem('ss-empresa-activa', r0.empresa);
      }
      const canonical = '/' + r0.empresa + r0.modulePath;
      if (r0.needsRedirect || ssPath(window.location.pathname) !== canonical) {
        history.replaceState(null, '', ssBase(canonical));
      }
      setPathname(r0.modulePath);
    } else {
      setPathname(r0.modulePath);
    }

    // Carga de los chunks de la ruta con indicador. Cubre el botón atrás/adelante del
    // navegador, que no pasa por navigate(). Si navigate() ya prendió el suyo se
    // solapan sin problema: ssBusy cuenta referencias, no es un booleano.
    function loadChunksConAviso() {
      if (!window.__loadRouteChunks) return;
      const busy = window.ssBusy?.start('Cambiando de módulo…');
      const done = () => requestAnimationFrame(() => requestAnimationFrame(() => window.ssBusy?.end(busy)));
      window.__loadRouteChunks(window.location.pathname).then(done, done);
    }

    function onPopState() {
      const r = parseRoute(ssPath(window.location.pathname));
      if (r.bypass) {
        if (r.modulePath === pathnameRef.current) setNavTick(t => t + 1);
        setPathname(r.modulePath);
        loadChunksConAviso();
        return;
      }
      if (r.empresa && r.empresa !== window.currentEmpresa) {
        window.currentEmpresa = r.empresa;
        localStorage.setItem('ss-empresa-activa', r.empresa);
        window.location.reload();
        return;
      }
      if (r.needsRedirect) {
        history.replaceState(null, '', ssBase('/' + r.empresa + r.modulePath));
      }
      // Volver a hacer clic en el módulo activo (mismo modulePath): `setPathname` no re-renderiza
      // solo, así que se pide el remount con `navTick`.
      if (r.modulePath === pathnameRef.current) setNavTick(t => t + 1);
      setPathname(r.modulePath);
      loadChunksConAviso();
    }
    window.addEventListener('popstate', onPopState);
    window.__ssNavigate = navigate;
    if (window.getEmpresaConfig) {
      const emp = window.getEmpresaConfig();
      if (emp.favicon) {
        let link = document.querySelector("link[rel~='icon']");
        if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
        link.href = emp.favicon;
      }
    }
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    window.signOutApp = () => {
      localStorage.removeItem('ss-pin-session');
      localStorage.removeItem('ss-client-session');
      window.clearFase1Cache?.();
      try { window.sb.auth.signOut(); } catch (e) {}
      setCurrentUser(null);
      setAuthState('login');
    };

    window.sb.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        // FIX bug #35: resolver al usuario y la empresa permitida ANTES de hidratar
        // el cache. Antes loadFase1Cache corría primero, usando el slug de la URL/
        // localStorage, y podía pintar datos de un tenant al que el usuario ya no
        // pertenece durante toda la ventana del refetch. Ahora: usuarioRow → corregir
        // empresa → recién entonces cargar cache de la empresa correcta.
        const { data: usuarioRow } = await window.sb.from('usuarios').select('id, nombre, rol, avatar, online, iniciales, email, auth_id, activo, cliente_id, empresas, tiene_pin, pin_digitos, pin_prompt_omitido_en').eq('auth_id', session.user.id).maybeSingle();
        if (!usuarioRow) {
          await window.sb.auth.signOut();
          window.clearFase1Cache?.();
          setAuthState('login');
          return;
        }
        // Las empresas del usuario viajan en el JWT (app_metadata.empresas), que se
        // acuña al iniciar sesión. Si un administrador le activa una empresa nueva, el
        // token sigue con las viejas hasta que expire (1 h): el selector ya mostraría la
        // empresa pero el RLS le negaría los datos — que es exactamente el síntoma de
        // "se le activó y no la ve". Se compara el claim con la fila y, si difieren, se
        // pide un token nuevo: el hook vuelve a correr y emite los claims al día.
        try {
          const claimEmp = session.user?.app_metadata?.empresas;
          const filaEmp  = Array.isArray(usuarioRow.empresas) ? usuarioRow.empresas : [];
          // Si no se puede leer el claim, no se refresca: mejor no hacer nada que
          // pedir token nuevo en cada carga.
          if (Array.isArray(claimEmp)) {
            const iguales = claimEmp.length === filaEmp.length
              && [...claimEmp].sort().join('|') === [...filaEmp].sort().join('|');
            if (!iguales) {
              const { data: ref } = await window.sb.auth.refreshSession();
              if (ref?.session) session = ref.session;
              console.info('[auth] empresas del token desactualizadas — sesión refrescada',
                           { token: claimEmp, base: filaEmp });
            }
          }
        } catch (e) { console.warn('[auth] no se pudo refrescar la sesión:', e?.message || e); }

        const user = { ...session.user, ...usuarioRow };
        window.currentUserRole = (user.rol === 'Admin' ? 'Administrador' : user.rol);
        window.__ssCurrentUser = user;
        const allowedEmp = Array.isArray(user?.empresas) ? user.empresas : null;
        let empresaCorrected = false;
        if (allowedEmp && allowedEmp.length && !allowedEmp.includes(getActiveEmpresaSlug())) {
          const newEmp = allowedEmp[0];
          window.currentEmpresa = newEmp;
          localStorage.setItem('ss-empresa-activa', newEmp);
          const r = parseRoute(ssPath(window.location.pathname));
          if (!r.bypass) history.replaceState(null, '', ssBase(`/${newEmp}${r.modulePath}`));
          empresaCorrected = true;
        }
        if (empresaCorrected) {
          // La empresa cambió: el snapshot cacheado pertenece al tenant equivocado.
          // Limpiar el cache (no protegido por RLS) y esperar el refetch de la empresa
          // correcta antes de renderizar la app, para no filtrar datos cross-tenant.
          await window.clearFase1Cache?.();
          setCurrentUser(user);
          setAuthState('app');
          await window.loadAppData();
        } else {
          // Empresa ya válida: hidratar desde cache (mismo tenant) y refetch en background.
          await window.loadFase1Cache?.();
          setCurrentUser(user);
          setAuthState('app');
          window.loadAppData();
        }
        return;
      }
      localStorage.removeItem('ss-pin-session');
      setAuthState('login');
    });

    const { data: { subscription } } = window.sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        localStorage.removeItem('ss-pin-session');
        window.clearFase1Cache?.();
        setCurrentUser(null);
        setAuthState('login');
      }
    });
    return () => { subscription.unsubscribe(); window.signOutApp = null; };
  }, []);

  useEffect(() => {
    function handler(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdOpen(o => !o); }
      if (e.key === 'Escape') setCmdOpen(false);
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Helper para renderizar un componente lazy con fallback si aun no cargo
  function lazyEl(name, props) {
    const Comp = window[name];
    if (typeof Comp !== 'function') {
      return (
        <div style={{ padding: 40, textAlign:'center', color:'#7f7e78' }}>
          <div style={{ marginBottom: 8 }}>Cargando módulo…</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>{name}</div>
        </div>
      );
    }
    // `key: navTick` NO cambia entre rutas distintas (por eso no fuerza remount al navegar
    // normalmente, p. ej. entre Cotizaciones y Facturas que comparten POSPage): solo cambia cuando
    // se vuelve a hacer clic en el módulo YA activo, que es el único caso donde hace falta forzarlo.
    return React.createElement(Comp, { key: navTick, ...(props || {}) });
  }

  if (pathname.startsWith('/portal-cliente')) return lazyEl('ClientPortalApp');

  if (pathname.startsWith('/public/')) {
    const slug = pathname.replace(/^\/public\//, '').replace(/\/$/, '');
    return lazyEl('PublicDocumentPage', { slug });
  }

  const segments  = pathname.replace(/^\//, '').split('/').filter(Boolean);
  const [seg0 = '', seg1 = ''] = segments;
  const moduleId  = PATH_TO_MODULE[seg0] || 'pos';

  let currentRoute;
  if (moduleId === 'config') {
    const configMap = { usuarios: 'config-users', roles: 'config-roles', sistema: 'config-system', campos: 'config-campos', almacenes: 'config-almacenes', papelera: 'config-papelera' };
    currentRoute = configMap[seg1] || 'config-users';
  } else if (moduleId === 'pos' && seg1 === 'flujo') {
    currentRoute = 'pos-flujo';
  } else if (moduleId === 'inventory' && seg1 === 'movimientos') {
    currentRoute = 'inventory-movimientos';
  } else if (moduleId === 'inventory' && seg1 === 'transferencias') {
    currentRoute = 'inventory-transferencias';
  } else {
    currentRoute = moduleId;
  }

  const posSubRoute    = seg0 === 'pos' ? seg1 : '';
  const bankSubRoute   = seg0 === 'banco' ? seg1 : '';   // /banco/{id} → detalle de la cuenta
  // /clientes/{id} → ficha del cliente. Es una URL de verdad (y no una variable global) porque
  // los enlaces al cliente repartidos por los módulos tienen que soportar Ctrl+clic y el botón
  // "atrás" del navegador. Mismo patrón que /banco/{id}.
  const clienteSubRoute = seg0 === 'clientes' ? decodeURIComponent(seg1 || '') : '';
  const isConfigRoute  = currentRoute.startsWith('config-');

  if (authState === 'checking') return (
    <div style={{ display:'grid', placeItems:'center', height:'100vh', background:'#0e0e1a' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ width:48, height:48, borderRadius:12, background:'linear-gradient(135deg, oklch(0.55 0.19 255), oklch(0.68 0.14 55))', display:'grid', placeItems:'center', color:'#fff', fontWeight:700, fontSize:20, margin:'0 auto 16px' }}>S</div>
        <div style={{ color:'#7f7e78', fontSize:13 }}>Iniciando Distribuidora Demo…</div>
      </div>
    </div>
  );

  if (authState === 'login') return (
    <LoginPage onLogin={(user) => {
      window.currentUserRole = (user?.rol === 'Admin' ? 'Administrador' : user?.rol) || null;
      window.__ssCurrentUser = user;
      setCurrentUser(user);
      setAuthState('app');
      const rol = user?.rol;
      if (rol !== 'Driver' && rol !== 'Cliente') {
        let emp = getActiveEmpresaSlug();
        const allowed = Array.isArray(user?.empresas) ? user.empresas : null;
        if (allowed && allowed.length && !allowed.includes(emp)) {
          emp = allowed[0];
          window.currentEmpresa = emp;
          localStorage.setItem('ss-empresa-activa', emp);
        }
        history.replaceState(null, '', ssBase(`/${emp}/pos`));
        setPathname('/pos');
        if (window.__loadRouteChunks) window.__loadRouteChunks(`/${emp}/pos`);
      }
    }} />
  );

  if (authState === 'app' && currentUser?.rol === 'Driver') return lazyEl('DriverPortalPage', { currentUser });

  if (authState === 'app' && currentUser?.rol === 'Cliente') return lazyEl('ClientPortalApp', { currentUser });

  // Ruta → módulo de permisos. Las rutas que comparten módulo (listas de documentos → pos,
  // kardex → inventory, config-* → config) apuntan al mismo id. Sin canUser('ver', módulo)
  // la ruta bloquea el acceso directo por URL (el sidebar ya oculta el link).
  const ROUTE_MODULE = {
    pos:'pos', 'pos-flujo':'pos', cotizaciones:'cotizacion', ordenes:'orden', facturas:'factura', despachos:'despacho',
    inventory:'inventory', 'inventory-movimientos':'inventory', 'inventory-transferencias':'inventory', reportes:'reportes', comisiones:'comisiones', finanzas_reportes:'finanzas_reportes',
    prices:'prices', bulk:'bulk', dropshipping:'dropshipping', sync:'sync', clients:'clients', contacts:'contacts',
    suppliers:'suppliers', vendedores:'vendedores', cxc:'cxc', cxp:'cxp', bank:'bank', anticipos:'anticipos', inversiones:'inversiones', retenciones:'retenciones', chat:'chat', asistente:'asistente',
    drivers:'drivers', incidencias:'incidencias', devoluciones:'devoluciones', garantias:'garantias', fabricacion:'fabricacion',
    // Cada página de Configuración es su PROPIO módulo de permisos (2026-08-14) — antes las 5 más
    // Papelera compartían un solo 'config', así que un rol no podía entrar a Roles sin poder
    // también resetear contraseñas en Usuarios.
    'config-users':'config_usuarios', 'config-roles':'config_roles', 'config-system':'config_sistema',
    'config-campos':'config_campos', 'config-almacenes':'config_almacenes', 'config-papelera':'papelera',
    papelera:'papelera',
  };
  function renderPage() {
    // Rutas desconocidas caen al default (POS), así que se gatean como 'pos'.
    const permMod = ROUTE_MODULE[currentRoute] || 'pos';
    if (permMod && window.canUser && !window.canUser('ver', permMod)) {
      return <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>No tienes permiso para ver este módulo. Solicítalo a un administrador.</div>;
    }
    switch (currentRoute) {
      case 'pos':          return lazyEl('POSPage', { subRoute: posSubRoute });
      case 'pos-flujo':    return lazyEl('POSPage', { subRoute: 'flujo' });
      case 'cotizaciones': return lazyEl('POSPage', { subRoute: 'cotizaciones' });
      case 'ordenes':      return lazyEl('POSPage', { subRoute: 'ordenes' });
      case 'facturas':     return lazyEl('POSPage', { subRoute: 'facturas' });
      case 'despachos':    return lazyEl('POSPage', { subRoute: 'despachos' });
      case 'inventory':    return lazyEl('InventoryPage');
      case 'inventory-movimientos': return lazyEl('MovimientosInventarioPage', { onBack: () => navigate('inventory') });
      case 'inventory-transferencias': return lazyEl('TransferenciasPage', { onBack: () => navigate('inventory') });
      case 'reportes':     return lazyEl('ReportesPage');
      case 'comisiones':   return lazyEl('ComisionesPage');
      case 'finanzas_reportes': return lazyEl('FinanzasReportesPage');
      case 'prices':       return lazyEl('PricesPage');
      case 'bulk':         return lazyEl('BulkPage');
      case 'dropshipping': return lazyEl('DropshippingPage');
      case 'sync':         return lazyEl('SyncPage');
      case 'clients':      return lazyEl('ClientsPage', { clienteId: clienteSubRoute });
      case 'contacts':     return lazyEl('ContactsPage');
      case 'suppliers':    return lazyEl('SuppliersPage');
      case 'vendedores':   return lazyEl('VendedoresPage');
      case 'cxc':          return lazyEl('CxCPage');
      case 'cxp':          return lazyEl('CxPPage');
      case 'bank':         return lazyEl('BankPage', { subRoute: bankSubRoute, navigate });
      case 'anticipos':    return lazyEl('AnticiposPage');
      case 'inversiones':  return lazyEl('InversionesPage');
      case 'retenciones':  return lazyEl('RetencionesPage');
      case 'chat':         return lazyEl('ChatPage');
      case 'asistente':    return lazyEl('AsistentePage');
      case 'drivers':       return lazyEl('DriversPage');
      case 'incidencias':   return lazyEl('IncidenciasPage');
      case 'devoluciones':  return lazyEl('DevolucionesPage');
      case 'garantias':     return lazyEl('GarantiasPage');
      case 'fabricacion':   return lazyEl('FabricacionPage');
      case 'config-users':    return lazyEl('ConfigUsersPage');
      case 'config-roles':    return lazyEl('ConfigRolesPage');
      case 'config-system':   return lazyEl('ConfigSystemPage');
      case 'config-campos':    return lazyEl('ConfigFieldsPage');
      case 'config-almacenes': return lazyEl('ConfigAlmacenesPage');
      case 'config-papelera':  return lazyEl('PapeleraPage');
      case 'papelera':         return lazyEl('PapeleraPage');
      default:               return lazyEl('POSPage', { subRoute: posSubRoute });
    }
  }

  return (
    <div className="app">
      {/* Franja del color de la empresa activa. Va fuera del grid (position:fixed)
          y por encima de los modales, para que se vea en cualquier pantalla. */}
      {window.EmpresaBand && <EmpresaBand />}
      <div className={`sidebar-backdrop ${mobileOpen ? 'visible' : ''}`} onClick={() => setMobileOpen(false)}></div>
      {isConfigRoute
        ? <ConfigSidebar collapsed={collapsed} setCollapsed={setCollapsed} currentRoute={currentRoute} navigate={navigate} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} currentUser={currentUser}/>
        : <Sidebar       collapsed={collapsed} setCollapsed={setCollapsed} currentRoute={currentRoute} navigate={navigate} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} currentUser={currentUser}/>
      }
      <div className="main">
        <TopBar collapsed={collapsed} setCollapsed={setCollapsed} hashPath={pathname} navigate={navigate} setCmdOpen={setCmdOpen} setChatOpen={setChatOpen} chatUnread={chatUnread} setMobileOpen={setMobileOpen} currentUser={currentUser}/>
        <div className="content" data-version={dataVersion} data-chunk-version={chunkVersion}>
          <ModuleErrorBoundary routeKey={currentRoute}>
            {renderPage()}
          </ModuleErrorBoundary>
        </div>
      </div>
      {window.CmdPalette && <SilentErrorBoundary><CmdPalette open={cmdOpen} setOpen={setCmdOpen} navigate={navigate}/></SilentErrorBoundary>}
      {/* Aviso de carga en curso — UN SOLO popup, de pantalla completa, para el arranque en frío
          (`coldLoad`) y para cualquier carga de media sesión (cambio de módulo, listas grandes,
          refresco de datos vía `ssBusy`). Antes eran dos mecanismos separados (uno bloqueante
          solo al arrancar, una píldora no-bloqueante después) y por eso una pantalla podía mostrar
          SU PROPIO aviso de "cargando" al mismo tiempo que la píldora decía otra cosa — reportado
          el 2026-08-14 en Reportes ("cargando movimientos" arriba y "cargando documentos" abajo,
          a la vez, sin bloquear nada). Bloquea toda la pantalla hasta que TODO termine. */}
      {window.BusyOverlay && <SilentErrorBoundary><BusyOverlay coldLoad={!dataReady}/></SilentErrorBoundary>}
      {/* Aviso de versión nueva: compara el build de esta pestaña contra version.json
          (estampado por build.js) y ofrece recargar. Va acá, dentro del shell ya
          autenticado — al portal del cliente y al visor público no se les interrumpe. */}
      {window.UpdateBanner && <SilentErrorBoundary><UpdateBanner/></SilentErrorBoundary>}
      {/* Aviso de PIN de 6 dígitos: se le pide UNA vez a quien no tiene PIN o tiene uno de 4.
          Va dentro del shell autenticado, después de entrar por correo — nunca al portal del
          cliente ni al visor público. Si lo cierran con la X no vuelve a aparecer: queda en
          Configuración → Mi PIN. Envuelto en el boundary como los demás: un problema en un aviso
          no puede tumbar la app entera. */}
      {window.PinEnrollBanner && <SilentErrorBoundary><PinEnrollBanner/></SilentErrorBoundary>}
      {/* Widget flotante de chat eliminado: el chat interno se accede solo desde el ícono del header. */}
      {window.StoryMode && <SilentErrorBoundary><StoryMode/></SilentErrorBoundary>}
      {/* Torre de IA: panel contextual por módulo (POS, inventario, CxC, bancos, clientes...).
          Decide sola (mirando `pathname`) en qué módulos tiene sentido aparecer; en el resto no
          renderiza nada. Fuera del boundary de ruta a propósito, como los demás overlays. */}
      {window.AITower && <SilentErrorBoundary><AITower pathname={pathname}/></SilentErrorBoundary>}
    </div>
  );
}

window.__ssMountApp = function() {
  ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
};
