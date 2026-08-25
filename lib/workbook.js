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

/** Re-exported so callers need only this module, never `xlsx` directly. */
export const utils = XLSX.utils
