import { describe, expect, it } from "vitest";
import {
  connectLive,
  HIDDEN_CLOSE_MS,
  liveStatus,
  replaceOnReconnect,
  type Connection,
  type EventStream,
  type LiveDeps,
} from "../../src/web/lib/events.js";
import type { DocResult } from "../../src/web/lib/api.js";
import { selectTab, sessionFrom, syncSession } from "../../src/web/lib/tabs.js";
import type { DocumentTabs } from "../../src/shared/tabs.js";
import type { Doc } from "../../src/shared/doc.js";

const FILE_DOC: Doc = { name: "notes.md", type: "markdown", content: "# fresh", source: "file" };

class FakeStream implements EventStream {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  listeners: Array<() => void> = [];
  submittedListeners: Array<() => void> = [];
  addEventListener(type: "change" | "submitted", fn: () => void) {
    (type === "submitted" ? this.submittedListeners : this.listeners).push(fn);
  }
  close() {
    this.closed = true;
  }
  emitChange() {
    for (const fn of this.listeners) fn();
  }
  emitSubmitted() {
    for (const fn of this.submittedListeners) fn();
  }
}

/** A fake page: clock, timers that only fire when the test says so, visibility, streams and /api/doc. */
function fakePage(
  opts: { limit?: number; check?: () => Promise<DocResult>; closeWhenHidden?: () => boolean; onSubmitted?: () => void } = {},
) {
  let now = 1_000;
  let hidden = false;
  let timers: Array<{ id: number; at: number; fn: () => void }> = [];
  let nextId = 1;
  const streams: FakeStream[] = [];
  const connections: Connection[] = [];
  const docs: Doc[] = [];
  let changes = 0;
  let checks = 0;
  const deps: LiveDeps = {
    openStream: () => {
      const s = new FakeStream();
      streams.push(s);
      return s;
    },
    checkDoc: async () => {
      checks++;
      return opts.check ? opts.check() : { ok: true, doc: FILE_DOC };
    },
    onChange: () => void changes++,
    onDoc: (doc) => void docs.push(doc),
    onConnection: (c) => void connections.push(c),
    now: () => now,
    isHidden: () => hidden,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ id, at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => {
      timers = timers.filter((t) => t.id !== id);
    },
    hiddenCloseMs: opts.limit ?? 100,
    closeWhenHidden: opts.closeWhenHidden,
    onSubmitted: opts.onSubmitted,
  };
  const live = connectLive(deps);
  const page = {
    live,
    streams,
    connections,
    docs,
    get changes() {
      return changes;
    },
    get checks() {
      return checks;
    },
    get stream() {
      return streams[streams.length - 1];
    },
    get pendingTimers() {
      return timers.length;
    },
    /** Move the clock; with `fire`, run timers that are due (a throttled tab passes `fire: false`). */
    advance(ms: number, fire = true) {
      now += ms;
      if (!fire) return;
      const due = timers.filter((t) => t.at <= now);
      timers = timers.filter((t) => t.at > now);
      for (const t of due) t.fn();
    },
    setHidden(value: boolean) {
      hidden = value;
      live.visibilityChanged();
    },
  };
  return page;
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("forgotten tabs (S14 B, T36)", () => {
  it("closes after 30 minutes by default", () => {
    expect(HIDDEN_CLOSE_MS).toBe(30 * 60 * 1000);
  });

  it("closes the stream once the page has been hidden for the limit; the document is not touched", () => {
    const page = fakePage({ limit: 100 });
    page.stream.onopen?.();
    page.setHidden(true);
    page.advance(99);
    expect(page.stream.closed).toBe(false);
    page.advance(1);
    expect(page.stream.closed).toBe(true);
    expect(page.streams).toHaveLength(1);
    expect(page.checks).toBe(0);
    expect(page.docs).toHaveLength(0);
  });

  it("becoming visible before the limit resets the count", () => {
    const page = fakePage({ limit: 100 });
    page.setHidden(true);
    page.advance(80);
    page.setHidden(false);
    expect(page.pendingTimers).toBe(0);
    page.setHidden(true);
    page.advance(80);
    expect(page.stream.closed).toBe(false);
    page.advance(20);
    expect(page.stream.closed).toBe(true);
  });

  it("a throttled timer still closes when real time passed: checked again on visibilitychange", async () => {
    const page = fakePage({ limit: 100 });
    page.setHidden(true);
    page.advance(5_000, false); // laptop asleep: the timer never ran
    expect(page.stream.closed).toBe(false);
    page.setHidden(false);
    expect(page.streams[0].closed).toBe(true);
    // Visible after closing → one check, then a new stream.
    await flush();
    expect(page.checks).toBe(1);
    expect(page.streams).toHaveLength(2);
  });

  it("a late timer that fires early by the clock re-arms instead of closing", () => {
    const page = fakePage({ limit: 100 });
    page.setHidden(true);
    page.advance(100, false);
    expect(page.stream.closed).toBe(false);
    page.advance(0);
    expect(page.stream.closed).toBe(true);
  });
});

describe("reconnecting and Stopped (S14, T36)", () => {
  it("visible after closing: one /api/doc check, then a new stream and the fresh document", async () => {
    const page = fakePage({ limit: 100 });
    page.setHidden(true);
    page.advance(100);
    page.setHidden(false);
    await flush();
    expect(page.checks).toBe(1);
    expect(page.docs).toEqual([FILE_DOC]);
    expect(page.streams).toHaveLength(2);
    expect(page.stream.closed).toBe(false);
    page.stream.onopen?.();
    expect(page.connections.at(-1)).toBe("live");
    expect(page.changes).toBe(0); // the check already brought the fresh document
  });

  it("a failed check (network error or 403) stops: no new stream, no further attempts", async () => {
    for (const result of [
      { ok: false, status: 0, error: "down" },
      { ok: false, status: 403, error: "token" },
    ] as DocResult[]) {
      const page = fakePage({ limit: 100, check: async () => result });
      page.stream.onopen?.();
      page.stream.onerror?.();
      expect(page.streams[0].closed).toBe(true); // the browser stops its own retries
      await flush();
      expect(page.connections.at(-1)).toBe("stopped");
      expect(page.streams).toHaveLength(1);
      expect(page.docs).toHaveLength(0);
      // Nothing brings it back: more errors, hiding, showing, time passing.
      page.streams[0].onerror?.();
      page.setHidden(true);
      page.advance(1_000);
      page.setHidden(false);
      await flush();
      expect(page.checks).toBe(1);
      expect(page.streams).toHaveLength(1);
    }
  });

  it("a check answered with another HTTP error (e.g. 500, file missing) means the server is alive: reconnect and reload through the live-reload path (S2, L58)", async () => {
    const page = fakePage({ limit: 100, check: async () => ({ ok: false, status: 500, error: "file not found" }) as DocResult });
    page.stream.onopen?.();
    page.stream.onerror?.();
    await flush();
    expect(page.checks).toBe(1);
    expect(page.connections).not.toContain("stopped");
    expect(page.streams).toHaveLength(2);
    expect(page.docs).toHaveLength(0);
    expect(page.changes).toBe(1); // the page refetches and shows the error, as on a live reload
  });

  it("a dropped stream makes the same single check and reconnects when the server answers", async () => {
    const page = fakePage();
    page.stream.onopen?.();
    page.stream.onerror?.();
    page.stream.onerror?.(); // repeated errors from the same drop count once
    expect(page.streams[0].closed).toBe(true);
    await flush();
    expect(page.checks).toBe(1);
    expect(page.docs).toEqual([FILE_DOC]);
    expect(page.streams).toHaveLength(2);
  });

  it("a stream that fails before opening right after a check stops instead of looping (no endless retry, L59)", async () => {
    for (const result of [
      { ok: false, status: 500, error: "not mview" },
      { ok: true, doc: FILE_DOC },
    ] as DocResult[]) {
      const page = fakePage({ check: async () => result });
      page.stream.onopen?.();
      page.stream.onerror?.();
      await flush();
      expect(page.streams).toHaveLength(2);
      page.stream.onerror?.(); // the new stream never opened: whatever answered is not this mview
      await flush();
      expect(page.connections.at(-1)).toBe("stopped");
      expect(page.checks).toBe(1);
      expect(page.streams).toHaveLength(2);
      expect(page.streams[1].closed).toBe(true);
      expect(page.pendingTimers).toBe(0);
    }
  });

  it("a stream that opened after a reconnect gets a fresh single check when it drops later", async () => {
    const page = fakePage();
    page.stream.onopen?.();
    page.stream.onerror?.();
    await flush();
    page.stream.onopen?.();
    page.stream.onerror?.();
    await flush();
    expect(page.checks).toBe(2);
    expect(page.streams).toHaveLength(3);
    expect(page.connections).not.toContain("stopped");
  });

  it("a visibility change or another error during a check does not start a second check or stream", async () => {
    let release: (r: DocResult) => void = () => {};
    const page = fakePage({ check: () => new Promise<DocResult>((r) => (release = r)) });
    page.stream.onopen?.();
    page.stream.onerror?.();
    page.stream.onerror?.();
    page.setHidden(true);
    page.setHidden(false);
    release({ ok: true, doc: FILE_DOC });
    await flush();
    expect(page.checks).toBe(1);
    expect(page.streams).toHaveLength(2);
  });

  it("stop() during a pending check opens nothing and leaves no timers", async () => {
    let release: (r: DocResult) => void = () => {};
    const page = fakePage({ check: () => new Promise<DocResult>((r) => (release = r)) });
    page.setHidden(true);
    page.stream.onerror?.();
    page.live.stop();
    release({ ok: true, doc: FILE_DOC });
    await flush();
    expect(page.streams).toHaveLength(1);
    expect(page.docs).toHaveLength(0);
    expect(page.pendingTimers).toBe(0);
  });

  it("events from an old stream after a reconnect are ignored", async () => {
    const page = fakePage();
    const old = page.stream;
    old.onopen?.();
    old.onerror?.();
    await flush();
    old.emitChange();
    old.onerror?.();
    await flush();
    expect(page.changes).toBe(0);
    expect(page.checks).toBe(1);
    expect(page.streams).toHaveLength(2);
  });

  it("a check that throws counts as a failure", async () => {
    const page = fakePage({ check: async () => Promise.reject(new Error("x")) });
    page.stream.onerror?.();
    await flush();
    expect(page.connections.at(-1)).toBe("stopped");
    expect(page.streams).toHaveLength(1);
  });

  it("reconnect reconciles the document session: an unchanged CLI revision keeps the browser tab (S1, L8)", async () => {
    const server: DocumentTabs = {
      tabs: [
        { id: "a", name: "README.md" },
        { id: "b", name: "notas.md" },
      ],
      active: "a",
      revision: 5,
    };
    let session = selectTab(sessionFrom(server), "b");
    const fetched: string[] = [];
    const page = fakePage({
      check: async () => {
        // What the page does on reconnect: read the metadata, then the selected tab.
        session = syncSession(session, { ...server, active: "a", revision: 5 }).session;
        const id = session.selected!;
        fetched.push(id);
        return { ok: true, doc: { ...FILE_DOC, name: "notas.md", content: "# b" } };
      },
    });
    page.stream.onopen?.();
    page.stream.onerror?.();
    await flush();
    expect(session.selected).toBe("b");
    expect(fetched).toEqual(["b"]);
    expect(page.docs.map((doc) => doc.name)).toEqual(["notas.md"]);
    expect(page.streams).toHaveLength(2);
  });

  it("reconnect after a CLI selection follows the new active tab (S2, L8)", async () => {
    const server: DocumentTabs = {
      tabs: [
        { id: "a", name: "README.md" },
        { id: "b", name: "notas.md" },
      ],
      active: "a",
      revision: 5,
    };
    let session = selectTab(sessionFrom(server), "b");
    const fetched: string[] = [];
    const page = fakePage({
      check: async () => {
        session = syncSession(session, { ...server, active: "a", revision: 6 }).session;
        fetched.push(session.selected!);
        return { ok: true, doc: { ...FILE_DOC, name: "README.md", content: "# a" } };
      },
    });
    page.stream.onerror?.();
    await flush();
    expect(session.selected).toBe("a");
    expect(fetched).toEqual(["a"]);
  });

  it("stop() closes the stream and clears the timer", () => {
    const page = fakePage();
    page.setHidden(true);
    page.live.stop();
    expect(page.stream.closed).toBe(true);
    expect(page.pendingTimers).toBe(0);
  });

  it("live reload unchanged: a change event calls onChange", () => {
    const page = fakePage();
    page.stream.onopen?.();
    page.stream.emitChange();
    page.stream.emitChange();
    expect(page.changes).toBe(2);
  });
});

describe("which pages take the fresh document and what the status says", () => {
  it("only a watched file page replaces its content on reconnect", () => {
    expect(replaceOnReconnect({ source: "file", pastedHere: false, loadStatus: null })).toBe(true);
    expect(replaceOnReconnect({ source: "file", pastedHere: true, loadStatus: null })).toBe(false);
    for (const source of ["paste", "stdin", "empty"] as const) {
      expect(replaceOnReconnect({ source, pastedHere: false, loadStatus: null }), source).toBe(false);
      expect(replaceOnReconnect({ source, pastedHere: true, loadStatus: null }), source).toBe(false);
    }
  });

  it("a stopped file page says Stopped; other sources keep their text", () => {
    const base = { name: "notes.md", hasDoc: true, loadFailed: false, pastedHere: false };
    expect(liveStatus({ ...base, source: "file", connection: "live" })).toEqual({ text: "Live · watching notes.md", dot: "ok" });
    expect(liveStatus({ ...base, source: "file", connection: "stopped" })).toEqual({
      text: "Stopped — run mview again for live reload",
      dot: "off",
    });
    expect(liveStatus({ ...base, source: "file", connection: "connecting" }).text).toBe("Connecting…");
    for (const connection of ["live", "connecting", "stopped"] as const) {
      expect(liveStatus({ ...base, source: "stdin", connection }).text).toBe("Not watching · read from stdin");
      expect(liveStatus({ ...base, source: "paste", connection }).text).toBe("Not watching · from clipboard");
      expect(liveStatus({ ...base, source: "empty", connection }).text).toBe("Waiting for input");
      expect(liveStatus({ ...base, source: "file", pastedHere: true, connection }).text).toBe("Not watching · pasted in this tab");
    }
  });
});

describe("review pages (S17, T47)", () => {
  it("a review page never closes its stream because it is hidden (S14 B off)", async () => {
    let review = false;
    const page = fakePage({ limit: 100, closeWhenHidden: () => !review });
    page.stream.onopen?.();
    review = true; // the review flag arrives with the document, after the stream opened
    page.setHidden(true);
    page.advance(10_000);
    page.advance(10_000, false);
    page.setHidden(false);
    page.setHidden(true);
    page.advance(100_000);
    await flush();
    expect(page.stream.closed).toBe(false);
    expect(page.streams).toHaveLength(1);
    expect(page.checks).toBe(0);
    expect(page.pendingTimers).toBe(0);
  });

  it("the hidden-tab rule still applies to every other page", () => {
    const page = fakePage({ limit: 100, closeWhenHidden: () => true });
    page.setHidden(true);
    page.advance(100);
    expect(page.stream.closed).toBe(true);
  });

  it("a submitted event reaches the page; change events still reload", () => {
    let submitted = 0;
    const page = fakePage({ onSubmitted: () => void submitted++ });
    page.stream.onopen?.();
    page.stream.emitSubmitted();
    page.stream.emitChange();
    expect(submitted).toBe(1);
    expect(page.changes).toBe(1);
  });

  it("the sent message replaces the status text and stays after the server stops (instead of Stopped)", () => {
    const base = { source: "file" as const, name: "plan.md", hasDoc: true, loadFailed: false, pastedHere: false };
    for (const connection of ["live", "connecting", "stopped"] as const) {
      expect(liveStatus({ ...base, connection, sent: true })).toEqual({ text: "Review sent — you can close this tab", dot: "idle" });
    }
    expect(liveStatus({ ...base, connection: "stopped", sent: false }).text).toBe("Stopped — run mview again for live reload");
  });
});
