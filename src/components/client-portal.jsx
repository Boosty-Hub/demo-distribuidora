// ══════════════════════════════════════════════════════════════════════════
//  client-portal.jsx — Portal del Cliente (ruta /portal-cliente)
// ══════════════════════════════════════════════════════════════════════════
const { useState, useEffect, useMemo, useRef, useCallback } = React;

const CP_SESSION_KEY = 'ss-client-session';
const CP_CART_KEY    = 'ss-client-cart';

// ─── Session ─────────────────────────────────────────────────────────────
function cpGetSession()         { try { return JSON.parse(localStorage.getItem(CP_SESSION_KEY)); } catch(e) { return null; } }
function cpSetSession(clienteId){ localStorage.setItem(CP_SESSION_KEY, JSON.stringify({ clienteId, ts: Date.now() })); }
function cpClearSession()       { localStorage.removeItem(CP_SESSION_KEY); }

// ─── Pricing ─────────────────────────────────────────────────────────────
function cpPrice(product, cliente) {
  if (!cliente) return product.base;
  const lista = SSData.listasPrecios.find(l => l.id === cliente.listaPrecio);
  if (!lista) return product.base;
  if (lista.precios?.[product.sku]) return lista.precios[product.sku];
  return Math.round(product.base * (1 - (lista.valor || 0) / 100) * 100) / 100;
}

function cpListaNombre(cliente) {
  const l = SSData.listasPrecios.find(l => l.id === cliente?.listaPrecio);
  return l ? l.nombre : 'Lista estándar';
}

// ─── Doc helpers ─────────────────────────────────────────────────────────
function cpDocs(clienteId, tipo) {
  return SSData.documentos
    .filter(d => d.cliente === clienteId && (!tipo || d.tipo === tipo || d.estado === tipo))
    .sort((a,b) => new Date(b.fecha) - new Date(a.fecha));
}

function cpNextCotId() {
  const yr = window.caracasYear();
  const max = SSData.documentos
    .filter(d => d.id.startsWith(`COT-${yr}-`))
    .map(d => parseInt(d.id.split('-').pop())||0)
    .reduce((a,b) => Math.max(a,b), 2400);
  return `COT-${yr}-${max+1}`;
}

const STAGE_LABEL = { cotizacion:'Cotización', orden:'Orden', despacho:'Despacho', factura:'Factura', nota_credito:'Nota Crédito' };
const STAGE_COLOR = { cotizacion:'amber', orden:'blue', despacho:'neutral', factura:'green', nota_credito:'purple' };
const IVA = 0.16;

// ─── Paginación 50/100/200 (estándar de módulo #2) ─────────────────────────
function cpLoadPageSize(storeKey) {
  const v = parseInt(localStorage.getItem('ss-'+storeKey+'-pagesize') || '50', 10);
  return [50,100,200].includes(v) ? v : 50;
}
function CPPagination({ total, page, pageSize, setPage, setPageSize, storeKey }) {
  if (!total) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(page, totalPages);
  return (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 4px',fontSize:13,flexWrap:'wrap',gap:8}}>
      <div style={{display:'flex',alignItems:'center',gap:8,color:'var(--text-muted)'}}>
        <span>{total} registro{total!==1?'s':''}</span>
        <select className="select" value={pageSize} style={{padding:'2px 6px'}}
          onChange={e=>{ const v=parseInt(e.target.value,10); setPageSize(v); localStorage.setItem('ss-'+storeKey+'-pagesize',String(v)); setPage(1); }}>
          {[50,100,200].map(n => <option key={n} value={n}>{n}/pág</option>)}
        </select>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:8}}>
        <span style={{color:'var(--text-muted)'}}>Página {cur} de {totalPages}</span>
        <button className="btn ghost sm" disabled={cur<=1} onClick={()=>setPage(p=>p-1)}>← Anterior</button>
        <button className="btn ghost sm" disabled={cur>=totalPages} onClick={()=>setPage(p=>p+1)}>Siguiente →</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  ClientPortalApp — container with own auth
// ══════════════════════════════════════════════════════════════════════════
window.ClientPortalApp = function ClientPortalApp({ currentUser } = {}) {
  const [authState, setAuthState]       = useState('checking');
  const [currentCliente, setCurrentCliente] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap(c) {
      if (window.loadEmpresas) {
        const emps = await window.loadEmpresas();
        window.__ssEmpresasCache = emps;
      }
      if (window.loadClientePortalData) await window.loadClientePortalData(c);
      if (cancelled) return;
      setCurrentCliente(c);
      setAuthState('portal');
    }
    async function resolve() {
      // 1) Vino del login principal (rol Cliente) — datos ya cargados.
      if (currentUser?.cliente_id) {
        const c = (SSData.clientes || []).find(cl => cl.id === currentUser.cliente_id);
        if (c) { bootstrap(c); return; }
      }
      // 2) Sesión JWT real (recarga directa de /portal-cliente).
      const { data: { session } } = await window.sb.auth.getSession();
      if (session) {
        const { data: urow } = await window.sb.from('usuarios').select('cliente_id').eq('auth_id', session.user.id).maybeSingle();
        if (urow?.cliente_id) {
          await window.loadAppData();
          const c = (SSData.clientes || []).find(cl => cl.id === urow.cliente_id);
          if (c) { bootstrap(c); return; }
        }
      }
      if (!cancelled) setAuthState('login');
    }
    resolve();
    return () => { cancelled = true; };
  }, [currentUser?.cliente_id]);

  async function handleLogin(cliente) {
    // CPLoginPage ya hizo signInWithPassword + loadAppData; completamos el bootstrap.
    if (window.loadEmpresas) { window.__ssEmpresasCache = await window.loadEmpresas(); }
    if (window.loadClientePortalData) await window.loadClientePortalData(cliente);
    setCurrentCliente(cliente);
    setAuthState('portal');
  }
  async function handleLogout() {
    cpClearSession();
    localStorage.removeItem('ss-pin-session');
    localStorage.removeItem('ss-client-cart');
    await window.sb.auth.signOut();
    window.location.replace('/');
  }

  if (authState === 'checking') return (
    <div style={{display:'grid',placeItems:'center',height:'100vh',background:'var(--bg)'}}>
      <div style={{textAlign:'center'}}>
        <div style={{width:48,height:48,borderRadius:12,background:'linear-gradient(135deg,oklch(0.55 0.19 255),oklch(0.68 0.14 55))',display:'grid',placeItems:'center',color:'#fff',fontWeight:700,fontSize:20,margin:'0 auto 12px'}}>S</div>
        <div style={{color:'var(--text-muted)',fontSize:13}}>Cargando portal…</div>
      </div>
    </div>
  );

  if (authState === 'login') return <CPLoginPage onLogin={handleLogin}/>;

  return <CPShell cliente={currentCliente} onLogout={handleLogout}/>;
};

// ══════════════════════════════════════════════════════════════════════════
//  CPLoginPage
// ══════════════════════════════════════════════════════════════════════════
function CPLoginPage({ onLogin }) {
  const [email, setEmail]   = useState('');
  const [pass, setPass]     = useState('');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !pass.trim()) { setError('Ingresa tu correo y contraseña.'); return; }
    setLoading(true);
    // Auth real: valida la contraseña y emite un JWT (rol Cliente + cliente_id).
    const { data, error: authErr } = await window.sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: pass });
    if (authErr || !data?.user) { setError('Correo o contraseña incorrectos.'); setLoading(false); return; }
    const { data: urow } = await window.sb.from('usuarios').select('cliente_id').eq('auth_id', data.user.id).maybeSingle();
    if (!urow?.cliente_id) { await window.sb.auth.signOut(); setError('Tu cuenta no está vinculada a un cliente.'); setLoading(false); return; }
    // Carga de datos acotada por RLS (sus documentos, catálogo, listas).
    await window.loadAppData();
    const c = (SSData.clientes || []).find(cl => cl.id === urow.cliente_id);
    if (!c) { await window.sb.auth.signOut(); setError('No se encontró tu cuenta de cliente.'); setLoading(false); return; }
    onLogin(c);
  }

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24}}>
      {/* Brand */}
      <div style={{textAlign:'center',marginBottom:32}}>
        <div style={{width:56,height:56,borderRadius:14,background:'linear-gradient(135deg,oklch(0.45 0.19 255),oklch(0.55 0.19 255))',display:'grid',placeItems:'center',color:'#fff',fontWeight:800,fontSize:24,margin:'0 auto 14px'}}>S</div>
        <div style={{fontWeight:700,fontSize:22,color:'var(--text)'}}>Distribuidora Demo</div>
        <div style={{fontSize:14,color:'var(--text-muted)',marginTop:4}}>Portal del Cliente</div>
      </div>

      <div className="card" style={{width:'100%',maxWidth:400,padding:32}}>
        <h2 style={{fontSize:18,fontWeight:700,marginBottom:4}}>Iniciar sesión</h2>
        <p style={{fontSize:13,color:'var(--text-muted)',marginBottom:24}}>Accede con el correo registrado en tu cuenta.</p>

        <form onSubmit={handleSubmit}>
          <div style={{marginBottom:14}}>
            <label className="form-label">Correo electrónico</label>
            <input className="input" style={{width:'100%',marginTop:4,boxSizing:'border-box'}} type="email" autoFocus
              placeholder="correo@empresa.com" value={email} onChange={e=>setEmail(e.target.value)}/>
          </div>
          <div style={{marginBottom:20}}>
            <label className="form-label">Contraseña</label>
            <input className="input" style={{width:'100%',marginTop:4,boxSizing:'border-box'}} type="password"
              placeholder="••••••••" value={pass} onChange={e=>setPass(e.target.value)}/>
          </div>
          {error && <div style={{background:'var(--danger-soft)',color:'var(--danger)',borderRadius:8,padding:'9px 14px',fontSize:13,marginBottom:16}}>{error}</div>}
          <button type="submit" className="btn primary" style={{width:'100%',padding:'12px 0',fontSize:15,justifyContent:'center'}} disabled={loading}>
            {loading ? 'Verificando…' : 'Entrar al portal'}
          </button>
        </form>
      </div>

      <div style={{marginTop:16,fontSize:12,color:'var(--text-muted)'}}>
        ¿Eres del equipo? <a href="/pos" style={{color:'var(--brand)'}}>Ir al ERP →</a>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  CPShell — top nav + section router
// ══════════════════════════════════════════════════════════════════════════
function CPShell({ cliente, onLogout }) {
  const [section, setSection]   = useState('dashboard');
  const [cart, setCart]         = useState(() => { try { return JSON.parse(localStorage.getItem(CP_CART_KEY)||'[]'); } catch(e){ return []; } });
  const [cartOpen, setCartOpen] = useState(false);

  function updateCart(newCart) {
    setCart(newCart);
    try { localStorage.setItem(CP_CART_KEY, JSON.stringify(newCart)); } catch(e) {}
  }

  function addToCart(product, qty) {
    const existing = cart.find(i => i.sku === product.sku);
    if (existing) {
      updateCart(cart.map(i => i.sku===product.sku ? {...i, qty: i.qty+qty} : i));
    } else {
      const price = cpPrice(product, cliente);
      updateCart([...cart, { sku:product.sku, nombre:product.nombre, precio:price, qty }]);
    }
  }

  const cartTotal = cart.reduce((s,i) => s+i.precio*i.qty, 0);
  const cartCount = cart.reduce((s,i) => s+i.qty, 0);

  const navItems = [
    { id:'dashboard',    label:'Inicio',       icon:'dashboard' },
    { id:'documentos',   label:'Mis Pedidos',  icon:'doc' },
    { id:'nueva-orden',  label:'Nueva Orden',  icon:'plus' },
    { id:'credito',      label:'Mi Crédito',   icon:'finance' },
    { id:'devoluciones', label:'Devoluciones', icon:'arrDn' },
  ];

  const tc = SSData.tiposCliente.find(t => t.id === cliente.tipo);

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',flexDirection:'column'}}>
      {/* Top nav */}
      <header style={{background:'var(--bg-elev)',borderBottom:'1px solid var(--border)',position:'sticky',top:0,zIndex:100}}>
        <div style={{maxWidth:1200,margin:'0 auto',padding:'0 24px',height:58,display:'flex',alignItems:'center',gap:16}}>
          {/* Brand */}
          <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
            <div style={{width:32,height:32,borderRadius:8,background:'linear-gradient(135deg,oklch(0.45 0.19 255),oklch(0.55 0.19 255))',display:'grid',placeItems:'center',color:'#fff',fontWeight:800,fontSize:14}}>S</div>
            <span style={{fontWeight:700,fontSize:14,color:'var(--text)'}}>Distribuidora Demo</span>
          </div>

          {/* Nav */}
          <nav style={{flex:1,display:'flex',gap:2,justifyContent:'center'}}>
            {navItems.map(n => (
              <button key={n.id} onClick={()=>setSection(n.id)} style={{
                display:'flex',alignItems:'center',gap:6,padding:'6px 14px',borderRadius:8,border:'none',cursor:'pointer',fontSize:13,fontWeight:section===n.id?700:400,
                background:section===n.id?'var(--brand-soft)':'none',
                color:section===n.id?'var(--brand)':'var(--text-2)',transition:'all .1s',
              }}>
                <Icon name={n.icon} size={14}/>{n.label}
              </button>
            ))}
          </nav>

          {/* Right: cart + user */}
          <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
            {section === 'nueva-orden' && (
              <button onClick={()=>setCartOpen(true)} style={{
                display:'flex',alignItems:'center',gap:8,background:'var(--brand)',color:'#fff',border:'none',borderRadius:10,padding:'7px 14px',cursor:'pointer',fontSize:13,fontWeight:600,position:'relative',
              }}>
                <Icon name="box" size={15}/>
                Carrito
                {cartCount > 0 && <span style={{background:'#fff',color:'var(--brand)',borderRadius:99,padding:'1px 7px',fontSize:11,fontWeight:700}}>{cartCount}</span>}
              </button>
            )}
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <div style={{width:32,height:32,borderRadius:99,background:tc?.color||'var(--brand)',color:'#fff',display:'grid',placeItems:'center',fontSize:11,fontWeight:700,flexShrink:0}}>
                {(cliente.contacto||'').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()}
              </div>
              <div style={{lineHeight:1.2}}>
                <div style={{fontSize:12,fontWeight:600}}>{cliente.contacto}</div>
                <div style={{fontSize:11,color:'var(--text-muted)'}}>{cliente.nombre}</div>
              </div>
              <button onClick={onLogout} className="icon-btn" title="Cerrar sesión"><Icon name="external" size={15}/></button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main style={{flex:1,maxWidth:1200,width:'100%',margin:'0 auto',padding:'28px 24px'}}>
        {section === 'dashboard'    && <CPDashboard cliente={cliente} setSection={setSection}/>}
        {section === 'documentos'   && <CPDocumentos cliente={cliente}/>}
        {section === 'nueva-orden'  && <CPNuevaOrden cliente={cliente} cart={cart} addToCart={addToCart} onOpenCart={()=>setCartOpen(true)}/>}
        {section === 'credito'      && <CPCredito cliente={cliente}/>}
        {section === 'devoluciones' && <CPDevoluciones cliente={cliente}/>}
      </main>

      {/* Cart drawer */}
      <CartDrawer
        open={cartOpen}
        cart={cart}
        cliente={cliente}
        updateCart={updateCart}
        onClose={()=>setCartOpen(false)}
        onSubmitted={()=>{ updateCart([]); setCartOpen(false); setSection('documentos'); }}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  CPDashboard
// ══════════════════════════════════════════════════════════════════════════
function CPDashboard({ cliente, setSection }) {
  const docs     = cpDocs(cliente.id);
  const cxcItems = (SSData.cuentasCobrar||[]).filter(c => c.cliente === cliente.id);
  const deuda    = cxcItems.reduce((s,c) => s+(c.monto-c.pagado),0);
  const vencido  = cxcItems.filter(c => c.estado==='vencida').reduce((s,c) => s+(c.monto-c.pagado),0);
  const creditoPct = cliente.limiteCredito > 0 ? Math.min(100, (cliente.deuda/cliente.limiteCredito)*100) : 0;
  const creditoDisp = Math.max(0, cliente.limiteCredito - cliente.deuda);
  const cotizaciones = docs.filter(d => d.tipo==='cotizacion'||d.estado==='cotizacion');
  const ordenes      = docs.filter(d => d.tipo==='orden'||d.estado==='orden');
  const facturasPend = cxcItems.filter(c => c.estado !== 'pagada');

  const kpis = [
    { label:'Cotizaciones activas', value: cotizaciones.length, icon:'receipt',  color:'var(--warn)',    action: ()=>setSection('documentos') },
    { label:'Órdenes en proceso',   value: ordenes.length,      icon:'box',      color:'var(--brand)',   action: ()=>setSection('documentos') },
    { label:'Facturas pendientes',  value: facturasPend.length, icon:'cxc',      color:'var(--danger)',  action: ()=>setSection('credito') },
    { label:'Crédito disponible',   value: fmt.usd(creditoDisp),icon:'finance',  color:'var(--success)', action: ()=>setSection('credito') },
  ];

  const hora = window.caracasHour();
  const saludo = hora < 12 ? 'Buenos días' : hora < 18 ? 'Buenas tardes' : 'Buenas noches';

  return (
    <div>
      {/* Greeting */}
      <div className="card" style={{padding:'24px 28px',marginBottom:24,background:'linear-gradient(135deg,oklch(0.22 0.06 255),oklch(0.28 0.08 255))',border:'none'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:16}}>
          <div>
            <div style={{fontSize:22,fontWeight:700,color:'#fff'}}>{saludo}, {cliente.contacto.split(' ')[0]} 👋</div>
            <div style={{fontSize:14,color:'rgba(255,255,255,.65)',marginTop:4}}>
              {cliente.nombre} · Lista: {cpListaNombre(cliente)}
            </div>
          </div>
          <button onClick={()=>setSection('nueva-orden')} style={{background:'#fff',color:'oklch(0.45 0.19 255)',border:'none',borderRadius:10,padding:'11px 22px',fontSize:14,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:8}}>
            <Icon name="plus" size={16}/>Nueva orden
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:24}}>
        {kpis.map((k,i) => (
          <div key={i} className="card" onClick={k.action} style={{padding:'18px 20px',cursor:'pointer',transition:'transform .1s'}}
            onMouseEnter={e=>e.currentTarget.style.transform='translateY(-2px)'}
            onMouseLeave={e=>e.currentTarget.style.transform='translateY(0)'}>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:40,height:40,borderRadius:10,background:k.color+'20',color:k.color,display:'grid',placeItems:'center',flexShrink:0}}>
                <Icon name={k.icon} size={19}/>
              </div>
              <div>
                <div style={{fontSize:22,fontWeight:800,color:'var(--text)'}}>{k.value}</div>
                <div style={{fontSize:12,color:'var(--text-muted)'}}>{k.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 360px',gap:20}}>
        {/* Recent docs */}
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <div style={{padding:'16px 20px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{fontWeight:700,fontSize:15}}>Actividad reciente</div>
            <button className="btn ghost sm" onClick={()=>setSection('documentos')}>Ver todos</button>
          </div>
          {docs.length === 0 && <div style={{textAlign:'center',padding:'32px 0',color:'var(--text-muted)',fontSize:13}}>Sin documentos aún</div>}
          {docs.slice(0,6).map(d => (
            <div key={d.id} style={{display:'flex',alignItems:'center',gap:14,padding:'12px 20px',borderBottom:'1px solid var(--border)'}}>
              <div style={{width:36,height:36,borderRadius:8,background:'var(--bg-sunken)',display:'grid',placeItems:'center',flexShrink:0}}>
                <Icon name="doc" size={16} style={{color:'var(--text-muted)'}}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:13,fontFamily:'var(--font-mono)'}}>{d.id}</div>
                <div style={{fontSize:12,color:'var(--text-muted)'}}>{fmt.date(d.fecha)} · {d.vendedor}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontWeight:700,fontSize:14}}>{fmt.usd(d.total)}</div>
                <span className={'chip '+(STAGE_COLOR[d.estado]||'neutral')} style={{fontSize:10}}>{STAGE_LABEL[d.estado]||d.estado}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Credit gauge */}
        <div>
          <div className="card" style={{padding:'20px 24px',marginBottom:16}}>
            <div style={{fontWeight:700,fontSize:15,marginBottom:16}}>Línea de crédito</div>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:13,marginBottom:6}}>
              <span className="muted">Utilizado</span>
              <span style={{fontWeight:700}}>{fmt.usd(cliente.deuda)}</span>
            </div>
            <div style={{height:10,borderRadius:99,background:'var(--border)',overflow:'hidden',marginBottom:6}}>
              <div style={{height:'100%',width:creditoPct+'%',borderRadius:99,background:creditoPct>80?'var(--danger)':creditoPct>60?'var(--warn)':'var(--success)',transition:'width .4s'}}/>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text-muted)'}}>
              <span>{creditoPct.toFixed(0)}% utilizado</span>
              <span>Límite: {fmt.usd(cliente.limiteCredito)}</span>
            </div>
            <div style={{marginTop:16,display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <div style={{background:'var(--success-soft)',borderRadius:8,padding:'10px 12px',textAlign:'center'}}>
                <div style={{fontSize:16,fontWeight:700,color:'var(--success)'}}>{fmt.usd(creditoDisp)}</div>
                <div style={{fontSize:11,color:'var(--success)'}}>Disponible</div>
              </div>
              {vencido > 0 ? (
                <div style={{background:'var(--danger-soft)',borderRadius:8,padding:'10px 12px',textAlign:'center'}}>
                  <div style={{fontSize:16,fontWeight:700,color:'var(--danger)'}}>{fmt.usd(vencido)}</div>
                  <div style={{fontSize:11,color:'var(--danger)'}}>Vencido</div>
                </div>
              ) : (
                <div style={{background:'var(--success-soft)',borderRadius:8,padding:'10px 12px',textAlign:'center'}}>
                  <div style={{fontSize:16,fontWeight:700,color:'var(--success)'}}>✓</div>
                  <div style={{fontSize:11,color:'var(--success)'}}>Al día</div>
                </div>
              )}
            </div>
          </div>

          <div className="card" style={{padding:'16px 20px'}}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>Tu lista de precios</div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{width:36,height:36,borderRadius:8,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center',flexShrink:0}}>
                <Icon name="price" size={18}/>
              </div>
              <div>
                <div style={{fontWeight:600,fontSize:14}}>{cpListaNombre(cliente)}</div>
                <div style={{fontSize:12,color:'var(--text-muted)'}}>
                  {(() => { const l=SSData.listasPrecios.find(l=>l.id===cliente.listaPrecio); return l ? `${l.valor}% descuento sobre precio base` : 'Sin descuento'; })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  CPDocumentos
// ══════════════════════════════════════════════════════════════════════════
function CPDocumentos({ cliente }) {
  const [tab, setTab]   = useState('cotizacion');
  const [detail, setDetail] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => cpLoadPageSize('cp-docs'));
  useEffect(() => { setPage(1); }, [tab]);

  const tabs = [
    { id:'cotizacion', label:'Cotizaciones', icon:'receipt' },
    { id:'orden',      label:'Órdenes',      icon:'box'     },
    { id:'despacho',   label:'Despachos',    icon:'truck'   },
    { id:'factura',    label:'Facturas',     icon:'cxc'     },
  ];

  const docs = useMemo(() => cpDocs(cliente.id, tab), [cliente.id, tab]);
  const pagedDocs = docs.slice((page-1)*pageSize, page*pageSize);

  return (
    <div>
      <div style={{marginBottom:20}}>
        <h2 style={{fontSize:22,fontWeight:700}}>Mis Pedidos</h2>
        <div style={{fontSize:14,color:'var(--text-muted)'}}>Historial completo de cotizaciones, órdenes, despachos y facturas.</div>
      </div>

      <div style={{display:'flex',gap:4,borderBottom:'1px solid var(--border)',marginBottom:20}}>
        {tabs.map(t => {
          const count = cpDocs(cliente.id, t.id).length;
          return (
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              display:'flex',alignItems:'center',gap:7,padding:'10px 18px',background:'none',border:'none',cursor:'pointer',
              fontSize:14,fontWeight:tab===t.id?700:400,
              color:tab===t.id?'var(--brand)':'var(--text-2)',
              borderBottom:tab===t.id?'2.5px solid var(--brand)':'2.5px solid transparent',
              marginBottom:-1,
            }}>
              <Icon name={t.icon} size={14}/>{t.label}
              {count>0 && <span style={{background:tab===t.id?'var(--brand)':'var(--bg-sunken)',color:tab===t.id?'#fff':'var(--text-muted)',borderRadius:99,padding:'1px 7px',fontSize:11}}>{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="tbl-wrap">
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Número</th>
                <th>Empresa</th>
                <th>Fecha</th>
                <th className="num">Ítems</th>
                <th className="num">Total</th>
                <th>Estado</th>
                <th style={{width:60}}></th>
              </tr>
            </thead>
            <tbody>
              {docs.length === 0 && (
                <tr><td colSpan={7} style={{textAlign:'center',padding:'40px 0',color:'var(--text-muted)'}}>No tienes {tab === 'cotizacion' ? 'cotizaciones' : tab === 'orden' ? 'órdenes' : tab === 'despacho' ? 'despachos' : 'facturas'} aún</td></tr>
              )}
              {pagedDocs.map(d => {
                const emp = (window.__ssEmpresasCache || []).find(e => e.id === d.empresa_id);
                return (
                <tr key={d.id} style={{cursor:'pointer'}} onClick={()=>setDetail(d)}>
                  <td className="mono-cell" style={{fontWeight:600}}>{d.id}</td>
                  <td>
                    {emp ? (
                      <span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'2px 8px',borderRadius:6,fontSize:11,fontWeight:600,background:(emp.color||'#666')+'18',color:emp.color||'inherit',border:'1px solid '+(emp.color||'var(--border)')+'40'}}>
                        <span style={{width:6,height:6,borderRadius:'50%',background:emp.color||'#666'}}></span>
                        {emp.nombre}
                      </span>
                    ) : <span className="muted small">—</span>}
                  </td>
                  <td>{fmt.date(d.fecha)}</td>
                  <td className="num">{d.items}</td>
                  <td className="num" style={{fontWeight:700}}>{fmt.usd(d.total)}</td>
                  <td><span className={'chip '+(STAGE_COLOR[d.estado]||'neutral')}>{STAGE_LABEL[d.estado]||d.estado}</span></td>
                  <td><button className="icon-btn" onClick={e=>{e.stopPropagation();setDetail(d);}}><Icon name="external" size={14}/></button></td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <CPPagination total={docs.length} page={page} pageSize={pageSize} setPage={setPage} setPageSize={setPageSize} storeKey="cp-docs"/>

      {detail && <CPDocModal doc={detail} cliente={cliente} onClose={()=>setDetail(null)}/>}
    </div>
  );
}

// ─── Document detail modal ────────────────────────────────────────────────
function CPDocModal({ doc, cliente, onClose }) {
  const lines = useMemo(() => window.linesFor ? window.linesFor(doc) : [], [doc.id]);
  const subtotal = lines.reduce((s,l)=>s+l.subtotal,0);
  const iva      = subtotal * IVA;
  const total    = subtotal + iva;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width:680,maxHeight:'88vh',display:'flex',flexDirection:'column'}}>
        <div className="modal-header" style={{flexShrink:0}}>
          <div style={{width:40,height:40,borderRadius:10,background:'var(--brand-soft)',color:'var(--brand)',display:'grid',placeItems:'center'}}>
            <Icon name="doc" size={20}/>
          </div>
          <div style={{flex:1}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <h3 className="modal-title">{doc.id}</h3>
              <span className={'chip '+(STAGE_COLOR[doc.estado]||'neutral')}>{STAGE_LABEL[doc.estado]}</span>
            </div>
            <div className="small muted">{fmt.date(doc.fecha)} · {doc.vendedor}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body" style={{flex:1,overflowY:'auto'}}>
          <table className="tbl" style={{marginBottom:20}}>
            <thead><tr><th>Producto</th><th>SKU</th><th className="num">Cant.</th><th className="num">Precio unit.</th><th className="num">Subtotal</th></tr></thead>
            <tbody>
              {lines.map((l,i) => (
                <tr key={i}>
                  <td style={{fontSize:13}}>{l.nombre}</td>
                  <td className="mono-cell muted">{l.sku}</td>
                  <td className="num">{l.qty}</td>
                  <td className="num">{fmt.usd(l.precio)}</td>
                  <td className="num" style={{fontWeight:700}}>{fmt.usd(l.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{display:'flex',justifyContent:'flex-end'}}>
            <div style={{background:'var(--bg-sunken)',borderRadius:10,padding:'14px 20px',minWidth:260}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:13,padding:'4px 0',borderBottom:'1px solid var(--border)'}}><span className="muted">Subtotal</span><span>{fmt.usd(subtotal)}</span></div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:13,padding:'4px 0',borderBottom:'1px solid var(--border)'}}><span className="muted">IVA 16%</span><span>{fmt.usd(iva)}</span></div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:16,fontWeight:800,padding:'8px 0 0'}}><span>Total</span><span style={{color:'var(--brand)'}}>{fmt.usd(total)}</span></div>
            </div>
          </div>
        </div>
        <div className="modal-footer" style={{flexShrink:0}}>
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  CPNuevaOrden — product catalog
// ══════════════════════════════════════════════════════════════════════════
function CPNuevaOrden({ cliente, cart, addToCart, onOpenCart }) {
  // Filtros persistidos (estándar #4).
  const [search, setSearch]   = useState(() => localStorage.getItem('ss-cp-catalogo-search') || '');
  const [catFilter, setCat]   = useState(() => localStorage.getItem('ss-cp-catalogo-cat') || '');
  const [qtys, setQtys]       = useState({});  // { sku: qty }
  // Paginación (estándar #2) — antes el grid renderizaba TODOS los productos (miles) de una vez.
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(() => { const v = parseInt(localStorage.getItem('ss-cp-catalogo-pagesize'), 10); return [24,48,96].includes(v) ? v : 24; });
  useEffect(() => { localStorage.setItem('ss-cp-catalogo-search', search); }, [search]);
  useEffect(() => { localStorage.setItem('ss-cp-catalogo-cat', catFilter); }, [catFilter]);
  useEffect(() => { localStorage.setItem('ss-cp-catalogo-pagesize', String(pageSize)); }, [pageSize]);
  useEffect(() => { setPage(1); }, [search, catFilter, pageSize]);

  const cartCount = cart.reduce((s,i)=>s+i.qty,0);
  const categorias = useMemo(() => [...new Set(SSData.productos.map(p=>p.categoria))].sort(), []);

  const productos = useMemo(() => {
    const q = search.toLowerCase();
    return SSData.productos.filter(p => {
      if (catFilter && p.categoria !== catFilter) return false;
      if (q && !p.nombre.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [search, catFilter]);
  const totalPages = Math.max(1, Math.ceil(productos.length / pageSize));
  const curPage    = Math.min(page, totalPages);
  const paginados  = productos.slice((curPage - 1) * pageSize, curPage * pageSize);

  function getQty(sku) { return qtys[sku] || 1; }
  function setQty(sku, val) { setQtys(q => ({...q, [sku]: Math.max(1, parseInt(val)||1)})); }

  function handleAdd(product) {
    addToCart(product, getQty(product.sku));
  }

  const lista = SSData.listasPrecios.find(l => l.id === cliente.listaPrecio);

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:20,flexWrap:'wrap',gap:12}}>
        <div>
          <h2 style={{fontSize:22,fontWeight:700}}>Nueva Orden</h2>
          <div style={{fontSize:14,color:'var(--text-muted)'}}>
            Precios según tu lista: <strong style={{color:'var(--brand)'}}>{cpListaNombre(cliente)}</strong>
            {lista && <span className="muted" style={{marginLeft:8}}>(−{lista.valor}% sobre precio base)</span>}
          </div>
        </div>
        {cartCount > 0 && (
          <button onClick={onOpenCart} style={{background:'var(--brand)',color:'#fff',border:'none',borderRadius:10,padding:'10px 20px',fontSize:14,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:8}}>
            <Icon name="box" size={16}/>Ver carrito
            <span style={{background:'rgba(255,255,255,.25)',borderRadius:99,padding:'1px 8px'}}>{cartCount}</span>
          </button>
        )}
      </div>

      {/* Filters */}
      <div style={{display:'flex',gap:10,marginBottom:20,flexWrap:'wrap'}}>
        <div className="search-box" style={{flex:'1 1 280px'}}>
          <Icon name="search" size={14}/>
          <input className="search-input" placeholder="Buscar producto o SKU…" value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <select className="select" style={{minWidth:200}} value={catFilter} onChange={e=>setCat(e.target.value)}>
          <option value="">Todas las categorías</option>
          {categorias.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span style={{alignSelf:'center',fontSize:13,color:'var(--text-muted)'}}>{productos.length} productos</span>
      </div>

      {/* Product grid */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:16}}>
        {paginados.map(p => {
          const price = cpPrice(p, cliente);
          const pct   = Math.round((1 - price/p.base)*100);
          const inCart = cart.find(i => i.sku === p.sku);
          return (
            <div key={p.sku} className="card" style={{padding:18,display:'flex',flexDirection:'column',gap:12}}>
              {/* Header */}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:11,color:'var(--text-muted)',fontFamily:'var(--font-mono)',marginBottom:3}}>{p.sku}</div>
                  <div style={{fontWeight:700,fontSize:14,lineHeight:1.3}}>{p.nombre}</div>
                </div>
                {inCart && (
                  <span style={{background:'var(--success-soft)',color:'var(--success)',borderRadius:6,padding:'2px 8px',fontSize:10,fontWeight:700,flexShrink:0}}>En carrito</span>
                )}
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                <span className="chip neutral" style={{fontSize:10}}>{p.marca}</span>
                <span className="chip neutral" style={{fontSize:10}}>{p.categoria}</span>
              </div>
              {/* Price */}
              <div style={{display:'flex',alignItems:'baseline',gap:10}}>
                <span style={{fontSize:22,fontWeight:800,color:'var(--brand)'}}>{fmt.usd(price)}</span>
                {pct > 0 && (
                  <span style={{fontSize:12,color:'var(--success)',fontWeight:600}}>−{pct}%</span>
                )}
                {pct > 0 && <span style={{fontSize:12,color:'var(--text-muted)',textDecoration:'line-through'}}>{fmt.usd(p.base)}</span>}
              </div>
              {/* Qty + add */}
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <button onClick={()=>setQty(p.sku,getQty(p.sku)-1)} style={{width:30,height:30,borderRadius:99,border:'1px solid var(--border)',background:'var(--bg-sunken)',cursor:'pointer',display:'grid',placeItems:'center',flexShrink:0}}>
                  <Icon name="dash" size={13}/>
                </button>
                <input type="number" min={1} value={getQty(p.sku)} onChange={e=>setQty(p.sku,e.target.value)}
                  style={{width:48,textAlign:'center',border:'1px solid var(--border)',borderRadius:8,padding:'4px 0',fontSize:15,fontWeight:700,background:'var(--bg-elev)',color:'var(--text)'}}/>
                <button onClick={()=>setQty(p.sku,getQty(p.sku)+1)} style={{width:30,height:30,borderRadius:99,border:'1px solid var(--border)',background:'var(--bg-sunken)',cursor:'pointer',display:'grid',placeItems:'center',flexShrink:0}}>
                  <Icon name="plus" size={13}/>
                </button>
                <button onClick={()=>handleAdd(p)} className="btn primary sm" style={{flex:1,justifyContent:'center'}}>
                  <Icon name="plus" size={13}/>{inCart ? 'Añadir más' : 'Agregar'}
                </button>
              </div>
            </div>
          );
        })}
        {productos.length === 0 && (
          <div style={{gridColumn:'1/-1',textAlign:'center',padding:'48px 0',color:'var(--text-muted)'}}>
            <Icon name="search" size={32}/>
            <div style={{marginTop:12}}>No se encontraron productos</div>
          </div>
        )}
      </div>

      {productos.length > pageSize && (
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:20,flexWrap:'wrap',gap:10}}>
          <div style={{fontSize:13,color:'var(--text-muted)'}}>Página {curPage} de {totalPages} · {productos.length} productos</div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <span style={{fontSize:13,color:'var(--text-muted)'}}>Por página:</span>
            <select className="select" value={pageSize} onChange={e=>setPageSize(parseInt(e.target.value,10))} style={{fontSize:13,padding:'4px 8px'}}>
              {[24,48,96].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <button className="btn secondary" disabled={curPage<=1} onClick={()=>{ setPage(curPage-1); window.scrollTo({top:0,behavior:'smooth'}); }}>← Anterior</button>
            <button className="btn secondary" disabled={curPage>=totalPages} onClick={()=>{ setPage(curPage+1); window.scrollTo({top:0,behavior:'smooth'}); }}>Siguiente →</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cart Drawer ────────────────────────────────────────────────────────────
function CartDrawer({ open, cart, cliente, updateCart, onClose, onSubmitted }) {
  const [notas, setNotas]     = useState('');
  const [submitted, setSubmitted] = useState(null);
  const [saving, setSaving]       = useState(false);
  const [submitError, setSubmitError] = useState('');

  const subtotal = cart.reduce((s,i)=>s+i.precio*i.qty,0);
  const iva      = subtotal * IVA;
  const total    = subtotal + iva;

  function setQty(sku, val) {
    const q = Math.max(0, parseInt(val)||0);
    if (q === 0) { updateCart(cart.filter(i=>i.sku!==sku)); return; }
    updateCart(cart.map(i=>i.sku===sku?{...i,qty:q}:i));
  }

  // Antes solo hacía SSData.documentos.push(...) sin tocar Supabase: la cotización
  // "enviada" desde el portal existía únicamente en memoria y desaparecía al
  // refrescar, invisible para ventas. Ahora persiste vía saveDocumento (mismo
  // helper que usa pos.jsx) y usa el correlativo atómico server-side (RPC
  // siguiente_correlativo) para evitar choque de ID entre clientes concurrentes
  // — nextDocId/cpNextCotId calculan el máximo leyendo `documentos`, pero la RLS
  // del rol Cliente solo deja ver sus propios documentos, así que ese cálculo
  // quedaría acotado a un solo cliente y colisionaría entre clientes distintos.
  async function handleSubmit() {
    if (saving) return;
    setSaving(true);
    setSubmitError('');
    const empresaId = (cliente.empresas && cliente.empresas[0]) || 'demo1';
    const cotId = (await window.nextCorrelativo?.('COT')) || cpNextCotId();
    const lines = cart.map(i=>({ sku:i.sku, nombre:i.nombre, qty:i.qty, precio:i.precio, subtotal:i.precio*i.qty }));
    const { doc, error } = await window.saveDocumento({
      id: cotId, tipo: 'cotizacion', estado: 'creada',
      empresa_id: empresaId,
      cliente_id: cliente.id,
      fecha: window.localDateStr(),
      total, items: cart.length,
      vendedor: cliente.contacto || null,
      notas: notas || null,
    }, lines);
    setSaving(false);
    if (error) { setSubmitError('No se pudo enviar la cotización: ' + (error.message || 'Error desconocido')); return; }
    setSubmitted(doc.id);
  }

  const drawerStyle = {
    position:'fixed', top:0, right: open?0:'-420px', width:420, height:'100vh',
    background:'var(--bg-elev)', boxShadow:'-4px 0 24px rgba(0,0,0,.25)',
    zIndex:200, display:'flex', flexDirection:'column',
    transition:'right .25s ease',
  };

  return (
    <>
      {open && <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:199}}/>}
      <div style={drawerStyle}>
        <div style={{padding:'20px 24px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
          <div>
            <div style={{fontWeight:700,fontSize:17}}>Carrito</div>
            <div style={{fontSize:12,color:'var(--text-muted)'}}>{cart.length} productos</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>

        {submitted ? (
          <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:32,textAlign:'center'}}>
            <div style={{width:64,height:64,borderRadius:99,background:'var(--success-soft)',color:'var(--success)',display:'grid',placeItems:'center',marginBottom:20}}>
              <Icon name="check" size={28}/>
            </div>
            <div style={{fontWeight:700,fontSize:18,marginBottom:8}}>¡Cotización enviada!</div>
            <div style={{fontSize:14,color:'var(--text-muted)',marginBottom:6}}>Tu solicitud fue registrada como</div>
            <div style={{fontSize:18,fontWeight:800,fontFamily:'var(--font-mono)',color:'var(--brand)',marginBottom:24}}>{submitted}</div>
            <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:24}}>Recibirás confirmación del equipo de ventas.</div>
            <button className="btn primary" onClick={onSubmitted}>Ver mis pedidos</button>
          </div>
        ) : (
          <>
            <div style={{flex:1,overflowY:'auto',padding:'0 24px'}}>
              {cart.length === 0 && (
                <div style={{textAlign:'center',padding:'60px 0',color:'var(--text-muted)'}}>
                  <Icon name="box" size={36}/>
                  <div style={{marginTop:12,fontSize:14}}>Tu carrito está vacío</div>
                </div>
              )}
              {cart.map(item => (
                <div key={item.sku} style={{padding:'14px 0',borderBottom:'1px solid var(--border)',display:'flex',gap:12}}>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:13,lineHeight:1.3}}>{item.nombre}</div>
                    <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-muted)',marginTop:2}}>{item.sku}</div>
                    <div style={{fontSize:13,color:'var(--brand)',fontWeight:700,marginTop:4}}>{fmt.usd(item.precio)} <span style={{color:'var(--text-muted)',fontWeight:400}}>/ ud</span></div>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:8}}>
                    <button onClick={()=>updateCart(cart.filter(i=>i.sku!==item.sku))} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)'}}>
                      <Icon name="trash" size={13}/>
                    </button>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <button onClick={()=>setQty(item.sku,item.qty-1)} style={{width:26,height:26,borderRadius:99,border:'1px solid var(--border)',background:'var(--bg-sunken)',cursor:'pointer',display:'grid',placeItems:'center'}}>
                        <Icon name="dash" size={11}/>
                      </button>
                      <span style={{width:24,textAlign:'center',fontWeight:700}}>{item.qty}</span>
                      <button onClick={()=>setQty(item.sku,item.qty+1)} style={{width:26,height:26,borderRadius:99,border:'1px solid var(--border)',background:'var(--bg-sunken)',cursor:'pointer',display:'grid',placeItems:'center'}}>
                        <Icon name="plus" size={11}/>
                      </button>
                    </div>
                    <div style={{fontSize:13,fontWeight:700}}>{fmt.usd(item.precio*item.qty)}</div>
                  </div>
                </div>
              ))}
              {cart.length > 0 && (
                <div style={{padding:'14px 0'}}>
                  <label className="form-label">Notas / instrucciones especiales</label>
                  <textarea className="input" rows={3} style={{resize:'vertical',width:'100%',boxSizing:'border-box',marginTop:4}}
                    value={notas} onChange={e=>setNotas(e.target.value)} placeholder="Ej: Entrega en almacén B, urgente…"/>
                </div>
              )}
            </div>

            {cart.length > 0 && (
              <div style={{padding:'16px 24px',borderTop:'1px solid var(--border)',flexShrink:0}}>
                <div style={{fontSize:13,marginBottom:4,display:'flex',justifyContent:'space-between'}}><span className="muted">Subtotal</span><span>{fmt.usd(subtotal)}</span></div>
                <div style={{fontSize:13,marginBottom:10,display:'flex',justifyContent:'space-between'}}><span className="muted">IVA 16%</span><span>{fmt.usd(iva)}</span></div>
                <div style={{fontSize:18,fontWeight:800,marginBottom:16,display:'flex',justifyContent:'space-between'}}>
                  <span>Total estimado</span><span style={{color:'var(--brand)'}}>{fmt.usd(total)}</span>
                </div>
                {submitError && (
                  <div style={{fontSize:12.5,color:'var(--danger)',background:'var(--danger-soft, #fee2e2)',border:'1px solid var(--danger)',borderRadius:8,padding:'8px 10px',marginBottom:10}}>
                    {submitError}
                  </div>
                )}
                <button onClick={handleSubmit} className="btn primary" disabled={saving} style={{width:'100%',padding:'13px 0',fontSize:15,justifyContent:'center'}}>
                  <Icon name="send" size={15}/>{saving ? 'Enviando…' : 'Enviar cotización'}
                </button>
                <div style={{fontSize:11,color:'var(--text-muted)',textAlign:'center',marginTop:8}}>Se generará una cotización que nuestro equipo confirmará.</div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  CPCredito — credit line + open invoices
// ══════════════════════════════════════════════════════════════════════════
function CPCredito({ cliente }) {
  const cxc = (SSData.cuentasCobrar||[]).filter(c=>c.cliente===cliente.id);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => cpLoadPageSize('cp-credito'));
  const pagedCxc = cxc.slice((page-1)*pageSize, page*pageSize);
  const creditoDisp = Math.max(0, cliente.limiteCredito - cliente.deuda);
  const pct = cliente.limiteCredito > 0 ? Math.min(100, (cliente.deuda/cliente.limiteCredito)*100) : 0;
  const vencidas = cxc.filter(c=>c.estado==='vencida');
  const totalPendiente = cxc.reduce((s,c)=>s+(c.monto-c.pagado),0);

  return (
    <div>
      <div style={{marginBottom:20}}>
        <h2 style={{fontSize:22,fontWeight:700}}>Mi Crédito y Pagos</h2>
        <div style={{fontSize:14,color:'var(--text-muted)'}}>Línea de crédito, facturas abiertas y estado de cuenta.</div>
      </div>

      {/* Credit cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16,marginBottom:24}}>
        <div className="card" style={{padding:'20px 24px'}}>
          <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:4}}>Límite de crédito</div>
          <div style={{fontSize:26,fontWeight:800,color:'var(--text)'}}>{fmt.usd(cliente.limiteCredito)}</div>
          <div style={{fontSize:12,color:'var(--text-muted)',marginTop:4}}>{cliente.diasCredito} días plazo</div>
        </div>
        <div className="card" style={{padding:'20px 24px'}}>
          <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:4}}>Crédito utilizado</div>
          <div style={{fontSize:26,fontWeight:800,color:'var(--warn)'}}>{fmt.usd(cliente.deuda)}</div>
          <div style={{fontSize:12,color:'var(--text-muted)',marginTop:4}}>{pct.toFixed(0)}% del límite</div>
        </div>
        <div className="card" style={{padding:'20px 24px',border: creditoDisp > 0 ? '2px solid var(--success)' : '2px solid var(--danger)'}}>
          <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:4}}>Crédito disponible</div>
          <div style={{fontSize:26,fontWeight:800,color: creditoDisp > 0 ? 'var(--success)' : 'var(--danger)'}}>{fmt.usd(creditoDisp)}</div>
          <div style={{fontSize:12,color:'var(--text-muted)',marginTop:4}}>Para nuevas órdenes</div>
        </div>
      </div>

      {/* Credit bar */}
      <div className="card" style={{padding:'20px 24px',marginBottom:24}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:8,fontSize:13}}>
          <span style={{fontWeight:600}}>Utilización de crédito</span>
          <span style={{color: pct>80?'var(--danger)':pct>60?'var(--warn)':'var(--success)',fontWeight:700}}>{pct.toFixed(0)}%</span>
        </div>
        <div style={{height:12,borderRadius:99,background:'var(--border)',overflow:'hidden'}}>
          <div style={{height:'100%',width:pct+'%',borderRadius:99,background:pct>80?'var(--danger)':pct>60?'var(--warn)':'var(--success)',transition:'width .5s'}}/>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text-muted)',marginTop:6}}>
          <span>$0</span><span>{fmt.usd(cliente.limiteCredito)}</span>
        </div>
      </div>

      {/* Alerts */}
      {vencidas.length > 0 && (
        <div style={{background:'var(--danger-soft)',border:'1px solid var(--danger)',borderRadius:10,padding:'14px 20px',marginBottom:20,display:'flex',alignItems:'center',gap:12,fontSize:13}}>
          <Icon name="info" size={18} style={{color:'var(--danger)',flexShrink:0}}/>
          <div>
            <strong style={{color:'var(--danger)'}}>Tienes {vencidas.length} factura{vencidas.length>1?'s':''} vencida{vencidas.length>1?'s':''}.</strong>
            <span style={{color:'var(--danger)',marginLeft:6}}>
              Monto vencido: {fmt.usd(vencidas.reduce((s,c)=>s+(c.monto-c.pagado),0))}. Contacta a tu asesor de ventas para regularizar.
            </span>
          </div>
        </div>
      )}

      {/* CxC table */}
      <div className="card" style={{padding:0,overflow:'hidden'}}>
        <div style={{padding:'16px 20px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontWeight:700,fontSize:15}}>Facturas abiertas</div>
          <div style={{fontSize:13,color:'var(--text-muted)'}}>Pendiente total: <strong style={{color:'var(--text)'}}>{fmt.usd(totalPendiente)}</strong></div>
        </div>
        {cxc.length === 0 ? (
          <div style={{textAlign:'center',padding:'32px 0',color:'var(--text-muted)',fontSize:13}}>Sin facturas abiertas — ¡al día!</div>
        ) : (
          <table className="tbl">
            <thead><tr><th>Factura</th><th>Vencimiento</th><th className="num">Monto</th><th className="num">Pagado</th><th className="num">Saldo</th><th>Estado</th></tr></thead>
            <tbody>
              {pagedCxc.map(c => {
                const saldo = c.monto - c.pagado;
                const vencLabel = c.dias < 0 ? `Vence en ${Math.abs(c.dias)} días` : c.dias === 0 ? 'Vence hoy' : `Vencida hace ${c.dias} días`;
                return (
                  <tr key={c.id}>
                    <td className="mono-cell">{c.factura}</td>
                    <td style={{fontSize:12}}><div>{fmt.date(c.vence)}</div><div style={{color:c.dias>0?'var(--danger)':'var(--text-muted)',fontSize:11}}>{vencLabel}</div></td>
                    <td className="num">{fmt.usd(c.monto)}</td>
                    <td className="num" style={{color:'var(--success)'}}>{fmt.usd(c.pagado)}</td>
                    <td className="num" style={{fontWeight:700,color:c.dias>0?'var(--danger)':'var(--text)'}}>{fmt.usd(saldo)}</td>
                    <td><span className={'chip '+(c.estado==='vencida'?'red':'green')}>{c.estado==='vencida'?'Vencida':'Vigente'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {cxc.length > 0 && (
          <div style={{padding:'0 16px'}}>
            <CPPagination total={cxc.length} page={page} pageSize={pageSize} setPage={setPage} setPageSize={setPageSize} storeKey="cp-credito"/>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  CPDevoluciones
// ══════════════════════════════════════════════════════════════════════════
function CPDevoluciones({ cliente }) {
  const devs = useMemo(() => (SSData.devoluciones||[]).filter(d=>d.cliente_id===cliente.id), [cliente.id]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => cpLoadPageSize('cp-devoluciones'));
  const pagedDevs = devs.slice((page-1)*pageSize, page*pageSize);

  const ESTADO_COLOR = { pendiente:'amber', aprobada:'blue', procesada:'green', rechazada:'red' };
  const ESTADO_LABEL = { pendiente:'Pendiente', aprobada:'Aprobada', procesada:'Procesada', rechazada:'Rechazada' };

  return (
    <div>
      <div style={{marginBottom:20}}>
        <h2 style={{fontSize:22,fontWeight:700}}>Mis Devoluciones</h2>
        <div style={{fontSize:14,color:'var(--text-muted)'}}>Historial de devoluciones y notas de crédito.</div>
      </div>

      {devs.length === 0 ? (
        <div className="card" style={{textAlign:'center',padding:'56px 24px'}}>
          <Icon name="arrDn" size={40} style={{color:'var(--text-muted)'}}/>
          <div style={{marginTop:16,fontSize:16,fontWeight:600}}>Sin devoluciones registradas</div>
          <div style={{fontSize:14,color:'var(--text-muted)',marginTop:6}}>Para solicitar una devolución, contacta a tu asesor de ventas con el número de factura.</div>
        </div>
      ) : (
        <div className="tbl-wrap">
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Devolución</th>
                  <th>Factura</th>
                  <th>Motivo</th>
                  <th className="num">Ítems</th>
                  <th className="num">Total NC</th>
                  <th>Nota Crédito</th>
                  <th>Reembolso</th>
                  <th>Estado</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {pagedDevs.map(d => (
                  <tr key={d.id}>
                    <td className="mono-cell">{d.id}</td>
                    <td className="mono-cell muted">{d.factura_id}</td>
                    <td style={{fontSize:13}}>{d.motivo}</td>
                    <td className="num">{d.items.length}</td>
                    <td className="num" style={{fontWeight:700,color:'var(--danger)'}}>{fmt.usd(d.total)}</td>
                    <td>
                      {d.nota_credito_id
                        ? <span className="chip blue" style={{fontFamily:'var(--font-mono)',fontSize:11}}>{d.nota_credito_id}</span>
                        : <span className="muted small">Pendiente</span>}
                    </td>
                    <td>
                      <div style={{fontSize:12}}>{d.reembolso?.metodo==='credito_cuenta'?'Crédito cuenta':d.reembolso?.metodo==='transferencia'?'Transferencia':'Efectivo'}</div>
                      <span className={'chip '+(d.reembolso?.estado==='procesado'?'green':'amber')} style={{fontSize:10}}>
                        {d.reembolso?.estado==='procesado'?'Procesado':'Pendiente'}
                      </span>
                    </td>
                    <td><span className={'chip '+(ESTADO_COLOR[d.estado]||'neutral')}>{ESTADO_LABEL[d.estado]||d.estado}</span></td>
                    <td className="muted">{fmt.date(d.fecha)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CPPagination total={devs.length} page={page} pageSize={pageSize} setPage={setPage} setPageSize={setPageSize} storeKey="cp-devoluciones"/>
        </div>
      )}

      <div className="card" style={{padding:'16px 20px',marginTop:20,background:'var(--bg-sunken)',border:'1px solid var(--border)'}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <Icon name="info" size={18} style={{color:'var(--brand)',flexShrink:0}}/>
          <div style={{fontSize:13,color:'var(--text-2)'}}>
            Para solicitar una nueva devolución, comunícate con tu asesor de ventas indicando el número de factura y el motivo. Nuestro equipo procesará tu solicitud en 24–48 horas.
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ClientPortalApp: window.ClientPortalApp });
