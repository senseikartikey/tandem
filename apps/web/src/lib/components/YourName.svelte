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
		<span class="prompt">what should we call you?</span>
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
		gap: 0.4rem;
		margin-bottom: 1.25rem;
	}
	.prompt {
		font-weight: 700;
		font-size: 0.9rem;
	}
	.your-name-pill {
		display: inline-flex;
		background: none;
		border: none;
		padding: 0;
		margin-bottom: 1.25rem;
		font: inherit;
		font-size: 0.85rem;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.your-name-pill:hover {
		color: var(--text-primary);
	}
	.your-name-pill strong {
		color: var(--text-primary);
		margin: 0 0.25em;
	}
</style>
