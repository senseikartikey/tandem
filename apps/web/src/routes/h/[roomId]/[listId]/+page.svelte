<script lang="ts">
	import type { HouseholdSession } from "$lib/sync/household-session";
	import { getOrJoinSession } from "$lib/sync/session-cache";
	import type { ActivitySnapshot, HouseholdSnapshot, ListSnapshot } from "@tandem/doc-schema";
	import { onDestroy, onMount } from "svelte";
	import type { PageProps } from "./$types";
	import ActivityPanel from "./ActivityPanel.svelte";

	// See h/[roomId]/+page.svelte's comment on why the typed PageProps params
	// are used here instead of $app/state's broadly-typed page.params.
	let { params }: PageProps = $props();
	const roomId = params.roomId;
	const listId = params.listId;

	let session = $state<HouseholdSession | null>(null);
	let household = $state<HouseholdSnapshot | null>(null);
	let activity = $state<ActivitySnapshot[]>([]);
	let newItemText = $state("");
	let editingItemId = $state<string | null>(null);
	let editingText = $state("");
	let showActivity = $state(false);

	let unsubscribe: (() => void) | null = null;

	let list = $derived<ListSnapshot | null>(
		household?.lists.find((l) => l.id === listId) ?? null,
	);

	onMount(async () => {
		// Reuses the cached session from the parent /h/[roomId] page if this
		// household is already open (the common case -- you navigate here from
		// there); joins fresh otherwise (e.g. a deep link straight to a list).
		session = await getOrJoinSession(roomId);
		unsubscribe = session.household.subscribe(({ household: snapshot, activity: entries }) => {
			household = snapshot;
			activity = entries;
		});
	});

	// See the household page's onDestroy comment -- the session is cached
	// and shared, not owned by this route.
	onDestroy(() => {
		unsubscribe?.();
	});

	function addItem(): void {
		const text = newItemText.trim();
		if (!text || !session) return;
		session.addItem(listId, text);
		newItemText = "";
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
</script>

<main class="app-shell">
	<a href={`/h/${roomId}`} class="back">&larr; {household?.name ?? "household"}</a>

	{#if list}
		<h1>{list.name}</h1>

		<form
			class="add-item"
			onsubmit={(e) => {
				e.preventDefault();
				addItem();
			}}
		>
			<input class="input" type="text" placeholder="add an item" bind:value={newItemText} autocomplete="off" />
			<button class="btn" type="submit" disabled={!newItemText.trim()}>add</button>
		</form>

		<ul class="items">
			{#each list.items.filter((i) => !i.archived) as item (item.id)}
				<li class="card card-flat" class:checked={item.checked}>
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
					<button class="remove" onclick={() => removeItem(item.id)} aria-label="Remove item">✕</button>
				</li>
			{/each}
		</ul>

		{#if list.items.filter((i) => !i.archived).length === 0}
			<p class="empty">nothing here yet.</p>
		{/if}

		<button class="btn btn-ghost activity-button" onclick={() => (showActivity = !showActivity)}>
			activity
		</button>

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
		display: inline-block;
		margin-bottom: 1rem;
		text-decoration: none;
		color: var(--text-secondary);
		font-weight: 600;
	}
	h1 {
		margin-bottom: 1rem;
	}
	.add-item {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
	}
	.add-item .input {
		flex: 1;
	}
	.items {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.items li {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.7rem 0.85rem;
	}
	.check {
		font-weight: 800;
		color: var(--color-teal);
	}
	.items li.checked .check {
		background: var(--color-teal);
		color: #ffffff;
	}
	.text-wrap {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
	}
	.text {
		text-align: left;
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-weight: 600;
		color: var(--text-primary);
		cursor: pointer;
	}
	.items li.checked .text {
		color: var(--text-secondary);
		text-decoration: line-through;
	}
	.added-by {
		font-size: 0.75rem;
		color: var(--text-secondary);
	}
	.activity-button {
		width: 100%;
		margin-top: 1.25rem;
	}
	.edit-input {
		flex: 1;
		padding: 6px 10px;
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
	.empty {
		text-align: center;
		margin-top: 2rem;
	}
</style>
