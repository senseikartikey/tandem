import type { Awareness } from "y-protocols/awareness.js";
import type { Readable } from "./household-store.js";

export interface PresenceEntry {
  clientId: number;
  name: string;
  color: string;
  lastTouch: { itemId: string; ts: number } | null;
}

interface AwarenessUserState {
  user?: { name: string; color: string };
  lastTouch?: { itemId: string; ts: number };
}

// Awareness is Yjs's ephemeral-state protocol -- a separate mechanism from
// the document CRDT, purpose-built for "who's here and what are they doing
// right now." Entries vanish on their own (via awareness's built-in
// timeout) when a peer disconnects, which is exactly the semantics presence
// needs and the document CRDT deliberately doesn't have (nothing in a
// Y.Doc is supposed to just disappear when someone goes offline).
export function presenceStore(awareness: Awareness): Readable<PresenceEntry[]> {
  return {
    subscribe(run: (value: PresenceEntry[]) => void) {
      const update = () => {
        const entries: PresenceEntry[] = [];
        awareness.getStates().forEach((state, clientId) => {
          if (clientId === awareness.clientID) return; // never show yourself
          const { user, lastTouch } = state as AwarenessUserState;
          if (!user) return;
          entries.push({ clientId, name: user.name, color: user.color, lastTouch: lastTouch ?? null });
        });
        run(entries);
      };
      update();
      awareness.on("change", update);
      return () => awareness.off("change", update);
    },
  };
}
