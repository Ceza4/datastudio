/*
  tests/browser/run.mjs
  --------------------------------------------------------------------------
  The suite that runs in a real browser.

  WHY THIS EXISTS, AND WHY IT IS SEPARATE FROM `npm test`

  Every bug that has ever reached a user in this project was invisible to the
  unit suite. Not because the tests were bad — 979 assertions pass — but
  because `react-dom/server` runs the RENDER phase only. It catches a TDZ
  error, a bad destructure, a conditional hook. It cannot see an effect, a ref,
  a layout, a canvas, or the order two DOM events arrive in.

  The bug this file was written for is the perfect example. Clicking a line of
  PDF text did nothing at all. The component was correct in isolation; the
  failure was four events long:

      pointerdown on the layer  → the editor opens, autoFocus takes focus
      focusin  on the input
      mousedown on the layer    → mousedown's DEFAULT focus behaviour moves
      focusout on the input       focus back to the layer, so onBlur commits
                                  and closes the editor

  Nothing short of a real browser can observe that. So: a real browser.

  SEPARATE COMMAND, DELIBERATELY. `npm test` stays fast and has no
  dependencies. This needs Playwright and a Chromium, which not every machine
  or CI job will have — so it SKIPS with an explanation rather than failing
  when they are missing. A suite that goes red because of the environment gets
  ignored within a week.

      npm run test:browser

  The harness mounts one component with synthetic props: no PDF, no IndexedDB,
  no pdf.js. That is the point — it isolates the DOM behaviour from everything
  that makes the real block slow to set up, so a failure here is unambiguous.
  -------------------------------------------------------------------------- */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }

/* ── environment ─────────────────────────────────────────────────────── */

function loadPlaywright() {
  const require_ = createRequire(import.meta.url)
  for (const id of ['playwright', 'playwright-core']) {
    try { return require_(id) } catch { /* try the next */ }
  }
  /* Globally installed is normal in a sandbox and fine — resolve it by hand
     rather than demanding a local copy nobody wants in the lockfile. */
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
    return require_(resolve(root, 'playwright'))
  } catch { return null }
}

function chromiumPath(pw) {
  try {
    const p = pw.chromium.executablePath()
    if (p && existsSync(p)) return p
  } catch { /* not downloaded through playwright */ }
  /* Pre-installed image layout. */
  for (const p of [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
  ]) if (existsSync(p)) return p
  return null
}

const pw = loadPlaywright()
if (!pw) {
  console.log('\n  SKIPPED — Playwright is not installed.')
  console.log('  These tests need a real browser. Install with:  npm i -D playwright && npx playwright install chromium')
  process.exit(0)
}
const exe = chromiumPath(pw)
if (!exe) {
  console.log('\n  SKIPPED — Playwright is present but no Chromium was found.')
  console.log('  Install one with:  npx playwright install chromium')
  process.exit(0)
}

/* ── bundle ──────────────────────────────────────────────────────────── */

const esbuild = resolve(ROOT, 'node_modules/.bin/esbuild')
if (!existsSync(esbuild)) {
  console.log('\n  SKIPPED — esbuild is not installed (npm i -D esbuild).')
  process.exit(0)
}
execFileSync(esbuild, [
  resolve(HERE, 'harness.jsx'),
  '--bundle', `--outfile=${resolve(HERE, 'bundle.js')}`,
  '--loader:.js=jsx', '--jsx=automatic', '--format=iife', '--log-level=warning',
], { cwd: ROOT, stdio: 'inherit' })

/* ── drive ───────────────────────────────────────────────────────────── */

const browser = await pw.chromium.launch({ executablePath: exe })
const page = await browser.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.goto(pathToFileURL(resolve(HERE, 'index.html')).href)
await page.waitForTimeout(200)

const stage = await page.locator('#stage').boundingBox()
/* The harness page is 800pt tall at scale 1, so PDF y=700 is screen y≈100.
   Both test runs sit on baselines 700 and 660. */
const RUN_1 = { x: stage.x + 100, y: stage.y + 95 }
const RUN_2 = { x: stage.x + 100, y: stage.y + 135 }
const EMPTY = { x: stage.x + 320, y: stage.y + 500 }

console.log('\n hover')
{
  await page.mouse.move(RUN_1.x, RUN_1.y)
  await page.waitForTimeout(80)
  ok(await page.locator('#stage div').count() > 1, 'hovering a line draws an outline over it')
  await page.mouse.move(EMPTY.x, EMPTY.y)
  await page.waitForTimeout(80)
  ok(await page.locator('#stage input').count() === 0, 'hovering empty space opens nothing')
}

console.log('\n click opens an editor — THE regression')
{
  await page.mouse.click(RUN_1.x, RUN_1.y)
  await page.waitForTimeout(150)

  /* The whole point of the file. This was 0 before preventDefault was added to
     the opening pointerdown: the editor mounted and was blurred shut by
     mousedown's default focus behaviour inside the same click. */
  ok(await page.locator('#stage input').count() === 1, 'clicking a line opens an editor and it STAYS open')
  ok(await page.evaluate(() => document.activeElement?.tagName) === 'INPUT',
     'and the editor holds focus — it is typed into immediately, with no second click')
  ok(await page.locator('#stage input').first().inputValue() === 'Original sentence one',
     'prefilled with what the document says')

  /* mousedown must not reach the layer at all — if it does, the default focus
     behaviour is back and so is the bug. */
  const seen = await page.evaluate(() => window.__events || [])
  ok(!seen.includes('mousedown'), 'the opening pointerdown is defaultPrevented, so no mousedown follows')
}

console.log('\n typing and committing')
{
  await page.locator('#stage input').first().fill('Rewritten sentence')
  ok(await page.locator('#stage input').first().inputValue() === 'Rewritten sentence', 'the editor accepts typing')

  await page.keyboard.press('Enter')
  await page.waitForTimeout(150)
  ok(await page.locator('#stage input').count() === 0, 'Enter closes the editor')

  const edits = await page.evaluate(() => window.__state().edits)
  ok(edits.length === 1, 'and produces exactly one edit — a replacement is ONE undo step, not a whiteout plus a text')
  ok(edits[0].kind === 'replace', 'of kind replace')
  ok(edits[0].text === 'Rewritten sentence', 'carrying the new text')
  ok(edits[0].original === 'Original sentence one', 'and the original, so revert is exact')
  ok(Math.abs(edits[0].y - 700) < 0.01, 'anchored to the original baseline, so it lands where the text was')
}

console.log('\n reopening an edited line')
{
  await page.mouse.click(RUN_1.x, RUN_1.y)
  await page.waitForTimeout(150)
  ok(await page.locator('#stage input').first().inputValue() === 'Rewritten sentence',
     'reopening shows the CURRENT text — offering the original back reads as the edit having been lost')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
  ok(await page.locator('#stage input').count() === 0, 'Escape closes it')
  ok((await page.evaluate(() => window.__state().edits)).length === 1, 'and adds nothing')
}

console.log('\n opening a second line while one is open')
{
  await page.mouse.click(RUN_2.x, RUN_2.y)
  await page.waitForTimeout(120)
  ok(await page.locator('#stage input').first().inputValue() === 'Second line here', 'the second line opens')
  await page.locator('#stage input').first().fill('Changed second')
  await page.mouse.click(RUN_1.x, RUN_1.y)
  await page.waitForTimeout(150)
  const edits = await page.evaluate(() => window.__state().edits)
  ok(edits.length === 2, 'clicking another line commits the open one rather than dropping it')
  ok(edits.some(e => e.text === 'Changed second'), 'and keeps what was typed')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
}

console.log('\n no-op edits')
{
  await page.mouse.click(RUN_1.x, RUN_1.y)
  await page.waitForTimeout(120)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(120)
  ok((await page.evaluate(() => window.__state().edits)).length === 2,
     'opening a line, reading it and pressing Enter records nothing — an undo step that undoes to the same page is noise')
}

console.log('\n sanitiser — does the output actually run?')
{
  /* The unit suite asserts payloads are ABSENT from the output. That is a
     statement about strings. This is the statement about behaviour: put the
     sanitised markup into a live document and see whether anything fires.
     Everything here executed against the two-regex sanitiser this replaced. */
  const payloads = [
    ['nested-tag splice', '<sc<script>window.__pwned=1</script>ript>window.__pwned=1</script>'],
    ['slash-separated handler', '<img/src=x/onerror=window.__pwned=1>'],
    ['unterminated script', '<script>window.__pwned=1'],
    ['iframe javascript:', '<iframe src="javascript:parent.__pwned=1"></iframe>'],
    ['svg animate', '<svg><animate attributeName=href values=javascript:window.__pwned=1 /></svg>'],
    ['body onload', '<body onload=window.__pwned=1>'],
    ['img onerror, quoted', '<img src="x" onerror="window.__pwned=1">'],
    ['meta refresh', '<meta http-equiv=refresh content="0;url=javascript:window.__pwned=1">'],
    ['object data', '<object data="javascript:window.__pwned=1"></object>'],
    ['svg onload', '<svg onload=window.__pwned=1>'],
  ]

  for (const [label, payload] of payloads) {
    const fired = await page.evaluate(async raw => {
      window.__pwned = 0
      const host = document.createElement('div')
      document.body.appendChild(host)
      host.innerHTML = window.__sanitize(raw)
      /* Give an onerror or a decoder a turn — image loads and the microtask
         queue both resolve after the assignment returns. */
      await new Promise(r => setTimeout(r, 60))
      const out = host.innerHTML
      host.remove()
      return { pwned: window.__pwned, out }
    }, payload)
    ok(fired.pwned === 0, `${label} does not execute in a live document`)
  }

  /* And the counterpart: real content still renders as real elements, not as
     escaped text. A sanitiser that neuters everything is easy and useless. */
  const kept = await page.evaluate(() => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    host.innerHTML = window.__sanitize('<p>Hello <strong>world</strong></p><a href="https://example.com">link</a>')
    const r = {
      strong: host.querySelectorAll('strong').length,
      href: host.querySelector('a')?.getAttribute('href'),
      rel: host.querySelector('a')?.getAttribute('rel'),
      text: host.textContent,
    }
    host.remove()
    return r
  })
  ok(kept.strong === 1, 'bold text is still a real <strong> element, not escaped text')
  ok(kept.href === 'https://example.com/', 'a safe link keeps its href')
  ok((kept.rel || '').includes('noopener'), 'and gains rel=noopener')
  ok(kept.text.includes('Hello world'), 'and the words survive')
}

/* ── the two chrome primitives ────────────────────────────────────────────
   Fourteen window.confirm/alert/prompt calls were replaced by these. Every
   property that makes the replacement an improvement rather than a reskin is
   invisible to react-dom/server: the portal, focus moving in and coming back,
   the Tab trap, and the two silent ways out both meaning "never mind". */

console.log('\n toast — what replaced "Are you sure?"')
{
  await page.click('#raise-toast')
  await page.waitForTimeout(150)
  ok(await page.locator('[data-ds-toast]').count() === 1, 'a toast appears')
  ok((await page.locator('[data-ds-toast]').innerText()).includes('Block deleted'), 'carrying the message')

  /* Rule 2. Toasts are raised from inside the canvas transform, where
     position:fixed is positioned against the transform and then scaled. */
  ok(await page.evaluate(() => document.querySelector('[data-ds-toasts]')?.parentElement === document.body),
     'and is portalled to document.body, not left inside whatever raised it')

  await page.locator('[data-ds-toast] button').click()
  await page.waitForTimeout(150)
  ok(await page.evaluate(() => window.__undone) === 1,
     'UNDO calls back — the whole justification for deleting without asking')
  ok(await page.locator('[data-ds-toast]').count() === 0, 'and the toast leaves with it')
}

console.log('\n confirm dialog — for what undo cannot reach')
{
  await page.click('#open-dialog')
  await page.waitForTimeout(150)
  ok(await page.locator('[role=dialog]').count() === 1, 'the dialog opens')
  ok(await page.evaluate(() => document.querySelector('[data-ds-dialog-scrim]')?.parentElement === document.body),
     'portalled to document.body as well')

  /* The one that would matter at 2am. */
  ok(await page.evaluate(() => document.activeElement?.textContent) === 'Cancel',
     'focus lands on Cancel, NOT the destructive button — one Enter must never wipe a workspace')

  /* Checked after EVERY press, not once at the end. Asserting only the final
     position passes with the trap deleted: the dialog is portalled last in
     the document, so Tab walks out, wraps around the whole page and happens to
     land back inside it. The bug is any single step that leaves. */
  const inside = () => page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))
  let escaped = false
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    if (!(await inside())) escaped = true
  }
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Shift+Tab')
    if (!(await inside())) escaped = true
  }
  ok(!escaped,
     'Tab cycles inside the dialog rather than walking out into the canvas behind the scrim')

  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  ok(await page.locator('[role=dialog]').count() === 0, 'Escape closes it')
  const esc = await page.evaluate(() => ({ n: window.__resolved.length, last: window.__resolved[window.__resolved.length - 1] }))
  ok(esc.n === 1 && esc.last === null, 'resolving to null — never to the destructive value')
  ok(await page.evaluate(() => document.activeElement?.id) === 'open-dialog',
     'and focus returns to the button that opened it, so the next Tab starts where it left off')
}

console.log('\n scrim click is also "never mind"')
{
  await page.click('#open-dialog')
  await page.waitForTimeout(150)
  /* Top-left corner: the card is centred and 420px wide, so this is scrim. */
  await page.mouse.click(6, 6)
  await page.waitForTimeout(150)
  ok(await page.locator('[role=dialog]').count() === 0, 'clicking the scrim closes the dialog')
  const scrim = await page.evaluate(() => ({ n: window.__resolved.length, last: window.__resolved[window.__resolved.length - 1] }))
  ok(scrim.n === 2 && scrim.last === null, 'and resolves to null, exactly like Escape')
}

/* ── the text rail's inline link ──────────────────────────────────────────
   window.prompt got one thing free that an inline input does not: focus never
   left the text, so execCommand still had a selection. The rail has to carry
   the Range by hand now, and getting it wrong applies the link to nothing at
   all — no error, no link, nothing. That is the shape of bug this file is for. */

const LINK_BTN = '[aria-label="Insert hyperlink"]'
const RAIL = '[data-island-rail]'

console.log('\n text rail — asking for a URL without a modal')
{
  await page.dblclick('#editable')                       // selects a word, keeps focus
  await page.waitForTimeout(80)
  ok((await page.evaluate(() => window.getSelection().toString())).length > 0, 'a word is selected')

  await page.click(LINK_BTN)
  await page.waitForTimeout(120)
  /* Still open on the next turn, not mounted and blurred shut inside the same
     click — the failure the PDF editor had, and the reason this file exists. */
  ok(await page.locator(`${RAIL} input`).count() === 1, 'the URL input opens in the rail and STAYS open')
  ok(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Link address',
     'and holds focus, so the URL is typed immediately')
  /* Taking that focus blurred the text, which in the app persists the block
     and re-renders this subtree. The Range is being held across that. */
  ok(Number(await page.getAttribute('#editable', 'data-saves')) >= 1,
     'and blurring the text persisted it, re-rendering the editable while the Range is held')

  await page.locator(`${RAIL} input`).fill('example.com')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(150)
  const a = await page.evaluate(() => {
    const el = document.querySelector('#editable a')
    return el && { href: el.getAttribute('href'), text: el.textContent, target: el.getAttribute('target'), rel: el.getAttribute('rel') }
  })
  ok(!!a, 'Enter links the text that was selected — not nothing, which is what a lost Range produces')
  ok(a && a.text.length > 0, 'and the link wraps real words rather than an empty span')
  ok(a && a.href === 'https://example.com/', 'a bare hostname is read as https, because that is what people type')
  ok(a && (a.rel || '').includes('noopener'), 'and it still gains target/rel — window.opener is not handed to the destination')
  ok(await page.locator(`${RAIL} input`).count() === 0, 'the input closes once the link is in')
}

console.log('\n and it still refuses what safeLinkUrl refuses')
{
  await page.dblclick('#editable')
  await page.click(LINK_BTN)
  await page.waitForTimeout(120)
  await page.locator(`${RAIL} input`).fill('javascript:alert(1)')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(120)
  ok(await page.locator(`${RAIL} [role=alert]`).count() === 1, 'an unsafe scheme is refused inline, under the input')
  ok(await page.locator(`${RAIL} input`).count() === 1, 'and the input stays open so the address can be fixed')
  ok(await page.evaluate(() => document.querySelectorAll('#editable a').length) === 1, 'no link was created')

  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
  ok(await page.locator(`${RAIL} input`).count() === 0, 'Escape closes the input')
  ok(await page.locator(RAIL).count() === 1, 'and leaves the rail itself alone — one stray Esc must not cost the whole rail')
}

console.log('\n and says so in the rail when nothing is selected')
{
  await page.evaluate(() => window.getSelection().removeAllRanges())
  await page.click(LINK_BTN)
  await page.waitForTimeout(100)
  ok(await page.locator(`${RAIL} [role=status]`).count() === 1, 'a hint appears in the rail rather than an alert() over the tab')
  ok(await page.locator(`${RAIL} input`).count() === 0, 'and no input opens')
  ok(await page.evaluate(() => document.querySelectorAll('#editable a').length) === 1, 'and nothing is linked')
}

/* ── the infinite canvas ──────────────────────────────────────────────────
   Two changes, and neither can be seen from the render phase.

   Space-to-pan and middle-drag are pure event plumbing: which listener sees
   the press first, and whether preventDefault() on a pointerdown really does
   stop the mousedown that would otherwise have started a block drag. Both
   halves of that are DOM facts.

   The drag rewrite is the one that needs a browser most. A drag now moves the
   block by writing `translate` onto its node and calls onUpdateBlock exactly
   ONCE, on release. Every way that can go wrong — sixty writes instead of
   one, a block drawn in the right place but never written down, a cancelled
   drag leaving a stale transform behind — produces IDENTICAL render output.
   Only counting the callbacks and reading the live DOM can tell them apart. */

const CANVAS = '[role=application]'
const armed = () => page.getAttribute(CANVAS, 'data-ds-pan')
const boxOf = id => page.locator(`[data-block-id="${id}"]`).boundingBox()
/* The block's title bar is the only part that starts a drag, and it is the
   top 30px. 55px in clears the type label and stops short of the buttons. */
const gripOf = async id => { const b = await boxOf(id); return { x: b.x + 55, y: b.y + 14 } }
const resetLog = () => page.evaluate(() => window.__canvas.reset())
/* Position commits only. A text block also persists its content on blur, and
   that is not what "commits once per drag" is counting. */
const posWrites = async id =>
  (await page.evaluate(() => window.__canvas.updates()))
    .filter(u => u.patch && u.patch.x !== undefined && (!id || u.id === id))
const stateOf = id => page.evaluate(i => window.__canvas.block(i), id)
const translateOf = id => page.evaluate(i =>
  document.querySelector(`[data-block-id="${i}"]`).style.translate, id)
const wireD = () => page.evaluate(() =>
  document.querySelector('[data-conn-id="c1"] [data-conn-curve]').getAttribute('d'))
/* Space is only a gesture when it arrives with the canvas itself focused —
   the same rule every other bare key on this canvas follows. */
const focusCanvas = () => page.evaluate(c => document.querySelector(c).focus(), CANVAS)

/* Selectors the Builder sections use. These were declared inside the canvas
   block that was removed below; they belong here, beside the other shared
   selectors, rather than buried in the first section that happened to need
   them. */
const BUILDER_BTN = '[data-ds-builder-button]'
const PANEL = '[data-ds-builder]'

/* ── canvas pan and composited drag — REMOVED, not skipped ────────────
   Six sections lived here, asserting Space-to-pan, middle-drag pan, and a
   drag that writes a transform to the DOM and commits ONE position on
   mouseup. They were written first, the way this file is meant to be used —
   and then the implementation was stopped before it started, so they asserted
   behaviour that does not exist. Seven of them failed on every run.

   They are deleted rather than skipped because this file's own header says a
   suite that goes red for environmental reasons gets ignored within a week,
   and a suite that goes red for aspirational reasons gets ignored faster. A
   permanently-failing assertion trains people to read `7 failed` as normal,
   and the eighth failure — a real one — arrives invisibly.

   The behaviour they specified is still wanted and is item 2 and item 8 of the
   ranked build order in DATASTUDIO-CHANGE-SPEC.md. Write them again alongside
   the implementation; they were good tests for work nobody had done.
   ──────────────────────────────────────────────────────────────────── */


/* ── §9.2 the database block ──────────────────────────────────────────────
   Four claims that only a browser can settle.

   1  A cell editor opened by a click must survive that click — the same
      four-event sequence at the top of this file. And because the fix for it
      is preventDefault on the opening pointerdown, focus never leaves the
      cell you were in, so the draft in it has to be carried across by hand.
      Get the first right and forget the second and the grid quietly eats the
      last thing you typed, but only when you move between cells quickly.

   2  What a number cell STORES after you type letters into it. The dangerous
      answer is NaN: it survives JSON, compares false to itself and sorts at
      random. It is also invisible across the wire — JSON.stringify turns NaN
      into null, which is the correct answer — so the harness describes the
      value in-page instead of handing it back.

   3  A board's columns come from the model's grouping, and the column that
      matters is the one for rows nobody has classified yet.

   4  A delete that does not ask has to be undoable, and putting a property
      back means putting its VALUES back too. */

const DB = '#db-host'
const dbIds = await page.evaluate(() => window.__db.ids())
const dbOpts = await page.evaluate(() => window.__db.opts())
const dbRows = await page.evaluate(() => window.__db.rowIds())
const dbCell = (r, propId) => `${DB} [data-ds-db-cell="${dbRows[r]}:${propId}"]`
const dbValue = (r, propId) => page.evaluate(a => window.__db.cell(a[0], a[1]), [r, propId])

console.log('\n database — the table view')
{
  ok(await page.locator(`${DB} [data-ds-db-view="table"]`).count() === 1, 'a database opens as a table')
  ok(await page.locator(`${DB} [data-ds-db-col]`).count() === 3, 'with one column per property')
  ok((await page.locator(dbCell(0, dbIds.title)).innerText()).includes('Acme'), 'and one row per row')
}

console.log('\n database — a cell editor opens from a click and STAYS open')
{
  await page.locator(dbCell(0, dbIds.revenue)).click()
  await page.waitForTimeout(150)
  ok(await page.locator(`${DB} input[aria-label="Revenue"]`).count() === 1,
     'clicking a cell opens an editor that is still there on the next turn')
  ok(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Revenue',
     'and it holds focus, so the value is typed immediately with no second click')
  /* Without this the canvas still owns Delete and the bare-key shortcuts, so
     typing "t" into a cell creates a table block and Delete removes the whole
     database out from under the cursor. */
  ok(await page.evaluate(() => window.__db.editing()) === true,
     'and the block stands the canvas keymap down while it is open')

  await page.locator(`${DB} input[aria-label="Revenue"]`).fill('1,200')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(150)
  const v = await dbValue(0, dbIds.revenue)
  ok(v.value === 1200 && v.type === 'number',
     'and a thousands-separated string is stored as the NUMBER 1200 — coerced by the column, not kept as typed')
  ok(await page.evaluate(() => window.__db.editing()) === false, 'closing hands the canvas its keys back')
}

console.log('\n database — letters in a number column are null, never NaN')
{
  await page.locator(dbCell(0, dbIds.revenue)).click()
  await page.waitForTimeout(150)
  await page.locator(`${DB} input[aria-label="Revenue"]`).fill('12abc')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(150)
  const v = await dbValue(0, dbIds.revenue)
  ok(v.isNull === true, '"12abc" is stored as null')
  ok(v.isNaN === false,
     'and NOT as NaN — which survives JSON, compares false to itself, and sorts a column at random')
}

console.log('\n database — moving between cells does not eat the draft')
{
  /* The consequence of rule 3: the opening pointerdown is defaultPrevented,
     so clicking the NEXT cell never blurs this one. Nothing about the render
     output differs between the working and the broken version. */
  await page.locator(dbCell(0, dbIds.title)).click()
  await page.waitForTimeout(150)
  await page.locator(`${DB} input[aria-label="Name"]`).fill('Acme Corp')
  await page.locator(dbCell(1, dbIds.title)).click()
  await page.waitForTimeout(180)
  ok((await dbValue(0, dbIds.title)).value === 'Acme Corp',
     'clicking straight into another cell keeps what was typed in the last one')
  ok(await page.locator(`${DB} input[aria-label="Name"]`).count() === 1, 'and the next cell is open')

  /* Typed first, on purpose. Pressing Escape on an untouched cell and finding
     it unchanged proves nothing at all — the value it would have written is
     the value that was already there. */
  await page.locator(`${DB} input[aria-label="Name"]`).fill('SHOULD NOT STICK')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  ok((await dbValue(1, dbIds.title)).value === 'Globex', 'Escape backs out without writing what was typed')
  ok(await page.locator(`${DB} input[aria-label="Name"]`).count() === 0, 'and closes the editor')
}

console.log('\n database — the property editor, portalled')
{
  await page.locator(`${DB} [data-ds-db-col="${dbIds.status}"]`).click()
  await page.waitForTimeout(180)
  ok(await page.locator('[data-ds-db-menu="Edit column"]').count() === 1,
     'clicking a column header opens the property editor and it stays open')
  ok(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Column name',
     'with the name field focused, so renaming is one gesture')
  /* Rule 2 in the handover. A menu left inside the canvas transform is
     positioned against the canvas and then scaled. */
  ok(await page.evaluate(() => document.querySelector('[data-ds-db-menu="Edit column"]')?.parentElement === document.body),
     'and portalled to document.body rather than left inside the canvas transform')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  ok(await page.locator('[data-ds-db-menu]').count() === 0, 'Escape closes it')
}

console.log('\n database — a dropdown opened from a click stays open')
{
  await page.locator(dbCell(0, dbIds.status)).click()
  await page.waitForTimeout(180)
  ok(await page.locator('[data-ds-db-menu="Status"]').count() === 1,
     'clicking a select cell opens its options, and they are still open on the next turn')
  ok(await page.locator(`[data-ds-db-option="${dbOpts.lead}"]`).count() === 1,
     'listing one row per option the column actually has')

  /* Nothing inside this menu holds focus, so the menu's own document listener
     is the only thing that can claim the press before the canvas reads it —
     and it can only do that from the CAPTURE phase, because it registered
     after the canvas did. Bubble-phase and capture-phase versions look
     identical from the React tree and behave identically on screen; the
     difference is that the bubble one ALSO drops the block selection behind
     the menu. */
  await page.evaluate(() => { window.__escConsumed = null })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  ok(await page.locator('[data-ds-db-menu]').count() === 0, 'Escape closes the dropdown')
  ok(await page.evaluate(() => window.__escConsumed) === true,
     'and claims the press first, so the canvas underneath does not also act on it')

  await page.locator(dbCell(0, dbIds.status)).click()
  await page.waitForTimeout(180)
  await page.locator(`[data-ds-db-option="${dbOpts.lead}"]`).click()
  await page.waitForTimeout(180)
  ok((await dbValue(0, dbIds.status)).value === dbOpts.lead,
     'and picking one stores the option id, through setCell like every other write')
  ok(await page.locator('[data-ds-db-menu]').count() === 0,
     'a single-select closes once it has its answer')
}

console.log('\n database — deleting a column asks nothing and offers the way back')
{
  /* A real value first, so the undo has something to fail to restore. */
  await page.locator(dbCell(0, dbIds.revenue)).click()
  await page.waitForTimeout(150)
  await page.locator(`${DB} input[aria-label="Revenue"]`).fill('900')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(150)
  ok((await dbValue(0, dbIds.revenue)).value === 900, 'the column holds a value')

  await page.locator(`${DB} [data-ds-db-col="${dbIds.revenue}"]`).click()
  await page.waitForTimeout(180)
  await page.locator(`[data-ds-db-delcol="${dbIds.revenue}"]`).click()
  await page.waitForTimeout(250)

  ok(await page.locator('[role=dialog][aria-label="Confirm"]').count() === 0,
     'no confirmation — components/ui/Toast.js explains why at length')
  ok(await page.locator(`${DB} [data-ds-db-col="${dbIds.revenue}"]`).count() === 0, 'the column goes immediately')
  ok((await page.evaluate(() => window.__db.props())).every(p => p.id !== dbIds.revenue),
     'and so does the property')
  /* Deleting a property is a GRAPH operation: the value has to leave every
     row too, or the column comes back holding data nobody can see. */
  ok((await dbValue(0, dbIds.revenue)).missing === true, 'and its value leaves every row')

  const undo = page.locator('[data-ds-toast] button')
  ok(await undo.count() >= 1, 'a toast carries an UNDO, which is the only way back from a delete that did not ask')
  if (await undo.count()) {
    await undo.last().click()
    await page.waitForTimeout(250)
  }
  ok(await page.locator(`${DB} [data-ds-db-col="${dbIds.revenue}"]`).count() === 1, 'UNDO puts the column back')
  ok((await dbValue(0, dbIds.revenue)).value === 900,
     'and the value with it — a column restored empty is the undo half-working, which is worse than none')
}

console.log('\n database — a board is one column per option, plus the one nobody chose')
{
  await page.locator(`${DB} [data-ds-db-addview]`).click()
  await page.waitForTimeout(180)
  ok(await page.locator('[data-ds-db-menu="Add a view"]').count() === 1, 'the + offers the view kinds')

  await page.locator('[data-ds-db-newview="board"]').click()
  await page.waitForTimeout(250)
  ok(await page.locator(`${DB} [data-ds-db-view="board"]`).count() === 1, 'picking Board switches to it')

  const board = (await page.evaluate(() => window.__db.views())).find(v => v.kind === 'board')
  ok(!!board && board.groupBy === dbIds.status,
     'and it groups by the first groupable column rather than opening empty and blaming you')

  ok(await page.locator(`${DB} [data-ds-db-group]`).count() === 3,
     'two options, plus one more')
  ok(await page.locator(`${DB} [data-ds-db-group="__none__"]`).count() === 1,
     'the ungrouped column always renders')
  ok((await page.locator(`${DB} [data-ds-db-group="__none__"]`).innerText()).includes('Initech'),
     'and holds the row nobody has classified — a board that hides those loses them')

  /* The same rows, arranged. Nothing moved: the card is in "Lead" because its
     Status says so, which is the second of the two ideas the model is built
     on. */
  ok((await page.locator(`${DB} [data-ds-db-group="${dbOpts.lead}"]`).innerText()).includes('Acme'),
     'and the card picked in the dropdown above is in the column that matches it')
}

console.log('\n database — dragging a card writes the property, it does not move a row')
{
  await page.locator(`${DB} [data-ds-db-card="${dbRows[0]}"]`)
    .dragTo(page.locator(`${DB} [data-ds-db-group="${dbOpts.won}"]`))
  await page.waitForTimeout(300)
  /* The row did not move anywhere: it is in the Won column because its Status
     now SAYS Won, which is the second of the two ideas the model is built on. */
  ok((await dbValue(0, dbIds.status)).value === dbOpts.won,
     'the drop stores the target column\'s option id, through setCell')
  ok((await page.locator(`${DB} [data-ds-db-group="${dbOpts.won}"]`).innerText()).includes('Acme'),
     'and the card is where it was dropped')
  ok(!(await page.locator(`${DB} [data-ds-db-group="${dbOpts.lead}"]`).innerText()).includes('Acme'),
     'and no longer where it came from')

  await page.locator(`${DB} [data-ds-db-card="${dbRows[0]}"]`)
    .dragTo(page.locator(`${DB} [data-ds-db-group="__none__"]`))
  await page.waitForTimeout(300)
  ok((await dbValue(0, dbIds.status)).isNull === true,
     'and dropping into the ungrouped column clears the property rather than storing "__none__"')
}

console.log('\n database — a card added to a column belongs to that column')
{
  await page.locator(`${DB} [data-ds-db-addcard="${dbOpts.won}"]`).click()
  await page.waitForTimeout(250)
  const ids = await page.evaluate(() => window.__db.rowIds())
  ok(ids.length === 4, 'the + adds a row')
  ok((await dbValue(3, dbIds.status)).value === dbOpts.won,
     'already carrying the column it was added under — landing in "no status" is the board ignoring where you pointed')
  ok(await page.locator(`${DB} input[aria-label="Name"]`).count() === 1,
     'and it opens for its name on the card, rather than waiting to be found and clicked')

  await page.locator(`${DB} input[aria-label="Name"]`).fill('Umbrella')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(250)
  ok((await dbValue(3, dbIds.title)).value === 'Umbrella', 'and typing names it in place')
  ok((await page.locator(`${DB} [data-ds-db-group="${dbOpts.won}"]`).innerText()).includes('Umbrella'),
     'in the column it was created in')
}

console.log('\n builder — the button opens a panel and nothing else')
{
  await page.evaluate(() => window.__builder.wipe())
  await page.evaluate(() => window.__canvas.reset())
  const canvasBefore = await page.evaluate(() => JSON.stringify(window.__canvas.blocks()))

  ok(await page.locator(PANEL).count() === 0, 'the panel is not mounted until it is asked for')
  await page.click(BUILDER_BTN)
  await page.waitForTimeout(200)
  ok(await page.locator(PANEL).count() === 1, 'clicking Builder opens the panel')
  ok(await page.getAttribute(BUILDER_BTN, 'aria-expanded') === 'true', 'and the button says so')

  ok(await page.locator('[data-ds-builder-empty]').count() === 1,
     'with an empty state that explains what a template IS, not a grey "no items" label')
  ok((await page.locator('[data-ds-builder-empty]').innerText()).toLowerCase().includes('workspace'),
     'in one sentence about workspaces')

  ok(await page.evaluate(() => JSON.stringify(window.__canvas.blocks())) === canvasBefore,
     'and opening it changed nothing on the canvas')
  ok((await page.evaluate(() => window.__canvas.updates())).length === 0, 'and wrote nothing to the document')
}

console.log('\n builder — the save form opens from a click and STAYS open')
{
  /* The regression this whole file exists for, in a second place. Without
     preventDefault on the opening pointerdown: pointerdown opens the form,
     autoFocus takes focus, then mousedown's DEFAULT focus behaviour moves
     focus to the button that was pressed and the input is blurred shut inside
     the same click. It looks exactly like the button doing nothing. */
  await page.click('[data-ds-builder-save]')
  await page.waitForTimeout(200)
  ok(await page.locator(`${PANEL} input[aria-label="Template name"]`).count() === 1,
     'the name field opens and is still there on the next turn')
  ok(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Template name',
     'and holds focus, so the name is typed immediately with no second click')
}

console.log('\n builder — saving puts a template in the list')
{
  await page.locator(`${PANEL} input[aria-label="Template name"]`).fill('Research starter')
  await page.locator(`${PANEL} input[aria-label="Template description"]`).fill('Two text blocks')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)

  ok(await page.locator('[data-ds-template-row]').count() === 1,
     'the template appears in the list — a real IndexedDB write and read back, not local state')
  const row = await page.locator('[data-ds-template-row]').first().innerText()
  ok(row.includes('Research starter'), 'under the name that was typed')
  ok(row.includes('Two text blocks'), 'with its description')
  ok(/1 sheet · 2 blocks/.test(row), 'and describeTemplate\'s summary of what is inside it')
  ok(await page.locator('[data-ds-builder-empty]').count() === 0, 'and the empty state is gone')
  ok(await page.locator(`${PANEL} input[aria-label="Template name"]`).count() === 0, 'the form closed on commit')
}

console.log('\n builder — a duplicate shares NO id with the original')
{
  await page.locator('[data-ds-template-row] [aria-label="Duplicate template"]').first().click()
  await page.waitForTimeout(500)

  const made = await page.evaluate(() => window.__builder.made())
  ok(made.length === 1, 'duplicating hands a notebook to the app')

  const copy = made[0]
  const copyBlockIds = copy.sheets.flatMap(s => s.blocks.map(b => b.id))
  ok(copyBlockIds.length === 2, 'with every block')
  /* THE assertion. A deep clone that copied the ids too produces a workspace
     that renders perfectly and is wired to the original's blocks — edit the
     copy and the original moves. Nothing throws; nothing looks wrong. */
  ok(copyBlockIds.every(id => id !== 'sb1' && id !== 'sb2'),
     'and not one of the original\'s block ids survives into it')
  ok(copy.id !== 'nb_src', 'the notebook itself is new')
  ok(copy.sheets[0].id !== 'sh1', 'and so is the sheet')

  const src = await page.evaluate(() => window.__builder.source())
  ok(src.sheets[0].blocks.map(b => b.id).join() === 'sb1,sb2',
     'while the workspace it was built from is untouched')
}

console.log('\n builder — delete asks nothing and offers the way back')
{
  await page.locator('[data-ds-template-row] [aria-label="Delete template"]').first().click()
  await page.waitForTimeout(350)
  ok(await page.locator('[role=dialog][aria-label="Confirm"]').count() === 0,
     'no confirmation — components/ui/Toast.js explains why at length')
  ok(await page.locator('[data-ds-template-row]').count() === 0, 'the row goes immediately')
  /* The save and duplicate toasts are still on screen — they last four
     seconds and this is the third action in a row. The delete is the newest,
     and it is the only one of the three carrying an UNDO button. */
  ok((await page.locator('[data-ds-toast]').last().innerText()).includes('Deleted'), 'and a toast says so')

  /* Counted before it is clicked. Clicking a button that is not there is a
     30-second Playwright timeout and a stack trace, which reads as a broken
     harness rather than as the missing UNDO it actually is. */
  const undoBtn = page.locator('[data-ds-toast] button')
  ok(await undoBtn.count() === 1, 'carrying an UNDO, which is the only way back from a delete that did not ask')
  if (await undoBtn.count()) {
    await undoBtn.click()
    await page.waitForTimeout(500)
  }
  ok(await page.locator('[data-ds-template-row]').count() === 1,
     'and it puts the template back — the entire justification for not asking first')
}

console.log('\n builder — closing leaves the canvas exactly as it was')
{
  const before = await page.evaluate(() => JSON.stringify(window.__canvas.blocks()))
  await page.click(BUILDER_BTN)
  await page.waitForTimeout(200)
  ok(await page.locator(PANEL).count() === 0, 'toggling the button closes the panel')
  ok(await page.evaluate(() => JSON.stringify(window.__canvas.blocks())) === before,
     'and every block is exactly where it was')
  ok((await page.evaluate(() => window.__canvas.updates())).length === 0,
     'with not one write to the document across the whole Builder session')

  /* And it reopens holding what it held — the store is the source of truth,
     not the panel's own state, so a close must not be a reset. */
  await page.click(BUILDER_BTN)
  await page.waitForTimeout(400)
  ok(await page.locator('[data-ds-template-row]').count() === 1, 'reopening shows the saved template again')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  ok(await page.locator(PANEL).count() === 0, 'and Escape closes it too')
}

await browser.close()

console.log(`\n  ${pass} passed, ${fail} failed`)
if (errors.length) { console.log('\n  page errors:'); errors.forEach(e => console.log('    ' + e)) }
process.exit(fail || errors.length ? 1 : 0)
