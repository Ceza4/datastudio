'use client'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { stackCards, timeLabel } from '../../../lib/doccomments'
import { authorHue } from '../../../lib/doctrack'
import { initials } from '../../../lib/docauthor'

/*
  components/notebook/doc/DocRail.js
  --------------------------------------------------------------------------
  THE MARGIN RAIL: comment threads and tracked changes as cards beside the
  page, each level with the text it belongs to (Word's balloons, Google
  Docs' cards). The active card sits exactly level with its text and slides
  toward the page; the others stack above and below without overlapping.

  Lives inside the page's scaled container, so its coordinates are the
  editor's own pixels and it zooms with the page.
  -------------------------------------------------------------------------- */

const CARD_W_PAD = 10

function Avatar({ name, uid }) {
  const h = authorHue(uid)
  return (
    <span aria-hidden="true" style={{
      width: 24, height: 24, borderRadius: 12, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: `hsl(${h} 55% 88%)`, color: `hsl(${h} 45% 30%)`, fontSize: 11, fontWeight: 700,
    }}>{initials(name)}</span>
  )
}

function Who({ name, uid, at, extra }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <Avatar name={name} uid={uid} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ds-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
        <div style={{ fontSize: 11, color: 'var(--ds-text-3)' }}>{timeLabel(at)}{extra}</div>
      </div>
    </div>
  )
}

function Composer({ initial = '', placeholder, submitLabel, onSubmit, onCancel, autoFocus }) {
  const [v, setV] = useState(initial)
  const ref = useRef(null)
  useLayoutEffect(() => {
    const t = ref.current
    if (!t) return
    t.style.height = 'auto'
    t.style.height = Math.min(160, t.scrollHeight) + 'px'
  }, [v])
  const send = () => { if (v.trim()) onSubmit(v.trim()) }
  return (
    <div style={{ display: 'grid', gap: 6 }} onMouseDown={e => e.stopPropagation()}>
      <textarea ref={ref} autoFocus={autoFocus} value={v} placeholder={placeholder} rows={1}
        onChange={e => setV(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send() }
          if (e.key === 'Escape') { e.preventDefault(); e.nativeEvent.__dsConsumed = true; onCancel?.() }
        }}
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'none', minHeight: 30, padding: '6px 8px', borderRadius: 6,
          border: '1px solid var(--ds-border)', background: 'var(--ds-base)', color: 'var(--ds-text)',
          fontFamily: 'var(--ds-font-body)', fontSize: 13, lineHeight: 1.4, outline: 'none',
        }} />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        {onCancel && <button type="button" className="ds-btn" style={{ height: 26 }} onClick={onCancel}>Cancel</button>}
        <button type="button" className="ds-btn ds-btn-primary" style={{ height: 26, opacity: v.trim() ? 1 : 0.5 }} disabled={!v.trim()} onClick={send}>{submitLabel}</button>
      </div>
    </div>
  )
}

function IconBtn({ title, onClick, children, danger }) {
  return (
    <button type="button" title={title} aria-label={title}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onClick() }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--ds-raised)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
      style={{ width: 26, height: 26, border: 'none', borderRadius: 6, background: 'none', cursor: 'pointer', color: danger ? 'var(--ds-red)' : 'var(--ds-text-2)', fontSize: 14, lineHeight: 1, padding: 0, flexShrink: 0 }}>
      {children}
    </button>
  )
}

const CommentCard = memo(function CommentCard({ item, active, onActivate, api }) {
  const c = item.thread
  const [editing, setEditing] = useState(false)
  const [more, setMore] = useState(false)
  const isNew = !c.text
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}><Who name={c.by} uid={c.uid} at={c.at} extra={c.edited ? ' · edited' : ''} /></div>
        {active && !isNew && !editing && (
          <>
            <IconBtn title="Resolve (hide this thread)" onClick={() => api.resolve(c.id, true)}>✓</IconBtn>
            <div style={{ position: 'relative' }}>
              <IconBtn title="More" onClick={() => setMore(m => !m)}>⋯</IconBtn>
              {more && (
                <div style={{ position: 'absolute', right: 0, top: 28, zIndex: 3, minWidth: 120, padding: 4, background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', borderRadius: 8, boxShadow: 'var(--ds-shadow-md)' }}>
                  {[['Edit', () => { setEditing(true); setMore(false) }], ['Delete thread', () => { setMore(false); api.remove(c.id) }]].map(([l, f]) => (
                    <button key={l} type="button" onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); f() }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', border: 'none', background: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: l.startsWith('Delete') ? 'var(--ds-red)' : 'var(--ds-text-2)' }}>{l}</button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {!item.anchored && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ds-text-3)' }}>The text this was on was deleted.</div>}
      {isNew || editing ? (
        <div style={{ marginTop: 8 }}>
          <Composer autoFocus initial={c.text} placeholder="Comment" submitLabel={isNew ? 'Comment' : 'Save'}
            onSubmit={t => { api.edit(c.id, t); setEditing(false) }}
            onCancel={() => { if (isNew) api.remove(c.id); else setEditing(false) }} />
        </div>
      ) : (
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ds-text)', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.text}</div>
      )}
      {(c.replies || []).map(r => (
        <div key={r.id} style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--ds-border)' }}>
          <Who name={r.by} uid={r.uid} at={r.at} />
          <div style={{ marginTop: 6, fontSize: 13, color: 'var(--ds-text)', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.text}</div>
        </div>
      ))}
      {active && !isNew && !editing && (
        <div style={{ marginTop: 10 }}>
          <Composer placeholder="Reply" submitLabel="Reply" onSubmit={t => api.reply(c.id, t)} />
        </div>
      )}
      {!active && (c.replies || []).length > 0 && null}
    </>
  )
/* Cards re-render only when what they show changes — typing re-lays out the
   page on every key, and 200 cards re-rendered each time made typing slow. */
}, (a, b) => a.item.thread === b.item.thread && a.item.anchored === b.item.anchored && a.active === b.active)

const ChangeCard = memo(function ChangeCard({ item, active, api }) {
  const ch = item.change
  const text = ch.text.length > 90 ? ch.text.slice(0, 88) + '…' : ch.text
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}><Who name={ch.by} uid={ch.uid} at={ch.at} /></div>
        <IconBtn title="Accept" onClick={() => api.accept(ch.el)}>✓</IconBtn>
        <IconBtn title="Reject" onClick={() => api.reject(ch.el)} danger>✕</IconBtn>
      </div>
      <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ds-text-2)', lineHeight: 1.45, wordBreak: 'break-word' }}>
        <b style={{ fontWeight: 600, color: 'var(--ds-text)' }}>{ch.kind === 'ins' ? 'Inserted' : 'Deleted'}:</b>{' '}
        <span style={{ textDecoration: ch.kind === 'del' ? 'line-through' : 'none' }}>“{text || ' '}”</span>
      </div>
      {active && null}
    </>
  )
}, (a, b) => {
  const x = a.item.change, y = b.item.change
  return a.active === b.active && x.el === y.el && x.text === y.text && x.kind === y.kind && x.by === y.by && x.at === y.at && x.uid === y.uid
})

export default function DocRail({ items, activeId, left, width, onActivate: onActivateProp, api: apiProp }) {
  const refs = useRef(new Map())
  const [tops, setTops] = useState(() => new Map())
  /* Stable handles for the memoised cards, always calling the latest. */
  const latest = useRef({ api: apiProp, onActivate: onActivateProp })
  useEffect(() => { latest.current = { api: apiProp, onActivate: onActivateProp } })
  const api = useMemo(() => new Proxy({}, { get: (_, k) => (...a) => latest.current.api[k](...a) }), [])
  const onActivate = useMemo(() => id => latest.current.onActivate(id), [])
  /* Re-stack when positions, the active card or a card's height change —
     not on every render (it measures every card). */
  const [sizeTick, setSizeTick] = useState(0)
  const ro = useRef(null)
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined
    ro.current = new ResizeObserver(() => setSizeTick(t => t + 1))
    refs.current.forEach(el => ro.current.observe(el))
    return () => ro.current?.disconnect()
  }, [])
  const key = items.map(i => `${i.id}:${Math.round(i.y)}`).join('|')
  useLayoutEffect(() => {
    const measured = items.map(i => ({ id: i.id, y: i.y, h: refs.current.get(i.id)?.offsetHeight || 60 }))
    const next = stackCards(measured, activeId, 8)
    let same = next.size === tops.size
    if (same) for (const [k, v] of next) if (Math.abs((tops.get(k) ?? -1e9) - v) > 0.5) { same = false; break }
    if (!same) setTops(next)
  }, [key, activeId, sizeTick]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div data-ds-rail="" style={{ position: 'absolute', left, top: 0, width, pointerEvents: 'none' }}>
      {items.map(item => {
        const active = item.id === activeId
        const top = tops.get(item.id) ?? item.y
        return (
          <div key={item.id} ref={el => {
              const old = refs.current.get(item.id)
              if (old && old !== el) ro.current?.unobserve(old)
              if (el) { if (old !== el) ro.current?.observe(el); refs.current.set(item.id, el) } else refs.current.delete(item.id)
            }}
            data-ds-card={item.id}
            onMouseDown={e => { e.stopPropagation(); if (!active) onActivate(item.id) }}
            style={{
              position: 'absolute', left: 0, top, width, boxSizing: 'border-box', padding: CARD_W_PAD,
              pointerEvents: 'auto', cursor: active ? 'default' : 'pointer',
              background: 'var(--ds-surface)', borderRadius: 8,
              border: `1px solid ${active ? 'var(--ds-accent)' : 'var(--ds-border)'}`,
              boxShadow: active ? 'var(--ds-shadow-md)' : 'var(--ds-shadow-sm)',
              transform: active ? 'translateX(-8px)' : 'none',
              transition: 'top 160ms var(--ds-ease-standard), transform 160ms var(--ds-ease-standard), box-shadow 160ms',
              fontFamily: 'var(--ds-font-body)',
            }}>
            {item.type === 'change' && <span aria-hidden="true" style={{ position: 'absolute', left: -1, top: -1, bottom: -1, width: 4, borderRadius: '8px 0 0 8px', background:`hsl(${authorHue(item.change.uid)} 60% 45%)` }} />}
            {item.type === 'comment'
              ? <CommentCard item={item} active={active} onActivate={onActivate} api={api} />
              : <ChangeCard item={item} active={active} api={api} />}
          </div>
        )
      })}
    </div>
  )
}
