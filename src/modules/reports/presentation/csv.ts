/**
 * Minimal, dependency-free CSV serialiser for the Reports module export
 * (task 25.3).
 *
 * Reports are exported either as their full structured JSON payload or as a
 * flat CSV of the report's row-level tabular section. Rather than pull in a CSV
 * library, this module implements RFC 4180 serialisation directly — the surface
 * is tiny (escape a field, join a grid) and keeping it in-house avoids a new
 * runtime dependency for a handful of read-only endpoints.
 *
 * ## RFC 4180 rules applied
 * - Fields are separated by commas; records by CRLF (`\r\n`).
 * - A field is quoted (wrapped in double quotes) **iff** it contains a comma,
 *   a double quote, a CR or an LF. Plain values are emitted verbatim.
 * - An embedded double quote is escaped by doubling it (`"` → `""`).
 *
 * The serialiser is value-oriented (accepts `string | number`) and performs no
 * report-specific shaping; callers pass a header row followed by data rows. See
 * {@link ./report-csv.ts} for the per-report row builders.
 */

/** A single CSV cell value before escaping. */
export type CsvValue = string | number;

/** One CSV record (row) as an ordered list of cell values. */
export type CsvRow = readonly CsvValue[];

/** The CSV record terminator mandated by RFC 4180. */
const RECORD_SEPARATOR = '\r\n';

/** Matches any character that forces a field to be quoted per RFC 4180. */
const MUST_QUOTE = /[",\r\n]/;

/**
 * Escapes a single CSV field per RFC 4180.
 *
 * The value is stringified, then wrapped in double quotes only when it contains
 * a delimiter (`,`), a quote (`"`), or a line break (CR/LF); embedded quotes are
 * doubled. A value with none of those characters is returned unchanged so the
 * common case stays quote-free.
 */
export function escapeCsvField(value: CsvValue): string {
  const str = String(value);
  if (MUST_QUOTE.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialises a grid of rows (header first, by convention) into an RFC 4180 CSV
 * document. Each cell is escaped via {@link escapeCsvField}; cells are joined
 * with commas and records with CRLF. An empty grid yields the empty string.
 */
export function toCsv(rows: readonly CsvRow[]): string {
  return rows.map((row) => row.map(escapeCsvField).join(',')).join(RECORD_SEPARATOR);
}
