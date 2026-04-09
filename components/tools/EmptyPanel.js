'use client'

/* EmptyPanel
   --------------------------------------------------------------------------
   Toggles a global "highlight empty cells" mode on the canvas.

   The actual `highlightEmpty` flag lives in AppPage because the canvas
   rendering code reads it. This panel is purely presentational —
   it shows the current state and triggers the toggle callback.
   -------------------------------------------------------------------------- */
export default function EmptyPanel({ colors, isOn, onToggle, onClose }) {
  const { accent, accentDim, text2, text3 } = colors

  return (
    <div style={{ background: accentDim, borderBottom: `1px solid ${accent}44`, padding: '10px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
      <span style={{ fontWeight: 600, color: accent }}>Highlight Empty</span>
      <span style={{ fontSize: 12, color: text2 }}>Empty cells will be highlighted in red. Click any red cell to fill it in.</span>
      <button
        onClick={onToggle}
        style={{ background: accent, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
      >
        {isOn ? 'Turn Off' : 'Turn On'}
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
