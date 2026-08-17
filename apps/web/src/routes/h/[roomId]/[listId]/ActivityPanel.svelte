<script lang="ts">
	import type { ActivitySnapshot, ItemSnapshot } from "@tandem/doc-schema";

	let { entries, currentItems, onRestore, onClose }: {
		entries: ActivitySnapshot[];
		currentItems: ItemSnapshot[];
		onRestore: (itemId: string) => void;
		onClose: () => void;
	} = $props();

	// list.* entries describe this list's relationship to the household, not
	// something actionable while already inside it -- surfaced instead on the
	// household page's "recently removed lists" panel.
	let itemEntries = $derived(entries.filter((e) => e.type.startsWith("item.")));

	function describe(entry: ActivitySnapshot): string {
		switch (entry.type) {
			case "item.added":
				return `added "${entry.itemText}"`;
			case "item.edited":
				return `renamed "${entry.previousText}" to "${entry.itemText}"`;
			case "item.checked":
				return `checked "${entry.itemText}"`;
			case "item.unchecked":
				return `unchecked "${entry.itemText}"`;
			case "item.archived":
				return `removed "${entry.itemText}"`;
			case "item.unarchived":
				return `restored "${entry.itemText}"`;
			default:
				return entry.type;
		}
	}

	// Only the most-recent "archived" entry for a still-archived item should
	// offer restore -- entries is sorted most-recent-first, so a stale entry
	// from a since-reversed archive/restore cycle never shows a dead restore.
	function canRestore(entry: ActivitySnapshot): boolean {
		if (entry.type !== "item.archived" || !entry.itemId) return false;
		const live = currentItems.find((i) => i.id === entry.itemId);
		return live?.archived === true;
	}
</script>

<div class="card activity-panel">
	{#if itemEntries.length === 0}
		<p class="empty">no activity yet.</p>
	{:else}
		<ul class="entries">
			{#each itemEntries as entry (entry.id)}
				<li>
					<div class="entry-text">
						<span class="actor">{entry.actorLabel}</span>
						<span class="action">{describe(entry)}</span>
					</div>
					{#if canRestore(entry)}
						<button class="btn btn-teal btn-small" onclick={() => onRestore(entry.itemId!)}>restore</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	<button class="btn-close" onclick={onClose}>close</button>
</div>

<style>
	.activity-panel {
		margin-top: 0.75rem;
		padding: 1.25rem;
	}
	.empty {
		text-align: center;
		color: var(--text-secondary);
	}
	.entries {
		list-style: none;
		padding: 0;
		margin: 0 0 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.entries li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.entry-text {
		display: flex;
		flex-direction: column;
	}
	.actor {
		font-weight: 700;
	}
	.action {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	.btn-small {
		padding: 8px 16px;
		font-size: 0.85rem;
		flex-shrink: 0;
	}
	.btn-close {
		background: none;
		border: none;
		color: var(--text-secondary);
		font-weight: 600;
		cursor: pointer;
	}
</style>
