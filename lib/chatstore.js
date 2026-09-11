/*
  lib/chatstore.js
  --------------------------------------------------------------------------
  THE PURE HALF OF THE CHAT BLOCK.

  The message store, the grouping rule and the wording. Imports nothing that
  talks to a server, for the reason lib/attribution.js sets out at length: a
  block renderer that cannot mount without the network layer being loadable is
  a component with the wrong dependencies, and the browser harness catches it
  as `process is not defined` the moment anything reaches supabaseClient.js.

  lib/chat.js does the fetching and writes into this.

  ── WHAT THIS FILE IS CAREFUL ABOUT ────────────────────────────────────────

  1. A THREAD IS A CACHE AND IS ALLOWED TO BE EMPTY. DataStudio works with no
     network at all. An empty thread renders as "no messages yet", never as an
     error, and never as a spinner that outlives the answer.

  2. `body` IS PLAIN TEXT AND STAYS PLAIN TEXT. 0009 does not sanitise it,
     because nothing is supposed to hand it to an HTML parser. Every consumer
     of `msg.body` must set textContent. There is a test asserting this file
     never gains an html-shaped helper, because the day somebody adds
     `bodyHtml()` is the day a chat message becomes an XSS vector in an app
     that has already had four sanitiser gaps.

  3. GROUPING IS PRESENTATION, NOT DATA. Consecutive messages from one person
     collapse into one visual run; nothing about the rows changes. Getting this
     backwards — storing "isFirstOfRun" — would mean a message's appearance
     depending on when it was fetched.
  -------------------------------------------------------------------------- */

import { accountSnapshot, } from './limits.js'
import { personHue } from './attribution.js'

/** blockId → Message[] , oldest first */
let byBlock = new Map()
const listeners = new Set()

/* uuid → display name, filled by lib/chat.js from `profiles`. Shared shape
   with lib/attribution.js on purpose: the same colleague should be the same
   name and the same colour whether you meet them on a block flag or in a
   thread. */
let people = new Map()

function emit() {
  for (const fn of listeners) {
    try { fn() } catch { /* a bad listener is not our problem */ }
  }
}

/** Subscribe to any thread changing. Returns the unsubscribe. */
export function onThread(fn) {
  if (typeof fn !== 'function') return () => {}
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * Replace one thread.
 *
 * Rebuilt rather than merged, the same decision lib/blocks.js documents for
 * attribution: a message unsent on another device has to DISAPPEAR, and a
 * merge leaves it on screen for the rest of the session.
 */
export function setThread(blockId, messages) {
  if (!blockId) return
  const next = new Map(byBlock)
  next.set(blockId, sortByTime(messages || []))
  byBlock = next
  emit()
}

/**
 * Put a message on screen before the server has confirmed it.
 *
 * Typing into a chat and waiting 300ms for your own words to appear is the
 * single most noticeable latency in any messaging UI. The optimistic row
 * carries `pending: true` so the renderer can dim it, and is replaced wholesale
 * by the next `setThread` — which is why this never has to reconcile ids.
 */
export function addPending(blockId, message) {
  if (!blockId || !message?.id) return
  const list = byBlock.get(blockId) || []
  const next = new Map(byBlock)
  next.set(blockId, sortByTime([...list, { ...message, pending: true }]))
  byBlock = next
  emit()
}

/** Drop an optimistic row whose write failed, so it does not sit there lying. */
export function dropPending(blockId, id) {
  const list = byBlock.get(blockId)
  if (!list) return
  const next = new Map(byBlock)
  next.set(blockId, list.filter(m => m.id !== id))
  byBlock = next
  emit()
}

export function threadFor(blockId) { return byBlock.get(blockId) || [] }

export function clearThreads() {
  byBlock = new Map()
  people = new Map()
  emit()
}

export function setPeople(map) {
  if (!map) return
  people = new Map([...people, ...map])
  emit()
}

export function knownPerson(uuid) { return people.get(uuid) }
export function hasPerson(uuid) { return people.has(uuid) }

function sortByTime(list) {
  return [...list].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
}

/* ── who said it ──────────────────────────────────────────────────────────*/

/** Is this mine? Drives alignment and whether an edit affordance is offered. */
export function isMine(msg) {
  const me = accountSnapshot()?.userId
  return !!me && !!msg?.author_id && msg.author_id === me
}

/**
 * A name for the person who wrote this.
 *
 * "Someone" rather than a uuid for an unresolved author, and rather than
 * "Unknown", which reads like an error. An author_id of null is a real state —
 * 0009 sets it when an account is deleted — and it means the words stay while
 * the name goes, which is the honest outcome.
 */
export function authorLabel(msg) {
  if (!msg) return ''
  if (isMine(msg)) return 'You'
  if (!msg.author_id) return 'Someone'
  return people.get(msg.author_id) || 'Someone'
}

/** The colour for this author, from the same function the block flags use. */
export function authorHue(msg) {
  return msg?.author_id ? personHue(msg.author_id) : 210
}

/* ── time ─────────────────────────────────────────────────────────────────*/

/**
 * The clock, at the precision a reader actually wants.
 *
 * Today gets a time, this week gets a weekday, anything older gets a date. A
 * bare timestamp on every line is noise; "3 days ago" on a message somebody
 * needs to quote in an email is worse than useless.
 */
export function timeLabel(iso, now = Date.now()) {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const d = new Date(t)
  const age = now - t
  const sameDay = new Date(now).toDateString() === d.toDateString()
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (age < 6 * 864e5) {
    return `${d.toLocaleDateString([], { weekday: 'short' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  }
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

/* ── grouping ─────────────────────────────────────────────────────────────*/

/** Messages closer together than this, from one person, read as one run. */
export const GROUP_WINDOW_MS = 5 * 60 * 1000

/**
 * Annotate each message with whether it opens a visual run.
 *
 * Returns NEW objects rather than mutating, so the store stays the single
 * source of truth and a re-render cannot accumulate presentation flags onto
 * rows that will later be replaced by a fetch.
 */
export function groupThread(messages) {
  const out = []
  let prev = null
  for (const m of messages || []) {
    const sameAuthor = prev && prev.author_id === m.author_id
    const close = prev && (Date.parse(m.created_at) - Date.parse(prev.created_at)) < GROUP_WINDOW_MS
    out.push({ ...m, startsRun: !(sameAuthor && close) })
    prev = m
  }
  return out
}

/* ── what a message is ────────────────────────────────────────────────────*/

export function isUnsent(msg) { return !!msg?.deleted_at }
export function wasEdited(msg) { return !!msg?.edited_at && !msg?.deleted_at }
export function carriesBlock(msg) { return !!msg?.ref_block_id && !msg?.deleted_at }

/**
 * What to show where an unsent message was.
 *
 * The row stays — 0009 tombstones rather than deletes, so the conversation
 * above and below it still reads as a sequence. Removing it entirely would
 * silently rewrite history, which is the one thing a thread must not do.
 */
export const UNSENT_TEXT = 'Message unsent'

/** Draft validation, so the composer can refuse before the server has to. */
export const MAX_BODY = 4000

export function draftProblem(text) {
  const t = String(text || '')
  if (!t.trim()) return 'empty'
  if (t.length > MAX_BODY) return `${t.length - MAX_BODY} characters too long`
  return null
}

/* Test seams, matching lib/attribution.js's `_setAttribution`. */
export const _setThread = setThread
export const _setPeople = setPeople
