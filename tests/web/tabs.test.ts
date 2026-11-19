import { describe, expect, it } from "vitest";
import {
  freshView,
  isCurrentLoad,
  loadView,
  needsLoad,
  reconcileSelection,
  selectTab,
  sessionFrom,
  showsTabs,
  syncSession,
  viewFor,
  withView,
  type Session,
} from "../../src/web/lib/tabs.js";
import { choose, freshContent } from "../../src/web/lib/typeState.js";
import { startEditing, typed } from "../../src/web/lib/edit.js";
import type { Doc } from "../../src/shared/doc.js";
import type { DocumentTabs } from "../../src/shared/tabs.js";

const SERVER: DocumentTabs = {
  tabs: [
    { id: "a", name: "README.md" },
    { id: "b", name: "notas.md" },
  ],
  active: "a",
  revision: 3,
};

const doc = (name: string, content: string): Doc => ({ name, type: "markdown", content, source: "file" });

const loaded = (name: string, content: string) => ({ ...freshView("markdown"), doc: doc(name, content) });

describe("selection and CLI revision (S2, S1)", () => {
  it("a fresh session selects the tab the CLI selected", () => {
    const session = sessionFrom(SERVER);
    expect(session.selected).toBe("a");
    expect(session.revision).toBe(3);
    expect(viewFor(session, "a").doc).toBeNull();
  });

  it("a browser click selects locally and never moves the CLI revision", () => {
    const session = selectTab(sessionFrom(SERVER), "b");
    expect(session.selected).toBe("b");
    expect(session.revision).toBe(3);
  });

  it("a CLI attachment or reselection (new revision) selects the server tab over the local click", () => {
    const clicked = selectTab(sessionFrom(SERVER), "b");
    const attached = syncSession(clicked, { ...SERVER, active: "a", revision: 4 });
    expect(attached.followed).toBe(true);
    expect(attached.selected).toBe("a");
    expect(attached.selectionChanged).toBe(true);
    expect(attached.session.revision).toBe(4);
  });

  it("reopening the same file (revision increment, same active id) keeps that tab selected", () => {
    const again = syncSession(sessionFrom(SERVER), { ...SERVER, revision: 4 });
    expect(again.followed).toBe(true);
    expect(again.selected).toBe("a");
    expect(again.selectionChanged).toBe(false);
  });

  it("an unknown or missing local tab falls back to the server active tab", () => {
    expect(reconcileSelection({ selected: "gone", revision: 3 }, SERVER).selected).toBe("a");
    expect(reconcileSelection({ selected: null, revision: 3 }, SERVER).selected).toBe("a");
    expect(reconcileSelection({ selected: "b", revision: 3 }, { ...SERVER, active: "b", revision: 4 }).selected).toBe("b");
  });

  it("selecting a tab that is not in the session changes nothing", () => {
    const session = sessionFrom(SERVER);
    expect(selectTab(session, "nope")).toBe(session);
  });
});

describe("the strip is only shown with two or more documents (S1, L8)", () => {
  it("hides for zero or one tab", () => {
    expect(showsTabs([])).toBe(false);
    expect(showsTabs([{ id: "a", name: "README.md" }])).toBe(false);
  });

  it("shows for two or more tabs", () => {
    expect(showsTabs(SERVER.tabs)).toBe(true);
  });
});

describe("live reload across tabs (S3, L8)", () => {
  const withBoth = (): Session => {
    let session = sessionFrom(SERVER);
    session = withView(session, "a", loaded("README.md", "# readme"));
    session = withView(session, "b", loaded("notas.md", "# notas"));
    return selectTab(session, "b");
  };

  it("a disk change (same revision) keeps the local selection and reloads only that tab", () => {
    const outcome = syncSession(withBoth(), { ...SERVER, active: "a", revision: 3 });
    expect(outcome.followed).toBe(false);
    expect(outcome.selectionChanged).toBe(false);
    expect(outcome.selected).toBe("b");
    expect(needsLoad(outcome.session, "b")).toBe(false);
    expect(outcome.session.views.b.stale).toBe(false);
  });

  it("a change while another tab is active marks that tab stale until it is selected again", () => {
    const outcome = syncSession(withBoth(), { ...SERVER, active: "a", revision: 3 });
    expect(outcome.session.views.a.stale).toBe(true);
    expect(needsLoad(outcome.session, "a")).toBe(true);
    expect(needsLoad(outcome.session, "b")).toBe(false);
  });

  it("a CLI selection selects the server tab and marks the previous tab stale", () => {
    const outcome = syncSession(withBoth(), { ...SERVER, active: "a", revision: 4 });
    expect(outcome.selected).toBe("a");
    expect(outcome.session.views.b.stale).toBe(true);
    expect(needsLoad(outcome.session, "a")).toBe(true); // the selected tab is reloaded right away
    expect(needsLoad(outcome.session, "b")).toBe(true);
  });

  it("a tab without a document is loaded when selected", () => {
    const session = sessionFrom(SERVER);
    expect(needsLoad(session, "a")).toBe(true);
    expect(needsLoad(session, null)).toBe(false);
  });
});

describe("per-tab state isolation (S3, L8)", () => {
  it("keeps the type choice, unsaved edits and the open editor of each document", () => {
    const edited = typed(startEditing("# a"), "# a edited");
    let session = sessionFrom(SERVER);
    session = withView(session, "a", {
      ...loaded("README.md", "# a"),
      choice: choose(freshContent("markdown"), "mermaid"),
      edit: edited,
      editorOpen: true,
    });
    session = withView(session, "b", loaded("notas.md", "# b"));

    session = selectTab(session, "b");
    expect(viewFor(session, "b").doc?.content).toBe("# b");
    expect(viewFor(session, "b").choice.override).toBeNull();

    session = selectTab(session, "a");
    const a = viewFor(session, "a");
    expect(a.doc?.content).toBe("# a");
    expect(a.choice.override).toBe("mermaid");
    expect(a.edit?.text).toBe("# a edited");
    expect(a.editorOpen).toBe(true);
    expect(viewFor(session, "b").edit).toBeNull();
  });

  it("a load in one view leaves the other views untouched", () => {
    const before = withView(sessionFrom(SERVER), "b", loaded("notas.md", "# b"));
    const after = withView(before, "a", loadView(freshView(), { ok: true, doc: doc("README.md", "# a") }).view);
    expect(after.views.b).toBe(before.views.b);
    expect(needsLoad(after, "b")).toBe(false);
  });
});

describe("applying a document to one tab view (S3, S18)", () => {
  it("the first document of a tab sets its own type choice", () => {
    const outcome = loadView(freshView("csv"), { ok: true, doc: doc("README.md", "# hi") });
    expect(outcome.first).toBe(true);
    expect(outcome.keptEdits).toBe(false);
    expect(outcome.view.doc?.content).toBe("# hi");
    expect(outcome.view.choice).toEqual({ detected: "markdown", override: null });
    expect(outcome.view.loadError).toBeNull();
  });

  it("a reload updates the detected type but keeps the manual choice", () => {
    const view = { ...loaded("README.md", "# hi"), choice: choose(freshContent("markdown"), "csv") };
    const outcome = loadView(view, { ok: true, doc: doc("README.md", '{"a":1}') });
    expect(outcome.first).toBe(false);
    expect(outcome.view.choice).toEqual({ detected: "markdown", override: "csv" });
  });

  it("a reload with unsaved edits updates only the disk content and raises the file-changed notice", () => {
    const edit = typed(startEditing("# old"), "# mine");
    const outcome = loadView({ ...loaded("README.md", "# old"), edit, editorOpen: true }, { ok: true, doc: doc("README.md", "# new") });
    expect(outcome.keptEdits).toBe(true);
    expect(outcome.view.doc?.content).toBe("# new");
    expect(outcome.view.edit).toMatchObject({ text: "# mine", disk: "# new", notice: { kind: "changed" } });
    expect(outcome.view.editorOpen).toBe(true);
  });

  it("a reload without edits replaces the text of an open editor", () => {
    const edit = startEditing("# old");
    const outcome = loadView({ ...loaded("README.md", "# old"), edit, editorOpen: true }, { ok: true, doc: doc("README.md", "# new") });
    expect(outcome.keptEdits).toBe(false);
    expect(outcome.view.edit).toMatchObject({ text: "# new", disk: "# new", notice: null });
    expect(outcome.view.editorOpen).toBe(true);
  });

  it("a failed reload with edits keeps the edited text, the editor and marks the disk unreadable", () => {
    const edit = typed(startEditing("# old"), "# mine");
    const view = { ...loaded("README.md", "# old"), edit, editorOpen: true };
    const outcome = loadView(view, { ok: false, status: 500, error: "README.md could not be read." });
    expect(outcome.keptEdits).toBe(true);
    expect(outcome.view.doc).toBe(view.doc);
    expect(outcome.view.edit).toMatchObject({ text: "# mine", disk: "# old", notice: { kind: "unreadable", error: "README.md could not be read." } });
  });

  it("keeps a clean cached tab and its editor visible when offline, without changing standalone failures", () => {
    const view = { ...loaded("README.md", "# old"), edit: startEditing("# old"), editorOpen: true, stale: true };
    const offline = { ok: false, status: 0, error: "Offline" } as const;
    expect(loadView(view, offline, { keepCachedOnOffline: true }).view).toEqual(view);
    expect(loadView(view, offline).view.loadError).toEqual({ status: 0, message: "Offline" });
  });

  it("a failed first load records the error without inventing a document", () => {
    const outcome = loadView(freshView(), { ok: false, status: 500, error: "notas.md could not be read." });
    expect(outcome.view.doc).toBeNull();
    expect(outcome.view.loadError).toEqual({ message: "notas.md could not be read.", status: 500 });
    expect(outcome.first).toBe(false);
  });
});

describe("stale in-flight responses cannot paint the wrong document", () => {
  it("only the newest request for the still-selected tab may paint", () => {
    expect(isCurrentLoad({ seq: 3, id: "a" }, { seq: 3, id: "a" })).toBe(true);
    expect(isCurrentLoad({ seq: 2, id: "a" }, { seq: 3, id: "a" })).toBe(false);
    expect(isCurrentLoad({ seq: 3, id: "a" }, { seq: 3, id: "b" })).toBe(false);
    expect(isCurrentLoad({ seq: 3, id: "a" }, { seq: 4, id: null })).toBe(false);
  });
});
