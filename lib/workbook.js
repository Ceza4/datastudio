/*
  lib/workbook.js
  --------------------------------------------------------------------------
  A guarded wrapper around XLSX.read.

  WHY THIS EXISTS

  package.json pins `xlsx: ^0.18.5`, and 0.18.5 is the last SheetJS release
  published to public npm — so that range can only ever resolve to 0.18.5, and
  0.18.5 carries CVE-2023-30533: prototype pollution reachable from a crafted
  workbook, during exactly the `XLSX.read` call every import makes. It is fixed
  in 0.19.3, which is installable only from SheetJS's own CDN.

  Moving the dependency to that CDN is the real fix, and it belongs in a change
  that can be installed and tested end to end rather than in an audit sweep —
  it is written up in DEFERRED.md with the exact command. Until then this is
  the guard at the one place attacker-controlled bytes meet the parser.

  HOW THE GUARD WORKS

  Prototype pollution works by getting `__proto__` (or `constructor.prototype`)
  treated as an ordinary key while building an object graph, so a property
  lands on Object.prototype and is then visible on EVERY object in the page.
  That is what makes it dangerous and also what makes it detectable: the
  observable effect is a new own-property on a prototype that had none.

  So: snapshot the own-keys of the three prototypes an attacker would target,
  parse, compare. Anything new is deleted immediately and the import is
  refused. The window during which a polluted property exists is the duration
  of the parse itself, with no user code running in between.

  WHAT THIS DOES NOT DO

  It does not fix the ReDoS (CVE-2024-22363). A malicious workbook can still
  make the parse slow. That is a hang, not a compromise, and the import already
  runs behind a spinner — an acceptable gap to carry to the version bump, and
  named here so it is carried knowingly.
  -------------------------------------------------------------------------- */

import * as XLSX from 'xlsx'

/* The three objects a pollution payload can reach. Checking all three costs
   microseconds and means a payload that targets Array or Function rather than
   Object does not walk straight past the guard. */
const GUARDED = [Object.prototype, Array.prototype, Function.prototype]

function snapshot() {
  return GUARDED.map(p => new Set(Object.getOwnPropertyNames(p)))
}

function diff(before) {
  const added = []
  GUARDED.forEach((proto, i) => {
    for (const k of Object.getOwnPropertyNames(proto)) {
      if (!before[i].has(k)) added.push({ proto, key: k })
    }
  })
  return added
}

/**
 * Parse a workbook from bytes.
 *
 * Same signature as XLSX.read for the options that matter, so the call site
 * reads the same. Throws on pollution rather than returning a partial result:
 * a workbook that tries this is not a workbook anyone wants imported.
 */
export function readWorkbook(data, opts = {}) {
  const before = snapshot()
  let wb
  try {
    wb = XLSX.read(data, { type: 'array', cellDates: true, ...opts })
  } finally {
    /* In `finally`, so a parse that throws PART WAY THROUGH still gets swept.
       A payload that pollutes and then crashes the parser would otherwise
       leave the property behind precisely because the happy path never ran. */
    const added = diff(before)
    if (added.length) {
      for (const { proto, key } of added) {
        try { delete proto[key] } catch { /* frozen prototype: nothing to undo */ }
      }
      const names = added.map(a => a.key).join(', ')
      throw new Error(
        `This file tried to modify the page while being read (${names}), so it was not imported. ` +
        'That is a sign the file is malicious rather than merely damaged.'
      )
    }
  }
  return wb
}

/* DELIMITED TEXT (.csv / .tsv / .txt) DOES NOT GO THROUGH SheetJS's GUESSES.

   Two of them were wrong for anyone whose Excel is set to a European locale,
   which writes `;` between fields and `,` as the decimal mark:

   - The delimiter is picked by counting `,` `;` and tab across the first 1KB
     and taking the most frequent. A file with more decimal commas than
     semicolons is split on the commas — a mangled first column and fragments
     of numbers after it.
   - Values are then type-guessed with a dot-decimal parser that ignores
     commas, so `12,5` became the number 125. Silently, which is worse than
     failing.

   And the bytes were decoded as Latin-1 unless a BOM said otherwise, so
   `Drėgmė` arrived as `DrÄgmÄ`.

   So: decode ourselves (UTF-8, falling back to Windows-1257 — the Baltic code
   page Excel uses when it doesn't write UTF-8), pick the delimiter that gives
   the SAME field count on every line, let SheetJS split with that delimiter
   and no type guessing, and convert numbers here knowing which decimal mark
   the file uses. */

const DELIMS = ['\t', ';', ',', '|']

export function decodeText(bytes) {
  let b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) b = b.subarray(3)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b)
  } catch {
    return new TextDecoder('windows-1257').decode(b)
  }
}

/* Field count of one line, ignoring delimiters inside double quotes. */
function countFields(line, delim) {
  let n = 1, quoted = false
  for (const ch of line) {
    if (ch === '"') quoted = !quoted
    else if (ch === delim && !quoted) n++
  }
  return n
}

export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 50)
  let best = null, bestScore = 0
  for (const d of DELIMS) {
    const counts = lines.map(l => countFields(l, d))
    if (!counts.length || counts[0] < 2) continue
    /* Share of lines matching the header's width. Ties keep the earlier
       entry in DELIMS, which is why `;` is ahead of `,`. */
    const score = counts.filter(c => c === counts[0]).length / counts.length
    if (score > bestScore) { best = d; bestScore = score }
  }
  return best || ','
}

const DOT_NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/
/* Comma decimal, optionally grouped by (non-breaking) spaces: 1 234,56 */
const COMMA_NUMBER = /^[-+]?\d{1,3}(?:[ \u00A0\u202F]\d{3})*(?:,\d+)?$|^[-+]?\d+,\d+$/

function toValue(raw, commaDecimal) {
  if (typeof raw !== 'string') return raw
  const s = raw.trim()
  if (!s) return raw
  /* A leading zero on an integer is an identifier (postcode, account number),
     not a quantity — keep it as text so 007 stays 007. */
  if (/^[-+]?0\d/.test(s) && !/^[-+]?0[.,]/.test(s)) return raw
  if (DOT_NUMBER.test(s)) return Number(s)
  if (commaDecimal && COMMA_NUMBER.test(s)) return Number(s.replace(/[ \u00A0\u202F]/g, '').replace(',', '.'))
  return raw
}

/**
 * Parse CSV/TSV bytes into a workbook, with the delimiter, encoding and
 * decimal mark decided as described above.
 */
export function readDelimitedText(bytes) {
  let text = decodeText(bytes)
  let delim = null
  /* Excel's own hint line: `sep=;` */
  const hint = text.match(/^sep=(.)\r?\n/)
  if (hint) { delim = hint[1]; text = text.slice(hint[0].length) }
  if (!delim) delim = detectDelimiter(text)

  const wb = readWorkbook(text, { type: 'string', FS: delim, raw: true, cellDates: false })
  const commaDecimal = delim !== ','
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    for (const addr of Object.keys(ws)) {
      if (addr[0] === '!') continue
      const cell = ws[addr]
      if (cell.t !== 's') continue
      const v = toValue(cell.v, commaDecimal)
      if (typeof v === 'number') { cell.t = 'n'; cell.v = v; delete cell.w }
    }
  }
  return wb
}

/* WHICH ROW IS THE HEADER.

   Row 1 used to be taken as the header, always. Official forms and most
   hand-made reports open with title lines — "Forma patvirtinta …" in one
   (often merged) cell, an organisation name, a period — and the real column
   names sit several rows down. The sidebar lists one entry per header cell,
   so such a file showed ONE column and every other column was unreachable.

   The header is now the first row, within the first 30, that fills at least
   60% of the widest row there (and at least two cells). Titles fill one cell,
   so they are skipped; the header row is the first wide row, which puts it
   above the data it labels. Width is taken from the widest row in the whole
   sheet, so data cells to the right of the last named header are not lost.

   Merged header cells ("Faktinis" spanning two sub-columns) are spread across
   their span before labels are read, and a column with no label of its own
   borrows the merged group label from the row above. */

const HEADER_SCAN_ROWS = 30

const isFilled = v => v !== '' && v !== null && v !== undefined

export function tableFromSheet(ws, mapRow = r => r) {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 }).map(mapRow)
  const scan = Math.min(aoa.length, HEADER_SCAN_ROWS)
  const filledCount = row => (Array.isArray(row) ? row.filter(isFilled).length : 0)

  let widest = 0
  for (let i = 0; i < scan; i++) widest = Math.max(widest, filledCount(aoa[i]))
  /* Only TITLE-LIKE rows are skipped: at most two cells, all text. Anything
     else above the first wide row means row 1 really is the header (a header
     with some columns left unlabelled, say), and the old behaviour stands.
     The chosen row must also be mostly text — a header names things — so a
     partly-labelled header over wider numeric data is not replaced by the
     first data row. */
  const titleLike = row => filledCount(row) <= 2 && (row || []).every(v => !isFilled(v) || typeof v === 'string')
  const mostlyText = row => {
    const f = (row || []).filter(isFilled)
    return f.filter(v => typeof v === 'string').length >= f.length * 0.6
  }
  let headerAt = 0
  if (widest >= 3) {
    const need = Math.ceil(widest * 0.6)
    for (let i = 0; i < scan; i++) {
      if (filledCount(aoa[i]) >= need) { if (mostlyText(aoa[i])) headerAt = i; break }
      if (!titleLike(aoa[i])) break
    }
  }

  let width = 0
  for (const row of aoa) if (Array.isArray(row)) width = Math.max(width, row.length)

  /* Labels read from copies with merges spread, so the data itself is not
     altered — only what the columns are called. */
  const origin = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s : { r: 0, c: 0 }
  const labelRow = i => {
    const row = Array.from({ length: width }, (_, c) => aoa[i]?.[c])
    for (const m of ws['!merges'] || []) {
      const r0 = m.s.r - origin.r, r1 = m.e.r - origin.r
      if (i < r0 || i > r1) continue
      const v = aoa[r0]?.[m.s.c - origin.c]
      for (let c = m.s.c - origin.c; c <= m.e.c - origin.c; c++) if (c >= 0 && c < width) row[c] = v
    }
    return row
  }
  const own = labelRow(headerAt)
  const group = headerAt > 0 ? labelRow(headerAt - 1) : []
  let labels = own.map((v, c) => (isFilled(v) ? v : isFilled(group[c]) ? group[c] : ''))
  let dataFrom = headerAt + 1

  /* Two-row header: a merged group cell ("Kiekis") over sub-columns
     ("Planuojamas", "Faktinis"). The row below counts as sub-headers only if
     it is all text AND sits under a merged header cell — a first data row of
     names under real headers must not be eaten. */
  const next = aoa[headerAt + 1]
  if (Array.isArray(next) && filledCount(next) > 0) {
    const subOk = next.every(v => !isFilled(v) || typeof v === 'string')
    /* A real merge on the header row, horizontal, over a column that has a
       value in the row below. Two adjacent headers that merely read the same
       are not a group. */
    const underMerge = (ws['!merges'] || []).some(m =>
      m.s.r - origin.r <= headerAt && m.e.r - origin.r >= headerAt && m.e.c > m.s.c &&
      next.some((v, c) => isFilled(v) && c >= m.s.c - origin.c && c <= m.e.c - origin.c))
    if (subOk && underMerge) {
      labels = labels.map((l, c) => {
        const s = next[c]
        if (!isFilled(s)) return l
        return isFilled(l) && l !== s ? `${l} · ${s}` : s
      })
      dataFrom = headerAt + 2
    }
  }

  return { headerRow: headerAt, labels, rows: aoa.slice(dataFrom) }
}

/** Re-exported so callers need only this module, never `xlsx` directly. */
export const utils = XLSX.utils
