# mview design system

Derived from the project's design sources. Read-only sync: every value below is copied from a source file; nothing is invented.

Sources:

- `src/web/styles.css` — the implemented Workbench stylesheet (tokens, components, manual theme via `data-theme`).
- `design/mview-viewer/02-workbench.html` — the chosen Workbench artboard (S9), the visual spec the stylesheet implements.
- `design/mview-reading/02-serif.html` — the chosen Markdown reading artboard (S15, L65); it overrides Workbench for the Markdown view (`.md`).

Where the two differ, `src/web/styles.css` wins (it is newer and implements S8's manual theme; the artboard only follows `prefers-color-scheme`).

## Theme model

Source: `src/web/styles.css`, `src/web/lib/theme.ts`.

- Light tokens on `:root`; dark tokens on `:root[data-theme="dark"]` and on `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`.
- Toolbar theme control: `System` / `Light` / `Dark`. System removes `data-theme`; Light/Dark set it. Not persisted.
- `color-scheme: light dark` on `:root`.

## Colors

| Token | Light | Dark | Usage | Source |
| --- | --- | --- | --- | --- |
| `--bg` | `#f6f7f9` | `#0f1216` | Page background, search field and value boxes | `src/web/styles.css` |
| `--surface` | `#ffffff` | `#161a1f` | Toolbar, sidebar, inspector, tables, buttons | `src/web/styles.css` |
| `--surface-2` | `#eef0f3` | `#1d2228` | Hover, table header, status bar, chips, inline code | `src/web/styles.css` |
| `--surface-3` | `#e3e7eb` | `#262c33` | Pressed segment (`.seg [aria-pressed=true]`) | `src/web/styles.css` |
| `--text` | `#1b1f24` | `#e6e9ed` | Body text | `src/web/styles.css` |
| `--muted` | `#57606a` | `#9ba5af` | Labels, metadata, table header text, line numbers | `src/web/styles.css` |
| `--border` | `#d5dae0` | `#2c333b` | Every 1px divider and control border | `src/web/styles.css` |
| `--line` | `#8c959f` | `#6b7580` | Diagram strokes, idle status dot, dashed placeholder | `src/web/styles.css` |
| `--accent` | `#0b5fcc` | `#6ea8ff` | Primary button, links, current-item bar, Manual tag | `src/web/styles.css` |
| `--accent-ink` | `#ffffff` | `#0b1220` | Text on `--accent` | `src/web/styles.css` |
| `--accent-soft` | `#e2ecfb` | `#1a2a44` | Selected outline item / selected tree row background | `src/web/styles.css` |
| `--ok` | `#1a7f37` | `#4ac26b` | Live status dot | `src/web/styles.css` |
| `--warn` | `#9a6700` | `#d4a72c` | Disconnected status dot ring | `src/web/styles.css` |
| `--danger` | `#b42318` | `#ff8a80` | Error border, error text, bad source line | `src/web/styles.css` |
| `--danger-soft` | `#fdecea` | `#3a1d1c` | Error box and bad line background | `src/web/styles.css` |
| `--focus` | `#0b5fcc` | `#8bb9ff` | Focus outline | `src/web/styles.css` |
| `--key` | `#8250df` | `#d2a8ff` | JSON keys, code keywords | `src/web/styles.css` |
| `--str` | `#116329` | `#7ee2a8` | JSON/code strings | `src/web/styles.css` |
| `--num` | `#a3480b` | `#ffa657` | JSON/code numbers | `src/web/styles.css` |
| `--bool` | `#0b5fcc` | `#79c0ff` | JSON booleans, code titles | `src/web/styles.css` |
| `--hit` | `#ffe58a` | `#6b5a12` | Search highlight (`mark`) | `src/web/styles.css` |
| `--grid` | `#c4cbd3` | `#2a3038` | Mermaid canvas dot grid | `src/web/styles.css` |

Overlay colors used literally: `rgb(0 0 0 / .10)` (floating tool shadow), `rgb(0 0 0 / .25)` (drawer shadow), `rgb(0 0 0 / .35)` (drawer backdrop) — `src/web/styles.css`.

## Typography

Source: `src/web/styles.css`.

- `--font`: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- `--mono`: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
- `--serif` (on `.md` only): `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif` — Markdown reading text (S15).
- Body: `14px/1.5 var(--font)` (shell and every view except the Markdown article).

| Role | Size / weight | Example selector |
| --- | --- | --- |
| Section label (uppercase, `letter-spacing: .08em`, muted) | 11px | `.side-head h2`, `.inspector h2` |
| Manual tag (uppercase, `.04em`, 600) | 11px | `.manual-tag` |
| Outline meta (mono, tabular) | 11.5px | `.outline .o-meta` |
| Status bar, chips, labels, CSV table header (600, muted) | 12px | `.status`, `.chip`, `.t th` |
| Notes, q-status, value box (mono) | 12.5px | `.q-status`, `.value-box` |
| Controls, outline items, tree (mono) | 13px | `.btn`, `.outline button`, `.tree` |
| CSV table cells | 13.5px | `.t` |
| File name (600) / paste lead | 15px | `.file-name`, `.paste .lead` |
| Error title | 16px | `.err-box h1` |
| Paste h1 | 24px | `.paste h1` |

Numbers in metadata use `font-variant-numeric: tabular-nums`.

### Markdown reading scale (S15)

Source: `design/mview-reading/02-serif.html` (Values panel), implemented in `src/web/styles.css` `.md`. Body text in `--serif`; headings and tables in `--font`; code in `--mono`. Narrow = the `max-width: 899px` media query.

| Element | Wide | Narrow (≤ 899px) |
| --- | --- | --- |
| Body text (`.md`) | 19px / 32.3px (1.7) | 17px / 28.9px (1.7) |
| Text column (p, lists, blockquote, code block, headings) | max-width 720px (`--col`) | same |
| Article (`.md`) | max-width 800px; padding 32px 40px 80px | padding 20px 16px 56px |
| h1 (700, `-0.02em`) | 36px / 43.2px · 0 above / 24px below | 30px / 36px · 0 / 20px |
| h2 (700, `-0.02em`, 1px `--border` rule 8px below text) | 26px / 32.5px · 56 / 16px | 23px / 28.75px · 44 / 14px |
| h3 (600) | 21px / 27.3px · 40 / 12px | 19px / 24.7px · 32 / 10px |
| h4–h6 (600) | 19px / 25.65px · 32 / 8px | 17px / 22.95px · 28 / 8px |
| After a paragraph / list / table | 22px | 20px |
| Between list items, nested list above | 10px | 8px |
| Inside an item (`li > p`, not last) | 12px | same |
| List indent | 30px | same |
| Inline code (`--surface-2`, 1px `--border`, radius 4, padding 0 4px) | 16px | 14.5px |
| Code block (padding 16px 20px, 26px below) | 15px / 24px | 14px / 22.4px |
| Table (max-width 720px) cells, padding 10px 14px | 15px / 22.5px | 14px / 21px |
| Table header (600, muted, `--surface-2`) | 13px | 12px |
| Blockquote (3px `--line` left, padding 2px 0 2px 20px, `--muted`, italic, 26px below) | inherits body | same |

## Spacing

Source: `src/web/styles.css`. Values in use (px): 1, 2, 4, 5, 6, 8, 10, 12, 14, 16, 20, 22, 24, 26, 28, 30, 32, 40, 44, 48, 56, 64, 80 (22, 26, 30, 44, 56 and 80 come from the Markdown reading scale, S15).

- Toolbar: `min-height: 52px; padding: 6px 12px; gap: 12px`.
- Sidebar: `260px` wide; head `14px 16px 6px`; list `4px 8px 16px`; outline indent `14px` per level.
- JSON tools bar: `padding: 10px 16px; gap: 8px`. Inspector: `340px` wide, `padding: 16px; gap: 14px`.
- CSV table cell: `padding: 7px 12px` (`.t th, .t td`; the pre-S15 Markdown values, kept). Markdown table cell: `padding: 10px 14px` (S15).
- Status bar: `min-height: 30px`; cell `padding: 4px 12px`.
- Tree row: `min-height: 28px`, indent `18px` per depth.
- `--target`: `36px` (44px under `pointer: coarse`) — minimum control size.

## Radius

Source: `src/web/styles.css`. `2px` (mark), `4px` (tag, kbd, inline code, tree row), `6px` (buttons, selects, search, outline items, path/value boxes), `8px` (figures, canvas tools, error box, code blocks), `12px` (chip), `50%` (status dot).

## Shadows

Source: `src/web/styles.css`.

- Floating tools: `0 4px 16px rgb(0 0 0 / .10)` (`.cv-tools`).
- Drawer: `0 0 40px rgb(0 0 0 / .25)` (`.sidebar` on narrow screens).
- Current-item bar (inset): `inset 2px 0 var(--accent)` (`.outline button[aria-current=true]`, `.row.is-selected`).
- Bad line bar: `inset 3px 0 var(--danger)` (`.src li.bad`).

## Layout

Source: `src/web/styles.css`, `design/mview-viewer/02-workbench.html`.

- App grid: toolbar / workspace / status bar (`grid-template-rows: auto minmax(0,1fr) auto`), page does not scroll; views scroll inside `main`.
- Workspace: sidebar `260px` + main. Under `899px` the sidebar becomes a drawer opened by the toolbar `Outline` button; labels of brand, type and theme hide.
- JSON: tree + `340px` inspector; under `1100px` the inspector stacks below (max `42vh`).

## Components

Source: `src/web/styles.css` unless noted.

- **Button** `.btn`: min `var(--target)`, `0 12px`, 1px `--border`, `--surface`, radius 6, 13px; hover `--surface-2`. Variants `.primary` (accent fill, 600), `.ghost` (transparent). Disabled opacity `.55`.
- **Toolbar**: brand (logo + "mview", right divider), file name + source chip, spacer, `Render as` type select, `Theme` select. Selects: custom chevron, min `var(--target)`, 13px. `Manual` tag beside the type select when overridden.
- **Chip** `.chip`: 24px tall, radius 12, `--surface-2`, 12px muted.
- **Sidebar Outline**: uppercase 11px `Outline` heading, `.side-sub` count line, item buttons (icon `.o-ico`, label `.o-label`/`.o-mono`, meta `.o-meta`), current item `aria-current="true"` → `--accent-soft` + inset accent bar + 600; `.side-foot` hint at the bottom.
- **Search** `.search` in a `.json-tools` bar: magnifier icon, `--bg` field, focus ring on `:focus-within`, max 420px; `.q-status` beside it holds the count and a `Clear search` button (28px tall, 12px). Escape clears.
- **Segmented control** `.seg`: pressed segment `--surface-3`, 600.
- **Search highlight**: `mark` with `--hit`, radius 2.
- **Markdown table** `.md table/th/td` (S15): `--font` 15px/22.5px, max-width 720px, `--surface`, 1px `--border`; cells `10px 14px`, left- and top-aligned, bottom border; header `--surface-2`, 600, 13px, muted (narrow: 14px/21px, header 12px).
- **CSV table** `.t th/td`: 13.5px, cells `7px 12px`, header `--surface-2`, 600, 12px, muted — a copy of the pre-S15 Markdown table values, kept when the Markdown table changed; plus the sticky header and the 320px cell cap.
- **Tree row** `.row`: 28px; hover `--surface-2`; selected `.is-selected` → `--accent-soft` + inset accent bar.
- **Inspector** `.inspector`: uppercase heading, `.field-label` 12px muted, `.path-box` / `.value-box` (mono on `--bg`, radius 6), `.kv` definition grid, `.ins-actions`, `.ins-note`.
- **Status bar** `.status`: `--surface-2`, 12px muted, cells divided by 1px `--border`, `.grow` live message on the right; `strong`/`code` in `--text`. Status dot: `.dot` (live, `--ok`), `.dot.off` (warn ring), `.dot.idle` (line ring). The type cell can be replaced by a view's status text (status override, e.g. `JSON · invalid`).
- **Error box** `.err-box`: `--danger` border on `--danger-soft`, icon column, title 16px, actions row.
- **Source listing** `.src`: mono 13px/1.7, CSS counter line numbers (48px gutter, muted, right-aligned).
- **Focus**: `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }`.
- **Motion**: drawer slides `.18s`; everything off under `prefers-reduced-motion: reduce`.
- **Artboard-only state switcher** `.artboard-ctl` (dashed box, bottom right) — `design/mview-viewer/02-workbench.html`; not product UI.
