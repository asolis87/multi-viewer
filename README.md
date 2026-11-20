# mview

View Markdown, Mermaid, JSON and CSV in your browser, straight from the terminal or the clipboard.

```bash
mview README.md              # open a file; the page live-reloads when you save it
mview --paste                # open whatever is in your clipboard
curl -s api/thing | mview    # open piped content
mview                        # empty page: paste with Cmd/Ctrl+V
mview review plan.md         # comment on a plan, approve or request changes; the result goes to stdout
```

## Install

Requires Node.js 20 or later. mview is not on the npm registry yet; install the packaged release from GitHub:

```bash
pnpm add -g https://github.com/asolis87/multi-viewer/releases/download/v0.11.0/mview-0.11.0.tgz
# or
npm i -g https://github.com/asolis87/multi-viewer/releases/download/v0.11.0/mview-0.11.0.tgz
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

In the JSON and CSV search, a counter shows `<current> of <total>` matches; Enter and Shift+Enter (or the arrow buttons next to the box) go to the next and previous match, wrapping around.

In the CSV view, **Wrap text** shows long cell values across multiple lines. The choice is remembered in the browser.

The **Theme** selector in the page header switches between System (follows your OS), Light and Dark. The choice is not remembered: every run starts on System.

## Edit

Markdown and Mermaid documents have an **Edit** button in the page header, whatever their source (a file, the clipboard, stdin, or content pasted into the page); review pages and the empty paste page have none. It opens a plain text editor in the left column, next to the rendered view, which updates on every keystroke and keeps its features (outline, zoom and pan, Export SVG, the diagram canvas). While editing, the outline opens from the **Outline** button; on narrow windows the editor sits below the rendered view.

Nothing is saved to the file and nothing is sent to the server: the edited text lives only in that tab and is lost when you reload it. Use **Copy** (clipboard) or **Download** in the editor column to keep it. The download is named after the document with `.md` or `.mmd` for the shown type (`notes.markdown` → `notes.md`, `x.txt` shown as Mermaid → `x.mmd`), `pasted.md` for content pasted into the page and `edited.md` for clipboard or stdin content.

Closing the editor (×) keeps your edits: the rendered view still shows them, an **Edited** tag appears next to **Edit**, and reopening the editor brings them back. Switching **Render as** to JSON or CSV hides the editor and renders the edited text as that type; switching back to Markdown or Mermaid shows the editor again. A Mermaid parse error shows the usual error view; its **Go to line N** button selects that line in the editor.

Without edits, live reload works as usual and also updates the text in an open editor. Once the text differs from the file, a change on disk (or a file that can no longer be read) does not touch your edits: the editor shows a notice with **Discard edits and load the file**. The notice goes away when you discard or when your text matches the file again.

## Usage

```text
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
```

On macOS and Linux, `mview README.md` opens a viewer. While that viewer is running, `mview notas.md` attaches the second file without opening another browser tab. The attaching command prints the existing URL and exits; run the same file command again to select it without duplicating it. Each file still live-reloads on save. A tab opened through a symbolic link keeps the link’s name and follows changes to the original target, even if you remove the link.

A fixed `--port`, `--no-auto-close`, clipboard, stdin, empty paste pages and `mview review` start separate servers. On Windows, or when the temporary directory path is too long for a Unix socket, file commands also start separate servers. `--no-open` never opens the browser; use the printed URL if the viewer page is not already open.

If piped input never ends (for example a command that keeps running), mview says it is waiting for stdin; finish with `Ctrl+D` or cancel with `Ctrl+C`.

By default the server stops by itself (exit code 0) when no mview page is open: 10 seconds after the last open page closes, or 60 seconds after start if no page ever opens. Reloading the page or opening a new tab within those 10 seconds keeps it running. It prints `mview: no open pages, stopping` on stderr when it stops, which frees the terminal. The times are fixed. This applies to files, `--paste`, stdin, the empty paste page and `--no-open`; passing `--auto-close` explicitly changes nothing. Use `--no-auto-close` to keep the server running until `Ctrl+C`.

A page that stays hidden (minimized window or background tab) for 30 minutes disconnects from the server, so forgotten tabs let it stop too; the document stays on screen.

`mview --detach <file>` is for scripts and AI agents that must not block on the server. It checks the file first (same `file not found` / `not a file` errors), then attaches to the existing viewer or starts a server in the background with `--auto-close`. Only a new server opens the browser (unless `--no-open`). The command prints only `mview: <url>` and exits 0 — no `Press Ctrl+C to stop.`. `--port` and `--no-open` are passed on to the background server. It needs a file: without one, or with `--paste`, it exits 2 with `mview: --detach needs a file` (piped stdin is not read). It always stops by itself: `--detach --no-auto-close` exits 2 with `mview: --detach always stops by itself; drop --no-auto-close`. If the background server cannot start (for example the `--port` is in use), its error is printed and the exit code is 1. Once started it writes nothing more and stops by itself as described above.

## Review

`mview review <file>` opens a Markdown plan or spec as a review page and waits until you submit a decision. In the page, select text (or use a block's comment control) to leave a comment on those source lines: a **Change request** (the default), an **Answer** to an open question, or a **Note**. Then press **Request changes** (needs at least one comment) or **Approve** (**Approve with comments** when there are comments).

It takes exactly one file: `.md`, `.markdown`, or a file without a known extension (otherwise exit 1 with `mview: review needs a Markdown file: <file>`; no file or more than one exits 2 with `mview: review takes one Markdown file`). The file is checked like any other (`file not found` / `not a file`, exit 1). `--port`, `--no-open` and `--auto-close` work as usual; `--paste`, `--detach` and `--no-auto-close` exit 2 with `mview: review takes a file and waits for the decision`. Piped stdin is not read. `mview ./review` still opens a file named `review`.

Both startup lines (`mview: <url>` and `Press Ctrl+C to stop.`) go to stderr, so stdout carries only the result, written as Markdown when you submit. Comments are in document order (by start line, then the order you wrote them), each with its kind, its source lines, the quoted selection (`> ` on each line, left out for whole-block comments) and your text (a `#` at the start of a line, after at most three spaces, gets a `\` before it):

```markdown
# Review: plan.md
Decision: changes_requested
Comments: 2

## 1. Change request — lines 12–14
> Use Flask for the server

Use FastAPI instead.

## 2. Answer — line 40
> Should the cache be shared?

Yes, one cache per process.
```

`Decision:` is `approved`, `approved_with_comments` or `changes_requested`. Exit codes: `0` approved (with or without comments), `3` changes requested, `130` interrupted, `4` no decision — every page closed (10 seconds after the last one, or 60 seconds if none opened) without a submission, which prints `mview: review closed without a decision` on stderr and nothing on stdout; `1` and `2` as for any other command. `Ctrl+C` (or SIGTERM) stops it with exit code `130` and prints nothing on stdout, so an interrupted review never reads as approved. No file is written; to keep the result, redirect it: `mview review plan.md > plan.review.md`.

The page sends the decision back with `POST /api/review`, which exists only on servers started by `mview review` and accepts one submission per run; it requires the run's token, the page's own `Origin`, a JSON body and at most 256 KB. Every other server still answers `405` to any `POST`.

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
- The browser API is read-only, except for the one submission of `mview review` (same token, same-origin `Origin` and JSON only). File tabs expose only names and opaque IDs, not local paths. Only CLI processes with access to the same account’s private Unix socket can register files. Edits made in the page are never sent to the server.
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
