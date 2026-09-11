<script lang="ts">
	import { enablePush, pushState, type PushState } from "$lib/push.js";
	import { getDeviceLabel } from "$lib/local-households";

	let {
		itemText,
		people,
		roomId,
		onSend,
		onClose,
	}: {
		itemText: string;
		/** Device labels seen in this household, minus your own. */
		people: string[];
		roomId: string;
		onSend: (choice: { toLabel: string | null; dueAt: number | null; message: string }) => void;
		onClose: () => void;
	} = $props();

	// Defaults to everyone: with one housemate that's the same thing as
	// naming them, and with several it's the safer guess.
	let toLabel = $state<string | null>(null);
	let message = $state("");
	let when = $state<"now" | "hour" | "evening" | "morning" | "custom">("now");
	let customAt = $state("");
	let push = $state<PushState>(pushState());
	let enabling = $state(false);

	// Offsets, not fixed clock times, except the two that are genuinely
	// clock-shaped ("this evening", "tomorrow morning") -- those are what
	// people actually say to each other about shopping.
	function dueAt(): number | null {
		const now = new Date();
		switch (when) {
			case "now":
				return null;
			case "hour":
				return Date.now() + 60 * 60 * 1000;
			case "evening": {
				const evening = new Date(now);
				evening.setHours(18, 0, 0, 0);
				// Past six already? Then "this evening" can only mean tomorrow.
				if (evening.getTime() <= Date.now()) evening.setDate(evening.getDate() + 1);
				return evening.getTime();
			}
			case "morning": {
				const morning = new Date(now);
				morning.setDate(morning.getDate() + 1);
				morning.setHours(9, 0, 0, 0);
				return morning.getTime();
			}
			case "custom": {
				const parsed = customAt ? new Date(customAt).getTime() : NaN;
				return Number.isNaN(parsed) ? null : parsed;
			}
		}
	}

	async function turnOnPush(): Promise<void> {
		enabling = true;
		push = await enablePush(roomId, getDeviceLabel());
		enabling = false;
	}

	function send(): void {
		onSend({ toLabel, dueAt: dueAt(), message: message.trim() });
	}

	// The datetime-local input wants local time in ISO shape, and needs a
	// floor of "now" so a reminder can't be scheduled into the past.
	function localIso(date: Date): string {
		const offset = date.getTimezoneOffset() * 60000;
		return new Date(date.getTime() - offset).toISOString().slice(0, 16);
	}
	const earliest = localIso(new Date());
</script>

<div class="sheet-overlay" role="dialog" aria-label="Send a reminder" aria-modal="true">
	<div class="sheet card">
		<div class="sheet-header">
			<h3>remind about</h3>
			<button class="btn btn-ghost btn-small" onclick={onClose}>close</button>
		</div>

		<p class="item-name">{itemText}</p>

		<span class="eyebrow">— who</span>
		<div class="chips">
			<button class="chip" class:selected={toLabel === null} onclick={() => (toLabel = null)}>
				everyone
			</button>
			{#each people as person (person)}
				<button
					class="chip"
					class:selected={toLabel === person}
					onclick={() => (toLabel = person)}
				>
					{person}
				</button>
			{/each}
		</div>
		{#if people.length === 0}
			<p class="note">
				nobody else has opened this household on a device yet — “everyone” will reach them when
				they do.
			</p>
		{/if}

		<span class="eyebrow">— when</span>
		<div class="chips">
			<button class="chip" class:selected={when === "now"} onclick={() => (when = "now")}>now</button>
			<button class="chip" class:selected={when === "hour"} onclick={() => (when = "hour")}>
				in an hour
			</button>
			<button class="chip" class:selected={when === "evening"} onclick={() => (when = "evening")}>
				this evening
			</button>
			<button class="chip" class:selected={when === "morning"} onclick={() => (when = "morning")}>
				tomorrow 9am
			</button>
			<button class="chip" class:selected={when === "custom"} onclick={() => (when = "custom")}>
				pick a time
			</button>
		</div>
		{#if when === "custom"}
			<input class="input" type="datetime-local" bind:value={customAt} min={earliest} />
		{/if}

		<span class="eyebrow">— note (optional)</span>
		<input class="input" type="text" placeholder="e.g. the oat one, not the almond" bind:value={message} maxlength="120" />

		<button class="btn btn-ink btn-block" onclick={send}>
			send reminder <span class="btn-arrow">→</span>
		</button>

		<!-- Push is the doorbell, not the message: the reminder is written to
		     the household either way, so this is an aside rather than a gate. -->
		{#if push === "off"}
			<button class="push-row" onclick={() => void turnOnPush()} disabled={enabling}>
				🔔 {enabling ? "asking…" : "also get reminders on this device"}
			</button>
		{:else if push === "server-off"}
			<p class="note">
				the server can't send notifications yet, so this reminder will reach them when they
				next open tandem.
			</p>
		{:else if push === "needs-install"}
			<p class="note">
				on iPhone, notifications only work once tandem is added to the home screen (share →
				add to home screen). the reminder still arrives in the app either way.
			</p>
		{:else if push === "blocked"}
			<p class="note">
				notifications are blocked for this site, so reminders will only show inside the app.
			</p>
		{:else if push === "on"}
			<p class="note">🔔 this device gets reminders.</p>
		{/if}
	</div>
</div>

<style>
	.sheet-overlay {
		position: fixed;
		inset: 0;
		background: rgba(17, 17, 17, 0.7);
		display: flex;
		align-items: flex-end;
		justify-content: center;
		padding: 1rem;
		z-index: 100;
	}
	.sheet {
		width: 100%;
		max-width: 420px;
		max-height: 92dvh;
		overflow-y: auto;
		padding: 1.35rem;
		background: var(--bg-surface);
		box-shadow: var(--shadow-xl);
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.sheet-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.item-name {
		font-family: var(--font-display);
		font-size: 1.5rem;
		line-height: 1.1;
		letter-spacing: -0.02em;
		text-transform: lowercase;
		color: var(--text-primary);
		margin-bottom: 0.35rem;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 0.35rem;
	}
	/* Chips rather than a <select>: the whole choice is visible at a glance,
	   and on a phone it's one tap instead of a picker wheel. */
	.chip {
		padding: 0.45rem 0.85rem;
		border: var(--border-thin);
		border-radius: var(--radius-pill);
		background: var(--bg-page);
		font-family: var(--font-mono);
		font-size: 0.78rem;
		color: var(--text-primary);
		cursor: pointer;
		transition:
			transform 0.1s ease,
			box-shadow 0.1s ease,
			background 0.1s ease;
	}
	.chip.selected {
		background: var(--color-yellow);
		box-shadow: var(--shadow-sm);
		transform: translate(-1px, -1px);
		font-weight: 600;
	}
	.note {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		line-height: 1.5;
		color: var(--text-secondary);
	}
	.push-row {
		align-self: flex-start;
		background: none;
		border: none;
		padding: 0.25rem 0;
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--text-secondary);
		text-decoration: underline;
		cursor: pointer;
	}
	.push-row:hover:not(:disabled) {
		color: var(--text-primary);
	}
</style>
