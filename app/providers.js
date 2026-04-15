'use client'
import { createContext, useContext, useState, useEffect } from 'react'

const ThemeContext = createContext({ dark: false, setDark: () => {} })

export function ThemeProvider({ children }) {
  const [dark, setDarkRaw] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('datastudio-dark')
      if (saved === 'true') setDarkRaw(true)
    } catch (_) {}
    setMounted(true)
  }, [])

  function setDark(val) {
    const next = typeof val === 'function' ? val(dark) : val
    setDarkRaw(next)
    try { localStorage.setItem('datastudio-dark', String(next)) } catch (_) {}
  }

  // Hide everything until we know the theme — prevents light→dark flash
  return (
    <ThemeContext.Provider value={{ dark, setDark }}>
      {!mounted && (
        <style>{`body { visibility: hidden; }`}</style>
      )}
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}