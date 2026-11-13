<script lang="ts">
  import { onDestroy, tick, untrack } from "svelte";
  import { parseCsv } from "../../shared/csv.js";
  import {
    buildTable,
    cellMatches,
    columnOutline,
    delimiterFor,
    isEmptyCell,
    matchPage,
    moveSelection,
    nextSort,
    pageFor,
    pageRows,
    pagerState,
    rowPosition,
    rowStatus,
    viewRows,
    type SortState,
  } from "../lib/csvTable.js";
  import { clampMatch, highlightParts, matchLabel, stepMatch } from "../lib/text.js";
  import { prefersReducedMotion, type SideOutline } from "../lib/ui.js";

  interface Props {
    content: string;
    /** File name (for the `.csv`/`.tsv` delimiter rule), or null. */
    name: string | null;
    /** Label used in the table caption. */
    label: string;
    /** True when csv was chosen by hand in the type selector. */
    manual: boolean;
    onoutline: (outline: SideOutline) => void;
    onactive: (id: string | null) => void;
    onstatus: (text: string | null) => void;
    onannounce: (text: string) => void;
  }

  let { content, name, label, manual, onoutline, onactive, onstatus, onannounce }: Props = $props();

  const table = $derived(buildTable(parseCsv(content, delimiterFor(content, name, manual))));

  let query = $state("");
  let sort = $state<SortState | null>(null);
  let target = $state<number | null>(null);
  /** Selected data row (0-based file index); the inspector is open while it is set. */
  let selected = $state<number | null>(null);
  let searchEl: HTMLInputElement | undefined = $state();
  let bodyEl: HTMLTableSectionElement | undefined = $state();
  let headEl: HTMLTableRowElement | undefined = $state();
  let scrollEl: HTMLDivElement | undefined = $state();
  let pagerEl: HTMLDivElement | undefined = $state();
  /** Current page (0-based) of the shown rows; follows the selection (S13 "Large files"). */
  let page = $state(0);

  const q = $derived(query.trim());
  /** Every shown row (file indices), filtered then sorted. */
  const view = $derived(viewRows(table, query, sort));
  /** The rows drawn: the current page only. */
  const drawn = $derived(pageRows(view, page));
  const drawnSet = $derived(new Set(drawn));
  const pager = $derived(pagerState(page, view.length));
  /** Roving tab stop: the selected row, or the first drawn row. */
  const tabStop = $derived(selected !== null && drawnSet.has(selected) ? selected : (drawn[0] ?? null));
  const open = $derived(selected !== null);
  /** Row shown in the inspector: kept while the panel animates closed. */
  let shown = $state<number | null>(null);
  $effect.pre(() => {
    if (selected !== null) shown = selected;
  });
  const shownRow = $derived(shown === null ? null : (table.rows[shown] ?? null));

  // Live reload: drop a sort or column highlight that points past the new columns.
  $effect.pre(() => {
    const width = table.columns.length;
    if (sort && sort.col >= width) sort = null;
    if (target !== null && target >= width) target = null;
  });

  /** Search and sort last seen by the page effect: a change resets the page when nothing is selected. */
  let seenKey: string | null = null;

  // The page follows the selected row (↑/↓, sort, search, live reload); without one, a search or sort
  // change goes to page 1 and a live reload clamps. Then, in the same pass so the page is already set,
  // a selected row that is not drawn (search hid it, a reload removed it) closes the inspector.
  // Pager buttons set `page` directly (it is read untracked here) and close the inspector themselves.
  $effect.pre(() => {
    const list = view;
    const sel = selected;
    const key = `${q}\u0000${sort ? `${sort.col}:${sort.dir}` : ""}`;
    const changed = seenKey !== null && key !== seenKey;
    seenKey = key;
    const before = untrack(() => page);
    const next = pageFor(list, sel, before, changed);
    page = next;
    const followed = sel !== null && pageRows(list, next).includes(sel);
    if (sel !== null && !followed) selected = null;
    if (followed && (next !== before || changed)) void revealSelected();
    else if (next !== before) void scrollTop();
  });

  /** Every matching shown cell, in shown order across pages (S16). */
  const matches = $derived(cellMatches(table, view, query));
  /** Current match (index into `matches`), -1 when there is none. */
  let cur = $state(-1);
  const current = $derived(matches[cur] ?? null);
  /** The current match sits past its cell's ellipsis: the cell shows an accent bar (T41). */
  let hiddenCurrent = $state(false);

  // A live reload or a sort changes the list: clamp the current match, scroll nothing (S16).
  $effect.pre(() => {
    const n = matches.length;
    untrack(() => (cur = clampMatch(cur, n)));
  });

  // A new query: the first match becomes current and is brought into view; focus stays in the box.
  let seenQuery = "";
  $effect(() => {
    const now = q;
    if (now === seenQuery) return;
    seenQuery = now;
    untrack(() => {
      cur = matches.length ? 0 : -1;
      if (matches.length) void goToMatch(0);
    });
  });

  // Mark a current match cut off by the ellipsis (measured after the DOM is drawn).
  $effect(() => {
    const m = current;
    void drawn;
    hiddenCurrent = m !== null && cutOff(cellEl(m.row, m.col));
  });

  $effect(() => onstatus(rowStatus(view.length, table.rows.length)));
  $effect(() => onoutline(columnOutline(table)));
  $effect(() => onactive(target === null ? null : `col-${target}`));
  onDestroy(() => onstatus(null));

  const caption = $derived(
    `${label}, ${sort ? `sorted by ${table.columns[sort.col]} ${sort.dir}` : "file order"}`,
  );

  function cycleSort(col: number) {
    sort = nextSort(sort, col);
    onannounce(sort ? `Sorted by ${table.columns[col]}, ${sort.dir}` : "File order");
  }

  function clearSearch() {
    query = "";
    searchEl?.focus();
  }

  async function revealSelected() {
    await tick();
    if (selected !== null) rowEl(selected)?.scrollIntoView({ block: "nearest" });
  }

  async function scrollTop() {
    await tick();
    if (scrollEl) scrollEl.scrollTop = 0;
  }

  function cellEl(row: number, col: number): HTMLTableCellElement | null {
    return (rowEl(row)?.children[col] as HTMLTableCellElement | undefined) ?? null;
  }

  function cutOff(td: HTMLElement | null): boolean {
    const box = td?.querySelector(".cell")?.getBoundingClientRect();
    if (!td || !box) return false;
    return [...td.querySelectorAll("mark")].some((m) => m.getBoundingClientRect().right > box.right + 0.5);
  }

  /**
   * Go to match `i` (wraps). A match on another page shows that page and, like the pager buttons,
   * closes the inspector when the selected row is not on it. Never selects and never moves focus.
   */
  async function goToMatch(i: number) {
    const n = matches.length;
    if (!n) return;
    cur = stepMatch(i, n, 0);
    const m = matches[cur]!;
    const to = matchPage(m);
    if (to !== page) {
      page = to;
      if (selected !== null && !pageRows(view, page).includes(selected)) selected = null;
    }
    await tick();
    // The cell is scrolled (as in the artboard), not the mark: a cell cut with an ellipsis stays cut
    // and the mark's ring is not clipped at the edge.
    cellEl(m.row, m.col)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function onSearchKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && q) {
      e.preventDefault();
      e.stopPropagation();
      clearSearch();
    } else if (e.key === "Enter" && q) {
      e.preventDefault();
      void goToMatch(stepMatch(cur, matches.length, e.shiftKey ? -1 : 1));
    }
  }

  /** Pager buttons: show a page, scroll to the top; a selection not on it closes (focus stays). */
  async function goPage(to: number, back: boolean) {
    page = Math.min(pager.last, Math.max(0, to));
    if (selected !== null && !pageRows(view, page).includes(selected)) selected = null;
    await tick();
    if (scrollEl) scrollEl.scrollTop = 0;
    // The pressed button became disabled (first or last page): keep focus on an enabled pager button.
    const stuck = back ? !pager.back : !pager.forward;
    const active = document.activeElement;
    if (!stuck || !pagerEl || (active && active !== document.body && !pagerEl.contains(active))) return;
    pagerEl.querySelector<HTMLButtonElement>(`button[data-pg="${back ? "next" : "prev"}"]:not(:disabled)`)?.focus();
  }

  function rowEl(index: number): HTMLTableRowElement | null {
    return bodyEl?.querySelector<HTMLTableRowElement>(`tr[data-row="${index}"]`) ?? null;
  }

  async function select(index: number | null, focus: boolean) {
    if (index === null) return;
    selected = index;
    if (!focus) return;
    await tick();
    const el = rowEl(index);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest" });
  }

  async function closeInspector() {
    const index = selected;
    selected = null;
    if (index === null) return;
    await tick();
    rowEl(index)?.focus({ preventScroll: true });
  }

  function rowFrom(e: Event): number | null {
    const tr = (e.target as Element).closest<HTMLTableRowElement>("tr[data-row]");
    return tr ? Number(tr.dataset.row) : null;
  }

  function onBodyClick(e: MouseEvent) {
    // Let text selection inside a cell happen without changing the row.
    if (getSelection()?.toString()) return;
    void select(rowFrom(e), true);
  }

  function onBodyKeydown(e: KeyboardEvent) {
    const index = rowFrom(e);
    if (index === null) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Walks every shown row, crossing pages (the page follows); nothing happens at either end.
      const next = moveSelection(view, index, e.key === "ArrowDown" ? 1 : -1);
      if (next !== index) void select(next, true);
    } else if (e.key === "Enter" || e.key === " ") void select(index, true);
    else return;
    e.preventDefault();
  }

  function onDocKeydown(e: KeyboardEvent) {
    if (e.key !== "Escape" || selected === null || e.defaultPrevented) return;
    // The search box (Esc clears it) and the outline drawer (Esc closes it) keep their own Esc.
    if (e.target instanceof Element && e.target.closest("input, select, textarea, .sidebar")) return;
    e.preventDefault();
    void closeInspector();
  }

  /** Outline click: scroll a column into view and highlight its header. */
  export function reveal(id: string): void {
    const col = Number(id.replace(/^col-/, ""));
    if (!Number.isInteger(col) || col < 0 || col >= table.columns.length) return;
    target = col;
    const th = headEl?.children[col] as HTMLElement | undefined;
    th?.scrollIntoView({ inline: "center", block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }
</script>

{#snippet marked(text: string, isCurrent: boolean)}{#each highlightParts(text, q) as part, i (i)}{#if part.hit}<mark class:is-current={isCurrent}>{part.text}</mark>{:else}{part.text}{/if}{/each}{/snippet}

{#snippet chevron(up: boolean)}<svg viewBox="0 0 16 16" aria-hidden="true"><path d={up ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>{/snippet}

{#snippet sortIcon(dir: SortState["dir"] | null)}
  <svg class="sort-ico" viewBox="0 0 12 12" aria-hidden="true"
    ><path
      fill="currentColor"
      d={dir === "ascending" ? "M6 2.5l4 5H2z" : dir === "descending" ? "M6 9.5l-4-5h8z" : "M6 1.5l3 3.5H3zM6 10.5l-3-3.5h6z"}
    /></svg
  >
{/snippet}

<svelte:document onkeydown={onDocKeydown} />

<section class="csv-view" class:has-inspector={open} aria-label="CSV table">
  <div class="csv-main">
    <div class="json-tools">
      <label class="search">
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
        <span class="sr">Search cells</span>
        <input
          bind:this={searchEl}
          bind:value={query}
          onkeydown={onSearchKeydown}
          type="search"
          placeholder="Search cells"
          autocomplete="off"
        />
      </label>
      {#if q}
        <div class="q-status">
          <span class="q-count" role="status">{matchLabel(cur, matches.length, q)}</span>
          <span class="q-nav">
            <button class="btn" type="button" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={!matches.length} onclick={() => goToMatch(stepMatch(cur, matches.length, -1))}>{@render chevron(true)}</button>
            <button class="btn" type="button" aria-label="Next match" title="Next match (Enter)" disabled={!matches.length} onclick={() => goToMatch(stepMatch(cur, matches.length, 1))}>{@render chevron(false)}</button>
          </span>
          <button class="btn" type="button" onclick={clearSearch}>Clear search</button>
        </div>
      {/if}
    </div>
    <div class="grid-scroll" bind:this={scrollEl}>
      <table class="t" id="csv-table">
        <caption class="sr">{caption}</caption>
        <thead>
          <tr bind:this={headEl}>
            {#each table.columns as column, i (i)}
              {@const dir = sort?.col === i ? sort.dir : null}
              <th scope="col" class:num={table.numeric[i]} class:is-target={target === i} aria-sort={dir ?? undefined}>
                <button class="th-btn" type="button" aria-describedby="csv-sort-help" onclick={() => cycleSort(i)}>
                  {#if table.numeric[i]}{@render sortIcon(dir)}{/if}
                  <span class="cell">{column}</span>
                  {#if !table.numeric[i]}{@render sortIcon(dir)}{/if}
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <!-- Rows are selected by click, Enter/Space and ↑/↓ (delegated to the body). -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
        <tbody bind:this={bodyEl} onclick={onBodyClick} onkeydown={onBodyKeydown}>
          {#if !table.rows.length}
            <tr><td class="none" colspan={Math.max(1, table.columns.length)}>No rows</td></tr>
          {:else if !view.length}
            <tr>
              <td class="none" colspan={table.columns.length}>
                No rows match “{q}”.<button class="btn" type="button" onclick={clearSearch}>Clear search</button>
              </td>
            </tr>
          {/if}
          {#each drawn as index (index)}
            {@const row = table.rows[index]!}
            {@const isSel = index === selected}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <tr data-row={index} tabindex={index === tabStop ? 0 : -1} class:is-selected={isSel} aria-current={isSel ? "true" : undefined}>
              {#each row as value, c (c)}
                {@const isCur = current !== null && current.row === index && current.col === c}
                <td class:num={table.numeric[c]} class:has-hidden-current={isCur && hiddenCurrent}
                  ><div class="cell" title={value || undefined}>{@render marked(value, isCur)}</div></td
                >
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if pager.visible}
      <div class="pager" role="toolbar" aria-label="Table pages" aria-controls="csv-table" bind:this={pagerEl}>
        <button class="btn" type="button" data-pg="first" aria-label="First page" title="First page" disabled={!pager.back} onclick={() => goPage(0, true)}>«</button>
        <button class="btn" type="button" data-pg="prev" aria-label="Previous page" title="Previous page" disabled={!pager.back} onclick={() => goPage(page - 1, true)}>‹</button>
        <span class="pg-label" aria-live="polite">{pager.label}</span>
        <button class="btn" type="button" data-pg="next" aria-label="Next page" title="Next page" disabled={!pager.forward} onclick={() => goPage(page + 1, false)}>›</button>
        <button class="btn" type="button" data-pg="last" aria-label="Last page" title="Last page" disabled={!pager.forward} onclick={() => goPage(pager.last, false)}>»</button>
      </div>
    {/if}
  </div>
  <aside class="inspector" aria-labelledby="csv-ins-title" aria-hidden={!open} inert={!open}>
    <div class="ins-head">
      <h2 id="csv-ins-title">Row</h2>
      <button class="ins-close" type="button" aria-label="Close row details" title="Close (Esc)" onclick={closeInspector}>×</button>
    </div>
    {#if shownRow && shown !== null}
      <div>
        <div class="field-label">{rowPosition(shown, table.rows.length)}</div>
        <dl class="kv">
          {#each table.columns as column, c (c)}
            {@const value = shownRow[c] ?? ""}
            <dt>{column}</dt>
            <dd>{#if isEmptyCell(value)}<span class="nul">empty</span>{:else}{value}{/if}</dd>
          {/each}
        </dl>
      </div>
    {/if}
    <p class="ins-note">Use <kbd>↑</kbd> <kbd>↓</kbd> to move between rows and <kbd>Esc</kbd> to close. Long values are shown in full here.</p>
  </aside>
  <p class="sr" id="csv-sort-help">Click to sort ascending, then descending, then back to file order.</p>
</section>
