'use client'
import Icon from '../ui/Icon'
import { useState, useMemo, useEffect } from 'react'
import { fit, curvePoints, MODELS } from '../../lib/curvefit'
import SendToSheet from './SendToSheet'

/* CurveFitPanel
   --------------------------------------------------------------------------
   The first sheet tool, built to the handoff notes.

   Deliberate choices from that document:
   · Model list is split by tier, and the tier is shown, because Tier 1 is
     exact and Tier 2 can land in the wrong local minimum. The user should
     know which kind of answer they're looking at.
   · Parameters are always shown WITH their standard errors (§3.1). A fitted
     value without an uncertainty is not a result a researcher can use.
   · The residual plot is not optional or hidden behind a tab (§4.3). It is
     the only reliable way to see that a model shape is wrong while R² still
     looks respectable, so it is always on screen next to the fit.
   · Initial guesses are auto-derived from the data and shown, editable.

   Explicitly NOT here yet: parameter bounds/constraints (the lmfit argument
   in §4.3). Multi-start covers most of the same ground; bounds are the next
   thing to add.
   -------------------------------------------------------------------------- */

const NUM = v => { const n = Number(String(v ?? '').replace(/[\s,]/g, '')); return Number.isFinite(n) ? n : null }
const fmt = (v, d = 5) => {
  if (v == null || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a !== 0 && (a < 1e-4 || a >= 1e6)) return v.toExponential(3)
  return Number(v.toFixed(d)).toString()
}

export default function CurveFitPanel({ open, onClose, block, onAddResultTable, tables = [], onWriteToTable }) {
  const [sendOpen, setSendOpen] = useState(false)
  const [sendWhat, setSendWhat] = useState('fitted')
  const columns = useMemo(() => (block?.headers || []).map((h, i) => ({
    idx: i,
    label: h || `Column ${i + 1}`,
    numeric: (block.rows || []).filter(r => NUM(r?.[i]) !== null).length,
  })), [block])

  const [modelId, setModelId] = useState('linear')

  /* Column choice and manual guesses are DERIVED from a session key rather
     than synced by effects. The obvious shape — `useEffect(() => { setXCol(…);
     setYCol(…); setManual(null) }, [open, block.id])` — reads naturally but
     costs a second render pass every time the panel opens or the block
     changes, and React's compiler rejects it. Tagging the stored value with
     the session it belongs to gives the same reset behaviour for free: when
     the tag doesn't match, the default is used. */
  const sessionKey = `${block?.id ?? ''}`

  const numericCols = useMemo(() => columns.filter(c => c.numeric > 1), [columns])
  const defaultX = numericCols[0]?.idx ?? 0
  const defaultY = numericCols[1]?.idx ?? defaultX

  const [colState, setColState] = useState(null)   // { key, x, y }
  const fresh = colState?.key === sessionKey
  const xCol = fresh ? colState.x : defaultX
  const yCol = fresh ? colState.y : defaultY
  const setXCol = v => setColState({ key: sessionKey, x: v, y: yCol })
  const setYCol = v => setColState({ key: sessionKey, x: xCol, y: v })

  // Guesses belong to one model on one block; either changing invalidates them.
  const guessKey = `${sessionKey}:${modelId}`
  const [manualState, setManualState] = useState(null)  // { key, values }
  const manual = manualState?.key === guessKey ? manualState.values : null
  const setManual = values => setManualState(values == null ? null : { key: guessKey, values })

  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  const result = useMemo(() => {
    if (!open || !block) return null
    const xs = (block.rows || []).map(r => r?.[xCol])
    const ys = (block.rows || []).map(r => r?.[yCol])
    return fit(xs, ys, modelId, { initial: manual || undefined })
  }, [open, block, xCol, yCol, modelId, manual])

  if (!open || !block) return null

  const model = MODELS[modelId]
  const tier1 = Object.entries(MODELS).filter(([, m]) => m.tier === 1)
  const tier2 = Object.entries(MODELS).filter(([, m]) => m.tier === 2)

  function pushResults() {
    if (!result?.ok) return
    const headers = ['Parameter', 'Value', 'Std. error']
    const rows = result.paramNames.map((p, i) => [p, fmt(result.params[i]), fmt(result.stderr[i])])
    rows.push([], ['Model', result.label, result.formula])
    rows.push(['R²', fmt(result.r2, 6), ''])
    rows.push(['Reduced χ²', fmt(result.redChi2), ''])
    rows.push(['AIC', fmt(result.aic, 3), ''])
    rows.push(['BIC', fmt(result.bic, 3), ''])
    rows.push(['n', String(result.n), `dof ${result.dof}`])
    onAddResultTable?.({ headers, rows: rows.map(r => (r.length ? r : ['', '', ''])) })
  }

  /* ── plot geometry ── */
  const PW = 420, PH = 190, M = { l: 44, r: 10, t: 10, b: 26 }
  const RH = 88
  let plot = null
  if (result?.ok) {
    const xs = result.xs, ys = result.ys
    const cx0 = Math.min(...xs), cx1 = Math.max(...xs)
    const allY = [...ys, ...result.fitted]
    const cy0 = Math.min(...allY), cy1 = Math.max(...allY)
    const padY = (cy1 - cy0) * 0.08 || 1
    const sx = v => M.l + ((v - cx0) / ((cx1 - cx0) || 1)) * (PW - M.l - M.r)
    const sy = v => PH - M.b - ((v - (cy0 - padY)) / (((cy1 + padY) - (cy0 - padY)) || 1)) * (PH - M.t - M.b)
    const curve = curvePoints(result)
    const rMax = Math.max(...result.residuals.map(Math.abs)) || 1
    const ry = v => RH / 2 - (v / rMax) * (RH / 2 - 10)
    plot = { xs, ys, sx, sy, curve, ry, rMax, cx0, cx1, cy0, cy1 }
  }

  const S = {
    label: { fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--ds-text-3)', marginBottom: 5, display: 'block' },
    select: { width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--ds-border)', background: 'var(--ds-raised)', color: 'var(--ds-text)', fontFamily: 'var(--ds-font-body)', fontSize: 12, outline: 'none' },
  }

  return (
    <>
      <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 890 }} />
      <div className="ds-island" role="dialog" aria-label="Curve fitting"
        style={{
          position: 'fixed', top: 74, left: '50%', transform: 'translateX(-50%)', zIndex: 900,
          width: 940, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 110px)',
          overflowY: 'auto', padding: 16,
        }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ fontFamily: 'var(--ds-font-head)', fontSize: 14, fontWeight: 700 }}>Curve fitting</span>
          <span className="ds-chip">{model.tier === 1 ? 'TIER 1 · EXACT' : 'TIER 2 · ITERATIVE'}</span>
          <span style={{ flex: 1, fontSize: 11, color: 'var(--ds-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {block.name || 'Table'}
          </span>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--ds-text-3)', cursor: 'pointer', fontSize: 15, padding: 2 }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: 16, alignItems: 'start' }}>

          {/* ── left: configuration ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <span style={S.label}>X column</span>
              <select value={xCol} onChange={e => setXCol(+e.target.value)} style={S.select}>
                {columns.map(c => <option key={c.idx} value={c.idx}>{c.label} ({c.numeric} numeric)</option>)}
              </select>
            </div>
            <div>
              <span style={S.label}>Y column</span>
              <select value={yCol} onChange={e => setYCol(+e.target.value)} style={S.select}>
                {columns.map(c => <option key={c.idx} value={c.idx}>{c.label} ({c.numeric} numeric)</option>)}
              </select>
            </div>
            <div>
              <span style={S.label}>Model</span>
              <select value={modelId} onChange={e => setModelId(e.target.value)} style={S.select}>
                <optgroup label="Tier 1 — closed form">
                  {tier1.map(([id, m]) => <option key={id} value={id}>{m.label}</option>)}
                </optgroup>
                <optgroup label="Tier 2 — iterative (Levenberg–Marquardt)">
                  {tier2.map(([id, m]) => <option key={id} value={id}>{m.label}</option>)}
                </optgroup>
              </select>
              <div style={{ marginTop: 6, fontFamily: 'var(--ds-font-mono)', fontSize: 11, color: 'var(--ds-accent)' }}>
                {model.formula}
              </div>
            </div>

            {model.tier === 2 && result?.ok && (
              <div>
                <span style={S.label}>Initial guess</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {model.params.map((p, i) => (
                    <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 66, fontSize: 10.5, color: 'var(--ds-text-3)', fontFamily: 'var(--ds-font-mono)' }}>{p}</span>
                      <input
                        value={manual ? manual[i] : fmt(result.params[i], 4)}
                        onChange={e => {
                          const next = manual ? [...manual] : result.params.map(v => fmt(v, 4))
                          next[i] = e.target.value
                          setManual(next.map(v => Number(v) || 0))
                        }}
                        style={{ ...S.select, padding: '4px 7px', fontSize: 11, fontFamily: 'var(--ds-font-mono)' }} />
                    </div>
                  ))}
                </div>
                <button onClick={() => setManual(null)}
                  style={{ marginTop: 6, background: 'none', border: 'none', color: 'var(--ds-accent)', fontSize: 10.5, cursor: 'pointer', padding: 0, fontFamily: 'var(--ds-font-body)' }}>
                  Reset to auto-derived guess
                </button>
                <div style={{ marginTop: 7, fontSize: 10, color: 'var(--ds-text-3)', lineHeight: 1.5 }}>
                  Auto-derived from the data, then refined by multi-start. A bad guess converges silently to
                  the wrong answer — check the residuals.
                </div>
              </div>
            )}

            <button className="ds-btn ds-btn-primary" disabled={!result?.ok} onClick={pushResults}
              style={{ width: '100%', padding: '9px 0', opacity: result?.ok ? 1 : 0.4 }}>
              Add results to canvas
            </button>

            {/* Or put the fitted values straight into a column, next to the
                data they came from, instead of into a new floating block. */}
            {result?.ok && tables.length > 0 && (
              <div>
                <button onClick={() => setSendOpen(v => !v)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 9px', borderRadius: 7, cursor: 'pointer',
                    border: `1px solid ${sendOpen ? 'var(--ds-accent)' : 'var(--ds-border)'}`,
                    background: sendOpen ? 'var(--ds-accent-dim)' : 'transparent',
                    color: sendOpen ? 'var(--ds-accent)' : 'var(--ds-text-2)',
                    fontFamily: 'var(--ds-font-body)', fontSize: 11.5,
                  }}>
                  <span style={{ flex: 1, textAlign: 'left' }}>Send to a column</span>
                  <Icon name={sendOpen ? 'nav-chevron-down' : 'nav-chevron-right'} size={10} />
                </button>
                {sendOpen && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ marginBottom: 8 }}>
                      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--ds-text-3)', display: 'block', marginBottom: 4 }}>
                        Values
                      </span>
                      <select value={sendWhat} onChange={e => setSendWhat(e.target.value)} style={S.select}>
                        <option value="fitted">Fitted y values</option>
                        <option value="residuals">Residuals</option>
                      </select>
                    </div>
                    <SendToSheet
                      compact
                      tables={tables}
                      columns={[{
                        header: sendWhat === 'fitted' ? `${model.label} fit` : 'Residual',
                        values: (sendWhat === 'fitted' ? result.fitted : result.residuals).map(v => fmt(v, 6)),
                      }]}
                      onWrite={(id, patch) => onWriteToTable?.(id, patch)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── right: fit + diagnostics ── */}
          <div>
            {!result?.ok ? (
              <div style={{ padding: '30px 16px', textAlign: 'center', color: 'var(--ds-text-3)', fontSize: 12.5, border: '1px dashed var(--ds-border)', borderRadius: 8 }}>
                {result?.error || 'Pick two numeric columns to fit.'}
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                  {[
                    ['R²', fmt(result.r2, 5)],
                    ['Reduced χ²', fmt(result.redChi2, 4)],
                    ['AIC', fmt(result.aic, 2)],
                    ['BIC', fmt(result.bic, 2)],
                    ['n', `${result.n}`],
                    ['dof', `${result.dof}`],
                  ].map(([k, v]) => (
                    <div key={k} style={{ flex: '1 0 78px', background: 'var(--ds-raised)', border: '1px solid var(--ds-border)', borderRadius: 7, padding: '6px 9px' }}>
                      <div style={{ fontSize: 9, color: 'var(--ds-text-3)', textTransform: 'uppercase', letterSpacing: 0.6, fontFamily: 'var(--ds-font-mono)' }}>{k}</div>
                      <div style={{ fontSize: 13, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
                    </div>
                  ))}
                </div>

                {/* fit */}
                <svg width="100%" viewBox={`0 0 ${PW} ${PH}`} style={{ background: 'var(--ds-raised)', border: '1px solid var(--ds-border)', borderRadius: 8, display: 'block' }}>
                  <line x1={M.l} y1={PH - M.b} x2={PW - M.r} y2={PH - M.b} stroke="var(--ds-border)" />
                  <line x1={M.l} y1={M.t} x2={M.l} y2={PH - M.b} stroke="var(--ds-border)" />
                  {[plot.cy0, plot.cy1].map((v, i) => (
                    <text key={i} x={M.l - 5} y={plot.sy(v) + 3} textAnchor="end" fill="var(--ds-text-3)" style={{ fontSize: 8, fontFamily: 'var(--ds-font-mono)' }}>{fmt(v, 2)}</text>
                  ))}
                  {[plot.cx0, plot.cx1].map((v, i) => (
                    <text key={i} x={plot.sx(v)} y={PH - M.b + 12} textAnchor={i ? 'end' : 'start'} fill="var(--ds-text-3)" style={{ fontSize: 8, fontFamily: 'var(--ds-font-mono)' }}>{fmt(v, 2)}</text>
                  ))}
                  <path d={plot.curve.map((p, i) => `${i ? 'L' : 'M'} ${plot.sx(p[0])} ${plot.sy(p[1])}`).join(' ')}
                    fill="none" stroke="var(--ds-accent)" strokeWidth="2" />
                  {plot.xs.map((x, i) => (
                    <circle key={i} cx={plot.sx(x)} cy={plot.sy(plot.ys[i])} r="2.6"
                      fill="var(--ds-surface)" stroke="var(--ds-text-2)" strokeWidth="1.2" />
                  ))}
                </svg>

                {/* residuals — always visible, never behind a tab */}
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--ds-text-3)' }}>Residuals</span>
                    <span style={{ fontSize: 10, color: 'var(--ds-text-3)' }}>
                      structure here means the model shape is wrong, whatever R² says
                    </span>
                  </div>
                  <svg width="100%" viewBox={`0 0 ${PW} ${RH}`} style={{ background: 'var(--ds-raised)', border: '1px solid var(--ds-border)', borderRadius: 8, display: 'block' }}>
                    <line x1={M.l} y1={RH / 2} x2={PW - M.r} y2={RH / 2} stroke="var(--ds-accent)" strokeDasharray="4 3" opacity="0.7" />
                    <text x={M.l - 5} y={RH / 2 + 3} textAnchor="end" fill="var(--ds-text-3)" style={{ fontSize: 8, fontFamily: 'var(--ds-font-mono)' }}>0</text>
                    {plot.xs.map((x, i) => (
                      <g key={i}>
                        <line x1={plot.sx(x)} y1={RH / 2} x2={plot.sx(x)} y2={plot.ry(result.residuals[i])} stroke="var(--ds-text-3)" strokeWidth="1" opacity="0.5" />
                        <circle cx={plot.sx(x)} cy={plot.ry(result.residuals[i])} r="2.2" fill="var(--ds-accent)" />
                      </g>
                    ))}
                  </svg>
                </div>

                {/* parameters */}
                <table style={{ width: '100%', marginTop: 10, borderCollapse: 'collapse', fontSize: 11.5 }}>
                  <thead>
                    <tr>
                      {['Parameter', 'Value', 'Std. error', 'Relative'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--ds-text-3)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid var(--ds-border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.paramNames.map((p, i) => {
                      const se = result.stderr[i]
                      const rel = se != null && result.params[i] !== 0 ? Math.abs(se / result.params[i]) * 100 : null
                      const shaky = rel != null && rel > 50
                      return (
                        <tr key={p}>
                          <td style={{ padding: '5px 8px', fontFamily: 'var(--ds-font-mono)', color: 'var(--ds-text-2)' }}>{p}</td>
                          <td style={{ padding: '5px 8px', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(result.params[i])}</td>
                          <td style={{ padding: '5px 8px', fontVariantNumeric: 'tabular-nums', color: 'var(--ds-text-2)' }}>± {fmt(se)}</td>
                          <td style={{ padding: '5px 8px', fontVariantNumeric: 'tabular-nums', color: shaky ? 'var(--ds-red)' : 'var(--ds-text-3)' }}>
                            {rel == null ? '—' : `${rel.toFixed(1)}%`}{shaky ? ' — poorly constrained' : ''}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
