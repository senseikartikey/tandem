import { createTandemServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 1234);
const DATABASE_PATH = process.env.DATABASE_PATH ?? "./data/tandem.sqlite";
const MAX_ROOM_BYTES = Number(process.env.MAX_ROOM_BYTES ?? 5 * 1024 * 1024);

const server = await createTandemServer({
  port: PORT,
  databasePath: DATABASE_PATH,
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
