// "Which households am I in" lives only in client-side storage -- the
// server has no user table and no concept of accounts. Losing this device's
// storage loses the *list of* households (not their data, which the server
// and other devices still hold) -- recoverable by re-sharing an invite link.
export interface KnownHousehold {
  roomId: string;
  name: string;
  lastOpened: number;
}

const STORAGE_KEY = "tandem:households";

function hasLocalStorage(): boolean {
  return typeof localStorage !== "undefined";
}

export function listKnownHouseholds(): KnownHousehold[] {
  if (!hasLocalStorage()) return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as KnownHousehold[];
    return parsed.sort((a, b) => b.lastOpened - a.lastOpened);
  } catch {
    return [];
  }
}

export function rememberHousehold(roomId: string, name: string): void {
  if (!hasLocalStorage()) return;
  const known = listKnownHouseholds().filter((h) => h.roomId !== roomId);
  known.unshift({ roomId, name, lastOpened: Date.now() });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(known));
}

export function forgetHousehold(roomId: string): void {
  if (!hasLocalStorage()) return;
  const known = listKnownHouseholds().filter((h) => h.roomId !== roomId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(known));
}

const DEVICE_LABEL_KEY = "tandem:device-label";

export function getDeviceLabel(): string {
  if (!hasLocalStorage()) return "device";
  let label = localStorage.getItem(DEVICE_LABEL_KEY);
  if (!label) {
    label = `device-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(DEVICE_LABEL_KEY, label);
  }
  return label;
}

export function setDeviceLabel(label: string): void {
  if (!hasLocalStorage()) return;
  localStorage.setItem(DEVICE_LABEL_KEY, label);
}
