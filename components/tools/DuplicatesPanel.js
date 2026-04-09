'use client'

/* DuplicatesPanel
   --------------------------------------------------------------------------
   Scans canvas columns for duplicate values and highlights them in amber.
   Also lets the user clear the duplicate highlights without re-running.

   The duplicate map (which values to highlight) lives in AppPage because
   the canvas rendering reads it.
   -------------------------------------------------------------------------- */
export default function DuplicatesPanel({ colors, onRun, onClear, onClose }) {
  const { accent, accentDim, border, text2, text3 } = colors

  return (
    <div style={{ background: accentDim, borderBottom: `1px solid ${accent}44`, padding: '10px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
      <span style={{ fontWeight: 600, color: accent }}>Duplicates</span>
      <span style={{ fontSize: 12, color: text2 }}>Scans all canvas columns and highlights duplicate values in amber.</span>
      <button
        onClick={onRun}
        style={{ background: accent, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
      >
        Run
      </button>
      <button
        onClick={onClear}
        style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 6, padding: '5px 10px', fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: text2, cursor: 'pointer' }}
      >
        Clear
      </button>
      <button
        onClick={onClose}
        style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 15 }}
      >
        ✕
      </button>
    </div>
  )
}
