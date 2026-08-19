<script lang="ts">
	import { goto } from "$app/navigation";
	import { createRoom, describeApiError, resolveShortCode } from "$lib/api";
	import { parseInviteFragment } from "$lib/invite";
	import {
		forgetHousehold,
		listKnownHouseholds,
		rememberHousehold,
		type KnownHousehold,
	} from "$lib/local-households";
	import { onMount } from "svelte";
	import YourName from "$lib/components/YourName.svelte";

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
			error = describeApiError(e, "failed to create household");
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
			error = describeApiError(e, "code not found or expired");
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

	// Plain <a href="#id"> hero CTAs handed scroll-to-top-after-jump behavior
	// to SvelteKit's client router, which doesn't treat a same-page hash
	// link as pure in-page navigation the way a browser normally would.
	// scrollIntoView sidesteps that router path entirely.
	function scrollToPanel(id: string): void {
		document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
	}

	// Purely decorative: loops the hero mock list through a believable
	// checking-off sequence so it reads as "live product," not a static
	// screenshot. Each frame is which of [oat milk, eggs, bread] is checked.
	const mockItems = ["oat milk", "eggs", "bread"];
	const mockFrames = [
		[true, false, false],
		[true, true, false],
		[true, true, true],
		[true, true, true],
		[true, false, false],
	];
	let mockChecked = $state(mockFrames[0]);

	onMount(() => {
		let frame = 0;
		const interval = setInterval(() => {
			frame = (frame + 1) % mockFrames.length;
			mockChecked = mockFrames[frame];
		}, 1400);
		return () => clearInterval(interval);
	});
</script>

<main class="landing">
	<div class="landing-inner">
		<nav class="topbar">
			<span class="logo">tandem</span>
			<a class="btn btn-ghost btn-small" href="https://github.com/senseikartikey/tandem" target="_blank" rel="noopener">
				github ↗
			</a>
		</nav>

		<section class="hero">
			<div class="hero-copy">
				<h1>shared lists that actually work offline.</h1>
				<p class="tagline">No accounts. No app store. Just a link that works with zero bars.</p>
				<div class="hero-actions">
					<button class="btn" onclick={() => scrollToPanel("create-panel")}>create a household</button>
					<button class="btn btn-ghost" onclick={() => scrollToPanel("join-panel")}>join with a code</button>
				</div>
			</div>

			<div class="hero-art" aria-hidden="true">
				<svg class="deco" style="top:-10px; left:-6px;" width="26" height="26" viewBox="0 0 32 32">
					<path
						d="M16 2 L17.5 14.5 L30 16 L17.5 17.5 L16 30 L14.5 17.5 L2 16 L14.5 14.5 Z"
						fill="#ffe566"
						stroke="#111"
						stroke-width="1.5"
					/>
				</svg>
				<svg class="deco" style="bottom:6px; right:-14px;" width="60" height="60" viewBox="0 0 80 80">
					<path
						d="M40 5 C55 5,75 20,75 40 C75 60,60 75,40 75 C20 75,5 60,5 40 C5 20,25 5,40 5Z"
						fill="#c4b5fd"
						stroke="#111"
						stroke-width="2"
					/>
				</svg>
				<div class="mock-card card">
					<div class="mock-card-header">groceries</div>
					{#each mockItems as item, i (item)}
						<div class="mock-item" class:checked={mockChecked[i]}>
							<span class="icon-circle mock-check">{mockChecked[i] ? "✓" : ""}</span>
							<span class="mock-text">{item}</span>
							{#if i === 1}<span class="mock-badge">added by kartikey</span>{/if}
						</div>
					{/each}
				</div>
				<span class="mock-chip">synced • offline</span>
			</div>
		</section>

		<section class="features">
			<h2>why tandem</h2>
			<div class="feature-grid">
				<div class="feature-card feature-lead card">
					<span class="feature-icon">🍴</span>
					<h3>fork a list</h3>
					<p>Draft a version without touching the real list. Merge it back when you're happy, or throw it away — either way, nothing was ever at risk.</p>
				</div>
				<div class="feature-card card">
					<span class="feature-icon">📶</span>
					<h3>works with no signal</h3>
					<p>Your device is the source of truth. Most list apps break offline — this one doesn't.</p>
				</div>
				<div class="feature-card card">
					<span class="feature-icon">🏷️</span>
					<h3>see who did what</h3>
					<p>Every add, edit, and check-off is attributed to a real person, not a guess.</p>
				</div>
				<div class="feature-card card">
					<span class="feature-icon">↩️</span>
					<h3>undo, anytime</h3>
					<p>Removed something by mistake? One tap brings it back — items or whole lists.</p>
				</div>
				<div class="feature-card card">
					<span class="feature-icon">🟢</span>
					<h3>shop together, live</h3>
					<p>See who else has the list open right now, and watch their check-offs flash in as they happen — no more buying the same thing twice.</p>
				</div>
			</div>
		</section>

		<YourName />

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

		<section class="forms-grid">
			<div class="card form-panel" id="create-panel">
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
			</div>

			<div class="card form-panel" id="join-panel">
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
			</div>
		</section>

		{#if error}
			<p class="error">{error}</p>
		{/if}

		<footer>
			<p>
				local-first, CRDT-synced, built in the open —
				<a href="https://github.com/senseikartikey/tandem" target="_blank" rel="noopener">source on GitHub</a>.
			</p>
		</footer>
	</div>
</main>

<style>
	.landing {
		padding: 0 1.25rem 3rem;
	}
	.landing-inner {
		max-width: 1120px;
		margin-inline: auto;
	}

	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.5rem 0 1rem;
	}
	.logo {
		font-size: 1.3rem;
		font-weight: 800;
		letter-spacing: -0.01em;
	}
	.btn-small {
		padding: 8px 16px;
		font-size: 0.85rem;
	}

	/* --- Hero --- */
	.hero {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 2rem;
		padding: 2rem 0 1rem;
	}
	.hero-copy {
		max-width: 640px;
	}
	.tagline {
		margin-top: 0.9rem;
		font-size: 0.98rem;
		max-width: 480px;
	}
	.hero-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 1.75rem;
	}

	.hero-art {
		position: relative;
		align-self: center;
		width: 100%;
		max-width: 320px;
		padding: 1rem 0;
	}
	.mock-card {
		padding: 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		background: var(--bg-surface);
	}
	.mock-card-header {
		font-weight: 800;
		font-size: 1.1rem;
		margin-bottom: 0.2rem;
	}
	.mock-item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		position: relative;
	}
	.mock-check {
		width: 24px;
		height: 24px;
		font-size: 0.75rem;
		transition:
			background 0.35s ease,
			color 0.35s ease;
	}
	.mock-item.checked .mock-check {
		background: var(--color-teal);
		color: #fff;
	}
	.mock-text {
		font-weight: 600;
		transition: color 0.35s ease;
	}
	.mock-item.checked .mock-text {
		color: var(--text-secondary);
		text-decoration: line-through;
	}
	.mock-badge {
		position: absolute;
		left: 2.1rem;
		top: 1.4rem;
		font-size: 0.62rem;
		font-weight: 700;
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.mock-chip {
		position: absolute;
		bottom: -0.6rem;
		right: 0.5rem;
		background: var(--color-teal);
		color: #fff;
		font-weight: 700;
		font-size: 0.7rem;
		padding: 0.4rem 0.75rem;
		border: var(--border);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-sm);
	}

	/* --- Features --- */
	.features {
		padding: 1rem 0 2.5rem;
	}
	.features h2 {
		margin-bottom: 1.1rem;
	}
	.feature-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
	}
	.feature-card {
		padding: 1.25rem;
	}
	.feature-lead {
		grid-column: 1 / -1;
		background: var(--color-yellow);
	}
	.feature-icon {
		font-size: 1.3rem;
		display: inline-block;
		margin-bottom: 0.5rem;
	}
	.feature-card h3 {
		font-size: 0.92rem;
		font-weight: 800;
		margin-bottom: 0.35rem;
	}
	.feature-lead h3 {
		font-size: 1.05rem;
	}
	.feature-card p {
		font-size: 0.82rem;
		line-height: 1.45;
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

	/* --- Forms --- */
	.forms-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
		scroll-margin-top: 1.5rem;
	}
	.form-panel {
		padding: 1.5rem;
		scroll-margin-top: 1.5rem;
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

	footer {
		padding-top: 1.5rem;
		border-top: var(--border);
	}
	footer p {
		font-size: 0.82rem;
	}

	@media (min-width: 860px) {
		.hero {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			padding: 3.5rem 0 1.5rem;
		}
		.hero-copy h1 {
			font-size: clamp(2.4rem, 3.6vw, 3.4rem);
		}
		.hero-art {
			max-width: 340px;
			flex-shrink: 0;
		}
		.feature-grid {
			grid-template-columns: repeat(2, 1fr);
		}
		.forms-grid {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
