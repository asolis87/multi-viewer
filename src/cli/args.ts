import { parseArgs } from "node:util";

export type CliArgs =
  | { kind: "run"; file: string | null; paste: boolean; open: boolean; port: number }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "error"; message: string };

export const HELP = `mview — view Markdown, Mermaid and JSON in your browser

Usage:
  mview <file>            Open a file and live-reload it when it changes
  mview --paste           Open the current clipboard content
  <command> | mview       Open content piped through stdin
  mview                   Open an empty page where you can paste (Cmd/Ctrl+V)

Options:
  -p, --paste             Read the clipboard instead of a file
      --port <number>     Port to listen on (default: a free port)
      --no-open           Print the URL without opening the browser
  -h, --help              Show this help
  -v, --version           Show the version

Types are detected from the file extension (.md, .markdown, .mmd, .mermaid,
.json) or, for pasted/piped content, from the content itself. The server
listens on 127.0.0.1 only and stops with Ctrl+C.`;

export function parseCliArgs(argv: string[]): CliArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      allowNegative: true,
      options: {
        paste: { type: "boolean", short: "p", default: false },
        open: { type: "boolean", default: true },
        port: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (error) {
    return { kind: "error", message: (error as Error).message };
  }

  const { values, positionals } = parsed;
  if (values.help) return { kind: "help" };
  if (values.version) return { kind: "version" };
  if (positionals.length > 1) return { kind: "error", message: "Only one file at a time is supported." };
  const file = positionals[0] ?? null;
  if (file && values.paste) return { kind: "error", message: "Use either a file or --paste, not both." };

  let port = 0;
  if (values.port !== undefined) {
    port = Number(values.port);
    if (!/^\d+$/.test(values.port) || port > 65535) {
      return { kind: "error", message: `Invalid --port: ${values.port}` };
    }
  }

  return { kind: "run", file, paste: Boolean(values.paste), open: values.open !== false, port };
}
