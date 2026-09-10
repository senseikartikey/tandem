import { describe, expect, test } from "vitest";
import { relativeTime } from "./relative-time.js";

const NOW = new Date("2026-06-15T12:00:00Z").getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
	test("anything under a minute reads as just now", () => {
		expect(relativeTime(NOW - 1_000, NOW)).toBe("just now");
		expect(relativeTime(NOW - 59_000, NOW)).toBe("just now");
	});

	test("a timestamp slightly in the future (device clock skew) is not negative", () => {
		expect(relativeTime(NOW + 3_000, NOW)).toBe("just now");
	});

	test("counts minutes, then hours", () => {
		expect(relativeTime(NOW - 4 * MINUTE, NOW)).toBe("4m ago");
		expect(relativeTime(NOW - 59 * MINUTE, NOW)).toBe("59m ago");
		expect(relativeTime(NOW - 3 * HOUR, NOW)).toBe("3h ago");
	});

	test("yesterday, then days, within the first week", () => {
		expect(relativeTime(NOW - 26 * HOUR, NOW)).toBe("yesterday");
		expect(relativeTime(NOW - 3 * DAY, NOW)).toBe("3d ago");
	});

	test("past a week it becomes a date", () => {
		const formatted = relativeTime(NOW - 30 * DAY, NOW);
		expect(formatted).not.toMatch(/ago/);
		expect(formatted).toMatch(/May/);
	});

	test("a date from another year carries the year", () => {
		expect(relativeTime(new Date("2024-03-02T09:00:00Z").getTime(), NOW)).toMatch(/2024/);
	});
});
