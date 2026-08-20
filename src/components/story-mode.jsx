// ══════════════════════════════════════════════════════════════════
// Modo Historia — tutorial guiado / onboarding transversal
// Widget abajo-izquierda + barra inferior con línea de tiempo. Recorre el
// sistema paso a paso, navegando a cada página y explicando cómo funciona.
// Se apaga desde Ajustes → Sistema (configuracion_sistema.modo_historia_activo).
// ══════════════════════════════════════════════════════════════════
const { useState, useEffect, useRef, useCallback } = React;

// Los pasos del recorrido. Cada uno: { route, title, body, icon?, target? }
// (target = selector CSS opcional a resaltar en esa página). Definidos en
// window.__SS_STORY_STEPS para poder ampliarlos; fallback al set embebido.
const _FALLBACK_STEPS = [
  {
    "route": "/pos",
    "title": "Bienvenida",
    "body": "¡Hola! Bienvenido al Modo Historia, un recorrido guiado que te presenta cada página del sistema explicándote, en palabras sencillas, qué es y para qué sirve. Usa el botón Siguiente para avanzar y Anterior para volver; cuando quieras cerrar el tutorial, presiona Salir. También puedes tocar cualquier punto de la línea de tiempo para saltar directo al paso que te interese.",
    "icon": "info"
  },
  {
    "route": "/asistente",
    "title": "Asistente IA",
    "body": "Es un chat inteligente que lee toda tu base de datos en vivo y te responde con tablas y detalle, por ejemplo \"¿Qué clientes me deben y cuánto?\" o \"Productos bajo stock mínimo\". Escribe tu pregunta en la caja de abajo y presiona Enter para enviar (Shift+Enter para salto de línea), o toca una de las sugerencias para empezar rápido. Trabaja en modo solo lectura, así que nunca modifica tus datos; aun así, verifica las cifras críticas antes de decidir.",
    "icon": "chart"
  },
  {
    "route": "/pos",
    "title": "POS / Punto de Venta",
    "body": "Aquí nace cada venta. Escoges el cliente, eliges la modalidad de pago (divisas, BCV con cobertura, BCV fijo o paralelo) y armas el carrito buscando por nombre, SKU o marca. Cuando el pedido está listo, lo guardas como cotización o lo confirmas como orden con el botón 'Convertir a Orden'.",
    "icon": "pos"
  },
  {
    "route": "/pos",
    "title": "Torre de IA",
    "body": "Esa pestaña morada a la derecha es la Torre de IA: un asistente que analiza el módulo en el que estás parado — en vivo, contra tus datos reales — y te deja insights concretos con una acción para aplicar (por ejemplo, \"3 cotizaciones sin convertir\" con un botón para recordarle al cliente). Tócala para desplegarla; ahí abajo también hay un mini-chat para preguntarle directamente sobre lo que estás viendo. No es una pantalla más: aparece en Punto de Venta, Inventario, Cuentas por Cobrar y Pagar, Bancos, Clientes, Proveedores, Reportes, Comisiones y Dropshipping — cada una con su propio análisis.",
    "icon": "chart",
    "target": ".ai-tower-tab"
  },
  {
    "route": "/cotizaciones",
    "title": "Cotizaciones",
    "body": "Esta es la lista de tus cotizaciones, es decir, las propuestas de venta que todavía no están confirmadas. Usa el buscador (cliente, RIF, ID o vendedor) y los filtros para encontrar la que necesitas, y marca 'Mostrar canceladas' si quieres ver también las anuladas. Haz clic en una para abrirla y convertirla en Orden de Venta.",
    "icon": "doc"
  },
  {
    "route": "/ordenes",
    "title": "Órdenes de Venta",
    "body": "Aquí ves las órdenes ya confirmadas, listas para facturar. A diferencia de una cotización, una orden reserva el stock del inventario para que no se venda dos veces. Abre cualquier orden y usa 'Generar Factura' para avanzar al siguiente paso del flujo.",
    "icon": "receipt"
  },
  {
    "route": "/facturas",
    "title": "Facturas",
    "body": "Esta pantalla reúne las facturas emitidas. Al abrir una, el navegador de linaje (Cotización → Orden → Factura → Despacho) te deja saltar entre los documentos relacionados, y el pipeline muestra el estado real de cada paso: si el cobro está pendiente, parcial o pagado, y si ya se despachó. Así sabes de un vistazo qué falta por cobrar o entregar.",
    "icon": "receipt"
  },
  {
    "route": "/despachos",
    "title": "Notas de Despacho",
    "body": "El despacho representa la entrega física de la mercancía. Muestra los productos de la factura pero sin montos, porque es un documento de almacén, no de cobro. Aquí controlas el estado de la entrega (por ejemplo pendiente, despachado o entregado) y puedes filtrar por tipo de entrega y estado de envío.",
    "icon": "truck"
  },
  {
    "route": "/inventario",
    "title": "Inventarios",
    "body": "Este es tu catálogo de productos con el stock disponible en cada almacén. Puedes buscar por nombre, SKU o marca, filtrar por categoría, marca o nivel de stock, y alternar entre vista de tarjetas y lista. Haz clic en cualquier producto para ver su detalle completo (stock por almacén, movimientos, precios y seriales), y usa los botones para registrar ajustes de inventario o transferencias entre almacenes. Fíjate en la Torre de IA a la derecha: ya te dejó cuántos productos están por debajo del mínimo y una sugerencia de traspaso entre almacenes.",
    "icon": "inventory"
  },
  {
    "route": "/inventario/movimientos",
    "title": "Movimientos de Inventario",
    "body": "Aquí está el kardex: el historial de cada entrada, salida, transferencia, devolución y ajuste de tu inventario. Elige el período con los filtros de fecha (hoy, semana, mes o un rango exacto) y filtra por tipo de movimiento o almacén. Puedes agrupar los movimientos por producto, almacén o usuario, y cada línea muestra el documento de referencia (factura o nota de despacho) que lo originó.",
    "icon": "chart"
  },
  {
    "route": "/precios",
    "title": "Listas de Precios",
    "body": "En esta página administras las listas de precios asociadas a cada tipo de cliente: mayorista, instalador, distribuidor, retail y más. Selecciona una lista para ver los precios y el descuento que aplica sobre el precio base, o define precios manuales producto por producto. Usa el botón para crear una nueva lista y asignarle los clientes que la usarán.",
    "icon": "price"
  },
  {
    "route": "/vendedores",
    "title": "Vendedores",
    "body": "Aquí gestionas tu equipo comercial. Cada fila muestra un vendedor con su zona, cantidad de clientes, órdenes, ventas del año y el porcentaje de comisión que gana. Haz clic en un vendedor para ver su detalle, o usa \"Nuevo vendedor\" para agregar a alguien al equipo.",
    "icon": "users"
  },
  {
    "route": "/clientes",
    "title": "Clientes",
    "body": "Esta es tu base de clientes. Con \"Nuevo cliente\" registras uno indicando el nombre en mayúsculas, su RIF, el tipo de cliente (que define su lista de precios) y una persona de contacto obligatoria. Al hacer clic en una fila abres su ficha completa, con pestañas de Información, Compras, Cuentas por cobrar y Vueltos. Arriba tienes buscador por nombre o RIF, filtro por tipo y botón para exportar.",
    "icon": "clients"
  },
  {
    "route": "/contactos",
    "title": "Contactos",
    "body": "Aquí viven las personas de contacto asociadas a tus clientes (y proveedores): nombre, cargo, teléfono y correo. Usa \"Nuevo contacto\" para agregar una persona y vincularla a su cliente, y el filtro por cliente o el buscador para encontrarla rápido. También puedes darle acceso al portal y exportar la lista.",
    "icon": "contact"
  },
  {
    "route": "/proveedores",
    "title": "Proveedores",
    "body": "Este módulo reúne a quienes te venden mercancía. Al abrir la ficha de un proveedor ves su Información y la pestaña \"Órdenes de compra\", con todas las órdenes que le has generado. Desde aquí creas proveedores nuevos y das seguimiento a las compras y recepciones que haces a cada uno.",
    "icon": "suppliers"
  },
  {
    "route": "/cxc",
    "title": "Cuentas por Cobrar",
    "body": "Aquí ves todo lo que tus clientes te deben. Usa las pestañas Pendientes y Cobrados para separar las facturas por saldar de las ya pagadas, y arriba verás el total pendiente, lo vencido y el porcentaje ya cobrado. Puedes buscar por cliente, factura o RIF, agrupar la tabla por cliente, modalidad o estado, y al abrir un cliente registrar un cobro que descuenta su deuda. La Torre de IA de la derecha ya priorizó qué cuentas vencidas cobrar primero — el mismo monto que ves en las tarjetas de arriba, calculado en vivo.",
    "icon": "cxc"
  },
  {
    "route": "/cxp",
    "title": "Cuentas por Pagar",
    "body": "Esta página es el reflejo de la anterior: muestra lo que tú le debes a tus proveedores. Igual que en CxC, tienes pestañas de pendientes y pagadas, totales, búsqueda y agrupación para organizar las deudas. Al entrar en un proveedor puedes registrar un pago y así ir saldando lo que le adeudas.",
    "icon": "cxc"
  },
  {
    "route": "/banco",
    "title": "Conciliación Bancaria",
    "body": "Aquí ves todas tus cuentas bancarias con su saldo disponible y el consolidado en dólares y en bolívares. Cada tarjeta muestra cuántos movimientos tiene sin conciliar; haz clic en una cuenta para ver su detalle y marcar cada movimiento como conciliado contra tus pagos. También puedes importar el estado de cuenta del banco y crear nuevas cuentas con los botones de arriba.",
    "icon": "bank"
  },
  {
    "route": "/reportes",
    "title": "Reportes Dinámicos",
    "body": "Esta es tu tabla pivote: aquí construyes reportes de ventas a tu medida sin depender de nadie. Eliges las dimensiones que quieres cruzar (mes, vendedor, cliente, producto, marca, categoría…) y las medidas que quieres ver (monto en USD o VES, número de documentos, unidades, promedio por documento, % de margen). Puedes partir de un preset como \"Ventas por vendedor\" y luego guardar tu propia configuración para volver a ella cuando quieras.",
    "icon": "chart"
  },
  {
    "route": "/comisiones",
    "title": "Comisiones de Ventas",
    "body": "Aquí se calcula cuánto le corresponde a cada vendedor por sus ventas. El sistema toma los documentos facturados, aplica la base sin IVA (y descuenta la cobertura cuando el pago es en BCV) y calcula la comisión según el margen real de cada venta. Puedes seleccionar los documentos pendientes y marcarlos como pagados para llevar el control de lo que ya se liquidó.",
    "icon": "dollar"
  },
  {
    "route": "/drivers",
    "title": "Drivers",
    "body": "En esta página administras a tus repartidores (drivers) y ves los despachos que tiene asignado cada uno. Usa el botón para crear un driver con su nombre, cédula y zona, y al entrar a cada uno verás sus entregas pendientes, completadas e incidencias. Es tu control central de la logística de entrega en la calle.",
    "icon": "truck"
  },
  {
    "route": "/devoluciones",
    "title": "Devoluciones",
    "body": "Aquí registras cuando un cliente devuelve una venta. Pulsa \"Nueva devolución\" y sigue el asistente paso a paso: buscas la factura original, eliges qué productos regresan, indicas el motivo y el reembolso (banco y referencia). La lista te deja buscar por ID, factura o cliente para dar seguimiento a cada caso.",
    "icon": "arrDn"
  },
  {
    "route": "/garantias",
    "title": "Garantías",
    "body": "Este módulo maneja los reclamos de garantía (RMA) asociados a los seriales que vendiste. En la pestaña \"Seriales en garantía\" ves qué equipos siguen cubiertos y su vencimiento, y desde ahí puedes abrir un reclamo; en las pestañas Pendientes, Resueltas y Reclamos les das seguimiento hasta cerrarlos como aprobado, reemplazo, reembolso o rechazado. Usa \"Nueva garantía\" para registrar un caso a mano.",
    "icon": "check"
  },
  {
    "route": "/pos",
    "title": "¡Listo!",
    "body": "¡Felicitaciones! Ya recorriste las páginas principales de Distribuidora Demo y tienes una idea clara de para qué sirve cada una. Explora con confianza: siempre puedes reiniciar este tutorial cuando quieras repasar algo. Y si prefieres no verlo más, un administrador puede apagarlo desde Ajustes → Sistema.",
    "icon": "check"
  }
];

function _steps() {
  const s = window.__SS_STORY_STEPS;
  return (Array.isArray(s) && s.length) ? s : _FALLBACK_STEPS;
}

const _HL_CLASS = 'ss-story-highlight';
function _clearHighlight() {
  document.querySelectorAll('.' + _HL_CLASS).forEach(el => el.classList.remove(_HL_CLASS));
}
function _applyHighlight(selector) {
  _clearHighlight();
  if (!selector) return;
  let tries = 0;
  const tryFind = () => {
    const el = document.querySelector(selector);
    if (el) {
      el.classList.add(_HL_CLASS);
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_e) {}
    } else if (tries++ < 6) {
      setTimeout(tryFind, 350);   // la página puede estar cargando su chunk todavía
    }
  };
  setTimeout(tryFind, 300);
}

window.StoryMode = function StoryMode() {
  const enabled = (window.getEmpresaConfig ? window.getEmpresaConfig().modo_historia_activo !== false : true);
  const [running, setRunning] = useState(false);
  const [idx, setIdx] = useState(0);
  const [hidden, setHidden] = useState(false);   // ocultar el widget es solo por sesión (reaparece al recargar)
  const steps = _steps();
  const step = steps[Math.min(idx, steps.length - 1)];

  // Exponer un lanzador global (para el header u otros lugares).
  useEffect(() => {
    window.__ssStartStoryMode = () => { setIdx(0); setRunning(true); };
    return () => { if (window.__ssStartStoryMode) delete window.__ssStartStoryMode; };
  }, []);

  // Al entrar a un paso: navegar a su ruta y resaltar el objetivo.
  useEffect(() => {
    if (!running || !step) return;
    if (step.route && window.__ssNavigate) window.__ssNavigate(step.route);
    _applyHighlight(step.target);
    try { localStorage.setItem('ss-story-step', String(idx)); } catch (_e) {}
    return () => _clearHighlight();
  }, [running, idx]);

  function start() { setIdx(0); setRunning(true); }
  function exit() { setRunning(false); _clearHighlight(); }
  function next() { if (idx < steps.length - 1) setIdx(i => i + 1); else exit(); }
  function prev() { if (idx > 0) setIdx(i => i - 1); }

  if (!enabled) return null;

  // Widget lanzador (abajo-izquierda) cuando no está corriendo.
  if (!running) {
    if (hidden) return null;
    return (
      <div className="ss-story-launcher">
        <button className="ss-story-launch-btn" onClick={start} title="Iniciar tutorial guiado del sistema">
          <span className="ss-story-launch-icon"><Icon name="info" size={18} /></span>
          <span className="ss-story-launch-text">Modo Historia<br/><small>Tutorial guiado</small></span>
        </button>
        <button className="ss-story-launch-close" title="Ocultar" onClick={() => { setHidden(true); try { localStorage.setItem('ss-story-launcher-hidden', '1'); } catch (_e) {} }}>
          <Icon name="x" size={12} />
        </button>
      </div>
    );
  }

  // Barra inferior con línea de tiempo + paso actual.
  const pct = steps.length > 1 ? (idx / (steps.length - 1)) * 100 : 100;
  return (
    <div className="ss-story-bar">
      <div className="ss-story-timeline">
        <div className="ss-story-track"><div className="ss-story-track-fill" style={{ width: pct + '%' }} /></div>
        <div className="ss-story-dots">
          {steps.map((s, i) => (
            <button key={i} className={'ss-story-dot ' + (i === idx ? 'current' : i < idx ? 'done' : '')}
              title={s.title} onClick={() => setIdx(i)} />
          ))}
        </div>
      </div>
      <div className="ss-story-body">
        <div className="ss-story-step-icon"><Icon name={step.icon || 'info'} size={20} /></div>
        <div className="ss-story-step-text">
          <div className="ss-story-step-title">
            {step.title}
            <span className="ss-story-counter">Paso {idx + 1} de {steps.length}</span>
          </div>
          <div className="ss-story-step-body">{step.body}</div>
        </div>
        <div className="ss-story-actions">
          <button className="btn ghost sm" onClick={prev} disabled={idx === 0}><Icon name="chevronL" size={14} />Anterior</button>
          <button className="btn primary sm" onClick={next}>{idx === steps.length - 1 ? 'Finalizar' : 'Siguiente'}{idx < steps.length - 1 && <Icon name="chevronR" size={14} />}</button>
          <button className="ss-story-exit" onClick={exit} title="Salir del tutorial"><Icon name="x" size={16} /></button>
        </div>
      </div>
    </div>
  );
};
