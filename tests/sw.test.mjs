// The service worker, driven the way a browser drives it.
//
// tests/pwa.test.mjs checks the build emitted a worker that parses. This file
// checks it *behaves*: that a cold start offline serves the app, that a new build
// is noticed, and above all that it keeps its hands off the backend. A worker
// that answers a Supabase POST out of a cache would hand back yesterday's plan as
// though it were today's, and nothing on the page could tell.
//
// It runs the real `dist/pwa/sw.js` inside a stub global, because the alternative
// is a browser -- and the one thing a service worker cannot be tested in is the
// thing it runs in without a lot of ceremony.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [path.join(root, 'tools', 'build.mjs')], { cwd: root, stdio: 'pipe' });
const SOURCE = readFileSync(path.join(root, 'dist', 'pwa', 'sw.js'), 'utf8');

const ORIGIN = 'https://meals.example';

/** Just enough of Response: a body, the three fields the worker reads, and clone(). */
function res(body, { ok = true, type = 'basic', status = 200 } = {}) {
  return {
    ok, type, status, body,
    clone() { return res(body, { ok, type, status }); },
    text: async () => body,
  };
}

/** A CacheStorage that is a Map of Maps, keyed by URL with the query dropped. */
function cacheStorage() {
  const stores = new Map();
  const key = (r) => (typeof r === 'string' ? new URL(r, `${ORIGIN}/pwa/`).href : r.url).split('?')[0];
  const make = () => {
    const entries = new Map();
    return {
      entries,
      addAll: async (urls) => {
        for (const u of urls) entries.set(key(u), res(`asset:${u}`));
      },
      match: async (r) => entries.get(key(r)),
      put: async (r, v) => { entries.set(key(r), v); },
    };
  };
  return {
    stores,
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, make());
      return stores.get(name);
    },
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
  };
}

/**
 * Load the worker into a fresh stub global and hand back the levers.
 *
 * `network` stands in for fetch: return a response, or throw to be offline.
 */
function load({ network = async () => { throw new Error('offline'); } } = {}) {
  const listeners = {};
  const posted = [];
  const caches = cacheStorage();
  const state = { skipWaiting: 0, claimed: 0, requests: [] };

  const self = {
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    location: { origin: ORIGIN },
    skipWaiting: () => { state.skipWaiting++; },
    clients: {
      claim: async () => { state.claimed++; },
      matchAll: async () => [{ postMessage: (m) => posted.push(m) }],
    },
  };
  const fetchImpl = async (r) => { state.requests.push(r.url ?? r); return network(r); };

  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Response', SOURCE)(self, caches, fetchImpl, res);

  /** Fire an event and wait on whatever the handler passed to waitUntil/respondWith. */
  const fire = async (type, extra = {}) => {
    const waits = [];
    let answer;
    const event = {
      ...extra,
      waitUntil: (p) => waits.push(p),
      respondWith: (p) => { answer = p; },
    };
    for (const fn of listeners[type] ?? []) fn(event);
    await Promise.all(waits);
    return answer ? await answer : undefined;
  };

  const request = (url, { method = 'GET', mode = 'no-cors' } = {}) => ({
    url: new URL(url, `${ORIGIN}/pwa/`).href, method, mode,
  });

  return { fire, request, caches, posted, state, listeners };
}

/** The one cache the current build uses. */
const liveCache = (sw) => [...sw.caches.stores.keys()].find((n) => n.startsWith('mealplanner'));

test('installing fills the cache with the whole app, or nothing', async () => {
  const sw = load();
  await sw.fire('install');
  const cache = sw.caches.stores.get(liveCache(sw));
  assert.ok(cache, 'install opened no cache');
  // A half-populated cache is an app that launches to a broken page offline,
  // which is worse than one that admits it needs a network.
  const urls = [...cache.entries.keys()];
  assert.ok(urls.some((u) => u.endsWith('/pwa/index.html')), 'the shell itself was not cached');
  assert.ok(urls.some((u) => u.endsWith('/pwa/manifest.webmanifest')), 'the manifest was not cached');
  assert.ok(urls.filter((u) => u.endsWith('.png')).length >= 3, 'the icons were not cached');
});

test('activating drops every cache but this build and takes over open tabs', async () => {
  const sw = load();
  await sw.fire('install');
  const live = liveCache(sw);
  // A previous build's cache, which is what keeps serving the old app for ever.
  await sw.caches.open('mealplanner-v1-older');

  await sw.fire('activate');
  assert.deepEqual(await sw.caches.keys(), [live], 'an old cache survived activation');
  assert.equal(sw.state.claimed, 1, 'tabs already open are still on the old worker');
});

test('a cold start with no network still serves the app', async () => {
  // The whole point. She opens it in Rewe in the basement and it works.
  const sw = load();
  await sw.fire('install');
  const answer = await sw.fire('fetch', { request: sw.request('./index.html') });
  assert.ok(answer, 'the worker did not answer at all');
  assert.match(await answer.text(), /^asset:/, 'the answer did not come from the cache');
});

test('a deep link offline falls back to the shell, because the shell is the app', async () => {
  const sw = load();
  await sw.fire('install');
  const answer = await sw.fire('fetch', {
    request: sw.request('./shopping', { mode: 'navigate' }),
  });
  assert.equal(answer.status, 200, `a navigation got ${answer.status} offline`);
  assert.match(await answer.text(), /index\.html/, 'the fallback was not the shell');
});

test('something never cached, offline, says so rather than hanging', async () => {
  const sw = load();
  await sw.fire('install');
  const answer = await sw.fire('fetch', { request: sw.request('./nope.png') });
  assert.equal(answer.status, 503);
});

// --- The guard that keeps the backend working.

test('the worker never answers a cross-origin request', async () => {
  // Supabase is a different origin. Caching it would at best break sign-in.
  const sw = load({ network: async () => res('{"from":"supabase"}') });
  await sw.fire('install');
  const answer = await sw.fire('fetch', {
    request: { url: 'https://xtcjakhoeehmrzdtzcvr.supabase.co/rest/v1/household_state', method: 'GET', mode: 'cors' },
  });
  assert.equal(answer, undefined, 'the worker took over a Supabase request');
});

test('the worker never answers a POST, even its own', async () => {
  // Every write to the backend is a POST or a PATCH. A cached one is a lost edit.
  const sw = load({ network: async () => res('ok') });
  await sw.fire('install');
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const answer = await sw.fire('fetch', { request: sw.request('./index.html', { method }) });
    assert.equal(answer, undefined, `the worker took over a ${method}`);
  }
});

// --- Noticing a new build.

test('a changed asset is cached and the page is told, once', async () => {
  const sw = load({ network: async () => res('asset:./index.html v2') });
  await sw.fire('install');
  await sw.fire('fetch', { request: sw.request('./index.html') });
  // The revalidation is deliberately not awaited by the response, so give the
  // background promise a turn before reading what it did.
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(sw.posted, ['update-ready'], `announced ${JSON.stringify(sw.posted)}`);
  const cache = sw.caches.stores.get(liveCache(sw));
  assert.equal(await (await cache.match('./index.html')).text(), 'asset:./index.html v2',
    'the new version was announced but never stored');
});

test('an unchanged asset is revalidated quietly', async () => {
  // Otherwise every launch claims an update and the notice means nothing.
  const sw = load({ network: async () => res('asset:./index.html') });
  await sw.fire('install');
  await sw.fire('fetch', { request: sw.request('./index.html') });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sw.posted, [], 'cried update over an identical file');
});

test('a cache hit is served without waiting for the network', async () => {
  let settle;
  const sw = load({ network: () => new Promise((r) => { settle = r; }) });
  await sw.fire('install');
  // The fetch never resolves. If the worker awaited it this would hang the test
  // out, which is exactly what it would do to the app on a bad connection.
  const answer = await sw.fire('fetch', { request: sw.request('./index.html') });
  assert.match(await answer.text(), /^asset:/);
  settle(res('asset:./index.html'));
});

test('the page can tell a waiting worker to take over', async () => {
  // Not automatic: swapping the app out mid-edit loses the edit, so the page asks
  // first and only sends this once someone has pressed Reload.
  const sw = load();
  await sw.fire('message', { data: 'skip-waiting' });
  assert.equal(sw.state.skipWaiting, 1);
  await sw.fire('message', { data: 'something-else' });
  assert.equal(sw.state.skipWaiting, 1, 'any old message activates the new worker');
});
