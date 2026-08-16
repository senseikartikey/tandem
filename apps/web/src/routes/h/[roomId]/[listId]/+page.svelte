<script lang="ts">
	import { getDeviceLabel } from "$lib/local-households";
	import type { HouseholdSession } from "$lib/sync/household-session";
	import { getOrJoinSession } from "$lib/sync/session-cache";
	import type { HouseholdSnapshot, ListSnapshot } from "@tandem/doc-schema";
	import { onDestroy, onMount } from "svelte";
	import type { PageProps } from "./$types";

	// See h/[roomId]/+page.svelte's comment on why the typed PageProps params
	// are used here instead of $app/state's broadly-typed page.params.
	let { params }: PageProps = $props();
	const roomId = params.roomId;
	const listId = params.listId;

	let session = $state<HouseholdSession | null>(null);
	let household = $state<HouseholdSnapshot | null>(null);
	let newItemText = $state("");
	let editingItemId = $state<string | null>(null);
	let editingText = $state("");

	let unsubscribe: (() => void) | null = null;

	let list = $derived<ListSnapshot | null>(
		household?.lists.find((l) => l.id === listId) ?? null,
	);

	onMount(async () => {
		// Reuses the cached session from the parent /h/[roomId] page if this
		// household is already open (the common case -- you navigate here from
		// there); joins fresh otherwise (e.g. a deep link straight to a list).
		session = await getOrJoinSession(roomId, getDeviceLabel());
		unsubscribe = session.household.subscribe((snapshot) => {
			household = snapshot;
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
</script>

<main>
	<a href={`/h/${roomId}`} class="back">&larr; {household?.name ?? "Household"}</a>

	{#if list}
		<h1>{list.name}</h1>

		<form class="add-item" onsubmit={(e) => { e.preventDefault(); addItem(); }}>
			<input type="text" placeholder="Add an item" bind:value={newItemText} autocomplete="off" />
			<button type="submit" disabled={!newItemText.trim()}>Add</button>
		</form>

		<ul class="items">
			{#each list.items.filter((i) => !i.archived) as item (item.id)}
				<li class:checked={item.checked}>
					<button class="check" onclick={() => toggle(item.id, item.checked)} aria-label="Toggle checked">
						{item.checked ? "✓" : ""}
					</button>
					{#if editingItemId === item.id}
						<input
							class="edit-input"
							type="text"
							bind:value={editingText}
							onblur={commitEdit}
							onkeydown={(e) => e.key === "Enter" && commitEdit()}
						/>
					{:else}
						<button class="text" onclick={() => startEdit(item.id, item.text)}>{item.text}</button>
					{/if}
					<button class="remove" onclick={() => removeItem(item.id)} aria-label="Remove item">✕</button>
				</li>
			{/each}
		</ul>

		{#if list.items.filter((i) => !i.archived).length === 0}
			<p class="empty">Nothing here yet.</p>
		{/if}
	{:else if household}
		<p class="empty">List not found.</p>
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
	.add-item {
		display: flex;
		gap: 0.5rem;
		margin: 1.25rem 0;
	}
	.add-item input {
		flex: 1;
		padding: 0.85rem 1rem;
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		color: var(--text);
	}
	.add-item button {
		padding: 0.85rem 1.25rem;
		background: var(--accent);
		color: #04211d;
		border: none;
		border-radius: 0.75rem;
		font-weight: 600;
	}
	.add-item button:disabled {
		opacity: 0.5;
	}
	.items {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.items li {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 0.75rem;
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: 0.75rem;
	}
	.check {
		flex-shrink: 0;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 50%;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--accent);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
	}
	.items li.checked .check {
		background: var(--accent);
		color: #04211d;
	}
	.text {
		flex: 1;
		text-align: left;
		background: none;
		border: none;
		padding: 0;
		color: var(--text);
	}
	.items li.checked .text {
		color: var(--text-dim);
		text-decoration: line-through;
	}
	.edit-input {
		flex: 1;
		padding: 0.4rem 0.6rem;
		background: var(--bg);
		border: 1px solid var(--accent);
		border-radius: 0.4rem;
		color: var(--text);
	}
	.remove {
		flex-shrink: 0;
		background: none;
		border: none;
		color: var(--text-dim);
		padding: 0.25rem;
	}
	.empty {
		color: var(--text-dim);
		text-align: center;
		margin-top: 2rem;
	}
</style>
