<script lang="ts">
  import { onMount, tick } from "svelte";
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
  import { fetchDoc, readToken, watchEvents, type Connection } from "./lib/api.js";
  import { keepEventsOpen, reloadOnChange } from "./lib/events.js";
  import { detectType, type Doc } from "./lib/doc.js";
  import { choose, effectiveType, freshContent, reload, selectValue, TYPE_LABEL, type SelectValue, type TypeChoice } from "./lib/typeState.js";
  import { renderMarkdown, type DiagramBlock } from "./lib/markdown.js";
  import { collapsibleOutline, copyText, themeBackground, type SideItem, type SideOutline } from "./lib/ui.js";
  import { downloadText, exportName, serializeSvg } from "./lib/svgExport.js";

  const token = readToken(location.search);

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

  let mainEl: HTMLElement | undefined = $state();
  let outlineButton: HTMLButtonElement | undefined = $state();
  let sidebarEl: HTMLElement | undefined = $state();
  let markdownView: MarkdownView | undefined = $state();
  let mermaidView: MermaidView | undefined = $state();
  let jsonView: JsonView | undefined = $state();
  let csvView: CsvView | undefined = $state();

  const type = $derived(effectiveType(choice));
  const isEmpty = $derived(doc !== null && doc.source === "empty" && !pastedHere);
  /** CSV documents on screen get the collapsible outline; every other view keeps today's sidebar. */
  const collapsible = $derived(!!doc && !isEmpty && !loadError && !canvasDiagram && collapsibleOutline(type));
  const outlineExpanded = $derived(narrow ? drawerOpen : collapsible && outlineOpen);
  const name = $derived.by(() => {
    if (!doc) return "mview";
    if (doc.name) return doc.name;
    if (pastedHere) return "Pasted content";
    return { file: "file", paste: "Clipboard", stdin: "stdin", empty: "Untitled" }[doc.source];
  });
  const sourceLabel = $derived(
    pastedHere ? "pasted" : doc ? { file: "file", paste: "clipboard", stdin: "stdin", empty: "no input" }[doc.source] : "…",
  );
  const watching = $derived(doc?.source === "file" && !pastedHere);

  const live = $derived.by((): { text: string; dot: "ok" | "off" | "idle" } => {
    if (pastedHere) return { text: "Not watching · pasted in this tab", dot: "idle" };
    if (!doc) return { text: loadError ? "Not connected" : "Connecting…", dot: "idle" };
    if (doc.source === "file") {
      if (connection === "live") return { text: `Live · watching ${name}`, dot: "ok" };
      if (connection === "disconnected") return { text: "Disconnected — retrying", dot: "off" };
      return { text: "Connecting…", dot: "idle" };
    }
    if (doc.source === "stdin") return { text: "Not watching · read from stdin", dot: "idle" };
    if (doc.source === "paste") return { text: "Not watching · from clipboard", dot: "idle" };
    return { text: "Waiting for input", dot: "idle" };
  });

  const typeText = $derived.by(() => {
    if (loadError) return "Type: —";
    if (!doc) return "Loading…";
    if (isEmpty) return "Type: waiting for paste";
    if (statusOverride) return statusOverride;
    return `${TYPE_LABEL[type]} · ${choice.override ? "manual" : "auto-detected"}`;
  });

  let seq = 0;
  async function load() {
    const mine = ++seq;
    const result = await fetchDoc(token);
    if (mine !== seq || pastedHere) return;
    if (result.ok) {
      loadError = null;
      const first = doc === null;
      doc = result.doc;
      choice = first ? freshContent(result.doc.type) : reload(choice, result.doc.type);
      if (canvasDiagram) {
        // Keep an open canvas in sync with the reloaded document (or close it if the diagram is gone).
        const id = canvasDiagram.id;
        canvasDiagram = effectiveType(choice) === "markdown" ? (renderMarkdown(result.doc.content).diagrams.find((d) => d.id === id) ?? null) : null;
      }
      if (!first && result.doc.source === "file") announce(`Reloaded ${result.doc.name ?? "file"} · ${new Date().toTimeString().slice(0, 8)}`);
    } else {
      loadError = { message: result.error, status: result.status };
    }
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
    choice = freshContent(detected);
    announce(`Rendered pasted content as ${TYPE_LABEL[detected]}`);
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
    if (narrow && drawerOpen) setDrawer(false, false);
    if (canvasDiagram) mermaidView?.reveal(item.id, item.label);
    else if (type === "markdown") markdownView?.reveal(item.id);
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
    if (narrow) void setDrawer(!drawerOpen);
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
    void load();
  });

  // The events stream stays open for every source and after a paste (S11: it is how --auto-close
  // knows this page is open). Only a watched file refetches on `change` (live reload, S2).
  const eventsOpen = $derived(
    keepEventsOpen({ token, loadStatus: loadError?.status ?? null, source: doc?.source ?? null, pastedHere }),
  );
  function onEventsChange() {
    if (reloadOnChange({ source: doc?.source ?? null, pastedHere, loadStatus: loadError?.status ?? null })) void load();
  }
  $effect(() => {
    if (!eventsOpen) return;
    return watchEvents(token, onEventsChange, (c) => (connection = c));
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
</script>

<Toolbar
  {name}
  {sourceLabel}
  detected={doc && !isEmpty && !loadError ? choice.detected : null}
  value={selectValue(choice)}
  drawerOpen={outlineExpanded}
  outlineAlways={collapsible}
  bind:outlineButton
  ontoggleoutline={toggleOutline}
  onselect={onSelect}
  {theme}
  ontheme={(t) => (theme = t)}
/>

<div class="workspace" class:drawer-open={drawerOpen} class:collapsible class:outline-open={collapsible && outlineOpen}>
  <Sidebar {outline} {active} inert={collapsible && !narrow && !outlineOpen} bind:element={sidebarEl} onpick={pick} />
  {#if drawerOpen}
    <div class="backdrop" aria-hidden="true" onclick={() => setDrawer(false)}></div>
  {/if}

  <main bind:this={mainEl} tabindex="-1">
    {#if loadError}
      <LoadError title={loadTitle} message={loadError.message} hint={loadHint} onretry={load} />
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
    {:else if type === "markdown"}
      <MarkdownView
        bind:this={markdownView}
        content={doc.content}
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
        source={doc.content}
        {name}
        {dark}
        {watching}
        onoutline={setOutline}
        onstatus={setStatus}
        onzoom={setZoom}
        oncopy={copy}
        onexport={(svg) => exportSvg(svg)}
      />
    {:else if type === "json"}
      <JsonView
        bind:this={jsonView}
        content={doc.content}
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
        content={doc.content}
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

<StatusBar {live} {typeText} {zoom} {lastCopied} {message} />
