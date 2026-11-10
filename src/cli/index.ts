#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HELP, parseCliArgs } from "./args.js";
import { emptyDoc, fromContent, readFileDoc, readStream, type Doc } from "./input.js";
import { startServer } from "./server.js";

const here = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(here, "../web");

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
  if (args.kind === "error") {
    process.stderr.write(`mview: ${args.message}\nRun "mview --help" for usage.\n`);
    return 2;
  }

  let getDoc: () => Promise<Doc>;
  let watchPath: string | null = null;

  if (args.file) {
    const path = resolve(args.file);
    try {
      await access(path);
    } catch {
      process.stderr.write(`mview: file not found: ${args.file}\n`);
      return 1;
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
    const doc = fromContent(await readStream(process.stdin), "stdin");
    getDoc = async () => doc;
  } else {
    getDoc = async () => emptyDoc();
  }

  const server = await startServer({
    webRoot: WEB_ROOT,
    token: randomBytes(24).toString("base64url"),
    port: args.port,
    getDoc,
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

  await new Promise<void>((done) => {
    const stop = () => done();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
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

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: Error) => {
    process.stderr.write(`mview: ${error.message}\n`);
    process.exit(1);
  },
);
