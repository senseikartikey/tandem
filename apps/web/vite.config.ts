import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
			},
			// Static SPA build: no server, works entirely client-side (required --
			// the whole point of the app is that it works with zero network, which
			// is incompatible with SSR). `fallback: index.html` gives client-side
			// routing a single entry point Capacitor and any static host can serve.
			adapter: adapter({ fallback: "index.html" }),
			// SvelteKit's native service worker support (no third-party PWA
			// plugin needed): src/service-worker.ts is compiled and registered
			// automatically. See that file for why a custom worker instead of a
			// generated one.
			files: { serviceWorker: "src/service-worker.ts" },
		}),
	],
});
