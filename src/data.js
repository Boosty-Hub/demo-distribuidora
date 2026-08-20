// SSData — estructura inicial vacía. Se hidrata desde Supabase via loadAppData (supabase.js).
// No contiene datos mock. Cualquier dato real proviene de la base de datos.
window.SSData = {
  // Catálogos / data per-empresa (vienen de Supabase)
  almacenes: [],
  locaciones: {},          // { [almacen_id]: ['A-01-01', ...] } — derivado o desde tabla locaciones
  categorias: [],          // derivado de productos.categoria
  marcas: [],              // derivado de productos.marca
  tiposCliente: [],
  productos: [],
  inventario: {},          // { [sku]: { [almacen_id]: { cantidad, reservado, locacion, minimo, maximo } } }
  listasPrecios: [],
  clientes: [],
  proveedores: [],
  vendedores: [],
  contactos: [],
  documentos: [],
  cuentasCobrar: [],
  cuentasPagar: [],
  ordenesCompra: [],
  cuentasBancarias: [],
  movsBancarios: [],

  // POS — opciones configurables
  fuentesVenta: [],
  tiposEntrega: [],

  // Roles y permisos (desde Supabase tabla roles)
  roles: [],

  // Campos y validaciones por módulo (desde Supabase tabla campos_config)
  camposConfig: {},

  // Multi-tenant compartido
  usuarios: [],
  canalesChat: [],
  mensajesChat: {},        // { [canal_id]: [{id, user, ts, text}, ...] }

  // Tasa BCV/paralelo (compartida cross-empresa)
  // `cobertura: null` = todavía no llegó la tasa del server. NO poner un número acá: el POS lo
  // usaría para poner precios (pasó: cotizaciones con 15% cuando el sistema estaba en 35%).
  tasa: { fecha: '', bcv: 0, paralelo: 0, cobertura: null },

  // Drivers / incidencias / devoluciones se inicializan en sus respectivos componentes
  // (ver drivers.jsx y returns.jsx) — actualmente usan localStorage.
};
