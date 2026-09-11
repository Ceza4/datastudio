/*
  tests/limits.test.mjs
  --------------------------------------------------------------------------
  Quota metering (lib/limits.js), now that it reads real numbers.

  The two rules under test are product decisions, not implementation details,
  and they are the reason enforcement is safe to switch on at all:

    1. the free tier limits CLOUD storage, never local — you never stop
       someone working, only syncing;
    2. over quota means read-only sync, not deletion — nothing is ever removed
       for non-payment.

  Plus the property that makes it usable on the write path: checkQuota does
  not touch the network. If it did, every image drop would stall on a request,
  and a slow connection would present as a slow app.
  -------------------------------------------------------------------------- */

import {
  PLANS, ENFORCE, LOCAL_UNLIMITED, ACCOUNT_TTL_MS,
  setAccount, accountSnapshot, getAccount, refreshAccount, checkQuota, quotaMessage, _resetAccount,
} from '../lib/limits.js'
import { fakeClient } from './fake-postgrest.mjs'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}  (got ${JSON.stringify(a)})`)

const MB = 1024 * 1024

console.log('\n  the plans')
{
  eq(Object.keys(PLANS), ['free', 'pro', 'max'], 'three tiers, matching the plans table')

  /* FREE IS ZERO, AND ZERO IS THE FEATURE.
     A free account is local-only: nothing leaves the browser. Expressing that
     as `cloudBytes: 0` rather than as an `if (plan === 'free')` somewhere means
     the ordinary quota arithmetic already refuses the first cloud write, and
     there is no branch for a future feature to forget. */
  ok(PLANS.free.cloudBytes === 0 && PLANS.free.assetBytes === 0 && PLANS.free.maxFileBytes === 0,
     'free is zero across the board, not a special case')
  ok(PLANS.free.cloud === false, 'and says so structurally')

  for (const [name, p] of Object.entries(PLANS)) {
    if (name !== 'free') {
      ok(p.cloudBytes > 0 && p.assetBytes > 0 && p.maxFileBytes > 0, `${name} caps every pool`)
      ok(p.cloud === true, `${name} syncs`)
    }
    ok(p.notebooks === Infinity, `${name} does NOT cap how many notebooks you may make — a limit on how many things you can create makes a tool feel small`)
  }
  ok(PLANS.free.assetBytes < PLANS.pro.assetBytes && PLANS.pro.assetBytes < PLANS.max.assetBytes,
     'the tiers ascend')
  ok(PLANS.pro.maxFileBytes < PLANS.max.maxFileBytes, 'and so do the per-file caps')
  ok(ENFORCE === true, 'enforcement is on now that the usage table is real')
  ok(LOCAL_UNLIMITED === true, 'and local storage is still unlimited — rule 1, greppable')
}

console.log('\n  anonymous use is never metered')
{
  _resetAccount()
  const r = await checkQuota('assetBytes', 500 * MB)
  ok(r.ok, 'a signed-out user is over no limit at all, whatever they drop in')
  ok(r.enforced === false, 'and it says why, rather than looking like a pass on the numbers')
}

console.log('\n  under and over')
{
  /* Pro rather than Free, now that Free means zero cloud — a "does it fit"
     test against a tier with no cloud at all is not testing the arithmetic. */
  setAccount({ signedIn: true, plan: 'pro', cloud: true, usage: { cloudBytes: 0, assetBytes: 100 * MB, notebooks: 3 } })
  const under = await checkQuota('assetBytes', 10 * MB)
  ok(under.ok, 'a write that fits passes')
  eq(under.headroom, PLANS.pro.assetBytes - 110 * MB, 'and reports the remaining headroom')

  const over = await checkQuota('assetBytes', PLANS.pro.assetBytes)
  ok(!over.ok, 'a write that would exceed the cap fails the check')
  eq(over.reason, 'over-quota', 'with a reason callers can switch on')
  eq(over.plan, 'pro', 'and the plan it was measured against')

  const msg = quotaMessage(over)
  ok(/still saved on this device/.test(msg), 'the message says the work is safe locally — rule 2, in the copy rather than only in a comment')
  ok(!/delet/i.test(msg), 'and never suggests deleting anything')
  eq(quotaMessage({ ok: true }), null, 'a passing check has no message')
}

console.log('\n  a free account refuses every cloud write')
{
  setAccount({ signedIn: true, plan: 'free' })
  ok(!(await checkQuota('assetBytes', 1)).ok, 'one byte is over the limit, because the limit is zero')
  ok(!(await checkQuota('cloudBytes', 1)).ok, 'and so is one byte of document')
  /* The point of expressing local-only as a zero rather than as a branch: the
     ordinary arithmetic already says no, so lib/sync.js never starting is a
     performance decision rather than the only thing standing between a free
     account and the cloud. */
}

console.log('\n  the old call sites keep metering')
{
  setAccount({ signedIn: true, plan: 'pro', cloud: true, usage: { cloudBytes: 0, assetBytes: PLANS.pro.assetBytes, notebooks: 0 } })
  /* putImage and putPdf still say `imageBytes` / `pdfBytes`. Both are Storage
     bytes out of one budget now. Renaming them at every call site would be a
     wide diff through files this work does not otherwise touch, and a missed
     one would silently meter nothing at all. */
  ok(!(await checkQuota('imageBytes', 1)).ok, 'imageBytes still meters')
  ok(!(await checkQuota('pdfBytes', 1)).ok, 'and so does pdfBytes')
  ok((await checkQuota('somethingElse', 1)).ok, 'an unknown kind passes rather than blocking a write nobody meant to meter')
}

console.log('\n  notebooks are uncapped on every tier')
{
  setAccount({ signedIn: true, plan: 'pro', cloud: true, usage: { cloudBytes: 0, assetBytes: 0, notebooks: 99999 } })
  ok((await checkQuota('notebooks', 1)).ok, 'the ten-thousandth notebook is still allowed')
}

console.log('\n  reading the account from the server')
{
  _resetAccount()
  /* ONE round trip now, not four: my_account() is a security-definer function
     that returns profile + org + role + plan + limits + usage as a single
     jsonb object, filtered on auth.uid() inside the database rather than on an
     id the caller supplies. */
  const c = fakeClient()
  c.rpc = async (name) => name === 'my_account' ? { data: {
    user_id: 'user-a', email: 'a@b.co', name: 'A', avatar: null,
    org_id: 'org_1', org_name: 'Personal', role: 'owner',
    plan: 'pro', plan_label: 'Pro', cloud: true,
    limits: { doc_bytes: PLANS.pro.cloudBytes, asset_bytes: PLANS.pro.assetBytes, max_file_bytes: PLANS.pro.maxFileBytes },
    usage: { doc_bytes: 5 * MB, asset_bytes: 900 * MB, notebooks: 12 },
    status: 'active', period_end: null,
  }, error: null } : { data: null, error: { message: 'unknown rpc' } }

  const acc = await refreshAccount(c, 'user-a')
  eq(acc.plan, 'pro', 'the plan comes from the server, not from the local table')
  eq(acc.orgId, 'org_1', 'and so does the tenant it belongs to')
  eq(acc.usage.assetBytes, 900 * MB, 'and the usage from the trigger-maintained table')
  eq(acc.usage.notebooks, 12, 'including the notebook count')
  ok(acc.cloud === true, 'and whether this tier syncs at all')
  eq(acc.limits.maxFileBytes, PLANS.pro.maxFileBytes, 'limits come back with it, so the client can predict a refusal')
  ok((await checkQuota('assetBytes', 100 * MB)).ok, 'pro headroom is respected')

  const snap = accountSnapshot()
  ok(snap.stale === false, 'a fresh read is not stale')
  ok(snap.at > 0, 'and is stamped')
  ok(ACCOUNT_TTL_MS >= 30_000, 'the cache lives long enough not to be refetched per keystroke')

  eq((await refreshAccount(null, null)).signedIn, false, 'no client means signed out, not an error')
}

console.log('\n  an unreachable server does not reset the numbers to zero')
{
  setAccount({ signedIn: true, plan: 'pro', cloud: true,
    limits: { cloudBytes: PLANS.pro.cloudBytes, assetBytes: 200 * MB, maxFileBytes: PLANS.pro.maxFileBytes },
    usage: { cloudBytes: 0, assetBytes: 199 * MB, notebooks: 1 } })
  const broken = { rpc: () => { throw new Error('failed to fetch') }, from: () => { throw new Error('failed to fetch') } }
  const acc = await refreshAccount(broken, 'user-a')
  eq(acc.usage.assetBytes, 199 * MB, 'the last known usage survives')
  ok(acc.stale === true, 'and is flagged stale')
  /* Resetting to zero would read as "plenty of room" and let a large upload
     queue that is going to be refused the moment the network returns. */
  ok(!(await checkQuota('assetBytes', 10 * MB)).ok, 'so a write that would not fit is still refused')
}

console.log('\n  an unknown plan falls back rather than becoming unlimited')
{
  setAccount({ signedIn: true, plan: 'enterprise-gold', usage: { cloudBytes: 0, assetBytes: 500 * MB, notebooks: 0 } })
  eq(accountSnapshot().plan, 'free', 'a plan string this build does not know is treated as free')
  ok(accountSnapshot().cloud === false, 'which means no cloud, rather than unlimited cloud')
  ok(!(await checkQuota('assetBytes', 1)).ok, 'which is the safe direction — the alternative is a free unlimited tier for anyone who can write to profiles.plan')
}

console.log('\n  getAccount does not await the network')
{
  setAccount({ signedIn: true, plan: 'pro', cloud: true, usage: { cloudBytes: 1, assetBytes: 2, notebooks: 3 } })
  const before = Date.now()
  const a = await getAccount()
  ok(Date.now() - before < 20, 'it resolves immediately — it is a cache read, not a request')
  eq(a.usage.notebooks, 3, 'returning what sync.js last learned')
}

_resetAccount()
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
