'use client'
/* ── AGENT CHAT BLOCK ──────────────────────────────────────────────────────
   One conversation with one agent, as its own block on the canvas.

   Everything the agent does shows up here, in order:
     · its reply, streamed as it is written
     · the steps it took, folded into one line until you open them
     · QUESTION cards (several questions, pick or type your own)
     · PERMISSION cards (tick what you allow: once, for this chat, always)
     · SUGGESTION cards: text edits per paragraph, table edits per row —
       nothing lands in a block until you accept it, and accepting is undoable

   The state lives in lib/agent/session.js, not here, so a chat block and its
   agent block are two views of the same objects. */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../ui/Icon'
import {
  getAgent, getChat, loadAgent, loadChat, send, answer, stop, retry, isRunning, setChatOpen, patchChat, setCardStates,
} from '../../lib/agent/session.js'
import { MODELS, EFFORTS, modelById, estimateRange, PERM_LABEL, diffWords, colLetter, tableReviewRows, applyTableEdits } from '../../lib/agent/core.js'
import { applyTextCard, pendingToolUses } from '../../lib/agent/runner.js'
import { FONT, MONO, Spark, Btn, Label, Note, Spinner, Pill, RichText, useAgentSession, stop as halt } from './agent/ui'

const STEP_TOOLS = new Set(['list_blocks', 'read_block', 'create_block', 'move_block', 'delete_block'])

function stepLine(use, card) {
  const i = use.input || {}
  switch (use.name) {
    case 'list_blocks': return { icon: 'view-overview', title: 'Read the sheet map' }
    case 'read_block': return { icon: 'nav-search', title: 'Read a block', detail: i.block_id }
    case 'create_block': return { icon: 'action-add', title: `Created ${i.type || 'a block'}${i.name ? ` “${i.name}”` : ''}`, blockId: card?.blockId }
    case 'move_block': return { icon: 'handle-grip', title: `Moved ${card?.blockName ? `“${card.blockName}”` : 'a block'}`, blockId: i.block_id }
    case 'delete_block': return { icon: 'action-delete', title: card ? `Deleted “${card.blockName}”` : 'Tried to delete a block' }
    default: return { icon: 'status-info', title: use.name }
  }
}

/* Turn the transcript into things to draw. Consecutive steps fold into one
   group; cards stand on their own. */
function buildView(chat) {
  const items = []
  let steps = null
  const flush = () => { if (steps) { items.push(steps); steps = null } }
  const addStep = s => { if (!steps) steps = { kind: 'steps', key: `s${items.length}`, list: [] }; steps.list.push(s) }
  const results = new Map()
  for (const m of chat.transcript) if (m.role === 'user') for (const c of m.content || []) if (c.type === 'tool_result') results.set(c.tool_use_id, c)

  chat.transcript.forEach((m, mi) => {
    if (m.role === 'user') {
      const texts = (m.content || []).filter(c => c.type === 'text' && !c.text.startsWith('<sheet_map>'))
      if (texts.length) { flush(); items.push({ kind: 'user', key: `u${mi}`, text: texts.map(t => t.text).join('\n\n') }) }
      return
    }
    const content = m.content || []
    content.forEach((c, ci) => {
      const k = `${mi}-${ci}`
      if (c.type === 'text') { if (c.text.trim()) { flush(); items.push({ kind: 'text', key: k, text: c.text, credits: ci === content.length - 1 || !content.slice(ci + 1).some(x => x.type === 'text') ? m.credits : null, model: m.model }) } return }
      if (c.type === 'server_tool_use') { addStep({ key: k, icon: 'nav-search', title: 'Searched the web', detail: c.input?.query }); return }
      if (c.type === 'web_search_tool_result') {
        const hits = Array.isArray(c.content) ? c.content.filter(r => r.type === 'web_search_result').slice(0, 5) : []
        if (hits.length) addStep({ key: k, sources: hits.map(h => ({ title: h.title, url: h.url })) })
        return
      }
      if (c.type !== 'tool_use') return
      const card = chat.cards[c.id]
      const perms = Object.entries(chat.cards).filter(([id, cd]) => cd.kind === 'perm' && (id === c.id || id.startsWith(`${c.id}:`)))
      const res = results.get(c.id)
      if (STEP_TOOLS.has(c.name)) {
        for (const [id, cd] of perms) { flush(); items.push({ kind: 'perm', key: id, id, card: cd }) }
        const s = stepLine(c, card)
        addStep({ key: k, ...s, error: res?.is_error ? String(res.content).split('.')[0] : null, live: !res && isRunning(chat.id) })
        return
      }
      flush()
      for (const [id, cd] of perms) if (id !== c.id) items.push({ kind: 'perm', key: id, id, card: cd })
      if (c.name === 'request_permissions' && card) items.push({ kind: 'perm', key: c.id, id: c.id, card })
      else if (c.name === 'ask_user' && card) items.push({ kind: 'questions', key: c.id, id: c.id, card })
      else if (c.name === 'suggest_text_edits' && card) items.push({ kind: 'textReview', key: c.id, id: c.id, card })
      else if (c.name === 'suggest_table_edits' && card) items.push({ kind: 'tableReview', key: c.id, id: c.id, card })
      else if (c.name === 'delegate') items.push({ kind: 'sub', key: c.id, id: c.id, run: chat.subRuns?.[c.id] })
      else if (res?.is_error) addStep({ key: k, icon: 'status-warning', title: c.name.replace(/_/g, ' '), error: String(res.content).split('.')[0] })
    })
  })
  flush()
  return items
}

/* ── cards ───────────────────────────────────────────────────────────────── */

function Steps({ c, group, live }) {
  const [open, setOpen] = useState(false)
  const shown = open || live
  const count = group.list.filter(s => !s.sources).length
  return (
    <div style={{ border: `1.5px solid ${c.borderDim}`, borderRadius: 10, overflow: 'hidden' }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={shown}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none', background: 'transparent', padding: '7px 10px', cursor: 'pointer', color: c.text2, fontFamily: FONT, fontSize: 12, textAlign: 'left' }}>
        {live ? <Spinner c={c} /> : <Icon name={shown ? 'nav-chevron-down' : 'nav-chevron-right'} size={12} />}
        <span>{live ? `Working · ${count} step${count === 1 ? '' : 's'}` : `${count} step${count === 1 ? '' : 's'}`}</span>
      </button>
      {shown && (
        <ol style={{ listStyle: 'none', margin: 0, padding: '2px 10px 8px', display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${c.borderDim}` }}>
          {group.list.map(s => s.sources ? (
            <li key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 22 }}>
              {s.sources.map((h, i) => (
                <a key={i} href={h.url} target="_blank" rel="noopener noreferrer" onPointerDown={halt}
                  style={{ fontFamily: FONT, fontSize: 12, color: c.accentText, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.title || h.url}</a>
              ))}
            </li>
          ) : (
            <li key={s.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', paddingTop: 4, fontFamily: FONT, fontSize: 12, color: c.text2 }}>
              <span style={{ width: 14, display: 'grid', placeItems: 'center', color: s.error ? c.red : c.text3, marginTop: 1 }}>{s.live ? <Spinner c={c} /> : <Icon name={s.error ? 'status-warning' : s.icon} size={12} />}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ color: c.text, fontWeight: 500 }}>{s.title}</span>
                {s.detail && <span style={{ fontFamily: MONO, fontSize: 11, color: c.text3 }}> {String(s.detail).slice(0, 80)}</span>}
                {s.error && <div style={{ color: c.red }}>{s.error}</div>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function CardShell({ c, tone = 'accent', head, right, children, foot }) {
  const ring = tone === 'warn' ? c.amber : c.accent
  const glow = tone === 'warn' ? c.amberBg : c.accentDim
  return (
    <div role="group" style={{ border: `1.5px solid ${ring}`, borderRadius: 12, overflow: 'hidden', background: c.surface, boxShadow: `0 0 0 3px ${glow}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: `1px solid ${c.borderDim}`, fontFamily: FONT, fontSize: 13, fontWeight: 600, color: c.text }}>
        {head}<span style={{ marginLeft: 'auto', fontWeight: 400, fontSize: 12, color: c.text3 }}>{right}</span>
      </div>
      {children}
      {foot && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '9px 12px', background: c.raised, borderTop: `1px solid ${c.borderDim}` }}>{foot}</div>}
    </div>
  )
}

function Done({ c, icon, children, onManage }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', border: `1.5px dashed ${c.borderDim}`, borderRadius: 10, fontFamily: FONT, fontSize: 12, color: c.text2 }}>
      <Icon name={icon} size={14} /><span style={{ minWidth: 0, flex: 1 }}>{children}</span>
      {onManage && <Btn c={c} kind="ghost" size="sm" onClick={onManage}>Manage</Btn>}
    </div>
  )
}

function QuestionCard({ c, card, agentName, onAnswer }) {
  const [sel, setSel] = useState(() => card.qs.map(() => null))
  const [custom, setCustom] = useState(() => card.qs.map(() => ''))
  if (card.status !== 'pending') {
    if (card.status === 'skipped') return <Done c={c} icon="status-info">Questions skipped</Done>
    const v = card.value || {}
    return (
      <div style={{ borderLeft: `2px solid ${c.accent}`, padding: '2px 0 2px 10px', fontFamily: FONT, fontSize: 12, color: c.text2, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {v.decide ? <span>You let {agentName} decide.</span> : card.qs.map((q, i) => <span key={i}>{q.q} <b style={{ color: c.text, fontWeight: 500 }}>{v.answers?.[i]}</b></span>)}
      </div>
    )
  }
  const ready = card.qs.every((_, i) => sel[i] != null && (sel[i] !== 'other' || custom[i].trim()))
  const pick = (qi, v) => setSel(s => s.map((x, i) => (i === qi ? v : x)))
  return (
    <CardShell c={c} head={<><Spark size={14} color={c.accent} />{agentName} is asking</>} right={`${card.qs.length} question${card.qs.length > 1 ? 's' : ''}`}
      foot={<>
        <Btn c={c} kind="ghost" size="sm" onClick={() => onAnswer({ decide: true })}>Skip, you decide</Btn>
        <span style={{ flex: 1 }} />
        <Btn c={c} kind="primary" size="sm" disabled={!ready}
          onClick={() => onAnswer({ answers: card.qs.map((q, i) => (sel[i] === 'other' ? custom[i].trim() : q.opts[sel[i]].label)) })}>Send answers</Btn>
      </>}>
      {card.qs.map((q, qi) => (
        <div key={qi} style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6, borderTop: qi ? `1px solid ${c.borderDim}` : 'none' }}>
          <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: c.text }}>{q.q}</div>
          {[...q.opts.map((o, oi) => ({ oi, o })), { oi: 'other' }].map(({ oi, o }, idx) => {
            const on = sel[qi] === oi
            const box = {
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer',
              padding: '7px 10px', borderRadius: 8, fontFamily: FONT, fontSize: 13, color: c.text,
              border: `1.5px solid ${on ? c.accent : c.borderDim}`, background: on ? c.accentDim : c.base,
            }
            const kbd = <span style={{ width: 18, height: 18, borderRadius: 4, display: 'grid', placeItems: 'center', flexShrink: 0, fontFamily: MONO, fontSize: 11, background: on ? c.accent : c.raised, color: on ? c.base : c.text2 }}>{idx + 1}</span>
            if (oi === 'other') return (
              <label key="other" style={box}>
                {kbd}
                <input value={custom[qi]} placeholder="Something else…" onPointerDown={halt} onKeyDown={halt}
                  onChange={e => { const v = e.target.value; setCustom(s => s.map((x, i) => (i === qi ? v : x))); pick(qi, v.trim() ? 'other' : null) }}
                  style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontFamily: FONT, fontSize: 13, color: c.text, padding: 0 }} />
              </label>
            )
            return (
              <button key={oi} type="button" style={box} onClick={() => pick(qi, oi)}>
                {kbd}<span>{o.label}</span>
                {o.hint && <span style={{ marginLeft: 'auto', fontSize: 12, color: c.text3, textAlign: 'right' }}>{o.hint}</span>}
              </button>
            )
          })}
        </div>
      ))}
    </CardShell>
  )
}

function PermCard({ c, card, onAnswer, onManage }) {
  const [checked, setChecked] = useState(() => card.items.map(i => i.checked !== false))
  const [always, setAlways] = useState(false)
  if (card.status !== 'pending') {
    const v = card.value || {}
    const n = (v.granted || []).length
    const text = card.status === 'skipped' ? 'Permission request closed'
      : v.scope === 'deny' || !n ? 'Denied'
        : `Allowed ${v.scope === 'chat' ? 'for this chat' : v.scope === 'always' ? 'always' : 'once'}: ${(v.granted || []).map(p => PERM_LABEL[p]).join(', ')}`
    return <Done c={c} icon="state-lock" onManage={onManage}>{text}</Done>
  }
  const granted = () => card.items.filter((_, i) => checked[i]).map(i => i.permission)
  return (
    <CardShell c={c} tone="warn" head={<><Icon name="state-lock" size={14} />{card.agentName} needs permission</>} right="Untick to deny"
      foot={<>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: FONT, fontSize: 12, color: c.text2, flexBasis: '100%', cursor: 'pointer' }}>
          <input type="checkbox" checked={always} onChange={e => setAlways(e.target.checked)} style={{ accentColor: c.accent, margin: 0 }} />
          Always allow these for {card.agentName}
        </label>
        <Btn c={c} kind="ghost" size="sm" style={{ marginLeft: 'auto' }} onClick={() => onAnswer({ scope: 'deny', granted: [] })}>Deny</Btn>
        <Btn c={c} size="sm" onClick={() => onAnswer({ scope: always ? 'always' : 'once', granted: granted() })}>Allow once</Btn>
        <Btn c={c} kind="primary" size="sm" onClick={() => onAnswer({ scope: always ? 'always' : 'chat', granted: granted() })}>Allow for this chat</Btn>
      </>}>
      {card.reason && <div style={{ padding: '8px 12px 0', fontFamily: FONT, fontSize: 12, color: c.text2 }}>{card.reason}</div>}
      {card.items.map((it, i) => (
        <label key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 12px', borderBottom: `1px solid ${c.borderDim}`, cursor: 'pointer', fontFamily: FONT, fontSize: 13, color: c.text }}>
          <input type="checkbox" checked={checked[i]} onChange={e => { const v = e.target.checked; setChecked(s => s.map((x, j) => (j === i ? v : x))) }} style={{ accentColor: c.accent, margin: '2px 0 0' }} />
          <span>{PERM_LABEL[it.permission]}<span style={{ display: 'block', fontSize: 12, color: c.text3 }}>{it.detail}</span></span>
        </label>
      ))}
    </CardShell>
  )
}

function Diff({ c, before, after }) {
  const parts = useMemo(() => diffWords(before, after), [before, after])
  return (
    <p style={{ margin: 0, fontFamily: FONT, fontSize: 13, lineHeight: 1.55, color: c.text, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {parts.map((p, i) => p.t === '=' ? <span key={i}>{p.s}</span>
        : p.t === '-' ? <span key={i} style={{ background: c.redBg, color: c.red, textDecoration: 'line-through', borderRadius: 4 }}>{p.s}</span>
          : <span key={i} style={{ background: c.greenBg, color: c.green, borderRadius: 4 }}>{p.s}</span>)}
    </p>
  )
}

function TextReview({ c, card, block, onApply, onReveal, onDecide }) {
  const pending = Object.entries(card.state).filter(([, s]) => s === 'pending').map(([i]) => +i)
  const decide = (idxs, how) => {
    const next = {}
    if (how === 'accept') {
      if (!block) return
      const r = onApply(idxs)
      for (const i of r.appliedIdx || []) next[i] = 'accepted'
      for (const i of r.missedIdx || []) next[i] = 'missing'
    } else for (const i of idxs) next[i] = 'rejected'
    onDecide(next)
  }
  const done = !pending.length
  return (
    <CardShell c={c} head={<><Icon name="block-text" size={14} />{done ? 'Reviewed' : 'Review'} · {card.blockName}</>}
      right={block ? <button type="button" onClick={onReveal} style={{ border: 'none', background: 'transparent', color: c.accentText, cursor: 'pointer', fontFamily: FONT, fontSize: 12 }}>Show block</button> : 'Block deleted'}
      foot={done ? null : <>
        <span style={{ fontFamily: FONT, fontSize: 12, color: c.text2, marginRight: 'auto' }}>{pending.length} of {card.edits.length} waiting</span>
        <Btn c={c} kind="ghost" size="sm" onClick={() => decide(pending, 'reject')}>Reject all</Btn>
        <Btn c={c} kind="primary" size="sm" disabled={!block} onClick={() => decide(pending, 'accept')}>Accept all</Btn>
      </>}>
      {card.summary && <div style={{ padding: '8px 12px 0', fontFamily: FONT, fontSize: 12, color: c.text2 }}>{card.summary}</div>}
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {card.edits.map((e, i) => {
          const st = card.state[i]
          return (
            <div key={i} style={{ border: `1.5px solid ${c.borderDim}`, borderRadius: 8, padding: '8px 10px', background: st === 'pending' ? c.base : 'transparent', opacity: st === 'rejected' ? 0.5 : 1 }}>
              <div style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: c.text3, marginBottom: 4 }}>
                {e.op === 'insert' ? `New paragraph after ¶${e.after + 1}` : e.op === 'delete' ? `Remove ¶${e.index + 1}` : `¶${e.index + 1}`}
              </div>
              <Diff c={c} before={e.before} after={e.op === 'delete' ? '' : e.text} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                {st === 'pending' ? <>
                  <span style={{ flex: 1 }} />
                  <Btn c={c} kind="ghost" size="sm" onClick={() => decide([i], 'reject')}>Reject</Btn>
                  <Btn c={c} size="sm" disabled={!block} onClick={() => decide([i], 'accept')}><Icon name="action-check" size={12} />Accept</Btn>
                </> : <Pill c={c} tone={st === 'accepted' ? 'ok' : 'plain'}>{st === 'accepted' ? 'Accepted' : st === 'rejected' ? 'Rejected' : 'Not found'}</Pill>}
              </div>
            </div>
          )
        })}
      </div>
    </CardShell>
  )
}

function TableReview({ c, card, block, onApply, onReveal, onDecide }) {
  const base = { headers: card.baseHeaders, rows: card.baseRows }
  const rows = useMemo(() => tableReviewRows(base, card.changes), [card]) // eslint-disable-line react-hooks/exhaustive-deps
  const pendingKeys = Object.entries(card.state).filter(([, s]) => s === 'pending').map(([k]) => k)
  const decide = (keys, how) => {
    if (how === 'accept' && block) {
      const rowKeys = keys.filter(k => k !== 'headers').map(k => (/^new/.test(k) ? k : +k))
      onApply(rowKeys, keys.includes('headers'))
    }
    onDecide(Object.fromEntries(keys.map(k => [k, how === 'accept' ? 'accepted' : 'rejected'])))
  }
  const headerName = col => card.changes.headers?.find(h => h.col === col)?.value || card.baseHeaders?.[col] || colLetter(col)
  return (
    <CardShell c={c} head={<><Icon name="block-table" size={14} />{pendingKeys.length ? 'Review' : 'Reviewed'} · {card.blockName}</>}
      right={block ? <button type="button" onClick={onReveal} style={{ border: 'none', background: 'transparent', color: c.accentText, cursor: 'pointer', fontFamily: FONT, fontSize: 12 }}>Show block</button> : 'Block deleted'}
      foot={pendingKeys.length ? <>
        <span style={{ fontFamily: FONT, fontSize: 12, color: c.text2, marginRight: 'auto' }}>{pendingKeys.length} change{pendingKeys.length > 1 ? 's' : ''} waiting</span>
        <Btn c={c} kind="ghost" size="sm" onClick={() => decide(pendingKeys, 'reject')}>Reject all</Btn>
        <Btn c={c} kind="primary" size="sm" disabled={!block} onClick={() => decide(pendingKeys, 'accept')}>Accept all</Btn>
      </> : null}>
      {card.summary && <div style={{ padding: '8px 12px 0', fontFamily: FONT, fontSize: 12, color: c.text2 }}>{card.summary}</div>}
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {card.state.headers && (
          <RowReview c={c} title="New or renamed columns" state={card.state.headers} block={block}
            cells={card.changes.headers.map(h => ({ label: colLetter(h.col), before: card.baseHeaders?.[h.col] || '', after: h.value }))}
            onDecide={how => decide(['headers'], how)} />
        )}
        {rows.map(r => (
          <RowReview key={r.key} c={c} title={r.row == null ? 'New row' : `Row ${r.row + 1}`} state={card.state[r.key]} block={block}
            cells={r.cells.map(x => ({ label: headerName(x.col), before: x.before, after: x.after }))}
            onDecide={how => decide([String(r.key)], how)} />
        ))}
      </div>
    </CardShell>
  )
}

function RowReview({ c, title, cells, state, block, onDecide }) {
  return (
    <div style={{ border: `1.5px solid ${c.borderDim}`, borderRadius: 8, padding: '7px 10px', background: state === 'pending' ? c.base : 'transparent', opacity: state === 'rejected' ? 0.5 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: c.text, marginRight: 'auto' }}>{title}</span>
        {state === 'pending' ? <>
          <Btn c={c} kind="ghost" size="sm" onClick={() => onDecide('reject')}>Reject</Btn>
          <Btn c={c} size="sm" disabled={!block} onClick={() => onDecide('accept')}><Icon name="action-check" size={12} />Accept</Btn>
        </> : <Pill c={c} tone={state === 'accepted' ? 'ok' : 'plain'}>{state === 'accepted' ? 'Accepted' : 'Rejected'}</Pill>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, auto) 1fr', gap: '3px 10px', marginTop: 6, fontFamily: FONT, fontSize: 12 }}>
        {cells.slice(0, 12).map((x, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <span style={{ color: c.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.label}</span>
            <span style={{ color: c.text, overflowWrap: 'anywhere' }}>
              {x.before && <span style={{ color: c.red, textDecoration: 'line-through', marginRight: 6 }}>{x.before}</span>}
              <span style={{ background: c.greenBg, color: c.green, borderRadius: 4, padding: '0 3px' }}>{x.after || '(empty)'}</span>
            </span>
          </div>
        ))}
        {cells.length > 12 && <span style={{ gridColumn: '1 / -1', color: c.text3 }}>…{cells.length - 12} more cells</span>}
      </div>
    </div>
  )
}

function SubRun({ c, run }) {
  const [open, setOpen] = useState(false)
  if (!run) return null
  const status = run.status === 'running' ? <Pill c={c} tone="run">Running</Pill> : run.status === 'done' ? <Pill c={c}>Reported · {run.credits || 0} credits</Pill> : <Pill c={c} tone="bad">{run.status === 'stopped' ? 'Stopped' : 'Failed'}</Pill>
  return (
    <div style={{ border: `1.5px solid ${c.borderDim}`, borderRadius: 10, overflow: 'hidden' }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none', background: 'transparent', padding: '8px 10px', cursor: 'pointer', fontFamily: FONT, fontSize: 12, color: c.text2, textAlign: 'left' }}>
        <Icon name="block-agent" size={14} /><span style={{ color: c.text, fontWeight: 500 }}>{run.name}</span><span>· {modelById(run.model).name}</span>
        <span style={{ marginLeft: 'auto' }}>{status}</span>
      </button>
      {(open || run.status === 'running') && (
        <div style={{ padding: '4px 12px 10px', borderTop: `1px solid ${c.borderDim}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Label c={c}>Brief</Label>
          <div style={{ fontFamily: FONT, fontSize: 12, color: c.text2, whiteSpace: 'pre-wrap' }}>{run.brief}</div>
          {run.live?.text && <RichText c={c} text={run.live.text} streaming />}
          {run.report && <><Label c={c}>Report</Label><RichText c={c} text={run.report} /></>}
        </div>
      )}
    </div>
  )
}

/* ── the block ───────────────────────────────────────────────────────────── */

function AgentChatBlockInner({ block, colors: c, host, sheet, onUpdateBlock, onReveal, onOpenAgentSettings }) {
  useAgentSession()
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState(false)
  const [missing, setMissing] = useState(false)
  const scrollRef = useRef(null)
  const stickRef = useRef(true)
  const agent = getAgent(block.agentId)
  const chat = getChat(block.chatId)

  useEffect(() => {
    if (!host) return
    loadAgent(host, block.agentId).catch(() => {})
    loadChat(host, block.chatId).then(ch => { if (!ch) setMissing(true) }).catch(() => setMissing(true))
  }, [host, block.agentId, block.chatId])

  /* Name follows the chat until the person renames the block. */
  useEffect(() => {
    if (!chat) return
    if (!block.name && chat.name && chat.name !== 'New chat') onUpdateBlock({ name: chat.name })
    else if (block.name && block.name !== chat.name) patchChat(host, chat, { name: block.name })
  }, [chat?.name, block.name]) // eslint-disable-line react-hooks/exhaustive-deps

  /* The block is open; the chat should say so (history shows it as open). */
  useEffect(() => {
    if (chat && (chat.open === false || chat.blockId !== block.id)) setChatOpen(host, chat, true, block.id)
  }, [chat, block.id, host])

  const items = useMemo(() => (chat ? buildView(chat) : []), [chat, chat?.updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  })

  if (!host) return <Center c={c}>Sign in to a Pro or Max account to use agents.</Center>
  if (missing) return <Center c={c}>This chat was deleted.</Center>
  if (!chat || !agent) return <Center c={c}><Spinner c={c} /></Center>

  const running = isRunning(chat.id)
  const waitingOnPerson = pendingToolUses(chat).some(t => chat.cards[t.id]?.status === 'pending')
  const m = modelById(chat.model || agent.model)
  const eff = m.effort ? (chat.effort || agent.effort || 'auto') : null
  const [lo, hi] = estimateRange(m.id, eff || 'high')
  const blocksNow = () => sheet.blocks()
  const findBlock = id => blocksNow().find(b => b.id === id)

  const doSend = () => {
    const t = draft.trim()
    if (!t || running) return
    setDraft('')
    stickRef.current = true
    send(host, chat, t, sheet)
  }

  const applyText = card => idxs => {
    const b = findBlock(card.blockId)
    if (!b) return { applied: 0, missed: idxs.length, appliedIdx: [], missedIdx: idxs }
    const r = applyTextCard(b.content || '', card, idxs)
    if (r.applied) sheet.update(b.id, { content: r.html })
    if (r.missed) host.toast?.(`${r.missed} paragraph${r.missed > 1 ? 's' : ''} changed since the suggestion and ${r.missed > 1 ? 'were' : 'was'} skipped.`)
    return r
  }
  const applyTable = card => (rowKeys, withHeaders) => {
    const b = findBlock(card.blockId)
    if (!b) return
    sheet.update(b.id, applyTableEdits(b, card.changes, { onlyRows: rowKeys, withHeaders }))
  }

  return (
    <div onMouseDown={halt} style={{ display: 'flex', flexDirection: 'column', height: '100%', background: c.surface, fontFamily: FONT }}>
      <div ref={scrollRef} onScroll={e => { const el = e.currentTarget; stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60 }}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div style={{ padding: '14px 14px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!items.length && !chat.live && (
          <Note c={c} icon={<Spark size={14} color={c.accent} />}>
            Ask {agent.name} anything about this sheet. It asks before it acts, and every edit waits for your review.
          </Note>
        )}
        {items.map((it, idx) => {
          const lastSteps = it.kind === 'steps' && idx === items.length - 1 && running
          switch (it.kind) {
            case 'user': return <div key={it.key} style={{ alignSelf: 'flex-end', maxWidth: '86%', background: c.raised, padding: '8px 12px', borderRadius: '12px 12px 4px 12px', fontSize: 14, lineHeight: 1.5, color: c.text, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{it.text}</div>
            case 'text': return (
              <div key={it.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <RichText c={c} text={it.text} />
                {it.credits > 0 && <span style={{ fontSize: 11, color: c.text3 }}>{it.credits} credit{it.credits === 1 ? '' : 's'} · {modelById(it.model || m.id).name}</span>}
              </div>
            )
            case 'steps': return <Steps key={it.key} c={c} group={it} live={lastSteps} />
            case 'questions': return <QuestionCard key={it.key} c={c} card={it.card} agentName={agent.name} onAnswer={v => answer(host, chat, it.id, v, sheet)} />
            case 'perm': return <PermCard key={it.key} c={c} card={it.card} onAnswer={v => answer(host, chat, it.id, v, sheet)} onManage={() => onOpenAgentSettings?.(agent.id, 'permissions')} />
            case 'textReview': return <TextReview key={it.key} c={c} card={it.card} block={findBlock(it.card.blockId)} onApply={applyText(it.card)} onReveal={() => onReveal(it.card.blockId)} onDecide={st => setCardStates(host, chat, it.id, st)} />
            case 'tableReview': return <TableReview key={it.key} c={c} card={it.card} block={findBlock(it.card.blockId)} onApply={applyTable(it.card)} onReveal={() => onReveal(it.card.blockId)} onDecide={st => setCardStates(host, chat, it.id, st)} />
            case 'sub': return <SubRun key={it.key} c={c} run={it.run} />
            default: return null
          }
        })}
        {chat.live?.text ? <RichText c={c} text={chat.live.text} streaming /> : running && !waitingOnPerson && !items.some((x, i) => x.kind === 'steps' && i === items.length - 1) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: c.text3 }}><Spinner c={c} />Thinking…</div>
        )}
        {chat.error && (
          <Note c={c} tone="error" icon={<Icon name="status-warning" size={14} />}>
            {chat.error}{' '}
            <button type="button" onClick={() => retry(host, chat, sheet)} style={{ border: 'none', background: 'transparent', color: c.red, textDecoration: 'underline', cursor: 'pointer', fontFamily: FONT, fontSize: 12, padding: 0 }}>Try again</button>
          </Note>
        )}
        </div>
      </div>

      <div onPointerDown={halt} style={{ flexShrink: 0, borderTop: `1px solid ${c.borderDim}`, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
        <textarea data-chat-composer value={draft} disabled={running && !waitingOnPerson}
          placeholder={waitingOnPerson ? `Answer above, or type to redirect ${agent.name}…` : `Reply to ${agent.name}…`}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend() } }}
          rows={2}
          style={{ resize: 'none', border: `1.5px solid ${c.border}`, borderRadius: 10, background: c.base, color: c.text, fontFamily: FONT, fontSize: 14, lineHeight: 1.45, padding: '8px 11px', outline: 'none', minHeight: 56 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <button type="button" onClick={() => setMenu(v => !v)} aria-haspopup="menu" aria-expanded={menu}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 9px', borderRadius: 6, border: `1.5px solid ${c.borderDim}`, background: 'transparent', color: c.text2, fontFamily: FONT, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden' }}>
            <Spark size={12} color={c.accent} />{m.name}{eff ? ` · ${EFFORTS.find(e => e[0] === eff)?.[1]} effort` : ''}
            <Icon name="nav-chevron-down" size={12} />
          </button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: c.text3, whiteSpace: 'nowrap' }}>{running ? `${chat.taskCredits || 0} credits so far` : `≈ ${lo}–${hi} credits`}</span>
          <button type="button" aria-label={running ? 'Stop' : 'Send'} onClick={() => (running ? stop(chat) : doSend())}
            style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0, background: running ? c.raised : c.text, color: running ? c.text : c.base }}>
            {running
              ? <span style={{ width: 10, height: 10, borderRadius: 4, background: 'currentColor' }} />
              : <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </button>
        </div>
        {menu && (
          <ModelMenu c={c} chat={chat} agent={agent} plan={host.plan}
            onPick={patch => patchChat(host, chat, patch)}
            onClose={() => setMenu(false)} />
        )}
      </div>
    </div>
  )
}

function ModelMenu({ c, chat, agent, plan, onPick, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const off = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const esc = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('pointerdown', off, true)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('pointerdown', off, true); window.removeEventListener('keydown', esc) }
  }, [onClose])
  const cur = modelById(chat.model || agent.model)
  const eff = chat.effort || agent.effort || 'auto'
  const row = (on, title, sub, right, onClick, disabled) => (
    <button type="button" disabled={disabled} onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none', background: 'transparent', borderRadius: 6, padding: '6px 8px', textAlign: 'left', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1, fontFamily: FONT, color: c.text }}>
      <span style={{ width: 14, color: c.accentText }}>{on && <Icon name="action-check" size={12} />}</span>
      <span style={{ flex: 1, minWidth: 0 }}><span style={{ fontSize: 13 }}>{title}</span><span style={{ display: 'block', fontSize: 11, color: c.text3 }}>{sub}</span></span>
      {right && <span style={{ fontFamily: MONO, fontSize: 11, color: c.text3 }}>{right}</span>}
    </button>
  )
  return (
    <div ref={ref} role="menu" style={{ position: 'absolute', left: 10, bottom: 48, zIndex: 5, width: 280, maxWidth: 'calc(100% - 20px)', background: c.surface, border: `1.5px solid ${c.border}`, borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.18)', padding: 6 }}>
      <Label c={c} style={{ padding: '4px 8px 2px' }}>Model</Label>
      {MODELS.map(x => row(cur.id === x.id, x.name, x.desc + (x.plan === 'max' && plan !== 'max' ? ' · Max plan' : ''), x.mult,
        () => { onPick({ model: x.id, effort: x.effort ? (chat.effort && chat.effort !== null ? chat.effort : 'auto') : null }); }, x.plan === 'max' && plan !== 'max'))}
      <div style={{ borderTop: `1px solid ${c.borderDim}`, margin: '6px 0' }} />
      <Label c={c} style={{ padding: '2px 8px' }}>Effort</Label>
      {cur.effort
        ? EFFORTS.map(([v, l, d]) => row(eff === v, l, d, v === cur.defEffort ? 'default' : '', () => { onPick({ effort: v }); onClose() }))
        : <div style={{ padding: '4px 8px 6px', fontSize: 12, color: c.text3, fontFamily: FONT }}>Haiku 4.5 has one effort level.</div>}
    </div>
  )
}

function Center({ c, children }) {
  return <div style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 20, textAlign: 'center', fontFamily: FONT, fontSize: 13, color: c.text2, background: c.surface }}>{children}</div>
}

export default memo(AgentChatBlockInner)
