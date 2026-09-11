/*
  tests/presence.test.mjs
  --------------------------------------------------------------------------
  Live presence: the store, the expiry rule, and the escalation ring.

  The reason this is asserted rather than eyeballed: presence is the one signal
  in the app that must go AWAY on its own. A stale row is a colleague shown as
  editing a block they closed an hour ago, which is worse than showing nothing —
  it is a confident false statement about a person. So the TTL and the
  "your own presence is not presence" rule get real tests.

  Run: node tests/presence.test.mjs
  -------------------------------------------------------------------------- */

import {
  PRESENCE_TTL_MS, presenceFor, presenceMap, presenceLabel, presenceHue,
  markPresence, clearPresenceFor, clearPresence, setPresence, escalationRing,
  onPresence, _sweepStale,
} from '../lib/presence.js'
import { setAccount } from '../lib/limits.js'
import { personHue, HUES } from '../lib/attribution.js'

let pass = 0, fail = 0
const ok = (c, m, extra = '') => {
  if (c) { pass++; console.log('  ok   ' + m) }
  else { fail++; console.log(`  FAIL ${m}${extra ? '\n        ' + extra : ''}`) }
}

const ME = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'

/* ── the store ────────────────────────────────────────────────────────── */
console.log('\n markPresence / presenceFor')
{
  clearPresence()
  setAccount({ userId: ME, signedIn: true })

  ok(presenceFor('b1') === null, 'nothing there is null, not undefined')

  markPresence('b1', { by: OTHER, name: 'Mara' })
  const row = presenceFor('b1')
  ok(row && row.by === OTHER, 'somebody else in a block is reported')
  ok(row.name === 'Mara', '…with their name, because a uuid is not an answer to "who"')
  ok(typeof row.at === 'number', '…and a timestamp, which is what expiry hangs off')

  /* THE RULE THE UI NEVER HAS TO REMEMBER. A block that glows because YOU are
     in it is chrome carrying no information — and it would glow on every block
     you touched, which is exactly the confetti attribution.js avoids. */
  markPresence('b2', { by: ME, name: 'Me' })
  ok(presenceFor('b2') === null, 'your OWN presence is never reported as presence')
  ok(presenceMap().has('b2'), '…even though the raw map does hold it, so the transport can be dumb')

  markPresence('b3', {})
  ok(presenceFor('b3') === null, 'a row with no person is ignored rather than half-rendered')
  markPresence('', { by: OTHER })
  ok(presenceMap().has('') === false, 'a row with no block id is refused')
}

console.log('\n expiry')
{
  clearPresence()
  setAccount({ userId: ME, signedIn: true })
  const now = 1_000_000

  markPresence('b1', { by: OTHER, name: 'Mara', at: now })
  ok(presenceFor('b1', now) !== null, 'fresh at the moment of the signal')
  ok(presenceFor('b1', now + PRESENCE_TTL_MS - 1) !== null, 'still fresh just inside the window')
  /* Longer than the ~1s a first pass used, deliberately: 1s flickers on an
     ordinary typing pause, and somebody thinking about their next sentence is
     still in the block. */
  ok(PRESENCE_TTL_MS >= 3000, 'the window is at least 3s, so a normal typing pause does not flicker it')
  ok(presenceFor('b1', now + PRESENCE_TTL_MS + 1) === null,
     'gone past the window — this is what covers "closed the laptop mid-edit"')

  /* presenceFor reports expiry, and the sweeper is what actually reclaims it.
     Both matter: reporting alone would leave the map growing forever. */
  ok(presenceMap().has('b1'), 'an expired row is still in the map until swept')
  ok(_sweepStale(now + PRESENCE_TTL_MS + 1) === true, 'the sweeper removes it and says it did')
  ok(!presenceMap().has('b1'), '…so the map does not grow forever')
  ok(_sweepStale(now + PRESENCE_TTL_MS + 1) === false, 'sweeping again reports no change, so no needless repaint')
}

console.log('\n leaving')
{
  clearPresence()
  setAccount({ userId: ME, signedIn: true })
  markPresence('b1', { by: OTHER, name: 'Mara' })
  clearPresenceFor('b1')
  ok(presenceFor('b1') === null, 'leaving explicitly removes it immediately, without waiting for the TTL')

  markPresence('b9', { by: OTHER })
  clearPresence()
  ok(presenceMap().size === 0, 'clearPresence empties everything — presence is per-account')
}

console.log('\n setPresence — rebuilt, never merged')
{
  clearPresence()
  setAccount({ userId: ME, signedIn: true })
  setPresence(new Map([['b1', { by: OTHER, name: 'A', at: Date.now() }]]))
  ok(presenceFor('b1') !== null, 'a bulk snapshot lands')
  setPresence(new Map([['b2', { by: OTHER, name: 'B', at: Date.now() }]]))
  ok(presenceFor('b1') === null && presenceFor('b2') !== null,
     'a later snapshot REPLACES the earlier one — somebody who left must disappear, and a merge leaves them forever')
  setPresence(null)
  ok(presenceMap().size === 0, 'a null snapshot is an empty one, not a crash')
}

console.log('\n subscribers')
{
  clearPresence()
  setAccount({ userId: ME, signedIn: true })
  let calls = 0
  const off = onPresence(() => { calls += 1 })
  markPresence('b1', { by: OTHER })
  ok(calls === 1, 'a write notifies')
  off()
  markPresence('b1', { by: OTHER })
  ok(calls === 1, 'unsubscribing stops it')

  /* A listener that throws must not stop the others — the same guarantee
     attribution.js gives, and for the same reason: one bad consumer must not
     take down every block's presence flag. */
  let good = 0
  const offBad = onPresence(() => { throw new Error('bad listener') })
  const offGood = onPresence(() => { good += 1 })
  markPresence('b2', { by: OTHER })
  ok(good === 1, 'a throwing listener does not prevent the next one running')
  offBad(); offGood()
}

/* ── identity colour ──────────────────────────────────────────────────── */
console.log('\n presenceHue')
{
  ok(presenceHue({ by: OTHER }) === personHue(OTHER),
     'presence uses the SAME identity colour as attribution — one system app-wide, not two palettes')
  ok(HUES.includes(presenceHue({ by: OTHER })), 'and it comes from the shared HUES palette')
  ok(presenceHue(null) === personHue(undefined), 'a missing row still yields a stable colour rather than undefined')
  ok(presenceHue({ by: OTHER }) === presenceHue({ by: OTHER }), 'stable across calls — the whole point of hashing')
}

console.log('\n presenceLabel')
ok(presenceLabel({ name: 'Mara' }) === 'Mara is editing',
   'PRESENT tense — a different claim from attributionLabel’s "changed this", which is why it is a different function')
ok(presenceLabel({}) === 'Someone is editing', 'an unknown person still reads as a sentence')
ok(presenceLabel(null) === '', 'no row, no label')

/* ── the escalation ring ──────────────────────────────────────────────── */
console.log('\n escalationRing')
{
  const r = escalationRing('#1D9E75')
  ok(r.split(',').length === 3, 'three layers: a hard ring, a tight ring and an ambient glow')
  ok(r.startsWith('0 0 0 1.5px #1D9E75'),
     'the HARD ring is first — shadows paint in order, and a glow drawn over the edge muddies it')
  ok(r.includes('#1D9E7533') && r.includes('#1D9E7526'), 'the soft layers carry alpha suffixes on the same hue')
  ok(escalationRing(null) === 'none', 'no hue, no shadow — never the string "undefined33"')
  /* Person-hued, not one fixed colour: two collaborators glowing two blocks in
     one lavender would be indistinguishable, exactly as their dots would be. */
  ok(escalationRing(personHue(ME)) !== escalationRing(personHue(OTHER)) || personHue(ME) === personHue(OTHER),
     'different people produce different rings unless their hues genuinely collide')
}

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
