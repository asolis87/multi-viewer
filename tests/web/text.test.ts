import { describe, expect, it } from "vitest";
import { highlightParts } from "../../src/web/lib/text.js";

describe("highlightParts (shared by the JSON and CSV searches)", () => {
  it("splits text so every case-insensitive occurrence can be marked", () => {
    expect(highlightParts("Mug-mug", "MUG")).toEqual([
      { text: "Mug", hit: true },
      { text: "-", hit: false },
      { text: "mug", hit: true },
    ]);
  });

  it("trims the query and returns the whole text for a blank query or no match", () => {
    expect(highlightParts("abc", "")).toEqual([{ text: "abc", hit: false }]);
    expect(highlightParts("abc", "   ")).toEqual([{ text: "abc", hit: false }]);
    expect(highlightParts("abc", "zz")).toEqual([{ text: "abc", hit: false }]);
    expect(highlightParts("Buenos Aires", " aires ")).toEqual([
      { text: "Buenos ", hit: false },
      { text: "Aires", hit: true },
    ]);
  });

  it("returns one empty part for an empty cell", () => {
    expect(highlightParts("", "x")).toEqual([{ text: "", hit: false }]);
  });
});

describe("match navigation (S16, shared by JSON and CSV)", () => {
  it("stepMatch wraps forward and backward", async () => {
    const { stepMatch } = await import("../../src/web/lib/text.js");
    expect(stepMatch(0, 3, 1)).toBe(1);
    expect(stepMatch(2, 3, 1)).toBe(0);
    expect(stepMatch(0, 3, -1)).toBe(2);
    expect(stepMatch(-1, 3, 1)).toBe(0);
    expect(stepMatch(0, 0, 1)).toBe(-1);
  });

  it("clampMatch keeps the position inside the new total, -1 at 0", async () => {
    const { clampMatch } = await import("../../src/web/lib/text.js");
    expect(clampMatch(5, 3)).toBe(2);
    expect(clampMatch(-1, 3)).toBe(0);
    expect(clampMatch(1, 3)).toBe(1);
    expect(clampMatch(1, 0)).toBe(-1);
  });

  it("matchLabel reads <current> of <total> with grouping, or No matches for “<query>”", async () => {
    const { matchLabel } = await import("../../src/web/lib/text.js");
    expect(matchLabel(0, 3, " Rojas ")).toBe("1 of 3");
    expect(matchLabel(1199, 12000, "a")).toBe("1,200 of 12,000");
    expect(matchLabel(-1, 0, " zz ")).toBe("No matches for “zz”");
  });
});
