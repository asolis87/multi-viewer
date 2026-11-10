import { describe, expect, it } from "vitest";
import { choose, effectiveType, freshContent, reload, selectValue } from "../../src/web/lib/typeState.js";

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
