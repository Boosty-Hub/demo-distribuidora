// Distribuidora Demo — base de datos en memoria
//
// Un objeto plano `{ tabla: [fila, ...] }`, con filas que tienen los MISMOS nombres de columna
// que Postgres (para que src/supabase.js no tenga que enterarse de que no hay backend). Vive
// solo en memoria: no toca localStorage ni IndexedDB, así que un F5 siempre vuelve al dataset
// generado por `generator.js` — que es exactamente el comportamiento "modo demo" que se pidió
// (se puede crear/cobrar/despachar libremente, y recargar deja todo limpio otra vez).
(function () {
  const DB = { tables: Object.create(null), seq: Object.create(null) };

  function table(name) {
    if (!DB.tables[name]) DB.tables[name] = [];
    return DB.tables[name];
  }

  function setTable(name, rows) {
    DB.tables[name] = rows || [];
    return DB.tables[name];
  }

  // Correlativo simple en memoria, por prefijo (ej. 'FAC-2026', 'MOV-MAN'). No es lo mismo que
  // `siguiente_correlativo` (que vive en mock-sb.js y respeta la semántica real de cada serie) —
  // esto es solo un contador barato para ids internos del motor demo (doc_vistas, etc).
  function nextSeq(prefix) {
    DB.seq[prefix] = (DB.seq[prefix] || 0) + 1;
    return DB.seq[prefix];
  }

  function insert(name, rows) {
    const arr = table(name);
    const list = Array.isArray(rows) ? rows : [rows];
    arr.push(...list);
    return list;
  }

  function remove(name, pred) {
    const arr = table(name);
    const removed = [];
    for (let i = arr.length - 1; i >= 0; i--) {
      if (pred(arr[i])) { removed.push(arr[i]); arr.splice(i, 1); }
    }
    return removed;
  }

  function update(name, pred, patch) {
    const arr = table(name);
    const updated = [];
    for (const row of arr) {
      if (pred(row)) {
        Object.assign(row, typeof patch === 'function' ? patch(row) : patch);
        updated.push(row);
      }
    }
    return updated;
  }

  window.__ssDemoDB = { DB, table, setTable, insert, remove, update, nextSeq };

  // La demo no usa IndexedDB (el cache de Fase 1 del sistema real) ni la lista de documentos
  // cacheada en localStorage: ambas existen para ahorrarle red al sistema real, y acá no hay red
  // que ahorrar (todo resuelve sincrono contra este objeto en memoria). Se desactivan para que un
  // dataset viejo en el navegador del visitante nunca conviva con el dataset recien generado.
  try { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); } catch (e) {}
  try { localStorage.removeItem('ss-docs-cache'); } catch (e) {}
  try { localStorage.removeItem('ss-f1-v3'); } catch (e) {}
})();
