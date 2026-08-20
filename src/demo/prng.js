// Distribuidora Demo — PRNG con semilla
//
// La demo no tiene backend: el dataset de las 2 empresas se genera EN EL NAVEGADOR, en cada carga.
// Tiene que ser el MISMO dataset cada vez (para que la demo sea predecible al presentarla) y no
// puede usar Math.random() ni Date.now() para eso — ambos cambian entre cargas. Este archivo es la
// única fuente de aleatoriedad de `src/demo/*`: un generador mulberry32 sembrado con un entero fijo.
//
// Las FECHAS de los documentos sí se anclan a "hoy" (ver generator.js) para que la demo nunca se
// vea vieja — pero se derivan restando días desde `hoy`, nunca de Date.now() dentro del PRNG.
(function () {
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seed) {
    const next = mulberry32(seed);
    const rng = {
      // float en [0,1)
      float() { return next(); },
      // entero en [min,max] (ambos inclusive)
      int(min, max) { return Math.floor(next() * (max - min + 1)) + min; },
      // true con probabilidad p (0..1)
      chance(p) { return next() < p; },
      // un elemento al azar de un array
      pick(arr) { return arr[Math.floor(next() * arr.length)]; },
      // N elementos distintos de un array, sin repetir
      pickN(arr, n) {
        const pool = arr.slice();
        const out = [];
        const k = Math.min(n, pool.length);
        for (let i = 0; i < k; i++) {
          const idx = Math.floor(next() * pool.length);
          out.push(pool[idx]);
          pool.splice(idx, 1);
        }
        return out;
      },
      // elemento al azar respetando pesos: [[valor,peso], ...]
      weighted(pairs) {
        const total = pairs.reduce((s, p) => s + p[1], 0);
        let r = next() * total;
        for (const [val, w] of pairs) { r -= w; if (r <= 0) return val; }
        return pairs[pairs.length - 1][0];
      },
      // baraja un array (Fisher-Yates), sin mutar el original
      shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      },
      // id corto legible (base36), NO usar como PK única sin combinarlo con un prefijo/contador
      token(len) {
        len = len || 6;
        let s = '';
        while (s.length < len) s += Math.floor(next() * 36 ** 6).toString(36);
        return s.slice(0, len);
      },
    };
    return rng;
  }

  // Un rng por empresa (semillas distintas) — así demo1 y demo2 no comparten secuencia y no hace
  // falta coordinarlas a mano para que sean "diferentes" entre sí.
  window.__ssDemoRng = {
    make: makeRng,
    SEED_DEMO1: 20260819,
    SEED_DEMO2: 20260820,
    SEED_SHARED: 7,   // para cosas que no deben variar entre empresas (ids de usuarios demo, etc.)
  };
})();
