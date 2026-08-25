/*
  tests/undo.test.mjs
  --------------------------------------------------------------------------
  The workspace undo stack (lib/undo.js).

  An undo system is one of the few features where a subtle bug is worse than
  no feature at all: it teaches people to trust a control that will eventually
  eat their work. So this leans hard on the awkward sequences — undo then edit,
  redo after a branch, coalescing across a boundary, the limit — rather than on
  the happy path.
  -------------------------------------------------------------------------- */

import {
  emptyHistory, record, undo, redo, canUndo, canRedo,
  shouldCoalesce, nextUndoLabel, nextRedoLabel, COALESCE_MS, HISTORY_LIMIT,
} from '../lib/undo.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}  (got ${JSON.stringify(a)})`)

/* Stand-in states. The real ones are `notebooks` arrays; all this cares about
   is identity. */
const S = n => ({ v: n })
let clock = 1000
const entry = (label, before, after, nbId = 'nb1', at = (clock += 5000)) =>
  ({ label, before, after, nbId, at, activeBefore: nbId, activeAfter: nbId })

console.log('\n  the basics')
{
  let h = emptyHistory()
  ok(!canUndo(h), 'a fresh history has nothing to undo')
  ok(!canRedo(h), 'and nothing to redo')
  ok(undo(h) === null, 'undo on an empty history returns null rather than throwing')
  ok(redo(h) === null, 'and so does redo')

  h = record(h, entry('move', S(1), S(2)))
  ok(canUndo(h), 'after one edit there is something to undo')
  const u = undo(h)
  eq(u.state, S(1), 'undo yields the state from before the edit')
  eq(u.label, 'move', 'and the label of what it reversed')
  ok(!canUndo(u.history), 'the stack is then empty')
  ok(canRedo(u.history), 'and the edit is available to redo')

  const r = redo(u.history)
  eq(r.state, S(2), 'redo yields the state after the edit')
  ok(canUndo(r.history) && !canRedo(r.history), 'and puts the entry back on the undo side')
}

console.log('\n  a new edit discards the redo branch')
{
  let h = emptyHistory()
  h = record(h, entry('move', S(1), S(2)))
  h = record(h, entry('resize', S(2), S(3)))
  h = undo(h).history
  ok(canRedo(h), 'after undoing there is a redo available')
  h = record(h, entry('delete', S(2), S(9)))
  ok(!canRedo(h), 'making a new edit discards it — the standard linear model')
  eq(undo(h).state, S(2), 'and undo now reverses the new edit')
}

console.log('\n  coalescing')
{
  ok(shouldCoalesce(entry('edit text', S(1), S(2), 'nb1', 1000),
                    entry('edit text', S(2), S(3), 'nb1', 1300)) === true,
    'two quick text edits merge')
  ok(shouldCoalesce(entry('edit text', S(1), S(2), 'nb1', 1000),
                    entry('edit text', S(2), S(3), 'nb1', 1000 + COALESCE_MS + 1)) === false,
    'the same two, far enough apart, do not')
  ok(shouldCoalesce(entry('edit text', S(1), S(2), 'nb1', 1000),
                    entry('move', S(2), S(3), 'nb1', 1100)) === false,
    'different labels never merge')
  ok(shouldCoalesce(entry('delete', S(1), S(2), 'nb1', 1000),
                    entry('delete', S(2), S(3), 'nb1', 1100)) === false,
    'two quick DELETES do not merge — a deletion is a decision, not a stream')
  ok(shouldCoalesce(entry('move', S(1), S(2), 'nb1', 1000),
                    entry('move', S(2), S(3), 'nb2', 1100)) === false,
    'edits in different notebooks never merge')
  ok(shouldCoalesce(null, entry('move', S(1), S(2))) === false, 'nothing to merge with is not a merge')
}

console.log('\n  coalescing keeps the OLDEST before')
{
  let h = emptyHistory()
  h = record(h, entry('edit text', S(1), S(2), 'nb1', 1000))
  h = record(h, entry('edit text', S(2), S(3), 'nb1', 1200))
  h = record(h, entry('edit text', S(3), S(4), 'nb1', 1400))
  eq(h.past.length, 1, 'three keystrokes in a row are one undo entry')
  eq(undo(h).state, S(1),
    'and undoing returns to before the FIRST of them — not to one keystroke ago')
}

console.log('\n  coalescing stops at a boundary')
{
  let h = emptyHistory()
  h = record(h, entry('edit text', S(1), S(2), 'nb1', 1000))
  h = record(h, entry('edit text', S(2), S(3), 'nb1', 1200))
  h = record(h, entry('delete', S(3), S(4), 'nb1', 1300))
  h = record(h, entry('edit text', S(4), S(5), 'nb1', 1400))
  eq(h.past.length, 3, 'typing, deleting, then typing again is three entries')
  const a = undo(h); eq(a.state, S(4), 'first undo reverses the later typing')
  const b = undo(a.history); eq(b.state, S(3), 'second undo reverses the delete')
  const c = undo(b.history); eq(c.state, S(1), 'third undo reverses the whole first run of typing')
}

console.log('\n  the limit')
{
  let h = emptyHistory(3)
  for (let i = 0; i < 5; i++) h = record(h, entry('delete', S(i), S(i + 1), 'nb1', 1000 + i * 5000))
  eq(h.past.length, 3, 'the stack is bounded')
  eq(h.past[0].before, S(2), 'and it is the OLDEST entries that fall off, not the newest')
  ok(HISTORY_LIMIT >= 50, `the real limit (${HISTORY_LIMIT}) is deep enough to be useful`)
}

console.log('\n  the open notebook is part of the state')
{
  /* THE REGRESSION THIS EXISTS FOR.

     Deleting your last notebook creates a stand-in and switches to it. If undo
     restores only `notebooks`, activeNotebookId is left naming a stand-in that
     is no longer in the array — getActiveNotebook() returns undefined, the
     canvas never mounts, and the user is looking at a blank screen with their
     work technically restored and invisible. */
  let h = emptyHistory()
  h = record(h, {
    label: 'delete', nbId: 'nbA', at: 1000,
    before: [{ id: 'nbA' }], after: [{ id: 'standIn' }],
    activeBefore: 'nbA', activeAfter: 'standIn',
  })
  const u = undo(h)
  eq(u.activeId, 'nbA', 'undo reports the notebook that was open BEFORE the change')
  ok(u.state.some(nb => nb.id === u.activeId),
    'and that notebook exists in the state it restores — otherwise the canvas has nothing to render')

  const r = redo(u.history)
  eq(r.activeId, 'standIn', 'redo reports the one that was open after')

  /* Cross-notebook: undoing an edit made elsewhere should say so. */
  let h2 = emptyHistory()
  h2 = record(h2, { label: 'move', nbId: 'nbA', at: 1000, before: [{ id: 'nbA' }], after: [{ id: 'nbA' }], activeBefore: 'nbA', activeAfter: 'nbA' })
  eq(undo(h2).activeId, 'nbA',
    'undoing an edit made in another notebook names that notebook, so the user is taken to what changed')
}

console.log('\n  coalescing keeps the oldest active id')
{
  let h = emptyHistory()
  h = record(h, { label: 'edit text', nbId: 'nb1', at: 1000, before: S(1), after: S(2), activeBefore: 'nbA', activeAfter: 'nbA' })
  h = record(h, { label: 'edit text', nbId: 'nb1', at: 1200, before: S(2), after: S(3), activeBefore: 'nbA', activeAfter: 'nbA' })
  eq(h.past[0].activeBefore, 'nbA', 'the merged entry keeps the earliest activeBefore, not the latest')
}

console.log('\n  labels')
{
  let h = emptyHistory()
  ok(nextUndoLabel(h) === null, 'no label when there is nothing to undo')
  h = record(h, entry('move', S(1), S(2)))
  eq(nextUndoLabel(h), 'move', 'the label of the next undo is available for a menu or a toast')
  const u = undo(h)
  eq(nextRedoLabel(u.history), 'move', 'and so is the next redo')
}

console.log('\n  nothing is mutated')
{
  const h0 = emptyHistory()
  const h1 = record(h0, entry('move', S(1), S(2)))
  ok(h0.past.length === 0, 'record leaves the original history untouched')
  const u = undo(h1)
  ok(h1.past.length === 1, 'undo leaves the original history untouched')
  ok(u.history !== h1, 'and returns a new one')
}

console.log('\n  a full round trip through a realistic sequence')
{
  let h = emptyHistory()
  const states = [S(0)]
  const steps = ['move', 'edit text', 'delete', 'resize', 'rename']
  steps.forEach((label, i) => {
    states.push(S(i + 1))
    h = record(h, entry(label, states[i], states[i + 1], 'nb1', 1000 + i * 5000))
  })
  let cur = states[states.length - 1]
  for (let i = steps.length - 1; i >= 0; i--) {
    const u = undo(h); h = u.history; cur = u.state
  }
  eq(cur, S(0), 'undoing everything returns to the starting state')
  for (let i = 0; i < steps.length; i++) {
    const r = redo(h); h = r.history; cur = r.state
  }
  eq(cur, S(5), 'and redoing everything returns to the end')
  ok(!canRedo(h), 'with nothing left to redo')
}

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
