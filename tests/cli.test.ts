import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
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

describe("mview CLI", () => {
  it("--help prints usage and exits 0", () => {
    const r = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage:");
    expect(r.stdout).toContain("--paste");
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

  it("serves stdin content with detected type", async () => {
    const { url } = await startCli([], '{"a": 1}');
    const doc = await (await fetch(docUrl(url))).json();
    expect(doc).toEqual({ name: null, type: "json", content: '{"a": 1}', source: "stdin" });
  });

  it("serves a file and reflects edits", async () => {
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
});
