/*
  lib/sharing.js
  --------------------------------------------------------------------------
  THE PURE HALF OF SHARING.

  Three levels — a PROJECT, a SHEET, a BLOCK — plus a project's private/org
  switch, backed by migration 0008. This file holds the model, the store and
  the wording. It imports nothing that talks to a server, for the reason
  lib/attribution.js explains at length: a sidebar row or a block header that
  cannot render without the network layer being loadable is a component with
  the wrong dependencies, and the browser harness catches it as
  `process is not defined` the moment anything imports supabaseClient.js.

  lib/shares.js does the fetching and writes into this.

  ── THE ONE RULE WORTH STATING TWICE ───────────────────────────────────────

  NOTHING HERE DECIDES ACCESS. Every function below is about what to DRAW.
  The database decides who may read and write, in RLS, from a `shares` row
  whose org, grantor and grantee are all stamped by a trigger. If this file
  and the database ever disagree, the database is right and this file has a
  cosmetic bug — which is the only failure mode worth having.

  It follows that `canEdit()` is a hint for greying out a control, never a
  gate. The gate is that a viewer's UPDATE matches zero rows.

  ── VOCABULARY ─────────────────────────────────────────────────────────────

  The database says `doc`, the user says "project", and the code has said
  `notebook` since 0001. All three mean the same thing. LEVEL_PROJECT is the
  wire value (`doc`) so nothing has to translate on the way out; `levelNoun()`
  is the only place the user-facing word is chosen.
  -------------------------------------------------------------------------- */

export const LEVEL_PROJECT = 'doc'
export const LEVEL_SHEET   = 'sheet'
export const LEVEL_BLOCK   = 'block'
export const LEVELS = [LEVEL_PROJECT, LEVEL_SHEET, LEVEL_BLOCK]

export const ROLE_VIEWER = 'viewer'
export const ROLE_EDITOR = 'editor'
export const ROLES = [ROLE_VIEWER, ROLE_EDITOR]

export const VIS_ORG     = 'org'
export const VIS_PRIVATE = 'private'

export const POLICY_OPEN     = 'open'
export const POLICY_INTERNAL = 'internal'
export const POLICY_OFF      = 'off'

/* ── the store ─────────────────────────────────────────────────────────────

   Two maps rather than one, because the two questions have different shapes
   and different lifetimes:

     outgoing   docId → [grant, …]      "who can see this thing of mine"
     incoming   docId → [grant, …]      "what have other people given me"

   Both are caches over a local-first app and both are allowed to be empty.
   With no network the sidebar simply shows no shared section, which is the
   correct degradation: it is not claiming nothing is shared, it is not
   claiming anything. */

let outgoing = new Map()
let incoming = new Map()
let policy   = POLICY_OPEN
const listeners = new Set()

function emit() {
  for (const fn of listeners) {
    try { fn() } catch { /* a bad listener is not our problem */ }
  }
}

/** Subscribe to any change in what is shared. Returns the unsubscribe. */
export function onShares(fn) {
  if (typeof fn !== 'function') return () => {}
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function setOutgoing(docId, rows) {
  if (!docId) return
  const next = new Map(outgoing)
  if (rows && rows.length) next.set(docId, rows.slice())
  else next.delete(docId)
  outgoing = next
  emit()
}

/* Rebuilt, never merged — the same decision lib/blocks.js documents for
   attribution. A grant that has been revoked elsewhere must DISAPPEAR, and a
   merge leaves it on screen forever, which is the one bug a sharing UI must
   not have. */
export function setIncoming(rows) {
  const next = new Map()
  for (const r of rows || []) {
    if (!r?.doc_id) continue
    const list = next.get(r.doc_id) || []
    list.push(r)
    next.set(r.doc_id, list)
  }
  incoming = next
  emit()
}

export function setSharingPolicy(next) {
  policy = LEVELS && [POLICY_OPEN, POLICY_INTERNAL, POLICY_OFF].includes(next) ? next : POLICY_OPEN
  emit()
}

export function sharingPolicy() { return policy }

/** Grants I have made on this document. */
export function sharesFor(docId) { return outgoing.get(docId) || [] }

/** Grants other people have made to me, flattened. */
export function incomingShares() {
  const out = []
  for (const list of incoming.values()) out.push(...list)
  return out
}

export function clearShares() {
  outgoing = new Map()
  incoming = new Map()
  sharedBlocks = new Map()
  policy = POLICY_OPEN
  emit()
}

/* ── THE CONTENT OF BLOCKS OTHER PEOPLE HAVE SHARED WITH ME ───────────────
   lib/shares.js's fetchSharedBlocks() has always fetched these — it is the
   mechanism behind block-level sharing — and lib/sync.js has always thrown the
   result away, because until now nothing needed the DATA, only the grant.

   A reference card in a chat thread needs the data: it previews the block's
   real contents, and dragging it onto your canvas builds a genuine copy from
   them. So the rows get a home here, beside the grants they arrived with.

   REBUILT, NEVER MERGED — the same decision setIncoming documents above and
   for the same reason: a block whose grant has been revoked must DISAPPEAR,
   and a merge leaves stale content readable forever. That is worse here than
   for a grant list, because the stale thing is the document's contents. */
let sharedBlocks = new Map()

/** Rows as fetchSharedBlocks returns them: { id, doc_id, sheet_id, kind, data }. */
export function setSharedBlocks(rows) {
  const next = new Map()
  for (const r of rows || []) {
    if (!r?.id || !r.data) continue
    /* The stored block object, with its own id forced to the row's — a block
       object that disagreed with the row it came from would build a copy under
       the wrong id, and ids are how every grant check finds it. */
    next.set(r.id, { ...r.data, id: r.id })
  }
  sharedBlocks = next
  emit()
}

/** The block, or null. Null is a normal answer, not an error. */
export function sharedBlockFor(blockId) {
  return sharedBlocks.get(blockId) || null
}

export function sharedBlockCount() { return sharedBlocks.size }

/* ── what a share is about ────────────────────────────────────────────────*/

/**
 * Build the row a client is allowed to send. Deliberately returns ONLY the
 * columns 0008 grants on INSERT — naming `org_id`, `created_by` or
 * `grantee_id` is a privilege error, not a silently ignored field, and a
 * helper that quietly includes them turns every share into a 403 nobody can
 * explain.
 */
export function sharePayload({ id, docId, level, sheetId, blockId, email, role }) {
  if (!docId) throw new Error('A share needs a project.')
  if (!LEVELS.includes(level)) throw new Error(`Unknown share level: ${level}`)
  if (level === LEVEL_SHEET && !sheetId) throw new Error('A sheet share needs a sheet.')
  if (level === LEVEL_BLOCK && !blockId) throw new Error('A block share needs a block.')

  const row = {
    id,
    doc_id: docId,
    subject_kind: level,
    role: role === ROLE_EDITOR ? ROLE_EDITOR : ROLE_VIEWER,
    grantee_email: String(email || '').trim().toLowerCase() || null,
  }
  /* Left off entirely rather than sent as null: a `sheet_id` on a project
     share violates the shape constraint in 0008 §3 and the error it raises
     ("shares_subject_shape") means nothing to anybody reading a toast. */
  if (level === LEVEL_SHEET) row.sheet_id = sheetId
  if (level === LEVEL_BLOCK) row.block_id = blockId
  return row
}

/** Does this grant cover this block? Mirrors my_shared_block_ids() in 0008 §5. */
export function grantCoversBlock(grant, { docId, sheetId, blockId }) {
  if (!grant || grant.revoked_at) return false
  if (grant.doc_id !== docId) return false
  if (grant.subject_kind === LEVEL_PROJECT) return true
  if (grant.subject_kind === LEVEL_SHEET)   return !!sheetId && grant.sheet_id === sheetId
  if (grant.subject_kind === LEVEL_BLOCK)   return !!blockId && grant.block_id === blockId
  return false
}

/**
 * May I edit this block through a grant somebody gave me?
 *
 * A HINT FOR THE UI, NOT A GATE — see the header. Project-level grants are
 * excluded on purpose and not by oversight: 0008 routes a project editor
 * through `docs` like any collaborator, so that one document never has two
 * write paths with two different conflict rules.
 */
export function canEditBlock({ docId, sheetId, blockId }) {
  for (const g of incoming.get(docId) || []) {
    if (g.role !== ROLE_EDITOR) continue
    if (g.subject_kind === LEVEL_PROJECT) continue
    if (grantCoversBlock(g, { docId, sheetId, blockId })) return true
  }
  return false
}

/** Is any part of this project shared with anybody? Drives the sidebar badge. */
export function isShared(docId) {
  return (outgoing.get(docId) || []).some(g => !g.revoked_at)
}

/** Was this project given to me by somebody else? */
export function isIncoming(docId) {
  return (incoming.get(docId) || []).some(g => !g.revoked_at)
}

/* ── words ────────────────────────────────────────────────────────────────

   Written from the reader's side of the screen. "Sheet 1 — can edit" tells
   somebody what they are looking at; "sheet · editor · sh_9f2a" tells them
   how it is stored. */

export function levelNoun(level) {
  if (level === LEVEL_PROJECT) return 'project'
  if (level === LEVEL_SHEET)   return 'sheet'
  if (level === LEVEL_BLOCK)   return 'block'
  return 'item'
}

export function roleLabel(role) {
  return role === ROLE_EDITOR ? 'can edit' : 'can view'
}

/**
 * One line for a row in the share list. `names` maps a subject id to the name
 * the user gave it, so a sheet reads as the sheet they named rather than as
 * an id they have never seen.
 */
export function shareLabel(grant, names = {}) {
  if (!grant) return ''
  const who = grant.grantee_email || 'someone'
  const what =
    grant.subject_kind === LEVEL_PROJECT ? 'the whole project'
  : grant.subject_kind === LEVEL_SHEET   ? (names[grant.sheet_id] || 'one sheet')
  : (names[grant.block_id] || 'one block')
  return `${who} — ${what}, ${roleLabel(grant.role)}`
}

export function visibilityLabel(v) {
  return v === VIS_PRIVATE ? 'Only me and people I invite' : 'Everyone in my workspace'
}

/**
 * Why a share control is disabled, or null when it is not.
 *
 * Returning the SENTENCE rather than a boolean is deliberate: "Sharing is
 * turned off for this workspace" is something an admin can act on, and a
 * greyed-out button with no explanation is the single most common way a
 * permission system gets reported as a bug.
 */
export function shareBlockedReason({ isOwner = true } = {}) {
  if (policy === POLICY_OFF) {
    return 'Sharing is turned off for this workspace. An owner or admin can turn it back on in Settings.'
  }
  if (!isOwner) return null
  return null
}

/** Does the org policy allow this address? Cosmetic pre-check; 0008 §4 decides. */
export function policyAllowsEmail(email, memberEmails = []) {
  if (policy === POLICY_OFF) return false
  if (policy !== POLICY_INTERNAL) return true
  const e = String(email || '').trim().toLowerCase()
  return memberEmails.some(m => String(m || '').toLowerCase() === e)
}

/* Test seam, matching lib/attribution.js's `_setAttribution`. */
export const _setOutgoing = setOutgoing
export const _setIncoming = setIncoming
