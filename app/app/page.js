'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import { useTheme } from '../providers'
import * as XLSX from 'xlsx'

export default function AppPage() {
  const { dark, setDark } = useTheme()
  const [mode, setMode] = useState('preview')
  const [activeTool, setActiveTool] = useState(null)
  const [toolResult, setToolResult] = useState(null) // { type, data }
  const [editingCell, setEditingCell] = useState(null) // { canvasId, rowIndex }
  const [editingCellVal, setEditingCellVal] = useState('')
  const [highlightEmpty, setHighlightEmpty] = useState(false)
  const [duplicateMap, setDuplicateMap] = useState({}) // colId -> Set of duplicate values
  const [trimOptions, setTrimOptions] = useState({ spaces: true, casing: 'none' })
  const [files, setFiles] = useState([])
  const [expandedFile, setExpandedFile] = useState(null)
  const [showHidden, setShowHidden] = useState(false)
  const [canvasColumns, setCanvasColumns] = useState([])
  const [insertAt, setInsertAt] = useState(null) // { index, side: 'left'|'right' }
  const [draggingCanvasId, setDraggingCanvasId] = useState(null)
  const draggingCanvasIdRef = useRef(null)
  const [editingColId, setEditingColId] = useState(null)
  const [editingLabel, setEditingLabel] = useState('')
  const [selectedSidebarCols, setSelectedSidebarCols] = useState([])
  const [pinnedColIds, setPinnedColIds] = useState([])
  const [activeSheet, setActiveSheet] = useState('canvas') // 'canvas' or file sheet key
  const [contextMenu, setContextMenu] = useState(null) // { x, y, rowIndex }
  const [canvasZoom, setCanvasZoom] = useState(1)
  const [copiedRow, setCopiedRow] = useState(null) // array of values per column
  const [hiddenRows, setHiddenRows] = useState(new Set()) // set of row indices
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 })
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
  ]

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
        const headers = (json[0] || []).map((h, i) => ({
          id: `col_${Date.now()}_${i}`,
          label: h || `Column ${i + 1}`,
          index: i,
          hidden: false,
        }))
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
    setFiles(prev => prev.map(f => f.id !== fileId ? f : {
      ...f, sheets: f.sheets.map(s => s.name !== sheetName ? s : {
        ...s, headers: s.headers.map(h => h.id === colId ? { ...h, hidden: true } : h)
      })
    }))
  }
  function deleteColumn(fileId, sheetName, colId) {
    setFiles(prev => prev.map(f => f.id !== fileId ? f : {
      ...f, sheets: f.sheets.map(s => s.name !== sheetName ? s : {
        ...s, headers: s.headers.filter(h => h.id !== colId)
      })
    }))
    setCanvasColumns(prev => prev.filter(c => c.colId !== colId))
  }
  function restoreColumn(fileId, sheetName, colId) {
    setFiles(prev => prev.map(f => f.id !== fileId ? f : {
      ...f, sheets: f.sheets.map(s => s.name !== sheetName ? s : {
        ...s, headers: s.headers.map(h => h.id === colId ? { ...h, hidden: false } : h)
      })
    }))
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
        return {
          canvasId: `canvas_${Date.now()}_${Math.random()}`,
          colId: col.id,
          label: col.label,
          fileName,
          sheetName,
          rows: sheet?.rows.map(row => row[col.index]) || [],
        }
      })
    if (!newCols.length) return
    setCanvasColumns(prev => {
      if (atIndex === null) return [...prev, ...newCols]
      const next = [...prev]
      next.splice(atIndex, 0, ...newCols)
      return next
    })
    setMode('canvas')
    setSelectedSidebarCols([])
  }

  // ── Drag image helper ────────────────────────────────────────
  function setNativeDragImage(e, label) {
    const el = document.createElement('div')
    el.textContent = label
    el.style.cssText = `position:fixed;top:-999px;left:-999px;padding:5px 12px;background:${accent};color:#fff;border-radius:6px;font:600 12px 'DM Sans',sans-serif;white-space:nowrap;`
    document.body.appendChild(el)
    e.dataTransfer.setDragImage(el, 0, 0)
    setTimeout(() => document.body.removeChild(el), 0)
  }

  // ── Drag from sidebar ────────────────────────────────────────
  function handleSidebarDragStart(e, fileId, fileName, sheetName, col) {
    const colsToAdd = selectedSidebarCols.length > 1 && selectedSidebarCols.includes(col.id)
      ? selectedSidebarCols.map(id => {
          const f = files.find(f => f.id === fileId)
          const c = f?.sheets[0]?.headers.find(h => h.id === id)
          return c ? { fileId, fileName, sheetName, col: c } : null
        }).filter(Boolean)
      : [{ fileId, fileName, sheetName, col }]
    dragData.current = { type: 'sidebar', cols: colsToAdd }
    setNativeDragImage(e, colsToAdd.length > 1 ? `${colsToAdd.length} columns` : col.label)
    e.dataTransfer.effectAllowed = 'copy'
  }

  // ── Drag canvas col (reorder) ────────────────────────────────
  function handleCanvasDragStart(e, canvasId) {
    dragData.current = { type: 'canvas', canvasId }
    draggingCanvasIdRef.current = canvasId
    setDraggingCanvasId(canvasId)
    const col = canvasColumns.find(c => c.canvasId === canvasId)
    setNativeDragImage(e, col?.label || '')
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleCanvasDragEnd() {
    draggingCanvasIdRef.current = null
    setDraggingCanvasId(null)
    setInsertAt(null)
    lastInsert.current = null
    dragData.current = null
  }

  // ── Throttled drag over header ───────────────────────────────
  // Only update state when position actually changes — prevents re-render spam
  const handleThDragOver = useCallback((e, index) => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    // Use 35% threshold — makes left edge easier to hit, especially at index 0
    const side = e.clientX < rect.left + rect.width * 0.35 ? 'left' : 'right'
    const key = `${index}-${side}`
    if (lastInsert.current === key) return
    lastInsert.current = key
    setInsertAt({ index, side })
  }, [])

  function handleThDrop(e, index) {
    e.preventDefault()
    e.stopPropagation()
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
        const next = [...prev]
        const [moved] = next.splice(fromIdx, 1)
        const insertIdx = fromIdx < dropIndex ? dropIndex - 1 : dropIndex
        next.splice(insertIdx, 0, moved)
        return next
      })
    }
    setInsertAt(null)
    setDraggingCanvasId(null)
    lastInsert.current = null
    dragData.current = null
  }

  function handleCanvasZoneDragOver(e) {
    e.preventDefault()
  }

  function handleCanvasZoneDrop(e) {
    e.preventDefault()
    // dragData is cleared by handleThDrop if drop landed on a column — skip
    if (!dragData.current) return
    if (dragData.current.type === 'sidebar') {
      addColumnsToCanvas(dragData.current.cols, null)
    }
    dragData.current = null
    setInsertAt(null)
    lastInsert.current = null
  }

  function handleCanvasDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setInsertAt(null)
      lastInsert.current = null
    }
  }

  // ── Rename ───────────────────────────────────────────────────
  function startEdit(canvasId, label) {
    setEditingColId(canvasId)
    setEditingLabel(label)
    setTimeout(() => editInputRef.current?.select(), 30)
  }

  function commitEdit(canvasId) {
    if (editingLabel.trim()) {
      setCanvasColumns(prev => prev.map(c => c.canvasId === canvasId ? { ...c, label: editingLabel.trim() } : c))
    }
    setEditingColId(null)
  }

  // ── Pin ──────────────────────────────────────────────────────
  function togglePin(canvasId) {
    setPinnedColIds(prev => prev.includes(canvasId) ? prev.filter(id => id !== canvasId) : [...prev, canvasId])
  }

  function removeCanvasColumn(canvasId) {
    setCanvasColumns(prev => prev.filter(c => c.canvasId !== canvasId))
    setPinnedColIds(prev => prev.filter(id => id !== canvasId))
  }

  // ── Pan navigation ───────────────────────────────────────────
  function handleCanvasMouseDown(e) {
    if (e.button !== 2) return
    if (e.target.closest('button,input')) return
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const startLeft = canvasScrollRef.current?.scrollLeft || 0
    const startTop  = canvasScrollRef.current?.scrollTop  || 0

    function onMove(ev) {
      if (!canvasScrollRef.current) return
      canvasScrollRef.current.scrollLeft = startLeft - (ev.clientX - startX)
      canvasScrollRef.current.scrollTop  = startTop  - (ev.clientY - startY)
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (canvasScrollRef.current) canvasScrollRef.current.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    canvasScrollRef.current.style.cursor = 'grabbing'
  }

  function handleCanvasMouseUp(e) {
    isPanning.current = false
    if (canvasScrollRef.current) e.currentTarget.style.cursor = ''
  }

  function closeContextMenu() { setContextMenu(null) }

  // ── Non-passive wheel listener — intercepts Ctrl+scroll before browser zoom ──
  useEffect(() => {
    const el = canvasScrollRef.current
    if (!el) return
    const handler = (e) => {
      if (e.ctrlKey) {
        e.preventDefault()
        setCanvasZoom(prev => {
          const delta = e.deltaY > 0 ? -0.1 : 0.1
          return Math.min(2, Math.max(0.4, Math.round((prev + delta) * 10) / 10))
        })
        return
      }
      if (e.shiftKey) {
        e.preventDefault()
        el.scrollLeft += e.deltaY * 0.8
        return
      }
      el.scrollLeft += e.deltaX
      el.scrollTop  += e.deltaY * 0.8
      e.preventDefault()
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [canvasScrollRef.current])

  function handleCanvasWheel(e) {
    if (!canvasScrollRef.current) return
    e.preventDefault()
    if (e.ctrlKey) {
      // Ctrl+wheel = zoom
      setCanvasZoom(prev => {
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        return Math.min(2, Math.max(0.5, Math.round((prev + delta) * 10) / 10))
      })
      return
    }
    if (e.shiftKey) {
      canvasScrollRef.current.scrollLeft += e.deltaY * 0.8
    } else {
      canvasScrollRef.current.scrollLeft += e.deltaX
      canvasScrollRef.current.scrollTop  += e.deltaY * 0.8
    }
  }

  // ── Tool functions ──────────────────────────────────────────

  function runTrim() {
    const { spaces, casing } = trimOptions
    setCanvasColumns(prev => prev.map(col => ({
      ...col,
      rows: col.rows.map(val => {
        if (val === undefined || val === null) return val
        let s = String(val)
        if (spaces) s = s.trim().replace(/\s+/g, ' ')
        if (casing === 'lower') s = s.toLowerCase()
        if (casing === 'upper') s = s.toUpperCase()
        if (casing === 'title') s = s.replace(/\b\w/g, c => c.toUpperCase())
        return s
      })
    })))
    setToolResult({ type: 'trim', message: 'Trim & Clean applied to all columns.' })
    setActiveTool(null)
  }

  function runHighlightEmpty() {
    setHighlightEmpty(h => !h)
    setActiveTool(null)
  }

  function runDuplicates() {
    const map = {}
    canvasColumns.forEach(col => {
      const counts = {}
      col.rows.forEach(val => {
        if (val === undefined || val === null || val === '') return
        const k = String(val).trim().toLowerCase()
        counts[k] = (counts[k] || 0) + 1
      })
      map[col.canvasId] = new Set(Object.keys(counts).filter(k => counts[k] > 1))
    })
    setDuplicateMap(map)
    const total = Object.values(map).reduce((sum, s) => sum + s.size, 0)
    setToolResult({ type: 'duplicates', message: `Found ${total} duplicate value${total !== 1 ? 's' : ''} across ${canvasColumns.length} column${canvasColumns.length !== 1 ? 's' : ''}.` })
    setActiveTool(null)
  }

  function runStats() {
    const stats = canvasColumns.map(col => {
      const vals = col.rows.filter(v => v !== undefined && v !== null && v !== '')
      const nums = vals.map(v => parseFloat(v)).filter(n => !isNaN(n))
      const unique = new Set(vals.map(v => String(v).trim().toLowerCase())).size
      return {
        label: col.label,
        total: col.rows.length,
        filled: vals.length,
        empty: col.rows.length - vals.length,
        unique,
        min: nums.length ? Math.min(...nums) : '—',
        max: nums.length ? Math.max(...nums) : '—',
        sum: nums.length ? nums.reduce((a, b) => a + b, 0) : '—',
      }
    })
    setToolResult({ type: 'stats', data: stats })
    setActiveTool(null)
  }

  // ── Cell editing ─────────────────────────────────────────────
  function startCellEdit(canvasId, rowIndex, currentVal) {
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

  function handleCellKeyDown(e) {
    if (e.key === 'Enter') { commitCellEdit(); e.preventDefault() }
    if (e.key === 'Escape') { setEditingCell(null) }
    if (e.key === 'Tab') { commitCellEdit() }
  }

  function deleteRow(rowIndex) {
    setCanvasColumns(prev => prev.map(col => {
      const newRows = [...col.rows]
      newRows.splice(rowIndex, 1)
      return { ...col, rows: newRows }
    }))
    setEditingCell(null)
  }

  function copyRow(rowIndex) {
    // Store value per canvasId so paste works even after reorder
    const snapshot = {}
    canvasColumns.forEach(col => { snapshot[col.canvasId] = col.rows[rowIndex] })
    setCopiedRow(snapshot)
  }

  function pasteRow(atIndex, position) {
    // position: 'above' | 'below'
    if (!copiedRow) return
    const insertIdx = position === 'below' ? atIndex + 1 : atIndex
    setCanvasColumns(prev => prev.map(col => {
      const val = copiedRow[col.canvasId] ?? ''
      const newRows = [...col.rows]
      newRows.splice(insertIdx, 0, val)
      return { ...col, rows: newRows }
    }))
  }

  function hideRow(rowIndex) {
    setHiddenRows(prev => new Set([...prev, rowIndex]))
  }

  function showAllRows() {
    setHiddenRows(new Set())
  }

  function addBlankColumn() {
    const newCol = {
      canvasId: `canvas_${Date.now()}_new`,
      colId: `new_${Date.now()}`,
      label: 'New Column',
      fileName: 'manual',
      sheetName: '',
      rows: Array(maxRows).fill(''),
    }
    setCanvasColumns(prev => [...prev, newCol])
    // Auto-rename
    setTimeout(() => {
      setEditingColId(newCol.canvasId)
      setEditingLabel('New Column')
    }, 50)
  }

  // ── Helpers ──────────────────────────────────────────────────
  const allHiddenCols = files.flatMap(f =>
    f.sheets.flatMap(s =>
      s.headers.filter(h => h.hidden).map(h => ({ fileId: f.id, fileName: f.name, sheetName: s.name, col: h }))
    )
  )
  const visibleHeaders = (sheet) => sheet.headers.filter(h => !h.hidden)
  const maxRows = canvasColumns.length > 0 ? Math.max(...canvasColumns.map(c => c.rows.length)) : 0
  const sortedCanvasCols = [
    ...canvasColumns.filter(c => pinnedColIds.includes(c.canvasId)),
    ...canvasColumns.filter(c => !pinnedColIds.includes(c.canvasId)),
  ]

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
        .preview-row:hover td { background: ${raised}44 !important; }
        .canvas-row:nth-child(even) td { background: ${surface}55; }
        .canvas-row:hover td { background: ${raised}66 !important; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .fadein { animation: fadeUp 0.4s ease both; }
        .canvas-th { cursor: grab; position: relative; transition: opacity 0.1s; }
        .canvas-th:active { cursor: grabbing; }
        .canvas-th:hover .th-pin { opacity: 1 !important; }
        .col-label-click { cursor: text; border-radius: 3px; padding: 1px 3px; transition: background 0.1s; }
        .col-label-click:hover { background: ${raised}; }
        .insert-before { border-left: 2px solid ${accent} !important; padding-left: 10px !important; }
        .insert-after  { border-right: 2px solid ${accent} !important; padding-right: 10px !important; }
      `}</style>

      <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFileChange} />

      {/* Row context menu */}
      {contextMenu && (
        <div style={{
          position: 'fixed',
          top: contextMenu.y,
          left: contextMenu.x,
          background: surface,
          border: `1px solid ${border}`,
          borderRadius: 8,
          boxShadow: `0 8px 24px #00000044`,
          zIndex: 9999,
          minWidth: 160,
          overflow: 'hidden',
          fontFamily: "'DM Sans', sans-serif",
        }}>
          <div style={{ padding: '4px 0' }}>
            {[
              { label: 'Delete row', icon: '✕', color: red, action: () => { deleteRow(contextMenu.rowIndex); closeContextMenu() } },
              { label: 'Hide row', icon: '◌', color: text2, action: () => { hideRow(contextMenu.rowIndex); closeContextMenu() } },
              { label: 'Copy row', icon: '⊞', color: text2, action: () => { copyRow(contextMenu.rowIndex); closeContextMenu() } },
              ...(copiedRow ? [
                { label: 'Paste above', icon: '↑', color: accent, action: () => { pasteRow(contextMenu.rowIndex, 'above'); closeContextMenu() } },
                { label: 'Paste below', icon: '↓', color: accent, action: () => { pasteRow(contextMenu.rowIndex, 'below'); closeContextMenu() } },
              ] : []),
            ].map((item, i) => (
              <button
                key={i}
                onClick={item.action}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '8px 14px',
                  background: 'none', border: 'none',
                  color: item.color, fontSize: 13,
                  fontFamily: "'DM Sans', sans-serif",
                  cursor: 'pointer', textAlign: 'left',
                }}
                onMouseEnter={e => e.currentTarget.style.background = raised}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <span style={{ fontSize: 12, width: 14, textAlign: 'center' }}>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        style={{ display: 'flex', flex: 1, overflow: 'hidden', fontFamily: "'DM Sans', sans-serif" }}
        onMouseDown={e => {
          // Close context menu on any click
          if (contextMenu) setContextMenu(null)
          // Close cell editing if click is outside a td input
          if (editingCell && !e.target.closest('td input')) {
            commitCellEdit()
          }
        }}
        onDragOver={e => { if (dragData.current) e.preventDefault() }}
        onDrop={e => {
          e.preventDefault()
          if (!dragData.current) return
          if (dragData.current.type === 'sidebar') {
            addColumnsToCanvas(dragData.current.cols, null)
          }
          setInsertAt(null)
          lastInsert.current = null
        }}
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
                        <button
                          onClick={() => {
                            const colInfos = selectedSidebarCols.map(id => {
                              const col = file.sheets[0].headers.find(h => h.id === id)
                              return col ? { fileId: file.id, fileName: file.name, sheetName: file.sheets[0].name, col } : null
                            }).filter(Boolean)
                            addColumnsToCanvas(colInfos, null)
                          }}
                          style={{ background: accentDim, border: `1px solid ${accent}44`, borderRadius: 5, padding: '3px 10px', fontSize: 11, color: accent, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}
                        >
                          + Add {selectedSidebarCols.length} to canvas
                        </button>
                      </div>
                    )}

                    {visibleHeaders(file.sheets[0]).map(col => {
                      const onCanvas = canvasColumns.some(c => c.colId === col.id)
                      const isSelected = selectedSidebarCols.includes(col.id)
                      return (
                        <div
                          key={col.id}
                          className="col-row"
                          draggable
                          onDragStart={e => handleSidebarDragStart(e, file.id, file.name, file.sheets[0].name, col)}
                          onClick={e => toggleSidebarSelect(e, col.id)}
                          style={{
                            padding: '4px 8px 4px 24px',
                            borderRadius: 5,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            opacity: onCanvas ? 0.4 : 1,
                            background: isSelected ? accentDim : 'transparent',
                            border: isSelected ? `1px solid ${accent}44` : '1px solid transparent',
                          }}
                        >
                          <div style={{ width: 6, height: 6, borderRadius: 2, background: onCanvas ? text3 : accent, flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: 11, color: isSelected ? accent : onCanvas ? text3 : text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.label}</span>
                          <span style={{ fontSize: 9, color: text3 }}>{file.sheets[0].rows.length}</span>
                          {onCanvas && <span style={{ fontSize: 9, color: accent, fontWeight: 700 }}>✓</span>}
                          {!onCanvas && (
                            <div className="col-actions">
                              <button style={{ color: text3, background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, padding: '1px 4px', borderRadius: 3 }} onClick={e => { e.stopPropagation(); hideColumn(file.id, file.sheets[0].name, col.id) }} title="Hide">◌</button>
                              <button style={{ color: red, background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, padding: '1px 4px', borderRadius: 3 }} onClick={e => { e.stopPropagation(); deleteColumn(file.id, file.sheets[0].name, col.id) }} title="Delete">✕</button>
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
                <span style={{ fontSize: 10 }}>{showHidden ? '▾' : '▸'}</span>
                Hidden ({allHiddenCols.length})
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

          {/* Tabs */}
          <div style={{ background: surface, borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 4, height: 42, flexShrink: 0 }}>
            {[
              { id: 'preview', label: 'Preview' },
              { id: 'canvas',  label: `Canvas${canvasColumns.length > 0 ? ` (${canvasColumns.length})` : ''}` },
            ].map(m => (
              <button key={m.id} className="tab-btn" onClick={() => setMode(m.id)} style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: mode === m.id ? accentDim : 'transparent', color: mode === m.id ? accent : text2, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: mode === m.id ? 600 : 400, cursor: 'pointer' }}>
                {m.label}
              </button>
            ))}
            <span style={{ marginLeft: 8, fontSize: 12, color: text3 }}>
              {mode === 'preview' ? 'View & edit raw file data' : 'Build your custom sheet'}
            </span>
            {mode === 'canvas' && canvasColumns.length > 0 && (
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button onClick={addBlankColumn} style={{ background: accentDim, border: `1px solid ${accent}44`, borderRadius: 5, padding: '3px 10px', fontSize: 11, color: accent, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}>
                  + Column
                </button>
                <button onClick={() => { setCanvasColumns([]); setPinnedColIds([]) }} style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 5, padding: '3px 10px', fontSize: 11, color: text3, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                  Clear canvas
                </button>
              </div>
            )}
          </div>

          {/* ── PREVIEW ── */}
          {mode === 'preview' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div style={{ background: surface, borderBottom: `1px solid ${border}`, padding: '5px 12px', display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: text3, marginRight: 4 }}>Quick actions:</span>
                {['Filter', 'Sort', 'Group'].map(a => (
                  <button key={a} className="tool-btn" style={{ padding: '4px 10px', borderRadius: 5, border: `1px solid ${border}`, background: 'transparent', color: text2, fontFamily: "'DM Sans',sans-serif", fontSize: 11, cursor: 'pointer' }}>{a}</button>
                ))}
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                {files.length === 0 ? (
                  <div className="fadein" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: text3, fontSize: 13 }}>
                    Import a file to preview it here.
                  </div>
                ) : files.map(file =>
                  file.sheets.map((sheet, si) => {
                    const visible = visibleHeaders(sheet)
                    return (
                      <div key={`${file.id}-${si}`} className="fadein">
                        <div style={{ padding: '8px 14px 4px', fontSize: 11, color: text3, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: green, fontSize: 8 }}>●</span>
                          <span style={{ color: text2, fontWeight: 600 }}>{file.name}</span>
                          <span>— {sheet.name}</span>
                          <span>({sheet.rows.length} rows · {visible.length} columns)</span>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: "'DM Mono',monospace" }}>
                          <thead>
                            <tr style={{ background: surface, position: 'sticky', top: 0, zIndex: 5 }}>
                              <th style={{ width: 36, padding: '7px 10px', borderBottom: `1px solid ${border}`, borderRight: `1px solid ${border}`, color: text3, fontSize: 10, textAlign: 'center', fontWeight: 500, background: surface }}>
                                #
                              </th>
                              {visible.map(col => (
                                <th key={col.id} style={{ padding: '7px 12px', borderBottom: `1px solid ${border}`, borderRight: `1px solid ${border}`, color: text, fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif", fontSize: 12, background: surface, position: 'relative' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span>{col.label}</span>
                                    <div style={{ display: 'flex', gap: 3, opacity: 0, transition: 'opacity 0.15s' }} className="th-actions"
                                      onMouseEnter={e => e.currentTarget.style.opacity = 1}
                                      onMouseLeave={e => e.currentTarget.style.opacity = 0}
                                    >
                                      <button style={{ color: text3, background: raised, border: `1px solid ${border}`, borderRadius: 3, fontSize: 10, padding: '1px 5px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }} onClick={() => hideColumn(file.id, sheet.name, col.id)}>Hide</button>
                                      <button style={{ color: red, background: redDim, border: `1px solid ${red}44`, borderRadius: 3, fontSize: 10, padding: '1px 5px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }} onClick={() => deleteColumn(file.id, sheet.name, col.id)}>Del</button>
                                    </div>
                                  </div>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sheet.rows.slice(0, 200).map((row, ri) => (
                              <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : `${surface}55` }}>
                                <td style={{ padding: '5px 10px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, color: text3, textAlign: 'center', fontSize: 10 }}>{ri + 1}</td>
                                {visible.map(col => {
                                  const val = row[col.index]
                                  const isEmpty = val === undefined || val === null || val === ''
                                  return (
                                    <td key={col.id} style={{ padding: '5px 12px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, color: isEmpty ? text3 : text2, whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {isEmpty ? <span style={{ fontSize: 10 }}>—</span> : String(val)}
                                    </td>
                                  )
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {sheet.rows.length > 200 && (
                          <div style={{ padding: '8px 14px', fontSize: 11, color: text3 }}>Showing 200 of {sheet.rows.length} rows</div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {/* ── CANVAS ── */}
          {mode === 'canvas' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              {/* Toolbar */}
              <div style={{ background: surface, borderBottom: `1px solid ${border}`, padding: '6px 12px', display: 'flex', gap: 3, flexWrap: 'wrap', flexShrink: 0 }}>
                {tools.map(tool => (
                  <button key={tool.id} className={`tool-btn${activeTool === tool.id ? ' active' : ''}`} onClick={() => setActiveTool(activeTool === tool.id ? null : tool.id)} title={tool.desc} style={{ padding: '5px 11px', borderRadius: 6, border: `1px solid ${border}`, background: 'transparent', color: text2, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 13 }}>{tool.icon}</span>
                    <span>{tool.label}</span>
                  </button>
                ))}
              </div>

              {/* Tool result banner */}
              {toolResult && !activeTool && (
                <div style={{ background: dark ? '#0d2a1a' : '#dcfce7', borderBottom: `1px solid #4ade8044`, padding: '8px 16px', fontSize: 12, color: '#4ade80', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span>✓</span>
                  <span>{toolResult.type === 'stats' ? 'Col Stats — see below' : toolResult.message}</span>
                  <button onClick={() => setToolResult(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 14 }}>✕</button>
                </div>
              )}

              {/* Active tool panels */}
              {activeTool === 'trim' && (
                <div style={{ background: accentDim, borderBottom: `1px solid ${accent}44`, padding: '10px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span style={{ fontWeight: 600, color: accent }}>Trim & Clean</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: text2, cursor: 'pointer' }}>
                    <input type="checkbox" checked={trimOptions.spaces} onChange={e => setTrimOptions(p => ({ ...p, spaces: e.target.checked }))} />
                    Strip extra spaces
                  </label>
                  <label style={{ fontSize: 12, color: text2, display: 'flex', alignItems: 'center', gap: 5 }}>
                    Casing:
                    <select value={trimOptions.casing} onChange={e => setTrimOptions(p => ({ ...p, casing: e.target.value }))} style={{ background: raised, border: `1px solid ${border}`, borderRadius: 4, padding: '2px 6px', color: text, fontFamily: "'DM Sans',sans-serif", fontSize: 12, cursor: 'pointer' }}>
                      <option value="none">Keep as-is</option>
                      <option value="lower">lowercase</option>
                      <option value="upper">UPPERCASE</option>
                      <option value="title">Title Case</option>
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

              {activeTool && !['trim','empty','duplicates','stats'].includes(activeTool) && (
                <div style={{ background: accentDim, borderBottom: `1px solid ${accent}44`, padding: '9px 16px', fontSize: 13, color: accent, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <span style={{ fontWeight: 600 }}>{tools.find(t => t.id === activeTool)?.label}</span>
                  <span style={{ color: text2, fontWeight: 400 }}>— {tools.find(t => t.id === activeTool)?.desc}</span>
                  <button onClick={() => setActiveTool(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 15 }}>✕</button>
                </div>
              )}

              {/* Canvas drop zone */}
              <div
                ref={canvasScrollRef}
                onDragOver={handleCanvasZoneDragOver}
                onDrop={handleCanvasZoneDrop}
                onDragLeave={handleCanvasDragLeave}
                onMouseDown={handleCanvasMouseDown}
                onContextMenu={e => { e.preventDefault() }}
                style={{ flex: 1, overflow: 'auto', background: base, position: 'relative', cursor: 'default', userSelect: 'none' }}
              >
                {canvasColumns.length === 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 40 }}>
                    <div className="fadein" style={{ textAlign: 'center', maxWidth: 340 }}>
                      <div style={{ width: 60, height: 60, borderRadius: 14, background: raised, border: `1px dashed ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto 18px' }}>📊</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: text, marginBottom: 8, fontFamily: "'Syne',sans-serif" }}>Canvas is empty</div>
                      <div style={{ fontSize: 13, color: text2, lineHeight: 1.8, marginBottom: 22 }}>Drag columns from the sidebar to build your sheet.</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, textAlign: 'left' }}>
                        {[
                          { icon: '⚡', text: 'Drag Company Name from two files → run Crosscheck' },
                          { icon: '◎', text: 'Drag two columns → find gaps between them' },
                          { icon: '✦', text: 'Shift+click columns in sidebar to select multiple' },
                        ].map((h, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', borderRadius: 7, background: surface, border: `1px solid ${border}`, fontSize: 12, color: text2 }}>
                            <span style={{ color: accent, fontSize: 14, flexShrink: 0 }}>{h.icon}</span>
                            {h.text}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ flex: 1, overflow: 'auto' }}>
                      <div style={{ display: 'inline-block', minWidth: '100%' }}>
                      <div style={{ transformOrigin: 'top left', transform: `scale(${canvasZoom})`, width: `${100 / canvasZoom}%`, paddingBottom: `${(1 / canvasZoom - 1) * 100}%` }}>
                      <table style={{ borderCollapse: 'collapse', fontSize: 12, fontFamily: "'DM Mono',monospace" }}>
                        <thead>
                          <tr style={{ background: surface }}>
                            <th style={{ width: 36, padding: '8px 10px', borderBottom: `1px solid ${border}`, borderRight: `1px solid ${border}`, color: text3, fontSize: 10, textAlign: 'center', fontWeight: 500, background: surface, position: 'sticky', top: 0, zIndex: 5 }}>#</th>
                            {sortedCanvasCols.map((col, idx) => {
                              const isPinned = pinnedColIds.includes(col.canvasId)
                              const isDraggingThis = draggingCanvasId === col.canvasId
                              const isInsertBefore = insertAt?.index === idx && insertAt?.side === 'left'
                              const isInsertAfter  = insertAt?.index === idx && insertAt?.side === 'right'
                              return (
                                <th
                                  key={col.canvasId}
                                  className="canvas-th"
                                  draggable
                                  onDragStart={e => handleCanvasDragStart(e, col.canvasId)}
                                  onDragEnd={handleCanvasDragEnd}
                                  onDragOver={e => handleThDragOver(e, idx)}
                                  onDrop={e => handleThDrop(e, idx)}
                                  style={{
                                    padding: '8px 12px',
                                    borderBottom: `1px solid ${border}`,
                                    borderRight: `1px solid ${border}`,
                                    textAlign: 'left',
                                    whiteSpace: 'nowrap',
                                    fontFamily: "'DM Sans',sans-serif",
                                    fontSize: 12,
                                    background: isPinned ? (dark ? '#1a1f4a' : '#e8f5ee') : surface,
                                    opacity: isDraggingThis ? 0.3 : 1,
                                    position: 'sticky',
                                    top: 0,
                                    zIndex: 4,
                                    overflow: 'visible',
                                  }}
                                >
                                  {/* Insertion line overlay — no layout shift */}
                                  {isInsertBefore && (
                                    <div style={{ position: 'absolute', left: -1, top: 0, bottom: 0, width: 3, background: accent, borderRadius: 2, zIndex: 10, pointerEvents: 'none' }}>
                                      <div style={{ position: 'absolute', top: -3, left: -2, width: 7, height: 7, borderRadius: '50%', background: accent }} />
                                    </div>
                                  )}
                                  {isInsertAfter && (
                                    <div style={{ position: 'absolute', right: -2, top: 0, bottom: 0, width: 3, background: accent, borderRadius: 2, zIndex: 10, pointerEvents: 'none' }}>
                                      <div style={{ position: 'absolute', top: -3, left: -2, width: 7, height: 7, borderRadius: '50%', background: accent }} />
                                    </div>
                                  )}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    {/* Column name — click to rename */}
                                    {editingColId === col.canvasId ? (
                                      <input
                                        ref={editInputRef}
                                        value={editingLabel}
                                        onChange={e => setEditingLabel(e.target.value)}
                                        onBlur={() => commitEdit(col.canvasId)}
                                        onKeyDown={e => { if (e.key === 'Enter') commitEdit(col.canvasId); if (e.key === 'Escape') setEditingColId(null) }}
                                        style={{ background: raised, border: `1px solid ${accent}`, borderRadius: 4, padding: '2px 6px', color: text, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, width: 120, outline: 'none' }}
                                        autoFocus
                                        onClick={e => e.stopPropagation()}
                                      />
                                    ) : (
                                      <div>
                                        <div
                                          className="col-label-click"
                                          onClick={() => startEdit(col.canvasId, col.label)}
                                          title="Click to rename"
                                          style={{ color: text, fontWeight: 600, display: 'inline-block' }}
                                        >{col.label}</div>
                                        <div style={{ color: text3, fontSize: 10, fontWeight: 400, marginTop: 1 }}>{col.fileName}</div>
                                      </div>
                                    )}

                                    {/* Pin + X — right side */}
                                    <button
                                      className="th-pin"
                                      title={isPinned ? 'Unpin' : 'Pin'}
                                      onClick={() => togglePin(col.canvasId)}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: '0 2px', color: isPinned ? accent : text3, opacity: isPinned ? 1 : 0, marginLeft: 'auto', flexShrink: 0 }}
                                    >📌</button>
                                    <button
                                      onClick={() => removeCanvasColumn(col.canvasId)}
                                      title="Remove from canvas"
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: text3, fontSize: 11, padding: '0 2px', lineHeight: 1, flexShrink: 0, opacity: 0.5, marginLeft: 2 }}
                                      onMouseEnter={e => e.currentTarget.style.opacity = 1}
                                      onMouseLeave={e => e.currentTarget.style.opacity = 0.5}
                                    >✕</button>
                                  </div>
                                </th>
                              )
                            })}
                            {/* + New column button in header */}
                            <th
                              onClick={addBlankColumn}
                              style={{ padding: '8px 14px', borderBottom: `1px solid ${border}`, borderRight: `1px solid ${border}`, background: surface, position: 'sticky', top: 0, zIndex: 4, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: text3 }}
                              onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = accent }}
                              onMouseLeave={e => { e.currentTarget.style.background = surface; e.currentTarget.style.color = text3 }}
                            >+ col</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from({ length: Math.min(maxRows, 500) }).map((_, ri) => {
                            if (hiddenRows.has(ri)) return null
                            return (
                            <tr key={ri} className="canvas-row">
                              <td
                                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, rowIndex: ri }) }}
                                style={{ padding: '5px 10px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, color: text3, textAlign: 'center', fontSize: 10, cursor: 'context-menu', userSelect: 'none' }}
                                onMouseEnter={e => { e.currentTarget.style.background = raised }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                              >{ri + 1}</td>
                              {sortedCanvasCols.map((col, idx) => {
                                const val = col.rows[ri]
                                const isEmpty = val === undefined || val === null || val === ''
                                const isPinned = pinnedColIds.includes(col.canvasId)
                                const isEditing = editingCell?.canvasId === col.canvasId && editingCell?.rowIndex === ri
                                const isDup = duplicateMap[col.canvasId]?.has(String(val).trim().toLowerCase())
                                const isEmptyHighlight = highlightEmpty && isEmpty
                                let bg = isPinned ? (dark ? '#1a1f4a33' : '#e8f5ee88') : 'transparent'
                                if (isEmptyHighlight) bg = dark ? '#2a0d0d' : '#fee2e2'
                                if (isDup) bg = dark ? '#2a1f0d' : '#fef3c7'
                                return (
                                  <td
                                    key={col.canvasId}
                                    onDragOver={e => handleThDragOver(e, idx)}
                                    onDrop={e => handleThDrop(e, idx)}
                                    onClick={() => !isEditing && startCellEdit(col.canvasId, ri, val)}
                                    onContextMenu={e => {
                                      // Only show cell context menu when this cell is being edited
                                      if (isEditing) {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        setContextMenu({ x: e.clientX, y: e.clientY, type: 'cell', canvasId: col.canvasId, rowIndex: ri, val: editingCellVal })
                                      }
                                    }}
                                    style={{
                                      padding: isEditing ? '0' : '5px 14px',
                                      borderBottom: `1px solid ${border}22`,
                                      borderRight: `1px solid ${border}`,
                                      color: isEmptyHighlight ? '#f87171' : isDup ? '#E8B85B' : isEmpty ? text3 : text2,
                                      whiteSpace: 'nowrap',
                                      maxWidth: 240,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      background: bg,
                                      cursor: isEditing ? 'text' : 'default',
                                    }}
                                  >
                                    {isEditing ? (
                                      <input
                                        autoFocus
                                        value={editingCellVal}
                                        onChange={e => setEditingCellVal(e.target.value)}
                                        onBlur={commitCellEdit}
                                        onKeyDown={handleCellKeyDown}
                                        style={{
                                          width: '100%',
                                          padding: '5px 14px',
                                          border: 'none',
                                          borderBottom: `2px solid ${accent}`,
                                          background: raised,
                                          color: text,
                                          fontFamily: "'DM Mono',monospace",
                                          fontSize: 12,
                                          outline: 'none',
                                          boxSizing: 'border-box',
                                        }}
                                      />
                                    ) : isEmptyHighlight ? (
                                      <span style={{ fontSize: 11, color: '#f87171', fontStyle: 'italic' }}>empty — click to fill</span>
                                    ) : isEmpty ? (
                                      <span style={{ fontSize: 10 }}>—</span>
                                    ) : (
                                      String(val)
                                    )}
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
                    </div>
                  </div>
                )}

              </div>

              {/* Stats panel */}
              {toolResult?.type === 'stats' && (
                <div style={{ borderTop: `1px solid ${border}`, background: surface, overflowX: 'auto', flexShrink: 0, maxHeight: 180 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: "'DM Mono',monospace" }}>
                    <thead>
                      <tr style={{ background: raised }}>
                        {['Column','Total','Filled','Empty','Unique','Min','Max','Sum'].map(h => (
                          <th key={h} style={{ padding: '6px 12px', borderBottom: `1px solid ${border}`, borderRight: `1px solid ${border}`, textAlign: 'left', color: text2, fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
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

              {/* Hidden rows banner — always visible above sheets bar */}
              {hiddenRows.size > 0 && (
                <div style={{ padding: '5px 16px', background: dark ? '#2a1f0d' : '#fef3c7', borderTop: `1px solid ${amber}44`, fontSize: 11, color: amber, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span>◌ {hiddenRows.size} row{hiddenRows.size !== 1 ? 's' : ''} hidden</span>
                  <button onClick={showAllRows} style={{ background: 'none', border: `1px solid ${amber}44`, borderRadius: 4, padding: '2px 8px', color: amber, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Show all</button>
                </div>
              )}

              {/* Sheets bar — always visible at bottom of canvas mode */}
              <div style={{ borderTop: `1px solid ${border}`, background: surface, display: 'flex', alignItems: 'center', flexShrink: 0, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'stretch', flex: 1, overflowX: 'auto', gap: 0 }}>
                  <button
                    onClick={() => setActiveSheet('canvas')}
                    style={{
                      padding: '6px 16px',
                      border: 'none',
                      borderRight: `1px solid ${border}`,
                      borderTop: activeSheet === 'canvas' ? `2px solid ${accent}` : `2px solid transparent`,
                      background: activeSheet === 'canvas' ? base : surface,
                      color: activeSheet === 'canvas' ? accent : text2,
                      fontFamily: "'DM Sans',sans-serif",
                      fontSize: 12,
                      fontWeight: activeSheet === 'canvas' ? 600 : 400,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    Canvas
                  </button>

                  {files.flatMap(file =>
                    file.sheets.map(sheet => {
                      const key = `${file.id}::${sheet.name}`
                      const isActive = activeSheet === key
                      return (
                        <button
                          key={key}
                          onClick={() => setActiveSheet(key)}
                          style={{
                            padding: '6px 16px',
                            border: 'none',
                            borderRight: `1px solid ${border}`,
                            borderTop: isActive ? `2px solid ${accent}` : `2px solid transparent`,
                            background: isActive ? base : surface,
                            color: isActive ? accent : text2,
                            fontFamily: "'DM Sans',sans-serif",
                            fontSize: 12,
                            fontWeight: isActive ? 600 : 400,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span style={{ color: text3, fontSize: 10 }}>📄</span>
                          {file.sheets.length > 1 ? `${file.name} — ${sheet.name}` : file.name}
                        </button>
                      )
                    })
                  )}

                  <button style={{ padding: '6px 12px', border: 'none', borderRight: `1px solid ${border}`, borderTop: '2px solid transparent', background: 'transparent', color: text3, cursor: 'pointer', fontSize: 16, lineHeight: 1, flexShrink: 0 }} title="New sheet (coming soon)">+</button>
                </div>

                <div style={{ padding: '0 14px', fontSize: 11, color: text3, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, borderLeft: `1px solid ${border}` }}>
                  <span style={{ color: green, fontSize: 8 }}>●</span>
                  <span>{maxRows.toLocaleString()} rows</span>
                  <span>·</span>
                  <span>{canvasColumns.length} cols</span>
                  {maxRows > 500 && <span style={{ color: amber }}>· 500 shown</span>}
                  <span style={{ marginLeft: 6, borderLeft: `1px solid ${border}`, paddingLeft: 8 }}>
                    <button
                      onClick={() => setCanvasZoom(prev => Math.min(2, Math.round((prev + 0.1) * 10) / 10))}
                      style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 13, padding: '0 3px' }}
                    >+</button>
                    <span style={{ minWidth: 36, textAlign: 'center', display: 'inline-block', cursor: 'pointer' }} onClick={() => setCanvasZoom(1)}>
                      {Math.round(canvasZoom * 100)}%
                    </span>
                    <button
                      onClick={() => setCanvasZoom(prev => Math.max(0.5, Math.round((prev - 0.1) * 10) / 10))}
                      style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 13, padding: '0 3px' }}
                    >−</button>
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