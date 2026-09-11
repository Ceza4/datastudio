/*
  tests/blocks.test.mjs
  --------------------------------------------------------------------------
  Block attribution (lib/blocks.js) — the read side of migration 0007.

  The server half is tested in supabase/test/01_repair_checks.sql, checks 21-23:
  that a save re-attributes only the blocks it actually changed, that a client
  cannot write to the table at all, and that block rows do not outlive their
  document. This file covers what the CLIENT decides, which is entirely about
  what NOT to show:

    · your own edits              → no flag
    · edited_by null (pre-0007)   → no flag
    · a block with no row         → no flag

  Those three are the whole feature. A flag on everything is confetti; a flag
  on something we cannot actually attribute is a lie.
  -------------------------------------------------------------------------- */

import {
  attributionFor, attributionLabel, attributionMap, clearAttribution,
  onAttribution, personHue, _setAttribution,
} from '../lib/attribution.js'
import { fetchAttribution } from '../lib/blocks.js'
import { setAccount } from '../lib/limits.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}  (got ${JSON.stringify(a)})`)

const ME = '11111111-1111-1111-1111-111111111111'
const MARA = '22222222-2222-2222-2222-222222222222'

console.log('\n  what earns a flag, and what does not')
{
  setAccount({ signedIn: true, userId: ME })
  _setAttribution([
    ['blk_mine',    { by: ME,   at: '2026-08-27T10:00:00Z', name: 'Matas' }],
    ['blk_theirs',  { by: MARA, at: '2026-08-27T11:00:00Z', name: 'Mara' }],
    ['blk_unknown', { by: null, at: '2026-08-27T09:00:00Z', name: null }],
  ])

  ok(attributionFor('blk_mine') === null,
     'YOUR OWN edit gets no flag — a marker on every block you have touched is confetti, and it buries the case the feature exists for')
  ok(attributionFor('blk_theirs') !== null, "somebody else's edit does")
  eq(attributionFor('blk_theirs').name, 'Mara', 'and carries their name')
  ok(attributionFor('blk_unknown') === null,
     'a row with no editor gets no flag — 0007 backfills NULL rather than guessing an owner, and unknown must render as nothing')
  ok(attributionFor('blk_absent') === null, 'and a block with no row at all is silent')
}

console.log('\n  signed out, or local-only')
{
  /* A workspace that has never synced has no rows, and an account snapshot
     with no userId cannot tell your edits from anyone else's. The safe answer
     is to show the flag rather than to hide it: hiding would suppress a real
     colleague's change, showing at worst labels your own edit with your own
     name. */
  setAccount({ signedIn: false })
  ok(attributionFor('blk_theirs') !== null,
     'with no known user, a stamped row still reports — hiding it would suppress a real change')
  clearAttribution()
  eq(attributionMap().size, 0, 'clearAttribution empties the map, so an account switch cannot carry a colleague into a stranger\'s workspace')
}

console.log('\n  the fetch degrades instead of throwing')
{
  const res = await fetchAttribution(['nb1'], { client: null })
  eq(res.ok, false, 'no client is a refusal')
  eq(res.reason, 'unconfigured', 'and names the reason')
  eq((await fetchAttribution([], { client: null })).ok, true,
     'nothing to ask for short-circuits before it looks for a client')

  const exploding = { from: () => { throw new Error('boom') } }
  const bad = await fetchAttribution(['nb1'], { client: exploding })
  eq(bad.ok, false, 'a broken client is a status, never an exception into the pull')
  /* This matters more than it looks: fetchAttribution is called from lib/sync's
     pull. If it threw, decoration would be able to fail a document sync. */
  ok(attributionMap().size === 0, 'and it leaves the previous map alone rather than half-writing one')
}

console.log('\n  reading is chunked, and rebuilt rather than merged')
{
  const asked = []
  const client = {
    from: table => ({
      select: () => ({
        in: (_col, ids) => {
          asked.push({ table, n: ids.length })
          const chain = {
            not: () => Promise.resolve({
              data: ids.map((id, i) => ({ id: 'blk_' + id, doc_id: id, edited_by: MARA, edited_at: '2026-08-27T12:0' + (i % 10) + ':00Z' })),
              error: null,
            }),
            then: (r) => r({ data: [{ id: MARA, display_name: null, email: 'mara@example.com' }], error: null }),
          }
          return chain
        },
      }),
    }),
  }
  const many = Array.from({ length: 120 }, (_, i) => 'nb' + i)
  const res = await fetchAttribution(many, { client })
  ok(res.ok, 'a large workspace fetches')
  const blockAsks = asked.filter(a => a.table === 'blocks')
  eq(blockAsks.map(a => a.n), [50, 50, 20],
     'in chunks of 50 — PostgREST puts `in.(...)` in the QUERY STRING, and a few hundred ids there is a 414 that reads like nothing at all')
  eq(attributionMap().size, 120, 'every document contributes its block')

  setAccount({ signedIn: true, userId: ME })
  eq(attributionFor('blk_nb0').name, 'mara',
     'an unnamed profile falls back to the local part of the email, never the whole address')

  /* A block whose row has gone must lose its flag. A merge would leave it on
     screen forever. */
  await fetchAttribution(['nb0'], { client })
  eq(attributionMap().size, 1, 'a later fetch REPLACES the map rather than merging into it')
}

console.log('\n  the dot is stable, and the label is a sentence')
{
  eq(personHue(MARA), personHue(MARA), 'a person keeps their colour across calls')
  ok(/^#[0-9A-F]{6}$/i.test(personHue('anything')), 'always a usable hex')
  eq(personHue(''), personHue(null), 'a missing id is not a crash')

  /* NOT "two people always differ" — with eight hues they cannot be guaranteed
     to, and asserting it would be asserting something the design does not
     promise. The dot is a recognition shortcut; the NAME beside it is what
     carries the meaning. See personHue's note.

     What IS worth holding: ids that differ in a narrow band of characters must
     not pile into one bucket. `h * 31 + c` put 1111…-1111 and 2222…-2222 in
     the same one, which is exactly the shape of a set of test accounts. */
  ok(personHue(MARA) !== personHue(ME),
     'two uuids differing only in a repeated digit land in different buckets — the old multiply-by-31 hash collided here')
  {
    const buckets = new Map()
    for (let i = 0; i < 400; i++) {
      const id = `${String(i).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`
      const h = personHue(id)
      buckets.set(h, (buckets.get(h) || 0) + 1)
    }
    eq(buckets.size, 8, 'all eight hues are reachable')
    const biggest = Math.max(...buckets.values())
    ok(biggest < 400 * 0.22,
       `no hue takes more than ~a fifth of 400 sequential ids (worst bucket ${biggest})`)
  }

  eq(attributionLabel({ by: MARA, name: 'Mara' }), 'Mara changed this', 'named')
  eq(attributionLabel({ by: MARA, name: null }), 'Someone changed this',
     'and an unresolvable person is "Someone", never a raw uuid on screen')
  eq(attributionLabel(null), '', 'nothing renders nothing')
}

console.log('\n  subscribers')
{
  let seen = 0
  const off = onAttribution(() => { seen++ })
  _setAttribution([['blk_a', { by: MARA, at: 'x', name: 'Mara' }]])
  eq(seen, 1, 'a change notifies')
  off()
  _setAttribution([])
  eq(seen, 1, 'and the unsubscribe stops it')

  const noisy = onAttribution(() => { throw new Error('bad listener') })
  let threw = false
  try { _setAttribution([]) } catch { threw = true }
  ok(!threw, 'one broken listener does not take the others down with it')
  noisy()
}

console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
