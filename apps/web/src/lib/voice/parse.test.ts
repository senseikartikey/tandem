// The recognition step can't be tested without a microphone; this step can,
// so everything that decides what actually lands in someone's list is kept
// here, in pure functions, and covered.

import { describe, expect, test } from "vitest";
import { parseSpokenItems } from "./parse.js";
import { cleanTranscript } from "./transcriber.js";

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

describe("preamble", () => {
	// The case that shipped broken: a greeting in front of the request left
	// the whole sentence in the item.
	test("drops a greeting before the request", () => {
		expect(parseSpokenItems("Hello I need milk and sourdough bread")).toEqual([
			"milk",
			"sourdough bread",
		]);
	});

	test("drops a plain 'we need' opener", () => {
		expect(parseSpokenItems("we need coffee")).toEqual(["coffee"]);
	});

	test("drops stacked openers", () => {
		expect(parseSpokenItems("okay so can you grab some tomatoes")).toEqual(["tomatoes"]);
	});

	test("handles 'need to get'", () => {
		expect(parseSpokenItems("I need to get washing up liquid")).toEqual(["washing up liquid"]);
	});

	test("handles running out", () => {
		expect(parseSpokenItems("we're out of bin bags")).toEqual(["bin bags"]);
		expect(parseSpokenItems("we've ran out of kitchen roll")).toEqual(["kitchen roll"]);
		expect(parseSpokenItems("we're running low on dishwasher tablets")).toEqual([
			"dishwasher tablets",
		]);
	});

	test("handles 'pick up' and 'don't forget'", () => {
		expect(parseSpokenItems("pick up the dry cleaning")).toEqual(["dry cleaning"]);
		expect(parseSpokenItems("don't forget birthday candles")).toEqual(["birthday candles"]);
	});

	test("a trigger word inside the item itself is left alone", () => {
		// Nothing precedes "get" here except the item's own words, so the
		// clause is not a request-with-preamble and must survive intact.
		expect(parseSpokenItems("a card to get well soon")).toEqual(["a card to get well soon"]);
	});

	test("an item that merely contains a preamble word is untouched", () => {
		expect(parseSpokenItems("hey presto pizza base")).toEqual(["hey presto pizza base"]);
	});
});

describe("trailing filler", () => {
	test("strips a trailing please", () => {
		expect(parseSpokenItems("sourdough please")).toEqual(["sourdough"]);
	});

	test("strips 'on the list'", () => {
		expect(parseSpokenItems("put milk on the list")).toEqual(["milk"]);
	});

	test("strips 'as well' and 'too'", () => {
		expect(parseSpokenItems("olives as well, capers too")).toEqual(["olives", "capers"]);
	});

	test("drops clauses that are only filler", () => {
		expect(parseSpokenItems("milk, eggs, that's it")).toEqual(["milk", "eggs"]);
	});

	test("a greeting stranded in its own clause is dropped", () => {
		expect(parseSpokenItems("morning, don't forget the school forms")).toEqual([
			"school forms",
		]);
	});

	test("drops clauses with no letters left", () => {
		expect(parseSpokenItems("milk, ...,")).toEqual(["milk"]);
	});

	test("drops a request that named nothing", () => {
		expect(parseSpokenItems("hello I need")).toEqual([]);
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

describe("whisper artifacts", () => {
	test("bracketed and parenthesised event tags are dropped", () => {
		expect(cleanTranscript("[BLANK_AUDIO] milk (coughs) and eggs")).toBe("milk and eggs");
	});

	test("the subtitle boilerplate whisper hallucinates on silence is dropped", () => {
		expect(cleanTranscript("Thanks for watching!")).toBe("");
		expect(cleanTranscript("milk. Please subscribe")).toBe("milk.");
	});

	test("ordinary speech is untouched apart from whitespace", () => {
		expect(cleanTranscript("  two  litres of milk ")).toBe("two litres of milk");
	});
});
