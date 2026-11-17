import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "../src/cli/server.js";
import type { Doc } from "../src/cli/input.js";

const TOKEN = "test-token-123";

function makeWebRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "mview-web-"));
  writeFileSync(join(dir, "index.html"), "<html>INDEX</html>");
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
  return dir;
}

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function get(port: number, path: string, host = `127.0.0.1:${port}`): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers: { host } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("server", () => {
  let server: RunningServer;
  let doc: Doc;

  beforeEach(async () => {
    doc = { name: "a.md", type: "markdown", content: "# hi", source: "file" };
    server = await startServer({ webRoot: makeWebRoot(), token: TOKEN, port: 0, getDoc: async () => doc });
  });

  afterEach(async () => {
    await server.close();
  });

  it("binds to 127.0.0.1 only and exposes a tokenized url", () => {
    expect(server.address).toBe("127.0.0.1");
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/?t=${TOKEN}`);
  });

  it("serves the document with the token", async () => {
    const res = await get(server.port, `/api/doc?t=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(res.body)).toEqual(doc);
  });

  it("rejects /api requests without or with a wrong token", async () => {
    expect((await get(server.port, "/api/doc")).status).toBe(403);
    expect((await get(server.port, "/api/doc?t=wrong")).status).toBe(403);
    expect((await get(server.port, "/api/events")).status).toBe(403);
  });

  it("rejects a foreign Host header (DNS rebinding)", async () => {
    const res = await get(server.port, `/api/doc?t=${TOKEN}`, "evil.example:80");
    expect(res.status).toBe(403);
    const asset = await get(server.port, "/", "evil.example");
    expect(asset.status).toBe(403);
  });

  it("compares the Host header case-insensitively, as HTTP requires (T14)", async () => {
    expect((await get(server.port, `/api/doc?t=${TOKEN}`, `LOCALHOST:${server.port}`)).status).toBe(200);
    expect((await get(server.port, `/api/doc?t=${TOKEN}`, `LocalHost:${server.port}`)).status).toBe(200);
    expect((await get(server.port, `/api/doc?t=${TOKEN}`, `EVIL.EXAMPLE:${server.port}`)).status).toBe(403);
  });

  it("accepts localhost as Host", async () => {
    const res = await get(server.port, `/api/doc?t=${TOKEN}`, `localhost:${server.port}`);
    expect(res.status).toBe(200);
  });

  it("serves index.html and assets", async () => {
    const index = await get(server.port, `/?t=${TOKEN}`);
    expect(index.status).toBe(200);
    expect(index.body).toBe("<html>INDEX</html>");
    expect(index.headers["content-type"]).toContain("text/html");
    const asset = await get(server.port, "/assets/app.js");
    expect(asset.status).toBe(200);
    expect(asset.headers["content-type"]).toContain("javascript");
  });

  it("sets a restrictive content security policy on the page", async () => {
    const index = await get(server.port, "/");
    const csp = String(index.headers["content-security-policy"]);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
  });

  it("blocks remote images in the content security policy (T11)", async () => {
    const index = await get(server.port, "/");
    const directives = String(index.headers["content-security-policy"]).split("; ");
    expect(directives).toContain("img-src 'self' data: blob:");
    expect(directives.join(" ")).not.toContain("https:");
  });

  it("does not escape the web root", async () => {
    for (const p of ["/assets/../../etc/passwd", "/assets/%2e%2e/%2e%2e/etc/passwd", "/..%2f..%2fetc/passwd"]) {
      const res = await get(server.port, p);
      expect(res.status, p).toBe(404);
    }
  });

  it("returns 404 for unknown paths", async () => {
    expect((await get(server.port, `/api/nope?t=${TOKEN}`)).status).toBe(404);
    expect((await get(server.port, "/missing.js")).status).toBe(404);
  });

  it("returns 500 with a message when the document cannot be read", async () => {
    await server.close();
    server = await startServer({
      webRoot: makeWebRoot(),
      token: TOKEN,
      port: 0,
      getDoc: async () => {
        throw new Error("ENOENT: gone");
      },
    });
    const res = await get(server.port, `/api/doc?t=${TOKEN}`);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: "ENOENT: gone" });
  });

  it("pushes a change event over SSE", async () => {
    const received = new Promise<string>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port: server.port, path: `/api/events?t=${TOKEN}` },
        (res) => {
          expect(res.headers["content-type"]).toContain("text/event-stream");
          let buf = "";
          res.on("data", (c) => {
            buf += c;
            if (buf.includes("event: change")) {
              req.destroy();
              resolve(buf);
            }
          });
          setTimeout(() => server.notifyChange(), 50);
        },
      );
      req.on("error", (e) => (e.message.includes("aborted") ? undefined : reject(e)));
      req.end();
    });
    expect(await received).toContain("event: change");
  });
});

describe("idle close (S11, T23)", () => {
  const servers: RunningServer[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  async function start(idle?: { afterLastMs: number; noneMs: number }) {
    let fired = 0;
    const doc: Doc = { name: null, type: "markdown", content: "", source: "empty" };
    const server = await startServer({
      webRoot: makeWebRoot(),
      token: TOKEN,
      port: 0,
      getDoc: async () => doc,
      ...(idle ? { idle: { ...idle, onIdle: () => fired++ } } : {}),
    });
    servers.push(server);
    return { server, fired: () => fired };
  }

  /** Open an SSE stream; resolves once the server answered (and registered it). */
  function openStream(port: number, token = TOKEN): Promise<{ status: number; close(): void }> {
    return new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: `/api/events?t=${token}` }, (res) => {
        res.resume();
        resolve({ status: res.statusCode!, close: () => req.destroy() });
      });
      req.on("error", (e) => (/hang up|aborted/.test(e.message) ? undefined : reject(e)));
      req.end();
    });
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("(a) fires after the last open stream closes and none reconnects", async () => {
    const { server, fired } = await start({ afterLastMs: 50, noneMs: 10_000 });
    const page = await openStream(server.port);
    await sleep(120);
    expect(fired()).toBe(0); // an open page keeps it running
    page.close();
    await sleep(150);
    expect(fired()).toBe(1);
  });

  it("(a) a reconnect within the window cancels it", async () => {
    const { server, fired } = await start({ afterLastMs: 80, noneMs: 10_000 });
    const first = await openStream(server.port);
    first.close();
    await sleep(20);
    const reload = await openStream(server.port);
    await sleep(200);
    expect(fired()).toBe(0);
    reload.close();
    await sleep(200);
    expect(fired()).toBe(1);
  });

  it("(a) with several streams it fires only after the last one closes", async () => {
    const { server, fired } = await start({ afterLastMs: 50, noneMs: 10_000 });
    const tabA = await openStream(server.port);
    const tabB = await openStream(server.port);
    tabA.close();
    await sleep(150);
    expect(fired()).toBe(0);
    tabB.close();
    await sleep(150);
    expect(fired()).toBe(1);
  });

  it("(b) fires when no stream ever connects", async () => {
    const { fired } = await start({ afterLastMs: 10_000, noneMs: 50 });
    await sleep(20);
    expect(fired()).toBe(0);
    await sleep(130);
    expect(fired()).toBe(1);
  });

  it("(b) a stream connecting within the window cancels it", async () => {
    const { server, fired } = await start({ afterLastMs: 10_000, noneMs: 80 });
    const page = await openStream(server.port);
    await sleep(200);
    expect(fired()).toBe(0);
    page.close();
  });

  it("requests with a wrong token, or to other routes, are not open pages", async () => {
    const { server, fired } = await start({ afterLastMs: 10_000, noneMs: 100 });
    const wrong = await openStream(server.port, "wrong");
    expect(wrong.status).toBe(403);
    expect((await get(server.port, `/api/doc?t=${TOKEN}`)).status).toBe(200);
    await sleep(200);
    expect(fired()).toBe(1);

    const other = await start({ afterLastMs: 50, noneMs: 10_000 });
    const page = await openStream(other.server.port);
    page.close();
    await sleep(10);
    await openStream(other.server.port, "wrong");
    await sleep(150);
    expect(other.fired()).toBe(1);
  });

  it("fires only once", async () => {
    const { server, fired } = await start({ afterLastMs: 50, noneMs: 50 });
    await sleep(150);
    expect(fired()).toBe(1);
    const page = await openStream(server.port);
    page.close();
    await sleep(150);
    expect(fired()).toBe(1);
  });

  it("close() clears pending idle timers", async () => {
    const { server, fired } = await start({ afterLastMs: 50, noneMs: 50 });
    await server.close();
    await sleep(150);
    expect(fired()).toBe(0);
  });

  it("without the idle option the server keeps running with no pages", async () => {
    const { server } = await start();
    await sleep(150);
    const page = await openStream(server.port);
    page.close();
    await sleep(100);
    expect((await get(server.port, `/api/doc?t=${TOKEN}`)).status).toBe(200);
  });
});

interface SendOptions {
  host?: string;
  origin?: string | null;
  contentType?: string | null;
  body?: string | Buffer;
}

/** Any method, with the Origin and Content-Type a review page sends unless overridden (null drops the header). */
function send(port: number, method: string, path: string, options: SendOptions = {}): Promise<Res> {
  const host = options.host ?? `127.0.0.1:${port}`;
  const headers: Record<string, string> = { host };
  const origin = options.origin === undefined ? `http://${host}` : options.origin;
  if (origin !== null) headers.origin = origin;
  const contentType = options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType !== null) headers["content-type"] = contentType;
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end(options.body);
  });
}

const VALID = JSON.stringify({ decision: "changes_requested", comments: [{ kind: "change", startLine: 2, endLine: 3, quote: "q", text: "t" }] });

describe("non-review servers keep their routes (S17 regression)", () => {
  let server: RunningServer;
  beforeEach(async () => {
    server = await startServer({ webRoot: makeWebRoot(), token: TOKEN, port: 0, getDoc: async () => ({ name: "a.md", type: "markdown", content: "# a", source: "file" }) });
  });
  afterEach(() => server.close());

  it("POST anywhere gets 405, including /api/review", async () => {
    for (const path of [`/api/review?t=${TOKEN}`, `/api/doc?t=${TOKEN}`, "/", "/api/review"]) {
      expect((await send(server.port, "POST", path, { body: VALID })).status, path).toBe(405);
    }
  });

  it("GET /api/review gets 404 with the token and 403 without", async () => {
    expect((await get(server.port, `/api/review?t=${TOKEN}`)).status).toBe(404);
    expect((await get(server.port, "/api/review")).status).toBe(403);
  });

  it("/api/doc has no review flag", async () => {
    expect(JSON.parse((await get(server.port, `/api/doc?t=${TOKEN}`)).body)).not.toHaveProperty("review");
  });
});

describe("review server: POST /api/review (S17, T45)", () => {
  let server: RunningServer;
  let submissions: unknown[];
  const path = `/api/review?t=${TOKEN}`;

  async function start(idle?: { afterLastMs: number; noneMs: number; onIdle: () => void }) {
    submissions = [];
    server = await startServer({
      webRoot: makeWebRoot(),
      token: TOKEN,
      port: 0,
      getDoc: async () => ({ name: "plan.md", type: "markdown", content: "# plan", source: "file" }),
      review: { onSubmit: (s) => submissions.push(s) },
      ...(idle ? { idle } : {}),
    });
  }

  beforeEach(() => start());
  afterEach(() => server.close());

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("/api/doc carries review: true", async () => {
    const res = await get(server.port, `/api/doc?t=${TOKEN}`);
    expect(JSON.parse(res.body)).toEqual({ name: "plan.md", type: "markdown", content: "# plan", source: "file", review: true });
  });

  it("accepts a valid submission with 200 { ok: true } and hands it over once", async () => {
    const res = await send(server.port, "POST", path, { body: VALID });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    await sleep(20);
    expect(submissions).toEqual([JSON.parse(VALID)]);
  });

  it("accepts Content-Type with a charset and the localhost Host", async () => {
    const res = await send(server.port, "POST", path, { body: VALID, contentType: "application/json; charset=utf-8", host: `localhost:${server.port}` });
    expect(res.status).toBe(200);
  });

  it("sends event: submitted to every open stream before handing the result over", async () => {
    const streams = [0, 1].map(
      () =>
        new Promise<string>((resolve, reject) => {
          const req = request({ host: "127.0.0.1", port: server.port, path: `/api/events?t=${TOKEN}` }, (res) => {
            let buf = "";
            res.on("data", (c) => {
              buf += c;
              if (buf.includes("event: submitted\n")) {
                req.destroy();
                resolve(buf);
              }
            });
          });
          req.on("error", (e) => (/hang up|aborted/.test(e.message) ? undefined : reject(e)));
          req.end();
        }),
    );
    await sleep(50);
    expect((await send(server.port, "POST", path, { body: VALID })).status).toBe(200);
    for (const s of await Promise.all(streams)) expect(s).toContain("event: submitted\ndata: {}\n\n");
  });

  it("1. a foreign Host gets 403 before anything else", async () => {
    expect((await send(server.port, "GET", "/api/review", { host: "evil.example:80", origin: null, contentType: null })).status).toBe(403);
  });

  it("2. /api/review accepts only POST (405); other routes accept only GET/HEAD (405), before the token", async () => {
    for (const method of ["GET", "HEAD", "PUT", "DELETE"]) {
      expect((await send(server.port, method, "/api/review")).status, method).toBe(405);
    }
    for (const p of ["/api/doc", "/api/events", "/", "/api/nope"]) {
      expect((await send(server.port, "POST", p, { body: VALID })).status, p).toBe(405);
    }
    expect((await get(server.port, `/api/doc?t=${TOKEN}`)).status).toBe(200);
  });

  it("3. a missing or wrong token gets 403, before Origin", async () => {
    expect((await send(server.port, "POST", "/api/review", { body: VALID, origin: null })).status).toBe(403);
    expect((await send(server.port, "POST", "/api/review?t=wrong", { body: VALID, origin: null })).status).toBe(403);
  });

  it("4. Origin must equal http:// plus the request Host (403), before Content-Type", async () => {
    const port = server.port;
    for (const origin of [null, "null", "http://evil.example", `http://localhost:${port}`, `https://127.0.0.1:${port}`, `http://127.0.0.1:${port + 1}`]) {
      expect((await send(port, "POST", path, { body: VALID, origin, contentType: "text/plain" })).status, String(origin)).toBe(403);
    }
  });

  it("5. Content-Type must be application/json (415), before the size", async () => {
    const big = "x".repeat(300 * 1024);
    for (const contentType of [null, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/jsonx"]) {
      expect((await send(server.port, "POST", path, { body: big, contentType })).status, String(contentType)).toBe(415);
    }
  });

  it("6. a body over 256 KB gets 413, before the submitted check", async () => {
    const big = JSON.stringify({ decision: "approved", comments: [], pad: "x".repeat(256 * 1024) });
    expect((await send(server.port, "POST", path, { body: big })).status).toBe(413);
    expect(submissions).toEqual([]);
    // Exactly 256 KB is allowed (and then fails validation, not size).
    const exact = Buffer.alloc(256 * 1024, " ");
    expect((await send(server.port, "POST", path, { body: exact })).status).toBe(400);
  });

  it("7. a second submission gets 409, even with an invalid body", async () => {
    expect((await send(server.port, "POST", path, { body: VALID })).status).toBe(200);
    expect((await send(server.port, "POST", path, { body: VALID })).status).toBe(409);
    expect((await send(server.port, "POST", path, { body: "not json" })).status).toBe(409);
    await sleep(20);
    expect(submissions).toHaveLength(1);
  });

  it("8. an invalid body gets 400 with { error } naming the reason", async () => {
    const bad = await send(server.port, "POST", path, { body: "{not json" });
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.body)).toEqual({ error: "body must be valid JSON" });
    const approved = await send(server.port, "POST", path, { body: JSON.stringify({ decision: "approved", comments: [{ kind: "note", startLine: 1, endLine: 1, text: "x" }] }) });
    expect(approved.status).toBe(400);
    expect(JSON.parse(approved.body)).toEqual({ error: "approved must have no comments" });
    // A rejected body does not count as a submission.
    expect((await send(server.port, "POST", path, { body: VALID })).status).toBe(200);
  });

  it("a submission after the idle close is refused with 410 and never reaches the CLI (F1)", async () => {
    await server.close();
    let idled = 0;
    await start({ afterLastMs: 10_000, noneMs: 30, onIdle: () => idled++ });
    await sleep(120);
    expect(idled).toBe(1);
    const res = await send(server.port, "POST", path, { body: VALID });
    expect(res.status).toBe(410);
    expect(JSON.parse(res.body)).toEqual({ error: "the review already closed without a decision" });
    expect(submissions).toHaveLength(0);
  });

  it("after a submission the idle close no longer fires", async () => {
    await server.close();
    let idled = 0;
    await start({ afterLastMs: 30, noneMs: 10_000, onIdle: () => idled++ });
    const page = await new Promise<{ close(): void }>((resolve) => {
      const req = request({ host: "127.0.0.1", port: server.port, path: `/api/events?t=${TOKEN}` }, (res) => {
        res.resume();
        resolve({ close: () => req.destroy() });
      });
      req.on("error", () => undefined);
      req.end();
    });
    expect((await send(server.port, "POST", path, { body: VALID })).status).toBe(200);
    page.close();
    await sleep(150);
    expect(idled).toBe(0);
    expect(submissions).toHaveLength(1);
  });
});
