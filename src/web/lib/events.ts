import type { Doc, DocSource } from "./doc.js";
import type { DocResult } from "./api.js";

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

/** A page hidden this long (real elapsed time) closes its events stream (S14 B). */
export const HIDDEN_CLOSE_MS = 30 * 60 * 1000;

export type Connection = "connecting" | "live" | "stopped";

/** The part of `EventSource` the page uses (a fake in tests). */
export interface EventStream {
  onopen: ((ev: Event) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  addEventListener(type: "change", fn: () => void): void;
  close(): void;
}

export interface LiveDeps {
  openStream: () => EventStream;
  /** One `/api/doc` request with the token. */
  checkDoc: () => Promise<DocResult>;
  /** A `change` event (live reload, S2). */
  onChange: () => void;
  /** The document from a successful reconnect check. */
  onDoc: (doc: Doc) => void;
  onConnection: (c: Connection) => void;
  now?: () => number;
  isHidden?: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  hiddenCloseMs?: number;
}

/**
 * Keep the events stream for one page (S11, S14). A page hidden for `hiddenCloseMs` of real time
 * closes it (checked by a timer and on every visibility change). It reconnects when it becomes
 * visible after that, and when the stream drops for any other reason: exactly one `/api/doc` check;
 * success opens a new stream, failure stops for good (no retries, the browser's included).
 */
export function connectLive(deps: LiveDeps): { visibilityChanged(): void; stop(): void } {
  const now = deps.now ?? Date.now;
  const isHidden = deps.isHidden ?? (() => false);
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const limit = deps.hiddenCloseMs ?? HIDDEN_CLOSE_MS;

  /** open: a stream exists · closed: closed after being hidden · checking · stopped (final). */
  let state: "open" | "closed" | "checking" | "stopped" = "open";
  let stream: EventStream | null = null;
  let hiddenSince: number | null = null;
  let timer: unknown = null;
  let ended = false;

  function clear() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function closeStream() {
    stream?.close();
    stream = null;
  }

  function stopForGood() {
    state = "stopped";
    clear();
    deps.onConnection("stopped");
  }

  /** `afterCheck`: opened right after a reconnect check, so it must open before it may check again. */
  function open(afterCheck = false) {
    const s = deps.openStream();
    stream = s;
    state = "open";
    let opened = false;
    deps.onConnection("connecting");
    s.onopen = () => {
      opened = true;
      if (stream === s) deps.onConnection("live");
    };
    s.onerror = () => {
      if (stream !== s) return;
      closeStream();
      // A stream that fails before opening right after a check means whatever answered the check
      // is not this mview (e.g. another server on the old port): stop instead of looping (L59).
      if (afterCheck && !opened) stopForGood();
      else void check();
    };
    s.addEventListener("change", () => {
      if (stream === s) deps.onChange();
    });
    if (hiddenSince !== null) arm();
  }

  async function check() {
    state = "checking";
    deps.onConnection("connecting");
    let result: DocResult;
    try {
      result = await deps.checkDoc();
    } catch {
      result = { ok: false, status: 0, error: "" };
    }
    if (ended) return;
    if (!result.ok && (result.status === 0 || result.status === 403)) {
      // No answer, or the token is not this server's: the mview that served this page is gone.
      stopForGood();
      return;
    }
    if (result.ok) deps.onDoc(result.doc);
    open(true);
    // The server answered with an error (e.g. 500: the watched file is missing right now, S2):
    // it is alive, so reload through the live-reload path, which shows the error (L58).
    if (!result.ok) deps.onChange();
  }

  /** Close the stream once the page has been hidden long enough; otherwise wait for the rest. */
  function arm() {
    clear();
    if (hiddenSince === null || state !== "open") return;
    const left = limit - (now() - hiddenSince);
    if (left <= 0) {
      closeStream();
      state = "closed";
      return;
    }
    timer = setTimer(() => {
      timer = null;
      arm();
    }, left);
  }

  function visibilityChanged() {
    if (ended || state === "stopped") return;
    if (isHidden()) {
      hiddenSince ??= now();
      arm();
      return;
    }
    arm(); // a throttled timer may not have run: real elapsed time decides
    hiddenSince = null;
    clear();
    if (state === "closed") void check();
  }

  open();
  if (isHidden()) visibilityChanged();

  return {
    visibilityChanged,
    stop() {
      ended = true;
      clear();
      closeStream();
    },
  };
}

/** Only a watched file page shows the document from a reconnect; pasted content is never replaced (S3). */
export function replaceOnReconnect(state: { source: DocSource | null; pastedHere: boolean; loadStatus: number | null }): boolean {
  return reloadOnChange(state);
}

/** Status-bar connection text. Only file pages depend on the connection. */
export function liveStatus(s: {
  source: DocSource | null;
  name: string;
  hasDoc: boolean;
  loadFailed: boolean;
  pastedHere: boolean;
  connection: Connection;
}): { text: string; dot: "ok" | "off" | "idle" } {
  if (s.pastedHere) return { text: "Not watching · pasted in this tab", dot: "idle" };
  if (!s.hasDoc) return { text: s.loadFailed ? "Not connected" : "Connecting…", dot: "idle" };
  if (s.source === "file") {
    if (s.connection === "live") return { text: `Live · watching ${s.name}`, dot: "ok" };
    if (s.connection === "stopped") return { text: "Stopped — run mview again for live reload", dot: "off" };
    return { text: "Connecting…", dot: "idle" };
  }
  if (s.source === "stdin") return { text: "Not watching · read from stdin", dot: "idle" };
  if (s.source === "paste") return { text: "Not watching · from clipboard", dot: "idle" };
  return { text: "Waiting for input", dot: "idle" };
}
