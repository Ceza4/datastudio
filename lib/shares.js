/*
  lib/shares.js
  --------------------------------------------------------------------------
  THE NETWORK HALF OF SHARING (migration 0008).

  The model, the store and the wording are in lib/sharing.js, which imports
  nothing that talks to a server — see the note there for why that split
  exists rather than this being one convenient file.

  ── THE THING THAT WILL BITE ANYONE EDITING THIS FILE ──────────────────────

  `select('*')` ON `shares` IS A PERMISSION ERROR.

  0008 §9 grants SELECT column by column and deliberately withholds
  `grantee_id`, because a client that can read it can share to an address,
  read the resolved uuid back, and learn whether that address has an account
  here — one row per guess, at API speed. PostgREST's default projection is
  `*`, so every query below names its columns explicitly. That is not style;
  omitting it returns 42501 and the feature simply stops working.

  The same applies to writes: INSERT may name seven columns and UPDATE exactly
  one (`revoked_at`). lib/sharing.js's `sharePayload()` builds the insert so
  the list lives in one place.
  -------------------------------------------------------------------------- */

import { getSupabase } from './supabaseClient.js'
import { newId } from './ids.js'
import {
  setOutgoing, setIncoming, setSharingPolicy,
  sharePayload, LEVEL_PROJECT,
} from './sharing.js'

/* Every readable column, in one constant. A second copy of this list is a
   second thing to forget to update when 0009 adds a column. */
const COLS = 'id, org_id, doc_id, subject_kind, sheet_id, block_id, grantee_email, role, created_by, created_at, revoked_at'

/* PostgREST puts `in.(…)` in the QUERY STRING, so a workspace with a few
   hundred projects builds a URL past the proxy's line limit and fails as a
   414 — which reads like anything except the real problem. Same chunk size
   and same reason as lib/blocks.js. */
const CHUNK = 50

/**
 * Who can see this project, at any level.
 * @returns {Promise<{ok:boolean, rows?:object[], reason?:string}>}
 */
export async function listShares(docId, { client } = {}) {
  if (!docId) return { ok: true, rows: [] }
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { ok: false, reason: 'unconfigured' }
  try {
    const { data, error } = await c
      .from('shares')
      .select(COLS)
      .eq('doc_id', docId)
      .is('revoked_at', null)
      .order('created_at', { ascending: true })
    if (error) return { ok: false, reason: error.message }
    setOutgoing(docId, data || [])
    return { ok: true, rows: data || [] }
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) }
  }
}

/**
 * Grant somebody a project, a sheet or a block.
 *
 * The id is minted here rather than by the database because the whole app
 * mints its own ids (lib/ids.js) and a server-generated one would be the only
 * id in the system the client has to wait for.
 */
export async function createShare({ docId, level, sheetId, blockId, email, role }, { client } = {}) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { ok: false, reason: 'unconfigured' }

  let payload
  try {
    payload = sharePayload({ id: newId('shr'), docId, level, sheetId, blockId, email, role })
  } catch (err) {
    return { ok: false, reason: err.message }
  }
  if (!payload.grantee_email) return { ok: false, reason: 'Enter an email address to share with.' }

  try {
    /* `.select(COLS)` and not `.select()`: the default is `*`, which cannot
       read grantee_id and fails the whole insert on the way back. */
    const { data, error } = await c.from('shares').insert(payload).select(COLS).single()
    if (error) return { ok: false, reason: friendly(error) }
    await listShares(docId, { client: c })
    return { ok: true, row: data }
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) }
  }
}

/**
 * Take access away.
 *
 * An UPDATE, never a DELETE: 0008 grants no DELETE at all, because "who could
 * see this, and until when" is a question somebody eventually has to answer
 * and a deleted row answers it with silence. The timestamp we send is
 * overwritten by the trigger with the server's clock — sending one at all is
 * just what makes the column non-null.
 */
export async function revokeShare(shareId, docId, { client } = {}) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { ok: false, reason: 'unconfigured' }
  try {
    const { error } = await c
      .from('shares')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', shareId)
    if (error) return { ok: false, reason: friendly(error) }
    if (docId) await listShares(docId, { client: c })
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) }
  }
}

/**
 * Everything other people have given me.
 *
 * Two queries rather than one join, because they answer two different
 * questions and only one of them can be answered by `shares` alone:
 *
 *   · the grants themselves — what I have been given, and at what level
 *   · the CONTENT of sheet- and block-level grants, which lives in
 *     `blocks.data` and is populated by 0008 §6 only while the grant is live
 *
 * A project-level grant needs no second query: the `docs` row is readable and
 * the normal pull already collects it.
 */
export async function fetchIncoming({ client } = {}) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { ok: false, reason: 'unconfigured' }
  try {
    const { data: grants, error } = await c
      .from('shares')
      .select(COLS)
      .is('revoked_at', null)
    if (error) return { ok: false, reason: error.message }

    /* `shares readable` also returns the grants I MADE, and those are not
       things shared WITH me. Anything I created is mine already. */
    const mine = await currentUserId(c)
    const rows = (grants || []).filter(g => g.created_by !== mine)
    setIncoming(rows)

    const docIds = [...new Set(rows
      .filter(g => g.subject_kind !== LEVEL_PROJECT)
      .map(g => g.doc_id))]
    const blocks = await fetchSharedBlocks(docIds, c)
    return { ok: true, grants: rows, blocks }
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) }
  }
}

/** The content of blocks I can see through a sheet- or block-level grant. */
export async function fetchSharedBlocks(docIds, client) {
  const ids = [...new Set((docIds || []).filter(Boolean))]
  if (!ids.length) return []
  const c = client === undefined ? await getSupabase() : client
  if (!c) return []
  const out = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await c
      .from('blocks')
      .select('id, doc_id, sheet_id, kind, data, edited_by, edited_at')
      .in('doc_id', ids.slice(i, i + CHUNK))
      .not('data', 'is', null)
    if (error) break
    out.push(...(data || []))
  }
  return out
}

/**
 * Write an edit to a block somebody shared with me.
 *
 * This is the ONLY column a grantee may write, and the trigger in 0008 §8
 * pushes it back into the owner's document. Note what is NOT sent:
 * `fingerprint`, `edited_by` and `edited_at` are all recomputed server-side,
 * because a client that can set the fingerprint can edit a block and leave
 * somebody else's name on it.
 */
export async function pushSharedBlock(blockId, data, { client } = {}) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { ok: false, reason: 'unconfigured' }
  if (!blockId || !data) return { ok: false, reason: 'nothing to write' }
  try {
    const { data: rows, error } = await c
      .from('blocks')
      .update({ data })
      .eq('id', blockId)
      .select('id')
    if (error) return { ok: false, reason: friendly(error) }
    /* Zero rows is not an error from PostgREST — it is RLS declining, which
       is exactly what a viewer's write looks like. Say so plainly rather than
       reporting a silent success. */
    if (!rows || !rows.length) {
      return { ok: false, reason: 'You have view-only access to this block.' }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) }
  }
}

/** Flip a project between "everyone in my workspace" and "only me". */
export async function setVisibility(docId, visibility, { client } = {}) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { ok: false, reason: 'unconfigured' }
  try {
    const { data, error } = await c
      .from('docs')
      .update({ visibility })
      .eq('id', docId)
      .select('id, visibility')
    if (error) return { ok: false, reason: friendly(error) }
    if (!data || !data.length) return { ok: false, reason: 'Only the owner of a project can change who can see it.' }
    return { ok: true, visibility: data[0].visibility }
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) }
  }
}

/** The workspace-wide switch. Owners and admins only — RLS decides, not us. */
export async function saveSharingPolicy(orgId, policy, { client } = {}) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { ok: false, reason: 'unconfigured' }
  try {
    const { data, error } = await c
      .from('organizations')
      .update({ sharing_policy: policy })
      .eq('id', orgId)
      .select('id, sharing_policy')
    if (error) return { ok: false, reason: friendly(error) }
    if (!data || !data.length) return { ok: false, reason: 'Only an owner or admin can change this.' }
    setSharingPolicy(data[0].sharing_policy)
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) }
  }
}

/** Read the workspace switch so the UI can grey the right things out. */
export async function loadSharingPolicy(orgId, { client } = {}) {
  const c = client === undefined ? await getSupabase() : client
  if (!c || !orgId) return { ok: false, reason: 'unconfigured' }
  try {
    const { data, error } = await c
      .from('organizations')
      .select('id, sharing_policy')
      .eq('id', orgId)
      .maybeSingle()
    if (error) return { ok: false, reason: error.message }
    if (data?.sharing_policy) setSharingPolicy(data.sharing_policy)
    return { ok: true, policy: data?.sharing_policy }
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) }
  }
}

async function currentUserId(c) {
  try {
    const { data } = await c.auth.getUser()
    return data?.user?.id || null
  } catch { return null }
}

/*
  The database's messages are already written for people — 0008 raises
  "Sharing is turned off for this workspace." rather than a constraint name,
  precisely so this function has something to pass through. What is left here
  is the handful of codes that surface as machinery.
*/
function friendly(error) {
  const msg = error?.message || String(error)
  const code = error?.code || ''
  if (code === '42501' || /permission denied/i.test(msg)) {
    return 'You do not have permission to change this.'
  }
  if (code === '23505' || /duplicate key|already exists/i.test(msg)) {
    return 'That person already has access to this.'
  }
  if (/shares_subject_shape/.test(msg)) {
    return 'That share is missing the sheet or block it is meant to point at.'
  }
  if (/shares_has_grantee/.test(msg)) return 'Enter an email address to share with.'
  return msg
}
