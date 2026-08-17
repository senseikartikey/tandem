// A household's sync session (Y.Doc + IndexedDB + WebSocket provider) is
// long-lived for the app's lifetime, not scoped to a single route visit --
// navigating from the household view to a list view and back should reuse
// the same connection, not reconnect. Keyed by roomId so multiple
// households can be open in memory at once without cross-talk.
import { joinHouseholdSession, type HouseholdSession } from "./household-session.js";

const cache = new Map<string, Promise<HouseholdSession>>();

export function getOrJoinSession(roomId: string): Promise<HouseholdSession> {
  let existing = cache.get(roomId);
  if (!existing) {
    existing = joinHouseholdSession(roomId);
    cache.set(roomId, existing);
  }
  return existing;
}

export function cacheSession(roomId: string, session: HouseholdSession): void {
  cache.set(roomId, Promise.resolve(session));
}
