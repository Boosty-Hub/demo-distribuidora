// localStorage keys: ss-vendedores-pagesize, ss-vendedores-sort

// ── Helpers ────────────────────────────────────────────────────────────────

function loadVndPageSize(def) {
  const v = parseInt(localStorage.getItem('ss-vendedores-pagesize')) || def;
  return [50, 100, 200].includes(v) ? v : 50;
}

function calcVentasYTD(vnd) {
  const nombre = typeof vnd === 'string' ? vnd : vnd?.nombre;
  const id     = typeof vnd === 'object' ? vnd?.id : null;
  return (SSData.documentos || [])
    .filter(d => (d.vendedor === nombre || (id && d.vendedor_id === id)) && (d.tipo === 'factura' || d.estado === 'factura'))
    .reduce((s, d) => s + (parseFloat(d.total) || 0), 0);
}

function countClientes(vnd) {
  const nombre = typeof vnd === 'string' ? vnd : vnd?.nombre;
  const id     = typeof vnd === 'object' ? vnd?.id : null;
  return (SSData.clientes || []).filter(c =>
    c.vendedor === nombre || c.vendedor_nombre === nombre || (id && (c.vendedor_id === id || c.vendedor === id))
  ).length;
}

function countOrdenes(vnd) {
  const nombre = typeof vnd === 'string' ? vnd : vnd?.nombre;
  const id     = typeof vnd === 'object' ? vnd?.id : null;
  return (SSData.documentos || []).filter(d =>
    d.vendedor === nombre || (id && d.vendedor_id === id)
  ).length;
}

// ── Modal: Nuevo / Editar Vendedor ─────────────────────────────────────────

function NewVendedorModal({ onClose, vendedor }) {
  const isEdit = !!vendedor;
  const [saving, setSaving] = React.useState(false);
  const [crearUsuario, setCrearUsuario] = React.useState(false);
  const [password, setPassword] = React.useState('');
  const [errMsg, setErrMsg] = React.useState('');
  const [form, setForm] = React.useState({
    nombre:       vendedor?.nombre      || '',
    codigo:       vendedor?.codigo      || '',
    email:        vendedor?.email       || '',
    telefono:     vendedor?.telefono    || '',
    zona:         vendedor?.zona        || '',
    meta_mensual: vendedor?.metaMensual || 0,
    comision_pct: vendedor?.comisionPct || 5,
    notas:        vendedor?.notas       || '',
    usuario_id:   vendedor?.usuario_id  || '',
  });

  function upd(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    if (!form.nombre.trim()) return;
    setErrMsg(''); setSaving(true);
    const payload = {
      nombre:       form.nombre.trim(),
      codigo:       form.codigo  || null,
      email:        form.email   || null,
      telefono:     form.telefono || null,
      zona:         form.zona    || null,
      meta_mensual: parseFloat(form.meta_mensual) || 0,
      comision_pct: parseFloat(form.comision_pct) || 0,
      notas:        form.notas   || null,
      usuario_id:   form.usuario_id || null,
      activo:       true,
    };

    if (isEdit) {
      const { error } = await window.sb.from('vendedores').update(payload).eq('id', vendedor.id);
      if (error) { setErrMsg('Error al guardar: ' + error.message); setSaving(false); return; }
      window.logActivity?.({ modulo: 'vendedores', accion: 'editar', entidad_id: vendedor.id, entidad_label: form.nombre });
    } else {
      let usuario_id = null;
      if (crearUsuario) {
        if (!form.email.trim()) { setErrMsg('Email obligatorio para crear usuario.'); setSaving(false); return; }
        if (!password || password.length < 8) { setErrMsg('Contraseña mínima de 8 caracteres.'); setSaving(false); return; }
        const initials = form.nombre.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        const result = await window.authCreateUser({
          email:    form.email.trim(),
          password,
          nombre:   form.nombre.trim(),
          rol:      'Vendedor',
          iniciales: initials,
          avatar:   '#10b981',
        });
        if (result.error) {
          const m = result.error.message || '';
          setErrMsg(m.includes('already') ? 'Este correo ya está registrado.' : (m || 'No se pudo crear el usuario.'));
          setSaving(false); return;
        }
        usuario_id = result.userId;
        window.logActivity?.({ modulo: 'usuarios', accion: 'crear', entidad_id: result.userId, entidad_label: form.nombre.trim(), detalles: { origen: 'vendedor', rol: 'Vendedor' } });
      }
      const newId = 'VND-' + Date.now();
      payload.id = newId;
      payload.empresa_id = window.currentEmpresa || 'demo1';
      payload.usuario_id = usuario_id || (form.usuario_id || null);
      payload.creado_por = window.__ssCurrentUser?.nombre || null;
      const { error } = await window.sb.from('vendedores').insert(payload);
      if (error) { setErrMsg('Error al crear vendedor: ' + error.message); setSaving(false); return; }
      window.logActivity?.({ modulo: 'vendedores', accion: 'crear', entidad_id: newId, entidad_label: form.nombre });
    }
    await window.refrescarFase2();
    setSaving(false);
    onClose();
  }

  // Un usuario "ya tomado" lo está SOLO dentro de su empresa. La misma persona tiene una ficha de
  // vendedor por empresa (Pedro Díaz existe en demo1 y en demo2), así que filtrar contra
  // TODAS las fichas hacía que vincularlo en una lo dejara imposible de vincular en la otra — y sin
  // vínculo su teléfono no sale en el PDF (ver migracion-odoo/80).
  const empActual = vendedor?.empresa_id || window.currentEmpresa || 'demo1';
  const usuariosSinVendedor = (SSData.usuarios || []).filter(u =>
    !SSData.vendedores.some(v => v.usuario_id === u.id && (v.empresa_id || empActual) === empActual)
    || u.id === vendedor?.usuario_id
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 580 }}>
        <div className="modal-header">
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center' }}>
            <Icon name="users" size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <h3 className="modal-title">{isEdit ? 'Editar vendedor' : 'Nuevo vendedor'}</h3>
            <div className="small">{isEdit ? `Modificando datos de ${vendedor.nombre}` : 'Registra un vendedor en el equipo comercial'}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>

        <div className="modal-body">
          <div className="form-section-title">Datos del vendedor</div>
          <div className="grid-2">
            <div>
              <label className="form-label">Nombre completo <span style={{ color: 'var(--danger)' }}>*</span></label>
              <input className="input" placeholder="Ej. Carlos Mendoza" value={form.nombre} onChange={e => upd('nombre', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Código</label>
              <input className="input mono" placeholder="VND-001" value={form.codigo} onChange={e => upd('codigo', e.target.value)} />
            </div>
          </div>
          <div className="grid-2 mt-3">
            <div>
              <label className="form-label">Email</label>
              <input className="input" placeholder="carlos@empresa.ve" value={form.email} onChange={e => upd('email', e.target.value)} disabled={isEdit && !!vendedor.usuario_id} />
            </div>
            <div>
              <label className="form-label">Teléfono</label>
              <input className="input" placeholder="+58 414-1234567" value={form.telefono} onChange={e => upd('telefono', e.target.value)} />
              {/* Es el teléfono que se imprime en el PDF debajo del nombre del vendedor. Si acá
                  está vacío, se usa el del usuario vinculado (abajo) — decirlo evita que alguien
                  cargue el dato dos veces o crea que no se guardó. Ver migracion-odoo/80. */}
              {(() => {
                const uLig = (SSData.usuarios || []).find(u => u.id === form.usuario_id);
                if (form.telefono) {
                  return <div className="small muted" style={{ marginTop: 3 }}>Es el que sale en el PDF de sus documentos.</div>;
                }
                if (uLig?.telefono) {
                  return <div className="small muted" style={{ marginTop: 3 }}>
                    Vacío: el PDF va a usar el del usuario vinculado ({uLig.telefono}).
                  </div>;
                }
                // El teléfono es de la PERSONA, no de la ficha: cargarlo en el usuario alcanza para
                // las dos empresas y para las dos grafías del nombre. Decirlo acá evita que se
                // cargue cuatro veces (y que en alguna quede sin cargar, que es lo que pasó).
                return <div className="small" style={{ marginTop: 3, color: 'var(--warn)' }}>
                  Sin teléfono acá ni en su usuario: sus documentos salen sin número de contacto.
                  {form.usuario_id
                    ? ' Si lo cargás en el usuario vinculado, vale para las dos empresas.'
                    : ' Vinculalo a un usuario abajo y cargalo ahí una sola vez.'}
                </div>;
              })()}
            </div>
          </div>
          <div className="mt-3">
            <label className="form-label">Zona / Territorio</label>
            <input className="input" placeholder="Ej. Caracas Centro, Miranda, Llanos..." value={form.zona} onChange={e => upd('zona', e.target.value)} />
          </div>

          <div className="form-section-title mt-4">Metas y comisiones</div>
          <div className="grid-2">
            <div>
              <label className="form-label">Meta mensual (USD)</label>
              <input className="input mono" type="number" min="0" value={form.meta_mensual} onChange={e => upd('meta_mensual', e.target.value)} />
            </div>
            <div>
              <label className="form-label">% Comisión sobre ventas</label>
              <input className="input mono" type="number" min="0" max="100" step="0.5" value={form.comision_pct} onChange={e => upd('comision_pct', e.target.value)} />
            </div>
          </div>

          <div className="mt-3">
            <label className="form-label">Notas</label>
            <textarea className="input" rows="2" placeholder="Observaciones internas..." value={form.notas} onChange={e => upd('notas', e.target.value)} style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }} />
          </div>

          {!isEdit && (
            <div className="card mt-4" style={{ padding: 14, background: 'var(--bg-sunken)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={crearUsuario} onChange={e => setCrearUsuario(e.target.checked)} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Crear usuario vinculado</div>
                  <div className="small muted" style={{ marginTop: 2 }}>Se crea una cuenta con rol "Vendedor" para que pueda iniciar sesión.</div>
                </div>
              </label>
              {crearUsuario && (
                <div className="mt-3">
                  <label className="form-label">Contraseña <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input className="input" type="password" placeholder="Mínimo 8 caracteres" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
                </div>
              )}
            </div>
          )}

          {isEdit && (
            <div className="mt-3">
              <label className="form-label">Vincular usuario existente</label>
              <select className="select" value={form.usuario_id} onChange={e => upd('usuario_id', e.target.value)} style={{ width: '100%' }}>
                <option value="">— Sin usuario vinculado —</option>
                {usuariosSinVendedor.map(u => <option key={u.id} value={u.id}>{u.nombre} ({u.email})</option>)}
              </select>
            </div>
          )}

          {errMsg && <div style={{ marginTop: 12, padding: '8px 12px', background: '#fee2e2', color: '#b91c1c', borderRadius: 8, fontSize: 13 }}>{errMsg}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn primary" disabled={!form.nombre.trim() || saving} onClick={handleSave}>
            <Icon name="check" size={14} />{saving ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Crear vendedor')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Detalle de vendedor ──────────────────────────────────────────────

function VendedorDetailModal({ vendedor, onClose, onEdit }) {
  const [tab, setTab] = React.useState('info');
  const [showActivity, setShowActivity] = React.useState(false);

  const misClientes = (SSData.clientes || []).filter(c =>
    c.vendedor === vendedor.nombre || c.vendedor_nombre === vendedor.nombre ||
    c.vendedor_id === vendedor.id || c.vendedor === vendedor.id
  );
  const misOrdenes  = (SSData.documentos || []).filter(d =>
    d.vendedor === vendedor.nombre || d.vendedor_id === vendedor.id
  );
  const ventasYTD   = misOrdenes
    .filter(d => d.tipo === 'factura' || d.estado === 'factura')
    .reduce((s, d) => s + (parseFloat(d.total) || 0), 0);
  const metaPct     = vendedor.metaMensual > 0 ? Math.min(100, (ventasYTD / vendedor.metaMensual) * 100) : 0;
  const comisionEst = ventasYTD * ((vendedor.comisionPct || 0) / 100);

  const usuarioVinculado = (SSData.usuarios || []).find(u => u.id === vendedor.usuario_id);

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 720, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', fontSize: 20, fontWeight: 700 }}>
            {vendedor.nombre.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <h3 className="modal-title">{vendedor.nombre}</h3>
            <div className="small">{vendedor.codigo && <span className="mono" style={{ marginRight: 8 }}>{vendedor.codigo}</span>}{vendedor.zona || 'Sin zona asignada'}</div>
          </div>
          {window.canUser?.('editar', 'vendedores') !== false && (
            <button className="btn secondary sm" onClick={onEdit} style={{ marginRight: 8 }}><Icon name="edit" size={13} />Editar</button>
          )}
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>

        <div style={{ padding: '0 20px', borderBottom: '1px solid var(--border)' }}>
          <div className="seg" style={{ border: 'none' }}>
            <button className={tab === 'info' ? 'on' : ''} onClick={() => setTab('info')}>Info</button>
            <button className={tab === 'clientes' ? 'on' : ''} onClick={() => setTab('clientes')}>Clientes ({misClientes.length})</button>
            <button className={tab === 'ordenes' ? 'on' : ''} onClick={() => setTab('ordenes')}>Órdenes ({misOrdenes.length})</button>
          </div>
        </div>

        <div className="modal-body" style={{ flex: 1, overflowY: 'auto' }}>
          {tab === 'info' && (
            <>
              <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
                <div className="stat">
                  <div className="stat-label">Ventas YTD</div>
                  <div className="stat-val">{fmt.usd(ventasYTD)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Meta mensual</div>
                  <div className="stat-val">{fmt.usd(vendedor.metaMensual)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Comisión estimada</div>
                  <div className="stat-val">{fmt.usd(comisionEst)}</div>
                </div>
              </div>

              {vendedor.metaMensual > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                    <span>Progreso hacia meta</span>
                    <span style={{ fontWeight: 600, color: metaPct >= 100 ? 'var(--success)' : metaPct >= 70 ? 'var(--warn)' : 'var(--danger)' }}>{metaPct.toFixed(1)}%</span>
                  </div>
                  <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: metaPct + '%', background: metaPct >= 100 ? 'var(--success)' : metaPct >= 70 ? 'var(--warn)' : 'var(--brand)', borderRadius: 4, transition: 'width .3s' }} />
                  </div>
                </div>
              )}

              <div className="form-section-title">Datos de contacto</div>
              <div className="grid-2" style={{ gap: 12 }}>
                {vendedor.email && <div><div className="small muted">Email</div><div>{vendedor.email}</div></div>}
                {vendedor.telefono && <div><div className="small muted">Teléfono</div><div>{vendedor.telefono}</div></div>}
                <div><div className="small muted">Comisión</div><div>{vendedor.comisionPct}%</div></div>
                <div><div className="small muted">Clientes asignados</div><div>{misClientes.length}</div></div>
              </div>

              {usuarioVinculado && (
                <div className="card mt-3" style={{ padding: 12, background: 'var(--bg-sunken)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar user={usuarioVinculado} size={32} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{usuarioVinculado.nombre}</div>
                    <div className="small muted">Usuario vinculado · {usuarioVinculado.rol}</div>
                  </div>
                </div>
              )}

              {vendedor.notas && (
                <div className="card mt-3" style={{ padding: 12, background: 'var(--bg-sunken)' }}>
                  <div className="small muted" style={{ marginBottom: 4 }}>Notas</div>
                  <div style={{ fontSize: 13 }}>{vendedor.notas}</div>
                </div>
              )}
            </>
          )}

          {tab === 'clientes' && (
            misClientes.length === 0
              ? <div style={{ textAlign:'center', padding:40, color:'var(--text-muted)' }}>Sin clientes asignados</div>
              : <div className="tbl-wrap"><table className="tbl">
                  <thead><tr><th>Nombre</th><th>RIF</th><th>Tipo</th><th className="num">Deuda</th></tr></thead>
                  <tbody>
                    {misClientes.map(c => {
                      const tc = SSData.tiposCliente.find(t => t.id === c.tipo);
                      return (
                        <tr key={c.id}>
                          <td style={{ fontWeight:500 }}>{c.nombre}</td>
                          <td className="mono muted">{c.rif || '—'}</td>
                          <td>{tc ? <StatusChip label={tc.nombre} color={tc.color} /> : (c.tipo || '—')}</td>
                          <td className="num mono">{fmt.usd(c.deuda || 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
          )}

          {tab === 'ordenes' && (
            misOrdenes.length === 0
              ? <div style={{ textAlign:'center', padding:40, color:'var(--text-muted)' }}>Sin órdenes registradas</div>
              : <div className="tbl-wrap"><table className="tbl">
                  <thead><tr><th>Documento</th><th>Fecha</th><th>Cliente</th><th>Estado</th><th className="num">Total USD</th></tr></thead>
                  <tbody>
                    {misOrdenes.map(d => {
                      const cli = SSData.clientes.find(c => c.id === d.cliente);
                      return (
                        <tr key={d.id}>
                          <td className="mono" style={{ fontWeight:500 }}>{d.id}</td>
                          <td className="muted">{fmt.date(d.fecha)}</td>
                          <td>{cli?.nombre || d.cliente || '—'}</td>
                          <td><StatusChip label={d.estado} /></td>
                          <td className="num mono" style={{ fontWeight:600, color:'var(--brand)' }}>{fmt.usd(d.total || 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4} style={{ fontWeight:600, fontSize:12, color:'var(--text-muted)', textAlign:'right', padding:'8px 12px', borderTop:'2px solid var(--border)' }}>Total ventas YTD</td>
                      <td className="num mono" style={{ fontWeight:700, color:'var(--brand)', padding:'8px 12px', borderTop:'2px solid var(--border)' }}>{fmt.usd(ventasYTD)}</td>
                    </tr>
                  </tfoot>
                </table></div>
          )}

        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={() => setShowActivity(true)}><Icon name="receipt" size={13} />Actividad</button>
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
        </div>
        {showActivity && (
          <ActivityLogModal modulo="vendedores" entidadId={vendedor.id} entidadLabel={vendedor.nombre} onClose={() => setShowActivity(false)} />
        )}
      </div>
    </div>
  );
}

// ── Página principal ────────────────────────────────────────────────────────

window.VendedoresPage = function VendedoresPage() {
  const [search, setSearch]   = React.useState('');
  const [page, setPage]       = React.useState(1);
  const [pageSize, setPageSize] = React.useState(() => loadVndPageSize(50));
  const [selected, setSelected] = React.useState(new Set());
  const [showNew, setShowNew] = React.useState(false);
  const [detalle, setDetalle] = React.useState(null);
  const [editing, setEditing] = React.useState(null);
  const [showActivity, setShowActivity] = React.useState(false);

  React.useEffect(() => { localStorage.setItem('ss-vendedores-pagesize', String(pageSize)); }, [pageSize]);
  React.useEffect(() => { setPage(1); }, [search]);

  const rows = (SSData.vendedores || []).filter(v =>
    !search || v.nombre.toLowerCase().includes(search.toLowerCase()) ||
    (v.codigo || '').toLowerCase().includes(search.toLowerCase()) ||
    (v.zona  || '').toLowerCase().includes(search.toLowerCase())
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows   = rows.slice((page - 1) * pageSize, page * pageSize);

  function tgAll() {
    if (selected.size === pageRows.length) setSelected(new Set());
    else setSelected(new Set(pageRows.map(v => v.id)));
  }
  function tgOne(id, e) {
    e.stopPropagation();
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }

  async function handleBulkDelete() {
    if (!confirm(`¿Mover ${selected.size} vendedor${selected.size !== 1 ? 'es' : ''} a la papelera?`)) return;
    const targets = SSData.vendedores.filter(v => selected.has(v.id));
    const { error } = await window.deleteVendedores([...selected]);
    if (error) { alert('Error al eliminar: ' + error.message); return; }
    targets.forEach(v => window.ssTrash?.add('vendedor', v.nombre, v));
    setSelected(new Set());
    await window.refrescarFase2();
    window.logActivity?.({ modulo: 'vendedores', accion: 'bulk_eliminar', detalles: { ids: targets.map(v => v.id) } });
  }

  const triState = selected.size === 0 ? 'none' : selected.size === pageRows.length ? 'all' : 'some';

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Vendedores</h1>
          <div className="small muted">{rows.length} vendedor{rows.length !== 1 ? 'es' : ''} · equipo comercial</div>
        </div>
        <div className="page-actions">
          <button className="btn ghost" onClick={() => setShowActivity(true)} title="Actividad"><Icon name="receipt" size={14} />Actividad</button>
          {window.canUser?.('crear', 'vendedores') !== false && (
            <button className="btn primary" onClick={() => setShowNew(true)}><Icon name="plus" size={14} />Nuevo vendedor</button>
          )}
        </div>
      </div>

      {/* Barra de acciones masivas */}
      {selected.size > 0 && (
        <div className="docs-bulk-bar" style={{position:'fixed',bottom:28,left:'50%',transform:'translateX(-50%)',background:'var(--bg-elev)',border:'1px solid var(--border)',borderRadius:16,boxShadow:'0 12px 40px rgba(0,0,0,.35)',display:'flex',alignItems:'center',gap:6,padding:'10px 14px',zIndex:300,backdropFilter:'blur(12px)',flexWrap:'wrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,paddingRight:10,borderRight:'1px solid var(--border)',marginRight:4}}>
            <div style={{width:24,height:24,borderRadius:8,background:'var(--brand)',display:'grid',placeItems:'center',color:'#fff',fontSize:11,fontWeight:700}}>{selected.size}</div>
            <span style={{fontSize:13,fontWeight:600}}>vendedor{selected.size !== 1 ? 'es' : ''} seleccionado{selected.size !== 1 ? 's' : ''}</span>
          </div>
          {window.canUser?.('eliminar', 'vendedores') !== false && (
            <button className="btn ghost sm" style={{color:'var(--danger)'}} onClick={handleBulkDelete}><Icon name="trash" size={13} />Eliminar</button>
          )}
          <button className="icon-btn" onClick={() => setSelected(new Set())} style={{marginLeft:4}}><Icon name="x" size={15}/></button>
        </div>
      )}

      {/* Filtro */}
      <div className="toolbar">
        <input className="input" placeholder="Buscar por nombre, código o zona…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 280 }} />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="small muted">Filas:</span>
          {[50, 100, 200].map(n => (
            <button key={n} className={'btn ghost sm' + (pageSize === n ? ' on' : '')} onClick={() => { setPageSize(n); setPage(1); }}>{n}</button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <div className="tbl-wrap">
        <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 40 }}>
                <input type="checkbox" ref={el => { if (el) { el.indeterminate = triState === 'some'; el.checked = triState === 'all'; } }} onChange={tgAll} />
              </th>
              <th>Vendedor</th>
              {/* El teléfono se imprime en el PDF de cada documento suyo, y hasta hoy no se veía en
                  ninguna lista: por eso 50 de 51 fichas estaban vacías y nadie se enteró hasta que
                  un cliente pidió el número. Se muestra el EFECTIVO (el que va a salir impreso),
                  no el campo, para que "vacío" signifique de verdad "no sale nada". */}
              <th className="dt-hide-mobile">Teléfono</th>
              <th className="dt-hide-mobile">Zona</th>
              <th>Clientes</th>
              <th className="dt-hide-mobile">Órdenes</th>
              <th className="dt-hide-mobile">Ventas YTD</th>
              <th>Meta %</th>
              <th className="dt-hide-mobile">Comisión</th>
              <th className="dt-hide-mobile">Creado por</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr><td colSpan="11" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                {search ? 'Sin resultados para la búsqueda' : 'No hay vendedores registrados'}
              </td></tr>
            )}
            {pageRows.map(v => {
              const ventas    = calcVentasYTD(v);
              const nClientes = countClientes(v);
              const nOrdenes  = countOrdenes(v);
              const metaPct  = v.metaMensual > 0 ? Math.min(100, (ventas / v.metaMensual) * 100) : null;
              const comision = ventas * ((v.comisionPct || 0) / 100);
              return (
                <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => setDetalle(v)}>
                  <td onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(v.id)} onChange={e => tgOne(v.id, e)} />
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', fontWeight: 700, flexShrink: 0 }}>
                        {v.nombre.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 500 }}>{v.nombre}</div>
                        {v.codigo && <div className="small mono muted">{v.codigo}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="dt-hide-mobile">{(() => {
                    // Misma cadena que imprime el PDF: la ficha primero, y si está vacía el usuario
                    // vinculado por id (una persona puede ser "Pedro" como usuario y "Pedro Díaz"
                    // como vendedor — ningún match por texto cruza eso).
                    const uLig = (SSData.usuarios || []).find(u => u.id === v.usuario_id);
                    const propio  = (v.telefono || '').trim();
                    const heredado = (uLig?.telefono || '').trim();
                    if (propio) return <span className="mono">{propio}</span>;
                    if (heredado) return <span className="mono muted" title={`Heredado del usuario ${uLig.nombre}`}>{heredado}</span>;
                    return <span className="small" style={{ color: 'var(--warn)' }} title="Sus documentos salen sin teléfono de contacto. Cargalo acá o en su usuario.">
                      <Icon name="alert" size={12}/> Sin teléfono
                    </span>;
                  })()}</td>
                  <td className="dt-hide-mobile">{v.zona || <span className="muted">—</span>}</td>
                  <td>{nClientes}</td>
                  <td className="dt-hide-mobile">{nOrdenes}</td>
                  <td className="dt-hide-mobile mono">{fmt.usd(ventas)}</td>
                  <td>
                    {metaPct !== null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 60, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: metaPct + '%', background: metaPct >= 100 ? 'var(--success)' : metaPct >= 70 ? 'var(--warn)' : 'var(--brand)', borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 600 }}>{metaPct.toFixed(0)}%</span>
                      </div>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td className="dt-hide-mobile mono">{fmt.usd(comision)}</td>
                  <td className="dt-hide-mobile"><CreadoPorCell nombre={v.creado_por}/></td>
                  <td onClick={e => e.stopPropagation()}>
                    {window.canUser?.('editar', 'vendedores') !== false && (
                      <button className="icon-btn" onClick={() => setEditing(v)}><Icon name="edit" size={14} /></button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {/* Paginador */}
        {totalPages > 1 && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 16px', borderTop:'1px solid var(--border)', fontSize:12 }}>
            <span className="muted">{rows.length} vendedores · página {page} de {totalPages}</span>
            <div style={{ display:'flex', gap:4 }}>
              <button className="btn ghost sm" disabled={page===1} onClick={()=>setPage(1)}>«</button>
              <button className="btn ghost sm" disabled={page===1} onClick={()=>setPage(p=>p-1)}>‹</button>
              {Array.from({length:Math.min(5,totalPages)},(_,i)=>Math.max(1,Math.min(totalPages-4,page-2))+i).filter(p=>p>=1&&p<=totalPages).map(p=>(
                <button key={p} className={'btn sm '+(p===page?'primary':'ghost')} style={{minWidth:32}} onClick={()=>setPage(p)}>{p}</button>
              ))}
              <button className="btn ghost sm" disabled={page===totalPages} onClick={()=>setPage(p=>p+1)}>›</button>
              <button className="btn ghost sm" disabled={page===totalPages} onClick={()=>setPage(totalPages)}>»</button>
            </div>
          </div>
        )}
      </div>

      {showNew && <NewVendedorModal onClose={() => setShowNew(false)} />}
      {editing && <NewVendedorModal vendedor={editing} onClose={() => setEditing(null)} />}
      {detalle && !editing && (
        <VendedorDetailModal
          vendedor={detalle}
          onClose={() => setDetalle(null)}
          onEdit={() => { setEditing(detalle); setDetalle(null); }}
        />
      )}
      {showActivity && <ActivityLogModal modulo="vendedores" onClose={() => setShowActivity(false)} />}
    </div>
  );
};

Object.assign(window, { VendedoresPage: window.VendedoresPage });
