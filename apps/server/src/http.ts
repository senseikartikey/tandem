import type { IncomingMessage, ServerResponse } from "node:http";
import { v4 as uuidv4 } from "uuid";
import type { PushService } from "./push.js";

// Short, human-shareable codes for verbal/typed sharing. Unlike the invite
// link's UUID+key (a long-lived capability token), a 6-char code is not
// brute-force-safe on its own -- so it's deliberately short-lived and
// resolves to the real room ID rather than replacing it.
const SHORT_CODE_TTL_MS = 10 * 60 * 1000;
const SHORT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

interface ShortCodeEntry {
  roomId: string;
  expiresAt: number;
}

const shortCodes = new Map<string, ShortCodeEntry>();

function generateShortCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += SHORT_CODE_ALPHABET[Math.floor(Math.random() * SHORT_CODE_ALPHABET.length)];
  }
  return code;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// Wildcard is deliberate, not an oversight: this API has no cookie/session
// auth to leak cross-origin -- the security model is entirely capability-
// based (possession of a room ID/invite link), which a wildcard origin does
// not weaken. It also matches the architecture's decoupling of apps/web
// (servable from any static host) from apps/server.
function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

// Very small per-IP rate limit on room creation -- the only unauthenticated
// write-ish endpoint. Not a general-purpose limiter, just an abuse guardrail
// for the public multi-tenant instance.
const roomCreateAttempts = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const attempts = (roomCreateAttempts.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  attempts.push(now);
  roomCreateAttempts.set(ip, attempts);
  return attempts.length > RATE_LIMIT_MAX;
}

export interface HttpContext {
  // Absent when the server runs without VAPID keys: the reminder endpoints
  // then answer honestly rather than pretending to have delivered anything.
  push?: PushService;
}

export async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  context: HttpContext = {},
): Promise<void> {
  if (req.method === "OPTIONS") {
    // Preflight for the POST endpoints (their JSON Content-Type triggers
    // one). Same wildcard-is-deliberate reasoning as json()'s CORS header.
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/healthz") {
    json(res, 200, { status: "ok" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const ip = req.socket.remoteAddress ?? "unknown";
    if (isRateLimited(ip)) {
      json(res, 429, { error: "too many rooms created, try again later" });
      return;
    }
    // Just mints an unguessable ID -- the room itself is created lazily by
    // the RoomRegistry on first WS connection, not here. Short-code minting
    // is a separate endpoint (below) precisely so it can also be used to
    // re-invite to an *existing* household later, not just at creation time.
    json(res, 201, { roomId: uuidv4() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/short-code") {
    const body = await readBody(req);
    let roomId: string;
    try {
      roomId = (JSON.parse(body) as { roomId: string }).roomId;
      if (!roomId) throw new Error();
    } catch {
      json(res, 400, { error: "invalid request body" });
      return;
    }
    const code = generateShortCode();
    const expiresAt = Date.now() + SHORT_CODE_TTL_MS;
    shortCodes.set(code, { roomId, expiresAt });
    json(res, 201, { shortCode: code, expiresAt });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/short-code/resolve") {
    const body = await readBody(req);
    let code: string;
    try {
      code = (JSON.parse(body) as { code: string }).code.toUpperCase();
    } catch {
      json(res, 400, { error: "invalid request body" });
      return;
    }
    const entry = shortCodes.get(code);
    if (!entry || entry.expiresAt < Date.now()) {
      json(res, 404, { error: "code not found or expired" });
      return;
    }
    json(res, 200, { roomId: entry.roomId });
    return;
  }

  // --- Push, for reminders ---------------------------------------------
  //
  // These endpoints only ring a doorbell. The reminder itself lives in the
  // household document and reaches the other device through ordinary sync
  // whether or not any of this works, so every failure path here is a
  // degradation, never a lost reminder.

  if (req.method === "GET" && url.pathname === "/api/push/key") {
    const push = context.push;
    json(res, 200, {
      configured: push?.configured ?? false,
      publicKey: push?.publicKey ?? "",
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/push/subscribe") {
    const push = context.push;
    if (!push?.configured) {
      json(res, 503, { error: "push is not configured on this server" });
      return;
    }
    let payload: { roomId?: string; label?: string; subscription?: PushSubscriptionBody };
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: "invalid request body" });
      return;
    }
    const { roomId, label, subscription } = payload;
    if (!roomId || !label || !subscription?.endpoint || !subscription.keys?.p256dh) {
      json(res, 400, { error: "roomId, label and subscription are required" });
      return;
    }
    await push.subscribe(roomId, label, subscription);
    json(res, 201, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/push/unsubscribe") {
    const push = context.push;
    let endpoint: string | undefined;
    try {
      endpoint = (JSON.parse(await readBody(req)) as { endpoint?: string }).endpoint;
    } catch {
      json(res, 400, { error: "invalid request body" });
      return;
    }
    if (!endpoint) {
      json(res, 400, { error: "endpoint is required" });
      return;
    }
    await push?.unsubscribe(endpoint);
    json(res, 200, { ok: true });
    return;
  }

  // Proving a device's own setup, which is otherwise unfalsifiable: a
  // reminder that never arrives looks identical whether the subscription is
  // broken, the platform dropped it, or nobody sent one.
  if (req.method === "POST" && url.pathname === "/api/push/test") {
    const push = context.push;
    if (!push?.configured) {
      json(res, 503, { error: "push is not configured on this server" });
      return;
    }
    let endpoint: string | undefined;
    try {
      endpoint = (JSON.parse(await readBody(req)) as { endpoint?: string }).endpoint;
    } catch {
      json(res, 400, { error: "invalid request body" });
      return;
    }
    if (!endpoint) {
      json(res, 400, { error: "endpoint is required" });
      return;
    }
    const sent = await push.sendTest(endpoint);
    json(res, sent ? 200 : 404, { sent });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/push/remind") {
    const push = context.push;
    if (!push?.configured) {
      // 202, not an error: the caller has already written the reminder to
      // the document, which is the part that matters. This response only
      // says "no doorbell available".
      json(res, 202, { delivered: false, reason: "push not configured" });
      return;
    }
    let payload: RemindBody;
    try {
      payload = JSON.parse(await readBody(req)) as RemindBody;
    } catch {
      json(res, 400, { error: "invalid request body" });
      return;
    }
    if (!payload.roomId || !payload.title || !payload.body) {
      json(res, 400, { error: "roomId, title and body are required" });
      return;
    }
    const result = await push.send({
      roomId: payload.roomId,
      toLabel: payload.toLabel ?? null,
      fromLabel: payload.fromLabel ?? "someone",
      title: payload.title,
      body: payload.body,
      url: payload.url ?? "/",
      tag: payload.tag ?? payload.roomId,
      fromEndpoint: payload.fromEndpoint ?? null,
      sendAt: payload.sendAt ?? null,
    });
    json(res, 200, { delivered: true, ...result });
    return;
  }

  json(res, 404, { error: "not found" });
}

interface PushSubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface RemindBody {
  roomId?: string;
  toLabel?: string | null;
  fromLabel?: string;
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  fromEndpoint?: string | null;
  sendAt?: number | null;
}
