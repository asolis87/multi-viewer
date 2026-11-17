import { MAX_QUOTE, type CommentKind, type ReviewComment, type ReviewDecision, type ReviewSubmission } from "../shared/review.js";

const DECISIONS: readonly ReviewDecision[] = ["approved", "approved_with_comments", "changes_requested"];
const KINDS: readonly CommentKind[] = ["change", "answer", "note"];
const KIND_LABELS: Record<CommentKind, string> = { change: "Change request", answer: "Answer", note: "Note" };

/** S17 exit codes for a submitted decision (no decision is 4, handled by the CLI). */
export function reviewExitCode(decision: ReviewDecision): number {
  return decision === "changes_requested" ? 3 : 0;
}

export type Validation = { ok: true; value: ReviewSubmission } | { ok: false; error: string };

/** Checks a parsed `POST /api/review` body against the S17 contract; keeps only the contract fields. */
export function validateSubmission(body: unknown): Validation {
  const fail = (error: string): Validation => ({ ok: false, error });
  if (!isObject(body)) return fail("body must be an object");
  const decision = body.decision;
  if (typeof decision !== "string" || !(DECISIONS as readonly string[]).includes(decision)) {
    return fail("decision must be approved, approved_with_comments or changes_requested");
  }
  if (!Array.isArray(body.comments)) return fail("comments must be an array");

  const comments: ReviewComment[] = [];
  for (const [i, raw] of body.comments.entries()) {
    const at = `comments[${i}]`;
    if (!isObject(raw)) return fail(`${at} must be an object`);
    const { kind, startLine, endLine, quote, text } = raw;
    if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) return fail(`${at}.kind must be change, answer or note`);
    if (!isLine(startLine)) return fail(`${at}.startLine must be an integer of at least 1`);
    if (!isLine(endLine)) return fail(`${at}.endLine must be an integer of at least 1`);
    if (startLine > endLine) return fail(`${at}.startLine must not be greater than endLine`);
    if (typeof text !== "string" || text.trim() === "") return fail(`${at}.text must not be blank`);
    // Counted in code points, so a page that cuts by UTF-16 units or by code points is never rejected.
    if (quote !== undefined && (typeof quote !== "string" || [...quote].length > MAX_QUOTE)) {
      return fail(`${at}.quote must be a string of at most ${MAX_QUOTE} characters`);
    }
    comments.push({ kind: kind as CommentKind, startLine, endLine, ...(quote !== undefined ? { quote } : {}), text });
  }

  if (decision === "approved" && comments.length > 0) return fail("approved must have no comments");
  if (decision !== "approved" && comments.length === 0) return fail(`${decision} needs at least one comment`);
  return { ok: true, value: { decision: decision as ReviewDecision, comments } };
}

/**
 * The S17 result: a Markdown summary written to stdout. Comments are in document order
 * (start line, then creation order — the array order; the sort is stable).
 */
export function formatReview(name: string, submission: ReviewSubmission): string {
  const comments = [...submission.comments].sort((a, b) => a.startLine - b.startLine);
  const head = `# Review: ${name}\nDecision: ${submission.decision}\nComments: ${comments.length}\n`;
  const sections = comments.map((c, i) => {
    const lines = c.startLine === c.endLine ? `line ${c.startLine}` : `lines ${c.startLine}–${c.endLine}`;
    const parts = [`## ${i + 1}. ${KIND_LABELS[c.kind]} — ${lines}`];
    if (c.quote !== undefined && c.quote.trim() !== "") parts.push(splitLines(c.quote).map((l) => `> ${l}`).join("\n"));
    // A `#` after at most three spaces would start a heading and end this comment's section.
    const text = splitLines(c.text).map((l) => l.replace(/^( {0,3})#/, "$1\\#")).join("\n");
    return `${parts.join("\n")}\n\n${text}\n`;
  });
  return [head, ...sections].join("\n");
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLine(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}
