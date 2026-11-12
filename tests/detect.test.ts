import { describe, expect, it } from "vitest";
import { DOC_TYPES, detectType, firstMeaningfulLine } from "../src/shared/detect.js";

describe("detectType by filename extension", () => {
  it.each([
    ["notes.md", "markdown"],
    ["README.markdown", "markdown"],
    ["flow.mmd", "mermaid"],
    ["flow.mermaid", "mermaid"],
    ["data.json", "json"],
    ["DATA.JSON", "json"],
  ] as const)("%s -> %s", (name, expected) => {
    expect(detectType("anything", name)).toBe(expected);
  });

  it("extension wins over content", () => {
    expect(detectType('{"a":1}', "notes.md")).toBe("markdown");
  });

  it("unknown extension falls back to content sniffing", () => {
    expect(detectType('{"a":1}', "response.txt")).toBe("json");
  });
});

describe("detectType by content", () => {
  it("valid JSON object is json", () => {
    expect(detectType('  {"a": [1, 2]}\n')).toBe("json");
  });

  it("valid JSON array is json", () => {
    expect(detectType("[1, 2, 3]")).toBe("json");
  });

  it("bare JSON scalars are not treated as json", () => {
    expect(detectType("42")).toBe("markdown");
    expect(detectType("true")).toBe("markdown");
  });

  it("invalid JSON is not json", () => {
    expect(detectType("{ not json")).toBe("markdown");
  });

  it.each([
    "flowchart LR\n  A --> B",
    "graph TD\n  A --> B",
    "sequenceDiagram\n  A->>B: hi",
    "classDiagram\n  A <|-- B",
    "stateDiagram-v2\n  [*] --> A",
    "erDiagram\n  A ||--o{ B : has",
    "gantt\n  title X",
    "pie title Pets\n  \"Dogs\" : 3",
    "mindmap\n  root",
    "journey\n  title X",
    "gitGraph\n  commit",
    "timeline\n  title X",
  ])("mermaid keyword: %s", (content) => {
    expect(detectType(content)).toBe("mermaid");
  });

  it.each([
    "classDiagram-v2\n  A <|-- B",
    "flowchart-elk TD\n  A --> B",
    "gitGraph:\n  commit",
    "zenuml\n  A.method()",
    "radar-beta\n  axis a, b",
    "treemap-beta\n  \"Root\"",
  ])("mermaid variant keyword (T17): %s", (content) => {
    expect(detectType(content)).toBe("mermaid");
  });

  it("skips leading blank lines and mermaid comments/front-matter", () => {
    expect(detectType("\n\n%% comment\nflowchart LR\n A-->B")).toBe("mermaid");
    expect(detectType("---\ntitle: X\n---\nflowchart LR\n A-->B")).toBe("mermaid");
  });

  it("markdown that mentions a keyword mid-text stays markdown", () => {
    expect(detectType("# Title\n\nflowchart LR")).toBe("markdown");
  });

  it("fenced mermaid inside markdown stays markdown", () => {
    expect(detectType("Here:\n```mermaid\nflowchart LR\n A-->B\n```")).toBe("markdown");
  });

  it("a keyword prefix of a word is not mermaid", () => {
    expect(detectType("graphics are nice")).toBe("markdown");
  });

  it("empty content is markdown", () => {
    expect(detectType("")).toBe("markdown");
  });
});

describe("firstMeaningfulLine (shared by CLI detection and the frontend, T13)", () => {
  it("skips blank lines, %% comments and front-matter", () => {
    expect(firstMeaningfulLine("\n  \n%% note\n  flowchart LR  \nA-->B")).toBe("flowchart LR");
    expect(firstMeaningfulLine("---\ntitle: X\n---\n\nsequenceDiagram")).toBe("sequenceDiagram");
  });

  it("returns null when nothing meaningful remains", () => {
    expect(firstMeaningfulLine("")).toBeNull();
    expect(firstMeaningfulLine("\n%% only a comment\n")).toBeNull();
  });
});

describe("detectType CSV/TSV (S13)", () => {
  it.each([
    ["data.csv", "csv"],
    ["DATA.CSV", "csv"],
    ["data.tsv", "csv"],
  ] as const)("%s -> %s", (name, expected) => {
    expect(detectType("anything", name)).toBe(expected);
  });

  it("S4 extensions are unchanged by tabular content", () => {
    expect(detectType("a,b\n1,2", "notes.md")).toBe("markdown");
    expect(detectType("a,b\n1,2", "flow.mmd")).toBe("mermaid");
    expect(detectType("a,b\n1,2", "data.json")).toBe("json");
  });

  it.each([
    ["comma", "name,age\nAna,30\nBea,41"],
    ["semicolon", "name;age\nAna;30"],
    ["tab", "name\tage\nAna\t30"],
    ["quoted line break", 'name,note\n"Ana","a\nb"'],
    ["trailing empty line", "a,b\n1,2\n"],
    ["unknown extension", "a,b\n1,2"],
  ])("tabular content is csv: %s", (_label, content) => {
    expect(detectType(content, _label === "unknown extension" ? "out.txt" : null)).toBe("csv");
  });

  it("needs at least 2 non-blank records", () => {
    expect(detectType("a,b")).toBe("markdown");
    expect(detectType("\n\na,b\n\n")).toBe("markdown");
  });

  it("a one-column file is not tabular", () => {
    expect(detectType("name\nAna\nBea")).toBe("markdown");
  });

  it("prose with commas stays markdown", () => {
    expect(detectType("Hello, world.")).toBe("markdown");
    expect(detectType("Hello, world.\nI like apples, pears, and plums.\nThe end.")).toBe("markdown");
  });

  it("a Markdown table stays markdown", () => {
    expect(detectType("| a | b |\n|---|---|\n| 1 | 2 |")).toBe("markdown");
    // Even when every row has the same number of commas.
    expect(detectType("| a, b | c |\n| 1, 2 | 3 |")).toBe("markdown");
  });

  it("a heading followed by comma lines stays markdown", () => {
    expect(detectType("# Title, part 2\na,b\nc,d")).toBe("markdown");
    expect(detectType("# Title\na,b\nc,d")).toBe("markdown");
  });

  it("front matter is not skipped and stays markdown", () => {
    expect(detectType("---\ntitle: a, b\n---\nx, y")).toBe("markdown");
    expect(detectType("--- a, b\nc, d")).toBe("markdown");
  });

  it("the first-line check uses trimmed lines within the first 20 records", () => {
    expect(detectType("a,b\n  # x,y")).toBe("markdown");
    const rows = Array.from({ length: 20 }, (_, i) => `${i},x`);
    expect(detectType([...rows, "# late,x"].join("\n"))).toBe("csv");
  });

  it("JSON and Mermaid take precedence over tabular", () => {
    expect(detectType('[1, 2]\n')).toBe("json");
    expect(detectType('{"a": 1,\n "b": 2}')).toBe("json");
    expect(detectType("graph TD; A,B\nC,D")).toBe("mermaid");
    expect(detectType("pie title a, b\n\"x\", 3")).toBe("mermaid");
  });
});

describe("detection that must not change with S13", () => {
  it.each([
    ["# Title\n\nSome *text*, with a comma.", "markdown"],
    ["- a, b\n- c", "markdown"],
    ["Here:\n```mermaid\nflowchart LR\n A-->B\n```", "markdown"],
    ["", "markdown"],
    ["42", "markdown"],
    ["flowchart LR\n  A --> B", "mermaid"],
    ["sequenceDiagram\n  A->>B: hi", "mermaid"],
    ["---\ntitle: X\n---\nflowchart LR\n A-->B", "mermaid"],
    ['{"a": [1, 2]}', "json"],
    ["[1, 2, 3]", "json"],
  ] as const)("%j -> %s", (content, expected) => {
    expect(detectType(content)).toBe(expected);
  });
});

describe("DOC_TYPES (S13)", () => {
  it("includes csv after the S8 types", () => {
    expect(DOC_TYPES).toEqual(["markdown", "mermaid", "json", "csv"]);
  });
});
