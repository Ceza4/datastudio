/*
  components/ui/island.js
  --------------------------------------------------------------------------
  The one shape every floating island in the top row shares.

  There were two shapes, and they sat side by side. The sidebar handle, the
  title island and the centre toolbar were 46px tall with a 12px radius.
  Builder, People, Settings and Account were sized by their padding (8px 14px),
  so they came out about 35px tall with a 10px radius. The glass alpha
  (dd / ee) and the light-theme shadow (0.08 / 0.10) also drifted between
  copies. Each copy was hand-typed with "same as the one beside it" in a
  comment, which is how it drifted.

  Only the CHROME lives here: height, radius, glass, border and shadow.
  Padding, gap and colour stay at each call site, because those really do
  differ (a row of tool buttons is not a labelled button).
  -------------------------------------------------------------------------- */

export const ISLAND_H = 46
export const ISLAND_RADIUS = 12

/**
 * @param {{ surface: string, border: string, dark: boolean }} c
 * @returns {object} inline-style fragment; spread it first, then override.
 */
export function islandChrome({ surface, border, dark }) {
  return {
    height: ISLAND_H,
    boxSizing: 'border-box',
    borderRadius: ISLAND_RADIUS,
    background: `${surface}ee`,
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: `1px solid ${border}`,
    boxShadow: `0 4px 24px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.08)'}`,
  }
}
