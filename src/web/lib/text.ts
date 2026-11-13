/** Text helpers shared by the views (JSON and CSV search highlighting). */

export interface TextPart {
  text: string;
  hit: boolean;
}

/** Split text into parts so every case-insensitive occurrence of the query can be wrapped in <mark>. */
export function highlightParts(text: string, query: string): TextPart[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const parts: TextPart[] = [];
  let from = 0;
  for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + q.length)) {
    if (i > from) parts.push({ text: text.slice(from, i), hit: false });
    parts.push({ text: text.slice(i, i + q.length), hit: true });
    from = i + q.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), hit: false });
  return parts.length ? parts : [{ text, hit: false }];
}

const counts = new Intl.NumberFormat("en-US");

/** Next/previous search match (S16): `delta` steps from `current`, wrapping around; -1 when there are none. */
export function stepMatch(current: number, total: number, delta: number): number {
  if (total <= 0) return -1;
  if (current < 0) return delta < 0 ? total - 1 : 0;
  return (((current + delta) % total) + total) % total;
}

/** The current match after the list changed (live reload, sort): clamped to the new total, -1 at 0. */
export function clampMatch(current: number, total: number): number {
  return total > 0 ? Math.min(Math.max(current, 0), total - 1) : -1;
}

/** Search counter (S16): `<current> of <total>`, or `No matches for “<query>”`. */
export function matchLabel(current: number, total: number, query: string): string {
  if (total <= 0) return `No matches for “${query.trim()}”`;
  return `${counts.format(current + 1)} of ${counts.format(total)}`;
}
