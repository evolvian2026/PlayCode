// PlayCode service worker: shows push notifications and opens the app when one is tapped.
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
