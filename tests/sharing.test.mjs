/*
  tests/sharing.test.mjs
  --------------------------------------------------------------------------
  The client half of sharing (lib/sharing.js) — migration 0008.

  The SERVER half is proven in supabase/test/02_sharing_checks.sql, which runs
  as two different signed-in people and asserts the things that actually
  matter: that a sheet grant does not hand over the project row, that revoking
  takes the mirrored bytes with it, that an editor's write lands in the
  owner's document. None of that can be tested here, and none of it should be
  — this file cannot decide access and must not look like it does.

  What IS the client's job, and is tested here:

    · building a payload that names ONLY the columns 0008 grants on INSERT.
      Naming org_id or grantee_id is a 42501, not a silently dropped field, so
      a helper that includes them turns every share into an error nobody can
      explain from the toast.
    · rebuilding the incoming map rather than merging it, so a grant revoked
      on another device disappears here instead of living forever.
    · not offering an edit affordance for a grant that does not carry one.
  -------------------------------------------------------------------------- */

import {
  LEVEL_PROJECT, LEVEL_SHEET, LEVEL_BLOCK,
  ROLE_VIEWER, ROLE_EDITOR, VIS_PRIVATE, VIS_ORG,
  POLICY_OPEN, POLICY_INTERNAL, POLICY_OFF,
  sharePayload, grantCoversBlock, canEditBlock, isShared, isIncoming,
  setOutgoing, setIncoming, setSharingPolicy, sharingPolicy,
  sharesFor, incomingShares, clearShares, onShares,
  shareLabel, roleLabel, levelNoun, visibilityLabel,
  shareBlockedReason, policyAllowsEmail,
} from '../lib/sharing.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}  (got ${JSON.stringify(a)})`)

const DOC = 'nb_1'
const grant = (over) => ({
  id: 'shr_x', org_id: 'org_1', doc_id: DOC, subject_kind: LEVEL_PROJECT,
  sheet_id: null, block_id: null, grantee_email: 'mara@example.com',
  role: ROLE_VIEWER, created_by: 'u_other', created_at: '2026-08-27T10:00:00Z',
  revoked_at: null, ...over,
})

console.log('\n  the payload names only what the database will accept')
{
  const p = sharePayload({ id: 'shr_1', docId: DOC, level: LEVEL_PROJECT, email: 'Mara@Example.com ' })
  eq(Object.keys(p).sort(), ['doc_id', 'grantee_email', 'id', 'role', 'subject_kind'],
     'a project share sends five columns and no more')
  ok(!('org_id' in p) && !('created_by' in p) && !('grantee_id' in p),
     'org_id, created_by and grantee_id are absent — naming them is a privilege error, not a dropped field')
  ok(p.grantee_email === 'mara@example.com',
     'the address is trimmed and lowercased, so two spellings are one grant and the unique index can do its job')
  ok(p.role === ROLE_VIEWER, 'a share with no role stated is view-only, never edit')

  const s = sharePayload({ id: 'shr_2', docId: DOC, level: LEVEL_SHEET, sheetId: 'sh_1', email: 'a@b.c', role: ROLE_EDITOR })
  ok(s.sheet_id === 'sh_1' && !('block_id' in s),
     'a sheet share carries sheet_id and omits block_id entirely — a null there violates 0008 shares_subject_shape')
  const b = sharePayload({ id: 'shr_3', docId: DOC, level: LEVEL_BLOCK, blockId: 'blk_1', email: 'a@b.c' })
  ok(b.block_id === 'blk_1' && !('sheet_id' in b), 'and a block share carries block_id and omits sheet_id')

  let threw = false
  try { sharePayload({ id: 'x', docId: DOC, level: LEVEL_SHEET, email: 'a@b.c' }) } catch { threw = true }
  ok(threw, 'a sheet share with no sheet is refused here, where the message can say so, rather than as a constraint name')

  threw = false
  try { sharePayload({ id: 'x', docId: DOC, level: 'everything', email: 'a@b.c' }) } catch { threw = true }
  ok(threw, 'an unknown level is refused')

  threw = false
  try { sharePayload({ id: 'x', level: LEVEL_PROJECT, email: 'a@b.c' }) } catch { threw = true }
  ok(threw, 'a share with no project is refused')
}

console.log('\n  which blocks a grant reaches — the mirror of my_shared_block_ids()')
{
  const at = { docId: DOC, sheetId: 'sh_1', blockId: 'blk_1' }
  ok(grantCoversBlock(grant({ subject_kind: LEVEL_PROJECT }), at), 'a project grant reaches every block in it')
  ok(grantCoversBlock(grant({ subject_kind: LEVEL_SHEET, sheet_id: 'sh_1' }), at), 'a sheet grant reaches its own sheet')
  ok(!grantCoversBlock(grant({ subject_kind: LEVEL_SHEET, sheet_id: 'sh_2' }), at), 'and stops at the sheet next to it')
  ok(grantCoversBlock(grant({ subject_kind: LEVEL_BLOCK, block_id: 'blk_1' }), at), 'a block grant reaches that block')
  ok(!grantCoversBlock(grant({ subject_kind: LEVEL_BLOCK, block_id: 'blk_9' }), at), 'and no other')
  ok(!grantCoversBlock(grant({ doc_id: 'nb_other' }), at), 'a grant on a different project reaches nothing here')
  ok(!grantCoversBlock(grant({ revoked_at: '2026-08-27T12:00:00Z' }), at), 'a revoked grant reaches nothing')
  ok(!grantCoversBlock(null, at), 'and neither does no grant at all')
}

console.log('\n  the edit affordance follows the grant, and excludes project grants')
{
  clearShares()
  setIncoming([
    grant({ id: 'g1', subject_kind: LEVEL_SHEET, sheet_id: 'sh_1', role: ROLE_EDITOR }),
    grant({ id: 'g2', subject_kind: LEVEL_SHEET, sheet_id: 'sh_2', role: ROLE_VIEWER }),
    grant({ id: 'g3', doc_id: 'nb_2', subject_kind: LEVEL_PROJECT, role: ROLE_EDITOR }),
  ])
  ok(canEditBlock({ docId: DOC, sheetId: 'sh_1', blockId: 'blk_1' }), 'an editor on a sheet may edit its blocks')
  ok(!canEditBlock({ docId: DOC, sheetId: 'sh_2', blockId: 'blk_2' }), 'a viewer on a sheet may not')
  ok(!canEditBlock({ docId: 'nb_2', sheetId: 'sh_x', blockId: 'blk_x' }),
     'a PROJECT editor gets no per-block write path — 0008 routes them through docs so one document never has two conflict rules')
}

console.log('\n  the store rebuilds rather than merges')
{
  clearShares()
  setIncoming([grant({ id: 'g1' }), grant({ id: 'g2', doc_id: 'nb_2' })])
  eq(incomingShares().length, 2, 'two grants in')
  setIncoming([grant({ id: 'g1' })])
  eq(incomingShares().length, 1,
     'a grant revoked on another device DISAPPEARS — a merge would leave it on screen forever, which is the one bug a sharing UI must not have')
  eq(incomingShares()[0].id, 'g1', 'and the survivor is the right one')

  setOutgoing(DOC, [grant({ id: 'o1' })])
  ok(isShared(DOC), 'a project with a live grant reads as shared')
  setOutgoing(DOC, [grant({ id: 'o1', revoked_at: '2026-08-27T12:00:00Z' })])
  ok(!isShared(DOC), 'and stops the moment the grant is revoked')
  setOutgoing(DOC, [])
  eq(sharesFor(DOC), [], 'an empty list removes the entry rather than leaving an empty array behind')
  ok(isIncoming(DOC), 'incoming and outgoing are separate questions and do not overwrite each other')
}

console.log('\n  subscribers')
{
  clearShares()
  let fired = 0
  const off = onShares(() => { fired++ })
  setOutgoing(DOC, [grant({})])
  ok(fired === 1, 'a change notifies')
  off()
  setOutgoing(DOC, [grant({ id: 'again' })])
  ok(fired === 1, 'and unsubscribing stops it')
  ok(typeof onShares(null) === 'function', 'a non-function subscriber returns a no-op unsubscribe rather than throwing')
}

console.log('\n  the workspace switch')
{
  clearShares()
  eq(sharingPolicy(), POLICY_OPEN, 'open by default, which is what every existing workspace already behaves like')
  setSharingPolicy(POLICY_OFF)
  ok(shareBlockedReason() !== null, 'with sharing off, the control explains itself')
  ok(/turned off/i.test(shareBlockedReason()),
     'and the sentence names the cause — a greyed-out button with no explanation is the commonest way a permission system gets reported as a bug')
  ok(!policyAllowsEmail('anyone@example.com'), 'off allows nobody')

  setSharingPolicy(POLICY_INTERNAL)
  ok(shareBlockedReason() === null, 'internal is not "blocked" — sharing still works, it just cannot leave')
  ok(policyAllowsEmail('mara@example.com', ['Mara@example.com']), 'a colleague passes, case-insensitively')
  ok(!policyAllowsEmail('outsider@example.com', ['mara@example.com']), 'a stranger does not')

  setSharingPolicy(POLICY_OPEN)
  ok(policyAllowsEmail('outsider@example.com', []), 'and open allows anybody')
  setSharingPolicy('nonsense')
  eq(sharingPolicy(), POLICY_OPEN, 'an unrecognised policy falls back to open rather than silently locking the workspace')
}

console.log('\n  words, from the reader\'s side of the screen')
{
  eq(roleLabel(ROLE_EDITOR), 'can edit', 'roles read as capabilities')
  eq(roleLabel(ROLE_VIEWER), 'can view', 'not as database values')
  eq(levelNoun(LEVEL_PROJECT), 'project', 'the user\'s word for a doc row is "project"')
  eq(levelNoun(LEVEL_SHEET), 'sheet', 'a sheet is a sheet')
  eq(levelNoun(LEVEL_BLOCK), 'block', 'and a block is a block')
  ok(/only me/i.test(visibilityLabel(VIS_PRIVATE)), 'private says who can see it, not what the column is set to')
  ok(/workspace/i.test(visibilityLabel(VIS_ORG)), 'and so does org')

  eq(shareLabel(grant({ subject_kind: LEVEL_SHEET, sheet_id: 'sh_1', role: ROLE_EDITOR }), { sh_1: 'Q3 numbers' }),
     'mara@example.com — Q3 numbers, can edit',
     'a share reads as the sheet the user named it')
  ok(/one sheet/.test(shareLabel(grant({ subject_kind: LEVEL_SHEET, sheet_id: 'sh_9' }))),
     'and falls back to a noun rather than printing an id nobody has ever seen')
  eq(shareLabel(null), '', 'no grant, no line')
}

console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
