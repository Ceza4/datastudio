/* crosscheck.worker.js
   --------------------------------------------------------------------------
   Fuzzy-matches a "check list" (rowsA) against a "master list" (rowsB).

   WHY THE PREVIOUS VERSIONS PRODUCED GARBAGE
   ------------------------------------------
   Both earlier attempts leaned on classic fuzzy-string metrics, and both were
   wrecked by the same thing: those metrics treat every word as equally
   meaningful. On a real exhibitor list that assumption is catastrophic.

     "ACI Laser GmbH"          -> "Japan Laser Corporation"   100%
     "Air Turbine Tools, Inc." -> "AIR"                       100%
     "3D-Technologie Hörth"    -> "3D AG"                     100%

   The mechanism was tokenSetRatio. It builds three strings — the shared
   tokens, shared+A-only, shared+B-only — and returns the best ratio between
   them. When the master name's tokens are a SUBSET of the check name's, the
   "shared+B-only" string is identical to the "shared" string, so the ratio is
   100 by construction. Any master entry that is a single common word ("AIR",
   "3D AG") therefore matches every check row containing that word, at full
   confidence. partialRatio had the same failure mode from the other
   direction, which is what the version before that got wrong.

   THE FIX: weight tokens by how much information they carry.
   ---------------------------------------------------------
   In a list of laser companies, "laser" tells you nothing — it's in half the
   rows. "ACSYS" tells you almost everything — it's in one. That's textbook
   inverse document frequency, so we compute IDF over the master list and
   score pairs on weighted token overlap (a weighted Sørensen–Dice).

     "aci laser" vs "japan laser"  -> shares only the ~zero-weight "laser"
                                      => score collapses. Correctly unmatched.
     "acsys lasertechnik" vs same  -> shares the high-weight "acsys"
                                      => scores high. Correctly matched.
     "air turbine tools" vs "air"  -> shares "air", but "turbine" and "tools"
                                      are unmatched weight on the A side
                                      => score collapses. Correctly unmatched.

   Typos still work because unmatched tokens get a second pass of fuzzy
   alignment (edit-distance >= 82 counts as a partial hit, scaled by
   similarity), so "Lasertecknik" still finds "Lasertechnik".

   PROTOCOL
     in:  { rowsA, rowsB, matchThreshold, maybeThreshold }
     out: { type:'progress', done, total, matched, maybe, unmatched }
          { type:'done', results, summary }
   -------------------------------------------------------------------------- */

/* Legal forms and corporate boilerplate. Stripped before scoring — they're
   pure noise and appear in nearly every row. */
const LEGAL_SUFFIXES = new Set([
  'ltd', 'limited', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company',
  'gmbh', 'mbh', 'ag', 'aktiengesellschaft', 'kgaa', 'kg', 'ohg', 'gbr', 'ug',
  'sa', 'spa', 'srl', 'sarl', 'sas', 'sasu', 'bv', 'nv', 'oy', 'oyj', 'ab', 'as',
  'asa', 'aps', 'pte', 'pty', 'plc', 'llc', 'llp', 'lp', 'kk', 'ltda', 'kft',
  'spzoo', 'sp', 'zoo', 'doo', 'dooel', 'ood', 'ead', 'zrt', 'nyrt', 'sro',
  'group', 'holding', 'holdings', 'international', 'intl', 'worldwide', 'global',
  'the', 'and',
])

const GEO_WORDS = new Set([
  'china', 'prc', 'usa', 'us', 'uk', 'germany', 'deutschland', 'france', 'italy',
  'spain', 'poland', 'sweden', 'norway', 'finland', 'japan', 'korea', 'taiwan',
  'netherlands', 'belgium', 'austria', 'switzerland', 'czech', 'slovakia',
  'denmark', 'lithuania', 'latvia', 'estonia', 'europe', 'european', 'asia',
  'america', 'american', 'nordic', 'iberica', 'benelux',
])

function normalize(s) {
  if (!s && s !== 0) return ''
  let t = String(s).trim().toLowerCase()
  if (!t) return ''
  // Split camel/glued forms lightly, unify separators, drop punctuation.
  t = t.replace(/&/g, ' and ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const parts = t.split(' ').filter(p => p && !LEGAL_SUFFIXES.has(p) && !GEO_WORDS.has(p))
  // Never reduce a name to nothing — if it was ONLY boilerplate, keep it.
  return (parts.length ? parts : t.split(' ').filter(Boolean)).join(' ')
}

/* Unique tokens. A word repeated inside one name ("Absolent / Absolent Air
   Care") carries no extra information, but counted twice it inflates that
   name's total weight and drags a genuine match below threshold. */
function tokensOf(s) { return s ? [...new Set(s.split(' ').filter(Boolean))] : [] }

function levenshtein(a, b) {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = new Array(n + 1)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++)
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1])
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

/* Normalized edit similarity 0-100, divided by the LONGER string so
   unrelated strings score near 0 (dividing by the sum, as the original did,
   floored everything around 50). */
function ratio(a, b) {
  if (!a && !b) return 100
  if (!a || !b) return 0
  if (a === b) return 100
  return Math.round((1 - levenshtein(a, b) / Math.max(a.length, b.length)) * 100)
}

self.onmessage = function (e) {
  const { rowsA, rowsB, matchThreshold, maybeThreshold } = e.data
  const MATCH = typeof matchThreshold === 'number' ? matchThreshold : 86
  const MAYBE = typeof maybeThreshold === 'number' ? maybeThreshold : 72

  const rawB = rowsB.filter(v => v !== null && v !== undefined && String(v).trim())
  const normB = rawB.map(v => normalize(v))
  const tokB = normB.map(tokensOf)

  // ── IDF over the master list ──────────────────────────────────────────
  // A token in most rows ("laser" on a laser-show exhibitor list) is worth
  // ~nothing; a token in one row identifies that row.
  const N = Math.max(1, tokB.length)
  const df = new Map()
  tokB.forEach(toks => {
    new Set(toks).forEach(t => df.set(t, (df.get(t) || 0) + 1))
  })

  function idf(tok) {
    const d = df.get(tok) || 0
    // Unseen tokens (present only in the check list) are treated as rare but
    // not infinitely so — they carry no corroborating evidence.
    const base = Math.log((N + 1) / (d + 1)) + 0.15
    // Very short tokens are rarely distinctive even when uncommon ("3d", "ai").
    const lengthFactor = tok.length <= 2 ? 0.35 : tok.length === 3 ? 0.7 : 1
    return Math.max(0.02, base * lengthFactor)
  }

  const weightCache = new Map()
  function w(tok) {
    let v = weightCache.get(tok)
    if (v === undefined) { v = idf(tok); weightCache.set(tok, v) }
    return v
  }
  function totalWeight(toks) { return toks.reduce((s, t) => s + w(t), 0) }

  const weightB = tokB.map(totalWeight)

  /* Weighted Sørensen–Dice over tokens, with a fuzzy second pass so typos
     still align. Returns 0-100. */
  function scoreTokens(tokA, wA, i) {
    const tB = tokB[i]
    if (!tokA.length || !tB.length) return 0
    const wB = weightB[i]
    if (wA <= 0 || wB <= 0) return 0

    const usedB = new Array(tB.length).fill(false)
    let shared = 0

    // Pass 1 — exact token hits.
    for (const ta of tokA) {
      for (let j = 0; j < tB.length; j++) {
        if (!usedB[j] && tB[j] === ta) { usedB[j] = true; shared += w(ta); break }
      }
    }
    // Pass 2 — fuzzy alignment for the leftovers (typos, small variants).
    for (const ta of tokA) {
      let hit = false
      for (let j = 0; j < tB.length; j++) if (usedB[j] && tB[j] === ta) { hit = true; break }
      if (hit) continue
      let bestJ = -1, bestR = 0
      for (let j = 0; j < tB.length; j++) {
        if (usedB[j]) continue
        const r = ratio(ta, tB[j])
        if (r > bestR) { bestR = r; bestJ = j }
      }
      if (bestJ >= 0 && bestR >= 82) {
        usedB[bestJ] = true
        shared += Math.min(w(ta), w(tB[bestJ])) * (bestR / 100)
      }
    }

    return Math.round((2 * shared / (wA + wB)) * 100)
  }

  // ── Candidate index: only rows sharing at least one token ─────────────
  const byToken = new Map()
  tokB.forEach((toks, i) => {
    new Set(toks).forEach(t => {
      if (!byToken.has(t)) byToken.set(t, [])
      byToken.get(t).push(i)
    })
  })
  const MAX_CANDIDATES = 600

  function getCandidates(tokA) {
    const seen = new Set()
    // Rare tokens first — they point at the right row fastest.
    const ordered = [...new Set(tokA)].sort((x, y) => w(y) - w(x))
    for (const t of ordered) {
      const list = byToken.get(t)
      if (!list) continue
      for (const i of list) {
        seen.add(i)
        if (seen.size >= MAX_CANDIDATES) return [...seen]
      }
    }
    return [...seen]
  }

  // Dedupe identical check values — score each distinct name once.
  const seenA = new Map()
  rowsA.forEach(raw => {
    const key = raw == null ? '' : String(raw).trim()
    if (!seenA.has(key)) seenA.set(key, { raw, norm: normalize(raw) })
  })

  const resultsMap = new Map()
  let done = 0, nMatched = 0, nMaybe = 0, nUnmatched = 0, lastPost = 0
  const total = seenA.size

  seenA.forEach(({ raw, norm }, key) => {
    done++
    const tokA = tokensOf(norm)

    if (!raw || !tokA.length) {
      resultsMap.set(key, { bestMatch: '', score: 0, decision: 'unmatched' })
      nUnmatched++
    } else {
      const wA = totalWeight(tokA)
      let best = null, bestScore = -1

      for (const i of getCandidates(tokA)) {
        let s = scoreTokens(tokA, wA, i)
        // Whole-string similarity acts as a floor for near-identical names
        // that tokenize oddly, but can never rescue a weak token overlap.
        if (s >= 55) s = Math.max(s, ratio(norm, normB[i]))
        if (s > bestScore) { bestScore = s; best = { raw: rawB[i], norm: normB[i] } }
        if (bestScore >= 100) break
      }

      if (!best || bestScore <= 0) {
        resultsMap.set(key, { bestMatch: '', score: 0, decision: 'unmatched' })
        nUnmatched++
      } else {
        const decision = bestScore >= MATCH ? 'matched' : bestScore >= MAYBE ? 'maybe' : 'unmatched'
        if (decision === 'matched') nMatched++
        else if (decision === 'maybe') nMaybe++
        else nUnmatched++
        resultsMap.set(key, {
          bestMatch: decision === 'unmatched' ? '' : best.raw,
          score: Math.min(100, bestScore),
          decision,
        })
      }
    }

    if (done - lastPost >= 150 || done === total) {
      lastPost = done
      self.postMessage({
        type: 'progress', done, total,
        matched: nMatched, maybe: nMaybe, unmatched: nUnmatched,
      })
    }
  })

  const results = rowsA.map(raw => {
    const key = raw == null ? '' : String(raw).trim()
    return resultsMap.get(key) || { bestMatch: '', score: 0, decision: 'unmatched' }
  })

  self.postMessage({
    type: 'done',
    results,
    summary: {
      total: results.length,
      matched: results.filter(r => r.decision === 'matched').length,
      maybe: results.filter(r => r.decision === 'maybe').length,
      unmatched: results.filter(r => r.decision === 'unmatched').length,
    },
  })
}
