<script lang="ts">
	import type { PresenceEntry } from "$lib/sync/presence-store";

	let { entries }: { entries: PresenceEntry[] } = $props();

	function initial(name: string): string {
		return name.trim().charAt(0).toUpperCase() || "?";
	}
</script>

{#if entries.length > 0}
	<div class="presence-row" role="status" aria-label={`${entries.length} other people here right now`}>
		{#each entries as entry (entry.clientId)}
			<span
				class="presence-avatar"
				style={`background:${entry.color}`}
				title={`${entry.name} is here right now`}
			>
				{initial(entry.name)}
			</span>
		{/each}
		<span class="presence-label">{entries.length === 1 ? "1 person here" : `${entries.length} people here`}</span>
	</div>
{/if}

<style>
	.presence-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 1.25rem;
	}
	.presence-avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		flex-shrink: 0;
		border: var(--border);
		border-radius: 50%;
		box-shadow: var(--shadow-sm);
		font-family: var(--font-display);
		font-size: 0.85rem;
		color: var(--text-on-accent);
	}
	.presence-avatar:not(:first-child) {
		margin-left: -0.7rem;
	}
	.presence-label {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-secondary);
	}
</style>
