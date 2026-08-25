'use client'
import { createContext, useContext, useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react'
import { DEFAULT_PREFS, normalizePrefs, readThemeMirror, writeThemeMirror } from '../lib/prefs'
import { ToastProvider } from '../components/ui/Toast'

/*
  Theme and preferences provider.
  --------------------------------------------------------------------------
  Two things live here because they must both be settled before the app can
  paint honestly: which theme to use, and every other preference that changes
  how the canvas renders.

  WHY THE READ IS IN A LAYOUT EFFECT, NOT AN INITIALISER
  localStorage doesn't exist on the server, so a lazy useState initialiser
  would return `false` during SSR and the real value on the client — a
  hydration mismatch React will complain about and, on a mismatch, discard.
  Reading after mount and holding the page invisible for that one frame is the
  boring, correct version.

  The read runs in useLayoutEffect (aliased for SSR safety) rather than
  useEffect so the attribute is set before the browser paints, not after.
  With useEffect there's a real frame where the DOM says light and the user
  can see it.

  PREFS ARRIVE LATER
  Everything except theme is stored in the workspace payload, which comes out
  of IndexedDB asynchronously. app/page.js calls `hydratePrefs` once that
  resolves. Until then the defaults apply, which is correct — a brand new
  workspace has no prefs either.

  TOASTS SIT INSIDE THE THEME
  ToastProvider is mounted here rather than in a route layout for two reasons.
  It has to be INSIDE the provider that writes `data-theme`, or a toast raised
  in dark mode paints with the light tokens for one frame — the toast portals
  to document.body, so it inherits nothing from where it was raised and reads
  the same var(--ds-*) everything else does. And there is exactly one mount
  point, so a route added later cannot silently ship without one.
*/

const PrefsContext = createContext({
  dark: false,
  setDark: () => {},
  prefs: DEFAULT_PREFS,
  setPref: () => {},
  hydratePrefs: () => {},
})

// useLayoutEffect warns when it runs during SSR; useEffect is the no-op there.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export function ThemeProvider({ children }) {
  const [prefs, setPrefs] = useState(DEFAULT_PREFS)
  const [mounted, setMounted] = useState(false)

  /* Set once the workspace payload has been applied. Guards against a late
     IndexedDB read clobbering a change the user made in the meantime — on a
     cold start with a big workspace that gap is long enough to click. */
  const hydratedRef = useRef(false)

  useIsoLayoutEffect(() => {
    const mirrored = readThemeMirror()
    if (mirrored !== null) setPrefs(p => ({ ...p, dark: mirrored }))
    setMounted(true)
  }, [])

  // Single source of truth for every var(--ds-*) in globals.css.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', prefs.dark ? 'dark' : 'light')
  }, [prefs.dark])

  /* THE reduceMotion PREFERENCE NOW DOES SOMETHING.

     It was in DEFAULT_PREFS, it was normalised, it was migrated, and
     shouldReduceMotion() had zero importers — a setting that was stored and
     never read. Stamping it on <html> lets globals.css express the rule once,
     in CSS, where it can reach :hover states and pseudo-elements that a JS
     branch never could.

     Only stamped when the user has explicitly asked for it. Left off, the
     @media (prefers-reduced-motion) rules still apply, so the OS setting is
     honoured either way and an explicit choice can override it in both
     directions. */
  useEffect(() => {
    const root = document.documentElement
    if (prefs.reduceMotion === true) root.setAttribute('data-reduce-motion', 'true')
    else root.removeAttribute('data-reduce-motion')
  }, [prefs.reduceMotion])

  const setPref = useCallback((key, value) => {
    setPrefs(prev => {
      const next = normalizePrefs({ ...prev, [key]: typeof value === 'function' ? value(prev[key]) : value })
      if (key === 'dark') writeThemeMirror(next.dark)
      return next
    })
  }, [])

  const setDark = useCallback(val => setPref('dark', val), [setPref])

  /** Apply prefs loaded from the workspace. First call wins. */
  const hydratePrefs = useCallback(stored => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    if (!stored) return
    setPrefs(prev => {
      /* Theme is deliberately excluded. The localStorage mirror was read
         before paint and is what the user is currently looking at; letting a
         stale payload value overwrite it would flip the theme a second after
         load, which reads as a bug even when the value is "right". */
      const merged = normalizePrefs({ ...prev, ...stored, dark: prev.dark })
      return merged
    })
  }, [])

  const value = useMemo(
    () => ({ dark: prefs.dark, setDark, prefs, setPref, hydratePrefs }),
    [prefs, setDark, setPref, hydratePrefs]
  )

  return (
    <PrefsContext.Provider value={value}>
      {/* One frame of invisibility beats a light→dark flash on every load. */}
      {!mounted && <style>{`body { visibility: hidden; }`}</style>}
      <ToastProvider>{children}</ToastProvider>
    </PrefsContext.Provider>
  )
}

export function useTheme() {
  const { dark, setDark } = useContext(PrefsContext)
  return { dark, setDark }
}

export function usePrefs() {
  return useContext(PrefsContext)
}
