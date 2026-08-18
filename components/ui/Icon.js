'use client'

/*
  components/ui/Icon.js
  --------------------------------------------------------------------------
  The icon set. One import for every call site.

  Geometry lives in ./icon-paths.js, which is GENERATED from the .svg files:

      node scripts/build-icons.mjs ../icons

  Don't hand-edit that file — the next rebuild overwrites it. Edit the SVGs
  and regenerate. The build script validates every file first (viewBox,
  hardcoded colour, transforms, groups, gradients, <text>) and refuses to
  write if any of them would break at 14px or under a theme switch.

  SYSTEM
  · 64×64 viewBox, 56×56 live area
  · stroke 4.66 (= 1.75 at the 24px runtime size), round caps and joins
  · fill: none, except dot marks (handle-grip, handle-port) which are solid
  · currentColor throughout — colour is inherited, never passed

  STROKE OVERRIDES
  Read from the SVGs themselves rather than hardcoded here, and stored as
  MULTIPLIERS of the base weight. That matters: pass a custom `strokeWidth`
  and the relationships survive, so the three brushes stay a family instead of
  collapsing to one weight.

  ACCESSIBILITY
  aria-hidden by default. An icon beside a visible text label must stay hidden
  or a screen reader announces the name twice. Pass `label` only when the icon
  is a control's ONLY content — and prefer aria-label on the <button> itself.
  -------------------------------------------------------------------------- */

import { ICON_PATH_DATA } from './icon-paths'

export const SIZES = { xs: 12, sm: 14, md: 16, lg: 20, xl: 32 }
export const BASE_STROKE = 4.66

/** name -> { d: [path…], dots: [{x,y,r}…], sw?: number } */
export const ICONS = ICON_PATH_DATA
export const ICON_NAMES = Object.keys(ICONS)

/* Derived from each file's own stroke-width, as a ratio of the base. */
export const ICON_STROKE_SCALE = Object.fromEntries(
  Object.entries(ICONS).filter(([, v]) => v.sw).map(([k, v]) => [k, v.sw / BASE_STROKE])
)

/* CSS-animated icons. Declared here rather than baked into the SVG, because
   animation is runtime behaviour and the .svg files stay pure geometry.
   See .ds-icon-spin in app/globals.css — it stops under prefers-reduced-motion. */
const ANIMATED = new Set(['status-spinner', 'sync-syncing'])

export const ICON_PATHS = Object.fromEntries(ICON_NAMES.map(n => [n, ICONS[n].d || []]))
export const ICON_DOTS = Object.fromEntries(ICON_NAMES.map(n => [n, ICONS[n].dots || []]))

/** Grouped for a picker or a contact sheet. Anything not listed lands in Other. */
export const ICON_GROUPS = (() => {
  const rules = [
    ['Block types', /^block-/],
    ['Block chrome', /^(action-(delete|rename|duplicate)|handle-)/],
    ['Draw panel', /^draw-/],
    ['Crosscheck', /^(tool-crosscheck|cc-)/],
    ['Toolbar & view', /^(action-(add|export|import|check|move-out)|tool-(snap|mindmap|draw)|view-|state-)/],
    ['Image tools', /^img-/],
    ['Sheet tools', /^tool-/],
    ['Sidebar', /^(app-logo|nav-|settings-|storage-)/],
    ['Settings', /^theme-/],
    ['Sizing', /^size-/],
    ['Grid actions', /^grid-/],
    ['Text', /^text-/],
    ['Export formats', /^format-/],
    ['Status', /^status-/],
    ['Auth & sync', /^(auth-|sync-|plan-|share-|history-)/],
  ]
  const out = {}
  for (const name of ICON_NAMES) {
    const hit = rules.find(([, re]) => re.test(name))
    const key = hit ? hit[0] : 'Other'
    ;(out[key] = out[key] || []).push(name)
  }
  return out
})()

/** True if a name will render. Use in a test to assert every call site resolves. */
export const hasIcon = name => Object.prototype.hasOwnProperty.call(ICONS, name)

/**
 * @param {string} name         icon id, e.g. "block-table"
 * @param {number|string} size  px, or a token from SIZES ('xs'|'sm'|'md'|'lg'|'xl')
 * @param {number} strokeWidth  base weight; the per-icon multiplier still applies
 * @param {string} label        only when the icon is a control's ONLY content
 */
export default function Icon({ name, size = 16, strokeWidth = BASE_STROKE, label, style, className = '', ...rest }) {
  const icon = ICONS[name]
  const px = SIZES[size] ?? size

  if (!icon) {
    // Loud in development, invisible in production. A missing icon must never
    // collapse a toolbar's layout, but it shouldn't hide from whoever typo'd it.
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[Icon] "${name}" is not in the set. Available: ${ICON_NAMES.length} icons.`)
    }
    return <span aria-hidden="true" style={{ display: 'inline-block', width: px, height: px, ...style }} />
  }

  const sw = strokeWidth * (ICON_STROKE_SCALE[name] ?? 1)
  const spin = ANIMATED.has(name)

  return (
    <svg
      viewBox="0 0 64 64"
      width={px}
      height={px}
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
      className={`${spin ? 'ds-icon-spin ' : ''}${className}`.trim()}
      style={{ display: 'block', flexShrink: 0, ...style }}
      {...rest}
    >
      {(icon.d || []).map((d, i) => <path key={i} d={d} />)}
      {(icon.dots || []).map((c, i) => (
        <circle key={`c${i}`} cx={c.x} cy={c.y} r={c.r} fill="currentColor" stroke="none" />
      ))}
    </svg>
  )
}
