<script lang="ts">
	import { page } from "$app/state";
	import { goto, replaceState } from "$app/navigation";
	import { describeApiError, mintShortCode } from "$lib/api";
	import { buildInviteLink, inviteQrCodeDataUrl } from "$lib/invite";
	import { rememberHousehold } from "$lib/local-households";
	import { createHouseholdSession, type HouseholdSession } from "$lib/sync/household-session";
	import { cacheSession, getOrJoinSession } from "$lib/sync/session-cache";
	import type { PresenceEntry } from "$lib/sync/presence-store";
	import type { ActivitySnapshot, HouseholdSnapshot } from "@tandem/doc-schema";
	import { onDestroy, onMount } from "svelte";
	import type { PageProps } from "./$types";
	import YourName from "$lib/components/YourName.svelte";
	import PresenceAvatars from "$lib/components/PresenceAvatars.svelte";
	import SyncStatus from "$lib/components/SyncStatus.svelte";
	import type { SyncStatus as SyncStatusValue } from "$lib/sync/status-store.js";

	// $app/state's `page.params` is typed broadly across every route (so
	// individual keys come back as `string | undefined`); this route's
	// generated PageProps narrows it to the actual `{ roomId: string }` shape.
	let { params }: PageProps = $props();
	const roomId = params.roomId;
	let session = $state<HouseholdSession | null>(null);
	let household = $state<HouseholdSnapshot | null>(null);
	let activity = $state<ActivitySnapshot[]>([]);
	let presence = $state<PresenceEntry[]>([]);
	let syncStatus = $state<SyncStatusValue>("connecting");
	let newListName = $state("");
	let showInvite = $state(false);
	let showRemovedLists = $state(false);
	let mergedCount = $state<number | null>(null);
	let inviteLink = $state("");
	let inviteQr = $state("");
	let inviteCode = $state("");
	let inviteError = $state("");

	let unsubscribe: (() => void) | null = null;
	let unsubscribePresence: (() => void) | null = null;
	let unsubscribeStatus: (() => void) | null = null;

	onMount(async () => {
		const newName = page.url.searchParams.get("new");
		const merged = page.url.searchParams.get("merged");
		if (newName) {
			session = await createHouseholdSession(roomId, newName);
			cacheSession(roomId, session);
			replaceState(`/h/${roomId}`, {});
		} else {
			session = await getOrJoinSession(roomId);
			if (merged !== null) {
				mergedCount = Number(merged);
				replaceState(`/h/${roomId}`, {});
			}
		}

		unsubscribe = session.household.subscribe(({ household: snapshot, activity: entries }) => {
			household = snapshot;
			activity = entries;
			if (snapshot.name) rememberHousehold(roomId, snapshot.name);
		});
		unsubscribePresence = session.presence.subscribe((entries) => {
			presence = entries;
		});
		unsubscribeStatus = session.status.subscribe((value) => {
			syncStatus = value;
		});
	});

	// Intentionally does NOT destroy the session -- it's cached and shared
	// with the list-detail route (and any other route) for this household's
	// lifetime in the app, not torn down on every navigation away from this
	// one page. Only the local subscription needs cleaning up here.
	onDestroy(() => {
		unsubscribe?.();
		unsubscribePresence?.();
		unsubscribeStatus?.();
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

	let noteCount = $derived((household?.notes ?? []).filter((n) => !n.archived).length);

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

<main class="app-shell">
	<a href="/" class="back">&larr; households</a>

	{#if household}
		<header class="head">
			<span class="eyebrow">— household</span>
			<h1>{household.name}</h1>
			<SyncStatus status={syncStatus} />
		</header>

		{#if mergedCount !== null}
			<div class="card merged-banner">
				<p>
					{mergedCount === 0
						? "fork merged -- nothing new to bring over."
						: `merged ${mergedCount} new ${mergedCount === 1 ? "item" : "items"} back.`}
				</p>
				<button class="btn-close" onclick={() => (mergedCount = null)}>close</button>
			</div>
		{/if}

		<PresenceAvatars entries={presence} />

		<YourName />

		<span class="eyebrow lists-label">— your lists</span>

		<div class="lists">
			{#each household.lists.filter((l) => !l.archived) as list, i (list.id)}
				<div class="card list-row" style={`--row-tone:${["#4ecdc4", "#ffe566", "#f9a8b8", "#c4b5fd"][i % 4]}`}>
					<a class="list-card" href={`/h/${roomId}/${list.id}`}>
						<span class="list-name-wrap">
							<span class="list-name">{list.name}</span>
							{#if list.forkedFromListId}
								<span class="forked-tag">🍴 fork</span>
							{/if}
						</span>
						<span class="count">
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

		<a class="notes-link" href={`/h/${roomId}/notes`}>
			<span class="notes-icon">📝</span>
			<span class="notes-text">
				<span class="notes-title">shared notes</span>
				<span class="notes-sub">
					{noteCount === 0
						? "the wifi password, the plumber, that recipe"
						: `${noteCount} ${noteCount === 1 ? "note" : "notes"} everyone can type in`}
				</span>
			</span>
			<span class="notes-arrow">→</span>
		</a>

		<button class="btn btn-ink btn-block invite-button" onclick={openInvite}>
			invite someone <span class="btn-arrow">→</span>
		</button>

		{#if showInvite}
			<div class="card invite-panel">
				{#if inviteError}
					<p class="error">{inviteError}</p>
				{:else if inviteQr}
					<span class="eyebrow">— scan or share</span>
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
	/* The back link reads as a physical tab clipped to the top of the view,
	   not as body-copy text -- same border/shadow language as everything
	   else on the page. */
	.back {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 1.5rem;
		padding: 0.5rem 1rem;
		background: var(--bg-surface);
		border: var(--border);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-sm);
		font-family: var(--font-mono);
		font-size: 0.78rem;
		font-weight: 500;
		color: var(--text-primary);
		text-decoration: none;
		transition:
			transform 0.12s ease,
			box-shadow 0.12s ease;
	}
	.back:hover {
		transform: translate(-2px, -2px);
		box-shadow: var(--shadow-md);
	}
	.head {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}
	h1 {
		font-size: clamp(2.4rem, 11vw, 3.6rem);
	}
	.lists-label {
		display: block;
		margin-bottom: 0.75rem;
	}
	.lists {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		margin-bottom: 1.75rem;
	}
	/* Each row takes its accent as a full flat fill -- the same treatment the
	   landing's feature cards use -- so a household reads as a stack of
	   distinct cards without a rail stripe doing the work. */
	.list-row {
		display: flex;
		align-items: center;
		padding: 0.3rem 0.3rem 0.3rem 1.1rem;
		background: var(--row-tone, var(--color-teal));
		transition:
			transform 0.12s ease,
			box-shadow 0.12s ease;
	}
	.list-row:hover {
		transform: translate(-2px, -2px);
		box-shadow: var(--shadow-lg);
	}
	.list-card {
		flex: 1;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		padding: 0.85rem 0;
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
	.list-name-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.list-name {
		font-family: var(--font-display);
		font-size: 1.15rem;
		letter-spacing: -0.02em;
		text-transform: lowercase;
	}
	.forked-tag {
		font-family: var(--font-mono);
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
	}
	.merged-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.15rem;
		margin-bottom: 1.25rem;
		background: var(--color-teal);
	}
	.merged-banner p {
		font-weight: 600;
		color: var(--text-primary);
	}
	.count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2rem;
		height: 2rem;
		padding: 0 0.5rem;
		background: var(--bg-surface);
		font-family: var(--font-mono);
		font-size: 0.85rem;
		font-weight: 700;
		border: var(--border);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-sm);
	}
	.add-list {
		display: flex;
		gap: 0.6rem;
		margin-bottom: 1.75rem;
	}
	.add-list .input {
		flex: 1;
	}
	/* Notes are a peer of lists, not a setting -- so the entry point is a
	   full-width card in the flow, not a link buried in a menu. */
	.notes-link {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		margin-bottom: 0.85rem;
		padding: 1rem 1.15rem;
		background: var(--color-yellow);
		border: var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		text-decoration: none;
		color: var(--text-primary);
		transition:
			transform 0.12s ease,
			box-shadow 0.12s ease;
	}
	.notes-link:hover {
		transform: translate(-2px, -2px);
		box-shadow: var(--shadow-lg);
	}
	.notes-icon {
		font-size: 1.5rem;
		line-height: 1;
	}
	.notes-text {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.notes-title {
		font-family: var(--font-display);
		font-size: 1.15rem;
		letter-spacing: -0.02em;
		text-transform: lowercase;
	}
	.notes-sub {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		opacity: 0.75;
	}
	.notes-arrow {
		font-size: 1.2rem;
	}
	.invite-button {
		width: 100%;
	}
	.invite-panel {
		margin-top: 1.5rem;
		padding: 1.75rem 1.5rem;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.9rem;
		background: var(--color-yellow);
	}
	.qr {
		border: var(--border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-sm);
		background: #fff;
	}
	/* The code gets read aloud across a room -- mono, spaced, and as big as
	   the card allows. */
	.code {
		font-family: var(--font-mono);
		font-size: 1.75rem;
		letter-spacing: 0.18em;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
	}
	.btn-close {
		background: none;
		border: none;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		color: var(--text-secondary);
		text-decoration: underline;
		cursor: pointer;
	}
	.error {
		font-family: var(--font-mono);
		font-weight: 600;
		color: var(--text-primary);
	}
	.removed-button {
		width: 100%;
		margin-top: 0.85rem;
	}
	.removed-panel {
		margin-top: 0.85rem;
		padding: 1.35rem;
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.removed-list {
		list-style: none;
		padding: 0;
		margin: 0 0 0.9rem;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
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
		font-family: var(--font-display);
		font-size: 1rem;
		text-transform: lowercase;
	}
	.removed-by {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--text-secondary);
	}
</style>
