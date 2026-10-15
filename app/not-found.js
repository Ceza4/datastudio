import Link from 'next/link'

/*
  app/not-found.js
  --------------------------------------------------------------------------
  Next's stock 404 was a bare "404 | This page could not be found." with no
  way back (audit DEF-016). Same words, plus the two doors people want.
  Server component, no theme hook: the root layout already paints the page.
  -------------------------------------------------------------------------- */

export const metadata = { title: 'Page not found' }

export default function NotFound() {
  return (
    <main style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 14, fontFamily: 'var(--ds-font-body)', color: 'var(--ds-text)', background: 'var(--ds-base)', padding: 24, textAlign: 'center',
    }}>
      <div style={{ fontSize: 13, color: 'var(--ds-text-3)', letterSpacing: 1, textTransform: 'uppercase' }}>404</div>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, fontFamily: 'var(--ds-font-head)' }}>This page could not be found.</h1>
      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <Link href="/app" className="ds-tbtn" style={{ textDecoration: "none" }}>Open DataStudio</Link>
        <Link href="/" className="ds-tbtn" style={{ textDecoration: "none" }}>Home</Link>
      </div>
    </main>
  )
}
