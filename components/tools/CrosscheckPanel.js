'use client'
import Icon from '../ui/Icon'
import { useState, useRef, useEffect, useCallback } from 'react'
import SendToSheet from './SendToSheet'

/* CrosscheckPanel
   --------------------------------------------------------------------------
   Fuzzy-matches one notebook table column ("check list") against another
   ("master list") using /crosscheck.worker.js.

   Replaces the old CrosscheckWizard modal. Differences that matter:

   - It's a floating island, not a modal. No dimming overlay, no scroll lock.
     The notebook stays fully interactive behind it, so you can drag another
     column into a table while the panel is open and it appears in the picker.
   - Draggable by its header, and it remembers where you left it.
   - Progress is real. The worker streams counts as it scores rows, so the bar
     and the tallies move instead of sitting at a fake 70%.
   - Styling comes from the --ds-* tokens in globals.css rather than a colours
     prop, so it themes itself.

   Props:
     open              boolean
     onClose           () => void
     sourceColumns     [{ id, label, tableName, rows }]  flattened table columns
     onAddToNotebook   ({ headers, rows }) => void       creates a results table
   -------------------------------------------------------------------------- */

const SENSITIVITY = {
  lenient: { label: 'Lenient', hint: 'catches more, some false hits', match: 82, maybe: 68 },
  medium:  { label: 'Medium',  hint: 'recommended',                   match: 88, maybe: 74 },
  strict:  { label: 'Strict',  hint: 'only high confidence',          match: 93, maybe: 82 },
}

export default function CrosscheckPanel({ open, onClose, sourceColumns, onAddToNotebook, tables = [], onWriteToTable }) {
  // Which result field to push into a sheet column, and whether that panel is open.
  const [sendOpen, setSendOpen] = useState(false)
  const [sendField, setSendField] = useState('match')
  const [pos, setPos] = useState({ x: null, y: 96 })
  const [step, setStep] = useState(1)
  const [colAId, setColAId] = useState('')
  const [colBId, setColBId] = useState('')
  const [sensitivity, setSensitivity] = useState('medium')
  const [dedupe, setDedupe] = useState(false)
  const [skipBlanks, setSkipBlanks] = useState(true)
  const [progress, setProgress] = useState({ done: 0, total: 0, matched: 0, maybe: 0, unmatched: 0 })
  const [results, setResults] = useState(null)
  const [activeTab, setActiveTab] = useState('matched')
  const [confirmed, setConfirmed] = useState(new Set())
  const [rejected, setRejected] = useState(new Set())
  const [matchedOnly, setMatchedOnly] = useState(true)

  const workerRef = useRef(null)
  const cleanedARef = useRef([])
  const panelRef = useRef(null)

  const colA = sourceColumns.find(c => c.id === colAId) || null
  const colB = sourceColumns.find(c => c.id === colBId) || null

  /* Reset each time it's opened. */
  useEffect(() => {
    if (!open) return
    setStep(1); setColAId(''); setColBId('')
    setSensitivity('medium'); setDedupe(false); setSkipBlanks(true)
    setProgress({ done: 0, total: 0, matched: 0, maybe: 0, unmatched: 0 })
    setResults(null); setConfirmed(new Set()); setRejected(new Set()); setMatchedOnly(true)
  }, [open])

  /* Terminate the worker on unmount so a long run can't outlive the panel. */
  useEffect(() => () => { workerRef.current?.terminate(); workerRef.current = null }, [])

  /* Esc closes. */
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  /* Drag by header. */
  const startDrag = useCallback((e) => {
    if (e.target.closest('button')) return
    e.preventDefault()
    const rect = panelRef.current.getBoundingClientRect()
    const offX = e.clientX - rect.left
    const offY = e.clientY - rect.top
    function onMove(ev) {
      setPos({
        x: Math.max(8, Math.min(window.innerWidth - rect.width - 8, ev.clientX - offX)),
        y: Math.max(8, Math.min(window.innerHeight - 60, ev.clientY - offY)),
      })
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  /* Apply the cleanup toggles before matching. */
  function cleanRows(rows) {
    let out = rows.slice()
    if (skipBlanks) out = out.filter(v => String(v ?? '').trim() !== '')
    if (dedupe) {
      const seen = new Set()
      out = out.filter(v => {
        const k = String(v ?? '').trim().toLowerCase()
        if (seen.has(k)) return false
        seen.add(k); return true
      })
    }
    return out
  }

  const previewA = colA ? cleanRows(colA.rows) : []
  const previewB = colB ? cleanRows(colB.rows) : []
  const removedA = colA ? colA.rows.length - previewA.length : 0
  const removedB = colB ? colB.rows.length - previewB.length : 0

  function run() {
    if (!colA || !colB) return
    const a = cleanRows(colA.rows)
    const b = cleanRows(colB.rows)
    if (!a.length || !b.length) return
    cleanedARef.current = a
    setResults(null)
    setProgress({ done: 0, total: a.length, matched: 0, maybe: 0, unmatched: 0 })
    setStep(3)

    workerRef.current?.terminate()
    const w = new Worker('/crosscheck.worker.js')
    workerRef.current = w
    const { match, maybe } = SENSITIVITY[sensitivity]

    w.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'progress') { setProgress(msg); return }
      if (msg.type !== 'done') return
      const withOriginal = msg.results.map((r, i) => ({ ...r, original: a[i] }))
      setResults({
        matched: withOriginal.filter(r => r.decision === 'matched' || r.decision === 'maybe'),
        unmatched: withOriginal.filter(r => r.decision === 'unmatched'),
        summary: msg.summary,
        colALabel: colA.label,
        colBLabel: colB.label,
      })
      setActiveTab('matched')
      setStep(4)
      w.terminate()
      workerRef.current = null
    }
    w.postMessage({ rowsA: a, rowsB: b, matchThreshold: match, maybeThreshold: maybe })
  }

  /* Final decision for a row, taking the user's confirm/reject into account. */
  function finalDecision(key, baseDecision) {
    if (confirmed.has(key)) return 'matched'
    if (rejected.has(key)) return 'rejected'
    return baseDecision
  }

  /* When matchedOnly is on we emit just the rows that actually resolved to a
     match (including ones you confirmed by hand) instead of echoing back the
     entire input list. On a 1k+ import that's the difference between a usable
     result table and a wall of blanks. */
  function buildResultRows() {
    const byKey = new Map()
    results.matched.forEach(r => byKey.set(String(r.original ?? ''), r))
    const all = cleanedARef.current.map(v => {
      const key = String(v ?? '')
      const r = byKey.get(key)
      const decision = finalDecision(key, r ? r.decision : 'unmatched')
      const keep = decision === 'matched' || decision === 'maybe'
      return [key, keep && r ? r.bestMatch : '', keep && r ? `${r.score}%` : '', decision]
    })
    return matchedOnly ? all.filter(row => row[3] === 'matched' || row[3] === 'maybe') : all
  }

  const outputCount = results ? buildResultRows().length : 0

  /* Both output columns hold company names, so heading them with bare column
     names made the result look like a duplicated column. Qualify each by the
     list it came from, and note the source table too when they differ. */
  function resultHeaders() {
    const a = results.colALabel
    const b = results.colBLabel
    const same = a.trim().toLowerCase() === b.trim().toLowerCase()
    return [
      `${a} (your list)`,
      same ? `${b} (master list)` : `${b} (matched in master)`,
      'Score',
      'Status',
    ]
  }

  function addToNotebook() {
    if (!results) return
    onAddToNotebook({ headers: resultHeaders(), rows: buildResultRows() })
    onClose()
  }

  function exportCSV() {
    if (!results) return
    const esc = v => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    }
    const rows = [resultHeaders(), ...buildResultRows()]
    const csv = rows.map(r => r.map(esc).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `crosscheck-${results.colALabel.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (!open) return null

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  const style = {
    position: 'fixed',
    left: pos.x == null ? 'calc(50% - 210px)' : pos.x,
    top: pos.y,
    width: 420,
    maxHeight: 'calc(100vh - 120px)',
    zIndex: 9000,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  }

  return (
    <div ref={panelRef} className="ds-island fadein" style={style}>

      {/* Header — drag handle */}
      <div
        onMouseDown={startDrag}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
          borderBottom: '1px solid var(--ds-border)', cursor: 'grab', flexShrink: 0,
        }}>
        <span style={{ color: 'var(--ds-accent)', fontSize: 14 }}>⚡</span>
        <span style={{
          fontFamily: 'var(--ds-font-head)', fontSize: 'var(--ds-fs-lg)',
          fontWeight: 800, color: 'var(--ds-text)', letterSpacing: '-0.2px',
        }}>Crosscheck</span>
        {step === 4 && results && (
          <span className="ds-chip">{results.summary.matched} matched</span>
        )}
        <button onClick={onClose} className="ds-btn ds-btn-ghost"
          aria-label="Close Crosscheck"
          style={{ marginLeft: 'auto', padding: '4px 6px', display: 'flex' }}><Icon name="action-delete" size={13} /></button>
      </div>

      {/* Step rail */}
      <div style={{
        display: 'flex', gap: 4, padding: '8px 12px', flexShrink: 0,
        borderBottom: '1px solid var(--ds-border)',
      }}>
        {['Check list', 'Master list', 'Run', 'Results'].map((label, i) => {
          const n = i + 1
          const state = step > n ? 'done' : step === n ? 'active' : 'todo'
          return (
            <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{
                height: 2, borderRadius: 2,
                background: state === 'todo' ? 'var(--ds-border)' : 'var(--ds-accent)',
                opacity: state === 'done' ? 0.5 : 1,
              }} />
              <span style={{
                fontSize: 'var(--ds-fs-xs)',
                color: state === 'active' ? 'var(--ds-accent)' : 'var(--ds-text-3)',
                fontWeight: state === 'active' ? 700 : 400,
              }}>{label}</span>
            </div>
          )
        })}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {(step === 1 || step === 2) && (
          <>
            <div style={{ fontSize: 'var(--ds-fs-md)', color: 'var(--ds-text-2)', lineHeight: 1.6 }}>
              {step === 1
                ? <>Pick the list you want to <strong style={{ color: 'var(--ds-text)' }}>check</strong> — your incoming names.</>
                : <>Pick your <strong style={{ color: 'var(--ds-text)' }}>master list</strong> — the source of truth to match against.</>}
            </div>

            {sourceColumns.length === 0 && (
              <div style={{
                padding: 16, borderRadius: 'var(--ds-radius-md)',
                border: '1px dashed var(--ds-border)', textAlign: 'center',
                fontSize: 'var(--ds-fs-md)', color: 'var(--ds-text-3)', lineHeight: 1.7,
              }}>
                No table columns yet.<br />Drag a column from the sidebar onto the notebook first.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sourceColumns
                .filter(c => step === 1 || c.id !== colAId)
                .map(col => {
                  const selected = step === 1 ? colAId === col.id : colBId === col.id
                  return (
                    <div key={col.id}
                      className={`ds-card${selected ? ' is-selected' : ''}`}
                      onClick={() => step === 1 ? setColAId(col.id) : setColBId(col.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 7, height: 7, borderRadius: 2, flexShrink: 0,
                        background: selected ? 'var(--ds-accent)' : 'var(--ds-text-3)',
                      }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{
                          fontSize: 'var(--ds-fs-lg)', fontWeight: 700,
                          color: selected ? 'var(--ds-accent)' : 'var(--ds-text)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{col.label}</div>
                        <div style={{ fontSize: 'var(--ds-fs-sm)', color: 'var(--ds-text-3)', marginTop: 2 }}>
                          {col.rows.length.toLocaleString()} rows · {col.tableName}
                        </div>
                      </div>
                    </div>
                  )
                })}
            </div>

            {step === 2 && (
              <>
                <div className="ds-label" style={{ marginTop: 4 }}>Sensitivity</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {Object.entries(SENSITIVITY).map(([key, s]) => (
                    <button key={key} onClick={() => setSensitivity(key)}
                      title={s.hint}
                      className={`ds-btn${sensitivity === key ? ' is-active' : ''}`}
                      style={{ flex: 1, flexDirection: 'column', gap: 2, padding: '6px 4px' }}>
                      <span style={{ fontSize: 'var(--ds-fs-md)', fontWeight: 600 }}>{s.label}</span>
                      <span style={{ fontSize: 9, opacity: 0.75 }}>{s.match}%+</span>
                    </button>
                  ))}
                </div>

                <div className="ds-label" style={{ marginTop: 4 }}>Clean up first</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {[
                    { on: skipBlanks, set: setSkipBlanks, label: 'Skip blank cells' },
                    { on: dedupe, set: setDedupe, label: 'Remove duplicate values' },
                  ].map(({ on, set, label }) => (
                    <button key={label} onClick={() => set(v => !v)}
                      className={`ds-btn${on ? ' is-active' : ''}`}
                      style={{ justifyContent: 'flex-start', gap: 8 }}>
                      <span style={{
                        width: 13, height: 13, borderRadius: 3, flexShrink: 0,
                        border: `1.5px solid ${on ? 'var(--ds-accent)' : 'var(--ds-text-3)'}`,
                        background: on ? 'var(--ds-accent)' : 'transparent',
                        color: '#fff', fontSize: 9, display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                      }}>{on ? <Icon name="action-check" size={10} /> : null}</span>
                      {label}
                    </button>
                  ))}
                </div>

                {colA && colB && (
                  <div style={{
                    padding: '8px 10px', borderRadius: 'var(--ds-radius-sm)',
                    background: 'var(--ds-raised)', fontSize: 'var(--ds-fs-sm)',
                    color: 'var(--ds-text-2)', lineHeight: 1.6,
                  }}>
                    Will compare <strong style={{ color: 'var(--ds-text)' }}>{previewA.length.toLocaleString()}</strong> names
                    against <strong style={{ color: 'var(--ds-text)' }}>{previewB.length.toLocaleString()}</strong>.
                    {(removedA + removedB) > 0 && (
                      <> <span style={{ color: 'var(--ds-text-3)' }}>
                        ({(removedA + removedB).toLocaleString()} rows removed by cleanup)
                      </span></>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="ds-spinner" />
              <div>
                <div style={{ fontSize: 'var(--ds-fs-lg)', fontWeight: 700, color: 'var(--ds-text)' }}>
                  Matching…
                </div>
                <div style={{ fontSize: 'var(--ds-fs-md)', color: 'var(--ds-text-3)', marginTop: 2, fontFamily: 'var(--ds-font-mono)' }}>
                  {progress.done.toLocaleString()} / {progress.total.toLocaleString()} names
                </div>
              </div>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: 'var(--ds-raised)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${pct}%`, background: 'var(--ds-accent)',
                borderRadius: 2, transition: 'width 0.2s ease',
              }} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                ['Matched', progress.matched, 'var(--ds-green)'],
                ['Review', progress.maybe, 'var(--ds-amber)'],
                ['Not found', progress.unmatched, 'var(--ds-red)'],
              ].map(([label, val, color]) => (
                <div key={label} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color, fontFamily: 'var(--ds-font-head)' }}>
                    {val.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--ds-text-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 4 && results && (
          <>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                ['Matched', results.summary.matched, 'var(--ds-green)', 'var(--ds-green-bg)'],
                ['Review', results.summary.maybe, 'var(--ds-amber)', 'var(--ds-amber-bg)'],
                ['Not found', results.summary.unmatched, 'var(--ds-red)', 'var(--ds-red-bg)'],
              ].map(([label, val, color, bg]) => (
                <div key={label} style={{
                  flex: 1, background: bg, borderRadius: 'var(--ds-radius-md)',
                  padding: '8px 6px', textAlign: 'center', border: `1px solid ${color}33`,
                }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color, fontFamily: 'var(--ds-font-head)' }}>
                    {val.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 9, color, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {label}
                  </div>
                </div>
              ))}
            </div>

            <button onClick={() => setMatchedOnly(v => !v)}
              className={`ds-btn${matchedOnly ? ' is-active' : ''}`}
              style={{ justifyContent: 'flex-start', gap: 8 }}>
              <span style={{
                width: 13, height: 13, borderRadius: 3, flexShrink: 0,
                border: `1.5px solid ${matchedOnly ? 'var(--ds-accent)' : 'var(--ds-text-3)'}`,
                background: matchedOnly ? 'var(--ds-accent)' : 'transparent',
                color: '#fff', fontSize: 9, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
              }}>{matchedOnly ? <Icon name="action-check" size={10} /> : null}</span>
              Output matched rows only
              <span style={{ marginLeft: 'auto', opacity: 0.7, fontFamily: 'var(--ds-font-mono)' }}>
                {outputCount.toLocaleString()} rows
              </span>
            </button>

            <div style={{ display: 'flex', gap: 5 }}>
              {[
                ['matched', `Matched (${results.matched.length})`],
                ['unmatched', `Not found (${results.unmatched.length})`],
              ].map(([tab, label]) => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`ds-btn${activeTab === tab ? ' is-active' : ''}`}
                  style={{ flex: 1, fontSize: 'var(--ds-fs-sm)' }}>{label}</button>
              ))}
            </div>

            <div style={{
              border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius-md)',
              overflow: 'hidden', maxHeight: 240, overflowY: 'auto',
            }}>
              {activeTab === 'matched' && results.matched.map((r, i) => {
                const key = String(r.original ?? '')
                const isConfirmed = confirmed.has(key)
                const isRejected = rejected.has(key)
                const needsReview = r.decision === 'maybe' && !isConfirmed && !isRejected
                const color = isRejected ? 'var(--ds-red)' : needsReview ? 'var(--ds-amber)' : 'var(--ds-green)'
                return (
                  <div key={i} style={{
                    padding: '7px 10px', borderBottom: '1px solid var(--ds-border)',
                    background: needsReview ? 'var(--ds-amber-bg)' : 'transparent',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{
                        fontSize: 'var(--ds-fs-md)', fontFamily: 'var(--ds-font-mono)',
                        color: isRejected ? 'var(--ds-text-3)' : 'var(--ds-text)',
                        textDecoration: isRejected ? 'line-through' : 'none',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{key}</div>
                      <div style={{
                        fontSize: 'var(--ds-fs-sm)', fontFamily: 'var(--ds-font-mono)',
                        color: 'var(--ds-text-2)', marginTop: 2,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        display: 'flex', alignItems: 'center', gap: 5,
                      }}>
                        <span style={{
                          fontSize: 8, letterSpacing: 0.5, textTransform: 'uppercase',
                          color: 'var(--ds-text-3)', border: '1px solid var(--ds-border)',
                          borderRadius: 3, padding: '0 3px', flexShrink: 0,
                          fontFamily: 'var(--ds-font-body)',
                        }}>master</span>
                        {r.bestMatch}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 'var(--ds-fs-sm)', fontWeight: 700, color,
                      fontFamily: 'var(--ds-font-mono)', flexShrink: 0,
                    }}>{r.score}%</span>
                    {needsReview ? (
                      <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                        <button onClick={() => setConfirmed(p => new Set([...p, key]))}
                          aria-label="Confirm match" title="Confirm match"
                          className="ds-btn" style={{ padding: '3px 6px', color: 'var(--ds-green)' }}><Icon name="cc-confirm" size={12} /></button>
                        <button onClick={() => setRejected(p => new Set([...p, key]))}
                          aria-label="Reject match" title="Reject match"
                          className="ds-btn" style={{ padding: '3px 6px', color: 'var(--ds-red)' }}><Icon name="cc-reject" size={12} /></button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 9, color, fontWeight: 700, flexShrink: 0, width: 46, textAlign: 'right' }}>
                        {isConfirmed ? 'confirmed' : isRejected ? 'rejected' : 'matched'}
                      </span>
                    )}
                  </div>
                )
              })}
              {activeTab === 'unmatched' && results.unmatched.map((r, i) => (
                <div key={i} style={{
                  padding: '7px 10px', borderBottom: '1px solid var(--ds-border)',
                  fontSize: 'var(--ds-fs-md)', fontFamily: 'var(--ds-font-mono)',
                  color: 'var(--ds-text-3)', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{String(r.original ?? '')}</div>
              ))}
              {((activeTab === 'matched' && !results.matched.length) ||
                (activeTab === 'unmatched' && !results.unmatched.length)) && (
                <div style={{ padding: 16, textAlign: 'center', fontSize: 'var(--ds-fs-md)', color: 'var(--ds-text-3)' }}>
                  Nothing here.
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px',
        borderTop: '1px solid var(--ds-border)', flexShrink: 0,
      }}>
        {step === 1 && (
          <>
            <span style={{ fontSize: 'var(--ds-fs-sm)', color: 'var(--ds-text-3)' }}>
              {colA ? colA.label : 'Pick a column'}
            </span>
            <button onClick={() => colAId && setStep(2)} disabled={!colAId}
              className="ds-btn ds-btn-primary" style={{ marginLeft: 'auto' }}>Next →</button>
          </>
        )}
        {step === 2 && (
          <>
            <button onClick={() => setStep(1)} className="ds-btn">← Back</button>
            <button onClick={run} disabled={!colBId || !previewA.length || !previewB.length}
              className="ds-btn ds-btn-primary" style={{ marginLeft: 'auto' }}>Run Crosscheck ⚡</button>
          </>
        )}
        {step === 3 && (
          <button onClick={() => { workerRef.current?.terminate(); workerRef.current = null; setStep(2) }}
            className="ds-btn" style={{ marginLeft: 'auto' }}>Cancel</button>
        )}
        {step === 4 && (
          <>
            <button onClick={() => { setStep(1); setResults(null) }} className="ds-btn">↺ Again</button>
            <button onClick={exportCSV} className="ds-btn" style={{ marginLeft: 'auto' }}>CSV</button>
            {tables.length > 0 && (
              <button onClick={() => setSendOpen(v => !v)}
                className={`ds-btn${sendOpen ? ' is-active' : ''}`}>
                To column
              </button>
            )}
            <button onClick={addToNotebook} className="ds-btn ds-btn-primary"><Icon name="action-check" size={13} /> Add to notebook</button>
          </>
        )}
      </div>

      {/* Send one result field into an existing sheet column.
          "Add to notebook" spawns a fresh four-column results table, which is
          right when you want the whole report — but when you just want the
          matched name or the score sitting beside the data you started from,
          a new floating block means copying it back by hand. */}
      {step === 4 && sendOpen && results && (
        <div style={{ borderTop: '1px solid var(--ds-border)', padding: '12px 16px 14px' }}>
          <div style={{ marginBottom: 9 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--ds-text-3)', display: 'block', marginBottom: 4 }}>
              Which values
            </span>
            <select value={sendField} onChange={e => setSendField(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--ds-border)', background: 'var(--ds-raised)', color: 'var(--ds-text)', fontFamily: 'var(--ds-font-body)', fontSize: 12, outline: 'none' }}>
              <option value="match">Matched name from the master list</option>
              <option value="score">Match score</option>
              <option value="status">Status (matched / maybe / unmatched)</option>
              <option value="source">Your original value</option>
            </select>
            <div style={{ fontSize: 10, color: 'var(--ds-text-3)', marginTop: 5, lineHeight: 1.45 }}>
              Rows follow the same order as the results above
              {matchedOnly ? ' — currently filtered to matches only.' : '.'}
            </div>
          </div>
          <SendToSheet
            compact
            tables={tables}
            columns={[{
              header: { match: 'Matched', score: 'Score', status: 'Status', source: 'Original' }[sendField],
              values: buildResultRows().map(r => r[{ source: 0, match: 1, score: 2, status: 3 }[sendField]]),
            }]}
            onWrite={(id, patch) => onWriteToTable?.(id, patch)}
          />
        </div>
      )}
    </div>
  )
}
