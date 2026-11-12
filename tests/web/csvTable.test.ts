import { describe, expect, it } from "vitest";
import {
  buildTable,
  columnOutline,
  delimiterFor,
  filterRows,
  formatCount,
  isNumericColumn,
  moveSelection,
  nextSort,
  PAGE_SIZE,
  pageCount,
  pageFor,
  pageRows,
  pagerState,
  rowPosition,
  rowStatus,
  sortRows,
  viewRows,
  type CsvTable,
} from "../../src/web/lib/csvTable.js";

describe("buildTable (S13 header and ragged rows)", () => {
  it("uses the first record as the header and pads short rows with empty cells", () => {
    const t = buildTable([
      ["id", "name", "amount"],
      ["1", "Ana"],
      ["2", "Bo", "3"],
    ]);
    expect(t.columns).toEqual(["id", "name", "amount"]);
    expect(t.rows).toEqual([
      ["1", "Ana", ""],
      ["2", "Bo", "3"],
    ]);
  });

  it("names extra cells Column <n> by 1-based position and pads every row to that width", () => {
    const t = buildTable([
      ["a", "b", "c"],
      ["1", "2", "3", "x"],
      ["4", "5", "6"],
    ]);
    expect(t.columns).toEqual(["a", "b", "c", "Column 4"]);
    expect(t.rows[1]).toEqual(["4", "5", "6", ""]);
  });

  it("shows an empty (blank) header cell as Column <n> and keeps duplicates as they are", () => {
    expect(buildTable([["x", "  ", "x"], ["1", "2", "3"]]).columns).toEqual(["x", "Column 2", "x"]);
  });

  it("handles one column, a header only and empty content", () => {
    expect(buildTable([["only"], ["a"], ["b"]]).columns).toEqual(["only"]);
    const headerOnly = buildTable([["a", "b"]]);
    expect(headerOnly.columns).toEqual(["a", "b"]);
    expect(headerOnly.rows).toEqual([]);
    expect(buildTable([])).toEqual({ columns: [], rows: [], numeric: [] });
  });

  it("marks numeric columns", () => {
    const t = buildTable([
      ["id", "name", "amount", "blank"],
      ["1", "Ana", "80.37", ""],
      ["2", "Bo", "", " "],
    ]);
    expect(t.numeric).toEqual([true, false, true, false]);
  });
});

describe("isNumericColumn (S13 numeric pattern)", () => {
  const col = (...cells: string[]) => isNumericColumn(cells.map((c) => [c]), 0);
  it("accepts signs, decimals, leading/trailing dots and surrounding spaces; ignores empty cells", () => {
    expect(col("+3", "-2", "1.", ".5", " 7 ", "", "10.25")).toBe(true);
  });
  it("rejects exponents, thousands separators, words and all-empty columns", () => {
    expect(col("1e3")).toBe(false);
    expect(col("1,000")).toBe(false);
    expect(col("12", "n/a")).toBe(false);
    expect(col("", "  ")).toBe(false);
    expect(col(".")).toBe(false);
  });
});

describe("nextSort (three-state cycle)", () => {
  it("cycles ascending → descending → file order and restarts on another column", () => {
    const a = nextSort(null, 1);
    expect(a).toEqual({ col: 1, dir: "ascending" });
    const d = nextSort(a, 1);
    expect(d).toEqual({ col: 1, dir: "descending" });
    expect(nextSort(d, 1)).toBeNull();
    expect(nextSort(d, 2)).toEqual({ col: 2, dir: "ascending" });
  });
});

describe("sortRows (S13 sort)", () => {
  const table = buildTable([
    ["n", "t"],
    ["10", "b"],
    ["", "A"],
    ["2", "a"],
    ["-1.5", ""],
    ["2", "c"],
  ]);
  const all = [0, 1, 2, 3, 4];

  it("sorts numbers numerically with empty cells last, stable for equal values", () => {
    expect(sortRows(table, all, { col: 0, dir: "ascending" })).toEqual([3, 2, 4, 0, 1]);
  });

  it("keeps empty cells last when descending, and equal values in file order", () => {
    expect(sortRows(table, all, { col: 0, dir: "descending" })).toEqual([0, 2, 4, 3, 1]);
  });

  it("sorts text with a base-sensitivity collator (case-insensitive ties keep file order)", () => {
    expect(sortRows(table, all, { col: 1, dir: "ascending" })).toEqual([1, 2, 0, 4, 3]);
    expect(sortRows(table, all, { col: 1, dir: "descending" })).toEqual([4, 0, 1, 2, 3]);
  });

  it("returns file order without a sort and never mutates its input", () => {
    const input = [4, 0, 2];
    expect(sortRows(table, input, null)).toEqual([4, 0, 2]);
    sortRows(table, input, { col: 0, dir: "ascending" });
    expect(input).toEqual([4, 0, 2]);
  });
});

describe("filterRows (S13 search)", () => {
  const table = buildTable([
    ["name", "country"],
    ["Lucía", "AR"],
    ["Mateo", "MX"],
    ["mx-store", "CL"],
  ]);

  it("is a trimmed, case-insensitive substring test on data cells only", () => {
    expect(filterRows(table.rows, "  mx ")).toEqual([1, 2]);
    expect(filterRows(table.rows, "LUC")).toEqual([0]);
    expect(filterRows(table.rows, "country")).toEqual([]);
  });

  it("shows every row for an empty box", () => {
    expect(filterRows(table.rows, "   ")).toEqual([0, 1, 2]);
  });
});

function bigTable(n: number): CsvTable {
  const records = [["id", "v"]];
  for (let i = 0; i < n; i++) records.push([String(i), i % 2 ? "odd" : "even"]);
  return buildTable(records);
}

describe("viewRows (filter, then sort — every shown row, no cap)", () => {
  it("filters first, then sorts", () => {
    const t = buildTable([["n"], ["3"], ["12"], ["1"], ["21"]]);
    expect(viewRows(t, "1", { col: 0, dir: "descending" })).toEqual([3, 1, 2]);
  });

  it("keeps every shown row (no 5,000 cap)", () => {
    const t = bigTable(12000);
    const v = viewRows(t, "", { col: 0, dir: "descending" });
    expect(v).toHaveLength(12000);
    expect(v[0]).toBe(11999);
    expect(viewRows(t, "odd", null)).toHaveLength(6000);
  });
});

describe("pages of 200 (S13 Large files)", () => {
  const list = Array.from({ length: 450 }, (_, i) => 1000 + i);

  it("uses pages of 200 rows", () => {
    expect(PAGE_SIZE).toBe(200);
  });

  it("counts pages, with at least one page", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(1)).toBe(1);
    expect(pageCount(200)).toBe(1);
    expect(pageCount(201)).toBe(2);
    expect(pageCount(100000)).toBe(500);
  });

  it("slices the current page, the last one partial", () => {
    expect(pageRows(list, 0)).toEqual(list.slice(0, 200));
    expect(pageRows(list, 1)[0]).toBe(1200);
    expect(pageRows(list, 2)).toEqual(list.slice(400));
    expect(pageRows(list, 2)).toHaveLength(50);
    expect(pageRows([], 0)).toEqual([]);
  });
});

describe("pagerState (pager label and buttons)", () => {
  it("labels the first page and disables « ‹", () => {
    expect(pagerState(0, 100000)).toEqual({ visible: true, label: "Rows 1–200 of 100,000", back: false, forward: true, last: 499 });
  });

  it("labels a middle page with both directions enabled", () => {
    expect(pagerState(1, 74920)).toMatchObject({ label: "Rows 201–400 of 74,920", back: true, forward: true });
  });

  it("labels the last partial page and disables › »", () => {
    expect(pagerState(2, 450)).toEqual({ visible: true, label: "Rows 401–450 of 450", back: true, forward: false, last: 2 });
  });

  it("is hidden when the shown rows fit on one page, including 0 rows", () => {
    expect(pagerState(0, 200)).toEqual({ visible: false, label: "", back: false, forward: false, last: 0 });
    expect(pagerState(0, 0)).toEqual({ visible: false, label: "", back: false, forward: false, last: 0 });
  });
});

describe("pageFor (the page follows the selection)", () => {
  const list = Array.from({ length: 450 }, (_, i) => 449 - i); // e.g. a descending sort

  it("is the page that holds the selected shown row, whatever the reset", () => {
    expect(pageFor(list, 449, 2, false)).toBe(0);
    expect(pageFor(list, 0, 0, true)).toBe(2);
    expect(pageFor(list, 249, 0, false)).toBe(1);
  });

  it("without a selection, a search or sort change goes to page 1", () => {
    expect(pageFor(list, null, 2, true)).toBe(0);
    // A selected row the search hid counts as no selection.
    expect(pageFor([1, 2, 3], 449, 2, true)).toBe(0);
  });

  it("without a selection, a live reload keeps the page, clamped to the last page", () => {
    expect(pageFor(list, null, 1, false)).toBe(1);
    expect(pageFor(list.slice(0, 250), null, 2, false)).toBe(1);
    expect(pageFor([], null, 3, false)).toBe(0);
  });
});

describe("status text", () => {
  it("reads <shown> of <total> rows", () => {
    expect(rowStatus(12, 12)).toBe("12 of 12 rows");
    expect(rowStatus(5000, 100000)).toBe("5,000 of 100,000 rows");
    expect(rowStatus(0, 0)).toBe("0 of 0 rows");
  });

  it("never adds the old 5,000-row notice (pages replace it, L45)", () => {
    expect(rowStatus(5001, 100000)).toBe("5,001 of 100,000 rows");
    expect(rowStatus(100000, 100000)).toBe("100,000 of 100,000 rows");
  });

  it("formats counts with a thousands separator independent of the locale", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(0)).toBe("0");
  });

  it("describes a row's position in file order for the inspector", () => {
    expect(rowPosition(0, 12)).toBe("Row 1 of 12 in file order");
    expect(rowPosition(99999, 100000)).toBe("Row 100,000 of 100,000 in file order");
  });
});

describe("delimiterFor (S13 delimiter rule, L40)", () => {
  const semi = "a;b\n1;2\n";
  const comma = "a,b\n1,2\n";
  const tab = "a\tb\n1\t2\n";

  it("auto-detected csv follows detectDelimiter (extension first, then sniffing)", () => {
    expect(delimiterFor(semi, "x.csv", false)).toBe(";");
    expect(delimiterFor(comma, "x.csv", false)).toBe(",");
    expect(delimiterFor(comma, "x.tsv", false)).toBe("\t");
    expect(delimiterFor(tab, null, false)).toBe("\t");
  });

  it("a manual csv choice uses ; if it qualifies, else , — except .tsv files keep tab", () => {
    expect(delimiterFor(tab, null, true)).toBe(",");
    expect(delimiterFor(semi, "notes.md", true)).toBe(";");
    expect(delimiterFor("hello world", "notes.md", true)).toBe(",");
    expect(delimiterFor(comma, "data.TSV", true)).toBe("\t");
  });
});

describe("columnOutline (S13 outline)", () => {
  it("lists the column names with their position and kind", () => {
    const o = columnOutline(buildTable([["id", ""], ["1", "x"]]));
    expect(o.sub).toBe("Columns · 2");
    expect(o.items).toEqual([
      { id: "col-0", label: "id", level: 0, icon: "1", mono: true, meta: "number" },
      { id: "col-1", label: "Column 2", level: 0, icon: "2", mono: true, meta: "text" },
    ]);
  });
});

describe("moveSelection (↑/↓ over every shown row)", () => {
  const list = Array.from({ length: 450 }, (_, i) => i);
  it("crosses a page edge, and the page follows", () => {
    const next = moveSelection(list, 199, 1);
    expect(next).toBe(200);
    expect(pageFor(list, next, 0, false)).toBe(1);
    const prev = moveSelection(list, 200, -1);
    expect(prev).toBe(199);
    expect(pageFor(list, prev, 1, false)).toBe(0);
  });
  it("does nothing at the first or last shown row", () => {
    expect(moveSelection(list, 0, -1)).toBe(0);
    expect(moveSelection(list, 449, 1)).toBe(449);
  });

  const drawn = [7, 2, 5];
  it("moves to the neighbour in the drawn order and stops at the ends", () => {
    expect(moveSelection(drawn, 2, 1)).toBe(5);
    expect(moveSelection(drawn, 2, -1)).toBe(7);
    expect(moveSelection(drawn, 5, 1)).toBe(5);
    expect(moveSelection(drawn, 7, -1)).toBe(7);
  });
  it("starts at the first row when nothing (or a hidden row) is selected", () => {
    expect(moveSelection(drawn, null, 1)).toBe(7);
    expect(moveSelection(drawn, 99, -1)).toBe(7);
    expect(moveSelection([], null, 1)).toBeNull();
  });
});
