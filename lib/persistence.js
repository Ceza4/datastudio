/*
  lib/persistence.js
  --------------------------------------------------------------------------
  localStorage persistence layer for DataStudio.

  WHAT GETS PERSISTED:
  - notebooks (notebook blocks, sheets, connections, content)
  - folders (sidebar folder structure)

  WHAT IS NOT PERSISTED:
  - files (raw imported xlsx/csv data — too large for localStorage's
    5–10MB quota; any data you want to keep should live in a notebook
    table block, which IS persisted)
  - All ephemeral UI state (dragging, modals, selections)

  v2: dropped canvases/colFormats/globalFormat/statCards. DataStudio is
  now notebook-only — the canvas grid, format bar, and stat cards were
  removed. Old v1 data is left alone in localStorage under its own key
  and simply never read again.

  SCHEMA VERSION:
  Bumped via STORAGE_KEY when the persisted shape changes. Old keys
  are simply ignored on load — they don't get migrated. If you change
  the canvas shape, bump from v1 to v2 to avoid loading stale data
  into a new shape.

  QUOTA HANDLING:
  Save is wrapped in try/catch. If localStorage is full or disabled
  (e.g. private browsing), we silently no-op. Better to lose the
  next save than to crash the app.
  -------------------------------------------------------------------------- */

const STORAGE_KEY = 'datastudio-state-v2'

/**
 * Save the persistable slice of app state to localStorage.
 * Should be called from a debounced effect, not on every keystroke.
 */
export function saveState(state) {
  if (typeof window === 'undefined') return
  try {
    const payload = {
      notebooks: state.notebooks || [],
      folders: state.folders || [],
      savedAt: Date.now(),
    }
    // Convert any Sets to arrays so JSON.stringify doesn't choke
    const json = JSON.stringify(payload, (key, value) => {
      if (value instanceof Set) return Array.from(value)
      return value
    })
    window.localStorage.setItem(STORAGE_KEY, json)
  } catch (err) {
    // Quota exceeded, private mode, etc. — silently fail.
    // Don't crash the app over a persistence problem.
    console.warn('[DataStudio] Could not save state:', err.message)
  }
}

/**
 * Load the persisted state from localStorage.
 * Returns null if nothing is persisted or if the data is corrupt.
 */
export function loadState() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed
  } catch (err) {
    console.warn('[DataStudio] Could not load saved state:', err.message)
    return null
  }
}

/**
 * Clear all persisted state. Useful for a "reset workspace" button
 * or when the user explicitly wants to start over.
 */
export function clearState() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch (err) {
    // ignore
  }
}

/**
 * Debounce helper. Used to wrap saveState so it only fires after
 * the user has stopped making changes for a moment.
 */
export function debounce(fn, ms = 500) {
  let timer = null
  return function (...args) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}
