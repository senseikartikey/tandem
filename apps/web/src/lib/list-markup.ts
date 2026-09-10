// Bullet, numbered and checkbox lists inside a plain textarea.
//
// The note body is a Y.Text bound straight to a <textarea> (see
// bind-y-text.ts), and that is what makes two people typing in one paragraph
// merge character by character. Rich text would mean a document model per
// editor, a schema for it, and a merge story for that schema -- a large
// amount of machinery to buy formatting this app doesn't otherwise need.
//
// So the lists here are literal characters in the text: "• milk", "1. milk",
// "☐ milk". They survive sync for free (they're just text), they read
// correctly anywhere the note is shown, including the index preview, and the
// behaviour people actually want from a list -- pressing return continues it,
// pressing return on an empty one ends it -- is a few rules over the line the
// caret is on.

export const BULLET = "• ";
export const CHECKBOX = "☐ ";
export const CHECKED = "☑ ";

export type ListKind = "bullet" | "number" | "checkbox";

// Captures leading whitespace and the marker, so a line can be rewritten
// without disturbing its indentation.
const BULLET_LINE = /^(\s*)(•\s+)/;
const CHECK_LINE = /^(\s*)([☐☑]\s+)/;
const NUMBER_LINE = /^(\s*)(\d+)([.)]\s+)/;

export interface LineEdit {
	/** The full replacement text for the document. */
	text: string;
	/** Where the caret should end up afterwards. */
	selectionStart: number;
	selectionEnd: number;
}

interface LineBounds {
	start: number;
	end: number;
	value: string;
}

function lineAt(text: string, index: number): LineBounds {
	const start = text.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
	const nextBreak = text.indexOf("\n", index);
	const end = nextBreak === -1 ? text.length : nextBreak;
	return { start, end, value: text.slice(start, end) };
}

function markerOf(line: string): { indent: string; marker: string; body: string } | null {
	const bullet = BULLET_LINE.exec(line);
	if (bullet) return { indent: bullet[1], marker: bullet[2], body: line.slice(bullet[0].length) };
	const check = CHECK_LINE.exec(line);
	if (check) return { indent: check[1], marker: check[2], body: line.slice(check[0].length) };
	const numbered = NUMBER_LINE.exec(line);
	if (numbered) {
		return {
			indent: numbered[1],
			marker: numbered[2] + numbered[3],
			body: line.slice(numbered[0].length),
		};
	}
	return null;
}

/**
 * What pressing Return on the current line should do.
 *
 * Returns null when the line isn't a list item, so the caller can let the
 * browser insert an ordinary newline and keep native undo intact.
 */
export function continueList(text: string, caret: number): LineEdit | null {
	const line = lineAt(text, caret);
	const parsed = markerOf(line.value);
	if (!parsed) return null;

	// Return on an empty list item ends the list, exactly as it does in
	// every notes app: the empty marker is removed rather than another one
	// being added below it.
	if (parsed.body.trim() === "") {
		const before = text.slice(0, line.start);
		const after = text.slice(line.end);
		return { text: before + after, selectionStart: line.start, selectionEnd: line.start };
	}

	const numbered = NUMBER_LINE.exec(line.value);
	// A checked box never continues as checked -- the next thing you type is
	// a new task, not an already-done one.
	const nextMarker = numbered
		? `${Number(numbered[2]) + 1}${numbered[3]}`
		: parsed.marker === CHECKED
			? CHECKBOX
			: parsed.marker;

	const insertion = `\n${parsed.indent}${nextMarker}`;
	const caretAfter = caret + insertion.length;
	return {
		text: text.slice(0, caret) + insertion + text.slice(caret),
		selectionStart: caretAfter,
		selectionEnd: caretAfter,
	};
}

function markerFor(kind: ListKind, ordinal: number): string {
	if (kind === "bullet") return BULLET;
	if (kind === "checkbox") return CHECKBOX;
	return `${ordinal}. `;
}

/**
 * Adds or removes list markers across every line the selection touches.
 *
 * Toggling is decided by the first affected line: if it already carries the
 * requested kind, the whole run is stripped; otherwise the whole run is
 * converted. That matches how a formatting button is expected to behave when
 * a selection is a mix of both.
 */
export function toggleList(
	text: string,
	selectionStart: number,
	selectionEnd: number,
	kind: ListKind,
): LineEdit {
	const first = lineAt(text, selectionStart);
	const last = lineAt(text, selectionEnd);
	const block = text.slice(first.start, last.end);
	const lines = block.split("\n");

	const matchesKind = (line: string): boolean => {
		if (kind === "bullet") return BULLET_LINE.test(line);
		if (kind === "checkbox") return CHECK_LINE.test(line);
		return NUMBER_LINE.test(line);
	};

	const stripping = matchesKind(lines[0]);
	let ordinal = 1;
	const rewritten = lines.map((line) => {
		const parsed = markerOf(line);
		const bare = parsed ? parsed.indent + parsed.body : line;
		if (stripping) return bare;
		// An empty trailing line shouldn't sprout a marker of its own.
		if (bare.trim() === "" && lines.length > 1) return bare;
		const indent = parsed?.indent ?? /^\s*/.exec(line)?.[0] ?? "";
		return indent + markerFor(kind, ordinal++) + bare.trimStart();
	});

	const replacement = rewritten.join("\n");
	return {
		text: text.slice(0, first.start) + replacement + text.slice(last.end),
		// Selecting the rewritten block keeps a second press (to undo the
		// toggle) working on the same lines.
		selectionStart: first.start,
		selectionEnd: first.start + replacement.length,
	};
}

/**
 * Flips the checkbox on the line the caret sits in, if there is one.
 *
 * Returns null when the line has no checkbox, so callers can ignore the
 * keystroke rather than swallowing it.
 */
export function toggleCheckbox(text: string, caret: number): LineEdit | null {
	const line = lineAt(text, caret);
	const check = CHECK_LINE.exec(line.value);
	if (!check) return null;

	const wasChecked = check[2].startsWith("☑");
	const marker = wasChecked ? CHECKBOX : CHECKED;
	const rewritten = check[1] + marker + line.value.slice(check[0].length);
	return {
		text: text.slice(0, line.start) + rewritten + text.slice(line.end),
		selectionStart: caret,
		selectionEnd: caret,
	};
}
