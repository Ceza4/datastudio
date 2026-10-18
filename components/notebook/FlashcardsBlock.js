'use client'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../ui/Icon'
import { useToast } from '../ui/Toast'
import {
  createCard, normalizeCard, review, previewIntervals, buildQueue, deckStats, dueLabel,
  parseBulk, safeUrl, newCardId, GRADES, formatInterval,
} from '../../lib/flashcards'
import { processFile, putFile, getFile, downloadFile, newFileId, formatSize } from '../../lib/files'

/*
  components/notebook/FlashcardsBlock.js
  --------------------------------------------------------------------------
  Flashcards with real spaced repetition (SM-2, see lib/flashcards.js).
  25 Sep 2026.

  TWO VIEWS IN ONE BLOCK
    · Cards: a two-field composer made for adding many in a row (Enter in
      Front goes to Back, Enter in Back adds the card and returns to Front;
      pasting several lines adds one card per line), and the deck as a list.
      A row opens into the card's details: its sides, comments, links,
      attachments and review history.
    · Study: the queue (due cards, then today's new ones). Space shows the
      answer, 1 to 4 grade it, each button showing when the card would come
      back. A failed card returns in ten minutes, in this same session.

  Attachments are stored like File blocks' (IndexedDB files store, synced as
  assets); the page's keep-set and lib/syncdocs know to look inside cards.
  -------------------------------------------------------------------------- */

const MAX_NEW = 20

function FlashcardsBlockInner({ block, onUpdateBlock, colors, editingRef }) {
  const { surface, raised, border, text, text2, text3, accent } = colors
  const toast = useToast()
  const cards = useMemo(() => (block.cards || []).map(normalizeCard).filter(Boolean), [block.cards])
  const newPerDay = block.newPerDay ?? MAX_NEW
  const [view, setView] = useState('cards')
  const [openId, setOpenId] = useState(null)
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])
  const stats = deckStats(cards, { now, newPerDay })

  const write = next => onUpdateBlock({ cards: next })
  const patchCard = (id, patch) => write(cards.map(c => (c.id === id ? { ...c, ...patch } : c)))
  const focusIn = () => { if (editingRef) editingRef.current = true }
  const focusOut = () => { if (editingRef) editingRef.current = false }

  function deleteCard(id) {
    const before = block.cards || []
    const gone = cards.find(c => c.id === id)
    write(cards.filter(c => c.id !== id))
    if (openId === id) setOpenId(null)
    toast(gone?.front ? `Card "${gone.front.slice(0, 40)}" deleted` : 'Card deleted', { undo: () => onUpdateBlock({ cards: before }) })
  }

  const q = query.trim().toLowerCase()
  const shown = q ? cards.filter(c => `${c.front}\n${c.back}`.toLowerCase().includes(q)) : cards

  return (
    <div data-flashcards onMouseDown={e => e.stopPropagation()}
      style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, fontFamily: 'var(--ds-font-body)', color: text }}>
      {/* ── bar: the two views and the counts that matter today ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${border}`, flexWrap: 'wrap' }}>
        <div role="tablist" aria-label="Flashcards view" style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 8, background: raised }}>
          {[['cards', `Cards · ${stats.total}`], ['study', 'Study']].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
              style={{
                height: 26, padding: '0 10px', border: 'none', borderRadius: 6, cursor: 'pointer',
                fontFamily: 'var(--ds-font-body)', fontSize: 12, fontWeight: 600,
                background: view === id ? surface : 'transparent', color: view === id ? text : text2,
                boxShadow: view === id ? 'var(--ds-shadow-sm)' : 'none',
              }}>{label}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <span title="Due for review" style={pill(stats.due ? 'var(--ds-red)' : text3)}>{stats.due} due</span>
        <span title={`New cards left today (limit ${newPerDay})`} style={pill(stats.newToday ? 'var(--ds-code-num)' : text3)}>{stats.newToday} new</span>
        {view === 'cards' && (
          <button type="button" onClick={() => setView('study')} disabled={!stats.toStudy} data-study-start
            style={{
              height: 28, padding: '0 12px', border: 'none', borderRadius: 8, cursor: stats.toStudy ? 'pointer' : 'default',
              background: stats.toStudy ? accent : raised, color: stats.toStudy ? '#fff' : text3,
              fontFamily: 'var(--ds-font-body)', fontSize: 12, fontWeight: 600,
            }}>{stats.toStudy ? `Study ${stats.toStudy}` : 'Nothing due'}</button>
        )}
      </div>

      {view === 'cards' ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Composer colors={colors} onFocus={focusIn} onBlur={focusOut}
            onAdd={list => {
              const t = Date.now()
              const made = list.map((x, i) => createCard({ ...x, now: t + i }))
              write([...cards, ...made])
              if (made.length > 1) toast(`Added ${made.length} cards`)
            }} />
          {cards.length > 8 && (
            <input value={query} onChange={e => setQuery(e.target.value)} onFocus={focusIn} onBlur={focusOut}
              onKeyDown={e => e.stopPropagation()}
              placeholder={`Search ${cards.length} cards…`} aria-label="Search cards"
              style={{ ...field(colors), height: 30 }} />
          )}
          {!cards.length && (
            <div style={{ padding: '18px 8px', textAlign: 'center', color: text3, fontSize: 12, lineHeight: 1.6 }}>
              No cards yet. Type a front and a back above, or paste a list with one card per line:<br />
              <code style={{ fontFamily: 'var(--ds-font-mono)', color: text2 }}>mitochondria - powerhouse of the cell</code>
            </div>
          )}
          {shown.map(c => (
            <CardRow key={c.id} card={c} now={now} colors={colors} open={openId === c.id}
              onToggle={() => setOpenId(id => (id === c.id ? null : c.id))}
              onPatch={patch => patchCard(c.id, patch)} onDelete={() => deleteCard(c.id)}
              onFocus={focusIn} onBlur={focusOut} toast={toast} />
          ))}
        </div>
      ) : (
        <Study cards={cards} newPerDay={newPerDay} colors={colors}
          onGrade={(id, grade) => {
            const t = Date.now()
            write(cards.map(c => (c.id === id ? review(c, grade, t) : c)))
            setNow(t)
          }}
          onExit={() => setView('cards')} />
      )}
    </div>
  )
}

const pill = color => ({
  height: 22, display: 'inline-flex', alignItems: 'center', padding: '0 8px', borderRadius: '999px', flexShrink: 0,
  fontSize: 11, fontWeight: 600, color, background: `color-mix(in srgb, ${color} 13%, transparent)`,
})
const field = c => ({
  width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 8, border: `1px solid ${c.border}`,
  background: 'var(--ds-paper)', color: c.text, fontFamily: 'var(--ds-font-body)', fontSize: 13, outline: 'none',
})
const ghostBtn = c => ({
  height: 28, padding: '0 10px', borderRadius: 8, border: `1px solid ${c.border}`, background: 'transparent',
  color: c.text2, fontFamily: 'var(--ds-font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
})
const capsLabel = c => ({ fontSize: 11, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: c.text3 })
const iconBtn = c => ({ border: 'none', background: 'transparent', color: c.text3, cursor: 'pointer', padding: 0, display: 'inline-flex' })

/* ── Composer ─────────────────────────────────────────────────────────── */
function Composer({ colors, onAdd, onFocus, onBlur }) {
  const { border, text3, accent } = colors
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const frontRef = useRef(null)
  const backRef = useRef(null)
  const add = () => {
    if (!front.trim()) { frontRef.current?.focus(); return }
    onAdd([{ front: front.trim(), back: back.trim() }])
    setFront('')
    setBack('')
    frontRef.current?.focus()
  }
  const key = which => e => {
    e.stopPropagation()
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    if (which === 'front') backRef.current?.focus()
    else add()
  }
  /* Several lines pasted = several cards. One line pastes normally. */
  const onPaste = e => {
    const txt = e.clipboardData?.getData('text') || ''
    if (!/\n/.test(txt.trim())) return
    const list = parseBulk(txt)
    if (list.length < 2) return
    e.preventDefault()
    onAdd(list)
  }
  const ta = { ...field(colors), resize: 'none', minHeight: 58, lineHeight: 1.4 }
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 10, padding: 10, background: 'var(--ds-surface)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={capsLabel(colors)}>Front</span>
          <textarea ref={frontRef} value={front} rows={2} placeholder="Question" aria-label="New card front"
            onChange={e => setFront(e.target.value)} onKeyDown={key('front')} onPaste={onPaste} onFocus={onFocus} onBlur={onBlur} style={ta} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={capsLabel(colors)}>Back</span>
          <textarea ref={backRef} value={back} rows={2} placeholder="Answer" aria-label="New card back"
            onChange={e => setBack(e.target.value)} onKeyDown={key('back')} onPaste={onPaste} onFocus={onFocus} onBlur={onBlur} style={ta} />
        </label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span style={{ flex: 1, fontSize: 11, color: text3 }}>Enter moves to Back, then adds. Paste lines like “front - back” to add many.</span>
        <button type="button" onClick={add}
          style={{ height: 28, padding: '0 12px', border: 'none', borderRadius: 8, background: accent, color: '#fff', fontFamily: 'var(--ds-font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          Add card
        </button>
      </div>
    </div>
  )
}

/* ── One card in the list, and its details ────────────────────────────── */
function CardRow({ card, now, colors, open, onToggle, onPatch, onDelete, onFocus, onBlur, toast }) {
  const { border, text, text2, text3, accent, red } = colors
  const [tab, setTab] = useState('comments')
  const due = dueLabel(card, now)
  const dueColor = due === 'new' ? 'var(--ds-code-num)' : due === 'due now' ? 'var(--ds-red)' : text3
  const counts = [['comment', card.comments.length], ['link', card.links.length], ['file', card.attachments.length]]
    .filter(x => x[1]).map(([k, n]) => [n === 1 ? k : k + 's', n])
  const tabs = [
    ['comments', `Comments · ${card.comments.length}`], ['links', `Links · ${card.links.length}`],
    ['files', `Attachments · ${card.attachments.length}`], ['history', 'History'],
  ]
  return (
    <div data-card-row={card.id} style={{ border: `1px solid ${open ? accent : border}`, borderRadius: 10, background: 'var(--ds-paper)', boxShadow: 'var(--ds-shadow-sm)' }}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', padding: '10px 12px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--ds-font-body)' }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.front || 'Untitled card'}</span>
          <span style={{ display: 'block', fontSize: 12, color: text2, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.back || '—'}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {counts.map(([k, n]) => <span key={k} title={`${n} ${k}`} style={{ fontSize: 11, color: text3 }}>{n} {k}</span>)}
          <span style={pill(dueColor)}>{due}</span>
        </span>
      </button>
      {open && (
        <div style={{ borderTop: `1px solid ${border}`, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
            <EditSide label="Front" value={card.front} onCommit={v => onPatch({ front: v })} onFocus={onFocus} onBlur={onBlur} colors={colors} />
            <EditSide label="Back" value={card.back} onCommit={v => onPatch({ back: v })} onFocus={onFocus} onBlur={onBlur} colors={colors} />
          </div>
          <div role="tablist" aria-label="Card details" style={{ display: 'flex', gap: 14, borderBottom: `1px solid ${border}`, flexWrap: 'wrap' }}>
            {tabs.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                style={{
                  height: 30, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
                  fontFamily: 'var(--ds-font-body)', fontSize: 12, fontWeight: 600,
                  color: tab === id ? text : text3, boxShadow: tab === id ? `inset 0 -2px 0 ${accent}` : 'none',
                }}>{label}</button>
            ))}
          </div>
          {tab === 'comments' && <Comments card={card} colors={colors} onPatch={onPatch} onFocus={onFocus} onBlur={onBlur} />}
          {tab === 'links' && <Links card={card} colors={colors} onPatch={onPatch} onFocus={onFocus} onBlur={onBlur} toast={toast} />}
          {tab === 'files' && <Attachments card={card} colors={colors} onPatch={onPatch} toast={toast} />}
          {tab === 'history' && <History card={card} colors={colors} now={now} />}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {card.due != null && (
              <button type="button" onClick={() => onPatch({ due: null, interval: 0, ease: 2.5, reps: 0, lapses: 0 })} style={ghostBtn(colors)}>Reset progress</button>
            )}
            <button type="button" onClick={onDelete} style={{ ...ghostBtn(colors), color: red }}>Delete card</button>
          </div>
        </div>
      )}
    </div>
  )
}

function EditSide({ label, value, onCommit, onFocus, onBlur, colors }) {
  const [v, setV] = useState(value)
  useEffect(() => { setV(value) }, [value])
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={capsLabel(colors)}>{label}</span>
      <textarea value={v} rows={3} aria-label={`Card ${label.toLowerCase()}`}
        onChange={e => setV(e.target.value)} onFocus={onFocus}
        onBlur={() => { onBlur(); if (v !== value) onCommit(v) }}
        onKeyDown={e => e.stopPropagation()}
        style={{ ...field(colors), resize: 'vertical', lineHeight: 1.4 }} />
    </label>
  )
}

function Comments({ card, colors, onPatch, onFocus, onBlur }) {
  const [v, setV] = useState('')
  const add = () => {
    const t = v.trim()
    if (!t) return
    onPatch({ comments: [...card.comments, { id: newCardId('cm'), text: t, at: Date.now() }] })
    setV('')
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {card.comments.map(c => (
        <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, lineHeight: 1.5 }}>
          <span style={{ flex: 1, whiteSpace: 'pre-wrap', color: colors.text }}>{c.text}</span>
          <span style={{ fontSize: 11, color: colors.text3, flexShrink: 0 }}>{new Date(c.at).toLocaleDateString()}</span>
          <button type="button" aria-label="Delete comment" onClick={() => onPatch({ comments: card.comments.filter(x => x.id !== c.id) })} style={iconBtn(colors)}>
            <Icon name="action-delete" size={12} />
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={v} onChange={e => setV(e.target.value)} onFocus={onFocus} onBlur={onBlur} placeholder="Add a comment" aria-label="Add a comment"
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); add() } }} style={{ ...field(colors), height: 30 }} />
        <button type="button" onClick={add} style={ghostBtn(colors)}>Add</button>
      </div>
    </div>
  )
}

function Links({ card, colors, onPatch, onFocus, onBlur, toast }) {
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const add = () => {
    const safe = safeUrl(url)
    if (!safe) { toast('That is not a web link. Use an http or https address.', { tone: 'warn' }); return }
    onPatch({ links: [...card.links, { id: newCardId('ln'), url: safe, label: label.trim() }] })
    setUrl('')
    setLabel('')
  }
  const enter = e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); add() } }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {card.links.map(l => (
        <div key={l.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <Icon name="share-link" size={12} />
          <a href={safeUrl(l.url) || undefined} target="_blank" rel="noopener noreferrer"
            style={{ flex: 1, minWidth: 0, color: colors.accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.label || l.url}</a>
          <button type="button" aria-label="Remove link" onClick={() => onPatch({ links: card.links.filter(x => x.id !== l.id) })} style={iconBtn(colors)}>
            <Icon name="action-close" size={12} />
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input value={url} onChange={e => setUrl(e.target.value)} onFocus={onFocus} onBlur={onBlur} placeholder="https://…" aria-label="Link address"
          onKeyDown={enter} style={{ ...field(colors), height: 30, flex: '2 1 160px', width: 'auto' }} />
        <input value={label} onChange={e => setLabel(e.target.value)} onFocus={onFocus} onBlur={onBlur} placeholder="Label (optional)" aria-label="Link label"
          onKeyDown={enter} style={{ ...field(colors), height: 30, flex: '1 1 100px', width: 'auto' }} />
        <button type="button" onClick={add} style={ghostBtn(colors)}>Add link</button>
      </div>
    </div>
  )
}

function Attachments({ card, colors, onPatch, toast }) {
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  async function onFiles(files) {
    if (!files?.length) return
    setBusy(true)
    const added = []
    for (const f of files) {
      try {
        const rec = await processFile(f)
        const fileId = newFileId()
        await putFile(fileId, rec)
        added.push({ id: newCardId('at'), fileId, name: rec.name, size: rec.size })
      } catch (err) {
        toast(err?.message || 'Could not attach that file.', { tone: 'warn' })
      }
    }
    setBusy(false)
    if (added.length) onPatch({ attachments: [...card.attachments, ...added] })
  }
  async function download(a) {
    const rec = await getFile(a.fileId)
    if (!rec || !downloadFile(rec)) toast('That file is no longer stored on this device.', { tone: 'warn' })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {card.attachments.map(a => (
        <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <Icon name="block-text" size={12} />
          <button type="button" onClick={() => download(a)} title="Download"
            style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', color: colors.accent, fontFamily: 'var(--ds-font-body)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</button>
          <span style={{ fontSize: 11, color: colors.text3 }}>{formatSize(a.size)}</span>
          <button type="button" aria-label="Remove attachment" onClick={() => onPatch({ attachments: card.attachments.filter(x => x.id !== a.id) })} style={iconBtn(colors)}>
            <Icon name="action-close" size={12} />
          </button>
        </div>
      ))}
      <input ref={input} type="file" multiple hidden aria-label="Attach files" onChange={e => { onFiles([...e.target.files]); e.target.value = '' }} />
      <div><button type="button" disabled={busy} onClick={() => input.current?.click()} style={ghostBtn(colors)}>{busy ? 'Attaching…' : 'Attach a file'}</button></div>
    </div>
  )
}

function History({ card, colors, now }) {
  const rows = [...card.history].reverse().slice(0, 12)
  const stat = (k, v) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={capsLabel(colors)}>{k}</span>
      <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        {stat('Next', dueLabel(card, now))}
        {stat('Interval', card.interval ? `${card.interval}d` : '—')}
        {stat('Ease', card.ease.toFixed(2))}
        {stat('Reviews', card.history.length)}
        {stat('Lapses', card.lapses)}
      </div>
      {rows.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map((h, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: colors.text2 }}>
              <span style={{ width: 150 }}>{new Date(h.at).toLocaleString()}</span>
              <span style={{ width: 50, fontWeight: 600, color: h.grade === 'again' ? 'var(--ds-red)' : colors.text }}>{GRADES.find(g => g.id === h.grade)?.label}</span>
              <span>{h.interval ? `→ ${h.interval}d` : '→ 10m'}</span>
            </div>
          ))}
        </div>
      ) : <div style={{ fontSize: 12, color: colors.text3 }}>Not studied yet.</div>}
    </div>
  )
}

/* ── Study ───────────────────────────────────────────────────────────── */
function Study({ cards, newPerDay, colors, onGrade, onExit }) {
  const { border, text, text2, text3, accent, raised } = colors
  /* The queue is fixed when the session starts (plus re-queued failures), so
     grading a card never reshuffles what comes next. */
  const [queue, setQueue] = useState(() => buildQueue(cards, { now: Date.now(), newPerDay }))
  const [done, setDone] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus({ preventScroll: true }) }, [])
  const card = cards.find(c => c.id === queue[0]) || null
  const previews = card ? previewIntervals(card) : null
  const total = done + queue.length

  function grade(g) {
    if (!card || !flipped) return
    onGrade(card.id, g)
    /* Again: the card goes to the back of THIS session's queue (it is due
       again in ten minutes). Anything else: it is done for today. */
    setQueue(qu => (g === 'again' ? [...qu.slice(1), qu[0]] : qu.slice(1)))
    if (g !== 'again') setDone(d => d + 1)
    setFlipped(false)
  }
  function onKey(e) {
    e.stopPropagation()
    if (e.key === 'Escape') { e.preventDefault(); onExit(); return }
    if (!card) return
    if (!flipped && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); setFlipped(true); return }
    const g = GRADES.find(x => x.key === e.key)
    if (flipped && g) { e.preventDefault(); grade(g.id) }
  }

  if (!card) {
    const stats = deckStats(cards, { now: Date.now(), newPerDay })
    return (
      <div ref={ref} tabIndex={0} onKeyDown={onKey} data-study-done
        style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 20, outline: 'none', textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{done ? 'Session complete' : 'Nothing to study'}</div>
          <div style={{ fontSize: 13, color: text2, marginTop: 6 }}>
            {done ? `${done} card${done === 1 ? '' : 's'} reviewed. ` : ''}
            {stats.nextDue ? `Next card due in ${formatInterval(stats.nextDue - Date.now())}.` : stats.total ? 'Every card is scheduled.' : 'Add some cards first.'}
          </div>
          <button type="button" onClick={onExit} style={{ ...ghostBtn(colors), marginTop: 14 }}>Back to cards</button>
        </div>
      </div>
    )
  }

  const gradeColor = id => (id === 'again' ? 'var(--ds-red)' : id === 'hard' ? 'var(--ds-amber)' : id === 'good' ? accent : 'var(--ds-code-num)')
  return (
    <div ref={ref} tabIndex={0} onKeyDown={onKey} aria-label="Study session" data-study
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 14, gap: 12, outline: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 4, borderRadius: 4, background: raised, overflow: 'hidden' }}>
          <div style={{ width: `${total ? (done / total) * 100 : 0}%`, height: '100%', background: accent, transition: 'width .2s ease' }} />
        </div>
        <span style={{ fontSize: 11, color: text3, fontVariantNumeric: 'tabular-nums' }}>{queue.length} left</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', border: `1px solid ${border}`, borderRadius: 12, background: 'var(--ds-paper)', boxShadow: 'var(--ds-shadow-sm)', padding: '22px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div data-study-front style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.35, textAlign: 'center', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{card.front}</div>
        {flipped && <>
          <div style={{ height: 1, background: border }} />
          <div data-study-back style={{ fontSize: 16, lineHeight: 1.5, textAlign: 'center', color: text, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {card.back || <span style={{ color: text3 }}>No back side</span>}
          </div>
          {(card.links.length > 0 || card.attachments.length > 0 || card.comments.length > 0) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', fontSize: 12 }}>
              {card.links.map(l => <a key={l.id} href={safeUrl(l.url) || undefined} target="_blank" rel="noopener noreferrer" style={{ color: accent }}>{l.label || l.url}</a>)}
              {card.attachments.map(a => <span key={a.id} style={{ color: text2 }}>{a.name}</span>)}
              {card.comments.length > 0 && <span style={{ color: text3 }}>{card.comments.length} comment{card.comments.length === 1 ? '' : 's'}</span>}
            </div>
          )}
        </>}
      </div>
      {!flipped ? (
        <button type="button" onClick={() => setFlipped(true)} data-show-answer
          style={{ height: 40, border: 'none', borderRadius: 10, background: accent, color: '#fff', fontFamily: 'var(--ds-font-body)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Show answer <span style={{ opacity: 0.7, fontSize: 12, marginLeft: 6 }}>Space</span>
        </button>
      ) : (
        <div role="group" aria-label="How well did you know it?" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {GRADES.map(g => {
            const c = gradeColor(g.id)
            return (
              <button key={g.id} type="button" onClick={() => grade(g.id)} data-grade={g.id}
                style={{
                  height: 48, border: `1px solid ${c}`, borderRadius: 10, background: `color-mix(in srgb, ${c} 10%, transparent)`,
                  color: c, cursor: 'pointer', fontFamily: 'var(--ds-font-body)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{g.label}</span>
                <span style={{ fontSize: 11, opacity: 0.8 }}>{previews[g.id]} · {g.key}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default memo(FlashcardsBlockInner)
