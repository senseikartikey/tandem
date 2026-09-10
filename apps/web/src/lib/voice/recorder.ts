// Microphone capture, kept separate from transcription so the UI can start
// recording the instant permission is granted -- the model download (which
// only happens on the very first use) then overlaps with the person talking
// instead of making them wait before they can speak.

// Whisper processes 30 second windows natively; past that it needs chunking
// with overlap, which is a lot of machinery for a shopping list. Recording
// stops itself at the limit rather than silently truncating later.
export const MAX_RECORDING_MS = 30_000;

export interface Recording {
	/** 0-1, from the live analyser -- for a level meter, not for logic. */
	level(): number;
	/** Elapsed milliseconds, so the UI can show the cap approaching. */
	elapsed(): number;
	/** Stops capture and resolves the recorded audio. */
	stop(): Promise<Blob>;
	/** Stops capture and throws the audio away (also releases the mic). */
	cancel(): void;
}

/**
 * Starts recording from the default microphone.
 *
 * Rejects if permission is denied or no input device exists -- callers are
 * expected to show that as a plain sentence, since it's the one failure the
 * person can actually do something about.
 */
export async function startRecording(onAutoStop?: () => void): Promise<Recording> {
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: {
			// The browser's own cleanup is better than anything worth doing to
			// the samples afterwards, and Whisper is sensitive to room noise.
			echoCancellation: true,
			noiseSuppression: true,
			autoGainControl: true,
		},
	});

	const context = new AudioContext();
	const analyser = context.createAnalyser();
	analyser.fftSize = 512;
	context.createMediaStreamSource(stream).connect(analyser);
	const levelBuffer = new Uint8Array(analyser.frequencyBinCount);

	const recorder = new MediaRecorder(stream);
	const chunks: Blob[] = [];
	recorder.ondataavailable = (event) => {
		if (event.data.size > 0) chunks.push(event.data);
	};
	recorder.start();
	const startedAt = Date.now();

	let settled = false;
	const release = (): void => {
		settled = true;
		clearTimeout(autoStopTimer);
		stream.getTracks().forEach((track) => track.stop());
		void context.close();
	};

	const stop = (): Promise<Blob> =>
		new Promise<Blob>((resolve) => {
			if (recorder.state === "inactive") {
				resolve(new Blob(chunks, { type: recorder.mimeType }));
				return;
			}
			recorder.onstop = () => {
				release();
				resolve(new Blob(chunks, { type: recorder.mimeType }));
			};
			recorder.stop();
		});

	// Hard cap, enforced here rather than trusted to the UI: a forgotten open
	// recording is a live microphone.
	const autoStopTimer = setTimeout(() => {
		if (!settled) onAutoStop?.();
	}, MAX_RECORDING_MS);

	return {
		level(): number {
			analyser.getByteTimeDomainData(levelBuffer);
			// Peak deviation from silence (128), normalized. Peak rather than
			// RMS because it reacts fast enough to read as "it's hearing me".
			let peak = 0;
			for (const sample of levelBuffer) peak = Math.max(peak, Math.abs(sample - 128));
			return Math.min(1, peak / 90);
		},
		elapsed: () => Date.now() - startedAt,
		stop,
		cancel(): void {
			if (recorder.state !== "inactive") {
				recorder.onstop = null;
				recorder.stop();
			}
			release();
		},
	};
}
