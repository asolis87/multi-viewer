import type { Doc } from "./doc.js";

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

export type Connection = "connecting" | "live" | "disconnected";

/**
 * Subscribe to live reload. `onChange` fires on every `change` event and after a
 * reconnect (the file may have changed while disconnected). EventSource retries by itself.
 */
export function watchEvents(token: string, onChange: () => void, onConnection: (c: Connection) => void): () => void {
  const source = new EventSource(`/api/events?t=${encodeURIComponent(token)}`);
  let dropped = false;
  onConnection("connecting");
  source.onopen = () => {
    onConnection("live");
    if (dropped) onChange();
    dropped = false;
  };
  source.onerror = () => {
    dropped = true;
    onConnection("disconnected");
  };
  source.addEventListener("change", onChange);
  return () => source.close();
}
