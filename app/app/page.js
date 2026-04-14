'use client'
import { useState, useRef, useCallback, useEffect, useMemo, Fragment } from 'react'
import { useTheme } from '../providers'
import * as XLSX from 'xlsx'
import TextBlockContent from '../../components/notebook/TextBlockContent'
import ResizeHandle from '../../components/notebook/ResizeHandle'
import BlockHandle from '../../components/notebook/BlockHandle'
import KanbanBlock from '../../components/notebook/KanbanBlock'
import NotebookCanvas from '../../components/notebook/NotebookCanvas'
import CrosscheckWizard from '../../components/tools/CrosscheckWizard'
import TrimPanel from '../../components/tools/TrimPanel'
import EmptyPanel from '../../components/tools/EmptyPanel'
import DuplicatesPanel from '../../components/tools/DuplicatesPanel'
import StatsPanel from '../../components/tools/StatsPanel'
import FormatBar from '../../components/tools/FormatBar'
import { saveState, loadState, debounce } from '../../lib/persistence'
const defaultColFormat = () => ({
  fontSize: 12,
  bold: false,
  align: 'left',
  wrap: false,
})

const defaultGlobalFormat = () => ({
  freezeHeader: false,
  banding: false,
  borderStyle: 'none',
  boldHeader: true,
  headerColor: '#5B5FE8',
  exportAsTable: false,
})

export default function AppPage() {
  const { dark, setDark } = useTheme()
  const [mode, setMode] = useState('preview')
  const [activeTool, setActiveTool] = useState(null)
 const [toolResult, setToolResult] = useState(null)
const [statCards, setStatCards] = useState([])
  const [editingCell, setEditingCell] = useState(null)
  const [editingCellVal, setEditingCellVal] = useState('')
  const [selectedCell, setSelectedCell] = useState(null)
  const [highlightEmpty, setHighlightEmpty] = useState(false)
  const [duplicateMap, setDuplicateMap] = useState({})
  const [files, setFiles] = useState([])
  const [expandedFiles, setExpandedFiles] = useState(new Set())
  const [showHidden, setShowHidden] = useState(false)
  const [showCCWizard, setShowCCWizard] = useState(false)
  const [dragOverFileId, setDragOverFileId] = useState(null)
  const [dragOverSidebarCol, setDragOverSidebarCol] = useState(null)
  const [insertAt, setInsertAt] = useState(null)
  const [draggingCanvasId, setDraggingCanvasId] = useState(null)
  const draggingCanvasIdRef = useRef(null)
  const [editingColId, setEditingColId] = useState(null)
  const [editingLabel, setEditingLabel] = useState('')
  const [selectedSidebarCols, setSelectedSidebarCols] = useState([])
  
  const [activeSheet, setActiveSheet] = useState('canvas')
  const [contextMenu, setContextMenu] = useState(null)
  const [colContextMenu, setColContextMenu] = useState(null)
 const makeCanvas = (id, name) => ({ 
  id, name, columns: [], pinnedColIds: [], hiddenRows: new Set(), zoom: 1 
})
const [canvases, setCanvases] = useState([makeCanvas('canvas_1', 'Canvas 1')])
const [activeCanvasId, setActiveCanvasId] = useState('canvas_1')
const [renamingCanvasId, setRenamingCanvasId] = useState(null)
const [renamingCanvasLabel, setRenamingCanvasLabel] = useState('')
const [folders, setFolders] = useState([])
const [notebooks, setNotebooks] = useState([])
const [activeNotebookId, setActiveNotebookId] = useState(null)
const [expandedNotebookIds, setExpandedNotebookIds] = useState(new Set())
const [renamingFolderId, setRenamingFolderId] = useState(null)
const [renamingFolderLabel, setRenamingFolderLabel] = useState('')
const [folderDragOver, setFolderDragOver] = useState(null)
const [sidebarItemDrag, setSidebarItemDrag] = useState(null)
const [renamingSheetId, setRenamingSheetId] = useState(null)
const [renamingSheetLabel, setRenamingSheetLabel] = useState('')
// These keep every other function working without changes
const activeCanvas = canvases.find(c => c.id === activeCanvasId) || canvases[0]
const canvasColumns = activeCanvas.columns
const pinnedColIds = activeCanvas.pinnedColIds
const hiddenRows = activeCanvas.hiddenRows
const canvasZoom = activeCanvas.zoom

// These replace the old React setters — same names, now canvas-aware
function setCanvasColumns(fn) {
  setCanvases(prev => {
    const canvas = prev.find(c => c.id === activeCanvasId) || prev[0]
    return prev.map(c => c.id === activeCanvasId ? { ...c, columns: typeof fn === 'function' ? fn(canvas.columns) : fn } : c)
  })
}
function setPinnedColIds(fn) {
  setCanvases(prev => {
    const canvas = prev.find(c => c.id === activeCanvasId) || prev[0]
    return prev.map(c => c.id === activeCanvasId ? { ...c, pinnedColIds: typeof fn === 'function' ? fn(canvas.pinnedColIds) : fn } : c)
  })
}
function setHiddenRows(fn) {
  setCanvases(prev => {
    const canvas = prev.find(c => c.id === activeCanvasId) || prev[0]
    return prev.map(c => c.id === activeCanvasId ? { ...c, hiddenRows: typeof fn === 'function' ? fn(canvas.hiddenRows) : fn } : c)
  })
}
function setCanvasZoom(fn) {
  setCanvases(prev => {
    const canvas = prev.find(c => c.id === activeCanvasId) || prev[0]
    return prev.map(c => c.id === activeCanvasId ? { ...c, zoom: typeof fn === 'function' ? fn(canvas.zoom) : fn } : c)
  })
}
  const [copiedRow, setCopiedRow] = useState(null)
 
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false)
  const exportDropdownRef = useRef(null)

  // Format state
  const [globalFormat, setGlobalFormat] = useState(defaultGlobalFormat())
  const [colFormats, setColFormats] = useState({})
  const [formatSelectedCols, setFormatSelectedCols] = useState([])

  // Preview filter/sort/group state
  const [selectedPreviewCol, setSelectedPreviewCol] = useState(null) // { fileId, sheetIdx, colId }
  const [selectedPreviewCols, setSelectedPreviewCols] = useState([]) // array of colIds for multi-select
  const [activePreviewSheet, setActivePreviewSheet] = useState(null) // { fileId, si } — which sheet tab is active
  const [previewAction, setPreviewAction] = useState(null) // { type: 'filter'|'sort'|'group', fileId, sheetIdx, colId }
  const [previewSortMap, setPreviewSortMap] = useState({}) // key -> 'asc'|'desc'
  const [previewFilterMap, setPreviewFilterMap] = useState({}) // key -> Set of hidden values
  const [previewGroupMap, setPreviewGroupMap] = useState({}) // key -> bool

// Load persisted state on mount, exactly once.
  useEffect(() => {
    const saved = loadState()
    if (!saved) return
    if (saved.canvases?.length) setCanvases(saved.canvases.map(c => ({
      ...c,
      hiddenRows: c.hiddenRows instanceof Set
        ? c.hiddenRows
        : new Set(Array.isArray(c.hiddenRows) ? c.hiddenRows : [])
    })))
    if (saved.notebooks?.length) setNotebooks(saved.notebooks)
    if (saved.folders?.length) setFolders(saved.folders)
    if (saved.colFormats) setColFormats(saved.colFormats)
    if (saved.globalFormat) setGlobalFormat(saved.globalFormat)
    if (saved.statCards?.length) setStatCards(saved.statCards)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced auto-save. Fires 600ms after the last change to any
  // persistable state. Wraps saveState in useRef so the debounced
  // function isn't recreated on every render.
  const debouncedSaveRef = useRef(null)
  if (!debouncedSaveRef.current) {
    debouncedSaveRef.current = debounce((state) => saveState(state), 600)
  }
  useEffect(() => {
    debouncedSaveRef.current({
      canvases: canvases.map(c => ({
        ...c,
        hiddenRows: Array.from(c.hiddenRows instanceof Set ? c.hiddenRows : [])
      })),
      notebooks,
      folders,
      colFormats,
      globalFormat,
      statCards,
    })
  }, [canvases, notebooks, folders, colFormats, globalFormat, statCards])
  // Warn before closing tab if there's any work in progress.
  useEffect(() => {
    function handleBeforeUnload(e) {
      const hasWork = canvases.some(c => c.columns?.length > 0) || notebooks.some(n => n.sheets?.some(s => s.blocks?.length > 0))
      if (hasWork) {
        e.preventDefault()
        e.returnValue = '' // Required for Chrome
        return ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [canvases, notebooks])

  // Debounced color picker — store draft locally, commit on pointer up


 useEffect(() => { window.__nbTableDrag = null }, [])
  const isPanning = useRef(false)
  const canvasScrollRef = useRef(null)

  // Callback ref for the canvas scroll area.
  // Why callback instead of plain ref: the canvas div is conditionally rendered
  // (only when mode === 'canvas'), so a useEffect with [] deps would attach the
  // wheel listener before the element exists. Callback refs fire exactly when
  // React attaches/detaches the DOM node, so we always attach at the right time.
  const wheelHandlerRef = useRef(null)
  const setCanvasScrollEl = useCallback((el) => {
    // Detach from previous element if any
    if (canvasScrollRef.current && wheelHandlerRef.current) {
      canvasScrollRef.current.removeEventListener('wheel', wheelHandlerRef.current)
      wheelHandlerRef.current = null
    }
    canvasScrollRef.current = el
    if (!el) return
    const handler = (e) => {
      if (e.ctrlKey) {
        e.preventDefault()
        setCanvasZoomRef.current(prev => Math.min(2, Math.max(0.4, Math.round((prev + (e.deltaY > 0 ? -0.1 : 0.1)) * 10) / 10)))
        return
      }
      if (e.shiftKey) { e.preventDefault(); el.scrollLeft += e.deltaY * 0.8; return }
      el.scrollLeft += e.deltaX; el.scrollTop += e.deltaY * 0.8; e.preventDefault()
    }
    el.addEventListener('wheel', handler, { passive: false })
    wheelHandlerRef.current = handler
    console.log('[DataStudio] wheel handler attached to canvas scroll area')
  }, [])
  const dragData = useRef(null)
  const lastInsert = useRef(null)
  const fileInputRef = useRef(null)
  const editInputRef = useRef(null)
  const bottomSentinelRef = useRef(null)
  const [visibleRowCount, setVisibleRowCount] = useState(200)

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
  const redDim    = dark ? '#2a0d0d' : '#fee2e2'
  const amber     = '#E8B85B'

  const tools = [
    { id: 'crosscheck', label: 'Crosscheck',      icon: '⚡', desc: 'Fuzzy match names across files' },
    { id: 'duplicates', label: 'Duplicates',      icon: '⊕', desc: 'Find repeated values'           },
    { id: 'gaps',       label: 'Gap Finder',      icon: '◎', desc: 'What is in A but missing from B' },
    { id: 'mapper',     label: 'Col Mapper',      icon: '⇄', desc: 'Visual JOIN by shared key'       },
    { id: 'sort',       label: 'Sort & Filter',   icon: '⇅', desc: 'Sort canvas by any column'       },
    { id: 'merge',      label: 'Merge',           icon: '⬡', desc: 'Combine two columns into one'    },
    { id: 'split',      label: 'Split',           icon: '⋮', desc: 'Split column by delimiter'       },
    { id: 'trim',       label: 'Trim & Clean',    icon: '✦', desc: 'Strip spaces, fix casing'        },
    { id: 'empty',      label: 'Highlight Empty', icon: '□', desc: 'Flag blank/null cells'           },
    { id: 'stats',      label: 'Col Stats',       icon: '▦', desc: 'Count, unique, sum, min, max'    },
    { id: 'format',     label: 'Format',          icon: '◈', desc: 'Style columns for export'        },
  ]

  // ── Format helpers ───────────────────────────────────────────
  function getColFormat(canvasId) {
    return colFormats[canvasId] || defaultColFormat()
  }
  function updateColFormat(canvasIds, patch) {
    setColFormats(prev => {
      const next = { ...prev }
      canvasIds.forEach(id => { next[id] = { ...(next[id] || defaultColFormat()), ...patch } })
      return next
    })
  }
  function updateGlobalFormat(patch) {
    setGlobalFormat(prev => ({ ...prev, ...patch }))
  }
  useEffect(() => {
    if (activeTool === 'format') setFormatSelectedCols(canvasColumns.map(c => c.canvasId))
  }, [activeTool])
  function getFormatValue(key) {
    if (formatSelectedCols.length === 0) return defaultColFormat()[key]
    const vals = formatSelectedCols.map(id => getColFormat(id)[key])
    return vals.every(v => v === vals[0]) ? vals[0] : '—'
  }
  
  
  const hasAnyFormat = Object.keys(colFormats).length > 0 || globalFormat.banding || globalFormat.boldHeader || globalFormat.freezeHeader || globalFormat.borderStyle !== 'thin'

  // ── Close export dropdown ────────────────────────────────────
  useEffect(() => {
    if (!exportDropdownOpen) return
    function handleClick(e) {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target)) setExportDropdownOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [exportDropdownOpen])

  // ── Export ───────────────────────────────────────────────────
  function exportCanvasCSV() {
    if (canvasColumns.length === 0) return
    const headers = canvasColumns.map(c => c.label)
    const rows = Array.from({ length: maxRows }).map((_, ri) =>
      canvasColumns.map(col => { const val = col.rows[ri]; return val === undefined || val === null ? '' : String(val) })
    )
    const csv = [headers, ...rows].map(row => row.map(cell => {
      const s = String(cell)
      return (s.includes(',') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s
    }).join(',')).join('\n')
    downloadFile(csv, 'canvas_export.csv', 'text/csv')
    setExportDropdownOpen(false)
  }

  function exportCanvasXLSX() {
    if (canvasColumns.length === 0) return
    const { freezeHeader, banding, borderStyle, boldHeader, headerColor, exportAsTable } = globalFormat
    const headers = canvasColumns.map(c => c.label)
    const rows = Array.from({ length: maxRows }).map((_, ri) =>
      canvasColumns.map(col => { const val = col.rows[ri]; return val === undefined || val === null ? '' : val })
    )
    const wsData = [headers, ...rows]
    const ws = XLSX.utils.aoa_to_sheet(wsData)

    // Auto-fit column widths
    ws['!cols'] = canvasColumns.map((col) => {
      const allVals = [col.label, ...col.rows.map(v => v == null ? '' : String(v))]
      const maxLen = Math.max(...allVals.map(v => String(v).length))
      return { wch: Math.min(Math.max(maxLen + 2, 8), 60) }
    })

    // Row heights
    ws['!rows'] = [{ hpt: 22 }, ...Array(maxRows).fill({ hpt: 16 })]

    // Freeze header — correct SheetJS syntax
    if (freezeHeader) {
      ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2', sqref: 'A2' }
    }

    // Helpers
    const toRgb = (hex) => hex.replace('#', '').toUpperCase().padEnd(6, '0')
    const bdrThin = { style: 'thin',   color: { rgb: 'CCCCCC' } }
    const bdrMed  = { style: 'medium', color: { rgb: '888888' } }
    const getBdr  = () => {
      if (borderStyle === 'none') return {}
      const b = borderStyle === 'medium' ? bdrMed : bdrThin
      return { top: b, bottom: b, left: b, right: b }
    }
    const headerRgb = toRgb(headerColor)
    // Banding: use a lightened version of header color (just use F2F2FF as neutral light)
    const bandRgb = 'F0F0FA'

    for (let ri = 0; ri <= maxRows; ri++) {
      for (let ci = 0; ci < canvasColumns.length; ci++) {
        const cellRef = XLSX.utils.encode_cell({ r: ri, c: ci })
        if (!ws[cellRef]) ws[cellRef] = { v: '', t: 's' }
        const col = canvasColumns[ci]
        const fmt = getColFormat(col.canvasId)
        const isHeader = ri === 0
        const isBanded = banding && !isHeader && ri % 2 === 0
        ws[cellRef].s = {
          font: {
            name: 'Calibri',
            sz: fmt.fontSize || 12,
            bold: isHeader ? boldHeader : (fmt.bold || false),
            color: { rgb: isHeader ? 'FFFFFF' : '222222' },
          },
          alignment: {
            horizontal: fmt.align || 'left',
            vertical: 'center',
            wrapText: fmt.wrap || false,
          },
          fill: {
            patternType: 'solid',
            fgColor: { rgb: isHeader ? headerRgb : isBanded ? bandRgb : 'FFFFFF' },
          },
          border: getBdr(),
        }
      }
    }

    // Export as Table (autofilter = Excel table-style filtering)
    if (exportAsTable && maxRows > 0) {
      const tableRef = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRows, c: canvasColumns.length - 1 } })
      ws['!autofilter'] = { ref: tableRef }
    }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Canvas')
    XLSX.writeFile(wb, 'canvas_export.xlsx')
    setExportDropdownOpen(false)
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  // ── File import ──────────────────────────────────────────────
  function handleImportClick() { fileInputRef.current.click() }
  function handleFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target.result)
      const workbook = XLSX.read(data, { type: 'array' })
      const sheets = workbook.SheetNames.map(sheetName => {
        const ws = workbook.Sheets[sheetName]
        const json = XLSX.utils.sheet_to_json(ws, { header: 1 })
        const headers = (json[0] || []).map((h, i) => ({ id: `col_${Date.now()}_${i}`, label: h || `Column ${i + 1}`, index: i, hidden: false }))
        return { name: sheetName, headers, rows: json.slice(1) }
      })
      const newFile = { id: `file_${Date.now()}`, name: file.name, sheets }
      setFiles(prev => [...prev, newFile])
      setExpandedFiles(prev => { const next = new Set(prev); next.add(newFile.id); return next })
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  // ── Column visibility ────────────────────────────────────────
  function hideColumn(fileId, sheetName, colId) {
    setFiles(prev => prev.map(f => f.id !== fileId ? f : { ...f, sheets: f.sheets.map(s => s.name !== sheetName ? s : { ...s, headers: s.headers.map(h => h.id === colId ? { ...h, hidden: true } : h) }) }))
  }
  function deleteColumn(fileId, sheetName, colId) {
    setFiles(prev => prev.map(f => f.id !== fileId ? f : { ...f, sheets: f.sheets.map(s => s.name !== sheetName ? s : { ...s, headers: s.headers.filter(h => h.id !== colId) }) }))
    setCanvasColumns(prev => prev.filter(c => c.colId !== colId))
  }
  function restoreColumn(fileId, sheetName, colId) {
    setFiles(prev => prev.map(f => f.id !== fileId ? f : { ...f, sheets: f.sheets.map(s => s.name !== sheetName ? s : { ...s, headers: s.headers.map(h => h.id === colId ? { ...h, hidden: false } : h) }) }))
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

  // ── Add to canvas ────────────────────────────────────────────
  function addColumnsToCanvas(colInfos, atIndex = null) {
    const newCols = colInfos
      .filter(({ col }) => !canvasColumns.some(c => c.colId === col.id))
      .map(({ fileId, fileName, sheetName, col }) => {
        const file = files.find(f => f.id === fileId)
        const sheet = file?.sheets.find(s => s.name === sheetName)
        return { canvasId: `canvas_${Date.now()}_${Math.random()}`, colId: col.id, label: col.label, fileName, sheetName, rows: sheet?.rows.map(row => row[col.index]) || [] }
      })
    if (!newCols.length) return
    setCanvasColumns(prev => {
      if (atIndex === null) return [...prev, ...newCols]
      const next = [...prev]; next.splice(atIndex, 0, ...newCols); return next
    })
    setMode('canvas'); setSelectedSidebarCols([])
  }

  // ── Drag helpers ─────────────────────────────────────────────
  function setNativeDragImage(e, label) {
    const el = document.createElement('div')
    el.textContent = label
    el.style.cssText = `position:fixed;top:-999px;left:-999px;padding:5px 12px;background:${accent};color:#fff;border-radius:6px;font:600 12px 'DM Sans',sans-serif;white-space:nowrap;`
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
  }
  function handleCanvasDragStart(e, canvasId) {
    dragData.current = { type: 'canvas', canvasId }
    draggingCanvasIdRef.current = canvasId; setDraggingCanvasId(canvasId)
    const col = canvasColumns.find(c => c.canvasId === canvasId)
    setNativeDragImage(e, col?.label || ''); e.dataTransfer.effectAllowed = 'move'
  }
  function handleCanvasDragEnd() {
    draggingCanvasIdRef.current = null; setDraggingCanvasId(null)
    setInsertAt(null); lastInsert.current = null; dragData.current = null
  }
  const handleThDragOver = useCallback((e, index) => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const side = e.clientX < rect.left + rect.width * 0.35 ? 'left' : 'right'
    const key = `${index}-${side}`
    if (lastInsert.current === key) return
    lastInsert.current = key; setInsertAt({ index, side })
  }, [])
  function handleThDrop(e, index) {
    e.preventDefault(); e.stopPropagation()
    if (!dragData.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const side = e.clientX < rect.left + rect.width / 2 ? 'left' : 'right'
    const dropIndex = side === 'right' ? index + 1 : index
    if (dragData.current.type === 'sidebar') {
      addColumnsToCanvas(dragData.current.cols, dropIndex)
    } else if (dragData.current.type === 'canvas') {
      const fromId = dragData.current.canvasId
      setCanvasColumns(prev => {
        const fromIdx = prev.findIndex(c => c.canvasId === fromId)
        if (fromIdx === -1) return prev
        const next = [...prev]; const [moved] = next.splice(fromIdx, 1)
        next.splice(fromIdx < dropIndex ? dropIndex - 1 : dropIndex, 0, moved); return next
      })
    }
    setInsertAt(null); setDraggingCanvasId(null); lastInsert.current = null; dragData.current = null
  }
  function handleCanvasZoneDragOver(e) { e.preventDefault() }
  function handleCanvasZoneDrop(e) {
    e.preventDefault()
    if (!dragData.current) return
    if (dragData.current.type === 'sidebar') addColumnsToCanvas(dragData.current.cols, null)
    dragData.current = null; setInsertAt(null); lastInsert.current = null
  }
  function handleCanvasDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) { setInsertAt(null); lastInsert.current = null }
  }

  // ── Rename ───────────────────────────────────────────────────
  function startEdit(canvasId, label) { setEditingColId(canvasId); setEditingLabel(label); setTimeout(() => editInputRef.current?.select(), 30) }
  function commitEdit(canvasId) {
    if (editingLabel.trim()) setCanvasColumns(prev => prev.map(c => c.canvasId === canvasId ? { ...c, label: editingLabel.trim() } : c))
    setEditingColId(null)
  }

  // ── Pin ──────────────────────────────────────────────────────
  function togglePin(canvasId) { setPinnedColIds(prev => prev.includes(canvasId) ? prev.filter(id => id !== canvasId) : [...prev, canvasId]) }
  function removeCanvasColumn(canvasId) { setCanvasColumns(prev => prev.filter(c => c.canvasId !== canvasId)); setPinnedColIds(prev => prev.filter(id => id !== canvasId)) }

  // ── Pan ──────────────────────────────────────────────────────
  function handleCanvasMouseDown(e) {
    if (e.button !== 2) return
    if (e.target.closest('button,input')) return
    e.preventDefault()
    const startX = e.clientX, startY = e.clientY
    const startLeft = canvasScrollRef.current?.scrollLeft || 0
    const startTop  = canvasScrollRef.current?.scrollTop  || 0
    function onMove(ev) {
      if (!canvasScrollRef.current) return
      canvasScrollRef.current.scrollLeft = startLeft - (ev.clientX - startX)
      canvasScrollRef.current.scrollTop  = startTop  - (ev.clientY - startY)
    }
    function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); if (canvasScrollRef.current) canvasScrollRef.current.style.cursor = '' }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
    canvasScrollRef.current.style.cursor = 'grabbing'
  }
  function closeContextMenu() { setContextMenu(null) }

  // Keep an always-fresh reference to setCanvasZoom so the wheel handler
  // (which is attached via callback ref) can always call the LATEST version.
  const setCanvasZoomRef = useRef(setCanvasZoom)
  useEffect(() => { setCanvasZoomRef.current = setCanvasZoom })
  // ── Tool functions ───────────────────────────────────────────
function handleCCAddToCanvas({ afterColumnId, newColumn }) {
    setCanvasColumns(prev => {
      const idx = prev.findIndex(c => c.canvasId === afterColumnId)
      const next = [...prev]
      next.splice(idx + 1, 0, newColumn)
      return next
    })
  }
  function runTrim(options) {
    const { spaces, casing } = options
    setCanvasColumns(prev => prev.map(col => ({ ...col, rows: col.rows.map(val => {
      if (val === undefined || val === null) return val
      let s = String(val)
      if (spaces) s = s.trim().replace(/\s+/g, ' ')
      if (casing === 'lower') s = s.toLowerCase()
      if (casing === 'upper') s = s.toUpperCase()
      if (casing === 'title') s = s.replace(/\b\w/g, c => c.toUpperCase())
      return s
    })})))
    setToolResult({ type: 'trim', message: 'Trim & Clean applied to all columns.' }); setActiveTool(null)
  }
  function runHighlightEmpty() { setHighlightEmpty(h => !h); setActiveTool(null) }
  function runDuplicates() {
    const map = {}
    canvasColumns.forEach(col => {
      const counts = {}
      col.rows.forEach(val => { if (val === undefined || val === null || val === '') return; const k = String(val).trim().toLowerCase(); counts[k] = (counts[k] || 0) + 1 })
      map[col.canvasId] = new Set(Object.keys(counts).filter(k => counts[k] > 1))
    })
    setDuplicateMap(map)
    const total = Object.values(map).reduce((sum, s) => sum + s.size, 0)
    setToolResult({ type: 'duplicates', message: `Found ${total} duplicate value${total !== 1 ? 's' : ''} across ${canvasColumns.length} column${canvasColumns.length !== 1 ? 's' : ''}.` }); setActiveTool(null)
  }
 function runStats() {
  const cards = canvasColumns.map((col, i) => {
    const vals = col.rows.filter(v => v !== undefined && v !== null && v !== '')
    const nums = vals.map(v => parseFloat(v)).filter(n => !isNaN(n))
    const unique = new Set(vals.map(v => String(v).trim().toLowerCase())).size
    return {
      id: col.canvasId,
      label: col.label,
      total: col.rows.length,
      filled: vals.length,
      empty: col.rows.length - vals.length,
      unique,
      min: nums.length ? Math.min(...nums) : '—',
      max: nums.length ? Math.max(...nums) : '—',
      sum: nums.length ? nums.reduce((a, b) => a + b, 0) : '—',
      x: 80 + i * 28,
      y: 100 + i * 28,
    }
  })
  setStatCards(cards)
  setActiveTool(null)
}

function moveStatCard(id, x, y) {
  setStatCards(prev => prev.map(c => c.id === id ? { ...c, x, y } : c))
}

  // ── Cell editing ─────────────────────────────────────────────
  function startCellEdit(canvasId, rowIndex, currentVal) {
    setSelectedCell({ canvasId, rowIndex })
    setEditingCell({ canvasId, rowIndex })
    setEditingCellVal(currentVal === undefined || currentVal === null ? '' : String(currentVal))
  }

  function commitCellEdit() {
    if (!editingCell) return
    const { canvasId, rowIndex } = editingCell
    setCanvasColumns(prev => prev.map(col => {
      if (col.canvasId !== canvasId) return col
      const newRows = [...col.rows]
      newRows[rowIndex] = editingCellVal
      return { ...col, rows: newRows }
    }))
    setEditingCell(null)
  }

  function commitAndMove(direction) {
    if (!editingCell) return
    const { canvasId, rowIndex } = editingCell
    setCanvasColumns(prev => prev.map(col => {
      if (col.canvasId !== canvasId) return col
      const newRows = [...col.rows]
      newRows[rowIndex] = editingCellVal
      return { ...col, rows: newRows }
    }))
    setEditingCell(null)
    const colIdx = sortedCanvasCols.findIndex(c => c.canvasId === canvasId)
    if (direction === 'down') {
      const nextRow = rowIndex + 1
      if (nextRow < maxRows) {
        const nextVal = sortedCanvasCols[colIdx]?.rows[nextRow]
        setTimeout(() => startCellEdit(canvasId, nextRow, nextVal), 0)
      }
    } else if (direction === 'right') {
      const nextColIdx = colIdx + 1
      if (nextColIdx < sortedCanvasCols.length) {
        const nextCol = sortedCanvasCols[nextColIdx]
        const nextVal = nextCol?.rows[rowIndex]
        setTimeout(() => startCellEdit(nextCol.canvasId, rowIndex, nextVal), 0)
      }
    } else if (direction === 'left') {
      const prevColIdx = colIdx - 1
      if (prevColIdx >= 0) {
        const prevCol = sortedCanvasCols[prevColIdx]
        const prevVal = prevCol?.rows[rowIndex]
        setTimeout(() => startCellEdit(prevCol.canvasId, rowIndex, prevVal), 0)
      }
    } else if (direction === 'up') {
      const prevRow = rowIndex - 1
      if (prevRow >= 0) {
        const prevVal = sortedCanvasCols[colIdx]?.rows[prevRow]
        setTimeout(() => startCellEdit(canvasId, prevRow, prevVal), 0)
      }
    }
  }

  function handleCellKeyDown(e) {
    if (['Enter','Tab','ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(e.key)) {
      e.preventDefault()
      e.stopPropagation()
    }
    if (e.key === 'Enter') { commitAndMove('down') }
    if (e.key === 'Tab') { commitAndMove(e.shiftKey ? 'left' : 'right') }
    if (e.key === 'Escape') { setEditingCell(null) }
    if (e.key === 'ArrowDown' && !e.shiftKey) { commitAndMove('down') }
    if (e.key === 'ArrowUp' && !e.shiftKey) { commitAndMove('up') }
    if (e.key === 'ArrowRight' && !e.shiftKey) { commitAndMove('right') }
    if (e.key === 'ArrowLeft' && !e.shiftKey) { commitAndMove('left') }
  }
  function deleteRow(rowIndex) { setCanvasColumns(prev => prev.map(col => { const newRows = [...col.rows]; newRows.splice(rowIndex, 1); return { ...col, rows: newRows } })); setEditingCell(null) }
  function copyRow(rowIndex) { const snap = {}; canvasColumns.forEach(col => { snap[col.canvasId] = col.rows[rowIndex] }); setCopiedRow(snap) }
  function pasteRow(atIndex, position) {
    if (!copiedRow) return
    const insertIdx = position === 'below' ? atIndex + 1 : atIndex
    setCanvasColumns(prev => prev.map(col => { const val = copiedRow[col.canvasId] ?? ''; const newRows = [...col.rows]; newRows.splice(insertIdx, 0, val); return { ...col, rows: newRows } }))
  }
  function hideRow(rowIndex) { setHiddenRows(prev => new Set([...prev, rowIndex])) }
  function showAllRows() { setHiddenRows(new Set()) }
  function addCanvas() {
  const id = `canvas_${Date.now()}`
  const name = `Canvas ${canvases.length + 1}`
  setCanvases(prev => [...prev, makeCanvas(id, name)])
  setActiveCanvasId(id)
  setActiveSheet(id)
}

function deleteCanvas(id) {
  if (canvases.length === 1) return
  const msg = `Delete "${canvases.find(c => c.id === id)?.name}"? This cannot be undone.`
  if (!window.confirm(msg)) return
  setCanvases(prev => {
    const next = prev.filter(c => c.id !== id)
    if (activeCanvasId === id) {
      setActiveCanvasId(next[0].id)
      setActiveSheet(next[0].id)
    }
    return next
  })
}
function cleanColumn(canvasId) {
  setCanvasColumns(prev => prev.map(col => {
    if (col.canvasId !== canvasId) return col
    return { ...col, rows: col.rows.map(val => {
      if (val === undefined || val === null) return val
      return String(val).trim().replace(/\s+/g, ' ')
    })}
  }))
}

function sortCanvasByCol(canvasId, dir) {
  setCanvasColumns(prev => {
    const col = prev.find(c => c.canvasId === canvasId)
    if (!col) return prev
    const rowCount = Math.max(...prev.map(c => c.rows.length))
    const indices = Array.from({ length: rowCount }, (_, i) => i)
    indices.sort((a, b) => {
      const av = col.rows[a] ?? '', bv = col.rows[b] ?? ''
      const an = parseFloat(av), bn = parseFloat(bv)
      const cmp = (!isNaN(an) && !isNaN(bn)) ? an - bn : String(av).localeCompare(String(bv))
      return dir === 'asc' ? cmp : -cmp
    })
    return prev.map(c => ({ ...c, rows: indices.map(i => c.rows[i]) }))
  })
}

function clearColumn(canvasId) {
  setCanvasColumns(prev => prev.map(col =>
    col.canvasId !== canvasId ? col : { ...col, rows: col.rows.map(() => '') }
  ))
}

function duplicateColumn(canvasId) {
  setCanvasColumns(prev => {
    const idx = prev.findIndex(c => c.canvasId === canvasId)
    if (idx === -1) return prev
    const original = prev[idx]
    const copy = { ...original, canvasId: `canvas_${Date.now()}_copy`, label: original.label + ' (copy)', rows: [...original.rows] }
    const next = [...prev]
    next.splice(idx + 1, 0, copy)
    return next
  })
}
function moveColBetweenFiles(sourceFileId, sourceSheetName, sourceColId, targetFileId, targetColId, side) {
    const sourceFile = files.find(f => f.id === sourceFileId)
    const sourceSheet = sourceFile?.sheets.find(s => s.name === sourceSheetName)
    const sourceHeader = sourceSheet?.headers.find(h => h.id === sourceColId)
    if (!sourceHeader || !sourceSheet) return
    const colRows = sourceSheet.rows.map(row => row[sourceHeader.index] ?? '')
    const newColId = `col_${Date.now()}_moved`
    setFiles(prev => prev.map(f => {
      if (f.id === sourceFileId) {
        return { ...f, sheets: f.sheets.map(s => s.name !== sourceSheetName ? s : {
          ...s,
          headers: s.headers.filter(h => h.id !== sourceColId).map((h, i) => ({ ...h, index: i })),
          rows: s.rows.map(row => {
            const newRow = [...row]
            newRow.splice(sourceHeader.index, 1)
            return newRow
          })
        })}
      }
      if (f.id === targetFileId) {
        return { ...f, sheets: f.sheets.map((s, si) => {
          if (si !== 0) return s
          const visible = s.headers.filter(h => !h.hidden)
          let insertIdx = visible.length
          if (targetColId) {
            const targetPos = visible.findIndex(h => h.id === targetColId)
            if (targetPos !== -1) insertIdx = side === 'before' ? targetPos : targetPos + 1
          }
          const newHeader = { id: newColId, label: sourceHeader.label, index: insertIdx, hidden: false }
          const updatedHeaders = [
            ...visible.slice(0, insertIdx),
            newHeader,
            ...visible.slice(insertIdx)
          ].map((h, i) => ({ ...h, index: i }))
          const maxLen = Math.max(s.rows.length, colRows.length)
          const newRows = Array.from({ length: maxLen }, (_, ri) => {
            const row = ri < s.rows.length ? [...s.rows[ri]] : Array(insertIdx).fill('')
            row.splice(insertIdx, 0, colRows[ri] ?? '')
            return row
          })
          return { ...s, headers: updatedHeaders, rows: newRows }
        })}
      }
      return f
    }))
    setDragOverFileId(null)
    setDragOverSidebarCol(null)
    dragData.current = null
  }
function sendCanvasColToFile(canvasId, fileId, insertAtColId, side) {
    const col = canvasColumns.find(c => c.canvasId === canvasId)
    if (!col) return
    const newColId = `col_${Date.now()}_pushed`
    setFiles(prev => prev.map(f => {
      if (f.id !== fileId) return f
      return {
        ...f, sheets: f.sheets.map((s, si) => {
          if (si !== 0) return s
          const visibleHeaders = s.headers.filter(h => !h.hidden)
          let insertIdx = visibleHeaders.length
          if (insertAtColId) {
            const targetPos = visibleHeaders.findIndex(h => h.id === insertAtColId)
            if (targetPos !== -1) insertIdx = side === 'before' ? targetPos : targetPos + 1
          }
          const newHeader = { id: newColId, label: col.label, index: insertIdx, hidden: false }
          const updatedHeaders = [
            ...visibleHeaders.slice(0, insertIdx),
            newHeader,
            ...visibleHeaders.slice(insertIdx)
          ].map((h, i) => ({ ...h, index: i }))
          const newRows = s.rows.map((row, ri) => {
            const newRow = [...row]
            newRow.splice(insertIdx, 0, col.rows[ri] ?? '')
            return newRow
          })
          if (newRows.length < col.rows.length) {
            for (let i = newRows.length; i < col.rows.length; i++) {
              const emptyRow = Array(updatedHeaders.length).fill('')
              emptyRow[insertIdx] = col.rows[i] ?? ''
              newRows.push(emptyRow)
            }
          }
          return { ...s, headers: updatedHeaders, rows: newRows }
        })
      }
    }))
    setCanvasColumns(prev => prev.filter(c => c.canvasId !== canvasId))
    setPinnedColIds(prev => prev.filter(id => id !== canvasId))
    setDragOverFileId(null)
    setDragOverSidebarCol(null)
    dragData.current = null
  }
  function addBlankColumn() {
    const newCol = { canvasId: `canvas_${Date.now()}_new`, colId: `new_${Date.now()}`, label: 'New Column', fileName: 'manual', sheetName: '', rows: Array(maxRows).fill('') }
    setCanvasColumns(prev => [...prev, newCol])
    setTimeout(() => { setEditingColId(newCol.canvasId); setEditingLabel('New Column') }, 50)
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
  function createBlankSheet() {
    const id = `file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const defaultHeaders = [
      { id: `col_${id}_a`, label: 'Column A', index: 0, hidden: false },
      { id: `col_${id}_b`, label: 'Column B', index: 1, hidden: false },
      { id: `col_${id}_c`, label: 'Column C', index: 2, hidden: false },
      { id: `col_${id}_d`, label: 'Column D', index: 3, hidden: false },
      { id: `col_${id}_e`, label: 'Column E', index: 4, hidden: false },
    ]
    const newFile = {
      id,
      name: 'Untitled.xlsx',
      sheets: [{
        name: 'Sheet 1',
        headers: defaultHeaders,
        rows: [], // empty — user fills via canvas
      }]
    }
    setFiles(prev => [...prev, newFile])
    setExpandedFiles(prev => new Set([...prev, id]))
  }
 function createNotebook() {
    const id = `notebook_${Date.now()}`
    const sheetId = `sheet_${Date.now()}`
    setNotebooks(prev => [...prev, { id, name: 'Untitled Notebook', sheets: [{ id: sheetId, name: 'Sheet 1', blocks: [] }], activeSheetId: sheetId }])
    setActiveNotebookId(id)
  }
  function renameNotebook(nbId, name) {
    setNotebooks(prev => prev.map(n => n.id !== nbId ? n : { ...n, name }))
  }
  function _getActiveSheetId(n) { return n.activeSheetId || n.sheets?.[0]?.id }
  function addNotebookBlock(nbId, type, x, y, customHeaders, customRows) {
    const id = `block_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const block = type === 'text'
      ? { id, type: 'text', x, y, w: 280, name: '', content: '' }
      : type === 'kanban'
      ? { id, type: 'kanban', x, y, name: '', lanes: [
          { id: `lane_${Date.now()}_1`, name: 'Lane 1', cards: [] },
          { id: `lane_${Date.now()}_2`, name: 'Lane 2', cards: [] },
          { id: `lane_${Date.now()}_3`, name: 'Lane 3', cards: [] },
        ]}
      : { id, type: 'table', x, y, name: '',
          headers: customHeaders || ['Column 1'],
          rows: customRows || Array(8).fill(null).map(() => ['']) }
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
      return { ...n, sheets: (n.sheets || []).map(s => s.id === sid ? { ...s, blocks: s.blocks.filter(b => b.id !== blockId) } : s) }
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
  function deleteNotebook(nbId) {
    setNotebooks(prev => prev.filter(n => n.id !== nbId))
  }
  function makeDragHandle(itemId, itemType, displayName) {
    return (
      <span
        draggable
        onDragStart={e => {
          e.stopPropagation()
          setSidebarItemDrag({ itemId, itemType })
          e.dataTransfer.effectAllowed = 'move'
          const el = document.createElement('div')
          el.textContent = displayName
          el.style.cssText = `position:fixed;top:-999px;padding:4px 10px;background:${accent};color:#fff;border-radius:5px;font:12px 'DM Sans',sans-serif;white-space:nowrap;`
          document.body.appendChild(el)
          e.dataTransfer.setDragImage(el, 0, 0)
          setTimeout(() => document.body.removeChild(el), 0)
        }}
        onDragEnd={() => setSidebarItemDrag(null)}
        onClick={e => e.stopPropagation()}
        title="Drag into a folder"
        style={{ fontSize: 10, color: text3, cursor: 'grab', padding: '0 2px', flexShrink: 0, userSelect: 'none', opacity: 0.45 }}>⠿</span>
    )
  }
 function renderNotebookInSidebar(nb, folderId) {
    const isExpanded = expandedNotebookIds.has(nb.id)
    return (
      <div key={nb.id}>
        <div className="nb-row"
          style={{ padding: '5px 8px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', background: 'transparent' }}
          onClick={() => {
            setExpandedNotebookIds(prev => {
              const next = new Set(prev)
              next.has(nb.id) ? next.delete(nb.id) : next.add(nb.id)
              return next
            })
          }}>
          {makeDragHandle(nb.id, 'notebook', nb.name)}
          <span style={{ fontSize: 13, flexShrink: 0 }}>📓</span>
          <span style={{ flex: 1, fontSize: 12, color: text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nb.name}</span>
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
        {/* BUG 1 FIX: Sheets now listed under notebook in sidebar */}
        {isExpanded && (
          <div style={{ paddingLeft: 20 }}>
            {nb.sheets?.map(sheet => {
              const isActive = activeNotebookId === nb.id && nb.activeSheetId === sheet.id
              const isRenaming = renamingSheetId === sheet.id
              return (
                <div key={sheet.id}
                  onClick={() => { if (!isRenaming) { setActiveNotebookId(nb.id); setNotebookActiveSheet(nb.id, sheet.id) } }}
                  onDoubleClick={e => { e.stopPropagation(); setRenamingSheetId(sheet.id); setRenamingSheetLabel(sheet.name) }}
                  title="Double-click to rename"
                  style={{ padding: '4px 8px', borderRadius: 5, fontSize: 11, color: isActive ? accent : text3, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontWeight: isActive ? 600 : 400, background: isActive ? accentDim : 'transparent' }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = raised }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}>
                  <span style={{ fontSize: 9 }}>📄</span>
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renamingSheetLabel}
                      onChange={e => setRenamingSheetLabel(e.target.value)}
                      onBlur={() => { renameNotebookSheet(nb.id, sheet.id, renamingSheetLabel || sheet.name); setRenamingSheetId(null) }}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
                      onClick={e => e.stopPropagation()}
                      style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: `1px solid ${accent}`, color: text, fontFamily: "'DM Sans',sans-serif", fontSize: 11, outline: 'none', minWidth: 0 }}
                    />
                  ) : (
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sheet.name}</span>
                  )}
                  {isActive && !isRenaming && <span style={{ fontSize: 9, color: accent }}>✓</span>}
                </div>
              )
            })}
            {/* Quick add sheet */}
            <button onClick={e => { e.stopPropagation(); addNotebookSheet(nb.id) }}
              style={{ padding: '3px 8px', border: 'none', background: 'none', color: text3, fontSize: 10, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}
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
          onClick={() => setExpandedFiles(prev => { const next = new Set(prev); next.has(file.id) ? next.delete(file.id) : next.add(file.id); return next })}
          onDragOver={e => {
            if (window.__nbTableDrag) { e.preventDefault(); setDragOverFileId(file.id); return }
            const d = dragData.current
            if (!d) return
            if (d.type === 'canvas' || (d.type === 'sidebar' && d.sourceFileId !== file.id)) { e.preventDefault(); setDragOverFileId(file.id) }
          }}
          onDragLeave={() => setDragOverFileId(null)}
          onDrop={e => {
            e.preventDefault(); e.stopPropagation()
            if (window.__nbTableDrag) {
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
  return
}
            const d = dragData.current
            if (!d) return
            if (d.type === 'canvas') {
              sendCanvasColToFile(d.canvasId, file.id, null, null)
            } else if (d.type === 'sidebar' && d.sourceFileId !== file.id) {
              addColumnsToCanvas(d.cols.map(c => ({ ...c, targetFileId: file.id })), null)
              d.cols.forEach(({ fileId: srcId, sheetName, col: c }) => {
                setFiles(prev => prev.map(f => f.id !== srcId ? f : { ...f, sheets: f.sheets.map(s => s.name !== sheetName ? s : { ...s, headers: s.headers.filter(h => h.id !== c.id) }) }))
              })
              setDragOverFileId(null)
              dragData.current = null
            }
          }}
          style={{ padding: '6px 8px', borderRadius: 6, fontSize: 12, color: text, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600, background: dragOverFileId === file.id ? accentDim : undefined, border: dragOverFileId === file.id ? `1px solid ${accent}` : '1px solid transparent' }}>
          {makeDragHandle(file.id, 'file', file.name)}
          <span style={{ fontSize: 13 }}>📄</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
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
                <button onClick={() => { const colInfos = selectedSidebarCols.map(id => { const col = file.sheets[0].headers.find(h => h.id === id); return col ? { fileId: file.id, fileName: file.name, sheetName: file.sheets[0].name, col } : null }).filter(Boolean); addColumnsToCanvas(colInfos, null) }} style={{ background: accentDim, border: `1px solid ${accent}44`, borderRadius: 5, padding: '3px 10px', fontSize: 11, color: accent, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}>
                  + Add {selectedSidebarCols.length} to canvas
                </button>
              </div>
            )}
            {visibleHeaders(file.sheets[0]).map(col => {
              const onCanvas = canvasColumns.some(c => c.colId === col.id)
              const isSelected = selectedSidebarCols.includes(col.id)
              return (
                <div key={col.id} className="col-row" draggable
                  onDragStart={e => handleSidebarDragStart(e, file.id, file.name, file.sheets[0].name, col)}
                  onClick={e => toggleSidebarSelect(e, col.id)}
                  onDragOver={e => {
                    if (dragData.current?.type !== 'canvas') return
                    e.preventDefault(); e.stopPropagation()
                    const rect = e.currentTarget.getBoundingClientRect()
                    const side = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                    setDragOverSidebarCol({ colId: col.id, side, fileId: file.id })
                    setDragOverFileId(null)
                  }}
                  onDragLeave={() => setDragOverSidebarCol(null)}
                  onDrop={e => {
                    e.preventDefault(); e.stopPropagation()
                    const d = dragData.current
                    if (!d || d.type !== 'canvas') return
                    sendCanvasColToFile(d.canvasId, file.id, col.id, dragOverSidebarCol?.side || 'after')
                  }}
                  style={{ padding: '4px 8px 4px 24px', borderRadius: 5, display: 'flex', alignItems: 'center', gap: 5, opacity: onCanvas ? 0.4 : 1, background: isSelected ? accentDim : 'transparent', borderLeft: isSelected ? `1px solid ${accent}44` : '1px solid transparent', borderRight: isSelected ? `1px solid ${accent}44` : '1px solid transparent', borderTop: dragOverSidebarCol?.colId === col.id && dragOverSidebarCol?.side === 'before' ? `2px solid ${accent}` : isSelected ? `1px solid ${accent}44` : '1px solid transparent', borderBottom: dragOverSidebarCol?.colId === col.id && dragOverSidebarCol?.side === 'after' ? `2px solid ${accent}` : isSelected ? `1px solid ${accent}44` : '1px solid transparent' }}>
                  <div style={{ width: 6, height: 6, borderRadius: 2, background: onCanvas ? text3 : accent, flexShrink: 0 }} />
                  <span title={col.label} style={{ flex: 1, fontSize: 11, color: isSelected ? accent : onCanvas ? text3 : text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.label}</span>
                  <span style={{ fontSize: 9, color: text3 }}>{file.sheets[0].rows.length}</span>
                  {onCanvas && <span style={{ fontSize: 9, color: accent, fontWeight: 700 }}>✓</span>}
                  {!onCanvas && (
                    <div className="col-actions">
                      <button style={{ color: text3, background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, padding: '1px 4px', borderRadius: 3 }} onClick={e => { e.stopPropagation(); hideColumn(file.id, file.sheets[0].name, col.id) }}>◌</button>
                      <button style={{ color: red, background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, padding: '1px 4px', borderRadius: 3 }} onClick={e => { e.stopPropagation(); deleteColumn(file.id, file.sheets[0].name, col.id) }}>✕</button>
                    </div>
                  )}
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
  const maxRows = useMemo(() => canvasColumns.length > 0 ? Math.max(...canvasColumns.map(c => c.rows.length)) : 0, [canvasColumns])
  const sortedCanvasCols = useMemo(() => [...canvasColumns.filter(c => pinnedColIds.includes(c.canvasId)), ...canvasColumns.filter(c => !pinnedColIds.includes(c.canvasId))], [canvasColumns, pinnedColIds])

  useEffect(() => { setVisibleRowCount(200) }, [activeCanvasId, canvasColumns.length])

  useEffect(() => {
    const sentinel = bottomSentinelRef.current
    if (!sentinel || maxRows === 0) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) setVisibleRowCount(prev => Math.min(prev + 200, maxRows)) },
      { root: canvasScrollRef.current, threshold: 0.1 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [maxRows, activeCanvasId])
    // ── PreviewActionPanel — filter/sort/group dropdown ──────────
  function PreviewActionPanel({ action, sheet, visible, file, si, previewSortMap, setPreviewSortMap, previewFilterMap, setPreviewFilterMap, onClose }) {
    const col = visible.find(c => c.id === action.colId)
    if (!col) return null
    const sortKey = `${file.id}-${si}-sort`
    const fKey = `${file.id}-${si}-${col.id}`
    const currentFilter = previewFilterMap[fKey] || new Set()
    const uniqueVals = [...new Set(sheet.rows.map(row => String(row[col.index] ?? '').trim()))].sort()

    if (action.type === 'sort') return (
      <div style={{ margin: '0 14px 8px', background: raised, border: `1px solid ${border}`, borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: text }}>Sort by <span style={{ color: accent }}>{col.label}</span></span>
        {[['asc','↑ A → Z'],['desc','↓ Z → A']].map(([dir, lbl]) => (
          <button key={dir} onClick={() => { setPreviewSortMap(prev => ({ ...prev, [sortKey]: { colId: col.id, colIndex: col.index, dir } })); onClose() }}
            style={{ padding: '4px 12px', borderRadius: 5, border: `1px solid ${previewSortMap[sortKey]?.dir === dir ? accent : border}`, background: previewSortMap[sortKey]?.dir === dir ? accentDim : 'transparent', color: previewSortMap[sortKey]?.dir === dir ? accent : text2, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>{lbl}</button>
        ))}
        {previewSortMap[sortKey] && (
          <button onClick={() => { setPreviewSortMap(prev => { const n = { ...prev }; delete n[sortKey]; return n }); onClose() }}
            style={{ padding: '4px 10px', borderRadius: 5, border: `1px solid ${red}44`, background: 'transparent', color: red, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>✕ Clear sort</button>
        )}
        <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 14 }}>✕</button>
      </div>
    )

    if (action.type === 'filter') return (
      <div style={{ margin: '0 14px 8px', background: raised, border: `1px solid ${border}`, borderRadius: 8, padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: text }}>Filter <span style={{ color: accent }}>{col.label}</span></span>
          <span style={{ fontSize: 11, color: text3 }}>Uncheck values to hide them</span>
          <button onClick={() => { setPreviewFilterMap(prev => { const n = { ...prev }; delete n[fKey]; return n }) }}
            style={{ padding: '2px 8px', borderRadius: 4, border: `1px solid ${border}`, background: 'transparent', color: text3, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Clear</button>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 110, overflowY: 'auto' }}>
          {uniqueVals.slice(0, 120).map(val => {
            const hidden = currentFilter.has(val.toLowerCase())
            return (
              <button key={val} onClick={() => setPreviewFilterMap(prev => {
                const cur = new Set(prev[fKey] || [])
                hidden ? cur.delete(val.toLowerCase()) : cur.add(val.toLowerCase())
                return { ...prev, [fKey]: cur }
              })} style={{ padding: '3px 10px', borderRadius: 4, border: `1px solid ${hidden ? red + '44' : border}`, background: hidden ? `${red}11` : 'transparent', color: hidden ? red : text2, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", textDecoration: hidden ? 'line-through' : 'none' }}>
                {val || '(empty)'}
              </button>
            )
          })}
          {uniqueVals.length > 120 && <span style={{ fontSize: 11, color: text3, alignSelf: 'center' }}>+{uniqueVals.length - 120} more</span>}
        </div>
      </div>
    )

    if (action.type === 'group') {
      const counts = {}
      sheet.rows.forEach(row => { const v = String(row[col.index] ?? '').trim() || '(empty)'; counts[v] = (counts[v] || 0) + 1 })
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
      return (
        <div style={{ margin: '0 14px 8px', background: raised, border: `1px solid ${border}`, borderRadius: 8, padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: text }}>Group by <span style={{ color: accent }}>{col.label}</span></span>
            <span style={{ fontSize: 11, color: text3 }}>{sorted.length} unique values</span>
            <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 14 }}>✕</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 100, overflowY: 'auto' }}>
            {sorted.slice(0, 60).map(([val, count]) => (
              <div key={val} style={{ padding: '3px 10px', borderRadius: 4, border: `1px solid ${border}`, background: surface, fontSize: 11, color: text2, display: 'flex', gap: 6, alignItems: 'center' }}>
                <span>{val}</span>
                <span style={{ background: accent + '22', color: accent, borderRadius: 3, padding: '0 5px', fontSize: 10, fontWeight: 700 }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )
    }
    return null
  }

  // ── Small reusable toggle button for Format bar ──────────────
  function StatCard({ card }) {
  function handleMouseDown(e) {
    if (e.target.closest('button')) return
    e.preventDefault()
    const startX = e.clientX - card.x
    const startY = e.clientY - card.y
    function onMove(ev) { moveStatCard(card.id, ev.clientX - startX, ev.clientY - startY) }
    function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const rows = [
    { label: 'Total',  value: card.total,  color: text2 },
    { label: 'Filled', value: card.filled, color: green },
    { label: 'Empty',  value: card.empty,  color: card.empty > 0 ? red : text3 },
    { label: 'Unique', value: card.unique, color: text2 },
    { label: 'Min',    value: typeof card.min === 'number' ? card.min.toLocaleString() : card.min, color: text2 },
    { label: 'Max',    value: typeof card.max === 'number' ? card.max.toLocaleString() : card.max, color: text2 },
    { label: 'Sum',    value: typeof card.sum === 'number' ? card.sum.toLocaleString() : card.sum, color: accent },
  ]
  const fillPct = card.total > 0 ? Math.round((card.filled / card.total) * 100) : 0
  return (
    <div onMouseDown={handleMouseDown} style={{ position: 'fixed', top: card.y, left: card.x, zIndex: 8000, width: 210, background: surface, border: `1px solid ${border}`, borderRadius: 10, boxShadow: `0 8px 32px #00000055`, fontFamily: "'DM Sans',sans-serif", cursor: 'grab', userSelect: 'none' }}>
      {/* Header */}
      <div style={{ padding: '9px 12px 8px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 7, background: accentDim, borderRadius: '10px 10px 0 0' }}>
        <span style={{ fontSize: 13, color: accent }}>▦</span>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.label}</span>
        <button onClick={() => setStatCards(prev => prev.filter(c => c.id !== card.id))} style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
          onMouseEnter={e => e.currentTarget.style.color = red} onMouseLeave={e => e.currentTarget.style.color = text3}>✕</button>
      </div>
      {/* Fill bar */}
      <div style={{ padding: '8px 12px 4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: text3, marginBottom: 4 }}>
          <span>Fill rate</span><span style={{ color: fillPct === 100 ? green : fillPct < 50 ? red : amber }}>{fillPct}%</span>
        </div>
        <div style={{ height: 4, borderRadius: 3, background: raised, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${fillPct}%`, background: fillPct === 100 ? green : fillPct < 50 ? red : amber, borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
      </div>
      {/* Stats rows */}
      <div style={{ padding: '4px 0 8px' }}>
        {rows.map(({ label, value, color }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 12px' }}>
            <span style={{ fontSize: 11, color: text3 }}>{label}</span>
            <span style={{ fontSize: 11, color, fontFamily: "'DM Mono',monospace", fontWeight: 600 }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
const colors = { surface, raised, border, text, text2, text3, accent, accentDim, red, green, amber }

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${border}; border-radius: 4px; }
        .tool-btn { transition: background 0.15s, color 0.15s, border-color 0.15s; }
        .tool-btn:hover { background: ${raised} !important; color: ${text} !important; }
        .tool-btn.active { background: ${accentDim} !important; color: ${accent} !important; border-color: ${accent} !important; }
        .import-btn:hover { opacity: 0.88; }
        .file-row:hover { background: ${raised} !important; }
        .col-row { transition: background 0.1s; cursor: grab; user-select: none; }
        .col-row:hover { background: ${raised} !important; }
        .col-row:hover .col-actions { opacity: 1 !important; }
        .col-row:active { cursor: grabbing; }
        .col-actions { opacity: 0; transition: opacity 0.15s; display: flex; gap: 3px; }
        .tab-btn { transition: background 0.15s, color 0.15s; }
        .canvas-row:hover td { background: ${raised}66 !important; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .fadein { animation: fadeUp 0.4s ease both; }
        .canvas-th { cursor: grab; position: relative; transition: opacity 0.1s; }
        .canvas-th:active { cursor: grabbing; }
        .canvas-th:hover .th-pin { opacity: 1 !important; }
        .col-label-click { cursor: text; border-radius: 3px; padding: 1px 3px; transition: background 0.1s; }
        .col-label-click:hover { background: ${raised}; }
        .export-item:hover { background: ${raised} !important; }
        .fmt-chip:hover { border-color: ${accent} !important; color: ${accent} !important; }
        .folder-row:hover { background: ${raised} !important; }
        .folder-row:hover .folder-actions { opacity: 1 !important; }
        .nb-row:hover { background: ${raised} !important; }
        .nb-row:hover .nb-actions { opacity: 1 !important; }
        .kanban-card:hover .card-del { opacity: 1 !important; }
      `}</style>

      <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFileChange} />

      {/* Context menu */}
      {contextMenu && (
        <div style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, background: surface, border: `1px solid ${border}`, borderRadius: 8, boxShadow: `0 8px 24px #00000044`, zIndex: 9999, minWidth: 160, overflow: 'hidden', fontFamily: "'DM Sans',sans-serif" }}>
          <div style={{ padding: '4px 0' }}>
            {[
              { label: 'Delete row',  icon: '✕', color: red,   action: () => { deleteRow(contextMenu.rowIndex); closeContextMenu() } },
              { label: 'Hide row',    icon: '◌', color: text2, action: () => { hideRow(contextMenu.rowIndex); closeContextMenu() } },
              { label: 'Copy row',    icon: '⊞', color: text2, action: () => { copyRow(contextMenu.rowIndex); closeContextMenu() } },
              ...(copiedRow ? [
                { label: 'Paste above', icon: '↑', color: accent, action: () => { pasteRow(contextMenu.rowIndex, 'above'); closeContextMenu() } },
                { label: 'Paste below', icon: '↓', color: accent, action: () => { pasteRow(contextMenu.rowIndex, 'below'); closeContextMenu() } },
              ] : []),
            ].map((item, i) => (
              <button key={i} onClick={item.action} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: item.color, fontSize: 13, fontFamily: "'DM Sans',sans-serif", cursor: 'pointer', textAlign: 'left' }}
                onMouseEnter={e => e.currentTarget.style.background = raised}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <span style={{ fontSize: 12, width: 14, textAlign: 'center' }}>{item.icon}</span>{item.label}
              </button>
            ))}
          </div>
        </div>
      )}
{colContextMenu && (
  <div style={{ position: 'fixed', top: colContextMenu.y, left: colContextMenu.x, background: surface, border: `1px solid ${border}`, borderRadius: 8, boxShadow: `0 8px 24px #00000044`, zIndex: 9999, minWidth: 180, overflow: 'hidden', fontFamily: "'DM Sans',sans-serif" }}
    onMouseLeave={() => setColContextMenu(null)}>
    <div style={{ padding: '6px 12px 4px', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: text3 }}>{colContextMenu.label}</div>
    <div style={{ padding: '4px 0 4px' }}>
      {[
        { label: 'Sort A → Z',     icon: '↑', color: text2,  action: () => { sortCanvasByCol(colContextMenu.canvasId, 'asc');  setColContextMenu(null) } },
        { label: 'Sort Z → A',     icon: '↓', color: text2,  action: () => { sortCanvasByCol(colContextMenu.canvasId, 'desc'); setColContextMenu(null) } },
        { label: 'Clean column',   icon: '✦', color: accent, action: () => { cleanColumn(colContextMenu.canvasId);             setColContextMenu(null) } },
        { label: 'Duplicate',      icon: '⊞', color: text2,  action: () => { duplicateColumn(colContextMenu.canvasId);         setColContextMenu(null) } },
        { label: 'Clear values',   icon: '□', color: amber,  action: () => { clearColumn(colContextMenu.canvasId);             setColContextMenu(null) } },
      ].map((item, i) => (
        <button key={i} onClick={item.action} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: item.color, fontSize: 13, fontFamily: "'DM Sans',sans-serif", cursor: 'pointer', textAlign: 'left' }}
          onMouseEnter={e => e.currentTarget.style.background = raised}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}>
          <span style={{ fontSize: 12, width: 14, textAlign: 'center' }}>{item.icon}</span>{item.label}
        </button>
      ))}
    </div>
  </div>
)}
      <div
        style={{ display: 'flex', flex: 1, overflow: 'hidden', fontFamily: "'DM Sans',sans-serif" }}
       onMouseDown={e => { if (contextMenu) setContextMenu(null); if (colContextMenu) setColContextMenu(null); if (editingCell && !e.target.closest('td input')) commitCellEdit(); if (!e.target.closest('td')) setSelectedCell(null) }}
        onDragOver={e => { if (dragData.current) e.preventDefault() }}
        onDrop={e => { e.preventDefault(); if (!dragData.current) return; if (dragData.current.type === 'sidebar') addColumnsToCanvas(dragData.current.cols, null); setInsertAt(null); lastInsert.current = null }}
      >

       {/* ── Sidebar ── */}
        <div style={{ width: 220, background: surface, borderRight: `1px solid ${border}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '12px 12px 6px' }}>
            <button className="import-btn" onClick={handleImportClick} style={{ width: '100%', padding: '9px 0', background: accent, color: '#fff', border: 'none', borderRadius: 7, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <span style={{ fontSize: 15 }}>+</span> Import File
            </button>
            <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
              <button onClick={createFolder}
                style={{ flex: 1, padding: '5px 0', background: 'transparent', border: `1px solid ${border}`, borderRadius: 6, color: text3, fontFamily: "'DM Sans',sans-serif", fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = text3 }}>
                📁 Folder
              </button>
              <button onClick={createNotebook}
                style={{ flex: 1, padding: '5px 0', background: 'transparent', border: `1px solid ${border}`, borderRadius: 6, color: text3, fontFamily: "'DM Sans',sans-serif", fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = text3 }}>
                📓 Notebook
              </button>
              <button onClick={createBlankSheet}
                style={{ flex: 1, padding: '5px 0', background: 'transparent', border: `1px solid ${border}`, borderRadius: 6, color: text3, fontFamily: "'DM Sans',sans-serif", fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = text3 }}>
                ▦ Sheet
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>

            {/* Folders */}
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
                    <span style={{ fontSize: 12, flexShrink: 0 }}>📁</span>
                    {renamingFolderId === folder.id ? (
                      <input autoFocus value={renamingFolderLabel}
                        onChange={e => setRenamingFolderLabel(e.target.value)}
                        onBlur={() => commitFolderRename(folder.id)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
                        onClick={e => e.stopPropagation()}
                        style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: `1px solid ${accent}`, color: text, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, outline: 'none', minWidth: 0 }} />
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
                    <div style={{ paddingLeft: 10 }}>
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

            {/* Uncategorized files */}
            {files.filter(f => !folders.some(folder => folder.itemIds.includes(f.id))).map(file => renderFileInSidebar(file, null))}

            {/* Uncategorized notebooks */}
            {notebooks.filter(n => !folders.some(folder => folder.itemIds.includes(n.id))).map(nb => renderNotebookInSidebar(nb, null))}

            {/* Empty state */}
            {files.length === 0 && notebooks.length === 0 && folders.length === 0 && (
              <div style={{ margin: '16px 6px', padding: '14px 12px', borderRadius: 8, border: `1px dashed ${border}`, textAlign: 'center', color: text3, fontSize: 12, lineHeight: 1.7 }}>
                No files yet.<br /><span style={{ color: text2 }}>Supports .xlsx .xls .csv</span>
              </div>
            )}
          </div>

          {allHiddenCols.length > 0 && (
            <div style={{ borderTop: `1px solid ${border}`, padding: '8px 10px' }}>
              <button onClick={() => setShowHidden(!showHidden)} style={{ background: 'none', border: 'none', cursor: 'pointer', width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: text3 }}>
                <span style={{ fontSize: 10 }}>{showHidden ? '▾' : '▸'}</span> Hidden ({allHiddenCols.length})
              </button>
              {showHidden && allHiddenCols.map(({ fileId, sheetName, col }) => (
                <div key={col.id} style={{ padding: '4px 4px 4px 16px', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 6, height: 6, borderRadius: 2, background: border, flexShrink: 0 }} />
                  <span title={col.label} style={{ flex: 1, fontSize: 11, color: text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'line-through' }}>{col.label}</span>
                  <button onClick={() => restoreColumn(fileId, sheetName, col.id)} style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 4, cursor: 'pointer', color: accent, fontSize: 11, padding: '2px 6px', fontFamily: "'DM Sans',sans-serif" }}>↩</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ padding: '8px 12px 12px', borderTop: `1px solid ${border}` }}>
            <button onClick={() => setDark(!dark)} style={{ background: 'none', border: 'none', padding: '4px 2px', fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: text3, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              {dark ? '☀️' : '🌙'} {dark ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
        </div>
        {/* ── Main ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Tabs bar */}
          {activeNotebookId && notebooks.find(n => n.id === activeNotebookId) && (
            <NotebookCanvas
              nb={notebooks.find(n => n.id === activeNotebookId)}
              dark={dark}
              colors={{ surface, raised, border, text, text2, text3, accent, accentDim, red, base, green, amber }}
              onBack={() => setActiveNotebookId(null)}
              onAddBlock={(type, x, y) => addNotebookBlock(activeNotebookId, type, x, y)}
              onUpdateBlock={(blockId, patch) => updateNotebookBlock(activeNotebookId, blockId, patch)}
              onDeleteBlock={(blockId) => deleteNotebookBlock(activeNotebookId, blockId)}
              onRenameNotebook={(name) => renameNotebook(activeNotebookId, name)}
              onRenameSheet={(sheetId, name) => renameNotebookSheet(activeNotebookId, sheetId, name)}
               onSendColToCanvas={(block, colIdx) => {
  const label = block.headers[colIdx]
  const rows = block.rows.map(r => r[colIdx] ?? '')
  const ts = Date.now()
  const nb = notebooks.find(n => n.id === activeNotebookId)

  const newCol = {
    canvasId: `nb_col_${ts}_${colIdx}`,
    colId: `nb_col_${ts}_${colIdx}`,
    label,
    fileName: nb?.name || 'Notebook',
    sheetName: '',
    rows,
  }

  setCanvasColumns(prev => [...prev, newCol])
  setToolResult({ type: 'trim', message: `Column "${label}" added to canvas from notebook.` })
  setActiveNotebookId(null)
  setMode('canvas')
  setActiveSheet(activeCanvasId)
}}
              onDropColumn={(x, y) => {
                const d = dragData.current
                if (!d || d.type !== 'sidebar') return
                const cols = d.cols
                const headers = cols.map(c => c.col.label)
                const maxLen = Math.max(...cols.map(c => { const f = files.find(f => f.id === c.fileId); const s = f?.sheets.find(sh => sh.name === c.sheetName); return s?.rows.length || 0 }))
                const rows = Array.from({ length: maxLen }, (_, ri) => cols.map(c => { const f = files.find(f => f.id === c.fileId); const s = f?.sheets.find(sh => sh.name === c.sheetName); return String(s?.rows[ri]?.[c.col.index] ?? '') }))
                addNotebookBlock(activeNotebookId, 'table', Math.max(0, x - 160), Math.max(0, y - 20), headers, rows)
                dragData.current = null
              }}
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
          {!activeNotebookId && <>
          {/* Tabs bar */}
          <div style={{ background: surface, borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 4, height: 42, flexShrink: 0 }}>
            {[{ id: 'preview', label: 'Preview' }, { id: 'canvas', label: `Canvas${canvasColumns.length > 0 ? ` (${canvasColumns.length})` : ''}` }].map(m => (
              <button key={m.id} className="tab-btn" onClick={() => setMode(m.id)} style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: mode === m.id ? accentDim : 'transparent', color: mode === m.id ? accent : text2, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: mode === m.id ? 600 : 400, cursor: 'pointer' }}>{m.label}</button>
            ))}
            <span style={{ marginLeft: 8, fontSize: 12, color: text3 }}>{mode === 'preview' ? 'View & edit raw file data' : 'Build your custom sheet'}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              {/* Export dropdown */}
              {(canvasColumns.length > 0 || files.length > 0) && (
                <div ref={exportDropdownRef} style={{ position: 'relative' }}>
                  <button onClick={() => setExportDropdownOpen(o => !o)} style={{ background: exportDropdownOpen ? accentDim : 'none', border: `1px solid ${exportDropdownOpen ? accent : border}`, borderRadius: 6, padding: '4px 11px', fontSize: 12, color: exportDropdownOpen ? accent : text2, fontFamily: "'DM Sans',sans-serif", fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 13 }}>↓</span> Export <span style={{ fontSize: 9, marginLeft: 1 }}>▾</span>
                  </button>
                  {exportDropdownOpen && (
                    <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: surface, border: `1px solid ${border}`, borderRadius: 9, boxShadow: `0 8px 28px #00000055`, zIndex: 9999, minWidth: 250, overflow: 'hidden', fontFamily: "'DM Sans',sans-serif" }}>
                      <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: text3 }}>Canvas</div>
                      {[
                        { label: 'Export as CSV',  icon: '📄', sub: 'Comma-separated values',     action: exportCanvasCSV  },
                        { label: 'Export as XLSX', icon: '📊', sub: 'Excel workbook with styles', action: exportCanvasXLSX },
                      ].map((item, i) => (
                        <button key={i} className="export-item" onClick={item.action} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                          <span style={{ fontSize: 16 }}>{item.icon}</span>
                          <div>
                            <div style={{ fontSize: 13, color: text, fontWeight: 500 }}>{item.label}</div>
                            <div style={{ fontSize: 11, color: text3 }}>{item.sub}</div>
                          </div>
                        </button>
                      ))}
                      <div style={{ padding: '6px 14px 10px', fontSize: 11, color: text3, borderTop: `1px solid ${border}`, marginTop: 4 }}>
                        Tip: use ◈ Format to style before export
                      </div>
                    </div>
                  )}
                </div>
              )}
              {mode === 'canvas' && canvasColumns.length > 0 && (
                <>
                  <button onClick={addBlankColumn} style={{ background: accentDim, border: `1px solid ${accent}44`, borderRadius: 5, padding: '3px 10px', fontSize: 11, color: accent, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}>+ Column</button>
                  <button onClick={() => { setCanvasColumns([]); setPinnedColIds([]) }} style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 5, padding: '3px 10px', fontSize: 11, color: text3, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Clear</button>
                </>
              )}
            </div>
          </div>

          {/* ── PREVIEW ── */}
          {mode === 'preview' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              {/* Action bar */}
              <div style={{ background: surface, borderBottom: `1px solid ${border}`, padding: '5px 12px', display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: text3, marginRight: 4 }}>
                  {selectedPreviewCols.length > 0
                    ? <span style={{ color: accent }}>✓ {selectedPreviewCols.length} column{selectedPreviewCols.length > 1 ? 's' : ''} selected</span>
                    : 'Click a column header to select it, then:'}
                </span>
                {['Filter', 'Sort', 'Group'].map(a => {
                  const isActive = previewAction?.type === a.toLowerCase() && previewAction?.colId === selectedPreviewCol?.colId
                  return (
                    <button key={a}
                      className="tool-btn"
                      disabled={!selectedPreviewCol}
                      onClick={() => {
                        if (!selectedPreviewCol) return
                        setPreviewAction(isActive ? null : { type: a.toLowerCase(), ...selectedPreviewCol })
                      }}
                      style={{ padding: '4px 10px', borderRadius: 5, border: `1px solid ${isActive ? accent : border}`, background: isActive ? accentDim : 'transparent', color: selectedPreviewCol ? (isActive ? accent : text2) : text3, fontFamily: "'DM Sans',sans-serif", fontSize: 11, cursor: selectedPreviewCol ? 'pointer' : 'default', opacity: selectedPreviewCol ? 1 : 0.5 }}
                    >{a}</button>
                  )
                })}
                {(selectedPreviewCols.length > 0 || previewAction || Object.keys(previewSortMap).length > 0 || Object.keys(previewFilterMap).length > 0) && (
                  <button onClick={() => { setSelectedPreviewCol(null); setSelectedPreviewCols([]); setPreviewAction(null); setPreviewSortMap({}); setPreviewFilterMap({}); setPreviewGroupMap({}) }}
                    style={{ marginLeft: 'auto', background: 'none', border: `1px solid ${border}`, borderRadius: 5, padding: '3px 9px', fontSize: 11, color: text3, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                    ↺ Clear all
                  </button>
                )}
              </div>

              {/* Scrollable table area */}
              <div
                style={{ flex: 1, overflow: 'auto' }}
                onClick={e => {
                  // Click on non-header area clears selection
                  if (!e.target.closest('th') && !e.ctrlKey && !e.metaKey) {
                    setSelectedPreviewCol(null)
                    setSelectedPreviewCols([])
                  }
                }}
              >
                {files.length === 0 ? (
                  <div className="fadein" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: text3, fontSize: 13 }}>Import a file to preview it here.</div>
                ) : files.map(file => file.sheets.map((sheet, si) => {
                  const sheetKey = `${file.id}-${si}`
                  // Only show the active sheet tab (default to first)
                  const activeKey = activePreviewSheet ? `${activePreviewSheet.fileId}-${activePreviewSheet.si}` : `${files[0]?.id}-0`
                  if (sheetKey !== activeKey) return null

                  const visible = visibleHeaders(sheet)
                  let displayRows = sheet.rows.slice(0, 500)

                  const sortKey = `${file.id}-${si}-sort`
                  const sortState = previewSortMap[sortKey]
                  if (sortState) {
                    const { colIndex, dir } = sortState
                    displayRows = [...displayRows].sort((a, b) => {
                      const av = a[colIndex] ?? '', bv = b[colIndex] ?? ''
                      const an = parseFloat(av), bn = parseFloat(bv)
                      const cmp = (!isNaN(an) && !isNaN(bn)) ? an - bn : String(av).localeCompare(String(bv))
                      return dir === 'asc' ? cmp : -cmp
                    })
                  }
                  visible.forEach(col => {
                    const fKey = `${file.id}-${si}-${col.id}`
                    const hidden = previewFilterMap[fKey]
                    if (hidden && hidden.size > 0) {
                      displayRows = displayRows.filter(row => !hidden.has(String(row[col.index] ?? '').trim().toLowerCase()))
                    }
                  })

                  const activeDropdown = previewAction && previewAction.fileId === file.id && previewAction.sheetIdx === si ? previewAction : null

                  return (
                    <div key={sheetKey} className="fadein">
                      {activeDropdown && (
                        <PreviewActionPanel
                          action={activeDropdown}
                          sheet={sheet}
                          visible={visible}
                          file={file}
                          si={si}
                          previewSortMap={previewSortMap}
                          setPreviewSortMap={setPreviewSortMap}
                          previewFilterMap={previewFilterMap}
                          setPreviewFilterMap={setPreviewFilterMap}
                          onClose={() => setPreviewAction(null)}
                          surface={surface} raised={raised} border={border}
                          text={text} text2={text2} text3={text3} accent={accent} accentDim={accentDim}
                          red={red}
                        />
                      )}

                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: "'DM Mono',monospace" }}>
                        <thead>
                          <tr style={{ background: surface, position: 'sticky', top: 0, zIndex: 5 }}>
                            <th style={{ width: 36, padding: '7px 10px', borderBottom: `1px solid ${border}`, borderRight: `1px solid ${border}`, color: text3, fontSize: 10, textAlign: 'center', fontWeight: 500, background: surface }}>#</th>
                            {visible.map(col => {
                              const isSelCol = selectedPreviewCols.includes(col.id)
                              const sortKey2 = `${file.id}-${si}-sort`
                              const isSorted = previewSortMap[sortKey2]?.colId === col.id
                              const isFiltered = previewFilterMap[`${file.id}-${si}-${col.id}`]?.size > 0
                              return (
                                <th key={col.id}
                                  onClick={e => {
                                    e.stopPropagation()
                                    if (e.ctrlKey || e.metaKey) {
                                      // Ctrl+click: toggle this column in multi-select
                                      setSelectedPreviewCols(prev =>
                                        prev.includes(col.id) ? prev.filter(id => id !== col.id) : [...prev, col.id]
                                      )
                                      // Keep selectedPreviewCol as the last clicked for actions
                                      setSelectedPreviewCol({ fileId: file.id, sheetIdx: si, colId: col.id, colIndex: col.index })
                                    } else {
                                      // Normal click: select only this one
                                      setSelectedPreviewCols(isSelCol && selectedPreviewCols.length === 1 ? [] : [col.id])
                                      setSelectedPreviewCol(isSelCol && selectedPreviewCols.length === 1 ? null : { fileId: file.id, sheetIdx: si, colId: col.id, colIndex: col.index })
                                    }
                                  }}
                                  style={{ padding: '7px 12px', borderBottom: `1px solid ${isSelCol ? accent : border}`, borderRight: `1px solid ${border}`, color: isSelCol ? accent : text, fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif", fontSize: 12, background: isSelCol ? accentDim : surface, cursor: 'pointer', userSelect: 'none', position: 'relative' }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <span>{col.label}</span>
                                    {isSorted && <span style={{ fontSize: 10, color: accent }}>{previewSortMap[sortKey2]?.dir === 'asc' ? '↑' : '↓'}</span>}
                                    {isFiltered && <span style={{ fontSize: 10, color: amber }}>▼</span>}
                                    <div style={{ display: 'flex', gap: 3, opacity: 0, marginLeft: 'auto' }} onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = 0} onClick={e => e.stopPropagation()}>
                                      <button style={{ color: text3, background: raised, border: `1px solid ${border}`, borderRadius: 3, fontSize: 10, padding: '1px 5px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }} onClick={() => hideColumn(file.id, sheet.name, col.id)}>Hide</button>
                                      <button style={{ color: red, background: redDim, border: `1px solid ${red}44`, borderRadius: 3, fontSize: 10, padding: '1px 5px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }} onClick={() => deleteColumn(file.id, sheet.name, col.id)}>Del</button>
                                    </div>
                                  </div>
                                </th>
                              )
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {displayRows.map((row, ri) => (
                            <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : `${surface}55` }}>
                              <td style={{ padding: '5px 10px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, color: text3, textAlign: 'center', fontSize: 10 }}>{ri + 1}</td>
                              {visible.map(col => {
                                const val = row[col.index]
                                const isEmpty = val === undefined || val === null || val === ''
                                const isSelCol = selectedPreviewCols.includes(col.id)
                                return (
                                  <td key={col.id} style={{ padding: '5px 12px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, color: isEmpty ? text3 : text2, whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', background: isSelCol ? `${accentDim}55` : 'transparent' }}>
                                    {isEmpty ? <span style={{ fontSize: 10 }}>—</span> : String(val)}
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {sheet.rows.length > 500 && <div style={{ padding: '8px 14px', fontSize: 11, color: text3 }}>Showing 500 of {sheet.rows.length} rows</div>}
                    </div>
                  )
                }))}
              </div>

              {/* Preview sheet tabs — bottom bar */}
              <div style={{ borderTop: `1px solid ${border}`, background: surface, display: 'flex', alignItems: 'center', flexShrink: 0, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'stretch', flex: 1, overflowX: 'auto' }}>
                  {files.flatMap(file =>
                    file.sheets.map((sheet, si) => {
                      const key = `${file.id}-${si}`
                      const activeKey = activePreviewSheet ? `${activePreviewSheet.fileId}-${activePreviewSheet.si}` : `${files[0]?.id}-0`
                      const isActive = key === activeKey
                      return (
                        <button key={key}
                          onClick={() => { setActivePreviewSheet({ fileId: file.id, si }); setSelectedPreviewCol(null); setSelectedPreviewCols([]); setPreviewAction(null) }}
                          style={{ padding: '6px 16px', border: 'none', borderRight: `1px solid ${border}`, borderTop: isActive ? `2px solid ${accent}` : `2px solid transparent`, background: isActive ? base : surface, color: isActive ? accent : text2, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: isActive ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: text3, fontSize: 10 }}>📄</span>
                          {file.sheets.length > 1 ? `${file.name} — ${sheet.name}` : file.name}
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── CANVAS ── */}
          {mode === 'canvas' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

              {/* ══ TOOLBAR or FORMAT BAR ══ */}
              {activeTool === 'format' ? (
                <FormatBar
                  colors={colors}
                  dark={dark}
                  canvasColumns={canvasColumns}
                  colFormats={colFormats}
                  formatSelectedCols={formatSelectedCols}
                  setFormatSelectedCols={setFormatSelectedCols}
                  globalFormat={globalFormat}
                  getFormatValue={getFormatValue}
                  updateColFormat={updateColFormat}
                  updateGlobalFormat={updateGlobalFormat}
                  onResetAll={() => { setColFormats({}); setGlobalFormat(defaultGlobalFormat()) }}
                  onClose={() => setActiveTool(null)}
                />
              ) : (
                <div style={{ background: surface, borderBottom: `1px solid ${border}`, padding: '6px 12px', display: 'flex', gap: 3, flexWrap: 'wrap', flexShrink: 0 }}>
                  {tools.map(tool => (
                    <button key={tool.id}
                      className={`tool-btn${activeTool === tool.id ? ' active' : ''}`}
                      onClick={() => {
                        if (tool.id === 'crosscheck') { setActiveTool(null); setShowCCWizard(true) }
                        else setActiveTool(activeTool === tool.id ? null : tool.id)
                      }}
                      title={tool.desc}
                      style={{ padding: '5px 11px', borderRadius: 6, border: `1px solid ${tool.id === 'format' && hasAnyFormat ? accent + '77' : border}`, background: tool.id === 'format' && hasAnyFormat ? accentDim : 'transparent', color: text2, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}
                    >
                      <span style={{ fontSize: 13 }}>{tool.icon}</span>
                      <span>{tool.label}</span>
                      {tool.id === 'format' && hasAnyFormat && <span style={{ width: 5, height: 5, borderRadius: '50%', background: accent }} />}
                    </button>
                  ))}
                </div>
              )}

              {/* Tool result banner */}
              {toolResult && !activeTool && (
                <div style={{ background: dark ? '#0d2a1a' : '#dcfce7', borderBottom: `1px solid #4ade8044`, padding: '8px 16px', fontSize: 12, color: '#4ade80', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span>✓</span>
                  <span>{toolResult.type === 'stats' ? 'Col Stats — see below' : toolResult.message}</span>
                  <button onClick={() => setToolResult(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 14 }}>✕</button>
                </div>
              )}

              {/* Tool panels */}
              {activeTool === 'trim' && (
                <TrimPanel
                  colors={colors}
                  onRun={runTrim}
                  onClose={() => setActiveTool(null)}
                />
              )}
             {activeTool === 'empty' && (
                <EmptyPanel
                  colors={colors}
                  isOn={highlightEmpty}
                  onToggle={runHighlightEmpty}
                  onClose={() => setActiveTool(null)}
                />
              )}
              {activeTool === 'duplicates' && (
                <DuplicatesPanel
                  colors={colors}
                  onRun={runDuplicates}
                  onClear={() => { setDuplicateMap({}); setActiveTool(null) }}
                  onClose={() => setActiveTool(null)}
                />
              )}
              {activeTool === 'stats' && (
                <StatsPanel
                  colors={colors}
                  onRun={runStats}
                  onClose={() => setActiveTool(null)}
                />
              )}
             
              {activeTool && !['trim','empty','duplicates','stats','format','crosscheck'].includes(activeTool) && (
                <div style={{ background: accentDim, borderBottom: `1px solid ${accent}44`, padding: '9px 16px', fontSize: 13, color: accent, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <span style={{ fontWeight: 600 }}>{tools.find(t => t.id === activeTool)?.label}</span>
                  <span style={{ color: text2, fontWeight: 400 }}>— {tools.find(t => t.id === activeTool)?.desc}</span>
                  <button onClick={() => setActiveTool(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 15 }}>✕</button>
                </div>
              )}

              {/* Canvas scroll area */}
              <div ref={setCanvasScrollEl} onDragOver={handleCanvasZoneDragOver} onDrop={handleCanvasZoneDrop} onDragLeave={handleCanvasDragLeave} onMouseDown={handleCanvasMouseDown} onContextMenu={e => { e.preventDefault() }}
                style={{ flex: 1, overflow: 'auto', background: base, position: 'relative', cursor: 'default', userSelect: 'none' }}>
                {canvasColumns.length === 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 40 }}>
                    <div className="fadein" style={{ textAlign: 'center', maxWidth: 340 }}>
                      <div style={{ width: 60, height: 60, borderRadius: 14, background: raised, border: `1px dashed ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto 18px' }}>📊</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: text, marginBottom: 8, fontFamily: "'Syne',sans-serif" }}>Canvas is empty</div>
                      <div style={{ fontSize: 13, color: text2, lineHeight: 1.8, marginBottom: 22 }}>Drag columns from the sidebar to build your sheet.</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, textAlign: 'left' }}>
                        {[{ icon: '⚡', text: 'Drag Company Name from two files → run Crosscheck' }, { icon: '◎', text: 'Drag two columns → find gaps between them' }, { icon: '✦', text: 'Shift+click columns in sidebar to select multiple' }].map((h, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', borderRadius: 7, background: surface, border: `1px solid ${border}`, fontSize: 12, color: text2 }}>
                            <span style={{ color: accent, fontSize: 14, flexShrink: 0 }}>{h.icon}</span>{h.text}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'inline-block', minWidth: '100%' }}>
                    <div style={{ zoom: canvasZoom, willChange: 'zoom' }}>
                      <div
                        className="canvas-grid"
                        style={{
                          display: 'grid',
                          gridTemplateColumns: `42px ${sortedCanvasCols.map(() => 'minmax(80px, 240px)').join(' ')} 1fr`,
                          gridAutoRows: 'auto',
                          fontSize: 12,
                          fontFamily: "'DM Mono',monospace",
                          width: 'max-content',
                          minWidth: '100%',
                        }}
                      >
                        {/* ── HEADER ROW ─────────────────────────────────── */}
                        {/* Row-number column header (top-left) */}
                        <div style={{
                          padding: '8px 10px',
                          borderBottom: `1px solid ${border}`,
                          borderRight: `1px solid ${border}`,
                          color: text3, fontSize: 10, textAlign: 'center', fontWeight: 500,
                          background: globalFormat.boldHeader ? globalFormat.headerColor + '22' : surface,
                          position: 'sticky', top: 0, zIndex: 5,
                          boxSizing: 'border-box',
                        }}>#</div>

                        {/* Data column headers */}
                        {sortedCanvasCols.map((col, idx) => {
                          const isPinned = pinnedColIds.includes(col.canvasId)
                          const isDraggingThis = draggingCanvasId === col.canvasId
                          const isInsertBefore = insertAt?.index === idx && insertAt?.side === 'left'
                          const isInsertAfter  = insertAt?.index === idx && insertAt?.side === 'right'
                          const fmt = getColFormat(col.canvasId)
                          return (
                            <div key={col.canvasId} className="canvas-th" draggable
                              onDragStart={e => handleCanvasDragStart(e, col.canvasId)}
                              onDragEnd={handleCanvasDragEnd}
                              onDragOver={e => handleThDragOver(e, idx)}
                              onDrop={e => handleThDrop(e, idx)}
                              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setColContextMenu({ x: e.clientX, y: e.clientY, canvasId: col.canvasId, label: col.label }) }}
                              style={{ position: 'sticky', top: 0, zIndex: 4, padding: '8px 12px', borderBottom: `1px solid ${border}`, borderRight: `1px solid ${border}`, textAlign: fmt.align || 'left', whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif", fontSize: fmt.fontSize || 12, fontWeight: globalFormat.boldHeader ? 700 : 600, background: isPinned ? (dark ? '#1a1f4a' : '#e8f5ee') : globalFormat.boldHeader ? globalFormat.headerColor + '22' : surface, color: globalFormat.boldHeader ? globalFormat.headerColor : text, opacity: isDraggingThis ? 0.3 : 1, overflow: 'visible', boxSizing: 'border-box', cursor: 'grab' }}
                            >
                              {isInsertBefore && <div style={{ position: 'absolute', left: -1, top: 0, bottom: 0, width: 3, background: accent, borderRadius: 2, zIndex: 10, pointerEvents: 'none' }}><div style={{ position: 'absolute', top: -3, left: -2, width: 7, height: 7, borderRadius: '50%', background: accent }} /></div>}
                              {isInsertAfter  && <div style={{ position: 'absolute', right: -2, top: 0, bottom: 0, width: 3, background: accent, borderRadius: 2, zIndex: 10, pointerEvents: 'none' }}><div style={{ position: 'absolute', top: -3, left: -2, width: 7, height: 7, borderRadius: '50%', background: accent }} /></div>}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {editingColId === col.canvasId ? (
                                  <input ref={editInputRef} value={editingLabel} onChange={e => setEditingLabel(e.target.value)} onBlur={() => commitEdit(col.canvasId)} onKeyDown={e => { if (e.key === 'Enter') commitEdit(col.canvasId); if (e.key === 'Escape') setEditingColId(null) }} style={{ background: raised, border: `1px solid ${accent}`, borderRadius: 4, padding: '2px 6px', color: text, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, width: 120, outline: 'none' }} autoFocus onClick={e => e.stopPropagation()} />
                                ) : (
                                  <div>
                                    <div className="col-label-click" onClick={() => startEdit(col.canvasId, col.label)} title="Click to rename" style={{ display: 'inline-block' }}>{col.label}</div>
                                    <div style={{ color: text3, fontSize: 10, fontWeight: 400, marginTop: 1 }}>{col.fileName}</div>
                                  </div>
                                )}
                                <button className="th-pin" title={isPinned ? 'Unpin' : 'Pin'} onClick={() => togglePin(col.canvasId)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: '0 2px', color: isPinned ? accent : text3, opacity: isPinned ? 1 : 0, marginLeft: 'auto', flexShrink: 0 }}>📌</button>
                                <button onClick={() => removeCanvasColumn(col.canvasId)} title="Remove" style={{ background: 'none', border: 'none', cursor: 'pointer', color: text3, fontSize: 11, padding: '0 2px', lineHeight: 1, flexShrink: 0, opacity: 0.5, marginLeft: 2 }} onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = 0.5}>✕</button>
                              </div>
                            </div>
                          )
                        })}

                        {/* + col button (trailing header cell) */}
                        <div onClick={addBlankColumn} style={{ padding: '8px 14px', borderBottom: `1px solid ${border}`, borderRight: `1px solid ${border}`, background: surface, position: 'sticky', top: 0, zIndex: 4, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: text3, display: 'flex', alignItems: 'center', boxSizing: 'border-box' }}
                          onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = accent }}
                          onMouseLeave={e => { e.currentTarget.style.background = surface; e.currentTarget.style.color = text3 }}>+ col</div>

                        {/* ── DATA ROWS ───────────────────────────────────── */}
                        {Array.from({ length: Math.min(visibleRowCount, maxRows) }).map((_, ri) => {
                          if (hiddenRows.has(ri)) return null
                          const isBandedRow = globalFormat.banding && ri % 2 === 0
                          return (
                            <Fragment key={`row_${ri}`}>
                              {/* Row number cell */}
                              <div onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, rowIndex: ri }) }}
                                style={{ padding: '5px 10px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, color: text3, textAlign: 'center', fontSize: 10, cursor: 'context-menu', userSelect: 'none', boxSizing: 'border-box' }}
                                onMouseEnter={e => { e.currentTarget.style.background = raised }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>{ri + 1}</div>

                              {/* Data cells */}
                              {sortedCanvasCols.map((col, idx) => {
                                const val = col.rows[ri]
                                const isEmpty = val === undefined || val === null || val === ''
                                const isPinned = pinnedColIds.includes(col.canvasId)
                                const isEditing = editingCell?.canvasId === col.canvasId && editingCell?.rowIndex === ri
                                const isDup = duplicateMap[col.canvasId]?.has(String(val ?? '').trim().toLowerCase())
                                const isEmptyHighlight = highlightEmpty && isEmpty
                                const fmt = getColFormat(col.canvasId)
                                const ccDec = col.label === 'CC Decision' ? String(val || '').toLowerCase() : null
                                const isSelected = selectedCell?.canvasId === col.canvasId && selectedCell?.rowIndex === ri && !isEditing
                                let bg = ri % 2 === 1 ? `${surface}55` : 'transparent'
                                if (isPinned) bg = dark ? '#1a1f4a33' : '#e8f5ee88'
                                if (isBandedRow) bg = dark ? globalFormat.headerColor + '22' : globalFormat.headerColor + '11'
                                if (isDup) bg = dark ? '#2a1f0d' : '#fef3c7'
                                if (isEmptyHighlight) bg = dark ? '#2a0d0d' : '#fee2e2'
                                if (ccDec === 'matched')   bg = dark ? '#0d2a1a' : '#dcfce7'
                                if (ccDec === 'maybe')     bg = dark ? '#2a1f0d' : '#fef3c7'
                                if (ccDec === 'unmatched') bg = dark ? '#2a0d0d' : '#fee2e2'
                                return (
                                  <div key={col.canvasId}
                                    onDragOver={e => handleThDragOver(e, idx)}
                                    onDrop={e => handleThDrop(e, idx)}
                                    onClick={() => !isEditing && startCellEdit(col.canvasId, ri, val)}
                                    style={{ position: 'relative', padding: isEditing ? '0' : '5px 14px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, outline: isSelected ? `2px solid ${accent}` : 'none', outlineOffset: '-2px', color: ccDec === 'matched' ? green : ccDec === 'maybe' ? amber : ccDec === 'unmatched' ? red : isEmptyHighlight ? '#f87171' : isDup ? '#E8B85B' : isEmpty ? text3 : text2, whiteSpace: fmt.wrap ? 'normal' : 'nowrap', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', background: bg, cursor: isEditing ? 'text' : 'default', fontSize: fmt.fontSize || 12, fontWeight: fmt.bold ? 700 : 400, textAlign: fmt.align || 'left', boxSizing: 'border-box' }}
                                  >
                                    {isEditing ? (
                                      <input autoFocus value={editingCellVal} onChange={e => setEditingCellVal(e.target.value)} onBlur={commitCellEdit} onKeyDown={handleCellKeyDown} style={{ width: '100%', padding: '5px 14px', border: 'none', borderBottom: `2px solid ${accent}`, background: raised, color: text, fontFamily: "'DM Mono',monospace", fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
                                    ) : isEmptyHighlight ? (
                                      <span style={{ fontSize: 11, color: '#f87171', fontStyle: 'italic' }}>empty — click to fill</span>
                                    ) : isEmpty ? (
                                      <span style={{ fontSize: 10 }}>—</span>
                                    ) : String(val)}
                                  </div>
                                )
                              })}

                              {/* Trailing empty cell to match + col header */}
                              <div style={{ borderBottom: `1px solid ${border}22`, background: 'transparent', boxSizing: 'border-box' }} />
                            </Fragment>
                          )
                        })}
                      </div>
                      <div ref={bottomSentinelRef} style={{ height: 1 }} />
                    </div>
                  </div>
                )}
              </div>

            
              {/* Hidden rows banner */}
              {hiddenRows.size > 0 && (
                <div style={{ padding: '5px 16px', background: dark ? '#2a1f0d' : '#fef3c7', borderTop: `1px solid ${amber}44`, fontSize: 11, color: amber, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span>◌ {hiddenRows.size} row{hiddenRows.size !== 1 ? 's' : ''} hidden</span>
                  <button onClick={showAllRows} style={{ background: 'none', border: `1px solid ${amber}44`, borderRadius: 4, padding: '2px 8px', color: amber, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Show all</button>
                </div>
              )}

              {/* Sheets bar */}
              <div style={{ borderTop: `1px solid ${border}`, background: surface, display: 'flex', alignItems: 'center', flexShrink: 0, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'stretch', flex: 1, overflowX: 'auto' }}>
                  {canvases.map(canvas => {
  const isActive = activeSheet === canvas.id
  return (
    <div key={canvas.id} style={{ display: 'flex', alignItems: 'stretch', position: 'relative', flexShrink: 0 }}
      onMouseEnter={e => e.currentTarget.querySelector('.del-canvas').style.opacity = '1'}
      onMouseLeave={e => e.currentTarget.querySelector('.del-canvas').style.opacity = '0'}>
      <button
        onClick={() => { setActiveSheet(canvas.id); setActiveCanvasId(canvas.id) }}
        onDoubleClick={() => { setRenamingCanvasId(canvas.id); setRenamingCanvasLabel(canvas.name) }}
        style={{ padding: '6px 16px', border: 'none', borderRight: 'none', borderTop: isActive ? `2px solid ${accent}` : `2px solid transparent`, background: isActive ? base : surface, color: isActive ? accent : text2, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: isActive ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
        {renamingCanvasId === canvas.id ? (
          <input autoFocus value={renamingCanvasLabel}
            onChange={e => setRenamingCanvasLabel(e.target.value)}
            onBlur={() => { setCanvases(prev => prev.map(c => c.id === canvas.id ? { ...c, name: renamingCanvasLabel || canvas.name } : c)); setRenamingCanvasId(null) }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
            onClick={e => e.stopPropagation()}
            style={{ background: 'transparent', border: 'none', color: accent, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, outline: 'none', width: Math.max(60, renamingCanvasLabel.length * 8) }} />
        ) : canvas.name}
      </button>
      {canvases.length > 1 && (
        <button className="del-canvas" onClick={() => deleteCanvas(canvas.id)}
          style={{ opacity: 0, transition: 'opacity 0.15s', padding: '0 6px', border: 'none', borderRight: `1px solid ${border}`, borderTop: isActive ? `2px solid ${accent}` : `2px solid transparent`, background: isActive ? base : surface, color: text3, cursor: 'pointer', fontSize: 11 }}>✕</button>
      )}
      {!canvases.length > 1 && <div style={{ width: 1, background: border, borderTop: isActive ? `2px solid ${accent}` : `2px solid transparent` }} />}
    </div>
  )
})}
                  {files.flatMap(file => file.sheets.map(sheet => { const key = `${file.id}::${sheet.name}`; const isActive = activeSheet === key; return (
                    <button key={key} onClick={() => { 
  setActiveSheet(key)
  setMode('preview')
  setActivePreviewSheet({ fileId: file.id, si: file.sheets.indexOf(sheet) })
}} style={{ padding: '6px 16px', border: 'none', borderRight: `1px solid ${border}`, borderTop: isActive ? `2px solid ${accent}` : `2px solid transparent`, background: isActive ? base : surface, color: isActive ? accent : text2, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: isActive ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: text3, fontSize: 10 }}>📄</span>{file.sheets.length > 1 ? `${file.name} — ${sheet.name}` : file.name}
                    </button>
                  )}))}
                  <button onClick={addCanvas} style={{ padding: '6px 12px', border: 'none', borderRight: `1px solid ${border}`, borderTop: '2px solid transparent', background: 'transparent', color: text3, cursor: 'pointer', fontSize: 16, lineHeight: 1, flexShrink: 0 }}>+</button>
                </div>
                <div style={{ padding: '0 14px', fontSize: 11, color: text3, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, borderLeft: `1px solid ${border}` }}>
                  <span style={{ color: green, fontSize: 8 }}>●</span>
                  <span>{maxRows.toLocaleString()} rows</span><span>·</span><span>{canvasColumns.length} cols</span>
                  {maxRows > 500 && <span style={{ color: amber }}>· 500 shown</span>}
                  <span style={{ marginLeft: 6, borderLeft: `1px solid ${border}`, paddingLeft: 8 }}>
                    <button onClick={() => setCanvasZoom(prev => Math.min(2, Math.round((prev + 0.1) * 10) / 10))} style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 13, padding: '0 3px' }}>+</button>
                    <span style={{ minWidth: 36, textAlign: 'center', display: 'inline-block', cursor: 'pointer' }} onClick={() => setCanvasZoom(1)}>{Math.round(canvasZoom * 100)}%</span>
                    <button onClick={() => setCanvasZoom(prev => Math.max(0.5, Math.round((prev - 0.1) * 10) / 10))} style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 13, padding: '0 3px' }}>−</button>
                  </span>
                </div>
              </div>
            </div>
          )}
        </>}
      </div>
    </div>
      {/* Floating stat cards */}
      {statCards.map(card => <StatCard key={card.id} card={card} />)}

      <CrosscheckWizard
        open={showCCWizard}
        onClose={() => setShowCCWizard(false)}
        canvasColumns={canvasColumns}
        onAddToCanvas={handleCCAddToCanvas}
        colors={colors}
        dark={dark}
      />
    </>
  )
}