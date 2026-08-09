'use client'

/* SheetToolbar
   --------------------------------------------------------------------------
   Contextual tool rail that appears whenever exactly one table block is
   selected. Sheet-specific tools live here rather than in the global toolbar,
   which stays about the canvas.

   VERTICAL, RIGHT-DOCKED
   A column on the right rather than a second horizontal bar under the main
   toolbar: stacking bars eats vertical space and pushes the canvas down, a
   second centred bar competes with the main toolbar for the same slot, and
   this rail will grow — Simulate, Statistics, Chart, Clean, Formula and
   whatever follows keep fitting down a column, but would overflow a
   horizontal one. Vertically centred and offset below the profile island so
   the two never meet.

   Surface treatment is copied from the other islands rather than reinvented
   (same `${surface}dd` fill, 1px border, 12px radius, same shadow ramp, same
   ds-tbtn control height) so it reads as one family.

   Only Curve fit does anything today. The rest are declared but disabled and
   say so on hover — a disabled control that names what's coming is a roadmap
   the user can read; an absent one is just a missing feature. They are NOT
   clickable no-ops, because a button that appears to work and then does
   nothing is worse than one that's honestly greyed out.
   -------------------------------------------------------------------------- */

export const SHEET_TOOLS = [
  { id: 'crosscheck', label: 'Crosscheck', ready: true,
    hint: 'Fuzzy-match two columns with IDF weighting' },
  { id: 'curvefit',  label: 'Curve fit',  ready: true,
    hint: 'Least-squares fitting with uncertainties and residuals' },
  { id: 'simulate',  label: 'Simulate',   ready: false,
    hint: 'Monte Carlo / GBM fan chart — for data with no fixed governing shape' },
  { id: 'stats',     label: 'Statistics', ready: false,
    hint: 'Descriptives, correlation, hypothesis tests' },
  { id: 'chart',     label: 'Chart',      ready: false,
    hint: 'Plot columns as a chart block' },
  { id: 'clean',     label: 'Clean',      ready: false,
    hint: 'Trim whitespace, fix types, drop duplicate rows' },
  { id: 'formula',   label: 'Formula',    ready: false,
    hint: 'Computed columns and cell formulas' },
]

export default function SheetToolbar({ block, dark, colors, onOpenTool, activeTool }) {
  if (!block) return null
  const { surface, border } = colors

  return (
    <div
      data-island-rail
      data-kbd-zone
      style={{
        position: 'absolute',
        right: 16,
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 96,
        width: 128,
        display: 'flex', flexDirection: 'column', gap: 3,
        padding: 8,
        // Matches the other islands exactly.
        background: `${surface}dd`,
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${border}`, borderRadius: 12,
        boxShadow: `0 4px 24px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.08)'}`,
        fontFamily: 'var(--ds-font-body)',
        animation: 'dsRailIn 0.18s cubic-bezier(.34,1.3,.64,1)',
      }}>
      <style>{`
        @keyframes dsRailIn {
          from { opacity: 0; transform: translateY(-50%) translateX(8px); }
          to   { opacity: 1; transform: translateY(-50%) translateX(0); }
        }
      `}</style>

      <div title={block.name || 'Sheet'} style={{
        fontSize: 9, fontFamily: 'var(--ds-font-mono)', textTransform: 'uppercase',
        letterSpacing: 0.9, color: 'var(--ds-text-3)',
        padding: '2px 6px 6px', borderBottom: `1px solid ${border}`,
        marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {block.name || 'Sheet'}
      </div>

      {SHEET_TOOLS.map(t => (
        <button
          key={t.id}
          disabled={!t.ready}
          onClick={() => t.ready && onOpenTool(t.id)}
          title={t.ready ? t.hint : `${t.hint} — not built yet`}
          className={`ds-tbtn${activeTool === t.id ? ' is-on' : ''}`}
          style={{
            width: '100%',
            height: 30,
            padding: '0 9px',
            fontSize: 11.5,
            justifyContent: 'flex-start',
            opacity: t.ready ? 1 : 0.38,
            cursor: t.ready ? 'pointer' : 'not-allowed',
          }}>
          <span style={{ flex: 1, textAlign: 'left' }}>{t.label}</span>
          {!t.ready && (
            <span style={{
              fontSize: 7.5, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.4,
              color: 'var(--ds-text-3)', border: '1px solid var(--ds-border)',
              borderRadius: 3, padding: '1px 3px', flexShrink: 0,
            }}>SOON</span>
          )}
        </button>
      ))}
    </div>
  )
}
