<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import {
    ancestorsOf,
    countLabel,
    entriesOf,
    highlightParts,
    indexJson,
    isContainer,
    parseJson,
    primitiveText,
    searchJson,
    shortMeta,
    typeLabel,
    visibleRows,
    childPath,
    type JsonNode,
    type JsonValue,
  } from "../lib/json.js";
  import type { SideOutline } from "../lib/ui.js";

  interface Props {
    content: string;
    name: string;
    onoutline: (outline: SideOutline) => void;
    onactive: (id: string | null) => void;
    onstatus: (text: string | null) => void;
    oncopy: (text: string, label: string) => Promise<boolean>;
    onannounce: (text: string) => void;
  }

  let { content, name, onoutline, onactive, onstatus, oncopy, onannounce }: Props = $props();

  const LARGE = 3000;
  const VALUE_PREVIEW = 20000;

  const parsed = $derived(parseJson(content));
  const index = $derived(parsed.ok ? indexJson(parsed.value) : new Map<string, JsonNode>());

  let collapsed = $state<Set<string>>(new Set());
  let selected = $state("");
  let query = $state("");
  let raw = $state(false);
  let copiedPath = $state(false);
  let treeEl: HTMLDivElement | undefined = $state();
  let searchEl: HTMLInputElement | undefined = $state();
  let lastIndex: Map<string, JsonNode> | null = null;

  // New content (first load or live reload): keep selection and collapsed state when the paths still exist.
  $effect.pre(() => {
    const idx = index;
    if (idx === lastIndex) return;
    const first = lastIndex === null || lastIndex.size === 0;
    lastIndex = idx;
    if (first && idx.size > LARGE) {
      collapsed = new Set([...idx.values()].filter((n) => n.depth >= 2 && isContainer(n.value)).map((n) => n.path));
    } else {
      collapsed = new Set([...collapsed].filter((p) => idx.has(p)));
    }
    if (!idx.has(selected)) selected = "";
  });

  const search = $derived(searchJson(index, query));
  const rows = $derived(visibleRows(index, collapsed));
  const node = $derived(index.get(selected));
  const q = $derived(query.trim());
  // Single tab stop: the selected row, or its nearest visible ancestor when it is collapsed away.
  const tabStop = $derived.by(() => {
    const visible = new Set(rows.map((r) => r.node.path));
    return [selected, ...ancestorsOf(index, selected)].find((p) => visible.has(p)) ?? "";
  });

  $effect(() => {
    if (!parsed.ok) {
      onstatus("JSON · invalid");
      onoutline({ sub: "Not valid JSON", foot: "", empty: "Fix the JSON to see its keys.", items: [] });
      return;
    }
    onstatus(null);
    const root = parsed.value;
    const entries = entriesOf(root);
    onoutline({
      sub: isContainer(root) ? `Top-level ${Array.isArray(root) ? "items" : "keys"} · ${entries.length}` : `Single ${typeof root} value`,
      foot: "Selects the key in the tree and shows it in the Inspector.",
      empty: "No keys at the top level.",
      items: entries.map(([k, v]) => ({
        id: childPath("", k),
        label: typeof k === "number" ? `[${k}]` : k,
        level: 0,
        mono: true,
        meta: shortMeta(v),
        icon: Array.isArray(v) ? "[ ]" : isContainer(v) ? "{ }" : "·",
      })),
    });
  });

  $effect(() => {
    if (!selected) return onactive(null);
    const chain = [selected, ...ancestorsOf(index, selected)];
    onactive(chain.find((p) => index.get(p)?.parent === "") ?? null);
  });

  onDestroy(() => onstatus(null));

  function onSearchInput() {
    const expand = searchJson(index, query).expand;
    if (expand.size) collapsed = new Set([...collapsed].filter((p) => !expand.has(p)));
  }

  function clearSearch() {
    query = "";
    searchEl?.focus();
  }

  function findRow(path: string): HTMLButtonElement | null {
    return treeEl?.querySelector<HTMLButtonElement>(`.sel[data-path="${CSS.escape(path)}"]`) ?? null;
  }

  async function focusRow(path: string, scroll = true) {
    selected = path;
    await tick();
    const el = findRow(path);
    el?.focus({ preventScroll: true });
    if (scroll) el?.scrollIntoView({ block: "nearest" });
  }

  function toggle(path: string) {
    const next = new Set(collapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    collapsed = next;
  }

  function expandAll() {
    collapsed = new Set();
  }

  function collapseAll() {
    collapsed = new Set([...index.values()].filter((n) => n.path !== "" && isContainer(n.value)).map((n) => n.path));
  }

  /** Outline click: reveal a path in the tree. */
  export function reveal(path: string): void {
    raw = false;
    const anc = new Set(ancestorsOf(index, path));
    collapsed = new Set([...collapsed].filter((p) => !anc.has(p)));
    void focusRow(path);
  }

  async function copyPath(path: string) {
    if (!path) {
      onannounce("The root has no path to copy");
      return;
    }
    if (await oncopy(path, path)) {
      copiedPath = true;
      setTimeout(() => (copiedPath = false), 1400);
    }
  }

  function copyValue() {
    if (!node) return;
    void oncopy(JSON.stringify(node.value, null, 2), `value of ${selected || "root"}`);
  }

  function onTreeKeydown(e: KeyboardEvent) {
    const target = (e.target as Element).closest<HTMLButtonElement>(".sel");
    if (!target) return;
    const path = target.dataset.path ?? "";
    const i = rows.findIndex((r) => r.node.path === path);
    const row = rows[i];
    if (!row) return;
    const container = isContainer(row.node.value);
    const go = (r: (typeof rows)[number] | undefined) => r && focusRow(r.node.path);
    if (e.key === "ArrowDown") go(rows[i + 1]);
    else if (e.key === "ArrowUp") go(rows[i - 1]);
    else if (e.key === "Home") go(rows[0]);
    else if (e.key === "End") go(rows[rows.length - 1]);
    else if (e.key === "ArrowRight") {
      if (container && !row.open) toggle(path);
      else if (container) go(rows[i + 1]);
    } else if (e.key === "ArrowLeft") {
      if (container && row.open && path !== "") toggle(path);
      else if (row.node.parent !== null) void focusRow(row.node.parent);
    } else if ((e.key === "c" || e.key === "C") && !e.metaKey && !e.ctrlKey && !e.altKey) void copyPath(path);
    else return;
    e.preventDefault();
  }

  function keyLabel(n: JsonNode): string {
    if (n.key === null) return "root";
    return String(n.key);
  }

  const inspectorValue = $derived.by(() => {
    if (!node) return "";
    const text = JSON.stringify(node.value, null, 2);
    return text.length > VALUE_PREVIEW ? `${text.slice(0, VALUE_PREVIEW)}\n… (truncated — Copy value copies all of it)` : text;
  });

  function valueClass(v: JsonValue): string {
    if (v === null) return "nul";
    if (typeof v === "string") return "s";
    if (typeof v === "number") return "n";
    return "b";
  }
</script>

{#snippet marked(text: string)}{#each highlightParts(text, q) as part, i (i)}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}{/snippet}

{#if !parsed.ok}
  <section class="view-scroll" aria-label="JSON parse error">
    <div class="err">
      <div class="err-box" role="alert">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2l8.5 15h-17z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /><path d="M10 8v4M10 14.5v.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
        <div>
          <h1>Can’t parse {name} as JSON</h1>
          <p><code>{parsed.error}</code></p>
          <p class="err-meta">The raw text is shown below. Fix it, or pick another type in “Render as”.</p>
        </div>
      </div>
      <div class="src-wrap">
        <div class="src-head">{name} · raw text</div>
        <pre class="raw-src">{content}</pre>
      </div>
    </div>
  </section>
{:else}
  <section class="json" aria-label="JSON document">
    <div class="json-main">
      <div class="json-tools">
        {#if !raw}
          <label class="search">
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
            <span class="sr">Search keys and values</span>
            <input
              bind:this={searchEl}
              bind:value={query}
              oninput={onSearchInput}
              onkeydown={(e) => {
                if (e.key === "Escape" && q) {
                  e.preventDefault();
                  e.stopPropagation();
                  clearSearch();
                }
              }}
              type="search"
              placeholder="Search keys and values"
              autocomplete="off"
            />
          </label>
          {#if q}
            <div class="q-status">
              <span role="status">{search.hits.size ? `${search.hits.size} ${search.hits.size === 1 ? "match" : "matches"}` : `No matches for “${q}”`}</span>
              <button class="btn" type="button" onclick={clearSearch}>Clear search</button>
            </div>
          {/if}
        {/if}
        <div class="spacer"></div>
        {#if !raw}
          <button class="btn" type="button" onclick={expandAll}>Expand all</button>
          <button class="btn" type="button" onclick={collapseAll}>Collapse all</button>
        {/if}
        <div class="seg" role="group" aria-label="JSON view">
          <button type="button" aria-pressed={!raw} onclick={() => (raw = false)}>Tree</button>
          <button type="button" aria-pressed={raw} onclick={() => (raw = true)}>Raw</button>
        </div>
      </div>
      {#if raw}
        <!-- Focusable so keyboard users can scroll the raw text. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <pre class="raw" tabindex="0" aria-label="Raw JSON">{content}</pre>
      {:else}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
          class="tree"
          bind:this={treeEl}
          role="group"
          aria-label="JSON tree. Arrow keys move, Right and Left expand and collapse, C copies the path."
          onkeydown={onTreeKeydown}
        >
          {#each rows as row (row.node.path)}
            {@const n = row.node}
            {@const container = isContainer(n.value)}
            {@const isSel = n.path === selected}
            <div class="row" class:is-selected={isSel} style:--d={n.depth}>
              {#if container && n.path !== ""}
                <button
                  class="twisty"
                  type="button"
                  tabindex="-1"
                  aria-expanded={row.open}
                  aria-label="{row.open ? 'Collapse' : 'Expand'} {keyLabel(n)}"
                  onclick={() => toggle(n.path)}
                >
                  <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
                </button>
              {:else}
                <span class="twisty-pad"></span>
              {/if}
              <button
                class="sel"
                type="button"
                data-path={n.path}
                tabindex={n.path === tabStop ? 0 : -1}
                aria-current={isSel ? "true" : undefined}
                aria-expanded={container && n.path !== "" ? row.open : undefined}
                onclick={() => (selected = n.path)}
                ondblclick={() => copyPath(n.path)}
              >
                {#if n.key === null}
                  <span class="root">root</span>{" "}
                {:else if typeof n.key === "number"}
                  <span class="idx">{n.key}</span><span class="punc">: </span>
                {:else}
                  <span class="k">"{@render marked(n.key)}"</span><span class="punc">: </span>
                {/if}
                {#if container}
                  {@const arr = Array.isArray(n.value)}
                  <span class="meta">{arr ? "[" : "{"} {countLabel(n.value)} {arr ? "]" : "}"}</span>
                {:else if typeof n.value === "string"}
                  <span class="s">"{@render marked(n.value)}"</span>
                {:else}
                  <span class={valueClass(n.value)}>{@render marked(primitiveText(n.value))}</span>
                {/if}
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
    <aside class="inspector" aria-labelledby="ins-title">
      <h2 id="ins-title">Inspector</h2>
      <div>
        <div class="field-label" id="ins-path-label">Path</div>
        <div class="path-box" aria-labelledby="ins-path-label">{selected || "(root)"}</div>
        <div class="ins-actions">
          <button class="btn primary" type="button" disabled={!selected} aria-describedby="ins-note" onclick={() => copyPath(selected)}>
            {copiedPath ? "Copied ✓" : "Copy path"}
          </button>
          <button class="btn" type="button" onclick={copyValue}>Copy value</button>
        </div>
        <p class="ins-note" id="ins-note">
          {#if selected}
            Tip: press <kbd>C</kbd> on a focused row to copy its path.
          {:else}
            The root has no path to copy. Select a key or item.
          {/if}
        </p>
      </div>
      {#if node}
        <dl class="kv">
          <dt>Key</dt>
          <dd>{node.key === null ? "—" : typeof node.key === "number" ? `index ${node.key}` : node.key}</dd>
          <dt>Type</dt>
          <dd>{typeLabel(node.value)}</dd>
        </dl>
        <div>
          <div class="field-label">Value</div>
          <!-- Focusable so keyboard users can scroll a long value. -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <pre class="value-box" tabindex="0" aria-label="Selected value">{inspectorValue}</pre>
        </div>
      {/if}
    </aside>
  </section>
{/if}
