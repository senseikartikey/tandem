// This suite is the technical proof behind tandem's core claim: concurrent
// offline edits on independent devices merge correctly, deterministically,
// and without data loss when they reconnect. Every case here is designed to
// be re-enacted live on two real phones (see the project README's demo
// script) -- the automated proof and the demo are meant to mirror each other.

import * as fc from "fast-check";
import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import {
  addItem,
  archiveItem,
  createHouseholdDoc,
  createList,
  readHousehold,
  reorderItem,
  setItemChecked,
  setItemText,
  unarchiveItem,
} from "./document.js";

function cloneDoc(source: Y.Doc): Y.Doc {
  const clone = new Y.Doc();
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(source));
  return clone;
}

// Simulates every device coming back online at once and exchanging full
// state with every other device -- a full-mesh sync, not just pairwise.
function syncDocs(...docs: Y.Doc[]): void {
  const updates = docs.map((d) => Y.encodeStateAsUpdate(d));
  docs.forEach((doc, i) => {
    updates.forEach((update, j) => {
      if (i !== j) Y.applyUpdate(doc, update);
    });
  });
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// The strongest possible convergence assertion: not "looks equal" but the
// literal encoded CRDT state is byte-identical across peers.
function statesConverged(a: Y.Doc, b: Y.Doc): boolean {
  return bytesEqual(Y.encodeStateAsUpdate(a), Y.encodeStateAsUpdate(b));
}

describe("1. concurrent add of different items to the same list", () => {
  test("both items survive after sync", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    const docA = cloneDoc(base);
    const docB = cloneDoc(base);

    addItem(docA, listId, "Milk", "alice");
    addItem(docB, listId, "Eggs", "bob");

    syncDocs(docA, docB);

    const itemsA = readHousehold(docA).lists[0].items.map((i) => i.text);
    const itemsB = readHousehold(docB).lists[0].items.map((i) => i.text);
    expect(itemsA.sort()).toEqual(["Eggs", "Milk"]);
    expect(itemsB.sort()).toEqual(["Eggs", "Milk"]);
    expect(statesConverged(docA, docB)).toBe(true);
  });
});

describe("2. concurrent creation of a new list on two devices", () => {
  test("both lists survive after sync", () => {
    const base = createHouseholdDoc("Household");
    const docA = cloneDoc(base);
    const docB = cloneDoc(base);

    createList(docA, "Groceries", "alice");
    createList(docB, "Chores", "bob");

    syncDocs(docA, docB);

    const namesA = readHousehold(docA).lists.map((l) => l.name);
    const namesB = readHousehold(docB).lists.map((l) => l.name);
    expect(namesA.sort()).toEqual(["Chores", "Groceries"]);
    expect(namesB.sort()).toEqual(["Chores", "Groceries"]);
    expect(statesConverged(docA, docB)).toBe(true);
  });
});

describe("3. concurrent edits to different fields of the same item", () => {
  test("both the text edit and the checked toggle survive", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    const itemId = addItem(base, listId, "Milk", "alice");
    const docA = cloneDoc(base);
    const docB = cloneDoc(base);

    setItemText(docA, listId, itemId, "Oat milk");
    setItemChecked(docB, listId, itemId, true);

    syncDocs(docA, docB);

    for (const doc of [docA, docB]) {
      const item = readHousehold(doc).lists[0].items[0];
      expect(item.text).toBe("Oat milk");
      expect(item.checked).toBe(true);
    }
    expect(statesConverged(docA, docB)).toBe(true);
  });
});

describe("4. concurrent edits to the same field of the same item", () => {
  test("resolves deterministically and identically on every peer", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    const itemId = addItem(base, listId, "Milk", "alice");
    const docA = cloneDoc(base);
    const docB = cloneDoc(base);

    setItemText(docA, listId, itemId, "Oat milk");
    setItemText(docB, listId, itemId, "Almond milk");

    syncDocs(docA, docB);

    const textA = readHousehold(docA).lists[0].items[0].text;
    const textB = readHousehold(docB).lists[0].items[0].text;
    expect(textA).toBe(textB);
    expect(["Oat milk", "Almond milk"]).toContain(textA);
    expect(statesConverged(docA, docB)).toBe(true);
  });
});

describe("5. soft-delete racing a concurrent field edit on the same item", () => {
  test("archive and the concurrent edit both survive; unarchiving recovers the edit", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    const itemId = addItem(base, listId, "Milk", "alice");
    const docA = cloneDoc(base);
    const docB = cloneDoc(base);

    archiveItem(docA, listId, itemId);
    setItemText(docB, listId, itemId, "Oat milk");

    syncDocs(docA, docB);

    for (const doc of [docA, docB]) {
      const item = readHousehold(doc).lists[0].items[0];
      expect(item.archived).toBe(true);
      expect(item.text).toBe("Oat milk");
    }

    unarchiveItem(docA, listId, itemId);
    syncDocs(docA, docB);
    for (const doc of [docA, docB]) {
      const item = readHousehold(doc).lists[0].items[0];
      expect(item.archived).toBe(false);
      expect(item.text).toBe("Oat milk");
    }
  });
});

describe("6. concurrent reorder of different items", () => {
  test("final order is stable with no order-key collisions", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    const item1 = addItem(base, listId, "Milk", "alice");
    const item2 = addItem(base, listId, "Eggs", "alice");
    const item3 = addItem(base, listId, "Bread", "alice");
    const docA = cloneDoc(base);
    const docB = cloneDoc(base);

    // A moves item3 between item1 and item2; B concurrently moves item1
    // between item2 and item3 -- both relative to the pre-sync order.
    reorderItem(docA, listId, item3, item1, item2);
    reorderItem(docB, listId, item1, item2, item3);

    syncDocs(docA, docB);

    for (const doc of [docA, docB]) {
      const items = readHousehold(doc).lists[0].items;
      expect(items.map((i) => i.id).sort()).toEqual([item1, item2, item3].sort());
      const orders = items.map((i) => i.order);
      expect(new Set(orders).size).toBe(3); // no collisions
      expect(orders).toEqual([...orders].sort()); // readHousehold already sorts by order
    }
    expect(statesConverged(docA, docB)).toBe(true);
  });
});

describe("7. three-way merge", () => {
  test("catches bugs that only surface beyond pairwise merging", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    const sharedItem = addItem(base, listId, "Milk", "alice");
    const docA = cloneDoc(base);
    const docB = cloneDoc(base);
    const docC = cloneDoc(base);

    addItem(docA, listId, "Bread", "alice");
    setItemChecked(docB, listId, sharedItem, true);
    addItem(docC, listId, "Eggs", "carol");

    syncDocs(docA, docB, docC);

    for (const doc of [docA, docB, docC]) {
      const items = readHousehold(doc).lists[0].items;
      expect(items.map((i) => i.text).sort()).toEqual(["Bread", "Eggs", "Milk"]);
      expect(items.find((i) => i.id === sharedItem)!.checked).toBe(true);
    }
    expect(statesConverged(docA, docB)).toBe(true);
    expect(statesConverged(docB, docC)).toBe(true);
  });
});

describe("8. out-of-order update application", () => {
  test("applying updates shuffled/reversed produces the same final state as in-order", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    const source = cloneDoc(base);

    const updates: Uint8Array[] = [];
    source.on("update", (update: Uint8Array) => updates.push(update));
    addItem(source, listId, "Milk", "alice");
    addItem(source, listId, "Eggs", "alice");
    addItem(source, listId, "Bread", "alice");
    expect(updates.length).toBeGreaterThanOrEqual(3);

    const inOrderTarget = cloneDoc(base);
    for (const u of updates) Y.applyUpdate(inOrderTarget, u);

    const reversedTarget = cloneDoc(base);
    for (const u of [...updates].reverse()) Y.applyUpdate(reversedTarget, u);

    const shuffledTarget = cloneDoc(base);
    const shuffled = [...updates].sort(() => 0.5 - Math.random());
    for (const u of shuffled) Y.applyUpdate(shuffledTarget, u);

    // This is the single most convincing test in the suite: Yjs's update
    // application is commutative -- arrival order must not matter.
    expect(statesConverged(inOrderTarget, reversedTarget)).toBe(true);
    expect(statesConverged(inOrderTarget, shuffledTarget)).toBe(true);
  });
});

describe("9. duplicate update redelivery", () => {
  test("applying the same update twice is idempotent", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    addItem(base, listId, "Milk", "alice");
    const fullUpdate = Y.encodeStateAsUpdate(base);

    const onceTarget = new Y.Doc();
    Y.applyUpdate(onceTarget, fullUpdate);

    const twiceTarget = new Y.Doc();
    Y.applyUpdate(twiceTarget, fullUpdate);
    Y.applyUpdate(twiceTarget, fullUpdate); // simulated relay redelivery

    expect(statesConverged(onceTarget, twiceTarget)).toBe(true);
    expect(readHousehold(twiceTarget).lists[0].items).toHaveLength(1);
  });
});

describe("10. randomized fuzz: N devices, random concurrent ops", () => {
  test("always converges to identical state regardless of operation sequence", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    const seedIds = [
      addItem(base, listId, "seed-1", "seed"),
      addItem(base, listId, "seed-2", "seed"),
      addItem(base, listId, "seed-3", "seed"),
    ];

    type Op =
      | { kind: "toggle"; itemId: string }
      | { kind: "setText"; itemId: string; text: string }
      | { kind: "archive"; itemId: string }
      | { kind: "unarchive"; itemId: string }
      | { kind: "addItem"; text: string };

    const opArb: fc.Arbitrary<Op> = fc.oneof(
      fc.constantFrom(...seedIds).map((itemId) => ({ kind: "toggle", itemId }) as Op),
      fc
        .tuple(fc.constantFrom(...seedIds), fc.string({ minLength: 1, maxLength: 12 }))
        .map(([itemId, text]) => ({ kind: "setText", itemId, text }) as Op),
      fc.constantFrom(...seedIds).map((itemId) => ({ kind: "archive", itemId }) as Op),
      fc.constantFrom(...seedIds).map((itemId) => ({ kind: "unarchive", itemId }) as Op),
      fc.string({ minLength: 1, maxLength: 12 }).map((text) => ({ kind: "addItem", text }) as Op),
    );

    function applyOp(doc: Y.Doc, op: Op): void {
      switch (op.kind) {
        case "toggle":
          setItemChecked(doc, listId, op.itemId, true);
          break;
        case "setText":
          setItemText(doc, listId, op.itemId, op.text);
          break;
        case "archive":
          archiveItem(doc, listId, op.itemId);
          break;
        case "unarchive":
          unarchiveItem(doc, listId, op.itemId);
          break;
        case "addItem":
          addItem(doc, listId, op.text, "fuzzer");
          break;
      }
    }

    const opsArb = fc.array(opArb, { minLength: 3, maxLength: 12 });

    fc.assert(
      fc.property(opsArb, opsArb, opsArb, (opsA, opsB, opsC) => {
        const docA = cloneDoc(base);
        const docB = cloneDoc(base);
        const docC = cloneDoc(base);

        opsA.forEach((op) => applyOp(docA, op));
        opsB.forEach((op) => applyOp(docB, op));
        opsC.forEach((op) => applyOp(docC, op));

        syncDocs(docA, docB, docC);

        expect(statesConverged(docA, docB)).toBe(true);
        expect(statesConverged(docB, docC)).toBe(true);
      }),
      { numRuns: 25 },
    );
  });
});
