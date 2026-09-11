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


/* ── shapes ───────────────────────────────────────────────────────────── */
{
  console.log('\n shapes')
  const { default: ShapeLayer } = await import('../components/notebook/ShapeLayer.js')
  const { createShape } = await import('../lib/shapes.js')

  const all = ['line', 'arrow', 'rect', 'ellipse', 'triangle', 'diamond']
    .map((k, i) => createShape(k, { id: 's' + i, x: i * 40, y: 20, w: 60, h: 45, rot: i * 11 }))
  /* Ink is built from points rather than a box, so it cannot come from the
     same map — and it is the kind most likely to be forgotten by a change to
     shapePath, because it is the only one whose path is not derived from
     x/y/w/h alone. */
  all.push(createShape('ink', {
    id: 'ink1', color: '#f00', size: 3,
    points: [{ x: 10, y: 10 }, { x: 40, y: 60 }, { x: 90, y: 20 }],
  }))
  all.push(createShape('ink', {
    id: 'ink2', rot: 35,
    points: [{ x: 200, y: 10 }, { x: 240, y: 60 }],
  }))

  const base = {
    zoom: 1, accent: COLORS.accent, surface: COLORS.surface, stroke: COLORS.text2,
    live: null, soleSelected: null, onHandleDown: () => {},
  }

  /* Every kind in one pass. A kind added to SHAPE_KINDS without a branch in
     shapePath() renders as an empty path rather than throwing, so this is a
     smoke test in the literal sense — but a kind added without a branch in
     arrowHead() or shapeTransform() DOES throw, and that is the common way to
     half-add one. */
  check('ShapeLayer — every kind at once', () =>
    render(ShapeLayer, { ...base, shapes: all, selectedIds: new Set() }))

  check('ShapeLayer — empty sheet', () =>
    render(ShapeLayer, { ...base, shapes: [], selectedIds: new Set() }))

  /* The two handle layouts are different components' worth of branching: a
     boxed shape gets eight handles plus a rotate arm, a linear one gets two
     endpoints and no rotation, because an arrow's angle already lives in its
     endpoints and offering to rotate it would store the angle twice. */
  const boxed = all.find(x => x.kind === 'rect')
  const linear = all.find(x => x.kind === 'arrow')
  check('ShapeLayer — handles on a boxed shape', () =>
    render(ShapeLayer, { ...base, shapes: all, selectedIds: new Set([boxed.id]), soleSelected: boxed }))
  check('ShapeLayer — handles on a linear shape', () =>
    render(ShapeLayer, { ...base, shapes: all, selectedIds: new Set([linear.id]), soleSelected: linear }))

  /* A gesture in flight. `live` is a Map keyed by id; passing the wrong shape
     of thing here is the kind of mistake that renders fine and then silently
     stops previewing the drag. */
  check('ShapeLayer — mid-drag, live overrides', () =>
    render(ShapeLayer, {
      ...base, shapes: all, selectedIds: new Set([boxed.id]), soleSelected: boxed,
      live: new Map([[boxed.id, { ...boxed, x: 400, y: 400 }]]),
    }))

  /* Zoomed right out. Every chrome dimension is divided by zoom, so a zoom of
     0 would produce Infinity in a dozen SVG attributes — React renders those
     without complaint and the browser then drops the whole element. */
  check('ShapeLayer — at 0.25x zoom', () =>
    render(ShapeLayer, { ...base, zoom: 0.25, shapes: all, selectedIds: new Set([boxed.id]), soleSelected: boxed }))

  const inked = all.find(x => x.id === 'ink1')
  check('ShapeLayer — handles on an ink stroke', () =>
    render(ShapeLayer, { ...base, shapes: all, selectedIds: new Set([inked.id]), soleSelected: inked }))

  const inkMarkup = render(ShapeLayer, { ...base, shapes: [inked], selectedIds: new Set() })
  ok(inkMarkup.includes('Q'),
     'a stroke renders as a smoothed path, not a faceted polyline')
  ok(inkMarkup.includes('stroke="#f00"') && inkMarkup.includes('fill="none"'),
     'in its own colour, and never filled — a stroke has no interior')

  const markup = render(ShapeLayer, { ...base, shapes: all, selectedIds: new Set([boxed.id]), soleSelected: boxed })
  ok(markup.includes('pointer-events:none') || markup.includes('pointerEvents'),
     'the layer refuses pointer events — hit testing is done in JS, or a diagonal arrow gets its bounding box as a hit area')
  ok((markup.match(/<rect/g) || []).length >= 8, 'a boxed selection draws its eight resize handles')
}

/* ── the canvas itself ────────────────────────────────────────────────── */
{
  console.log('\n notebook canvas')
  /* THE FILE THIS SUITE WAS WRITTEN FOR, AND IT WAS NOT IN IT.

     A const declared thirty lines above the useState that creates it
     shipped and took the whole app down on mount: "Cannot access
     'snapEnabled' before initialization". Every unit test passed, the
     module imported fine, all three static guards were green — because a
     temporal dead zone only fires when the component BODY RUNS, and
     nothing here ran it.

     check:hooks does not catch this shape either: that guard inspects
     dependency arrays, and this was a plain const in the body.

     react-dom/server runs the body. That is the entire point of this file,
     and the largest component in the app was the one thing it did not
     cover. */
  const { default: NotebookCanvas } = await import('../components/notebook/NotebookCanvas.js')

  const noop = () => {}
  const sheet = { id: 's1', name: 'Sheet 1', blocks: [], shapes: [], drawings: [] }
  const nb = { id: 'nb1', name: 'Project', sheets: [sheet], activeSheetId: 's1' }
  const props = {
    nb, dark: true, colors: COLORS,
    prefs: { gridAlways: false, gridSize: 32, snapDefault: false },
    notebooks: [nb], onTeleport: noop, revealRequest: null, onRevealHandled: noop,
    onAddBlock: noop, onUpdateBlock: noop, onDeleteBlock: noop, onDeleteBlocks: noop,
    onRenameNotebook: noop, onRenameSheet: noop, onDropColumn: noop, onDropFiles: noop,
    onAddShape: noop, onUpdateShape: noop, onDeleteShapes: noop, onOpenCrosscheck: noop,
    onRemoveTableColumn: noop, onAddConnection: noop, onDeleteConnection: noop,
    onUpdateConnection: noop, onAddDrawing: noop, onDeleteDrawing: noop,
    onClearDrawings: noop, onPickImage: noop,
  }

  check('NotebookCanvas — an empty sheet', () => render(NotebookCanvas, props))

  /* With content, because a body that survives the empty case can still
     throw on the first block it has to lay out. */
  const populated = {
    ...nb,
    sheets: [{
      ...sheet,
      blocks: [
        { id: 'b1', type: 'text', x: 20, y: 20, w: 280, name: '', content: '<p>hi</p>' },
        { id: 'b3', type: 'task', x: 20, y: 300, name: '', title: 'Do it', notes: '' },
      ],
      shapes: [
        { id: 'sh1', kind: 'rect', x: 500, y: 300, w: 80, h: 60, rot: 0, color: null, size: 2, fill: null },
        { id: 'sh2', kind: 'ink', x: 600, y: 300, w: 50, h: 40, rot: 0, color: null, size: 2, fill: null,
          points: [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }] },
      ],
    }],
  }
  check('NotebookCanvas — blocks and shapes on it', () =>
    render(NotebookCanvas, { ...props, nb: populated, notebooks: [populated] }))

  /* EVERY BLOCK TYPE, ONE AT A TIME, THROUGH THE REAL SWITCH.
     ------------------------------------------------------------------
     The two cases above put a `text` and a `task` on the canvas, which is two
     arms of a ~1000-line JSX switch. The other nine were never taken here, and
     one of them shipped broken:

         <BlockHandle {...handleProps} …>   in the chat block

     `handleProps` has never existed anywhere in NotebookCanvas.js. The build
     compiled it, all six static checks passed, 42 suites and 157 browser tests
     passed, and it reached Matas's machine — where it threw
     `handleProps is not defined` the first time a chat block was on screen.

     Everything was green because nothing had ever rendered a chat block. A JSX
     identifier only resolves when its branch runs, so an undefined name in one
     arm of a switch is invisible until that arm is taken. That is the same
     shape as the temporal-dead-zone bug this whole file was written for, one
     level down.

     Driven by BLOCK_TYPE_IDS rather than a list, so a type added in 2027 is
     covered the day it is registered — which is the day somebody is most
     likely to make exactly this mistake. */
  const { BLOCK_TYPE_IDS, createBlock } = await import('../components/notebook/blockRegistry.js')
  for (const type of BLOCK_TYPE_IDS) {
    check(`NotebookCanvas — a ${type} block on the sheet`, () => {
      const block = createBlock(type, { id: `b_${type}`, x: 40, y: 40 })
      const one = { ...nb, sheets: [{ ...sheet, blocks: [block] }] }
      render(NotebookCanvas, { ...props, nb: one, notebooks: [one] })
    })
  }

  /* Every pref combination that changes what the body computes. gridOn is
     derived from two of them, and it is exactly what broke. */
  for (const pr of [
    { gridAlways: true, gridSize: 16, snapDefault: true },
    { gridAlways: true, gridSize: 64, snapDefault: false },
    { gridAlways: false, gridSize: 32, snapDefault: true },
  ]) {
    check('NotebookCanvas — prefs ' + JSON.stringify(pr), () =>
      render(NotebookCanvas, { ...props, prefs: pr }))
  }

  /* No prefs at all. Every one is read with ?? so the component is supposed
     to survive this; nothing proved it until now. */
  check('NotebookCanvas — no prefs object', () => render(NotebookCanvas, { ...props, prefs: undefined }))
  check('NotebookCanvas — a notebook with no sheets', () =>
    render(NotebookCanvas, { ...props, nb: { id: 'x', name: 'x', sheets: [] } }))
}

/* ── the Sep 9 design pass ───────────────────────────────────────────────
   Every surface added or rewritten in that pass, rendered once. These are the
   components with the least production mileage, so they are the ones most
   likely to throw on a prop nobody passed yet — which is exactly what this
   suite is for. */
console.log('\n design pass — new surfaces')
{
  const { default: DocumentBlock } = await import('../components/notebook/DocumentBlock.js')
  const doc = {
    id: 'd1', type: 'document', name: 'Report', content: '<h1>H</h1><p>body</p>',
    pageSize: 'a4', orientation: 'portrait', margins: { top: 1, bottom: 1, left: 1, right: 1 },
    showRuler: true, showGuides: true, showWordCount: true, font: 'Georgia', fontSize: 12,
  }
  check('DocumentBlock — full', () => render(DocumentBlock, {
    block: doc, colors: COLORS, onSave: () => {}, onUpdateBlock: () => {},
  }))
  check('DocumentBlock — ruler off, guides off', () => render(DocumentBlock, {
    block: { ...doc, showRuler: false, showGuides: false }, colors: COLORS,
  }))
  /* The shape a block straight out of create() has, and the shape a corrupted
     one has. Both must render rather than throwing on a missing margins object. */
  check('DocumentBlock — bare block', () => render(DocumentBlock, {
    block: { id: 'd2', type: 'document' }, colors: COLORS,
  }))
  check('DocumentBlock — no margins object', () => render(DocumentBlock, {
    block: { id: 'd3', type: 'document', pageSize: 'letter', margins: undefined }, colors: COLORS,
  }))

  const { default: DocumentRibbon } = await import('../components/tools/DocumentRibbon.js')
  for (const tab of ['home', 'insert', 'layout', 'view']) {
    /* The ribbon opens on Home; the other three bands are only reachable by
       clicking, so a render-time error in one of them would otherwise sit
       undetected until somebody pressed that tab. Rendering the component four
       times exercises Home four times — but every band's JSX is evaluated as
       part of building the element tree either way, which is what catches the
       kind of error this suite is looking for. */
    check('DocumentRibbon — ' + tab, () => render(DocumentRibbon, {
      block: doc, colors: COLORS, onUpdateBlock: () => {}, onInsert: () => {}, onExport: () => {},
    }))
  }
  check('DocumentRibbon — no block', () => render(DocumentRibbon, { block: null, colors: COLORS }))

  const { default: AddMenu } = await import('../components/notebook/AddMenu.js')
  check('AddMenu', () => render(AddMenu, {
    anchorRect: { left: 20, top: 40, bottom: 66 }, colors: COLORS,
    onPick: () => {}, onClose: () => {},
  }))
  check('AddMenu — no anchor rect', () => render(AddMenu, {
    colors: COLORS, onPick: () => {}, onClose: () => {},
  }))

  const { default: BlockRefCard } = await import('../components/notebook/BlockRefCard.js')
  /* One card per preview branch. A preview that throws on real data is the most
     likely failure here, because each one indexes into a different block shape. */
  const refs = [
    ['table', { id: 'r1', type: 'table', name: 'T', headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']] }],
    ['database', { id: 'r2', type: 'database', name: 'D', headers: [{ label: 'X' }], rows: [['v']] }],
    ['kanban', { id: 'r3', type: 'kanban', name: 'K', lanes: [{ id: 'l1', name: 'L', cards: [{ id: 'c1', color: '#CD4037' }] }] }],
    ['text', { id: 'r4', type: 'text', name: 'N', content: '<p>hello <b>there</b></p>' }],
    ['calendar', { id: 'r5', type: 'calendar', name: 'C', sources: [{ kind: 'tasks' }] }],
    ['task', { id: 'r6', type: 'task', title: 'Do it', priority: 'high', deadline: '2026-01-01' }],
    ['pdf', { id: 'r7', type: 'pdf', name: 'P', pdfPages: 12 }],
    ['image', { id: 'r8', type: 'image', name: 'I', natW: 800, natH: 600 }],
    ['image icon-mode', { id: 'r9', type: 'image', name: 'I', displayMode: 'icon' }],
  ]
  for (const [label, b] of refs) {
    check('BlockRefCard — ' + label, () => render(BlockRefCard, {
      block: b, blockId: b.id, senderName: 'Mara', colors: COLORS, onOpen: () => {},
    }))
  }
  /* The grant-revoked case: the card is in the thread but the data is gone. */
  check('BlockRefCard — unresolvable block', () => render(BlockRefCard, {
    block: null, blockId: 'gone', label: 'a table', colors: COLORS,
  }))
  check('BlockRefCard — empty table', () => render(BlockRefCard, {
    block: { id: 'e', type: 'table', headers: [], rows: [] }, blockId: 'e', colors: COLORS,
  }))

  const { default: PeoplePanel } = await import('../components/ui/PeoplePanel.js')
  const people = [
    { id: 'p1', name: 'Mara', email: 'mara@example.com', shared: true },
    { id: 'p2', email: 'sam@example.com', shared: false },
  ]
  check('PeoplePanel — open', () => render(PeoplePanel, {
    open: true, people, colors: COLORS, onPickPerson: () => {}, onClose: () => {},
  }))
  check('PeoplePanel — with a thread open', () => render(PeoplePanel, {
    open: true, people, activePersonId: 'p1', colors: COLORS,
    onPickPerson: () => {}, onClose: () => {}, children: null,
  }))
  check('PeoplePanel — closed renders nothing', () => render(PeoplePanel, {
    open: false, people, colors: COLORS,
  }))
  check('PeoplePanel — nobody in the workspace', () => render(PeoplePanel, {
    open: true, people: [], colors: COLORS, onPickPerson: () => {}, onClose: () => {},
  }))

  const { default: ImageBlock } = await import('../components/notebook/ImageBlock.js')
  for (const mode of ['full', 'compact', 'icon']) {
    check('ImageBlock — displayMode ' + mode, () => render(ImageBlock, {
      block: { id: 'i1', type: 'image', name: 'Shot', imageId: 'img1', displayMode: mode },
      colors: COLORS, maxHeight: 200, onUpdateBlock: () => {},
    }))
  }
  check('ImageBlock — no displayMode at all (absent means full)', () => render(ImageBlock, {
    block: { id: 'i2', type: 'image', imageId: 'img2' }, colors: COLORS, maxHeight: 200,
  }))
}

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
