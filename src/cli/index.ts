#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HELP, parseCliArgs } from "./args.js";
import { runDetached } from "./detach.js";
import { emptyDoc, fromContent, readFileDoc, readStream, type Doc } from "./input.js";
import { startServer } from "./server.js";

const here = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(here, "../web");
const STDIN_NOTICE_MS = 1000;
// S11: fixed for the CLI; startServer takes them as parameters so tests can use milliseconds.
const AUTO_CLOSE_AFTER_LAST_MS = 10_000;
const AUTO_CLOSE_NONE_MS = 60_000;

async function main(argv: string[]): Promise<number> {
  const args = parseCliArgs(argv);
  if (args.kind === "help") {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  if (args.kind === "version") {
    process.stdout.write(`${readVersion()}\n`);
    return 0;
  }
  if (args.kind === "usage") {
    process.stderr.write(`mview: ${args.message}\n`);
    return 2;
  }
  if (args.kind === "error") {
    process.stderr.write(`mview: ${args.message}\nRun "mview --help" for usage.\n`);
    return 2;
  }

  let getDoc: () => Promise<Doc>;
  let watchPath: string | null = null;

  if (args.file) {
    const path = resolve(args.file);
    let info;
    try {
      info = await stat(path);
    } catch {
      process.stderr.write(`mview: file not found: ${args.file}\n`);
      return 1;
    }
    if (!info.isFile()) {
      process.stderr.write(`mview: not a file: ${args.file}\n`);
      return 1;
    }
    if (args.detach) {
      return runDetached({
        execPath: process.execPath,
        script: fileURLToPath(import.meta.url),
        file: path,
        port: args.port,
        open: args.open,
        stdout: process.stdout,
        stderr: process.stderr,
      });
    }
    watchPath = path;
    getDoc = () => readFileDoc(path);
  } else if (args.paste) {
    const { default: clipboard } = await import("clipboardy");
    let text: string;
    try {
      text = await clipboard.read();
    } catch (error) {
      process.stderr.write(`mview: could not read the clipboard: ${(error as Error).message}\n`);
      return 1;
    }
    if (text.trim() === "") {
      process.stderr.write("mview: the clipboard is empty\n");
      return 1;
    }
    const doc = fromContent(text, "paste");
    getDoc = async () => doc;
  } else if (!process.stdin.isTTY) {
    // A pipe that stays open (e.g. launched from an IDE task) would otherwise hang silently.
    const notice = setTimeout(
      () => process.stderr.write("mview: waiting for input on stdin (press Ctrl+D to finish, Ctrl+C to cancel)\n"),
      STDIN_NOTICE_MS,
    );
    const text = await readStream(process.stdin).finally(() => clearTimeout(notice));
    // Empty piped input (e.g. `mview < /dev/null`) gets the paste page instead of a blank document.
    const doc = text.trim() === "" ? emptyDoc() : fromContent(text, "stdin");
    getDoc = async () => doc;
  } else {
    getDoc = async () => emptyDoc();
  }

  let stop: () => void = () => {};
  const stopped = new Promise<void>((done) => (stop = done));

  const server = await startServer({
    webRoot: WEB_ROOT,
    token: randomBytes(24).toString("base64url"),
    port: args.port,
    getDoc,
    ...(args.autoClose
      ? {
          idle: {
            afterLastMs: AUTO_CLOSE_AFTER_LAST_MS,
            noneMs: AUTO_CLOSE_NONE_MS,
            onIdle: () => {
              process.stderr.write("mview: no open pages, stopping\n");
              stop();
            },
          },
        }
      : {}),
  });

  let watcher: { close(): Promise<void> } | null = null;
  if (watchPath) {
    const { watch } = await import("chokidar");
    const w = watch(watchPath, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 } });
    w.on("all", () => server.notifyChange());
    watcher = w;
  }

  process.stdout.write(`mview: ${server.url}\nPress Ctrl+C to stop.\n`);
  if (args.open) {
    const { default: open } = await import("open");
    open(server.url).catch(() => process.stderr.write("mview: could not open the browser; open the URL above.\n"));
  }

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await stopped;
  await watcher?.close();
  await server.close();
  return 0;
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(here, "../../package.json"), "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

// A detached copy (S10) outlives the terminal that read its output: writes then fail with
// EPIPE, which must not crash the server. A closed stdout/stderr is never a reason to stop.
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: Error) => {
    process.stderr.write(`mview: ${error.message}\n`);
    process.exit(1);
  },
);
