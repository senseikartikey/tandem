import { TextAreaBinding } from "y-textarea";
import type * as Y from "yjs";

// Thin Svelte action wrapper around y-textarea's TextAreaBinding -- it owns
// the actual diff/merge logic (via fast-diff) that turns keystrokes into
// Y.Text insert/delete ops and vice versa, including cursor-position
// preservation on remote updates. Hand-rolling that ourselves would mean
// re-solving the exact fiddly problem (don't jump the caret when text
// changes under you) this library already has a working answer for.
export function bindYText(node: HTMLTextAreaElement, yText: Y.Text) {
  let current = yText;
  let binding = new TextAreaBinding(current, node);
  return {
    update(newYText: Y.Text): void {
      if (newYText === current) return;
      current = newYText;
      binding.destroy();
      binding = new TextAreaBinding(current, node);
    },
    destroy(): void {
      binding.destroy();
    },
  };
}
