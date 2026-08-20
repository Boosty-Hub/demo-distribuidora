// Torre de IA — panel contextual que "opera" dentro de cada módulo principal.
//
// Es la pieza más vendedora de la demo: un asistente que parece estar analizando el módulo en
// vivo (stock, cartera, cotizaciones…) y proponiendo acciones concretas. Todo lo que dice es
// SCRIPTED — no hay ningún modelo detrás — pero los números que puede leer de forma barata
// (quiebres de stock, cartera vencida) los calcula de verdad contra `window.SSData`, así las
// cifras cambian si el dataset cambia y no se sienten de cartón.
//
// Se monta UNA sola vez en app-bootstrap.jsx (como BusyOverlay/StoryMode) y decide sola en qué
// módulos tiene sentido aparecer, mirando el `pathname` actual.
(function () {
  const { useState, useEffect, useMemo } = React;

  function usd(n) { return window.fmt?.usd ? window.fmt.usd(n) : ('$' + Math.round(n).toLocaleString('en-US')); }

  // ── Métricas baratas contra SSData (mismo dataset que ve el módulo real) ────
  // OJO: misma fórmula que `bajoStockCount` en inventory.jsx (disponible = suma de cantidad en
  // todos los almacenes, contra el `minimo` GLOBAL del producto, no el de cada fila de almacén) —
  // a propósito, para que el número que dice la IA nunca contradiga al que ya muestra el módulo.
  function stockStats() {
    const inv = window.SSData?.inventario || {};
    const productos = Array.isArray(window.SSData?.productos) ? window.SSData.productos : [];
    let bajoMinimo = 0, sinStock = 0;
    productos.forEach(p => {
      const min = Number(p.minimo) || 0;
      if (min <= 0) return;
      const filas = inv[p.sku];
      const total = filas ? Object.values(filas).reduce((s, r) => s + (r.cantidad || 0), 0) : 0;
      if (total <= 0) sinStock++;
      if (total <= min) bajoMinimo++;
    });
    return { bajoMinimo, sinStock };
  }
  function cxcStats() {
    const rows = Array.isArray(window.SSData?.cuentasCobrar) ? window.SSData.cuentasCobrar : [];
    const vencidas = rows.filter(r => r.estado === 'vencida');
    const monto = vencidas.reduce((s, r) => s + Math.max(0, (r.monto || 0) - (r.pagado || 0)), 0);
    const altoRiesgo = vencidas.filter(r => (r.dias || 0) > 30).length;
    return { count: vencidas.length, monto, altoRiesgo, total: rows.length };
  }
  function cxpStats() {
    const rows = Array.isArray(window.SSData?.cuentasPagar) ? window.SSData.cuentasPagar : [];
    const vencidas = rows.filter(r => r.estado === 'vencida');
    const monto = vencidas.reduce((s, r) => s + Math.max(0, (r.monto || 0) - (r.pagado || 0)), 0);
    return { count: vencidas.length, monto };
  }
  function bancoStats() {
    const rows = Array.isArray(window.SSData?.movsBancarios) ? window.SSData.movsBancarios : [];
    const sinConciliar = rows.filter(r => !r.conciliado).length;
    return { sinConciliar, total: rows.length };
  }
  function docStats() {
    const docs = Array.isArray(window.SSData?.documentos) ? window.SSData.documentos : [];
    const cotSinConvertir = docs.filter(d => d.tipo === 'cotizacion' && !d.has_child).length;
    const despachosPendientes = docs.filter(d => d.tipo === 'factura' && d.estado_despacho === 'pendiente').length;
    return { cotSinConvertir, despachosPendientes, cargado: docs.length > 0 };
  }

  // ── Config por módulo: label + icono + generador de insights (se recalcula por módulo) ──
  const MODULES = {
    pos: {
      label: 'Punto de Venta', icon: 'pos',
      build() {
        const d = docStats();
        return [
          {
            id: 'pos-seg', tone: d.cotSinConvertir > 0 ? 'warn' : 'good', tag: 'Seguimiento', icon: 'clock',
            title: d.cargado && d.cotSinConvertir > 0 ? `${d.cotSinConvertir} cotizaciones sin convertir` : 'Cotizaciones bajo control',
            detail: d.cargado && d.cotSinConvertir > 0
              ? `Hay ${d.cotSinConvertir} cotizaciones abiertas que todavía no pasaron a orden. Después del 5º día sin respuesta, la tasa de cierre histórica cae a la mitad — vale la pena un recordatorio.`
              : 'No detecto cotizaciones estancadas en este momento — buen ritmo de seguimiento del equipo de ventas.',
            action: d.cargado && d.cotSinConvertir > 0 ? 'Sugerir recordatorio a clientes' : null,
          },
          {
            id: 'pos-combo', tone: 'good', tag: 'Venta cruzada', icon: 'chart',
            title: 'Producto complementario sugerido',
            detail: 'En las facturas que llevan el producto más vendido del mes, el 4 de cada 10 también se llevó un accesorio relacionado — pero hoy ese combo casi no aparece en las cotizaciones nuevas.',
            action: 'Activar sugerencia en el compositor',
          },
          {
            id: 'pos-tasa', tone: 'info', tag: 'Precio', icon: 'dollar',
            title: 'Sensibilidad a la tasa detectada',
            detail: 'Un grupo de clientes frecuentes cierra casi siempre que se cotiza en Divisas USD y se enfría cuando se cotiza en BCV+. Ya lo marqué para que el vendedor lo tenga en cuenta al elegir modalidad.',
            action: null,
          },
        ];
      },
    },
    inventory: {
      label: 'Inventario', icon: 'inventory',
      build() {
        const s = stockStats();
        return [
          {
            id: 'inv-min', tone: s.bajoMinimo > 0 ? 'warn' : 'good', tag: 'Quiebre de stock', icon: 'box',
            title: s.bajoMinimo > 0 ? `${s.bajoMinimo} productos cerca del mínimo` : 'Niveles de stock saludables',
            detail: s.bajoMinimo > 0
              ? `${s.bajoMinimo} SKUs están en o por debajo de su mínimo configurado${s.sinStock ? `, y ${s.sinStock} ya están en cero` : ''}. Al ritmo de venta reciente, algunos se agotan antes de que llegue la próxima orden de compra.`
              : 'Ningún producto está tocando su mínimo configurado en este momento.',
            action: s.bajoMinimo > 0 ? 'Generar sugerencia de reposición' : null,
          },
          {
            id: 'inv-traspaso', tone: 'info', tag: 'Traspaso sugerido', icon: 'truck',
            title: 'Desbalance entre almacenes',
            detail: 'Encontré SKUs con stock alto en un almacén y bajo (o en cero) en otro. Cubrir la sucursal más chica con un traspaso interno sale más rápido y más barato que comprarle al proveedor.',
            action: 'Ver traspasos sugeridos',
          },
          {
            id: 'inv-rot', tone: 'info', tag: 'Rotación', icon: 'chart',
            title: 'Productos de baja rotación',
            detail: 'Hay productos sin movimiento hace más de 60 días que siguen ocupando capital y espacio de almacén — candidatos naturales a una promoción o liquidación.',
            action: 'Sugerir lista de liquidación',
          },
        ];
      },
    },
    cxc: {
      label: 'Cuentas por Cobrar', icon: 'cxc',
      build() {
        const s = cxcStats();
        return [
          {
            id: 'cxc-venc', tone: s.count > 0 ? 'danger' : 'good', tag: 'Cartera vencida', icon: 'alert',
            title: s.count > 0 ? `${s.count} cuentas vencidas · ${usd(s.monto)}` : 'Cartera al día',
            detail: s.count > 0
              ? `Suman ${usd(s.monto)} en ${s.count} facturas vencidas${s.altoRiesgo ? `, ${s.altoRiesgo} de ellas con más de 30 días — el tramo donde la probabilidad de cobro cae fuerte` : ''}. Priorizarlas primero maximiza lo que se recupera este mes.`
              : 'No hay cuentas por cobrar vencidas en este momento.',
            action: s.count > 0 ? 'Redactar recordatorios de cobro' : null,
          },
          {
            id: 'cxc-riesgo', tone: 'warn', tag: 'Riesgo de crédito', icon: 'clients',
            title: 'Clientes cerca de su límite',
            detail: 'Algunos clientes con crédito ya están usando la mayor parte de su límite aprobado. Si vuelven a comprar a crédito antes de pagar, vale la pena una alerta al vendedor.',
            action: 'Marcar para revisión',
          },
          {
            id: 'cxc-plan', tone: 'good', tag: 'Plan de cobro', icon: 'chart',
            title: 'Mejor semana para cobrar',
            detail: 'Históricamente los cobros se concentran a media semana. Si el equipo llama martes/miércoles en vez de viernes, la tasa de contacto efectivo sube.',
            action: null,
          },
        ];
      },
    },
    cxp: {
      label: 'Cuentas por Pagar', icon: 'cxc',
      build() {
        const s = cxpStats();
        return [
          {
            id: 'cxp-venc', tone: s.count > 0 ? 'warn' : 'good', tag: 'Pagos vencidos', icon: 'alert',
            title: s.count > 0 ? `${s.count} facturas de proveedor vencidas` : 'Pagos a proveedores al día',
            detail: s.count > 0
              ? `Suman ${usd(s.monto)} vencidos. Pagar primero a los proveedores con mejor descuento por pronto pago cuida el flujo de caja sin dañar la relación comercial.`
              : 'No hay cuentas por pagar vencidas en este momento.',
            action: s.count > 0 ? 'Sugerir orden de pago' : null,
          },
          {
            id: 'cxp-flujo', tone: 'info', tag: 'Flujo de caja', icon: 'dollar',
            title: 'Proyección de caja a 15 días',
            detail: 'Cruzando lo que hay por cobrar y por pagar en las próximas dos semanas, el saldo proyectado se mantiene positivo — no hay señales de tensión de caja en el corto plazo.',
            action: null,
          },
        ];
      },
    },
    bank: {
      label: 'Bancos', icon: 'bank',
      build() {
        const s = bancoStats();
        return [
          {
            id: 'ban-conc', tone: s.sinConciliar > 0 ? 'warn' : 'good', tag: 'Conciliación', icon: 'sync',
            title: s.sinConciliar > 0 ? `${s.sinConciliar} movimientos sin conciliar` : 'Cuentas conciliadas',
            detail: s.sinConciliar > 0
              ? `Hay ${s.sinConciliar} movimientos bancarios sin conciliar. La mayoría cruzan solos contra pagos ya registrados — los dejé preparados para revisión rápida.`
              : 'Todos los movimientos recientes están conciliados.',
            action: s.sinConciliar > 0 ? 'Proponer conciliación automática' : null,
          },
          {
            id: 'ban-anom', tone: 'info', tag: 'Anomalía', icon: 'alert',
            title: 'Sin movimientos atípicos',
            detail: 'No encontré movimientos fuera de patrón (montos inusuales, duplicados o fuera de horario) en las cuentas de esta empresa.',
            action: null,
          },
        ];
      },
    },
    clients: {
      label: 'Clientes', icon: 'clients',
      build() {
        return [
          {
            id: 'cli-riesgo', tone: 'warn', tag: 'Riesgo de fuga', icon: 'alert',
            title: 'Clientes que bajaron su frecuencia',
            detail: 'Un grupo de clientes que compraba mensualmente lleva más de 60 días sin pedidos. Vale la pena un contacto proactivo antes de que se pierda la relación.',
            action: 'Generar lista de reactivación',
          },
          {
            id: 'cli-upsell', tone: 'good', tag: 'Oportunidad', icon: 'chart',
            title: 'Clientes listos para subir de categoría',
            detail: 'Varios clientes con tipo "Detal" ya compran en volúmenes típicos de "Distribuidor" — moverlos de lista de precios podría fidelizarlos con mejores condiciones.',
            action: 'Sugerir cambio de tipo de cliente',
          },
        ];
      },
    },
    suppliers: {
      label: 'Proveedores', icon: 'suppliers',
      build() {
        return [
          {
            id: 'prov-plazo', tone: 'info', tag: 'Negociación', icon: 'dollar',
            title: 'Proveedores con mejor plazo disponible',
            detail: 'Comparando condiciones actuales, algunos proveedores ofrecen plazos más largos que los que se están usando hoy en las órdenes de compra recientes.',
            action: 'Ver comparativa de condiciones',
          },
        ];
      },
    },
    reportes: {
      label: 'Reportes', icon: 'chart',
      build() {
        return [
          {
            id: 'rep-trend', tone: 'good', tag: 'Tendencia', icon: 'chart',
            title: 'Categoría con mejor desempeño',
            detail: 'Comparando este período contra el anterior, una categoría del catálogo concentra el mayor crecimiento en ventas — buen candidato para reforzar stock e impulsar en el POS.',
            action: null,
          },
        ];
      },
    },
    comisiones: {
      label: 'Comisiones', icon: 'dollar',
      build() {
        return [
          {
            id: 'com-top', tone: 'good', tag: 'Desempeño', icon: 'users',
            title: 'Vendedor destacado del período',
            detail: 'Un vendedor concentra la mayor parte del cierre de facturas este mes, por encima de su meta mensual — buen momento para reconocerlo frente al equipo.',
            action: null,
          },
        ];
      },
    },
  };

  // Rutas donde la torre no aporta (portales sin chrome del ERP, config, papelera, chat, etc.)
  function moduleKeyFromPath(pathname) {
    const p = (pathname || '/').split('?')[0];
    if (/^\/(pos|cotizaciones|ordenes|facturas|despachos)(\/|$)/.test(p) || p === '/') return 'pos';
    if (/^\/inventario/.test(p)) return 'inventory';
    if (/^\/cxc/.test(p)) return 'cxc';
    if (/^\/cxp/.test(p)) return 'cxp';
    if (/^\/banco/.test(p)) return 'bank';
    if (/^\/clientes/.test(p)) return 'clients';
    if (/^\/proveedores/.test(p)) return 'suppliers';
    if (/^\/(reportes|finanzas-reportes)/.test(p)) return 'reportes';
    if (/^\/comisiones/.test(p)) return 'comisiones';
    return null;
  }

  // ── Respuestas cortas del mini-chat (scripted, por palabra clave) ───────────
  function replyFor(moduleKey, question) {
    const q = question.toLowerCase();
    if (/stock|invent|almac/.test(q)) return 'Con el inventario actual, alcanza para cubrir la demanda proyectada de las próximas dos semanas en la mayoría de las categorías — el detalle está en la pestaña de Inventario.';
    if (/cobr|cxc|vencid|deuda/.test(q)) return 'Priorizaría las cuentas con más de 30 días vencidas primero: es donde la probabilidad de cobro cae más rápido con el tiempo.';
    if (/pagar|cxp|proveedor/.test(q)) return 'Te conviene pagar primero a los proveedores que ofrecen descuento por pronto pago — cuida el flujo de caja sin resignar margen.';
    if (/cliente/.test(q)) return 'Los clientes con mejor puntaje de recompra son buenos candidatos para una oferta anticipada del próximo lanzamiento.';
    if (/venta|vender|cotiza/.test(q)) return 'Las cotizaciones que se siguen dentro de las primeras 48 horas cierran casi el doble que las que se dejan enfriar.';
    return 'Buena pregunta — con los datos de este módulo, lo primero que revisaría son las alertas que ya te dejé arriba; puedo profundizar en cualquiera de ellas.';
  }

  window.AITower = function AITower({ pathname }) {
    const [open, setOpen] = useState(false);
    const [phase, setPhase] = useState('idle'); // idle | analyzing | reveal | ready
    const [visibleCount, setVisibleCount] = useState(0);
    const [applied, setApplied] = useState({});
    const [chatLog, setChatLog] = useState([]);
    const [chatInput, setChatInput] = useState('');
    const [chatBusy, setChatBusy] = useState(false);

    const moduleKey = moduleKeyFromPath(pathname);
    const config = moduleKey ? MODULES[moduleKey] : null;
    const insights = useMemo(() => (config ? config.build() : []), [moduleKey, open]);

    useEffect(() => {
      setApplied({}); setChatLog([]); setChatInput(''); setVisibleCount(0);
      if (!open || !config) { setPhase('idle'); return; }
      setPhase('analyzing');
      const t = setTimeout(() => setPhase('reveal'), 850);
      return () => clearTimeout(t);
    }, [open, moduleKey]);

    useEffect(() => {
      if (phase !== 'reveal') return;
      if (visibleCount >= insights.length) { setPhase('ready'); return; }
      const t = setTimeout(() => setVisibleCount(v => v + 1), 480);
      return () => clearTimeout(t);
    }, [phase, visibleCount, insights.length]);

    if (!config) return null;

    function sendChat() {
      const text = chatInput.trim();
      if (!text || chatBusy) return;
      setChatLog(l => [...l, { role: 'user', text }]);
      setChatInput('');
      setChatBusy(true);
      setTimeout(() => {
        setChatLog(l => [...l, { role: 'ai', text: replyFor(moduleKey, text) }]);
        setChatBusy(false);
      }, 700 + Math.random() * 500);
    }

    const shown = phase === 'reveal' ? insights.slice(0, visibleCount) : (phase === 'ready' ? insights : []);
    const pendingCount = insights.filter(i => i.action).length;

    return (
      <>
        <button className={'ai-tower-tab' + (open ? ' is-open' : '')} onClick={() => setOpen(o => !o)} title={'Asistente IA — ' + config.label}>
          <span className="ai-tower-tab-dot" />
          <span className="ai-tower-tab-label">IA</span>
          {!open && pendingCount > 0 && <span className="ai-tower-tab-badge">{pendingCount}</span>}
        </button>
        {open && (
          <aside className="ai-tower-panel">
            <div className="ai-tower-header">
              <div className="ai-tower-header-text">
                <div className="ai-tower-header-title"><span className="ai-tower-live-dot" />Asistente IA</div>
                <div className="ai-tower-header-sub">Analizando · {config.label}</div>
              </div>
              <button className="icon-btn" onClick={() => setOpen(false)} title="Cerrar"><Icon name="x" size={14} /></button>
            </div>

            <div className="ai-tower-body">
              {phase === 'analyzing' && (
                <div className="ai-tower-analyzing">
                  <span className="ai-tower-shimmer"><i /><i /><i /></span>
                  Analizando {config.label.toLowerCase()}…
                </div>
              )}
              {shown.map((ins, i) => (
                <div key={ins.id} className="ai-insight-card ai-insight-in" style={{ animationDelay: (i * 0.03) + 's' }}>
                  <div className="ai-insight-top"><span className={'ai-insight-tag tone-' + ins.tone}>{ins.tag}</span></div>
                  <div className="ai-insight-title"><Icon name={ins.icon} size={14} />{ins.title}</div>
                  <div className="ai-insight-detail">{ins.detail}</div>
                  {ins.action && (
                    <button
                      className={'ai-insight-action' + (applied[ins.id] ? ' is-done' : '')}
                      disabled={!!applied[ins.id]}
                      onClick={() => setApplied(a => ({ ...a, [ins.id]: true }))}
                    >
                      {applied[ins.id] ? <><Icon name="check" size={12} /> Aplicado</> : ins.action}
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="ai-tower-chat">
              {chatLog.length > 0 && (
                <div className="ai-tower-chat-log">
                  {chatLog.map((m, i) => <div key={i} className={'ai-chat-msg ' + m.role}>{m.text}</div>)}
                  {chatBusy && <div className="ai-chat-msg ai typing"><span /><span /><span /></div>}
                </div>
              )}
              <div className="ai-tower-chat-input">
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') sendChat(); }}
                  placeholder={'Preguntale a la IA sobre ' + config.label.toLowerCase() + '…'}
                />
                <button className="ai-tower-chat-send" disabled={!chatInput.trim() || chatBusy} onClick={sendChat} title="Enviar">
                  <Icon name="send" size={14} />
                </button>
              </div>
            </div>
          </aside>
        )}
      </>
    );
  };
})();
