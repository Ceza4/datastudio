# Application map

Discovered from the running build and the source (audit branch, 16 Oct 2026). "Tested" means at least one scenario in TEST_MATRIX.md exercised it in a real browser.

## Routes

| ID | Route | Auth | Purpose | Direct load | Tested |
|---|---|---|---|---|---|
| R1 | `/` | open | "SOON" wall + Sign in | ✓ | screenshot desktop/mobile |
| R2 | `/login` | open (signed-in → `/app`) | email/password + MFA step, Google (disabled) | ✓ | screenshot, title |
| R3 | `/signup` | open (signed-in → `/app`) | account creation | ✓ | screenshot, title |
| R4 | `/forgot` | open | request reset email | ✓ | screenshot, title |
| R5 | `/reset` | open, needs recovery session | set new password | ✓ | screenshot, title |
| R6 | `/pricing` | open | Free / Pro / Max (not on sale) | ✓ | screenshot, title |
| R7 | `/app` | **gated in proxy.js** (302 → `/login?next=/app`, MFA-aware) | the workspace | ✓ | everything below |
| R8 | `/sandbox/html-preview` | open, own CSP | sandboxed frame for the HTML block | — | via HTML block only |
| R9 | `/api/agent` | session | Agent block model calls | — | BLOCKED (no model key locally) |
| R10 | `/api/account/delete`, `/api/account/export` | session + Origin check | irreversible account ops | — | NOT TESTED (destructive) |
| R11 | any unknown path | — | 404 | ✓ | branded since DEF-016 |

## /app structure

- **Sidebar** (AppPage, `app/app/page.js`): Import File, Folder, Project, project tree (rename, delete, expand), sheets (switch, rename, delete, New Sheet), imported files with columns (drag/whole-table insert), Shared with me, storage meter, collapse.
- **Top row** (`NotebookCanvas.js`): title island (project name, sheet name, zoom %, LOCKED, full screen), centre toolbar (Agent, Snap, Add, Draw + panel, Export), right island (Builder, People, Settings, Account).
- **Canvas**: pan (wheel, right-drag, Space), zoom (Ctrl+wheel/pinch), marquee, selection lock, snap guides, keyboard mode, full screen (Ctrl+Shift+F / hold Esc), connections/ports, ink, Visuals shapes layer, command palette (Ctrl+K), shortcuts (?).
- **Overlays**: Add menu, context menu, Export panel, Builder panel (templates, Visuals), Settings, People/Share, Account, Confirm dialog, Toast, Sync chip.

## Block types (blockRegistry.js)

| Type | Add menu | Lifecycle battery (create/drag/undo/dup/copy-paste/delete/undo/reload) | Notes |
|---|---|---|---|
| text (Notes) | ✓ | PASS | slash menu, markdown shortcuts, rail |
| document | ✓ | PASS | ribbon (DEF-014), pages |
| kanban | ✓ | PASS | cards, drag between lanes + undo |
| section | ✓ | PASS | containment, move-with-children, delete dialog |
| task | ✓ | PASS | |
| calendar | ✓ | PASS | |
| table | ✓ | PASS | SheetGrid; 50k-row import measured |
| database | ✓ | PASS | rows, views |
| countdown | ✓ | PASS | no resize by design |
| flashcards | ✓ | PASS | |
| chat | ✓ | PASS | |
| pipeline | ✓ | creates two blocks (pipeline + record) — not in battery | |
| html | ✓ | PASS | sandboxed frame |
| agent | ✓ | PASS (UI only; model calls blocked) | |
| agentchat / record / file | — | created indirectly | |
| image / pdf | ✓ (file picker) | import + reload | |

## Keyboard shortcuts (lib/shortcuts.js, verified where marked)

M keyboard mode ✓ · arrows navigate ✓ · Enter edit ✓ · Esc step out ✓ · Tab toolbar ✓ · G grab/Enter place/Esc cancel ✓ · N T K S I create · Ctrl+D duplicate ✓ · Ctrl+C/X/V ✓ · Ctrl+A ✓ (excludes sections — by design) · Delete ✓ · Shift+F / Shift+R · Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y ✓ · Ctrl+Shift+F full screen ✓ · hold Esc leave ✓ · Ctrl+K palette ✓ · ? shortcuts ✓ · grid: arrows/Enter/Tab/Delete/Esc/Ctrl+Z ✓ · Visuals: V R O D L A C T N M P ✓ (R, N).

## State ownership

- `notebooks`, `folders`, `files`, `prefs`, history (`historyRef`), sync engine: **AppPage**.
- selection (`selectedIds`, shapes, connection), pan/zoom (refs + state), kbMode, focus (full screen), menus, drag/resize sessions: **NotebookCanvas**.
- Grid-local history, active cell, editing: **SheetGrid**.
- Persistence: IndexedDB `datastudio/state/workspace` (debounced), assets in `images`/`pdfs` stores; cloud: `docs` rows (one per notebook/folder/sheetfile) with `rev` compare-and-set, outbox in IDB.
