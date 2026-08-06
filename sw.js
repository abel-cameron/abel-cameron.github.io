// CABEL service worker.
//
// Deliberately conservative. Pages are network-first, so a deploy is picked up
// on the next load and the worker can never serve a stale build. Hashed assets
// under /assets/ are cache-first, which is safe because their filenames change
// whenever their contents do. Anything cross-origin -- notably every Supabase
// auth and REST call -- is passed straight through and never touched.
//
// Bump VERSION to evict every cache on the next activation.

const VERSION = "v1";
const PAGES = `cabel-pages-${VERSION}`;
const ASSETS = `cabel-assets-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const KEEP = [PAGES, ASSETS];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      // cache: "reload" bypasses the HTTP cache so we store what's actually
      // deployed, not whatever the browser happens to be holding.
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase: always live

  // Pages: network-first, fall back to the last good copy, then the notice.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(PAGES).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => (await caches.match(request)) ?? caches.match(OFFLINE_URL)),
    );
    return;
  }

  // Fingerprinted build output: cache-first, it can't go stale.
  if (url.pathname.includes("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(ASSETS).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
