// The small physical feedback of ticking something off.
//
// Worth its own module because it is the moment the app is actually *used* --
// standing in an aisle, one-handed, half-looking at the screen. A sound and a
// short buzz confirm the tap landed without needing to look, and a different,
// softer sound for someone else's check-off is how you notice your housemate
// grabbing something while you're two aisles away.
//
// Synthesized rather than loaded from files: two short blips are a few lines
// of Web Audio, and shipping audio assets for them would mean a download,
// cache rules, and a decode step for something the browser can make itself.

const SOUND_KEY = "tandem:check-sound";

// Created lazily, on the first check-off -- an AudioContext built before any
// user gesture is born suspended, and browsers count that against the page.
let context: AudioContext | null = null;

function audio(): AudioContext | null {
	if (typeof window === "undefined") return null;
	const Ctor =
		typeof AudioContext !== "undefined"
			? AudioContext
			: (globalThis as unknown as { webkitAudioContext?: typeof AudioContext })
					.webkitAudioContext;
	if (!Ctor) return null;
	if (!context) context = new Ctor();
	if (context.state === "suspended") void context.resume().catch(() => {});
	return context;
}

export function soundEnabled(): boolean {
	try {
		return localStorage.getItem(SOUND_KEY) !== "off";
	} catch {
		return true;
	}
}

export function setSoundEnabled(enabled: boolean): void {
	try {
		localStorage.setItem(SOUND_KEY, enabled ? "on" : "off");
	} catch {
		// Blocked storage: the preference just won't survive a reload.
	}
}

interface Blip {
	from: number;
	to: number;
	duration: number;
	gain: number;
}

// Rising and bright for your own tap; lower, quieter and shorter for a
// housemate's, so the two are distinguishable without being looked at.
const BLIPS: Record<"check" | "uncheck" | "remote", Blip> = {
	check: { from: 660, to: 1180, duration: 0.09, gain: 0.16 },
	uncheck: { from: 520, to: 380, duration: 0.08, gain: 0.1 },
	remote: { from: 420, to: 560, duration: 0.07, gain: 0.07 },
};

function play(blip: Blip): void {
	const ctx = audio();
	if (!ctx) return;
	const now = ctx.currentTime;
	const oscillator = ctx.createOscillator();
	const gain = ctx.createGain();
	oscillator.type = "sine";
	oscillator.frequency.setValueAtTime(blip.from, now);
	oscillator.frequency.exponentialRampToValueAtTime(blip.to, now + blip.duration);
	// A hard stop clicks; the ramp to near-silence is what makes it a "tock"
	// rather than a "beep".
	gain.gain.setValueAtTime(blip.gain, now);
	gain.gain.exponentialRampToValueAtTime(0.0001, now + blip.duration);
	oscillator.connect(gain).connect(ctx.destination);
	oscillator.start(now);
	oscillator.stop(now + blip.duration);
}

/**
 * Confirms a check-off. `remote` is someone else's, and is deliberately
 * quieter -- it's news, not a response to something you did.
 */
export function checkFeedback(kind: "check" | "uncheck" | "remote"): void {
	if (!soundEnabled()) return;
	try {
		play(BLIPS[kind]);
	} catch {
		// Audio can fail for reasons none of this code can fix (no output
		// device, autoplay policy). It is decoration; never let it throw into
		// a caller that was checking something off.
	}
	// Only your own actions buzz. A phone vibrating in your pocket because
	// someone else ticked something off is a notification, and this isn't
	// one. (No-op on iOS, which doesn't implement the API.)
	if (kind !== "remote") navigator.vibrate?.(kind === "check" ? 14 : 8);
}
