// Matchday XI service worker — deliberately minimal. This app's data (fixtures, locks, scores)
// changes in real time, so we do NOT cache-first any page or API response: that would risk
// showing a user a stale "still open" prediction after it's actually locked. All this SW does is
// (a) make the app installable/full-screen and (b) show a friendly offline page instead of the
// browser's default error when there's no network at all.

const CACHE_NAME = "matchday-xi-shell-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([OFFLINE_URL])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("push", (event) => {
  let payload = { title: "Matchday XI", body: "", url: "/" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // malformed/empty payload — fall back to the defaults above rather than dropping the push
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      // A rejected/undefined result here leaves respondWith with nothing to render, and the
      // browser falls back to its own generic native error screen instead of our offline page —
      // exactly the failure this whole handler exists to prevent. Every branch below must resolve
      // to a real Response no matter what goes wrong internally.
      try {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(OFFLINE_URL);
        if (cached) return cached;
      } catch {
        // fall through to the inline fallback below
      }
      return new Response(
        "<!doctype html><html><body style=\"background:#0B1F17;color:#F5F3EC;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:24px\"><div><p style=\"font-size:18px;font-weight:600\">No signal at the ground</p><p style=\"opacity:.7\">Check your connection and try again.</p></div></body></html>",
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }),
  );
});
