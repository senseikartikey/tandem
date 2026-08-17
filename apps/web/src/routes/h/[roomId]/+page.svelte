<script lang="ts">
	import { page } from "$app/state";
	import { goto, replaceState } from "$app/navigation";
	import { describeApiError, mintShortCode } from "$lib/api";
	import { buildInviteLink, inviteQrCodeDataUrl } from "$lib/invite";
	import { rememberHousehold } from "$lib/local-households";
	import { createHouseholdSession, type HouseholdSession } from "$lib/sync/household-session";
	import { cacheSession, getOrJoinSession } from "$lib/sync/session-cache";
	import type { ActivitySnapshot, HouseholdSnapshot } from "@tandem/doc-schema";
	import { onDestroy, onMount } from "svelte";
	import type { PageProps } from "./$types";
	import YourName from "$lib/components/YourName.svelte";

	// $app/state's `page.params` is typed broadly across every route (so
	// individual keys come back as `string | undefined`); this route's
	// generated PageProps narrows it to the actual `{ roomId: string }` shape.
	let { params }: PageProps = $props();
	const roomId = params.roomId;
	let session = $state<HouseholdSession | null>(null);
	let household = $state<HouseholdSnapshot | null>(null);
	let activity = $state<ActivitySnapshot[]>([]);
	let newListName = $state("");
	let showInvite = $state(false);
	let showRemovedLists = $state(false);
	let inviteLink = $state("");
	let inviteQr = $state("");
	let inviteCode = $state("");
	let inviteError = $state("");

	let unsubscribe: (() => void) | null = null;

	onMount(async () => {
		const newName = page.url.searchParams.get("new");
		if (newName) {
			session = await createHouseholdSession(roomId, newName);
			cacheSession(roomId, session);
			replaceState(`/h/${roomId}`, {});
		} else {
			session = await getOrJoinSession(roomId);
		}

		unsubscribe = session.household.subscribe(({ household: snapshot, activity: entries }) => {
			household = snapshot;
			activity = entries;
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

	function removeList(listId: string): void {
		session?.archiveList(listId);
	}

	// Once a list is archived it drops out of the .lists rendering above and
	// nothing in the app links to its /[listId] route anymore -- there's no
	// per-list view left to host a restore control on. This panel is the only
	// reachable place a removed list's undo can live.
	let removedLists = $derived(
		(household?.lists ?? [])
			.filter((l) => l.archived)
			.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
	);

	function removedByLabel(listId: string): string | null {
		const entry = activity.find((e) => e.listId === listId && e.type === "list.archived");
		return entry?.actorLabel ?? null;
	}

	function restoreList(listId: string): void {
		session?.unarchiveList(listId);
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
			inviteError = describeApiError(e, "couldn't create an invite code");
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
	<a href="/" class="back">&larr; households</a>

	{#if household}
		<h1>{household.name}</h1>

		<YourName />

		<div class="lists">
			{#each household.lists.filter((l) => !l.archived) as list, i (list.id)}
				<div class="card card-flat list-row">
					<a class="list-card" href={`/h/${roomId}/${list.id}`}>
						<span class="list-name">{list.name}</span>
						<span class="count" style={`background:${["#4ecdc4", "#ffe566", "#f9a8b8", "#c4b5fd"][i % 4]}`}>
							{list.items.filter((i) => !i.archived).length}
						</span>
					</a>
					<button
						class="remove"
						onclick={() => removeList(list.id)}
						aria-label={`Remove ${list.name}`}
						title="remove list"
					>
						✕
					</button>
				</div>
			{/each}
		</div>

		<form
			class="add-list"
			onsubmit={(e) => {
				e.preventDefault();
				addList();
			}}
		>
			<input class="input" type="text" placeholder="new list name" bind:value={newListName} />
			<button class="btn" type="submit" disabled={!newListName.trim()}>add list</button>
		</form>

		<button class="btn btn-ghost invite-button" onclick={openInvite}>invite someone</button>

		{#if showInvite}
			<div class="card invite-panel">
				{#if inviteError}
					<p class="error">{inviteError}</p>
				{:else if inviteQr}
					<img class="qr" src={inviteQr} alt="Invite QR code" width="200" height="200" />
					<p class="code">{inviteCode}</p>
					<button class="btn btn-teal" onclick={shareInvite}>share link</button>
				{:else}
					<p>generating invite…</p>
				{/if}
				<button class="btn-close" onclick={() => (showInvite = false)}>close</button>
			</div>
		{/if}

		{#if removedLists.length > 0}
			<button class="btn btn-ghost removed-button" onclick={() => (showRemovedLists = !showRemovedLists)}>
				recently removed lists ({removedLists.length})
			</button>
		{/if}

		{#if showRemovedLists}
			<div class="card removed-panel">
				<ul class="removed-list">
					{#each removedLists as list (list.id)}
						<li>
							<div class="removed-info">
								<span class="removed-name">{list.name}</span>
								{#if removedByLabel(list.id)}
									<span class="removed-by">removed by {removedByLabel(list.id)}</span>
								{/if}
							</div>
							<button class="btn btn-teal btn-small" onclick={() => restoreList(list.id)}>restore</button>
						</li>
					{/each}
				</ul>
				<button class="btn-close" onclick={() => (showRemovedLists = false)}>close</button>
			</div>
		{/if}
	{:else}
		<p>loading…</p>
	{/if}
</main>

<style>
	main {
		padding: 1.5rem 1.25rem 3rem;
	}
	.back {
		display: inline-block;
		margin-bottom: 1rem;
		text-decoration: none;
		color: var(--text-secondary);
		font-weight: 600;
	}
	h1 {
		margin-bottom: 1.5rem;
	}
	.lists {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin-bottom: 1.5rem;
	}
	.list-row {
		display: flex;
		align-items: center;
		padding: 0.25rem 0.25rem 0.25rem 1rem;
		transition:
			transform 0.1s ease,
			box-shadow 0.1s ease;
	}
	.list-row:hover {
		transform: translate(2px, 2px);
		box-shadow: var(--shadow-md-hover);
	}
	.list-card {
		flex: 1;
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 0;
		text-decoration: none;
		color: var(--text-primary);
	}
	.list-row .remove {
		flex-shrink: 0;
		background: none;
		border: none;
		color: var(--text-secondary);
		padding: 0.6rem 0.75rem;
		font-weight: 700;
		cursor: pointer;
	}
	.list-row .remove:hover {
		color: var(--color-primary);
	}
	.list-name {
		font-weight: 700;
	}
	.count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.6rem;
		height: 1.6rem;
		padding: 0 0.4rem;
		font-size: 0.8rem;
		font-weight: 700;
		border: var(--border);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-sm);
	}
	.add-list {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}
	.add-list .input {
		flex: 1;
	}
	.invite-button {
		width: 100%;
	}
	.invite-panel {
		margin-top: 1.5rem;
		padding: 1.5rem;
		text-align: center;
	}
	.qr {
		border: var(--border);
		border-radius: var(--radius-sm);
	}
	.code {
		font-size: 1.5rem;
		letter-spacing: 0.1em;
		font-weight: 800;
		margin: 0.75rem 0;
	}
	.btn-close {
		background: none;
		border: none;
		color: var(--text-secondary);
		font-weight: 600;
		margin-top: 0.75rem;
		cursor: pointer;
	}
	.error {
		color: var(--color-primary);
		font-weight: 600;
	}
	.removed-button {
		width: 100%;
		margin-top: 0.75rem;
	}
	.removed-panel {
		margin-top: 0.75rem;
		padding: 1.25rem;
	}
	.removed-list {
		list-style: none;
		padding: 0;
		margin: 0 0 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.removed-list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.removed-info {
		display: flex;
		flex-direction: column;
	}
	.removed-name {
		font-weight: 700;
	}
	.removed-by {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	.btn-small {
		padding: 8px 16px;
		font-size: 0.85rem;
	}
</style>
