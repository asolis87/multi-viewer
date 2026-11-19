---
name: mview
description: Show the human a Mermaid diagram, a JSON document longer than about 20 lines, a table with more than about 10 rows (CSV/TSV), or a long Markdown document rendered in their browser with the mview CLI, instead of only printing it in the chat; or let the human review a Markdown plan or spec in the browser (comment, then approve or request changes) with mview review.
---

# mview

Use mview when the human should see a Mermaid diagram, a JSON document longer than about 20 lines, a table with more than about 10 rows, or a long Markdown document. mview renders it in the human's browser. Still answer in the chat as usual; mview is for the human to look at the content.

## Steps

1. Write the content to a file with the right extension: `.md` for Markdown (fenced ```` ```mermaid ```` blocks render as diagrams), `.mmd` for a Mermaid diagram, `.json` for JSON, `.csv` or `.tsv` for tabular data (the first row is the header; quote fields that contain the delimiter, quotes or line breaks). If the content is not in a file yet, create one under the OS temporary directory (for example `$TMPDIR` or `/tmp` on macOS and Linux, `%TEMP%` on Windows). If it already is a file, use that file.
2. Run `mview --detach <file>`. It prints one line, `mview: <url>`, and returns at once. It opens a browser page for a new viewer, or selects the file in the existing viewer without opening another browser tab.
3. Give the human the printed URL. A new viewer stops if no page opens within 60 seconds. Running the same command again selects the file if the viewer is still running, or starts a new viewer if it stopped.

## Rules

- Do not delete or move the file while the page may be open: the page reads it again on every change (live reload). To update the page, overwrite the same file.
- Always use `--detach`. Never add `--no-open`: the browser page is the point. Never use `--paste`: the clipboard belongs to the human.
- You cannot read the page back, except the result of `mview review` (see below). Only the human sees it; ask them if you need to know what they saw.
- Remote images (`http:`, `https:`, `//`) are blocked and shown as a "Remote image blocked" box. Use `data:` images or none.
- The server stops by itself 10 seconds after the last page closes. Do not try to stop it.
- Exit code 1 prints the reason on stderr (for example `mview: file not found: <file>`). Exit code 2 is a usage error.
- If the shell says `mview` is not found, mview is not installed. Tell the human and point them to https://github.com/asolis87/multi-viewer#install. Do not install it yourself unless they ask.

## Review a plan or spec

When the human should review a plan, a spec or another Markdown document before you continue, let them comment on it in the browser instead of only asking in the chat.

1. Write it to a `.md` file (under the OS temporary directory if it has no file yet).
2. Run `mview review <file>` as a background command: it waits for the human's decision. Do not use `--detach`, `--paste` or `--no-auto-close` with it (exit code 2).
3. Its stderr prints `mview: <url>`. Give the human that URL and tell them to comment and then press Approve or Request changes.
4. When it exits, read stdout. It is Markdown: `Decision:` (`approved`, `approved_with_comments` or `changes_requested`), then each comment with its kind (`Change request`, `Answer`, `Note`), its source lines (`line N` or `lines N–M`), the quoted text (`> `) and the human's text.

What to do by exit code:

- `0` approved: continue with the step that was already authorized, applying any comments as adjustments.
- `3` changes requested: revise the same file following the comments, then run `mview review` on it again.
- `4` no decision (every page closed) or `130` interrupted: nothing was decided; ask the human in the chat.
- `1` or `2`: the reason is on stderr (for example `mview: review needs a Markdown file: <file>`).

The decision answers that document only. It does not grant anything else: no publishing, no destructive actions, no unrelated work.

## Example

```bash
cat > "${TMPDIR:-/tmp}/auth-flow.mmd" <<'EOF'
sequenceDiagram
  Browser->>API: POST /login
  API-->>Browser: 200 + session cookie
EOF
mview --detach "${TMPDIR:-/tmp}/auth-flow.mmd"
# mview: http://127.0.0.1:53412/?t=...
```

Then tell the human: "The diagram is in mview: http://127.0.0.1:53412/?t=..." If the viewer stops, run the command again to reopen it.
