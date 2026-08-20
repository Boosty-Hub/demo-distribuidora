// ====================== Fabricación (Distribuidora Demo 1) ======================
// Reemplaza el proceso 100% manual por WhatsApp (grupo "Pedidos fábrica a mayorista"): el
// vendedor mandaba despacho/vendedor/cliente/producto/medidas/forma de pago/fecha de entrega a
// mano y el taller nunca tocaba el sistema — el producto "aparecía" en inventario cuando alguien
// lo cargaba manualmente. Ver BITACORA.md 2026-08-16.
//
// Sin BOM/receta por ahora — solo se trackea el ESTADO del proceso (corte→armado→pintura→listo).
// Al declarar "listo" la cantidad entra al inventario real vía la RPC declarar_of_lista
// (atómica, alimenta el kardex con ref_tipo='fabricacion').
const { useState, useEffect, useMemo } = React;

const OF_ETAPAS = [
  { k: 'corte',   label: 'Corte' },
  { k: 'armado',  label: 'Armado/Soldadura' },
  { k: 'pintura', label: 'Pintura' },
  { k: 'listo',   label: 'Listo' },
];
const OF_ETAPA_COLOR = { corte: '#d97706', armado: '#2563eb', pintura: '#7c3aed', listo: '#059669' };

const OF_SUBTABS = [
  { k: 'en_proceso', label: 'En proceso', f: o => o.estado === 'en_proceso' },
  { k: 'listas',     label: 'Listas',     f: o => o.estado === 'listo' },
  { k: 'todas',      label: 'Todas',      f: () => true },
  { k: 'canceladas', label: 'Canceladas', f: o => o.estado === 'cancelada' },
];

function fmtFecha(d) {
  if (!d) return '—';
  return window.fmt ? window.fmt.date(d) : String(d).slice(0, 10);
}

// ── Data helpers (globales, así EnviarAFabricarModal se puede abrir desde pos.jsx) ─────────────
// Una orden lleva VARIOS productos desde la migración 79: las líneas viven en
// `ordenes_fabricacion_items` y viajan anidadas, no en una segunda consulta — el taller necesita
// ver qué hay que hacer en la misma lista, y N+1 consultas para eso es tiempo de pantalla en blanco.
// `ofLineas()` normaliza: si una orden vieja no tiene líneas, arma una con lo que hay en la
// cabecera, así el resto del módulo lee un solo formato.
window.ofLineas = function (of) {
  const items = of?.items || of?.ordenes_fabricacion_items || [];
  if (items.length) return [...items].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || (a.id - b.id));
  if (of?.sku) return [{ id: 'legacy', sku: of.sku, producto_nombre: of.producto_nombre, cantidad: of.cantidad, detalle: of.detalle }];
  return [];
};

window.loadOrdenesFabricacion = async function (empresaId) {
  const emp = empresaId || window.currentEmpresa;
  const { data, error } = await window.sb
    .from('ordenes_fabricacion')
    .select('*, items:ordenes_fabricacion_items(*)')
    .eq('empresa_id', emp)
    .order('created_at', { ascending: false });
  return { rows: data || [], error };
};

// Crea la orden con TODAS sus líneas en una transacción (RPC `crear_orden_fabricacion`).
// No son dos inserts encadenados a propósito: una cabecera sin líneas es una orden que el taller
// ve en la lista y no dice qué fabricar. Mismo criterio que devolver_oc / crear_despacho_parcial.
window.crearOrdenFabricacion = async function (cabecera, items) {
  const lineas = (items || []).filter(i => i && i.sku && Number(i.cantidad) > 0).map((i, n) => ({
    sku: String(i.sku).toUpperCase().trim(),
    producto_nombre: i.producto_nombre || null,
    cantidad: parseInt(i.cantidad, 10),
    detalle: i.detalle || null,
    documento_item_id: i.documento_item_id != null ? String(i.documento_item_id) : null,
    orden: n,
  }));
  if (!lineas.length) return { error: { message: 'La orden tiene que llevar al menos un producto.' } };

  const { data, error } = await window.sb.rpc('crear_orden_fabricacion', {
    p_cabecera: {
      ...cabecera,
      empresa_id: cabecera?.empresa_id || window.currentEmpresa,
      creado_por: window.__ssCurrentUser?.nombre || null,
    },
    p_items: lineas,
  });
  if (error) return { error };
  if (data?.error) return { error: { message: data.error } };

  const resumen = lineas.length === 1
    ? `${lineas[0].sku} x${lineas[0].cantidad}`
    : `${lineas.length} productos · ${lineas.reduce((a, l) => a + l.cantidad, 0)} u`;
  window.logActivity?.({
    modulo: 'fabricacion', accion: 'crear', entidad_id: data.id, entidad_label: resumen,
    detalles: { numero_taller: data.numero_taller, documento_id: cabecera?.documento_id || null, lineas: lineas.length },
  });
  return { of: { id: data.id, numero_taller: data.numero_taller, items: lineas } };
};

window.avanzarEtapaOF = async function (ofId, etapaNueva) {
  const usuario = window.__ssCurrentUser?.nombre || null;
  const { data, error } = await window.sb.rpc('avanzar_etapa_of', {
    p_of_id: ofId, p_etapa_nueva: etapaNueva, p_usuario: usuario,
  });
  if (!error && !(data && data.error)) {
    window.logActivity?.({ modulo: 'fabricacion', accion: 'etapa', entidad_id: ofId, entidad_label: ofId, detalles: { etapa: etapaNueva } });
  }
  return { data, error };
};

window.declararOFLista = async function (ofId) {
  const usuario = window.__ssCurrentUser?.nombre || null;
  const { data, error } = await window.sb.rpc('declarar_of_lista', { p_of_id: ofId, p_usuario: usuario });
  if (!error && data && data.ok) {
    window.logActivity?.({ modulo: 'fabricacion', accion: 'listo', entidad_id: ofId, entidad_label: ofId, detalles: {} });
  }
  return { data, error };
};

window.cancelarOrdenFabricacion = async function (ofId, motivo) {
  const usuario = window.__ssCurrentUser?.nombre || null;
  const { error } = await window.sb.from('ordenes_fabricacion').update({
    estado: 'cancelada', cancelado_por: usuario, cancelado_en: new Date().toISOString(), motivo_cancelacion: motivo,
  }).eq('id', ofId).eq('estado', 'en_proceso'); // fail-closed: solo si sigue en_proceso
  if (!error) window.logActivity?.({ modulo: 'fabricacion', accion: 'cancelar', entidad_id: ofId, entidad_label: ofId, detalles: { motivo } });
  return { error };
};

// ── Restaurar desde papelera ────────────────────────────────────────────────────────────────
if (window.ssTrashHandlers) {
  window.ssTrashHandlers.ordenFabricacion = async function (data) {
    // El snapshot de la papelera trae las líneas anidadas (`items`), que NO son una columna de la
    // cabecera: insertarlas tal cual revienta con "column items does not exist". Se separan, se
    // restaura la cabecera y después sus líneas — restaurar una orden sin sus productos la dejaría
    // en la lista sin decir qué fabricar, que es exactamente lo que la migración 79 vino a impedir.
    const { items, ordenes_fabricacion_items, ...cabecera } = data || {};
    const lineas = items || ordenes_fabricacion_items || [];
    const { error } = await window.sb.from('ordenes_fabricacion').insert(cabecera);
    if (error) return { error };
    if (lineas.length) {
      const filas = lineas.map(({ id, created_at, ...l }) => ({ ...l, of_id: cabecera.id }));
      const { error: eIt } = await window.sb.from('ordenes_fabricacion_items').insert(filas);
      if (eIt) return { error: eIt };
    }
    return { ok: true };
  };
}

// ══════════════════════════ Pipeline visual de etapas ══════════════════════════
function PipelineEtapas({ of, canEditar, canDeclarar, onAvanzar, onDeclararListo, busy }) {
  const idxActual = OF_ETAPAS.findIndex(e => e.k === of.etapa);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '20px 4px', overflowX: 'auto' }}>
      {OF_ETAPAS.map((e, i) => {
        const done = i < idxActual || of.estado === 'listo';
        const activa = i === idxActual && of.estado !== 'listo';
        const color = OF_ETAPA_COLOR[e.k];
        return (
          <React.Fragment key={e.k}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 84 }}>
              <div style={{
                width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center',
                background: done || activa ? color : 'var(--bg-sunken)',
                color: done || activa ? '#fff' : 'var(--text-muted)',
                border: activa ? `2px solid ${color}` : 'none',
                boxShadow: activa ? `0 0 0 4px ${color}22` : 'none',
                fontWeight: 700, fontSize: 13,
              }}>
                {done ? <Icon name="check" size={16} /> : i + 1}
              </div>
              <div style={{ fontSize: 11.5, fontWeight: activa ? 700 : 500, color: activa ? color : 'var(--text-muted)', textAlign: 'center' }}>{e.label}</div>
            </div>
            {i < OF_ETAPAS.length - 1 && (
              <div style={{ flex: 1, height: 2, minWidth: 20, background: i < idxActual || of.estado === 'listo' ? OF_ETAPA_COLOR[e.k] : 'var(--border)', marginBottom: 20 }} />
            )}
          </React.Fragment>
        );
      })}
      <div style={{ marginLeft: 16, display: 'flex', gap: 8, flexShrink: 0 }}>
        {of.estado === 'en_proceso' && of.etapa !== 'pintura' && canEditar && (
          <button className="btn secondary sm" disabled={busy}
            onClick={() => onAvanzar(OF_ETAPAS[idxActual + 1].k)}>
            Avanzar a "{OF_ETAPAS[idxActual + 1]?.label}"
          </button>
        )}
        {of.estado === 'en_proceso' && of.etapa === 'pintura' && canDeclarar && (
          <button className="btn primary sm" disabled={busy} onClick={onDeclararListo}>
            <Icon name="check" size={13} />Declarar Listo (entra a inventario)
          </button>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════ Modal crear / "Enviar a fabricar" ══════════════════════════
// Un solo modal para las 2 vías: standalone (props sin doc) y desde documento (props con doc+linea).
// Se expone en window.EnviarAFabricarModal para que pos.jsx (chunk distinto) lo pueda abrir.
// `lineas` (plural) = "fabricar todo": una sola orden con todos los productos de la cotización.
// `linea` (singular) se mantiene por compatibilidad con el botón por fila.
window.EnviarAFabricarModal = function EnviarAFabricarModal({ doc, cliente, linea, lineas, onClose, onCreated }) {
  const empresa = window.currentEmpresa;
  const almacenes = (window.SSData?.almacenes || []).filter(a => a.empresa_id === empresa);
  const almacenDefault = almacenes[0]?.id || '';

  // Las líneas de origen, normalizadas. Un documento puede traer una sola (botón de la fila) o
  // todas (botón "Fabricar todo"); suelta arranca con una fila vacía para llenar a mano.
  const origen = (lineas && lineas.length) ? lineas : (linea ? [linea] : null);
  const [items, setItems] = useState(() =>
    origen
      ? origen.map(l => ({
          sku: l.sku || '',
          producto_nombre: l.nombre || l.producto_nombre || '',
          cantidad: l.qty || l.cantidad || 1,
          detalle: '',
          documento_item_id: l.id ?? null,
        }))
      : [{ sku: '', producto_nombre: '', cantidad: 1, detalle: '', documento_item_id: null }]
  );

  const [form, setForm] = useState(() => ({
    almacen_id: almacenDefault,
    cliente_nombre: cliente?.nombre || '',
    cliente_rif: cliente?.rif || '',
    cliente_telefono: cliente?.telefono || '',
    cliente_direccion: doc?.dir_entrega || doc?.dir_factura || cliente?.direccion || '',
    vendedor: doc?.vendedor || '',
    forma_pago: '',
    fecha_entrega_solicitada: '',
    observaciones: '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const esDesdeDocumento = !!doc;
  // Viniendo de un documento el SKU no se escribe a mano (sale de la línea cotizada); suelta, sí.
  const skuBloqueado = !!origen;

  function setF(k, v) { setForm(p => ({ ...p, [k]: v })); }
  function setItem(i, k, v) { setItems(p => p.map((it, n) => (n === i ? { ...it, [k]: v } : it))); }
  function addItem() { setItems(p => [...p, { sku: '', producto_nombre: '', cantidad: 1, detalle: '', documento_item_id: null }]); }
  function delItem(i) { setItems(p => (p.length <= 1 ? p : p.filter((_, n) => n !== i))); }

  const totalUnidades = items.reduce((a, it) => a + (parseInt(it.cantidad, 10) || 0), 0);

  async function handleSubmit(e) {
    e.preventDefault();
    const validas = items.filter(it => it.sku && Number(it.cantidad) > 0);
    if (!validas.length) { setError('Agregá al menos un producto con cantidad mayor a 0.'); return; }
    const incompleta = items.find(it => (it.sku && !(Number(it.cantidad) > 0)) || (!it.sku && Number(it.cantidad) > 0));
    if (incompleta) { setError('Hay una línea sin SKU o sin cantidad. Completala o quitala.'); return; }
    // Dos líneas del mismo SKU en la misma orden no son un error del taller, pero casi siempre son
    // un doble clic: se avisa y se deja seguir.
    setSaving(true); setError('');
    const cabecera = {
      ...form,
      // Postgres rechaza '' para una columna date ("invalid input syntax for type date") — el
      // input type="date" vacío manda '', no null.
      fecha_entrega_solicitada: form.fecha_entrega_solicitada || null,
      empresa_id: empresa,
      documento_id: doc?.id || null,
    };
    const { of, error: eCrear } = await window.crearOrdenFabricacion(cabecera, validas);
    setSaving(false);
    if (eCrear) { setError('No se pudo crear la orden de fabricación: ' + (eCrear.message || eCrear)); return; }
    onCreated?.(of);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="box" size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <h3 className="modal-title">Enviar a fabricar</h3>
            <div className="small muted">{esDesdeDocumento ? `Vinculada a ${doc.id}` : 'Orden suelta (para stock)'}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '62vh', overflow: 'auto' }}>
            {error && <div style={{ padding: '8px 12px', background: '#fef2f2', color: '#dc2626', borderRadius: 8, fontSize: 13 }}>{error}</div>}

            {/* .grid-2 (theme.css), no gridTemplateColumns inline: la de módulo colapsa a 1 columna
                en móvil (max-width:768px) — con un grid fijo estos campos quedaban cortados
                (reportado 2026-08-16 en el modal de Enviar a fabricar). */}
            {/* Productos de la orden. Una orden = un trabajo de taller que puede llevar VARIOS
                productos (migración 79): el pipeline de etapas es de la ORDEN, no de cada pieza.
                Las medidas van POR LÍNEA — cada producto tiene las suyas. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>
                Productos a fabricar
              </div>
              <span className="chip neutral" style={{ fontSize: 11 }}>
                {items.length} línea{items.length === 1 ? '' : 's'} · {totalUnidades} u
              </span>
              {!skuBloqueado && (
                <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={addItem}>
                  <Icon name="plus" size={12} />Agregar producto
                </button>
              )}
            </div>

            {items.map((it, i) => (
              <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10,
                                    display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="grid-2">
                  <div>
                    <label className="small muted" style={{ display: 'block', marginBottom: 4 }}>SKU / producto *</label>
                    <input className="input" value={it.sku}
                      onChange={e => setItem(i, 'sku', e.target.value.toUpperCase())}
                      disabled={skuBloqueado} placeholder="Ej. M4-P-GIM" />
                  </div>
                  <div>
                    <label className="small muted" style={{ display: 'block', marginBottom: 4 }}>Cantidad *</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input className="input" type="number" min="1" value={it.cantidad}
                        onChange={e => setItem(i, 'cantidad', parseInt(e.target.value) || 0)} />
                      {items.length > 1 && (
                        <button type="button" className="icon-btn" title="Quitar este producto"
                                onClick={() => delItem(i)} style={{ color: 'var(--danger)' }}>
                          <Icon name="trash" size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="small muted" style={{ display: 'block', marginBottom: 4 }}>Nombre del producto</label>
                  <input className="input" value={it.producto_nombre}
                    onChange={e => setItem(i, 'producto_nombre', e.target.value)}
                    placeholder="Ej. Locker Para Gimnasio 4 Puertas" />
                </div>
                <div>
                  <label className="small muted" style={{ display: 'block', marginBottom: 4 }}>Medidas / detalle</label>
                  <textarea className="input" rows={2} value={it.detalle}
                    onChange={e => setItem(i, 'detalle', e.target.value)}
                    placeholder="Ej. 2mts de alto, 36cm de ancho y 50cm de profundidad. Color negro + manillas negras" />
                </div>
              </div>
            ))}

            {!esDesdeDocumento && (
              <>
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>Cliente (opcional — se puede fabricar para stock)</div>
                <div className="grid-2">
                  <input className="input" placeholder="Nombre del cliente" value={form.cliente_nombre} onChange={e => setF('cliente_nombre', e.target.value)} />
                  <input className="input" placeholder="RIF" value={form.cliente_rif} onChange={e => setF('cliente_rif', e.target.value)} />
                  <input className="input" placeholder="Teléfono" value={form.cliente_telefono} onChange={e => setF('cliente_telefono', e.target.value)} />
                  <input className="input" placeholder="Vendedor" value={form.vendedor} onChange={e => setF('vendedor', e.target.value)} />
                </div>
                <input className="input" placeholder="Dirección / zona de envío" value={form.cliente_direccion} onChange={e => setF('cliente_direccion', e.target.value)} />
              </>
            )}

            <div className="grid-2">
              <div>
                <label className="small muted" style={{ display: 'block', marginBottom: 4 }}>Forma de pago</label>
                <input className="input" placeholder="Ej. Binance, anticipo 50%" value={form.forma_pago} onChange={e => setF('forma_pago', e.target.value)} />
              </div>
              <div>
                <label className="small muted" style={{ display: 'block', marginBottom: 4 }}>Entrega solicitada</label>
                <input className="input" type="date" value={form.fecha_entrega_solicitada} onChange={e => setF('fecha_entrega_solicitada', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="small muted" style={{ display: 'block', marginBottom: 4 }}>Observaciones</label>
              <textarea className="input" rows={2} value={form.observaciones} onChange={e => setF('observaciones', e.target.value)}
                placeholder="Ej. Si están antes por favor notificar" />
            </div>
            {esDesdeDocumento && doc.tipo === 'cotizacion' && (
              <div style={{ padding: '8px 12px', background: 'var(--brand-soft)', color: 'var(--brand)', borderRadius: 8, fontSize: 12.5 }}>
                Al enviar, esta cotización se convierte en orden — el compromiso de fabricar ya es una venta real.
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn primary" disabled={saving}>
              <Icon name="box" size={14} />{saving ? 'Enviando…' : 'Enviar a fabricar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ══════════════════════════ Detalle de una OF ══════════════════════════
function OFDetailModal({ of, onClose, onChanged }) {
  const [showLog, setShowLog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [motivo, setMotivo] = useState('');

  const canEditar   = window.canUser?.('editar', 'fabricacion') !== false;
  const canDeclarar = window.canUser?.('declarar_listo', 'fabricacion') !== false;
  const canEliminar = window.canUser?.('eliminar', 'fabricacion') !== false;

  // Una orden puede llevar varios productos (migración 79). `ofLineas` normaliza las órdenes
  // viejas, que guardaban el producto en la cabecera, para que acá se lea un solo formato.
  const lineas = window.ofLineas(of);
  const totalU  = lineas.reduce((a, l) => a + (l.cantidad || 0), 0);
  const resumen = lineas.length === 1
    ? (lineas[0].producto_nombre || lineas[0].sku)
    : `${lineas.length} productos`;

  async function avanzar(etapaNueva) {
    setBusy(true);
    const { data, error } = await window.avanzarEtapaOF(of.id, etapaNueva);
    setBusy(false);
    if (error || data?.error) { alert('No se pudo avanzar la etapa: ' + (error?.message || data?.error)); return; }
    onChanged();
  }
  async function declararListo() {
    // Se enumera línea por línea: es la única acción del módulo que mueve inventario real, y con
    // varios productos "va a sumar 750 unidades" no dice de qué.
    const detalle = lineas.map(l => `  · ${l.cantidad} x ${l.producto_nombre || l.sku}`).join('\n');
    if (!confirm(`¿Declarar lista esta orden?\n\nVa a sumar al inventario de ${of.almacen_id}:\n${detalle}`)) return;
    setBusy(true);
    const { data, error } = await window.declararOFLista(of.id);
    setBusy(false);
    if (error || data?.error) { alert('No se pudo declarar lista: ' + (error?.message || data?.error)); return; }
    onChanged();
  }
  async function cancelarOF() {
    if (!motivo || motivo.trim().length < 6) { alert('El motivo debe tener al menos 6 caracteres.'); return; }
    setBusy(true);
    const { error } = await window.cancelarOrdenFabricacion(of.id, motivo.trim());
    setBusy(false);
    if (error) { alert('No se pudo cancelar: ' + error.message); return; }
    setConfirmCancel(false);
    onChanged();
  }
  async function eliminarOF() {
    if (of.estado === 'listo') { alert('Una orden ya lista movió inventario real — no se puede borrar, solo cancelar antes de llegar a "Listo".'); return; }
    if (!confirm('¿Enviar esta orden de fabricación a la papelera?')) return;
    const { error } = await window.sb.from('ordenes_fabricacion').delete().eq('id', of.id);
    if (error) { alert('No se pudo eliminar: ' + error.message); return; }
    window.ssTrash?.add('ordenFabricacion', `OF ${of.numero_taller} · ${resumen}`, of);
    window.logActivity?.({ modulo: 'fabricacion', accion: 'eliminar', entidad_id: of.id, entidad_label: of.id });
    onChanged();
    onClose();
  }

  return (
    <>
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="box" size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <h3 className="modal-title">Taller #{of.numero_taller} · {resumen}</h3>
            <div className="small muted">{of.documento_id ? `Vinculada a ${of.documento_id}` : 'Orden suelta (para stock)'} · {of.estado === 'cancelada' ? 'Cancelada' : of.estado === 'listo' ? 'Lista' : 'En proceso'}</div>
          </div>
          {canEliminar && of.estado !== 'listo' && (
            <button className="icon-btn" title="Enviar a papelera" onClick={eliminarOF}><Icon name="trash" size={15} /></button>
          )}
          <button className="icon-btn" title="Actividad" onClick={() => setShowLog(true)}><Icon name="clock" size={15} /></button>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>

        <div style={{ padding: '4px 24px 20px' }}>
            {of.estado !== 'cancelada' && (
              <PipelineEtapas of={of} canEditar={canEditar} canDeclarar={canDeclarar} busy={busy}
                onAvanzar={avanzar} onDeclararListo={declararListo} />
            )}
            {of.estado === 'cancelada' && (
              <div style={{ padding: '10px 14px', background: '#fef2f2', color: '#dc2626', borderRadius: 8, fontSize: 13, margin: '12px 0' }}>
                Cancelada por {of.cancelado_por || '—'} el {fmtFecha(of.cancelado_en)}. Motivo: {of.motivo_cancelacion || '—'}
              </div>
            )}
            {/* Todos los productos de la orden, con su cantidad y sus medidas. Es lo que el taller
                abre para saber qué tiene que hacer — pedido textual: "cuando le doy a ese registro
                me aparezca todo los productos que mandé a hacer y las cantidades". */}
            <div style={{ marginTop: 8 }}>
              <div className="small muted" style={{ marginBottom: 4 }}>
                Productos a fabricar · {lineas.length} línea{lineas.length === 1 ? '' : 's'} · {totalU} u
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                {lineas.map((l, i) => (
                  <div key={l.id ?? i}
                       style={{ display: 'flex', gap: 10, padding: '8px 11px', alignItems: 'flex-start',
                                borderTop: i ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ minWidth: 46, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {l.cantidad}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{l.producto_nombre || l.sku}</div>
                      <div className="small muted mono">{l.sku}</div>
                      {l.detalle && <div className="small" style={{ marginTop: 3, whiteSpace: 'pre-wrap' }}>{l.detalle}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid-2" style={{ marginTop: 12 }}>
              <div>
                <div className="small muted">Cliente</div>
                <div style={{ fontWeight: 600 }}>{of.cliente_nombre || '— (para stock)'}</div>
                {of.cliente_rif && <div className="small muted">RIF: {of.cliente_rif}</div>}
                {of.cliente_telefono && <div className="small muted">Tel: {of.cliente_telefono}</div>}
                {of.cliente_direccion && <div className="small">{of.cliente_direccion}</div>}
              </div>
              <div>
                <div className="small muted">Forma de pago</div>
                <div>{of.forma_pago || '—'}</div>
              </div>
              <div>
                <div className="small muted">Entrega solicitada</div>
                <div>{fmtFecha(of.fecha_entrega_solicitada)}</div>
              </div>
              {of.vendedor && (
                <div>
                  <div className="small muted">Vendedor</div>
                  <div>{of.vendedor}</div>
                </div>
              )}
              {of.observaciones && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div className="small muted">Observaciones</div>
                  <div>{of.observaciones}</div>
                </div>
              )}
            </div>

            {of.estado === 'en_proceso' && canEditar && (
              <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                {!confirmCancel ? (
                  <button className="btn ghost sm" style={{ color: 'var(--danger,#dc2626)' }} onClick={() => setConfirmCancel(true)}>
                    Cancelar orden de fabricación
                  </button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <textarea className="input" rows={2} placeholder="Motivo de la cancelación (mínimo 6 caracteres)…" value={motivo} onChange={e => setMotivo(e.target.value)} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn secondary sm" onClick={() => setConfirmCancel(false)}>Volver</button>
                      <button className="btn primary sm" style={{ background: 'var(--danger,#dc2626)', borderColor: 'var(--danger,#dc2626)' }} disabled={busy} onClick={cancelarOF}>Confirmar cancelación</button>
                    </div>
                  </div>
                )}
              </div>
            )}
        </div>
      </div>
    </div>
    {/* Hermano del modal de arriba, NUNCA anidado dentro de su overlay — ActivityLogModal es su
        propio modal-overlay completo (ver el bug documentado de overlays anidados). */}
    {showLog && window.ActivityLogModal && (
      <window.ActivityLogModal modulo="fabricacion" entidadId={of.id} entidadLabel={`Taller #${of.numero_taller}`} onClose={() => setShowLog(false)} />
    )}
    </>
  );
}

// ══════════════════════════ Página principal ══════════════════════════
window.FabricacionPage = function FabricacionPage() {
  const [ordenes, setOrdenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = window.usePersistedState('ss-fabricacion-f-subtab', 'en_proceso');
  const [search, setSearch] = window.usePersistedState('ss-fabricacion-f-search', '');
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => { const v = parseInt(localStorage.getItem('ss-fabricacion-pagesize'), 10); return [25, 50, 100, 200].includes(v) ? v : 50; });
  const [showCreate, setShowCreate] = useState(false);
  const [selectedOF, setSelectedOF] = useState(null);
  const [msg, setMsg] = useState('');

  function flash(m) { setMsg(m); setTimeout(() => setMsg(''), 4000); }
  useEffect(() => { localStorage.setItem('ss-fabricacion-pagesize', String(pageSize)); }, [pageSize]);
  useEffect(() => { setPage(1); setSelected(new Set()); }, [subTab, search]);

  async function reload() {
    setLoading(true);
    const { rows } = await window.loadOrdenesFabricacion();
    setOrdenes(rows);
    setLoading(false);
  }
  useEffect(() => { reload(); }, []);

  const filtradas = useMemo(() => {
    const tabFn = (OF_SUBTABS.find(t => t.k === subTab) || OF_SUBTABS[0]).f;
    let list = ordenes.filter(tabFn);
    const q = (search || '').trim().toLowerCase();
    if (q) {
      // Se busca DENTRO de las líneas, no solo en la cabecera: con varios productos por orden,
      // buscar un SKU miraría un campo que las órdenes nuevas ya no llenan y no encontraría nada.
      list = list.filter(o => [
        o.id, String(o.numero_taller), o.cliente_nombre, o.documento_id, o.vendedor,
        ...window.ofLineas(o).flatMap(l => [l.sku, l.producto_nombre]),
      ].filter(Boolean).join(' ').toLowerCase().includes(q));
    }
    return list;
  }, [ordenes, subTab, search]);

  const counts = useMemo(() => Object.fromEntries(OF_SUBTABS.map(t => [t.k, ordenes.filter(t.f).length])), [ordenes]);

  const totalPages = Math.max(1, Math.ceil(filtradas.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const paginated = filtradas.slice((curPage - 1) * pageSize, curPage * pageSize);

  function toggleOne(id, e) { e?.stopPropagation(); setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; }); }
  function toggleAll() { setSelected(prev => prev.size === paginated.length && paginated.length > 0 ? new Set() : new Set(paginated.map(o => o.id))); }

  async function bulkDelete() {
    const ids = [...selected].filter(id => { const o = ordenes.find(x => x.id === id); return o && o.estado !== 'listo'; });
    if (ids.length === 0) { alert('Ninguna de las seleccionadas se puede eliminar (las que ya están "Listas" no se pueden borrar).'); return; }
    if (!confirm(`¿Enviar ${ids.length} orden(es) a la papelera?`)) return;
    for (const id of ids) {
      const o = ordenes.find(x => x.id === id);
      const { error } = await window.sb.from('ordenes_fabricacion').delete().eq('id', id);
      if (!error) window.ssTrash?.add('ordenFabricacion', `OF ${o.numero_taller} · ${(window.ofLineas(o)[0]?.producto_nombre || window.ofLineas(o)[0]?.sku || '')}`, o);
    }
    window.logActivity?.({ modulo: 'fabricacion', accion: 'bulk_eliminar', detalles: { ids } });
    setSelected(new Set());
    await reload();
    flash('Enviadas a la papelera.');
  }

  const canCrear = window.canUser?.('crear', 'fabricacion') !== false;

  return (
    <div className="page">
      {msg && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999, padding: '10px 18px', borderRadius: 10, background: '#047857', color: '#fff', fontSize: 13, fontWeight: 500, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>{msg}</div>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Fabricación</h1>
          <div className="page-subtitle">{ordenes.length} órdenes de fabricación</div>
        </div>
        <div className="page-actions">
          {canCrear && (
            <button className="btn primary" onClick={() => setShowCreate(true)}>
              <Icon name="plus" size={14} />Nueva orden de fabricación
            </button>
          )}
        </div>
      </div>

      <div className="doc-subtabs" style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
        {OF_SUBTABS.map(t => {
          const active = subTab === t.k;
          const color = '#7c3aed';
          return (
            <button key={t.k} onClick={() => setSubTab(t.k)} className="doc-subtab-pill"
              style={{ padding: '6px 14px', cursor: 'pointer', borderRadius: 8, whiteSpace: 'nowrap',
                border: active ? `1px solid ${color}` : '1px solid transparent',
                background: active ? color + '14' : 'transparent',
                color: active ? color : 'var(--text-muted)', fontWeight: active ? 700 : 500, fontSize: 13 }}>
              {t.label}
              <span className="chip" style={{ marginLeft: 6, fontSize: 10.5, padding: '0 6px', background: active ? color + '22' : 'var(--bg)', color: active ? color : 'var(--text-muted)' }}>
                {counts[t.k] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      <div className="tbl-toolbar" style={{ marginBottom: 12 }}>
        <div className="search-wrap"><Icon name="search" size={14} /><input className="search" placeholder="Buscar por N° taller, SKU, cliente, documento…" value={search} onChange={e => setSearch(e.target.value)} /></div>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 36, padding: '4px 10px' }}>
                <input type="checkbox"
                  ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < paginated.length; }}
                  checked={paginated.length > 0 && selected.size === paginated.length}
                  onChange={toggleAll} style={{ cursor: 'pointer' }} />
              </th>
              <th>N° taller</th>
              <th>Producto</th>
              <th>Cliente</th>
              <th>Cant.</th>
              <th>Etapa</th>
              <th>Entrega solicitada</th>
              <th>Documento</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan="9" className="empty">Cargando…</td></tr>}
            {!loading && paginated.map(o => (
              <tr key={o.id} onClick={e => { if (selected.size > 0) toggleOne(o.id, e); else setSelectedOF(o); }}
                style={{ cursor: 'pointer', background: selected.has(o.id) ? 'var(--brand-soft)' : '' }}>
                <td style={{ padding: '4px 10px', width: 36 }} onClick={e => toggleOne(o.id, e)}>
                  <input type="checkbox" checked={selected.has(o.id)} onChange={() => {}} style={{ cursor: 'pointer', pointerEvents: 'none' }} />
                </td>
                <td style={{ fontFamily: 'var(--mono)' }}>#{o.numero_taller}</td>
                {/* Con varios productos la fila muestra el primero y cuántos más hay: el detalle
                    completo está a un clic y una celda con 5 nombres apilados rompe la tabla. */}
                {(() => {
                  const ls = window.ofLineas(o);
                  const primera = ls[0];
                  return (
                    <>
                      <td>
                        <div style={{ fontWeight: 600 }}>{primera?.producto_nombre || primera?.sku || '—'}</div>
                        <div className="small muted">
                          <span className="mono">{primera?.sku || ''}</span>
                          {ls.length > 1 && <> · +{ls.length - 1} producto{ls.length - 1 === 1 ? '' : 's'}</>}
                        </div>
                      </td>
                      <td>{o.cliente_nombre || <span className="muted">— para stock</span>}</td>
                      <td>{ls.reduce((a, l) => a + (l.cantidad || 0), 0)}</td>
                    </>
                  );
                })()}
                <td>
                  {o.estado === 'cancelada'
                    ? <span className="chip red">Cancelada</span>
                    : <span className="chip" style={{ background: OF_ETAPA_COLOR[o.etapa] + '18', color: OF_ETAPA_COLOR[o.etapa] }}>{OF_ETAPAS.find(e => e.k === o.etapa)?.label}</span>}
                </td>
                <td>{fmtFecha(o.fecha_entrega_solicitada)}</td>
                <td>{o.documento_id || '—'}</td>
                <td><button className="icon-btn" style={{ width: 26, height: 26 }} onClick={e => { e.stopPropagation(); setSelectedOF(o); }}><Icon name="chevronR" size={14} /></button></td>
              </tr>
            ))}
            {!loading && paginated.length === 0 && <tr><td colSpan="9" className="empty">Sin resultados</td></tr>}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--border)', fontSize: 13 }}>
          <span className="muted">{filtradas.length} registros · Página {curPage} de {totalPages}</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn ghost sm" disabled={curPage === 1} onClick={() => setPage(p => p - 1)}><Icon name="chevronL" size={13} /></button>
            <button className="btn ghost sm" disabled={curPage === totalPages} onClick={() => setPage(p => p + 1)}><Icon name="chevronR" size={13} /></button>
          </div>
        </div>
      )}

      {selected.size > 0 && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: '0 12px 40px rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', zIndex: 300 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 10, borderRight: '1px solid var(--border)', marginRight: 4 }}>
            <div style={{ width: 24, height: 24, borderRadius: 8, background: 'var(--brand)', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>{selected.size}</div>
            <span style={{ fontSize: 13, fontWeight: 600 }}>seleccionada{selected.size !== 1 ? 's' : ''}</span>
          </div>
          {window.canUser?.('eliminar', 'fabricacion') !== false && (
            <button className="btn ghost sm" style={{ color: 'var(--danger,#dc2626)' }} onClick={bulkDelete}><Icon name="trash" size={13} />Eliminar</button>
          )}
          <button className="icon-btn" onClick={() => setSelected(new Set())} style={{ marginLeft: 4 }}><Icon name="x" size={15} /></button>
        </div>
      )}

      {showCreate && (
        <window.EnviarAFabricarModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); reload(); flash('Orden de fabricación creada.'); }} />
      )}
      {selectedOF && (
        <OFDetailModal of={selectedOF} onClose={() => setSelectedOF(null)} onChanged={async () => { await reload(); setSelectedOF(prev => prev ? (ordenes.find(o => o.id === prev.id) || null) : null); }} />
      )}
    </div>
  );
};

Object.assign(window, { FabricacionPage: window.FabricacionPage, EnviarAFabricarModal: window.EnviarAFabricarModal });
