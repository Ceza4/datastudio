/*
  tests/chat.test.mjs
  --------------------------------------------------------------------------
  The client half of the chat block (lib/chatstore.js) — migration 0009.

  The SERVER half is proven in supabase/test/03_chat_checks.sql, which runs as
  three different signed-in people and asserts the things that actually matter:
  that a stranger reads nothing, that a VIEWER on a shared sheet can reply,
  that author_id cannot be forged, that unsending takes the words off disk.
  None of that can be tested here and none of it should be.

  What IS the client's job:

    · grouping, which is presentation and must not leak into the data
    · saying "You" and "Someone" rather than a uuid
    · rebuilding a thread rather than merging it, so a message unsent on
      another device disappears here too
    · refusing a draft before the server has to
    · staying plain text — see the last block in this file
  -------------------------------------------------------------------------- */

import * as store from '../lib/chatstore.js'
import {
  setThread, addPending, dropPending, threadFor, clearThreads, onThread,
  groupThread, isMine, authorLabel, authorHue, timeLabel,
  isUnsent, wasEdited, carriesBlock, draftProblem, setPeople,
  GROUP_WINDOW_MS, MAX_BODY, UNSENT_TEXT,
} from '../lib/chatstore.js'
import { setAccount } from '../lib/limits.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}  (got ${JSON.stringify(a)})`)

const ME = '11111111-1111-1111-1111-111111111111'
const MARA = '22222222-2222-2222-2222-222222222222'
const BLK = 'blk_chat'

const at = (min) => new Date(Date.UTC(2026, 8, 7, 12, min, 0)).toISOString()
const msg = (over) => ({
  id: 'm1', block_id: BLK, author_id: MARA, body: 'hello',
  ref_block_id: null, ref_share_id: null,
  created_at: at(0), edited_at: null, deleted_at: null, ...over,
})

setAccount({ signedIn: true, userId: ME })

console.log('\n  the thread rebuilds rather than merges')
{
  clearThreads()
  setThread(BLK, [msg({ id: 'a' }), msg({ id: 'b', created_at: at(1) })])
  eq(threadFor(BLK).length, 2, 'two messages in')
  setThread(BLK, [msg({ id: 'a' })])
  eq(threadFor(BLK).length, 1,
     'a message unsent on another device DISAPPEARS — a merge would leave it in the thread for the rest of the session')
  eq(threadFor('blk_other'), [], 'an unknown thread is empty, never undefined')

  setThread(BLK, [msg({ id: 'late', created_at: at(5) }), msg({ id: 'early', created_at: at(1) })])
  eq(threadFor(BLK).map(m => m.id), ['early', 'late'],
     'messages are ordered by time on the way in, so the renderer never has to sort')
}

console.log('\n  optimistic rows')
{
  clearThreads()
  setThread(BLK, [msg({ id: 'a' })])
  addPending(BLK, msg({ id: 'p', author_id: ME, created_at: at(9), body: 'sending…' }))
  eq(threadFor(BLK).length, 2, 'a pending message shows immediately')
  ok(threadFor(BLK).find(m => m.id === 'p')?.pending === true,
     'and is marked pending, so the renderer can dim it rather than lying about it being sent')
  dropPending(BLK, 'p')
  eq(threadFor(BLK).length, 1,
     'a failed send removes its own row — a message that appears, stays, and was never sent is worse than a slow one')
  dropPending('blk_nothing', 'p')
  ok(true, 'dropping from a thread that does not exist is a no-op, not a throw')
}

console.log('\n  grouping is presentation, computed fresh every time')
{
  const rows = [
    msg({ id: '1', author_id: MARA, created_at: at(0) }),
    msg({ id: '2', author_id: MARA, created_at: at(1) }),
    msg({ id: '3', author_id: ME,   created_at: at(2) }),
    msg({ id: '4', author_id: MARA, created_at: at(30) }),
  ]
  const g = groupThread(rows)
  eq(g.map(m => m.startsRun), [true, false, true, true],
     'a run opens on a new author or after a gap, and the second message of a run does not')
  ok(rows.every(r => !('startsRun' in r)),
     'the source rows are NOT mutated — storing "isFirstOfRun" would make a message look different depending on when it was fetched')
  eq(groupThread([]), [], 'an empty thread groups to nothing')
  eq(groupThread(null), [], 'and so does no thread at all')
  ok(GROUP_WINDOW_MS === 5 * 60 * 1000, 'the run window is five minutes')
}

console.log('\n  who said it')
{
  ok(isMine(msg({ author_id: ME })), 'my message is mine')
  ok(!isMine(msg({ author_id: MARA })), "and somebody else's is not")
  ok(!isMine(msg({ author_id: null })), 'an unattributed message is nobody\'s')
  eq(authorLabel(msg({ author_id: ME })), 'You', 'my own name is "You"')
  eq(authorLabel(msg({ author_id: MARA })), 'Someone',
     'an unresolved colleague is "Someone" — never a uuid, and never "Unknown", which reads like an error')
  setPeople(new Map([[MARA, 'Mara']]))
  eq(authorLabel(msg({ author_id: MARA })), 'Mara', 'once resolved, they have their name')
  eq(authorLabel(msg({ author_id: null })), 'Someone',
     'and a deleted account leaves the words with no name, which is the honest outcome')
  eq(authorLabel(null), '', 'no message, no label')

  ok(authorHue(msg({ author_id: MARA })) === authorHue(msg({ author_id: MARA })),
     'a person has one colour')
  ok(Number.isFinite(authorHue(msg({ author_id: null }))),
     'and an unattributed message still gets a number rather than NaN')
}

console.log('\n  what a message is')
{
  ok(isUnsent(msg({ deleted_at: at(3) })), 'a tombstoned message reads as unsent')
  ok(!wasEdited(msg({ edited_at: at(3), deleted_at: at(4) })),
     'an unsent message does not also advertise that it was edited — the text is gone either way')
  ok(wasEdited(msg({ edited_at: at(3) })), 'an edited live message does')
  ok(carriesBlock(msg({ ref_block_id: 'blk_x' })), 'a message can carry a block')
  ok(!carriesBlock(msg({ ref_block_id: 'blk_x', deleted_at: at(3) })),
     'but an unsent one carries nothing')
  ok(/unsent/i.test(UNSENT_TEXT), 'and says so where it used to be')
}

console.log('\n  the clock, at the precision a reader wants')
{
  const now = Date.UTC(2026, 8, 7, 18, 0, 0)
  ok(/\d/.test(timeLabel(at(0), now)), 'today gets a time')
  const wk = new Date(Date.UTC(2026, 8, 5, 12, 0, 0)).toISOString()
  ok(timeLabel(wk, now).length > 0, 'this week gets a weekday and a time')
  const old = new Date(Date.UTC(2026, 5, 1, 12, 0, 0)).toISOString()
  ok(!/:/.test(timeLabel(old, now)),
     'and something months old gets a date with no clock — a bare timestamp on every line is noise')
  eq(timeLabel(null), '', 'no time, no label')
  eq(timeLabel('not a date'), '', 'and an unparseable one does not render "Invalid Date" at somebody')
}

console.log('\n  the composer refuses before the server has to')
{
  eq(draftProblem(''), 'empty', 'an empty draft is not an error, it is just not ready')
  eq(draftProblem('   '), 'empty', 'and neither is whitespace')
  eq(draftProblem('hello'), null, 'a real message is fine')
  ok(/2 characters too long/.test(draftProblem('x'.repeat(MAX_BODY + 2))),
     'and one over the limit says by how much, so the fix is obvious')
  ok(MAX_BODY === 4000, 'the limit matches 0009 chat_body_len, or the server would refuse what the client accepted')
}

console.log('\n  subscribers')
{
  clearThreads()
  let fired = 0
  const off = onThread(() => { fired++ })
  setThread(BLK, [msg({})])
  ok(fired === 1, 'a change notifies')
  off()
  setThread(BLK, [msg({ id: 'again' })])
  ok(fired === 1, 'and unsubscribing stops it')
  ok(typeof onThread(null) === 'function', 'a non-function subscriber returns a no-op rather than throwing')
}

console.log('\n  the plain-text contract')
{
  /* 0009 stores `body` UNSANITISED, on the stated condition that nothing hands
     it to an HTML parser. This app has already shipped four sanitiser gaps; the
     day somebody adds `bodyHtml()` to make links clickable is the day a chat
     message becomes an XSS vector, and it will look like a small convenience
     at the time. This assertion is the tripwire. */
  const htmlish = Object.keys(store).filter(k => /html|markup|innerhtml|render/i.test(k))
  eq(htmlish, [],
     'lib/chatstore.js exports NOTHING html-shaped — 0009 stores body unsanitised on the promise it never meets a parser')
}

console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
