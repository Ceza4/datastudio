'use client'
import Icon from '../../components/ui/Icon'
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { usePrefs } from '../providers'
import { useToast } from '../../components/ui/Toast'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
/* components/ui/SharePanel.js is built and tested but deliberately NOT wired
   in. The sidebar affordance for it was removed on Matas's call — the hover-
   revealed icon buttons in that island are already hard enough to find without
   a third one, and where sharing is triggered from is an open question. The
   panel takes docId + level + sheetId/blockId and is one button away from
   being live again; the READ side (what other people shared with you) stays
   wired, because that has to work whether or not you can start a share. */
import { LEVEL_PROJECT, LEVEL_SHEET, onShares, incomingShares, sharesFor, sharedBlockFor } from '../../lib/sharing'
import { knownPerson } from '../../lib/attribution'
import PeoplePanel from '../../components/ui/PeoplePanel'
import { documentToDocx, documentToPdf } from '../../lib/docexport'
/* The same one-line download helper every other export in the app uses, rather
   than a second object-URL dance here. */
import { download } from '../../lib/exporters'
import ChatBlock from '../../components/notebook/ChatBlock'
/* The chat block's network half lives here rather than in the canvas or the
   block. NOTHING IN THE RENDER TREE TALKS TO A SERVER — the note in
   NotebookCanvas.js explains what breaks when that slips, and the browser
   harness is what catches it. */
import { fetchThread, postMessage, editMessage, unsendMessage, subscribeThread, shareIntoThread } from '../../lib/chat'
import { makeColors, Z } from '../../lib/theme'
import * as H from '../../lib/undo'
import SettingsPanel from '../../components/settings/SettingsPanel'
import SyncChip from '../../components/ui/SyncChip'
import { islandChrome, ISLAND_H } from '../../components/ui/island'
import AccountButton from '../../components/ui/AccountButton'
import BuilderPanel from '../../components/builder/BuilderPanel'
import { templateAssetIds, TPL_OK } from '../../lib/templatestore'
import { migratePrefs } from '../../lib/prefs'
import { normalizeCanvasBg } from '../../lib/canvasbg'
import { lockViewportZoom } from '../../lib/viewportlock'
import { markdownToHtml, markdownTitle, MARKDOWN_EXTS } from '../../lib/markdown'
import { processPdfFile, putPdf, newPdfId, prunePdfs, PDF_EXTS } from '../../lib/pdfs'
import { createBlock, ICON_FOOTPRINT } from '../../components/notebook/blockRegistry'
import { migrateInk } from '../../lib/shapes'
import { newNotebookId, newSheetId, newSheetFileId, newFolderId } from '../../lib/ids'
import { createSyncEngine, SYNC_OFF } from '../../lib/sync'
import { applyPulled, KIND_NOTEBOOK, KIND_FOLDER, KIND_SHEETFILE } from '../../lib/syncdocs'
import { isSupabaseConfigured, getSession } from '../../lib/auth'
import { refreshAccount, accountSnapshot } from '../../lib/limits'
import { getSupabase } from '../../lib/supabaseClient'
/* Not `xlsx` directly. lib/workbook.js wraps XLSX.read with a
   prototype-pollution guard, because the pinned 0.18.5 is the last SheetJS on
   public npm and carries CVE-2023-30533 — reachable from exactly this parse,
   with attacker-controlled bytes. See that file for the full reasoning and
   DEFERRED.md for the version bump that makes the guard unnecessary. */
import { readWorkbook, readDelimitedText, tableFromSheet } from '../../lib/workbook'
import NotebookCanvas from '../../components/notebook/NotebookCanvas'
import CrosscheckPanel from '../../components/tools/CrosscheckPanel'
import { saveState, loadState, clearState, debounce, SAVE_OK, SAVE_QUOTA, SAVE_STALE, LOAD_FAILED, storageEstimate, workspaceByteSize, formatBytes } from '../../lib/persistence'
import { pruneImages, requestPersistence, idbClear, STORE_IMAGES, STORE_PDFS, STORE_FILES, STORE_TEMPLATES } from '../../lib/idb'
import { processImageFile, putImage, newImageId, IMAGE_EXTS, MAX_IMAGE_BYTES } from '../../lib/images'
import { processFile, putFile, newFileId, pruneFiles, MAX_FILE_BYTES } from '../../lib/files'

/* Import formats, in two tiers.
   --------------------------------------------------------------------------
   ADVERTISED — shown in the sidebar. Every one of these was verified by
   round-tripping a real workbook through XLSX.read and checking the data came
   back intact, not by reading the library's feature list.

   The first version of this listed 28 extensions scraped from what SheetJS
   *can* parse. That was wrong in three ways: .xlam and .xla are Excel add-ins
   (macro containers, not data files), .prn came back lossy in testing, and
   .dif / .slk / .eth / .wk1 / .wks / .wk3 / .123 are formats from 1981–1993
   that no one is going to hand a researcher. Listing a format is a promise to
   support it; promising Lotus 1-2-3 buys nothing and costs bug reports.

   ALSO_ACCEPTED — allowed by the file picker but not advertised. These work
   (or should), they're just rare enough that headlining them adds noise
   rather than confidence. If someone has one, it opens; nobody is being
   invited to rely on it. */
const IMPORT_FORMATS = [
  { group: 'Excel',   exts: ['.xlsx', '.xlsm', '.xlsb', '.xls'] },
  { group: 'Text',    exts: ['.csv', '.tsv', '.txt'] },
  { group: 'OpenDoc', exts: ['.ods'] },
]

/* Templates, flat ODS, SpreadsheetML 2003, dBase, and Apple Numbers.
   .numbers is the one genuinely untested entry — the parser and its IWA
   decoder are both present in this build, but SheetJS can't WRITE .numbers so
   there was no way to generate a fixture. It's accepted, not advertised. */
const ALSO_ACCEPTED = ['.xlt', '.xltx', '.xltm', '.fods', '.xml', '.dbf', '.numbers']

/* One picker for everything. Images are routed to an image block, spreadsheets
   to the sidebar — the user shouldn't have to know which button to press. */
const ACCEPT_EXTS = [...IMPORT_FORMATS.flatMap(f => f.exts), ...ALSO_ACCEPTED, ...IMAGE_EXTS, ...PDF_EXTS, ...MARKDOWN_EXTS].join(',')

/* A note that will not fit on a canvas is not a note. 2MB of markdown is
   roughly a 350,000-word document; past that the honest answer is that this
   is the wrong tool, said out loud, rather than a text block that renders for
   nine seconds. */
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024
const DATA_EXTS = new Set([...IMPORT_FORMATS.flatMap(f => f.exts), ...ALSO_ACCEPTED])
/* Plain delimited text: parsed by readDelimitedText, not SheetJS's guesses. */
const TEXT_TABLE_EXTS = new Set(['.csv', '.tsv', '.txt'])

/* THE DOUBLE CHEVRON, composed from an icon that already exists.

   Icons are generated: an SVG goes in the icons folder one level above the
   repo and `npm run icons` builds icon-paths.js, which must never be
   hand-edited. That folder is outside the connected workspace, so a proper
   `nav-collapse` could not be built here — and hand-editing the generated
   file to get one would break the rule that keeps the icon set honest.

   Two nav-chevron-right glyphs, mirrored and overlapped, give exactly the
   double chevron with nothing hand-written. When the real icon is built this
   becomes a single <Icon name="nav-collapse" />; nothing else changes.

   The 0.62 overlap is what makes it read as one mark rather than two arrows
   with a gap between them. */
function DoubleChevron({ size = 13, dir = 'left' }) {
  return (
    <span aria-hidden="true" style={{
      display: 'inline-flex', alignItems: 'center',
      transform: dir === 'left' ? 'scaleX(-1)' : undefined,
      width: size * 1.38, height: size, flexShrink: 0,
    }}>
      <Icon name="nav-chevron-right" size={size} style={{ marginRight: -size * 0.62 }} />
      <Icon name="nav-chevron-right" size={size} />
    </span>
  )
}

/* During a dragover the FileList is deliberately NOT readable — browsers hide
   it until drop so a page cannot inspect what you are merely hovering with.
   `types` is all there is, and 'Files' in it is the only honest way to tell an
   OS file drag from an internal sidebar one. Anything that reads
   dataTransfer.files before the drop event gets an empty list and silently
   decides there are no files. */
const hasFileDrag = e => Array.from(e?.dataTransfer?.types || []).includes('Files')

/* A drop of 40 files is a mis-drag, not an intention. The cap is a guard
   against turning a slip of the wrist into 40 IndexedDB writes and 40 blocks. */
const MAX_DROP_FILES = 12
const extOf = name => {
  const m = /\.[a-z0-9]+$/i.exec(name || '')
  return m ? m[0].toLowerCase() : ''
}

/* A Date cell from cellDates:true, flattened to the local calendar day.
   toISOString() would be wrong here — it converts to UTC first, so a cell read
   as local midnight in Kiev comes back as the PREVIOUS day. Read the local
   fields instead. */
const isoDay = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/* Rows arrive sparse — sheet_to_json omits trailing empties — so map() has to
   tolerate holes. Only Date cells change; everything else is passed through
   untouched so number and string columns behave exactly as before. */
const normaliseRow = row =>
  Array.isArray(row) ? row.map(c => (c instanceof Date && !Number.isNaN(c.getTime()) ? isoDay(c) : c)) : row

/* Stamp the grace window on every asset these blocks reference.

   Module scope, not a closure inside the component: it reads Date.now(), and
   an impure call inside a component body stops React's compiler analysing
   everything after it — which is how eighteen unrelated diagnostics in this
   file stayed invisible. It needs nothing from the component but the Map. */
function _graceAssets(grace, blocks) {
  const now = Date.now()
  for (const b of blocks || []) {
    if (b?.imageId) grace.set(b.imageId, now)
    if (b?.pdfId) grace.set(b.pdfId, now)
    if (b?.fileId) grace.set(b.fileId, now)
  }
}

export default function AppPage() {
  const { dark, setDark, prefs, setPref, hydratePrefs } = usePrefs()
  const toast = useToast()

  /* One dialog host for the whole page.
     --------------------------------------------------------------------
     Almost nothing asks any more — a delete deletes and offers UNDO in a
     toast. What is left is the handful of decisions undo genuinely cannot
     reach, and they are rare enough that a second mounted <ConfirmDialog>
     per site would be more machinery than the decisions are worth.

     `ask()` hands back a promise so a caller reads top to bottom instead of
     splitting in half around a callback. The resolver lives in a ref rather
     than in state so `resolveDialog` never changes identity: ConfirmDialog
     lists it in a dependency array, and this component re-renders on every
     keystroke in the canvas. */
  const [dialog, setDialog] = useState(null)
  const dialogResolve = useRef(null)
  const ask = spec => new Promise(resolve => {
    /* A second question raised while one is still up would overwrite the
       resolver and strand the first promise forever — a caller left awaiting
       a dialog nobody can see. Settle the old one as "never mind" first. */
    dialogResolve.current?.(null)
    dialogResolve.current = resolve
    setDialog(spec)
  })
  const resolveDialog = useCallback(value => {
    const done = dialogResolve.current
    dialogResolve.current = null
    setDialog(null)
    done?.(value)
  }, [])

  const [files, setFiles] = useState([])
  const [expandedFiles, setExpandedFiles] = useState(new Set())
  /* Multi-sheet workbooks: the first sheet starts open, the rest closed.
     Stored as the set of sheets TOGGLED away from that default, so a fresh
     import needs no bookkeeping to look right. */
  const [toggledSheets, setToggledSheets] = useState(new Set())
  const sheetKey = (fileId, sheetName) => `${fileId}::${sheetName}`
  const isSheetOpen = (fileId, sheetName, index) => (index === 0) !== toggledSheets.has(sheetKey(fileId, sheetName))
  const toggleSheetOpen = (fileId, sheetName) => setToggledSheets(prev => {
    const next = new Set(prev), k = sheetKey(fileId, sheetName)
    next.has(k) ? next.delete(k) : next.add(k)
    return next
  })
  const [showHidden, setShowHidden] = useState(false)
  const [showCCWizard, setShowCCWizard] = useState(false)
  const [dragOverFileId, setDragOverFileId] = useState(null)
  const [selectedSidebarCols, setSelectedSidebarCols] = useState([])

  const [folders, setFolders] = useState([])
  const [notebooks, setNotebooks] = useState([])
  const [activeNotebookId, setActiveNotebookId] = useState(null)

  /* ── UNDO ────────────────────────────────────────────────────────────────

     Captured by watching `notebooks`, not by asking each mutator to describe
     its own inverse. Two reasons, and the second is the important one.

     First, it is nearly free: every mutation in this file is immutable, so the
     previous `notebooks` array shares every object that did not change and
     holding a reference to it costs one spine of shallow copies rather than a
     copy of the workspace.

     Second, it CANNOT BE FORGOTTEN. A mutator added next month is undoable the
     moment it lands, because nothing has to opt in. The alternative — a
     do/undo pair per operation — is how you end up back where this app started,
     with twelve carefully undoable deletions and no undo for move, resize,
     rename, reorder or re-parent.

     `historyRef` mirrors the state because the keyboard handler reads it and
     must not go stale, and because a capture must never itself cause a render. */
  /* A REF, NOT STATE, and that is not a shortcut.

     Nothing renders from the history — there is no undo button, no menu, no
     count — so putting it in state would cost a render on every edit to
     produce no pixels. Keeping it in a ref also removes the during-render
     `historyRef.current = history` mirror this used to need, which is exactly
     the write React's compiler flags: a ref assigned while rendering makes the
     component impure and defeats the compiler's analysis of everything after
     it.

     If an undo button ever wants a disabled state, mirror THAT into state
     rather than moving the stack. */
  const historyRef = useRef(H.emptyHistory())
  /* The previous `notebooks` we recorded against, and which notebook was open
     at the time — see lib/undo.js for why the active id is part of the state. */
  const prevNotebooksRef = useRef(null)
  const prevActiveRef = useRef(null)
  /* Set just before a mutation to say what it was; read by the capture effect
     and cleared. Unlabelled edits are recorded as a generic 'edit'. */
  const pendingLabelRef = useRef(null)
  /* True while an undo/redo is being applied, so the resulting `notebooks`
     change is not recorded as a new edit — which would make undo impossible to
     escape from. */
  const applyingHistoryRef = useRef(false)

  /* ── sync ────────────────────────────────────────────────────────────────

     The engine lives in lib/sync.js and is deliberately given no React
     knowledge at all: it reads the workspace through a ref and hands changes
     back through callbacks. Two reasons. The engine has to read the CURRENT
     workspace from inside an async network callback, where a value captured in
     a closure is already stale — a ref is the only thing that is not. And
     keeping every setState on this side means the engine cannot accidentally
     become the thing that decides how the app renders. */
  const syncRef = useRef(null)
  const workspaceRef = useRef({ notebooks: [], folders: [], files: [], prefs: null })
  const [syncStatus, setSyncStatus] = useState({ state: SYNC_OFF, pending: 0, message: null })
  /* Who is signed in, what they are paying for, and how much of it they have
     used. Kept in state rather than read from lib/limits on every render
     because the account panel renders from it — limits.js holds the cache, and
     this is the copy React is allowed to re-render on. */
  /* undefined = not looked yet, null = signed out, object = known. The three
     are kept distinct because "we have not checked" and "there is no account"
     produce very different UI, and collapsing them flashes a signed-out state
     at somebody who is signed in. */
  const [account, setAccount] = useState(undefined)

  const [expandedNotebookIds, setExpandedNotebookIds] = useState(new Set())
  const [renamingFolderId, setRenamingFolderId] = useState(null)
  const [renamingFolderLabel, setRenamingFolderLabel] = useState('')
  const [folderDragOver, setFolderDragOver] = useState(null)
  const [sidebarItemDrag, setSidebarItemDrag] = useState(null)
  const [renamingNotebookId, setRenamingNotebookId] = useState(null)
  const [renamingNotebookLabel, setRenamingNotebookLabel] = useState('')
  const [renamingSheetId, setRenamingSheetId] = useState(null)
  const [renamingSheetLabel, setRenamingSheetLabel] = useState('')

  /* A counter, not the grant list. The sidebar only needs to know THAT
     something changed so "Shared with me" recomputes; holding a copy of the
     list here would be a second cache to keep in step with lib/sharing.js. */
  const [shareTick, setShareTick] = useState(0)
  useEffect(() => onShares(() => setShareTick(n => n + 1)), [])

  /* sheetId → the name the user gave it, across every project. The share list
     shows "Q3 numbers" rather than "sh_9f2a…" — an id in a permission row is
     not an answer to "what did I share".

     `shareTick` is deliberately NOT a dependency: the names come from the
     workspace, not from the grants, and recomputing this on every share change
     would walk every sheet of every project for nothing. */
  /* Load and watch every thread on the sheet that is currently open.
     ------------------------------------------------------------------
     Keyed on the JOINED ids, not on the block array: `notebooks` gets a new
     identity on every document change, so depending on the array would tear
     down and re-establish a realtime subscription every time anybody nudged a
     block. The ids only change when a chat block is added or removed, which is
     exactly when the subscriptions should change. */
  const activeChatIds = useMemo(() => {
    const nb = notebooks.find(n => n.id === activeNotebookId)
    const sheet = (nb?.sheets || []).find(sh => sh.id === (nb.activeSheetId || nb.sheets?.[0]?.id))
    return (sheet?.blocks || []).filter(b => b?.type === 'chat').map(b => b.id).join(',')
  }, [notebooks, activeNotebookId])

  useEffect(() => {
    const ids = activeChatIds ? activeChatIds.split(',') : []
    if (!ids.length) return undefined
    const offs = ids.map(id => {
      /* Swallowed: a workspace with no network still opens, and a chat block
         with no thread reads as "no messages yet" rather than as an error. */
      fetchThread(id).catch(() => {})
      return subscribeThread(id, () => {})
    })
    return () => { for (const off of offs) { try { off() } catch { /* already gone */ } } }
  }, [activeChatIds])

  /* A block dragged into a chat.
     ------------------------------------------------------------------
     Two writes, in this order and not the other: the GRANT first, then the
     message. A message that names a block nobody in the thread can open is a
     dead reference, and doing it the other way round would produce one for as
     long as the second request took — or permanently, if it failed. */
  const handleChatShareBlock = useCallback(async (chatBlockId, refBlockId) => {
    const nb = notebooks.find(n => n.id === activeNotebookId)
    if (!nb) return
    const share = await shareIntoThread({ docId: nb.id, refBlockId })
    if (!share.ok) { toast(share.reason || 'Could not share that block.', { tone: 'warn' }); return }

    const res = await postMessage({
      blockId: chatBlockId,
      body: null,
      refBlockId,
      refShareId: share.shareId || null,
    })
    if (!res.ok) { toast(res.reason || 'Could not add that to the conversation.', { tone: 'warn' }); return }
    toast(share.granted
      ? `Shared with ${share.granted} ${share.granted === 1 ? 'person' : 'people'} in this conversation`
      : 'Added to the conversation')
  }, [notebooks, activeNotebookId, toast])

  const sheetNameMap = useMemo(() => {
    const out = {}
    for (const nb of notebooks) for (const sh of nb.sheets || []) if (sh?.id) out[sh.id] = sh.name
    return out
  }, [notebooks])

  /* Projects other people have given me, grouped for the sidebar. Read through
     `shareTick` so a pull that discovers a new grant repaints. */
  const sharedWithMe = useMemo(() => {
    const seen = new Map()
    for (const g of incomingShares()) {
      if (g.revoked_at) continue
      const row = seen.get(g.doc_id) || { docId: g.doc_id, levels: new Set(), sheets: [], from: null }
      row.levels.add(g.subject_kind)
      if (g.subject_kind === LEVEL_SHEET && g.sheet_id) row.sheets.push(g.sheet_id)
      /* WHO SENT IT. `created_by` is the granter's uuid; knownPerson resolves
         the display name the same fetch already collected for attribution — a
         uuid in a sidebar chip is not an answer to "who shared this".

         First grant wins rather than last: several grants on one project from
         the same person is the normal case, and two people sharing the SAME
         project with you is rare enough that naming the first sender beats
         either listing both (which will not fit) or naming neither. */
      if (!row.from && g.created_by) row.from = g.created_by
      seen.set(g.doc_id, row)
    }
    return [...seen.values()]
  }, [shareTick])

  /* ── WHO IS ON THIS SHEET'S PEOPLE LIST ─────────────────────────────────
     Built from the grants that actually exist, not from an org directory —
     there isn't one, and inventing a network call for a list nothing else in
     the app has is a bigger change than this surface justifies.

     Two sources, deduped by identity:
       · grants I have MADE on this project        → the people I shared with
       · grants other people have made to ME       → the people who shared with me

     A grant identifies its grantee by EMAIL and its granter by uuid, so the two
     halves key differently and the email is used as the id when there is no
     uuid. That is honest about what is known rather than fabricating a uuid,
     and personHue hashes either kind of string perfectly well — the colour just
     has to be stable, not meaningful.

     Read through `shareTick`, like sharedWithMe, so a pull that discovers a new
     grant repaints the list. */
  const peopleOnSheet = useMemo(() => {
    const nb = notebooks.find(n => n.id === activeNotebookId)
    const seen = new Map()
    const add = (id, patch) => {
      if (!id) return
      seen.set(id, { ...(seen.get(id) || { id }), ...patch })
    }
    if (nb) {
      for (const g of sharesFor(nb.id)) {
        if (g.revoked_at) continue
        add(g.grantee_email, { email: g.grantee_email, name: knownPerson(g.grantee_email) || g.grantee_email, shared: true })
      }
    }
    for (const g of incomingShares()) {
      if (g.revoked_at) continue
      add(g.created_by, { name: knownPerson(g.created_by) || 'Someone', shared: true })
    }
    return [...seen.values()]
  }, [notebooks, activeNotebookId, shareTick])

  const [peopleOpen, setPeopleOpen] = useState(false)
  const [activePersonId, setActivePersonId] = useState(null)

  /* The floating chat block for one person on this project, if it exists.
     Matched on `personId` rather than on a derived id string, so renaming
     anything — or the person's email changing — cannot orphan a live thread. */
  function personThreadId(personId) {
    const nb = notebooks.find(n => n.id === activeNotebookId)
    if (!nb) return null
    for (const sh of nb.sheets || []) {
      const found = (sh.blocks || []).find(b => b.type === 'chat' && b.floating && b.personId === personId)
      if (found) return found.id
    }
    return null
  }

  /* Create it on first use, never before. A chat block per person created
     eagerly would put a row in `chat_messages`' permission graph for every
     colleague you have never spoken to. Positioned off-canvas coordinates it
     will never be drawn at, because `floating` is what hides it and a
     position is required by the block shape regardless. */
  function ensurePersonThread(person) {
    const existing = personThreadId(person.id)
    if (existing) return existing
    const nb = notebooks.find(n => n.id === activeNotebookId)
    if (!nb) return null
    return addNotebookBlock(nb.id, 'chat', 0, 0, null, null, 320, 380, {
      floating: true,
      personId: person.id,
      name: person.name || person.email || 'Conversation',
    })
  }

  function freshNotebook() {
    /* WAS: `notebook_${Date.now()}` / `sheet_${Date.now()}`, with no random
       salt — the only two ids in this file without one. Locally that was
       survivable (one tab, one clock, and creating two notebooks in the same
       millisecond takes a script). Under sync it is not: a laptop and a
       desktop both minting a notebook at the same instant produce the SAME
       id, and the second push overwrites the first with no error anywhere.

       lib/ids.js mints a uuid. Notebooks already on disk keep their old ids —
       migration 0003 makes the Postgres primary key `text` precisely so they
       do not have to be rewritten (their ids are quoted inside teleport link
       addresses stored in text blocks, and rewriting user content to satisfy a
       column type is the wrong trade). */
    const id = newNotebookId()
    const sheetId = newSheetId()
    return { id, name: 'My Project', sheets: [{ id: sheetId, name: 'Sheet 1', blocks: [] }], activeSheetId: sheetId }
  }

  /* WHAT THE METER MEASURES, AND WHY IT CHANGED.

     It used to be navigator.storage.estimate() alone, which reports what the
     ORIGIN holds — framework chunks, the pdf.js worker and its 185 cmap and
     font files, service-worker caches, IndexedDB overhead. On an empty
     workspace that reads about 2MB, under a label saying STORAGE, which reads
     as "I have two megabytes of documents I did not create".

     Now `usage` is the workspace and `quota` is still the browser's, because
     they answer different questions: how much of my work is here, and how much
     room is left. */
  const refreshUsage = useCallback(async () => {
    try {
      const [mine, browser] = await Promise.all([workspaceByteSize(), storageEstimate()])
      const quota = browser?.quota || 0
      setUsage({ usage: mine, quota, pct: quota ? mine / quota : 0 })
    } catch { /* the meter simply does not update */ }
  }, [])

  // Load persisted state on mount, exactly once. DataStudio is always the
  // notebook workspace now, so we guarantee a notebook exists and is active
  // as soon as the app boots — first-run users land straight in a blank
  // notebook instead of an empty shell.
  /* Load is now async (IndexedDB). `hydrated` gates the first save so an
     empty initial render can't overwrite a real workspace before it arrives. */
  const [hydrated, setHydrated] = useState(false)
  const [saveError, setSaveError] = useState(null)
  /* Another tab owns the workspace. Not an error — a different situation with
     a different remedy (reload), and worth saying so rather than telling
     someone their storage is broken. */
  const [saveStale, setSaveStale] = useState(false)
  const [importError, setImportError] = useState(null)
  const [importing, setImporting] = useState(false)
  const [fileDragActive, setFileDragActive] = useState(false)
  const sidebarCollapsed = prefs?.sidebarCollapsed ?? false

  /* THE ASSET GRACE WINDOW — id -> the last moment it was known to be wanted.
     A ref, because nothing renders from it and it must not cause a render.

     It closes two ways of losing bytes that are still needed, both of which
     come from the prune's keep-set being a snapshot of one moment:

     1. UNDO. A delete offers undo for seven seconds; the autosave fires after
        600ms and prunes against a keep-set the deleted blocks are no longer
        in. Press Undo and the blocks return as missing-asset boxes. This is
        the exact race lib/templatestore.js already carries a graceAssets list
        for — notebook blocks simply never got the equivalent.
     2. A PRUNE RACING AN IN-FLIGHT SAVE. The debounce guards scheduling, not
        execution, and a large workspace has been measured at 1.58s inside
        idbSet. Import an image while a save is in flight and that save's
        callback prunes with a keep-set built before the import existed.

     One mechanism answers both: stamp on DELETE, stamp every import the moment
     its id is minted, re-stamp everything live on each save, and keep anything
     stamped within the window.

     The delete-time stamp is the important one and was missing. Stamping only
     live ids meant a just-deleted asset kept whatever timestamp the PREVIOUS
     save gave it — so after a minute of reading or panning (neither of which
     writes anything) it expired on the very pass the window exists to survive,
     while the toast was still offering UNDO. See graceAssetsOf below. */
  const assetGraceRef = useRef(new Map())
  const ASSET_GRACE_MS = 60_000

  /* STAMP THE GRACE WINDOW AT DELETE TIME, NOT AT SAVE TIME.

     The window used to be refreshed inside the autosave, and only for ids that
     were still LIVE. A just-deleted asset is by definition not live, so it
     kept whatever timestamp the previous save had given it — and if more than
     ASSET_GRACE_MS had passed since that save, it expired on the very pass the
     window exists to protect it from. Panning, zooming and reading write
     nothing, so a minute of ordinary use was enough. Delete a photo, click the
     UNDO the toast is still offering, and the block came back reading "Image
     data not found" — the app blaming the browser for its own collector.

     lib/templatestore.js has always stamped at delete time. This is the same
     shape, and it must be called BEFORE the state update that removes the
     blocks, while their ids are still reachable. */
  const graceAssetsOf = useCallback(blocks => _graceAssets(assetGraceRef.current, blocks), [])
  const [usage, setUsage] = useState(null)
  // null = not asked yet, true = protected from eviction, false = refused
  const [persisted, setPersisted] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef(null)
  /* §9.1 Builder. One boolean, and nothing below it reads it — the canvas, the
     sidebar and every block are rendered identically whether it is true or
     false. That is the whole compatibility guarantee, and it is why this is a
     sibling island rather than a mode the workspace is put into. */
  const [builderOpen, setBuilderOpen] = useState(false)
  /* Mind map mode lives here, not in NotebookCanvas, because its button is in
     Builder → Visuals, which renders in this component. It is per-visit, not
     per-notebook: switching notebooks turns it off, so you never land in a
     notebook already half-way through linking blocks. */
  const [mindMapOn, setMindMapOn] = useState(false)
  useEffect(() => { setMindMapOn(false) }, [activeNotebookId])
  /* Builder → Visuals bar. Same ownership as mind map mode: Builder opens
     it, the canvas renders it. A notebook switch closes it. */
  const [visualsOn, setVisualsOn] = useState(false)
  useEffect(() => { setVisualsOn(false) }, [activeNotebookId])

  useEffect(() => {
    let cancelled = false
    /* Every path that leaves the workspace UNREADABLE must leave the app
       usable and MUST NOT arm the autosave — `hydrated` is what gates saving,
       so refusing to set it is refusing to overwrite whatever is still down
       there. The alternative is a blank canvas that quietly becomes the real
       workspace 600ms later. */
    const refuseToSave = message => {
      const nb = freshNotebook()
      setNotebooks([nb])
      setActiveNotebookId(nb.id)
      setExpandedNotebookIds(prev => new Set(prev).add(nb.id))
      hydratePrefs(migratePrefs(null))
      setSaveError(message)
      /* setHydrated is deliberately NOT called. */
    }

    loadState().then(saved => {
      if (cancelled) return
      if (saved?.status === LOAD_FAILED) {
        refuseToSave(
          `Could not read your saved workspace (${saved.error}). Nothing has been changed on disk — `
          + 'saving is turned off for this session so it stays that way. Try reloading; if that does not '
          + 'help, close any other DataStudio tabs first.'
        )
        return
      }
      /* Strokes drawn before ink became a shape move across here, once, on
         load. They were stored in a `drawings` array with no verbs — you
         could draw one and then never touch it again — and as ink shapes they
         gain select, drag, resize, rotate, marquee and delete-with-undo.

         migrateInk returns the SAME array when there is nothing to move, so a
         workspace with no legacy strokes is not marked as changed and does
         not get written back on every boot. */
      let initialNotebooks = migrateInk(saved?.notebooks?.length ? saved.notebooks : [])
      const initialFolders = saved?.folders?.length ? saved.folders : []
      /* v5. Imported workbooks were in React state and nowhere else — the
         payload only ever carried {notebooks, folders, prefs}, so a reload
         emptied the sidebar and left every folder holding itemIds that
         pointed at nothing. */
      const initialFiles = Array.isArray(saved?.files) ? saved.files : []
      /* A FIRST RUN NO LONGER MANUFACTURES A PROJECT.

         This used to create "My Project" for anyone whose workspace was empty,
         which is the same phantom deleteNotebook was making at the other end:
         a document the user did not ask for, that syncs, that counts against
         quota, and that they then have to delete — only to watch it come
         straight back. One of the two had to go; both did.

         Empty is a state the app can render now, and ensureNotebook mints the
         first notebook at the moment something actually needs one. */
      if (initialNotebooks.length > 0) {
        setActiveNotebookId(initialNotebooks[0].id)
      }
      setNotebooks(initialNotebooks)
      setFolders(initialFolders)
      setFiles(initialFiles)
      /* Prefs come from the same payload. migratePrefs handles the v3 case
         where the key simply isn't there, falling back to the standalone
         theme mirror so an existing dark-mode user doesn't get flipped. */
      hydratePrefs(migratePrefs(saved?.prefs))
      setHydrated(true)
    }).catch(err => {
      if (cancelled) return
      /* Usable, but READ-ONLY. This branch used to call setHydrated(true),
         which armed the autosave over a workspace it had just failed to read
         — the same overwrite the LOAD_FAILED branch above exists to prevent,
         reached a different way. */
      refuseToSave(
        `Could not read your saved workspace: ${err.message}. Saving is turned off for this session `
        + 'so nothing already saved is overwritten.'
      )
    })
    /* Ask the browser to keep this origin's storage. Without it IndexedDB is
       best-effort and can be evicted under disk pressure — fine for a cache,
       not for the only copy of someone's work. Asking at load rather than on
       first save means the answer is known before there's anything to lose. */
    requestPersistence().then(({ supported, persisted: ok }) => {
      if (!cancelled) setPersisted(supported ? ok : null)
    })
    refreshUsage()

    return () => { cancelled = true }
  }, [])

  /* Debounced auto-save, 600ms after the last change.
     saveState resolves with an outcome rather than throwing — a failed save
     used to be a console.warn nobody saw, so people kept working on a
     workspace that had silently stopped persisting. */
  const debouncedSaveRef = useRef(null)
  if (debouncedSaveRef.current == null) {
    /* maxWait bounds the delay no matter how continuous the input is. A plain
       trailing debounce postpones forever under a stream of changes closer
       together than the delay — and renaming a block writes per keystroke, so
       holding a key down meant the workspace never saved at all. */
    debouncedSaveRef.current = debounce(async (state, onResult) => {
      const res = await saveState(state)
      onResult(res)
    }, 600, { maxWait: 5000 })
  }
  useEffect(() => {
    if (!hydrated) return
    debouncedSaveRef.current({ notebooks, folders, files, prefs }, res => {
      setSaveError(res.status === SAVE_OK ? null : res.error)
      setSaveStale(res.status === SAVE_STALE)
      /* THE COLLECTOR RUNS ON A QUOTA FAILURE TOO.

         It used to be inside `if (SAVE_OK)`, and it is the only code in the
         app that ever deletes asset bytes — deleteImage, deletePdf and
         deleteFile are exported and called from nowhere. So once saves started
         failing on quota, the error's own advice ("delete some images to free
         space") freed exactly nothing: deleting a block shrank the state
         payload by a hundred bytes while the megabytes sat untouched, and the
         storage meter never moved because it only refreshed on success.

         The keep-set is derived from in-memory state, which is valid whether
         or not the write landed. A stale result is different: another tab owns
         the workspace, its blocks are not in our keep-set, and pruning against
         our view would delete ITS assets. Never prune on stale. */
      if (res.status === SAVE_OK || res.status === SAVE_QUOTA) {
        // Drop image bytes no block references any more, then refresh the meter.
        const live = []
        const livePdfs = []
        const liveFiles = []
        notebooks.forEach(n => n.sheets?.forEach(s => s.blocks?.forEach(b => {
          if (b.type === 'image' && b.imageId) live.push(b.imageId)
          if (b.type === 'pdf' && b.pdfId) livePdfs.push(b.pdfId)
          if (b.type === 'file' && b.fileId) liveFiles.push(b.fileId)
        })))
        /* §9.1. A saved template owns COPIES of its assets, and no notebook
           block references them — so the keep-set above, on its own, describes
           every one of them as garbage. The first autosave after saving a
           template would delete exactly the bytes that were just copied to
           make the template self-contained.

           A failed scan skips the prune entirely rather than pruning with what
           it managed to read. An incomplete keep-set is not a smaller prune,
           it is a delete, and the cost of the alternative is some orphaned
           bytes until the next save. */
        /* Stamp, expire, and collect. Done before the template read so the
           window is measured from now rather than from whenever that
           resolves. */
        const graceNow = Date.now()
        const grace = assetGraceRef.current
        for (const id of [...live, ...livePdfs, ...liveFiles]) grace.set(id, graceNow)
        for (const [id, ts] of grace) if (graceNow - ts > ASSET_GRACE_MS) grace.delete(id)

        templateAssetIds().then(keep => {
          /* READ THE GRACE LIST HERE, NOT ABOVE.

             This used to be materialised into an array before
             templateAssetIds() was awaited. An import that stamped the ref
             during that await mutated the Map but not the array already copied
             out of it, so a freshly written asset was missing from the keep-set
             and the prune deleted the bytes seconds after they arrived. */
          const graced = [...grace.keys()]
          if (keep.status !== TPL_OK) { refreshUsage(); return }
          /* `graced` is added to all three. Ids are prefixed per store
             (img_ / pdf_ / file_) and each prune only inspects its own
             store's keys, so an id from the wrong family in a keep-set is
             inert rather than wrong. */
          /* THE PRUNES RETURN THE IDS THEY DELETED, and those ids are the
             only safe input to the cloud half.

             Local bytes were the whole story once. They are not now: the same
             image also has an object in Storage and a row in `assets`, and
             until this call existed nothing ever retired either one. Deleted
             images kept consuming a paid plan's quota indefinitely, and the
             collector that sweeps expired tombstones had never once had a
             tombstone to sweep.

             It is a soft delete with a 30-day window (see tombstoneAssets),
             which matters because the keep-set is built from THIS device's
             view. If that view is ever incomplete, this deletes the wrong
             thing — and a mistake made against a tombstone is a restore,
             while the same mistake against a hard delete is a loss. */
          Promise.all([
            pruneImages([...live, ...keep.images, ...graced]),
            prunePdfs([...livePdfs, ...keep.pdfs, ...graced]),
            /* No template keep-set for attachments yet: templateAssetIds()
               reports images and pdfs only, so a template that carries a file
               block would have its bytes pruned on the next save. Files are
               therefore pruned ONLY against live blocks, and saving a template
               containing an attachment is not yet supported — recorded here
               rather than discovered later as "my template lost its files". */
            pruneFiles([...liveFiles, ...graced]),
          ]).then(gone => {
            const ids = gone.flat().filter(Boolean)
            /* THROUGH THE QUEUE, NOT STRAIGHT AT THE NETWORK.

               This was `tombstoneAssets(ids).catch(() => {})` with a comment
               calling a failure "a billing annoyance — bytes linger until the
               next delete of the same id". There is no next delete of the same
               id: the blob has just been removed from IndexedDB, so that id
               can never appear in a keep-set again. One offline moment, which
               is ordinary usage here, leaked the object permanently and left
               its manifest row counting against quota forever.

               syncRef owns retries, backoff and crash-recovery already. */
            if (ids.length) syncRef.current?.retireAssets?.(ids)
            refreshUsage()
          })
        })
      }
    })
  }, [notebooks, folders, files, prefs, hydrated])

  /* ── the sync engine ────────────────────────────────────────────────────

     Mirrored into a ref on every workspace change, then the engine is told.
     `changed()` is a pointer compare per document — no serialisation, nothing
     that scales with how much is in a notebook — so it is safe to call from an
     effect that fires on every keystroke's worth of state. */
  useEffect(() => {
    workspaceRef.current = { notebooks, folders, files, prefs }
    if (hydrated) syncRef.current?.changed(workspaceRef.current)
  }, [notebooks, folders, files, prefs, hydrated])

  /* Fold pulled rows into what is on screen.

     applyingHistoryRef is reused for the notebook list, and that is the point
     rather than a shortcut: a pull must not become an undoable step. If it
     did, Ctrl+Z after a sync would revert the other machine's work and then
     push the reverted version back — two devices taking turns undoing each
     other, with the user pressing one key. */
  const applyRemoteRows = useCallback(rows => {
    if (!rows?.length) return
    const cur = workspaceRef.current
    const next = applyPulled(
      { notebooks: cur.notebooks, folders: cur.folders, files: cur.files },
      rows,
      /* Empty: lib/sync.js has already filtered out anything this device still
         owes a push for. Passing our own guess here would be a second, weaker
         copy of that rule. */
      new Set(),
    )
    if (!next.applied.length) return

    const appliedIds = new Set(next.applied)
    const touched = new Set(rows.filter(r => appliedIds.has(r.id)).map(r => r.kind))

    if (touched.has(KIND_NOTEBOOK)) {
      applyingHistoryRef.current = true
      setNotebooks(next.notebooks)
      /* The open notebook can be deleted on another device. Pointing
         activeNotebookId at something that no longer exists renders an empty
         canvas with no way back — the same clamp applyHistory already does,
         for the same reason. */
      setActiveNotebookId(prev =>
        prev && next.notebooks.some(n => n.id === prev) ? prev : (next.notebooks[0]?.id ?? null))
    }
    if (touched.has(KIND_FOLDER)) setFolders(next.folders)
    if (touched.has(KIND_SHEETFILE)) setFiles(next.files)

    /* Updated immediately, not left to the effect above. The engine may read
       the workspace again before React has re-rendered — during a drain that
       is already in flight — and it would otherwise diff against the
       pre-pull copy and mark every pulled document dirty, pushing back what it
       just received. */
    workspaceRef.current = {
      ...cur, notebooks: next.notebooks, folders: next.folders, files: next.files,
    }
  }, [])

  /* A conflict copy. Arrives already named "… (conflict copy)" and with a new
     id; all this side does is put it where the user will see it. */
  const addLocalDoc = useCallback((kind, doc) => {
    if (kind === KIND_NOTEBOOK) {
      applyingHistoryRef.current = true
      setNotebooks(prev => [...prev, doc])
    } else if (kind === KIND_FOLDER) setFolders(prev => [...prev, doc])
    else if (kind === KIND_SHEETFILE) setFiles(prev => [...prev, doc])
  }, [])

  const applyRemotePrefs = useCallback(remote => {
    if (!remote || typeof remote !== 'object') return
    hydratePrefs(migratePrefs(remote))
  }, [hydratePrefs])

  /* Read the account as soon as there is a session, independently of sync.

     It has to be independent, because on a FREE plan the sync engine never
     starts — and the Account panel and the storage copy both still need to
     know who this is and what tier they are on. Hanging this off sync would
     mean a free user's plan never loaded at all. */
  const loadAccount = useCallback(async () => {
    if (!isSupabaseConfigured()) return
    try {
      const client = await getSupabase()
      const s = await getSession(client)
      const uid = s?.user?.id
      if (!uid) { setAccount(null); return }
      await refreshAccount(client, uid)
      setAccount(accountSnapshot())
    } catch { /* offline: the panel keeps whatever it last knew */ }
  }, [])

  useEffect(() => { loadAccount() }, [loadAccount])

  useEffect(() => {
    /* Gated on `hydrated` for the same reason the autosave is: starting sync
       over a workspace that has not finished loading would push an empty one.
       And gated on the load having SUCCEEDED — refuseToSave deliberately never
       sets hydrated, so a failed read cannot arm either writer. */
    if (!hydrated || !isSupabaseConfigured()) return
    /* THE FREE TIER DOES NOT SYNC AT ALL, and this is where that is true.

       Not "syncs and gets refused" — the engine never starts, so no request is
       made, no outbox entry is written, and nothing is queued waiting for an
       upgrade that may never come. Postgres would refuse the writes anyway
       (migration 0004's quota triggers see a plan with every limit at zero),
       but a client that spends its time being told no is a client that looks
       broken.

       `account === null` means we have not looked yet; starting the engine on
       an unknown plan would push a free user's workspace before the answer
       arrives. Waiting is the safe direction: sync starting a second late is
       invisible, sync starting wrongly is a support ticket. */
    if (!account || !account.cloud) return
    const engine = createSyncEngine({
      readWorkspace: () => workspaceRef.current,
      applyRemote: applyRemoteRows,
      addLocalDoc,
      applyPrefs: applyRemotePrefs,
      onStatus: setSyncStatus,
    })
    syncRef.current = engine
    engine.start()
    return () => {
      /* flush() before stop(), so closing the tab or navigating away pushes
         what is owed instead of leaving it for the next launch. The engine's
         own pagehide handler is the belt; this is the braces, and it covers
         the client-side navigation case that pagehide does not fire for. */
      try { engine.flush() } catch { /* nothing to do */ }
      engine.stop()
      syncRef.current = null
    }
  }, [hydrated, account, applyRemoteRows, addLocalDoc, applyRemotePrefs])

  /* Record every change to the workspace, once it has actually happened.

     Runs after `notebooks` changes and after nothing else, so it sees exactly
     the transitions a user would want to reverse. Three things it deliberately
     does NOT record:

       · the first value after load, because there is no "before" to return to
         and offering one would undo the user's entire workspace;
       · a change it caused itself, via applyingHistoryRef;
       · anything while `hydrated` is false, for the same reason as the first. */
  useEffect(() => {
    if (!hydrated) {
      prevNotebooksRef.current = notebooks
      prevActiveRef.current = activeNotebookId
      return
    }
    const prev = prevNotebooksRef.current
    const prevActive = prevActiveRef.current
    prevNotebooksRef.current = notebooks
    prevActiveRef.current = activeNotebookId
    if (prev === notebooks) return
    if (applyingHistoryRef.current) { applyingHistoryRef.current = false; return }
    if (prev === null) return

    const label = pendingLabelRef.current || 'edit'
    pendingLabelRef.current = null
    historyRef.current = H.record(historyRef.current, {
      label, before: prev, after: notebooks,
      activeBefore: prevActive, activeAfter: activeNotebookId,
      nbId: activeNotebookId, at: Date.now(),
    })
    // activeNotebookId is read for coalescing only; it must not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebooks, hydrated])

  /** Called by a mutator to say what the next `notebooks` change was. */
  const markUndo = useCallback(label => { pendingLabelRef.current = label }, [])

  const applyHistory = useCallback(step => {
    const res = step(historyRef.current)
    if (!res) return null
    applyingHistoryRef.current = true
    historyRef.current = res.history
    setNotebooks(res.state)
    /* Clamped, always. The recorded id is usually right, but an entry from
       before a notebook was deleted names one that is no longer in `res.state`
       — and pointing activeNotebookId at a notebook that does not exist renders
       an empty canvas with no way back. Falling back to the first surviving
       notebook is never wrong, only occasionally not what you hoped. */
    const wanted = res.activeId
    const exists = wanted && res.state.some(nb => nb.id === wanted)
    setActiveNotebookId(exists ? wanted : (res.state[0]?.id ?? null))
    /* prevActiveRef has to move with it, or the next capture records a
       transition from an id that was never really current. */
    prevActiveRef.current = exists ? wanted : (res.state[0]?.id ?? null)
    return res.label
  }, [])

  const undoEdit = useCallback(() => applyHistory(H.undo), [applyHistory])
  const redoEdit = useCallback(() => applyHistory(H.redo), [applyHistory])

  /* THE PENDING SAVE HAS TO SURVIVE THE TAB CLOSING.

     There was no pagehide, no visibilitychange and no unload handler anywhere
     in the app, and the debounce had no way to be forced — so closing the tab
     inside the 600ms window simply dropped the write. Drag a block, press
     Ctrl+W within a second, reopen: the block is where it started.

     pagehide fires on close, on navigation, and on the way into the bfcache.
     visibilitychange catches the mobile case where a tab is backgrounded and
     may be killed without a pagehide at all. Both just force the debounce to
     run now. */
  useEffect(() => {
    function flush() { debouncedSaveRef.current?.flush?.() }
    function onHidden() { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [])

  /* Warn before closing when there is genuinely something unwritten.

     This used to open with `if (!saveError) return` — armed only once a save
     had ALREADY FAILED, which is the case where the data is lost regardless.
     A save that is merely pending produced no warning at all, and that is the
     common case: the flush above starts an async IndexedDB write, and a write
     started at unload is not guaranteed to complete. The prompt is the real
     protection; the flush is the optimistic path. */
  useEffect(() => {
    function handleBeforeUnload(e) {
      const unwritten = saveError || saveStale || debouncedSaveRef.current?.pending?.()
      if (!unwritten) return
      e.preventDefault()
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [saveError, saveStale])

  useEffect(() => { window.__nbTableDrag = null }, [])

  /* Browser zoom is banned for the whole app surface, not just the canvas.
     Mounted here rather than in NotebookCanvas on purpose: a ctrl+scroll over
     the sidebar or a rail never reaches the canvas's listener, and that is
     half of where the accidental page-zooms were coming from. See
     lib/viewportlock.js for the four routes it closes and why it is capture
     phase. Returns its own cleanup. */
  useEffect(() => lockViewportZoom(), [])

  /* Held in a ref so the drop listeners below can be registered ONCE, with an
     empty dep array, and still see current state. Re-binding four window
     listeners on every render of a component this size is not free, and a
     stale closure here would import into whichever notebook was open when the
     listener was last bound. */
  const importFilesRef = useRef(null)
  useEffect(() => { importFilesRef.current = importFiles })

  /* THE WINDOW-LEVEL FILE DROP GUARD — the most important listener in the app.

     Dropping a file on a page that does not handle it is not a no-op: Chrome
     NAVIGATES TO IT. Drop a PDF on DataStudio and the browser throws the app
     away and shows you the PDF, taking every unsaved edit with it. Before
     this, that was the behaviour everywhere except two small drop targets.

     preventDefault is needed on BOTH events, for different reasons:
       · dragover — without it the drop event never fires at all. This is the
         single most common reason a drop handler "doesn't work"
       · drop     — without it the navigation above happens anyway

     This is the fallback layer. The canvas and the sidebar folders handle
     their own drops and stopPropagation(), so a positioned drop is not also
     imported a second time here. Anything dropped on the chrome in between
     still lands, at the default position, rather than destroying the session.

     depth counts dragenter/dragleave pairs. dragleave fires every time the
     cursor crosses a child boundary, so a single boolean flickers the overlay
     on and off continuously as you move across the app. */
  useEffect(() => {
    let depth = 0
    /* Every path out of a drag ends here. Taking the overlay down is NOT the
       job of whoever handles the drop — see the two-phase note below. */
    function clearDrag() { depth = 0; setFileDragActive(false) }

    function onDragEnter(e) {
      if (!hasFileDrag(e)) return
      depth++
      setFileDragActive(true)
    }
    function onDragOver(e) {
      if (!hasFileDrag(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    function onDragLeave(e) {
      if (!hasFileDrag(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setFileDragActive(false)
    }

    /* CAPTURE phase. Runs before any React handler, so it runs even when the
       canvas or a sidebar folder calls stopPropagation() — which they must, to
       stop the fallback below importing the same file twice.

       THIS IS A SHIPPED BUG, FIXED. The first version cleared the overlay in
       the bubble handler only. A drop on the canvas or on a folder never
       reached it, so the "Drop to import" scrim stayed up forever — over an
       app that still worked underneath, because the scrim is
       pointerEvents:none, which made it look like the app had frozen when it
       had not. The lesson generalises: anything that must happen for EVERY
       event cannot live where a handler is allowed to stop propagation. */
    function onDropCapture(e) {
      if (!hasFileDrag(e)) return
      e.preventDefault()   // the navigation guard; must not depend on who handles the drop
      clearDrag()
    }

    /* BUBBLE phase — the actual fallback import. Only reached when nothing
       more specific claimed the drop. */
    function onDrop(e) {
      if (!hasFileDrag(e)) return
      e.preventDefault()
      clearDrag()
      importFilesRef.current?.(e.dataTransfer.files)
    }

    /* A drag cancelled with Escape, released outside the window, or ended by
       the tab losing focus fires neither a drop nor a balanced dragleave.
       Without these the overlay is stranded until the next drag starts. */
    function onDragEnd() { clearDrag() }
    function onBlur() { clearDrag() }
    function onKeyDown(e) { if (e.key === 'Escape') clearDrag() }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDropCapture, true)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', onDragEnd)
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDropCapture, true)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', onDragEnd)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  // Dismiss Settings on outside click or Escape.
  useEffect(() => {
    if (!settingsOpen) return
    function onDown(e) {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) setSettingsOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setSettingsOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [settingsOpen])

  const dragData = useRef(null)
  const fileInputRef = useRef(null)
  const imageInputRef = useRef(null)

  /* The palette, from lib/theme.js — one definition for the whole app.

     This block used to be the canonical hand-copy of six; the other five have
     been deleted. Destructured rather than used as `colors.x` so the ~200
     existing references below keep working unchanged. */
  const colors = makeColors(dark)
  const {
    base, surface, raised, border, borderDim,
    text, text2, text3,
    accent, accentText, accentDim,
    green, red, amber,
  } = colors

  // ── File import ──────────────────────────────────────────────
  /* ── Teleporting ───────────────────────────────────────────────────
     Following a link can cross a sheet or a notebook boundary, which means
     the target block isn't mounted at the moment of the click. So this
     switches context and leaves a REQUEST; NotebookCanvas picks it up on the
     render where the block actually exists and does the selecting and
     centring there.

     The nonce makes a repeat click on the same link re-fire. Without it,
     clicking a link, panning away, and clicking it again would do nothing —
     the state wouldn't have changed. */
  const [revealRequest, setRevealRequest] = useState(null)

  function teleportTo(addr) {
    if (!addr) return
    const nb = notebooks.find(n => n.id === addr.notebookId)
    if (!nb) return                        // dangling; the link renders struck through
    if (nb.id !== activeNotebookId) setActiveNotebookId(nb.id)
    /* A NOTEBOOK link stops here: open it on whatever sheet it was last on. */
    if (!addr.sheetId) return
    const sheet = (nb.sheets || []).find(sh => sh.id === addr.sheetId)
    if (!sheet) return

    if (sheet.id !== (nb.activeSheetId || nb.sheets?.[0]?.id)) setNotebookActiveSheet(nb.id, sheet.id)
    /* A SHEET link stops here: the sheet is the target, no block to reveal. */
    if (!addr.blockId) return
    setRevealRequest({ blockId: addr.blockId, nonce: Date.now() })
  }

  function handleImportClick() { fileInputRef.current.click() }

  /* Wipes the workspace store AND the image blobs. Two stores, so deleting one
     used to leave orphaned images occupying quota with nothing referencing
     them. Reloads rather than resetting state in place, because half the app
     caches derived values off the notebook tree. */
  /** Every store that holds the user's own content. */
  async function wipeLocalStores() {
    await clearState()
    await idbClear(STORE_IMAGES)
    await idbClear(STORE_PDFS)
    /* Files and templates were being LEFT BEHIND by a dialog that promised to
       delete everything. Attachments are the bytes someone is least likely to
       be able to reproduce and most likely to care about not leaving on a
       borrowed machine, and a template carries its own copies of the images
       and PDFs from the workspace it was made in — so both stores could
       survive a "delete everything" with real content in them, unreachable
       through the UI and invisible in the storage meter. */
    await idbClear(STORE_FILES)
    await idbClear(STORE_TEMPLATES)
  }

  /* SIGNING OUT CAN NOW TAKE THE WORKSPACE WITH IT.

     It did not, and that was a real leak: signOut() cleared the Supabase token
     and nothing else, while the app hydrates from IndexedDB on boot regardless
     of auth state. So the next person to open DataStudio on a shared or
     library machine got the previous user's notebooks, notes, images and PDFs
     in full.

     Clearing unconditionally would be worse. DataStudio is local-first: plenty
     of people will have a workspace they built before they ever signed in, and
     wiping it because they signed out once is destroying data they never
     handed over. So it asks, and the safe answer is the default. */
  async function signOutAndMaybeWipe() {
    const choice = await ask({
      title: 'Also remove this workspace from this device?',
      /* "there is no cloud copy to restore from" was true for every account
         when this was written. It is now true only on Free. Leaving it would
         make a paid user think removing a cache destroys their work, which is
         the one sentence that turns a safe click into a frightening one. */
      body: account?.cloud
        ? 'Your projects, images, PDFs and attachments are also in your account, so removing them '
          + 'here loses nothing — they download again next time you sign in.\n\n'
          + 'Remove them if this is a shared or borrowed computer. Keep them if it is yours, '
          + 'and the next sign-in is instant.'
        : 'Your projects, images, PDFs and attachments are stored in this browser, not in your account. '
          + 'Signing out does not remove them.\n\n'
          + 'Remove them if this is a shared or borrowed computer. Keep them if it is yours — '
          + 'there is no cloud copy to restore from.',
      actions: [
        { label: 'Remove from this device', value: 'wipe', tone: 'danger' },
        { label: 'Keep on this device', value: 'keep', autoFocus: true },
        { label: 'Cancel', value: null, tone: 'quiet' },
      ],
    })
    if (choice === null) return false
    if (choice === 'wipe') {
      await wipeLocalStores()
      /* Reload rather than clearing React state: every block, image URL and
         PDF document in memory still refers to bytes that no longer exist. */
      window.location.reload()
    }
    return true
  }

  async function deleteAllLocalData() {
    /* The one delete in the app that keeps a dialog. Everything else here
       deletes and offers UNDO, but there is nothing to hold the workspace in
       while a toast counts down — the stores are gone and the page reloads.
       Cancel takes the focus, not the red button, so an Enter pressed at the
       wrong moment cannot wipe someone's only copy. */
    const choice = await ask({
      title: account?.cloud ? 'Remove this workspace from this computer?' : 'Delete everything in this browser?',
      tone: 'danger',
      /* THE COPY BRANCHES ON THE PLAN, because the button does two different
         things depending on it.

         On a paid plan this clears a CACHE: the documents and files are in the
         account, and signing in downloads them again. Telling that user "there
         is no cloud copy and no undo" — as this dialog did until sync
         shipped — is simply false, and false in the direction that makes
         someone abandon a safe action out of fear.

         On Free the old wording is exactly right, because the browser is the
         only copy that exists.

         What neither case is any more is "delete everything". Erasing the
         ACCOUNT lives behind the Account button, needs the email typed, and
         says so. */
      body: account?.cloud
        ? 'This clears the copy stored in this browser. Your projects, files and '
          + 'templates stay in your account and download again next time you sign in.\n\n'
          + 'Useful on a shared or borrowed computer. To erase the account itself, '
          + 'use Delete account in the Account panel.'
        : 'Every project, folder, image, PDF, attachment and saved template lives on this device only. '
          + 'There is no cloud copy and no undo for this one.\n\n'
          + 'Export anything you want to keep first.',
      actions: [
        { label: account?.cloud ? 'Remove from this computer' : 'Delete everything', value: 'delete', tone: 'danger' },
        { label: 'Cancel', value: null, tone: 'quiet', autoFocus: true },
      ],
    })
    if (choice !== 'delete') return
    await wipeLocalStores()
    window.location.reload()
  }

  /* Import router.
     ------------------------------------------------------------------
     The previous version piped every file's bytes straight into XLSX.read
     with no type check, no try/catch and no reader.onerror. XLSX.read throws
     inside the FileReader callback, where the exception has nowhere to go —
     so an unsupported file (an image, say) produced absolutely nothing: no
     error, no message, no console output. That is why importing an image
     appeared to do nothing at all.

     Now: route by extension, validate, and surface every failure. */
  /* Is this text a delimited table, or is it prose?

     Judged on the first non-empty lines: real tabular data has the SAME number
     of fields on every row, and more than one. Prose has commas in some
     sentences and not others, which is exactly the signal this looks for.

     Tabs are checked before commas because a tab-separated file is almost
     never prose, whereas a comma-heavy paragraph is common. */
  function looksDelimited(head) {
    const lines = String(head || '').split(/\r?\n/).filter(l => l.trim()).slice(0, 12)
    if (lines.length < 2) return false
    for (const delim of ['\t', ',', ';', '|']) {
      const counts = lines.map(l => l.split(delim).length)
      if (counts[0] < 2) continue
      /* Every row the same width, and that width greater than one. A single
         inconsistent row is enough to call it prose — a table with a ragged
         row is rare, a paragraph with a stray comma is not. */
      if (counts.every(c => c === counts[0])) return true
    }
    return false
  }

  /* Copy the list BEFORE clearing the input. `input.files` is live: resetting
     `value` empties it, so the old order handed importFiles an empty list and
     picking a file and pressing Open did nothing at all. The reset is still
     needed so choosing the same file twice fires onChange again. */
  async function handleFileChange(e) {
    const list = Array.from(e.target.files || [])
    e.target.value = ''
    await importFiles(list)
  }

  /* ONE route in, for every way a file can arrive: the picker, a drop on the
     canvas, a drop on a sidebar folder, a drop anywhere else in the window.
     They were not one route before because there was only one way in — the
     picker — and dropping a real file on the app did nothing at all.

     `opts.at`      canvas coordinates, when the file was dropped on the canvas.
                    A PDF or an image then lands under the cursor instead of at
                    the fixed 200/130 corner every import used.
     `opts.folderId` a sidebar folder, when it was dropped on one. */
  /* WHERE the drop landed, as a patch — for every file type, not just images.

     The external-drop bug was that nothing in this path set parentSectionId at
     all, so a PDF or a spreadsheet dropped inside a section overlapped it
     without belonging to it just as an image did. Section containment is a
     property of the drop position, not of the file's extension, so it is one
     helper spread into every branch rather than a fix applied to the one type
     that happened to get noticed. Empty when the drop was not inside a section
     or came from the file picker (which has no position at all). */
  const sectionPatch = opts => (opts?.sectionId ? { parentSectionId: opts.sectionId } : null)

  async function importFile(file, opts = {}) {
    setImportError(null)
    const ext = extOf(file.name)

    if (IMAGE_EXTS.includes(ext)) return importImage(file, opts)
    if (PDF_EXTS.includes(ext)) return importPdf(file, opts)
    /* Markdown is checked BEFORE the spreadsheet formats deliberately. A .md
       file is prose, and routing prose through SheetJS produces a one-column
       grid of sentences. */
    if (MARKDOWN_EXTS.includes(ext)) return importMarkdown(file, opts)

    /* .txt IS DECIDED BY LOOKING AT IT.

       It used to sit in the same group as .csv and .tsv and go straight to
       SheetJS, so dragging in a paragraph of prose produced a grid of sentence
       fragments split on whatever commas happened to be in it. Dropping a text
       file into a data tool is a completely reasonable thing to try, and the
       result looked like the app was broken.

       An extension is a claim; the first few lines are evidence. If they are
       consistently delimited it really is data and goes to the grid, otherwise
       it becomes a note. Nothing is guessed silently either way — the toast
       says which happened, because a wrong guess the user cannot see is worse
       than a wrong guess they can correct. */
    if (ext === '.txt') {
      const head = await file.slice(0, 64 * 1024).text()
      if (looksDelimited(head)) return importWorkbook(file, opts)
      return importMarkdown(file, opts)
    }

    if (DATA_EXTS.has(ext)) return importWorkbook(file, opts)

    /* Everything else becomes an attachment rather than an error. This branch
       used to be a refusal that listed the formats the file was not — which
       is the least useful thing to tell someone who has just dragged in a
       .docx. It is the LAST branch on purpose: every type with a live block
       of its own is routed above it, so nothing that could have been opened
       properly gets buried as a chip. */
    return importAttachment(file, opts)
  }

  /* Sequential, deliberately. Each import awaits an IndexedDB write; firing
     them together turns a four-file drop into four interleaved transactions
     for no gain, and the error messages arrive in an order that matches
     nothing the user did. The state updates themselves are safe either way —
     every setter here takes the functional form.

     The FileList is copied to an array FIRST. It is a live view onto the drag
     operation, and it empties when the browser tears the drag down — reading
     it lazily inside the loop is a race that shows up only on slow imports. */
  async function importFiles(list, opts = {}) {
    /* `dropped`, not `files`. It used to shadow the `files` STATE declared at
       the top of this component, which check:hooks flags — correctly, even
       though this particular shadow is harmless, because the guard cannot see
       function scope and a rule that has to reason about scope is a rule that
       will be got wrong. Renaming is a smaller price than a guard nobody
       trusts, and reading `dropped` next to `files` is clearer regardless. */
    const dropped = Array.from(list || [])
    if (!dropped.length) return

    const batch = dropped.slice(0, MAX_DROP_FILES)
    if (dropped.length > batch.length) {
      setImportError(`${dropped.length} files is more than one drop should carry — importing the first ${MAX_DROP_FILES}.`)
    }

    /* GRID, not a diagonal cascade.

       A 26px-per-file diagonal was enough to prove several files had arrived,
       and it is the wrong shape for a real batch: ten images land as a long
       staircase running off the bottom-right, mostly overlapping, and a section
       grown around that is a tall thin diagonal box. A grid of the actual
       landing size puts them side by side, which is both what you can see and
       what growSectionToFit can size sensibly.

       Sized from what is LANDING, not from a constant: an icon-mode batch is
       200×40 chips and a full-size batch is 360×260 blocks, and one spacing
       number cannot suit both. Four across, because at five a default-width
       batch is already wider than most people's canvas view. */
    const iconDrop = opts.forceIcon || prefs?.imageDropMode === 'icon'
    const cellW = (iconDrop ? ICON_FOOTPRINT.w : 360) + 16
    const cellH = (iconDrop ? ICON_FOOTPRINT.h : 260) + 16
    const perRow = 4

    for (let i = 0; i < batch.length; i++) {
      const at = opts.at
        ? {
            x: opts.at.x + (i % perRow) * cellW,
            y: opts.at.y + Math.floor(i / perRow) * cellH,
          }
        : null
      await importFile(batch[i], { ...opts, at })
    }
  }

  /* A PDF becomes a block holding an id. The bytes go straight to IndexedDB
     and are never part of the workspace snapshot — a 20MB document rewritten
     by the 600ms autosave would make the whole app stutter. */
  async function importPdf(file, opts = {}) {
    const targetNb = ensureNotebook()   // empty workspace: make one rather than refuse
    setImporting(true)
    try {
      const processed = await processPdfFile(file)
      const id = newPdfId()
      /* Stamped BEFORE the write. A prune that lands between the write and
         the block being added would otherwise see bytes nothing references. */
      assetGraceRef.current.set(id, Date.now())
      await putPdf(id, processed)

      /* Dropped on the canvas: land under the cursor, offset by roughly a
         title bar so the block's top edge is where the pointer was rather
         than its centre being somewhere below it. Otherwise fall back to the
         old jittered corner, which is what the picker still uses. */
      const at = opts.at
      addNotebookBlock(
        targetNb, 'pdf',
        at ? Math.max(0, at.x - 40) : 200 + Math.random() * 40,
        at ? Math.max(0, at.y - 20) : 130 + Math.random() * 30,
        null, null, 520, 620,
        { pdfId: id, name: processed.name, pdfPage: 1, pdfFit: 'width', ...sectionPatch(opts) }
      )

      /* Encryption is a hint, not a verdict — /Encrypt can appear inside a
         stream in a file that isn't actually encrypted. So the block is
         created either way and this is a warning, not a refusal. */
      if (processed.encrypted) {
        setImportError(`"${processed.name}" looks password-protected. If it doesn't open, that's why.`)
      }
    } catch (err) {
      setImportError(err?.message || 'That PDF could not be imported.')
    } finally {
      setImporting(false)
    }
  }

  async function importImage(file, opts = {}) {
    const targetNb = ensureNotebook()   // empty workspace: make one rather than refuse
    setImporting(true)
    try {
      const processed = await processImageFile(file)
      const id = newImageId()
      assetGraceRef.current.set(id, Date.now())
      await putImage(id, {
        blob: processed.blob, width: processed.width, height: processed.height,
        type: processed.type, name: processed.name, addedAt: Date.now(),
      })
      // Size the block to the image's aspect ratio, capped so a tall photo
      // doesn't arrive taller than the viewport.
      const maxW = 420
      const scale = Math.min(1, maxW / processed.width)
      const at = opts.at
      /* WHAT THIS IMAGE LANDS AS.

         Shift held during the drop wins over the Settings default, and only in
         the icon direction — see the caveat on the canvas drop handler.

         The stored w/h are the FULL-SIZE dimensions either way, even for a drop
         that lands as an icon: displayMode is a rendering state and w/h are the
         size the user gets back when they expand it. Writing chip dimensions
         here would mean an icon-first import could never be expanded to
         anything but a 200×40 image. */
      const asIcon = opts.forceIcon || prefs?.imageDropMode === 'icon'
      addNotebookBlock(
        targetNb, 'image',
        at ? Math.max(0, at.x - 40) : 180 + Math.random() * 40,
        at ? Math.max(0, at.y - 20) : 140 + Math.random() * 30,
        null, null,
        Math.round(processed.width * scale),
        Math.round(processed.height * scale) + 30,
        {
          imageId: id, name: processed.name,
          natW: processed.width, natH: processed.height, alt: '', fit: 'contain',
          /* Only written when it is actually 'icon'. Absent means 'full'
             everywhere (see displayModeOf), so a normal drop adds no key — which
             keeps the stored shape identical to every image ever saved. */
          ...(asIcon ? { displayMode: 'icon' } : null),
          /* THE SECTION IT WAS DROPPED INTO. See sectionPatch — the external
             file drop never set this for any type. */
          ...sectionPatch(opts),
        }
      )
      refreshUsage()
    } catch (err) {
      setImportError(err?.message || 'That image could not be imported.')
    } finally {
      setImporting(false)
    }
  }

  /* A markdown file becomes a TEXT BLOCK, not a sheet.

     This closes an asymmetry that was sitting in the app: DataStudio has
     exported Markdown since the export panel existed (lib/exporters.js,
     blocksToMarkdown) and could not read it back — you could export a
     notebook to .md and then not drag it in. */
  async function importMarkdown(file, opts = {}) {
    const targetNb = ensureNotebook()   // empty workspace: make one rather than refuse
    if (file.size > MAX_MARKDOWN_BYTES) {
      setImportError(`"${file.name}" is ${formatBytes(file.size)} of text — too large for one note. Split it up first.`)
      return
    }
    setImporting(true)
    try {
      const raw = await file.text()
      const html = markdownToHtml(raw)
      if (!html) { setImportError(`"${file.name}" is empty.`); return }

      /* Sized from the content: a two-line note arriving in a 620px-tall box
         is as wrong as a long document arriving in a 90px one. The estimate is
         crude on purpose — the block is resizable and a guess that is close is
         worth more than a measurement that costs a layout pass. */
      const lines = raw.split('\n').length
      const height = Math.round(Math.min(560, Math.max(120, lines * 21 + 40)))
      const at = opts.at

      addNotebookBlock(
        targetNb, 'text',
        at ? Math.max(0, at.x - 40) : 200 + Math.random() * 40,
        at ? Math.max(0, at.y - 20) : 140 + Math.random() * 30,
        null, null, 460, height,
        {
          content: html,
          /* Named after the document's own first heading when it has one, so
             a folder of notes is readable without opening any of them. */
          name: markdownTitle(raw, file.name.replace(/\.[^.]+$/, '')),
          ...sectionPatch(opts),
        }
      )
    } catch (err) {
      setImportError(err?.message || `"${file.name}" could not be read.`)
    } finally {
      setImporting(false)
    }
  }

  /* §8 — an attachment. The bytes go to their own IndexedDB store and the
     block carries only an id, the same rule images and pdfs follow: a 40MB
     file rewritten by the 600ms autosave is a frozen main thread.

     KNOWN LIMIT, and the UI should keep saying it until §11 lands: this is
     one browser profile on one machine. The attachment is invisible on
     another device and gone if the profile is cleared. */
  async function importAttachment(file, opts = {}) {
    const targetNb = ensureNotebook()   // empty workspace: make one rather than refuse
    setImporting(true)
    try {
      const processed = await processFile(file)
      const id = newFileId()
      assetGraceRef.current.set(id, Date.now())
      await putFile(id, processed)

      const at = opts.at
      addNotebookBlock(
        targetNb, 'file',
        at ? Math.max(0, at.x - 40) : 200 + Math.random() * 40,
        at ? Math.max(0, at.y - 20) : 150 + Math.random() * 30,
        null, null, 300, 74,
        { fileId: id, name: processed.name, size: processed.size, mime: processed.type, ...sectionPatch(opts) }
      )
      refreshUsage()
    } catch (err) {
      setImportError(err?.message || `"${file.name}" could not be attached.`)
    } finally {
      setImporting(false)
    }
  }

  /* Wrapped so it can actually be awaited. importFiles documents itself as
     sequential; four of the five branches are async and this one was not — it
     started a FileReader and returned undefined, so `await` resolved on the
     next microtask and three dropped workbooks parsed concurrently. The
     visible symptom was the "Importing…" indicator vanishing when the
     SMALLEST file finished while two were still going, and an error from the
     second being wiped by the third's setImportError(null).

     A wrapper rather than a rewrite of the body: reindenting forty lines to
     add a promise is a large diff for a small change, and this keeps the
     parsing code untouched. */
  function importWorkbook(file, opts = {}) {
    return new Promise(done => importWorkbookInner(file, opts, done))
  }

  function importWorkbookInner(file, opts, done) {
    setImporting(true)
    const reader = new FileReader()
    reader.onerror = () => {
      setImporting(false)
      setImportError(`Could not read "${file.name}" from disk.`)
      done(null)
    }
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result)
        /* cellDates matters more than it looks. Without it a date cell arrives
           as an Excel serial — 46266 — which String()s into "46266" and then
           parses as the YEAR 46266. The calendar rail still rated such a column
           "date, confidence 1.0", so turning the source on rendered an empty
           month with no error. Dates come through as Date objects now and are
           normalised to YYYY-MM-DD below, which is the one string shape
           parseDate handles exactly. */
        const workbook = TEXT_TABLE_EXTS.has(extOf(file.name))
          ? readDelimitedText(data)
          : readWorkbook(data, { type: 'array', cellDates: true })
        if (!workbook.SheetNames?.length) throw new Error('the file contains no sheets')
        const sheets = workbook.SheetNames.map(sheetName => {
          const ws = workbook.Sheets[sheetName]
          const { labels, rows } = tableFromSheet(ws, normaliseRow)
          // A missing header stays blank rather than becoming "Column 3" —
          // the grid shows the column letter, so a placeholder is just clutter.
          /* The random suffix matters here for the same reason it does on the
             file id two lines below. This map runs synchronously across every
             sheet in the workbook, so Date.now() is IDENTICAL for all of them
             and `col_<T>_0` is generated once per sheet. The mutators are all
             scoped by file + sheet so the data stays correct, but the hidden-
             columns list in the sidebar flattens across sheets and renders by
             col.id — producing duplicate React keys the moment you hide
             column A on two sheets of one workbook. */
          const salt = Math.random().toString(36).slice(2, 7)
          const headers = labels.map((h, i) => ({ id: `col_${Date.now()}_${salt}_${i}`, label: h ?? '', index: i, hidden: false }))
          return { name: sheetName, headers, rows }
        })
        const totalRows = sheets.reduce((n, s) => n + s.rows.length, 0)
        if (totalRows === 0) throw new Error('no rows were found in it')
        /* The random suffix is not decoration. Every other id in this file
           carries one; this one did not, and two workbooks dropped together
           finish reading in the same millisecond often enough to collide —
           at which point the second silently overwrites the first in every
           lookup keyed by file id. */
        const newFile = { id: newSheetFileId(), name: file.name, sheets }
        setFiles(prev => [...prev, newFile])
        setExpandedFiles(prev => { const next = new Set(prev); next.add(newFile.id); return next })
        /* Dropped onto a folder: file it there. A workbook that appears at the
           root after being dropped into an open folder has technically
           imported and practically ignored you. */
        if (opts.folderId) moveToFolder(newFile.id, opts.folderId)
      } catch (err) {
        setImportError(`Could not import "${file.name}" — ${err?.message || 'the file may be corrupt or password-protected'}.`)
      } finally {
        setImporting(false)
        /* In `finally`, so a throw inside the try still releases the next
           file in the queue. A rejected import must not hang the batch. */
        done(null)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  // ── Column visibility ────────────────────────────────────────
  function hideColumn(fileId, sheetName, colId) {
    setFiles(prev => prev.map(f => f.id !== fileId ? f : { ...f, sheets: f.sheets.map(s => s.name !== sheetName ? s : { ...s, headers: s.headers.map(h => h.id === colId ? { ...h, hidden: true } : h) }) }))
  }
  function deleteColumn(fileId, sheetName, colId) {
    setFiles(prev => prev.map(f => f.id !== fileId ? f : { ...f, sheets: f.sheets.map(s => s.name !== sheetName ? s : { ...s, headers: s.headers.filter(h => h.id !== colId) }) }))
  }
  function restoreColumn(fileId, sheetName, colId) {
    setFiles(prev => prev.map(f => f.id !== fileId ? f : { ...f, sheets: f.sheets.map(s => s.name !== sheetName ? s : { ...s, headers: s.headers.map(h => h.id === colId ? { ...h, hidden: false } : h) }) }))
  }
  /* Deletes, then hands back the way to un-delete. Nothing asks first: tables
     already built from this file survive it regardless, so the worst case is
     re-importing — and undo makes even that unnecessary.

     Position is part of what gets restored. A file that returns at the bottom
     of the sidebar, out of the folder it was filed in, has technically come
     back and practically hasn't. */
  function deleteFile(fileId) {
    const index = files.findIndex(f => f.id === fileId)
    if (index < 0) return null
    const file = files[index]
    const wasExpanded = expandedFiles.has(fileId)
    const filedIn = folders
      .map(f => ({ folderId: f.id, at: f.itemIds.indexOf(fileId) }))
      .filter(x => x.at >= 0)

    setFiles(prev => prev.filter(f => f.id !== fileId))
    setExpandedFiles(prev => { const next = new Set(prev); next.delete(fileId); return next })
    setFolders(prev => prev.map(f => ({ ...f, itemIds: f.itemIds.filter(id => id !== fileId) })))

    return () => {
      setFiles(prev => {
        if (prev.some(f => f.id === fileId)) return prev
        const next = [...prev]
        next.splice(Math.min(index, next.length), 0, file)
        return next
      })
      if (wasExpanded) setExpandedFiles(prev => { const next = new Set(prev); next.add(fileId); return next })
      setFolders(prev => prev.map(f => {
        const spot = filedIn.find(x => x.folderId === f.id)
        if (!spot || f.itemIds.includes(fileId)) return f
        const itemIds = [...f.itemIds]
        itemIds.splice(Math.min(spot.at, itemIds.length), 0, fileId)
        return { ...f, itemIds }
      }))
    }
  }

  // ── Sidebar multi-select ─────────────────────────────────────
  function toggleSidebarSelect(e, colId) {
    e.stopPropagation()
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      setSelectedSidebarCols(prev => prev.includes(colId) ? prev.filter(id => id !== colId) : [...prev, colId])
    } else {
      setSelectedSidebarCols(prev => prev.includes(colId) && prev.length === 1 ? [] : [colId])
    }
  }

  // ── Drag helpers ─────────────────────────────────────────────
  function setNativeDragImage(e, label) {
    const el = document.createElement('div')
    el.textContent = label
    el.style.cssText = `position:fixed;top:-999px;left:-999px;padding:5px 12px;background:${accent};color:#fff;border-radius:6px;font:600 12px var(--ds-font-body);white-space:nowrap;`
    document.body.appendChild(el)
    e.dataTransfer.setDragImage(el, 0, 0)
    setTimeout(() => document.body.removeChild(el), 0)
  }
  /* Selected column ids resolved to where they live. Looked up across every
     file and sheet, not just sheet 1 of the dragged file — a selection can
     span sheets of a workbook, and each column must read from its own sheet. */
  function selectedColInfos() {
    const out = []
    for (const id of selectedSidebarCols) {
      for (const f of files) {
        for (const s of f.sheets) {
          const c = s.headers.find(h => h.id === id)
          if (c) out.push({ fileId: f.id, fileName: f.name, sheetName: s.name, col: c })
        }
      }
    }
    return out
  }
  function handleSidebarDragStart(e, fileId, fileName, sheetName, col) {
    const colsToAdd = selectedSidebarCols.length > 1 && selectedSidebarCols.includes(col.id)
      ? selectedColInfos()
      : [{ fileId, fileName, sheetName, col }]
    dragData.current = { type: 'sidebar', cols: colsToAdd, sourceFileId: fileId }
    setNativeDragImage(e, colsToAdd.length > 1 ? `${colsToAdd.length} columns` : col.label)
    e.dataTransfer.effectAllowed = 'copy'
    // Firefox refuses to start a drag unless some data is attached. The
    // payload itself still travels via dragData (a ref) because dataTransfer
    // can only carry strings.
    try { e.dataTransfer.setData('text/plain', col.label) } catch (_) {}
  }

  // ── Sidebar columns → notebook table block ─────────────────────
  // Builds a table block from real column data. Used both by drag-and-drop
  // onto the notebook canvas (see onDropColumn below) and by the sidebar's
  // "+ Add to notebook" multi-select shortcut.
  function buildTableFromCols(cols) {
    const headers = cols.map(c => c.col.label)
    const maxLen = Math.max(0, ...cols.map(c => {
      const f = files.find(f => f.id === c.fileId)
      const s = f?.sheets.find(sh => sh.name === c.sheetName)
      return s?.rows.length || 0
    }))
    const rows = Array.from({ length: maxLen }, (_, ri) => cols.map(c => {
      const f = files.find(f => f.id === c.fileId)
      const s = f?.sheets.find(sh => sh.name === c.sheetName)
      return String(s?.rows[ri]?.[c.col.index] ?? '')
    }))
    return { headers, rows }
  }
  /* Drag payload for a whole table: every visible column of one sheet (the
     first, when the file name itself is dragged), so dropping it on the
     canvas yields one table containing the lot. */
  function handleFileDragStart(e, file, sheet = file.sheets[0]) {
    if (!sheet) return
    const cols = sheet.headers.filter(h => !h.hidden).map(col => ({
      fileId: file.id, fileName: file.name, sheetName: sheet.name, col,
    }))
    if (!cols.length) return
    dragData.current = { type: 'sidebar', cols, sourceFileId: file.id, wholeFile: file.name }
    const label = file.sheets.length > 1 ? `${file.name} › ${sheet.name}` : file.name
    setNativeDragImage(e, `${label} · ${cols.length} columns`)
    e.dataTransfer.effectAllowed = 'copy'
    try { e.dataTransfer.setData('text/plain', file.name) } catch (_) {}
  }

  function addColumnsToNotebook(colInfos) {
    if (!colInfos.length || !activeNotebookId) return
    const { headers, rows } = buildTableFromCols(colInfos)
    addNotebookBlock(activeNotebookId, 'table', 160 + Math.random() * 40, 140 + Math.random() * 40, headers, rows)
    setSelectedSidebarCols([])
  }

  // ── Folder & Notebook management ─────────────────────────────
  function createFolder() {
    /* Same unsalted-timestamp problem freshNotebook had, and the same fix.
       Clicking "New Folder" twice inside one millisecond is not realistic;
       two machines doing it is exactly what sync makes realistic. */
    const id = newFolderId()
    setFolders(prev => [...prev, { id, name: 'New Folder', collapsed: false, itemIds: [] }])
    setTimeout(() => { setRenamingFolderId(id); setRenamingFolderLabel('New Folder') }, 30)
  }
  function toggleFolder(folderId) {
    setFolders(prev => prev.map(f => f.id === folderId ? { ...f, collapsed: !f.collapsed } : f))
  }
  function commitFolderRename(folderId) {
    if (renamingFolderLabel.trim()) setFolders(prev => prev.map(f => f.id === folderId ? { ...f, name: renamingFolderLabel.trim() } : f))
    setRenamingFolderId(null)
  }
  function deleteFolder(folderId) {
    setFolders(prev => prev.filter(f => f.id !== folderId))
  }
  function moveToFolder(itemId, folderId) {
    setFolders(prev => prev.map(f => {
      if (f.id === folderId) return { ...f, itemIds: f.itemIds.includes(itemId) ? f.itemIds : [...f.itemIds, itemId] }
      return { ...f, itemIds: f.itemIds.filter(id => id !== itemId) }
    }))
  }
  function removeFromFolder(itemId, folderId) {
    setFolders(prev => prev.map(f => f.id === folderId ? { ...f, itemIds: f.itemIds.filter(id => id !== itemId) } : f))
  }
  function createNotebook() {
    const nb = freshNotebook()
    setNotebooks(prev => [...prev, nb])
    setActiveNotebookId(nb.id)
    /* New projects land expanded — the sidebar should show Sheet 1 right
       away instead of making the user click to reveal what they just made. */
    setExpandedNotebookIds(prev => new Set(prev).add(nb.id))
    return nb.id
  }

  /**
   * The id of the notebook to put something in, creating one if there is none.
   *
   * WHY THIS RETURNS SYNCHRONOUSLY AND WHY THAT MATTERS.
   *
   * Four import paths used to open with `if (!activeNotebookId) {
   * setImportError('Open a notebook before adding a PDF.'); return }` — for
   * PDFs, images, notes and files. Those were dead ends invented to protect a
   * state that could not previously exist, because a notebook was always
   * conjured up front. Now that empty is a real state, "drag a PDF onto an
   * empty workspace" is an ordinary thing to do and refusing it would be a
   * worse bug than the phantom project was.
   *
   * The notebook object is built out here rather than inside a setState
   * updater, for the same reason deleteNotebook builds its own: an updater has
   * to be a pure function of its argument and React may call it twice. Callers
   * need the id NOW, in the same tick, to address the block they are about to
   * add — so the id is minted here and the state catches up.
   */
  function ensureNotebook() {
    if (activeNotebookId && notebooks.some(n => n.id === activeNotebookId)) return activeNotebookId
    if (notebooks.length > 0) {
      const first = notebooks[0].id
      setActiveNotebookId(first)
      return first
    }
    return createNotebook()
  }
  /* §9.1 Builder hands over a finished notebook — lib/templatestore.js has
     already allocated every id and copied every asset — so this is the same
     two lines createNotebook uses, and deliberately not a second code path
     into the workspace. */
  function addNotebookFromTemplate(nb) {
    if (!nb?.id) return
    setNotebooks(prev => [...prev, nb])
    setActiveNotebookId(nb.id)
    setExpandedNotebookIds(prev => new Set(prev).add(nb.id))
  }
  function renameNotebook(nbId, name) {
    setNotebooks(prev => prev.map(n => n.id !== nbId ? n : { ...n, name }))
  }
  /* The notebook's canvas background (lib/canvasbg.js). A notebook field, so
     it saves, syncs and shares with the notebook. The patch is merged and then
     normalised here, so the stored object is always whole. A partial one from
     a slider can never reach the renderer. */
  function updateNotebookCanvasBg(nbId, patch) {
    setNotebooks(prev => prev.map(n => n.id !== nbId ? n
      : { ...n, canvasBg: patch === null ? undefined : normalizeCanvasBg({ ...normalizeCanvasBg(n.canvasBg), ...patch }) }))
  }
  function _getActiveSheetId(n) { return n.activeSheetId || n.sheets?.[0]?.id }
  /* The block SHAPE now lives in components/notebook/blockRegistry.js. This
     function keeps only what it was always really about: generating an id and
     splicing the result into the right sheet.

     tests/registry.equivalence.test.mjs holds the previous constructor
     verbatim and asserts the registry reproduces it exactly for all five
     types — including the explicit `w: undefined` on tables, which is load
     bearing and which JSON.stringify would have hidden. */
  function addNotebookBlock(nbId, type, x, y, customHeaders, customRows, customW, customH, patch) {
    const id = `block_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const block = createBlock(type, {
      id, x, y, w: customW, h: customH,
      headers: customHeaders, rows: customRows, patch,
    })
    markUndo('add')
    setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const sid = _getActiveSheetId(n)
      return { ...n, sheets: (n.sheets || []).map(s => s.id === sid ? { ...s, blocks: [...s.blocks, block] } : s) }
    }))
    /* Returned so a caller can act on the new block immediately — connecting
       a subtask to its parent, say. Without this the only way to find it is to
       wait a tick and guess which block is newest, which is a race dressed up
       as a heuristic. */
    return id
  }
  /* What KIND of change a patch is, for the undo label and — more importantly
     — for coalescing. Dragging a block emits one patch on drop, but nudging it
     with the arrow keys emits one per press, and thirty presses should be one
     undo rather than thirty. */
  function labelForPatch(patch) {
    if (!patch) return 'edit'
    const keys = Object.keys(patch)
    if (keys.every(k => k === 'x' || k === 'y' || k === 'parentSectionId')) return 'move'
    if (keys.every(k => k === 'w' || k === 'h' || k === 'x' || k === 'y')) return 'resize'
    if (keys.length === 1 && keys[0] === 'name') return 'rename'
    if (keys.length === 1 && keys[0] === 'content') return 'edit text'
    if (keys.length === 1 && keys[0] === 'text') return 'edit text'
    if (keys.includes('nodes')) return 'mind map edit'
    return 'edit'
  }

  /* Append already-built blocks and shapes to the active sheet.

     Separate from addNotebookBlock because that one CREATES a block from a
     type and a position; this one takes objects that already exist and only
     has to place them. Paste is the caller today; a future "duplicate to
     another sheet" would be the second. */
  function pasteIntoNotebook(nbId, { blocks = [], shapes = [] }) {
    if (!blocks.length && !shapes.length) return 0
    markUndo('paste')
    setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const sid = _getActiveSheetId(n)
      return { ...n, sheets: (n.sheets || []).map(s => s.id !== sid ? s : {
        ...s,
        blocks: [...(s.blocks || []), ...blocks],
        shapes: [...(s.shapes || []), ...shapes],
      }) }
    }))
    return blocks.length + shapes.length
  }

  function updateNotebookBlock(nbId, blockId, patch) {
    if (patch?.__delete) { deleteNotebookBlock(nbId, blockId); return }
    markUndo(labelForPatch(patch))
    setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const sid = _getActiveSheetId(n)
      return { ...n, sheets: (n.sheets || []).map(s => s.id === sid ? { ...s, blocks: s.blocks.map(b => b.id === blockId ? { ...b, ...patch } : b) } : s) }
    }))
  }
  /* Puts a removal back exactly where it came from.
     --------------------------------------------------------------------
     Blocks render in array order, so a block spliced back at the END returns
     sitting on top of things it used to sit behind. It has technically been
     restored and visibly hasn't, which is the fastest way to teach someone
     that UNDO is not to be trusted. Indices travel with the snapshot.

     Only what was removed comes back. A whole-array snapshot would be less
     code and would also silently revert anything the user did in the seven
     seconds the toast was up. */
  function restoreNotebookBlocks(snap) {
    setNotebooks(prev => prev.map(n => {
      if (n.id !== snap.nbId) return n
      return { ...n, sheets: (n.sheets || []).map(s => {
        if (s.id !== snap.sheetId) return s
        const parentOf = new Map(snap.orphans)
        const blocks = s.blocks.map(b => parentOf.has(b.id) ? { ...b, parentSectionId: parentOf.get(b.id) } : b)
        const present = new Set(s.blocks.map(b => b.id))
        snap.blocks.forEach(([b, at]) => {
          if (present.has(b.id)) return          // already back; never duplicate a React key
          blocks.splice(Math.min(at, blocks.length), 0, b)
        })
        const connections = [...(s.connections || [])]
        const haveConn = new Set(connections.map(c => c.id))
        snap.connections.forEach(([c, at]) => {
          if (haveConn.has(c.id)) return
          connections.splice(Math.min(at, connections.length), 0, c)
        })
        return { ...s, blocks, connections }
      }) }
    }))
  }

  /* Deletes blocks and reports `{ undo, count }` — or null when nothing went.
     --------------------------------------------------------------------
     The CALLER raises the toast, not this function: only the canvas knows
     whether the block held anything, and announcing the deletion of an empty
     block you created by mis-clicking is noise dressed up as feedback.

     `count` is what ACTUALLY went, which is not always what was asked for:
     answering "Delete all" to a section takes its children too. A toast
     reading "1 block deleted" while six left the canvas is the kind of small
     lie that costs the toast its credibility for everything else.

     A section is the one block whose delete is a genuine question — its
     children can go with it or stay on the canvas — so that one still opens a
     dialog. Not to confirm: to ask. Cancelling any of them abandons the whole
     operation, because a half-applied multi-delete is not a state anyone
     asked for. */
  async function deleteNotebookBlocks(nbId, ids) {
    const n = notebooks.find(x => x.id === nbId)
    const sheetId = n && _getActiveSheetId(n)
    const sheet = n?.sheets?.find(s => s.id === sheetId)
    if (!sheet) return null

    const doomed = ids.map(id => sheet.blocks.find(b => b.id === id)).filter(Boolean)
    if (!doomed.length) return null

    const removeIds = new Set(doomed.map(b => b.id))
    const orphanIds = []

    for (const b of doomed) {
      if (b.type !== 'section') continue
      const children = sheet.blocks.filter(c => c.parentSectionId === b.id && !removeIds.has(c.id))
      if (!children.length) continue
      const choice = await ask({
        title: `Delete "${b.name || 'Section'}"?`,
        body: `It holds ${children.length} block${children.length > 1 ? 's' : ''}. `
            + 'They can go with the section, or stay on the canvas without it.',
        actions: [
          { label: 'Delete all', value: 'all', tone: 'danger' },
          { label: 'Keep blocks', value: 'keep', autoFocus: true },
          { label: 'Cancel', value: null, tone: 'quiet' },
        ],
      })
      if (choice === null) return null           // nothing has happened yet
      if (choice === 'all') children.forEach(c => removeIds.add(c.id))
      else children.forEach(c => orphanIds.push(c.id))
    }

    /* Protect the bytes before the blocks that reference them disappear. */
    graceAssetsOf(sheet.blocks.filter(b => removeIds.has(b.id)))
    markUndo('delete')

    const orphanOf = new Map(orphanIds.map(id => [id, sheet.blocks.find(b => b.id === id)?.parentSectionId ?? null]))
    const snap = {
      nbId, sheetId,
      blocks: sheet.blocks.map((b, at) => [b, at]).filter(([b]) => removeIds.has(b.id)),
      connections: (sheet.connections || []).map((c, at) => [c, at])
        .filter(([c]) => removeIds.has(c.fromBlockId) || removeIds.has(c.toBlockId)),
      orphans: [...orphanOf],
    }

    setNotebooks(prev => prev.map(nn => {
      if (nn.id !== nbId) return nn
      return { ...nn, sheets: (nn.sheets || []).map(s => {
        if (s.id !== sheetId) return s
        const blocks = s.blocks
          .filter(b => !removeIds.has(b.id))
          .map(b => orphanOf.has(b.id) ? { ...b, parentSectionId: null } : b)
        const connections = (s.connections || [])
          .filter(c => !removeIds.has(c.fromBlockId) && !removeIds.has(c.toBlockId))
        return { ...s, blocks, connections }
      }) }
    }))

    return { undo: () => restoreNotebookBlocks(snap), count: removeIds.size }
  }

  /* The single-block form every existing caller already speaks. */
  function deleteNotebookBlock(nbId, blockId) {
    return deleteNotebookBlocks(nbId, [blockId])
  }
  function addNotebookDrawing(nbId, drawing) {
    setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const sid = n.activeSheetId || n.sheets?.[0]?.id
      return { ...n, sheets: (n.sheets || []).map(s => s.id === sid ? { ...s, drawings: [...(s.drawings || []), drawing] } : s) }
    }))
  }
  function deleteNotebookDrawing(nbId, drawingId) {
    setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const sid = n.activeSheetId || n.sheets?.[0]?.id
      return { ...n, sheets: (n.sheets || []).map(s => s.id === sid ? { ...s, drawings: (s.drawings || []).filter(d => d.id !== drawingId) } : s) }
    }))
  }
  function clearNotebookDrawings(nbId) {
    setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const sid = n.activeSheetId || n.sheets?.[0]?.id
      return { ...n, sheets: (n.sheets || []).map(s => s.id === sid ? { ...s, drawings: [] } : s) }
    }))
  }
  /* Shapes live on the SHEET, beside drawings and blocks — not in the block
     array. A shape is not a block: it rotates, it has no content, its hit
     area is its geometry rather than a rectangle, and there will be hundreds
     of them. See claude/SHAPE_LAYER_AUG20.md for why that decision went the
     way it did, and what it cost.

     Same activeSheetId resolution as drawings, including the
     `|| n.sheets?.[0]?.id` fallback: a notebook saved before activeSheetId
     existed still has sheets, and dropping its shapes on the floor because a
     field is missing is worse than guessing the first one. */
  function addNotebookShape(nbId, shape) {
    markUndo('draw')
    setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const sid = n.activeSheetId || n.sheets?.[0]?.id
      return { ...n, sheets: (n.sheets || []).map(sh => sh.id === sid ? { ...sh, shapes: [...(sh.shapes || []), shape] } : sh) }
    }))
  }
  /* Patch in place, by id. NOT delete-and-recreate: the id is what selection,
     undo and any future connector all hold on to. */
  function updateNotebookShape(nbId, shapeId, patch) {
    markUndo(labelForPatch(patch))
    setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const sid = n.activeSheetId || n.sheets?.[0]?.id
      return { ...n, sheets: (n.sheets || []).map(sh => sh.id !== sid ? sh : {
        ...sh, shapes: (sh.shapes || []).map(x => x.id === shapeId ? { ...x, ...patch } : x),
      }) }
    }))
  }
  /* Deletes several at once and hands back the way to undo it, position
     included — a shape that comes back at the top of the z-order has
     technically returned and practically has not. */
  function deleteNotebookShapes(nbId, ids) {
    const kill = new Set(ids)

    /* The snapshot is taken from state OUTSIDE the updater, not assigned
       inside one. This function had it backwards, and it was the only delete
       in the file that did — every other one (blocks, sheets, notebooks,
       files) reads from `notebooks` first.

       A setState updater has to be a pure function of its argument, because
       React is entitled to call it twice and to re-run it against a rebased
       state. Two real failures followed from writing to `removed` inside one:
       the guard below could run before the updater and skip the undo toast
       entirely, and a re-run against a state where the shapes were already
       gone would overwrite `removed` with [] and turn the undo closure into
       a silent no-op. Both need a queued update to be pending — which is
       exactly what a shape drag leaves behind when you press Delete straight
       after releasing one. */
    const nb = notebooks.find(n => n.id === nbId)
    const sid = nb?.activeSheetId || nb?.sheets?.[0]?.id
    const sheet = nb?.sheets?.find(sh => sh.id === sid)
    const removed = (sheet?.shapes || [])
      .map((x, i) => ({ x, i }))
      .filter(({ x }) => kill.has(x.id))

    setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const active = n.activeSheetId || n.sheets?.[0]?.id
      return { ...n, sheets: (n.sheets || []).map(sh => sh.id !== active ? sh : {
        ...sh, shapes: (sh.shapes || []).filter(x => !kill.has(x.id)),
      }) }
    }))
    if (!removed.length) return null
    return () => setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const sid = n.activeSheetId || n.sheets?.[0]?.id
      return { ...n, sheets: (n.sheets || []).map(sh => {
        if (sh.id !== sid) return sh
        const next = [...(sh.shapes || [])]
        for (const { x, i } of removed) next.splice(Math.min(i, next.length), 0, x)
        return { ...sh, shapes: next }
      }) }
    }))
  }

  /* Change a connection in place — used to say what a dependency MEANS.
     A separate function rather than delete-and-recreate, so the id survives
     and the selection doesn't jump. */
  function updateNotebookConnection(nbId, connId, patch) {
    setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const sid = _getActiveSheetId(n)
      return { ...n, sheets: (n.sheets || []).map(s => s.id !== sid ? s : {
        ...s,
        connections: (s.connections || []).map(c => c.id === connId ? { ...c, ...patch, id: c.id } : c),
      }) }
    }))
  }

  function addNotebookConnection(nbId, conn) {
    setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const sid = _getActiveSheetId(n)
      return { ...n, sheets: (n.sheets || []).map(s => s.id === sid ? { ...s, connections: [...(s.connections || []), conn] } : s) }
    }))
  }
  function deleteNotebookConnection(nbId, connId) {
    setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const sid = _getActiveSheetId(n)
      return { ...n, sheets: (n.sheets || []).map(s => s.id === sid ? { ...s, connections: (s.connections || []).filter(c => c.id !== connId) } : s) }
    }))
  }
  function addNotebookSheet(nbId) {
    const id = `sheet_${Date.now()}`
    setNotebooks(prev => prev.map(n => n.id !== nbId ? n : { ...n, sheets: [...(n.sheets || []), { id, name: `Sheet ${(n.sheets || []).length + 1}`, blocks: [] }], activeSheetId: id }))
  }
  function deleteNotebookSheet(nbId, sheetId) {
    const nb = notebooks.find(n => n.id === nbId)
    const at = (nb?.sheets || []).findIndex(s => s.id === sheetId)
    if (at < 0) return null
    const sheet = nb.sheets[at]
    const prevActiveSheetId = nb.activeSheetId
    /* Every asset on the sheet, protected before the sheet goes. */
    graceAssetsOf(sheet.blocks || [])

    setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const newSheets = (n.sheets || []).filter(s => s.id !== sheetId)
      /* Only move if the sheet you were LOOKING AT is the one that went.
         Reassigning unconditionally yanked the canvas back to Sheet 1
         whenever any other sheet was deleted from the sidebar — and worse,
         every writer in this file resolves its target through
         _getActiveSheetId, so a block drag still committing its backstop
         after the jump would write into the wrong sheet, find no matching id,
         and lose the move with no error. */
      const stillThere = newSheets.some(s => s.id === n.activeSheetId)
      return {
        ...n,
        sheets: newSheets,
        activeSheetId: stillThere ? n.activeSheetId : (newSheets[0]?.id || null),
      }
    }))

    /* Back at its own tab position, and looking at whatever sheet you were
       looking at before — a sheet that returns last, with the notebook now
       showing a different tab, does not read as the same sheet coming back. */
    return () => setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const sheets = [...(n.sheets || [])]
      if (sheets.some(s => s.id === sheetId)) return n
      sheets.splice(Math.min(at, sheets.length), 0, sheet)
      return { ...n, sheets, activeSheetId: prevActiveSheetId || n.activeSheetId }
    }))
  }
  function renameNotebookSheet(nbId, sheetId, name) {
    setNotebooks(prev => prev.map(n => n.id !== nbId ? n : { ...n, sheets: (n.sheets || []).map(s => s.id === sheetId ? { ...s, name } : s) }))
  }
  function setNotebookActiveSheet(nbId, sheetId) {
    setNotebooks(prev => prev.map(n => n.id !== nbId ? n : { ...n, activeSheetId: sheetId }))
  }
  /* DELETING THE LAST PROJECT USED TO CONJURE A REPLACEMENT.

     This function minted a `freshNotebook()` stand-in whenever the last
     notebook went, on the reasoning that the app is always the notebook
     workspace and would otherwise have nowhere to render. From the user's
     side that is not what it looked like. You delete everything, and one
     project is always still there — a "My Project" you did not create, which
     reappears the instant you delete it. It reads as a project that cannot be
     deleted, because that is exactly what it behaves like.

     The empty workspace is now a real state with its own screen, and a
     notebook is created when one is first NEEDED — the first block, the first
     dropped file, the first click on the empty canvas. See ensureNotebook.

     That is better than a stand-in for a reason beyond tidiness: the stand-in
     was a real document. It synced. It counted against quota. Deleting your
     last project created a new row on the server, and the tombstone for the
     one you deleted sat beside it. */
  function deleteNotebook(nbId) {
    const at = notebooks.findIndex(n => n.id === nbId)
    if (at < 0) return null
    const doomed = notebooks[at]
    /* Every asset in every sheet of the notebook. This is the largest undo the
       app offers and the one most likely to be clicked after a pause. */
    for (const sh of doomed.sheets || []) graceAssetsOf(sh.blocks || [])
    const prevActiveId = activeNotebookId
    const remaining = notebooks.filter(n => n.id !== nbId)

    setNotebooks(prev => prev.filter(n => n.id !== nbId))
    if (activeNotebookId === nbId) setActiveNotebookId(remaining[0]?.id || null)

    return () => {
      setNotebooks(prev => {
        if (prev.some(n => n.id === nbId)) return prev
        const next = [...prev]
        next.splice(Math.min(at, next.length), 0, doomed)
        return next
      })
      setActiveNotebookId(prevActiveId)
    }
  }

  function renderNotebookInSidebar(nb, folderId) {
    const isExpanded = expandedNotebookIds.has(nb.id)
    return (
      <div key={nb.id}>
        <div className="nb-row"
          draggable={renamingNotebookId !== nb.id}
          onDragStart={e => {
            e.stopPropagation()
            setSidebarItemDrag({ itemId: nb.id, itemType: 'notebook' })
            e.dataTransfer.effectAllowed = 'move'
            try { e.dataTransfer.setData('text/plain', nb.name) } catch (_) {}
            setNativeDragImage(e, nb.name)
          }}
          onDragEnd={() => setSidebarItemDrag(null)}
          style={{ padding: '8px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: 'transparent' }}
          onClick={() => {
            if (renamingNotebookId === nb.id) return
            setActiveNotebookId(nb.id)
            setExpandedNotebookIds(prev => {
              const next = new Set(prev)
              next.has(nb.id) ? next.delete(nb.id) : next.add(nb.id)
              return next
            })
          }}>
          {renamingNotebookId === nb.id ? (
            <input autoFocus value={renamingNotebookLabel}
              onChange={e => setRenamingNotebookLabel(e.target.value)}
              onBlur={() => { renameNotebook(nb.id, renamingNotebookLabel.trim() || nb.name); setRenamingNotebookId(null) }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
              onClick={e => e.stopPropagation()}
              maxLength={40}
              style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: `1px solid ${accent}`, color: text, fontFamily: 'var(--ds-font-body)', fontSize: 13, fontWeight: 600, outline: 'none', minWidth: 0 }} />
          ) : (
            <span
              onDoubleClick={e => { e.stopPropagation(); setRenamingNotebookId(nb.id); setRenamingNotebookLabel(nb.name) }}
              title="Double-click to rename · drag into a folder"
              style={{ flex: 1, fontSize: 13, color: activeNotebookId === nb.id ? accent : text2, fontWeight: activeNotebookId === nb.id ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nb.name}</span>
          )}
          <div className="nb-actions" style={{ opacity: 0, display: 'flex', gap: 2 }}>
            {folderId && (
              <button onClick={e => { e.stopPropagation(); removeFromFolder(nb.id, folderId) }}
                title="Remove from folder"
                style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 11, padding: '2px 4px', borderRadius: 4 }}
                onMouseEnter={e => e.currentTarget.style.color = accent}
                onMouseLeave={e => e.currentTarget.style.color = text3}><Icon name="action-move-out" size={12} /></button>
            )}
            <button onClick={e => { e.stopPropagation(); const undo = deleteNotebook(nb.id); if (undo) toast(`"${nb.name}" deleted`, { undo }) }}
              style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 11, padding: '2px 4px', borderRadius: 4 }}
              onMouseEnter={e => e.currentTarget.style.color = red}
              onMouseLeave={e => e.currentTarget.style.color = text3}><Icon name="action-delete" size={12} /></button>
          </div>
          <Icon name={isExpanded ? 'nav-chevron-down' : 'nav-chevron-right'} size={12} style={{ color: text3, flexShrink: 0 }} />
        </div>
        {isExpanded && (
          <div style={{ marginLeft: 11, paddingLeft: 12, borderLeft: `1px solid ${border}` }}>
            {nb.sheets?.map(sheet => {
              const isActive = activeNotebookId === nb.id && nb.activeSheetId === sheet.id
              const isRenaming = renamingSheetId === sheet.id
              return (
                <div key={sheet.id}
                  onClick={() => { if (!isRenaming) { setActiveNotebookId(nb.id); setNotebookActiveSheet(nb.id, sheet.id) } }}
                  onDoubleClick={e => { e.stopPropagation(); setRenamingSheetId(sheet.id); setRenamingSheetLabel(sheet.name) }}
                  title="Double-click to rename"
                  style={{ padding: '6px 10px', borderRadius: 6, fontSize: 13, color: isActive ? accent : text3, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: isActive ? 600 : 400, background: isActive ? accentDim : 'transparent' }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = raised }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}>
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renamingSheetLabel}
                      onChange={e => setRenamingSheetLabel(e.target.value)}
                      onBlur={() => { renameNotebookSheet(nb.id, sheet.id, renamingSheetLabel || sheet.name); setRenamingSheetId(null) }}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
                      onClick={e => e.stopPropagation()}
                      style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: `1px solid ${accent}`, color: text, fontFamily: 'var(--ds-font-body)', fontSize: 12, outline: 'none', minWidth: 0 }}
                    />
                  ) : (
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sheet.name}</span>
                  )}
                  {isActive && !isRenaming && <Icon name="action-check" size={12} style={{ color: accentText }} />}
                  {!isRenaming && nb.sheets.length > 1 && (
                    <button onClick={e => { e.stopPropagation(); const undo = deleteNotebookSheet(nb.id, sheet.id); if (undo) toast(`Sheet "${sheet.name}" deleted`, { undo }) }}
                      style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 11, padding: '2px 4px', borderRadius: 4, opacity: 0.35, flexShrink: 0 }}
                      onMouseEnter={e => { e.currentTarget.style.color = red; e.currentTarget.style.opacity = '1' }}
                      onMouseLeave={e => { e.currentTarget.style.color = text3; e.currentTarget.style.opacity = '0.35' }}><Icon name="action-delete" size={12} /></button>
                  )}
                </div>
              )
            })}
            <button onClick={e => { e.stopPropagation(); addNotebookSheet(nb.id) }}
              style={{ padding: '4px 8px', border: 'none', background: 'none', color: text3, fontSize: 11, cursor: 'pointer', fontFamily: 'var(--ds-font-body)', display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}
              onMouseEnter={e => e.currentTarget.style.color = accent}
              onMouseLeave={e => e.currentTarget.style.color = text3}>
              <Icon name="action-add" size={12} /> New Sheet
            </button>
          </div>
        )}
      </div>
    )
  }
  /* One sheet's controls: whole-table add, then its columns. Shared by
     single-sheet files (rendered directly) and each group of a multi-sheet
     workbook, so both look and behave the same. */
  function renderSheetColumns(file, sheet) {
    const cols = visibleHeaders(sheet)
    return (
      <>
        {/* Whole-table add, visible. Dragging the file name has always
            carried every column, but nothing said so — people dragged
            columns one at a time and got a one-column table each time. */}
        {selectedSidebarCols.length <= 1 && cols.length > 1 && (
          <div style={{ padding: '2px 8px 6px 22px' }}>
            <button
              draggable
              onDragStart={e => { e.stopPropagation(); handleFileDragStart(e, file, sheet) }}
              onClick={() => addColumnsToNotebook(cols.map(col => ({ fileId: file.id, fileName: file.name, sheetName: sheet.name, col })))}
              title="Click to add, or drag onto the canvas"
              style={{ width: '100%', background: accentDim, border: `1px solid ${accent}44`, borderRadius: 6, padding: '4px 8px', fontSize: 11, color: accentText, cursor: 'grab', fontFamily: 'var(--ds-font-body)', fontWeight: 600, textAlign: 'left' }}>
              <Icon name="action-add" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 3 }} />Whole table · {cols.length} columns
            </button>
            <div style={{ fontSize: 11, color: text3, marginTop: 4, lineHeight: 1.35 }}>
              Drag a column for just that one · ⌘/Ctrl or Shift-click to pick several
            </div>
          </div>
        )}
        {cols.map(col => {
          const isSelected = selectedSidebarCols.includes(col.id)
          return (
            <div key={col.id} className="col-row" draggable
              onDragStart={e => handleSidebarDragStart(e, file.id, file.name, sheet.name, col)}
              onClick={e => toggleSidebarSelect(e, col.id)}
              style={{ padding: '6px 8px 6px 22px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6, background: isSelected ? accentDim : 'transparent', border: isSelected ? `1px solid ${accent}44` : '1px solid transparent' }}>
              <div style={{ width: 6, height: 6, borderRadius: 4, background: accent, flexShrink: 0 }} />
              <span title={col.label} style={{ flex: 1, fontSize: 13, color: isSelected ? accent : text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.label}</span>
              <span style={{ fontSize: 11, color: text3 }}>{sheet.rows.length}</span>
              <div className="col-actions">
                <button style={{ color: text3, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: '2px 4px', borderRadius: 4 }} title="Hide column" aria-label="Hide column" onClick={e => { e.stopPropagation(); hideColumn(file.id, sheet.name, col.id) }}><Icon name="status-empty" size={12} /></button>
                <button style={{ color: red, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: '2px 4px', borderRadius: 4 }} title="Delete column" aria-label="Delete column" onClick={e => { e.stopPropagation(); deleteColumn(file.id, sheet.name, col.id) }}><Icon name="action-delete" size={12} /></button>
              </div>
            </div>
          )
        })}
      </>
    )
  }

  function renderFileInSidebar(file, folderId) {
    return (
      <div key={file.id} style={{ marginBottom: 6 }}>
        <div className="file-row"
          draggable
          onDragStart={e => handleFileDragStart(e, file)}
          title="Drag onto the canvas to add every column as one sheet"
          onClick={() => setExpandedFiles(prev => { const next = new Set(prev); next.has(file.id) ? next.delete(file.id) : next.add(file.id); return next })}
          onDragOver={e => {
            if (window.__nbTableDrag) { e.preventDefault(); setDragOverFileId(file.id) }
          }}
          onDragLeave={() => setDragOverFileId(null)}
          onDrop={e => {
            e.preventDefault(); e.stopPropagation()
            if (!window.__nbTableDrag) return
            const drag = window.__nbTableDrag
            const block = drag.block
            window.__nbTableDrag = null

            setFiles(prev => prev.map(f => {
              if (f.id !== file.id) return f
              return {
                ...f,
                sheets: f.sheets.map((s, si) => {
                  if (si !== 0) return s
                  const existingVisible = s.headers.filter(h => !h.hidden)
                  const insertIdx = existingVisible.length
                  const newHeaders = block.headers.map((h, hi) => ({
                    id: `col_${Date.now()}_nb_${hi}_${Math.random().toString(36).slice(2)}`,
                    label: h,
                    index: insertIdx + hi,
                    hidden: false
                  }))
                  const updatedHeaders = [...existingVisible, ...newHeaders].map((h, i) => ({ ...h, index: i }))
                  const maxLen = Math.max(s.rows.length, block.rows.length)
                  const newRows = Array.from({ length: maxLen }, (_, ri) => {
                    const existing = ri < s.rows.length ? [...s.rows[ri]] : Array(insertIdx).fill('')
                    const newCells = block.headers.map((_, hi) => String(block.rows[ri]?.[hi] ?? ''))
                    return [...existing, ...newCells]
                  })
                  return { ...s, headers: updatedHeaders, rows: newRows }
                })
              }
            }))

            deleteNotebookBlock(drag.notebookId, block.id)
            setDragOverFileId(null)
            setExpandedFiles(prev => {
              const next = new Set(prev)
              next.add(file.id)
              return next
            })
          }}
          style={{ padding: '8px 10px', borderRadius: 6, fontSize: 13, color: text, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, background: dragOverFileId === file.id ? accentDim : undefined, border: dragOverFileId === file.id ? `1px solid ${accent}` : '1px solid transparent' }}>
          <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
          <button onClick={e => { e.stopPropagation(); const undo = deleteFile(file.id); if (undo) toast('File deleted', { undo }) }}
            style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 11, padding: '2px 4px', borderRadius: 4, opacity: 0, flexShrink: 0 }}
            className="col-actions"
            onMouseEnter={e => { e.currentTarget.style.color = red; e.currentTarget.style.opacity = '1' }}
            onMouseLeave={e => { e.currentTarget.style.color = text3; e.currentTarget.style.opacity = '0' }}><Icon name="action-delete" size={12} /></button>

          {folderId && (
            <button onClick={e => { e.stopPropagation(); removeFromFolder(file.id, folderId) }}
              title="Remove from folder"
              style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 11, padding: '2px 4px', borderRadius: 4, opacity: 0 }}
              onMouseEnter={e => e.currentTarget.style.opacity = '1'}
              onMouseLeave={e => e.currentTarget.style.opacity = '0'}><Icon name="action-move-out" size={12} /></button>
          )}
          <Icon name={expandedFiles.has(file.id) ? 'nav-chevron-down' : 'nav-chevron-right'} size={12} style={{ color: text3, flexShrink: 0 }} />
        </div>
        {expandedFiles.has(file.id) && file.sheets.length > 0 && (() => {
          const selectedHere = selectedColInfos().filter(c => c.fileId === file.id)
          return (
            <>
              {selectedSidebarCols.length > 1 && selectedHere.length > 0 && (
                <div style={{ padding: '4px 8px 6px 24px' }}>
                  <button onClick={() => addColumnsToNotebook(selectedColInfos())} style={{ background: accentDim, border: `1px solid ${accent}44`, borderRadius: 6, padding: '4px 10px', fontSize: 12, color: accentText, cursor: 'pointer', fontFamily: 'var(--ds-font-body)', fontWeight: 600 }}>
                    <Icon name="action-add" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 3 }} />Add {selectedSidebarCols.length} to notebook
                  </button>
                </div>
              )}
              {/* A workbook with one sheet looks exactly as before. With several,
                  each sheet is its own collapsible group holding the same
                  controls — only the first starts open, so a 12-sheet workbook
                  does not push everything else off the sidebar. */}
              {file.sheets.length === 1
                ? renderSheetColumns(file, file.sheets[0])
                : file.sheets.map((sheet, si) => {
                    const open = isSheetOpen(file.id, sheet.name, si)
                    return (
                      <div key={sheet.name} style={{ marginLeft: 14 }}>
                        <div className="sheet-row"
                          onClick={() => toggleSheetOpen(file.id, sheet.name)}
                          title={`Sheet "${sheet.name}"`}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: open ? text : text2 }}>
                          <Icon name={open ? 'nav-chevron-down' : 'nav-chevron-right'} size={12} style={{ color: text3, flexShrink: 0 }} />
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sheet.name}</span>
                          <span style={{ fontSize: 11, color: text3, fontWeight: 400 }}>{visibleHeaders(sheet).length} cols</span>
                        </div>
                        {open && <div style={{ marginLeft: 6, borderLeft: `1px solid ${border}` }}>{renderSheetColumns(file, sheet)}</div>}
                      </div>
                    )
                  })}
            </>
          )
        })()}
      </div>
    )
  }

  // ── Helpers ──────────────────────────────────────────────────
  const allHiddenCols = files.flatMap(f => f.sheets.flatMap(s => s.headers.filter(h => h.hidden).map(h => ({ fileId: f.id, fileName: f.name, sheetName: s.name, col: h }))))
  const visibleHeaders = (sheet) => sheet.headers.filter(h => !h.hidden)

  // ── Crosscheck ───────────────────────────────────────────────
  // Crosscheck now runs against table blocks that already live on the
  // active notebook sheet — no separate canvas step. Flatten every table
  // block's columns into a single pickable list for the wizard.
  function getActiveNotebook() { return notebooks.find(n => n.id === activeNotebookId) || null }
  function getActiveNotebookSheet() {
    const nb = getActiveNotebook()
    if (!nb) return null
    return nb.sheets?.find(s => s.id === nb.activeSheetId) || nb.sheets?.[0] || null
  }
  function getCrosscheckSourceColumns() {
    const sheet = getActiveNotebookSheet()
    if (!sheet) return []
    const cols = []
    ;(sheet.blocks || []).filter(b => b.type === 'table').forEach(block => {
      (block.headers || []).forEach((h, idx) => {
        cols.push({
          id: `${block.id}::${idx}`,
          label: h || `Column ${idx + 1}`,
          tableName: block.name || 'Table',
          rows: (block.rows || []).map(r => r[idx] ?? ''),
        })
      })
    })
    return cols
  }
  function handleCCAddToNotebook({ headers, rows }) {
    if (!activeNotebookId) return
    const sheet = getActiveNotebookSheet()
    const count = sheet?.blocks?.length || 0
    const x = 160 + (count % 5) * 30
    const y = 160 + (count % 5) * 30
    addNotebookBlock(activeNotebookId, 'table', x, y, headers, rows)
  }

  /* `colors` no longer needs a useMemo: makeColors() returns one of two frozen
     module-level objects, so its identity is already stable across every
     render at a given theme. That stability is load-bearing — it is what lets
     memo() on the block components hold, and a fresh object here would defeat
     every one of them. */

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>

      {/* No `accept`, deliberately. Since §8 every format is importable —
          the ones with a live block become one, and everything else becomes an
          attachment — so a filter here would make the PICKER refuse files that
          DROPPING accepts. Two doors into the same feature disagreeing about
          what it takes is worse than either rule on its own.
          ACCEPT_EXTS still describes what gets a rich block; the sidebar reads
          IMPORT_FORMATS for that. */}
      <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileChange} />

      {/* ── Save status ──────────────────────────────────────────────────
          Fixed, centred at the top, above every panel and rail. Nothing the
          user can collapse, dismiss or scroll away contains it, because the
          two states it reports are the two states in which continuing to work
          is a mistake. */}
      {(saveError || saveStale) && (
        <div role="alert" aria-live="assertive"
          style={{
            position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)',
            zIndex: Z.toast, maxWidth: 'min(560px, calc(100vw - 32px))',
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '10px 14px', borderRadius: 'var(--ds-radius-md)',
            background: saveStale ? 'var(--ds-accent-dim)' : 'var(--ds-amber-bg)',
            border: `1px solid ${saveStale ? accent : amber}`,
            color: saveStale ? accentText : amber,
            boxShadow: 'var(--ds-shadow-lg)',
            fontFamily: 'var(--ds-font-body)', fontSize: 13, lineHeight: 1.5,
          }}>
          <Icon name="status-warning" size={16} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>
            <b>{saveStale ? 'Changed in another tab.' : 'Not saving.'}</b>{' '}
            {saveStale
              ? 'Another tab saved this workspace after you opened it, so nothing here has been written. Copy anything you need, then reload.'
              : saveError}
          </span>
          {saveStale && (
            <button onClick={() => window.location.reload()}
              style={{ marginLeft: 4, flexShrink: 0, padding: '4px 10px', borderRadius: 'var(--ds-radius-xs)', border: `1px solid ${accent}`, background: 'transparent', color: accentText, font: 'inherit', fontWeight: 600, cursor: 'pointer' }}>
              Reload
            </button>
          )}
        </div>
      )}

      {/* Bottom right, fixed, and usually not there at all. Rendered here
          rather than inside the top-right island because it is not chrome you
          operate — it is a status light, and it belongs out of the way of the
          controls. Outside the canvas transform, so `position: fixed` needs no
          portal (see lib/canvasgeom.js for when it would). */}
      {/* ── PEOPLE + THE FLOATING THREAD ──────────────────────────────────
          The panel portals itself; this is just where it is mounted from.

          THE THREAD BEHIND A PERSON IS A REAL CHAT BLOCK, marked `floating` so
          NotebookCanvas does not draw it. That is what lets the window be a
          window while `chat_messages` and every grant check still key on a
          block id that actually exists — see the note on the `floating` filter
          in NotebookCanvas. It is created lazily, on the first click, so a
          workspace where nobody has ever opened a conversation carries none. */}
      <PeoplePanel
        open={peopleOpen}
        people={peopleOnSheet}
        colors={colors}
        activePersonId={activePersonId}
        onClose={() => { setPeopleOpen(false); setActivePersonId(null) }}
        onPickPerson={p => {
          if (!p) { setActivePersonId(null); return }
          ensurePersonThread(p)
          setActivePersonId(p.id)
        }}
        onShareBlockWith={(p, blockId) => {
          const threadId = ensurePersonThread(p)
          if (threadId) handleChatShareBlock(threadId, blockId)
          setActivePersonId(p.id)
        }}>
        {activePersonId && personThreadId(activePersonId) && (
          <ChatBlock
            block={{ id: personThreadId(activePersonId), w: 320, h: 380 }}
            colors={colors}
            dark={dark}
            /* The SAME three network calls the canvas's chat blocks use — a
               floating thread is an ordinary chat block that is not drawn, so
               it must not get a parallel write path that could diverge. */
            onSend={body => postMessage({ blockId: personThreadId(activePersonId), body })}
            onEdit={(id, body) => editMessage(id, personThreadId(activePersonId), body)}
            onUnsend={id => unsendMessage(id, personThreadId(activePersonId))}
            refBlock={sharedBlockFor}
            refLabel={refId => sharedBlockFor(refId)?.name || null}
          />
        )}
      </PeoplePanel>

      <SyncChip
        status={syncStatus}
        colors={colors}
        dark={dark}
        onRetry={() => syncRef.current?.flush()}
      />

      {/* The way back. It has to exist and it has to be obvious: a sidebar
          that hides with no visible handle is a sidebar someone has lost.
          Sits where the panel's own corner was, so the eye is already there. */}
      {sidebarCollapsed && (
        <button onClick={() => setPref('sidebarCollapsed', false)}
          title="Show sidebar"
          aria-label="Show sidebar"
          style={{
            /* Sized and aligned as an ISLAND, not as a button. It sits in the
               same horizontal band as the top row, so 46/12/top-16 are copied
               from there rather than chosen — anything else reads as a stray
               control that happens to be nearby. SIDEBAR_HANDLE_RIGHT in
               NotebookCanvas.js is derived from this geometry; move one and
               the other has to move. */
            position: 'absolute', top: 16, left: 18, zIndex: Z.chromeTop,
            ...islandChrome({ surface, border, dark }),
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '0 12px',
            color: text2, cursor: 'pointer', fontFamily: 'var(--ds-font-body)', fontSize: 13,
            animation: 'dsToastIn 0.18s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = accent; e.currentTarget.style.borderColor = accent }}
          onMouseLeave={e => { e.currentTarget.style.color = text2; e.currentTarget.style.borderColor = border }}>
          <DoubleChevron size={12} dir="right" />
          <Icon name="app-logo" size={14} style={{ color: accentText }} />
        </button>
      )}

      {/* Drop affordance for the whole window.

          pointerEvents:'none' is load-bearing — this sits above everything, so
          without it the overlay itself becomes the drop target and the canvas
          never learns WHERE the file landed. It is a sign, not a surface.

          Deliberately not a per-zone highlight. While a file is in the air the
          question is "will this app take it at all", and that is answered once,
          in the middle of the screen, rather than by hunting for which panel
          lit up. */}
      {fileDragActive && (
        <div aria-hidden="true" style={{
          position: 'fixed', inset: 0, zIndex: Z.panel, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: dark ? 'rgba(16,16,14,0.5)' : 'rgba(245,243,238,0.55)',
          backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
          animation: 'dsScrimIn 0.12s ease',
        }}>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            padding: '26px 34px',
            background: `${surface}f2`,
            backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
            border: `1.5px dashed ${accent}`, borderRadius: 16,
            boxShadow: `0 8px 40px ${dark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.12)'}`,
            fontFamily: 'var(--ds-font-body)',
          }}>
            <Icon name="action-add" size={20} style={{ color: accentText }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: text }}>Drop to import</div>
            <div style={{ fontSize: 12, color: text2, textAlign: 'center', maxWidth: 260, lineHeight: 1.5 }}>
              Spreadsheets, PDFs and images. Dropped on the canvas they land where you let go.
            </div>
          </div>
        </div>
      )}
      {/* Separate picker for Add → Image, so the dialog only offers images. */}
      <input ref={imageInputRef} type="file" accept={IMAGE_EXTS.join(',')} style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setImportError(null); importImage(f) } }} />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', fontFamily: 'var(--ds-font-body)', position: 'relative' }}>

        {/* ── Sidebar (floating island) ── */}
        {/* Collapsed = translated out and made inert, NOT unmounted. Unmounting
            throws away scroll position, which folder is open and which sheet is
            highlighted, so reopening lands you somewhere you did not leave.
            pointerEvents:none is what stops the hidden panel from swallowing
            clicks meant for the canvas underneath it. */}
        <div data-kbd-zone aria-hidden={sidebarCollapsed || undefined} style={{ width: 252, position: 'absolute', top: 16, left: 16, bottom: 16, zIndex: Z.chrome, background: `${surface}f0`, backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: `1px solid ${border}`, borderRadius: 12, boxShadow: `0 8px 40px ${dark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.12)'}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'var(--ds-font-body)',
          transform: sidebarCollapsed ? 'translateX(calc(-100% - 24px))' : 'none',
          opacity: sidebarCollapsed ? 0 : 1,
          pointerEvents: sidebarCollapsed ? 'none' : 'auto',
          transition: 'transform 0.24s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.18s ease',
        }}>
          <div style={{ padding: '12px 12px 6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Icon name="app-logo" size={16} style={{ color: accentText, flexShrink: 0 }} />
              <span style={{ fontFamily: 'var(--ds-font-head)', fontSize: 14, fontWeight: 700, color: text, flex: 1 }}>DataStudio</span>
              <button onClick={() => setPref('sidebarCollapsed', true)}
                title="Hide sidebar"
                aria-label="Hide sidebar"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, padding: 0, borderRadius: 6, background: 'none', border: `1px solid transparent`, color: text3, cursor: 'pointer', flexShrink: 0 }}
                onMouseEnter={e => { e.currentTarget.style.color = accent; e.currentTarget.style.borderColor = border }}
                onMouseLeave={e => { e.currentTarget.style.color = text3; e.currentTarget.style.borderColor = 'transparent' }}>
                <DoubleChevron size={12} dir="left" />
              </button>
            </div>
            <button className="import-btn" onClick={handleImportClick} disabled={importing} style={{ width: '100%', padding: '9px 0', background: accent, color: '#fff', border: 'none', borderRadius: 6, fontFamily: 'var(--ds-font-body)', fontSize: 13, fontWeight: 600, cursor: importing ? 'default' : 'pointer', opacity: importing ? 0.65 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {importing
                ? <><Icon name="status-spinner" size={14} /> Importing…</>
                : <><Icon name="action-import" size={14} /> Import File</>}
            </button>

            {/* Failures are shown, not swallowed. */}
            {importError && (
              <div role="alert" style={{ marginTop: 7, padding: '8px 10px', borderRadius: 6, background: 'var(--ds-red-bg)', border: `1px solid ${red}`, color: red, fontSize: 11, lineHeight: 1.45 }}>
                <span style={{ display: 'flex', gap: 6 }}>
                  <Icon name="status-error" size={14} style={{ marginTop: 1 }} />
                  <span>{importError}</span>
                </span>
                <button onClick={() => setImportError(null)} style={{ display: 'block', marginTop: 4, background: 'none', border: 'none', color: red, opacity: 0.75, fontSize: 11, cursor: 'pointer', padding: 0, fontFamily: 'var(--ds-font-body)', textDecoration: 'underline' }}>Dismiss</button>
              </div>
            )}
            {/* The "Not saving" banner used to live HERE, inside a panel that a
                persisted preference translates off-screen and marks
                aria-hidden. Collapse the sidebar and the single surface
                reporting a failed save, a full disk, or a read-only session
                became invisible — including to screen readers, since
                aria-hidden takes the role="alert" out of the tree with it.

                Worst on the load-failure path: refuseToSave deliberately mounts
                a FRESH EMPTY notebook and tells you the real workspace is
                intact only through this banner. With the sidebar collapsed you
                see a blank canvas, conclude your work is gone, and reach for
                "Delete everything".

                It is now rendered at the top of the shell, outside anything
                that can hide it. */}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button onClick={createFolder}
                style={{ flex: 1, padding: '8px 0', background: 'transparent', border: `1px solid ${border}`, borderRadius: 6, color: text3, fontFamily: 'var(--ds-font-body)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = text3 }}>
                <Icon name="nav-folder" size={14} /> Folder
              </button>
              <button onClick={createNotebook}
                style={{ flex: 1, padding: '8px 0', background: 'transparent', border: `1px solid ${border}`, borderRadius: 6, color: text3, fontFamily: 'var(--ds-font-body)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = text3 }}>
                <Icon name="nav-notebook" size={14} /> Project
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>

            {folders.map(folder => {
              const folderFiles = files.filter(f => folder.itemIds.includes(f.id))
              const folderNotebooks = notebooks.filter(n => folder.itemIds.includes(n.id))
              const isDragOver = folderDragOver === folder.id
              /* One flag for both kinds of drag the folder accepts: a sidebar
                 item being refiled, and a file coming in off the desktop. The
                 ghost row's two states are "something is in the air" and
                 "nothing is", not "which something". */
              const anyDrag = !!sidebarItemDrag || fileDragActive
              return (
                /* The drag handlers sit on the WRAPPER, not on .folder-row.
                   They used to be on the row, which is a sibling of the
                   folder's body — so the "Drag files or projects here" line
                   inside an open folder was not a drop target at all. It read
                   as an invitation and did nothing when you accepted it. The
                   whole folder, header and body, is now one target. */
                <div key={folder.id} style={{ marginBottom: 2 }}
                  onDragOver={e => { if (sidebarItemDrag || hasFileDrag(e)) { e.preventDefault(); setFolderDragOver(folder.id) } }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFolderDragOver(null) }}
                  onDrop={e => {
                    e.preventDefault()
                    setFolderDragOver(null)
                    /* An OS file drop is filed into THIS folder. stopPropagation
                       keeps it from also reaching the window-level fallback,
                       which would import the same file a second time — at the
                       root, so you would get one copy in the folder and one
                       outside it. */
                    if (e.dataTransfer?.files?.length) {
                      e.stopPropagation()
                      importFiles(e.dataTransfer.files, { folderId: folder.id })
                      return
                    }
                    if (sidebarItemDrag) { moveToFolder(sidebarItemDrag.itemId, folder.id); setSidebarItemDrag(null) }
                  }}>
                  <div className="folder-row"
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 6px', borderRadius: 6, border: isDragOver ? `1px solid ${accent}` : '1px solid transparent', background: isDragOver ? accentDim : 'transparent' }}>
                    <span onClick={() => toggleFolder(folder.id)} style={{ display: 'flex', color: text3, cursor: 'pointer', flexShrink: 0 }}>
                      <Icon name={folder.collapsed ? 'nav-chevron-right' : 'nav-chevron-down'} size={12} />
                    </span>
                    <Icon name={folder.collapsed ? 'nav-folder' : 'nav-folder-open'} size={14} style={{ color: text3, flexShrink: 0 }} />
                    
                    {renamingFolderId === folder.id ? (
                      <input autoFocus value={renamingFolderLabel}
                        onChange={e => setRenamingFolderLabel(e.target.value)}
                        onBlur={() => commitFolderRename(folder.id)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
                        onClick={e => e.stopPropagation()}
                        style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: `1px solid ${accent}`, color: text, fontFamily: 'var(--ds-font-body)', fontSize: 13, fontWeight: 600, outline: 'none', minWidth: 0 }} />
                    ) : (
                      <span onClick={() => toggleFolder(folder.id)} style={{ flex: 1, fontSize: 13, fontWeight: 600, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>{folder.name}</span>
                    )}
                    <div className="folder-actions" style={{ opacity: 0, display: 'flex', gap: 2, flexShrink: 0 }}>
                      <button onClick={e => { e.stopPropagation(); setRenamingFolderId(folder.id); setRenamingFolderLabel(folder.name) }}
                        style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 12, padding: '2px 4px', borderRadius: 4, lineHeight: 1 }}
                        onMouseEnter={e => e.currentTarget.style.color = accent}
                        onMouseLeave={e => e.currentTarget.style.color = text3} aria-label="Rename folder"><Icon name="action-rename" size={12} /></button>
                      <button onClick={e => { e.stopPropagation(); deleteFolder(folder.id) }}
                        style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 12, padding: '2px 4px', borderRadius: 4, lineHeight: 1 }}
                        onMouseEnter={e => e.currentTarget.style.color = red}
                        onMouseLeave={e => e.currentTarget.style.color = text3} aria-label="Delete folder"><Icon name="action-delete" size={12} /></button>
                    </div>
                  </div>
                  {!folder.collapsed && (
                    /* 10px of padding wasn't enough to read as nesting — a
                       notebook inside a folder sat at almost the same x as one
                       outside it. Deeper indent plus a guide line down the left
                       edge, so containment is visible rather than inferred. */
                    <div style={{ marginLeft: 11, paddingLeft: 12, borderLeft: `1px solid ${border}` }}>
                      {folderFiles.map(file => renderFileInSidebar(file, folder.id))}
                      {folderNotebooks.map(nb => renderNotebookInSidebar(nb, folder.id))}
                      {folderFiles.length === 0 && folderNotebooks.length === 0 && (
                        /* Empty-folder drop target, in two states.

                           IDLE it is a ghost row: the same height, gap and
                           type as a real file row, just drained of colour,
                           with a + where the file icon goes. The folder then
                           reads as a list with one empty slot rather than a
                           panel with a hole in it, which is the whole reason
                           the italic sentence looked wrong — it was the only
                           thing in the sidebar shaped like nothing else.

                           DRAGGING it inflates into a bordered well. The
                           strong affordance costs nothing when it is not
                           needed, because it only exists while something is
                           actually in flight.

                           pointerEvents:none is load-bearing. The drop
                           handlers live on the folder wrapper; if this div
                           could take pointer events it would become the
                           dragleave relatedTarget and flicker the highlight
                           off every time the cursor crossed it. */
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          margin: '2px 0 4px',
                          padding: anyDrag ? '9px 8px' : '5px 8px',
                          borderRadius: 6,
                          border: `1px ${anyDrag ? 'solid' : 'dashed'} ${isDragOver ? accent : anyDrag ? border : 'transparent'}`,
                          background: isDragOver ? accentDim : 'transparent',
                          color: isDragOver ? accent : text3,
                          fontSize: 12,
                          opacity: anyDrag ? 1 : 0.7,
                          pointerEvents: 'none',
                          transition: 'padding 0.14s ease, opacity 0.14s ease, background 0.14s ease, border-color 0.14s ease, color 0.14s ease',
                        }}>
                          <Icon name="action-add" size={12} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {isDragOver ? (fileDragActive ? 'Drop to file here' : 'Drop to add') : 'Drag files or projects here'}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {!hydrated && !saveError && (
              <div aria-hidden style={{ margin: '10px 6px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{
                    height: 30, borderRadius: 'var(--ds-radius-sm)', background: raised,
                    opacity: 0.55 - i * 0.12,
                  }} />
                ))}
              </div>
            )}

            {files.filter(f => !folders.some(folder => folder.itemIds.includes(f.id))).map(file => renderFileInSidebar(file, null))}

            {notebooks.filter(n => !folders.some(folder => folder.itemIds.includes(n.id))).map(nb => renderNotebookInSidebar(nb, null))}

            {/* SHARED WITH ME.
                Below your own work and visually quieter, because it is not
                yours: somebody else can revoke any of it at any moment, and
                mixing it into the main list makes a project you might lose
                look exactly like one you cannot.

                Rendered only when non-empty. An always-present empty section
                claims "nothing is shared with you", which is a different and
                stronger statement than "we have not heard about any", and with
                no network the second is the only honest one. */}
            {sharedWithMe.length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${border}` }}>
                <div style={{
                  padding: '0 10px 6px', fontSize: 11, letterSpacing: '0.06em',
                  textTransform: 'uppercase', color: text3, fontWeight: 600,
                }}>Shared with me</div>
                {sharedWithMe.map(row => {
                  const nb = notebooks.find(n => n.id === row.docId)
                  const whole = row.levels.has(LEVEL_PROJECT)
                  const label = nb?.name || (whole ? 'A shared project' : 'Shared with you')
                  const detail = whole
                    ? 'whole project'
                    : row.sheets.length === 1
                      ? (sheetNameMap[row.sheets[0]] || 'one sheet')
                      : row.sheets.length > 1
                        ? `${row.sheets.length} sheets`
                        : 'one block'
                  return (
                    <div key={row.docId}
                      onClick={() => { if (nb) setActiveNotebookId(nb.id) }}
                      style={{
                        padding: '8px 10px', borderRadius: 6, display: 'flex',
                        alignItems: 'center', gap: 8, cursor: nb ? 'pointer' : 'default',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = raised}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <Icon name="share-link" size={12} style={{ color: text3, flexShrink: 0, alignSelf: 'flex-start', marginTop: 2 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            flex: 1, fontSize: 13, color: text2, overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>{label}</span>
                          <span style={{ fontSize: 11, color: text3, flexShrink: 0 }}>{detail}</span>
                        </div>
                        {/* "Shared from {name}".

                            .ds-chip verbatim from globals.css — accent-dim
                            ground, accent text, mono, small pill: the same chip
                            already used for counts and mode indicators, so a
                            reader recognises the shape before reading it.

                            NOT PERSON-HUED, and that is a judgment call worth
                            stating. Matching this to personHue(sender) would be
                            consistent with the presence dot, but a sidebar
                            holding several shared projects would then be a
                            column of differently-coloured chips, which reads as
                            noisy list decoration rather than one recognisable
                            "this came from a share" category. The NAME inside
                            carries the identity; the chip colour carries the
                            category. Reversible if it reads wrong once there
                            are four of these stacked up.

                            Its own line rather than squeezed onto the first: at
                            sidebar width the project name, the scope detail and
                            a sender chip cannot share a row without the name
                            being the one that gets truncated, and the name is
                            what people scan for. */}
                        {row.from && (
                          <div style={{ marginTop: 3 }}>
                            <span className="ds-chip" style={{ maxWidth: '100%', overflow: 'hidden' }}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                Shared from {knownPerson(row.from) || 'someone'}
                              </span>
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* `hydrated &&` matters. notebooks starts as [] and fills after an
                async IndexedDB read, so a user with a large workspace saw "No
                files yet" for a beat before their work appeared. Showing an
                empty state for data that exists is worse than showing nothing:
                for the length of that frame the app is telling someone their
                projects are gone. */}
            {hydrated && files.length === 0 && notebooks.length <= 1 && folders.length === 0 && (
              <div style={{ margin: '16px 6px', padding: '14px 12px', borderRadius: 8, border: `1px dashed ${border}`, color: text3, fontSize: 13, lineHeight: 1.6 }}>
                <div style={{ textAlign: 'center', color: text2, fontWeight: 600, marginBottom: 10 }}>No files yet</div>
                {/* THE FORMAT LIST IS GONE, and it is worth saying why rather
                    than leaving a gap where it was.

                    It listed sixteen extensions across four groups. For the
                    person this empty state exists for — someone who has just
                    opened the app and has nothing in it — ".xlsm .xlsb .wk1"
                    answers a question they have not asked. It also could not
                    be complete: images, PDFs, markdown and every attachment
                    type are accepted too, so the list simultaneously overwhelmed
                    and under-promised.

                    "Drag a file in" is the whole instruction. The importer
                    accepts essentially anything and says so honestly in its
                    error message when it cannot. */}
                <div style={{ textAlign: 'center', fontSize: 12, color: text3, lineHeight: 1.6 }}>
                  Drag a spreadsheet, PDF or image here,<br />or start typing on the canvas.
                </div>
              </div>
            )}
          </div>

          {allHiddenCols.length > 0 && (
            <div style={{ borderTop: `1px solid ${border}`, padding: '8px 10px' }}>
              <button onClick={() => setShowHidden(!showHidden)} style={{ background: 'none', border: 'none', cursor: 'pointer', width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontFamily: 'var(--ds-font-body)', fontSize: 12, color: text3 }}>
                <Icon name={showHidden ? 'nav-chevron-down' : 'nav-chevron-right'} size={12} /> Hidden ({allHiddenCols.length})
              </button>
              {showHidden && allHiddenCols.map(({ fileId, sheetName, col }) => (
                <div key={col.id} style={{ padding: '4px 4px 4px 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 6, height: 6, borderRadius: 4, background: border, flexShrink: 0 }} />
                  <span title={col.label} style={{ flex: 1, fontSize: 12, color: text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'line-through' }}>{col.label}</span>
                  <button onClick={() => restoreColumn(fileId, sheetName, col.id)} style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 4, cursor: 'pointer', color: accentText, fontSize: 12, padding: '2px 6px', fontFamily: 'var(--ds-font-body)', display: 'flex', alignItems: 'center' }} title="Restore column" aria-label="Restore column"><Icon name="action-move-out" size={12} /></button>
                </div>
              ))}
            </div>
          )}
          <div style={{ padding: '8px 12px 12px', borderTop: `1px solid ${border}` }}>
            {/* Real numbers from navigator.storage.estimate(), not a guess.
                Storage used to fail silently at ~5MB with nothing on screen. */}
            {usage && usage.quota > 0 && (
              <div title={`${formatBytes(usage.usage)} used of about ${formatBytes(usage.quota)} available to this site`}
                style={{ marginBottom: 8 }}>
                {/* SIZES, AFTER "the storage icon is almost invisible".

                    It was an 11px glyph next to 9.5px uppercase mono in
                    text3 — the dimmest colour in the palette — over a 3px bar.
                    Legible in a screenshot at 200%, not on a laptop at arm's
                    length.

                    The fix is deliberately asymmetric. The ICON goes to 15px
                    and the BAR to 5px, because both are shape rather than
                    language and read at a glance. The LABEL stays 9.5px mono
                    in text3 and the number moves only one step to text2. So
                    the row gains legibility without gaining loudness — which
                    is the whole brief, since the alternative reading of
                    "make it bigger" is "make storage a headline", and a tool
                    that keeps drawing attention to its own plumbing feels
                    fragile. */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: text3, fontFamily: 'var(--ds-font-mono)', marginBottom: 4 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="storage-drive" size={16} />
                    STORAGE
                    {/* THE "AT RISK" BADGE IS GONE, DELIBERATELY.

                        It sat permanently in the sidebar of a tool people open
                        in front of clients, in amber, saying their work was at
                        risk. It is a browser-eviction technicality — the
                        storage API declining a guarantee — and no reader takes
                        it that way; they read "this app might lose my data".
                        That is a sentence you cannot un-say in a meeting.

                        The FACT is still true and still worth knowing, so it
                        lives in Settings → Storage, worded plainly, where
                        somebody has gone looking for it. A permanent alarm on
                        the main surface is not the same thing as informing
                        someone, and it stops being true at all once the
                        workspace syncs to a backend.

                        The meter itself stays: it is the thing that becomes a
                        plan limit. */}
                  </span>
                  <span style={{ color: text2 }}>{formatBytes(usage.usage)}</span>
                </div>
                <div style={{ height: 5, borderRadius: 4, background: raised, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 4,
                    width: `${Math.min(100, Math.max(1, usage.pct * 100))}%`,
                    background: usage.pct > 0.9 ? red : usage.pct > 0.6 ? amber : accent,
                    transition: 'width .4s ease, background .3s ease',
                  }} />
                </div>
              </div>
            )}
            {/* The theme toggle moved into Settings — it was the only thing
                down here besides the meter, and two places to change one
                setting is one too many. */}
          </div>
        </div>

        {/* ── Top-right chrome: Builder, then Settings ──
            One absolutely-positioned row holding two independent islands.
            Settings keeps its own wrapper because its outside-click dismissal
            measures containment against it, and the Builder button has to sit
            OUTSIDE that box or pressing Builder would leave Settings open
            behind the panel. */}
        {/* ONE ISLAND, NOT FOUR. Builder, People, Settings and Account used to be
            four separate floating buttons, each with its own glass, border and
            shadow. Beside the title island and the centre toolbar, which each
            hold many buttons, that read as a different kind of object. They now
            share one island shaped like the centre toolbar: 46px, ds-tbtn
            buttons inside, 10px side padding, 6px gap.

            THE GLASS IS A LAYER BEHIND THE BUTTONS, NOT ON THIS DIV. Builder's
            panel is frosted and opens inside this element. A backdrop-filter
            on an ancestor makes it the backdrop root, so the panel's own blur
            would only sample this island's backdrop and stop blurring the
            canvas. zIndex -1 keeps the layer under the buttons: this div is
            already a stacking context (absolute + zIndex). */}
        <div style={{ position: 'absolute', top: 16, right: 16, zIndex: Z.chrome, display: 'flex', alignItems: 'center', gap: 6, height: ISLAND_H, padding: '0 10px', boxSizing: 'border-box', fontFamily: 'var(--ds-font-body)' }}>
          <div aria-hidden="true" style={{ ...islandChrome({ surface, border, dark }), position: 'absolute', inset: 0, height: 'auto', zIndex: -1, pointerEvents: 'none' }} />

          {/* ── Builder ──
              §9.1. A separate optional mode, deliberately additive: it opens a
              panel beside the canvas and changes nothing about the canvas, the
              sidebar or any block. Someone who never presses it is using the
              same app they were using yesterday.

              action-duplicate, of the three names offered, is the only honest
              one. tool-formula is a summation sigma and Builder computes
              nothing; nav-sheet is the sheet glyph and would claim this button
              adds a sheet. Two overlapping frames is what a template IS — a
              workspace with copies made from it — and it is the panel's
              primary verb. */}
          <div data-kbd-zone style={{ position: 'relative' }}>
            <button onClick={() => setBuilderOpen(o => !o)} aria-label="Builder" aria-expanded={builderOpen}
              data-ds-builder-button
              className={`ds-tbtn${builderOpen ? ' is-on' : ''}`}>
              <Icon name="action-duplicate" size={14} />
              Builder
            </button>

            {builderOpen && (
              <BuilderPanel
                colors={colors}
                dark={dark}
                notebook={notebooks.find(n => n.id === activeNotebookId) || null}
                onUseTemplate={addNotebookFromTemplate}
                onClose={() => setBuilderOpen(false)}
                visualsOn={visualsOn}
                /* Turning it ON closes Builder: the bar is at the bottom of the
                   canvas and the next thing you do is use it. */
                onToggleVisuals={() => { if (!visualsOn) setBuilderOpen(false); setVisualsOn(!visualsOn) }}
              />
            )}
          </div>

          {/* ── Settings island ──
              Was a "Free plan" label next to an emoji avatar: two pieces of
              chrome that did nothing and implied an account system that didn't
              exist yet. The account system exists now and has its own button to
              the RIGHT of this one; what stayed here is the rest — appearance,
              canvas, keyboard, and where your data lives.

              THE THREE READ AS ONE SET, AND THE ORDER IS THE ARGUMENT.

              Builder · Settings · Account, left to right, which is how often
              you touch them: the builder is a working tool, settings are
              occasional, the account is rare. Account was briefly in the
              middle — a leftover from when it was a circle and needed to sit
              beside something to be recognised — and putting the least-used
              control between the two most-used ones costs a moment of aiming
              every single time.

              They share this exact button: same padding, radius, blur,
              type size, weight and open-state accent. Builder used to be
              600 weight while the other two were normal, which at 12px reads
              as one real button and two labels rather than three of a kind. */}
          {/* ── People ──
              THE ENTRY POINT SHARING NEVER HAD.

              The header note above says SharePanel is built and unwired because
              "where sharing is triggered from is an open question". This is the
              answer: sharing and chat are the same list, because they are the
              same decision — which colleague, and what do they get to see.
              Clicking a person shares this sheet with them if they do not have
              it and opens the conversation; dragging a block onto a row shares
              that specific block and drops a reference card into the thread.

              Same button shape as Settings beside it, deliberately — three of a
              kind rather than one real button and two labels. */}
          <button onClick={() => setPeopleOpen(o => !o)} aria-label="People" aria-expanded={peopleOpen} data-menu-toggle="people"
            className={`ds-tbtn${peopleOpen ? ' is-on' : ''}`}>
            <Icon name="share-people" size={14} />
            People
          </button>

          <div ref={settingsRef} data-kbd-zone style={{ position: 'relative' }}>
            <button onClick={() => setSettingsOpen(o => !o)} aria-label="Settings" aria-expanded={settingsOpen}
              className={`ds-tbtn${settingsOpen ? ' is-on' : ''}`}>
              <Icon name="settings-gear" size={14} />
              Settings
            </button>

            {settingsOpen && (
              <SettingsPanel
                dark={dark} setDark={setDark}
                prefs={prefs} setPref={setPref}
                usage={usage} persisted={persisted} formatBytes={formatBytes}
                onDeleteAllData={deleteAllLocalData}
                syncStatus={syncStatus}
                account={account}
                /* The background is the ACTIVE notebook's, not a pref. With no
                   notebook open the section says so instead of editing nothing. */
                canvasNotebook={notebooks.find(n => n.id === activeNotebookId) || null}
                onCanvasBgChange={patch => activeNotebookId && updateNotebookCanvasBg(activeNotebookId, patch)}
              />
            )}
          </div>

          {/* ── Account ──
              A circle among two labelled buttons: the account is a person, not
              a verb, and the shape says so faster than a third word would. */}
          <AccountButton
            account={account}
            colors={colors}
            dark={dark}
            onChanged={loadAccount}
            onSignOut={signOutAndMaybeWipe}
          />
        </div>

        {/* ── Main: the notebook workspace, or the empty one ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* THE STATE THAT REPLACED THE UNDELETABLE PROJECT.

              This branch used to render nothing at all, which is why the app
              kept a phantom notebook alive: with no notebook there was no
              canvas, and with no canvas the main area was a void. So deleting
              your last project silently created another one, and a first run
              began with a "My Project" nobody made.

              `hydrated &&` for the same reason the sidebar's empty state has
              it — notebooks starts as [] and fills after an async IndexedDB
              read, and telling somebody their work is gone for one frame is
              worse than showing nothing for one frame. */}
          {hydrated && !(activeNotebookId && notebooks.find(n => n.id === activeNotebookId)) && (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 14, padding: 40,
            }}>
              <div style={{ fontFamily: 'var(--ds-font-display)', fontSize: 20, color: text2 }}>
                {notebooks.length > 0 ? 'No project open' : 'Nothing here yet'}
              </div>
              <div style={{
                fontFamily: 'var(--ds-font-body)', fontSize: 13, color: text3,
                lineHeight: 1.7, textAlign: 'center', maxWidth: 380,
              }}>
                {notebooks.length > 0
                  ? 'Pick one from the sidebar, or start a new one.'
                  : 'Start a project, or drag a spreadsheet, PDF or image anywhere on this page — a project is created for it.'}
              </div>
              <button onClick={createNotebook}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginTop: 4,
                  padding: '10px 16px', borderRadius: 10,
                  background: `${surface}ee`, backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                  border: `1px solid ${border}`,
                  boxShadow: `0 4px 24px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.08)'}`,
                  fontFamily: 'var(--ds-font-body)', fontSize: 13, color: text2, cursor: 'pointer',
                }}>
                <Icon name="action-plus" size={14} />
                New project
              </button>
            </div>
          )}

          {activeNotebookId && notebooks.find(n => n.id === activeNotebookId) && (
            <NotebookCanvas
              nb={notebooks.find(n => n.id === activeNotebookId)}
              mindMapMode={mindMapOn}
              onMindMapModeChange={setMindMapOn}
              visualsOn={visualsOn}
              onVisualsChange={setVisualsOn}
              dark={dark}
              colors={colors}
              prefs={prefs}
              notebooks={notebooks}
              onTeleport={teleportTo}
              revealRequest={revealRequest}
              onRevealHandled={() => setRevealRequest(null)}
              onAddBlock={(type, x, y, h1, r1, w, h, patch) => addNotebookBlock(activeNotebookId, type, x, y, h1, r1, w, h, patch)}
              onChatSend={(blockId, body) => postMessage({ blockId, body })}
              onChatEdit={(id, blockId, body) => editMessage(id, blockId, body)}
              onChatUnsend={(id, blockId) => unsendMessage(id, blockId)}
              onChatShareBlock={handleChatShareBlock}
              /* THE ONLY PATH from a shared block's id to its contents.

                 lib/shares.js's fetchSharedBlocks has always fetched these;
                 lib/sync.js now keeps them in lib/sharing.js's store instead of
                 discarding them. This layer is where that store may be read —
                 the canvas and everything under it must stay free of the
                 network half, which `npm run check:tree` enforces. */
              onResolveSharedBlock={sharedBlockFor}
              /* Document export. Here rather than in the canvas because
                 downloading is an app-level concern — the same reason every
                 other export goes through this layer — and because a real
                 .docx needs lib/zip.js, which the render tree must not import. */
              onExportDocument={(block, what) => {
                try {
                  if (what === 'save') {
                    /* Autosave already owns persistence; the Quick Access Save
                       button exists because Word's does and people reach for it.
                       Flushing rather than pretending it did nothing is the
                       honest response to a press. */
                    debouncedSaveRef.current?.flush?.()
                    toast('Saved')
                    return
                  }
                  if (what === 'pdf') { documentToPdf(block); return }
                  const { blob, filename, warnings } = documentToDocx(block)
                  download(blob, filename)
                  /* Said out loud. A table that came across as prose looks like
                     it worked, which is the worst kind of export bug. */
                  if (warnings.length) toast(warnings[0], { tone: 'warn' })
                } catch (err) {
                  toast(err?.message || 'That export could not be produced.', { tone: 'warn' })
                }
              }}
              /* Dragging a block out of the canvas and onto a row in the People
                 panel. The canvas hit-tests the row on release (it has to —
                 that panel is portalled outside its coordinate space) and hands
                 back the row's id; the share itself is the same
                 handleChatShareBlock the in-canvas chat drop uses, so there is
                 one code path for "this block, into that thread". */
              onShareBlockWithPerson={(personId, blockId) => {
                const person = peopleOnSheet.find(p => p.id === personId)
                if (!person) return
                const threadId = ensurePersonThread(person)
                if (!threadId) return
                handleChatShareBlock(threadId, blockId)
                setPeopleOpen(true)
                setActivePersonId(person.id)
              }}
              onAddConnection={(conn) => addNotebookConnection(activeNotebookId, conn)}
              onDeleteConnection={(connId) => deleteNotebookConnection(activeNotebookId, connId)}
              onUpdateConnection={(connId, patch) => updateNotebookConnection(activeNotebookId, connId, patch)}
              onUpdateBlock={(blockId, patch) => updateNotebookBlock(activeNotebookId, blockId, patch)}
              onDeleteBlock={(blockId) => deleteNotebookBlock(activeNotebookId, blockId)}
              /* Resolves to the undo, or null if nothing went. The canvas
                 raises the toast because it is the one that knows whether the
                 block held anything worth announcing. */
              onDeleteBlocks={(ids) => deleteNotebookBlocks(activeNotebookId, ids)}
              onRenameNotebook={(name) => renameNotebook(activeNotebookId, name)}
              onRenameSheet={(sheetId, name) => renameNotebookSheet(activeNotebookId, sheetId, name)}
              onOpenCrosscheck={() => setShowCCWizard(true)}
              onDropFiles={(list, x, y, extra) => importFiles(list, { at: { x, y }, ...extra })}
              onDropColumn={(x, y) => {
                const d = dragData.current
                if (!d || d.type !== 'sidebar') return
                const { headers, rows } = buildTableFromCols(d.cols)
                addNotebookBlock(activeNotebookId, 'table', Math.max(0, x - 160), Math.max(0, y - 20), headers, rows)
                dragData.current = null
              }}
              onPickImage={() => imageInputRef.current?.click()}
              onAddShape={(shape) => addNotebookShape(activeNotebookId, shape)}
              onUpdateShape={(id, patch) => updateNotebookShape(activeNotebookId, id, patch)}
              onDeleteShapes={(ids) => deleteNotebookShapes(activeNotebookId, ids)}
              onAddDrawing={(drawing) => addNotebookDrawing(activeNotebookId, drawing)}
              onDeleteDrawing={(drawingId) => deleteNotebookDrawing(activeNotebookId, drawingId)}
              onClearDrawings={() => clearNotebookDrawings(activeNotebookId)}
              onUndo={undoEdit}
              onRedo={redoEdit}
              onPasteBlocks={payload => pasteIntoNotebook(activeNotebookId, payload)}
              onAddSheet={() => addNotebookSheet(activeNotebookId)}
              onDeleteSheet={(sheetId) => deleteNotebookSheet(activeNotebookId, sheetId)}
              onSetActiveSheet={(sheetId) => setNotebookActiveSheet(activeNotebookId, sheetId)}
              onRemoveTableColumn={(blockId, colIdx) => {
                const nb = notebooks.find(n => n.id === activeNotebookId)
                const sheet = nb?.sheets?.find(s => s.id === nb.activeSheetId) || nb?.sheets?.[0]
                const table = sheet?.blocks?.find(b => b.id === blockId)
                if (!table || table.type !== 'table') return
                if (table.headers.length <= 1) {
                  deleteNotebookBlock(activeNotebookId, blockId)
                  return
                }
                updateNotebookBlock(activeNotebookId, blockId, {
                  headers: table.headers.filter((_, i) => i !== colIdx),
                  rows: table.rows.map(row => row.filter((_, i) => i !== colIdx)),
                })
              }}
            />
          )}
        </div>
      </div>

      <CrosscheckPanel
        tables={getActiveNotebookSheet()?.blocks?.filter(b => b.type === 'table') || []}
        onWriteToTable={(id, patch) => updateNotebookBlock(activeNotebookId, id, patch)}
        open={showCCWizard}
        onClose={() => setShowCCWizard(false)}
        sourceColumns={getCrosscheckSourceColumns()}
        onAddToNotebook={handleCCAddToNotebook}
      />

      {/* Last in the tree and portalled out of it, so it is never inside
          anything that could clip or transform it. */}
      <ConfirmDialog
        open={!!dialog}
        title={dialog?.title}
        body={dialog?.body}
        tone={dialog?.tone}
        actions={dialog?.actions}
        onResolve={resolveDialog}
      />
    </div>
  )
}
