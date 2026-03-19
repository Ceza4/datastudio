'use client'
import { createContext, useContext, useState } from 'react'

const ThemeContext = createContext({ dark: false, setDark: () => {} })

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(false) // light mode default
  return (
    <ThemeContext.Provider value={{ dark, setDark }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}