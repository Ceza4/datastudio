/*
  lib/appversion.js
  --------------------------------------------------------------------------
  THE FORMAT A DOCUMENT WAS WRITTEN IN, AND WHO MAY OVERWRITE IT.

  A browser tab can run for days. When the app learns new markup — section
  breaks, tab stops — an older tab still open somewhere does not: its
  sanitiser strips what it does not know, and the next save pushes the
  stripped document over the good one, on every device. Compare-and-set
  cannot see this; the old tab's write is perfectly ordered. It simply should
  not be allowed to write.

  So every pushed document carries `_schema` = CONTENT_SCHEMA, and the
  server (migration 0010, docs_00_schema_guard) refuses a write that would
  LOWER it. A client that sees a newer format on pull stops pushing and asks
  for a reload (lib/sync.js, SYNC_OUTDATED). Nothing is lost either way: the
  refused edit stays in the outbox and goes up after the reload.

  ── WHEN TO BUMP IT ──────────────────────────────────────────────────────

  Whenever stored content gains markup or fields an older build would drop:
  a new data-* attribute in lib/sanitize.js, a new block field that an older
  normaliser deletes. tests/appversion.test.mjs fails when lib/sanitize.js
  changes without this file being looked at: bump CONTENT_SCHEMA if the
  change widens what may be stored, then update SANITIZE_FINGERPRINT.
  -------------------------------------------------------------------------- */

/* 1 — section breaks, tab stops (Document block, 26 Sep 2026). */
export const CONTENT_SCHEMA = 1

/* sha256 of lib/sanitize.js, first 16 hex chars, when CONTENT_SCHEMA was last
   reviewed against it. See the header. */
export const SANITIZE_FINGERPRINT = 'ed889add6bcf6fc5'

/** The format a stored document was written in (0 = before stamping). */
export function schemaOf(doc) {
  const n = Number(doc?._schema)
  return Number.isInteger(n) && n >= 0 ? n : 0
}

/** The document as it is pushed: stamped with this build's format. */
export function stampDoc(doc) {
  if (!doc || typeof doc !== 'object') return doc
  return doc._schema === CONTENT_SCHEMA ? doc : { ...doc, _schema: CONTENT_SCHEMA }
}

/** Was this write refused because this build is older than the document? */
export function isOutdatedError(err) {
  const m = String(err?.message || err || '')
  return m.startsWith('outdated_client') || err?.hint === 'outdated_client'
}

export const OUTDATED_MESSAGE =
  'A newer version of DataStudio saved your work on another tab or device. Reload to keep syncing — nothing here is lost.'
