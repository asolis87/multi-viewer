import { parseArgs } from "node:util";
import { AGENTS, type Agent } from "./skill.js";

export type CliArgs =
  | { kind: "run"; file: string | null; paste: boolean; open: boolean; port: number; autoClose: boolean; detach: boolean }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "skill-print" }
  | { kind: "skill-install"; agent: Agent; force: boolean }
  | { kind: "error"; message: string }
  /** A usage error printed as is, without the "--help" hint. */
  | { kind: "usage"; message: string };

export const HELP = `mview — view Markdown, Mermaid, JSON and CSV in your browser

Usage:
  mview <file>            Open a file and live-reload it when it changes
  mview --paste           Open the current clipboard content
  <command> | mview       Open content piped through stdin
  mview                   Open an empty page where you can paste (Cmd/Ctrl+V)
  mview --detach <file>   Start in the background, print the URL and return
  mview skill print       Print the bundled agent skill (SKILL.md)
  mview skill install --agent pi|claude|codex [--force]
                          Install the agent skill: pi and codex share
                          ~/.agents/skills/mview, claude uses ~/.claude/skills/mview;
                          --force replaces a different existing copy

Options:
  -p, --paste             Read the clipboard instead of a file
      --port <number>     Port to listen on (default: a free port)
      --no-open           Print the URL without opening the browser
      --auto-close        Stop when no page is open: 10 s after the last page
                          closes, or 60 s after start if no page ever opens
      --detach            Run the server in the background (implies
                          --auto-close), print only "mview: <url>" and exit;
                          needs a file
  -h, --help              Show this help
  -v, --version           Show the version

Types are detected from the file extension (.md, .markdown, .mmd, .mermaid,
.json, .csv, .tsv) or, for pasted/piped content, from the content itself. The server
listens on 127.0.0.1 only and stops with Ctrl+C (or by itself with --auto-close).
The skill is never installed automatically; use "mview skill print > <path>"
for other locations.`;

export const SKILL_USAGE = "usage: mview skill print | mview skill install --agent pi|claude|codex [--force]";
const CHOOSE_AGENT = "choose --agent pi|claude|codex";

export function parseCliArgs(argv: string[]): CliArgs {
  // S12: only a literal first argument `skill` is the subcommand; `./skill` stays a file.
  if (argv[0] === "skill") return parseSkillArgs(argv.slice(1));
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
        "auto-close": { type: "boolean", default: false },
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
  if (values.detach && (!file || values.paste)) return { kind: "usage", message: "--detach needs a file" };
  if (file && values.paste) return { kind: "error", message: "Use either a file or --paste, not both." };

  let port = 0;
  if (values.port !== undefined) {
    port = Number(values.port);
    if (!/^\d+$/.test(values.port) || port > 65535) {
      return { kind: "error", message: `Invalid --port: ${values.port}` };
    }
  }

  return {
    kind: "run",
    file,
    paste: Boolean(values.paste),
    open: values.open !== false,
    port,
    autoClose: Boolean(values["auto-close"]),
    detach: Boolean(values.detach),
  };
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
