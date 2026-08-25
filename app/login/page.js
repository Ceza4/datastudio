'use client'

import { useState } from 'react'
import { useTheme } from '../providers'
import { makeColors } from '../../lib/theme'
import { signIn, AUTH, isSupabaseConfigured } from '../../lib/auth'

export default function Login() {
  const { dark, setDark } = useTheme()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  /* The app's palette, not a hand-copy of it. accentDim here used to be
     '#2a2d6e' / '#E1F5EE' — two values that exist in no token file, so the
     sign-in page and the app it signs you into were subtly different
     products. */
  const t = makeColors(dark)

  const [notice, setNotice] = useState(null)

  /* This was a setTimeout that did nothing for 1500ms and then stopped. It
     looked exactly like signing in, which made it worse than an empty page —
     nobody reports a bug against a form that appears to work. */
  const handleLogin = async (e) => {
    e.preventDefault()
    if (loading) return
    setNotice(null)
    setLoading(true)
    const res = await signIn(email, password)
    setLoading(false)

    if (res.status === AUTH.OK) {
      /* A hard navigation, not a router push. The app reads its whole state
         on mount, and arriving with a session already established is simpler
         to reason about than teaching every consumer to react to one
         appearing underneath it. */
      window.location.href = '/app'
      return
    }
    setNotice({
      /* UNCONFIGURED is not a failure. There is no backend on this build, and
         the app works without one — so it reads as information, not as an
         error the user did something to cause. */
      tone: res.status === AUTH.UNCONFIGURED ? 'info' : 'error',
      message: res.message,
    })
  }

  return (
    <div style={{
      minHeight:'100vh', background:t.base,
      display:'flex', alignItems:'center', justifyContent:'center',
      fontFamily:'var(--ds-font-body)'
    }}>

      {/* TOP LEFT LOGO */}
      <div style={{position:'absolute', top:'20px', left:'24px', display:'flex', alignItems:'center', gap:'8px'}}>
        <a href="/" style={{display:'flex', alignItems:'center', gap:'8px', textDecoration:'none'}}>
          <div style={{width:'26px', height:'26px', borderRadius:'6px', background:t.accent, display:'flex', alignItems:'center', justifyContent:'center'}}>
            <svg viewBox="0 0 13 13" fill="none" width="13" height="13">
              <rect x="0" y="0" width="5.5" height="5.5" rx="1" fill="white"/>
              <rect x="7.5" y="0" width="5.5" height="5.5" rx="1" fill="white" opacity=".6"/>
              <rect x="0" y="7.5" width="5.5" height="5.5" rx="1" fill="white" opacity=".6"/>
              <rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1" fill="white" opacity=".3"/>
            </svg>
          </div>
          <span style={{fontFamily:'var(--ds-font-head)', fontWeight:700, fontSize:'15px', color:t.text}}>DataStudio</span>
        </a>
      </div>

      {/* THEME TOGGLE */}
      <button onClick={() => setDark(!dark)} style={{
        position:'absolute', top:'20px', right:'24px',
        width:'32px', height:'32px', borderRadius:'6px',
        background:'none', border:`1px solid ${t.border}`,
        display:'flex', alignItems:'center', justifyContent:'center',
        cursor:'pointer', color:t.text2
      }}>
        {dark ? (
          <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M8 3V1M8 15v-2M3 8H1M15 8h-2M4.2 4.2L2.8 2.8M13.2 13.2l-1.4-1.4M4.2 11.8l-1.4 1.4M13.2 2.8l-1.4 1.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2"/></svg>
        ) : (
          <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M13.5 8.5A5.5 5.5 0 016 2a6 6 0 100 12 5.5 5.5 0 007.5-5.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
        )}
      </button>

      {/* LOGIN CARD */}
      <div style={{
        width:'100%', maxWidth:'400px',
        background:t.surface, border:`1px solid ${t.border}`,
        borderRadius:'16px', padding:'40px',
      }}>
        <div style={{textAlign:'center', marginBottom:'32px'}}>
          <h1 style={{fontFamily:'var(--ds-font-head)', fontSize:'24px', fontWeight:700, color:t.text, marginBottom:'8px'}}>Welcome back</h1>
          <p style={{fontSize:'14px', color:t.text2}}>Sign in to your DataStudio account</p>
        </div>

        <form onSubmit={handleLogin}>
          {/* EMAIL */}
          <div style={{marginBottom:'16px'}}>
            <label style={{display:'block', fontSize:'12px', fontWeight:500, color:t.text2, marginBottom:'6px'}}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              style={{
                width:'100%', padding:'10px 14px',
                background:t.raised, border:`1px solid ${t.border}`,
                borderRadius:'8px', fontSize:'14px', color:t.text,
                outline:'none', fontFamily:'var(--ds-font-body)',
                boxSizing:'border-box'
              }}
            />
          </div>

          {notice && (
            <div role={notice.tone === 'error' ? 'alert' : 'status'} style={{
              marginBottom:'16px', padding:'10px 12px', borderRadius:'8px',
              fontSize:'12.5px', lineHeight:1.5,
              background: notice.tone === 'error' ? 'rgba(248,113,113,0.12)' : t.raised,
              border:`1px solid ${notice.tone === 'error' ? '#f87171' : t.border}`,
              color: notice.tone === 'error' ? '#f87171' : t.text2,
            }}>{notice.message}</div>
          )}

          {/* PASSWORD */}
          <div style={{marginBottom:'24px'}}>
            <div style={{display:'flex', justifyContent:'space-between', marginBottom:'6px'}}>
              <label style={{fontSize:'12px', fontWeight:500, color:t.text2}}>Password</label>
              <a href="#" style={{fontSize:'12px', color:t.accent, textDecoration:'none'}}>Forgot password?</a>
            </div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{
                width:'100%', padding:'10px 14px',
                background:t.raised, border:`1px solid ${t.border}`,
                borderRadius:'8px', fontSize:'14px', color:t.text,
                outline:'none', fontFamily:'var(--ds-font-body)',
                boxSizing:'border-box'
              }}
            />
          </div>

          {/* SUBMIT */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width:'100%', padding:'12px',
              background: loading ? t.raised : t.accent,
              color: loading ? t.text2 : 'white',
              border:'none', borderRadius:'8px',
              fontSize:'14px', fontWeight:500,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily:'var(--ds-font-body)',
              transition:'background .15s'
            }}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        {/* DIVIDER */}
        <div style={{display:'flex', alignItems:'center', gap:'12px', margin:'24px 0'}}>
          <div style={{flex:1, height:'1px', background:t.border}}></div>
          <span style={{fontSize:'12px', color:t.text3}}>or</span>
          <div style={{flex:1, height:'1px', background:t.border}}></div>
        </div>

        {/* GOOGLE — not wired. It is left visible and DISABLED rather than
            removed, because the OAuth provider is a Supabase dashboard
            setting rather than code: the day it is switched on, this button
            needs one call. A button that silently does nothing is the thing
            being fixed on this page, so it says so on hover. */}
        <button disabled title="Google sign-in is not enabled on this build yet" style={{
          opacity: 0.45, cursor: 'not-allowed',
          width:'100%', padding:'11px',
          background:'none', border:`1px solid ${t.border}`,
          borderRadius:'8px', fontSize:'14px', color:t.text,
          cursor:'pointer', fontFamily:'var(--ds-font-body)',
          display:'flex', alignItems:'center', justifyContent:'center', gap:'8px'
        }}>
          <svg viewBox="0 0 16 16" fill="none" width="16" height="16">
            <path d="M15.5 8.18c0-.57-.05-1.12-.14-1.64H8v3.1h4.19a3.58 3.58 0 01-1.55 2.35v1.95h2.5c1.47-1.35 2.36-3.34 2.36-5.76z" fill="#4285F4"/>
            <path d="M8 16c2.1 0 3.86-.7 5.14-1.88l-2.5-1.95c-.7.47-1.6.75-2.64.75-2.03 0-3.75-1.37-4.36-3.21H1.06v2.02A7.99 7.99 0 008 16z" fill="#34A853"/>
            <path d="M3.64 9.71A4.8 4.8 0 013.39 8c0-.59.1-1.17.25-1.71V4.27H1.06A7.99 7.99 0 000 8c0 1.29.31 2.51.86 3.59l2.78-1.88z" fill="#FBBC05"/>
            <path d="M8 3.18c1.14 0 2.17.39 2.98 1.16l2.23-2.23C11.86.79 10.1 0 8 0A7.99 7.99 0 001.06 4.27l2.58 2.02C4.25 4.55 5.97 3.18 8 3.18z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>

        {/* The point of the whole page, said out loud. An account is for
            SYNC; it is not the door. Somebody who lands here and does not
            want one should be able to leave in the right direction. */}
        <p style={{textAlign:'center', fontSize:'12px', color:t.text3, marginTop:'18px', lineHeight:1.6}}>
          {isSupabaseConfigured()
            ? 'You don’t need an account to use DataStudio. '
            : 'Accounts aren’t set up on this build. '}
          <a href="/app" style={{color:t.text2, textDecoration:'underline'}}>Open it without one</a>
        </p>

        {/* SIGNUP LINK */}
        <p style={{textAlign:'center', fontSize:'13px', color:t.text2, marginTop:'24px'}}>
          Don&#39;t have an account?{' '}
          <a href="/signup" style={{color:t.accent, textDecoration:'none', fontWeight:500}}>Sign up free</a>
        </p>
      </div>
    </div>
  )
}