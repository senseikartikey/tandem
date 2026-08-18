import { createClient } from "@libsql/client";

// One row per room. The blob is a compacted Y.encodeStateAsUpdate() snapshot
// -- not an append-only update log -- so loading a room is O(1 read), not
// O(updates ever made). Compaction happens in rooms.ts via a debounced write.
export interface RoomStore {
  load(roomId: string): Promise<Uint8Array | null>;
  save(roomId: string, state: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface RoomStoreOptions {
  // A libSQL URL: "file:./data/tandem.sqlite" for local/self-hosted (no
  // network, no account needed -- libSQL speaks plain SQLite when given a
  // file: URL), or "libsql://<db>.turso.io" for the hosted Turso instance.
  // Swapped in from better-sqlite3 specifically so the compute host can be
  // stateless/scale-to-zero (e.g. Koyeb's free instance) -- durability lives
  // in Turso, not on whatever ephemeral disk the compute happens to have.
  url: string;
  authToken?: string;
}

export async function openRoomStore(options: RoomStoreOptions): Promise<RoomStore> {
  const client = createClient({ url: options.url, authToken: options.authToken });
  await client.execute(`
    CREATE TABLE IF NOT EXISTS rooms (
      room_id TEXT PRIMARY KEY,
      state BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  return {
    async load(roomId: string): Promise<Uint8Array | null> {
      const result = await client.execute({
        sql: "SELECT state FROM rooms WHERE room_id = ?",
        args: [roomId],
      });
      const row = result.rows[0];
      if (!row) return null;
      return new Uint8Array(row.state as ArrayBuffer);
    },
    async save(roomId: string, state: Uint8Array): Promise<void> {
      await client.execute({
        sql: `INSERT INTO rooms (room_id, state, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
        args: [roomId, Buffer.from(state), Date.now()],
      });
    },
    async close(): Promise<void> {
      client.close();
    },
  };
}
