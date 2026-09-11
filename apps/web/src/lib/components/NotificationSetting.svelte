<script lang="ts">
	import { enablePush, pushState, sendTestPush, type PushState } from "$lib/push.js";
	import { getDeviceLabel } from "$lib/local-households";

	let { roomId }: { roomId: string } = $props();

	// This sits on the household page, not buried in the send-a-reminder
	// sheet, because the person who needs it is the one *receiving* nudges --
	// and they have no reason to ever open that sheet. A device that never
	// registers can only ever be told things while the app is open, which is
	// precisely when a notification is pointless.
	let status = $state<PushState>(pushState());
	let busy = $state(false);
	let tested = $state<"idle" | "sent" | "failed">("idle");

	async function turnOn(): Promise<void> {
		busy = true;
		status = await enablePush(roomId, getDeviceLabel());
		busy = false;
		// Proving it immediately beats asking someone to go and test it: if
		// this doesn't arrive, they find out now rather than when a reminder
		// they were counting on never showed up.
		if (status === "on") void test();
	}

	async function test(): Promise<void> {
		tested = "idle";
		const sent = await sendTestPush();
		tested = sent ? "sent" : "failed";
	}
</script>

<div class="notify" data-state={status}>
	<span class="icon" aria-hidden="true">🔔</span>

	<div class="copy">
		{#if status === "on"}
			<span class="title">notifications on</span>
			<span class="detail">
				{#if tested === "sent"}
					test sent — it should appear even with tandem closed.
				{:else if tested === "failed"}
					couldn't deliver a test to this device. try turning it off and on in your browser's
					site settings.
				{:else}
					this device is nudged when someone reminds you.
				{/if}
			</span>
		{:else if status === "needs-install"}
			<span class="title">add tandem to your home screen</span>
			<span class="detail">
				on iphone, notifications only reach apps installed to the home screen. tap share → add
				to home screen, then open it from there.
			</span>
		{:else if status === "blocked"}
			<span class="title">notifications are blocked</span>
			<span class="detail">
				allow them for this site in your browser settings, then reload. reminders still show
				inside the app.
			</span>
		{:else if status === "server-off"}
			<span class="title">notifications aren't set up on the server</span>
			<span class="detail">reminders will still reach you whenever you open tandem.</span>
		{:else if status === "unsupported"}
			<span class="title">this browser can't do notifications</span>
			<span class="detail">reminders still show inside the app.</span>
		{:else}
			<span class="title">get reminders on this device</span>
			<span class="detail">
				so a nudge reaches you when tandem is closed — otherwise you only see it once you open
				the app.
			</span>
		{/if}
	</div>

	{#if status === "off"}
		<button class="btn btn-ink btn-small" onclick={() => void turnOn()} disabled={busy}>
			{busy ? "asking…" : "turn on"}
		</button>
	{:else if status === "on"}
		<button class="btn btn-ghost btn-small" onclick={() => void test()}>test</button>
	{/if}
</div>

<style>
	.notify {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.85rem 1rem;
		margin-bottom: 1.25rem;
		border: var(--border);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
		box-shadow: var(--shadow-sm);
	}
	/* Loud while it's an unanswered ask, quiet once it's handled -- a
	   permanently shouting settings row is just noise after the first day. */
	.notify[data-state="off"] {
		background: var(--color-yellow);
		box-shadow: var(--shadow-md);
	}
	.notify[data-state="on"] {
		border: var(--border-thin);
		box-shadow: none;
	}
	.icon {
		font-size: 1.15rem;
		line-height: 1;
	}
	.copy {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.title {
		font-family: var(--font-display);
		font-size: 0.95rem;
		letter-spacing: -0.02em;
		text-transform: lowercase;
	}
	.detail {
		font-family: var(--font-mono);
		font-size: 0.68rem;
		line-height: 1.45;
		color: var(--text-secondary);
	}
</style>
