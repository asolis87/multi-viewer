import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDetached } from "../src/cli/detach.js";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

let pids: number[] = [];
afterEach(() => {
  for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
  pids = [];
});

/** A stand-in for the CLI that records its argv and pid, then runs `body`. */
function fakeCli(body: string): { script: string; record: string } {
  const dir = mkdtempSync(join(tmpdir(), "mview-fake-"));
  const record = join(dir, "record.json");
  const script = join(dir, "fake.mjs");
  writeFileSync(
    script,
    `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(record)}, JSON.stringify({ pid: process.pid, argv: process.argv.slice(2) }));
${body}
`,
  );
  return { script, record };
}

function sink() {
  let text = "";
  return { write: (s: string) => ((text += s), true), text: () => text };
}

async function readRecord(record: string): Promise<{ pid: number; argv: string[] }> {
  const start = Date.now();
  while (!existsSync(record)) {
    if (Date.now() - start > 3000) throw new Error("fake CLI never started");
    await new Promise((r) => setTimeout(r, 20));
  }
  const data = JSON.parse(readFileSync(record, "utf8")) as { pid: number; argv: string[] };
  pids.push(data.pid);
  return data;
}

describe("runDetached (S10, T24)", () => {
  it("passes only the path and flags, forwards the first URL line and leaves the copy running", async () => {
    const { script, record } = fakeCli(
      `process.stdout.write("mview: http://127.0.0.1:1234/?t=abc\\nPress Ctrl+C to stop.\\n");
process.stdout.on("error", () => {});
setInterval(() => process.stdout.write("later\\n"), 50);`,
    );
    const out = sink();
    const err = sink();
    const code = await runDetached({ execPath: process.execPath, script, file: "/tmp/x.md", port: 4000, open: false, stdout: out, stderr: err });
    expect(code).toBe(0);
    expect(out.text()).toBe("mview: http://127.0.0.1:1234/?t=abc\n");
    expect(err.text()).toBe("");
    const { pid, argv } = await readRecord(record);
    expect(argv).toEqual(["--auto-close", "--port", "4000", "--no-open", "--", "/tmp/x.md"]);
    // Still alive although its stdout reader is gone (its later writes get EPIPE, which it ignores like the real CLI).
    await new Promise((r) => setTimeout(r, 200));
    expect(alive(pid)).toBe(true);
  });

  it("does not forward --port or --no-open when they were not given", async () => {
    const { script, record } = fakeCli(`process.stdout.write("mview: http://127.0.0.1:1/?t=a\\n"); setInterval(() => {}, 1000);`);
    const code = await runDetached({ execPath: process.execPath, script, file: "/tmp/y.md", port: 0, open: true, stdout: sink(), stderr: sink() });
    expect(code).toBe(0);
    expect((await readRecord(record)).argv).toEqual(["--auto-close", "--", "/tmp/y.md"]);
  });

  it("reports the copy's stderr and exits 1 when it dies before printing the URL", async () => {
    const { script } = fakeCli(`process.stderr.write("mview: listen EADDRINUSE\\n"); process.exit(1);`);
    const out = sink();
    const err = sink();
    const code = await runDetached({ execPath: process.execPath, script, file: "/tmp/z.md", port: 1, open: false, stdout: out, stderr: err });
    expect(code).toBe(1);
    expect(out.text()).toBe("");
    expect(err.text()).toBe("mview: listen EADDRINUSE\n");
  });

  it("kills the copy and exits 1 when it never prints the URL within the timeout", async () => {
    const { script, record } = fakeCli(`setInterval(() => {}, 1000);`);
    const out = sink();
    const err = sink();
    const code = await runDetached({
      execPath: process.execPath,
      script,
      file: "/tmp/w.md",
      port: 0,
      open: false,
      timeoutMs: 500,
      stdout: out,
      stderr: err,
    });
    expect(code).toBe(1);
    expect(out.text()).toBe("");
    expect(err.text()).toBe("mview: the background server did not start\n");
    const { pid } = await readRecord(record);
    const start = Date.now();
    while (alive(pid) && Date.now() - start < 3000) await new Promise((r) => setTimeout(r, 20));
    expect(alive(pid)).toBe(false);
  });
});
