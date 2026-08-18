/*
  components/notebook/blockRegistry.js
  --------------------------------------------------------------------------
  One entry per block type. Everything that used to be a `b.type === '…'`
  chain now reads from here.

  WHY
  Adding a block type meant editing nine places, seven of them inside
  NotebookCanvas.js. Predictably, some of those places had already drifted
  apart from each other — see the four bugs listed at the bottom of this
  comment, all of which were found by writing this file and all of which are
  fixed by it. The next eight block types (pdf, chart, task, calendar, query,
  price, watchlist, news) each become one entry plus one renderer.

  WHAT'S DELIBERATELY NOT HERE: THE JSX
  The renderers stay in NotebookCanvas for now. They close over roughly twenty
  local values — colours, drag state, selection, a dozen callbacks — and
  lifting them out means inventing a props contract before there's a second
  consumer to prove it right. That's the kind of abstraction that gets built
  twice. The registry covers data, defaults, identity and behaviour; the
  render switch is now the ONLY place a new type touches NotebookCanvas.

  TWO SETS OF DIMENSIONS, AND THEY ARE NOT THE SAME NUMBERS
  `create.w` is what a NEW block gets. `dims` is the fallback used when a
  block has no explicit w/h — which happens for every table ever made, since
  tables are created with `w: undefined` on purpose so they can size to their
  content. A new text block is 280 wide; a text block with no stored width
  measures 320. That looks like a mistake and isn't: unifying them would
  silently resize blocks in workspaces people have already saved. Both numbers
  are preserved exactly as they were.

  BUGS THIS FILE FIXES
  1  Duplicating an image block produced an EMPTY image — imageId, alt, fit,
     natW, natH and rev were never cloned. cloneFields now lists them.
  2  Duplicating a coloured section reset it to the default indigo, because
     sectionColor wasn't cloned either.
  3  blockHasContent() had a second, drifted copy inside confirmDelete() that
     didn't know about sections — so deleting a section full of blocks skipped
     the confirmation the other path would have shown.
  4  blockHasContent() returned false for images, so deleting an image never
     warned even though it's the only block type holding bytes you can't
     retype.
  -------------------------------------------------------------------------- */

/* Extension-qualified on purpose. tests/registry.equivalence.test.mjs imports
   this file into bare Node, which does not resolve extensionless specifiers —
   the bundler is fine either way, so the stricter form is the one that works
   in both. */
import { createDatabase } from '../../lib/database.js'

/** Strip HTML and see if anything's left. Shared by text-ish types. */
const hasText = html => (html || '').replace(/<[^>]*>/g, '').trim().length > 0

export const BLOCK_TYPES = {
  text: {
    label: 'Text Block',
    icon: 'block-text',
    /** Add-menu order. Explicit so a new type can't reshuffle the menu by accident. */
    order: 1,
    /** Bare keypress that creates this type in keyboard mode. */
    key: 'n',
    resizable: 'both',
    /** Which contextual rail owns it. null = none. */
    rail: null,
    /** Export formats this type can appear in; '*' means every format. */
    exportAs: ['*'],
    /** What to focus when you press Enter on it. */
    focusSelector: '[contenteditable]',
    /** Put the caret at the end rather than the start, so typing appends. */
    caretToEnd: true,
    create: ({ id, x, y, w }) => ({ id, type: 'text', x, y, w: w || 280, name: '', content: '' }),
    dims: { w: 320, h: 150 },
    hasContent: b => hasText(b.content),
    cloneFields: ['content'],
  },

  table: {
    label: 'Table Block',
    icon: 'block-table',
    order: 2,
    key: 't',
    resizable: 'both',
    rail: 'sheet',
    exportAs: ['*'],
    /* SheetGrid's scroll container carries tabIndex=0 and owns its own keys. */
    focusSelector: '[tabindex]',
    create: ({ id, x, y, w, headers, rows }) => ({
      id, type: 'table', x, y, w: w || undefined, name: '',
      /* Header starts blank. It used to default to "Column 1", which was pure
         noise — the grid already prints the column letter above every header,
         so the cell read "A / Column 1" and everyone's first action was to
         delete it. */
      headers: headers || [''],
      rows: rows || Array(8).fill(null).map(() => ['']),
    }),
    dims: { w: 520, h: 260 },
    hasContent: b => !!b.rows?.some(row => row.some(c => c && String(c).trim())),
    /* headers and rows are passed positionally by addNotebookBlock rather than
       through the patch, so they're handled separately — see cloneArgs below. */
    cloneFields: [],
  },

  kanban: {
    label: 'Kanban Board',
    icon: 'block-kanban',
    order: 3,
    key: 'k',
    resizable: 'both',
    rail: null,
    exportAs: ['*'],
    focusSelector: 'input,textarea,[contenteditable],button',
    create: ({ id, x, y, now }) => ({
      id, type: 'kanban', x, y, name: '',
      lanes: [
        { id: `lane_${now}_1`, name: 'Lane 1', cards: [] },
        { id: `lane_${now}_2`, name: 'Lane 2', cards: [] },
        { id: `lane_${now}_3`, name: 'Lane 3', cards: [] },
      ],
    }),
    dims: { w: 720, h: 280 },
    hasContent: b => !!b.lanes?.some(l => l.cards?.length > 0),
    cloneFields: ['lanes'],
  },

  section: {
    label: 'Section',
    icon: 'block-section',
    order: 4,
    key: 's',
    resizable: 'both',
    rail: null,
    exportAs: ['*'],
    focusSelector: null,
    create: ({ id, x, y, w, h }) => ({
      id, type: 'section', x, y, w: w || 500, h: h || 350,
      name: 'Section', sectionColor: '#5B5FE8',
    }),
    dims: { w: 500, h: 350 },
    /* A section's content is its children, which live in the sibling list —
       so unlike every other type this one needs the whole block array. */
    hasContent: (b, all = []) => all.some(x => x.parentSectionId === b.id),
    cloneFields: ['sectionColor'],
    /** Sections are containers: they don't nest, and they're skipped by hit-testing. */
    isContainer: true,
  },

  image: {
    label: 'Image',
    icon: 'block-image',
    order: 5,
    key: 'i',
    resizable: 'both',
    rail: 'image',
    exportAs: ['*'],
    focusSelector: null,
    /* Adding one opens the file picker instead of dropping an empty block —
       a placeholder that does nothing until you find another way to fill it
       is worse than no block at all. */
    createOpensPicker: true,
    create: ({ id, x, y, w, h }) => ({
      /* Holds an id, never bytes. The image itself lives in IndexedDB so
         autosave doesn't rewrite pixels every 600ms — see lib/images.js. */
      id, type: 'image', x, y, w: w || 360, h: h || 260,
      name: 'Image', imageId: null, alt: '', fit: 'contain', rev: 0,
    }),
    dims: { w: 320, h: 150 },
    /* An image with bytes always counts. It's the one type whose content
       can't be retyped from memory, so the delete confirmation matters most
       here — and this was the type that never asked. */
    hasContent: b => !!b.imageId,
    cloneFields: ['imageId', 'alt', 'fit', 'natW', 'natH', 'rev'],
  },

  /* The first block type added AFTER the registry existed. It touches exactly
     two files: this entry, and the render branch in NotebookCanvas. Before the
     registry it would have been nine. */
  pdf: {
    label: 'PDF',
    icon: 'block-pdf',
    order: 6,
    /* No single-key shortcut. n/t/k/s/i are taken, and 'p' is close enough to
       a paste reflex that binding it to "create a block" is asking for it. */
    key: null,
    resizable: 'both',
    rail: 'pdf',
    exportAs: ['*'],
    /* The page container owns arrow keys for paging. */
    focusSelector: '[tabindex]',
    createOpensPicker: true,
    create: ({ id, x, y, w, h }) => ({
      /* Holds an id and the view state, never bytes — a 20MB document must not
         be rewritten by the 600ms autosave. See lib/pdfs.js. */
      id, type: 'pdf', x, y, w: w || 520, h: h || 620,
      name: 'PDF', pdfId: null, pdfPage: 1, pdfFit: 'width',
    }),
    dims: { w: 520, h: 620 },
    hasContent: b => !!b.pdfId,
    /* pdfId is shared, not copied: duplicating a block must not duplicate
       25MB of bytes. Both blocks read the same document, which is what you
       want — two views of one file, e.g. page 3 beside page 40. Deleting one
       leaves the other working, and prunePdfs only reclaims the bytes once
       NO block references them. */
    cloneFields: ['pdfId', 'pdfPage', 'pdfFit'],
  },

  task: {
    label: 'Task',
    icon: 'text-checklist',
    order: 7,
    /* 'a' for "action". t/k/s/i/n are taken and 'd' reads as delete. */
    key: 'a',
    resizable: 'both',
    rail: 'task',
    exportAs: ['*'],
    focusSelector: 'input,textarea',
    create: ({ id, x, y, w, h }) => ({
      id, type: 'task', x, y, w: w || 260, h: h || 96,
      name: '', title: '', notes: '',
      priority: 'med',
      /* Stored status is only ever todo/doing/done. `blocked` is DERIVED from
         the connection graph by lib/tasks.js and never written — storing it
         would let the two disagree, and the stale one would win. */
      status: 'todo',
      deadline: null,
      assignee: '',
    }),
    dims: { w: 260, h: 96 },
    /* A task with a title is worth confirming before deleting; an empty one
       you just made by mis-clicking is not. */
    hasContent: b => !!(b.title?.trim() || b.notes?.trim()),
    cloneFields: ['title', 'notes', 'priority', 'status', 'deadline', 'assignee'],
  },

  calendar: {
    label: 'Calendar',
    icon: 'status-info',
    order: 8,
    /* 'c' — the only obvious letter left, and not near anything destructive. */
    key: 'c',
    resizable: 'both',
    rail: 'calendar',
    exportAs: ['*'],
    focusSelector: null,
    create: ({ id, x, y, w, h }) => ({
      id, type: 'calendar', x, y, w: w || 520, h: h || 420,
      name: 'Calendar',
      view: 'month',
      /* Reads task deadlines by default, because that's the source that needs
         no configuration — a calendar that shows nothing until you set it up
         looks broken. Point it at a table's date column from the rail. */
      sources: [{ kind: 'tasks' }],
      events: [],
    }),
    dims: { w: 520, h: 420 },
    /* Only events typed directly in count as content. Everything else is a
       view of data that lives elsewhere and isn't lost with the block. */
    hasContent: b => (b.events?.length || 0) > 0,
    cloneFields: ['view', 'sources', 'events'],
  },

  database: {
    label: 'Database',
    icon: 'block-table',
    order: 9,
    /* No single-key shortcut. n/t/k/s/i/a/c are taken and 'd' reads as delete
       everywhere else in the app — binding it to "create a block" is the same
       mistake 'p' would have been for the PDF type. */
    key: null,
    resizable: 'both',
    /* No rail yet. Everything a database needs — views, sort, filter, the
       property editor — is reachable from the block itself, and a rail that
       duplicated those controls would be a second place for them to drift. */
    rail: null,
    exportAs: ['*'],
    focusSelector: 'input,button',
    create: ({ id, x, y, w, h }) => ({
      /* Wider than a text block on purpose: the default view is a table, and
         a table that arrives needing to be resized before its columns fit
         reads as broken rather than as compact.

         NOT `w: w || undefined` — that trick belongs to the table type, which
         sizes to its content. A database's columns are fixed-width, so a real
         default is what's wanted, and the two dims below match it (the 280/320
         split at the top of this file is history the legacy types carry, not a
         pattern to copy). */
      id, type: 'database', x, y, w: w || 620, h: h || 380,
      name: 'Database',
      /* The whole model in one key. It carries its own dbVersion, so a
         document written by a newer build is identifiable rather than merely
         confusing — see lib/database.js. */
      db: createDatabase({ name: 'Untitled' }),
    }),
    dims: { w: 620, h: 380 },
    /* A database you have put something INTO. One property (the title it is
       born with) and no rows is the block you just made by mis-clicking, and
       asking about that is the tax components/ui/Toast.js argues against. */
    hasContent: b => (b.db?.rows?.length || 0) > 0 || (b.db?.properties?.length || 0) > 1,
    /* The whole database object. clonepatch deep-copies anything non-primitive,
       which matters more here than anywhere else: a shallow copy would give
       both blocks the same `rows` array, so typing in the duplicate would edit
       the original — the kanban `lanes` bug, one level deeper. */
    cloneFields: ['db'],
  },
}

/* ── derived lookups ──────────────────────────────────────────────────── */

export const BLOCK_TYPE_IDS = Object.keys(BLOCK_TYPES)
  .sort((a, b) => BLOCK_TYPES[a].order - BLOCK_TYPES[b].order)

/** The Add menu, in declared order. */
export const ADD_ITEMS = BLOCK_TYPE_IDS.map(type => ({
  type,
  label: BLOCK_TYPES[type].label,
  icon: BLOCK_TYPES[type].icon,
}))

/** Single keypress → type, for keyboard mode. */
export const TYPE_BY_KEY = Object.fromEntries(
  BLOCK_TYPE_IDS.filter(t => BLOCK_TYPES[t].key).map(t => [BLOCK_TYPES[t].key, t])
)

/** The fallback used when nothing matches, so a corrupt type never crashes a render. */
const FALLBACK = BLOCK_TYPES.text

export const getType = type => BLOCK_TYPES[type] || FALLBACK
export const isKnownType = type => Object.prototype.hasOwnProperty.call(BLOCK_TYPES, type)

/**
 * Build a new block. Mirrors the old addNotebookBlock exactly, including the
 * `{ ...block, ...patch, id }` ordering — patch overrides everything except
 * the id, which must survive so the caller's reference stays valid.
 */
export function createBlock(type, { id, x, y, w, h, headers, rows, patch, now = Date.now() }) {
  const def = getType(type)
  const block = def.create({ id, x, y, w, h, headers, rows, now })
  return patch ? { ...block, ...patch, id } : block
}

/** Rendered size, falling back to the per-type defaults. */
export function blockDims(b) {
  const def = getType(b?.type)
  return { w: b?.w || def.dims.w, h: b?.h || def.dims.h }
}

/**
 * Is there anything here worth confirming before deletion?
 * `all` is only consulted by sections, but is always accepted so callers
 * don't have to know which types care.
 */
export function blockHasContent(b, all = []) {
  if (!b || !isKnownType(b.type)) return false
  return !!BLOCK_TYPES[b.type].hasContent(b, all)
}

/**
 * The patch that carries a block's content to its duplicate.
 * Deep-copies anything that isn't a primitive — a shallow copy of `lanes`
 * would give both boards the same card arrays, so typing in one edits the other.
 */
export function clonepatch(b) {
  const def = getType(b.type)
  const patch = {}
  if (b.w) patch.w = b.w
  if (b.h) patch.h = b.h
  if (b.name) patch.name = b.name + ' (copy)'
  /* Provenance is carried by ANY type, so it's handled here rather than being
     repeated in five cloneFields lists. A copy of a table extracted from page
     12 of a report still came from page 12 of that report — dropping the
     source on duplication would quietly turn a cited figure into an
     unattributed one. */
  if (b.source) patch.source = { ...b.source }
  for (const f of def.cloneFields) {
    const v = b[f]
    if (v === undefined || v === null) continue
    patch[f] = typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v
  }
  return patch
}

/**
 * Is this a backdrop that other blocks sit inside, rather than a block in its
 * own right? Containers are skipped by hit-testing, snapping, keyboard
 * traversal and mind-map port targeting, and render behind everything else.
 *
 * Only sections qualify today. It exists as a flag rather than ten literal
 * `type === 'section'` checks so the next eight block types are correctly
 * NOT containers without anyone having to remember to exclude them.
 */
export const isContainer = b => !!getType(b?.type).isContainer

/**
 * Which contextual rail a selected block summons, or null.
 * Used to inset the camera when centring, so a centred block doesn't end up
 * half-covered by its own toolbar.
 */
export const railFor = b => (b ? getType(b.type).rail : null)

/** Positional headers/rows for duplication. Only tables use them. */
export function cloneArgs(b) {
  return b.type === 'table'
    ? { headers: [...(b.headers || [])], rows: (b.rows || []).map(r => [...r]) }
    : { headers: null, rows: null }
}
