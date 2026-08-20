// ═══════════════════════════════════════════════════════════════════════════════════════════
//  RETENCIONES (IVA / ISLR)
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// EL CASO (reunión del 2026-08-05): una factura de 817,90 de base + IVA = 948. El cliente retiene
// el 75% del IVA y paga 850. Los ~98 que quedan NO se van a cobrar nunca: el cliente los enteró al
// SENIAT y entrega el comprobante.
//
// LA DECISIÓN (del usuario): la cuenta "se pone en 0 porque al final no es plata para el negocio",
// y lo retenido se registra acá para que la contadora lo declare.
//
// Entonces la retención REDUCE el monto de la cuenta y NO se suma a `pagado`. Si se sumara, la
// cuenta cerraría igual pero el dashboard diría que entraron 948 cuando al banco entraron 850:
// 98 dólares de cobranza que no están en ningún banco. Toda la mecánica (lock, tope contra el
// saldo, estado, registro) vive en la RPC `aplicar_retencion`. Ver migracion-odoo/40_retenciones.sql.
// ═══════════════════════════════════════════════════════════════════════════════════════════
const { useState: rSt, useEffect: rEff, useMemo: rMemo } = React;

const RET_TIPOS = [
  { id: 'iva',  label: 'Retención de IVA' },
  { id: 'islr', label: 'Retención de ISLR' },
];
const retTipoLabel = (t) => (RET_TIPOS.find(x => x.id === t)?.label || String(t || '').toUpperCase());

// ─── Modal: aplicar una retención a una cuenta ──────────────────────────────────────────────
// Se usa desde los DOS caminos de cobro (Cuentas por Cobrar y el detalle del documento en el POS)
// y desde Cuentas por Pagar. Recibe la cuenta ya elegida; no la busca.
window.RetencionModal = function RetencionModal({ cuentaTipo = 'cobrar', cuenta, entidadNombre, onClose, onDone }) {
  const esCobrar = cuentaTipo === 'cobrar';
  const saldo = Math.max(0, (parseFloat(cuenta?.monto) || 0) - (parseFloat(cuenta?.pagado) || 0));
  const [tipo, setTipo]       = rSt('iva');
  const [montoStr, setMonto]  = rSt(saldo > 0 ? saldo.toFixed(2) : '');
  const [numero, setNumero]   = rSt('');
  const [fecha, setFecha]     = rSt(window.localDateStr());
  const [notas, setNotas]     = rSt('');
  const [error, setError]     = rSt('');
  const [saving, setSaving]   = rSt(false);

  const monto = parseFloat(montoStr) || 0;
  const restante = Math.round((saldo - monto) * 100) / 100;

  async function guardar() {
    setError('');
    if (!(monto > 0))            { setError('Escribí el monto retenido.'); return; }
    if (monto > saldo + 0.005)   { setError(`La retención no puede superar el saldo pendiente (${fmt.usd(saldo)}).`); return; }
    setSaving(true);
    const { data, error: e } = await window.aplicarRetencion({
      cuentaTipo, cuentaId: cuenta.id, tipo, montoUsd: monto,
      numero: numero.trim() || null, fecha, notas: notas.trim() || null,
    });
    setSaving(false);
    if (e) { setError(e.message || 'No se pudo aplicar la retención.'); return; }
    onDone?.(data);
    onClose?.();
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose?.(); }} style={{zIndex:600}}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{maxWidth:480, width:'95vw'}}>
        <div className="modal-header">
          <div style={{flex:1}}>
            <div className="modal-title">Aplicar retención</div>
            <div className="small muted">{cuenta?.factura || cuenta?.id}{entidadNombre ? ' · ' + entidadNombre : ''}</div>
          </div>
          <button className="icon-btn" onClick={onClose} disabled={saving}><Icon name="x" size={14}/></button>
        </div>

        <div className="modal-body" style={{padding:'16px 18px', display:'flex', flexDirection:'column', gap:12}}>
          {/* Qué va a pasar, dicho antes de que pase. Bajar una deuda no es un movimiento
              cualquiera: hay que ver el número final antes de confirmar. */}
          <div style={{padding:'10px 12px', background:'var(--bg-sunken)', borderRadius:8, fontSize:12.5, lineHeight:1.7}}>
            {/* La cuenta entera, no solo el saldo: el usuario viene de la factura y tiene que poder
                atar el número de acá con el que tiene en la mano. */}
            <div style={{display:'flex', justifyContent:'space-between'}}>
              <span className="muted">Monto de la cuenta</span><span className="mono">{fmt.usd(parseFloat(cuenta?.monto) || 0)}</span>
            </div>
            <div style={{display:'flex', justifyContent:'space-between'}}>
              <span className="muted">{esCobrar ? 'Ya cobrado' : 'Ya pagado'}</span>
              <span className="mono" style={{color:'var(--success)'}}>{fmt.usd(parseFloat(cuenta?.pagado) || 0)}</span>
            </div>
            <div style={{display:'flex', justifyContent:'space-between'}}>
              <span className="muted">Saldo pendiente</span><strong className="mono">{fmt.usd(saldo)}</strong>
            </div>
            <div style={{display:'flex', justifyContent:'space-between'}}>
              <span className="muted">Se retiene</span>
              <strong className="mono" style={{color:'var(--warn,#b45309)'}}>−{fmt.usd(monto)}</strong>
            </div>
            <div style={{display:'flex', justifyContent:'space-between', borderTop:'1px solid var(--border)', paddingTop:5, marginTop:5}}>
              <span style={{fontWeight:600}}>{esCobrar ? 'Queda por cobrar' : 'Queda por pagar'}</span>
              <strong className="mono" style={{color: restante <= 0.005 ? 'var(--success)' : 'var(--text)'}}>
                {fmt.usd(Math.max(0, restante))}
              </strong>
            </div>
          </div>

          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
            <div>
              <label className="form-label">Tipo</label>
              <select className="select" style={{width:'100%'}} value={tipo} onChange={e => setTipo(e.target.value)}>
                {RET_TIPOS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Monto retenido (USD)</label>
              <input className="input" type="number" step="0.01" min="0" value={montoStr}
                     onChange={e => setMonto(e.target.value)} placeholder="0.00"/>
            </div>
            <div>
              <label className="form-label">N° de comprobante</label>
              <input className="input" value={numero} onChange={e => setNumero(e.target.value)}
                     placeholder="El que emite quien retiene"/>
            </div>
            <div>
              <label className="form-label">Fecha</label>
              <input className="input" type="date" value={fecha} onChange={e => setFecha(e.target.value)}/>
            </div>
          </div>
          <div>
            <label className="form-label">Notas</label>
            <input className="input" value={notas} onChange={e => setNotas(e.target.value)}
                   placeholder="Opcional"/>
          </div>

          <div className="small muted" style={{lineHeight:1.65}}>
            La retención <strong>no cuenta como cobro</strong>: baja la deuda porque esa plata la
            entera {esCobrar ? 'el cliente' : 'la empresa'} al SENIAT y no va a entrar al banco. La
            factura sigue emitida por su monto original; lo que se ajusta es la cuenta.
          </div>

          {error && <div className="small" style={{color:'var(--danger)'}}>{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={guardar} disabled={saving || !(monto > 0)}>
            {saving ? 'Aplicando…' : `Aplicar ${fmt.usd(monto)}`}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Módulo: Retenciones ────────────────────────────────────────────────────────────────────
window.RetencionesPage = function RetencionesPage() {
  const [rows, setRows]   = rSt(null);
  const [desde, setDesde] = window.usePersistedState('ss-retenciones-f-desde', '');
  const [hasta, setHasta] = window.usePersistedState('ss-retenciones-f-hasta', '');
  const [tipoF, setTipoF] = window.usePersistedState('ss-retenciones-f-tipo', '');
  const [q, setQ]         = window.usePersistedState('ss-retenciones-f-q', '');
  // La página NO se persiste: volver a la página 7 de una lista que cambió muestra una tabla vacía.
  const [page, setPage]   = rSt(1);
  const [pageSz, setPageSz] = rSt(() => {
    const v = parseInt(localStorage.getItem('ss-retenciones-pagesize'));
    return [25, 50, 100, 200].includes(v) ? v : 50;
  });
  rEff(() => { localStorage.setItem('ss-retenciones-pagesize', String(pageSz)); }, [pageSz]);

  async function cargar() {
    const r = await window.loadRetenciones({ desde: desde || null, hasta: hasta || null });
    const filas = r.error ? [] : (r.data || []);
    // Los nombres de cliente NO están en memoria: el catálogo (13.096) no viaja en el arranque, y
    // acá se necesitan solo los que aparecen en pantalla. `ensureClientes` los trae por id.
    const ids = [...new Set(filas.map(f => f.cliente_id).filter(Boolean))];
    if (ids.length) { try { await window.ensureClientes?.(ids); } catch (_) {} }
    setRows(filas);
  }
  // Nombre del cliente (o del proveedor cuando la retención es de una cuenta por pagar).
  function nombreEntidad(r) {
    if (r.cliente_id) {
      const c = (window.SSData.clientes || []).find(x => x.id === r.cliente_id);
      return c?.nombre || r.cliente_id;
    }
    if (r.proveedor_id) {
      const p = (window.SSData.proveedores || []).find(x => x.id === r.proveedor_id);
      return p?.nombre || r.proveedor_id;
    }
    return null;
  }
  rEff(() => { cargar(); }, [desde, hasta]);
  rEff(() => { setPage(1); }, [desde, hasta, tipoF, q]);

  const filtradas = rMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows || []).filter(r =>
      (!tipoF || r.tipo === tipoF) &&
      (!t || [r.numero_comprobante, r.documento_id, r.cuenta_id, r.notas, r.creado_por]
              .some(x => (x || '').toLowerCase().includes(t))));
  }, [rows, tipoF, q]);

  const totalUsd = rMemo(() => filtradas.reduce((s, r) => s + (Number(r.monto_usd) || 0), 0), [filtradas]);
  const porTipo  = rMemo(() => {
    const m = {};
    filtradas.forEach(r => { m[r.tipo] = (m[r.tipo] || 0) + (Number(r.monto_usd) || 0); });
    return m;
  }, [filtradas]);
  // Agrupado por período fiscal: es como se declara.
  const porPeriodo = rMemo(() => {
    const m = {};
    filtradas.forEach(r => {
      const p = r.periodo || String(r.fecha || '').slice(0, 7);
      m[p] = (m[p] || 0) + (Number(r.monto_usd) || 0);
    });
    return Object.entries(m).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtradas]);

  const totalPags = Math.max(1, Math.ceil(filtradas.length / pageSz));
  const pagina = filtradas.slice((page - 1) * pageSz, page * pageSz);

  async function revertir(r) {
    if (!confirm(`¿Revertir esta retención de ${fmt.usd(r.monto_usd)}?\n\n` +
                 `La deuda de ${r.documento_id || r.cuenta_id} vuelve a subir ${fmt.usd(r.monto_usd)} ` +
                 `y el registro se elimina.`)) return;
    const { error } = await window.revertirRetencion(r.id);
    if (error) { alert('No se pudo revertir: ' + (error.message || 'error')); return; }
    await cargar();
  }

  function exportar() {
    if (!filtradas.length) { alert('No hay retenciones para exportar con los filtros puestos.'); return; }
    window.exportToXLSX?.(filtradas.map(r => ({
      fecha: r.fecha, periodo: r.periodo || '', tipo: retTipoLabel(r.tipo),
      sentido: r.cuenta_tipo === 'cobrar' ? 'Nos retienen' : 'Retenemos',
      comprobante: r.numero_comprobante || '', entidad: nombreEntidad(r) || '',
      documento: r.documento_id || '',
      cuenta: r.cuenta_id, monto_usd: Number(r.monto_usd) || 0,
      notas: r.notas || '', registrado_por: r.creado_por || '', id: r.id,
    })), [
      { key:'fecha',          label:'Fecha' },
      { key:'periodo',        label:'Período' },
      { key:'tipo',           label:'Tipo' },
      { key:'sentido',        label:'Sentido' },
      { key:'comprobante',    label:'N° comprobante' },
      { key:'entidad',        label:'Cliente / Proveedor' },
      { key:'documento',      label:'Documento' },
      { key:'cuenta',         label:'Cuenta' },
      { key:'monto_usd',      label:'Monto (USD)' },
      { key:'notas',          label:'Notas' },
      { key:'registrado_por', label:'Registrado por' },
      { key:'id',             label:'ID' },
    ], 'retenciones', 'Retenciones');
  }

  const hayFiltro = !!(desde || hasta || tipoF || q);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Retenciones</h1>
          <div className="page-subtitle">
            IVA e ISLR retenidos. No son cobros: bajan la deuda porque esa plata se entera al SENIAT.
          </div>
        </div>
        <div className="page-actions">
          <button className="btn secondary" onClick={exportar}><Icon name="download" size={14}/><span className="hide-sm">Exportar</span></button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">Total retenido</div>
          <div className="stat-val">{fmt.usd(totalUsd)}</div>
          <div className="small mt-2">{filtradas.length} comprobante(s){hayFiltro ? ' con los filtros puestos' : ''}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Retención de IVA</div>
          <div className="stat-val">{fmt.usd(porTipo.iva || 0)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Retención de ISLR</div>
          <div className="stat-val">{fmt.usd(porTipo.islr || 0)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Períodos con movimiento</div>
          <div className="stat-val">{porPeriodo.length}</div>
          <div className="small mt-2">{porPeriodo[0] ? `${porPeriodo[0][0]}: ${fmt.usd(porPeriodo[0][1])}` : '—'}</div>
        </div>
      </div>

      <div className="card" style={{padding:0, marginTop:14}}>
        <div style={{display:'flex', gap:8, padding:12, borderBottom:'1px solid var(--border)', flexWrap:'wrap'}}>
          <input className="input sm" placeholder="Buscar comprobante, documento o nota…" value={q}
                 onChange={e => setQ(e.target.value)} style={{minWidth:240, flex:1}}/>
          <select className="select sm" value={tipoF} onChange={e => setTipoF(e.target.value)}>
            <option value="">Todos los tipos</option>
            {RET_TIPOS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <input type="date" className="input sm" style={{width:140}} title="Desde" value={desde} onChange={e => setDesde(e.target.value)}/>
          <input type="date" className="input sm" style={{width:140}} title="Hasta" value={hasta} onChange={e => setHasta(e.target.value)}/>
          {hayFiltro && (
            <button className="btn ghost sm" onClick={() => { setQ(''); setTipoF(''); setDesde(''); setHasta(''); }}>
              <Icon name="x" size={12}/>Limpiar
            </button>
          )}
        </div>

        <div className="tbl-scroll">
          <table className="tbl">
            <thead><tr>
              <th>Fecha</th>
              <th className="dt-hide-mobile">Período</th>
              <th>Tipo</th>
              <th className="dt-hide-mobile">Comprobante</th>
              <th>Cliente / Proveedor</th>
              <th>Documento</th>
              <th className="num">Monto USD</th>
              <th className="dt-hide-mobile">Registrado por</th>
              <th></th>
            </tr></thead>
            <tbody>
              {rows === null ? (
                <tr><td colSpan={9} className="muted" style={{padding:20, textAlign:'center'}}>Cargando…</td></tr>
              ) : pagina.length === 0 ? (
                <tr><td colSpan={9} className="muted" style={{padding:20, textAlign:'center'}}>
                  {hayFiltro ? 'No hay retenciones con esos filtros.' : 'Todavía no hay retenciones registradas. Se cargan al registrar el cobro de una factura.'}
                </td></tr>
              ) : pagina.map(r => (
                <tr key={r.id}>
                  <td style={{whiteSpace:'nowrap'}}>{fmt.date(r.fecha)}</td>
                  <td className="dt-hide-mobile mono small">{r.periodo || '—'}</td>
                  <td>
                    <span className="chip" style={{background:'var(--bg-sunken)'}}>{(r.tipo || '').toUpperCase()}</span>
                    {r.cuenta_tipo === 'pagar' && <span className="small muted" style={{marginLeft:6}}>a proveedor</span>}
                  </td>
                  <td className="dt-hide-mobile mono small">{r.numero_comprobante || '—'}</td>
                  {/* El nombre, y un enlace para ir a su ficha. Sin esto la retención decía a qué
                      documento pertenece pero no de QUIÉN es, que es lo primero que se pregunta. */}
                  <td>
                    {(() => {
                      const nom = nombreEntidad(r);
                      if (!nom) return <span className="muted small">—</span>;
                      if (!r.cliente_id) return <span className="small">{nom}</span>;
                      return (
                        <button className="btn ghost sm" title={`Ver la ficha de ${nom}`}
                                style={{padding:'2px 6px', fontSize:12.5, textAlign:'left', maxWidth:210,
                                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}
                                onClick={() => {
                                  window.__ssOpenCliente = r.cliente_id;
                                  window.__ssNavigate?.('/clientes');
                                }}>
                          {nom}
                        </button>
                      );
                    })()}
                  </td>
                  <td className="mono small">{r.documento_id || r.cuenta_id}</td>
                  <td className="num strong-num">{fmt.usd(r.monto_usd)}</td>
                  <td className="dt-hide-mobile small">{r.creado_por || 'Sistema'}</td>
                  <td style={{textAlign:'right'}}>
                    <button className="btn ghost sm" title="Revertir: la deuda vuelve a subir"
                            onClick={() => revertir(r)}><Icon name="undo" size={13}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtradas.length > pageSz && (
          <div style={{display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderTop:'1px solid var(--border)', flexWrap:'wrap'}}>
            <select className="select sm" value={pageSz} onChange={e => setPageSz(parseInt(e.target.value))}>
              {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} por página</option>)}
            </select>
            <span className="small muted">{filtradas.length.toLocaleString('es-VE')} retenciones</span>
            <div style={{marginLeft:'auto', display:'flex', gap:6, alignItems:'center'}}>
              <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><Icon name="chevronL" size={13}/></button>
              <span className="small">{page} / {totalPags}</span>
              <button className="btn ghost sm" disabled={page >= totalPags} onClick={() => setPage(p => p + 1)}><Icon name="chevronR" size={13}/></button>
            </div>
          </div>
        )}
      </div>

      {porPeriodo.length > 0 && (
        <div className="card mt-4" style={{padding:16}}>
          <div className="card-title" style={{marginBottom:10}}>Por período fiscal</div>
          <div style={{display:'flex', flexDirection:'column', gap:6}}>
            {porPeriodo.map(([p, monto]) => (
              <div key={p} style={{display:'flex', justifyContent:'space-between', fontSize:13, padding:'5px 0', borderBottom:'1px solid var(--border)'}}>
                <span className="mono">{p}</span>
                <strong className="mono">{fmt.usd(monto)}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
