// ============================================================================
// OWNER  : Gauransh
// MODULE : CSV parsing (W1.6 — PRD §54 "CSV files")
// LAYER  : Utils — Unit Tests
// PURPOSE: Prove the parser handles what real exports actually contain, and —
//          more importantly — that it REFUSES the shapes that would silently
//          corrupt an import rather than repairing them.
//
//          The dangerous case is a ragged row. Padding or truncating it would
//          write the wrong value into the wrong column with no error anywhere,
//          which is the worst outcome an importer can produce.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseCsv, toCsv, toRecord } from "@/lib/utils/csv";

/** Narrow a result to its success branch, failing the test if it is an error. */
function expectOk(result: ReturnType<typeof parseCsv>) {
  assert.equal(result.ok, true, result.ok ? "" : `unexpected error: ${result.error}`);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

describe("parseCsv", () => {
  it("parses a plain file", () => {
    const { headers, rows } = expectOk(parseCsv("code,name\nCS101,Intro\nCS102,Data"));
    assert.deepEqual(headers, ["code", "name"]);
    assert.deepEqual(rows, [
      ["CS101", "Intro"],
      ["CS102", "Data"],
    ]);
  });

  it("handles CRLF, which is what Windows and Excel write", () => {
    const { rows } = expectOk(parseCsv("code,name\r\nCS101,Intro\r\n"));
    assert.deepEqual(rows, [["CS101", "Intro"]]);
  });

  it("strips a UTF-8 BOM", () => {
    // Excel writes this by default. Left in place it corrupts the FIRST header
    // name, so every column check fails for a reason nobody can see on screen.
    const { headers } = expectOk(parseCsv("﻿code,name\nCS101,Intro"));
    assert.deepEqual(headers, ["code", "name"]);
  });

  it("handles quoted fields containing commas, quotes and newlines", () => {
    const { rows } = expectOk(
      parseCsv('code,name\nCS101,"Data, Structures"\nCS102,"He said ""hi"""\nCS103,"Line1\nLine2"')
    );
    assert.deepEqual(rows, [
      ["CS101", "Data, Structures"],
      ["CS102", 'He said "hi"'],
      ["CS103", "Line1\nLine2"],
    ]);
  });

  it("trims header whitespace but NOT values", () => {
    // A trailing space in a header is invisible and would fail every column
    // check. A value's spacing is the row schema's decision, per field.
    const { headers, rows } = expectOk(parseCsv(" code , name \nCS101, Intro "));
    assert.deepEqual(headers, ["code", "name"]);
    assert.deepEqual(rows, [["CS101", " Intro "]]);
  });

  it("ignores blank lines, including a trailing newline", () => {
    const { rows } = expectOk(parseCsv("code,name\nCS101,Intro\n\n"));
    assert.equal(rows.length, 1);
  });

  it("REJECTS a ragged row rather than padding it", () => {
    // The whole point. Padding writes the wrong value into the wrong column.
    const result = parseCsv("code,name\nCS101");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Row 2 has 1 values but there are 2 columns/);
  });

  it("REJECTS duplicate headers", () => {
    const result = parseCsv("code,code\nA,B");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Duplicate column headers: code/);
  });

  it("REJECTS a blank header", () => {
    const result = parseCsv("code,,name\nA,B,C");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /blank/);
  });

  it("REJECTS an empty file", () => {
    assert.equal(parseCsv("").ok, false);
    assert.equal(parseCsv("   \n  ").ok, false);
  });

  it("reports the line number a spreadsheet would show", () => {
    // +2: one for the header row, one because humans count from 1. Getting this
    // wrong sends the operator to the wrong line of their file.
    const result = parseCsv("code,name\nA,B\nC,D\nE");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Row 4/);
  });
});

describe("toRecord", () => {
  it("keys a row by its headers", () => {
    assert.deepEqual(toRecord(["code", "name"], ["CS101", "Intro"]), {
      code: "CS101",
      name: "Intro",
    });
  });

  it("fills a missing trailing cell with an empty string", () => {
    assert.deepEqual(toRecord(["a", "b"], ["x"]), { a: "x", b: "" });
  });
});

describe("toCsv", () => {
  it("quotes only what needs quoting", () => {
    const out = toCsv(["a", "b"], [["plain", "has,comma"]]);
    assert.equal(out, 'a,b\r\nplain,"has,comma"');
  });

  it("escapes embedded quotes and round-trips", () => {
    const original = [['say "hi"', "line\nbreak"]];
    const { rows } = expectOk(parseCsv(toCsv(["a", "b"], original)));
    assert.deepEqual(rows, original);
  });
});
