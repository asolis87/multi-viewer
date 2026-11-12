import { describe, expect, it } from "vitest";
import { csvDelimiter, delimiterQualifies, detectDelimiter, parseCsv, scanRecords } from "../src/shared/csv.js";

describe("parseCsv (S13, RFC 4180)", () => {
  it("splits records and fields", () => {
    expect(parseCsv("a,b,c\n1,2,3", ",")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("uses the given delimiter only", () => {
    expect(parseCsv("a;b,c\n1;2,3", ";")).toEqual([
      ["a", "b,c"],
      ["1", "2,3"],
    ]);
    expect(parseCsv("a\tb\n1\t2", "\t")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("unwraps quoted fields; `\"\"` inside quotes is one quote", () => {
    expect(parseCsv('"a","say ""hi"""\n"x",""', ",")).toEqual([
      ["a", 'say "hi"'],
      ["x", ""],
    ]);
  });

  it("keeps the delimiter and line breaks literal inside quotes", () => {
    expect(parseCsv('name,note\n"Doe, J","line 1\nline 2"\nx,y', ",")).toEqual([
      ["name", "note"],
      ["Doe, J", "line 1\nline 2"],
      ["x", "y"],
    ]);
    expect(parseCsv('a,"r\r\nn"', ",")).toEqual([["a", "r\r\nn"]]);
  });

  it("an unclosed quote runs to the end of the text", () => {
    expect(parseCsv('a,"b\nc,d\ne', ",")).toEqual([["a", "b\nc,d\ne"]]);
  });

  it("a quote inside an unquoted field is literal text", () => {
    expect(parseCsv('5" screen,a"b"\nx,y', ",")).toEqual([
      ['5" screen', 'a"b"'],
      ["x", "y"],
    ]);
  });

  it("ignores a UTF-8 BOM", () => {
    expect(parseCsv("\uFEFFa,b\n1,2", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("CRLF and LF both end records", () => {
    expect(parseCsv("a,b\r\n1,2\n3,4\r\n", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("skips blank lines between records and a trailing empty line", () => {
    expect(parseCsv("\na,b\n\n\r\n1,2\n\n", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("a trailing delimiter makes an empty last field", () => {
    expect(parseCsv("a,b,\n1,2,", ",")).toEqual([
      ["a", "b", ""],
      ["1", "2", ""],
    ]);
  });

  it("keeps ragged rows as they are", () => {
    expect(parseCsv("a,b,c\n1\n1,2,3,4", ",")).toEqual([["a", "b", "c"], ["1"], ["1", "2", "3", "4"]]);
  });

  it("empty content yields no records", () => {
    expect(parseCsv("", ",")).toEqual([]);
    expect(parseCsv("\uFEFF\n\n", ",")).toEqual([]);
  });
});

describe("delimiter qualification (S13)", () => {
  it("qualifies when every record has the same number of fields, at least 2", () => {
    expect(delimiterQualifies("a,b\n1,2\n3,4", ",")).toBe(true);
    expect(delimiterQualifies("a,b\n1,2,3", ",")).toBe(false);
  });

  it("a one-column file does not qualify", () => {
    for (const d of [",", ";", "\t"] as const) expect(delimiterQualifies("name\nAna\nBea", d)).toBe(false);
    expect(detectDelimiter("name\nAna\nBea")).toBeNull();
  });

  it("counts records, not physical lines (quoted line break)", () => {
    expect(delimiterQualifies('a,b\n"multi\nline",2\nx,y', ",")).toBe(true);
  });

  it("skips blank records", () => {
    expect(delimiterQualifies("a,b\n\n1,2\n\n", ",")).toBe(true);
  });

  it("looks only at the first 20 records: a ragged 21st record still qualifies", () => {
    const rows = Array.from({ length: 20 }, (_, i) => `${i},x`);
    expect(delimiterQualifies([...rows, "ragged,1,2,3"].join("\n"), ",")).toBe(true);
    expect(delimiterQualifies([...rows.slice(0, 19), "ragged,1,2,3"].join("\n"), ",")).toBe(false);
  });

  it("blank lines do not count toward the 20-record window", () => {
    const rows = Array.from({ length: 20 }, (_, i) => `${i},x`);
    expect(delimiterQualifies(["", ...rows.join("\n\n").split("\n"), "ragged,1,2"].join("\n"), ",")).toBe(true);
  });

  it("does not qualify when the window ends inside an open quote", () => {
    expect(delimiterQualifies('a,b\n1,"open\n2,3\n4,5', ",")).toBe(false);
    // An open quote after the 20th record is outside the window.
    const rows = Array.from({ length: 20 }, (_, i) => `${i},x`);
    expect(delimiterQualifies([...rows, '1,"open', "2,3"].join("\n"), ",")).toBe(true);
  });

  it("detection reads at most 20 records", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => `${i},x`);
    const scan = scanRecords(rows.join("\n"), ",", 20);
    expect(scan.records).toHaveLength(20);
    expect(scan.records.at(-1)?.fields).toEqual(["19", "x"]);
  });
});

describe("detectDelimiter (S13)", () => {
  const semicolons = "a;b\n1;2";
  const commas = "a,b\n1,2";
  const both = "a;b,c\n1;2,3";
  const tabs = "a\tb\n1\t2";

  it(".tsv is always tab", () => {
    expect(detectDelimiter(commas, "data.tsv")).toBe("\t");
    expect(detectDelimiter("one column", "DATA.TSV")).toBe("\t");
  });

  it(".csv uses `;` when it qualifies, else `,`", () => {
    expect(detectDelimiter(semicolons, "data.csv")).toBe(";");
    expect(detectDelimiter(both, "data.csv")).toBe(";");
    expect(detectDelimiter(commas, "data.CSV")).toBe(",");
    expect(detectDelimiter(tabs, "data.csv")).toBe(",");
    expect(detectDelimiter("one column", "data.csv")).toBe(",");
  });

  it("a manual csv choice uses `;` when it qualifies, else `,`", () => {
    expect(csvDelimiter(semicolons)).toBe(";");
    expect(csvDelimiter(commas)).toBe(",");
    expect(csvDelimiter(tabs)).toBe(",");
  });

  it("without a known extension: first that qualifies in the order tab, `;`, `,`", () => {
    expect(detectDelimiter(tabs)).toBe("\t");
    expect(detectDelimiter(semicolons, null)).toBe(";");
    expect(detectDelimiter(commas, "notes.txt")).toBe(",");
    expect(detectDelimiter("a\tb;c,d\n1\t2;3,4")).toBe("\t");
    expect(detectDelimiter(both)).toBe(";");
    // `;` does not qualify (ragged), so `,` wins.
    expect(detectDelimiter("a;b,c\n1,2")).toBe(",");
  });

  it("returns null when nothing qualifies", () => {
    expect(detectDelimiter("")).toBeNull();
    expect(detectDelimiter("just prose\nwith lines")).toBeNull();
  });
});
