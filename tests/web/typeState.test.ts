import { describe, expect, it } from "vitest";
import { choose, effectiveType, freshContent, reload, selectValue, TYPE_LABEL, TYPE_OPTIONS } from "../../src/web/lib/typeState.js";
import { DOC_TYPES } from "../../src/web/lib/doc.js";

describe("manual type selection (S8)", () => {
  it("follows detection while on Auto", () => {
    const state = reload(freshContent("markdown"), "json");
    expect(effectiveType(state)).toBe("json");
    expect(selectValue(state)).toBe("auto");
  });

  it("keeps the manual choice across live reloads until it is changed", () => {
    let state = choose(freshContent("markdown"), "mermaid");
    state = reload(state, "markdown");
    state = reload(state, "json");
    expect(effectiveType(state)).toBe("mermaid");
    expect(selectValue(state)).toBe("mermaid");
    expect(state.detected).toBe("json");

    state = choose(state, "auto");
    expect(effectiveType(state)).toBe("json");
  });

  it("starts from detection for freshly pasted content", () => {
    expect(freshContent("json")).toEqual({ detected: "json", override: null });
  });
});

describe("type selector options (S8, S13)", () => {
  it("are built from DOC_TYPES and the type labels, including CSV", () => {
    expect(TYPE_OPTIONS.map((o) => o.value)).toEqual([...DOC_TYPES]);
    expect(TYPE_OPTIONS).toEqual(DOC_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] })));
    expect(TYPE_OPTIONS).toContainEqual({ value: "csv", label: "CSV" });
  });

  it("a manual csv choice overrides detection", () => {
    expect(effectiveType(choose(freshContent("markdown"), "csv"))).toBe("csv");
  });
});
