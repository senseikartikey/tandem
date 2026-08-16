// Yjs + y-indexeddb only work client-side, and the whole point of the app is
// that it works with zero network -- which is fundamentally incompatible
// with SSR. Every route is client-rendered only.
export const ssr = false;
export const prerender = false;
