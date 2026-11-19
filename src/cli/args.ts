import { parseArgs } from "node:util";
import { AGENTS, type Agent } from "./skill.js";

export type CliArgs =
  | { kind: "run"; file: string | null; paste: boolean; open: boolean; port: number; autoClose: boolean; detach: boolean }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "skill-print" }
  | { kind: "skill-install"; agent: Agent; force: boolean }
  | { kind: "review"; file: string; open: boolean; port: number }
  | { kind: "error"; message: string }
  /** A usage error printed as is, without the "--help" hint. */
  | { kind: "usage"; message: string };

export const HELP = `mview — view Markdown, Mermaid, JSON and CSV in your browser

Usage:
  mview <file>            Open or select a file in the viewer; live-reload it on save
  mview --paste           Open the current clipboard content
  <command> | mview       Open content piped through stdin
  mview                   Open an empty page where you can paste (Cmd/Ctrl+V)
  mview --detach <file>   Reuse the viewer or start it in the background and print its URL
  mview review <file>     Open a Markdown file for review and wait for the
                          decision: comment on its lines in the page, then
                          Approve or Request changes (see "Review" below)
  mview skill print       Print the bundled agent skill (SKILL.md)
  mview skill install --agent pi|claude|codex [--force]
                          Install the agent skill: pi and codex share
                          ~/.agents/skills/mview, claude uses ~/.claude/skills/mview;
                          --force replaces a different existing copy

Options:
  -p, --paste             Read the clipboard instead of a file
      --port <number>     Port to listen on (default: a free port)
      --no-open           Print the URL without opening the browser
      --auto-close        Stop when no page is open (the default): 10 s after
                          the last page closes, or 60 s after start if no page
                          ever opens
      --no-auto-close     Keep the server running until Ctrl+C
      --detach            Attach or start in the background (always
                          --auto-close), print only "mview: <url>" and exit;
                          needs a file
  -h, --help              Show this help
  -v, --version           Show the version

Types are detected from the file extension (.md, .markdown, .mmd, .mermaid,
.json, .csv, .tsv) or, for pasted/piped content, from the content itself. The server
listens on 127.0.0.1 only. It stops by itself once no page is open, or with Ctrl+C;
use --no-auto-close to keep it running until Ctrl+C. A page hidden for 30 minutes
(minimized or a background tab) disconnects, so forgotten tabs let it stop too.
On macOS/Linux, another file command reuses the viewer without opening the
browser again. A fixed --port, --no-auto-close, clipboard, stdin and review
use separate servers. --no-open never opens the browser.
The skill is never installed automatically; use "mview skill print > <path>"
for other locations.

Review: "mview review <file>" takes one .md or .markdown file (or one without a
known extension). Its two startup lines go to stderr; when the human submits,
it prints the review as Markdown on stdout (decision, then each comment with
its kind, source lines, quote and text) and exits: 0 approved (with or without
comments), 3 changes requested, 4 every page closed without a decision
("mview: review closed without a decision" on stderr, nothing on stdout),
130 interrupted with Ctrl+C.
It writes no file: "mview review plan.md > plan.review.md" keeps one. --port,
--no-open and --auto-close work as usual; --paste, --detach and
--no-auto-close are rejected, and piped stdin is not read.`;

export const SKILL_USAGE = "usage: mview skill print | mview skill install --agent pi|claude|codex [--force]";
const CHOOSE_AGENT = "choose --agent pi|claude|codex";

export const REVIEW_ONE_FILE = "review takes one Markdown file";
export const REVIEW_WAITS = "review takes a file and waits for the decision";

export function parseCliArgs(argv: string[]): CliArgs {
  // S12: only a literal first argument `skill` is the subcommand; `./skill` stays a file.
  if (argv[0] === "skill") return parseSkillArgs(argv.slice(1));
  // S17: likewise for `review`; `./review` stays a file.
  if (argv[0] === "review") return parseReviewArgs(argv.slice(1));
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
        // S14: on by default; `--no-auto-close` (allowNegative) turns it off.
        "auto-close": { type: "boolean", default: true },
        detach: { type: "boolean", default: false },
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
  // S14: checked before "--detach needs a file". With the default on, false only comes from --no-auto-close.
  if (values.detach && values["auto-close"] === false) {
    return { kind: "usage", message: "--detach always stops by itself; drop --no-auto-close" };
  }
  if (values.detach && (!file || values.paste)) return { kind: "usage", message: "--detach needs a file" };
  if (file && values.paste) return { kind: "error", message: "Use either a file or --paste, not both." };

  const port = parsePort(values.port);
  if (typeof port === "object") return port;

  return {
    kind: "run",
    file,
    paste: Boolean(values.paste),
    open: values.open !== false,
    port,
    autoClose: values["auto-close"] !== false,
    detach: Boolean(values.detach),
  };
}

function parsePort(value: string | undefined): number | CliArgs {
  if (value === undefined) return 0;
  const port = Number(value);
  if (!/^\d+$/.test(value) || port > 65535) return { kind: "error", message: `Invalid --port: ${value}` };
  return port;
}

function parseReviewArgs(argv: string[]): CliArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      allowNegative: true,
      options: {
        // Parsed only to reject them with the S17 message instead of "Unknown option".
        paste: { type: "boolean", short: "p" },
        detach: { type: "boolean" },
        open: { type: "boolean", default: true },
        port: { type: "string" },
        "auto-close": { type: "boolean", default: true },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    return { kind: "error", message: (error as Error).message };
  }
  const { values, positionals } = parsed;
  if (values.help) return { kind: "help" };
  // A review always waits for the decision in the foreground and always stops by itself.
  if (values.paste || values.detach || values["auto-close"] === false) {
    return { kind: "usage", message: REVIEW_WAITS };
  }
  const file = positionals[0];
  if (positionals.length !== 1 || file === undefined) return { kind: "usage", message: REVIEW_ONE_FILE };
  const port = parsePort(values.port);
  if (typeof port === "object") return port;
  return { kind: "review", file, open: values.open !== false, port };
}

function parseSkillArgs(argv: string[]): CliArgs {
  const usage: CliArgs = { kind: "usage", message: SKILL_USAGE };
  const [command, ...rest] = argv;
  if (command === "print") return rest.length === 0 ? { kind: "skill-print" } : usage;
  if (command !== "install") return usage;

  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        agent: { type: "string", multiple: true },
        force: { type: "boolean", default: false },
      },
    });
  } catch (error) {
    // `--agent` without a value counts as a missing agent; any other unknown option is a usage error.
    return (error as Error).message.includes("--agent") ? { kind: "usage", message: CHOOSE_AGENT } : usage;
  }
  if (parsed.positionals.length > 0) return usage;
  const agents = parsed.values.agent ?? [];
  const agent = agents[0];
  if (agents.length !== 1 || agent === undefined || !(AGENTS as readonly string[]).includes(agent)) return { kind: "usage", message: CHOOSE_AGENT };
  return { kind: "skill-install", agent: agent as Agent, force: Boolean(parsed.values.force) };
}
