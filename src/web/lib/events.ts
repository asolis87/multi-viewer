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
  /** A review page after its review was sent (S17): the server is stopping. */
  sent?: boolean;
}): boolean {
  return state.token !== "" && state.loadStatus !== 403 && !state.sent;
}

/**
 * S14's hidden-tab close applies to every page except review pages (S17): a review stays open
 * while the human reads the plan in another window; closing every tab still ends it (S11).
 */
export function closeWhenHidden(state: { review: boolean | undefined }): boolean {
  return state.review !== true;
}

/** The inputs of the live reload / reconnect gate (S2, S14, S18). */
export interface GateState {
  source: DocSource | null;
  pastedHere: boolean;
  loadStatus: number | null;
  /** The edited text differs from the disk content (S18). */
  edits?: boolean;
}

/**
 * The one gate shared by live reload and reconnect. `ignore`: this page never takes a new document;
 * `show`: the document replaces what is shown (and the text of an open editor); `keep-edits`: the
 * file is still read, but only the disk content is updated — the edited text, the editor and the
 * rendered view stay, a failed load included, and the page shows the file-changed notice (S18).
 */
export function docGate(state: GateState): "ignore" | "show" | "keep-edits" {
  if (state.pastedHere) return "ignore";
  if (!(state.source === "file" || (state.source === null && state.loadStatus === 500))) return "ignore";
  return state.edits ? "keep-edits" : "show";
}

/**
 * Live reload only makes sense for a watched file: refetch on `change` (no page reload).
 * A first load that failed with 500 (unreadable file) also reloads, so restoring the file recovers.
 * With edits it still refetches: the disk content is updated, the edited text is kept (`docGate`).
 */
export function reloadOnChange(state: GateState): boolean {
  return docGate(state) !== "ignore";
}

/** A page hidden this long (real elapsed time) closes its events stream (S14 B). */
export const HIDDEN_CLOSE_MS = 30 * 60 * 1000;

export type Connection = "connecting" | "live" | "stopped";

/** The part of `EventSource` the page uses (a fake in tests). */
export interface EventStream {
  onopen: ((ev: Event) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  addEventListener(type: "change" | "submitted", fn: () => void): void;
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
  /** A `submitted` event: the review of this run was sent (S17). */
  onSubmitted?: () => void;
  /** Read whenever the hidden-tab rule is checked; false on review pages (S17). Default: always true. */
  closeWhenHidden?: () => boolean;
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
  const closesWhenHidden = deps.closeWhenHidden ?? (() => true);

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
    const onSubmitted = deps.onSubmitted;
    if (onSubmitted) {
      s.addEventListener("submitted", () => {
        if (stream === s) onSubmitted();
      });
    }
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
    if (hiddenSince === null || state !== "open" || !closesWhenHidden()) return;
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
export function replaceOnReconnect(state: GateState): boolean {
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
  /** The review was sent (S17): this message replaces the status and outlives the server. */
  sent?: boolean;
}): { text: string; dot: "ok" | "off" | "idle" } {
  if (s.sent) return { text: "Review sent — you can close this tab", dot: "idle" };
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
