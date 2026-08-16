import QRCode from "qrcode";

// Room ID lives in the URL fragment, not a query param or path segment --
// browsers never send the fragment to the server on navigation or requests
// (same pattern as Firefox Send/Signal), so possession of the link is the
// entire authorization model with nothing for the server to leak.
export function buildInviteLink(roomId: string): string {
  const url = new URL("/join", window.location.origin);
  url.hash = `room=${roomId}`;
  return url.toString();
}

export function parseInviteFragment(hash: string): { roomId: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const roomId = params.get("room");
  return roomId ? { roomId } : null;
}

export async function inviteQrCodeDataUrl(link: string): Promise<string> {
  return QRCode.toDataURL(link, { margin: 1, width: 320 });
}
