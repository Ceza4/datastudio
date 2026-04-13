'use client'
import { useState, useEffect, useRef, useCallback } from 'react'

/* SciencePlotWizard
   --------------------------------------------------------------------------
   Full-screen modal wizard for scientific data plotting.
   Tabs: Simple | Advanced (Science)

   Simple tab:
     Step 1 — pick X column
     Step 2 — pick Y column(s) (multi-series)
     Step 3 — pick chart type (Scatter, Line, Bar, Area, Histogram)
     Step 4 — preview → "Add to Canvas"

   Advanced tab (Science):
     Same steps + error bar column picker (auto-detects _err/_error/± cols)
     + curve fitting: Linear, Polynomial, Exponential, Gaussian, Power,
       Logarithmic, Sigmoid, Custom formula
     + shows fit parameters + R²

   Canvas output: { id, type:'plot', plotlyData, plotlyLayout, width, height, afterColumnId }
   Parent must handle onAddToCanvas({ plotObj }) and render PlotBlock on canvas.

   Props:
     open            — boolean
     onClose         — () => void
     canvasColumns   — array of { canvasId, label, rows[] }
     onAddToCanvas   — ({ plotObj }) => void
     colors          — design system color object
     dark            — boolean
   -------------------------------------------------------------------------- */

// ── Curve fitting (pure JS, no extra packages) ────────────────────────────

function linspace(a, b, n) {
  const arr = []
  for (let i = 0; i < n; i++) arr.push(a + (b - a) * i / (n - 1))
  return arr
}

function pearsonR2(yActual, yPred) {
  const mean = yActual.reduce((s, v) => s + v, 0) / yActual.length
  const ssTot = yActual.reduce((s, v) => s + (v - mean) ** 2, 0)
  const ssRes = yActual.reduce((s, v, i) => s + (v - yPred[i]) ** 2, 0)
  return ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot)
}

// Levenberg-Marquardt (simplified) for nonlinear fitting
function levenbergMarquardt(f, params0, xs, ys, maxIter = 400) {
  let p = [...params0]
  let lambda = 0.01
  const eps = 1e-6

  function residuals(params) {
    return ys.map((y, i) => y - f(xs[i], params))
  }
  function jacobian(params) {
    return xs.map((x) => {
      return params.map((_, j) => {
        const dp = [...params]
        dp[j] += eps
        return (f(x, dp) - f(x, params)) / eps
      })
    })
  }
  function sumSq(r) { return r.reduce((s, v) => s + v * v, 0) }

  for (let iter = 0; iter < maxIter; iter++) {
    const r = residuals(p)
    const J = jacobian(p)
    const n = p.length
    // JtJ + lambda*I
    const JtJ = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) =>
        J.reduce((s, row) => s + row[i] * row[j], 0)
      )
    )
    const Jtr = Array.from({ length: n }, (_, i) =>
      J.reduce((s, row, k) => s + row[i] * r[k], 0)
    )
    const A = JtJ.map((row, i) => row.map((v, j) => i === j ? v + lambda : v))
    const dp = solveLinear(A, Jtr)
    if (!dp) break
    const pNew = p.map((v, i) => v + dp[i])
    if (sumSq(residuals(pNew)) < sumSq(r)) {
      p = pNew
      lambda *= 0.5
    } else {
      lambda *= 2
    }
    if (dp.reduce((s, v) => s + Math.abs(v), 0) < 1e-9) break
  }
  return p
}

// Gaussian elimination for small systems
function solveLinear(A, b) {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let maxRow = col
    for (let row = col + 1; row < n; row++)
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    [M[col], M[maxRow]] = [M[maxRow], M[col]]
    if (Math.abs(M[col][col]) < 1e-12) return null
    for (let row = col + 1; row < n; row++) {
      const f = M[row][col] / M[col][col]
      for (let k = col; k <= n; k++) M[row][k] -= f * M[col][k]
    }
  }
  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n] / M[i][i]
    for (let k = i - 1; k >= 0; k--) M[k][n] -= M[k][i] * x[i]
  }
  return x
}

const FIT_MODELS = {
  linear: {
    label: 'Linear',
    formula: 'y = a·x + b',
    params: [1, 0],
    fn: (x, [a, b]) => a * x + b,
    paramLabels: ['a (slope)', 'b (intercept)'],
  },
  poly2: {
    label: 'Polynomial (2°)',
    formula: 'y = a·x² + b·x + c',
    params: [1, 1, 0],
    fn: (x, [a, b, c]) => a * x * x + b * x + c,
    paramLabels: ['a', 'b', 'c'],
  },
  poly3: {
    label: 'Polynomial (3°)',
    formula: 'y = a·x³ + b·x² + c·x + d',
    params: [1, 1, 1, 0],
    fn: (x, [a, b, c, d]) => a * x ** 3 + b * x ** 2 + c * x + d,
    paramLabels: ['a', 'b', 'c', 'd'],
  },
  exponential: {
    label: 'Exponential',
    formula: 'y = a·eᵇˣ',
    params: [1, 0.1],
    fn: (x, [a, b]) => a * Math.exp(b * x),
    paramLabels: ['a (amplitude)', 'b (rate)'],
  },
  gaussian: {
    label: 'Gaussian',
    formula: 'y = a·exp(-(x-μ)²/2σ²)',
    params: [1, 0, 1],
    fn: (x, [a, mu, sigma]) => a * Math.exp(-((x - mu) ** 2) / (2 * sigma ** 2)),
    paramLabels: ['a (amplitude)', 'μ (mean)', 'σ (std dev)'],
  },
  power: {
    label: 'Power',
    formula: 'y = a·xᵇ',
    params: [1, 1],
    fn: (x, [a, b]) => a * Math.pow(Math.abs(x), b),
    paramLabels: ['a', 'b (exponent)'],
  },
  logarithmic: {
    label: 'Logarithmic',
    formula: 'y = a·ln(x) + b',
    params: [1, 0],
    fn: (x, [a, b]) => a * Math.log(Math.abs(x) + 1e-9) + b,
    paramLabels: ['a', 'b'],
  },
  sigmoid: {
    label: 'Sigmoid',
    formula: 'y = L / (1 + e^(-k·(x-x₀)))',
    params: [1, 1, 0],
    fn: (x, [L, k, x0]) => L / (1 + Math.exp(-k * (x - x0))),
    paramLabels: ['L (max)', 'k (rate)', 'x₀ (midpoint)'],
  },
}

function fitCurve(modelKey, xs, ys) {
  const model = FIT_MODELS[modelKey]
  if (!modelKey || !model) return null
  try {
    const params = levenbergMarquardt(model.fn, model.params, xs, ys)
    const yPred = xs.map(x => model.fn(x, params))
    const r2 = pearsonR2(ys, yPred)
    return { params, r2, model }
  } catch {
    return null
  }
}

// ── Auto-detect error bar columns ─────────────────────────────────────────

function detectErrorCol(cols, yCol) {
  const label = (yCol?.label || '').toLowerCase()
  return cols.find(c => {
    const cl = c.label.toLowerCase()
    return (
      cl === label + '_err' ||
      cl === label + '_error' ||
      cl === 'err_' + label ||
      cl === 'error_' + label ||
      cl.includes('±') ||
      cl === label + ' error' ||
      cl === label + ' err'
    )
  }) || null
}

// ── Main component ─────────────────────────────────────────────────────────

export default function SciencePlotWizard({
  open,
  onClose,
  canvasColumns,
  onAddToCanvas,
  colors,
  dark,
}) {
  const { surface, raised, border, text, text2, text3, accent, accentDim, green, red, amber } = colors

  // Tab: 'simple' | 'advanced'
  const [tab, setTab] = useState('simple')
  // Step 1–4
  const [step, setStep] = useState(1)
  // Column selections
  const [xColId, setXColId] = useState('')
  const [yColIds, setYColIds] = useState([])
  const [errColId, setErrColId] = useState('none')
  const [autoErrSuggestion, setAutoErrSuggestion] = useState(null)
  // Chart type
  const [chartType, setChartType] = useState('scatter')
  // Fit
  const [fitModel, setFitModel] = useState('none')
  const [fitResult, setFitResult] = useState(null)
  const [fitRunning, setFitRunning] = useState(false)
  // After which column to insert the graph block
  const [afterColId, setAfterColId] = useState('')
  // Preview rendered flag
  const plotDivRef = useRef(null)
  const [plotReady, setPlotReady] = useState(false)

  // Reset on open
  useEffect(() => {
    if (open) {
      setTab('simple')
      setStep(1)
      setXColId('')
      setYColIds([])
      setErrColId('none')
      setAutoErrSuggestion(null)
      setChartType('scatter')
      setFitModel('none')
      setFitResult(null)
      setFitRunning(false)
      setAfterColId('')
      setPlotReady(false)
    }
  }, [open])

  // Auto-detect error col when Y changes
  useEffect(() => {
    if (yColIds.length === 1) {
      const yCol = canvasColumns.find(c => c.canvasId === yColIds[0])
      const suggestion = detectErrorCol(canvasColumns, yCol)
      setAutoErrSuggestion(suggestion || null)
      if (suggestion && errColId === 'none') setErrColId(suggestion.canvasId)
    } else {
      setAutoErrSuggestion(null)
    }
  }, [yColIds, canvasColumns])

  // Render Plotly preview when reaching step 4
  useEffect(() => {
    if (step !== 4 || !plotDivRef.current) return
    setPlotReady(false)

    const xCol = canvasColumns.find(c => c.canvasId === xColId)
    const yCols = yColIds.map(id => canvasColumns.find(c => c.canvasId === id)).filter(Boolean)
    const errCol = errColId !== 'none' ? canvasColumns.find(c => c.canvasId === errColId) : null

    if (!xCol || yCols.length === 0) return

    const xs = xCol.rows.map(v => parseFloat(v)).filter((v, i) => !isNaN(v) && !isNaN(parseFloat(yCols[0]?.rows[i])))
    const validIndices = xCol.rows.map((v, i) => (!isNaN(parseFloat(v)) && yCols.every(yc => !isNaN(parseFloat(yc.rows[i]))) ? i : -1)).filter(i => i !== -1)
    const cleanXs = validIndices.map(i => parseFloat(xCol.rows[i]))

    const COLORS = ['#5B5FE8', '#4ade80', '#f87171', '#E8B85B', '#a78bfa', '#34d399']

    const traces = yCols.map((yCol, ci) => {
      const cleanYs = validIndices.map(i => parseFloat(yCol.rows[i]))
      const errVals = errCol ? validIndices.map(i => Math.abs(parseFloat(errCol.rows[i]) || 0)) : null

      const base = {
        name: yCol.label,
        marker: { color: COLORS[ci % COLORS.length] },
        line: { color: COLORS[ci % COLORS.length], width: 2 },
      }

      if (chartType === 'scatter') return { ...base, type: 'scatter', mode: 'markers', x: cleanXs, y: cleanYs, error_y: errVals ? { type: 'data', array: errVals, visible: true, color: COLORS[ci % COLORS.length] + '99', thickness: 1.5, width: 4 } : undefined }
      if (chartType === 'line') return { ...base, type: 'scatter', mode: 'lines+markers', x: cleanXs, y: cleanYs, error_y: errVals ? { type: 'data', array: errVals, visible: true, color: COLORS[ci % COLORS.length] + '99', thickness: 1.5, width: 4 } : undefined }
      if (chartType === 'bar') return { ...base, type: 'bar', x: cleanXs, y: cleanYs }
      if (chartType === 'area') return { ...base, type: 'scatter', mode: 'lines', fill: 'tozeroy', x: cleanXs, y: cleanYs, fillcolor: COLORS[ci % COLORS.length] + '33' }
      if (chartType === 'histogram') return { ...base, type: 'histogram', x: cleanYs }
      return { ...base, type: 'scatter', mode: 'markers', x: cleanXs, y: cleanYs }
    })

    // Curve fit trace
    let newFitResult = null
    if (tab === 'advanced' && fitModel !== 'none' && yCols.length === 1) {
      setFitRunning(true)
      const cleanYs = validIndices.map(i => parseFloat(yCols[0].rows[i]))
      newFitResult = fitCurve(fitModel, cleanXs, cleanYs)
      setFitResult(newFitResult)
      setFitRunning(false)

      if (newFitResult) {
        const xMin = Math.min(...cleanXs)
        const xMax = Math.max(...cleanXs)
        const fitXs = linspace(xMin, xMax, 200)
        const fitYs = fitXs.map(x => newFitResult.model.fn(x, newFitResult.params))
        traces.push({
          name: `Fit: ${newFitResult.model.label}`,
          type: 'scatter',
          mode: 'lines',
          x: fitXs,
          y: fitYs,
          line: { color: '#f87171', width: 2, dash: 'dash' },
        })
      }
    }

    const layout = {
      paper_bgcolor: 'transparent',
      plot_bgcolor: dark ? '#1A1917' : '#F5F3EE',
      font: { family: "'DM Sans', sans-serif", color: dark ? '#E8E6E1' : '#1A1917', size: 12 },
      xaxis: {
        title: { text: xCol.label },
        gridcolor: dark ? '#2E2D29' : '#D5D1C7',
        linecolor: dark ? '#2E2D29' : '#D5D1C7',
        tickfont: { family: "'DM Mono', monospace", size: 10 },
        zeroline: false,
      },
      yaxis: {
        title: { text: yCols.map(c => c.label).join(', ') },
        gridcolor: dark ? '#2E2D29' : '#D5D1C7',
        linecolor: dark ? '#2E2D29' : '#D5D1C7',
        tickfont: { family: "'DM Mono', monospace", size: 10 },
        zeroline: false,
      },
      legend: { bgcolor: 'transparent', borderwidth: 0 },
      margin: { l: 55, r: 20, t: 20, b: 50 },
    }

    // Plotly is loaded via CDN in the project — access via window.Plotly
    import('plotly.js-dist-min').then(Plotly => {
        Plotly.newPlot(plotDivRef.current, traces, layout, { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['sendDataToCloud', 'lasso2d'] })
        setPlotReady(true)
      })
  }, [step, chartType, fitModel, tab])

  function handleAddToCanvas() {
    const xCol = canvasColumns.find(c => c.canvasId === xColId)
    const yCols = yColIds.map(id => canvasColumns.find(c => c.canvasId === id)).filter(Boolean)
    const errCol = errColId !== 'none' ? canvasColumns.find(c => c.canvasId === errColId) : null

    if (!xCol || yCols.length === 0) return

    const validIndices = xCol.rows.map((v, i) => (!isNaN(parseFloat(v)) && yCols.every(yc => !isNaN(parseFloat(yc.rows[i]))) ? i : -1)).filter(i => i !== -1)
    const cleanXs = validIndices.map(i => parseFloat(xCol.rows[i]))
    const COLORS = ['#5B5FE8', '#4ade80', '#f87171', '#E8B85B', '#a78bfa', '#34d399']

    const traces = yCols.map((yCol, ci) => {
      const cleanYs = validIndices.map(i => parseFloat(yCol.rows[i]))
      const errVals = errCol ? validIndices.map(i => Math.abs(parseFloat(errCol.rows[i]) || 0)) : null
      const base = { name: yCol.label, marker: { color: COLORS[ci % COLORS.length] }, line: { color: COLORS[ci % COLORS.length], width: 2 } }
      if (chartType === 'scatter') return { ...base, type: 'scatter', mode: 'markers', x: cleanXs, y: cleanYs, error_y: errVals ? { type: 'data', array: errVals, visible: true } : undefined }
      if (chartType === 'line') return { ...base, type: 'scatter', mode: 'lines+markers', x: cleanXs, y: cleanYs, error_y: errVals ? { type: 'data', array: errVals, visible: true } : undefined }
      if (chartType === 'bar') return { ...base, type: 'bar', x: cleanXs, y: cleanYs }
      if (chartType === 'area') return { ...base, type: 'scatter', mode: 'lines', fill: 'tozeroy', x: cleanXs, y: cleanYs, fillcolor: COLORS[ci % COLORS.length] + '33' }
      if (chartType === 'histogram') return { ...base, type: 'histogram', x: cleanYs }
      return { ...base, type: 'scatter', mode: 'markers', x: cleanXs, y: cleanYs }
    })

    if (tab === 'advanced' && fitResult) {
      const xMin = Math.min(...cleanXs), xMax = Math.max(...cleanXs)
      const fitXs = linspace(xMin, xMax, 200)
      const fitYs = fitXs.map(x => fitResult.model.fn(x, fitResult.params))
      traces.push({ name: `Fit: ${fitResult.model.label}`, type: 'scatter', mode: 'lines', x: fitXs, y: fitYs, line: { color: '#f87171', width: 2, dash: 'dash' } })
    }

    const layout = {
      paper_bgcolor: 'transparent',
      plot_bgcolor: dark ? '#1A1917' : '#F5F3EE',
      font: { family: "'DM Sans', sans-serif", color: dark ? '#E8E6E1' : '#1A1917', size: 12 },
      xaxis: { title: { text: xCol.label }, gridcolor: dark ? '#2E2D29' : '#D5D1C7', tickfont: { family: "'DM Mono', monospace", size: 10 }, zeroline: false },
      yaxis: { title: { text: yCols.map(c => c.label).join(', ') }, gridcolor: dark ? '#2E2D29' : '#D5D1C7', tickfont: { family: "'DM Mono', monospace", size: 10 }, zeroline: false },
      legend: { bgcolor: 'transparent', borderwidth: 0 },
      margin: { l: 55, r: 20, t: 20, b: 50 },
    }

    onAddToCanvas({
      plotObj: {
        id: `plot_${Date.now()}`,
        type: 'plot',
        plotlyData: traces,
        plotlyLayout: layout,
        width: 600,
        height: 380,
        afterColumnId: afterColId || (canvasColumns[canvasColumns.length - 1]?.canvasId || ''),
        title: `${yCols.map(c => c.label).join(', ')} vs ${xCol.label}`,
        fitResult: fitResult ? { model: fitResult.model.label, params: fitResult.params, r2: fitResult.r2, paramLabels: fitResult.model.paramLabels } : null,
      }
    })
    onClose()
  }

  if (!open) return null

  const xCol = canvasColumns.find(c => c.canvasId === xColId)
  const yCols = yColIds.map(id => canvasColumns.find(c => c.canvasId === id)).filter(Boolean)
  const numCols = canvasColumns.filter(c => {
    const sample = c.rows.find(v => v !== null && v !== undefined && v !== '')
    return !isNaN(parseFloat(sample))
  })

  // ── Styles ──
  const selectStyle = {
    background: raised, border: `1px solid ${border}`, borderRadius: 7,
    color: text, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif",
    fontSize: 13, cursor: 'pointer', width: '100%', outline: 'none',
  }
  const labelStyle = { fontSize: 11, fontWeight: 700, color: text3, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }
  const chipBase = { padding: '6px 14px', borderRadius: 6, border: `1px solid ${border}`, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 500, cursor: 'pointer', transition: 'none' }

  function ColChip({ col }) {
    const active = yColIds.includes(col.canvasId)
    return (
      <div
        onClick={() => setYColIds(prev => active ? prev.filter(id => id !== col.canvasId) : [...prev, col.canvasId])}
        style={{ ...chipBase, background: active ? accentDim : 'transparent', color: active ? accent : text2, border: active ? `1px solid ${accent}44` : `1px solid ${border}` }}
      >
        {col.label}
      </div>
    )
  }

  function ChartTypeBtn({ id, icon, label }) {
    const active = chartType === id
    return (
      <div onClick={() => setChartType(id)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px 16px', borderRadius: 10, border: active ? `1px solid ${accent}` : `1px solid ${border}`, background: active ? accentDim : 'transparent', cursor: 'pointer', minWidth: 72 }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <span style={{ fontSize: 11, color: active ? accent : text2, fontFamily: "'DM Sans',sans-serif", fontWeight: 500 }}>{label}</span>
      </div>
    )
  }

  // ── Step content ──

  function renderStep() {
    if (step === 1) return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ background: accentDim, border: `1px solid ${accent}33`, borderLeft: `4px solid ${accent}`, borderRadius: 8, padding: '14px 18px', fontSize: 13, color: text2 }}>
          Pick the <strong style={{ color: text }}>X axis</strong> — typically your independent variable (time, wavelength, voltage…)
        </div>
        <div>
          <div style={labelStyle}>X Axis Column</div>
          <select style={selectStyle} value={xColId} onChange={e => setXColId(e.target.value)}>
            <option value=''>— select column —</option>
            {canvasColumns.map(c => <option key={c.canvasId} value={c.canvasId}>{c.label}</option>)}
          </select>
        </div>
      </div>
    )

    if (step === 2) return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ background: accentDim, border: `1px solid ${accent}33`, borderLeft: `4px solid ${accent}`, borderRadius: 8, padding: '14px 18px', fontSize: 13, color: text2 }}>
          Pick one or more <strong style={{ color: text }}>Y axis</strong> columns. Multiple selections create multi-series plots.
        </div>
        <div>
          <div style={labelStyle}>Y Axis Column(s)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {canvasColumns.filter(c => c.canvasId !== xColId).map(c => <ColChip key={c.canvasId} col={c} />)}
          </div>
        </div>

        {tab === 'advanced' && yColIds.length > 0 && (
          <div>
            <div style={labelStyle}>Error Bars{autoErrSuggestion ? <span style={{ color: accent, marginLeft: 8, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— auto-detected: {autoErrSuggestion.label}</span> : ''}</div>
            <select style={selectStyle} value={errColId} onChange={e => setErrColId(e.target.value)}>
              <option value='none'>None</option>
              {canvasColumns.filter(c => c.canvasId !== xColId && !yColIds.includes(c.canvasId)).map(c => (
                <option key={c.canvasId} value={c.canvasId}>{c.label}{c.canvasId === autoErrSuggestion?.canvasId ? ' ✓ auto' : ''}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    )

    if (step === 3) return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ background: accentDim, border: `1px solid ${accent}33`, borderLeft: `4px solid ${accent}`, borderRadius: 8, padding: '14px 18px', fontSize: 13, color: text2 }}>
          Choose a <strong style={{ color: text }}>chart type</strong>. For scientific data, Scatter is recommended.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <ChartTypeBtn id='scatter' icon='◎' label='Scatter' />
          <ChartTypeBtn id='line' icon='〜' label='Line' />
          <ChartTypeBtn id='bar' icon='▦' label='Bar' />
          <ChartTypeBtn id='area' icon='◣' label='Area' />
          <ChartTypeBtn id='histogram' icon='⊟' label='Histogram' />
        </div>

        {tab === 'advanced' && (
          <div>
            <div style={labelStyle}>Curve Fitting Model</div>
            <select style={selectStyle} value={fitModel} onChange={e => { setFitModel(e.target.value); setFitResult(null) }}>
              <option value='none'>None — no fit</option>
              {Object.entries(FIT_MODELS).map(([key, m]) => (
                <option key={key} value={key}>{m.label} — {m.formula}</option>
              ))}
            </select>
            {fitModel !== 'none' && (
              <div style={{ marginTop: 10, fontSize: 12, color: text3, fontFamily: "'DM Mono',monospace" }}>
                Formula: {FIT_MODELS[fitModel]?.formula}
              </div>
            )}
          </div>
        )}

        <div>
          <div style={labelStyle}>Place graph after column</div>
          <select style={selectStyle} value={afterColId} onChange={e => setAfterColId(e.target.value)}>
            <option value=''>At end of canvas</option>
            {canvasColumns.map(c => <option key={c.canvasId} value={c.canvasId}>After: {c.label}</option>)}
          </select>
        </div>
      </div>
    )

    if (step === 4) return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Plotly preview */}
        <div style={{ border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden', background: dark ? '#1A1917' : '#F5F3EE', minHeight: 340 }}>
          <div ref={plotDivRef} style={{ width: '100%', height: 340 }} />
          {!plotReady && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: text3, fontSize: 13 }}>
              Rendering…
            </div>
          )}
        </div>

        {/* Fit result summary */}
        {tab === 'advanced' && fitResult && (
          <div style={{ background: dark ? '#0d2a1a' : '#dcfce7', border: `1px solid #4ade8033`, borderLeft: `4px solid #4ade80`, borderRadius: 8, padding: '14px 18px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', marginBottom: 8 }}>
              Fit: {fitResult.model.label} — R² = {fitResult.r2.toFixed(4)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {fitResult.params.map((p, i) => (
                <div key={i} style={{ fontSize: 12, fontFamily: "'DM Mono',monospace", color: text2 }}>
                  {fitResult.model.paramLabels[i]}: <span style={{ color: text }}>{p.toFixed(6)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'advanced' && fitModel !== 'none' && !fitResult && !fitRunning && (
          <div style={{ background: dark ? '#2a0d0d' : '#fee2e2', border: `1px solid #f8717133`, borderLeft: `4px solid #f87171`, borderRadius: 8, padding: '14px 18px', fontSize: 12, color: red }}>
            Fit did not converge. Try a different model or check your data for outliers.
          </div>
        )}

        <div style={{ fontSize: 12, color: text3 }}>
          {yCols.map(c => c.label).join(', ')} vs {xCol?.label} · {chartType} · {canvasColumns.find(c => c.canvasId === xColId)?.rows.filter(v => !isNaN(parseFloat(v))).length} points
        </div>
      </div>
    )
  }

  const canNext =
    (step === 1 && xColId !== '') ||
    (step === 2 && yColIds.length > 0) ||
    (step === 3) ||
    (step === 4)

  const stepLabels = ['X Axis', 'Y Axis', 'Chart Type', 'Preview']

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#00000077', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: 16, width: 720, maxWidth: '95vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '20px 28px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <span style={{ fontSize: 18, fontFamily: "'Syne',sans-serif", fontWeight: 700, color: text }}>Plot</span>
          <div style={{ display: 'flex', gap: 2, marginLeft: 8, background: raised, borderRadius: 8, padding: 3 }}>
            {['simple', 'advanced'].map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setStep(1); setFitModel('none'); setFitResult(null) }}
                style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: tab === t ? surface : 'transparent', color: tab === t ? text : text3, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: tab === t ? 600 : 400, cursor: 'pointer' }}
              >
                {t === 'simple' ? 'Simple' : '⚗ Science'}
              </button>
            ))}
          </div>
          {/* Step indicators */}
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
            {stepLabels.map((label, i) => {
              const n = i + 1
              const done = step > n
              const active = step === n
              return (
                <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: done ? accent : active ? accentDim : raised, border: active ? `2px solid ${accent}` : done ? `2px solid ${accent}` : `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: done || active ? accent : text3 }}>
                    {done ? '✓' : n}
                  </div>
                  {i < stepLabels.length - 1 && <div style={{ width: 16, height: 1, background: border }} />}
                </div>
              )
            })}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 18, marginLeft: 12 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: '24px 28px 12px', overflowY: 'auto' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: text3, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 16 }}>
            Step {step} — {stepLabels[step - 1]}
          </div>
          {renderStep()}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 28px', borderTop: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <button
            onClick={() => step > 1 ? setStep(s => s - 1) : onClose()}
            style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 7, padding: '9px 16px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: text2, cursor: 'pointer' }}
          >
            {step === 1 ? 'Cancel' : '← Back'}
          </button>

          {step < 4 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={!canNext}
              style={{ background: canNext ? accent : raised, color: canNext ? '#fff' : text3, border: 'none', borderRadius: 7, padding: '9px 20px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, cursor: canNext ? 'pointer' : 'not-allowed' }}
            >
              Next →
            </button>
          ) : (
            <button
              onClick={handleAddToCanvas}
              style={{ background: accent, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Add to Canvas
            </button>
          )}
        </div>
      </div>
    </div>
  )
}