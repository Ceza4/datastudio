'use client'
import { useState } from 'react'

/* TrimPanel
   --------------------------------------------------------------------------
   Toolbar panel that lets the user strip whitespace and change casing
   across all canvas columns.

   Owns its UI state (trimOptions) internally — the parent only sees the
   final options object via onRun, and only knows whether the panel
   should be open via the parent's activeTool gating.

   Future upgrades (presets, undo history, per-column toggles) can land
   in this file without touching AppPage.
   -------------------------------------------------------------------------- */
export default function TrimPanel({ colors, onRun, onClose }) {
  const { accent, accentDim, raised, border, text, text2, text3 } = colors

  const [trimOptions, setTrimOptions] = useState({ spaces: true, casing: 'none' })

  return (
    <div style={{ background: accentDim, borderBottom: `1px solid ${accent}44`, padding: '10px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
      <span style={{ fontWeight: 600, color: accent }}>Trim & Clean</span>
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: text2, cursor: 'pointer' }}>
        <input type="checkbox" checked={trimOptions.spaces} onChange={e => setTrimOptions(p => ({ ...p, spaces: e.target.checked }))} />
        Strip extra spaces
      </label>
      <label style={{ fontSize: 12, color: text2, display: 'flex', alignItems: 'center', gap: 5 }}>
        Casing:
        <select
          value={trimOptions.casing}
          onChange={e => setTrimOptions(p => ({ ...p, casing: e.target.value }))}
          style={{ background: raised, border: `1px solid ${border}`, borderRadius: 4, padding: '2px 6px', color: text, fontFamily: "'DM Sans',sans-serif", fontSize: 12, cursor: 'pointer' }}
        >
          <option value="none">Keep as-is</option>
          <option value="lower">lowercase</option>
          <option value="upper">UPPERCASE</option>
          <option value="title">Title Case</option>
        </select>
      </label>
      <button
        onClick={() => onRun(trimOptions)}
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
