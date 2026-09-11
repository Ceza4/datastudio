# Deferred Features

These features were considered during the polish pass but explicitly NOT built. Each one is documented here so future-Claude (or your collaborator) can pick them up properly when there's time, instead of finding a half-built version and getting confused.

## 1. Image upload (canvas + text blocks) — ✅ BUILT

**Status: shipped.** The architectural questions below were answered as follows.

- **Storage:** IndexedDB, as recommended. `lib/idb.js` is a ~120-line dependency-free
  wrapper with two object stores: `state` (one workspace snapshot) and `images`
  (one Blob per image). Blocks carry only an `imageId`, so autosave never
  rewrites pixels and loading a workspace doesn't deserialise megabytes to draw
  a text block. Orphaned image records are pruned after every successful save.
- **Formats:** PNG, JPEG, WebP, GIF, AVIF, BMP. **SVG is rejected by design** —
  it's XML and can carry `<script>`, external entities and `foreignObject` HTML.
- **Max size:** 2MB *after* processing, not 5MB. Hosted competitors cap at 5MB
  because they have object storage; this has the browser's disk quota. Oversized
  images are downscaled to fit a 2400px longest edge and re-encoded down a
  quality ladder rather than being refused.
- **Validation:** magic bytes, not the extension or the MIME type — both are
  attacker-controlled. `photo.png` containing HTML is rejected.
- **Sanitisation:** everything is re-encoded through a canvas, which discards
  EXIF (including GPS coordinates), colour-profile payloads and any appended
  polyglot data. The one casualty is animated GIFs, which flatten to one frame.
- **Text blocks:** images are a separate `ImageBlock`, *not* inlined into
  contentEditable — the original recommendation, and it avoids the known
  cursor/selection bugs with inline `<img>`.
- **Export:** text formats reference the image and carry its alt text rather
  than embedding bytes. Embedding in DOCX/PPTX is still open.

**Still open:** embedding image bytes into exported Word/PowerPoint files, and
drag-and-drop of images onto the canvas (import is via the file picker today).

---

## 1b. Original notes, kept for context

**Why it was deferred:** This is a feature, not polish. Doing it right requires answering questions polish work shouldn't have to answer.

**Architectural questions to answer first:**
- Where do images get stored? Three real options:
  - **Base64 in block state** — works without a backend, but localStorage's 5–10MB quota dies fast. A single 2MB photo at base64 inflation (~1.37x) becomes ~2.7MB. Two photos = persistence broken.
  - **Supabase Storage** — proper solution. Needs auth, signed URLs, cleanup on delete, public/private decisions. ~2 days of work.
  - **Browser IndexedDB** — bigger quota than localStorage (50MB+), still no backend needed. Good middle ground but adds complexity to the persistence layer.
- What image formats are allowed? PNG/JPG/WebP only? SVG (security risk: can contain scripts)?
- What's the max file size? 2MB? 5MB? 10MB?
- How do images render inside text blocks specifically? Inline `<img>` tags inside contentEditable have known cursor/selection bugs. May need a custom block type instead.
- What happens when a notebook with images is exported? Embedded? Referenced?

**Recommended path when you build it:** Start with IndexedDB + a separate `ImageBlock` type for the notebook (don't try to inline images inside text blocks). Canvas integration comes after notebook works.

## 2. Email tracking on hyperlinks

**Why deferred:** Not polish, not even a feature — this is an entire mini-product.

**What it would actually require:**
- A tracking endpoint (e.g. `track.datastudio.app/click?id=...`) that logs the click and 302-redirects to the real URL
- A database table for tracked links, click events, timestamps, IP/user agent
- A UI to view tracking results per link
- GDPR/privacy considerations — you'd need a privacy policy update at minimum, possibly explicit user consent
- Decisions about what data is logged, retention period, deletion
- Anti-abuse measures (someone could use it to track unsuspecting recipients of unrelated emails)

**Recommended path when you build it:** Build the tracking endpoint and DB table first, separately from DataStudio. Get one working "tracked link" → "click logged" → "see results" loop end-to-end. Only then add the "create tracked link" UI inside DataStudio. This is at least a week of focused work.

## 3. Sheet content actually switching in Preview mode

**Why deferred:** Mentioned in the original handoff brief as TODO. It's a real feature but not polish — it touches how preview rendering reads from the file/sheet structure. Defer until someone actively wants to use multi-sheet preview.

## 4. Right-click column header context menu

**Why deferred:** Listed in the handoff brief. Moderate scope (need to design the menu, decide what items go in it — clean/sort/duplicate/rename/delete?), and not blocking anyone. Add it when there's a clear use case driving the menu's exact contents.

## 5. Editable preview mode (turn imported sheets into editable spreadsheets)

**Why deferred:** This came up while discussing the "+ New Sheet" button. The simple version (create blank file → drag columns to canvas to edit) is what we built. The bigger vision (preview mode itself becomes editable, like opening a real spreadsheet) is a separate feature with its own architectural decisions:
- Does editing in preview also change the canvas state if it references the same column?
- How do you add rows/columns directly in preview view?
- What does "save" mean for an in-app sheet that was never imported from a file?

If you want this later, build a clear distinction between "imported file" (read-only) and "DataStudio sheet" (editable), and only allow editing on the second type.

## 6. Undo/redo for canvas actions

**Why never on the list:** Not requested, but you'll want it eventually. This is hard to retrofit and easy to design wrong. When you're ready, the right pattern is a command history (every state change is a Command object with undo/redo methods), not snapshotting state. Snapshotting works for small apps but explodes memory once your canvases have any size.

## The React Compiler can now see into the two biggest files (Aug 24)

`npm run lint` went from 48 errors to 53 during the audit-fix pass, and the
increase is not new breakage — it is newly VISIBLE debt.

The `react-hooks/*` rules come from the React Compiler, which stops analysing a
component as soon as it hits something it cannot reason about. Both
`app/app/page.js` and `components/notebook/NotebookCanvas.js` assigned a ref
during render (`historyRef.current = history`, `latestRef.current = {...}`), and
that was enough to make the compiler bail out early. Removing those two writes
let it read the rest of both files, at which point it reported everything it
found there.

Verified line by line: **15 of 16** new `purity` diagnostics in `page.js` and
**8 of 9** in `NotebookCanvas.js` are byte-identical to lines that exist in the
pre-audit baseline. The two that were genuinely new have been fixed.

What is left is one real category, worth doing properly rather than silencing:

  · `Date.now()` and `Math.random()` called inside component-scope functions —
    id generation, random block placement, timestamps. Correct at runtime
    (they only run from event handlers) but impure by the compiler's rules, so
    they block optimisation of everything after them. The fix is to hoist them
    to module scope taking what they need as arguments, the way `_graceAssets`
    in `app/app/page.js` now does.

  · `set-state-in-effect` in six places in `NotebookCanvas.js` — derived state
    that should be computed during render instead.

Neither is a defect today. Both are why those two files are hard to optimise.

---

## Sep 9 design pass — what shipped, and what is still open

All ten surfaces from `claude/DESIGN_PASS_SEP09_INDEX.md` are built. This
section records only the parts that were deliberately NOT built, so nobody
re-derives a decision that was already made — or assumes something is done
because its surface is.

### Genuinely open, needs a decision before it can be built

  · **Columns' runtime behaviour.** The type is registered, in both menus, and
    renders as a container with `columnCount` guide lines — enough that
    inserting it is not an invisible no-op. It does NOT lay its children out
    into the columns. Three questions block that: does inserting prompt for a
    count or default to 2; can columns be added or removed after creation; does
    it nest inside a `section` or are the two mutually exclusive containers?

  · **The "Teams" affordance** in the People panel — an org-wide member list,
    one-click group-chat-everyone, or something else. Declared and SOON-chipped.

  · **"Add a friend"** — email, username or link. Same treatment.

  · **Group chat through existing grants.** The chat model already follows
    whoever holds a live grant on a block, which MAY mean sharing one block with
    several people produces a group thread for free. Not verified against the
    real grant/membership code, so not claimed.

  · **The escalation notice.** A transient SyncChip-styled "You and {name} are
    both editing this" the first time a block escalates. Recommended, not in the
    original doc, and flagged there as the first thing to cut. Cut. The border
    and glow carry the signal on their own.

  · **Caret colour.** `caret-color: var(--ds-accent)` is now bound on both
    editable surfaces. The open question was never the hex — it is whether a
    1-2px accent line reads well at that colour, which is answered by looking at
    it in both themes, not by a spec. Keep or delete one line.

### Deliberately not copied, with reasons

  · **A zoom slider in the Document's status bar.** Word has one; it scales the
    page independently of everything else. On an infinite canvas "how big does
    this block look" is already answered by the canvas's own zoom (0.25×–3×),
    and a second differently-scoped zoom on the same block creates a question a
    user has to learn the answer to. See the note in `DocumentRibbon.js`.

  · **Dynamic PDF re-render on zoom.** Unnecessary: the canvas zoom is hard-
    capped at 3× in the wheel handler, so a fixed 3× over-render covers every
    level the UI allows. See `CANVAS_ZOOM_MAX` in `lib/pdfspace.js`.

  · **Live-linked (auto-updating) shared blocks.** A reference card dragged onto
    a canvas becomes a real editable block via `clonepatch`/`createBlock` — a
    SNAPSHOT. It does not update when the source changes, for the same reason a
    duplicate does not. Auto-updating is a separate, bigger ask and nothing in
    this pass builds toward it; it still needs the NotebookCanvas renderer-switch
    extraction the original note described.

  · **Lane colour on kanban.** The confirmed prototype had a coloured dot beside
    one lane with no handler and no state behind it. Read as prototype flavour
    rather than a specified feature; building it means a new `lane.color` field
    and a picker nothing has asked for.

### Corrections to the handoff, found by grounding it in the code

  · **A `.docx` writer was already in the stack.** The handoff proposed
    evaluating the `docx` npm package on the basis that none existed.
    `lib/exporters.js` has had a real OOXML writer since the export panel
    shipped, on `lib/zip.js`. `lib/docexport.js` extends it; no dependency was
    added. See that file's header.

  · **PDF export does not use pdf-lib, and should not.** pdf-lib draws text at
    coordinates; flowing headings, wrapped paragraphs and lists across pages
    with correct metrics means writing a layout engine — the exact thing the
    continuous-scroll design exists to avoid. It goes through the browser's
    print engine, which already has the metrics and does the real breaking.

  · **There was never an "auto-extract" feature to remove from the PDF block.**
    Extraction has always required an explicit Add-block click. What read as
    sloppy was `detectTable`'s column-clustering heuristic behind the panel's
    Auto/Table tabs, and that is what was cut.

  · **The hardcoded `#5B5FE8` checklist accent was not actually rendering
    wrong.** A `!important` rule in `TextBlockContent`'s scoped stylesheet has
    been overriding it for stored checklists all along. The literals are gone
    from both call sites so that rule's own comment is true — but the third
    instance, `[data-ds-text] a { color: #5B5FE8 }`, had no such rule saving it
    and WAS wrong in light mode. Now `var(--ds-accent-text)`.

  · **`create()` does NOT write `displayMode: 'full'`,** despite the spec asking
    for it. `tests/registry.equivalence.test.mjs` exists to catch exactly that
    kind of persisted-shape change, and absent already means 'full' via
    `displayModeOf()` — so there is no migration and no shape change.

  · **Columns' `order` appends (12), it is not 4.5.** The registry test asserts
    the original five keep their exact menu positions. The adjacency a
    fractional order was reaching for is `menuGroup: 'organize'` instead: group
    expresses meaning, order expresses stability.

### Icons still to draw

Everything below ships with a deliberate placeholder and a comment saying so.
None blocks anything; swap through the usual pipeline (`SVG → icons folder →
npm run icons`, never hand-edit `icon-paths.js`).

  · Columns — using `block-section`.
  · Document — using `format-word`.
  · Image display toggle — using `format-image` / `block-image`.
  · Alignment × 4 — drawn inline as CSS bars in `DocumentRibbon.js` rather than
    reusing one existing icon four times, which would have said the four
    controls do the same thing.
  · Superscript / subscript — drawn as `x²`/`x₂` letterforms, same reasoning as
    the B/I/U/S glyphs.

### One new lint report

`npm run lint` goes from 45 errors to 46. The extra one is a second
`preserve-manual-memoization` report on `NotebookCanvas.js`, from the `useMemo`
that filters floating chat blocks out of the sheet. It is another report of a
condition the file already had — that component was already "Compilation
Skipped" in the baseline — not a new defect. Written as a single expression
specifically because a `.some()` short-circuit version made it worse.
