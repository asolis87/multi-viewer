import { describe, expect, it } from "vitest";
import { closeWhenHidden, keepEventsOpen, reloadOnChange } from "../../src/web/lib/events.js";
import type { DocSource } from "../../src/shared/doc.js";

const SOURCES: DocSource[] = ["file", "paste", "stdin", "empty"];

describe("events stream decision (S11, T23)", () => {
  it("keeps /api/events open for every source when the page has a token", () => {
    for (const source of SOURCES) {
      for (const pastedHere of [false, true]) {
        expect(keepEventsOpen({ token: "abc", loadStatus: null, source, pastedHere }), `${source} pasted=${pastedHere}`).toBe(true);
      }
    }
    // Before the document arrives, and while the file cannot be read (500) or the server is unreachable (0).
    expect(keepEventsOpen({ token: "abc", loadStatus: null, source: null, pastedHere: false })).toBe(true);
    expect(keepEventsOpen({ token: "abc", loadStatus: 500, source: null, pastedHere: false })).toBe(true);
    expect(keepEventsOpen({ token: "abc", loadStatus: 0, source: null, pastedHere: false })).toBe(true);
  });

  it("does not open it without a token or after the server rejected the token", () => {
    expect(keepEventsOpen({ token: "", loadStatus: null, source: null, pastedHere: false })).toBe(false);
    expect(keepEventsOpen({ token: "abc", loadStatus: 403, source: null, pastedHere: false })).toBe(false);
  });

  it("refetches on change only for a watched file (live reload unchanged)", () => {
    expect(reloadOnChange({ source: "file", pastedHere: false, loadStatus: null })).toBe(true);
    expect(reloadOnChange({ source: null, pastedHere: false, loadStatus: 500 })).toBe(true);
    expect(reloadOnChange({ source: "file", pastedHere: true, loadStatus: null })).toBe(false);
    for (const source of ["paste", "stdin", "empty"] as const) {
      expect(reloadOnChange({ source, pastedHere: false, loadStatus: null }), source).toBe(false);
    }
    expect(reloadOnChange({ source: null, pastedHere: false, loadStatus: null })).toBe(false);
  });
});

describe("review pages (S17, T47)", () => {
  it("the hidden-tab close (S14 B) is off only for review pages", () => {
    expect(closeWhenHidden({ review: true })).toBe(false);
    expect(closeWhenHidden({ review: false })).toBe(true);
    expect(closeWhenHidden({ review: undefined })).toBe(true);
  });

  it("a sent review page closes its stream: nothing is left to watch", () => {
    expect(keepEventsOpen({ token: "abc", loadStatus: null, source: "file", pastedHere: false, sent: true })).toBe(false);
    expect(keepEventsOpen({ token: "abc", loadStatus: null, source: "file", pastedHere: false, sent: false })).toBe(true);
  });
});
