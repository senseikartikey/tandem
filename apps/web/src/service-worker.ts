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
// `build`/`files` cover the JS/CSS bundle and static assets, but neither
// includes the actual HTML document -- without "/" here, the fetch
// handler's own offline fallback (caches.match("/") below) always misses,
// which is exactly what makes the very first offline navigation fail.
const PRECACHE_URLS = [...build, ...files, "/"];

// Everything in `build` is content-hashed by Vite, so a given URL's bytes
// can never change -- those are safe to serve from cache forever. The HTML
// document is the opposite: its URL is stable while its contents change on
// every deploy, and it's what names the hashed bundles to load.
const IMMUTABLE = new Set(build);

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

async function cacheFirst(request: Request): Promise<Response> {
	const cached = await caches.match(request);
	return cached ?? fetch(request);
}

// Network-first, falling back to whatever was cached, then to the shell.
// The document MUST be fetched before the cache is consulted: serving a
// stale HTML shell hands the browser a list of bundle URLs from an older
// deploy, which are themselves still cached -- so a device that had ever
// loaded the app would keep booting the old build indefinitely, no matter
// how many times it was reloaded or how many new versions shipped.
async function networkFirst(request: Request): Promise<Response> {
	try {
		const response = await fetch(request);
		if (response.ok && request.mode === "navigate") {
			const cache = await caches.open(CACHE_NAME);
			// Cache under "/" (not the visited path) so the single shell entry
			// keeps serving every client-routed URL while offline.
			await cache.put("/", response.clone());
		}
		return response;
	} catch {
		const cached = await caches.match(request);
		if (cached) return cached;
		const shell = await caches.match("/");
		if (shell) return shell;
		throw new Error("offline and no cached shell available");
	}
}

self.addEventListener("fetch", (event) => {
	if (event.request.method !== "GET") return;

	const url = new URL(event.request.url);

	// Cross-origin traffic is none of this worker's business, and handling it
	// actively breaks things: the sync server's websocket upgrade, and the
	// speech model's large ranged downloads from the model host, both go
	// through here otherwise. Returning without calling respondWith leaves
	// them entirely to the browser.
	if (url.origin !== self.location.origin) return;

	event.respondWith(
		IMMUTABLE.has(url.pathname) ? cacheFirst(event.request) : networkFirst(event.request),
	);
});
