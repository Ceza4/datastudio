/*
  tests/dm.test.mjs — the pure half of lib/dm.js: who is in a thread, what it
  is called, unread totals, and reading email lists as people type them.
  Run: node tests/dm.test.mjs
*/
import { _setThreads, othersIn, threadLabel, directThreadWith, totalUnread, parseEmails } from '../lib/dm.js'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) { pass++; console.log('  ok  ', name) } else { fail++; console.log('  FAIL', name) } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const me = { key: 'm1', self: true, email: 'me@x.io', name: 'Me', joined: true, left: false }
const ana = { key: 'm2', self: false, email: 'ana@x.io', name: 'Ana', joined: true, left: false }
const ben = { key: 'm3', self: false, email: 'ben@x.io', name: null, joined: false, left: false }
const gone = { key: 'm4', self: false, email: 'old@x.io', name: 'Old', joined: true, left: true }

_setThreads([
  { id: 'thr_1', kind: 'direct', title: null, unread: 2, members: [me, ana] },
  { id: 'thr_2', kind: 'group', title: 'Launch', unread: 3, members: [me, ana, ben, gone] },
  { id: 'thr_3', kind: 'group', title: null, unread: 0, members: [me, ben] },
])

console.log('\n threads')
ok('others excludes me and people who left', eq(othersIn({ members: [me, ana, gone] }).map(m => m.key), ['m2']))
ok('a titled group is called by its title', threadLabel({ title: 'Launch', members: [me, ana] }) === 'Launch')
ok('an untitled thread is called by its people, invitees by address', threadLabel({ members: [me, ana, ben] }) === 'Ana, ben@x.io')
ok('a thread with only me says so', threadLabel({ members: [me] }) === 'Just you')
ok('the direct thread with an address is found, case-insensitively', directThreadWith('ANA@x.io')?.id === 'thr_1')
ok('a group is not a direct thread', directThreadWith('ben@x.io') === null)
ok('unread adds up across threads', totalUnread() === 5)

console.log('\n typing addresses')
ok('commas, spaces and semicolons all separate', eq(parseEmails('a@x.io, b@y.com; c@z.org  d@w.net').good, ['a@x.io', 'b@y.com', 'c@z.org', 'd@w.net']))
ok('duplicates collapse and case is folded', eq(parseEmails('A@x.io a@x.io').good, ['a@x.io']))
ok('what is not an address is reported, not dropped silently', eq(parseEmails('a@x.io, me, bob@').bad, ['me', 'bob@']))
ok('empty input is empty', eq(parseEmails('').good, []) && eq(parseEmails('').bad, []))

console.log(`\n ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
