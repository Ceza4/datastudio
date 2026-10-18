/*
  lib/agent/session.js
  --------------------------------------------------------------------------
  The in-memory state every agent and chat block on screen shares. Pure: it
  talks to storage and the model only through the `host` the app passes in
  (see app/app/page.js), never by importing the network layer itself.

  One agent block and three open chat blocks are four views of the same
  objects. Keeping them here — not in each block's React state — means a
  permission granted in one chat shows in the agent's Permissions section at
  once, and a reply streaming into a chat updates the agent's "running" pill
  without either block knowing about the other.
  -------------------------------------------------------------------------- */

import { newAgentConfig, normaliseAgent } from './core.js'
import { newChat, drive, addUserMessage, answerCard, stop as stopRun, isRunning, needsPerson } from './runner.js'

const agents = new Map()            // id -> agent
const chats = new Map()             // id -> chat (full)
const chatLists = new Map()         // agentId -> [chatId] newest first
const loading = new Map()           // key -> promise
const listeners = new Set()
let version = 0
let balance = null
let saveTimers = new Map()

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }
export const getVersion = () => version
function emit() { version++; for (const fn of listeners) { try { fn() } catch { /* a view's problem */ } } }

export const getAgent = id => agents.get(id) || null
export const getChat = id => chats.get(id) || null
export const getBalance = () => balance
export const allAgents = () => [...agents.values()]
export const subagentsOf = id => [...agents.values()].filter(a => a.parentId === id)

/* Only a real balance (ai_balance's object, migration 0012). Anything else —
   an empty RPC answer is `[]`, which IS an object — would be stored and then
   read as `b.remaining.toLocaleString()` by the Usage section, and crash it. */
export function setBalance(b) {
  if (b && typeof b === 'object' && !Array.isArray(b) && Number.isFinite(b.remaining)) { balance = b; emit() }
}

export function chatsOf(agentId) {
  return (chatLists.get(agentId) || []).map(id => chats.get(id)).filter(Boolean)
}

const uid = p => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

function once(key, fn) {
  if (loading.has(key)) return loading.get(key)
  const p = fn().finally(() => loading.delete(key))
  loading.set(key, p)
  return p
}

/* ── agents ──────────────────────────────────────────────────────────────── */

export function loadAgent(host, id) {
  if (!id) return Promise.resolve(null)
  if (agents.has(id)) return Promise.resolve(agents.get(id))
  return once(`a:${id}`, async () => {
    const a = await host.store.getAgent(id)
    if (a) { agents.set(id, a); emit() }
    return a
  })
}

export async function createAgent(host, partial = {}) {
  const id = uid('agt')
  const agent = normaliseAgent({ id, config: newAgentConfig(partial) })
  agents.set(id, agent)
  chatLists.set(id, [])
  emit()
  await host.store.saveAgent(agent)
  return agent
}

export function updateAgent(host, id, patch) {
  const cur = agents.get(id)
  if (!cur) return
  const next = normaliseAgent({ id, config: { ...cur, ...patch, perms: { ...cur.perms, ...(patch.perms || {}) }, limits: { ...cur.limits, ...(patch.limits || {}) } } })
  agents.set(id, next)
  emit()
  debounce(`a:${id}`, 600, () => host.store.saveAgent(next).catch(err => host.onError?.(err)))
}

/* ── chats ───────────────────────────────────────────────────────────────── */

export function loadChats(host, agentId) {
  return once(`l:${agentId}`, async () => {
    const list = await host.store.listChats(agentId)
    for (const c of list) if (!chats.has(c.id) || !isRunning(c.id)) chats.set(c.id, c)
    chatLists.set(agentId, list.map(c => c.id))
    emit()
    return list
  })
}

export function loadChat(host, id) {
  if (chats.has(id)) return Promise.resolve(chats.get(id))
  return once(`c:${id}`, async () => {
    const c = await host.store.getChat(id)
    if (c) { chats.set(id, c); emit() }
    return c
  })
}

export async function createChat(host, agentId) {
  const agent = agents.get(agentId)
  if (!agent) throw new Error('Agent not loaded.')
  const chat = newChat({ id: uid('ach'), agent })
  chats.set(chat.id, chat)
  chatLists.set(agentId, [chat.id, ...(chatLists.get(agentId) || [])])
  emit()
  await host.store.saveChat(chat)
  return chat
}

export function touchChat(host, chat, { now = false } = {}) {
  chat.updatedAt = Date.now()
  emit()
  const save = () => host.store.saveChat(chat).catch(err => host.onError?.(err))
  if (now) { clearTimeout(saveTimers.get(`c:${chat.id}`)); save() }
  else debounce(`c:${chat.id}`, 800, save)
  host.onNeedsChange?.(needsCount())
}

export async function deleteChat(host, id) {
  const c = chats.get(id)
  if (c && isRunning(id)) stopRun(c)
  chats.delete(id)
  for (const [aid, list] of chatLists) chatLists.set(aid, list.filter(x => x !== id))
  emit()
  await host.store.deleteChat(id)
}

/** Change a chat's fields (name, model, effort) from a view. */
export function patchChat(host, chat, patch) {
  Object.assign(chat, patch)
  touchChat(host, chat, { now: true })
}

/** Record review decisions on a suggestion card: { [key]: 'accepted' | 'rejected' | 'missing' }. */
export function setCardStates(host, chat, cardId, states) {
  const card = chat?.cards?.[cardId]
  if (!card) return
  card.state = { ...card.state, ...states }
  touchChat(host, chat, { now: true })
}

export function setChatOpen(host, chat, open, blockId = null) {
  chat.open = open
  if (blockId !== undefined) chat.blockId = blockId
  touchChat(host, chat, { now: true })
}

export function needsCount() {
  let n = 0
  for (const c of chats.values()) if (needsPerson(c)) n++
  return n
}

/* ── running ─────────────────────────────────────────────────────────────── */

function envFor(host, chat, sheet) {
  const agent = agents.get(chat.agentId)
  return {
    agent,
    agents: [...agents.values()],
    host: { run: host.runModel, saveAgent: a => updateAgent(host, a.id, a) },
    sheet,
    today: new Date().toISOString().slice(0, 10),
    onUpdate: c => touchChat(host, c),
    onBalance: b => setBalance(b),
    onNeeds: c => host.notify?.({ chat: c, agent: agents.get(c.agentId), kind: 'needs' }),
    onSuggest: blockId => host.onSuggest?.(blockId),
  }
}

export function send(host, chat, text, sheet) {
  const agent = agents.get(chat.agentId)
  if (!agent || !String(text).trim()) return
  addUserMessage(chat, String(text).trim(), { blocks: sheet.blocks(), pinned: agent.pinned || [] })
  touchChat(host, chat, { now: true })
  return drive(chat, envFor(host, chat, sheet)).then(() => {
    touchChat(host, chat, { now: true })
    if (chat.status !== 'needs' && !chat.error && !chat.stopped) host.notify?.({ chat, agent, kind: 'done' })
  })
}

export function answer(host, chat, toolId, value, sheet) {
  const ok = answerCard(chat, toolId, value, envFor(host, chat, sheet))
  touchChat(host, chat, { now: true })
  return ok
}

export function retry(host, chat, sheet) {
  chat.error = null
  const last = chat.transcript[chat.transcript.length - 1]
  if (!last) return
  return drive(chat, envFor(host, chat, sheet)).then(() => touchChat(host, chat, { now: true }))
}

export function stop(chat) { stopRun(chat) }
export { isRunning }

/* ── cross-block requests ────────────────────────────────────────────────── */

/* "Manage" on a permission card opens the agent block on Permissions. The
   chat block cannot reach into the agent block's state, so it leaves a note
   here and the agent block picks it up. */
const sections = new Map()
export function requestSection(agentId, section) { sections.set(agentId, section); emit() }
export const agentSection = agentId => sections.get(agentId) || 'overview'

/** Every sub-agent run of `subId` found in the chats loaded so far. */
export function runsOf(subId) {
  const out = []
  for (const ch of chats.values()) for (const [toolId, r] of Object.entries(ch.subRuns || {})) if (r.agentId === subId) out.push({ ...r, chatId: ch.id, toolId, chatName: ch.name })
  return out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
}

export function revokeGrants(host, chatId) {
  const ch = chats.get(chatId)
  if (!ch) return
  ch.grants = {}
  touchChat(host, ch, { now: true })
}

/* ── utils ───────────────────────────────────────────────────────────────── */

function debounce(key, ms, fn) {
  clearTimeout(saveTimers.get(key))
  saveTimers.set(key, setTimeout(() => { saveTimers.delete(key); fn() }, ms))
}

/** Tests only. */
export function _reset() { agents.clear(); chats.clear(); chatLists.clear(); loading.clear(); balance = null; saveTimers = new Map(); version = 0 }
