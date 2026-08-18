import { createServer, type Server } from "node:http";
import { WebSocketServer } from "ws";
import { handleHttpRequest } from "./http.js";
import { openRoomStore, type RoomStore } from "./persistence.js";
import { RoomRegistry } from "./rooms.js";
import { handleSignalingConnection } from "./signaling.js";
import { handleConnection } from "./ws-handler.js";

export interface TandemServerOptions {
  port: number;
  // libSQL URL -- "file:..." for local/self-hosted, "libsql://..." for a
  // hosted Turso database. See persistence.ts for why.
  dbUrl: string;
  dbAuthToken?: string;
  maxRoomBytes?: number;
}

export interface TandemServer {
  httpServer: Server;
  registry: RoomRegistry;
  store: RoomStore;
  /** Actual bound port -- useful when `port: 0` requests an ephemeral one. */
  port: number;
  close(): Promise<void>;
}

export async function createTandemServer(options: TandemServerOptions): Promise<TandemServer> {
  const store = await openRoomStore({ url: options.dbUrl, authToken: options.dbAuthToken });
  const registry = new RoomRegistry(store);
  const maxRoomBytes = options.maxRoomBytes ?? 5 * 1024 * 1024;

  const httpServer = createServer((req, res) => {
    handleHttpRequest(req, res).catch((err) => {
      console.error("HTTP request error:", err);
      res.writeHead(500).end();
    });
  });

  // Room ID is the URL path segment (ws://host:port/<roomId>), matching
  // y-websocket's WebsocketProvider default of `serverUrl + '/' + roomname`
  // -- so the standard client works with just `new WebsocketProvider(url,
  // roomId, doc)`, no custom query-param wiring needed on the client side.
  // /signaling is a reserved path checked first, ahead of the room-id
  // fallback, for the separate WebRTC signaling relay (see signaling.ts) --
  // a generic pub/sub protocol unrelated to any single room, so it gets
  // its own WebSocketServer instance rather than being shoehorned into the
  // room one.
  const wss = new WebSocketServer({ noServer: true });
  const signalingWss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", "http://localhost");

    if (url.pathname === "/signaling") {
      signalingWss.handleUpgrade(req, socket, head, (ws) => {
        handleSignalingConnection(ws);
      });
      return;
    }

    const roomId = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!roomId) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      registry.getOrCreate(roomId).then(
        (room) => handleConnection(ws, room, registry, maxRoomBytes),
        (err) => {
          console.error(`failed to load room ${roomId}:`, err);
          ws.close();
        },
      );
    });
  });

  return new Promise((resolve) => {
    httpServer.listen(options.port, () => {
      const address = httpServer.address();
      const boundPort = typeof address === "object" && address ? address.port : options.port;
      resolve({
        httpServer,
        registry,
        store,
        port: boundPort,
        close: async () => {
          // Order matters: flush every room's pending write before closing
          // the DB client, then stop accepting new connections.
          await registry.shutdown();
          await store.close();
          wss.close();
          signalingWss.close();
          await new Promise<void>((res) => httpServer.close(() => res()));
        },
      });
    });
  });
}
