/*
  scripts/dev-local.mjs  —  `npm run dev:local`
  --------------------------------------------------------------------------
  THE APP ON YOUR MACHINE, SIGNED IN, WITHOUT A REAL ACCOUNT.

  Three processes, all local, nothing touches the real Supabase project:
    · audit/e2e/mock-supabase.mjs on :54321 — the audit's Supabase double:
      one fixed user (E2E Tester, Max plan), tables kept in memory
    · `next dev` on :3000, pointed at the double
    · a one-route helper on :3001 that sets the double's session cookie and
      sends you to /app. Cookies on localhost ignore the port, so a cookie set
      by :3001 is the app's cookie too.

  No app code knows about any of this: the real proxy.js gate, sync and
  IndexedDB run exactly as they do in production.

  The double's data lives in memory and is gone when this stops. What you
  made is still in the browser (IndexedDB) and syncs back up next time.
  Things that need a real server do not work here: People conversations
  (their database functions answer empty) and the agent's model calls.
  -------------------------------------------------------------------------- */
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const MOCK_PORT = 54321
const APP_PORT = 3000
const LOGIN_PORT = 3001
const USER_ID = '00000000-0000-4000-8000-000000000001'

const b64url = s => Buffer.from(s).toString('base64url')

/* The same session audit/e2e/lib.mjs gives the browser in the e2e runs. The
   signature is never checked: only the double reads this token. */
function sessionCookie() {
  const now = Math.floor(Date.now() / 1000)
  const jwt = [
    b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    b64url(JSON.stringify({
      sub: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'e2e@example.test', aal: 'aal1',
      amr: [{ method: 'password', timestamp: now }], exp: now + 86400 * 30, iat: now, session_id: 'local',
    })),
    'sig',
  ].join('.')
  const session = {
    access_token: jwt, token_type: 'bearer', expires_in: 86400 * 30, expires_at: now + 86400 * 30, refresh_token: 'local-refresh',
    user: {
      id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'e2e@example.test',
      app_metadata: { provider: 'email' }, user_metadata: { display_name: 'E2E Tester' }, factors: [],
    },
  }
  return 'base64-' + b64url(JSON.stringify(session))
}

const children = []
function run(cmd, args, env, quiet) {
  const p = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: quiet ? 'ignore' : 'inherit' })
  children.push(p)
  p.on('exit', code => { if (!stopping) { console.log(`\n${args[0]} stopped (${code}). Shutting down.`); stop() } })
  return p
}

let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  for (const p of children) { try { p.kill('SIGTERM') } catch { /* gone */ } }
  login.close()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

run('node', ['audit/e2e/mock-supabase.mjs'], { MOCK_PORT: String(MOCK_PORT) }, true)
run('npx', ['next', 'dev', '-p', String(APP_PORT)], {
  NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${MOCK_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'local-service',
  /* Node 26 warns that `module.register()` is deprecated, once per Turbopack
     worker — a cold compile printed it 227 times and buried everything else.
     Harmless; silenced for this command only. */
  NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=DEP0205'].filter(Boolean).join(' '),
})

const login = http.createServer((req, res) => {
  res.writeHead(302, {
    /* `sb-localhost-auth-token`: supabase-js names the cookie after the
       project host, which here is localhost. */
    'set-cookie': `sb-localhost-auth-token=${sessionCookie()}; Path=/; Max-Age=${86400 * 30}; SameSite=Lax`,
    location: `http://localhost:${APP_PORT}/app`,
  })
  res.end()
}).listen(LOGIN_PORT, () => {
  console.log(`\n  Open http://localhost:${LOGIN_PORT} — it signs you in as "E2E Tester" and opens the app.`)
  console.log('  Ctrl+C stops everything.\n')
})
