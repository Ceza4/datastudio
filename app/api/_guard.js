/*
  app/api/_guard.js
  --------------------------------------------------------------------------
  The Next binding for lib/samesite.js, which is where the reasoning lives.

  Split so the decision is testable without a server: the rule is pure header
  arithmetic and deserves a test that runs in milliseconds, not one that needs
  a running Next instance to tell you whether a cross-site form POST is
  refused.
  -------------------------------------------------------------------------- */

import { NextResponse } from 'next/server'
import { crossSiteReason } from '../../lib/samesite'

/**
 * @param {Request} request
 * @returns {NextResponse|null}  a 403 to return immediately, or null to proceed
 */
export function refuseCrossSite(request) {
  const reason = crossSiteReason(request)
  if (!reason) return null
  /* The reason is logged, not returned. Telling a caller WHICH check they
     failed is a free tutorial in passing it. */
  console.warn('[guard] refused a request:', reason)
  return NextResponse.json(
    { error: 'This request did not come from the application.' },
    { status: 403 },
  )
}

/**
 * Two-factor, enforced where the data is handed over.
 *
 * proxy.js sends an unfinished (aal1) session back to /login, but only for
 * /app. The API routes asked getUser() and nothing more, so somebody with the
 * password alone could take an aal1 token straight from Supabase and call
 * /api/account/export or /api/account/delete with curl, never meeting the
 * code prompt. Every route that acts as the user calls this after getUser().
 * Fails closed: no answer about the level is treated as unfinished.
 *
 * @returns {Promise<NextResponse|null>}  a 401 to return, or null to proceed
 */
export async function refuseUnfinishedSignIn(supabase) {
  let unfinished = true
  try {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    unfinished = !data || (data.nextLevel === 'aal2' && data.currentLevel !== 'aal2')
  } catch { /* unfinished */ }
  if (!unfinished) return null
  return NextResponse.json({ error: 'Finish two-factor sign-in first.' }, { status: 401 })
}
