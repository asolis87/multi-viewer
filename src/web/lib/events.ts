import type { DocSource } from "./doc.js";

/**
 * Every page with a token keeps `/api/events` open for its whole life, whatever the source and
 * also after a paste: the open stream is how `--auto-close` knows a page is open (S11).
 * A 403 means the token is wrong, so there is nothing to keep open.
 */
export function keepEventsOpen(state: {
  token: string;
  loadStatus: number | null;
  source: DocSource | null;
  pastedHere: boolean;
}): boolean {
  return state.token !== "" && state.loadStatus !== 403;
}

/**
 * Live reload only makes sense for a watched file: refetch on `change` (no page reload).
 * A first load that failed with 500 (unreadable file) also reloads, so restoring the file recovers.
 */
export function reloadOnChange(state: { source: DocSource | null; pastedHere: boolean; loadStatus: number | null }): boolean {
  if (state.pastedHere) return false;
  return state.source === "file" || (state.source === null && state.loadStatus === 500);
}
