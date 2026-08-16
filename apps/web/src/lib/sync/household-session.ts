import * as schema from "@tandem/doc-schema";
import type { HouseholdSnapshot } from "@tandem/doc-schema";
import { connectHousehold } from "./provider.js";
import { householdStore, type Readable } from "./household-store.js";

export interface HouseholdSession {
  roomId: string;
  household: Readable<HouseholdSnapshot>;
  createList(name: string): string;
  renameList(listId: string, name: string): void;
  archiveList(listId: string): void;
  addItem(listId: string, text: string): string;
  setItemText(listId: string, itemId: string, text: string): void;
  setItemChecked(listId: string, itemId: string, checked: boolean): void;
  archiveItem(listId: string, itemId: string): void;
  unarchiveItem(listId: string, itemId: string): void;
  destroy(): void;
}

function wrapSession(roomId: string, sync: Awaited<ReturnType<typeof connectHousehold>>, deviceLabel: string): HouseholdSession {
  return {
    roomId,
    household: householdStore(sync.doc),
    createList: (name) => schema.createList(sync.doc, name, deviceLabel),
    renameList: (listId, name) => schema.renameList(sync.doc, listId, name),
    archiveList: (listId) => schema.archiveList(sync.doc, listId),
    addItem: (listId, text) => schema.addItem(sync.doc, listId, text, deviceLabel),
    setItemText: (listId, itemId, text) => schema.setItemText(sync.doc, listId, itemId, text),
    setItemChecked: (listId, itemId, checked) =>
      schema.setItemChecked(sync.doc, listId, itemId, checked),
    archiveItem: (listId, itemId) => schema.archiveItem(sync.doc, listId, itemId),
    unarchiveItem: (listId, itemId) => schema.unarchiveItem(sync.doc, listId, itemId),
    destroy: () => sync.destroy(),
  };
}

// Only safe to call for a room that is *certain* to be brand new (e.g. one
// just minted by the server's POST /api/rooms). Never call this for a join
// flow: on a genuinely new Y.Doc it's a no-op-then-set, but if a household
// already exists elsewhere and simply hasn't synced to this device yet, an
// unconditional write here would race the real, already-established meta
// (see initializeHouseholdMeta's docs in doc-schema).
export async function createHouseholdSession(
  roomId: string,
  name: string,
  deviceLabel: string,
): Promise<HouseholdSession> {
  const sync = await connectHousehold(roomId);
  schema.initializeHouseholdMeta(sync.doc, name);
  return wrapSession(roomId, sync, deviceLabel);
}

// For joining an existing household via an invite link/short code. Never
// initializes meta -- the real data arrives via IndexedDB (if previously
// joined) or the sync server (must be online at least once to receive it).
export async function joinHouseholdSession(
  roomId: string,
  deviceLabel: string,
): Promise<HouseholdSession> {
  const sync = await connectHousehold(roomId);
  return wrapSession(roomId, sync, deviceLabel);
}
