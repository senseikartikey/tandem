// Turning one spoken sentence into list items.
//
// This is deliberately a small grammar rather than a model. The thing being
// parsed is not open-ended English -- it is one narrow speech act ("here are
// things I want on a list"), and its shape is closed enough to write down:
// some preamble, a verb that means "I want", the things, some politeness.
// Rules for that are instant, work offline, cost nothing, and can be pinned
// down by tests, which is worth far more here than the last few percent of
// accuracy a language model might add on top -- especially since the capture
// UI shows every result as an editable chip before anything is written.
//
// The structure that matters: a clause is scanned for a *trigger* verb
// ("need", "grab", "out of"), and everything before it is dropped as
// preamble, provided that preamble is only made of words people actually say
// on the way to the point -- greetings, pronouns, auxiliaries. That is what
// turns "hello I need milk" into "milk", where prefix-stripping against a
// fixed list of openers left the whole sentence intact.
//
// The known trade: a bare imperative is always read as a request, so the
// rare item that opens with one ("get well card") loses its first word. The
// common case ("get milk") is worth far more than the rare one, and the
// review step is right there to fix it.

// Clause boundaries. " and " is included knowing it over-splits genuine
// compounds ("salt and pepper" becomes two items): a spoken list joins its
// last two entries with "and" far more often than it names a compound
// product, and the review step makes the occasional wrong split a two-second
// fix rather than a lost item.
const CLAUSE_SEPARATORS = /\s*(?:[,;\n]|\band\b|\bplus\b|\bthen\b|\balso\b)\s*/gi;

// Words that can legitimately sit between the start of a sentence and the
// actual request. Only these -- if anything else appears before a trigger,
// the "trigger" is probably part of the item and is left alone.
const PREAMBLE_WORDS = new Set([
	// greetings and discourse markers
	"hello", "hi", "hey", "yo", "hiya", "morning", "ok", "okay", "so", "well",
	"right", "alright", "listen", "look", "please", "um", "umm", "uh", "uhh",
	"erm", "hmm", "yeah", "yep", "just", "also", "still", "really", "quickly",
	"maybe", "actually", "oh",
	// people
	"i", "i'm", "im", "we", "we're", "were", "you", "they", "he", "she", "my",
	"our", "us", "me",
	// auxiliaries and modals
	"can", "could", "would", "will", "shall", "should", "gotta", "gonna",
	"going", "have", "has", "had", "i've", "ive", "we've", "weve", "do",
	"does", "did", "don't", "dont", "didn't", "didnt", "let's", "lets", "to",
	"be", "am", "are", "is", "ran", "run",
]);

// Verbs after which the rest of the clause is the thing itself.
const TRIGGERS = new Set([
	"need", "needs", "needed", "want", "wants", "wanted", "get", "gets",
	"getting", "buy", "buys", "grab", "grabs", "order", "add", "bring",
	"take", "put", "fetch", "forget", "remember", "restock",
]);

// Triggers that are more than one word. Checked before the single-word set,
// longest first, so "ran out of" wins over "out".
const PHRASE_TRIGGERS = [
	["ran", "out", "of"],
	["run", "out", "of"],
	["running", "low", "on"],
	["pick", "up"],
	["picking", "up"],
	["out", "of"],
	["low", "on"],
	["short", "on"],
];

// Consumed immediately after a trigger, where they're glue rather than part
// of the item: "need to get milk", "grab me a coffee", "pick up the parcel".
const POST_TRIGGER_GLUE = new Set([
	"to", "up", "of", "on", "me", "us", "for", "some", "the", "any", "more",
	"get", "buy", "grab", "order", "pick",
]);

// Trailing phrases that are never part of the item.
const TRAILING_PHRASES = [
	/\s*\b(?:on|to|in)\s+the\s+list\b\s*$/i,
	/\s*\b(?:from|at)\s+the\s+(?:shop|store|supermarket)\b\s*$/i,
	/\s*\bplease\b\s*$/i,
	/\s*\bas\s+well\b\s*$/i,
	/\s*\btoo\b\s*$/i,
	/\s*\bthank(?:s| you)\b\s*$/i,
];

const TRAILING_PUNCTUATION = /[\s.,;:!?]+$/;
const LEADING_PUNCTUATION = /^[\s.,;:!?'"-]+/;

// A clause with no letters at all ("...", "2") is noise from a dropped word,
// not an item worth adding. Unicode-aware, so a transcript in a non-Latin
// script isn't thrown away as "no letters".
const HAS_LETTERS = /\p{L}/u;

// Whole clauses that are only ever filler, whatever else was heard.
const FILLER_ONLY = new Set([
	"hello", "hi", "hey", "hiya", "yo", "morning", "good morning", "afternoon",
	"evening", "oh", "actually", "listen", "look",
	"um", "uh", "erm", "hmm", "okay", "ok", "so",
	"right", "well", "yeah", "yep", "alright", "thanks", "thank you",
	"that's it", "thats it", "that's all", "thats all", "nothing else",
	"you", "the", "a", "an", "some", "more", "it", "please",
]);

// Never a useful item on its own, so a clause that reduces to one of these
// is dropped rather than added as a mystery entry.
const BARE_QUANTIFIERS = new Set(["some", "a", "an", "the", "any", "more", "one"]);

// One utterance realistically names a handful of things; anything past this
// is a transcription that ran away (a recognizer repeating itself on silence
// is a known failure mode) and would spam the list.
const MAX_ITEMS = 20;

function words(text: string): string[] {
	return text.split(/\s+/).filter(Boolean);
}

function matchPhraseTrigger(tokens: string[], index: number): number {
	for (const phrase of PHRASE_TRIGGERS) {
		const matches = phrase.every(
			(word, offset) => tokens[index + offset]?.toLowerCase().replace(/[^a-z']/g, "") === word,
		);
		if (matches) return phrase.length;
	}
	return 0;
}

function normalizeWord(token: string): string {
	return token.toLowerCase().replace(/[^a-z']/g, "");
}

/**
 * Drops everything up to and including the request verb, when everything
 * before that verb is preamble.
 *
 * Bounded to the first few words: a trigger further in than that is much more
 * likely to be part of the item ("card to get well soon") than the start of
 * the request.
 */
function stripPreamble(clause: string): string {
	const tokens = words(clause);
	const limit = Math.min(tokens.length, 6);

	for (let i = 0; i < limit; i++) {
		const phraseLength = matchPhraseTrigger(tokens, i);
		const isTrigger = phraseLength > 0 || TRIGGERS.has(normalizeWord(tokens[i]));
		if (!isTrigger) {
			// Anything that isn't preamble means the sentence already started
			// naming the item -- leave it exactly as it is.
			if (!PREAMBLE_WORDS.has(normalizeWord(tokens[i]))) return clause;
			continue;
		}

		let rest = i + (phraseLength || 1);
		// Swallow the glue that follows ("need *to get* milk").
		while (rest < tokens.length && POST_TRIGGER_GLUE.has(normalizeWord(tokens[rest]))) {
			rest++;
		}
		return tokens.slice(rest).join(" ");
	}

	return clause;
}

function stripTrailing(clause: string): string {
	let text = clause;
	let changed = true;
	while (changed) {
		const before = text;
		for (const pattern of TRAILING_PHRASES) text = text.replace(pattern, "");
		text = text.replace(TRAILING_PUNCTUATION, "");
		changed = text !== before;
	}
	return text;
}

/**
 * Splits a spoken transcript into candidate list items.
 *
 * Casing is left exactly as transcribed -- the UI renders items lowercase
 * via CSS, so lowercasing the stored text here would throw away real
 * information (brand names, initials) for no visual gain.
 */
export function parseSpokenItems(transcript: string, englishRules = true): string[] {
	if (!transcript) return [];

	const clauses = transcript.replace(/\s+/g, " ").trim().split(CLAUSE_SEPARATORS);

	const items: string[] = [];
	const seen = new Set<string>();

	for (const clause of clauses) {
		let text = clause.replace(LEADING_PUNCTUATION, "");
		// Everything below the clause split is English scaffolding ("we're out
		// of", "can you grab"). Applied to Hindi or Gujarati it would strip
		// words that merely resemble it, so other languages get the split and
		// the tidying, and keep their own words.
		if (englishRules) {
			text = stripPreamble(text);
			text = stripTrailing(text);
		}
		text = text.replace(LEADING_PUNCTUATION, "").replace(TRAILING_PUNCTUATION, "").trim();

		if (!text || !HAS_LETTERS.test(text)) continue;
		const lower = text.toLowerCase();
		if (englishRules && (FILLER_ONLY.has(lower) || BARE_QUANTIFIERS.has(lower))) continue;

		// Case-insensitive dedupe: saying "milk" twice in one breath is a
		// stutter, not a request for two entries.
		if (seen.has(lower)) continue;
		seen.add(lower);

		items.push(text);
		if (items.length >= MAX_ITEMS) break;
	}

	return items;
}
