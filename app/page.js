'use client'

/*
  app/page.js — the wall
  --------------------------------------------------------------------------
  The previous landing page (811 lines of marketing, a feature tour and an FAQ)
  is preserved verbatim at `archive/landing-v1.jsx`. It is outside `app/`, so
  Next does not route it, and it is not deleted, because nothing in this repo
  is committed yet and a `git checkout` would not bring it back.

  IT ALSO HAD TO GO FOR A REASON BEYOND BEING OUTDATED. Its FAQ said, in so
  many words, "your files are never uploaded to a server." That stopped being
  true the moment sync shipped. A false privacy claim on the page that sells
  the product is a different category of problem from a stale screenshot — it
  is the kind of sentence that gets quoted back during a security review.

  WHAT THIS IS NOW
  A black wall that says nothing it cannot back up, with one discreet way in
  for the people who are meant to be here. No feature claims, no privacy
  claims, no roadmap — everything on this page is either true forever or
  absent.
  -------------------------------------------------------------------------- */

export default function Wall() {
  return (
    <main
      style={{
        minHeight: '100svh',
        /* Not var(--ds-base). This page is deliberately outside the theme: it
           is black in both light and dark mode, because a wall that changes
           colour with the visitor's OS preference reads as an app that has not
           loaded rather than as a decision. */
        background: '#000',
        color: '#e9e9ec',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        fontFamily: 'var(--ds-font-body)',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          aria-hidden
          style={{
            width: 30, height: 30, borderRadius: 8,
            background: 'var(--ds-accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--ds-font-mono)', fontSize: 16, fontWeight: 700,
            color: '#fff',
          }}
        >
          D
        </div>
        <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: -0.2 }}>DataStudio</span>
      </div>

      <p
        style={{
          margin: 0,
          fontFamily: 'var(--ds-font-mono)',
          fontSize: 13,
          letterSpacing: 2.4,
          textTransform: 'uppercase',
          color: '#6f6f78',
        }}
      >
        Soon
      </p>

      {/* The door. Low contrast on purpose — findable by someone who was told
          it is here, invisible to someone scrolling past. It is a real link
          rather than a hidden route because testers and investors should not
          need a briefing on secret URLs to get in, and because a "secret" path
          protects nothing: /app is gated at the edge by middleware.js and the
          database returns nothing without a session either way. */}
      <a
        href="/login"
        style={{
          marginTop: 10,
          fontSize: 13,
          color: '#5a5a63',
          textDecoration: 'none',
          padding: '8px 14px',
          borderRadius: 8,
          border: '1px solid #1c1c20',
          transition: 'color .15s ease, border-color .15s ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = '#c9c9d1'; e.currentTarget.style.borderColor = '#33333a' }}
        onMouseLeave={e => { e.currentTarget.style.color = '#5a5a63'; e.currentTarget.style.borderColor = '#1c1c20' }}
      >
        Sign in
      </a>
    </main>
  )
}
