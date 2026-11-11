import { describe, expect, it } from "vitest";
import { detectType, firstMeaningfulLine } from "../src/shared/detect.js";

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
