import { describe, expect, test } from "vitest";
import type { ActivitySnapshot } from "@tandem/doc-schema";
import { usualItems } from "./usual.js";

// The log is newest-first, as readActivity returns it.
function added(itemText: string, timestamp: number): ActivitySnapshot {
	return {
		id: `${itemText}-${timestamp}`,
		type: "item.added",
		actorLabel: "alice",
		timestamp,
		listId: "list",
		listName: "Groceries",
		itemId: `${itemText}-${timestamp}`,
		itemText,
		previousText: null,
	};
}

function checked(itemText: string, timestamp: number): ActivitySnapshot {
	return { ...added(itemText, timestamp), type: "item.checked" };
}

describe("usualItems", () => {
	test("ranks by how often the household adds something", () => {
		const activity = [
			added("milk", 500),
			added("bread", 400),
			added("milk", 300),
			added("milk", 200),
			added("bread", 100),
		];
		expect(usualItems(activity, []).map((s) => s.text)).toEqual(["milk", "bread"]);
	});

	test("a one-off is not a habit", () => {
		const activity = [added("milk", 300), added("milk", 200), added("saffron", 100)];
		expect(usualItems(activity, []).map((s) => s.text)).toEqual(["milk"]);
	});

	test("anything already on the list is not suggested", () => {
		const activity = [added("milk", 300), added("milk", 200), added("eggs", 100), added("eggs", 50)];
		expect(usualItems(activity, ["Milk"]).map((s) => s.text)).toEqual(["eggs"]);
	});

	test("matching ignores case and surrounding space", () => {
		const activity = [added("  Milk ", 300), added("milk", 200), added("MILK", 100)];
		const [first] = usualItems(activity, []);
		expect(first.count).toBe(3);
	});

	test("the most recent spelling is the one shown", () => {
		const activity = [added("Oat milk", 300), added("oat milk", 200)];
		expect(usualItems(activity, [])[0].text).toBe("Oat milk");
	});

	test("only additions count -- checking something off is not a request for it", () => {
		const activity = [checked("milk", 300), checked("milk", 200), added("eggs", 100), added("eggs", 50)];
		expect(usualItems(activity, []).map((s) => s.text)).toEqual(["eggs"]);
	});

	test("ties break towards the more recently added", () => {
		const activity = [added("eggs", 400), added("milk", 300), added("eggs", 200), added("milk", 100)];
		expect(usualItems(activity, []).map((s) => s.text)).toEqual(["eggs", "milk"]);
	});

	test("respects the limit the caller has room for", () => {
		const activity = ["a", "b", "c", "d"].flatMap((text, i) => [
			added(text, 100 + i),
			added(text, 200 + i),
		]);
		expect(usualItems(activity, [], 2)).toHaveLength(2);
	});

	test("an empty log suggests nothing", () => {
		expect(usualItems([], [])).toEqual([]);
	});
});
