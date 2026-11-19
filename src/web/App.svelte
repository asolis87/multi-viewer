<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import Toolbar from "./components/Toolbar.svelte";
  import { applyTheme, resolveDark, type ThemeChoice } from "./lib/theme.js";
  import Sidebar from "./components/Sidebar.svelte";
  import StatusBar from "./components/StatusBar.svelte";
  import MarkdownView from "./components/MarkdownView.svelte";
  import MermaidView from "./components/MermaidView.svelte";
  import JsonView from "./components/JsonView.svelte";
  import CsvView from "./components/CsvView.svelte";
  import PasteView from "./components/PasteView.svelte";
  import LoadError from "./components/LoadError.svelte";
  import ReviewView from "./components/ReviewView.svelte";
  import EditorPane from "./components/EditorPane.svelte";
  import { fetchDoc, postReview, readToken, watchEvents } from "./lib/api.js";
  import type { DocResult } from "./lib/api.js";
  import { closeWhenHidden, keepEventsOpen, liveStatus, reloadOnChange, replaceOnReconnect, type Connection } from "./lib/events.js";
  import {
    canEdit,
    discardEdits,
    editDownload,
    hasEdits,
    shownContent,
    startEditing,
    typed,
    type EditState,
  } from "./lib/edit.js";
  import {
    isCurrentLoad,
    loadView,
    needsLoad,
    selectTab as selectTabInSession,
    sessionFrom,
    showsTabs,
    syncSession,
    viewFor,
    withView,
    type Session,
    type TabView,
  } from "./lib/tabs.js";
  import type { DocumentTabs } from "../shared/tabs.js";
  import { buildSubmission, clearDrafts, loadDrafts, noteContent, saveDrafts, type DraftState, type ReviewAction, type ReviewControls } from "./lib/review.js";
  import { detectType, type Doc } from "./lib/doc.js";
  import { choose, effectiveType, freshContent, selectValue, TYPE_LABEL, type SelectValue, type TypeChoice } from "./lib/typeState.js";
  import { renderMarkdown, type DiagramBlock } from "./lib/markdown.js";
  import { collapsibleOutline, copyText, themeBackground, type SideItem, type SideOutline } from "./lib/ui.js";
  import { downloadText, exportName, serializeSvg } from "./lib/svgExport.js";

  const token = readToken(location.search);

  // Session reads (S1–S4, L8): the tab list and one opaque document at a time. The browser never
  // writes the CLI selection; these are GETs, and a 404 on /api/tabs means a legacy or review page.
  const OFFLINE = "Can’t reach the mview server. Is the command still running?";
  const BAD_TOKEN = "This page needs the link printed by mview (the access token is missing or wrong).";
  type TabsRead = { ok: true; tabs: DocumentTabs } | { ok: false; error: string; status: number };

  /** One token-protected GET; the status decides even when the body is not JSON. */
  async function readJson(path: string): Promise<{ status: number; body: unknown }> {
    try {
      const res = await fetch(path, { cache: "no-store" });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* the callers use the status */
      }
      return { status: res.status, body };
    } catch {
      return { status: 0, body: null };
    }
  }

  function errorMessage(status: number, body: unknown): string {
    const error = (body as { error?: unknown } | null)?.error;
    return typeof error === "string" ? error : `The server answered ${status}.`;
  }

  async function readTabs(): Promise<TabsRead> {
    const res = await readJson(`/api/tabs?t=${encodeURIComponent(token)}`);
    if (res.status === 0) return { ok: false, status: 0, error: OFFLINE };
    if (res.status === 403) return { ok: false, status: 403, error: BAD_TOKEN };
    if (res.status !== 200) return { ok: false, status: res.status, error: errorMessage(res.status, res.body) };
    return { ok: true, tabs: res.body as DocumentTabs };
  }

  async function readTabDoc(id: string): Promise<DocResult> {
    const res = await readJson(`/api/doc?t=${encodeURIComponent(token)}&d=${encodeURIComponent(id)}`);
    if (res.status === 0) return { ok: false, status: 0, error: OFFLINE };
    if (res.status === 403) return { ok: false, status: 403, error: BAD_TOKEN };
    if (res.status === 404) return { ok: false, status: 404, error: "This document is no longer open in mview." };
    if (res.status !== 200) return { ok: false, status: res.status, error: errorMessage(res.status, res.body) };
    return { ok: true, doc: res.body as Doc };
  }

  let doc = $state<Doc | null>(null);
  let loadError = $state<{ message: string; status: number } | null>(null);
  /** Content pasted into this tab (never sent to the server). */
  let pastedHere = $state(false);
  let choice = $state<TypeChoice>(freshContent("markdown"));
  let connection = $state<Connection>("connecting");
  let canvasDiagram = $state<DiagramBlock | null>(null);
  let outline = $state<SideOutline>({ sub: "", foot: "", items: [], empty: "" });
  let active = $state<string | null>(null);
  let statusOverride = $state<string | null>(null);
  let zoom = $state<number | null>(null);
  let lastCopied = $state<string | null>(null);
  let message = $state("");
  let systemDark = $state(false);
  let theme = $state<ThemeChoice>("system");
  const dark = $derived(resolveDark(theme, systemDark));
  $effect(() => applyTheme(theme, document.documentElement));
  let narrow = $state(false);
  let drawerOpen = $state(false);
  /** Wide screens, CSV only (S13, L38): the outline column starts collapsed. */
  let outlineOpen = $state(false);
  /**
   * Document tabs (S1–S4, L8): null on standalone and review pages, which keep one document.
   * Each view keeps its own type choice, edits and editor; only the CLI revision moves the selection.
   */
  let session = $state<Session | null>(null);
  /** The shown view still needs its tab document (a change arrived while it was inactive). */
  let viewStale = $state(false);

  let mainEl: HTMLElement | undefined = $state();
  let outlineButton: HTMLButtonElement | undefined = $state();
  let sidebarEl: HTMLElement | undefined = $state();
  let markdownView: MarkdownView | undefined = $state();
  let mermaidView: MermaidView | undefined = $state();
  let jsonView: JsonView | undefined = $state();
  let csvView: CsvView | undefined = $state();
  let reviewView: ReviewView | undefined = $state();
  let editorPane: EditorPane | undefined = $state();
  let editButton: HTMLButtonElement | undefined = $state();

  // Review mode (S17): only pages whose Doc has `review: true`.
  /** The tab's sessionStorage (drafts, L84); null when the browser denies it. */
  const tabStorage: Storage | null = (() => {
    try {
      return sessionStorage;
    } catch {
      return null;
    }
  })();
  let drafts = $state<DraftState | null>(null);
  let sent = $state(false);
  let submitting = $state(false);

  const type = $derived(effectiveType(choice));
  const isEmpty = $derived(doc !== null && doc.source === "empty" && !pastedHere);
  /** CSV documents on screen get the collapsible outline; every other view keeps today's sidebar. */
  const collapsible = $derived(!!doc && !isEmpty && !loadError && !canvasDiagram && collapsibleOutline(type));
  const tabName = $derived(session?.tabs.find((tab) => tab.id === session?.selected)?.name ?? null);
  const name = $derived.by(() => {
    if (!doc) return tabName ?? "mview";
    if (doc.name) return doc.name;
    if (pastedHere) return "Pasted content";
    return { file: "file", paste: "Clipboard", stdin: "stdin", empty: "Untitled" }[doc.source];
  });
  const tabStrip = $derived(
    session && showsTabs(session.tabs) ? { items: session.tabs, selected: session.selected, onselect: selectTab } : null,
  );
  const sourceLabel = $derived(
    pastedHere ? "pasted" : doc ? { file: "file", paste: "clipboard", stdin: "stdin", empty: "no input" }[doc.source] : "…",
  );
  const watching = $derived(doc?.source === "file" && !pastedHere);

  const reviewPage = $derived(doc?.review === true && !pastedHere);

  // Edit mode (S18, level 1): the edited text lives only in this tab. `edit` is created by the first
  // `Edit` and kept when the editor closes or the type changes; only discard or a tab reload drop it.
  let edit = $state<EditState | null>(null);
  let editorOpen = $state(false);
  const editable = $derived(!!doc && canEdit({ type, review: reviewPage, empty: isEmpty, failed: !!loadError }));
  const editorShown = $derived(editorOpen && editable && !!edit);
  const edits = $derived(!!edit && hasEdits(edit));
  /** What the rendered view shows: the edited text once editing started (S18). */
  const shown = $derived(doc ? shownContent(edit, doc.content) : "");
  /** While editing, the outline is an overlay behind the Outline button (the drawer), as on narrow screens. */
  const drawerMode = $derived(narrow || editorShown);
  const outlineExpanded = $derived(drawerMode ? drawerOpen : collapsible && outlineOpen);
  const editsText = $derived(
    edits && editable
      ? `in this tab · not saved${edit?.notice ? (edit.notice.kind === "changed" ? " · file changed on disk" : " · file could not be read") : ""}`
      : null,
  );

  const live = $derived(
    liveStatus({ source: doc?.source ?? null, name, hasDoc: !!doc, loadFailed: !!loadError, pastedHere, connection, sent: reviewPage && sent }),
  );

  const typeText = $derived.by(() => {
    if (loadError) return "Type: —";
    if (!doc) return "Loading…";
    if (isEmpty) return "Type: waiting for paste";
    if (statusOverride) return statusOverride;
    if (reviewPage) return `${TYPE_LABEL[type]} · review`;
    return `${TYPE_LABEL[type]} · ${choice.override ? "manual" : "auto-detected"}`;
  });

  const commentCount = $derived(drafts?.comments.length ?? 0);
  const commentsText = $derived(
    reviewPage ? (commentCount ? `${commentCount} ${commentCount === 1 ? "comment" : "comments"}` : "No comments") : null,
  );

  // Drafts live in this tab until the review is sent (S17, L84).
  $effect(() => {
    if (!reviewPage || !drafts || sent) return;
    saveDrafts(tabStorage, token, $state.snapshot(drafts) as DraftState);
  });

  function markSent() {
    if (sent) return;
    sent = true;
    clearDrafts(tabStorage, token);
  }

  async function submit(action: ReviewAction) {
    if (sent || submitting || !drafts) return;
    const body = buildSubmission(action, $state.snapshot(drafts.comments) as DraftState["comments"]);
    if (!body) return;
    submitting = true;
    const result = await postReview(token, body);
    submitting = false;
    if (result.ok || result.status === 409) {
      // 409: this run's review was already sent (from another tab); the page is read-only either way.
      markSent();
      announce("");
    } else {
      announce(`Couldn’t send the review: ${result.error}`);
    }
  }

  const reviewControls = $derived<ReviewControls | null>(
    reviewPage
      ? { count: commentCount, sent, busy: submitting, onrequest: () => void submit("request"), onapprove: () => void submit("approve") }
      : null,
  );

  let seq = 0;
  /** Metadata requests (tab list and CLI selection) are latest-wins too. */
  let metaSeq = 0;

  /** The live state of the shown document, as one view snapshot. */
  function viewNow(): TabView {
    return { doc, loadError, choice, pastedHere, edit, editorOpen, stale: viewStale };
  }

  function writeView(view: TabView) {
    doc = view.doc;
    loadError = view.loadError;
    choice = view.choice;
    pastedHere = view.pastedHere;
    edit = view.edit;
    editorOpen = view.editorOpen;
    viewStale = view.stale;
  }

  /** Keep the shown document's snapshot for the switch back (S1–S4, L8). */
  function saveView() {
    if (session?.selected) session = withView(session, session.selected, viewNow());
  }

  /** Show another document; per-page derived state (outline, canvas, zoom) belongs to the new one. */
  function showView(view: TabView) {
    writeView(view);
    canvasDiagram = null;
    active = null;
    statusOverride = null;
    zoom = null;
    outline = { sub: "", foot: "", items: [], empty: "" };
  }

  /** Standalone and review pages: today's single document route. */
  async function load() {
    const mine = ++seq;
    const result = await fetchDoc(token);
    if (mine !== seq || pastedHere) return;
    apply(result);
  }

  /** The first read: the session's active tab when `/api/tabs` exists, the plain document otherwise. */
  async function start() {
    const result = await readTabs();
    if (!result.ok || result.tabs.tabs.length === 0) {
      void load();
      return;
    }
    enterSession(result.tabs);
  }

  function enterSession(server: DocumentTabs): string | null {
    seq++; // a plain-document response must not paint over the session
    session = sessionFrom(server);
    showView(viewFor(session, session.selected));
    void loadSelected({ announceReload: false });
    return session.selected;
  }

  async function loadSelected(options: { announceReload: boolean }) {
    const id = session?.selected ?? null;
    if (id === null || pastedHere) return;
    const mine = ++seq;
    const result = await readTabDoc(id);
    // A stale response for another tab (or an older request) can never paint.
    if (pastedHere || !isCurrentLoad({ seq: mine, id }, { seq, id: session?.selected ?? null })) return;
    apply(result, options);
  }

  /** A browser tab click: local only; the server selection and revision are untouched. */
  function selectTab(id: string) {
    if (!session || session.selected === id) return;
    saveView();
    session = selectTabInSession(session, id);
    showView(viewFor(session, id));
    if (!pastedHere && needsLoad(session, id)) void loadSelected({ announceReload: false });
  }

  /** Apply the server's tab metadata: a new CLI revision selects; a disk change keeps the local tab. */
  function takeSession(server: DocumentTabs): { id: string | null; followed: boolean } {
    if (!session) return { id: enterSession(server), followed: true };
    saveView();
    const before = session.selected;
    const followed = server.revision !== session.revision;
    const outcome = syncSession(session, server);
    session = outcome.session;
    if (outcome.selected !== before) showView(viewFor(session, outcome.selected));
    return { id: outcome.selected, followed };
  }

  function apply(result: DocResult, options: { announceReload?: boolean } = {}) {
    const outcome = loadView(viewNow(), result, { keepCachedOnOffline: session !== null });
    writeView(outcome.view);
    const shownDoc = outcome.view.doc;
    if (result.ok && !outcome.keptEdits && shownDoc?.review && !outcome.view.pastedHere) {
      // The first content this tab saw is the base; any later content turns the file-changed notice on.
      drafts = drafts ? noteContent(drafts, shownDoc.content) : loadDrafts(tabStorage, token, shownDoc.content);
    }
    if ((options.announceReload ?? true) && result.ok && !outcome.first && !outcome.keptEdits && shownDoc?.source === "file") {
      announce(`Reloaded ${shownDoc.name ?? "file"} · ${new Date().toTimeString().slice(0, 8)}`);
    }
    saveView();
  }

  let msgTimer: ReturnType<typeof setTimeout> | undefined;
  function announce(text: string) {
    message = text;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => (message = ""), 3000);
  }

  async function copy(text: string, label: string): Promise<boolean> {
    const ok = await copyText(text);
    if (ok) {
      lastCopied = label;
      announce(`Copied ${label}`);
    } else {
      announce("Copy failed: the browser blocked clipboard access");
    }
    return ok;
  }

  // Edit mode (S18): Copy and Download of the edited text, from the editor column.
  function copyEdited() {
    if (edit) void copy(edit.text, "edited text");
  }

  function downloadEdited() {
    if (!edit || !doc) return;
    const { filename, mime } = editDownload({ name: doc.name, pastedHere, type });
    downloadText(edit.text, filename, mime);
    announce(`Downloaded ${filename}`);
  }

  async function openEditor() {
    if (!doc) return;
    edit ??= startEditing(doc.content);
    editorOpen = true;
    await tick();
    editorPane?.focus();
  }

  async function closeEditor() {
    editorOpen = false;
    if (!narrow) drawerOpen = false;
    await tick();
    editButton?.focus();
  }

  function toggleEditor() {
    if (editorShown) void closeEditor();
    else void openEditor();
  }

  /** `Discard edits and load the file`: the disk content replaces the edited text, then the file is read again (S2's error if it fails). */
  function discardAndLoad() {
    if (!edit) return;
    edit = discardEdits(edit);
    if (session) void loadSelected({ announceReload: false });
    else void load();
  }

  /** Retry the failed document: the selected tab in a session, the plain document otherwise. */
  function retry() {
    if (session) void loadSelected({ announceReload: false });
    else void load();
  }

  /** `Go to line N` on a Mermaid parse error while editing (S18, L99). */
  async function goToLine(line: number) {
    if (!editorShown) await openEditor();
    await tick();
    await editorPane?.goToLine(line);
  }

  function exportSvg(svg: SVGSVGElement, suffix?: string) {
    const filename = exportName(doc?.name ?? (pastedHere ? "pasted" : null), suffix);
    downloadText(serializeSvg(svg, themeBackground()), filename, "image/svg+xml");
    announce(`Exported ${filename}`);
  }

  function onSelect(value: SelectValue) {
    choice = choose(choice, value);
    canvasDiagram = null;
    active = null;
  }

  async function onPasted(text: string) {
    const detected = detectType(text);
    pastedHere = true;
    seq++; // ignore any in-flight server response
    doc = { name: null, type: detected, content: text, source: "paste" };
    edit = null;
    editorOpen = false;
    choice = freshContent(detected);
    announce(`Rendered pasted content as ${TYPE_LABEL[detected]}`);
    saveView();
    await tick();
    mainEl?.focus();
  }

  // Outline plumbing: views publish their outline/active item; the sidebar asks a view to reveal.
  function setOutline(next: SideOutline) {
    outline = next;
  }
  function setActive(id: string | null) {
    active = id;
  }
  function setStatus(text: string | null) {
    statusOverride = text;
  }
  function setZoom(pct: number | null) {
    zoom = pct;
  }

  function pick(item: SideItem) {
    active = item.id;
    if (drawerMode && drawerOpen) setDrawer(false, false);
    if (canvasDiagram) mermaidView?.reveal(item.id, item.label);
    else if (type === "markdown") (reviewPage ? reviewView : markdownView)?.reveal(item.id);
    else if (type === "mermaid") mermaidView?.reveal(item.id, item.label);
    else if (type === "json") jsonView?.reveal(item.id);
    else if (type === "csv") csvView?.reveal(item.id);
  }

  let canvasReturn: string | null = null;
  function openCanvas(d: DiagramBlock) {
    canvasReturn = d.id;
    canvasDiagram = d;
  }
  async function closeCanvas() {
    canvasDiagram = null;
    await tick();
    await tick();
    if (canvasReturn) markdownView?.reveal(canvasReturn);
  }

  // Drawer (under 900px): Escape/backdrop close it and focus returns to the Outline button.
  async function setDrawer(open: boolean, returnFocus = true) {
    drawerOpen = open;
    await tick();
    if (open) (sidebarEl?.querySelector<HTMLElement>(".outline button") ?? sidebarEl)?.focus();
    else if (returnFocus) outlineButton?.focus();
  }

  // Wide-screen CSV outline: the Outline button opens and closes the column (focus like the drawer).
  async function setOutlineColumn(open: boolean) {
    outlineOpen = open;
    await tick();
    if (open) (sidebarEl?.querySelector<HTMLElement>(".outline button") ?? sidebarEl)?.focus();
    else outlineButton?.focus();
  }

  function toggleOutline() {
    if (drawerMode) void setDrawer(!drawerOpen);
    else if (collapsible) void setOutlineColumn(!outlineOpen);
  }

  onMount(() => {
    const darkQuery = matchMedia("(prefers-color-scheme: dark)");
    const narrowQuery = matchMedia("(max-width: 899px)");
    systemDark = darkQuery.matches;
    narrow = narrowQuery.matches;
    const onDark = () => (systemDark = darkQuery.matches);
    const onNarrow = () => {
      narrow = narrowQuery.matches;
      if (!narrow) drawerOpen = false;
    };
    darkQuery.addEventListener("change", onDark);
    narrowQuery.addEventListener("change", onNarrow);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drawerOpen) {
        e.preventDefault();
        void setDrawer(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      darkQuery.removeEventListener("change", onDark);
      narrowQuery.removeEventListener("change", onNarrow);
      document.removeEventListener("keydown", onKey);
    };
  });

  onMount(() => {
    void start();
  });

  // The events stream stays open for every source and after a paste (S11: it is how --auto-close
  // knows this page is open). Only a watched file refetches on `change` (live reload, S2).
  const eventsOpen = $derived(
    keepEventsOpen({ token, loadStatus: loadError?.status ?? null, source: doc?.source ?? null, pastedHere, sent }),
  );
  function onEventsChange() {
    if (session) {
      void refreshTabs();
      return;
    }
    if (reloadOnChange({ source: doc?.source ?? null, pastedHere, loadStatus: loadError?.status ?? null, edits })) void load();
  }

  /** One `change` broadcast: read the metadata, follow a new CLI selection, reload only the selected tab. */
  async function refreshTabs() {
    if (!session) return;
    const mine = ++metaSeq;
    const result = await readTabs();
    if (mine !== metaSeq || !session) return;
    if (!result.ok) {
      // 0 and 403 are handled by the connection state; any other answer still reloads the shown tab.
      if (result.status === 0 || result.status === 403) return;
      void loadSelected({ announceReload: true });
      return;
    }
    const { id, followed } = takeSession(result.tabs);
    if (id === null || pastedHere) return;
    // A disk change (same revision) announces the reload; a CLI selection selects silently.
    void loadSelected({ announceReload: !followed });
  }

  /**
   * Reconnect in a session: read the metadata (the CLI may have attached or reselected while the
   * page was hidden), then fetch only the selected tab. The document the reconnect check carried is
   * the initial one, so it is not painted over another tab.
   */
  async function reconnectSession() {
    const mine = ++metaSeq;
    const result = await readTabs();
    if (mine !== metaSeq || !session) return;
    if (!result.ok) return; // a dead server is reported by the connection state
    const { id } = takeSession(result.tabs);
    if (id === null || pastedHere) return;
    await loadSelected({ announceReload: false });
  }

  // Reconnect (S14): only a watched file page takes the fresh document; pasted, stdin and empty
  // pages keep their content.
  function onReconnectDoc(fresh: Doc) {
    if (session) {
      if (!pastedHere) void reconnectSession();
      return;
    }
    if (!replaceOnReconnect({ source: doc?.source ?? null, pastedHere, loadStatus: loadError?.status ?? null, edits })) return;
    seq++; // this response is newer than any in-flight load
    apply({ ok: true, doc: fresh });
  }
  $effect(() => {
    if (!eventsOpen) return;
    return watchEvents(token, {
      onChange: onEventsChange,
      onDoc: onReconnectDoc,
      onConnection: (c) => (connection = c),
      // S17: every open page of the run becomes read-only when the review is sent.
      onSubmitted: () => {
        if (doc?.review) markSent();
      },
      // Read when the hidden-tab rule is checked (the review flag arrives with the document).
      closeWhenHidden: () => untrack(() => closeWhenHidden({ review: doc?.review })),
    });
  });

  // Keep an open diagram canvas in sync with the shown text (live reload or typing), or close it if the diagram is gone.
  $effect(() => {
    const text = shown;
    const markdown = type === "markdown";
    untrack(() => {
      if (!canvasDiagram) return;
      const id = canvasDiagram.id;
      const next = markdown ? (renderMarkdown(text).diagrams.find((d) => d.id === id) ?? null) : null;
      if (!next || next.source !== canvasDiagram.source || next.keyword !== canvasDiagram.keyword) canvasDiagram = next;
    });
  });

  $effect(() => {
    if (!doc || isEmpty || loadError) {
      outline = {
        sub: "",
        foot: "",
        items: [],
        empty: isEmpty ? "Nothing to outline yet. Paste content to see its headings, keys or participants." : "",
      };
    }
  });

  const loadTitle = $derived(
    loadError?.status === 500 ? `Can’t read ${doc?.name ?? "the document"}` : "Can’t load the document",
  );
  const loadHint = $derived(
    loadError?.status === 500 && doc?.source === "file"
      ? "The file is still being watched. Restore or fix it and this page updates automatically."
      : loadError?.status === 403
        ? "Run mview again and open the link it prints."
        : "Check that the mview command is still running, then try again.",
  );
  /** The active tab's position, for the `tabpanel` label the strip points at (tabs mode only). */
  const selectedTabIndex = $derived(session?.tabs.findIndex((tab) => tab.id === session?.selected) ?? -1);
</script>

<Toolbar
  {name}
  {sourceLabel}
  detected={doc && !isEmpty && !loadError ? choice.detected : null}
  value={selectValue(choice)}
  drawerOpen={outlineExpanded}
  outlineAlways={collapsible || editorShown}
  bind:outlineButton
  ontoggleoutline={toggleOutline}
  onselect={onSelect}
  {theme}
  ontheme={(t) => (theme = t)}
  review={reviewControls}
  edit={editable ? { open: editorShown, edited: edits, ontoggle: toggleEditor } : null}
  bind:editButton
  outlineTitle={editorShown ? "Show or hide the outline" : undefined}
  tabs={tabStrip}
/>

<div class="workspace" class:drawer-open={drawerOpen} class:collapsible class:outline-open={collapsible && outlineOpen} class:editing={editorShown}>
  <Sidebar {outline} {active} inert={collapsible && !narrow && !outlineOpen} bind:element={sidebarEl} onpick={pick} />
  {#if drawerOpen}
    <div class="backdrop" aria-hidden="true" onclick={() => setDrawer(false)}></div>
  {/if}

  {#if editorShown && edit}
    <EditorPane
      bind:this={editorPane}
      title="{name} · {TYPE_LABEL[type]}"
      {name}
      text={edit.text}
      notice={edit.notice}
      oninput={(text) => {
        if (edit) edit = typed(edit, text);
      }}
      oncopy={copyEdited}
      ondownload={downloadEdited}
      onclose={closeEditor}
      ondiscard={discardAndLoad}
    />
  {/if}

  <main
    id={tabStrip ? "doc-panel" : undefined}
    bind:this={mainEl}
    tabindex="-1"
    role={tabStrip ? "tabpanel" : undefined}
    aria-labelledby={tabStrip && selectedTabIndex >= 0 ? `tab-${selectedTabIndex}` : undefined}
  >
    {#if loadError}
      <LoadError title={loadTitle} message={loadError.message} hint={loadHint} onretry={retry} />
    {:else if !doc || !mainEl}
      <p class="loading" role="status">Loading…</p>
    {:else if isEmpty}
      <PasteView onrender={onPasted} />
    {:else if canvasDiagram}
      <MermaidView
        bind:this={mermaidView}
        source={canvasDiagram.source}
        name="{name} · {canvasDiagram.keyword}"
        {dark}
        {watching}
        onoutline={setOutline}
        onstatus={setStatus}
        onzoom={setZoom}
        oncopy={copy}
        onexport={(svg) => exportSvg(svg, canvasDiagram?.id)}
        onback={closeCanvas}
      />
    {:else if type === "markdown" && reviewPage && drafts}
      <ReviewView
        bind:this={reviewView}
        content={doc.content}
        {dark}
        scrollRoot={mainEl}
        {drafts}
        {sent}
        onchange={(next) => (drafts = next)}
        onannounce={announce}
        onoutline={setOutline}
        onactive={setActive}
        onopencanvas={openCanvas}
        onexport={exportSvg}
      />
    {:else if type === "markdown"}
      <MarkdownView
        bind:this={markdownView}
        content={shown}
        {dark}
        scrollRoot={mainEl}
        onoutline={setOutline}
        onactive={setActive}
        onopencanvas={openCanvas}
        onexport={exportSvg}
      />
    {:else if type === "mermaid"}
      <MermaidView
        bind:this={mermaidView}
        source={shown}
        {name}
        {dark}
        watching={watching && !(editorShown || edits)}
        ongotoline={editorShown || edits ? goToLine : null}
        onoutline={setOutline}
        onstatus={setStatus}
        onzoom={setZoom}
        oncopy={copy}
        onexport={(svg) => exportSvg(svg)}
      />
    {:else if type === "json"}
      <JsonView
        bind:this={jsonView}
        content={shown}
        {name}
        onoutline={setOutline}
        onactive={setActive}
        onstatus={setStatus}
        oncopy={copy}
        onannounce={announce}
      />
    {:else if type === "csv"}
      <CsvView
        bind:this={csvView}
        content={shown}
        name={doc.name}
        label={name}
        manual={choice.override === "csv"}
        onoutline={setOutline}
        onactive={setActive}
        onstatus={setStatus}
        onannounce={announce}
      />
    {/if}
  </main>
</div>

<StatusBar {live} {typeText} {zoom} {lastCopied} {message} comments={commentsText} edits={editsText} />
