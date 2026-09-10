<script lang="ts">
	import "../app.css";
	import { page } from "$app/state";

	let { children } = $props();

	// The landing page is a yellow poster; every app view sits on cream. The
	// browser paints the area *outside* the document with the <html>
	// background -- the overscroll gap, and on iOS the strip behind the status
	// bar -- so if it doesn't follow the route, the phone's top bar shows the
	// wrong yellow above a page that has already switched. theme-color moves
	// with it for the same reason on Android/Chrome.
	let surface = $derived(page.url.pathname === "/" ? "poster" : "app");

	$effect(() => {
		document.documentElement.dataset.surface = surface;
		document
			.querySelector('meta[name="theme-color"]')
			?.setAttribute("content", surface === "poster" ? "#ffe566" : "#fafadf");
	});
</script>

{@render children()}
