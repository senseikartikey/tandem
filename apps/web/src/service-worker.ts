/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
// SvelteKit's native service worker support -- no third-party PWA plugin
// needed. `build`/`files`/`version` come from SvelteKit itself and always
// match what was actually built, so there's no separate manifest-generation
// step to keep in sync. The only job here is precaching the app shell so
// the app can boot with zero network -- reads/writes never go through this
// worker, they go straight to the in-memory Y.Doc, persisted via
// y-indexeddb (see src/lib/sync/provider.ts). Offline-first is a data-
// architecture property, not a caching strategy.

import { build, files, version } from "$service-worker";

declare let self: ServiceWorkerGlobalScope;

const CACHE_NAME = `tandem-shell-${version}`;
const PRECACHE_URLS = [...build, ...files];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE_URLS);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      try {
        return await fetch(event.request);
      } catch {
        // Offline and not precached (e.g. a route visited for the first
        // time) -- fall back to the shell so client-side routing can still
        // render the app rather than showing the browser's offline page.
        const shell = await caches.match("/");
        if (shell) return shell;
        throw new Error("offline and no cached shell available");
      }
    })(),
  );
});
