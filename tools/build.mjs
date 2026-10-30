// Build: src/*.js (tested ES modules) -> dist/meal-planner.html (one double-clickable file).
//
// Why a build step at all: a page opened from file:// cannot use ES-module
// imports (the browser treats file:// as an opaque origin and blocks them), and
// a single file is the only thing that survives being emailed, copied to a
// phone and opened three months later. So the modules stay real modules for the
// tests, and this script inlines them.
//
// Naive concatenation does not work — several files legitimately share top-level
// names (SLOT_SOURCE, SNACK_SPLIT, clone, round). So each module is wrapped in a
// function and wired through a five-line module loader, which keeps every file's
// scope its own. The transform is deliberately dumb and only understands the
// import/export forms actually used in src/, and it fails loudly on anything else.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { icon, ICONS } from './icons.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'src');
const OUT = path.join(root, 'dist', 'meal-planner.html');
const PWA = path.join(root, 'dist', 'pwa');

// Dependency order: a module may only import from ones earlier in this list.
const MODULES = ['clock.js', 'targets.js', 'recipes.js', 'seasons.js', 'planner.js', 'swap.js', 'shopping.js', 'store.js', 'remote.js', 'rest.js', 'household.js', 'cloud.js', 'sync.js', 'install.js', 'ui.js', 'app.js'];

const RE_IMPORT = /^import\s*\{([\s\S]*?)\}\s*from\s*'\.\/([\w.-]+)'\s*;?\s*$/gm;
const RE_ANY_IMPORT = /^\s*import\s/m;
const RE_EXPORT_DECL = /^export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm;
const RE_EXPORT_LIST = /^export\s*\{([^}]*)\}\s*;?\s*$/gm;
const RE_DEFAULT = /^export\s+default\s/m;

/** Rewrite one module body into `__def('name', fn)` form. */
function wrap(name, source) {
  if (RE_DEFAULT.test(source)) throw new Error(`${name}: default exports are not supported by the bundler`);

  const exported = new Set();
  for (const m of source.matchAll(RE_EXPORT_DECL)) exported.add(m[1]);
  for (const m of source.matchAll(RE_EXPORT_LIST)) {
    for (const part of m[1].split(',')) {
      const bare = part.trim();
      if (!bare) continue;
      if (/\sas\s/.test(bare)) throw new Error(`${name}: renamed exports are not supported ("${bare}")`);
      exported.add(bare);
    }
  }
  if (exported.size === 0) throw new Error(`${name}: nothing exported — it would be dead code in the bundle`);

  let body = source
    .replace(RE_IMPORT, (_, names, file) => {
      const clean = names.split(',').map((s) => s.trim()).filter(Boolean);
      for (const c of clean) if (/\sas\s/.test(c)) throw new Error(`${name}: renamed import "${c}" is not supported`);
      return `const { ${clean.join(', ')} } = __req(${JSON.stringify(file.replace(/\.js$/, ''))});`;
    })
    .replace(RE_EXPORT_LIST, '')
    .replace(/^export\s+/gm, '');

  // Anything left that looks like an import means the transform missed a form.
  if (RE_ANY_IMPORT.test(body)) {
    const line = body.split('\n').find((l) => /^\s*import\s/.test(l));
    throw new Error(`${name}: unsupported import form the bundler cannot rewrite:\n  ${line.trim()}`);
  }

  const returns = [...exported].map((n) => `    ${n},`).join('\n');
  return `__def(${JSON.stringify(name.replace(/\.js$/, ''))}, function (__req) {
${body.trimEnd()}
  return {
${returns}
  };
});`;
}

const LOADER = `(function () {
'use strict';
// Five-line module loader: each file keeps its own scope, so duplicate top-level
// names across modules cannot collide, and the require order is checked.
var __mods = {}, __cache = {};
function __def(name, fn) { __mods[name] = fn; }
function __req(name) {
  if (!(name in __cache)) {
    if (!__mods[name]) throw new Error('module not bundled: ' + name);
    __cache[name] = __mods[name](__req);
  }
  return __cache[name];
}
`;

const BOOT = `
// Boot. Anything that goes wrong here has to be visible on the page, because
// there is no console open on a phone in a supermarket.
try {
  var app = __req('app');
  app.createApp({ root: document.getElementById('app'), win: window });
} catch (err) {
  document.getElementById('app').innerHTML =
    '<div style="font:15px/1.6 system-ui;padding:2rem;color:#fca5a5;background:#1a1416;margin:1rem;border-radius:12px">'
    + '<h1 style="font-size:1.1rem;margin:0 0 .6rem">The planner could not start</h1>'
    + '<p style="color:#e7e3e0">This is a bug in the file, not something you did. The error was:</p>'
    + '<pre style="white-space:pre-wrap;color:#fca5a5">' + String(err && (err.stack || err.message || err)) + '</pre></div>';
  throw err;
}
})();
`;

const sources = new Map();
for (const file of MODULES) sources.set(file, await readFile(path.join(SRC, file), 'utf8'));

// Import graph check: a module importing a later one would be undefined at call time.
for (const [file, src] of sources) {
  for (const m of src.matchAll(RE_IMPORT)) {
    const dep = m[2];
    if (!sources.has(dep)) throw new Error(`${file} imports ${dep}, which is not in MODULES`);
    if (MODULES.indexOf(dep) > MODULES.indexOf(file)) {
      throw new Error(`${file} imports ${dep}, which is bundled later — fix the MODULES order`);
    }
  }
}

// ui.js legitimately contains the text "</script>" — it is the page shell — and
// the browser's HTML parser closes the script tag at that text wherever it sits,
// even inside a string. Escaping the slash is invisible to JS and keeps the tag.
const js = (LOADER + MODULES.map((f) => wrap(f, sources.get(f))).join('\n\n') + BOOT)
  .replace(/<\/(script)/gi, '<\\/$1');

// The shell and the stylesheet come from ui.js, so the tests and the page agree.
const { HTML_HEAD, CSS } = await import(new URL('../src/ui.js', import.meta.url));
for (const slot of ['__CSS__', '__JS__', '__HEAD__']) {
  if (!HTML_HEAD.includes(slot)) throw new Error(`ui.js HTML_HEAD lost its ${slot} placeholder`);
}

/**
 * The page, filled two ways.
 *
 * `extraHead` is the only difference between the two outputs. The portable file
 * gets nothing: opened from file:// it has no origin, so a manifest link is a
 * failed request and a service worker registration is a thrown exception. The
 * PWA shell gets the link tags and the registration. Same app in both.
 */
function shell(extraHead) {
  const html = HTML_HEAD
    .replace('__HEAD__', () => extraHead)
    .replace('__CSS__', () => CSS)
    .replace('__JS__', () => js);
  // The bundle's own `</script>` strings are escaped, so the only closing tags
  // left should be the ones this function put there. A surplus means an escape
  // was missed and the browser will end the script early.
  const expected = 1 + (extraHead.includes('<script') ? 1 : 0);
  const found = (html.match(/<\/script>/gi) ?? []).length;
  if (found !== expected) throw new Error(`${found} closing script tags, expected ${expected}`);
  return html;
}

/**
 * Write beside the target and move it into place.
 *
 * The test harness rebuilds on import and `node --test` runs files in parallel,
 * so several builds can be writing at once; without this they interleave into a
 * file that parses as nothing. A rename is all-or-nothing, so the worst case is
 * a redundant build rather than a corrupt app.
 */
async function put(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  // Windows refuses to rename over a file another process holds open, and the
  // harness has several builds racing several readers. The rename is still what
  // makes this all-or-nothing; it just has to wait its turn sometimes, and a
  // build that throws here fails a whole test file for no reason at all.
  for (let left = 20; ; left -= 1) {
    try {
      await rename(tmp, file);
      break;
    } catch (e) {
      if (left <= 0 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
      await new Promise((r) => { setTimeout(r, 25); });
    }
  }
  return data.length ?? Buffer.byteLength(data);
}

// --- Output 1: the one double-clickable file, unchanged.

const single = shell('');
await put(OUT, single);

// --- Output 2: the installable app.

// One source of truth for the launch colour. A standalone launch paints
// background_color before any JS runs, so if it disagrees with the stylesheet the
// app opens with a flash of the wrong colour.
const bg = CSS.match(/--bg:\s*(#[0-9a-f]{6})/i)?.[1];
if (!bg) throw new Error('could not read --bg out of the stylesheet');

const PWA_HEAD = `<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="theme-color" content="${bg}">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Meals">
<meta name="robots" content="noindex, nofollow">
<script>
// Registered from the page rather than the bundle, because this is the one thing
// the two builds cannot share: there is no origin to register against in a file
// opened from a Downloads folder. Failures are swallowed on purpose -- a browser
// with no service worker support still has a working app, just not an offline one.
if ('serviceWorker' in navigator) {
  addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () {});
    navigator.serviceWorker.addEventListener('message', function (e) {
      // Handed to the app as a DOM event so the bundle needs no knowledge of
      // service workers at all, and the portable build stays identical.
      if (e.data === 'update-ready') dispatchEvent(new CustomEvent('mp:update-ready'));
    });
  });
}
</script>
`;

const manifest = {
  name: 'Meal Planner',
  short_name: 'Meals',
  description: "The week's meals for two, with a shopping list that follows.",
  // Relative on purpose: an absolute "/" start_url silently escapes the scope on
  // a preview deploy or any path that is not the domain root.
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'portrait',
  background_color: bg,
  theme_color: bg,
  categories: ['food', 'health', 'lifestyle'],
  icons: ICONS.filter((i) => i.manifest !== false).map((i) => ({
    src: `icons/${i.file}`,
    sizes: `${i.size}x${i.size}`,
    type: 'image/png',
    purpose: i.purpose,
  })),
};

const pwaShell = shell(PWA_HEAD);
const assets = ['./', './index.html', './manifest.webmanifest',
  ...ICONS.map((i) => `./icons/${i.file}`)];

// The cache name has to change when, and only when, the app does -- too eager and
// every build re-downloads 450 kB onto a phone, too lazy and a fix never arrives.
// Hashing the shell and the asset list gets exactly that.
const swSource = await readFile(path.join(root, 'pwa', 'sw.js'), 'utf8');
const version = createHash('sha256')
  .update(pwaShell).update(JSON.stringify(assets)).update(swSource)
  .digest('hex').slice(0, 10);
const sw = swSource
  .replace('__CACHE__', () => `mealplanner-v1-${version}`)
  .replace('__ASSETS__', () => JSON.stringify(assets));
if (sw.includes('__CACHE__') || sw.includes('__ASSETS__')) {
  throw new Error('pwa/sw.js lost one of its __CACHE__/__ASSETS__ placeholders');
}

await put(path.join(PWA, 'index.html'), pwaShell);
await put(path.join(PWA, 'manifest.webmanifest'), `${JSON.stringify(manifest, null, 2)}
`);
await put(path.join(PWA, 'sw.js'), sw);

// The custom domain, copied rather than committed into dist/. GitHub Pages reads
// it out of the published tree, and a deploy replaces that tree wholesale -- so a
// CNAME that exists only in git un-points the domain on the next push and every
// phone gets a 404. Deliberately kept out of the cache-version hash above: it is
// not part of the app, and changing a domain should not re-download 450 kB.
await put(path.join(PWA, 'CNAME'), await readFile(path.join(root, 'pwa', 'CNAME'), 'utf8'));
await put(path.join(PWA, 'robots.txt'), await readFile(path.join(root, 'pwa', 'robots.txt'), 'utf8'));
for (const i of ICONS) await put(path.join(PWA, 'icons', i.file), icon(i.size, i.opts));

const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
console.log(`built ${path.relative(root, OUT)} - ${kb(Buffer.byteLength(single))}, `
  + `${MODULES.length} modules inlined`);
console.log(`built ${path.relative(root, PWA)}/ - shell, manifest, sw (${version}), `
  + `${ICONS.length} icons, CNAME, robots`);
