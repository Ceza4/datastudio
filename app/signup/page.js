'use client'

import { useState } from 'react'
import { useTheme } from '../providers'

export default function Signup() {
  const { dark, setDark } = useTheme()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const t = {
    base:      dark ? '#1A1917' : '#F5F3EE',
    surface:   dark ? '#201F1C' : '#EDEAE3',
    raised:    dark ? '#262522' : '#E4E1D8',
    border:    dark ? '#2E2D29' : '#D5D1C7',
    text:      dark ? '#E8E6E1' : '#1A1917',
    text2:     dark ? '#9A9790' : '#6B6860',
    text3:     dark ? '#5A5955' : '#A09D97',
    accent:    dark ? '#5B5FE8' : '#1D9E75',
    accentDim: dark ? '#2a2d6e' : '#E1F5EE',
  }

  const handleSignup = (e) => {
    e.preventDefault()
    setLoading(true)
    setTimeout(() => setLoading(false), 1500)
  }

  const inputStyle = {
    width:'100%', padding:'10px 14px',
    background:t.raised, border:`1px solid ${t.border}`,
    borderRadius:'8px', fontSize:'14px', color:t.text,
    outline:'none', fontFamily:'var(--font-dm-sans)',
    boxSizing:'border-box'
  }

  return (
    <div style={{
      minHeight:'100vh', background:t.base,
      display:'flex', alignItems:'center', justifyContent:'center',
      fontFamily:'var(--font-dm-sans)'
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
          <span style={{fontFamily:'var(--font-syne)', fontWeight:700, fontSize:'15px', color:t.text}}>DataStudio</span>
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
          <h1 style={{fontFamily:'var(--font-syne)', fontSize:'24px', fontWeight:700, color:t.text, marginBottom:'8px'}}>Create your account</h1>
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

          {/* PASSWORD */}
          <div style={{marginBottom:'8px'}}>
            <label style={{display:'block', fontSize:'12px', fontWeight:500, color:t.text2, marginBottom:'6px'}}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              required
              style={inputStyle}
            />
          </div>

          {/* PASSWORD HINT */}
          <p style={{fontSize:'11px', color:t.text3, marginBottom:'24px'}}>
            At least 8 characters — you know the drill.
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
              fontFamily:'var(--font-dm-sans)',
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

        {/* GOOGLE */}
        <button style={{
          width:'100%', padding:'11px',
          background:'none', border:`1px solid ${t.border}`,
          borderRadius:'8px', fontSize:'14px', color:t.text,
          cursor:'pointer', fontFamily:'var(--font-dm-sans)',
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
        <p style={{textAlign:'center', fontSize:'11px', color:t.text3, marginTop:'20px', lineHeight:1.6}}>
          By signing up you agree to our{' '}
          <a href="#" style={{color:t.accent, textDecoration:'none'}}>Terms</a>
          {' '}and{' '}
          <a href="#" style={{color:t.accent, textDecoration:'none'}}>Privacy Policy</a>
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