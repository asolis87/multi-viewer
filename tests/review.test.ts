import { describe, expect, it } from "vitest";
import { formatReview, reviewExitCode, validateSubmission } from "../src/cli/review.js";
import { MAX_QUOTE, type ReviewComment } from "../src/shared/review.js";

const comment = (over: Partial<ReviewComment> = {}): ReviewComment => ({ kind: "change", startLine: 1, endLine: 1, text: "x", ...over });

describe("formatReview (S17)", () => {
  it("formats the S17 example exactly", () => {
    const out = formatReview("plan.md", {
      decision: "changes_requested",
      comments: [
        { kind: "answer", startLine: 40, endLine: 40, quote: "Should the cache be shared?", text: "Yes, one cache per process." },
        { kind: "change", startLine: 12, endLine: 14, quote: "Use Flask for the server", text: "Use FastAPI instead." },
      ],
    });
    expect(out).toBe(
      [
        "# Review: plan.md",
        "Decision: changes_requested",
        "Comments: 2",
        "",
        "## 1. Change request — lines 12–14",
        "> Use Flask for the server",
        "",
        "Use FastAPI instead.",
        "",
        "## 2. Answer — line 40",
        "> Should the cache be shared?",
        "",
        "Yes, one cache per process.",
        "",
      ].join("\n"),
    );
  });

  it("approved with no comments", () => {
    expect(formatReview("plan.md", { decision: "approved", comments: [] })).toBe("# Review: plan.md\nDecision: approved\nComments: 0\n");
  });

  it("names the Note kind and omits the quote for whole-block comments", () => {
    expect(formatReview("a.md", { decision: "approved_with_comments", comments: [comment({ kind: "note", startLine: 3, endLine: 3, text: "Nice." })] })).toBe(
      "# Review: a.md\nDecision: approved_with_comments\nComments: 1\n\n## 1. Note — line 3\n\nNice.\n",
    );
  });

  it("puts `> ` before every line of a multi-line quote", () => {
    const out = formatReview("a.md", { decision: "changes_requested", comments: [comment({ startLine: 2, endLine: 5, quote: "one\n\nthree", text: "t" })] });
    expect(out).toContain("## 1. Change request — lines 2–5\n> one\n> \n> three\n\nt\n");
  });

  it("escapes comment-text lines starting with # and keeps other lines as typed", () => {
    const out = formatReview("a.md", { decision: "changes_requested", comments: [comment({ text: "# Heading\nkeep # this\n## two\n  indented\n   # three spaces\n    # code" })] });
    expect(out).toContain("\n\n\\# Heading\nkeep # this\n\\## two\n  indented\n   \\# three spaces\n    # code\n");
  });

  it("orders by start line, then creation (array) order", () => {
    const out = formatReview("a.md", {
      decision: "changes_requested",
      comments: [comment({ startLine: 9, endLine: 9, text: "c" }), comment({ startLine: 2, endLine: 4, text: "a" }), comment({ startLine: 2, endLine: 2, text: "b" })],
    });
    const texts = out.split("\n").filter((l) => /^[abc]$/.test(l));
    expect(texts).toEqual(["a", "b", "c"]);
    expect(out).toContain("## 1. Change request — lines 2–4");
    expect(out).toContain("## 2. Change request — line 2");
    expect(out).toContain("## 3. Change request — line 9");
  });
});

describe("reviewExitCode (S17)", () => {
  it("0 for approvals, 3 for changes requested", () => {
    expect(reviewExitCode("approved")).toBe(0);
    expect(reviewExitCode("approved_with_comments")).toBe(0);
    expect(reviewExitCode("changes_requested")).toBe(3);
  });
});

describe("validateSubmission (S17)", () => {
  const ok = (body: unknown) => validateSubmission(body);

  it("accepts every decision with the right comments", () => {
    expect(ok({ decision: "approved", comments: [] })).toEqual({ ok: true, value: { decision: "approved", comments: [] } });
    const c = { kind: "answer", startLine: 2, endLine: 3, quote: "q", text: "t" };
    expect(ok({ decision: "approved_with_comments", comments: [c] })).toEqual({ ok: true, value: { decision: "approved_with_comments", comments: [c] } });
    expect(ok({ decision: "changes_requested", comments: [{ kind: "note", startLine: 1, endLine: 1, text: "t" }] })).toEqual({
      ok: true,
      value: { decision: "changes_requested", comments: [{ kind: "note", startLine: 1, endLine: 1, text: "t" }] },
    });
  });

  it("keeps only the contract fields", () => {
    const r = ok({ decision: "changes_requested", extra: 1, comments: [{ kind: "change", startLine: 1, endLine: 1, text: "t", id: "x" }] });
    expect(r).toEqual({ ok: true, value: { decision: "changes_requested", comments: [{ kind: "change", startLine: 1, endLine: 1, text: "t" }] } });
  });

  it("accepts a quote of exactly MAX_QUOTE characters, counting code points", () => {
    expect(ok({ decision: "changes_requested", comments: [comment({ quote: "a".repeat(MAX_QUOTE) })] }).ok).toBe(true);
    expect(ok({ decision: "changes_requested", comments: [comment({ quote: "😀".repeat(MAX_QUOTE) })] }).ok).toBe(true);
  });

  const bad: [string, unknown, string][] = [
    ["not an object", [], "body must be an object"],
    ["null", null, "body must be an object"],
    ["unknown decision", { decision: "maybe", comments: [] }, "decision must be approved, approved_with_comments or changes_requested"],
    ["comments not an array", { decision: "approved", comments: {} }, "comments must be an array"],
    ["comment not an object", { decision: "changes_requested", comments: ["x"] }, "comments[0] must be an object"],
    ["unknown kind", { decision: "changes_requested", comments: [comment({ kind: "praise" as never })] }, "comments[0].kind must be change, answer or note"],
    ["startLine 0", { decision: "changes_requested", comments: [comment({ startLine: 0 })] }, "comments[0].startLine must be an integer of at least 1"],
    ["startLine not integer", { decision: "changes_requested", comments: [comment({ startLine: 1.5, endLine: 2 })] }, "comments[0].startLine must be an integer of at least 1"],
    ["endLine string", { decision: "changes_requested", comments: [comment({ endLine: "2" as never })] }, "comments[0].endLine must be an integer of at least 1"],
    ["startLine > endLine", { decision: "changes_requested", comments: [comment({ startLine: 5, endLine: 4 })] }, "comments[0].startLine must not be greater than endLine"],
    ["blank text", { decision: "changes_requested", comments: [comment({ text: " \n\t" })] }, "comments[0].text must not be blank"],
    ["text not a string", { decision: "changes_requested", comments: [comment({ text: 3 as never })] }, "comments[0].text must not be blank"],
    ["quote not a string", { decision: "changes_requested", comments: [comment({ quote: 3 as never })] }, "comments[0].quote must be a string of at most 500 characters"],
    ["quote too long", { decision: "changes_requested", comments: [comment({ quote: "a".repeat(MAX_QUOTE + 1) })] }, "comments[0].quote must be a string of at most 500 characters"],
    ["approved with comments", { decision: "approved", comments: [comment()] }, "approved must have no comments"],
    ["approved_with_comments without comments", { decision: "approved_with_comments", comments: [] }, "approved_with_comments needs at least one comment"],
    ["changes_requested without comments", { decision: "changes_requested", comments: [] }, "changes_requested needs at least one comment"],
    ["second comment invalid", { decision: "changes_requested", comments: [comment(), comment({ kind: "x" as never })] }, "comments[1].kind must be change, answer or note"],
  ];
  for (const [name, body, error] of bad) {
    it(`rejects ${name}`, () => {
      expect(ok(body)).toEqual({ ok: false, error });
    });
  }
});
