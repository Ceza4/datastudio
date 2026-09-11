/*
  lib/samesite.js
  --------------------------------------------------------------------------
  DID THIS REQUEST COME FROM OUR OWN PAGE?

  /api/account/delete had no CSRF protection of any kind: no token, no Origin
  check, no Sec-Fetch-Site check, no Content-Type enforcement, no custom
  header. Its entire authentication was "a valid session cookie was attached",
  and a browser attaches that cookie to a cross-site form POST.

  The only thing in the way was `SameSite=Lax`, which is weaker than it reads:

    · SameSite is SITE-scoped, not origin-scoped. A docs site, a status page,
      a marketing subdomain — anything under the same registrable domain — is
      "same-site", and its POSTs carry the cookie. One compromised or
      user-content-hosting subdomain is enough.

    · `await request.json()` ignores Content-Type, so no CORS preflight is
      needed. A plain HTML form with enctype="text/plain" serialises to valid
      JSON:

        <form method=POST action="https://app.example/api/account/delete"
              enctype="text/plain">
          <input name='{"confirm":"victim@example.com","x":"' value='"}'>
        </form>

      which parses as {"confirm":"victim@example.com","x":"="}. The attacker
      needs only the victim's email address — the one thing they are certain to
      know, since it is what they are attacking.

  Three checks, each independently sufficient:

    1. Sec-Fetch-Site must be same-origin. Sent by every current browser,
       unsettable by script, and it distinguishes same-ORIGIN from same-site —
       exactly the distinction SameSite=Lax fails to make.
    2. Origin, when present, must match Host.
    3. Content-Type must be JSON — the header a form cannot set without
       triggering a preflight the browser will fail.

  A request with NEITHER Sec-Fetch-Site NOR Origin is refused, deliberately:
  those are the two headers a cross-site form omits, and no first-party fetch
  from this app omits both. It costs a curl user one explicit header and costs
  an attacker the whole technique.

  Pure and framework-free so it can be tested without a server — see
  tests/guard.test.mjs. app/api/_guard.js is the four-line Next binding.
  -------------------------------------------------------------------------- */

/**
 * @param {{headers: {get(name: string): string|null}}} request
 * @returns {string|null}  why it was refused, or null if it is trustworthy
 */
export function crossSiteReason(request) {
  const h = n => request?.headers?.get?.(n) ?? null
  const site = h('sec-fetch-site')
  const origin = h('origin')
  const host = h('host')

  /* `same-origin` is the only value a first-party call produces. `none` means
     a direct navigation, which cannot be a POST from another page. */
  if (site && site !== 'same-origin') return 'sec-fetch-site'

  if (origin) {
    let originHost = null
    try { originHost = new URL(origin).host } catch { return 'origin-unparseable' }
    if (!host || originHost !== host) return 'origin-mismatch'
  }

  if (!site && !origin) return 'no-provenance'

  const type = (h('content-type') || '').split(';')[0].trim().toLowerCase()
  if (type && type !== 'application/json') return 'content-type'

  return null
}

/** Convenience for readers; the routes use crossSiteReason via _guard.js. */
export const isSameOrigin = request => crossSiteReason(request) === null
