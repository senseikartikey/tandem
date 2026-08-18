import * as schema from "@tandem/doc-schema";
import { getDeviceLabel } from "$lib/local-households";
import { connectHousehold } from "./provider.js";
import { householdStore, type HouseholdStoreValue, type Readable } from "./household-store.js";
import { presenceStore, type PresenceEntry } from "./presence-store.js";

export interface HouseholdSession {
  roomId: string;
  household: Readable<HouseholdStoreValue>;
  presence: Readable<PresenceEntry[]>;
  createList(name: string): string;
  renameList(listId: string, name: string): void;
  archiveList(listId: string): void;
  unarchiveList(listId: string): void;
  forkList(sourceListId: string, name: string): string;
  mergeFork(forkListId: string): { mergedCount: number };
  addItem(listId: string, text: string): string;
  setItemText(listId: string, itemId: string, text: string): void;
  setItemChecked(listId: string, itemId: string, checked: boolean): void;
  archiveItem(listId: string, itemId: string): void;
  unarchiveItem(listId: string, itemId: string): void;
  destroy(): void;
}

// Named tokens from app.css, referenced by CSS variable rather than a
// hardcoded hex copy so presence avatars automatically stay in sync with
// the design system if these ever change.
const PRESENCE_COLORS = [
  "var(--color-primary)",
  "var(--color-secondary)",
  "var(--color-teal)",
  "var(--color-pink)",
  "var(--color-yellow)",
];

// Deterministic, not random -- the same device should show the same color
// on every reconnect, not a new one each time.
function colorForLabel(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0;
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
}

// deviceLabel is read fresh on every call, not captured once at session
// open -- otherwise renaming yourself mid-session (see YourName.svelte)
// wouldn't take effect until a full page reload re-created the session.
function wrapSession(roomId: string, sync: Awaited<ReturnType<typeof connectHousehold>>): HouseholdSession {
  const awareness = sync.wsProvider.awareness;
  const deviceLabel = getDeviceLabel();
  // Set once per session, not re-read like the CRDT mutations below -- a
  // mid-session rename updating presence live would mean re-broadcasting
  // awareness on every household-store tick, which isn't worth it for a
  // cosmetic label on an already-ephemeral channel. Next reload picks up
  // a changed name, same as the acceptable gap already documented for
  // wrapSession itself.
  awareness.setLocalStateField("user", { name: deviceLabel, color: colorForLabel(deviceLabel) });

  // Awareness is Yjs's *other* protocol, deliberately separate from the
  // document CRDT -- "what did someone just touch" is throwaway signal,
  // not data to persist or merge. Piggybacking this on the doc would mean
  // either keeping it forever or inventing a parallel cleanup mechanism
  // Yjs's awareness timeout already provides for free.
  function pingTouch(itemId: string): void {
    awareness.setLocalStateField("lastTouch", { itemId, ts: Date.now() });
  }

  return {
    roomId,
    household: householdStore(sync.doc),
    presence: presenceStore(awareness),
    createList: (name) => schema.createList(sync.doc, name, getDeviceLabel()),
    renameList: (listId, name) => schema.renameList(sync.doc, listId, name, getDeviceLabel()),
    archiveList: (listId) => schema.archiveList(sync.doc, listId, getDeviceLabel()),
    unarchiveList: (listId) => schema.unarchiveList(sync.doc, listId, getDeviceLabel()),
    forkList: (sourceListId, name) => schema.forkList(sync.doc, sourceListId, name, getDeviceLabel()),
    mergeFork: (forkListId) => schema.mergeFork(sync.doc, forkListId, getDeviceLabel()),
    addItem: (listId, text) => {
      const id = schema.addItem(sync.doc, listId, text, getDeviceLabel());
      pingTouch(id);
      return id;
    },
    setItemText: (listId, itemId, text) => {
      schema.setItemText(sync.doc, listId, itemId, text, getDeviceLabel());
      pingTouch(itemId);
    },
    setItemChecked: (listId, itemId, checked) => {
      schema.setItemChecked(sync.doc, listId, itemId, checked, getDeviceLabel());
      pingTouch(itemId);
    },
    archiveItem: (listId, itemId) => {
      schema.archiveItem(sync.doc, listId, itemId, getDeviceLabel());
      pingTouch(itemId);
    },
    unarchiveItem: (listId, itemId) => {
      schema.unarchiveItem(sync.doc, listId, itemId, getDeviceLabel());
      pingTouch(itemId);
    },
    destroy: () => sync.destroy(),
  };
}

// Only safe to call for a room that is *certain* to be brand new (e.g. one
// just minted by the server's POST /api/rooms). Never call this for a join
// flow: on a genuinely new Y.Doc it's a no-op-then-set, but if a household
// already exists elsewhere and simply hasn't synced to this device yet, an
// unconditional write here would race the real, already-established meta
// (see initializeHouseholdMeta's docs in doc-schema).
export async function createHouseholdSession(roomId: string, name: string): Promise<HouseholdSession> {
  const sync = await connectHousehold(roomId);
  schema.initializeHouseholdMeta(sync.doc, name);
  return wrapSession(roomId, sync);
}

// For joining an existing household via an invite link/short code. Never
// initializes meta -- the real data arrives via IndexedDB (if previously
// joined) or the sync server (must be online at least once to receive it).
export async function joinHouseholdSession(roomId: string): Promise<HouseholdSession> {
  const sync = await connectHousehold(roomId);
  return wrapSession(roomId, sync);
}
