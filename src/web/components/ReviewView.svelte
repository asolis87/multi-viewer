<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import MarkdownView from "./MarkdownView.svelte";
  import CommentPopover from "./CommentPopover.svelte";
  import ReviewRail from "./ReviewRail.svelte";
  import ReviewIcon from "./ReviewIcon.svelte";
  import type { CommentKind } from "../../shared/review.js";
  import type { DiagramBlock } from "../lib/markdown.js";
  import { prefersReducedMotion, reveal as revealEl, type SideOutline } from "../lib/ui.js";
  import {
    addDraft,
    anchorSelection,
    blockLines,
    blocksFor,
    contentKey,
    deleteDraft,
    lineLabel,
    placeFloating,
    quoteRange,
    sortDrafts,
    stackTops,
    updateDraft,
    type Box,
    type DraftState,
  } from "../lib/review.js";

  interface Props {
    content: string;
    dark: boolean;
    scrollRoot: HTMLElement;
    drafts: DraftState;
    /** The review was sent (S17): read-only. */
    sent: boolean;
    onchange: (drafts: DraftState) => void;
    onannounce: (text: string) => void;
    onoutline: (outline: SideOutline) => void;
    onactive: (id: string | null) => void;
    onopencanvas: (diagram: DiagramBlock) => void;
    onexport: (svg: SVGSVGElement, suffix: string) => void;
  }

  let { content, dark, scrollRoot, drafts, sent, onchange, onannounce, onoutline, onactive, onopencanvas, onexport }: Props = $props();

  /** What a new or edited comment points at. */
  interface Target {
    start: number;
    end: number;
    /** Selected text, or null for the whole block. */
    quote: string | null;
    multi: boolean;
  }
  interface Row {
    key: number;
    top: number;
    start: number;
    end: number;
  }

  const BLOCK = "[data-start][data-end]";

  let article: HTMLElement | undefined = $state();
  let wrap: HTMLDivElement | undefined = $state();
  let list: HTMLOListElement | undefined = $state();
  let popEl: HTMLDivElement | undefined = $state();
  let trigEl: HTMLButtonElement | undefined = $state();

  const docKey = $derived(contentKey(content));
  const comments = $derived(sortDrafts(drafts.comments));

  let active = $state<number | null>(null);
  /** A selection waiting for the Comment button or the C key. */
  let sel = $state.raw<{ target: Target; range: Range } | null>(null);
  let trigPos = $state({ left: 0, top: 0 });
  let pop = $state.raw<{ target: Target; range: Range | null; editId: number | null; ret: HTMLElement | null } | null>(null);
  let popPos = $state({ left: 0, top: 0 });
  /** Each comment's marked block count (0: shown only in the rail). */
  let marked = $state.raw(new Map<number, number>());
  let rows = $state.raw<Row[]>([]);
  let rowOf = new WeakMap<Element, number>();
  let hoverRow = $state<number | null>(null);
  let wide = $state(false);
  let tops = $state.raw<Map<number, number> | null>(null);
  let railHeight = $state<number | null>(null);
  const cards = new Map<number, HTMLElement>();

  const popComment = $derived(pop?.editId ? (drafts.comments.find((c) => c.id === pop!.editId) ?? null) : null);

  // ---- highlights -------------------------------------------------------------------------

  const highlightApi = typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

  function setHighlight(name: string, ranges: Range[]) {
    if (highlightApi) CSS.highlights.set(name, new Highlight(...ranges));
  }

  function paint() {
    if (!article) return;
    for (const el of article.querySelectorAll(".rv-block, .rv-active-block, .rv-target")) el.classList.remove("rv-block", "rv-active-block", "rv-target");
    const quotes: Range[] = [];
    const current: Range[] = [];
    const counts = new Map<number, number>();
    for (const c of comments) {
      const blocks = blocksFor(article, c, docKey);
      counts.set(c.id, blocks.length);
      if (!blocks.length) continue;
      const on = c.id === active;
      if (highlightApi && blocks.length === 1 && c.quote && !c.multi) {
        const r = quoteRange(blocks[0]!, c.quote);
        if (r) {
          (on ? current : quotes).push(r);
          continue;
        }
      }
      for (const b of blocks) b.classList.add(on ? "rv-active-block" : "rv-block");
    }
    const pending = pop ?? sel;
    const selected: Range[] = [];
    if (pending?.range && highlightApi) selected.push(pending.range);
    else if (pending) for (const b of blocksFor(article, { ...pending.target, doc: docKey }, docKey)) b.classList.add("rv-target");
    setHighlight("rv-quote", quotes);
    setHighlight("rv-active", current);
    setHighlight("rv-sel", selected);
    marked = counts;
  }

  $effect(() => {
    // Repaint after the document, the comments, the current comment or the pending selection change.
    void [content, comments, active, sel, pop, article];
    schedule();
  });

  onMount(() => () => {
    if (highlightApi) for (const name of ["rv-quote", "rv-active", "rv-sel"]) CSS.highlights.delete(name);
  });

  // ---- block controls and the margin rail ------------------------------------------------

  function measureRows() {
    if (!article || !wrap) return;
    const top0 = wrap.getBoundingClientRect().top;
    const out: Row[] = [];
    rowOf = new WeakMap();
    for (const b of article.querySelectorAll<HTMLElement>(BLOCK)) {
      const r = b.getBoundingClientRect();
      if (!r.height) continue;
      const top = r.top - top0;
      const same = out.find((x) => Math.abs(x.top - top) < 6);
      // Nested blocks starting on the same row (an item and its paragraph): the innermost wins.
      if (same) Object.assign(same, blockLines(b));
      rowOf.set(b, same ? same.key : out.push({ key: out.length, top, ...blockLines(b) }) - 1);
    }
    rows = out;
  }

  function layoutRail() {
    if (!wide || !list || !article) {
      tops = null;
      railHeight = null;
      return;
    }
    const base = list.getBoundingClientRect().top;
    const wants = comments.map((c) => {
      const blocks = blocksFor(article!, c, docKey);
      if (!blocks.length) return -Infinity;
      let rect: DOMRect = blocks[0]!.getBoundingClientRect();
      if (blocks.length === 1 && c.quote && !c.multi) rect = quoteRange(blocks[0]!, c.quote)?.getBoundingClientRect() ?? rect;
      return rect.top - base - 6;
    });
    const heights = comments.map((c) => cards.get(c.id)?.offsetHeight ?? 0);
    const t = stackTops(wants, heights, 8);
    tops = new Map(comments.map((c, i) => [c.id, t[i]!]));
    railHeight = comments.length ? t.at(-1)! + heights.at(-1)! : 0;
  }

  let frame = 0;
  /** Next frame: repaint the marks, then (after the rail re-renders) place controls, cards and floating UI. */
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      untrack(paint);
      void tick().then(() => {
        measureRows();
        layoutRail();
        placeFloating_();
      });
    });
  }

  $effect(() => {
    void [sent, wide, comments.length];
    schedule();
  });

  onMount(() => {
    const wideQuery = matchMedia("(min-width: 1101px)");
    wide = wideQuery.matches;
    const onWide = () => (wide = wideQuery.matches);
    wideQuery.addEventListener("change", onWide);
    const observer = new ResizeObserver(schedule);
    if (article) observer.observe(article);
    const onScroll = () => placeFloating_();
    scrollRoot.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      wideQuery.removeEventListener("change", onWide);
      observer.disconnect();
      scrollRoot.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  });

  function onHover(e: MouseEvent) {
    let block = (e.target as Element | null)?.closest?.(BLOCK) ?? null;
    while (block && !rowOf.has(block)) block = block.parentElement?.closest(BLOCK) ?? null;
    hoverRow = block ? (rowOf.get(block) ?? null) : null;
  }

  // ---- selection, trigger and popover ----------------------------------------------------

  function readSelection(): { target: Target; range: Range } | null {
    const s = getSelection();
    if (!article || !s || !s.rangeCount || s.isCollapsed) return null;
    const r = s.getRangeAt(0);
    if (!article.contains(r.startContainer) || !article.contains(r.endContainer)) return null;
    const a = anchorSelection(r, s.toString(), article);
    return a ? { target: { start: a.start, end: a.end, quote: a.quote, multi: a.multi }, range: r.cloneRange() } : null;
  }

  function updateSelection() {
    if (sent || pop) return;
    sel = readSelection();
    if (sel) void tick().then(placeFloating_);
  }

  function anchorBox(target: Target, range: Range | null, last: boolean, fallback: HTMLElement | null): Box | null {
    if (range) {
      const rects = range.getClientRects();
      return last && rects.length ? rects[rects.length - 1]! : range.getBoundingClientRect();
    }
    const block = article ? blocksFor(article, { ...target, doc: docKey }, docKey)[0] : undefined;
    if (block) {
      const r = block.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: Math.min(r.bottom, r.top + 34) };
    }
    return fallback?.getBoundingClientRect() ?? null;
  }

  function placeFloating_() {
    const bounds = scrollRoot.getBoundingClientRect();
    if (pop && popEl) {
      const box = anchorBox(pop.target, pop.range, false, pop.ret);
      if (box) popPos = placeFloating(box, { width: popEl.offsetWidth, height: popEl.offsetHeight }, bounds);
    } else if (sel && trigEl) {
      const box = anchorBox(sel.target, sel.range, true, null);
      if (box) trigPos = placeFloating({ ...box, left: box.right - 40 }, { width: trigEl.offsetWidth, height: trigEl.offsetHeight }, bounds);
    }
  }

  async function openPop(target: Target, range: Range | null, editId: number | null, ret: HTMLElement | null) {
    if (sent) return;
    pop = { target, range, editId, ret };
    sel = null;
    await tick();
    placeFloating_();
  }

  function closePop(returnFocus: boolean) {
    const ret = pop?.ret ?? null;
    pop = null;
    if (returnFocus) (ret && document.contains(ret) ? ret : scrollRoot).focus({ preventScroll: true });
  }

  async function savePop(kind: CommentKind, text: string) {
    if (!pop) return;
    const { target, editId } = pop;
    let id = editId;
    if (editId) {
      onchange(updateDraft(drafts, editId, { kind, text }));
    } else {
      const next = addDraft(drafts, {
        kind,
        start: target.start,
        end: target.end,
        ...(target.quote ? { quote: target.quote } : {}),
        text,
        multi: target.multi,
        doc: docKey,
      });
      id = next.seq;
      onchange(next);
    }
    pop = null;
    getSelection()?.removeAllRanges();
    onannounce(editId ? "Comment saved" : "Comment added");
    await tick();
    list?.querySelector<HTMLElement>(`[data-comment="${id}"]`)?.focus();
  }

  function show(id: number) {
    active = id;
    const c = drafts.comments.find((x) => x.id === id);
    const block = c && article ? blocksFor(article, c, docKey)[0] : undefined;
    block?.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  function edit(id: number, button: HTMLElement) {
    const c = drafts.comments.find((x) => x.id === id);
    if (c) void openPop({ start: c.start, end: c.end, quote: c.quote ?? null, multi: c.multi }, null, id, button);
  }

  function remove(id: number) {
    if (active === id) active = null;
    if (pop?.editId === id) pop = null;
    onchange(deleteDraft(drafts, id));
    onannounce("Comment deleted");
    scrollRoot.focus({ preventScroll: true });
  }

  // Sent (S17): read-only from now on.
  $effect(() => {
    if (!sent) return;
    untrack(() => {
      pop = null;
      sel = null;
      active = null;
    });
  });

  onMount(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
    const onMouseUp = () => setTimeout(updateSelection, 0);
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey || e.key.startsWith("Arrow")) updateSelection();
    };
    const onSelectionChange = () => {
      if (sel && !pop && getSelection()?.isCollapsed) sel = null;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pop) {
        e.preventDefault();
        closePop(true);
        return;
      }
      if (e.key === "Escape" && sel) {
        sel = null;
        return;
      }
      if (sent || pop || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== "c") return;
      const current = readSelection();
      if (!current) return;
      e.preventDefault();
      void openPop(current.target, current.range, null, null);
    };
    const onMouseDown = (e: MouseEvent) => {
      // A popover with nothing typed closes when the user clicks elsewhere.
      if (!pop || !popEl || popEl.contains(e.target as Node)) return;
      if (!popEl.querySelector("textarea")?.value.trim()) pop = null;
    };
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  });

  export function reveal(id: string): void {
    revealEl(document.getElementById(id));
  }
</script>

{#if drafts.changed && !sent}
  <div class="rv-bar">
    <div class="notice" role="status"><ReviewIcon name="warn" />The file changed; line numbers may not match</div>
  </div>
{/if}
<!-- svelte-ignore a11y_mouse_events_have_key_events -->
<div class="doc-wrap" class:is-sent={sent} bind:this={wrap} onmouseover={onHover} onmouseleave={() => (hoverRow = null)} role="presentation">
  <MarkdownView
    bind:article
    review
    {content}
    {dark}
    {scrollRoot}
    foot="Select text to comment on it."
    {onoutline}
    {onactive}
    {onopencanvas}
    {onexport}
  />
  {#if !sent}
    <div class="ctl-layer">
      {#each rows as row (row.key)}
        <div class="ctl-row" class:is-hover={row.key === hoverRow} style:top="{row.top}px">
          <button
            class="blk-btn"
            type="button"
            aria-label="Comment on {lineLabel(row.start, row.end)}"
            title="Comment on the whole block ({lineLabel(row.start, row.end)})"
            onclick={(e) => openPop({ start: row.start, end: row.end, quote: null, multi: false }, null, null, e.currentTarget)}
          ><ReviewIcon name="comment" /></button>
        </div>
      {/each}
    </div>
  {/if}
  <ReviewRail
    {comments}
    {marked}
    {active}
    {sent}
    {tops}
    height={railHeight}
    {cards}
    bind:list
    onshow={show}
    onedit={edit}
    ondelete={remove}
  />
</div>

{#if sel && !pop && !sent}
  <button
    class="btn primary sel-btn"
    type="button"
    bind:this={trigEl}
    style:left="{trigPos.left}px"
    style:top="{trigPos.top}px"
    onmousedown={(e) => e.preventDefault()}
    onclick={() => sel && openPop(sel.target, sel.range, null, null)}
  ><ReviewIcon name="bubble" />Comment <kbd aria-hidden="true">C</kbd></button>
{/if}

{#if pop}
  {#key pop}
    <CommentPopover
      bind:element={popEl}
      title="{popComment ? 'Edit comment on' : 'Comment on'} {lineLabel(pop.target.start, pop.target.end)}"
      quote={pop.target.quote}
      multi={pop.target.multi}
      kind={popComment?.kind ?? "change"}
      text={popComment?.text ?? ""}
      editing={!!popComment}
      left={popPos.left}
      top={popPos.top}
      onsave={savePop}
      oncancel={() => closePop(true)}
    />
  {/key}
{/if}
