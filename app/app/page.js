'use client'
import { useState, useRef, useEffect, useMemo } from 'react'
import { useTheme } from '../providers'
import * as XLSX from 'xlsx'
import NotebookCanvas from '../../components/notebook/NotebookCanvas'
import CrosscheckPanel from '../../components/tools/CrosscheckPanel'
import { saveState, loadState, clearState, debounce, SAVE_OK, storageEstimate, formatBytes } from '../../lib/persistence'
import { pruneImages, requestPersistence, idbClear, STORE_IMAGES } from '../../lib/idb'
import { processImageFile, putImage, newImageId, IMAGE_EXTS, MAX_IMAGE_BYTES } from '../../lib/images'
import { SHORTCUT_GROUPS } from '../../lib/shortcuts'

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
const ACCEPT_EXTS = [...IMPORT_FORMATS.flatMap(f => f.exts), ...ALSO_ACCEPTED, ...IMAGE_EXTS].join(',')
const DATA_EXTS = new Set([...IMPORT_FORMATS.flatMap(f => f.exts), ...ALSO_ACCEPTED])
const extOf = name => {
  const m = /\.[a-z0-9]+$/i.exec(name || '')
  return m ? m[0].toLowerCase() : ''
}

export default function AppPage() {
  const { dark, setDark } = useTheme()

  const [files, setFiles] = useState([])
  const [expandedFiles, setExpandedFiles] = useState(new Set())
  const [showHidden, setShowHidden] = useState(false)
  const [showCCWizard, setShowCCWizard] = useState(false)
  const [dragOverFileId, setDragOverFileId] = useState(null)
  const [selectedSidebarCols, setSelectedSidebarCols] = useState([])

  const [folders, setFolders] = useState([])
  const [notebooks, setNotebooks] = useState([])
  const [activeNotebookId, setActiveNotebookId] = useState(null)
  const [expandedNotebookIds, setExpandedNotebookIds] = useState(new Set())
  const [renamingFolderId, setRenamingFolderId] = useState(null)
  const [renamingFolderLabel, setRenamingFolderLabel] = useState('')
  const [folderDragOver, setFolderDragOver] = useState(null)
  const [sidebarItemDrag, setSidebarItemDrag] = useState(null)
  const [renamingNotebookId, setRenamingNotebookId] = useState(null)
  const [renamingNotebookLabel, setRenamingNotebookLabel] = useState('')
  const [renamingSheetId, setRenamingSheetId] = useState(null)
  const [renamingSheetLabel, setRenamingSheetLabel] = useState('')

  function freshNotebook() {
    const id = `notebook_${Date.now()}`
    const sheetId = `sheet_${Date.now()}`
    return { id, name: 'My Notebook', sheets: [{ id: sheetId, name: 'Sheet 1', blocks: [] }], activeSheetId: sheetId }
  }

  // Load persisted state on mount, exactly once. DataStudio is always the
  // notebook workspace now, so we guarantee a notebook exists and is active
  // as soon as the app boots — first-run users land straight in a blank
  // notebook instead of an empty shell.
  /* Load is now async (IndexedDB). `hydrated` gates the first save so an
     empty initial render can't overwrite a real workspace before it arrives. */
  const [hydrated, setHydrated] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [importError, setImportError] = useState(null)
  const [importing, setImporting] = useState(false)
  const [usage, setUsage] = useState(null)
  // null = not asked yet, true = protected from eviction, false = refused
  const [persisted, setPersisted] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const settingsRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    loadState().then(saved => {
      if (cancelled) return
      let initialNotebooks = saved?.notebooks?.length ? saved.notebooks : []
      const initialFolders = saved?.folders?.length ? saved.folders : []
      if (initialNotebooks.length === 0) {
        const nb = freshNotebook()
        initialNotebooks = [nb]
        setActiveNotebookId(nb.id)
      } else {
        setActiveNotebookId(initialNotebooks[0].id)
      }
      setNotebooks(initialNotebooks)
      setFolders(initialFolders)
      setHydrated(true)
    }).catch(err => {
      if (cancelled) return
      // Even a total load failure must leave a usable app.
      const nb = freshNotebook()
      setNotebooks([nb]); setActiveNotebookId(nb.id); setHydrated(true)
      setSaveError(`Could not read your saved workspace: ${err.message}`)
    })
    /* Ask the browser to keep this origin's storage. Without it IndexedDB is
       best-effort and can be evicted under disk pressure — fine for a cache,
       not for the only copy of someone's work. Asking at load rather than on
       first save means the answer is known before there's anything to lose. */
    requestPersistence().then(({ supported, persisted: ok }) => {
      if (!cancelled) setPersisted(supported ? ok : null)
    })
    storageEstimate().then(u => { if (!cancelled) setUsage(u) })

    return () => { cancelled = true }
  }, [])

  /* Debounced auto-save, 600ms after the last change.
     saveState resolves with an outcome rather than throwing — a failed save
     used to be a console.warn nobody saw, so people kept working on a
     workspace that had silently stopped persisting. */
  const debouncedSaveRef = useRef(null)
  if (!debouncedSaveRef.current) {
    debouncedSaveRef.current = debounce(async (state, onResult) => {
      const res = await saveState(state)
      onResult(res)
    }, 600)
  }
  useEffect(() => {
    if (!hydrated) return
    debouncedSaveRef.current({ notebooks, folders }, res => {
      setSaveError(res.status === SAVE_OK ? null : res.error)
      if (res.status === SAVE_OK) {
        // Drop image bytes no block references any more, then refresh the meter.
        const live = []
        notebooks.forEach(n => n.sheets?.forEach(s => s.blocks?.forEach(b => {
          if (b.type === 'image' && b.imageId) live.push(b.imageId)
        })))
        pruneImages(live).then(() => storageEstimate().then(setUsage))
      }
    })
  }, [notebooks, folders, hydrated])

  /* Warn before closing only when a save is actually outstanding. The old
     handler fired whenever any block existed, i.e. almost always — training
     everyone to dismiss it, which meant the one time it mattered it was
     ignored. */
  useEffect(() => {
    if (!saveError) return
    function handleBeforeUnload(e) {
      e.preventDefault()
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [saveError])

  useEffect(() => { window.__nbTableDrag = null }, [])

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

  const base      = dark ? '#1A1917' : '#F5F3EE'
  const surface   = dark ? '#201F1C' : '#EDEAE3'
  const raised    = dark ? '#262522' : '#E4E1D8'
  const border    = dark ? '#2E2D29' : '#D5D1C7'
  const text      = dark ? '#E8E6E1' : '#1A1917'
  const text2     = dark ? '#9A9790' : '#6B6860'
  const text3     = dark ? '#5A5955' : '#A09D97'
  const accent    = dark ? '#5B5FE8' : '#1D9E75'
  const accentDim = dark ? '#1e2057' : '#d0f0e4'
  const green     = '#4ade80'
  const red       = '#f87171'
  const amber     = '#E8B85B'

  // ── File import ──────────────────────────────────────────────
  function handleImportClick() { fileInputRef.current.click() }

  /* Import router.
     ------------------------------------------------------------------
     The previous version piped every file's bytes straight into XLSX.read
     with no type check, no try/catch and no reader.onerror. XLSX.read throws
     inside the FileReader callback, where the exception has nowhere to go —
     so an unsupported file (an image, say) produced absolutely nothing: no
     error, no message, no console output. That is why importing an image
     appeared to do nothing at all.

     Now: route by extension, validate, and surface every failure. */
  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setImportError(null)
    const ext = extOf(file.name)

    if (IMAGE_EXTS.includes(ext)) return importImage(file)
    if (DATA_EXTS.has(ext)) return importWorkbook(file)

    setImportError(
      `"${file.name}" isn't a format DataStudio can read. Spreadsheets: ${[...DATA_EXTS].slice(0, 6).join(' ')}… · Images: ${IMAGE_EXTS.join(' ')}`
    )
  }

  async function importImage(file) {
    if (!activeNotebookId) { setImportError('Open a notebook before adding an image.'); return }
    setImporting(true)
    try {
      const processed = await processImageFile(file)
      const id = newImageId()
      await putImage(id, {
        blob: processed.blob, width: processed.width, height: processed.height,
        type: processed.type, name: processed.name, addedAt: Date.now(),
      })
      // Size the block to the image's aspect ratio, capped so a tall photo
      // doesn't arrive taller than the viewport.
      const maxW = 420
      const scale = Math.min(1, maxW / processed.width)
      addNotebookBlock(
        activeNotebookId, 'image',
        180 + Math.random() * 40, 140 + Math.random() * 30,
        null, null,
        Math.round(processed.width * scale),
        Math.round(processed.height * scale) + 30,
        {
          imageId: id, name: processed.name,
          natW: processed.width, natH: processed.height, alt: '', fit: 'contain',
        }
      )
      storageEstimate().then(setUsage)
    } catch (err) {
      setImportError(err?.message || 'That image could not be imported.')
    } finally {
      setImporting(false)
    }
  }

  function importWorkbook(file) {
    setImporting(true)
    const reader = new FileReader()
    reader.onerror = () => {
      setImporting(false)
      setImportError(`Could not read "${file.name}" from disk.`)
    }
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result)
        const workbook = XLSX.read(data, { type: 'array' })
        if (!workbook.SheetNames?.length) throw new Error('the file contains no sheets')
        const sheets = workbook.SheetNames.map(sheetName => {
          const ws = workbook.Sheets[sheetName]
          const json = XLSX.utils.sheet_to_json(ws, { header: 1 })
          // A missing header stays blank rather than becoming "Column 3" —
          // the grid shows the column letter, so a placeholder is just clutter.
          const headers = (json[0] || []).map((h, i) => ({ id: `col_${Date.now()}_${i}`, label: h ?? '', index: i, hidden: false }))
          return { name: sheetName, headers, rows: json.slice(1) }
        })
        const totalRows = sheets.reduce((n, s) => n + s.rows.length, 0)
        if (totalRows === 0) throw new Error('no rows were found in it')
        const newFile = { id: `file_${Date.now()}`, name: file.name, sheets }
        setFiles(prev => [...prev, newFile])
        setExpandedFiles(prev => { const next = new Set(prev); next.add(newFile.id); return next })
      } catch (err) {
        setImportError(`Could not import "${file.name}" — ${err?.message || 'the file may be corrupt or password-protected'}.`)
      } finally {
        setImporting(false)
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
  function deleteFile(fileId) {
    if (!window.confirm('Delete this file? Notebook tables built from it will remain.')) return
    setFiles(prev => prev.filter(f => f.id !== fileId))
    setExpandedFiles(prev => { const next = new Set(prev); next.delete(fileId); return next })
    setFolders(prev => prev.map(f => ({ ...f, itemIds: f.itemIds.filter(id => id !== fileId) })))
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
  function handleSidebarDragStart(e, fileId, fileName, sheetName, col) {
    const colsToAdd = selectedSidebarCols.length > 1 && selectedSidebarCols.includes(col.id)
      ? selectedSidebarCols.map(id => { const f = files.find(f => f.id === fileId); const c = f?.sheets[0]?.headers.find(h => h.id === id); return c ? { fileId, fileName, sheetName, col: c } : null }).filter(Boolean)
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
  /* Drag payload for a whole file: every visible column of its first sheet,
     so dropping it on the canvas yields one sheet containing the lot. */
  function handleFileDragStart(e, file) {
    const sheet = file.sheets[0]
    if (!sheet) return
    const cols = sheet.headers.filter(h => !h.hidden).map(col => ({
      fileId: file.id, fileName: file.name, sheetName: sheet.name, col,
    }))
    if (!cols.length) return
    dragData.current = { type: 'sidebar', cols, sourceFileId: file.id, wholeFile: file.name }
    setNativeDragImage(e, `${file.name} · ${cols.length} columns`)
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
    const id = `folder_${Date.now()}`
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
  }
  function renameNotebook(nbId, name) {
    setNotebooks(prev => prev.map(n => n.id !== nbId ? n : { ...n, name }))
  }
  function _getActiveSheetId(n) { return n.activeSheetId || n.sheets?.[0]?.id }
  function addNotebookBlock(nbId, type, x, y, customHeaders, customRows, customW, customH, patch) {
    const id = `block_${Date.now()}_${Math.random().toString(36).slice(2)}`
    let block = type === 'text'
      ? { id, type: 'text', x, y, w: customW || 280, name: '', content: '' }
      : type === 'kanban'
      ? { id, type: 'kanban', x, y, name: '', lanes: [
          { id: `lane_${Date.now()}_1`, name: 'Lane 1', cards: [] },
          { id: `lane_${Date.now()}_2`, name: 'Lane 2', cards: [] },
          { id: `lane_${Date.now()}_3`, name: 'Lane 3', cards: [] },
        ]}
      : type === 'section'
      ? { id, type: 'section', x, y, w: customW || 500, h: customH || 350, name: 'Section', sectionColor: '#5B5FE8' }
      // Image blocks hold only an id. The bytes live in IndexedDB so autosave
      // never rewrites pixels — see lib/images.js.
      : type === 'image'
      ? { id, type: 'image', x, y, w: customW || 360, h: customH || 260, name: 'Image', imageId: null, alt: '', fit: 'contain', rev: 0 }
      // Header starts blank. It used to default to the string "Column 1",
      // which was pure noise: the grid already prints the column letter above
      // every header, so the cell read "A / Column 1" and the user's first
      // action was always to delete it.
      : { id, type: 'table', x, y, w: customW || undefined, name: '',
          headers: customHeaders || [''],
          rows: customRows || Array(8).fill(null).map(() => ['']) }
    if (patch) block = { ...block, ...patch, id }
    setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const sid = _getActiveSheetId(n)
      return { ...n, sheets: (n.sheets || []).map(s => s.id === sid ? { ...s, blocks: [...s.blocks, block] } : s) }
    }))
  }
  function updateNotebookBlock(nbId, blockId, patch) {
    if (patch?.__delete) { deleteNotebookBlock(nbId, blockId); return }
    setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const sid = _getActiveSheetId(n)
      return { ...n, sheets: (n.sheets || []).map(s => s.id === sid ? { ...s, blocks: s.blocks.map(b => b.id === blockId ? { ...b, ...patch } : b) } : s) }
    }))
  }
  function deleteNotebookBlock(nbId, blockId) {
    setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const sid = _getActiveSheetId(n)
      return { ...n, sheets: (n.sheets || []).map(s => {
        if (s.id !== sid) return s
        const doomed = s.blocks.find(b => b.id === blockId)
        let blocks = s.blocks.filter(b => b.id !== blockId)
        if (doomed?.type === 'section') {
          const childIds = blocks.filter(b => b.parentSectionId === blockId).map(b => b.id)
          if (childIds.length > 0) {
            const msg = `Delete section "${doomed.name || 'Section'}" and its ${childIds.length} block${childIds.length > 1 ? 's' : ''}?`
            if (window.confirm(`${msg}\n\nOK = Delete all · Cancel = Keep blocks`)) {
              blocks = blocks.filter(b => b.parentSectionId !== blockId)
            } else {
              blocks = blocks.map(b => b.parentSectionId === blockId ? { ...b, parentSectionId: null } : b)
            }
          }
        }
        const connections = (s.connections || []).filter(c => c.fromBlockId !== blockId && c.toBlockId !== blockId)
        return { ...s, blocks, connections }
      }) }
    }))
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
    setNotebooks(prev => prev.map(n => {
      if (n.id !== nbId) return n
      const newSheets = (n.sheets || []).filter(s => s.id !== sheetId)
      return { ...n, sheets: newSheets, activeSheetId: newSheets[0]?.id || null }
    }))
  }
  function renameNotebookSheet(nbId, sheetId, name) {
    setNotebooks(prev => prev.map(n => n.id !== nbId ? n : { ...n, sheets: (n.sheets || []).map(s => s.id === sheetId ? { ...s, name } : s) }))
  }
  function setNotebookActiveSheet(nbId, sheetId) {
    setNotebooks(prev => prev.map(n => n.id !== nbId ? n : { ...n, activeSheetId: sheetId }))
  }
  // Deleting the only notebook would leave the app with nowhere to render —
  // DataStudio is always the notebook workspace, so a fresh one is created
  // in that case instead of falling back to an empty shell.
  function deleteNotebook(nbId) {
    setNotebooks(prev => {
      const next = prev.filter(n => n.id !== nbId)
      if (activeNotebookId !== nbId) return next
      if (next.length > 0) { setActiveNotebookId(next[0].id); return next }
      const nb = freshNotebook()
      setActiveNotebookId(nb.id)
      return [nb]
    })
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
          style={{ padding: '8px 10px', borderRadius: 7, display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', background: 'transparent' }}
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
                style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 10, padding: '1px 3px', borderRadius: 3 }}
                onMouseEnter={e => e.currentTarget.style.color = accent}
                onMouseLeave={e => e.currentTarget.style.color = text3}>↑</button>
            )}
            <button onClick={e => { e.stopPropagation(); if (window.confirm(`Delete "${nb.name}"?`)) deleteNotebook(nb.id) }}
              style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 10, padding: '1px 3px', borderRadius: 3 }}
              onMouseEnter={e => e.currentTarget.style.color = red}
              onMouseLeave={e => e.currentTarget.style.color = text3}>✕</button>
          </div>
          <span style={{ color: text3, fontSize: 10, flexShrink: 0 }}>{isExpanded ? '▾' : '▸'}</span>
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
                  style={{ padding: '6px 10px', borderRadius: 6, fontSize: 12, color: isActive ? accent : text3, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: isActive ? 600 : 400, background: isActive ? accentDim : 'transparent' }}
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
                      style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: `1px solid ${accent}`, color: text, fontFamily: 'var(--ds-font-body)', fontSize: 11, outline: 'none', minWidth: 0 }}
                    />
                  ) : (
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sheet.name}</span>
                  )}
                  {isActive && !isRenaming && <span style={{ fontSize: 9, color: accent }}>✓</span>}
                  {!isRenaming && nb.sheets.length > 1 && (
                    <button onClick={e => { e.stopPropagation(); if (window.confirm(`Delete sheet "${sheet.name}"?`)) deleteNotebookSheet(nb.id, sheet.id) }}
                      style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 9, padding: '1px 3px', borderRadius: 3, opacity: 0.35, flexShrink: 0 }}
                      onMouseEnter={e => { e.currentTarget.style.color = red; e.currentTarget.style.opacity = '1' }}
                      onMouseLeave={e => { e.currentTarget.style.color = text3; e.currentTarget.style.opacity = '0.35' }}>✕</button>
                  )}
                </div>
              )
            })}
            <button onClick={e => { e.stopPropagation(); addNotebookSheet(nb.id) }}
              style={{ padding: '3px 8px', border: 'none', background: 'none', color: text3, fontSize: 10, cursor: 'pointer', fontFamily: 'var(--ds-font-body)', display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}
              onMouseEnter={e => e.currentTarget.style.color = accent}
              onMouseLeave={e => e.currentTarget.style.color = text3}>
              + New Sheet
            </button>
          </div>
        )}
      </div>
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
          style={{ padding: '8px 10px', borderRadius: 7, fontSize: 13, color: text, cursor: 'grab', display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600, background: dragOverFileId === file.id ? accentDim : undefined, border: dragOverFileId === file.id ? `1px solid ${accent}` : '1px solid transparent' }}>
          <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
          <button onClick={e => { e.stopPropagation(); if (window.confirm(`Delete "${file.name}"?`)) deleteFile(file.id) }}
            style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 10, padding: '1px 3px', borderRadius: 3, opacity: 0, flexShrink: 0 }}
            className="col-actions"
            onMouseEnter={e => { e.currentTarget.style.color = red; e.currentTarget.style.opacity = '1' }}
            onMouseLeave={e => { e.currentTarget.style.color = text3; e.currentTarget.style.opacity = '0' }}>✕</button>

          {folderId && (
            <button onClick={e => { e.stopPropagation(); removeFromFolder(file.id, folderId) }}
              title="Remove from folder"
              style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 9, padding: '1px 3px', borderRadius: 3, opacity: 0 }}
              onMouseEnter={e => e.currentTarget.style.opacity = '1'}
              onMouseLeave={e => e.currentTarget.style.opacity = '0'}>↑</button>
          )}
          <span style={{ color: text3, fontSize: 10, flexShrink: 0 }}>{expandedFiles.has(file.id) ? '▾' : '▸'}</span>
        </div>
        {expandedFiles.has(file.id) && file.sheets[0] && (
          <>
            {selectedSidebarCols.length > 1 && (
              <div style={{ padding: '4px 8px 6px 24px' }}>
                <button onClick={() => { const colInfos = selectedSidebarCols.map(id => { const col = file.sheets[0].headers.find(h => h.id === id); return col ? { fileId: file.id, fileName: file.name, sheetName: file.sheets[0].name, col } : null }).filter(Boolean); addColumnsToNotebook(colInfos) }} style={{ background: accentDim, border: `1px solid ${accent}44`, borderRadius: 5, padding: '3px 10px', fontSize: 11, color: accent, cursor: 'pointer', fontFamily: 'var(--ds-font-body)', fontWeight: 600 }}>
                  + Add {selectedSidebarCols.length} to notebook
                </button>
              </div>
            )}
            {visibleHeaders(file.sheets[0]).map(col => {
              const isSelected = selectedSidebarCols.includes(col.id)
              return (
                <div key={col.id} className="col-row" draggable
                  onDragStart={e => handleSidebarDragStart(e, file.id, file.name, file.sheets[0].name, col)}
                  onClick={e => toggleSidebarSelect(e, col.id)}
                  style={{ padding: '6px 8px 6px 22px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6, background: isSelected ? accentDim : 'transparent', border: isSelected ? `1px solid ${accent}44` : '1px solid transparent' }}>
                  <div style={{ width: 6, height: 6, borderRadius: 2, background: accent, flexShrink: 0 }} />
                  <span title={col.label} style={{ flex: 1, fontSize: 12, color: isSelected ? accent : text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.label}</span>
                  <span style={{ fontSize: 9, color: text3 }}>{file.sheets[0].rows.length}</span>
                  <div className="col-actions">
                    <button style={{ color: text3, background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, padding: '1px 4px', borderRadius: 3 }} onClick={e => { e.stopPropagation(); hideColumn(file.id, file.sheets[0].name, col.id) }}>◌</button>
                    <button style={{ color: red, background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, padding: '1px 4px', borderRadius: 3 }} onClick={e => { e.stopPropagation(); deleteColumn(file.id, file.sheets[0].name, col.id) }}>✕</button>
                  </div>
                </div>
              )
            })}
          </>
        )}
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

  // Memoised on `dark` alone. This object is compared by identity inside
  // SheetGrid's memo() comparator — rebuilding it every render (as this used
  // to) made that comparison false every time, so every table block
  // re-rendered on every keystroke anywhere in the app.
  const colors = useMemo(
    () => ({ surface, raised, border, text, text2, text3, accent, accentDim, red, base, green, amber }),
    [surface, raised, border, text, text2, text3, accent, accentDim, red, base, green, amber]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>

      <input ref={fileInputRef} type="file" accept={ACCEPT_EXTS} style={{ display: 'none' }} onChange={handleFileChange} />
      {/* Separate picker for Add → Image, so the dialog only offers images. */}
      <input ref={imageInputRef} type="file" accept={IMAGE_EXTS.join(',')} style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setImportError(null); importImage(f) } }} />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', fontFamily: 'var(--ds-font-body)', position: 'relative' }}>

        {/* ── Sidebar (floating island) ── */}
        <div data-kbd-zone style={{ width: 252, position: 'absolute', top: 16, left: 16, bottom: 16, zIndex: 100, background: `${surface}f0`, backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: `1px solid ${border}`, borderRadius: 14, boxShadow: `0 8px 40px ${dark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.12)'}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'var(--ds-font-body)' }}>
          <div style={{ padding: '12px 12px 6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontFamily: 'var(--ds-font-head)', fontSize: 14, fontWeight: 700, color: text, flex: 1 }}>DataStudio</span>
            </div>
            <button className="import-btn" onClick={handleImportClick} disabled={importing} style={{ width: '100%', padding: '9px 0', background: accent, color: '#fff', border: 'none', borderRadius: 7, fontFamily: 'var(--ds-font-body)', fontSize: 13, fontWeight: 600, cursor: importing ? 'default' : 'pointer', opacity: importing ? 0.65 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {importing ? 'Importing…' : <><span style={{ fontSize: 15 }}>+</span> Import File</>}
            </button>

            {/* Failures are shown, not swallowed. */}
            {importError && (
              <div role="alert" style={{ marginTop: 7, padding: '7px 9px', borderRadius: 6, background: 'var(--ds-red-bg)', border: `1px solid ${red}`, color: red, fontSize: 10.5, lineHeight: 1.45 }}>
                {importError}
                <button onClick={() => setImportError(null)} style={{ display: 'block', marginTop: 4, background: 'none', border: 'none', color: red, opacity: 0.75, fontSize: 10, cursor: 'pointer', padding: 0, fontFamily: 'var(--ds-font-body)', textDecoration: 'underline' }}>Dismiss</button>
              </div>
            )}
            {saveError && (
              <div role="alert" style={{ marginTop: 7, padding: '7px 9px', borderRadius: 6, background: 'var(--ds-amber-bg)', border: `1px solid ${amber}`, color: dark ? amber : '#8a6410', fontSize: 10.5, lineHeight: 1.45 }}>
                <b>Not saving.</b> {saveError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
              <button onClick={createFolder}
                style={{ flex: 1, padding: '8px 0', background: 'transparent', border: `1px solid ${border}`, borderRadius: 7, color: text3, fontFamily: 'var(--ds-font-body)', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = text3 }}>
                Folder
              </button>
              <button onClick={createNotebook}
                style={{ flex: 1, padding: '8px 0', background: 'transparent', border: `1px solid ${border}`, borderRadius: 7, color: text3, fontFamily: 'var(--ds-font-body)', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = text3 }}>
                Notebook
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>

            {folders.map(folder => {
              const folderFiles = files.filter(f => folder.itemIds.includes(f.id))
              const folderNotebooks = notebooks.filter(n => folder.itemIds.includes(n.id))
              const isDragOver = folderDragOver === folder.id
              return (
                <div key={folder.id} style={{ marginBottom: 2 }}>
                  <div className="folder-row"
                    onDragOver={e => { if (sidebarItemDrag) { e.preventDefault(); setFolderDragOver(folder.id) } }}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFolderDragOver(null) }}
                    onDrop={e => { e.preventDefault(); if (sidebarItemDrag) { moveToFolder(sidebarItemDrag.itemId, folder.id); setSidebarItemDrag(null); setFolderDragOver(null) } }}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 6px', borderRadius: 6, border: isDragOver ? `1px solid ${accent}` : '1px solid transparent', background: isDragOver ? accentDim : 'transparent' }}>
                    <span onClick={() => toggleFolder(folder.id)} style={{ fontSize: 9, color: text3, cursor: 'pointer', flexShrink: 0, width: 10 }}>{folder.collapsed ? '▸' : '▾'}</span>
                    
                    {renamingFolderId === folder.id ? (
                      <input autoFocus value={renamingFolderLabel}
                        onChange={e => setRenamingFolderLabel(e.target.value)}
                        onBlur={() => commitFolderRename(folder.id)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
                        onClick={e => e.stopPropagation()}
                        style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: `1px solid ${accent}`, color: text, fontFamily: 'var(--ds-font-body)', fontSize: 12, fontWeight: 600, outline: 'none', minWidth: 0 }} />
                    ) : (
                      <span onClick={() => toggleFolder(folder.id)} style={{ flex: 1, fontSize: 12, fontWeight: 600, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>{folder.name}</span>
                    )}
                    <div className="folder-actions" style={{ opacity: 0, display: 'flex', gap: 2, flexShrink: 0 }}>
                      <button onClick={e => { e.stopPropagation(); setRenamingFolderId(folder.id); setRenamingFolderLabel(folder.name) }}
                        style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 11, padding: '1px 3px', borderRadius: 3, lineHeight: 1 }}
                        onMouseEnter={e => e.currentTarget.style.color = accent}
                        onMouseLeave={e => e.currentTarget.style.color = text3}>✎</button>
                      <button onClick={e => { e.stopPropagation(); deleteFolder(folder.id) }}
                        style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 11, padding: '1px 3px', borderRadius: 3, lineHeight: 1 }}
                        onMouseEnter={e => e.currentTarget.style.color = red}
                        onMouseLeave={e => e.currentTarget.style.color = text3}>✕</button>
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
                        <div style={{ padding: '5px 8px 6px', fontSize: 10, color: text3, fontStyle: 'italic' }}>Drag files or notebooks here</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {files.filter(f => !folders.some(folder => folder.itemIds.includes(f.id))).map(file => renderFileInSidebar(file, null))}

            {notebooks.filter(n => !folders.some(folder => folder.itemIds.includes(n.id))).map(nb => renderNotebookInSidebar(nb, null))}

            {files.length === 0 && notebooks.length <= 1 && folders.length === 0 && (
              <div style={{ margin: '16px 6px', padding: '13px 12px', borderRadius: 8, border: `1px dashed ${border}`, color: text3, fontSize: 12, lineHeight: 1.6 }}>
                <div style={{ textAlign: 'center', color: text2, fontWeight: 600, marginBottom: 10 }}>No files yet</div>
                {/* Only the verified formats are named. The old copy claimed
                    just ".xlsx .xls .csv" and undersold the importer; the fix
                    for that briefly overshot into listing everything SheetJS
                    can parse, which promised support for 1980s formats nobody
                    has. This is the tested middle. */}
                {IMPORT_FORMATS.map(({ group, exts }) => (
                  <div key={group} style={{ display: 'flex', gap: 7, marginBottom: 5, alignItems: 'baseline' }}>
                    <span style={{ flexShrink: 0, width: 54, fontSize: 9, fontFamily: 'var(--ds-font-mono)', textTransform: 'uppercase', letterSpacing: 0.5, color: text3, opacity: 0.75 }}>
                      {group}
                    </span>
                    <span style={{ flex: 1, fontSize: 10.5, color: text2, lineHeight: 1.55, wordBreak: 'break-word' }}>
                      {exts.join(' ')}
                    </span>
                  </div>
                ))}
                <div title={`Also accepted: ${ALSO_ACCEPTED.join(' ')}`}
                  style={{ marginTop: 8, paddingTop: 7, borderTop: `1px solid ${border}`, fontSize: 10, color: text3, textAlign: 'center' }}>
                  + {ALSO_ACCEPTED.length} more accepted
                </div>
              </div>
            )}
          </div>

          {allHiddenCols.length > 0 && (
            <div style={{ borderTop: `1px solid ${border}`, padding: '8px 10px' }}>
              <button onClick={() => setShowHidden(!showHidden)} style={{ background: 'none', border: 'none', cursor: 'pointer', width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontFamily: 'var(--ds-font-body)', fontSize: 11, color: text3 }}>
                <span style={{ fontSize: 10 }}>{showHidden ? '▾' : '▸'}</span> Hidden ({allHiddenCols.length})
              </button>
              {showHidden && allHiddenCols.map(({ fileId, sheetName, col }) => (
                <div key={col.id} style={{ padding: '4px 4px 4px 16px', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 6, height: 6, borderRadius: 2, background: border, flexShrink: 0 }} />
                  <span title={col.label} style={{ flex: 1, fontSize: 11, color: text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'line-through' }}>{col.label}</span>
                  <button onClick={() => restoreColumn(fileId, sheetName, col.id)} style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 4, cursor: 'pointer', color: accent, fontSize: 11, padding: '2px 6px', fontFamily: 'var(--ds-font-body)' }}>↩</button>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9.5, color: text3, fontFamily: 'var(--ds-font-mono)', marginBottom: 3 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    STORAGE
                    {/* Whether the browser agreed to protect this data from
                        eviction. A refusal is worth showing: it means the OS
                        may reclaim the workspace if the disk fills up. */}
                    {persisted === true && (
                      <span title="This browser has agreed to keep your workspace — it won't be evicted to reclaim disk space."
                        style={{ color: accent, letterSpacing: 0.4 }}>· KEPT</span>
                    )}
                    {persisted === false && (
                      <span title="The browser would not guarantee this storage, so it may be cleared if the disk fills up. Bookmarking or installing the app usually earns the guarantee. Export anything important."
                        style={{ color: amber, letterSpacing: 0.4, cursor: 'help' }}>· AT RISK</span>
                    )}
                  </span>
                  <span>{formatBytes(usage.usage)}</span>
                </div>
                <div style={{ height: 3, borderRadius: 2, background: raised, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 2,
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

        {/* ── Settings island ──
            Was a "Free plan" label next to an emoji avatar: two pieces of
            chrome that did nothing and implied an account system that doesn't
            exist. Replaced with the one thing that belongs in the corner of a
            local-first app — where your data lives and what state it's in. */}
        <div ref={settingsRef} data-kbd-zone style={{ position: 'absolute', top: 16, right: 16, zIndex: 100 }}>
          <button onClick={() => setSettingsOpen(o => !o)} aria-label="Settings" aria-expanded={settingsOpen}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 13px', background: `${surface}ee`, backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: `1px solid ${settingsOpen ? accent : border}`, borderRadius: 10, boxShadow: `0 4px 24px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.08)'}`, fontFamily: 'var(--ds-font-body)', fontSize: 12, color: settingsOpen ? accent : text2, cursor: 'pointer' }}>
            <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3.2" />
              <path d="M19.4 14a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5v.2a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H2.9a2 2 0 010-4H3a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V2.9a2 2 0 014 0V3a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1h.2a2 2 0 010 4H21a1.7 1.7 0 00-1.5 1z" />
            </svg>
            Settings
          </button>

          {settingsOpen && (
            <div role="dialog" aria-label="Settings"
              style={{ position: 'absolute', top: '100%', right: 0, marginTop: 8, width: 268, background: surface, border: `1px solid ${border}`, borderRadius: 12, boxShadow: `0 12px 40px ${dark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.16)'}`, padding: 12, fontFamily: 'var(--ds-font-body)', animation: 'fadeUp 0.15s ease both' }}>

              <div style={{ fontSize: 9, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.9, textTransform: 'uppercase', color: text3, marginBottom: 7 }}>Appearance</div>
              <div style={{ display: 'flex', gap: 5, marginBottom: 14 }}>
                {[['Light', false], ['Dark', true]].map(([lbl, val]) => (
                  <button key={lbl} onClick={() => setDark(val)}
                    style={{ flex: 1, padding: '7px 0', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontFamily: 'var(--ds-font-body)', border: `1.5px solid ${dark === val ? accent : border}`, background: dark === val ? accentDim : 'transparent', color: dark === val ? accent : text2, fontWeight: dark === val ? 650 : 500 }}>
                    {lbl}
                  </button>
                ))}
              </div>

              {/* Keyboard reference. Same source as the ? overlay
                  (lib/shortcuts.js), so the two can't disagree. */}
              <div style={{ fontSize: 9, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.9, textTransform: 'uppercase', color: text3, marginBottom: 7 }}>Keyboard</div>
              <button onClick={() => setShowShortcuts(s => !s)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px', marginBottom: showShortcuts ? 8 : 14, borderRadius: 7, cursor: 'pointer', border: `1px solid ${showShortcuts ? accent : border}`, background: showShortcuts ? accentDim : 'transparent', color: showShortcuts ? accent : text2, fontFamily: 'var(--ds-font-body)', fontSize: 12 }}>
                <span style={{ flex: 1, textAlign: 'left' }}>Shortcuts</span>
                <span style={{ fontSize: 10, fontFamily: 'var(--ds-font-mono)', opacity: 0.8 }}>{showShortcuts ? '▾' : '?'}</span>
              </button>
              {showShortcuts && (
                <div style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 14, paddingRight: 2 }}>
                  {SHORTCUT_GROUPS.map(({ title, note, rows }) => (
                    <div key={title} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 9, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.7, textTransform: 'uppercase', color: text3, marginBottom: note ? 2 : 5 }}>{title}</div>
                      {note && <div style={{ fontSize: 10, color: text3, marginBottom: 5, lineHeight: 1.4 }}>{note}</div>}
                      {rows.map(([k, d]) => (
                        <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0' }}>
                          <span style={{ flex: '0 0 96px', fontFamily: 'var(--ds-font-mono)', fontSize: 9.5, color: accent, lineHeight: 1.4 }}>{k}</span>
                          <span style={{ flex: 1, fontSize: 10.5, color: text2, lineHeight: 1.45 }}>{d}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ fontSize: 9, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.9, textTransform: 'uppercase', color: text3, marginBottom: 7 }}>Storage</div>
              <div style={{ fontSize: 11.5, color: text2, lineHeight: 1.6, marginBottom: 8 }}>
                Everything is stored in this browser. Nothing is uploaded.
              </div>
              {usage && (
                <div style={{ fontSize: 11, color: text2, display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontFamily: 'var(--ds-font-mono)' }}>
                  <span>{formatBytes(usage.usage)} used</span>
                  <span style={{ color: text3 }}>of ~{formatBytes(usage.quota)}</span>
                </div>
              )}
              <div style={{ fontSize: 11, marginBottom: 10, lineHeight: 1.5, color: persisted === false ? amber : persisted === true ? accent : text3 }}>
                {persisted === true && 'Protected — the browser has agreed not to evict it.'}
                {persisted === false && 'Not protected. The browser may clear this if the disk fills up — export anything important.'}
                {persisted === null && 'Eviction protection is unavailable in this browser.'}
              </div>

              <button
                onClick={async () => {
                  if (!window.confirm('Delete every notebook, folder and image stored in this browser?\n\nThis cannot be undone, and there is no cloud copy. Export first if you need anything.')) return
                  await clearState()
                  await idbClear(STORE_IMAGES)
                  window.location.reload()
                }}
                style={{ width: '100%', padding: '8px 0', borderRadius: 7, border: `1px solid ${border}`, background: 'transparent', color: red, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--ds-font-body)' }}>
                Delete all local data
              </button>

              <div style={{ borderTop: `1px solid ${border}`, marginTop: 12, paddingTop: 9, fontSize: 10, color: text3, lineHeight: 1.6, fontFamily: 'var(--ds-font-mono)' }}>
                DataStudio · local-first
              </div>
            </div>
          )}
        </div>

        {/* ── Main: always the notebook workspace ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {activeNotebookId && notebooks.find(n => n.id === activeNotebookId) && (
            <NotebookCanvas
              nb={notebooks.find(n => n.id === activeNotebookId)}
              dark={dark}
              colors={colors}
              onAddBlock={(type, x, y, h1, r1, w, h, patch) => addNotebookBlock(activeNotebookId, type, x, y, h1, r1, w, h, patch)}
              onAddConnection={(conn) => addNotebookConnection(activeNotebookId, conn)}
              onDeleteConnection={(connId) => deleteNotebookConnection(activeNotebookId, connId)}
              onUpdateBlock={(blockId, patch) => updateNotebookBlock(activeNotebookId, blockId, patch)}
              onDeleteBlock={(blockId) => deleteNotebookBlock(activeNotebookId, blockId)}
              onRenameNotebook={(name) => renameNotebook(activeNotebookId, name)}
              onRenameSheet={(sheetId, name) => renameNotebookSheet(activeNotebookId, sheetId, name)}
              onOpenCrosscheck={() => setShowCCWizard(true)}
              onDropColumn={(x, y) => {
                const d = dragData.current
                if (!d || d.type !== 'sidebar') return
                const { headers, rows } = buildTableFromCols(d.cols)
                addNotebookBlock(activeNotebookId, 'table', Math.max(0, x - 160), Math.max(0, y - 20), headers, rows)
                dragData.current = null
              }}
              onPickImage={() => imageInputRef.current?.click()}
              onAddDrawing={(drawing) => addNotebookDrawing(activeNotebookId, drawing)}
              onDeleteDrawing={(drawingId) => deleteNotebookDrawing(activeNotebookId, drawingId)}
              onClearDrawings={() => clearNotebookDrawings(activeNotebookId)}
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
    </div>
  )
}
