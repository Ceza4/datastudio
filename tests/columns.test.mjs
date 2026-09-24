/* lib/columns.js pure maths and the sanitizer round trip. The caret and
   structure behaviour (hops, removal, repair, cross-column delete, fast
   typing) needs a real browser and was exercised in Chromium on 24 Sep 2026;
   see the backlog entry. */
import { buildTemplate, evenWidths, columnsHtml, resizePair, MIN_COL_PCT } from '../lib/columns.js'
import { sanitizeEditorHtml } from '../lib/sanitize.js'
let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }

console.log('\n template')
ok(buildTemplate([50, 50]) === 'minmax(0,50fr) 18px minmax(0,50fr)', 'fr tracks with one divider between')
ok(evenWidths(3).every(w => Math.abs(w - 100 / 3) < 1e-9), 'even split of 3')
ok(evenWidths(9).length === 5 && evenWidths(0).length === 2, 'count clamps to 2..5')

console.log('\n survives the editor sanitizer (the pre-rebuild bug)')
const clean = sanitizeEditorHtml(columnsHtml(3))
ok((clean.match(/data-type="col"/g) || []).length === 3, 'column bodies keep data-type="col"')
ok(/grid-template-columns:minmax\(0,33\.33fr\) 18px/.test(clean), 'widths survive')
ok(!/url\(|image-set/.test(sanitizeEditorHtml('<div style="grid-template-columns:image-set(\'x\' 1x)">a</div>')), 'grid-template-columns still refuses non-allowlisted functions')

console.log('\n resizing')
const r = resizePair([50, 50], 0, -1000)
ok(r[0] === MIN_COL_PCT && r[1] === 100 - MIN_COL_PCT, 'drag to zero stops at the minimum')
const r2 = resizePair([20, 30, 50], 1, 10)
ok(r2[0] === 20 && r2[1] === 40 && r2[2] === 40, 'only the pair moves')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
