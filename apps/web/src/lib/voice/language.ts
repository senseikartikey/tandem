// What language you talk to your list in.
//
// The browser's own recognizer handles dozens of languages; picking one is a
// single property on it. That makes this the cheapest feature in the app and
// quite possibly the most valuable one for the households it's actually
// aimed at -- a parent adding items in the language they think in, rather
// than translating to English first.
//
// Stored per device, not in the household: two people sharing one list
// routinely don't share a language, and the setting belongs to whoever is
// holding the phone.

const LANGUAGE_KEY = "tandem:voice-language";

export interface VoiceLanguage {
	/** BCP-47 tag handed to the recognizer. */
	tag: string;
	/** Endonym: shown in the language people are choosing, not in English. */
	label: string;
}

// A short list of the languages this app's households are most likely to
// speak, not an exhaustive one -- a picker with two hundred entries is worse
// than one with a dozen. "Other" is covered by whatever the device's own
// locale is, which is the default anyway.
export const VOICE_LANGUAGES: VoiceLanguage[] = [
	{ tag: "en-IN", label: "English (India)" },
	{ tag: "en-US", label: "English (US)" },
	{ tag: "en-GB", label: "English (UK)" },
	{ tag: "hi-IN", label: "हिन्दी" },
	{ tag: "gu-IN", label: "ગુજરાતી" },
	{ tag: "mr-IN", label: "मराठी" },
	{ tag: "bn-IN", label: "বাংলা" },
	{ tag: "ta-IN", label: "தமிழ்" },
	{ tag: "te-IN", label: "తెలుగు" },
	{ tag: "kn-IN", label: "ಕನ್ನಡ" },
	{ tag: "ml-IN", label: "മലയാളം" },
	{ tag: "pa-IN", label: "ਪੰਜਾਬੀ" },
	{ tag: "ur-PK", label: "اردو" },
	{ tag: "es-ES", label: "Español" },
	{ tag: "fr-FR", label: "Français" },
	{ tag: "de-DE", label: "Deutsch" },
	{ tag: "pt-BR", label: "Português" },
	{ tag: "ar-SA", label: "العربية" },
];

export function voiceLanguage(): string {
	try {
		const stored = localStorage.getItem(LANGUAGE_KEY);
		if (stored) return stored;
	} catch {
		// Blocked storage; fall through to the device's own language.
	}
	return typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
}

export function setVoiceLanguage(tag: string): void {
	try {
		localStorage.setItem(LANGUAGE_KEY, tag);
	} catch {
		// Preference won't survive a reload; the feature still works.
	}
}

export function voiceLanguageLabel(tag: string): string {
	return VOICE_LANGUAGES.find((language) => language.tag === tag)?.label ?? tag;
}

/**
 * Whether the English sentence rules in parse.ts apply to this language.
 *
 * They emphatically don't for anything else: "we're out of" and "can you
 * grab" are English scaffolding, and stripping words that merely look like
 * them would mangle Hindi or Gujarati. Splitting a spoken list on commas is
 * language-neutral and stays on for everyone.
 */
export function usesEnglishRules(tag: string): boolean {
	return tag.toLowerCase().startsWith("en");
}
