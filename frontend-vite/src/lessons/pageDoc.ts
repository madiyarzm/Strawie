/** Plain helpers for lesson page documents (see NotebookPage). */

import * as Y from "yjs";
import type { HomeworkTest } from "./api";

export function readTests(block: Y.Map<unknown>): HomeworkTest[] {
  const arr = block.get("tests") as Y.Array<Y.Map<unknown>> | undefined;
  if (!arr) return [];
  return arr.toArray().map(t => ({
    id: String(t.get("id") ?? ""),
    kind: t.get("kind") === "io" ? "io" : "call",
    call: String(t.get("call") ?? ""),
    expected: String(t.get("expected") ?? ""),
    stdin: String(t.get("stdin") ?? ""),
    hidden: !!t.get("hidden"),
  }));
}

/** Plain snapshot of a page, for submitting. */
export function snapshotBlocks(doc: Y.Doc): { id: string; type: "text" | "code"; text: string }[] {
  return doc.getArray<Y.Map<unknown>>("blocks").toArray().map(b => ({
    id: String(b.get("id")),
    type: b.get("type") === "code" ? "code" : "text",
    text: (b.get("text") as Y.Text | undefined)?.toString() ?? "",
  }));
}
