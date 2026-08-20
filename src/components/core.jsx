// Icon library — using simple inline SVGs
window.Icon = function Icon({ name, size = 16, className = '' }) {
  const icons = {
    dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
    pos: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M8 15h2"/></>,
    inventory: <><path d="M12 3 3 7.5v9L12 21l9-4.5v-9L12 3zm0 0v18M3 7.5l9 4.5 9-4.5"/></>,
    price: <><path d="M20.59 13.41 13.41 20.59a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/></>,
    clients: <><circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.87 3.13-7 7-7s7 3.13 7 7M17 11a3 3 0 1 0 0-6M22 20c0-3-2-5-5-5.5"/></>,
    finance: <><path d="M3 3v18h18"/><path d="m7 14 3-3 4 4 6-7"/></>,
    cxc: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></>,
    bank: <><path d="M3 21h18M5 10v8M19 10v8M10 10v8M14 10v8M2 10l10-7 10 7H2z"/></>,
    suppliers: <><path d="M3 7h13l5 5v6a1 1 0 0 1-1 1h-2M3 7v11a1 1 0 0 0 1 1h12M3 7V5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v2"/><circle cx="7" cy="19" r="2"/><circle cx="17" cy="19" r="2"/></>,
    upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></>,
    sync: <><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.7-3M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.7 3"/><path d="M21 3v6h-6M3 21v-6h6"/></>,
    chat: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    filter: <><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></>,
    menu: <><path d="M3 12h18M3 6h18M3 18h18"/></>,
    chevronR: <><path d="m9 18 6-6-6-6"/></>,
    chevronL: <><path d="m15 18-6-6 6-6"/></>,
    chevronD: <><path d="m6 9 6 6 6-6"/></>,
    chevronU: <><path d="m18 15-6-6-6 6"/></>,
    x: <><path d="M18 6 6 18M6 6l18 12"/></>,
    check: <><path d="M20 6 9 17l-5-5"/></>,
    copy: <><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
    more: <><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></>,
    edit: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    trash: <><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4 20-7z"/></>,
    paperclip: <><path d="m21 12-8.5 8.5a5 5 0 1 1-7-7L14 5a3 3 0 1 1 4 4L9.5 17.5a1 1 0 0 1-1.5-1.5L16 8"/></>,
    user: <><circle cx="12" cy="7" r="4"/><path d="M5 21c0-3.87 3.13-7 7-7s7 3.13 7 7"/></>,
    box: <><path d="m7.5 4.27 9 5.15M21 8-12 17l-9-5V8l9-5 9 5z" /><path d="M3.3 7 12 12l8.7-5M12 22V12"/></>,
    truck: <><rect x="1" y="6" width="15" height="11" rx="1"/><path d="M16 9h4l3 3v5h-7"/><circle cx="6" cy="19" r="2"/><circle cx="19" cy="19" r="2"/></>,
    doc: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></>,
    receipt: <><path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2-3-2z"/><path d="M8 8h8M8 12h6"/></>,
    warehouse: <><path d="M2 22V8l10-5 10 5v14M6 22V12h12v10"/><path d="M10 22v-5h4v5"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
    arrUp: <><path d="M7 17 17 7M7 7h10v10"/></>,
    arrDn: <><path d="M17 7 7 17M17 17H7V7"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>,
    dash: <><path d="M5 12h14"/></>,
    external: <><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/></>,
    phone: <><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></>,
    dollar: <><path d="M12 1v22M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6"/></>,
    cash: <><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></>,
    info: <><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></>,
    clock: <><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>,
    users: <><circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.87 3.13-7 7-7s7 3.13 7 7"/><circle cx="17" cy="7" r="2.5"/><path d="M22 19c0-2.76-1.79-4.5-4-5"/></>,
    contact: <><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.58-7 8-7s8 3 8 7"/><path d="M16 3.5a4 4 0 0 1 0 7"/></>,
    chart:   <><path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="7" rx="1"/><rect x="13" y="7" width="3" height="12" rx="1"/></>,
    refresh: <><path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.36 2.64L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.36-2.64L3 16"/><path d="M3 21v-5h5"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></>,
    // Columnas de una tabla — para el selector de mostrar/ocultar (window.TablaColumnas).
    columns: <><rect x="3" y="4" width="6" height="16" rx="1"/><rect x="11" y="4" width="4" height="16" rx="1"/><rect x="17" y="4" width="4" height="16" rx="1"/></>,
    wa:   <><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></>,
    mic:  <><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"/></>,
    alert: <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></>,
  };
  // Binance: logo de marca (raster) en vez de un ícono de línea.
  if (name === 'binance') {
    return <img src="/binance.png" width={size} height={size} alt="Binance" className={className} style={{ display:'inline-block', verticalAlign:'middle', borderRadius:'50%', objectFit:'cover' }} />;
  }
  const paths = icons[name] || <circle cx="12" cy="12" r="5"/>;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {paths}
    </svg>
  );
};

// DINERO: `window.ssRound2` (a centavos) y `window.ssSaldada` (medio centavo de tolerancia) viven
// en src/money.js, que se carga antes que todo. Ahí está el porqué completo.

// Un despacho reactivado (ver window.reactivarDespacho) es el MISMO documento — no se le cambia el
// id real (rompería FKs de documentos_items/inventario_seriales/driver_despachos) — pero se muestra
// con un sufijo de versión para que quede claro que sufrió una devolución y se volvió a montar.
// Solo aplica a pos.jsx (lista + detalle); el PDF sigue imprimiendo el id real sin sufijo.
window.dispIdDespacho = function (doc) {
  if (!doc) return '';
  return (doc.tipo === 'despacho' && doc.version > 1) ? `${doc.id}-v${doc.version}` : doc.id;
};

// Texto del tooltip de info (ícono "i" al lado de un badge cancelada/anulada): quién, cuándo, por
// qué, y qué efecto colateral tuvo — todo derivado de campos que la fila YA trae (cancelado_por/
// cancelado_at/motivo_cancelacion/entregado_en), sin disparar ninguna consulta nueva por fila.
window.textoEstadoInfo = function (doc) {
  if (!doc) return '';
  const esAnulada = doc.estado === 'anulada';
  const cuando = doc.cancelado_at ? (window.fmt?.dateTime ? window.fmt.dateTime(doc.cancelado_at) : doc.cancelado_at) : null;
  let txt = `${esAnulada ? 'Anulada' : 'Cancelada'} por ${doc.cancelado_por || '—'}`;
  if (cuando) txt += ` · ${cuando}`;
  if (doc.motivo_cancelacion) txt += `\n${doc.motivo_cancelacion}`;
  if (doc.tipo === 'orden') {
    txt += '\nSe liberó la reserva de inventario.';
  } else if (doc.tipo === 'factura') {
    txt += '\nSe eliminó la cuenta por cobrar y se generó una devolución.';
  } else if (doc.tipo === 'despacho') {
    txt += doc.entregado_en
      ? '\nYa se había declarado entregado: se generó una devolución y la mercancía volvió al inventario.'
      : '\nLa mercancía nunca había salido del almacén; solo se revirtió el inventario reservado/debitado.';
  }
  return txt;
};

// Utilities
window.fmt = {
  usd: (n) => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  // Bolívares SIEMPRE con 2 decimales. Antes iban con `maximumFractionDigits: 0`, así que el
  // saldo de un banco se mostraba redondeado al bolívar: 103.737,29 aparecía como 103.737 y las
  // sumas de la pantalla no cuadraban contra el estado de cuenta por unos céntimos. En una
  // pantalla de dinero el céntimo no es ruido, es lo que hace que el saldo sea auditable.
  ves: (n) => 'Bs. ' + (n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  bs: (n) => 'Bs. ' + (n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  int: (n) => (n || 0).toLocaleString('en-US'),
  pct: (n) => (n || 0).toFixed(1) + '%',
  date: (s) => {
    if (!s) return '';
    const str = String(s).substring(0, 10);
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' });
  },
  // Instante (timestamptz) → "03-ago 19:41" en la zona del sistema. Si no hay hora (columnas
  // `date` de lo migrado, que nunca la tuvieron) cae a `fmt.date`: mejor mostrar solo la fecha
  // que inventar un 00:00 que nadie registró.
  dateTime: (v) => {
    const h = window.fmt.hora(v);
    return h ? window.fmt.dia(v) + ' ' + h : window.fmt.date(v);
  },
  // Solo la hora ('19:41'), para ponerla debajo de la fecha en una tabla. Vacío si el valor NO trae
  // hora: 'YYYY-MM-DD' lo parsea el navegador como medianoche UTC, que en Caracas son las 20:00 del
  // día anterior — o sea que sin este chequeo una columna `date` mostraría una hora inventada.
  hora: (v) => {
    if (!v) return '';
    const str = String(v);
    if (!/[T ]\d{2}:\d{2}/.test(str)) return '';
    const d = new Date(str);
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('es-VE', {
      timeZone: window.ssZonaHoraria ? window.ssZonaHoraria() : 'America/Caracas',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
  },
  // Día de un INSTANTE en la zona del sistema. `fmt.date` corta los 10 primeros caracteres, que en
  // un timestamptz es el día UTC: a las 22:30 de Caracas en UTC ya es el día siguiente, y la fecha
  // mostrada contradecía la hora de al lado.
  dia: (v) => {
    if (!v) return '';
    const str = String(v);
    if (!/[T ]\d{2}:\d{2}/.test(str)) return window.fmt.date(str);
    const d = new Date(str);
    if (isNaN(d.getTime())) return window.fmt.date(str);
    return new Intl.DateTimeFormat('es-VE', {
      timeZone: window.ssZonaHoraria ? window.ssZonaHoraria() : 'America/Caracas',
      day: '2-digit', month: 'short',
    }).format(d);
  },
  // 'YYYY-MM' → "Julio 2026". Usado en Reportes/Inventario para mostrar el nombre del mes
  // junto a la clave cronológica (que se mantiene ordenable).
  mesNombre: (ym) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
    if (!m) return ym;
    const s = new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('es-VE', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
  // 'YYYY-MM-DD' → "Miércoles". Mismo criterio para agrupación por día.
  diaNombre: (ymd) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
    if (!m) return ymd;
    const s = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('es-VE', { weekday: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
};

// Avatar
window.Avatar = function Avatar({ user, size = 26 }) {
  if (!user) return (
    <div className="user-avatar" style={{ width: size, height: size, background: '#64748b', fontSize: size * 0.4 }}>?</div>
  );
  return (
    <div className="user-avatar" style={{ width: size, height: size, background: user.avatar, fontSize: size * 0.4 }}>
      {user.iniciales}
    </div>
  );
};

// Celda "Creado por": avatar del usuario que creó el registro. Si fue el sistema
// (creado_por null/"Sistema" → registros migrados), muestra un avatar de sistema (gris + ⚙).
// Reutilizable en todas las tablas: <CreadoPorCell nombre={row.creado_por} />.
window.CreadoPorCell = function CreadoPorCell({ nombre, size = 22, showName = true }) {
  const esSistema = !nombre || nombre === 'Sistema' || nombre === 'sistema';
  if (esSistema) {
    return (
      <div title="Creado por el sistema (migración)" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div className="user-avatar" style={{ width: size, height: size, background: '#64748b', display: 'grid', placeItems: 'center' }}>
          <Icon name="settings" size={Math.round(size * 0.55)} style={{ color: '#fff' }} />
        </div>
        {showName && <span className="small muted hide-sm">Sistema</span>}
      </div>
    );
  }
  const u = (window.SSData?.usuarios || []).find((x) => x.nombre === nombre);
  const user = u || { nombre, avatar: '#64748b', iniciales: String(nombre).split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) };
  return (
    <div title={nombre} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Avatar user={user} size={size} />
      {showName && <span className="small hide-sm" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombre}</span>}
    </div>
  );
};

// Firma digital reutilizable (canvas). Llama onConfirm(dataURL png) al guardar; onClear opcional.
// Uso: <SignaturePad onConfirm={png => ...} />  · soporta mouse y touch.
window.SignaturePad = function SignaturePad({ onConfirm, height = 200 }) {
  const canvasRef = React.useRef(null);
  const isDrawing = React.useRef(false);
  const lastPos   = React.useRef(null);
  const [hasStroke, setHasStroke] = React.useState(false);
  function getPos(e) {
    const canvas = canvasRef.current; const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * scaleX, y: (src.clientY - rect.top) * scaleY };
  }
  function start(e) { e.preventDefault(); isDrawing.current = true; lastPos.current = getPos(e); }
  function move(e) {
    e.preventDefault(); if (!isDrawing.current) return;
    const ctx = canvasRef.current.getContext('2d'); const pos = getPos(e);
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
    lastPos.current = pos; setHasStroke(true);
  }
  function end(e) { e.preventDefault(); isDrawing.current = false; }
  function clear() { const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); setHasStroke(false); }
  return (
    <div>
      <canvas ref={canvasRef} width={600} height={height}
        style={{ border: '1.5px solid var(--border)', borderRadius: 10, touchAction: 'none', display: 'block', width: '100%', background: '#fff', cursor: 'crosshair' }}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        <button className="btn ghost sm" onClick={clear}>Limpiar</button>
        <button className="btn primary sm" disabled={!hasStroke} onClick={() => onConfirm(canvasRef.current.toDataURL('image/png'))}>
          <Icon name="check" size={13} />Guardar firma
        </button>
      </div>
    </div>
  );
};

// Marca de la empresa: usa el favicon subido en Configuración si existe, si no la inicial "S".
// Usado en el brand del sidebar y en el logo del login.
window.BrandMark = function BrandMark({ className = 'brand-mark', text = 'S' }) {
  let fav = null;
  try { fav = window.getEmpresaConfig && window.getEmpresaConfig().favicon; } catch (e) {}
  return (
    <div className={className}>
      {fav ? <img src={fav} alt="" className="brand-mark-img" /> : text}
    </div>
  );
};

// Copiar al portapapeles. Aparece al pasar el mouse por la celda (`.copy-host`) y confirma en el
// lugar, sin toast: el usuario está mirando ESE dato y un aviso en otra esquina obliga a buscarlo.
//
// `navigator.clipboard` necesita contexto seguro (https o localhost) y puede estar denegado por
// permisos; el respaldo con textarea + execCommand cubre esos casos. Sin respaldo, el botón parece
// andar y no copia nada.
window.CopyBtn = function CopyBtn({ text, title = 'Copiar', size = 12 }) {
  const [ok, setOk] = React.useState(false);
  if (text == null || text === '') return null;
  const copiar = async (e) => {
    e.stopPropagation();      // la fila suele abrir el detalle al click
    e.preventDefault();
    const valor = String(text);
    let listo = false;
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(valor); listo = true; }
    } catch (err) { /* cae al respaldo */ }
    if (!listo) {
      try {
        const ta = document.createElement('textarea');
        ta.value = valor;
        ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
        document.body.appendChild(ta); ta.select();
        listo = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (err) { listo = false; }
    }
    if (!listo) return;
    setOk(true);
    setTimeout(() => setOk(false), 1200);
  };
  return (
    <button type="button" className={'copy-btn' + (ok ? ' copied' : '')} onClick={copiar}
            title={ok ? 'Copiado' : title} aria-label={ok ? 'Copiado' : title}>
      <Icon name={ok ? 'check' : 'copy'} size={size} />
    </button>
  );
};

// Chip helper
window.StatusChip = function StatusChip({ estado }) {
  const map = {
    cotizacion: { label: 'Cotización', cls: 'slate' },
    orden: { label: 'Orden', cls: 'blue' },
    despacho: { label: 'Despacho', cls: 'purple' },
    factura: { label: 'Facturada', cls: 'green' },
    // Sub-status migrados desde Odoo (columna `estado`): la etapa real vive en `tipo`.
    creada: { label: 'Cotización', cls: 'slate' },
    generada: { label: 'Orden', cls: 'blue' },
    por_cobrar: { label: 'Por cobrar', cls: 'amber' },
    despachado: { label: 'Despachado', cls: 'purple' },
    entregado: { label: 'Entregado', cls: 'green' },
    vigente: { label: 'Vigente', cls: 'blue' },
    vencida: { label: 'Vencida', cls: 'red' },
    tránsito: { label: 'En tránsito', cls: 'amber' },
    confirmada: { label: 'Confirmada', cls: 'blue' },
    recibida: { label: 'Recibida', cls: 'green' },
    borrador: { label: 'Borrador', cls: 'slate' },
    'parcialmente recibida': { label: 'Parcial', cls: 'purple' },
    cancelada: { label: 'Cancelada', cls: 'red' },
    // Estados de Cuentas por Cobrar / Pagar
    pagada: { label: 'Pagada', cls: 'green' },
    pendiente: { label: 'Pendiente', cls: 'amber' },
    parcial: { label: 'Parcial', cls: 'purple' },
  };
  const m = map[estado] || { label: estado, cls: 'neutral' };
  return (
    <span className={`chip ${m.cls}`}>
      <span className="chip-dot" />
      {m.label}
    </span>
  );
};

// Sparkline
window.Sparkline = function Sparkline({ data, color = 'var(--brand)', fill = true }) {
  const w = 100, h = 32;
  const max = Math.max(...data), min = Math.min(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  const fillPts = `0,${h} ${pts} ${w},${h}`;
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {fill && <polygon points={fillPts} fill={color} opacity="0.12" />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

// SelectorTasaPrevia — "el pago entró un día anterior": elegir la tasa del día en que el cliente
// pagó de verdad, no la de hoy.
//
// POR QUÉ EXISTE: hay pagos que el cliente hizo el lunes y que el negocio registra el jueves.
// Cobrarlos a la tasa del jueves descuadra la caja contra lo que salió del banco del cliente.
//
// POR QUÉ VIVE ACÁ Y NO EN CADA MODAL: hay DOS caminos de cobro (el de la factura en pos.jsx y el
// de Cuentas por Cobrar en business.jsx) y los dos lo necesitan. Duplicarlo es garantizar que el
// próximo cambio se haga en uno solo.
//
// Controlado por el padre (`usar` y `diaElegido`) porque el padre tiene que poder deshacer la
// elección cuando pasan otras cosas —mover la fecha a mano, cambiar a cobro en dólares—; acá
// adentro solo vive la carga de los días.
//
// - tasaDelDia(dia) → la tasa que corresponde a la MODALIDAD del documento (BCV, paralelo o
//   vuelto). No siempre es el BCV: cobrar una factura en paralelo con el BCV de ese día sería
//   cobrar de menos. Devolver null/0 deshabilita esa opción.
// - onElegir(dia, tasa) — el padre decide qué hace con eso (fecha, montos, tasa por línea).
window.SelectorTasaPrevia = function SelectorTasaPrevia({
  usar, onUsar, diaElegido, onElegir, tasaDelDia, nombreTasa = 'BCV',
  tasaHoy, saldoUsd = 0, dias = 3, nota = null,
}) {
  const { useState: uSt } = React;
  const [lista, setLista]       = uSt(null);   // null = todavía no se pidieron
  const [cargando, setCargando] = uSt(false);
  const [error, setError]       = uSt('');

  async function toggle(on) {
    onUsar(on);
    if (!on || lista || cargando) return;
    setCargando(true); setError('');
    const r = await window.loadTasasDiasPrevios?.(dias);
    setCargando(false);
    if (!r || r.error) { setError('No se pudieron cargar las tasas de los días anteriores.'); setLista([]); return; }
    setLista(r.data || []);
  }

  return (
    <div style={{ border: '1px solid', borderColor: diaElegido ? 'var(--warn)' : 'var(--border)',
                  borderRadius: 8, overflow: 'hidden' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 12px', cursor: 'pointer',
                      background: diaElegido ? 'var(--warn-soft,#fef3c7)' : 'var(--bg-sunken)' }}>
        <input type="checkbox" checked={!!usar} style={{ marginTop: 2 }}
               onChange={e => toggle(e.target.checked)} />
        <span>
          <span style={{ fontWeight: 600, fontSize: 12.5 }}>
            El pago entró un día anterior — usar la tasa {nombreTasa} de ese día
          </span>
          <span className="small muted" style={{ display: 'block', fontSize: 11, marginTop: 2 }}>
            {nota || <>Para cuando el cliente pagó antes y el negocio se entera después. Cambia la tasa
              <strong> y la fecha</strong> del pago: son el mismo hecho.</>}
          </span>
        </span>
      </label>

      {usar && (
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {cargando && <div className="small muted">Cargando las tasas…</div>}
          {error && <div className="small" style={{ color: 'var(--danger)' }}>{error}</div>}
          {!cargando && !error && lista && lista.length === 0 && (
            <div className="small muted">No hay tasas registradas de días anteriores.</div>
          )}
          {(lista || []).map(d => {
            const t = tasaDelDia(d);
            const sel = diaElegido?.dia === d.dia;
            const enBs = (saldoUsd > 0 && t > 0) ? saldoUsd * t : 0;
            return (
              <button key={d.dia} type="button" disabled={!(t > 0)}
                      onClick={() => { if (t > 0) onElegir(d, t); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', textAlign: 'left',
                               padding: '8px 10px', borderRadius: 8, cursor: t > 0 ? 'pointer' : 'not-allowed',
                               border: `1.5px solid ${sel ? 'var(--warn)' : 'var(--border)'}`,
                               background: sel ? 'var(--warn-soft,#fef3c7)' : 'var(--bg-elev)' }}>
                <Icon name={sel ? 'check' : 'calendar'} size={13} style={{ color: sel ? 'var(--warn)' : 'var(--text-muted)' }} />
                <span style={{ fontWeight: 600, fontSize: 12.5, minWidth: 96 }}>{fmt.date(d.dia)}</span>
                <span className="mono" style={{ fontSize: 12.5 }}>{t > 0 ? `${t} Bs/USD` : 'sin tasa'}</span>
                {t > 0 && saldoUsd > 0 && (
                  <span className="small muted" style={{ fontSize: 11 }}>saldo ≈ {fmt.ves(enBs)}</span>
                )}
                {/* El BCV cambió DENTRO de ese día (pasó el 2026-08-04). Se ofrece el valor de
                    cierre, que es el que el sistema tenía, pero se avisa: si el pago entró a la
                    mañana pudo ser otro, y eso lo sabe quien cobró, no nosotros. */}
                {d.vario && (
                  <span className="small" style={{ fontSize: 10.5, color: 'var(--warn)', flexBasis: '100%' }}>
                    ⚠ Ese día la tasa cambió — este es el valor con el que cerró.
                  </span>
                )}
              </button>
            );
          })}
          {diaElegido && (
            <div className="small" style={{ fontSize: 11.5, color: '#92400e' }}>
              Se registrará con fecha <strong>{fmt.date(diaElegido.dia)}</strong> y tasa{' '}
              <strong>{tasaDelDia(diaElegido)} Bs/USD</strong>, no con la de hoy ({tasaHoy}).
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Historial de pagos de una nota ────────────────────────────────────────────────────────────
// Pedido del usuario (2026-08-06): un cliente pagó en bolívares y no encontraban ese pago mirando
// la nota; tampoco había dónde ver si se le había aplicado una retención.
//
// Lo que había en el detalle de la factura era `fecha · método` y el monto EN DÓLARES. Ese es
// justamente el dato con el que NO se puede buscar: quien revisa tiene el comprobante del banco en
// bolívares en la mano, y 74.878,00 Bs no se parece en nada a $100,00. Acá el monto se muestra en
// LA MONEDA EN QUE SE PAGÓ, con su tasa, y el equivalente en dólares al lado como referencia.
//
// Las RETENCIONES van en la misma línea de tiempo. Viven en otra tabla (`retenciones`, no en el
// jsonb de pagos), así que antes no aparecían en ningún historial: la cuenta se saldaba y nadie
// veía por qué. Se marcan distinto porque no son plata que entró — son deuda que se dio de baja.
//
// `cxc` puede venir del snapshot (jsonb `pagos`) o de CxP; `documentoId` es la factura, para
// buscar la retención por los dos caminos.
window.HistorialPagos = function HistorialPagos({ cxc, documentoId, titulo = 'Historial de pagos', compacto = false }) {
  const { useState: uSt, useEffect: uEf, useMemo: uMe } = React;
  const [rets, setRets] = uSt(null);       // null = cargando
  const [error, setError] = uSt('');

  uEf(() => {
    let vivo = true;
    const cuentaId = cxc?.id || null;
    if (!cuentaId && !documentoId) { setRets([]); return; }
    window.retencionesDeCuenta?.({ cuentaId, documentoId })
      .then(r => { if (!vivo) return; if (r?.error) { setError('No se pudieron cargar las retenciones.'); setRets([]); } else setRets(r.data || []); })
      .catch(() => { if (vivo) { setError('No se pudieron cargar las retenciones.'); setRets([]); } });
    return () => { vivo = false; };
  }, [cxc?.id, documentoId]);

  // Los pagos del jsonb de la cuenta, unidos con el ledger si ya está en memoria (lo indexa
  // `ensurePagos`). Dedup por id: el mismo pago puede venir por los dos lados.
  const pagos = uMe(() => {
    const base = Array.isArray(cxc?.pagos) ? cxc.pagos : [];
    const delLedger = (window.__ssPagosPorDoc && documentoId) ? (window.__ssPagosPorDoc[documentoId] || []) : [];
    const vistos = new Set();
    const out = [];
    for (const p of [...base, ...delLedger]) {
      const k = String(p?.id || '') + '|' + String(p?.fecha || '') + '|' + String(p?.monto ?? p?.monto_usd ?? '');
      if (vistos.has(k)) continue;
      vistos.add(k);
      out.push(p);
    }
    return out.sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));
  }, [cxc, documentoId, cxc?.pagos?.length]);

  const num = (v) => Math.abs(parseFloat(v) || 0);
  const totalPagos = pagos.reduce((s, p) => s + num(p.monto_usd ?? p.montoUsd ?? p.monto), 0);
  const totalRet   = (rets || []).reduce((s, r) => s + num(r.monto_usd), 0);
  const montoCta   = num(cxc?.monto);
  const saldo      = Math.max(0, Math.round((montoCta - totalPagos - totalRet) * 100) / 100);

  const nada = pagos.length === 0 && (rets || []).length === 0;

  const cel = { padding: '6px 8px', fontSize: 12.5, borderBottom: '1px solid var(--border)', verticalAlign: 'top' };
  const th  = { padding: '5px 8px', fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid var(--border)', textAlign: 'left' };

  // Una fila por evento, en orden. Las retenciones se intercalan por fecha con los pagos: es UNA
  // línea de tiempo, no dos listas — el usuario quiere ver qué le pasó a la nota, en orden.
  const eventos = [
    ...pagos.map(p => ({ t: 'pago', fecha: p.fecha, d: p })),
    ...(rets || []).map(r => ({ t: 'ret', fecha: r.fecha, d: r })),
  ].sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '9px 12px', background: 'var(--bg-sunken)', display: 'flex',
                    alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Icon name="receipt" size={14} style={{ color: 'var(--brand)' }} />
        <strong style={{ fontSize: 13 }}>{titulo}</strong>
        <span className="small muted" style={{ marginLeft: 'auto' }}>
          {eventos.length} movimiento{eventos.length === 1 ? '' : 's'}
        </span>
      </div>

      {rets === null && <div className="small muted" style={{ padding: '12px' }}>Cargando…</div>}
      {error && <div className="small" style={{ padding: '12px', color: 'var(--danger)' }}>{error}</div>}

      {rets !== null && nada && (
        <div className="small muted" style={{ padding: '14px 12px' }}>
          Todavía no se registró ningún pago ni retención en esta nota.
        </div>
      )}

      {rets !== null && !nada && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: compacto ? 0 : 520 }}>
            <thead>
              <tr>
                <th style={th}>Fecha</th>
                <th style={th}>Qué fue</th>
                <th style={{ ...th, textAlign: 'right' }}>Monto cobrado</th>
                <th style={{ ...th, textAlign: 'right' }}>En dólares</th>
              </tr>
            </thead>
            <tbody>
              {eventos.map((ev, i) => {
                if (ev.t === 'ret') {
                  const r = ev.d;
                  return (
                    <tr key={'r' + i} style={{ background: 'var(--warn-soft,#fef3c7)' }}>
                      <td style={cel}>{fmt.date(r.fecha)}</td>
                      <td style={cel}>
                        <div style={{ fontWeight: 600, color: '#92400e' }}>
                          Retención de {String(r.tipo || '').toUpperCase() === 'ISLR' ? 'ISLR' : 'IVA'}
                        </div>
                        <div className="small muted" style={{ fontSize: 11 }}>
                          {r.numero_comprobante ? 'Comprobante ' + r.numero_comprobante : 'sin N° de comprobante'}
                          {r.creado_por ? ' · ' + r.creado_por : ''}
                        </div>
                        <div className="small" style={{ fontSize: 10.5, color: '#92400e' }}>
                          No entró al banco: baja la deuda.
                        </div>
                      </td>
                      <td style={{ ...cel, textAlign: 'right', color: '#92400e' }}>
                        {r.moneda && r.moneda !== 'USD' && num(r.monto) > 0
                          ? <>{fmt.bs(num(r.monto))}<div className="small muted" style={{ fontSize: 10 }}>tasa {r.tasa}</div></>
                          : '—'}
                      </td>
                      <td style={{ ...cel, textAlign: 'right', fontWeight: 700, color: '#92400e' }}>
                        {fmt.usd(num(r.monto_usd))}
                      </td>
                    </tr>
                  );
                }
                const p = ev.d;
                const moneda = p.moneda || 'USD';
                const enBs   = moneda !== 'USD';
                const tasa   = p.tasa_usada ?? p.tasa ?? null;
                return (
                  <tr key={'p' + i}>
                    <td style={cel}>
                      {fmt.date(p.fecha)}
                      {p.fecha_hora && <div className="small muted" style={{ fontSize: 10 }}>{fmt.hora ? fmt.hora(p.fecha_hora) : ''}</div>}
                    </td>
                    <td style={cel}>
                      <div style={{ fontWeight: 600 }}>
                        {p.metodo ? String(p.metodo).charAt(0).toUpperCase() + String(p.metodo).slice(1) : 'Pago'}
                        {p.banco ? ' · ' + p.banco : ''}
                      </div>
                      <div className="small muted" style={{ fontSize: 11 }}>
                        {/* La REFERENCIA es con lo que se busca el pago en el extracto del banco:
                            va visible, no escondida en el detalle. */}
                        {p.referencia ? 'Ref. ' + p.referencia : (p.banco ? 'sin referencia' : 'efectivo')}
                        {p.creado_por ? ' · ' + p.creado_por : ''}
                      </div>
                      {p.notas && <div className="small muted" style={{ fontSize: 10.5 }}>{p.notas}</div>}
                    </td>
                    {/* El monto EN LA MONEDA EN QUE SE PAGÓ, en grande: es el número que quien
                        revisa tiene en el comprobante del banco. */}
                    <td style={{ ...cel, textAlign: 'right' }}>
                      {enBs
                        ? <>
                            <strong>{fmt.bs(num(p.monto))}</strong>
                            {tasa > 0 && <div className="small muted" style={{ fontSize: 10 }}>tasa {tasa}</div>}
                          </>
                        : <strong>{fmt.usd(num(p.monto ?? p.monto_usd))}</strong>}
                    </td>
                    <td style={{ ...cel, textAlign: 'right', fontWeight: 600, color: 'var(--success)' }}>
                      {fmt.usd(num(p.monto_usd ?? p.montoUsd ?? p.monto))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--bg-sunken)' }}>
                <td style={{ ...cel, fontWeight: 700 }} colSpan={3}>Cobrado</td>
                <td style={{ ...cel, textAlign: 'right', fontWeight: 700, color: 'var(--success)' }}>{fmt.usd(totalPagos)}</td>
              </tr>
              {totalRet > 0 && (
                <tr style={{ background: 'var(--bg-sunken)' }}>
                  <td style={{ ...cel, fontWeight: 700, color: '#92400e' }} colSpan={3}>Retenido (no entró al banco)</td>
                  <td style={{ ...cel, textAlign: 'right', fontWeight: 700, color: '#92400e' }}>{fmt.usd(totalRet)}</td>
                </tr>
              )}
              {montoCta > 0 && (
                <tr style={{ background: 'var(--bg-sunken)' }}>
                  <td style={{ ...cel, fontWeight: 700 }} colSpan={3}>Queda por cobrar</td>
                  <td style={{ ...cel, textAlign: 'right', fontWeight: 700, color: saldo > 0.005 ? 'var(--danger)' : 'var(--success)' }}>
                    {fmt.usd(saldo)}
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
};

// ── Scrollbar horizontal flotante ──────────────────────────────────────────────────────────────
// Pedido (2026-08-14): en las tablas anchas (facturas/órdenes/cotizaciones/despachos) el scroll
// horizontal nativo queda al final de la tabla — con la pestaña llena de filas hay que bajar toda
// la página para alcanzarlo. Esta barra se clava en el borde inferior de la VENTANA (no de la
// tabla) mientras la tabla está a la vista, así que siempre está a mano sin importar en qué parte
// de la tabla se está mirando. `targetRef` es la referencia al contenedor con `overflow-x`.
window.FloatingHScrollbar = function FloatingHScrollbar({ targetRef }) {
  const { useState: uSt, useEffect: uEf, useRef: uRef } = React;
  const [visible, setVisible] = uSt(false);
  const [geo, setGeo] = uSt({ left: 0, width: 0, content: 0 });
  const barRef = uRef(null);
  const syncingRef = uRef(false);

  uEf(() => {
    function medir() {
      const el = targetRef.current;
      if (!el) { setVisible(false); return; }
      const rect = el.getBoundingClientRect();
      const desborda = el.scrollWidth > el.clientWidth + 1;
      // Solo se muestra si la tabla desborda Y el scrollbar propio (al pie de la tabla) NO está
      // a la vista — si ya se ve el de abajo, la barra flotante sería una segunda copia inútil.
      const enPantalla = rect.top < window.innerHeight && rect.bottom > 0;
      const propioFueraDeVista = rect.bottom > window.innerHeight || rect.top < 0;
      setVisible(desborda && enPantalla && propioFueraDeVista);
      setGeo({ left: Math.max(rect.left, 0), width: Math.min(rect.width, window.innerWidth - Math.max(rect.left, 0)), content: el.scrollWidth });
    }
    medir();
    window.addEventListener('scroll', medir, true);
    window.addEventListener('resize', medir);
    let ro;
    if (window.ResizeObserver && targetRef.current) { ro = new ResizeObserver(medir); ro.observe(targetRef.current); }
    return () => {
      window.removeEventListener('scroll', medir, true);
      window.removeEventListener('resize', medir);
      ro?.disconnect();
    };
  }, [targetRef]);

  // Sincroniza en los dos sentidos, con guarda para no entrar en bucle (cada scroll dispara el
  // handler del otro lado).
  uEf(() => {
    const el = targetRef.current;
    if (!el) return;
    function onTarget() {
      if (syncingRef.current) return;
      syncingRef.current = true;
      if (barRef.current) barRef.current.scrollLeft = el.scrollLeft;
      syncingRef.current = false;
    }
    el.addEventListener('scroll', onTarget);
    return () => el.removeEventListener('scroll', onTarget);
  }, [targetRef]);

  function onBarScroll(e) {
    if (syncingRef.current) return;
    syncingRef.current = true;
    if (targetRef.current) targetRef.current.scrollLeft = e.target.scrollLeft;
    syncingRef.current = false;
  }

  if (!visible) return null;
  return ReactDOM.createPortal(
    <div
      ref={el => { if (el && targetRef.current) el.scrollLeft = targetRef.current.scrollLeft; barRef.current = el; }}
      onScroll={onBarScroll}
      style={{
        position: 'fixed', bottom: 0, left: geo.left, width: geo.width, height: 14,
        overflowX: 'auto', overflowY: 'hidden', zIndex: 500,
        background: 'var(--bg-elev)', borderTop: '1px solid var(--border-strong)',
      }}
    >
      <div style={{ width: geo.content, height: 1 }} />
    </div>,
    document.body
  );
};

// ── Columnas de una tabla: ocultarlas y ajustarles el ancho ───────────────────────────────────
// Pedido del usuario (2026-08-06): poder ensanchar la columna del nombre del producto para verlo
// completo, y un ícono para ESCONDER columnas (no borrarlas) y tener una vista más limpia. En todos
// los módulos que tengan tablas.
//
// POR QUÉ TRABAJA SOBRE EL DOM Y NO SOBRE UNA LISTA DE COLUMNAS:
//   `<DataTable>` existe pero lo usan 2 de 20 archivos; el resto arma `<table className="tbl">` a
//   mano, cada una con su propio `<thead>`. Una API declarativa obligaría a reescribir las ~70
//   tablas del proyecto. Este componente LEE los `<th>` ya renderizados y aplica reglas CSS por
//   posición (`nth-child`), así funciona sobre el marcado que ya existe: se enchufa con una línea.
//
// POR QUÉ CSS INYECTADO Y NO ESTILO POR CELDA:
//   Ocultar una columna tocando cada `<td>` obliga a que el componente conozca las filas. Con una
//   regla `nth-child` alcanza una sola declaración para toda la tabla, y sigue funcionando cuando
//   la tabla se repagina o se reordena sola.
//
// Lo elegido se guarda por módulo (`ss-{moduloId}-cols`): es preferencia de quien mira, no del dato.
window.TablaColumnas = function TablaColumnas({ moduloId, tablaRef, style = {} }) {
  const { useState: uSt, useEffect: uEf, useRef: uRef } = React;
  const [abierto, setAbierto] = uSt(false);
  const [cols, setCols]       = uSt([]);        // [{ i, label }] leídas del <thead>
  const [pref, setPref]       = window.usePersistedState(`ss-${moduloId}-cols`, { ocultas: [], anchos: {} });
  const boxRef  = uRef(null);
  const styleRef = uRef(null);

  // ── Vistas guardadas POR USUARIO (2026-08-14) ───────────────────────────────────────────────
  // `pref` de arriba es "lo que estoy viendo ahora" (localStorage, por navegador). Esto es el
  // catálogo de vistas con nombre que el usuario decide guardar explícitamente — vive en Supabase
  // (`vistas_columnas`), así que lo hereda en cualquier equipo donde inicie sesión.
  const [vistas, setVistas]         = uSt([]);
  const [vistasCarg, setVistasCarg] = uSt(false);
  const [nombreVista, setNombreVista] = uSt('');
  const [guardando, setGuardando]   = uSt(false);

  async function cargarVistas() {
    if (!window.loadVistasColumnas) return;
    setVistasCarg(true);
    setVistas(await window.loadVistasColumnas(moduloId));
    setVistasCarg(false);
  }
  function aplicarVista(v) {
    setPref({ ocultas: Array.isArray(v.config?.ocultas) ? v.config.ocultas : [], anchos: (v.config?.anchos && typeof v.config.anchos === 'object') ? v.config.anchos : {} });
  }
  async function guardarVistaActual() {
    const nombre = nombreVista.trim();
    if (!nombre || guardando) return;
    setGuardando(true);
    const res = await window.guardarVistaColumnas?.(moduloId, nombre, { ocultas, anchos });
    setGuardando(false);
    if (res?.error) { alert('No se pudo guardar la vista: ' + (res.error.message || '')); return; }
    setNombreVista('');
    cargarVistas();
  }
  async function borrarVista(v) {
    if (!confirm(`¿Borrar la vista "${v.nombre}"?`)) return;
    const res = await window.eliminarVistaColumnas?.(v.id);
    if (res?.error) { alert('No se pudo borrar: ' + (res.error.message || '')); return; }
    setVistas(prev => prev.filter(x => x.id !== v.id));
  }

  const ocultas = Array.isArray(pref?.ocultas) ? pref.ocultas : [];
  const anchos  = (pref && typeof pref.anchos === 'object' && pref.anchos) || {};

  // Lee los encabezados del DOM. Se re-lee al abrir el panel (no en cada render): las tablas
  // cambian de columnas según permisos y filtros, y una lista congelada al montar mentiría.
  function leerColumnas() {
    const t = tablaRef?.current;
    if (!t) return [];
    const ths = t.querySelectorAll('thead tr:first-child > th');
    const out = [];
    ths.forEach((th, i) => {
      const txt = (th.innerText || '').replace(/\s+/g, ' ').trim();
      // La primera columna suele ser el checkbox de selección y no tiene texto: esconderla dejaría
      // la tabla sin forma de seleccionar, así que no se ofrece.
      if (!txt) return;
      out.push({ i: i + 1, label: txt.slice(0, 40) });
    });
    return out;
  }

  // Una sola hoja de estilo por tabla, con un id propio para no pisar la de otro módulo. Se separa
  // en una función (`pintar`) porque el drag-resize la vuelve a llamar en cada frame con un ancho
  // "en vivo" que todavía no se guardó (`anchosRef.current`), y reconstruir el <style> es mucho más
  // barato que tocar el `style` inline de cada celda de cada fila.
  const anchosRef = uRef(anchos);
  function pintar(anchosActuales) {
    const t = tablaRef?.current;
    if (!t) return;
    if (!t.dataset.ssCols) t.dataset.ssCols = moduloId;
    let el = styleRef.current;
    if (!el) {
      el = document.createElement('style');
      el.dataset.ssColsFor = moduloId;
      document.head.appendChild(el);
      styleRef.current = el;
    }
    const sel = `table[data-ss-cols="${moduloId}"]`;
    const reglas = [];
    for (const i of ocultas) reglas.push(`${sel} > thead > tr > *:nth-child(${i}), ${sel} > tbody > tr > *:nth-child(${i}) { display: none !important; }`);
    for (const [i, w] of Object.entries(anchosActuales)) {
      if (!(w > 0)) continue;
      // `max-width` + `white-space: normal` para que el texto largo se acomode en varias líneas en
      // vez de quedar cortado con puntos suspensivos: ver el nombre completo era el pedido.
      reglas.push(`${sel} > thead > tr > *:nth-child(${i}), ${sel} > tbody > tr > *:nth-child(${i}) { width: ${w}px; min-width: ${w}px; max-width: ${w}px; white-space: normal; overflow: visible; text-overflow: clip; }`);
    }
    // El asa de arrastre: una franja invisible de 6px en el borde derecho de cada encabezado.
    // Es CSS puro (no un <div> por columna en 70 tablas); el mousedown que la detecta compara la
    // posición del clic contra `getBoundingClientRect()` del <th>, ver `onHeaderMouseDown`.
    reglas.push(`${sel} > thead > tr > th { position: relative; }`);
    reglas.push(`${sel} > thead > tr > th::after { content: ''; position: absolute; top: 0; bottom: 0; right: -3px; width: 7px; cursor: col-resize; z-index: 1; }`);
    el.textContent = reglas.join('\n');
  }
  uEf(() => { anchosRef.current = anchos; pintar(anchos); }, [moduloId, JSON.stringify(ocultas), JSON.stringify(anchos)]);

  // Al desmontar se limpia la hoja: si no, la regla sigue viva y se aplica a la tabla del módulo
  // siguiente que reuse el mismo id.
  uEf(() => () => { if (styleRef.current) { styleRef.current.remove(); styleRef.current = null; } }, []);

  // ── Arrastrar el borde del encabezado para agrandar/reducir la columna ──────────────────────
  // Reemplaza al slider que vivía en el panel "Columnas" (pedido 2026-08-14: "que con el mouse se
  // pueda hacer clic en el header donde termina y arrastrarlo", no un control aparte). Mientras se
  // arrastra se repinta solo el <style> inyectado (barato); recién al soltar se persiste — arrastrar
  // no puede escribir en localStorage en cada pixel.
  uEf(() => {
    const t = tablaRef?.current;
    if (!t) return;
    let dragging = null; // { i, startX, startWidth, ultimo }
    function onMouseDown(e) {
      const th = e.target.closest('th');
      if (!th || !t.contains(th)) return;
      const rect = th.getBoundingClientRect();
      if (rect.right - e.clientX > 8) return;   // solo si el clic fue cerca del borde derecho
      const fila = th.parentElement;
      const i = Array.prototype.indexOf.call(fila.children, th) + 1;
      dragging = { i, startX: e.clientX, startWidth: rect.width, ultimo: Math.round(rect.width) };
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    }
    function onMouseMove(e) {
      if (!dragging) return;
      dragging.ultimo = Math.max(50, Math.round(dragging.startWidth + (e.clientX - dragging.startX)));
      pintar({ ...anchosRef.current, [dragging.i]: dragging.ultimo });
    }
    function onMouseUp() {
      if (!dragging) return;
      setAncho(dragging.i, dragging.ultimo);   // recién al soltar se persiste (ver comentario de arriba)
      dragging = null;
      document.body.style.cursor = '';
    }
    t.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      t.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [moduloId]);

  uEf(() => {
    if (!abierto) return;
    const fuera = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setAbierto(false); };
    const esc = (e) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc); };
  }, [abierto]);

  function abrir() {
    const c = leerColumnas();
    setCols(c);
    setAbierto(v => !v);
    cargarVistas();
  }
  function toggle(i) {
    setPref(p => {
      const oc = Array.isArray(p?.ocultas) ? p.ocultas : [];
      return { ...p, ocultas: oc.includes(i) ? oc.filter(x => x !== i) : [...oc, i] };
    });
  }
  function setAncho(i, w) {
    setPref(p => ({ ...p, anchos: { ...(p?.anchos || {}), [i]: w } }));
  }
  function restaurar() { setPref({ ocultas: [], anchos: {} }); }

  const nOcultas = ocultas.length;
  const nAnchos  = Object.keys(anchos).length;

  return (
    <div ref={boxRef} style={{ position: 'relative', ...style }}>
      <button className="btn ghost sm" onClick={abrir}
              title="Mostrar u ocultar columnas y ajustar su ancho"
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Icon name="columns" size={14} />
        Columnas
        {(nOcultas > 0 || nAnchos > 0) && (
          <span style={{ background: 'var(--brand)', color: '#fff', borderRadius: 9, padding: '0 6px', fontSize: 10, fontWeight: 700 }}>
            {nOcultas || '·'}
          </span>
        )}
      </button>
      {abierto && (
        <div className="ss-cols-panel" style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 600,
                      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
                      boxShadow: '0 8px 28px rgba(0,0,0,.16)', width: 300, maxHeight: 420, overflowY: 'auto' }}>
          <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Columnas
            </span>
            <button className="btn ghost sm" style={{ fontSize: 11, padding: '2px 7px' }} onClick={restaurar}>
              Restaurar
            </button>
          </div>
          {cols.length === 0 && (
            <div style={{ padding: '16px 12px', fontSize: 12.5, color: 'var(--text-muted)' }}>
              No se pudieron leer las columnas de esta tabla.
            </div>
          )}
          {cols.map(c => {
            const oculta = ocultas.includes(c.i);
            return (
              <div key={c.i} style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle, #f0f0f0)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!oculta} onChange={() => toggle(c.i)} />
                  <span style={{ fontSize: 12.5, fontWeight: oculta ? 400 : 600,
                                 color: oculta ? 'var(--text-muted)' : 'var(--text)',
                                 overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.label}
                  </span>
                  {!oculta && anchos[c.i] > 0 && (
                    <span className="mono small muted" style={{ fontSize: 10, marginLeft: 'auto' }}>{anchos[c.i]}px</span>
                  )}
                </label>
              </div>
            );
          })}
          {/* El ancho ya no se ajusta acá con un slider (2026-08-14): se arrastra directo el borde
              derecho del encabezado de la tabla, como en una hoja de cálculo. */}
          <div className="small muted" style={{ padding: '9px 12px', fontSize: 10.5, lineHeight: 1.45, borderBottom: '1px solid var(--border)' }}>
            Ocultar una columna no borra nada: solo deja de mostrarse acá. Para cambiar el ancho,
            arrastra el borde derecho del encabezado de la columna en la tabla.
          </div>

          {/* Vistas guardadas — por usuario (no por navegador): quedan disponibles en cualquier
              equipo donde el mismo usuario inicie sesión. */}
          <div style={{ padding: '10px 12px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
              Mis vistas guardadas
            </div>
            {vistasCarg && <div className="small muted" style={{ fontSize: 12 }}>Cargando…</div>}
            {!vistasCarg && vistas.length === 0 && (
              <div className="small muted" style={{ fontSize: 12 }}>Todavía no guardaste ninguna.</div>
            )}
            {vistas.map(v => (
              <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                <button className="btn ghost sm" style={{ flex: 1, justifyContent: 'flex-start', fontSize: 12.5, padding: '4px 6px' }}
                        onClick={() => aplicarVista(v)} title="Aplicar esta vista">
                  <Icon name="eye" size={13} />{v.nombre}
                </button>
                <button className="btn ghost sm" style={{ padding: '4px 6px', color: 'var(--danger)' }}
                        onClick={() => borrarVista(v)} title="Borrar esta vista">
                  <Icon name="trash" size={13} />
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input className="input" style={{ flex: 1, fontSize: 12.5, padding: '5px 8px' }}
                     placeholder="Nombre de la vista…" value={nombreVista}
                     onChange={e => setNombreVista(e.target.value)}
                     onKeyDown={e => { if (e.key === 'Enter') guardarVistaActual(); }} />
              <button className="btn secondary sm" disabled={!nombreVista.trim() || guardando} onClick={guardarVistaActual}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// DateRangeFilter — un solo campo desplegable con presets + "Desde"/"Hasta" juntos (evita 2 inputs
// sueltos en la toolbar). Controlado: desde/hasta (strings 'YYYY-MM-DD' o ''), onChange(desde,hasta).
// presets opcional: [{ id, label, range(): [desdeISO, hastaISO] }] — si no se pasa, usa el set default
// (Hoy/Ayer/Esta semana/Sem. pasada/Este mes/Mes pasado).
window.DateRangeFilter = function DateRangeFilter({ desde, hasta, onChange, presets, style = {} }) {
  const { useState: uSt, useRef: uRef, useEffect: uEf } = React;
  const [open, setOpen] = uSt(false);
  const ref = uRef(null);

  uEf(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toISO = d => d.toISOString().slice(0, 10);
  const getLunes = d => { const r = new Date(d); r.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return r; };
  const DEFAULT_PRESETS = [
    { id:'hoy',           label:'Hoy',          range: () => { const h = new Date(window.localDateStr()+'T12:00:00'); return [toISO(h), toISO(h)]; } },
    { id:'ayer',          label:'Ayer',         range: () => { const h = new Date(window.localDateStr()+'T12:00:00'); const a = new Date(h); a.setDate(h.getDate()-1); return [toISO(a), toISO(a)]; } },
    { id:'semana',        label:'Esta semana',  range: () => { const h = new Date(window.localDateStr()+'T12:00:00'); return [toISO(getLunes(h)), toISO(h)]; } },
    { id:'semana-pasada', label:'Sem. pasada',  range: () => { const h = new Date(window.localDateStr()+'T12:00:00'); const lp = getLunes(new Date(h.getTime()-7*86400000)); const dp = new Date(lp); dp.setDate(lp.getDate()+6); return [toISO(lp), toISO(dp)]; } },
    { id:'mes',           label:'Este mes',     range: () => { const h = new Date(window.localDateStr()+'T12:00:00'); return [toISO(new Date(h.getFullYear(), h.getMonth(), 1)), toISO(h)]; } },
    { id:'mes-pasado',    label:'Mes pasado',   range: () => { const h = new Date(window.localDateStr()+'T12:00:00'); const pm = new Date(h.getFullYear(), h.getMonth()-1, 1); const um = new Date(h.getFullYear(), h.getMonth(), 0); return [toISO(pm), toISO(um)]; } },
  ];
  const opts = presets || DEFAULT_PRESETS;

  function applyPreset(p) {
    const [d, h] = p.range();
    onChange(d, h);
    setOpen(false);
  }
  function clear() { onChange('', ''); }

  const fmtDMY = s => { if (!s) return ''; const [y,m,d] = s.split('-'); return `${d}/${m}/${y.slice(2)}`; };
  // Un solo día se rotula como tal: "07/02/26 → 07/02/26" se lee como un rango y hace dudar.
  const label = (desde && desde === hasta) ? fmtDMY(desde)
    : (desde || hasta) ? `${desde ? fmtDMY(desde) : '…'} → ${hasta ? fmtDMY(hasta) : '…'}`
    : 'Todas las fechas';

  return (
    <div className="ss-wrap" ref={ref} style={{ position:'relative', ...style }}>
      <button type="button" className={`select ss-btn${(desde || hasta) ? ' on' : ''}`} onClick={() => setOpen(o => !o)}
        style={{ display:'flex', alignItems:'center', gap:6, whiteSpace:'nowrap' }}>
        <Icon name="clock" size={13}/>
        <span>{label}</span>
        <Icon name="chevronD" size={12}/>
      </button>
      {/* Popover anclado a la IZQUIERDA (crece a la derecha, donde hay espacio dentro de .tbl-wrap
          con overflow:hidden). Con right:0/left:auto + minWidth>ancho-del-botón se desbordaba a la
          izquierda y .tbl-wrap lo recortaba. width:280 fija (no minWidth). */}
      {open && (
        <div className="ss-dropdown" style={{ left:0, right:'auto', width:280, padding:12 }}>
          <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:10 }}>
            {opts.map(p => (
              <button key={p.id} type="button" className="btn ghost sm" style={{ fontSize:11.5, padding:'3px 9px' }} onClick={() => applyPreset(p)}>{p.label}</button>
            ))}
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <div style={{ flex:1 }}>
              <div className="small muted" style={{ marginBottom:3 }}>Desde</div>
              <input type="date" className="input" value={desde || ''} onChange={e => onChange(e.target.value, hasta)} style={{ width:'100%', fontSize:12.5, padding:'4px 7px' }}/>
            </div>
            <div style={{ flex:1 }}>
              <div className="small muted" style={{ marginBottom:3 }}>Hasta</div>
              <input type="date" className="input" value={hasta || ''} onChange={e => onChange(desde, e.target.value)} style={{ width:'100%', fontSize:12.5, padding:'4px 7px' }}/>
            </div>
          </div>
          {/* UN DÍA ÚNICO en un clic. Pedido explícito ("que permita elegir un rango de fechas así
              como un día único también"): con dos campos sueltos hay que escribir la misma fecha dos
              veces, y quien pone solo "Desde" cree que está mirando ese día cuando en realidad está
              mirando desde ese día hasta hoy — que es un error silencioso, no un error visible. */}
          {desde && desde !== hasta && (
            <button type="button" className="btn secondary sm" onClick={() => { onChange(desde, desde); setOpen(false); }}
              style={{ marginTop:10, width:'100%' }}>
              Solo el {fmtDMY(desde)}
            </button>
          )}
          {hasta && !desde && (
            <button type="button" className="btn secondary sm" onClick={() => { onChange(hasta, hasta); setOpen(false); }}
              style={{ marginTop:10, width:'100%' }}>
              Solo el {fmtDMY(hasta)}
            </button>
          )}
          {(desde || hasta) && (
            <button type="button" className="btn ghost sm" onClick={clear} style={{ marginTop:8, width:'100%', color:'var(--danger)' }}>
              <Icon name="x" size={12}/>Limpiar rango
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// SearchSelect — dropdown with filter input, supports groups
// options: [{ value, label, sublabel, group }]
// value/onChange: controlled; placeholder: string
// createOptions: [{ label, icon?, onSelect(q) }] — shown at bottom when q has no results
// `className` se agrega al botón para poder reusar el componente en filas
// compactas sin duplicarlo (ej. la columna interna verde de proveedor en el
// carrito del POS usa `ss-btn-mini`). Es aditivo: quien no lo pase no cambia.
// `onSearchRemote(q)` → modo BÚSQUEDA REMOTA: en vez de filtrar una lista que ya está en
// memoria, se le pregunta al servidor a medida que se escribe. Es lo que permite que el POS
// no tenga que descargar los 13k clientes para poder elegir uno. Sin esa prop el componente
// se comporta exactamente como antes (filtrado local sobre `options`).
window.SearchSelect = function SearchSelect({ value, onChange, options = [], placeholder = 'Seleccionar...', style = {}, createOptions = [], className = '',
                                             onSearchRemote = null, remoteMinChars = 2, selectedLabel = '' }) {
  const { useState: uSt, useRef: uRef, useEffect: uEf, useLayoutEffect: uLEf } = React;
  const [open, setOpen] = uSt(false);
  const [q, setQ] = uSt('');
  const [remote, setRemote] = uSt([]);
  const [buscando, setBuscando] = uSt(false);
  const ref = uRef(null);
  // El dropdown se porta a `document.body` (ver `pos` más abajo): dentro de una tabla ancha con
  // scroll horizontal (ej. la columna "Proveedor" del detalle de un documento), quedaba recortado
  // por el `overflow` del contenedor de la tabla en vez de desplegarse por fuera. `dropRef` es el
  // dropdown portado — el listener de "clic afuera" necesita las DOS referencias, porque una vez
  // portado el dropdown deja de ser descendiente de `ref` en el DOM.
  const dropRef = uRef(null);
  const [pos, setPos] = uSt(null); // {top,left,width} en coordenadas de viewport (position:fixed)

  // Todo lo que este selector llegó a ver (local + remoto). Sin esto, al elegir un resultado
  // remoto el botón volvía al placeholder: el valor elegido no estaba en `options`.
  const vistasRef = uRef(new Map());

  uEf(() => {
    function handler(e) {
      if (ref.current && ref.current.contains(e.target)) return;
      if (dropRef.current && dropRef.current.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Posición del dropdown portado: se calcula al abrir y se recalcula si la página se mueve
  // (scroll de un contenedor ancestro, resize) mientras está abierto — si no, quedaría "pegado"
  // en el punto donde se abrió aunque la tabla se haya desplazado por debajo.
  uLEf(() => {
    if (!open || !ref.current) { setPos(null); return; }
    function calc() {
      const r = ref.current.getBoundingClientRect();
      // Ancho mínimo 240px (antes lo daba la regla CSS `.ss-btn-mini + .ss-dropdown`, que dejó de
      // aplicar al dejar de ser hermano en el DOM): la variante compacta de las columnas internas
      // del POS es angosta (~110px) y el buscador/lista necesitan más espacio para leerse.
      const width = Math.max(r.width, 240);
      // Si no entra hacia abajo (dropdown cerca del borde inferior de la ventana) se abre hacia
      // arriba — mismo criterio que un <select> nativo.
      const espacioAbajo = window.innerHeight - r.bottom;
      const arriba = espacioAbajo < 280 && r.top > 280;
      setPos({
        left: Math.min(r.left, window.innerWidth - width - 8),
        width,
        top: arriba ? null : r.bottom + 4,
        bottom: arriba ? (window.innerHeight - r.top + 4) : null,
      });
    }
    calc();
    window.addEventListener('scroll', calc, true);
    window.addEventListener('resize', calc);
    return () => { window.removeEventListener('scroll', calc, true); window.removeEventListener('resize', calc); };
  }, [open]);

  // Debounce de 250 ms: sin él cada tecla dispara una consulta y las respuestas pueden
  // llegar desordenadas (la de "ma" después de la de "martinez"), mostrando resultados que
  // no corresponden a lo tecleado. `cancelado` descarta las respuestas viejas.
  uEf(() => {
    if (!onSearchRemote || !open) return;
    const term = q.trim();
    if (term.length < remoteMinChars) { setRemote([]); setBuscando(false); return; }
    let cancelado = false;
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const res = await onSearchRemote(term);
        if (cancelado) return;
        (res || []).forEach(o => vistasRef.current.set(o.value, o));
        setRemote(res || []);
      } catch (err) {
        if (!cancelado) setRemote([]);
        console.warn('[SearchSelect] búsqueda remota falló:', err?.message || err);
      } finally { if (!cancelado) setBuscando(false); }
    }, 250);
    return () => { cancelado = true; clearTimeout(t); };
  }, [q, open, onSearchRemote, remoteMinChars]);

  // Cap de opciones visibles: con catálogos grandes (ej. 13k clientes migrados de Odoo)
  // pintar todos los nodos al abrir el dropdown congelaba el navegador. Limitamos a 100
  // resultados; el usuario escribe para acotar. Cuando el filtro deja más de 100 se avisa.
  const MAX_OPTS = 100;
  const localMatched = q
    ? options.filter(o => (o.label + ' ' + (o.sublabel || '')).toLowerCase().includes(q.toLowerCase()))
    : options;
  // En modo remoto igual se aprovecha lo que ya está en memoria (se muestra sin esperar la
  // red) y se le suma lo que trae el servidor, sin repetir.
  const _matched = onSearchRemote
    ? (() => {
        const byVal = new Map();
        localMatched.forEach(o => byVal.set(o.value, o));
        remote.forEach(o => { if (!byVal.has(o.value)) byVal.set(o.value, o); });
        return [...byVal.values()];
      })()
    : localMatched;
  const _truncated = _matched.length > MAX_OPTS;
  const filtered = _truncated ? _matched.slice(0, MAX_OPTS) : _matched;

  options.forEach(o => { if (o.value === value) vistasRef.current.set(o.value, o); });
  const selected = options.find(o => o.value === value)
    || (value ? vistasRef.current.get(value) : null)
    || (value && selectedLabel ? { value, label: selectedLabel } : null);

  const groups = [...new Set(filtered.map(o => o.group).filter(Boolean))];
  const ungrouped = filtered.filter(o => !o.group);

  function renderOpts(opts) {
    return opts.map(o => (
      <div
        key={o.value}
        className={`ss-opt ${o.value === value ? 'sel' : ''}`}
        onMouseDown={() => { onChange(o.value); setOpen(false); setQ(''); }}
      >
        <div style={{fontWeight: 500, fontSize: 13}}>{o.label}</div>
        {o.sublabel && <div style={{fontSize: 11, color: 'var(--text-subtle)'}}>{o.sublabel}</div>}
      </div>
    ));
  }

  return (
    <div className="ss-wrap" ref={ref} style={style}>
      <button
        type="button"
        className={'select ss-btn' + (className ? ' ' + className : '')}
        onClick={() => { setOpen(o => !o); setQ(''); }}
      >
        {selected ? (
          <span style={{flex:1, textAlign:'left', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
            {selected.label}
          </span>
        ) : (
          <span style={{flex:1, textAlign:'left', color:'var(--text-subtle)'}}>{placeholder}</span>
        )}
        <Icon name="chevronD" size={13} />
      </button>
      {open && pos && ReactDOM.createPortal(
        <div className="ss-dropdown" ref={dropRef}
             style={{position:'fixed', top: pos.top ?? 'auto', bottom: pos.bottom ?? 'auto', left: pos.left, width: pos.width}}>
          <div className="ss-search">
            <Icon name="search" size={13} />
            <input
              autoFocus
              className="ss-input"
              placeholder="Buscar..."
              value={q}
              onChange={e => setQ(e.target.value)}
            />
          </div>
          <div className="ss-list">
            {value && (
              <div
                className="ss-opt ss-clear"
                onMouseDown={() => { onChange(''); setOpen(false); setQ(''); }}
              >
                — Sin selección
              </div>
            )}
            {groups.length > 0 ? (
              <>
                {groups.map(g => (
                  <div key={g}>
                    <div className="ss-group-label">{g}</div>
                    {renderOpts(filtered.filter(o => o.group === g))}
                  </div>
                ))}
                {ungrouped.length > 0 && renderOpts(ungrouped)}
              </>
            ) : renderOpts(filtered)}
            {_truncated && <div style={{padding:'6px 12px', color:'var(--text-subtle)', fontSize:11.5, borderTop:'1px solid var(--border)'}}>Mostrando {MAX_OPTS} de {_matched.length} — escribe para filtrar…</div>}
            {/* En modo remoto el vacío no significa "no existe": puede ser que todavía no se
                escribió lo suficiente o que la consulta está en curso. Decirlo evita que el
                vendedor concluya que el cliente no está y lo cree duplicado. */}
            {onSearchRemote && buscando && (
              <div style={{padding:'8px 12px', color:'var(--text-subtle)', fontSize:12, display:'flex', alignItems:'center', gap:7}}>
                <span className="ss-busy-spin"/>Buscando…
              </div>
            )}
            {onSearchRemote && !buscando && q.trim().length < remoteMinChars && filtered.length === 0 && (
              <div style={{padding:'8px 12px', color:'var(--text-subtle)', fontSize:12}}>
                Escribe al menos {remoteMinChars} letras para buscar…
              </div>
            )}
            {filtered.length === 0 && !(onSearchRemote && (buscando || q.trim().length < remoteMinChars)) && (
              <div style={{padding:'8px 12px', color:'var(--text-subtle)', fontSize:12}}>Sin resultados</div>
            )}
            {createOptions.length > 0 && q.length > 0 && (
              <div style={{borderTop: filtered.length > 0 ? '1px solid var(--border)' : 'none'}}>
                {createOptions.map((opt, i) => (
                  <div key={i} className="ss-opt ss-create-opt"
                    onMouseDown={e => { e.preventDefault(); opt.onSelect(q); setOpen(false); setQ(''); }}>
                    <span style={{color:'var(--brand)', fontWeight:500, display:'flex', alignItems:'center', gap:6}}>
                      {opt.icon && <Icon name={opt.icon} size={13}/>}
                      {opt.label.replace('{q}', q)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

// AdvancedSearch — búsqueda multi-término "contiene" con AND y filtros guardados.
// terms: string[] activos. Cada término debe estar contenido (case-insensitive) en el texto del item.
// onTermsChange: (newTerms[]) => void
// storageKey: clave de localStorage donde se persisten los filtros guardados (compartible entre módulos).
// matchItem(item, terms): helper exportado en window.AdvancedSearch.matches para evaluar AND-contains contra una lista de campos.
window.AdvancedSearch = function AdvancedSearch({ terms = [], onTermsChange, onInputChange, storageKey, placeholder = 'Escribe y presiona Enter para añadir...', style = {} }) {
  const { useState: uSt, useRef: uRef, useEffect: uEf } = React;
  const [input, setInput] = uSt('');

  // Emite el texto que se está tipeando en vivo (para filtrado en tiempo real).
  uEf(() => { if (onInputChange) onInputChange(input); }, [input]);
  const [savedFilters, setSavedFilters] = uSt([]);
  const [showMenu, setShowMenu] = uSt(false);
  const wrapRef = uRef(null);

  // Cargar filtros guardados: primero Supabase, fallback a localStorage (migración).
  uEf(() => {
    let active = true;
    if (!storageKey) { setSavedFilters([]); return; }
    (async () => {
      if (window.loadFiltrosGuardados) {
        try {
          const remote = await window.loadFiltrosGuardados(storageKey);
          if (!active) return;
          if (Array.isArray(remote) && remote.length > 0) {
            setSavedFilters(remote.map(r => ({ name: r.nombre, terms: Array.isArray(r.terms) ? r.terms : [] })));
            return;
          }
          // Si Supabase está vacío y localStorage tiene filtros, migrarlos.
          try {
            const local = JSON.parse(localStorage.getItem(storageKey) || '[]');
            if (Array.isArray(local) && local.length > 0) {
              setSavedFilters(local);
              for (const f of local) {
                if (window.guardarFiltro) await window.guardarFiltro(storageKey, f.name, f.terms);
              }
              return;
            }
          } catch (_) {}
          setSavedFilters([]);
        } catch (err) {
          console.warn('[AdvancedSearch] fallo cargando desde Supabase, usando localStorage:', err);
          try { setSavedFilters(JSON.parse(localStorage.getItem(storageKey) || '[]')); } catch { setSavedFilters([]); }
        }
      } else {
        try { setSavedFilters(JSON.parse(localStorage.getItem(storageKey) || '[]')); } catch { setSavedFilters([]); }
      }
    })();
    return () => { active = false; };
  }, [storageKey]);

  uEf(() => {
    function handler(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowMenu(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function persistSaved(next) {
    setSavedFilters(next);
    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next));
  }
  async function persistRemoteSave(filter) {
    if (window.guardarFiltro && storageKey && filter) {
      const { error } = await window.guardarFiltro(storageKey, filter.name, filter.terms);
      if (error) console.warn('[AdvancedSearch] Error guardando en Supabase:', error);
    }
  }
  async function persistRemoteDelete(name) {
    if (window.eliminarFiltroGuardado && storageKey && name) {
      const { error } = await window.eliminarFiltroGuardado(storageKey, name);
      if (error) console.warn('[AdvancedSearch] Error eliminando en Supabase:', error);
    }
  }

  function addTerm(raw) {
    const parts = String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) { setInput(''); return; }
    const lower = new Set(terms.map(x => x.toLowerCase()));
    const fresh = [];
    parts.forEach(p => { if (!lower.has(p.toLowerCase())) { lower.add(p.toLowerCase()); fresh.push(p); } });
    if (fresh.length) onTermsChange([...terms, ...fresh]);
    setInput('');
  }
  function removeTerm(t) { onTermsChange(terms.filter(x => x !== t)); }

  function handleKey(e) {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTerm(input); }
    else if (e.key === 'Backspace' && !input && terms.length > 0) { removeTerm(terms[terms.length - 1]); }
  }

  function saveCurrent() {
    if (terms.length === 0) return;
    const suggested = terms.join(' + ');
    const name = prompt('Nombre del filtro guardado:', suggested);
    if (!name || !name.trim()) return;
    const nm = name.trim();
    if (savedFilters.some(f => f.name === nm) && !confirm(`Ya existe un filtro "${nm}". ¿Sobreescribir?`)) return;
    const newFilter = { name: nm, terms: [...terms] };
    const next = [...savedFilters.filter(f => f.name !== nm), newFilter]
      .sort((a,b) => a.name.localeCompare(b.name, 'es'));
    persistSaved(next);
    persistRemoteSave(newFilter);
    setShowMenu(false);
  }
  function loadSaved(f) { onTermsChange([...f.terms]); setShowMenu(false); }
  function deleteSaved(name) {
    if (!confirm(`¿Eliminar el filtro guardado "${name}"?`)) return;
    persistSaved(savedFilters.filter(f => f.name !== name));
    persistRemoteDelete(name);
  }

  const hasContent = terms.length > 0 || input.length > 0;

  return (
    <div className="adv-search" ref={wrapRef} style={style}>
      <div className="adv-search-box" onClick={() => { const i = wrapRef.current?.querySelector('.adv-search-input'); i?.focus(); }}>
        <Icon name="search" size={13} className="adv-search-icon"/>
        <div className="adv-search-chips">
          {terms.map(t => {
            const isExclude = String(t).startsWith('-');
            const label = isExclude ? t.slice(1) : t;
            function toggleMode(e) {
              e.stopPropagation();
              const next = isExclude ? label : '-' + t;
              onTermsChange(terms.map(x => x === t ? next : x));
            }
            return (
              <span key={t} className={'adv-search-chip' + (isExclude ? ' exclude' : '')}
                title={isExclude ? `No contiene "${label}"` : `Contiene "${label}" · click ± para excluir`}>
                <button type="button" className="adv-search-chip-mode" onClick={toggleMode}
                  title={isExclude ? 'Cambiar a "contiene"' : 'Cambiar a "no contiene"'}>
                  {isExclude ? '−' : '+'}
                </button>
                {label}
                <button type="button" onClick={e => { e.stopPropagation(); removeTerm(t); }} title="Quitar"><Icon name="x" size={9}/></button>
              </span>
            );
          })}
          <input
            className="adv-search-input"
            value={input}
            placeholder={terms.length === 0 ? placeholder : 'Añadir otro término...'}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            onBlur={() => { if (input.trim()) addTerm(input); }}
          />
        </div>
        {hasContent && (
          <button type="button" className="adv-search-clear" onClick={e => { e.stopPropagation(); onTermsChange([]); setInput(''); }} title="Limpiar términos">
            <Icon name="x" size={11}/>
          </button>
        )}
        <button type="button" className={'adv-search-btn ' + (showMenu ? 'on' : '')}
          onClick={e => { e.stopPropagation(); setShowMenu(s => !s); }}
          title="Filtros guardados">
          <Icon name="filter" size={13}/>
          {savedFilters.length > 0 && <span className="adv-search-count">{savedFilters.length}</span>}
        </button>
      </div>

      {showMenu && (
        <div className="adv-search-dropdown">
          <button type="button" className="adv-search-save"
            disabled={terms.length === 0}
            onClick={saveCurrent}
            title={terms.length === 0 ? 'Añade términos primero' : 'Guardar como filtro reutilizable'}>
            <Icon name="plus" size={12}/>
            <span>Guardar filtro actual{terms.length > 0 ? ` (${terms.length} término${terms.length!==1?'s':''})` : ''}</span>
          </button>
          {savedFilters.length === 0 ? (
            <div className="adv-search-empty">Sin filtros guardados.<br/>Añade términos y guárdalos para reutilizarlos.</div>
          ) : (
            <>
              <div className="adv-search-dropdown-label">Filtros guardados</div>
              <div className="adv-search-saved-list">
                {savedFilters.map(f => (
                  <div key={f.name} className="adv-search-saved">
                    <button type="button" className="adv-search-saved-load" onClick={() => loadSaved(f)}>
                      <div className="adv-search-saved-name">{f.name}</div>
                      <div className="adv-search-saved-terms">{f.terms.map(t => String(t).startsWith('-') ? `−"${t.slice(1)}"` : `+"${t}"`).join(' · ')}</div>
                    </button>
                    <button type="button" className="adv-search-saved-del" onClick={() => deleteSaved(f.name)} title="Eliminar"><Icon name="trash" size={11}/></button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// Helper: ¿el item satisface TODOS los términos? Cada término debe aparecer (case-insensitive,
// con normalización de acentos) en alguno de los strings provistos.
window.AdvancedSearch.matches = function matches(terms, ...fields) {
  if (!terms || terms.length === 0) return true;
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const hay = fields.map(norm).join('  ');
  return terms.every(t => {
    if (String(t).startsWith('-') && t.length > 1) return !hay.includes(norm(t.slice(1)));
    return hay.includes(norm(t));
  });
};

// useSortableData — hook que ordena un array de filas por una clave dada,
// alternando ASC ↔ DESC al volver a clickear, y persiste el estado en localStorage.
//
// rows: array a ordenar
// accessors: { [key]: (row) => valor }  — un getter por columna ordenable
// opts: { storageKey?: string, defaultKey?: string, defaultDir?: 'asc'|'desc' }
//
// Returns: { sorted, sortKey, sortDir, requestSort(key) }
// ─── useState que RECUERDA (filtros y búsquedas entre navegaciones) ──────────────────────────
// Cambiar de módulo y volver borraba el filtro y lo escrito en la barra de búsqueda: el componente
// se desmonta y el useState arranca de cero. Esto lo persiste en localStorage con el prefijo
// `ss-{modulo}-` del estándar de módulos.
//
// Se descarta lo guardado si NO tiene la misma forma que el default (una versión anterior de la
// pantalla pudo guardar otra cosa; restaurar eso rompería el render en vez de ahorrar un clic).
// La página NO se persiste a propósito: volver a "página 7" de una lista que ya cambió deja al
// usuario mirando una tabla vacía sin entender por qué.
// ─── Reglas del PIN (espejo EXACTO de `admin-users` / setOwnPin) ────────────────────────────
// La validación que manda es la del server; esta existe para avisar antes de mandar y para poder
// deshabilitar el botón. Están duplicadas a propósito —el navegador no puede ser la autoridad— y
// por eso conviene tenerlas en UN solo lugar del lado del cliente: las usan Ajustes → Usuarios y el
// aviso de creación de PIN al entrar. **Al cambiar una hay que cambiar la del Edge Function.**
//
// Se rechazan las secuencias y los dígitos repetidos: si vamos a pedirle a todo el mundo que cambie
// su PIN, aceptar 000000 o 123456 anula el millón de combinaciones que estamos comprando — son los
// primeros que prueba cualquiera.
window.ssPinValido = function (pin) {
  const p = String(pin || '');
  if (!/^\d{6}$/.test(p)) return false;
  if (/^(\d)\1{5}$/.test(p)) return false;
  if ('0123456789'.includes(p) || '9876543210'.includes(p)) return false;
  return true;
};
window.ssPinMotivo = function (pin) {
  const p = String(pin || '');
  if (!/^\d{6}$/.test(p)) return 'El PIN debe ser exactamente 6 dígitos numéricos.';
  if (/^(\d)\1{5}$/.test(p)) return 'Ese PIN es demasiado fácil: no puede ser el mismo dígito seis veces.';
  if ('0123456789'.includes(p) || '9876543210'.includes(p)) return 'Ese PIN es demasiado fácil: no puede ser una secuencia corrida.';
  return '';
};

window.usePersistedState = function usePersistedState(clave, inicial) {
  const mismaForma = (v) => {
    if (inicial === null || inicial === undefined) return true;
    if (Array.isArray(inicial)) return Array.isArray(v);
    if (typeof inicial === 'object') return v && typeof v === 'object' && !Array.isArray(v);
    return typeof v === typeof inicial;
  };
  const [valor, setValor] = React.useState(() => {
    if (!clave) return inicial;
    try {
      const raw = localStorage.getItem(clave);
      if (raw == null) return inicial;
      const parsed = JSON.parse(raw);
      return mismaForma(parsed) ? parsed : inicial;
    } catch (e) { return inicial; }
  });
  React.useEffect(() => {
    if (!clave) return;
    try {
      // Guardar el default como `null` (borrar la clave) mantiene el localStorage limpio: solo hay
      // entradas de filtros que el usuario realmente puso.
      const esDefault = JSON.stringify(valor) === JSON.stringify(inicial);
      if (esDefault) localStorage.removeItem(clave);
      else localStorage.setItem(clave, JSON.stringify(valor));
    } catch (e) {}      // cuota llena / modo privado: no poder recordar no puede romper la pantalla
  }, [clave, valor]);
  return [valor, setValor];
};

// Limpia todos los filtros recordados de un módulo (`ss-{modulo}-f-*`). Lo usan los botones
// "Limpiar" para que no quede nada pegado después.
window.olvidarFiltros = function olvidarFiltros(moduloId) {
  try {
    const pref = 'ss-' + moduloId + '-f-';
    Object.keys(localStorage).filter(k => k.startsWith(pref)).forEach(k => localStorage.removeItem(k));
  } catch (e) {}
};

window.useSortableData = function useSortableData(rows, accessors, opts = {}) {
  const { useState: uSt, useMemo: uMm, useCallback: uCb } = React;
  const { storageKey, defaultKey = null, defaultDir = 'asc' } = opts;

  const initial = uMm(() => {
    if (storageKey) {
      try {
        const v = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (v && v.key && (v.dir === 'asc' || v.dir === 'desc')) return v;
      } catch {}
    }
    return { key: defaultKey, dir: defaultDir };
  }, []);

  const [sortKey, setSortKey] = uSt(initial.key);
  const [sortDir, setSortDir] = uSt(initial.dir);

  const requestSort = uCb((key) => {
    if (!key) return;
    let nextKey = key, nextDir;
    if (sortKey === key) {
      nextDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      const sample = rows && rows.length && accessors[key] ? accessors[key](rows[0]) : null;
      nextDir = (typeof sample === 'number') ? 'desc' : 'asc';
    }
    setSortKey(nextKey); setSortDir(nextDir);
    if (storageKey) {
      try { localStorage.setItem(storageKey, JSON.stringify({ key: nextKey, dir: nextDir })); } catch {}
    }
  }, [sortKey, sortDir, rows, accessors, storageKey]);

  const sorted = uMm(() => {
    if (!sortKey || !accessors[sortKey]) return rows;
    const get = accessors[sortKey];
    const dirMul = sortDir === 'asc' ? 1 : -1;
    const arr = [...(rows || [])];
    arr.sort((a, b) => {
      const va = get(a), vb = get(b);
      const aEmpty = va == null || va === '';
      const bEmpty = vb == null || vb === '';
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dirMul;
      if (va instanceof Date && vb instanceof Date) return (va - vb) * dirMul;
      return String(va).localeCompare(String(vb), 'es', { numeric: true, sensitivity: 'base' }) * dirMul;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, requestSort };
};

// SortHeader — <th> clickeable que muestra flecha ASC/DESC.
// Props: sortKey, current { key, dir }, onSort(key), align ('left'|'right'), ...rest del th.
window.SortHeader = function SortHeader({ sortKey: k, current, onSort, align = 'left', className = '', style = {}, children, title, ...rest }) {
  const active = current?.key === k;
  const dir = active ? current.dir : null;
  const cls = (className ? className + ' ' : '') + 'sortable' + (active ? ' active' : '');
  return (
    <th {...rest} className={cls} style={style} onClick={() => onSort(k)}
      title={title || (active ? `Orden ${dir === 'asc' ? 'ascendente' : 'descendente'} — clic para cambiar` : 'Clic para ordenar')}>
      <span className="sort-header-inner" style={align === 'right'
        ? {flexDirection: 'row-reverse', justifyContent: 'flex-start'}
        : {justifyContent: align === 'center' ? 'center' : 'flex-start'}}>
        <span>{children}</span>
        <span className="sort-arrow">
          {dir === 'asc'  && <Icon name="chevronU" size={11}/>}
          {dir === 'desc' && <Icon name="chevronD" size={11}/>}
          {!dir && <span className="sort-arrow-idle"><Icon name="chevronD" size={10}/></span>}
        </span>
      </span>
    </th>
  );
};

// ====================== Exportación XLSX (utilidad global) ======================
// Uso: window.exportToXLSX(rows, columns, filename, sheetName, { resumen })
//   rows:     Array de objetos
//   columns:  Array de { key, label, format?: (val,row) => any } — define columnas a exportar
//   filename: 'archivo.xlsx' (se agrega timestamp si no termina en .xlsx)
//   sheetName: nombre de la hoja (default: 'Datos')
//   resumen:  [{ label, valor }] — bloque de TOTALES arriba del listado, antes de la cabecera de
//             la tabla. `{ sep: true }` mete una línea en blanco. Los números van como números
//             (se pueden sumar en Excel). Es lo que convierte un volcado de filas en un reporte:
//             sin él hay que hacer las sumas a mano para saber de qué se está hablando.
// Construye una worksheet (matriz + anchos de columna) desde rows/columns.
// Compartida por la exportación de una hoja y la de varias.
// Color de la empresa activa, en HEX sin `#` (que es como lo quiere xlsx). Sale de `empresas.color`,
// la misma fuente que la franja superior y el selector, así que no hay un color escrito a mano que
// se desincronice. El mapa es el mismo arranque optimista de shell.jsx: la tabla se carga async y
// una exportación puede pedirse antes.
const SS_EMPRESA_COLOR_FB = { demo1: 'F97316', demo2: '94A3B8' };
function ssEmpresaColorHex() {
  const id = window.currentEmpresa || 'demo1';
  const emp = (window.SSData?.empresas || []).find(e => e.id === id);
  const raw = emp?.color || SS_EMPRESA_COLOR_FB[id] || '2563EB';
  return String(raw).replace('#', '').toUpperCase().slice(0, 6);
}

// Filas de encabezado que abren toda hoja exportada: de quién es, qué es y cuándo se sacó. Sin
// esto, un archivo reenviado por correo tres semanas después no se puede fechar ni atribuir.

function ssBuildSheet(rows, columns, meta) {
  const X    = window.XLSX;
  const cols = (columns || Object.keys(rows[0] || {}).map(k => ({ key: k, label: k })));
  const header = cols.map(c => c.label || c.key);
  const data   = rows.map(row => cols.map(c => {
    const raw = c.format ? c.format(row[c.key], row) : row[c.key];
    if (raw == null) return '';
    if (raw instanceof Date) return raw;
    if (typeof raw === 'number') return raw;
    return String(raw);
  }));

  const color   = ssEmpresaColorHex();
  const empresa = (window.SSData?.empresas || []).find(e => e.id === (window.currentEmpresa || 'demo1'));
  const titulo  = (meta && meta.titulo) || 'Exportación';
  const cuando  = (window.localDateStr ? window.localDateStr() : new Date().toISOString().slice(0, 10)) +
                  (window.localTimeStr ? ' ' + window.localTimeStr() : '');
  const quien   = window.__ssCurrentUser?.nombre || '';
  const ancho   = Math.max(1, cols.length);

  // ── Bloque de TOTALES arriba del listado ───────────────────────────────────────────────────
  // Pedido del usuario (2026-08-06): "primero encabezados con los montos totales y ya abajo el
  // listado". Un archivo que arranca con 3.000 filas obliga a hacer las sumas a mano en Excel
  // para saber de qué se está hablando.
  //
  // `meta.resumen` = [{ label, valor }] — o `null`/`{ sep: true }` para una línea en blanco. El
  // valor va tal cual: si es número, Excel lo trata como número (se puede sumar); si es texto ya
  // formateado, se respeta. Cada renglón ocupa 2 columnas (etiqueta | valor), así que también se
  // lee bien en una hoja de una sola columna.
  const resumen = (meta && Array.isArray(meta.resumen)) ? meta.resumen : [];
  const filasResumen = [];
  if (resumen.length) {
    filasResumen.push([]);
    for (const r of resumen) {
      if (!r || r.sep) { filasResumen.push([]); continue; }
      filasResumen.push([r.label, r.valor == null ? '' : r.valor]);
    }
  }

  const cabecera = [
    [empresa?.nombre || (window.currentEmpresa || 'demo1').toUpperCase()],
    [titulo],
    [`Generado: ${cuando}${quien ? ' · por ' + quien : ''} · ${rows.length} registro${rows.length === 1 ? '' : 's'}`],
    ...filasResumen,
    [],
  ];
  // Cuántas filas ocupa todo lo de arriba. Era una constante (4) y por eso el bloque de totales
  // no podía existir: el encabezado de la tabla, el panel congelado y el autofiltro apuntaban a
  // una fila fija. Ahora se deriva.
  const metaFilas = cabecera.length;
  const ws = X.utils.aoa_to_sheet([...cabecera, header, ...data]);

  // ── Estilos ────────────────────────────────────────────────────────────────────────────────
  const A = (r, c) => X.utils.encode_cell({ r, c });
  const set = (ref, s) => { if (ws[ref]) ws[ref].s = Object.assign(ws[ref].s || {}, s); };

  set(A(0, 0), { font: { bold: true, sz: 15, color: { rgb: color } } });
  set(A(1, 0), { font: { bold: true, sz: 11, color: { rgb: '111827' } } });
  set(A(2, 0), { font: { sz: 9, color: { rgb: '6B7280' } } });
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: ancho - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: ancho - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: ancho - 1 } },
  ];

  // Los renglones de totales: etiqueta en gris, valor en negrita y a la derecha. Sin esto el
  // bloque se lee como dos columnas de texto suelto y no se distingue del listado de abajo.
  for (let i = 0; i < filasResumen.length; i++) {
    const r = 3 + i;
    if (!filasResumen[i].length) continue;
    set(A(r, 0), { font: { sz: 10, color: { rgb: '6B7280' } } });
    set(A(r, 1), { font: { bold: true, sz: 11, color: { rgb: '111827' } }, alignment: { horizontal: 'left' } });
    const v = filasResumen[i][1];
    if (typeof v === 'number' && ws[A(r, 1)]) ws[A(r, 1)].z = Number.isInteger(v) ? '#,##0' : '#,##0.00';
  }

  const bordeFino = { style: 'thin', color: { rgb: 'E5E7EB' } };
  for (let c = 0; c < ancho; c++) {
    set(A(metaFilas, c), {
      font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: color } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: { top: bordeFino, bottom: bordeFino, left: bordeFino, right: bordeFino },
    });
  }

  // Formato numérico por columna: se INFIERE de los datos en vez de pedirle a cada llamador que
  // lo declare — así mejoran todas las exportaciones que ya existen sin tocarlas una por una.
  // Con decimales van 2; enteros sin decimales. Los números además se alinean a la derecha.
  const numerica = cols.map((_, i) => {
    let hayNumero = false, hayDecimal = false;
    for (const row of data) {
      const v = row[i];
      if (v === '' || v == null) continue;
      if (typeof v !== 'number') return null;
      hayNumero = true;
      if (!Number.isInteger(v)) hayDecimal = true;
    }
    return hayNumero ? (hayDecimal ? '#,##0.00' : '#,##0') : null;
  });

  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < ancho; c++) {
      const ref = A(metaFilas + 1 + r, c);
      if (!ws[ref]) continue;
      const s = { border: { top: bordeFino, bottom: bordeFino, left: bordeFino, right: bordeFino },
                  alignment: { vertical: 'top', wrapText: false } };
      if (numerica[c]) { ws[ref].z = numerica[c]; s.alignment.horizontal = 'right'; }
      set(ref, s);
    }
  }

  ws['!cols'] = cols.map((_, i) => {
    let max = String(header[i] || '').length;
    for (const row of data) { const v = row[i] == null ? '' : String(row[i]); if (v.length > max) max = v.length; }
    return { wch: Math.min(60, Math.max(10, max + 2)) };
  });
  // Alturas: título, subtítulo, "generado", los renglones de totales, el separador y la cabecera
  // de la tabla. Antes era un arreglo fijo de 5 y con el bloque de totales quedaba corrido.
  ws['!rows'] = [{ hpt: 22 }, { hpt: 16 }, { hpt: 14 },
                 ...filasResumen.map(f => ({ hpt: f.length ? 15 : 6 })),
                 { hpt: 6 }, { hpt: 20 }];
  // Panel congelado bajo el encabezado y autofiltro: con miles de filas, desplazarse sin la
  // cabecera a la vista obliga a volver arriba para saber qué columna se está mirando.
  ws['!freeze'] = { xSplit: 0, ySplit: metaFilas + 1, topLeftCell: A(metaFilas + 1, 0), activePane: 'bottomLeft', state: 'frozen' };
  ws['!autofilter'] = { ref: `${A(metaFilas, 0)}:${A(metaFilas + data.length, ancho - 1)}` };
  return ws;
}

function ssStampFilename(filename) {
  const ts = window.localDateStr().replace(/-/g, '');
  return filename.endsWith('.xlsx') ? filename.replace(/\.xlsx$/, `_${ts}.xlsx`) : `${filename}_${ts}.xlsx`;
}

// Excel rechaza nombres de hoja de más de 31 chars o con []:*?/\
function ssSheetName(name, fallback) {
  const clean = String(name || '').replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31).trim();
  return clean || fallback || 'Datos';
}

window.exportToXLSX = function exportToXLSX(rows, columns, filename, sheetName, opts) {
  // XLSX ya no viene en el arranque (eran 315 kB comprimidos en cada carga): se trae al primer uso
  // y se reintenta la misma llamada. Ver `window.ssVendor` en index.html.
  if (!window.XLSX) {
    return window.ssVendor('xlsx')
      .then(() => window.exportToXLSX(rows, columns, filename, sheetName, opts))
      .catch(() => { alert('No se pudo cargar la librería de Excel. Revisá la conexión e intentá de nuevo.'); return false; });
  }
  if (!Array.isArray(rows) || rows.length === 0) { alert('No hay datos para exportar.'); return false; }
  const wb = window.XLSX.utils.book_new();
  const _hoja = ssSheetName(sheetName, 'Datos');
  window.XLSX.utils.book_append_sheet(wb, ssBuildSheet(rows, columns, { titulo: sheetName || filename || 'Exportación', resumen: opts && opts.resumen }), _hoja);
  window.XLSX.writeFile(wb, ssStampFilename(filename));
  return true;
};

// ══════════════════════════════════════════════════════════════════════════════
//  Indicador global de carga (window.ssBusy + <BusyOverlay/>)
// ══════════════════════════════════════════════════════════════════════════════
// Problema que resuelve: al cambiar de módulo o pedir una lista grande hay esperas
// de varios segundos (descarga del chunk + consulta al server) durante las cuales la
// pantalla no cambia y el usuario no sabe si su clic hizo algo.
//
// Es un contador de referencias, no un booleano: si dos cargas se solapan (cambio de
// módulo + refresco de datos), el indicador se apaga cuando termina la ÚLTIMA, no la
// primera. Cada `start()` devuelve un token que hay que pasarle a `end()`.
//
// NO bloquea la interfaz (`pointer-events:none`): la carga puede tardar y dejar al
// usuario sin poder tocar nada —ni cancelar, ni cambiar de pantalla— es peor que la
// espera misma. Informa, no encierra.
// ══════════════════════════════════════════════════════════════════════════════
//  Avisos de datos AGRUPADOS (window.ssOnDatos)
// ══════════════════════════════════════════════════════════════════════════════
// Los datos llegan por tandas: Fase 1, el catálogo de productos (que va aparte), Fase 2, la
// hidratación de clientes por id, y las cargas por ruta (documentos, OCs, movimientos). Cada tanda
// emitía su `ss-appdata-loaded` / `ss-data-extra-loaded` y **cada uno re-renderizaba todo el árbol**:
// en un arranque son 4-6 repintados completos, y en el POS cada repintado vuelve a filtrar y ordenar
// los 6.593 productos.
//
// Se agrupan con un throttle de borde ADELANTADO: el primer aviso pinta ya —que la pantalla reaccione
// al dato que acaba de llegar— y los que caigan dentro de la ventana siguiente se juntan en un solo
// repintado extra. Nunca se pierde el último: siempre hay un pintado de cierre.
window.ssOnDatos = function (cb, ms) {
  const espera = ms || 120;
  let ultimo = 0, timer = null;
  const correr = () => { ultimo = Date.now(); cb(); };
  const bump = () => {
    if (Date.now() - ultimo >= espera) { if (timer) { clearTimeout(timer); timer = null; } correr(); return; }
    if (timer) return;                       // ya hay un pintado de cierre agendado
    timer = setTimeout(() => { timer = null; correr(); }, espera);
  };
  window.addEventListener('ss-appdata-loaded', bump);
  window.addEventListener('ss-data-extra-loaded', bump);
  return () => {
    if (timer) clearTimeout(timer);
    window.removeEventListener('ss-appdata-loaded', bump);
    window.removeEventListener('ss-data-extra-loaded', bump);
  };
};

window.ssBusy = (function () {
  let seq = 0;
  const active = new Map();  // token → label
  const emit = () => { try { window.dispatchEvent(new CustomEvent('ss-busy-change')); } catch (e) {} };
  return {
    start(label) { const t = ++seq; active.set(t, label || 'Cargando…'); emit(); return t; },
    end(token) { if (active.delete(token)) emit(); },
    // Envuelve una promesa (o una función que devuelve una promesa). El `finally`
    // garantiza que el indicador se apague también si la operación falla — un error
    // que deja el spinner girando para siempre parece un cuelgue.
    async wrap(label, work) {
      const t = this.start(label);
      try { return await (typeof work === 'function' ? work() : work); }
      finally { this.end(t); }
    },
    count() { return active.size; },
    // El último label iniciado: con cargas solapadas se muestra la más reciente,
    // que es la que el usuario acaba de disparar.
    label() { let l = null; active.forEach(v => { l = v; }); return l; },
  };
})();

// Pedido explícito (2026-08-14): que bloquee. Antes era una píldora en la esquina, a propósito NO
// bloqueante ("dejar al usuario sin poder tocar nada es peor que la espera misma") — pero eso
// producía justo el problema reportado: mientras `ssBusy` mostraba "Cargando movimientos…" en su
// píldora, la pantalla de abajo (p. ej. Reportes) seguía mostrando SU PROPIO "Cargando
// documentos…" por separado — dos avisos distintos, ninguno bloqueando nada, y el usuario podía
// seguir tocando filtros contra datos a medio llegar. Ahora es UN SOLO popup de pantalla completa
// (mismo look que el del arranque en frío, que se fusionó acá con `coldLoad`) que tapa todo —
// incluido cualquier aviso propio de la pantalla de abajo, que ya no hace falta que compita por
// atención — y no dispara hasta que TODO lo que dispara `ssBusy` (loadAppData, loadDocumentos,
// ensureDocumentos, ensurePagos, ensureMovsBancarios, etc. — ver el decorador en supabase.js)
// termine: es un contador de referencias, así que sobrevive cargas solapadas sin taparse antes de
// tiempo.
window.BusyOverlay = function BusyOverlay({ coldLoad = false } = {}) {
  const [state, setState] = React.useState({ on: false, label: null });
  React.useEffect(() => {
    let timer = null;
    const sync = () => {
      const n = window.ssBusy.count();
      if (n > 0) {
        // Retardo antes de mostrar: sin esto toda operación rápida (caché caliente,
        // consulta de 80ms) produce un parpadeo que se lee como un glitch. Solo se
        // avisa de lo que de verdad hace esperar.
        if (!timer) timer = setTimeout(() => { timer = null; setState({ on: true, label: window.ssBusy.label() }); }, 220);
        else setState(s => s.on ? { on: true, label: window.ssBusy.label() } : s);
      } else {
        if (timer) { clearTimeout(timer); timer = null; }
        setState({ on: false, label: null });
      }
    };
    window.addEventListener('ss-busy-change', sync);
    sync();
    return () => { if (timer) clearTimeout(timer); window.removeEventListener('ss-busy-change', sync); };
  }, []);

  if (!state.on && !coldLoad) return null;
  const label = coldLoad ? 'Cargando datos…' : (state.label || 'Cargando…');
  return (
    <div className="ss-busy-overlay" style={{position:'fixed', inset:0, zIndex:2000, display:'grid', placeItems:'center', background:'rgba(15,23,42,0.35)', backdropFilter:'blur(2px)'}}
         role="status" aria-live="polite">
      <div style={{background:'var(--bg-elev)', border:'1px solid var(--border)', borderRadius:14, padding:'22px 34px', display:'flex', flexDirection:'column', alignItems:'center', gap:10, boxShadow:'0 20px 60px rgba(0,0,0,0.35)', minWidth:240}}>
        <span className="ss-busy-spin" style={{width:22, height:22, borderWidth:3}}/>
        <div style={{fontSize:14, fontWeight:600, textAlign:'center'}}>{label}</div>
        <div style={{fontSize:12, color:'var(--text-muted)', textAlign:'center'}}>Espera un momento, ya casi termina…</div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
//  Aviso de versión nueva (window.ssVersion + <UpdateBanner/>)
// ══════════════════════════════════════════════════════════════════════════════
// Problema: al pushear, Netlify publica en segundos, pero quien ya tenía la pestaña
// abierta sigue con el código viejo hasta que recarga por su cuenta. Y no se entera:
// para el usuario el sistema "no cambió" o, peor, arrastra un bug ya arreglado.
//
// `src/version.json` lo estampa `build.js` con el hash del contenido servido. Esta
// pestaña se queda con el build que leyó al arrancar y lo compara cada tanto; si
// cambió, avisa. No hace falta backend, ni webhook, ni service worker.
//
// NO recarga sola: en el POS puede haber una venta a medio cerrar, un pago cargándose
// o una firma de recepción en pantalla, y una recarga sorpresa se lo lleva puesto. El
// popup se queda insistiendo hasta que la persona decida el momento.
window.ssVersion = (function () {
  const URL_V = window.ssBase ? window.ssBase('/version.json') : '/version.json';
  let actual = null;   // build con el que arrancó ESTA pestaña
  let nuevo  = null;

  async function leer() {
    try {
      // `no-store` + query único: si esto se cachea, el mecanismo entero deja de
      // servir y nunca más avisa (falla en silencio, que es lo peor que podría hacer).
      const r = await fetch(URL_V + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return null;
      const j = await r.json();
      return (j && j.build) ? String(j.build) : null;
    } catch (e) { return null; }   // sin red: se reintenta en el próximo chequeo
  }

  return {
    async init() { if (actual == null) actual = await leer(); return actual; },
    build:      () => actual,
    pendiente:  () => nuevo,
    // Devuelve el build nuevo si hay uno distinto, null si está al día o no se pudo leer.
    async chequear() {
      const b = await leer();
      if (!b) return null;
      if (actual == null) { actual = b; return null; }   // primer arranque
      if (b === actual) return null;
      nuevo = b;
      return b;
    },
    aplicar() {
      // reload() revalida el documento contra el CDN (Netlify sirve el HTML con
      // must-revalidate), así que la próxima carga trae el index y los chunks nuevos.
      // No se limpia el caché de datos: es otra cosa y tiene su propia versión/TTL.
      try { window.location.reload(); } catch (e) { window.location.href = window.location.href; }
    },
  };
})();

// `intervaloMs` = 30 s. Antes 2 min: el aviso tardaba demasiado en aparecer después de un push.
// Un chequeo cada 30 s es una petición condicional que devuelve 304 sin cuerpo, así que el costo
// es despreciable; y con el aviso por Realtime (abajo) el intervalo pasa a ser solo el respaldo
// para cuando el webhook de deploy no está configurado o falla.
// ─── Aviso: creá tu PIN de 6 dígitos ────────────────────────────────────────────────────────
// Pedido del 2026-08-19: *"los dejaremos entrar por correo normal, pero ya le vamos a decir —una
// sola vez— que ingrese un nuevo PIN de 6 dígitos; si lo digita, guardamos en base y permitimos
// ingresar; si le da a la X, lo puede hacer desde configuraciones."*
//
// A QUIÉN se le pide: al que no tiene PIN, y al que tiene uno de 4 (`pin_digitos < 6`). El hash no
// dice cuántos dígitos tenía, por eso existe esa columna (migración 92).
//
// "UNA SOLA VEZ" es literal y por eso la marca va en la BASE (`pin_prompt_omitido_en`) y no en el
// navegador: guardarlo en localStorage haría que vuelva a molestar en cada máquina nueva, que es
// justo lo que el pedido llama invasivo.
//
// NO BLOQUEA EL INGRESO. El usuario ya entró: esto es un pedido, no un portón. Poner un muro acá
// dejaría a alguien afuera del sistema por no acordarse de un número que todavía no existe.
window.PinEnrollBanner = function PinEnrollBanner() {
  const [pin, setPin]       = React.useState('');
  const [pin2, setPin2]     = React.useState('');
  const [msg, setMsg]       = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [cerrado, setCerrado] = React.useState(false);
  const [listo, setListo]   = React.useState(false);
  const u = window.__ssCurrentUser;

  // El portal del cliente y el del driver no entran acá (no usan este shell), pero el rol Cliente
  // podría llegar por otro camino: no se le pide PIN, no tiene pantalla de acceso rápido.
  const aplica = !!u && u.rol !== 'Cliente' && u.rol !== 'Driver'
    && !u.pin_prompt_omitido_en
    && (!u.tiene_pin || (Number(u.pin_digitos) || 0) < 6);
  if (!aplica || cerrado || listo) return null;

  const valido = window.ssPinValido(pin);
  const coincide = pin.length === 6 && pin === pin2;

  async function guardar() {
    setMsg('');
    if (!valido)   { setMsg(window.ssPinMotivo(pin)); return; }
    if (!coincide) { setMsg('Los dos PIN no coinciden.'); return; }
    setSaving(true);
    const { error } = await window.callAdminUsers('setOwnPin', { pin });
    setSaving(false);
    if (error) { setMsg(error.message || String(error)); return; }
    // Se refleja en memoria para que el aviso no reaparezca en este mismo arranque.
    if (u) { u.tiene_pin = true; u.pin_digitos = 6; }
    setListo(true);
  }

  async function omitir() {
    setCerrado(true);
    // Fire-and-forget: si falla, lo peor que pasa es que el aviso vuelva la próxima vez. Bloquear
    // el cierre de un aviso por un problema de red sería peor que el aviso.
    try { await window.callAdminUsers('skipPinPrompt', {}); if (u) u.pin_prompt_omitido_en = new Date().toISOString(); } catch (e) {}
  }

  const inputStyle = { width: 150, fontSize: 22, fontWeight: 600, letterSpacing: 6, textAlign: 'center' };
  return (
    <div className="modal-overlay" style={{ zIndex: 4000 }}
         onClick={e => { if (e.target === e.currentTarget) omitir(); }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 'min(440px, 96vw)' }}>
        <div className="modal-header">
          <div style={{ width: 42, height: 42, borderRadius: 10, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center' }}>
            <Icon name="lock" size={20}/>
          </div>
          <div style={{ flex: 1 }}>
            <div className="modal-title">{u.tiene_pin ? 'Actualizá tu PIN' : 'Creá tu PIN de acceso'}</div>
            <div className="small">Te lo pedimos una sola vez</div>
          </div>
          <button className="icon-btn" title="Ahora no — lo podés hacer desde Configuración" onClick={omitir}>
            <Icon name="x" size={14}/>
          </button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="small muted">
            {u.tiene_pin
              ? 'Tu PIN actual es de 4 dígitos. Los de 6 son cien veces más difíciles de adivinar, y con él entrás sin escribir tu correo ni tu contraseña.'
              : 'Con un PIN entrás desde la pantalla de acceso sin escribir tu correo ni tu contraseña.'}
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <div>
              <label className="form-label">PIN (6 dígitos)</label>
              <input className="input mono-cell" type="password" inputMode="numeric" maxLength={6}
                     autoComplete="new-password" placeholder="000000" style={inputStyle} value={pin} autoFocus
                     onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setMsg(''); }}/>
            </div>
            <div>
              <label className="form-label">Repetilo</label>
              <input className="input mono-cell" type="password" inputMode="numeric" maxLength={6}
                     autoComplete="new-password" placeholder="000000" style={inputStyle} value={pin2}
                     onChange={e => { setPin2(e.target.value.replace(/\D/g, '').slice(0, 6)); setMsg(''); }}
                     onKeyDown={e => { if (e.key === 'Enter' && valido && coincide && !saving) guardar(); }}/>
            </div>
          </div>
          {/* El motivo se muestra mientras se escribe, no recién al mandar: enterarse de que el PIN
              elegido no sirve DESPUÉS de tipearlo dos veces obliga a rehacer todo. */}
          {pin.length === 6 && !valido && <div className="small" style={{ color: 'var(--warn)' }}>{window.ssPinMotivo(pin)}</div>}
          {msg && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{msg}</div>}
        </div>
        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <button className="btn ghost" onClick={omitir} disabled={saving}>Ahora no</button>
          <button className="btn primary" onClick={guardar} disabled={saving || !valido || !coincide}>
            {saving ? 'Guardando…' : 'Guardar PIN'}
          </button>
        </div>
      </div>
    </div>
  );
};

window.UpdateBanner = function UpdateBanner({ intervaloMs = 30000, snoozeMs = 300000 } = {}) {
  const [nuevo, setNuevo]   = React.useState(null);
  const [oculto, setOculto] = React.useState(0);   // timestamp hasta el que se posterga

  React.useEffect(() => {
    let vivo = true;
    let timer = null;
    const chequear = async () => {
      if (!vivo) return;
      const b = await window.ssVersion.chequear();
      if (vivo && b) setNuevo(b);
    };
    // Arranca leyendo su propio build y después chequea cada rato. El chequeo al volver
    // a la pestaña es el que hace que se sienta inmediato: el intervalo solo cubre a
    // quien deja el sistema abierto mirándolo.
    window.ssVersion.init().then(() => { timer = setInterval(chequear, intervaloMs); });
    const alVolver = () => { if (!document.hidden) chequear(); };
    window.addEventListener('focus', alVolver);
    document.addEventListener('visibilitychange', alVolver);

    // ── Aviso INSTANTÁNEO por Realtime ────────────────────────────────────────
    // Netlify avisa a la Edge Function `deploy-hook` cuando termina de publicar, y esa
    // manda un broadcast a este canal. Llega en ~1 segundo, sin esperar el intervalo.
    //
    // El mensaje es solo un EMPUJÓN: no trae la versión. Si trajera un número (por ejemplo
    // el commit), no coincidiría con el hash del build y a todos —incluso a quien ya
    // actualizó— les seguiría saliendo el aviso. Acá el mensaje solo dispara el mismo
    // `chequear()` de siempre, así que la única fuente de verdad sigue siendo version.json.
    let canal = null;
    try {
      canal = window.sb?.channel('ss-deploys')
        ?.on('broadcast', { event: 'nueva-version' }, () => {
          // Reintento único: el webhook puede llegar un instante antes de que el CDN sirva
          // el archivo nuevo, y en ese caso el primer chequeo diría "sin cambios".
          chequear().then(() => setTimeout(chequear, 4000));
        })
        ?.subscribe();
    } catch (e) { /* sin Realtime se sigue con el intervalo, que ya alcanza */ }

    return () => {
      vivo = false;
      if (timer) clearInterval(timer);
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('visibilitychange', alVolver);
      if (canal) { try { window.sb.removeChannel(canal); } catch (e) {} }
    };
  }, [intervaloMs]);

  // Re-render cuando venza la postergación, para que el aviso vuelva solo.
  React.useEffect(() => {
    if (!oculto) return;
    const t = setTimeout(() => setOculto(0), Math.max(0, oculto - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [oculto]);

  if (!nuevo || (oculto && Date.now() < oculto)) return null;

  return (
    <div className="ss-update-overlay">
      <div className="ss-update-card" role="alertdialog" aria-live="assertive">
        <div className="ss-update-icon"><Icon name="download" size={20}/></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ss-update-title">Hay una versión nueva del sistema</div>
          <div className="ss-update-sub">
            Actualiza para trabajar con los últimos cambios. Si estás a mitad de algo,
            termina primero: el aviso vuelve en unos minutos.
          </div>
        </div>
        <div className="ss-update-actions">
          <button className="btn primary" onClick={() => window.ssVersion.aplicar()}>
            <Icon name="refresh" size={14}/>Actualizar ahora
          </button>
          <button className="btn ghost sm" onClick={() => setOculto(Date.now() + snoozeMs)}>
            Ahora no
          </button>
        </div>
      </div>
    </div>
  );
};

// Uso: window.exportSheetsToXLSX([{ name, rows, columns }, ...], filename)
// Un único .xlsx con varias hojas (ej. "Exportar todo": Cotizaciones + Órdenes + Facturas + Despachos).
// Las hojas sin filas se omiten; si no queda ninguna, avisa y no descarga nada.
window.exportSheetsToXLSX = function exportSheetsToXLSX(sheets, filename) {
  if (!window.XLSX) {
    return window.ssVendor('xlsx')
      .then(() => window.exportSheetsToXLSX(sheets, filename))
      .catch(() => { alert('No se pudo cargar la librería de Excel. Revisá la conexión e intentá de nuevo.'); return false; });
  }
  const valid = (sheets || []).filter(s => s && Array.isArray(s.rows) && s.rows.length > 0);
  if (valid.length === 0) { alert('No hay datos para exportar.'); return false; }
  const wb = window.XLSX.utils.book_new();
  const usados = new Set();
  valid.forEach((s, i) => {
    let name = ssSheetName(s.name, 'Hoja' + (i + 1));
    while (usados.has(name.toLowerCase())) name = ssSheetName(name.slice(0, 28) + '_' + (i + 1), 'Hoja' + (i + 1));
    usados.add(name.toLowerCase());
    window.XLSX.utils.book_append_sheet(wb, ssBuildSheet(s.rows, s.columns, { titulo: s.titulo || s.name || filename, resumen: s.resumen }), name);
  });
  window.XLSX.writeFile(wb, ssStampFilename(filename));
  return true;
};

// ── Redimensiona una foto (factura, comprobante, etc.) a un dataURL liviano ANTES de guardarla.
// Una foto de cámara sin comprimir pesa 3-8MB; en 3G eso es lento de subir y pesado de guardar
// (se persiste como texto en la BD). Reescala al lado mayor = maxDim y recomprime a JPEG.
window.resizeImageFile = function resizeImageFile(file, maxDim = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('No se pudo leer la imagen'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
};

// ── Normalizadores + chequeos de unicidad de clientes/contactos (por empresa; SSData ya viene
// filtrado por RLS). Viven en core.jsx (eager) porque los usan tanto business.jsx (lazy) como
// pos.jsx (eager) — un chunk lazy no puede exponer globals a uno que puede cargar antes.
window.ssNormTel    = function ssNormTel(t)    { return (t || '').replace(/\D/g, ''); };
window.ssNormEmail  = function ssNormEmail(e)  { return (e || '').trim().toLowerCase(); };
window.ssNormNombre = function ssNormNombre(n) { return (n || '').toUpperCase().replace(/\s+/g, ' ').trim(); };
// Devuelven el registro en conflicto (mismo email/teléfono/RIF/razón social) o null.
// excludeId = registro que se está editando (para no chocar consigo mismo).
window.ssFindDupContactoEmail = function ssFindDupContactoEmail(email, excludeId) {
  const e = window.ssNormEmail(email); if (!e) return null;
  return (window.SSData.contactos || []).find(c => c.id !== excludeId && window.ssNormEmail(c.email) === e) || null;
};
window.ssFindDupContactoTelefono = function ssFindDupContactoTelefono(tel, excludeId) {
  const t = window.ssNormTel(tel); if (!t) return null;
  return (window.SSData.contactos || []).find(c => c.id !== excludeId && window.ssNormTel(c.telefono) === t) || null;
};
window.ssFindDupClienteRif = function ssFindDupClienteRif(rif, excludeId) {
  const r = (rif || '').trim().toLowerCase(); if (!r) return null;
  return (window.SSData.clientes || []).find(c => c.id !== excludeId && (c.rif || '').trim().toLowerCase() === r) || null;
};
window.ssFindDupClienteNombre = function ssFindDupClienteNombre(nombre, excludeId) {
  const n = window.ssNormNombre(nombre); if (!n) return null;
  return (window.SSData.clientes || []).find(c => c.id !== excludeId && window.ssNormNombre(c.nombre) === n) || null;
};

// ─── Navegación con anclas reales ───────────────────────────────────────────
// Estaban en shell.jsx a nivel de módulo; se suben a core.jsx (eager, carga antes que shell)
// porque ahora también las usan los enlaces a clientes que hay repartidos por los módulos
// lazy. Dos copias del mismo helper es la forma segura de que una quede desactualizada.
//
// La URL se arma de verdad para que el clic derecho ofrezca "abrir en nueva pestaña" y
// funcionen Ctrl+clic y el botón del medio, que con un <button> no existen.
window.ssHrefRuta = function ssHrefRuta(path) {
  const p = String(path || '');
  return '/' + (window.currentEmpresa || 'demo1') + (p.startsWith('/') ? p : '/' + p);
};
// Clic izquierdo sin modificadores → navegación interna (sin recargar). Con Ctrl/⌘/Shift/Alt o
// el botón del medio se deja pasar al navegador.
window.ssNavClick = function ssNavClick(path, luego) {
  return (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
    // `navigate` vive DENTRO del IIFE de app-bootstrap (cada chunk se compila aislado, no es
    // global), así que acá se usa el puente `window.__ssNavigate`. Si no estuviera, no se cancela
    // el clic: el <a> navega con recarga en vez de quedarse muerto.
    const nav = window.__ssNavigate;
    if (typeof nav !== 'function') return;
    e.preventDefault();
    nav(path);
    if (luego) luego();
  };
};

// ─── ¿De dónde vengo? ───────────────────────────────────────────────────────
// `navigate` deja la ruta anterior (sin el prefijo de empresa) en `ss-prev-route`. Esto la
// traduce a un rótulo para el botón "volver".
//
// La lista es CERRADA a propósito: mostrar "/cxc" crudo en un botón no le dice nada a nadie, y
// una ruta desconocida (o la propia ficha del cliente, o una recarga sin historial) devuelve
// null — el botón simplemente no aparece, en vez de ofrecer volver a ninguna parte.
window.ssRUTAS_ROTULO = {
  '/pos':          'Punto de Venta',
  '/pos/flujo':    'Flujo de documentos',
  '/cotizaciones': 'Cotizaciones',
  '/ordenes':      'Órdenes',
  '/facturas':     'Facturas',
  '/despachos':    'Notas de Despacho',
  '/cxc':          'Cuentas por Cobrar',
  '/cxp':          'Cuentas por Pagar',
  '/anticipos':    'Anticipos',
  '/retenciones':  'Retenciones',
  '/banco':        'Bancos',
  '/contactos':    'Contactos',
  '/devoluciones': 'Devoluciones',
  '/garantias':    'Garantías',
  '/vendedores':   'Vendedores',
  '/comisiones':   'Comisiones',
  '/reportes':     'Reportes',
  '/inventario':   'Inventario',
  '/dashboard':    'Dashboard',
};
window.ssOrigenNavegacion = function ssOrigenNavegacion() {
  let prev = '';
  try { prev = sessionStorage.getItem('ss-prev-route') || ''; } catch (e) {}
  if (!prev) return null;
  // La raíz de la ruta: /banco/BNC-1 vuelve a Bancos, no a un rótulo que no existe.
  const raiz = "/" + String(prev).replace(new RegExp("^/"), "").split("/")[0];
  if (raiz === '/clientes') return null;
  const label = window.ssRUTAS_ROTULO[prev] || window.ssRUTAS_ROTULO[raiz];
  return label ? { path: prev, label } : null;
};

// ─── El nombre del cliente, navegable ───────────────────────────────────────
// Pedido del 2026-08-18: desde CxC, CxP, las 4 listas del flujo y Anticipos, poder ir a la
// ficha del cliente — y que "volver" devuelva EXACTAMENTE al módulo desde donde se hizo clic.
//
// Va a una URL REAL (/clientes/{id}) y no a un `window.__ssOpenCliente`: una variable global no
// sobrevive a un Ctrl+clic (la pestaña nueva arranca sin ella) ni al botón "atrás" del
// navegador, y este enlace existe justamente para poder abrir la ficha sin perder la lista.
// Quien vuelve usa `ss-prev-route`, que `navigate` ya deja escrito en cada salto.
//
// Sin id no se rompe ni se muestra un enlace muerto: se devuelve el texto pelado. Los
// documentos migrados de Odoo pueden no tener cliente, y un enlace que no lleva a ningún lado
// es peor que texto.
window.ClienteLink = function ClienteLink({ clienteId, nombre, style, title, children }) {
  const texto = children || nombre || '—';
  if (!clienteId) return <>{texto}</>;
  const ruta = '/clientes/' + encodeURIComponent(clienteId);
  return (
    <a
      className="cliente-link"
      href={window.ssHrefRuta(ruta)}
      onClick={e => {
        // La fila de la tabla tiene su propio onClick (abre el documento / la cuenta). Sin
        // frenar la burbuja, tocar el nombre del cliente abriría LAS DOS cosas — y con
        // Ctrl+clic abriría la ficha en otra pestaña y el documento en esta.
        e.stopPropagation();
        window.ssNavClick(ruta)(e);
      }}
      title={title || 'Ver la ficha de ' + (nombre || clienteId)}
      style={style}
    >{texto}</a>
  );
};

// ─── Aviso de homónimo (no bloquea) ─────────────────────────────────────────
// Lo comparten los TRES caminos que crean clientes (ficha completa, alta rápida del POS y
// alta desde el selector), así que vive acá: si cada uno tuviera su copia, alcanzaría con
// olvidarse de uno para que ahí siga bloqueando.
//
// El nombre NO identifica a nadie — la cédula sí. Bloquear por homonimia obligaba a
// inventar un nombre para poder cargar a un cliente real, y así nació en la base
// "CARLOS E RODRIGUEZ" (V-17299446): el mismo Carlos Rodríguez con la inicial metida a la
// fuerza para esquivar el bloqueo.
window.AvisoHomonimo = function AvisoHomonimo({ cliente, creando, onContinuar, onCancelar }) {
  if (!cliente) return null;
  return (
    <div style={{ marginTop:10, padding:'10px 12px', background:'var(--warn-soft, #fef3c7)',
                  border:'1px solid var(--warn, #f59e0b)', borderRadius:8, fontSize:12.5 }}>
      <div style={{ fontWeight:600, marginBottom:4 }}>
        <window.Icon name="info" size={12}/> Ya existe un cliente con ese nombre
      </div>
      <div style={{ marginBottom:8 }}>
        <b>{cliente.nombre}</b>{cliente.rif ? ' · ' + cliente.rif : ' · sin RIF'}
        {' '}— si es otra persona con el mismo nombre, seguí adelante.
      </div>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        <button className="btn primary" type="button" disabled={creando} onClick={onContinuar}>
          {creando ? 'Creando…' : 'Crear de igual forma'}
        </button>
        <button className="btn ghost" type="button" disabled={creando} onClick={onCancelar}>Revisar</button>
      </div>
    </div>
  );
};

// ─── Opciones del POS: tipo de entrega y fuente (migración 81) ───────────────
// Una sola lista para las SEIS pantallas que la ofrecen (ficha del cliente, barra de
// cliente del POS, Condiciones, editar documento, nuevo despacho y el filtro de las
// listas). Antes cada una tenía la suya escrita a mano y no coincidían: la ficha del
// cliente guardaba 'retiro' y el POS ofrecía 'Retiro en tienda', así que el tipo de
// entrega del cliente NUNCA prellenaba el documento — un <select> cuyo value no
// coincide con ninguna <option> se queda vacío y no avisa.
//
// Lo que se GUARDA es `valor` (el código); `nombre` es solo el rótulo y se puede
// renombrar desde Ajustes sin dejar huérfanos los 108.820 documentos ya emitidos.
//
// Viven en core.jsx (eager) porque las usan business.jsx (lazy) y pos.jsx (eager).
const _TE_FALLBACK = [
  { id: 'te-retiro',     valor: 'retiro',     nombre: 'Retiro en tienda', requiere_zona: false },
  { id: 'te-delivery',   valor: 'delivery',   nombre: 'Delivery',         requiere_zona: true  },
  { id: 'te-encomienda', valor: 'encomienda', nombre: 'Encomienda',       requiere_zona: true  },
];
// El respaldo se usa solo si la tabla no llegó (empresa sin configurar, arranque frío).
// Nunca se mezcla con la tabla: si hay filas, la tabla manda — si no, una opción borrada
// desde Ajustes reaparecería sola.
function _opciones(lista, fallback) {
  const rows = (lista || []).filter(o => o.activo !== false);
  const base = rows.length ? rows : (fallback || []);
  return base.map(o => ({ ...o, valor: o.valor || window.ssSlugOpcion(o.nombre) }));
}
// Mismo criterio que `ss_slug_opcion` en la base: sin acentos, minúsculas, y todo lo
// que no sea alfanumérico pasa a '_'. Si los dos criterios se separan, una opción creada
// desde Ajustes queda con un código distinto del que espera el server.
window.ssSlugOpcion = function ssSlugOpcion(nombre) {
  return String(nombre || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
};
window.ssOpcionesEntrega = function ssOpcionesEntrega() {
  return _opciones(window.SSData?.tiposEntrega, _TE_FALLBACK);
};
window.ssOpcionesFuente = function ssOpcionesFuente() {
  return _opciones(window.SSData?.fuentesVenta, []);
};
// Busca por código Y por rótulo: hasta la migración 81 había documentos que guardaron
// el rótulo ('Delivery' en vez de 'delivery'). Se normalizaron, pero un dato viejo
// restaurado de la papelera o traído de un backup no puede quedar sin nombre.
function _buscar(opts, v) {
  const s = window.ssSlugOpcion(v);
  if (!s) return null;
  return opts.find(o => window.ssSlugOpcion(o.valor) === s)
      || opts.find(o => window.ssSlugOpcion(o.nombre) === s) || null;
}
function _label(opts, v, vacio) {
  if (!v) return vacio;
  const o = _buscar(opts, v);
  if (o) return o.nombre;
  // Desconocido (opción borrada, dato migrado): se muestra prolijo en vez de crudo.
  const t = String(v).replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
window.ssLabelEntrega = function ssLabelEntrega(v, vacio = '—') { return _label(window.ssOpcionesEntrega(), v, vacio); };
window.ssLabelFuente  = function ssLabelFuente(v, vacio = '—')  { return _label(window.ssOpcionesFuente(),  v, vacio); };
// ¿Pide zona de envío y línea de flete? Sale de la tabla (`requiere_zona`, migración 81).
// Los códigos legados quedan como respaldo: la columna no existía y el POS los tenía
// escritos, así que un documento viejo tiene que seguir comportándose igual.
window.ssRequiereZona = function ssRequiereZona(v) {
  const o = _buscar(window.ssOpcionesEntrega(), v);
  if (o && o.requiere_zona !== undefined && o.requiere_zona !== null) return !!o.requiere_zona;
  const s = window.ssSlugOpcion(v);
  return s === 'delivery' || s === 'encomienda' || s === 'mrw';
};
// ¿Va por transportista tercero? Pide transportista y número de guía. Es OTRA pregunta que
// `requiere_zona`: el delivery propio lleva zona pero no guía, y MRW lleva las dos. Sin esto,
// agregar MRW a la lista dejaba la entrega sin dónde anotar el número de rastreo — que es
// justamente para lo que se usa una encomienda.
window.ssRequiereGuia = function ssRequiereGuia(v) {
  const o = _buscar(window.ssOpcionesEntrega(), v);
  if (o && o.requiere_guia !== undefined && o.requiere_guia !== null) return !!o.requiere_guia;
  const s = window.ssSlugOpcion(v);
  return s === 'encomienda' || s === 'mrw';
};
// El código con el que nace un documento cuando el cliente no tiene entrega asignada.
window.ssEntregaPorDefecto = function ssEntregaPorDefecto() {
  const opts = window.ssOpcionesEntrega();
  return (opts.find(o => o.valor === 'retiro') || opts[0])?.valor || 'retiro';
};

// ─── Tamaño de letra grande (accesibilidad) ─────────────────────────────────
// Preferencia PERSONAL del navegador, no de la empresa (la visión de cada quien es suya, no una
// política del negocio) — por eso vive en localStorage y no en `configuracion_sistema`. El valor
// inicial ya lo aplicó un script inline en index.html (antes del primer paint, para no parpadear);
// esto es lo que usa el control de Ajustes → Sistema para cambiarlo en caliente, sin recargar.
// `zoom` escala TODO por igual (texto, iconos, espaciados) sin tener que convertir cada `px` del
// CSS a una unidad relativa — el resto del theme está en píxeles fijos.
window.ssFontScale = {
  get() { try { return localStorage.getItem('ss-font-scale') || 'normal'; } catch (e) { return 'normal'; } },
  set(v) {
    try { localStorage.setItem('ss-font-scale', v); } catch (e) {}
    document.documentElement.style.zoom = v === 'muy-grande' ? '130%' : v === 'grande' ? '115%' : '';
  },
};

Object.assign(window, { Icon: window.Icon, fmt: window.fmt, Avatar: window.Avatar, StatusChip: window.StatusChip, Sparkline: window.Sparkline, SearchSelect: window.SearchSelect, AdvancedSearch: window.AdvancedSearch, useSortableData: window.useSortableData, SortHeader: window.SortHeader, exportToXLSX: window.exportToXLSX, exportSheetsToXLSX: window.exportSheetsToXLSX, ssBusy: window.ssBusy, BusyOverlay: window.BusyOverlay, ssVersion: window.ssVersion, UpdateBanner: window.UpdateBanner, ssFontScale: window.ssFontScale });
