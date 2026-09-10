import { defineConfig } from "vitest/config";

// Deliberately does NOT reuse vite.config.ts. Vitest runs its own bundled
// Vite, which is a major version behind the one this app builds with, and
// the SvelteKit plugin written against the newer one crashes on startup
// under the older server API. Nothing under test here needs the SvelteKit
// pipeline -- these are pure-TypeScript units (transcript parsing, invite
// links) whose whole point is being testable without a browser, a model, or
// a component tree. Anything that genuinely needs Svelte compilation
// belongs in a browser-level test instead, not in this runner.
export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
