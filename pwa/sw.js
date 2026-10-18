// The service worker: what makes the app open in a supermarket with no signal.
//
// Not part of the bundle, and it cannot be -- a service worker runs in its own
// global with no DOM, and the browser has to be able to fetch it as a separate
// file at a stable URL. So it stays hand-written, and `tools/build.mjs` stamps
// the two values that change per build: the cache name and the asset list.
//
// Strategy: cache-first, then revalidate in the background. A cold start never
// waits on the network, which is the whole point, and a new version is picked up
// on the next launch rather than being missed forever. The page is told when a
// new shell has landed so it can offer a reload instead of swapping the app out
// from under someone mid-edit.

const CACHE = '__CACHE__';
const ASSETS = __ASSETS__;

self.addEventListener('install', (event) => {
  // Everything or nothing: a half-populated cache is an app that launches to a
  // broken page offline, which is worse than one that admits it needs a network.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop every cache but this build's. Without this the old shell is served
    // forever and a fix never reaches the phone.
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    // Take over tabs that were already open, so the first launch after an
    // install is already being served by this worker.
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only ever answer same-origin GETs.
  //
  // This is the guard that keeps the backend working. Supabase is a different
  // origin and its calls are mostly POSTs; a cache that answered them would at
  // best break sign-in and at worst hand back yesterday's plan as though it were
  // today's. Letting them fall through to the network is not an optimisation
  // skipped, it is the correct behaviour.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });

    // Revalidate whether or not there was a hit, but never block on it.
    const fresh = fetch(request)
      .then(async (res) => {
        if (res && res.ok && res.type === 'basic') {
          await cache.put(request, res.clone());
          if (cached && await changed(cached, res)) announce();
        }
        return res;
      })
      .catch(() => null);

    if (cached) return cached;
    const res = await fresh;
    if (res) return res;

    // Offline and never cached. For a navigation this is still recoverable --
    // the shell is the whole app, so any page can be served from it.
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html', { ignoreSearch: true });
      if (shell) return shell;
    }
    return new Response('Offline, and this was never cached.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  })());
});

self.addEventListener('message', (event) => {
  // The page asking to be updated now. Deliberately not done automatically:
  // replacing the app while someone is part-way through editing a week loses the
  // edit, so the decision belongs to whoever is holding the phone.
  if (event.data === 'skip-waiting') self.skipWaiting();
});

/** Whether a revalidated response actually differs from the cached one. */
async function changed(cached, fresh) {
  const [a, b] = await Promise.all([cached.clone().text(), fresh.clone().text()]);
  return a !== b;
}

/** Tell every open tab that a newer version is sitting in the cache. */
async function announce() {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) client.postMessage('update-ready');
}
