# mview

View Markdown, Mermaid and JSON in your browser, straight from the terminal or the clipboard.

```bash
mview README.md              # open a file; the page live-reloads when you save it
mview --paste                # open whatever is in your clipboard
curl -s api/thing | mview    # open piped content
mview                        # empty page: paste with Cmd/Ctrl+V
```

## Install

Requires Node.js 20 or later. mview is not on the npm registry yet; install the packaged release from GitHub:

```bash
pnpm add -g https://github.com/asolis87/multi-viewer/releases/download/v0.1.0/mview-0.1.0.tgz
# or
npm i -g https://github.com/asolis87/multi-viewer/releases/download/v0.1.0/mview-0.1.0.tgz
```

With pnpm, run `pnpm setup` once if it says the global bin directory is not in your `PATH`. Uninstall with `pnpm remove -g mview` or `npm rm -g mview`.

Installing straight from the source (`pnpm add -g github:asolis87/multi-viewer`) does not work: the repository holds no build output, npm does not install the build tools for a global git install, and pnpm refuses to run a git package's build script unless it is allowlisted.

## What it renders

| Type | Detected by | Features |
| --- | --- | --- |
| Markdown | `.md`, `.markdown`, or anything that is not JSON/Mermaid | Tables, highlighted code, ```` ```mermaid ```` blocks rendered as diagrams |
| Mermaid | `.mmd`, `.mermaid`, or content starting with a diagram keyword (`flowchart`, `sequenceDiagram`, …) | Zoom, pan, export SVG |
| JSON | `.json`, or content that parses as a JSON object/array | Collapsible tree, search, click to copy a path like `a.b[3].c` |

The file extension wins when it is known. You can always override the detected type from the selector in the page header.

The **Theme** selector in the page header switches between System (follows your OS), Light and Dark. The choice is not remembered: every run starts on System.

## Usage

```text
mview <file>            Open a file and live-reload it when it changes
mview --paste           Open the current clipboard content
<command> | mview       Open content piped through stdin
mview                   Open an empty page where you can paste (Cmd/Ctrl+V)

-p, --paste             Read the clipboard instead of a file
    --port <number>     Port to listen on (default: a free port)
    --no-open           Print the URL without opening the browser
-h, --help              Show this help
-v, --version           Show the version
```

If piped input never ends (for example a command that keeps running), mview says it is waiting for stdin; finish with `Ctrl+D` or cancel with `Ctrl+C`. Each run starts its own server; stop it with `Ctrl+C`. One file at a time (no tabs yet).

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
