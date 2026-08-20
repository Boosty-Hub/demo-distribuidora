// ════════════════════════════════════════════════════════════════════════════
//  anticipos.jsx — Finanzas → Anticipos
//
//  Un ANTICIPO es dinero que el cliente entrega sin que exista todavía cotización
//  ni orden. No es una cuenta por cobrar (esa es un activo; el anticipo es un
//  pasivo: se le debe mercancía al cliente), por eso vive aparte.
//
//  Modelo: el anticipo ES un `pago` con categoria='anticipo' y documento_id NULL
//  (vista `v_anticipos`, que ya calcula el saldo). Su consumo contra facturas se
//  registra en `anticipos_aplicaciones` — no mueve banco, el dinero ya entró.
//
//  La aplicación es SIEMPRE MANUAL. El sistema sugiere de forma visible cuando un
//  cliente tiene saldo a favor, pero nunca lo aplica solo: cobranza tiene que
//  decidir contra qué factura va, y un automatismo es difícil de revertir.
// ════════════════════════════════════════════════════════════════════════════

const ANT_ESTADO_CHIP = {
  disponible: { cls: 'green',   label: 'Disponible' },
  parcial:    { cls: 'amber',   label: 'Parcial' },
  consumido:  { cls: 'neutral', label: 'Consumido' },
};

function antMoneda(m, moneda) {
  return moneda === 'VES' ? fmt.ves(m) : fmt.usd(m);
}

// Mismo helper que business.jsx (`irAMovimientoBancario`), copiado acá: business.jsx es OTRO chunk
// lazy y puede no estar cargado si se entra a /anticipos directo, sin pasar antes por /banco.
function antIrAMovimiento(cuentaId, movId) {
  if (!movId || !cuentaId) return;
  try { sessionStorage.setItem('ss-bank-focus', JSON.stringify({ cuentaId, movId })); } catch (e) {}
  if (window.__ssNavigate) { window.__ssNavigate('/banco/' + cuentaId); return; }
  history.pushState(null, '', (window.ssBase ? window.ssBase('/' + (window.currentEmpresa || 'demo1') + '/banco/' + cuentaId) : ('/' + (window.currentEmpresa || 'demo1') + '/banco/' + cuentaId)));
  window.dispatchEvent(new PopStateEvent('popstate'));
}

// ─── De qué tasa entró la plata ─────────────────────────────────────────────
// El anticipo en bolívares CONGELA su tasa: es la que va a decidir, meses después, cuántos dólares
// de saldo a favor tiene el cliente y con qué se puede cruzar. Hasta acá el campo era un número
// suelto autocompletado con el BCV, así que quien recibía un vuelto o un pago en paralelo tenía que
// acordarse del valor y tipearlo — y un dígito de menos en ese campo no se nota nunca más.
//
// El vuelto es una tasa PROPIA del negocio (se configura en el panel de tasas del header) y es la
// que se usa para devolverle excedentes al cliente; que no estuviera acá obligaba justamente a
// tipearla en el caso más frecuente. Cae a paralelo cuando no está definida, igual que en Bancos y
// en CxP — mismo criterio o el mismo vuelto valdría distinto según la pantalla.
function FuenteTasaAnticipo({ tasa, onPick }) {
  const t = window.SSData.tasa || {};
  const OPTS = [
    { k: 'bcv',      l: 'BCV',      v: parseFloat(t.bcv) || 0 },
    { k: 'paralelo', l: 'Paralelo', v: parseFloat(t.paralelo) || 0 },
    { k: 'vuelto',   l: 'Vuelto',   v: parseFloat(t.vuelto) || parseFloat(t.paralelo) || 0 },
  ].filter(o => o.v > 0);
  if (!OPTS.length) return null;
  const actual = parseFloat(tasa) || 0;
  // Se marca por VALOR y no por la opción que se tocó: si el vuelto y el paralelo coinciden, decir
  // que la tasa es "de vuelto" cuando es el mismo número sería una precisión inventada.
  const elegida = OPTS.find(o => Math.abs(o.v - actual) < 0.005);
  return (
    <div style={{display:'flex',gap:5,marginTop:5,flexWrap:'wrap',alignItems:'center'}}>
      {OPTS.map(o => (
        <button key={o.k} type="button" className={'btn sm ' + (elegida?.k === o.k ? 'primary' : 'secondary')}
                title={`Usar la tasa ${o.l}: Bs. ${o.v}`}
                onClick={() => onPick(String(o.v))} style={{fontSize:11, padding:'3px 9px'}}>
          {o.l}
        </button>
      ))}
      {!elegida && actual > 0 && <span className="small muted" style={{fontSize:11}}>tasa manual</span>}
    </div>
  );
}

// ─── Modal: registrar anticipo ──────────────────────────────────────────────
function AnticipoFormModal({ clientePre, onClose, onSaved }) {
  const bancos  = (window.SSData.cuentasBancarias || []);
  const metodos = (window.SSData.metodosPago || []);
  const [clienteId, setClienteId] = React.useState(clientePre || '');
  // "Sin identificar" es una decisión EXPLÍCITA, no el resultado de olvidarse de elegir
  // cliente: si el campo simplemente fuese opcional, se llenaría de anticipos huérfanos
  // por descuido y nadie sabría cuáles se desconocen de verdad.
  const [sinCliente, setSinCliente] = React.useState(false);
  const [bancoId,   setBancoId]   = React.useState('');
  const [metodo,    setMetodo]    = React.useState('');
  const [monto,     setMonto]     = React.useState('');
  const [tasa,      setTasa]      = React.useState('');
  const [fecha,     setFecha]     = React.useState(window.localDateStr ? window.localDateStr() : new Date().toISOString().split('T')[0]);
  const [referencia, setReferencia] = React.useState('');
  const [notas,     setNotas]     = React.useState('');
  const [saving,    setSaving]    = React.useState(false);
  const [error,     setError]     = React.useState('');

  // EL BANCO MANDA: la moneda y las formas de pago salen de la cuenta elegida.
  const banco   = bancos.find(b => b.id === bancoId);
  const moneda  = banco?.moneda || 'USD';
  const codigos = banco?.metodos_pago || [];
  const metodosDelBanco = metodos.filter(m => codigos.includes(m.codigo));

  // Al cambiar de banco, el método anterior puede ya no aplicar.
  React.useEffect(() => {
    if (metodo && !codigos.includes(metodo)) setMetodo('');
    if (!metodo && metodosDelBanco.length === 1) setMetodo(metodosDelBanco[0].codigo);
  }, [bancoId]);

  const tasaNum  = parseFloat(tasa) || 0;
  const montoNum = parseFloat(monto) || 0;
  // En bolívares el valor se congela a la tasa del día: es lo que el cliente entregó.
  const montoUsd = moneda === 'VES' ? (tasaNum > 0 ? montoNum / tasaNum : 0) : montoNum;

  const tasaBCV = parseFloat(window.SSData.tasa?.bcv) || 0;
  React.useEffect(() => { if (moneda === 'VES' && !tasa && tasaBCV > 0) setTasa(String(tasaBCV)); }, [moneda]);

  async function guardar() {
    setError('');
    if (!clienteId && !sinCliente) return setError('Elige el cliente, o marca "no sé de quién es" para identificarlo después.');
    if (!bancoId)            return setError('Selecciona el banco donde entró el dinero.');
    if (!metodo)             return setError('Selecciona la forma de pago.');
    if (montoNum <= 0)       return setError('El monto debe ser mayor que cero.');
    if (moneda === 'VES' && tasaNum <= 0) return setError('En bolívares hace falta la tasa para registrar el equivalente en USD.');

    setSaving(true);
    const { error: err } = await window.crearAnticipo({
      clienteId: sinCliente ? null : clienteId, monto: montoNum, montoUsd, moneda,
      tasa: moneda === 'VES' ? tasaNum : null,
      metodo, cuentaBancariaId: bancoId, banco: banco?.banco,
      fecha, referencia, notas,
    });
    setSaving(false);
    if (err) return setError('No se pudo registrar: ' + (err.message || err));
    onSaved?.();
    onClose();
  }

  const clienteOpts = (window.SSData.clientes || [])
    .filter(c => c.activo !== false)
    .map(c => ({ value: c.id, label: c.nombre + (c.rif ? ' · ' + c.rif : '') }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-fullscreen-mobile" onClick={e => e.stopPropagation()} style={{ width: 560 }}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--success-soft,#dcfce7)',color:'var(--success)',display:'grid',placeItems:'center'}}>
            <Icon name="cash" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">Registrar anticipo</h3>
            <div className="small">Dinero recibido sin pedido asociado</div>
          </div>
          <button className="btn ghost sm" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        <div className="modal-body" style={{display:'flex',flexDirection:'column',gap:12}}>
          <div>
            <label className="form-label">Cliente {sinCliente ? '' : '*'}</label>
            {sinCliente ? (
              <div style={{background:'var(--warn-soft,#fef3c7)',border:'1px solid var(--warn)',borderRadius:8,
                           padding:'10px 12px',fontSize:12.5,display:'flex',alignItems:'center',gap:8}}>
                <Icon name="alert" size={15}/>
                <span>Queda <strong>sin identificar</strong>. El dinero se registra en el banco y el
                      cliente se elige después, al aplicarlo o desde el detalle.</span>
              </div>
            ) : (
              <SearchSelect value={clienteId} onChange={setClienteId} options={clienteOpts}
                            onSearchRemote={q => window.buscarClientesContactos(q, { soloClientes: true })}
                            placeholder="Buscar cliente por nombre o RIF..." />
            )}
            <label style={{display:'flex',alignItems:'center',gap:7,marginTop:8,fontSize:12.5,cursor:'pointer'}}>
              <input type="checkbox" checked={sinCliente}
                     onChange={e => { setSinCliente(e.target.checked); if (e.target.checked) setClienteId(''); }}/>
              No sé de quién es este dinero — identificarlo después
            </label>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <div>
              <label className="form-label">Banco / caja *</label>
              <select className="input" value={bancoId} onChange={e => setBancoId(e.target.value)}>
                <option value="">Seleccionar...</option>
                {bancos.map(b => <option key={b.id} value={b.id}>{b.banco} ({b.moneda})</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Forma de pago *</label>
              <select className="input" value={metodo} onChange={e => setMetodo(e.target.value)} disabled={!bancoId}>
                <option value="">{bancoId ? 'Seleccionar...' : 'Elige el banco primero'}</option>
                {metodosDelBanco.map(m => <option key={m.id} value={m.codigo}>{m.label}</option>)}
              </select>
              {bancoId && metodosDelBanco.length === 0 && (
                <div className="small" style={{color:'var(--danger)',fontSize:11,marginTop:3}}>
                  Este banco no tiene formas de pago configuradas.
                </div>
              )}
            </div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:moneda==='VES'?'1fr 1fr 1fr':'1fr 1fr',gap:10}}>
            <div>
              <label className="form-label">Monto ({moneda}) *</label>
              <input className="input" type="number" step="0.01" value={monto}
                     onChange={e => setMonto(e.target.value)} placeholder="0.00"/>
            </div>
            {moneda === 'VES' && (
              <div>
                <label className="form-label">Tasa (Bs/USD) *</label>
                <input className="input" type="number" step="0.01" value={tasa}
                       onChange={e => setTasa(e.target.value)} placeholder="0.00"/>
                <FuenteTasaAnticipo tasa={tasa} onPick={setTasa}/>
              </div>
            )}
            <div>
              <label className="form-label">Fecha</label>
              <input className="input" type="date" value={fecha} onChange={e => setFecha(e.target.value)}/>
            </div>
          </div>

          {moneda === 'VES' && (
            <div style={{background:'var(--bg-sunken)',borderRadius:8,padding:'8px 12px',fontSize:12.5}}>
              Equivale a <strong>{fmt.usd(montoUsd)}</strong>
              <span className="muted"> — el saldo a favor se guarda en USD a esta tasa.</span>
            </div>
          )}

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <div>
              <label className="form-label">Referencia</label>
              <input className="input" value={referencia} onChange={e => setReferencia(e.target.value)}
                     placeholder="Nro. de transferencia, voucher..."/>
            </div>
            <div>
              <label className="form-label">Notas</label>
              <input className="input" value={notas} onChange={e => setNotas(e.target.value)}
                     placeholder="Motivo del anticipo"/>
            </div>
          </div>

          {error && <div style={{color:'var(--danger)',fontSize:13}}>{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={guardar} disabled={saving}>
            {saving ? 'Guardando...' : 'Registrar anticipo'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: aplicar anticipo a una factura ──────────────────────────────────
function AplicarAnticipoModal({ anticipo, onClose, onSaved }) {
  const [documentoId, setDocumentoId] = React.useState('');
  const [monto, setMonto]   = React.useState('');
  const [notas, setNotas]   = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError]   = React.useState('');

  // Anticipo sin dueño: el cliente se elige ACÁ, que es justo el momento en que se sabe
  // de quién era la plata. Hasta elegirlo no hay contra qué aplicar, porque las facturas
  // pendientes son las de ese cliente.
  const sinIdentificar = !anticipo.cliente_id;
  const [nuevoCliente, setNuevoCliente] = React.useState('');
  const clienteEfectivo = anticipo.cliente_id || nuevoCliente;
  const nombreCliente = anticipo.cliente_nombre
    || (window.SSData.clientes || []).find(c => c.id === nuevoCliente)?.nombre
    || (sinIdentificar ? 'Sin identificar' : nuevoCliente);

  // Solo facturas del MISMO cliente que sigan debiendo.
  const pendientes = (window.SSData.cuentasCobrar || [])
    .filter(cc => cc.cliente_id === clienteEfectivo && cc.estado !== 'pagada')
    .map(cc => ({ ...cc, resta: (parseFloat(cc.monto) || 0) - (parseFloat(cc.pagado) || 0) }))
    .filter(cc => cc.resta > 0.005)
    .sort((a, b) => String(a.vence || '').localeCompare(String(b.vence || '')));

  const cxc    = pendientes.find(c => c.factura === documentoId);
  const saldo  = parseFloat(anticipo.saldo_usd) || 0;
  // Nunca se puede aplicar más que el saldo del anticipo ni más de lo que debe la factura.
  const tope   = cxc ? Math.min(saldo, cxc.resta) : saldo;

  // MONEDA DEL ANTICIPO. Si el dinero entró en bolívares (a un banco en bolívares), el usuario
  // razona en bolívares: mostrarle dólares lo obliga a convertir de cabeza y a dudar del monto.
  // La aplicación se GUARDA en USD (la deuda de la factura está en USD), así que acá se muestra en
  // Bs. a la tasa con la que entró la plata —la que quedó congelada en el anticipo— y se convierte
  // al escribir. Sin tasa no se puede convertir: se cae a dólares en vez de inventar una.
  const esVES = anticipo.moneda === 'VES' && (parseFloat(anticipo.tasa) || 0) > 0;
  const tasaAnt = parseFloat(anticipo.tasa) || 0;
  const aVista = (usd) => esVES ? usd * tasaAnt : usd;          // USD → moneda mostrada
  const aUsd   = (vista) => esVES ? vista / tasaAnt : vista;    // moneda mostrada → USD
  const fmtM   = (usd) => esVES ? fmt.ves(aVista(usd)) : fmt.usd(usd);
  const monedaLbl = esVES ? 'Bs.' : 'USD';

  React.useEffect(() => { if (cxc) setMonto(aVista(tope).toFixed(2)); }, [documentoId]);

  async function aplicar() {
    setError('');
    // `monto` está en la moneda mostrada; la RPC recibe USD.
    const mVista = parseFloat(monto) || 0;
    const m = Math.round(aUsd(mVista) * 100) / 100;
    if (sinIdentificar && !nuevoCliente) return setError('Elige de quién es este anticipo antes de aplicarlo.');
    if (!documentoId) return setError('Selecciona la factura a la que se aplica.');
    if (m <= 0)       return setError('El monto debe ser mayor que cero.');
    if (m > tope + 0.005) return setError(`El máximo aplicable a esta factura es ${fmtM(tope)}.`);

    setSaving(true);
    // Identificar PRIMERO: la RPC copia el cliente del anticipo a la fila de aplicación,
    // así que si se aplicara antes, la aplicación quedaría sin dueño. Si esto sale bien y
    // falla la aplicación, el anticipo queda identificado — que igual es progreso, no un
    // estado roto: se reintenta la aplicación y listo.
    if (sinIdentificar) {
      const { error: eAsig } = await window.asignarClienteAnticipo({ pagoId: anticipo.pago_id, clienteId: nuevoCliente });
      if (eAsig) { setSaving(false); return setError('No se pudo asignar el cliente: ' + (eAsig.message || eAsig)); }
    }
    const { error: err } = await window.aplicarAnticipo({
      pagoId: anticipo.pago_id, documentoId, monto: m, notas,
    });
    setSaving(false);
    if (err) return setError(err.message || String(err));
    onSaved?.();
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-fullscreen-mobile" onClick={e => e.stopPropagation()} style={{ width: 540 }}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}>
            <Icon name="link" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">Aplicar anticipo</h3>
            <div className="small">
              {nombreCliente} · saldo a favor {fmtM(saldo)}
              {esVES && <span className="muted"> ({fmt.usd(saldo)} @ {tasaAnt})</span>}
            </div>
          </div>
          <button className="btn ghost sm" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        <div className="modal-body" style={{display:'flex',flexDirection:'column',gap:12}}>
          {sinIdentificar && (
            <div>
              <label className="form-label">¿De quién es este dinero? *</label>
              <SearchSelect value={nuevoCliente} onChange={setNuevoCliente} options={[]}
                            onSearchRemote={q => window.buscarClientesContactos(q, { soloClientes: true })}
                            placeholder="Buscar cliente por nombre o RIF..." />
              <div className="small muted" style={{marginTop:5,fontSize:11.5}}>
                Al aplicar, el anticipo queda a nombre de este cliente (también en el movimiento
                del banco). Después de aplicarlo ya no se puede cambiar sin revertir.
              </div>
            </div>
          )}

          {sinIdentificar && !nuevoCliente ? (
            <div style={{background:'var(--bg-sunken)',borderRadius:8,padding:'14px',fontSize:13}}>
              Elige el cliente para ver sus facturas pendientes.
            </div>
          ) : pendientes.length === 0 ? (
            <div style={{background:'var(--bg-sunken)',borderRadius:8,padding:'14px',fontSize:13}}>
              Este cliente no tiene facturas pendientes. El anticipo queda disponible hasta que las tenga.
            </div>
          ) : (
            <React.Fragment>
              <div>
                <label className="form-label">Factura *</label>
                <select className="input" value={documentoId} onChange={e => setDocumentoId(e.target.value)}>
                  <option value="">Seleccionar...</option>
                  {pendientes.map(cc => (
                    <option key={cc.id} value={cc.factura}>
                      {cc.factura} — debe {fmtM(cc.resta)}{cc.vence ? ' · vence ' + cc.vence : ''}
                    </option>
                  ))}
                </select>
                <div className="small muted" style={{fontSize:11.5,marginTop:4}}>
                  {pendientes.length} factura{pendientes.length !== 1 ? 's' : ''} pendiente{pendientes.length !== 1 ? 's' : ''} de este cliente
                </div>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div>
                  <label className="form-label">Monto a aplicar ({monedaLbl}) *</label>
                  <input className="input" type="number" step="0.01" value={monto}
                         onChange={e => setMonto(e.target.value)} placeholder="0.00"/>
                  {cxc && <div className="small muted" style={{fontSize:11,marginTop:3}}>
                    Máximo {fmtM(tope)}
                    {esVES && <> · equivale a {fmt.usd(Math.round(aUsd(parseFloat(monto) || 0) * 100) / 100)}</>}
                  </div>}
                </div>
                <div>
                  <label className="form-label">Notas</label>
                  <input className="input" value={notas} onChange={e => setNotas(e.target.value)}/>
                </div>
              </div>

              {cxc && (() => {
                // El resumen se calcula en USD (como se guarda) y se muestra en la moneda del anticipo.
                const aplicaUsd = Math.round(aUsd(parseFloat(monto) || 0) * 100) / 100;
                return (
                  <div style={{background:'var(--bg-sunken)',borderRadius:8,padding:'10px 12px',fontSize:12.5}}>
                    Tras aplicar: la factura queda debiendo <strong>{fmtM(Math.max(0, cxc.resta - aplicaUsd))}</strong>
                    <span className="muted"> · al anticipo le quedan </span>
                    <strong>{fmtM(Math.max(0, saldo - aplicaUsd))}</strong>
                  </div>
                );
              })()}
              {error && <div style={{color:'var(--danger)',fontSize:13}}>{error}</div>}
            </React.Fragment>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={aplicar} disabled={saving || pendientes.length === 0}>
            {saving ? 'Aplicando...' : 'Aplicar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: vincular el anticipo con un traspaso YA HECHO a otra empresa ────
// Distinto de "Aplicar a factura": acá no se consume contra una deuda, se cierra porque la
// plata de este anticipo es la MISMA que ya viajó a la otra empresa como anticipo de otro
// cliente (traspaso entre cuentas de bancos). Ver `getTraspasosAnticipoSinVincular` en
// supabase.js para el criterio de qué cuenta como "candidato sin vincular".
function VincularTraspasoModal({ anticipo, onClose, onSaved }) {
  const [candidatos, setCandidatos] = React.useState(null);   // null = cargando
  const [error, setError]           = React.useState('');
  const [selId, setSelId]           = React.useState('');
  const [monto, setMonto]           = React.useState('');
  const [saving, setSaving]         = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    window.getTraspasosAnticipoSinVincular(anticipo.empresa_id).then(({ data, error: e }) => {
      if (!alive) return;
      if (e) { setError(e.message || String(e)); setCandidatos([]); return; }
      setCandidatos(data || []);
    });
    return () => { alive = false; };
  }, [anticipo.empresa_id]);

  const saldo = parseFloat(anticipo.saldo_usd) || 0;
  const sel   = (candidatos || []).find(c => c.matchId === selId) || null;
  const tope  = sel ? Math.min(saldo, sel.montoUsd) : saldo;

  React.useEffect(() => { if (sel) setMonto(tope.toFixed(2)); }, [selId]);

  async function vincular() {
    setError('');
    const m = Math.round((parseFloat(monto) || 0) * 100) / 100;
    if (!sel) return setError('Selecciona el traspaso a vincular.');
    if (m <= 0) return setError('El monto debe ser mayor que cero.');
    if (m > tope + 0.005) return setError(`El máximo para este traspaso es ${fmt.usd(tope)}.`);

    setSaving(true);
    const { error: err } = await window.vincularTraspasoAnticipo({
      pagoId: anticipo.pago_id, matchId: sel.matchId, montoUsd: m,
      empresaDestinoNombre: sel.empresaDestinoNombre, clienteDestinoNombre: sel.clienteNombre,
    });
    setSaving(false);
    if (err) return setError(err.message || String(err));
    onSaved?.();
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-fullscreen-mobile" onClick={e => e.stopPropagation()} style={{ width: 620 }}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}>
            <Icon name="truck" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">Vincular traspaso</h3>
            <div className="small">
              {anticipo.cliente_nombre || 'Sin identificar'} · saldo a favor {fmt.usd(saldo)}
            </div>
          </div>
          <button className="btn ghost sm" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        <div className="modal-body" style={{display:'flex',flexDirection:'column',gap:12}}>
          <div className="small muted" style={{fontSize:12}}>
            Traspasos salientes de esta empresa hacia otra que se marcaron como anticipo de un
            cliente allá, y que todavía no cerraron ningún anticipo acá. Al vincular uno, este
            saldo baja y queda registrado que esa plata es la misma que ya se acreditó allá —
            no se mueve dinero de nuevo.
          </div>

          {candidatos === null ? (
            <div className="small muted">Buscando traspasos…</div>
          ) : candidatos.length === 0 ? (
            <div style={{background:'var(--bg-sunken)',borderRadius:8,padding:'14px',fontSize:13}}>
              No hay traspasos salientes de esta empresa pendientes de vincular. Si el traspaso ya
              se hizo, revisa que se haya marcado como "es anticipo" al crearlo — si no, no queda
              registro de a qué empresa fue ni de qué cliente.
            </div>
          ) : (
            <React.Fragment>
              <div style={{display:'flex', flexDirection:'column', gap:6, maxHeight:260, overflowY:'auto'}}>
                {candidatos.map(c => (
                  <label key={c.matchId} style={{
                    display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:8, cursor:'pointer',
                    border: `1.5px solid ${selId === c.matchId ? 'var(--brand)' : 'var(--border)'}`,
                    background: selId === c.matchId ? 'var(--brand-soft)' : 'transparent',
                  }}>
                    <input type="radio" name="traspaso" checked={selId === c.matchId} onChange={() => setSelId(c.matchId)}/>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontWeight:600, fontSize:13}}>
                        {c.egreso?.banco || '—'} → {c.bancoDestino || '—'} ({c.empresaDestinoNombre})
                      </div>
                      <div className="small muted" style={{fontSize:11.5}}>
                        {c.fecha} · {fmt.usd(c.montoUsd)}
                        {c.clienteNombre ? ` · anticipo de ${c.clienteNombre}` : ' · cliente sin identificar allá'}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              {sel && (
                <div>
                  <label className="form-label">Monto a cerrar de este anticipo (USD) *</label>
                  <input className="input" type="number" step="0.01" value={monto}
                         onChange={e => setMonto(e.target.value)} placeholder="0.00"/>
                  <div className="small muted" style={{fontSize:11, marginTop:3}}>
                    Máximo {fmt.usd(tope)} (el menor entre el saldo de este anticipo y lo que se traspasó).
                  </div>
                </div>
              )}
              {error && <div style={{color:'var(--danger)',fontSize:13}}>{error}</div>}
            </React.Fragment>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={vincular} disabled={saving || !sel}>
            {saving ? 'Vinculando…' : 'Vincular y cerrar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: editar un anticipo ya registrado ────────────────────────────────
// Solo monto/tasa/fecha/referencia/notas/método — NO cliente ni banco (cambiar de cuenta es un
// traspaso de plata de verdad, no una corrección de datos). `editarAnticipo` sincroniza el
// movimiento bancario y estampa el badge "Editado" en los dos lados.
function EditarAnticipoModal({ anticipo, onClose, onSaved }) {
  const bancos  = (window.SSData.cuentasBancarias || []);
  const metodos = (window.SSData.metodosPago || []);
  const banco = bancos.find(b => b.id === anticipo.cuenta_bancaria_id);
  const codigos = banco?.metodos_pago || [];
  const metodosDelBanco = metodos.filter(m => codigos.includes(m.codigo));

  const [monto, setMonto] = React.useState(String(anticipo.monto ?? ''));
  const [tasa, setTasa]   = React.useState(String(anticipo.tasa ?? ''));
  const [fecha, setFecha] = React.useState(anticipo.fecha || '');
  const [referencia, setReferencia] = React.useState(anticipo.referencia || '');
  const [notas, setNotas] = React.useState(anticipo.notas || '');
  const [metodo, setMetodo] = React.useState(anticipo.metodo || '');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  const moneda = anticipo.moneda || 'USD';
  const tasaNum = parseFloat(tasa) || 0;
  const montoNum = parseFloat(monto) || 0;
  const montoUsd = moneda === 'VES' ? (tasaNum > 0 ? montoNum / tasaNum : 0) : montoNum;
  const aplicado = parseFloat(anticipo.aplicado_usd) || 0;

  async function guardar() {
    setError('');
    if (montoNum <= 0) return setError('El monto debe ser mayor que cero.');
    if (moneda === 'VES' && tasaNum <= 0) return setError('En bolívares hace falta la tasa.');
    if (montoUsd < aplicado - 0.005) return setError(`No se puede bajar de ${aplicado.toFixed(2)} USD: ya se aplicaron ${aplicado.toFixed(2)} de este anticipo.`);

    setSaving(true);
    const { error: err } = await window.editarAnticipo({
      pagoId: anticipo.pago_id, monto: montoNum, moneda,
      tasa: moneda === 'VES' ? tasaNum : null,
      fecha, referencia, notas, metodo,
    });
    setSaving(false);
    if (err) return setError('No se pudo guardar: ' + (err.message || err));
    onSaved?.();
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-fullscreen-mobile" onClick={e => e.stopPropagation()} style={{ width: 520 }}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}>
            <Icon name="edit" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">Editar anticipo</h3>
            <div className="small">{anticipo.cliente_nombre || 'Sin identificar'} · {banco?.banco || anticipo.banco || 'sin banco'}</div>
          </div>
          <button className="btn ghost sm" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        <div className="modal-body" style={{display:'flex',flexDirection:'column',gap:12}}>
          {aplicado > 0.005 && (
            <div style={{background:'var(--warn-soft,#fef3c7)',border:'1px solid var(--warn)',borderRadius:8,padding:'8px 12px',fontSize:12.5}}>
              Ya se aplicaron <strong>{fmt.usd(aplicado)}</strong> de este anticipo a facturas — el monto no puede bajar de eso.
            </div>
          )}
          <div style={{display:'grid',gridTemplateColumns:moneda==='VES'?'1fr 1fr 1fr':'1fr 1fr',gap:10}}>
            <div>
              <label className="form-label">Monto ({moneda}) *</label>
              <input className="input" type="number" step="0.01" value={monto} onChange={e => setMonto(e.target.value)} autoFocus/>
            </div>
            {moneda === 'VES' && (
              <div>
                <label className="form-label">Tasa (Bs/USD) *</label>
                <input className="input" type="number" step="0.01" value={tasa} onChange={e => setTasa(e.target.value)}/>
                {/* También al corregir: es donde se arregla justamente el anticipo que entró con la
                    tasa equivocada por haberla tipeado de memoria. */}
                <FuenteTasaAnticipo tasa={tasa} onPick={setTasa}/>
              </div>
            )}
            <div>
              <label className="form-label">Fecha</label>
              <input className="input" type="date" value={fecha} onChange={e => setFecha(e.target.value)}/>
            </div>
          </div>

          {moneda === 'VES' && (
            <div style={{background:'var(--bg-sunken)',borderRadius:8,padding:'8px 12px',fontSize:12.5}}>
              Equivale a <strong>{fmt.usd(montoUsd)}</strong>
            </div>
          )}

          {metodosDelBanco.length > 0 && (
            <div>
              <label className="form-label">Forma de pago</label>
              <select className="input" value={metodo} onChange={e => setMetodo(e.target.value)}>
                <option value="">Seleccionar...</option>
                {metodosDelBanco.map(m => <option key={m.id} value={m.codigo}>{m.label}</option>)}
              </select>
            </div>
          )}

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <div>
              <label className="form-label">Referencia</label>
              <input className="input" value={referencia} onChange={e => setReferencia(e.target.value)}/>
            </div>
            <div>
              <label className="form-label">Notas</label>
              <input className="input" value={notas} onChange={e => setNotas(e.target.value)}/>
            </div>
          </div>

          {error && <div style={{color:'var(--danger)',fontSize:13}}>{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={guardar} disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: identificar al dueño de un anticipo ─────────────────────────────
// Aparte del que se hace al aplicar: cuando se averigua de quién era la plata pero
// todavía no hay factura contra la que aplicarla, igual conviene dejarla atribuida.
function IdentificarClienteModal({ anticipo, onClose, onSaved }) {
  const [clienteId, setClienteId] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError]   = React.useState('');

  async function guardar() {
    setError('');
    if (!clienteId) return setError('Elige el cliente.');
    setSaving(true);
    const { error: err } = await window.asignarClienteAnticipo({ pagoId: anticipo.pago_id, clienteId });
    setSaving(false);
    if (err) return setError(err.message || String(err));
    onSaved?.();
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-fullscreen-mobile" onClick={e => e.stopPropagation()} style={{ width: 480 }}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--warn-soft,#fef3c7)',color:'var(--warn)',display:'grid',placeItems:'center'}}>
            <Icon name="user" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">Identificar el anticipo</h3>
            <div className="small">{fmt.usd(anticipo.monto_usd)} · {anticipo.fecha} · {anticipo.banco || 'sin banco'}</div>
          </div>
          <button className="btn ghost sm" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <div className="modal-body" style={{display:'flex',flexDirection:'column',gap:12}}>
          <div>
            <label className="form-label">Cliente *</label>
            <SearchSelect value={clienteId} onChange={setClienteId} options={[]}
                          onSearchRemote={q => window.buscarClientesContactos(q, { soloClientes: true })}
                          placeholder="Buscar cliente por nombre o RIF..." />
          </div>
          {anticipo.referencia && (
            <div className="small muted">Referencia del pago: <span className="mono">{anticipo.referencia}</span></div>
          )}
          <div style={{background:'var(--bg-sunken)',borderRadius:8,padding:'10px 12px',fontSize:12.5}}>
            El saldo a favor pasa a este cliente y el movimiento del banco queda a su nombre.
            No mueve plata: el dinero ya entró.
          </div>
          {error && <div style={{color:'var(--danger)',fontSize:13}}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" onClick={guardar} disabled={saving || !clienteId}>
            {saving ? 'Guardando...' : 'Identificar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: cambiarle el cliente a un anticipo ya identificado ──────────────
// Distinto de identificar uno sin dueño: acá hay un cliente al que ya se le atribuyó la plata,
// y puede tener aplicaciones que le bajaron la deuda a SUS notas. Cambiar el dueño obliga a
// deshacer eso primero — si no, el cliente anterior se queda con un pago que no hizo.
//
// El aviso NO es genérico: dice exactamente qué notas se van a reabrir y por cuánto. Un
// "¿desea continuar?" sobre una operación que mueve deuda entre dos clientes, sin decir qué
// mueve, es una confirmación que nadie puede evaluar.
function ReasignarClienteModal({ anticipo, aplicaciones, onClose, onSaved }) {
  const [clienteId, setClienteId] = React.useState('');
  const [clienteLabel, setClienteLabel] = React.useState('');
  const [confirmando, setConfirmando] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError]   = React.useState('');
  const aplic = (aplicaciones || []);
  const totalAplicado = aplic.reduce((sum, a) => sum + (parseFloat(a.monto_aplicado) || 0), 0);

  async function confirmar() {
    setError('');
    if (!clienteId) return setError('Elegí el cliente al que corresponde este anticipo.');
    setSaving(true);
    const { data, error: err } = await window.reasignarAnticipoCliente({ pagoId: anticipo.pago_id, clienteId });
    setSaving(false);
    if (err) return setError(err.message || String(err));
    const n = data?.aplicaciones_revertidas || 0;
    alert([
      `El anticipo quedó a nombre de ${data?.cliente_nombre || clienteLabel || clienteId}.`,
      n > 0 ? `Se revirtieron ${n} aplicación${n === 1 ? '' : 'es'} por ${fmt.usd(data?.monto_devuelto || 0)}: esa deuda volvió a las notas del cliente anterior.` : '',
      `Su saldo a favor disponible es ${fmt.usd(data?.saldo_usd || anticipo.monto_usd)}.`,
    ].filter(Boolean).join('\n\n'));
    onSaved?.();
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-fullscreen-mobile" onClick={e => e.stopPropagation()} style={{ width: 520 }}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:'var(--warn-soft,#fef3c7)',color:'var(--warn)',display:'grid',placeItems:'center'}}>
            <Icon name="user" size={20}/>
          </div>
          <div style={{flex:1}}>
            <h3 className="modal-title">Cambiar el cliente del anticipo</h3>
            <div className="small">{fmt.usd(anticipo.monto_usd)} · {anticipo.fecha} · {anticipo.banco || 'sin banco'}</div>
          </div>
          <button className="btn ghost sm" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        <div className="modal-body" style={{display:'flex',flexDirection:'column',gap:12}}>
          <div style={{background:'var(--bg-sunken)',borderRadius:8,padding:'10px 12px',fontSize:12.5}}>
            Hoy está a nombre de <strong>{anticipo.cliente_nombre || anticipo.cliente_id}</strong>.
          </div>

          <div>
            <label className="form-label">Cliente correcto *</label>
            <SearchSelect value={clienteId}
                          onChange={v => {
                            setClienteId(v);
                            setClienteLabel(((window.SSData.clientes || []).find(c => c.id === v) || {}).nombre || v);
                            setConfirmando(false); setError('');
                          }}
                          selectedLabel={clienteLabel}
                          options={[]}
                          onSearchRemote={q => window.buscarClientesContactos(q, { soloClientes: true })}
                          placeholder="Buscar cliente por nombre o RIF..." />
            <div className="small muted" style={{marginTop:4}}>
              Tiene que estar habilitado en esta empresa. Si no aparece, habilitalo desde su ficha en
              Clientes.
            </div>
          </div>

          {/* Qué se deshace. Es la parte que hace que la confirmación signifique algo. */}
          {aplic.length > 0 ? (
            <div style={{border:'1px solid var(--danger)',borderRadius:8,overflow:'hidden'}}>
              <div style={{padding:'9px 12px',background:'#fee2e2',borderBottom:'1px solid var(--danger)',
                           fontWeight:600,fontSize:12.5,color:'#b91c1c'}}>
                <Icon name="alert" size={13}/> Se va a deshacer lo aplicado al cliente anterior
              </div>
              <div style={{padding:'8px 12px',fontSize:12.5}}>
                <div className="muted" style={{marginBottom:6}}>
                  Estas notas vuelven a quedar con su deuda, porque ese pago no era de él:
                </div>
                {aplic.map(a => (
                  <div key={a.id} style={{display:'flex',justifyContent:'space-between',gap:10,padding:'3px 0'}}>
                    <span className="mono">{a.documento_id || a.cuenta_cobrar_id || a.id}</span>
                    <span style={{fontWeight:600}}>{fmt.usd(a.monto_aplicado)}</span>
                  </div>
                ))}
                <div style={{display:'flex',justifyContent:'space-between',gap:10,paddingTop:6,marginTop:4,
                             borderTop:'1px solid var(--border)',fontWeight:700}}>
                  <span>Total que se devuelve</span><span>{fmt.usd(totalAplicado)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div style={{background:'var(--bg-sunken)',borderRadius:8,padding:'10px 12px',fontSize:12.5}}>
              Este anticipo no tiene aplicaciones, así que no hay nada que deshacer: solo cambia de
              dueño. No mueve plata — el dinero ya entró.
            </div>
          )}

          <div className="small muted">
            El movimiento del banco también pasa al cliente nuevo, y su saldo a favor queda
            disponible para aplicarlo a las notas de él.
          </div>

          {error && <div style={{color:'var(--danger)',fontSize:13}}>{error}</div>}
        </div>

        <div className="modal-footer" style={{flexDirection:'column',alignItems:'stretch',gap:8}}>
          {confirmando && (
            <div style={{background:'var(--warn-soft,#fef3c7)',border:'1px solid var(--warn)',borderRadius:8,
                         padding:'10px 12px',fontSize:12.5}}>
              Estás a punto de pasar este anticipo de <strong>{anticipo.cliente_nombre || anticipo.cliente_id}</strong>
              {' '}a <strong>{clienteLabel || clienteId}</strong>
              {aplic.length > 0 && <> y de devolverle {fmt.usd(totalAplicado)} de deuda al primero</>}.
              {' '}¿Continuás?
            </div>
          )}
          <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
            <button className="btn secondary" onClick={onClose} disabled={saving}>Cancelar</button>
            {confirmando ? (
              <button className="btn danger" onClick={confirmar} disabled={saving}>
                {saving ? 'Cambiando…' : 'Sí, cambiar de cliente'}
              </button>
            ) : (
              <button className="btn primary" disabled={saving}
                      onClick={() => {
                        setError('');
                        if (!clienteId) { setError('Elegí el cliente al que corresponde este anticipo.'); return; }
                        setConfirmando(true);
                      }}>
                Continuar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: detalle del anticipo (Info · Aplicaciones · Actividad) ──────────
function AnticipoDetalleModal({ anticipo, onClose, onChanged }) {
  const [tab, setTab] = React.useState('info');
  const [aplicaciones, setAplicaciones] = React.useState([]);
  const [cargando, setCargando] = React.useState(true);
  const [aplicar, setAplicar] = React.useState(false);
  const [vincularTraspaso, setVincularTraspaso] = React.useState(false);
  const [identificar, setIdentificar] = React.useState(false);
  const [reasignar, setReasignar] = React.useState(false);
  const [editar, setEditar] = React.useState(false);
  const sinIdentificar = !anticipo.cliente_id;
  // Cambiarle el cliente a un anticipo YA identificado mueve deuda de un cliente a otro, así que
  // es solo de Administrador (pedido del usuario). El server lo vuelve a verificar: un gate que
  // solo esconde el botón no es un permiso.
  const puedeReasignar = !!window.isAdminRole?.(window.__ssCurrentUser?.rol)
    || ['Administrador', 'Admin'].includes(window.__ssCurrentUser?.rol || '');
  // ActivityLogModal es un overlay propio, no se embebe: se abre encima, igual que
  // en el detalle de Clientes (business.jsx).
  const [showActivity, setShowActivity] = React.useState(false);

  async function recargar() {
    setCargando(true);
    const { data } = await window.getAplicacionesAnticipo(anticipo.pago_id);
    setAplicaciones(data || []);
    setCargando(false);
  }
  React.useEffect(() => { recargar(); }, [anticipo.pago_id]);

  async function revertir(ap) {
    if (!confirm(`¿Revertir la aplicación de ${fmt.usd(ap.monto_aplicado)} sobre ${ap.documento_id}?\n\nEl saldo vuelve al anticipo y la factura vuelve a deber ese monto.`)) return;
    const { error } = await window.revertirAplicacionAnticipo(ap.id);
    if (error) return alert('No se pudo revertir: ' + (error.message || error));
    await recargar();
    onChanged?.();
  }

  const est = ANT_ESTADO_CHIP[anticipo.estado] || ANT_ESTADO_CHIP.disponible;

  return (
    <React.Fragment>
      <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="modal modal-fullscreen-mobile" onClick={e => e.stopPropagation()} style={{ width: 700 }}>
          <div className="modal-header">
            <div style={{width:40,height:40,borderRadius:10,background:'var(--success-soft,#dcfce7)',color:'var(--success)',display:'grid',placeItems:'center'}}>
              <Icon name="cash" size={20}/>
            </div>
            <div style={{flex:1}}>
              <h3 className="modal-title">
                <window.ClienteLink clienteId={anticipo.cliente_id} nombre={anticipo.cliente_nombre}>
                  {anticipo.cliente_nombre || 'Anticipo sin identificar'}
                </window.ClienteLink>
              </h3>
              <div className="small">
                {anticipo.fecha} · <span className="mono">{anticipo.pago_id}</span> ·{' '}
                <span className={'chip ' + est.cls}>{est.label}</span>
                {sinIdentificar && <span className="chip amber" style={{marginLeft:5}}>Sin identificar</span>}
                {anticipo.editado_por && (
                  <span className="chip neutral" style={{marginLeft:5}}
                        title={`Editado por ${anticipo.editado_por}${anticipo.editado_at ? ' · ' + fmt.dateTime(anticipo.editado_at) : ''}`}>
                    <Icon name="edit" size={10}/> Editado
                  </span>
                )}
              </div>
            </div>
            <button className="btn ghost sm" onClick={onClose}><Icon name="x" size={14}/></button>
          </div>

          <div style={{padding:'0 20px', borderBottom:'1px solid var(--border)'}}>
            <div className="seg" style={{border:'none'}}>
              <button className={tab === 'info'  ? 'on' : ''} onClick={() => setTab('info')}>Info</button>
              <button className={tab === 'aplic' ? 'on' : ''} onClick={() => setTab('aplic')}>
                Aplicaciones{aplicaciones.length > 0 ? ` (${aplicaciones.length})` : ''}
              </button>
              <button className={tab === 'act'   ? 'on' : ''} onClick={() => setTab('act')}>Actividad</button>
            </div>
          </div>

          <div className="modal-body">
            {tab === 'info' && (
              <div style={{display:'flex',flexDirection:'column',gap:14}}>
                {sinIdentificar && (
                  <div style={{background:'var(--warn-soft,#fef3c7)',border:'1px solid var(--warn)',borderRadius:8,
                               padding:'11px 13px',fontSize:12.5,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                    <Icon name="alert" size={16}/>
                    <span style={{flex:1,minWidth:180}}>
                      No se sabe de quién es este dinero. Identifícalo cuando lo averigües, o elige el
                      cliente al momento de aplicarlo.
                    </span>
                    <button className="btn secondary sm" onClick={() => setIdentificar(true)}>
                      <Icon name="user" size={13}/> Identificar cliente
                    </button>
                  </div>
                )}
                {/* Corregir a quién se le atribuyó. Sin esto, un anticipo cargado al cliente
                    equivocado no tenía arreglo desde la pantalla: el botón de identificar solo
                    aparece cuando no tiene dueño. */}
                {!sinIdentificar && puedeReasignar && (
                  <div style={{display:'flex',justifyContent:'flex-end'}}>
                    <button className="btn ghost sm" onClick={() => setReasignar(true)}
                            title="Corregir el cliente al que se le atribuyó este anticipo">
                      <Icon name="user" size={13}/> Cambiar de cliente
                    </button>
                  </div>
                )}
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
                  <div className="stat">
                    <div className="small muted">Recibido</div>
                    <div style={{fontSize:18,fontWeight:700}}>{antMoneda(anticipo.monto, anticipo.moneda)}</div>
                    {anticipo.moneda === 'VES' && <div className="small muted">{fmt.usd(anticipo.monto_usd)} @ {anticipo.tasa}</div>}
                  </div>
                  <div className="stat">
                    <div className="small muted">Aplicado</div>
                    <div style={{fontSize:18,fontWeight:700}}>{fmt.usd(anticipo.aplicado_usd)}</div>
                  </div>
                  <div className="stat">
                    <div className="small muted">Saldo a favor</div>
                    <div style={{fontSize:18,fontWeight:700,color:'var(--success)'}}>{fmt.usd(anticipo.saldo_usd)}</div>
                  </div>
                </div>

                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,fontSize:13}}>
                  <div><span className="muted">Banco: </span>{anticipo.banco || '—'}</div>
                  <div><span className="muted">Forma de pago: </span>{anticipo.metodo || '—'}</div>
                  <div><span className="muted">Moneda: </span>{anticipo.moneda}</div>
                  <div><span className="muted">Referencia: </span>{anticipo.referencia || '—'}</div>
                  <div><span className="muted">RIF: </span>{anticipo.cliente_rif || '—'}</div>
                  <div><span className="muted">Registrado por: </span>{anticipo.creado_por || '—'}</div>
                </div>
                {anticipo.notas && (
                  <div style={{background:'var(--bg-sunken)',borderRadius:8,padding:'10px 12px',fontSize:13}}>
                    {anticipo.notas}
                  </div>
                )}
              </div>
            )}

            {tab === 'aplic' && (
              <div>
                {cargando ? <div className="small muted">Cargando...</div>
                 : aplicaciones.length === 0 ? (
                  <div style={{background:'var(--bg-sunken)',borderRadius:8,padding:14,fontSize:13}}>
                    Todavía no se ha aplicado nada de este anticipo.
                  </div>
                 ) : (
                  <table className="table">
                    <thead><tr><th>Fecha</th><th>Factura</th><th style={{textAlign:'right'}}>Monto</th><th></th></tr></thead>
                    <tbody>
                      {aplicaciones.map(ap => (
                        <tr key={ap.id}>
                          <td>{ap.fecha}</td>
                          <td className="mono">{ap.documento_id}</td>
                          <td style={{textAlign:'right'}}>{fmt.usd(ap.monto_aplicado)}</td>
                          <td style={{textAlign:'right'}}>
                            <button className="btn ghost sm danger" onClick={() => revertir(ap)}>Revertir</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                 )}
              </div>
            )}

            {tab === 'act' && (
              <div style={{display:'flex',flexDirection:'column',gap:12,alignItems:'flex-start'}}>
                <div className="small muted">Historial de cambios de este anticipo.</div>
                <button className="btn secondary" onClick={() => setShowActivity(true)}>
                  <Icon name="clock" size={14}/> Ver actividad
                </button>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button className="btn secondary" onClick={onClose}>Cerrar</button>
            <button className="btn secondary" onClick={() => setEditar(true)}>
              <Icon name="edit" size={14}/> Editar
            </button>
            {(parseFloat(anticipo.saldo_usd) || 0) > 0.005 && (
              <button className="btn secondary" onClick={() => setVincularTraspaso(true)} title="Cerrar este anticipo con un traspaso a otra empresa que ya se hizo">
                <Icon name="truck" size={14}/> Vincular traspaso
              </button>
            )}
            {(parseFloat(anticipo.saldo_usd) || 0) > 0.005 && (
              <button className="btn primary" onClick={() => setAplicar(true)}>
                <Icon name="link" size={14}/> Aplicar a factura
              </button>
            )}
          </div>
        </div>
      </div>

      {aplicar && (
        <AplicarAnticipoModal anticipo={anticipo} onClose={() => setAplicar(false)}
                              onSaved={() => { recargar(); onChanged?.(); }} />
      )}
      {vincularTraspaso && (
        <VincularTraspasoModal anticipo={anticipo} onClose={() => setVincularTraspaso(false)}
                              onSaved={() => { recargar(); onChanged?.(); }} />
      )}
      {reasignar && (
        <ReasignarClienteModal
          anticipo={anticipo}
          aplicaciones={aplicaciones}
          onClose={() => setReasignar(false)}
          onSaved={() => { setReasignar(false); onChanged?.(); onClose(); }}
        />
      )}
      {identificar && (
        <IdentificarClienteModal anticipo={anticipo} onClose={() => setIdentificar(false)}
                                 onSaved={() => { recargar(); onChanged?.(); }} />
      )}
      {editar && (
        <EditarAnticipoModal anticipo={anticipo} onClose={() => setEditar(false)}
                             onSaved={() => onChanged?.()} />
      )}
      {showActivity && (
        <ActivityLogModal modulo="anticipos" entidadId={anticipo.pago_id}
                          entidadLabel={anticipo.cliente_nombre}
                          onClose={() => setShowActivity(false)} />
      )}
    </React.Fragment>
  );
}

// ─── Página ─────────────────────────────────────────────────────────────────
window.AnticiposPage = function AnticiposPage() {
  const [, forceRender] = React.useReducer(x => x + 1, 0);
  const [nuevo, setNuevo]     = React.useState(false);
  const [detalle, setDetalle] = React.useState(null);
  const [showActivity, setShowActivity] = React.useState(false);
  // Filtros RECORDADOS (estándar de módulos #4, `ss-{modulo}-f-{filtro}`): cambiar de pantalla y
  // volver ya no los borra. Antes eran React.useState pelado, así que el módulo no cumplía el
  // estándar. La fecha y el usuario son los que pidió el cliente para rastrear diferencias entre
  // lo que registró cada persona.
  const [filtroEstado, setFiltroEstado] = window.usePersistedState('ss-anticipos-f-estado', 'con_saldo');
  const [q, setQ]                       = window.usePersistedState('ss-anticipos-f-q', '');
  const [fDesde, setFDesde]             = window.usePersistedState('ss-anticipos-f-desde', '');
  const [fHasta, setFHasta]             = window.usePersistedState('ss-anticipos-f-hasta', '');
  const [fUsuario, setFUsuario]         = window.usePersistedState('ss-anticipos-f-usuario', '');
  // Cliente como filtro PROPIO, no solo dentro del buscador libre: con un cliente que tiene 20
  // anticipos, teclear su nombre en la búsqueda también trae los de otro cliente cuya referencia
  // lo contenga. El selector es exacto.
  const [fCliente, setFCliente]         = window.usePersistedState('ss-anticipos-f-cliente', '');

  const todos = window.SSData.anticipos || [];
  // Quiénes registraron anticipos: la lista sale de los propios anticipos, no de la tabla de
  // usuarios, así solo aparece gente que de verdad tiene algo acá.
  const usuarios = React.useMemo(
    () => [...new Set(todos.map(a => a.creado_por).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')),
    [todos]);
  // Los clientes que TIENEN anticipos, con su RIF al lado. No se ofrece el catálogo completo:
  // son 13.096 clientes y el 99% no tiene ninguno — un selector con todos sería inusable.
  const clientesConAnticipo = React.useMemo(() => {
    const m = new Map();
    for (const a of todos) {
      if (!a.cliente_id) continue;
      if (!m.has(a.cliente_id)) m.set(a.cliente_id, { id: a.cliente_id, nombre: a.cliente_nombre || a.cliente_id, rif: a.cliente_rif || '', n: 0 });
      m.get(a.cliente_id).n += 1;
    }
    return [...m.values()].sort((x, y) => String(x.nombre).localeCompare(String(y.nombre), 'es'));
  }, [todos]);

  const rows = React.useMemo(() => {
    let r = todos;
    if (filtroEstado === 'con_saldo')  r = r.filter(a => (parseFloat(a.saldo_usd) || 0) > 0.005);
    else if (filtroEstado === 'consumidos') r = r.filter(a => (parseFloat(a.saldo_usd) || 0) <= 0.005);
    else if (filtroEstado === 'sin_identificar') r = r.filter(a => !a.cliente_id);
    if (fUsuario) r = r.filter(a => (a.creado_por || '') === fUsuario);
    if (fCliente) r = r.filter(a => (a.cliente_id || '') === fCliente);
    // Por `fecha` (la del anticipo, que es la columna que se muestra), no por created_at.
    if (fDesde || fHasta) r = r.filter(a => {
      const f = String(a.fecha || '').slice(0, 10);
      if (!f) return false;
      if (fDesde && f < fDesde) return false;
      if (fHasta && f > fHasta) return false;
      return true;
    });
    const term = q.trim().toLowerCase();
    if (term) r = r.filter(a =>
      (!a.cliente_id && 'sin identificar'.includes(term)) ||
      (a.cliente_nombre || '').toLowerCase().includes(term) ||
      (a.cliente_rif || '').toLowerCase().includes(term) ||
      (a.referencia || '').toLowerCase().includes(term) ||
      (a.pago_id || '').toLowerCase().includes(term));
    return r;
  }, [todos, filtroEstado, q, fDesde, fHasta, fUsuario, fCliente]);

  const hayFiltro = !!(q || fDesde || fHasta || fUsuario || fCliente || filtroEstado !== 'con_saldo');
  // Las tarjetas miran lo FILTRADO. El filtro está para responder "cuánto registró Fulano esta
  // semana": con los totales del universo entero, la respuesta no aparece por ningún lado. Cuando
  // hay un filtro puesto, las tarjetas lo dicen.
  const base = hayFiltro ? rows : todos;
  const totalDisponible = base.reduce((s, a) => s + Math.max(0, parseFloat(a.saldo_usd) || 0), 0);
  const totalRecibido   = base.reduce((s, a) => s + (parseFloat(a.monto_usd) || 0), 0);
  // Solo clientes reales: los sin identificar no son "un cliente con saldo" (y todos
  // compartirían la clave null, contándose como uno).
  const clientesConSaldo = new Set(base.filter(a => a.cliente_id && (parseFloat(a.saldo_usd) || 0) > 0.005).map(a => a.cliente_id)).size;
  const sinIdentificar   = todos.filter(a => !a.cliente_id);
  const montoSinIdentificar = base.filter(a => !a.cliente_id).reduce((s, a) => s + Math.max(0, parseFloat(a.saldo_usd) || 0), 0);

  async function refrescar() { await window.loadAnticipos(); forceRender(); }

  // Eliminar: solo si no tiene consumo. Si ya se aplicó, primero hay que revertir
  // esas aplicaciones — borrarlo dejaría facturas pagadas con plata inexistente.
  async function eliminar(items, clearSel) {
    const conUso = items.filter(a => (parseFloat(a.aplicado_usd) || 0) > 0.005);
    if (conUso.length) {
      alert(`No se puede eliminar ${conUso.length} anticipo(s) que ya tienen aplicaciones.\n\n` +
            'Revierte primero sus aplicaciones desde el detalle.');
      return;
    }
    if (!confirm(`¿Eliminar ${items.length} anticipo(s)?\n\nVan a la papelera por 30 días y el ingreso se quita del banco.`)) return;

    const bancosTocados = new Set();
    for (const a of items) {
      const { error: mErr } = await window.sb.from('movimientos_bancarios').delete().eq('pago_id', a.pago_id);
      if (mErr) { alert('No se pudo quitar el movimiento bancario: ' + mErr.message); return; }
      const { error } = await window.sb.from('pagos').delete().eq('id', a.pago_id);
      if (error) { alert('No se pudieron eliminar: ' + error.message); return; }
      if (a.cuenta_bancaria_id) bancosTocados.add(a.cuenta_bancaria_id);
    }
    // Solo tras confirmar la DB se manda a papelera y se refresca (si la red falla a
    // media respuesta, no queremos que "vuelvan" al refrescar).
    items.forEach(a => window.ssTrash.add('anticipo', `${a.cliente_nombre || a.cliente_id || 'Sin identificar'} · ${fmt.usd(a.monto_usd)}`, a));
    for (const b of bancosTocados) await window.recomputeSaldoCuenta?.(b);
    await refrescar();
    window.logActivity?.({ modulo: 'anticipos', accion: 'bulk_eliminar',
      entidad_label: `${items.length} anticipo(s)`, detalles: { ids: items.map(a => a.pago_id) } });
    clearSel?.();
  }

  const columns = [
    { key: 'fecha', label: 'Fecha', render: r => r.fecha },
    { key: 'cliente', label: 'Cliente', render: r => (
        r.cliente_id ? (
          <div>
            <div style={{fontWeight:500}}>
              <window.ClienteLink clienteId={r.cliente_id} nombre={r.cliente_nombre}>
                {r.cliente_nombre || r.cliente_id}
              </window.ClienteLink>
            </div>
            <div className="small muted mono dt-hide-mobile">{r.cliente_rif || ''}</div>
          </div>
        ) : (
          // Se marca, no se deja en blanco: una celda vacía se lee como un error de carga.
          <span className="chip amber" title="Entró el dinero pero no se sabe de quién es. Se identifica al aplicarlo o desde el detalle.">
            <Icon name="alert" size={11}/> Sin identificar
          </span>
        )) },
    { key: 'banco', label: 'Banco', hideOnMobile: true, render: r => (
        <div>
          <div>{r.banco || '—'}</div>
          <div className="small muted">{r.metodo || ''}</div>
        </div>) },
    { key: 'monto', label: 'Recibido', className: 'num', render: r => (
        <div style={{textAlign:'right'}}>
          <div>{antMoneda(r.monto, r.moneda)}</div>
          {r.moneda === 'VES' && <div className="small muted">{fmt.usd(r.monto_usd)}</div>}
        </div>) },
    { key: 'aplicado', label: 'Aplicado', className: 'num', hideOnMobile: true,
      render: r => <div style={{textAlign:'right'}}>{fmt.usd(r.aplicado_usd)}</div> },
    { key: 'saldo', label: 'Saldo a favor', className: 'num', render: r => (
        <div style={{textAlign:'right',fontWeight:600,color:(parseFloat(r.saldo_usd)||0) > 0.005 ? 'var(--success)' : 'var(--text-muted)'}}>
          {fmt.usd(r.saldo_usd)}
        </div>) },
    { key: 'estado', label: 'Estado', render: r => {
        const e = ANT_ESTADO_CHIP[r.estado] || ANT_ESTADO_CHIP.disponible;
        return (
          <div style={{display:'flex', alignItems:'center', gap:5, flexWrap:'wrap'}}>
            <span className={'chip ' + e.cls}>{e.label}</span>
            {r.editado_por && (
              <span className="chip neutral" title={`Editado por ${r.editado_por}${r.editado_at ? ' · ' + fmt.dateTime(r.editado_at) : ''}`}>
                <Icon name="edit" size={10}/>
              </span>
            )}
          </div>
        ); } },
    // El movimiento del banco de este anticipo casi siempre es 'MOV-ANT-'+pago_id (convención de
    // `crearAnticipo` y de la restauración de papelera), pero un anticipo nacido de un traspaso
    // entre empresas tiene el id del lado "entrada" del traspaso ('MOV-'+ref+'-D') — se resuelve por
    // `pago_id` al hacer clic (una sola fila, solo cuando el usuario de verdad quiere ir para allá).
    { key: 'movimiento', label: 'Banco', hideOnMobile: true, render: r => (
        r.cuenta_bancaria_id ? (
          <a href="#" className="mono small" style={{color:'var(--brand)'}}
             onClick={async ev => {
               ev.preventDefault();
               const convenido = 'MOV-ANT-' + r.pago_id;
               const { data } = await window.sb.from('movimientos_bancarios').select('id').eq('pago_id', r.pago_id).limit(1).maybeSingle();
               antIrAMovimiento(r.cuenta_bancaria_id, data?.id || convenido);
             }}>
            Ver movimiento
          </a>
        ) : <span className="small muted">—</span>) },
    // Quién lo registró y por qué — pedido explícito: antes solo se veía adentro del detalle,
    // y para rastrear de dónde vino un anticipo (o comparar lo que carga cada persona) hacía
    // falta abrir cada fila una por una.
    { key: 'creado_por', label: 'Registró', hideOnMobile: true, render: r => <CreadoPorCell nombre={r.creado_por}/> },
    { key: 'notas', label: 'Notas', hideOnMobile: true, render: r => (
        <div className="small muted" style={{maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={r.notas || ''}>
          {r.notas || '—'}
        </div>) },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Anticipos</h1>
          <div className="page-sub">Dinero recibido de clientes sin pedido asociado</div>
        </div>
        <div className="page-actions">
          <button className="btn ghost" onClick={() => setShowActivity(true)} title="Ver todo el registro de actividad de Anticipos">
            <Icon name="clock" size={14}/>Actividad
          </button>
          <button className="btn primary" onClick={() => setNuevo(true)}>
            <Icon name="plus" size={14}/> Registrar anticipo
          </button>
        </div>
      </div>

      {/* Con un filtro puesto las tarjetas miran lo filtrado, y hay que DECIRLO: un total que
          cambia de golpe sin explicación es peor que no tenerlo. */}
      {hayFiltro && (
        <div className="small muted" style={{marginBottom:8, display:'flex', alignItems:'center', gap:6}}>
          <Icon name="info" size={12}/> Los totales de abajo son de los {rows.length.toLocaleString('es-VE')} anticipos que dejan los filtros, no de los {todos.length.toLocaleString('es-VE')}.
        </div>
      )}
      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">Saldo a favor de clientes</div>
          <div className="stat-val" style={{color:'var(--success)'}}>{fmt.usd(totalDisponible)}</div>
          <div className="small mt-2">{clientesConSaldo} cliente(s) con saldo</div>
        </div>
        <div className="stat">
          <div className="stat-label">Total recibido</div>
          <div className="stat-val">{fmt.usd(totalRecibido)}</div>
          <div className="small mt-2">{base.length} anticipo(s)</div>
        </div>
        <div className="stat">
          <div className="stat-label">Ya consumido</div>
          <div className="stat-val">{fmt.usd(Math.max(0, totalRecibido - totalDisponible))}</div>
          <div className="small mt-2">aplicado a facturas</div>
        </div>
        {/* Plata sin dueño: es trabajo pendiente de cobranza, no un dato de color. Solo
            aparece si hay algo — una tarjeta en cero sería ruido permanente. */}
        {sinIdentificar.length > 0 && (
          <div className="stat" style={{cursor:'pointer', borderColor:'var(--warn)'}}
               onClick={() => setFiltroEstado('sin_identificar')}
               title="Ver solo los anticipos sin identificar">
            <div className="stat-label" style={{display:'flex',alignItems:'center',gap:5}}>
              <Icon name="alert" size={12}/> Sin identificar
            </div>
            <div className="stat-val" style={{color:'var(--warn)'}}>{fmt.usd(montoSinIdentificar)}</div>
            <div className="small mt-2">{sinIdentificar.length} anticipo(s) por identificar</div>
          </div>
        )}
      </div>

      <DataTable
        moduloId="anticipos"
        rows={rows}
        columns={columns}
        getRowId={r => r.pago_id}
        onRowClick={r => setDetalle(r)}
        emptyText="No hay anticipos registrados"
        toolbar={
          <React.Fragment>
            <input className="input sm" placeholder="Buscar cliente, RIF, referencia..."
                   value={q} onChange={e => setQ(e.target.value)} style={{minWidth:220}}/>
            <window.MobileFilters count={[filtroEstado !== 'con_saldo' ? filtroEstado : '', fDesde, fHasta, fUsuario, fCliente].filter(Boolean).length}>
            <select className="input sm" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
              <option value="con_saldo">Con saldo disponible</option>
              <option value="sin_identificar">Sin identificar{sinIdentificar.length ? ` (${sinIdentificar.length})` : ''}</option>
              <option value="consumidos">Consumidos</option>
              <option value="todos">Todos</option>
            </select>
            <input className="input sm" type="date" value={fDesde} onChange={e => setFDesde(e.target.value)} title="Desde"/>
            <input className="input sm" type="date" value={fHasta} onChange={e => setFHasta(e.target.value)} title="Hasta"/>
            <select className="input sm" value={fUsuario} onChange={e => setFUsuario(e.target.value)} title="Registrado por">
              <option value="">Todos los usuarios</option>
              {usuarios.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <select className="input sm" value={fCliente} onChange={e => setFCliente(e.target.value)}
                    title="Cliente" style={{maxWidth:240}}>
              <option value="">Todos los clientes</option>
              {clientesConAnticipo.map(c => (
                <option key={c.id} value={c.id}>{c.nombre}{c.rif ? ' · ' + c.rif : ''} ({c.n})</option>
              ))}
            </select>
            {hayFiltro && (
              <button className="btn ghost sm" title="Limpiar filtros"
                      onClick={() => { setQ(''); setFDesde(''); setFHasta(''); setFUsuario(''); setFCliente(''); setFiltroEstado('con_saldo'); }}>
                <Icon name="x" size={12}/>Limpiar
              </button>
            )}
            </window.MobileFilters>
            <span className="ml-auto small muted">
              {rows.length.toLocaleString('es-VE')} anticipo{rows.length !== 1 ? 's' : ''}
              {hayFiltro && <span> de {todos.length.toLocaleString('es-VE')}</span>}
            </span>
          </React.Fragment>
        }
        bulkActions={[
          { label: 'Eliminar', icon: 'trash', variant: 'danger', onClick: eliminar },
        ]}
      />

      {showActivity && <ActivityLogModal modulo="anticipos" onClose={() => setShowActivity(false)}/>}
      {nuevo && <AnticipoFormModal onClose={() => setNuevo(false)} onSaved={refrescar} />}
      {detalle && (
        <AnticipoDetalleModal
          anticipo={(window.SSData.anticipos || []).find(a => a.pago_id === detalle.pago_id) || detalle}
          onClose={() => setDetalle(null)}
          onChanged={refrescar} />
      )}
    </div>
  );
};

// ─── Restaurar desde papelera ───────────────────────────────────────────────
// Se recrea el pago y su movimiento bancario, y se recalcula el saldo del banco.
window.ssTrashHandlers = window.ssTrashHandlers || {};
window.ssTrashHandlers['anticipo'] = async (data) => {
  const pago = {
    id: data.pago_id, empresa_id: data.empresa_id, tipo: 'cobro', categoria: 'anticipo',
    cliente_id: data.cliente_id, documento_id: null, fecha: data.fecha,
    monto: data.monto, moneda: data.moneda, monto_usd: data.monto_usd, tasa: data.tasa,
    metodo: data.metodo, banco: data.banco, cuenta_bancaria_id: data.cuenta_bancaria_id,
    referencia: data.referencia, notas: data.notas, creado_por: data.creado_por,
  };
  const { error } = await window.sb.from('pagos').insert(pago);
  if (error) return { error: error.message };

  if (data.cuenta_bancaria_id) {
    await window.sb.from('movimientos_bancarios').insert({
      id: 'MOV-ANT-' + data.pago_id, fecha: data.fecha, banco: data.banco,
      descripcion: 'Anticipo' + (data.cliente_nombre ? ' - ' + data.cliente_nombre : (data.cliente_id ? '' : ' - sin identificar')),
      monto: data.monto, tipo: 'ingreso', moneda: data.moneda, monto_usd: data.monto_usd,
      cuenta_bancaria_id: data.cuenta_bancaria_id, pago_id: data.pago_id,
      cliente_id: data.cliente_id, empresa_id: data.empresa_id,
      conciliado: false, origen_app: true,
    });
    await window.recomputeSaldoCuenta?.(data.cuenta_bancaria_id);
  }
  await window.loadAnticipos?.();
  return { ok: true };
};

// El módulo de Bancos abre este mismo modal cuando el movimiento es un anticipo (antes tenía una
// copia simulada que listaba 4 documentos al azar). Se expone en vez de duplicarlo: la lógica de
// cliente, facturas pendientes, topes y moneda vive en un solo sitio.
Object.assign(window, { AnticiposPage: window.AnticiposPage, AplicarAnticipoModal });
