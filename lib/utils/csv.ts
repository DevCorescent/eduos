// ============================================================================
// MODULE : Utils — CSV parsing (W1.6, PRD §54 "CSV files", §55 Stage 3)
// PURPOSE: Turn uploaded CSV text into rows, strictly enough that a malformed
//          file is a clear error rather than a silently mangled import.
//
// WHY A PARSER HERE AND NOT A DEPENDENCY
//   The project has no CSV library. `exceljs` is present but is a spreadsheet
//   library — using it to read CSV would pull a large XLSX engine into a text
//   parse. RFC 4180 is small and fully specified, so it is implemented here
//   rather than adding a dependency for ~80 lines.
//
// WHAT IT HANDLES, BECAUSE REAL EXPORTS CONTAIN ALL OF IT
//   Quoted fields, embedded commas, embedded newlines inside quotes, escaped
//   quotes (""), CRLF and LF line endings, and a UTF-8 BOM — which Excel writes
//   by default and which otherwise corrupts the FIRST header name, so every
//   header check would fail for a reason nobody could see.
//
// WHAT IT DELIBERATELY DOES NOT DO
//   No type coercion, no trimming of values beyond the header row, no guessing
//   at delimiters. Everything comes back as a string and Zod decides what it
//   means. A parser that silently coerced "0123" to 123 would corrupt
//   enrolment numbers.
// ============================================================================

/** A parsed file: the header row, and the data rows beneath it. */
export interface ParsedCsv {
  headers: string[];
  /** One entry per data row, already aligned to `headers` by index. */
  rows: string[][];
}

export type CsvParseResult =
  | { ok: true; value: ParsedCsv }
  | { ok: false; error: string };

/** Excel writes this at the start of a UTF-8 file. */
const BOM = "﻿";

/**
 * Split CSV text into a matrix of raw cell values.
 *
 * A single pass over the characters, because the quoting rules make line
 * splitting impossible to do correctly beforehand: a quoted field may contain
 * the newline that would otherwise end the record.
 */
function splitRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }

    if (char === "\r" || char === "\n") {
      // Consume CRLF as one terminator, not two.
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      records.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  // The final record, when the file does not end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  return records;
}

/**
 * Parse CSV text into headers and rows.
 *
 * Blank lines are dropped rather than treated as rows: a trailing newline is
 * normal in every export, and reporting "row 51 is empty" for it would make a
 * clean file look invalid.
 *
 * A row whose cell count differs from the header count is an ERROR rather than
 * being padded or truncated. Padding hides a shifted column, which silently
 * writes the wrong value into the wrong field — the worst outcome an importer
 * can produce.
 */
export function parseCsv(text: string): CsvParseResult {
  const withoutBom = text.startsWith(BOM) ? text.slice(BOM.length) : text;

  if (withoutBom.trim() === "") {
    return { ok: false, error: "The file is empty." };
  }

  const records = splitRecords(withoutBom).filter(
    (record) => !(record.length === 1 && record[0].trim() === "")
  );

  if (records.length === 0) {
    return { ok: false, error: "The file is empty." };
  }

  // Headers are trimmed because a trailing space in a header is invisible and
  // would fail every column check with no explanation. Values are NOT trimmed
  // here — that is the entity schema's decision, per field.
  const headers = records[0].map((header) => header.trim());

  if (headers.some((header) => header === "")) {
    return { ok: false, error: "One or more column headers are blank." };
  }

  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicates.length > 0) {
    return {
      ok: false,
      error: `Duplicate column headers: ${[...new Set(duplicates)].join(", ")}.`,
    };
  }

  const rows = records.slice(1);

  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].length !== headers.length) {
      // +2: one for the header row, one because humans count from 1.
      return {
        ok: false,
        error: `Row ${index + 2} has ${rows[index].length} values but there are ${headers.length} columns.`,
      };
    }
  }

  return { ok: true, value: { headers, rows } };
}

/** Turn an aligned row into a keyed record, for schema validation. */
export function toRecord(headers: string[], row: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    record[header] = row[index] ?? "";
  });
  return record;
}

/**
 * Render a CSV file from a header list and rows.
 *
 * Used for the downloadable template and the error report. Quotes a value only
 * when it needs it, so a simple file stays readable when opened in a text
 * editor rather than being uniformly wrapped in quotes.
 */
export function toCsv(headers: string[], rows: string[][]): string {
  const escape = (value: string): string =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  return [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
}
