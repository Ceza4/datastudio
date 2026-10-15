/*
  lib/flashcards.js
  --------------------------------------------------------------------------
  The Flashcards block's model: cards, SM-2 scheduling, the review queue.
  Pure, no React, no DOM. Every function that reads the clock takes `now`
  (ms) so tests and the review session agree on what "due" means. 25 Sep 2026.

  ── SM-2, AS PUBLISHED, WITH TWO DOCUMENTED CHANGES ─────────────────────
  Reference: P. Woźniak, "Optimization of learning" (1990), algorithm SM-2.

    quality q in 0..5. Four buttons map onto it the way Anki's do:
      Again = 1 · Hard = 3 · Good = 4 · Easy = 5
    EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)),  floor 1.3
    q >= 3:  n = 0 → I = 1 day ;  n = 1 → I = 6 days ;  else I = round(I * EF')
             n = n + 1
    q < 3 :  n = 0, and the card is reviewed again (see change 1)

  Change 1: a failed card comes back in 10 MINUTES, in the same session,
  instead of "tomorrow with interval 1". SM-2 says to repeat failed items
  until they reach q >= 4; a short relearning step is how every modern
  implementation does that. Its next successful review restarts at 1 day.

  Change 2: Hard and Easy nudge the interval as well as the ease (Hard
  x1.2 of the previous interval at most, Easy x1.3 bonus), so the four
  buttons show four different intervals. Pure SM-2 gives Hard, Good and
  Easy the same next interval on a card's first two reviews, and three
  buttons that all say "1d" read as broken.

  ── A CARD ───────────────────────────────────────────────────────────
    { id, front, back, createdAt,
      due: ms | null (null = new, never studied),
      interval: days, ease: EF, reps: n, lapses,
      history: [{ at, grade, interval, ease }],
      comments: [{ id, text, at }], links: [{ id, url, label }],
      attachments: [{ id, fileId, name, size }] }
  -------------------------------------------------------------------------- */

export const DAY = 86400000
export const MINUTE = 60000
export const RELEARN_MS = 10 * MINUTE
export const START_EASE = 2.5
export const MIN_EASE = 1.3
export const GRADES = [
  { id: 'again', label: 'Again', q: 1, key: '1' },
  { id: 'hard',  label: 'Hard',  q: 3, key: '2' },
  { id: 'good',  label: 'Good',  q: 4, key: '3' },
  { id: 'easy',  label: 'Easy',  q: 5, key: '4' },
]
const Q = Object.fromEntries(GRADES.map(g => [g.id, g.q]))

let seq = 0
export function newCardId(prefix = 'fc') {
  seq = (seq + 1) % 1e6
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function createCard({ front = '', back = '', now = Date.now() } = {}) {
  return {
    id: newCardId(), front: String(front), back: String(back), createdAt: now,
    due: null, interval: 0, ease: START_EASE, reps: 0, lapses: 0,
    history: [], comments: [], links: [], attachments: [],
  }
}

/** A card from storage with every field present and sane. */
export function normalizeCard(c) {
  if (!c || typeof c !== 'object') return null
  const num = (v, d) => (Number.isFinite(v) ? v : d)
  return {
    id: c.id || newCardId(),
    front: typeof c.front === 'string' ? c.front : '',
    back: typeof c.back === 'string' ? c.back : '',
    createdAt: num(c.createdAt, 0),
    due: Number.isFinite(c.due) ? c.due : null,
    interval: Math.max(0, num(c.interval, 0)),
    ease: Math.max(MIN_EASE, num(c.ease, START_EASE)),
    reps: Math.max(0, Math.floor(num(c.reps, 0))),
    lapses: Math.max(0, Math.floor(num(c.lapses, 0))),
    history: Array.isArray(c.history) ? c.history : [],
    comments: Array.isArray(c.comments) ? c.comments : [],
    links: Array.isArray(c.links) ? c.links : [],
    attachments: Array.isArray(c.attachments) ? c.attachments : [],
  }
}

export const isNew = c => c.due == null

/** SM-2 ease update. */
export function nextEase(ease, q) {
  const d = 5 - q
  return Math.max(MIN_EASE, Math.round((ease + (0.1 - d * (0.08 + d * 0.02))) * 1000) / 1000)
}

/**
 * The card after one review. Pure: returns a new card.
 * @param grade 'again' | 'hard' | 'good' | 'easy'
 */
export function review(card, grade, now = Date.now()) {
  const q = Q[grade]
  if (q == null) throw new Error(`unknown grade: ${grade}`)
  const c = normalizeCard(card)
  const ease = nextEase(c.ease, q)
  let interval, reps, lapses = c.lapses, due
  if (q < 3) {
    reps = 0
    interval = 0
    if (c.reps > 0) lapses += 1
    due = now + RELEARN_MS
  } else {
    if (c.reps === 0) interval = grade === 'easy' ? 4 : 1
    else if (c.reps === 1) interval = grade === 'hard' ? 3 : grade === 'easy' ? 8 : 6
    else {
      const base = c.interval * ease
      interval = grade === 'hard' ? Math.min(base, c.interval * 1.2) : grade === 'easy' ? base * 1.3 : base
    }
    interval = Math.max(1, Math.round(interval))
    reps = c.reps + 1
    due = now + interval * DAY
  }
  return {
    ...c, ease, interval, reps, lapses, due,
    history: [...c.history, { at: now, grade, interval, ease }],
  }
}

/** What each button would schedule, as short labels: { again: '10m', … }. */
export function previewIntervals(card, now = Date.now()) {
  const out = {}
  for (const g of GRADES) out[g.id] = formatInterval(review(card, g.id, now).due - now)
  return out
}

export function formatInterval(ms) {
  if (ms < 60 * MINUTE) return `${Math.max(1, Math.round(ms / MINUTE))}m`
  /* 23h+ reads as a day: a card graded Good is due "in 1d", not "in 24h"
     a few seconds later. */
  if (ms < DAY - 60 * MINUTE) return `${Math.round(ms / (60 * MINUTE))}h`
  const d = ms / DAY
  if (d < 30) return `${Math.round(d)}d`
  if (d < 365) return `${Math.round(d / 30)}mo`
  return `${Math.round((d / 365) * 10) / 10}y`
}

/** "due in 3d", "due now", "new". */
export function dueLabel(card, now = Date.now()) {
  if (isNew(card)) return 'new'
  const ms = card.due - now
  return ms <= 0 ? 'due now' : `due in ${formatInterval(ms)}`
}

const startOfDay = now => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime() }

/** New cards already introduced today (first review happened today). */
export function newStudiedToday(cards, now = Date.now()) {
  const sod = startOfDay(now)
  return cards.filter(c => c.history?.length && c.history[0].at >= sod).length
}

/**
 * The review queue, in order: cards that are due (oldest due first), then
 * new cards in creation order, capped at the daily new-card limit minus what
 * was already introduced today.
 */
export function buildQueue(cards, { now = Date.now(), newPerDay = 20 } = {}) {
  const list = (cards || []).map(normalizeCard).filter(Boolean)
  const due = list.filter(c => !isNew(c) && c.due <= now).sort((a, b) => a.due - b.due)
  const room = Math.max(0, newPerDay - newStudiedToday(list, now))
  const fresh = list.filter(isNew).sort((a, b) => a.createdAt - b.createdAt).slice(0, room)
  return [...due, ...fresh].map(c => c.id)
}

export function deckStats(cards, { now = Date.now(), newPerDay = 20 } = {}) {
  const list = (cards || []).map(normalizeCard).filter(Boolean)
  const due = list.filter(c => !isNew(c) && c.due <= now).length
  const fresh = list.filter(isNew).length
  const room = Math.max(0, newPerDay - newStudiedToday(list, now))
  const nextDue = list.filter(c => !isNew(c) && c.due > now).reduce((m, c) => Math.min(m, c.due), Infinity)
  return {
    total: list.length, due, new: fresh, newToday: Math.min(fresh, room),
    toStudy: due + Math.min(fresh, room),
    learned: list.filter(c => c.reps > 0).length,
    nextDue: Number.isFinite(nextDue) ? nextDue : null,
  }
}

/**
 * Bulk entry from pasted text. One card per line, front and back split by
 * a tab (a spreadsheet paste), " :: ", " - " or " — ". A line with no
 * separator becomes a front with an empty back. Blank lines are skipped.
 */
export function parseBulk(text) {
  const out = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const m = line.split(/\t| :: | — | – | - /)
    const front = (m[0] || '').trim()
    const back = m.slice(1).join(' - ').trim()
    if (front) out.push({ front, back })
  }
  return out
}

/** Only http(s) links are stored or opened: a javascript: or data: URL in a
 *  card link would run in this origin when clicked. */
export function safeUrl(input) {
  let s = String(input || '').trim()
  if (!s) return null
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch { return null }
}

/** Every attachment file id a Flashcards block references, for the asset
 *  keep-set and sync. */
export function flashcardFileIds(block) {
  const ids = []
  for (const c of block?.cards || []) for (const a of c?.attachments || []) if (a?.fileId) ids.push(a.fileId)
  return ids
}
