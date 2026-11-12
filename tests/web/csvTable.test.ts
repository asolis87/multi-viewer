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
  ROW_CAP,
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

describe("viewRows (filter, then sort, then the 5,000 cap)", () => {
  it("filters first, then sorts", () => {
    const t = buildTable([["n"], ["3"], ["12"], ["1"], ["21"]]);
    expect(viewRows(t, "1", { col: 0, dir: "descending" })).toEqual({ matched: 3, drawn: [3, 1, 2] });
  });

  it("draws at most 5,000 rows taken after search and sort", () => {
    expect(ROW_CAP).toBe(5000);
    const t = bigTable(12000);
    const v = viewRows(t, "", { col: 0, dir: "descending" });
    expect(v.matched).toBe(12000);
    expect(v.drawn).toHaveLength(5000);
    expect(v.drawn[0]).toBe(11999);
    expect(viewRows(t, "odd", null).matched).toBe(6000);
  });
});

describe("status text", () => {
  it("reads <shown> of <total> rows", () => {
    expect(rowStatus(12, 12)).toBe("12 of 12 rows");
    expect(rowStatus(5000, 100000)).toBe("5,000 of 100,000 rows");
    expect(rowStatus(0, 0)).toBe("0 of 0 rows");
  });

  it("adds the notice only when more than 5,000 rows match", () => {
    expect(rowStatus(5001, 100000)).toBe("5,001 of 100,000 rows — showing the first 5,000; refine the search to see more");
    expect(rowStatus(100000, 100000)).toBe(
      "100,000 of 100,000 rows — showing the first 5,000; refine the search to see more",
    );
  });

  it("formats counts with a thousands separator independent of the locale", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
  });

  it("describes a row's position in file order for the inspector", () => {
    expect(rowPosition(0, 12)).toBe("Row 1 of 12 in file order");
    expect(rowPosition(4999, 100000)).toBe("Row 5,000 of 100,000 in file order");
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

describe("moveSelection (↑/↓ in the drawn order)", () => {
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
