/**
 * Review mode (S17): pure rules for anchoring, drafts, layout and the submission body.
 * The page UI (`ReviewView.svelte`) uses these; tests exercise them in jsdom.
 */
import {
  MAX_QUOTE,
  type CommentKind,
  type ReviewComment,
  type ReviewDecision,
  type ReviewSubmission,
} from "../../shared/review.js";

export const KINDS: readonly CommentKind[] = ["change", "answer", "note"];
export const KIND_LABEL: Record<CommentKind, string> = { change: "Change request", answer: "Answer", note: "Note" };

/** A comment kept in the tab until the review is sent. */
export interface Draft {
  /** Creation order (1, 2, …); never reused within a run. */
  id: number;
  kind: CommentKind;
  /** 1-based, inclusive source lines as captured. */
  start: number;
  end: number;
  /** Selected text; absent for whole-block comments. */
  quote?: string;
  text: string;
  /** Anchored across several blocks (highlighted as whole blocks). */
  multi: boolean;
  /** `contentKey` of the document the comment was made on. */
  doc: string;
}

export interface DraftState {
  /** `contentKey` of the first content this tab loaded. */
  base: string;
  /** The file changed during the review: the notice stays on until submission. */
  changed: boolean;
  /** Last id handed out. */
  seq: number;
  comments: Draft[];
}

/** Toolbar controls of a review page (S17). */
export interface ReviewControls {
  count: number;
  sent: boolean;
  /** A submission is on its way: both buttons wait. */
  busy: boolean;
  onrequest: () => void;
  onapprove: () => void;
}

export interface Anchor {
  start: number;
  end: number;
  quote: string;
  multi: boolean;
}

export function lineLabel(start: number, end: number): string {
  return start === end ? `line ${start}` : `lines ${start}–${end}`;
}

/** The selected text, trimmed, at most `MAX_QUOTE` characters (never half a surrogate pair). */
export function trimQuote(text: string): string {
  let q = text.trim();
  if (q.length <= MAX_QUOTE) return q;
  q = q.slice(0, MAX_QUOTE);
  if (/[\uD800-\uDBFF]$/.test(q)) q = q.slice(0, -1);
  return q.trimEnd();
}

/** A short fingerprint of document content (FNV-1a, 32 bit): tells whether the file changed. */
export function contentKey(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${content.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

/** Document order: start line, then creation order. */
export function sortDrafts(list: readonly Draft[]): Draft[] {
  return [...list].sort((a, b) => a.start - b.start || a.id - b.id);
}

export type ReviewAction = "approve" | "request";

/** `Approve` → approved / approved_with_comments; `Request changes` needs a comment. */
export function decisionFor(action: ReviewAction, count: number): ReviewDecision | null {
  if (action === "request") return count > 0 ? "changes_requested" : null;
  return count > 0 ? "approved_with_comments" : "approved";
}

export function buildSubmission(action: ReviewAction, drafts: readonly Draft[]): ReviewSubmission | null {
  const decision = decisionFor(action, drafts.length);
  if (!decision) return null;
  const comments: ReviewComment[] = sortDrafts(drafts).map((d) => ({
    kind: d.kind,
    startLine: d.start,
    endLine: d.end,
    ...(d.quote ? { quote: d.quote } : {}),
    text: d.text,
  }));
  return { decision, comments };
}

// ---- drafts -------------------------------------------------------------------------------

export function draftKey(token: string): string {
  return `mview-review:${token}`;
}

function emptyState(content: string): DraftState {
  return { base: contentKey(content), changed: false, seq: 0, comments: [] };
}

const isLine = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1;

function validDraft(x: unknown): x is Draft {
  if (!x || typeof x !== "object") return false;
  const d = x as Record<string, unknown>;
  return (
    isLine(d.id) &&
    KINDS.includes(d.kind as CommentKind) &&
    isLine(d.start) &&
    isLine(d.end) &&
    (d.start as number) <= (d.end as number) &&
    typeof d.text === "string" &&
    d.text.trim() !== "" &&
    (d.quote === undefined || (typeof d.quote === "string" && d.quote.length <= MAX_QUOTE)) &&
    typeof d.multi === "boolean" &&
    typeof d.doc === "string"
  );
}

/** Drafts of this run in this tab (S17, L84); a fresh state when none or unreadable. */
export function loadDrafts(storage: Storage | null, token: string, content: string): DraftState {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(draftKey(token)) ?? null;
  } catch {
    raw = null;
  }
  if (!raw) return emptyState(content);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return emptyState(content);
  }
  if (!data || typeof data !== "object") return emptyState(content);
  const s = data as Record<string, unknown>;
  if (typeof s.base !== "string" || !Array.isArray(s.comments)) return emptyState(content);
  const comments = s.comments.filter(validDraft).map((d) => {
    const { id, kind, start, end, quote, text, multi, doc } = d;
    return quote === undefined ? { id, kind, start, end, text, multi, doc } : { id, kind, start, end, quote, text, multi, doc };
  });
  const seq = Math.max(isLine(s.seq) ? s.seq : 0, ...comments.map((c) => c.id));
  return noteContent({ base: s.base, changed: s.changed === true, seq, comments }, content);
}

export function saveDrafts(storage: Storage | null, token: string, state: DraftState): boolean {
  try {
    if (!storage) return false;
    storage.setItem(draftKey(token), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearDrafts(storage: Storage | null, token: string): void {
  try {
    storage?.removeItem(draftKey(token));
  } catch {
    /* nothing to clear */
  }
}

/** Content on screen now (first load or live reload): once it differs from the base, the notice stays on. */
export function noteContent(state: DraftState, content: string): DraftState {
  if (state.changed || contentKey(content) === state.base) return state;
  return { ...state, changed: true };
}

export function addDraft(state: DraftState, input: Omit<Draft, "id">): DraftState {
  const id = state.seq + 1;
  const draft: Draft = { id, ...input };
  if (draft.quote === undefined) delete draft.quote;
  return { ...state, seq: id, comments: [...state.comments, draft] };
}

export function updateDraft(state: DraftState, id: number, change: Pick<Draft, "kind" | "text">): DraftState {
  return { ...state, comments: state.comments.map((c) => (c.id === id ? { ...c, kind: change.kind, text: change.text } : c)) };
}

export function deleteDraft(state: DraftState, id: number): DraftState {
  return { ...state, comments: state.comments.filter((c) => c.id !== id) };
}

// ---- anchoring (DOM) ----------------------------------------------------------------------

const BLOCK = "[data-start][data-end]";

function elementOf(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/** The innermost block (element with source lines) holding `node`, inside `root`. */
export function blockOf(node: Node, root: Element): HTMLElement | null {
  const block = elementOf(node)?.closest<HTMLElement>(BLOCK) ?? null;
  return block && root.contains(block) ? block : null;
}

export function blockLines(el: Element): { start: number; end: number } {
  return { start: Number(el.getAttribute("data-start")), end: Number(el.getAttribute("data-end")) };
}

/** Text nodes inside `root` that the range selects at least one non-blank character of. */
function selectedTextNodes(range: Range, root: Element): Text[] {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!range.intersectsNode(node)) continue;
    let text = node.data;
    if (node === range.endContainer) text = text.slice(0, range.endOffset);
    if (node === range.startContainer) text = text.slice(range.startOffset);
    if (text.trim()) out.push(node);
  }
  return out;
}

/**
 * Free selection, block anchor (S17): a selection inside one block anchors to the innermost block
 * holding all of it; across several blocks it runs from the first block's start line to the last
 * block's end line (`multi`). `text` is the selected text as the browser reports it.
 */
export function anchorSelection(range: Range, text: string, root: Element): Anchor | null {
  const quote = trimQuote(text);
  if (!quote) return null;
  const blocks = selectedTextNodes(range, root)
    .map((n) => blockOf(n, root))
    .filter((b): b is HTMLElement => b !== null);
  let first = blocks[0];
  let last = blocks.at(-1);
  if (!first || !last) return null;
  // The innermost block holding the whole selection: walk up from the first until it holds the last.
  let common: HTMLElement | null = first;
  while (common && !common.contains(last)) common = common.parentElement?.closest<HTMLElement>(BLOCK) ?? null;
  if (common && root.contains(common) && blocks.every((b) => common!.contains(b)) && (common === first || common === last)) {
    return { ...blockLines(common), quote, multi: false };
  }
  // Across blocks: siblings (or blocks in different containers).
  if (first.contains(last)) last = first;
  else if (last.contains(first)) first = last;
  const a = blockLines(first);
  const b = blockLines(last);
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end), quote, multi: true };
}

/**
 * The blocks a comment marks: the block with its exact range (the innermost when nested blocks
 * share it); for a multi-block comment on the content it was made on, every outermost block inside
 * its range. After the file changed, only an exact range counts (S17: no re-anchoring).
 */
export function blocksFor(
  root: Element,
  c: { start: number; end: number; multi: boolean; doc: string },
  currentDoc: string,
): HTMLElement[] {
  const all = [...root.querySelectorAll<HTMLElement>(BLOCK)];
  const exact = all.filter((b) => {
    const l = blockLines(b);
    return l.start === c.start && l.end === c.end;
  });
  if (c.multi && c.doc === currentDoc) {
    const inside = all.filter((b) => {
      const l = blockLines(b);
      return l.start >= c.start && l.end <= c.end;
    });
    return inside.filter((b) => !inside.some((o) => o !== b && o.contains(b)));
  }
  const innermost = exact.at(-1);
  return innermost ? [innermost] : [];
}

/** First occurrence of `quote` in `block`, whitespace-insensitive and across inline elements. */
export function quoteRange(block: Element, quote: string): Range | null {
  const target = quote.replace(/\s+/g, " ").trim();
  if (!target) return null;
  const doc = block.ownerDocument;
  const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  // Normalized text with, for each character, the text node and offset it came from.
  let text = "";
  const map: Array<[Text, number]> = [];
  let lastSpace = true;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    for (let i = 0; i < node.data.length; i++) {
      const ch = node.data[i]!;
      if (/\s/.test(ch)) {
        if (lastSpace) continue;
        text += " ";
        lastSpace = true;
      } else {
        text += ch;
        lastSpace = false;
      }
      map.push([node, i]);
    }
  }
  const at = text.indexOf(target);
  if (at < 0) return null;
  const [startNode, startOffset] = map[at]!;
  const [endNode, endOffset] = map[at + target.length - 1]!;
  const range = doc.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset + 1);
  return range;
}

/** Margin rail: each card as high as its block, moved down just enough not to overlap the one above. */
export function stackTops(wants: readonly number[], heights: readonly number[], gap: number): number[] {
  let next = 0;
  return wants.map((want, i) => {
    const top = Math.max(want, next);
    next = top + (heights[i] ?? 0) + gap;
    return top;
  });
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where a floating element (selection trigger, comment popover) goes: 8px below the anchor and
 * inside `bounds` (the scroll area), or above the anchor when it does not fit below.
 */
export function placeFloating(anchor: Box, size: { width: number; height: number }, bounds: Box): { left: number; top: number } {
  const left = Math.max(bounds.left + 8, Math.min(anchor.left, bounds.right - size.width - 12));
  let top = anchor.bottom + 8;
  if (top + size.height > bounds.bottom - 8) top = Math.max(bounds.top + 8, anchor.top - size.height - 8);
  return { left, top };
}
