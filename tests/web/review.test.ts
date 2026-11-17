// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_QUOTE } from "../../src/shared/review.js";
import { renderMarkdown } from "../../src/web/lib/markdown.js";
import {
  addDraft,
  anchorSelection,
  blocksFor,
  buildSubmission,
  clearDrafts,
  contentKey,
  decisionFor,
  deleteDraft,
  draftKey,
  lineLabel,
  loadDrafts,
  placeFloating,
  noteContent,
  quoteRange,
  saveDrafts,
  sortDrafts,
  stackTops,
  trimQuote,
  updateDraft,
  type Draft,
  type DraftState,
} from "../../src/web/lib/review.js";
import FIXTURE from "./fixtures/review-blocks.md?raw";

function article(source = FIXTURE): HTMLElement {
  const el = document.createElement("article");
  // Inert parse (DOMParser runs no scripts) of the sanitized output, moved into the test document.
  const parsed = new DOMParser().parseFromString(renderMarkdown(source, { review: true }).html, "text/html");
  el.append(...document.adoptNode(parsed.body).childNodes);
  document.body.replaceChildren(el);
  return el;
}

/** A Range over the text `from` … `to` (inclusive of `to`), searched in document order. */
function rangeOver(root: Element, from: string, to: string = from): Range {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const startNode = nodes.find((n) => n.data.includes(from))!;
  const startIndex = nodes.indexOf(startNode);
  const endNode = nodes.slice(startIndex).find((n, i) => (i === 0 ? n.data.indexOf(to, n.data.indexOf(from)) >= 0 : n.data.includes(to)))!;
  const r = document.createRange();
  r.setStart(startNode, startNode.data.indexOf(from));
  const endAt = endNode === startNode ? endNode.data.indexOf(to, startNode.data.indexOf(from)) : endNode.data.indexOf(to);
  r.setEnd(endNode, endAt + to.length);
  return r;
}

const linesOf = (els: Element[]) => els.map((b) => `${b.getAttribute("data-start")}–${b.getAttribute("data-end")}`);

describe("labels and quotes", () => {
  it("names one line or a range with an en dash", () => {
    expect(lineLabel(40, 40)).toBe("line 40");
    expect(lineLabel(12, 14)).toBe("lines 12–14");
  });

  it("trims the quote and keeps at most MAX_QUOTE characters", () => {
    expect(trimQuote("  hello \n")).toBe("hello");
    expect(trimQuote("x".repeat(MAX_QUOTE + 20))).toHaveLength(MAX_QUOTE);
    expect(trimQuote(`${" ".repeat(10)}${"y".repeat(MAX_QUOTE)}`)).toBe("y".repeat(MAX_QUOTE));
    // Never ends with half of a surrogate pair or with spaces after the cut.
    const emoji = `${"a".repeat(MAX_QUOTE - 1)}😀`;
    expect(trimQuote(emoji)).toBe("a".repeat(MAX_QUOTE - 1));
    expect(trimQuote(`${"a".repeat(MAX_QUOTE - 2)}  bbb`)).toBe("a".repeat(MAX_QUOTE - 2));
  });
});

describe("anchoring: free selection, block anchor (S17)", () => {
  it("a selection inside one block anchors to the innermost block (nested list: the inner item)", () => {
    const root = article();
    expect(anchorSelection(rangeOver(root, "Nested"), " Nested ", root)).toEqual({ start: 10, end: 10, quote: "Nested", multi: false });
    expect(anchorSelection(rangeOver(root, "spans two"), "spans two", root)).toEqual({ start: 3, end: 4, quote: "spans two", multi: false });
    expect(anchorSelection(rangeOver(root, "continues"), "continues", root)).toEqual({ start: 18, end: 19, quote: "continues", multi: false });
    expect(anchorSelection(rangeOver(root, "3"), "3", root)).toEqual({ start: 24, end: 24, quote: "3", multi: false });
    expect(anchorSelection(rangeOver(root, "indented"), "indented", root)).toEqual({ start: 30, end: 31, quote: "indented", multi: false });
  });

  it("a selection from an item into its nested item anchors to the item that holds both", () => {
    const root = article();
    const r = rangeOver(root, "Second", "Nested one");
    expect(anchorSelection(r, "Second item\nNested one", root)).toEqual({ start: 9, end: 11, quote: "Second item\nNested one", multi: false });
  });

  it("a selection across several blocks runs from the first block's start to the last block's end", () => {
    const root = article();
    const r = rangeOver(root, "Nested two", "Third");
    expect(anchorSelection(r, "Nested two\nThird", root)).toEqual({ start: 11, end: 12, quote: "Nested two\nThird", multi: true });
    const wide = rangeOver(root, "Intro", "Steps");
    expect(anchorSelection(wide, "Intro paragraph spans two lines.\nSteps", root)).toMatchObject({ start: 3, end: 6, multi: true });
  });

  it("ignores boundaries that select no text in a block (triple-click ending at the next block)", () => {
    const root = article();
    const p = root.querySelector("p")!;
    const h2 = root.querySelector("h2")!;
    const r = document.createRange();
    r.setStart(p.firstChild!, 0);
    r.setEnd(h2.firstChild!, 0);
    expect(anchorSelection(r, "Intro paragraph\nspans two lines.\n", root)).toEqual({
      start: 3,
      end: 4,
      quote: "Intro paragraph\nspans two lines.",
      multi: false,
    });
  });

  it("returns nothing for blank text or a selection outside the document", () => {
    const root = article();
    expect(anchorSelection(rangeOver(root, "Plan"), "   ", root)).toBeNull();
    const outside = document.createElement("p");
    outside.textContent = "elsewhere";
    document.body.append(outside);
    const r = document.createRange();
    r.selectNodeContents(outside);
    expect(anchorSelection(r, "elsewhere", root)).toBeNull();
  });

  it("caps the quote at MAX_QUOTE characters", () => {
    const root = article(`${"x".repeat(600)}\n`);
    const r = document.createRange();
    r.selectNodeContents(root.querySelector("p")!);
    expect(anchorSelection(r, "x".repeat(600), root)?.quote).toBe("x".repeat(MAX_QUOTE));
  });
});

describe("which blocks a comment marks", () => {
  const key = contentKey(FIXTURE);
  const c = (start: number, end: number, multi = false, doc = key) => ({ start, end, multi, doc });

  it("the block with the same range (the innermost one when nested blocks share it)", () => {
    const root = article();
    expect(blocksFor(root, c(10, 10), key).map((b) => b.tagName)).toEqual(["LI"]);
    expect(blocksFor(root, c(14, 14), key).map((b) => b.tagName)).toEqual(["P"]);
    expect(blocksFor(root, c(33, 36), key).map((b) => b.className)).toEqual(["mermaid-slot"]);
  });

  it("multi-block comments mark each outermost block inside the range", () => {
    const root = article();
    expect(linesOf(blocksFor(root, c(11, 12, true), key))).toEqual(["11–11", "12–12"]);
    expect(linesOf(blocksFor(root, c(3, 6, true), key))).toEqual(["3–4", "6–6"]);
  });

  it("after the file changed: only a block with the same range is marked, otherwise none (no re-anchoring)", () => {
    const root = article();
    expect(blocksFor(root, c(3, 6, true, "older"), key)).toEqual([]);
    expect(linesOf(blocksFor(root, c(18, 19, true, "older"), key))).toEqual(["18–19"]);
    expect(blocksFor(root, c(5, 5, false, "older"), key)).toEqual([]);
    expect(linesOf(blocksFor(root, c(6, 6, false, "older"), key))).toEqual(["6–6"]);
  });

  it("finds the first occurrence of a quote in its block, across inline elements and whitespace", () => {
    const root = article("Use **Flask** for the server, Flask\nis fine.\n");
    const p = root.querySelector("p")!;
    expect(quoteRange(p, "Flask for the")?.toString()).toBe("Flask for the");
    expect(quoteRange(p, "Flask is fine")?.toString()).toBe("Flask\nis fine");
    expect(quoteRange(p, "Use Flask")?.startOffset).toBe(0);
    expect(quoteRange(p, "Django")).toBeNull();
  });
});

describe("drafts in the tab's sessionStorage, keyed by the run token", () => {
  const draft = (over: Partial<Draft> = {}): Draft => ({
    id: 1,
    kind: "change",
    start: 3,
    end: 4,
    quote: "spans",
    text: "Fix",
    multi: false,
    doc: "k",
    ...over,
  });
  let storage: Storage;
  beforeEach(() => {
    sessionStorage.clear();
    storage = sessionStorage;
  });

  it("starts empty with the loaded content as the base", () => {
    expect(loadDrafts(storage, "tok", "# a")).toEqual({ base: contentKey("# a"), changed: false, seq: 0, comments: [] });
  });

  it("survives a reload: save then load returns the same drafts", () => {
    const state: DraftState = { base: contentKey("# a"), changed: false, seq: 2, comments: [draft(), draft({ id: 2, kind: "note", quote: undefined })] };
    expect(saveDrafts(storage, "tok", state)).toBe(true);
    expect(storage.getItem(draftKey("tok"))).not.toBeNull();
    expect(loadDrafts(storage, "tok", "# a")).toEqual(state);
    expect(loadDrafts(storage, "other", "# a").comments).toEqual([]);
  });

  it("a reload after the file changed keeps the notice on", () => {
    const state: DraftState = { base: contentKey("# a"), changed: false, seq: 0, comments: [] };
    saveDrafts(storage, "tok", state);
    expect(loadDrafts(storage, "tok", "# b").changed).toBe(true);
  });

  it("drops stored data that is not a valid draft list", () => {
    storage.setItem(draftKey("tok"), "{not json");
    expect(loadDrafts(storage, "tok", "x").comments).toEqual([]);
    storage.setItem(
      draftKey("tok"),
      JSON.stringify({
        base: contentKey("x"),
        changed: false,
        seq: 9,
        comments: [draft(), draft({ id: 2, kind: "bad" as never }), draft({ id: 3, start: 0 }), draft({ id: 4, start: 5, end: 2 }), draft({ id: 5, text: "  " }), draft({ id: 6, quote: "q".repeat(MAX_QUOTE + 1) })],
      }),
    );
    expect(loadDrafts(storage, "tok", "x").comments.map((c) => c.id)).toEqual([1]);
  });

  it("clears on submission, and storage errors never throw", () => {
    saveDrafts(storage, "tok", { base: "b", changed: false, seq: 0, comments: [] });
    clearDrafts(storage, "tok");
    expect(storage.getItem(draftKey("tok"))).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    expect(loadDrafts(broken, "tok", "x").comments).toEqual([]);
    expect(saveDrafts(broken, "tok", { base: "b", changed: false, seq: 0, comments: [] })).toBe(false);
    expect(() => clearDrafts(broken, "tok")).not.toThrow();
    expect(loadDrafts(null, "tok", "x").comments).toEqual([]);
  });

  it("a live reload with other content turns the notice on for good", () => {
    let state = loadDrafts(storage, "tok", "one");
    state = noteContent(state, "one");
    expect(state.changed).toBe(false);
    state = noteContent(state, "two");
    expect(state.changed).toBe(true);
    expect(noteContent(state, "one").changed).toBe(true);
  });

  it("add, edit and delete keep creation ids; several comments may share a block", () => {
    let state: DraftState = { base: "b", changed: false, seq: 0, comments: [] };
    state = addDraft(state, { kind: "change", start: 9, end: 9, text: "A", multi: false, doc: "b" });
    state = addDraft(state, { kind: "answer", start: 3, end: 3, quote: "q", text: "B", multi: false, doc: "b" });
    state = addDraft(state, { kind: "note", start: 9, end: 9, text: "C", multi: false, doc: "b" });
    expect(state.seq).toBe(3);
    expect(sortDrafts(state.comments).map((c) => [c.id, c.text])).toEqual([[2, "B"], [1, "A"], [3, "C"]]);
    state = updateDraft(state, 1, { kind: "note", text: "A2" });
    expect(state.comments.find((c) => c.id === 1)).toMatchObject({ kind: "note", text: "A2", start: 9 });
    state = deleteDraft(state, 2);
    expect(state.comments.map((c) => c.id)).toEqual([1, 3]);
    state = addDraft(state, { kind: "change", start: 1, end: 1, text: "D", multi: false, doc: "b" });
    expect(state.comments.at(-1)?.id).toBe(4);
  });
});

describe("submission", () => {
  const d = (id: number, start: number, extra: Partial<Draft> = {}): Draft => ({
    id,
    kind: "change",
    start,
    end: start,
    text: `t${id}`,
    multi: false,
    doc: "k",
    ...extra,
  });

  it("chooses the decision from the button and the comment count", () => {
    expect(decisionFor("approve", 0)).toBe("approved");
    expect(decisionFor("approve", 2)).toBe("approved_with_comments");
    expect(decisionFor("request", 1)).toBe("changes_requested");
    expect(decisionFor("request", 0)).toBeNull();
  });

  it("builds the body in document order (start line, then creation order); whole-block comments have no quote", () => {
    const drafts = [d(1, 40, { kind: "answer", quote: "Should it?" }), d(2, 12, { end: 14 }), d(3, 12, { kind: "note", quote: "x" })];
    expect(buildSubmission("request", drafts)).toEqual({
      decision: "changes_requested",
      comments: [
        { kind: "change", startLine: 12, endLine: 14, text: "t2" },
        { kind: "note", startLine: 12, endLine: 12, quote: "x", text: "t3" },
        { kind: "answer", startLine: 40, endLine: 40, quote: "Should it?", text: "t1" },
      ],
    });
    expect(buildSubmission("approve", [])).toEqual({ decision: "approved", comments: [] });
    expect(buildSubmission("approve", drafts)?.decision).toBe("approved_with_comments");
    expect(buildSubmission("request", [])).toBeNull();
  });
});

describe("margin rail layout", () => {
  it("puts each card level with its block, pushing later cards down so none overlap", () => {
    expect(stackTops([0, 10, 200], [50, 30, 20], 8)).toEqual([0, 58, 200]);
    expect(stackTops([], [], 8)).toEqual([]);
    expect(stackTops([-20], [10], 8)).toEqual([0]);
  });
});

describe("floating trigger and popover placement", () => {
  const bounds = { left: 0, top: 0, right: 1000, bottom: 800 };
  it("goes below the anchor, kept inside the scroll area", () => {
    expect(placeFloating({ left: 100, top: 100, right: 300, bottom: 120 }, { width: 380, height: 200 }, bounds)).toEqual({ left: 100, top: 128 });
    expect(placeFloating({ left: 900, top: 100, right: 990, bottom: 120 }, { width: 380, height: 200 }, bounds)).toEqual({ left: 608, top: 128 });
    expect(placeFloating({ left: -50, top: 100, right: 10, bottom: 120 }, { width: 100, height: 20 }, bounds).left).toBe(8);
  });
  it("goes above when there is no room below", () => {
    expect(placeFloating({ left: 100, top: 700, right: 300, bottom: 720 }, { width: 380, height: 200 }, bounds)).toEqual({ left: 100, top: 492 });
    expect(placeFloating({ left: 100, top: 50, right: 300, bottom: 700 }, { width: 380, height: 200 }, bounds).top).toBe(8);
  });
});
