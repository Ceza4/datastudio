'use client'

import { useState } from 'react'
import { useTheme } from '../providers'
import { makeColors } from '../../lib/theme'
import { signUp, AUTH, MIN_PASSWORD, isSupabaseConfigured } from '../../lib/auth'

export default function Signup() {
  const { dark, setDark } = useTheme()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  /* The app's palette. accentDim was '#2a2d6e' / '#E1F5EE' here — values that
     exist in no token file — so sign-up rendered a slightly different product
     than the app it signs you into. */
  const t = makeColors(dark)

  const [notice, setNotice] = useState(null)
  const [done, setDone] = useState(null)

  /* Was a setTimeout that did nothing for 1500ms and then stopped — a form
     that convincingly pretends to create an account is worse than one that
     visibly does not, because nobody files a bug against it. */
  const handleSignup = async (e) => {
    e.preventDefault()
    if (loading) return
    setNotice(null)
    setLoading(true)
    const res = await signUp(email, password)
    setLoading(false)

    if (res.status === AUTH.OK) { window.location.href = '/app'; return }
    /* Email confirmation ON: the account EXISTS but there is no session yet.
       Sending someone to /app here shows a signed-in screen they are not
       signed in to; showing an error hides that it worked. It gets its own
       screen. */
    if (res.status === AUTH.CONFIRM_EMAIL) { setDone(res.message); return }
    setNotice({
      tone: res.status === AUTH.UNCONFIGURED ? 'info' : 'error',
      message: res.message,
      field: res.field || null,
    })
  }

  const inputStyle = {
    width:'100%', padding:'10px 14px',
    background:t.raised, border:`1px solid ${t.border}`,
    borderRadius:'8px', fontSize:'14px', color:t.text,
    outline:'none', fontFamily:'var(--ds-font-body)',
    boxSizing:'border-box'
  }

  /* The confirmation screen. A separate return rather than a banner over the
     form, because the form is now finished and leaving it there invites
     someone to submit it again and meet "user already registered" — an error
     caused entirely by the interface not having moved on. */
  if (done) {
    return (
      <div style={{minHeight:'100vh', background:t.base, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--ds-font-body)', padding:'24px'}}>
        <div style={{maxWidth:'380px', textAlign:'center'}}>
          <div style={{width:'44px', height:'44px', borderRadius:'50%', background:t.accentDim, color:t.accent, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', fontSize:'20px'}}>&#9993;</div>
          <h1 style={{fontFamily:'var(--ds-font-head)', fontSize:'19px', fontWeight:700, color:t.text, marginBottom:'8px'}}>Check your email</h1>
          <p style={{fontSize:'13px', color:t.text2, lineHeight:1.6, marginBottom:'20px'}}>{done}</p>
          <p style={{fontSize:'12px', color:t.text2, lineHeight:1.6}}>
            You don&#39;t have to wait for it —{' '}
            <a href="/app" style={{color:t.accent, textDecoration:'none', fontWeight:500}}>start working now</a>
            {' '}and your account will pick it up when you sign in.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      minHeight:'100vh', background:t.base,
      display:'flex', alignItems:'center', justifyContent:'center',
      fontFamily:'var(--ds-font-body)'
    }}>

      {/* LOGO */}
      <div style={{position:'absolute', top:'20px', left:'24px'}}>
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

      {/* CARD */}
      <div style={{
        width:'100%', maxWidth:'400px',
        background:t.surface, border:`1px solid ${t.border}`,
        borderRadius:'16px', padding:'40px',
      }}>
        <div style={{textAlign:'center', marginBottom:'32px'}}>
          <h1 style={{fontFamily:'var(--ds-font-head)', fontSize:'24px', fontWeight:700, color:t.text, marginBottom:'8px'}}>Create your account</h1>
          <p style={{fontSize:'14px', color:t.text2}}>Start for free — no credit card required</p>
        </div>

        <form onSubmit={handleSignup}>
          {/* NAME */}
          <div style={{marginBottom:'16px'}}>
            <label style={{display:'block', fontSize:'12px', fontWeight:500, color:t.text2, marginBottom:'6px'}}>Full name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Jane Smith"
              required
              style={inputStyle}
            />
          </div>

          {/* EMAIL */}
          <div style={{marginBottom:'16px'}}>
            <label style={{display:'block', fontSize:'12px', fontWeight:500, color:t.text2, marginBottom:'6px'}}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              style={inputStyle}
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
          <div style={{marginBottom:'8px'}}>
            <label style={{display:'block', fontSize:'12px', fontWeight:500, color:t.text2, marginBottom:'6px'}}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={`Min. ${MIN_PASSWORD} characters`}
              required
              style={inputStyle}
            />
          </div>

          {/* PASSWORD HINT */}
          <p style={{fontSize:'11px', color:t.text3, marginBottom:'24px'}}>
            At least {MIN_PASSWORD} characters — you know the drill.
          </p>

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
            {loading ? 'Creating account...' : 'Create free account'}
          </button>
        </form>

        {/* DIVIDER */}
        <div style={{display:'flex', alignItems:'center', gap:'12px', margin:'24px 0'}}>
          <div style={{flex:1, height:'1px', background:t.border}}></div>
          <span style={{fontSize:'12px', color:t.text3}}>or</span>
          <div style={{flex:1, height:'1px', background:t.border}}></div>
        </div>

        {/* GOOGLE — not wired. Left visible and DISABLED rather than removed:
            the provider is a Supabase dashboard switch, not code, so the day
            it is turned on this needs one call. */}
        <button disabled title="Google sign-up is not enabled on this build yet" style={{
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

        {/* TERMS */}
        <p style={{textAlign:'center', fontSize:'11px', color:t.text2, marginTop:'20px', lineHeight:1.6}}>
          By signing up you agree to our{' '}
          <a href="#" style={{color:t.accent, textDecoration:'none'}}>Terms</a>
          {' '}and{' '}
          <a href="#" style={{color:t.accent, textDecoration:'none'}}>Privacy Policy</a>
        </p>

        <p style={{textAlign:'center', fontSize:'12px', color:t.text3, marginTop:'18px', lineHeight:1.6}}>
          {isSupabaseConfigured()
            ? 'An account is only for syncing across devices. '
            : 'Accounts aren’t set up on this build. '}
          <a href="/app" style={{color:t.text2, textDecoration:'underline'}}>Use DataStudio without one</a>
        </p>

        {/* LOGIN LINK */}
        <p style={{textAlign:'center', fontSize:'13px', color:t.text2, marginTop:'16px'}}>
          Already have an account?{' '}
          <a href="/login" style={{color:t.accent, textDecoration:'none', fontWeight:500}}>Sign in</a>
        </p>
      </div>
    </div>
  )
}