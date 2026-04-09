'use client'
import { useState, useRef, useEffect } from 'react'

/* CrosscheckWizard
   --------------------------------------------------------------------------
   3-step modal wizard that fuzzy-matches one canvas column ("check list")
   against another ("master list") using a Web Worker (/crosscheck.worker.js).
   The wizard owns ALL its internal state. The parent only needs to:
     - flip `open` to true to show it
     - call `onClose` when it should hide
     - pass the current `canvasColumns`
     - handle `onAddToCanvas({ afterColumnId, newColumn })` to insert results

   Resetting: every time `open` flips from false to true, the wizard resets
   itself back to step 1 with empty config.
   -------------------------------------------------------------------------- */
export default function CrosscheckWizard({
  open,
  onClose,
  canvasColumns,
  onAddToCanvas,
  colors,
  dark,
}) {
  const { surface, raised, border, text, text2, text3, accent, accentDim, red, green, amber } = colors

  const [config, setConfig] = useState({ colAId: '', colBId: '', threshold: 85 })
  const [running, setRunning] = useState(false)
  const [step, setStep] = useState(1)
  const [liveRows, setLiveRows] = useState([])
  const [results, setResults] = useState(null)
  const [activeTab, setActiveTab] = useState('matched')
  const [confirmed, setConfirmed] = useState(new Set())
  const [rejected, setRejected] = useState(new Set())
  const workerRef = useRef(null)

  /* Reset every time the wizard is re-opened */
  useEffect(() => {
    if (open) {
      setStep(1)
      setLiveRows([])
      setResults(null)
      setConfirmed(new Set())
      setRejected(new Set())
      setConfig({ colAId: '', colBId: '', threshold: 85 })
      setRunning(false)
    }
  }, [open])

  /* Clean up worker when wizard unmounts */
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
    }
  }, [])
function exportResultsCSV() {
    if (!results) return
    const headers = ['Your name', 'Best match', 'Confidence', 'Decision']
    const rows = []
    results.matched.forEach(r => {
      const key = String(r.original ?? '')
      const status = confirmed.has(key) ? 'confirmed' : rejected.has(key) ? 'rejected' : r.decision
      rows.push([String(r.original ?? ''), r.bestMatch || '', r.score, status])
    })
    results.unmatched.forEach(r => {
      rows.push([String(r.original ?? ''), '', '', 'unmatched'])
    })
    // CSV escaping: wrap in quotes, double internal quotes
    const escape = v => {
      const s = String(v ?? '')
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
      return s
    }
    const csv = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `crosscheck-${results.colALabel.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }
  if (!open) return null

  function runCrosscheck() {
    const colA = canvasColumns.find(c => c.canvasId === config.colAId)
    const colB = canvasColumns.find(c => c.canvasId === config.colBId)
    if (!colA || !colB) return
    setRunning(true)
    setStep(3)
    setLiveRows([])
    if (!workerRef.current) workerRef.current = new Worker('/crosscheck.worker.js')
    workerRef.current.onmessage = (e) => {
      const { results: rawResults, summary } = e.data
      const matched = rawResults.map((r, i) => ({ ...r, original: colA.rows[i] })).filter(r => r.decision === 'matched' || r.decision === 'maybe')
      const unmatched = rawResults.map((r, i) => ({ ...r, original: colA.rows[i] })).filter(r => r.decision === 'unmatched')
      setResults({ matched, unmatched, summary, colALabel: colA.label, colBLabel: colB.label })
      setLiveRows(matched.slice(0, 8))
      setRunning(false)
      setStep(4)
    }
    workerRef.current.postMessage({ rowsA: colA.rows, rowsB: colB.rows, threshold: 95, maybeThreshold: config.threshold })
  }

  function handleAddToCanvas() {
    if (!results) return
    const colA = canvasColumns.find(c => c.canvasId === config.colAId)
    if (!colA) return

    const matchMap = {}
    results.matched.forEach(r => {
      if (r.decision === 'matched' || confirmed.has(String(r.original ?? ''))) {
        matchMap[String(r.original ?? '')] = { match: r.bestMatch, score: r.score }
      }
    })

    const ts = Date.now()
    const statusRows = colA.rows.map(v => {
      const key = String(v ?? '')
      if (matchMap[key]) return matchMap[key].match
      if (rejected.has(key)) return '✕ rejected'
      return ''
    })

    const newColumn = {
      canvasId: `cc_${ts}`,
      colId: `cc_${ts}`,
      label: `${results.colALabel} — matched`,
      fileName: 'Crosscheck',
      sheetName: '',
      rows: statusRows,
    }

    onAddToCanvas({ afterColumnId: config.colAId, newColumn })
  }

  return (
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: '#00000077', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans',sans-serif" }}
    >
      <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: 16, width: 720, maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '20px 28px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 18, color: accent }}>⚡</span>
          <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 17, fontWeight: 800, color: accent, letterSpacing: '-0.3px' }}>Crosscheck</span>
          <span style={{ fontSize: 12, color: text3, marginLeft: 4 }}>Fuzzy match company names across two lists</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '2px 6px' }}
            onMouseEnter={e => e.currentTarget.style.color = red} onMouseLeave={e => e.currentTarget.style.color = text3}>✕</button>
        </div>

        {/* Step bar */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '18px 28px 0', gap: 0, flexShrink: 0 }}>
          {[['1', 'Your check list'], ['2', 'Master list'], ['3', 'Running'], ['4', 'Results']].map(([num, label], i) => {
            const n = i + 1
            const isDone = step > n
            const isActive = step === n
            return (
              <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 0, flex: n < 4 ? 1 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: isDone || isActive ? accent : raised, border: `1px solid ${isDone || isActive ? accent : border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: isDone || isActive ? '#fff' : text3, outline: isActive ? `3px solid ${accentDim}` : 'none', flexShrink: 0 }}>
                    {isDone ? '✓' : num}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: isActive ? 600 : 400, color: isActive ? text : isDone ? text2 : text3, whiteSpace: 'nowrap' }}>{label}</span>
                </div>
                {n < 4 && <div style={{ flex: 1, height: 1, background: border, margin: '0 12px' }} />}
              </div>
            )
          })}
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: '20px 28px 8px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Step 1 — Pick check list */}
          {step === 1 && (
            <>
              <div style={{ background: accentDim, border: `1px solid ${accent}33`, borderLeft: `4px solid ${accent}`, borderRadius: 8, padding: '14px 18px' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: accent, marginBottom: 5 }}>Which list do you want to check?</div>
                <div style={{ fontSize: 12, color: text2, lineHeight: 1.7 }}>
                  This is your <strong style={{ color: text }}>incoming list</strong> — the names you're not sure about. For example: a list of event exhibitors, new leads, or contacts from a trade show. These are the names Crosscheck will try to find inside your master list.
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {canvasColumns.map(col => {
                  const sel = config.colAId === col.canvasId
                  return (
                    <div key={col.canvasId} onClick={() => setConfig(p => ({ ...p, colAId: col.canvasId }))}
                      style={{ border: `1.5px solid ${sel ? accent : border}`, borderRadius: 10, padding: '14px 16px', cursor: 'pointer', background: sel ? accentDim : raised, transition: 'all 0.12s' }}
                      onMouseEnter={e => { if (!sel) e.currentTarget.style.borderColor = accent + '66' }}
                      onMouseLeave={e => { if (!sel) e.currentTarget.style.borderColor = border }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: sel ? accent : text3, marginTop: 4, flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: sel ? accent : text, fontFamily: "'DM Sans',sans-serif" }}>{col.label}</div>
                          <div style={{ fontSize: 11, color: text3, marginTop: 3 }}>{col.rows.length.toLocaleString()} rows · {col.fileName}</div>
                          {sel && <div style={{ fontSize: 10, color: accent, fontWeight: 700, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>✓ selected as check list</div>}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {canvasColumns.length === 0 && <div style={{ fontSize: 13, color: text3, textAlign: 'center', padding: '20px 0' }}>No columns on canvas yet — drag columns from the sidebar first.</div>}
            </>
          )}

          {/* Step 2 — Pick master list */}
          {step === 2 && (
            <>
              <div style={{ background: dark ? '#0d2a1a' : '#dcfce7', border: `1px solid #4ade8033`, borderLeft: `4px solid #4ade80`, borderRadius: 8, padding: '14px 18px' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: green, marginBottom: 5 }}>Which is your master list?</div>
                <div style={{ fontSize: 12, color: text2, lineHeight: 1.7 }}>
                  This is your <strong style={{ color: text }}>source of truth</strong> — your CRM export, your account database, your existing client list. Crosscheck will search through every name here to find the closest match to each name in your check list.
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {canvasColumns.filter(c => c.canvasId !== config.colAId).map(col => {
                  const sel = config.colBId === col.canvasId
                  return (
                    <div key={col.canvasId} onClick={() => setConfig(p => ({ ...p, colBId: col.canvasId }))}
                      style={{ border: `1.5px solid ${sel ? green : border}`, borderRadius: 10, padding: '14px 16px', cursor: 'pointer', background: sel ? (dark ? '#0d2a1a' : '#dcfce7') : raised, transition: 'all 0.12s' }}
                      onMouseEnter={e => { if (!sel) e.currentTarget.style.borderColor = green + '66' }}
                      onMouseLeave={e => { if (!sel) e.currentTarget.style.borderColor = border }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: sel ? green : text3, marginTop: 4, flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: sel ? green : text }}>{col.label}</div>
                          <div style={{ fontSize: 11, color: text3, marginTop: 3 }}>{col.rows.length.toLocaleString()} rows · {col.fileName}</div>
                          {sel && <div style={{ fontSize: 10, color: green, fontWeight: 700, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>✓ selected as master list</div>}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                <span style={{ fontSize: 12, color: text3 }}>Sensitivity:</span>
                {[[75, 'Lenient — catches more'], [85, 'Medium — recommended'], [90, 'Strict — high confidence only']].map(([val, lbl]) => (
                  <button key={val} onClick={() => setConfig(p => ({ ...p, threshold: val }))}
                    style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${config.threshold === val ? accent : border}`, background: config.threshold === val ? accentDim : 'transparent', color: config.threshold === val ? accent : text2, fontFamily: "'DM Sans',sans-serif", fontSize: 11, cursor: 'pointer' }}>
                    {lbl}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Step 3 — Running */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: text }}>Finding matches...</div>
                  <div style={{ fontSize: 12, color: text3, marginTop: 2 }}>{liveRows.length} matches found so far</div>
                </div>
                <div style={{ width: 32, height: 32, borderRadius: '50%', border: `2px solid ${accent}`, borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
              </div>
              <div style={{ height: 4, borderRadius: 2, background: raised, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: accent, borderRadius: 2, width: running ? '70%' : '100%', transition: 'width 2s ease' }} />
              </div>
              <div style={{ border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden', maxHeight: 260, overflowY: 'auto' }}>
                <div style={{ display: 'flex', background: raised, borderBottom: `1px solid ${border}`, padding: '6px 0' }}>
                  <div style={{ flex: 2, padding: '0 14px', fontSize: 10, fontWeight: 700, color: text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Your name</div>
                  <div style={{ flex: 2, padding: '0 14px', fontSize: 10, fontWeight: 700, color: text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Match found</div>
                  <div style={{ flex: 1, padding: '0 14px', fontSize: 10, fontWeight: 700, color: text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Confidence</div>
                </div>
                {liveRows.map((r, i) => {
                  const isReview = r.decision === 'maybe'
                  const scoreColor = isReview ? amber : green
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${border}22`, background: isReview ? (dark ? '#2a1f0d33' : '#fef3c755') : 'transparent' }}>
                      <div style={{ flex: 2, padding: '8px 14px', fontSize: 12, color: text, fontFamily: "'DM Mono',monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(r.original ?? '')}</div>
                      <div style={{ flex: 2, padding: '8px 14px', fontSize: 12, color: text2, fontFamily: "'DM Mono',monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.bestMatch}</div>
                      <div style={{ flex: 1, padding: '8px 14px' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: scoreColor, fontFamily: "'DM Mono',monospace" }}>{r.score}%</div>
                        <div style={{ height: 3, borderRadius: 2, background: raised, marginTop: 3, width: 48, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${r.score}%`, background: scoreColor, borderRadius: 2 }} />
                        </div>
                      </div>
                    </div>
                  )
                })}
                {liveRows.length === 0 && <div style={{ padding: '20px', textAlign: 'center', fontSize: 12, color: text3 }}>Starting...</div>}
              </div>
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            </div>
          )}

          {/* Step 4 — Results */}
          {step === 4 && results && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                {[
                  { label: 'Matched', value: results.summary.matched, color: green, bg: dark ? '#0d2a1a' : '#dcfce7' },
                  { label: 'Need review', value: results.summary.maybe, color: amber, bg: dark ? '#2a1f0d' : '#fef3c7' },
                  { label: 'Not found', value: results.summary.unmatched, color: red, bg: dark ? '#2a0d0d' : '#fee2e2' },
                ].map(({ label, value, color, bg }) => (
                  <div key={label} style={{ flex: 1, background: bg, borderRadius: 10, padding: '12px 16px', textAlign: 'center', border: `1px solid ${color}33` }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color, fontFamily: "'Syne',sans-serif" }}>{value.toLocaleString()}</div>
                    <div style={{ fontSize: 11, color, marginTop: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[['matched', `Matched & review (${results.matched.length})`], ['unmatched', `Not found (${results.unmatched.length})`]].map(([tab, label]) => (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    style={{ padding: '6px 14px', borderRadius: 6, border: `1px solid ${activeTab === tab ? accent : border}`, background: activeTab === tab ? accentDim : 'transparent', color: activeTab === tab ? accent : text2, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: activeTab === tab ? 600 : 400, cursor: 'pointer' }}>
                    {label}
                  </button>
                ))}
              </div>
              <div style={{ border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden', maxHeight: 260, overflowY: 'auto' }}>
                <div style={{ display: 'flex', background: raised, borderBottom: `1px solid ${border}`, padding: '6px 0', position: 'sticky', top: 0 }}>
                  <div style={{ flex: 2, padding: '0 14px', fontSize: 10, fontWeight: 700, color: text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Your name</div>
                  {activeTab === 'matched' && <div style={{ flex: 2, padding: '0 14px', fontSize: 10, fontWeight: 700, color: text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Best match</div>}
                  {activeTab === 'matched' && <div style={{ flex: 1, padding: '0 14px', fontSize: 10, fontWeight: 700, color: text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Confidence</div>}
                  {activeTab === 'matched' && <div style={{ width: 110, padding: '0 14px', fontSize: 10, fontWeight: 700, color: text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Status</div>}
                </div>
                {activeTab === 'matched' && results.matched.map((r, i) => {
                  const isReview = r.decision === 'maybe'
                  const key = String(r.original ?? '')
                  const isConfirmed = confirmed.has(key)
                  const isRejected = rejected.has(key)
                  const scoreColor = isConfirmed ? green : isReview ? amber : green
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${border}22`, background: isRejected ? (dark ? '#2a0d0d55' : '#fee2e255') : isReview && !isConfirmed ? (dark ? '#2a1f0d33' : '#fef3c755') : 'transparent' }}>
                      <div style={{ flex: 2, padding: '8px 14px', fontSize: 12, color: isRejected ? text3 : text, fontFamily: "'DM Mono',monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: isRejected ? 'line-through' : 'none' }}>{String(r.original ?? '')}</div>
                      <div style={{ flex: 2, padding: '8px 14px', fontSize: 12, color: text2, fontFamily: "'DM Mono',monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.bestMatch}</div>
                      <div style={{ flex: 1, padding: '8px 14px' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: scoreColor, fontFamily: "'DM Mono',monospace" }}>{r.score}%</div>
                        <div style={{ height: 3, borderRadius: 2, background: raised, marginTop: 3, width: 48, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${r.score}%`, background: scoreColor, borderRadius: 2 }} />
                        </div>
                      </div>
                      <div style={{ width: 110, padding: '8px 14px', display: 'flex', gap: 5, alignItems: 'center' }}>
                        {isReview && !isConfirmed && !isRejected ? (
                          <>
                            <button onClick={() => setConfirmed(prev => new Set([...prev, key]))}
                              style={{ background: dark ? '#0d2a1a' : '#dcfce7', border: `1px solid ${green}44`, borderRadius: 4, color: green, fontSize: 11, padding: '2px 7px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}>✓ Yes</button>
                            <button onClick={() => setRejected(prev => new Set([...prev, key]))}
                              style={{ background: dark ? '#2a0d0d' : '#fee2e2', border: `1px solid ${red}44`, borderRadius: 4, color: red, fontSize: 11, padding: '2px 7px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>✕</button>
                          </>
                        ) : isConfirmed ? (
                          <span style={{ fontSize: 10, color: green, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3 }}>✓ confirmed</span>
                        ) : isRejected ? (
                          <span style={{ fontSize: 10, color: red, fontWeight: 700 }}>✕ rejected</span>
                        ) : (
                          <span style={{ fontSize: 10, color: green, fontWeight: 700, background: dark ? '#0d2a1a' : '#dcfce7', padding: '2px 7px', borderRadius: 4 }}>matched</span>
                        )}
                      </div>
                    </div>
                  )
                })}
                {activeTab === 'unmatched' && results.unmatched.map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${border}22` }}>
                    <div style={{ flex: 1, padding: '8px 14px', fontSize: 12, color: text3, fontFamily: "'DM Mono',monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(r.original ?? '')}</div>
                    <div style={{ padding: '8px 14px' }}><span style={{ fontSize: 10, color: red, fontWeight: 700, background: dark ? '#2a0d0d' : '#fee2e2', padding: '2px 7px', borderRadius: 4 }}>not found</span></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 28px', borderTop: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          {step === 1 && (
            <>
              <span style={{ fontSize: 11, color: text3 }}>Step 1 of 3</span>
              <button onClick={() => { if (config.colAId) setStep(2) }}
                disabled={!config.colAId}
                style={{ background: accent, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, cursor: config.colAId ? 'pointer' : 'default', opacity: config.colAId ? 1 : 0.4 }}>
                Next — pick master list →
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button onClick={() => setStep(1)} style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 7, padding: '9px 16px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: text2, cursor: 'pointer' }}>← Back</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: text3 }}>
                  Checking <strong style={{ color: text }}>{canvasColumns.find(c => c.canvasId === config.colAId)?.label}</strong> against <strong style={{ color: text }}>{config.colBId ? canvasColumns.find(c => c.canvasId === config.colBId)?.label : '—'}</strong>
                </span>
                <button onClick={runCrosscheck} disabled={!config.colBId}
                  style={{ background: accent, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, cursor: config.colBId ? 'pointer' : 'default', opacity: config.colBId ? 1 : 0.4 }}>
                  Run Crosscheck ⚡
                </button>
              </div>
            </>
          )}
          {step === 3 && (
            <span style={{ fontSize: 12, color: text3, width: '100%', textAlign: 'center' }}>Matching in progress — please wait...</span>
          )}
          {step === 4 && (
            <>
              <button onClick={() => { setStep(1); setResults(null); setLiveRows([]); setConfig({ colAId: '', colBId: '', threshold: 85 }) }}
                style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 7, padding: '9px 16px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: text2, cursor: 'pointer' }}>← Start over</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={exportResultsCSV} style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 7, padding: '9px 16px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: text2, cursor: 'pointer' }}>Export CSV</button>
                <button onClick={handleAddToCanvas}
                  style={{ background: accent, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Add to canvas ✓
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
