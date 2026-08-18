# DataStudio — handover

**Read this before writing code.** Companion to `DATASTUDIO_CONTEXT.md`, which
describes the codebase; this describes the *state* of it.

Base commit: `b39e05b` on `main`. Everything below is uncommitted on top.

---

## 1. The correction that matters most

Previous versions of this file opened with:

> **`next build` has never been run successfully.** Not once. The Linux SWC
> binary core-dumps.

**That was wrong, and it was wrong for months.** The build works and always
did. It was verified on 12 Aug 2026 on Linux x86_64, glibc 2.39, Node 22:

```
▲ Next.js 16.1.7 (Turbopack)
✓ Compiled successfully in 13.5s
✓ Generating static pages (7/7)
exit 0
```

The single blocker was `app/layout.js` importing from `next/font/google`, which
fetches Inter and DM Mono from `fonts.googleapis.com` **at build time**. Any
environment without open egress to Google — a sandbox, a CI runner, an offline
laptop — fails with four font errors and nothing else. Someone read that as a
compiler crash, wrote it down, and four months of work was built on top of an
assumption nobody retested.

Fonts are now self-hosted in `app/fonts/` (78 KB, `next/font/local`, no new
dependency, same CSS variable names). **Do not reintroduce
`next/font/google`.**

The lesson is not about fonts. Re-verify an inherited blocker before you plan
around it.

---

## 2. Run these

```bash
npm install          # postinstall syncs the pdf.js worker
npm test             # 16 suites, 1058 assertions, ~4s
npm run check        # 3 static guards
npm run test:browser # 65 assertions in real Chromium — skips cleanly if absent
npm run lint         # 24 known problems, all pre-existing
npm run build        # exit 0
```

These numbers were four months stale when they were last read. If yours
disagree, re-measure before planning around them — see section 1.

`npm run check` is three guards, each written after a real bug and each
verified to fail when its bug returns. **Never delete one to go green.**

---

## 3. What changed on 12 Aug 2026

### Correctness — tasks and calendar were wrong, not just plain

`deadlineState` measured deadlines in milliseconds (`Math.round(diff /
86_400_000)`), which is rule 7 violated inside the file the rule was written
for. Reproduced against the shipped code in `Europe/Kiev`:

```
deadline 2026-08-12
  now 12 Aug 18:00 -> soon    "Due in 6h"
  now 13 Aug 00:30 -> overdue "Due today"    <- deadline was YESTERDAY
  now 13 Aug 09:30 -> overdue "Due today"    <- still yesterday
  now 13 Aug 12:01 -> overdue "1d overdue"
```

`"Due today"` was **unreachable on the day a task was due** and displayed for
twelve hours the morning after. Every overdue count was one short. The `later`
chip changed at midday without the deadline moving. The 48-hour `soon` window
crossed on the wrong day twice a year — 27 March in Kiev is 23 hours long.

Now measured with `daysBetween`, which snaps both timestamps to local midnight
*before* dividing. 8 timezones in the suite, including half-hour offsets and
DST-at-midnight zones.

`parseDate` only ever handled `YYYY-MM-DD`; everything else fell through to
`new Date(s)`:

```
"46266"      -> Mon Jan 01 46266    <- an Excel date column
"12.08.2026" -> Tue Dec 08 2026     <- European format, off by four months
"2026-02-30" -> Mon Mar 02 2026     <- invalid date laundered into a real one
"2026-00-10" -> Wed Dec 10 2025     <- a year backwards
```

The first is the bad one. `sheet_to_json` had no `cellDates: true`, so Excel
date cells arrived as serials — and `dateColumns` still rated the column
**confidence 1.0**, so the rail offered it, the user switched it on, and the
calendar rendered empty with no error. The headline calendar feature failing
silently on the most common input there is.

Both blocks now also re-render at local midnight; a tab left open overnight
used to keep yesterday's answer.

### Performance — measured, not guessed

| | was |
|---|---|
| `findBacklinks` per canvas render | **8.4 ms at 80 blocks** — O(visible × total), memo never held during a drag |
| `saveState` | **1.58 s at 200k rows** — stringify, parse, stringify again, on top of IndexedDB's own clone |
| `Cell` in `TextBlockToolbar` | 17 buttons remounted **every drag frame** — which is why hover highlight fell off a button you were still on |

### Security

`lib/urls.js` — the allowlist every outbound URL passes. `http`, `https`,
`mailto`, nothing else, control characters stripped first because browsers
strip them *before* reading the scheme, so `java<TAB>script:` executes against
any validator that doesn't. Plus `noopener` on ctrl-click, which was missing.

### PDF — editing existing text

`lib/pdfreplace.js` + the `replace` edit kind. Cover the run in the page's own
sampled colour, redraw on the same baseline. Not reflow: following lines do not
move. Overlong text shrinks to 60% then is **refused** rather than overlapping
the line below.

**Note the roadmap error this corrects:** previous handovers listed "§4 PDF
stage 3 — edit existing text" as outstanding. `DATASTUDIO-PDF-PLAN.md` says
stage 3 is *page operations* (reorder, rotate, delete, extract, merge, split,
~1 week) and that editing text is **stage 5**, scoped at 6–12 months and gated
on evidence. What shipped is the tractable 80% of stage 5. **Page operations
are still unbuilt.**

### Testing — the blind spot has a floor now

`npm run test:browser`. Written because clicking a line of PDF text did nothing
and no unit test could see why:

```
pointerdown on layer   → editor opens, autoFocus takes focus
focusin  on INPUT
mousedown on layer     → mousedown's DEFAULT focus behaviour
focusout on INPUT        moves focus back → onBlur → commit → closed
```

The editor opened and shut inside one click. One `preventDefault()` on the
opening pointerdown. The same bug was in the "Add text" tool, where it looked
like nothing happening because committing empty text is a silent no-op.

---

## 4. Known gaps, in the order they should worry you

1. **Nothing is committed.** ~57 files on `main`, one Windows machine, no
   branch, no remote copy. The remote is still `b39e05b`. One `git checkout`
   ends it. Suggested: `git checkout -b feat/pdf-tasks-calendar`
2. **`blocksToHtml` can MANUFACTURE a `<script>` tag** from input containing
   none — `String.replace` splices and never rescans, so
   `<sc<script>x</script>ript>alert(1)…` becomes a real tag. `exportPdf` then
   `document.write`s the result into `window.open('')`, which inherits this
   origin and therefore the whole IndexedDB. Harmless while the content is
   yours; **must** become a `DOMParser` allowlist before §9 templates
3. **Effects, refs and layout are still mostly untested.** The browser suite
   covers the PDF text editor only. The canvas coordinate handlers are the
   obvious next target — five of the six historical bugs live there
4. **PDF page operations** — the plan's real stage 3, ~1 week
5. 21 lint problems, all pre-existing. `set-state-in-effect` in `BlockPicker`
   and `ImageBlock` are the two worth reading
6. No `--ds-on-accent` token; `color: '#fff'` on accent appears in six files
7. `react-window` is a dependency, imported nowhere
8. Planning docs live one level above the repo, untracked

---

## 5. If you are a new agent starting here

1. `npm install && npm test && npm run check && npm run build`
2. Read `DATASTUDIO_CONTEXT.md`, then `lib/canvasgeom.js` and
   `lib/renderqueue.js` in full — they encode six bugs' worth of context in
   ~200 lines
3. **Check the source note before building a spec section.** The spec is an
   earlier agent's expansion of Matas's notes, not his words. §12 Trader in
   particular is enormous relative to the note behind it, and the PDF stage
   numbering was already wrong once
4. **Say what you verified and what you didn't. Every time.** And re-verify an
   inherited blocker before planning around it — see section 1
