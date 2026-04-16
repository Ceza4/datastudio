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
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}