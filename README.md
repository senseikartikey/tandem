# Tandem

**Live**: [web-navy-nine-12.vercel.app](https://web-navy-nine-12.vercel.app) — sync server on [Fly.io](https://tandem-sync.fly.dev/healthz).

Shared lists (groceries, chores, packing lists, to-dos) that are **genuinely
offline-first** — not just "installable." Add or check off an item with zero
signal, and it merges correctly with everyone else's changes the moment
you're back online.

## Why this exists

Real households use a shared list app on their phones multiple times a
week, often standing in a grocery store or a basement with bad signal.
That's exactly where most "real-time sync" shared-list apps fall over: they
need a live connection to work at all. I checked the actual competition
before building this — [Grocy's own docs](https://grocy.info/) admit its
installable PWA has **no offline capability**, and most shared-list apps
(Listshare, OurGroceries, Bring!) are server-authoritative, not truly
local-first.

Tandem is built on [Yjs](https://yjs.dev) (a CRDT), so every device is the
source of truth for its own data. There is no "who's the server" question —
two people can add items, check things off, and even edit the same item's
different fields *while both are offline*, and it all merges correctly with
no data loss when they reconnect. See
[`packages/doc-schema/src/document.test.ts`](packages/doc-schema/src/document.test.ts)
for the actual proof: byte-identical convergence across concurrent edits,
out-of-order update delivery, and a randomized fuzz test.

## Architecture

```
apps/web/       SvelteKit PWA (+ Capacitor for iOS/Android). Static build,
                 no server-side rendering -- Yjs/IndexedDB are client-only.
apps/server/     Node WebSocket relay + SQLite persistence. One image, used
                 identically by self-hosted deployments and any hosted
                 instance -- see docker/.
packages/
  doc-schema/    The shared Yjs document shape + mutation/read helpers.
                 Imported by both web and server so they can't drift on
                 the data model. This package's test suite is the
                 project's actual correctness proof.
docker/          Dockerfile.server + docker-compose.yml (self-host).
```

**Data model**: one Y.Doc per household (the sync unit *and* the
multi-tenancy boundary). Lists and items are keyed by UUID in a `Y.Map`,
not stored in a `Y.Array` — arrays have no native "move" operation and
produce surprising results when two peers reorder concurrently. Ordering
uses a fractional-index string instead. Deletes are soft (`archived` +
`deletedAt` fields, never a structural removal) specifically to avoid a
nasty CRDT edge case: a peer deleting an item while another peer
concurrently edits it.

**Sharing**: no accounts. An invite is a link with the room ID in the URL
**fragment** (`#room=...`), which browsers never send to the server —
possession of the link is the entire authorization model. A short 6-character
code (time-limited) and a QR code are provided as sharing conveniences on
top of the same link.

## Quick start (local dev)

```bash
pnpm install
pnpm --filter @tandem/doc-schema build   # apps/server imports the compiled output
pnpm --filter @tandem/server dev         # starts the sync server on :1234
pnpm --filter @tandem/web dev            # starts the app, connects to ws://localhost:1234
```

## Self-hosting

```bash
docker compose -f docker/docker-compose.yml up -d
```

Then build `apps/web` with `VITE_SYNC_SERVER_URL` pointed at your server and
serve the static output from any host (Vercel, Netlify, Cloudflare Pages,
nginx, whatever you like — `apps/web`'s build is intentionally decoupled
from how `apps/server` is hosted).

The live instance above runs the exact same setup: `apps/server` on Fly.io
via `fly.toml` (chosen specifically because Render's free tier has no
persistent disk — `apps/server` needs a real volume for the SQLite file,
which Fly's free allowance includes), `apps/web` on Vercel via the root
`vercel.json` (deployed from the repo root, not `apps/web` alone, since the
build needs the pnpm workspace context to resolve `@tandem/doc-schema`).

## Mobile

`apps/web` is an installable PWA out of the box (manifest + a native
SvelteKit service worker that precaches the app shell for offline boot —
see `apps/web/src/service-worker.ts` for why reads/writes never go through
it: offline-first here is a data-architecture property, not a caching
trick). A [Capacitor](https://capacitorjs.com) wrapper for a real iOS/Android
build from the same codebase is the next step (see "What's not done yet").

## Testing

The correctness claim is tested in layers:

1. **`packages/doc-schema`** — pure Yjs convergence tests: concurrent edits,
   out-of-order delivery, duplicate updates, and a randomized fuzz test (N
   simulated devices, random operations, assert byte-identical merge).
   No Docker or network needed.
2. **`apps/server`** — integration tests against the *real* WS relay +
   SQLite, including a server-restart test proving persisted data survives
   and a fresh device can join and get full history without the original
   device being online.
3. Manually verified end-to-end in a real browser across two separate
   origins (simulating two real devices): create a household, add items,
   invite a second device via the real link, and watch a change made on
   one propagate live to the other with zero reload.

```bash
pnpm --filter @tandem/doc-schema test
pnpm --filter @tandem/server test
pnpm --filter @tandem/web check
```

## What's not done yet

- Capacitor wrapper (architecture supports it — same static build, same
  IndexedDB/WebSocket APIs work unmodified in a WebView — just not wired
  up yet).
- Actual App Store / Play Store submission (needs the maintainer's own
  developer accounts).
- Rich item metadata (quantity, category, notes), list templates, push
  notifications, drag-and-drop reordering UI (the underlying fractional-index
  data model already supports it).
- `y-webrtc` as an additional peer-to-peer transport, wire-format
  encryption of relayed updates (the protocol is designed to support this
  later without a breaking change).

## License

MIT
