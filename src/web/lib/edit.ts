/**
 * Edit mode, level 1 (S18): the text lives only in this tab. *The edited text* is what the editor
 * holds; *the disk content* is the last document content the page received (or the content pasted
 * into the page). There are edits while they differ (plain string equality).
 */
import type { DocType } from "./doc.js";
import { exportName } from "./svgExport.js";

export type EditNotice = { kind: "changed" } | { kind: "unreadable"; error: string };

export interface EditState {
  text: string;
  disk: string;
  /** The file changed on disk (or could not be read) while there were edits. */
  notice: EditNotice | null;
}

export function startEditing(disk: string): EditState {
  return { text: disk, disk, notice: null };
}

export function hasEdits(s: EditState): boolean {
  return s.text !== s.disk;
}

/** The notice stays until the edits are discarded or the text equals the disk content again. */
function settle(s: EditState): EditState {
  return hasEdits(s) ? s : { ...s, notice: null };
}

/** Typing in the editor. */
export function typed(s: EditState, text: string): EditState {
  return settle({ ...s, text });
}

/** Live reload or reconnect without edits (`docGate` → `show`): an open editor takes the new text too. */
export function diskShown(_s: EditState, content: string): EditState {
  return startEditing(content);
}

/**
 * Live reload or reconnect with edits (`docGate` → `keep-edits`): only the disk content changes.
 * A change event that brings the same content raises no notice; an existing notice stays.
 */
export function keepEditsOnDisk(s: EditState, content: string): EditState {
  const changed = s.notice !== null || content !== s.disk;
  return settle({ ...s, disk: content, notice: changed ? { kind: "changed" } : null });
}

/** A failed load with edits: the edited text, the editor and the rendered view stay. */
export function diskUnreadable(s: EditState, error: string): EditState {
  return hasEdits(s) ? { ...s, notice: { kind: "unreadable", error } } : s;
}

/** `Discard edits and load the file`. */
export function discardEdits(s: EditState): EditState {
  return startEditing(s.disk);
}

/** What the rendered view shows: the edited text once editing started, else the disk content. */
export function shownContent(s: EditState | null, disk: string): string {
  return s ? s.text : disk;
}

/** `Edit` is offered for Markdown and Mermaid only, never on review pages or the empty paste page. */
export function canEdit(p: { type: DocType; review: boolean; empty: boolean; failed: boolean }): boolean {
  return !p.review && !p.empty && !p.failed && (p.type === "markdown" || p.type === "mermaid");
}

/** Start and end offsets of a 1-based line (clamped), for `Go to line N`. */
export function lineRange(text: string, line: number): [number, number] {
  const lines = text.split("\n");
  const n = Math.min(Math.max(line, 1), lines.length);
  let start = 0;
  for (let i = 0; i < n - 1; i++) start += lines[i].length + 1;
  return [start, start + lines[n - 1].length];
}

/**
 * Download of the edited text (S18): the document name without its extension plus `.md` or `.mmd`
 * by the shown type, through `exportName`; `pasted` for content pasted into the page, `edited` for
 * clipboard or stdin content.
 */
export function editDownload(p: { name: string | null; pastedHere: boolean; type: DocType }): { filename: string; mime: string } {
  const mermaid = p.type === "mermaid";
  return {
    filename: exportName(p.name ?? (p.pastedHere ? "pasted" : "edited"), undefined, mermaid ? "mmd" : "md"),
    mime: mermaid ? "text/plain" : "text/markdown",
  };
}
