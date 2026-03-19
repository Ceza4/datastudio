'use client'
import { useEffect } from 'react'
import { useTheme } from '../providers'

export default function AppLayout({ children }) {
  const { dark } = useTheme()

  const surface  = dark ? '#201F1C' : '#EDEAE3'
  const border   = dark ? '#2E2D29' : '#D5D1C7'
  const text     = dark ? '#E8E6E1' : '#1A1917'
  const text2    = dark ? '#9A9790' : '#6B6860'
  const text3    = dark ? '#5A5955' : '#A09D97'
  const accent   = dark ? '#5B5FE8' : '#1D9E75'
  const raised   = dark ? '#262522' : '#E4E1D8'

  // Sync body bg with theme so no dark bleed-through in light mode
  useEffect(() => {
    document.body.style.background = dark ? '#1A1917' : '#F5F3EE'
    document.body.style.color      = dark ? '#E8E6E1' : '#1A1917'
  }, [dark])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: "'DM Sans', sans-serif", overflow: 'hidden' }}>

      {/* Top Navbar */}
      <div style={{
        height: 48,
        background: surface,
        borderBottom: `1px solid ${border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        flexShrink: 0,
        zIndex: 10,
      }}>
        {/* Left — Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontFamily: "'Syne', sans-serif",
            fontWeight: 800,
            fontSize: 17,
            color: accent,
            letterSpacing: '-0.3px',
          }}>
            DataStudio
          </span>
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 1,
            textTransform: 'uppercase',
            color: text3,
            background: raised,
            border: `1px solid ${border}`,
            borderRadius: 4,
            padding: '2px 6px',
          }}>
            Beta
          </span>
        </div>

        {/* Right — User area */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: text2 }}>Free plan</span>
          <div style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 700,
            color: '#fff',
            cursor: 'pointer',
            letterSpacing: 0.5,
          }}>
            M
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}