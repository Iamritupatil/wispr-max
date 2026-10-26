// Wispr Max service worker. The build stamps a version below, so every deploy
// is a new worker; it waits until the app's Update button says to take over.
const VERSION = "__BUILD__";
const CACHE = `wispr-max-${VERSION}`;
const SHELL = ["/", "/web.js", "/app.css", "/web.css", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("wispr-max-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Writing always goes to the server; other sites aren't ours to cache.
  if (event.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // This version's files, so the page and its script always match; the
  // network only for anything the shell doesn't have.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const path = event.request.mode === "navigate" ? "/" : url.pathname;
      const hit = await cache.match(path);
      if (hit) return hit;
      try {
        return await fetch(event.request);
      } catch {
        return (await cache.match("/")) ?? Response.error();
      }
    }),
  );
});
