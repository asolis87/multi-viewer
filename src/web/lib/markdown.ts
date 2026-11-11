import MarkdownItCallable, { type MarkdownIt, type Token } from "markdown-it";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { diagramKeyword } from "./mermaidInfo.js";

const LANGUAGES = {
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin,
  markdown, php, plaintext, python, ruby, rust, shell, sql, swift, typescript, xml, yaml,
};
for (const [name, lang] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, lang);

export interface OutlineItem {
  kind: "heading" | "diagram";
  id: string;
  label: string;
  /** 1–6 for headings; diagrams sit one level under the heading before them. */
  level: number;
}

export interface DiagramBlock {
  id: string;
  source: string;
  keyword: string;
}

export interface RenderedMarkdown {
  /** Sanitized HTML: safe to insert. Mermaid fences are empty `.mermaid-slot` placeholders. */
  html: string;
  outline: OutlineItem[];
  diagrams: DiagramBlock[];
}

interface Env {
  [key: string | symbol]: unknown;
  outline: OutlineItem[];
  diagrams: DiagramBlock[];
}

function highlight(code: string, lang: string): string {
  const name = lang.trim().toLowerCase();
  if (!name || !hljs.getLanguage(name)) return ""; // markdown-it escapes it
  try {
    return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
  } catch {
    return "";
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function inlineText(token: Token | undefined): string {
  if (!token?.children) return token?.content ?? "";
  return token.children
    .filter((t) => t.type === "text" || t.type === "code_inline")
    .map((t) => t.content)
    .join("");
}

function isMermaidFence(token: Token): boolean {
  return token.type === "fence" && token.info.trim().split(/\s+/, 1)[0]?.toLowerCase() === "mermaid";
}

function createParser(): MarkdownIt {
  // HTML is allowed only because every render goes through DOMPurify before insertion.
  const md = new MarkdownItCallable({ html: true, linkify: true, highlight });

  md.core.ruler.push("mview_outline", (state) => {
    // SAFETY: renderMarkdown is the only caller of parser.render and always passes an Env
    // with `outline` and `diagrams` arrays; markdown-it forwards that object unchanged.
    const env = state.env as unknown as Env;
    const used = new Set<string>();
    let lastLevel = 0;
    state.tokens.forEach((token, i) => {
      if (token.type === "heading_open") {
        const label = inlineText(state.tokens[i + 1]).trim();
        // The "h-" prefix keeps ids from clobbering DOM globals (DOMPurify would drop them).
        const base = `h-${slugify(label) || "section"}`;
        let id = base;
        for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
        used.add(id);
        lastLevel = Number(token.tag.slice(1));
        token.attrSet("id", id);
        token.attrSet("tabindex", "-1");
        env.outline.push({ kind: "heading", id, label: label || "(untitled)", level: lastLevel });
      } else if (isMermaidFence(token)) {
        const id = `diagram-${env.diagrams.length + 1}`;
        const keyword = diagramKeyword(token.content);
        token.meta = { diagramId: id };
        env.diagrams.push({ id, source: token.content, keyword });
        env.outline.push({ kind: "diagram", id, label: keyword, level: lastLevel + 1 });
      }
    });
  });

  const fence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!;
    const diagramId = (token.meta as { diagramId?: string } | null)?.diagramId;
    if (diagramId) return `<div class="mermaid-slot" id="${diagramId}" tabindex="-1"></div>\n`;
    return fence(tokens, idx, options, env, self);
  };
  return md;
}

let parser: MarkdownIt | null = null;
type Purifier = ReturnType<typeof DOMPurify>;
let purifier: Purifier | null = null;

function getPurifier(): Purifier {
  if (purifier) return purifier;
  purifier = DOMPurify(window);
  purifier.addHook("afterSanitizeAttributes", (node) => {
    if (blockRemoteImage(node)) return;
    if (node.tagName !== "A") return;
    const href = node.getAttribute("href");
    if (href && !href.startsWith("#")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    } else {
      node.removeAttribute("target");
    }
  });
  return purifier;
}

/**
 * True for URLs that would make the browser contact another host: `http:`, `https:` and
 * protocol-relative `//` (browsers also read `/\` and `\\` as `//`). Trimmed, case-insensitive.
 */
export function isRemoteUrl(url: string): boolean {
  // Same normalization as the WHATWG URL parser: drop tabs/newlines anywhere, then leading and
  // trailing C0 controls and spaces; `\` counts as `/` for http(s)-like URLs.
  const u = url
    .replace(/[\t\n\r]/g, "")
    .replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "")
    .toLowerCase()
    .replace(/\\/g, "/");
  return u.startsWith("http:") || u.startsWith("https:") || u.startsWith("//");
}

function hasRemoteCandidate(srcset: string): boolean {
  // Conservative: drop tabs/newlines first so a URL split by them is still recognized as remote.
  return srcset
    .replace(/[\t\n\r]/g, "")
    .split(",")
    .some((candidate) => isRemoteUrl(candidate.replace(/^[\x00-\x20]+/, "").split(/[ \f]+/)[0] ?? ""));
}

/** Placeholder shown instead of a remote image (S6, T11): alt text and the URL as plain text. */
function remoteImagePlaceholder(doc: Document, url: string, alt: string): HTMLElement {
  const box = doc.createElement("span");
  box.className = "remote-image";
  box.setAttribute("role", "img");
  box.setAttribute("aria-label", alt ? `Remote image blocked: ${alt}` : "Remote image blocked");
  const title = doc.createElement("span");
  title.className = "remote-image-title";
  title.textContent = "Remote image blocked";
  box.append(title);
  if (alt) {
    const altEl = doc.createElement("span");
    altEl.className = "remote-image-alt";
    altEl.textContent = alt;
    box.append(altEl);
  }
  const urlEl = doc.createElement("code");
  urlEl.className = "remote-image-url";
  urlEl.textContent = url.trim();
  box.append(urlEl);
  return box;
}

/**
 * Remote images never load (S6, T11): a remote `<img>` becomes a placeholder, remote `srcset`
 * values are dropped and remote `<source>` elements are removed. The page CSP blocks them too.
 * Returns true when the node was replaced or removed.
 */
function blockRemoteImage(node: Element): boolean {
  const srcset = node.getAttribute("srcset");
  if (srcset !== null && hasRemoteCandidate(srcset)) node.removeAttribute("srcset");
  if (node.tagName === "SOURCE" && !node.hasAttribute("srcset") && srcset !== null) {
    node.remove();
    return true;
  }
  if (node.tagName !== "IMG") return false;
  const src = node.getAttribute("src");
  if (src === null || !isRemoteUrl(src)) return false;
  node.replaceWith(remoteImagePlaceholder(node.ownerDocument, src, node.getAttribute("alt")?.trim() ?? ""));
  return true;
}

/** Sanitize untrusted HTML for insertion into the document view. */
export function sanitizeHtml(html: string): string {
  return getPurifier().sanitize(html, {
    // No scripts (DOMPurify default), and nothing that can restyle or spoof the app chrome.
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "option"],
    FORBID_ATTR: ["style"],
  });
}

/** Render Markdown to sanitized HTML plus its outline (headings and embedded diagrams). */
export function renderMarkdown(source: string): RenderedMarkdown {
  parser ??= createParser();
  const env: Env = { outline: [], diagrams: [] };
  const html = sanitizeHtml(parser.render(source, env));
  return { html, outline: env.outline, diagrams: env.diagrams };
}
