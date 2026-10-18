# Icon audit — 18 Oct 2026

Base: `audit/reliability-oct16` (`7c2449d`). Method: every icon name traced to
every call site and its label (static), then every top-level surface opened in
Chromium against the e2e Supabase double and screenshotted (visual).

## 0. The source folder is now in the repo

`icons/*.svg` did not exist in git. `npm run icons` pointed at `../../icons`,
one laptop away from being lost, and `block-flashcards` had already been
hand-added to the generated file because of it. The 130 SVGs were recreated
from `components/ui/icon-paths.js`; a rebuild reproduces every path exactly.
From now on: edit `icons/*.svg`, run `npm run icons`, commit both.

## 1. Broken: two icons that looked like other icons

| Icon | Problem | Fix |
|---|---|---|
| `settings-gear` | Drawn as a sun, near-identical to `theme-light`. The top bar's **Settings** showed a sun. | Redrawn as an 8-tooth gear |
| `block-flashcards` | Two stacked squares, near-identical to `action-duplicate` | Redrawn as a landscape card over a second card |
| `draw-exit`, `status-error`, `cc-unmatched` | **Byte-identical** (circle with X) | `draw-exit` call sites moved to `action-close`; the three files are left for now, see §5 |

## 2. Wrong meaning: X meant both "delete" and "close"

`action-delete` was an X and was used 32 times: for deleting projects, sheets,
blocks and data, AND for closing panels, unpinning and exiting modes. The trash
can existed, but only as `draw-clear`.

- `action-delete` → now the trash can (permanent removal)
- new `action-close` → the X (dismiss, unpin, remove a chip, exit a mode)

Moved to `action-close`: Agent unpin and close, Crosscheck close, mind-map exit,
draw-mode Exit, image crop Cancel, People conversation close, Flashcards remove
link and remove attachment, Task clear deadline. Missing file chip → `status-error`.

## 3. Borrowed: one icon standing in for an unrelated thing

| Where | Was | Now |
|---|---|---|
| Top bar: Builder | `action-duplicate` | `nav-builder` (new) |
| Block: Document | `format-word` (page with W) | `block-document` (new) |
| Block: Calendar; database Date and Calendar view | `status-info` (ⓘ) | `block-calendar` (new) |
| Block: Database | `block-table` | `block-database` (new) |
| Block: Chat | `share-people` | `block-chat` (new) |
| Block: File; unknown file type | `block-text` (Notes) | `block-file` (new) |
| Block: Countdown | `history-version` (Version history) | `block-countdown` (new) |
| Block: Pipeline | `block-kanban` | `block-pipeline` (new) |
| Block: Record | `nav-notebook` (Project) | `block-record` (new) |
| Block: Agent / Agent chat | `tool-simulate` (Simulate) | `block-agent` / `block-agent-chat` (new) |
| Agent: Overview / Sheet map | `view-grid` (#) | `view-overview` (new) |
| Agent: Chats | `history-version` | `block-chat` |
| Agent: Model & effort | `settings-gear` | `settings-sliders` (new) |
| Agent: Instructions | `action-rename` (pencil) | `block-document` |
| Agent: Sub-agents | `share-people` | `block-agent` |
| Agent: Usage & limits | `tool-statistics` (bell curve) | `plan-usage` (new) |
| Agent: Privacy; Account: Privacy | `status-info` / `storage-drive` | `state-shield` (new) |
| Agent step: Moved a block | `size-fit` | `handle-grip` |
| Keyboard shortcuts (×2) | `status-info` | `nav-keyboard` (new) |
| Account: Privacy policy, Terms | `status-info` | `block-document` |
| Visuals (Builder, command palette) | `tool-mindmap` | `tool-shapes` (new); mind map keeps `tool-mindmap` |
| PDF: Select tool | `action-check` (✓) | `tool-select` (new) |
| Database: Filter | `nav-search` | `grid-filter` (new) |
| Database types: Title / Text | `nav-notebook` | `text-h1` / `block-text` |
| Number | `tool-statistics` | `prop-number` (new) |
| Select / Multi-select / Checkbox | `action-check` ×3 | `prop-select` / `prop-tags` / `prop-checkbox` (new) |
| URL / Email | `nav-search` ×2 | `share-link` / `prop-email` (new) |
| Person / Relation | `share-people` / `share-link` | `auth-account` / `prop-relation` (new) |
| Task assignee | `share-people` | `auth-account` |
| `view-grid` itself | `#`, which reads as "number" | redrawn as the 3×3 dot grid the canvas actually shows |

## 4. Totals

- 130 → 156 icons: 26 new, 4 redrawn (`settings-gear`, `block-flashcards`, `view-grid`, `action-delete`)
- 64 call sites changed in 18 files
- `check-icons.mjs` accepts the new `prop-` prefix
- `npm test` 63 suites / 3103 assertions pass (one expectation updated: an
  unknown file type falls back to `block-file`); `npm run check` all green

## 5. Not done, needs a decision

1. **Visuals bar has its own icon system** (`components/visuals/VisualsBar.js`,
   14 inline SVGs on a 20 grid at stroke 1.6). It looks close but it is a second
   set. Move into `icons/` or keep?
2. **Delete the unused duplicates** `draw-exit` and `cc-unmatched`
   (identical to `status-error`, now 0 call sites)?
3. **`block-pdf` and `nav-sheet`** are both a blank page with a folded corner.
4. **Agent toolbar button** is text-only while its neighbours are icon-only.
   Left for the Agent design pass.
5. `history-version` still serves Document "Save version" and "Versions…"
   (correct), and `status-info` still serves info notes and toasts (correct).
