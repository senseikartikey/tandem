import Database from "better-sqlite3";

// One row per room. The blob is a compacted Y.encodeStateAsUpdate() snapshot
// -- not an append-only update log -- so loading a room is O(1 read), not
// O(updates ever made). Compaction happens in rooms.ts via a debounced write.
export interface RoomStore {
  load(roomId: string): Uint8Array | null;
  save(roomId: string, state: Uint8Array): void;
  close(): void;
}

export function openRoomStore(dbPath: string): RoomStore {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      room_id TEXT PRIMARY KEY,
      state BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  const loadStmt = db.prepare("SELECT state FROM rooms WHERE room_id = ?");
  const saveStmt = db.prepare(`
    INSERT INTO rooms (room_id, state, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
  `);

  return {
    load(roomId: string): Uint8Array | null {
      const row = loadStmt.get(roomId) as { state: Buffer } | undefined;
      return row ? new Uint8Array(row.state) : null;
    },
    save(roomId: string, state: Uint8Array): void {
      saveStmt.run(roomId, Buffer.from(state), Date.now());
    },
    close(): void {
      db.close();
    },
  };
}
