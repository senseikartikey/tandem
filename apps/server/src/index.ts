import { createTandemServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 1234);
// Defaults to a local file -- no Turso account needed for local dev, libSQL
// speaks plain SQLite when given a file: URL. Production sets DATABASE_URL
// to a libsql://... Turso database instead.
const DATABASE_URL = process.env.DATABASE_URL ?? "file:./data/tandem.sqlite";
const DATABASE_AUTH_TOKEN = process.env.DATABASE_AUTH_TOKEN;
const MAX_ROOM_BYTES = Number(process.env.MAX_ROOM_BYTES ?? 5 * 1024 * 1024);

const server = await createTandemServer({
  port: PORT,
  dbUrl: DATABASE_URL,
  dbAuthToken: DATABASE_AUTH_TOKEN,
  maxRoomBytes: MAX_ROOM_BYTES,
});
console.log(`tandem sync server listening on :${server.port}`);

function shutdown(): void {
  console.log("shutting down, flushing pending writes...");
  server.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
