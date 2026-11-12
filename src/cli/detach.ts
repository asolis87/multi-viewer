import { spawn } from "node:child_process";

/** How long the foreground waits for the background copy to print its URL. */
export const DETACH_START_TIMEOUT_MS = 10_000;

interface Writer {
  write(text: string): void;
}

export interface DetachOptions {
  /** Node binary and CLI script used to start the background copy. */
  execPath: string;
  script: string;
  /** Absolute path of an already validated file. */
  file: string;
  /** 0 means "not given": the background copy picks a free port. */
  port: number;
  open: boolean;
  timeoutMs?: number;
  stdout: Writer;
  stderr: Writer;
}

/**
 * S10: start a background copy of mview on `file` with `--auto-close`, not tied to the terminal.
 * Forwards its first `mview: <url>` line and resolves 0; resolves 1 with its stderr if it exits
 * first, or after killing it when it does not print the URL within the timeout.
 */
export function runDetached(options: DetachOptions): Promise<number> {
  const argv = [
    options.script,
    "--auto-close",
    ...(options.port ? ["--port", String(options.port)] : []),
    ...(options.open ? [] : ["--no-open"]),
    "--",
    options.file,
  ];
  const child = spawn(options.execPath, argv, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const { stdout, stderr } = child;

  return new Promise((resolvePromise) => {
    let settled = false;
    let out = "";
    let err = "";

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Stop reading: the copy's later writes get EPIPE, which it ignores, and it no longer holds us.
      stdout.destroy();
      stderr.destroy();
      child.unref();
      resolvePromise(code);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      options.stderr.write("mview: the background server did not start\n");
      finish(1);
    }, options.timeoutMs ?? DETACH_START_TIMEOUT_MS);

    stdout.setEncoding("utf8");
    stdout.on("data", (chunk: string) => {
      out += chunk;
      const line = out.split("\n").slice(0, -1).find((l) => l.startsWith("mview: "));
      if (line === undefined || settled) return;
      options.stdout.write(`${line}\n`);
      finish(0);
    });
    stderr.setEncoding("utf8");
    stderr.on("data", (chunk: string) => (err += chunk));
    stdout.on("error", () => {});
    stderr.on("error", () => {});

    child.on("error", (error) => {
      options.stderr.write(`mview: could not start the background server: ${error.message}\n`);
      finish(1);
    });
    // "close" fires after the copy exited and its pipes drained, so `err` is complete.
    child.on("close", () => {
      if (settled) return;
      options.stderr.write(err === "" ? "mview: the background server stopped before it started\n" : err);
      finish(1);
    });
  });
}
