'use client'
/* ── AGENT BLOCK ───────────────────────────────────────────────────────────
   An agent's home on the canvas: who it is, what it may do, what it costs,
   and every conversation it has had. Chats open as their own blocks beside
   it; sub-agents are agent blocks of their own with a parent.

   PRIVATE. The block on the canvas stores only { agentId, ownerId }. The
   settings and chats live in the owner's rows (migration 0012), and the
   canvas does not render this block for anybody else at all.

   Sections, in the rail on the left:
     Overview · Chats · Model & effort · Instructions · Permissions
     Sub-agents · Usage & limits · Privacy */
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from '../ui/Icon'
import {
  getAgent, loadAgent, createAgent, updateAgent, loadChats, chatsOf, createChat, deleteChat, send,
  setChatOpen, subagentsOf, getBalance, setBalance, isRunning, agentSection, requestSection, runsOf, revokeGrants,
} from '../../lib/agent/session.js'
import { MODELS, EFFORTS, PERMS, PERM_LABEL, modelById, visibleBlocks, effectivePerm } from '../../lib/agent/core.js'
import { needsPerson, openSuggestions } from '../../lib/agent/runner.js'
import { FONT, MONO, Spark, Btn, Seg, Label, Note, Spinner, Pill, useAgentSession, permTone, stop as halt } from './agent/ui'

const SECTIONS = [
  ['overview', 'Overview', 'view-grid'],
  ['chats', 'Chats', 'history-version'],
  ['model', 'Model & effort', 'settings-gear'],
  ['instructions', 'Instructions', 'action-rename'],
  ['permissions', 'Permissions', 'state-lock'],
  ['subagents', 'Sub-agents', 'share-people'],
  ['usage', 'Usage & limits', 'tool-statistics'],
  ['privacy', 'Privacy', 'status-info'],
]
const STARTERS = ['Polish the selected note', 'Summarise this sheet', 'Build a prototype in an HTML block', 'Check this table for errors']
const creating = new Set()

const ago = t => {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function chatStatus(ch) {
  if (needsPerson(ch)) return ['ask', 'Needs you']
  if (isRunning(ch.id)) return ['run', 'Running']
  if (openSuggestions(ch).length) return ['ask', 'To review']
  return null
}

function AgentBlockInner({ block, colors: c, host, sheet, onUpdateBlock, onReveal }) {
  useAgentSession()
  const agent = block.agentId ? getAgent(block.agentId) : null
  const [loadErr, setLoadErr] = useState(null)

  /* A new block creates its agent. Guarded per block id: StrictMode mounts
     twice and a double click is two clicks; both must make ONE agent. */
  useEffect(() => {
    if (!host || block.agentId || creating.has(block.id)) return
    creating.add(block.id)
    createAgent(host, { name: block.name || 'Agent', parentId: block.parentAgentId || null })
      .then(a => onUpdateBlock({ agentId: a.id, ownerId: host.userId, name: block.name || a.name }))
      .catch(err => setLoadErr(err?.message || 'Could not create the agent.'))
      .finally(() => creating.delete(block.id))
  }, [host, block.agentId, block.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!host || !block.agentId) return
    loadAgent(host, block.agentId).then(a => { if (!a) setLoadErr('This agent was deleted.') }).catch(err => setLoadErr(err?.message))
    loadChats(host, block.agentId).catch(() => {})
    host.fetchBalance?.().then(r => r?.balance && setBalance(r.balance))
  }, [host, block.agentId])

  /* Sub-agents' chats hold their runs; load the parent's too. */
  useEffect(() => { if (host && agent?.parentId) loadChats(host, agent.parentId).catch(() => {}) }, [host, agent?.parentId])


  /* The block title follows the agent's name. */
  useEffect(() => {
    if (agent && agent.name && block.name !== agent.name) onUpdateBlock({ name: agent.name })
  }, [agent?.name]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!host) return <Center c={c}>Sign in to a Pro or Max account to use agents.</Center>
  if (loadErr) return <Center c={c}>{loadErr}</Center>
  if (!agent) return <Center c={c}><Spinner c={c} /></Center>

  /* The open section lives in the session, so "Manage" on a permission card
     in a chat block can open this block on Permissions. */
  const section = agentSection(agent.id)
  const setSection = s => requestSection(agent.id, s)
  const isSub = !!agent.parentId
  const parent = isSub ? getAgent(agent.parentId) : null
  const chats = chatsOf(agent.id)
  const subs = subagentsOf(agent.id)
  const set = patch => updateAgent(host, agent.id, patch)
  const secs = SECTIONS.filter(([id]) => !(isSub && (id === 'subagents' || id === 'chats')))
  const cur = secs.some(s => s[0] === section) ? section : 'overview'
  const waiting = chats.filter(ch => ch.open && chatStatus(ch)?.[0] === 'ask').length

  /* ── actions ── */
  const openChatBlock = (ch, i = 0) => {
    const exists = ch.blockId && sheet.blocks().some(b => b.id === ch.blockId)
    if (exists) { onReveal(ch.blockId); return }
    const openCount = chats.filter(x => x.open && x.blockId && sheet.blocks().some(b => b.id === x.blockId)).length + i
    const id = sheet.add('agentchat', {
      x: (block.x || 0) + (block.w || 720) + 32 + openCount * 28,
      y: (block.y || 0) + openCount * 28,
      w: 440, h: 640,
      patch: { chatId: ch.id, agentId: agent.id, ownerId: host.userId, name: ch.name === 'New chat' ? '' : ch.name },
    })
    setChatOpen(host, ch, true, id)
    setTimeout(() => onReveal(id), 60)
  }
  const newChat = async (text) => {
    const ch = await createChat(host, agent.id)
    openChatBlock(ch)
    if (text) send(host, ch, text, sheet)
  }
  const addSub = async () => {
    const names = ['Researcher', 'Writer', 'Analyst', 'Reviewer', 'Coder']
    const taken = new Set(subs.map(s => s.name))
    const name = names.find(n => !taken.has(n)) || `Helper ${subs.length + 1}`
    const sub = await createAgent(host, { name, parentId: agent.id, model: 'haiku', role: name === 'Researcher' ? 'Finds facts and cites sources' : '' })
    const id = sheet.add('agent', {
      x: (block.x || 0), y: (block.y || 0) + (block.h || 760) + 40 + subs.length * 40, w: 640, h: 560,
      patch: { agentId: sub.id, ownerId: host.userId, name: sub.name },
    })
    setTimeout(() => onReveal(id), 60)
  }

  const head = (title, lead, right = null) => (
    <div style={{ padding: '16px 18px 12px', borderBottom: `1px solid ${c.borderDim}`, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONT, fontSize: 16, fontWeight: 600, color: c.text }}>{title}</div>
        {lead && <div style={{ fontFamily: FONT, fontSize: 13, color: c.text2, marginTop: 2, lineHeight: 1.45 }}>{lead}</div>}
      </div>
      {right}
    </div>
  )
  const sec = (children, key) => <div key={key} style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 8, borderBottom: `1px solid ${c.borderDim}` }}>{children}</div>

  return (
    <div onMouseDown={halt} style={{ display: 'grid', gridTemplateColumns: '184px 1fr', height: '100%', background: c.surface, fontFamily: FONT, minHeight: 0 }}>
      <nav aria-label="Agent sections" onPointerDown={halt} style={{ borderRight: `1px solid ${c.borderDim}`, background: c.base, padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px 10px' }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: c.accentDim, display: 'grid', placeItems: 'center' }}><Spark size={16} color={c.accent} /></span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.name}</span>
            <span style={{ display: 'block', fontSize: 11, color: c.text3 }}>{isSub ? `Sub-agent of ${parent?.name || '…'}` : modelById(agent.model).name}</span>
          </span>
        </div>
        {secs.map(([id, label, icon]) => {
          const on = cur === id
          let count = null
          if (id === 'chats') count = waiting ? <span style={{ fontSize: 11, fontWeight: 600, color: c.amber }}>{waiting} waiting</span> : <span style={{ fontFamily: MONO, fontSize: 11, color: c.text3 }}>{chats.filter(x => x.open).length}</span>
          if (id === 'subagents') count = <span style={{ fontFamily: MONO, fontSize: 11, color: c.text3 }}>{subs.length}</span>
          if (id === 'permissions') count = <span style={{ fontFamily: MONO, fontSize: 11, color: c.text3 }}>{PERMS.filter(([k]) => effectivePerm(agent, k, { parent }) === 'allow').length}/{PERMS.length}</span>
          return (
            <button key={id} type="button" onClick={() => setSection(id)} aria-current={on ? 'page' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 9, border: 'none', borderRadius: 8, padding: '7px 9px', cursor: 'pointer', textAlign: 'left', fontFamily: FONT, fontSize: 13, color: on ? c.text : c.text2, fontWeight: on ? 500 : 400, background: on ? c.surface : 'transparent', boxShadow: on ? `inset 0 0 0 1.5px ${c.borderDim}` : 'none' }}>
              <Icon name={icon} size={14} /><span style={{ flex: 1 }}>{label}</span>{count}
            </button>
          )
        })}
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 9px 2px', fontSize: 11, color: c.text3 }}><Icon name="state-lock" size={12} />Private to you</div>
      </nav>

      <div onPointerDown={halt} style={{ overflowY: 'auto', minWidth: 0, minHeight: 0 }}>
        {cur === 'overview' && <>
          <div style={{ padding: '16px 18px 12px', borderBottom: `1px solid ${c.borderDim}`, display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ width: 44, height: 44, borderRadius: 12, background: c.accentDim, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Spark size={20} color={c.accent} /></span>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Field c={c} value={agent.name} onChange={v => set({ name: v.slice(0, 60) || 'Agent' })} big aria="Agent name" />
              <Field c={c} value={agent.role} placeholder="What this agent is for" onChange={v => set({ role: v.slice(0, 160) })} aria="Short description" />
            </div>
          </div>
          {sec(<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
            <Stat c={c} n={(isSub ? runsOf(agent.id) : chats).reduce((s, x) => s + (x.credits || 0), 0)} label="credits used" />
            <Stat c={c} n={isSub ? runsOf(agent.id).length : chats.length} label={isSub ? 'runs' : 'chats'} />
            {isSub
              ? <Stat c={c} n={runsOf(agent.id).length ? Math.round(runsOf(agent.id).reduce((s, x) => s + (x.credits || 0), 0) / runsOf(agent.id).length) : '—'} label="credits per run" />
              : <Stat c={c} n={acceptRate(chats)} label="suggestions accepted" />}
          </div>, 'stats')}
          {!isSub && sec(<>
            <Label c={c}>Ask {agent.name}</Label>
            <QuickAsk c={c} onSend={t => newChat(t)} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {STARTERS.map(s => <button key={s} type="button" onClick={() => newChat(s)} style={{ border: `1.5px solid ${c.borderDim}`, background: c.base, borderRadius: 8, padding: '5px 10px', fontFamily: FONT, fontSize: 12, color: c.text2, cursor: 'pointer' }}>{s}</button>)}
            </div>
          </>, 'ask')}
          {isSub && sec(<Note c={c} icon={<Icon name="share-people" size={14} />}>{parent?.name || 'Its parent'} hands {agent.name} a short brief. It works on its own, never sees the whole conversation, and reports back once.</Note>, 'subnote')}
          {sec(<>
            <Label c={c}>{isSub ? 'Recent runs' : 'Recent chats'}</Label>
            {(isSub ? runsOf(agent.id).slice(0, 6) : chats.slice(0, 6)).map(x => {
              const st = isSub ? null : chatStatus(x)
              return (
                <button key={isSub ? x.toolId : x.id} type="button" onClick={() => (isSub ? null : openChatBlock(x))}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, border: 'none', background: 'transparent', padding: '4px 0', textAlign: 'left', cursor: isSub ? 'default' : 'pointer', fontFamily: FONT }}>
                  <Icon name={isSub ? 'share-people' : 'history-version'} size={14} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isSub ? (x.brief || '').slice(0, 80) : x.name}</span>
                  {st && <Pill c={c} tone={st[0]}>{st[1]}</Pill>}
                  <span style={{ fontSize: 12, color: c.text3, whiteSpace: 'nowrap' }}>{isSub ? `${x.credits || 0} credits` : ago(x.updatedAt)}</span>
                </button>
              )
            })}
            {!(isSub ? runsOf(agent.id).length : chats.length) && <div style={{ fontSize: 12, color: c.text3 }}>Nothing yet.</div>}
          </>, 'recent')}
        </>}

        {cur === 'chats' && <ChatsSection c={c} agent={agent} chats={chats} head={head} sec={sec}
          onNew={() => newChat()} onOpen={openChatBlock} onDelete={id => deleteChat(host, id)} sheet={sheet} />}

        {cur === 'model' && <>
          {head('Model & effort', 'You choose the model. Effort sets how hard it thinks; Auto picks the effort step by step.')}
          {sec(<>
            <Label c={c}>Model</Label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
              {MODELS.map(m => {
                const on = agent.model === m.id
                const locked = m.plan === 'max' && host.plan !== 'max'
                return (
                  <button key={m.id} type="button" disabled={locked} onClick={() => set({ model: m.id, effort: m.effort ? (agent.effort || 'auto') : null })}
                    style={{ position: 'relative', textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: locked ? 'default' : 'pointer', opacity: locked ? 0.5 : 1, display: 'flex', flexDirection: 'column', gap: 3, border: `1.5px solid ${on ? c.accent : c.borderDim}`, background: on ? c.accentDim : c.base, fontFamily: FONT }}>
                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: c.text3 }}>{m.tag}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: c.text }}>{m.name}</span>
                    <span style={{ fontSize: 12, color: c.text2, lineHeight: 1.35 }}>{m.desc}</span>
                    {locked && <span style={{ fontSize: 12, fontWeight: 600, color: c.accentText }}>Max plan</span>}
                    <span style={{ position: 'absolute', right: 10, top: 9, fontFamily: MONO, fontSize: 12, color: c.text2 }}>{m.mult}</span>
                  </button>
                )
              })}
            </div>
            <span style={{ fontSize: 12, color: c.text3 }}>Credit cost compared with Haiku. Each chat can override the model and effort.</span>
          </>, 'm')}
          {sec(<>
            <Label c={c}>Effort</Label>
            {modelById(agent.model).effort ? <>
              <Seg c={c} label="Effort" value={agent.effort || 'auto'} onChange={v => set({ effort: v })}
                options={EFFORTS.map(([v, l]) => [v, v === modelById(agent.model).defEffort ? `${l} · default` : l])} />
              <span style={{ fontSize: 13, color: c.text2 }}>{EFFORTS.find(e => e[0] === (agent.effort || 'auto'))?.[2]}</span>
            </> : <Note c={c}>Haiku 4.5 has one effort level. Pick Sonnet or Opus to control effort.</Note>}
          </>, 'e')}
          {sec(<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 13, color: c.text }}>
            <span>Reply language</span>
            <Select c={c} value={agent.lang} onChange={v => set({ lang: v })} options={[['auto', 'Match my message'], ['en', 'English'], ['lt', 'Lithuanian']]} />
          </div>, 'l')}
        </>}

        {cur === 'instructions' && <InstructionsSection key={agent.id} c={c} agent={agent} set={set} head={head} sec={sec} sheet={sheet} />}

        {cur === 'permissions' && <>
          {head('Permissions', 'Everything starts on Ask first. The agent asks in its chat; you allow once, for that chat, or always.')}
          {sec(<>
            {[agent, ...(isSub ? [] : subs)].map(a => <PermGroup key={a.id} c={c} agent={a} parent={a.parentId ? getAgent(a.parentId) : null} defaultOpen={a.id === agent.id} onSet={(k, v) => {
              updateAgent(host, a.id, { perms: { [k]: v } })
              if (!a.parentId && v === 'never') for (const s of subagentsOf(a.id)) updateAgent(host, s.id, { perms: { [k]: 'never' } })
            }} />)}
            <span style={{ fontSize: 12, color: c.text3 }}>A sub-agent can never do more than its parent.</span>
          </>, 'groups')}
          {!isSub && sec(<>
            <Label c={c}>Allowed in chats</Label>
            {chats.filter(ch => Object.keys(ch.grants || {}).some(k => k.startsWith(`${agent.id}:`) || subs.some(s => k.startsWith(`${s.id}:`)))).map(ch => (
              <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name="history-version" size={14} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, color: c.text }}>{ch.name}</span>
                  <span style={{ display: 'block', fontSize: 12, color: c.text3 }}>{Object.keys(ch.grants).map(k => PERM_LABEL[k.split(':')[1]]).join(' · ')}</span>
                </span>
                <Btn c={c} size="sm" onClick={() => revokeGrants(host, ch.id)}>Revoke</Btn>
              </div>
            ))}
            {!chats.some(ch => Object.keys(ch.grants || {}).length) && <span style={{ fontSize: 12, color: c.text3 }}>No chat-level permissions right now.</span>}
          </>, 'grants')}
          {sec(<div><Btn c={c} size="sm" onClick={() => {
            const reset = Object.fromEntries(PERMS.map(([k]) => [k, k === 'read' ? 'allow' : 'ask']))
            set({ perms: reset })
            for (const s of subs) updateAgent(host, s.id, { perms: { ...reset, subs: 'never' } })
          }}>Reset to Ask first</Btn></div>, 'reset')}
        </>}

        {cur === 'subagents' && <>
          {head('Sub-agents', `Helpers ${agent.name} can hand work to. Each gets a brief, works on its own and reports back.`, <Btn c={c} kind="primary" size="sm" onClick={addSub}><Icon name="action-add" size={12} />Add sub-agent</Btn>)}
          {sec(<>
            {subs.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                <Icon name="share-people" size={14} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: c.text }}>{s.name}</span>
                  <span style={{ display: 'block', fontSize: 12, color: c.text3 }}>{modelById(s.model).name}{s.effort && modelById(s.model).effort ? ` · ${EFFORTS.find(e => e[0] === s.effort)?.[1]} effort` : ''}{s.role ? ` · ${s.role}` : ''}</span>
                </span>
                <Seg c={c} size="sm" label={`${s.name} model`} value={s.model} onChange={v => updateAgent(host, s.id, { model: v, effort: modelById(v).effort ? (s.effort || 'auto') : null })}
                  options={MODELS.map(m => [m.id, m.name.split(' ')[0], m.plan === 'max' && host.plan !== 'max'])} />
                <Btn c={c} size="sm" onClick={() => { const b = sheet.blocks().find(x => x.type === 'agent' && x.agentId === s.id); if (b) onReveal(b.id) }}>Open</Btn>
              </div>
            ))}
            {!subs.length && <Note c={c}>No sub-agents yet. Add a Researcher on Haiku for cheap fact-finding, or a Writer on Sonnet.</Note>}
            <span style={{ fontSize: 12, color: c.text3 }}>Each sub-agent is its own block with its own instructions, model and permissions.</span>
          </>, 'list')}
        </>}

        {cur === 'usage' && <UsageSection c={c} agent={agent} chats={isSub ? [] : chats} runs={isSub ? runsOf(agent.id) : []} set={set} head={head} sec={sec} plan={host.plan} />}

        {cur === 'privacy' && <>
          {head('Privacy', null)}
          {sec(<>
            <Note c={c} icon={<Icon name="state-lock" size={14} />}>Only you can see this agent, its chats and its settings. People you share this sheet with see an agent block and nothing inside it.</Note>
            <Note c={c} icon={<Icon name="status-info" size={14} />}>To answer you, the blocks it reads are sent to Anthropic’s API. They are never used to train models, and Anthropic deletes them within 30 days.</Note>
            <Note c={c} icon={<Icon name="status-info" size={14} />}>It can only use the actions in Permissions, only on this sheet. It has no access to your account, billing or other sheets.</Note>
          </>, 'p')}
          {!isSub && sec(<DeleteAll c={c} agent={agent} chats={chats} onDelete={() => Promise.all(chats.map(ch => deleteChat(host, ch.id)))} />, 'del')}
        </>}
      </div>
    </div>
  )
}

/* ── sections ────────────────────────────────────────────────────────────── */

function ChatsSection({ c, agent, chats, head, sec, onNew, onOpen, onDelete, sheet }) {
  const [q, setQ] = useState('')
  const [confirm, setConfirm] = useState(null)
  const onCanvas = ch => ch.open && ch.blockId && sheet.blocks().some(b => b.id === ch.blockId)
  const open = chats.filter(onCanvas)
  const past = chats.filter(ch => !onCanvas(ch)).filter(ch => !q.trim() || ch.name.toLowerCase().includes(q.trim().toLowerCase()))
  return <>
    {head('Chats', 'Each chat opens as its own block. Closing one keeps it here.', <Btn c={c} kind="primary" size="sm" onClick={onNew}><Icon name="action-add" size={12} />New chat</Btn>)}
    {sec(<>
      <Label c={c}>Open on canvas</Label>
      {open.map(ch => { const st = chatStatus(ch); return (
        <button key={ch.id} type="button" onClick={() => onOpen(ch)} style={{ display: 'flex', alignItems: 'center', gap: 10, border: 'none', background: 'transparent', padding: '4px 0', cursor: 'pointer', textAlign: 'left', fontFamily: FONT }}>
          <Spark size={14} color={c.accent} />
          <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontSize: 13, color: c.text }}>{ch.name}</span><span style={{ display: 'block', fontSize: 12, color: c.text3 }}>{ch.credits || 0} credits · {ago(ch.updatedAt)}</span></span>
          {st && <Pill c={c} tone={st[0]}>{st[1]}</Pill>}
        </button>
      ) })}
      {!open.length && <span style={{ fontSize: 12, color: c.text3 }}>No chats open.</span>}
    </>, 'open')}
    {sec(<>
      <Label c={c}>History</Label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 10px', border: `1.5px solid ${c.border}`, borderRadius: 8, background: c.base, color: c.text3 }}>
        <Icon name="nav-search" size={14} />
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={halt} placeholder="Search chats" aria-label="Search chats"
          style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontFamily: FONT, fontSize: 13, color: c.text }} />
      </label>
      {past.map(ch => confirm === ch.id ? (
        <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, background: c.redBg }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: c.text }}>Delete “{ch.name}”? This removes the chat for good.</span>
          <Btn c={c} kind="danger" size="sm" onClick={() => { onDelete(ch.id); setConfirm(null) }}>Delete</Btn>
          <Btn c={c} kind="ghost" size="sm" onClick={() => setConfirm(null)}>Cancel</Btn>
        </div>
      ) : (
        <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="history-version" size={14} />
          <button type="button" onClick={() => onOpen(ch)} style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', padding: '4px 0', textAlign: 'left', cursor: 'pointer', fontFamily: FONT }}>
            <span style={{ display: 'block', fontSize: 13, color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.name}</span>
            <span style={{ display: 'block', fontSize: 12, color: c.text3 }}>{ago(ch.updatedAt)} · {ch.credits || 0} credits</span>
          </button>
          <button type="button" aria-label={`Delete ${ch.name}`} onClick={() => setConfirm(ch.id)} style={{ border: 'none', background: 'transparent', color: c.text3, cursor: 'pointer', width: 28, height: 28, borderRadius: 6, display: 'grid', placeItems: 'center' }}><Icon name="action-delete" size={14} /></button>
        </div>
      ))}
      {!past.length && <span style={{ fontSize: 12, color: c.text3 }}>{q ? 'No chats match.' : 'No past chats.'}</span>}
    </>, 'hist')}
  </>
}

function InstructionsSection({ c, agent, set, head, sec, sheet }) {
  const [draft, setDraft] = useState(agent.instructions)
  const [picking, setPicking] = useState(false)
  const t = useRef(null)
  /* The last 500 ms of typing was dropped if you switched section or closed
     the block inside the debounce (audit DEF-024). Flushed on blur and on
     unmount, from refs so the cleanup sees the latest draft. */
  const pending = useRef(null)
  const setRef = useRef(set)
  useLayoutEffect(() => { setRef.current = set })
  const flush = () => { if (t.current) { clearTimeout(t.current); t.current = null; setRef.current({ instructions: pending.current }) } }
  useEffect(() => () => flush(), [])
  const blocks = visibleBlocks(sheet.blocks())
  const nameOf = id => { const b = blocks.find(x => x.id === id); return b ? (b.name || b.type) : 'Removed block' }
  return <>
    {head('Instructions', 'Sent with every request. Short and specific works best; every word is paid for on each step (cached, so cheaply).')}
    {sec(<>
      <textarea value={draft} rows={9} aria-label="Instructions" onKeyDown={halt} onBlur={flush}
        onChange={e => { const v = e.target.value.slice(0, 8000); setDraft(v); pending.current = v; clearTimeout(t.current); t.current = setTimeout(() => { t.current = null; set({ instructions: v }) }, 500) }}
        placeholder="For example: You write product copy for DataStudio. Keep sentences short. Never invent prices."
        style={{ resize: 'vertical', border: `1.5px solid ${c.border}`, borderRadius: 8, background: c.base, color: c.text, fontFamily: FONT, fontSize: 13, lineHeight: 1.5, padding: '8px 10px', outline: 'none' }} />
      <span style={{ fontSize: 12, color: c.text3 }}>≈ {Math.ceil(draft.length / 4)} tokens</span>
    </>, 'i')}
    {sec(<>
      <Label c={c}>Pinned blocks</Label>
      <span style={{ fontSize: 13, color: c.text2 }}>Sent in full at the start of every chat. Everything else is read only when needed.</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {agent.pinned.map(id => (
          <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: `1.5px solid ${c.borderDim}`, borderRadius: 8, padding: '3px 4px 3px 9px', fontSize: 12, color: c.text, background: c.base }}>
            {nameOf(id)}
            <button type="button" aria-label={`Unpin ${nameOf(id)}`} onClick={() => set({ pinned: agent.pinned.filter(x => x !== id) })} style={{ border: 'none', background: 'transparent', color: c.text3, cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="action-delete" size={12} /></button>
          </span>
        ))}
        <Btn c={c} kind="ghost" size="sm" onClick={() => setPicking(p => !p)}><Icon name="action-add" size={12} />Pin block</Btn>
      </div>
      {picking && (
        <div style={{ border: `1.5px solid ${c.borderDim}`, borderRadius: 8, maxHeight: 180, overflowY: 'auto', padding: 4 }}>
          {blocks.filter(b => !agent.pinned.includes(b.id)).map(b => (
            <button key={b.id} type="button" onClick={() => { set({ pinned: [...agent.pinned, b.id].slice(0, 8) }); setPicking(false) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontFamily: FONT, fontSize: 13, color: c.text }}>
              {b.name || 'Untitled'} <span style={{ color: c.text3, fontSize: 12 }}>{b.type}</span>
            </button>
          ))}
          {!blocks.length && <div style={{ padding: 8, fontSize: 12, color: c.text3 }}>This sheet has no blocks to pin.</div>}
        </div>
      )}
    </>, 'p')}
  </>
}

function PermGroup({ c, agent, parent, defaultOpen, onSet }) {
  const [open, setOpen] = useState(defaultOpen)
  const allowed = PERMS.filter(([k]) => effectivePerm(agent, k, { parent }) === 'allow').length
  const asks = PERMS.filter(([k]) => effectivePerm(agent, k, { parent }) === 'ask').length
  return (
    <div style={{ border: `1.5px solid ${c.borderDim}`, borderRadius: 10, overflow: 'hidden' }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', border: 'none', background: c.base, padding: '10px 12px', cursor: 'pointer', textAlign: 'left', fontFamily: FONT }}>
        <Icon name={open ? 'nav-chevron-down' : 'nav-chevron-right'} size={12} />
        {agent.parentId ? <Icon name="share-people" size={14} /> : <Spark size={14} color={c.accent} />}
        <span style={{ fontSize: 13, fontWeight: 600, color: c.text }}>{agent.name}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: c.text3, whiteSpace: 'nowrap' }}>{allowed} allowed · {asks} ask first</span>
      </button>
      {open && PERMS.map(([k, label, desc]) => {
        const locked = agent.parentId && k === 'subs'
        const capped = parent && parent.perms?.[k] === 'never' && k !== 'subs'
        const v = locked || capped ? 'never' : (agent.perms?.[k] || 'ask')
        return (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderTop: `1px solid ${c.borderDim}` }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, color: c.text }}>{label}</span>
              <span style={{ display: 'block', fontSize: 12, color: c.text3 }}>{locked ? 'Sub-agents cannot start their own sub-agents' : capped ? `Blocked because ${parent.name} is set to Never` : desc}</span>
            </span>
            <Seg c={c} size="sm" label={label} value={v} tone={permTone(c)} onChange={x => onSet(k, x)}
              options={[['ask', 'Ask first', locked || capped], ['allow', 'Allow', locked || capped], ['never', 'Never', locked || capped]]} />
          </div>
        )
      })}
    </div>
  )
}

function UsageSection({ c, agent, chats, runs, set, head, sec, plan }) {
  const b = getBalance()
  const [topup, setTopup] = useState(false)
  const rows = (chats.length ? chats : runs).map(x => [x.name || x.chatName || 'Run', x.credits || 0]).filter(r => r[1] > 0).slice(0, 10)
  const max = Math.max(1, ...rows.map(r => r[1]))
  const monthly = b?.monthly ?? (plan === 'max' ? 5000 : plan === 'pro' ? 1500 : 0)
  const used = b?.used ?? 0
  return <>
    {head('Usage & limits', b ? `${b.remaining.toLocaleString('en')} credits left · monthly credits renew ${new Date(b.period_end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'Credits are counted on the server after every step.',
      <Btn c={c} kind="primary" size="sm" onClick={() => setTopup(true)}>Top up</Btn>)}
    {sec(<>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: c.text2 }}><span>Monthly credits</span><span style={{ fontFamily: MONO }}>{used.toLocaleString('en')} / {monthly.toLocaleString('en')}</span></div>
      <div style={{ height: 6, borderRadius: 4, background: c.raised, overflow: 'hidden' }}><div style={{ width: `${monthly ? Math.min(100, (used / monthly) * 100) : 0}%`, height: '100%', background: c.accent }} /></div>
      {b?.topup > 0 && <span style={{ fontSize: 12, color: c.text2 }}>Plus {b.topup.toLocaleString('en')} top-up credits, used after the monthly ones.</span>}
      {!b && <span style={{ fontSize: 12, color: c.text3 }}>Balance unavailable — the credits table is not set up yet, or you are offline.</span>}
    </>, 'm')}
    {sec(<>
      <Label c={c}>This agent, by {chats.length ? 'chat' : 'run'}</Label>
      {rows.map(([n, v], i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 140px) 1fr 44px', gap: 8, alignItems: 'center', fontSize: 12, color: c.text }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</span>
          <span style={{ height: 6, borderRadius: 4, background: c.raised }}><span style={{ display: 'block', height: '100%', width: `${(v / max) * 100}%`, borderRadius: 4, background: c.accent }} /></span>
          <span style={{ fontFamily: MONO, textAlign: 'right' }}>{v}</span>
        </div>
      ))}
      {!rows.length && <span style={{ fontSize: 12, color: c.text3 }}>Nothing spent yet.</span>}
    </>, 'by')}
    {sec(<>
      <Label c={c}>Limits</Label>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 13, color: c.text }}>
        <span>Stop a single task at</span>
        <Select c={c} value={String(agent.limits.task)} onChange={v => set({ limits: { task: +v } })} options={['30', '60', '120', '250', '500'].map(v => [v, `${v} credits`])} />
      </div>
      <span style={{ fontSize: 12, color: c.text3 }}>A task is everything the agent does after one message from you. There is also a daily cap per account ({plan === 'max' ? '4,000' : '1,500'} credits).</span>
    </>, 'l')}
    {topup && <TopUp c={c} onClose={() => setTopup(false)} />}
  </>
}

function TopUp({ c, onClose }) {
  const amounts = [5, 10, 25, 50, 80, 100]
  const credits = e => Math.round(e * 100 * (e >= 100 ? 1.2 : e >= 50 ? 1.1 : 1))
  const [pick, setPick] = useState(10)
  return (
    <div style={{ margin: '12px 18px', border: `1.5px solid ${c.border}`, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, background: c.base }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: c.text }}>Top up · 1 credit = €0.01</span>
        <span style={{ flex: 1 }} />
        <button type="button" aria-label="Close" onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: c.text3 }}><Icon name="action-delete" size={14} /></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
        {amounts.map(e => (
          <button key={e} type="button" onClick={() => setPick(e)} style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', border: `1.5px solid ${pick === e ? c.accent : c.borderDim}`, background: pick === e ? c.accentDim : c.surface, fontFamily: FONT }}>
            <span style={{ display: 'block', fontFamily: MONO, fontSize: 14, color: c.text }}>€{e}</span>
            <span style={{ display: 'block', fontSize: 12, color: c.text2 }}>{credits(e).toLocaleString('en')} credits</span>
          </button>
        ))}
      </div>
      <Note c={c} tone="warn" icon={<Icon name="status-warning" size={14} />}>Payments are not connected yet, so top-ups cannot be bought here. Until then, credits are granted with supabase/dev/grant_credits.sql.</Note>
    </div>
  )
}

function DeleteAll({ c, agent, chats, onDelete }) {
  const [sure, setSure] = useState(false)
  if (!chats.length) return <span style={{ fontSize: 12, color: c.text3 }}>No chat history to delete.</span>
  return sure ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, background: c.redBg }}>
      <span style={{ flex: 1, fontSize: 13, color: c.text }}>Delete all {chats.length} chats with {agent.name}? This cannot be undone.</span>
      <Btn c={c} kind="danger" size="sm" onClick={() => { onDelete(); setSure(false) }}>Delete all</Btn>
      <Btn c={c} kind="ghost" size="sm" onClick={() => setSure(false)}>Cancel</Btn>
    </div>
  ) : <div><Btn c={c} size="sm" onClick={() => setSure(true)}>Delete all chat history</Btn></div>
}

/* ── small parts ─────────────────────────────────────────────────────────── */

function QuickAsk({ c, onSend }) {
  const [v, setV] = useState('')
  const go = () => { const t = v.trim(); if (!t) return; setV(''); onSend(t) }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, border: `1.5px solid ${c.border}`, borderRadius: 12, padding: '8px 8px 8px 12px', background: c.base }}>
      <textarea value={v} rows={2} placeholder="Start a new chat…" aria-label="Start a new chat" onChange={e => setV(e.target.value)}
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go() } }}
        style={{ flex: 1, resize: 'none', border: 'none', background: 'transparent', outline: 'none', fontFamily: FONT, fontSize: 14, color: c.text, lineHeight: 1.45 }} />
      <button type="button" aria-label="Start chat" onClick={go} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: c.text, color: c.base, cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
  )
}

/* Uncontrolled, keyed on the stored value: an outside change (another block,
   a reload) replaces the field, and typing never fights a re-render. */
function Field({ c, value, onChange, placeholder, big, aria }) {
  return (
    <input key={value || ''} defaultValue={value || ''} placeholder={placeholder} aria-label={aria} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur() }}
      onBlur={e => { const v = e.target.value; if (v !== (value || '')) onChange(v.trim()) }}
      style={{ border: 'none', background: 'transparent', outline: 'none', padding: '1px 0', fontFamily: FONT, fontSize: big ? 16 : 13, fontWeight: big ? 600 : 400, color: big ? c.text : c.text2, width: '100%' }} />
  )
}

function Select({ c, value, onChange, options }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} onKeyDown={halt}
      style={{ fontFamily: FONT, fontSize: 13, border: `1.5px solid ${c.border}`, borderRadius: 8, background: c.base, color: c.text, padding: '4px 8px' }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}

function Stat({ c, n, label }) {
  return (
    <div style={{ border: `1.5px solid ${c.borderDim}`, borderRadius: 10, padding: '10px 12px', background: c.base }}>
      <div style={{ fontFamily: MONO, fontSize: 20, color: c.text }}>{n}</div>
      <div style={{ fontSize: 12, color: c.text3 }}>{label}</div>
    </div>
  )
}

function acceptRate(chats) {
  let a = 0, t = 0
  for (const ch of chats) for (const card of Object.values(ch.cards || {})) {
    if (card.kind !== 'text' && card.kind !== 'table') continue
    for (const s of Object.values(card.state || {})) { if (s === 'accepted') { a++; t++ } else if (s === 'rejected') t++ }
  }
  return t ? `${Math.round((a / t) * 100)}%` : '—'
}

function Center({ c, children }) {
  return <div style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 20, textAlign: 'center', fontFamily: FONT, fontSize: 13, color: c.text2, background: c.surface }}>{children}</div>
}

export default memo(AgentBlockInner)
