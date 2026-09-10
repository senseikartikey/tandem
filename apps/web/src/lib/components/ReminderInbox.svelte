<script lang="ts">
	import { onDestroy } from "svelte";
	import { relativeTime } from "$lib/relative-time.js";
	import { reminderTargets, type ReminderSnapshot } from "@tandem/doc-schema";

	let {
		reminders,
		myLabel,
		onDone,
	}: {
		reminders: ReminderSnapshot[];
		myLabel: string;
		onDone: (reminderId: string) => void;
	} = $props();

	// A scheduled reminder becomes due while the page is just sitting there,
	// with no document update to trigger a re-render -- so the clock itself
	// has to tick. Twenty seconds is well under the smallest gap anyone can
	// schedule and costs nothing.
	let now = $state(Date.now());
	const clock = setInterval(() => (now = Date.now()), 20_000);
	onDestroy(() => clearInterval(clock));

	let due = $derived(
		reminders
			.filter((reminder) => reminderTargets(reminder, myLabel) && reminder.dueAt <= now)
			.sort((a, b) => a.dueAt - b.dueAt),
	);

	// Which reminders this device has already popped a system notification
	// for. Per-device local state, deliberately not in the document: whether
	// *this* phone has buzzed is not a fact the household needs to agree on.
	const SHOWN_KEY = "tandem:reminders-shown";

	function alreadyShown(): Set<string> {
		try {
			return new Set(JSON.parse(localStorage.getItem(SHOWN_KEY) ?? "[]") as string[]);
		} catch {
			return new Set();
		}
	}

	function markShown(ids: Set<string>): void {
		try {
			// Bounded: this only exists to stop repeat buzzing, so ancient ids
			// are worthless and an unbounded list in localStorage is not.
			localStorage.setItem(SHOWN_KEY, JSON.stringify([...ids].slice(-200)));
		} catch {
			// Private mode or blocked storage: at worst the same reminder
			// notifies twice, which is better than failing to render.
		}
	}

	$effect(() => {
		if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
		// Only when the app isn't in front of them -- the banner below is
		// already saying this, and a system notification for a page you're
		// looking at is just noise.
		if (document.visibilityState !== "hidden") return;

		const shown = alreadyShown();
		let changed = false;
		for (const reminder of due) {
			if (shown.has(reminder.id)) continue;
			shown.add(reminder.id);
			changed = true;
			new Notification(`${reminder.fromLabel} needs: ${reminder.itemText}`, {
				body: reminder.message || `on ${reminder.listName}`,
				icon: "/icons/icon-192.png",
				tag: reminder.id,
			});
		}
		if (changed) markShown(shown);
	});
</script>

{#if due.length > 0}
	<ul class="reminders" aria-label="Reminders for you">
		{#each due as reminder (reminder.id)}
			<li class="reminder">
				<span class="bell" aria-hidden="true">🔔</span>
				<div class="body">
					<span class="headline">
						<strong>{reminder.fromLabel}</strong> asked you for
						<strong>{reminder.itemText}</strong>
					</span>
					{#if reminder.message}
						<span class="message">“{reminder.message}”</span>
					{/if}
					<span class="meta">{reminder.listName} · {relativeTime(reminder.dueAt, now)}</span>
				</div>
				<button class="btn btn-teal btn-small" onclick={() => onDone(reminder.id)}>got it</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.reminders {
		list-style: none;
		padding: 0;
		margin: 0 0 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	/* Coral, and the loudest thing on the screen: this is someone asking you
	   for something, which outranks everything else in the view. */
	.reminder {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.85rem 1rem;
		background: var(--color-primary);
		border: var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
	}
	.bell {
		font-size: 1.25rem;
		line-height: 1;
	}
	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.headline {
		font-size: 0.92rem;
		line-height: 1.35;
		color: var(--text-primary);
	}
	.headline strong {
		font-family: var(--font-display);
		font-weight: 400;
		text-transform: lowercase;
	}
	.message {
		font-size: 0.85rem;
		color: var(--text-primary);
		opacity: 0.85;
	}
	.meta {
		font-family: var(--font-mono);
		font-size: 0.66rem;
		opacity: 0.7;
	}
</style>
