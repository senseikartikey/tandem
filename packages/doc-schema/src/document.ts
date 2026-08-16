import { generateKeyBetween } from "fractional-indexing";
import { v4 as uuidv4 } from "uuid";
import * as Y from "yjs";

// Lists and items are keyed by UUID in a Y.Map, not stored in a Y.Array.
// Y.Array has no native "move" op -- reordering is delete+insert, which loses
// YATA position provenance and produces surprising results when two peers
// move the same element concurrently. Keying by UUID makes insert/update/
// delete of any single list or item an independent, position-free operation;
// ordering is a separate fractional-index string any peer can rewrite in
// O(1) without touching siblings.
const META_KEY = "meta";
const LISTS_KEY = "lists";
const ITEMS_KEY = "items";

export interface ListSnapshot {
  id: string;
  name: string;
  order: string;
  archived: boolean;
  createdBy: string;
  createdAt: number;
  items: ItemSnapshot[];
}

export interface ItemSnapshot {
  id: string;
  text: string;
  checked: boolean;
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

function sortedByOrder(map: Y.Map<YRecord>): YRecord[] {
  return Array.from(map.values()).sort((a, b) => {
    const oa = a.get("order") as string;
    const ob = b.get("order") as string;
    return oa < ob ? -1 : oa > ob ? 1 : 0;
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
    list.set("createdBy", createdBy);
    list.set("createdAt", now);
    list.set(ITEMS_KEY, new Y.Map());
    listsMap.set(id, list);
  });
  return id;
}

export function renameList(doc: Y.Doc, listId: string, name: string): void {
  const list = getListRecord(doc, listId);
  doc.transact(() => {
    list.set("name", name);
  });
}

// Soft delete only -- never Map.delete. A structural removal racing with a
// concurrent edit to the same subtree is a genuinely nasty CRDT edge case
// (Yjs generally does not resurrect edits made under a concurrently-deleted
// parent). An archived flag turns that into a plain last-write-wins field
// race: safe, reversible, and consistent with how mature local-first apps
// (Linear, tldraw) prefer tombstones over structural deletes.
export function archiveList(doc: Y.Doc, listId: string): void {
  const list = getListRecord(doc, listId);
  doc.transact(() => {
    list.set("archived", true);
  });
}

export function unarchiveList(doc: Y.Doc, listId: string): void {
  const list = getListRecord(doc, listId);
  doc.transact(() => {
    list.set("archived", false);
  });
}

export function reorderList(
  doc: Y.Doc,
  listId: string,
  beforeListId: string | null,
  afterListId: string | null,
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
  doc.transact(() => {
    const item: Y.Map<unknown> = new Y.Map();
    const now = Date.now();
    item.set("id", id);
    item.set("text", text);
    item.set("checked", false);
    item.set("order", nextOrderKey(itemsMap));
    item.set("archived", false);
    item.set("deletedAt", null);
    item.set("addedBy", addedBy);
    item.set("addedAt", now);
    item.set("updatedAt", now);
    itemsMap.set(id, item);
  });
  return id;
}

export function setItemText(doc: Y.Doc, listId: string, itemId: string, text: string): void {
  const item = getItemRecord(doc, listId, itemId);
  doc.transact(() => {
    item.set("text", text);
    item.set("updatedAt", Date.now());
  });
}

export function setItemChecked(doc: Y.Doc, listId: string, itemId: string, checked: boolean): void {
  const item = getItemRecord(doc, listId, itemId);
  doc.transact(() => {
    item.set("checked", checked);
    item.set("updatedAt", Date.now());
  });
}

export function archiveItem(doc: Y.Doc, listId: string, itemId: string): void {
  const item = getItemRecord(doc, listId, itemId);
  doc.transact(() => {
    item.set("archived", true);
    item.set("deletedAt", Date.now());
  });
}

export function unarchiveItem(doc: Y.Doc, listId: string, itemId: string): void {
  const item = getItemRecord(doc, listId, itemId);
  doc.transact(() => {
    item.set("archived", false);
    item.set("deletedAt", null);
  });
}

export function reorderItem(
  doc: Y.Doc,
  listId: string,
  itemId: string,
  beforeItemId: string | null,
  afterItemId: string | null,
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
  return {
    id: record.get("id") as string,
    text: record.get("text") as string,
    checked: record.get("checked") as boolean,
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
    createdBy: record.get("createdBy") as string,
    createdAt: record.get("createdAt") as number,
    items: sortedByOrder(itemsMap).map(readItem),
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
