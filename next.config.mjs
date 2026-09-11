/** @type {import('next').NextConfig} */

/* SECURITY HEADERS
   --------------------------------------------------------------------------
   THE CSP IS NOT HERE ANY MORE. It moved to middleware.js, and that is not a
   reorganisation — it is the only way to get a per-request nonce.

   The version that lived in this file had to keep 'unsafe-inline' in
   script-src, because Next bootstraps hydration from an inline script and a
   static header cannot carry a value that changes per request. A CSP with
   'unsafe-inline' in script-src does not stop the attack a CSP exists to stop:
   an injected <script> runs. The note here used to say so and point at
   DEFERRED.md; middleware.js now closes it.

   What stays in this file is everything that is the SAME on every request.
   Splitting them this way means each header lives in exactly one place — a
   static header set here and a dynamic one set in middleware would silently
   race, and the winner would depend on the route.
   -------------------------------------------------------------------------- */

const nextConfig = {
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        /* HSTS. Deliberately without `preload`: preloading is submitted to a
           browser-vendor list and is effectively irreversible for months, so it
           belongs after the production domain is settled and every subdomain is
           known to serve TLS — not before. One year, subdomains included. */
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Frame-Options', value: 'DENY' },
        /* No feature this app has needs any of these, and a page that never
           asks is a page that cannot be tricked into asking. */
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      ],
    }]
  },
}

export default nextConfig
