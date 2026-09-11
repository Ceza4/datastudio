/*
  lib/account.js
  --------------------------------------------------------------------------
  The person, rather than the session. Display name and the two irreversible
  operations.

  THE AVATAR CODE THAT USED TO LIVE HERE IS GONE.

  It was about a hundred lines — a public bucket, cache-busting object names,
  initials and a hashed hue for the empty case — and every one of them existed
  to fill a circle in the top-right corner. That circle is now a labelled
  `Account` button next to Builder and Settings, so there is nothing left to
  fill, and code kept "in case we bring it back" is code that gets maintained,
  reviewed and shipped for a feature nobody uses.

  The DATABASE side is deliberately still there: `profiles.avatar_path`,
  `profiles.avatar_updated_at` and the `avatars` bucket, all created in
  migration 0004. Dropping them buys nothing (they are three empty columns and
  an empty bucket) and costs a migration against production plus Supabase's
  refusal to delete buckets through SQL. `my_account()` still returns
  `avatar: null`, which is honest. If a portrait is ever wanted again, the
  storage is waiting and this file is where the client half went — see git
  history, or SUPABASE_SETUP.md, which records the same decision.
  -------------------------------------------------------------------------- */

import { getSupabase } from './supabaseClient.js'
import { accountSnapshot, setAccount } from './limits.js'

/** Rename yourself. `display_name` is one of three columns a client may write. */
export async function setDisplayName(name, client) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { ok: false }
  const clean = String(name || '').trim().slice(0, 60)
  try {
    const { data: userData } = await c.auth.getUser()
    const uid = userData?.user?.id
    if (!uid) return { ok: false }
    const { error } = await c.from('profiles').update({ display_name: clean || null }).eq('id', uid)
    if (error) return { ok: false, message: error.message }
    setAccount({ ...accountSnapshot(), name: clean || null })
    return { ok: true }
  } catch (err) { return { ok: false, message: err?.message } }
}

/* ── the two irreversible ones ────────────────────────────────────────────

   Both go through server routes rather than being done from here, because
   both need authority this client does not have and must not have: deleting an
   auth user and revoking every refresh token are service-role operations. A
   browser that could do either would be a browser holding a key that bypasses
   every RLS policy in the database.

   The routes do their own authorization check first — see
   lib/supabase/server.js for why that is not optional there. */

export async function exportEverything() {
  const res = await fetch('/api/account/export', { method: 'POST' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    return { ok: false, message: body.error || `Export failed (${res.status}).` }
  }
  const blob = await res.blob()
  return { ok: true, blob }
}

/**
 * @param {string} confirmation  must equal the account's email address
 *
 * The typed confirmation is checked on the SERVER as well as here. A
 * confirmation dialog is a UX affordance, not a security control — the request
 * can be made without ever loading the dialog.
 */
export async function deleteAccount(confirmation) {
  const res = await fetch('/api/account/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: confirmation }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, message: body.error || `Could not delete the account (${res.status}).` }
  return { ok: true }
}
