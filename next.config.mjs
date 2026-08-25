/** @type {import('next').NextConfig} */

/* SECURITY HEADERS
   --------------------------------------------------------------------------
   This file used to be an empty object, which meant the app shipped with no
   CSP, no nosniff, no referrer policy and no frame-ancestors.

   That mattered more here than it does in most apps. DataStudio's defence
   against a stored XSS is that nothing dangerous ever reaches innerHTML — see
   lib/sanitize.js and the paste handler in TextBlockContent. That defence is
   good, and it is one bug deep. A CSP is the layer that decides whether such a
   bug is a nuisance or a full compromise of every notebook, image and PDF in
   the user's IndexedDB.

   ON 'unsafe-inline' IN script-src
   Next's App Router bootstraps hydration from an inline script. Removing
   unsafe-inline needs per-request nonces, which needs middleware and a dynamic
   route — a real change, worth making, and deliberately not bundled into an
   audit-fix pass. It is listed in DEFERRED.md. Everything else here is already
   as tight as the app can run.

   style-src keeps 'unsafe-inline' permanently: the entire codebase styles
   through inline style objects by design, and fonts.googleapis.com serves the
   two webfont stylesheets. */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  // blob: and data: are how every imported image and rendered PDF page is
  // displayed. Neither can fetch anything.
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  // Supabase is the only host the app talks to. Left broad enough to cover a
  // project subdomain without hardcoding the project ref into the build.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  // pdf.js runs its worker from /pdf.worker.min.mjs, same origin.
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join('; ')

const nextConfig = {
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: csp },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
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
