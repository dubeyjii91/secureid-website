const SHELL_CACHE = "secureid-shell-v2";
const ASSET_CACHE = "secureid-assets-v2";
const PRIVATE_PATHS = ["/api/", "/share/", "/document-share/"];
const STATIC_PATHS = ["/secureid-app-icon.svg", "/secureid-welcome.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.add("/"))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("secureid-") && ![SHELL_CACHE, ASSET_CACHE].includes(key))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (PRIVATE_PATHS.some((prefix) => url.pathname.startsWith(prefix))) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok && (response.headers.get("content-type") || "").includes("text/html")) {
          caches.open(SHELL_CACHE).then((cache) => cache.put("/", response.clone())).catch(() => {});
        }
        return response;
      }).catch(async () => {
        const shell = await caches.match("/");
        return shell || new Response(
          "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>SecureID offline</title><body style=\"font:16px system-ui;background:#070b14;color:#f8fafc;padding:2rem\"><h1>SecureID is offline</h1><p>Reconnect to the internet to access your account and documents. SecureID never stores account or document API responses for offline access.</p></body></html>",
          { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
        );
      })
    );
    return;
  }

  const isStaticAsset = url.pathname.startsWith("/assets/") || STATIC_PATHS.includes(url.pathname);
  if (!isStaticAsset) return;
  event.respondWith(
    caches.open(ASSET_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") cache.put(request, response.clone()).catch(() => {});
      return response;
    })
  );
});
