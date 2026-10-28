// What the build has to emit for the app to install on a phone.
//
// This file reads `dist/` the way a browser does: parse the manifest as JSON,
// parse the service worker as JavaScript, check the PNGs are PNGs. None of it
// trusts the build's own report that it wrote something.
//
// The one thing it guards hardest is that the single portable file did not
// change. `dist/meal-planner.html` is opened from a USB stick and a Downloads
// folder with no origin at all, where a manifest link is noise and a service
// worker registration is a thrown exception. Two outputs, two shapes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [path.join(root, 'tools', 'build.mjs')], { cwd: root, stdio: 'pipe' });

const dist = (...p) => path.join(root, 'dist', ...p);
const read = (...p) => readFileSync(dist(...p), 'utf8');
const bytes = (...p) => readFileSync(dist(...p));

const SINGLE = read('meal-planner.html');
const SHELL = read('pwa', 'index.html');
const MANIFEST = JSON.parse(read('pwa', 'manifest.webmanifest'));
const SW = read('pwa', 'sw.js');

// --- The manifest, read as a browser reads it.

test('the manifest is JSON a browser will accept', () => {
  // Parsed at import, so reaching here means it parsed. What is checked here is
  // the set of fields without which Chrome refuses to offer an install at all.
  for (const key of ['name', 'short_name', 'start_url', 'scope', 'display', 'icons']) {
    assert.ok(MANIFEST[key], `manifest has no ${key}`);
  }
  assert.equal(MANIFEST.display, 'standalone', 'it has to launch without browser chrome');
  assert.ok(MANIFEST.short_name.length <= 12,
    `short_name "${MANIFEST.short_name}" will be truncated under a home-screen icon`);
});

test('the manifest paths are relative, so the app works on any path', () => {
  // The app sits at a domain root now, but the portable file does not sit
  // anywhere at all, and a preview deploy sits on a subpath. An absolute "/"
  // start_url silently escapes the scope in both.
  for (const key of ['start_url', 'scope']) {
    assert.ok(!MANIFEST[key].startsWith('/'),
      `${key} is absolute ("${MANIFEST[key]}") and will break on a subpath`);
  }
  for (const icon of MANIFEST.icons) {
    assert.ok(!icon.src.startsWith('/'), `icon src is absolute: ${icon.src}`);
  }
});

test('the manifest colours match the app, so there is no flash on launch', () => {
  // A standalone launch paints background_color before any JS runs. If it does
  // not match the stylesheet the app opens with a flash of the wrong colour.
  const bg = readFileSync(path.join(root, 'src', 'ui.js'), 'utf8')
    .match(/--bg:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.ok(bg, 'could not find --bg in ui.js');
  assert.equal(MANIFEST.background_color.toLowerCase(), bg.toLowerCase());
  assert.equal(MANIFEST.theme_color.toLowerCase(), bg.toLowerCase());
});

test('every icon the manifest promises is really there, and is really a PNG', () => {
  for (const icon of MANIFEST.icons) {
    const file = path.join('pwa', ...icon.src.split('/'));
    assert.ok(existsSync(dist(file)), `manifest promises ${icon.src} and the build did not write it`);
    const buf = bytes(file);
    // PNG signature, then the IHDR width/height as big-endian 32-bit ints.
    assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10],
      `${icon.src} is not a PNG`);
    const [w, h] = [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    assert.equal(`${w}x${h}`, icon.sizes, `${icon.src} says ${icon.sizes} and is ${w}x${h}`);
  }
});

test('there is a maskable icon, or Android crops the corners off', () => {
  const maskable = MANIFEST.icons.filter((i) => (i.purpose ?? '').split(/\s+/).includes('maskable'));
  assert.ok(maskable.length, 'no maskable icon: Android will put the square one in a circle');
  assert.ok(maskable.some((i) => i.sizes === '512x512'), 'the maskable icon should be 512');
});

test('iOS gets an apple-touch-icon, because it ignores the manifest', () => {
  // Safari reads neither `icons` nor `theme_color`. Without this tag the home
  // screen gets a blurry screenshot of the page instead of an icon.
  assert.match(SHELL, /<link rel="apple-touch-icon"[^>]*href="([^"]+)"/);
  const href = SHELL.match(/<link rel="apple-touch-icon"[^>]*href="([^"]+)"/)[1];
  assert.ok(existsSync(dist('pwa', ...href.split('/'))), `apple-touch-icon ${href} was not written`);
});

// --- The host.

test('the custom domain ships in the artefact, or the domain stops resolving', () => {
  // GitHub Pages reads CNAME out of the published tree, not out of the
  // repository, and a deploy replaces that tree wholesale. If the build ever
  // stops copying it, the next push silently un-points the domain and every
  // phone with the app installed gets a 404 from an address that worked
  // yesterday. Nothing else would catch that before a person did.
  assert.ok(existsSync(dist('pwa', 'CNAME')), 'the build did not write dist/pwa/CNAME');
  const raw = read('pwa', 'CNAME');
  const domain = raw.trim();
  assert.equal(domain, readFileSync(path.join(root, 'pwa', 'CNAME'), 'utf8').trim(),
    'dist/pwa/CNAME disagrees with pwa/CNAME, so the build is not copying the source of truth');
  // Pages wants one bare hostname. A scheme, a path, or a second line is not an
  // error you see -- the custom domain setting is just dropped.
  assert.equal(raw, `${domain}\n`, `CNAME should be one bare hostname and a newline, got ${JSON.stringify(raw)}`);
  assert.match(domain, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/,
    `CNAME should be a bare hostname, got "${domain}"`);
});

// --- The service worker.

test('the service worker is syntactically valid JavaScript', () => {
  // A syntax error here is invisible: registration fails quietly and the app
  // simply never works offline, which is not something you notice until a shop.
  assert.doesNotThrow(() => new Function(SW), 'sw.js does not parse');
});

test('the service worker handles install, activate and fetch', () => {
  for (const ev of ['install', 'activate', 'fetch']) {
    assert.match(SW, new RegExp(`addEventListener\\(\\s*'${ev}'`), `sw.js never listens for ${ev}`);
  }
});

test('the cache name carries a version the build stamps in', () => {
  // Without a version the old shell is served forever and a fix never reaches
  // the phone. The build writes the current one, and activate deletes the rest.
  const name = SW.match(/const CACHE = '([^']+)'/)?.[1];
  assert.ok(name, 'sw.js has no CACHE constant for the build to stamp');
  assert.ok(/\d/.test(name), `cache name "${name}" has no version in it`);
  assert.match(SW, /caches\.delete/, 'activate never deletes an old cache');
});

test('the service worker only ever answers same-origin GETs', () => {
  // This is the guard that keeps Supabase working later. A cache that answers a
  // POST, or anything cross-origin, will at best break sign-in and at worst hand
  // back yesterday's plan as though it were today's.
  assert.match(SW, /method\s*!==\s*'GET'/, 'sw.js does not skip non-GET requests');
  assert.match(SW, /origin\s*!==\s*(?:self\.)?location\.origin/,
    'sw.js does not skip cross-origin requests');
});

test('the shell registers the service worker; the portable file does not', () => {
  assert.match(SHELL, /serviceWorker\.register\(/, 'the PWA shell never registers a service worker');
  // `.register(`, not the word "serviceWorker": the app itself mentions
  // navigator.serviceWorker to hand the waiting worker a skip-waiting message, and
  // that is in the shared bundle. Registering is the part that cannot work from a
  // file:// page -- there is no origin to scope a worker to, and the call throws.
  assert.ok(!/serviceWorker\.register\(/.test(SINGLE),
    'the portable file tries to register a service worker, which cannot work from file://');
  // Whatever it does say about service workers has to survive their absence,
  // because from a file:// page navigator.serviceWorker is undefined.
  for (const m of SINGLE.matchAll(/navigator\.serviceWorker(.)/g)) {
    assert.equal(m[1], '?', 'the portable file reads navigator.serviceWorker without a guard');
  }
});

// --- The portable single file is not allowed to change shape.

test('the portable file stays one self-contained file', () => {
  assert.ok(!/<link\b/i.test(SINGLE), 'the portable file links to something it cannot fetch');
  assert.equal((SINGLE.match(/<\/script>/gi) ?? []).length, 1);
  assert.ok(!/manifest/i.test(SINGLE), 'the portable file references a manifest it has no origin for');
});

test('both outputs are built from the same app', () => {
  // The shell and the single file differ only in the head. If the bundled app
  // itself ever diverges, one of the two is being built from something stale.
  // The app bundle is the last script in both files -- the shell has the service
  // worker registration ahead of it in the head, which is exactly the difference
  // this test is allowing for.
  const appOf = (html) => html.slice(html.lastIndexOf('<script>'), html.lastIndexOf('</script>'));
  assert.equal(appOf(SHELL), appOf(SINGLE), 'the two builds contain different app code');
});
