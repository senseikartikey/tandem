import type { WebsocketProvider } from "y-websocket";
import type { Readable } from "./household-store.js";

// "connected" -- the relay is live, so other devices see your edits as you
// make them. "connecting" -- reachable network, no relay yet (the public
// instance runs on a free tier that sleeps after ~15 minutes idle and takes
// most of a minute to wake, so this state is normal and self-resolving, not
// an error). "offline" -- no network at all; edits are still saved locally
// and will sync when there is one.
export type SyncStatus = "connected" | "connecting" | "offline";

// Every write in this app is local-first and never blocks on the network,
// which is exactly why this indicator has to exist: with nothing on screen
// saying whether the relay is attached, "my note isn't showing up on the
// other phone" and "the sync server is still waking up" look identical to
// the person using it.
export function syncStatusStore(provider: WebsocketProvider): Readable<SyncStatus> {
	return {
		subscribe(run: (value: SyncStatus) => void) {
			const compute = (): SyncStatus => {
				if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
				return provider.wsconnected ? "connected" : "connecting";
			};
			const update = () => run(compute());
			update();
			provider.on("status", update);
			// y-websocket only emits "status" on its own socket transitions, so
			// losing the network entirely (which fires no socket event until a
			// retry) would otherwise sit on a stale "connected".
			window.addEventListener("online", update);
			window.addEventListener("offline", update);
			return () => {
				provider.off("status", update);
				window.removeEventListener("online", update);
				window.removeEventListener("offline", update);
			};
		},
	};
}
