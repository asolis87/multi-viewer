/** Pure helpers for the CSV table view (S13): header naming, numeric columns, sort, search, pages. */

import { csvDelimiter, detectDelimiter, type CsvDelimiter } from "../../shared/csv.js";
import type { SideOutline } from "./ui.js";

/** The shown rows, in sort order, are drawn one page of this many rows at a time (S13, L45). */
export const PAGE_SIZE = 200;

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

/** One search match (S16): a shown cell containing the query; `pos` is its row's position among the shown rows. */
export interface CellMatch {
  row: number;
  col: number;
  pos: number;
}

/** Every matching cell of the shown rows (`list`, in shown order), left to right within a row (S16). */
export function cellMatches(table: CsvTable, list: readonly number[], query: string): CellMatch[] {
  const q = query.trim().toLowerCase();
  const out: CellMatch[] = [];
  if (!q) return out;
  for (let pos = 0; pos < list.length; pos++) {
    const row = list[pos]!;
    const cells = table.rows[row]!;
    for (let col = 0; col < cells.length; col++) {
      if (cells[col]!.toLowerCase().includes(q)) out.push({ row, col, pos });
    }
  }
  return out;
}

/** The page (0-based) that holds a match. */
export function matchPage(match: CellMatch): number {
  return Math.floor(match.pos / PAGE_SIZE);
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

/** Every shown row (file indices): filtered by the search, then sorted. */
export function viewRows(table: CsvTable, query: string, sort: SortState | null): number[] {
  return sortRows(table, filterRows(table.rows, query), sort);
}

/** Number of pages for `shown` rows; at least one. */
export function pageCount(shown: number): number {
  return Math.max(1, Math.ceil(shown / PAGE_SIZE));
}

/** The rows of page `page` (0-based). */
export function pageRows(list: readonly number[], page: number): number[] {
  return list.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
}

export interface PagerState {
  /** Hidden when the shown rows fit on one page, including 0 rows. */
  visible: boolean;
  /** `Rows <a>–<b> of <shown>`, or "" when hidden. */
  label: string;
  /** « and ‹ can move. */
  back: boolean;
  /** › and » can move. */
  forward: boolean;
  /** Index of the last page. */
  last: number;
}

export function pagerState(page: number, shown: number): PagerState {
  const last = pageCount(shown) - 1;
  const visible = shown > PAGE_SIZE;
  const a = page * PAGE_SIZE + 1;
  const b = Math.min(shown, (page + 1) * PAGE_SIZE);
  return {
    visible,
    label: visible ? `Rows ${formatCount(a)}–${formatCount(b)} of ${formatCount(shown)}` : "",
    back: page > 0,
    forward: page < last,
    last,
  };
}

/**
 * The current page: the one holding the selected row while it is shown; otherwise page 1 after a
 * search or sort change (`reset`), else (live reload) the same page clamped to the last one.
 */
export function pageFor(list: readonly number[], selected: number | null, page: number, reset: boolean): number {
  const at = selected === null ? -1 : list.indexOf(selected);
  if (at >= 0) return Math.floor(at / PAGE_SIZE);
  if (reset) return 0;
  return Math.min(Math.max(0, page), pageCount(list.length) - 1);
}

export function formatCount(n: number): string {
  return counts.format(n);
}

/** Status bar text: `<shown> of <total> rows`. */
export function rowStatus(shown: number, total: number): string {
  return `${formatCount(shown)} of ${formatCount(total)} rows`;
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

/**
 * ↑/↓: the neighbour of `current` among every shown row (crossing pages); at the first or last row
 * it stays put; with nothing (or a hidden row) selected, the first row.
 */
export function moveSelection(list: readonly number[], current: number | null, delta: 1 | -1): number | null {
  if (!list.length) return null;
  const at = current === null ? -1 : list.indexOf(current);
  if (at < 0) return list[0]!;
  return list[Math.min(list.length - 1, Math.max(0, at + delta))]!;
}
