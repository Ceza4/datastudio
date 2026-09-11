/*
  lib/theme.js
  --------------------------------------------------------------------------
  ONE definition of the palette, the layer order, and the swatch set.

  WHY THIS FILE EXISTS

  app/globals.css said the CSS tokens and the JS `colors` object "both point at
  the same source of truth, so they can't drift". They had. Six files rebuilt
  the same colour object out of hex literals by hand — app/app/page.js,
  app/app/layout.js, app/page.js, app/login/page.js, app/signup/page.js and
  lib/exporters.js — and three of them were carrying values that appear nowhere
  in globals.css. `accentDim` alone had four different definitions.

  Drift like that is not a tidiness problem. It is the reason a login page and
  the app it logs you into are two slightly different products, and the eye
  reads that as a rendering bug rather than as a decision.

  So: one module. globals.css owns the CSS custom properties, this file owns
  the JS mirror, and the values below are the same numbers. If you change one,
  change both — the check in scripts/check-tokens.mjs fails the build if you
  don't.
  -------------------------------------------------------------------------- */

/* ── The palette ──────────────────────────────────────────────────────────
   Contrast ratios in the comments are measured against every surface the
   colour is actually painted on, worst case, per WCAG 2.1. AA body text needs
   4.5; a UI component or a large heading needs 3. */
const LIGHT = {
  base:       '#F5F3EE',
  surface:    '#EDEAE3',
  raised:     '#E4E1D8',
  /* PAPER. The only surface in the app that is lighter than `base`.

     The surface ladder runs base → surface → raised getting DARKER as it
     rises, which is right for every panel that sits ON the canvas. A document
     page is the one thing that must not obey it: paper is lighter than the
     desk it lies on. Rendered in `surface` it came out DARKER than the block
     around it and read as a recessed well rather than a sheet. */
  paper:      '#FCFBF8',
  canvasBg:   '#EAE7DE',
  border:     '#D5D1C7',

  /* A RESTING border that is genuinely dimmer than the hover border.

     Block chrome used to read `isHovered ? border : dark ? '#252420' : '#D5D1C7'`
     — and in light mode `border` IS '#D5D1C7', so both halves of that ternary
     resolved to the same colour and hovering a block changed nothing. Dark
     mode lifted from #252420 to #2E2D29 and worked. Nine block types shipped
     with a two-part hover cue where one part had never fired for anyone on the
     light theme. */
  borderDim:  '#E0DCD3',

  text:       '#1A1917',   // 13.44 on raised — fine
  text2:      '#6B6860',   // 4.26 on raised — just under AA, acceptable for secondary
  /* 3.01, DELIBERATELY.

     This was #A09D97: 2.07 on raised, 2.19 on the canvas. It is also the most
     used colour token in the app (80 usages), and it was carrying placeholder
     text, field labels, timestamps and icon buttons — content, not decoration.
     At 2.07 that is invisible on a laptop screen in daylight, which is the
     exact opposite of premium.

     There is no room in this palette for a third text tier that passes AA:
     the value would have to be about #666460, which is text2. So the tier is
     now honestly labelled — 3.01 is the UI-component threshold, and text-3 is
     for decoration, dividers, disabled states and icon strokes. Anything a
     user has to READ moved up to text2. */
  text3:      '#83807B',

  accent:     '#1D9E75',   // 2.59 on raised — fills, borders and rings only
  /* The accent, as TEXT. Same hue, dark enough to read: 4.56 worst case.
     app/page.js had already invented a local `accentText` for exactly this
     reason; it is a token now instead of one file's private fix. */
  accentText: '#147154',
  accentDim:  '#D0F0E4',

  green:      '#2A8331',
  red:        '#C0392B',
  amber:      '#8A6410',
  greenBg:    '#DCFCE7',
  amberBg:    '#FEF3C7',
  redBg:      '#FEE2E2',
}

const DARK = {
  base:       '#1A1917',
  /* Dark paper is not white. See LIGHT.paper. */
  paper:      '#232220',
  surface:    '#201F1C',
  raised:     '#262522',
  canvasBg:   '#141412',
  border:     '#2E2D29',
  borderDim:  '#252420',

  text:       '#E8E6E1',
  text2:      '#9A9790',
  text3:      '#706E6A',   // 3.01, same reasoning as light

  accent:     '#5B5FE8',
  accentText: '#7D81ED',   // 4.55 worst case
  accentDim:  '#1E2057',

  green:      '#4ADE80',
  red:        '#F87171',
  amber:      '#E8B85B',
  greenBg:    '#0D2A1A',
  amberBg:    '#2A1F0D',
  redBg:      '#2A0D0D',
}

/**
 * The colour object every component receives as `colors`.
 *
 * Returns a frozen object so a component cannot mutate the shared palette by
 * accident, and returns the SAME object for the same theme so React.memo on a
 * block component actually holds — a fresh object per render would defeat
 * every memo downstream of it.
 */
const FROZEN_LIGHT = Object.freeze({ ...LIGHT })
const FROZEN_DARK = Object.freeze({ ...DARK })

export function makeColors(dark) {
  return dark ? FROZEN_DARK : FROZEN_LIGHT
}

/** Raw access, for the two places that need to emit CSS text rather than styles. */
export const PALETTE = Object.freeze({ light: FROZEN_LIGHT, dark: FROZEN_DARK })

/* ── Layer order ──────────────────────────────────────────────────────────
   z-index was 55 sites using 28 distinct values spanning five orders of
   magnitude, with no scale and no way to reason about it. Three context menus
   — the same UI concept — sat at 300, 10000 and 99999. Two dropdown panels
   declared no z-index at all and inherited 100, which put them underneath
   every canvas overlay from 150 upward.

   Named tiers, spaced far enough apart that a component can nudge ±10 inside
   its own band without colliding with the next one. If you need a number that
   is not here, the answer is almost always that you have found a new tier and
   it belongs in this list. */
export const Z = Object.freeze({
  /* Inside a block: sticky headers, gutters, resize grips, cell editors. */
  cellChrome:   6,
  cellEditor:   10,
  /* On the canvas, below the blocks. */
  connection:   5,
  shape:        7,
  ink:          8,
  /* Block furniture. */
  blockPort:    30,
  resizeHandle: 25,
  /* Canvas overlays that draw OVER the blocks. */
  marquee:      45,
  snapGuide:    50,
  sizeTag:      60,
  /* Persistent chrome: the sidebar, the top row, the contextual rails. */
  rail:         96,
  chrome:       100,
  chromeTop:    101,
  /* Transient surfaces raised above the chrome. */
  hint:         150,
  menu:         200,
  /* A scrim always sits exactly one below ITS OWN surface. That rule was
     written for the modal pair below and then not applied to the popovers,
     which is how three of them ended up unusable:

       DatabaseBlock  select dropdown   scrim 500, menu  300
       BlockPicker    insert menu       scrim 500, menu  300
       PdfExtractPanel                  scrim 500, panel 300

     All three portal a full-screen transparent dismiss layer at `modalScrim`
     and then draw themselves at `popover`. 500 is above 300, so the invisible
     layer covered the thing it belonged to and every click on an option hit
     the scrim's onClose. The menu opened, and then refused to be used.

     Caught by tests/browser/run.mjs, which could not click a select option and
     reported `<div></div> intercepts pointer events` — a sentence worth
     recognising on sight, because it is what this bug always looks like. */
  popoverScrim: 299,
  popover:      300,
  panelScrim:   399,
  panel:        400,
  /* Modal stack. */
  modalScrim:   500,
  modal:        501,
  /* Above everything, including modals: they report on the modal. */
  toastScrim:   600,
  toast:        601,
  dialogScrim:  700,
  dialog:       701,
})

/* ── Drawing swatches ─────────────────────────────────────────────────────
   There were four separate literal arrays doing this job — one in the text
   toolbar, one in the draw panel, one for sections, one for Kanban — holding
   11 values between them with nothing shared. Several were unusable: #1A1917
   is the dark base (invisible on a dark canvas), #ffffff is invisible on the
   light one, and #E8E6E1 is the dark TEXT colour, i.e. near-white ink on a
   cream page. The pen even defaulted to the dark-mode accent, so drawing in
   light mode started on the wrong colour.

   These eight are chosen so every one clears 3.8:1 against BOTH canvas
   grounds — they are legible whichever theme the reader is in, which is the
   whole point of a colour you are going to draw with. `ink` is separate
   because it deliberately follows the theme instead of resisting it. */
export const SWATCHES = Object.freeze([
  { name: 'Red',     value: '#CD4037' },
  { name: 'Orange',  value: '#C24E14' },
  { name: 'Amber',   value: '#A06603' },
  { name: 'Green',   value: '#2A8331' },
  { name: 'Teal',    value: '#098172' },
  { name: 'Blue',    value: '#0B71DA' },
  { name: 'Violet',  value: '#7F5CD6' },
  { name: 'Magenta', value: '#B941A9' },
])

/* ── Stable hashing, for identity colours ─────────────────────────────────
   ONE hash for every "give this thing a stable colour" feature in the app.

   personHue() in lib/attribution.js had this inline, and the calendar sidebar
   needed the same thing for source calendars. Two copies of a hash function
   drift — and when they drift, the same id gets two different colours in two
   parts of the UI, which is the one failure mode a stable-identity-colour
   system cannot survive. So it lives here, next to the swatches it indexes
   into, and both callers import it.

   FNV-1a WITH A FINAL AVALANCHE, not `h * 31 + c`.

   The multiply-by-31 version — the one lib/account.js used for avatar hues —
   put `1111...-1111` and `2222...-2222` in the SAME bucket. That is not a
   theoretical concern for uuids: ids differing in a narrow band of characters
   are exactly what sequential test accounts produce, and the weak mixing lets
   those differences cancel modulo a small bucket count. The xor-shift tail
   spreads every input bit across the whole word before the modulo sees it. */
export function fnv1a(key) {
  const s = String(key || '')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  h ^= h >>> 15
  h = Math.imul(h, 0x2545f491) >>> 0
  h ^= h >>> 13
  return h >>> 0
}

/** Pick a stable entry from any palette. Empty key → the first entry, so a
    missing id is a consistent colour rather than a crash. */
export function stablePick(key, palette) {
  if (!palette || palette.length === 0) return undefined
  if (!key) return palette[0]
  return palette[fnv1a(key) % palette.length]
}

/** The theme-following option, offered alongside the fixed hues. */
export const INK_SWATCH = Object.freeze({ name: 'Ink', value: 'var(--ds-text)' })

/** What a fresh pen starts on. A real colour, not the other theme's accent. */
export const DEFAULT_INK = '#0B71DA'

/* ── Motion ───────────────────────────────────────────────────────────────
   Mirrors the CSS tokens for the handful of places that build an animation
   shorthand in JS. Four different overshoot curves were in use and the same
   named keyframe was being played at three different durations from three
   call sites. */
export const MOTION = Object.freeze({
  hover:    '0.15s',
  enter:    '0.18s',
  exit:     '0.12s',
  standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
  overshoot: 'cubic-bezier(0.34, 1.3, 0.64, 1)',
})
