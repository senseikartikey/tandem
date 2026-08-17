<script lang="ts">
	import { goto } from "$app/navigation";
	import { parseInviteFragment } from "$lib/invite";
	import { rememberHousehold } from "$lib/local-households";
	import { joinHouseholdSession } from "$lib/sync/household-session";
	import { getDeviceLabel } from "$lib/local-households";
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
			const session = await joinHouseholdSession(roomId, getDeviceLabel());
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

<main>
	{#if status === "resolving"}
		<p>joining household…</p>
	{:else if status === "naming"}
		<p>still waiting to sync -- the household data hasn't arrived yet. you can open it anyway; it'll fill in once sync completes.</p>
		<button class="btn" onclick={continueAnyway}>open anyway</button>
	{:else}
		<p class="error">{errorMessage}</p>
		<a href="/">back home</a>
	{/if}
</main>

<style>
	main {
		padding: 2rem 1.25rem;
		text-align: center;
	}
	.error {
		color: var(--color-primary);
		font-weight: 600;
	}
	button {
		margin-top: 1rem;
	}
</style>
