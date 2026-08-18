import type { WebSocket } from "ws";

// A y-webrtc-compatible signaling relay: peers publish/subscribe to named
// topics (a WebRTC room name) to exchange SDP offers/answers and ICE
// candidates so they can find each other and open a direct connection --
// this server never sees the actual synced data, only the handshake
// messages. Protocol matches y-webrtc's own reference server
// (yjs/y-webrtc/bin/server.js) exactly, so the stock y-webrtc client works
// against this unmodified.
//
// Self-hosted on purpose, not pointed at y-webrtc's default public
// signaling servers: two of the three are old Heroku apps, and Heroku
// killed its free tier in 2022 -- likely already dead, and exactly the
// class of "assumed someone else's free infra would still be there"
// mistake this project already hit twice this week with Fly.io and Koyeb.
const PING_TIMEOUT_MS = 30_000;

interface SignalingMessage {
  type: "subscribe" | "unsubscribe" | "publish" | "ping" | "pong";
  topics?: string[];
  topic?: string;
  clients?: number;
  [key: string]: unknown;
}

const topics = new Map<string, Set<WebSocket>>();

function send(conn: WebSocket, message: SignalingMessage): void {
  if (conn.readyState !== conn.CONNECTING && conn.readyState !== conn.OPEN) {
    conn.close();
    return;
  }
  try {
    conn.send(JSON.stringify(message));
  } catch {
    conn.close();
  }
}

export function handleSignalingConnection(conn: WebSocket): void {
  const subscribedTopics = new Set<string>();
  let closed = false;
  let pongReceived = true;

  // Same liveness-check pattern as the room WS handler: a dead TCP
  // connection can sit open indefinitely without a close event ever
  // firing, silently leaking a topic subscription forever.
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      conn.close();
      clearInterval(pingInterval);
      return;
    }
    pongReceived = false;
    try {
      conn.ping();
    } catch {
      conn.close();
    }
  }, PING_TIMEOUT_MS);

  conn.on("pong", () => {
    pongReceived = true;
  });

  conn.on("close", () => {
    closed = true;
    clearInterval(pingInterval);
    for (const topicName of subscribedTopics) {
      const subs = topics.get(topicName);
      if (subs) {
        subs.delete(conn);
        if (subs.size === 0) topics.delete(topicName);
      }
    }
    subscribedTopics.clear();
  });

  conn.on("message", (raw: Buffer | string) => {
    if (closed) return;
    let message: SignalingMessage;
    try {
      message = JSON.parse(typeof raw === "string" ? raw : raw.toString());
    } catch {
      return;
    }
    if (!message?.type) return;

    switch (message.type) {
      case "subscribe":
        for (const topicName of message.topics ?? []) {
          if (typeof topicName !== "string") continue;
          let subs = topics.get(topicName);
          if (!subs) {
            subs = new Set();
            topics.set(topicName, subs);
          }
          subs.add(conn);
          subscribedTopics.add(topicName);
        }
        break;
      case "unsubscribe":
        for (const topicName of message.topics ?? []) {
          topics.get(topicName)?.delete(conn);
        }
        break;
      case "publish": {
        if (!message.topic) break;
        const receivers = topics.get(message.topic);
        if (receivers) {
          // y-webrtc's client reads this back to size its connection
          // fan-out -- part of the wire protocol, not incidental.
          message.clients = receivers.size;
          for (const receiver of receivers) send(receiver, message);
        }
        break;
      }
      case "ping":
        send(conn, { type: "pong" });
        break;
    }
  });
}
