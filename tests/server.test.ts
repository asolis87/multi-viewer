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
