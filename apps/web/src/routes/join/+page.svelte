<script lang="ts">
	import { goto } from "$app/navigation";
	import { parseInviteFragment } from "$lib/invite";
	import { rememberHousehold } from "$lib/local-households";
	import { joinHouseholdSession } from "$lib/sync/household-session";
	import { onMount } from "svelte";

	let status = $state<"resolving" | "naming" | "error">("resolving");
	let roomId = $state("");
	let householdName = $state("");
	let errorMessage = $state("");

	onMount(async () => {
		const parsed = parseInviteFragment(window.location.hash);
		if (!parsed) {
			status = "error";
			errorMessage = "This invite link looks incomplete or invalid.";
			return;
		}
		roomId = parsed.roomId;

		try {
			const session = await joinHouseholdSession(roomId);
			// household.subscribe() calls its callback synchronously on the
			// initial subscribe (see household-store.ts) -- if the data is
			// already available (e.g. another tab of this same browser already
			// synced it via the shared IndexedDB store), the callback can fire
			// before `subscribe()` has even returned, so `unsubscribe` must be
			// declared before the call, not destructured from its result.
			let unsubscribe: (() => void) | null = null;
			unsubscribe = session.household.subscribe(({ household: snapshot }) => {
				if (snapshot.name) {
					rememberHousehold(roomId, snapshot.name);
					unsubscribe?.();
					session.destroy();
					goto(`/h/${roomId}`);
				}
			});
			// If the household hasn't synced within a few seconds (first-time
			// join and the inviter's device isn't currently online to relay
			// history), let the user proceed anyway rather than hang forever --
			// the view still opens and will populate whenever sync completes.
			setTimeout(() => {
				if (status === "resolving") {
					status = "naming";
				}
			}, 4000);
		} catch (e) {
			status = "error";
			errorMessage = e instanceof Error ? e.message : "Couldn't join this household.";
		}
	});

	function continueAnyway(): void {
		rememberHousehold(roomId, "household");
		goto(`/h/${roomId}`);
	}
</script>

<main class="app-shell">
	{#if status === "resolving"}
		<span class="tag">◐ connecting</span>
		<h1>joining…</h1>
		<p>finding the household behind that link.</p>
	{:else if status === "naming"}
		<span class="tag">◔ still syncing</span>
		<h1>nearly there.</h1>
		<p>the household data hasn't arrived yet -- nobody with a copy is online right now. you can open it anyway; it'll fill in the moment sync completes.</p>
		<button class="btn btn-ink" onclick={continueAnyway}>open anyway <span class="btn-arrow">→</span></button>
	{:else}
		<span class="tag">✕ bad link</span>
		<h1>that link didn't work.</h1>
		<p class="error">{errorMessage}</p>
		<a class="btn btn-ghost" href="/">back home</a>
	{/if}
</main>

<style>
	main {
		padding: 4rem 1.25rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		text-align: center;
	}
	main :global(h1) {
		font-size: clamp(2.4rem, 11vw, 3.6rem);
	}
	main :global(p) {
		max-width: 34rem;
	}
	.error {
		font-family: var(--font-mono);
		font-size: 0.85rem;
		color: var(--text-primary);
	}
	.btn {
		margin-top: 0.75rem;
	}
</style>
