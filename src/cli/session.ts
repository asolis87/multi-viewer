import { randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, realpath, stat, unlink } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const SOCKET = /^s-[\w-]{16}$/;
const MAX_PATH_BYTES = 16 * 1024;

function code(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

/** A private OS-account channel, separate from the token-authenticated browser server. */
export async function sessionDirectory(): Promise<string | null> {
  const uid = process.getuid?.();
  if (uid === undefined) return null;
  const dir = join(await realpath(tmpdir()), `mv-${uid}`);
  // Some versions of Node silently truncate long Unix socket paths. Keep those runs standalone.
  if (Buffer.byteLength(dir) + 19 >= 104) return null;
  await mkdir(dir, { mode: 0o700 }).catch((error) => {
    if (code(error) !== "EEXIST") throw error;
  });
  const info = await lstat(dir);
  if (!info.isDirectory() || info.uid !== uid || (info.mode & 0o077) !== 0) {
    throw new Error("viewer session directory is not private");
  }
  return dir;
}

export async function attachToSession(dir: string, path: string): Promise<string | null> {
  for (const name of (await readdir(dir)).filter((entry) => SOCKET.test(entry)).sort()) {
    const socket = join(dir, name);
    const url = await sendPath(socket, path).catch(async (error) => {
      if (code(error) !== "ENOENT" && code(error) !== "ECONNREFUSED") throw error;
      // Socket names are unique to a run and never reused. Reclaim only a dead endpoint.
      await unlink(socket).catch((error) => { if (code(error) !== "ENOENT") throw error; });
      return null;
    });
    if (url !== null) return url;
  }
  return null;
}

function sendPath(socketPath: string, path: string): Promise<string | null> {
  return new Promise((done, fail) => {
    const req = request({ socketPath, method: "POST", agent: false }, (res) => {
      res.setEncoding("utf8");
      let body = "";
      res.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > 256) res.destroy(new Error("invalid viewer session reply"));
      });
      res.on("error", fail);
      res.on("end", () => {
        if (res.statusCode === 410) done(null);
        else if (res.statusCode === 200 && /^http:\/\/127\.0\.0\.1:\d+\/\?t=[\w-]+$/.test(body)) done(body);
        else fail(new Error("the active viewer could not open the file"));
      });
    });
    req.setTimeout(3000, () => req.destroy(new Error("the active viewer did not respond")));
    req.on("error", fail);
    req.end(path);
  });
}

export async function serveSession(dir: string, url: string, select: (path: string) => Promise<boolean>) {
  const socket = join(dir, `s-${randomBytes(12).toString("base64url")}`);
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== "POST" || req.url !== "/") return res.writeHead(405).end();
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req as AsyncIterable<Buffer>) {
        size += chunk.length;
        if (size > MAX_PATH_BYTES) return res.writeHead(413).end();
        chunks.push(chunk);
      }
      const path = Buffer.concat(chunks).toString("utf8");
      if (!isAbsolute(path) || !(await stat(path)).isFile()) return res.writeHead(400).end();
      if (!(await select(resolve(path)))) return res.writeHead(410).end();
      res.writeHead(200).end(url);
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(socket, done);
  });
  return () => {
    server.close();
    server.closeAllConnections();
  };
}
