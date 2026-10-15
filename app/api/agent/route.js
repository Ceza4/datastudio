import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { serverClient, adminClient, hasServiceRole } from '../../../lib/supabase/server'
import { rateLimit } from '../../../lib/ratelimit'
import { refuseCrossSite, refuseUnfinishedSignIn } from '../_guard'
import { MODELS, modelById, modelAllowed, creditsFor, usdFor, TOOL_SPECS } from '../../../lib/agent/core.js'
import { buildRequest, callAnthropic, callMock, mockMode, apiKey, cleanMessages } from '../../../lib/agent/server.js'

/*
  POST /api/agent
  --------------------------------------------------------------------------
  One model step for an agent chat. The loop itself runs in the browser
  (lib/agent/runner.js) because the sheet it works on lives there; this route
  is the only place a model is called and the only place credits are spent.

  ORDER
    1. same-site guard, rate limit
    2. who is asking (Supabase session) — never trusted from the body
    3. what they may spend: plan, balance, per-task and daily limits
    4. call the model, streaming text back as it arrives
    5. debit what the API REPORTED it used, through the service role

  The response is a small SSE stream of our own:
    event: text   data: {"text": "..."}
    event: done   data: {content, stop_reason, credits, balance}
    event: error  data: {message, status}

  A person who presses Stop aborts the upstream call too, and is charged for
  what was produced before it stopped — input from message_start, output
  estimated from the characters streamed. Never nothing, never the maximum.
  -------------------------------------------------------------------------- */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_BODY_BYTES = 4_000_000
/* A hard ceiling on one task, whatever the agent's own setting says. */
const HARD_TASK_CAP = 1000
const DAY_CAP = { pro: 1500, max: 4000 }

const bad = (status, error) => NextResponse.json({ error }, { status })

/* Calls in flight per user, on this instance. The balance is checked before a
   call and debited after it, so forty parallel calls all pass the same check;
   three at a time (a few chats running at once) bounds the overdraft to a
   couple of calls. Per instance
   only — a reservation in the database is the complete answer (see
   AUDIT_OCT01.md). */
const MAX_IN_FLIGHT = 3
const inFlight = new Map()
const s = v => (typeof v === 'string' ? v.slice(0, 200) : null)

export async function POST(request) {
  const cross = refuseCrossSite(request)
  if (cross) return cross
  /* Refused on the header before a byte is read: request.text() on an
     unbounded body, before authentication, was free work for anybody. */
  if (+(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) return bad(413, 'This conversation is too long to send. Start a new chat.')

  /* ── who ── (before parsing anything they sent) */
  const supabase = serverClient(await cookies())
  const mock = mockMode()
  if (!supabase && !mock) return bad(503, 'Accounts are not configured on this deployment.')
  let user = null
  if (supabase) {
    const { data } = await supabase.auth.getUser()
    user = data?.user || null
  }
  /* Mock answers without an account only where there are no accounts at all
     (local development with Supabase unconfigured). */
  if (!user && !(mock && !supabase)) return bad(401, 'Sign in to use agents.')
  if (user) {
    const aal = await refuseUnfinishedSignIn(supabase)
    if (aal) return aal
  }

  const limited = rateLimit(`agent:${user?.id || 'anon'}`, { limit: 40, windowMs: 60_000 })
  if (limited && limited.ok === false) return bad(429, 'Too many requests. Wait a moment.')

  const raw = await request.text()
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return bad(413, 'This conversation is too long to send. Start a new chat.')
  let body
  try { body = JSON.parse(raw) } catch { return bad(400, 'Malformed request.') }

  const model = MODELS.some(m => m.id === body.model) ? body.model : null
  if (!model) return bad(400, 'Unknown model.')
  const effort = ['low', 'medium', 'high', 'max'].includes(body.effort) ? body.effort : null
  const messages = cleanMessages(body.messages)
  if (!messages) return bad(400, 'This conversation has content the app does not send.')
  if (messages[0]?.role !== 'user') return bad(400, 'A conversation starts with the person.')
  const toolNames = Array.isArray(body.toolNames) ? body.toolNames.filter(n => typeof n === 'string' && TOOL_SPECS[n]) : []

  /* ── what they may spend ── */
  let balance = null
  if (user) {
    const { data, error } = await supabase.rpc('ai_balance')
    if (error) {
      if (!mock) return bad(503, 'Agent credits are not set up yet (migration 0012 is missing).')
    } else balance = data
  }
  const plan = balance?.plan || (mock ? 'max' : 'free')
  if (!mock) {
    if (!apiKey()) return bad(503, 'The AI service is not configured yet.')
    if (!hasServiceRole()) return bad(503, 'Credits cannot be recorded on this deployment (service role key missing).')
    if (plan === 'free') return bad(402, 'Agents are part of Pro and Max.')
    if (!modelAllowed(model, plan)) return bad(403, `${modelById(model).name} is part of the Max plan.`)
    if ((balance?.remaining ?? 0) <= 0) return bad(402, 'You are out of agent credits. Top up or wait for your monthly credits to renew.')
    /* The daily cap is checked on EVERY call. It used to sit inside
       `if (taskId)`, so a request that simply left taskId out skipped both
       caps — the body is ours to write, not the caller's to trust. */
    const taskId = s(body.taskId)
    const { data: spent } = await supabase.rpc('ai_spent', { p_task: taskId || '' })
    if ((spent?.today || 0) >= (DAY_CAP[plan] || 1500)) return bad(402, 'You reached today’s agent limit. It resets at midnight UTC.')
    if (taskId) {
      const taskLimit = Math.min(HARD_TASK_CAP, Number.isFinite(+body.taskLimit) && +body.taskLimit > 0 ? +body.taskLimit : HARD_TASK_CAP)
      if ((spent?.task || 0) >= taskLimit) return bad(402, `This task reached its limit of ${taskLimit} credits.`)
    }
    /* "Any credit left" is not enough for one call: a 4 MB conversation on
       Opus is several hundred credits of input alone, and the debit happens
       after the fact. Refuse a call whose INPUT alone (≈3 characters per
       token, on the generous side) would overdraw the balance. */
    const estIn = creditsFor(model, { input_tokens: Math.ceil(raw.length / 3) })
    if (estIn > (balance?.remaining ?? 0)) return bad(402, 'This chat is too long for the credits you have left. Start a new chat or top up.')
  }

  /* ── call ── */
  const flightKey = user?.id || 'anon'
  if ((inFlight.get(flightKey) || 0) >= MAX_IN_FLIGHT) return bad(429, 'Another agent step is still running. Wait for it to finish.')
  inFlight.set(flightKey, (inFlight.get(flightKey) || 0) + 1)
  const land = () => { const n = (inFlight.get(flightKey) || 1) - 1; if (n > 0) inFlight.set(flightKey, n); else inFlight.delete(flightKey) }
  const req = buildRequest({ model, effort, system: body.system, toolNames, web: !!body.web, messages })
  const upstream = new AbortController()
  request.signal?.addEventListener('abort', () => upstream.abort(), { once: true })
  const enc = new TextEncoder()
  const meta = { agent: s(body.agentId), chat: s(body.chatId), task: s(body.taskId) }

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const send = (event, data) => {
        if (closed) return
        try { controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) } catch { closed = true }
      }
      const onText = text => send('text', { text })
      let result = null, usage = null, failure = null
      try {
        result = mock && !apiKey()
          ? await callMock({ messages, toolNames }, { onText, signal: upstream.signal })
          : await callAnthropic(req, { signal: upstream.signal, onText })
        usage = result.usage
      } catch (err) {
        failure = err
        usage = err?.partial || null
      }

      /* Debit whatever ran — a completed step, or a stopped one. */
      let credits = 0
      if (usage && !mock) {
        credits = creditsFor(model, usage)
        if (credits > 0) {
          try {
            const debit = () => adminClient().rpc('ai_debit', {
              p_org: `org_${user.id}`, p_user: user.id, p_agent: meta.agent, p_chat: meta.chat, p_task: meta.task,
              p_model: modelById(model).api,
              p_input: usage.input_tokens || 0, p_output: usage.output_tokens || 0,
              p_cache_write: usage.cache_creation_input_tokens || 0, p_cache_read: usage.cache_read_input_tokens || 0,
              p_searches: usage.server_tool_use?.web_search_requests || 0,
              p_usd: Number(usdFor(model, usage).toFixed(6)), p_credits: credits,
            })
            /* Once more before giving up: a lost debit is a free call. */
            let { data, error } = await debit()
            if (error) ({ data, error } = await debit())
            if (error) console.error('[agent] DEBIT LOST', { user: user.id, credits, model, error: error.message })
            else balance = data
          } catch (e) { console.error('[agent] debit failed', e?.message) }
        }
      }

      if (failure) {
        if (failure.name !== 'AbortError') {
          const status = failure.status || 502
          /* Fixed sentences only. The upstream text can name our account's
             credit state, model ids or limits; it goes to the server log. */
          if (status !== 429 && status !== 529) console.error('[agent] upstream failed', status, failure.message)
          const message = status === 429 || status === 529 ? 'The AI service is busy. Try again in a moment.'
            : status === 400 ? 'The AI service could not take this conversation. Try starting a new chat.'
            : 'The AI service failed. Try again.'
          send('error', { message, status, credits, balance })
        }
      } else {
        send('done', { content: result.content, stop_reason: result.stop_reason, credits, balance, mock: !!(mock && !apiKey()) })
      }
      land()
      closed = true
      try { controller.close() } catch { /* already closed by the client */ }
    },
    cancel() { upstream.abort() },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  })
}

/* GET /api/agent — the caller's balance, for the credits panel. */
export async function GET(request) {
  const cross = refuseCrossSite(request)
  if (cross) return cross
  const supabase = serverClient(await cookies())
  const mock = mockMode()
  if (!supabase) return mock ? NextResponse.json({ balance: null, mock: true }) : bad(503, 'Not configured.')
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) return bad(401, 'Sign in to use agents.')
  const aal = await refuseUnfinishedSignIn(supabase)
  if (aal) return aal
  const { data, error } = await supabase.rpc('ai_balance')
  if (error) return NextResponse.json({ balance: null, mock, setup: 'Migration 0012 is not applied.' })
  return NextResponse.json({ balance: data, mock: mock && !apiKey(), configured: !!apiKey() })
}
