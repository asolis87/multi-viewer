/** Pure helpers for the JSON tree: path formatting, indexing, labels and search. */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonKey = string | number;

export interface JsonNode {
  path: string;
  key: JsonKey | null;
  value: JsonValue;
  parent: string | null;
  depth: number;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export function isContainer(v: JsonValue): v is JsonValue[] | { [key: string]: JsonValue } {
  return v !== null && typeof v === "object";
}

export function entriesOf(v: JsonValue): [JsonKey, JsonValue][] {
  if (Array.isArray(v)) return v.map((x, i) => [i, x]);
  if (isContainer(v)) return Object.entries(v);
  return [];
}

/**
 * Path of a child (S8): the root has no prefix, identifier keys use `.key`
 * (the first one without a dot), other keys use `["x.y"]`, array indices use `[3]`.
 */
export function childPath(parent: string, key: JsonKey): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  if (IDENTIFIER.test(key)) return parent ? `${parent}.${key}` : key;
  return `${parent}[${JSON.stringify(key)}]`;
}

/** Index every node by path, in document order. The root path is "". */
export function indexJson(root: JsonValue): Map<string, JsonNode> {
  const index = new Map<string, JsonNode>();
  const visit = (value: JsonValue, path: string, key: JsonKey | null, parent: string | null, depth: number) => {
    index.set(path, { path, key, value, parent, depth });
    for (const [k, x] of entriesOf(value)) visit(x, childPath(path, k), k, path, depth + 1);
  };
  visit(root, "", null, null, 0);
  return index;
}

export function ancestorsOf(index: Map<string, JsonNode>, path: string): string[] {
  const out: string[] = [];
  let p = index.get(path)?.parent ?? null;
  while (p !== null) {
    out.push(p);
    p = index.get(p)?.parent ?? null;
  }
  return out;
}

export function countLabel(v: JsonValue): string {
  if (Array.isArray(v)) return `${v.length} ${v.length === 1 ? "item" : "items"}`;
  if (isContainer(v)) {
    const n = Object.keys(v).length;
    return `${n} ${n === 1 ? "key" : "keys"}`;
  }
  return "";
}

export function typeLabel(v: JsonValue): string {
  if (v === null) return "null";
  if (isContainer(v)) return `${Array.isArray(v) ? "array" : "object"} · ${countLabel(v)}`;
  return typeof v;
}

/** Compact meta for the outline: `[3]`, `{5}` or the primitive type. */
export function shortMeta(v: JsonValue): string {
  if (Array.isArray(v)) return `[${v.length}]`;
  if (isContainer(v)) return `{${Object.keys(v).length}}`;
  return v === null ? "null" : typeof v;
}

export function primitiveText(v: JsonValue): string {
  return typeof v === "string" ? v : String(v);
}

export interface SearchResult {
  /** Paths whose key or primitive value contains the query. */
  hits: Set<string>;
  /** Containers that must be expanded so every hit is visible. */
  expand: Set<string>;
}

/** Case-insensitive search over object keys and primitive values (array indices are not keys). */
export function searchJson(index: Map<string, JsonNode>, query: string): SearchResult {
  const q = query.trim().toLowerCase();
  const hits = new Set<string>();
  const expand = new Set<string>();
  if (!q) return { hits, expand };
  for (const node of index.values()) {
    const keyHit = typeof node.key === "string" && node.key.toLowerCase().includes(q);
    const valueHit = !isContainer(node.value) && primitiveText(node.value).toLowerCase().includes(q);
    if (!keyHit && !valueHit) continue;
    hits.add(node.path);
    for (const a of ancestorsOf(index, node.path)) expand.add(a);
  }
  return { hits, expand };
}

export interface TextPart {
  text: string;
  hit: boolean;
}

/** Split text into parts so every case-insensitive occurrence of the query can be wrapped in <mark>. */
export function highlightParts(text: string, query: string): TextPart[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const parts: TextPart[] = [];
  let from = 0;
  for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + q.length)) {
    if (i > from) parts.push({ text: text.slice(from, i), hit: false });
    parts.push({ text: text.slice(i, i + q.length), hit: true });
    from = i + q.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), hit: false });
  return parts.length ? parts : [{ text, hit: false }];
}

export interface VisibleRow {
  node: JsonNode;
  open: boolean;
}

/** Flatten the tree into the rows currently visible, given the collapsed containers. */
export function visibleRows(index: Map<string, JsonNode>, collapsed: ReadonlySet<string>): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const root = index.get("");
  if (!root) return rows;
  const visit = (node: JsonNode) => {
    const container = isContainer(node.value);
    const open = container && (node.path === "" || !collapsed.has(node.path));
    rows.push({ node, open });
    if (!open) return;
    for (const [k] of entriesOf(node.value)) {
      const child = index.get(childPath(node.path, k));
      if (child) visit(child);
    }
  };
  visit(root);
  return rows;
}

export type JsonParse = { ok: true; value: JsonValue } | { ok: false; error: string };

export function parseJson(content: string): JsonParse {
  try {
    return { ok: true, value: JSON.parse(content) as JsonValue };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
