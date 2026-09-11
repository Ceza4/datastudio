import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { serverClient, adminClient, hasServiceRole } from '../../../../lib/supabase/server'
import { rateLimit } from '../../../../lib/ratelimit'
import { refuseCrossSite } from '../../_guard'

/*
  POST /api/account/export
  --------------------------------------------------------------------------
  Everything this account holds, as one JSON file.

  IT RUNS AS THE USER, NOT AS THE SERVICE ROLE. That is the important design
  decision here: `serverClient` sends the anon key with the caller's session,
  so every query is still filtered by RLS. If this route has a bug — a missing
  filter, a wrong org id, a typo — Postgres refuses to return another tenant's
  rows anyway. A service-role export would work exactly as well on the happy
  path and would turn any one of those mistakes into a cross-tenant data leak.

  WHAT IS NOT IN IT: the file BYTES. Documents are JSON and go in whole;
  images, PDFs and attachments are listed with their metadata and a note of
  where they are. Streaming gigabytes of binary through a serverless function
  to build a zip in memory is how an export endpoint becomes a denial of
  service against yourself, and the assets are already downloadable from the
  app. GDPR portability asks for the personal data in a structured, commonly
  used, machine-readable form — which this is.
  -------------------------------------------------------------------------- */

export const runtime = 'nodejs'
/* Never cached, never statically analysed into a build-time value. An export
   is per-user by definition and a cached one would be somebody else's. */
export const dynamic = 'force-dynamic'

/* PostgREST truncates at `db.max_rows` (1000 on hosted Supabase) WITHOUT
   returning an error. An account with 1200 documents therefore downloaded a
   file containing 1000 of them, stamped `format: 'datastudio-export-v1'` and
   carrying a note asserting "Documents are included in full". A false answer
   to a data-portability request, delivered with a confident label. */
const PAGE = 1000
async function pageAll(build) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < PAGE) return out
  }
}

export async function POST(request) {
  const cross = refuseCrossSite(request)
  if (cross) return cross

  const supabase = serverClient(await cookies())
  if (!supabase) return NextResponse.json({ error: 'Not configured.' }, { status: 503 })

  /* getUser(), not getSession(): the token is verified with Supabase rather
     than trusted because it is present. Same reasoning as middleware.js — this
     route hands over every document the caller owns. */
  const { data: auth } = await supabase.auth.getUser()
  const user = auth?.user
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  /* By account, after authentication — same reasoning as the delete route: an
     IP-keyed pre-auth limiter punishes everyone behind one address and can be
     aimed at a specific person through x-forwarded-for. */
  const gate = rateLimit(`export:${user.id}`, { limit: 3, windowMs: 60 * 60 * 1000 })
  if (!gate.ok) {
    return NextResponse.json(
      { error: 'Too many exports. Try again in a little while.' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
    )
  }

  try {
    const [{ data: profile, error: pErr }, memberships] = await Promise.all([
      supabase.from('profiles').select('id, email, display_name, prefs, created_at').eq('id', user.id).maybeSingle(),
      /* `.eq('user_id', user.id)` — this was missing. The RLS policy is
         `is_org_member(org_id)`, so a member may read EVERY membership row of
         their organisations; without the filter this array contained other
         people's roles and join dates, in a file labelled as the caller's own
         data, and `orgIds` picked up a duplicate per colleague which was then
         handed to five `.in()` filters. Nothing crossed a tenant boundary, so
         it was never a breach — it was simply not what the file claims to be.
         The delete route has the filter; the export was missed. */
      pageAll(() => supabase.from('org_members').select('org_id, role, created_at').eq('user_id', user.id)),
    ])
    if (pErr) throw new Error(pErr.message)

    const orgIds = [...new Set((memberships || []).map(m => m.org_id))]
    const scope = orgIds.length ? orgIds : ['-']

    const [orgs, subs, docs, assets, usage] = await Promise.all([
      pageAll(() => supabase.from('organizations').select('*').in('id', scope)),
      pageAll(() => supabase.from('subscriptions').select('*').in('org_id', scope)),
      pageAll(() => supabase.from('docs').select('*').in('org_id', scope)),
      pageAll(() => supabase.from('assets')
        .select('id, kind, doc_id, path, bytes, name, mime, width, height, created_at, deleted_at')
        .in('org_id', scope)),
      pageAll(() => supabase.from('usage').select('*').in('org_id', scope)),
    ])

    const payload = {
      exported_at: new Date().toISOString(),
      format: 'datastudio-export-v1',
      note:
        'Documents are included in full. Files (images, PDFs, attachments) are ' +
        'listed with their metadata but not their bytes — download those from the ' +
        'app, where they are already available.',
      account: { id: user.id, email: user.email, created_at: user.created_at },
      profile: profile || null,
      organizations: orgs,
      memberships: memberships || [],
      subscriptions: subs,
      usage: usage,
      documents: docs,
      files: assets,
    }

    /* Recorded, but deliberately without the payload. §14 of the checklist:
       minimise sensitive customer data in logs. That an export happened is an
       audit trail; a copy of the export is a second database with none of the
       first one's protections. */
    /* Through the ADMIN client, and only after the identity check above.

       This ran as the user, where the insert policy is `is_org_member(org_id)
       and auth.uid() = actor_id`. `is_org_member(null)` is false, so for an
       account with no memberships the row was silently refused — and the
       return value was not inspected, so an export happened with no audit
       trail and no signal that one was missing. `ip` and `user_agent` are
       server-observed facts and 0005 strips them from client-written rows
       anyway, which is the other reason this belongs on the admin path. */
    if (hasServiceRole()) {
      const { error: aErr } = await adminClient().from('audit_log').insert({
        org_id: orgIds[0] || null,
        actor_id: user.id,
        action: 'account.export',
        outcome: 'ok',
        detail: { documents: docs.length, files: assets.length },
        ip: (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null,
        user_agent: request.headers.get('user-agent')?.slice(0, 200) || null,
      })
      if (aErr) console.error('[export] audit row not written', aErr.message)
    }

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="datastudio-export.json"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    /* The message is not echoed back. An internal error string can name a
       table, a column or a driver version — §10 asks for error handling that
       does not expose internal infrastructure, and an export failing is not a
       moment that needs a stack trace on the client. */
    console.error('[export] failed', err)
    return NextResponse.json({ error: 'Could not build the export. Try again.' }, { status: 500 })
  }
}
