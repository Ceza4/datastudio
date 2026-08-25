/*
  lib/prefs.js
  --------------------------------------------------------------------------
  Every user preference, in one shape.

  Before this, "preferences" meant a single boolean in its own localStorage
  key (`datastudio-dark`). That was fine for one setting and became a problem
  at two: each new toggle would have invented its own key, its own read, its
  own write and its own default, and there'd be no single place to see what a
  workspace is actually configured to do.

  WHY PREFS TRAVEL WITH THE WORKSPACE, NOT THE BROWSER
  Prefs are written into the same saveState payload as notebooks and folders,
  so they follow the data when sync lands. Theme is the deliberate exception:
  it stays in localStorage as well, because it has to be readable before the
  IndexedDB load resolves or the first paint flashes light-then-dark.

  NORMALISE ON EVERY READ
  A stored prefs object is untrusted input. It can come from a newer build, a
  half-finished migration, or someone editing localStorage by hand. gridSize
  is used directly as an SVG pattern width — a 0 or a NaN in there is a
  division by zero in the renderer, not a cosmetic bug. Everything is clamped
  and unknown keys are dropped.
  -------------------------------------------------------------------------- */

export const PREFS_VERSION = 1

/** The theme mirror. Read before IndexedDB resolves, so it can't live only in the payload. */
export const THEME_KEY = 'datastudio-dark'

export const DEFAULT_PREFS = {
  dark: false,
  /* Show the alignment grid all the time, not only while Snap is on. These
     were one setting by accident: the grid was drawn as feedback for snapping,
     so turning snapping off also removed the thing people used to eyeball
     alignment by hand. */
  gridAlways: false,
  /* The sidebar hides completely rather than shrinking to a rail. Persisted,
     because a collapse that undoes itself on reload reads as a broken button
     rather than as a setting. */
  sidebarCollapsed: false,
  /* Whether Snap starts enabled on a fresh canvas. */
  snapDefault: false,
  gridSize: 32,
  /* null follows the OS (prefers-reduced-motion). true/false overrides it. */
  reduceMotion: null,
}

export const GRID_SIZES = [16, 24, 32, 48, 64]

const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback)

/**
 * Coerce anything into a valid prefs object. Never throws, never returns a
 * partial — callers can always read every key.
 */
export function normalizePrefs(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS }
  const size = Number(raw.gridSize)
  return {
    dark: bool(raw.dark, DEFAULT_PREFS.dark),
    gridAlways: bool(raw.gridAlways, DEFAULT_PREFS.gridAlways),
    sidebarCollapsed: bool(raw.sidebarCollapsed, DEFAULT_PREFS.sidebarCollapsed),
    snapDefault: bool(raw.snapDefault, DEFAULT_PREFS.snapDefault),
    gridSize: GRID_SIZES.includes(size) ? size : DEFAULT_PREFS.gridSize,
    reduceMotion: raw.reduceMotion === true || raw.reduceMotion === false ? raw.reduceMotion : null,
  }
}

/**
 * Read the theme mirror. Safe on the server and in a privacy-mode browser
 * where touching localStorage throws.
 */
export function readThemeMirror() {
  if (typeof window === 'undefined') return null
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === null ? null : v === 'true'
  } catch { return null }
}

export function writeThemeMirror(dark) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(THEME_KEY, String(dark)) } catch { /* private mode */ }
}

/**
 * Build the prefs for this session.
 *
 * `stored` is whatever came out of the saved payload — undefined for every
 * workspace that existed before this file did. In that case the old
 * standalone theme key is the only signal there is, and losing it would flip
 * a dark-mode user back to light on upgrade for no reason.
 */
export function migratePrefs(stored) {
  const base = normalizePrefs(stored)
  if (stored && typeof stored === 'object') return base
  const mirrored = readThemeMirror()
  return mirrored === null ? base : { ...base, dark: mirrored }
}

/** True when motion should be suppressed. Explicit setting wins over the OS. */
export function shouldReduceMotion(prefs) {
  if (prefs?.reduceMotion === true) return true
  if (prefs?.reduceMotion === false) return false
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
