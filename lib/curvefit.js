/*
  lib/curvefit.js
  --------------------------------------------------------------------------
  Least-squares curve fitting, implemented per the handoff notes.

  The handoff proposes a Python/scipy compute core. That core doesn't exist
  yet, and blocking the first sheet tool on standing one up would mean shipping
  a mock. Both tiers described in the notes are implementable directly in JS,
  so this is the real thing — same maths scipy runs, same outputs researchers
  need (parameters WITH uncertainties, R², reduced chi-square, residuals,
  AIC/BIC).

  TIER 1 — linear least squares (handoff §2.2)
    Models linear in their PARAMETERS: straight lines and polynomials. Solved
    in closed form from the normal equations. No initial guess, no iteration,
    no local minima. Equivalent to numpy.polyfit.

  TIER 2 — nonlinear least squares (handoff §2.3)
    Exponential, power law, Gaussian, sigmoid, sinusoid. Solved with
    Levenberg-Marquardt, the same algorithm scipy.optimize.curve_fit uses.
    LM interpolates between Gauss-Newton (fast near the optimum) and gradient
    descent (safe far from it) via a damping term that adapts each step.

  THE INITIAL-GUESS PROBLEM (handoff §4)
    Flagged in the notes as the hard part, and it is: LM converges cleanly to
    the WRONG answer from a bad start and reports no error. Three mitigations
    from §4.3 are implemented:
      · data-derived starting guesses per model (see GUESS below)
      · linearise-first for exponential and power law — fit log-space in closed
        form to get a sound starting rate, then refine nonlinearly
      · multi-start — perturb the guess and re-run, keep the lowest SSE
    Bounds/constraints (the lmfit argument) are NOT implemented; that's the
    remaining gap versus the handoff.

  Always read the residual plot. §4.1 is right that a wrong-valley fit looks
  perfectly healthy in the parameter table.
  -------------------------------------------------------------------------- */

/* ── small dense linear algebra ──────────────────────────────────────── */

/** Solve A·x = b by Gauss-Jordan with partial pivoting. A is n×n, b is n. */
function solve(A, b) {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    if (Math.abs(M[piv][col]) < 1e-14) return null   // singular
    ;[M[col], M[piv]] = [M[piv], M[col]]
    const d = M[col][col]
    for (let c = col; c <= n; c++) M[col][c] /= d
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = M[r][col]
      if (f === 0) continue
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
    }
  }
  return M.map(row => row[n])
}

/** Invert an n×n matrix via Gauss-Jordan. Used for the covariance matrix. */
function invert(A) {
  const n = A.length
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    if (Math.abs(M[piv][col]) < 1e-14) return null
    ;[M[col], M[piv]] = [M[piv], M[col]]
    const d = M[col][col]
    for (let c = 0; c < 2 * n; c++) M[col][c] /= d
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = M[r][col]
      if (f === 0) continue
      for (let c = 0; c < 2 * n; c++) M[r][c] -= f * M[col][c]
    }
  }
  return M.map(row => row.slice(n))
}

/* ── model definitions ───────────────────────────────────────────────── */

export const MODELS = {
  linear: {
    label: 'Linear', tier: 1, degree: 1,
    params: ['intercept', 'slope'],
    formula: 'y = a + b·x',
  },
  poly2: { label: 'Quadratic', tier: 1, degree: 2, params: ['a', 'b', 'c'], formula: 'y = a + b·x + c·x²' },
  poly3: { label: 'Cubic', tier: 1, degree: 3, params: ['a', 'b', 'c', 'd'], formula: 'y = a + b·x + c·x² + d·x³' },
  poly4: { label: 'Quartic', tier: 1, degree: 4, params: ['a', 'b', 'c', 'd', 'e'], formula: 'y = Σ aᵢ·xⁱ' },

  exponential: {
    label: 'Exponential', tier: 2, params: ['a', 'b'],
    formula: 'y = a·e^(b·x)',
    fn: (x, [a, b]) => a * Math.exp(b * x),
  },
  power: {
    label: 'Power law', tier: 2, params: ['a', 'b'],
    formula: 'y = a·x^b',
    fn: (x, [a, b]) => a * Math.pow(Math.max(x, 1e-12), b),
  },
  gaussian: {
    label: 'Gaussian', tier: 2, params: ['amplitude', 'centre', 'width'],
    formula: 'y = A·exp(−(x−μ)² / 2σ²)',
    fn: (x, [A, mu, sig]) => A * Math.exp(-((x - mu) ** 2) / (2 * Math.max(sig, 1e-9) ** 2)),
  },
  sigmoid: {
    label: 'Sigmoid', tier: 2, params: ['L', 'k', 'x0'],
    formula: 'y = L / (1 + e^(−k(x−x₀)))',
    fn: (x, [L, k, x0]) => L / (1 + Math.exp(-k * (x - x0))),
  },
  sinusoid: {
    label: 'Sinusoidal', tier: 2, params: ['amplitude', 'frequency', 'phase', 'offset'],
    formula: 'y = A·sin(ω·x + φ) + c',
    fn: (x, [A, w, p, c]) => A * Math.sin(w * x + p) + c,
  },
}

/* ── data-derived initial guesses (handoff §4.3) ─────────────────────── */

function linearFitRaw(xs, ys) {
  const n = xs.length
  const sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0)
  const sxx = xs.reduce((a, b) => a + b * b, 0), sxy = xs.reduce((a, b, i) => a + b * ys[i], 0)
  const den = n * sxx - sx * sx
  if (Math.abs(den) < 1e-14) return [sy / n, 0]
  return [(sy * sxx - sx * sxy) / den, (n * sxy - sx * sy) / den]
}

function GUESS(model, xs, ys) {
  const n = xs.length
  const xMin = Math.min(...xs), xMax = Math.max(...xs)
  const yMin = Math.min(...ys), yMax = Math.max(...ys)
  const span = xMax - xMin || 1
  const iMax = ys.indexOf(yMax)

  switch (model) {
    case 'exponential': {
      // Linearise: log(y) = log(a) + b·x  — closed form, then refine.
      const pos = xs.map((x, i) => [x, ys[i]]).filter(([, y]) => y > 0)
      if (pos.length >= 2) {
        const [la, b] = linearFitRaw(pos.map(p => p[0]), pos.map(p => Math.log(p[1])))
        return [Math.exp(la), b]
      }
      return [yMax || 1, 0.1]
    }
    case 'power': {
      // Linearise in log-log space.
      const pos = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => x > 0 && y > 0)
      if (pos.length >= 2) {
        const [la, b] = linearFitRaw(pos.map(p => Math.log(p[0])), pos.map(p => Math.log(p[1])))
        return [Math.exp(la), b]
      }
      return [1, 1]
    }
    case 'gaussian':
      // Amplitude from the peak, centre from where the peak sits, width from
      // a rough spread — exactly the heuristic in §4.3.
      return [yMax - yMin || 1, xs[iMax] ?? (xMin + span / 2), span / 6 || 1]
    case 'sigmoid':
      return [yMax || 1, 4 / span, xMin + span / 2]
    case 'sinusoid': {
      const mean = ys.reduce((a, b) => a + b, 0) / n
      // Frequency is the catastrophic one (§4.2) — estimate it from mean
      // crossings rather than guessing, since LM cannot find a period it
      // didn't start near.
      let crossings = 0
      for (let i = 1; i < n; i++) if ((ys[i - 1] - mean) * (ys[i] - mean) < 0) crossings++
      const periods = Math.max(crossings / 2, 0.5)
      return [(yMax - yMin) / 2 || 1, (2 * Math.PI * periods) / span, 0, mean]
    }
    default:
      return [1, 1]
  }
}

/* ── Tier 1: polynomial least squares ────────────────────────────────── */

function fitPolynomial(xs, ys, degree, weights) {
  const m = degree + 1
  const w = weights || xs.map(() => 1)
  const A = Array.from({ length: m }, () => new Array(m).fill(0))
  const b = new Array(m).fill(0)
  for (let i = 0; i < xs.length; i++) {
    const pw = []
    for (let p = 0; p < 2 * m; p++) pw[p] = p === 0 ? 1 : pw[p - 1] * xs[i]
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < m; c++) A[r][c] += w[i] * pw[r + c]
      b[r] += w[i] * pw[r] * ys[i]
    }
  }
  const p = solve(A, b)
  if (!p) return null
  return { params: p, normalMatrix: A }
}

/* ── Tier 2: Levenberg-Marquardt ─────────────────────────────────────── */

function lm(fn, xs, ys, p0, weights, { maxIter = 240, tol = 1e-12 } = {}) {
  const w = weights || xs.map(() => 1)
  const n = xs.length, m = p0.length
  let p = [...p0]
  let lambda = 1e-3

  const sse = pp => {
    let s = 0
    for (let i = 0; i < n; i++) {
      const r = ys[i] - fn(xs[i], pp)
      if (!Number.isFinite(r)) return Infinity
      s += w[i] * r * r
    }
    return s
  }

  let cur = sse(p)
  if (!Number.isFinite(cur)) return null

  // Hoisted: the last JᵀWJ is what the covariance matrix (and therefore every
  // parameter standard error) is derived from, so it has to outlive the loop.
  let JtJ = null

  for (let iter = 0; iter < maxIter; iter++) {
    // Numerical Jacobian — central differences, step scaled per parameter.
    const J = Array.from({ length: n }, () => new Array(m).fill(0))
    for (let k = 0; k < m; k++) {
      const h = Math.max(1e-7, Math.abs(p[k]) * 1e-6)
      const up = [...p]; up[k] += h
      const dn = [...p]; dn[k] -= h
      for (let i = 0; i < n; i++) {
        const a = fn(xs[i], up), bq = fn(xs[i], dn)
        J[i][k] = Number.isFinite(a) && Number.isFinite(bq) ? (a - bq) / (2 * h) : 0
      }
    }

    // Normal equations: (JᵀWJ + λ·diag)·δ = JᵀW·r
    JtJ = Array.from({ length: m }, () => new Array(m).fill(0))
    const Jtr = new Array(m).fill(0)
    for (let i = 0; i < n; i++) {
      const r = ys[i] - fn(xs[i], p)
      if (!Number.isFinite(r)) continue
      for (let a = 0; a < m; a++) {
        Jtr[a] += w[i] * J[i][a] * r
        for (let bq = 0; bq < m; bq++) JtJ[a][bq] += w[i] * J[i][a] * J[i][bq]
      }
    }

    let stepped = false
    for (let attempt = 0; attempt < 12; attempt++) {
      const damped = JtJ.map((row, a) => row.map((v, bq) => (a === bq ? v * (1 + lambda) : v)))
      const delta = solve(damped, Jtr)
      if (!delta) { lambda *= 10; continue }
      const cand = p.map((v, k) => v + delta[k])
      const next = sse(cand)
      if (next < cur) {
        const improved = cur - next
        p = cand; cur = next; lambda = Math.max(lambda / 10, 1e-12); stepped = true
        if (improved < tol * Math.max(1, cur)) return { params: p, sse: cur, JtJ }
        break
      }
      lambda *= 10
      if (lambda > 1e12) return { params: p, sse: cur, JtJ }
    }
    if (!stepped) return { params: p, sse: cur, JtJ }
  }
  return { params: p, sse: cur, JtJ }
}

/* ── public API ──────────────────────────────────────────────────────── */

/**
 * @param {number[]} xRaw
 * @param {number[]} yRaw
 * @param {string}   modelId  key of MODELS
 * @param {object}   opts     { weights, initial, multiStart }
 */
export function fit(xRaw, yRaw, modelId, opts = {}) {
  const model = MODELS[modelId]
  if (!model) return { ok: false, error: `Unknown model "${modelId}".` }

  // Pair, drop non-numeric, sort by x.
  const pairs = []
  for (let i = 0; i < Math.min(xRaw.length, yRaw.length); i++) {
    const x = Number(xRaw[i]), y = Number(yRaw[i])
    if (Number.isFinite(x) && Number.isFinite(y)) pairs.push([x, y])
  }
  pairs.sort((a, b) => a[0] - b[0])
  const xs = pairs.map(p => p[0]), ys = pairs.map(p => p[1])
  const n = xs.length
  const k = model.params.length

  if (n < k + 1) {
    return { ok: false, error: `Need at least ${k + 1} numeric point pairs for ${model.label}; found ${n}.` }
  }

  const weights = opts.weights && opts.weights.length === n ? opts.weights : null
  let params, JtJ

  if (model.tier === 1) {
    const r = fitPolynomial(xs, ys, model.degree, weights)
    if (!r) return { ok: false, error: 'The normal equations are singular — x values may all be identical.' }
    params = r.params
    JtJ = r.normalMatrix
  } else {
    const base = opts.initial && opts.initial.length === k ? opts.initial : GUESS(modelId, xs, ys)
    let best = lm(model.fn, xs, ys, base, weights)
    // Multi-start (handoff §4.3): jitter the guess and keep the best basin.
    if (opts.multiStart !== false) {
      for (let t = 0; t < 6; t++) {
        const jitter = base.map(v => (v === 0 ? (Math.random() - 0.5) : v * (1 + (Math.random() - 0.5) * 0.8)))
        const alt = lm(model.fn, xs, ys, jitter, weights)
        if (alt && (!best || alt.sse < best.sse * 0.999)) best = alt
      }
    }
    if (!best) return { ok: false, error: 'The solver diverged. Try a different model or supply an initial guess.' }
    params = best.params
    JtJ = best.JtJ
  }

  if (!params.every(Number.isFinite)) {
    return { ok: false, error: 'The fit produced non-finite parameters. The model probably does not suit this data.' }
  }

  // ── goodness of fit ──
  const predict = x => model.tier === 1
    ? params.reduce((acc, c, p) => acc + c * Math.pow(x, p), 0)
    : model.fn(x, params)

  const fitted = xs.map(predict)
  const residuals = ys.map((y, i) => y - fitted[i])
  const sse = residuals.reduce((a, r) => a + r * r, 0)
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  const sst = ys.reduce((a, y) => a + (y - meanY) ** 2, 0)
  const r2 = sst > 0 ? 1 - sse / sst : (sse === 0 ? 1 : 0)
  const dof = Math.max(1, n - k)
  const redChi2 = sse / dof

  // Standard errors from the covariance matrix, scaled by the residual
  // variance — the same construction curve_fit uses. Researchers need these
  // as much as the central values (handoff §3.1).
  let stderr = params.map(() => null)
  const cov = JtJ ? invert(JtJ) : null
  if (cov) {
    stderr = params.map((_, i) => {
      const v = cov[i][i] * redChi2
      return v >= 0 && Number.isFinite(v) ? Math.sqrt(v) : null
    })
  }

  // AIC/BIC for model comparison — penalise free parameters so a quartic
  // doesn't automatically "win" over a line (handoff §3.1).
  const aic = n * Math.log(sse / n || 1e-300) + 2 * k
  const bic = n * Math.log(sse / n || 1e-300) + k * Math.log(n)

  return {
    ok: true,
    model: modelId,
    label: model.label,
    formula: model.formula,
    tier: model.tier,
    paramNames: model.params,
    params,
    stderr,
    n, k, dof,
    r2, sse, redChi2, aic, bic,
    xs, ys, fitted, residuals,
    predict,
  }
}

/** Dense curve for plotting, across the data's x range. */
export function curvePoints(result, steps = 160) {
  if (!result?.ok) return []
  const lo = Math.min(...result.xs), hi = Math.max(...result.xs)
  const out = []
  for (let i = 0; i <= steps; i++) {
    const x = lo + ((hi - lo) * i) / steps
    const y = result.predict(x)
    if (Number.isFinite(y)) out.push([x, y])
  }
  return out
}
