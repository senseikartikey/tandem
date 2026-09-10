<script lang="ts">
	import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
	import { onDestroy, onMount } from "svelte";

	let { onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void } =
		$props();

	let videoEl = $state<HTMLVideoElement | undefined>();
	let errorMessage = $state<string | null>(null);
	let controls: IScannerControls | null = null;

	// Decoding itself needs no network at all -- it's pure local image
	// processing against the camera frame. Only the optional product-name
	// lookup that happens after a successful scan needs to be online, and
	// that already degrades to manual entry rather than blocking (see
	// product-lookup.ts).
	onMount(async () => {
		if (!videoEl) return;
		const reader = new BrowserMultiFormatReader();
		try {
			// deviceId left undefined -- zxing prefers the environment-facing
			// (rear) camera automatically when one is available, which is what
			// you want for scanning a physical barcode.
			controls = await reader.decodeFromVideoDevice(undefined, videoEl, (result) => {
				if (result) onDetected(result.getText());
			});
		} catch (err) {
			errorMessage =
				err instanceof Error && err.name === "NotAllowedError"
					? "camera permission was denied. allow camera access to scan, or just type the item."
					: "couldn't access a camera on this device.";
		}
	});

	onDestroy(() => {
		controls?.stop();
	});
</script>

<div class="scanner-overlay" role="dialog" aria-label="Scan a barcode" aria-modal="true">
	<div class="scanner-panel card">
		<div class="scanner-header">
			<h3>scan a barcode</h3>
			<button class="btn btn-ghost btn-small" onclick={onClose}>close</button>
		</div>
		{#if errorMessage}
			<p class="scanner-error">{errorMessage}</p>
		{:else}
			<video bind:this={videoEl} class="scanner-video" muted playsinline autoplay></video>
			<p class="scanner-hint">point the camera at a barcode</p>
		{/if}
	</div>
</div>

<style>
	.scanner-overlay {
		position: fixed;
		inset: 0;
		background: rgba(17, 17, 17, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.25rem;
		z-index: 100;
	}
	.scanner-panel {
		width: 100%;
		max-width: 420px;
		padding: 1.35rem;
		background: var(--bg-surface);
		box-shadow: var(--shadow-xl);
	}
	.scanner-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.scanner-video {
		width: 100%;
		aspect-ratio: 4 / 3;
		object-fit: cover;
		background: #000;
		border: var(--border);
		border-radius: var(--radius-md);
	}
	.scanner-hint,
	.scanner-error {
		text-align: center;
		margin-top: 0.75rem;
		font-family: var(--font-mono);
		font-size: 0.78rem;
	}
	.scanner-error {
		color: var(--text-primary);
	}
</style>
