<script lang="ts">
	import { goto } from "$app/navigation";
	import { createRoom, resolveShortCode } from "$lib/api";
	import { parseInviteFragment } from "$lib/invite";
	import {
		forgetHousehold,
		listKnownHouseholds,
		rememberHousehold,
		type KnownHousehold,
	} from "$lib/local-households";
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

	// Only removes this household from *this device's* local list -- the
	// household itself and its data are untouched (other members, and this
	// device too, can still get back in via the invite link). There's no
	// concept of "delete a household" server-side at all: no accounts means
	// no ownership to check, so this button can only ever affect what's
	// remembered locally.
	function removeHousehold(roomId: string): void {
		forgetHousehold(roomId);
		households = households.filter((h) => h.roomId !== roomId);
	}

	function pasteLink(text: string): void {
		const hashIndex = text.indexOf("#");
		const fragment = hashIndex >= 0 ? text.slice(hashIndex) : text;
		const parsed = parseInviteFragment(fragment);
		if (parsed) {
			void goto(`/join#room=${parsed.roomId}`);
		} else {
			error = "that doesn't look like a tandem invite link";
		}
	}
</script>

<main>
	<div class="hero">
		<svg class="deco" style="top:-6px; right:36px;" width="28" height="28" viewBox="0 0 32 32">
			<path
				d="M16 2 L17.5 14.5 L30 16 L17.5 17.5 L16 30 L14.5 17.5 L2 16 L14.5 14.5 Z"
				fill="#ffe566"
				stroke="#111"
				stroke-width="1.5"
			/>
		</svg>
		<svg class="deco" style="top:38px; right:-4px;" width="22" height="22" viewBox="0 0 80 80">
			<path
				d="M40 5 C55 5,75 20,75 40 C75 60,60 75,40 75 C20 75,5 60,5 40 C5 20,25 5,40 5Z"
				fill="#c4b5fd"
				stroke="#111"
				stroke-width="2"
			/>
		</svg>
		<h1>tandem</h1>
		<p class="tagline">shared lists that work even when you're offline.</p>
	</div>

	{#if households.length > 0}
		<section>
			<h2>your households</h2>
			<ul class="household-list">
				{#each households as h (h.roomId)}
					<li class="card household-row">
						<a class="household-card" href={`/h/${h.roomId}`}>{h.name}</a>
						<button
							class="remove"
							onclick={() => removeHousehold(h.roomId)}
							aria-label={`Remove ${h.name} from this device`}
							title="remove from this device"
						>
							✕
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section>
		<h2>create a household</h2>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				createHousehold();
			}}
		>
			<input
				class="input"
				type="text"
				placeholder="e.g. the smiths"
				bind:value={newHouseholdName}
				disabled={busy}
			/>
			<button class="btn" type="submit" disabled={busy || !newHouseholdName.trim()}>create</button>
		</form>
	</section>

	<section>
		<h2>join a household</h2>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				joinByCode();
			}}
		>
			<input
				class="input"
				type="text"
				placeholder="invite code or paste a link"
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
			<button class="btn btn-secondary" type="submit" disabled={busy || !joinCode.trim()}>join</button>
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
	.hero {
		position: relative;
		margin-bottom: 2rem;
		padding-top: 0.5rem;
	}
	.tagline {
		margin-top: 0.4rem;
	}
	section {
		margin-bottom: 1.75rem;
	}
	section h2 {
		margin-bottom: 0.65rem;
	}
	.household-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.household-row {
		display: flex;
		align-items: center;
		padding: 0.25rem 0.25rem 0.25rem 1rem;
		transition:
			transform 0.1s ease,
			box-shadow 0.1s ease;
	}
	.household-row:hover {
		transform: translate(2px, 2px);
		box-shadow: var(--shadow-md-hover);
	}
	.household-card {
		flex: 1;
		padding: 0.75rem 0;
		text-decoration: none;
		font-weight: 700;
		color: var(--text-primary);
	}
	.household-row .remove {
		flex-shrink: 0;
		background: none;
		border: none;
		color: var(--text-secondary);
		padding: 0.6rem 0.75rem;
		font-weight: 700;
		cursor: pointer;
	}
	.household-row .remove:hover {
		color: var(--color-primary);
	}
	form {
		display: flex;
		gap: 0.5rem;
	}
	form .input {
		flex: 1;
	}
	.error {
		color: var(--color-primary);
		font-weight: 600;
	}
</style>
