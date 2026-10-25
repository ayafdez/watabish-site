// Cat map offline support (makes the map installable). Bump VERSION whenever you upload a new index.html.
const VERSION = "catmap-v1";
const SHELL = ["./", "index.html", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("catmap-") && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  // never cache accounts, posts, photos, map tiles or address search: they must always be fresh
  if (url.hostname.endsWith("supabase.co") || url.hostname.endsWith("openstreetmap.org")) return;
  const cacheable = (url.origin === location.origin && url.pathname.startsWith("/map/")) ||
    /fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/.test(url.hostname);
  if (!cacheable) return;
  // the page: network first so updates show up, cached copy only when offline
  if (req.mode === "navigate") {
    e.respondWith(fetch(req)
      .then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return r; })
      .catch(() => caches.match(req).then((r) => r || caches.match("index.html"))));
    return;
  }
  // fonts and libraries: from cache, refreshed in the background
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((r) => {
      if (r.ok || r.type === "opaque") { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return r;
    }).catch(() => hit);
    return hit || net;
  }));
});
