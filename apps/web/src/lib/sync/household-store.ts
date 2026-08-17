import { readActivity, readHousehold, type ActivitySnapshot, type HouseholdSnapshot } from "@tandem/doc-schema";
import type * as Y from "yjs";

// A minimal Svelte store: Yjs's plain observe/unobserve callback API maps
// almost 1:1 onto Svelte's store contract (subscribe(fn) -> unsubscribe),
// so no third-party binding library is needed here.
export interface Readable<T> {
  subscribe(run: (value: T) => void): () => void;
}

export interface HouseholdStoreValue {
  household: HouseholdSnapshot;
  activity: ActivitySnapshot[];
}

// household and activity are read from the same "update" event -- an
// activity entry is appended inside the same transact() as the mutation it
// documents, so there is never a moment where you'd want one without the
// other being equally fresh. A single listener recomputing both keeps them
// from ever going one tick out of sync with each other.
export function householdStore(doc: Y.Doc): Readable<HouseholdStoreValue> {
  return {
    subscribe(run: (value: HouseholdStoreValue) => void) {
      const update = () => run({ household: readHousehold(doc), activity: readActivity(doc) });
      update();
      doc.on("update", update);
      return () => doc.off("update", update);
    },
  };
}
