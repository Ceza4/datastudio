/* Mounts PdfAnnotationLayer in a real browser with synthetic props, so the
   pointer/focus behaviour can be driven without a PDF, IndexedDB or pdf.js.

   Also mounts the two chrome primitives — Toast and ConfirmDialog — for the
   same reason. Everything that makes them correct (a portal, focus moving in
   and coming back, a Tab trap, Escape and a scrim click both meaning "never
   mind") is DOM behaviour, and react-dom/server renders none of it. */
import React, { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import PdfAnnotationLayer from '../../components/notebook/PdfAnnotationLayer'
import TextBlockToolbar from '../../components/notebook/TextBlockToolbar'
import NotebookCanvas from '../../components/notebook/NotebookCanvas'
import DatabaseBlock from '../../components/notebook/DatabaseBlock'
import { ToastProvider, useToast } from '../../components/ui/Toast'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import BuilderPanel from '../../components/builder/BuilderPanel'
import {
  createDatabase, createProperty, createOption, createRow,
  addProperty, addOption, addRow,
} from '../../lib/database'
import { idbKeys, idbDelete, STORE_TEMPLATES } from '../../lib/idb'
import { editableRuns, mergeRunsIntoLines } from '../../lib/pdfreplace'
import { sanitizeHtml, sanitizeEditorHtml } from '../../lib/sanitize'
import { makeViewport } from '../../lib/pdfspace'

const colors = {
  accent: '#1D9E75', border: '#d8d4cc', text: '#1A1917', text2: '#6B6860',
  text3: '#A09D97', surface: '#EDEAE3', raised: '#E3E0D8', red: '#c0392b',
  accentDim: '#d0f0e4',
  /* NotebookCanvas destructures four more than the PDF layer ever asked for.
     Extras are ignored by everything else, so one object still serves both. */
  base: '#F5F3EE', green: '#4ade80', amber: '#E8B85B',
}

const item = (str, x, baseline, w, size = 12) => ({
  str, transform: [size, 0, 0, size, x, baseline], width: w, height: size, fontName: 'f1',
})

const RUNS = mergeRunsIntoLines(editableRuns([
  item('Original sentence one', 72, 700, 120),
  item('Second line here', 72, 660, 96),
]))

function App() {
  const [edits, setEdits] = useState([])
  const [tool, setTool] = useState('edittext')
  const viewport = makeViewport({ viewBox: [0, 0, 400, 800], scale: 1 })
  /* Exposed to the Playwright driver in an effect, not during render: writing
     to a global while rendering is a real React violation (and the linter says
     so), even in a harness. The state ref is refreshed on every commit so the
     driver always reads the current value. */
  useEffect(() => { window.__state = () => ({ edits, tool }) })

  /* Exposed so the driver can inject sanitiser output into this live page and
     watch whether anything actually runs. A string assertion says a payload is
     absent; only a browser says it is inert. */
  /* BOTH PROFILES. This exposed only sanitizeHtml — the EXPORT profile — so
     the ten live-execution payloads below proved the safety of the profile
     users never see. sanitizeEditorHtml is the one that runs on every text
     block render and every paste, and it is strictly more permissive: it also
     allows `input`, `data-type`, and `style` on twenty-one elements. The only
     profile with a real-browser execution proof was the wrong one. */
  useEffect(() => {
    window.__sanitize = sanitizeHtml
    window.__sanitizeEditor = sanitizeEditorHtml
  }, [])

  /* Raw DOM event names, in arrival order. The regression this harness exists
     for is invisible in the React tree and only legible in this sequence. */
  useEffect(() => {
    window.__events = []
    const st = document.getElementById('stage')
    if (!st) return undefined
    const types = ['pointerdown', 'mousedown', 'pointerup', 'click', 'focusin', 'focusout']
    const on = e => window.__events.push(e.type)
    types.forEach(t => st.addEventListener(t, on, true))
    return () => types.forEach(t => st.removeEventListener(t, on, true))
  }, [])

  return (
    <>
    <div id="stage" style={{ position: 'relative', width: 400, height: 800, background: '#fff' }}>
      <PdfAnnotationLayer
        viewport={viewport}
        page={0}
        edits={edits}
        tool={tool}
        colors={colors}
        accentColor={colors.accent}
        textRuns={RUNS}
        sampleCover={() => '#ffffff'}
        onAdd={e => setEdits(p => [...p, e])}
        onSelect={() => {}}
        selectedId={null}
        width={400}
        height={800}
      />
      <button id="tool-select" onClick={() => setTool('select')}>select</button>
    </div>
    <Chrome />
    <TextRail />
    <Canvas />
    <Database />
    <Builder />
    </>
  )
}

/* §9.2 Builder — the database block.
   -------------------------------------------------------------------------
   Everything worth asserting about this block is a DOM fact that
   react-dom/server cannot see:

   · A cell editor is opened by a click and has to survive the same click.
     The opening pointerdown is defaultPrevented for exactly the reason the
     PDF editor above needed it — but that fix has a consequence, which is
     that clicking straight into ANOTHER cell no longer blurs this one, so the
     draft has to be folded in by hand. Both halves are event ordering.

   · What lands in a cell after typing is a question about coercion, and the
     dangerous answer is NaN — which survives JSON, compares false to itself,
     and sorts at random. It cannot be checked over the wire either:
     JSON.stringify turns NaN into null, so a NaN would read as the correct
     answer. The check is made in-page, below.

   · A board's columns come from the model's grouping, and the ungrouped
     column is the one people lose rows to.

   · A delete that does not ask has to be undoable, and the undo has to bring
     back the VALUES, not just the column.

   Pinned at 410,148 at the block's real default size, and CLIPPED, so what
   this suite drives is the layout the app actually produces. It starts clear
   of #stage (which ends at x=400) and of the Builder button above it, and
   ends well above the toast stack at the bottom of the viewport. It does
   overlap #canvas-host, which is harmless: every section after this one reads
   the canvas through window.__canvas rather than clicking it, and the two
   things that ARE clicked later — the Builder panel at z-index 200 and the
   toasts at 100000 — both sit above this host's 150. */
let dbSeq = 0
const dbId = p => `${p}${++dbSeq}`

/* The CRM from Matas's own example, small enough to assert exactly. */
function seedDatabase() {
  dbSeq = 0
  let db = createDatabase({ name: 'Companies', newId: dbId })
  const status = createProperty({ name: 'Status', type: 'select', newId: dbId })
  const revenue = createProperty({ name: 'Revenue', type: 'number', newId: dbId })
  db = [status, revenue].reduce(addProperty, db)

  const lead = createOption({ name: 'Lead', color: 'amber', newId: dbId })
  const won = createOption({ name: 'Won', color: 'green', newId: dbId })
  db = addOption(addOption(db, status.id, lead), status.id, won)

  const title = db.titlePropId
  db = addRow(db, createRow(db, { values: { [title]: 'Acme', [status.id]: won.id, [revenue.id]: 5000 }, newId: dbId }))
  db = addRow(db, createRow(db, { values: { [title]: 'Globex', [status.id]: lead.id }, newId: dbId }))
  /* One row with no status at all. It is the whole reason the __none__ column
     exists, and the row a board is most likely to lose. */
  db = addRow(db, createRow(db, { values: { [title]: 'Initech' }, newId: dbId }))

  return { db, ids: { title, status: status.id, revenue: revenue.id }, opts: { lead: lead.id, won: won.id } }
}

function Database() {
  const [seed] = useState(seedDatabase)
  const [db, setDb] = useState(seed.db)
  /* The canvas's own ref, so "does the block stand the canvas down while a
     cell is open" is observable rather than assumed. */
  const editingRef = useRef(false)

  /* Stands in for NotebookCanvas's document-level Escape handler, and is
     registered at the same moment relative to the block: on mount, in the
     bubble phase, long before any menu exists. The canvas bails when it sees
     `__dsConsumed`, so what this records is whether the flag had been set by
     the time the canvas would have read it — which a menu listening in the
     BUBBLE phase cannot manage, because it registers later and therefore runs
     later. Nothing about the React tree shows the difference. */
  useEffect(() => {
    function h(e) { if (e.key === 'Escape') window.__escConsumed = !!e.__dsConsumed }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [])

  useEffect(() => {
    window.__db = {
      ids: () => seed.ids,
      opts: () => seed.opts,
      editing: () => editingRef.current,
      props: () => db.properties.map(p => ({ id: p.id, name: p.name, type: p.type })),
      rowIds: () => db.rows.map(r => r.id),
      views: () => db.views.map(v => ({ id: v.id, kind: v.kind, groupBy: v.groupBy || null })),
      /* Read IN THE PAGE and described, never handed back raw. JSON.stringify
         turns NaN into null, so a NaN crossing the wire would arrive looking
         exactly like the correct answer — which is the one failure this
         particular assertion exists to catch. */
      cell: (rowIdx, propId) => {
        const v = db.rows[rowIdx]?.values?.[propId]
        return {
          value: typeof v === 'number' && Number.isNaN(v) ? 'NaN' : v ?? null,
          type: typeof v,
          isNaN: typeof v === 'number' && Number.isNaN(v),
          isNull: v === null,
          missing: !Object.hasOwn(db.rows[rowIdx]?.values || {}, propId),
        }
      },
    }
  })

  return (
    <div id="db-host" style={{
      /* blockRegistry's own create/dims for this type — 620×380. */
      position: 'fixed', left: 410, top: 148, width: 620, height: 380, zIndex: 150,
      display: 'flex', background: colors.surface, border: `1px solid ${colors.border}`,
      /* Clipped, exactly as the canvas's own block wrapper clips it. Without
         this the block renders at its natural width and spills over the
         neighbours, which would make this suite pass on a layout the app
         never produces — and would quietly hide a column that only fits
         because nothing was constraining it. */
      overflow: 'hidden',
    }}>
      <DatabaseBlock
        block={{ id: 'dbb1', type: 'database', name: 'Companies', db }}
        colors={colors}
        dark={false}
        onUpdateBlock={(id, patch) => setDb(patch.db)}
        editingRef={editingRef}
      />
    </div>
  )
}

/* §9.1 Builder, against a REAL IndexedDB.
   -------------------------------------------------------------------------
   Everything Builder does that can go wrong is asynchronous and stateful:
   whether the save form survives the click that opened it, whether a template
   reaches the store and comes back out of it, and whether a duplicate is a
   genuinely new workspace or the same block ids under a new notebook name.
   react-dom/server sees none of it, and a fake store would only prove the fake
   agrees with itself. IndexedDB works on file:// in Chromium, so this drives
   lib/templatestore.js exactly as the app does.

   The BUTTON here is a copy of the one in app/app/page.js — same attribute,
   same toggle — because AppPage cannot be mounted without a workspace, a
   sidebar and an import pipeline, and the point of this harness is that a
   failure in it is unambiguous.

   Pinned at 410,110: clear of #stage (which ends at x=400), clear of the text
   rail's editable above it, and clear of #canvas-host at x=700 while closed.
   The panel spills right when open, which is why the Builder section of
   run.mjs is the LAST one — every suite that uses absolute mouse coordinates
   has finished by then. */
function Builder() {
  const [open, setOpen] = useState(false)
  const [made, setMade] = useState([])

  /* A workspace with two blocks and known ids, so "the duplicate shares no id
     with the original" can name exact values rather than pattern-match. */
  const source = {
    id: 'nb_src', name: 'Research', activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1', connections: [], drawings: [],
      blocks: [
        { id: 'sb1', type: 'text', x: 0, y: 0, content: 'one' },
        { id: 'sb2', type: 'text', x: 0, y: 120, content: 'two' },
      ],
    }],
  }

  useEffect(() => {
    window.__builder = {
      made: () => made,
      source: () => source,
      /* So a re-run against a persistent profile starts from nothing. */
      wipe: async () => {
        for (const k of await idbKeys(STORE_TEMPLATES)) await idbDelete(STORE_TEMPLATES, k)
      },
    }
  })

  return (
    <div id="builder-host" style={{ position: 'fixed', left: 410, top: 110, zIndex: 200 }}>
      <button
        data-ds-builder-button
        aria-label="Builder"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >Builder</button>

      {open && (
        <BuilderPanel
          colors={colors}
          dark={false}
          notebook={source}
          onUseTemplate={nb => setMade(m => [...m, nb])}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

/* The infinite canvas, with a document held in ordinary React state.
   -------------------------------------------------------------------------
   Two gestures live here that nothing short of a real browser can judge.

   Space-to-pan and middle-drag are event PLUMBING: which listener sees the
   press first, whether preventDefault on a pointerdown really does suppress
   the mousedown that would have started a block drag, and whether a key
   pressed with a caret in a text block is a character or a modifier. Every
   one of those is a fact about the DOM, and react-dom/server renders none of
   it.

   The drag rewrite is worse. A drag now moves the block by writing `translate`
   straight onto its node and calls onUpdateBlock exactly once, when it lands.
   The bug that rewrite invites — a block that renders in the right place but
   never writes it down, or writes it sixty times, or leaves a stale transform
   after a cancel — is INVISIBLE to a render-phase test, because the render
   output is identical in every one of those cases.

   Held clear of #stage and of the chrome buttons, so the PDF suite's absolute
   mouse coordinates stay valid. */
function Canvas() {
  const [blocks, setBlocks] = useState(() => ([
    { id: 'b1', type: 'text', x: 40, y: 60, w: 200, h: 90, name: 'One', content: 'one' },
    { id: 'b2', type: 'text', x: 40, y: 230, w: 200, h: 90, name: 'Two', content: 'two' },
  ]))
  /* Every onUpdateBlock the canvas makes, in order. Counting these is the
     whole point: "commits once" is a claim about how many times this array
     grows, and nothing else can observe it. */
  const updates = useRef([])

  const nb = {
    id: 'nb1', name: 'Harness', activeSheetId: 's1',
    sheets: [{
      id: 's1', name: 'Sheet 1', blocks,
      connections: [{ id: 'c1', fromBlockId: 'b1', toBlockId: 'b2' }],
      drawings: [],
    }],
  }

  useEffect(() => {
    window.__canvas = {
      updates: () => updates.current.slice(),
      reset: () => { updates.current = [] },
      blocks: () => blocks,
      block: id => blocks.find(b => b.id === id),
    }
  })

  const noop = () => {}
  return (
    <div id="canvas-host" style={{ position: 'fixed', left: 700, top: 180, width: 560, height: 520, display: 'flex' }}>
      <NotebookCanvas
        nb={nb}
        dark={false}
        colors={colors}
        /* Snap on, so the guides can be asserted mid-drag — they are computed
           from the LIVE drag position, and a rewrite that froze state without
           noticing would take them away silently. */
        prefs={{ snapDefault: true, gridAlways: false, gridSize: 32 }}
        notebooks={[nb]}
        onAddBlock={noop}
        onUpdateBlock={(id, patch) => {
          updates.current.push({ id, patch })
          setBlocks(bs => bs.map(b => (b.id === id ? { ...b, ...patch } : b)))
        }}
        onDeleteBlock={noop}
        onDeleteBlocks={async () => null}
        onRenameNotebook={noop}
        onRenameSheet={noop}
        onAddConnection={noop}
        onDeleteConnection={noop}
        onUpdateConnection={noop}
        onAddDrawing={noop}
        onDeleteDrawing={noop}
        onClearDrawings={noop}
      />
    </div>
  )
}

/* The formatting rail beside a scrap of editable text.
   Link used to open three browser dialogs — one to ask for the URL, one when
   nothing was selected, one when the scheme was refused. All three are inline
   now, and the inline version has a failure mode the modal one could not
   have: the input takes focus, which destroys the selection execCommand is
   supposed to act on. The link then applies to nothing, silently. Only a real
   browser can tell the difference. */
function TextRail() {
  const ref = useRef(null)
  /* Counts blurs, and — because it is state — forces a real React re-render of
     the editable on each one. This reproduces the app faithfully: focusing the
     URL input blurs the text block, which persists its HTML upward and
     re-renders this subtree WHILE the saved Range is being held. If that
     re-render replaced the nodes, the Range would be pointing at a detached
     DOM and the link would land on nothing. */
  const [saves, setSaves] = useState(0)

  /* Written imperatively rather than as a JSX child, exactly as
     TextBlockContent does it — an uncontrolled contentEditable whose children
     React must not own. */
  useEffect(() => { if (ref.current) ref.current.innerHTML = 'Anchor text goes here' }, [])

  return (
    <>
      <div
        id="editable"
        ref={ref}
        data-ds-text=""
        data-saves={saves}
        contentEditable
        suppressContentEditableWarning
        onBlur={() => setSaves(n => n + 1)}
        style={{
          position: 'fixed', left: 500, top: 60, width: 260, padding: 8,
          background: '#fff', border: '1px solid #ccc', outline: 'none',
        }}
      />
      {/* A no-op, as in the app: the rail is driven by which block is
          selected, and its own outside-click handler only dismisses the
          right-click invocation. Unmounting it here would just be flaky. */}
      <TextBlockToolbar colors={colors} onClose={() => {}} />
    </>
  )
}

/* Openers for the two primitives. Deliberately OUTSIDE #stage and pinned
   clear of it, so the PDF suite's absolute mouse coordinates — measured once,
   at the top of the run — stay valid no matter what is clicked here. */
function Chrome() {
  const toast = useToast()
  const [open, setOpen] = useState(false)

  /* Counters the driver reads. An UNDO that renders but never calls back is
     exactly the failure this suite exists to catch, so what gets asserted is
     the callback firing, not the button existing. */
  useEffect(() => { window.__undone = 0; window.__resolved = [] }, [])

  return (
    <div id="chrome" style={{ position: 'fixed', left: 500, top: 8, display: 'flex', gap: 8 }}>
      <button id="raise-toast" onClick={() => toast('Block deleted', { undo: () => { window.__undone++ } })}>
        toast
      </button>
      <button id="open-dialog" onClick={() => setOpen(true)}>dialog</button>

      <ConfirmDialog
        open={open}
        title="Delete everything in this browser?"
        body="There is no cloud copy, and no undo for this one."
        tone="danger"
        actions={[
          { label: 'Delete everything', value: 'delete', tone: 'danger' },
          { label: 'Cancel', value: null, tone: 'quiet', autoFocus: true },
        ]}
        onResolve={v => { window.__resolved.push(v); setOpen(false) }}
      />
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <ToastProvider><App /></ToastProvider>
)
