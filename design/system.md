# mview design system

Derived from the project's design source. Read-only sync: every value below is copied from `src/web/styles.css`; nothing is invented.

Source:

- `src/web/styles.css` — the implemented Workbench stylesheet: tokens, the manual theme (`data-theme`), the Markdown reading direction "Serif" (S15), the CSV table, pager and inspector (S13), and the search match counter, previous/next buttons and current-match mark (S16).

Last synced after S16 (T41/T42). Previous syncs also read the chosen artboards; this one reads only the stylesheet, which implements them.

## Theme model

Source: `src/web/styles.css`.

- Light tokens on `:root`; dark tokens on `:root[data-theme="dark"]` and on `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`.
- `color-scheme: light dark` on `:root`.
- No `data-theme` = follow the system; `data-theme="light"` / `"dark"` force a theme (the toolbar `Theme` select: System / Light / Dark).

## Colors

| Token | Light | Dark | Usage | Source |
| --- | --- | --- | --- | --- |
| `--bg` | `#f6f7f9` | `#0f1216` | Page background, search field, path/value boxes | `src/web/styles.css` |
| `--surface` | `#ffffff` | `#161a1f` | Toolbar, sidebar, inspector, tables, buttons, code blocks | `src/web/styles.css` |
| `--surface-2` | `#eef0f3` | `#1d2228` | Hover, table header, status bar, chips, inline code, pager and figure bars | `src/web/styles.css` |
| `--surface-3` | `#e3e7eb` | `#262c33` | Pressed segment (`.seg [aria-pressed=true]`), CSV header hover | `src/web/styles.css` |
| `--text` | `#1b1f24` | `#e6e9ed` | Body text | `src/web/styles.css` |
| `--muted` | `#57606a` | `#9ba5af` | Labels, metadata, table header text, line numbers, blockquote | `src/web/styles.css` |
| `--border` | `#d5dae0` | `#2c333b` | Every 1px divider and control border, h2 rule | `src/web/styles.css` |
| `--line` | `#8c959f` | `#6b7580` | Blockquote bar, idle status dot, dashed remote-image box | `src/web/styles.css` |
| `--accent` | `#0b5fcc` | `#6ea8ff` | Primary button, links, current-item bar, sort icon, current search match | `src/web/styles.css` |
| `--accent-ink` | `#ffffff` | `#0b1220` | Text on `--accent` (primary button, current match) | `src/web/styles.css` |
| `--accent-soft` | `#e2ecfb` | `#1a2a44` | Selected outline item, tree row, CSV row, targeted column header | `src/web/styles.css` |
| `--ok` | `#1a7f37` | `#4ac26b` | Live status dot | `src/web/styles.css` |
| `--warn` | `#9a6700` | `#d4a72c` | Disconnected status dot ring | `src/web/styles.css` |
| `--danger` | `#b42318` | `#ff8a80` | Error border, error text, bad source line, code deletions | `src/web/styles.css` |
| `--danger-soft` | `#fdecea` | `#3a1d1c` | Error box and bad line background | `src/web/styles.css` |
| `--focus` | `#0b5fcc` | `#8bb9ff` | Focus outline | `src/web/styles.css` |
| `--key` | `#8250df` | `#d2a8ff` | JSON keys, code keywords | `src/web/styles.css` |
| `--str` | `#116329` | `#7ee2a8` | JSON/code strings | `src/web/styles.css` |
| `--num` | `#a3480b` | `#ffa657` | JSON/code numbers | `src/web/styles.css` |
| `--bool` | `#0b5fcc` | `#79c0ff` | JSON booleans, code titles and sections | `src/web/styles.css` |
| `--hit` | `#ffe58a` | `#6b5a12` | Search match (`mark`) | `src/web/styles.css` |
| `--grid` | `#c4cbd3` | `#2a3038` | Mermaid canvas dot grid | `src/web/styles.css` |

Overlay colors used literally: `rgb(0 0 0 / .10)` (floating tool shadow), `rgb(0 0 0 / .25)` (drawer shadow), `rgb(0 0 0 / .35)` (drawer backdrop) — `src/web/styles.css`.

## Typography

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--font` | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | Shell, every view, Markdown headings and tables | `src/web/styles.css` |
| `--mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | `code`, `kbd`, `pre`, JSON tree, metadata numbers | `src/web/styles.css` |
| `--serif` | `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif` | Markdown reading text; declared on `.md` only (S15) | `src/web/styles.css` |

- Body: `14px/1.5 var(--font)` (shell and every view except the Markdown article).
- Numbers in metadata, counters and pagers use `font-variant-numeric: tabular-nums`.

| Role | Size / weight | Example selector |
| --- | --- | --- |
| Section label (uppercase, `letter-spacing: .08em`, muted) | 11px | `.side-head h2`, `.inspector h2` |
| Manual tag (uppercase, `.04em`, 600) | 11px | `.manual-tag` |
| Outline meta (mono, tabular) | 11.5px | `.outline .o-meta` |
| Status bar, chips, labels, kbd, CSV table header (600, muted), pager and figure labels (mono) | 12px | `.status`, `.chip`, `.t th`, `.pg-label` |
| Notes, q-status, value box (mono), outline mono item | 12.5px | `.q-status`, `.value-box`, `.o-mono` |
| Controls, outline items, tree (mono), field text | 13px | `.btn`, `.outline button`, `.tree`, `.search input` |
| CSV table cells | 13.5px | `.t` |
| File name (600) / paste lead | 15px | `.file-name`, `.paste .lead` |
| Error title | 16px | `.err-box h1` |
| Paste h1 | 24px | `.paste h1` |

### Markdown reading scale (S15, "Serif")

Source: `src/web/styles.css` `.md`. Body text in `--serif`; headings, tables and in-article UI (diagram figures, remote image placeholders) in `--font`; code in `--mono`. Narrow = the `max-width: 899px` media query.

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--col` | `720px` | Text column max-width (p, lists, blockquote, code block, headings); declared on `.md` | `src/web/styles.css` |

| Element | Wide | Narrow (≤ 899px) |
| --- | --- | --- |
| Body text (`.md`) | 19px / 32.3px | 17px / 28.9px |
| Article (`.md`) | max-width 800px; padding 32px 40px 80px | padding 20px 16px 56px |
| h1 (700, `-0.02em`) | 36px / 43.2px · margin 0 0 24px | 30px / 36px · 0 0 20px |
| h2 (700, `-0.02em`, 1px `--border` bottom rule, padding-bottom 8px) | 26px / 32.5px · 56px 0 16px | 23px / 28.75px · 44px 0 14px |
| h3 (600) | 21px / 27.3px · 40px 0 12px | 19px / 24.7px · 32px 0 10px |
| h4–h6 (600) | 19px / 25.65px · 32px 0 8px | 17px / 22.95px · 28px 0 8px |
| After a paragraph / list / table | 22px | 20px |
| Between list items, nested list above | 10px | 8px |
| Inside an item (`li > p`, not last) | 12px | same |
| List indent | 30px | same |
| Inline code (`--surface-2`, 1px `--border`, radius 4px, padding 0 4px) | 16px | 14.5px |
| Code block (`--surface`, 1px `--border`, radius 8px, padding 16px 20px, 26px below) | 15px / 24px | 14px / 22.4px |
| Table (`--font`, max-width 720px, `--surface`, 1px `--border`), cells padding 10px 14px | 15px / 22.5px | 14px / 21px |
| Table header (600, `--muted`, `--surface-2`) | 13px | 12px |
| Blockquote (3px `--line` left, padding 2px 0 2px 20px, `--muted`, italic, 26px below) | inherits body | same |
| Heading focus | `outline: 2px solid var(--focus); outline-offset: 4px` | same |
| Diagram figure inside `.md` | 14px / 1.5 `--font` | same |

## Sizing

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--target` | `36px` (`44px` under `@media (pointer: coarse)`) | Minimum control size (buttons, selects, search, outline items, sticky CSV header) | `src/web/styles.css` |

Per-element custom properties set inline by the views: `--lv` (outline indent level × 14px) and `--d` (tree depth × 18px) — `src/web/styles.css`.

## Spacing

Source: `src/web/styles.css`. Values in use (px): 1, 2, 4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 40, 44, 48, 56, 64, 80.

- Toolbar: `min-height: 52px; padding: 6px 12px; gap: 12px`.
- Sidebar: `260px` wide; head `14px 16px 6px`; list `4px 8px 16px`; outline indent `14px` per level; foot `12px 16px`.
- JSON tools bar: `padding: 10px 16px; gap: 8px`. Inspector: `340px` wide, `padding: 16px; gap: 14px`.
- Search: `height: var(--target); padding: 0 10px; gap: 6px`; min-width 200px, max-width 420px. `.q-status` gap 8px; `.q-nav` gap 4px.
- CSV table cell: `padding: 7px 12px`; header button `0 12px`, `min-height: var(--target)`; cell cap `max-width: 320px`. Markdown table cell: `padding: 10px 14px`.
- Pager / figure bar: `padding: 4px 6px` (figure bar `4px 6px 4px 12px`), `gap: 4px`; buttons 30px.
- Status bar: `min-height: 30px`; cell `padding: 4px 12px`.
- Tree row: `min-height: 28px`, indent `18px` per depth.
- Error / paste pages: `28px 40px 64px` / `40px 40px 64px` (narrow `20px 16px 48px`).

## Radius

Source: `src/web/styles.css`. `2px` (mark), `4px` (manual tag, kbd, inline code, tree row, `.sel`, twisty), `6px` (buttons, selects, search, segments, outline items, path/value boxes, remote image box, cv-hint), `8px` (figures, canvas tools, error box, code blocks, source listing, paste textarea; figure bar `8px 8px 0 0`), `12px` (chip), `50%` (status dot).

## Shadows

Source: `src/web/styles.css`.

- Floating tools: `0 4px 16px rgb(0 0 0 / .10)` (`.cv-tools`).
- Drawer: `0 0 40px rgb(0 0 0 / .25)` (`.sidebar` on narrow screens).
- Current-item bar (inset): `inset 2px 0 var(--accent)` (`.outline button[aria-current=true]`, `.row.is-selected`, selected CSV row first cell).
- Bottom accent bar (inset): `inset 0 -2px var(--accent)` (`.t th.is-target`, `.has-hidden-current`).
- Current search match ring: `0 0 0 1px var(--surface), 0 0 0 3px var(--accent)` (`mark.is-current`).
- Bad line bar: `inset 3px 0 var(--danger)` (`.src li.bad`).

## Motion

Source: `src/web/styles.css`.

- Panels (CSV inspector, collapsible CSV outline): `grid-template-columns`/`grid-template-rows` and `transform` `240ms cubic-bezier(.2, .8, .2, 1)`, `opacity 160ms ease`, slide distance `24px`.
- Narrow sidebar drawer: `transform .18s ease`.
- Tree twisty: `transform .12s`.
- `@media (prefers-reduced-motion: reduce)`: every transition and animation off, `scroll-behavior: auto`.

## Layout

Source: `src/web/styles.css`.

- App grid: toolbar / workspace / status bar (`grid-template-rows: auto minmax(0, 1fr) auto`); the page does not scroll, views scroll inside `main`.
- Workspace: sidebar `260px` + main. Under `899px` the sidebar becomes a drawer (`width: min(300px, 86vw)`, backdrop) opened by the toolbar `Outline` button; labels of brand, type and theme hide; `.status .opt` cells hide.
- CSV on wide screens (`min-width: 900px`): the sidebar is a collapsible column (`0px` ↔ `260px`); the always-visible `Outline` button shows `aria-expanded="true"` as `--accent-soft` + `--accent` border.
- JSON: tree + `340px` inspector; CSV: table + `340px` inspector (`0px` when closed). Under `1100px` both inspectors stack below (JSON max `42vh`, CSV `42vh`).
- Under `560px`: chip text and the canvas hint hide.

## Components

Source: `src/web/styles.css`.

- **Button** `.btn`: min `var(--target)`, `0 12px`, gap 6px, 1px `--border`, `--surface`, radius 6px, 13px, icons 16px; hover `--surface-2`. Variants `.primary` (accent fill, `--accent-ink`, 600, hover `brightness(1.08)`), `.ghost` (transparent, hover `--surface-2`). Disabled: `cursor: not-allowed; opacity: .55`.
- **Toolbar**: brand (logo 20px + "mview", right divider), file name (15px, 600) + source chip, spacer, `Render as` type select, `Theme` select (labels 12px muted). Selects: custom chevron, min `var(--target)`, 13px; disabled opacity `.6`. `Manual` tag beside the type select when overridden.
- **Chip** `.chip`: 24px tall, radius 12px, `--surface-2`, 1px `--border`, 12px muted, icon 13px.
- **kbd**: 12px, 1px `--border` (2px bottom), radius 4px, padding 1px 6px, `--surface`.
- **Sidebar Outline**: uppercase 11px `Outline` heading, `.side-sub` 12px muted, item buttons (`.o-ico`, `.o-label`/`.o-mono`, `.o-meta`), current item `aria-current="true"` → `--accent-soft` + inset accent bar + 600; `.side-foot` hint (12px muted, top border); `.side-empty`.
- **Search** `.search`: magnifier icon 14px, `--bg` field, `:focus-within` ring (2px `--focus`, offset 1px), max 420px.
- **Search status** `.q-status` (12.5px muted, gap 8px): `.q-count` counter `<current> of <total>` (tabular, no wrap); `.q-nav` previous/next buttons (28px tall, min-width 28px, padding 0 6px, icons 14px; `--target` under `pointer: coarse`); `Clear search` button (28px tall, 12px).
- **Search match**: `mark` with `--hit`, radius 2px, padding 0 1px. **Current match** `mark.is-current`: `--accent` fill, `--accent-ink` text, ring `0 0 0 1px var(--surface), 0 0 0 3px var(--accent)`. A current match cut by an ellipsis: `.has-hidden-current` → `inset 0 -2px var(--accent)` on the label or cell.
- **Segmented control** `.seg`: 1px `--border`, radius 6px; segments `0 12px`, `calc(var(--target) - 2px)` tall, 13px muted; pressed `--surface-3`, `--text`, 600.
- **Markdown table** `.md table/th/td` (S15): see the reading scale.
- **CSV table** `.t`: 13.5px, cells `7px 12px`, no wrap, cell cap 320px with ellipsis; sticky header (`--surface-2`, 600, 12px muted) with full-cell `.th-btn` (hover `--surface-3`), sort icon 12px (opacity .5; sorted `aria-sort` → `--accent`, opacity 1, header text `--text`); targeted column `.is-target` → `--accent-soft` + bottom accent bar; numbers right-aligned, tabular; row hover `--surface-2`; selected row `--accent-soft` + left accent bar; `td.none` empty message 28px 16px.
- **Pager** `.pager`: centered, `--surface-2`, top border, 30px buttons (`«` `‹` `›` `»`), `.pg-label` 12px mono muted tabular.
- **Tree row** `.row`: 28px; hover `--surface-2`; selected `.is-selected` → `--accent-soft` + inset accent bar; twisty 24px with 12px chevron.
- **Inspector** `.inspector`: `--surface`, uppercase 11px heading, `.field-label` 12px muted, `.path-box` / `.value-box` (mono on `--bg`, 1px `--border`, radius 6px), `.kv` definition grid (13px, dt muted, dd mono), `.ins-actions`, `.ins-note` (12px muted). CSV variant: `.ins-head` with `.ins-close` × (min `var(--target)`, 16px, muted, hover `--surface-2`); slides/fades in (Motion).
- **Diagram figure** `.fig`: 1px `--border`, radius 8px, `--surface`; `.fig-bar` (`--surface-2`, 12px mono title, 30px buttons, mono `output`); `.fig-scroll` padding 16px.
- **Mermaid canvas** `.canvas`: `--bg` with a 16px `--grid` dot pattern; `.cv-tools` floating bar (`--surface`, radius 8px, floating shadow); `.cv-hint` 12px muted chip.
- **Remote image placeholder** `.remote-image`: 1px dashed `--line`, radius 6px, `--surface-2`, 13px muted; title 600 `--text`; URL 12px.
- **Status bar** `.status`: `--surface-2`, top border, 12px muted, cells divided by 1px `--border`, `.grow` message on the right; `strong`/`code` in `--text`. Status dot 8px: `.dot` (`--ok`), `.dot.off` (2px `--warn` ring), `.dot.idle` (2px `--line` ring).
- **Error box** `.err-box`: 1px `--danger` on `--danger-soft`, radius 8px, 20px icon column, title 16px, `.err-meta` 13px muted, actions row.
- **Source listing** `.src`: mono 13px/1.7, CSS counter line numbers (48px gutter, muted, right-aligned); bad line `--danger-soft` + inset 3px `--danger`.
- **Paste page** `.paste`: max-width 760px, h1 24px, lead 15px muted, textarea mono 13px/1.55 on `--surface` (radius 8px, min-height 220px), message 13px `--danger`.
- **Code highlighting** (highlight.js classes): keywords `--key`; strings `--str`; numbers/literals `--num`; titles/names/sections `--bool`; attributes/variables `--text`; comments/quotes/meta `--muted` italic; deletions `--danger`.
- **Focus**: `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }`; inside rows and table cells `outline-offset: -2px`.
- **Screen-reader only** `.sr`.
