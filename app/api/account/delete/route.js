import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { serverClient, adminClient, hasServiceRole } from '../../../../lib/supabase/server'
import { rateLimit } from '../../../../lib/ratelimit'
import { refuseCrossSite } from '../../_guard'
import { COOKIE_OPTIONS } from '../../../../lib/cookies'

/*
  POST /api/account/delete
  --------------------------------------------------------------------------
  Erasure. The real one — not the 30-day bin.

  THE TWO-CLIENT SHAPE IS THE WHOLE SECURITY MODEL OF THIS FILE.

  Everything that establishes WHO is asking runs as the user, through RLS.
  Only the deletion itself runs as the service role, because removing an
  `auth.users` row is not something any user-scoped token can do. That split
  means the privileged step happens after identity has already been proved by
  Postgres rather than by this code.

  WHY THE TYPED EMAIL IS CHECKED HERE AND NOT ONLY IN THE DIALOG
  A confirmation dialog is a courtesy to the person clicking. It is not a
  control: this endpoint can be called with curl and a session cookie, and a
  UI check would be satisfied by simply not opening the UI. Checking the typed
  value server-side is what makes accidental deletion actually hard.

  ORDER MATTERS, AND THE ORDER IS: BYTES, THEN ROWS, THEN THE USER.
  Storage objects go first, because once the rows are gone nothing knows their
  paths any more and they become unreachable garbage in a bucket that still
  bills for them. Rows next. The auth user last, because it is the thing whose
  cascade removes the ability to authenticate at all — do it first and a
  failure halfway through leaves an account that cannot sign in to finish the
  job or to complain about it.
  -------------------------------------------------------------------------- */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* PostgREST caps a response at `db.max_rows`, which is 1000 on hosted Supabase
   by default, and it does NOT report an error when it truncates — it sets a
   Content-Range header nobody was reading. So an account with 1200 assets had
   1000 objects removed and 200 left in the bucket forever, with their manifest
   rows cascaded away by step 4. The "correct" path produced the same orphan
   this file's header is written to prevent.

   `build()` returns a query builder or null; null means "nothing to ask". */
const PAGE = 1000
async function pageAll(build) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const q = build()
    if (!q) return out
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < PAGE) return out
  }
}

export async function POST(request) {
  /* FIRST, because it is the cheapest and because everything below it assumes
     the request came from this application. See app/api/_guard.js. */
  const cross = refuseCrossSite(request)
  if (cross) return cross

  if (!hasServiceRole()) {
    /* Fail LOUDLY rather than pretending. A delete endpoint that quietly does
       nothing is worse than one that errors: the user believes their data is
       gone and it is not, which is both a trust failure and, for a GDPR
       erasure request, a compliance one. */
    return NextResponse.json(
      { error: 'Account deletion is not available on this deployment. Contact support.' },
      { status: 503 },
    )
  }

  const supabase = serverClient(await cookies())
  if (!supabase) return NextResponse.json({ error: 'Not configured.' }, { status: 503 })

  const { data: auth } = await supabase.auth.getUser()
  const user = auth?.user
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  /* RATE LIMITED BY ACCOUNT, AFTER AUTHENTICATION.

     It used to run first and key on the caller's IP, taken from
     x-forwarded-for. Two problems, and the ordering caused both. Five
     UNAUTHENTICATED posts from one address burned the bucket for every real
     user behind that address — an office, a university, a VPN. And because the
     header is read from the request, an attacker could send
     `X-Forwarded-For: <the victim's IP>` and pre-exhaust their bucket, which
     turns a safety rail into a targeted denial of the one operation a person
     might be in a hurry to perform. (On Vercel the platform overwrites the
     header; that is a property of the deployment, not of this code.)

     Keyed on user.id, this bounds confirmation guessing for one account and
     cannot be aimed at anybody. */
  const gate = rateLimit(`delete:${user.id}`, { limit: 5, windowMs: 60 * 60 * 1000 })
  if (!gate.ok) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } })
  }

  let body = {}
  try { body = await request.json() } catch { /* an empty body fails the check below */ }
  const typed = String(body?.confirm || '').trim().toLowerCase()
  if (!typed || typed !== String(user.email || '').trim().toLowerCase()) {
    return NextResponse.json(
      { error: 'Type your email address exactly to confirm.' },
      { status: 400 },
    )
  }

  const admin = adminClient()

  try {
    /* Which organisations die with this person, and which survive them.

       ONLY personal orgs, and only where they are the sole member. Deleting a
       shared organisation because one of its members closed their account
       would destroy other people's work — the single worst thing this endpoint
       could do. Those keep existing; the membership row goes when the auth user
       does, via its own cascade. */
    /* EVERY ERROR IS CHECKED FROM HERE DOWN, and that is a change rather than
       a habit. supabase-js does not throw — it resolves with `{ data, error }`
       — and this route used to destructure only `data`. The worst path was the
       very first read: if this select failed for any reason, `memberships` was
       null, `doomedOrgs` was empty, both loops did nothing, control fell
       through to deleteUser(), and the route returned `{ ok: true }`.

       The auth user would be gone and its rows cascaded away, but EVERY
       STORAGE OBJECT would survive, along with the organisations, their
       subscriptions and their usage rows — unreachable by any client and still
       billing. The user would have been told their data was deleted. For a
       GDPR erasure request that is not a bug report, it is a compliance
       failure. */
    const { data: memberships, error: memErr } = await supabase
      .from('org_members').select('org_id, role').eq('user_id', user.id)
    if (memErr) throw new Error(`could not read memberships: ${memErr.message}`)

    const candidateIds = (memberships || []).map(m => m.org_id)
    const doomedOrgs = []

    for (const orgId of candidateIds) {
      const { data: org, error: orgErr } = await admin
        .from('organizations').select('id, personal').eq('id', orgId).maybeSingle()
      if (orgErr) throw new Error(`could not read organisation ${orgId}: ${orgErr.message}`)
      if (!org?.personal) continue

      const { count, error: cErr } = await admin
        .from('org_members').select('user_id', { count: 'exact', head: true }).eq('org_id', orgId)
      /* `(count ?? 0) <= 1` USED TO BE HERE, AND IT FAILED TOWARD DESTRUCTION.

         A failed count gives `count === null`; `null ?? 0` is 0, and `0 <= 1`
         is true — so the organisation was marked for deletion precisely when
         we could not establish whether anyone else was in it. Deleting a
         shared organisation because one member closed their account is, in
         this file's own words, the single worst thing this endpoint could do,
         and the nullish coalescing was the line that made it reachable.

         Unknown now means "leave it alone". */
      if (cErr || count == null) continue
      if (count <= 1) doomedOrgs.push(orgId)
    }

    /* ── 1. bytes ──
       Listed from the MANIFEST rather than from the bucket. Listing a bucket is
       paginated, rate-limited and returns objects this org may not own if a
       path was ever built wrongly; the manifest is the authoritative record of
       what belongs to whom, which is the reason it exists.

       TWO SETS OF PATHS, not one. The loop used to cover only `doomedOrgs`.
       But `assets.owner_id` references auth.users ON DELETE CASCADE, so step 4
       destroys this person's asset ROWS inside SHARED organisations too — and
       once the rows are gone, nothing in the system knows those paths. Join a
       shared workspace, upload 3GB of PDFs, delete your account, and the bucket
       kept all 3GB forever with no row referencing it. The header of this file
       states the rule correctly and the code applied it to half the cases.

       Paths in shared orgs that OTHER rows still name are excluded — deduped
       assets share one object, and removing it would blank a colleague's
       image. */
    const doomedSet = new Set(doomedOrgs)
    const mine = await pageAll(() => admin.from('assets').select('path, org_id').eq('owner_id', user.id))
    const inDoomed = await pageAll(() =>
      doomedOrgs.length ? admin.from('assets').select('path').in('org_id', doomedOrgs) : null)

    const candidatePaths = new Set()
    for (const a of [...mine, ...inDoomed]) if (a?.path) candidatePaths.add(a.path)

    /* Anything still claimed by a row that will SURVIVE stays. */
    const survivors = await pageAll(() =>
      candidatePaths.size
        ? admin.from('assets').select('path, org_id, owner_id').in('path', [...candidatePaths])
        : null)
    for (const row of survivors) {
      const dies = row.owner_id === user.id || doomedSet.has(row.org_id)
      if (!dies) candidatePaths.delete(row.path)
    }

    const paths = [...candidatePaths]
    for (let i = 0; i < paths.length; i += 100) {
      const { error: rmErr } = await admin.storage.from('ds-assets').remove(paths.slice(i, i + 100))
      /* CHECKED, where it used to be wrapped in a try/catch around a call that
         never throws — supabase-js resolves with `{ error }`. A wrong bucket
         name, a revoked key or a storage outage was silent, and the rows that
         name these paths are about to be destroyed. Abort before that happens:
         a half-deleted account can be finished by hand, orphaned bytes cannot
         even be found. */
      if (rmErr) throw new Error(`could not remove stored files: ${rmErr.message}`)
    }

    /* ── 2. the record that this happened ──
       Written BEFORE the rows go, and with a NULL org_id on purpose: audit rows
       cascade with their organisation, so an entry filed under the org being
       deleted would delete itself. actor_id is ON DELETE SET NULL, so this row
       outlives the user as an unattributed fact — which is what a deletion
       record needs to be to survive the deletion it records. */
    /* `outcome: 'pending'`, NOT 'ok'. This row is written before the
       destruction and used to assert success in advance — so a failure in step
       3 or 4 left a permanent, immutable record (no update or delete policy,
       0004 §10) claiming a deletion that did not happen, as the only surviving
       evidence, with the actor either gone or in an unknown state. It is
       settled below. */
    const { data: auditRow, error: auditErr } = await admin.from('audit_log').insert({
      org_id: null,
      actor_id: user.id,
      action: 'account.delete',
      outcome: 'pending',
      detail: { orgs: doomedOrgs.length, files: paths.length, email_domain: String(user.email || '').split('@')[1] || null },
      user_agent: request.headers.get('user-agent')?.slice(0, 200) || null,
    }).select('id').maybeSingle()
    if (auditErr) throw new Error(`could not record the deletion: ${auditErr.message}`)

    /* ── 3. rows ──
       Deleting the organisation cascades to docs, assets, subscriptions, usage
       and memberships through the foreign keys in migration 0004. One delete
       per org rather than five per table, and no chance of an ordering mistake
       leaving orphans. */
    for (const orgId of doomedOrgs) {
      const { error: delErr } = await admin.from('organizations').delete().eq('id', orgId)
      if (delErr) throw new Error(`could not delete organisation ${orgId}: ${delErr.message}`)
    }

    /* ── 4. the user ──
       Cascades to profiles and to any remaining membership rows in shared
       organisations. Last, so that a failure anywhere above leaves an account
       that can still sign in, see what happened and try again. */
    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) throw error

    if (auditRow?.id) {
      await admin.from('audit_log').update({ outcome: 'ok' }).eq('id', auditRow.id)
    }

    /* CLEAR THE SESSION COOKIES. The account no longer exists; leaving the
       browser holding a token for it produces a confusing sequence of 401s and
       redirects at exactly the moment the user most wants the app to behave
       predictably. The client also wipes the local workspace — see
       components/ui/AccountButton.js, and note that IS the copy of the data
       for a local-first app, so "deleted" without it is not true. */
    const done = NextResponse.json({ ok: true })
    for (const c of (await cookies()).getAll()) {
      if (c.name.startsWith('sb-')) done.cookies.set(c.name, '', { ...COOKIE_OPTIONS, maxAge: 0 })
    }
    return done
  } catch (err) {
    console.error('[delete] failed', err)
    return NextResponse.json(
      { error: 'Could not finish deleting the account. Nothing has been half-removed that you can see — contact support and quote the time.' },
      { status: 500 },
    )
  }
}
