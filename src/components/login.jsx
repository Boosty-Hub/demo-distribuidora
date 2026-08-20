// Login — branded landing → choose between email/password or email+PIN
window.LoginPage = function LoginPage({ onLogin }) {
  const { useState, useEffect, useRef } = React;

  // mode: 'choose' | 'email' | 'pin'
  const [mode, setMode] = useState('choose');

  // Email + password
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError]     = useState('');
  const [showPass, setShowPass]         = useState(false);
  const emailRef = useRef(null);

  // PIN only
  const [pin, setPin]             = useState('');
  const [pinError, setPinError]   = useState('');
  const [checking, setChecking]   = useState(false);
  const [loadingApp, setLoadingApp] = useState(false);
  const [shake, setShake]         = useState(false);
  const pinRef = useRef('');

  // Inject shake keyframe once
  useEffect(() => {
    if (!document.getElementById('ss-pin-shake')) {
      const s = document.createElement('style');
      s.id = 'ss-pin-shake';
      s.textContent = '@keyframes ss-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}';
      document.head.appendChild(s);
    }
  }, []);

  useEffect(() => { pinRef.current = pin; }, [pin]);

  useEffect(() => {
    if (mode === 'email') setTimeout(() => emailRef.current?.focus(), 60);
  }, [mode]);

  function resetAll() {
    setEmail(''); setPassword(''); setEmailError(''); setShowPass(false);
    setPin(''); pinRef.current = ''; setPinError('');
  }

  // Común a "correo y contraseña" y a las tarjetas de acceso rápido de la demo: una vez que
  // supabase.auth (acá, el cliente mock) confirma la sesión, se busca la ficha de `usuarios`
  // para tener rol/cliente_id/empresas y así el router decida ERP vs. portal de driver/cliente.
  async function afterAuth(authUser) {
    await window.loadAppData();
    const { data: usuarioRow } = await window.sb.from('usuarios').select('id, nombre, rol, avatar, online, iniciales, email, auth_id, activo, cliente_id, empresas, tiene_pin, pin_digitos, pin_prompt_omitido_en').eq('auth_id', authUser.id).maybeSingle();
    const user = usuarioRow ? { ...authUser, ...usuarioRow } : authUser;
    onLogin(user);
  }

  // ── Email + password handler ───────────────────────────────────────────────
  async function handleEmailSubmit(e) {
    e.preventDefault();
    if (!email || !password) { setEmailError('Completa todos los campos.'); return; }
    setEmailLoading(true); setEmailError('');
    try {
      const { data, error: authError } = await window.sb.auth.signInWithPassword({ email, password });
      if (authError) {
        setEmailError(authError.message.includes('Invalid login') ? 'Correo o contraseña incorrectos.' : authError.message);
        setEmailLoading(false); return;
      }
      await afterAuth(data.user);
    } catch (err) {
      setEmailError('Error de conexión. Verifica tu red.');
      setEmailLoading(false);
    }
  }

  // ── Accesos rápidos de la demo (un clic, un rol) ───────────────────────────
  // La demo no tiene usuarios reales: cada tarjeta entra con una cuenta ficticia ya cargada por
  // el generador (src/demo/generator.js) con ESE rol, para que se vea de inmediato cómo cambian
  // el sidebar y los permisos de un rol a otro — uno de los puntos que más vale mostrar en vivo.
  const DEMO_ROLES = [
    { rol: 'Administrador',         email: 'admin@demo.local',    icon: 'shield',  desc: 'Ve y administra todo el sistema' },
    { rol: 'Gerente de Operaciones',email: 'gerente@demo.local',  icon: 'chart',   desc: 'Operación completa, sin Ajustes' },
    { rol: 'Ventas',                email: 'ventas@demo.local',   icon: 'cart',    desc: 'POS, cotizaciones y clientes' },
    { rol: 'Contadora',             email: 'contadora@demo.local',icon: 'dollar',  desc: 'CxC, CxP, bancos y reportes' },
    { rol: 'Almacen Central',       email: 'almacen@demo.local',  icon: 'box',     desc: 'Inventario y despachos' },
    { rol: 'Driver',                email: 'driver@demo.local',   icon: 'truck',   desc: 'Portal móvil de entregas' },
    { rol: 'Cliente',               email: 'cliente@demo.local',  icon: 'user',    desc: 'Portal de autoservicio B2B' },
  ];
  const [demoLoadingRol, setDemoLoadingRol] = useState(null);
  async function demoLogin(demo) {
    if (demoLoadingRol) return;
    setDemoLoadingRol(demo.rol);
    try {
      const { data, error: authError } = await window.sb.auth.signInWithPassword({ email: demo.email, password: 'demo1234' });
      if (authError) { setDemoLoadingRol(null); return; }
      await afterAuth(data.user);
    } catch (err) {
      setDemoLoadingRol(null);
    }
  }

  // ── PIN handlers ───────────────────────────────────────────────────────────
  async function checkPin(enteredPin) {
    if (checking) return;
    setChecking(true);
    await new Promise(r => setTimeout(r, 160));
    const { user, error } = await window.loginWithPin(enteredPin);
    setChecking(false);
    if (error || !user) {
      setShake(true);
      setPinError(error?.message || 'PIN incorrecto');
      setPin(''); pinRef.current = '';
      setTimeout(() => setShake(false), 550);
      return;
    }
    setLoadingApp(true);
    await window.loadAppData();
    onLogin(user);
  }

  function pressDigit(d) {
    if (checking || pinRef.current.length >= 4) return;
    const next = pinRef.current + d;
    pinRef.current = next; setPin(next); setPinError('');
    if (next.length === 4) checkPin(next);
  }
  function pressBack() {
    if (checking) return;
    const next = pinRef.current.slice(0, -1);
    pinRef.current = next; setPin(next); setPinError('');
  }

  // Keyboard support for PIN pad
  useEffect(() => {
    if (mode !== 'pin') return;
    function onKey(e) {
      if (e.key >= '0' && e.key <= '9') pressDigit(e.key);
      else if (e.key === 'Backspace') pressBack();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, checking]);

  const PIN_KEYS = ['1','2','3','4','5','6','7','8','9','←','0',''];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="login-bg">
      <div className="login-card" style={{ maxWidth: 420 }}>
        <div className="login-logo">
          <BrandMark className="login-logo-mark" />
          <div>
            <div className="login-logo-name">Distribuidora Demo</div>
            <div className="login-logo-sub">ERP · Venezuela</div>
          </div>
        </div>
        <div className="login-divider" />

        {/* ── Choose method ─────────────────────────────────────────── */}
        {mode === 'choose' && (
          <>
            <div className="login-heading">
              <h1 className="login-title">Bienvenido</h1>
              <p className="login-subtitle">Elige cómo deseas iniciar sesión</p>
            </div>

            <div style={{ display:'grid', gap:10, marginTop:18 }}>
              <button
                onClick={() => { resetAll(); setMode('email'); }}
                style={{
                  display:'flex', alignItems:'center', gap:14, padding:'14px 16px',
                  border:'1px solid var(--border)', borderRadius:12, background:'var(--bg-elev)',
                  cursor:'pointer', textAlign:'left', transition:'border-color .12s, background .12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor='var(--brand)'; e.currentTarget.style.background='var(--brand-soft)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--bg-elev)'; }}
              >
                <div style={{ width:40, height:40, borderRadius:10, background:'var(--brand-soft)', color:'var(--brand)', display:'grid', placeItems:'center', flexShrink:0 }}>
                  <Icon name="send" size={18}/>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:600, fontSize:14 }}>Correo y contraseña</div>
                  <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>Acceso completo con tus credenciales</div>
                </div>
                <Icon name="chevronR" size={14} className="muted"/>
              </button>

              <button
                onClick={() => { resetAll(); setMode('pin'); }}
                style={{
                  display:'flex', alignItems:'center', gap:14, padding:'14px 16px',
                  border:'1px solid var(--border)', borderRadius:12, background:'var(--bg-elev)',
                  cursor:'pointer', textAlign:'left', transition:'border-color .12s, background .12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor='var(--brand)'; e.currentTarget.style.background='var(--brand-soft)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--bg-elev)'; }}
              >
                <div style={{ width:40, height:40, borderRadius:10, background:'oklch(0.96 0.04 295)', color:'oklch(0.45 0.18 295)', display:'grid', placeItems:'center', flexShrink:0 }}>
                  <Icon name="shield" size={18}/>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:600, fontSize:14 }}>Código PIN</div>
                  <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>Acceso rápido con tu PIN de 4 dígitos</div>
                </div>
                <Icon name="chevronR" size={14} className="muted"/>
              </button>
            </div>

            <div className="login-divider" style={{ margin: '18px 0 12px' }} />
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
              Accesos rápidos de la demo
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {DEMO_ROLES.map(d => (
                <button
                  key={d.rol}
                  disabled={!!demoLoadingRol}
                  onClick={() => demoLogin(d)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                    border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-sunken)',
                    cursor: demoLoadingRol ? 'default' : 'pointer', textAlign: 'left',
                    opacity: demoLoadingRol && demoLoadingRol !== d.rol ? 0.5 : 1,
                  }}
                >
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    {demoLoadingRol === d.rol ? <span className="login-spinner" style={{ width: 14, height: 14 }} /> : <Icon name={d.icon} size={14} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{d.rol}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.desc}</div>
                  </div>
                </button>
              ))}
            </div>

            <div className="login-footer">Distribuidora Demo ERP · {window.caracasYear()}</div>
          </>
        )}

        {/* ── Email + password ──────────────────────────────────────── */}
        {mode === 'email' && (
          <>
            <div className="login-heading">
              <h1 className="login-title">Iniciar sesión</h1>
              <p className="login-subtitle">Accede con tu correo y contraseña</p>
            </div>

            <form onSubmit={handleEmailSubmit} className="login-form">
              <div className="login-field">
                <label className="form-label">Correo electrónico</label>
                <input ref={emailRef} className="input" type="email" placeholder="usuario@empresa.com"
                  value={email} onChange={e => { setEmail(e.target.value); setEmailError(''); }}
                  autoComplete="email" style={{ width:'100%' }} />
              </div>
              <div className="login-field">
                <label className="form-label">Contraseña</label>
                <div style={{ position:'relative' }}>
                  <input className="input" type={showPass ? 'text' : 'password'} placeholder="••••••••"
                    value={password} onChange={e => { setPassword(e.target.value); setEmailError(''); }}
                    autoComplete="current-password" style={{ width:'100%', paddingRight:40 }} />
                  <button type="button" onClick={() => setShowPass(v => !v)} tabIndex={-1}
                    style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)', background:'none', border:'none', cursor:'pointer', padding:2 }}>
                    <Icon name={showPass ? 'chevronU' : 'chevronD'} size={14} />
                  </button>
                </div>
              </div>
              {emailError && (
                <div className="login-error"><Icon name="info" size={14} />{emailError}</div>
              )}
              <button type="submit" className="btn primary" disabled={emailLoading}
                style={{ width:'100%', justifyContent:'center', padding:'10px 16px', fontSize:14, marginTop:4 }}>
                {emailLoading
                  ? <span style={{ display:'flex', alignItems:'center', gap:8 }}><span className="login-spinner" />Verificando…</span>
                  : 'Ingresar'}
              </button>
            </form>

            <div style={{ textAlign:'center', marginTop:14 }}>
              <button onClick={() => { resetAll(); setMode('choose'); }}
                style={{ fontSize:12, color:'var(--text-muted)', background:'none', border:'none', cursor:'pointer', textDecoration:'underline' }}>
                ← Volver
              </button>
            </div>
          </>
        )}

        {/* ── PIN ───────────────────────────────────────────────────── */}
        {mode === 'pin' && (
          <>
            <div className="login-heading">
              <h1 className="login-title">Acceso por PIN</h1>
              <p className="login-subtitle">Ingresa tu PIN de 4 dígitos</p>
            </div>

            <div className="login-form">
              {/* PIN dots */}
              <div style={{ display:'flex', justifyContent:'center', gap:14, margin:'12px 0 4px', animation: shake ? 'ss-shake .5s ease' : 'none' }}>
                {[0,1,2,3].map(i => (
                  <div key={i} style={{
                    width:16, height:16, borderRadius:'50%',
                    background: i < pin.length ? (checking ? 'var(--text-muted)' : 'var(--brand)') : 'var(--border)',
                    transition:'background .1s',
                  }} />
                ))}
              </div>

              <div style={{ minHeight:20, textAlign:'center', fontSize:12, color:'var(--danger)' }}>
                {pinError}
              </div>

              {/* Keypad */}
              {loadingApp ? (
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'32px 0', gap:14 }}>
                  <span className="login-spinner" style={{ width:32, height:32 }} />
                  <div style={{ fontSize:13, color:'var(--text-muted)' }}>Cargando datos…</div>
                </div>
              ) : (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, margin:'0 auto', width:'100%' }}>
                {PIN_KEYS.map((k, idx) => {
                  const isBack  = k === '←';
                  const isEnter = k === '';
                  return (
                    <button
                      key={idx}
                      type="button"
                      disabled={checking || (isEnter && pin.length < 4)}
                      onClick={() => {
                        if (isBack)       pressBack();
                        else if (isEnter) checkPin(pin);
                        else              pressDigit(k);
                      }}
                      style={{
                        height:72, borderRadius:14, fontSize: isBack || isEnter ? 18 : 28,
                        fontWeight:600, cursor:'pointer', border:'1px solid var(--border)',
                        background: isEnter ? (pin.length === 4 ? 'var(--brand)' : 'var(--bg-sunken)') : isBack ? 'var(--bg-sunken)' : 'var(--bg-elev)',
                        color: isEnter && pin.length === 4 ? '#fff' : 'var(--text)',
                        display:'grid', placeItems:'center',
                        opacity: (checking || (isEnter && pin.length < 4)) ? 0.4 : 1,
                        transition:'opacity .1s, background .1s, transform .08s',
                        WebkitTapHighlightColor:'transparent',
                      }}
                    >
                      {isBack ? <Icon name="x" size={18} /> : isEnter ? <Icon name="check" size={18} /> : k}
                    </button>
                  );
                })}
              </div>
              )}
            </div>

            <div style={{ textAlign:'center', marginTop:16 }}>
              <button onClick={() => { resetAll(); setMode('choose'); }}
                style={{ fontSize:12, color:'var(--text-muted)', background:'none', border:'none', cursor:'pointer', textDecoration:'underline' }}>
                ← Volver
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

Object.assign(window, { LoginPage: window.LoginPage });
