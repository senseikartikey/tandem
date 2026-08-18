import { generateKeyBetween } from "fractional-indexing";
import { v4 as uuidv4 } from "uuid";
import * as Y from "yjs";

// Lists and items are keyed by UUID in a Y.Map, not stored in a Y.Array.
// Y.Array has no native "move" op -- reordering is delete+insert, which loses
// YATA position provenance and produces surprising results when two peers
// move the same element concurrently. Keying by UUID makes insert/update/
// delete of any single list or item an independent, position-free operation;
// ordering is a separate fractional-index string any peer can rewrite in
// O(1) without touching siblings. The activity log below reuses the same
// uuid-keyed-map vocabulary rather than a Y.Array for the same reason: it
// needs no positional semantics (it's append-only), and a second CRDT
// collection type would be a second, unproven merge-semantics surface.
const META_KEY = "meta";
const LISTS_KEY = "lists";
const ITEMS_KEY = "items";
const ACTIVITY_KEY = "activity";

export interface ListSnapshot {
  id: string;
  name: string;
  order: string;
  archived: boolean;
  deletedAt: number | null;
  createdBy: string;
  createdAt: number;
  // Non-null only for lists created by forkList(). A fork is a genuinely
  // independent list from the moment it's created -- these are just
  // lineage bookkeeping (who it came from, and when), not a live link of
  // any kind.
  forkedFromListId: string | null;
  forkedAt: number | null;
  items: ItemSnapshot[];
}

export interface ItemSnapshot {
  id: string;
  text: string;
  // Read-only string snapshot of the live Y.Text below -- for display/list
  // rendering only. Editing must go through getItemNoteText()'s actual
  // Y.Text handle, never by writing this field back (there's no setter on
  // purpose: a plain string field can only ever be last-write-wins, which
  // throws away the whole point of a note two people can type into at once).
  note: string;
  checked: boolean;
  checkedBy: string | null;
  // True only for items forkList() copied in from the source at fork time.
  // mergeFork() uses this (not addedAt vs. forkedAt) to find "new since the
  // fork" items -- Date.now() is only millisecond-resolution, and a fork
  // followed immediately by an add can land in the same millisecond, so a
  // timestamp comparison is the wrong tool for an exact-membership check.
  copiedInFork: boolean;
  order: string;
  archived: boolean;
  deletedAt: number | null;
  addedBy: string;
  addedAt: number;
  updatedAt: number;
}

export interface HouseholdSnapshot {
  id: string;
  name: string;
  createdAt: number;
  lists: ListSnapshot[];
}

export type ActivityType =
  | "list.created"
  | "list.renamed"
  | "list.archived"
  | "list.unarchived"
  | "item.added"
  | "item.edited"
  | "item.checked"
  | "item.unchecked"
  | "item.archived"
  | "item.unarchived";

// Fields are snapshotted at write time, not live references -- an entry must
// stay a faithful, renderable historical fact even if the list/item it
// describes is edited again (or restored differently) afterward.
export interface ActivitySnapshot {
  id: string;
  type: ActivityType;
  actorLabel: string;
  timestamp: number;
  listId: string;
  listName: string;
  itemId: string | null;
  itemText: string | null;
  previousText: string | null;
}

type YRecord = Y.Map<unknown>;

export function createHouseholdDoc(name: string): Y.Doc {
  const doc = new Y.Doc();
  initializeHouseholdMeta(doc, name);
  return doc;
}

// Idempotent: only sets meta fields if they aren't already present. Needed
// by the web app, which can't tell in advance whether a freshly-connected
// Y.Doc for a given room is brand new (create-household flow) or about to
// be populated by a load from IndexedDB/the sync server (join flow) -- both
// paths call this, and only the genuinely-new-room case actually writes.
export function initializeHouseholdMeta(doc: Y.Doc, name: string): void {
  const meta = doc.getMap(META_KEY);
  if (meta.get("id")) return;
  doc.transact(() => {
    meta.set("id", uuidv4());
    meta.set("name", name);
    meta.set("createdAt", Date.now());
  });
  doc.getMap(LISTS_KEY);
  doc.getMap(ACTIVITY_KEY);
}

function getListsMap(doc: Y.Doc): Y.Map<YRecord> {
  return doc.getMap(LISTS_KEY) as Y.Map<YRecord>;
}

function getListRecord(doc: Y.Doc, listId: string): YRecord {
  const list = getListsMap(doc).get(listId);
  if (!list) throw new Error(`List ${listId} not found`);
  return list;
}

function getItemsMap(doc: Y.Doc, listId: string): Y.Map<YRecord> {
  return getListRecord(doc, listId).get(ITEMS_KEY) as Y.Map<YRecord>;
}

function getItemRecord(doc: Y.Doc, listId: string, itemId: string): YRecord {
  const item = getItemsMap(doc, listId).get(itemId);
  if (!item) throw new Error(`Item ${itemId} not found in list ${listId}`);
  return item;
}

function getActivityMap(doc: Y.Doc): Y.Map<YRecord> {
  return doc.getMap(ACTIVITY_KEY) as Y.Map<YRecord>;
}

function sortedByOrder(map: Y.Map<YRecord>): YRecord[] {
  return Array.from(map.values()).sort((a, b) => {
    const oa = a.get("order") as string;
    const ob = b.get("order") as string;
    return oa < ob ? -1 : oa > ob ? 1 : 0;
  });
}

function sortedByTimestampDesc(map: Y.Map<YRecord>): YRecord[] {
  return Array.from(map.values()).sort((a, b) => {
    return (b.get("timestamp") as number) - (a.get("timestamp") as number);
  });
}

function nextOrderKey(map: Y.Map<YRecord>): string {
  const sorted = sortedByOrder(map);
  const last = sorted.length > 0 ? (sorted[sorted.length - 1].get("order") as string) : null;
  return generateKeyBetween(last, null);
}

function orderKeyOf(map: Y.Map<YRecord>, id: string | null): string | null {
  if (id === null) return null;
  const record = map.get(id);
  return record ? (record.get("order") as string) : null;
}

// Must be called from *inside* the same doc.transact() as the field mutation
// it documents, so the state change and its audit entry are one atomic
// update -- never a separate transaction, which would let the two drift
// apart under offline queuing/replay.
function appendActivity(doc: Y.Doc, entry: Omit<ActivitySnapshot, "id" | "timestamp">): void {
  const id = uuidv4();
  const record: Y.Map<unknown> = new Y.Map();
  record.set("id", id);
  record.set("type", entry.type);
  record.set("actorLabel", entry.actorLabel);
  record.set("timestamp", Date.now());
  record.set("listId", entry.listId);
  record.set("listName", entry.listName);
  record.set("itemId", entry.itemId);
  record.set("itemText", entry.itemText);
  record.set("previousText", entry.previousText);
  getActivityMap(doc).set(id, record);
}

// --- Lists ---

export function createList(doc: Y.Doc, name: string, createdBy: string): string {
  const id = uuidv4();
  const listsMap = getListsMap(doc);
  doc.transact(() => {
    const list: Y.Map<unknown> = new Y.Map();
    const now = Date.now();
    list.set("id", id);
    list.set("name", name);
    list.set("order", nextOrderKey(listsMap));
    list.set("archived", false);
    list.set("deletedAt", null);
    list.set("createdBy", createdBy);
    list.set("createdAt", now);
    list.set("forkedFromListId", null);
    list.set("forkedAt", null);
    list.set(ITEMS_KEY, new Y.Map());
    listsMap.set(id, list);
    appendActivity(doc, {
      type: "list.created",
      actorLabel: createdBy,
      listId: id,
      listName: name,
      itemId: null,
      itemText: null,
      previousText: null,
    });
  });
  return id;
}

// A fork is a snapshot, not a live link: it copies every current
// (non-archived) item's text and checked state into a brand-new,
// completely independent list. From this instant the two lists evolve
// separately -- nothing done in one is ever reflected in the other except
// through an explicit mergeFork() call. This is the "try a version without
// touching the real list" primitive: draft freely, then either bring the
// new items back with mergeFork() or throw the whole fork away with
// archiveList(), and the source list was never at risk either way.
export function forkList(doc: Y.Doc, sourceListId: string, name: string, actorLabel: string): string {
  const sourceList = getListRecord(doc, sourceListId);
  const sourceListName = sourceList.get("name") as string;
  const sourceItemsMap = sourceList.get(ITEMS_KEY) as Y.Map<YRecord>;
  const sourceItems = sortedByOrder(sourceItemsMap).filter((r) => !(r.get("archived") as boolean));

  const id = uuidv4();
  const listsMap = getListsMap(doc);
  const now = Date.now();

  doc.transact(() => {
    const list: Y.Map<unknown> = new Y.Map();
    list.set("id", id);
    list.set("name", name);
    list.set("order", nextOrderKey(listsMap));
    list.set("archived", false);
    list.set("deletedAt", null);
    list.set("createdBy", actorLabel);
    list.set("createdAt", now);
    list.set("forkedFromListId", sourceListId);
    list.set("forkedAt", now);
    const itemsMap: Y.Map<unknown> = new Y.Map();
    list.set(ITEMS_KEY, itemsMap);
    listsMap.set(id, list);

    for (const source of sourceItems) {
      const itemId = uuidv4();
      const item: Y.Map<unknown> = new Y.Map();
      const sourceNote = source.get("note");
      item.set("id", itemId);
      item.set("text", source.get("text") as string);
      // A new Y.Text with the same content, not the source's actual
      // instance -- a shared type belongs to exactly one place in the doc
      // tree; reusing it here would silently move it out of the source
      // item rather than copy it. Matches every other field's copy-not-link
      // semantics (see this function's module comment).
      item.set("note", new Y.Text(sourceNote instanceof Y.Text ? sourceNote.toString() : ""));
      // Checked state carries over -- a fork is a snapshot of the list as
      // it stood, not a fresh blank copy.
      item.set("checked", source.get("checked") as boolean);
      item.set("checkedBy", source.get("checkedBy") as string | null);
      item.set("copiedInFork", true);
      item.set("order", nextOrderKey(itemsMap as Y.Map<YRecord>));
      item.set("archived", false);
      item.set("deletedAt", null);
      // addedBy/addedAt are reset to the fork and the person forking, not
      // preserved from the source -- purely provenance now that mergeFork()
      // uses copiedInFork (not a timestamp comparison) to find new items.
      item.set("addedBy", actorLabel);
      item.set("addedAt", now);
      item.set("updatedAt", now);
      itemsMap.set(itemId, item);
    }

    appendActivity(doc, {
      type: "list.created",
      actorLabel,
      listId: id,
      listName: name,
      itemId: null,
      itemText: null,
      previousText: sourceListName,
    });
  });

  return id;
}

// Brings every item added to a fork *after* it was created back into the
// source list as ordinary new items, then archives the fork -- merging
// concludes it the same way discarding would, just with its new items kept.
// Deliberately simple for v1: only new additions merge, not edits/checks
// made to the copied-over items or removals -- an unambiguous "what's new"
// diff, not a general three-way merge UI this app doesn't need.
export function mergeFork(doc: Y.Doc, forkListId: string, actorLabel: string): { mergedCount: number } {
  const forkRecord = getListRecord(doc, forkListId);
  const sourceListId = forkRecord.get("forkedFromListId") as string | null;
  if (!sourceListId) throw new Error(`List ${forkListId} is not a fork`);
  const forkItemsMap = forkRecord.get(ITEMS_KEY) as Y.Map<YRecord>;
  const newItems = sortedByOrder(forkItemsMap).filter(
    (r) => !(r.get("archived") as boolean) && !(r.get("copiedInFork") as boolean | undefined),
  );

  doc.transact(() => {
    for (const item of newItems) {
      addItem(doc, sourceListId, item.get("text") as string, actorLabel);
    }
    archiveList(doc, forkListId, actorLabel);
  });

  return { mergedCount: newItems.length };
}

export function renameList(doc: Y.Doc, listId: string, name: string, actorLabel: string): void {
  const list = getListRecord(doc, listId);
  const previousName = list.get("name") as string;
  doc.transact(() => {
    list.set("name", name);
    appendActivity(doc, {
      type: "list.renamed",
      actorLabel,
      listId,
      listName: name,
      itemId: null,
      itemText: null,
      previousText: previousName,
    });
  });
}

// Soft delete only -- never Map.delete. A structural removal racing with a
// concurrent edit to the same subtree is a genuinely nasty CRDT edge case
// (Yjs generally does not resurrect edits made under a concurrently-deleted
// parent). An archived flag turns that into a plain last-write-wins field
// race: safe, reversible, and consistent with how mature local-first apps
// (Linear, tldraw) prefer tombstones over structural deletes.
export function archiveList(doc: Y.Doc, listId: string, actorLabel: string): void {
  const list = getListRecord(doc, listId);
  const listName = list.get("name") as string;
  doc.transact(() => {
    list.set("archived", true);
    list.set("deletedAt", Date.now());
    appendActivity(doc, {
      type: "list.archived",
      actorLabel,
      listId,
      listName,
      itemId: null,
      itemText: null,
      previousText: null,
    });
  });
}

export function unarchiveList(doc: Y.Doc, listId: string, actorLabel: string): void {
  const list = getListRecord(doc, listId);
  const listName = list.get("name") as string;
  doc.transact(() => {
    list.set("archived", false);
    list.set("deletedAt", null);
    appendActivity(doc, {
      type: "list.unarchived",
      actorLabel,
      listId,
      listName,
      itemId: null,
      itemText: null,
      previousText: null,
    });
  });
}

export function reorderList(
  doc: Y.Doc,
  listId: string,
  beforeListId: string | null,
  afterListId: string | null,
  // Accepted for interface consistency with every other mutation, not used:
  // dragging to a new position isn't an attribution-worthy event and would
  // just bury the activity feed's actually-interesting entries.
  _actorLabel: string,
): void {
  const listsMap = getListsMap(doc);
  const list = getListRecord(doc, listId);
  const before = orderKeyOf(listsMap, beforeListId);
  const after = orderKeyOf(listsMap, afterListId);
  doc.transact(() => {
    list.set("order", generateKeyBetween(before, after));
  });
}

// --- Items ---

export function addItem(doc: Y.Doc, listId: string, text: string, addedBy: string): string {
  const id = uuidv4();
  const itemsMap = getItemsMap(doc, listId);
  const listName = getListRecord(doc, listId).get("name") as string;
  doc.transact(() => {
    const item: Y.Map<unknown> = new Y.Map();
    const now = Date.now();
    item.set("id", id);
    item.set("text", text);
    item.set("note", new Y.Text());
    item.set("checked", false);
    item.set("checkedBy", null);
    item.set("copiedInFork", false);
    item.set("order", nextOrderKey(itemsMap));
    item.set("archived", false);
    item.set("deletedAt", null);
    item.set("addedBy", addedBy);
    item.set("addedAt", now);
    item.set("updatedAt", now);
    itemsMap.set(id, item);
    appendActivity(doc, {
      type: "item.added",
      actorLabel: addedBy,
      listId,
      listName,
      itemId: id,
      itemText: text,
      previousText: null,
    });
  });
  return id;
}

export function setItemText(
  doc: Y.Doc,
  listId: string,
  itemId: string,
  text: string,
  actorLabel: string,
): void {
  const item = getItemRecord(doc, listId, itemId);
  const listName = getListRecord(doc, listId).get("name") as string;
  const previousText = item.get("text") as string;
  doc.transact(() => {
    item.set("text", text);
    item.set("updatedAt", Date.now());
    appendActivity(doc, {
      type: "item.edited",
      actorLabel,
      listId,
      listName,
      itemId,
      itemText: text,
      previousText,
    });
  });
}

export function setItemChecked(
  doc: Y.Doc,
  listId: string,
  itemId: string,
  checked: boolean,
  actorLabel: string,
): void {
  const item = getItemRecord(doc, listId, itemId);
  const listName = getListRecord(doc, listId).get("name") as string;
  const itemText = item.get("text") as string;
  doc.transact(() => {
    item.set("checked", checked);
    item.set("checkedBy", checked ? actorLabel : null);
    item.set("updatedAt", Date.now());
    appendActivity(doc, {
      type: checked ? "item.checked" : "item.unchecked",
      actorLabel,
      listId,
      listName,
      itemId,
      itemText,
      previousText: null,
    });
  });
}

export function archiveItem(doc: Y.Doc, listId: string, itemId: string, actorLabel: string): void {
  const item = getItemRecord(doc, listId, itemId);
  const listName = getListRecord(doc, listId).get("name") as string;
  const itemText = item.get("text") as string;
  doc.transact(() => {
    item.set("archived", true);
    item.set("deletedAt", Date.now());
    appendActivity(doc, {
      type: "item.archived",
      actorLabel,
      listId,
      listName,
      itemId,
      itemText,
      previousText: null,
    });
  });
}

export function unarchiveItem(doc: Y.Doc, listId: string, itemId: string, actorLabel: string): void {
  const item = getItemRecord(doc, listId, itemId);
  const listName = getListRecord(doc, listId).get("name") as string;
  const itemText = item.get("text") as string;
  doc.transact(() => {
    item.set("archived", false);
    item.set("deletedAt", null);
    appendActivity(doc, {
      type: "item.unarchived",
      actorLabel,
      listId,
      listName,
      itemId,
      itemText,
      previousText: null,
    });
  });
}

// Returns the item's live, shared Y.Text for a caller to bind an editor to
// directly -- deliberately not wrapped in a setter like every other item
// field, because a note is meant to be typed into collaboratively, and
// Y.Text's own insert/delete API *is* the merge-correct way to do that; a
// setNoteText(doc, ..., fullString) function would only be able to replace
// the whole field, which is exactly the last-write-wins behavior this
// feature exists to avoid. No activity entry or updatedAt bump here either,
// same reasoning reorderItem documents: live keystrokes aren't a discrete,
// attribution-worthy event, and touching updatedAt on every keystroke would
// make "recently changed" sort thrash while someone is mid-sentence.
//
// Falls back to lazily creating the field for items added before this
// feature existed (addItem now always sets one). Two peers racing this
// backfill on the same never-before-noted item is a real but harmless
// edge case: Y.Map.set is last-write-wins on the "note" key, so the
// loser's freshly-created Y.Text is simply discarded -- both started
// empty, so nothing is lost. Re-reading after the transaction (rather
// than returning the local reference created above) guarantees the
// caller always binds to whichever instance actually won.
export function getItemNoteText(doc: Y.Doc, listId: string, itemId: string): Y.Text {
  const item = getItemRecord(doc, listId, itemId);
  const existing = item.get("note");
  if (existing instanceof Y.Text) return existing;
  doc.transact(() => {
    if (!(item.get("note") instanceof Y.Text)) item.set("note", new Y.Text());
  });
  return item.get("note") as Y.Text;
}

export function reorderItem(
  doc: Y.Doc,
  listId: string,
  itemId: string,
  beforeItemId: string | null,
  afterItemId: string | null,
  // See reorderList's note -- accepted for consistency, no activity emitted.
  _actorLabel: string,
): void {
  const itemsMap = getItemsMap(doc, listId);
  const item = getItemRecord(doc, listId, itemId);
  const before = orderKeyOf(itemsMap, beforeItemId);
  const after = orderKeyOf(itemsMap, afterItemId);
  doc.transact(() => {
    item.set("order", generateKeyBetween(before, after));
    item.set("updatedAt", Date.now());
  });
}

// --- Reads ---

function readItem(record: YRecord): ItemSnapshot {
  const noteField = record.get("note");
  return {
    id: record.get("id") as string,
    text: record.get("text") as string,
    note: noteField instanceof Y.Text ? noteField.toString() : "",
    checked: record.get("checked") as boolean,
    checkedBy: (record.get("checkedBy") as string | null) ?? null,
    copiedInFork: (record.get("copiedInFork") as boolean | undefined) ?? false,
    order: record.get("order") as string,
    archived: record.get("archived") as boolean,
    deletedAt: record.get("deletedAt") as number | null,
    addedBy: record.get("addedBy") as string,
    addedAt: record.get("addedAt") as number,
    updatedAt: record.get("updatedAt") as number,
  };
}

function readList(record: YRecord): ListSnapshot {
  const itemsMap = record.get(ITEMS_KEY) as Y.Map<YRecord>;
  return {
    id: record.get("id") as string,
    name: record.get("name") as string,
    order: record.get("order") as string,
    archived: record.get("archived") as boolean,
    deletedAt: (record.get("deletedAt") as number | null) ?? null,
    createdBy: record.get("createdBy") as string,
    createdAt: record.get("createdAt") as number,
    forkedFromListId: (record.get("forkedFromListId") as string | null) ?? null,
    forkedAt: (record.get("forkedAt") as number | null) ?? null,
    items: sortedByOrder(itemsMap).map(readItem),
  };
}

function readActivityRecord(record: YRecord): ActivitySnapshot {
  return {
    id: record.get("id") as string,
    type: record.get("type") as ActivityType,
    actorLabel: record.get("actorLabel") as string,
    timestamp: record.get("timestamp") as number,
    listId: record.get("listId") as string,
    listName: record.get("listName") as string,
    itemId: (record.get("itemId") as string | null) ?? null,
    itemText: (record.get("itemText") as string | null) ?? null,
    previousText: (record.get("previousText") as string | null) ?? null,
  };
}

export function readHousehold(doc: Y.Doc): HouseholdSnapshot {
  const meta = doc.getMap(META_KEY);
  const listsMap = getListsMap(doc);
  return {
    id: meta.get("id") as string,
    name: meta.get("name") as string,
    createdAt: meta.get("createdAt") as number,
    lists: sortedByOrder(listsMap).map(readList),
  };
}

// Unfiltered, most-recent-first -- filtering by listId/type is left to
// callers, matching how readHousehold/readList already push filtering
// (e.g. "!archived") to the UI layer rather than doc-schema.
export function readActivity(doc: Y.Doc): ActivitySnapshot[] {
  return sortedByTimestampDesc(getActivityMap(doc)).map(readActivityRecord);
}
