<script lang="ts">
	import { onDestroy } from "svelte";
	import { parseSpokenItems } from "$lib/voice/parse.js";
	import { MAX_RECORDING_MS, startRecording, type Recording } from "$lib/voice/recorder.js";
	import {
		decodeToWhisperAudio,
		isTranscriberReady,
		loadTranscriber,
		transcribe,
		type ModelLoadProgress,
	} from "$lib/voice/transcriber.js";

	let { onItems, onClose }: { onItems: (texts: string[]) => void; onClose: () => void } = $props();

	// Mirrors the barcode scanner's contract exactly: capturing never writes
	// to the list on its own. Speech recognition is wrong often enough that
	// an auto-commit would mean someone finding "two liters of milk" spelled
	// three different ways in their groceries with no idea where it came
	// from. Everything lands in an editable review step first.
	type Phase = "recording" | "thinking" | "review" | "error";

	let phase = $state<Phase>("recording");
	let errorMessage = $state("");
	let level = $state(0);
	let elapsed = $state(0);
	let transcript = $state("");
	let drafts = $state<string[]>([]);
	// null until the model actually needs downloading, so the common case
	// (already cached) never shows a progress bar at all.
	let downloadPercent = $state<number | null>(null);

	let recording: Recording | null = null;
	let meterFrame = 0;

	function trackProgress(progress: ModelLoadProgress): void {
		if (progress.status === "progress" && typeof progress.progress === "number") {
			downloadPercent = Math.round(progress.progress);
		} else if (progress.status === "ready" || progress.status === "done") {
			downloadPercent = null;
		}
	}

	// The model load is kicked off in parallel with the recording rather than
	// awaited before it: on a first-ever use the weights and the sentence
	// arrive at roughly the same time instead of one after the other.
	const modelReady = loadTranscriber(trackProgress).catch((error: unknown) => {
		fail(
			error instanceof Error && /fetch|network/i.test(error.message)
				? "the speech model needs one online download before it works offline. reconnect and try again."
				: "couldn't start the speech model on this device.",
		);
		return null;
	});

	function fail(message: string): void {
		errorMessage = message;
		phase = "error";
		stopMeter();
		recording?.cancel();
		recording = null;
	}

	function stopMeter(): void {
		if (meterFrame) cancelAnimationFrame(meterFrame);
		meterFrame = 0;
	}

	function pollMeter(): void {
		if (!recording || phase !== "recording") return;
		level = recording.level();
		elapsed = recording.elapsed();
		meterFrame = requestAnimationFrame(pollMeter);
	}

	async function begin(): Promise<void> {
		try {
			recording = await startRecording(() => void finish());
			pollMeter();
		} catch (error) {
			fail(
				error instanceof Error && error.name === "NotAllowedError"
					? "microphone permission was denied. allow it to talk your list in, or just type the item."
					: "couldn't reach a microphone on this device.",
			);
		}
	}

	async function finish(): Promise<void> {
		if (!recording || phase !== "recording") return;
		phase = "thinking";
		stopMeter();
		const blob = await recording.stop();
		recording = null;
		try {
			if (!(await modelReady)) return; // fail() already reported why
			const audio = await decodeToWhisperAudio(blob);
			transcript = await transcribe(audio);
			drafts = parseSpokenItems(transcript);
			phase = "review";
		} catch {
			fail("couldn't make out any speech in that. try again, a little closer to the mic.");
		}
	}

	function reparse(): void {
		drafts = parseSpokenItems(transcript);
	}

	function updateDraft(index: number, text: string): void {
		drafts = drafts.map((draft, i) => (i === index ? text : draft));
	}

	function removeDraft(index: number): void {
		drafts = drafts.filter((_, i) => i !== index);
	}

	function commit(): void {
		const texts = drafts.map((d) => d.trim()).filter(Boolean);
		if (texts.length > 0) onItems(texts);
		onClose();
	}

	void begin();

	onDestroy(() => {
		stopMeter();
		recording?.cancel();
	});

	let secondsLeft = $derived(Math.max(0, Math.ceil((MAX_RECORDING_MS - elapsed) / 1000)));
</script>

<div class="voice-overlay" role="dialog" aria-label="Add items by voice" aria-modal="true">
	<div class="voice-panel card">
		<div class="voice-header">
			<h3>say what you need</h3>
			<button class="btn btn-ghost btn-small" onclick={onClose}>close</button>
		</div>

		{#if phase === "recording"}
			<button class="mic" onclick={() => void finish()} aria-label="Stop recording">
				<span class="mic-ring" style={`transform: scale(${1 + level * 0.5})`}></span>
				<span class="mic-glyph">🎙️</span>
			</button>
			<p class="voice-hint">
				listening — “milk, eggs and a loaf of sourdough”
				<span class="voice-countdown">{secondsLeft}s left</span>
			</p>
			<button class="btn btn-ink btn-block" onclick={() => void finish()}>done talking</button>
			{#if downloadPercent !== null}
				<p class="voice-note">
					first run: fetching the speech model, {downloadPercent}% — after this it works offline.
				</p>
			{:else if !isTranscriberReady()}
				<p class="voice-note">warming up the speech model…</p>
			{/if}
		{:else if phase === "thinking"}
			<p class="voice-hint">working out what you said…</p>
			{#if downloadPercent !== null}
				<p class="voice-note">still fetching the speech model, {downloadPercent}%.</p>
			{/if}
		{:else if phase === "review"}
			{#if drafts.length === 0}
				<p class="voice-hint">nothing came through that time.</p>
				<button class="btn btn-block" onclick={onClose}>close</button>
			{:else}
				<p class="eyebrow">— heard {drafts.length} {drafts.length === 1 ? "item" : "items"}</p>
				<ul class="drafts">
					{#each drafts as draft, i (i)}
						<li>
							<input
								class="input"
								value={draft}
								oninput={(e) => updateDraft(i, e.currentTarget.value)}
								aria-label={`Item ${i + 1}`}
							/>
							<button class="remove" onclick={() => removeDraft(i)} aria-label={`Drop ${draft}`}>
								✕
							</button>
						</li>
					{/each}
				</ul>
				<details class="raw">
					<summary>split wrong? edit what it heard</summary>
					<textarea
						class="raw-text"
						bind:value={transcript}
						rows="2"
						aria-label="Raw transcript"
					></textarea>
					<button class="btn btn-ghost btn-small" onclick={reparse}>split again</button>
				</details>
				<button class="btn btn-ink btn-block" onclick={commit}>
					add {drafts.length} to the list <span class="btn-arrow">→</span>
				</button>
			{/if}
		{:else}
			<p class="voice-error">{errorMessage}</p>
			<button class="btn btn-block" onclick={onClose}>close</button>
		{/if}
	</div>
</div>

<style>
	.voice-overlay {
		position: fixed;
		inset: 0;
		background: rgba(17, 17, 17, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.25rem;
		z-index: 100;
	}
	.voice-panel {
		width: 100%;
		max-width: 420px;
		max-height: 90dvh;
		overflow-y: auto;
		padding: 1.35rem;
		background: var(--bg-surface);
		box-shadow: var(--shadow-xl);
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.voice-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	/* The mic is the one element in the app that reacts continuously to
	   something physical, so it gets the loudest treatment: a filled circle
	   with a ring that scales straight off the input level. */
	.mic {
		position: relative;
		align-self: center;
		width: 96px;
		height: 96px;
		margin: 0.5rem 0;
		border: var(--border);
		border-radius: 50%;
		background: var(--color-primary);
		box-shadow: var(--shadow-md);
		cursor: pointer;
		display: grid;
		place-items: center;
	}
	.mic-ring {
		position: absolute;
		inset: -10px;
		border: var(--border);
		border-radius: 50%;
		opacity: 0.45;
		transition: transform 0.08s linear;
	}
	.mic-glyph {
		font-size: 2.25rem;
		line-height: 1;
	}
	.voice-hint {
		text-align: center;
		font-family: var(--font-mono);
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	.voice-countdown {
		display: block;
		margin-top: 0.25rem;
		opacity: 0.7;
	}
	.voice-note {
		text-align: center;
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--text-secondary);
	}
	.voice-error {
		text-align: center;
		font-family: var(--font-mono);
		font-size: 0.8rem;
		color: var(--text-primary);
	}
	.drafts {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.drafts li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.drafts .input {
		flex: 1;
		min-width: 0;
		padding: 9px 12px;
	}
	.remove {
		flex-shrink: 0;
		background: none;
		border: none;
		color: var(--text-secondary);
		padding: 0.35rem;
		font-weight: 700;
		cursor: pointer;
	}
	.remove:hover {
		color: var(--color-primary);
	}
	.raw summary {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.raw-text {
		width: 100%;
		margin-top: 0.5rem;
		padding: 0.6rem 0.75rem;
		font-family: var(--font);
		font-size: 0.85rem;
		border: var(--border-thin);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		color: var(--text-primary);
		resize: vertical;
	}
</style>
