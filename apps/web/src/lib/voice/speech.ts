// The browser's own dictation engine, used as the primary path.
//
// The first version of this feature only had local Whisper, and that made
// the person wait mid-task for a model download before they could say a
// word -- which is not a thing any app should do at the moment someone taps
// a microphone. Every browser tandem realistically runs in already ships a
// speech recognizer that is instant, needs no download, streams interim
// results as you talk, and on phones is the same on-device dictation engine
// as the system keyboard's.
//
// Whisper stays in the codebase as the fallback for browsers without this
// (see transcriber.ts), warmed in the background rather than at tap time.
//
// The honest caveat: where the recognizer runs is the browser's business,
// not ours. Apple's is on-device; Chrome's may use Google's servers unless
// it has an on-device model installed. Nothing is ever sent to a tandem
// server either way, and the UI says which engine is in use.

import { voiceLanguage } from "./language.js";

interface SpeechRecognitionAlternativeLike {
	transcript: string;
}
interface SpeechRecognitionResultLike {
	isFinal: boolean;
	0: SpeechRecognitionAlternativeLike;
	length: number;
}
interface SpeechRecognitionEventLike {
	resultIndex: number;
	results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	maxAlternatives: number;
	processLocally?: boolean;
	start(): void;
	stop(): void;
	abort(): void;
	onresult: ((event: SpeechRecognitionEventLike) => void) | null;
	onerror: ((event: { error: string; message?: string }) => void) | null;
	onend: (() => void) | null;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
	if (typeof window === "undefined") return null;
	const w = window as unknown as {
		SpeechRecognition?: RecognitionCtor;
		webkitSpeechRecognition?: RecognitionCtor;
	};
	return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function browserSpeechAvailable(): boolean {
	return recognitionCtor() !== null;
}

export interface BrowserSpeechHandlers {
	/** Fired continuously as words are recognized, including partial guesses. */
	onTranscript: (text: string) => void;
	/** Fired once on a fatal problem; the session is over by then. */
	onError: (code: string) => void;
}

export interface BrowserSpeechSession {
	/** Stops listening and resolves the final transcript. */
	stop(): Promise<string>;
	/** Stops listening and discards the result. */
	abort(): void;
}

export function startBrowserSpeech(handlers: BrowserSpeechHandlers): BrowserSpeechSession {
	const Ctor = recognitionCtor();
	if (!Ctor) throw new Error("browser speech recognition unavailable");

	const recognition = new Ctor();
	recognition.continuous = true;
	recognition.interimResults = true;
	recognition.maxAlternatives = 1;
	recognition.lang = voiceLanguage();
	// Chrome 138+ honours this as "do not send audio off-device". Older
	// engines ignore the property entirely, which is why it's set rather
	// than required.
	recognition.processLocally = true;

	// Finalized phrases accumulate; the in-flight one is appended for display
	// only, since the engine rewrites it repeatedly until it settles.
	let settled = "";
	let pending = "";
	let stopped = false;
	let resolveStop: ((text: string) => void) | null = null;

	const fullText = (): string => `${settled} ${pending}`.replace(/\s+/g, " ").trim();

	recognition.onresult = (event) => {
		pending = "";
		for (let i = event.resultIndex; i < event.results.length; i++) {
			const result = event.results[i];
			const text = result[0].transcript;
			if (result.isFinal) settled += ` ${text}`;
			else pending += ` ${text}`;
		}
		handlers.onTranscript(fullText());
	};

	recognition.onerror = (event) => {
		// "no-speech" and "aborted" are ordinary endings, not failures: the
		// former is someone tapping done without saying anything, the latter
		// is our own abort().
		if (event.error === "no-speech" || event.error === "aborted") return;
		handlers.onError(event.error);
	};

	// Recognizers stop themselves after a pause. While the person still has
	// the sheet open we restart, so a thoughtful gap mid-sentence doesn't end
	// the capture.
	recognition.onend = () => {
		if (stopped) {
			resolveStop?.(fullText());
			resolveStop = null;
			return;
		}
		try {
			recognition.start();
		} catch {
			// Already restarting; the next onend will settle it.
		}
	};

	recognition.start();

	return {
		stop(): Promise<string> {
			stopped = true;
			return new Promise<string>((resolve) => {
				resolveStop = resolve;
				try {
					recognition.stop();
				} catch {
					resolve(fullText());
				}
				// The engine occasionally never fires onend after stop(); don't
				// strand the UI waiting for it.
				setTimeout(() => {
					if (resolveStop) {
						resolveStop(fullText());
						resolveStop = null;
					}
				}, 1500);
			});
		},
		abort(): void {
			stopped = true;
			try {
				recognition.abort();
			} catch {
				// Nothing useful to do -- the session is being discarded.
			}
		},
	};
}
