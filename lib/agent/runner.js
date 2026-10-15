/*
  lib/agent/runner.js
  --------------------------------------------------------------------------
  The agent loop. Pure: it never imports the network layer. The app hands it
  a `host` (model calls, storage) and the canvas hands it a `sheet` (read and
  write blocks), so the loop can be tested with fakes and mounted anywhere.

  THE LOOP IS A FUNCTION OF THE TRANSCRIPT, NOT OF MEMORY

  drive() looks at the last message and does the next thing:
    · last is from the person (text or tool results)  → call the model
    · last is the model asking for tools              → run them, append results
    · last is the model finishing                     → stop
  So a reload in the middle of a question card loses nothing: the transcript
  still ends with the unanswered ask_user call, and answering the card simply
  calls drive() again. There is no hidden state to rebuild.

  PERMISSIONS, IN ONE PLACE

  Every tool that changes something names the permission it needs
  (core.TOOL_SPECS). effective = the agent's setting, capped by its parent,
  raised by a grant. Grants have three lifetimes:
    · once   — this task, until the person sends their next message
    · chat   — this chat, until revoked
    · always — written to the agent's own settings
  -------------------------------------------------------------------------- */

import {
  TOOL_SPECS, PERM_LABEL, effectivePerm, permsForCall, toolsFor, systemPrompt,
  contextPreamble, sheetMap, readBlockText, splitParagraphs, applyParagraphEdits,
  paragraphHtml, clampInt, visibleBlocks, chatTitleFrom, modelById, routeEffort,
} from './core.js'

export const MAX_STEPS = 30

/* Resolvers for cards a running loop is waiting on, keyed chat:tool. */
const waiting = new Map()
const runs = new Map()          // chatId -> AbortController
const key = (chatId, toolId) => `${chatId}:${toolId}`

export const isRunning = chatId => runs.has(chatId)

/* ── transcript helpers ──────────────────────────────────────────────────── */

const lastMsg = chat => chat.transcript[chat.transcript.length - 1]

/** tool_use blocks in the last assistant message that have no result yet. */
export function pendingToolUses(chat) {
  const last = lastMsg(chat)
  if (!last || last.role !== 'assistant' || !Array.isArray(last.content)) return []
  return last.content.filter(c => c.type === 'tool_use')
}

/** Does the chat need a person right now? (question or permission card open) */
export function needsPerson(chat) {
  return Object.values(chat.cards || {}).some(c => (c.kind === 'questions' || c.kind === 'perm') && c.status === 'pending')
}

/** Every suggestion card still waiting for review. */
export const openSuggestions = chat =>
  Object.values(chat.cards || {}).filter(c => (c.kind === 'text' || c.kind === 'table') && Object.values(c.state || {}).some(s => s === 'pending'))

export function newChat({ id, agent, name = 'New chat', blockId = null }) {
  return {
    id, agentId: agent.id, name, blockId,
    /* null / undefined = follow the agent. A chat only stores a model or
       effort once the person picks one for it in the composer. */
    model: null, effort: undefined,
    grants: {}, taskGrants: {}, transcript: [], cards: {}, subRuns: {},
    credits: 0, taskCredits: 0, taskId: null, status: 'idle', error: null,
    live: null, open: true, createdAt: Date.now(), updatedAt: Date.now(),
  }
}

/* ── the person's side ───────────────────────────────────────────────────── */

/**
 * Send a message. If the model was waiting on tools (a question the person
 * skipped by typing instead), those are closed with a note first, because the
 * API requires every tool_use to be answered in the very next message.
 */
export function addUserMessage(chat, text, { blocks = [], pinned = [] } = {}) {
  const content = []
  for (const t of pendingToolUses(chat)) {
    const card = chat.cards[t.id]
    if (card && card.status === 'pending') card.status = 'skipped'
    content.push({ type: 'tool_result', tool_use_id: t.id, content: 'The person sent a new message instead of answering.' })
    const w = waiting.get(key(chat.id, t.id))
    if (w) { waiting.delete(key(chat.id, t.id)); w({ skipped: true }) }
  }
  /* The sheet as it is NOW, whenever it has changed since the agent last saw
     it. Only the first message used to carry it, so twenty messages into a
     chat the agent was reasoning about blocks that no longer existed. */
  const map = contextPreamble(blocks, pinned)
  if (!chat.transcript.length || map !== chat.lastMap) content.push({ type: 'text', text: map })
  chat.lastMap = map
  content.push({ type: 'text', text: String(text) })
  chat.transcript.push({ role: 'user', content })
  if (!chat.name || chat.name === 'New chat') chat.name = chatTitleFrom(text)
  chat.taskGrants = {}
  chat.taskCredits = 0
  chat.taskId = `task_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  chat.error = null
  chat.stopped = false
  chat.updatedAt = Date.now()
}

/**
 * The person answered a card. Records the answer and wakes the loop that is
 * waiting on it — or, after a reload, starts a new one from the transcript.
 */
export function answerCard(chat, toolId, value, env) {
  const card = chat.cards[toolId]
  if (!card || card.status !== 'pending') return false
  card.status = 'done'
  card.value = value
  const w = waiting.get(key(chat.id, toolId))
  if (w) { waiting.delete(key(chat.id, toolId)); w(value); return true }
  if (env && !isRunning(chat.id)) drive(chat, env)
  return true
}

export function stop(chat) {
  const ctl = runs.get(chat.id)
  if (ctl) ctl.abort()
}

/* ── the loop ────────────────────────────────────────────────────────────── */

/**
 * env: { agent, agents (all on this sheet, for sub-agents), host, sheet, onUpdate, today }
 *   host.run(request, onEvent, signal) → { content, stop_reason, credits, balance }
 *   host.saveAgent(agent)
 *   sheet.blocks() · sheet.update(id, patch) · sheet.add(type, opts) → id · sheet.remove(id)
 */
export async function drive(chat, env) {
  if (runs.has(chat.id)) return
  const ctl = new AbortController()
  runs.set(chat.id, ctl)
  const touch = () => { chat.updatedAt = Date.now(); env.onUpdate?.(chat) }
  chat.status = 'running'
  touch()
  try {
    await loop(chat, env.agent, env, { signal: ctl.signal, isSub: false, touch })
    chat.status = needsPerson(chat) ? 'needs' : 'idle'
  } catch (err) {
    if (ctl.signal.aborted) {
      chat.stopped = true
      closeDangling(chat, 'Stopped by the person.')
      chat.transcript.push({ role: 'assistant', content: [{ type: 'text', text: 'Stopped. Nothing after this point was applied.' }] })
      chat.status = 'idle'
    } else {
      closeDangling(chat, 'The step failed.')
      chat.error = err?.message || 'Something went wrong.'
      chat.status = 'idle'
    }
  } finally {
    runs.delete(chat.id)
    chat.live = null
    touch()
  }
}

function closeDangling(chat, note) {
  const pend = pendingToolUses(chat)
  if (!pend.length) return
  for (const t of pend) {
    const card = chat.cards[t.id]
    if (card && card.status === 'pending') card.status = 'skipped'
    const w = waiting.get(key(chat.id, t.id))
    if (w) { waiting.delete(key(chat.id, t.id)); w({ skipped: true }) }
  }
  chat.transcript.push({ role: 'user', content: pend.map(t => ({ type: 'tool_result', tool_use_id: t.id, content: note, is_error: true })) })
}

async function loop(chat, agent, env, ctx) {
  const { signal, isSub, touch } = ctx
  const subagents = isSub ? [] : (env.agents || []).filter(a => a.parentId === agent.id)
  const parent = agent.parentId ? (env.agents || []).find(a => a.id === agent.parentId) : null
  const transcript = ctx.transcript || chat.transcript
  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal.aborted) throw new Error('aborted')
    const last = transcript[transcript.length - 1]
    if (!last) return
    if (last.role === 'assistant') {
      const uses = (last.content || []).filter(c => c.type === 'tool_use')
      if (!uses.length) {
        if (last.stop_reason === 'pause_turn') { await callModel(); continue }
        return
      }
      const results = []
      for (const use of uses) {
        if (signal.aborted) throw new Error('aborted')
        results.push(await runTool(use))
        touch()
      }
      transcript.push({ role: 'user', content: results })
      touch()
      continue
    }
    await callModel()
  }
  transcript.push({ role: 'user', content: [{ type: 'text', text: 'Step limit reached. Summarise what is done and what is left.' }] })
  await callModel({ noTools: true })

  async function callModel({ noTools = false } = {}) {
    const limit = agent.limits?.task || 60
    if (!isSub && chat.taskCredits >= limit) {
      transcript.push({ role: 'assistant', content: [{ type: 'text', text: `Stopped at your per-task limit of ${limit} credits. Send a message to continue, or raise the limit in Usage & limits.` }] })
      return
    }
    const grants = grantsFor(agent)
    const { tools, web } = toolsFor(agent, { parent, grants, subagents, isSub })
    const model = isSub ? agent.model : (chat.model || agent.model)
    const effort = isSub ? agent.effort : (chat.effort === undefined ? agent.effort : chat.effort)
    const req = {
      model, effort: routeEffort(model, effort, transcript),
      system: systemPrompt(agent, { isSub, parentName: parent?.name, subagents, today: env.today || '' }),
      tools: noTools ? [] : tools, web: noTools ? false : web,
      messages: transcript.map(({ role, content }) => ({ role, content })),
      agentId: agent.id, chatId: chat.id, taskId: chat.taskId,
      taskLimit: isSub ? null : limit,
    }
    const liveTarget = isSub ? (chat.subRuns[ctx.subKey] ||= {}) : chat
    liveTarget.live = { text: '' }
    touch()
    const res = await env.host.run(req, ev => {
      if (ev.type === 'text') { liveTarget.live = { text: (liveTarget.live?.text || '') + ev.text }; touch() }
    }, signal)
    liveTarget.live = null
    const content = (res.content || []).filter(Boolean)
    transcript.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '' }], stop_reason: res.stop_reason, credits: res.credits || 0, model })
    chat.credits += res.credits || 0
    chat.taskCredits += res.credits || 0
    if (isSub && ctx.subKey) { const r = chat.subRuns[ctx.subKey]; r.credits = (r.credits || 0) + (res.credits || 0) }
    if (res.balance != null) env.onBalance?.(res.balance)
    touch()
  }

  function grantsFor(a) {
    const g = {}
    for (const k of Object.keys(PERM_LABEL)) if (chat.grants[`${a.id}:${k}`] || chat.taskGrants[`${a.id}:${k}`]) g[k] = true
    return g
  }

  /* One tool call → one tool_result block. Never throws for a bad input; the
     model gets the error as text and can correct itself. */
  async function runTool(use) {
    const ok = text => ({ type: 'tool_result', tool_use_id: use.id, content: String(text) })
    const fail = text => ({ type: 'tool_result', tool_use_id: use.id, content: String(text), is_error: true })
    const spec = TOOL_SPECS[use.name]
    if (!spec) return fail(`Unknown tool ${use.name}.`)
    const input = use.input || {}

    /* RESUMING. After a reload the loop starts again from the transcript,
       and the last assistant message may hold tools that already ran — a
       suggestion already shown, a block already created. Never run those
       twice: reuse what they left behind. */
    const prior = chat.cards[use.id]
    if (prior && ['text', 'table', 'created', 'moved', 'deleted'].includes(prior.kind)) {
      return ok(prior.kind === 'created' ? `Created [${prior.blockId}].` : 'Done earlier in this task.')
    }

    /* Permission gate. */
    for (const p of permsForCall(use.name, input)) {
      const v = effectivePerm(agent, p, { parent, grants: grantsFor(agent) })
      if (v === 'never') return fail(`${PERM_LABEL[p]} is not allowed for ${agent.name}. Tell the person what you would have done instead.`)
      if (v === 'ask') {
        const res = await askPermission(use.id, [{ permission: p, detail: describeCall(use.name, input) }], '')
        if (!res.granted.includes(p)) return fail(`The person did not allow ${PERM_LABEL[p].toLowerCase()}. Do not retry it; continue without it.`)
      }
    }

    const sheet = env.sheet
    const blocks = () => visibleBlocks(sheet.blocks())
    const find = id => blocks().find(b => b.id === id)

    switch (use.name) {
      case 'list_blocks': return ok(sheetMap(blocks()))
      case 'read_block': {
        const b = find(input.block_id)
        if (!b) return fail(`No block ${input.block_id} on this sheet. Call list_blocks.`)
        return ok(readBlockText(b, { offset: clampInt(input.offset, 0, 1e6, 0), limit: clampInt(input.limit, 1, 400, 120) }))
      }
      case 'suggest_text_edits': {
        const b = find(input.block_id)
        if (!b || (b.type !== 'text' && b.type !== 'document')) return fail('That is not a note or document.')
        const paras = splitParagraphs(b.content)
        const edits = []
        for (const e of input.edits || []) {
          if (e.op === 'replace' || e.op === 'delete') {
            if (!Number.isInteger(e.index) || !paras[e.index]) return fail(`Paragraph ${e.index} does not exist (there are ${paras.length}). Read the block again.`)
            edits.push({ op: e.op, index: e.index, before: paras[e.index].text, text: e.op === 'replace' ? String(e.text ?? '') : '' })
          } else if (e.op === 'insert') {
            const after = Number.isInteger(e.after) ? Math.max(-1, Math.min(paras.length - 1, e.after)) : paras.length - 1
            edits.push({ op: 'insert', after, before: '', text: String(e.text ?? '') })
          }
        }
        if (!edits.length) return fail('No valid edits.')
        chat.cards[use.id] = {
          kind: 'text', agentId: agent.id, blockId: b.id, blockName: b.name || (b.type === 'document' ? 'Document' : 'Note'),
          summary: String(input.summary || ''), base: b.content || '', edits,
          state: Object.fromEntries(edits.map((_, i) => [i, 'pending'])),
        }
        env.onSuggest?.(b.id)
        return ok(`Suggested ${edits.length} edit${edits.length > 1 ? 's' : ''} in "${b.name || 'untitled'}". The person reviews each paragraph; nothing is applied yet.`)
      }
      case 'suggest_table_edits': {
        const b = find(input.block_id)
        if (!b || b.type !== 'table') return fail('That is not a table.')
        const changes = {
          cells: (input.cells || []).filter(c => Number.isInteger(c.row) && c.row >= 0 && Number.isInteger(c.col) && c.col >= 0 && c.col < 200),
          headers: (input.headers || []).filter(h => Number.isInteger(h.col) && h.col >= 0 && h.col < 200),
          addRows: (input.add_rows || []).filter(Array.isArray),
        }
        if (!changes.cells.length && !changes.headers.length && !changes.addRows.length) return fail('No valid changes.')
        const rowKeys = [...new Set(changes.cells.map(c => c.row))].concat(changes.addRows.map((_, i) => `new${i}`))
        chat.cards[use.id] = {
          kind: 'table', agentId: agent.id, blockId: b.id, blockName: b.name || 'Table', summary: String(input.summary || ''),
          baseHeaders: b.headers || [], baseRows: b.rows || [], changes,
          state: Object.fromEntries([...(changes.headers.length ? [['headers', 'pending']] : []), ...rowKeys.map(k => [k, 'pending'])]),
        }
        env.onSuggest?.(b.id)
        return ok(`Suggested ${changes.cells.length} cell change${changes.cells.length === 1 ? '' : 's'}${changes.headers.length ? `, ${changes.headers.length} header${changes.headers.length > 1 ? 's' : ''}` : ''}${changes.addRows.length ? `, ${changes.addRows.length} new row${changes.addRows.length > 1 ? 's' : ''}` : ''} in "${b.name || 'untitled'}". The person reviews each row; nothing is applied yet.`)
      }
      case 'create_block': {
        const type = { note: 'text', document: 'document', table: 'table', html: 'html' }[input.type]
        if (!type) return fail('type must be note, document, table or html.')
        const spot = freeSpot(blocks(), input)
        const patch = { name: String(input.name || '').slice(0, 120) }
        if (type === 'text' || type === 'document') {
          patch.content = String(input.text || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => paragraphHtml(p)).join('')
        }
        if (type === 'html') patch.html = String(input.html || '')
        const opts = { x: spot.x, y: spot.y, w: input.w ? clampInt(input.w, 160, 2400, null) : null, h: input.h ? clampInt(input.h, 100, 2400, null) : null, patch }
        if (type === 'table') {
          opts.headers = (input.headers || ['']).map(v => String(v ?? ''))
          opts.rows = (input.rows?.length ? input.rows : Array(8).fill(null).map(() => [''])).map(r => (Array.isArray(r) ? r.map(v => String(v ?? '')) : ['']))
        }
        const id = sheet.add(type, opts)
        chat.cards[use.id] = { kind: 'created', agentId: agent.id, blockId: id, blockName: patch.name || type, type }
        env.onSuggest?.(id)
        return ok(`Created ${input.type} [${id}] at (${spot.x}, ${spot.y}).`)
      }
      case 'move_block': {
        const b = find(input.block_id)
        if (!b) return fail('No such block.')
        const patch = {}
        if (input.x != null) patch.x = clampInt(input.x, -20000, 20000, b.x)
        if (input.y != null) patch.y = clampInt(input.y, -20000, 20000, b.y)
        if (input.w != null) patch.w = clampInt(input.w, 120, 4000, b.w)
        if (input.h != null) patch.h = clampInt(input.h, 80, 4000, b.h)
        if (!Object.keys(patch).length) return fail('Nothing to change.')
        sheet.update(b.id, patch)
        chat.cards[use.id] = { kind: 'moved', agentId: agent.id, blockId: b.id, blockName: b.name || 'block' }
        return ok(`Moved "${b.name || b.id}".`)
      }
      case 'delete_block': {
        const b = find(input.block_id)
        if (!b) return fail('No such block.')
        const gone = await sheet.remove(b.id)
        if (!gone) return fail('The person cancelled the delete.')
        chat.cards[use.id] = { kind: 'deleted', agentId: agent.id, blockId: b.id, blockName: b.name || 'block' }
        return ok(`Deleted "${b.name || b.id}". The person can undo it.`)
      }
      case 'ask_user': {
        if (isSub) return fail('Sub-agents cannot ask the person. State your assumption in the report.')
        const qs = (input.questions || []).slice(0, 4).map(q => ({
          q: String(q.question || '').slice(0, 300),
          opts: (q.options || []).slice(0, 4).map(o => ({ label: String(o.label || '').slice(0, 80), hint: String(o.description || '').slice(0, 120) })),
        })).filter(q => q.q && q.opts.length >= 1)
        if (!qs.length) return fail('No valid questions.')
        if (!(prior?.kind === 'questions')) chat.cards[use.id] = { kind: 'questions', agentId: agent.id, qs, status: 'pending' }
        if (chat.cards[use.id].status === 'pending') {
          chat.status = 'needs'
          env.onNeeds?.(chat)
          touch()
        }
        const ans = await wait(use.id)
        chat.status = 'running'
        if (ans?.skipped) return ok('The person skipped these questions.')
        if (ans?.decide) return ok('The person said: you decide. Pick sensible defaults and say which you chose.')
        return ok(qs.map((q, i) => `${q.q}\n→ ${ans?.answers?.[i] ?? '(no answer)'}`).join('\n\n'))
      }
      case 'request_permissions': {
        const asked = (input.actions || []).filter(a => PERM_LABEL[a.permission])
        const already = [], never = [], need = []
        for (const a of asked) {
          const v = effectivePerm(agent, a.permission, { parent, grants: grantsFor(agent) })
          if (v === 'allow') already.push(a.permission)
          else if (v === 'never') never.push(a.permission)
          else need.push(a)
        }
        let granted = [...already], denied = [...never]
        if (need.length) {
          const res = await askPermission(use.id, need, String(input.reason || ''))
          granted = granted.concat(res.granted)
          denied = denied.concat(res.denied)
        }
        const fmt = l => [...new Set(l)].map(k => PERM_LABEL[k]).join(', ') || 'none'
        return ok(`Allowed: ${fmt(granted)}. Not allowed: ${fmt(denied)}.${denied.length ? ' Work without those; do not ask again this task.' : ''}`)
      }
      case 'delegate': {
        const sub = subagents.find(s => s.name.toLowerCase() === String(input.subagent || '').toLowerCase()) || (subagents.length === 1 ? subagents[0] : null)
        if (!sub) return fail(`No sub-agent called "${input.subagent}". Yours: ${subagents.map(s => s.name).join(', ') || 'none'}.`)
        const brief = String(input.brief || '').slice(0, 8000)
        chat.subRuns[use.id] = { agentId: sub.id, name: sub.name, model: sub.model, brief, status: 'running', startedAt: Date.now(), transcript: [{ role: 'user', content: [{ type: 'text', text: `${contextPreamble(sheet.blocks(), sub.pinned || [])}\n\n<brief>\n${brief}\n</brief>` }] }], credits: 0 }
        chat.cards[use.id] = { kind: 'delegate', agentId: agent.id, subId: sub.id, subName: sub.name }
        env.onSubRun?.(sub.id, chat.id, use.id)
        touch()
        const run = chat.subRuns[use.id]
        try {
          await loop(chat, sub, env, { signal, isSub: true, touch, transcript: run.transcript, subKey: use.id })
          const final = [...run.transcript].reverse().find(m => m.role === 'assistant')
          run.report = (final?.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim() || '(no report)'
          run.status = 'done'
          touch()
          return ok(`${sub.name} reported:\n${run.report}`)
        } catch (err) {
          run.status = signal.aborted ? 'stopped' : 'failed'
          run.report = err?.message || 'Failed.'
          touch()
          if (signal.aborted) throw err
          return fail(`${sub.name} failed: ${run.report}`)
        }
      }
    }
    return fail('Not implemented.')
  }

  /* Shows one permission card and waits. Returns { granted: [], denied: [] }. */
  async function askPermission(toolId, actions, reason) {
    /* A permission card for this call that the person already answered (the
       loop was resumed after a reload) is reused, not asked again. */
    const existing = Object.keys(chat.cards).find(k => (k === toolId || k.startsWith(`${toolId}:`)) && chat.cards[k].kind === 'perm'
      && chat.cards[k].items.some(i => actions.some(a => a.permission === i.permission)))
    const cardId = existing || (chat.cards[toolId] ? `${toolId}:p${Object.keys(chat.cards).length}` : toolId)
    if (!existing) chat.cards[cardId] = {
      kind: 'perm', agentId: agent.id, agentName: agent.name, reason,
      items: actions.map(a => ({ permission: a.permission, detail: String(a.detail || PERM_LABEL[a.permission]).slice(0, 140), checked: true })),
      status: 'pending',
    }
    if (chat.cards[cardId].status === 'pending') {
      chat.status = 'needs'
      env.onNeeds?.(chat)
      touch()
    }
    const ans = await wait(cardId)
    chat.status = 'running'
    if (!ans || ans.skipped || ans.scope === 'deny') return { granted: [], denied: actions.map(a => a.permission) }
    const on = new Set(ans.granted || [])
    const granted = actions.map(a => a.permission).filter(p => on.has(p))
    const denied = actions.map(a => a.permission).filter(p => !on.has(p))
    for (const p of granted) {
      const k = `${agent.id}:${p}`
      if (ans.scope === 'always') {
        agent.perms = { ...agent.perms, [p]: 'allow' }
        env.host.saveAgent?.(agent)
      } else if (ans.scope === 'chat') chat.grants[k] = true
      else chat.taskGrants[k] = true
    }
    touch()
    return { granted, denied }
  }

  function wait(toolId) {
    return new Promise(resolve => {
      const card = chat.cards[toolId]
      if (card && card.status === 'done') { resolve(card.value); return }
      waiting.set(key(chat.id, toolId), resolve)
      signal.addEventListener('abort', () => {
        if (waiting.get(key(chat.id, toolId)) === resolve) { waiting.delete(key(chat.id, toolId)); resolve({ skipped: true }) }
      }, { once: true })
    })
  }
}

/* A short human label for a gated call, for the permission card. */
export function describeCall(name, input) {
  switch (name) {
    case 'suggest_text_edits': case 'suggest_table_edits': return 'Suggest edits (you review each one)'
    case 'create_block': return `Create a ${input?.type || 'block'}${input?.name ? ` “${String(input.name).slice(0, 40)}”` : ''}`
    case 'move_block': return 'Move or resize a block'
    case 'delete_block': return 'Delete a block (undoable)'
    case 'delegate': return `Start sub-agent ${input?.subagent || ''}`.trim()
    default: return PERM_LABEL[TOOL_SPECS[name]?.perm] || name
  }
}

/* To the right of everything, top-aligned. Deterministic and never on top of
   an existing block, which is the one placement rule people notice. */
export function freeSpot(blocks, { x, y } = {}) {
  if (Number.isFinite(+x) && Number.isFinite(+y)) return { x: Math.round(+x), y: Math.round(+y) }
  const list = visibleBlocks(blocks)
  if (!list.length) return { x: 80, y: 80 }
  const right = Math.max(...list.map(b => (b.x || 0) + (b.w || 320)))
  const top = Math.min(...list.map(b => b.y || 0))
  return { x: Math.round(right + 48), y: Math.round(top) }
}

/* ── applying reviewed suggestions ───────────────────────────────────────── */

/**
 * Apply the accepted parts of a text card to the block's CURRENT content.
 * Indices refer to the paragraphs as they were when the agent read them; if
 * the block has changed since, a paragraph is matched by its old text so an
 * edit never lands on the wrong paragraph. Returns { html, applied, missed }.
 */
export function applyTextCard(currentHtml, card, indexes) {
  const now = splitParagraphs(currentHtml)
  const base = splitParagraphs(card.base)
  const sameShape = now.length === base.length && now.every((p, i) => p.text === base[i].text)
  const edits = [], appliedIdx = [], missedIdx = []
  for (const i of indexes) {
    const e = card.edits[i]
    if (!e) continue
    if (e.op === 'insert') { edits.push({ ...e, after: sameShape ? e.after : Math.min(e.after, now.length - 1) }); appliedIdx.push(i); continue }
    const at = sameShape ? e.index : now.findIndex(p => p.text === e.before)
    if (at < 0) { missedIdx.push(i); continue }
    edits.push({ ...e, index: at })
    appliedIdx.push(i)
  }
  return { html: applyParagraphEdits(currentHtml, edits), applied: edits.length, missed: missedIdx.length, appliedIdx, missedIdx }
}

export { modelById }
