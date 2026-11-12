<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { parseCsv } from "../../shared/csv.js";
  import {
    buildTable,
    columnOutline,
    delimiterFor,
    isEmptyCell,
    moveSelection,
    nextSort,
    rowPosition,
    rowStatus,
    viewRows,
    type SortState,
  } from "../lib/csvTable.js";
  import { highlightParts } from "../lib/text.js";
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

  const q = $derived(query.trim());
  const view = $derived(viewRows(table, query, sort));
  const drawnSet = $derived(new Set(view.drawn));
  /** Roving tab stop: the selected row, or the first drawn row. */
  const tabStop = $derived(selected !== null && drawnSet.has(selected) ? selected : (view.drawn[0] ?? null));
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

  // The selected row is gone (search hid it, or a reload removed it): close the inspector.
  $effect.pre(() => {
    if (selected !== null && !drawnSet.has(selected)) selected = null;
  });

  $effect(() => onstatus(rowStatus(view.matched, table.rows.length)));
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
    if (e.key === "ArrowDown" || e.key === "ArrowUp") void select(moveSelection(view.drawn, index, e.key === "ArrowDown" ? 1 : -1), true);
    else if (e.key === "Enter" || e.key === " ") void select(index, true);
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

{#snippet marked(text: string)}{#each highlightParts(text, q) as part, i (i)}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}{/snippet}

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
          onkeydown={(e) => {
            if (e.key === "Escape" && q) {
              e.preventDefault();
              e.stopPropagation();
              clearSearch();
            }
          }}
          type="search"
          placeholder="Search cells"
          autocomplete="off"
        />
      </label>
      {#if q}
        <div class="q-status">
          <button class="btn" type="button" onclick={clearSearch}>Clear search</button>
        </div>
      {/if}
    </div>
    <div class="grid-scroll">
      <table class="t">
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
          {:else if !view.matched}
            <tr>
              <td class="none" colspan={table.columns.length}>
                No rows match “{q}”.<button class="btn" type="button" onclick={clearSearch}>Clear search</button>
              </td>
            </tr>
          {/if}
          {#each view.drawn as index (index)}
            {@const row = table.rows[index]!}
            {@const isSel = index === selected}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <tr data-row={index} tabindex={index === tabStop ? 0 : -1} class:is-selected={isSel} aria-current={isSel ? "true" : undefined}>
              {#each row as value, c (c)}
                <td class:num={table.numeric[c]}><div class="cell" title={value || undefined}>{@render marked(value)}</div></td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
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
