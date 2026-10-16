/*
  lib/filename.js
  --------------------------------------------------------------------------
  One rule for the name of every file DataStudio hands you (audit DEF-026).

  Both exporters used an ASCII allow-list — `[^a-z0-9\-_ ]` → "_" — so a
  project called "Ataskaita už rugsėjį" downloaded as "Ataskaita u_ rugs_j_",
  and every export of "My Project — Sheet 1" read "My Project _ Sheet 1".
  For a product sold in Lithuania that is most names.

  Only what file systems actually refuse is replaced: control characters and
  < > : " / \ | ? * (Windows' list, a superset of macOS and Linux). Dashes
  become "-", whitespace collapses, trailing dots and spaces go (Windows
  drops them silently and then cannot find the file), and the reserved DOS
  device names get a prefix.
  -------------------------------------------------------------------------- */

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i

export function safeFileName(s, fallback = 'untitled') {
  let out = String(s ?? '').normalize('NFC')
    .replace(/[‒-―]/g, '-')
    .replace(/[\u0000-\u001F\u007F<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  if (RESERVED.test(out)) out = '_' + out
  out = Array.from(out).slice(0, 80).join('').trim()
  return out || fallback
}
