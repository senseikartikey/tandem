// The transcription step can't be tested without a model and a microphone;
// this step can, so everything that decides what actually lands in someone's
// list is kept here, in pure functions, and covered.

import { describe, expect, test } from "vitest";
import { parseSpokenItems } from "./parse.js";

describe("splitting", () => {
	test("splits a spoken list on commas and a trailing 'and'", () => {
		expect(parseSpokenItems("milk, eggs and bread")).toEqual(["milk", "eggs", "bread"]);
	});

	test("keeps a single item as one item", () => {
		expect(parseSpokenItems("oat milk")).toEqual(["oat milk"]);
	});

	test("splits on 'then' and 'plus'", () => {
		expect(parseSpokenItems("coffee then filters plus a kettle descaler")).toEqual([
			"coffee",
			"filters",
			"a kettle descaler",
		]);
	});

	test("keeps quantities and descriptors attached to their item", () => {
		expect(parseSpokenItems("two litres of whole milk, a dozen eggs")).toEqual([
			"two litres of whole milk",
			"a dozen eggs",
		]);
	});
});

describe("filler stripping", () => {
	test("strips a 'we need' opener", () => {
		expect(parseSpokenItems("we need coffee")).toEqual(["coffee"]);
	});

	test("strips a 'we're out of' opener", () => {
		expect(parseSpokenItems("we're out of washing up liquid")).toEqual(["washing up liquid"]);
	});

	test("strips 'we've run out of'", () => {
		expect(parseSpokenItems("we've run out of bin bags")).toEqual(["bin bags"]);
	});

	test("strips stacked openers", () => {
		expect(parseSpokenItems("okay so can you grab some tomatoes")).toEqual(["some tomatoes"]);
	});

	test("strips a trailing please", () => {
		expect(parseSpokenItems("sourdough please")).toEqual(["sourdough"]);
	});

	test("strips a 'don't forget' opener", () => {
		expect(parseSpokenItems("don't forget birthday candles")).toEqual(["birthday candles"]);
	});

	test("drops clauses that are only filler", () => {
		expect(parseSpokenItems("milk, eggs, that's it")).toEqual(["milk", "eggs"]);
	});

	test("drops clauses with no letters left", () => {
		expect(parseSpokenItems("milk, ...,")).toEqual(["milk"]);
	});
});

describe("robustness", () => {
	test("an empty or whitespace-only transcript yields nothing", () => {
		expect(parseSpokenItems("")).toEqual([]);
		expect(parseSpokenItems("   \n ")).toEqual([]);
	});

	test("a stuttered repeat is deduped case-insensitively", () => {
		expect(parseSpokenItems("Milk, milk, eggs")).toEqual(["Milk", "eggs"]);
	});

	test("casing is preserved as transcribed", () => {
		expect(parseSpokenItems("Yorkshire Tea and BBQ sauce")).toEqual([
			"Yorkshire Tea",
			"BBQ sauce",
		]);
	});

	test("a runaway repeating transcription is capped", () => {
		const runaway = Array.from({ length: 60 }, (_, i) => `item ${i}`).join(", ");
		expect(parseSpokenItems(runaway)).toHaveLength(20);
	});

	test("a long sentence with no separators stays one item rather than being dropped", () => {
		const sentence = "the big blue bottle of olive oil from the shop near the station";
		expect(parseSpokenItems(sentence)).toEqual([sentence]);
	});
});
