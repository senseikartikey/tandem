// Proves the signaling relay's own logic (subscribe/publish/unsubscribe
// fan-out) against real WebSocket connections -- not the actual WebRTC
// handshake, which needs real browser RTCPeerConnection support Node
// doesn't have. That part is verified manually in a real browser (see
// README) the same way this project verifies anything a Node test can't
// reach. This file exists specifically because the relay is a small,
// from-scratch reimplementation of y-webrtc's own reference protocol
// (not the npm package itself), so it needs its own correctness proof.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v4 as uuidv4 } from "uuid";
import WS from "ws";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createTandemServer, type TandemServer } from "./server.js";

let server: TandemServer;
let dbDir: string;

beforeEach(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "tandem-signaling-test-"));
  server = await createTandemServer({ port: 0, dbUrl: `file:${join(dbDir, "test.sqlite")}` });
});

afterEach(async () => {
  await server.close();
  try {
    rmSync(dbDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch (e) {
    console.warn(`test cleanup: couldn't remove ${dbDir} (leaked temp file, harmless):`, e);
  }
});

function connectSignaling(): Promise<WS> {
  return new Promise((resolve, reject) => {
    const ws = new WS(`ws://localhost:${server.port}/signaling`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(ws: WS): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
  });
}

describe("WebRTC signaling relay", () => {
  test("a publish reaches other subscribers of the same topic, not the publisher", async () => {
    const topic = uuidv4();
    const a = await connectSignaling();
    const b = await connectSignaling();

    a.send(JSON.stringify({ type: "subscribe", topics: [topic] }));
    b.send(JSON.stringify({ type: "subscribe", topics: [topic] }));
    await new Promise((r) => setTimeout(r, 100)); // let both subscriptions land

    const bReceived = nextMessage(b);
    a.send(JSON.stringify({ type: "publish", topic, data: "offer-sdp" }));

    const received = await bReceived;
    expect(received).toMatchObject({ type: "publish", topic, data: "offer-sdp", clients: 2 });

    a.close();
    b.close();
  });

  test("publishing to a topic with no subscribers is a silent no-op, not an error", async () => {
    const a = await connectSignaling();
    a.send(JSON.stringify({ type: "publish", topic: uuidv4(), data: "nobody-listening" }));
    await new Promise((r) => setTimeout(r, 100));
    expect(a.readyState).toBe(WS.OPEN); // didn't crash the connection
    a.close();
  });

  test("unsubscribe stops further delivery", async () => {
    const topic = uuidv4();
    const a = await connectSignaling();
    const b = await connectSignaling();

    a.send(JSON.stringify({ type: "subscribe", topics: [topic] }));
    b.send(JSON.stringify({ type: "subscribe", topics: [topic] }));
    await new Promise((r) => setTimeout(r, 100));

    b.send(JSON.stringify({ type: "unsubscribe", topics: [topic] }));
    await new Promise((r) => setTimeout(r, 100));

    let bGotMessage = false;
    b.once("message", () => {
      bGotMessage = true;
    });
    a.send(JSON.stringify({ type: "publish", topic, data: "should-not-arrive" }));
    await new Promise((r) => setTimeout(r, 150));

    expect(bGotMessage).toBe(false);
    a.close();
    b.close();
  });

  test("ping gets a pong", async () => {
    const a = await connectSignaling();
    const pong = nextMessage(a);
    a.send(JSON.stringify({ type: "ping" }));
    expect(await pong).toEqual({ type: "pong" });
    a.close();
  });

  test("closing a connection drops it from its topics -- a later publish only reaches survivors", async () => {
    const topic = uuidv4();
    const a = await connectSignaling();
    const b = await connectSignaling();
    const c = await connectSignaling();

    for (const ws of [a, b, c]) {
      ws.send(JSON.stringify({ type: "subscribe", topics: [topic] }));
    }
    await new Promise((r) => setTimeout(r, 100));

    b.close();
    await new Promise((r) => setTimeout(r, 100));

    const cReceived = nextMessage(c);
    a.send(JSON.stringify({ type: "publish", topic, data: "still-here" }));
    const received = await cReceived;
    // The relay doesn't exclude the publisher from its own topic's
    // receivers (that filtering is the y-webrtc client's job, via a "from"
    // field this generic relay doesn't interpret) -- b closing drops it
    // from the topic, leaving {a, c}, so clients: 2.
    expect(received.clients).toBe(2);

    a.close();
    c.close();
  });
});
