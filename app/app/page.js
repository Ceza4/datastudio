'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import { useTheme } from '../providers'
import * as XLSX from 'xlsx'

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
  exportAsTable: false, // moved into format bar
})

export default function AppPage() {
  const { dark, setDark } = useTheme()
  const [mode, setMode] = useState('preview')
  const [activeTool, setActiveTool] = useState(null)
  const [toolResult, setToolResult] = useState(null)
  const [editingCell, setEditingCell] = useState(null)
  const [editingCellVal, setEditingCellVal] = useState('')
  const [highlightEmpty, setHighlightEmpty] = useState(false)
  const [duplicateMap, setDuplicateMap] = useState({})
  const [trimOptions, setTrimOptions] = useState({ spaces: true, casing: 'none' })
  const [files, setFiles] = useState([])
  const [expandedFile, setExpandedFile] = useState(null)
  const [showHidden, setShowHidden] = useState(false)
  
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

  // Debounced color picker — store draft locally, commit on pointer up
  const [colorDraft, setColorDraft] = useState(null)

  const isPanning = useRef(false)
  const canvasScrollRef = useRef(null)
  const dragData = useRef(null)
  const lastInsert = useRef(null)
  const fileInputRef = useRef(null)
  const editInputRef = useRef(null)

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
  const allSelected = formatSelectedCols.length === canvasColumns.length && canvasColumns.length > 0
  function toggleFormatColSelect(canvasId) {
    setFormatSelectedCols(prev => prev.includes(canvasId) ? prev.filter(id => id !== canvasId) : [...prev, canvasId])
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
      setExpandedFile(newFile.id)
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
    dragData.current = { type: 'sidebar', cols: colsToAdd }
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

  useEffect(() => {
    const el = canvasScrollRef.current
    if (!el) return
    const handler = (e) => {
      if (e.ctrlKey) { e.preventDefault(); setCanvasZoom(prev => Math.min(2, Math.max(0.4, Math.round((prev + (e.deltaY > 0 ? -0.1 : 0.1)) * 10) / 10))); return }
      if (e.shiftKey) { e.preventDefault(); el.scrollLeft += e.deltaY * 0.8; return }
      el.scrollLeft += e.deltaX; el.scrollTop += e.deltaY * 0.8; e.preventDefault()
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [canvasScrollRef.current])

  // ── Tool functions ───────────────────────────────────────────
  function runTrim() {
    const { spaces, casing } = trimOptions
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
    const stats = canvasColumns.map(col => {
      const vals = col.rows.filter(v => v !== undefined && v !== null && v !== '')
      const nums = vals.map(v => parseFloat(v)).filter(n => !isNaN(n))
      const unique = new Set(vals.map(v => String(v).trim().toLowerCase())).size
      return { label: col.label, total: col.rows.length, filled: vals.length, empty: col.rows.length - vals.length, unique, min: nums.length ? Math.min(...nums) : '—', max: nums.length ? Math.max(...nums) : '—', sum: nums.length ? nums.reduce((a, b) => a + b, 0) : '—' }
    })
    setToolResult({ type: 'stats', data: stats }); setActiveTool(null)
  }

  // ── Cell editing ─────────────────────────────────────────────
  function startCellEdit(canvasId, rowIndex, currentVal) { setEditingCell({ canvasId, rowIndex }); setEditingCellVal(currentVal === undefined || currentVal === null ? '' : String(currentVal)) }
  function commitCellEdit() {
    if (!editingCell) return
    const { canvasId, rowIndex } = editingCell
    setCanvasColumns(prev => prev.map(col => { if (col.canvasId !== canvasId) return col; const newRows = [...col.rows]; newRows[rowIndex] = editingCellVal; return { ...col, rows: newRows } }))
    setEditingCell(null)
  }
  function handleCellKeyDown(e) {
    if (e.key === 'Enter') { commitCellEdit(); e.preventDefault() }
    if (e.key === 'Escape') setEditingCell(null)
    if (e.key === 'Tab') commitCellEdit()
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
  function addBlankColumn() {
    const newCol = { canvasId: `canvas_${Date.now()}_new`, colId: `new_${Date.now()}`, label: 'New Column', fileName: 'manual', sheetName: '', rows: Array(maxRows).fill('') }
    setCanvasColumns(prev => [...prev, newCol])
    setTimeout(() => { setEditingColId(newCol.canvasId); setEditingLabel('New Column') }, 50)
  }

  // ── Helpers ──────────────────────────────────────────────────
  const allHiddenCols = files.flatMap(f => f.sheets.flatMap(s => s.headers.filter(h => h.hidden).map(h => ({ fileId: f.id, fileName: f.name, sheetName: s.name, col: h }))))
  const visibleHeaders = (sheet) => sheet.headers.filter(h => !h.hidden)
  const maxRows = canvasColumns.length > 0 ? Math.max(...canvasColumns.map(c => c.rows.length)) : 0
  const sortedCanvasCols = [...canvasColumns.filter(c => pinnedColIds.includes(c.canvasId)), ...canvasColumns.filter(c => !pinnedColIds.includes(c.canvasId))]

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
  function FmtBtn({ active, onClick, title, children }) {
    return (
      <button onClick={onClick} title={title} style={{ padding: '3px 9px', borderRadius: 5, border: `1px solid ${active ? accent : border}`, background: active ? accentDim : 'transparent', color: active ? accent : text2, fontFamily: "'DM Sans',sans-serif", fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
        {children}
      </button>
    )
  }

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
       onMouseDown={e => { if (contextMenu) setContextMenu(null); if (colContextMenu) setColContextMenu(null); if (editingCell && !e.target.closest('td input')) commitCellEdit() }}
        onDragOver={e => { if (dragData.current) e.preventDefault() }}
        onDrop={e => { e.preventDefault(); if (!dragData.current) return; if (dragData.current.type === 'sidebar') addColumnsToCanvas(dragData.current.cols, null); setInsertAt(null); lastInsert.current = null }}
      >

        {/* ── Sidebar ── */}
        <div style={{ width: 220, background: surface, borderRight: `1px solid ${border}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '12px 12px 8px' }}>
            <button className="import-btn" onClick={handleImportClick} style={{ width: '100%', padding: '9px 0', background: accent, color: '#fff', border: 'none', borderRadius: 7, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <span style={{ fontSize: 15 }}>+</span> Import File
            </button>
          </div>
          <div style={{ padding: '2px 14px 4px', fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: text3 }}>Files</div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px' }}>
            {files.length === 0 ? (
              <div style={{ margin: '20px 6px', padding: '16px 12px', borderRadius: 8, border: `1px dashed ${border}`, textAlign: 'center', color: text3, fontSize: 12, lineHeight: 1.7 }}>
                No files yet.<br /><span style={{ color: text2 }}>Supports .xlsx .xls .csv</span>
              </div>
            ) : files.map(file => (
              <div key={file.id} style={{ marginBottom: 6 }}>
                <div className="file-row" onClick={() => setExpandedFile(expandedFile === file.id ? null : file.id)} style={{ padding: '6px 8px', borderRadius: 6, fontSize: 12, color: text, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                  <span style={{ fontSize: 13 }}>📄</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                  <span style={{ color: text3, fontSize: 10 }}>{expandedFile === file.id ? '▾' : '▸'}</span>
                </div>
                {expandedFile === file.id && file.sheets[0] && (
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
                          style={{ padding: '4px 8px 4px 24px', borderRadius: 5, display: 'flex', alignItems: 'center', gap: 5, opacity: onCanvas ? 0.4 : 1, background: isSelected ? accentDim : 'transparent', border: isSelected ? `1px solid ${accent}44` : '1px solid transparent' }}
                        >
                          <div style={{ width: 6, height: 6, borderRadius: 2, background: onCanvas ? text3 : accent, flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: 11, color: isSelected ? accent : onCanvas ? text3 : text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.label}</span>
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
            ))}
          </div>
          {allHiddenCols.length > 0 && (
            <div style={{ borderTop: `1px solid ${border}`, padding: '8px 10px' }}>
              <button onClick={() => setShowHidden(!showHidden)} style={{ background: 'none', border: 'none', cursor: 'pointer', width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: text3 }}>
                <span style={{ fontSize: 10 }}>{showHidden ? '▾' : '▸'}</span> Hidden ({allHiddenCols.length})
              </button>
              {showHidden && allHiddenCols.map(({ fileId, sheetName, col }) => (
                <div key={col.id} style={{ padding: '4px 4px 4px 16px', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 6, height: 6, borderRadius: 2, background: border, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 11, color: text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'line-through' }}>{col.label}</span>
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
                <div style={{ background: dark ? '#15152a' : '#f4f0ff', borderBottom: `1px solid ${accent}44`, padding: '8px 14px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Row 1: title + column chips */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: accent, display: 'flex', alignItems: 'center', gap: 6, marginRight: 4 }}>◈ Format</span>
                    <span style={{ fontSize: 11, color: text3 }}>Apply to:</span>
                    {/* All chip */}
                    <button className="fmt-chip" onClick={() => setFormatSelectedCols(allSelected ? [] : canvasColumns.map(c => c.canvasId))}
                      style={{ padding: '2px 12px', borderRadius: 20, border: `1px solid ${allSelected ? accent : border}`, background: allSelected ? accentDim : 'transparent', color: allSelected ? accent : text2, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: allSelected ? 700 : 400, transition: 'all 0.12s' }}>
                      All
                    </button>
                    {canvasColumns.map(col => {
                      const sel = formatSelectedCols.includes(col.canvasId)
                      const hasFmt = !!colFormats[col.canvasId]
                      return (
                        <button key={col.canvasId} className="fmt-chip" onClick={() => toggleFormatColSelect(col.canvasId)}
                          style={{ padding: '2px 12px', borderRadius: 20, border: `1px solid ${sel ? accent : hasFmt ? accent + '55' : border}`, background: sel ? accentDim : 'transparent', color: sel ? accent : text2, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", transition: 'all 0.12s', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {col.label}{hasFmt && !sel && <span style={{ width: 5, height: 5, borderRadius: '50%', background: accent, display: 'inline-block' }} />}
                        </button>
                      )
                    })}
                    <button onClick={() => { setColFormats({}); setGlobalFormat(defaultGlobalFormat()) }} style={{ marginLeft: 4, background: 'none', border: `1px solid ${border}`, borderRadius: 5, padding: '2px 9px', fontSize: 11, color: text3, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>↺ Reset all</button>
                    <button onClick={() => setActiveTool(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 16 }}>✕</button>
                  </div>

                  {/* Row 2: controls */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>

                    {/* Font size */}
                    <span style={{ fontSize: 11, color: text3 }}>Size</span>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <button onClick={() => updateColFormat(formatSelectedCols, { fontSize: Math.max(8, ((getFormatValue('fontSize') === '—' ? 12 : getFormatValue('fontSize')) - 1)) })}
                        style={{ padding: '3px 8px', background: raised, border: `1px solid ${border}`, borderRadius: '5px 0 0 5px', color: text2, cursor: 'pointer', fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}>−</button>
                      <div style={{ padding: '3px 10px', background: raised, border: `1px solid ${border}`, borderLeft: 'none', borderRight: 'none', fontSize: 12, color: text, minWidth: 30, textAlign: 'center', fontFamily: "'DM Mono',monospace" }}>
                        {getFormatValue('fontSize') === '—' ? '—' : getFormatValue('fontSize')}
                      </div>
                      <button onClick={() => updateColFormat(formatSelectedCols, { fontSize: Math.min(24, ((getFormatValue('fontSize') === '—' ? 12 : getFormatValue('fontSize')) + 1)) })}
                        style={{ padding: '3px 8px', background: raised, border: `1px solid ${border}`, borderRadius: '0 5px 5px 0', borderLeft: 'none', color: text2, cursor: 'pointer', fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}>+</button>
                    </div>

                    <div style={{ width: 1, height: 18, background: border, margin: '0 3px' }} />

                    {/* Alignment */}
                    <span style={{ fontSize: 11, color: text3 }}>Align</span>
                    {[['left','L'],['center','C'],['right','R']].map(([val, lbl]) => (
                      <FmtBtn key={val} active={getFormatValue('align') === val} onClick={() => updateColFormat(formatSelectedCols, { align: val })}>{lbl}</FmtBtn>
                    ))}

                    <div style={{ width: 1, height: 18, background: border, margin: '0 3px' }} />

                    {/* Text options */}
                    <FmtBtn active={getFormatValue('bold') === true} onClick={() => updateColFormat(formatSelectedCols, { bold: getFormatValue('bold') !== true })} title="Bold cells"><b style={{ fontSize: 13 }}>B</b></FmtBtn>
                    <FmtBtn active={getFormatValue('wrap') === true} onClick={() => updateColFormat(formatSelectedCols, { wrap: getFormatValue('wrap') !== true })} title="Wrap text">↵ Wrap</FmtBtn>

                    <div style={{ width: 1, height: 18, background: border, margin: '0 3px' }} />

                    {/* Global toggles */}
                    <FmtBtn active={globalFormat.boldHeader} onClick={() => updateGlobalFormat({ boldHeader: !globalFormat.boldHeader })} title="Make header row bold">Bold header</FmtBtn>
                    <FmtBtn active={globalFormat.banding} onClick={() => updateGlobalFormat({ banding: !globalFormat.banding })} title="Alternate row shading (every 2nd row)">▤ Banding</FmtBtn>
                    <FmtBtn active={globalFormat.exportAsTable} onClick={() => updateGlobalFormat({ exportAsTable: !globalFormat.exportAsTable })} title="Export with Excel auto-filter / table structure">⊞ As Table</FmtBtn>
                    <FmtBtn active={globalFormat.freezeHeader} onClick={() => updateGlobalFormat({ freezeHeader: !globalFormat.freezeHeader })} title="In Excel: header row stays visible when scrolling">❄ Freeze header (XLSX)</FmtBtn>

                    <div style={{ width: 1, height: 18, background: border, margin: '0 3px' }} />

                    {/* Border — export only */}
                    <span style={{ fontSize: 11, color: text3 }}>Cell borders (XLSX)</span>
                    {[['none','None'],['thin','Thin'],['medium','Medium']].map(([val, lbl]) => (
                      <FmtBtn key={val} active={globalFormat.borderStyle === val} onClick={() => updateGlobalFormat({ borderStyle: val })}>{lbl}</FmtBtn>
                    ))}

                    <div style={{ width: 1, height: 18, background: border, margin: '0 3px' }} />

                    {/* Header row color */}
                    <span style={{ fontSize: 11, color: text3 }}>Header row color</span>
                    {['#5B5FE8','#1D9E75','#E8B85B','#f87171','#6b7280','#0f172a'].map(c => (
                      <button key={c} onClick={() => updateGlobalFormat({ headerColor: c })}
                        style={{ width: 18, height: 18, borderRadius: 4, background: c, border: globalFormat.headerColor === c ? `2px solid ${text}` : `1px solid transparent`, cursor: 'pointer', padding: 0, flexShrink: 0, transition: 'border 0.1s' }} />
                    ))}
                    {/* Debounced custom color — only commits on pointer up to avoid lag */}
                    <input
                      type="color"
                      value={colorDraft !== null ? colorDraft : globalFormat.headerColor}
                      onChange={e => setColorDraft(e.target.value)}
                      onPointerUp={e => { if (colorDraft !== null) { updateGlobalFormat({ headerColor: colorDraft }); setColorDraft(null) } }}
                      style={{ width: 22, height: 22, border: `1px solid ${border}`, borderRadius: 4, cursor: 'pointer', padding: 1, background: 'none' }}
                      title="Custom header color — drag to pick, release to apply"
                    />
                  </div>
                </div>
              ) : (
                <div style={{ background: surface, borderBottom: `1px solid ${border}`, padding: '6px 12px', display: 'flex', gap: 3, flexWrap: 'wrap', flexShrink: 0 }}>
                  {tools.map(tool => (
                    <button key={tool.id}
                      className={`tool-btn${activeTool === tool.id ? ' active' : ''}`}
                      onClick={() => setActiveTool(activeTool === tool.id ? null : tool.id)}
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
                <div style={{ background: accentDim, borderBottom: `1px solid ${accent}44`, padding: '10px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span style={{ fontWeight: 600, color: accent }}>Trim & Clean</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: text2, cursor: 'pointer' }}><input type="checkbox" checked={trimOptions.spaces} onChange={e => setTrimOptions(p => ({ ...p, spaces: e.target.checked }))} /> Strip extra spaces</label>
                  <label style={{ fontSize: 12, color: text2, display: 'flex', alignItems: 'center', gap: 5 }}>Casing:
                    <select value={trimOptions.casing} onChange={e => setTrimOptions(p => ({ ...p, casing: e.target.value }))} style={{ background: raised, border: `1px solid ${border}`, borderRadius: 4, padding: '2px 6px', color: text, fontFamily: "'DM Sans',sans-serif", fontSize: 12, cursor: 'pointer' }}>
                      <option value="none">Keep as-is</option><option value="lower">lowercase</option><option value="upper">UPPERCASE</option><option value="title">Title Case</option>
                    </select>
                  </label>
                  <button onClick={runTrim} style={{ background: accent, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Run</button>
                  <button onClick={() => setActiveTool(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 15 }}>✕</button>
                </div>
              )}
              {activeTool === 'empty' && (
                <div style={{ background: accentDim, borderBottom: `1px solid ${accent}44`, padding: '10px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span style={{ fontWeight: 600, color: accent }}>Highlight Empty</span>
                  <span style={{ fontSize: 12, color: text2 }}>Empty cells will be highlighted in red. Click any red cell to fill it in.</span>
                  <button onClick={runHighlightEmpty} style={{ background: accent, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{highlightEmpty ? 'Turn Off' : 'Turn On'}</button>
                  <button onClick={() => setActiveTool(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 15 }}>✕</button>
                </div>
              )}
              {activeTool === 'duplicates' && (
                <div style={{ background: accentDim, borderBottom: `1px solid ${accent}44`, padding: '10px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span style={{ fontWeight: 600, color: accent }}>Duplicates</span>
                  <span style={{ fontSize: 12, color: text2 }}>Scans all canvas columns and highlights duplicate values in amber.</span>
                  <button onClick={runDuplicates} style={{ background: accent, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Run</button>
                  <button onClick={() => { setDuplicateMap({}); setActiveTool(null) }} style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 6, padding: '5px 10px', fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: text2, cursor: 'pointer' }}>Clear</button>
                  <button onClick={() => setActiveTool(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 15 }}>✕</button>
                </div>
              )}
              {activeTool === 'stats' && (
                <div style={{ background: accentDim, borderBottom: `1px solid ${accent}44`, padding: '10px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span style={{ fontWeight: 600, color: accent }}>Col Stats</span>
                  <span style={{ fontSize: 12, color: text2 }}>Shows count, unique, empty, min, max for each column.</span>
                  <button onClick={runStats} style={{ background: accent, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Run</button>
                  <button onClick={() => setActiveTool(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 15 }}>✕</button>
                </div>
              )}
              {activeTool && !['trim','empty','duplicates','stats','format'].includes(activeTool) && (
                <div style={{ background: accentDim, borderBottom: `1px solid ${accent}44`, padding: '9px 16px', fontSize: 13, color: accent, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <span style={{ fontWeight: 600 }}>{tools.find(t => t.id === activeTool)?.label}</span>
                  <span style={{ color: text2, fontWeight: 400 }}>— {tools.find(t => t.id === activeTool)?.desc}</span>
                  <button onClick={() => setActiveTool(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 15 }}>✕</button>
                </div>
              )}

              {/* Canvas scroll area */}
              <div ref={canvasScrollRef} onDragOver={handleCanvasZoneDragOver} onDrop={handleCanvasZoneDrop} onDragLeave={handleCanvasDragLeave} onMouseDown={handleCanvasMouseDown} onContextMenu={e => { e.preventDefault() }}
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
                    <div style={{ zoom: canvasZoom }}>
                      <table style={{ borderCollapse: 'collapse', fontSize: 12, fontFamily: "'DM Mono',monospace" }}>
                        <thead>
                          <tr style={{ background: globalFormat.boldHeader ? globalFormat.headerColor + '22' : surface }}>
                            <th style={{ width: 42, padding: '8px 10px', borderBottom: `1px solid ${border}`, borderRight: `1px solid ${border}`, color: text3, fontSize: 10, textAlign: 'center', fontWeight: 500, background: globalFormat.boldHeader ? globalFormat.headerColor + '22' : surface, position: 'sticky', top: 0, zIndex: 5 }}>#</th>
                            {sortedCanvasCols.map((col, idx) => {
                              const isPinned = pinnedColIds.includes(col.canvasId)
                              const isDraggingThis = draggingCanvasId === col.canvasId
                              const isInsertBefore = insertAt?.index === idx && insertAt?.side === 'left'
                              const isInsertAfter  = insertAt?.index === idx && insertAt?.side === 'right'
                              const fmt = getColFormat(col.canvasId)
                              return (
                                <th key={col.canvasId} className="canvas-th" draggable
                                  onDragStart={e => handleCanvasDragStart(e, col.canvasId)}
                                  onDragEnd={handleCanvasDragEnd}
                                  onDragOver={e => handleThDragOver(e, idx)}
                                  onDrop={e => handleThDrop(e, idx)}
                                  onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setColContextMenu({ x: e.clientX, y: e.clientY, canvasId: col.canvasId, label: col.label }) }}
                                  style={{ padding: '8px 12px', borderBottom: `1px solid ${border}`, borderRight: `1px solid ${border}`, textAlign: fmt.align || 'left', whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif", fontSize: fmt.fontSize || 12, fontWeight: globalFormat.boldHeader ? 700 : 600, background: isPinned ? (dark ? '#1a1f4a' : '#e8f5ee') : globalFormat.boldHeader ? globalFormat.headerColor + '22' : surface, color: globalFormat.boldHeader ? globalFormat.headerColor : text, opacity: isDraggingThis ? 0.3 : 1, position: 'sticky', top: 0, zIndex: 4, overflow: 'visible' }}
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
                                </th>
                              )
                            })}
                            <th onClick={addBlankColumn} style={{ padding: '8px 14px', borderBottom: `1px solid ${border}`, borderRight: `1px solid ${border}`, background: surface, position: 'sticky', top: 0, zIndex: 4, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: text3 }}
                              onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = accent }}
                              onMouseLeave={e => { e.currentTarget.style.background = surface; e.currentTarget.style.color = text3 }}>+ col</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from({ length: maxRows }).map((_, ri) => {
                            if (hiddenRows.has(ri)) return null
                            const isBandedRow = globalFormat.banding && ri % 2 === 0
                            return (
                              <tr key={ri}>
                                <td onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, rowIndex: ri }) }}
                                  style={{ padding: '5px 10px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, color: text3, textAlign: 'center', fontSize: 10, cursor: 'context-menu', userSelect: 'none' }}
                                  onMouseEnter={e => { e.currentTarget.style.background = raised }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>{ri + 1}</td>
                                {sortedCanvasCols.map((col, idx) => {
                                  const val = col.rows[ri]
                                  const isEmpty = val === undefined || val === null || val === ''
                                  const isPinned = pinnedColIds.includes(col.canvasId)
                                  const isEditing = editingCell?.canvasId === col.canvasId && editingCell?.rowIndex === ri
                                  const isDup = duplicateMap[col.canvasId]?.has(String(val ?? '').trim().toLowerCase())
                                  const isEmptyHighlight = highlightEmpty && isEmpty
                                  const fmt = getColFormat(col.canvasId)
                                  let bg = ri % 2 === 1 ? `${surface}55` : 'transparent'
                                  if (isPinned) bg = dark ? '#1a1f4a33' : '#e8f5ee88'
                                  if (isBandedRow) bg = dark ? globalFormat.headerColor + '22' : globalFormat.headerColor + '11'
                                  if (isDup) bg = dark ? '#2a1f0d' : '#fef3c7'
                                  if (isEmptyHighlight) bg = dark ? '#2a0d0d' : '#fee2e2'
                                  return (
                                    <td key={col.canvasId}
                                      onDragOver={e => handleThDragOver(e, idx)}
                                      onDrop={e => handleThDrop(e, idx)}
                                      onClick={() => !isEditing && startCellEdit(col.canvasId, ri, val)}
                                      style={{ padding: isEditing ? '0' : '5px 14px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, color: isEmptyHighlight ? '#f87171' : isDup ? '#E8B85B' : isEmpty ? text3 : text2, whiteSpace: fmt.wrap ? 'normal' : 'nowrap', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', background: bg, cursor: isEditing ? 'text' : 'default', fontSize: fmt.fontSize || 12, fontWeight: fmt.bold ? 700 : 400, textAlign: fmt.align || 'left' }}
                                    >
                                      {isEditing ? (
                                        <input autoFocus value={editingCellVal} onChange={e => setEditingCellVal(e.target.value)} onBlur={commitCellEdit} onKeyDown={handleCellKeyDown} style={{ width: '100%', padding: '5px 14px', border: 'none', borderBottom: `2px solid ${accent}`, background: raised, color: text, fontFamily: "'DM Mono',monospace", fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
                                      ) : isEmptyHighlight ? (
                                        <span style={{ fontSize: 11, color: '#f87171', fontStyle: 'italic' }}>empty — click to fill</span>
                                      ) : isEmpty ? (
                                        <span style={{ fontSize: 10 }}>—</span>
                                      ) : String(val)}
                                    </td>
                                  )
                                })}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {/* Stats panel */}
              {toolResult?.type === 'stats' && (
                <div style={{ borderTop: `1px solid ${border}`, background: surface, overflowX: 'auto', flexShrink: 0, maxHeight: 180 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: "'DM Mono',monospace" }}>
                    <thead><tr style={{ background: raised }}>{['Column','Total','Filled','Empty','Unique','Min','Max','Sum'].map(h => (<th key={h} style={{ padding: '6px 12px', borderBottom: `1px solid ${border}`, borderRight: `1px solid ${border}`, textAlign: 'left', color: text2, fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>))}</tr></thead>
                    <tbody>
                      {toolResult.data.map((s, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : `${raised}55` }}>
                          <td style={{ padding: '5px 12px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, color: text, fontWeight: 600, fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' }}>{s.label}</td>
                          <td style={{ padding: '5px 12px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, color: text2 }}>{s.total}</td>
                          <td style={{ padding: '5px 12px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, color: '#4ade80' }}>{s.filled}</td>
                          <td style={{ padding: '5px 12px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, color: s.empty > 0 ? '#f87171' : text3 }}>{s.empty}</td>
                          <td style={{ padding: '5px 12px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, color: text2 }}>{s.unique}</td>
                          <td style={{ padding: '5px 12px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, color: text2 }}>{typeof s.min === 'number' ? s.min.toLocaleString() : s.min}</td>
                          <td style={{ padding: '5px 12px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, color: text2 }}>{typeof s.max === 'number' ? s.max.toLocaleString() : s.max}</td>
                          <td style={{ padding: '5px 12px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, color: text2 }}>{typeof s.sum === 'number' ? s.sum.toLocaleString() : s.sum}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

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
        </div>
      </div>
    </>
  )
}