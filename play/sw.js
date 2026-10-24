// Watabish offline support. Bump VERSION whenever you upload a new index.html.
const VERSION = "watabish-v15";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "memes/scream.jpg", "memes/fangs.jpg", "memes/sideeye.jpg", "memes/gasp.jpg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  // never cache account traffic
  if (url.hostname.endsWith("supabase.co")) return;
  const cacheable = url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(url.hostname);
  if (!cacheable) return;
  // pages: network first so updates show up, cache as backup when offline
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return r; }).catch(() => caches.match(req).then(r => r || caches.match("index.html"))));
    return;
  }
  // everything else: serve from cache, refresh in the background
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r.ok || r.type === "opaque") { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
