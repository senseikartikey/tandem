// Microphone capture as raw PCM, not as a recorded file.
//
// The obvious implementation is MediaRecorder plus decodeAudioData, and that
// is what this was first. Two things killed it. Every browser records into
// its own container (webm/opus on Chrome, mp4/aac on Safari), so the decode
// step is a compatibility surface for a feature that never needs a file at
// all. And a MediaRecorder chunk is a *fragment* of a container, undecodable
// on its own, which makes transcribing as you speak impossible -- you can
// only decode after the whole recording is closed.
//
// Tapping the audio graph instead gives plain Float32 samples, at any moment,
// on every browser: no container, no codec, and a growing buffer that can be
// transcribed repeatedly while the person is still talking.

// Whisper's frontend expects 16kHz mono.
export const TARGET_SAMPLE_RATE = 16000;

// Whisper processes 30 second windows natively; past that it needs chunking
// with overlap, which is a lot of machinery for a shopping list. Recording
// stops itself at the limit rather than silently truncating later.
export const MAX_RECORDING_MS = 30_000;

export interface Recording {
	/** 0-1, from the live analyser -- for a level meter, not for logic. */
	level(): number;
	/** Elapsed milliseconds, so the UI can show the cap approaching. */
	elapsed(): number;
	/**
	 * Everything captured so far, as 16kHz mono. Safe to call repeatedly
	 * while recording continues -- this is what makes a live transcript
	 * possible.
	 */
	takeAudio(): Promise<Float32Array>;
	/** Stops capture, releases the mic, and returns the final audio. */
	stop(): Promise<Float32Array>;
	/** Stops capture and throws the audio away (also releases the mic). */
	cancel(): void;
}

// A worklet is the supported way to see raw samples; ScriptProcessorNode is
// the deprecated one that still works everywhere, including Safari versions
// that predate worklet support. The worklet source is inlined as a blob so
// it needs no separate file in the build output.
const WORKLET_SOURCE = `
class TapProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    // slice() because the render quantum's buffer is reused between calls --
    // posting it directly would hand over memory that is about to be
    // overwritten.
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("tandem-tap", TapProcessor);
`;

export function supportsVoiceCapture(): boolean {
	return (
		typeof navigator !== "undefined" &&
		!!navigator.mediaDevices?.getUserMedia &&
		(typeof AudioContext !== "undefined" ||
			typeof (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext !== "undefined")
	);
}

function createAudioContext(): AudioContext {
	const Ctor =
		typeof AudioContext !== "undefined"
			? AudioContext
			: ((globalThis as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
	return new Ctor();
}

/**
 * Resamples mono float samples to Whisper's rate.
 *
 * OfflineAudioContext does the resampling itself, which is both better than
 * hand-rolled linear interpolation and less code than it.
 */
export async function resampleTo16k(samples: Float32Array, sourceRate: number): Promise<Float32Array> {
	if (sourceRate === TARGET_SAMPLE_RATE) return samples;
	const targetLength = Math.max(1, Math.round((samples.length * TARGET_SAMPLE_RATE) / sourceRate));
	const offline = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
	const buffer = offline.createBuffer(1, samples.length, sourceRate);
	// Copied into a freshly allocated view: copyToChannel refuses a
	// SharedArrayBuffer-backed array, and the samples we collect are typed
	// only as "some ArrayBufferLike".
	buffer.copyToChannel(new Float32Array(samples), 0);
	const source = offline.createBufferSource();
	source.buffer = buffer;
	source.connect(offline.destination);
	source.start();
	const rendered = await offline.startRendering();
	return rendered.getChannelData(0);
}

/**
 * Starts capturing from the default microphone.
 *
 * Rejects if permission is denied or no input device exists -- callers are
 * expected to show that as a plain sentence, since it's the one failure the
 * person can actually do something about.
 */
export async function startRecording(onAutoStop?: () => void): Promise<Recording> {
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: {
			// The browser's own cleanup beats anything worth doing to the
			// samples afterwards, and Whisper is sensitive to room noise.
			echoCancellation: true,
			noiseSuppression: true,
			autoGainControl: true,
		},
	});

	const context = createAudioContext();
	// Safari hands back a suspended context when it wasn't created directly
	// inside the tap handler; resuming is a no-op everywhere else.
	if (context.state === "suspended") await context.resume().catch(() => {});

	const source = context.createMediaStreamSource(stream);
	const analyser = context.createAnalyser();
	analyser.fftSize = 512;
	source.connect(analyser);
	const levelBuffer = new Uint8Array(analyser.frequencyBinCount);

	const chunks: Float32Array[] = [];
	let sampleCount = 0;
	const collect = (samples: Float32Array): void => {
		chunks.push(samples);
		sampleCount += samples.length;
	};

	// Both tap paths need a sink for the graph to pull audio through them;
	// the gain is zeroed so nothing is played back into the room.
	const mute = context.createGain();
	mute.gain.value = 0;
	mute.connect(context.destination);

	let disconnectTap: () => void;
	if (context.audioWorklet) {
		const blobUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
		try {
			await context.audioWorklet.addModule(blobUrl);
		} finally {
			URL.revokeObjectURL(blobUrl);
		}
		const tap = new AudioWorkletNode(context, "tandem-tap");
		tap.port.onmessage = (event: MessageEvent<Float32Array>) => collect(event.data);
		source.connect(tap);
		tap.connect(mute);
		disconnectTap = () => {
			tap.port.onmessage = null;
			tap.disconnect();
		};
	} else {
		const tap = context.createScriptProcessor(4096, 1, 1);
		tap.onaudioprocess = (event) => collect(new Float32Array(event.inputBuffer.getChannelData(0)));
		source.connect(tap);
		tap.connect(mute);
		disconnectTap = () => {
			tap.onaudioprocess = null;
			tap.disconnect();
		};
	}

	const startedAt = Date.now();
	let released = false;

	const release = (): void => {
		if (released) return;
		released = true;
		clearTimeout(autoStopTimer);
		disconnectTap();
		source.disconnect();
		stream.getTracks().forEach((track) => track.stop());
		void context.close();
	};

	// Hard cap, enforced here rather than trusted to the UI: a forgotten open
	// recording is a live microphone.
	const autoStopTimer = setTimeout(() => {
		if (!released) onAutoStop?.();
	}, MAX_RECORDING_MS);

	const snapshot = async (): Promise<Float32Array> => {
		const merged = new Float32Array(sampleCount);
		let offset = 0;
		for (const chunk of chunks) {
			merged.set(chunk, offset);
			offset += chunk.length;
		}
		return resampleTo16k(merged, context.sampleRate);
	};

	return {
		level(): number {
			if (released) return 0;
			analyser.getByteTimeDomainData(levelBuffer);
			// Peak deviation from silence (128), normalized. Peak rather than
			// RMS because it reacts fast enough to read as "it's hearing me".
			let peak = 0;
			for (const sample of levelBuffer) peak = Math.max(peak, Math.abs(sample - 128));
			return Math.min(1, peak / 90);
		},
		elapsed: () => Date.now() - startedAt,
		takeAudio: snapshot,
		async stop(): Promise<Float32Array> {
			const audio = await snapshot();
			release();
			return audio;
		},
		cancel: release,
	};
}
