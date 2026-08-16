import * as encoding from "lib0/encoding";
import * as Y from "yjs";
import { Awareness, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness.js";
import * as syncProtocol from "y-protocols/sync.js";
import type { WebSocket } from "ws";
import { MESSAGE_AWARENESS, MESSAGE_SYNC } from "./protocol.js";
import type { RoomStore } from "./persistence.js";

export interface Room {
  id: string;
  doc: Y.Doc;
  awareness: Awareness;
  conns: Map<WebSocket, Set<number>>;
  lastActivity: number;
  persistTimer: ReturnType<typeof setTimeout> | null;
}

// Debounced so a burst of edits (e.g. someone rapid-checking off items)
// coalesces into one SQLite write instead of one per field mutation.
const PERSIST_DEBOUNCE_MS = 2_000;
// Rooms with zero open connections are dropped from memory after this long,
// bounding server RAM on the multi-tenant public instance. Persisted state
// on disk is untouched -- reconnecting reloads it.
const IDLE_EVICT_MS = 10 * 60 * 1000;

function broadcast(room: Room, buf: Uint8Array, exclude: WebSocket): void {
  for (const conn of room.conns.keys()) {
    if (conn !== exclude && conn.readyState === conn.OPEN) {
      conn.send(buf);
    }
  }
}

export class RoomRegistry {
  private rooms = new Map<string, Room>();
  private evictTimer: ReturnType<typeof setInterval>;

  constructor(private store: RoomStore) {
    this.evictTimer = setInterval(() => this.evictIdle(), 60_000);
  }

  getOrCreate(roomId: string): Room {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;

    const doc = new Y.Doc();
    const persisted = this.store.load(roomId);
    if (persisted) Y.applyUpdate(doc, persisted, "persistence-load");

    const room: Room = {
      id: roomId,
      doc,
      awareness: new Awareness(doc),
      conns: new Map(),
      lastActivity: Date.now(),
      persistTimer: null,
    };

    // Single room-level listener -- registered once per room, not once per
    // connection, so an update is broadcast exactly once per other peer
    // regardless of how many connections the room has.
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      room.lastActivity = Date.now();
      if (origin === "persistence-load") return; // don't rebroadcast our own load
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      broadcast(room, encoding.toUint8Array(encoder), origin as WebSocket);
      this.schedulePersist(room);
    });

    room.awareness.on(
      "update",
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        // Track which awareness clientIDs belong to which connection, so
        // they can be cleared when that connection closes. Ownership can
        // only be attributed here, where `origin` (the WebSocket that
        // triggered this specific change) is available -- not by scanning
        // all current states from the message handler.
        const originConn = origin as WebSocket | null;
        if (originConn) {
          const owned = room.conns.get(originConn);
          if (owned) {
            for (const clientId of added) owned.add(clientId);
            for (const clientId of removed) owned.delete(clientId);
          }
        }

        const changed = added.concat(updated, removed);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(room.awareness, changed));
        broadcast(room, encoding.toUint8Array(encoder), originConn as WebSocket);
      },
    );

    this.rooms.set(roomId, room);
    return room;
  }

  removeConnection(room: Room, ws: WebSocket): void {
    const clientIds = room.conns.get(ws);
    room.conns.delete(ws);
    if (clientIds && clientIds.size > 0) {
      removeAwarenessStates(room.awareness, Array.from(clientIds), null);
    }
  }

  roomSizeBytes(room: Room): number {
    return Y.encodeStateAsUpdate(room.doc).byteLength;
  }

  private schedulePersist(room: Room): void {
    if (room.persistTimer) return;
    room.persistTimer = setTimeout(() => {
      room.persistTimer = null;
      this.store.save(room.id, Y.encodeStateAsUpdate(room.doc));
    }, PERSIST_DEBOUNCE_MS);
  }

  private evictIdle(): void {
    const now = Date.now();
    for (const [roomId, room] of this.rooms) {
      if (room.conns.size === 0 && now - room.lastActivity > IDLE_EVICT_MS) {
        this.flush(room);
        room.doc.destroy();
        this.rooms.delete(roomId);
      }
    }
  }

  private flush(room: Room): void {
    if (room.persistTimer) {
      clearTimeout(room.persistTimer);
      room.persistTimer = null;
    }
    this.store.save(room.id, Y.encodeStateAsUpdate(room.doc));
  }

  shutdown(): void {
    clearInterval(this.evictTimer);
    for (const room of this.rooms.values()) this.flush(room);
  }
}
