// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown, sanitizeHtml } from "../../src/web/lib/markdown.js";

function dom(html: string): HTMLElement {
  // Inert parse (DOMParser never runs scripts) of the sanitized output, only to inspect it.
  return new DOMParser().parseFromString(html, "text/html").body;
}

describe("sanitization", () => {
  it("removes <script> elements", () => {
    const { html } = renderMarkdown("Hello\n\n<script>alert(1)</script>\n");
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("Hello");
  });

  it("strips event handler attributes such as onerror=", () => {
    const { html } = renderMarkdown('<img src="x.png" onerror="alert(1)">');
    expect(html).not.toMatch(/onerror/i);
    expect(dom(html).querySelector("img")?.getAttribute("src")).toBe("x.png");
  });

  it("removes javascript: hrefs", () => {
    const el = dom(renderMarkdown('[click](javascript:alert(1)) <a href="javascript:alert(2)">raw</a>').html);
    const hrefs = [...el.querySelectorAll("[href]")].map((a) => a.getAttribute("href"));
    expect(hrefs.filter((h) => /^\s*javascript:/i.test(h ?? ""))).toEqual([]);
    expect(el.querySelector("a")?.hasAttribute("href")).toBe(false);
  });

  it("drops style elements and attributes that could restyle the app", () => {
    const out = sanitizeHtml('<style>body{display:none}</style><p style="position:fixed">x</p>');
    expect(out).not.toMatch(/<style|style=/i);
  });

  it("opens external links in a new tab with noopener noreferrer, but not in-page anchors", () => {
    const el = dom(renderMarkdown("[site](https://example.com) and https://auto.example.org and [top](#h-top)").html);
    const [site, auto, top] = [...el.querySelectorAll("a")];
    expect(site?.getAttribute("target")).toBe("_blank");
    expect(site?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(auto?.getAttribute("href")).toBe("https://auto.example.org");
    expect(auto?.getAttribute("target")).toBe("_blank");
    expect(top?.hasAttribute("target")).toBe(false);
  });
});

describe("markdown pipeline", () => {
  const source = [
    "# orders-service",
    "",
    "## Checkout flow",
    "",
    "```mermaid",
    "sequenceDiagram",
    "  A->>B: hi",
    "```",
    "",
    "## Endpoints",
    "",
    "| Method | Path |",
    "| --- | --- |",
    "| GET | /orders |",
    "",
    "```ts",
    "const x: number = 1;",
    "```",
    "",
    "## Endpoints",
  ].join("\n");

  it("turns a mermaid fence into a placeholder, not a <pre>", () => {
    const { html, diagrams } = renderMarkdown(source);
    const el = dom(html);
    const slot = el.querySelector(".mermaid-slot");
    expect(slot?.id).toBe("diagram-1");
    expect(el.querySelectorAll("pre")).toHaveLength(1);
    expect(html).not.toContain("sequenceDiagram");
    expect(diagrams).toEqual([{ id: "diagram-1", keyword: "sequenceDiagram", source: "sequenceDiagram\n  A->>B: hi\n" }]);
  });

  it("builds an outline of headings and embedded diagrams with unique, focusable heading ids", () => {
    const { html, outline } = renderMarkdown(source);
    expect(outline).toEqual([
      { kind: "heading", id: "h-orders-service", label: "orders-service", level: 1 },
      { kind: "heading", id: "h-checkout-flow", label: "Checkout flow", level: 2 },
      { kind: "diagram", id: "diagram-1", label: "sequenceDiagram", level: 3 },
      { kind: "heading", id: "h-endpoints", label: "Endpoints", level: 2 },
      { kind: "heading", id: "h-endpoints-2", label: "Endpoints", level: 2 },
    ]);
    const h2 = dom(html).querySelector("#h-checkout-flow");
    expect(h2?.tagName).toBe("H2");
    expect(h2?.getAttribute("tabindex")).toBe("-1");
  });

  it("renders GFM tables and highlights known languages", () => {
    const el = dom(renderMarkdown(source).html);
    expect(el.querySelector("table th")?.textContent).toBe("Method");
    expect(el.querySelector("pre code .hljs-keyword")?.textContent).toBe("const");
  });
});
