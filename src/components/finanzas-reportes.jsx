// Reportes de Finanzas — panel ejecutivo de alto nivel (ventas, ganancia, flujo,
// mejores clientes/vendedores/productos, CxC/CxP, quiebres de inventario, bancos).
// Solo lectura. Datos históricos server-side (RPC get_finanzas_reporte) + estado
// actual (inventario/bancos) desde SSData.
const { useState: fuSt, useEffect: fuEff, useMemo: fuMemo } = React;

const _FMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

// $153.7K / $1.2M compacto para ejes y KPIs grandes.
function fUsdK(v) {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}
function _mesLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  if (!m) return ym;
  return _FMES[Number(m[2]) - 1] + ' ' + m[1].slice(2);
}
// El período de la página. `rango` = fechas tecleadas, y manda sobre el preset: TODO lo que se
// muestra (KPIs, gráficos, tops, aging, desglose por mes) sale de este desde/hasta, así que el
// filtro no puede vivir dentro de una tarjeta — es el de la página entera.
function _rangoPeriodo(periodo, desdeManual, hastaManual) {
  const hoy = window.localDateStr ? window.localDateStr() : new Date().toISOString().slice(0, 10);
  const d = new Date(hoy + 'T12:00:00');
  const yr = window.caracasYear ? window.caracasYear() : d.getFullYear();
  const ymd = (x) => window.localDateStr ? window.localDateStr(x) : x.toISOString().slice(0, 10);
  if (periodo === 'rango' && desdeManual && hastaManual) {
    const desde = desdeManual <= hastaManual ? desdeManual : hastaManual;   // al revés se ordenan
    const hasta = desdeManual <= hastaManual ? hastaManual : desdeManual;
    return { desde, hasta, label: `${_fecha(desde)} → ${_fecha(hasta)}` };
  }
  if (periodo === 'mes')  return { desde: ymd(new Date(d.getFullYear(), d.getMonth(), 1)), hasta: hoy, label: `${_FMES[d.getMonth()]} ${yr}` };
  if (periodo === '12m')  { const s = new Date(d); s.setMonth(s.getMonth() - 11); s.setDate(1); return { desde: ymd(s), hasta: hoy, label: 'Últimos 12 meses' }; }
  // ytd (por defecto)
  return { desde: `${yr}-01-01`, hasta: hoy, label: `Año ${yr}` };
}
function _fecha(ymd) {
  if (!ymd) return '—';
  try { return new Date(ymd + 'T12:00:00').toLocaleDateString('es-VE', { day:'2-digit', month:'short', year:'numeric' }); }
  catch (e) { return ymd; }
}
// Primer y último día del mes 'YYYY-MM' — el rango que se le pide al server al abrir un mes.
function _mesRango(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  if (!m) return null;
  const y = Number(m[1]), mm = Number(m[2]);
  const ultimo = new Date(Date.UTC(y, mm, 0)).getUTCDate();
  return { desde: `${m[1]}-${m[2]}-01`, hasta: `${m[1]}-${m[2]}-${String(ultimo).padStart(2,'0')}` };
}

// ── Barras agrupadas (dos series) — mismo lenguaje visual que el dashboard ──
function FinBars({ data, aColor, bColor, aLabel, bLabel }) {
  if (!data.length) return <div className="empty" style={{ padding: 30 }}>Sin datos en el período</div>;
  const w = 640, h = 210, pad = { l: 44, r: 12, t: 10, b: 26 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const rawMax = Math.max(...data.map(d => Math.max(d.a || 0, d.b || 0)), 1);
  const max = rawMax * 1.15;
  const gw = iw / data.length;
  const bw = Math.min(24, gw * 0.36);
  const grid = [0, 0.25, 0.5, 0.75, 1].map(p => max * p);
  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 6, fontSize: 12 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: aColor }} />{aLabel}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: bColor }} />{bLabel}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 220 }}>
        {grid.map((v, gi) => {
          const y = pad.t + ih - (v / max) * ih;
          return (
            <g key={gi}>
              <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="var(--border)" strokeDasharray={gi === 0 ? '' : '3 3'} />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize="9.5" fill="var(--text-muted)" fontFamily="var(--mono)">{fUsdK(v)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const gx = pad.l + gw * i + gw / 2;
          const ha = Math.max(0, ((d.a || 0) / max) * ih);
          const hb = Math.max(0, ((d.b || 0) / max) * ih);
          return (
            <g key={i}>
              <rect x={gx - bw - 1} y={pad.t + ih - ha} width={bw} height={ha} fill={aColor} rx="2" />
              <rect x={gx + 1} y={pad.t + ih - hb} width={bw} height={hb} fill={bColor} rx="2" opacity="0.9" />
              <text x={gx} y={h - 8} textAnchor="middle" fontSize="9.5" fill="var(--text-muted)">{d.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Donut de categorías ──
function FinDonut({ data }) {
  if (!data.length) return <div className="empty" style={{ padding: 30 }}>Sin datos en el período</div>;
  const total = data.reduce((s, d) => s + (+d.monto || 0), 0) || 1;
  const top = data.slice(0, 6);
  const otros = data.slice(6).reduce((s, d) => s + (+d.monto || 0), 0);
  const slices0 = otros > 0 ? [...top, { categoria: 'Otras', monto: otros }] : top;
  const r = 54, R = 76, cx = 90, cy = 90;
  const colors = ['var(--brand)', 'var(--accent)', 'oklch(0.6 0.13 155)', 'oklch(0.58 0.14 295)', 'oklch(0.62 0.14 45)', 'oklch(0.58 0.14 25)', 'oklch(0.6 0.02 260)'];
  let acc = 0;
  const slices = slices0.map((d, i) => {
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2; acc += (+d.monto || 0);
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
    const large = (end - start) > Math.PI ? 1 : 0;
    const x1 = cx + Math.cos(start) * R, y1 = cy + Math.sin(start) * R;
    const x2 = cx + Math.cos(end) * R, y2 = cy + Math.sin(end) * R;
    const x3 = cx + Math.cos(end) * r, y3 = cy + Math.sin(end) * r;
    const x4 = cx + Math.cos(start) * r, y4 = cy + Math.sin(start) * r;
    return { d: `M${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${r},${r} 0 ${large} 0 ${x4},${y4} Z`, color: colors[i % colors.length], pct: Math.round(d.monto / total * 100), ...d };
  });
  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg viewBox="0 0 180 180" style={{ width: 140, height: 140, flexShrink: 0 }}>
        {slices.map((s, i) => <path key={i} d={s.d} fill={s.color} />)}
        <text x="90" y="86" textAnchor="middle" fontSize="10" fill="var(--text-muted)">Total</text>
        <text x="90" y="105" textAnchor="middle" fontSize="15" fill="var(--text)" fontWeight="600">{fUsdK(total)}</text>
      </svg>
      <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 7 }}>
        {slices.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span title={s.categoria} style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.categoria}</span>
            <span className="mono" style={{ color: 'var(--text-muted)' }}>{fmt.usd(s.monto)}</span>
            <span className="mono" style={{ width: 34, textAlign: 'right', fontWeight: 600 }}>{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tabla top con barra de proporción ──
function TopTable({ rows, cols }) {
  const maxVal = Math.max(...rows.map(r => r._bar || 0), 1);
  if (!rows.length) return <div className="empty" style={{ padding: 24 }}>Sin datos</div>;
  return (
    <div className="tbl-wrap">
      <table className="tbl" style={{ fontSize: 12.5 }}>
        <thead><tr>
          <th style={{ width: 28 }}>#</th>
          <th>{cols.label}</th>
          {cols.extra && cols.extra.map(c => <th key={c.key} className="num">{c.h}</th>)}
          <th className="num">{cols.mainH}</th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="muted">{i + 1}</td>
              <td className="copy-host">
                {/* `_copy` opcional: en el top de productos son el SKU y el título, que es lo que
                    se pega en un chat o en el buscador del proveedor. */}
                <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260, display: 'flex', alignItems: 'center' }} title={r._name}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r._name}</span>
                  {r._copy && r._copy.map(c => <window.CopyBtn key={c.title} text={c.text} title={c.title} />)}
                </div>
                <div style={{ height: 3, borderRadius: 2, background: 'var(--bg-sunken)', marginTop: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(r._bar / maxVal) * 100}%`, background: 'var(--brand)', borderRadius: 2 }} />
                </div>
              </td>
              {cols.extra && cols.extra.map(c => <td key={c.key} className="num mono">{c.fmt(r)}</td>)}
              <td className="num mono" style={{ fontWeight: 600 }}>{cols.mainFmt(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, subtitle, icon, children, right }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {icon && <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name={icon} size={16} /></div>}
          <div>
            <h3 className="card-title" style={{ margin: 0 }}>{title}</h3>
            {subtitle && <div className="small muted">{subtitle}</div>}
          </div>
        </div>
        {right}
      </div>
      <div style={{ padding: '14px 16px' }}>{children}</div>
    </div>
  );
}

// ── Desglose: mes → las órdenes que lo generaron → los productos de cada orden ──────────────────
// Para responder "¿de dónde salió (o se fue) la plata de este mes?" sin salir del panel. Cada mes
// que se abre cuesta UN viaje: `get_ventas_pivot(mes, dim1='orden_origen', dim2='producto')` trae las
// órdenes y sus productos ya agregados, así que abrir una orden no consulta nada. La respuesta se
// guarda por mes: volver a cerrar y abrir no repite el viaje.
//
// El % de ganancia se mide contra `venta_margen` (la venta sin la cobertura BCV) en los tres niveles.
function _pctMargen(base, margen) {
  const b = Number(base) || 0;
  return b > 0 ? (Number(margen) || 0) / b * 100 : null;
}
function _colorPct(pct) {
  if (pct == null) return 'var(--text-muted)';
  if (pct < 0)  return 'var(--danger)';
  if (pct < 10) return 'var(--danger)';
  if (pct < 25) return 'var(--warn)';
  return 'var(--success)';
}
// Modalidad de pago: no viaja en el pivote (agrega ventas/costo/margen, no columnas del documento),
// así que se pide aparte, UNA vez por orden, con la misma tabla liviana que ya usa el resto del
// panel (`documentos.id, modalidad_pago`) — no hace falta tocar la RPC para esto.
const MODALIDAD_LABEL = { divisas: 'Divisas', bcv: 'BCV', bcv_fijo: 'Nota BCV', paralelo: 'Paralelo' };
function MesesDesglose({ meses }) {
  const [abierto, setAbierto]   = fuSt(null);          // 'YYYY-MM' del mes desplegado
  const [ordenAbierta, setOrdenAbierta] = fuSt(null);  // 'YYYY-MM|ORD'
  const [porMes, setPorMes]     = fuSt({});            // mes → filas de la RPC
  const [cargando, setCargando] = fuSt('');
  const [modPago, setModPago]   = fuSt({});            // orden id → modalidad_pago
  const modPagoPedidos = React.useRef(new Set());      // ids ya pedidos o en vuelo (no repetir)

  async function abrirMes(mes) {
    if (abierto === mes) { setAbierto(null); setOrdenAbierta(null); return; }
    setAbierto(mes); setOrdenAbierta(null);
    if (porMes[mes]) return;                            // ya se pidió antes
    const r = _mesRango(mes);
    if (!r) return;
    setCargando(mes);
    const filas = await window.getVentasPivot?.(r.desde, r.hasta, { dim1: 'orden_origen', dim2: 'producto' });
    setPorMes(prev => ({ ...prev, [mes]: filas || [] }));
    setCargando('');
    // Solo las órdenes de ESTE mes que todavía no se pidieron — el mismo cliente puede repetir
    // órdenes entre meses (raro, pero gratis de cubrir con el Set).
    const ids = [...new Set((filas || []).map(f => f.dim1).filter(v => v && v !== '(sin orden)'))]
      .filter(id => !modPagoPedidos.current.has(id));
    if (!ids.length) return;
    ids.forEach(id => modPagoPedidos.current.add(id));
    const { data } = await window.sb.from('documentos').select('id, modalidad_pago').in('id', ids);
    if (data?.length) setModPago(prev => { const n = { ...prev }; data.forEach(d => { n[d.id] = d.modalidad_pago; }); return n; });
  }

  // Las filas vienen por (orden, producto): se agrupan por orden para el nivel 2.
  function ordenesDe(mes) {
    const filas = porMes[mes] || [];
    const map = new Map();
    for (const f of filas) {
      const k = f.dim1 == null ? '(sin orden)' : String(f.dim1);
      if (!map.has(k)) map.set(k, { orden: k, ventas: 0, costo: 0, base: 0, margen: 0, items: [] });
      const o = map.get(k);
      o.ventas += Number(f.monto) || 0;
      o.costo  += Number(f.costo) || 0;
      o.base   += Number(f.venta_margen) || Number(f.monto) || 0;
      o.margen += Number(f.margen) || 0;
      if (f.dim2 != null) o.items.push({
        nombre: String(f.dim2), ventas: Number(f.monto) || 0, costo: Number(f.costo) || 0,
        base: Number(f.venta_margen) || Number(f.monto) || 0, margen: Number(f.margen) || 0,
      });
    }
    // De mayor a menor venta: lo grande primero, que es donde un punto de margen pesa.
    return [...map.values()].sort((a, b) => b.ventas - a.ventas);
  }

  if (!meses.length) return <div className="empty" style={{ padding: 24 }}>Sin ventas en el período</div>;

  const th = { padding: '6px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
               textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid var(--border)' };
  const td = { padding: '6px 10px', fontSize: 12.5, borderBottom: '1px solid var(--border)', textAlign: 'right' };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>Mes / Orden / Producto</th>
            <th style={{ ...th, textAlign: 'left' }}>Modalidad</th>
            <th style={{ ...th, textAlign: 'right' }}>Facturas</th>
            <th style={{ ...th, textAlign: 'right' }}>Ventas</th>
            <th style={{ ...th, textAlign: 'right' }}>Costo</th>
            <th style={{ ...th, textAlign: 'right' }}>Ganancia</th>
            <th style={{ ...th, textAlign: 'right' }}>% Ganancia</th>
          </tr>
        </thead>
        <tbody>
          {[...meses].sort((a, b) => b.mes.localeCompare(a.mes)).map(m => {
            const pct = _pctMargen(m.base, m.margen);
            const abiertoEste = abierto === m.mes;
            return (
              <React.Fragment key={m.mes}>
                <tr style={{ cursor: 'pointer', background: abiertoEste ? 'var(--bg-sunken)' : 'transparent' }}
                    onClick={() => abrirMes(m.mes)}>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Icon name={abiertoEste ? 'chevronD' : 'chevronR'} size={12} />
                      {_mesLabel(m.mes)}
                      {cargando === m.mes && <span className="small muted">· cargando…</span>}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: 'left' }}>—</td>
                  <td style={td}>{(m.docs || 0).toLocaleString('es-VE')}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{fmt.usd(m.ventas)}</td>
                  <td style={td}>{fmt.usd(m.costo)}</td>
                  <td style={{ ...td, color: m.margen >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmt.usd(m.margen)}</td>
                  <td style={{ ...td, fontWeight: 700, color: _colorPct(pct) }}>{pct == null ? '—' : pct.toFixed(1) + '%'}</td>
                </tr>
                {abiertoEste && (porMes[m.mes] || []).length === 0 && cargando !== m.mes && (
                  <tr><td colSpan={7} style={{ ...td, textAlign: 'left', color: 'var(--text-muted)' }}>
                    Sin órdenes con detalle en este mes.
                  </td></tr>
                )}
                {abiertoEste && ordenesDe(m.mes).map(o => {
                  const pctO = _pctMargen(o.base, o.margen);
                  const claveO = m.mes + '|' + o.orden;
                  const abiertaEsta = ordenAbierta === claveO;
                  const tieneOrden = o.orden !== '(sin orden)';
                  const modalidad = MODALIDAD_LABEL[modPago[o.orden]] || modPago[o.orden] || '—';
                  return (
                    <React.Fragment key={claveO}>
                      <tr style={{ cursor: 'pointer', background: '#f8fafc' }}
                          onClick={() => setOrdenAbierta(abiertaEsta ? null : claveO)}>
                        <td style={{ ...td, textAlign: 'left', paddingLeft: 30, fontSize: 12 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <Icon name={abiertaEsta ? 'chevronD' : 'chevronR'} size={11} />
                            {/* Abre la orden en su detalle real (misma mecánica que usan CxC y el
                                command palette: `window.abrirDocumentoPorId`, ya cargado — pos.js es
                                eager). Clic acá NO expande/colapsa: es una acción distinta, por eso
                                stopPropagation. */}
                            {tieneOrden ? (
                              <span className="mono" style={{ color: 'var(--brand)', textDecoration: 'underline', cursor: 'pointer' }}
                                    title="Abrir esta orden"
                                    onClick={async e => {
                                      e.stopPropagation();
                                      const ok = await window.abrirDocumentoPorId?.(o.orden);
                                      if (!ok) alert('No se pudo abrir ' + o.orden + '. Puede que la hayan eliminado.');
                                    }}>{o.orden}</span>
                            ) : <span className="mono">{o.orden}</span>}
                          </span>
                        </td>
                        <td style={{ ...td, textAlign: 'left', fontSize: 11.5 }}>{modalidad}</td>
                        <td style={td}>—</td>
                        <td style={td}>{fmt.usd(o.ventas)}</td>
                        <td style={td}>{fmt.usd(o.costo)}</td>
                        <td style={{ ...td, color: o.margen >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmt.usd(o.margen)}</td>
                        <td style={{ ...td, fontWeight: 700, color: _colorPct(pctO) }}>{pctO == null ? '—' : pctO.toFixed(1) + '%'}</td>
                      </tr>
                      {abiertaEsta && o.items
                        .slice()
                        .sort((a, b) => (_pctMargen(a.base, a.margen) ?? 999) - (_pctMargen(b.base, b.margen) ?? 999))
                        .map((it, i) => {
                          const pctI = _pctMargen(it.base, it.margen);
                          return (
                            <tr key={i} style={{ background: '#f1f5f9' }}>
                              <td style={{ ...td, textAlign: 'left', paddingLeft: 52, fontSize: 11.5, color: 'var(--text-muted)',
                                           maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                  title={it.nombre}>{it.nombre}</td>
                              <td style={{ ...td, fontSize: 11.5 }}>—</td>
                              <td style={{ ...td, fontSize: 11.5 }}>—</td>
                              <td style={{ ...td, fontSize: 11.5 }}>{fmt.usd(it.ventas)}</td>
                              <td style={{ ...td, fontSize: 11.5 }}>{fmt.usd(it.costo)}</td>
                              <td style={{ ...td, fontSize: 11.5, color: it.margen >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmt.usd(it.margen)}</td>
                              <td style={{ ...td, fontSize: 11.5, fontWeight: 700, color: _colorPct(pctI) }}>{pctI == null ? '—' : pctI.toFixed(1) + '%'}</td>
                            </tr>
                          );
                        })}
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      <div className="small muted" style={{ marginTop: 8, fontSize: 11 }}>
        Los productos de cada orden van ordenados del margen más bajo al más alto — arriba está lo que
        conviene revisar. El % se mide sobre la venta sin la cobertura BCV, que es tasa y no ganancia.
      </div>
    </div>
  );
}

// ── Desglose de gastos: día (o rubro) → los movimientos que lo componen ────────────────────────
// El panel decía cuánto se gastó y —desde la migración 38— en qué rubro, pero no CUÁNDO ni en qué
// movimiento concreto. Sin el eje diario no se puede contestar "¿qué pasó el martes que gastamos
// $4.000?", que es la pregunta con la que se revisa un mes.
//
// NO consulta al server por día: los egresos de TODA la historia de `demo1` son 174 filas
// (medido el 2026-08-06), así que el período entero se trae de un viaje con `loadGastosPeriodo`
// —la misma función que arma el Excel de la contadora, con lo cual pantalla y archivo no pueden
// discrepar— y el agrupado se hace acá. Una RPC por día habría sido más código y más viajes para
// el mismo resultado.
// Misma clave de categoría para el desglose ("En qué se gastó") y el filtro dinámico del
// resumen: un movimiento sin categoría cae en "— Sin categoría", nunca se esconde.
function catKeyOf(m) {
  return (m.categoria && m.categoria !== '(sin categoria)') ? m.categoria : '— Sin categoría';
}
function _diaLabel(iso) {
  if (!iso || iso.length < 10) return iso || '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dias = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${dias[dt.getUTCDay()]} ${d} ${meses[m - 1]} ${y}`;
}
function GastosDesglose({ movs, cargando, error }) {
  const [eje, setEje] = fuSt('dia');       // 'dia' | 'mes' | 'categoria'
  const [abierto, setAbierto] = fuSt(null);

  // Un solo recorrido arma los tres ejes: la clave es la única diferencia. `_mesLabel` ya existe
  // (la usa el gráfico de "Ventas y ganancia por mes"): se reutiliza en vez de escribir otro
  // formateador de 'YYYY-MM'.
  const grupos = fuMemo(() => {
    const map = new Map();
    for (const m of movs || []) {
      const k = eje === 'dia' ? (m.fecha || '').slice(0, 10)
              : eje === 'mes' ? (m.fecha || '').slice(0, 7)
              : catKeyOf(m);
      if (!map.has(k)) map.set(k, { k, monto: 0, movs: [] });
      const g = map.get(k);
      g.monto += Number(m.monto_usd) || 0;
      g.movs.push(m);
    }
    const arr = [...map.values()];
    // Por día/mes se ordena por FECHA (lo último arriba: es lo que se está revisando); por rubro,
    // por monto (lo que más pesa arriba, que es donde se recorta).
    return eje === 'categoria' ? arr.sort((a, b) => b.monto - a.monto) : arr.sort((a, b) => b.k.localeCompare(a.k));
  }, [movs, eje]);

  const total = grupos.reduce((s, g) => s + g.monto, 0);
  const max = Math.max(...grupos.map(g => g.monto), 1);

  const th = { padding: '6px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
               textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid var(--border)' };
  const td = { padding: '6px 10px', fontSize: 12.5, borderBottom: '1px solid var(--border)', textAlign: 'right' };

  const tabs = (
    <div style={{ display: 'flex', gap: 4 }}>
      {[{ id: 'dia', l: 'Por día' }, { id: 'mes', l: 'Por mes' }, { id: 'categoria', l: 'Por rubro' }].map(t => (
        <button key={t.id} className={`btn small${eje === t.id ? ' primary' : ' secondary'}`}
                onClick={() => { setEje(t.id); setAbierto(null); }}>{t.l}</button>
      ))}
    </div>
  );

  const ejeLabel = eje === 'dia' ? 'Día' : eje === 'mes' ? 'Mes' : 'Rubro';

  let cuerpo;
  if (error) cuerpo = <div className="empty" style={{ padding: 20, color: 'var(--danger)' }}>{error}</div>;
  else if (cargando) cuerpo = <div className="empty" style={{ padding: 20 }}>Cargando los movimientos…</div>;
  else if (!grupos.length) cuerpo = <div className="empty" style={{ padding: 20 }}>Sin gastos registrados en el período</div>;
  else cuerpo = (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
        <thead><tr>
          <th style={{ ...th, textAlign: 'left' }}>{ejeLabel}</th>
          <th style={{ ...th, textAlign: 'right' }}>Movs.</th>
          <th style={{ ...th, textAlign: 'right' }}>Monto</th>
          <th style={{ ...th, textAlign: 'right' }}>%</th>
        </tr></thead>
        <tbody>
          {grupos.map(g => {
            const ab = abierto === g.k;
            const sinCat = g.k === '— Sin categoría';
            return (
              <React.Fragment key={g.k}>
                <tr style={{ cursor: 'pointer', background: ab ? 'var(--bg-sunken)' : 'transparent' }}
                    onClick={() => setAbierto(ab ? null : g.k)}>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 600, color: sinCat ? 'var(--warn)' : undefined }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Icon name={ab ? 'chevronD' : 'chevronR'} size={12} />
                      {eje === 'dia' ? _diaLabel(g.k) : eje === 'mes' ? _mesLabel(g.k) : g.k}
                    </span>
                    <div style={{ height: 3, borderRadius: 2, background: 'var(--bg-sunken)', marginTop: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(g.monto / max) * 100}%`,
                                    background: sinCat ? 'var(--warn)' : 'var(--danger)', borderRadius: 2 }} />
                    </div>
                  </td>
                  <td style={td}>{g.movs.length}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{fmt.usd(g.monto)}</td>
                  <td style={{ ...td, color: 'var(--text-muted)' }}>{total > 0 ? ((g.monto / total) * 100).toFixed(1) + '%' : '—'}</td>
                </tr>
                {ab && g.movs.slice().sort((a, b) => (Number(b.monto_usd) || 0) - (Number(a.monto_usd) || 0)).map(m => (
                  <tr key={m.id} style={{ background: 'var(--bg-sunken)' }}>
                    <td style={{ ...td, textAlign: 'left', paddingLeft: 30, fontSize: 11.5 }}>
                      <div style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                           title={m.descripcion}>{m.descripcion || '(sin descripción)'}</div>
                      <div className="small muted" style={{ fontSize: 10.5 }}>
                        {/* Se muestra el/los dato(s) que la fila de arriba NO está diciendo: en
                            "por día" falta el rubro; en "por rubro" falta el día; en "por mes"
                            faltan los dos. */}
                        {eje === 'dia'
                          ? (m.categoria === '(sin categoria)' ? 'Sin rubro' : m.categoria)
                          : eje === 'mes'
                          ? `${_diaLabel(m.fecha)} · ${m.categoria === '(sin categoria)' ? 'Sin rubro' : m.categoria}`
                          : _diaLabel(m.fecha)}
                        {m.banco ? ' · ' + m.banco : ''}
                        {m.registrado_por ? ' · ' + m.registrado_por : ''}
                      </div>
                    </td>
                    <td style={{ ...td, fontSize: 11.5, color: 'var(--text-muted)' }}>{m.conciliado === 'Sí' ? 'conc.' : '—'}</td>
                    <td style={{ ...td, fontSize: 12 }}>
                      {fmt.usd(Number(m.monto_usd) || 0)}
                      {/* El monto en la moneda del banco va DEBAJO del dólar, no en otra columna:
                          la de al lado dice "%" y meterle bolívares es mentirle al encabezado. */}
                      {m.moneda && m.moneda !== 'USD' && (
                        <div className="small muted" style={{ fontSize: 10.5, fontWeight: 400 }}>
                          {fmt.bs ? fmt.bs(Number(m.monto) || 0) : (Number(m.monto) || 0).toFixed(2)}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, fontSize: 11, color: 'var(--text-muted)' }}>—</td>
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <React.Fragment>
      {tabs}
      <div style={{ marginTop: 10 }}>{cuerpo}</div>
      {/* Qué NO entra acá, dicho explícitamente: si el número no cierra contra la tarjeta de
          arriba, que se sepa por qué en vez de desconfiar de los dos. */}
      <div className="small muted" style={{ marginTop: 8, fontSize: 11, lineHeight: 1.5 }}>
        Son los <strong>egresos de banco</strong> del período. Quedan fuera los ajustes de saldo y las
        inversiones, que no son gasto de la operación. Lo que aparece “sin rubro” son movimientos que
        nadie clasificó — casi todo es histórico migrado de Odoo.
      </div>
    </React.Fragment>
  );
}

window.FinanzasReportesPage = function FinanzasReportesPage() {
  const [periodo, setPeriodo] = fuSt(() => {
    const v = localStorage.getItem('ss-finreportes-periodo');
    return ['mes', 'ytd', '12m', 'rango'].includes(v) ? v : 'ytd';
  });
  fuEff(() => { localStorage.setItem('ss-finreportes-periodo', periodo); }, [periodo]);
  // Las fechas del rango personalizado SÍ se recuerdan (son un filtro, como en el resto de los
  // módulos); el desglose abierto no, que es estado de la sesión.
  const [fDesde, setFDesde] = window.usePersistedState('ss-finreportes-f-desde', '');
  const [fHasta, setFHasta] = window.usePersistedState('ss-finreportes-f-hasta', '');
  const [data, setData] = fuSt(null);
  const [loading, setLoading] = fuSt(true);
  const [err, setErr] = fuSt('');
  const [ssTick, setSsTick] = fuSt(0);   // re-render cuando llega la Fase 2 (bancos/inventario)

  const rango = fuMemo(() => _rangoPeriodo(periodo, fDesde, fHasta), [periodo, fDesde, fHasta]);

  fuEff(() => {
    let alive = true;
    setLoading(true); setErr('');
    window.getFinanzasReporte?.(rango.desde, rango.hasta).then(r => {
      if (!alive) return;
      if (!r) { setErr('No se pudo cargar el reporte. Reintenta.'); setData(null); }
      else setData(r);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [rango.desde, rango.hasta]);

  // Movimientos de egreso del período, para el desglose por día. Van aparte de la RPC —que
  // devuelve agregados— porque acá hace falta la fila. Es barato: 174 egresos en toda la historia
  // de `demo1`. Se pide SOLO la empresa activa (el panel es por empresa; el Excel de la
  // contadora sí lleva las dos).
  const [gastosMovs, setGastosMovs] = fuSt([]);
  const [gastosCarg, setGastosCarg] = fuSt(true);
  const [gastosErr, setGastosErr]   = fuSt('');
  // Lo que `loadGastosPeriodo` deja AFUERA de `gastos` (traspasos entre cuentas propias e
  // inversiones/capex): no son gasto operativo, pero tampoco se esconden — se nombran en la
  // cabecera del desglose para que quede claro que existen y por qué no suman al total.
  const [gastosAparte, setGastosAparte] = fuSt({ traspasos: [], inversiones: [] });
  fuEff(() => {
    let alive = true;
    setGastosCarg(true); setGastosErr('');
    window.loadGastosPeriodo?.({ desde: rango.desde, hasta: rango.hasta })
      .then(r => {
        if (!alive) return;
        if (!r || r.error) { setGastosErr('No se pudieron cargar los movimientos del período.'); setGastosMovs([]); setGastosAparte({ traspasos: [], inversiones: [] }); }
        else { setGastosMovs(r.gastos || []); setGastosAparte({ traspasos: r.traspasos || [], inversiones: r.inversiones || [] }); }
        setGastosCarg(false);
      })
      .catch(() => { if (alive) { setGastosErr('No se pudieron cargar los movimientos del período.'); setGastosCarg(false); } });
    return () => { alive = false; };
  }, [rango.desde, rango.hasta]);

  // Un repintado por TANDA de datos, no uno por evento: el panel recalcula quiebres de
  // inventario sobre todo el catálogo y saldos de todas las cuentas en cada render.
  fuEff(() => window.ssOnDatos(() => setSsTick(t => t + 1)), []);

  // ── Gastos operativos por categoría, filtrable EN VIVO ──────────────────────────────────────
  // Pedido: "los gastos operativos vienen de varias categorías, poder quitar una o varias para
  // ver el efecto". `gastosMovs` ya trae la categoría por fila (se pide para "En qué se gastó"),
  // así que el total de "Resumen de resultados" se recalcula acá mismo filtrando esas filas —no
  // hace falta otro viaje al server. Persistido como cualquier otro filtro del módulo.
  const [catsExcluidas, setCatsExcluidas] = window.usePersistedState('ss-finreportes-f-gastos-excl', []);
  function toggleCatGasto(key) {
    setCatsExcluidas(prev => prev.includes(key) ? prev.filter(k2 => k2 !== key) : [...prev, key]);
  }
  const catsGasto = fuMemo(() => {
    const map = new Map();
    for (const m of gastosMovs) {
      const key = catKeyOf(m);
      map.set(key, (map.get(key) || 0) + (Number(m.monto_usd) || 0));
    }
    return [...map.entries()].map(([key, monto]) => ({ key, monto })).sort((a, b) => b.monto - a.monto);
  }, [gastosMovs]);
  const gastosOperativosFiltrado = fuMemo(() => {
    return gastosMovs.reduce((s, m) => catsExcluidas.includes(catKeyOf(m)) ? s : s + (Number(m.monto_usd) || 0), 0);
  }, [gastosMovs, catsExcluidas]);

  const k = data?.kpis || {};
  // Contra `ventas_margen` (la venta sin la cobertura BCV), no contra lo facturado: la cobertura
  // es ajuste de tasa y no ganancia. Si el server no la manda (respuesta vieja), se cae a ventas.
  const baseMargen = Number(k.ventas_margen) || Number(k.ventas) || 0;
  const margenPct = baseMargen > 0 ? (k.margen / baseMargen) * 100 : 0;
  const flujoNeto = (k.cobros || 0) - (k.egresos || 0) - (k.pagos_prov || 0);
  // Mientras `gastosMovs` carga se usa el agregado del server (k.egresos) para no arrancar en
  // cero; ya cargado, manda el total filtrado (con exclusiones en 0, es el mismo número).
  const gastosOperativos = gastosCarg ? (k.egresos || 0) : gastosOperativosFiltrado;
  const utilidadAprox = (k.margen || 0) - gastosOperativos;

  // Serie mensual combinada: ventas/ganancia + cobros/egresos.
  const serieMensual = fuMemo(() => {
    if (!data) return [];
    const map = new Map();
    const get = (m) => { if (!map.has(m)) map.set(m, { mes: m, ventas: 0, margen: 0, costo: 0, base: 0, docs: 0, cobros: 0, egresos: 0 }); return map.get(m); };
    (data.serie || []).forEach(r => {
      const o = get(r.mes);
      o.ventas = +r.ventas || 0; o.margen = +r.margen || 0;
      o.costo = +r.costo || 0; o.base = +r.ventas_margen || +r.ventas || 0; o.docs = +r.docs || 0;
    });
    (data.serie_cobros || []).forEach(r => { get(r.mes).cobros = +r.cobros || 0; });
    (data.serie_egresos || []).forEach(r => { get(r.mes).egresos = +r.egresos || 0; });
    return [...map.values()].sort((a, b) => a.mes.localeCompare(b.mes));
  }, [data]);

  const chartVentas = serieMensual.map(r => ({ label: _mesLabel(r.mes), a: r.ventas, b: r.margen }));
  const chartFlujo = serieMensual.map(r => ({ label: _mesLabel(r.mes), a: r.cobros, b: r.egresos }));

  // ── Estado actual (SSData): quiebres de inventario + saldos bancarios ──
  const inventarioInfo = fuMemo(() => {
    void ssTick;
    const productos = SSData.productos || [];
    const inv = SSData.inventario || {};
    const stockDe = (sku) => Object.values(inv[sku] || {}).reduce((s, slot) => s + (slot.cantidad || 0), 0);
    const minDe = (sku) => Object.values(inv[sku] || {}).reduce((s, slot) => s + (slot.minimo || 0), 0);
    const topSkus = new Set((data?.top_productos || []).map(p => p.sku));
    const agotados = [], bajoMin = [];
    for (const p of productos) {
      if (p.activo === false) continue;
      const s = stockDe(p.sku), m = minDe(p.sku);
      if (s <= 0) agotados.push({ sku: p.sku, nombre: p.nombre || p.sku, categoria: p.categoria || '—', vendido: topSkus.has(p.sku) });
      else if (m > 0 && s <= m) bajoMin.push({ sku: p.sku, nombre: p.nombre || p.sku, stock: s, minimo: m });
    }
    // Los agotados que además son top-vendidos van primero (quiebre crítico).
    agotados.sort((a, b) => (b.vendido ? 1 : 0) - (a.vendido ? 1 : 0));
    return { agotados, bajoMin, totalActivos: productos.filter(p => p.activo !== false).length };
  }, [ssTick, data]);

  const bancos = fuMemo(() => {
    void ssTick;
    const cuentas = SSData.cuentasBancarias || [];
    const tasa = (SSData.tasa && SSData.tasa.bcv) || 0;
    let totalUSD = 0;
    const lista = cuentas.map(c => {
      const saldo = parseFloat(c.saldo) || 0;
      const usd = c.moneda === 'USD' ? saldo : (tasa > 0 ? saldo / tasa : 0);
      totalUSD += usd;
      return { banco: c.banco, moneda: c.moneda, saldo, usd, color: c.color };
    }).sort((a, b) => b.usd - a.usd);
    return { lista, totalUSD };
  }, [ssTick]);

  const cxc = data?.cxc || {};
  const cxp = data?.cxp || {};
  const agingRows = [
    { k: 'al_dia', l: 'Por vencer / al día', v: cxc.por_vencer || 0, c: 'var(--success)' },
    { k: 'v1',     l: 'Vencido 1–30 días',   v: cxc.v_0_30   || 0, c: 'var(--warn)' },
    { k: 'v2',     l: 'Vencido 31–60 días',  v: cxc.v_31_60  || 0, c: 'oklch(0.62 0.16 45)' },
    { k: 'v3',     l: 'Vencido +60 días',    v: cxc.v_60     || 0, c: 'var(--danger)' },
  ];
  const agingMax = Math.max(...agingRows.map(r => r.v), 1);

  // ── Qué facturas componen cada tramo de antigüedad ──────────────────────────────────────────
  // Pedido: "debe salir cuales son esas notas para verificarlas". Los agregados (`cxc.v_0_30`, …)
  // ya vienen de la RPC; el detalle sale de `SSData.cuentasCobrar` —cargado completo en el arranque
  // para el badge del sidebar (ver CLAUDE.md, "CxC completa se evaluó y se dejó")—, así
  // que no hace falta pedirle nada nuevo al server. Se agrupa client-side con el MISMO corte de
  // `dias` que usa el resto de la app (negativo = faltan días, positivo = vencida).
  const [tramoAbierto, setTramoAbierto] = fuSt(null);
  const agingDetalle = fuMemo(() => {
    void ssTick;
    const vivas = (SSData.cuentasCobrar || []).filter(c => c.estado !== 'pagada' && (c.monto || 0) - (c.pagado || 0) > 0.005);
    const buckets = { al_dia: [], v1: [], v2: [], v3: [] };
    for (const c of vivas) {
      const k = c.dias <= 0 ? 'al_dia' : c.dias <= 30 ? 'v1' : c.dias <= 60 ? 'v2' : 'v3';
      buckets[k].push(c);
    }
    // Lo más viejo/grande primero — es lo que conviene revisar antes.
    Object.values(buckets).forEach(arr => arr.sort((a, b) => (b.dias - a.dias) || ((b.monto - b.pagado) - (a.monto - a.pagado))));
    return buckets;
  }, [ssTick]);

  // ── Reporte de gastos para la contadora ───────────────────────────────────────────────────
  // Sale todos los meses, con las DOS empresas: por eso no se limita a la empresa activa.
  // Los AJUSTES DE SALDO van en su propia hoja, fuera del total: no son plata que salió, son
  // asientos de apertura. Pero tampoco se ocultan — sin ellos el saldo del banco no cuadraría
  // contra el reporte y nadie entendería el hueco. Ver migracion-odoo/34.
  const [bajando, setBajando] = fuSt(false);
  async function descargarGastos() {
    setBajando(true);
    try {
      const empresas = window.__ssCurrentUser?.empresas?.length
        ? window.__ssCurrentUser.empresas
        : [window.currentEmpresa || 'demo1'];
      const r = await window.loadGastosPeriodo?.({ desde: rango.desde, hasta: rango.hasta, empresas });
      if (!r || r.error) { alert('No se pudo armar el reporte: ' + (r?.error?.message || 'error desconocido')); return; }
      const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
      // El día de la semana en columna propia: "el gasto se dispara los viernes" no se ve leyendo
      // 200 fechas en formato ISO, y en Excel no hay forma cómoda de derivarlo.
      const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
      const conDia = (f) => {
        const d = String(f.fecha || '').slice(0, 10);
        let dia = '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
          const [y, m, dd] = d.split('-').map(Number);
          dia = DIAS[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
        }
        return { ...f, dia_semana: dia, mes: d.slice(0, 7) };
      };
      const gastos      = r.gastos.map(conDia);
      const ajustes     = (r.ajustes || []).map(conDia);
      const inversiones = (r.inversiones || []).map(conDia);

      const COLS = [
        { key: 'fecha', label: 'Fecha' }, { key: 'dia_semana', label: 'Día' }, { key: 'mes', label: 'Mes' },
        { key: 'empresa', label: 'Empresa' },
        { key: 'banco', label: 'Banco' }, { key: 'cuenta', label: 'N° de cuenta' },
        { key: 'categoria', label: 'Rubro' }, { key: 'descripcion', label: 'Concepto' },
        { key: 'moneda', label: 'Moneda' },
        { key: 'monto', label: 'Monto (moneda del banco)' }, { key: 'tasa', label: 'Tasa' },
        { key: 'monto_usd', label: 'Monto USD' },
        { key: 'conciliado', label: 'Conciliado' }, { key: 'registrado_por', label: 'Registrado por' },
        { key: 'documento', label: 'Documento' }, { key: 'id', label: 'ID movimiento' },
      ];

      const totalGastos = r2(gastos.reduce((s, f) => s + f.monto_usd, 0));
      const sinRubro    = gastos.filter(f => !f.categoria || f.categoria === '(sin categoria)');
      // Agrupador genérico: el mismo para rubro, banco, día y mes. Cada hoja de análisis es la
      // misma pregunta con otra clave.
      const agrupar = (filas, clave, etiqueta) => {
        const m = new Map();
        for (const f of filas) {
          const k = clave(f) || '(sin dato)';
          if (!m.has(k)) m.set(k, { [etiqueta]: k, movimientos: 0, monto_usd: 0 });
          const o = m.get(k); o.movimientos += 1; o.monto_usd += f.monto_usd;
        }
        return [...m.values()]
          .map(o => ({ ...o, monto_usd: r2(o.monto_usd),
                       pct: totalGastos > 0 ? r2(o.monto_usd / totalGastos * 100) : 0 }))
          .sort((a, b) => b.monto_usd - a.monto_usd);
      };
      const porRubro = agrupar(gastos, f => (f.categoria === '(sin categoria)' ? 'SIN RUBRO' : f.categoria), 'rubro');
      const porBanco = agrupar(gastos, f => f.banco, 'banco');
      const porDia   = agrupar(gastos, f => String(f.fecha || '').slice(0, 10), 'dia')
        .sort((a, b) => String(b.dia).localeCompare(String(a.dia)));
      const porMes   = agrupar(gastos, f => f.mes, 'mes').sort((a, b) => String(b.mes).localeCompare(String(a.mes)));
      const porEmpresa = agrupar(gastos, f => f.empresa, 'empresa');

      // El bloque que va ARRIBA de cada hoja: los totales primero, el listado después. Sin esto
      // el archivo abre en una parrilla de filas y hay que sumar a mano para saber de qué se
      // está hablando (pedido explícito del usuario, 2026-08-06).
      const cab = [
        { label: 'Período', valor: `${rango.desde} a ${rango.hasta}` },
        { label: 'Empresas', valor: empresas.join(', ') },
        { sep: true },
        { label: 'TOTAL GASTOS (USD)', valor: totalGastos },
        { label: 'Movimientos', valor: gastos.length },
        { label: 'Promedio por movimiento (USD)', valor: gastos.length ? r2(totalGastos / gastos.length) : 0 },
        { label: 'Días con gasto', valor: porDia.length },
        { label: 'Rubros distintos', valor: porRubro.length },
        { label: 'Sin rubro asignado', valor: `${sinRubro.length} mov. · ${r2(sinRubro.reduce((s, f) => s + f.monto_usd, 0))} USD` },
        { sep: true },
        { label: 'Ajustes de saldo (NO son gasto)', valor: `${ajustes.length} mov. · ${r2(ajustes.reduce((s, f) => s + f.monto_usd, 0))} USD` },
        { label: 'Inversiones (NO son gasto)', valor: `${inversiones.length} mov. · ${r2(inversiones.reduce((s, f) => s + f.monto_usd, 0))} USD` },
      ];

      const colsGrupo = (k, etiqueta) => ([
        { key: k, label: etiqueta }, { key: 'movimientos', label: 'Movimientos' },
        { key: 'monto_usd', label: 'Monto USD' }, { key: 'pct', label: '% del total' },
      ]);

      const sheets = [
        { name: 'Gastos', titulo: 'Gastos del período — detalle', rows: gastos, columns: COLS, resumen: cab },
        { name: 'Por rubro', titulo: 'Gastos por rubro', rows: porRubro, columns: colsGrupo('rubro', 'Rubro'),
          resumen: [{ label: 'TOTAL GASTOS (USD)', valor: totalGastos }, { label: 'Rubros', valor: porRubro.length }] },
        { name: 'Por día', titulo: 'Gastos por día', rows: porDia, columns: colsGrupo('dia', 'Día'),
          resumen: [{ label: 'TOTAL GASTOS (USD)', valor: totalGastos }, { label: 'Días con gasto', valor: porDia.length }] },
        { name: 'Por banco', titulo: 'Gastos por banco', rows: porBanco, columns: colsGrupo('banco', 'Banco'),
          resumen: [{ label: 'TOTAL GASTOS (USD)', valor: totalGastos }] },
      ];
      if (porMes.length > 1) sheets.push({ name: 'Por mes', titulo: 'Gastos por mes', rows: porMes,
        columns: colsGrupo('mes', 'Mes'), resumen: [{ label: 'TOTAL GASTOS (USD)', valor: totalGastos }] });
      if (porEmpresa.length > 1) sheets.push({ name: 'Por empresa', titulo: 'Gastos por empresa', rows: porEmpresa,
        columns: colsGrupo('empresa', 'Empresa'), resumen: [{ label: 'TOTAL GASTOS (USD)', valor: totalGastos }] });
      // Los AJUSTES DE SALDO no son plata que salió: son asientos de apertura/corrección del banco.
      // Van en hoja aparte y fuera del total, pero NO se ocultan — sin ellos el saldo bancario no
      // cuadra contra el reporte y el hueco no se explica. Ver migracion-odoo/34.
      if (ajustes.length) sheets.push({ name: 'Ajustes de saldo', titulo: 'Ajustes de saldo (no son gasto)',
        rows: ajustes, columns: COLS,
        resumen: [{ label: 'Total ajustes (USD)', valor: r2(ajustes.reduce((s, f) => s + f.monto_usd, 0)) },
                  { sep: true },
                  { label: 'Un ajuste de saldo NO es un gasto', valor: 'es un asiento de apertura o corrección del banco' }] });
      // Las inversiones (capex) salen del banco pero compran un activo: tampoco son gasto operativo.
      if (inversiones.length) sheets.push({ name: 'Inversiones', titulo: 'Inversiones (no son gasto operativo)',
        rows: inversiones, columns: COLS,
        resumen: [{ label: 'Total inversiones (USD)', valor: r2(inversiones.reduce((s, f) => s + f.monto_usd, 0)) }] });
      const ok = await window.exportSheetsToXLSX(sheets, `gastos_${rango.desde}_a_${rango.hasta}`);
      if (ok) window.logActivity?.({ modulo: 'finanzas_reportes', accion: 'exportar',
        entidad_label: 'Reporte de gastos', detalles: { desde: rango.desde, hasta: rango.hasta, empresas, gastos: r.gastos.length, ajustes: r.ajustes.length, inversiones: r.inversiones?.length || 0 } });
    } finally { setBajando(false); }
  }

  // ── Detalle de cada tarjeta ────────────────────────────────────────────────────────────────
  // Ocho números grandes sin explicación obligan a creerles o a desconfiar de todos. Cada uno
  // abre QUÉ es, CÓMO se llega a él (los renglones que suman, con los montos reales) y DE DÓNDE
  // sale (qué tabla, con qué filtro). No consulta nada: todo esto ya viene en la respuesta de
  // `get_finanzas_reporte` — lo que faltaba era mostrarlo.
  const [kpiDet, setKpiDet] = fuSt(null);
  const _mes = (r) => _mesLabel(r.mes);
  const detalleKpi = (id) => {
    const usd = fmt.usd;
    const cobertura = (Number(k.ventas) || 0) - baseMargen;
    const egresosTot = (Number(k.egresos) || 0) + (Number(k.pagos_prov) || 0);
    const D = {
      ventas: {
        titulo: 'Ventas (facturación)', color: 'var(--brand)', valor: usd(k.ventas || 0),
        que: 'Todo lo que se facturó en el período. Es la suma del subtotal de cada línea de cada factura — sin IVA y sin el descuento del documento.',
        filas: [
          ['Subtotal de las líneas facturadas', usd(k.ventas || 0), true],
          ['Facturas emitidas', (k.docs || 0).toLocaleString('es-VE')],
          ['Unidades vendidas', (k.unidades || 0).toLocaleString('es-VE')],
        ],
        fuente: 'Líneas (documentos_items) de los documentos tipo "factura" del período, sin las canceladas. Se cuentan por FECHA DE EMISIÓN de la factura, no por cuándo se cobró.',
        tabla: { cols: ['Mes', 'Ventas', 'Facturas'],
                 rows: serieMensual.map(r => [_mes(r), usd(r.ventas), (r.docs || 0).toLocaleString('es-VE')]) },
      },
      margen: {
        titulo: 'Ganancia bruta', color: 'var(--success)', valor: usd(k.margen || 0),
        que: 'Lo que queda de la venta después de pagar la mercancía. Es ganancia BRUTA: no descuenta sueldos, alquiler ni ningún gasto operativo.',
        filas: [
          ['Facturado', usd(k.ventas || 0)],
          ['− Cobertura BCV', '− ' + usd(cobertura), false, 'En una venta BCV el precio ya lleva la cobertura encima. Eso es ajuste de tasa, no ganancia: si no se descuenta, una venta al 35% aparenta 35 puntos de margen que no existen.'],
          ['= Base sobre la que se mide', usd(baseMargen)],
          ['− Costo de la mercancía', '− ' + usd(k.costo || 0)],
          ['= Ganancia bruta', usd(k.margen || 0), true],
          ['Margen', margenPct.toFixed(1) + '%'],
        ],
        fuente: 'Mismo criterio que Reportes y que Comisiones. Medir distinto haría que la misma venta tuviera dos márgenes según la pantalla.',
        tabla: { cols: ['Mes', 'Base', 'Costo', 'Ganancia', 'Margen'],
                 rows: serieMensual.map(r => [_mes(r), usd(r.base), usd(r.costo), usd(r.margen),
                                              (r.base > 0 ? (r.margen / r.base) * 100 : 0).toFixed(1) + '%']) },
      },
      costo: {
        titulo: 'Costo de ventas', color: 'var(--text)', valor: usd(k.costo || 0),
        que: 'Lo que costó la mercancía que se vendió en el período (COGS). No incluye gastos de operación.',
        filas: [
          ['Costo de la mercancía vendida', usd(k.costo || 0), true],
          ['Unidades', (k.unidades || 0).toLocaleString('es-VE')],
          ['Costo promedio por unidad', usd(k.unidades ? k.costo / k.unidades : 0)],
        ],
        fuente: 'Costo de cada línea × cantidad. Si la línea no trae costo propio —el 95% de lo migrado de Odoo— se usa el costo actual del producto en el catálogo. Contarlas en 0 daría 100% de margen en esas líneas.',
        tabla: { cols: ['Mes', 'Costo', 'Ventas'],
                 rows: serieMensual.map(r => [_mes(r), usd(r.costo), usd(r.ventas)]) },
      },
      ticket: {
        titulo: 'Ticket promedio', color: 'var(--text)', valor: usd(k.docs ? k.ventas / k.docs : 0),
        que: 'Cuánto factura, en promedio, cada factura del período.',
        filas: [
          ['Ventas del período', usd(k.ventas || 0)],
          ['÷ Facturas emitidas', (k.docs || 0).toLocaleString('es-VE')],
          ['= Ticket promedio', usd(k.docs ? k.ventas / k.docs : 0), true],
        ],
        fuente: 'Es una división de los dos números de arriba. Sube tanto si se vende más caro como si se emiten menos facturas por el mismo monto.',
        tabla: { cols: ['Mes', 'Ventas', 'Facturas', 'Ticket'],
                 rows: serieMensual.map(r => [_mes(r), usd(r.ventas), (r.docs || 0).toLocaleString('es-VE'),
                                              usd(r.docs ? r.ventas / r.docs : 0)]) },
      },
      cobros: {
        titulo: 'Cobros recibidos', color: 'var(--success)', valor: usd(k.cobros || 0),
        que: 'La plata que efectivamente entró en el período.',
        filas: [['Cobros registrados', usd(k.cobros || 0), true]],
        fuente: 'Libro de pagos, movimientos de tipo cobro, por la fecha del pago. NO tiene por qué coincidir con las ventas del período: acá entran cobros de facturas de meses anteriores, y las ventas de este mes que aún no se cobraron no aparecen.',
        tabla: { cols: ['Mes', 'Cobros', 'Ventas del mes'],
                 rows: serieMensual.map(r => [_mes(r), usd(r.cobros), usd(r.ventas)]) },
      },
      egresos: {
        titulo: 'Egresos / gastos', color: 'var(--danger)', valor: usd(egresosTot),
        que: 'Todo lo que salió de caja en el período.',
        filas: [
          ['Movimientos de banco (egresos)', usd(Number(k.egresos) || 0)],
          ['+ Pagos a proveedores', usd(Number(k.pagos_prov) || 0)],
          ['= Total de salidas', usd(egresosTot), true],
          ...(Number(k.ajustes) ? [['Ajustes de saldo (aparte)', usd(Number(k.ajustes)), false,
            `${k.ajustes_n} movimiento(s). NO son gastos: son asientos de apertura o corrección del banco. Contarlos infló este número 177 veces hasta que se separaron.`]] : []),
          ...(Number(k.inversiones) ? [['Inversiones (aparte)', usd(Number(k.inversiones)), false,
            'Compra de maquinaria o inversión externa. Sale del banco pero no es gasto del negocio: vive en el módulo Inversiones.']] : []),
        ],
        fuente: 'Movimientos bancarios de egreso + pagos a proveedores, por fecha del movimiento. Excluye ajustes de saldo e inversiones.',
        tabla: { cols: ['Categoría', 'Movs.', 'Monto'],
                 rows: (data?.egresos_categorias || []).map(c => [
                   c.categoria === 'Sin categoria' ? 'Sin categoría' : c.categoria,
                   String(c.movs || 0), usd(Number(c.monto) || 0)]) },
      },
      flujo: {
        titulo: 'Flujo neto de caja', color: flujoNeto >= 0 ? 'var(--success)' : 'var(--danger)', valor: usd(flujoNeto),
        que: 'Lo que entró menos lo que salió. Negativo significa que en el período salió más plata de la que entró — no que el negocio pierda: puede ser que se cobre tarde.',
        filas: [
          ['Cobros recibidos', usd(k.cobros || 0)],
          ['− Movimientos de banco', '− ' + usd(Number(k.egresos) || 0)],
          ['− Pagos a proveedores', '− ' + usd(Number(k.pagos_prov) || 0)],
          ['= Flujo neto', usd(flujoNeto), true],
        ],
        fuente: 'Es caja, no resultado. La ganancia bruta mide la venta; esto mide el movimiento de dinero, que ocurre en otro momento.',
        tabla: { cols: ['Mes', 'Cobros', 'Egresos', 'Neto'],
                 rows: serieMensual.map(r => [_mes(r), usd(r.cobros), usd(r.egresos), usd(r.cobros - r.egresos)]) },
      },
      cxc: {
        titulo: 'Por cobrar (CxC)', color: 'var(--warn)', valor: usd(cxc.pendiente_monto || 0),
        que: 'Lo que los clientes todavía deben. Es la foto de HOY: a diferencia de las otras tarjetas, no depende del rango de fechas de arriba.',
        filas: [
          ['Facturas abiertas', (cxc.pendiente_count || 0).toLocaleString('es-VE')],
          ['Total por cobrar', usd(cxc.pendiente_monto || 0), true],
        ],
        fuente: 'Facturas con estado de cobro "por cobrar" o "parcial". Suma el TOTAL de la factura, no el saldo: una factura con abono parcial cuenta completa, así que este número sobreestima la deuda real.',
        tabla: { cols: ['Antigüedad', 'Monto'], rows: [
          ['Por vencer',        usd(cxc.por_vencer || 0)],
          ['Vencida 1 a 30 d.', usd(cxc.v_0_30 || 0)],
          ['Vencida 31 a 60 d.',usd(cxc.v_31_60 || 0)],
          ['Vencida +60 d.',    usd(cxc.v_60 || 0)],
        ] },
      },
    };
    return D[id] || null;
  };

  const KPI = ({ id, label, value, sub, color, accent }) => (
    <div className="stat" onClick={id ? () => setKpiDet(id) : undefined}
         title={id ? 'Ver de dónde sale este número' : undefined}
         style={{ ...(accent ? { borderLeft: `3px solid ${color || 'var(--brand)'}` } : {}),
                  ...(id ? { cursor: 'pointer' } : {}) }}>
      <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        {label}{id && <Icon name="info" size={11} style={{ opacity: .45 }} />}
      </div>
      <div className="stat-val" style={{ fontSize: 22, color: color || 'var(--text)' }}>{value}</div>
      {sub != null && <div className="small mt-2" style={{ color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reportes de Finanzas</h1>
          <div className="page-subtitle">Panel ejecutivo · {rango.label}{loading ? ' · cargando…' : ''}</div>
        </div>
        <div className="page-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="seg">
            <button className={periodo === 'mes' ? 'on' : ''} onClick={() => setPeriodo('mes')}>Mes actual</button>
            <button className={periodo === 'ytd' ? 'on' : ''} onClick={() => setPeriodo('ytd')}>Año</button>
            <button className={periodo === '12m' ? 'on' : ''} onClick={() => setPeriodo('12m')}>12 meses</button>
          </div>
          {/* Rango propio: manda sobre el preset y afecta TODA la página (KPIs, gráficos, tops,
              antigüedad de CxC y el desglose por mes) — no es el filtro de una tarjeta. Al escribir
              una fecha se pasa solo a 'rango', sin obligar a apretar otro botón antes. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="date" className="input sm" style={{ width: 140 }} title="Desde" value={fDesde}
                   onChange={e => { setFDesde(e.target.value); if (e.target.value && fHasta) setPeriodo('rango'); }} />
            <span className="muted">→</span>
            <input type="date" className="input sm" style={{ width: 140 }} title="Hasta" value={fHasta}
                   onChange={e => { setFHasta(e.target.value); if (e.target.value && fDesde) setPeriodo('rango'); }} />
            {periodo === 'rango' && (
              <button className="btn ghost sm" title="Volver al año en curso"
                      onClick={() => { setFDesde(''); setFHasta(''); setPeriodo('ytd'); }}>
                <Icon name="x" size={12} />Quitar
              </button>
            )}
          </div>
          {/* El reporte que se le manda a la contadora todos los meses. Sale con el rango que esté
              activo arriba y con TODAS las empresas del usuario, no solo la activa. */}
          <button className="btn" onClick={descargarGastos} disabled={bajando}
                  title="Descargar el detalle de gastos del período (Excel) — todas las empresas">
            <Icon name="download" size={14} />{bajando ? 'Armando…' : 'Reporte de gastos'}
          </button>
        </div>
      </div>

      {err && <div className="card" style={{ padding: 16, color: 'var(--danger)', marginBottom: 12 }}>{err}</div>}

      {loading && !data ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: '90px 20px', gap: 12, color: 'var(--text-muted)' }}>
          <div className="ss-spinner" />
          <div style={{ fontSize: 13 }}>Calculando indicadores financieros…</div>
        </div>
      ) : (
        <React.Fragment>
          {/* ── KPIs principales ── */}
          <div className="stat-grid">
            <KPI id="ventas" label="Ventas (facturación)" value={fmt.usd(k.ventas || 0)} sub={`${(k.docs || 0).toLocaleString('es-VE')} facturas · ${(k.unidades || 0).toLocaleString('es-VE')} u.`} accent color="var(--brand)" />
            <KPI id="margen" label="Ganancia bruta" value={fmt.usd(k.margen || 0)} sub={`Margen ${margenPct.toFixed(1)}%`} accent color="var(--success)" />
            <KPI id="costo" label="Costo de ventas" value={fmt.usd(k.costo || 0)} sub="COGS del período" />
            <KPI id="ticket" label="Ticket promedio" value={fmt.usd(k.docs ? k.ventas / k.docs : 0)} sub="por factura" />
            <KPI id="cobros" label="Cobros recibidos" value={fmt.usd(k.cobros || 0)} sub="entradas de caja" accent color="var(--success)" />
            {/* Los ajustes de saldo quedaron FUERA de `egresos` (migracion-odoo/34). Cuando hay,
                se dicen acá: si no, el saldo del banco no cuadra contra este número y parece que
                el reporte se comió movimientos. */}
            <KPI id="egresos" label="Egresos / gastos" value={fmt.usd((Number(k.egresos) || 0) + (Number(k.pagos_prov) || 0))}
                 sub={Number(k.ajustes) ? `salidas de caja · ${k.ajustes_n} ajuste${k.ajustes_n === 1 ? '' : 's'} de saldo por ${fmt.usd(Number(k.ajustes))} aparte` : 'salidas de caja'}
                 accent color="var(--danger)" />
            <KPI id="flujo" label="Flujo neto de caja" value={fmt.usd(flujoNeto)} sub={flujoNeto >= 0 ? 'superávit' : 'déficit'} accent color={flujoNeto >= 0 ? 'var(--success)' : 'var(--danger)'} />
            <KPI id="cxc" label="Por cobrar (CxC)" value={fmt.usd(cxc.pendiente_monto || 0)} sub={`${cxc.pendiente_count || 0} facturas abiertas`} accent color="var(--warn)" />
          </div>

          {/* ── P&L resumen + Tendencia ── */}
          <div className="stat-grid mt-4" style={{ gridTemplateColumns: 'minmax(260px, 1fr) 2fr' }}>
            <Section title="Resumen de resultados" subtitle={rango.label} icon="finance">
              {[
                { l: 'Ventas', v: k.ventas || 0, strong: true },
                { l: '(−) Costo de ventas', v: -(k.costo || 0), muted: true },
                { l: '= Ganancia bruta', v: k.margen || 0, strong: true, color: 'var(--success)' },
                { l: '(−) Gastos operativos', v: -gastosOperativos, muted: true },
                { l: '= Utilidad aprox.', v: utilidadAprox, strong: true, color: utilidadAprox >= 0 ? 'var(--success)' : 'var(--danger)' },
              ].map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0', borderBottom: i < 4 ? '1px solid var(--border)' : 'none' }}>
                  <span style={{ fontSize: 13, fontWeight: r.strong ? 600 : 400, color: r.muted ? 'var(--text-muted)' : 'var(--text)' }}>{r.l}</span>
                  <span className="mono" style={{ fontSize: 13.5, fontWeight: r.strong ? 700 : 500, color: r.color || (r.muted ? 'var(--text-muted)' : 'var(--text)') }}>{fmt.usd(r.v)}</span>
                </div>
              ))}
              {/* Pedido: los gastos operativos son la suma de varias categorías — poder quitar
                  una o varias EN VIVO para ver cómo queda la utilidad sin ellas. Clic en el chip
                  la excluye (tachado); vuelve a incluirse con otro clic. */}
              {catsGasto.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span className="small muted" style={{ fontSize: 11 }}>Categorías de gasto (clic para quitar/poner)</span>
                    {catsExcluidas.length > 0 && (
                      <button className="btn ghost sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => setCatsExcluidas([])}>
                        Restablecer
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {catsGasto.map(c => {
                      const activo = !catsExcluidas.includes(c.key);
                      return (
                        <button key={c.key} type="button" onClick={() => toggleCatGasto(c.key)}
                                title={`${fmt.usd(c.monto)}${activo ? '' : ' · excluida del cálculo'}`}
                                style={{
                                  fontSize: 11, padding: '3px 8px', borderRadius: 999, cursor: 'pointer',
                                  border: `1px solid ${activo ? 'var(--border)' : 'var(--danger)'}`,
                                  background: activo ? 'var(--bg-sunken)' : 'transparent',
                                  color: activo ? 'var(--text)' : 'var(--danger)',
                                  textDecoration: activo ? 'none' : 'line-through',
                                }}>
                          {c.key}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--bg-sunken)', borderRadius: 8, fontSize: 11.5, color: 'var(--text-muted)' }}>
                Margen bruto <strong style={{ color: 'var(--text)' }}>{margenPct.toFixed(1)}%</strong>. La utilidad aprox. descuenta solo egresos bancarios registrados (no nómina/impuestos fuera del sistema)
                {catsExcluidas.length > 0 ? `, sin contar ${catsExcluidas.length} categoría${catsExcluidas.length === 1 ? '' : 's'} de gasto excluida${catsExcluidas.length === 1 ? '' : 's'}` : ''}.
              </div>
            </Section>
            <Section title="Ventas y ganancia por mes" subtitle="Facturación vs ganancia bruta" icon="chart">
              <FinBars data={chartVentas} aColor="var(--brand)" bColor="var(--success)" aLabel="Ventas" bLabel="Ganancia" />
            </Section>
          </div>

          {/* ── Venta mes por mes, con el detalle abajo ── */}
          <div className="mt-4">
            <Section title="Venta mes por mes" icon="finance"
              subtitle="Clic en un mes para ver las órdenes que lo generaron; clic en una orden para ver sus productos y dónde se pierde el margen">
              <MesesDesglose meses={serieMensual} />
            </Section>
          </div>

          {/* ── Flujo de caja + Categorías ── */}
          <div className="stat-grid mt-4" style={{ gridTemplateColumns: '2fr minmax(300px, 1.4fr)' }}>
            <Section title="Flujo de caja por mes" subtitle="Cobros recibidos vs egresos" icon="cash">
              <FinBars data={chartFlujo} aColor="var(--success)" bColor="var(--danger)" aLabel="Cobros" bLabel="Egresos" />
            </Section>
            <Section title="Ventas por categoría" subtitle="Participación en facturación" icon="inventory">
              <FinDonut data={data?.categorias || []} />
            </Section>
          </div>

          {/* ── En qué se gastó ─────────────────────────────────────────────────────────────
              El panel decía cuánto se gastaba pero no en qué. Los renglones suman EXACTAMENTE el
              total de la tarjeta "Egresos / gastos": misma ventana y misma exclusión de ajustes de
              saldo e inversiones. Lo no clasificado sale como "Sin categoría" en vez de esconderse
              —es el renglón sobre el que hay que trabajar—, y se marca para que se note. */}
          {(() => {
            const totalDet = gastosMovs.reduce((s, m) => s + (Number(m.monto_usd) || 0), 0);
            const sinRubro = gastosMovs.filter(m => !m.categoria || m.categoria === '(sin categoria)');
            const sinRubroUsd = sinRubro.reduce((s, m) => s + (Number(m.monto_usd) || 0), 0);
            const { traspasos, inversiones } = gastosAparte;
            const sumaUsd = (arr) => arr.reduce((s, m) => s + (Number(m.monto_usd) || 0), 0);
            return (
              <div className="mt-4">
                <Section title="En qué se gastó" icon="cash"
                         subtitle={gastosCarg ? rango.label
                           : `${fmt.usd(totalDet)} en ${gastosMovs.length} movimiento${gastosMovs.length === 1 ? '' : 's'} · ${rango.label} · clic en una fila para ver los movimientos`}
                         right={(sinRubro.length || traspasos.length || inversiones.length) ? (
                           <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                             {sinRubro.length > 0 && (
                               <span className="small" style={{ color: 'var(--warn)' }}>
                                 {sinRubro.length} sin rubro ({fmt.usd(sinRubroUsd)})
                               </span>
                             )}
                             {/* Traspasos e inversiones NO son gasto —se excluyen del total de arriba—
                                 pero se dicen acá para que no parezca que "desaparecieron" del banco. */}
                             {traspasos.length > 0 && (
                               <span className="small muted" title="Movimientos entre cuentas propias: la plata sigue siendo de la empresa, no es gasto.">
                                 {traspasos.length} traspaso{traspasos.length === 1 ? '' : 's'} entre cuentas ({fmt.usd(sumaUsd(traspasos))}) — no son gasto
                               </span>
                             )}
                             {inversiones.length > 0 && (
                               <span className="small muted" title="Compra de maquinaria o inversión externa: vive en el módulo Inversiones.">
                                 {inversiones.length} inversión{inversiones.length === 1 ? '' : 'es'} ({fmt.usd(sumaUsd(inversiones))}) — módulo Inversiones
                               </span>
                             )}
                           </div>
                         ) : null}>
                  <GastosDesglose movs={gastosMovs} cargando={gastosCarg} error={gastosErr} />
                </Section>
              </div>
            );
          })()}

          {/* ── Top clientes + Top vendedores ── */}
          <div className="stat-grid mt-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Section title="Mejores clientes" subtitle="Top 10 por facturación" icon="clients">
              <TopTable
                rows={(data?.top_clientes || []).map(c => ({ ...c, _name: c.nombre, _bar: +c.monto }))}
                cols={{ label: 'Cliente', mainH: 'Ventas', mainFmt: r => fmt.usd(r.monto), extra: [{ key: 'docs', h: 'Docs', fmt: r => (r.docs || 0).toLocaleString('es-VE') }] }}
              />
            </Section>
            <Section title="Mejores vendedores" subtitle="Top 10 por facturación" icon="users">
              <TopTable
                rows={(data?.top_vendedores || []).map(v => ({ ...v, _name: v.vendedor, _bar: +v.monto }))}
                cols={{ label: 'Vendedor', mainH: 'Ventas', mainFmt: r => fmt.usd(r.monto), extra: [
                  { key: 'docs', h: 'Docs', fmt: r => (r.docs || 0).toLocaleString('es-VE') },
                  { key: 'margen', h: 'Ganancia', fmt: r => fmt.usd(r.margen) },
                ] }}
              />
            </Section>
          </div>

          {/* ── Top productos + CxC aging ── */}
          <div className="stat-grid mt-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Section title="Productos más vendidos" subtitle="Top 12 por facturación" icon="box">
              <TopTable
                rows={(data?.top_productos || []).map(p => ({ ...p, _name: p.nombre, _bar: +p.monto,
                _copy: [{ text: p.sku, title: 'Copiar SKU' }, { text: p.nombre, title: 'Copiar el nombre del producto' }] }))}
                cols={{ label: 'Producto', mainH: 'Ventas', mainFmt: r => fmt.usd(r.monto), extra: [{ key: 'u', h: 'Unid.', fmt: r => (r.unidades || 0).toLocaleString('es-VE') }] }}
              />
            </Section>
            <Section title="Cuentas por cobrar — antigüedad" subtitle={`${cxc.pendiente_count || 0} facturas · ${fmt.usd(cxc.pendiente_monto || 0)} pendiente · clic en un tramo para ver las notas`} icon="cxc">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0' }}>
                {agingRows.map((r, i) => {
                  const notas = agingDetalle[r.k] || [];
                  const abierto = tramoAbierto === r.k;
                  return (
                    <div key={i}>
                      <div style={{ cursor: notas.length ? 'pointer' : 'default' }}
                           onClick={notas.length ? () => setTramoAbierto(t => t === r.k ? null : r.k) : undefined}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            {r.l}
                            {notas.length > 0 && <Icon name={abierto ? 'chevronU' : 'chevronD'} size={11} style={{ opacity: .6 }} />}
                          </span>
                          <span className="mono" style={{ fontWeight: 600 }}>{fmt.usd(r.v)}</span>
                        </div>
                        <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-sunken)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${(r.v / agingMax) * 100}%`, background: r.c, borderRadius: 4, transition: 'width .4s' }} />
                        </div>
                      </div>
                      {/* Sub-elementos: las notas concretas de ESTE tramo, para poder ir a verificarlas
                          una por una. Tope de 20 (lo que más pesa/más viejo primero, ya ordenado) —
                          "por vencer" puede tener cientos de facturas sanas, y listarlas todas no
                          ayuda a nadie a revisar nada. */}
                      {abierto && (
                        <div className="tbl-wrap" style={{ marginTop: 6 }}>
                          <table className="tbl" style={{ fontSize: 12 }}>
                            <thead><tr><th>Factura</th><th>Cliente</th><th className="num">Días</th><th className="num">Saldo</th></tr></thead>
                            <tbody>
                              {notas.slice(0, 20).map(c => {
                                const cli = (SSData.clientes || []).find(cl => cl.id === c.cliente);
                                const saldo = (c.monto || 0) - (c.pagado || 0);
                                return (
                                  <tr key={c.id} style={{ cursor: 'pointer' }}
                                      onClick={async () => {
                                        const ok = await window.abrirDocumentoPorId?.(c.factura || c.id);
                                        if (!ok) alert('No se pudo abrir la factura. Puede que la hayan eliminado.');
                                      }}>
                                    <td className="mono" style={{ color: 'var(--brand)' }}>{c.factura || c.id}</td>
                                    <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cli?.nombre}>{cli?.nombre || c.cliente || '—'}</td>
                                    <td className="num">{c.dias > 0 ? `+${c.dias}` : c.dias}</td>
                                    <td className="num mono">{fmt.usd(saldo)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          {notas.length > 20 && (
                            <div className="small muted" style={{ padding: '4px 10px' }}>y {notas.length - 20} factura{notas.length - 20 === 1 ? '' : 's'} más en este tramo…</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', fontSize: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <span className="muted">Por pagar a proveedores (CxP)</span>
                  <span className="mono" style={{ fontWeight: 600 }}>{fmt.usd(cxp.pendiente_monto || 0)} <span className="muted">· {cxp.pendiente_count || 0}</span></span>
                </div>
              </div>
            </Section>
          </div>

          {/* ── Quiebres de inventario + Saldos bancarios ── */}
          <div className="stat-grid mt-4" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
            <Section title="Quiebres de inventario" subtitle={`${inventarioInfo.agotados.length} agotados · ${inventarioInfo.bajoMin.length} bajo mínimo`} icon="warehouse"
              right={<span className="chip" style={{ background: inventarioInfo.agotados.length ? 'var(--danger-soft, #fef2f2)' : 'var(--bg-sunken)', color: inventarioInfo.agotados.length ? 'var(--danger)' : 'var(--text-muted)', fontSize: 11, padding: '2px 9px', borderRadius: 20, fontWeight: 600 }}>{inventarioInfo.agotados.length} sin stock</span>}>
              {(SSData.productos || []).length === 0 ? (
                <div className="empty" style={{ padding: 20 }}>Cargando inventario…</div>
              ) : inventarioInfo.agotados.length === 0 ? (
                <div className="empty" style={{ padding: 20 }}>Sin productos agotados 🎉</div>
              ) : (
                <div className="tbl-wrap">
                  <table className="tbl" style={{ fontSize: 12.5 }}>
                    <thead><tr><th>Producto agotado</th><th>Categoría</th><th className="num">Estado</th></tr></thead>
                    <tbody>
                      {inventarioInfo.agotados.slice(0, 15).map((p, i) => (
                        <tr key={i}>
                          <td><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }} title={p.nombre}>{p.nombre}</div><div className="small muted mono">{p.sku}</div></td>
                          <td className="small muted">{p.categoria}</td>
                          <td className="num">{p.vendido
                            ? <span style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 11 }}>⚠ Top vendido</span>
                            : <span className="muted" style={{ fontSize: 11 }}>Sin stock</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {inventarioInfo.agotados.length > 15 && <div className="small muted" style={{ padding: '8px 4px 0' }}>+{inventarioInfo.agotados.length - 15} productos agotados más</div>}
                </div>
              )}
            </Section>
            <Section title="Saldos en bancos" subtitle={`${bancos.lista.length} cuentas · ${fUsdK(bancos.totalUSD)} equivalente`} icon="bank">
              {bancos.lista.length === 0 ? (
                <div className="empty" style={{ padding: 20 }}>Cargando cuentas…</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {bancos.lista.map((b, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '7px 10px', background: 'var(--bg-sunken)', borderRadius: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 3, background: b.color || 'var(--brand)', flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{b.banco}</span>
                        <span className="chip" style={{ fontSize: 10, background: 'var(--bg-elev)', color: 'var(--text-muted)', padding: '1px 6px', borderRadius: 5 }}>{b.moneda}</span>
                      </div>
                      <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{b.moneda === 'USD' ? fmt.usd(b.saldo) : fmt.bs(b.saldo)}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--border)', marginTop: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>Total equivalente</span>
                    <span className="mono" style={{ fontWeight: 700, fontSize: 14, color: 'var(--brand)' }}>{fmt.usd(bancos.totalUSD)}</span>
                  </div>
                </div>
              )}
            </Section>
          </div>

          <div className="small muted" style={{ marginTop: 16, textAlign: 'center' }}>
            Ventas, ganancia y cobros: histórico completo del período · Inventario y saldos bancarios: estado actual en vivo.
          </div>
        </React.Fragment>
      )}

      {/* ── De dónde sale este número ──────────────────────────────────────────────────────── */}
      {kpiDet && (() => {
        const d = detalleKpi(kpiDet);
        if (!d) return null;
        const hayTabla = d.tabla && d.tabla.rows && d.tabla.rows.length > 0;
        return (
          <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setKpiDet(null); }}>
            <div className="modal" style={{ maxWidth: 560, width: '95vw' }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="modal-title">{d.titulo}</div>
                  <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: d.color, marginTop: 2 }}>{d.valor}</div>
                  <div className="small muted" style={{ marginTop: 2 }}>{rango.label}</div>
                </div>
                <button className="icon-btn" onClick={() => setKpiDet(null)}><Icon name="x" size={14} /></button>
              </div>
              <div className="modal-body" style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '68vh', overflowY: 'auto' }}>
                <div>
                  <div className="stat-label" style={{ marginBottom: 5 }}>Qué es</div>
                  <div style={{ fontSize: 13, lineHeight: 1.65 }}>{d.que}</div>
                </div>

                <div>
                  <div className="stat-label" style={{ marginBottom: 5 }}>Cómo se llega a ese número</div>
                  <div style={{ background: 'var(--bg-sunken)', borderRadius: 8, padding: '4px 12px' }}>
                    {d.filas.map(([lbl, val, fuerte, nota], i) => (
                      <div key={i} style={{ padding: '7px 0', borderBottom: i < d.filas.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                          <span style={{ fontSize: 12.5, fontWeight: fuerte ? 700 : 400 }}>{lbl}</span>
                          <span className="mono" style={{ fontSize: 13, fontWeight: fuerte ? 700 : 500, color: fuerte ? d.color : undefined, whiteSpace: 'nowrap' }}>{val}</span>
                        </div>
                        {nota && <div className="small muted" style={{ marginTop: 4, lineHeight: 1.55 }}>{nota}</div>}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="stat-label" style={{ marginBottom: 5 }}>De dónde sale</div>
                  <div className="small" style={{ lineHeight: 1.65, color: 'var(--text-muted)' }}>{d.fuente}</div>
                </div>

                {hayTabla && (
                  <div>
                    <div className="stat-label" style={{ marginBottom: 5 }}>Desglose</div>
                    <div className="tbl-wrap">
                      <table className="tbl" style={{ fontSize: 12.5 }}>
                        <thead><tr>{d.tabla.cols.map((c, i) => (
                          <th key={c} className={i === 0 ? '' : 'num'}>{c}</th>))}</tr></thead>
                        <tbody>
                          {d.tabla.rows.map((r, i) => (
                            <tr key={i}>{r.map((v, j) => (
                              <td key={j} className={j === 0 ? '' : 'num mono'}>{v}</td>))}</tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn ghost" onClick={() => setKpiDet(null)}>Cerrar</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

Object.assign(window, { FinanzasReportesPage: window.FinanzasReportesPage });
