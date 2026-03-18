'use client'
import { useState, useRef } from 'react'
import { useTheme } from '../providers'
import * as XLSX from 'xlsx'

export default function AppPage() {
  const { dark, setDark } = useTheme()
  const [activeTool, setActiveTool] = useState(null)
  const [files, setFiles] = useState([])
  const [expandedFile, setExpandedFile] = useState(null)
  const fileInputRef = useRef(null)

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
  const greenDim  = dark ? '#0d2a1a' : '#dcfce7'

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

  function handleImportClick() {
    fileInputRef.current.click()
  }

  function handleFileChange(e) {
    const file = e.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target.result)
      const workbook = XLSX.read(data, { type: 'array' })

      const sheets = workbook.SheetNames.map(sheetName => {
        const worksheet = workbook.Sheets[sheetName]
        const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 })
        const headers = json[0] || []
        const rows = json.slice(1)
        return { name: sheetName, headers, rows }
      })

      const newFile = {
        name: file.name,
        sheets,
      }

      setFiles(prev => [...prev, newFile])
      setExpandedFile(file.name)
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${border}; border-radius: 4px; }
        .tool-btn:hover { background: ${raised} !important; color: ${text} !important; }
        .tool-btn.active { background: ${accentDim} !important; color: ${accent} !important; border-color: ${accent} !important; }
        .import-btn:hover { opacity: 0.88; }
        .file-item:hover { background: ${raised} !important; }
        .col-item:hover { background: ${raised} !important; }
        .sidebar-link:hover { color: ${text} !important; }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .canvas-empty { animation: fadeUp 0.5s ease both; }
        .tool-btn { transition: background 0.15s, color 0.15s, border-color 0.15s; }
      `}</style>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', fontFamily: "'DM Sans', sans-serif" }}>

        {/* ── Left Sidebar ── */}
        <div style={{
          width: 220,
          background: surface,
          borderRight: `1px solid ${border}`,
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}>
          {/* Import button */}
          <div style={{ padding: '12px 12px 10px' }}>
            <button
              className="import-btn"
              onClick={handleImportClick}
              style={{
                width: '100%',
                padding: '9px 0',
                background: accent,
                color: '#fff',
                border: 'none',
                borderRadius: 7,
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                letterSpacing: 0.3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
              Import File
            </button>
          </div>

          {/* Section label */}
          <div style={{ padding: '4px 14px 6px', fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: text3 }}>
            Files
          </div>

          {/* File list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px' }}>
            {files.length === 0 ? (
              <div style={{
                margin: '24px 6px',
                padding: '18px 14px',
                borderRadius: 8,
                border: `1px dashed ${border}`,
                textAlign: 'center',
                color: text3,
                fontSize: 12,
                lineHeight: 1.7,
              }}>
                No files imported yet.<br />
                <span style={{ color: text2 }}>Supports .xlsx, .xls, .csv</span>
              </div>
            ) : (
              files.map((file, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  {/* File header */}
                  <div
                    className="file-item"
                    onClick={() => setExpandedFile(expandedFile === file.name ? null : file.name)}
                    style={{
                      padding: '7px 10px',
                      borderRadius: 6,
                      fontSize: 12,
                      color: text,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      fontWeight: 600,
                    }}
                  >
                    <span style={{ fontSize: 14 }}>📄</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{file.name}</span>
                    <span style={{ color: text3, fontSize: 10 }}>{expandedFile === file.name ? '▾' : '▸'}</span>
                  </div>

                  {/* Columns list */}
                  {expandedFile === file.name && file.sheets[0]?.headers.map((col, j) => (
                    <div
                      key={j}
                      className="col-item"
                      style={{
                        padding: '5px 10px 5px 28px',
                        fontSize: 12,
                        color: text2,
                        cursor: 'pointer',
                        borderRadius: 5,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span style={{ color: accent, fontSize: 10 }}>▦</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col || `Column ${j + 1}`}</span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>

          {/* Bottom controls */}
          <div style={{ padding: '10px 12px 14px', borderTop: `1px solid ${border}` }}>
            <button
              onClick={() => setDark(!dark)}
              className="sidebar-link"
              style={{
                background: 'none',
                border: 'none',
                padding: '5px 2px',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 12,
                color: text3,
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
              }}
            >
              {dark ? '☀️' : '🌙'} {dark ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
        </div>

        {/* ── Main Area ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* ── Toolbar ── */}
          <div style={{
            background: surface,
            borderBottom: `1px solid ${border}`,
            padding: '6px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            flexWrap: 'wrap',
          }}>
            {tools.map(tool => (
              <button
                key={tool.id}
                className={`tool-btn${activeTool === tool.id ? ' active' : ''}`}
                onClick={() => setActiveTool(activeTool === tool.id ? null : tool.id)}
                title={tool.desc}
                style={{
                  padding: '5px 11px',
                  borderRadius: 6,
                  border: `1px solid ${border}`,
                  background: 'transparent',
                  color: text2,
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ fontSize: 13 }}>{tool.icon}</span>
                <span>{tool.label}</span>
              </button>
            ))}
          </div>

          {/* Active tool panel */}
          {activeTool && (
            <div style={{
              background: accentDim,
              borderBottom: `1px solid ${accent}44`,
              padding: '10px 18px',
              fontSize: 13,
              color: accent,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}>
              <span style={{ fontWeight: 600 }}>{tools.find(t => t.id === activeTool)?.label}</span>
              <span style={{ color: text2, fontWeight: 400 }}>— {tools.find(t => t.id === activeTool)?.desc}</span>
              <button
                onClick={() => setActiveTool(null)}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
              >
                ✕
              </button>
            </div>
          )}

          {/* ── Canvas ── */}
          <div style={{
            flex: 1,
            overflow: 'auto',
            background: base,
            display: 'flex',
            alignItems: files.length === 0 ? 'center' : 'flex-start',
            justifyContent: files.length === 0 ? 'center' : 'flex-start',
            padding: files.length === 0 ? 40 : 0,
          }}>
            {files.length === 0 ? (
              <div className="canvas-empty" style={{ textAlign: 'center', maxWidth: 360 }}>
                <div style={{
                  width: 64,
                  height: 64,
                  borderRadius: 16,
                  background: raised,
                  border: `1px solid ${border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 28,
                  margin: '0 auto 20px',
                }}>
                  📊
                </div>
                <div style={{ fontSize: 17, fontWeight: 700, color: text, marginBottom: 8, fontFamily: "'Syne', sans-serif" }}>
                  Canvas is empty
                </div>
                <div style={{ fontSize: 13, color: text2, lineHeight: 1.8, marginBottom: 24 }}>
                  Import an Excel or CSV file using the sidebar,<br />
                  then drag columns here to build your sheet.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
                  {[
                    { icon: '⚡', text: 'Fuzzy match company names across files' },
                    { icon: '◎', text: 'Find what is in file A but missing from B' },
                    { icon: '✦', text: 'Trim, clean and deduplicate in one click' },
                  ].map((hint, i) => (
                    <div key={i} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '9px 12px',
                      borderRadius: 7,
                      background: surface,
                      border: `1px solid ${border}`,
                      fontSize: 12,
                      color: text2,
                    }}>
                      <span style={{ fontSize: 14, color: accent }}>{hint.icon}</span>
                      {hint.text}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              /* Data table */
              <div style={{ width: '100%', overflowX: 'auto' }}>
                {files.map((file, fi) =>
                  file.sheets.map((sheet, si) => (
                    <div key={`${fi}-${si}`}>
                      {/* Sheet label */}
                      <div style={{
                        padding: '10px 16px 6px',
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: 1,
                        textTransform: 'uppercase',
                        color: text3,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}>
                        <span style={{ color: green }}>●</span>
                        {file.name} — {sheet.name}
                        <span style={{ color: text3, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                          ({sheet.rows.length} rows · {sheet.headers.length} columns)
                        </span>
                      </div>

                      {/* Table */}
                      <table style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: 12,
                        fontFamily: "'DM Mono', monospace",
                      }}>
                        <thead>
                          <tr style={{ background: surface }}>
                            <th style={{ width: 40, padding: '8px 12px', borderBottom: `1px solid ${border}`, borderRight: `1px solid ${border}`, color: text3, fontWeight: 500, textAlign: 'center', fontSize: 11 }}>#</th>
                            {sheet.headers.map((h, hi) => (
                              <th key={hi} style={{
                                padding: '8px 14px',
                                borderBottom: `1px solid ${border}`,
                                borderRight: `1px solid ${border}`,
                                color: text,
                                fontWeight: 600,
                                textAlign: 'left',
                                whiteSpace: 'nowrap',
                                fontFamily: "'DM Sans', sans-serif",
                                fontSize: 12,
                              }}>
                                {h || `Column ${hi + 1}`}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sheet.rows.slice(0, 100).map((row, ri) => (
                            <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : surface + '66' }}>
                              <td style={{ padding: '6px 12px', borderBottom: `1px solid ${border}22`, borderRight: `1px solid ${border}`, color: text3, textAlign: 'center', fontSize: 11 }}>{ri + 1}</td>
                              {sheet.headers.map((_, ci) => (
                                <td key={ci} style={{
                                  padding: '6px 14px',
                                  borderBottom: `1px solid ${border}22`,
                                  borderRight: `1px solid ${border}`,
                                  color: row[ci] === undefined || row[ci] === '' ? text3 : text2,
                                  whiteSpace: 'nowrap',
                                  maxWidth: 200,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}>
                                  {row[ci] === undefined || row[ci] === '' ? <span style={{ color: text3, fontSize: 10 }}>—</span> : String(row[ci])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {sheet.rows.length > 100 && (
                        <div style={{ padding: '10px 16px', fontSize: 12, color: text3 }}>
                          Showing 100 of {sheet.rows.length} rows
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}