'use client'

import { useState } from 'react'
import { useTheme } from '../providers'
import { makeColors } from '../../lib/theme'
import { requestPasswordReset, AUTH } from '../../lib/auth'

/*
  app/forgot/page.js
  --------------------------------------------------------------------------
  Ask for a reset link.

  THE WHOLE POINT OF THIS PAGE IS THAT IT ALWAYS SAYS THE SAME THING.

  A form that answers "no account with that email" is an enumeration oracle,
  and password reset is the one an attacker reaches for first: it takes an
  address and nothing else. So the success screen renders whether or not the
  address exists, whether or not Supabase is configured, and whether or not the
  request even reached the network. The person who owns the inbox finds out
  from the inbox.

  That also means this page cannot tell the user "we couldn't send it", which
  is a genuine cost. It is the right trade for a tool holding unpublished
  research, where "does this person have an account" is itself worth
  protecting.
  -------------------------------------------------------------------------- */

export default function Forgot() {
  const { dark } = useTheme()
  const t = makeColors(dark)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    const res = await requestPasswordReset(email)
    setLoading(false)
    if (res.status === AUTH.INVALID) { setSent({ error: res.message }); return }
    setSent({ message: res.message })
  }

  const field = {
    width: '100%', padding: '10px 14px', background: t.raised,
    border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 14, color: t.text,
    outline: 'none', fontFamily: 'var(--ds-font-body)', boxSizing: 'border-box',
  }

  return (
    <div style={{
      minHeight: '100vh', background: t.base, display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 24,
      fontFamily: 'var(--ds-font-body)',
    }}>
      <div style={{
        width: '100%', maxWidth: 380, background: t.surface,
        border: `1px solid ${t.border}`, borderRadius: 12, padding: 32,
      }}>
        <h1 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 600, color: t.text }}>
          Reset your password
        </h1>

        {sent && !sent.error ? (
          <>
            <p style={{ fontSize: 13, color: t.text2, lineHeight: 1.6, margin: '0 0 20px' }}>
              {sent.message}
            </p>
            <a href="/login" style={{
              display: 'block', textAlign: 'center', padding: '11px 0',
              borderRadius: 8, border: `1px solid ${t.border}`,
              color: t.text2, fontSize: 13, textDecoration: 'none',
            }}>Back to sign in</a>
          </>
        ) : (
          <form onSubmit={submit}>
            <p style={{ fontSize: 13, color: t.text2, lineHeight: 1.6, margin: '0 0 20px' }}>
              We&apos;ll email you a link. It works once and expires in an hour.
            </p>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: t.text2, marginBottom: 6 }}>
              Email
            </label>
            <input type="email" value={email} required autoFocus
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com" style={field} />

            {sent?.error && (
              <div role="alert" style={{
                marginTop: 14, padding: '10px 12px', borderRadius: 8, fontSize: 13,
                background: 'rgba(248,113,113,0.12)', border: '1px solid #f87171', color: '#f87171',
              }}>{sent.error}</div>
            )}

            <button type="submit" disabled={loading} style={{
              width: '100%', marginTop: 20, padding: 12,
              background: loading ? t.raised : t.accent, color: loading ? t.text2 : '#fff',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'var(--ds-font-body)',
            }}>{loading ? 'Sending…' : 'Send reset link'}</button>

            <a href="/login" style={{
              display: 'block', textAlign: 'center', marginTop: 16,
              fontSize: 13, color: t.text3, textDecoration: 'none',
            }}>Back to sign in</a>
          </form>
        )}
      </div>
    </div>
  )
}
