import type { Doc } from "./doc.js";
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
  handlers: { onChange: () => void; onDoc: (doc: Doc) => void; onConnection: (c: Connection) => void },
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
