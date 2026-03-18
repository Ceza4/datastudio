'use client'
import { useState } from 'react'
import { useTheme } from '../providers'

export default function AppPage() {
  const { dark, setDark } = useTheme()
  const [activeTool, setActiveTool] = useState(null)
  const [files, setFiles] = useState([])

  const base     = dark ? '#1A1917' : '#F5F3EE'
  const surface  = dark ? '#201F1C' : '#EDEAE3'
  const raised   = dark ? '#262522' : '#E4E1D8'
  const border   = dark ? '#2E2D29' : '#D5D1C7'
  const text     = dark ? '#E8E6E1' : '#1A1917'
  const text2    = dark ? '#9A9790' : '#6B6860'
  const text3    = dark ? '#5A5955' : '#A09D97'
  const accent   = dark ? '#5B5FE8' : '#1D9E75'
  const accentDim = dark ? '#1e2057' : '#d0f0e4'

  const tools = [
    { id: 'crosscheck', label: 'Crosscheck',     icon: '⚡', desc: 'Fuzzy match names across files' },
    { id: 'duplicates', label: 'Duplicates',     icon: '⊕', desc: 'Find repeated values'           },
    { id: 'gaps',       label: 'Gap Finder',     icon: '◎', desc: 'What is in A but missing from B' },
    { id: 'mapper',     label: 'Col Mapper',     icon: '⇄', desc: 'Visual JOIN by shared key'       },
    { id: 'sort',       label: 'Sort & Filter',  icon: '⇅', desc: 'Sort canvas by any column'       },
    { id: 'merge',      label: 'Merge',          icon: '⬡', desc: 'Combine two columns into one'    },
    { id: 'split',      label: 'Split',          icon: '⋮', desc: 'Split column by delimiter'       },
    { id: 'trim',       label: 'Trim & Clean',   icon: '✦', desc: 'Strip spaces, fix casing'        },
    { id: 'empty',      label: 'Highlight Empty',icon: '□', desc: 'Flag blank/null cells'           },
    { id: 'stats',      label: 'Col Stats',      icon: '▦', desc: 'Count, unique, sum, min, max'    },
  ]

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
        .sidebar-link:hover { color: ${text} !important; }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
        .canvas-empty { animation: fadeUp 0.5s ease both; }
        .tool-btn { transition: background 0.15s, color 0.15s, border-color 0.15s; }
      `}</style>

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
              files.map((f, i) => (
                <div
                  key={i}
                  className="file-item"
                  style={{
                    padding: '7px 10px',
                    borderRadius: 6,
                    marginBottom: 3,
                    fontSize: 13,
                    color: text2,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                  }}
                >
                  <span style={{ fontSize: 14 }}>📄</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                </div>
              ))
            )}
          </div>

          {/* Bottom controls */}
          <div style={{ padding: '10px 12px 14px', borderTop: `1px solid ${border}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
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
            padding: '0 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            flexWrap: 'wrap',
            minHeight: 44,
            paddingTop: 6,
            paddingBottom: 6,
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
              <span style={{ fontWeight: 600 }}>
                {tools.find(t => t.id === activeTool)?.label}
              </span>
              <span style={{ color: text2, fontWeight: 400 }}>
                — {tools.find(t => t.id === activeTool)?.desc}
              </span>
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
            alignItems: 'center',
            justifyContent: 'center',
            padding: 40,
          }}>
            <div className="canvas-empty" style={{ textAlign: 'center', maxWidth: 360 }}>
              {/* Icon */}
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

              {/* Feature hints */}
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
          </div>

        </div>
      </div>
    </>
  )
}