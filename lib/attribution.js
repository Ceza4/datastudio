/*
  lib/attribution.js
  --------------------------------------------------------------------------
  WHO LAST CHANGED THIS BLOCK.

  Reads the `blocks` projection added in migration 0007. Every row there is
  written by a SECURITY DEFINER trigger from `auth.uid()`, so the answer this
  module reports is the server's, not a claim the client is repeating. That is
  the entire point of the exercise: an attribution flag that can be forged is
  worse than no flag, because it is a false statement about a colleague
  rendered in the UI as fact.

  ── WHAT THIS FILE IS CAREFUL ABOUT ────────────────────────────────────────

  1. YOUR OWN EDITS DO NOT GET A FLAG. A marker on every block you have ever
     touched is not information, it is confetti — and it buries the one case
     the feature exists for. `attributionFor` returns null for your own
     changes; the UI never has to remember to filter.

  2. NULL MEANS "WE DO NOT KNOW", AND SAYS SO BY SAYING NOTHING. Migration
     0007's backfill deliberately leaves `edited_by` NULL for work that
     predates attribution rather than guessing the owner. Unknown renders as
     no flag.

  3. IT IS A CACHE, AND IT IS ALLOWED TO BE EMPTY. Attribution is decoration
     on top of a local-first app that must work with no network at all. If
     nothing ever fills this map, the canvas renders exactly as it did before
     the feature existed.

  ── WHY THIS IS SPLIT FROM lib/blocks.js ───────────────────────────────────

  It was one file, and importing it from BlockHandle pulled the Supabase client
  into a block header's dependency graph — which the browser harness caught
  immediately and loudly, with `process is not defined`, because
  supabaseClient.js reads process.env at module scope and only Next inlines
  that.

  The error was a test problem; the coupling it exposed was not. A component
  that draws a coloured dot has no business being unable to render without the
  network layer being loadable. So the pure half — the map, the subscribers,
  the "is this mine" rule and the formatting — lives here and imports nothing
  that talks to a server. lib/blocks.js does the fetching and writes into this.
  -------------------------------------------------------------------------- */

import { accountSnapshot } from './limits.js'
import { stablePick } from './theme.js'

/** blockId → { by, at, name } */
let byBlock = new Map()
const listeners = new Set()

/* Display names for the people in the current organisation, resolved once per
   fetch. A uuid in a tooltip is not an answer to "who changed this". */
let people = new Map()

function emit() {
  for (const fn of listeners) { try { fn(byBlock) } catch { /* a bad listener is not our problem */ } }
}

/** Subscribe to attribution changes. Returns the unsubscribe. */
export function onAttribution(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * What to show against a block, or null for nothing.
 *
 * Null on every one of these, deliberately:
 *   · no row (never synced, or a local-only workspace)
 *   · edited_by is null (predates attribution — see 0007's backfill)
 *   · the editor is you
 */
export function attributionFor(blockId) {
  const row = byBlock.get(blockId)
  if (!row || !row.by) return null
  const me = accountSnapshot().userId
  if (me && row.by === me) return null
  return row
}

/** The whole map, for a consumer that would otherwise call the above in a loop. */
export function attributionMap() { return byBlock }

/** Forget everything. Called on sign-out: attribution is per-account. */
export function clearAttribution() {
  byBlock = new Map()
  people = new Map()
  emit()
}

/* A STABLE COLOUR PER PERSON.

   Hashed from the uuid, never random and never assigned in arrival order: the
   dot has to be the same colour on every device and after every reload, or it
   stops being a recognition cue and becomes decoration that changes.

   These eight are the drawing swatches from lib/theme.js, chosen there because
   every one clears 3.8:1 against BOTH canvas grounds — so a flag is legible in
   light and dark without a per-theme table. Reusing them rather than inventing
   a second palette is also why a person's dot matches the colour their ink
   would be. */
export const HUES = ['#1D9E75', '#5B5FE8', '#C0392B', '#8A6410', '#2A8331', '#7C6FF0', '#B84A8A', '#1B7F9E']

/* THE HASH ITSELF NOW LIVES IN lib/theme.js.

   It was inline here, and then the calendar sidebar needed the same "stable
   colour from a stable key" behaviour for its source calendars. A second copy
   of a hash function is a second copy that can drift — and a drifted hash
   means one id rendering as two different colours in two parts of the UI,
   which is the single failure a stable-identity-colour system cannot survive.
   theme.js owns it (next to the palettes it indexes into) and both callers
   import it. The FNV-1a-vs-multiply-by-31 reasoning moved with it.

   TWO PEOPLE CAN STILL SHARE A COLOUR, and no hash fixes that: eight buckets
   means a collision is likely in any group of four or more. That is why the
   flag renders the dot AND the name — colour is a recognition shortcut, never
   the thing carrying the meaning. */
export function personHue(uuid) {
  return stablePick(uuid, HUES)
}

/** "Mara changed this" / "Someone changed this" — the whole label. */
export function attributionLabel(row) {
  if (!row) return ''
  return `${row.name || 'Someone'} changed this`
}

/* Written by lib/blocks.js once a fetch returns, and by the test seam. Kept
   here so the map has exactly one owner. */
export function setAttribution(map, names) {
  byBlock = new Map(map || [])
  if (names) for (const [k, v] of names) people.set(k, v)
  emit()
}

export function knownPerson(uuid) { return people.get(uuid) }
export function hasPerson(uuid) { return people.has(uuid) }

/* Test seam. Same function; the alias keeps the suite honest about intent. */
export const _setAttribution = setAttribution
