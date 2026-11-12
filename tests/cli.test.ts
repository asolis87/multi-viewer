import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const CLI = resolve("dist/cli/index.js");

beforeAll(() => {
  const build = spawnSync("npx", ["tsc", "-p", "tsconfig.cli.json"], { encoding: "utf8" });
  if (build.status !== 0) throw new Error(build.stdout + build.stderr);
});

let child: ChildProcess | null = null;
afterEach(() => {
  child?.kill("SIGINT");
  child = null;
});

function startCli(args: string[], stdin?: string): Promise<{ url: string; proc: ChildProcess }> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(process.execPath, [CLI, "--no-open", ...args], { stdio: ["pipe", "pipe", "pipe"] });
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
    expect(r.stderr).toBe("");
  });

  it("--version prints the package version", () => {
    const r = spawnSync(process.execPath, [CLI, "--version"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("0.1.0\n");
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
