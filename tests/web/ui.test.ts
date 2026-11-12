import { describe, expect, it } from "vitest";
import { collapsibleOutline } from "../../src/web/lib/ui.js";

describe("collapsibleOutline (S13 outline, L38)", () => {
  it("only CSV documents get the collapsible outline on wide screens", () => {
    expect(collapsibleOutline("csv")).toBe(true);
  });

  it("other document types keep today's always-visible sidebar", () => {
    expect(collapsibleOutline("markdown")).toBe(false);
    expect(collapsibleOutline("mermaid")).toBe(false);
    expect(collapsibleOutline("json")).toBe(false);
  });
});
