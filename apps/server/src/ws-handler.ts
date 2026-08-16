import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness.js";
import * as syncProtocol from "y-protocols/sync.js";
import type { WebSocket } from "ws";
import { MESSAGE_AWARENESS, MESSAGE_SYNC } from "./protocol.js";
import type { Room, RoomRegistry } from "./rooms.js";

// Abuse guardrail for the public multi-tenant instance: a household's
// shared-list data has no legitimate reason to approach this size. Self-
// hosters running for one trusted household can raise this via env var.
const DEFAULT_MAX_ROOM_BYTES = 5 * 1024 * 1024;

export function handleConnection(
  ws: WebSocket,
  room: Room,
  registry: RoomRegistry,
  maxRoomBytes = DEFAULT_MAX_ROOM_BYTES,
): void {
  room.conns.set(ws, new Set());

  const send = (buf: Uint8Array): void => {
    if (ws.readyState === ws.OPEN) ws.send(buf);
  };

  // Sync step 1: tell the new peer our state vector so it can compute and
  // send back only what we're missing (not its whole document).
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    send(encoding.toUint8Array(encoder));
  }

  const awarenessStates = room.awareness.getStates();
  if (awarenessStates.size > 0) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(awarenessStates.keys())),
    );
    send(encoding.toUint8Array(encoder));
  }

  ws.on("message", (data: ArrayBuffer | Buffer | Buffer[]) => {
    const message =
      data instanceof Buffer ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer);
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case MESSAGE_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        // Applies any incoming update to room.doc (origin = ws, used by
        // rooms.ts's broadcast to avoid echoing back to the sender) and, if
        // this was a sync-step-1 request, writes a step-2 reply.
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws);
        if (encoding.length(encoder) > 1) send(encoding.toUint8Array(encoder));

        if (registry.roomSizeBytes(room) > maxRoomBytes) {
          ws.close(1009, "room size limit exceeded");
        }
        break;
      }
      case MESSAGE_AWARENESS: {
        // Passing `ws` as origin lets rooms.ts's awareness "update" listener
        // attribute the resulting clientIDs to this connection (see rooms.ts).
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws);
        break;
      }
    }
  });

  ws.on("close", () => registry.removeConnection(room, ws));
  ws.on("error", () => registry.removeConnection(room, ws));
}
