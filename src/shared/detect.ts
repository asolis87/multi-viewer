export type DocType = "markdown" | "mermaid" | "json";

export const DOC_TYPES: readonly DocType[] = ["markdown", "mermaid", "json"];

const EXTENSIONS: Record<string, DocType> = {
  md: "markdown",
  markdown: "markdown",
  mmd: "mermaid",
  mermaid: "mermaid",
  json: "json",
};

const MERMAID_KEYWORDS = [
  "flowchart",
  "flowchart-elk",
  "graph",
  "sequenceDiagram",
  "classDiagram",
  "classDiagram-v2",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "journey",
  "gantt",
  "pie",
  "quadrantChart",
  "requirementDiagram",
  "gitGraph",
  "C4Context",
  "C4Container",
  "C4Component",
  "C4Dynamic",
  "C4Deployment",
  "mindmap",
  "timeline",
  "sankey-beta",
  "xychart-beta",
  "block-beta",
  "packet-beta",
  "kanban",
  "architecture-beta",
  "radar-beta",
  "treemap-beta",
  "zenuml",
];

/**
 * Detect how content should be rendered.
 * The file extension wins when it is known; otherwise the content is sniffed:
 * a JSON object/array is json, a leading Mermaid diagram keyword is mermaid,
 * and everything else is markdown.
 */
export function detectType(content: string, filename?: string | null): DocType {
  const byExtension = filename ? typeFromFilename(filename) : null;
  if (byExtension) return byExtension;
  if (isJsonDocument(content)) return "json";
  if (startsWithMermaidKeyword(content)) return "mermaid";
  return "markdown";
}

export function typeFromFilename(filename: string): DocType | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  return EXTENSIONS[filename.slice(dot + 1).toLowerCase()] ?? null;
}

function isJsonDocument(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function startsWithMermaidKeyword(content: string): boolean {
  const line = firstMeaningfulLine(content);
  if (!line) return false;
  // A keyword may be followed by whitespace, `;` or `:` (e.g. `graph TD;`, `gitGraph:`).
  const word = line.split(/[\s;:]/, 1)[0] ?? "";
  return MERMAID_KEYWORDS.includes(word);
}

/** First line that is not blank, a `%%` comment, or YAML front-matter. Shared with the frontend. */
export function firstMeaningfulLine(content: string): string | null {
  const lines = content.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  if (lines[i]?.trim() === "---") {
    i++;
    while (i < lines.length && lines[i]!.trim() !== "---") i++;
    i++;
  }
  for (; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "" || line.startsWith("%%")) continue;
    return line;
  }
  return null;
}
