'use client'
import { useState } from 'react'
import FmtBtn from './FmtBtn'

/* FormatBar
   --------------------------------------------------------------------------
   Shows when activeTool === 'format'. Lets the user pick which canvas
   columns to apply formatting to (font size, alignment, bold, wrap),
   and toggle global format options (bold header, banding, freeze header,
   borders, header color).

   State ownership:
   - colorDraft (in-progress custom color picker value) lives INSIDE this
     component because nothing outside reads it.
   - All other state (formatSelectedCols, globalFormat, colFormats) lives
     in AppPage and is passed in. The reset button calls onResetAll which
     AppPage implements as: clear colFormats + reset globalFormat.
   -------------------------------------------------------------------------- */
export default function FormatBar({
  colors,
  dark,
  canvasColumns,
  colFormats,
  formatSelectedCols,
  setFormatSelectedCols,
  globalFormat,
  getFormatValue,
  updateColFormat,
  updateGlobalFormat,
  onResetAll,
  onClose,
}) {
  const { accent, accentDim, raised, border, text, text2, text3 } = colors
  const [colorDraft, setColorDraft] = useState(null)

  const allSelected = formatSelectedCols.length === canvasColumns.length && canvasColumns.length > 0

  function toggleFormatColSelect(canvasId) {
    setFormatSelectedCols(prev => prev.includes(canvasId) ? prev.filter(id => id !== canvasId) : [...prev, canvasId])
  }

  return (
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

        <button onClick={onResetAll} style={{ marginLeft: 4, background: 'none', border: `1px solid ${border}`, borderRadius: 5, padding: '2px 9px', fontSize: 11, color: text3, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>↺ Reset all</button>
        <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 16 }}>✕</button>
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
        {[['left', 'L'], ['center', 'C'], ['right', 'R']].map(([val, lbl]) => (
          <FmtBtn key={val} colors={colors} active={getFormatValue('align') === val} onClick={() => updateColFormat(formatSelectedCols, { align: val })}>{lbl}</FmtBtn>
        ))}

        <div style={{ width: 1, height: 18, background: border, margin: '0 3px' }} />

        {/* Text options */}
        <FmtBtn colors={colors} active={getFormatValue('bold') === true} onClick={() => updateColFormat(formatSelectedCols, { bold: getFormatValue('bold') !== true })} title="Bold cells"><b style={{ fontSize: 13 }}>B</b></FmtBtn>
        <FmtBtn colors={colors} active={getFormatValue('wrap') === true} onClick={() => updateColFormat(formatSelectedCols, { wrap: getFormatValue('wrap') !== true })} title="Wrap text">↵ Wrap</FmtBtn>

        <div style={{ width: 1, height: 18, background: border, margin: '0 3px' }} />

        {/* Global toggles */}
        <FmtBtn colors={colors} active={globalFormat.boldHeader} onClick={() => updateGlobalFormat({ boldHeader: !globalFormat.boldHeader })} title="Make header row bold">Bold header</FmtBtn>
        <FmtBtn colors={colors} active={globalFormat.banding} onClick={() => updateGlobalFormat({ banding: !globalFormat.banding })} title="Alternate row shading (every 2nd row)">▤ Banding</FmtBtn>
        <FmtBtn colors={colors} active={globalFormat.exportAsTable} onClick={() => updateGlobalFormat({ exportAsTable: !globalFormat.exportAsTable })} title="Export with Excel auto-filter / table structure">⊞ As Table</FmtBtn>
        <FmtBtn colors={colors} active={globalFormat.freezeHeader} onClick={() => updateGlobalFormat({ freezeHeader: !globalFormat.freezeHeader })} title="In Excel: header row stays visible when scrolling">❄ Freeze header (XLSX)</FmtBtn>

        <div style={{ width: 1, height: 18, background: border, margin: '0 3px' }} />

        {/* Border — export only */}
        <span style={{ fontSize: 11, color: text3 }}>Cell borders (XLSX)</span>
        {[['none', 'None'], ['thin', 'Thin'], ['medium', 'Medium']].map(([val, lbl]) => (
          <FmtBtn key={val} colors={colors} active={globalFormat.borderStyle === val} onClick={() => updateGlobalFormat({ borderStyle: val })}>{lbl}</FmtBtn>
        ))}

        <div style={{ width: 1, height: 18, background: border, margin: '0 3px' }} />

        {/* Header row color */}
        <span style={{ fontSize: 11, color: text3 }}>Header row color</span>
        {['#5B5FE8', '#1D9E75', '#E8B85B', '#f87171', '#6b7280', '#0f172a'].map(c => (
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
  )
}
