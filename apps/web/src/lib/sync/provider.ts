import { IndexeddbPersistence } from "y-indexeddb";
import { WebrtcProvider } from "y-webrtc";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

export interface HouseholdSync {
  doc: Y.Doc;
  wsProvider: WebsocketProvider;
  webrtcProvider: WebrtcProvider;
  destroy(): void;
}

const SYNC_SERVER_URL = import.meta.env.VITE_SYNC_SERVER_URL ?? "ws://localhost:1234";
// Same host as the WS relay, not a separate config value -- the signaling
// endpoint lives on apps/server itself (see signaling.ts), so wherever
// VITE_SYNC_SERVER_URL points, /signaling is already there too.
const SIGNALING_URL = `${SYNC_SERVER_URL}/signaling`;

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

  // Second, additive sync transport: when two devices can reach each other
  // directly (same wifi/hotspot, or NAT traversal succeeds), updates flow
  // peer-to-peer with no dependency on the relay server staying up at all
  // -- also falls back to the browser's BroadcastChannel for free, so two
  // tabs of the same browser sync instantly with zero network. Shares the
  // WS provider's Awareness instance rather than letting y-webrtc create
  // its own disconnected one, so presence (presence-store.ts) reflects
  // peers connected via *either* transport as one unified list.
  const webrtcProvider = new WebrtcProvider(roomId, doc, {
    signaling: [SIGNALING_URL],
    awareness: wsProvider.awareness,
  });

  return {
    doc,
    wsProvider,
    webrtcProvider,
    destroy() {
      webrtcProvider.destroy();
      wsProvider.destroy();
      indexeddbProvider.destroy();
      doc.destroy();
    },
  };
}
