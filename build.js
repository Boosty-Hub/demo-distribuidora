// build.js — corre con `npm run build` o `node build.js`
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const OUT = path.join(SRC, 'dist');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// Modo de build:
//   node build.js         → PRODUCCIÓN: minificado + sourcemap EXTERNO (.js.map).
//                           Los .map no se descargan salvo que el usuario abra DevTools,
//                           así el bundle servido es mínimo (antes: sin minificar + sourcemap
//                           inline = ~68% del peso era sourcemap embebido).
//   DEV=1 node build.js    → DESARROLLO: sin minificar + sourcemap inline (iteración rápida).
const DEV = process.env.DEV === '1';

// Prefijo de ruta del sitio: '' en local (se sirve en la raiz) o '/demo-distribuidora' en
// GitHub Pages (un sitio de proyecto vive bajo /<repo>/, ver .github/workflows/deploy.yml, que
// setea PAGES_BASE). Sin barra final. Ver la cabecera de src/index.template.html para el porqué
// de que esto tenga que resolverse ACÁ (build time) y no con JS en el navegador.
const PAGES_BASE = (process.env.PAGES_BASE || '').replace(/\/$/, '');

// index.html/404.html NO se editan a mano: se generan de src/index.template.html en cada build,
// reemplazando __SS_BASE__ por PAGES_BASE. Regenerar siempre desde la plantilla (no mutar el
// resultado de la corrida anterior) los hace repetibles sin importar en qué orden se llame a
// build.js con distintos PAGES_BASE.
function renderHtmlTemplates() {
  const tpl = fs.readFileSync(path.join(SRC, 'index.template.html'), 'utf8');
  const out = tpl.split('__SS_BASE__').join(PAGES_BASE);
  fs.writeFileSync(path.join(SRC, 'index.html'), out);
  fs.writeFileSync(path.join(SRC, '404.html'), out);
}

// Configuracion comun para JSX
const common = {
  bundle: false,           // sin bundling - preservamos window.* globals
  format: 'iife',
  loader: { '.jsx': 'jsx' },
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  target: ['es2020'],
  minify: !DEV,                        // prod minifica por defecto
  sourcemap: DEV ? 'inline' : 'external',
  legalComments: 'none',
};

// 1. Core chunk (eager) - siempre se carga
const eagerFiles = [
  'components/core.jsx',
  'components/virtual.jsx',
  'components/data-table.jsx',
  'components/activity-log.jsx',
  'components/shell.jsx',
  'components/login.jsx',
  'components/story-mode.jsx',
  'components/app-bootstrap.jsx',
];
// 2. Route chunks (lazy) - solo cuando el usuario entra
const lazyFiles = [
  'components/inversiones.jsx',
  'components/retenciones.jsx',
  'components/pos.jsx',
  'components/inventory.jsx',
  'components/business.jsx',
  'components/dropshipping.jsx',
  'components/sync.jsx',
  'components/chat.jsx',
  'components/settings.jsx',
  'components/pdf.jsx',
  'components/drivers.jsx',
  'components/returns.jsx',
  'components/garantias.jsx',
  'components/vendedores.jsx',
  'components/client-portal.jsx',
  'components/public-doc.jsx',
  'components/reportes.jsx',
  'components/anticipos.jsx',
  'components/comisiones.jsx',
  'components/finanzas-reportes.jsx',
  'components/asistente.jsx',
  'components/fabricacion.jsx',
];

// ─── Sello de versión (src/version.json) ──────────────────────────────────────
// Lo que permite avisarle al usuario que hay una versión nueva: el navegador compara
// el build con el que arrancó su pestaña contra este archivo (ver ssVersion en core.jsx).
//
// El id es el HASH del contenido servido, no un timestamp: si se rebuildea sin cambiar
// nada, el id no cambia y a nadie le salta el popup por gusto. Y como el archivo no
// lleva fecha, un rebuild idéntico tampoco ensucia el diff de git.
//
// Cubre todo lo que el browser ejecuta: los dist/*.js compilados MÁS los archivos que
// no pasan por esbuild (index.html, theme.css). Tocar cualquiera
// de esos cuenta como versión nueva.
function stampVersion() {
  const crypto = require('crypto');
  // supabase.js y data.js ya no van acá: se sirven desde dist/ y entran con el resto de los chunks.
  const runtime = ['index.html', 'theme.css'].map(f => path.join(SRC, f));
  // Recursivo: los chunks de src/demo/ compilan a dist/demo/*.js, y un readdir no-recursivo los
  // saltaba enteros (la carpeta "demo" no termina en ".js") — cambios ahí no disparaban el aviso.
  function listJsRecursive(dir) {
    let out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out = out.concat(listJsRecursive(full));
      else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
  }
  const dist = fs.existsSync(OUT) ? listJsRecursive(OUT).sort() : [];
  const h = crypto.createHash('sha256');
  for (const f of [...runtime, ...dist]) {
    if (!fs.existsSync(f)) continue;
    // El nombre entra al hash: renombrar un chunk también es un cambio.
    h.update(path.basename(f));
    h.update(fs.readFileSync(f));
  }
  const build = h.digest('hex').slice(0, 12);
  const file = path.join(SRC, 'version.json');
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const next = JSON.stringify({ build }) + '\n';
  if (prev !== next) fs.writeFileSync(file, next);
  return { build, cambio: prev !== next };
}

// 3. JS plano que también ejecuta el browser: no es JSX, pero `supabase.js` son 285 kB sin
//    minificar (76 kB comprimidos) y no había razón para servirlo tal cual. Se compila igual —solo
//    minify y sourcemap— y el <script> de index.html apunta a dist/. Se sigue EDITANDO src/*.js:
//    lo de dist/ es generado, como los chunks.
const plainFiles = [
  // Motor de datos mock (demo sin backend) — van ANTES de supabase.js en index.html.
  'demo/prng.js',
  'demo/catalogos.js',
  'demo/generator.js',
  'demo/db.js',
  'demo/mock-sb.js',
  'supabase.js',
  'data.js',
  // Aritmética de dinero (ssRound2 / ssSaldada). Va PRIMERO en index.html: la usan supabase.js,
  // los modales de cobro y las dos suites de prueba. Ver el encabezado de src/money.js.
  'money.js',
];

(async () => {
  renderHtmlTemplates();
  console.log('OK index.template.html →', PAGES_BASE ? `index.html/404.html (base: ${PAGES_BASE}/)` : 'index.html/404.html (base: /)');
  const all = [...eagerFiles, ...lazyFiles];
  for (const f of all) {
    const src = path.join(SRC, f);
    if (!fs.existsSync(src)) {
      console.warn('! skip (missing):', f);
      continue;
    }
    const out = path.join(OUT, path.basename(f).replace('.jsx', '.js'));
    await esbuild.build({ ...common, entryPoints: [src], outfile: out });
    console.log('OK', f);
  }
  for (const f of plainFiles) {
    const src = path.join(SRC, f);
    if (!fs.existsSync(src)) { console.warn('! skip (missing):', f); continue; }
    await esbuild.build({ ...common, entryPoints: [src], outfile: path.join(OUT, f) });
    console.log('OK', f, '→ dist/' + f);
  }
  const v = stampVersion();
  console.log('Build done ->', OUT);
  console.log('Version    ->', v.build, v.cambio ? '(NUEVA: al pushear, a los usuarios les saldrá el aviso de actualizar)' : '(sin cambios)');
})();
