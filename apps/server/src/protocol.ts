// Message framing matches the y-websocket wire protocol exactly, so the
// standard y-websocket client-side provider works against this server
// unmodified -- this server exists to swap in real (SQLite) persistence and
// room-lifecycle/eviction logic in place of y-websocket's demo in-memory
// reference server, not to invent a new protocol.
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
