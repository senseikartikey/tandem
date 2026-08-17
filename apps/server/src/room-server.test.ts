// Layer 2 (see packages/doc-schema/src/document.test.ts for Layer 1): proves
// the actual WS relay + SQLite persistence code path converges correctly,
// not just Yjs's in-memory semantics. Uses the real y-websocket client
// library against our server -- the core interoperability claim is that a
// standard y-websocket client works against this server unmodified.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addItem,
  createHouseholdDoc,
  createList,
  readHousehold,
  setItemChecked,
} from "@tandem/doc-schema";
import { v4 as uuidv4 } from "uuid";
import WS from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createTandemServer, type TandemServer } from "./server.js";

let server: TandemServer;
let dbDir: string;

beforeEach(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "tandem-test-"));
  server = await createTandemServer({ port: 0, databasePath: join(dbDir, "test.sqlite") });
});

afterEach(async () => {
  await server.close();
  rmSync(dbDir, { recursive: true, force: true });
});

function connect(doc: Y.Doc, roomId: string): WebsocketProvider {
  return new WebsocketProvider(`ws://localhost:${server.port}`, roomId, doc, {
    WebSocketPolyfill: WS as unknown as typeof WebSocket,
  });
}

function waitForSync(provider: WebsocketProvider): Promise<void> {
  return new Promise((resolve) => {
    if (provider.synced) {
      resolve();
      return;
    }
    provider.once("sync", () => resolve());
  });
}

describe("real WS relay + SQLite persistence", () => {
  test("two clients converge through the real server", async () => {
    const roomId = uuidv4();

    const docA = createHouseholdDoc("Household");
    const listId = createList(docA, "Groceries", "alice");
    const providerA = connect(docA, roomId);
    await waitForSync(providerA);

    const docB = new Y.Doc();
    const providerB = connect(docB, roomId);
    await waitForSync(providerB);

    addItem(docA, listId, "Milk", "alice");
    setItemChecked(docB, listId, addItem(docB, listId, "Eggs", "bob"), true, "bob");

    await new Promise((r) => setTimeout(r, 300)); // let the relay propagate

    const itemsA = readHousehold(docA).lists[0].items.map((i) => i.text).sort();
    const itemsB = readHousehold(docB).lists[0].items.map((i) => i.text).sort();
    expect(itemsA).toEqual(["Eggs", "Milk"]);
    expect(itemsB).toEqual(["Eggs", "Milk"]);

    providerA.destroy();
    providerB.destroy();
  });

  test("a device that disconnects and reconnects gets missed updates", async () => {
    const roomId = uuidv4();

    const docA = createHouseholdDoc("Household");
    const listId = createList(docA, "Groceries", "alice");
    const providerA = connect(docA, roomId);
    await waitForSync(providerA);
    await new Promise((r) => setTimeout(r, 200));

    // B connects, syncs, then goes offline (destroy the provider).
    const docB = new Y.Doc();
    const providerB1 = connect(docB, roomId);
    await waitForSync(providerB1);
    providerB1.destroy();

    // A makes a change while B is offline.
    addItem(docA, listId, "Bread", "alice");
    await new Promise((r) => setTimeout(r, 200));

    // B reconnects with a fresh provider on the same doc.
    const providerB2 = connect(docB, roomId);
    await waitForSync(providerB2);

    const items = readHousehold(docB).lists[0].items.map((i) => i.text);
    expect(items).toContain("Bread");

    providerA.destroy();
    providerB2.destroy();
  });

  test("server persists across a restart -- a new device joining later still gets full history", async () => {
    const roomId = uuidv4();
    const dbPath = join(dbDir, "persist.sqlite");
    const server1 = await createTandemServer({ port: 0, databasePath: dbPath });

    const docA = createHouseholdDoc("Household");
    const listId = createList(docA, "Groceries", "alice");
    addItem(docA, listId, "Milk", "alice");
    const providerA = new WebsocketProvider(`ws://localhost:${server1.port}`, roomId, docA, {
      WebSocketPolyfill: WS as unknown as typeof WebSocket,
    });
    await waitForSync(providerA);
    await new Promise((r) => setTimeout(r, 2500)); // let the debounced persist fire
    providerA.destroy();
    await server1.close();

    // A completely new "device" connects to a fresh server instance backed
    // by the same DB file, with nobody else online -- it must still get the
    // full household history from disk, not just an empty room.
    const server2 = await createTandemServer({ port: 0, databasePath: dbPath });
    const docC = new Y.Doc();
    const providerC = new WebsocketProvider(`ws://localhost:${server2.port}`, roomId, docC, {
      WebSocketPolyfill: WS as unknown as typeof WebSocket,
    });
    await waitForSync(providerC);

    const items = readHousehold(docC).lists[0].items.map((i) => i.text);
    expect(items).toContain("Milk");

    providerC.destroy();
    await server2.close();
  });
});
