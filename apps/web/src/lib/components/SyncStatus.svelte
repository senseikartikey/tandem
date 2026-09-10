<script lang="ts">
	import type { SyncStatus } from "$lib/sync/status-store.js";

	let { status }: { status: SyncStatus } = $props();

	// Wording matters more than the dot here. Nothing in this app fails when
	// the relay is away -- edits are already saved -- so the copy has to say
	// "not shared yet", never "error".
	const LABELS: Record<SyncStatus, string> = {
		connected: "live",
		connecting: "connecting…",
		offline: "offline — saved here",
	};
</script>

<span class="sync" data-status={status} title={LABELS[status]}>
	<span class="dot"></span>
	{LABELS[status]}
</span>

<style>
	.sync {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.7rem;
		border: var(--border-thin);
		border-radius: var(--radius-pill);
		background: var(--bg-surface);
		font-family: var(--font-mono);
		font-size: 0.68rem;
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--text-secondary);
	}
	.sync[data-status="connected"] .dot {
		background: var(--color-teal);
	}
	/* Only the unresolved state animates -- a steady "live" that keeps
	   pulsing reads as an alarm rather than a status. */
	.sync[data-status="connecting"] .dot {
		background: var(--color-yellow);
		animation: sync-pulse 1.2s ease-in-out infinite;
	}
	.sync[data-status="offline"] .dot {
		background: var(--color-primary);
	}
	@keyframes sync-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.3;
		}
	}
</style>
