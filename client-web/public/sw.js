// Minimal service worker — gives us "installable" PWA + an offline fallback +
// Web Push delivery.
//
// Strategy:
//   - Static Next.js assets (/_next/static/*) → cache-first.
//   - Navigation requests → network-first with the cached shell as fallback.
//   - Everything else → network-only (no caching of API calls; we never want
//     stale attendance data and the backend is the source of truth).
//
// Push:
//   - Backend posts a JSON envelope `{title, body, data:{id, category, ...}}`.
//   - We render a notification and on click open the relevant in-app route.
//
// We bump CACHE_NAME on every meaningful change so old assets are evicted.

const CACHE_NAME = "wtp-client-v2";
const APP_SHELL = ["/", "/today", "/profile", "/login"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(APP_SHELL).catch(() => null))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never cache API or websocket calls — attendance state must be live.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/")) {
    return;
  }

  // Static Next.js bundle: cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached ||
        fetch(req).then((resp) => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          return resp;
        })
      )
    );
    return;
  }

  // Navigation: network-first with cached shell fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match(req).then((m) => m || caches.match("/")))
    );
    return;
  }

  // Default: try network, fall back to cache (e.g. icons / manifest).
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});

// ---------- Push -----------------------------------------------------------

const CATEGORY_ROUTE = {
  ATTENDANCE: "/today",
  SALARY: "/salary",
  KPI: "/kpi",
  LEAVE: "/leaves",
  DEVICE: "/notifications",
  ANOMALY: "/notifications",
  SYSTEM: "/notifications",
};

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Hr-Profi", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Hr-Profi";
  const body = data.body || "";
  const payload = data.data || {};
  const category = payload.category || "SYSTEM";
  const url = CATEGORY_ROUTE[category] || "/notifications";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { url, ...payload },
      tag: payload.id || undefined,
    })
  );
});

// ---------- Background Sync (offline check-in queue) ---------------------
//
// We don't replay the queue from inside the SW — the access token lives in
// the page's localStorage and isn't accessible here. Instead, when the OS
// fires the sync we wake any open client and ask it to flush. If no client
// is open, the sync is a no-op (and the page-side `online` listener will
// flush the next time the user opens the app).

self.addEventListener("sync", (event) => {
  if (event.tag !== "wtp-checkin-flush") return;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => {
        for (const w of wins) {
          w.postMessage({ type: "wtp.flush-queue" });
        }
      })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes(target) && "focus" in w) return w.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
