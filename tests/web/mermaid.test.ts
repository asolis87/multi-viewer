// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { diagramKeyword, mermaidErrorInfo, mermaidOutline } from "../../src/web/lib/mermaidInfo.js";
import { exportName, serializeSvg } from "../../src/web/lib/svgExport.js";

describe("mermaid info", () => {
  it("reads the diagram keyword past comments and front-matter", () => {
    expect(diagramKeyword("---\ntitle: x\n---\n%% c\nflowchart LR\n")).toBe("flowchart");
    expect(diagramKeyword("")).toBe("diagram");
  });

  it("lists sequence participants, declared and implicit", () => {
    const outline = mermaidOutline(
      ["sequenceDiagram", "  participant S as Storefront", "  actor G", "  S->>G: POST /checkout", "  G-->>O: createOrder()", "  Note over S: x"].join("\n"),
    );
    expect(outline?.title).toBe("Participants");
    expect(outline?.items).toEqual([
      { label: "Storefront", meta: "S" },
      { label: "G", meta: null },
      { label: "O", meta: null },
    ]);
  });

  it("lists flowchart nodes with labels", () => {
    const outline = mermaidOutline("flowchart TD\n  A[Start] --> B{Valid?}\n  B -->|yes| C(Done)\n  B --> D\n");
    expect(outline?.items).toEqual([
      { label: "Start", meta: "A" },
      { label: "Valid?", meta: "B" },
      { label: "Done", meta: "C" },
      { label: "D", meta: null },
    ]);
  });

  it("omits the outline for other diagram types", () => {
    expect(mermaidOutline("pie title Pets\n  \"Dogs\" : 3\n")).toBeNull();
  });

  it("extracts the line number from parser errors", () => {
    expect(mermaidErrorInfo(new Error("Parse error on line 7:\n...G-O\n---^"))).toEqual({
      message: "Parse error on line 7:\n...G-O\n---^",
      line: 7,
    });
    expect(mermaidErrorInfo({ message: "bad", hash: { loc: { first_line: 3 } } }).line).toBe(3);
    expect(mermaidErrorInfo("No diagram type detected").line).toBeNull();
  });
});

describe("svg export", () => {
  it("produces a standalone SVG with namespace, size, its style and a background", () => {
    const host = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("id", "mview-mermaid-1");
    svg.setAttribute("viewBox", "-8 -8 200 100");
    svg.setAttribute("style", "max-width: 200px");
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = "#mview-mermaid-1 .node rect{fill:#eee}";
    svg.append(style, document.createElementNS("http://www.w3.org/2000/svg", "g"));
    host.append(svg);

    const out = serializeSvg(svg, "#ffffff");
    expect(out.startsWith("<?xml")).toBe(true);
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('width="200"');
    expect(out).toContain('height="100"');
    expect(out).toContain("#mview-mermaid-1 .node rect{fill:#eee}");
    expect(out).toMatch(/<\/style><rect x="-8" y="-8" width="200" height="100" fill="#ffffff"/);
    expect(out).not.toContain("max-width");
    // The on-page SVG is untouched.
    expect(svg.getAttribute("style")).toBe("max-width: 200px");
  });

  it("names exports after the document", () => {
    expect(exportName("README.md", "diagram-2")).toBe("README-diagram-2.svg");
    expect(exportName("checkout.mmd")).toBe("checkout.svg");
    expect(exportName(null)).toBe("diagram.svg");
  });
});
