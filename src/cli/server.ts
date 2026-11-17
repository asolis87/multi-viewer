import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Doc } from "./input.js";
import { MAX_BODY_BYTES, type ReviewSubmission } from "../shared/review.js";
import { validateSubmission } from "./review.js";

export interface ServerOptions {
  webRoot: string;
  token: string;
  port: number;
  getDoc: () => Promise<Doc>;
  /**
   * Stop when no page is open (S11). An open page is a connected `/api/events` stream with a
   * valid token. `onIdle` runs once: `afterLastMs` after the last stream closes with none
   * reconnecting, or `noneMs` after listening if no stream ever connected.
   */
  idle?: { afterLastMs: number; noneMs: number; onIdle: () => void };
  /**
   * Makes this a review server (S17): `/api/doc` carries `review: true` and `POST /api/review`
   * accepts one submission. `onSubmit` runs once, after the response and the `submitted`
   * event were sent; from then on the idle close no longer fires.
   */
  review?: { onSubmit: (submission: ReviewSubmission) => void };
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
  // No remote images: a document must not be able to report that it was opened (S6, T11).
  "img-src 'self' data: blob:",
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
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let idleDone = false;
  let closed = false;
  let submitted = false;

  function armIdle(ms: number): void {
    const idle = options.idle;
    if (!idle || idleDone || closed) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (clients.size > 0 || idleDone || closed) return;
      idleDone = true;
      idle.onIdle();
    }, ms);
    idleTimer.unref();
  }

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
    // Host names are case-insensitive in HTTP; the allowed set is lowercase.
    if (!allowedHosts.has((req.headers.host ?? "").toLowerCase())) return sendText(res, 403, "Forbidden");
    // S17: only a review server has a POST route; on every other server POST stays 405 everywhere.
    const reviewRoute = options.review !== undefined && pathOf(req.url) === "/api/review";
    const allowed = reviewRoute ? req.method === "POST" : req.method === "GET" || req.method === "HEAD";
    if (!allowed) return sendText(res, 405, "Method Not Allowed");

    const url = new URL(req.url ?? "/", `http://${HOST}`);
    if (url.pathname.startsWith("/api/")) {
      if (!tokenMatches(url.searchParams.get("t"), options.token)) return sendText(res, 403, "Forbidden");
      if (reviewRoute) return receiveReview(req, res);
      if (url.pathname === "/api/doc") return sendDoc(res);
      if (url.pathname === "/api/events") return openEvents(req, res);
      return sendText(res, 404, "Not Found");
    }
    return sendStatic(url.pathname, res);
  }

  async function sendDoc(res: ServerResponse): Promise<void> {
    try {
      const doc = await options.getDoc();
      sendJson(res, 200, options.review ? { ...doc, review: true } : doc);
    } catch (error) {
      sendJson(res, 500, { error: (error as Error).message });
    }
  }

  /** S17 checks after Host, method and token, in order: Origin, Content-Type, size, once, body. */
  async function receiveReview(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const review = options.review!;
    // The page's own origin only: a form or fetch from any other site sends its own Origin (or none).
    if ((req.headers.origin ?? "").toLowerCase() !== `http://${(req.headers.host ?? "").toLowerCase()}`) {
      return sendText(res, 403, "Forbidden");
    }
    const mediaType = (req.headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase();
    if (mediaType !== "application/json") return sendText(res, 415, "Unsupported Media Type");
    const body = await readBody(req, MAX_BODY_BYTES);
    if (body === null) {
      res.setHeader("Connection", "close");
      return sendText(res, 413, "Payload Too Large");
    }
    if (submitted) return sendJson(res, 409, { error: "the review was already submitted" });
    // Idle already ended the run as "no decision" (exit 4): a late submission must not look accepted.
    if (idleDone || closed) return sendJson(res, 410, { error: "the review already closed without a decision" });

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf8"));
    } catch {
      return sendJson(res, 400, { error: "body must be valid JSON" });
    }
    const result = validateSubmission(parsed);
    if (!result.ok) return sendJson(res, 400, { error: result.error });

    submitted = true;
    // A page closing after the decision must not turn it into "no decision".
    idleDone = true;
    clearTimeout(idleTimer);
    // "close" too: a page closed right after Submit never sees "finish", and the accepted
    // decision must still reach the CLI instead of waiting forever (review advisory R3-002/R4-001).
    const answered = new Promise<void>((done) => {
      res.once("finish", () => done());
      res.once("close", () => done());
    });
    sendJson(res, 200, { ok: true });
    const events = [...clients].map(
      (client) =>
        new Promise<void>((done) => {
          client.once("close", () => done());
          client.write("event: submitted\ndata: {}\n\n", () => done());
        }),
    );
    // Hand over only once the answer and the events were flushed: the CLI stops the server next.
    await Promise.all([answered, ...events]);
    review.onSubmit(result.value);
  }

  function openEvents(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    clients.add(res);
    clearTimeout(idleTimer);
    req.on("close", () => {
      clients.delete(res);
      if (clients.size === 0) armIdle(options.idle?.afterLastMs ?? 0);
    });
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
      if (options.idle) armIdle(options.idle.noneMs);
      resolvePromise({
        address,
        port,
        url: `http://${HOST}:${port}/?t=${encodeURIComponent(options.token)}`,
        notifyChange() {
          for (const client of clients) client.write("event: change\ndata: {}\n\n");
        },
        close() {
          closed = true;
          clearTimeout(idleTimer);
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

function pathOf(rawUrl: string | undefined): string {
  try {
    return new URL(rawUrl ?? "/", `http://${HOST}`).pathname;
  } catch {
    return "";
  }
}

/**
 * Reads at most `limit` bytes; `null` when the body is larger. The rest is discarded, not
 * buffered, and the connection is closed after the answer.
 */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
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
