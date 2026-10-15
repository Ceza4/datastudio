/*
  lib/agent/store.js
  --------------------------------------------------------------------------
  Where agents and their chats are kept. NETWORK HALF: imports the Supabase
  client, so only app/app/page.js may import this file (check:tree).

  Supabase when it is there and migration 0012 is applied — owner-only rows,
  so an agent follows its owner across devices and nobody else ever reads it.

  localStorage otherwise: a fresh clone, a dev machine before the migration,
  or the Supabase project being down. The agent keeps working on this device
  and says so (`store.mode`), rather than failing to open.
  -------------------------------------------------------------------------- */

import { getSupabase } from '../supabaseClient'
import { normaliseAgent } from './core.js'

const LOCAL_KEY = uid => `ds.agents.v1.${uid || 'anon'}`
const MISSING_TABLE = /agent|relation .* does not exist|schema cache|PGRST20[45]|42P01/i

function readLocal(uid) {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY(uid)) || '{"agents":{},"chats":{}}') } catch { return { agents: {}, chats: {} } }
}
function writeLocal(uid, db) {
  try { localStorage.setItem(LOCAL_KEY(uid), JSON.stringify(db)); return true } catch { return false }
}

/* What is persisted of a chat. `live` (the text being streamed) and the
   runtime status are not: a reload should never show a half-written reply
   as if it were final. */
function chatData(chat) {
  const { id, name, open, credits, live, status, lastMap, ...rest } = chat
  return { ...rest, status: status === 'running' ? 'idle' : status }
}
function chatFromRow(row) {
  if (!row) return null
  const d = row.data || {}
  return {
    grants: {}, taskGrants: {}, transcript: [], cards: {}, subRuns: {}, taskCredits: 0,
    ...d,
    id: row.id, agentId: row.agent_id || d.agentId, name: row.name, open: row.is_open,
    credits: row.credits || 0, status: d.status === 'needs' ? 'needs' : 'idle', live: null,
    updatedAt: Date.parse(row.updated_at) || d.updatedAt || Date.now(),
  }
}

export function createAgentStore({ userId }) {
  let mode = 'unknown'          // 'cloud' | 'local'
  let client = null

  async function db() {
    if (mode === 'local') return null
    if (!client) client = await getSupabase()
    if (!client || !userId) { mode = 'local'; return null }
    return client
  }
  const fallBack = (err) => {
    if (err && MISSING_TABLE.test(err.message || '')) { mode = 'local'; return true }
    return false
  }

  const local = {
    getAgent: id => { const a = readLocal(userId).agents[id]; return a ? normaliseAgent({ id, config: a }) : null },
    saveAgent: a => { const d = readLocal(userId); const { id, updatedAt, ...cfg } = a; d.agents[id] = cfg; writeLocal(userId, d) },
    listChats: agentId => Object.values(readLocal(userId).chats).filter(c => c.agentId === agentId).map(c => chatFromRow({ id: c.id, agent_id: c.agentId, name: c.name, is_open: c.open, credits: c.credits, data: c, updated_at: new Date(c.updatedAt || Date.now()).toISOString() })),
    getChat: id => { const c = readLocal(userId).chats[id]; return c ? chatFromRow({ id, agent_id: c.agentId, name: c.name, is_open: c.open, credits: c.credits, data: c }) : null },
    saveChat: chat => { const d = readLocal(userId); d.chats[chat.id] = { ...chatData(chat), id: chat.id, name: chat.name, open: chat.open, credits: chat.credits }; writeLocal(userId, d) },
    deleteChat: id => { const d = readLocal(userId); delete d.chats[id]; writeLocal(userId, d) },
  }

  return {
    get mode() { return mode },

    async getAgent(id) {
      const c = await db()
      if (c) {
        const { data, error } = await c.from('agents').select('id, config, updated_at').eq('id', id).is('deleted_at', null).maybeSingle()
        if (!error) { mode = 'cloud'; return data ? normaliseAgent(data) : null }
        if (!fallBack(error)) throw new Error(error.message)
      }
      return local.getAgent(id)
    },

    async saveAgent(agent) {
      const { id, updatedAt, ...config } = agent
      const c = await db()
      if (c) {
        const { error } = await c.from('agents').upsert({ id, config }, { onConflict: 'id' })
        if (!error) { mode = 'cloud'; return true }
        if (!fallBack(error)) throw new Error(error.message)
      }
      local.saveAgent(agent)
      return true
    },

    async listChats(agentId) {
      const c = await db()
      if (c) {
        const { data, error } = await c.from('agent_chats')
          .select('id, agent_id, name, is_open, credits, updated_at, data')
          .eq('agent_id', agentId).order('updated_at', { ascending: false }).limit(200)
        if (!error) { mode = 'cloud'; return (data || []).map(chatFromRow) }
        if (!fallBack(error)) throw new Error(error.message)
      }
      return local.listChats(agentId).sort((a, b) => b.updatedAt - a.updatedAt)
    },

    async getChat(id) {
      const c = await db()
      if (c) {
        const { data, error } = await c.from('agent_chats').select('id, agent_id, name, is_open, credits, updated_at, data').eq('id', id).maybeSingle()
        if (!error) { mode = 'cloud'; return chatFromRow(data) }
        if (!fallBack(error)) throw new Error(error.message)
      }
      return local.getChat(id)
    },

    async saveChat(chat) {
      const c = await db()
      if (c) {
        const row = { id: chat.id, agent_id: chat.agentId, name: String(chat.name || 'New chat').slice(0, 200), is_open: chat.open !== false, credits: chat.credits || 0, data: chatData(chat) }
        const { error } = await c.from('agent_chats').upsert(row, { onConflict: 'id' })
        if (!error) { mode = 'cloud'; return true }
        if (!fallBack(error)) throw new Error(error.message)
      }
      local.saveChat(chat)
      return true
    },

    async deleteChat(id) {
      const c = await db()
      if (c) {
        const { error } = await c.from('agent_chats').delete().eq('id', id)
        if (!error) return true
        if (!fallBack(error)) throw new Error(error.message)
      }
      local.deleteChat(id)
      return true
    },
  }
}
