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

describe("remote images are blocked (T11, S6)", () => {
  function placeholders(html: string) {
    return [...dom(html).querySelectorAll(".remote-image")].map((el) => ({
      title: el.querySelector(".remote-image-title")?.textContent ?? null,
      alt: el.querySelector(".remote-image-alt")?.textContent ?? null,
      url: el.querySelector(".remote-image-url")?.textContent ?? null,
      label: el.getAttribute("aria-label"),
    }));
  }

  it("replaces a Markdown image with a remote URL by a placeholder showing alt text and the URL as plain text", () => {
    const { html } = renderMarkdown("![Build status](https://img.shields.io/badge/build-passing-green.svg)");
    expect(dom(html).querySelector("img")).toBeNull();
    expect(placeholders(html)).toEqual([
      {
        title: "Remote image blocked",
        alt: "Build status",
        url: "https://img.shields.io/badge/build-passing-green.svg",
        label: "Remote image blocked: Build status",
      },
    ]);
    // Plain text, never a link: no request and no navigation target.
    expect(dom(html).querySelector(".remote-image a, .remote-image [href], .remote-image [src]")).toBeNull();
  });

  it("covers raw HTML <img>, http:, protocol-relative, mixed case and surrounding spaces", () => {
    const { html } = renderMarkdown(
      [
        '<img src="http://example.com/a.png" alt="a">',
        '<img src="  HTTPS://Example.com/b.png  " alt="b">',
        '<img src="//cdn.example.com/c.png" alt="c">',
        '<img src="/\\evil.example/d.png" alt="d">',
      ].join("\n"),
    );
    expect(dom(html).querySelector("img")).toBeNull();
    expect(placeholders(html).map((p) => p.alt)).toEqual(["a", "b", "c", "d"]);
  });

  it("omits the alt line when the image has no alt text", () => {
    const { html } = renderMarkdown('<img src="https://example.com/pixel.gif">');
    expect(placeholders(html)).toEqual([
      { title: "Remote image blocked", alt: null, url: "https://example.com/pixel.gif", label: "Remote image blocked" },
    ]);
  });

  it("keeps data: and local relative images", () => {
    const dataUri = "data:image/png;base64,iVBORw0KGgo=";
    const el = dom(renderMarkdown(`![dot](${dataUri}) ![shot](./docs/shot.png)`).html);
    expect([...el.querySelectorAll("img")].map((i) => i.getAttribute("src"))).toEqual([dataUri, "./docs/shot.png"]);
    expect(el.querySelector(".remote-image")).toBeNull();
  });

  it("removes remote srcset values and remote <picture><source> elements", () => {
    const el = dom(
      renderMarkdown(
        '<img src="local.png" srcset="https://evil.example/x.png 2x, small.png 1x" alt="l">\n\n' +
          '<picture><source srcset="https://evil.example/y.webp"><source srcset="ok.webp"><img src="fallback.png" alt="f"></picture>',
      ).html,
    );
    const local = el.querySelector('img[alt="l"]')!;
    expect(local.getAttribute("src")).toBe("local.png");
    expect(local.hasAttribute("srcset")).toBe(false);
    expect([...el.querySelectorAll("source")].map((s) => s.getAttribute("srcset"))).toEqual(["ok.webp"]);
    expect(el.innerHTML).not.toContain("evil.example");
  });
});
