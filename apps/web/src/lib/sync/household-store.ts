import { readHousehold, type HouseholdSnapshot } from "@tandem/doc-schema";
import type * as Y from "yjs";

// A minimal Svelte store: Yjs's plain observe/unobserve callback API maps
// almost 1:1 onto Svelte's store contract (subscribe(fn) -> unsubscribe),
// so no third-party binding library is needed here.
export interface Readable<T> {
  subscribe(run: (value: T) => void): () => void;
}

export function householdStore(doc: Y.Doc): Readable<HouseholdSnapshot> {
  return {
    subscribe(run: (value: HouseholdSnapshot) => void) {
      const update = () => run(readHousehold(doc));
      update();
      doc.on("update", update);
      return () => doc.off("update", update);
    },
  };
}
