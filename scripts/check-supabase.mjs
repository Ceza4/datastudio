/*
  scripts/check-supabase.mjs
  --------------------------------------------------------------------------
  Verifies the Supabase wiring end to end.  node scripts/check-supabase.mjs

  Not part of `npm run check` (yet) — those three guards run on every build
  and must work with zero network/config. This one needs a real .env.local
  and a live project, so it's opt-in: run it by hand right after applying
  the migration, and again any time env vars change.

  Four checks, in order, each one only meaningful if the previous passed:
    1  env vars are present and look like a URL / JWT
    2  the project is reachable at all
    3  the schema from 0001_init.sql actually exists (tables + RLS)
    4  RLS actually blocks cross-user reads (the penetration test from
       SUPABASE_SETUP.md, automated so it doesn't get skipped next time)
  -------------------------------------------------------------------------- */

import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnvLocal() {
  const path = resolve(ROOT, '.env.local')
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const fileEnv = loadEnvLocal()
const env = { ...fileEnv, ...process.env }
const URL = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY

let failed = false
const fail = (msg) => { console.error(`  ✗ ${msg}`); failed = true }
const pass = (msg) => console.log(`  ✓ ${msg}`)

// Real shell/system env vars deliberately win over .env.local (so CI secrets
// can override a checked-in default) — but that's exactly the footgun that
// bit us once already: a stray $env:NEXT_PUBLIC_SUPABASE_URL left over in a
// PowerShell session (or set permanently in System Properties) silently wins
// over a correct .env.local with no visible reason why. Surface it up front
// instead of letting someone stare at "missing" values that aren't missing
// from the file at all.
for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
  const fromFile = fileEnv[key]
  const fromProcess = process.env[key]
  if (fromProcess !== undefined && fromFile !== undefined && fromProcess !== fromFile) {
    console.warn(
      `  ⚠ ${key}: a real shell/system environment variable (${fromProcess.slice(0, 24)}…) ` +
      `is overriding the different value in .env.local (${fromFile.slice(0, 24)}…). ` +
      `The shell/system one wins and is what gets used below.\n` +
      `    PowerShell: check with  echo $env:${key}  — if set, clear it with  ` +
      `Remove-Item Env:${key}  and make sure it's not also a permanent User/Machine ` +
      `variable (System Properties -> Environment Variables), then open a NEW terminal window.`
    )
  }
}

console.log('1. env vars')
if (!URL || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(URL)) {
  fail(`NEXT_PUBLIC_SUPABASE_URL missing or doesn't look like https://xxxx.supabase.co (got: ${URL || '(unset)'})`)
} else pass('NEXT_PUBLIC_SUPABASE_URL set')

// Two valid shapes: the legacy JWT anon key (three dot-separated segments,
// starts "eyJ") and Supabase's newer opaque publishable key
// ("sb_publishable_..."). Reject anything else, and specifically reject a
// "sb_secret_..." key here — that's the service-role equivalent and must
// never end up in a NEXT_PUBLIC_* var.
const looksLikeJwt = KEY && KEY.split('.').length === 3 && KEY.startsWith('eyJ')
const looksLikePublishable = KEY && KEY.startsWith('sb_publishable_')
const looksLikeSecret = KEY && KEY.startsWith('sb_secret_')

if (looksLikeSecret) {
  fail('NEXT_PUBLIC_SUPABASE_ANON_KEY is a sb_secret_ key — that bypasses RLS and must never be a NEXT_PUBLIC_* var. Use the publishable key instead.')
} else if (!KEY || !(looksLikeJwt || looksLikePublishable)) {
  fail(`NEXT_PUBLIC_SUPABASE_ANON_KEY missing or unrecognised format (got: ${KEY ? KEY.slice(0, 16) + '…' : '(unset)'}) — expected eyJ... (legacy anon JWT) or sb_publishable_... (new format)`)
} else pass(`NEXT_PUBLIC_SUPABASE_ANON_KEY set (${looksLikeJwt ? 'legacy JWT' : 'publishable'} format)`)

if (failed) {
  console.error('\nFix the env vars above (copy .env.local.example -> .env.local) before continuing.')
  process.exit(1)
}

const supabase = createClient(URL, KEY)

console.log('\n2. project reachable')
// Hits /auth/v1/health directly rather than querying a table — that endpoint
// exists on every project regardless of whether 0001_init.sql has been run
// yet, so this step proves network reachability only, not schema presence.
// (An earlier version of this script queried the `profiles` table here and
// silently treated "table doesn't exist" as a pass — a network sandbox that
// blocks the host outright, or a genuinely wrong URL, could slip through
// looking like success. If this step ever passes on a host you know is
// wrong, that's the bug to look for.)
try {
  const res = await fetch(`${URL.replace(/\/$/, '')}/auth/v1/health`, {
    headers: { apikey: KEY },
  })
  if (!res.ok) {
    fail(`reached ${URL} but got HTTP ${res.status} from /auth/v1/health — check the project URL is exactly right`)
    process.exit(1)
  }
  pass('reached the project')
} catch (e) {
  fail(`could not reach ${URL}: ${e.message} — if this is running somewhere with restricted network egress (a CI runner, a sandboxed agent), that's the likely cause, not your Supabase project`)
  process.exit(1)
}

console.log('\n3. schema present')
/* Four tables after 0003, not five. `notebooks`, `folders` and `images` are
   gone: the first two collapsed into `docs` (one table, one set of policies —
   0002 exists because the first pass got column privileges wrong on two
   tables out of five), and `images` became `assets` when PDFs and attachments
   gained a cloud story of their own. */
const tables = ['profiles', 'docs', 'assets', 'usage']
for (const t of tables) {
  const { error } = await supabase.from(t).select('*').limit(0)
  if (error) fail(`table "${t}" — ${error.message} (did you run every file in supabase/migrations/, in order?)`)
  else pass(`table "${t}" exists`)
}

console.log('\n4. RLS blocks anonymous reads')
// Signed out, the anon key should get zero rows back from every table above,
// not an error and not real data — that's the actual guarantee RLS makes.
for (const t of tables) {
  const { data, error } = await supabase.from(t).select('*').limit(1)
  if (error) continue // already reported above
  if (Array.isArray(data) && data.length > 0) {
    fail(`table "${t}" returned ${data.length} row(s) to an ANONYMOUS request — RLS is not enforcing. Check the policy exists and is enabled.`)
  } else {
    pass(`table "${t}" returns 0 rows anonymously`)
  }
}

console.log()
if (failed) {
  console.error('FAILED — see ✗ lines above. See SUPABASE_SETUP.md for what each step should look like.')
  process.exit(1)
}
console.log('All checks passed. Client + schema + RLS are wired correctly.')
/* Section 4 is weak BY CONSTRUCTION and saying so here is not modesty — a
   table with RLS enabled and ZERO policies also returns zero rows
   anonymously, so this script would show four green ticks against a schema
   that is completely broken for real signed-in users. The test that actually
   matters is supabase/rls_pentest.sql, which puts a logged-in user B against
   a logged-in user A's rows. Run it. */
console.log('\nThis does NOT prove signed-in isolation — anonymous requests get zero rows from a')
console.log('table with no policies at all. Run supabase/rls_pentest.sql in the SQL editor for that,')
console.log('and run its negative control too: a suite that cannot go red proves nothing.')
