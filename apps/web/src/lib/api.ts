const SYNC_SERVER_URL = import.meta.env.VITE_SYNC_SERVER_URL ?? "ws://localhost:1234";
const HTTP_BASE = SYNC_SERVER_URL.replace(/^ws/, "http");

export async function createRoom(): Promise<{ roomId: string }> {
  const res = await fetch(`${HTTP_BASE}/api/rooms`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to create room: ${res.status}`);
  return res.json();
}

export async function mintShortCode(roomId: string): Promise<{ shortCode: string; expiresAt: number }> {
  const res = await fetch(`${HTTP_BASE}/api/short-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId }),
  });
  if (!res.ok) throw new Error(`Failed to create invite code: ${res.status}`);
  return res.json();
}

export async function resolveShortCode(code: string): Promise<string> {
  const res = await fetch(`${HTTP_BASE}/api/short-code/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error("Code not found or expired");
  const data = (await res.json()) as { roomId: string };
  return data.roomId;
}
