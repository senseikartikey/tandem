<script lang="ts">
	import { getDeviceLabel, getStoredDeviceLabel, setDeviceLabel } from "$lib/local-households";

	// Must read getStoredDeviceLabel() (no side effect) before getDeviceLabel()
	// (which auto-generates and persists a fallback) -- otherwise the
	// auto-generate call clobbers the "was it ever set" check before this
	// component gets to read it, and the first-visit prompt never shows.
	const wasStored = getStoredDeviceLabel() !== null;
	let name = $state(getDeviceLabel());
	let editing = $state(!wasStored);
	// First-visit prompt starts blank (not pre-filled with the meaningless
	// random fallback) -- an accidental blur/submit before typing anything
	// then just leaves the random fallback in place (save()'s trimmed-empty
	// guard skips the write) instead of silently "confirming" a string the
	// user never chose and likely never even saw.
	let draft = $state(wasStored ? name : "");

	function startEdit(): void {
		draft = name;
		editing = true;
	}

	function save(): void {
		const trimmed = draft.trim();
		if (trimmed) {
			setDeviceLabel(trimmed);
			name = trimmed;
		}
		editing = false;
	}

	function focusOnMount(el: HTMLInputElement): void {
		el.focus();
		el.select();
	}
</script>

{#if editing}
	<form
		class="your-name-edit"
		onsubmit={(e) => {
			e.preventDefault();
			save();
		}}
	>
		<span class="prompt">— what should we call you?</span>
		<input
			class="input"
			type="text"
			placeholder="e.g. kartikey"
			bind:value={draft}
			onblur={save}
			use:focusOnMount
			maxlength="40"
		/>
	</form>
{:else}
	<button class="your-name-pill" onclick={startEdit}>
		you're <strong>{name}</strong> · edit
	</button>
{/if}

<style>
	.your-name-edit {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
	}
	.prompt {
		font-family: var(--font-mono);
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary);
	}
	/* Reads as a stamped identity badge rather than a text link -- it's the
	   one place your name is set, and every other view attributes edits to
	   it. */
	.your-name-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		margin-bottom: 1.25rem;
		padding: 0.45rem 0.9rem;
		background: var(--bg-surface);
		border: var(--border-thin);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-sm);
		font-family: var(--font-mono);
		font-size: 0.78rem;
		color: var(--text-secondary);
		cursor: pointer;
		transition:
			transform 0.12s ease,
			box-shadow 0.12s ease;
	}
	.your-name-pill:hover {
		color: var(--text-primary);
		transform: translate(-2px, -2px);
		box-shadow: var(--shadow-md);
	}
	.your-name-pill strong {
		font-family: var(--font-display);
		font-weight: 400;
		color: var(--text-primary);
	}
</style>
