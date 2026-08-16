<script lang="ts">
	import { page } from "$app/state";
	import { goto, replaceState } from "$app/navigation";
	import { mintShortCode } from "$lib/api";
	import { buildInviteLink, inviteQrCodeDataUrl } from "$lib/invite";
	import { getDeviceLabel, rememberHousehold } from "$lib/local-households";
	import { createHouseholdSession, type HouseholdSession } from "$lib/sync/household-session";
	import { cacheSession, getOrJoinSession } from "$lib/sync/session-cache";
	import type { HouseholdSnapshot } from "@tandem/doc-schema";
	import { onDestroy, onMount } from "svelte";
	import type { PageProps } from "./$types";

	// $app/state's `page.params` is typed broadly across every route (so
	// individual keys come back as `string | undefined`); this route's
	// generated PageProps narrows it to the actual `{ roomId: string }` shape.
	let { params }: PageProps = $props();
	const roomId = params.roomId;
	let session = $state<HouseholdSession | null>(null);
	let household = $state<HouseholdSnapshot | null>(null);
	let newListName = $state("");
	let showInvite = $state(false);
	let inviteLink = $state("");
	let inviteQr = $state("");
	let inviteCode = $state("");
	let inviteError = $state("");

	let unsubscribe: (() => void) | null = null;

	onMount(async () => {
		const newName = page.url.searchParams.get("new");
		if (newName) {
			session = await createHouseholdSession(roomId, newName, getDeviceLabel());
			cacheSession(roomId, session);
			replaceState(`/h/${roomId}`, {});
		} else {
			session = await getOrJoinSession(roomId, getDeviceLabel());
		}

		unsubscribe = session.household.subscribe((snapshot) => {
			household = snapshot;
			if (snapshot.name) rememberHousehold(roomId, snapshot.name);
		});
	});

	// Intentionally does NOT destroy the session -- it's cached and shared
	// with the list-detail route (and any other route) for this household's
	// lifetime in the app, not torn down on every navigation away from this
	// one page. Only the local subscription needs cleaning up here.
	onDestroy(() => {
		unsubscribe?.();
	});

	function addList(): void {
		const name = newListName.trim();
		if (!name || !session) return;
		session.createList(name);
		newListName = "";
	}

	async function openInvite(): Promise<void> {
		showInvite = true;
		inviteError = "";
		inviteLink = buildInviteLink(roomId);
		try {
			const { shortCode } = await mintShortCode(roomId);
			inviteCode = shortCode;
			inviteQr = await inviteQrCodeDataUrl(inviteLink);
		} catch (e) {
			inviteError = e instanceof Error ? e.message : "Couldn't create an invite code";
		}
	}

	async function shareInvite(): Promise<void> {
		if (navigator.share) {
			await navigator.share({ title: household?.name ?? "Tandem household", url: inviteLink });
		} else {
			await navigator.clipboard.writeText(inviteLink);
		}
	}
</script>

<main>
	<a href="/" class="back">&larr; Households</a>

	{#if household}
		<h1>{household.name}</h1>

		<div class="lists">
			{#each household.lists.filter((l) => !l.archived) as list (list.id)}
				<a class="list-card" href={`/h/${roomId}/${list.id}`}>
					<span>{list.name}</span>
					<span class="count">{list.items.filter((i) => !i.archived).length}</span>
				</a>
			{/each}
		</div>

		<form class="add-list" onsubmit={(e) => { e.preventDefault(); addList(); }}>
			<input type="text" placeholder="New list name" bind:value={newListName} />
			<button type="submit" disabled={!newListName.trim()}>Add list</button>
		</form>

		<button class="invite-button" onclick={openInvite}>Invite someone</button>

		{#if showInvite}
			<div class="invite-panel">
				{#if inviteError}
					<p class="error">{inviteError}</p>
				{:else if inviteQr}
					<img src={inviteQr} alt="Invite QR code" width="200" height="200" />
					<p class="code">{inviteCode}</p>
					<button onclick={shareInvite}>Share link</button>
				{:else}
					<p>Generating invite…</p>
				{/if}
				<button class="close" onclick={() => (showInvite = false)}>Close</button>
			</div>
		{/if}
	{:else}
		<p>Loading…</p>
	{/if}
</main>

<style>
	main {
		padding: 1.5rem 1.25rem 3rem;
	}
	.back {
		display: inline-block;
		margin-bottom: 1rem;
		color: var(--text-dim);
		text-decoration: none;
	}
	.lists {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 1.5rem 0;
	}
	.list-card {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem;
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		text-decoration: none;
		color: var(--text);
		font-weight: 500;
	}
	.count {
		color: var(--text-dim);
		font-weight: 400;
	}
	.add-list {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}
	.add-list input {
		flex: 1;
		padding: 0.85rem 1rem;
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		color: var(--text);
	}
	button {
		padding: 0.85rem 1.25rem;
		background: var(--accent);
		color: #04211d;
		border: none;
		border-radius: 0.75rem;
		font-weight: 600;
	}
	.invite-button {
		width: 100%;
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text);
	}
	.invite-panel {
		margin-top: 1.5rem;
		padding: 1.5rem;
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		text-align: center;
	}
	.invite-panel img {
		border-radius: 0.5rem;
	}
	.code {
		font-size: 1.5rem;
		letter-spacing: 0.1em;
		font-weight: 700;
		margin: 0.75rem 0;
	}
	.close {
		background: transparent;
		color: var(--text-dim);
		margin-top: 0.75rem;
	}
	.error {
		color: var(--danger);
	}
</style>
