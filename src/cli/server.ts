import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Doc } from "./input.js";

export interface ServerOptions {
  webRoot: string;
  token: string;
  port: number;
  getDoc: () => Promise<Doc>;
}

export interface RunningServer {
  address: string;
  port: number;
  url: string;
  notifyChange(): void;
  close(): Promise<void>;
}

const HOST = "127.0.0.1";
const HEARTBEAT_MS = 25_000;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

// Rendered content is untrusted (pasted / AI-generated): only bundled scripts may run,
// and the page may only talk back to this server.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function startServer(options: ServerOptions): Promise<RunningServer> {
  const webRoot = resolve(options.webRoot);
  const clients = new Set<ServerResponse>();
  let allowedHosts: Set<string> = new Set();

  const server = createServer((req, res) => {
    handle(req, res).catch((error: Error) => {
      if (!res.headersSent) sendJson(res, 500, { error: error.message });
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");

    // Reject DNS-rebinding: a page on another origin resolving to 127.0.0.1 sends its own Host.
    if (!allowedHosts.has(req.headers.host ?? "")) return sendText(res, 403, "Forbidden");
    if (req.method !== "GET" && req.method !== "HEAD") return sendText(res, 405, "Method Not Allowed");

    const url = new URL(req.url ?? "/", `http://${HOST}`);
    if (url.pathname.startsWith("/api/")) {
      if (!tokenMatches(url.searchParams.get("t"), options.token)) return sendText(res, 403, "Forbidden");
      if (url.pathname === "/api/doc") return sendDoc(res);
      if (url.pathname === "/api/events") return openEvents(req, res);
      return sendText(res, 404, "Not Found");
    }
    return sendStatic(url.pathname, res);
  }

  async function sendDoc(res: ServerResponse): Promise<void> {
    try {
      sendJson(res, 200, await options.getDoc());
    } catch (error) {
      sendJson(res, 500, { error: (error as Error).message });
    }
  }

  function openEvents(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
  }

  async function sendStatic(pathname: string, res: ServerResponse): Promise<void> {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return sendText(res, 404, "Not Found");
    }
    const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
    const filePath = resolve(webRoot, relative);
    if (!filePath.startsWith(webRoot + sep)) return sendText(res, 404, "Not Found");

    try {
      const info = await stat(filePath);
      if (!info.isFile()) return sendText(res, 404, "Not Found");
      const body = await readFile(filePath);
      const headers: Record<string, string> = {
        "Content-Type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      };
      if (filePath.endsWith(".html")) headers["Content-Security-Policy"] = CSP;
      res.writeHead(200, headers);
      res.end(body);
    } catch {
      sendText(res, 404, "Not Found");
    }
  }

  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(": ping\n\n");
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(options.port, HOST, () => {
      const { address, port } = server.address() as AddressInfo;
      allowedHosts = new Set([`${HOST}:${port}`, `localhost:${port}`]);
      resolvePromise({
        address,
        port,
        url: `http://${HOST}:${port}/?t=${encodeURIComponent(options.token)}`,
        notifyChange() {
          for (const client of clients) client.write("event: change\ndata: {}\n\n");
        },
        close() {
          clearInterval(heartbeat);
          for (const client of clients) client.end();
          clients.clear();
          return new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          });
        },
      });
    });
  });
}

function tokenMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}
