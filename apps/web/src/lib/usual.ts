import type { ActivitySnapshot } from "@tandem/doc-schema";

// "The usual" -- what this household always buys.
//
// Built from the activity log the app already keeps, which means no tracking,
// no profile, no model: the evidence is the household's own record of what it
// has added before, and it never leaves the device. A suggestion is only ever
// a chip you tap, so a wrong guess costs nothing.
//
// Frequency, not recency, decides the order. Recency would put whatever was
// added yesterday at the front, which is precisely the thing you are least
// likely to need again today; milk bought forty times is the better bet.

export interface Suggestion {
	text: string;
	/** How many times the household has added it. */
	count: number;
	/** When it was last added, for tie-breaking. */
	lastAdded: number;
}

// Below this it isn't a habit, it's a one-off. Two is deliberately low: a
// household that only ever bought bread twice still genuinely buys bread.
const MIN_OCCURRENCES = 2;

function normalize(text: string): string {
	return text.trim().toLowerCase();
}

/**
 * Suggests items this household adds often and hasn't got on the list now.
 *
 * @param activity   the household's log, newest first
 * @param present    item texts already on the list (in any state)
 * @param limit      how many chips the UI has room for
 */
export function usualItems(
	activity: ActivitySnapshot[],
	present: string[],
	limit = 8,
): Suggestion[] {
	const onList = new Set(present.map(normalize));
	const tally = new Map<string, Suggestion>();

	for (const entry of activity) {
		// Only additions count. Checking something off says you bought it once;
		// adding it is the household deciding it wants the thing, which is the
		// signal being counted here.
		if (entry.type !== "item.added" || !entry.itemText) continue;
		const key = normalize(entry.itemText);
		if (!key || onList.has(key)) continue;

		const existing = tally.get(key);
		if (existing) {
			existing.count++;
			existing.lastAdded = Math.max(existing.lastAdded, entry.timestamp);
		} else {
			// The first spelling seen wins as the display text. The log is
			// newest-first, so that's the most recent way the household wrote
			// it -- "Oat milk" rather than an older "oat milk".
			tally.set(key, { text: entry.itemText, count: 1, lastAdded: entry.timestamp });
		}
	}

	return [...tally.values()]
		.filter((suggestion) => suggestion.count >= MIN_OCCURRENCES)
		.sort((a, b) => b.count - a.count || b.lastAdded - a.lastAdded)
		.slice(0, limit);
}
