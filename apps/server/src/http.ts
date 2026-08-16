import type { IncomingMessage, ServerResponse } from "node:http";
import { v4 as uuidv4 } from "uuid";

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

export async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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

  json(res, 404, { error: "not found" });
}
