<script lang="ts">
	import { goto } from "$app/navigation";
	import { relativeTime } from "$lib/relative-time.js";
	import type { HouseholdSession } from "$lib/sync/household-session";
	import { getOrJoinSession } from "$lib/sync/session-cache";
	import type { PresenceEntry } from "$lib/sync/presence-store";
	import type { HouseholdSnapshot } from "@tandem/doc-schema";
	import { onDestroy, onMount } from "svelte";
	import type { PageProps } from "./$types";
	import PresenceAvatars from "$lib/components/PresenceAvatars.svelte";
	import SyncStatus from "$lib/components/SyncStatus.svelte";
	import type { SyncStatus as SyncStatusValue } from "$lib/sync/status-store.js";

	// This route sits at /h/[roomId]/notes, alongside the /h/[roomId]/[listId]
	// dynamic route. SvelteKit resolves the literal segment first, so a list
	// can never shadow it -- and list ids are uuids, so nothing collides.
	let { params }: PageProps = $props();
	const roomId = params.roomId;

	let session = $state<HouseholdSession | null>(null);
	let household = $state<HouseholdSnapshot | null>(null);
	let presence = $state<PresenceEntry[]>([]);
	let syncStatus = $state<SyncStatusValue>("connecting");
	let showArchived = $state(false);
	let busy = $state(false);

	let unsubscribe: (() => void) | null = null;
	let unsubscribePresence: (() => void) | null = null;
	let unsubscribeStatus: (() => void) | null = null;

	onMount(async () => {
		session = await getOrJoinSession(roomId);
		unsubscribe = session.household.subscribe(({ household: snapshot }) => {
			household = snapshot;
		});
		unsubscribePresence = session.presence.subscribe((entries) => {
			presence = entries;
		});
		unsubscribeStatus = session.status.subscribe((value) => {
			syncStatus = value;
		});
	});

	// Same cached-session contract as every other room route: the subscription
	// is ours to clean up, the session is not ours to destroy.
	onDestroy(() => {
		unsubscribe?.();
		unsubscribePresence?.();
		unsubscribeStatus?.();
	});

	let notes = $derived((household?.notes ?? []).filter((n) => !n.archived));
	let archivedNotes = $derived(
		(household?.notes ?? [])
			.filter((n) => n.archived)
			.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
	);

	// A new note opens straight into the editor with a placeholder title
	// rather than making someone name a thing before they've written it --
	// naming is the last thing you know about a note, not the first.
	async function newNote(): Promise<void> {
		if (!session || busy) return;
		busy = true;
		const noteId = session.createNote("untitled");
		await goto(`/h/${roomId}/notes/${noteId}`);
	}

	// Peers broadcast which note they have open; this turns that into a
	// per-note list so the index can show "someone is in here right now".
	function readersOf(noteId: string): PresenceEntry[] {
		return presence.filter((entry) => entry.editingNoteId === noteId);
	}

	const TONES = ["#ffe566", "#4ecdc4", "#f9a8b8", "#c4b5fd"];
</script>

<main class="app-shell">
	<a href={`/h/${roomId}`} class="back">&larr; {household?.name ?? "household"}</a>

	{#if household}
		<header class="head">
			<span class="eyebrow">— shared notes</span>
			<h1>notes</h1>
			<SyncStatus status={syncStatus} />
		</header>

		<PresenceAvatars entries={presence} />

		<button class="btn btn-ink btn-block new-note" onclick={() => void newNote()} disabled={busy}>
			new note <span class="btn-arrow">→</span>
		</button>

		{#if notes.length > 0}
			<div class="note-grid">
				{#each notes as note, i (note.id)}
					<a
						class="note-card"
						href={`/h/${roomId}/notes/${note.id}`}
						style={`background:${TONES[i % TONES.length]}`}
					>
						<span class="note-title">{note.title || "untitled"}</span>
						<span class="note-preview">{note.preview || "empty note"}</span>
						<span class="note-meta">
							{note.lastEditedBy} · {relativeTime(note.updatedAt)}
							{#if readersOf(note.id).length > 0}
								<span class="here">● {readersOf(note.id)[0].name} is in here</span>
							{/if}
						</span>
					</a>
				{/each}
			</div>
		{:else}
			<p class="empty">
				nothing pinned to the fridge yet. the wifi password, what the plumber said, a recipe — it
				all syncs to everyone.
			</p>
		{/if}

		{#if archivedNotes.length > 0}
			<button class="btn btn-ghost btn-block removed-button" onclick={() => (showArchived = !showArchived)}>
				recently removed notes ({archivedNotes.length})
			</button>
		{/if}

		{#if showArchived}
			<div class="card removed-panel">
				<ul class="removed-list">
					{#each archivedNotes as note (note.id)}
						<li>
							<div class="removed-info">
								<span class="removed-name">{note.title || "untitled"}</span>
								<span class="removed-by">removed {relativeTime(note.deletedAt ?? note.updatedAt)}</span>
							</div>
							<button class="btn btn-teal btn-small" onclick={() => session?.unarchiveNote(note.id)}>
								restore
							</button>
						</li>
					{/each}
				</ul>
				<button class="btn-close" onclick={() => (showArchived = false)}>close</button>
			</div>
		{/if}
	{:else}
		<p class="empty">loading…</p>
	{/if}
</main>

<style>
	main {
		padding: 1.5rem 1.25rem 3rem;
	}
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
	.new-note {
		margin-bottom: 1.5rem;
	}
	/* Notes are square-ish cards rather than rows: a note is a thing you
	   recognize by its shape and colour on a fridge, and the preview needs
	   room to be worth reading. */
	.note-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 0.85rem;
	}
	.note-card {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-height: 150px;
		padding: 1rem;
		border: var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		text-decoration: none;
		color: var(--text-primary);
		transition:
			transform 0.12s ease,
			box-shadow 0.12s ease;
	}
	.note-card:hover {
		transform: translate(-3px, -3px) rotate(-1deg);
		box-shadow: var(--shadow-lift);
	}
	.note-title {
		font-family: var(--font-display);
		font-size: 1.05rem;
		letter-spacing: -0.02em;
		text-transform: lowercase;
		line-height: 1.1;
	}
	.note-preview {
		flex: 1;
		font-size: 0.82rem;
		line-height: 1.4;
		opacity: 0.75;
		/* Four lines of preview, then fade out -- the full body is one tap
		   away and doesn't belong in an index. */
		display: -webkit-box;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.note-meta {
		font-family: var(--font-mono);
		font-size: 0.66rem;
		opacity: 0.7;
	}
	.here {
		display: block;
		margin-top: 0.2rem;
		font-weight: 600;
		opacity: 0.95;
	}
	.empty {
		margin-top: 1.5rem;
		font-family: var(--font-mono);
		font-size: 0.85rem;
		line-height: 1.6;
	}
	.removed-button {
		margin-top: 1.25rem;
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
	.btn-close {
		background: none;
		border: none;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		color: var(--text-secondary);
		text-decoration: underline;
		cursor: pointer;
	}
</style>
