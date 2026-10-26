// PlayCode service worker: shows push notifications and opens the app when one
// is tapped, and keeps the offline practice page working with no connection.
//
// Caching is deliberately narrow: build assets (content-hashed, so a cached copy
// is always right) and the /offline page itself. Every other page and all API
// calls go to the network; a page that can't load offline sends the student to
// /offline, where their downloaded pack lives.
const CACHE = "playcode-offline-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/offline", "/icon.svg"])).catch(() => {}));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("playcode-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }
  if (req.mode !== "navigate") return;
  if (url.pathname === "/offline") {
    // Fresh when online (and refresh the copy), the saved copy when not.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put("/offline", res.clone()));
          return res;
        })
        .catch(() => caches.match("/offline").then((hit) => hit || Response.error())),
    );
    return;
  }
  event.respondWith(fetch(req).catch(() => caches.match("/offline").then((hit) => (hit ? Response.redirect("/offline", 302) : Response.error()))));
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "PlayCode", {
      body: data.body || "",
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { link: data.link || "/play" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.link || "/play", self.location.origin);
  // Only ever open pages of this app.
  const target = url.origin === self.location.origin ? url.pathname + url.search : "/play";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client && "navigate" in client) return client.navigate(target).then((c) => (c || client).focus());
      }
      return self.clients.openWindow(target);
    }),
  );
});
