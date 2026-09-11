/*
  lib/ratelimit.js
  --------------------------------------------------------------------------
  A fixed-window counter, in memory, per server instance.

  BE HONEST ABOUT WHAT THIS IS. It is not a distributed rate limiter. On
  serverless it is per-instance and resets on every cold start, so a determined
  attacker who can cause instances to scale out gets one bucket per instance.
  It stops the things it is aimed at — a script hammering one endpoint, a
  runaway client retry loop, a scraper — and it does not stop a distributed
  attack.

  WHY IT IS STILL WORTH HAVING, AND WHY IT IS NOT THE MAIN DEFENCE
  The endpoints that matter most for abuse are the AUTH endpoints, and those
  are Supabase's, rate-limited on their side where the state is shared. What
  this covers is the handful of routes in this app — export and delete — which
  are expensive rather than sensitive, and where a per-instance bucket is
  proportionate.

  When there is real traffic, replace the Map with Upstash or Redis and this
  file's interface stays the same. That is the point of the interface.
  -------------------------------------------------------------------------- */

const buckets = new Map()

/* Bounded, so a stream of unique keys cannot grow the map without limit —
   which would turn a rate limiter into a memory-exhaustion vector, an
   embarrassing way for a defence to become the attack. */
const MAX_KEYS = 10_000

export function rateLimit(key, { limit = 10, windowMs = 60_000, now = Date.now() } = {}) {
  if (!key) return { ok: true }

  if (buckets.size > MAX_KEYS) {
    /* Cheapest correct eviction: drop everything expired, and if that is not
       enough, drop the map. Losing counters fails OPEN, which is the right
       direction for a convenience limiter guarding non-destructive routes —
       failing closed here would lock legitimate users out because the server
       got busy. */
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
    if (buckets.size > MAX_KEYS) buckets.clear()
  }

  const found = buckets.get(key)
  if (!found || found.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, remaining: limit - 1, resetAt: now + windowMs }
  }
  found.count += 1
  if (found.count > limit) {
    return { ok: false, retryAfter: Math.ceil((found.resetAt - now) / 1000), resetAt: found.resetAt }
  }
  return { ok: true, remaining: limit - found.count, resetAt: found.resetAt }
}

/**
 * The caller's address, as far as it can be known behind a proxy.
 *
 * x-forwarded-for is CLIENT-SUPPLIED unless something in front of you
 * overwrites it, and Vercel does. On a deployment where it does not, this is
 * trivially spoofed and the limiter becomes decorative — which is a reason to
 * know your hosting, not a reason to skip the header. The FIRST entry is taken
 * because proxies append, so the leftmost is the original client.
 */
export function callerKey(request, prefix = '') {
  const fwd = request.headers.get('x-forwarded-for') || ''
  const ip = fwd.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown'
  return `${prefix}:${ip}`
}

/** Test seam. */
export function _resetLimiter() { buckets.clear() }
