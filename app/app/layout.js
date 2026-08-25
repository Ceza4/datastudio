'use client'
import { useEffect } from 'react'
import { useTheme } from '../providers'
import { makeColors } from '../../lib/theme'

export default function AppLayout({ children }) {
  const { dark } = useTheme()

  /* One palette, from lib/theme.js. This file used to rebuild seven of these
     from hex literals by hand — one of six copies across the app, three of
     which had drifted to values that appear nowhere in globals.css. */
  const c = makeColors(dark)

  // Sync body bg with theme so no dark bleed-through in light mode
  useEffect(() => {
    document.body.style.background = c.base
    document.body.style.color      = c.text
  }, [c])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'var(--ds-font-body)', overflow: 'hidden' }}>
      {children}
    </div>
  )
}