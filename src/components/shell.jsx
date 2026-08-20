// Shell: sidebar + topbar + cmd palette
const { useState, useEffect, useMemo, useRef } = React;

// Trunca a 2 decimales SIN redondear (descarta el 3er decimal): 725.747 → "725.74".
// Se redondea antes a 4 decimales para neutralizar el ruido de coma flotante
// (evita que p.ej. 4.35 caiga a "4.34" o 0.29 a "0.28").
const trunc2 = (v) => {
  const n = Number(v);
  return (Math.floor(Math.round((Number.isFinite(n) ? n : 0) * 10000) / 100) / 100).toFixed(2);
};

// Definidas en core.jsx (eager, carga antes que este chunk) porque también las usan los enlaces
// a la ficha del cliente repartidos por los módulos lazy. Acá quedan los alias de módulo.
const ssHrefRuta = (path) => window.ssHrefRuta(path);
const ssNavClick = (path, luego) => window.ssNavClick(path, luego);

// ─── Franja de empresa ───────────────────────────────────────────────────────
// Con dos empresas en la misma interfaz es fácil perder referencia de dónde se
// está trabajando. Esta franja fija arriba lo resuelve en cualquier pantalla.
//
// El color sale de `empresas.color` (la misma fuente que el punto del selector y
// los chips del portal), así que no hay color hardcodeado que se desincronice.
// El mapa de abajo es solo un arranque optimista: la tabla se carga async y sin
// esto la franja parpadearía con el color equivocado en cada recarga.
const EMPRESA_COLOR_FALLBACK = { demo1: '#f97316', demo2: '#94a3b8' };

window.EmpresaBand = function EmpresaBand() {
  const id = window.currentEmpresa || 'demo1';
  const [empresas, setEmpresas] = useState([]);
  const [activa, setActiva] = useState(id);

  useEffect(() => {
    window.loadEmpresas?.().then(list => setEmpresas(list || []));
    function onChange(e) { setActiva(e.detail); }
    window.addEventListener('ss-empresa-changed', onChange);
    return () => window.removeEventListener('ss-empresa-changed', onChange);
  }, []);

  const emp    = empresas.find(e => e.id === activa);
  const color  = emp?.color || EMPRESA_COLOR_FALLBACK[activa] || 'var(--brand)';
  const nombre = emp?.nombre || activa;

  return <div className="empresa-band" style={{ '--empresa-color': color }} title={'Empresa activa: ' + nombre}></div>;
};

// ─── Selector de empresa (multi-tenant) ──────────────────────────────────────
window.EmpresaSelector = function EmpresaSelector({ currentUser }) {
  const [empresas, setEmpresas] = useState([]);
  const [open, setOpen] = useState(false);
  const [activa, setActiva] = useState(window.currentEmpresa || 'demo1');
  const ref = useRef(null);

  useEffect(() => {
    window.loadEmpresas?.().then(list => setEmpresas(list || []));
    function onChange(e) { setActiva(e.detail); }
    window.addEventListener('ss-empresa-changed', onChange);
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('ss-empresa-changed', onChange);
      document.removeEventListener('mousedown', onClick);
    };
  }, []);

  // Filtrar por empresas habilitadas del usuario (si no tiene lista, mostrar todas)
  const allowedIds = (currentUser?.empresas && currentUser.empresas.length) ? currentUser.empresas : empresas.map(e => e.id);
  const visible = empresas.filter(e => allowedIds.includes(e.id));
  const current = visible.find(e => e.id === activa) || visible[0];

  if (visible.length === 0 || !current) return null;
  const onlyOne = visible.length === 1;

  function pick(id) {
    setOpen(false);
    if (id === activa) return;
    // Persistir y recargar — garantiza que TODOS los módulos parten desde cero con la nueva empresa
    localStorage.setItem('ss-empresa-activa', id);
    window.currentEmpresa = id;
    // Actualizar URL: reemplazar el slug de empresa preservando el módulo actual
    try {
      const BYPASS = new Set(['portal-cliente', 'public']);
      const pathname = window.ssPath ? window.ssPath(window.location.pathname) : window.location.pathname;
      const segs = (pathname || '/').replace(/^\//, '').split('/').filter(Boolean);
      if (segs.length && !BYPASS.has(segs[0])) {
        // Si seg0 era empresa, lo reemplazamos; si era módulo (URL legacy), prefijamos
        const isEmpresaSeg = !/^(pos|inventario|precios|cargas|dropshipping|sync|clientes|contactos|proveedores|vendedores|cxc|cxp|banco|chat|drivers|incidencias|portal|devoluciones|garantias|config|reportes|comisiones)$/.test(segs[0]);
        const tail = isEmpresaSeg ? segs.slice(1).join('/') : segs.join('/');
        const newPath = '/' + id + (tail ? '/' + tail : '/pos');
        window.history.replaceState(null, '', window.ssBase ? window.ssBase(newPath) : newPath);
      } else if (!segs.length) {
        const newPath = '/' + id + '/pos';
        window.history.replaceState(null, '', window.ssBase ? window.ssBase(newPath) : newPath);
      }
    } catch (e) {}
    window.location.reload();
  }

  return (
    <div ref={ref} style={{ position:'relative' }}>
      <button
        onClick={() => { if (!onlyOne) setOpen(o => !o); }}
        title={onlyOne ? `Empresa: ${current.nombre}` : 'Cambiar empresa activa'}
        style={{
          display:'flex', alignItems:'center', gap:6, padding:'6px 10px',
          background:'var(--bg-elev)', border:'1px solid var(--border)', borderRadius:8,
          fontSize:12, fontWeight:600, color:'var(--text)',
          cursor: onlyOne ? 'default' : 'pointer', whiteSpace:'nowrap',
          opacity: onlyOne ? 0.85 : 1
        }}>
        <span style={{ width:8, height:8, borderRadius:'50%', background: current.color || 'var(--brand)' }}></span>
        <span>{current.nombre}</span>
        {!onlyOne && <Icon name="chevronD" size={11}/>}
      </button>
      {open && (
        <div style={{
          position:'absolute', top:'calc(100% + 6px)', right:0, minWidth:200,
          background:'var(--bg-elev)', border:'1px solid var(--border)', borderRadius:8,
          boxShadow:'0 8px 24px rgba(0,0,0,.15)', padding:6, zIndex:100
        }}>
          <div style={{ fontSize:10, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:.5, padding:'6px 10px' }}>Empresa activa</div>
          {visible.map(e => (
            <button key={e.id} onClick={() => pick(e.id)} style={{
              display:'flex', alignItems:'center', gap:8, width:'100%', padding:'8px 10px',
              background: e.id === activa ? 'var(--bg-sunken)' : 'transparent', border:'none',
              borderRadius:6, fontSize:13, color:'var(--text)', cursor:'pointer', textAlign:'left'
            }}>
              <span style={{ width:10, height:10, borderRadius:'50%', background: e.color || 'var(--brand)' }}></span>
              <span style={{ flex:1, fontWeight: e.id === activa ? 600 : 400 }}>{e.nombre}</span>
              {e.id === activa && <Icon name="check" size={12}/>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

window.Sidebar = function Sidebar({ collapsed, setCollapsed, currentRoute, navigate, mobileOpen, setMobileOpen, currentUser }) {
  const badgeCxC  = (SSData.cuentasCobrar  || []).filter(c => c.pagado < c.monto).length || null;
  const badgeCxP  = (SSData.cuentasPagar   || []).filter(c => c.pagado < c.monto).length || null;
  // Pendientes de conciliar: se usa `movsPendientes` (TODOS, sin ventana) y no
  // `movsBancarios`, que está acotado a 365 días — con eso el badge decía 3 cuando
  // en realidad había 129. Respaldo a la ventana si aún no llegó la consulta.
  const badgeBank = (SSData.movsPendientes
    ? SSData.movsPendientes.length
    : (SSData.movsBancarios || []).filter(m => !m.conciliado).length) || null;

  const nav = [
    { group: 'Principal', items: [
      { id: 'asistente',  label: 'Asistente IA',          icon: 'chart',     path: '/asistente' },
      { id: 'pos',        label: 'POS / Órdenes',         icon: 'pos',       path: '/pos' },
    ]},
    { group: 'Flujo de Documentos', flow: true, items: [
      { id: 'cotizaciones', label: 'Cotización', icon: 'doc',     path: '/cotizaciones' },
      { id: 'ordenes',      label: 'Orden',      icon: 'receipt', path: '/ordenes' },
      { id: 'facturas',     label: 'Factura',    icon: 'receipt', path: '/facturas' },
      { id: 'despachos',    label: 'Despacho',   icon: 'truck',   path: '/despachos' },
    ]},
    { group: 'Inventario', items: [
      { id: 'inventory',              label: 'Inventario',       icon: 'inventory', path: '/inventario' },
      { id: 'inventory-movimientos',  label: 'Movimientos',      icon: 'list',      path: '/inventario/movimientos' },
      { id: 'inventory-transferencias', label: 'Transferencias',   icon: 'truck',     path: '/inventario/transferencias' },
    ]},
    { group: 'Catálogo', items: [
      { id: 'prices',     label: 'Listas de Precios',      icon: 'price',     path: '/precios' },
      { id: 'bulk',         label: 'Cargas Masivas',         icon: 'upload',    path: '/cargas' },
      { id: 'dropshipping',label: 'Dropshipping',           icon: 'truck',     path: '/dropshipping' },
      { id: 'sync',        label: 'Sincronización Shopify', icon: 'sync',      path: '/sync' },
    ]},
    { group: 'Comercial', items: [
      { id: 'clients',    label: 'Clientes',               icon: 'clients',   path: '/clientes' },
      { id: 'contacts',   label: 'Contactos',              icon: 'contact',   path: '/contactos' },
      { id: 'suppliers',  label: 'Proveedores',            icon: 'suppliers', path: '/proveedores' },
      { id: 'vendedores', label: 'Vendedores',             icon: 'users',     path: '/vendedores' },
    ]},
    { group: 'Finanzas', items: [
      { id: 'cxc',  label: 'Cuentas por Cobrar',   icon: 'cxc',  badge: badgeCxC,  path: '/cxc' },
      { id: 'cxp',  label: 'Cuentas por Pagar',    icon: 'cxc',  badge: badgeCxP,  path: '/cxp' },
      { id: 'bank', label: 'Bancos', icon: 'bank', badge: badgeBank, path: '/banco' },
      { id: 'anticipos', label: 'Anticipos', icon: 'cash', path: '/anticipos' },
      { id: 'inversiones', label: 'Inversiones', icon: 'chart', path: '/inversiones' },
      { id: 'retenciones', label: 'Retenciones', icon: 'receipt', path: '/retenciones' },
      { id: 'finanzas_reportes', label: 'Reportes de Finanzas', icon: 'finance', path: '/finanzas-reportes' },
    ]},
    { group: 'Reportes', items: [
      { id: 'reportes',   label: 'Reportes Dinámicos',  icon: 'chart',  path: '/reportes' },
      { id: 'comisiones', label: 'Comisiones de Ventas', icon: 'dollar', path: '/comisiones' },
    ]},
    { group: 'Logística', items: [
      { id: 'drivers',      label: 'Drivers',      icon: 'truck',  path: '/drivers' },
      { id: 'incidencias',  label: 'Incidencias',  icon: 'info',   path: '/incidencias' },
      { id: 'devoluciones', label: 'Devoluciones', icon: 'arrDn',  path: '/devoluciones' },
      { id: 'garantias',    label: 'Garantías',    icon: 'check',  path: '/garantias' },
      // Fabricación nació atada a una sola empresa con un `currentEmpresa === 'demo2'` acá: era el único
      // módulo del sidebar condicionado por empresa en vez de por permiso. Demo 1 también fabrica
      // (pedido del 2026-08-19), y la empresa no es la pregunta correcta — la pregunta es quién
      // tiene el permiso, que es lo que se administra desde Ajustes → Roles sin tocar código. El
      // gate por `canUser('ver', id)` lo aplica el filtro común de abajo, igual que a los demás:
      // donde nadie tenga el permiso, el ítem no aparece. Los datos ya estaban por empresa (RLS
      // `empresa_id = ANY(jwt_empresas())`), así que cada una ve solo sus órdenes.
      { id: 'fabricacion', label: 'Fabricación', icon: 'box', path: '/fabricacion' },
    ]},
    // Grupo propio (2026-08-13), no un sub-ítem de Configuración: así queda visible en el sidebar
    // PRINCIPAL, justo arriba del footer fijo de "Configuración" — con path `/config/papelera` el
    // sidebar entero se sustituiría por el de Configuración al hacer clic (ver `isConfigRoute` en
    // app-bootstrap.jsx), y el link "desaparecería" de donde el usuario lo vio.
    { group: 'Papelera', items: [
      { id: 'papelera', label: 'Papelera', icon: 'trash', path: '/papelera' },
    ]},
    // El Chat Interno se accede desde el ícono de chat del header (no en el sidebar).
  ];

  // Algunos items del nav no son módulos propios de ROLES_MODULES: se mapean a su módulo real
  // para que canUser (ahora default-deny) no los oculte por error.
  // Cada etapa del flujo tiene su PROPIO módulo desde el 2026-08-13 (antes las 4 compartían 'pos'):
  // un rol puede ver Facturas sin ver Despachos, por ejemplo. 'pos-flujo' (el hub) sigue en 'pos'
  // porque no pertenece a una sola etapa.
  // `papelera` dejó de compartir el módulo 'config' (2026-08-14): tiene su propio permiso, así que
  // ya no necesita alias — el id del nav item coincide con el id del módulo de permisos.
  const MOD_ALIAS = { 'pos-flujo': 'pos', 'cotizaciones': 'cotizacion', 'ordenes': 'orden', 'facturas': 'factura', 'despachos': 'despacho', 'inventory-movimientos': 'inventory', 'inventory-transferencias': 'inventory' };
  const can = (id) => window.canUser ? window.canUser('ver', MOD_ALIAS[id] || id) : true;
  const visibleNav = nav.map(g => ({ ...g, items: g.items.filter(i => can(i.id)) })).filter(g => g.items.length > 0);
  // Las 5 páginas de Configuración también son módulos separados: el botón "Configuración" del
  // pie del sidebar se muestra si el usuario entra a AL MENOS una, y navega a la primera que
  // tenga permitida (antes siempre mandaba a /config/usuarios — con ese permiso quitado, el
  // usuario entraba a una pantalla de "no tienes acceso" aunque sí pudiera ver Roles, por ejemplo).
  const CONFIG_SUBRUTAS = [
    { modulo: 'config_usuarios',  path: '/config/usuarios' },
    { modulo: 'config_roles',     path: '/config/roles' },
    { modulo: 'config_sistema',   path: '/config/sistema' },
    { modulo: 'config_campos',    path: '/config/campos' },
    { modulo: 'config_almacenes', path: '/config/almacenes' },
  ];
  const primeraConfigAccesible = CONFIG_SUBRUTAS.find(r => can(r.modulo));
  const isConfigActive = currentRoute && currentRoute.startsWith('config-');

  // Secciones colapsables (desplegables). Default: TODAS colapsadas. Estado persistido en
  // localStorage: si el usuario abrió una y refresca, se mantiene como la tenía.
  const [openGroups, setOpenGroups] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('ss-sidebar-groups') || '{}') || {}; } catch { return {}; }
  });
  React.useEffect(() => { try { localStorage.setItem('ss-sidebar-groups', JSON.stringify(openGroups)); } catch {} }, [openGroups]);
  const toggleGroup = (g) => setOpenGroups(prev => ({ ...prev, [g]: !prev[g] }));

  // URL real de una ruta del menú, con el prefijo de empresa. Se usa como `href` para que el
  // navegador ofrezca "abrir en una pestaña nueva" (antes eran <button> y no había enlace).
  const hrefDe = ssHrefRuta;
  const navClick = (path) => ssNavClick(path, () => { if (setMobileOpen) setMobileOpen(false); });

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-brand">
        <BrandMark className="brand-mark" />
        <div>
          <div className="brand-text">Distribuidora Demo</div>
          <div className="brand-sub">ERP · Venezuela</div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
        {visibleNav.map(group => {
          const open = !!openGroups[group.group];
          const hasActive = group.items.some(i => i.id === currentRoute);
          // En modo rail (sidebar colapsado a íconos) siempre se muestran los items.
          const showItems = open || collapsed;
          const renderItem = (item, extraClass) => (
            <a
              key={item.id}
              href={hrefDe(item.path)}
              className={`nav-item ${extraClass || ''} ${currentRoute === item.id ? 'active' : ''}`}
              onClick={navClick(item.path)}
              title={item.label}
            >
              {extraClass === 'nav-flow-item' && <span className="nav-flow-node" />}
              <span className="nav-icon"><Icon name={item.icon} size={16} /></span>
              <span className="nav-text">{item.label}</span>
              {item.badge && <span className="nav-badge">{item.badge}</span>}
            </a>
          );
          return (
            <div className={`nav-section ${group.flow ? 'nav-section-flow' : ''}`} key={group.group}>
              <button className={`nav-group-header ${hasActive ? 'has-active' : ''}`}
                onClick={() => toggleGroup(group.group)} title={group.group}>
                <span className="nav-label">{group.group}</span>
                {hasActive && !open && <span className="nav-group-dot" />}
                <Icon name="chevronD" size={12} className={`nav-group-chevron ${open ? 'open' : ''}`} />
              </button>
              {showItems && (
                group.flow
                  ? <div className="nav-flow">{group.items.map(i => renderItem(i, 'nav-flow-item'))}</div>
                  : group.items.map(i => renderItem(i))
              )}
            </div>
          );
        })}
      </div>
      {primeraConfigAccesible && (
        <div className="sidebar-footer">
          <button
            className={`nav-item ${isConfigActive ? 'active' : ''}`}
            onClick={() => { navigate(primeraConfigAccesible.path); if (setMobileOpen) setMobileOpen(false); }}
            title="Configuración"
          >
            <span className="nav-icon"><Icon name="settings" size={16} /></span>
            <span className="nav-text">Configuración</span>
          </button>
        </div>
      )}
    </aside>
  );
};

window.ConfigSidebar = function ConfigSidebar({ collapsed, setCollapsed, currentRoute, navigate, mobileOpen, setMobileOpen, currentUser }) {
  const configNavAll = [
    { id: 'config-users',    label: 'Gestión de Usuarios',       icon: 'users',    path: '/config/usuarios',  modulo: 'config_usuarios' },
    { id: 'config-roles',    label: 'Roles y Permisos',          icon: 'shield',   path: '/config/roles',     modulo: 'config_roles' },
    { id: 'config-system',   label: 'Configuración del Sistema',  icon: 'settings', path: '/config/sistema',   modulo: 'config_sistema' },
    { id: 'config-campos',    label: 'Campos y Validaciones',      icon: 'doc',       path: '/config/campos',    modulo: 'config_campos' },
    { id: 'config-almacenes', label: 'Almacenes',                  icon: 'warehouse', path: '/config/almacenes', modulo: 'config_almacenes' },
    // Papelera se movió al sidebar PRINCIPAL (2026-08-13), como grupo propio arriba de este footer
    // de Configuración — ya no vive acá para no duplicar el link.
  ];
  // Antes esta lista se mostraba ENTERA a cualquiera que hubiera entrado a Configuración (un solo
  // permiso 'config' gateaba las 5 páginas): un rol con acceso solo a Roles veía igual los links a
  // Usuarios/Sistema/Campos/Almacenes, y podía entrar por URL directa. Ahora cada uno es su propio
  // módulo — se filtra acá, y el gate real (por si escriben la URL a mano) sigue en
  // `ROUTE_MODULE` de app-bootstrap.
  const configNav = configNavAll.filter(item => window.canUser ? window.canUser('ver', item.modulo) : true);

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-brand">
        <BrandMark className="brand-mark" />
        <div>
          <div className="brand-text">Distribuidora Demo</div>
          <div className="brand-sub">ERP · Venezuela</div>
        </div>
      </div>
      <div className="config-sidebar-header">
        <button
          className="config-back-btn"
          onClick={() => { navigate('/pos'); if (setMobileOpen) setMobileOpen(false); }}
          title="Volver al sistema"
        >
          <Icon name="chevronL" size={14} />
          <span className="nav-text">Volver al sistema</span>
        </button>
        <div className="nav-label config-section-label">Configuración</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
        <div className="nav-section" style={{ paddingTop: 4 }}>
          {configNav.map(item => (
            <a
              key={item.id}
              // `ssHrefRuta`/`ssNavClick` son de módulo: los helpers `hrefDe`/`navClick` viven
              // dentro de <Sidebar> y acá no están en scope (eso tiraba ReferenceError y dejaba
              // Configuración en pantalla blanca).
              href={ssHrefRuta(item.path)}
              className={`nav-item ${currentRoute === item.id ? 'active' : ''}`}
              onClick={ssNavClick(item.path, () => { if (setMobileOpen) setMobileOpen(false); })}
              title={item.label}
            >
              <span className="nav-icon"><Icon name={item.icon} size={16} /></span>
              <span className="nav-text">{item.label}</span>
            </a>
          ))}
        </div>
      </div>
    </aside>
  );
};

// ── Tasas ─────────────────────────────────────────────────────────────────

function loadTasas() {
  // SSData.tasa es la fuente de verdad (cargada desde DB en loadAppData).
  // localStorage solo se usa para conservar el historial local cuando DB no está disponible.
  let historial = [];
  try {
    const s = JSON.parse(localStorage.getItem('ss-tasas') || 'null');
    if (s && Array.isArray(s.historial)) historial = s.historial;
  } catch(e) {}
  const t = window.SSData.tasa || {};
  const data = {
    bcv:       t.bcv       || 0,
    paralelo:  t.paralelo  || 0,
    cobertura: (t.cobertura == null || t.cobertura === '' ? null : parseFloat(t.cobertura)),
    vuelto:    t.vuelto    || t.paralelo || 0,
    historial,
  };
  window.currentTasa = data;
  return data;
}

function saveTasas(newBcv, newParalelo, newCobertura, newVuelto, prev) {
  const changed = newBcv !== prev.bcv || newParalelo !== prev.paralelo || newCobertura !== prev.cobertura || newVuelto !== prev.vuelto;
  const entry = { fecha: new Date().toISOString(), bcv: newBcv, paralelo: newParalelo, cobertura: newCobertura, vuelto: newVuelto };
  const historial = changed
    ? [entry, ...(prev.historial || [])].slice(0, 200)
    : prev.historial || [];
  const data = { bcv: newBcv, paralelo: newParalelo, cobertura: newCobertura, vuelto: newVuelto, historial };
  try { localStorage.setItem('ss-tasas', JSON.stringify(data)); } catch(e) {}
  window.SSData.tasa.bcv      = newBcv;
  window.SSData.tasa.paralelo = newParalelo;
  window.SSData.tasa.cobertura = newCobertura;
  window.SSData.tasa.vuelto    = newVuelto;
  window.currentTasa = data;
  window.dispatchEvent(new CustomEvent('ss-tasa-changed', { detail: data }));
  return data;
}

function fmtDatetime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: 'short', year: 'numeric' })
      + ' · ' + d.toLocaleTimeString('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit' });
  } catch(e) { return iso; }
}
function fmtFecha(d) {
  try {
    return new Date(d + 'T12:00:00').toLocaleDateString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: 'short', year: 'numeric' });
  } catch(e) { return d; }
}
function fmtHora(iso) {
  try {
    return new Date(iso).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit' });
  } catch(e) { return ''; }
}

window.TasaModal = function TasaModal({ open, setOpen, onSave }) {
  // Las tasas fijan el precio de toda la operación, así que modificarlas es un
  // permiso aparte (`tasas`). Sin él el modal NO se oculta: se abre en solo lectura
  // para que el usuario vea lo que estipuló el administrador y trabaje con eso.
  const canEditTasas = window.canUser?.('editar', 'tasas') ?? false;
  const [data, setData]         = useState(() => loadTasas());
  const [bcv, setBcv]           = useState('');
  const [paralelo, setParalelo] = useState('');
  const [cobertura, setCobertura] = useState('');
  const [vuelto, setVuelto]     = useState('');
  const [error, setError]       = useState('');
  const [tab, setTab]           = useState('edit');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState(null);

  useEffect(() => {
    if (!open) return;

    const d = loadTasas();
    setData(d);
    setBcv(String(d.bcv));
    setParalelo(String(d.paralelo));
    setCobertura(d.cobertura == null ? '' : String(d.cobertura));
    setVuelto(String(d.vuelto || d.paralelo));
    setError('');
    setTab('edit');
    setRefreshing(false);
    setRefreshMsg(null);

    function refreshHistorial() {
      if (window.loadTasasHistorial) {
        window.loadTasasHistorial().then(hist => {
          setData(prev => ({ ...prev, historial: hist }));
        });
      }
    }

    refreshHistorial();

    const channel = window.sb
      .channel('tasa_cambio_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasa_cambio' }, refreshHistorial)
      .subscribe();

    return () => { window.sb.removeChannel(channel); };
  }, [open]);

  if (!open) return null;

  async function handleRefreshBcv() {
    setRefreshing(true); setError(''); setRefreshMsg(null);
    const r = await window.refreshBcvFromSource?.();
    if (!r || !r.success) {
      setError(r?.error || 'No se pudo actualizar la tasa BCV. Reintentá.');
      setRefreshing(false);
      return;
    }
    const newBcv = Number(r.data?.rate) || 0;
    // La Edge Function ya insertó la fila en tasa_cambio; reflejamos el nuevo BCV
    // en el campo, en SSData/app-wide y refrescamos el historial desde DB.
    setBcv(String(newBcv));
    if (window.SSData?.tasa) window.SSData.tasa.bcv = newBcv;
    window.currentTasa = { ...(window.currentTasa || {}), bcv: newBcv };
    window.dispatchEvent(new CustomEvent('ss-tasa-changed', { detail: window.currentTasa }));
    const updated = { ...data, bcv: newBcv };
    if (window.loadTasasHistorial) {
      const hist = await window.loadTasasHistorial();
      setData({ ...updated, historial: hist });
    } else {
      setData(updated);
    }
    onSave?.(updated);   // actualiza la tasa mostrada en el TopBar (y notifica el cambio)
    setRefreshMsg({ rate: newBcv, source: r.data?.source, at: r.data?.sourceUpdatedAt });
    setRefreshing(false);
  }

  async function handleSave() {
    const vBcv = parseFloat(bcv);
    const vPar = parseFloat(paralelo);
    const vCob = parseFloat(cobertura);
    const vVue = parseFloat(vuelto);
    if (isNaN(vBcv) || vBcv <= 0) { setError('La tasa BCV debe ser un número positivo.'); return; }
    if (isNaN(vPar) || vPar < vBcv) { setError('La tasa paralela debe ser mayor o igual a la BCV.'); return; }
    if (isNaN(vCob) || vCob < 0 || vCob > 100) { setError('El porcentaje de cobertura debe estar entre 0 y 100.'); return; }
    if (isNaN(vVue) || vVue <= 0) { setError('La tasa vuelto debe ser un número positivo.'); return; }
    if (window.saveTasaToDB) {
      const ok = await window.saveTasaToDB(vBcv, vPar, vCob, vVue);
      if (!ok) { setError('Error al guardar la tasa en la base de datos. Reintentar.'); return; }
    }
    const newData = saveTasas(vBcv, vPar, vCob, vVue, data);
    setData(newData);
    onSave(newData);
    setOpen(false);
  }

  function exportarHistorial() {
    const cols = [
      { key: 'fecha',     label: 'Fecha y hora',      format: (v, h) => h.fechaDate ? `${fmtFecha(h.fechaDate)} ${fmtHora(h.fecha)}` : fmtDatetime(h.fecha) },
      { key: 'bcv',       label: 'BCV (Bs.)',         format: v => Math.floor(Number(v) * 100) / 100 },
      { key: 'paralelo',  label: 'Paralela (Bs.)',    format: v => Math.floor(Number(v) * 100) / 100 },
      { key: 'cobertura', label: 'Cobertura BCV (%)', format: v => Number(v) || 0 },
      { key: 'vuelto',    label: 'Vuelto (Bs.)',      format: (v, h) => Math.floor(Number(v || h.paralelo) * 100) / 100 },
      { key: 'source',    label: 'Fuente',            format: v => v || '' },
      { key: 'creado_por', label: 'Usuario',           format: (v, h) => /^BCV/i.test(h.source) ? 'Sistema' : (v || 'Sistema') },
    ];
    window.exportToXLSX(data.historial, cols, 'historial-tasa-cambio', 'Historial Tasas');
  }

  const prev     = data.historial && data.historial[1];
  const deltaBcv = prev ? (data.bcv - prev.bcv) : null;
  const deltaPar = prev ? (data.paralelo - prev.paralelo) : null;

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div className="modal" style={{ width: 600 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--accent-soft)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="dollar" size={18} style={{ color: 'var(--accent)' }} />
          </div>
          <div style={{ flex: 1 }}>
            <h2 className="modal-title">Tasas de Cambio</h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
              Cada cambio queda registrado en historial para trazabilidad de documentos
            </div>
          </div>
          <button className="icon-btn" onClick={() => setOpen(false)}><Icon name="x" size={16} /></button>
        </div>

        <div style={{ borderBottom: '1px solid var(--border)', display: 'flex' }}>
          <button
            style={{ padding: '10px 20px', fontSize: 13, fontWeight: tab === 'edit' ? 600 : 400, color: tab === 'edit' ? 'var(--brand)' : 'var(--text-muted)', borderBottom: tab === 'edit' ? '2px solid var(--brand)' : '2px solid transparent', marginBottom: -1 }}
            onClick={() => setTab('edit')}
          >Tasas actuales</button>
          <button
            style={{ padding: '10px 20px', fontSize: 13, fontWeight: tab === 'hist' ? 600 : 400, color: tab === 'hist' ? 'var(--brand)' : 'var(--text-muted)', borderBottom: tab === 'hist' ? '2px solid var(--brand)' : '2px solid transparent', marginBottom: -1 }}
            onClick={() => setTab('hist')}
          >Historial {data.historial.length > 0 && <span style={{ fontSize: 11, background: 'var(--bg-sunken)', padding: '1px 6px', borderRadius: 10, marginLeft: 4 }}>{data.historial.length}</span>}</button>
        </div>

        <div className="modal-body" style={{ padding: 0 }}>
          {tab === 'edit' && (
            <div style={{ padding: 20 }}>
              {/* Actualizar la tasa BCV oficial desde la fuente conectada (vcoud / dolarapi) */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap', marginBottom:16, padding:'10px 14px', background: refreshMsg ? 'var(--success-soft)' : 'var(--bg-sunken)', border:'1px solid', borderColor: refreshMsg ? 'var(--success)' : 'var(--border)', borderRadius:8 }}>
                <div style={{ fontSize:12, color:'var(--text-muted)', lineHeight:1.4, minWidth:0 }}>
                  {refreshMsg ? (
                    <span style={{ color:'var(--success)', fontWeight:500 }}>
                      ✓ BCV actualizado a <strong style={{ fontFamily:'var(--mono)' }}>Bs. {trunc2(refreshMsg.rate)}</strong>
                      {refreshMsg.source ? ` · fuente ${refreshMsg.source}` : ''}
                      {refreshMsg.at ? ` · ${fmtHora(refreshMsg.at)}` : ''}
                    </span>
                  ) : (() => {
                    const latest = data.historial && data.historial[0];
                    return latest && latest.source && /bcv/i.test(latest.source)
                      ? <span>Último BCV automático: <strong style={{ color:'var(--text)' }}>{latest.source}</strong> · {fmtDatetime(latest.fecha)}</span>
                      : <span>Obtené la tasa BCV oficial en tiempo real desde la fuente conectada.</span>;
                  })()}
                </div>
                {canEditTasas && <button className="btn secondary" onClick={handleRefreshBcv} disabled={refreshing} style={{ flexShrink:0 }}>
                  <Icon name="sync" size={14} className={refreshing ? 'ss-spin' : ''} /> {refreshing ? 'Actualizando…' : 'Actualizar BCV'}
                </button>}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
                <div>
                  <label className="form-label">Tasa BCV<span style={{ display: 'block', color: 'var(--text-subtle)', textTransform: 'none', fontSize: 10, fontWeight: 400, letterSpacing: 0 }}>oficial</span></label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>Bs.</span>
                    <input className="input" style={{ width: '100%', paddingLeft: 30, fontFamily: 'var(--mono)', background: 'var(--bg-sunken)', color: 'var(--text-muted)', cursor: 'not-allowed' }} type="number" step="0.01" min="0" value={trunc2(bcv)} readOnly />
                  </div>
                  {deltaBcv !== null && (
                    <div style={{ fontSize: 11, marginTop: 4, color: deltaBcv >= 0 ? 'var(--danger)' : 'var(--success)', fontFamily: 'var(--mono)' }}>
                      {deltaBcv >= 0 ? '▲' : '▼'} {Math.abs(deltaBcv).toFixed(2)} vs anterior
                    </div>
                  )}
                </div>
                <div>
                  <label className="form-label">Tasa Paralela<span style={{ display: 'block', color: 'var(--text-subtle)', textTransform: 'none', fontSize: 10, fontWeight: 400, letterSpacing: 0 }}>mercado</span></label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>Bs.</span>
                    <input className="input" style={{ width: '100%', paddingLeft: 30, fontFamily: 'var(--mono)', borderColor: 'var(--accent)' }} type="number" step="0.01" min="0" value={paralelo} readOnly={!canEditTasas} onChange={e => { if (!canEditTasas) return; setParalelo(e.target.value); setError(''); }} />
                  </div>
                  {deltaPar !== null && (
                    <div style={{ fontSize: 11, marginTop: 4, color: deltaPar >= 0 ? 'var(--danger)' : 'var(--success)', fontFamily: 'var(--mono)' }}>
                      {deltaPar >= 0 ? '▲' : '▼'} {Math.abs(deltaPar).toFixed(2)} vs anterior
                    </div>
                  )}
                </div>
                <div>
                  <label className="form-label">Cobertura BCV<span style={{ display: 'block', color: 'var(--text-subtle)', textTransform: 'none', fontSize: 10, fontWeight: 400, letterSpacing: 0 }}>% sobre precio USD</span></label>
                  <div style={{ position: 'relative' }}>
                    <input className="input" style={{ width: '100%', paddingRight: 30, fontFamily: 'var(--mono)' }} type="number" step="0.1" min="0" max="100" value={cobertura} readOnly={!canEditTasas} onChange={e => { if (!canEditTasas) return; setCobertura(e.target.value); setError(''); }} />
                    <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--text-muted)' }}>%</span>
                  </div>
                </div>
                <div>
                  <label className="form-label">Tasa Vuelto<span style={{ display: 'block', color: 'var(--text-subtle)', textTransform: 'none', fontSize: 10, fontWeight: 400, letterSpacing: 0 }}>devoluciones</span></label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>Bs.</span>
                    <input className="input" style={{ width: '100%', paddingLeft: 30, fontFamily: 'var(--mono)', borderColor: 'var(--warn)' }} type="number" step="0.01" min="0" value={vuelto} readOnly={!canEditTasas} onChange={e => { if (!canEditTasas) return; setVuelto(e.target.value); setError(''); }} />
                  </div>
                </div>
              </div>

              <div style={{ background: 'var(--bg-sunken)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                <strong style={{ color: 'var(--text)' }}>¿Qué es la cobertura BCV?</strong> — Es el porcentaje que se suma al precio en USD cuando el cliente pagará a Tasa BCV. Compensa la diferencia entre la tasa oficial y el mercado. Ejemplo: producto a <strong style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>${(10).toFixed(2)}</strong> con {cobertura || '0'}% cobertura = <strong style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>${(10 * (1 + parseFloat(cobertura || 0) / 100)).toFixed(2)}</strong> a cobrar en bolívares a Bs.{bcv || '0'}.
              </div>
              <div style={{ background: 'var(--warn-soft, #fef3c7)', border: '1px solid var(--warn)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                <strong style={{ color: 'var(--warn)' }}>¿Qué es la Tasa Vuelto?</strong> — Es la tasa que se aplica cuando se devuelve dinero al cliente (residuo de un sobrepago). Por ejemplo, si la deuda era $98 y el cliente pagó $100, los $2 sobrantes se procesan como vuelto a esta tasa.
              </div>

              {error && (
                <div style={{ background: 'var(--danger-soft)', color: 'var(--danger)', border: '1px solid', borderColor: 'var(--danger)', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 12 }}>
                  {error}
                </div>
              )}
            </div>
          )}

          {tab === 'hist' && (
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              {data.historial.length === 0 ? (
                <div className="empty">Sin cambios registrados aún</div>
              ) : (
                <table className="tbl" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>Fecha y hora</th>
                      <th>Usuario</th>
                      <th className="num">BCV</th>
                      <th className="num">Paralela</th>
                      <th className="num">Cob. BCV</th>
                      <th className="num">Vuelto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.historial.map((h, i) => {
                      const isLatest = i === 0;
                      // Cambio automático (cron o "Actualizar BCV") = fuente empieza con 'BCV' → avatar de Sistema.
                      // Cambio manual (Guardar tasas, puede tocar paralela/cobertura/vuelto) = avatar del usuario que lo hizo.
                      const esAutomatico = /^BCV/i.test(h.source);
                      return (
                        <tr key={i} style={isLatest ? { background: 'var(--brand-soft)' } : {}}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 11 }}>
                              {h.source === 'BCV' && <Icon name="bank" size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                              {h.fechaDate ? fmtFecha(h.fechaDate) + ' · ' + fmtHora(h.fecha) : fmtDatetime(h.fecha)}
                            </div>
                            {isLatest && <StatusChip label="Vigente" color="blue" />}
                          </td>
                          <td><CreadoPorCell nombre={esAutomatico ? null : h.creado_por} size={20} showName={false}/></td>
                          <td className="num">Bs. {trunc2(h.bcv)}</td>
                          <td className="num" style={{ color: 'var(--accent)' }}>Bs. {trunc2(h.paralelo)}</td>
                          <td className="num">{h.cobertura}%</td>
                          <td className="num" style={{ color: 'var(--warn)' }}>Bs. {trunc2(h.vuelto || h.paralelo)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn secondary" onClick={() => setOpen(false)}>Cancelar</button>
          {tab === 'hist' && data.historial.length > 0 && (
            <button className="btn secondary" onClick={exportarHistorial}>
              <Icon name="download" size={14} /> Exportar Excel
            </button>
          )}
          {tab === 'edit' && canEditTasas && (
            <button className="btn primary" onClick={handleSave}>
              <Icon name="check" size={14} /> Guardar tasas
            </button>
          )}
          {tab === 'edit' && !canEditTasas && (
            <span className="small muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
              Solo lectura — las tasas las define un administrador.
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

// ── TopBar ─────────────────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════════════
//  PROTOCOLOS DEL SISTEMA
//  Catálogo de las reglas de negocio que el sistema hace cumplir. Vive acá (chunk
//  eager) porque se consulta desde el header en cualquier pantalla.
//
//  Cada regla dice DÓNDE se aplica: 'servidor' = la base de datos la rechaza aunque
//  se intente por fuera de la interfaz; 'app' = la valida la pantalla antes de
//  guardar. La distinción importa: las de servidor son garantías, las de app son
//  controles que un import masivo o un script podrían saltarse.
// ════════════════════════════════════════════════════════════════════════════
// Reordenado módulo por módulo (2026-08-15) — antes agrupaba por tema transversal ("Documentos y
// flujo" mezclaba cotización/orden/factura/despacho), y para saber qué le pasa a UNA factura al
// anularla había que leer entre reglas de los otros tres tipos. Ahora cada módulo es autosuficiente
// — se repiten las reglas genéricas (cliente obligatorio, correlativo, motivo de anulación) en cada
// uno de los 4 documentos en vez de una sola vez arriba, a propósito: es la forma de leer solo el
// módulo que importa sin tener que saltar a otro grupo.
const SS_PROTOCOLOS = [
  { grupo: 'Cotizaciones', icon: 'doc', reglas: [
    { t: 'No se puede guardar sin elegir un cliente', d: 'Es el primer campo obligatorio del compositor. Sin cliente, la cotización no se puede guardar ni convertir en orden.', n: 'app' },
    { t: 'No se puede guardar con el carrito vacío', d: 'Hace falta al menos un producto agregado antes de que el botón "Guardar" haga algo.', n: 'app' },
    { t: 'El número no se repite nunca', d: 'Al guardar, el servidor asigna el correlativo en el mismo instante — dos vendedores creando a la vez no pueden terminar con el mismo número.', n: 'servidor' },
    { t: 'Cancelar exige escribir un motivo (mínimo 10 caracteres)', d: 'Sin eso el botón "Cancelar cotización" no confirma. El motivo, quién y cuándo quedan visibles pasando el mouse por el ícono de info junto al badge rojo.', n: 'app' },
    { t: 'Cancelar NUNCA la borra', d: 'Pasa a su propia pestaña "Canceladas" con badge rojo, y sigue apareciendo en "Todas" en su lugar del correlativo — nunca desaparece de la lista.', n: 'app' },
    { t: 'Convertir a orden no se puede hacer dos veces', d: 'En cuanto existe una orden generada desde esta cotización, el botón "Convertir a orden" se reemplaza por "Ya convertida · {id}" con el enlace directo — no se puede crear una segunda por error.', n: 'app' },
  ]},
  { grupo: 'Órdenes', icon: 'receipt', reglas: [
    { t: 'No se puede guardar sin elegir un cliente', d: 'Mismo campo obligatorio que la cotización que le dio origen.', n: 'app' },
    { t: 'No se puede guardar con el carrito vacío', d: 'Hace falta al menos un producto.', n: 'app' },
    { t: 'El número no se repite nunca', d: 'Correlativo atómico asignado por el servidor al guardar.', n: 'servidor' },
    { t: 'Confirmar la orden reserva el inventario', d: 'La mercancía queda apartada (columna "Reservado" de Inventario) desde el momento en que la orden se guarda, aunque todavía no se haya facturado.', n: 'servidor' },
    { t: 'Cancelar exige escribir un motivo (mínimo 10 caracteres)', d: 'Igual que en cotización — visible en el ícono de info junto al badge.', n: 'app' },
    { t: 'Cancelar NUNCA la borra, y libera la reserva', d: 'Pasa a "Canceladas" con badge rojo, y el inventario que tenía apartado se libera automáticamente en el mismo paso.', n: 'app' },
    { t: 'No se puede facturar dos veces la misma orden', d: 'El botón "Emitir factura" desaparece en cuanto existe una factura viva generada desde esta orden — se reemplaza por "Ya facturada · {id}".', n: 'app' },
    { t: 'Si la factura que generó se anula, la orden se cancela también', d: 'Una orden nunca queda "facturable de nuevo": una corrección real empieza de una cotización nueva, no de refacturar la misma orden.', n: 'app' },
  ]},
  { grupo: 'Facturas', icon: 'dollar', reglas: [
    { t: 'No se puede guardar sin elegir un cliente', d: 'Mismo campo obligatorio que el resto del flujo.', n: 'app' },
    { t: 'No se puede facturar sin stock disponible', d: 'Antes de emitir, el sistema pregunta al servidor cuánto queda disponible descontando lo que otras facturas ya prometieron — si no alcanza, la factura no se emite.', n: 'servidor' },
    { t: 'El número no se repite nunca', d: 'Correlativo atómico del servidor.', n: 'servidor' },
    { t: 'Una factura tiene una sola cuenta por cobrar', d: 'El servidor rechaza crear una segunda CxC para la misma factura, aunque se intente dos veces.', n: 'servidor' },
    { t: 'Las facturas pagadas no llevan cuenta por cobrar viva', d: 'Al saldarse, quedan marcadas "Cobradas" — en la pestaña "Por cobrar" solo aparece lo que de verdad se debe.', n: 'app' },
    { t: 'Anular exige escribir un motivo (mínimo 10 caracteres)', d: 'Visible en el ícono de info junto al badge rojo "Anulada".', n: 'app' },
    { t: 'Anular NUNCA la borra', d: 'Pasa a su pestaña "Anuladas" y sigue en "Todas" en su lugar del correlativo.', n: 'app' },
    { t: 'Anular devuelve todo lo que la factura tocó', d: 'Libera el hold de inventario de su orden, borra la cuenta por cobrar y genera una devolución automática — en un solo paso, no hay que deshacer cada cosa a mano.', n: 'app' },
    { t: 'Anular con un pago ya registrado pregunta qué hacer con ese pago', d: 'Si la factura ya tenía un cobro en banco, aparece un popup: eliminar el pago (la deuda vuelve) o dejarlo desvinculado (el dinero sigue en el banco, pendiente de aplicar a otra cosa) — nunca se borra el dinero.', n: 'app' },
    { t: 'Anular una factura cancela también su orden y su cotización de origen', d: 'Una orden nunca tiene más de una factura viva: una corrección real empieza de una cotización nueva, no de refacturar la misma orden.', n: 'app' },
  ]},
  { grupo: 'Despachos', icon: 'truck', reglas: [
    { t: 'No se puede despachar más de lo pendiente de la factura', d: 'El servidor rechaza registrar más unidades de las que todavía quedan por entregar de esa factura.', n: 'servidor' },
    { t: 'Los seriales se asignan al declarar la entrega, no antes', d: 'Si el producto es serializado, el popup "Declarar entregado" pide el S/N de cada unidad — facturar y despachar por sí solos no lo piden.', n: 'app' },
    { t: 'Anular un despacho reabre su factura', d: 'La factura vuelve a "por despachar" automáticamente, para poder generar un despacho nuevo.', n: 'servidor' },
    { t: 'Anular un despacho YA entregado genera una devolución', d: 'Si nunca se había declarado entregado, anularlo es solo una reversa de inventario; si ya se entregó, además se abre un caso en Devoluciones (la mercancía volvió de un cliente real).', n: 'app' },
    { t: 'Un despacho anulado se reactiva en el MISMO documento', d: 'El siguiente intento no crea un despacho nuevo: reusa el mismo id con un número de versión (-v2, -v3…) y conserva completo su historial de actividad anterior.', n: 'servidor' },
  ]},
  { grupo: 'Inventario', icon: 'box', reglas: [
    { t: 'Todo movimiento de stock deja asiento en el kardex', d: 'Entradas, salidas, ajustes, transferencias y devoluciones quedan registradas con su motivo y el documento que las originó — nada mueve inventario en silencio.', n: 'servidor' },
    { t: 'Una transferencia no puede recibir más de lo enviado', d: 'La cantidad recibida nunca supera la enviada; lo que falte se devuelve explícitamente en un paso aparte, nunca se "pierde" en la transferencia.', n: 'servidor' },
    { t: 'El bajo stock se mide contra el mínimo GLOBAL del producto', d: 'No es el mínimo de cada almacén por separado: la alerta salta cuando el disponible TOTAL entre todos los almacenes cae a ese nivel o menos.', n: 'app' },
    { t: 'No se puede recibir una orden de compra por más de lo pedido', d: 'La recepción es producto por producto; recibir menos de lo esperado exige escribir el motivo en esa misma línea.', n: 'app' },
  ]},
  { grupo: 'Clientes y contactos', icon: 'users', reglas: [
    { t: 'Todo cliente activo debe tener un contacto', d: 'Al crear un cliente se genera su contacto principal automáticamente — persona natural queda como "Titular", jurídica como "Contacto principal".', n: 'app' },
    { t: 'No se permiten clientes duplicados', d: 'Al crear o editar, el sistema avisa si el RIF, la razón social, el teléfono o el correo ya existen en otro registro de la misma empresa.', n: 'app' },
    { t: 'Los nombres se guardan en mayúscula', d: 'Se normalizan al guardar y se colapsan los espacios de más, para que la búsqueda y la detección de duplicados encuentren siempre lo mismo.', n: 'app' },
    { t: 'Natural o jurídica se deduce del RIF, no se elige a mano', d: 'Prefijo J, G o C → jurídica. V, E o P → natural.', n: 'app' },
    { t: 'Solo compra a crédito quien tiene línea asignada', d: 'Si el límite de crédito del cliente es cero, el compositor solo admite pago inmediato — la opción de crédito ni se ofrece.', n: 'app' },
    { t: 'Los plazos ofrecidos no superan los días de crédito del cliente', d: 'A un cliente con 15 días asignados no se le puede emitir a 30, aunque ese plazo exista en la lista general de la empresa.', n: 'app' },
    { t: 'El saldo a favor (anticipos) suma al crédito disponible', d: 'Disponible = límite − deuda + anticipos sin consumir — es plata que el cliente ya entregó y todavía no aplicó a nada.', n: 'app' },
    { t: 'Se avisa cuando la venta excede el crédito, pero no se bloquea', d: 'El sistema lo marca en rojo en el compositor; la decisión final de vender igual es de quien está vendiendo.', n: 'app' },
  ]},
  { grupo: 'Cuentas por cobrar y por pagar', icon: 'cxc', reglas: [
    { t: 'Una factura tiene una sola cuenta por cobrar', d: 'El servidor rechaza crear una segunda CxC para la misma factura.', n: 'servidor' },
    { t: 'Borrar un movimiento de cobro/pago devuelve la deuda ANTES de sacar la plata', d: 'La cuenta por cobrar o por pagar vuelve a quedar pendiente en el mismo paso en que se borra el movimiento — nunca al revés, nunca queda una cuenta "cobrada" sin ningún pago real detrás.', n: 'app' },
    { t: 'No se agrupan facturas de distintas modalidades de pago', d: 'Un cobro conjunto de varias facturas exige que todas compartan la misma modalidad (USD, BCV, paralelo).', n: 'app' },
    { t: 'La referencia de un pago solo se exige si pasó por un banco', d: 'En efectivo no hay número de operación que pedir — exigirlo obligaría a inventar uno.', n: 'app' },
  ]},
  { grupo: 'Anticipos', icon: 'dollar', reglas: [
    { t: 'Un anticipo nunca se aplica solo', d: 'El sistema avisa cuando un cliente tiene saldo a favor, pero aplicarlo a una factura puntual es siempre una decisión manual de cobranza.', n: 'app' },
    { t: 'No se puede aplicar más saldo del que tiene el anticipo', d: 'Ni más de lo que la factura debe. El servidor bloquea el saldo mientras se aplica, así dos personas no consumen el mismo dinero a la vez.', n: 'servidor' },
    { t: 'No se puede borrar un anticipo ya aplicado', d: 'Primero hay que revertir sus aplicaciones a facturas — borrarlo directo dejaría facturas marcadas pagadas con dinero que ya no existiría en ningún lado.', n: 'app' },
    { t: 'Editar un anticipo actualiza también su movimiento en banco', d: 'Monto, tasa o fecha se corrigen en los dos lugares a la vez y queda un badge "Editado" — nunca quedan desincronizados.', n: 'app' },
  ]},
  { grupo: 'Bancos', icon: 'bank', reglas: [
    { t: 'El banco define la moneda y las formas de pago disponibles', d: 'Cada cuenta bancaria tiene una sola moneda y su propia lista de formas de pago — un banco en bolívares no ofrece un cobro en dólares.', n: 'app' },
    { t: 'El saldo es siempre la suma de los movimientos', d: 'Ingresos menos egresos, recalculado en el servidor después de cada cambio. No se edita el saldo a mano directamente.', n: 'servidor' },
    { t: 'Conciliar no mueve el saldo', d: 'Es solo una marca de "ya lo revisé contra el estado de cuenta" — el movimiento ya contaba para el saldo desde que se creó.', n: 'app' },
    { t: 'Un pago que pierde su factura queda desvinculado, nunca se borra', d: 'Si la nota a la que estaba ligado se anula, el movimiento se marca "pendiente de aplicar" (con quién/cuándo/por qué) — el dinero real nunca desaparece del banco.', n: 'app' },
    { t: 'Un traspaso entre cuentas son DOS movimientos que se borran juntos', d: 'Borrar uno solo dejaría media operación (la plata salió de un banco y no entró a ningún otro) — el sistema siempre borra o restaura las dos patas a la vez.', n: 'servidor' },
  ]},
  { grupo: 'Papelera', icon: 'trash', reglas: [
    { t: 'Todo borrado pide confirmación', d: 'Nunca se elimina con un solo clic, en ningún módulo.', n: 'app' },
    { t: 'Lo eliminado va a la papelera por 30 días', d: 'Se restaura desde el módulo Papelera (sidebar principal) antes de que venza. Cotización, orden, factura y despacho NO pasan por acá — se cancelan o anulan, y quedan visibles en su propia pestaña en vez de en la papelera.', n: 'app' },
    { t: 'Primero se confirma en la base, después se quita de la pantalla', d: 'Si la conexión falla a mitad de un borrado, el registro no desaparece de la lista ni "reaparece" solo al refrescar — se queda tal como estaba.', n: 'app' },
  ]},
  { grupo: 'Usuarios, roles y seguridad', icon: 'shield', reglas: [
    { t: 'Cada usuario ve solo las empresas que tiene asignadas', d: 'El aislamiento lo aplica la base de datos, no la pantalla — no existe forma de ver datos de otra empresa cambiando algo en el navegador.', n: 'servidor' },
    { t: 'El rol Administrador tiene todos los permisos y todas las empresas', d: 'Incluidas las que se creen de ahora en adelante — se le asignan solas.', n: 'servidor' },
    { t: 'El PIN nunca sale del servidor', d: 'Se guarda cifrado; la pantalla solo sabe si el usuario tiene PIN configurado o no. Los intentos fallidos se limitan por IP.', n: 'servidor' },
    { t: 'Los usuarios solo se modifican por el canal privilegiado', d: 'Crear, desactivar, cambiar clave o rol pasa siempre por una función del servidor que verifica que quien la llama sea Administrador.', n: 'servidor' },
    { t: 'Toda modificación queda en el log de actividad', d: 'Quién, cuándo, en qué módulo y sobre qué registro — consultable desde la ficha de cada cosa o desde el módulo.', n: 'servidor' },
    { t: 'Cotización, orden, factura y despacho tienen permisos separados', d: 'Un rol puede ver facturas sin ver despachos, por ejemplo — y cancelar/anular ya no depende de quién sea la persona, depende del permiso de su rol en cada módulo puntual.', n: 'app' },
  ]},
];

function ProtocolosModal({ onClose }) {
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();

  const grupos = SS_PROTOCOLOS
    .map(g => ({ ...g, reglas: !term ? g.reglas
      : g.reglas.filter(r => (r.t + ' ' + r.d).toLowerCase().includes(term)) }))
    .filter(g => g.reglas.length > 0);

  const total = SS_PROTOCOLOS.reduce((s, g) => s + g.reglas.length, 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-fullscreen-mobile" onClick={e => e.stopPropagation()}
           style={{ width: 780, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}>
            <Icon name="info" size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <h3 className="modal-title">Protocolos del sistema</h3>
            <div className="small">{total} reglas que el sistema hace cumplir</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>

        <div style={{ padding: '12px 20px 0' }}>
          <input className="input" placeholder="Buscar protocolo... (ej. stock, crédito, anticipo)"
                 value={q} onChange={e => setQ(e.target.value)} autoFocus />
          <div className="small muted" style={{ marginTop: 8, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <span><span className="chip green" style={{ marginRight: 4 }}>Servidor</span> la base de datos la rechaza siempre</span>
            <span><span className="chip neutral" style={{ marginRight: 4 }}>App</span> se valida al guardar desde la pantalla</span>
          </div>
        </div>

        <div className="modal-body" style={{ flex: 1, overflowY: 'auto' }}>
          {grupos.length === 0 && (
            <div className="small muted" style={{ padding: '24px 0', textAlign: 'center' }}>
              No hay protocolos que coincidan con «{q}».
            </div>
          )}
          {grupos.map(g => (
            <div key={g.grupo} style={{ marginBottom: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Icon name={g.icon} size={15} style={{ color: 'var(--brand)' }} />
                <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{g.grupo}</h4>
                <span className="chip neutral">{g.reglas.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {g.reglas.map((r, i) => (
                  <div key={i} style={{ background: 'var(--bg-sunken)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <span className={'chip ' + (r.n === 'servidor' ? 'green' : 'neutral')}
                            style={{ flexShrink: 0, marginTop: 1 }}>
                        {r.n === 'servidor' ? 'Servidor' : 'App'}
                      </span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{r.t}</div>
                        <div className="small muted" style={{ marginTop: 2 }}>{r.d}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
window.ProtocolosModal = ProtocolosModal;

// ══════════════════════════════════════════════════════════════════════════════
//  Torre de control (el ícono de la campana)
// ══════════════════════════════════════════════════════════════════════════════
// Antes la campana abría un popover con una sola cosa: "Tasa BCV actualizada". Ahora abre un panel
// lateral desde la derecha con una LÍNEA DE TIEMPO de lo que hay que atender, y cada cosa se puede
// marcar como **listo**.
//
// Regla de diseño que importa para la velocidad: **la torre no pide NADA al server**. Todo sale de lo
// que ya está en memoria por el arranque —CxC, CxP, los movimientos bancarios sin conciliar
// (`movsPendientes`, que no tiene ventana de fecha), el inventario y la tasa—, así que abrirla es
// gratis. Documentos NO se cargan en el arranque a propósito (ver CLAUDE.md), y por eso la torre no
// habla de despachos: agregarlo costaría un viaje en cada sesión de todos, para un aviso.
//
// "Listo" es un estado PERSONAL y se guarda en el navegador (`ss-torre-listos`, por empresa), no en la
// base: es "yo ya lo vi", no "esto se resolvió". Lo que se resolvió de verdad desaparece solo, porque
// el ítem se calcula del dato (una factura cobrada deja de estar vencida). Los "listos" se limpian
// cuando su ítem ya no existe, así la clave no crece para siempre.
function _torreKey() { return 'ss-torre-listos-' + (window.currentEmpresa || 'demo1'); }
function _torreLeerListos() {
  try { const o = JSON.parse(localStorage.getItem(_torreKey()) || '{}'); return (o && typeof o === 'object') ? o : {}; }
  catch (e) { return {}; }
}
function _torreGuardarListos(o) { try { localStorage.setItem(_torreKey(), JSON.stringify(o)); } catch (e) {} }

// Antigüedad legible sin librerías: "hace 3 h", "hace 2 d".
function _hace(ts) {
  if (!ts) return '';
  const ms = Date.now() - new Date(ts).getTime();
  if (!isFinite(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1)  return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30)   return `hace ${d} d`;
  const me = Math.floor(d / 30);
  return `hace ${me} mes${me > 1 ? 'es' : ''}`;
}

// Los avisos, del dato que ya está en memoria. Cada uno con una `key` ESTABLE (para poder marcarlo
// listo) y un `orden` de severidad: lo que cuesta plata primero.
function _torreItems(notifsTasa) {
  const items = [];
  const usd = (v) => window.fmt ? window.fmt.usd(v) : ('$' + (Number(v) || 0).toFixed(2));

  // ── CxC: lo vencido, y lo que vence en los próximos 7 días ────────────────────
  const cxc = (window.SSData.cuentasCobrar || []).filter(c => (c.pagado || 0) < (c.monto || 0));
  const cxcVenc = cxc.filter(c => (c.dias || 0) > 0);
  if (cxcVenc.length) {
    const total = cxcVenc.reduce((s, c) => s + ((c.monto || 0) - (c.pagado || 0)), 0);
    const peor  = cxcVenc.reduce((a, b) => ((a.dias || 0) >= (b.dias || 0) ? a : b));
    items.push({
      key: 'cxc-vencidas', orden: 1, nivel: 'critico', icon: 'cxc',
      titulo: `${cxcVenc.length} cuenta${cxcVenc.length !== 1 ? 's' : ''} por cobrar vencida${cxcVenc.length !== 1 ? 's' : ''}`,
      detalle: `${usd(total)} sin cobrar · la más vieja lleva ${peor.dias} día${peor.dias !== 1 ? 's' : ''}`,
      ruta: '/cxc', accion: 'Ver cartera',
    });
  }
  const cxcPronto = cxc.filter(c => (c.dias || 0) <= 0 && (c.dias || 0) >= -7);
  if (cxcPronto.length) {
    const total = cxcPronto.reduce((s, c) => s + ((c.monto || 0) - (c.pagado || 0)), 0);
    items.push({
      key: 'cxc-por-vencer', orden: 4, nivel: 'aviso', icon: 'cxc',
      titulo: `${cxcPronto.length} cuenta${cxcPronto.length !== 1 ? 's' : ''} por cobrar vence${cxcPronto.length !== 1 ? 'n' : ''} esta semana`,
      detalle: `${usd(total)} por cobrar en los próximos 7 días`,
      ruta: '/cxc', accion: 'Ver cartera',
    });
  }

  // ── CxP: lo vencido con el proveedor ─────────────────────────────────────────
  const cxp = (window.SSData.cuentasPagar || []).filter(c => (c.pagado || 0) < (c.monto || 0));
  const cxpVenc = cxp.filter(c => (c.dias || 0) > 0);
  if (cxpVenc.length) {
    const total = cxpVenc.reduce((s, c) => s + ((c.monto || 0) - (c.pagado || 0)), 0);
    items.push({
      key: 'cxp-vencidas', orden: 2, nivel: 'critico', icon: 'cxc',
      titulo: `${cxpVenc.length} cuenta${cxpVenc.length !== 1 ? 's' : ''} por pagar vencida${cxpVenc.length !== 1 ? 's' : ''}`,
      detalle: `${usd(total)} de deuda pasada de fecha`,
      ruta: '/cxp', accion: 'Ver deudas',
    });
  }

  // ── Ventas trabadas a mitad del flujo ────────────────────────────────────────
  // Pedido del 2026-08-07: una orden que nunca se facturó y una factura que nunca se despachó
  // están cada una en su lista, pero NADA dice que están paradas — una factura cobrada y sin
  // despachar figura bajo "Cobradas", que se ve sana. Los datos los deja `loadDocsTrabados`
  // (RPC, una vez por sesión) en memoria: acá NO se consulta al server, como el resto de la Torre.
  //
  // SE CUENTAN TODAS. La primera versión dejaba fuera lo migrado de Odoo, con el argumento de que
  // seguramente ya estaba entregado. Estaba mal: Odoo fue el sistema en uso hasta el 2026-08-02,
  // así que "migrada" quiere decir "nació antes del 3 de agosto", no "vieja". El corte por
  // antigüedad lo deja claro: **$34.348,94 de los $35.182 parados son de 2026**, incluida una
  // orden de junio por $25.375 que nunca se facturó. Esconderla era el error.
  // La carga trae TODO (sin umbral) porque Cuentas por Cobrar necesita la lista completa desde el
  // minuto cero. Acá se filtra por antigüedad: la campana no puede sonar por lo que se facturó
  // hoy y se despacha mañana — eso es operación normal, no algo trabado.
  const trabados = (window.SSData.docsTrabados || [])
    .filter(d => (Number(d.dias) || 0) >= (window.DIAS_TRABADO || 7));
  const cobradasSinDesp = trabados.filter(d => d.caso === 'cobrada_sin_despachar');
  if (cobradasSinDesp.length) {
    const total = cobradasSinDesp.reduce((s, d) => s + (Number(d.total) || 0), 0);
    items.push({
      key: 'facturas-cobradas-sin-despachar', orden: 0, nivel: 'critico', icon: 'truck',
      titulo: `${cobradasSinDesp.length} factura${cobradasSinDesp.length !== 1 ? 's' : ''} cobrada${cobradasSinDesp.length !== 1 ? 's' : ''} sin despachar`,
      detalle: `${usd(total)} que el cliente ya pagó y todavía no recibió`,
      ruta: '/pos/flujo', accion: 'Ver ventas trabadas',
    });
  }
  const resto = trabados.filter(d => d.caso !== 'cobrada_sin_despachar');
  if (resto.length) {
    const total = resto.reduce((s, d) => s + (Number(d.total) || 0), 0);
    const sinFacturar  = resto.filter(d => d.tipo === 'orden').length;
    const sinDespachar = resto.filter(d => d.tipo === 'factura').length;
    const partes = [];
    if (sinFacturar)  partes.push(`${sinFacturar} sin facturar`);
    if (sinDespachar) partes.push(`${sinDespachar} sin despachar`);
    const peor = resto.reduce((a, b) => ((Number(a.total) || 0) >= (Number(b.total) || 0) ? a : b));
    items.push({
      key: 'ventas-trabadas', orden: 2, nivel: 'critico', icon: 'doc',
      titulo: `${resto.length} venta${resto.length !== 1 ? 's' : ''} parada${resto.length !== 1 ? 's' : ''} a mitad del flujo`,
      detalle: `${usd(total)} · ${partes.join(' · ')} · la mayor es ${peor.id} por ${usd(Number(peor.total) || 0)}`,
      ruta: '/pos/flujo', accion: 'Ver ventas trabadas',
    });
  }

  // ── Bancos: movimientos sin conciliar (sin ventana de fecha) ──────────────────
  const sinConciliar = (window.SSData.movsPendientes || []).length;
  if (sinConciliar) {
    items.push({
      key: 'bancos-sin-conciliar', orden: 3, nivel: 'aviso', icon: 'bank',
      titulo: `${sinConciliar} movimiento${sinConciliar !== 1 ? 's' : ''} bancario${sinConciliar !== 1 ? 's' : ''} sin conciliar`,
      detalle: 'El saldo del banco no está confirmado contra el extracto',
      ruta: '/banco', accion: 'Ir a Bancos',
    });
  }

  // ── Inventario: agotados y bajo mínimo ───────────────────────────────────────
  const productos = window.SSData.productos || [];
  const inv = window.SSData.inventario || {};
  if (productos.length) {
    let agotados = 0, bajoMin = 0;
    for (const p of productos) {
      if (p.activo === false) continue;
      const slots = Object.values(inv[p.sku] || {});
      const stock = slots.reduce((s, x) => s + (x.cantidad || 0), 0);
      const min   = slots.reduce((s, x) => s + (x.minimo   || 0), 0);
      if (stock <= 0) agotados++;
      else if (min > 0 && stock <= min) bajoMin++;
    }
    if (bajoMin) {
      items.push({
        key: 'inv-bajo-minimo', orden: 5, nivel: 'aviso', icon: 'warehouse',
        titulo: `${bajoMin} producto${bajoMin !== 1 ? 's' : ''} bajo el mínimo`,
        detalle: 'Con stock, pero por debajo del punto de reposición',
        ruta: '/inventario', accion: 'Ver inventario',
      });
    }
    if (agotados) {
      items.push({
        key: 'inv-agotados', orden: 6, nivel: 'info', icon: 'warehouse',
        titulo: `${agotados} producto${agotados !== 1 ? 's' : ''} sin stock`,
        detalle: 'No se pueden facturar hasta reponer',
        ruta: '/inventario', accion: 'Ver inventario',
      });
    }
  }

  // ── Tasa: sin cobertura BCV configurada no se puede cotizar en esa modalidad ──
  const t = window.currentTasa || window.SSData.tasa || {};
  if (t.cobertura == null) {
    items.push({
      key: 'sin-cobertura', orden: 0, nivel: 'critico', icon: 'dollar',
      titulo: 'No hay cobertura BCV configurada',
      detalle: 'Las cotizaciones en modalidad BCV están bloqueadas hasta definirla',
      ruta: null, accion: null,
    });
  }

  // ── Y los avisos en vivo (tasa nueva del BCV) como eventos con hora ──────────
  for (const n of (notifsTasa || [])) {
    items.push({
      key: 'tasa-' + n.id, orden: 7, nivel: 'info', icon: 'dollar',
      titulo: n.label, detalle: null, ts: n.ts, ruta: null, accion: null,
    });
  }

  return items.sort((a, b) => (a.orden - b.orden));
}

// Cuántas cosas quedan por atender (para el badge de la campana). Es la MISMA cuenta que muestra el
// panel: si el badge contara los avisos sin leer diría 0 con la cartera vencida, que es lo que pasaba.
window.ssTorreCuenta = function (notifsTasa) {
  const listos = _torreLeerListos();
  return _torreItems(notifsTasa).filter(i => !listos[i.key]).length;
};

window.TorreDeControl = function TorreDeControl({ abierta, onCerrar, notifsTasa, navegar }) {
  const [listos, setListos] = useState(_torreLeerListos);
  const [verListos, setVerListos] = useState(false);
  const [tick, setTick] = useState(0);
  // Un repintado por TANDA de datos (ver `ssOnDatos` en core.jsx): los avisos salen de SSData y
  // durante el arranque llegan en 4-6 tandas.
  useEffect(() => (window.ssOnDatos ? window.ssOnDatos(() => setTick(v => v + 1)) : undefined), []);

  const items = React.useMemo(() => { void tick; return _torreItems(notifsTasa); }, [tick, notifsTasa, abierta]);

  // Limpieza: si un aviso ya no existe, su "listo" tampoco tiene sentido guardado.
  useEffect(() => {
    const vivas = new Set(items.map(i => i.key));
    const filtrados = {};
    let cambio = false;
    for (const [k, v] of Object.entries(listos)) {
      if (vivas.has(k)) filtrados[k] = v; else cambio = true;
    }
    if (cambio) { setListos(filtrados); _torreGuardarListos(filtrados); }
  }, [items]);

  const pendientes = items.filter(i => !listos[i.key]);
  const hechos     = items.filter(i =>  listos[i.key]);

  function marcar(key) {
    const next = { ...listos, [key]: new Date().toISOString() };
    setListos(next); _torreGuardarListos(next);
  }
  function desmarcar(key) {
    const next = { ...listos }; delete next[key];
    setListos(next); _torreGuardarListos(next);
  }
  function marcarTodo() {
    const next = { ...listos };
    const ahora = new Date().toISOString();
    pendientes.forEach(i => { next[i.key] = ahora; });
    setListos(next); _torreGuardarListos(next);
  }

  // Cerrar con Escape: es un panel, no una página.
  useEffect(() => {
    if (!abierta) return;
    const onKey = (e) => { if (e.key === 'Escape') onCerrar(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [abierta, onCerrar]);

  const COLOR = { critico: 'var(--danger)', aviso: 'var(--warn)', info: 'var(--text-muted)' };
  const ETIQ  = { critico: 'Atender', aviso: 'Revisar', info: 'Al día' };

  function Fila({ it, hecho }) {
    return (
      <div className={'torre-item' + (hecho ? ' hecho' : '')}>
        <span className="torre-punto" style={{ background: hecho ? 'var(--success)' : COLOR[it.nivel] }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="torre-item-top">
            <Icon name={it.icon} size={13} />
            <span className="torre-item-titulo">{it.titulo}</span>
            {!hecho && (
              <span className="torre-chip" style={{ background: COLOR[it.nivel], color: it.nivel === 'info' ? 'var(--bg)' : '#fff' }}>
                {ETIQ[it.nivel]}
              </span>
            )}
          </div>
          {it.detalle && <div className="torre-item-detalle">{it.detalle}</div>}
          <div className="torre-item-pie">
            {it.ts && <span>{_hace(it.ts)}</span>}
            {it.ruta && (
              <a href={ssHrefRuta(it.ruta)} onClick={ssNavClick(it.ruta, onCerrar)} className="torre-link">
                {it.accion} →
              </a>
            )}
            {hecho
              ? <button className="torre-btn" onClick={() => desmarcar(it.key)}>Deshacer</button>
              : <button className="torre-btn primario" onClick={() => marcar(it.key)}>✓ Listo</button>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={'torre-fondo' + (abierta ? ' abierta' : '')} onClick={onCerrar} />
      <aside className={'torre' + (abierta ? ' abierta' : '')} aria-hidden={!abierta}>
        <div className="torre-header">
          <div>
            <div className="torre-titulo">Torre de control</div>
            <div className="torre-sub">
              {pendientes.length === 0
                ? 'Nada pendiente por ahora'
                : `${pendientes.length} cosa${pendientes.length !== 1 ? 's' : ''} por atender`}
            </div>
          </div>
          {pendientes.length > 0 && (
            <button className="torre-btn" onClick={marcarTodo} title="Marcar todo como listo">Todo listo</button>
          )}
          <button className="icon-btn" onClick={onCerrar} title="Cerrar (Esc)"><Icon name="x" size={16} /></button>
        </div>

        <div className="torre-cuerpo">
          {pendientes.length === 0 && hechos.length === 0 && (
            <div className="torre-vacio">
              <Icon name="check" size={22} />
              <div>No hay avisos. Cuando algo requiera atención aparece acá.</div>
            </div>
          )}
          {pendientes.length > 0 && (
            <div className="torre-linea">
              {pendientes.map(it => <Fila key={it.key} it={it} hecho={false} />)}
            </div>
          )}
          {hechos.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <button className="torre-btn" style={{ width: '100%', justifyContent: 'center' }}
                      onClick={() => setVerListos(v => !v)}>
                {verListos ? 'Ocultar' : 'Ver'} {hechos.length} marcado{hechos.length !== 1 ? 's' : ''} como listo{hechos.length !== 1 ? 's' : ''}
              </button>
              {verListos && (
                <div className="torre-linea" style={{ marginTop: 10, opacity: .75 }}>
                  {hechos.map(it => <Fila key={it.key} it={it} hecho />)}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="torre-pie">
          Los avisos salen de lo que ya está cargado (cartera, bancos, inventario y tasa): abrir la torre
          no consulta nada. <strong>Listo</strong> es personal, de este navegador — lo que se resuelve de
          verdad desaparece solo.
        </div>
      </aside>
    </>
  );
};

window.TopBar = function TopBar({ collapsed, setCollapsed, hashPath, navigate, setCmdOpen, setChatOpen, chatUnread, setMobileOpen, currentUser }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const authEmail = currentUser?.email || '';
  const me = currentUser
    || { nombre: authEmail, rol: 'Usuario', iniciales: authEmail[0]?.toUpperCase() || 'U', avatar: '#6b6a65' };

  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const [tasa, setTasa]         = useState(() => loadTasas());
  const [tasaOpen, setTasaOpen] = useState(false);
  const [popupBcv, setPopupBcv]       = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [notifOpen, setNotifOpen]     = useState(false);
  const [protocolosOpen, setProtocolosOpen] = useState(false);
  const bellRef  = React.useRef(null);
  const bcvRef   = React.useRef(null);
  const saveRef  = React.useRef(null);

  // Lo pendiente en la torre de control (cartera vencida, bancos sin conciliar, inventario, tasa).
  // Se recalcula cuando llega una tanda de datos y cuando se abre/cierra el panel (ahí es donde se
  // marcan cosas como listas). Un repintado por tanda, no uno por evento — ver `ssOnDatos`.
  const [torreTick, setTorreTick] = useState(0);
  useEffect(() => (window.ssOnDatos ? window.ssOnDatos(() => setTorreTick(v => v + 1)) : undefined), []);
  const torrePendientes = React.useMemo(
    () => { void torreTick; return window.ssTorreCuenta ? window.ssTorreCuenta(notifications) : 0; },
    [torreTick, notifications, notifOpen]
  );

  const handleTasaSave = React.useCallback((newData, opts = {}) => {
    const prevBcv = tasa?.bcv;
    const newBcv  = newData?.bcv;
    const changed = opts.forceNotify || (!Number.isNaN(Number(newBcv)) && Number(prevBcv) !== Number(newBcv));
    setTasa(newData);
    if (changed) {
      setPopupBcv(newBcv);
      setNotifications(prev => [
        { id: Date.now(), label: `Tasa BCV actualizada: Bs. ${trunc2(newBcv)}`, ts: new Date(), read: false },
        ...prev
      ].slice(0, 20));
    }
  }, [tasa]);

  React.useEffect(() => { bcvRef.current  = tasa?.bcv ?? null; }, [tasa]);
  React.useEffect(() => { saveRef.current = handleTasaSave;    }, [handleTasaSave]);

  React.useEffect(() => {
    if (!window.sb) return;
    const channel = window.sb
      .channel('tasa-bcv-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasa_cambio' },
        (payload) => {
          if (!payload?.new || typeof payload.new !== 'object') return;
          const row = payload.new;
          const newBcv = parseFloat(row.bcv);
          if (Number.isNaN(newBcv)) return;
          const isInsert = payload.eventType === 'INSERT';
          // Dedup only for UPDATE events — every INSERT is a new cron fetch and must notify
          if (!isInsert && bcvRef.current !== null && Number(bcvRef.current) === newBcv) return;
          const mapped = {
            bcv:       newBcv,
            paralelo:  parseFloat(row.paralelo),
            cobertura: (row.cobertura == null ? null : parseFloat(row.cobertura)),
            vuelto:    parseFloat(row.vuelto ?? row.paralelo),
          };
          try {
            if (window.SSData) window.SSData.tasa = { ...(window.SSData.tasa || {}), ...mapped };
            window.currentTasa = mapped;
          } catch (e) {}
          if (typeof saveRef.current === 'function') saveRef.current(mapped, { forceNotify: isInsert });
        }
      )
      .subscribe();
    return () => { try { channel.unsubscribe(); } catch (e) {} };
  }, []);

  React.useEffect(() => {
    const refresh = () => setTasa(loadTasas());
    window.addEventListener('ss-appdata-loaded', refresh);
    window.addEventListener('ss-tasa-changed', refresh);
    return () => {
      window.removeEventListener('ss-appdata-loaded', refresh);
      window.removeEventListener('ss-tasa-changed', refresh);
    };
  }, []);

  // (El "clic afuera cierra" que había acá era para el popover de la campana: con el panel lateral
  // cerraba al primer clic DENTRO del panel, porque el panel no está dentro del botón. La torre se
  // cierra con su propio fondo, con la X y con Escape.)

  // Breadcrumbs por path completo
  const labelMap = {
    '/asistente':           ['Asistente IA'],
    '/pos':                 ['Comercial', 'POS / Órdenes'],
    '/pos/flujo':           ['Comercial', 'POS / Órdenes', 'Flujo de documentos'],
    '/cotizaciones':        ['Flujo de Documentos', 'Cotizaciones'],
    '/ordenes':             ['Flujo de Documentos', 'Órdenes'],
    '/despachos':           ['Flujo de Documentos', 'Notas de Despacho'],
    '/facturas':            ['Flujo de Documentos', 'Facturas'],
    '/inventario':          ['Catálogo', 'Inventarios'],
    '/precios':             ['Catálogo', 'Listas de Precios'],
    '/cargas':              ['Catálogo', 'Cargas Masivas'],
    '/dropshipping':        ['Catálogo', 'Dropshipping'],
    '/sync':                ['Catálogo', 'Sincronización Shopify'],
    '/clientes':            ['Comercial', 'Clientes'],
    '/contactos':           ['Comercial', 'Contactos'],
    '/proveedores':         ['Comercial', 'Proveedores'],
    '/cxc':                 ['Finanzas', 'Cuentas por Cobrar'],
    '/cxp':                 ['Finanzas', 'Cuentas por Pagar'],
    '/anticipos':           ['Finanzas', 'Anticipos'],
    '/banco':               ['Finanzas', 'Bancos'],
    '/chat':                ['Comunicación', 'Chat Interno'],
    '/config/usuarios':     ['Configuración', 'Gestión de Usuarios'],
    '/config/roles':        ['Configuración', 'Roles y Permisos'],
    '/config/sistema':      ['Configuración', 'Sistema'],
    '/config/campos':       ['Configuración', 'Campos y Validaciones'],
  };

  // Normalizar el path para el lookup (puede tener segmentos extra como un ID de doc)
  const pathKey = hashPath.startsWith('/') ? hashPath : '/' + hashPath;
  // Buscar exacto primero, luego el prefijo más largo que coincida
  let crumbs = labelMap[pathKey];
  if (!crumbs) {
    const segments = pathKey.split('/').filter(Boolean);
    for (let len = segments.length; len > 0; len--) {
      const candidate = '/' + segments.slice(0, len).join('/');
      if (labelMap[candidate]) { crumbs = labelMap[candidate]; break; }
    }
  }
  crumbs = crumbs || ['Comercial', 'POS / Órdenes'];

  return (
    <header id="header" className="topbar">
      <button className="mobile-nav-toggle" onClick={() => setMobileOpen && setMobileOpen(true)} title="Menú">
        <Icon name="menu" size={18} />
      </button>
      <button className="collapse-btn" onClick={() => setCollapsed(!collapsed)} title="Colapsar menú">
        <Icon name="menu" size={16} />
      </button>
      <div className="breadcrumb">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            <span className={i === crumbs.length - 1 ? 'current' : ''}>{c}</span>
          </React.Fragment>
        ))}
      </div>
      <TasaModal open={tasaOpen} setOpen={setTasaOpen} onSave={handleTasaSave} />
      {popupBcv !== null && (
        <BCVRatePopup key={popupBcv} bcvValue={popupBcv} onClose={() => setPopupBcv(null)} />
      )}
      {/* Se monta siempre (no `{notifOpen && …}`) para que el panel pueda ENTRAR y SALIR con la
          transición: desmontarlo lo haría desaparecer de golpe. */}
      <TorreDeControl abierta={notifOpen} onCerrar={() => setNotifOpen(false)} notifsTasa={notifications} />
      <div className="topbar-right">
        <EmpresaSelector currentUser={currentUser} />
        <button className="rate-chip rate-chip-btn" title="Gestionar tasas de cambio" onClick={() => setTasaOpen(true)}>
          <Icon name="dollar" size={12} />
          <span>BCV</span>
          <span className="rate-val">Bs. {trunc2(tasa.bcv)}</span>
          <span style={{color:'var(--text-subtle)'}}>·</span>
          <span>Par.</span>
          <span className="rate-val" style={{color:'var(--accent)'}}>Bs. {trunc2(tasa.paralelo)}</span>
          <span style={{color:'var(--text-subtle)', fontSize: 10}}>·</span>
          <span style={{fontSize: 10.5, color: tasa.cobertura == null ? 'var(--danger)' : 'var(--text-muted)'}}
                title={tasa.cobertura == null ? 'No hay cobertura BCV configurada — configurarla antes de cotizar en BCV' : undefined}>
            Cob. {tasa.cobertura == null ? 'sin definir' : tasa.cobertura + '%'}
          </span>
          <span style={{color:'var(--text-subtle)', fontSize: 10}}>·</span>
          <span style={{fontSize: 10.5, color: 'var(--text-muted)'}}>Vuelto Bs. {trunc2(tasa.vuelto || tasa.paralelo || 0)}</span>
        </button>
        <button className="cmdk-btn" onClick={() => setCmdOpen(true)}>
          <Icon name="search" size={13} />
          <span>Buscar o ir a…</span>
          <span className="kbd">⌘K</span>
        </button>
        {/* La campana abre la TORRE DE CONTROL (panel lateral derecho con la línea de tiempo de lo
            que hay que atender). El badge cuenta lo pendiente de verdad, no los avisos sin leer:
            antes decía 0 con la cartera vencida. Ver <TorreDeControl/> arriba. */}
        <div style={{position:'relative'}} ref={bellRef}>
          <button className="icon-btn" title="Torre de control" onClick={() => setNotifOpen(o => !o)}>
            <Icon name="bell" size={16} />
            {torrePendientes > 0
              ? <span className="notif-badge">{torrePendientes > 9 ? '9+' : torrePendientes}</span>
              : <span className="dot" />
            }
          </button>
        </div>
        {(window.canUser ? window.canUser('ver', 'asistente') : true) && (
          <a className="icon-btn topbar-ai-btn" title="Asistente IA" href={ssHrefRuta('/asistente')}
            onClick={ssNavClick('/asistente')}
            style={{ color: 'var(--brand)', background: 'var(--brand-soft)' }}>
            <Icon name="chart" size={16} />
          </a>
        )}
        {/* Botón con texto (antes solo ícono) — mismo patrón que el buscador (⌘K): así se ve como
            lo que es, no como un simple ícono de ayuda perdido entre el resto de la barra. */}
        {/* `cmdk-btn-compact`: mismo aspecto que el buscador pero SIN su `min-width: 220px`, que
            está pensado para un campo de búsqueda. Con los 220px heredados, dos botones anchos más
            el chip de tasas sacaban la barra 84px fuera de la pantalla a 1280 (medido con
            `npm run responsive`) — y 1280 es una resolución de escritorio de todos los días. */}
        <button className="cmdk-btn cmdk-btn-compact" title="Protocolos del sistema — reglas que el sistema hace cumplir"
                onClick={() => setProtocolosOpen(true)}>
          <Icon name="info" size={13} />
          <span>Protocolo</span>
        </button>
        <a className="icon-btn" title="Chat interno" href={ssHrefRuta('/chat')} onClick={ssNavClick('/chat')}>
          <Icon name="chat" size={16} />
          {chatUnread > 0 && <span className="dot"></span>}
        </a>
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button className="topbar-avatar" title={`${me.nombre} · ${me.rol}`} onClick={() => setMenuOpen(v => !v)}>
            <Avatar user={me} size={28} />
            <div className="topbar-avatar-meta">
              <div className="topbar-avatar-name">{me.nombre}</div>
              <div className="topbar-avatar-role">{me.rol}</div>
            </div>
            <Icon name="chevronD" size={12} style={{ color: 'var(--text-muted)', marginLeft: 2 }} />
          </button>
          {menuOpen && (
            <div className="user-dropdown">
              <div className="user-dropdown-header">
                <Avatar user={me} size={36} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{me.nombre}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{me.email || authEmail}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{me.rol}</div>
                </div>
              </div>
              <div className="user-dropdown-divider" />
              <button className="user-dropdown-item" onClick={() => { setMenuOpen(false); navigate('/config/sistema'); }}>
                <Icon name="settings" size={14} /> Configuración
              </button>
              <div className="user-dropdown-divider" />
              <button className="user-dropdown-item danger" onClick={async () => { setMenuOpen(false); await window.sb.auth.signOut(); if (window.signOutApp) window.signOutApp(); }}>
                <Icon name="x" size={14} /> Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
      {protocolosOpen && <ProtocolosModal onClose={() => setProtocolosOpen(false)} />}
    </header>
  );
};

// ── Command Palette ────────────────────────────────────────────────────────

const CMD_NAV = [
  { path: '/cotizaciones',     kind: 'Módulo',        label: 'Cotizaciones',             icon: 'doc' },
  { path: '/ordenes',          kind: 'Módulo',        label: 'Órdenes de Venta',         icon: 'doc' },
  { path: '/facturas',         kind: 'Módulo',        label: 'Facturas',                 icon: 'receipt' },
  { path: '/despachos',        kind: 'Módulo',        label: 'Notas de Despacho',        icon: 'truck' },
  { path: '/inventario',       kind: 'Módulo',        label: 'Inventarios',              icon: 'inventory' },
  { path: '/precios',          kind: 'Módulo',        label: 'Listas de Precios',        icon: 'price' },
  { path: '/clientes',         kind: 'Módulo',        label: 'Clientes',                 icon: 'clients' },
  { path: '/proveedores',      kind: 'Módulo',        label: 'Proveedores',              icon: 'suppliers' },
  { path: '/contactos',        kind: 'Módulo',        label: 'Contactos',                icon: 'contact' },
  { path: '/cxc',              kind: 'Módulo',        label: 'Cuentas por Cobrar',       icon: 'cxc' },
  { path: '/cxp',              kind: 'Módulo',        label: 'Cuentas por Pagar',        icon: 'cxc' },
  { path: '/banco',            kind: 'Módulo',        label: 'Bancos',    icon: 'bank' },
  { path: '/devoluciones',     kind: 'Módulo',        label: 'Devoluciones / NC',        icon: 'arrDn' },
  { path: '/garantias',        kind: 'Módulo',        label: 'Garantías',                icon: 'shield' },
  { path: '/drivers',          kind: 'Módulo',        label: 'Drivers / Despachos',      icon: 'truck' },
  { path: '/incidencias',      kind: 'Módulo',        label: 'Incidencias',              icon: 'bell' },
  { path: '/cargas',           kind: 'Módulo',        label: 'Cargas Masivas',           icon: 'upload' },
  { path: '/dropshipping',     kind: 'Módulo',        label: 'Dropshipping',             icon: 'box' },
  { path: '/reportes',        kind: 'Módulo',        label: 'Reportes Dinámicos',       icon: 'chart' },
  { path: '/comisiones',      kind: 'Módulo',        label: 'Comisiones de Ventas',     icon: 'dollar' },
  { path: '/chat',             kind: 'Módulo',        label: 'Chat Interno',             icon: 'chat' },
  { path: '/config/usuarios',  kind: 'Configuración', label: 'Gestión de Usuarios',      icon: 'users' },
  { path: '/config/roles',     kind: 'Configuración', label: 'Roles y Permisos',         icon: 'settings' },
  { path: '/config/sistema',   kind: 'Configuración', label: 'Configuración del Sistema',icon: 'settings' },
  { path: '/papelera',         kind: 'Módulo',        label: 'Papelera',                 icon: 'trash' },
];

const CMD_ICON = {
  'Módulo':        'chevronR',
  'Configuración': 'settings',
  'Cliente':       'clients',
  'Proveedor':     'suppliers',
  'Producto':      'inventory',
  'Documento':     'doc',
  'Contacto':      'contact',
  'CxC':           'cxc',
  'CxP':           'cxc',
  'Driver':        'truck',
  'Incidencia':    'bell',
  'Devolución':    'arrDn',
};

window.CmdPalette = function CmdPalette({ open, setOpen, navigate }) {
  const [q, setQ]     = useState('');
  const [sel, setSel] = useState(0);
  const inputRef      = useRef(null);
  const [snLookup, setSnLookup]   = useState(null); // resultado de /sn <serial>
  const [docLookup, setDocLookup] = useState(null); // documentos encontrados server-side (fuera de los 90d en memoria)
  // El catálogo de clientes (13.096 filas) llega DESPUÉS de abrir la paleta (`ensureClientesCatalogo`
  // más abajo es async). Sin un tick que fuerce recalcular `items`, si el usuario escribe rápido y
  // deja de teclear ANTES de que el catálogo termine de llegar, la búsqueda queda calculada contra
  // el `SSData.clientes` viejo (parcial) para siempre — se ve como "no encuentra todo lo que hay
  // con ese nombre" aunque el dato ya esté en memoria un instante después.
  const [tick, setTick] = useState(0);
  useEffect(() => (window.ssOnDatos ? window.ssOnDatos(() => setTick(v => v + 1)) : undefined), []);

  useEffect(() => {
    if (open) {
      setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 50);
      // El catálogo de clientes/contactos es diferido y en el composer del POS no se carga
      // (ver app-bootstrap). La paleta busca clientes desde CUALQUIER ruta, así que lo pide
      // al abrirse: sin esto, Ctrl+K estando en el POS no encontraría ningún cliente y
      // parecería que no existen. Es memoizado — si ya está cargado no cuesta nada.
      window.ensureClientesCatalogo?.();
      window.ensureContactosCatalogo?.();
    }
  }, [open]);

  // BR-INV/M-02: detectar comando /sn <serial> y buscar en DB
  useEffect(() => {
    const m = q.match(/^\/sn\s+(.+)$/i);
    if (!m) { setSnLookup(null); return; }
    const term = m[1].trim();
    if (term.length < 2) { setSnLookup(null); return; }
    let alive = true;
    const handle = setTimeout(async () => {
      // Búsqueda exacta + parcial: usar ilike para tolerar typos del usuario
      const empresa = window.currentEmpresa || 'demo1';
      const { data } = await window.sb.from('inventario_seriales')
        .select('*').eq('empresa_id', empresa).ilike('serial', '%' + term + '%').limit(10);
      if (alive) setSnLookup({ term, hits: data || [] });
    }, 250);
    return () => { alive = false; clearTimeout(handle); };
  }, [q]);

  // Búsqueda de DOCUMENTOS server-side, por NÚMERO y por CLIENTE.
  //
  // Reportado el 2026-08-13: "pongo ThunderNet y no me muestra todas las cotizaciones, órdenes,
  // facturas y entregas; sale solo CxC". Dos causas, las dos de fondo:
  //
  //  1. El barrido en memoria mira `SSData.documentos`, que YA NO se carga en el arranque (es por
  //     ruta, ver CLAUDE.md). Parado en CxC ese arreglo está VACÍO — y `SSData.cuentasCobrar` sí
  //     está cargado, de ahí que lo único que aparecía fuera la CxC.
  //  2. El respaldo server-side solo miraba `documentos.id`. Un nombre de cliente no coincide con
  //     ningún número de documento, así que por esa vía tampoco salía nada.
  //
  // Ahora: los ids de cliente se resuelven en el server (`buscarClienteIds`, el mismo helper que
  // usan las listas) y se pide una consulta POR ETAPA con `count:'exact'` — 5 filas de cada una más
  // el total real. Así las cuatro etapas aparecen aunque una tenga cientos, y el "ver las N" de
  // abajo puede decir cuántas hay de verdad en vez de "5+".
  const ETAPAS = ['cotizacion', 'orden', 'factura', 'despacho'];
  const POR_ETAPA = 5;
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3 || term.startsWith('/')) { setDocLookup(null); return; }
    let alive = true;
    const handle = setTimeout(async () => {
      const empresa = window.currentEmpresa || 'demo1';
      // Solo las columnas que pinta la paleta: el detalle se carga al abrir el documento.
      const COLS = 'id,tipo,estado,fecha,total,cliente_id,nro_despacho';
      const porNumero = window.sb.from('documentos').select(COLS).eq('empresa_id', empresa)
        .ilike('id', '%' + term + '%').order('fecha', { ascending: false }).limit(12);
      const porCliente = (async () => {
        const ids = await (window.buscarClienteIds?.(term, { limit: 60 }) || Promise.resolve([]));
        if (!ids.length) return { rows: [], totales: {} };
        const res = await Promise.all(ETAPAS.map(t =>
          window.sb.from('documentos').select(COLS, { count: 'exact' }).eq('empresa_id', empresa)
            .eq('tipo', t).in('cliente_id', ids)
            .order('fecha', { ascending: false }).limit(POR_ETAPA)));
        const rows = [], totales = {};
        res.forEach((r, i) => { totales[ETAPAS[i]] = r.count || 0; (r.data || []).forEach(d => rows.push(d)); });
        return { rows, totales };
      })();
      const [rNum, rCli] = await Promise.all([porNumero, porCliente]);
      if (!alive) return;
      // Dedup: un documento puede entrar por las dos vías (su número contiene el término Y es de
      // ese cliente). Gana la primera aparición; el orden por etapa se arma en `items`.
      const porId = new Map();
      (rNum.data || []).concat(rCli.rows || []).forEach(d => { if (!porId.has(d.id)) porId.set(d.id, d); });
      setDocLookup({ term, hits: [...porId.values()], totales: rCli.totales || {} });
    }, 280);
    return () => { alive = false; clearTimeout(handle); };
  }, [q]);

  // El texto con el que se BUSCA va con freno; el del input es instantáneo. Sin esto, cada tecla
  // dispara el barrido completo de abajo y el campo se traba mientras se escribe.
  const [qLento, setQLento] = useState(q);
  useEffect(() => { const t = setTimeout(() => setQLento(q), 160); return () => clearTimeout(t); }, [q]);

  // Índice documento → cliente, UNA vez por cambio de documentos. Antes, por CADA uno de los
  // 13.096 clientes que coincidía se filtraba la lista COMPLETA de documentos (`documentos.filter`
  // dentro del `forEach` de clientes), en cada tecla: era el peor cuello de botella del sistema.
  // Los productos y clientes de /sn se indexan igual, por la misma razón.
  const docsPorCliente = useMemo(() => {
    const m = new Map();
    (SSData.documentos || []).forEach(d => {
      const k = String(d.cliente ?? '');
      if (!k) return;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(d);
    });
    return m;
  }, [SSData.documentos, SSData.documentos?.length]);
  const prodPorSku = useMemo(() => {
    const m = new Map();
    (SSData.productos || []).forEach(p => m.set(p.sku, p));
    return m;
  }, [SSData.productos, SSData.productos?.length]);
  const cliPorId = useMemo(() => {
    const m = new Map();
    (SSData.clientes || []).forEach(c => m.set(c.id, c));
    return m;
  }, [SSData.clientes, SSData.clientes?.length]);

  const items = useMemo(() => {
    const q = qLento;                                  // el barrido usa el texto con freno
    const lower = q.trim().toLowerCase();
    const match = (...fields) => fields.some(f => f && String(f).toLowerCase().includes(lower));

    // Modo /sn — solo resultados de seriales
    if (q.trim().toLowerCase().startsWith('/sn ')) {
      if (!snLookup) return [{ path: '#', kind: '_loading', label: 'Buscando S/N...', sub: q.slice(4), icon: 'check', id: '_loading' }];
      if (snLookup.hits.length === 0) {
        return [{ path: '#', kind: '_empty', label: `Sin coincidencias para "${snLookup.term}"`, sub: 'Verificá el número de serie', icon: 'alert', id: '_empty' }];
      }
      return snLookup.hits.map(s => {
        const prod = prodPorSku.get(s.sku);
        const cli  = cliPorId.get(s.cliente_id);
        const estadoLbl = { disponible: '✓ disponible', vendido: '● vendido', devuelto: '↺ devuelto' }[s.estado] || s.estado;
        const sub = `${estadoLbl} · ${prod?.nombre || s.sku}${cli ? ' · ' + cli.nombre : ''}${s.garantia_vence ? ' · vence ' + s.garantia_vence : ''}`;
        return { path: '#sn', kind: 'Serial', label: s.serial, sub, icon: 'check', id: s.id, data: s };
      });
    }

    if (!lower) return CMD_NAV.slice(0, 10);

    const results = [];
    const PATH_BY_ESTADO = { cotizacion: '/cotizaciones', orden: '/ordenes', factura: '/facturas', despacho: '/despachos' };
    const LABEL_BY_ESTADO = { cotizacion: 'Cotización', orden: 'Orden', factura: 'Factura', despacho: 'Despacho' };
    // Declarado ACÁ (no más abajo, donde vivía antes junto al bloque del server) a propósito: el
    // bloque de documentos EN MEMORIA lo necesita más abajo en el mismo useMemo, y una constante
    // usada antes de su línea de declaración cae en su temporal dead zone — el mismo patrón de bug
    // que ya rompió Seriales (ver inventory.jsx). Acá no había throw porque `kind: 'Documento'`
    // estaba escrito a mano en vez de leer de este mapa, que es justo el bug reportado: los
    // documentos en memoria (90 días) SIEMPRE mostraban el kind genérico "Documento" en vez de su
    // etapa, así que nunca armaban una sección propia (Cotizaciones/Órdenes/Facturas/Despachos) —
    // quedaban todos sueltos bajo cualquier header que hubiera quedado activo antes.
    const KIND_ETAPA = { cotizacion: 'Cotizaciones', orden: 'Órdenes', factura: 'Facturas', despacho: 'Despachos' };
    const shownDocIds = new Set();
    // Documentos que van a terminar agrupados por ETAPA (Cotizaciones/Órdenes/Facturas/Despachos),
    // sin importar si se encontraron buscando el cliente o buscando el documento directamente.
    // Pedido explícito 2026-08-14: antes, los documentos de un cliente colgaban como sub-ítems
    // indentados debajo de ESE cliente (una lista plana, sin organizar por etapa) — funcionaba
    // bien cuando el cliente tenía 2-3 documentos, pero con más se veía exactamente como en el
    // reporte: cotización, factura, factura, orden, sin ningún orden reconocible.
    const docsMemoria = [];

    // Módulos / navegación
    CMD_NAV.forEach(n => {
      if (match(n.label)) results.push(n);
    });

    // Clientes — sus documentos van a las secciones por etapa, no colgando del cliente
    (SSData.clientes || []).forEach(c => {
      if (!match(c.nombre, c.rif, c.email, c.telefono)) return;
      results.push({ path: '/clientes', kind: 'Cliente', label: c.nombre, sub: c.rif || c.email, icon: 'clients', id: c.id });
      (docsPorCliente.get(String(c.id)) || []).forEach(d => {
        if (shownDocIds.has(d.id)) return;
        shownDocIds.add(d.id);
        const estado = d.tipo || d.estado || 'cotizacion';
        docsMemoria.push({
          path: PATH_BY_ESTADO[estado] || '/cotizaciones',
          kind: KIND_ETAPA[estado] || 'Documento',
          label: d.id,
          sub: `${LABEL_BY_ESTADO[estado] || estado} · ${c.nombre}${d.fecha ? ' · ' + d.fecha : ''}${d.total ? ' · $' + Number(d.total).toFixed(2) : ''}`,
          icon: 'doc',
          id: d.id,
          data: d,
          _etapaOrden: ETAPAS.indexOf(estado),
        });
      });
    });

    // Proveedores
    (SSData.proveedores || []).forEach(p => {
      if (match(p.nombre, p.rif, p.email))
        results.push({ path: '/proveedores', kind: 'Proveedor', label: p.nombre, sub: p.rif || p.email, icon: 'suppliers', id: p.id });
    });

    // Productos
    (SSData.productos || []).forEach(p => {
      if (match(p.nombre, p.sku, p.marca, p.categoria, p.descripcion))
        results.push({ path: '/inventario', kind: 'Producto', label: p.nombre, sub: p.sku, icon: 'inventory', id: p.sku });
    });

    // Documentos EN MEMORIA (90 días, cotizaciones/órdenes/facturas/despachos) — sin duplicar los
    // ya juntados arriba por cliente. Se suman al MISMO `docsMemoria` (declarado arriba) para que
    // el orden por etapa se aplique sobre el conjunto completo en un solo `sort` — si cada bloque
    // ordenara el suyo por separado, un cliente con una factura y una cotización en memoria (sin
    // relación con este cliente) podría terminar en dos secciones "Facturas" separadas.
    (SSData.documentos || []).forEach(d => {
      if (shownDocIds.has(d.id)) return;
      const cli = cliPorId.get(d.cliente);
      if (match(d.id, d.estado, d.tipo, cli?.nombre, d.notas, d.nro_despacho)) {
        const estado = d.tipo || d.estado || 'cotizacion';
        docsMemoria.push({
          path: PATH_BY_ESTADO[estado] || '/cotizaciones',
          kind: KIND_ETAPA[estado] || 'Documento',
          label: d.id,
          sub: `${LABEL_BY_ESTADO[estado] || estado}${cli ? ' · ' + cli.nombre : ''}${d.nro_despacho ? ' · Nro. ' + d.nro_despacho : ''}`,
          icon: 'doc',
          id: d.id,
          data: d,
          _etapaOrden: ETAPAS.indexOf(estado),
        });
      }
    });
    docsMemoria.sort((a, b) => a._etapaOrden - b._etapaOrden);
    docsMemoria.forEach(d => { delete d._etapaOrden; shownDocIds.add(d.id); });
    results.push(...docsMemoria);

    // Contactos
    (SSData.contactos || []).forEach(c => {
      if (match(c.nombre, c.empresa, c.email, c.telefono, c.cargo))
        results.push({ path: '/contactos', kind: 'Contacto', label: c.nombre, sub: c.empresa || c.email, icon: 'contact', id: c.id });
    });

    // Cuentas por Cobrar
    (SSData.cuentasCobrar || []).forEach(c => {
      const cli = cliPorId.get(c.cliente_id);
      if (match(c.factura, c.descripcion, cli?.nombre, c.id))
        results.push({ path: '/cxc', kind: 'CxC', label: c.factura || c.id, sub: cli?.nombre || c.descripcion, icon: 'cxc', id: c.id });
    });

    // Cuentas por Pagar
    (SSData.cuentasPagar || []).forEach(c => {
      const prov = (SSData.proveedores || []).find(x => x.id === c.proveedor_id);
      if (match(c.factura, c.descripcion, prov?.nombre, c.id))
        results.push({ path: '/cxp', kind: 'CxP', label: c.factura || c.id, sub: prov?.nombre || c.descripcion, icon: 'cxc', id: c.id });
    });

    // Drivers
    (SSData.drivers || []).forEach(d => {
      if (match(d.nombre, d.cedula, d.placa, d.telefono))
        results.push({ path: '/drivers', kind: 'Driver', label: d.nombre, sub: d.placa || d.cedula, icon: 'truck', id: d.id });
    });

    // Incidencias
    (SSData.incidencias || []).forEach(inc => {
      if (match(inc.id, inc.tipo, inc.descripcion, inc.driver_id))
        results.push({ path: '/incidencias', kind: 'Incidencia', label: inc.id, sub: inc.tipo || inc.descripcion?.slice(0, 50), icon: 'bell', id: inc.id });
    });

    // Devoluciones
    (SSData.devoluciones || []).forEach(d => {
      const cli = cliPorId.get(d.cliente_id);
      if (match(d.id, d.factura_id, d.motivo, cli?.nombre))
        results.push({ path: '/devoluciones', kind: 'Devolución', label: d.id, sub: `${d.factura_id}${cli ? ' · ' + cli.nombre : ''}`, icon: 'arrDn', id: d.id });
    });

    // ── Documentos del server, UN BLOQUE POR ETAPA ────────────────────────────────────────────
    // Cada etapa es su propio grupo ("Cotizaciones", "Órdenes", "Facturas", "Despachos") con hasta
    // 5 documentos y, si hay más, una fila "Ver las N …" que abre el módulo con la búsqueda ya
    // puesta. Antes iban todos mezclados bajo "Documento" y el corte a 20 resultados los tapaba con
    // los clientes y productos que coincidían — con un cliente de 500 documentos no se veía ninguno.
    const PLURAL_ETAPA = { cotizacion: 'cotizaciones', orden: 'órdenes', factura: 'facturas', despacho: 'despachos' };
    const docsSection = [];
    if (docLookup && docLookup.term === q.trim() && docLookup.hits.length) {
      const porTipo = { cotizacion: [], orden: [], factura: [], despacho: [] };
      docLookup.hits.forEach(d => {
        // `shownDocIds` ya trae los IDs mostrados como sub-ítem de un cliente Y los de la
        // memoria (docsMemoria, arriba) — evita mostrar el mismo documento dos veces con dos
        // kinds distintos si el server lo vuelve a encontrar.
        if (shownDocIds.has(d.id)) return;
        const t = porTipo[d.tipo] ? d.tipo : 'cotizacion';
        porTipo[t].push(d);
      });
      ETAPAS.forEach(t => {
        const arr = porTipo[t];
        if (!arr.length) return;
        arr.slice(0, POR_ETAPA).forEach(d => {
          const cli = cliPorId.get(d.cliente_id);
          const muerto = d.estado === 'cancelada' || d.estado === 'anulada';
          docsSection.push({
            path: PATH_BY_ESTADO[t],
            kind: KIND_ETAPA[t],
            label: d.id,
            sub: `${cli ? cli.nombre + ' · ' : ''}${d.fecha || ''}`
               + `${d.total ? ' · $' + Number(d.total).toFixed(2) : ''}`
               + `${muerto ? ' · ' + d.estado.toUpperCase() : ''}`,
            icon: 'doc',
            id: d.id,
            data: { ...d, cliente: d.cliente_id, total: parseFloat(d.total) || 0, lines: [] },
          });
        });
        // El total sale del `count:'exact'` de la consulta por cliente; si el documento entró por
        // número (no hay conteo) se informa lo que se trajo, sin inventar un total que no se midió.
        const total = docLookup.totales?.[t] || 0;
        if (total > POR_ETAPA) {
          docsSection.push({
            path: PATH_BY_ESTADO[t], kind: KIND_ETAPA[t],
            label: `Ver las ${total} ${PLURAL_ETAPA[t]}`,
            sub: `Abre el módulo buscando "${docLookup.term}"`,
            icon: 'arrRt', id: '_todas_' + t, verTodas: { stage: t, search: docLookup.term },
          });
        }
      });
    }

    // Los documentos van SIEMPRE, no compiten por el corte con clientes/productos: eran justo lo
    // que el usuario venía a buscar y lo que no aparecía.
    return [...results.slice(0, 12), ...docsSection];
  }, [qLento, snLookup, docLookup, docsPorCliente, prodPorSku, cliPorId, tick]);

  useEffect(() => { setSel(0); }, [q]);
  // Colapsar/expandir una sección — declarado ACÁ, antes del `if (!open) return null` de abajo, a
  // propósito: React exige llamar los mismos hooks en el MISMO ORDEN en cada render. Este useState
  // vivía después del early-return, así que con la paleta cerrada (`open=false`) el componente
  // devolvía antes de llamarlo, y al abrirla (`open=true`) sí lo llamaba — dos renders con distinta
  // cantidad de hooks, que es EXACTAMENTE el error #310 de React ("Rendered more hooks than during
  // the previous render") reportado en producción el 2026-08-14.
  const [collapsed, setCollapsed] = React.useState(() => new Set());
  // Una búsqueda nueva empieza con todas las secciones abiertas — colapsar es para la que se está
  // mirando ahora, no una preferencia que deba sobrevivir a cambiar de término.
  React.useEffect(() => { setCollapsed(new Set()); }, [q]);

  if (!open) return null;

  function goToItem(item) {
    if (item.kind === '_loading' || item.kind === '_empty') return;

    // BR-INV/M-02: S/N → ir a inventario y abrir detalle del producto en tab Seriales.
    // Se deja el dato en un global y NO se dispara ningún evento: InventoryPage lo lee en su
    // efecto de montaje (mismo patrón que 'ss-inv-open-transfer'). Un evento con setTimeout(0)
    // perdía la carrera contra el remount cuando ya se estaba en /inventario — ver inventory.jsx.
    if (item.kind === 'Serial' && item.data) {
      window.__ssOpenSerialInventario = { sku: item.data.sku, serial: item.data.serial };
      navigate('/inventario');
      setOpen(false);
      return;
    }

    // "Ver las N cotizaciones de …": abre el módulo con la búsqueda ya escrita. Se pasa por una
    // variable global porque `navigate` no lleva estado; DocumentList la consume una sola vez.
    if (item.verTodas) {
      window.__ssDocListPreset = item.verTodas;
      navigate(item.path);
      setOpen(false);
      return;
    }

    if (item.data && (item.icon === 'doc')) {
      window.__ssPosOpenDoc = item.data;
    } else if (item.id) {
      window.__ssCmdNav = { kind: item.kind, id: item.id, label: item.label };
    }
    navigate(item.path);
    if (item.data && (item.icon === 'doc')) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('ss-open-doc', { detail: item.data }));
      }, 0);
    }
    setOpen(false);
  }

  function handleKey(e) {
    if (e.key === 'Escape') setOpen(false);
    // Navega sobre `visibleIndices`, no sobre `items` directo — si no, con una sección colapsada
    // el cursor podía quedar parado en una fila que no se ve.
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const pos = visibleIndices.indexOf(sel);
      const next = visibleIndices[Math.min(visibleIndices.length - 1, pos + 1)];
      if (next !== undefined) setSel(next);
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const pos = visibleIndices.indexOf(sel);
      const prev = visibleIndices[Math.max(0, pos - 1)];
      if (prev !== undefined) setSel(prev);
    }
    if (e.key === 'Enter' && items[sel]) { goToItem(items[sel]); }
  }

  // Group by kind for display — SubDoc items never start a section. Por CONTIGÜIDAD, no por un
  // Set de "ya visto": con un Set, un mismo kind que reaparece más abajo (p. ej. Facturas del
  // server después de Facturas en memoria, separadas por otro tipo de resultado en el medio) no
  // abría un header nuevo y esas filas quedaban colgando bajo el header de OTRA sección — lo que
  // se vería como "documentos sin organizar". Con el corte por cambio de kind, cada tramo contiguo
  // consigue su propio header, aunque el kind se repita más abajo.
  const groups = [];
  let lastKind = null;
  items.forEach((item, i) => {
    if (item.kind === 'SubDoc') return;
    if (item.kind !== lastKind) { groups.push({ kind: item.kind, startIdx: i }); lastKind = item.kind; }
  });
  // Grupo dueño de cada índice (el header y todo lo que sigue hasta el próximo header). Los SubDoc
  // heredan el grupo de la fila de la que cuelgan.
  function grupoDe(i) {
    let g = null;
    for (const gr of groups) { if (gr.startIdx <= i) g = gr; else break; }
    return g;
  }
  // Colapsar/expandir una sección — pedido explícito 2026-08-14 ("secciones colapsables por
  // cotizaciones, órdenes, facturas, despachos"). Clave = startIdx (no el kind): si el mismo kind
  // aparece dos veces (ver comentario de arriba) cada tramo colapsa por su cuenta.
  // (El useState y el useEffect que arman `collapsed` viven ARRIBA del `if (!open) return null` —
  // ver el comentario ahí.)
  function toggleGroup(startIdx) {
    setCollapsed(prev => { const n = new Set(prev); n.has(startIdx) ? n.delete(startIdx) : n.add(startIdx); return n; });
  }
  // Índices realmente visibles (los headers siempre se ven; se esconden las FILAS de un grupo
  // colapsado). La navegación con flechas usa esta lista, no `items` directo, para no dejar el
  // cursor parado en una fila que no se ve.
  const visibleIndices = items.map((_, i) => i).filter(i => {
    const g = grupoDe(i);
    if (g && g.startIdx === i) return true; // el header de la sección nunca se oculta
    return !(g && collapsed.has(g.startIdx));
  });

  return (
    <div className="cmdk-overlay" onClick={() => setOpen(false)}>
      <div className="cmdk-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'center', padding:'0 14px', borderBottom:'1px solid var(--border)' }}>
          <Icon name="search" size={15} style={{ color:'var(--text-muted)', flexShrink:0 }}/>
          <input
            ref={inputRef}
            className="cmdk-input"
            style={{ border:'none', outline:'none', flex:1, paddingLeft:10 }}
            placeholder="Buscar en todos los módulos…  (tip: /sn SN-XXXX para buscar por número de serie)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={handleKey}
          />
          {q && (
            <button style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', padding:'0 2px' }} onClick={() => setQ('')}>
              <Icon name="x" size={14}/>
            </button>
          )}
          <span style={{ fontSize:11, color:'var(--text-muted)', marginLeft:8, flexShrink:0 }}>ESC</span>
        </div>
        <div className="cmdk-list">
          {items.length === 0 && (
            <div style={{ padding:'32px 16px', textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>
              Sin resultados para "{q}"
            </div>
          )}
          {items.map((item, i) => {
            const grp = groups.find(g => g.startIdx === i);
            // Fila (no header) de un grupo colapsado: se esconde. El header de la sección se ve
            // siempre — si no, no habría forma de volver a abrirla.
            const grupoFila = grupoDe(i);
            if (!grp && grupoFila && collapsed.has(grupoFila.startIdx)) return null;
            return (
              <React.Fragment key={i}>
                {grp && (
                  <div
                    onClick={() => toggleGroup(grp.startIdx)}
                    style={{ display:'flex', alignItems:'center', gap:5, padding:'8px 14px 4px', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-muted)', cursor:'pointer', userSelect:'none' }}
                  >
                    <Icon name={collapsed.has(grp.startIdx) ? 'chevronR' : 'chevronD'} size={10}/>
                    <span>{grp.kind === 'Módulo' && !q ? 'Navegación' : grp.kind}</span>
                  </div>
                )}
                {!collapsed.has(grp?.startIdx ?? -1) && (
                  <div
                    className={`cmdk-item ${i === sel ? 'sel' : ''}`}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => goToItem(item)}
                    style={item.isSubItem ? { paddingLeft: 32 } : undefined}
                  >
                    {item.isSubItem && (
                      <span style={{ color:'var(--text-muted)', fontSize:12, marginRight:4, flexShrink:0, lineHeight:1 }}>↳</span>
                    )}
                    <Icon name={item.icon || CMD_ICON[item.kind] || 'chevronR'} size={14} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.label}</div>
                      {item.sub && <div style={{ fontSize:11, color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.sub}</div>}
                    </div>
                    <span className="cmdk-kind">{item.isSubItem ? 'Documento' : item.kind}</span>
                  </div>
                )}
              </React.Fragment>
            );
          })}
          {!q && (
            <div style={{ padding:'10px 14px', fontSize:11, color:'var(--text-muted)', borderTop:'1px solid var(--border)', textAlign:'center' }}>
              {(SSData.clientes?.length||0)} clientes · {(SSData.productos?.length||0)} productos · {(SSData.documentos?.length||0)} documentos cargados
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function BCVRatePopup({ bcvValue, onClose }) {
  React.useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  React.useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="bcv-popup-overlay" onClick={onClose} role="alertdialog" aria-modal="true" aria-label="Tasa BCV actualizada">
      <div className="bcv-popup-card" onClick={e => e.stopPropagation()}>
        <button className="bcv-popup-close" onClick={onClose} title="Cerrar">
          <Icon name="x" size={16} />
        </button>
        <p className="bcv-title">¡Tasa BCV actualizada!</p>
        <span className="bcv-value" aria-live="assertive">Bs. {trunc2(bcvValue)}</span>
        <p className="bcv-label">tasa oficial del día</p>
        <div className="bcv-popup-timer"><div className="bcv-popup-timer-bar" /></div>
      </div>
    </div>
  );
}

Object.assign(window, {
  Sidebar: window.Sidebar,
  ConfigSidebar: window.ConfigSidebar,
  TasaModal: window.TasaModal,
  TopBar: window.TopBar,
  CmdPalette: window.CmdPalette,
});
