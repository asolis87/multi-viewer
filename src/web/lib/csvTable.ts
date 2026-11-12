/** Pure helpers for the CSV table view (S13): header naming, numeric columns, sort, search, cap. */

import { csvDelimiter, detectDelimiter, type CsvDelimiter } from "../../shared/csv.js";
import type { SideOutline } from "./ui.js";

/** At most this many rows are drawn, taken after search and sort (S13, Q4). */
export const ROW_CAP = 5000;

/** A non-empty cell, trimmed, is a number when it matches this pattern (S13). */
export const NUMERIC_CELL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

const collator = new Intl.Collator(undefined, { sensitivity: "base" });
const counts = new Intl.NumberFormat("en-US");

export interface CsvTable {
  /** Display names: header cells, with blank ones and extra columns named `Column <n>`. */
  columns: string[];
  /** Data rows, every one padded with empty cells to `columns.length`. */
  rows: string[][];
  /** Whether each column sorts numerically (and is right-aligned). */
  numeric: boolean[];
}

export type SortDir = "ascending" | "descending";
export interface SortState {
  col: number;
  dir: SortDir;
}

export function isEmptyCell(value: string): boolean {
  return value.trim() === "";
}

/** The first record is the header; ragged rows are padded; extra columns get `Column <n>`. */
export function buildTable(records: string[][]): CsvTable {
  const [header = [], ...data] = records;
  let width = header.length;
  for (const r of data) if (r.length > width) width = r.length;
  const columns = Array.from({ length: width }, (_, i) => {
    const name = header[i] ?? "";
    return isEmptyCell(name) ? `Column ${i + 1}` : name;
  });
  const rows = data.map((r) => (r.length === width ? r : [...r, ...Array<string>(width - r.length).fill("")]));
  const numeric = columns.map((_, i) => isNumericColumn(rows, i));
  return { columns, rows, numeric };
}

/** At least one non-empty cell, and every non-empty cell matches the numeric pattern. */
export function isNumericColumn(rows: readonly (readonly string[])[], col: number): boolean {
  let any = false;
  for (const r of rows) {
    const v = (r[col] ?? "").trim();
    if (!v) continue;
    if (!NUMERIC_CELL.test(v)) return false;
    any = true;
  }
  return any;
}

/** Header click: ascending → descending → file order; another column starts at ascending. */
export function nextSort(sort: SortState | null, col: number): SortState | null {
  if (!sort || sort.col !== col) return { col, dir: "ascending" };
  return sort.dir === "ascending" ? { col, dir: "descending" } : null;
}

/** Indices (file order) of the rows with a cell containing the trimmed query, case-insensitive. */
export function filterRows(rows: readonly (readonly string[])[], query: string): number[] {
  const q = query.trim().toLowerCase();
  const out: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (!q || rows[i]!.some((cell) => cell.toLowerCase().includes(q))) out.push(i);
  }
  return out;
}

/** Stable sort of row indices; empty cells stay last in both directions. Returns a new array. */
export function sortRows(table: CsvTable, indices: readonly number[], sort: SortState | null): number[] {
  if (!sort) return [...indices];
  const { col, dir } = sort;
  const sign = dir === "ascending" ? 1 : -1;
  const numeric = table.numeric[col] ?? false;
  // Precompute keys once: null = empty cell.
  const keys = new Map<number, string | number | null>();
  for (const i of indices) {
    const v = table.rows[i]?.[col] ?? "";
    keys.set(i, isEmptyCell(v) ? null : numeric ? Number(v.trim()) : v);
  }
  return [...indices].sort((a, b) => {
    const x = keys.get(a)!;
    const y = keys.get(b)!;
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const c = numeric ? (x as number) - (y as number) : collator.compare(x as string, y as string);
    return sign * c;
  });
}

/** Rows filtered by the search, then sorted, then capped at ROW_CAP. */
export function viewRows(table: CsvTable, query: string, sort: SortState | null): { matched: number; drawn: number[] } {
  const sorted = sortRows(table, filterRows(table.rows, query), sort);
  return { matched: sorted.length, drawn: sorted.length > ROW_CAP ? sorted.slice(0, ROW_CAP) : sorted };
}

export function formatCount(n: number): string {
  return counts.format(n);
}

/** Status bar text: `<shown> of <total> rows`, plus the notice past the cap. */
export function rowStatus(matched: number, total: number): string {
  const text = `${formatCount(matched)} of ${formatCount(total)} rows`;
  return matched > ROW_CAP ? `${text} — showing the first ${formatCount(ROW_CAP)}; refine the search to see more` : text;
}

/** Inspector heading for a data row (0-based file index). */
export function rowPosition(index: number, total: number): string {
  return `Row ${formatCount(index + 1)} of ${formatCount(total)} in file order`;
}

/**
 * Auto-detected csv uses `detectDelimiter` (extension first, then sniffing); a manual csv choice
 * uses `;` if it qualifies, else `,` — except `.tsv` names keep tab (S13, L40).
 */
export function delimiterFor(content: string, name: string | null, manual: boolean): CsvDelimiter {
  const tsv = name !== null && /\.tsv$/i.test(name);
  if (manual) return tsv ? "\t" : csvDelimiter(content);
  return detectDelimiter(content, name) ?? csvDelimiter(content);
}

/** Sidebar outline: one item per column, in order. */
export function columnOutline(table: CsvTable): SideOutline {
  return {
    sub: `Columns · ${table.columns.length}`,
    foot: "Click a column to scroll to it and highlight its header.",
    empty: "No columns.",
    items: table.columns.map((label, i) => ({
      id: `col-${i}`,
      label,
      level: 0,
      icon: String(i + 1),
      mono: true,
      meta: table.numeric[i] ? "number" : "text",
    })),
  };
}

/** ↑/↓: the neighbour of `current` in the drawn order (clamped), or the first row. */
export function moveSelection(drawn: readonly number[], current: number | null, delta: 1 | -1): number | null {
  if (!drawn.length) return null;
  const at = current === null ? -1 : drawn.indexOf(current);
  if (at < 0) return drawn[0]!;
  return drawn[Math.min(drawn.length - 1, Math.max(0, at + delta))]!;
}
