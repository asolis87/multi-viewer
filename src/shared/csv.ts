/**
 * CSV/TSV parsing and delimiter detection (S13). Own code, no dependency; shared by
 * `detectType` (CLI and browser) and the CSV view. Nothing else splits CSV.
 */

export type CsvDelimiter = "," | ";" | "\t";

/** Detection reads at most this many (non-blank) records. */
export const DETECTION_WINDOW = 20;

/** Order used for content without a known extension. */
const SNIFF_ORDER: readonly CsvDelimiter[] = ["\t", ";", ","];

export interface CsvRecord {
  fields: string[];
  /** Offset of the record's first character in the BOM-less text. */
  start: number;
}

export interface CsvScan {
  /** BOM-less text the offsets refer to. */
  text: string;
  /** Non-blank records, in order. */
  records: CsvRecord[];
  /** True when the scan stopped at the end of the text inside an open quote. */
  openQuote: boolean;
}

/**
 * RFC 4180 record scanner. Quotes open only at the start of a field; inside them the
 * delimiter and line breaks are literal and `""` is one `"`. An unclosed quote runs to the
 * end. `\r\n` and `\n` end records. Blank records (one unquoted, whitespace-only field) are
 * skipped. Stops after `limit` non-blank records.
 */
export function scanRecords(input: string, delimiter: string, limit = Infinity): CsvScan {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: CsvRecord[] = [];
  const n = text.length;
  let i = 0;
  let openQuote = false;

  while (i < n && records.length < limit) {
    const start = i;
    const fields: string[] = [];
    let field = "";
    let fieldStart = true;
    let quoted = false;
    let inQuotes = false;
    let ended = false;

    while (i < n) {
      const c = text[i]!;
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            inQuotes = false;
            i++;
          }
        } else {
          field += c;
          i++;
        }
        continue;
      }
      if (c === "\n" || (c === "\r" && text[i + 1] === "\n")) {
        i += c === "\r" ? 2 : 1;
        ended = true;
        break;
      }
      if (c === delimiter) {
        fields.push(field);
        field = "";
        fieldStart = true;
        i++;
        continue;
      }
      if (c === '"' && fieldStart) {
        inQuotes = true;
        quoted = true;
      } else {
        field += c;
      }
      fieldStart = false;
      i++;
    }
    if (!ended && inQuotes) openQuote = true;
    fields.push(field);

    const blank = fields.length === 1 && !quoted && field.trim() === "";
    if (!blank) records.push({ fields, start });
  }

  return { text, records, openQuote };
}

/** Parse the whole text into records of fields (blank records skipped). */
export function parseCsv(text: string, delimiter: string): string[][] {
  return scanRecords(text, delimiter).records.map((r) => r.fields);
}

/** Records of the detection window when `delimiter` qualifies, otherwise null. */
export function qualifyingRecords(text: string, delimiter: CsvDelimiter): CsvScan | null {
  const scan = scanRecords(text, delimiter, DETECTION_WINDOW);
  if (scan.openQuote) return null;
  const first = scan.records[0];
  if (!first || first.fields.length < 2) return null;
  const width = first.fields.length;
  return scan.records.every((r) => r.fields.length === width) ? scan : null;
}

/**
 * A delimiter qualifies when the first 20 non-blank records all have the same number of
 * fields, at least 2, and the window does not end inside an open quote.
 */
export function delimiterQualifies(text: string, delimiter: CsvDelimiter): boolean {
  return qualifyingRecords(text, delimiter) !== null;
}

/** `.csv` files and a manual csv choice: `;` if it qualifies, else `,`. */
export function csvDelimiter(text: string): CsvDelimiter {
  return delimiterQualifies(text, ";") ? ";" : ",";
}

/** First delimiter that qualifies in the order tab, `;`, `,`, with its window records. */
export function sniffDelimiter(text: string): { delimiter: CsvDelimiter; scan: CsvScan } | null {
  for (const delimiter of SNIFF_ORDER) {
    const scan = qualifyingRecords(text, delimiter);
    if (scan) return { delimiter, scan };
  }
  return null;
}

/**
 * `.tsv` → tab; `.csv` → `;` if it qualifies, else `,`; any other name or none → the
 * first delimiter that qualifies in the order tab, `;`, `,`, or null.
 */
export function detectDelimiter(text: string, filename?: string | null): CsvDelimiter | null {
  const ext = filename ? extensionOf(filename) : "";
  if (ext === "tsv") return "\t";
  if (ext === "csv") return csvDelimiter(text);
  return sniffDelimiter(text)?.delimiter ?? null;
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot + 1).toLowerCase();
}
