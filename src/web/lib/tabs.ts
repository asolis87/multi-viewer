import type { Doc } from "./doc.js";
import type { DocResult } from "./api.js";
import type { DocumentTabs } from "../../shared/tabs.js";
import { freshContent, reload, type TypeChoice } from "./typeState.js";
import { diskShown, diskUnreadable, hasEdits, keepEditsOnDisk, type EditState } from "./edit.js";
import { docGate } from "./events.js";
import type { DocType } from "./doc.js";

/**
 * Document tabs (S1–S4, L8): one browser page keeps a view snapshot per document, while the
 * server owns only the file list and the last CLI selection (`GET /api/tabs`).
 *
 * The rules this module encodes:
 * - a browser tab click selects locally; only a new CLI `revision` selects the server's tab;
 * - a `change` broadcast says "some file may have moved", so inactive views go stale and are
 *   fetched when they are selected again (never refetch every document at once);
 * - each view keeps its type choice, unsaved edits and open editor across switches;
 * - only the newest request for the still-selected tab may paint.
 */

export interface TabRef {
  id: string;
  name: string;
}

/** Everything one tab shows. `stale` means the disk may have changed while another tab was shown. */
export interface TabView {
  doc: Doc | null;
  loadError: { message: string; status: number } | null;
  choice: TypeChoice;
  pastedHere: boolean;
  edit: EditState | null;
  editorOpen: boolean;
  stale: boolean;
}

export type TabViews = Record<string, TabView>;

export interface Session {
  tabs: TabRef[];
  /** The tab this browser shows. */
  selected: string | null;
  /** The last CLI revision seen; a disk change does not move it. */
  revision: number;
  views: TabViews;
}

export interface Selection {
  selected: string | null;
  revision: number;
}

export function freshView(detected: DocType = "markdown"): TabView {
  return { doc: null, loadError: null, choice: freshContent(detected), pastedHere: false, edit: null, editorOpen: false, stale: false };
}

/** The strip replaces the file name only with two or more documents (S1, L8). */
export function showsTabs(tabs: readonly TabRef[]): boolean {
  return tabs.length >= 2;
}

/**
 * The CLI selects; the browser does not. A new revision is a CLI attachment or reselection and
 * selects `active`; the same revision is a disk change (or the first read) and keeps the local tab.
 */
export function reconcileSelection(current: Selection, server: DocumentTabs): Selection {
  const ids = server.tabs.map((tab) => tab.id);
  const followed = server.revision !== current.revision;
  const fallback = ids.includes(server.active) ? server.active : (ids[0] ?? null);
  let selected = followed ? server.active : current.selected;
  if (selected === null || !ids.includes(selected)) selected = fallback;
  return { selected, revision: server.revision };
}

/** The first read of a page: follow whatever the CLI selected. */
export function sessionFrom(server: DocumentTabs): Session {
  const selection = reconcileSelection({ selected: null, revision: -1 }, server);
  return {
    tabs: server.tabs.map((tab) => ({ id: tab.id, name: tab.name })),
    selected: selection.selected,
    revision: selection.revision,
    views: {},
  };
}

export function viewFor(session: Session, id: string | null): TabView {
  return id === null ? freshView() : (session.views[id] ?? freshView());
}

export function withView(session: Session, id: string, view: TabView): Session {
  return { ...session, views: { ...session.views, [id]: view } };
}

/** A browser tab click: local only, never a server write and never a revision change. */
export function selectTab(session: Session, id: string): Session {
  if (session.selected === id || !session.tabs.some((tab) => tab.id === id)) return session;
  return { ...session, selected: id };
}

/**
 * A `change` broadcast or a reconnect check. Disk changes do not move the revision, so the local
 * selection stays; every other view is marked stale and is fetched when it is selected again.
 */
export function syncSession(
  session: Session,
  server: DocumentTabs,
  options: { staleInactive?: boolean } = {},
): { session: Session; selected: string | null; selectionChanged: boolean; followed: boolean } {
  const selection = reconcileSelection(session, server);
  let next: Session = {
    tabs: server.tabs.map((tab) => ({ id: tab.id, name: tab.name })),
    selected: selection.selected,
    revision: selection.revision,
    views: session.views,
  };
  const selectionChanged = next.selected !== session.selected;
  // A disk change reloads the tab that stays selected. A CLI selection reloads the tab it selects,
  // so nothing is exempt: every view is stale and the selected one is fetched right away.
  if (options.staleInactive ?? true) next = markStale(next, selectionChanged ? null : next.selected);
  return {
    session: next,
    selected: next.selected,
    selectionChanged,
    followed: next.revision !== session.revision,
  };
}

export function markStale(session: Session, keep: string | null): Session {
  const views: TabViews = {};
  for (const [id, view] of Object.entries(session.views)) {
    // The kept view is the one about to be reloaded; a real edit snapshot is never dropped here.
    views[id] = id === keep ? { ...view, stale: false } : { ...view, stale: true };
  }
  return { ...session, views };
}

/** A view without a document (never loaded, or its file was missing) is fetched when selected. */
export function needsLoad(session: Session, id: string | null): boolean {
  if (id === null) return false;
  const view = session.views[id];
  return view === undefined || view.stale || view.doc === null;
}

/**
 * One document result for one tab view. This is the same gate the single-document page uses
 * (S2, S18): a first load starts fresh, a reload keeps the manual type and — with edits — only
 * moves the disk content and raises the file-changed notice.
 * Callers never pass a pasted view here: pasted content is local and never replaced.
 */
export function loadView(
  view: TabView,
  result: DocResult,
  options: { keepCachedOnOffline?: boolean } = {},
): { view: TabView; first: boolean; keptEdits: boolean } {
  const gate = docGate({
    source: view.doc?.source ?? null,
    pastedHere: view.pastedHere,
    loadStatus: view.loadError?.status ?? null,
    edits: view.edit !== null && hasEdits(view.edit),
  });
  if (gate === "keep-edits" && view.edit) {
    if (result.ok) {
      return {
        view: {
          ...view,
          doc: result.doc,
          loadError: null,
          choice: reload(view.choice, result.doc.type),
          edit: keepEditsOnDisk(view.edit, result.doc.content),
          stale: false,
        },
        first: false,
        keptEdits: true,
      };
    }
    return { view: { ...view, edit: diskUnreadable(view.edit, result.error), stale: false }, first: false, keptEdits: true };
  }
  if (result.ok) {
    const first = view.doc === null;
    return {
      view: {
        ...view,
        doc: result.doc,
        loadError: null,
        choice: first ? freshContent(result.doc.type) : reload(view.choice, result.doc.type),
        edit: view.edit ? diskShown(view.edit, result.doc.content) : null,
        stale: false,
      },
      first,
      keptEdits: false,
    };
  }
  // The viewer keeps loaded tabs readable after its server stops, without masking file read errors.
  if (options.keepCachedOnOffline && result.status === 0 && view.doc && !view.loadError) {
    return { view: { ...view, stale: true }, first: false, keptEdits: false };
  }
  return {
    view: { ...view, loadError: { message: result.error, status: result.status }, stale: false },
    first: false,
    keptEdits: false,
  };
}

export interface LoadRequest {
  seq: number;
  id: string | null;
}

/** A response may paint only when it belongs to the newest request and to the selected tab. */
export function isCurrentLoad(request: LoadRequest, current: LoadRequest): boolean {
  return request.seq === current.seq && request.id === current.id;
}
