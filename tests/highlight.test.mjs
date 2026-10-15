/*
  tests/highlight.test.mjs — the Notes highlighter's pure half.

  The DOM half (toggleHighlight) is exercised in the browser; what is pinned
  here is what silently breaks highlights in storage or in the other theme:
  colour normalisation, the generated stylesheet, and that the Notes palette
  is still the Document ribbon's palette (the whole point of sharing storage).
*/
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  NOTE_HIGHLIGHTS, KNOWN_HIGHLIGHTS, rgbTriplet, normColor, sameColor, highlightCss,
} from '../lib/highlight.js'

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('ok', msg) } else { fail++; console.log('FAIL', msg) } }
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

ok(rgbTriplet('#FFF176') === '255, 241, 118', 'rgbTriplet: browser serialisation')
ok(rgbTriplet('nope') === null, 'rgbTriplet: rejects junk')

ok(normColor('rgb(255, 241, 118)') === '#fff176', 'normColor: rgb')
ok(normColor('rgb(255,241,118)') === '#fff176', 'normColor: rgb, sanitiser spacing')
ok(normColor('#FFF176') === '#fff176', 'normColor: hex, any case')
ok(normColor('#abc') === '#aabbcc', 'normColor: short hex')
ok(normColor('rgba(0, 0, 0, 0)') === null, 'normColor: transparent rgba is no highlight')
ok(normColor('transparent') === null, 'normColor: transparent')
ok(normColor('var(--ds-hl-yellow)') === null, 'normColor: a token is not a stored colour')
ok(sameColor('rgb(255, 241, 118)', '#FFF176'), 'sameColor across spellings')
ok(!sameColor(null, null), 'sameColor: two nothings are not a match')

ok(NOTE_HIGHLIGHTS.length === 4, 'four colours in Notes (decided 1 Oct 2026)')
ok(new Set(KNOWN_HIGHLIGHTS.map(h => h.id)).size === KNOWN_HIGHLIGHTS.length, 'ids unique')

/* Same storage as the Document block: its ribbon's palette must contain every
   Notes value, or a highlight copied between them changes colour. */
const ribbon = readFileSync(join(ROOT, 'components/tools/DocumentRibbon.js'), 'utf8')
const m = /const HIGHLIGHTS = \[([\s\S]*?)\]/.exec(ribbon)
ok(!!m, 'DocumentRibbon still declares HIGHLIGHTS')
if (m) {
  const docVals = [...m[1].matchAll(/value:\s*'(#[0-9A-Fa-f]{6})'/g)].map(x => x[1].toLowerCase())
  for (const h of KNOWN_HIGHLIGHTS) ok(docVals.includes(h.value.toLowerCase()), `Document palette has ${h.name} ${h.value}`)
}

const css = highlightCss('[data-ds-text]')
for (const h of KNOWN_HIGHLIGHTS) {
  ok(css.includes(`[style*="${rgbTriplet(h.value)}"]`), `css matches ${h.name} as rgb`)
  ok(css.includes(`var(--ds-hl-${h.id})`), `css paints ${h.name} with its token`)
}
ok(/\[style\*="background-color"\]\[style\*=/.test(css), 'css requires background-color, so a text colour is never repainted')
ok(/!important/.test(css), 'css overrides the inline stored value')

/* Every token the stylesheet and toolbar use exists in both themes. */
const g = readFileSync(join(ROOT, 'app/globals.css'), 'utf8')
const light = /^:root\s*\{([\s\S]*?)^\}/m.exec(g)?.[1] || ''
const dark = /^\[data-theme='dark'\]\s*\{([\s\S]*?)^\}/m.exec(g)?.[1] || ''
for (const h of KNOWN_HIGHLIGHTS) {
  ok(light.includes(`--ds-hl-${h.id}:`) && dark.includes(`--ds-hl-${h.id}:`), `--ds-hl-${h.id} in both themes`)
}
for (const h of NOTE_HIGHLIGHTS) {
  ok(light.includes(`--ds-hl-${h.id}-mark:`) && dark.includes(`--ds-hl-${h.id}-mark:`), `--ds-hl-${h.id}-mark in both themes`)
}

console.log(`\n ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
