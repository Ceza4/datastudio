/*
  lib/chat.js
  --------------------------------------------------------------------------
  THE NETWORK HALF OF THE CHAT BLOCK (migration 0009).

  The store, the grouping and the wording live in lib/chatstore.js, which
  imports nothing that talks to a server — see the note there for why.

  ── THE COLUMN LISTS ARE NOT OPTIONAL ─────────────────────────────────────

  `select('*')` on `chat_messages` is a permission error. 0009 grants SELECT
  column by column and withholds `bytes`, exactly as 0008 withholds
  `shares.grantee_id`; PostgREST's default projection is `*`, so every query
  here names what it wants. Same for writes: five columns on INSERT, two on
  UPDATE, and naming a sixth is a 42501 rather than a silently dropped field.

  ── DRAGGING A BLOCK INTO A CONVERSATION ──────────────────────────────────

  `shareIntoThread` is the one piece of real logic in this file, and the thing
  it has to get right is WHO. A message carrying a block is only useful if the
  people in the thread can read that block, and "the people in the thread" is
  not a list anybody typed — it is whoever holds a live grant on the document
  the chat block sits in.

  So dragging a block in mints one BLOCK-level grant per current thread member.
  Three consequences worth stating rather than discovering:

    · somebody who joins the thread LATER does not get the block. That is the
      correct default — a grant is a decision about a person, and back-dating
      it to everyone who ever arrives is how a "share with two colleagues"
      becomes a company-wide leak six months on.
    · dragging a block from the SAME sheet mints nothing, because everyone who
      can read the chat can already read it. The common case costs no rows.
    · revoking the sheet does not revoke the block. They are separate grants,
      which is what makes "I'll show you this one thing" possible at all.
  -------------------------------------------------------------------------- */

import { getSupabase } from './supabaseClient.js'
import { newId } from './ids.js'
import {
  setThread, addPending, dropPending, setPeople, hasPerson, threadFor,
} from './chatstore.js'
import { LEVEL_BLOCK, ROLE_VIEWER } from './sharing.js'
import { createShare } from './shares.js'
import { accountSnapshot } from './limits.js'

/* Every readable column. One constant, so 0010 adding a column is one edit. */
const COLS = 'id, org_id, doc_id, block_id, author_id, body, ref_block_id, ref_share_id, created_at, edited_at, deleted_at'

/** How many messages a block loads. A thread is capped at 5000 server-side. */
const PAGE = 200

/**
 * Load one thread.
 * @returns {Promise<{ok:boolean, count?:number, reason?:string}>}
 */
export async function fetchThread(blockId, { client } = {}) {
  if (!blockId) return { ok: true, count: 0 }
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { ok: false, reason: 'unconfigured' }
  try {
    /* Newest PAGE, then reversed for display. Ordering ascending with a limit
       would hand back the OLDEST 200 of a long thread — the wrong end, and the
       kind of bug that only shows up once somebody has a real conversation. */
    const { data, error } = await c
      .from('chat_messages')
      .select(COLS)
      .eq('block_id', blockId)
      .order('created_at', { ascending: false })
      .limit(PAGE)
    if (error) return { ok: false, reason: error.message }

    const rows = (data || []).slice().reverse()
    setThread(blockId, rows)
    await resolveAuthors(c, rows.map(r => r.author_id))
    return { ok: true, count: rows.length }
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) }
  }
}

/**
 * Say something.
 *
 * The optimistic row goes up first and is removed again if the write fails —
 * a message that appears, stays, and was never sent is worse than one that
 * takes a moment to appear.
 */
export async function postMessage({ blockId, body, refBlockId, refShareId }, { client } = {}) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { ok: false, reason: 'unconfigured' }
  if (!blockId) return { ok: false, reason: 'no thread' }

  const text = body == null ? null : String(body)
  if (!text?.trim() && !refBlockId) return { ok: false, reason: 'nothing to send' }

  const id = newId('msg')
  const optimistic = {
    id,
    block_id: blockId,
    body: text,
    ref_block_id: refBlockId || null,
    ref_share_id: refShareId || null,
    author_id: currentUserIdSync(),
    created_at: new Date().toISOString(),
    edited_at: null,
    deleted_at: null,
  }
  addPending(blockId, optimistic)

  try {
    const payload = { id, block_id: blockId, body: text }
    /* Omitted rather than sent as null: the INSERT grant covers these columns,
       but a null ref_share_id alongside a real ref_block_id is a half-formed
       reference and it is cheaper to never build one. */
    if (refBlockId) payload.ref_block_id = refBlockId
    if (refShareId) payload.ref_share_id = refShareId

    const { error } = await c.from('chat_messages').insert(payload).select('id').single()
    if (error) {
      dropPending(blockId, id)
      return { ok: false, reason: friendly(error) }
    }
    await fetchThread(blockId, { client: c })
    return { ok: true, id }
  } catch (err) {
    dropPending(blockId, id)
    return { ok: false, reason: err?.message || String(err) }
  }
}

/** Change what you said. Only your own — 0009's policy decides, not this. */
export async function editMessage(id, blockId, body, { client } = {}) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { ok: false, reason: 'unconfigured' }
  try {
    const { data, error } = await c
      .from('chat_messages').update({ body: String(body || '') })
      .eq('id', id).select('id')
    if (error) return { ok: false, reason: friendly(error) }
    if (!data?.length) return { ok: false, reason: 'You can only edit your own messages.' }
    await fetchThread(blockId, { client: c })
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) }
  }
}

/**
 * Unsend.
 *
 * The row stays and the words go — 0009 nulls the body inside the trigger, so
 * "unsent" is not a client-side pretence with the text still sitting on disk.
 */
export async function unsendMessage(id, blockId, { client } = {}) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { ok: false, reason: 'unconfigured' }
  try {
    const { data, error } = await c
      .from('chat_messages').update({ deleted_at: new Date().toISOString() })
      .eq('id', id).select('id')
    if (error) return { ok: false, reason: friendly(error) }
    if (!data?.length) return { ok: false, reason: 'You can only unsend your own messages.' }
    await fetchThread(blockId, { client: c })
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) }
  }
}

/**
 * Drag a block into the conversation.
 *
 * See the header for who ends up with a grant and why. Returns the share id to
 * hang on the message, or null when nobody needed one — which is the common
 * case and is not a failure.
 */
export async function shareIntoThread({ docId, refBlockId }, { client } = {}) {
  const c = client === undefined ? await getSupabase() : client
  if (!c || !docId || !refBlockId) return { ok: true, shareId: null, granted: 0 }

  try {
    /* Who is already in this conversation. `shares` is readable to the person
       who created the grants, which is the person doing the dragging in every
       flow that reaches here. */
    const { data, error } = await c
      .from('shares')
      .select('id, subject_kind, grantee_email')
      .eq('doc_id', docId)
      .is('revoked_at', null)
    if (error) return { ok: false, reason: error.message }

    const members = [...new Set((data || [])
      .map(s => s.grantee_email)
      .filter(Boolean))]

    /* Nobody outside your own workspace is in this thread — everyone who can
       read the chat can already read the block, so there is nothing to grant.
       This is the common case (dragging a block from the same sheet) and it
       costs no rows and no audit-trail noise. */
    if (!members.length) return { ok: true, shareId: null, granted: 0 }

    let first = null
    let granted = 0
    for (const email of members) {
      const res = await createShare(
        { docId, level: LEVEL_BLOCK, blockId: refBlockId, email, role: ROLE_VIEWER },
        { client: c },
      )
      /* A duplicate is a success: that person already had this block, which is
         exactly the state we were trying to reach. */
      if (res.ok) { granted++; first = first || res.row?.id }
      else if (!/already has access/i.test(res.reason || '')) {
        return { ok: false, reason: res.reason }
      }
    }
    return { ok: true, shareId: first, granted }
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) }
  }
}

/**
 * Live updates for one thread.
 *
 * Returns an unsubscribe, always — a caller should never have to check whether
 * realtime was available before cleaning up. With no connection the thread
 * still works; it just refreshes when you send rather than when they do.
 */
export function subscribeThread(blockId, onChange, { client } = {}) {
  let channel = null
  let dead = false

  ;(async () => {
    const c = client === undefined ? await getSupabase() : client
    if (!c || dead || !blockId) return
    try {
      channel = c
        .channel(`chat:${blockId}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'chat_messages', filter: `block_id=eq.${blockId}` },
          () => { fetchThread(blockId, { client: c }).then(() => onChange?.()).catch(() => {}) })
        .subscribe()
    } catch { /* realtime is a nicety; the thread works without it */ }
  })()

  return () => {
    dead = true
    try { channel?.unsubscribe?.() } catch { /* already gone */ }
  }
}

/**
 * uuid → name, for the people in these messages.
 *
 * `profiles` is readable only for members of your own organisations, so a
 * friend in another workspace resolves to nothing and renders as "Someone".
 * That is correct rather than a limitation: their name is not ours to show.
 */
async function resolveAuthors(c, uuids) {
  const wanted = [...new Set((uuids || []).filter(u => u && !hasPerson(u)))]
  if (!wanted.length) return
  try {
    const { data } = await c.from('profiles').select('id, display_name, email').in('id', wanted)
    const found = new Map()
    for (const p of data || []) {
      found.set(p.id, p.display_name || String(p.email || '').split('@')[0] || null)
    }
    /* Remember the misses too, or an unresolvable id is re-queried on every
       poll for the rest of the session. */
    for (const u of wanted) if (!found.has(u)) found.set(u, null)
    setPeople(found)
  } catch { /* names are optional; the thread reads without them */ }
}

/* The signed-in id, without awaiting. Used only to colour an optimistic row,
   which is replaced by the server's version a moment later — so a stale answer
   here is a wrong tint for 200ms, not a wrong attribution. */
function currentUserIdSync() {
  try { return accountSnapshot()?.userId || null } catch { return null }
}

function friendly(error) {
  const msg = error?.message || String(error)
  const code = error?.code || ''
  if (code === '42501' || /permission denied|row-level security/i.test(msg)) {
    return 'You do not have access to this conversation.'
  }
  if (/chat_body_len/.test(msg)) return 'That message is too long — 4000 characters is the limit.'
  if (/chat_has_content/.test(msg)) return 'Write something, or attach a block.'
  if (/limit of 5000/.test(msg)) return 'This conversation is full — 5000 messages is the limit.'
  if (/cannot share a block you cannot see/i.test(msg)) return 'You cannot pass on a block you do not have access to.'
  return msg
}

export { threadFor }
