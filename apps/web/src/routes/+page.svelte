<script lang="ts">
	import { goto } from "$app/navigation";
	import { createRoom, resolveShortCode } from "$lib/api";
	import { parseInviteFragment } from "$lib/invite";
	import { listKnownHouseholds, rememberHousehold, type KnownHousehold } from "$lib/local-households";
	import { onMount } from "svelte";

	let households = $state<KnownHousehold[]>([]);
	let newHouseholdName = $state("");
	let joinCode = $state("");
	let busy = $state(false);
	let error = $state("");

	onMount(() => {
		households = listKnownHouseholds();
	});

	async function createHousehold(): Promise<void> {
		const name = newHouseholdName.trim();
		if (!name) return;
		busy = true;
		error = "";
		try {
			const { roomId } = await createRoom();
			rememberHousehold(roomId, name);
			await goto(`/h/${roomId}?new=${encodeURIComponent(name)}`);
		} catch (e) {
			error = e instanceof Error ? e.message : "Failed to create household";
		} finally {
			busy = false;
		}
	}

	async function joinByCode(): Promise<void> {
		const code = joinCode.trim();
		if (!code) return;
		busy = true;
		error = "";
		try {
			const roomId = await resolveShortCode(code);
			await goto(`/join#room=${roomId}`);
		} catch (e) {
			error = e instanceof Error ? e.message : "Code not found or expired";
		} finally {
			busy = false;
		}
	}

	function pasteLink(text: string): void {
		const hashIndex = text.indexOf("#");
		const fragment = hashIndex >= 0 ? text.slice(hashIndex) : text;
		const parsed = parseInviteFragment(fragment);
		if (parsed) {
			void goto(`/join#room=${parsed.roomId}`);
		} else {
			error = "That doesn't look like a tandem invite link";
		}
	}
</script>

<main>
	<h1>Tandem</h1>
	<p class="tagline">Shared lists that work even when you're offline.</p>

	{#if households.length > 0}
		<section>
			<h2>Your households</h2>
			<ul class="household-list">
				{#each households as h (h.roomId)}
					<li>
						<a href={`/h/${h.roomId}`}>{h.name}</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section>
		<h2>Create a household</h2>
		<form onsubmit={(e) => { e.preventDefault(); createHousehold(); }}>
			<input type="text" placeholder="e.g. The Smiths" bind:value={newHouseholdName} disabled={busy} />
			<button type="submit" disabled={busy || !newHouseholdName.trim()}>Create</button>
		</form>
	</section>

	<section>
		<h2>Join a household</h2>
		<form onsubmit={(e) => { e.preventDefault(); joinByCode(); }}>
			<input
				type="text"
				placeholder="Invite code or paste a link"
				bind:value={joinCode}
				disabled={busy}
				onpaste={(e) => {
					const text = e.clipboardData?.getData("text") ?? "";
					if (text.includes("#room=")) {
						e.preventDefault();
						pasteLink(text);
					}
				}}
			/>
			<button type="submit" disabled={busy || !joinCode.trim()}>Join</button>
		</form>
	</section>

	{#if error}
		<p class="error">{error}</p>
	{/if}
</main>

<style>
	main {
		padding: 1.5rem 1.25rem 3rem;
	}
	h1 {
		margin-bottom: 0.25rem;
	}
	.tagline {
		color: var(--text-dim);
		margin-top: 0;
		margin-bottom: 2rem;
	}
	section {
		margin-bottom: 2rem;
	}
	h2 {
		font-size: 0.9rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-dim);
		margin-bottom: 0.75rem;
	}
	.household-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.household-list a {
		display: block;
		padding: 1rem;
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		text-decoration: none;
		color: var(--text);
		font-weight: 500;
	}
	form {
		display: flex;
		gap: 0.5rem;
	}
	input {
		flex: 1;
		padding: 0.85rem 1rem;
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		color: var(--text);
	}
	button {
		padding: 0.85rem 1.25rem;
		background: var(--accent);
		color: #04211d;
		border: none;
		border-radius: 0.75rem;
		font-weight: 600;
	}
	button:disabled {
		opacity: 0.5;
	}
	.error {
		color: var(--danger);
	}
</style>
