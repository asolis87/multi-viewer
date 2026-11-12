---
name: mview
description: Show the human a Mermaid diagram, a JSON document longer than about 20 lines, a table with more than about 10 rows (CSV/TSV), or a long Markdown document rendered in their browser with the mview CLI, instead of only printing it in the chat.
---

# mview

Use mview when the human should see a Mermaid diagram, a JSON document longer than about 20 lines, a table with more than about 10 rows, or a long Markdown document. mview renders it in the human's browser. Still answer in the chat as usual; mview is for the human to look at the content.

## Steps

1. Write the content to a file with the right extension: `.md` for Markdown (fenced ```` ```mermaid ```` blocks render as diagrams), `.mmd` for a Mermaid diagram, `.json` for JSON, `.csv` or `.tsv` for tabular data (the first row is the header; quote fields that contain the delimiter, quotes or line breaks). If the content is not in a file yet, create one under the OS temporary directory (for example `$TMPDIR` or `/tmp` on macOS and Linux, `%TEMP%` on Windows). If it already is a file, use that file.
2. Run `mview --detach <file>`. It returns at once, opens the page in the human's browser and prints one line: `mview: <url>`.
3. Give the human the printed URL. Tell them it stops working if no page opens within 60 seconds, and that running the same command again opens a new one.

## Rules

- Do not delete or move the file while the page may be open: the page reads it again on every change (live reload). To update the page, overwrite the same file.
- Always use `--detach`. Never add `--no-open`: the browser page is the point. Never use `--paste`: the clipboard belongs to the human.
- You cannot read the page back. Only the human sees it; ask them if you need to know what they saw.
- Remote images (`http:`, `https:`, `//`) are blocked and shown as a "Remote image blocked" box. Use `data:` images or none.
- The server stops by itself 10 seconds after the last page closes. Do not try to stop it.
- Exit code 1 prints the reason on stderr (for example `mview: file not found: <file>`). Exit code 2 is a usage error.
- If the shell says `mview` is not found, mview is not installed. Tell the human and point them to https://github.com/asolis87/multi-viewer#install. Do not install it yourself unless they ask.

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

Then tell the human: "I opened the diagram in your browser: http://127.0.0.1:53412/?t=... — it stops working if no page opens within 60 seconds; running the same command again opens a new one."
