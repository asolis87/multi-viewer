/** Review submission contract shared by the review page and `POST /api/review` (S17). */

export type ReviewDecision = "approved" | "approved_with_comments" | "changes_requested";
export type CommentKind = "change" | "answer" | "note";

export interface ReviewComment {
  kind: CommentKind;
  /** 1-based, inclusive source lines as captured when the comment was made. */
  startLine: number;
  endLine: number;
  /** Selected text, at most `MAX_QUOTE` characters; absent for whole-block comments. */
  quote?: string;
  text: string;
}

export interface ReviewSubmission {
  decision: ReviewDecision;
  comments: ReviewComment[];
}

export const MAX_QUOTE = 500;
export const MAX_BODY_BYTES = 256 * 1024;
