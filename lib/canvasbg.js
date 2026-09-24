/*
  lib/canvasbg.js
  --------------------------------------------------------------------------
  A notebook's canvas background: which tint it sits on, and how its dots look.

  WHY THIS IS NOTEBOOK DATA, NOT A PREF
  Decided 24 Sep 2026: the background belongs to the notebook and is shared.
  It is stored as `nb.canvasBg`, so it rides the notebook document through
  IndexedDB, the outbox and sharing like any other notebook field. Everyone
  with the notebook sees the same background. That is a different axis from
  lib/prefs.js, which is per person. `gridSize` stays a pref: it drives the
  LINE grid and the snap pitch, and dot spacing is separate on purpose. So
  the dots do not have to sit on snap lines. Both default to 32 so they match
  until someone changes one of them.

  WHY OPACITY IS STORED PER THEME
  One notebook is opened by people in light and in dark. The same alpha reads
  very differently on the two grounds (the recommended values are 46% light and
  38% dark, both about 2:1). A single number would be right in one theme and
  wrong in the other. So the slider edits the theme you are looking at, and each
  theme keeps its own value.

  NORMALISE ON EVERY READ, same rule as lib/prefs.js. A notebook can come from
  a newer build, a collaborator, or a hand-edited payload. `spacing` feeds a
  loop bound in the renderer, so a 0 or NaN there would freeze the tab. It is
  not a cosmetic bug.
  -------------------------------------------------------------------------- */

/* Ground and dot ink for each preset, one pair per theme. The inks are tuned so
   the default opacities land at about 2:1 against their own ground in both themes
   (1.92–2.01, checked in tests/canvasbg.test.mjs). That is visible when you look
   for it and quiet when you work. `default` is --ds-canvas-bg from globals.css. */
export const CANVAS_PRESETS = [
  { id: 'default', name: 'Default', light: { bg: '#EAE7DE', ink: '#5A5955' }, dark: { bg: '#141412', ink: '#9A9790' } },
  { id: 'paper',   name: 'Paper',   light: { bg: '#F4F2EC', ink: '#5E5B55' }, dark: { bg: '#1C1B18', ink: '#9D9A93' } },
  { id: 'stone',   name: 'Stone',   light: { bg: '#E5E5E2', ink: '#58585A' }, dark: { bg: '#161616', ink: '#9A9A98' } },
  { id: 'slate',   name: 'Slate',   light: { bg: '#E1E5EA', ink: '#4F5864' }, dark: { bg: '#11151B', ink: '#8E98A6' } },
  { id: 'sage',    name: 'Sage',    light: { bg: '#E2E7DF', ink: '#535D4D' }, dark: { bg: '#121712', ink: '#8FA08A' } },
  { id: 'sand',    name: 'Sand',    light: { bg: '#ECE3D3', ink: '#675B47' }, dark: { bg: '#18140E', ink: '#A69A84' } },
]

/* Ranges for the sliders AND the clamps in normalise. The typed box uses the
   same numbers, so a value you can type is always a value you could slide to. */
export const CANVAS_BG_LIMITS = {
  spacing: { min: 8, max: 128, step: 1 },      // world px between dots at 100% zoom
  radius:  { min: 0.4, max: 4, step: 0.1 },    // screen px at 100% zoom
  opacity: { min: 0, max: 80, step: 1 },       // percent
}

export const DEFAULT_CANVAS_BG = {
  preset: 'default',
  spacing: 32,
  radius: 1.1,
  opacityLight: 46,
  opacityDark: 38,
  ruler: false,
}

/* The below-this-is-noise threshold for thinning dots out when zoomed out. At
   14 on-screen px a 1px dot grid starts reading as a grey wash rather than
   dots, so spacing doubles until it clears this. */
export const MIN_DOT_STEP_PX = 14

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
function num(v, { min, max, step }, fallback) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  const snapped = Math.round(n / step) * step
  /* Round off float dust from the step maths (0.1 * 11 = 1.1000000000000001),
     so a stored value compares equal to what the slider shows. */
  return Number(clamp(snapped, min, max).toFixed(2))
}

/** Coerce anything into a complete, valid background. Never throws. */
export function normalizeCanvasBg(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CANVAS_BG }
  const L = CANVAS_BG_LIMITS, D = DEFAULT_CANVAS_BG
  return {
    preset: CANVAS_PRESETS.some(p => p.id === raw.preset) ? raw.preset : D.preset,
    spacing: num(raw.spacing, L.spacing, D.spacing),
    radius: num(raw.radius, L.radius, D.radius),
    opacityLight: num(raw.opacityLight, L.opacity, D.opacityLight),
    opacityDark: num(raw.opacityDark, L.opacity, D.opacityDark),
    ruler: typeof raw.ruler === 'boolean' ? raw.ruler : D.ruler,
  }
}

/** True when a notebook's background is still the untouched default. */
export function isDefaultCanvasBg(raw) {
  const n = normalizeCanvasBg(raw)
  return Object.keys(DEFAULT_CANVAS_BG).every(k => n[k] === DEFAULT_CANVAS_BG[k])
}

/** What the renderer needs for one theme, already resolved. */
export function resolveCanvasBg(raw, dark) {
  const n = normalizeCanvasBg(raw)
  const preset = CANVAS_PRESETS.find(p => p.id === n.preset) || CANVAS_PRESETS[0]
  const side = dark ? preset.dark : preset.light
  return {
    bg: side.bg,
    ink: side.ink,
    alpha: (dark ? n.opacityDark : n.opacityLight) / 100,
    radius: n.radius,
    spacing: n.spacing,
    ruler: n.ruler,
  }
}

/* ── contrast, for the readout under the opacity slider ───────────────── */
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
function lum(c) {
  const v = c.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4) })
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
}
/** WCAG contrast of `ink` at `alpha` composited over `bg`. */
export function dotContrast(ink, bg, alpha) {
  const f = rgb(ink), b = rgb(bg)
  const mix = f.map((c, i) => c * alpha + b[i] * (1 - alpha))
  const l1 = lum(mix), l2 = lum(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/* ── the renderer ──────────────────────────────────────────────────────────

   A 2D canvas, not an SVG <pattern>. The pattern could not do three things:
   put each dot on a device-pixel centre (a pattern tile is one fractional
   width repeated, so rounding the tile makes the error add up across the
   screen), thin out when zoomed out without changing the tile under React,
   or draw a ruler dot without a second overlapping pattern. The old version
   also ran every dot through a Gaussian blur, and that blur made them soft
   as much as the colour did.

   Per-dot rounding keeps the error at no more than half a device pixel, and
   it never accumulates. Cost: at worst about 140 × 80 dots on a 1080p screen
   at the 14px floor, filled as two Path2Ds. That is well under a millisecond,
   and this only runs when pan, zoom, size or the background change. */

/**
 * @param {CanvasRenderingContext2D} ctx  already sized to w*dpr × h*dpr
 * @param {{w:number,h:number,dpr:number,panX:number,panY:number,zoom:number}} view
 * @param {ReturnType<typeof resolveCanvasBg>} bg
 */
export function drawDotGrid(ctx, view, bg) {
  const { w, h, dpr, panX, panY, zoom } = view
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  if (!(bg.alpha > 0) || !(bg.spacing > 0) || !(zoom > 0)) return

  const base = bg.spacing * zoom
  let m = 1
  while (base * m < MIN_DOT_STEP_PX && m < 1024) m *= 2
  const step = base * m
  /* Radius grows gently with zoom, not linearly. Dots that scale 1:1 look like
     polka dots at 300%, and dots that stay fixed disappear at 25%. */
  const r = bg.radius * clamp(Math.pow(zoom, 0.35), 0.8, 1.5)

  const i0 = Math.floor(-panX / step) - 1, i1 = Math.ceil((w - panX) / step) + 1
  const j0 = Math.floor(-panY / step) - 1, j1 = Math.ceil((h - panY) / step) + 1
  const snap = v => (Math.floor(v * dpr) + 0.5) / dpr

  const minor = new Path2D(), major = new Path2D()
  let hasMajor = false
  for (let j = j0; j <= j1; j++) {
    const y = snap(panY + j * step)
    /* Ruler dots sit on every 5th WORLD lattice point, counted from the
       canvas origin. They stay put while you pan and do not re-deal
       when the grid thins. */
    const rowMajor = bg.ruler && ((j * m) % 5 === 0)
    for (let i = i0; i <= i1; i++) {
      const x = snap(panX + i * step)
      if (rowMajor && ((i * m) % 5 === 0)) {
        major.moveTo(x + r * 1.5, y); major.arc(x, y, r * 1.5, 0, Math.PI * 2); hasMajor = true
      } else {
        minor.moveTo(x + r, y); minor.arc(x, y, r, 0, Math.PI * 2)
      }
    }
  }
  const [cr, cg, cb] = rgb(bg.ink)
  ctx.fillStyle = `rgba(${cr},${cg},${cb},${bg.alpha})`
  ctx.fill(minor)
  if (hasMajor) {
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${Math.min(1, bg.alpha + 0.2)})`
    ctx.fill(major)
  }
}
