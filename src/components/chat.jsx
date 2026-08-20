// Chat interno — panel lateral + página completa
const { useState, useRef, useEffect, useMemo } = React;

function currentUserId() {
  return window.__ssCurrentUser?.id || null;
}

function defaultChannel(tipo) {
  const list = SSData.canalesChat || [];
  const grupo = list.find(c => c.tipo === 'grupo');
  if (tipo === 'grupo') return grupo?.id || '';
  return grupo?.id || list[0]?.id || '';
}

async function persistMsg(canal_id, texto) {
  const uid = currentUserId();
  const ts = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' });
  const row = { canal_id, usuario_id: uid, texto, ts };
  try {
    await window.sb.from('mensajes_chat').insert(row);
  } catch (_) { /* best-effort */ }
  return { id: Date.now(), user: uid, ts, text: texto };
}

window.ChatPanel = function ChatPanel({ open, setOpen, unread, setUnread }) {
  const firstId = useMemo(() => defaultChannel('grupo'), []);
  const [activeCh, setActiveCh] = useState(firstId);
  const [msgs, setMsgs] = useState(SSData.mensajesChat || {});
  const [text, setText] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.parentElement?.scrollTo({ top: 99999 });
  }, [activeCh, msgs]);

  async function send() {
    if (!text.trim() || window.canUser?.('crear', 'chat') === false) return;
    const localText = text;
    setText('');
    const newMsg = await persistMsg(activeCh, localText);
    setMsgs(prev => ({ ...prev, [activeCh]: [...(prev[activeCh] || []), newMsg] }));
  }

  const myId = currentUserId();
  const channel = SSData.canalesChat.find(c => c.id === activeCh);
  const channelMsgs = msgs[activeCh] || [];

  return (
    <>
      {!open && (
        <button className="chat-bubble-btn" onClick={() => { setOpen(true); setUnread(0); }} title="Chat del equipo">
          <Icon name="chat" size={20}/>
          {unread > 0 && <span className="bubble-badge">{unread}</span>}
        </button>
      )}
      <div className={`chat-panel ${!open ? 'hidden' : ''}`} style={{display: 'grid', gridTemplateColumns: '140px 1fr'}}>
        <div className="chat-channels">
          <div style={{padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 11.5, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
            <span>Canales</span>
            {window.canUser?.('crear', 'chat') !== false && (
            <button className="icon-btn" style={{width: 20, height: 20}} title="Nuevo grupo"><Icon name="plus" size={12}/></button>
            )}
          </div>
          <div style={{padding: '4px 0'}}>
            {SSData.canalesChat.filter(c => c.tipo === 'grupo').map(c => (
              <div key={c.id} className={`chat-channel ${activeCh === c.id ? 'active' : ''}`} onClick={()=>setActiveCh(c.id)}>
                <span style={{color: 'var(--text-muted)', fontSize: 11}}>#</span>
                <span style={{flex: 1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize: 12.5}}>{c.nombre}</span>
                {c.unread > 0 && <span className="chip red" style={{fontSize: 9, padding: '0 5px'}}>{c.unread}</span>}
              </div>
            ))}
          </div>
          <div style={{padding: '10px 12px 4px', fontSize: 11.5, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.06em'}}>Directos</div>
          {SSData.canalesChat.filter(c => c.tipo === 'dm').map(c => {
            const other = SSData.usuarios.find(u => c.miembros?.includes(u.id) && u.id !== myId);
            return (
              <div key={c.id} className={`chat-channel ${activeCh === c.id ? 'active' : ''}`} onClick={()=>setActiveCh(c.id)}>
                <div style={{position: 'relative', flexShrink: 0}}>
                  <Avatar user={other} size={18}/>
                  {other?.online && <span style={{position:'absolute', bottom:-1, right:-1, width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', border: '1.5px solid var(--bg-elev)'}}></span>}
                </div>
                <span style={{flex: 1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize: 12}}>{other?.nombre?.split(' ')[0]}</span>
                {c.unread > 0 && <span className="chip red" style={{fontSize: 9, padding: '0 5px'}}>{c.unread}</span>}
              </div>
            );
          })}
        </div>
        <div style={{display: 'flex', flexDirection: 'column', minWidth: 0}}>
          <div style={{padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8}}>
            <div style={{flex: 1, minWidth: 0}}>
              <div style={{fontSize: 13, fontWeight: 600}}>
                {channel?.tipo === 'grupo' ? `# ${channel?.nombre}` : channel?.nombre}
              </div>
              <div className="small">{channel?.miembros?.length ?? 0} {channel?.tipo === 'grupo' ? 'miembros' : ''}</div>
            </div>
            <button className="icon-btn" onClick={()=>setOpen(false)} style={{width: 26, height: 26}} title="Cerrar"><Icon name="x" size={14}/></button>
          </div>
          <div className="chat-messages">
            {channelMsgs.map(m => {
              const user = SSData.usuarios.find(u => u.id === m.user);
              const mine = m.user === myId;
              return (
                <div key={m.id} className={`chat-msg ${mine ? 'mine' : ''}`}>
                  {!mine && <Avatar user={user} size={24}/>}
                  <div className="content">
                    {!mine && <div className="meta"><strong>{user?.nombre?.split(' ')[0]}</strong><time>{m.ts}</time></div>}
                    <div className="text">{m.text}</div>
                    {mine && <div className="small" style={{marginTop: 2, fontSize: 10, color: 'var(--text-subtle)'}}>{m.ts} · ✓✓</div>}
                  </div>
                </div>
              );
            })}
            <div ref={endRef}></div>
          </div>
          <div className="chat-compose">
            {window.canUser?.('crear', 'chat') !== false && (
            <button className="icon-btn" style={{width:28,height:28}} title="Adjuntar"><Icon name="paperclip" size={14}/></button>
            )}
            <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()} placeholder={`Mensaje a ${channel?.tipo==='grupo'?'#'+channel?.nombre:channel?.nombre}...`}/>
            {window.canUser?.('crear', 'chat') !== false && (
            <button className="chat-send" onClick={send}><Icon name="send" size={14}/></button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

window.ChatPage = function ChatPage() {
  return (
    <div className="page" style={{paddingBottom: 24}}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Chat Interno</h1>
          <div className="page-subtitle">{SSData.canalesChat.filter(c=>c.tipo==='grupo').length} grupos · {SSData.usuarios.filter(u=>u.online).length} de {SSData.usuarios.length} usuarios en línea</div>
        </div>
        <div className="page-actions">
          {window.canUser?.('crear', 'chat') !== false && (
          <React.Fragment>
          <button className="btn secondary"><Icon name="user" size={14}/>Invitar</button>
          <button className="btn primary"><Icon name="plus" size={14}/>Nuevo grupo</button>
          </React.Fragment>
          )}
        </div>
      </div>

      <div className="card" style={{padding: 0, display: 'grid', gridTemplateColumns: '240px 1fr 260px', height: 'calc(100vh - 180px)', minHeight: 520, overflow: 'hidden'}}>
        <FullChatChannels/>
        <FullChatThread/>
        <FullChatMembers/>
      </div>
    </div>
  );
};

function FullChatChannels() {
  const initId = useMemo(() => defaultChannel('grupo'), []);
  const [active, setActive] = useState(initId);
  window.__fullChatActive = [active, setActive];
  const myId = currentUserId();
  return (
    <div style={{borderRight: '1px solid var(--border)', background: 'var(--bg-sunken)', display: 'flex', flexDirection: 'column', minHeight: 0}}>
      <div style={{padding: 10, borderBottom: '1px solid var(--border)'}}>
        <input className="input search" placeholder="Buscar..." style={{width:'100%'}}/>
      </div>
      <div style={{overflowY: 'auto', flex: 1, padding: 6}}>
        <div style={{padding: '8px 10px 4px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.06em'}}>Grupos</div>
        {SSData.canalesChat.filter(c=>c.tipo==='grupo').map(c => (
          <div key={c.id} onClick={()=>setActive(c.id)} style={{padding:'8px 10px', borderRadius:6, cursor: 'pointer', background: active===c.id ? 'var(--bg-elev)':'transparent'}}>
            <div className="flex items-center gap-2">
              <span style={{color:'var(--text-muted)', fontSize: 12}}>#</span>
              <span style={{flex:1, fontSize: 13, fontWeight: active===c.id?600:400}}>{c.nombre}</span>
              {c.unread>0 && <span className="chip red" style={{fontSize: 9}}>{c.unread}</span>}
            </div>
            <div className="small" style={{marginLeft: 14, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginTop: 2}}>{c.ultimo}</div>
          </div>
        ))}
        <div style={{padding: '12px 10px 4px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.06em'}}>Directos</div>
        {SSData.canalesChat.filter(c=>c.tipo==='dm').map(c => {
          const other = SSData.usuarios.find(u => c.miembros?.includes(u.id) && u.id !== myId);
          return (
            <div key={c.id} onClick={()=>setActive(c.id)} style={{padding:'8px 10px', borderRadius:6, cursor:'pointer', background: active===c.id ? 'var(--bg-elev)':'transparent'}}>
              <div className="flex items-center gap-2">
                <div style={{position:'relative', flexShrink: 0}}>
                  <Avatar user={other} size={22}/>
                  {other?.online && <span style={{position:'absolute', bottom:-1, right:-1, width:8, height:8, borderRadius:'50%', background:'var(--success)', border:'1.5px solid var(--bg-sunken)'}}/>}
                </div>
                <span style={{flex:1, fontSize: 13, fontWeight: active===c.id?600:400}}>{other?.nombre}</span>
                {c.unread>0 && <span className="chip red" style={{fontSize: 9}}>{c.unread}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FullChatThread() {
  const [active] = window.__fullChatActive || [defaultChannel('grupo'), ()=>{}];
  const [msgs, setMsgs] = useState(SSData.mensajesChat || {});
  const [text, setText] = useState('');
  const myId = currentUserId();
  const channel = SSData.canalesChat.find(c => c.id === active);
  const list = msgs[active] || [];

  async function send() {
    if (!text.trim() || window.canUser?.('crear', 'chat') === false) return;
    const localText = text;
    setText('');
    const newMsg = await persistMsg(active, localText);
    setMsgs(prev => ({ ...prev, [active]: [...(prev[active] || []), newMsg] }));
  }

  return (
    <div style={{display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0}}>
      <div style={{padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10}}>
        <div style={{flex: 1}}>
          <div style={{fontSize: 14, fontWeight: 600}}>{channel?.tipo==='grupo' ? '# '+channel?.nombre : channel?.nombre}</div>
          <div className="small">{channel?.miembros?.length ?? 0} miembros</div>
        </div>
        <button className="icon-btn"><Icon name="search" size={14}/></button>
        <button className="icon-btn"><Icon name="bell" size={14}/></button>
        <button className="icon-btn"><Icon name="more" size={14}/></button>
      </div>
      <div style={{flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14}}>
        {list.map(m => {
          const user = SSData.usuarios.find(u => u.id === m.user);
          return (
            <div key={m.id} style={{display: 'flex', gap: 10}}>
              <Avatar user={user} size={34}/>
              <div style={{flex: 1, minWidth: 0}}>
                <div style={{display:'flex', alignItems: 'baseline', gap: 8, marginBottom: 2}}>
                  <strong style={{fontSize: 13}}>{user?.nombre}</strong>
                  <span className="small">{user?.rol}</span>
                  <time className="small">{m.ts}</time>
                </div>
                <div style={{fontSize: 13.5, lineHeight: 1.5}}>{m.text}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{padding: 14, borderTop: '1px solid var(--border)'}}>
        <div style={{border: '1px solid var(--border-strong)', borderRadius: 10, padding: 8, display: 'flex', gap: 6, alignItems: 'flex-end'}}>
          {window.canUser?.('crear', 'chat') !== false && (
          <button className="icon-btn"><Icon name="paperclip" size={16}/></button>
          )}
          <textarea value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}} rows={1} placeholder={`Mensaje a ${channel?.tipo==='grupo'?'#'+channel?.nombre:channel?.nombre}...`} style={{flex:1, border:'none', outline:'none', resize:'none', fontSize:13.5, padding:6, background: 'transparent', fontFamily: 'inherit'}}/>
          {window.canUser?.('crear', 'chat') !== false && (
          <button className="btn primary" onClick={send}><Icon name="send" size={13}/>Enviar</button>
          )}
        </div>
        <div className="small mt-2" style={{textAlign: 'center'}}>Presiona Enter para enviar · Shift+Enter para nueva línea</div>
      </div>
    </div>
  );
}

function FullChatMembers() {
  const [active] = window.__fullChatActive || [defaultChannel('grupo'), ()=>{}];
  const channel = SSData.canalesChat.find(c => c.id === active);
  const miembros = (channel?.miembros || [])
    .map(id => SSData.usuarios.find(u => u.id === id))
    .filter(Boolean);

  return (
    <div style={{borderLeft: '1px solid var(--border)', background: 'var(--bg-elev)', overflowY: 'auto'}}>
      <div style={{padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 12.5, fontWeight: 600}}>Miembros ({miembros.length})</div>
      {miembros.map(u => (
        <div key={u.id} className="flex items-center gap-3" style={{padding: '10px 16px', cursor: 'pointer'}}>
          <div style={{position: 'relative'}}>
            <Avatar user={u} size={28}/>
            {u.online && <span style={{position:'absolute', bottom:0, right:0, width:8, height:8, borderRadius:'50%', background:'var(--success)', border:'2px solid var(--bg-elev)'}}/>}
          </div>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontSize: 12.5, fontWeight: 500}}>{u.nombre}</div>
            <div className="small">{u.rol}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { ChatPanel: window.ChatPanel, ChatPage: window.ChatPage });
