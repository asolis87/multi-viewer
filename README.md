# mview

View Markdown, Mermaid, JSON and CSV in your browser, straight from the terminal or the clipboard.

```bash
mview README.md              # open a file; the page live-reloads when you save it
mview --paste                # open whatever is in your clipboard
curl -s api/thing | mview    # open piped content
mview                        # empty page: paste with Cmd/Ctrl+V
```

## Install

Requires Node.js 20 or later. mview is not on the npm registry yet; install the packaged release from GitHub:

```bash
pnpm add -g https://github.com/asolis87/multi-viewer/releases/download/v0.5.0/mview-0.5.0.tgz
# or
npm i -g https://github.com/asolis87/multi-viewer/releases/download/v0.5.0/mview-0.5.0.tgz
```

With pnpm, run `pnpm setup` once if it says the global bin directory is not in your `PATH`. Uninstall with `pnpm remove -g mview` or `npm rm -g mview`.

Installing straight from the source (`pnpm add -g github:asolis87/multi-viewer`) does not work: the repository holds no build output, npm does not install the build tools for a global git install, and pnpm refuses to run a git package's build script unless it is allowlisted.

## What it renders

| Type | Detected by | Features |
| --- | --- | --- |
| Markdown | `.md`, `.markdown`, or anything that is not JSON/Mermaid/CSV | Tables, highlighted code, ```` ```mermaid ```` blocks rendered as diagrams |
| Mermaid | `.mmd`, `.mermaid`, or content starting with a diagram keyword (`flowchart`, `sequenceDiagram`, …) | Zoom, pan, export SVG |
| JSON | `.json`, or content that parses as a JSON object/array | Collapsible tree, search, click to copy a path like `a.b[3].c` |
| CSV / TSV | `.csv`, `.tsv`, or content whose first records split evenly on tab, `;` or `,` (first row is the header) | Table with sticky header, click a header to sort, search, row inspector, column outline; large files are shown in pages of 200 rows |

The file extension wins when it is known. You can always override the detected type from the selector in the page header.

The **Theme** selector in the page header switches between System (follows your OS), Light and Dark. The choice is not remembered: every run starts on System.

## Usage

```text
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

-p, --paste             Read the clipboard instead of a file
    --port <number>     Port to listen on (default: a free port)
    --no-open           Print the URL without opening the browser
    --auto-close        Stop when no page is open (the default): 10 s after
                        the last page closes, or 60 s after start if no page
                        ever opens
    --no-auto-close     Keep the server running until Ctrl+C
    --detach            Run the server in the background (always
                        --auto-close), print only "mview: <url>" and exit;
                        needs a file
-h, --help              Show this help
-v, --version           Show the version
```

If piped input never ends (for example a command that keeps running), mview says it is waiting for stdin; finish with `Ctrl+D` or cancel with `Ctrl+C`. Each run starts its own server, which stops by itself (see below) or with `Ctrl+C`. One file at a time (no tabs yet).

By default the server stops by itself (exit code 0) when no mview page is open: 10 seconds after the last open page closes, or 60 seconds after start if no page ever opens. Reloading the page or opening a new tab within those 10 seconds keeps it running. It prints `mview: no open pages, stopping` on stderr when it stops, which frees the terminal. The times are fixed. This applies to files, `--paste`, stdin, the empty paste page and `--no-open`; passing `--auto-close` explicitly changes nothing. Use `--no-auto-close` to keep the server running until `Ctrl+C`.

A page that stays hidden (minimized window or background tab) for 30 minutes disconnects from the server, so forgotten tabs let it stop too; the document stays on screen.

`mview --detach <file>` is for scripts and AI agents that must not block on the server. It checks the file first (same `file not found` / `not a file` errors), then starts the server in the background with `--auto-close`, opens the browser (unless `--no-open`), prints only `mview: <url>` and exits 0 — no `Press Ctrl+C to stop.`. `--port` and `--no-open` are passed on to the background server. It needs a file: without one, or with `--paste`, it exits 2 with `mview: --detach needs a file` (piped stdin is not read). It always stops by itself: `--detach --no-auto-close` exits 2 with `mview: --detach always stops by itself; drop --no-auto-close`. If the background server cannot start (for example the `--port` is in use), its error is printed and the exit code is 1. Once started it writes nothing more and stops by itself as described above.

## Agent skill

mview ships a skill ([`skills/mview/SKILL.md`](skills/mview/SKILL.md)) that tells AI coding agents to show you Mermaid diagrams, long JSON, long Markdown and CSV/TSV tables with `mview --detach <file>` instead of only printing them in the chat. It is never installed automatically; install it for one agent at a time:

```bash
mview skill install --agent pi       # ~/.agents/skills/mview/SKILL.md
mview skill install --agent codex    # same file: pi and codex share ~/.agents/skills
mview skill install --agent claude   # ~/.claude/skills/mview/SKILL.md
```

Missing directories are created. If the same skill is already there, it says `mview: skill already up to date: <path>` and writes nothing (so installing for `codex` after `pi` reports this). If a different file is already there, it exits 1 and leaves it alone; add `--force` to replace it (for example after upgrading mview). `--agent` is required and accepts exactly one of `pi`, `claude` or `codex` (otherwise exit 2).

For any other location, print the skill and redirect it:

```bash
mkdir -p <dir>/mview && mview skill print > <dir>/mview/SKILL.md
```

## Privacy and security

Rendered content is often pasted or AI-generated, so mview treats it as untrusted:

- The server listens on `127.0.0.1` only and rejects requests with a foreign `Host` header.
- Every run uses a random token in the URL; API requests without it get `403`.
- Markdown HTML is sanitized with DOMPurify, Mermaid runs with `securityLevel: 'strict'`, and the page ships a strict Content-Security-Policy.
- Remote images are never loaded, so a document cannot report that you opened it. They are replaced by a "Remote image blocked" box with the alt text and the URL. `data:` images still render; local relative images (`./img.png`) are not served yet.
- Everything is bundled: no CDN, no telemetry, works offline.

## Development

```bash
npm install
npm run build     # builds the Svelte frontend (dist/web) and the CLI (dist/cli)
npm test          # Vitest
npm run check     # type-check CLI and frontend
npm link          # puts `mview` on your PATH
```

To cut a release, build and test on a clean `main`, then attach the tarball to a GitHub release:

```bash
npm run build && npm test
npm pack                                    # writes mview-<version>.tgz
gh release create v<version> mview-<version>.tgz --target "$(git rev-parse HEAD)"
```
