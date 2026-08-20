// ── Inversiones (capex) ──────────────────────────────────────────────────────────────────────
// Una inversión —una máquina, una inversión externa— saca plata del banco pero NO es un gasto de
// la operación ni una deuda con un proveedor. Por eso no vive en Cuentas por Pagar y por eso su
// egreso bancario lleva el prefijo `MOV-INV-`: es lo que hace que el panel de finanzas la muestre
// en su propio renglón en vez de sumarla a "Egresos / gastos". Si sumara, el mes en que se compra
// un torno el negocio aparentaría estar perdiendo plata.
//
// El movimiento bancario existe igual y el saldo del banco sigue cuadrando contra la suma de sus
// movimientos: lo único que cambia es en qué renglón del reporte se cuenta.
const { useState: iSt, useEffect: iEff, useMemo: iMemo } = React;

const INV_CATEGORIAS = [
  { id: 'maquinaria',  label: 'Maquinaria y equipo' },
  { id: 'inmueble',    label: 'Inmueble' },
  { id: 'vehiculo',    label: 'Vehículo' },
  { id: 'tecnologia',  label: 'Tecnología / software' },
  { id: 'externa',     label: 'Inversión externa' },
  { id: 'mejoras',     label: 'Mejoras y remodelación' },
  { id: 'otro',        label: 'Otro' },
];
const invCatLabel = (id) => (INV_CATEGORIAS.find(c => c.id === id) || {}).label || id || '—';

// ── Alta ──────────────────────────────────────────────────────────────────────────────────────
function NuevaInversionModal({ onClose, onSaved }) {
  const bancos = (SSData.cuentasBancarias || []);
  const [f, setF] = iSt(() => ({
    fecha: window.localDateStr ? window.localDateStr() : new Date().toISOString().slice(0, 10),
    concepto: '', categoria: 'maquinaria', beneficiario: '',
    monto: '', cuentaBancariaId: bancos[0]?.id || '', tasa: '', notas: '',
  }));
  const [saving, setSaving] = iSt(false);
  const [err, setErr] = iSt('');
  const banco = bancos.find(b => b.id === f.cuentaBancariaId);
  const esBs  = banco && banco.moneda !== 'USD';
  // La tasa por defecto es la de vuelto, igual que en el resto de tesorería. Si no hay tasa
  // configurada NO se inventa un número: se pide.
  const tasaSistema = Number(SSData.tasa?.vuelto) || Number(SSData.tasa?.bcv) || null;
  iEff(() => { if (esBs && !f.tasa && tasaSistema) setF(p => ({ ...p, tasa: String(tasaSistema) })); }, [esBs]);

  const montoNum = parseFloat(f.monto) || 0;
  const tasaNum  = parseFloat(f.tasa) || 0;
  // En bolívares manda el monto en bolívares: el USD es la referencia (Bs / tasa), nunca al revés.
  const equivUsd = !esBs ? montoNum : (tasaNum > 0 ? montoNum / tasaNum : null);

  async function guardar() {
    setErr('');
    if (!f.concepto.trim())      return setErr('Poné un concepto: es lo que va a leer la contadora.');
    if (!f.cuentaBancariaId)     return setErr('Elegí de qué banco sale la plata.');
    if (montoNum <= 0)           return setErr('El monto tiene que ser mayor que cero.');
    if (esBs && tasaNum <= 0)    return setErr(`La cuenta está en ${banco.moneda}: hace falta la tasa para registrar el equivalente en USD.`);
    setSaving(true);
    const { data, error } = await window.crearInversion({ ...f, monto: montoNum, tasa: esBs ? tasaNum : null });
    setSaving(false);
    if (error) { setErr('No se pudo registrar: ' + (error.message || 'error desconocido')); return; }
    window.logActivity?.({ modulo: 'inversiones', accion: 'crear', entidad_id: data?.id,
      entidad_label: f.concepto, detalles: { monto: montoNum, moneda: banco?.moneda, monto_usd: data?.monto_usd, categoria: f.categoria } });
    onSaved?.();
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-fullscreen-mobile" onClick={e => e.stopPropagation()} style={{ width: 560, maxWidth: '95vw' }}>
        <div className="modal-header">
          <div style={{ flex: 1 }}>
            <div className="modal-title">Nueva inversión</div>
            <div className="small muted">Debita del banco, pero no cuenta como gasto operativo</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 18px' }}>
          <div className="grid-2" style={{ gap: 10 }}>
            <label className="field"><span className="field-label">Fecha</span>
              <input type="date" className="input" value={f.fecha} onChange={e => setF({ ...f, fecha: e.target.value })} /></label>
            <label className="field"><span className="field-label">Categoría</span>
              <select className="select" value={f.categoria} onChange={e => setF({ ...f, categoria: e.target.value })}>
                {INV_CATEGORIAS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select></label>
          </div>
          <label className="field"><span className="field-label">Concepto</span>
            <input className="input" placeholder="Ej.: Torno CNC Haas ST-20" value={f.concepto}
                   onChange={e => setF({ ...f, concepto: e.target.value })} /></label>
          <label className="field"><span className="field-label">Beneficiario / proveedor <span className="muted">(opcional)</span></span>
            <input className="input" value={f.beneficiario} onChange={e => setF({ ...f, beneficiario: e.target.value })} /></label>
          <label className="field"><span className="field-label">Banco de donde sale</span>
            <select className="select" value={f.cuentaBancariaId} onChange={e => setF({ ...f, cuentaBancariaId: e.target.value, tasa: '' })}>
              <option value="">— Elegir —</option>
              {bancos.map(b => <option key={b.id} value={b.id}>{b.banco} · {b.moneda}</option>)}
            </select></label>
          <div className="grid-2" style={{ gap: 10 }}>
            <label className="field"><span className="field-label">Monto {banco ? `(${banco.moneda})` : ''}</span>
              <input type="number" step="0.01" min="0" className="input" value={f.monto}
                     onChange={e => setF({ ...f, monto: e.target.value })} /></label>
            {esBs && (
              <label className="field"><span className="field-label">Tasa (Bs./USD)</span>
                <input type="number" step="0.01" min="0" className="input" value={f.tasa}
                       onChange={e => setF({ ...f, tasa: e.target.value })} /></label>
            )}
          </div>
          {esBs && (
            <div className="small muted">
              Equivalente: <strong>{equivUsd != null ? fmt.usd(equivUsd) : '—'}</strong>
              {' · '}el monto que manda es el que salió del banco en {banco.moneda}
            </div>
          )}
          <label className="field"><span className="field-label">Notas <span className="muted">(opcional)</span></span>
            <textarea className="input" rows={2} value={f.notas} onChange={e => setF({ ...f, notas: e.target.value })} /></label>
          {err && <div className="small" style={{ color: 'var(--danger)' }}>{err}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" onClick={guardar} disabled={saving}>
            <Icon name="check" size={14} />{saving ? 'Registrando…' : 'Registrar inversión'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Detalle ───────────────────────────────────────────────────────────────────────────────────
function InversionDetalle({ inv, onClose, onDeleted }) {
  const [tab, setTab] = iSt('info');
  const [borrando, setBorrando] = iSt(false);
  const puedeBorrar = window.canUser ? window.canUser('eliminar', 'inversiones') : true;

  async function borrar() {
    if (!confirm(`¿Eliminar la inversión "${inv.concepto}"?\n\nTambién se borra su egreso del banco y el saldo se recalcula. Va a la papelera por 30 días.`)) return;
    setBorrando(true);
    const { error } = await window.eliminarInversion(inv.id);
    setBorrando(false);
    if (error) { alert('No se pudo eliminar: ' + (error.message || 'error desconocido')); return; }
    window.ssTrash?.add('inversion', inv.concepto, inv);
    window.logActivity?.({ modulo: 'inversiones', accion: 'eliminar', entidad_id: inv.id, entidad_label: inv.concepto });
    onDeleted?.();
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-fullscreen-mobile" onClick={e => e.stopPropagation()} style={{ width: 620, maxWidth: '95vw' }}>
        <div className="modal-header">
          <div style={{ flex: 1 }}>
            <div className="modal-title">{inv.concepto}</div>
            <div className="small muted">{invCatLabel(inv.categoria)} · {fmt.date(inv.fecha)}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>
        <div className="tabs">
          <button className={tab === 'info' ? 'on' : ''} onClick={() => setTab('info')}>Información</button>
          <button className={tab === 'act' ? 'on' : ''} onClick={() => setTab('act')}>Actividad</button>
        </div>
        {tab === 'info' ? (
          <div className="modal-body" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="grid-2" style={{ gap: 10 }}>
              <div><div className="small muted">Monto ({inv.moneda})</div><div style={{ fontWeight: 700 }}>{inv.moneda === 'USD' ? fmt.usd(inv.monto) : fmt.ves(inv.monto)}</div></div>
              <div><div className="small muted">Equivalente USD</div><div style={{ fontWeight: 700 }}>{fmt.usd(inv.monto_usd)}</div></div>
              <div><div className="small muted">Banco</div><div>{inv.banco}</div></div>
              <div><div className="small muted">Tasa</div><div>{inv.tasa ? Number(inv.tasa).toFixed(2) : '—'}</div></div>
              <div><div className="small muted">Beneficiario</div><div>{inv.beneficiario || '—'}</div></div>
              <div><div className="small muted">Registrado por</div><CreadoPorCell nombre={inv.creado_por} /></div>
            </div>
            {inv.notas && <div><div className="small muted">Notas</div><div className="small">{inv.notas}</div></div>}
            {/* El vínculo con el banco a la vista: una inversión que no se puede rastrear hasta el
                movimiento que la descontó es un número sin respaldo. */}
            <div className="small muted" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              Movimiento bancario: <span className="mono">{inv.movimiento_id || '—'}</span>
              <div style={{ marginTop: 2 }}>No suma en «Egresos / gastos» del panel de finanzas: se informa en su propio renglón.</div>
            </div>
          </div>
        ) : (
          <div className="modal-body" style={{ padding: 0 }}>
            <window.ActivityLogModal modulo="inversiones" entidadId={inv.id} entidadLabel={inv.concepto} inline />
          </div>
        )}
        <div className="modal-footer">
          {puedeBorrar && (
            <button className="btn danger" onClick={borrar} disabled={borrando}>
              <Icon name="trash" size={14} />{borrando ? 'Eliminando…' : 'Eliminar'}
            </button>
          )}
          <button className="btn" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

// ── Página ────────────────────────────────────────────────────────────────────────────────────
window.InversionesPage = function InversionesPage() {
  const [rows, setRows]       = iSt(null);
  const [nueva, setNueva]     = iSt(false);
  const [sel, setSel]         = iSt(null);
  const [buscar, setBuscar]   = window.usePersistedState('ss-inversiones-f-buscar', '');
  const [catF, setCatF]       = window.usePersistedState('ss-inversiones-f-cat', '');
  const [desde, setDesde]     = window.usePersistedState('ss-inversiones-f-desde', '');
  const [hasta, setHasta]     = window.usePersistedState('ss-inversiones-f-hasta', '');
  // Filtro por quién registró: la columna "Registrado por" ya se muestra pero no se podía filtrar,
  // que es justo lo que hace falta para rastrear diferencias entre lo que cargó cada persona.
  const [userF, setUserF]     = window.usePersistedState('ss-inversiones-f-usuario', '');
  // La página NO se persiste: volver a la página 7 de una lista que cambió muestra una tabla vacía.
  const [page, setPage]       = iSt(1);
  const [pageSz, setPageSz]   = iSt(() => {
    const v = parseInt(localStorage.getItem('ss-inversiones-pagesize'));
    return [25, 50, 100, 200].includes(v) ? v : 50;
  });
  iEff(() => { localStorage.setItem('ss-inversiones-pagesize', String(pageSz)); }, [pageSz]);

  async function cargar() {
    const r = await window.loadInversiones({ desde: desde || null, hasta: hasta || null });
    setRows(r.error ? [] : (r.data || []));
  }
  iEff(() => { cargar(); }, [desde, hasta]);
  iEff(() => { setPage(1); }, [buscar, catF, desde, hasta, userF]);

  // Quiénes registraron: sale de las propias filas, no de la tabla de usuarios.
  const usuariosInv = iMemo(
    () => [...new Set((rows || []).map(r => r.creado_por).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')),
    [rows]);

  const filtradas = iMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (rows || []).filter(r =>
      (!catF || r.categoria === catF) &&
      (!userF || (r.creado_por || '') === userF) &&
      (!q || [r.concepto, r.beneficiario, r.banco, r.id].some(x => (x || '').toLowerCase().includes(q))));
  }, [rows, buscar, catF, userF]);

  const totalUsd = iMemo(() => filtradas.reduce((s, r) => s + (Number(r.monto_usd) || 0), 0), [filtradas]);
  const totalPags = Math.max(1, Math.ceil(filtradas.length / pageSz));
  const pagina = filtradas.slice((page - 1) * pageSz, page * pageSz);

  function exportar() {
    window.exportToXLSX?.(filtradas.map(r => ({
      fecha: r.fecha, concepto: r.concepto, categoria: invCatLabel(r.categoria),
      beneficiario: r.beneficiario || '', banco: r.banco, moneda: r.moneda,
      monto: Number(r.monto) || 0, monto_usd: Number(r.monto_usd) || 0,
      tasa: r.tasa || '', movimiento: r.movimiento_id || '', registrado_por: r.creado_por || '', id: r.id,
    })), [
      { key: 'fecha', label: 'Fecha' }, { key: 'concepto', label: 'Concepto' },
      { key: 'categoria', label: 'Categoria' }, { key: 'beneficiario', label: 'Beneficiario' },
      { key: 'banco', label: 'Banco' }, { key: 'moneda', label: 'Moneda' },
      { key: 'monto', label: 'Monto' }, { key: 'monto_usd', label: 'Monto USD' },
      { key: 'tasa', label: 'Tasa' }, { key: 'movimiento', label: 'Movimiento bancario' },
      { key: 'registrado_por', label: 'Registrado por' }, { key: 'id', label: 'ID' },
    ], 'inversiones', 'Inversiones');
  }

  const puedeCrear = window.canUser ? window.canUser('crear', 'inversiones') : true;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Inversiones</h1>
          <div className="page-subtitle">
            Capex: sale del banco, no es gasto de la operación ni deuda con un proveedor
          </div>
        </div>
        <div className="page-actions" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={exportar} disabled={!filtradas.length}>
            <Icon name="download" size={14} />Exportar
          </button>
          {puedeCrear && (
            <button className="btn primary" onClick={() => setNueva(true)}>
              <Icon name="plus" size={14} />Nueva inversión
            </button>
          )}
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: 12 }}>
        <div className="stat" style={{ borderLeft: '3px solid var(--brand)' }}>
          <div className="stat-label">Total invertido</div>
          <div className="stat-val" style={{ fontSize: 22 }}>{fmt.usd(totalUsd)}</div>
          <div className="small mt-2" style={{ color: 'var(--text-muted)' }}>{filtradas.length} registro{filtradas.length === 1 ? '' : 's'}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: 'flex', gap: 8, padding: 12, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <input className="input sm" placeholder="Buscar concepto, beneficiario o banco…" value={buscar}
                 onChange={e => setBuscar(e.target.value)} style={{ minWidth: 240, flex: 1 }} />
          <select className="select sm" value={catF} onChange={e => setCatF(e.target.value)}>
            <option value="">Todas las categorías</option>
            {INV_CATEGORIAS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <input type="date" className="input sm" style={{ width: 140 }} title="Desde" value={desde} onChange={e => setDesde(e.target.value)} />
          <input type="date" className="input sm" style={{ width: 140 }} title="Hasta" value={hasta} onChange={e => setHasta(e.target.value)} />
          <select className="select sm" value={userF} onChange={e => setUserF(e.target.value)} title="Registrado por">
            <option value="">Todos los usuarios</option>
            {usuariosInv.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>
              <th>Fecha</th><th>Concepto</th><th className="dt-hide-mobile">Categoría</th>
              <th className="dt-hide-mobile">Banco</th><th className="num">Monto</th>
              <th className="num">USD</th><th className="dt-hide-mobile">Registrado por</th>
            </tr></thead>
            <tbody>
              {rows === null ? (
                <tr><td colSpan={7} className="empty">Cargando inversiones…</td></tr>
              ) : pagina.length === 0 ? (
                <tr><td colSpan={7} className="empty">
                  {filtradas.length === 0 && (rows || []).length === 0
                    ? 'Todavía no hay inversiones registradas'
                    : 'Ninguna inversión coincide con el filtro'}
                </td></tr>
              ) : pagina.map(r => (
                <tr key={r.id} onClick={() => setSel(r)} style={{ cursor: 'pointer' }}>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmt.date(r.fecha)}</td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{r.concepto}</div>
                    {r.beneficiario && <div className="small muted">{r.beneficiario}</div>}
                  </td>
                  <td className="small dt-hide-mobile">{invCatLabel(r.categoria)}</td>
                  <td className="small dt-hide-mobile">{r.banco}</td>
                  <td className="num mono">{r.moneda === 'USD' ? fmt.usd(r.monto) : fmt.ves(r.monto)}</td>
                  <td className="num mono" style={{ fontWeight: 700 }}>{fmt.usd(r.monto_usd)}</td>
                  <td className="dt-hide-mobile"><CreadoPorCell nombre={r.creado_por} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtradas.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--border)', fontSize: 12, gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <select className="select" value={pageSz} onChange={e => { setPageSz(parseInt(e.target.value)); setPage(1); }} style={{ fontSize: 12, padding: '3px 6px' }}>
                {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <span className="muted">{filtradas.length} registros · página {page} de {totalPags}</span>
            </div>
            {totalPags > 1 && (
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><Icon name="chevronL" size={12} /></button>
                <button className="btn ghost sm" disabled={page >= totalPags} onClick={() => setPage(p => p + 1)}><Icon name="chevronR" size={12} /></button>
              </div>
            )}
          </div>
        )}
      </div>

      {nueva && <NuevaInversionModal onClose={() => setNueva(false)} onSaved={cargar} />}
      {sel && <InversionDetalle inv={sel} onClose={() => setSel(null)} onDeleted={cargar} />}
    </div>
  );
};

// Restaurar desde la papelera: se vuelve a crear con la misma RPC, así el egreso bancario y el
// saldo quedan igual que la primera vez. El id nuevo es otro — el viejo ya no existe y forzarlo
// obligaría a reinsertar también su movimiento a mano, que es justo lo que la RPC evita.
window.ssTrashHandlers = window.ssTrashHandlers || {};
window.ssTrashHandlers['inversion'] = async (data) => {
  const { error } = await window.crearInversion({
    fecha: data.fecha, concepto: data.concepto, categoria: data.categoria,
    beneficiario: data.beneficiario, monto: data.monto,
    cuentaBancariaId: data.cuenta_bancaria_id, tasa: data.tasa, notas: data.notas,
  });
  return error ? { error: error.message || 'No se pudo restaurar' } : { ok: true };
};
