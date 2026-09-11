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
