/** RFC 4180 CSV parsing/serialisation (quoted fields, embedded commas/quotes/newlines, CRLF, BOM). */

export class CsvError extends Error {
  constructor(message: string, public readonly line: number) {
    super(`${message} (line ${line})`);
  }
}

export function parseCsv(text: string, opts: { maxRows?: number; maxField?: number } = {}): string[][] {
  const maxRows = opts.maxRows ?? 10_000;
  const maxField = opts.maxField ?? 10_000;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let fieldStartLine = 1;
  let i = 0;
  const endField = () => {
    if (field.length > maxField) throw new CsvError('field too long', fieldStartLine);
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // Skip lines that are completely empty.
    if (!(row.length === 1 && row[0] === '')) {
      rows.push(row);
      if (rows.length > maxRows) throw new CsvError(`more than ${maxRows} rows`, line);
    }
    row = [];
  };
  while (i < s.length) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        const next = s[i];
        if (next !== undefined && next !== ',' && next !== '\n' && next !== '\r') throw new CsvError('unexpected character after closing quote', line);
        continue;
      }
      if (ch === '\n') line++;
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      if (field.trim() !== '') throw new CsvError('quote inside unquoted field', line);
      field = '';
      quoted = true;
      fieldStartLine = line;
      i++;
      continue;
    }
    if (ch === ',') {
      endField();
      fieldStartLine = line;
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      endRow();
      if (ch === '\r' && s[i + 1] === '\n') i++;
      i++;
      line++;
      fieldStartLine = line;
      continue;
    }
    field += ch;
    i++;
  }
  if (quoted) throw new CsvError('unterminated quoted field', fieldStartLine);
  if (field !== '' || row.length) endRow();
  return rows;
}

/** Spreadsheet formula injection guard (=, +, -, @, tab, CR at the start of a cell). */
const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (FORMULA.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replaceAll('"', '""')}"` : s;
}

export const toCsv = (rows: unknown[][]): string => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** Header-keyed records. Headers are normalised to snake_case lowercase. */
export function csvRecords(rows: string[][]): { headers: string[]; records: Record<string, string>[] } {
  const [head, ...body] = rows;
  if (!head) return { headers: [], records: [] };
  const headers = head.map(normHeader);
  const records = body.map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) o[h] = (r[idx] ?? '').trim();
    });
    return o;
  });
  return { headers, records };
}

export const normHeader = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
