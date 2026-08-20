// Public document page — no auth required. Accessible at /public/:slug
const { useState, useEffect } = React;

window.PublicDocumentPage = function PublicDocumentPage({ slug }) {
  const [state, setState] = useState('loading'); // loading | ok | notfound | error
  const [doc,   setDoc]   = useState(null);
  const [cli,   setCli]   = useState(null);
  const [emp,   setEmp]   = useState(null);

  useEffect(() => {
    if (!slug) { setState('notfound'); return; }
    window.loadDocumentoBySlug(slug).then(res => {
      if (res.error) { setState('notfound'); return; }
      setDoc(res.doc);
      setCli(res.cliente);
      setEmp(res.empresaCfg);
      setState('ok');
    });
  }, [slug]);

  // Track view + duration once doc is loaded
  useEffect(() => {
    if (state !== 'ok' || !doc?.id) return;
    let vistaId  = null;
    const start  = Date.now();
    window.logDocVista(doc.id, doc.empresa_id).then(id => { vistaId = id; });
    function onLeave() {
      const elapsed = Math.round((Date.now() - start) / 1000);
      window.updateDocVistaDuracion(vistaId, elapsed);
    }
    window.addEventListener('pagehide', onLeave);
    return () => window.removeEventListener('pagehide', onLeave);
  }, [state, doc?.id]);

  if (state === 'loading') return (
    <div style={S.shell}>
      <div style={S.loadBox}>
        <div style={S.spinner}/>
        <div style={{color:'#6b7280', fontSize:13, marginTop:12}}>Cargando documento…</div>
      </div>
    </div>
  );

  if (state === 'notfound') return (
    <div style={S.shell}>
      <div style={S.notFound}>
        <div style={{fontSize:48, marginBottom:12}}>🔍</div>
        <h2 style={{fontWeight:700, fontSize:18, marginBottom:8}}>Documento no encontrado</h2>
        <p style={{color:'#6b7280', fontSize:13}}>El enlace puede haber expirado o el documento fue eliminado.</p>
      </div>
    </div>
  );

  return <DocView doc={doc} cli={cli} emp={emp} />;
};

// ── DocView ──────────────────────────────────────────────────────────────────
function DocView({ doc, cli, emp }) {
  const [copied, setCopied]   = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);

  const tasa = { bcv: doc.tasa_bcv, paralelo: doc.tasa_paralelo };

  function copyLink() {
    try { navigator.clipboard.writeText(window.location.href); } catch(e) {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  }

  const co = {
    nombre:    emp?.nombre_empresa  || emp?.razon_social || 'Distribuidora Demo 1, C.A.',
    rif:       emp?.rif             || 'J-40123456-7',
    telefono:  emp?.telefono        || '0212-555-0101',
    email:     emp?.email_info      || emp?.email        || 'info@distribuidorademo.com',
    website:   emp?.website         || 'www.distribuidorademo.com',
    dir:       emp?.direccion       || emp?.dir_fiscal   || 'Av. Principal, Centro Empresarial Norte, Piso 3, Of. 3-B.',
    logo:      emp?.logo_pdf        || emp?.logo         || null,
  };

  const stateLabel  = { cotizacion:'Cotización', orden:'Orden de Venta', despacho:'Nota de Despacho', factura:'Factura Fiscal', anulado:'Anulado' };
  const stateColor  = { cotizacion:'#1a56db', orden:'#7c3aed', despacho:'#0891b2', factura:'#059669', anulado:'#dc2626' };
  const color       = stateColor[doc.estado] || '#1a56db';
  const label       = stateLabel[doc.estado] || doc.estado;

  const lines       = doc.lines || [];
  const subtotalItems = lines.reduce((s, l) => s + (l.subtotal || 0), 0);
  const descDoc     = Number(doc.descuento_doc) || 0;
  const subtotalNet = subtotalItems * (1 - descDoc / 100);
  const ivaAmt      = doc.aplica_iva !== false ? subtotalNet * 0.16 : 0;
  const total       = subtotalNet + ivaAmt;
  const tasaRef     = doc.modalidad_pago === 'paralelo' ? (doc.tasa_paralelo || 0) : (doc.tasa_bcv || 0);
  const isBs        = doc.modalidad_pago === 'bcv' || doc.modalidad_pago === 'paralelo';

  const usd = v => '$ ' + Number(v||0).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
  const ves = v => 'Bs. ' + Number(v||0).toLocaleString('es-VE', { minimumFractionDigits:2, maximumFractionDigits:2 });
  const fmt = v => isBs ? ves(v * tasaRef) : usd(v);
  const fd  = s => {
    if (!s) return '—';
    try { return s.length === 10
      ? new Date(s + 'T00:00:00').toLocaleDateString('es-VE', { day:'2-digit', month:'long', year:'numeric' })
      : new Date(s).toLocaleDateString('es-VE', { day:'2-digit', month:'long', year:'numeric', timeZone:'America/Caracas' }); }
    catch(e) { return s; }
  };

  const modLabel = doc.modalidad_pago === 'bcv'
    ? 'BCV + Cobertura'
    : doc.modalidad_pago === 'paralelo' ? 'Tasa Paralelo' : 'Divisas USD';

  // Tasa efectiva BCV: la cobertura ya está en los precios, mostramos la tasa combinada
  const cobPct = Number(doc.cobertura_pct) || 0;
  const tasaBcvEfectiva = (doc.tasa_bcv || 0) * (1 + cobPct / 100);

  return (
    <div style={S.shell}>
      {/* Top bar */}
      <div style={S.topBar}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          {co.logo
            ? <img src={co.logo} alt="" style={{height:32, width:'auto', objectFit:'contain'}}/>
            : <div style={{width:32, height:32, borderRadius:8, background:'#1a56db', color:'#fff', display:'grid', placeItems:'center', fontWeight:700, fontSize:13}}>SS</div>
          }
          <span style={{fontWeight:600, fontSize:14, color:'#111'}}>{co.nombre}</span>
        </div>
        <div style={{display:'flex', gap:8}}>
          <button style={S.btnOutline} onClick={copyLink}>
            {copied ? '✓ Copiado' : '🔗 Copiar enlace'}
          </button>
          <button style={{...S.btnOutline, background: color, color:'#fff', borderColor: color}} onClick={() => setPdfOpen(true)}>
            ⬇ Descargar PDF
          </button>
        </div>
      </div>

      {/* Document card */}
      <div style={S.card}>

        {/* Header empresa */}
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', paddingBottom:20, borderBottom:'2px solid ' + color, marginBottom:20}}>
          <div>
            <div style={{fontWeight:800, fontSize:18, color: color}}>{co.nombre}</div>
            <div style={{fontSize:11.5, color:'#6b7280', marginTop:3}}>RIF: {co.rif}</div>
            <div style={{fontSize:11.5, color:'#6b7280'}}>{co.telefono} · {co.email}</div>
            <div style={{fontSize:11.5, color:'#6b7280'}}>{co.dir}</div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{display:'inline-block', background: color+'18', color, fontWeight:700, fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em', padding:'3px 10px', borderRadius:6, marginBottom:6}}>{label}</div>
            <div style={{fontFamily:'monospace', fontWeight:700, fontSize:20, color:'#111'}}>{doc.id}</div>
            <div style={{fontSize:12, color:'#6b7280', marginTop:4}}>Fecha: {fd(doc.fecha)}</div>
            {doc.vencimiento && <div style={{fontSize:12, color:'#6b7280'}}>Vence: {fd(doc.vencimiento)}</div>}
          </div>
        </div>

        {/* Client + conditions */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:20}}>
          <div style={S.infoBox}>
            <div style={S.infoBoxTitle}>Cliente</div>
            {cli ? (
              <>
                <div style={{fontWeight:700, fontSize:14, color:'#111', marginBottom:4}}>{cli.nombre}</div>
                {cli.rif      && <div style={S.infoRow}><span style={S.infoLbl}>RIF</span>{cli.rif}</div>}
                {cli.telefono && <div style={S.infoRow}><span style={S.infoLbl}>Tel.</span>{cli.telefono}</div>}
                {cli.email    && <div style={S.infoRow}><span style={S.infoLbl}>Email</span>{cli.email}</div>}
                {(doc.dir_factura || cli.dir_factura || cli.direccion) && (
                  <div style={S.infoRow}><span style={S.infoLbl}>Dir.</span>{doc.dir_factura || cli.dir_factura || cli.direccion}</div>
                )}
              </>
            ) : (
              <div style={{color:'#9ca3af', fontSize:13}}>—</div>
            )}
          </div>
          <div style={S.infoBox}>
            <div style={S.infoBoxTitle}>Condiciones</div>
            {[
              ['Términos',   doc.terminos_pago === 'inmediato' ? 'Pago inmediato' : doc.terminos_pago ? `Crédito ${doc.terminos_pago}d` : null],
              ['Vendedor',   doc.vendedor   || null],
              doc.vendedor && doc.vendedor_telefono ? ['Tel. vend.', doc.vendedor_telefono] : null,
            ].filter(r => r && r[1]).map(([lbl, val]) => (
              <div key={lbl} style={S.infoRow}><span style={S.infoLbl}>{lbl}</span>{val}</div>
            ))}
          </div>
        </div>

        {/* Items table */}
        <div style={{overflowX:'auto', marginBottom:20}}>
          <table style={S.tbl}>
            <thead>
              <tr style={{background: color+'12'}}>
                <th style={{...S.th, width:30, textAlign:'center'}}>#</th>
                <th style={{...S.th, width:90}}>SKU</th>
                <th style={S.th}>Descripción</th>
                <th style={{...S.th, width:110}}>Marca</th>
                <th style={{...S.th, textAlign:'right', width:60}}>Cant.</th>
                <th style={{...S.th, textAlign:'right', width:90}}>P. Unit. {isBs ? 'Bs.' : 'USD'}</th>
                <th style={{...S.th, textAlign:'right', width:100}}>Subtotal {isBs ? 'Bs.' : 'USD'}</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                let rowNum = 0;
                return lines.map((l, i) => {
                  if (l.sku === '__SECTION__') return (
                    <tr key={i}>
                      <td colSpan={2} style={{...S.td, background:'#f3f4f6', padding:0}}/>
                      <td colSpan={5} style={{...S.td, fontWeight:700, fontSize:11, textTransform:'uppercase', letterSpacing:'.06em', color:'#6b7280', background:'#f3f4f6', paddingTop:7, paddingBottom:7}}>
                        {l.nombre || '—'}
                      </td>
                    </tr>
                  );
                  rowNum++;
                  return (
                    <tr key={i} style={{background: rowNum%2===1 ? '#fff' : '#f9fafb', borderBottom:'1px solid #f3f4f6'}}>
                      <td style={{...S.td, textAlign:'center', color:'#9ca3af', fontSize:11}}>{rowNum}</td>
                      <td style={{...S.td, fontFamily:'monospace', fontSize:11, color:'#6b7280'}}>{l.sku}</td>
                      <td style={{...S.td, fontWeight:500}}>{l.nombre}</td>
                      <td style={{...S.td, color: l.marca ? '#374151' : '#9ca3af'}}>{l.marca || '—'}</td>
                      <td style={{...S.td, textAlign:'right', fontWeight:600}}>{l.qty}</td>
                      <td style={{...S.td, textAlign:'right', fontFamily:'monospace'}}>{fmt(l.precio)}</td>
                      <td style={{...S.td, textAlign:'right', fontWeight:700, fontFamily:'monospace'}}>{fmt(l.subtotal)}</td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div style={{display:'flex', justifyContent:'flex-end'}}>
          <div style={{width:280}}>
            {[
              ['Subtotal', fmt(subtotalItems), false],
              descDoc > 0 ? [`Descuento (${descDoc}%)`, `−${fmt(subtotalItems * descDoc / 100)}`, true] : null,
              descDoc > 0 ? ['Subtotal neto', fmt(subtotalNet), false] : null,
              ['IVA 16%', doc.aplica_iva !== false ? fmt(ivaAmt) : 'Exento', false],
            ].filter(Boolean).map(([lbl, val, green]) => (
              <div key={lbl} style={{display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid #f3f4f6', fontSize:13}}>
                <span style={{color:'#6b7280'}}>{lbl}</span>
                <span style={{fontFamily:'monospace', color: green ? '#059669' : '#374151'}}>{val}</span>
              </div>
            ))}
            <div style={{display:'flex', justifyContent:'space-between', padding:'10px 0 6px', borderTop:'2px solid ' + color, marginTop:4}}>
              <span style={{fontWeight:700, fontSize:15, color: color}}>{isBs ? 'TOTAL Bs.' : 'TOTAL USD'}</span>
              <span style={{fontFamily:'monospace', fontWeight:800, fontSize:16, color: color}}>{fmt(total)}</span>
            </div>
          </div>
        </div>

        {/* Observaciones */}
        {doc.observaciones && (
          <div style={{marginTop:20, padding:'12px 14px', background:'#f9fafb', borderRadius:8, border:'1px solid #e5e7eb'}}>
            <div style={{fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'#9ca3af', marginBottom:6}}>Observaciones</div>
            <div style={{fontSize:13, color:'#374151', lineHeight:1.6}}>{doc.observaciones}</div>
          </div>
        )}

        {/* Footer */}
        <div style={{marginTop:24, paddingTop:14, borderTop:'1px solid #e5e7eb', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8}}>
          <div style={{fontSize:11, color:'#9ca3af'}}>{co.nombre} · RIF {co.rif} · {co.website}</div>
          <div style={{fontSize:11, color:'#9ca3af'}}>Documento #{doc.id} · Generado por Distribuidora Demo ERP</div>
        </div>
      </div>

      {/* PDF modal */}
      {pdfOpen && window.PdfModoModal && (
        <window.PdfModoModal
          doc={doc}
          onClose={() => setPdfOpen(false)}
          onConfirm={modo => {
            setPdfOpen(false);
            // clienteOverride: acá no hay SSData.clientes cargado (visitante anónimo) — sin esto
            // el PDF salía con "Cliente no especificado" aunque la página sí lo mostrara.
            if (window.generateDocumentPDF) window.generateDocumentPDF(doc, lines, modo, null, { clienteOverride: cli });
          }}
        />
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  shell: {
    minHeight:'100vh', background:'#f3f4f6', fontFamily:"'Segoe UI', Arial, sans-serif",
  },
  loadBox: {
    display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
    minHeight:'100vh',
  },
  spinner: {
    width:36, height:36, border:'3px solid #e5e7eb', borderTop:'3px solid #1a56db',
    borderRadius:'50%', animation:'spin 0.8s linear infinite',
  },
  notFound: {
    display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
    minHeight:'100vh', textAlign:'center', padding:32,
  },
  topBar: {
    background:'#fff', borderBottom:'1px solid #e5e7eb', padding:'10px 24px',
    display:'flex', justifyContent:'space-between', alignItems:'center',
    position:'sticky', top:0, zIndex:10,
  },
  btnOutline: {
    padding:'7px 14px', borderRadius:8, border:'1px solid #d1d5db', background:'#fff',
    fontSize:12.5, fontWeight:600, cursor:'pointer', color:'#374151', transition:'all .15s',
  },
  card: {
    maxWidth:900, margin:'32px auto', background:'#fff', borderRadius:12,
    boxShadow:'0 1px 3px rgba(0,0,0,.1), 0 4px 16px rgba(0,0,0,.05)',
    padding:'32px 36px',
  },
  infoBox: {
    background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:8, padding:'12px 14px',
  },
  infoBoxTitle: {
    fontSize:9.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em',
    color:'#9ca3af', marginBottom:8, paddingBottom:5, borderBottom:'1px solid #e5e7eb',
  },
  infoRow: {
    fontSize:12.5, color:'#374151', marginBottom:3, display:'flex', gap:6, alignItems:'baseline',
  },
  infoLbl: {
    fontSize:10, color:'#9ca3af', fontWeight:600, minWidth:45, flexShrink:0,
  },
  tbl: {
    width:'100%', borderCollapse:'collapse', fontSize:13,
  },
  th: {
    padding:'8px 10px', textAlign:'left', fontSize:10, fontWeight:700,
    textTransform:'uppercase', letterSpacing:'0.04em', color:'#6b7280',
    borderBottom:'1px solid #d1d5db',
  },
  td: {
    padding:'8px 10px', fontSize:12.5, verticalAlign:'middle',
  },
};

// Inject spin keyframes once
(function() {
  if (!document.getElementById('ss-spin-style')) {
    const s = document.createElement('style');
    s.id = 'ss-spin-style';
    s.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(s);
  }
})();

Object.assign(window, { PublicDocumentPage });
