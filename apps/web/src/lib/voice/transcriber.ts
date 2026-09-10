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
// The cost of that choice is honest and up-front: a one-time model download
// (~40MB for whisper-tiny.en, quantized). Callers are expected to surface
// the progress this module reports rather than hide it behind a spinner.

// Small and English-only on purpose. tiny.en is the smallest Whisper that
// transcribes short product names reliably, and the multilingual variants
// cost several times the download for accuracy this task doesn't need
// ("two litres of milk" is not a hard sentence).
const MODEL_ID = "Xenova/whisper-tiny.en";

// Whisper's own frontend expects 16kHz mono; the audio is decoded straight
// into that rate rather than resampled afterwards (see decodeToWhisperAudio).
export const TARGET_SAMPLE_RATE = 16000;

export interface ModelLoadProgress {
	/** "initiate" | "download" | "progress" | "done" | "ready", per transformers.js. */
	status: string;
	file?: string;
	/** 0-100, only present while a file is actually streaming. */
	progress?: number;
	loaded?: number;
	total?: number;
}

type AsrPipeline = (
	audio: Float32Array,
	options?: Record<string, unknown>,
) => Promise<{ text: string } | { text: string }[]>;

// A single in-flight/resolved pipeline shared by every caller: the weights
// are tens of megabytes and building a second copy per component mount
// would re-parse all of it. Reset to null on failure so a transient error
// (offline on first use) doesn't poison every later attempt.
let pipelinePromise: Promise<AsrPipeline> | null = null;

/** True once the model is resident in this tab -- lets the UI skip the download copy. */
export function isTranscriberReady(): boolean {
	return pipelineReady;
}
let pipelineReady = false;

export function supportsVoiceCapture(): boolean {
	return (
		typeof navigator !== "undefined" &&
		!!navigator.mediaDevices?.getUserMedia &&
		typeof MediaRecorder !== "undefined" &&
		typeof AudioContext !== "undefined"
	);
}

/**
 * Loads (and caches) the speech model. Safe to call repeatedly.
 *
 * WebGPU is used when the browser exposes it and falls back to WASM
 * otherwise -- the fallback is several times slower but still local, which
 * matters more here than speed.
 */
export async function loadTranscriber(
	onProgress?: (progress: ModelLoadProgress) => void,
): Promise<AsrPipeline> {
	if (!pipelinePromise) {
		pipelinePromise = (async () => {
			// Dynamically imported for the same reason the barcode scanner is:
			// this is a multi-hundred-kilobyte runtime that most visits to a
			// list never touch, and eagerly bundling it would tax every
			// list-open for a feature only some visits use.
			const { pipeline } = await import("@huggingface/transformers");
			const device = typeof navigator !== "undefined" && "gpu" in navigator ? "webgpu" : "wasm";
			const asr = (await pipeline("automatic-speech-recognition", MODEL_ID, {
				device,
				// fp32 on GPU, int8 on CPU: the quantized weights are a third of
				// the download and run acceptably in WASM, while WebGPU has the
				// headroom for the unquantized encoder and noticeably better
				// transcription with it.
				dtype: device === "webgpu" ? "fp32" : "q8",
				progress_callback: onProgress as never,
			})) as unknown as AsrPipeline;
			pipelineReady = true;
			return asr;
		})().catch((error: unknown) => {
			pipelinePromise = null;
			throw error;
		});
	}
	return pipelinePromise;
}

/**
 * Decodes recorded audio (whatever container MediaRecorder produced) into
 * the mono 16kHz float samples Whisper expects.
 *
 * decodeAudioData resamples into the AudioContext's own rate, so the context
 * is constructed at the target rate and the resampling comes free and
 * correct rather than being hand-rolled here.
 */
export async function decodeToWhisperAudio(blob: Blob): Promise<Float32Array> {
	const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
	try {
		const buffer = await context.decodeAudioData(await blob.arrayBuffer());
		if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
		// Downmix rather than picking channel 0: a phone recording one side of
		// a stereo stream can leave that channel near-silent.
		const left = buffer.getChannelData(0);
		const right = buffer.getChannelData(1);
		const mono = new Float32Array(left.length);
		for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) / 2;
		return mono;
	} finally {
		void context.close();
	}
}

/** Transcribes decoded audio. Returns "" when Whisper heard nothing usable. */
export async function transcribe(audio: Float32Array): Promise<string> {
	const asr = await loadTranscriber();
	const output = await asr(audio);
	const text = Array.isArray(output) ? output.map((o) => o.text).join(" ") : output.text;
	return (text ?? "").trim();
}
