const LEGAL_SUFFIXES = new Set([
  'ltd','limited','inc','incorporated','corp','corporation','co','company',
  'gmbh','ag','sa','spa','srl','bv','nv','oy','ab','as','aps','pte','plc',
  'llc','lp','kg','kgaa','kk','ltda','sasu','sas','sarl','kft','spzoo'
])
const GEO_WORDS = new Set([
  'china','prc','usa','uk','germany','deutschland','france','italy','spain',
  'poland','sweden','norway','finland','japan','korea','taiwan','netherlands',
  'belgium','austria','switzerland','czech','slovakia','denmark','lithuania',
  'latvia','estonia'
])

function normalize(s) {
  if (!s && s !== 0) return ''
  let t = String(s).trim().toLowerCase()
  if (!t) return ''
  t = t.replace(/&/g, ' and ').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
  return t.split(' ').filter(p => p && !LEGAL_SUFFIXES.has(p) && !GEO_WORDS.has(p)).join(' ')
}

function levenshtein(a, b) {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = new Array(n + 1)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++)
      curr[j] = a[i-1] === b[j-1] ? prev[j-1] : 1 + Math.min(prev[j], curr[j-1], prev[j-1])
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

function ratio(a, b) {
  if (!a && !b) return 100
  if (!a || !b) return 0
  const total = a.length + b.length
  return Math.round((1 - levenshtein(a, b) / total) * 100)
}

function tokenSortRatio(a, b) {
  return ratio(
    a.split(' ').filter(Boolean).sort().join(' '),
    b.split(' ').filter(Boolean).sort().join(' ')
  )
}

function tokenSetRatio(a, b) {
  const setA = new Set(a.split(' ').filter(Boolean))
  const setB = new Set(b.split(' ').filter(Boolean))
  const inter = [...setA].filter(x => setB.has(x)).sort()
  const remA  = [...setA].filter(x => !setB.has(x)).sort()
  const remB  = [...setB].filter(x => !setA.has(x)).sort()
  const t0 = inter.join(' ')
  const t1 = [...inter, ...remA].join(' ')
  const t2 = [...inter, ...remB].join(' ')
  return Math.max(ratio(t0, t1), ratio(t0, t2), ratio(t1, t2))
}

function partialRatio(a, b) {
  if (!a || !b) return 0
  if (a.length > b.length) { const tmp = a; a = b; b = tmp }
  let best = 0
  for (let i = 0; i <= b.length - a.length; i++) {
    const r = ratio(a, b.slice(i, i + a.length))
    if (r > best) best = r
    if (best === 100) break
  }
  return best
}

function lcpLen(a, b) {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

self.onmessage = function(e) {
  const { rowsA, rowsB, threshold, maybeThreshold } = e.data
  const THRESHOLD = threshold || 95
  const MAYBE = maybeThreshold || 85

  const rawB  = rowsB.filter(v => v !== null && v !== undefined && String(v).trim())
  const normB = rawB.map(v => normalize(v))

  const byPrefix2 = {}, byFirst = {}
  normB.forEach((norm, i) => {
    if (!norm) return
    const p2 = norm.slice(0, 2)
    if (!byPrefix2[p2]) byPrefix2[p2] = []
    byPrefix2[p2].push(i)
    const c1 = norm[0]
    if (!byFirst[c1]) byFirst[c1] = []
    byFirst[c1].push(i)
  })

  function getCandidates(normA) {
    if (!normA) return rawB.map((_, i) => i)
    const idxs = byPrefix2[normA.slice(0, 2)]
    if (idxs && idxs.length) return idxs
    const idxs2 = byFirst[normA[0]]
    return idxs2 && idxs2.length ? idxs2 : rawB.map((_, i) => i)
  }

  const seenA = new Map()
  rowsA.forEach(raw => {
    const key = raw == null ? '' : String(raw).trim()
    if (!seenA.has(key)) seenA.set(key, { raw, norm: normalize(raw) })
  })

  const resultsMap = new Map()
  seenA.forEach(({ raw, norm }, key) => {
    if (!raw || !norm) { resultsMap.set(key, { bestMatch: '', score: 0, decision: 'unmatched' }); return }
    const candIdxs = getCandidates(norm)
    const top = candIdxs
      .map(i => ({ i, ts: tokenSortRatio(norm, normB[i]) }))
      .sort((a, b) => b.ts - a.ts).slice(0, 25)

    let best = null, bestScore = -1
    for (const { i, ts } of top) {
      const bRaw = String(rawB[i] || ''), bNorm = normB[i]
      const tset = tokenSetRatio(norm, bNorm)
      const pr   = partialRatio(String(raw).toLowerCase().slice(0, 60), String(bRaw).toLowerCase().slice(0, 60))
      const overall = Math.max(ts, tset, pr)
      if (overall > bestScore) { bestScore = overall; best = { raw: rawB[i], norm: bNorm, ts, tset, lcp: lcpLen(norm, bNorm) } }
      if (overall === 100) break
    }

    if (!best) { resultsMap.set(key, { bestMatch: '', score: 0, decision: 'unmatched' }); return }

    let decision = 'drop'
    if (Math.max(best.ts, best.tset) >= THRESHOLD) {
      decision = 'matched'
    } else {
      const short = norm.length <= best.norm.length ? norm : best.norm
      const long  = norm.length <= best.norm.length ? best.norm : norm
      if (short.length >= 5 && long.startsWith(short)) decision = 'matched'
      else if (short.length >= 6 && long.includes(short)) decision = 'matched'
    }
    if (decision === 'drop') decision = bestScore >= MAYBE ? 'maybe' : 'unmatched'
    resultsMap.set(key, { bestMatch: best.raw, score: bestScore, decision })
  })

  const results = rowsA.map(raw => {
    const key = raw == null ? '' : String(raw).trim()
    return resultsMap.get(key) || { bestMatch: '', score: 0, decision: 'unmatched' }
  })

  self.postMessage({
    results,
    summary: {
      total: results.length,
      matched:   results.filter(r => r.decision === 'matched').length,
      maybe:     results.filter(r => r.decision === 'maybe').length,
      unmatched: results.filter(r => r.decision === 'unmatched').length,
    }
  })
}