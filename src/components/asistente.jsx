// ══════════════════════════════════════════════════════════════════
// Asistente IA — chat transversal sobre toda la base de datos (Claude + tool use)
// ══════════════════════════════════════════════════════════════════
const { useState, useEffect, useRef, useCallback } = React;

// ── Render de inline markdown: **bold**, *italic*, `code`, [link](url) ──
function _inline(text, keyBase) {
  const nodes = [];
  let rest = String(text == null ? '' : text);
  let k = 0;
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/;
  while (rest.length) {
    const m = rest.match(re);
    if (!m) { nodes.push(rest); break; }
    if (m.index > 0) nodes.push(rest.slice(0, m.index));
    if (m[2] != null)      nodes.push(<strong key={keyBase + '-b' + (k++)}>{m[2]}</strong>);
    else if (m[3] != null) nodes.push(<em key={keyBase + '-i' + (k++)}>{m[3]}</em>);
    else if (m[4] != null) nodes.push(<code key={keyBase + '-c' + (k++)} className="ai-code">{m[4]}</code>);
    else if (m[5] != null) nodes.push(<a key={keyBase + '-l' + (k++)} href={m[6]} target="_blank" rel="noopener noreferrer">{m[5]}</a>);
    rest = rest.slice(m.index + m[0].length);
  }
  return nodes;
}

// ── Render de markdown por bloques (con TABLAS) → elementos React ──
function renderMarkdown(md) {
  const lines = String(md == null ? '' : md).replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0, key = 0;
  const isTableSep = s => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(s);
  const splitRow = s => s.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
  while (i < lines.length) {
    const ln = lines[i];
    // Code fence
    if (/^\s*```/.test(ln)) {
      const buf = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(<pre key={'k' + (key++)} className="ai-pre"><code>{buf.join('\n')}</code></pre>);
      continue;
    }
    // Tabla
    if (ln.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(ln);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') { rows.push(splitRow(lines[i])); i++; }
      out.push(
        <div key={'k' + (key++)} className="ai-table-wrap">
          <table className="ai-table">
            <thead><tr>{header.map((h, j) => <th key={j}>{_inline(h, 'h' + key + j)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{header.map((_, ci) => <td key={ci}>{_inline(r[ci] || '', 'c' + key + ri + ci)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }
    // Encabezados
    const h = ln.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const lvl = h[1].length; out.push(React.createElement('div', { key: 'k' + (key++), className: 'ai-h ai-h' + lvl }, _inline(h[2], 'hh' + key))); i++; continue; }
    // Listas
    if (/^\s*[-*]\s+/.test(ln)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
      out.push(<ul key={'k' + (key++)} className="ai-ul">{items.map((it, j) => <li key={j}>{_inline(it, 'li' + key + j)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(ln)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
      out.push(<ol key={'k' + (key++)} className="ai-ol">{items.map((it, j) => <li key={j}>{_inline(it, 'ol' + key + j)}</li>)}</ol>);
      continue;
    }
    // Línea en blanco
    if (ln.trim() === '') { i++; continue; }
    // Párrafo
    out.push(<p key={'k' + (key++)} className="ai-p">{_inline(ln, 'p' + key)}</p>);
    i++;
  }
  return out;
}

const _SUGERENCIAS = [
  '¿Qué clientes me deben y cuánto?',
  '¿Cuántas facturas hay pendientes por despachar?',
  'Ventas por vendedor este año',
  'Productos bajo stock mínimo',
  'Top 10 clientes por facturación',
  'Cuentas por cobrar vencidas',
];

window.AsistentePage = function AsistentePage() {
  const [convs, setConvs]       = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [msgs, setMsgs]         = useState([]);   // {rol, contenido, meta}
  const [input, setInput]       = useState('');
  const [sending, setSending]   = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);
  const threadRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => { window.aiListConversaciones?.().then(setConvs); }, []);
  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; }, [msgs, sending]);

  const selectConv = useCallback(async (id) => {
    setActiveId(id); setLoadingConv(true);
    const m = await window.aiCargarMensajes?.(id) || [];
    setMsgs(m.map(x => ({ rol: x.rol, contenido: x.contenido, meta: x.meta })));
    setLoadingConv(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  function nuevaConv() { setActiveId(null); setMsgs([]); setInput(''); setTimeout(() => inputRef.current?.focus(), 50); }

  async function borrarConv(id, e) {
    e.stopPropagation();
    if (!confirm('¿Eliminar esta conversación?')) return;
    await window.aiBorrarConversacion?.(id);
    setConvs(prev => prev.filter(c => c.id !== id));
    if (activeId === id) nuevaConv();
  }

  async function enviar(texto) {
    const q = (texto != null ? texto : input).trim();
    if (!q || sending) return;
    setInput('');
    setSending(true);

    // Asegurar conversación
    let convId = activeId;
    let esNueva = false;
    if (!convId) {
      const c = await window.aiCrearConversacion?.(q.slice(0, 48));
      if (c) { convId = c.id; setActiveId(c.id); setConvs(prev => [c, ...prev]); esNueva = true; }
    }

    const userMsg = { rol: 'user', contenido: q };
    const nextMsgs = [...msgs, userMsg];
    setMsgs(nextMsgs);
    if (convId) window.aiGuardarMensaje?.(convId, 'user', q, null);

    // Historial para el modelo
    const history = nextMsgs.map(m => ({ role: m.rol === 'user' ? 'user' : 'assistant', content: m.contenido }));
    const res = await window.aiPreguntar?.(history);

    const answer = res?.error ? ('⚠️ ' + res.error) : (res?.answer || 'Sin respuesta.');
    const meta = res?.sqls?.length ? { sqls: res.sqls } : null;
    setMsgs(prev => [...prev, { rol: 'assistant', contenido: answer, meta }]);
    if (convId) window.aiGuardarMensaje?.(convId, 'assistant', answer, meta);
    if (convId && !esNueva) window.aiTocarConversacion?.(convId);
    setSending(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function onKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }
  const fmtFecha = s => { try { return new Date(s).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' }); } catch { return ''; } };

  return (
    <div className="ai-layout">
      {/* Lista de conversaciones */}
      <aside className="ai-side">
        {window.canUser?.('crear', 'asistente') !== false && (
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={nuevaConv}>
            <Icon name="plus" size={14} />Nueva conversación
          </button>
        )}
        <div className="ai-conv-list">
          {convs.length === 0 && <div className="ai-empty-side">Sin conversaciones aún</div>}
          {convs.map(c => (
            <div key={c.id} className={'ai-conv-item ' + (activeId === c.id ? 'active' : '')} onClick={() => selectConv(c.id)}>
              <Icon name="chat" size={14} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ai-conv-title">{c.titulo}</div>
                <div className="ai-conv-date">{fmtFecha(c.updated_at)}{c.usuario_nombre ? ' · ' + c.usuario_nombre : ''}</div>
              </div>
              {window.canUser?.('eliminar', 'asistente') !== false && (
                <button className="icon-btn ai-conv-del" title="Eliminar" onClick={(e) => borrarConv(c.id, e)}><Icon name="trash" size={13} /></button>
              )}
            </div>
          ))}
        </div>
      </aside>

      {/* Hilo de chat */}
      <main className="ai-main">
        <div className="ai-thread" ref={threadRef}>
          {msgs.length === 0 && !loadingConv && (
            <div className="ai-welcome">
              <div className="ai-welcome-icon"><Icon name="chart" size={28} /></div>
              <h2>Asistente del sistema</h2>
              <p>Preguntá cualquier cosa sobre tu ERP — clientes, cuentas por cobrar, facturas, despachos, inventario, ventas por vendedor… Leo la base de datos en vivo y te respondo con tablas y detalle.</p>
              <div className="ai-suggests">
                {_SUGERENCIAS.map((s, i) => (
                  <button key={i} className="ai-suggest" onClick={() => enviar(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {loadingConv && <div className="ai-loading-conv">Cargando conversación…</div>}
          {msgs.map((m, i) => (
            <div key={i} className={'ai-msg ai-msg-' + m.rol}>
              <div className="ai-avatar">{m.rol === 'user' ? <Avatar user={window.__ssCurrentUser || { nombre: '?' }} size={28} /> : <div className="ai-bot-avatar"><Icon name="chart" size={15} /></div>}</div>
              <div className="ai-bubble">
                {m.rol === 'user' ? <div className="ai-user-text">{m.contenido}</div> : <div className="ai-md">{renderMarkdown(m.contenido)}</div>}
                {m.meta?.sqls?.length > 0 && (
                  <details className="ai-sqls">
                    <summary>{m.meta.sqls.length} consulta{m.meta.sqls.length !== 1 ? 's' : ''} a la base</summary>
                    {m.meta.sqls.map((s, j) => <pre key={j} className="ai-pre ai-sql"><code>{s}</code></pre>)}
                  </details>
                )}
              </div>
            </div>
          ))}
          {sending && (
            <div className="ai-msg ai-msg-assistant">
              <div className="ai-avatar"><div className="ai-bot-avatar"><Icon name="chart" size={15} /></div></div>
              <div className="ai-bubble"><div className="ai-thinking"><span></span><span></span><span></span> consultando la base…</div></div>
            </div>
          )}
        </div>

        <div className="ai-input-bar">
          <textarea ref={inputRef} className="ai-input" rows={1} placeholder="Preguntá sobre tu sistema… (Enter para enviar, Shift+Enter salto de línea)"
            value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey} disabled={sending} />
          <button className="btn primary ai-send" onClick={() => enviar()} disabled={sending || !input.trim()} title="Enviar">
            <Icon name={sending ? 'clock' : 'chevronR'} size={16} />
          </button>
        </div>
        <div className="ai-disclaimer">El asistente lee la base de datos en modo solo-lectura. Verificá cifras críticas.</div>
      </main>
    </div>
  );
};
