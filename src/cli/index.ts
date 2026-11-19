#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HELP, parseCliArgs } from "./args.js";
import { typeFromFilename } from "../shared/detect.js";
import type { ReviewSubmission } from "../shared/review.js";
import { runDetached } from "./detach.js";
import { emptyDoc, fromContent, readFileDoc, readStream, type Doc } from "./input.js";
import { formatReview, reviewExitCode } from "./review.js";
import { fileTabs, watchFile } from "./file-tabs.js";
import { startServer } from "./server.js";
import { attachToSession, serveSession, sessionDirectory } from "./session.js";
import { installSkill, readSkill } from "./skill.js";

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
  if (args.kind === "skill-print") {
    let skill: Buffer;
    try {
      skill = await readSkill();
    } catch (error) {
      process.stderr.write(`mview: ${(error as Error).message}\n`);
      return 1;
    }
    // Wait for the write: process.exit() right after could cut off a piped stdout.
    await new Promise<void>((done) => process.stdout.write(skill, () => done()));
    return 0;
  }
  if (args.kind === "skill-install") {
    return installSkill(args.agent, args.force, process.stdout, process.stderr);
  }
  if (args.kind === "usage") {
    process.stderr.write(`mview: ${args.message}\n`);
    return 2;
  }
  if (args.kind === "error") {
    process.stderr.write(`mview: ${args.message}\nRun "mview --help" for usage.\n`);
    return 2;
  }

  if (args.kind === "review") return runReview(args.file, args.port, args.open);

  let getDoc: () => Promise<Doc>;
  let watchPath: string | null = null;
  let sessionDir: string | null = null;

  if (args.file) {
    const path = await checkFile(args.file);
    if (path === null) return 1;
    if (args.port === 0 && args.autoClose) {
      sessionDir = await sessionDirectory();
      const attached = sessionDir ? await attachToSession(sessionDir, path) : null;
      if (attached) {
        await new Promise<void>((done) => process.stdout.write(`mview: ${attached}\n`, () => done()));
        return 0;
      }
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

  let finish: () => void = () => {};
  let closing = false;
  const stopped = new Promise<void>((done) => (finish = done));
  const stop = () => { closing = true; finish(); };
  let notify = () => {};
  const tabs = sessionDir ? fileTabs(() => notify()) : undefined;
  if (tabs && watchPath) {
    await tabs.select(watchPath);
    // Requests without a tab ID still read the first tab, using the same stable target.
    getDoc = tabs.get(tabs.describe().active) ?? getDoc;
  }

  const server = await startServer({
    webRoot: WEB_ROOT,
    token: randomBytes(24).toString("base64url"),
    port: args.port,
    getDoc,
    fileTabs: tabs,
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

  notify = server.notifyChange;
  let watcher: Awaited<ReturnType<typeof watchFile>> | undefined;
  let closeSession: (() => void) | undefined;
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    if (sessionDir && tabs) {
      closeSession = await serveSession(sessionDir, server.url, async (path) => !closing && await tabs.select(path));
    } else if (watchPath) {
      watcher = await watchFile(watchPath, notify);
    }
    process.stdout.write(`mview: ${server.url}\nPress Ctrl+C to stop.\n`);
    if (args.open) await openBrowser(server.url);
    await stopped;
    return 0;
  } finally {
    closeSession?.();
    await Promise.all([watcher?.close(), tabs?.close(), server.close()]);
  }
}

/**
 * S17: serve one Markdown file as a review page and wait for the human's decision. Startup lines
 * go to stderr so stdout carries only the result. Piped stdin is never read.
 */
async function runReview(file: string, port: number, openPage: boolean): Promise<number> {
  const path = await checkFile(file);
  if (path === null) return 1;
  // S4's extension rule: .md, .markdown or no known extension.
  if ((typeFromFilename(basename(path)) ?? "markdown") !== "markdown") {
    process.stderr.write(`mview: review needs a Markdown file: ${file}\n`);
    return 1;
  }

  type Outcome = { kind: "submitted"; submission: ReviewSubmission } | { kind: "idle" } | { kind: "signal" };
  let finish: (outcome: Outcome) => void = () => {};
  const finished = new Promise<Outcome>((done) => (finish = done));

  const server = await startServer({
    webRoot: WEB_ROOT,
    token: randomBytes(24).toString("base64url"),
    port,
    // Reviewed as Markdown even when the content of an extension-less file sniffs as another type.
    getDoc: async () => ({ ...(await readFileDoc(path)), type: "markdown" }),
    idle: { afterLastMs: AUTO_CLOSE_AFTER_LAST_MS, noneMs: AUTO_CLOSE_NONE_MS, onIdle: () => finish({ kind: "idle" }) },
    review: { onSubmit: (submission) => finish({ kind: "submitted", submission }) },
  });
  const watcher = await watchFile(path, server.notifyChange);

  process.stderr.write(`mview: ${server.url}\nPress Ctrl+C to stop.\n`);
  if (openPage) await openBrowser(server.url);

  process.once("SIGINT", () => finish({ kind: "signal" }));
  process.once("SIGTERM", () => finish({ kind: "signal" }));
  const outcome = await finished;
  await watcher.close();
  await server.close();

  if (outcome.kind === "idle") {
    process.stderr.write("mview: review closed without a decision\n");
    return 4;
  }
  // 130, not 0: an interrupted review must never read as "approved" (L87).
  if (outcome.kind === "signal") return 130;
  const result = formatReview(basename(path), outcome.submission);
  // Wait for the write: process.exit() right after could cut off a piped stdout.
  await new Promise<void>((done) => process.stdout.write(result, () => done()));
  return reviewExitCode(outcome.submission.decision);
}

/** S2: the absolute path of an existing regular file, or `null` after printing why not. */
async function checkFile(file: string): Promise<string | null> {
  const path = resolve(file);
  let info;
  try {
    info = await stat(path);
  } catch {
    process.stderr.write(`mview: file not found: ${file}\n`);
    return null;
  }
  if (!info.isFile()) {
    process.stderr.write(`mview: not a file: ${file}\n`);
    return null;
  }
  return path;
}

async function openBrowser(url: string): Promise<void> {
  const { default: open } = await import("open");
  open(url).catch(() => process.stderr.write("mview: could not open the browser; open the URL above.\n"));
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
