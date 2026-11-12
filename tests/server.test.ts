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
