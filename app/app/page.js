'use client'
import { useState, useRef, useCallback } from 'react'
import { useTheme } from '../providers'
import * as XLSX from 'xlsx'

export default function AppPage() {
  const { dark, setDark } = useTheme()
  const [mode, setMode] = useState('preview')
  const [activeTool, setActiveTool] = useState(null)
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
    if (!dragData.current) return
    if (dragData.current.type === 'sidebar') {
      addColumnsToCanvas(dragData.current.cols, null)
    }
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
    // Only pan on left click on the background — not on buttons/inputs/th
    if (e.target.closest('th,td,button,input')) return
    if (e.button !== 0) return
    isPanning.current = true
    panStart.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: canvasScrollRef.current?.scrollLeft || 0,
      scrollTop: canvasScrollRef.current?.scrollTop || 0,
    }
    e.currentTarget.style.cursor = 'grabbing'
    e.preventDefault()
  }

  function handleCanvasMouseMove(e) {
    if (!isPanning.current || !canvasScrollRef.current) return
    const dx = e.clientX - panStart.current.x
    const dy = e.clientY - panStart.current.y
    canvasScrollRef.current.scrollLeft = panStart.current.scrollLeft - dx
    canvasScrollRef.current.scrollTop  = panStart.current.scrollTop  - dy
  }

  function handleCanvasMouseUp(e) {
    isPanning.current = false
    if (canvasScrollRef.current) e.currentTarget.style.cursor = ''
  }

  function handleCanvasWheel(e) {
    if (!canvasScrollRef.current) return
    e.preventDefault()
    canvasScrollRef.current.scrollLeft += e.deltaX
    canvasScrollRef.current.scrollTop  += e.deltaY * 0.8 // slightly smoothed
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

      <div
        style={{ display: 'flex', flex: 1, overflow: 'hidden', fontFamily: "'DM Sans', sans-serif" }}
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
              <button onClick={() => { setCanvasColumns([]); setPinnedColIds([]) }} style={{ marginLeft: 'auto', background: 'none', border: `1px solid ${border}`, borderRadius: 5, padding: '3px 10px', fontSize: 11, color: text3, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                Clear canvas
              </button>
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

              {activeTool && (
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
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseUp}
                onWheel={handleCanvasWheel}
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
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from({ length: Math.min(maxRows, 500) }).map((_, ri) => (
                            <tr key={ri} className="canvas-row">
                              <td style={{ padding: '5px 10px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, color: text3, textAlign: 'center', fontSize: 10 }}>{ri + 1}</td>
                              {sortedCanvasCols.map((col, idx) => {
                                const val = col.rows[ri]
                                const isEmpty = val === undefined || val === null || val === ''
                                const isPinned = pinnedColIds.includes(col.canvasId)
                                return (
                                  <td
                                    key={col.canvasId}
                                    onDragOver={e => handleThDragOver(e, idx)}
                                    onDrop={e => handleThDrop(e, idx)}
                                    style={{
                                      padding: '5px 14px',
                                      borderBottom: `1px solid ${border}22`,
                                      borderRight: `1px solid ${border}`,
                                      color: isEmpty ? text3 : text2,
                                      whiteSpace: 'nowrap',
                                      maxWidth: 240,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      background: isPinned ? (dark ? '#1a1f4a33' : '#e8f5ee88') : 'transparent',
                                    }}
                                  >
                                    {isEmpty ? <span style={{ fontSize: 10 }}>—</span> : String(val)}
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                  </div>
                )}
              </div>

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
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}