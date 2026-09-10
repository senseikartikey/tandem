// Turning one spoken sentence into several list items is done with plain
// deterministic rules here, not a second model. Whisper already costs a
// model download; adding an LLM on top to split "milk, eggs and bread" into
// three strings would multiply that cost for a job a regex does correctly.
// It also keeps this step pure and unit-testable, which the transcription
// step itself can never be.
//
// Every rule below is deliberately conservative: it only removes words that
// are unambiguously scaffolding around an item ("we're out of", "can you
// grab"), never words that might be part of the item itself. Anything this
// gets wrong is recoverable -- the capture UI shows the parsed items as
// editable chips and never writes to the list without a confirm, the same
// contract the barcode scanner already follows.

// Clause boundaries. " and " is included knowing it over-splits genuine
// compounds ("salt and pepper" becomes two items): a spoken list joins its
// last two entries with "and" far more often than it names a compound
// product, and the review step makes the occasional wrong split a two-second
// fix rather than a lost item.
const CLAUSE_SEPARATORS = /\s*(?:[,;\n]|\band\b|\bplus\b|\bthen\b|\balso\b)\s*/gi;

// Applied repeatedly until the clause stops shrinking, so stacked openers
// ("okay so can you grab...") peel off one layer at a time.
const LEADING_FILLER: RegExp[] = [
	/^(?:u+m+|u+h+|e+rm+|hmm+|okay|ok|so|right|well|yeah|yep|alright)\b[\s,]*/i,
	/^(?:please|can you|could you|would you|will you)\s+/i,
	/^(?:remember to|don'?t forget to|don'?t forget|make sure to|make sure you)\s+/i,
	/^(?:we|i|you)\s*(?:'ve|'re|have|are)?\s*(?:completely|totally)?\s*(?:run out of|ran out of|out of)\s+/i,
	/^(?:we|i|you)\s*(?:'ll|will|should|need to|needs to|gotta|have to)?\s*(?:need|needs|want|wants)\s+(?:to\s+(?:get|buy|grab|pick up|order)\s+)?/i,
	/^(?:add|get|buy|grab|pick up|order|bring|take|put)\s+(?:me\s+|us\s+)?/i,
	/^(?:let'?s)\s+(?:get|buy|grab|add)\s+/i,
];

// "milk please", "bread as well" -- politeness that trails the item.
const TRAILING_FILLER =
	/\s*(?:,)?\s*(?:please|as well|too|thanks|thank you|okay|ok|yeah)\s*[.!?]*$/i;

const TRAILING_PUNCTUATION = /[\s.,;:!?]+$/;
const LEADING_PUNCTUATION = /^[\s.,;:!?'"-]+/;

// A clause with no letters at all ("...", "2") is noise from a dropped word,
// not an item worth adding.
const HAS_LETTERS = /[a-z]/i;

// Whole clauses that are only ever filler, whatever else Whisper heard.
const FILLER_ONLY = new Set([
	"um",
	"uh",
	"erm",
	"hmm",
	"okay",
	"ok",
	"so",
	"right",
	"well",
	"yeah",
	"yep",
	"alright",
	"thanks",
	"thank you",
	"that's it",
	"thats it",
	"that's all",
	"thats all",
	"and that's it",
	"nothing else",
	"you",
	"the",
	"a",
	"an",
	"some",
	"more",
]);

// One utterance realistically names a handful of things; anything past this
// is a transcription that ran away (Whisper repeating itself on silence is a
// known failure mode) and would spam the list.
const MAX_ITEMS = 20;

function stripFiller(clause: string): string {
	let text = clause;
	let changed = true;
	while (changed) {
		changed = false;
		const before = text;
		text = text.replace(LEADING_PUNCTUATION, "");
		for (const pattern of LEADING_FILLER) {
			text = text.replace(pattern, "");
		}
		text = text.replace(TRAILING_FILLER, "");
		text = text.replace(TRAILING_PUNCTUATION, "");
		if (text !== before) changed = true;
	}
	return text.trim();
}

/**
 * Splits a spoken transcript into candidate list items.
 *
 * Casing is left exactly as transcribed -- the UI renders items lowercase
 * via CSS, so lowercasing the stored text here would throw away real
 * information (brand names, initials) for no visual gain.
 */
export function parseSpokenItems(transcript: string): string[] {
	if (!transcript) return [];

	const clauses = transcript.replace(/\s+/g, " ").trim().split(CLAUSE_SEPARATORS);

	const items: string[] = [];
	const seen = new Set<string>();

	for (const clause of clauses) {
		const text = stripFiller(clause);
		if (!text || !HAS_LETTERS.test(text)) continue;
		if (FILLER_ONLY.has(text.toLowerCase())) continue;

		// Case-insensitive dedupe: saying "milk" twice in one breath is a
		// stutter, not a request for two entries.
		const key = text.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);

		items.push(text);
		if (items.length >= MAX_ITEMS) break;
	}

	return items;
}
