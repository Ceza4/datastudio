'use client'

import { useEffect, useState } from 'react'
import { useTheme } from '../providers'
import { makeColors } from '../../lib/theme'
import { updatePassword, getSession, MIN_PASSWORD, AUTH } from '../../lib/auth'

/*
  app/reset/page.js
  --------------------------------------------------------------------------
  Where the reset link lands.

  HOW THE LINK BECOMES A SESSION: Supabase puts a recovery token in the URL and
  supabase-js exchanges it during client construction (detectSessionInUrl).
  That means this page has a real, short-lived session by the time it renders —
  so the check below is "is there a session?" rather than "is there a token in
  the URL?". The link is single-use and expiring on Supabase's side; nothing
  here has to enforce that, and nothing here should try.

  WHY IT REFUSES TO SHOW THE FORM WITHOUT ONE
  An expired or already-used link would otherwise present a password field that
  looks like it works and then fails on submit, which reads as "the reset is
  broken" rather than "this link is spent". Same reasoning as the login form
  that used to be a setTimeout.
  -------------------------------------------------------------------------- */

export default function Reset() {
  const { dark } = useTheme()
  const t = makeColors(dark)
  const [ready, setReady] = useState(null)   // null = checking
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let live = true
    getSession().then(r => { if (live) setReady(Boolean(r.session)) })
    return () => { live = false }
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    if (loading) return
    setNotice(null)
    if (pw !== pw2) { setNotice('Those two passwords are different.'); return }
    setLoading(true)
    const res = await updatePassword(pw)
    setLoading(false)
    if (res.status === AUTH.OK) { setDone(true); return }
    setNotice(res.message)
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
        <h1 style={{ margin: '0 0 14px', fontSize: 20, fontWeight: 600, color: t.text }}>
          {done ? 'Password changed' : 'Choose a new password'}
        </h1>

        {done ? (
          <>
            <p style={{ fontSize: 13, color: t.text2, lineHeight: 1.6, margin: '0 0 20px' }}>
              You&apos;re signed in on this device. Other devices were signed out.
            </p>
            <a href="/app" style={{
              display: 'block', textAlign: 'center', padding: '11px 0', borderRadius: 8,
              background: t.accent, color: '#fff', fontSize: 13, textDecoration: 'none', fontWeight: 500,
            }}>Open DataStudio</a>
          </>
        ) : ready === false ? (
          <>
            <p style={{ fontSize: 13, color: t.text2, lineHeight: 1.6, margin: '0 0 20px' }}>
              This link has expired or has already been used. Reset links work once
              and last an hour.
            </p>
            <a href="/forgot" style={{
              display: 'block', textAlign: 'center', padding: '11px 0', borderRadius: 8,
              border: `1px solid ${t.border}`, color: t.text2, fontSize: 13, textDecoration: 'none',
            }}>Send a new one</a>
          </>
        ) : ready === null ? (
          <p style={{ fontSize: 13, color: t.text3 }}>Checking the link…</p>
        ) : (
          <form onSubmit={submit}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: t.text2, marginBottom: 6 }}>
              New password
            </label>
            <input type="password" value={pw} required autoFocus autoComplete="new-password"
              onChange={e => setPw(e.target.value)} placeholder="••••••••" style={field} />

            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: t.text2, margin: '14px 0 6px' }}>
              Again
            </label>
            <input type="password" value={pw2} required autoComplete="new-password"
              onChange={e => setPw2(e.target.value)} placeholder="••••••••" style={field} />

            <p style={{ fontSize: 12, color: t.text3, marginTop: 8 }}>
              At least {MIN_PASSWORD} characters.
            </p>

            {notice && (
              <div role="alert" style={{
                marginTop: 14, padding: '10px 12px', borderRadius: 8, fontSize: 13, lineHeight: 1.5,
                background: 'rgba(248,113,113,0.12)', border: '1px solid #f87171', color: '#f87171',
              }}>{notice}</div>
            )}

            <button type="submit" disabled={loading} style={{
              width: '100%', marginTop: 20, padding: 12,
              background: loading ? t.raised : t.accent, color: loading ? t.text2 : '#fff',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'var(--ds-font-body)',
            }}>{loading ? 'Saving…' : 'Change password'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
