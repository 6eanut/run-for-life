const CACHE = __VERSION__;
const SHELL = __SHELL__;
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    let cache;
    try { cache = await caches.open(CACHE); } catch { return; }
    // Keep the old worker active if a new offline shell could not download.
    await cache.addAll(SHELL);
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    let ready = false;
    try { ready = !!await (await caches.open(CACHE)).match('./index.html', { ignoreVary: true }); } catch { /* Keep prior caches. */ }
    if (ready) {
      const keys = await caches.keys().catch(() => []);
      await Promise.all(keys.filter(key => key.startsWith('run-for-life-') && key !== CACHE).map(key => caches.delete(key).catch(() => false)));
    }
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    let cache;
    try { cache = await caches.open(CACHE); } catch { /* Storage is optional for online use. */ }
    // HTML must be fresh online. Hashed static resources remain cache-first.
    if (event.request.mode !== 'navigate' && cache) {
      try {
        const cached = await cache.match(event.request, { ignoreVary: true });
        if (cached) return cached;
      } catch { /* A denied cache must not discard a successful network response. */ }
    }
    try {
      const response = await fetch(event.request);
      if (response.ok && cache) {
        const copy = response.clone();
        event.waitUntil(Promise.resolve().then(() => cache.put(event.request, copy)).catch(() => {}));
      }
      return response;
    } catch {
      if (event.request.mode === 'navigate' && cache) {
        try {
          const shell = await cache.match('./index.html', { ignoreVary: true });
          if (shell) return shell;
        } catch { /* No usable offline shell. */ }
      }
      return Response.error();
    }
  })());
});
