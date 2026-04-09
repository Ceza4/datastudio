'use client'

/* StatsPanel
   --------------------------------------------------------------------------
   Triggers calculation of per-column statistics (count, unique, empty,
   min, max, sum). The actual stat cards live as floating draggable cards
   on the canvas (StatCard component lives in AppPage for now), so this
   panel just kicks off the calculation via onRun and closes itself.
   -------------------------------------------------------------------------- */
export default function StatsPanel({ colors, onRun, onClose }) {
  const { accent, accentDim, text2, text3 } = colors

  return (
    <div style={{ background: accentDim, borderBottom: `1px solid ${accent}44`, padding: '10px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
      <span style={{ fontWeight: 600, color: accent }}>Col Stats</span>
      <span style={{ fontSize: 12, color: text2 }}>Shows count, unique, empty, min, max for each column.</span>
      <button
        onClick={onRun}
        style={{ background: accent, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
      >
        Run
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
