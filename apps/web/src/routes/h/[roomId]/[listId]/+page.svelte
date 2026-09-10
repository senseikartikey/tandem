<script lang="ts">
	import { goto } from "$app/navigation";
	import type { HouseholdSession } from "$lib/sync/household-session";
	import { getOrJoinSession } from "$lib/sync/session-cache";
	import type { PresenceEntry } from "$lib/sync/presence-store";
	import type { ActivitySnapshot, HouseholdSnapshot, ItemSnapshot, ListSnapshot } from "@tandem/doc-schema";
	import { onDestroy, onMount } from "svelte";
	import { flip } from "svelte/animate";
	import { dragHandle, dragHandleZone, type DndEvent } from "svelte-dnd-action";
	import type * as Y from "yjs";
	import type { PageProps } from "./$types";
	import ActivityPanel from "./ActivityPanel.svelte";
	import PresenceAvatars from "$lib/components/PresenceAvatars.svelte";
	import SyncStatus from "$lib/components/SyncStatus.svelte";
	import ReminderSheet from "$lib/components/ReminderSheet.svelte";
	import ReminderInbox from "$lib/components/ReminderInbox.svelte";
	import { sendReminderPush } from "$lib/push.js";
	import { getDeviceLabel } from "$lib/local-households";
	import type { SyncStatus as SyncStatusValue } from "$lib/sync/status-store.js";
	import { bindYText } from "$lib/actions/bind-y-text";
	import { lookupProductByBarcode } from "$lib/product-lookup";
	import { supportsVoiceCapture } from "$lib/voice/recorder.js";
	import { browserSpeechAvailable } from "$lib/voice/speech.js";
	import { preloadTranscriber } from "$lib/voice/transcriber.js";

	// See h/[roomId]/+page.svelte's comment on why the typed PageProps params
	// are used here instead of $app/state's broadly-typed page.params.
	//
	// Both MUST be $derived, not plain const: SvelteKit reuses this same
	// component instance (doesn't remount) when navigating between two
	// URLs that match this route's shape -- e.g. forking a list calls
	// goto() from a list page to a *different* list page in the same
	// room. A plain const only ever captures params as they were at first
	// mount, so the page would keep silently rendering the list you forked
	// FROM forever after, while the address bar shows the new one.
	let { params }: PageProps = $props();
	let roomId = $derived(params.roomId);
	let listId = $derived(params.listId);

	let session = $state<HouseholdSession | null>(null);
	let household = $state<HouseholdSnapshot | null>(null);
	let activity = $state<ActivitySnapshot[]>([]);
	let presence = $state<PresenceEntry[]>([]);
	let syncStatus = $state<SyncStatusValue>("connecting");
	let newItemText = $state("");
	let showScanner = $state(false);
	let showVoice = $state(false);
	let scanLookupPending = $state(false);
	let scanLookupMissed = $state(false);
	let editingItemId = $state<string | null>(null);
	let editingText = $state("");
	let showActivity = $state(false);
	let remindingItem = $state<{ id: string; text: string } | null>(null);

	// Only one note editor is ever open at a time -- getItemNoteText() is
	// called fresh on expand, not eagerly for every item, since it's a live
	// shared handle we want bound to exactly one mounted textarea.
	let expandedNoteId = $state<string | null>(null);
	let expandedNoteText = $state<Y.Text | null>(null);

	function toggleNote(itemId: string): void {
		if (expandedNoteId === itemId) {
			expandedNoteId = null;
			expandedNoteText = null;
			return;
		}
		expandedNoteId = itemId;
		expandedNoteText = session?.getItemNoteText(listId, itemId) ?? null;
	}

	let unsubscribe: (() => void) | null = null;
	let unsubscribePresence: (() => void) | null = null;
	let unsubscribeStatus: (() => void) | null = null;

	let myLabel = $derived(getDeviceLabel());

	// Everyone this household has seen, by the name they chose. Presence
	// covers who is here now; the activity log covers everyone who has ever
	// done anything, which is what you want when nudging someone whose phone
	// is in their pocket.
	let people = $derived(
		[
			...new Set([
				...presence.map((entry) => entry.name),
				...activity.map((entry) => entry.actorLabel),
				...(household?.reminders ?? []).flatMap((r) => [r.fromLabel, r.toLabel ?? ""]),
			]),
		]
			.filter((name) => name && name !== myLabel)
			.sort(),
	);

	async function sendReminder(choice: {
		toLabel: string | null;
		dueAt: number | null;
		message: string;
	}): Promise<void> {
		const target = remindingItem;
		remindingItem = null;
		if (!session || !target) return;

		// The document write is the reminder. It happens first and always --
		// the push below is a doorbell that may or may not ring, and nothing
		// waits on it.
		session.createReminder({
			listId,
			itemId: target.id,
			toLabel: choice.toLabel,
			dueAt: choice.dueAt,
			message: choice.message,
		});

		void sendReminderPush({
			roomId,
			toLabel: choice.toLabel,
			fromLabel: myLabel,
			itemText: target.text,
			message: choice.message,
			listUrl: `/h/${roomId}/${listId}`,
			tag: `${listId}:${target.id}`,
			sendAt: choice.dueAt,
		});
	}

	let list = $derived<ListSnapshot | null>(
		household?.lists.find((l) => l.id === listId) ?? null,
	);

	// A fork's source list is looked up by id, not stored redundantly on the
	// fork itself -- nothing in this app is ever hard-deleted, so the lookup
	// always succeeds even if the source was later archived.
	let forkSourceName = $derived(
		list?.forkedFromListId
			? (household?.lists.find((l) => l.id === list?.forkedFromListId)?.name ?? "a removed list")
			: null,
	);
	let forkNewCount = $derived(
		list?.items.filter((i) => !i.archived && !i.copiedInFork).length ?? 0,
	);

	// itemId -> presence color, briefly set when a *remote* peer's Awareness
	// "lastTouch" signal names this item, so you see someone else's change
	// land while you're both looking at the same list -- the exact moment
	// that prevents the "wait, did you already grab that?" duplicate-buy
	// scenario this feature exists for.
	let flashes = $state<Record<string, string>>({});
	const lastSeenTouch = new Map<number, number>(); // clientId -> ts already flashed

	$effect(() => {
		for (const entry of presence) {
			if (!entry.lastTouch) continue;
			const { itemId, ts } = entry.lastTouch;
			if (lastSeenTouch.get(entry.clientId) === ts) continue; // already flashed
			lastSeenTouch.set(entry.clientId, ts);
			if (Date.now() - ts > 5000) continue; // stale signal from a peer who joined late
			flashes = { ...flashes, [itemId]: entry.color };
			setTimeout(() => {
				const { [itemId]: _removed, ...rest } = flashes;
				flashes = rest;
			}, 1500);
		}
	});

	// A local, mutable mirror of list.items for svelte-dnd-action to animate
	// during a drag -- it needs to own the array reference mid-gesture, which
	// a value derived straight from the Yjs snapshot can't offer. Only
	// resynced from the real snapshot while *not* dragging, so a remote
	// peer's concurrent edit arriving mid-drag can't rewrite the array out
	// from under the gesture in progress; it catches up the moment the drag
	// ends either way, since finalize's own write feeds back through the
	// same snapshot.
	let dndItems = $state<ItemSnapshot[]>([]);
	let dragging = $state(false);

	$effect(() => {
		if (dragging) return;
		dndItems = list?.items.filter((i) => !i.archived) ?? [];
	});

	// Same stale-navigation hazard the file's top comment documents for
	// listId itself -- without this, forking/switching lists while a note
	// is open would keep the OLD item's Y.Text bound in the new list's DOM.
	$effect(() => {
		listId;
		expandedNoteId = null;
		expandedNoteText = null;
	});

	function handleConsider(e: CustomEvent<DndEvent<ItemSnapshot>>): void {
		dragging = true;
		dndItems = e.detail.items;
	}

	function handleFinalize(e: CustomEvent<DndEvent<ItemSnapshot>>): void {
		dndItems = e.detail.items;
		dragging = false;
		if (!session) return;
		const draggedId = e.detail.info.id;
		const index = dndItems.findIndex((i) => i.id === draggedId);
		if (index === -1) return;
		const beforeId = index > 0 ? dndItems[index - 1].id : null;
		const afterId = index < dndItems.length - 1 ? dndItems[index + 1].id : null;
		session.reorderItem(listId, draggedId, beforeId, afterId);
	}

	onMount(() => {
		// Only browsers with no dictation of their own will ever reach the
		// local model, and only those pay for it: warmed here, in the
		// background, so the microphone is usable the instant it's tapped
		// instead of starting a multi-megabyte download under someone who is
		// already talking.
		if (!browserSpeechAvailable() && supportsVoiceCapture()) preloadTranscriber();
	});

	onMount(async () => {
		// Reuses the cached session from the parent /h/[roomId] page if this
		// household is already open (the common case -- you navigate here from
		// there); joins fresh otherwise (e.g. a deep link straight to a list).
		session = await getOrJoinSession(roomId);
		unsubscribe = session.household.subscribe(({ household: snapshot, activity: entries }) => {
			household = snapshot;
			activity = entries;
		});
		unsubscribePresence = session.presence.subscribe((entries) => {
			presence = entries;
		});
		unsubscribeStatus = session.status.subscribe((value) => {
			syncStatus = value;
		});
	});

	// See the household page's onDestroy comment -- the session is cached
	// and shared, not owned by this route.
	onDestroy(() => {
		unsubscribe?.();
		unsubscribePresence?.();
		unsubscribeStatus?.();
	});

	// One spoken sentence becomes several ordinary addItem calls, so voice
	// items are indistinguishable from typed ones the moment they land:
	// same attribution, same activity entries, same undo. Nothing in the
	// document knows or cares that a microphone was involved.
	function addSpokenItems(texts: string[]): void {
		for (const text of texts) session?.addItem(listId, text);
	}

	function addItem(): void {
		const text = newItemText.trim();
		if (!text || !session) return;
		session.addItem(listId, text);
		newItemText = "";
	}

	// A scan never adds the item directly -- it only fills the same input the
	// manual-entry flow uses, so a misread barcode or a wrong product-name
	// match is just as easy to fix/cancel as a typo, and there's exactly one
	// codepath that actually writes an item. On a lookup miss (no match, or
	// offline) the raw barcode digits are deliberately NOT used as the item
	// text -- "0034000138516" isn't a useful list entry -- the person is
	// asked to type the name themselves instead.
	async function handleBarcode(code: string): Promise<void> {
		showScanner = false;
		scanLookupPending = true;
		scanLookupMissed = false;
		const name = await lookupProductByBarcode(code);
		scanLookupPending = false;
		if (name) {
			newItemText = name;
		} else {
			scanLookupMissed = true;
		}
	}

	function toggle(itemId: string, checked: boolean): void {
		session?.setItemChecked(listId, itemId, !checked);
	}

	function startEdit(itemId: string, currentText: string): void {
		editingItemId = itemId;
		editingText = currentText;
	}

	function commitEdit(): void {
		if (editingItemId && session && editingText.trim()) {
			session.setItemText(listId, editingItemId, editingText.trim());
		}
		editingItemId = null;
	}

	function removeItem(itemId: string): void {
		session?.archiveItem(listId, itemId);
	}

	function restoreItem(itemId: string): void {
		session?.unarchiveItem(listId, itemId);
	}

	// Forking is a snapshot, not a live link -- the new list is completely
	// independent from this instant on. See doc-schema's forkList() for why
	// that's the whole point: draft freely, then merge back or discard with
	// zero risk to the list you started from.
	function fork(): void {
		if (!session || !list) return;
		const newId = session.forkList(listId, `Fork of ${list.name}`);
		void goto(`/h/${roomId}/${newId}`);
	}

	function merge(): void {
		if (!session) return;
		const { mergedCount } = session.mergeFork(listId);
		void goto(`/h/${roomId}?merged=${mergedCount}`);
	}

	function discardFork(): void {
		session?.archiveList(listId);
		void goto(`/h/${roomId}`);
	}
</script>

<main class="app-shell">
	<a href={`/h/${roomId}`} class="back">&larr; {household?.name ?? "household"}</a>

	{#if list}
		<header class="head">
			<span class="eyebrow">— list</span>
			<h1>{list.name}</h1>
			<SyncStatus status={syncStatus} />
		</header>

		{#if forkSourceName}
			<div class="card fork-banner">
				<p>🍴 this is a fork of <strong>{forkSourceName}</strong></p>
				<div class="fork-actions">
					<button class="btn btn-teal btn-small" onclick={merge} disabled={forkNewCount === 0}>
						merge back{forkNewCount > 0 ? ` (${forkNewCount} new)` : ""}
					</button>
					<button class="btn btn-ghost btn-small" onclick={discardFork}>discard fork</button>
				</div>
			</div>
		{/if}

		<PresenceAvatars entries={presence} />

		<ReminderInbox
			reminders={household?.reminders ?? []}
			{myLabel}
			onDone={(id) => session?.completeReminder(id)}
		/>

		<form
			class="add-item"
			onsubmit={(e) => {
				e.preventDefault();
				addItem();
			}}
		>
			<input
				class="input"
				type="text"
				placeholder={scanLookupPending ? "looking up product…" : "add an item"}
				bind:value={newItemText}
				oninput={() => (scanLookupMissed = false)}
				autocomplete="off"
			/>
			{#if browserSpeechAvailable() || supportsVoiceCapture()}
				<button
					class="btn btn-ghost scan-btn"
					type="button"
					onclick={() => (showVoice = true)}
					aria-label="Add items by voice"
					title="say what you need"
				>
					🎙️
				</button>
			{/if}
			<button
				class="btn btn-ghost scan-btn"
				type="button"
				onclick={() => (showScanner = true)}
				aria-label="Scan a barcode"
				title="scan a barcode"
			>
				📷
			</button>
			<button class="btn" type="submit" disabled={!newItemText.trim()}>add</button>
		</form>
		{#if scanLookupMissed}
			<p class="scan-missed">no product match for that barcode — type the name.</p>
		{/if}

		{#if showScanner}
			<!-- Dynamically imported: @zxing/library is a ~145kB-gzipped barcode
			     decoding engine, and most visits to this page never scan
			     anything. Loading it eagerly would tax every list-open for a
			     feature only some visits use -- exactly the kind of cost this
			     app's whole "fast, offline-first" pitch means avoiding. -->
			{#await import("$lib/components/BarcodeScanner.svelte") then { default: BarcodeScanner }}
				<BarcodeScanner onDetected={handleBarcode} onClose={() => (showScanner = false)} />
			{/await}
		{/if}

		{#if showVoice}
			<!-- Dynamically imported for the same reason as the scanner above,
			     only more so: transformers.js is a full ONNX runtime, and the
			     model weights behind it are tens of megabytes. Neither should
			     ever be on the path of simply opening a list. -->
			{#await import("$lib/components/VoiceCapture.svelte") then { default: VoiceCapture }}
				<VoiceCapture onItems={addSpokenItems} onClose={() => (showVoice = false)} />
			{/await}
		{/if}

		<ul
			class="items"
			use:dragHandleZone={{ items: dndItems, flipDurationMs: 200, delayTouchStart: true }}
			onconsider={handleConsider}
			onfinalize={handleFinalize}
		>
			{#each dndItems as item (item.id)}
				<li
					class="card card-flat"
					class:checked={item.checked}
					class:flash={item.id in flashes}
					style={item.id in flashes ? `--flash-color:${flashes[item.id]}` : ""}
					animate:flip={{ duration: 200 }}
				>
					<div class="item-row">
						<span class="drag-handle" use:dragHandle aria-label="drag to reorder">⠿</span>
						<button class="icon-circle check" onclick={() => toggle(item.id, item.checked)} aria-label="Toggle checked">
							{item.checked ? "✓" : ""}
						</button>
						{#if editingItemId === item.id}
							<input
								class="input edit-input"
								type="text"
								bind:value={editingText}
								onblur={commitEdit}
								onkeydown={(e) => e.key === "Enter" && commitEdit()}
							/>
						{:else}
							<div class="text-wrap">
								<button class="text" onclick={() => startEdit(item.id, item.text)}>{item.text}</button>
								<span class="added-by">added by {item.addedBy}</span>
							</div>
						{/if}
						<button
							class="remind-toggle"
							onclick={() => (remindingItem = { id: item.id, text: item.text })}
							aria-label={`Remind someone about ${item.text}`}
							title="remind someone"
						>
							🔔
						</button>
						<button
							class="note-toggle"
							class:has-note={item.note.length > 0}
							onclick={() => toggleNote(item.id)}
							aria-label="Toggle shared note"
						>
							📝
						</button>
						<button class="remove" onclick={() => removeItem(item.id)} aria-label="Remove item">✕</button>
					</div>
					{#if expandedNoteId === item.id && expandedNoteText}
						<!-- svelte-ignore a11y_autofocus -->
						<textarea
							class="note-editor"
							use:bindYText={expandedNoteText}
							placeholder="shared note -- everyone here sees you typing, live"
							rows="2"
							autofocus
						></textarea>
					{/if}
				</li>
			{/each}
		</ul>

		{#if dndItems.length === 0}
			<p class="empty">nothing here yet.</p>
		{/if}

		{#if remindingItem}
			<ReminderSheet
				itemText={remindingItem.text}
				{people}
				{roomId}
				onSend={(choice) => void sendReminder(choice)}
				onClose={() => (remindingItem = null)}
			/>
		{/if}

		<div class="list-actions">
			<button class="btn btn-ghost" onclick={() => (showActivity = !showActivity)}>activity</button>
			<button class="btn btn-ghost" onclick={fork}>fork this list</button>
		</div>

		{#if showActivity}
			<ActivityPanel
				entries={activity.filter((e) => e.listId === listId)}
				currentItems={list.items}
				onRestore={restoreItem}
				onClose={() => (showActivity = false)}
			/>
		{/if}
	{:else if household}
		<p class="empty">list not found.</p>
	{:else}
		<p>loading…</p>
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
		margin-bottom: 1.25rem;
	}
	h1 {
		font-size: clamp(2.4rem, 11vw, 3.6rem);
	}
	.add-item {
		display: flex;
		gap: 0.6rem;
		margin-bottom: 1.5rem;
	}
	.add-item .input {
		flex: 1;
		min-width: 0;
	}
	.scan-btn {
		flex-shrink: 0;
		padding: 12px 16px;
		font-size: 1.2rem;
	}
	.scan-missed {
		margin: -1rem 0 1.5rem;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		color: var(--text-primary);
	}
	.items {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	.items li {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.5rem;
		padding: 0.8rem 0.9rem;
		transition:
			transform 0.12s ease,
			box-shadow 0.12s ease,
			background 0.25s ease;
	}
	.items li:hover {
		transform: translate(-2px, -2px);
		box-shadow: var(--shadow-md);
	}
	/* A checked item visibly leaves the "to buy" set: it goes flat against
	   the page instead of sitting proud of it. */
	.items li.checked {
		background: var(--bg-page);
		box-shadow: none;
	}
	.items li.checked:hover {
		transform: translate(0, 0);
		box-shadow: none;
	}
	.item-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.items li.flash {
		animation: flash-pulse 1.5s ease-out;
	}
	@keyframes flash-pulse {
		0% {
			box-shadow: 0 0 0 4px var(--flash-color);
		}
		100% {
			box-shadow: 0 0 0 4px transparent;
		}
	}
	.drag-handle {
		flex-shrink: 0;
		font-size: 1.2rem;
		color: var(--text-secondary);
		cursor: grab;
		touch-action: none;
		user-select: none;
		line-height: 1;
	}
	.drag-handle:active {
		cursor: grabbing;
	}
	:global(.items li[data-is-dnd-shadow-item-hint]) {
		background: var(--bg-page);
		border-style: dashed;
		box-shadow: none;
	}
	.check {
		font-size: 0.95rem;
		font-weight: 800;
		color: var(--color-teal);
	}
	.items li.checked .check {
		background: var(--color-teal);
		color: var(--text-primary);
	}
	.text-wrap {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.1rem;
	}
	.text {
		text-align: left;
		background: none;
		border: none;
		padding: 0;
		font-family: var(--font-display);
		font-size: 1.05rem;
		letter-spacing: -0.02em;
		text-transform: lowercase;
		color: var(--text-primary);
		cursor: pointer;
	}
	.items li.checked .text {
		color: var(--text-secondary);
		text-decoration: line-through;
	}
	.added-by {
		font-family: var(--font-mono);
		font-size: 0.68rem;
		color: var(--text-secondary);
	}
	.list-actions {
		display: flex;
		gap: 0.6rem;
		margin-top: 1.5rem;
	}
	.list-actions .btn {
		flex: 1;
	}
	.fork-banner {
		padding: 1.15rem 1.25rem;
		margin-bottom: 1.25rem;
		background: var(--color-lavender);
	}
	.fork-banner p {
		color: var(--text-primary);
		margin-bottom: 0.85rem;
	}
	.fork-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}
	.edit-input {
		flex: 1;
		min-width: 0;
		padding: 8px 12px;
		box-shadow: none;
	}
	.remove {
		flex-shrink: 0;
		background: none;
		border: none;
		color: var(--text-secondary);
		padding: 0.25rem;
		font-weight: 700;
		cursor: pointer;
	}
	.remove:hover {
		color: var(--color-primary);
	}
	.remind-toggle {
		flex-shrink: 0;
		background: none;
		border: none;
		padding: 0.25rem;
		cursor: pointer;
		opacity: 0.35;
		font-size: 0.95rem;
		line-height: 1;
	}
	.remind-toggle:hover {
		opacity: 1;
	}
	.note-toggle {
		flex-shrink: 0;
		background: none;
		border: none;
		padding: 0.25rem;
		cursor: pointer;
		opacity: 0.35;
		font-size: 0.95rem;
		line-height: 1;
	}
	.note-toggle.has-note {
		opacity: 1;
	}
	.note-editor {
		width: 100%;
		box-sizing: border-box;
		resize: vertical;
		font-family: var(--font);
		font-size: 0.88rem;
		padding: 0.6rem 0.75rem;
		border-radius: var(--radius-sm);
		border: var(--border-thin);
		background: var(--bg-page);
		color: var(--text-primary);
	}
	.empty {
		text-align: center;
		margin-top: 2.5rem;
		font-family: var(--font-mono);
		font-size: 0.85rem;
	}
</style>
