// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/web/lib/markdown.js";
import FIXTURE from "./fixtures/review-blocks.md?raw";

function dom(html: string): HTMLElement {
  return new DOMParser().parseFromString(html, "text/html").body;
}

/** `start–end` of an element's source line attributes, or null when it has none. */
function lines(el: Element | null | undefined): string | null {
  if (!el?.hasAttribute("data-start")) return null;
  return `${el.getAttribute("data-start")}–${el.getAttribute("data-end")}`;
}

describe("non-review rendering is unchanged (S17: only review pages carry line attributes)", () => {
  it("renders exactly the HTML recorded before T46", async () => {
    // fixtures/review-blocks.render.html was written by this test on the code before T46.
    await expect(renderMarkdown(FIXTURE).html).toMatchFileSnapshot("./fixtures/review-blocks.render.html");
    await expect(renderMarkdown(FIXTURE, { review: false }).html).toMatchFileSnapshot("./fixtures/review-blocks.render.html");
  });

  it("has no line attributes, and a review render differs only by them", () => {
    const plain = renderMarkdown(FIXTURE).html;
    const review = renderMarkdown(FIXTURE, { review: true }).html;
    expect(plain).not.toMatch(/data-start|data-end/);
    expect(review).toMatch(/data-start/);
    expect(review.replace(/ data-(start|end)="\d+"/g, "")).toBe(plain);
  });

  it("keeps the outline and diagrams the same", () => {
    const plain = renderMarkdown(FIXTURE);
    const review = renderMarkdown(FIXTURE, { review: true });
    expect(review.outline).toEqual(plain.outline);
    expect(review.diagrams).toEqual(plain.diagrams);
  });
});

describe("source line ranges on review pages (T46, S17)", () => {
  const el = dom(renderMarkdown(FIXTURE, { review: true }).html);

  it("headings and paragraphs (a paragraph over two lines)", () => {
    expect(lines(el.querySelector("h1"))).toBe("1–1");
    expect(lines(el.querySelector("h2"))).toBe("6–6");
    expect(lines(el.querySelector("body > p"))).toBe("3–4");
    expect(lines(el.querySelector("body > p:last-of-type"))).toBe("38–38");
  });

  it("list items, nested list items and the item that holds them", () => {
    const items = [...el.querySelectorAll("ul > li")].map((li) => [li.firstChild?.textContent?.trim(), lines(li)]);
    expect(items).toEqual([
      ["First item", "8–8"],
      ["Second item", "9–11"],
      ["Nested one", "10–10"],
      ["Nested two", "11–11"],
      ["Third item", "12–12"],
    ]);
  });

  it("loose list items and their paragraphs: trailing blank lines are trimmed (L86)", () => {
    const items = [...el.querySelectorAll("ol > li")];
    expect(items.map(lines)).toEqual(["14–14", "16–16"]);
    expect(items.map((li) => lines(li.querySelector("p")))).toEqual(["14–14", "16–16"]);
  });

  it("blockquotes and the paragraph inside", () => {
    expect(lines(el.querySelector("blockquote"))).toBe("18–19");
    expect(lines(el.querySelector("blockquote > p"))).toBe("18–19");
  });

  it("table rows (header and body); cells and the table itself carry none", () => {
    expect([...el.querySelectorAll("tr")].map(lines)).toEqual(["21–21", "23–23", "24–24"]);
    expect(lines(el.querySelector("table"))).toBeNull();
    expect(lines(el.querySelector("td"))).toBeNull();
  });

  it("fenced and indented code blocks, on the <pre> (not the <code>)", () => {
    expect([...el.querySelectorAll("pre")].map(lines)).toEqual(["26–28", "30–31"]);
    expect(el.querySelector("pre code[data-start]")).toBeNull();
    expect(el.querySelector("pre code .hljs-keyword")?.textContent).toBe("const");
  });

  it("fenced Mermaid diagrams, on their placeholder", () => {
    const slot = el.querySelector(".mermaid-slot");
    expect(slot?.id).toBe("diagram-1");
    expect(lines(slot)).toBe("33–36");
  });

  it("DOMPurify keeps the attributes on every block type", () => {
    const html = renderMarkdown("Para\n\n- item\n\n> q\n\n| a |\n| - |\n| b |\n\n```\nx\n```\n", { review: true }).html;
    const body = dom(html);
    for (const sel of ["p", "li", "blockquote", "tr", "pre"]) expect(lines(body.querySelector(sel)), sel).not.toBeNull();
  });

  it("a block at the end of the file without a trailing newline", () => {
    expect(lines(dom(renderMarkdown("a\n\nb", { review: true }).html).querySelector("p:last-child"))).toBe("3–3");
  });

  it("CRLF line endings count the same lines", () => {
    const body = dom(renderMarkdown("# T\r\n\r\npara\r\n\r\n\r\n- x\r\n", { review: true }).html);
    expect(lines(body.querySelector("p"))).toBe("3–3");
    expect(lines(body.querySelector("li"))).toBe("6–6");
  });
});
