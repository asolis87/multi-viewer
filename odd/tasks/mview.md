# mview — CLI viewer for Markdown, Mermaid and JSON

Local CLI (`mview`) that opens the browser on a 127.0.0.1 server and renders Markdown (with embedded Mermaid), Mermaid and JSON from a file, the clipboard or stdin. Node + TypeScript CLI, Svelte frontend bundled into the package. v0.1 MVP.

## Specs

- **S1 — Formats.** User: "un viewer para markdown, mermaid, json para mi uso cotidiano". Render Markdown (GFM, syntax-highlighted code), Mermaid diagrams, and JSON.
- **S2 — Open files from the terminal.** User: "me gustaria poder abrir archivos desde la terminal". `mview <file>` starts a local server, opens the browser, and live-reloads when the file changes on disk.
- **S3 — Paste from the clipboard.** User: "o pegar desde el portapapeles". `mview --paste` renders the clipboard content; `cat x | mview` renders stdin; `mview` with no input opens an empty page with a paste area (Cmd/Ctrl+V).
- **S4 — AI-generated diagrams.** User: "tambien visualizo diagramas que me genera la IA". Fenced ```` ```mermaid ```` blocks inside Markdown render as diagrams; raw pasted Mermaid is auto-detected. Type detection: extension first (`.md/.markdown`, `.mmd/.mermaid`, `.json`); for content without a filename: valid `JSON.parse` → json; first non-empty line starts with a Mermaid diagram keyword → mermaid; otherwise markdown. A manual type selector can override detection.
- **S5 — CLI that opens the browser.** User: "me gustaria explorar la idea de CLI que abre el navegador". One server per invocation on a free port, closed with Ctrl+C.
- **S6 — Publishable later.** User: "para el alcance mas adelante me gustaria publicarlo". npm-installable package; works offline (no CDN); server binds 127.0.0.1 only; random per-run token required on every API request; Markdown HTML sanitized (DOMPurify); Mermaid `securityLevel: 'strict'`.
- **S7 — Decisions.** User: "1. Svelte 2. mview esta bien 3. dejamos pestañas para despues". Svelte frontend; binary name `mview`; no tabs in v0.1.
- **S8 — Accepted MVP extras** (proposal accepted with S7): JSON tree with collapse/expand, search, copy path (`a.b[3].c`); light/dark theme following the system.

### Server contract (shared by CLI and frontend)

- `GET /?t=<token>` → frontend `index.html`; static assets under `/assets/*`.
- `GET /api/doc?t=<token>` → `{ name: string|null, type: "markdown"|"mermaid"|"json", content: string, source: "file"|"paste"|"stdin"|"empty" }`.
- `GET /api/events?t=<token>` → SSE; emits `event: change` when the watched file changes.
- Missing/wrong token on `/api/*` → `403`. Unknown path → `404`.
- Detection lives in `src/shared/detect.ts` (`detectType(content, filename?)`), used by both sides.

## Tasks

- [ ] T1 — Scaffold package (TS, Vite+Svelte, Vitest, build, bin) · S6,S7 · commit: —
- [ ] T2 — Type detection module + tests · S4 · commit: —
- [ ] T3 — CLI + server: args, file/paste/stdin, token, 127.0.0.1, SSE watch, open browser · S2,S3,S5,S6 · Risk: item 2 · commit: —
- [ ] T4 — Frontend: Markdown + highlight + DOMPurify + Mermaid (fenced and raw) · S1,S4,S6 · Risk: item 2 · commit: —
- [ ] T5 — Frontend: JSON tree (collapse, search, copy path) · S1,S8 · commit: —
- [ ] T6 — Frontend: empty-page paste area, type selector, theme · S3,S4,S8 · commit: —
- [ ] T7 — README + `--help` · S2,S3,S6 · commit: —

## Log

- L1 (user, original request): "tengo una idea de hacer un viewer para markdown, mermaid, json para mi uso cotidiano.. podemos explorar la idea?"
- L2 (user): "para la entrada principal me gustaria poder abrir archivos desde la terminal o pegar desde el portapapeles, mi diario real, hoy abro archivos desde terminal o pego archivos desde el portapapeles, tambien visualizo diagramas que me genera la IA. me gustaria explorar la idea de CLI que abre el navegador. para el alcance mas adelante me gustaria publicarlo."
- L3 (user): "1. Svelte 2. mview esta bien 3. dejamos pestañas para despues"
- L4 (evidence): npm package name `mview` is already taken (`mview@0.2.1`, "View materialization utilities for distributed databases"). Binary stays `mview`; publish name (e.g. scoped `@<user>/mview`) is a pending user decision before publishing.
