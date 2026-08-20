// Distribuidora Demo — cliente falso (reemplaza @supabase/supabase-js)
//
// src/supabase.js llama a `window.sb.from(tabla)...`, `window.sb.rpc(nombre, params)` y
// `window.sb.auth.*` exactamente como si hablara con Postgres real. Este archivo es el ÚNICO
// lugar que sabe que no hay servidor: implementa esa misma forma de API contra las tablas en
// memoria de `src/demo/db.js`, sembradas por `src/demo/generator.js` la primera vez que se usan.
//
// También intercepta `window.fetch` para las 5 Edge Functions y la RPC-por-REST que
// src/supabase.js llama con `fetch()` en vez de `sb.rpc()` (ver cabecera de supabase.js) — así
// la demo nunca intenta salir a la red real, sin tener que tocar esas líneas de supabase.js.
(function () {
  function ensureBuilt() {
    if (!window.__ssDemoGenerator.built) window.__ssDemoGenerator.build();
  }

  function db() { return window.__ssDemoDB; }
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function uid(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36); }

  // ── Operadores de filtro (subset real de PostgREST que usa supabase.js) ────
  function toRegex(pattern, ci) {
    const esc = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
    return new RegExp('^' + esc + '$', ci ? 'i' : '');
  }
  function applyOp(row, col, op, val) {
    const v = row ? row[col] : undefined;
    switch (op) {
      case 'eq':  return v === val;
      case 'neq': return v !== val;
      case 'gt':  return v != null && v > val;
      case 'gte': return v != null && v >= val;
      case 'lt':  return v != null && v < val;
      case 'lte': return v != null && v <= val;
      case 'is':  return val === null ? (v === null || v === undefined) : v === val;
      case 'in':  return Array.isArray(val) && val.includes(v);
      case 'like':  return toRegex(val, false).test(String(v ?? ''));
      case 'ilike': return toRegex(val, true).test(String(v ?? ''));
      case 'contains':  return Array.isArray(v) && Array.isArray(val) && val.every(x => v.includes(x));
      case 'overlaps':  return Array.isArray(v) && Array.isArray(val) && val.some(x => v.includes(x));
      default: return true;
    }
  }

  // Embeds PostgREST conocidos (alias:tabla(cols) o tabla(cols)) — mapa manual de los pocos casos
  // reales que usa el código (ver informe de arquitectura). Cualquier otro embed no listado se
  // ignora en silencio (mejor una columna vacía que una excepción).
  const EMBEDS = {
    documentos:            [{ re: /(?:^|,)\s*(?:(\w+):)?documentos_items\(/, child: 'documentos_items', fk: 'documento_id', many: true }],
    ordenes_fabricacion:    [{ re: /(?:^|,)\s*(?:(\w+):)?ordenes_fabricacion_items\(/, child: 'ordenes_fabricacion_items', fk: 'orden_fabricacion_id', many: true }],
    ordenes_compra:        [{ re: /(?:^|,)\s*(?:(\w+):)?ordenes_compra_items\(/, child: 'ordenes_compra_items', fk: 'orden_compra_id', many: true }],
    cuentas_pagar:         [{ re: /(?:^|,)\s*(?:(\w+):)?cuentas_bancarias\(/, child: 'cuentas_bancarias', fk: 'id', parentFk: 'cuenta_bancaria_id', many: false }],
  };
  function applyEmbeds(table, cols, rows) {
    const specs = EMBEDS[table];
    if (!specs) return rows;
    specs.forEach(spec => {
      const m = cols && cols.match(spec.re);
      if (!m) return;
      const alias = m[1] || spec.child;
      const childRows = db().table(spec.child);
      rows.forEach(row => {
        if (spec.many) {
          row[alias] = childRows.filter(c => c[spec.fk] === row.id);
        } else {
          const parentVal = row[spec.parentFk];
          row[alias] = childRows.find(c => c[spec.fk] === parentVal) || null;
        }
      });
    });
    return rows;
  }

  // ── Query builder encadenable (imita PostgrestFilterBuilder) ──────────────
  function makeBuilder(table) {
    ensureBuilt();
    let selectCols = '*', selectOpts = {};
    let filters = [];   // [{col,op,val}] combinadas con AND
    let orFilters = null; // array de {col,op,val} combinadas con OR (una sola cláusula .or())
    let orderSpecs = [];
    let rangeSpec = null, limitSpec = null;
    let wantSingle = false, wantMaybeSingle = false;
    let mode = 'select', payload = null, upsertConflict = null;

    const chain = {
      select(cols, opts) { selectCols = cols || '*'; selectOpts = opts || {}; return chain; },
      insert(rows) { mode = 'insert'; payload = Array.isArray(rows) ? rows : [rows]; return chain; },
      update(fields) { mode = 'update'; payload = fields; return chain; },
      upsert(rows, opts) { mode = 'upsert'; payload = Array.isArray(rows) ? rows : [rows]; upsertConflict = opts && opts.onConflict; return chain; },
      delete() { mode = 'delete'; return chain; },
      eq(c, v) { filters.push({ c, op: 'eq', v }); return chain; },
      neq(c, v) { filters.push({ c, op: 'neq', v }); return chain; },
      gt(c, v) { filters.push({ c, op: 'gt', v }); return chain; },
      gte(c, v) { filters.push({ c, op: 'gte', v }); return chain; },
      lt(c, v) { filters.push({ c, op: 'lt', v }); return chain; },
      lte(c, v) { filters.push({ c, op: 'lte', v }); return chain; },
      is(c, v) { filters.push({ c, op: 'is', v }); return chain; },
      in(c, v) { filters.push({ c, op: 'in', v }); return chain; },
      like(c, v) { filters.push({ c, op: 'like', v }); return chain; },
      ilike(c, v) { filters.push({ c, op: 'ilike', v }); return chain; },
      contains(c, v) { filters.push({ c, op: 'contains', v }); return chain; },
      overlaps(c, v) { filters.push({ c, op: 'overlaps', v }); return chain; },
      not(c, op, v) { filters.push({ c, op, v, negate: true }); return chain; },
      or(expr) {
        // "col.op.val,col2.op2.val2" — cada termino aplicado como OR
        orFilters = String(expr).split(',').map(term => {
          const parts = term.split('.');
          const c = parts[0], op = parts[1], raw = parts.slice(2).join('.');
          return { c, op, v: raw === 'null' ? null : raw };
        });
        return chain;
      },
      order(col, opts) { orderSpecs.push({ col, asc: !opts || opts.ascending !== false, nullsFirst: !!(opts && opts.nullsFirst) }); return chain; },
      range(from, to) { rangeSpec = [from, to]; return chain; },
      limit(n) { limitSpec = n; return chain; },
      maybeSingle() { wantMaybeSingle = true; return chain; },
      single() { wantSingle = true; return chain; },
      then(resolve, reject) { return execute().then(resolve, reject); },
      catch(fn) { return execute().catch(fn); },
    };

    function matches(row) {
      for (const f of filters) {
        const r = applyOp(row, f.c, f.op, f.v);
        if (f.negate ? r : !r) return false;
      }
      if (orFilters && !orFilters.some(f => applyOp(row, f.c, f.op, f.v))) return false;
      return true;
    }

    async function execute() {
      try {
        const arr = db().table(table);
        if (mode === 'insert') {
          const rows = payload.map(r => ({ ...r }));
          db().insert(table, rows);
          const out = wantSingle || wantMaybeSingle ? (rows[0] || null) : rows;
          if (wantSingle && !rows.length) return { data: null, error: { message: 'no rows' } };
          return { data: out, error: null };
        }
        if (mode === 'update') {
          const updated = db().update(table, matches, payload);
          const out = wantSingle || wantMaybeSingle ? (updated[0] || null) : updated;
          return { data: out, error: null };
        }
        if (mode === 'upsert') {
          const keys = (upsertConflict || 'id').split(',').map(s => s.trim());
          const out = [];
          payload.forEach(r => {
            const existing = arr.find(row => keys.every(k => row[k] === r[k]));
            if (existing) { Object.assign(existing, r); out.push(existing); }
            else { const row = { ...r }; db().insert(table, [row]); out.push(row); }
          });
          return { data: wantSingle || wantMaybeSingle ? (out[0] || null) : out, error: null };
        }
        if (mode === 'delete') {
          const removed = db().remove(table, matches);
          return { data: removed, error: null };
        }
        // select
        let rows = arr.filter(matches);
        const count = selectOpts.count ? rows.length : undefined;
        orderSpecs.forEach(o => {
          rows = rows.slice().sort((a, b) => {
            const av = a[o.col], bv = b[o.col];
            const aNull = av === null || av === undefined, bNull = bv === null || bv === undefined;
            if (aNull && bNull) return 0;
            if (aNull) return o.nullsFirst ? -1 : 1;
            if (bNull) return o.nullsFirst ? 1 : -1;
            if (av < bv) return o.asc ? -1 : 1;
            if (av > bv) return o.asc ? 1 : -1;
            return 0;
          });
        });
        if (rangeSpec) rows = rows.slice(rangeSpec[0], rangeSpec[1] + 1);
        else if (limitSpec != null) rows = rows.slice(0, limitSpec);
        rows = rows.map(r => ({ ...r }));
        applyEmbeds(table, selectCols, rows);
        if (selectOpts.head) rows = [];
        if (wantSingle) {
          if (rows.length !== 1) return { data: null, error: { message: 'Row not found' }, count };
          return { data: rows[0], error: null, count };
        }
        if (wantMaybeSingle) return { data: rows[0] || null, error: null, count };
        return { data: rows, error: null, count };
      } catch (err) {
        return { data: null, error: { message: err && err.message || String(err) } };
      }
    }

    return chain;
  }

  // ── Sesión falsa ────────────────────────────────────────────────────────────
  // Vive en memoria (no hay JWT real que persistir), PERO se espeja en sessionStorage: cambiar
  // de empresa recarga la página a propósito (ver shell.jsx, EmpresaSelector.pick) y sin esto el
  // usuario volvería al login cada vez que cambia de empresa — mala demo. Lo que SÍ se pierde al
  // recargar es el dataset (se regenera desde la semilla), que es el comportamiento pedido.
  const SESSION_KEY = 'ss-demo-session';
  let currentSession = null;
  function userFromRow(row) {
    return { id: row.auth_id, email: row.email, app_metadata: { empresas: row.empresas || [] } };
  }
  function persistSession(session) {
    try {
      if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email: session.user.email }));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }
  function restoreSessionIfAny() {
    if (currentSession) return currentSession;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      ensureBuilt();
      const saved = JSON.parse(raw);
      const row = db().table('usuarios').find(u => u.email === saved.email);
      if (!row) return null;
      currentSession = { user: userFromRow(row), access_token: 'demo-token', refresh_token: 'demo-refresh' };
      return currentSession;
    } catch (e) { return null; }
  }

  const auth = {
    async getSession() { return { data: { session: restoreSessionIfAny() }, error: null }; },
    async signInWithPassword({ email }) {
      ensureBuilt();
      const row = db().table('usuarios').find(u => u.email === email && u.activo !== false);
      if (!row) return { data: null, error: { message: 'Invalid login credentials' } };
      const user = userFromRow(row);
      currentSession = { user, access_token: 'demo-token', refresh_token: 'demo-refresh' };
      persistSession(currentSession);
      return { data: { user, session: currentSession }, error: null };
    },
    async setSession({ access_token }) {
      // Camino del PIN — en esta demo nadie tiene PIN habilitado (ver login.jsx: se usa
      // signInWithPassword para las tarjetas de acceso rapido), asi que esto no se ejecuta en
      // el flujo normal; se deja andando por si alguien prueba el PIN de todos modos.
      currentSession = currentSession || { user: null, access_token, refresh_token: 'demo-refresh' };
      persistSession(currentSession);
      return { data: { session: currentSession }, error: null };
    },
    async refreshSession() { return { data: { session: currentSession }, error: null }; },
    async signOut() { currentSession = null; persistSession(null); return { error: null }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
  };

  // ── RPC handlers ─────────────────────────────────────────────────────────
  function tasaActual() {
    const rows = db().table('tasa_cambio').slice().sort((a, b) => a.created_at < b.created_at ? 1 : -1);
    return rows[0] || null;
  }

  function fase1Snapshot(p) {
    const e = p.p_empresa_id;
    const out = {
      almacenes: db().table('almacenes').filter(a => a.empresa_id === e),
      inventario: db().table('inventario'),
      listas_precios: db().table('listas_precios').filter(l => l.empresa_id === e),
      lista_precios_detalle: db().table('lista_precios_detalle').filter(l => l.empresa_id === e),
      tipos_cliente: db().table('tipos_cliente').filter(t => t.empresa_id === e),
      pos_fuentes_venta: db().table('pos_fuentes_venta').filter(f => f.empresa_id === e),
      configuracion_sistema: db().table('configuracion_sistema').find(c => c.empresa_id === e) || null,
      tasa_cambio: tasaActual(),
    };
    if (p.p_incluir_productos) out.productos = db().table('productos').filter(x => (x.empresas || []).includes(e) && x.activo !== false);
    return out;
  }

  function fase2Snapshot(p) {
    const e = p.p_empresa_id;
    const byEmp = (t) => db().table(t).filter(r => r.empresa_id === e);
    return {
      proveedores: byEmp('proveedores'), vendedores: byEmp('vendedores'),
      cuentas_cobrar: byEmp('cuentas_cobrar'), cuentas_pagar: byEmp('cuentas_pagar'),
      cuentas_bancarias: byEmp('cuentas_bancarias'), canales_chat: byEmp('canales_chat'),
      mensajes_chat: db().table('mensajes_chat'), canal_miembros: db().table('canal_miembros'),
      drivers: byEmp('drivers'), incidencias: byEmp('incidencias'), driver_despachos: byEmp('driver_despachos'),
      devoluciones: byEmp('devoluciones'), categorias_cuenta: byEmp('categorias_cuenta'),
      usuarios: db().table('usuarios'), pos_tipos_entrega: byEmp('pos_tipos_entrega'),
      roles: byEmp('roles'), campos_config: byEmp('campos_config'), categorias: byEmp('categorias'),
      marcas: byEmp('marcas'), anticipos: byEmp('anticipos'),
    };
  }

  let corrCounters = Object.create(null);
  function siguienteCorrelativo(p) {
    const key = p.p_empresa_id + '|' + p.p_serie + '|' + p.p_anio;
    corrCounters[key] = (corrCounters[key] || 0) + 1;
    return p.p_serie + '-' + p.p_anio + '-' + corrCounters[key];
  }

  function documentoDetalle(p) {
    const doc = db().table('documentos').find(d => d.id === p.p_id);
    if (!doc) return null;
    const items = db().table('documentos_items').filter(i => i.documento_id === doc.id);
    const linaje = db().table('documentos').filter(d => d.raiz_id === doc.raiz_id).sort((a, b) => a.created_at < b.created_at ? -1 : 1);
    return { doc, items, items_de: items, linaje, seriales: {} };
  }

  function subtabCounts(p) {
    const e = p.p_empresa_id, tipo = p.p_tipo;
    const rows = db().table('documentos').filter(d => d.empresa_id === e && d.tipo === tipo);
    const out = { todas: rows.length };
    rows.forEach(r => {
      const k = tipo === 'factura' ? (r.estado_cobro || 'pendiente') : (r.estado || 'activo');
      out[k] = (out[k] || 0) + 1;
    });
    return out;
  }

  function documentoCounts(p) {
    const e = p.p_empresa_id;
    const rows = db().table('documentos').filter(d => d.empresa_id === e);
    const porTipo = {};
    rows.forEach(r => { porTipo[r.tipo] = (porTipo[r.tipo] || 0) + 1; });
    return { porTipo, porSubestado: {}, porFlujo: {} };
  }

  function despachoPanelCounts(p) {
    const e = p.p_empresa_id;
    const facturas = db().table('documentos').filter(d => d.empresa_id === e && d.tipo === 'factura');
    return {
      pendientes: facturas.filter(f => f.estado_despacho === 'pendiente').length,
      entregados: facturas.filter(f => f.estado_despacho === 'entregado').length,
      total: facturas.length,
    };
  }

  function documentosTrabados(p) {
    const e = p.p_empresa_id;
    return db().table('documentos').filter(d => d.empresa_id === e && (
      (d.tipo === 'orden' && !d.has_child) || (d.tipo === 'factura' && d.estado_despacho === 'pendiente')
    )).slice(0, 30);
  }

  function cxcResumen(p) {
    const e = p.p_empresa_id;
    const rows = db().table('cuentas_cobrar').filter(c => c.empresa_id === e);
    const pendiente = rows.filter(r => r.estado !== 'pagada');
    return {
      total_pendiente: round2(pendiente.reduce((s, r) => s + (r.monto - r.pagado), 0)),
      vencidas: pendiente.filter(r => r.vence && r.vence < new Date().toISOString().slice(0, 10)).length,
      cantidad: pendiente.length,
    };
  }

  function clientesResumen(p) {
    const e = p.p_empresa_id;
    let rows = db().table('clientes').filter(c => (c.empresas || []).includes(e));
    if (p.p_tipo) rows = rows.filter(c => c.tipo === p.p_tipo);
    if (p.p_search) {
      const q = String(p.p_search).toLowerCase();
      rows = rows.filter(c => c.nombre.toLowerCase().includes(q) || (c.rif || '').toLowerCase().includes(q));
    }
    return {
      total: rows.length,
      credito: round2(rows.reduce((s, c) => s + (c.limite_credito || 0), 0)),
      deuda: 0,
      ventasYTD: 0,
    };
  }

  function buscarDuplicadoCliente(p) {
    const porRif = p.p_rif ? db().table('clientes').find(c => c.rif === p.p_rif && c.id !== p.p_excluir) : null;
    const porNombre = p.p_nombre ? db().table('clientes').find(c => c.nombre.toLowerCase() === String(p.p_nombre).toLowerCase() && c.id !== p.p_excluir) : null;
    return { porRif: porRif || null, porNombre: porNombre || null };
  }

  function habilitarClienteEnEmpresa(p) {
    const c = db().table('clientes').find(x => x.id === p.p_cliente_id);
    if (c && !(c.empresas || []).includes(p.p_empresa_id)) c.empresas = [...(c.empresas || []), p.p_empresa_id];
    return { ok: true };
  }

  function invAjustarCantidad(p) {
    const row = db().table('inventario').find(i => i.sku === p.p_sku && i.almacen_id === p.p_almacen);
    if (row) row.cantidad = Math.max(0, (row.cantidad || 0) + (p.p_delta || 0));
    else db().insert('inventario', [{ sku: p.p_sku, almacen_id: p.p_almacen, cantidad: Math.max(0, p.p_delta || 0), reservado: 0, locacion: '', minimo: 0, maximo: 999 }]);
    return { ok: true };
  }

  function stockComprometido(p) {
    const out = {};
    (p.p_skus || []).forEach(sku => {
      const row = db().table('inventario').find(i => i.sku === sku && i.almacen_id === p.p_almacen_id);
      out[sku] = row ? row.reservado || 0 : 0;
    });
    return out;
  }

  function recalcEstadoDespachoFactura(p) {
    const factura = db().table('documentos').find(d => d.id === p.p_factura_id);
    if (!factura) return { ok: false };
    const despachos = db().table('documentos').filter(d => d.tipo === 'despacho' && d.parent_id === factura.id);
    factura.estado_despacho = despachos.some(d => d.envio_entregado) ? 'entregado' : (despachos.length ? 'parcial' : 'pendiente');
    return { ok: true };
  }

  function crearDespachoParcial(p) {
    const factura = db().table('documentos').find(d => d.id === p.p_factura_id);
    if (!factura) return { error: 'Factura no encontrada' };
    const id = p.p_despacho_id || 'DSP-' + new Date().getFullYear() + '-' + (db().table('documentos').filter(d => d.tipo === 'despacho').length + 1);
    const items = (p.p_items || []).map((it, i) => ({ id: id + '-IT-' + i, documento_id: id, ...it }));
    db().insert('documentos', [{
      id, tipo: 'despacho', cliente_id: factura.cliente_id, fecha: new Date().toISOString().slice(0, 10),
      created_at: new Date().toISOString(), estado: 'activo', total: factura.total, moneda: 'USD',
      vendedor: factura.vendedor, creado_por: factura.creado_por, almacen_id: p.p_almacen_id || factura.almacen_id,
      empresa_id: factura.empresa_id, raiz_id: factura.raiz_id, parent_id: factura.id, has_child: false,
      estado_despacho: 'entregado', envio_entregado: true, version: 1, slug: id.toLowerCase(), observaciones: p.p_observaciones || '',
    }]);
    db().insert('documentos_items', items);
    db().update('documentos', r => r.id === factura.id, { has_child: true });
    recalcEstadoDespachoFactura({ p_factura_id: factura.id });
    return { ok: true, despacho_id: id };
  }

  function cancelarDespacho(p) {
    db().update('documentos', r => r.id === p.p_despacho_id, { estado: 'cancelado' });
    return { ok: true };
  }

  function aplicarAnticipo(p) {
    const cxc = db().table('cuentas_cobrar').find(c => c.factura === p.p_documento_id || c.id === p.p_documento_id);
    if (cxc) {
      cxc.pagado = round2((cxc.pagado || 0) + (p.p_monto || 0));
      if (cxc.pagado >= cxc.monto) cxc.estado = 'pagada';
    }
    return { ok: true };
  }

  function recomputeSaldoCuenta(p) {
    const movs = db().table('movimientos_bancarios').filter(m => m.cuenta_id === p.p_cuenta_id);
    const saldo = round2(movs.reduce((s, m) => s + m.monto, 0));
    const cta = db().table('cuentas_bancarias').find(c => c.id === p.p_cuenta_id);
    if (cta) cta.saldo = saldo;
    return saldo;
  }

  function ventasPivot(p) {
    const e = p.p_empresa_id;
    const rows = db().table('documentos').filter(d => d.empresa_id === e && d.tipo === (p.p_tipo || 'factura') && d.fecha >= p.p_desde && d.fecha <= p.p_hasta);
    const map = {};
    rows.forEach(r => {
      const key = r[p.p_dim1] || r.vendedor || 'N/D';
      if (!map[key]) map[key] = { dim: key, total: 0, cantidad: 0 };
      map[key].total += r.total; map[key].cantidad += 1;
    });
    return Object.values(map).map(v => ({ ...v, total: round2(v.total) }));
  }

  function finanzasReporte(p) {
    const e = p.p_empresa_id;
    const facturas = db().table('documentos').filter(d => d.empresa_id === e && d.tipo === 'factura' && d.fecha >= p.p_desde && d.fecha <= p.p_hasta);
    const ventas = round2(facturas.reduce((s, f) => s + f.total, 0));
    const cobrado = round2(facturas.filter(f => f.estado_cobro === 'pagada').reduce((s, f) => s + f.total, 0));
    const movs = db().table('movimientos_bancarios').filter(m => m.empresa_id === e && m.fecha >= p.p_desde && m.fecha <= p.p_hasta);
    const egresos = round2(movs.filter(m => m.monto < 0).reduce((s, m) => s + Math.abs(m.monto), 0));
    return { ventas, cobrado, pendiente: round2(ventas - cobrado), egresos, margen: round2(ventas - egresos), facturas: facturas.length };
  }

  function comisionesVendedor(p) {
    const e = p.p_empresa_id;
    const facturas = db().table('documentos').filter(d => d.empresa_id === e && d.tipo === 'factura' && d.vendedor_id === p.p_vendedor_id);
    const vendedor = db().table('vendedores').find(v => v.id === p.p_vendedor_id);
    const total = round2(facturas.reduce((s, f) => s + f.total, 0));
    return { total_ventas: total, comision: round2(total * ((vendedor && vendedor.comision_pct) || 3) / 100), facturas: facturas.length };
  }

  function garantiaStats(p) {
    const e = p.p_empresa_id;
    const rows = db().table('garantias').filter(g => g.empresa_id === e);
    return { activas: rows.filter(g => g.estado === 'activa').length, total: rows.length };
  }

  function serialesProducto(p) {
    const rows = db().table('inventario_seriales').filter(s => s.sku === p.p_sku);
    return { rows: rows.slice(p.p_offset || 0, (p.p_offset || 0) + (p.p_limit || 50)), total: rows.length };
  }

  function ventasProductoDetalle(p) {
    const items = db().table('documentos_items').filter(i => i.sku === p.p_sku);
    return items.map(i => {
      const doc = db().table('documentos').find(d => d.id === i.documento_id);
      return { documentoId: i.documento_id, fecha: doc && doc.fecha, cantidad: i.cantidad, precioUnit: i.precio_unitario, subtotal: i.subtotal, estado: doc && doc.estado };
    });
  }

  const RPC = {
    get_fase1_snapshot: fase1Snapshot,
    get_fase2_snapshot: fase2Snapshot,
    siguiente_correlativo: siguienteCorrelativo,
    get_documento_detalle: documentoDetalle,
    get_subtab_counts: subtabCounts,
    get_documento_counts: documentoCounts,
    get_despacho_panel_counts: despachoPanelCounts,
    get_documentos_trabados: documentosTrabados,
    get_cxc_resumen: cxcResumen,
    clientes_resumen: clientesResumen,
    buscar_duplicado_cliente: buscarDuplicadoCliente,
    habilitar_cliente_en_empresa: habilitarClienteEnEmpresa,
    inv_ajustar_cantidad: invAjustarCantidad,
    stock_comprometido: stockComprometido,
    facturas_comprometiendo: () => [],
    ordenes_con_reserva: () => ({ data: [], total: 0, sinOrden: 0 }),
    recalc_estado_despacho_factura: recalcEstadoDespachoFactura,
    crear_despacho_parcial: crearDespachoParcial,
    cancelar_despacho: cancelarDespacho,
    aplicar_anticipo: aplicarAnticipo,
    revertir_aplicacion_anticipo: () => ({ ok: true }),
    recompute_saldo_cuenta: recomputeSaldoCuenta,
    get_ventas_pivot: ventasPivot,
    get_finanzas_reporte: finanzasReporte,
    get_comisiones_vendedor: comisionesVendedor,
    get_retenciones_resumen: () => ({ total: 0, cantidad: 0 }),
    get_garantia_stats: garantiaStats,
    get_seriales_producto: serialesProducto,
    get_ventas_producto_detalle: ventasProductoDetalle,
    asignar_seriales_entrega: () => ({ ok: true }),
    recibir_transferencia_item: () => ({ ok: true }),
    crear_inversion: (p) => { const row = { id: uid('MOV-INV'), ...p }; db().insert('inversiones', [row]); return row; },
    eliminar_inversion: (p) => { db().remove('inversiones', r => r.id === p.p_id); return { ok: true }; },
    eliminar_traspaso_bancario: (p) => { db().remove('movimientos_bancarios', r => r.match_id === p.p_id); return { ok: true }; },
    vuelto_a_saldo_a_favor: () => ({ ok: true }),
    reasignar_anticipo_cliente: () => ({ ok: true }),
    aplicar_retencion: (p) => { const row = { id: uid('RET'), ...p }; db().insert('retenciones', [row]); return row; },
    revertir_retencion: (p) => { db().remove('retenciones', r => r.id === p.p_id); return { ok: true }; },
    puede_renombrar_sku: () => ({ ventas: 0, movimientos: 0 }),
    renombrar_sku_producto: (p) => {
      const row = db().table('productos').find(x => x.sku === p.p_sku_actual);
      if (row) row.sku = p.p_sku_nuevo;
      return { ok: true, sku_nuevo: p.p_sku_nuevo };
    },
    variantes_persona: () => ({ variantes: [] }),
    contar_referencias_persona: () => ({ total: 0, detalle: [] }),
    renombrar_persona: () => ({ ok: true, registros: 0, detalle: [] }),
    get_documento_publico: (p) => {
      const doc = db().table('documentos').find(d => d.slug === p.p_slug);
      if (!doc) return null;
      const items = db().table('documentos_items').filter(i => i.documento_id === doc.id);
      const empresaCfg = db().table('configuracion_sistema').find(c => c.empresa_id === doc.empresa_id);
      const cliente = db().table('clientes').find(c => c.id === doc.cliente_id);
      return { doc: { ...doc, lines: items }, cliente, empresaCfg };
    },
    devolver_oc: () => ({ ok: true, id: uid('DEVOC'), monto: 0, deudaReducida: 0, sobranteSinCxp: 0, invErrores: [] }),
    crear_orden_fabricacion: (p) => { const row = { id: uid('OF'), etapa: 'corte', ...p }; db().insert('ordenes_fabricacion', [row]); return row; },
    avanzar_etapa_of: (p) => {
      const of = db().table('ordenes_fabricacion').find(o => o.id === p.p_id);
      const etapas = ['corte', 'armado', 'pintura', 'listo'];
      if (of) of.etapa = etapas[Math.min(etapas.indexOf(of.etapa) + 1, etapas.length - 1)];
      return { ok: true };
    },
    declarar_of_lista: (p) => { db().update('ordenes_fabricacion', r => r.id === p.p_id, { etapa: 'listo' }); return { ok: true }; },
  };

  // ── fetch() shim: Edge Functions + RPC-por-REST que supabase.js llama directo ──
  const origFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = async function (url, options) {
    const u = String(url || '');
    if (u.includes('/functions/v1/pin-login')) {
      return jsonResponse(401, { error: 'El acceso por PIN no está habilitado en esta demo — usa una de las tarjetas de acceso rápido.' });
    }
    if (u.includes('/functions/v1/fetch-bcv-rate')) {
      const t = tasaActual();
      return jsonResponse(200, { success: true, data: { rate: t ? t.bcv : 0, source: 'demo', sourceUpdatedAt: new Date().toISOString(), fetchedAt: new Date().toISOString() }, sources: [] });
    }
    if (u.includes('/functions/v1/admin-users')) {
      return handleAdminUsers(options);
    }
    if (u.includes('/functions/v1/ai-assistant')) {
      return jsonResponse(200, { answer: 'El asistente con IA no está conectado en esta demo. En el sistema real, acá respondería Claude analizando tus datos en vivo.', sqls: [] });
    }
    if (u.includes('/functions/v1/shopify-proxy')) {
      return jsonResponse(200, { status: 200, ok: true, data: {} });
    }
    if (u.includes('/rest/v1/rpc/actualizar_duracion_vista')) {
      return jsonResponse(200, {});
    }
    if (origFetch) return origFetch(url, options);
    return jsonResponse(404, { error: 'not found' });
  };

  function jsonResponse(status, body) {
    return Promise.resolve({
      ok: status >= 200 && status < 300, status,
      json: async () => body, text: async () => JSON.stringify(body),
    });
  }

  function handleAdminUsers(options) {
    let body = {};
    try { body = JSON.parse((options && options.body) || '{}'); } catch (e) {}
    const usuarios = db().table('usuarios');
    if (body.action === 'create') {
      const row = { id: uid('USR'), auth_id: uid('auth'), email: body.email, nombre: body.nombre, rol: body.rol, iniciales: body.iniciales, avatar: body.avatar, activo: true, empresas: [body.empresa_id || 'demo1'], online: false, tiene_pin: false };
      db().insert('usuarios', [row]);
      return jsonResponse(200, { userId: row.id, authId: row.auth_id });
    }
    if (body.action === 'toggle') {
      const row = usuarios.find(u => u.id === body.userId || u.auth_id === body.authId);
      if (row) row.activo = !!body.activo;
      return jsonResponse(200, { ok: true });
    }
    if (body.action === 'update') {
      const row = usuarios.find(u => u.id === body.userId);
      if (row) Object.assign(row, body.fields || {});
      return jsonResponse(200, { ok: true });
    }
    if (body.action === 'setPassword') return jsonResponse(200, { ok: true });
    if (body.action === 'delete') {
      db().remove('usuarios', u => u.id === body.userId);
      return jsonResponse(200, { ok: true });
    }
    return jsonResponse(200, { ok: true });
  }

  // Realtime (Supabase channels): la demo no tiene servidor empujando cambios (la tasa de cambio,
  // el aviso de "hay una versión nueva"), así que el canal es un stub que nunca dispara nada —
  // solo necesita no explotar cuando shell.jsx/core.jsx se suscriben y se desuscriben.
  function makeChannel() {
    const ch = { on() { return ch; }, subscribe(cb) { if (cb) cb('SUBSCRIBED'); return ch; }, unsubscribe() {} };
    return ch;
  }

  // ── Factory del cliente ─────────────────────────────────────────────────────
  window.__ssCreateMockClient = function () {
    return {
      from(table) { return makeBuilder(table); },
      async rpc(name, params) {
        ensureBuilt();
        const handler = RPC[name];
        if (!handler) { console.warn('[mock-sb] RPC sin implementar:', name); return { data: null, error: null }; }
        try { return { data: await handler(params || {}), error: null }; }
        catch (err) { return { data: null, error: { message: err && err.message || String(err) } }; }
      },
      channel() { return makeChannel(); },
      removeChannel() {},
      auth,
    };
  };
})();
