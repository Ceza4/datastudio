/*
  lib/presence.js
  --------------------------------------------------------------------------
  WHO IS IN THIS BLOCK RIGHT NOW.

  A sibling of lib/attribution.js, deliberately not a part of it. They answer
  two different questions from two different sources:

    attribution.js   who last CHANGED this      · the `blocks` projection,
                                                  stamped by a SECURITY DEFINER
                                                  trigger, durable
    presence.js      who is HERE now             · a Realtime signal, ephemeral,
                                                  gone the moment they leave

  Same shape, same identity colour (personHue is imported, not re-derived — one
  colour system app-wide), different tense, different lifetime. Merging them
  into one map would mean one of the two lying about the other's freshness.

  ── THE ESCALATION MODEL, AND THE TENSION IT RESOLVES ──────────────────────

  BlockHandle.js states a principle about attribution chrome, and it is right:
  "It is not a border, a glow or a tint on the block. Every one of those fights
  the block's own content for the same pixels... a data tool whose tables change
  colour because somebody edited them is a tool that has made attribution more
  important than data."

  Live presence is a stronger signal than historical attribution — two people
  typing into the same block right now is a real conflict risk, not merely a
  fact worth knowing — so it earns more weight than a static dot. But applying a
  glow to every block anyone merely has open reintroduces exactly the chrome the
  app argued against, for the common case where there is no risk at all.

  So it ESCALATES. Three states:

    A. IDLE ATTRIBUTION   nobody is here. attribution.js's dot, unchanged. This
                          module returns nothing and that code path is untouched.

    B. LIVE CO-PRESENCE   somebody else is here, you are not. The SAME dot idiom
                          in the SAME header slot — live trumps historical, and
                          they compete for one piece of chrome — plus one thing:
                          the dot pulses. That single piece of motion is the
                          whole difference between "live" and "historical",
                          without changing the idiom. No border. No glow.

    C. ESCALATED          you focus a block somebody else is already in. NOW the
                          ring and the ambient glow, in THAT PERSON'S hue —
                          because two collaborators glowing two blocks in one
                          fixed lavender would be indistinguishable, exactly as
                          their attribution dots would be. Additive: state B's
                          pulsing dot and label stay.

  ── WHAT IS NOT HERE ───────────────────────────────────────────────────────

  The transport. Nothing in this file talks to Supabase, opens a channel or
  sends a heartbeat — that is lib/sync.js's job and a separate piece of work.
  This is the store, the expiry rule, the state resolution and the formatting:
  the parts the UI needs and the parts worth testing without a network.

  Like attribution, IT IS ALLOWED TO BE EMPTY. If nothing ever writes into it,
  every block renders exactly as it did before presence existed.
  -------------------------------------------------------------------------- */

import { accountSnapshot } from './limits.js'
import { personHue } from './attribution.js'

/** blockId → { by, name, at } — `at` is the ms timestamp of their last signal. */
let byBlock = new Map()
const listeners = new Set()

/* HOW LONG A SIGNAL STAYS TRUE.

   Presence appears with no debounce — a Realtime "I opened this block" event is
   not rapid-fire, and delaying it only makes the app feel slow about the one
   thing it is trying to be honest about.

   It EXPIRES 3s after the last signal, which covers "closed the laptop
   mid-edit" as well as "moved to another block without telling us". 3s rather
   than the ~1s a first pass used, because 1s flickers on an ordinary typing
   pause: someone thinking about the next sentence is still in the block. */
export const PRESENCE_TTL_MS = 3000

/* The sweeper runs ONLY while there is something to expire. A permanent
   setInterval in a local-first app that may never see a collaborator is a
   wake-up every second forever for nothing. */
let sweepTimer = null

function emit() {
  for (const fn of listeners) { try { fn(byBlock) } catch { /* a bad listener is not our problem */ } }
}

function scheduleSweep() {
  if (sweepTimer || byBlock.size === 0) return
  sweepTimer = setInterval(() => {
    if (sweepStale()) emit()
    if (byBlock.size === 0) { clearInterval(sweepTimer); sweepTimer = null }
  }, 1000)
  /* Node's test runner would otherwise be held open by this handle. Browsers
     have no unref, hence the guard rather than a bare call. */
  if (typeof sweepTimer?.unref === 'function') sweepTimer.unref()
}

/** Drop expired rows. Returns whether anything was actually removed. */
function sweepStale(now = Date.now()) {
  let changed = false
  for (const [id, row] of byBlock) {
    if (now - (row.at || 0) > PRESENCE_TTL_MS) { byBlock.delete(id); changed = true }
  }
  return changed
}

/** Subscribe to presence changes. Returns the unsubscribe. */
export function onPresence(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * Somebody else is in this block, or null.
 *
 * Null on every one of these, deliberately — the UI never has to remember:
 *   · nobody there
 *   · the person there is YOU (your own caret does not need announcing, and a
 *     block that glows because you are in it is chrome with no information)
 *   · the signal has gone stale (see PRESENCE_TTL_MS)
 */
export function presenceFor(blockId, now = Date.now()) {
  const row = byBlock.get(blockId)
  if (!row || !row.by) return null
  if (now - (row.at || 0) > PRESENCE_TTL_MS) return null
  const me = accountSnapshot().userId
  if (me && row.by === me) return null
  return row
}

/** The whole map, for a consumer that would otherwise call the above in a loop. */
export function presenceMap() { return byBlock }

/**
 * Record that someone is in a block. Called by the transport layer.
 * `at` defaults to now, which is what a live signal means.
 */
export function markPresence(blockId, { by, name, at } = {}) {
  if (!blockId || !by) return
  byBlock.set(blockId, { by, name: name || null, at: at || Date.now() })
  scheduleSweep()
  emit()
}

/** They left, explicitly (rather than going quiet and expiring). */
export function clearPresenceFor(blockId) {
  if (byBlock.delete(blockId)) emit()
}

/** Forget everything. Called on sign-out: presence is per-account. */
export function clearPresence() {
  byBlock = new Map()
  if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null }
  emit()
}

/** Bulk write, mirroring setAttribution's shape so the transport can hand over
    a whole channel snapshot rather than looping markPresence. */
export function setPresence(map) {
  byBlock = new Map(map || [])
  if (byBlock.size > 0) scheduleSweep()
  emit()
}

/* PRESENT TENSE, and a separate function from attributionLabel on purpose.

   "Mara changed this" and "Mara is editing" are not the same sentence with a
   different verb — they are claims about different moments, from different
   sources, with different lifetimes. One function returning both would have to
   take a flag saying which, and a flag like that is where the two get confused. */
export function presenceLabel(row) {
  if (!row) return ''
  return `${row.name || 'Someone'} is editing`
}

/** Their identity colour. Re-exported through here so a component rendering
    presence never has to import attribution as well — the point is that it is
    the SAME function, not a parallel one. */
export function presenceHue(row) {
  return personHue(row?.by)
}

/* ── State C's ring ───────────────────────────────────────────────────────
   The escalation shadow, built in ONE place.

   Three layers in one box-shadow, and the order matters — shadows paint from
   first to last, so the hard ring has to come before the soft ones or the glow
   sits on top of it and muddies the edge:

     1. a 1.5px hard ring in the person's full hue. This stands in for
        "replace the block's border": drawing it as a shadow on the positioned
        WRAPPER rather than editing nine block types' own border declarations
        means one implementation instead of nine, and no chance of breaking a
        block type's existing chrome. Visually identical — it lands exactly on
        the block's edge.
     2. a 3px tight ring at 20% (hex 33).
     3. an 18px ambient glow at 15% (hex 26).

   The alpha suffixes assume a 6-digit hex, which every entry in HUES is. */
export function escalationRing(hue) {
  if (!hue) return 'none'
  return `0 0 0 1.5px ${hue}, 0 0 0 4.5px ${hue}33, 0 0 18px ${hue}26`
}

/* Test seams. Same functions; the aliases keep the suite honest about intent. */
export const _setPresence = setPresence
export const _sweepStale = sweepStale
