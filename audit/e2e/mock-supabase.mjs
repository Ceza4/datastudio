/*
  Local Supabase test double for end-to-end runs of the real app.
  Auth: /auth/v1/user answers for one fixed test user (no verified factors).
  REST: a small in-memory PostgREST (eq/neq/is/in/lt/gt/gte/lte filters,
  insert/upsert/update/delete, HEAD counts). RPC: empty results.
  State is in memory, so it survives page reloads but not a restart — exactly
  what persistence tests need. GET /__dump returns everything for assertions.
*/
import http from 'node:http'

const PORT = Number(process.env.MOCK_PORT || 54321)
const USER = {
  id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated',
  email: 'e2e@example.test', email_confirmed_at: '2026-01-01T00:00:00Z',
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { display_name: 'E2E Tester' },
  identities: [], factors: [], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}
const tables = new Map()
const VERSIONED = new Set(['docs', 'blocks'])
const seed = () => { tables.set('profiles', [{ id: USER.id, display_name: 'E2E Tester', prefs: null, prefs_rev: 0 }]) }
seed()
const T = name => { if (!tables.has(name)) tables.set(name, []); return tables.get(name) }
const log = []

function parseVal(v) {
  if (v === 'null') return null
  if (v === 'true') return true
  if (v === 'false') return false
  return v
}
function filtersFrom(sp) {
  const f = []
  for (const [k, raw] of sp) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue
    const i = raw.indexOf('.')
    let op = raw.slice(0, i), val = raw.slice(i + 1), neg = false
    if (op === 'not') { neg = true; const j = val.indexOf('.'); op = val.slice(0, j); val = val.slice(j + 1) }
    f.push({ k, op, val, neg })
  }
  return f
}
function match(row, f) {
  return f.every(({ k, op, val, neg }) => {
    const r = row[k]; let ok
    switch (op) {
      case 'eq': ok = String(r) === val; break
      case 'neq': ok = String(r) !== val; break
      case 'is': ok = parseVal(val) === null ? r == null : r === parseVal(val); break
      case 'in': ok = val.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(r)); break
      case 'lt': ok = r < val; break
      case 'lte': ok = r <= val; break
      case 'gt': ok = r > val; break
      case 'gte': ok = r >= val; break
      default: ok = true
    }
    return neg ? !ok : ok
  })
}
const now = () => new Date().toISOString()

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const cors = {
    'access-control-allow-origin': req.headers.origin || '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': req.headers['access-control-request-headers'] || '*',
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS',
    'access-control-expose-headers': 'content-range,x-total-count',
  }
  const send = (code, body, extra = {}) => {
    res.writeHead(code, { 'content-type': 'application/json', ...cors, ...extra })
    res.end(body === undefined ? '' : JSON.stringify(body))
  }
  if (req.method === 'OPTIONS') return send(204)
  let body = ''
  for await (const c of req) body += c
  let json = null
  try { json = body ? JSON.parse(body) : null } catch {}
  log.push({ t: now(), m: req.method, p: url.pathname + url.search })
  if (log.length > 2000) log.shift()

  const p = url.pathname
  if (p === '/__dump') return send(200, { tables: Object.fromEntries(tables), log: log.slice(-300) })
  if (p === '/__reset') { tables.clear(); seed(); log.length = 0; return send(200, { ok: true }) }

  if (p === '/auth/v1/user') return send(200, USER)
  if (p.startsWith('/auth/v1/factors')) return send(200, [])
  if (p === '/auth/v1/logout') return send(204)
  if (p === '/auth/v1/token') return send(400, { error: 'invalid_grant', error_description: 'mock: no refresh' })
  if (p.startsWith('/auth/v1')) return send(200, {})

  if (p.startsWith('/rest/v1/rpc/')) {
    const fn = p.slice('/rest/v1/rpc/'.length)
    if (fn === 'my_account') return send(200, { user_id: USER.id, plan: process.env.MOCK_PLAN || 'max', plan_label: 'Max', org_id: '00000000-0000-4000-8000-0000000000aa', org_name: 'E2E Org', cloud: process.env.MOCK_PLAN !== 'free', email: USER.email, name: 'E2E Tester', role: 'owner', status: 'active', limits: { doc_bytes: 21474836480, asset_bytes: 268435456000, max_file_bytes: 1073741824 }, usage: { doc_bytes: 0, asset_bytes: 0, notebooks: 0 } })
    /* Same shape as 0012's ai_balance(), so the agent's Usage section has
       something real to show locally. */
    if (fn === 'ai_balance') {
      const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0)
      const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1)
      return send(200, { plan: 'max', monthly: 5000, used: 0, topup: 0, remaining: 5000, period_start: start.toISOString(), period_end: end.toISOString() })
    }
    return send(200, [])
  }
  if (p.startsWith('/rest/v1/')) {
    const name = p.slice('/rest/v1/'.length)
    const rows = T(name)
    const f = filtersFrom(url.searchParams)
    const prefer = String(req.headers.prefer || '')
    const wantRep = prefer.includes('return=representation')
    const single = String(req.headers.accept || '').includes('vnd.pgrst.object')
    if (req.method === 'GET' || req.method === 'HEAD') {
      let out = rows.filter(r => match(r, f))
      const lim = url.searchParams.get('limit'); if (lim) out = out.slice(0, Number(lim))
      const extra = { 'content-range': `0-${Math.max(0, out.length - 1)}/${out.length}` }
      if (req.method === 'HEAD') return send(200, undefined, extra)
      if (single) return out.length === 1 ? send(200, out[0], extra) : send(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' })
      return send(200, out, extra)
    }
    if (req.method === 'POST') {
      const list = Array.isArray(json) ? json : [json]
      const upsert = prefer.includes('resolution=merge-duplicates') || prefer.includes('resolution=ignore-duplicates')
      const keyCols = (url.searchParams.get('on_conflict') || 'id').split(',')
      const out = []
      for (const r of list) {
        const row = { created_at: now(), updated_at: now(), ...r }
        if (VERSIONED.has(name)) row.rev = 1
        if (!row.id && name !== 'profiles') row.id = crypto.randomUUID()
        const ex = rows.findIndex(x => keyCols.every(k => x[k] != null && String(x[k]) === String(row[k])))
        if (ex >= 0) {
          if (!upsert) return send(409, { code: '23505', message: `duplicate key value violates unique constraint "${name}_pkey"` })
          if (prefer.includes('ignore-duplicates')) continue
          rows[ex] = { ...rows[ex], ...row }; out.push(rows[ex])
        } else { rows.push(row); out.push(row) }
      }
      return send(201, wantRep ? (single ? out[0] : out) : undefined)
    }
    if (req.method === 'PATCH') {
      const out = []
      for (const r of rows) if (match(r, f)) { Object.assign(r, json, { updated_at: now() }); if (VERSIONED.has(name)) r.rev = (r.rev || 0) + 1; if (name === 'profiles' && json && 'prefs' in json) r.prefs_rev = (r.prefs_rev || 0) + 1; out.push(r) }
      return send(200, wantRep ? (single ? (out[0] ?? null) : out) : undefined)
    }
    if (req.method === 'DELETE') {
      const keep = rows.filter(r => !match(r, f)), gone = rows.filter(r => match(r, f))
      tables.set(name, keep)
      return send(200, wantRep ? gone : undefined)
    }
  }
  if (p.startsWith('/storage/v1')) {
    if (req.method === 'POST' || req.method === 'PUT') return send(200, { Key: p })
    return send(404, { statusCode: '404', error: 'not_found', message: 'mock storage' })
  }
  send(404, { message: 'mock: unhandled ' + p })
})
server.on('upgrade', (req, socket) => socket.destroy())
server.listen(PORT, () => console.log('mock supabase on', PORT))
