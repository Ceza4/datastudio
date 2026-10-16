// Shared Playwright helpers for driving the real /app against the local Supabase double.
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const require = createRequire('/opt/npm-tools/node_modules/')
const { chromium } = require('playwright')

export const BASE = 'http://localhost:3100'
export const SHOTS = '/home/claude/e2e/shots'
mkdirSync(SHOTS, { recursive: true })

function b64url(s) { return Buffer.from(s).toString('base64url') }
function fakeJwt() {
  const now = Math.floor(Date.now() / 1000)
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const p = b64url(JSON.stringify({ sub: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'e2e@example.test', aal: 'aal1', amr: [{ method: 'password', timestamp: now }], exp: now + 86400, iat: now, session_id: 'e2e' }))
  return `${h}.${p}.sig`
}
export function sessionCookie() {
  const now = Math.floor(Date.now() / 1000)
  const session = {
    access_token: fakeJwt(), token_type: 'bearer', expires_in: 86400, expires_at: now + 86400, refresh_token: 'e2e-refresh',
    user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'e2e@example.test', app_metadata: { provider: 'email' }, user_metadata: { display_name: 'E2E Tester' }, factors: [] },
  }
  return { name: 'sb-localhost-auth-token', value: 'base64-' + b64url(JSON.stringify(session)), domain: 'localhost', path: '/', sameSite: 'Lax' }
}

export async function launch({ width = 1440, height = 900, colorScheme = 'light' } = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
  const context = await browser.newContext({ viewport: { width, height }, colorScheme })
  await context.addCookies([sessionCookie()])
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)) })
  return { browser, context, page, errors }
}

export async function resetMock() { await fetch('http://localhost:54321/__reset') }
export async function dump() { return (await fetch('http://localhost:54321/__dump')).json() }

export async function openApp(page) {
  await page.goto(BASE + '/app', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
}

let pass = 0, fail = 0
export const results = []
export function ok(cond, msg, extra) {
  results.push({ ok: !!cond, msg, extra })
  if (cond) { pass++; console.log('  ok   ' + msg) } else { fail++; console.log('  FAIL ' + msg + (extra ? '  :: ' + JSON.stringify(extra).slice(0, 400) : '')) }
}
export function summary() { console.log(`\n${pass} passed, ${fail} failed`); return fail }
export const sleep = ms => new Promise(r => setTimeout(r, ms))
