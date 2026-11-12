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
