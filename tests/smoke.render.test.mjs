/*
  tests/smoke.render.test.mjs
  --------------------------------------------------------------------------
  Renders every component once and asserts it doesn't throw.

  WHY
  Four bugs in a row were invisible to unit tests because they only appear
  when React renders. The sharpest was:

      Cannot access 'openExtract' before initialization

  — a hook dependency declared below the hook that used it. It isn't a lint
  error, isn't a type error, reads as two ordinary declarations, and the whole
  block was replaced by an error card that pointed at PDFs rather than at line
  ordering. Rendering the component once would have caught it instantly.

  SCOPE, HONESTLY
  react-dom/server runs the RENDER phase only. It does not run effects, do
  layout, or paint. So this catches:

    ✓ temporal dead zone errors
    ✓ reading a property of undefined during render
    ✓ bad destructuring of a missing prop
    ✓ a component that throws on its default/empty state
    ✓ hooks called conditionally (React throws)

  and it does NOT catch:

    ✗ effect ordering, refs, ResizeObserver          (needs a DOM)
    ✗ anything about layout or coordinates            (needs a browser engine)
    ✗ canvas rendering                                (needs a canvas)

  That's a real limit and it's worth being clear about rather than letting a
  green suite imply more than it proves. But the class it does cover is the
  one that produced the worst symptom, and it costs one render to check.

  Run: node --import ./tests/jsx-loader.mjs tests/smoke.render.test.mjs
  -------------------------------------------------------------------------- */

import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

let pass = 0, fail = 0
const ok = (c, m, extra = '') => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log(`  FAIL ${m}${extra ? '\n        ' + extra : ''}`)) }

/* Browser globals touched during render. Deliberately minimal: anything a
   component needs beyond this is arguably doing too much in the render phase. */
globalThis.window = globalThis.window || {
  devicePixelRatio: 1,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  getSelection: () => null,
  addEventListener() {}, removeEventListener() {},
}
/* Node 22 defines navigator as a getter-only global, so it can't be replaced.
   Only the property the components touch is added. */
if (!globalThis.navigator?.clipboard) {
  try {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: async () => {} }, configurable: true,
    })
  } catch { /* fine — nothing in the render phase reads it */ }
}
globalThis.ResizeObserver = globalThis.ResizeObserver || class { observe() {} disconnect() {} }

/* `typeof document === 'undefined'` is how the portalled components decide not
   to render on the server, so leaving document undefined exercises exactly the
   branch SSR takes — and keeps createPortal out of the picture. */

const COLORS = {
  base: '#12110F', surface: '#1B1A17', raised: '#232220', border: '#33312D',
  text: '#E8E6E1', text2: '#A8A49C', text3: '#6E6A63',
  accent: '#5B5FE8', accentDim: '#5B5FE822', red: '#f87171', green: '#1D9E75', amber: '#E8B85B',
}

const render = (Comp, props) => renderToStaticMarkup(createElement(Comp, props))

/** Render and report, capturing the message rather than aborting the run. */
function check(label, fn) {
  try {
    fn()
    ok(true, label)
  } catch (err) {
    ok(false, label, `${err?.name || 'Error'}: ${err?.message || err}`)
  }
}

/* ── block chrome ────────────────────────────────────────────────────── */
console.log('\n block chrome')
{
  const { default: BlockHandle } = await import('../components/notebook/BlockHandle.js')
  check('BlockHandle — plain', () => render(BlockHandle, {
    notebookId: 'nb1', block: { id: 'b1', type: 'text', name: 'X' }, label: 'text',
    colors: COLORS, onHeaderDragStart: () => {}, onDelete: () => {},
  }))
  check('BlockHandle — with provenance', () => render(BlockHandle, {
    notebookId: 'nb1', label: 'table', colors: COLORS,
    block: { id: 'b1', type: 'table', name: 'X', source: { type: 'pdf', pdfId: 'p1', page: 3 } },
    onHeaderDragStart: () => {}, onDelete: () => {}, onGoToSource: () => {},
  }))
  check('BlockHandle — no optional props at all', () => render(BlockHandle, {
    block: { id: 'b1', type: 'text' }, colors: COLORS,
    onHeaderDragStart: () => {}, onDelete: () => {},
  }))

  const { default: ResizeHandle } = await import('../components/notebook/ResizeHandle.js')
  check('ResizeHandle', () => render(ResizeHandle, {
    border: COLORS.border, accent: COLORS.accent, show: true, onResizeStart: () => {},
  }))

  const { default: BlockErrorBoundary } = await import('../components/notebook/BlockErrorBoundary.js')
  check('BlockErrorBoundary — passthrough', () => render(BlockErrorBoundary, {
    blockId: 'b1', blockType: 'text', width: 320, height: 200,
    children: createElement('div', null, 'ok'),
  }))
}

/* ── the PDF chain, where every recent bug lived ─────────────────────── */
console.log('\n pdf')
{
  const { default: PdfBlock } = await import('../components/notebook/PdfBlock.js')
  /* THE regression test for "Cannot access 'openExtract' before
     initialization". No document, so it renders its empty state — but the
     whole component body runs, which is where the TDZ error was thrown. */
  check('PdfBlock — no document (the TDZ regression)', () => render(PdfBlock, {
    block: { id: 'b1', type: 'pdf', w: 520, h: 620 }, colors: COLORS, dark: true,
    onUpdateBlock: () => {},
  }))
  check('PdfBlock — with a document id', () => render(PdfBlock, {
    block: { id: 'b1', type: 'pdf', pdfId: 'pdf_1', w: 520, h: 620, pdfPage: 3, pdfFit: 'page' },
    colors: COLORS, dark: false, onUpdateBlock: () => {}, tool: 'highlight',
    onEditState: () => {}, onExtract: () => {},
  }))

  const { default: PdfToolbar } = await import('../components/tools/PdfToolbar.js')
  check('PdfToolbar — no edit state', () => render(PdfToolbar, {
    block: { id: 'b1', name: 'Doc' }, colors: COLORS, dark: true,
  }))
  check('PdfToolbar — with edit state', () => render(PdfToolbar, {
    block: { id: 'b1', name: 'Doc' }, colors: COLORS, dark: true, tool: 'ink',
    editState: { count: 3, canUndo: true, canRedo: false, summary: '3 highlights', hasSelection: true },
  }))
  check('PdfToolbar — null block returns null', () => render(PdfToolbar, { block: null, colors: COLORS }))

  const { default: PdfAnnotationLayer } = await import('../components/notebook/PdfAnnotationLayer.js')
  const viewport = { width: 400, height: 600, scale: 1, transform: [1, 0, 0, -1, 0, 600] }
  check('PdfAnnotationLayer — empty', () => render(PdfAnnotationLayer, {
    viewport, page: 0, edits: [], tool: 'select', colors: COLORS, width: 400, height: 600,
  }))
  check('PdfAnnotationLayer — every edit kind at once', () => render(PdfAnnotationLayer, {
    viewport, page: 0, tool: 'select', colors: COLORS, width: 400, height: 600,
    edits: [
      { id: 'e1', kind: 'whiteout', page: 0, rect: { x: 10, y: 10, w: 50, h: 20 } },
      { id: 'e2', kind: 'highlight', page: 0, rect: { x: 10, y: 40, w: 50, h: 20 }, opacity: 0.35 },
      { id: 'e3', kind: 'text', page: 0, x: 10, y: 80, text: 'hello', size: 12 },
      { id: 'e4', kind: 'ink', page: 0, points: [{ x: 1, y: 1 }, { x: 5, y: 5 }], width: 2 },
      { id: 'e5', kind: 'replace', page: 0, x: 10, y: 100, size: 10, text: 'new', original: 'old',
        rect: { x: 10, y: 97, w: 40, h: 12 }, cover: '#fffdf5', color: '#000000' },
      /* Longer than the space it replaces even at the floor, so fitSize
         returns null and the overlay must draw the cover WITHOUT the text —
         which is what export does. Rendering the text here would promise
         something the saved file doesn't contain. */
      { id: 'e6', kind: 'replace', page: 0, x: 10, y: 120, size: 10, text: 'a'.repeat(200), original: 'old',
        rect: { x: 10, y: 117, w: 40, h: 12 }, cover: '#fffdf5' },
    ],
  }))
  /* The edit-text tool with a text layer, and with none — the second is a
     scan, and it must render a message rather than a dead page. */
  check('PdfAnnotationLayer — edit text, with runs', () => render(PdfAnnotationLayer, {
    viewport, page: 0, tool: 'edittext', colors: COLORS, width: 400, height: 600, edits: [],
    sampleCover: () => '#fffdf5',
    textRuns: [{
      index: 0, str: 'Invoice #4021', x: 72, baselineY: 700, size: 10, font: 'g_d0_f1', upright: true,
      rect: { x: 72, y: 697.6, w: 60, h: 12.4 },
    }],
  }))
  check('PdfAnnotationLayer — edit text, no text layer', () => render(PdfAnnotationLayer, {
    viewport, page: 0, tool: 'edittext', colors: COLORS, width: 400, height: 600, edits: [], textRuns: [],
  }))
  /* Malformed entries must not take the page down — a document written by a
     newer build has to open in an older one. */
  check('PdfAnnotationLayer — malformed edits', () => render(PdfAnnotationLayer, {
    viewport, page: 0, tool: 'select', colors: COLORS, width: 400, height: 600,
    edits: [
      { id: 'e1', kind: 'whiteout', page: 0 },                 // no rect
      { id: 'e2', kind: 'ink', page: 0, points: [] },           // no points
      { id: 'e3', kind: 'text', page: 0 },                      // no text
      { id: 'e4', kind: 'unknown-from-the-future', page: 0 },
    ],
  }))
}

/* ── rails and panels ────────────────────────────────────────────────── */
console.log('\n rails')
{
  const { default: SheetToolbar } = await import('../components/tools/SheetToolbar.js')
  check('SheetToolbar', () => render(SheetToolbar, {
    block: { id: 'b1', name: 'Sheet' }, colors: COLORS, dark: true, onOpenTool: () => {},
  }))
  check('SheetToolbar — null block', () => render(SheetToolbar, { block: null, colors: COLORS }))

  const { default: ImageToolbar } = await import('../components/tools/ImageToolbar.js')
  check('ImageToolbar', () => render(ImageToolbar, {
    block: { id: 'b1', name: 'Img', fit: 'contain' }, colors: COLORS, dark: true,
    onUpdateBlock: () => {}, onStartCrop: () => {}, onCancelCrop: () => {},
  }))

  const { default: BlockPicker } = await import('../components/notebook/BlockPicker.js')
  check('BlockPicker — returns null without a document', () => render(BlockPicker, {
    notebooks: [], colors: COLORS, onPick: () => {}, onCancel: () => {},
  }))

  const { default: PdfExtractPanel } = await import('../components/tools/PdfExtractPanel.js')
  check('PdfExtractPanel — returns null without a document', () => render(PdfExtractPanel, {
    items: [], pageNumber: 1, colors: COLORS, onExtract: () => {}, onClose: () => {},
  }))
}

/* ── blocks ──────────────────────────────────────────────────────────── */
console.log('\n blocks')
{
  const { default: KanbanBlock } = await import('../components/notebook/KanbanBlock.js')
  check('KanbanBlock — empty lanes', () => render(KanbanBlock, {
    block: { id: 'b1', lanes: [] }, colors: COLORS, dark: true,
    onUpdateBlock: () => {}, editingRef: { current: false },
  }))
  check('KanbanBlock — no lanes property at all', () => render(KanbanBlock, {
    block: { id: 'b1' }, colors: COLORS, dark: true,
    onUpdateBlock: () => {}, editingRef: { current: false },
  }))

  const { default: SlashMenu } = await import('../components/notebook/SlashMenu.js')
  check('SlashMenu — returns null without a document', () => render(SlashMenu, {
    x: 10, y: 10, filter: '', activeIdx: 0, colors: COLORS, onSelect: () => {},
  }))

  const { default: Icon } = await import('../components/ui/Icon.js')
  check('Icon — known name', () => render(Icon, { name: 'block-pdf', size: 16 }))
  check('Icon — unknown name renders a spacer', () => render(Icon, { name: 'does-not-exist' }))
}

/* ── tasks ───────────────────────────────────────────────────────────── */
console.log('\n tasks')
{
  const { default: TaskBlock } = await import('../components/notebook/TaskBlock.js')
  const t = (id, p = {}) => ({ id, type: 'task', title: id, status: 'todo', priority: 'med', ...p })

  check('TaskBlock — empty', () => render(TaskBlock, {
    block: { id: 'b1', type: 'task' }, blocks: [], connections: [],
    colors: COLORS, dark: true, onUpdateBlock: () => {},
  }))
  check('TaskBlock — every field set', () => render(TaskBlock, {
    block: t('b1', { title: 'Ship it', notes: 'and test it', deadline: '2026-08-20', priority: 'urgent', assignee: 'Matas' }),
    blocks: [], connections: [], colors: COLORS, dark: false,
    isSelected: true, onUpdateBlock: () => {},
  }))
  check('TaskBlock — overdue', () => render(TaskBlock, {
    block: t('b1', { deadline: '2020-01-01' }), blocks: [], connections: [],
    colors: COLORS, dark: true, onUpdateBlock: () => {},
  }))
  check('TaskBlock — done with a past deadline', () => render(TaskBlock, {
    block: t('b1', { deadline: '2020-01-01', status: 'done' }), blocks: [], connections: [],
    colors: COLORS, dark: true, onUpdateBlock: () => {},
  }))
  {
    const blocks = [t('a'), t('b')]
    const connections = [{ id: 'c1', fromBlockId: 'a', toBlockId: 'b', kind: 'blocks' }]
    check('TaskBlock — blocked, expanded', () => render(TaskBlock, {
      block: blocks[1], blocks, connections, colors: COLORS, dark: true,
      isSelected: true, onUpdateBlock: () => {}, onTeleport: () => {},
    }))
  }
  /* A connection pointing at a deleted block must not take the card down. */
  check('TaskBlock — connection to a deleted block', () => render(TaskBlock, {
    block: t('b'), blocks: [t('b')],
    connections: [{ id: 'c1', fromBlockId: 'ghost', toBlockId: 'b', kind: 'blocks' }],
    colors: COLORS, dark: true, isSelected: true, onUpdateBlock: () => {},
  }))
  check('TaskBlock — null blocks and connections', () => render(TaskBlock, {
    block: t('b1'), blocks: null, connections: null,
    colors: COLORS, dark: true, onUpdateBlock: () => {},
  }))

  const { default: TaskToolbar } = await import('../components/tools/TaskToolbar.js')
  check('TaskToolbar — plain', () => render(TaskToolbar, {
    block: t('b1'), blocks: [], connections: [], colors: COLORS, dark: true, onUpdateBlock: () => {},
  }))
  check('TaskToolbar — blocked, with a deadline', () => {
    const blocks = [t('a'), t('b', { deadline: '2020-01-01' })]
    return render(TaskToolbar, {
      block: blocks[1], blocks,
      connections: [{ id: 'c1', fromBlockId: 'a', toBlockId: 'b', kind: 'blocks' }],
      colors: COLORS, dark: false, onUpdateBlock: () => {}, onAddSubtask: () => {},
    })
  })
  check('TaskToolbar — null block returns null', () => render(TaskToolbar, { block: null, colors: COLORS }))
}

/* ── calendar ────────────────────────────────────────────────────────── */
console.log('\n calendar')
{
  const { default: CalendarBlock } = await import('../components/notebook/CalendarBlock.js')
  const cal = (p = {}) => ({ id: 'c1', type: 'calendar', w: 520, h: 420, view: 'month', sources: [{ kind: 'tasks' }], events: [], ...p })
  const tsk = (id, p = {}) => ({ id, type: 'task', title: id, status: 'todo', priority: 'med', ...p })

  check('CalendarBlock — empty month', () => render(CalendarBlock, {
    block: cal(), blocks: [], colors: COLORS, dark: true, onUpdateBlock: () => {},
  }))
  check('CalendarBlock — with task events', () => render(CalendarBlock, {
    block: cal(), blocks: [tsk('a', { deadline: '2026-08-20' }), tsk('b', { deadline: '2020-01-01' })],
    colors: COLORS, dark: false, onUpdateBlock: () => {}, onTeleport: () => {},
    address: { notebookId: 'nb', sheetId: 'sh' },
  }))
  for (const view of ['month', 'week', 'agenda']) {
    check(`CalendarBlock — ${view} view`, () => render(CalendarBlock, {
      block: cal({ view }), blocks: [tsk('a', { deadline: '2026-08-20' })],
      colors: COLORS, dark: true, onUpdateBlock: () => {},
    }))
  }
  check('CalendarBlock — table source', () => render(CalendarBlock, {
    block: cal({ sources: [{ kind: 'table', blockId: 'tbl', dateCol: 1, titleCol: 0 }] }),
    blocks: [{ id: 'tbl', type: 'table', name: 'Customers', headers: ['Client', 'Renewal'], rows: [['Acme', '2026-09-01']] }],
    colors: COLORS, dark: true, onUpdateBlock: () => {},
  }))
  /* A source pointing at a deleted table must not take the block down. */
  check('CalendarBlock — source pointing at a deleted table', () => render(CalendarBlock, {
    block: cal({ sources: [{ kind: 'table', blockId: 'gone', dateCol: 0 }] }),
    blocks: [], colors: COLORS, dark: true, onUpdateBlock: () => {},
  }))
  check('CalendarBlock — malformed events', () => render(CalendarBlock, {
    block: cal({ sources: [{ kind: 'events' }], events: [{ id: 'e1' }, { title: 'no date' }, null] }),
    blocks: [], colors: COLORS, dark: true, onUpdateBlock: () => {},
  }))
  check('CalendarBlock — null blocks', () => render(CalendarBlock, {
    block: cal(), blocks: null, colors: COLORS, dark: true, onUpdateBlock: () => {},
  }))

  const { default: CalendarToolbar, dateColumns } = await import('../components/tools/CalendarToolbar.js')
  check('CalendarToolbar — no tables', () => render(CalendarToolbar, {
    block: cal(), blocks: [], colors: COLORS, dark: true, onUpdateBlock: () => {},
  }))
  check('CalendarToolbar — with a dated table', () => render(CalendarToolbar, {
    block: cal(), colors: COLORS, dark: false, onUpdateBlock: () => {},
    blocks: [{ id: 'tbl', type: 'table', name: 'Customers', headers: ['Client', 'Renewal'], rows: [['Acme', '2026-09-01'], ['Globex', '2026-10-02']] }],
  }))
  check('CalendarToolbar — table with no date column', () => render(CalendarToolbar, {
    block: cal(), colors: COLORS, dark: true, onUpdateBlock: () => {},
    blocks: [{ id: 'tbl', type: 'table', name: 'Notes', headers: ['A', 'B'], rows: [['x', 'y']] }],
  }))
  check('CalendarToolbar — null block returns null', () => render(CalendarToolbar, { block: null, colors: COLORS }))

  // dateColumns is exported so the detection can be asserted directly.
  const detected = dateColumns({ type: 'table', headers: ['Client', 'Renewal'], rows: [['Acme', '2026-09-01'], ['Globex', '2026-10-02']] })
  ok(detected.length === 1 && detected[0].name === 'Renewal', 'dateColumns finds the date column and not the text one')
  ok(dateColumns({ type: 'text' }).length === 0, 'dateColumns ignores non-tables')
  ok(dateColumns(null).length === 0, 'dateColumns handles null')
}

/* ── database (§9.2) ─────────────────────────────────────────────────── */
console.log('\n database')
{
  const { default: DatabaseBlock } = await import('../components/notebook/DatabaseBlock.js')
  const {
    createDatabase, createProperty, createOption, createRow, createView,
    addProperty, addOption, addRow, addView, updateView,
  } = await import('../lib/database.js')

  let n = 0
  const newId = p => `${p}${++n}`

  /* The CRM from the model's own suite, so the four views are rendered over
     data with the shapes that actually occur: a select with options, a date,
     a checkbox, a multi and a row that has none of them. */
  function crm() {
    n = 0
    let db = createDatabase({ name: 'Companies', newId })
    const status = createProperty({ name: 'Status', type: 'select', newId })
    const rev = createProperty({ name: 'Revenue', type: 'number', newId })
    const closed = createProperty({ name: 'Closed', type: 'date', newId })
    const active = createProperty({ name: 'Active', type: 'checkbox', newId })
    const tags = createProperty({ name: 'Tags', type: 'multi', newId })
    db = [status, rev, closed, active, tags].reduce(addProperty, db)
    const won = createOption({ name: 'Won', color: 'green', newId })
    db = addOption(db, status.id, won)
    db = addRow(db, createRow(db, { values: {
      [db.titlePropId]: 'Acme', [status.id]: won.id, [rev.id]: 5000,
      [closed.id]: '2026-09-01', [active.id]: true, [tags.id]: [],
    }, newId }))
    db = addRow(db, createRow(db, { values: { [db.titlePropId]: 'Globex' }, newId }))
    return { db, ids: { status: status.id, closed: closed.id } }
  }

  const blk = db => ({ id: 'dbb1', type: 'database', w: 620, h: 380, name: 'Companies', db })

  check('DatabaseBlock — a brand new database', () => render(DatabaseBlock, {
    block: blk(createDatabase({ name: 'Untitled', newId })), colors: COLORS, dark: true,
    onUpdateBlock: () => {}, editingRef: { current: false },
  }))
  check('DatabaseBlock — a populated table', () => render(DatabaseBlock, {
    block: blk(crm().db), colors: COLORS, dark: false, onUpdateBlock: () => {},
  }))

  /* All four kinds, over the same rows. The board and the calendar are the
     two that read a SECOND property (groupBy, dateProp) and so have a second
     way to be undefined. */
  for (const kind of ['table', 'board', 'calendar', 'gallery']) {
    const { db } = crm()
    const v = createView(db, { kind, newId })
    check(`DatabaseBlock — ${kind} view`, () => render(DatabaseBlock, {
      block: blk({ ...addView(db, v), activeViewId: v.id }),
      colors: COLORS, dark: kind === 'board', onUpdateBlock: () => {},
      editingRef: { current: false },
    }))
  }

  /* A board grouped by nothing and a calendar dated by nothing are reachable
     states — removeProperty clears both — so they must render an explanation
     rather than throw on `groups.map`. */
  {
    const { db } = crm()
    const v = { ...createView(db, { kind: 'board', newId }), groupBy: null }
    check('DatabaseBlock — board with no groupBy', () => render(DatabaseBlock, {
      block: blk({ ...addView(db, v), activeViewId: v.id }), colors: COLORS, dark: true, onUpdateBlock: () => {},
    }))
    const c = { ...createView(db, { kind: 'calendar', newId }), dateProp: null }
    check('DatabaseBlock — calendar with no dateProp', () => render(DatabaseBlock, {
      block: blk({ ...addView(db, c), activeViewId: c.id }), colors: COLORS, dark: true, onUpdateBlock: () => {},
    }))
    /* Grouped by a property that has been deleted: groupRows answers null and
       the board has to say so. */
    const g = { ...createView(db, { kind: 'board', newId }), groupBy: 'ghost_prop' }
    check('DatabaseBlock — board grouped by a property that is gone', () => render(DatabaseBlock, {
      block: blk({ ...addView(db, g), activeViewId: g.id }), colors: COLORS, dark: false, onUpdateBlock: () => {},
    }))
  }

  /* A filter that hides everything, and a sort — both go through resolveView,
     and both are states someone can leave a view in. */
  {
    const { db, ids } = crm()
    const filtered = updateView(db, db.views[0].id, {
      filters: [{ propId: ids.status, op: 'is', value: 'nothing_matches' }],
      sortBy: { propId: ids.closed, desc: true },
    })
    check('DatabaseBlock — a filter that matches no rows', () => render(DatabaseBlock, {
      block: blk(filtered), colors: COLORS, dark: true, onUpdateBlock: () => {},
    }))
  }

  /* The shapes that arrive from an older build or a hand-edited export. Each
     of these replaced a whole block with an error card in some earlier type,
     which is why they are asserted rather than assumed. */
  check('DatabaseBlock — block with no db at all', () => render(DatabaseBlock, {
    block: { id: 'b', type: 'database' }, colors: COLORS, dark: true, onUpdateBlock: () => {},
  }))
  check('DatabaseBlock — db with no properties', () => render(DatabaseBlock, {
    block: blk({ properties: [], rows: [], views: [] }), colors: COLORS, dark: false, onUpdateBlock: () => {},
  }))
  check('DatabaseBlock — no onUpdateBlock and no editingRef', () => render(DatabaseBlock, {
    block: blk(crm().db), colors: COLORS, dark: false,
  }))

  const markup = render(DatabaseBlock, { block: blk(crm().db), colors: COLORS, dark: false, onUpdateBlock: () => {} })
  ok(markup.includes('Acme') && markup.includes('Globex'), 'the table renders its rows')
  ok(markup.includes('2 rows · 5 fields'), 'and describeDatabase\'s summary of what is in it')
  /* The house rule, asserted rather than trusted: a hex written into a chip is
     invisible in whichever theme it was not picked in, and the only reason
     OPTION_COLORS stores token names is to make that impossible. `#` may only
     appear here as a value taken from the `colors` object it was handed. */
  const hexes = new Set((markup.match(/#[0-9a-fA-F]{3,8}/g) || []).map(h => h.slice(0, 7).toLowerCase()))
  const allowed = new Set(Object.values(COLORS).map(c => c.slice(0, 7).toLowerCase()))
  ok([...hexes].every(h => allowed.has(h)),
     'every colour in the output came from the theme, not from a literal in the file')
}

/* ── settings ────────────────────────────────────────────────────────── */
console.log('\n settings')
{
  const { default: SettingsPanel } = await import('../components/settings/SettingsPanel.js')
  const { DEFAULT_PREFS } = await import('../lib/prefs.js')
  check('SettingsPanel — defaults', () => render(SettingsPanel, {
    dark: false, setDark: () => {}, prefs: DEFAULT_PREFS, setPref: () => {},
    usage: null, persisted: null, formatBytes: n => `${n} B`, onDeleteAllData: () => {},
  }))
  check('SettingsPanel — with usage', () => render(SettingsPanel, {
    dark: true, setDark: () => {}, prefs: { ...DEFAULT_PREFS, gridAlways: true }, setPref: () => {},
    usage: { usage: 1024, quota: 4096, pct: 0.25 }, persisted: true,
    formatBytes: n => `${n} B`, onDeleteAllData: () => {},
  }))
}

/* ── builder (§9.1) ──────────────────────────────────────────────────── */
console.log('\n builder')
{
  const { default: BuilderPanel } = await import('../components/builder/BuilderPanel.js')
  /* Rendered with no notebook at all as well as with one. The empty state is
     what a first-run user sees, and a panel that throws on its own default
     state is the exact class this file was written for. */
  check('BuilderPanel — empty, no notebook', () => render(BuilderPanel, {
    colors: COLORS, dark: true, notebook: null,
    onUseTemplate: () => {}, onClose: () => {},
  }))
  const markup = render(BuilderPanel, {
    colors: COLORS, dark: false,
    notebook: { id: 'nb1', name: 'CRM', sheets: [{ id: 's1', name: 'S', blocks: [] }] },
    onUseTemplate: () => {}, onClose: () => {},
  })
  ok(markup.includes('Save this workspace as a template'), 'BuilderPanel offers the save action')
  /* The list is read in an effect, which react-dom/server does not run, so the
     first paint is the loading state — NOT the empty state. Asserting that
     keeps the two from being conflated: an empty-state card shown for the
     150ms before the read lands would read as "you have no templates" to
     someone who has ten. */
  ok(!markup.includes('data-ds-builder-empty'),
     'and does not claim you have no templates before it has looked')
}

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
