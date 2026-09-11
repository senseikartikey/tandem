// Whisper, running entirely inside the browser tab.
//
// This is the *fallback* engine, not the primary one. The browser's own
// recognizer (speech.ts) is instant and needs no download, so it is what
// people actually get; this exists for browsers that have none, and for the
// offline case the rest of the app is built around -- once the weights are
// cached it transcribes in a basement with no bars.
//
// Because it is a fallback, it is warmed in the background (preload) rather
// than fetched when someone taps the microphone. Making a person wait on a
// multi-megabyte download at the moment they want to speak is the wrong
// shape for this feature, and no amount of progress reporting fixes that.

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

// Both bundled models are the .en variants: the multilingual ones are several
// times the download for accuracy this task doesn't need in English, and the
// browser's own recognizer already covers other languages far better than a
// tiny local model would. So a non-English household needs the browser
// engine, and the UI says so rather than transcribing Gujarati as nonsense.
export function localModelSupports(languageTag: string): boolean {
	return languageTag.toLowerCase().startsWith("en");
}

// Choosing a backend is mostly a matter of knowing where WebGPU is a trap.
//
// `"gpu" in navigator` is not enough on its own: Android Chrome exposes
// navigator.gpu on hardware whose requestAdapter() resolves to null. Safari
// is worse -- it ships WebGPU, hands back a real adapter, and then the ONNX
// runtime dies inside session creation with "webgpuInit is not a function",
// because the wasm binary it loaded has no WebGPU support compiled in. That
// failure surfaces as "no available backend found", which is what this hit
// on iPhone while desktop worked. So Safari goes straight to WASM.
async function pickDevice(): Promise<"webgpu" | "wasm"> {
	const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
	if (!gpu) return "wasm";
	const ua = navigator.userAgent;
	const isSafari = /safari/i.test(ua) && !/chrome|chromium|crios|android|fxios|edg/i.test(ua);
	if (isSafari) return "wasm";
	try {
		return (await gpu.requestAdapter()) ? "webgpu" : "wasm";
	} catch {
		return "wasm";
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
			if ((await pickDevice()) === "webgpu") {
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

/**
 * Starts fetching the model in the background, if the connection looks like
 * one where a several-megabyte download is a reasonable thing to do
 * unannounced. Fire-and-forget: failures are swallowed, because nothing is
 * waiting on this and the real attempt reports its own errors.
 */
export function preloadTranscriber(): void {
	if (typeof window === "undefined" || loaded || pipelinePromise) return;
	const connection = (
		navigator as {
			connection?: { saveData?: boolean; effectiveType?: string };
		}
	).connection;
	if (connection?.saveData) return;
	if (connection?.effectiveType && /(^|-)2g$/.test(connection.effectiveType)) return;

	const start = () => void loadTranscriber().catch(() => {});
	if ("requestIdleCallback" in window) {
		window.requestIdleCallback(start, { timeout: 8000 });
	} else {
		setTimeout(start, 3000);
	}
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
