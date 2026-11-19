import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const CLI = resolve("dist/cli/index.js");
const originalTmpdir = process.env.TMPDIR;
let runtimeDir: string | undefined;

beforeAll(() => {
  if (process.platform !== "win32") {
    // Short Unix socket paths, isolated from any real viewer the user has open.
    runtimeDir = mkdtempSync(join("/tmp", "mv-cli-"));
    process.env.TMPDIR = runtimeDir;
  }
  const build = spawnSync("npx", ["tsc", "-p", "tsconfig.cli.json"], { encoding: "utf8" });
  if (build.status !== 0) throw new Error(build.stdout + build.stderr);
});

afterAll(() => {
  if (originalTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmpdir;
  if (runtimeDir) rmSync(runtimeDir, { recursive: true, force: true });
});

let child: ChildProcess | null = null;
afterEach(async () => {
  const proc = child;
  child = null;
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    const exited = new Promise((done) => proc.once("close", done));
    proc.kill("SIGINT");
    await exited;
  }
});

function startCli(args: string[], stdin?: string, cwd?: string): Promise<{ url: string; proc: ChildProcess }> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(process.execPath, [CLI, "--no-open", ...args], { stdio: ["pipe", "pipe", "pipe"], cwd });
    child = proc;
    let out = "";
    let err = "";
    proc.stdout!.on("data", (c) => {
      out += c;
      const m = out.match(/mview: (http:\/\/127\.0\.0\.1:\d+\/\?t=\S+)/);
      if (m) resolvePromise({ url: m[1]!, proc });
    });
    proc.stderr!.on("data", (c) => (err += c));
    proc.on("exit", (code) => reject(new Error(`exited ${code}: ${err}`)));
    if (stdin !== undefined) proc.stdin!.end(stdin);
    else proc.stdin!.end();
  });
}

describe.skipIf(process.platform === "win32")("file tabs", () => {
  it("keeps reading and watching the real file when its original symlink is removed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mv-alias-"));
    const file = join(dir, "notes.txt");
    const alias = join(dir, "notes.md");
    writeFileSync(file, "{}");
    symlinkSync(file, alias);
    const { url } = await startCli([alias]);
    const tabsUrl = docUrl(url).replace("/api/doc", "/api/tabs");
    const initial = await (await fetch(tabsUrl)).json();
    expect(initial.tabs).toEqual([{ id: initial.active, name: "notes.md" }]);

    unlinkSync(alias);
    const reopened = spawnSync(process.execPath, [CLI, "--no-open", file], { encoding: "utf8", timeout: 2000, killSignal: "SIGINT" });
    expect(reopened.status).toBe(0);
    expect(reopened.stdout).toBe(`mview: ${url}\n`);
    expect(reopened.stderr).toBe("");
    expect(await (await fetch(tabsUrl)).json()).toEqual({ ...initial, revision: initial.revision + 1 });
    const routes = [docUrl(url), `${docUrl(url)}&d=${encodeURIComponent(initial.active)}`];
    async function expectDocument(content: string) {
      for (const route of routes) {
        const response = await fetch(route);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ name: "notes.md", type: "markdown", source: "file", content });
      }
    }
    await expectDocument("{}");

    const page = await watchChanges(url);
    try {
      writeFileSync(file, "# Updated target");
      await waitFor(() => page.count() > 0);
      await expectDocument("# Updated target");
    } finally {
      page.close();
    }
  });

  it("attaches and reselects files without reopening the browser, keeps both live, and isolates review", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mv-"));
    const env = { ...process.env, TMPDIR: dir };
    const first = join(dir, "README.md");
    const second = join(dir, "notas.md");
    writeFileSync(first, "# Readme");
    writeFileSync(second, "# Notes");
    // Replace only the system browser opener so the actual CLI takes its default open path.
    const opened = join(dir, "opened");
    const loader = join(dir, "loader.mjs");
    const opener = `import {appendFileSync} from 'node:fs'; export default (url) => { appendFileSync(${JSON.stringify(opened)}, url+'\\n'); return Promise.resolve(); };`;
    writeFileSync(loader, `export function resolve(id, context, next) { return id === 'open' ? {shortCircuit:true,url:${JSON.stringify(`data:text/javascript,${encodeURIComponent(opener)}`)}} : next(id, context); }`);
    const register = `import {register} from 'node:module'; register(${JSON.stringify(new URL(`file://${loader}`).href)});`;
    const args = ["--import", `data:text/javascript,${encodeURIComponent(register)}`, CLI];

    function loopback(rawUrl: string, data?: { body: string; json?: boolean }): Promise<{ status: number; body: string }> {
      const url = new URL(rawUrl);
      if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("Expected a loopback URL");
      return new Promise((done, fail) => {
        const req = request({ hostname: "127.0.0.1", port: url.port, path: url.pathname + url.search, method: data ? "POST" : "GET", headers: data?.json ? { origin: url.origin, "content-type": "application/json" } : {} }, (res) => {
          let body = "";
          res.setEncoding("utf8").on("data", (chunk) => (body += chunk));
          res.on("end", () => done({ status: res.statusCode!, body }));
        });
        req.on("error", fail);
        req.end(data?.body);
      });
    }

    function run(...argv: string[]) {
      return new Promise<{ code: number | null; stdout: string; stderr: string }>((done, fail) => {
        const proc = spawn(process.execPath, [...args, ...argv], { env, cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (c) => (stdout += c));
        proc.stderr.on("data", (c) => (stderr += c));
        const timer = setTimeout(() => proc.kill("SIGINT"), 2500);
        proc.once("error", fail);
        proc.once("close", (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
      });
    }

    const server = spawn(process.execPath, [...args, first], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    server.stdout.on("data", (c) => (out += c));
    server.stderr.on("data", (c) => (err += c));
    const exited = new Promise((done) => server.once("close", done));
    let page: Awaited<ReturnType<typeof watchChanges>> | undefined;
    let review: ChildProcess | undefined;
    try {
      await waitFor(() => /^mview: .*\n/.test(out));
      const url = out.split("\n")[0]!.slice("mview: ".length);
      const tabsUrl = docUrl(url).replace("/api/doc", "/api/tabs");
      const tabs = async () => {
        const response = await loopback(tabsUrl);
        expect(response.status).toBe(200);
        return JSON.parse(response.body) as { active: string; revision: number; tabs: { id: string; name: string }[] };
      };
      const getDoc = async (id: string) => JSON.parse((await loopback(`${docUrl(url)}&d=${encodeURIComponent(id)}`)).body);
      const initial = await tabs();
      const firstId = initial.active;
      expect(initial.tabs).toEqual([{ id: firstId, name: "README.md" }]);
      expect(firstId).not.toContain(dir);
      page = await watchChanges(url);

      expect(await run("notas.md")).toEqual({ code: 0, stdout: `mview: ${url}\n`, stderr: "" });
      const attached = await tabs();
      const secondId = attached.active;
      expect(secondId).not.toBe(firstId);
      expect(attached.tabs).toEqual([{ id: firstId, name: "README.md" }, { id: secondId, name: "notas.md" }]);
      expect(attached.revision).toBeGreaterThan(initial.revision);
      await waitFor(() => page!.count() > 0);

      expect(await run("--detach", "./README.md")).toEqual({ code: 0, stdout: `mview: ${url}\n`, stderr: "" });
      const reopened = await tabs();
      expect(reopened).toEqual({ active: firstId, revision: attached.revision + 1, tabs: attached.tabs });
      expect(readFileSync(opened, "utf8")).toBe(`${url}\n`);
      expect(out).toBe(`mview: ${url}\nPress Ctrl+C to stop.\n`);
      expect(err).toBe("");

      for (const [file, id, content] of [[first, firstId, "# Readme 2"], [second, secondId, "# Notes 2"]] as const) {
        const before = page.count();
        writeFileSync(file, content);
        await waitFor(() => page!.count() > before);
        expect((await getDoc(id)).content).toBe(content);
      }
      expect(await run("missing.md")).toEqual({ code: 1, stdout: "", stderr: "mview: file not found: missing.md\n" });
      expect(await loopback(`${docUrl(url)}&d=${encodeURIComponent(first)}`)).toEqual({ status: 404, body: "Not Found" });
      expect(await loopback(tabsUrl, { body: second })).toEqual({ status: 405, body: "Method Not Allowed" });
      expect(await tabs()).toEqual(reopened);

      unlinkSync(first);
      for (const endpoint of [docUrl(url), `${docUrl(url)}&d=${encodeURIComponent(firstId)}`]) {
        const missing = await loopback(endpoint);
        expect(missing.status).toBe(500);
        expect(JSON.parse(missing.body)).toEqual({ error: "README.md could not be read." });
      }
      expect(await tabs()).toEqual(reopened);
      writeFileSync(first, "# Restored Readme");

      review = spawn(process.execPath, [CLI, "review", "--no-open", first], { env, stdio: ["ignore", "pipe", "pipe"] });
      let reviewErr = "";
      let reviewOut = "";
      review.stderr!.on("data", (c) => (reviewErr += c));
      review.stdout!.on("data", (c) => (reviewOut += c));
      const reviewExit = new Promise((done) => review!.once("close", done));
      await waitFor(() => reviewErr.includes("Press Ctrl+C to stop.\n"));
      const reviewUrl = reviewErr.split("\n")[0]!.slice("mview: ".length);
      expect(reviewUrl).not.toBe(url);
      expect(await loopback(docUrl(reviewUrl).replace("/api/doc", "/api/tabs"))).toEqual({ status: 404, body: "Not Found" });
      expect(await tabs()).toEqual(reopened);
      const response = await loopback(docUrl(reviewUrl).replace("/api/doc", "/api/review"), {
        body: JSON.stringify({ decision: "approved", comments: [] }), json: true,
      });
      expect(response).toEqual({ status: 200, body: '{"ok":true}' });
      expect(await reviewExit).toBe(0);
      expect(reviewOut).toBe("# Review: README.md\nDecision: approved\nComments: 0\n");
      expect(reviewErr).toBe(`mview: ${reviewUrl}\nPress Ctrl+C to stop.\n`);
    } finally {
      page?.close();
      review?.kill("SIGINT");
      server.kill("SIGINT");
      await exited;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 10000);
});

function docUrl(pageUrl: string): string {
  const u = new URL(pageUrl);
  return `${u.origin}/api/doc?t=${u.searchParams.get("t")}`;
}

function eventsUrl(pageUrl: string): string {
  const u = new URL(pageUrl);
  return `${u.origin}/api/events?t=${u.searchParams.get("t")}`;
}

/** Subscribe to SSE and count `change` events; `close()` ends the stream. */
function watchChanges(pageUrl: string): Promise<{ count(): number; close(): void }> {
  return new Promise((resolve, reject) => {
    let changes = 0;
    let buffer = "";
    const req = request(eventsUrl(pageUrl), (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        // SSE events end with a blank line; a chunk may hold part of one, so only count complete events.
        buffer += chunk;
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        changes += events.filter((e) => e.split("\n").includes("event: change")).length;
      });
      resolve({ count: () => changes, close: () => req.destroy() });
    });
    req.on("error", (e) => (e.message.includes("socket hang up") ? undefined : reject(e)));
    req.end();
  });
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("mview CLI", () => {
  it("--help prints usage and exits 0", () => {
    const r = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage:");
    expect(r.stdout).toContain("--paste");
    expect(r.stdout).toContain("--auto-close");
    expect(r.stdout).toContain("--detach");
    expect(r.stdout).toContain("mview skill print");
    expect(r.stdout).toContain("mview skill install --agent pi|claude|codex [--force]");
    expect(r.stderr).toBe("");
  });

  it("--version prints the package version", () => {
    const r = spawnSync(process.execPath, [CLI, "--version"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(r.stdout).toBe(`${version}\n`);
  });

  it("invalid arguments exit 2 with a message on stderr", () => {
    const r = spawnSync(process.execPath, [CLI, "a.md", "b.md"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe('mview: Only one file at a time is supported.\nRun "mview --help" for usage.\n');
  });

  it("a missing file exits 1", () => {
    const r = spawnSync(process.execPath, [CLI, "--no-open", "nope-404.md"], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toBe("mview: file not found: nope-404.md\n");
  });

  it("a directory is rejected before starting the server (T15)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mview-dir-"));
    const r = spawnSync(process.execPath, [CLI, "--no-open", dir], { encoding: "utf8", timeout: 5000, killSignal: "SIGINT" });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe(`mview: not a file: ${dir}\n`);
  });

  it("serves stdin content with detected type", async () => {
    const { url } = await startCli([], '{"a": 1}');
    const doc = await (await fetch(docUrl(url))).json();
    expect(doc).toEqual({ name: null, type: "json", content: '{"a": 1}', source: "stdin" });
  });

  it("tells the user it is waiting when piped stdin stays open, then serves it once it ends (T16)", async () => {
    const proc = spawn(process.execPath, [CLI, "--no-open"], { stdio: ["pipe", "pipe", "pipe"] });
    child = proc;
    let out = "";
    let err = "";
    proc.stdout!.on("data", (c) => (out += c));
    proc.stderr!.on("data", (c) => (err += c));
    await waitFor(() => err.includes("waiting"), 4000);
    expect(err).toBe("mview: waiting for input on stdin (press Ctrl+D to finish, Ctrl+C to cancel)\n");
    expect(out).toBe("");
    proc.stdin!.end("# late");
    await waitFor(() => /t=\S+/.test(out), 4000);
    const url = out.match(/mview: (http:\/\/127\.0\.0\.1:\d+\/\?t=\S+)/)![1]!;
    expect(await (await fetch(docUrl(url))).json()).toEqual({ name: null, type: "markdown", content: "# late", source: "stdin" });
  });

  it("does not print the waiting notice when stdin ends quickly (T16)", async () => {
    const proc = spawn(process.execPath, [CLI, "--no-open"], { stdio: ["pipe", "pipe", "pipe"] });
    child = proc;
    let err = "";
    let out = "";
    proc.stdout!.on("data", (c) => (out += c));
    proc.stderr!.on("data", (c) => (err += c));
    proc.stdin!.end("{}");
    await waitFor(() => /t=\S+/.test(out), 4000);
    await new Promise((r) => setTimeout(r, 1300));
    expect(err).toBe("");
  });

  it("empty piped stdin falls back to the empty paste page", async () => {
    const { url } = await startCli([], "  \n");
    const doc = await (await fetch(docUrl(url))).json();
    expect(doc).toEqual({ name: null, type: "markdown", content: "", source: "empty" });
  });

  it("serves the current file content on every request (live reload over SSE is covered by T12)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mview-cli-"));
    const file = join(dir, "flow.mmd");
    writeFileSync(file, "flowchart LR\n A-->B");
    const { url } = await startCli([file]);
    const first = await (await fetch(docUrl(url))).json();
    expect(first).toEqual({ name: "flow.mmd", type: "mermaid", content: "flowchart LR\n A-->B", source: "file" });
    writeFileSync(file, "flowchart LR\n A-->C");
    const second = await (await fetch(docUrl(url))).json();
    expect(second.content).toBe("flowchart LR\n A-->C");
  });

  it(
    "--auto-close stops with exit 0 after the last page disconnects (S11, T23)",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "mview-auto-"));
      const file = join(dir, "notes.md");
      writeFileSync(file, "# hi");
      const proc = spawn(process.execPath, [CLI, "--no-open", "--auto-close", file], { stdio: ["pipe", "pipe", "pipe"] });
      child = proc;
      proc.stdin!.end();
      let out = "";
      let err = "";
      proc.stdout!.on("data", (c) => (out += c));
      proc.stderr!.on("data", (c) => (err += c));
      const exited = new Promise<number | null>((done) => proc.on("exit", (code) => done(code)));
      await waitFor(() => out.includes("Press Ctrl+C to stop."), 4000);
      const url = out.match(/mview: (http:\/\/127\.0\.0\.1:\d+\/\?t=\S+)/)![1]!;
      const page = await watchChanges(url);
      page.close();
      expect(await exited).toBe(0);
      expect(err).toBe("mview: no open pages, stopping\n");
    },
    20_000,
  );

  /** Starts the real CLI in the foreground (no browser) on a temp file and collects its output and exit code. */
  async function foreground(flags: string[]) {
    const file = join(mkdtempSync(join(tmpdir(), "mview-life-")), "notes.md");
    writeFileSync(file, "# hi");
    const proc = spawn(process.execPath, [CLI, "--no-open", ...flags, file], { stdio: ["pipe", "pipe", "pipe"] });
    child = proc;
    proc.stdin!.end();
    let out = "";
    let err = "";
    let exitCode: number | null | undefined;
    proc.stdout!.on("data", (c) => (out += c));
    proc.stderr!.on("data", (c) => (err += c));
    const exited = new Promise<number | null>((done) => proc.on("exit", (code) => done((exitCode = code))));
    await waitFor(() => out.includes("Press Ctrl+C to stop."), 4000);
    const url = out.match(/mview: (http:\/\/127\.0\.0\.1:\d+\/\?t=\S+)/)![1]!;
    return { proc, url, exited, err: () => err, exitCode: () => exitCode };
  }

  it(
    "without any flag the foreground stops with exit 0 after its last page closes (S14, T35)",
    async () => {
      const run = await foreground([]);
      const page = await watchChanges(run.url);
      page.close();
      expect(await run.exited).toBe(0);
      expect(run.err()).toBe("mview: no open pages, stopping\n");
    },
    20_000,
  );

  it(
    "--no-auto-close keeps running past the point where auto-close would stop, until Ctrl+C (S14, T35)",
    async () => {
      const run = await foreground(["--no-auto-close"]);
      const page = await watchChanges(run.url);
      page.close();
      // Auto-close would stop 10 s after the last page closes; wait past that.
      await new Promise((r) => setTimeout(r, 11_500));
      expect(run.exitCode()).toBeUndefined();
      expect((await fetch(docUrl(run.url))).status).toBe(200);
      expect(run.err()).toBe("");
      run.proc.kill("SIGINT");
      expect(await run.exited).toBe(0);
      expect(run.err()).toBe("");
    },
    25_000,
  );

  it("--help describes the default auto-close, --no-auto-close and the hidden-tab rule (S14, T35)", () => {
    const r = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--no-auto-close");
    expect(r.stdout).toContain("--auto-close");
    expect(r.stdout).toContain("30 minutes");
    expect(r.stdout).not.toContain("stops with Ctrl+C (or by itself with --auto-close)");
  });

  describe("--detach (S10, T24)", () => {
    /** Absolute file paths of detached runs; each is unique and appears in the background copy's argv. */
    let detachedFiles: string[] = [];
    let blocker: Server | null = null;

    afterEach(async () => {
      for (const file of detachedFiles) for (const pid of pidsFor(file)) killQuietly(pid);
      detachedFiles = [];
      if (blocker) await new Promise<void>((done) => blocker!.close(() => done()));
      blocker = null;
    });

    function pidsFor(file: string): number[] {
      const r = spawnSync("pgrep", ["-f", file], { encoding: "utf8" });
      return r.stdout.split("\n").filter(Boolean).map(Number);
    }

    function killQuietly(pid: number): void {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }

    function tempFile(name: string, content: string): string {
      const file = join(mkdtempSync(join(tmpdir(), "mview-detach-")), name);
      writeFileSync(file, content);
      detachedFiles.push(file);
      return file;
    }

    function freePort(): Promise<number> {
      return new Promise((done, fail) => {
        const s = createServer();
        s.once("error", fail);
        s.listen(0, "127.0.0.1", () => {
          const port = (s.address() as AddressInfo).port;
          s.close(() => done(port));
        });
      });
    }

    function refused(url: string): Promise<boolean> {
      return fetch(url).then(
        () => false,
        (e: Error & { cause?: { code?: string } }) => e.cause?.code === "ECONNREFUSED",
      );
    }

    function runDetach(args: string[], input?: string) {
      return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 15_000, input });
    }

    it(
      "prints only the URL, exits 0, and the background copy serves, live-reloads and auto-closes",
      async () => {
        const file = tempFile("notes.md", "# v1");
        const port = await freePort();
        const r = runDetach(["--detach", "--no-open", "--port", String(port), file]);
        expect(r.status).toBe(0);
        expect(r.stderr).toBe("");
        expect(r.stdout).toMatch(new RegExp(`^mview: http://127\\.0\\.0\\.1:${port}/\\?t=\\S+\\n$`));
        const url = r.stdout.slice("mview: ".length).trim();

        // The foreground has exited; the background copy keeps serving the file.
        expect(pidsFor(file)).toHaveLength(1);
        expect(await (await fetch(docUrl(url))).json()).toEqual({ name: "notes.md", type: "markdown", content: "# v1", source: "file" });

        const events = await watchChanges(url);
        writeFileSync(file, "# v2");
        await waitFor(() => events.count() > 0);
        expect((await (await fetch(docUrl(url))).json()).content).toBe("# v2");

        // Closing the last page lets --auto-close stop it; writing its notice to the gone stderr must not crash it first.
        events.close();
        await waitFor(() => refused(docUrl(url)), 15_000);
        await waitFor(() => pidsFor(file).length === 0, 3000);
      },
      30_000,
    );

    it(
      "a copy whose output reader is gone keeps serving, and its auto-close notice does not crash it",
      async () => {
        const file = tempFile("orphan.md", "# hi");
        const proc = spawn(process.execPath, [CLI, "--no-open", "--auto-close", file], { stdio: ["ignore", "pipe", "pipe"] });
        child = proc;
        const exited = new Promise<number | null>((done) => proc.on("exit", (code) => done(code)));
        let out = "";
        proc.stdout!.on("data", (c) => (out += c));
        await waitFor(() => /t=\S+\n/.test(out), 4000);
        const url = out.match(/mview: (http:\/\/127\.0\.0\.1:\d+\/\?t=\S+)/)![1]!;
        // Like the foreground of --detach exiting: nobody reads the copy's stdout or stderr anymore.
        proc.stdout!.destroy();
        proc.stderr!.destroy();
        expect((await fetch(docUrl(url))).status).toBe(200);
        const page = await watchChanges(url);
        page.close();
        // The notice hits a closed pipe (EPIPE); the copy must still stop cleanly with exit 0.
        expect(await exited).toBe(0);
      },
      20_000,
    );

    it("without a file exits 2 with a usage error and does not read stdin", () => {
      const r = runDetach(["--detach"], "# piped");
      expect(r.status).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe("mview: --detach needs a file\n");
    });

    it("with --no-auto-close exits 2 with a usage error and starts nothing (S14, T35)", () => {
      const file = tempFile("keep.md", "# keep");
      const r = runDetach(["--detach", "--no-open", "--no-auto-close", file]);
      expect(r.status).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe("mview: --detach always stops by itself; drop --no-auto-close\n");
      expect(pidsFor(file)).toEqual([]);
    });

    it("the --no-auto-close error wins over --detach without a file (S14, T35)", () => {
      const r = runDetach(["--detach", "--no-auto-close"], "# piped");
      expect(r.status).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe("mview: --detach always stops by itself; drop --no-auto-close\n");
    });

    it("with --paste exits 2 with the same usage error", () => {
      const r = runDetach(["--detach", "--paste"]);
      expect(r.status).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe("mview: --detach needs a file\n");
    });

    it("validates the file in the foreground: a missing file exits 1 and nothing keeps running", () => {
      const missing = join(mkdtempSync(join(tmpdir(), "mview-detach-")), "missing.md");
      detachedFiles.push(missing);
      const r = runDetach(["--detach", "--no-open", missing]);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe(`mview: file not found: ${missing}\n`);
      expect(pidsFor(missing)).toEqual([]);
    });

    it("a directory exits 1 with not a file", () => {
      const dir = mkdtempSync(join(tmpdir(), "mview-detach-dir-"));
      detachedFiles.push(dir);
      const r = runDetach(["--detach", "--no-open", dir]);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe(`mview: not a file: ${dir}\n`);
      expect(pidsFor(dir)).toEqual([]);
    });

    it("exits 1 with the background copy's error when --port is in use, and nothing keeps running", async () => {
      const file = tempFile("busy.md", "# busy");
      blocker = createServer();
      await new Promise<void>((done) => blocker!.listen(0, "127.0.0.1", () => done()));
      const port = (blocker.address() as AddressInfo).port;
      const r = runDetach(["--detach", "--no-open", "--port", String(port), file]);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toMatch(/^mview: .*EADDRINUSE.*\n$/);
      expect(pidsFor(file)).toEqual([]);
    });
  });

  describe("live reload survives editor save patterns (T12, S2)", () => {
    async function setup(initial: string) {
      const dir = mkdtempSync(join(tmpdir(), "mview-watch-"));
      const file = join(dir, "notes.md");
      writeFileSync(file, initial);
      const { url } = await startCli([file]);
      const events = await watchChanges(url);
      const content = async () => (await (await fetch(docUrl(url))).json()).content as string;
      const docUrlOf = () => docUrl(url);
      return { dir, file, events, content, docUrlOf };
    }

    it("keeps emitting change after repeated atomic saves (write temp file, rename over)", async () => {
      const { dir, file, events, content } = await setup("v1");
      try {
        for (const version of ["v2", "v3", "v4"]) {
          const before = events.count();
          const tmp = join(dir, `.notes.md.${version}.tmp`);
          writeFileSync(tmp, version);
          renameSync(tmp, file);
          await waitFor(() => events.count() > before);
          await waitFor(async () => (await content()) === version);
        }
      } finally {
        events.close();
      }
    });

    it("keeps emitting change after the file is deleted and recreated", async () => {
      const { file, events, content, docUrlOf } = await setup("v1");
      try {
        const beforeDelete = events.count();
        unlinkSync(file);
        await waitFor(() => events.count() > beforeDelete);
        await waitFor(async () => (await fetch(docUrlOf())).status === 500);
        const beforeRecreate = events.count();
        writeFileSync(file, "v2");
        await waitFor(() => events.count() > beforeRecreate);
        expect(await content()).toBe("v2");
        const before = events.count();
        writeFileSync(file, "v3");
        await waitFor(() => events.count() > before);
        await waitFor(async () => (await content()) === "v3");
      } finally {
        events.close();
      }
    });
  });
});

describe("mview skill (S12, T25-T26)", () => {
  const SKILL_PATH = resolve("skills/mview/SKILL.md");
  const CHOOSE = "mview: choose --agent pi|claude|codex\n";
  const USAGE = "mview: usage: mview skill print | mview skill install --agent pi|claude|codex [--force]\n";

  function skill(): string {
    return readFileSync(SKILL_PATH, "utf8");
  }

  function tempHome(): string {
    return mkdtempSync(join(tmpdir(), "mview-home-"));
  }

  /** Runs the real CLI with HOME pointed at a temp dir, so the user's ~/.agents and ~/.claude are never touched. */
  function run(args: string[], home: string) {
    return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 10_000, env: { ...process.env, HOME: home } });
  }

  function target(home: string, agent: "pi" | "claude" | "codex"): string {
    return agent === "claude" ? join(home, ".claude", "skills", "mview", "SKILL.md") : join(home, ".agents", "skills", "mview", "SKILL.md");
  }

  it("the skill has name: mview frontmatter and the S12 instructions", () => {
    const text = skill();
    expect(text).toMatch(/^---\nname: mview\ndescription: .+\n---\n/);
    for (const needle of [".md", ".mmd", ".json", "temporary directory", "mview --detach <file>", "--no-open", "--paste", "60 seconds", "again", "cannot read", "Remote images", "https://github.com/asolis87/multi-viewer#install"]) {
      expect(text).toContain(needle);
    }
  });

  it("npm pack includes skills/mview/SKILL.md", () => {
    const r = spawnSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8", timeout: 60_000 });
    expect(r.status).toBe(0);
    const [pack] = JSON.parse(r.stdout) as [{ files: { path: string }[] }];
    const paths = pack.files.map((f) => f.path);
    expect(paths).toContain("skills/mview/SKILL.md");
    expect(paths).toContain("dist/cli/index.js");
  }, 60_000);

  it("skill print writes the bundled SKILL.md byte-for-byte", () => {
    const r = run(["skill", "print"], tempHome());
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe(skill());
  });

  it("skill print works from the packed tarball layout", () => {
    const dir = mkdtempSync(join(tmpdir(), "mview-pack-"));
    const pack = spawnSync("npm", ["pack", "--json", "--pack-destination", dir], { encoding: "utf8", timeout: 60_000 });
    expect(pack.status).toBe(0);
    const [{ filename }] = JSON.parse(pack.stdout) as [{ filename: string }];
    const untar = spawnSync("tar", ["-xzf", join(dir, filename), "-C", dir], { encoding: "utf8" });
    expect(untar.status).toBe(0);
    const r = spawnSync(process.execPath, [join(dir, "package", "dist", "cli", "index.js"), "skill", "print"], { encoding: "utf8", timeout: 10_000 });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe(skill());
  }, 60_000);

  for (const agent of ["pi", "claude", "codex"] as const) {
    it(`skill install --agent ${agent} creates the missing directories and writes the skill`, () => {
      const home = tempHome();
      const path = target(home, agent);
      const r = run(["skill", "install", "--agent", agent], home);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe("");
      expect(r.stdout).toBe(`mview: installed skill for ${agent}: ${path}\n`);
      expect(readFileSync(path, "utf8")).toBe(skill());
    });
  }

  it("pi then codex share one copy: the second install is up to date and writes nothing", () => {
    const home = tempHome();
    const path = target(home, "pi");
    expect(run(["skill", "install", "--agent", "pi"], home).status).toBe(0);
    const past = new Date("2020-01-01T00:00:00Z");
    utimesSync(path, past, past);
    const r = run(["skill", "install", "--agent", "codex"], home);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe(`mview: skill already up to date: ${path}\n`);
    expect(statSync(path).mtimeMs).toBe(past.getTime());
    expect(readFileSync(path, "utf8")).toBe(skill());
  });

  it("different content is not replaced without --force, and is with --force", () => {
    const home = tempHome();
    const path = target(home, "claude");
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "my own skill\n");

    const refused = run(["skill", "install", "--agent", "claude"], home);
    expect(refused.status).toBe(1);
    expect(refused.stdout).toBe("");
    expect(refused.stderr).toBe(`mview: ${path} already exists with different content; use --force to replace it\n`);
    expect(readFileSync(path, "utf8")).toBe("my own skill\n");

    const forced = run(["skill", "install", "--agent", "claude", "--force"], home);
    expect(forced.status).toBe(0);
    expect(forced.stderr).toBe("");
    expect(forced.stdout).toBe(`mview: replaced skill for claude: ${path}\n`);
    expect(readFileSync(path, "utf8")).toBe(skill());
  });

  it("a write failure exits 1 with the reason", () => {
    const dir = tempHome();
    const home = join(dir, "not-a-dir");
    writeFileSync(home, "x");
    const r = run(["skill", "install", "--agent", "pi"], home);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^mview: \S.*\n$/);
    expect(readFileSync(home, "utf8")).toBe("x");
  });

  it("a missing, repeated or unknown --agent exits 2 and writes nothing", () => {
    for (const extra of [[], ["--force"], ["--agent"], ["--agent", "pi", "--agent", "pi"], ["--agent", "pi", "--agent", "claude"], ["--agent", "cursor"]]) {
      const home = tempHome();
      const r = run(["skill", "install", ...extra], home);
      expect(r.status, extra.join(" ")).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe(CHOOSE);
      expect(readdirSync(home)).toEqual([]);
    }
  });

  it("a missing or unknown skill subcommand exits 2 with the usage message", () => {
    for (const args of [["skill"], ["skill", "bogus"], ["skill", "print", "extra"]]) {
      const home = tempHome();
      const r = run(args, home);
      expect(r.status, args.join(" ")).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe(USAGE);
      expect(readdirSync(home)).toEqual([]);
    }
  });

  it("mview ./skill opens a file named skill", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mview-skillfile-"));
    writeFileSync(join(dir, "skill"), "# a file named skill");
    const { url } = await startCli(["./skill"], undefined, dir);
    expect(await (await fetch(docUrl(url))).json()).toEqual({ name: "skill", type: "markdown", content: "# a file named skill", source: "file" });
  });
});

describe("mview review (S17, T45)", () => {
  const ONE_FILE = "mview: review takes one Markdown file\n";
  const WAITS = "mview: review takes a file and waits for the decision\n";

  function tempFile(name: string, content = "# Plan\n\nUse Flask for the server\n"): string {
    const file = join(mkdtempSync(join(tmpdir(), "mview-review-")), name);
    writeFileSync(file, content);
    return file;
  }

  function run(args: string[], input?: string) {
    return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 10_000, killSignal: "SIGINT", input });
  }

  /** Starts `mview review --no-open <file>`, leaving stdin open (it must not be read), and waits for the startup lines. */
  async function startReview(file: string) {
    const proc = spawn(process.execPath, [CLI, "review", "--no-open", file], { stdio: ["pipe", "pipe", "pipe"] });
    child = proc;
    let out = "";
    let err = "";
    proc.stdout!.on("data", (c) => (out += c));
    proc.stderr!.on("data", (c) => (err += c));
    const exited = new Promise<number | null>((done) => proc.on("exit", (code) => done(code)));
    await waitFor(() => err.includes("Press Ctrl+C to stop.\n"), 4000);
    const url = err.match(/^mview: (http:\/\/127\.0\.0\.1:\d+\/\?t=\S+)\n/)![1]!;
    return { proc, url, exited, out: () => out, err: () => err };
  }

  function post(pageUrl: string, body: unknown): Promise<{ status: number; body: string }> {
    const u = new URL(pageUrl);
    return new Promise((resolve, reject) => {
      const req = request(
        `${u.origin}/api/review?t=${u.searchParams.get("t")}`,
        { method: "POST", headers: { origin: u.origin, "content-type": "application/json" } },
        (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () => resolve({ status: res.statusCode!, body: text }));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify(body));
    });
  }

  it("every usage error exits 2 with an exact message and empty stdout", () => {
    const file = tempFile("plan.md");
    const cases: [string[], string][] = [
      [["review"], ONE_FILE],
      [["review", "--no-open"], ONE_FILE],
      [["review", file, file], ONE_FILE],
      [["review", "--paste", file], WAITS],
      [["review", "--paste"], WAITS],
      [["review", "--detach", file], WAITS],
      [["review", "--no-auto-close", file], WAITS],
    ];
    for (const [args, stderr] of cases) {
      const r = run(args, "# piped");
      expect(r.status, args.join(" ")).toBe(2);
      expect(r.stdout, args.join(" ")).toBe("");
      expect(r.stderr, args.join(" ")).toBe(stderr);
    }
  });

  it("validates the file as S2 and rejects non-Markdown files with exit 1", () => {
    const missing = join(mkdtempSync(join(tmpdir(), "mview-review-")), "missing.md");
    const dir = mkdtempSync(join(tmpdir(), "mview-review-dir-"));
    const cases: [string, string][] = [
      [missing, `mview: file not found: ${missing}\n`],
      [dir, `mview: not a file: ${dir}\n`],
    ];
    for (const name of ["data.json", "flow.mmd", "flow.mermaid", "t.csv", "t.tsv"]) {
      const file = tempFile(name, "{}");
      cases.push([file, `mview: review needs a Markdown file: ${file}\n`]);
    }
    for (const [file, stderr] of cases) {
      const r = run(["review", "--no-open", file]);
      expect(r.status, file).toBe(1);
      expect(r.stdout, file).toBe("");
      expect(r.stderr, file).toBe(stderr);
    }
  });

  it(
    "approve: startup lines on stderr only, review: true in the doc, submitted event, exit 0 with the result on stdout",
    async () => {
      const file = tempFile("plan.md");
      const run = await startReview(file);
      expect(run.err()).toBe(`mview: ${run.url}\nPress Ctrl+C to stop.\n`);
      expect(run.out()).toBe("");
      expect(await (await fetch(docUrl(run.url))).json()).toEqual({
        name: "plan.md",
        type: "markdown",
        content: "# Plan\n\nUse Flask for the server\n",
        source: "file",
        review: true,
      });
      const submitted = new Promise<string>((resolve, reject) => {
        const req = request(eventsUrl(run.url), (res) => {
          let buf = "";
          res.on("data", (c) => {
            buf += c;
            if (buf.includes("event: submitted\n")) resolve(buf);
          });
          res.on("end", () => resolve(buf));
        });
        req.on("error", (e) => (/hang up|aborted/.test(e.message) ? undefined : reject(e)));
        req.end();
      });
      await new Promise((r) => setTimeout(r, 50));
      const res = await post(run.url, { decision: "approved", comments: [] });
      expect(res).toEqual({ status: 200, body: '{"ok":true}' });
      expect(await submitted).toContain("event: submitted\n");
      expect(await run.exited).toBe(0);
      expect(run.out()).toBe("# Review: plan.md\nDecision: approved\nComments: 0\n");
      expect(run.err()).toBe(`mview: ${run.url}\nPress Ctrl+C to stop.\n`);
    },
    20_000,
  );

  it(
    "request changes: exit 3 with the comments in document order",
    async () => {
      const run = await startReview(tempFile("plan.md"));
      const res = await post(run.url, {
        decision: "changes_requested",
        comments: [
          { kind: "answer", startLine: 40, endLine: 40, quote: "Should the cache be shared?", text: "Yes, one cache per process." },
          { kind: "change", startLine: 12, endLine: 14, quote: "Use Flask for the server", text: "Use FastAPI instead." },
        ],
      });
      expect(res.status).toBe(200);
      expect(await run.exited).toBe(3);
      expect(run.out()).toBe(
        "# Review: plan.md\nDecision: changes_requested\nComments: 2\n\n## 1. Change request — lines 12–14\n> Use Flask for the server\n\nUse FastAPI instead.\n\n## 2. Answer — line 40\n> Should the cache be shared?\n\nYes, one cache per process.\n",
      );
      expect(run.err()).toBe(`mview: ${run.url}\nPress Ctrl+C to stop.\n`);
    },
    20_000,
  );

  it(
    "approve with comments: exit 0",
    async () => {
      const run = await startReview(tempFile("spec.markdown"));
      expect((await post(run.url, { decision: "approved_with_comments", comments: [{ kind: "note", startLine: 1, endLine: 1, text: "ok" }] })).status).toBe(200);
      expect(await run.exited).toBe(0);
      expect(run.out()).toBe("# Review: spec.markdown\nDecision: approved_with_comments\nComments: 1\n\n## 1. Note — line 1\n\nok\n");
    },
    20_000,
  );

  it(
    "no decision: every page closed without a submission exits 4 with nothing on stdout",
    async () => {
      const run = await startReview(tempFile("plan.md"));
      // An invalid submission is not a decision.
      expect((await post(run.url, { decision: "approved", comments: [{ kind: "note", startLine: 1, endLine: 1, text: "x" }] })).status).toBe(400);
      const page = await watchChanges(run.url);
      page.close();
      expect(await run.exited).toBe(4);
      expect(run.out()).toBe("");
      expect(run.err()).toBe(`mview: ${run.url}\nPress Ctrl+C to stop.\nmview: review closed without a decision\n`);
    },
    20_000,
  );

  it(
    "Ctrl+C stops it with exit 130 and prints nothing on stdout (L87)",
    async () => {
      const run = await startReview(tempFile("plan.md"));
      run.proc.kill("SIGINT");
      expect(await run.exited).toBe(130);
      expect(run.out()).toBe("");
      expect(run.err()).toBe(`mview: ${run.url}\nPress Ctrl+C to stop.\n`);
    },
    20_000,
  );

  it(
    "SIGTERM also stops it with exit 130 and prints nothing on stdout (L87)",
    async () => {
      const run = await startReview(tempFile("plan.md"));
      run.proc.kill("SIGTERM");
      expect(await run.exited).toBe(130);
      expect(run.out()).toBe("");
      expect(run.err()).toBe(`mview: ${run.url}\nPress Ctrl+C to stop.\n`);
    },
    20_000,
  );

  it("a file without a known extension is reviewed as Markdown", async () => {
    const run = await startReview(tempFile("PLAN", '{"looks": "like json"}'));
    expect(await (await fetch(docUrl(run.url))).json()).toEqual({ name: "PLAN", type: "markdown", content: '{"looks": "like json"}', source: "file", review: true });
  });

  it("mview ./review opens a file named review, as a normal page", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mview-reviewfile-"));
    writeFileSync(join(dir, "review"), "# a file named review");
    const { url } = await startCli(["./review"], undefined, dir);
    expect(await (await fetch(docUrl(url))).json()).toEqual({ name: "review", type: "markdown", content: "# a file named review", source: "file" });
  });

  it("plain mview <file> still prints its startup lines on stdout, and its server answers 405 to POST and 404 to GET /api/review", async () => {
    const file = tempFile("notes.md");
    const proc = spawn(process.execPath, [CLI, "--no-open", file], { stdio: ["pipe", "pipe", "pipe"] });
    child = proc;
    proc.stdin!.end();
    let out = "";
    let err = "";
    proc.stdout!.on("data", (c) => (out += c));
    proc.stderr!.on("data", (c) => (err += c));
    await waitFor(() => out.includes("Press Ctrl+C to stop.\n"), 4000);
    const url = out.match(/^mview: (http:\/\/127\.0\.0\.1:\d+\/\?t=\S+)\n/)![1]!;
    expect(out).toBe(`mview: ${url}\nPress Ctrl+C to stop.\n`);
    expect(err).toBe("");
    expect((await post(url, { decision: "approved", comments: [] })).status).toBe(405);
    const u = new URL(url);
    expect((await fetch(`${u.origin}/api/review?t=${u.searchParams.get("t")}`)).status).toBe(404);
    expect((await (await fetch(docUrl(url))).json()).review).toBeUndefined();
  });

  it("--help describes review", () => {
    const r = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("mview review <file>");
    expect(r.stdout).toContain("review closed without a decision");
  });
});
