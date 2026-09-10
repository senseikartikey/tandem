<script lang="ts">
	import { goto } from "$app/navigation";
	import { bindYText } from "$lib/actions/bind-y-text";
	import { relativeTime } from "$lib/relative-time.js";
	import type { HouseholdSession } from "$lib/sync/household-session";
	import { getOrJoinSession } from "$lib/sync/session-cache";
	import type { PresenceEntry } from "$lib/sync/presence-store";
	import type { HouseholdSnapshot } from "@tandem/doc-schema";
	import { onDestroy, onMount } from "svelte";
	import type * as Y from "yjs";
	import type { PageProps } from "./$types";
	import SyncStatus from "$lib/components/SyncStatus.svelte";
	import {
		continueList,
		toggleCheckbox,
		toggleList,
		type LineEdit,
		type ListKind,
	} from "$lib/list-markup.js";
	import type { SyncStatus as SyncStatusValue } from "$lib/sync/status-store.js";

	// $derived, not const, for the same reason the list route documents:
	// SvelteKit reuses this component instance when navigating between two
	// URLs of the same shape, so a captured id would go stale the moment you
	// jump from one note straight to another.
	let { params }: PageProps = $props();
	let roomId = $derived(params.roomId);
	let noteId = $derived(params.noteId);

	let session = $state<HouseholdSession | null>(null);
	let household = $state<HouseholdSnapshot | null>(null);
	let presence = $state<PresenceEntry[]>([]);
	let syncStatus = $state<SyncStatusValue>("connecting");
	let body = $state<Y.Text | null>(null);
	let titleDraft = $state("");
	let titleFocused = $state(false);

	let unsubscribe: (() => void) | null = null;
	let unsubscribePresence: (() => void) | null = null;
	let unsubscribeStatus: (() => void) | null = null;
	let touchTimer: ReturnType<typeof setTimeout> | null = null;
	let touchPending = false;

	let note = $derived(household?.notes.find((n) => n.id === noteId) ?? null);

	// Everyone else who currently has this same note open. Excludes you --
	// presenceStore never reports your own client.
	let alsoHere = $derived(presence.filter((entry) => entry.editingNoteId === noteId));

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

	// Rebinding on noteId (not just on mount) is what makes note-to-note
	// navigation safe: without it the editor would keep the previous note's
	// Y.Text wired to the textarea and type into the wrong note. The
	// awareness signal moves with it, so other people see you leave one note
	// and arrive in the other.
	$effect(() => {
		const current = session;
		const id = noteId;
		if (!current || !id) return;
		body = current.getNoteBodyText(id);
		current.setEditingNote(id);
		return () => {
			flushTouch();
			current.setEditingNote(null);
		};
	});

	// The title input is only overwritten from the document while you're not
	// in it -- otherwise a remote rename (or your own echoed write) would
	// yank the caret mid-word. The body has no such problem: y-textarea's
	// binding preserves the caret across remote edits, which is exactly why
	// the body is a real Y.Text and the title isn't.
	$effect(() => {
		const incoming = note?.title ?? "";
		if (!titleFocused) titleDraft = incoming;
	});

	function saveTitle(): void {
		const trimmed = titleDraft.trim();
		if (!session || !note) return;
		if (trimmed === note.title) return;
		session.renameNote(noteId, trimmed || "untitled");
	}

	// "Last edited by X" is a separate, throttled write (see touchNote in
	// doc-schema): the keystrokes themselves are Y.Text ops that never touch
	// the note's metadata, and bumping a last-write-wins field on every
	// character would put one CRDT op per keystroke on top of the ones
	// carrying the actual text.
	const TOUCH_INTERVAL_MS = 5_000;

	function noteTyped(): void {
		touchPending = true;
		if (touchTimer) return;
		touchTimer = setTimeout(() => {
			touchTimer = null;
			flushTouch();
		}, TOUCH_INTERVAL_MS);
	}

	function flushTouch(): void {
		if (touchTimer) {
			clearTimeout(touchTimer);
			touchTimer = null;
		}
		if (!touchPending) return;
		touchPending = false;
		session?.touchNote(noteId);
	}

	// --- list markup -----------------------------------------------------
	//
	// Edits are written by replacing the textarea's value and dispatching an
	// input event, which is exactly what typing does -- so the Y.Text binding
	// diffs it into minimal character ops and the change merges with whatever
	// the other person is typing at the same moment. Rewriting the shared
	// text directly would be a bigger, blunter operation with no such
	// guarantee.
	let bodyEl = $state<HTMLTextAreaElement | undefined>();

	function applyEdit(edit: LineEdit): void {
		if (!bodyEl) return;
		bodyEl.value = edit.text;
		bodyEl.setSelectionRange(edit.selectionStart, edit.selectionEnd);
		bodyEl.dispatchEvent(new Event("input", { bubbles: true }));
		bodyEl.focus();
		noteTyped();
	}

	function applyList(kind: ListKind): void {
		if (!bodyEl) return;
		applyEdit(toggleList(bodyEl.value, bodyEl.selectionStart, bodyEl.selectionEnd, kind));
	}

	function onBodyKeydown(event: KeyboardEvent): void {
		if (!bodyEl) return;

		// Return continues the list you're in, and ends it on an empty item.
		if (event.key === "Enter" && !event.shiftKey && bodyEl.selectionStart === bodyEl.selectionEnd) {
			const edit = continueList(bodyEl.value, bodyEl.selectionStart);
			// null means this isn't a list line -- let the browser insert an
			// ordinary newline, which keeps native undo intact.
			if (edit) {
				event.preventDefault();
				applyEdit(edit);
			}
			return;
		}

		// Cmd/Ctrl+Enter ticks the checkbox on the current line, for people
		// who'd rather not reach for the mouse.
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			const edit = toggleCheckbox(bodyEl.value, bodyEl.selectionStart);
			if (edit) {
				event.preventDefault();
				applyEdit(edit);
			}
		}
	}

	// Tapping the box itself ticks it, the way it works in a notes app. Only
	// a tap that lands on the marker counts, so putting the caret in the text
	// of a task doesn't toggle it by accident.
	function onBodyClick(): void {
		if (!bodyEl || bodyEl.selectionStart !== bodyEl.selectionEnd) return;
		const caret = bodyEl.selectionStart;
		const lineStart = bodyEl.value.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
		if (caret - lineStart > 2) return;
		const edit = toggleCheckbox(bodyEl.value, caret);
		if (edit) applyEdit(edit);
	}

	async function removeNote(): Promise<void> {
		if (!session) return;
		session.archiveNote(noteId);
		await goto(`/h/${roomId}/notes`);
	}

	onDestroy(() => {
		flushTouch();
		session?.setEditingNote(null);
		unsubscribe?.();
		unsubscribePresence?.();
		unsubscribeStatus?.();
	});
</script>

<main class="app-shell">
	<a href={`/h/${roomId}/notes`} class="back">&larr; notes</a>

	{#if note && body}
		<input
			class="title-input"
			value={titleDraft}
			oninput={(e) => (titleDraft = e.currentTarget.value)}
			onfocus={() => (titleFocused = true)}
			onblur={() => {
				titleFocused = false;
				saveTitle();
			}}
			placeholder="untitled"
			aria-label="Note title"
			maxlength="80"
		/>

		<div class="note-meta">
			<SyncStatus status={syncStatus} />
			<span>edited by {note.lastEditedBy} · {relativeTime(note.updatedAt)}</span>
			{#if alsoHere.length > 0}
				<span class="live">
					{#each alsoHere as entry (entry.clientId)}
						<span class="live-dot" style={`background:${entry.color}`}></span>
					{/each}
					{alsoHere.map((e) => e.name).join(", ")}
					{alsoHere.length === 1 ? "is" : "are"} typing here too
				</span>
			{/if}
		</div>

		<div class="list-tools">
			<button class="tool" onclick={() => applyList("bullet")} title="Bullet list">• list</button>
			<button class="tool" onclick={() => applyList("number")} title="Numbered list">1. list</button>
			<button class="tool" onclick={() => applyList("checkbox")} title="Checklist">☐ tasks</button>
		</div>

		<!-- The one control that matters: bound straight to the note's live
		     Y.Text, so two people typing in the same paragraph merge
		     character by character instead of one overwriting the other. -->
		<textarea
			class="note-body"
			bind:this={bodyEl}
			use:bindYText={body}
			oninput={noteTyped}
			onkeydown={onBodyKeydown}
			onclick={onBodyClick}
			placeholder="start typing — everyone in the household sees it as you go"
			aria-label="Note body"
		></textarea>

		<button class="btn btn-ghost btn-block remove-note" onclick={() => void removeNote()}>
			remove this note
		</button>
	{:else if household}
		<p class="empty">that note isn't here — it may have been removed.</p>
	{:else}
		<p class="empty">loading…</p>
	{/if}
</main>

<style>
	main {
		padding: 1.5rem 1.25rem 3rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.back {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.75rem;
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
	/* The title is styled as the page heading, not as a form field -- it only
	   reveals itself as an input on focus. */
	.title-input {
		width: 100%;
		background: none;
		border: none;
		border-bottom: var(--border);
		border-radius: 0;
		padding: 0 0 0.5rem;
		font-family: var(--font-display);
		font-size: clamp(1.9rem, 8vw, 2.6rem);
		letter-spacing: -0.03em;
		text-transform: lowercase;
		color: var(--text-primary);
		outline: none;
	}
	.title-input::placeholder {
		opacity: 0.35;
	}
	.title-input:focus {
		border-bottom-color: var(--color-primary);
	}
	.note-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--text-secondary);
	}
	.live {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		color: var(--text-primary);
		font-weight: 600;
	}
	.live-dot {
		width: 9px;
		height: 9px;
		border: var(--border-thin);
		border-radius: 50%;
		animation: live-pulse 1.6s ease-in-out infinite;
	}
	@keyframes live-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}
	/* Sits directly on top of the text area it acts on, so the connection
	   between button and effect is obvious without a label saying so. */
	.list-tools {
		display: flex;
		gap: 0.4rem;
	}
	.tool {
		padding: 0.4rem 0.8rem;
		border: var(--border-thin);
		border-radius: var(--radius-pill);
		background: var(--bg-surface);
		box-shadow: var(--shadow-sm);
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-primary);
		cursor: pointer;
		transition:
			transform 0.1s ease,
			box-shadow 0.1s ease;
	}
	.tool:active {
		transform: translate(2px, 2px);
		box-shadow: none;
	}
	.note-body {
		width: 100%;
		min-height: 55dvh;
		padding: 1.1rem;
		background: var(--bg-surface);
		border: var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		font-family: var(--font);
		font-size: 1rem;
		line-height: 1.6;
		color: var(--text-primary);
		resize: vertical;
		outline: none;
	}
	.note-body:focus {
		box-shadow: var(--shadow-lg);
	}
	.remove-note {
		margin-top: 0.5rem;
	}
	.empty {
		font-family: var(--font-mono);
		font-size: 0.85rem;
	}
</style>
