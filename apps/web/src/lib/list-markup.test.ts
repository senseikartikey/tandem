import { describe, expect, test } from "vitest";
import { continueList, toggleCheckbox, toggleList } from "./list-markup.js";

describe("continuing a list on Return", () => {
	test("a bullet line continues with another bullet", () => {
		const text = "• milk";
		const edit = continueList(text, text.length)!;
		expect(edit.text).toBe("• milk\n• ");
		expect(edit.selectionStart).toBe(edit.text.length);
	});

	test("a numbered line continues with the next number", () => {
		const text = "1. milk\n2. eggs";
		const edit = continueList(text, text.length)!;
		expect(edit.text).toBe("1. milk\n2. eggs\n3. ");
	});

	test("an empty list item ends the list instead of adding another", () => {
		const text = "• milk\n• ";
		const edit = continueList(text, text.length)!;
		expect(edit.text).toBe("• milk\n");
		expect(edit.selectionStart).toBe("• milk\n".length);
	});

	test("indentation carries to the next item", () => {
		const text = "    • milk";
		expect(continueList(text, text.length)!.text).toBe("    • milk\n    • ");
	});

	test("a checked box continues as an unchecked one", () => {
		const text = "☑ milk";
		expect(continueList(text, text.length)!.text).toBe("☑ milk\n☐ ");
	});

	test("an ordinary line is left to the browser", () => {
		expect(continueList("just a sentence", 5)).toBeNull();
	});
});

describe("toggling a list on a selection", () => {
	test("adds bullets to every selected line", () => {
		const text = "milk\neggs\nbread";
		const edit = toggleList(text, 0, text.length, "bullet");
		expect(edit.text).toBe("• milk\n• eggs\n• bread");
	});

	test("pressing the same button again strips them", () => {
		const text = "• milk\n• eggs";
		expect(toggleList(text, 0, text.length, "bullet").text).toBe("milk\neggs");
	});

	test("numbers are sequential across the selection", () => {
		const text = "milk\neggs\nbread";
		expect(toggleList(text, 0, text.length, "number").text).toBe("1. milk\n2. eggs\n3. bread");
	});

	test("switching kinds replaces the marker rather than stacking it", () => {
		const text = "• milk\n• eggs";
		expect(toggleList(text, 0, text.length, "number").text).toBe("1. milk\n2. eggs");
	});

	test("only the lines the selection touches are changed", () => {
		const text = "heading\nmilk\neggs";
		const start = text.indexOf("milk");
		const edit = toggleList(text, start, start + 4, "bullet");
		expect(edit.text).toBe("heading\n• milk\neggs");
	});

	test("a blank line in the middle of a selection gets no marker", () => {
		const text = "milk\n\neggs";
		expect(toggleList(text, 0, text.length, "bullet").text).toBe("• milk\n\n• eggs");
	});
});

describe("checkboxes", () => {
	test("toggling ticks and unticks the line the caret is on", () => {
		const ticked = toggleCheckbox("☐ milk", 3)!;
		expect(ticked.text).toBe("☑ milk");
		expect(toggleCheckbox(ticked.text, 3)!.text).toBe("☐ milk");
	});

	test("a line with no checkbox is left alone", () => {
		expect(toggleCheckbox("• milk", 3)).toBeNull();
	});

	test("the caret doesn't move when a box is ticked", () => {
		expect(toggleCheckbox("☐ milk", 4)!.selectionStart).toBe(4);
	});
});
