// Settings pages: users, roles, system config
const { useState: uState, useEffect: uEffect } = React;

// Rol admin canónico = 'Administrador'. 'Admin' fue un duplicado histórico (0 usuarios);
// se conserva como alias defensivo por si algún JWT/usuarios.rol viejo aún dijera 'Admin'.
const isAdminRole = (r) => r === 'Administrador' || r === 'Admin';
window.isAdminRole = isAdminRole;

const ROLE_COLORS = { 'Administrador':'blue', 'Ventas Senior':'green', 'Ventas':'green', 'Vendedor':'green', 'Gerente de Operaciones':'red', 'Contadora':'purple', 'Compras':'amber', 'CxC / CxP':'purple', 'Almacen Central':'amber', 'Almacen Valencia':'amber' };
const AVATARS = ['#1e40af','#0f766e','#7c3aed','#b45309','#dc2626','#0369a1','#065f46','#92400e'];

// ── Corregir el nombre de una persona, con arrastre a todo su historial ──────────────────────
//
// El nombre de una persona no vive en un solo lado: `documentos.vendedor` y `creado_por`,
// `actividad_log.usuario_nombre`, `movimientos_inventario.usuario`, `pagos.creado_por`… son TEXTO,
// y Comisiones y Reportes agrupan por ese texto. Corregir solo la ficha parte a la persona en dos
// con la mitad de las ventas cada una — por eso el cambio va por la RPC `renombrar_persona`.
//
// POR QUÉ HAY QUE ELEGIR LAS GRAFÍAS A MANO. Un typo no se detecta solo. El caso que originó esto:
// la misma persona figura como 'ROSIMAR PACHECO' en `usuarios` (1.359 registros) y como
// 'Rosimar Pachecho' en `vendedores` y en 282 documentos — 'Pachecho' y 'PACHECO' no normalizan al
// mismo texto porque sobra una sílaba, no un acento. Ninguna heurística puede decidir sin
// equivocarse que son la misma persona, así que el sistema SUGIERE por similitud y el humano marca.
window.CorregirNombreModal = function CorregirNombreModal({ usuario, onClose, onDone }) {
  const [nuevo, setNuevo]         = uState(usuario?.nombre || '');
  const [variantes, setVariantes] = uState(null);   // null = todavía buscando
  const [elegidas, setElegidas]   = uState(() => new Set([usuario?.nombre].filter(Boolean)));
  const [guardando, setGuardando] = uState(false);
  const [msg, setMsg]             = uState('');

  uEffect(() => {
    let vivo = true;
    (async () => {
      const r = await window.variantesPersona?.(usuario?.nombre);
      if (!vivo) return;
      setVariantes(r?.variantes || []);
    })();
    return () => { vivo = false; };
  }, [usuario?.nombre]);

  const toggle = (n) => setElegidas(prev => {
    const s = new Set(prev);
    if (s.has(n)) s.delete(n); else s.add(n);
    return s;
  });

  // Lo que se va a tocar, sumando solo las grafías marcadas.
  const totalTocado = (variantes || [])
    .filter(v => elegidas.has(v.nombre))
    .reduce((a, v) => a + (v?.usos?.total || 0), 0);

  const limpio = String(nuevo || '').trim().replace(/\s+/g, ' ');
  const sinCambio = elegidas.size === 1 && elegidas.has(limpio);
  const puedeGuardar = !!limpio && elegidas.size > 0 && !sinCambio && !guardando;

  async function guardar() {
    setGuardando(true); setMsg('');
    const r = await window.renombrarPersona([...elegidas], limpio);
    setGuardando(false);
    if (r?.error) { setMsg('No se pudo corregir: ' + (r.error.message || 'error')); return; }
    window.logActivity?.({
      modulo: 'usuarios', accion: 'editar', entidad_id: usuario.id, entidad_label: limpio,
      detalles: { campo: 'nombre', anteriores: [...elegidas], nuevo: limpio, registros: r.registros },
    });
    onDone?.(limpio, r);
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Corregir el nombre</div>
        </div>
        <div className="modal-body" style={{ display:'flex', flexDirection:'column', gap:14 }}>

          <div>
            <div className="small muted" style={{ marginBottom:4 }}>Nombre correcto</div>
            <input className="input" value={nuevo} autoFocus
                   onChange={e => setNuevo(e.target.value)}
                   placeholder="Nombre y apellido"/>
          </div>

          <div>
            <div className="small muted" style={{ marginBottom:6 }}>
              ¿Con qué nombres aparece hoy en el sistema? Marcá los que sean de esta persona.
            </div>
            {variantes === null && <div className="small muted">Buscando…</div>}
            {variantes && variantes.length === 0 && (
              <div className="small muted">No se encontró ningún otro nombre parecido.</div>
            )}
            {(variantes || []).map(v => (
              <label key={v.nombre}
                     style={{ display:'flex', gap:8, alignItems:'flex-start', padding:'7px 0',
                              borderBottom:'1px solid var(--border)', cursor:'pointer' }}>
                <input type="checkbox" checked={elegidas.has(v.nombre)} onChange={() => toggle(v.nombre)}
                       style={{ marginTop:3 }}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:500 }}>{v.nombre}</div>
                  <div className="small muted">
                    {(v?.usos?.total || 0).toLocaleString('es-VE')} registro{(v?.usos?.total || 0) === 1 ? '' : 's'}
                    {v.origenes?.length ? ' · ' + v.origenes.join(', ') : ''}
                  </div>
                </div>
              </label>
            ))}
          </div>

          {/* El alcance se dice ANTES de confirmar: son cientos de filas y no hay "deshacer". */}
          {totalTocado > 0 && (
            <div className="small" style={{ background:'var(--bg-soft)', border:'1px solid var(--border)',
                                            borderRadius:6, padding:'9px 11px' }}>
              Se va a corregir en <b>{totalTocado.toLocaleString('es-VE')} registros</b>: documentos,
              cobros, movimientos de inventario y el registro de actividad. Las ventas y comisiones
              históricas quedan todas bajo el nombre corregido.
            </div>
          )}

          {sinCambio && (
            <div className="small muted">El nombre nuevo es igual al actual.</div>
          )}
          {msg && <div className="small" style={{ color:'var(--danger)' }}>{msg}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button className="btn" onClick={guardar} disabled={!puedeGuardar}>
            {guardando ? 'Corrigiendo…' : 'Corregir en todo el sistema'}
          </button>
        </div>
      </div>
    </div>
  );
};

window.ConfigUsersPage = function ConfigUsersPage() {
  const [usuarios, setUsuarios] = uState([]);
  const [search, setSearch] = uState('');
  const [loading, setLoading] = uState(true);
  const [successMsg, setSuccessMsg] = uState('');
  const [showActivity, setShowActivity] = uState(false);
  const [page, setPage] = uState(1);
  const [pageSize, setPageSize] = uState(() => {
    const v = parseInt(localStorage.getItem('ss-config-users-pagesize'));
    return [50,100,200].includes(v) ? v : 50;
  });
  uEffect(() => { localStorage.setItem('ss-config-users-pagesize', String(pageSize)); }, [pageSize]);

  // Modal: nuevo usuario
  const [showCreate, setShowCreate] = uState(false);
  const [createSaving, setCreateSaving] = uState(false);
  const [createError, setCreateError] = uState('');
  const [form, setForm] = uState({ nombre: '', email: '', password: '', rol: 'Ventas', avatar: AVATARS[0] });

  // Modal: detalle / editar usuario (clic en fila)
  const [selectedUser, setSelectedUser] = uState(null);
  const [detailTab, setDetailTab] = uState('info');   // 'info' | 'pin' | 'pass'
  const [pinValue, setPinValue] = uState('');
  const [pinSaving, setPinSaving] = uState(false);
  const [pinMsg, setPinMsg] = uState('');
  const [newPass, setNewPass] = uState('');
  const [passSaving, setPassSaving] = uState(false);
  const [passMsg, setPassMsg] = uState('');
  // Acceso: correo + contraseña. Sirve tanto para crear el acceso de un usuario que
  // no lo tiene (los 19 migrados de Odoo) como para cambiarle el correo a uno que sí.
  const [emailValue, setEmailValue]     = uState('');
  const [accesoMsg, setAccesoMsg]       = uState('');
  const [accesoSaving, setAccesoSaving] = uState(false);

  const roles = window.getRolesList ? window.getRolesList().map(r => r.nombre) : ['Administrador','Gerente de Operaciones','Ventas Senior','Ventas','Contadora','Compras','CxC / CxP','Almacen Central','Almacen Valencia'];

  // ── Rol por empresa (2026-08-16) ────────────────────────────────────────────────────────────
  // usuarios.rol es UN SOLO nombre para todas las empresas del usuario; lo que sí es por empresa
  // es la tabla `roles` (mismo nombre, permisos distintos por fila). `getRolesList()` solo trae
  // los roles de la empresa ACTIVA — para un usuario con varias empresas eso deja ciego al admin
  // sobre las otras. Se resuelve aparte, consultando directo las empresas del usuario (no las de
  // quien mira), para poder avisar si el rol elegido no existe en alguna.
  const [rolesPorEmpresaUsuario, setRolesPorEmpresaUsuario] = uState({}); // { empresaId: Set(nombres) }
  uEffect(() => {
    if (!selectedUser?.empresas?.length) { setRolesPorEmpresaUsuario({}); return; }
    let alive = true;
    window.sb.from('roles').select('nombre, empresa_id').in('empresa_id', selectedUser.empresas)
      .then(({ data }) => {
        if (!alive) return;
        const m = {};
        (data || []).forEach(r => { (m[r.empresa_id] = m[r.empresa_id] || new Set()).add(r.nombre); });
        setRolesPorEmpresaUsuario(m);
      });
    return () => { alive = false; };
  }, [selectedUser?.id, selectedUser?.empresas?.join(',')]);

  // Empresas habilitadas por usuario
  const [empresasList, setEmpresasList] = uState([]);
  const [empSaving, setEmpSaving] = uState(false);
  const [empMsg, setEmpMsg]       = uState('');
  uEffect(() => { window.loadEmpresas?.().then(list => setEmpresasList(list || [])); }, []);

  async function toggleEmpresaUsuario(empresaId) {
    if (!selectedUser) return;
    const current = Array.isArray(selectedUser.empresas) ? selectedUser.empresas : ['demo1'];
    const next = current.includes(empresaId) ? current.filter(e => e !== empresaId) : [...current, empresaId];
    if (next.length === 0) { alert('El usuario debe tener al menos una empresa habilitada.'); return; }
    setEmpSaving(true);
    const { error } = await window.callAdminUsers('update', { id: selectedUser.id, fields: { empresas: next } });
    setEmpSaving(false);
    if (error) { alert('Error: ' + error.message); return; }
    setSelectedUser(prev => ({ ...prev, empresas: next }));
    setUsuarios(prev => prev.map(x => x.id === selectedUser.id ? { ...x, empresas: next } : x));
    window.logActivity?.({ modulo:'usuarios', accion:'editar', entidad_id:selectedUser.id, entidad_label:selectedUser.nombre, detalles:{ empresas: next } });
    // Las empresas viven en el token de sesión del usuario, no se leen en vivo. Si
    // tiene la sesión abierta no lo ve hasta que su token se renueve — la app lo
    // detecta y refresca sola al recargar, pero hay que decírselo a quien lo cambia
    // o parece que no funcionó.
    setEmpMsg(`✓ Empresas actualizadas. Si ${selectedUser.nombre} tiene la sesión abierta, `
      + 'debe recargar la página (o volver a entrar) para verlo.');
  }

  async function loadUsuarios() {
    setLoading(true);
    const { data } = await window.sb.from('usuarios').select('id, nombre, rol, avatar, online, iniciales, email, auth_id, activo, cliente_id, empresas, tiene_pin, telefono, pin_digitos, pin_prompt_omitido_en').order('nombre');
    // Hide users that are in the trash (zombie state from old failed deletes).
    // Refresca el cache de papelera server-side antes de leerlo (getAll es síncrono sobre cache).
    await window.ssTrash?.refresh?.();
    const trashIds = new Set(
      (window.ssTrash?.getAll() || [])
        .filter(t => t.tipo === 'usuario')
        .map(t => t.data?.id)
        .filter(Boolean)
    );
    const orphans = (data || []).filter(u => trashIds.has(u.id));
    // IDs cuyo borrado server-side SIGUIÓ fallando: no deben ocultarse de la lista,
    // porque la fila (y su acceso auth) siguen vivos en DB y el usuario puede autenticarse.
    const stillActive = new Set();
    if (orphans.length > 0) {
      // Re-attempt deletion for previously failed deletes (server-side)
      for (const o of orphans) {
        // FIX bug papelera-zombie: capturar el error del reintento. callAdminUsers no
        // lanza, devuelve {error}. Si el borrado sigue fallando, NO ocultar al usuario.
        const r = await window.callAdminUsers('delete', { id: o.id, authId: o.auth_id });
        if (r?.error) stillActive.add(o.id);
      }
    }
    // Ocultar solo los que están en papelera Y ya no siguen activos en DB (borrado OK).
    setUsuarios((data || []).filter(u => !trashIds.has(u.id) || stillActive.has(u.id)));
    setLoading(false);
  }
  uEffect(() => { loadUsuarios(); }, []);

  const filtered = usuarios.filter(u =>
    u.nombre.toLowerCase().includes(search.toLowerCase()) ||
    (u.rol || '').toLowerCase().includes(search.toLowerCase()) ||
    (u.email || '').toLowerCase().includes(search.toLowerCase())
  );

  function flash(msg) { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(''), 4000); }

  // ── Crear usuario ──────────────────────────────────────────────────────────
  async function handleCreate(e) {
    e.preventDefault();
    if (!form.nombre || !form.email || !form.password) { setCreateError('Todos los campos son obligatorios.'); return; }
    if (form.password.length < 8) { setCreateError('La contraseña debe tener al menos 8 caracteres.'); return; }
    setCreateSaving(true); setCreateError('');
    const result = await window.authCreateUser({ email: form.email, password: form.password, nombre: form.nombre, rol: form.rol, avatar: form.avatar });
    setCreateSaving(false);
    if (result.error) {
      const msg = result.error.message || '';
      setCreateError(msg.includes('already') ? 'Este correo ya está registrado.' : msg || 'Error al crear el usuario.');
      return;
    }
    setShowCreate(false);
    window.logActivity?.({
      modulo:'usuarios', accion:'crear',
      entidad_id: result.userId, entidad_label: form.nombre,
      detalles:{ email: form.email, rol: form.rol }
    });
    setForm({ nombre: '', email: '', password: '', rol: 'Ventas', avatar: AVATARS[0] });
    flash('Usuario creado correctamente.');
    loadUsuarios();
  }

  // ── Toggle activo ──────────────────────────────────────────────────────────
  async function handleToggle(u) {
    if (!u.auth_id) return;
    const next = !u.activo;
    const { error } = await window.authToggleUser(u.auth_id, next);
    if (error) { flash('Error al cambiar estado: ' + (error.message || 'desconocido')); return; }
    setUsuarios(prev => prev.map(x => x.id === u.id ? { ...x, activo: next } : x));
    if (selectedUser?.id === u.id) setSelectedUser(prev => ({ ...prev, activo: next }));
    window.logActivity?.({ modulo:'usuarios', accion:'editar', entidad_id:u.id, entidad_label:u.nombre, detalles:{ activo: next } });
    flash(next ? 'Usuario activado.' : 'Usuario desactivado.');
  }

  // ── Guardar PIN ────────────────────────────────────────────────────────────
  async function handleSavePin() {
    // 6 dígitos desde el 2026-08-19 (migración 92): con 4 son 10.000 combinaciones para un login que
    // devuelve un JWT real. La validación fuerte vive en el server (`admin-users`), esto es el aviso
    // temprano. Los PIN de 4 que ya existen siguen entrando hasta que su dueño lo cambie.
    if (!window.ssPinValido(pinValue)) { setPinMsg(window.ssPinMotivo(pinValue)); return; }
    setPinSaving(true); setPinMsg('');
    const { error } = await window.setUserPin(selectedUser.id, pinValue);
    setPinSaving(false);
    if (error) { setPinMsg('Error: ' + (error.message || 'No se pudo guardar el PIN.')); return; }
    setUsuarios(prev => prev.map(x => x.id === selectedUser.id ? { ...x, tiene_pin: true, pin_digitos: 6 } : x));
    setSelectedUser(prev => ({ ...prev, tiene_pin: true, pin_digitos: 6 }));
    window.logActivity?.({ modulo:'usuarios', accion:'editar', entidad_id:selectedUser.id, entidad_label:selectedUser.nombre, detalles:{ pin:'set' } });
    setPinMsg('✓ PIN guardado correctamente.');
    setPinValue('');
    setTimeout(() => setPinMsg(''), 3000);
  }

  async function handleClearPin() {
    setPinSaving(true);
    await window.setUserPin(selectedUser.id, null);
    setPinSaving(false);
    setUsuarios(prev => prev.map(x => x.id === selectedUser.id ? { ...x, tiene_pin: false } : x));
    setSelectedUser(prev => ({ ...prev, tiene_pin: false }));
    window.logActivity?.({ modulo:'usuarios', accion:'editar', entidad_id:selectedUser.id, entidad_label:selectedUser.nombre, detalles:{ pin:'borrado' } });
    setPinMsg('PIN eliminado.');
    setTimeout(() => setPinMsg(''), 2500);
  }

  // ── Cambiar contraseña ─────────────────────────────────────────────────────
  async function handleSetPassword() {
    if (!newPass || newPass.length < 8) { setPassMsg('Mínimo 8 caracteres.'); return; }
    setPassSaving(true); setPassMsg('');
    const { error } = await window.authSetPassword(selectedUser.auth_id, newPass);
    setPassSaving(false);
    if (error) { setPassMsg('Error: ' + error.message); return; }
    window.logActivity?.({ modulo:'usuarios', accion:'editar', entidad_id:selectedUser.id, entidad_label:selectedUser.nombre, detalles:{ password:'reset' } });
    setPassMsg('✓ Contraseña actualizada.');
    setNewPass('');
    setTimeout(() => setPassMsg(''), 3000);
  }

  // ── Eliminar usuario ──────────────────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = uState(false);
  const [deleteLoading, setDeleteLoading] = uState(false);
  const [editRol, setEditRol] = uState(null);
  const [rolSaving, setRolSaving] = uState(false);
  // Empresas del usuario donde el nombre de rol elegido (o el actual) NO existe.
  const rolActivo = editRol !== null ? editRol : selectedUser?.rol;
  const empresasSinEsteRol = (selectedUser?.empresas || []).filter(
    e => !(rolesPorEmpresaUsuario[e] || new Set()).has(rolActivo)
  );
  const [editTelefono, setEditTelefono] = uState(null);
  const [telSaving, setTelSaving] = uState(false);
  const [telMsg, setTelMsg] = uState('');
  // Corregir el nombre: abre el asistente de renombrado en cascada (ver CorregirNombreModal).
  const [corrigiendoNombre, setCorrigiendoNombre] = uState(null);
  // Quién puede corregir un nombre: un administrador a cualquiera, y CUALQUIERA el suyo propio
  // (fue el pedido textual: "tanto un admin como Rosimar poner bien su nombre"). El servidor
  // vuelve a chequear lo mismo en `renombrar_persona` — esto solo decide si se muestra el lápiz.
  const puedeCorregirNombre = (u) =>
    !!u && (window.canUser?.('administrar', 'config_usuarios') !== false
            || (!!window.__ssCurrentUser?.id && u.id === window.__ssCurrentUser.id));

  async function handleDeleteUser(u) {
    setDeleteLoading(true);
    // Borrado atómico server-side (admin-users): revoca auth.users Y borra la fila.
    const r = await window.callAdminUsers('delete', { id: u.id, authId: u.auth_id });
    if (r?.error) {
      setDeleteLoading(false);
      flash('No se pudo eliminar: ' + (r.error.message || 'error') + '. Usuario NO eliminado.');
      return;
    }
    window.ssTrash.add('usuario', u.nombre, u);
    window.logActivity?.({ modulo:'usuarios', accion:'eliminar', entidad_id:u.id, entidad_label:u.nombre, detalles:{ email:u.email, rol:u.rol } });
    setUsuarios(prev => prev.filter(x => x.id !== u.id));
    setSelectedUser(null);
    setDeleteConfirm(false);
    setDeleteLoading(false);
    flash('Usuario enviado a la papelera. Tienes 30 días para restaurarlo.');
  }

  async function handleSaveRol() {
    if (!editRol || editRol === selectedUser.rol) { setEditRol(null); return; }
    // Guardar un rol que no existe en alguna de las empresas habilitadas del usuario lo deja SIN
    // NINGÚN permiso ahí, en silencio (canUser niega todo ante un rol huérfano) — se avisa antes
    // de guardar en vez de después, que es cuando alguien reporta "no veo nada en Demo 2".
    if (empresasSinEsteRol.length > 0) {
      const nombres = empresasSinEsteRol.map(id => empresasList.find(e => e.id === id)?.nombre || id).join(', ');
      if (!confirm(`"${editRol}" no existe como rol en: ${nombres}.\n\n${selectedUser.nombre} se quedaría SIN NINGÚN permiso en esa(s) empresa(s) hasta que alguien cree ese rol ahí (Ajustes → Roles).\n\n¿Guardar de todas formas?`)) {
        return;
      }
    }
    setRolSaving(true);
    const before = selectedUser.rol;
    const { error: rolErr } = await window.callAdminUsers('update', { id: selectedUser.id, fields: { rol: editRol } });
    if (rolErr) { setRolSaving(false); flash('Error al cambiar rol: ' + (rolErr.message || '')); return; }
    setUsuarios(prev => prev.map(x => x.id === selectedUser.id ? { ...x, rol: editRol } : x));
    setSelectedUser(prev => ({ ...prev, rol: editRol }));
    window.logActivity?.({ modulo:'usuarios', accion:'editar', entidad_id:selectedUser.id, entidad_label:selectedUser.nombre, detalles:{ campo:'rol', before, after:editRol } });
    setRolSaving(false);
    setEditRol(null);
    flash('Rol actualizado correctamente.');
  }

  async function handleSaveTelefono() {
    if (editTelefono === null || editTelefono === (selectedUser.telefono || '')) { setEditTelefono(null); return; }
    setTelSaving(true); setTelMsg('');
    const before = selectedUser.telefono || '';
    const { error } = await window.callAdminUsers('update', { id: selectedUser.id, fields: { telefono: editTelefono.trim() || null } });
    setTelSaving(false);
    if (error) { setTelMsg('Error: ' + (error.message || '')); return; }
    setUsuarios(prev => prev.map(x => x.id === selectedUser.id ? { ...x, telefono: editTelefono.trim() || null } : x));
    setSelectedUser(prev => ({ ...prev, telefono: editTelefono.trim() || null }));
    window.logActivity?.({ modulo:'usuarios', accion:'editar', entidad_id:selectedUser.id, entidad_label:selectedUser.nombre, detalles:{ campo:'telefono', before, after: editTelefono.trim() } });
    setEditTelefono(null);
    setTelMsg('✓ Teléfono actualizado.');
    setTimeout(() => setTelMsg(''), 3000);
  }

  // Crea el acceso de un usuario sin cuenta, o le cambia el correo si ya la tiene.
  // Todo el trabajo privilegiado (crear en auth.users, vincular auth_id) va por la
  // Edge Function: el cliente no escribe `usuarios` directamente.
  async function handleGuardarAcceso() {
    const mail = (emailValue || '').trim().toLowerCase();
    if (!mail) return setAccesoMsg('El correo es obligatorio.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return setAccesoMsg('Ese correo no tiene un formato válido.');
    const yaTiene = !!selectedUser.auth_id;
    if (!yaTiene && (!newPass || newPass.length < 8)) {
      return setAccesoMsg('Para crear el acceso hace falta una contraseña de mínimo 8 caracteres.');
    }
    if (yaTiene && newPass && newPass.length < 8) {
      return setAccesoMsg('La contraseña debe tener al menos 8 caracteres.');
    }

    setAccesoSaving(true);
    setAccesoMsg('');
    // callAdminUsers devuelve el cuerpo de la respuesta tal cual (no {data,error}).
    const r = await window.callAdminUsers('setEmail', {
      id: selectedUser.id, email: mail, password: newPass || undefined,
    });
    setAccesoSaving(false);
    if (r.error) {
      const m = r.error.message || '';
      setAccesoMsg(m === 'email_ya_registrado'
        ? 'Ese correo ya tiene una cuenta de acceso. Usá otro.'
        : m === 'password_requerida'
          ? 'Para crear el acceso hace falta una contraseña de mínimo 8 caracteres.'
          : 'No se pudo guardar: ' + m);
      return;
    }
    const authId = r.authId || selectedUser.auth_id;
    setUsuarios(prev => prev.map(x => x.id === selectedUser.id ? { ...x, email: mail, auth_id: authId } : x));
    setSelectedUser(prev => ({ ...prev, email: mail, auth_id: authId }));
    setNewPass('');
    window.logActivity?.({ modulo:'usuarios', accion: yaTiene ? 'editar' : 'crear_acceso',
      entidad_id: selectedUser.id, entidad_label: selectedUser.nombre,
      detalles: { campo:'email', after: mail, creo_acceso: !yaTiene } });
    setAccesoMsg(yaTiene ? '✓ Correo actualizado.' : '✓ Acceso creado. Ya puede iniciar sesión con ese correo.');
  }

  function openDetail(u) {
    setSelectedUser(u);
    setDetailTab('info');
    setPinValue(''); // PIN write-only: nunca se lee/precarga el PIN existente
    setPinMsg(''); setPassMsg(''); setNewPass('');
    setEmailValue(u.email || '');
    setAccesoMsg('');
    setEmpMsg('');
    setDeleteConfirm(false);
    setEditRol(null);
    setEditTelefono(null);
    setTelMsg('');
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Gestión de Usuarios</h1>
          <div className="page-subtitle">{usuarios.length} usuarios registrados · {usuarios.filter(u => u.activo !== false).length} activos</div>
        </div>
        <div className="page-actions">
          {window.canUser?.('administrar','config_usuarios') !== false && (
            <button className="btn primary" onClick={() => { setShowCreate(true); setCreateError(''); setForm({ nombre:'', email:'', password:'', rol:'Ventas', avatar:AVATARS[0] }); }}>
              <Icon name="plus" size={14} /> Nuevo Usuario
            </button>
          )}
          <button className="btn ghost" onClick={() => setShowActivity(true)} title="Ver registro de actividad"><Icon name="receipt" size={14}/>Actividad</button>
        </div>
      </div>

      {showActivity && <ActivityLogModal modulo="usuarios" onClose={()=>setShowActivity(false)}/>}

      {successMsg && (
        <div style={{ background:'var(--success-soft)', border:'1px solid var(--success)', borderRadius:8, padding:'10px 14px', marginBottom:16, fontSize:13, color:'var(--success)', display:'flex', alignItems:'center', gap:8 }}>
          <Icon name="check" size={14} /> {successMsg}
        </div>
      )}

      <div className="tbl-wrap">
        <div className="tbl-toolbar">
          <input className="input search" placeholder="Buscar por nombre, rol o email…" style={{ width:280 }} value={search} onChange={e => setSearch(e.target.value)} />
          <div className="ml-auto"><span className="small">{filtered.length} resultados</span></div>
        </div>
        <div className="tbl-scroll">
          {loading ? (
            <div className="empty">Cargando usuarios…</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Usuario</th><th>Rol</th><th>Portal</th><th>Email</th>
                  <th>PIN</th><th>Auth</th><th>Estado</th><th className="dt-hide-mobile">Creado por</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice((page-1)*pageSize, page*pageSize).map(u => {
                  const portal = u.rol === 'Driver' ? { label:'Portal Drivers', cls:'amber' }
                              : u.rol === 'Cliente' ? { label:'Portal Clientes', cls:'purple' }
                              : { label:'Admin Central', cls:'blue' };
                  return (
                  <tr key={u.id} style={{ opacity: u.activo === false ? 0.5 : 1, cursor:'pointer' }} onClick={() => openDetail(u)}>
                    <td>
                      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <Avatar user={u} size={32} />
                        <div>
                          <div style={{ fontWeight:500 }}>{u.nombre}</div>
                          <div style={{ fontSize:11, color:'var(--text-muted)', fontFamily:'var(--mono)' }}>{u.iniciales}</div>
                        </div>
                      </div>
                    </td>
                    <td><span className={`chip ${ROLE_COLORS[u.rol] || 'neutral'}`}>{u.rol || '—'}</span></td>
                    <td><span className={`chip ${portal.cls}`}>{portal.label}</span></td>
                    <td><span className="small mono-cell">{u.email || '—'}</span></td>
                    <td>
                      {u.tiene_pin
                        ? <span className="chip green">Configurado</span>
                        : <span className="chip neutral">Sin PIN</span>}
                    </td>
                    <td>
                      {u.auth_id ? <span className="chip green">Vinculado</span> : <span className="chip neutral">Sin auth</span>}
                    </td>
                    <td>
                      {u.activo === false ? <span className="chip red">Inactivo</span> : <span className="chip green">Activo</span>}
                    </td>
                    <td className="dt-hide-mobile"><CreadoPorCell nombre={u.creado_por}/></td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display:'flex', gap:4, justifyContent:'flex-end' }}>
                        <button className="btn ghost sm" onClick={() => openDetail(u)} title="Ver detalle">
                          <Icon name="chevronR" size={13}/>
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {(() => {
          const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
          return (
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px',borderTop:'1px solid var(--border)',fontSize:12,gap:10,flexWrap:'wrap'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span className="muted">Filas por página:</span>
                <select className="select" value={pageSize} onChange={e=>{setPageSize(parseInt(e.target.value));setPage(1);}} style={{fontSize:12,padding:'3px 6px'}}>
                  {[50,100,200].map(n=><option key={n} value={n}>{n}</option>)}
                </select>
                <span className="muted">{filtered.length===0?'0':`Mostrando ${(page-1)*pageSize+1}–${Math.min(page*pageSize,filtered.length)} de ${filtered.length}`}</span>
              </div>
              {totalPages>1&&<div style={{display:'flex',gap:4}}>
                <button className="btn ghost sm" disabled={page===1} onClick={()=>setPage(p=>p-1)}><Icon name="chevronL" size={13}/></button>
                {Array.from({length:Math.min(5,totalPages)},(_,i)=>Math.max(1,Math.min(totalPages-4,page-2))+i).filter(p=>p>=1&&p<=totalPages).map(p=>(
                  <button key={p} className={'btn sm '+(p===page?'primary':'ghost')} style={{minWidth:32}} onClick={()=>setPage(p)}>{p}</button>
                ))}
                <button className="btn ghost sm" disabled={page===totalPages} onClick={()=>setPage(p=>p+1)}><Icon name="chevronR" size={13}/></button>
              </div>}
            </div>
          );
        })()}
      </div>

      {/* ── Modal: Nuevo usuario ──────────────────────────────────────────── */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" style={{ width: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ width:36, height:36, borderRadius:8, background:'var(--brand-soft)', display:'grid', placeItems:'center' }}>
                <Icon name="user" size={18} />
              </div>
              <div style={{ flex:1 }}>
                <h2 className="modal-title">Nuevo Usuario</h2>
                <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:1 }}>Crear cuenta y perfil de acceso</div>
              </div>
              <button className="icon-btn" onClick={() => setShowCreate(false)}><Icon name="x" size={16}/></button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="grid-2" style={{ gap:14, marginBottom:14 }}>
                  <div>
                    <label className="form-label">Nombre completo</label>
                    <input className="input" style={{ width:'100%' }} placeholder="Juan Pérez" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Correo electrónico</label>
                    <input className="input" type="email" style={{ width:'100%' }} placeholder="usuario@empresa.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Contraseña inicial</label>
                    <input className="input" type="password" style={{ width:'100%' }} placeholder="Mínimo 8 caracteres" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Rol</label>
                    <select className="select" style={{ width:'100%' }} value={form.rol} onChange={e => setForm(f => ({ ...f, rol: e.target.value }))}>
                      {roles.map(r => <option key={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="form-label">Color de avatar</label>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:4 }}>
                    {AVATARS.map(c => (
                      <button key={c} type="button" onClick={() => setForm(f => ({ ...f, avatar: c }))}
                        style={{ width:28, height:28, borderRadius:'50%', background:c, border: form.avatar === c ? '3px solid var(--brand)' : '2px solid transparent', outline: form.avatar === c ? '2px solid var(--bg-elev)' : 'none', cursor:'pointer' }}
                      />
                    ))}
                  </div>
                </div>
                {createError && (
                  <div style={{ background:'var(--danger-soft)', color:'var(--danger)', border:'1px solid var(--danger)', borderRadius:6, padding:'8px 12px', fontSize:12.5, marginTop:14, display:'flex', gap:8, alignItems:'center' }}>
                    <Icon name="info" size={13}/> {createError}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn secondary" onClick={() => setShowCreate(false)}>Cancelar</button>
                <button type="submit" className="btn primary" disabled={createSaving}>
                  {createSaving ? 'Creando…' : <><Icon name="plus" size={14}/> Crear usuario</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Detalle de usuario ────────────────────────────────────── */}
      {selectedUser && (
        <div className="modal-overlay" onClick={() => setSelectedUser(null)}>
          <div className="modal" style={{ width:480 }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="modal-header" style={{ gap:14 }}>
              <Avatar user={selectedUser} size={44} />
              <div style={{ flex:1 }}>
                <h2 className="modal-title" style={{ fontSize:16 }}>{selectedUser.nombre}</h2>
                <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:1 }}>
                  {selectedUser.rol} · {selectedUser.email || 'Sin email'}
                </div>
              </div>
              <button className="icon-btn" onClick={() => setSelectedUser(null)}><Icon name="x" size={16}/></button>
            </div>

            {/* Chips */}
            <div style={{ display:'flex', gap:8, padding:'0 20px 14px', borderBottom:'1px solid var(--border)' }}>
              {selectedUser.auth_id ? <span className="chip green">Auth vinculado</span> : <span className="chip neutral">Sin auth</span>}
              {selectedUser.tiene_pin ? <span className="chip blue">PIN configurado</span> : <span className="chip neutral">Sin PIN</span>}
              {selectedUser.activo === false ? <span className="chip red">Inactivo</span> : <span className="chip green">Activo</span>}
            </div>

            {/* Tabs */}
            <div style={{ display:'flex', borderBottom:'1px solid var(--border)' }}>
              {[['info','Información'],['pin','Código PIN'],['pass','Acceso']].map(([t, label]) => (
                <button key={t} onClick={() => { setDetailTab(t); setPinMsg(''); setPassMsg(''); }}
                  style={{ padding:'9px 18px', fontSize:13, fontWeight: detailTab===t ? 600 : 400, color: detailTab===t ? 'var(--brand)' : 'var(--text-muted)', borderBottom: detailTab===t ? '2px solid var(--brand)' : '2px solid transparent', marginBottom:-1, background:'none', border:'none', cursor:'pointer' }}>
                  {label}
                </button>
              ))}
            </div>

            <div className="modal-body">

              {/* Tab: Información */}
              {detailTab === 'info' && (
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  <div className="grid-2" style={{ gap:12 }}>
                    <div>
                      <div className="small muted" style={{ marginBottom:3 }}>Nombre completo</div>
                      <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                        <div style={{ fontWeight:500 }}>{selectedUser.nombre}</div>
                        {puedeCorregirNombre(selectedUser) && (
                          <button
                            className="icon-btn"
                            title="Corregir el nombre en todo el sistema"
                            onClick={() => setCorrigiendoNombre(selectedUser)}
                          >
                            <Icon name="edit" size={13}/>
                          </button>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="small muted" style={{ marginBottom:3 }}>Iniciales</div>
                      <div className="mono" style={{ fontWeight:600, fontSize:16 }}>{selectedUser.iniciales || '—'}</div>
                    </div>
                    <div>
                      <div className="small muted" style={{ marginBottom:3 }}>Correo</div>
                      <div style={{ fontFamily:'var(--mono)', fontSize:12.5 }}>{selectedUser.email || '—'}</div>
                    </div>
                    <div>
                      <div className="small muted" style={{ marginBottom:3 }}>Teléfono</div>
                      {window.canUser?.('administrar','config_usuarios') !== false ? (
                        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                          <input
                            className="input"
                            style={{ fontSize:12.5, padding:'4px 8px' }}
                            placeholder="0412-0000000"
                            value={editTelefono !== null ? editTelefono : (selectedUser.telefono || '')}
                            onChange={e => setEditTelefono(e.target.value)}
                          />
                          {editTelefono !== null && editTelefono !== (selectedUser.telefono || '') && (
                            <button className="icon-btn" title="Guardar" onClick={handleSaveTelefono} disabled={telSaving}>
                              <Icon name="check" size={14}/>
                            </button>
                          )}
                        </div>
                      ) : (
                        <div style={{ fontFamily:'var(--mono)', fontSize:12.5 }}>{selectedUser.telefono || '—'}</div>
                      )}
                      {telMsg && (
                        <div style={{ marginTop:4, fontSize:11.5, color: telMsg.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>{telMsg}</div>
                      )}
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <div className="small muted" style={{ marginBottom:6 }}>Rol</div>
                      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                        <select
                          className="select"
                          style={{ flex:1 }}
                          value={editRol !== null ? editRol : (selectedUser.rol || '')}
                          onChange={e => setEditRol(e.target.value)}
                        >
                          {roles.map(r => <option key={r}>{r}</option>)}
                        </select>
                        {editRol !== null && editRol !== selectedUser.rol && window.canUser?.('administrar','config_usuarios') !== false && (
                          <button className="btn primary sm" onClick={handleSaveRol} disabled={rolSaving}>
                            {rolSaving ? 'Guardando…' : <><Icon name="check" size={13}/>Guardar</>}
                          </button>
                        )}
                        {editRol !== null && (
                          <button className="btn ghost sm" onClick={() => setEditRol(null)}>Cancelar</button>
                        )}
                      </div>
                      {editRol === null && (
                        <div style={{ marginTop:6 }}>
                          <span className={`chip ${ROLE_COLORS[selectedUser.rol] || 'neutral'}`}>{selectedUser.rol || '—'}</span>
                        </div>
                      )}
                      {/* "{rolActivo}" es un solo nombre para todas sus empresas, pero los permisos que
                          otorga son una fila DISTINTA por empresa en la tabla roles — acá se ve en
                          cuáles existe (y qué autoriza no es lo mismo en cada una, aunque se llame igual). */}
                      {(selectedUser.empresas || []).length > 1 && rolActivo && (
                        <div style={{ marginTop:8, display:'flex', flexWrap:'wrap', gap:6, alignItems:'center' }}>
                          <span className="small muted" style={{ fontSize:11 }}>Vigencia de "{rolActivo}" por empresa:</span>
                          {(selectedUser.empresas || []).map(empId => {
                            const empresa = empresasList.find(e => e.id === empId);
                            const existe = (rolesPorEmpresaUsuario[empId] || new Set()).has(rolActivo);
                            return (
                              <span key={empId} className="chip" style={{
                                fontSize:11, background: existe ? 'var(--success)18' : 'var(--danger,#dc2626)18',
                                color: existe ? 'var(--success)' : 'var(--danger,#dc2626)',
                              }} title={existe ? `Existe en ${empresa?.nombre || empId} — puede tener permisos distintos que en las otras empresas` : `NO existe en ${empresa?.nombre || empId} — sin este rol ahí, el usuario no tiene ningún permiso en esa empresa`}>
                                {existe ? <Icon name="check" size={10}/> : <Icon name="x" size={10}/>} {empresa?.nombre || empId}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {empresasSinEsteRol.length > 0 && (
                        <div style={{ marginTop:6, padding:'8px 10px', background:'var(--danger,#dc2626)10', color:'var(--danger,#dc2626)', borderRadius:6, fontSize:11.5, lineHeight:1.4 }}>
                          Sin permisos en {empresasSinEsteRol.map(id => empresasList.find(e => e.id === id)?.nombre || id).join(', ')} — ese rol no existe ahí. Créalo desde Ajustes → Roles (con la empresa correspondiente activa) para que este usuario tenga acceso.
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ marginTop:4 }}>
                    <div className="small muted" style={{ marginBottom:6 }}>Empresas habilitadas</div>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                      {empresasList.map(e => {
                        const enabled = (selectedUser.empresas || ['demo1']).includes(e.id);
                        const canToggleEmp = window.canUser?.('administrar','config_usuarios') !== false;
                        return (
                          <button key={e.id} type="button" disabled={empSaving || !canToggleEmp} onClick={() => toggleEmpresaUsuario(e.id)} style={{
                            display:'flex', alignItems:'center', gap:6, padding:'6px 10px', fontSize:12,
                            border:'1px solid ' + (enabled ? (e.color || 'var(--brand)') : 'var(--border)'),
                            background: enabled ? (e.color || 'var(--brand)') + '14' : 'transparent',
                            color: enabled ? 'var(--text)' : 'var(--text-muted)',
                            borderRadius:6, cursor: (empSaving || !canToggleEmp) ? (empSaving ? 'wait' : 'not-allowed') : 'pointer', fontWeight: enabled ? 600 : 400
                          }}>
                            <span style={{ width:8, height:8, borderRadius:'50%', background: e.color || 'var(--brand)' }}></span>
                            {e.nombre}
                            {enabled && <Icon name="check" size={11}/>}
                          </button>
                        );
                      })}
                    </div>
                    <div className="small muted" style={{ marginTop:4, fontSize:11 }}>El usuario solo verá los datos de las empresas habilitadas.</div>
                    {empMsg && (
                      <div style={{ marginTop:6, fontSize:12, color:'var(--success)', lineHeight:1.4 }}>{empMsg}</div>
                    )}
                  </div>
                  <div style={{ marginTop:4 }}>
                    <div className="small muted" style={{ marginBottom:3 }}>Auth ID</div>
                    <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text-muted)', wordBreak:'break-all' }}>{selectedUser.auth_id || 'No vinculado'}</div>
                  </div>
                </div>
              )}

              {/* Tab: PIN */}
              {detailTab === 'pin' && (
                <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                  <div style={{ background:'var(--bg-sunken)', borderRadius:8, padding:'10px 14px', fontSize:12.5, color:'var(--text-muted)' }}>
                    El código PIN de 6 dígitos permite al usuario iniciar sesión rápidamente desde la pantalla de acceso sin escribir su correo ni contraseña. Los PIN de 4 dígitos que ya existen siguen funcionando hasta que su dueño lo cambie.
                  </div>

                  <div>
                    <label className="form-label">Nuevo código PIN (6 dígitos)</label>
                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                      <input
                        className="input mono-cell"
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="000000"
                        value={pinValue}
                        onChange={e => { const v = e.target.value.replace(/\D/g,'').slice(0,6); setPinValue(v); setPinMsg(''); }}
                        style={{ width:140, fontSize:22, fontWeight:600, letterSpacing:6, textAlign:'center' }}
                        autoFocus
                      />
                      {window.canUser?.('administrar','config_usuarios') !== false && (
                        <button className="btn primary" onClick={handleSavePin} disabled={pinSaving || pinValue.length !== 6}>
                          {pinSaving ? '…' : <><Icon name="check" size={13}/>Guardar</>}
                        </button>
                      )}
                      {selectedUser.tiene_pin && window.canUser?.('administrar','config_usuarios') !== false && (
                        <button className="btn ghost sm" style={{ color:'var(--danger)' }} onClick={handleClearPin} disabled={pinSaving}>
                          Eliminar PIN
                        </button>
                      )}
                    </div>
                  </div>

                  {pinMsg && (
                    <div style={{ fontSize:13, color: pinMsg.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>
                      {pinMsg}
                    </div>
                  )}

                  {selectedUser.tiene_pin && (
                    <div style={{ fontSize:12.5, color:'var(--text-muted)' }}>
                      PIN actual configurado: <span style={{ fontFamily:'var(--mono)', fontWeight:600, letterSpacing:3, color:'var(--brand)' }}>••••</span>
                    </div>
                  )}
                </div>
              )}

              {/* Tab: Acceso (correo + contraseña) */}
              {detailTab === 'pass' && (
                <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                  {/* Los 19 usuarios que vinieron de la migración de Odoo no tienen
                      correo ni cuenta de acceso: existen para asignarles documentos y
                      comisiones, pero no pueden entrar. Acá se les da el acceso. */}
                  {!selectedUser.auth_id && (
                    <div style={{ padding:'10px 12px', borderRadius:8, border:'1.5px solid var(--warn)', background:'var(--warn-soft,#fef3c7)' }}>
                      <div style={{ fontWeight:600, fontSize:13, color:'var(--warn)' }}>Este usuario todavía no puede iniciar sesión</div>
                      <div className="small muted" style={{ marginTop:2 }}>
                        Asignale un correo y una contraseña para crear su acceso. El nombre, rol y su
                        historial de documentos se conservan.
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="form-label">Correo de acceso</label>
                    <input className="input" type="email" style={{ width:'100%' }}
                           placeholder="nombre@empresa.com"
                           value={emailValue} onChange={e => { setEmailValue(e.target.value); setAccesoMsg(''); }}
                           autoFocus={!selectedUser.auth_id} />
                    {selectedUser.auth_id && (
                      <div className="small muted" style={{ marginTop:3 }}>
                        Cambiarlo también cambia el correo con el que entra al sistema.
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="form-label">
                      {selectedUser.auth_id ? 'Nueva contraseña' : 'Contraseña inicial'}
                    </label>
                    <input className="input" type="password" style={{ width:'100%' }}
                           placeholder={selectedUser.auth_id ? 'Dejar vacío para no cambiarla' : 'Mínimo 8 caracteres'}
                           value={newPass} onChange={e => { setNewPass(e.target.value); setPassMsg(''); setAccesoMsg(''); }} />
                  </div>

                  {window.canUser?.('administrar','config_usuarios') !== false && (
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      <button className="btn primary" onClick={handleGuardarAcceso} disabled={accesoSaving}>
                        {accesoSaving ? 'Guardando…'
                          : <><Icon name="check" size={13}/>{selectedUser.auth_id ? 'Guardar acceso' : 'Crear acceso'}</>}
                      </button>
                      {selectedUser.auth_id && newPass && (
                        <button className="btn secondary" onClick={handleSetPassword} disabled={passSaving}>
                          {passSaving ? 'Actualizando…' : 'Solo cambiar contraseña'}
                        </button>
                      )}
                    </div>
                  )}
                  {accesoMsg && <div style={{ fontSize:13, color: accesoMsg.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>{accesoMsg}</div>}
                  {passMsg && <div style={{ fontSize:13, color: passMsg.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>{passMsg}</div>}
                </div>
              )}
            </div>

            <div className="modal-footer" style={{flexDirection:'column',gap:0,padding:0}}>
              {deleteConfirm && (
                <div style={{padding:'12px 20px',background:'#dc262610',borderTop:'1px solid var(--danger)',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                  <span style={{fontSize:13,flex:1,color:'var(--danger)',fontWeight:500}}>
                    ¿Eliminar a {selectedUser.nombre}? Se guardará en la papelera 30 días.
                  </span>
                  <button className="btn ghost sm" onClick={() => setDeleteConfirm(false)} disabled={deleteLoading}>Cancelar</button>
                  <button className="btn ghost sm" style={{color:'var(--danger)',fontWeight:600}} onClick={() => handleDeleteUser(selectedUser)} disabled={deleteLoading}>
                    <Icon name="trash" size={13}/>{deleteLoading ? 'Eliminando…' : 'Confirmar eliminación'}
                  </button>
                </div>
              )}
              <div style={{display:'flex',gap:8,padding:'12px 20px',width:'100%',boxSizing:'border-box'}}>
                {window.canUser?.('administrar','config_usuarios') !== false && (
                  <button
                    className="btn ghost sm"
                    style={{ color:'var(--danger)' }}
                    onClick={() => setDeleteConfirm(true)}
                    title="Eliminar usuario"
                  >
                    <Icon name="trash" size={13}/>Eliminar
                  </button>
                )}
                {selectedUser.auth_id && window.canUser?.('administrar','config_usuarios') !== false && (
                  <button
                    className="btn ghost sm"
                    style={{ color: selectedUser.activo === false ? 'var(--success)' : 'var(--warn)' }}
                    onClick={() => handleToggle(selectedUser)}
                  >
                    <Icon name={selectedUser.activo === false ? 'check' : 'dash'} size={13}/>
                    {selectedUser.activo === false ? 'Activar' : 'Desactivar'}
                  </button>
                )}
                <button className="btn secondary" style={{marginLeft:'auto'}} onClick={() => setSelectedUser(null)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* HERMANO del modal de detalle, no hijo: un overlay adentro de otro se cierra con
          cualquier clic (el evento burbujea al onClick del de atrás y React desmonta los dos).
          Ver CLAUDE.md, "Un modal NO va dentro del overlay de otro". */}
      {corrigiendoNombre && (
        <CorregirNombreModal
          usuario={corrigiendoNombre}
          onClose={() => setCorrigiendoNombre(null)}
          onDone={(nuevo) => {
            setUsuarios(prev => prev.map(x => x.id === corrigiendoNombre.id ? { ...x, nombre: nuevo } : x));
            setSelectedUser(prev => (prev && prev.id === corrigiendoNombre.id ? { ...prev, nombre: nuevo } : prev));
            setCorrigiendoNombre(null);
          }}
        />
      )}
    </div>
  );
};

// ── Role System ────────────────────────────────────────────────────────────
// ── Módulos navegables ────────────────────────────────────────────────────
// Cada módulo real de CRUD lleva ver/crear/editar/eliminar (+ acciones extra
// como anular/cancelar). Los módulos de solo-vista/reporte llevan las acciones
// que representan una capacidad real (p. ej. reportes guardados = CRUD completo).
// El permiso 'ver' controla si el módulo es visible: sin 'ver' el sidebar oculta
// el link y la ruta bloquea el acceso directo.
const ROLES_MODULES = [
  { id: 'asistente',    label: 'Asistente IA',          group: 'Principal',    actions: ['ver','crear','eliminar'] },
  // El flujo (cotización→orden→factura→despacho) compartía UN solo módulo `pos`, así que un rol no
  // podía ver facturas sin ver también despachos, ni cancelar cotizaciones sin poder anular facturas.
  // Se separó en 4 módulos (2026-08-13) — `pos` queda solo para el compositor (crear cotización/orden
  // desde cero). Ninguno de los 4 tiene `eliminar`: anular/cancelar dejaron de borrar la fila (quedan
  // en su propia pestaña "Canceladas"/"Anuladas", ver `window.anularDocumento`/`cancelarDocumento`),
  // así que no hay ya un borrado que gatear.
  { id: 'pos',          label: 'POS · Compositor (crear)', group: 'Principal',    actions: ['ver','crear'] },
  { id: 'cotizacion',   label: 'Cotizaciones',          group: 'Principal',    actions: ['ver','crear','editar','cancelar'] },
  { id: 'orden',        label: 'Órdenes',               group: 'Principal',    actions: ['ver','crear','editar','cancelar'] },
  { id: 'factura',      label: 'Facturas',              group: 'Principal',    actions: ['ver','crear','editar','anular'] },
  { id: 'despacho',     label: 'Despachos',             group: 'Principal',    actions: ['ver','crear','editar','anular'] },
  { id: 'inventory',    label: 'Inventarios',            group: 'Catálogo',     actions: ['ver','crear','editar','eliminar'] },
  { id: 'prices',       label: 'Listas de Precios',      group: 'Catálogo',     actions: ['ver','crear','editar','eliminar'] },
  { id: 'bulk',         label: 'Cargas Masivas',         group: 'Catálogo',     actions: ['ver','crear'] },
  { id: 'dropshipping', label: 'Dropshipping',           group: 'Catálogo',     actions: ['ver','crear','editar','eliminar'] },
  { id: 'sync',         label: 'Sincronización Shopify', group: 'Catálogo',     actions: ['ver','crear','editar'] },
  { id: 'clients',      label: 'Clientes',               group: 'Comercial',    actions: ['ver','crear','editar','eliminar'] },
  { id: 'contacts',     label: 'Contactos',              group: 'Comercial',    actions: ['ver','crear','editar','eliminar'] },
  { id: 'suppliers',    label: 'Proveedores',             group: 'Comercial',    actions: ['ver','crear','editar','eliminar'] },
  { id: 'vendedores',   label: 'Vendedores',              group: 'Comercial',    actions: ['ver','crear','editar','eliminar'] },
  { id: 'cxc',          label: 'Cuentas por Cobrar',     group: 'Finanzas',     actions: ['ver','crear','editar','anular','eliminar'] },
  { id: 'cxp',          label: 'Cuentas por Pagar',      group: 'Finanzas',     actions: ['ver','crear','editar','anular','eliminar'] },
  { id: 'bank',         label: 'Bancos / Conciliación',  group: 'Finanzas',     actions: ['ver','crear','editar','eliminar'] },
  { id: 'anticipos',    label: 'Anticipos de Clientes',  group: 'Finanzas',     actions: ['ver','crear','editar','eliminar'] },
  { id: 'inversiones',  label: 'Inversiones (capex)',    group: 'Finanzas',     actions: ['ver','crear','editar','eliminar'] },
  { id: 'retenciones',  label: 'Retenciones (IVA/ISLR)', group: 'Finanzas',     actions: ['ver','crear','editar','eliminar'] },
  { id: 'finanzas_reportes', label: 'Reportes de Finanzas',  group: 'Finanzas',     actions: ['ver'] },
  { id: 'reportes',     label: 'Reportes Dinámicos',     group: 'Reportes',     actions: ['ver','crear','editar','eliminar'] },
  // `eliminar` (2026-08-14): borrar una CxP de comisión ya creada (solo si sigue 'pendiente', ver
  // window.eliminarComisionCxP) — antes solo se podía borrar desde el módulo genérico de CxP, que
  // no revertía comision_estado y dejaba los documentos huérfanos.
  { id: 'comisiones',   label: 'Comisiones de Ventas',   group: 'Reportes',     actions: ['ver','crear','eliminar'] },
  { id: 'drivers',      label: 'Drivers',                group: 'Logística',    actions: ['ver','crear','editar','eliminar'] },
  { id: 'incidencias',  label: 'Incidencias',            group: 'Logística',    actions: ['ver','crear','editar','eliminar'] },
  { id: 'devoluciones', label: 'Devoluciones',           group: 'Logística',    actions: ['ver','crear','editar','eliminar'] },
  { id: 'garantias',    label: 'Garantías',              group: 'Logística',    actions: ['ver','crear','editar','eliminar'] },
  // Demo 2 fabrica racks/lockers/bandejas a partir de materia prima (láminas/ángulos/tubos).
  // `declarar_listo` es la acción que hace ENTRAR la cantidad al inventario real (vía
  // declarar_of_lista, RPC atómica) — separada de `editar` (avanzar de etapa corte/armado/
  // pintura) porque es la que de verdad compromete stock, y el taller puede necesitar avanzar
  // etapas sin poder "inventar" inventario.
  { id: 'fabricacion',  label: 'Fabricación',            group: 'Logística',    actions: ['ver','crear','editar','eliminar','declarar_listo'] },
  { id: 'chat',         label: 'Chat Interno',           group: 'Comunicación', actions: ['ver','crear'] },
  // Antes un solo módulo `config` gateaba las 5 páginas de Ajustes + Papelera: un rol con
  // `config.administrar` podía cambiar contraseñas de usuarios Y editar la matriz de roles Y tocar
  // la config del sistema, sin poder separar uno de otro. Pedido explícito (2026-08-14): que cada
  // página de Configuración sea su propio módulo de permisos, para decidir por rol quién entra a
  // cuál. `administrar` queda para la acción sensible de cada página (Usuarios: resetear
  // contraseña/PIN y cambiar rol/empresas; Roles: editar la matriz de permisos de otros roles) —
  // separada de `editar` (los campos propios del formulario) igual que en el resto de módulos.
  // Las acciones de cada uno son exactamente las que la página gatea hoy (no se inventó
  // granularidad nueva): `administrar` es la operación sensible de esa página puntual —en
  // Usuarios, resetear contraseña/PIN y cambiar rol/empresas; en Roles, editar la matriz de
  // permisos; en Almacenes, reasignarlo a otra empresa; en Papelera, purgar/restaurar.
  { id: 'config_usuarios',   label: 'Config · Gestión de Usuarios',        group: 'Sistema', actions: ['ver','administrar'] },
  { id: 'config_roles',      label: 'Config · Roles y Permisos',           group: 'Sistema', actions: ['ver','administrar'] },
  { id: 'config_sistema',    label: 'Config · Configuración del Sistema',  group: 'Sistema', actions: ['ver','editar','administrar'] },
  { id: 'config_campos',     label: 'Config · Campos y Validaciones',      group: 'Sistema', actions: ['ver','editar'] },
  { id: 'config_almacenes',  label: 'Config · Almacenes',                  group: 'Sistema', actions: ['ver','editar','administrar'] },
  { id: 'papelera',          label: 'Papelera',                            group: 'Sistema', actions: ['ver','administrar'] },
  // ── Permisos especiales de botones ──────────────────────────────────────
  // No son módulos navegables: cada uno gatea un botón/control puntual. Se
  // muestran en su propia sección al final de la matriz de roles.
  { id: 'pos_precio',    label: 'POS · Editar precio manual de línea',            group: 'Permisos especiales de botones', actions: ['editar'], special: true },
  { id: 'pos_vendedor',  label: 'POS · Cambiar vendedor asignado',                group: 'Permisos especiales de botones', actions: ['editar'], special: true },
  { id: 'pos_cobertura', label: 'POS · Editar cobertura BCV del documento',       group: 'Permisos especiales de botones', actions: ['editar'], special: true },
  { id: 'pos_tasa_paralelo', label: 'POS · Editar tasa paralelo del documento (mientras se arma)', group: 'Permisos especiales de botones', actions: ['editar'], special: true },
  { id: 'pos_seriales',  label: 'POS · Asignar / cambiar seriales (S/N)',         group: 'Permisos especiales de botones', actions: ['ver','editar'], special: true },
  { id: 'bank_movimiento', label: 'Banca · Registrar movimientos (movimiento / ajuste / traspaso)', group: 'Permisos especiales de botones', actions: ['crear'], special: true },
  // Un vendedor cobra la factura que él mismo emitió, pero no tiene por qué ver la cartera
  // completa de la empresa. Sin este permiso el botón "Registrar pago" del detalle de la factura
  // exigía `cxc.editar`, que abre TODO el módulo de Cuentas por Cobrar. Esto habilita solo el
  // cobro de esa factura, desde su detalle.
  { id: 'pos_cobro',     label: 'Facturas · Registrar el pago de una factura (sin acceso a CxC)', group: 'Permisos especiales de botones', actions: ['crear'], special: true },
  // Las tasas afectan el precio de TODA la operación, así que no puede tocarlas
  // cualquiera. Sin este permiso el modal se abre en solo lectura: el usuario ve
  // los valores que fijó el administrador pero no los puede cambiar.
  { id: 'tasas',         label: 'Tasas · Modificar BCV, paralelo, cobertura y vuelto', group: 'Permisos especiales de botones', actions: ['editar'], special: true },
  // Las columnas verdes del detalle son el costo que se le carga a un proveedor tercero, línea por
  // línea, y las escribe el vendedor. Estas son otra cosa: el costo que YA tiene el producto en el
  // catálogo y el margen real que sale de él, más la analítica de margen del documento completo. Es
  // el costo de la empresa, no un dato de esa venta, así que se gatea aparte.
  { id: 'pos_costo_producto', label: 'POS · Ver el costo del catálogo y el margen real del documento', group: 'Permisos especiales de botones', actions: ['ver'], special: true },
  // El SKU es la PK global del catálogo (documentos_items, inventario, movimientos_inventario,
  // órdenes de compra, transferencias… todos lo referencian por texto, no por FK). Cambiarlo es
  // renombrar esa clave: solo es seguro si el producto NUNCA se vendió y NUNCA tuvo un movimiento de
  // inventario, y aun así queda detrás de este permiso — es la ÚNICA vía para tocar un SKU ya
  // creado (el alta normal de producto sigue sin este gate, ver ROLES_MODULES.inventory).
  { id: 'producto_sku', label: 'Inventario · Editar el SKU de un producto (solo sin ventas ni movimientos)', group: 'Permisos especiales de botones', actions: ['editar'], special: true },
  // Pedido explícito (2026-08-14): un rol que sin este permiso solo vea SUS PROPIOS documentos
  // (donde es el vendedor o quien lo creó) en las 4 listas del flujo — no todos los de la empresa.
  // Sin él, `loadDocumentos` agrega `vendedor = mi nombre OR creado_por = mi nombre`. Con él, ve
  // todo (comportamiento de siempre). Ver migracion-odoo/73 — esa migración siembra este permiso
  // en TRUE para todos los roles existentes, para que nadie pierda alcance el día del deploy.
  { id: 'documentos_ver_todos', label: 'Documentos · Ver los de TODOS los usuarios (sin esto, solo los propios)', group: 'Permisos especiales de botones', actions: ['ver'], special: true },
];

const ACTION_LABELS = { ver: 'Ver', crear: 'Crear', editar: 'Editar', anular: 'Anular', cancelar: 'Cancelar', eliminar: 'Eliminar', administrar: 'Admin', declarar_listo: 'Declarar Listo' };
const ACTION_COLORS = { ver: '#2563eb', crear: '#059669', editar: '#d97706', anular: '#dc2626', cancelar: '#dc2626', eliminar: '#dc2626', administrar: '#7c3aed', declarar_listo: '#0d9488' };
// Claves MUERTAS: los roles y sus permisos viven en Supabase (tabla `roles`). Se borran una vez
// del navegador porque su contenido viejo era la fuente de los roles fantasma: la pantalla de
// permisos leía de acá cuando la base todavía no había respondido, y mostraba roles ya
// eliminados (Ventas Senior, Ventas, Compras, CxC/CxP, Almacen Valencia en `demo1`).
// No volver a leerlas ni escribirlas.
const ROLES_CONFIG_KEY = 'ss-roles-config';
const ROLES_LIST_KEY   = 'ss-roles-list';
try { localStorage.removeItem(ROLES_CONFIG_KEY); localStorage.removeItem(ROLES_LIST_KEY); } catch (e) {}

const DEFAULT_ROLES_LIST = [
  { nombre: 'Administrador',  descripcion: 'Acceso total al sistema',             color: '#2563eb', builtin: true },
  { nombre: 'Gerente de Operaciones', descripcion: 'Gestión completa sin configuración ni Dashboard', color: '#7c3aed', builtin: true },
  { nombre: 'Ventas Senior',  descripcion: 'Ventas con privilegios ampliados',     color: '#059669', builtin: true },
  { nombre: 'Ventas',         descripcion: 'Punto de venta básico',                color: '#0369a1', builtin: true },
  { nombre: 'Contadora',      descripcion: 'Finanzas, CxC, CxP y banca',          color: '#b45309', builtin: true },
  { nombre: 'Compras',        descripcion: 'Inventario y proveedores',             color: '#0f766e', builtin: true },
  { nombre: 'CxC / CxP',     descripcion: 'Cuentas por cobrar y pagar',           color: '#7c3aed', builtin: true },
  { nombre: 'Almacen Central',descripcion: 'Almacén central Caracas',             color: '#6d28d9', builtin: true },
  { nombre: 'Almacen Valencia',descripcion: 'Almacén Valencia',                   color: '#6d28d9', builtin: true },
  { nombre: 'Driver',         descripcion: 'Conductor — acceso solo al portal de drivers', color: '#0891b2', builtin: true },
  { nombre: 'Cliente',        descripcion: 'Contacto de cliente — acceso solo al portal de clientes', color: '#a855f7', builtin: true },
  { nombre: 'Vendedor',      descripcion: 'Vendedor — acceso equivalente a Ventas', color: '#0369a1', builtin: true },
];

function buildAllTrue() {
  const p = {};
  ROLES_MODULES.forEach(m => { p[m.id] = Object.fromEntries(m.actions.map(a => [a, true])); });
  return p;
}

function mkPerms(spec) {
  const result = {};
  ROLES_MODULES.forEach(m => {
    const s = spec[m.id];
    if (!s) {
      result[m.id] = Object.fromEntries(m.actions.map(a => [a, false]));
    } else {
      result[m.id] = Object.fromEntries(m.actions.map(a => [a, s[a] === true]));
    }
  });
  return result;
}

function buildDefaultPerms() {
  const all = buildAllTrue();
  return {
    'Administrador': all,
    'Gerente de Operaciones': mkPerms({
      pos:           { ver:true, crear:true, editar:true, anular:true, cancelar:true, eliminar:true },
      pos_precio:    { editar:true },
      pos_vendedor:  { editar:true },
      pos_cobertura: { editar:true },
      pos_seriales: { ver:true, editar:true },
      tasas:         { editar:true },
      // El gerente mira márgenes: es justamente para quien se hizo la analítica del documento.
      pos_costo_producto: { ver:true },
      // Un gerente ve la cartera completa de la empresa, no solo lo suyo.
      documentos_ver_todos: { ver:true },
      inventory:    { ver:true, crear:true, editar:true, eliminar:false },
      prices:       { ver:true, crear:true, editar:true, eliminar:false },
      bulk:         { ver:true, crear:true },
      dropshipping: { ver:true },
      sync:         { ver:true },
      clients:      { ver:true, crear:true, editar:true, eliminar:false },
      contacts:     { ver:true, crear:true, editar:true, eliminar:false },
      suppliers:    { ver:true, crear:true, editar:true, eliminar:false },
      vendedores:   { ver:true, crear:true, editar:true, eliminar:false },
      cxc:          { ver:true, editar:true, anular:false, eliminar:false },
      cxp:          { ver:true, editar:true, anular:false, eliminar:false },
      bank:         { ver:true, editar:true },
      bank_movimiento: { crear:true },
      finanzas_reportes: { ver:true },
      reportes:     { ver:true, crear:true },
      comisiones:   { ver:true },
      drivers:      { ver:true, crear:true, editar:true, eliminar:false },
      incidencias:  { ver:true, crear:true, editar:true, eliminar:false },
      devoluciones: { ver:true, crear:true, editar:true, eliminar:false },
      garantias:    { ver:true, crear:true, editar:true, eliminar:false },
      chat:         { ver:true, crear:true },
      config_usuarios:  { ver:false, administrar:false },
      config_roles:     { ver:false, administrar:false },
      config_sistema:   { ver:false, editar:false, administrar:false },
      config_campos:    { ver:false, editar:false },
      config_almacenes: { ver:false, editar:false, administrar:false },
      papelera:         { ver:false, administrar:false },
    }),
    'Ventas Senior': mkPerms({
      pos:          { ver:true, crear:true, editar:true, anular:false, cancelar:true, eliminar:false },
      pos_vendedor: { editar:true },
      pos_seriales: { ver:true, editar:true },
      inventory:    { ver:true, crear:false, editar:false, eliminar:false },
      prices:       { ver:true, crear:false, editar:false, eliminar:false },
      clients:      { ver:true, crear:true, editar:true, eliminar:false },
      contacts:     { ver:true, crear:true, editar:true, eliminar:false },
      vendedores:   { ver:true, crear:false, editar:false, eliminar:false },
      cxc:          { ver:true, editar:false, anular:false },
      reportes:     { ver:true, crear:true },
      comisiones:   { ver:true },
      chat:         { ver:true, crear:true },
    }),
    'Ventas': mkPerms({
      pos:        { ver:true, crear:true, editar:false, anular:false, cancelar:true, eliminar:false },
      pos_seriales: { ver:true, editar:false },
      inventory:  { ver:true, crear:false, editar:false, eliminar:false },
      prices:     { ver:true, crear:false, editar:false, eliminar:false },
      clients:    { ver:true, crear:true, editar:false, eliminar:false },
      contacts:   { ver:true, crear:false, editar:false, eliminar:false },
      reportes:   { ver:true, crear:false },
      chat:       { ver:true, crear:true },
    }),
    'Vendedor': mkPerms({
      pos:          { ver:true, crear:true, editar:false, anular:false, cancelar:true, eliminar:false },
      pos_seriales: { ver:true, editar:false },
      inventory:    { ver:true, crear:false, editar:false, eliminar:false },
      prices:       { ver:true, crear:false, editar:false, eliminar:false },
      clients:      { ver:true, crear:true, editar:false, eliminar:false },
      contacts:     { ver:true, crear:false, editar:false, eliminar:false },
      devoluciones: { ver:true, crear:false, editar:false, eliminar:false },
      reportes:     { ver:true, crear:false },
      comisiones:   { ver:true },
      chat:         { ver:true, crear:true },
    }),
    'Contadora': mkPerms({
      pos:        { ver:true, crear:false, editar:false, anular:true, eliminar:false },
      inventory:  { ver:true, crear:false, editar:false, eliminar:false },
      prices:     { ver:true, crear:false, editar:false, eliminar:false },
      clients:    { ver:true, crear:false, editar:false, eliminar:false },
      suppliers:  { ver:true, crear:false, editar:false, eliminar:false },
      cxc:        { ver:true, editar:true, anular:true, eliminar:true },
      cxp:        { ver:true, editar:true, anular:true, eliminar:true },
      bank:       { ver:true, editar:true },
      bank_movimiento: { crear:true },
      finanzas_reportes: { ver:true },
      reportes:   { ver:true, crear:true },
      comisiones: { ver:true },
      chat:       { ver:true, crear:true },
    }),
    'Compras': mkPerms({
      pos:          { ver:true, crear:false, editar:false, anular:false, eliminar:false },
      inventory:    { ver:true, crear:true, editar:true, eliminar:false },
      prices:       { ver:true, crear:false, editar:false, eliminar:false },
      bulk:         { ver:true, crear:true },
      dropshipping: { ver:true },
      suppliers:    { ver:true, crear:true, editar:true, eliminar:false },
      cxp:          { ver:true, editar:false, anular:false },
      chat:         { ver:true, crear:true },
    }),
    'CxC / CxP': mkPerms({
      pos:        { ver:true, crear:false, editar:false, anular:false, eliminar:false },
      clients:    { ver:true, crear:false, editar:false, eliminar:false },
      suppliers:  { ver:true, crear:false, editar:false, eliminar:false },
      cxc:        { ver:true, editar:true, anular:false, eliminar:false },
      cxp:        { ver:true, editar:true, anular:false, eliminar:false },
      bank:       { ver:true, editar:false },
      reportes:   { ver:true, crear:false },
      chat:       { ver:true, crear:true },
    }),
    'Almacen Central': mkPerms({
      pos:          { ver:true, crear:false, editar:true, anular:false, eliminar:false },
      pos_seriales: { ver:true, editar:true },
      inventory:    { ver:true, crear:false, editar:true, eliminar:false },
      prices:       { ver:true, crear:false, editar:false, eliminar:false },
      clients:      { ver:true, crear:false, editar:false, eliminar:false },
      drivers:      { ver:true, crear:false, editar:false, eliminar:false },
      incidencias:  { ver:true, crear:true, editar:false, eliminar:false },
      devoluciones: { ver:true, crear:false, editar:false, eliminar:false },
      chat:         { ver:true, crear:true },
    }),
    'Almacen Valencia': mkPerms({
      pos:          { ver:true, crear:false, editar:true, anular:false, eliminar:false },
      pos_seriales: { ver:true, editar:true },
      inventory:    { ver:true, crear:false, editar:true, eliminar:false },
      prices:       { ver:true, crear:false, editar:false, eliminar:false },
      clients:      { ver:true, crear:false, editar:false, eliminar:false },
      drivers:      { ver:true, crear:false, editar:false, eliminar:false },
      incidencias:  { ver:true, crear:true, editar:false, eliminar:false },
      devoluciones: { ver:true, crear:false, editar:false, eliminar:false },
      chat:         { ver:true, crear:true },
    }),
    'Driver': mkPerms({
      // Driver only has the mobile portal (rendered before ERP modules).
      // No access to any ERP module.
    }),
    'Cliente': mkPerms({
      // Cliente only has the client portal (rendered before ERP modules).
      // No access to any ERP module.
    }),
  };
}

// ¿Ya están los roles de la BASE en memoria? La tabla `roles` viaja en Fase 2, así que hay
// una ventana al arrancar en la que todavía no llegaron. Distinguir "no llegaron" de "no hay"
// es lo que evita mostrar y —peor— editar una lista que no es la real.
window.rolesCargados = function() {
  return Array.isArray(window.SSData?.roles) && window.SSData.roles.length > 0;
};

// SUPABASE ES LA ÚNICA FUENTE DE VERDAD de los roles.
//
// Antes, si `SSData.roles` no había llegado, esto caía a `localStorage['ss-roles-list']` y de
// ahí a la lista por defecto. Resultado: los 5 roles que se habían BORRADO en la base
// (Ventas Senior, Ventas, Compras, CxC/CxP, Almacen Valencia) seguían apareciendo en pantalla
// después de recargar, porque venían de una copia vieja del navegador. Y como esas entradas no
// tienen `id`, guardar sus permisos no escribía en la base (ver handleSave): el usuario veía
// "guardado" y no se persistía nada.
//
// Ahora el fallback existe solo para PINTAR algo mientras Fase 2 llega, y quien edita tiene que
// preguntar por `window.rolesCargados()` antes de dejar tocar nada.
window.getRolesList = function() {
  if (window.rolesCargados()) {
    return window.SSData.roles.map(r => ({ id: r.id, nombre: r.nombre, descripcion: r.descripcion, color: r.color, builtin: r.builtin }));
  }
  return DEFAULT_ROLES_LIST.map(r => ({ ...r }));
};

window.getRolesConfig = function() {
  const defaults = buildDefaultPerms();
  if (window.rolesCargados()) {
    // SOLO los roles que existen en la base. Antes se partía de `{...defaults}`, así que un rol
    // borrado conservaba sus permisos por defecto: si un usuario quedaba con ese nombre de rol,
    // `getRolePerms` le devolvía los permisos del rol eliminado en vez de negarle todo.
    const config = {};
    window.SSData.roles.forEach(r => {
      const enDB = r.permisos && Object.keys(r.permisos).length > 0;
      // Un rol de la base SIN permisos guardados arranca con los del mismo nombre por defecto
      // (semilla razonable); si no hay default para ese nombre, arranca en todo false.
      config[r.nombre] = enDB ? mkPerms(r.permisos) : (defaults[r.nombre] || mkPerms({}));
    });
    // Administrador siempre con acceso total, sin importar lo que diga la base.
    config['Administrador'] = defaults['Administrador'];
    return config;
  }
  return defaults;
};

// Compara dos árboles de permisos SIN mirar el orden de las claves. Postgres `jsonb` no
// conserva el orden en que se enviaron (las guarda por longitud y después alfabéticamente), así
// que un `JSON.stringify` de ida y vuelta nunca coincide: la verificación de guardado avisaba
// "la base no guardó los permisos" en cada cambio, cuando sí se habían guardado.
function mismosPermisos(a, b) {
  const canon = (v) => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') {
      return Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {});
    }
    return v;
  };
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

window.getRolePerms = function(roleName) {
  if (isAdminRole(roleName)) return buildAllTrue();
  if (!roleName) return mkPerms({}); // sin rol → denegar todo (nunca god mode)
  const config = window.getRolesConfig();
  // Rol desconocido/huérfano (eliminado, renombrado, typo) → SIN permisos (default-deny),
  // nunca acceso total. Antes caía a buildAllTrue() = god mode silencioso.
  return config[roleName] || mkPerms({});
};

// Catálogo de módulos y acciones de permisos. Se expone para no duplicarlo en otros módulos
// ni en las pruebas (una copia desincronizada sería peor que no tenerla).
window.ROLES_MODULES = ROLES_MODULES;

// Anular/cancelar documentos del flujo (cotización/orden/factura/despacho) fueron, hasta el
// 2026-08-13, una restricción NOMINAL por ID de usuario (instrucción del 2026-08-04: solo Jorge
// Meneses podía "eliminar"; Jorge + Andrea Turmero podían "cancelar") — independiente de la matriz
// de roles. Se retiró esa restricción a propósito: ahora que anular/cancelar NUNCA borran la fila
// (quedan en su propia pestaña, con motivo y autor registrados — ver `window.anularDocumento`/
// `cancelarDocumento`) y que cada etapa tiene su PROPIO módulo de permisos (`cotizacion`, `orden`,
// `factura`, `despacho`), el riesgo que motivó la lista nominal —"borrar un documento no es quitar
// una fila, arrastra linaje, inventario y CxC"— ya no aplica: nada se borra. Manda la matriz de
// roles, como cualquier otro permiso.
window.canUser = function(action, moduleId) {
  const role = window.currentUserRole;
  if (isAdminRole(role)) return true;
  if (!role) return false;  // rol vacío/undefined → denegar (antes: god mode, persistente si usuarios.rol es null)
  const perms = window.getRolePerms(role);
  const mp = perms[moduleId];
  if (!mp) return false;            // módulo no reconocido → denegar (antes: permitir)
  if (!(action in mp)) return false; // acción no reconocida → denegar (antes: permitir)
  return mp[action] === true;
};

window.ConfigRolesPage = function ConfigRolesPage() {
  // Lista de roles + matriz de permisos son un panel dividido lado a lado (ancho fijo + flex:1).
  // Sin esto, en móvil las dos columnas se comprimían una al lado de la otra en vez de apilarse —
  // ninguna de las dos entraba, y el texto quedaba cortado ("Gerente de Operacion...").
  const [isMobile, setIsMobile] = uState(() => window.innerWidth <= 768);
  uEffect(() => {
    function onResize() { setIsMobile(window.innerWidth <= 768); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const [rolesList, setRolesList] = uState(() => window.getRolesList());
  const [rolesConfig, setRolesConfig] = uState(() => window.getRolesConfig());
  const [selRole, setSelRole] = uState(() => window.getRolesList()[0]?.nombre || 'Administrador');

  // Los roles viajan en Fase 2. Este efecto corría UNA sola vez al montar, así que si la
  // pantalla se abría antes de que llegaran, se quedaba para siempre con la lista de relleno
  // (de ahí los roles borrados que reaparecían al recargar). Ahora se re-sincroniza cuando la
  // data aterriza, y `desdeDB` marca si lo que se está viendo es lo real.
  const [desdeDB, setDesdeDB] = uState(() => window.rolesCargados());
  uEffect(() => {
    const sync = () => {
      const list = window.getRolesList();
      setRolesList(list);
      setRolesConfig(window.getRolesConfig());
      setSelRole(prev => list.find(r => r.nombre === prev) ? prev : (list[0]?.nombre || 'Administrador'));
      setDesdeDB(window.rolesCargados());
    };
    sync();   // los roles llegan en Fase 2: la primera pasada puede no tenerlos todavía
    return window.ssOnDatos(sync);
  }, []);
  const [dirty, setDirty] = uState(false);
  const [saved, setSaved] = uState(false);
  const [showActivity, setShowActivity] = uState(false);
  const [showNew, setShowNew] = uState(false);
  const [newName, setNewName] = uState('');
  const [newDesc, setNewDesc] = uState('');
  const [newColor, setNewColor] = uState('#0369a1');
  const [confirmDelete, setConfirmDelete] = uState(null);
  // ── Los roles son POR EMPRESA (tabla `roles`, columna `empresa_id`) ───────────────────────────
  // Un rol creado en una empresa NO existe en la otra, y `getRolesConfig()` no lo encuentra: el
  // usuario con ese rol entra a la otra empresa y `canUser` le niega TODO (comportamiento correcto
  // y documentado: un rol sin config no hereda nada). Le pasó a Andrea Turmero — rol custom creado
  // solo en demo1, con las dos empresas habilitadas: en demo2 no veía ni Bancos. Se resolvió
  // a mano clonando el rol, pero el agujero quedaba abierto; acá se cierra.
  const empresasUsuario = (window.__ssCurrentUser?.empresas || []).filter(Boolean);
  const empActualRol = window.currentEmpresa || 'demo1';
  const [replicar, setReplicar] = uState(true);   // crear el rol nuevo en TODAS las empresas del usuario
  const [clonando, setClonando] = uState(false);
  // Empresas del usuario donde este rol NO existe: quien lo tenga queda sin permisos allá.
  const faltaEn = empresasUsuario.filter(emp =>
    emp !== empActualRol &&
    !(window.SSData?.roles || []).some(r => r.nombre === selRole && r.empresa_id === emp));

  const grupos = [...new Set(ROLES_MODULES.map(m => m.group))];
  const selPerms = rolesConfig[selRole] || {};
  const isAdmin = isAdminRole(selRole);
  // Permiso del USUARIO ACTUAL para administrar roles (independiente de isAdmin,
  // que describe si el ROL VISUALIZADO es Administrador y por lo tanto no editable).
  // Sin los roles de la BASE no se deja editar: se estaría tocando la lista de relleno, y
  // guardar eso no persistiría nada. Es un instante al abrir la pantalla.
  const canEditRoles = (window.canUser?.('administrar','config_roles') !== false) && desdeDB;

  function togglePerm(moduleId, action) {
    const cur = selPerms[moduleId]?.[action] || false;
    setRolesConfig(prev => ({
      ...prev,
      [selRole]: {
        ...(prev[selRole] || {}),
        [moduleId]: { ...(prev[selRole]?.[moduleId] || {}), [action]: !cur },
      },
    }));
    setDirty(true);
    setSaved(false);
  }

  async function handleSave() {
    // El id se resuelve contra la BASE (SSData.roles), no contra la lista en pantalla: la de
    // relleno no tiene id. Antes, sin id, esto se guardaba en localStorage y decía "guardado" —
    // el permiso no llegaba nunca a Supabase y desaparecía al recargar. Los permisos no pueden
    // fallar en silencio: si no se puede escribir, hay que decirlo.
    const enDB = (window.SSData?.roles || []).find(r => r.nombre === selRole);
    if (!enDB?.id) {
      alert('No se pudo guardar: el rol "' + selRole + '" no está en la base de datos.\n\n' +
            'Recargá la página; si sigue apareciendo, es un rol viejo que quedó en este navegador y ya no existe.');
      return;
    }
    const perms = rolesConfig[selRole];
    const { error } = await window.sb.from('roles').update({ permisos: perms }).eq('id', enDB.id);
    if (error) { alert('Error al guardar permisos: ' + error.message); return; }

    // Se vuelve a LEER para confirmar que quedó escrito. Un permiso que se cree guardado y no
    // lo esté es peor que un error visible: RLS o un id equivocado fallarían sin ruido.
    const { data: verif, error: eVerif } = await window.sb.from('roles')
      .select('permisos').eq('id', enDB.id).maybeSingle();
    if (eVerif || !verif) {
      alert('Se guardó, pero no se pudo confirmar la escritura. Recargá y verificá los permisos del rol.');
    } else if (!mismosPermisos(verif.permisos, perms)) {
      alert('La base no guardó los permisos como se enviaron (¿permisos insuficientes?). Revisa el rol antes de confiar en el cambio.');
      return;
    }
    enDB.permisos = perms;   // SSData al día sin recargar

    setDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    window.logActivity?.({ modulo:'roles', accion:'editar', entidad_label:selRole, detalles:{ permisos: perms } });
  }

  async function handleCreateRole() {
    if (!newName.trim()) return;
    const emptyPerms = Object.fromEntries(ROLES_MODULES.map(m => [m.id, Object.fromEntries(m.actions.map(a => [a, false]))]));
    const newId = 'rol-' + (window.currentEmpresa || 'demo1') + '-custom-' + Date.now();
    const newRoleRow = {
      id:          newId,
      empresa_id:  window.currentEmpresa || 'demo1',
      nombre:      newName.trim(),
      descripcion: newDesc.trim(),
      color:       newColor,
      builtin:     false,
      permisos:    emptyPerms,
    };
    // Se crea en la empresa activa y, si se pidió replicar, en TODAS las demás del usuario: un rol
    // que vive en una sola empresa deja sin acceso a quien lo tenga en las otras.
    const empresasDestino = (replicar && empresasUsuario.length > 1)
      ? [...new Set([newRoleRow.empresa_id, ...empresasUsuario])]
      : [newRoleRow.empresa_id];
    const filas = empresasDestino.map(emp => emp === newRoleRow.empresa_id
      ? newRoleRow
      : { ...newRoleRow, id: 'rol-' + emp + '-custom-' + Date.now() + '-' + emp, empresa_id: emp });
    const { error } = await window.sb.from('roles').insert(filas);
    if (error) { alert('Error al crear rol: ' + error.message); return; }
    if (!window.SSData.roles) window.SSData.roles = [];
    // En memoria solo entra el de la empresa ACTIVA: SSData.roles es lo que devuelve la RLS de esta
    // empresa, y meter los de la otra haría que la lista mostrara el mismo rol dos veces.
    window.SSData.roles.push(newRoleRow);
    const entry = { id: newId, nombre: newName.trim(), descripcion: newDesc.trim(), color: newColor, builtin: false };
    const updatedList = [...rolesList, entry];
    const updatedConfig = { ...rolesConfig, [newName.trim()]: emptyPerms };
    setRolesList(updatedList);
    setRolesConfig(updatedConfig);
    setSelRole(newName.trim());
    window.logActivity?.({ modulo:'roles', accion:'crear', entidad_label:newName.trim(), detalles:{ descripcion:newDesc.trim(), color:newColor } });
    setShowNew(false);
    setNewName(''); setNewDesc('');
    if (filas.length > 1) {
      alert('Rol creado en ' + filas.length + ' empresas: ' + empresasDestino.join(', ') + '.' + String.fromCharCode(10, 10) +
            'Los permisos se configuran por empresa: lo que marques acá vale para ' + empActualRol +
            ', y se copian a las otras con el boton que aparece arriba de la tabla.');
    }
  }

  // Copiar los permisos del rol que se está viendo a las OTRAS empresas del usuario, creándolo allá
  // si no existe. Es lo que cierra el caso de Andrea sin tener que tocar la base a mano.
  async function clonarRolAEmpresas() {
    const perms = rolesConfig[selRole];
    if (!perms) return;
    const base = (window.SSData?.roles || []).find(r => r.nombre === selRole);
    setClonando(true);
    const errores = [];
    for (const emp of empresasUsuario) {
      if (emp === empActualRol) continue;
      const existente = (window.SSData?.roles || []).find(r => r.nombre === selRole && r.empresa_id === emp);
      const fila = {
        id:          existente?.id || ('rol-' + emp + '-custom-' + Date.now() + '-' + emp),
        empresa_id:  emp,
        nombre:      selRole,
        descripcion: base?.descripcion || '',
        color:       base?.color || '#0369a1',
        builtin:     false,
        permisos:    perms,
      };
      // upsert por id: sirve para crearlo allá y también para pisar el que ya exista con permisos
      // distintos — que es el otro medio-caso real (el rol existe pero con el jsonb vacío).
      const { error } = await window.sb.from('roles').upsert(fila, { onConflict: 'id' });
      if (error) errores.push(emp + ': ' + error.message);
    }
    setClonando(false);
    if (errores.length) { alert('No se pudo copiar a todas las empresas:' + String.fromCharCode(10) + errores.join(String.fromCharCode(10))); return; }
    alert('Permisos de ' + selRole + ' copiados a: ' + empresasUsuario.filter(e => e !== empActualRol).join(', ') + '.' + String.fromCharCode(10, 10) +
          'Quien tenga este rol tiene que CERRAR SESIÓN y volver a entrar para que le tomen.');
    window.logActivity?.({ modulo: 'roles', accion: 'editar', entidad_label: selRole,
      detalles: { accion: 'copiar_a_empresas', empresas: empresasUsuario } });
  }

  async function handleDeleteRole(nombre) {
    // Bloquear borrado si el rol está EN USO por usuarios: borrarlo dejaría usuarios huérfanos
    // con un rol no reconocido (riesgo histórico de escalada a god mode). Se cuenta contra DB
    // (head:true → el conteo viene en `count`, no en `data`).
    const { count, error: usoErr } = await window.sb
      .from('usuarios')
      .select('id', { count: 'exact', head: true })
      .eq('rol', nombre);
    if (usoErr) { alert('No se pudo verificar el uso del rol: ' + usoErr.message); return; }
    if (count && count > 0) {
      alert('No se puede eliminar el rol "' + nombre + '": está asignado a ' + count + ' usuario(s). Reasigná esos usuarios a otro rol antes de eliminarlo.');
      setConfirmDelete(null);
      return;
    }
    // Igual que al guardar: el id se resuelve contra la BASE. Antes, un rol de la lista de
    // relleno (sin id) se "borraba" solo de la pantalla y volvía al recargar.
    const role = (window.SSData?.roles || []).find(r => r.nombre === nombre)
              || rolesList.find(r => r.nombre === nombre);
    if (!role?.id) {
      alert('No se pudo eliminar: el rol "' + nombre + '" no está en la base de datos.\n\n' +
            'Recargá la página — probablemente sea un rol viejo que quedó en este navegador.');
      setConfirmDelete(null);
      return;
    }
    {
      const { error } = await window.sb.from('roles').delete().eq('id', role.id);
      if (error) { alert('Error al eliminar rol: ' + error.message); return; }
      if (window.SSData?.roles) window.SSData.roles = window.SSData.roles.filter(r => r.nombre !== nombre);
    }
    // A papelera SOLO tras confirmar el borrado (evita entrada fantasma si el delete falla).
    if (role) window.ssTrash?.add('rol', nombre, { ...role, _config: rolesConfig[nombre] });
    const updatedList = rolesList.filter(r => r.nombre !== nombre);
    const updatedConfig = { ...rolesConfig };
    delete updatedConfig[nombre];
    setRolesList(updatedList);
    setRolesConfig(updatedConfig);
    if (selRole === nombre) setSelRole(updatedList[0]?.nombre || 'Administrador');
    setConfirmDelete(null);
    window.logActivity?.({ modulo:'roles', accion:'eliminar', entidad_label:nombre });
  }

  const roleInfo = rolesList.find(r => r.nombre === selRole);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Roles y Permisos</h1>
          <div className="page-subtitle">
            {rolesList.length} roles · Define qué puede hacer cada rol en cada módulo
            {!desdeDB && (
              // Se dice explícitamente: lo que se ve no salió de la base todavía. Editar acá no
              // persistiría, y era justo lo que pasaba antes sin avisar.
              <span className="chip amber" style={{marginLeft:8}}>
                <Icon name="alert" size={11}/> Cargando roles de la base…
              </span>
            )}
          </div>
        </div>
        <div className="page-actions">
          {dirty && window.canUser?.('administrar','config_roles') !== false && (
            <button className="btn primary" onClick={handleSave}>
              <Icon name="check" size={14}/>{saved ? 'Guardado ✓' : 'Guardar cambios'}
            </button>
          )}
          {!dirty && saved && <span className="chip green" style={{padding:'6px 12px'}}>✓ Guardado</span>}
          {window.canUser?.('administrar','config_roles') !== false && (
            <button className="btn secondary" onClick={() => setShowNew(true)}>
              <Icon name="plus" size={14}/>Nuevo rol
            </button>
          )}
          <button className="btn ghost" onClick={() => setShowActivity(true)} title="Ver registro de actividad"><Icon name="receipt" size={14}/>Actividad</button>
        </div>
      </div>

      {showActivity && <ActivityLogModal modulo="roles" onClose={()=>setShowActivity(false)}/>}

      <div style={{ display:'flex', flexDirection: isMobile ? 'column' : 'row', gap:16, alignItems: isMobile ? 'stretch' : 'flex-start' }}>
        {/* Left panel: roles list */}
        <div style={{ width: isMobile ? '100%' : 220, flexShrink:0 }}>
          <div className="card" style={{ padding:4 }}>
            {rolesList.map(r => {
              const active = selRole === r.nombre;
              return (
                <div
                  key={r.nombre}
                  onClick={() => setSelRole(r.nombre)}
                  style={{ padding:'10px 12px', borderRadius:6, cursor:'pointer', background: active ? 'var(--brand-soft)' : 'transparent', display:'flex', alignItems:'center', gap:8, marginBottom:1 }}
                >
                  <span style={{ width:8, height:8, borderRadius:'50%', background: r.color, flexShrink:0, display:'inline-block' }}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12.5, fontWeight: active ? 600 : 500, color: active ? 'var(--brand)' : 'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.nombre}</div>
                    <div style={{ fontSize:10.5, color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.descripcion}</div>
                  </div>
                  {!isAdminRole(r.nombre) && window.canUser?.('administrar','config_roles') !== false && (
                    <button className="icon-btn" style={{ width:18, height:18, opacity:0.45, flexShrink:0, color:'var(--danger)' }} onClick={e => { e.stopPropagation(); setConfirmDelete(r); }} title="Eliminar rol">
                      <Icon name="trash" size={11}/>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right panel: permission matrix */}
        <div style={{ flex:1, minWidth:0 }}>
          <div className="card">
            <div className="card-header" style={{ borderBottom:'1px solid var(--border)', paddingBottom:12 }}>
              <div style={{ width:36, height:36, borderRadius:8, background: (roleInfo?.color || 'var(--brand)') + '20', display:'grid', placeItems:'center', flexShrink:0 }}>
                <Icon name="shield" size={18} style={{ color: roleInfo?.color || 'var(--brand)' }}/>
              </div>
              <div style={{ flex:1 }}>
                <div className="card-title">{selRole}</div>
                <div className="card-sub">
                  {isAdmin ? 'Acceso total al sistema — permisos no editables' : (roleInfo?.descripcion || '')}
                </div>
              </div>
              {dirty && !isAdmin && canEditRoles && (
                <button className="btn primary sm" onClick={handleSave}>
                  <Icon name="check" size={13}/>{saved ? 'Guardado' : 'Guardar'}
                </button>
              )}
            </div>

            {/* Un rol que existe en una empresa y no en la otra deja sin NINGÚN permiso a quien lo
                tenga allá. No es hipotético: pasó con Andrea Turmero. Se avisa donde se ve el rol
                y se resuelve con un botón, sin tener que tocar la base. */}
            {!isAdmin && canEditRoles && empresasUsuario.length > 1 && (
              <div style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)',
                            background: faltaEn.length ? 'var(--warn-soft, #fef3c7)' : 'var(--bg-sunken)',
                            display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                <Icon name={faltaEn.length ? 'alert' : 'shield'} size={14}
                      style={{ color: faltaEn.length ? 'var(--warn)' : 'var(--text-muted)', flexShrink:0 }}/>
                <div style={{ flex:1, minWidth:180, fontSize:12 }}>
                  {faltaEn.length
                    ? <>Este rol <strong>no existe en {faltaEn.join(', ')}</strong>. Quien lo tenga no va a
                        poder ver nada al cambiar de empresa.</>
                    : <>Los permisos son por empresa: estos valen para <strong>{empActualRol}</strong>.</>}
                </div>
                <button className="btn sm secondary" disabled={clonando} onClick={clonarRolAEmpresas}>
                  <Icon name="copy" size={13}/>
                  {clonando ? 'Copiando…' : (faltaEn.length ? 'Crear en las otras empresas' : 'Copiar permisos a las otras empresas')}
                </button>
              </div>
            )}

            {/* Legend */}
            <div style={{ padding:'10px 16px', display:'flex', gap:12, flexWrap:'wrap', borderBottom:'1px solid var(--border)', background:'var(--bg-sunken)' }}>
              {Object.entries(ACTION_LABELS).map(([id, label]) => (
                <div key={id} style={{ display:'flex', alignItems:'center', gap:5, fontSize:11.5 }}>
                  <span style={{ width:9, height:9, borderRadius:2, background: ACTION_COLORS[id] + '30', border:'1.5px solid '+ ACTION_COLORS[id], display:'inline-block' }}/>
                  <span style={{ color: ACTION_COLORS[id], fontWeight:600 }}>{label}</span>
                </div>
              ))}
            </div>

            {/* Matrix */}
            {grupos.map(grupo => {
              const mods = ROLES_MODULES.filter(m => m.group === grupo);
              const esEspecial = mods.some(m => m.special);
              return (
                <div key={grupo}>
                  <div style={{ padding:'8px 16px 4px', fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color: esEspecial ? 'var(--brand)' : 'var(--text-muted)', background:'var(--bg-sunken)', borderBottom:'1px solid var(--border)', borderTop: esEspecial ? '2px solid var(--brand)' : 'none' }}>
                    {esEspecial && <span style={{ marginRight:5, verticalAlign:'-1px', display:'inline-flex' }}><Icon name="shield" size={11}/></span>}
                    {grupo}
                    {esEspecial && <div style={{ fontSize:10, fontWeight:500, textTransform:'none', letterSpacing:0, color:'var(--text-muted)', marginTop:2 }}>Permisos puntuales que habilitan un botón/acción específica (no ocultan el módulo). El botón queda visible pero, sin el permiso, avisa que no está autorizado.</div>}
                  </div>
                  {mods.map((mod, mi) => {
                    const mp = isAdmin ? Object.fromEntries(mod.actions.map(a => [a, true])) : (selPerms[mod.id] || {});
                    return (
                      <div
                        key={mod.id}
                        style={{ display:'flex', alignItems:'center', padding:'10px 16px', borderBottom: mi < mods.length - 1 ? '1px solid var(--border)' : 'none', gap:12 }}
                      >
                        <div style={{ width:170, fontSize:13, fontWeight:500, color:'var(--text)' }}>{mod.label}</div>
                        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                          {mod.actions.map(action => {
                            const on = mp[action] === true;
                            const color = ACTION_COLORS[action];
                            // Borrar y cancelar documentos del flujo NO se resuelven por rol: son
                            // listas de personas (ver canUser). Dejar la casilla como cualquier
                            // otra haría creer que marcarla concede el permiso, y no concede nada.
                            const nominal = mod.id === 'pos' && (action === 'eliminar' || action === 'cancelar');
                            const quien = action === 'eliminar'
                              ? 'Solo Jorge Meneses. No se concede desde acá.'
                              : 'Solo Jorge Meneses, Andrea Turmero y Pedro. No se concede desde acá.';
                            return (
                              <button
                                key={action}
                                title={nominal ? quien : undefined}
                                disabled={nominal || isAdmin || !canEditRoles}
                                onClick={() => { if (!nominal) togglePerm(mod.id, action); }}
                                style={{
                                  display:'flex', alignItems:'center', gap:4, padding:'4px 10px',
                                  borderRadius:6, border:'1.5px solid ' + (on ? color : 'var(--border)'),
                                  background: on ? color + '18' : 'var(--bg-sunken)',
                                  color: on ? color : 'var(--text-muted)',
                                  fontSize:12, fontWeight: on ? 600 : 400,
                                  cursor: (nominal || isAdmin || !canEditRoles) ? 'default' : 'pointer',
                                  opacity: nominal ? 0.45 : ((isAdmin || !canEditRoles) && !on ? 0.4 : 1),
                                  transition:'all .12s',
                                }}
                              >
                                {nominal
                                  ? <Icon name="shield" size={11}/>
                                  : on
                                    ? <Icon name="check" size={11}/>
                                    : <span style={{ width:11, height:11, borderRadius:2, border:'1.5px solid var(--border-strong)', display:'inline-block' }}/>
                                }
                                {ACTION_LABELS[action]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* New role modal */}
      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" style={{ maxWidth:440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Nuevo rol</h3>
              <button className="icon-btn" onClick={() => setShowNew(false)}><Icon name="x" size={16}/></button>
            </div>
            <div className="modal-body">
              <div>
                <label className="form-label">Nombre del rol <span style={{ color:'var(--danger)' }}>*</span></label>
                <input className="input" style={{ width:'100%' }} placeholder="Ej: Supervisor de Ventas" value={newName} onChange={e => setNewName(e.target.value)} autoFocus/>
              </div>
              <div className="mt-3">
                <label className="form-label">Descripción</label>
                <input className="input" style={{ width:'100%' }} placeholder="Breve descripción" value={newDesc} onChange={e => setNewDesc(e.target.value)}/>
              </div>
              <div className="mt-3">
                <label className="form-label">Color</label>
                <div style={{ display:'flex', gap:8 }}>
                  {['#2563eb','#7c3aed','#059669','#d97706','#dc2626','#0f766e','#0369a1','#6d28d9'].map(c => (
                    <button key={c} onClick={() => setNewColor(c)} style={{ width:28, height:28, borderRadius:'50%', background:c, border: newColor === c ? '3px solid var(--brand)' : '2px solid transparent', cursor:'pointer' }}/>
                  ))}
                </div>
              </div>
              {/* Los roles viven por empresa. Crear uno en una sola deja a quien lo tenga sin
                  acceso en las demás — el caso de Andrea. Por eso viene marcado por defecto. */}
              {empresasUsuario.length > 1 && (
                <div className="mt-3">
                  <label style={{ display:'flex', alignItems:'flex-start', gap:8, fontSize:12.5, cursor:'pointer' }}>
                    <input type="checkbox" checked={replicar} onChange={e => setReplicar(e.target.checked)} style={{ marginTop:2 }}/>
                    <span>
                      Crearlo también en {empresasUsuario.filter(e => e !== empActualRol).join(', ')}
                      <div className="small" style={{ color:'var(--text-muted)' }}>
                        Los roles son por empresa: si solo existe en {empActualRol}, quien lo tenga no
                        va a ver nada al cambiar de empresa.
                      </div>
                    </span>
                  </label>
                </div>
              )}
              <div className="mt-3 small" style={{ color:'var(--text-muted)' }}>El rol comenzará sin permisos. Configúralos en la pantalla de permisos.</div>
            </div>
            <div className="modal-footer">
              <button className="btn ghost" onClick={() => setShowNew(false)}>Cancelar</button>
              <button className="btn primary" disabled={!newName.trim()} onClick={handleCreateRole}>
                <Icon name="plus" size={14}/>Crear rol
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete role */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" style={{ maxWidth:420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ width:36, height:36, borderRadius:8, background:'#dc262618', display:'grid', placeItems:'center', flexShrink:0 }}>
                <Icon name="trash" size={18} style={{ color:'var(--danger)' }}/>
              </div>
              <div style={{ flex:1 }}>
                <h3 className="modal-title">¿Eliminar rol?</h3>
                <div className="small">Esta acción no se puede deshacer</div>
              </div>
              <button className="icon-btn" onClick={() => setConfirmDelete(null)}><Icon name="x" size={16}/></button>
            </div>
            <div style={{ padding:'16px 24px', fontSize:13.5, color:'var(--text-muted)', lineHeight:1.6 }}>
              Se eliminará el rol <strong style={{ color:'var(--text)' }}>{confirmDelete.nombre}</strong>.
              Si hay usuarios asignados a este rol, la eliminación se bloqueará: primero reasignalos a otro rol.
            </div>
            <div className="modal-footer">
              <button className="btn secondary" onClick={() => setConfirmDelete(null)}>Cancelar</button>
              <button className="btn ghost" style={{ color:'var(--danger)' }} onClick={() => handleDeleteRole(confirmDelete.nombre)}>
                <Icon name="trash" size={14}/>Eliminar rol
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Empresa config helpers ────────────────────────────────────────────────
const EMPRESA_DEFAULTS = {
  razon_social: 'Distribuidora Demo 1, C.A.',
  rif:          'J-40123456-7',
  telefono:     '0212-555-0101',
  email:        'no-reply@distribuidorademo.com',
  email_info:   'info@distribuidorademo.com',
  website:      'http://www.distribuidorademo.com',
  whatsapp:     '+58 412-555-0101',
  whatsapp_cotizacion_template: 'Hola {nombre}, le comparto el enlace de su {tipo}:\n{url}',
  anthropic_api_key: '',
  dir_fiscal:   'Av. Principal, Centro Empresarial Norte, Piso 3, Of. 3-B.',
  dir_fiscal2:  'Zona Industrial La Yaguara.',
  ciudad:       'Caracas DC 1050',
  pais:         'Venezuela',
  logo:         null,
  favicon:      null,
  modo_historia_activo: true,   // Modo Historia (tutorial/onboarding guiado) — apagable desde Ajustes
};

// Normaliza los nombres de columna DB → nombres de app.
// La tabla configuracion_sistema usa: logo_pdf, nombre_empresa, direccion
// El resto del código usa:            logo,     razon_social,   dir_fiscal
// Muestra la hora en la zona elegida, viva. Sirve para verificar de un vistazo que la configuración
// es la correcta: si dice una hora que no es la de la oficina, está mal puesta.
function RelojSistema({ zona }) {
  const [ahora, setAhora] = uState(() => new Date());
  uEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  let texto = '', off = '';
  try {
    texto = new Intl.DateTimeFormat('es-VE', { timeZone: zona, weekday: 'long', day: '2-digit',
      month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false }).format(ahora);
    off = new Intl.DateTimeFormat('en-US', { timeZone: zona, timeZoneName: 'shortOffset' })
      .formatToParts(ahora).find(x => x.type === 'timeZoneName')?.value || '';
  } catch (e) { texto = 'Zona horaria no reconocida'; }
  return (
    <div style={{padding:'10px 12px', background:'var(--bg-sunken)', borderRadius:8}}>
      <div className="mono" style={{fontSize:15, fontWeight:700}}>{texto}</div>
      <div className="small muted" style={{marginTop:3}}>{zona}{off ? ' · ' + off : ''}</div>
    </div>
  );
}

function normalizeEmpresaCfg(raw) {
  if (!raw) return {};
  return {
    ...raw,
    logo:         raw.logo         ?? raw.logo_pdf      ?? null,
    razon_social: raw.razon_social ?? raw.nombre_empresa ?? null,
    dir_fiscal:   raw.dir_fiscal   ?? raw.direccion      ?? null,
  };
}

window.getEmpresaConfig = function(empresaId) {
  const eid = empresaId || window.currentEmpresa || 'demo1';
  // Caché en memoria por empresa (poblado desde DB en loadConfigSistema)
  if (window.__ssEmpresaConfigCache && window.__ssEmpresaConfigCache[eid]) {
    return { ...EMPRESA_DEFAULTS, ...normalizeEmpresaCfg(window.__ssEmpresaConfigCache[eid]) };
  }
  // Fallback a localStorage (per empresa)
  try {
    const s = localStorage.getItem('ss-config-empresa-' + eid);
    if (s) return { ...EMPRESA_DEFAULTS, ...normalizeEmpresaCfg(JSON.parse(s)) };
    // Migración: lectura única de la clave legacy si la empresa es la principal (demo1)
    if (eid === 'demo1') {
      const legacy = localStorage.getItem('ss-config-empresa');
      if (legacy) return { ...EMPRESA_DEFAULTS, ...normalizeEmpresaCfg(JSON.parse(legacy)) };
    }
  } catch(e) {}
  return { ...EMPRESA_DEFAULTS };
};

function saveEmpresaConfig(data, empresaId) {
  const eid = empresaId || window.currentEmpresa || 'demo1';
  try { localStorage.setItem('ss-config-empresa-' + eid, JSON.stringify(data)); } catch(e) {}
  if (!window.__ssEmpresaConfigCache) window.__ssEmpresaConfigCache = {};
  window.__ssEmpresaConfigCache[eid] = data;
}

function applyFavicon(base64) {
  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = base64;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Shopify Card (integraciones) ──────────────────────────────────────────
function ShopifyCard({ activeEmp }) {
  const [cfg, setCfg]       = uState(null);
  const [loading, setLoad]  = uState(true);
  const [shopInput, setShop]= uState('distribuidora-demo-shop.myshopify.com');
  const [testing, setTest]  = uState(false);
  const [testRes, setTestR] = uState(null);

  async function reload() {
    setLoad(true);
    const { data } = await window.loadShopifyConfig(activeEmp);
    setCfg(data || {});
    if (data?.shopify_store) setShop(data.shopify_store);
    setLoad(false);
  }
  uEffect(() => { reload(); }, [activeEmp]);

  async function handleConnect() {
    const shop = (shopInput || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9-]+\.myshopify\.com$/.test(shop)) {
      alert('Dominio inválido. Debe ser tu-tienda.myshopify.com');
      return;
    }
    const url = window.shopifyInstallUrl(shop, activeEmp);
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  async function handleTest() {
    setTest(true); setTestR(null);
    const r = await window.shopifyFetch('/shop.json');
    setTest(false); setTestR(r);
    if (r?.ok && r.data?.shop) {
      window.logActivity?.({ modulo:'configuracion', accion:'editar', entidad_label:'Probar Shopify', detalles:{ shop: r.data.shop.myshopify_domain, name: r.data.shop.name }});
    }
  }
  async function handleDisconnect() {
    if (!confirm('¿Desconectar Shopify? Se borrará el token guardado.')) return;
    const { error } = await window.shopifyDisconnect(activeEmp);
    if (error) { alert('Error: ' + error.message); return; }
    window.logActivity?.({ modulo:'configuracion', accion:'editar', entidad_label:'Desconectar Shopify' });
    setTestR(null);
    await reload();
  }

  const connected = !!cfg?.shopify_enabled && !!cfg?.shopify_store;
  const info = cfg?.shopify_shop_info || null;

  return (
    <div className="card">
      <div className="card-header">
        <Icon name="external" size={16}/>
        <div className="card-title">Shopify</div>
        <div style={{marginLeft:'auto'}}>
          {loading ? <span className="badge">Cargando…</span>
            : connected ? <span className="badge" style={{background:'rgba(34,197,94,.15)', color:'#22c55e'}}>● Conectado</span>
            : <span className="badge" style={{background:'rgba(148,163,184,.15)', color:'#94a3b8'}}>● Desconectado</span>}
        </div>
      </div>
      <div className="card-body">
        {connected && (
          <div style={{background:'var(--bg-soft, var(--surface, #f8fafc))', color:'var(--text)', border:'1px solid var(--border)', borderRadius:8, padding:12, marginBottom:16, fontSize:13, lineHeight:1.6}}>
            <div><strong>Tienda:</strong> <span className="mono">{cfg.shopify_store}</span></div>
            {info?.name      && <div><strong>Nombre:</strong> {info.name}</div>}
            {info?.plan_display_name && <div><strong>Plan:</strong> {info.plan_display_name}</div>}
            {info?.currency  && <div><strong>Moneda:</strong> {info.currency}</div>}
            {info?.email     && <div><strong>Email:</strong> {info.email}</div>}
            {cfg.shopify_connected_at && <div><strong>Conectado:</strong> {new Date(cfg.shopify_connected_at).toLocaleString('es-VE',{timeZone:'America/Caracas'})}</div>}
            <div><strong>API version:</strong> <span className="mono">{cfg.shopify_api_version || '2024-10'}</span></div>
          </div>
        )}

        {!connected && (
          <div style={{display:'flex', gap:12, alignItems:'flex-end', flexWrap:'wrap'}}>
            <div style={{flex:'1 1 320px'}}>
              <label className="form-label">Dominio Shopify</label>
              <input className="input" style={{width:'100%'}} value={shopInput} onChange={e => setShop(e.target.value)} placeholder="tu-tienda.myshopify.com"/>
            </div>
            {window.canUser?.('administrar','config_roles') !== false && (
              <button className="btn primary" onClick={handleConnect}>
                <Icon name="external" size={14}/> Conectar tienda
              </button>
            )}
          </div>
        )}

        <div style={{display:'flex', gap:8, marginTop:16, flexWrap:'wrap'}}>
          {connected && (
            <>
              <button className="btn secondary" onClick={handleTest} disabled={testing}>
                <Icon name="sync" size={14}/> {testing ? 'Probando…' : 'Probar conexión'}
              </button>
              {window.canUser?.('administrar','config_roles') !== false && (
                <button className="btn secondary" onClick={() => window.open(window.shopifyInstallUrl(cfg.shopify_store, activeEmp), '_blank')}>
                  <Icon name="external" size={14}/> Reautorizar
                </button>
              )}
              {window.canUser?.('administrar','config_roles') !== false && (
                <button className="btn danger" onClick={handleDisconnect} style={{marginLeft:'auto'}}>
                  <Icon name="trash" size={14}/> Desconectar
                </button>
              )}
            </>
          )}
        </div>

        {testRes && (
          <div style={{marginTop:12, padding:12, borderRadius:8, fontSize:13,
            background: testRes.ok ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)',
            border: '1px solid ' + (testRes.ok ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)') }}>
            {testRes.ok && testRes.data?.shop
              ? <div>✓ <strong>{testRes.data.shop.name}</strong> — {testRes.data.shop.myshopify_domain} · {testRes.data.shop.currency} · {testRes.data.shop.plan_display_name || testRes.data.shop.plan_name}</div>
              : <div>✗ Error {testRes.status}: <code>{JSON.stringify(testRes.data || testRes).slice(0,300)}</code></div>}
          </div>
        )}

        <div style={{marginTop:12, fontSize:12, color:'var(--text-muted)'}}>
          Al pulsar “Conectar tienda” se abre Shopify en otra pestaña para autorizar.
          Al volver, recarga esta página (Ctrl+Shift+R) para ver el estado actualizado.
        </div>
      </div>
    </div>
  );
}

// ── Config System Page ────────────────────────────────────────────────────
window.ConfigSystemPage = function ConfigSystemPage() {
  const [tab, setTab] = uState('empresa');
  const [activeEmp, setActiveEmp] = uState(window.currentEmpresa || 'demo1');
  const [empresaInfo, setEmpresaInfo] = uState(null); // {nombre, color}
  const [empresa, setEmpresa] = uState(() => window.getEmpresaConfig(window.currentEmpresa));
  const [saved, setSaved] = uState(false);
  const [sys, setSys] = uState(() => {
    try { const s = localStorage.getItem('ss-config-sistema-' + (window.currentEmpresa || 'demo1')); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const [fontScale, setFontScale] = uState(() => window.ssFontScale ? window.ssFontScale.get() : 'normal');

  // Reaccionar al cambio de empresa: recargar config
  uEffect(() => {
    function onEmpresaChange(e) {
      const eid = e.detail || window.currentEmpresa;
      setActiveEmp(eid);
      setEmpresa(window.getEmpresaConfig(eid));
      try { const s = localStorage.getItem('ss-config-sistema-' + eid); setSys(s ? JSON.parse(s) : {}); } catch { setSys({}); }
      setSaved(false);
    }
    window.addEventListener('ss-empresa-changed', onEmpresaChange);
    // Cargar desde DB la primera vez
    window.loadEmpresas?.().then(list => {
      const cur = (list || []).find(x => x.id === (window.currentEmpresa || 'demo1'));
      setEmpresaInfo(cur || null);
    });
    window.loadConfigSistema?.(window.currentEmpresa).then(cfg => {
      if (cfg) {
        const norm = normalizeEmpresaCfg(cfg);
        setEmpresa(prev => ({ ...prev, ...norm }));
        if (!window.__ssEmpresaConfigCache) window.__ssEmpresaConfigCache = {};
        window.__ssEmpresaConfigCache[window.currentEmpresa] = cfg;
      }
    });
    return () => window.removeEventListener('ss-empresa-changed', onEmpresaChange);
  }, []);

  const setE = (key, val) => { setEmpresa(prev => ({ ...prev, [key]: val })); setSaved(false); };
  const setS = (key, val) => { setSys(prev => ({ ...prev, [key]: val })); setSaved(false); };

  async function handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 500 * 1024) { alert('El logo no debe superar 500 KB.'); return; }
    const b64 = await readFileAsBase64(file);
    setE('logo', b64);
  }

  async function handleFaviconUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 100 * 1024) { alert('El favicon no debe superar 100 KB.'); return; }
    const b64 = await readFileAsBase64(file);
    setE('favicon', b64);
    applyFavicon(b64);
  }

  const [autoStatus, setAutoStatus] = uState('idle'); // idle | saving | saved | error
  const skipAutoRef = React.useRef(true);
  const autoTimerRef = React.useRef(null);

  async function persistNow() {
    setAutoStatus('saving');
    try {
      saveEmpresaConfig(empresa, activeEmp);
      try { localStorage.setItem('ss-config-sistema-' + activeEmp, JSON.stringify(sys)); } catch(e) {}
      if (window.saveConfigSistema) {
        const { logo, favicon, razon_social, rif, telefono, email, dir_fiscal, whatsapp_cotizacion_template, anthropic_api_key, modo_historia_activo, zona_horaria } = empresa;
        await window.saveConfigSistema(activeEmp, {
          nombre_empresa: razon_social || empresaInfo?.nombre,
          rif, telefono, email, direccion: dir_fiscal,
          logo_pdf: logo, favicon,
          whatsapp_cotizacion_template,
          anthropic_api_key,
          modo_historia_activo: modo_historia_activo !== false,
          // La hora del sistema: con esta zona se calcula qué día es "hoy" y se muestran todas las horas.
          zona_horaria: zona_horaria || 'America/Caracas',
        });
      }
      if (empresa.favicon) applyFavicon(empresa.favicon);
      setAutoStatus('saved');
      setTimeout(() => setAutoStatus(s => s === 'saved' ? 'idle' : s), 1800);
    } catch (err) {
      console.error('[autosave]', err);
      setAutoStatus('error');
    }
  }

  // Auto-save con debounce 700ms
  uEffect(() => {
    if (skipAutoRef.current) { skipAutoRef.current = false; return; }
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    autoTimerRef.current = setTimeout(persistNow, 700);
    return () => autoTimerRef.current && clearTimeout(autoTimerRef.current);
  }, [empresa, sys]);

  // Cuando cambia la empresa activa, no auto-guardes el reload inicial
  uEffect(() => { skipAutoRef.current = true; }, [activeEmp]);

  const inp = (key) => ({
    className: 'input',
    style: { width:'100%' },
    value: empresa[key] || '',
    disabled: window.canUser?.('editar','config_sistema') === false,
    onChange: e => setE(key, e.target.value),
  });

  const Toggle = ({ skey, label }) => {
    const on = sys[skey] !== undefined ? sys[skey] : true;
    const canEdit = window.canUser?.('editar','config_sistema') !== false;
    return (
      <div style={{display:'flex', alignItems:'center', gap:10, marginTop:4}}>
        <div onClick={() => { if (canEdit) setS(skey, !on); }} title={!canEdit ? 'Requiere permiso de edición' : ''} style={{
          width:34, height:18, borderRadius:9, cursor: canEdit ? 'pointer' : 'not-allowed', opacity: canEdit ? 1 : 0.5,
          background: on ? 'var(--brand)' : 'var(--border)', position:'relative', transition:'background .15s', flexShrink:0,
        }}>
          <div style={{position:'absolute', top:3, left: on ? 17 : 3, width:12, height:12, borderRadius:6, background:'#fff', transition:'left .15s', boxShadow:'0 1px 3px rgba(0,0,0,.2)'}}/>
        </div>
        <span className="small" style={{color: on ? 'var(--text)' : 'var(--text-muted)'}}>{on ? 'Habilitado' : 'Deshabilitado'}</span>
      </div>
    );
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Configuración del Sistema</h1>
          <div className="page-subtitle" style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            <span>Identidad de la empresa, parámetros operativos e integraciones</span>
            {empresaInfo && (
              <span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'2px 9px',borderRadius:6,fontSize:11,fontWeight:700,background:(empresaInfo.color||'#666')+'18',color:empresaInfo.color||'inherit',border:'1px solid '+(empresaInfo.color||'#ccc')+'40'}}>
                <span style={{width:6,height:6,borderRadius:'50%',background:empresaInfo.color||'#666'}}></span>
                Editando: {empresaInfo.nombre}
              </span>
            )}
          </div>
        </div>
        <div className="page-actions">
          <div style={{
            display:'inline-flex', alignItems:'center', gap:8, padding:'8px 14px', borderRadius:8, fontSize:13,
            background:
              autoStatus === 'saving' ? 'rgba(59,130,246,.10)' :
              autoStatus === 'saved'  ? 'rgba(34,197,94,.12)' :
              autoStatus === 'error'  ? 'rgba(239,68,68,.12)' : 'transparent',
            color:
              autoStatus === 'saving' ? '#3b82f6' :
              autoStatus === 'saved'  ? '#22c55e' :
              autoStatus === 'error'  ? '#ef4444' : 'var(--text-muted)',
            border: '1px solid ' + (
              autoStatus === 'saving' ? 'rgba(59,130,246,.3)' :
              autoStatus === 'saved'  ? 'rgba(34,197,94,.3)' :
              autoStatus === 'error'  ? 'rgba(239,68,68,.3)' : 'transparent'),
            transition:'all .15s',
          }}>
            {autoStatus === 'saving' && <><Icon name="sync" size={14}/> Guardando…</>}
            {autoStatus === 'saved'  && <><Icon name="check" size={14}/> Guardado automáticamente</>}
            {autoStatus === 'error'  && <><Icon name="x" size={14}/> Error al guardar</>}
            {autoStatus === 'idle'   && <span style={{opacity:.6}}>Los cambios se guardan solos</span>}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{display:'flex', gap:2, borderBottom:'1px solid var(--border)', marginBottom:20}}>
        {[
          { id:'empresa',      label:'Empresa',       icon:'settings' },
          { id:'sistema',      label:'Sistema',        icon:'inventory' },
          { id:'integraciones',label:'Integraciones',  icon:'sync' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            display:'flex', alignItems:'center', gap:6, padding:'8px 16px', fontSize:13,
            fontWeight: tab===t.id ? 600 : 400, border:'none', background:'transparent', cursor:'pointer',
            borderBottom: tab===t.id ? '2px solid var(--brand)' : '2px solid transparent',
            color: tab===t.id ? 'var(--brand)' : 'var(--text-muted)', transition:'color .12s',
          }}>
            <Icon name={t.icon} size={14}/>{t.label}
          </button>
        ))}
      </div>

      {/* ═══ TAB: EMPRESA ═══ */}
      {tab === 'empresa' && (
        <div style={{display:'flex', flexDirection:'column', gap:16}}>

          {/* Logo + Favicon */}
          <div className="card">
            <div className="card-header"><Icon name="box" size={16}/><div className="card-title">Identidad visual</div></div>
            <div className="card-body">
              <div className="grid-2" style={{gap:24}}>

                {/* Logo */}
                <div>
                  <label className="form-label">Logo de la empresa</label>
                  <div style={{display:'flex', alignItems:'center', gap:16, marginTop:6}}>
                    <div style={{width:100, height:70, border:'2px dashed var(--border)', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', background:'var(--bg-sunken,var(--bg))'}}>
                      {empresa.logo
                        ? <img src={empresa.logo} alt="Logo" style={{maxWidth:'100%', maxHeight:'100%', objectFit:'contain'}}/>
                        : <div style={{textAlign:'center', color:'var(--text-muted)', fontSize:11}}>
                            <Icon name="box" size={20}/><br/>Sin logo
                          </div>
                      }
                    </div>
                    <div>
                      {window.canUser?.('editar','config_sistema') !== false && (
                        <label className="btn secondary" style={{cursor:'pointer', fontSize:12.5}}>
                          <Icon name="upload" size={13}/>Subir logo
                          <input type="file" accept="image/*" style={{display:'none'}} onChange={handleLogoUpload}/>
                        </label>
                      )}
                      <div style={{fontSize:11, color:'var(--text-muted)', marginTop:5}}>PNG o SVG recomendado<br/>Máx. 500 KB</div>
                      {empresa.logo && window.canUser?.('editar','config_sistema') !== false && (
                        <button className="btn ghost" style={{fontSize:11, marginTop:4, padding:'3px 8px'}} onClick={() => setE('logo', null)}>
                          <Icon name="trash" size={11}/>Quitar logo
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Favicon */}
                <div>
                  <label className="form-label">Favicon de la web app</label>
                  <div style={{display:'flex', alignItems:'center', gap:16, marginTop:6}}>
                    <div style={{width:48, height:48, border:'2px dashed var(--border)', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', background:'var(--bg-sunken,var(--bg))'}}>
                      {empresa.favicon
                        ? <img src={empresa.favicon} alt="Favicon" style={{maxWidth:'100%', maxHeight:'100%', objectFit:'contain'}}/>
                        : <div style={{textAlign:'center', color:'var(--text-muted)', fontSize:10}}>
                            <Icon name="external" size={16}/><br/>Fav.
                          </div>
                      }
                    </div>
                    <div>
                      {window.canUser?.('editar','config_sistema') !== false && (
                        <label className="btn secondary" style={{cursor:'pointer', fontSize:12.5}}>
                          <Icon name="upload" size={13}/>Subir favicon
                          <input type="file" accept="image/*,.ico" style={{display:'none'}} onChange={handleFaviconUpload}/>
                        </label>
                      )}
                      <div style={{fontSize:11, color:'var(--text-muted)', marginTop:5}}>ICO, PNG o SVG<br/>Máx. 100 KB · 32×32 px ideal</div>
                      {empresa.favicon && window.canUser?.('editar','config_sistema') !== false && (
                        <button className="btn ghost" style={{fontSize:11, marginTop:4, padding:'3px 8px'}} onClick={() => setE('favicon', null)}>
                          <Icon name="trash" size={11}/>Quitar favicon
                        </button>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>

          {/* Datos de la empresa */}
          <div className="card">
            <div className="card-header"><Icon name="doc" size={16}/><div className="card-title">Datos legales</div></div>
            <div className="card-body">
              <div className="grid-2" style={{gap:14}}>
                <div>
                  <label className="form-label">Razón social</label>
                  <input {...inp('razon_social')} placeholder="Distribuidora Demo 1, C.A."/>
                </div>
                <div>
                  <label className="form-label">RIF / Tax ID</label>
                  <input {...inp('rif')} placeholder="J-40123456-7"/>
                </div>
                <div style={{gridColumn:'1/-1'}}>
                  <label className="form-label">Dirección fiscal (línea 1)</label>
                  <input {...inp('dir_fiscal')} placeholder="Avenida, Edificio, Piso…"/>
                </div>
                <div style={{gridColumn:'1/-1'}}>
                  <label className="form-label">Dirección fiscal (línea 2)</label>
                  <input {...inp('dir_fiscal2')} placeholder="Urbanización, sector…"/>
                </div>
                <div>
                  <label className="form-label">Ciudad / Estado</label>
                  <input {...inp('ciudad')} placeholder="Caracas DC 1050"/>
                </div>
                <div>
                  <label className="form-label">País</label>
                  <input {...inp('pais')} placeholder="Venezuela"/>
                </div>
              </div>
            </div>
          </div>

          {/* Contacto */}
          <div className="card">
            <div className="card-header"><Icon name="phone" size={16}/><div className="card-title">Información de contacto</div></div>
            <div className="card-body">
              <div className="grid-2" style={{gap:14}}>
                <div>
                  <label className="form-label">Teléfono principal</label>
                  <input {...inp('telefono')} placeholder="0212-555-0101"/>
                </div>
                <div>
                  <label className="form-label">WhatsApp</label>
                  <input {...inp('whatsapp')} placeholder="+58 412-555-0101"/>
                </div>
                <div>
                  <label className="form-label">Email institucional</label>
                  <input {...inp('email')} placeholder="no-reply@distribuidorademo.com"/>
                </div>
                <div>
                  <label className="form-label">Email de contacto</label>
                  <input {...inp('email_info')} placeholder="info@distribuidorademo.com"/>
                </div>
                <div style={{gridColumn:'1/-1'}}>
                  <label className="form-label">Sitio web</label>
                  <input {...inp('website')} placeholder="http://www.distribuidorademo.com"/>
                </div>
              </div>
            </div>
          </div>

          {/* Mensajería WhatsApp */}
          <div className="card">
            <div className="card-header"><Icon name="wa" size={16}/><div className="card-title">Mensajería — WhatsApp</div></div>
            <div className="card-body">
              <div>
                <label className="form-label">Plantilla de mensaje para cotizaciones y órdenes</label>
                <textarea {...inp('whatsapp_cotizacion_template')}
                  style={{width:'100%', minHeight:80, resize:'vertical', fontFamily:'var(--font-mono)', fontSize:12.5}}
                  placeholder={'Hola {nombre}, le comparto el enlace de su {tipo}:\n{url}'}
                />
                <div className="small muted" style={{marginTop:5}}>
                  Variables disponibles: <code>{'{nombre}'}</code> · <code>{'{tipo}'}</code> · <code>{'{id}'}</code> · <code>{'{url}'}</code> · <code>{'{total}'}</code>
                </div>
              </div>
            </div>
          </div>

          {/* IA — Pedido por voz */}
          <div className="card">
            <div className="card-header"><Icon name="mic" size={16}/><div className="card-title">Inteligencia Artificial — Pedido por voz</div></div>
            <div className="card-body">
              <div>
                <label className="form-label">Clave de API de Claude (Anthropic)</label>
                <input {...inp('anthropic_api_key')}
                  type="password"
                  placeholder="sk-ant-api03-…"
                  style={{fontFamily:'var(--mono)', fontSize:12.5, opacity: window.canUser?.('administrar','config_sistema') === false ? 0.6 : 1}}
                  autoComplete="off"
                  onBlur={persistNow}
                  disabled={window.canUser?.('administrar','config_sistema') === false}
                  title={window.canUser?.('administrar','config_sistema') === false ? 'Requiere permiso de administración' : ''}
                />
                <div className="small muted" style={{marginTop:5}}>
                  Requerida para procesar pedidos por voz con IA. La clave se guarda en Supabase y es compartida entre todos los dispositivos de la empresa.
                  Obtén tu clave en <strong>console.anthropic.com</strong>.
                </div>
              </div>
            </div>
          </div>

          {/* Modo Historia — tutorial guiado / onboarding */}
          <div className="card">
            <div className="card-header"><Icon name="info" size={16}/><div className="card-title">Modo Historia (tutorial guiado)</div></div>
            <div className="card-body">
              <label style={{display:'flex', alignItems:'flex-start', gap:12, cursor: window.canUser?.('editar','config_sistema') === false ? 'not-allowed' : 'pointer'}}>
                <input type="checkbox" checked={empresa.modo_historia_activo !== false}
                  disabled={window.canUser?.('editar','config_sistema') === false}
                  onChange={e => setEmpresa(prev => ({ ...prev, modo_historia_activo: e.target.checked }))}
                  style={{width:18, height:18, marginTop:2, cursor: window.canUser?.('editar','config_sistema') === false ? 'not-allowed' : 'pointer', flexShrink:0}}/>
                <div>
                  <div style={{fontWeight:600, fontSize:13.5}}>Mostrar el Modo Historia a los usuarios</div>
                  <div className="small muted" style={{marginTop:3, lineHeight:1.5}}>
                    Activa el widget de tutorial guiado (abajo a la izquierda) que recorre el sistema paso a paso,
                    llevando al usuario por cada página y explicando qué hace y cómo se usa. Ideal para capacitación / onboarding.
                    Apágalo cuando el equipo ya no lo necesite.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Preview PDF header */}
          <div className="card">
            <div className="card-header"><Icon name="doc" size={16}/><div className="card-title">Vista previa — Encabezado de documentos PDF</div></div>
            <div className="card-body">
              <div style={{border:'1px solid var(--border)', borderRadius:8, padding:16, background:'#fff', color:'#111'}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', paddingBottom:10, borderBottom:'3px solid #1e3a5f', marginBottom:10}}>
                  <div style={{width:80, height:52, border:'1px dashed #ccc', borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', background:'#f5f5f5'}}>
                    {empresa.logo
                      ? <img src={empresa.logo} alt="Logo" style={{maxWidth:'100%', maxHeight:'100%', objectFit:'contain'}}/>
                      : <div style={{fontWeight:900, fontSize:16, color:'#1e3a5f'}}>SS</div>
                    }
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:12, fontWeight:700, color:'#1e3a5f'}}>{empresa.razon_social || 'Distribuidora Demo 1, C.A.'}</div>
                    <div style={{fontSize:9, color:'#555', lineHeight:1.5, marginTop:2}}>
                      {empresa.dir_fiscal || 'Dirección fiscal'}<br/>
                      {empresa.dir_fiscal2 && <>{empresa.dir_fiscal2}<br/></>}
                      {empresa.ciudad || 'Ciudad'}{empresa.pais ? ', ' + empresa.pais : ''}
                    </div>
                    <div style={{fontSize:9, color:'#888', marginTop:2}}>RIF: {empresa.rif || 'J00000000-0'}</div>
                  </div>
                </div>
                <div style={{display:'flex', justifyContent:'space-between', fontSize:8, color:'#666', borderTop:'1px solid #eee', paddingTop:6, marginTop:4}}>
                  <span>☎ {empresa.telefono} · ✉ {empresa.email} · {empresa.website} · Tax ID: {empresa.rif}</span>
                  <span>Página 1/1</span>
                </div>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ═══ TAB: SISTEMA ═══ */}
      {tab === 'sistema' && (
        <div style={{display:'flex', flexDirection:'column', gap:16}}>
          {/* Tamaño de letra: preferencia PERSONAL de quien mira la pantalla, no de la empresa —
              por eso vive en localStorage (window.ssFontScale, core.jsx) y no en
              `configuracion_sistema`. Vive acá en Ajustes porque es donde alguien va a buscar
              "hacer las letras más grandes", aunque el valor no viaje a la base ni afecte a nadie
              más. Pedido explícito 2026-08-14: "hay gente que puede que no vea bien". */}
          <div className="card">
            <div className="card-header"><Icon name="eye" size={16}/><div className="card-title">Accesibilidad</div></div>
            <div className="card-body">
              <label className="form-label">Tamaño de letra (en este navegador)</label>
              <div className="seg" style={{maxWidth:420}}>
                {[
                  { id: 'normal',     label: 'Normal' },
                  { id: 'grande',     label: 'Grande' },
                  { id: 'muy-grande', label: 'Muy grande' },
                ].map(o => (
                  <button key={o.id} className={fontScale === o.id ? 'on' : ''}
                          onClick={() => { window.ssFontScale.set(o.id); setFontScale(o.id); }}>
                    {o.label}
                  </button>
                ))}
              </div>
              <div className="small muted" style={{marginTop:8}}>
                Agranda todo el sistema (letras, números e íconos) para que sea más fácil de leer.
                Es una preferencia de este navegador — cada quien la ajusta a su gusto, no afecta a
                los demás usuarios ni a otros dispositivos.
              </div>
            </div>
          </div>
          {/* La hora del sistema no es cosmética: con ella se decide qué día es "hoy" para los
              documentos, la tasa y los correlativos, y con ella se muestran las horas de registro.
              Venezuela es UTC−4 sin horario de verano; se deja elegible por si la empresa opera en
              otra zona, pero el default es Caracas. */}
          <div className="card">
            <div className="card-header"><Icon name="clock" size={16}/><div className="card-title">Hora del sistema</div></div>
            <div className="card-body">
              <div className="grid-2" style={{gap:16}}>
                <div>
                  <label className="form-label">Zona horaria</label>
                  <select className="select" style={{width:'100%'}}
                          value={empresa.zona_horaria || 'America/Caracas'}
                          onChange={e => setE('zona_horaria', e.target.value)}>
                    <option value="America/Caracas">Caracas (UTC−4) — Venezuela</option>
                    <option value="America/Bogota">Bogotá / Lima / Panamá (UTC−5)</option>
                    <option value="America/Santiago">Santiago (UTC−4/−3)</option>
                    <option value="America/New_York">Nueva York (UTC−5/−4)</option>
                    <option value="America/Mexico_City">Ciudad de México (UTC−6)</option>
                    <option value="Europe/Madrid">Madrid (UTC+1/+2)</option>
                    <option value="UTC">UTC (sin desplazamiento)</option>
                  </select>
                  <div className="small muted" style={{marginTop:5}}>
                    Con esta zona se calcula qué día es "hoy" (documentos, tasa, correlativos) y se
                    muestran las horas de registro en todo el sistema.
                  </div>
                </div>
                <div>
                  <label className="form-label">Hora actual del sistema</label>
                  <RelojSistema zona={empresa.zona_horaria || 'America/Caracas'}/>
                </div>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><Icon name="dollar" size={16}/><div className="card-title">Moneda y Tasas</div></div>
            <div className="card-body">
              <div className="grid-2" style={{gap:16}}>
                <div>
                  <label className="form-label">Moneda base</label>
                  <select className="select" style={{width:'100%'}} value={sys.moneda_base || 'USD'} onChange={e => setS('moneda_base', e.target.value)}>
                    <option>USD</option><option>VES</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Fuente de tasa BCV</label>
                  <select className="select" style={{width:'100%'}} value={sys.fuente_bcv || 'API BCV Oficial'} onChange={e => setS('fuente_bcv', e.target.value)}>
                    <option>API BCV Oficial</option><option>Manual</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Fuente de tasa paralelo</label>
                  <select className="select" style={{width:'100%'}} value={sys.fuente_paralelo || 'Monitor Dólar'} onChange={e => setS('fuente_paralelo', e.target.value)}>
                    <option>Monitor Dólar</option><option>DolarToday</option><option>Manual</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Actualización automática de tasas</label>
                  <Toggle skey="auto_tasa" />
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><Icon name="inventory" size={16}/><div className="card-title">Inventario</div></div>
            <div className="card-body">
              <div className="grid-2" style={{gap:16}}>
                <div>
                  <label className="form-label">Método de costeo</label>
                  <select className="select" style={{width:'100%'}} value={sys.metodo_costeo || 'PEPS'} onChange={e => setS('metodo_costeo', e.target.value)}>
                    <option>PEPS</option><option>UEPS</option><option>Promedio</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Alertas de stock mínimo</label>
                  <Toggle skey="alertas_stock" />
                </div>
                <div>
                  <label className="form-label">Permitir stock negativo</label>
                  <Toggle skey="stock_negativo" />
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><Icon name="receipt" size={16}/><div className="card-title">Facturación</div></div>
            <div className="card-body">
              <div className="grid-2" style={{gap:16}}>
                <div>
                  <label className="form-label">Número de control inicial</label>
                  <input className="input" style={{width:'100%'}} value={sys.ctrl_inicial || '00-000001'} onChange={e => setS('ctrl_inicial', e.target.value)}/>
                </div>
                <div>
                  <label className="form-label">IVA por defecto (%)</label>
                  <input className="input" style={{width:'100%'}} type="number" value={sys.iva_default ?? 16} onChange={e => setS('iva_default', Number(e.target.value))}/>
                </div>
                <div>
                  <label className="form-label">Días de crédito por defecto</label>
                  <input className="input" style={{width:'100%'}} type="number" value={sys.dias_credito ?? 30} onChange={e => setS('dias_credito', Number(e.target.value))}/>
                </div>
                <div>
                  <label className="form-label">Imprimir 2 copias por defecto</label>
                  <Toggle skey="dos_copias" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TAB: INTEGRACIONES ═══ */}
      {tab === 'integraciones' && (
        <div style={{display:'flex', flexDirection:'column', gap:16}}>
          <ShopifyCard activeEmp={activeEmp}/>

          <div className="card">
            <div className="card-header"><Icon name="sync" size={16}/><div className="card-title">Supabase</div></div>
            <div className="card-body">
              <div className="grid-2" style={{gap:16}}>
                <div>
                  <label className="form-label">Sincronización activa</label>
                  <Toggle skey="supabase_sync"/>
                </div>
                <div>
                  <label className="form-label">Proyecto</label>
                  <input className="input" value="distribuidora-demo (demo)" readOnly style={{width:'100%', opacity:0.6, cursor:'not-allowed'}}/>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><Icon name="bell" size={16}/><div className="card-title">Notificaciones</div></div>
            <div className="card-body">
              <div className="grid-2" style={{gap:16}}>
                <div><label className="form-label">Notificaciones por email</label><Toggle skey="notif_email"/></div>
                <div><label className="form-label">Alertas de stock por email</label><Toggle skey="notif_stock"/></div>
                <div><label className="form-label">Alertas de CxC vencidas</label><Toggle skey="notif_cxc"/></div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

// ── Campos y Validaciones — definiciones por módulo ───────────────────────

const MODULOS_CAMPOS = {
  pos: {
    label: 'POS',
    storageKey: 'ss-config-campos',
    subtitle: 'Define qué campos son obligatorios, opcionales u ocultos al crear documentos en el POS.',
    sections: [
      {
        section: 'Cotización / Documento',
        desc: 'Elementos base del documento. Se aplican a cotizaciones y órdenes.',
        fields: [
          { id: 'modalidad_pago', label: 'Modalidad de pago',   desc: 'Divisas USD, Tasa BCV o Paralelo — afecta directamente los precios' },
          { id: 'cliente',        label: 'Cliente / Contacto',  desc: 'A quién se dirige el documento' },
          { id: 'almacen',        label: 'Almacén de despacho', desc: 'Almacén desde donde se despachan los productos' },
        ],
      },
      {
        section: 'Condiciones comerciales',
        desc: 'Condiciones que acompañan el documento a lo largo de todo el flujo.',
        fields: [
          { id: 'tipo_venta',    label: 'Tipo de venta',        desc: 'Regular, especial, consignación o muestra' },
          { id: 'vencimiento',   label: 'Fecha de vencimiento', desc: 'Vigencia de la cotización u orden' },
          { id: 'terminos_pago', label: 'Términos de pago',     desc: 'Contado o crédito a X días' },
          { id: 'vendedor',      label: 'Vendedor asignado',    desc: 'Responsable de la venta' },
          { id: 'fuente',        label: 'Fuente / Canal',       desc: 'Origen del negocio: CRM, WhatsApp, web, teléfono…' },
        ],
      },
      {
        section: 'Entrega y logística',
        desc: 'Cómo y dónde se entrega la mercancía al cliente.',
        fields: [
          { id: 'tipo_entrega',  label: 'Tipo de entrega',   desc: 'Retiro en tienda, Solano, delivery o encomienda' },
          { id: 'zona_delivery', label: 'Zona de delivery',  desc: 'Zona geográfica para entregas a domicilio' },
          { id: 'nro_despacho',  label: 'Nro. despacho SOS', desc: 'Número de despacho en el sistema SOS' },
        ],
      },
      {
        section: 'Direcciones',
        desc: 'Aparecen impresas en los documentos emitidos al cliente.',
        fields: [
          { id: 'dir_factura', label: 'Dirección de factura', desc: 'Dirección fiscal del cliente para documentos legales' },
          { id: 'dir_entrega', label: 'Dirección de entrega', desc: 'Dirección física donde se entrega la mercancía' },
        ],
      },
      {
        section: 'Adicional',
        desc: 'Información complementaria del documento.',
        fields: [
          { id: 'observaciones', label: 'Observaciones', desc: 'Notas internas o instrucciones para el cliente' },
        ],
      },
    ],
    defaults: {
      modalidad_pago: 'obligatorio', cliente: 'obligatorio', almacen: 'obligatorio',
      tipo_venta: 'opcional', vencimiento: 'opcional', terminos_pago: 'opcional',
      vendedor: 'opcional', fuente: 'opcional', tipo_entrega: 'opcional',
      zona_delivery: 'opcional', nro_despacho: 'oculto',
      dir_factura: 'opcional', dir_entrega: 'opcional', observaciones: 'opcional',
    },
  },
  clientes: {
    label: 'Clientes',
    storageKey: 'ss-config-campos-clientes',
    subtitle: 'Campos del formulario de creación y edición de clientes.',
    sections: [
      {
        section: 'Datos principales',
        desc: 'Información de identificación del cliente.',
        fields: [
          { id: 'nombre',        label: 'Nombre / Razón social', desc: 'Nombre completo o razón social del cliente' },
          { id: 'rif',           label: 'RIF / Cédula',          desc: 'Número de identificación fiscal o personal' },
          { id: 'tipo_cliente',  label: 'Tipo de cliente',       desc: 'Mayorista, instalador, distribuidor, retail, corporativo, gobierno' },
          { id: 'lista_precios', label: 'Lista de precios',      desc: 'Lista asignada que determina los descuentos aplicados' },
        ],
      },
      {
        section: 'Contacto',
        desc: 'Medios de comunicación del cliente.',
        fields: [
          { id: 'telefono',  label: 'Teléfono',   desc: 'Número de teléfono principal' },
          { id: 'email',     label: 'Correo',     desc: 'Dirección de correo electrónico' },
          { id: 'sitio_web', label: 'Sitio web',  desc: 'URL del sitio web corporativo' },
        ],
      },
      {
        section: 'Ubicación',
        desc: 'Dirección fiscal y geográfica del cliente.',
        fields: [
          { id: 'estado',      label: 'Estado',           desc: 'Estado o región del cliente' },
          { id: 'ciudad',      label: 'Ciudad',           desc: 'Ciudad o municipio' },
          { id: 'dir_fiscal',  label: 'Dirección fiscal', desc: 'Dirección para documentos y facturación' },
        ],
      },
      {
        section: 'Crédito',
        desc: 'Condiciones de crédito asignadas al cliente.',
        fields: [
          { id: 'limite_credito',    label: 'Límite de crédito', desc: 'Monto máximo de crédito autorizado en USD' },
          { id: 'dias_credito',      label: 'Días de crédito',   desc: 'Plazo de pago en días' },
          { id: 'moneda_preferida',  label: 'Moneda preferida',  desc: 'USD, VES u otra moneda para transacciones con este cliente' },
        ],
      },
      {
        section: 'Adicional',
        desc: 'Información complementaria.',
        fields: [
          { id: 'observaciones_cli', label: 'Observaciones', desc: 'Notas internas sobre el cliente' },
        ],
      },
    ],
    defaults: {
      nombre: 'obligatorio', rif: 'obligatorio', tipo_cliente: 'obligatorio', lista_precios: 'obligatorio',
      telefono: 'opcional', email: 'opcional', sitio_web: 'oculto',
      estado: 'opcional', ciudad: 'opcional', dir_fiscal: 'opcional',
      limite_credito: 'opcional', dias_credito: 'opcional', moneda_preferida: 'oculto',
      observaciones_cli: 'opcional',
    },
  },
  contactos: {
    label: 'Contactos',
    storageKey: 'ss-config-campos-contactos',
    subtitle: 'Campos del formulario de creación y edición de contactos.',
    sections: [
      {
        section: 'Datos personales',
        desc: 'Información de identificación del contacto.',
        fields: [
          { id: 'nombre_cont',  label: 'Nombre completo', desc: 'Nombre y apellido del contacto' },
          { id: 'cargo',        label: 'Cargo / Puesto',  desc: 'Posición o rol dentro de la empresa' },
          { id: 'departamento', label: 'Departamento',    desc: 'Área o departamento al que pertenece' },
        ],
      },
      {
        section: 'Comunicación',
        desc: 'Medios de contacto disponibles.',
        fields: [
          { id: 'telefono_cont', label: 'Teléfono',  desc: 'Número de teléfono directo o extensión' },
          { id: 'email_cont',    label: 'Correo',    desc: 'Correo electrónico del contacto' },
          { id: 'whatsapp',      label: 'WhatsApp',  desc: 'Número de WhatsApp para comunicación rápida' },
        ],
      },
      {
        section: 'Adicional',
        desc: 'Información complementaria.',
        fields: [
          { id: 'notas_cont', label: 'Notas', desc: 'Observaciones internas sobre este contacto' },
        ],
      },
    ],
    defaults: {
      nombre_cont: 'obligatorio', cargo: 'opcional', departamento: 'oculto',
      telefono_cont: 'obligatorio', email_cont: 'opcional', whatsapp: 'opcional',
      notas_cont: 'opcional',
    },
  },
  proveedores: {
    label: 'Proveedores',
    storageKey: 'ss-config-campos-proveedores',
    subtitle: 'Campos del formulario de creación y edición de proveedores.',
    sections: [
      {
        section: 'Datos principales',
        desc: 'Información de identificación del proveedor.',
        fields: [
          { id: 'nombre_prov',  label: 'Nombre / Razón social', desc: 'Nombre completo o razón social del proveedor' },
          { id: 'rif_prov',     label: 'RIF',                   desc: 'Número de identificación fiscal' },
          { id: 'tipo_prov',    label: 'Tipo de proveedor',     desc: 'Fabricante, distribuidor, importador, servicio, etc.' },
        ],
      },
      {
        section: 'Contacto',
        desc: 'Medios de comunicación del proveedor.',
        fields: [
          { id: 'telefono_prov', label: 'Teléfono',  desc: 'Número de teléfono principal del proveedor' },
          { id: 'email_prov',    label: 'Correo',    desc: 'Correo electrónico de contacto' },
          { id: 'sitio_web_prov',label: 'Sitio web', desc: 'URL del sitio web corporativo' },
        ],
      },
      {
        section: 'Condiciones comerciales',
        desc: 'Términos acordados con el proveedor.',
        fields: [
          { id: 'tiempo_entrega', label: 'Tiempo de entrega', desc: 'Días hábiles promedio de entrega' },
          { id: 'terminos_prov',  label: 'Términos de pago',  desc: 'Contado, crédito a X días, etc.' },
          { id: 'moneda_prov',    label: 'Moneda',            desc: 'Moneda en la que factura el proveedor' },
        ],
      },
      {
        section: 'Ubicación',
        desc: 'Dirección del proveedor.',
        fields: [
          { id: 'direccion_prov', label: 'Dirección', desc: 'Dirección física o fiscal del proveedor' },
        ],
      },
      {
        section: 'Adicional',
        desc: 'Información complementaria.',
        fields: [
          { id: 'observaciones_prov', label: 'Observaciones', desc: 'Notas internas sobre el proveedor' },
        ],
      },
    ],
    defaults: {
      nombre_prov: 'obligatorio', rif_prov: 'obligatorio', tipo_prov: 'opcional',
      telefono_prov: 'opcional', email_prov: 'opcional', sitio_web_prov: 'oculto',
      tiempo_entrega: 'opcional', terminos_prov: 'opcional', moneda_prov: 'opcional',
      direccion_prov: 'opcional', observaciones_prov: 'opcional',
    },
  },
  inventarios: {
    label: 'Inventarios',
    storageKey: 'ss-config-campos-inventarios',
    subtitle: 'Campos del formulario de creación y edición de productos.',
    sections: [
      {
        section: 'Identificación del producto',
        desc: 'Datos básicos para identificar el producto en el sistema.',
        fields: [
          { id: 'sku',       label: 'SKU / Código',  desc: 'Código único de identificación del producto' },
          { id: 'nombre_inv',label: 'Nombre',        desc: 'Nombre descriptivo del producto' },
          { id: 'marca',     label: 'Marca',         desc: 'Marca o fabricante del producto' },
          { id: 'categoria', label: 'Categoría',     desc: 'Categoría o línea de productos' },
          { id: 'descripcion',label: 'Descripción',  desc: 'Descripción detallada del producto' },
        ],
      },
      {
        section: 'Precios y costos',
        desc: 'Estructura de precios del producto.',
        fields: [
          { id: 'costo', label: 'Costo',        desc: 'Costo de adquisición en USD' },
          { id: 'base',  label: 'Precio base',  desc: 'Precio de venta base en USD antes de descuentos por lista' },
        ],
      },
      {
        section: 'Stock y almacén',
        desc: 'Parámetros de control de inventario.',
        fields: [
          { id: 'minimo',   label: 'Stock mínimo', desc: 'Cantidad mínima antes de generar alerta de reposición' },
          { id: 'maximo',   label: 'Stock máximo', desc: 'Cantidad máxima recomendada en almacén' },
          { id: 'locacion', label: 'Locación',     desc: 'Pasillo, estante o ubicación física dentro del almacén' },
        ],
      },
    ],
    defaults: {
      sku: 'obligatorio', nombre_inv: 'obligatorio', marca: 'opcional',
      categoria: 'opcional', descripcion: 'opcional',
      costo: 'obligatorio', base: 'obligatorio',
      minimo: 'opcional', maximo: 'opcional', locacion: 'oculto',
    },
  },
};

function getCamposConfigMod(modKey) {
  const mod = MODULOS_CAMPOS[modKey];
  if (!mod) return {};
  // Supabase (cargado en loadAppData) — fuente de verdad
  if (window.SSData?.camposConfig?.[modKey]) {
    return { ...mod.defaults, ...window.SSData.camposConfig[modKey] };
  }
  // fallback localStorage (antes del primer loadAppData)
  try {
    const s = localStorage.getItem(mod.storageKey);
    if (s) return { ...mod.defaults, ...JSON.parse(s) };
  } catch(e) {}
  return { ...mod.defaults };
}

window.getCamposConfig = function(modKey = 'pos') { return getCamposConfigMod(modKey); };

window.ConfigFieldsPage = function ConfigFieldsPage() {
  const [tab, setTab]   = uState('pos');
  const [saved, setSaved] = uState(false);
  const [saving, setSaving] = uState(false);
  const [showActivity, setShowActivity] = uState(false);
  const [configs, setConfigs] = uState(() => {
    const c = {};
    Object.keys(MODULOS_CAMPOS).forEach(k => { c[k] = getCamposConfigMod(k); });
    return c;
  });

  // Re-sync desde SSData cuando loadAppData termina
  uEffect(() => {
    const c = {};
    Object.keys(MODULOS_CAMPOS).forEach(k => { c[k] = getCamposConfigMod(k); });
    setConfigs(c);
  }, []);

  const mod    = MODULOS_CAMPOS[tab];
  const config = configs[tab] || {};

  function setField(id, value) {
    setConfigs(prev => ({ ...prev, [tab]: { ...prev[tab], [id]: value } }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    const { error } = await window.sb.from('campos_config')
      .upsert({
        empresa_id:  window.currentEmpresa || 'demo1',
        modulo:      tab,
        config:      configs[tab],
        updated_at:  new Date().toISOString(),
      }, { onConflict: 'empresa_id,modulo' });
    setSaving(false);
    if (error) { alert('Error al guardar: ' + error.message); return; }
    // Actualizar SSData en memoria
    if (!window.SSData.camposConfig) window.SSData.camposConfig = {};
    window.SSData.camposConfig[tab] = configs[tab];
    if (tab === 'pos') window.__ssCamposConfig = configs[tab];
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    window.logActivity?.({ modulo:'campos', accion:'editar', entidad_label: mod.label, detalles: configs[tab] });
  }

  async function handleReset() {
    const defaultConfig = { ...mod.defaults };
    setSaving(true);
    const { error } = await window.sb.from('campos_config')
      .upsert({
        empresa_id:  window.currentEmpresa || 'demo1',
        modulo:      tab,
        config:      defaultConfig,
        updated_at:  new Date().toISOString(),
      }, { onConflict: 'empresa_id,modulo' });
    setSaving(false);
    if (error) { alert('Error al restablecer: ' + error.message); return; }
    if (!window.SSData.camposConfig) window.SSData.camposConfig = {};
    window.SSData.camposConfig[tab] = defaultConfig;
    if (tab === 'pos') window.__ssCamposConfig = defaultConfig;
    setConfigs(prev => ({ ...prev, [tab]: defaultConfig }));
    window.logActivity?.({ modulo:'campos', accion:'editar', entidad_label: mod.label, detalles:{ reset:true } });
    setSaved(false);
  }

  const ESTADOS = [
    { id: 'obligatorio', label: 'Obligatorio', color: 'var(--danger)',      bg: '#fee2e2', text: '#b91c1c' },
    { id: 'opcional',    label: 'Opcional',    color: 'var(--brand)',       bg: 'var(--brand-soft)', text: 'var(--brand)' },
    { id: 'oculto',      label: 'Oculto',      color: 'var(--text-subtle)', bg: 'var(--bg-sunken)',  text: 'var(--text-muted)' },
  ];

  const totalObligatorio = Object.values(config).filter(v => v === 'obligatorio').length;
  const totalOculto      = Object.values(config).filter(v => v === 'oculto').length;
  const allFields        = mod.sections.flatMap(s => s.fields);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Campos y Validaciones</h1>
          <div className="page-subtitle">
            {mod.subtitle} ·
            <span style={{color:'var(--danger)', fontWeight:600}}> {totalObligatorio} obligatorios</span> ·
            <span style={{color:'var(--text-muted)'}}> {totalOculto} ocultos</span>
          </div>
        </div>
        <div className="page-actions">
          {window.canUser?.('editar','config_campos') !== false && (
            <button className="btn secondary" onClick={handleReset} disabled={saving}><Icon name="x" size={14}/>Restablecer</button>
          )}
          {window.canUser?.('editar','config_campos') !== false && (
            <button className="btn primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Guardando…' : saved ? <><Icon name="check" size={14}/>Guardado</> : <><Icon name="check" size={14}/>Guardar cambios</>}
            </button>
          )}
          <button className="btn ghost" onClick={() => setShowActivity(true)} title="Ver registro de actividad"><Icon name="receipt" size={14}/>Actividad</button>
        </div>
      </div>

      {showActivity && <ActivityLogModal modulo="campos" onClose={()=>setShowActivity(false)}/>}

      {/* Tabs */}
      <div style={{display:'flex', gap:4, marginBottom:20, borderBottom:'1px solid var(--border)', paddingBottom:0}}>
        {Object.entries(MODULOS_CAMPOS).map(([key, m]) => (
          <button key={key} onClick={() => { setTab(key); setSaved(false); }} style={{
            padding:'8px 16px', fontSize:13, fontWeight: tab===key ? 600 : 400,
            border:'none', background:'none', cursor:'pointer',
            borderBottom: tab===key ? '2px solid var(--brand)' : '2px solid transparent',
            color: tab===key ? 'var(--brand)' : 'var(--text-muted)',
            marginBottom:-1, transition:'color .12s',
          }}>{m.label}</button>
        ))}
      </div>

      {saved && (
        <div style={{background:'var(--success-soft)',border:'1px solid var(--success)',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:13,color:'var(--success)',display:'flex',alignItems:'center',gap:8}}>
          <Icon name="check" size={14}/> Configuración guardada para <strong>{mod.label}</strong>.
        </div>
      )}

      {/* Leyenda */}
      <div className="card" style={{padding:'12px 16px', marginBottom:16, display:'flex', alignItems:'center', gap:20, flexWrap:'wrap'}}>
        <div style={{fontSize:12.5, fontWeight:600, color:'var(--text-muted)'}}>Estados:</div>
        {ESTADOS.map(e => (
          <div key={e.id} style={{display:'flex', alignItems:'center', gap:8, fontSize:12.5}}>
            <span style={{display:'inline-block', width:10, height:10, borderRadius:3, background:e.bg, border:'1px solid '+e.color}}/>
            <strong style={{color:e.text}}>{e.label}</strong>
            <span className="muted">—</span>
            <span className="muted">
              {e.id === 'obligatorio' && 'El formulario no puede guardarse sin este campo'}
              {e.id === 'opcional'    && 'Se muestra en el formulario pero no es requerido'}
              {e.id === 'oculto'      && 'No aparece en el formulario'}
            </span>
          </div>
        ))}
      </div>

      <div style={{display:'flex', flexDirection:'column', gap:16}}>
        {mod.sections.map(sec => (
          <div className="card" key={sec.section}>
            <div className="card-header" style={{marginBottom:0}}>
              <div>
                <div className="card-title">{sec.section}</div>
                <div className="card-sub">{sec.desc}</div>
              </div>
            </div>
            <div className="card-body" style={{paddingTop:0}}>
              <div style={{borderTop:'1px solid var(--border)', marginTop:12}}>
                {sec.fields.map((f, idx) => {
                  const val = config[f.id] || 'opcional';
                  return (
                    <div key={f.id} style={{
                      display:'flex', alignItems:'center', gap:16,
                      padding:'12px 0',
                      borderBottom: idx < sec.fields.length - 1 ? '1px solid var(--border-subtle,var(--border))' : 'none',
                    }}>
                      <div style={{
                        width:4, height:36, borderRadius:2, flexShrink:0,
                        background: val==='obligatorio' ? 'var(--danger)' : val==='oculto' ? 'var(--border)' : 'var(--brand)',
                      }}/>
                      <div style={{flex:1, minWidth:0}}>
                        <div style={{fontWeight:600, fontSize:13}}>{f.label}</div>
                        <div style={{fontSize:11.5, color:'var(--text-muted)', marginTop:2}}>{f.desc}</div>
                      </div>
                      <div style={{display:'flex', gap:0, borderRadius:7, overflow:'hidden', border:'1px solid var(--border)', flexShrink:0}}>
                        {ESTADOS.map(e => (
                          <button key={e.id} onClick={() => setField(f.id, e.id)} style={{
                            padding:'6px 14px', fontSize:12, fontWeight: val===e.id ? 600 : 400,
                            background: val===e.id ? e.bg : 'transparent',
                            color: val===e.id ? e.text : 'var(--text-muted)',
                            border:'none', cursor:'pointer', whiteSpace:'nowrap',
                            transition:'background .1s, color .1s',
                          }}>{e.label}</button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Vista previa */}
      <div className="card mt-4" style={{padding:16}}>
        <div className="card-title" style={{marginBottom:12}}>Vista previa — {mod.label}</div>
        <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
          {allFields.map(f => {
            const val = config[f.id] || 'opcional';
            const e = ESTADOS.find(e => e.id === val);
            return (
              <span key={f.id} style={{
                display:'inline-flex', alignItems:'center', gap:5,
                padding:'4px 10px', borderRadius:6, fontSize:12,
                background: e.bg, color: e.text, border:'1px solid',
                borderColor: val==='obligatorio' ? 'var(--danger)' : val==='oculto' ? 'var(--border)' : 'var(--brand)',
                textDecoration: val==='oculto' ? 'line-through' : 'none',
                opacity: val==='oculto' ? 0.5 : 1,
              }}>
                {val==='obligatorio' && <span style={{fontWeight:700}}>*</span>}
                {f.label}
              </span>
            );
          })}
        </div>
        <div style={{fontSize:11.5, color:'var(--text-muted)', marginTop:10}}>
          Los campos con <strong style={{color:'var(--danger)'}}>*</strong> bloquean el guardado si están vacíos. Los tachados no aparecen en el formulario.
        </div>
      </div>
    </div>
  );
};

// ── Papelera (trash) utilities ─────────────────────────────────────────────
// Registry de handlers de restauración por tipo de entidad.
// Cada módulo registra: window.ssTrashHandlers['producto'] = async (data, item) => {...; return {ok:true}; o {error:'...'}};
window.ssTrashHandlers = window.ssTrashHandlers || {};

// Handler legacy para usuario (centralizado aquí)
window.ssTrashHandlers.usuario = async function (data) {
  // `tiene_pin` es COLUMNA GENERADA → PostgREST rechaza escribirla (428C9) y abortaría el restore.
  // Se descarta junto con created_at.
  const { created_at, tiene_pin, ...rest } = data || {};
  // FIX bug auth-colgante: el borrado de usuario va por admin-users 'delete', que
  // ELIMINA de forma PERMANENTE la cuenta auth.users (no es un ban reversible). Por eso
  // el auth_id del snapshot quedó colgante: ya no apunta a ninguna cuenta auth.
  // Restaurar la fila con ese auth_id viejo + activo:true engaña a la UI (chip
  // "Auth vinculado") y aparenta éxito, pero el usuario NO puede iniciar sesión.
  // Restauramos la fila de perfil pero SIN auth: auth_id=null + activo=false, para que
  // la UI muestre honestamente "Sin auth"/"Inactivo" y el admin re-cree credenciales
  // (contraseña / re-vinculación) por el flujo normal en vez de un acceso fantasma.
  rest.auth_id = null;
  rest.activo = false;
  const { error } = await window.sb.from('usuarios').upsert([rest], { onConflict: 'id' });
  return error ? { error: error.message } : { ok: true };
};

// Handler para driver — restaura el conductor y sus asignaciones/evidencia (driver_despachos).
window.ssTrashHandlers.driver = async function (data) {
  if (!data?.id) return { error: 'Sin ID para restaurar' };
  const { _despachos, ...drv } = data;
  const { error } = await window.saveDriver({ ...drv, activo: true });
  if (error) return { error: error.message };
  if (Array.isArray(_despachos) && _despachos.length > 0 && window.sb) {
    const { error: ddErr } = await window.sb.from('driver_despachos').insert(_despachos);
    if (ddErr && ddErr.code !== '23505') return { error: ddErr.message };
  }
  await window.loadAppData();
  return { ok: true };
};

// Handler para incidencia — restaura en Supabase
window.ssTrashHandlers.incidencia = async function (data) {
  if (!data?.id) return { error: 'Sin ID para restaurar' };
  // El snapshot de la fila puede traer objetos join `driver`/`cliente` (no son columnas de la
  // tabla incidencias) → saveIncidencia haría upsert con campos inexistentes y fallaría. Se quitan.
  const { driver, cliente, ...inc } = data;
  const { error } = await window.saveIncidencia(inc);
  if (error) return { error: error.message };
  await window.loadAppData();
  return { ok: true };
};

// Handler para devolución
window.ssTrashHandlers.devolucion = async function (data) {
  if (!data?.id) return { error: 'Sin ID para restaurar' };
  const { error } = await window.saveDev(data);
  if (error) return { error: error.message };
  await window.loadAppData();
  return { ok: true };
};

// Handler para documento (incluye sus items en _items, los S/N liberados en _serialIds y, si es una
// FACTURA anulada, los datos para revertir sus efectos colaterales: _facturaAnulada/_cxc/_invItems/_invAlmacen)
window.ssTrashHandlers.documento = async function (data) {
  if (!data?.id) return { error: 'Sin ID para restaurar' };
  // `items` NO se saca acá: es una columna real de `documentos` (el conteo de líneas), no un campo
  // meta — desestructurarla junto con `_items`/`cliente`/`lines` la perdía en TODA restauración desde
  // papelera (la lista mostraba 0 ítems aunque `documentos_items` sí se reinsertara bien abajo).
  const { _items, _serialIds, _facturaAnulada, _cxc, _invItems, _invAlmacen, cliente, lines, ...docFields } = data;
  if (window.sb) {
    // Guard previo (antes de escribir nada): si es una factura anulada cuya devolución automática
    // YA fue aprobada (emitió nota de crédito + repuso stock), restaurar la factura duplicaría la
    // contabilidad. Se aborta con error visible para que el usuario resuelva la devolución primero.
    if (_facturaAnulada) {
      const { data: devPre } = await window.sb.from('devoluciones')
        .select('id,estado').eq('factura_id', docFields.id).ilike('notas', 'Devolución automática%');
      if ((devPre || []).some(d => d.estado !== 'pendiente')) {
        return { error: 'La devolución automática de esta factura ya fue aprobada. Anúlala/revísala antes de restaurar la factura (evita doble contabilización).' };
      }
    }
    const ins = await window.sb.from('documentos').insert([docFields]);
    const yaExiste = ins.error?.code === '23505';   // el doc ya existía → restauración idempotente
    if (ins.error && !yaExiste) return { error: ins.error.message };
    if (Array.isArray(_items) && _items.length > 0) {
      await window.sb.from('documentos_items').insert(_items);
    }
    // ── Reversa de anulación de factura ────────────────────────────────────
    // Al anular se: (a) devolvió inventario (solo cantidad), (b) borró la CxC, (c) creó una
    // devolución automática. Restaurar debe deshacer esos 3 efectos. Se SALTA si el doc ya existía
    // (yaExiste) para no re-debitar inventario dos veces en un doble-restore.
    if (_facturaAnulada && !yaExiste) {
      // (a) Re-debitar SOLO cantidad (inverso exacto de 'restaurar'; no toca reservado de otras órdenes).
      if (Array.isArray(_invItems) && _invItems.length > 0 && _invAlmacen && window.ajustarInventario) {
        await window.ajustarInventario(_invItems, _invAlmacen, 'debitar_cantidad');
      }
      // (b) Recrear la(s) CxC borrada(s).
      if (Array.isArray(_cxc) && _cxc.length > 0) {
        const insCxc = await window.sb.from('cuentas_cobrar').insert(_cxc);
        if (!insCxc.error || insCxc.error.code === '23505') {
          window.SSData.cuentasCobrar = window.SSData.cuentasCobrar || [];
          _cxc.forEach(c => { if (!window.SSData.cuentasCobrar.find(x => x.id === c.id)) window.SSData.cuentasCobrar.push(c); });
        }
      }
      // (c) Borrar la devolución automática pendiente (la aprobada ya se descartó en el guard previo).
      const { data: devAuto } = await window.sb.from('devoluciones')
        .select('id,estado').eq('factura_id', docFields.id).ilike('notas', 'Devolución automática%');
      const pend = (devAuto || []).filter(d => d.estado === 'pendiente').map(d => d.id);
      if (pend.length) {
        await window.sb.from('devoluciones').delete().in('id', pend);
        if (Array.isArray(window.SSData.devoluciones)) window.SSData.devoluciones = window.SSData.devoluciones.filter(d => !pend.includes(d.id));
      }
    }
    // Re-vincular los S/N que el borrado liberó (evita que queden 'disponible' con el doc vivo).
    // Guarda anti-robo: solo re-vincular los que SIGUEN libres — si un serial fue reasignado a otra
    // venta entre el borrado y la restauración, NO se le quita a ese documento vivo.
    if (Array.isArray(_serialIds) && _serialIds.length > 0 && window.marcarSerialesVendidos) {
      const { data: cur } = await window.sb.from('inventario_seriales')
        .select('id,serial,estado,documento_id').in('id', _serialIds);
      const libres   = (cur || []).filter(s => s.estado === 'disponible' || s.documento_id == null).map(s => s.id);
      const ocupados = (cur || []).filter(s => !(s.estado === 'disponible' || s.documento_id == null));
      if (ocupados.length) console.warn('[restore documento] S/N ya reasignados a otra venta, no re-vinculados:', ocupados.map(s => s.serial));
      if (libres.length) {
        await window.marcarSerialesVendidos({
          serialIds: libres, documentoId: docFields.id,
          clienteId: docFields.cliente_id, fechaVenta: docFields.fecha,
        });
      }
    }
  }
  if (window.SSData?.documentos && !window.SSData.documentos.find(d => d.id === data.id)) {
    window.SSData.documentos.unshift({ ...docFields, cliente: docFields.cliente_id });
  }
  return { ok: true };
};

// Handler para vendedor (soft-delete restore: activo=true)
window.ssTrashHandlers.vendedor = async function (data) {
  if (!data?.id) return { error: 'Sin ID para restaurar' };
  const { error } = await window.sb.from('vendedores').update({ activo: true }).eq('id', data.id);
  if (error) return { error: error.message };
  await window.loadAppData?.();
  window.logActivity?.({ modulo: 'vendedores', accion: 'restaurar', entidad_id: data.id, entidad_label: data.nombre });
  return { ok: true };
};

// Handler para listaPrecio
window.ssTrashHandlers.listaPrecio = async function (data) {
  if (!data?.id) return { error: 'Sin ID para restaurar' };
  const empresa = window.currentEmpresa || 'demo1';
  const { error } = await window.sb.from('listas_precios').upsert([{
    id:              data.id,
    nombre:          data.nombre,
    tipo_cliente_id: data.tipo || null,
    modo:            data.modo || 'descuento',
    valor:           parseFloat(data.valor) || 0,
    empresa_id:      empresa,
  }]);
  if (error) return { error: error.message };
  if (data.modo === 'custom' && data.preciosManuales && Object.keys(data.preciosManuales).length > 0) {
    await window.saveListaDetalle?.(data.id, data.preciosManuales);
  }
  await window.loadAppData();
  return { ok: true };
};

// Handler para rol (Supabase)
window.ssTrashHandlers.rol = async function (data) {
  if (!data?.nombre) return { error: 'Sin nombre para restaurar' };
  const { _config, ...role } = data;
  if (role.id) {
    const { error } = await window.sb.from('roles').insert({
      ...role,
      empresa_id: role.empresa_id || window.currentEmpresa || 'demo1',
      permisos:   _config || {},
    });
    if (error && !error.message?.includes('duplicate') && error.code !== '23505') return { error: error.message };
    if (!window.SSData.roles) window.SSData.roles = [];
    if (!window.SSData.roles.find(r => r.nombre === role.nombre)) {
      window.SSData.roles.push({ ...role, permisos: _config || {} });
    }
  } else {
    // Un rol sin id no se puede restaurar: es de antes de que los roles vivieran en Supabase.
    // Antes se lo escribía en localStorage, y ahí nacían los roles fantasma — aparecían en la
    // pantalla de permisos aunque no existieran en la base, y editarlos no guardaba nada.
    return { error: 'Ese rol es de una versión anterior (sin id) y no se puede restaurar. Creá el rol de nuevo desde Roles y Permisos.' };
  }
  return { ok: true };
};

// Handler para marca — hard-delete: re-insertar la fila (solo se borran marcas sin productos).
window.ssTrashHandlers.marca = async function (data) {
  if (!data?.id) return { error: 'Sin ID para restaurar' };
  if (window.sb) {
    // `marcas` es per-empresa con RLS WITH CHECK empresa_id = ANY(jwt_empresas()): sin empresa_id
    // el insert lo rechaza RLS (42501). El snapshot puede no traerlo → inyectar la empresa activa.
    const ins = await window.sb.from('marcas').insert([{ ...data, empresa_id: data.empresa_id || window.currentEmpresa || 'demo1' }]);
    if (ins.error && ins.error.code !== '23505') return { error: ins.error.message };
  }
  if (window.loadMarcas) { const { data: ms } = await window.loadMarcas(); window.SSData.marcas = ms || []; }
  window.dispatchEvent(new Event('ss-data-extra-loaded'));
  return { ok: true };
};

// Handler para categoría de cuenta (CxC/CxP) — hard-delete: re-insertar la fila.
window.ssTrashHandlers.categoriaCuenta = async function (data) {
  if (!data?.id) return { error: 'Sin ID para restaurar' };
  if (window.sb) {
    const ins = await window.sb.from('categorias_cuenta').insert([data]);
    if (ins.error && ins.error.code !== '23505') return { error: ins.error.message };
  }
  if (window.SSData?.categoriasCuenta && !window.SSData.categoriasCuenta.find(c => c.id === data.id)) {
    window.SSData.categoriasCuenta.push(data);
  }
  return { ok: true };
};

// Handler para contacto (hard-delete: re-insertar)
window.ssTrashHandlers.contacto = async function (data) {
  if (!data?.id) return { error: 'Sin ID para restaurar' };
  if (window.sb) {
    const ins = await window.sb.from('contactos').insert([data]);
    if (ins.error && ins.error.code !== '23505') return { error: ins.error.message };
  }
  if (window.SSData?.contactos && !window.SSData.contactos.find(c => c.id === data.id)) {
    window.SSData.contactos.push(data);
  }
  return { ok: true };
};

// Handlers para CxC / CxP (hard-delete: re-insertar)
function _restoreCuenta(tabla, key) {
  return async function (data) {
    if (!data?.id) return { error: 'Sin ID para restaurar' };
    if (window.sb) {
      const ins = await window.sb.from(tabla).insert([data]);
      if (ins.error && ins.error.code !== '23505') return { error: ins.error.message };
    }
    const arr = window.SSData?.[key];
    if (arr && !arr.find(r => r.id === data.id)) arr.push(data);
    return { ok: true };
  };
}
window.ssTrashHandlers.cuentaCobrar   = _restoreCuenta('cuentas_cobrar',   'cuentasCobrar');
window.ssTrashHandlers.cuentaPagar    = _restoreCuenta('cuentas_pagar',    'cuentasPagar');
// cuentaBancaria: el snapshot llega ENRIQUECIDO (saldo/ingresos/egresos/porConciliar/… calculados
// que NO son columnas) → insertar el objeto crudo falla (PGRST204). Se hace whitelist de columnas.
const _CUENTA_BANCARIA_COLS = ['id','banco','cuenta','moneda','tipo','saldo','saldo_previo','titular','color','logo','empresa_id','metodos_pago','creado_por'];
window.ssTrashHandlers.cuentaBancaria = async function (data) {
  if (!data?.id) return { error: 'Sin ID para restaurar' };
  const clean = {};
  for (const k of _CUENTA_BANCARIA_COLS) if (data[k] !== undefined) clean[k] = data[k];
  if (window.sb) {
    const ins = await window.sb.from('cuentas_bancarias').insert([clean]);
    if (ins.error && ins.error.code !== '23505') return { error: ins.error.message };
  }
  const arr = window.SSData?.cuentasBancarias;
  if (arr && !arr.find(r => r.id === data.id)) arr.push(clean);
  return { ok: true };
};

// Handler para proveedor (soft-delete inverso)
window.ssTrashHandlers.proveedor = async function (data) {
  if (!data?.id) return { error: 'Sin ID para restaurar' };
  if (window.sb) {
    const { error } = await window.sb.from('proveedores').update({ activo: true }).eq('id', data.id);
    if (error) {
      if (error.code === 'PGRST116' || /no rows/i.test(error.message || '')) {
        const ins = await window.sb.from('proveedores').insert([{ ...data, activo: true }]);
        if (ins.error) return { error: ins.error.message };
      } else return { error: error.message };
    }
  }
  if (window.SSData?.proveedores && !window.SSData.proveedores.find(p => p.id === data.id)) {
    window.SSData.proveedores.push({ ...data, activo: true });
  }
  return { ok: true };
};

// Handler para proveedor de dropshipping. deleteDsProv es un hard delete y
// ds_precios.proveedor_id tiene ON DELETE CASCADE, así que restaurar implica
// re-insertar el proveedor y sus precios (snapshot guardado en data._precios).
window.ssTrashHandlers.dsProveedor = async function (data) {
  if (!data?.id) return { error: 'Sin ID para restaurar' };
  const { _precios, ...prov } = data;
  const { error } = await window.saveDsProv(prov);
  if (error) return { error: error.message };
  if (_precios && _precios.length) {
    const { error: errPrecios } = await window.bulkSaveDsPrecios(prov.id, _precios);
    if (errPrecios) return { error: errPrecios.message };
  }
  return { ok: true };
};

// Handler para orden de compra — el borrado es HARD (cabecera + ordenes_compra_items), así que hay
// que RE-INSERTAR ambos en la DB (antes solo hacía push a SSData y se perdía al recargar).
window.ssTrashHandlers.ordenCompra = async function (data) {
  if (!data?.id) return { error: 'Sin ID para restaurar' };
  // `items_count` y `proveedor` son campos CALCULADOS al cargar (no columnas) → descartarlos, o el
  // insert falla con PGRST204. `items` (jsonb) es columna real pero se re-mapea abajo.
  const { _items, items, items_count, proveedor, ...ocFields } = data;
  if (window.sb) {
    const ins = await window.sb.from('ordenes_compra').insert([{ ...ocFields, items: items || [] }]);
    if (ins.error && ins.error.code !== '23505') return { error: ins.error.message };
    if (Array.isArray(_items) && _items.length > 0) {
      const { error: itErr } = await window.sb.from('ordenes_compra_items').insert(_items);
      if (itErr && itErr.code !== '23505') return { error: itErr.message };
    }
  }
  await window.loadAppData?.();
  return { ok: true };
};

// Handler para cliente (soft-delete inverso: activo=true)
window.ssTrashHandlers.cliente = async function (data) {
  if (!data?.id) return { error: 'Sin ID para restaurar' };
  if (window.sb) {
    const { error } = await window.sb.from('clientes').update({ activo: true }).eq('id', data.id);
    if (error) {
      if (error.code === 'PGRST116' || /no rows/i.test(error.message || '')) {
        const ins = await window.sb.from('clientes').insert([{ ...data, activo: true }]);
        if (ins.error) return { error: ins.error.message };
      } else return { error: error.message };
    }
  }
  if (window.SSData?.clientes && !window.SSData.clientes.find(c => c.id === data.id)) {
    window.SSData.clientes.push({ ...data, activo: true });
  }
  return { ok: true };
};

// Handler para producto (soft-delete inverso: activo=true)
window.ssTrashHandlers.producto = async function (data) {
  if (!data?.sku) return { error: 'Sin SKU para restaurar' };
  // Reactivar en DB
  if (window.sb) {
    const { error } = await window.sb.from('productos').update({ activo: true }).eq('sku', data.sku);
    if (error) {
      // Si no existe en DB (por ej. nunca llegó a guardarse), insertarlo
      if (error.code === 'PGRST116' || /no rows/i.test(error.message || '')) {
        // `empresas` gobierna la visibilidad y la RLS de productos (ver CLAUDE.md). Un snapshot
        // viejo de papelera no la trae, y sin ella el INSERT lo rechaza la política: se rearma
        // desde el dueño del producto o la empresa activa.
        const emp = data.empresa_id || window.currentEmpresa || 'demo1';
        const empresas = (Array.isArray(data.empresas) && data.empresas.length) ? data.empresas : [emp];
        const ins = await window.sb.from('productos').insert([{ ...data, empresa_id: emp, empresas, activo: true }]);
        if (ins.error) return { error: ins.error.message };
      } else {
        return { error: error.message };
      }
    }
  }
  // Reinsertar en SSData local si fue removido
  if (window.SSData?.productos && !window.SSData.productos.find(p => p.sku === data.sku)) {
    window.SSData.productos.push({ ...data, activo: true });
  }
  return { ok: true };
};

// Handler para almacen (la entidad ya viene completa)
window.ssTrashHandlers.almacen = async function (data) {
  if (!data) return { error: 'Sin datos para restaurar' };
  // Almacenes están en SSData local + posiblemente en DB
  if (window.sb) {
    const { error } = await window.sb.from('almacenes').upsert([data], { onConflict: 'id' });
    if (error) return { error: error.message };
  }
  if (window.SSData?.almacenes && !window.SSData.almacenes.find(a => a.id === data.id)) {
    window.SSData.almacenes.push(data);
  }
  return { ok: true };
};

// ── Papelera server-side (tabla `papelera` en Supabase) ──────────────────────
// Reemplaza el localStorage. Persistencia real + compartida entre usuarios/dispositivos,
// retención de 30 días fijada server-side y purga permanente vía edge function `purge-papelera`
// + pg_cron. Se mantiene un cache en memoria (`_trashCache`) para los consumidores SÍNCRONOS
// existentes (getAll en loadUsuarios y en el render); `refresh()` lo recarga desde la tabla.
let _trashCache = [];
function _mapTrashRow(row) {
  return {
    id: row.id, tipo: row.tipo, label: row.label, data: row.data,
    deletedAt: row.deleted_at, expiresAt: row.expires_at,
    deletedBy: row.deleted_by, deletedByNombre: row.deleted_by_nombre,
  };
}
window.ssTrash = {
  // Síncrono — último snapshot cargado (compat con consumidores que no pueden await).
  getAll() { return _trashCache.slice(); },

  // Async — recarga desde la tabla (RLS filtra por empresa); no vencidos, no restaurados.
  async refresh() {
    if (!window.sb) return _trashCache;
    const { data, error } = await window.sb
      .from('papelera').select('*')
      .is('restored_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('deleted_at', { ascending: false });
    if (error) { console.warn('[papelera] refresh:', error.message); return _trashCache; }
    _trashCache = (data || []).map(_mapTrashRow);
    return _trashCache;
  },

  // Async — inserta el snapshot. Devuelve {error} si falla (NO se traga el error).
  async add(tipo, label, data) {
    if (!window.sb) return { error: 'sin conexión' };
    const { data: ins, error } = await window.sb.from('papelera').insert({
      empresa_id: window.currentEmpresa || 'demo1',
      tipo, label: label || null, data,
      deleted_by:        window.__ssCurrentUser?.id || null,
      deleted_by_nombre: window.__ssCurrentUser?.nombre || window.currentUserRole || null,
    }).select().single();
    if (error) { console.error('[papelera] add:', error.message); return { error: error.message }; }
    _trashCache.unshift(_mapTrashRow(ins));   // reflejar de inmediato en el cache síncrono
    return { ok: true, id: ins.id };
  },

  // Async — quita SOLO la entrada de papelera (usado al restaurar; no toca el registro real).
  async remove(id) {
    _trashCache = _trashCache.filter(i => i.id !== id);
    if (!window.sb) return;
    const { error } = await window.sb.from('papelera').delete().eq('id', id);
    if (error) console.warn('[papelera] remove:', error.message);
  },

  // Async — eliminación PERMANENTE: quita la papelera y hard-borra el registro real
  // (RPC guardado; conserva soft-deleted lo que tenga historial/FK).
  async purge(id) {
    _trashCache = _trashCache.filter(i => i.id !== id);
    if (!window.sb) return { error: 'sin conexión' };
    const { data, error } = await window.sb.rpc('purge_papelera', { p_scope: 'ids', p_ids: [id] });
    if (error) return { error: error.message };
    return { ok: true, result: data };
  },

  // Async — vaciar toda la papelera de la empresa (permanente).
  async clear() {
    const ids = _trashCache.map(i => i.id);
    _trashCache = [];
    if (!window.sb || ids.length === 0) return { ok: true };
    const { data, error } = await window.sb.rpc('purge_papelera', { p_scope: 'ids', p_ids: ids });
    if (error) return { error: error.message };
    return { ok: true, result: data };
  },

  // Compat: antes purgaba localStorage al abrir; ahora la purga es server-side (cron). No-op.
  purgeExpired() {},
};

// ── Papelera Page ──────────────────────────────────────────────────────────
window.PapeleraPage = function PapeleraPage() {
  const [items, setItems] = uState([]);
  const [restoring, setRestoring] = uState(null);
  const [confirmClear, setConfirmClear] = uState(false);
  const [msg, setMsg] = uState('');
  const [page, setPage] = uState(1);
  const [pageSize, setPageSize] = uState(() => {
    const v = parseInt(localStorage.getItem('ss-papelera-pagesize'));
    return [50,100,200].includes(v) ? v : 50;
  });
  uEffect(() => { localStorage.setItem('ss-papelera-pagesize', String(pageSize)); }, [pageSize]);

  const [loading, setLoading] = uState(true);
  const [detalle, setDetalle] = uState(null);   // item cuyo detalle se muestra en modal
  async function reload() {
    setLoading(true);
    await window.ssTrash.refresh();
    setItems(window.ssTrash.getAll());
    setLoading(false);
  }
  uEffect(() => { reload(); }, []);

  function flash(m) { setMsg(m); setTimeout(() => setMsg(''), 4000); }

  function daysLeft(expiresAt) {
    return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000));
  }

  async function handleRestore(item) {
    setRestoring(item.id);
    try {
      // Buscar handler registrado por tipo (window.ssTrashHandlers[tipo])
      const handler = window.ssTrashHandlers && window.ssTrashHandlers[item.tipo];
      if (handler) {
        const result = await handler(item.data, item);
        if (result && result.error) { flash('Error al restaurar: ' + result.error); setRestoring(null); return; }
      } else if (item.tipo === 'usuario') {
        // Fallback legacy para usuario (handler aún no registrado)
        const { created_at, ...rest } = item.data;
        const { error } = await window.sb.from('usuarios').upsert([rest], { onConflict: 'id' });
        if (error) { flash('Error al restaurar: ' + error.message); setRestoring(null); return; }
      }
      // logActivity (estándar #3)
      if (window.logActivity) await window.logActivity({
        modulo: item.tipo, accion: 'restaurar',
        entidad_id: item.data?.id, entidad_label: item.label || item.data?.nombre,
      });
    } catch(e) { flash('Error inesperado al restaurar.'); setRestoring(null); return; }
    await window.ssTrash.remove(item.id);
    await window.loadAppData?.();   // refresca los módulos para que el restaurado reaparezca
    await reload();
    setRestoring(null);
    setDetalle(null);
    flash('Elemento restaurado correctamente.');
  }

  async function handleDeletePermanent(item) {
    setRestoring(item.id);
    const res = await window.ssTrash.purge(item.id);   // borra papelera + hard-delete del registro real
    if (res && res.error) { flash('Error al eliminar: ' + res.error); setRestoring(null); return; }
    window.logActivity?.({ modulo:'papelera', accion:'eliminar', entidad_id:item.data?.id, entidad_label:item.label || item.data?.nombre, detalles:{ permanente:true, ...(res?.result||{}) } });
    await reload();
    setRestoring(null);
    setDetalle(null);
    const kept = res?.result?.registros_conservados_por_referencias || 0;
    flash(kept > 0 ? 'Entrada eliminada. El registro real se conservó por tener historial vinculado.' : 'Eliminado permanentemente.');
  }

  async function handleClearAll() {
    setConfirmClear(false);
    const res = await window.ssTrash.clear();
    if (res && res.error) { flash('Error al vaciar: ' + res.error); return; }
    window.logActivity?.({ modulo:'papelera', accion:'eliminar', detalles:{ vaciar_papelera:true, ...(res?.result||{}) } });
    await reload();
    flash('Papelera vaciada.');
  }

  const tipoIcon  = { usuario:'user', documento:'doc', producto:'box', cliente:'users', proveedor:'suppliers', contacto:'contact', almacen:'warehouse', dsProveedor:'truck', vendedor:'user', rol:'shield', driver:'truck', incidencia:'alert', devolucion:'refresh', listaPrecio:'price', cuentaCobrar:'cxc', cuentaPagar:'cxc', cuentaBancaria:'bank', ordenCompra:'receipt', metodoPago:'cash', categoriaCuenta:'finance', movimientoBancario:'bank', traspasoBancario:'bank' };
  const tipoColor = { usuario:'#2563eb', documento:'#047857', producto:'#7c3aed', cliente:'#b45309', proveedor:'#0369a1', contacto:'#0891b2', almacen:'#0369a1', dsProveedor:'#0369a1', vendedor:'#7c3aed', rol:'#6d28d9', driver:'#ca8a04', incidencia:'#dc2626', devolucion:'#ea580c', listaPrecio:'#059669', cuentaCobrar:'#b45309', cuentaPagar:'#b91c1c', cuentaBancaria:'#0369a1', ordenCompra:'#0369a1', metodoPago:'#16a34a', categoriaCuenta:'#475569', movimientoBancario:'#0369a1', traspasoBancario:'#0369a1' };
  const tipoLabel = { usuario:'Usuario', documento:'Documento', producto:'Producto', cliente:'Cliente', proveedor:'Proveedor', contacto:'Contacto', almacen:'Almacén', dsProveedor:'Proveedor Dropshipping', vendedor:'Vendedor', rol:'Rol', driver:'Driver', incidencia:'Incidencia', devolucion:'Devolución', listaPrecio:'Lista de precios', cuentaCobrar:'Cuenta por cobrar', cuentaPagar:'Cuenta por pagar', cuentaBancaria:'Cuenta bancaria', ordenCompra:'Orden de compra', metodoPago:'Método de pago', categoriaCuenta:'Categoría de cuenta', movimientoBancario:'Movimiento bancario', traspasoBancario:'Traspaso entre cuentas' };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Papelera</h1>
          <div className="page-subtitle">
            {loading ? 'Cargando…' : items.length === 0 ? 'Vacía' : `${items.length} elemento${items.length !== 1 ? 's' : ''}`}
            {' · '}Se eliminan permanentemente a los 30 días (purga automática server-side)
            {' · '}Click en una fila para ver el detalle
          </div>
        </div>
        {items.length > 0 && window.canUser?.('administrar','papelera') !== false && (
          <div className="page-actions">
            <button className="btn ghost" style={{color:'var(--danger)'}} onClick={() => setConfirmClear(true)}>
              <Icon name="trash" size={14}/>Vaciar papelera
            </button>
          </div>
        )}
      </div>

      {msg && (
        <div style={{background:'var(--success-soft)',border:'1px solid var(--success)',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:13,color:'var(--success)',display:'flex',alignItems:'center',gap:8}}>
          <Icon name="check" size={14}/>{msg}
        </div>
      )}

      {items.length === 0 ? (
        <div style={{textAlign:'center',padding:'60px 20px',color:'var(--text-muted)'}}>
          <div style={{fontSize:48,marginBottom:12}}>🗑️</div>
          <div style={{fontSize:15,fontWeight:500,marginBottom:6}}>La papelera está vacía</div>
          <div style={{fontSize:13}}>Los elementos eliminados aparecerán aquí durante 30 días</div>
        </div>
      ) : (
        <div className="tbl-wrap">
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Elemento</th>
                  <th>Tipo</th>
                  <th>Eliminado por</th>
                  <th>Eliminado</th>
                  <th>Expira</th>
                  <th style={{textAlign:'right'}}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {items.slice((page-1)*pageSize, page*pageSize).map(item => {
                  const dl = daysLeft(item.expiresAt);
                  const color = tipoColor[item.tipo] || 'var(--brand)';
                  return (
                    <tr key={item.id} onClick={() => setDetalle(item)} style={{cursor:'pointer'}}>
                      <td>
                        <div style={{display:'flex',alignItems:'center',gap:10}}>
                          <div style={{width:34,height:34,borderRadius:8,background:color+'18',color,display:'grid',placeItems:'center',flexShrink:0}}>
                            <Icon name={tipoIcon[item.tipo]||'doc'} size={16}/>
                          </div>
                          <div>
                            <div style={{fontWeight:500}}>{item.label}</div>
                            {item.tipo === 'usuario' && item.data?.email && (
                              <div style={{fontSize:11,color:'var(--text-muted)',fontFamily:'var(--mono)'}}>{item.data.email}</div>
                            )}
                            {item.tipo === 'usuario' && item.data?.rol && (
                              <div style={{fontSize:11,color:'var(--text-muted)'}}>{item.data.rol}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="chip" style={{background:color+'18',color,fontSize:11.5}}>
                          {tipoLabel[item.tipo]||item.tipo}
                        </span>
                      </td>
                      <td className="muted hide-sm" style={{fontSize:12.5}}>
                        {item.deletedByNombre || '—'}
                      </td>
                      <td className="muted" style={{fontSize:12.5}}>
                        {new Date(item.deletedAt).toLocaleDateString('es-VE',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'America/Caracas'})}
                      </td>
                      <td>
                        <span style={{fontSize:12,fontWeight:500,color: dl <= 3 ? 'var(--danger)' : dl <= 7 ? 'var(--warn)' : 'var(--text-muted)'}}>
                          {dl === 0 ? 'Hoy' : `${dl} día${dl !== 1 ? 's' : ''}`}
                        </span>
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
                          {window.canUser?.('administrar','papelera') !== false && (
                            <button
                              className="btn ghost sm"
                              style={{color:'var(--brand)'}}
                              onClick={() => handleRestore(item)}
                              disabled={restoring === item.id}
                              title="Restaurar"
                            >
                              <Icon name="check" size={13}/>
                              {restoring === item.id ? 'Restaurando…' : 'Restaurar'}
                            </button>
                          )}
                          {window.canUser?.('administrar','papelera') !== false && (
                            <button
                              className="icon-btn"
                              style={{color:'var(--danger)'}}
                              onClick={() => handleDeletePermanent(item)}
                              title="Eliminar permanentemente"
                            >
                              <Icon name="trash" size={13}/>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(() => {
            const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
            return (
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px',borderTop:'1px solid var(--border)',fontSize:12,gap:10,flexWrap:'wrap'}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span className="muted">Filas por página:</span>
                  <select className="select" value={pageSize} onChange={e=>{setPageSize(parseInt(e.target.value));setPage(1);}} style={{fontSize:12,padding:'3px 6px'}}>
                    {[50,100,200].map(n=><option key={n} value={n}>{n}</option>)}
                  </select>
                  <span className="muted">{items.length===0?'0':`Mostrando ${(page-1)*pageSize+1}–${Math.min(page*pageSize,items.length)} de ${items.length}`}</span>
                </div>
                {totalPages>1&&<div style={{display:'flex',gap:4}}>
                  <button className="btn ghost sm" disabled={page===1} onClick={()=>setPage(p=>p-1)}><Icon name="chevronL" size={13}/></button>
                  {Array.from({length:Math.min(5,totalPages)},(_,i)=>Math.max(1,Math.min(totalPages-4,page-2))+i).filter(p=>p>=1&&p<=totalPages).map(p=>(
                    <button key={p} className={'btn sm '+(p===page?'primary':'ghost')} style={{minWidth:32}} onClick={()=>setPage(p)}>{p}</button>
                  ))}
                  <button className="btn ghost sm" disabled={page===totalPages} onClick={()=>setPage(p=>p+1)}><Icon name="chevronR" size={13}/></button>
                </div>}
              </div>
            );
          })()}
        </div>
      )}

      {/* Confirm vaciar papelera */}
      {confirmClear && (
        <div className="modal-overlay" onClick={() => setConfirmClear(false)}>
          <div className="modal" style={{maxWidth:400}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{margin:0}}>¿Vaciar papelera?</h3>
              <button className="icon-btn" onClick={() => setConfirmClear(false)}><Icon name="x" size={16}/></button>
            </div>
            <div style={{padding:'16px 24px',fontSize:13.5,color:'var(--text-muted)',lineHeight:1.6}}>
              Se eliminarán permanentemente <strong style={{color:'var(--text)'}}>{items.length} elemento{items.length !== 1 ? 's' : ''}</strong>.
              Esta acción no se puede deshacer.
            </div>
            <div className="modal-footer">
              <button className="btn secondary" onClick={() => setConfirmClear(false)}>Cancelar</button>
              <button className="btn ghost" style={{color:'var(--danger)'}} onClick={handleClearAll}>
                <Icon name="trash" size={14}/>Vaciar todo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detalle completo del elemento eliminado */}
      {detalle && (
        <PapeleraDetalleModal
          item={detalle}
          tipoLabel={tipoLabel[detalle.tipo] || detalle.tipo}
          tipoColor={tipoColor[detalle.tipo] || 'var(--brand)'}
          tipoIcon={tipoIcon[detalle.tipo] || 'doc'}
          daysLeft={daysLeft(detalle.expiresAt)}
          canManage={window.canUser?.('administrar','papelera') !== false}
          restoring={restoring === detalle.id}
          onRestore={() => handleRestore(detalle)}
          onDeletePermanent={() => handleDeletePermanent(detalle)}
          onClose={() => setDetalle(null)}
        />
      )}
    </div>
  );
};

// ── Modal de detalle de un elemento en la papelera ───────────────────────────
// Muestra TODOS los campos del snapshot (item.data) + hijos (arrays anidados) +
// quién/cuándo eliminó + días restantes, y permite restaurar / eliminar permanente.
function PapeleraDetalleModal({ item, tipoLabel, tipoColor, tipoIcon, daysLeft, canManage, restoring, onRestore, onDeletePermanent, onClose }) {
  const data = item.data || {};
  // Campos internos que no aportan al detalle de negocio.
  const OCULTOS = new Set(['created_at','updated_at','empresa_id','empresas','_config']);
  const esHijos = v => Array.isArray(v) && v.length > 0 && typeof v[0] === 'object';
  const fmtVal = v => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };
  const campos = Object.entries(data).filter(([k,v]) => !OCULTOS.has(k) && !esHijos(v));
  const hijos  = Object.entries(data).filter(([k,v]) => esHijos(v));
  const fechaFull = new Date(item.deletedAt).toLocaleString('es-VE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'America/Caracas'});

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{width:640, maxHeight:'90vh', display:'flex', flexDirection:'column'}}>
        <div className="modal-header">
          <div style={{width:40,height:40,borderRadius:10,background:tipoColor+'18',color:tipoColor,display:'grid',placeItems:'center'}}>
            <Icon name={tipoIcon} size={20}/>
          </div>
          <div style={{flex:1, minWidth:0}}>
            <h3 className="modal-title" style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{item.label || data.nombre || item.tipo}</h3>
            <div className="small"><span className="chip" style={{background:tipoColor+'18',color:tipoColor,fontSize:11}}>{tipoLabel}</span></div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        <div className="modal-body" style={{flex:1, overflowY:'auto'}}>
          {/* Metadata de la eliminación */}
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:10, marginBottom:16}}>
            <div><div className="small muted">Eliminado por</div><div style={{fontWeight:500, fontSize:13}}>{item.deletedByNombre || '—'}</div></div>
            <div><div className="small muted">Fecha de eliminación</div><div style={{fontWeight:500, fontSize:13}}>{fechaFull}</div></div>
            <div><div className="small muted">Se elimina permanentemente en</div><div style={{fontWeight:600, fontSize:13, color: daysLeft<=3?'var(--danger)':daysLeft<=7?'var(--warn)':'var(--text)'}}>{daysLeft===0?'Hoy':`${daysLeft} día${daysLeft!==1?'s':''}`}</div></div>
          </div>

          {/* Todos los campos del registro */}
          <div className="form-section-title" style={{marginTop:0}}>Detalle del registro</div>
          <div className="card" style={{padding:0, overflow:'hidden'}}>
            <table className="tbl">
              <tbody>
                {campos.map(([k,v]) => (
                  <tr key={k}>
                    <td className="muted" style={{fontSize:12, width:'38%', verticalAlign:'top'}}>{k}</td>
                    <td style={{fontSize:12.5, wordBreak:'break-word'}}>{fmtVal(v)}</td>
                  </tr>
                ))}
                {campos.length === 0 && <tr><td className="empty" colSpan={2}>Sin campos</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Hijos (ítems de documento, precios ds, etc.) */}
          {hijos.map(([k, arr]) => (
            <div key={k} style={{marginTop:16}}>
              <div className="form-section-title" style={{margin:'0 0 6px'}}>{k} <span className="small muted">({arr.length})</span></div>
              <div className="card" style={{padding:0, overflow:'auto'}}>
                <table className="tbl">
                  <thead><tr>{Object.keys(arr[0]).slice(0,6).map(col => <th key={col} style={{fontSize:11}}>{col}</th>)}</tr></thead>
                  <tbody>
                    {arr.slice(0,50).map((h,i) => (
                      <tr key={i}>{Object.keys(arr[0]).slice(0,6).map(col => <td key={col} style={{fontSize:12}}>{fmtVal(h[col])}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {arr.length > 50 && <div className="small muted" style={{marginTop:4}}>Mostrando 50 de {arr.length}</div>}
            </div>
          ))}
        </div>

        {canManage && (
          <div className="modal-footer" style={{justifyContent:'space-between'}}>
            <button className="btn ghost" style={{color:'var(--danger)'}} disabled={restoring} onClick={onDeletePermanent}>
              <Icon name="trash" size={14}/>Eliminar permanentemente
            </button>
            <button className="btn primary" disabled={restoring} onClick={onRestore}>
              <Icon name="check" size={14}/>{restoring ? 'Procesando…' : 'Restaurar'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Almacenes Config ───────────────────────────────────────────────────────
// Scoped per empresa (multi-tenant). Migra automáticamente keys legacy globales
// la primera vez que se accede.
function _empresaActiva()   { return window.currentEmpresa || 'demo1'; }
function _almKey()          { return 'ss-almacenes-extra-' + _empresaActiva(); }
function _almEditKey()      { return 'ss-almacenes-edits-' + _empresaActiva(); }
const ALMACENES_KEY      = _almKey();      // referencia inicial; siempre usar la fn
const ALMACENES_EDIT_KEY = _almEditKey();

// Limpiar keys legacy globales y cualquier extra residual sin empresa_id.
// La verdad ahora vive en SSData.almacenes (DB filtrado por empresa).
(function cleanLegacyAlmacenes(){
  try {
    localStorage.removeItem('ss-almacenes-extra');
    localStorage.removeItem('ss-almacenes-edits');
  } catch(e) {}
})();

// Redistribuir extras: barre TODAS las keys 'ss-almacenes-extra-*' y mueve
// cada entrada a la key de la empresa que figura en su empresa_id.
// Si una entrada no tiene empresa_id, se la queda la key actual (legacy).
window.redistribuirAlmacenesExtras = function() {
  try {
    const allKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('ss-almacenes-extra-')) allKeys.push(k);
    }
    // Acumular por empresa
    const buckets = {};
    for (const k of allKeys) {
      const keyEmp = k.replace('ss-almacenes-extra-', '');
      let arr = [];
      try { arr = JSON.parse(localStorage.getItem(k) || '[]'); } catch(e) {}
      for (const a of arr) {
        const dest = a.empresa_id || keyEmp;
        if (!buckets[dest]) buckets[dest] = [];
        buckets[dest].push({ ...a, empresa_id: dest });
      }
    }
    // Reescribir cada key con su contenido correcto
    for (const k of allKeys) {
      const keyEmp = k.replace('ss-almacenes-extra-', '');
      const items = buckets[keyEmp] || [];
      // Dedup por id (por si quedó duplicado entre keys)
      const seen = new Set();
      const dedup = items.filter(a => seen.has(a.id) ? false : (seen.add(a.id), true));
      localStorage.setItem(k, JSON.stringify(dedup));
    }
    // Crear keys destino que aún no existen
    for (const emp of Object.keys(buckets)) {
      const k = 'ss-almacenes-extra-' + emp;
      if (!allKeys.includes(k)) {
        const seen = new Set();
        const dedup = buckets[emp].filter(a => seen.has(a.id) ? false : (seen.add(a.id), true));
        localStorage.setItem(k, JSON.stringify(dedup));
      }
    }
  } catch(e) {}
};

// Ejecutar redistribución al cargar el módulo
window.redistribuirAlmacenesExtras();

// Helper: stamp empresa_id en extras legacy y descartar los que no aplican.
// Una entrada sin empresa_id es legacy; le asignamos la empresa de la key
// (porque la key sí está scopeada por empresa).
window.purgeAlmacenesExtrasInvalidos = function() {
  try {
    const e = _empresaActiva();
    const extras = JSON.parse(localStorage.getItem(_almKey()) || '[]');
    const stamped = extras.map(a => a.empresa_id ? a : { ...a, empresa_id: e });
    const validos = stamped.filter(a => a.empresa_id === e);
    if (JSON.stringify(extras) !== JSON.stringify(validos)) {
      localStorage.setItem(_almKey(), JSON.stringify(validos));
    }
    return extras.length - validos.length;
  } catch(e) { return 0; }
};

// Orden de los almacenes: manda la operación, no el alfabeto. La consulta arranca por el
// Principal, sigue por la tienda y después Terrazas; lo que no esté acá queda detrás, en el
// orden en que vino (`almacenes` se pide con `.order('nombre')`).
// Se ordena en `getAlmacenes` porque es la ÚNICA fuente del orden: con esto quedan alineadas
// las columnas de la tabla de Inventario, el export a XLSX, los selectores y la ficha del
// producto. Ordenar solo en la tabla las habría dejado en órdenes distintos entre sí.
// Los ids son los del mapeo de la migración (ver migracion-odoo/RUNBOOK.md §3 "Mapeos fijos");
// se usa el id y no el nombre porque el nombre se puede editar desde Ajustes.
const ALMACEN_ORDEN = ['alm-alp', 'alm-alt', 'alm-avila'];
function _rankAlmacen(a) {
  const i = ALMACEN_ORDEN.indexOf(a.id);
  return i === -1 ? ALMACEN_ORDEN.length : i;   // los no listados, todos al final
}
// `sort` es estable desde ES2019 (target del build: es2020), así que los que empatan en rango
// conservan el orden que traían.
const _ordenarAlmacenes = (lista) => lista.slice().sort((x, y) => _rankAlmacen(x) - _rankAlmacen(y));

window.getAlmacenes = function() {
  const empresa = _empresaActiva();
  let base = SSData.almacenes.map(a => ({ ...a, _origin: 'base' }));
  try {
    const edits = JSON.parse(localStorage.getItem(_almEditKey()) || '{}');
    base = base.map(a => edits[a.id] ? { ...a, ...edits[a.id] } : a).filter(a => !edits[a.id]?._deleted);
    const extras = JSON.parse(localStorage.getItem(_almKey()) || '[]')
      .filter(a => a.empresa_id === empresa); // ESTRICTO: solo extras de esta empresa
    return _ordenarAlmacenes([...base, ...extras.map(a => ({ ...a, _origin: 'user' }))]);
  } catch(e) { return _ordenarAlmacenes(base); }
};

const LOCACIONES_KEY = 'ss-locaciones';

window.getLocaciones = function(almacenId) {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCACIONES_KEY) || '{}');
    if (saved[almacenId] !== undefined) return saved[almacenId];
  } catch(e) {}
  return (SSData.locaciones && SSData.locaciones[almacenId]) ? [...SSData.locaciones[almacenId]] : [];
};

function saveLocacionesForAlmacen(almacenId, locs) {
  try {
    const all = JSON.parse(localStorage.getItem(LOCACIONES_KEY) || '{}');
    all[almacenId] = locs;
    localStorage.setItem(LOCACIONES_KEY, JSON.stringify(all));
  } catch(e) {}
}

window.ConfigAlmacenesPage = function ConfigAlmacenesPage() {
  // Purgar extras residuales de otras empresas antes de leer la lista
  if (window.purgeAlmacenesExtrasInvalidos) window.purgeAlmacenesExtrasInvalidos();
  const [almacenes, setAlmacenes]     = uState(() => window.getAlmacenes());
  const [showModal, setShowModal]     = uState(false);
  const [showActivity, setShowActivity] = uState(false);
  const [editing, setEditing]         = uState(null);
  const [deleteConfirm, setDeleteConfirm] = uState(null);
  const [msg, setMsg]                 = uState('');
  const [form, setForm]               = uState({ nombre: '', tipo: 'almacen', direccion: '' });
  const [expandedId, setExpandedId]   = uState(null);  // which almacén has locaciones open
  const [locsState, setLocsState]     = uState({});     // { [almacenId]: string[] } — live edits
  const [newLoc, setNewLoc]           = uState('');     // input for adding
  const [copiedId, setCopiedId]       = uState(null);

  function flash(m) { setMsg(m); setTimeout(() => setMsg(''), 3500); }
  function reload() { setAlmacenes(window.getAlmacenes()); }

  function getLocs(almacenId) {
    return locsState[almacenId] !== undefined
      ? locsState[almacenId]
      : window.getLocaciones(almacenId);
  }

  function toggleExpand(almacenId) {
    if (expandedId === almacenId) {
      setExpandedId(null);
    } else {
      // Load current locs into local state for editing
      setLocsState(prev => ({ ...prev, [almacenId]: window.getLocaciones(almacenId) }));
      setExpandedId(almacenId);
      setNewLoc('');
    }
  }

  function addLoc(almacenId) {
    const val = newLoc.trim();
    if (!val) return;
    const parts = val.split(',').map(s => s.trim()).filter(Boolean);
    const current = getLocs(almacenId);
    const toAdd = parts.filter(p => !current.includes(p));
    if (!toAdd.length) { setNewLoc(''); return; }
    const updated = [...current, ...toAdd];
    setLocsState(prev => ({ ...prev, [almacenId]: updated }));
    saveLocacionesForAlmacen(almacenId, updated);
    setNewLoc('');
    flash(`${toAdd.length > 1 ? toAdd.length + ' locaciones añadidas' : '"' + toAdd[0] + '" añadida'}.`);
  }

  function removeLoc(almacenId, loc) {
    const updated = getLocs(almacenId).filter(l => l !== loc);
    setLocsState(prev => ({ ...prev, [almacenId]: updated }));
    saveLocacionesForAlmacen(almacenId, updated);
  }

  function copyId(id) {
    try { navigator.clipboard.writeText(id); } catch(e) {}
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  }

  function openCreate() {
    setEditing(null);
    setForm({ nombre: '', tipo: 'almacen', direccion: '' });
    setShowModal(true);
  }

  function openEdit(a) {
    setEditing(a);
    setForm({ nombre: a.nombre, tipo: a.tipo, direccion: a.direccion || '' });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.nombre.trim()) return;
    if (editing) {
      const { error } = await window.sb.from('almacenes')
        .update({ nombre: form.nombre, tipo: form.tipo, direccion: form.direccion })
        .eq('id', editing.id);
      if (error) { alert('Error al actualizar: ' + error.message); return; }
      window.logActivity?.({ modulo:'almacenes', accion:'editar', entidad_id:editing.id, entidad_label:form.nombre, detalles:{ tipo:form.tipo, direccion:form.direccion } });
      flash('Almacén actualizado.');
    } else {
      const newId = 'alm-' + Date.now();
      const { data, error } = await window.sb.from('almacenes')
        .insert([{ id: newId, nombre: form.nombre, tipo: form.tipo, direccion: form.direccion, empresa_id: _empresaActiva() }])
        .select().single();
      if (error) { alert('Error al crear: ' + error.message); return; }
      window.logActivity?.({ modulo:'almacenes', accion:'crear', entidad_id:data.id, entidad_label:form.nombre, detalles:{ tipo:form.tipo } });
      flash('Almacén creado.');
    }
    setShowModal(false);
    await window.loadAppData();
    reload();
  }

  async function moverEmpresa(a) {
    const all = window.__ssEmpresasCache || (await window.loadEmpresas?.()) || [];
    window.__ssEmpresasCache = all;
    const empresas = all.filter(e => e.id !== _empresaActiva());
    if (empresas.length === 0) { alert('No hay otras empresas configuradas.'); return; }
    const opciones = empresas.map((e, i) => `${i + 1}. ${e.nombre} (${e.id})`).join('\n');
    const sel = prompt(`Mover «${a.nombre}» a otra empresa:\n\n${opciones}\n\nIngresa el número:`);
    if (!sel) return;
    const idx = parseInt(sel) - 1;
    if (isNaN(idx) || idx < 0 || idx >= empresas.length) { alert('Selección inválida.'); return; }
    const destEmp = empresas[idx].id;
    const { error } = await window.sb.from('almacenes').update({ empresa_id: destEmp }).eq('id', a.id);
    if (error) { alert('Error al mover: ' + error.message); return; }
    window.logActivity?.({ modulo:'almacenes', accion:'editar', entidad_id:a.id, entidad_label:a.nombre, detalles:{ accion:'mover_empresa', desde:_empresaActiva(), hacia:destEmp } });
    await window.loadAppData();
    reload();
    flash(`«${a.nombre}» movido a ${empresas[idx].nombre}.`);
  }

  async function handleDelete(a) {
    const { error } = await window.sb.from('almacenes').delete().eq('id', a.id);
    if (error) { alert('No se pudo eliminar: ' + error.message); return; }
    window.ssTrash.add('almacen', a.nombre, a);
    window.logActivity?.({ modulo:'almacenes', accion:'eliminar', entidad_id:a.id, entidad_label:a.nombre });
    setDeleteConfirm(null);
    if (expandedId === a.id) setExpandedId(null);
    await window.loadAppData();
    reload();
    flash('Almacén enviado a la papelera.');
  }

  const tipoLabel = { almacen: 'Almacén', sucursal: 'Sucursal', showroom: 'Showroom', deposito: 'Depósito' };
  const tipoIcon  = { almacen: 'warehouse', sucursal: 'home', showroom: 'home', deposito: 'warehouse' };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Almacenes</h1>
          <div className="page-subtitle">{almacenes.length} almacén{almacenes.length !== 1 ? 'es' : ''} · {almacenes.reduce((s,a) => s + getLocs(a.id).length, 0)} locaciones en total</div>
        </div>
        <div className="page-actions">
          {window.canUser?.('editar','config_almacenes') !== false && (
            <button className="btn primary" onClick={openCreate}><Icon name="plus" size={14}/>Nuevo almacén</button>
          )}
          <button className="btn ghost" onClick={() => setShowActivity(true)} title="Ver registro de actividad"><Icon name="receipt" size={14}/>Actividad</button>
        </div>
      </div>

      {showActivity && <ActivityLogModal modulo="almacenes" onClose={()=>setShowActivity(false)}/>}

      {msg && (
        <div style={{background:'var(--success-soft)',border:'1px solid var(--success)',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:13,color:'var(--success)',display:'flex',alignItems:'center',gap:8}}>
          <Icon name="check" size={14}/>{msg}
        </div>
      )}

      <div style={{display:'flex', flexDirection:'column', gap:12}}>
        {almacenes.map(a => {
          const icon    = tipoIcon[a.tipo] || 'warehouse';
          const locs    = getLocs(a.id);
          const isOpen  = expandedId === a.id;
          const copied  = copiedId === a.id;

          return (
            <div key={a.id} className="card almacen-card" style={{padding:0, overflow:'hidden'}}>
              {/* Card header row */}
              <div className="almacen-card-row" style={{display:'flex', alignItems:'center', gap:16, padding:'16px 20px'}}>
                <div style={{width:44, height:44, borderRadius:10, background:'var(--brand-soft)', color:'var(--brand)', display:'grid', placeItems:'center', flexShrink:0}}>
                  <Icon name={icon} size={20}/>
                </div>

                <div style={{flex:1, minWidth:0}}>
                  <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:3}}>
                    <span style={{fontWeight:700, fontSize:14}}>{a.nombre}</span>
                    <span className="chip neutral" style={{fontSize:11}}>{tipoLabel[a.tipo] || a.tipo}</span>
                    {a._origin === 'user' && <span className="chip blue" style={{fontSize:10}}>Personalizado</span>}
                    {/* ID badge — always visible */}
                    <span style={{
                      display:'inline-flex', alignItems:'center', gap:5,
                      background:'var(--bg-sunken)', border:'1px solid var(--border)',
                      borderRadius:6, padding:'2px 8px', fontSize:11, fontFamily:'var(--font-mono)', color:'var(--text-2)',
                    }}>
                      ID: {a.id}
                      <button
                        onClick={() => copyId(a.id)}
                        title="Copiar ID"
                        style={{background:'none', border:'none', cursor:'pointer', padding:0, display:'flex', alignItems:'center', color: copied ? 'var(--success)' : 'var(--text-muted)'}}
                      >
                        <Icon name={copied ? 'check' : 'link'} size={11}/>
                      </button>
                    </span>
                  </div>
                  <div style={{fontSize:12.5, color:'var(--text-muted)'}}>
                    {a.direccion || 'Sin dirección'}
                    <span style={{marginLeft:10, color: locs.length > 0 ? 'var(--text-2)' : 'var(--text-muted)'}}>
                      · {locs.length} locación{locs.length !== 1 ? 'es' : ''}
                    </span>
                  </div>
                </div>

                <div className="almacen-card-actions" style={{display:'flex', gap:8, flexShrink:0}}>
                  <button
                    className={'btn sm ' + (isOpen ? 'primary' : 'secondary')}
                    onClick={() => toggleExpand(a.id)}
                    title="Gestionar locaciones"
                  >
                    <Icon name="link" size={13}/>Locaciones
                    <Icon name={isOpen ? 'chevronU' : 'chevronD'} size={12}/>
                  </button>
                  {window.canUser?.('editar','config_almacenes') !== false && (
                    <button className="btn secondary sm" onClick={() => openEdit(a)}>
                      <Icon name="edit" size={13}/>Editar
                    </button>
                  )}
                  {a._origin === 'user' && window.canUser?.('administrar','config_almacenes') !== false && (
                    <button className="btn ghost sm" onClick={() => moverEmpresa(a)} title="Reasignar a otra empresa">
                      <Icon name="truck" size={13}/>Mover
                    </button>
                  )}
                  {window.canUser?.('editar','config_almacenes') !== false && (
                    <button className="btn ghost sm" style={{color:'var(--danger)'}} onClick={() => setDeleteConfirm(a)}>
                      <Icon name="trash" size={13}/>
                    </button>
                  )}
                </div>
              </div>

              {/* Locaciones panel — inline expandable */}
              {isOpen && (
                <div style={{borderTop:'1px solid var(--border)', background:'var(--bg-sunken)', padding:'16px 20px'}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
                    <div>
                      <span style={{fontWeight:600, fontSize:13}}>Locaciones del almacén</span>
                      <span className="small muted" style={{marginLeft:8}}>
                        Usadas en inventario y plantilla de importación. Para este almacén usa ID: <strong style={{fontFamily:'var(--font-mono)'}}>{a.id}</strong>
                      </span>
                    </div>
                  </div>

                  {/* Current locations as chips */}
                  {locs.length === 0 && (
                    <div style={{fontSize:13, color:'var(--text-muted)', marginBottom:12, fontStyle:'italic'}}>
                      Sin locaciones definidas. Añade locaciones abajo para usarlas en inventario.
                    </div>
                  )}
                  {locs.length > 0 && (
                    <div style={{display:'flex', flexWrap:'wrap', gap:6, marginBottom:14}}>
                      {locs.map(loc => (
                        <span key={loc} style={{
                          display:'inline-flex', alignItems:'center', gap:5,
                          background:'var(--bg-elev)', border:'1px solid var(--border)',
                          borderRadius:6, padding:'4px 10px', fontSize:12, fontFamily:'var(--font-mono)',
                        }}>
                          {loc}
                          {window.canUser?.('editar','config_almacenes') !== false && (
                            <button
                              onClick={() => removeLoc(a.id, loc)}
                              style={{background:'none', border:'none', cursor:'pointer', padding:0, display:'flex', alignItems:'center', color:'var(--text-muted)', lineHeight:1}}
                              title={'Eliminar ' + loc}
                            >
                              <Icon name="x" size={11}/>
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Add location input */}
                  {window.canUser?.('editar','config_almacenes') !== false && (
                    <div style={{display:'flex', gap:8, alignItems:'flex-start'}}>
                      <div style={{flex:1}}>
                        <input
                          className="input"
                          style={{width:'100%', fontFamily:'var(--font-mono)', boxSizing:'border-box'}}
                          placeholder="Ej: A-01-01 · Separa con comas para añadir varias: A-01, A-02, B-01"
                          value={newLoc}
                          onChange={e => setNewLoc(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLoc(a.id); } }}
                        />
                        <div style={{fontSize:11, color:'var(--text-muted)', marginTop:4}}>
                          Puedes añadir varias a la vez separando con comas. Presiona Enter o haz clic en Añadir.
                        </div>
                      </div>
                      <button
                        className="btn primary"
                        disabled={!newLoc.trim()}
                        onClick={() => addLoc(a.id)}
                      >
                        <Icon name="plus" size={14}/>Añadir
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {almacenes.length === 0 && (
          <div style={{textAlign:'center', padding:'48px 20px', color:'var(--text-muted)'}}>
            <Icon name="warehouse" size={32}/>
            <div style={{marginTop:12, fontSize:14}}>No hay almacenes configurados</div>
            {window.canUser?.('editar','config_almacenes') !== false && (
              <button className="btn primary mt-3" onClick={openCreate}><Icon name="plus" size={14}/>Crear primer almacén</button>
            )}
          </div>
        )}
      </div>

      {/* Modal crear/editar almacén */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" style={{maxWidth:500}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{editing ? 'Editar almacén' : 'Nuevo almacén'}</h3>
              <button className="icon-btn" onClick={() => setShowModal(false)}><Icon name="x" size={16}/></button>
            </div>
            <div className="modal-body">
              <div className="mt-2">
                <label className="form-label">Nombre <span style={{color:'var(--danger)'}}>*</span></label>
                <input className="input" style={{width:'100%'}} placeholder="Ej: Almacén Principal" value={form.nombre} onChange={e => setForm({...form, nombre: e.target.value})}/>
              </div>
              <div className="mt-3">
                <label className="form-label">Tipo</label>
                <select className="select" style={{width:'100%'}} value={form.tipo} onChange={e => setForm({...form, tipo: e.target.value})}>
                  <option value="almacen">Almacén</option>
                  <option value="sucursal">Sucursal</option>
                  <option value="showroom">Showroom</option>
                  <option value="deposito">Depósito</option>
                </select>
              </div>
              <div className="mt-3">
                <label className="form-label">Dirección</label>
                <input className="input" style={{width:'100%'}} placeholder="Av. Principal, Local 1, Caracas" value={form.direccion} onChange={e => setForm({...form, direccion: e.target.value})}/>
              </div>
              {editing && (
                <div style={{marginTop:16, padding:'10px 14px', background:'var(--bg-sunken)', borderRadius:8, fontSize:12, color:'var(--text-muted)'}}>
                  ID del almacén: <strong style={{fontFamily:'var(--font-mono)', color:'var(--text-2)'}}>{editing.id}</strong>
                  · Las locaciones se gestionan desde la tarjeta principal.
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn ghost" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn primary" disabled={!form.nombre.trim()} onClick={handleSave}>
                <Icon name="check" size={14}/>{editing ? 'Guardar cambios' : 'Crear almacén'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" style={{maxWidth:420}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{margin:0}}>¿Eliminar almacén?</h3>
              <button className="icon-btn" onClick={() => setDeleteConfirm(null)}><Icon name="x" size={16}/></button>
            </div>
            <div style={{padding:'16px 24px', fontSize:13.5, color:'var(--text-muted)', lineHeight:1.6}}>
              Se enviará <strong style={{color:'var(--text)'}}>{deleteConfirm.nombre}</strong> a la papelera.
              Tendrás 30 días para restaurarlo.
            </div>
            <div className="modal-footer">
              <button className="btn secondary" onClick={() => setDeleteConfirm(null)}>Cancelar</button>
              <button className="btn ghost" style={{color:'var(--danger)'}} onClick={() => handleDelete(deleteConfirm)}>
                <Icon name="trash" size={14}/>Enviar a papelera
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

Object.assign(window, {
  ConfigUsersPage:     window.ConfigUsersPage,
  ConfigRolesPage:     window.ConfigRolesPage,
  ConfigSystemPage:    window.ConfigSystemPage,
  ConfigFieldsPage:    window.ConfigFieldsPage,
  PapeleraPage:        window.PapeleraPage,
  ConfigAlmacenesPage: window.ConfigAlmacenesPage,
  ssTrash:             window.ssTrash,
  getCamposConfig:     window.getCamposConfig,
  getEmpresaConfig:    window.getEmpresaConfig,
  getAlmacenes:        window.getAlmacenes,
  getLocaciones:       window.getLocaciones,
  getRolesList:        window.getRolesList,
  getRolesConfig:      window.getRolesConfig,
  getRolePerms:        window.getRolePerms,
  canUser:             window.canUser,
});
