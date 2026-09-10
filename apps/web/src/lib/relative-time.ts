// "edited 4m ago" beats a timestamp for the question people actually ask of
// a shared note ("is this fresh, or did someone write it in March?").
//
// Deliberately not Intl.RelativeTimeFormat: that formats one unit you've
// already chosen, so the part worth getting right -- which unit, and when to
// stop counting and show a date -- would still be hand-written here, and the
// output ("4 minutes ago") is wordier than this UI wants.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Formats a past timestamp as a short relative string.
 *
 * `now` is injectable so this is testable without freezing the clock.
 */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
	const elapsed = now - timestamp;

	// Clock skew between two devices in one household is normal and small;
	// a note "edited in 3 seconds" would just look broken.
	if (elapsed < MINUTE) return "just now";
	if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
	if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
	if (elapsed < 2 * DAY) return "yesterday";
	if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;

	// Past a week, "37d ago" stops meaning anything -- a date is easier to
	// place. The year is only worth the space once it isn't this one.
	const date = new Date(timestamp);
	const sameYear = date.getFullYear() === new Date(now).getFullYear();
	return date.toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		...(sameYear ? {} : { year: "numeric" }),
	});
}
