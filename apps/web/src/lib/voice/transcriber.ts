// Speech-to-text that runs entirely inside the browser tab.
//
// This is the one place in the app where a "cloud AI" would have been the
// easy path, and taking it would have quietly broken the product's whole
// premise: the Web Speech API streams your microphone to a vendor's servers
// and returns nothing at all offline. Whisper running locally keeps the
// promise the landing page makes -- the audio never leaves the device, and
// once the weights are cached the feature works in a basement with no bars,
// exactly like every other feature here.
//
// The cost of that choice is honest and up-front: a one-time model download.
// Callers are expected to surface the progress this module reports rather
// than hide it behind a spinner.

export interface ModelLoadProgress {
	/** "initiate" | "download" | "progress" | "done" | "ready", per transformers.js. */
	status: string;
	file?: string;
	/** 0-100, only present while a file is actually streaming. */
	progress?: number;
	loaded?: number;
	total?: number;
}

// Two models, picked by what the device can actually run.
//
// base.en is the noticeably cleaner transcriber -- it gets product names and
// plurals right where tiny drops or invents them -- but it is roughly four
// times the download and needs real compute. WebGPU means a GPU is available
// and (in practice) a desktop-class device, so it gets base; everything
// falling back to CPU/WASM gets tiny, which is the difference between a
// phone transcribing in a couple of seconds and appearing to hang.
const MODEL_WEBGPU = "Xenova/whisper-base.en";
const MODEL_WASM = "Xenova/whisper-tiny.en";

type AsrPipeline = (
	audio: Float32Array,
	options?: Record<string, unknown>,
) => Promise<{ text: string } | { text: string }[]>;

interface LoadedTranscriber {
	asr: AsrPipeline;
	device: "webgpu" | "wasm";
	model: string;
}

// A single in-flight/resolved pipeline shared by every caller: the weights
// are tens of megabytes and building a second copy per component mount would
// re-parse all of it. Reset to null on failure so a transient error (offline
// on first use) doesn't poison every later attempt.
let pipelinePromise: Promise<LoadedTranscriber> | null = null;
let loaded: LoadedTranscriber | null = null;

/** Non-null once the model is resident in this tab -- lets the UI skip the download copy. */
export function loadedTranscriber(): LoadedTranscriber | null {
	return loaded;
}

// `"gpu" in navigator` is not enough. Android Chrome exposes navigator.gpu on
// hardware where requestAdapter() then resolves to null, and some devices
// hand back an adapter that only fails later during model init -- which is
// exactly the "couldn't start the speech model" dead end this used to hit on
// phones while working fine on desktop.
async function hasUsableWebGpu(): Promise<boolean> {
	const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
	if (!gpu) return false;
	try {
		return (await gpu.requestAdapter()) !== null;
	} catch {
		return false;
	}
}

async function build(
	device: "webgpu" | "wasm",
	onProgress?: (progress: ModelLoadProgress) => void,
): Promise<LoadedTranscriber> {
	// Dynamically imported for the same reason the barcode scanner is: this
	// is a multi-megabyte runtime that most visits to a list never touch, and
	// eagerly bundling it would tax every list-open for a feature only some
	// visits use.
	const { pipeline } = await import("@huggingface/transformers");
	const model = device === "webgpu" ? MODEL_WEBGPU : MODEL_WASM;
	const asr = (await pipeline("automatic-speech-recognition", model, {
		device,
		// fp32 on GPU, int8 on CPU: the quantized weights are a third of the
		// download and run acceptably in WASM, while WebGPU has the headroom
		// for the unquantized encoder and better transcription with it.
		dtype: device === "webgpu" ? "fp32" : "q8",
		progress_callback: onProgress as never,
	})) as unknown as AsrPipeline;
	return { asr, device, model };
}

/**
 * Loads (and caches) the speech model. Safe to call repeatedly.
 *
 * Falls back from WebGPU to WASM on *any* failure rather than only on absent
 * support: a GPU path that initializes and then dies mid-load is common on
 * mobile, and a slower local transcription is always better than none.
 */
export async function loadTranscriber(
	onProgress?: (progress: ModelLoadProgress) => void,
): Promise<LoadedTranscriber> {
	if (!pipelinePromise) {
		pipelinePromise = (async () => {
			if (await hasUsableWebGpu()) {
				try {
					return await build("webgpu", onProgress);
				} catch (error) {
					console.warn("[tandem] webgpu speech model failed, retrying on wasm", error);
				}
			}
			return build("wasm", onProgress);
		})()
			.then((result) => {
				loaded = result;
				return result;
			})
			.catch((error: unknown) => {
				pipelinePromise = null;
				throw error;
			});
	}
	return pipelinePromise;
}

/** Transcribes 16kHz mono audio. Returns "" when Whisper heard nothing usable. */
export async function transcribe(audio: Float32Array): Promise<string> {
	const { asr } = await loadTranscriber();
	const output = await asr(audio);
	const text = Array.isArray(output) ? output.map((o) => o.text).join(" ") : output.text;
	return cleanTranscript(text ?? "");
}

// Whisper emits its own artifacts on near-silence: bracketed event tags
// ("[BLANK_AUDIO]", "(coughs)") and, notoriously, hallucinated boilerplate
// from the subtitle corpora it was trained on. None of that is ever a
// grocery item, and it's cheaper to drop here than to teach every caller.
const WHISPER_ARTIFACTS =
	/\[[^\]]*\]|\([^)]*\)|\bthanks? for watching\b|\bplease subscribe\b|\bsubtitles? by\b.*/gi;

export function cleanTranscript(raw: string): string {
	const cleaned = raw.replace(WHISPER_ARTIFACTS, " ").replace(/\s+/g, " ").trim();
	// Stripping an artifact routinely leaves its punctuation behind
	// ("Thanks for watching!" -> "!"). Whatever survives with no letters or
	// digits in it was never speech worth keeping.
	return /[a-z0-9]/i.test(cleaned) ? cleaned : "";
}
