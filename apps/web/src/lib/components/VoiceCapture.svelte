<script lang="ts">
	import { onDestroy } from "svelte";
	import { parseSpokenItems } from "$lib/voice/parse.js";
	import { MAX_RECORDING_MS, startRecording, type Recording } from "$lib/voice/recorder.js";
	import {
		loadTranscriber,
		loadedTranscriber,
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
	// The underlying failure, shown in small print. Speech setup fails for
	// device-specific reasons (no GPU adapter, blocked download, unsupported
	// audio path) that are invisible from a generic sentence, and the person
	// hitting it is the only one who can report it.
	let errorDetail = $state("");
	let level = $state(0);
	let elapsed = $state(0);
	let transcript = $state("");
	// What Whisper has made of the audio so far, refreshed while you talk.
	let interim = $state("");
	let drafts = $state<string[]>([]);
	let downloadPercent = $state<number | null>(null);
	let modelReadyNow = $state(loadedTranscriber() !== null);

	let recording: Recording | null = null;
	let meterFrame = 0;
	let interimTimer: ReturnType<typeof setInterval> | null = null;
	let interimBusy = false;

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
	const modelReady = loadTranscriber(trackProgress)
		.then((result) => {
			modelReadyNow = true;
			return result;
		})
		.catch((error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			fail(
				/fetch|network|load|404/i.test(message)
					? "the speech model needs one online download before it works offline. reconnect and try again."
					: "couldn't start the speech model on this device.",
				message,
			);
			return null;
		});

	function fail(message: string, detail = ""): void {
		errorMessage = message;
		errorDetail = detail;
		phase = "error";
		stopLoops();
		recording?.cancel();
		recording = null;
	}

	function stopLoops(): void {
		if (meterFrame) cancelAnimationFrame(meterFrame);
		meterFrame = 0;
		if (interimTimer) clearInterval(interimTimer);
		interimTimer = null;
	}

	function pollMeter(): void {
		if (!recording || phase !== "recording") return;
		level = recording.level();
		elapsed = recording.elapsed();
		meterFrame = requestAnimationFrame(pollMeter);
	}

	// Live transcription: every couple of seconds, run the model over
	// everything captured so far. Deliberately not overlapped -- if a pass is
	// still running the tick is skipped rather than queued, so a slow device
	// degrades to fewer updates instead of falling further and further behind
	// while the queue grows.
	const INTERIM_INTERVAL_MS = 2200;

	async function runInterim(): Promise<void> {
		if (interimBusy || !recording || phase !== "recording") return;
		if (loadedTranscriber() === null) return; // still downloading
		interimBusy = true;
		try {
			const audio = await recording.takeAudio();
			// Under ~0.6s there isn't enough signal for a useful guess, and
			// Whisper tends to hallucinate on very short clips.
			if (audio.length > 9600) {
				const text = await transcribe(audio);
				if (phase === "recording") interim = text;
			}
		} catch {
			// A failed interim pass is not worth surfacing: the final pass on
			// stop is the one that matters, and it reports its own errors.
		} finally {
			interimBusy = false;
		}
	}

	async function begin(): Promise<void> {
		try {
			recording = await startRecording(() => void finish());
			pollMeter();
			interimTimer = setInterval(() => void runInterim(), INTERIM_INTERVAL_MS);
		} catch (error) {
			fail(
				error instanceof Error && error.name === "NotAllowedError"
					? "microphone permission was denied. allow it to talk your list in, or just type the item."
					: "couldn't reach a microphone on this device.",
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	async function finish(): Promise<void> {
		if (!recording || phase !== "recording") return;
		phase = "thinking";
		stopLoops();
		const audio = await recording.stop();
		recording = null;
		try {
			if (!(await modelReady)) return; // fail() already reported why
			const text = await transcribe(audio);
			// Falling back to the last live guess matters on slow devices: the
			// final pass can come back empty if the person stopped talking a
			// while before hitting done, and throwing away a transcript we
			// already showed them would look like the app lost it.
			transcript = text || interim;
			drafts = parseSpokenItems(transcript);
			phase = "review";
		} catch (error) {
			fail(
				"couldn't make out any speech in that. try again, a little closer to the mic.",
				error instanceof Error ? error.message : String(error),
			);
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
		stopLoops();
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

			<!-- Reserved height, so the panel doesn't jump the moment the first
			     words come back from the model. -->
			<p class="live-transcript" class:waiting={!interim} aria-live="polite">
				{interim || (modelReadyNow ? "listening — “milk, eggs and a loaf of sourdough”" : "")}
			</p>

			<p class="voice-hint"><span class="voice-countdown">{secondsLeft}s left</span></p>
			<button class="btn btn-ink btn-block" onclick={() => void finish()}>done talking</button>
			{#if downloadPercent !== null}
				<p class="voice-note">
					first run: fetching the speech model, {downloadPercent}% — after this it works offline.
				</p>
			{:else if !modelReadyNow}
				<p class="voice-note">warming up the speech model…</p>
			{/if}
		{:else if phase === "thinking"}
			<p class="voice-hint">working out what you said…</p>
			{#if interim}
				<p class="live-transcript">{interim}</p>
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
			{#if errorDetail}
				<p class="voice-detail">{errorDetail}</p>
			{/if}
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
		margin: 0.25rem 0;
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
	/* The live transcript is the point of the screen once words start
	   arriving, so it's set as real copy rather than as a status line. */
	.live-transcript {
		min-height: 3.2rem;
		margin: 0;
		text-align: center;
		font-size: 1rem;
		line-height: 1.4;
		color: var(--text-primary);
		text-wrap: pretty;
	}
	.live-transcript.waiting {
		font-family: var(--font-mono);
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	.voice-hint {
		text-align: center;
		font-family: var(--font-mono);
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	.voice-countdown {
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
	.voice-detail {
		text-align: center;
		font-family: var(--font-mono);
		font-size: 0.66rem;
		color: var(--text-secondary);
		word-break: break-word;
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
