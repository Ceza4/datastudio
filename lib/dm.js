/*
  lib/dm.js
  --------------------------------------------------------------------------
  CONVERSATIONS WITH PEOPLE — the People panel's network half (migration 0010).

  A conversation (a "thread") belongs to its members, not to a document. The
  People panel used to hide a chat BLOCK in the current project per person;
  a chat block is readable by everyone who can read the block, so a
  one-to-one was readable by every colleague and every other person the
  project was shared with — and a conversation with somebody who shared THEIR
  project with you lived in a document they could not read at all.

  Everything here goes through the chat_* database functions; clients cannot
  write the thread tables directly. Messages themselves are ordinary
  chat_messages rows keyed by `thread_id`, so the thread renders in the same
  ChatBlock and uses the same post / edit / unsend calls as a canvas chat
  (lib/chat.js takes a thread id wherever it takes a block id).

  WHAT A MEMBER LOOKS LIKE. The server never returns account ids for members
  (an "is this address registered" oracle is exactly what 0008 refuses to be).
  A member is { key, email, name|null, self, joined, left }. `name` arrives
  once they have taken part; until then the UI shows the typed address and
  "invited".

  This file keeps a tiny store of the thread list so the People button can
  show an unread count without the panel being open.
  -------------------------------------------------------------------------- */

import { getSupabase } from './supabaseClient.js'
import { createShare } from './shares.js'
import { LEVEL_BLOCK, ROLE_VIEWER } from './sharing.js'

let threads = []
let loaded = false
const listeners = new Set()
function emit() { for (const fn of listeners) { try { fn() } catch { /* ignore */ } } }

export function onThreads(fn) { listeners.add(fn); return () => listeners.delete(fn) }
export function threadList() { return threads }
export function threadsLoaded() { return loaded }
export function threadById(id) { return threads.find(t => t.id === id) || null }
export function totalUnread() { return threads.reduce((n, t) => n + (t.unread || 0), 0) }
export function clearThreadList() { threads = []; loaded = false; emit() }

/** The other people in a thread (not me, not those who left). */
export function othersIn(thread) {
  return (thread?.members || []).filter(m => !m.self && !m.left)
}

/** A thread's display name: its title, or the people in it. */
export function threadLabel(thread) {
  if (!thread) return ''
  if (thread.title) return thread.title
  const o = othersIn(thread)
  if (!o.length) return 'Just you'
  return o.map(m => m.name || m.email).join(', ')
}

/** The direct thread with this address, if one is loaded. */
export function directThreadWith(email) {
  const e = String(email || '').toLowerCase()
  return threads.find(t => t.kind === 'direct' && othersIn(t).some(m => (m.email || '').toLowerCase() === e)) || null
}

const friendly = err => {
  const m = err?.message || String(err || '')
  if (/permission denied|42501/.test(m)) return 'You are not in this conversation.'
  return m.replace(/^.*?ERROR:\s*/, '')
}

async function client(c) { return c === undefined ? getSupabase() : c }

/** Reload my conversations. */
export async function loadThreads({ client: c0 } = {}) {
  const c = await client(c0)
  if (!c) return { ok: false, reason: 'unconfigured' }
  try {
    const { data, error } = await c.rpc('chat_my_threads')
    if (error) return { ok: false, reason: friendly(error) }
    threads = (data || []).map(t => ({ ...t, members: Array.isArray(t.members) ? t.members : [] }))
    loaded = true
    emit()
    return { ok: true, threads }
  } catch (err) {
    return { ok: false, reason: friendly(err) }
  }
}

/**
 * Start a conversation (or find the direct one that exists).
 * One address and no title → direct; otherwise a group.
 */
export async function startThread(emails, title = null, { client: c0 } = {}) {
  const c = await client(c0)
  if (!c) return { ok: false, reason: 'Sign in to start a conversation.' }
  try {
    const { data, error } = await c.rpc('chat_start_thread', { p_emails: emails, p_title: title })
    if (error) return { ok: false, reason: friendly(error) }
    await loadThreads({ client: c })
    return { ok: true, id: data }
  } catch (err) {
    return { ok: false, reason: friendly(err) }
  }
}

async function call(fn, args, c0) {
  const c = await client(c0)
  if (!c) return { ok: false, reason: 'unconfigured' }
  try {
    const { data, error } = await c.rpc(fn, args)
    if (error) return { ok: false, reason: friendly(error) }
    await loadThreads({ client: c })
    return { ok: true, data }
  } catch (err) {
    return { ok: false, reason: friendly(err) }
  }
}

export const addMembers = (threadId, emails, o = {}) => call('chat_add_members', { p_thread: threadId, p_emails: emails }, o.client)
export const renameThread = (threadId, title, o = {}) => call('chat_rename', { p_thread: threadId, p_title: title }, o.client)
export const leaveThread = (threadId, o = {}) => call('chat_leave', { p_thread: threadId }, o.client)

/** Mark read. Updates the local count at once so badges clear without a round trip. */
export async function markRead(threadId, { client: c0 } = {}) {
  const t = threadById(threadId)
  if (t && t.unread) { threads = threads.map(x => (x.id === threadId ? { ...x, unread: 0 } : x)); emit() }
  const c = await client(c0)
  if (!c) return { ok: false }
  try { await c.rpc('chat_mark_read', { p_thread: threadId }) } catch { /* next load corrects it */ }
  return { ok: true }
}

/** Who has shared something with me, by name (0010). */
export async function peopleWhoSharedWithMe({ client: c0 } = {}) {
  const c = await client(c0)
  if (!c) return []
  try {
    const { data } = await c.rpc('people_who_shared_with_me')
    return data || []
  } catch { return [] }
}

/**
 * Drag a block into a conversation: grant it to the thread's OTHER members
 * (block level, viewer) so the card they receive can be opened. Only the
 * people in THIS conversation — never "everyone the project is shared with",
 * which is what the block-chat version had to assume.
 */
export async function shareIntoDm({ threadId, docId, refBlockId }, { client: c0 } = {}) {
  const c = await client(c0)
  if (!c || !docId || !refBlockId) return { ok: true, shareId: null, granted: 0 }
  const emails = othersIn(threadById(threadId)).map(m => m.email).filter(Boolean)
  let first = null
  let granted = 0
  for (const email of emails) {
    const res = await createShare({ docId, level: LEVEL_BLOCK, blockId: refBlockId, email, role: ROLE_VIEWER }, { client: c })
    if (res.ok) { granted++; first = first || res.row?.id }
    else if (!/already has access/i.test(res.reason || '')) return { ok: false, reason: res.reason }
  }
  return { ok: true, shareId: first, granted }
}

/**
 * Live: any message in any of my conversations. RLS decides which rows reach
 * this client, so one subscription covers every thread. Calls back with the
 * thread id that changed. Returns an unsubscribe, always.
 */
export function subscribeInbox(onMessage, { client: c0 } = {}) {
  let channel = null
  let dead = false
  ;(async () => {
    const c = await client(c0)
    if (!c || dead) return
    try {
      channel = c.channel('inbox')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, payload => {
          const tid = payload?.new?.thread_id || payload?.old?.thread_id
          if (!tid) return
          loadThreads({ client: c }).catch(() => {})
          onMessage?.(tid)
        })
        .subscribe()
    } catch { /* live updates are a nicety */ }
  })()
  return () => { dead = true; try { channel?.unsubscribe?.() } catch { /* gone */ } }
}

/* Test seam. */
export function _setThreads(list) { threads = list || []; loaded = true; emit() }

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
/** Split "a@x.com, b@y.com; c" into valid addresses and the rest. */
export function parseEmails(text) {
  const parts = String(text || '').split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
  const good = [], bad = []
  for (const p of parts) (EMAIL_RE.test(p) && p.length <= 254 ? good : bad).push(p.toLowerCase())
  return { good: [...new Set(good)], bad }
}
