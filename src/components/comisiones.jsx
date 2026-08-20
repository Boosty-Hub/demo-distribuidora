// ══════════════════════════════════════════════════════════════════
// Comisiones de Ventas
// ══════════════════════════════════════════════════════════════════

const { useState, useMemo, useEffect, useRef } = React;

// ─── Helpers ──────────────────────────────────────────────────────
function _tasaDoc(d, tipo) {
  if (tipo === 'bcv')      return parseFloat(d.tasa_bcv)      || SSData.tasaBCV      || 1;
  if (tipo === 'paralelo') return parseFloat(d.tasa_paralelo) || SSData.tasaParalelo || SSData.tasaBCV || 1;
  return parseFloat(d.tasa_bcv) || SSData.tasaBCV || 1;
}

// Tasa de conversión a VES según la modalidad del documento: paralelo usa la tasa
// paralelo, el resto (divisas/bcv) usa la tasa BCV. Centraliza el criterio para que
// total y comisión en VES se conviertan SIEMPRE con la misma tasa (fix bug #37).
function _tasaVES(d) {
  return d.modalidad_pago === 'paralelo' ? _tasaDoc(d, 'paralelo') : _tasaDoc(d, 'bcv');
}

function _totalVES(d) {
  return (d.total || 0) * _tasaVES(d);
}

// Base de venta SIN IVA: el IVA es un impuesto pass-through, no es ingreso del vendedor,
// así que la comisión no debe calcularse sobre él. d.subtotal ya se persiste como el neto
// pre-IVA y post-descuento de documento (pos.jsx línea 1501). Si no está disponible, se
// reconstruye restando el IVA persistido (o quitando el 16% cuando aplica_iva).
function _baseSinIvaUSD(d) {
  if (d.subtotal != null) return d.subtotal || 0;
  const total = d.total || 0;
  if (d.aplica_iva === false) return total;
  if (d.iva != null) return total - (d.iva || 0);
  return total / 1.16;
}

// Para BCV: el precio ya lleva la cobertura en el precio. La comisión va sobre la base sin
// cobertura Y sin IVA (la cobertura está en las líneas, no en el IVA, por eso se descuenta
// sobre la base neta sin IVA).
function _totalSinCobUSD(d) {
  const base = _baseSinIvaUSD(d);
  if (d.modalidad_pago !== 'bcv') return base;
  const cob = Number(d.cobertura_pct) || SSData.tasa?.cobertura || 0;
  if (!cob) return base;
  return base / (1 + cob / 100);
}

function _margenDoc(d) {
  const prodMap = Object.fromEntries((SSData.productos || []).map(p => [p.sku, p]));
  const lines   = Array.isArray(d.lines) ? d.lines : [];
  if (!lines.length) return null;
  // Para BCV, l.precio lleva la cobertura en el precio; el margen real va sobre precio base sin cobertura
  const esBCV  = d.modalidad_pago === 'bcv';
  const cob    = esBCV ? (Number(d.cobertura_pct) || SSData.tasa?.cobertura || 0) : 0;
  const factor = cob > 0 ? 1 + cob / 100 : 1;
  let venta = 0, costo = 0;
  for (const l of lines) {
    const p = prodMap[l.sku];
    const cu = p?.costo || 0;
    venta += ((l.precio || 0) / factor) * (l.qty || 0);
    costo += cu * (l.qty || 0);
  }
  return venta > 0 ? ((venta - costo) / venta) * 100 : null;
}

// Margen ponderado (blended) de un conjunto de documentos: (Σventa − Σcosto) / Σventa.
// NO es el promedio simple de los % por doc (eso distorsiona); pondera por volumen de venta.
function _margenAgregado(docs) {
  const prodMap = Object.fromEntries((SSData.productos || []).map(p => [p.sku, p]));
  let venta = 0, costo = 0;
  for (const d of docs || []) {
    const lines = Array.isArray(d.lines) ? d.lines : [];
    if (!lines.length) continue;
    const cob    = d.modalidad_pago === 'bcv' ? (Number(d.cobertura_pct) || SSData.tasa?.cobertura || 0) : 0;
    const factor = cob > 0 ? 1 + cob / 100 : 1;
    for (const l of lines) {
      const cu = prodMap[l.sku]?.costo || 0;
      venta += ((l.precio || 0) / factor) * (l.qty || 0);
      costo += cu * (l.qty || 0);
    }
  }
  return venta > 0 ? ((venta - costo) / venta) * 100 : null;
}

function _modalLabel(m) {
  if (!m || m === 'divisas') return { label:'USD',      color:'#1d4ed8', bg:'#dbeafe' };
  if (m === 'bcv')           return { label:'Bs. BCV',  color:'#065f46', bg:'#d1fae5' };
  // "Nota BCV" (bcv_fijo) faltaba acá y caía al genérico (mostraba el valor crudo `bcv_fijo` en
  // vez de una etiqueta legible) — es tasa BCV EXACTA, sin cobertura, distinta de 'bcv'.
  if (m === 'bcv_fijo')      return { label:'Nota BCV', color:'#15803d', bg:'#dcfce7' };
  if (m === 'paralelo')      return { label:'Bs. Par.', color:'#7c3aed', bg:'#ede9fe' };
  return { label: m, color:'#6b7280', bg:'#f3f4f6' };
}

// ─── KPI Card ─────────────────────────────────────────────────────
function KPICard({ label, value, color, sub }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-val" style={{ color: color || 'var(--text-1)' }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{sub}</div>}
    </div>
  );
}

// ─── Badge de estado de comisión ──────────────────────────────────
function ComEstBadge({ estado }) {
  const cfg = {
    pagada:     { l:'Pagada ✓',   bg:'#d1fae5', c:'#065f46' },
    cxp_creada: { l:'CxP creada', bg:'#fef3c7', c:'#92400e' },
    pendiente:  { l:'Sin CxP',    bg:'#f3f4f6', c:'#6b7280' },
  }[estado || 'pendiente'] || { l: estado, bg:'#f3f4f6', c:'#6b7280' };
  return <span style={{ display:'inline-block', padding:'1px 7px', borderRadius:8, fontSize:9, fontWeight:700, background:cfg.bg, color:cfg.c }}>{cfg.l}</span>;
}

// ─── Fila de documento en tabla ───────────────────────────────────
function DocRow({ d, comisionPct, promGlobal, checked, onToggle, onCxpEliminada }) {
  const [borrandoCxp, setBorrandoCxp] = useState(false);
  async function eliminarCxp(e) {
    e.stopPropagation();
    if (!confirm(`¿Eliminar la CxP de comisión de ${d.id}? El documento vuelve a "Sin CxP" y se puede volver a agrupar.`)) return;
    setBorrandoCxp(true);
    const res = await window.eliminarComisionCxP(d.comision_cxp_id);
    setBorrandoCxp(false);
    if (res?.error) { alert('No se pudo eliminar: ' + (res.error.message || '')); return; }
    onCxpEliminada?.();
  }
  const cli      = (SSData.clientes || []).find(c => c.id === d.cliente);
  const modal    = _modalLabel(d.modalidad_pago);
  const totalV   = _totalVES(d);
  const esBCV    = d.modalidad_pago === 'bcv';
  const baseUSD  = _totalSinCobUSD(d);
  const comUSD   = baseUSD * (comisionPct / 100);
  // Comisión VES con la misma tasa que el total VES del documento (fix bug #37)
  const comVES   = (baseUSD * _tasaVES(d)) * (comisionPct / 100);
  const margen   = _margenDoc(d);
  const esBelow  = promGlobal > 0 && (d.total || 0) < promGlobal * 0.7;
  const cobPct   = Number(d.cobertura_pct) || 0;
  const comEst   = d.comision_estado || 'pendiente';
  const canSel   = comEst === 'pendiente';
  const hasLines = Array.isArray(d.lines) && d.lines.some(l => l.sku && l.sku !== '__SECTION__');
  const [showItems, setShowItems] = useState(false);

  return (
    <>
    <tr style={{ background: checked ? 'var(--brand-soft)' : esBelow ? '#fff8f8' : 'transparent' }}>
      <td style={{ width:36, padding:'4px 10px' }}>
        <input type="checkbox" checked={!!checked} disabled={!canSel}
          onChange={canSel ? onToggle : undefined}
          style={{ cursor: canSel ? 'pointer' : 'not-allowed', opacity: canSel ? 1 : 0.4 }}/>
      </td>
      <td className="mono" style={{ fontWeight:500, fontSize:12, color:'var(--brand)', whiteSpace:'nowrap' }}>
        <span style={{ display:'inline-flex', alignItems:'center', gap:5 }}>
          {d.id}
          {/* Abre el documento en su detalle real (misma mecánica que CxC/Reportes de Finanzas:
              window.abrirDocumentoPorId, ya cargado — pos.js es eager). El id de arriba es solo
              texto: antes no había forma de ir a la nota desde esta tabla. */}
          <button type="button" className="icon-btn" style={{ width:18, height:18, padding:0 }}
                  title="Abrir esta nota"
                  onClick={async e => {
                    e.stopPropagation();
                    const ok = await window.abrirDocumentoPorId?.(d.id);
                    if (!ok) alert('No se pudo abrir ' + d.id + '. Puede que la hayan eliminado.');
                  }}>
            <Icon name="external" size={11} />
          </button>
        </span>
      </td>
      <td className="muted" style={{ fontSize:12, whiteSpace:'nowrap' }}>{fmt.date(d.fecha)}</td>
      <td style={{ fontSize:12, maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={cli?.nombre || d.cliente}>
        {cli?.nombre || d.cliente || '—'}
      </td>
      <td>
        <span style={{ display:'inline-block', padding:'2px 7px', borderRadius:4, fontSize:10, fontWeight:700, background:modal.bg, color:modal.color }}>
          {modal.label}
        </span>
      </td>
      <td className="num mono" style={{ fontWeight:600 }}>{fmt.usd(d.total || 0)}</td>
      <td className="num mono dt-hide-mobile">
        {esBCV
          ? <span title={`Base sin ${cobPct}% cobertura`} style={{ color:'var(--text-muted)', fontStyle:'italic' }}>{fmt.usd(baseUSD)}</span>
          : <span className="muted">—</span>}
      </td>
      <td className="num mono muted dt-hide-mobile">{fmt.ves(totalV)}</td>
      {/* Pedido explícito: que se explique el descuento de cobertura en BCV, y que quede claro que
          divisas/paralelo cobran la comisión COMPLETA (sin ningún descuento). */}
      <td className="num mono" style={{ color:'var(--success)', fontWeight:600 }}
          title={esBCV
            ? `Comisión ${comisionPct}% sobre ${fmt.usd(baseUSD)} (venta ${fmt.usd(d.total || 0)} menos ${cobPct}% de cobertura BCV)`
            : `Comisión ${comisionPct}% completa sobre ${fmt.usd(baseUSD)} — esta modalidad no descuenta cobertura`}>
        {fmt.usd(comUSD)}
      </td>
      <td className="num mono muted dt-hide-mobile">{fmt.ves(comVES)}</td>
      <td className="num dt-hide-mobile" onClick={hasLines ? () => setShowItems(s => !s) : undefined} title={hasLines ? 'Ver margen por ítem' : ''} style={{ fontSize:12, cursor: hasLines ? 'pointer' : 'default', color: margen === null ? 'var(--text-muted)' : margen < 20 ? 'var(--danger)' : margen < 40 ? 'var(--warn)' : 'var(--success)' }}>
        {margen === null ? <span className="muted">N/D</span> : <span>{margen.toFixed(1)}% {hasLines && <Icon name={showItems ? 'chevronU' : 'chevronD'} size={10} style={{ verticalAlign:'middle', opacity:.55 }}/>}</span>}
      </td>
      <td>
        <ComEstBadge estado={comEst}/>
        {' '}
        <StatusChip estado={d.estado} />
        {esBelow && <span style={{ marginLeft:4, fontSize:10, background:'#fecaca', color:'#dc2626', borderRadius:4, padding:'1px 5px', fontWeight:700 }}>↓</span>}
        {/* Permiso especial (2026-08-14): borrar la CxP de comisión de este documento (solo si
            sigue 'pendiente' — window.eliminarComisionCxP lo revalida en el servidor) y que el
            documento vuelva a 'pendiente' para poder re-agruparlo. */}
        {comEst === 'cxp_creada' && (window.canUser ? window.canUser('eliminar', 'comisiones') : false) && (
          <button type="button" className="icon-btn" style={{ width:18, height:18, padding:0, marginLeft:4, verticalAlign:'middle' }}
                  title="Eliminar la CxP de esta comisión" disabled={borrandoCxp} onClick={eliminarCxp}>
            <Icon name="trash" size={11}/>
          </button>
        )}
      </td>
    </tr>
    {showItems && hasLines && d.lines.map((l, li) => {
      if (!l.sku || l.sku === '__SECTION__') return null;
      const prod    = (SSData.productos || []).find(p => p.sku === l.sku);
      const cob     = d.modalidad_pago === 'bcv' ? (Number(d.cobertura_pct) || SSData.tasa?.cobertura || 0) : 0;
      const factor  = cob > 0 ? 1 + cob / 100 : 1;
      const precioU = (l.precio || 0) / factor;   // precio de venta sin la cobertura BCV
      const costoU  = prod?.costo || 0;           // costo del catálogo de productos
      const mItem   = precioU > 0 ? ((precioU - costoU) / precioU) * 100 : null;
      const mColor  = mItem === null ? 'var(--text-muted)' : mItem < 20 ? 'var(--danger)' : mItem < 40 ? 'var(--warn)' : 'var(--success)';
      return (
        <tr key={'it-' + li} style={{ background: 'var(--bg-sunken)' }}>
          <td colSpan={12} style={{ padding: '4px 10px 4px 40px', fontSize: 11, color: 'var(--text-muted)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span>↳ <strong style={{ color: 'var(--text)' }}>{prod?.nombre || l.sku}</strong></span>
              <span className="mono">{l.qty}× · venta {fmt.usd(precioU)} · costo {fmt.usd(costoU)} · ganancia {fmt.usd((precioU - costoU) * (l.qty || 0))}</span>
              <span style={{ fontWeight: 700, color: mColor }}>margen {mItem === null ? '—' : mItem.toFixed(1) + '%'}</span>
            </span>
          </td>
        </tr>
      );
    })}
    </>
  );
}

// ─── Bloque por vendedor ───────────────────────────────────────────
function VendedorBlock({ vendedor, docs, comisionPct, promGlobalDoc, expanded, onToggle, selDocs, onToggleDoc, agg, pageSize = 50, onCxpEliminada }) {
  // Cuando hay agregado server-side (RPC get_comisiones_vendedor sobre el histórico completo),
  // los totales de cabecera vienen de ahí. `docs` (ventana 90d en memoria) solo alimenta el
  // detalle expandible / selección para CxP. Sin RPC (fallback), se calcula todo desde docs.
  const localTotalUSD = docs.reduce((s, d) => s + (d.total || 0), 0);
  const localTotalVES = docs.reduce((s, d) => s + _totalVES(d), 0);
  // Comisión se calcula sobre la base sin cobertura para BCV; igual para los demás
  const localComUSD   = docs.reduce((s, d) => s + _totalSinCobUSD(d) * (comisionPct / 100), 0);
  const localComVES   = docs.reduce((s, d) => s + (_totalSinCobUSD(d) * _tasaVES(d)) * (comisionPct / 100), 0);
  const totalUSD  = agg ? agg.totalUSD : localTotalUSD;
  const totalVES  = agg ? agg.totalVES : localTotalVES;
  const comUSD    = agg ? agg.comUSD   : localComUSD;
  const comVES    = agg ? agg.comVES   : localComVES;
  const docCount  = agg ? agg.docs     : docs.length;
  const margenAgg = _margenAgregado(docs);
  const meta      = vendedor.metaMensual || 0;
  const metaPct   = meta > 0 ? Math.min(100, (totalUSD / meta) * 100) : null;
  const esBelow   = promGlobalDoc > 0 && totalUSD < promGlobalDoc * 0.8;

  // Subtotals por modalidad
  const byModal = {};
  for (const d of docs) {
    const m = d.modalidad_pago || 'divisas';
    if (!byModal[m]) byModal[m] = { usd: 0, ves: 0, n: 0 };
    byModal[m].usd += d.total || 0;
    byModal[m].ves += _totalVES(d);
    byModal[m].n++;
  }

  const initials = vendedor.nombre.split(' ').map(w => w[0] || '').join('').toUpperCase().slice(0, 2);

  // Selección masiva por vendedor
  const selectableDocs = docs.filter(d => !d.comision_estado || d.comision_estado === 'pendiente');
  const allSel  = selectableDocs.length > 0 && selectableDocs.every(d => selDocs.has(d.id));
  const someSel = selectableDocs.some(d => selDocs.has(d.id));
  const chkRef  = useRef(null);
  useEffect(() => { if (chkRef.current) chkRef.current.indeterminate = someSel && !allSel; }, [someSel, allSel]);
  function toggleAllVendedor() {
    selectableDocs.forEach(d => onToggleDoc(d.id, !allSel));
  }

  // Paginación del detalle de documentos (puede ser larga para vendedores de alto volumen)
  const [docPage, setDocPage] = useState(1);
  useEffect(() => { setDocPage(1); }, [pageSize, docs.length]);
  const totalDocPages = Math.max(1, Math.ceil(docs.length / pageSize));
  const docPageClamped = Math.min(docPage, totalDocPages);
  const pagedDocs = docs.slice((docPageClamped - 1) * pageSize, docPageClamped * pageSize);

  return (
    <div className="card" style={{ marginBottom:12, overflow:'hidden', border: esBelow ? '1px solid #fca5a5' : '1px solid var(--border)' }}>
      {/* Header */}
      <div
        style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 16px', cursor:'pointer', background: esBelow ? '#fff8f8' : 'var(--bg-card)' }}
        onClick={onToggle}
      >
        {/* Avatar */}
        <div style={{ width:42, height:42, borderRadius:10, background:'var(--brand-soft)', color:'var(--brand)',
                      display:'grid', placeItems:'center', fontWeight:700, fontSize:16, flexShrink:0 }}>
          {initials}
        </div>

        {/* Name + info */}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontWeight:700, fontSize:15 }}>{vendedor.nombre}</span>
            {vendedor.codigo && <span className="mono muted" style={{ fontSize:11 }}>{vendedor.codigo}</span>}
            {esBelow && (
              <span style={{ fontSize:10, background:'#fecaca', color:'#dc2626', borderRadius:4, padding:'2px 6px', fontWeight:700 }}>
                ↓ bajo promedio
              </span>
            )}
          </div>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>
            {docCount} documento{docCount !== 1 ? 's' : ''} · Comisión: {comisionPct}%
            {vendedor.zona ? ` · ${vendedor.zona}` : ''}
          </div>
          {/* Progress bar */}
          {metaPct !== null && (
            <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:6 }}>
              <div style={{ flex:1, height:5, background:'var(--border)', borderRadius:3, overflow:'hidden', maxWidth:200 }}>
                <div style={{ height:'100%', width:metaPct+'%', borderRadius:3,
                              background: metaPct>=100?'var(--success)':metaPct>=70?'var(--warn)':'var(--brand)', transition:'width .3s' }}/>
              </div>
              <span style={{ fontSize:11, fontWeight:600, color: metaPct>=100?'var(--success)':metaPct>=70?'var(--warn)':'var(--danger)' }}>
                {metaPct.toFixed(0)}% de meta ({fmt.usd(meta)})
              </span>
            </div>
          )}
        </div>

        {/* Stats */}
        <div style={{ display:'flex', gap:24, alignItems:'center', flexShrink:0 }}>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:11, color:'var(--text-muted)', fontWeight:600, textTransform:'uppercase', letterSpacing:'.04em' }}>Ventas</div>
            <div style={{ fontSize:16, fontWeight:800, color:'var(--brand)' }}>{fmt.usd(totalUSD)}</div>
            <div style={{ fontSize:11, color:'var(--text-muted)' }}>{fmt.ves(totalVES)}</div>
          </div>
          <div style={{ width:1, height:36, background:'var(--border)' }}/>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:11, color:'var(--text-muted)', fontWeight:600, textTransform:'uppercase', letterSpacing:'.04em' }}>Comisión</div>
            <div style={{ fontSize:16, fontWeight:800, color:'var(--success)' }}>{fmt.usd(comUSD)}</div>
            <div style={{ fontSize:11, color:'var(--text-muted)' }}>{fmt.ves(comVES)}</div>
          </div>
          <Icon name={expanded ? 'chevronU' : 'chevronD'} size={16} style={{ color:'var(--text-muted)', marginLeft:4 }}/>
        </div>
      </div>

      {/* Breakdown por modalidad */}
      {Object.keys(byModal).length > 1 && (
        <div style={{ display:'flex', gap:0, borderTop:'1px solid var(--border)', background:'var(--bg-sunken)' }}>
          {Object.entries(byModal).map(([m, s]) => {
            const ml = _modalLabel(m);
            return (
              <div key={m} style={{ flex:1, padding:'8px 16px', borderRight:'1px solid var(--border)' }}>
                <div style={{ fontSize:10, fontWeight:700, color:ml.color, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:2 }}>{ml.label}</div>
                <div style={{ fontSize:13, fontWeight:700 }}>{fmt.usd(s.usd)}</div>
                <div style={{ fontSize:11, color:'var(--text-muted)' }}>{fmt.ves(s.ves)} · {s.n} doc.</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tabla de documentos */}
      {expanded && (
        <div style={{ borderTop:'1px solid var(--border)' }}>
          {agg && docCount > docs.length && (
            <div style={{ padding:'8px 14px', fontSize:11.5, color:'var(--text-muted)', background:'var(--bg-sunken)', borderBottom:'1px solid var(--border)' }}>
              Totales del período calculados sobre {docCount} facturas (histórico completo). El detalle inferior lista solo las {docs.length} más recientes cargadas en memoria.
            </div>
          )}
          <div className="tbl-wrap" style={{ borderRadius:0, border:'none' }}>
            <div className="tbl-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{width:36}}>
                      <input type="checkbox" ref={chkRef} checked={allSel} onChange={toggleAllVendedor}
                        disabled={selectableDocs.length === 0} style={{cursor: selectableDocs.length > 0 ? 'pointer' : 'not-allowed'}}/>
                    </th>
                    <th>Documento</th>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th>Modalidad</th>
                    <th className="num">Total USD</th>
                    <th className="num dt-hide-mobile" title="Monto base sin cobertura BCV — base de la comisión">Sin Cob. USD</th>
                    <th className="num dt-hide-mobile">Total VES</th>
                    <th className="num">Comisión USD</th>
                    <th className="num dt-hide-mobile">Comisión VES</th>
                    <th className="num dt-hide-mobile">% Margen</th>
                    <th>Estado comisión</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedDocs.map(d => (
                    <DocRow key={d.id} d={d} comisionPct={comisionPct} promGlobal={promGlobalDoc}
                      checked={selDocs.has(d.id)} onToggle={() => onToggleDoc(d.id, !selDocs.has(d.id))}
                      onCxpEliminada={onCxpEliminada}/>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop:'2px solid var(--border)' }}>
                    <td/>
                    <td colSpan={4} style={{ padding:'8px 12px', fontWeight:700, fontSize:12, color:'var(--text-muted)' }}>
                      Totales ({docs.length} docs)
                    </td>
                    <td className="num mono" style={{ fontWeight:800, color:'var(--brand)' }}>{fmt.usd(totalUSD)}</td>
                    <td className="num mono muted dt-hide-mobile">
                      {docs.some(d => d.modalidad_pago === 'bcv')
                        ? fmt.usd(docs.reduce((s, d) => s + _totalSinCobUSD(d), 0))
                        : <span className="muted">—</span>}
                    </td>
                    <td className="num mono muted dt-hide-mobile">{fmt.ves(totalVES)}</td>
                    <td className="num mono" style={{ fontWeight:800, color:'var(--success)' }}>{fmt.usd(comUSD)}</td>
                    <td className="num mono muted dt-hide-mobile">{fmt.ves(comVES)}</td>
                    <td className="num dt-hide-mobile" title="Margen ponderado del vendedor" style={{ fontWeight:700, fontSize:12, color: margenAgg === null ? 'var(--text-muted)' : margenAgg < 20 ? 'var(--danger)' : margenAgg < 40 ? 'var(--warn)' : 'var(--success)' }}>
                      {margenAgg === null ? '—' : margenAgg.toFixed(1) + '%'}
                    </td>
                    <td/>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          {totalDocPages > 1 && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 14px', borderTop:'1px solid var(--border)', fontSize:12, background:'var(--bg-sunken)' }}>
              <span className="muted">{docs.length} documentos · página {docPageClamped} de {totalDocPages}</span>
              <div style={{ display:'flex', gap:4 }}>
                <button className="btn ghost sm" disabled={docPageClamped===1} onClick={()=>setDocPage(1)}>«</button>
                <button className="btn ghost sm" disabled={docPageClamped===1} onClick={()=>setDocPage(p=>Math.max(1,p-1))}>‹</button>
                <button className="btn ghost sm" disabled={docPageClamped===totalDocPages} onClick={()=>setDocPage(p=>Math.min(totalDocPages,p+1))}>›</button>
                <button className="btn ghost sm" disabled={docPageClamped===totalDocPages} onClick={()=>setDocPage(totalDocPages)}>»</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Modal: Crear CxP de Comisiones ──────────────────────────────
function CrearCxPModal({ selByVendedor, onClose, onCreated }) {
  const [vence, setVence]     = useState('');
  const [loading, setLoading] = useState(false);
  const rows = Object.entries(selByVendedor).map(([vid, { vendedor, docs, comUSD }]) => ({ vid, vendedor, docs, comUSD }));
  const totalCom = rows.reduce((s, r) => s + r.comUSD, 0);
  // Pedido explícito (2026-08-14): "un solo asiento en cuentas por pagar, no separadas" — antes
  // esto creaba una CxP POR VENDEDOR (un `for` con N llamadas); ahora es una sola llamada con
  // TODOS los doc_ids juntos, sin importar cuántos vendedores haya en la selección. `doc_ids` —no
  // el campo proveedor— es lo que ata cada documento a su comisión y lo que marca "pagada" cuando
  // la CxP se salda (ver window.crearComisionCxP).
  const vendedores = rows.map(r => ({ id: r.vendedor.id, nombre: r.vendedor.nombre }));

  async function confirmar() {
    setLoading(true);
    const { error } = await window.crearComisionCxP({
      docIds: rows.flatMap(r => r.docs.map(d => d.id)),
      montoUSD: totalCom,
      vence: vence || null,
      vendedores,
    });
    setLoading(false);
    if (error) { alert('No se pudo crear la CxP: ' + (error.message || '')); return; }
    onCreated();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-md modal-fullscreen-mobile" onClick={e => e.stopPropagation()} style={{ maxWidth:560 }}>
        <div className="modal-header">
          <span className="modal-title">Crear CxP de Comisiones</span>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize:13, color:'var(--text-muted)', marginBottom:16 }}>
            Se creará <strong>una sola</strong> cuenta por pagar con todas las comisiones seleccionadas
            {rows.length > 1 ? ' (de los ' + rows.length + ' vendedores de abajo)' : ''} — no una por vendedor.
          </p>
          <div className="tbl-wrap" style={{ marginBottom:16 }}>
            <div className="tbl-scroll">
              <table className="tbl">
                <thead>
                  <tr><th>Vendedor</th><th className="num">Docs</th><th className="num">Comisión USD</th></tr>
                </thead>
                <tbody>
                  {rows.map(({ vid, vendedor, docs, comUSD }) => (
                    <tr key={vid}>
                      <td style={{ fontWeight:600 }}>{vendedor.nombre}</td>
                      <td className="num">{docs.length}</td>
                      <td className="num mono" style={{ color:'var(--success)', fontWeight:700 }}>{fmt.usd(comUSD)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop:'2px solid var(--border)' }}>
                    <td style={{ fontWeight:700 }}>Total</td>
                    <td className="num" style={{ fontWeight:700 }}>{rows.reduce((s, r) => s + r.docs.length, 0)}</td>
                    <td className="num mono" style={{ fontWeight:800, color:'var(--success)' }}>{fmt.usd(totalCom)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <label style={{ fontSize:13, fontWeight:600, whiteSpace:'nowrap' }}>Fecha de vencimiento:</label>
            <input type="date" className="input" style={{ width:160 }} value={vence} onChange={e => setVence(e.target.value)}/>
            <span style={{ fontSize:12, color:'var(--text-muted)' }}>(opcional)</span>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn ghost" onClick={onClose} disabled={loading}>Cancelar</button>
          <button className="btn primary" onClick={confirmar} disabled={loading || rows.length === 0}>
            {loading ? 'Creando…' : 'Crear CxP'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// ComisionesPage
// ══════════════════════════════════════════════════════════════════
window.ComisionesPage = function ComisionesPage() {
  // ── Filters
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [estadoF,    setEstadoF]    = useState('factura');
  const [empresaF,   setEmpresaF]   = useState('');
  const [search,     setSearch]     = useState('');
  const [tasa,       setTasa]       = useState('bcv');
  // Se sube cuando algo muta `SSData.documentos`/`cuentasPagar` EN MEMORIA sin pasar por
  // `loadAppData` (crear o eliminar una CxP de comisión): el useMemo de `data` no depende de
  // ningún estado de React, así que sin esto la tabla se queda mostrando el estado viejo hasta
  // que algo más (cambiar un filtro) fuerce el recálculo.
  const [refreshTick, setRefreshTick] = useState(0);
  // ── UI
  const [expanded,    setExpanded]    = useState(new Set());
  const [selDocs,     setSelDocs]     = useState(new Set());
  const [showCxPModal,setShowCxPModal]= useState(false);
  const [pageSize,    setPageSize]    = useState(() => {
    const v = parseInt(localStorage.getItem('ss-comisiones-pagesize')) || 50;
    return [50, 100, 200].includes(v) ? v : 50;
  });
  useEffect(() => { localStorage.setItem('ss-comisiones-pagesize', String(pageSize)); }, [pageSize]);
  // ── Agregado server-side (FASE 4): mapa nombreLower → {docs,total_usd,base_usd} del histórico
  //    completo. null = RPC no disponible/deshabilitada → fallback al cálculo en memoria (90d).
  const [rpcAgg,     setRpcAgg]     = useState(null);

  const tasaVal = useMemo(() =>
    tasa === 'bcv' ? (SSData.tasaBCV || 1) : (SSData.tasaParalelo || SSData.tasaBCV || 1)
  , [tasa]);

  // ── Trae la agregación por vendedor del histórico completo vía RPC. Solo aplica cuando el
  //    filtro de etapa es 'factura' (la RPC agrega tipo='factura'); para otras etapas se usa
  //    el cálculo en memoria. Default de rango: año en curso. Fallback silencioso si falla.
  useEffect(() => {
    if (estadoF !== 'factura') { setRpcAgg(null); return; }
    let cancel = false;
    const y      = new Date().getFullYear();
    const desde  = fechaDesde || `${y}-01-01`;
    const hasta  = fechaHasta || `${y}-12-31`;
    const emp    = empresaF || window.currentEmpresa || 'demo1';
    (async () => {
      try {
        const { data, error } = await window.sb.rpc('get_comisiones_vendedor', {
          p_empresa_id: emp, p_desde: desde, p_hasta: hasta,
        });
        if (cancel) return;
        if (error || !Array.isArray(data)) { setRpcAgg(null); return; }
        const map = {};
        for (const r of data) {
          const k = (r.vendedor || '').trim().toLowerCase();
          map[k] = { docs: Number(r.docs) || 0, total_usd: Number(r.total_usd) || 0, base_usd: Number(r.base_usd) || 0 };
        }
        setRpcAgg(map);
      } catch { if (!cancel) setRpcAgg(null); }
    })();
    return () => { cancel = true; };
  }, [estadoF, empresaF, fechaDesde, fechaHasta]);

  // ── Join vendedores + documentos
  const data = useMemo(() => {
    // Dedup por nombre: la migración dejó 5 vendedores con nombre repetido (2 filas c/u).
    // Sin dedup, ambas filas reciben los mismos docs → doble conteo en KPIs.
    const vistos = new Set();
    const vendedores = (SSData.vendedores || [])
      .filter(v => v.activo !== false)
      .filter(v => { const k = (v.nombre || '').trim().toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true; });
    const docs       = (SSData.documentos || []);

    return vendedores.map(v => {
      const myDocs = docs.filter(d => {
        if (d.vendedor !== v.nombre && d.vendedor_id !== v.id) return false;
        // La etapa vive en `tipo` post-migración; `estado` guarda el sub-status. Se acepta
        // ambos por retrocompat con docs creados en la app antes de la migración.
        if (estadoF   && d.tipo !== estadoF && d.estado !== estadoF)  return false;
        if (empresaF  && d.empresa_id !== empresaF && d.empresa !== empresaF) return false;
        if (fechaDesde && (d.fecha || '').slice(0,10) < fechaDesde) return false;
        if (fechaHasta && (d.fecha || '').slice(0,10) > fechaHasta) return false;
        return true;
      });
      return { vendedor: v, docs: myDocs };
    }).filter(r => !search || r.vendedor.nombre.toLowerCase().includes(search.toLowerCase()));
  }, [estadoF, empresaF, fechaDesde, fechaHasta, search, refreshTick]);

  // ── Aggregate per vendedor
  const rows = useMemo(() => data.map(({ vendedor, docs }) => {
    const comPct   = vendedor.comisionPct || 0;
    // Si hay agregado server-side para este vendedor (match por nombre), los totales del período
    // vienen del histórico completo. comUSD = base_usd * comPct/100 (base = subtotal, sin IVA).
    // VES se aproxima con la tasa de referencia seleccionada (la RPC solo devuelve USD).
    const aggRow = rpcAgg ? rpcAgg[(vendedor.nombre || '').trim().toLowerCase()] : null;
    if (aggRow) {
      const totalUSD = aggRow.total_usd;
      const comUSD   = aggRow.base_usd * (comPct / 100);
      const totalVES = totalUSD * tasaVal;
      const comVES   = comUSD * tasaVal;
      const agg      = { totalUSD, totalVES, comUSD, comVES, docs: aggRow.docs };
      return { vendedor, docs, totalUSD, totalVES, comUSD, comVES, comPct, docCount: aggRow.docs, agg };
    }
    const totalUSD = docs.reduce((s, d) => s + (d.total || 0), 0);
    const totalVES = docs.reduce((s, d) => s + _totalVES(d), 0);
    // Comisión sobre base sin cobertura
    const comUSD   = docs.reduce((s, d) => s + _totalSinCobUSD(d) * (comPct / 100), 0);
    const comVES   = docs.reduce((s, d) => s + (_totalSinCobUSD(d) * _tasaVES(d)) * (comPct / 100), 0);
    return { vendedor, docs, totalUSD, totalVES, comUSD, comVES, comPct, docCount: docs.length, agg: null };
  }), [data, rpcAgg, tasaVal]);

  // ── Global averages (for below-avg detection)
  const promGlobalVendedor = useMemo(() => {
    const vals = rows.map(r => r.totalUSD).filter(v => v > 0);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }, [rows]);

  const promGlobalDoc = useMemo(() => {
    const allDocs = rows.flatMap(r => r.docs);
    const vals = allDocs.map(d => d.total || 0).filter(v => v > 0);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }, [rows]);

  // ── KPI totals
  const kpi = useMemo(() => {
    const totalVentasUSD  = rows.reduce((s, r) => s + r.totalUSD, 0);
    const totalVentasVES  = rows.reduce((s, r) => s + r.totalVES, 0);
    const totalComUSD     = rows.reduce((s, r) => s + r.comUSD, 0);
    const totalComVES     = rows.reduce((s, r) => s + r.comVES, 0);
    const vendedoresActivos = rows.filter(r => r.docCount > 0).length;
    const promVentas      = vendedoresActivos > 0 ? totalVentasUSD / vendedoresActivos : 0;
    const promComision    = vendedoresActivos > 0 ? totalComUSD / vendedoresActivos : 0;
    const belowAvg        = rows.filter(r => r.docCount > 0 && r.totalUSD < promGlobalVendedor * 0.8).length;
    return { totalVentasUSD, totalVentasVES, totalComUSD, totalComVES, vendedoresActivos, promVentas, promComision, belowAvg };
  }, [rows, promGlobalVendedor]);

  // ── Sort: highest sales first
  const sortedRows = useMemo(() =>
    [...rows].sort((a, b) => b.totalUSD - a.totalUSD)
  , [rows]);

  // ── Selection helpers
  function toggleDoc(id, on) {
    setSelDocs(prev => { const s = new Set(prev); on ? s.add(id) : s.delete(id); return s; });
  }

  // Group selected docs by vendedor for the CxP modal
  const selByVendedor = useMemo(() => {
    const map = {};
    for (const r of sortedRows) {
      const selInRow = r.docs.filter(d => selDocs.has(d.id));
      if (!selInRow.length) continue;
      const comUSD = selInRow.reduce((s, d) => s + _totalSinCobUSD(d) * (r.comPct / 100), 0);
      map[r.vendedor.id] = { vendedor: r.vendedor, docs: selInRow, comUSD };
    }
    return map;
  }, [selDocs, sortedRows]);

  const selTotalCom = useMemo(() =>
    Object.values(selByVendedor).reduce((s, v) => s + v.comUSD, 0)
  , [selByVendedor]);

  const empresaOpts = [...new Set((SSData.documentos || []).map(d => d.empresa_id).filter(Boolean))];
  const estadoOpts  = ['cotizacion','orden','factura','anulada'];
  const hasFilter   = fechaDesde || fechaHasta || empresaF || (estadoF !== 'factura');

  function toggleExpand(id) {
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }
  function expandAll()   { setExpanded(new Set(sortedRows.map(r => r.vendedor.id))); }
  function collapseAll() { setExpanded(new Set()); }

  // ── PDF
  function exportPDF() {
    const emp  = window.getEmpresaConfig?.() || {};
    const eName = emp.nombre_empresa || emp.razon_social || 'Distribuidora Demo';
    const rif   = emp.rif || '';
    const today = new Date().toLocaleString('es-VE', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'America/Caracas'});

    const estadoLabel = { cotizacion:'Cotización', orden:'Orden', factura:'Factura', anulada:'Anulada' };
    const th = s => `<th style="background:#1a56db;color:#fff;padding:6px 8px;font-size:10px;text-align:right;">${s}</th>`;
    const thL = s => `<th style="background:#1a56db;color:#fff;padding:6px 8px;font-size:10px;text-align:left;">${s}</th>`;
    const td = (s, bold) => `<td style="padding:5px 8px;font-size:10px;text-align:right;border-bottom:1px solid #f0f0f0;${bold?'font-weight:700;':''}">${s}</td>`;
    const tdL = (s) => `<td style="padding:5px 8px;font-size:10px;border-bottom:1px solid #f0f0f0;">${s}</td>`;
    const tdG = (s) => `<td style="padding:5px 8px;font-size:10px;text-align:right;border-bottom:1px solid #f0f0f0;color:#6b7280;font-style:italic;">${s}</td>`;

    // ¿Hay docs BCV en el reporte?
    const hasBCV = sortedRows.some(r => r.docs.some(d => d.modalidad_pago === 'bcv'));
    const colCount = hasBCV ? 9 : 8;

    let bodyHtml = '';
    for (const r of sortedRows) {
      if (!r.docs.length) continue;
      const isBelow = promGlobalVendedor > 0 && r.totalUSD < promGlobalVendedor * 0.8;
      bodyHtml += `
        <tr style="background:#eff6ff;">
          <td colspan="2" style="padding:8px 10px;font-weight:700;font-size:12px;">${r.vendedor.nombre}${isBelow?' ↓':''}</td>
          <td style="padding:8px 10px;font-size:11px;color:#6b7280;">${r.docCount} docs · ${r.comPct}% comisión</td>
          <td style="padding:8px 10px;font-weight:700;font-size:12px;text-align:right;">${fmt.usd(r.totalUSD)}</td>
          ${hasBCV ? `<td style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;font-style:italic;">${fmt.usd(r.docs.reduce((s,d)=>s+_totalSinCobUSD(d),0))}</td>` : ''}
          <td style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;">${fmt.ves(r.totalVES)}</td>
          <td style="padding:8px 10px;font-weight:700;font-size:12px;text-align:right;color:#16a34a;">${fmt.usd(r.comUSD)}</td>
          <td style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;">${fmt.ves(r.comVES)}</td>
        </tr>`;
      for (const d of r.docs) {
        const cli     = (SSData.clientes || []).find(c => c.id === d.cliente);
        const ml      = _modalLabel(d.modalidad_pago);
        const baseUSD = _totalSinCobUSD(d);
        const comD    = baseUSD * (r.comPct / 100);
        const esBCV   = d.modalidad_pago === 'bcv';
        bodyHtml += `<tr>
          ${tdL(`<span style="font-family:monospace">${d.id}</span>`)}
          ${tdL(fmt.date(d.fecha))}
          ${tdL(cli?.nombre || d.cliente || '—')}
          ${td(`<span style="padding:1px 5px;border-radius:3px;background:${ml.bg};color:${ml.color};font-weight:700;">${ml.label}</span>`)}
          ${td(fmt.usd(d.total||0))}
          ${hasBCV ? (esBCV ? tdG(fmt.usd(baseUSD)) : tdG('—')) : ''}
          ${td(fmt.ves(_totalVES(d)))}
          ${td(fmt.usd(comD), true)}
          ${td(fmt.ves(baseUSD * _tasaVES(d) * (r.comPct/100)))}
        </tr>`;
      }
      bodyHtml += `<tr style="background:#f9fafb;border-top:1px solid #e5e7eb;">
        <td colspan="${hasBCV?5:4}" style="padding:5px 10px;font-size:10px;color:#6b7280;text-align:right;font-weight:600;">Subtotal ${r.vendedor.nombre}</td>
        <td style="padding:5px 10px;text-align:right;font-weight:700;font-size:11px;">${fmt.usd(r.totalUSD)}</td>
        <td style="padding:5px 10px;text-align:right;font-size:11px;color:#6b7280;">${fmt.ves(r.totalVES)}</td>
        <td style="padding:5px 10px;text-align:right;font-weight:700;font-size:11px;color:#16a34a;">${fmt.usd(r.comUSD)}</td>
        <td style="padding:5px 10px;text-align:right;font-size:11px;color:#6b7280;">${fmt.ves(r.comVES)}</td>
      </tr><tr><td colspan="${colCount}" style="padding:4px;"></td></tr>`;
    }

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
    <title>Reporte de Comisiones</title>
    <style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#111;background:#fff;padding:24px;}
    .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1a56db;padding-bottom:14px;margin-bottom:16px;}
    .co-name{font-size:16px;font-weight:800;color:#1a56db;}.co-info{font-size:10px;color:#6b7280;margin-top:2px;}
    .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;}
    .kpi{background:#f9fafb;border-radius:6px;padding:10px 12px;}.kpi-l{font-size:9.5px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px;}
    .kpi-v{font-size:18px;font-weight:800;}
    table{width:100%;border-collapse:collapse;}
    .footer{margin-top:16px;border-top:1px solid #e5e7eb;padding-top:8px;display:flex;justify-content:space-between;font-size:9.5px;color:#9ca3af;}
    @media print{body{padding:14px;}}</style></head><body>
    <div class="hdr">
      <div><div class="co-name">${eName}</div><div class="co-info">${rif ? 'RIF: '+rif : ''}</div></div>
      <div style="text-align:right">
        <div style="font-size:14px;font-weight:700;">Reporte de Comisiones de Ventas</div>
        <div style="font-size:10px;color:#6b7280;margin-top:3px;">Estado: ${estadoLabel[estadoF]||estadoF} · Generado: ${today}</div>
        ${fechaDesde||fechaHasta ? `<div style="font-size:10px;color:#6b7280;">Período: ${fechaDesde||'—'} a ${fechaHasta||'—'}</div>` : ''}
      </div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="kpi-l">Ventas USD</div><div class="kpi-v" style="color:#1d4ed8">${fmt.usd(kpi.totalVentasUSD)}</div></div>
      <div class="kpi"><div class="kpi-l">Ventas VES</div><div class="kpi-v" style="color:#065f46">${fmt.ves(kpi.totalVentasVES)}</div></div>
      <div class="kpi"><div class="kpi-l">Total Comisiones</div><div class="kpi-v" style="color:#16a34a">${fmt.usd(kpi.totalComUSD)}</div></div>
      <div class="kpi"><div class="kpi-l">Promedio/Vendedor</div><div class="kpi-v">${fmt.usd(kpi.promVentas)}</div></div>
    </div>
    <table>
      <thead><tr>${thL('Documento')}${thL('Fecha')}${thL('Cliente')}${th('Modalidad')}${th('Total USD')}${hasBCV?th('Sin Cob. USD'):''}${th('Total VES')}${th('Comisión USD')}${th('Comisión VES')}</tr></thead>
      <tbody>${bodyHtml}</tbody>
      <tfoot><tr style="border-top:2px solid #1a56db;background:#eff6ff;">
        <td colspan="${hasBCV?5:4}" style="padding:8px 10px;font-weight:700;font-size:12px;">TOTAL GENERAL</td>
        <td style="padding:8px 10px;text-align:right;font-weight:800;font-size:13px;color:#1d4ed8;">${fmt.usd(kpi.totalVentasUSD)}</td>
        <td style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;">${fmt.ves(kpi.totalVentasVES)}</td>
        <td style="padding:8px 10px;text-align:right;font-weight:800;font-size:13px;color:#16a34a;">${fmt.usd(kpi.totalComUSD)}</td>
        <td style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;">${fmt.ves(kpi.totalComVES)}</td>
      </tr></tfoot>
    </table>
    <div class="footer"><span>${eName}${rif?' · RIF: '+rif:''}</span><span>Comisiones · ${today}</span></div>
    <script>window.onload=()=>{ window.print(); setTimeout(()=>window.close(),800); }<\/script>
    </body></html>`;

    const w = window.open('', '_blank', 'width=1100,height=820');
    if (w) { w.document.write(html); w.document.close(); }
  }

  // ── Excel — una fila por documento (superset del resumen por vendedor)
  function exportExcel() {
    const flat = [];
    for (const r of sortedRows) {
      for (const d of r.docs) {
        const cli     = (SSData.clientes || []).find(c => c.id === d.cliente);
        const baseUSD = _totalSinCobUSD(d);
        flat.push({
          vendedor:       r.vendedor.nombre,
          comPct:         r.comPct,
          doc:            d.id,
          fecha:          fmt.date(d.fecha),
          cliente:        cli?.nombre || d.cliente || '—',
          moneda:         _modalLabel(d.modalidad_pago).label,
          totalUSD:       d.total || 0,
          sinCobUSD:      d.modalidad_pago === 'bcv' ? baseUSD : null,
          totalVES:       _totalVES(d),
          comUSD:         baseUSD * (r.comPct / 100),
          comVES:         (baseUSD * _tasaVES(d)) * (r.comPct / 100),
          margen:         _margenDoc(d),
          estadoComision: d.comision_estado || 'pendiente',
          estadoDoc:      d.estado,
        });
      }
    }
    const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
    const cols = [
      { key:'vendedor',       label:'Vendedor' },
      { key:'comPct',         label:'Comisión %',        format:v => Number(v) || 0 },
      { key:'doc',            label:'Documento' },
      { key:'fecha',          label:'Fecha' },
      { key:'cliente',        label:'Cliente' },
      { key:'moneda',         label:'Modalidad' },
      { key:'totalUSD',       label:'Total USD',         format:r2 },
      { key:'sinCobUSD',      label:'Base sin Cob. USD', format:v => v == null ? '' : r2(v) },
      { key:'totalVES',       label:'Total VES',         format:r2 },
      { key:'comUSD',         label:'Comisión USD',      format:r2 },
      { key:'comVES',         label:'Comisión VES',      format:r2 },
      { key:'margen',         label:'% Margen',          format:v => v == null ? '' : Math.round(Number(v) * 10) / 10 },
      { key:'estadoComision', label:'Estado comisión' },
      { key:'estadoDoc',      label:'Estado doc' },
    ];
    window.exportToXLSX(flat, cols, 'comisiones', 'Comisiones');
  }

  return (
    <div className="page">
      {/* ── Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Comisiones de Ventas</h1>
          <div className="page-subtitle">
            {kpi.vendedoresActivos} vendedor{kpi.vendedoresActivos !== 1 ? 'es' : ''} con ventas
            {kpi.belowAvg > 0 && <span style={{ marginLeft:8, color:'#dc2626', fontWeight:600 }}>· {kpi.belowAvg} bajo promedio</span>}
          </div>
        </div>
        <div className="page-actions">
          <div style={{ display:'flex', alignItems:'center', gap:6, marginRight:8 }}>
            <span className="small muted">Docs/pág.:</span>
            {[50, 100, 200].map(n => (
              <button key={n} className={'btn ghost sm' + (pageSize === n ? ' on' : '')} onClick={() => setPageSize(n)}>{n}</button>
            ))}
          </div>
          <button className="btn ghost sm" onClick={collapseAll}><Icon name="chevronU" size={13}/>Colapsar</button>
          <button className="btn ghost sm" onClick={expandAll}><Icon name="chevronD" size={13}/>Expandir todo</button>
          <button className="btn ghost" onClick={exportExcel}><Icon name="download" size={14}/>Excel</button>
          <button className="btn ghost" onClick={exportPDF}><Icon name="download" size={14}/>PDF</button>
        </div>
      </div>

      {/* ── KPIs */}
      <div className="stat-grid" style={{ marginBottom:16 }}>
        <KPICard label="Ventas USD" value={fmt.usd(kpi.totalVentasUSD)} color="var(--brand)"/>
        <KPICard label="Ventas VES" value={fmt.ves(kpi.totalVentasVES)} color="#065f46" sub={`Tasa ref. ${tasa.toUpperCase()}`}/>
        <KPICard label="Comisiones USD" value={fmt.usd(kpi.totalComUSD)} color="var(--success)"/>
        <KPICard label="Comisiones VES" value={fmt.ves(kpi.totalComVES)} color="#065f46"/>
        <KPICard label="Promedio/Vendedor" value={fmt.usd(kpi.promVentas)} sub={`${kpi.vendedoresActivos} vendedores`}/>
        <KPICard label="Comisión prom./vend." value={fmt.usd(kpi.promComision)} color="var(--success)" sub={`${kpi.vendedoresActivos} vendedores`}/>
        <KPICard
          label="Bajo promedio"
          value={kpi.belowAvg}
          color={kpi.belowAvg > 0 ? 'var(--danger)' : 'var(--success)'}
          sub={kpi.belowAvg > 0 ? 'vendedores detectados' : 'Todos sobre el promedio'}
        />
      </div>

      {/* ── Filters */}
      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:16,
                    background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, padding:'12px 14px' }}>
        <Icon name="search" size={14} style={{ color:'var(--text-muted)' }}/>
        <input className="input" style={{ width:200 }} placeholder="Buscar vendedor…"
          value={search} onChange={e => setSearch(e.target.value)}/>

        <div style={{ width:1, height:24, background:'var(--border)' }}/>

        <input type="date" className="input" style={{ width:140 }} value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}/>
        <span style={{ fontSize:12, color:'var(--text-muted)' }}>—</span>
        <input type="date" className="input" style={{ width:140 }} value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}/>

        <select className="select" style={{ width:150 }} value={estadoF} onChange={e => setEstadoF(e.target.value)}>
          <option value="">Todos los estados</option>
          {estadoOpts.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
        </select>

        <select className="select" style={{ width:170 }} value={empresaF} onChange={e => setEmpresaF(e.target.value)}>
          <option value="">Todas las empresas</option>
          {empresaOpts.map(e => <option key={e} value={e}>{e}</option>)}
        </select>

        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:11, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase' }}>Tasa ref.:</span>
          <div className="seg">
            <button className={tasa==='bcv'?'on':''} onClick={() => setTasa('bcv')}>BCV</button>
            <button className={tasa==='paralelo'?'on':''} onClick={() => setTasa('paralelo')}>Paralelo</button>
          </div>
          <span style={{ fontSize:11, color:'var(--text-muted)' }}>{fmt.ves(tasaVal)}/USD</span>
        </div>

        {hasFilter && (
          <button className="btn ghost sm" onClick={() => { setFechaDesde(''); setFechaHasta(''); setEmpresaF(''); setEstadoF('factura'); }}>
            <Icon name="x" size={12}/>Limpiar
          </button>
        )}
      </div>

      {/* ── Resumen de monedas */}
      {(() => {
        const allDocs = sortedRows.flatMap(r => r.docs);
        const byModal = {};
        for (const d of allDocs) {
          const m = d.modalidad_pago || 'divisas';
          if (!byModal[m]) byModal[m] = { usd:0, ves:0, n:0 };
          byModal[m].usd += d.total || 0;
          byModal[m].ves += _totalVES(d);
          byModal[m].n++;
        }
        if (Object.keys(byModal).length === 0) return null;
        return (
          <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
            {Object.entries(byModal).map(([m, s]) => {
              const ml = _modalLabel(m);
              return (
                <div key={m} style={{ flex:1, minWidth:160, background:'var(--bg-card)', border:'1px solid var(--border)',
                                      borderRadius:10, padding:'12px 14px', borderTop:`3px solid ${ml.color}` }}>
                  <div style={{ fontSize:11, fontWeight:700, color:ml.color, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 }}>
                    {ml.label} · {s.n} documentos
                  </div>
                  <div style={{ fontSize:17, fontWeight:800 }}>{fmt.usd(s.usd)}</div>
                  <div style={{ fontSize:12, color:'var(--text-muted)' }}>{fmt.ves(s.ves)}</div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ── Vendedor blocks */}
      {sortedRows.length === 0 ? (
        <div style={{ textAlign:'center', padding:60, color:'var(--text-muted)' }}>
          <Icon name="users" size={40}/><div style={{ marginTop:12 }}>Sin vendedores o sin datos para los filtros seleccionados</div>
        </div>
      ) : (
        sortedRows.map(r => (
          <VendedorBlock
            key={r.vendedor.id}
            vendedor={r.vendedor}
            docs={r.docs}
            agg={r.agg}
            pageSize={pageSize}
            comisionPct={r.comPct}
            promGlobalDoc={promGlobalDoc}
            onCxpEliminada={() => setRefreshTick(t => t + 1)}
            expanded={expanded.has(r.vendedor.id)}
            onToggle={() => toggleExpand(r.vendedor.id)}
            selDocs={selDocs}
            onToggleDoc={toggleDoc}
          />
        ))
      )}

      {/* ── Legend */}
      {kpi.belowAvg > 0 && (
        <div style={{ marginTop:8, fontSize:12, color:'var(--text-muted)', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ background:'#fecaca', color:'#dc2626', borderRadius:4, padding:'2px 7px', fontWeight:700 }}>↓ bajo promedio</span>
          Vendedores con ventas más de 20% por debajo del promedio ({fmt.usd(promGlobalVendedor)})
        </div>
      )}

      {/* ── Bulk bar: comisiones seleccionadas */}
      {selDocs.size > 0 && (
        <div className="docs-bulk-bar" style={{ position:'fixed', bottom:28, left:'50%', transform:'translateX(-50%)',
          background:'var(--bg-elev)', border:'1px solid var(--border)', borderRadius:16,
          boxShadow:'0 12px 40px rgba(0,0,0,.35)', display:'flex', alignItems:'center', gap:8,
          padding:'10px 14px', zIndex:300, backdropFilter:'blur(12px)', flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, paddingRight:10, borderRight:'1px solid var(--border)', marginRight:4 }}>
            <div style={{ width:24, height:24, borderRadius:8, background:'var(--success)', display:'grid', placeItems:'center', color:'#fff', fontSize:11, fontWeight:700 }}>{selDocs.size}</div>
            <span style={{ fontSize:13, fontWeight:600 }}>{selDocs.size} doc{selDocs.size !== 1 ? 's' : ''} seleccionado{selDocs.size !== 1 ? 's' : ''}</span>
          </div>
          <span style={{ fontSize:12, color:'var(--text-muted)' }}>
            Comisión total: <strong style={{ color:'var(--success)' }}>{fmt.usd(selTotalCom)}</strong>
            {' '}· {Object.keys(selByVendedor).length} vendedor{Object.keys(selByVendedor).length !== 1 ? 'es' : ''}
          </span>
          {window.canUser?.('crear', 'comisiones') !== false && (
            <button className="btn primary sm" onClick={() => setShowCxPModal(true)}>
              <Icon name="plus" size={13}/>Crear CxP
            </button>
          )}
          <button className="icon-btn" onClick={() => setSelDocs(new Set())} style={{ marginLeft:4 }}>
            <Icon name="x" size={15}/>
          </button>
        </div>
      )}

      {showCxPModal && (
        <CrearCxPModal
          selByVendedor={selByVendedor}
          onClose={() => setShowCxPModal(false)}
          onCreated={() => {
            setShowCxPModal(false);
            setSelDocs(new Set());
            window.loadAppData?.();
          }}
        />
      )}
    </div>
  );
};
