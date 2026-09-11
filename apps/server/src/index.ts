import { createTandemServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 1234);
// Defaults to a local file -- no Turso account needed for local dev, libSQL
// speaks plain SQLite when given a file: URL. Production sets DATABASE_URL
// to a libsql://... Turso database instead.
const DATABASE_URL = process.env.DATABASE_URL ?? "file:./data/tandem.sqlite";
const DATABASE_AUTH_TOKEN = process.env.DATABASE_AUTH_TOKEN;
const MAX_ROOM_BYTES = Number(process.env.MAX_ROOM_BYTES ?? 5 * 1024 * 1024);

// Web push needs a VAPID keypair, which identifies this server to the
// browsers' push services. Generate one with:
//   npx web-push generate-vapid-keys
// and set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY. Without them the server runs
// exactly as before and reminders still sync between devices -- they just
// don't ring a phone that has the app closed.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
// Must be a routable mailto: or https: URL. Apple's push service is the
// strict one here -- it rejects the JWT outright (BadJwtToken) for a subject
// pointing at a domain that cannot exist, which a placeholder like
// "mailto:...@tandem.local" does, and the rejection only shows up at send
// time as a failed delivery with no clue attached.
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "https://tandem-lists.vercel.app";

const server = await createTandemServer({
  port: PORT,
  dbUrl: DATABASE_URL,
  dbAuthToken: DATABASE_AUTH_TOKEN,
  maxRoomBytes: MAX_ROOM_BYTES,
  push:
    VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY
      ? { publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY, subject: VAPID_SUBJECT }
      : null,
});
console.log(`tandem sync server listening on :${server.port}`);
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.log("push disabled (no VAPID keys) -- reminders will still sync between open devices");
}

function shutdown(): void {
  console.log("shutting down, flushing pending writes...");
  server.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
