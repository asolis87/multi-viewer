/** Pure, cheap facts about Mermaid source: diagram keyword, outline entries and parse-error location. */
import { firstMeaningfulLine } from "../../shared/detect.js";

/** The diagram keyword, e.g. `sequenceDiagram` or `flowchart`; "diagram" when unknown. */
export function diagramKeyword(source: string): string {
  return firstMeaningfulLine(source)?.split(/[\s;]/, 1)[0] || "diagram";
}

export interface MermaidOutlineItem {
  label: string;
  /** Short alias/id shown as meta when it differs from the label. */
  meta: string | null;
}

export interface MermaidOutline {
  title: string;
  items: MermaidOutlineItem[];
}

const SEQ_DECL = /^(participant|actor)\s+("?)(.+?)\2(?:\s+as\s+(.+))?$/;
const SEQ_MSG = /^([^\s:>+-][^:>]*?)\s*(?:<<)?[-=]{1,2}(?:>>|>|x|\)|-)?[+-]?\s*([^:\s][^:]*?)\s*:/;
const FLOW_NODE = /(?:^|[\s&>-])([A-Za-z_][\w-]*)\s*(\[\[|\[\(|\(\(\(|\(\(|\(\[|\[\/|\[\\|\{\{|\[|\(|\{|>)\s*"?([^\]\)\}"]+?)"?\s*(?:\]\]|\)\]|\)\)\)|\)\)|\]\)|\/\]|\\\]|\}\}|\]|\)|\})/g;
const FLOW_EDGE = /([A-Za-z_][\w-]*)\s*(?:[<ox]?(?:--+|==+|-\.+-?)[>ox]?)(?:\|[^|]*\|)?\s*([A-Za-z_][\w-]*)/g;
const FLOW_SKIP = new Set(["subgraph", "end", "classDef", "class", "style", "linkStyle", "click", "direction"]);

/**
 * Participants of sequence diagrams and nodes of flowcharts, when cheaply derivable.
 * Returns null for other diagram types so the outline can be omitted gracefully.
 */
export function mermaidOutline(source: string): MermaidOutline | null {
  const keyword = diagramKeyword(source);
  const lines = source.split(/\r?\n/).map((l) => l.trim());
  if (keyword === "sequenceDiagram") return { title: "Participants", items: sequenceParticipants(lines) };
  if (keyword === "flowchart" || keyword === "graph") return { title: "Nodes", items: flowchartNodes(lines) };
  return null;
}

function sequenceParticipants(lines: string[]): MermaidOutlineItem[] {
  const seen = new Map<string, MermaidOutlineItem>();
  const add = (id: string, label?: string) => {
    const key = id.trim();
    if (!key || seen.has(key)) return;
    const text = (label ?? key).trim();
    seen.set(key, { label: text, meta: text === key ? null : key });
  };
  for (const line of lines) {
    if (!line || line.startsWith("%%")) continue;
    const decl = SEQ_DECL.exec(line);
    if (decl) {
      add(decl[3]!, decl[4]);
      continue;
    }
    if (/^(note|loop|alt|else|opt|par|and|critical|break|rect|end|autonumber|activate|deactivate|title|box|create|destroy)\b/i.test(line)) continue;
    const msg = SEQ_MSG.exec(line);
    if (msg) {
      add(msg[1]!);
      add(msg[2]!);
    }
  }
  return [...seen.values()];
}

function flowchartNodes(lines: string[]): MermaidOutlineItem[] {
  const seen = new Map<string, MermaidOutlineItem>();
  for (const line of lines.slice(1)) {
    if (!line || line.startsWith("%%")) continue;
    const first = line.split(/\s+/, 1)[0]!;
    if (FLOW_SKIP.has(first)) continue;
    for (const m of line.matchAll(FLOW_NODE)) {
      const id = m[1]!;
      const label = m[3]!.trim();
      if (!FLOW_SKIP.has(id)) seen.set(id, { label, meta: label === id ? null : id });
    }
    for (const m of line.matchAll(FLOW_EDGE)) {
      for (const id of [m[1]!, m[2]!]) {
        if (!seen.has(id) && !FLOW_SKIP.has(id)) seen.set(id, { label: id, meta: null });
      }
    }
  }
  return [...seen.values()];
}

export interface MermaidErrorInfo {
  message: string;
  /** 1-based line number in the source, when the parser reports one. */
  line: number | null;
}

/** Extract a readable message and the 1-based line from a Mermaid parse/render error. */
export function mermaidErrorInfo(error: unknown): MermaidErrorInfo {
  const err = error as { message?: unknown; str?: unknown; hash?: { loc?: { first_line?: unknown }; line?: unknown } } | null;
  const raw = typeof err?.message === "string" ? err.message : typeof err?.str === "string" ? err.str : String(error);
  const message = raw.trim() || "Mermaid could not render this diagram.";
  const fromText = /\bline (\d+)/i.exec(message);
  let line: number | null = fromText ? Number(fromText[1]) : null;
  if (line === null && typeof err?.hash?.loc?.first_line === "number") line = err.hash.loc.first_line;
  return { message, line: line !== null && line > 0 ? line : null };
}
