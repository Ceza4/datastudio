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
