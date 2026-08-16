import { IndexeddbPersistence } from "y-indexeddb";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

export interface HouseholdSync {
  doc: Y.Doc;
  wsProvider: WebsocketProvider;
  destroy(): void;
}

const SYNC_SERVER_URL = import.meta.env.VITE_SYNC_SERVER_URL ?? "ws://localhost:1234";

export async function connectHousehold(roomId: string): Promise<HouseholdSync> {
  const doc = new Y.Doc();

  // Local persistence first -- this is what makes offline read/write work
  // at all. It loads any previously-synced state from IndexedDB immediately,
  // before the network provider even attempts to connect, and every mutation
  // made from here on is written straight to it regardless of network state.
  const indexeddbProvider = new IndexeddbPersistence(roomId, doc);
  await indexeddbProvider.whenSynced;

  // An evicted IndexedDB store would silently defeat the entire offline-
  // first design -- ask the browser to exempt this origin from storage
  // pressure eviction. Best-effort: not all browsers grant it, and none of
  // this app's correctness depends on the grant succeeding.
  if (typeof navigator !== "undefined" && navigator.storage?.persist) {
    void navigator.storage.persist();
  }

  // Background reconciliation only -- reconnects and replays opportunistically.
  // Never on the critical path for a read or a write.
  const wsProvider = new WebsocketProvider(SYNC_SERVER_URL, roomId, doc);

  return {
    doc,
    wsProvider,
    destroy() {
      wsProvider.destroy();
      indexeddbProvider.destroy();
      doc.destroy();
    },
  };
}
