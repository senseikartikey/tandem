import * as schema from "@tandem/doc-schema";
import { getDeviceLabel } from "$lib/local-households";
import { connectHousehold } from "./provider.js";
import { householdStore, type HouseholdStoreValue, type Readable } from "./household-store.js";

export interface HouseholdSession {
  roomId: string;
  household: Readable<HouseholdStoreValue>;
  createList(name: string): string;
  renameList(listId: string, name: string): void;
  archiveList(listId: string): void;
  unarchiveList(listId: string): void;
  addItem(listId: string, text: string): string;
  setItemText(listId: string, itemId: string, text: string): void;
  setItemChecked(listId: string, itemId: string, checked: boolean): void;
  archiveItem(listId: string, itemId: string): void;
  unarchiveItem(listId: string, itemId: string): void;
  destroy(): void;
}

// deviceLabel is read fresh on every call, not captured once at session
// open -- otherwise renaming yourself mid-session (see YourName.svelte)
// wouldn't take effect until a full page reload re-created the session.
function wrapSession(roomId: string, sync: Awaited<ReturnType<typeof connectHousehold>>): HouseholdSession {
  return {
    roomId,
    household: householdStore(sync.doc),
    createList: (name) => schema.createList(sync.doc, name, getDeviceLabel()),
    renameList: (listId, name) => schema.renameList(sync.doc, listId, name, getDeviceLabel()),
    archiveList: (listId) => schema.archiveList(sync.doc, listId, getDeviceLabel()),
    unarchiveList: (listId) => schema.unarchiveList(sync.doc, listId, getDeviceLabel()),
    addItem: (listId, text) => schema.addItem(sync.doc, listId, text, getDeviceLabel()),
    setItemText: (listId, itemId, text) =>
      schema.setItemText(sync.doc, listId, itemId, text, getDeviceLabel()),
    setItemChecked: (listId, itemId, checked) =>
      schema.setItemChecked(sync.doc, listId, itemId, checked, getDeviceLabel()),
    archiveItem: (listId, itemId) => schema.archiveItem(sync.doc, listId, itemId, getDeviceLabel()),
    unarchiveItem: (listId, itemId) => schema.unarchiveItem(sync.doc, listId, itemId, getDeviceLabel()),
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
