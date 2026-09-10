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

	// On a phone the eight feature cards stack into a deck you flick through
	// instead of a column you scroll for half a minute. Desktop keeps the
	// grid: there the cards are all visible at once, which is the better
	// read when there's room for it.
	let isNarrow = $state(false);
	let deckIndex = $state(0);
	let dragX = $state(0);
	let dragging = $state(false);
	let dragFrom = 0;

	onMount(() => {
		const query = window.matchMedia("(max-width: 700px)");
		const sync = () => (isNarrow = query.matches);
		sync();
		query.addEventListener("change", sync);
		return () => query.removeEventListener("change", sync);
	});

	function advance(step: number): void {
		deckIndex = (deckIndex + step + features.length) % features.length;
		dragX = 0;
	}

	// Position in the deck: 0 is the card on top, 1 and 2 peek out behind it,
	// the rest are parked out of sight until they come round.
	function deckPosition(index: number): number {
		return (index - deckIndex + features.length) % features.length;
	}

	function cardStyle(index: number): string {
		if (!isNarrow) return "";
		const pos = deckPosition(index);
		if (pos > 2) return "opacity:0;pointer-events:none;transform:translateY(30px) scale(0.88);";
		const shift = pos === 0 ? dragX : 0;
		const tilt = pos * -2.5 + shift * 0.04;
		return [
			`z-index:${10 - pos}`,
			`transform:translate(${shift}px, ${pos * 14}px) rotate(${tilt}deg) scale(${1 - pos * 0.05})`,
			`opacity:${1 - pos * 0.08}`,
		].join(";");
	}

	function onDragStart(event: PointerEvent): void {
		if (!isNarrow) return;
		dragging = true;
		dragFrom = event.clientX;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onDragMove(event: PointerEvent): void {
		if (!dragging) return;
		dragX = event.clientX - dragFrom;
	}

	// A flick past the threshold advances; anything shorter springs back, so
	// a mis-swipe never silently skips a card.
	function onDragEnd(): void {
		if (!dragging) return;
		dragging = false;
		if (Math.abs(dragX) > 60) advance(dragX < 0 ? 1 : -1);
		else dragX = 0;
	}

	// Rendered twice inside one marquee track so the -50% translate loops
	// seamlessly (see .marquee-track in app.css).
	const marqueePhrases = [
		"offline first",
		"no accounts",
		"fork a list",
		"merge it back",
		"crdt synced",
		"scan a barcode",
		"zero bars, zero problem",
	];

	const steps = [
		{
			num: "01",
			emoji: "🏠",
			title: "make a household",
			body: "name it, and it exists. no email, no password, no verification mail that never arrives.",
		},
		{
			num: "02",
			emoji: "📲",
			title: "share the code",
			body: "a QR code or six characters. whoever scans it is in, on any device.",
		},
		{
			num: "03",
			emoji: "🛒",
			title: "add stuff anywhere",
			body: "aisle five with no bars? your device is the source of truth. it syncs when it can.",
		},
		{
			num: "04",
			emoji: "🍴",
			title: "fork before you wreck it",
			body: "draft a version of the list, merge it back, or bin it. nothing was ever at risk.",
		},
	];

	const features = [
		{
			emoji: "🍴",
			label: "fork a list",
			body: "draft a version without touching the real list. merge it back when you're happy, or throw it away.",
			tag: "zero risk",
			tone: "yellow",
		},
		{
			emoji: "📶",
			label: "no signal? fine",
			body: "your device is the source of truth. most list apps break offline — this one doesn't.",
			tag: "local-first",
			tone: "teal",
		},
		{
			emoji: "🟢",
			label: "shop together",
			body: "see who else has the list open right now, and watch their check-offs flash in as they happen.",
			tag: "live presence",
			tone: "paper",
		},
		{
			emoji: "🏷️",
			label: "who did what",
			body: "every add, edit, and check-off is attributed to a real person, not a guess.",
			tag: "full history",
			tone: "lavender",
		},
		{
			emoji: "↩️",
			label: "undo anything",
			body: "removed something by mistake? one tap brings it back — items or whole lists.",
			tag: "nothing is deleted",
			tone: "pink",
		},
		{
			emoji: "📷",
			label: "scan a barcode",
			body: "point the camera at the box in your hand and the product name fills itself in.",
			tag: "camera in, name out",
			tone: "paper",
		},
		{
			emoji: "🎙️",
			label: "talk it in",
			body: "say “milk, eggs and sourdough” and it becomes three items, transcribed as you speak. tandem never hears the audio — it uses your device's own dictation, or a local model offline.",
			tag: "words in, items out",
			tone: "teal",
		},
		{
			emoji: "🔔",
			label: "nudge someone",
			body: "ask a housemate for something on the list — now, or at a time you pick. it reaches their phone even with the app closed, and stops nagging once anyone says they got it.",
			tag: "one tap, one notification",
			tone: "coral",
		},
		{
			emoji: "📝",
			label: "shared notes",
			body: "a household notepad for the wifi password, the plumber, that recipe. two people can type in the same line at once.",
			tag: "live, character by character",
			tone: "lavender",
		},
	];
</script>

<main class="landing">
	<nav class="topbar">
		<a class="logo" href="/">
			<span class="logo-dot"></span>
			tandem
			<span class="logo-mark">v0.1</span>
		</a>
		<div class="topbar-links">
			<button class="nav-link" onclick={() => scrollToPanel("how-it-works")}>how it works</button>
			<a
				class="nav-link"
				href="https://github.com/senseikartikey/tandem"
				target="_blank"
				rel="noopener">github ↗</a
			>
			<button class="btn btn-ink btn-small" onclick={() => scrollToPanel("create-panel")}>
				start a list
			</button>
		</div>
	</nav>

	<section class="hero">
		<span class="sticker sticker-1" style="--tilt: -12deg" aria-hidden="true">
			<span class="sticker-inner">
				<span class="sticker-big">0</span>
				<span class="sticker-sm">accounts</span>
			</span>
		</span>
		<span class="sticker sticker-2" style="--tilt: 8deg" aria-hidden="true">no app store ✦</span>
		<span class="sticker sticker-3" style="--tilt: -6deg" aria-hidden="true">works at 1 bar</span>

		<span class="tag hero-tag">local-first · crdt-synced · open source</span>

		<h1 class="hero-title">
			<span class="word">shared</span>
			<span class="word">lists</span>
			<span class="word stroke">that</span>
			<span class="word">work</span>
			<span class="word accent">offline<span class="period">.</span></span>
		</h1>

		<p class="hero-sub">
			one link, everyone in the house, every trolley. <em>no accounts. no app store. no bars
			needed.</em>
		</p>

		<div class="hero-cta-row">
			<button class="btn btn-ink btn-xl" onclick={() => scrollToPanel("create-panel")}>
				create a household <span class="btn-arrow">→</span>
			</button>
			<button class="btn btn-ghost btn-xl" onclick={() => scrollToPanel("join-panel")}>
				join with a code
			</button>
		</div>

		<p class="hero-meta meta">free forever • installs as an app • ~0 setup</p>

		<div class="hero-art">
			<div class="mock-card">
				<div class="mock-card-header">
					<span>groceries</span>
					<span class="mock-count">3</span>
				</div>
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

	<div class="marquee" aria-hidden="true">
		<div class="marquee-track">
			{#each [0, 1] as copy (copy)}
				<div class="marquee-content">
					{#each marqueePhrases as phrase (phrase)}
						{phrase} <span class="marquee-star">✦</span>
					{/each}
				</div>
			{/each}
		</div>
	</div>

	<section class="how" id="how-it-works">
		<div class="section-head">
			<span class="eyebrow">— how it works</span>
			<h2 class="section-title">four steps. zero passwords.</h2>
		</div>
		<div class="steps">
			{#each steps as step (step.num)}
				<div class="step">
					<span class="step-num">{step.num}</span>
					<span class="step-graphic">{step.emoji}</span>
					<h3>{step.title}</h3>
					<p>{step.body}</p>
				</div>
			{/each}
		</div>
	</section>

	<section class="features">
		<div class="section-head">
			<span class="eyebrow">— why tandem</span>
			<h2 class="section-title">the whole thing, no login.</h2>
		</div>
		<div class="feature-grid" class:deck={isNarrow}>
			{#each features as feature, i (feature.label)}
				<div
					class="feature-card"
					class:dragging={dragging && deckPosition(i) === 0}
					role="group"
					aria-label={feature.label}
					data-tone={feature.tone}
					style={cardStyle(i)}
					onpointerdown={deckPosition(i) === 0 ? onDragStart : undefined}
					onpointermove={deckPosition(i) === 0 ? onDragMove : undefined}
					onpointerup={deckPosition(i) === 0 ? onDragEnd : undefined}
					onpointercancel={deckPosition(i) === 0 ? onDragEnd : undefined}
				>
					<span class="feature-emoji">{feature.emoji}</span>
					<span class="feature-label">{feature.label}</span>
					<p>{feature.body}</p>
					<span class="feature-tag">{feature.tag}</span>
				</div>
			{/each}
		</div>

		{#if isNarrow}
			<div class="deck-controls">
				<button class="deck-btn" onclick={() => advance(-1)} aria-label="Previous feature">←</button>
				<span class="deck-count">{deckIndex + 1} / {features.length}</span>
				<button class="deck-btn" onclick={() => advance(1)} aria-label="Next feature">→</button>
			</div>
		{/if}
	</section>

	<section class="quote">
		<p class="quote-text">
			nobody buys<br />the milk<br /><span class="quote-accent">twice.</span>
		</p>
		<span class="eyebrow">— every household, after one trip</span>
		<span class="quote-arrows" aria-hidden="true">↓ ↓ ↓</span>
	</section>

	<section class="start" id="get-started">
		<div class="section-head">
			<span class="eyebrow">— ok, enough reading</span>
			<h2 class="section-title">go make a list.</h2>
		</div>

		<div class="you-panel">
			<YourName />
		</div>

		{#if households.length > 0}
			<div class="households">
				<span class="eyebrow">your households</span>
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
			</div>
		{/if}

		<div class="forms-grid">
			<div class="form-panel form-create" id="create-panel">
				<span class="form-num">01</span>
				<h3>create a household</h3>
				<p>name it and you're in. share the code after.</p>
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
					<button class="btn btn-ink btn-block" type="submit" disabled={busy || !newHouseholdName.trim()}>
						create <span class="btn-arrow">→</span>
					</button>
				</form>
			</div>

			<div class="form-panel form-join" id="join-panel">
				<span class="form-num">02</span>
				<h3>join a household</h3>
				<p>got a code or a link? paste it here.</p>
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
					<button class="btn btn-block" type="submit" disabled={busy || !joinCode.trim()}>
						join <span class="btn-arrow">→</span>
					</button>
				</form>
			</div>
		</div>

		{#if error}
			<p class="error">{error}</p>
		{/if}
	</section>

	<footer>
		<span>© {new Date().getFullYear()} tandem. local-first, CRDT-synced, built in the open.</span>
		<span class="footer-links">
			<a href="https://github.com/senseikartikey/tandem" target="_blank" rel="noopener">source</a>
			<button class="footer-link-btn" onclick={() => scrollToPanel("how-it-works")}>how it works</button>
			<button class="footer-link-btn" onclick={() => scrollToPanel("create-panel")}>start a list</button>
		</span>
	</footer>
</main>

<style>
	/* The landing page is the one route that isn't the narrow phone-card
	   shell: full-bleed bands (poster hero, ink marquee, ink footer) with
	   their own inner max-width, stacked like a printed poster. */
	.landing {
		background: var(--bg-poster);
		min-height: 100dvh;
	}

	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		padding: 1.1rem 1.25rem;
		border-bottom: var(--border);
		background: var(--bg-poster);
	}
	.logo {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-display);
		font-size: 1.35rem;
		letter-spacing: -0.03em;
		text-decoration: none;
		color: var(--text-primary);
	}
	.logo-dot {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--color-primary);
		border: var(--border-thin);
	}
	.logo-mark {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		font-weight: 500;
		opacity: 0.55;
	}
	.topbar-links {
		display: flex;
		align-items: center;
		gap: 1.25rem;
	}
	.nav-link {
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		font-family: var(--font-mono);
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-primary);
		text-decoration: none;
		border-bottom: 2px solid transparent;
	}
	.nav-link:hover {
		border-bottom-color: var(--text-primary);
	}

	/* --- Hero: centred poster type, stickers pinned to the corners --- */
	.hero {
		position: relative;
		text-align: center;
		padding: 3rem 1.25rem 4rem;
		border-bottom: var(--border);
		overflow: hidden;
	}
	.hero-tag {
		margin-bottom: 1.75rem;
	}
	.hero-title {
		font-family: var(--font-display);
		font-size: clamp(3rem, 12vw, 8.5rem);
		line-height: 0.86;
		letter-spacing: -0.045em;
		text-transform: uppercase;
		margin: 0 auto 1.25rem;
		max-width: 1200px;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0 0.35em;
	}
	.hero-title .word {
		display: inline-block;
	}
	.hero-title .stroke {
		-webkit-text-stroke: 3px var(--border-color);
		color: transparent;
	}
	.hero-title .accent {
		color: var(--color-primary);
		-webkit-text-stroke: 2px var(--border-color);
	}
	.hero-title .period {
		color: var(--text-primary);
		-webkit-text-stroke: 0;
	}
	.hero-sub {
		font-size: 1.15rem;
		font-weight: 500;
		color: var(--text-primary);
		max-width: 620px;
		margin: 0 auto 2rem;
		text-wrap: pretty;
	}
	.hero-sub em {
		font-style: normal;
		display: block;
		margin-top: 0.6rem;
		font-family: var(--font-mono);
		font-size: 0.9rem;
		opacity: 0.75;
	}
	.hero-cta-row {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.hero-meta {
		margin-bottom: 2.5rem;
	}

	.sticker-1 {
		top: 3.5rem;
		left: 4%;
		width: 108px;
		height: 108px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		border: var(--border);
		background: var(--color-primary);
		transform: rotate(-12deg);
		animation: wiggle 4s ease-in-out infinite;
	}
	.sticker-inner {
		text-align: center;
		line-height: 1;
	}
	.sticker-big {
		display: block;
		font-size: 2rem;
	}
	.sticker-sm {
		display: block;
		margin-top: 0.25rem;
		font-family: var(--font-mono);
		font-size: 0.62rem;
	}
	.sticker-2 {
		top: 3rem;
		right: 5%;
		background: var(--border-color);
		color: var(--bg-poster);
		padding: 0.7rem 1.15rem;
		border-radius: var(--radius-pill);
		font-size: 0.85rem;
		transform: rotate(8deg);
		animation: wiggle 5s ease-in-out infinite reverse;
	}
	.sticker-3 {
		bottom: 4rem;
		right: 8%;
		background: var(--color-teal);
		border: var(--border);
		border-radius: var(--radius-sm);
		padding: 0.6rem 1rem;
		font-size: 0.9rem;
		transform: rotate(-6deg);
		animation: wiggle 6s ease-in-out infinite;
	}

	/* --- Hero art: the live-looking mock list, tilted like a photo --- */
	.hero-art {
		position: relative;
		width: 100%;
		max-width: 360px;
		margin: 0 auto;
		text-align: left;
	}
	.mock-card {
		background: var(--bg-surface);
		border: var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-xl);
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		transform: rotate(-2deg);
	}
	.mock-card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-family: var(--font-display);
		font-size: 1.3rem;
		text-transform: lowercase;
		letter-spacing: -0.02em;
		margin-bottom: 0.2rem;
	}
	.mock-count {
		font-family: var(--font-mono);
		font-size: 0.8rem;
		background: var(--color-yellow);
		border: var(--border-thin);
		border-radius: var(--radius-pill);
		padding: 0.15rem 0.6rem;
	}
	.mock-item {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		position: relative;
	}
	.mock-check {
		width: 26px;
		height: 26px;
		font-size: 0.8rem;
		font-weight: 700;
		transition:
			background 0.35s ease,
			color 0.35s ease;
	}
	.mock-item.checked .mock-check {
		background: var(--color-teal);
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
		left: 2.3rem;
		top: 1.4rem;
		font-family: var(--font-mono);
		font-size: 0.6rem;
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.mock-chip {
		position: absolute;
		bottom: -1.5rem;
		right: -1rem;
		background: var(--color-teal);
		font-family: var(--font-mono);
		font-size: 0.72rem;
		font-weight: 600;
		padding: 0.45rem 0.85rem;
		border: var(--border);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-sm);
		transform: rotate(4deg);
	}

	.marquee-star {
		opacity: 0.6;
		padding: 0 0.35em;
	}

	/* --- Section scaffolding shared by how-it-works / features --- */
	.section-head {
		max-width: 1160px;
		margin: 0 auto 2.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.section-title {
		font-family: var(--font-display);
		font-size: clamp(2rem, 6vw, 4.5rem);
		font-weight: 400;
		line-height: 0.95;
		letter-spacing: -0.035em;
		text-transform: lowercase;
		color: var(--text-primary);
	}

	.how {
		padding: 4rem 1.25rem;
		border-bottom: var(--border);
		background: var(--bg-page);
	}
	.steps {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.25rem;
		max-width: 1160px;
		margin: 0 auto;
	}
	.step {
		border: var(--border);
		border-radius: var(--radius-md);
		padding: 1.5rem;
		background: var(--bg-surface);
		box-shadow: var(--shadow-md);
		transition:
			transform 0.15s ease,
			box-shadow 0.15s ease;
	}
	.step:hover {
		transform: translate(-3px, -3px);
		box-shadow: var(--shadow-lift);
	}
	.step:nth-child(2) {
		background: var(--color-pink);
	}
	.step:nth-child(3) {
		background: var(--color-teal);
	}
	.step:nth-child(4) {
		background: var(--color-lavender);
	}
	.step-num {
		display: inline-block;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		font-weight: 700;
		background: var(--border-color);
		color: var(--text-inverse);
		padding: 0.25rem 0.65rem;
		border-radius: var(--radius-pill);
		margin-bottom: 1rem;
	}
	.step-graphic {
		display: block;
		font-size: 2.75rem;
		line-height: 1;
		margin-bottom: 0.9rem;
	}
	.step h3 {
		font-size: 1.4rem;
		margin-bottom: 0.4rem;
	}
	.step p {
		color: var(--text-primary);
		opacity: 0.75;
		font-size: 0.92rem;
	}

	/* --- Features: flat accent cards, big display labels --- */
	.features {
		padding: 4rem 1.25rem;
		border-bottom: var(--border);
	}
	.feature-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.25rem;
		max-width: 1160px;
		margin: 0 auto;
	}
	.feature-card {
		border: var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		padding: 1.75rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		transition:
			transform 0.15s ease,
			box-shadow 0.15s ease;
	}
	.feature-card:hover {
		transform: translate(-3px, -3px) rotate(-1deg);
		box-shadow: var(--shadow-lift);
	}
	.feature-card[data-tone="yellow"] {
		background: var(--color-yellow);
	}
	.feature-card[data-tone="teal"] {
		background: var(--color-teal);
	}
	.feature-card[data-tone="coral"] {
		background: var(--color-primary);
	}
	.feature-card[data-tone="lavender"] {
		background: var(--color-lavender);
	}
	.feature-card[data-tone="pink"] {
		background: var(--color-pink);
	}
	.feature-card[data-tone="paper"] {
		background: var(--bg-surface);
	}
	.feature-emoji {
		font-size: 2.4rem;
		line-height: 1;
		margin-bottom: 0.4rem;
	}
	.feature-label {
		font-family: var(--font-display);
		font-size: 1.75rem;
		letter-spacing: -0.03em;
		text-transform: uppercase;
		line-height: 1;
	}
	.feature-card p {
		color: var(--text-primary);
		opacity: 0.8;
		font-size: 0.92rem;
		flex: 1;
	}
	.feature-tag {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		opacity: 0.65;
	}

	/* Deck mode: the cards leave the flow and stack in place, so the section
	   is one card tall however many features there are. */
	.feature-grid.deck {
		display: block;
		position: relative;
		height: 22rem;
		max-width: 420px;
		margin-inline: auto;
		perspective: 1000px;
	}
	.feature-grid.deck .feature-card {
		position: absolute;
		inset: 0;
		/* Vertical panning still belongs to the page -- only horizontal drags
		   are the deck's to handle. */
		touch-action: pan-y;
		transition:
			transform 0.28s cubic-bezier(0.22, 1, 0.36, 1),
			opacity 0.28s ease;
	}
	/* While a finger is down the card has to track it exactly; a transition
	   here would make the drag feel like it lags behind the thumb. */
	.feature-grid.deck .feature-card.dragging {
		transition: none;
	}
	.feature-grid.deck .feature-card:hover {
		transform: none;
	}
	.deck-controls {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1.25rem;
		margin-top: 1.5rem;
	}
	.deck-btn {
		width: 44px;
		height: 44px;
		border: var(--border);
		border-radius: 50%;
		background: var(--bg-surface);
		box-shadow: var(--shadow-sm);
		font-size: 1.1rem;
		cursor: pointer;
		transition:
			transform 0.12s ease,
			box-shadow 0.12s ease;
	}
	.deck-btn:active {
		transform: translate(2px, 2px);
		box-shadow: none;
	}
	.deck-count {
		font-family: var(--font-mono);
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	/* --- Pull quote --- */
	.quote {
		padding: 5rem 1.25rem;
		text-align: center;
		border-bottom: var(--border);
		background: var(--border-color);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}
	.quote .eyebrow,
	.quote-arrows {
		color: var(--text-inverse);
		opacity: 0.6;
	}
	.quote-text {
		font-family: var(--font-display);
		font-size: clamp(2.75rem, 11vw, 7rem);
		line-height: 0.88;
		letter-spacing: -0.04em;
		text-transform: uppercase;
		color: var(--text-inverse);
	}
	.quote-accent {
		color: var(--color-primary);
	}
	.quote-arrows {
		font-family: var(--font-mono);
		font-size: 1.1rem;
		letter-spacing: 0.3em;
		opacity: 0.5;
	}

	/* --- Start: the actual create/join controls --- */
	.start {
		padding: 4rem 1.25rem;
		border-bottom: var(--border);
		background: var(--bg-page);
	}
	.you-panel,
	.households,
	.forms-grid {
		max-width: 1160px;
		margin: 0 auto;
	}
	.you-panel {
		margin-bottom: 0.5rem;
	}
	.households {
		margin-bottom: 2rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.household-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
	}
	.household-row {
		display: flex;
		align-items: center;
		padding: 0.35rem 0.35rem 0.35rem 1.15rem;
		transition:
			transform 0.12s ease,
			box-shadow 0.12s ease;
	}
	.household-row:hover {
		transform: translate(-2px, -2px);
		box-shadow: var(--shadow-lg);
	}
	.household-card {
		flex: 1;
		padding: 0.8rem 0;
		text-decoration: none;
		font-family: var(--font-display);
		font-size: 1.1rem;
		text-transform: lowercase;
		letter-spacing: -0.02em;
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

	.forms-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.25rem;
		scroll-margin-top: 1.5rem;
	}
	.form-panel {
		position: relative;
		border: var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		padding: 2rem 1.75rem;
		scroll-margin-top: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.form-create {
		background: var(--bg-surface);
	}
	.form-join {
		background: var(--color-lavender);
	}
	.form-num {
		font-family: var(--font-mono);
		font-size: 0.78rem;
		font-weight: 700;
		background: var(--border-color);
		color: var(--text-inverse);
		padding: 0.25rem 0.65rem;
		border-radius: var(--radius-pill);
		align-self: flex-start;
		margin-bottom: 0.5rem;
	}
	.form-panel h3 {
		font-size: 1.6rem;
	}
	.form-panel p {
		color: var(--text-primary);
		opacity: 0.7;
		font-size: 0.9rem;
	}
	.form-panel form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}
	.error {
		max-width: 1160px;
		margin: 1.25rem auto 0;
		font-family: var(--font-mono);
		font-weight: 600;
		color: var(--text-primary);
		background: var(--color-primary);
		border: var(--border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-sm);
		padding: 0.85rem 1.1rem;
	}

	footer {
		background: var(--border-color);
		color: var(--text-inverse);
		font-family: var(--font-mono);
		font-size: 0.8rem;
		padding: 2rem 1.25rem;
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
	}
	.footer-links {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem;
	}
	footer a,
	.footer-link-btn {
		color: var(--text-inverse);
		font-family: var(--font-mono);
		font-size: 0.8rem;
		font-weight: 500;
		text-decoration: none;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
	}
	footer a:hover,
	.footer-link-btn:hover {
		color: var(--color-primary);
	}

	/* Stickers only exist where there's room for them to sit outside the
	   type; on narrow screens they'd land on top of the headline. */
	@media (max-width: 900px) {
		.sticker {
			display: none;
		}
	}

	/* Ragged-width pills read as sloppy once they stack; on phones both
	   hero CTAs take the full column. */
	@media (max-width: 560px) {
		.hero-cta-row .btn {
			width: 100%;
		}
	}

	@media (min-width: 700px) {
		.topbar,
		.hero,
		.how,
		.features,
		.quote,
		.start,
		footer {
			padding-inline: 2.5rem;
		}
		.steps {
			grid-template-columns: repeat(2, 1fr);
		}
		.feature-grid,
		.household-list {
			grid-template-columns: repeat(2, 1fr);
		}
		.forms-grid {
			grid-template-columns: 1fr 1fr;
		}
		.form-panel form {
			flex-direction: row;
			align-items: center;
		}
		.form-panel form .input {
			flex: 1;
		}
		.form-panel form .btn {
			width: auto;
			flex-shrink: 0;
		}
	}

	@media (min-width: 1000px) {
		.hero {
			padding-top: 4.5rem;
		}
		.steps {
			grid-template-columns: repeat(4, 1fr);
		}
		/* Staggered like a hand of cards -- the hover lift subtracts from
		   this offset rather than replacing it, so nothing jumps. */
		.steps .step:nth-child(2n) {
			transform: translateY(20px);
		}
		.steps .step:nth-child(2n):hover {
			transform: translate(-3px, 17px);
		}
		.feature-grid {
			grid-template-columns: repeat(3, 1fr);
		}
		.household-list {
			grid-template-columns: repeat(3, 1fr);
		}
	}
</style>
