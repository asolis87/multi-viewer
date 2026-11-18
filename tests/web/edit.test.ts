import { describe, expect, it } from "vitest";
import { docGate, reloadOnChange, replaceOnReconnect } from "../../src/web/lib/events.js";
import {
  canEdit,
  discardEdits,
  diskShown,
  diskUnreadable,
  editDownload,
  hasEdits,
  keepEditsOnDisk,
  lineRange,
  shownContent,
  startEditing,
  typed,
} from "../../src/web/lib/edit.js";
import { exportName } from "../../src/web/lib/svgExport.js";

const FILE = { source: "file" as const, pastedHere: false, loadStatus: null };

describe("edits are one more input to the live reload / reconnect gate (S18)", () => {
  it("without edits a change or reconnect shows the document, as today", () => {
    expect(docGate({ ...FILE, edits: false })).toBe("show");
    expect(reloadOnChange({ ...FILE, edits: false })).toBe(true);
    expect(replaceOnReconnect({ ...FILE, edits: false })).toBe(true);
  });

  it("with edits it still reads the file (disk content) but keeps the edited text", () => {
    expect(docGate({ ...FILE, edits: true })).toBe("keep-edits");
    expect(reloadOnChange({ ...FILE, edits: true })).toBe(true);
    expect(replaceOnReconnect({ ...FILE, edits: true })).toBe(true);
  });

  it("pages that never reload still never reload, with or without edits", () => {
    for (const edits of [false, true]) {
      for (const source of ["paste", "stdin", "empty"] as const) {
        expect(docGate({ source, pastedHere: false, loadStatus: null, edits }), `${source} ${edits}`).toBe("ignore");
        expect(reloadOnChange({ source, pastedHere: false, loadStatus: null, edits })).toBe(false);
        expect(replaceOnReconnect({ source, pastedHere: false, loadStatus: null, edits })).toBe(false);
      }
      expect(docGate({ source: "file", pastedHere: true, loadStatus: null, edits })).toBe("ignore");
    }
  });
});

describe("edit state: notice, discard and failed loads (S18)", () => {
  it("starts from the disk content with no edits", () => {
    const s = startEditing("# a\n");
    expect(s).toEqual({ text: "# a\n", disk: "# a\n", notice: null });
    expect(hasEdits(s)).toBe(false);
    expect(hasEdits(typed(s, "# b\n"))).toBe(true);
  });

  it("with no edits live reload replaces the text in an open editor", () => {
    const s = diskShown(startEditing("# a\n"), "# fresh\n");
    expect(s).toEqual({ text: "# fresh\n", disk: "# fresh\n", notice: null });
  });

  it("a change on disk with edits updates the disk content, keeps the text and shows the notice", () => {
    const s = keepEditsOnDisk(typed(startEditing("v1"), "mine"), "v2");
    expect(s.text).toBe("mine");
    expect(s.disk).toBe("v2");
    expect(s.notice).toEqual({ kind: "changed" });
  });

  it("the notice stays while typing and clears when the text equals the disk content again", () => {
    let s = keepEditsOnDisk(typed(startEditing("v1"), "mine"), "v2");
    s = typed(s, "mine, more");
    expect(s.notice).toEqual({ kind: "changed" });
    s = typed(s, "v1"); // equal to the old disk content, not the current one
    expect(s.notice).toEqual({ kind: "changed" });
    s = typed(s, "v2");
    expect(s.notice).toBeNull();
    expect(hasEdits(s)).toBe(false);
  });

  it("the notice clears when the file on disk becomes equal to the edited text", () => {
    let s = keepEditsOnDisk(typed(startEditing("v1"), "mine"), "v2");
    s = keepEditsOnDisk(s, "mine");
    expect(s.notice).toBeNull();
    expect(hasEdits(s)).toBe(false);
  });

  it("a change event with the same content raises no notice", () => {
    const s = keepEditsOnDisk(typed(startEditing("v1"), "mine"), "v1");
    expect(s.notice).toBeNull();
    expect(s.text).toBe("mine");
  });

  it("a failed load with edits keeps the text and the disk content and shows the unreadable notice", () => {
    const s = diskUnreadable(typed(startEditing("v1"), "mine"), "ENOENT: no such file");
    expect(s.text).toBe("mine");
    expect(s.disk).toBe("v1");
    expect(s.notice).toEqual({ kind: "unreadable", error: "ENOENT: no such file" });
    // The file comes back: the notice stays (now "changed") until discard or equality.
    expect(keepEditsOnDisk(s, "v3").notice).toEqual({ kind: "changed" });
  });

  it("discard replaces the edited text with the disk content", () => {
    const s = discardEdits(keepEditsOnDisk(typed(startEditing("v1"), "mine"), "v2"));
    expect(s).toEqual({ text: "v2", disk: "v2", notice: null });
  });
});

describe("Edit is offered only for Markdown and Mermaid (S18)", () => {
  const base = { review: false, empty: false, failed: false };
  it("offers it for Markdown and Mermaid", () => {
    expect(canEdit({ ...base, type: "markdown" })).toBe(true);
    expect(canEdit({ ...base, type: "mermaid" })).toBe(true);
  });
  it("not for JSON or CSV, review pages, the empty paste page or a failed load", () => {
    expect(canEdit({ ...base, type: "json" })).toBe(false);
    expect(canEdit({ ...base, type: "csv" })).toBe(false);
    expect(canEdit({ ...base, type: "markdown", review: true })).toBe(false);
    expect(canEdit({ ...base, type: "markdown", empty: true })).toBe(false);
    expect(canEdit({ ...base, type: "markdown", failed: true })).toBe(false);
  });
});

describe("edits are kept across closing the editor and a type switch (S18)", () => {
  it("the rendered view shows the edited text whatever the editor or the type", () => {
    const s = typed(startEditing("# disk"), "# edited");
    expect(shownContent(s, "# disk")).toBe("# edited");
    // Closing the editor or switching to JSON does not touch the edit state; only Edit's availability changes.
    expect(canEdit({ type: "json", review: false, empty: false, failed: false })).toBe(false);
    expect(shownContent(s, "# disk")).toBe("# edited");
    expect(shownContent(null, "# disk")).toBe("# disk");
  });
});

describe("Go to line N selects that line in the editor (S18, L99)", () => {
  it("returns the start and end offsets of a 1-based line", () => {
    const text = "flowchart TD\n  a --> b\n  b -->|x c\n";
    expect(lineRange(text, 1)).toEqual([0, 12]);
    expect(lineRange(text, 3)).toEqual([23, 34]);
    expect(text.slice(...lineRange(text, 2))).toBe("  a --> b");
  });
  it("clamps lines past the end", () => {
    expect(lineRange("a\nb", 9)).toEqual([2, 3]);
    expect(lineRange("a\nb", 0)).toEqual([0, 1]);
  });
});

describe("download names (S18)", () => {
  it("exportName takes an extension; SVG names are unchanged", () => {
    expect(exportName("notes.markdown", undefined, "md")).toBe("notes.md");
    expect(exportName("x.txt", undefined, "mmd")).toBe("x.mmd");
    expect(exportName("README.md", "diagram-2")).toBe("README-diagram-2.svg");
    expect(exportName(null)).toBe("diagram.svg");
  });

  it("names the file by the document name and the shown type", () => {
    expect(editDownload({ name: "notes.markdown", pastedHere: false, type: "markdown" }).filename).toBe("notes.md");
    expect(editDownload({ name: "x.txt", pastedHere: false, type: "mermaid" }).filename).toBe("x.mmd");
    expect(editDownload({ name: "flow.mmd", pastedHere: false, type: "markdown" }).filename).toBe("flow.md");
  });

  it("uses `pasted` for content pasted into the page and `edited` for clipboard or stdin", () => {
    expect(editDownload({ name: null, pastedHere: true, type: "markdown" }).filename).toBe("pasted.md");
    expect(editDownload({ name: null, pastedHere: false, type: "mermaid" }).filename).toBe("edited.mmd");
    expect(editDownload({ name: null, pastedHere: false, type: "markdown" }).filename).toBe("edited.md");
  });
});
