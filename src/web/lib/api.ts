import type { Doc } from "./doc.js";
import type { ReviewSubmission } from "../../shared/review.js";
import { connectLive, type Connection } from "./events.js";

/** The per-run token from the URL printed by the CLI (`/?t=<token>`). */
export function readToken(search: string): string {
  return new URLSearchParams(search).get("t") ?? "";
}

export type DocResult = { ok: true; doc: Doc } | { ok: false; error: string; status: number };

export async function fetchDoc(token: string): Promise<DocResult> {
  let res: Response;
  try {
    res = await fetch(`/api/doc?t=${encodeURIComponent(token)}`, { cache: "no-store" });
  } catch {
    return { ok: false, status: 0, error: "Can’t reach the mview server. Is the command still running?" };
  }
  if (res.status === 403) {
    return { ok: false, status: 403, error: "This page needs the link printed by mview (the access token is missing or wrong)." };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* handled below */
  }
  if (!res.ok) {
    const message = (body as { error?: unknown } | null)?.error;
    return { ok: false, status: res.status, error: typeof message === "string" ? message : `The server answered ${res.status}.` };
  }
  return { ok: true, doc: body as Doc };
}

/**
 * Subscribe to live reload for this page (S2, S11, S14): `onChange` fires on every `change` event;
 * `onDoc` gets the document from a successful reconnect check. See `connectLive`.
 */
export function watchEvents(
  token: string,
  handlers: {
    onChange: () => void;
    onDoc: (doc: Doc) => void;
    onConnection: (c: Connection) => void;
    /** `event: submitted` (S17): the review of this run was sent from some tab. */
    onSubmitted?: () => void;
    /** False on review pages: S14's hidden-tab close does not apply (S17). */
    closeWhenHidden?: () => boolean;
  },
): () => void {
  const live = connectLive({
    ...handlers,
    openStream: () => new EventSource(`/api/events?t=${encodeURIComponent(token)}`),
    checkDoc: () => fetchDoc(token),
    isHidden: () => document.visibilityState === "hidden",
  });
  const onVisibility = () => live.visibilityChanged();
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    live.stop();
  };
}

export type ReviewResult = { ok: true } | { ok: false; status: number; error: string };

/** Send the review (S17): `POST /api/review?t=<token>` with the submission as JSON. */
export async function postReview(token: string, submission: ReviewSubmission): Promise<ReviewResult> {
  let res: Response;
  try {
    res = await fetch(`/api/review?t=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submission),
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, error: "Can’t reach the mview server. Is the command still running?" };
  }
  if (res.ok) return { ok: true };
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* handled below */
  }
  const message = (body as { error?: unknown } | null)?.error;
  return { ok: false, status: res.status, error: typeof message === "string" ? message : `The server answered ${res.status}.` };
}
