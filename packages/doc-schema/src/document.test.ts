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
  archiveList,
  createHouseholdDoc,
  createList,
  forkList,
  getItemNoteText,
  mergeFork,
  readActivity,
  readHousehold,
  renameList,
  reorderItem,
  setItemChecked,
  setItemText,
  unarchiveItem,
  unarchiveList,
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

    setItemText(docA, listId, itemId, "Oat milk", "alice");
    setItemChecked(docB, listId, itemId, true, "bob");

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

    setItemText(docA, listId, itemId, "Oat milk", "alice");
    setItemText(docB, listId, itemId, "Almond milk", "bob");

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

    archiveItem(docA, listId, itemId, "alice");
    setItemText(docB, listId, itemId, "Oat milk", "bob");

    syncDocs(docA, docB);

    for (const doc of [docA, docB]) {
      const item = readHousehold(doc).lists[0].items[0];
      expect(item.archived).toBe(true);
      expect(item.text).toBe("Oat milk");
    }

    unarchiveItem(docA, listId, itemId, "carol");
    syncDocs(docA, docB);
    for (const doc of [docA, docB]) {
      const item = readHousehold(doc).lists[0].items[0];
      expect(item.archived).toBe(false);
      // Restore is a pure flag flip -- it must preserve the concurrently
      // edited text, not resurrect the pre-edit original.
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
    reorderItem(docA, listId, item3, item1, item2, "alice");
    reorderItem(docB, listId, item1, item2, item3, "bob");

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
    setItemChecked(docB, listId, sharedItem, true, "bob");
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
      | { kind: "addItem"; text: string }
      | { kind: "renameList" }
      | { kind: "archiveList" }
      | { kind: "unarchiveList" };

    const opArb: fc.Arbitrary<Op> = fc.oneof(
      fc.constantFrom(...seedIds).map((itemId) => ({ kind: "toggle", itemId }) as Op),
      fc
        .tuple(fc.constantFrom(...seedIds), fc.string({ minLength: 1, maxLength: 12 }))
        .map(([itemId, text]) => ({ kind: "setText", itemId, text }) as Op),
      fc.constantFrom(...seedIds).map((itemId) => ({ kind: "archive", itemId }) as Op),
      fc.constantFrom(...seedIds).map((itemId) => ({ kind: "unarchive", itemId }) as Op),
      fc.string({ minLength: 1, maxLength: 12 }).map((text) => ({ kind: "addItem", text }) as Op),
      fc.constant({ kind: "renameList" } as Op),
      fc.constant({ kind: "archiveList" } as Op),
      fc.constant({ kind: "unarchiveList" } as Op),
    );

    function applyOp(doc: Y.Doc, op: Op, actor: string): void {
      switch (op.kind) {
        case "toggle":
          setItemChecked(doc, listId, op.itemId, true, actor);
          break;
        case "setText":
          setItemText(doc, listId, op.itemId, op.text, actor);
          break;
        case "archive":
          archiveItem(doc, listId, op.itemId, actor);
          break;
        case "unarchive":
          unarchiveItem(doc, listId, op.itemId, actor);
          break;
        case "addItem":
          addItem(doc, listId, op.text, "fuzzer");
          break;
        case "renameList":
          renameList(doc, listId, `Groceries-${actor}`, actor);
          break;
        case "archiveList":
          archiveList(doc, listId, actor);
          break;
        case "unarchiveList":
          unarchiveList(doc, listId, actor);
          break;
      }
    }

    const opsArb = fc.array(opArb, { minLength: 3, maxLength: 12 });

    fc.assert(
      fc.property(opsArb, opsArb, opsArb, (opsA, opsB, opsC) => {
        const docA = cloneDoc(base);
        const docB = cloneDoc(base);
        const docC = cloneDoc(base);

        opsA.forEach((op) => applyOp(docA, op, "device-a"));
        opsB.forEach((op) => applyOp(docB, op, "device-b"));
        opsC.forEach((op) => applyOp(docC, op, "device-c"));

        syncDocs(docA, docB, docC);

        expect(statesConverged(docA, docB)).toBe(true);
        expect(statesConverged(docB, docC)).toBe(true);
      }),
      { numRuns: 25 },
    );
  });
});

describe("11. activity log: concurrent entries from two offline devices", () => {
  test("both entries survive and converge", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    const itemId = addItem(base, listId, "Milk", "alice");
    const docA = cloneDoc(base);
    const docB = cloneDoc(base);

    setItemText(docA, listId, itemId, "Oat milk", "device-a");
    renameList(docB, listId, "Weekly Groceries", "device-b");

    syncDocs(docA, docB);

    for (const doc of [docA, docB]) {
      const entries = readActivity(doc);
      expect(entries.some((e) => e.type === "item.edited" && e.actorLabel === "device-a")).toBe(
        true,
      );
      expect(
        entries.some((e) => e.type === "list.renamed" && e.actorLabel === "device-b"),
      ).toBe(true);
    }
    expect(statesConverged(docA, docB)).toBe(true);
  });
});

describe("12. activity log: concurrent appends never collide", () => {
  test("both uuid-keyed entries survive sync (size = pre-existing + 2)", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    const itemId = addItem(base, listId, "Milk", "alice");
    const before = readActivity(base).length;
    const docA = cloneDoc(base);
    const docB = cloneDoc(base);

    setItemChecked(docA, listId, itemId, true, "device-a");
    setItemChecked(docB, listId, itemId, true, "device-b");

    syncDocs(docA, docB);

    expect(readActivity(docA).length).toBe(before + 2);
    expect(readActivity(docB).length).toBe(before + 2);
    expect(statesConverged(docA, docB)).toBe(true);
  });
});

describe("13. checkedBy stays consistent with checked under a concurrent race", () => {
  test("never checked:true with checkedBy:null or vice versa", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    const itemId = addItem(base, listId, "Milk", "alice");
    const docA = cloneDoc(base);
    const docB = cloneDoc(base);

    setItemChecked(docA, listId, itemId, true, "device-a");
    setItemChecked(docB, listId, itemId, false, "device-b");

    syncDocs(docA, docB);

    for (const doc of [docA, docB]) {
      const item = readHousehold(doc).lists[0].items[0];
      if (item.checked) {
        expect(item.checkedBy).not.toBeNull();
      } else {
        expect(item.checkedBy).toBeNull();
      }
    }
    expect(statesConverged(docA, docB)).toBe(true);
  });
});

describe("14. unarchiveList restores a list with its nested items intact", () => {
  test("items and their field values are unchanged after archive/unarchive", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    addItem(base, listId, "Milk", "alice");
    addItem(base, listId, "Eggs", "alice");
    setItemChecked(base, listId, readHousehold(base).lists[0].items[0].id, true, "alice");

    const before = readHousehold(base).lists[0].items;

    archiveList(base, listId, "alice");
    unarchiveList(base, listId, "alice");

    const list = readHousehold(base).lists[0];
    expect(list.archived).toBe(false);
    expect(list.deletedAt).toBeNull();
    expect(list.items).toEqual(before);
  });
});

describe("15. mutation helpers emit correctly attributed activity entries", () => {
  test("renameList captures previousText and the new listName", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    renameList(base, listId, "Weekly Groceries", "device-abc");

    const entry = readActivity(base).find((e) => e.type === "list.renamed");
    expect(entry).toMatchObject({
      actorLabel: "device-abc",
      listName: "Weekly Groceries",
      previousText: "Groceries",
    });
  });

  test("setItemText captures previousText and itemText before/after the edit", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    const itemId = addItem(base, listId, "Milk", "alice");
    setItemText(base, listId, itemId, "Oat milk", "device-abc");

    const entry = readActivity(base).find((e) => e.type === "item.edited");
    expect(entry).toMatchObject({
      actorLabel: "device-abc",
      itemText: "Oat milk",
      previousText: "Milk",
    });
  });

  test("archiveItem/unarchiveItem each emit one correctly attributed entry", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    const itemId = addItem(base, listId, "Milk", "alice");
    archiveItem(base, listId, itemId, "device-x");
    unarchiveItem(base, listId, itemId, "device-y");

    const archived = readActivity(base).find((e) => e.type === "item.archived");
    const unarchived = readActivity(base).find((e) => e.type === "item.unarchived");
    expect(archived).toMatchObject({ actorLabel: "device-x", itemText: "Milk" });
    expect(unarchived).toMatchObject({ actorLabel: "device-y", itemText: "Milk" });
  });

  test("setItemChecked emits item.checked or item.unchecked matching the toggle", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    const itemId = addItem(base, listId, "Milk", "alice");
    setItemChecked(base, listId, itemId, true, "device-x");
    setItemChecked(base, listId, itemId, false, "device-y");

    const types = readActivity(base)
      .filter((e) => e.itemId === itemId)
      .map((e) => e.type);
    expect(types).toContain("item.checked");
    expect(types).toContain("item.unchecked");
  });
});

describe("16. forkList snapshots current items into an independent list", () => {
  test("fork gets the source's items and checked state, then evolves separately", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    const milkId = addItem(base, listId, "Milk", "alice");
    addItem(base, listId, "Eggs", "alice");
    setItemChecked(base, listId, milkId, true, "alice");

    const forkId = forkList(base, listId, "Dinner Party", "bob");
    const fork = readHousehold(base).lists.find((l) => l.id === forkId)!;
    expect(fork.forkedFromListId).toBe(listId);
    expect(fork.items.map((i) => i.text).sort()).toEqual(["Eggs", "Milk"]);
    expect(fork.items.find((i) => i.text === "Milk")!.checked).toBe(true);

    // From here the two lists are independent -- editing one must never
    // touch the other.
    addItem(base, listId, "Bread", "alice");
    addItem(base, forkId, "Wine", "bob");

    const source = readHousehold(base).lists.find((l) => l.id === listId)!;
    const forkAfter = readHousehold(base).lists.find((l) => l.id === forkId)!;
    expect(source.items.map((i) => i.text)).not.toContain("Wine");
    expect(forkAfter.items.map((i) => i.text)).not.toContain("Bread");
  });
});

describe("17. mergeFork brings back only items added after the fork point", () => {
  test("copied-over items aren't duplicated; only genuinely new ones merge", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    addItem(base, listId, "Milk", "alice");

    const forkId = forkList(base, listId, "Dinner Party", "bob");
    addItem(base, forkId, "Wine", "bob");
    addItem(base, forkId, "Cheese", "bob");

    const { mergedCount } = mergeFork(base, forkId, "bob");
    expect(mergedCount).toBe(2);

    const source = readHousehold(base).lists.find((l) => l.id === listId)!;
    expect(source.items.map((i) => i.text).sort()).toEqual(["Cheese", "Milk", "Wine"]);
    // "Milk" must appear exactly once -- the copied-over item is not
    // re-merged as if it were new.
    expect(source.items.filter((i) => i.text === "Milk")).toHaveLength(1);
  });

  test("merging archives the fork, same as discarding one would", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    const forkId = forkList(base, listId, "Dinner Party", "bob");

    mergeFork(base, forkId, "bob");

    const fork = readHousehold(base).lists.find((l) => l.id === forkId)!;
    expect(fork.archived).toBe(true);
  });
});

describe("18. discarding a fork never touches the source list", () => {
  test("archiveList on a fork leaves the source completely unaffected", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    addItem(base, listId, "Milk", "alice");

    const forkId = forkList(base, listId, "Dinner Party", "bob");
    addItem(base, forkId, "Wine", "bob");
    archiveList(base, forkId, "bob"); // discard, not merge

    const source = readHousehold(base).lists.find((l) => l.id === listId)!;
    expect(source.items.map((i) => i.text)).toEqual(["Milk"]);
    expect(source.archived).toBe(false);
  });
});

describe("19. fork racing a concurrent edit to the source converges", () => {
  test("a fork is a snapshot, not a live link -- concurrent source edits never leak into it", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    addItem(base, listId, "Milk", "alice");
    const docA = cloneDoc(base);
    const docB = cloneDoc(base);

    const forkId = forkList(docA, listId, "Dinner Party", "alice");
    addItem(docB, listId, "Eggs", "bob"); // concurrent edit to the source itself

    syncDocs(docA, docB);

    for (const doc of [docA, docB]) {
      const household = readHousehold(doc);
      const source = household.lists.find((l) => l.id === listId)!;
      const fork = household.lists.find((l) => l.id === forkId)!;
      // The concurrent addition lands in the source, as expected...
      expect(source.items.map((i) => i.text).sort()).toEqual(["Eggs", "Milk"]);
      // ...but never in the fork, which only ever saw "Milk" at the moment
      // it was created.
      expect(fork.items.map((i) => i.text)).toEqual(["Milk"]);
    }
    expect(statesConverged(docA, docB)).toBe(true);
  });
});

describe("20. item notes are real character-level collaborative text", () => {
  test("two peers typing in the same note converge without overwriting each other", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    const itemId = addItem(base, listId, "Milk", "alice");
    const docA = cloneDoc(base);
    const docB = cloneDoc(base);

    getItemNoteText(docA, listId, itemId).insert(0, "get the 2%");
    getItemNoteText(docB, listId, itemId).insert(0, "Tuesday coupon");

    syncDocs(docA, docB);

    const noteA = readHousehold(docA).lists[0].items[0].note;
    const noteB = readHousehold(docB).lists[0].items[0].note;
    expect(noteA).toBe(noteB);
    // This is the actual proof of the feature: a plain last-write-wins
    // field would have one insert clobber the other. Both must survive.
    expect(noteA).toContain("get the 2%");
    expect(noteA).toContain("Tuesday coupon");
    expect(statesConverged(docA, docB)).toBe(true);
  });

  test("forking copies the note as an independent snapshot, not a live link", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    const itemId = addItem(base, listId, "Milk", "alice");
    getItemNoteText(base, listId, itemId).insert(0, "2% please");

    const forkId = forkList(base, listId, "Dinner Party", "bob");

    // Editing the source's note after the fork must never leak into it.
    getItemNoteText(base, listId, itemId).insert(0, "URGENT: ");

    const source = readHousehold(base).lists.find((l) => l.id === listId)!;
    const fork = readHousehold(base).lists.find((l) => l.id === forkId)!;
    expect(source.items[0].note).toBe("URGENT: 2% please");
    expect(fork.items[0].note).toBe("2% please");
  });

  test("getItemNoteText backfills a note field for items created before this feature existed", () => {
    const base = createHouseholdDoc("Household");
    const listId = createList(base, "Groceries", "alice");
    const itemId = addItem(base, listId, "Milk", "alice");

    // Simulate a pre-migration item: raw doc surgery to remove the field
    // addItem now always sets, mirroring real historical production data.
    const listsMap = base.getMap("lists") as unknown as Y.Map<Y.Map<unknown>>;
    const itemsMap = listsMap.get(listId)!.get("items") as Y.Map<Y.Map<unknown>>;
    itemsMap.get(itemId)!.delete("note");

    const note = getItemNoteText(base, listId, itemId);
    expect(note.toString()).toBe("");
    note.insert(0, "backfilled fine");
    expect(readHousehold(base).lists[0].items[0].note).toBe("backfilled fine");
  });
});
