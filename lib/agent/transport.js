/*
  lib/agent/transport.js
  --------------------------------------------------------------------------
  The browser's side of POST /api/agent. Plain fetch and a small SSE reader;
  no Supabase, so it is safe anywhere. The session cookie rides along
  automatically (same origin), which is how the route knows who is asking.
  -------------------------------------------------------------------------- */

async function* events(body) {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i)
      buf = buf.slice(i + 2)
      let event = 'message', data = ''
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trimStart()
      }
      if (!data) continue
      try { yield { event, data: JSON.parse(data) } } catch { /* skip */ }
    }
  }
}

/**
 * One model step. Resolves { content, stop_reason, credits, balance }.
 * Rejects with an Error whose message is written for the person.
 */
export async function runModel(req, onEvent, signal) {
  const payload = {
    model: req.model, effort: req.effort, system: req.system,
    toolNames: (req.tools || []).map(t => t.name), web: !!req.web,
    messages: req.messages, agentId: req.agentId, chatId: req.chatId,
    taskId: req.taskId, taskLimit: req.taskLimit,
  }
  let res
  try {
    res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
      credentials: 'same-origin',
    })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new Error('Could not reach DataStudio. Check your connection.')
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status}).`
    try { const j = await res.json(); if (j?.error) msg = j.error } catch { /* not JSON */ }
    const e = new Error(msg)
    e.status = res.status
    throw e
  }
  for await (const { event, data } of events(res.body)) {
    if (event === 'text') onEvent?.({ type: 'text', text: data.text })
    else if (event === 'done') return data
    else if (event === 'error') {
      const e = new Error(data.message || 'The AI service failed.')
      e.status = data.status
      e.balance = data.balance
      throw e
    }
  }
  if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
  throw new Error('The connection closed before the step finished.')
}

export async function fetchBalance() {
  try {
    const res = await fetch('/api/agent', { credentials: 'same-origin' })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}
