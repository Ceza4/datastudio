'use client'

import { createContext, useContext, useState } from 'react'

const ThemeContext = createContext()

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(true)
  return (
    <ThemeContext.Provider value={{ dark, setDark }}>
      <div style={{
        background: dark ? '#1A1917' : '#F5F3EE',
        color: dark ? '#E8E6E1' : '#1A1917',
        minHeight: '100vh',
        transition: 'background .2s, color .2s'
      }}>
        {children}
      </div>
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}