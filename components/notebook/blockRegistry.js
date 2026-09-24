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

/* A NEW BLOCK IS BORN WITH NO NAME.

   Several types used to be created with their own type as their name —
   'Image', 'PDF', 'Calendar', 'File'. That is real text sitting in the title
   field, so renaming meant selecting and deleting the word 'Image' before you
   could type anything, every single time. The header shows 'Untitled' as a
   PLACEHOLDER instead, which costs nothing and disappears the moment there is
   a real name.

   Imports are unaffected: importPdf and importAttachment pass the actual
   filename in their patch, which is a name worth having. */
export const BLOCK_TYPES = {
  text: {
    /* "Notes", not "Text Block" — confirmed. The registry KEY stays `text`, so
       there is no data migration and every stored block is untouched; only the
       display label changes, and it changes everywhere at once because every
       menu, header and tooltip reads it from here.

       The rename earns its keep now that `document` exists beside it: "Text
       Block" and "Document" are not distinguishable as a pair, and the
       distinction is the whole point — Notes is quick capture, Document is the
       heavier writing surface. */
    label: 'Notes',
    icon: 'block-text',
    /** Add-menu order. Explicit so a new type can't reshuffle the menu by accident. */
    order: 1,
    /* Menu metadata. Both menus read these; nothing hand-maintains a
       second copy — see ADD_MENU_GROUPS. */
    menuGroup: 'write',
    desc: 'Rich text, headings and lists',
    keywords: 'text note notes writing paragraph heading prose markdown quick capture',
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
    /* Menu metadata. Both menus read these; nothing hand-maintains a
       second copy — see ADD_MENU_GROUPS. */
    menuGroup: 'data',
    desc: 'A spreadsheet grid with formulas',
    keywords: 'table grid spreadsheet sheet rows columns cells formula csv excel data',
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
    /* Menu metadata. Both menus read these; nothing hand-maintains a
       second copy — see ADD_MENU_GROUPS. */
    menuGroup: 'organize',
    desc: 'Cards in lanes you drag between',
    keywords: 'kanban board lanes cards columns workflow trello todo swimlane',
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
    /* Menu metadata. Both menus read these; nothing hand-maintains a
       second copy — see ADD_MENU_GROUPS. */
    menuGroup: 'organize',
    desc: 'A frame that groups blocks together',
    keywords: 'section group frame container panel area cluster',
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

  /* ── DOCUMENT ─────────────────────────────────────────────────────────────
     THE HEAVIER WRITING SURFACE, distinct from Notes (quick capture). A
     notebook has many Notes blocks and one or a few Documents per topic.

     KEY `document`, LABEL "Document" — chosen over "Doc", matching this file's
     lowercase-noun convention (text, table, kanban, section, image, pdf, task,
     calendar, chat) and staying clear of "Word" for the obvious reason.

     WHY THIS SHIPS AS ONE v1 RATHER THAN BEHIND A PHASE-0 GATE. The full
     feature list and "continuous scroll, paginate on export only" sound like
     they pull against each other and do not: live reflowing pages was the
     single highest-risk item — nothing else in this app does layout reflow —
     and moving page computation to export time removes that risk without
     cutting one feature. Had live reflow been chosen, this entry would not
     exist yet.

     `rail: 'document'` IS THE RIBBON. This is not a new toolbar mechanism for
     the codebase to carry: `rail` already means "a contextual toolbar tied to a
     block type, shown while that block is selected" (pdf, calendar, sheet,
     image all use it). Document simply needs a much bigger rail than they do.

     PAGE SETUP IS LIVE LAYOUT, and it is read by export as well.

     This comment used to claim the opposite — "not a live layout parameter …
     nothing about them reflows the editing surface" — which was simply false
     and had been for a while: `pageSize` sets the page element's width and
     `margins` are applied as PADDING on the contentEditable, so both reflow
     the text as you change them. The ruler's draggable margin markers exist
     precisely because they do. Left standing, the comment invites someone to
     "restore" export-only behaviour and break the ruler. */
  document: {
    label: 'Document',
    /* Placeholder, per the standing icon pipeline: no document-shaped glyph
       exists in the 129-icon set yet. `format-word` is the nearest real shape
       and is at least about documents. Swap when the real one is drawn. */
    icon: 'format-word',
    order: 13,
    menuGroup: 'write',
    desc: 'Long-form writing, with page guides',
    keywords: 'document doc word writing report paper long-form pages ribbon manuscript thesis article',
    /* 'd' is free and is nowhere near anything destructive. */
    key: 'd',
    resizable: 'both',
    rail: 'document',
    exportAs: ['*'],
    focusSelector: '[data-ds-text]',
    create: ({ id, x, y, w, h }) => ({
      /* 880, not 720. A4 at 96dpi is 794px wide and the page scroller adds a
         24px gutter each side, so anything under ~850 clamps the page with
         `maxWidth: 100%` and the document opens already squashed — which is
         not a good first impression for the block whose pitch is "this is a
         real page". 880 shows A4 at true size with room for the scrollbar. */
      id, type: 'document', x, y, w: w || 880, h: h || 700,
      name: '', content: '',
      /* Page setup. Letter is the more common default for the export libraries
         and A4 for most of Europe; A4 wins because that is where this is being
         written and it is one field to change. Margins in INCHES, because that
         is the unit Word's own dialog uses and the unit people type. */
      pageSize: 'a4',
      orientation: 'portrait',
      margins: { top: 1, bottom: 1, left: 1, right: 1 },
      marginPreset: 'normal',
      /* View toggles, all on. The ruler used to default off "because it costs
         vertical space in a block that may be short" — but page fidelity is
         the entire reason this block exists rather than a Notes block, and the
         ruler is the thing that shows it. Defaulting it off hid the feature
         behind View → Ruler, where nobody looked. The block now opens 700px
         tall, which is room enough. */
      showRuler: true,
      showGuides: true,
      showWordCount: true,
      /* Paragraph indents, in inches, mirrored by the ruler's markers. */
      indentFirst: 0,
      indentLeft: 0,
      indentRight: 0,
      font: 'Inter',
      fontSize: 12,
    }),
    dims: { w: 720, h: 620 },
    /* A Document is wide by necessity: a page at A4 with 1" margins is ~6.5"
       of text, and the ribbon needs room for four tab bands. Below this it
       stops being a writing surface. */
    minDims: { w: 560, h: 380 },
    hasContent: b => !!(b.content && b.content.replace(/<[^>]*>/g, '').trim()),
    cloneFields: [
      'content', 'pageSize', 'orientation', 'margins', 'marginPreset',
      'showRuler', 'showGuides', 'showWordCount',
      'indentFirst', 'indentLeft', 'indentRight', 'font', 'fontSize',
    ],
  },

  /* THE `columns` CONTAINER-BLOCK TYPE THAT USED TO LIVE HERE IS REMOVED, NOT
     RENAMED OR REPURPOSED. It was a Notion-style "blocks side by side"
     container — a floating canvas block with its own w/h and drag handles —
     shipped as an honest placeholder (see its own removed comment: "a
     proposal to react to, not a finished spec"). What was actually wanted
     turned out to be real Word/Notion-style TEXT columns: content that lives
     inline in a Notes or Document block's own flow, resizable by dragging the
     gutter between columns, with no separate floating block at all. That
     lives in lib/columns.js now and is reached from the slash menu
     (SlashMenu.js's FORMAT_COMMANDS — 2/3/4/5 columns, an in-place insert,
     the same family as "Bullet list") and the selection toolbar
     (TextBlockToolbar.js's "Turn into columns") for Notes, and from
     DocumentRibbon.js's Columns dropdown for Document. None of that is a
     registry block type, so there is nothing to register here — the
     `columns` key below is deliberately gone rather than pointed at
     something new. */

  image: {
    label: 'Image',
    icon: 'block-image',
    order: 5,
    /* Menu metadata. Both menus read these; nothing hand-maintains a
       second copy — see ADD_MENU_GROUPS. */
    menuGroup: 'media',
    desc: 'A picture, croppable in place',
    keywords: 'image picture photo png jpg screenshot figure chart graphic',
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
      name: '', imageId: null, alt: '', fit: 'contain', rev: 0,
      /* NOTE: `displayMode` is deliberately NOT written here.

         The spec called for `create()` to return `displayMode: 'full'`. It
         should not, and tests/registry.equivalence.test.mjs is the reason: that
         suite reproduces the pre-refactor image constructor verbatim and asserts
         the registry still produces the IDENTICAL shape, because a block object
         is persisted verbatim and "a missing key, null where there was
         undefined, a different default width" means every already-saved
         workspace renders wrong.

         Adding a key to satisfy a default is exactly the change that gate
         exists to catch — and it buys nothing, because ABSENT ALREADY MEANS
         'full'. displayModeOf() below is the single reader, every consumer goes
         through it, and every image block ever saved is therefore already
         correct with no migration and no shape change. The field appears in
         stored data only once somebody actually sets it, which is also the
         honest representation: 'full' is not a choice anyone made.

         What displayMode means when it IS set:
           'compact' a small REAL thumbnail — still pixels. Only ever set by a
                     section's Compact toggle, never by hand.
           'icon'    a generic chip, no pixels at all. A deliberate per-image
                     choice, and it wins over Compact in both directions.
         Either way the block stays a real `image` — crop, rotate, flip, alt
         text and replace all keep working, because none of those should vanish
         because it is collapsed right now. w/h are never touched by it, so
         toggling back to Full restores exactly the size you had. */
    }),
    dims: { w: 320, h: 150 },
    /* An image with bytes always counts. It's the one type whose content
       can't be retyped from memory, so the delete confirmation matters most
       here — and this was the type that never asked. */
    hasContent: b => !!b.imageId,
    /* displayMode IS in cloneFields. The four-line bug list at the top of this
       file exists because a field got left out of one of these before, and
       duplicating an icon-mode image only to have the copy expand to 360×260 is
       exactly that bug again. */
    cloneFields: ['imageId', 'alt', 'fit', 'natW', 'natH', 'rev', 'displayMode'],
  },

  /* The first block type added AFTER the registry existed. It touches exactly
     two files: this entry, and the render branch in NotebookCanvas. Before the
     registry it would have been nine. */
  pdf: {
    label: 'PDF',
    icon: 'block-pdf',
    order: 6,
    /* Menu metadata. Both menus read these; nothing hand-maintains a
       second copy — see ADD_MENU_GROUPS. */
    menuGroup: 'media',
    desc: 'Read, annotate and extract from a PDF',
    keywords: 'pdf document paper report scan annotate highlight extract',
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
      name: '', pdfId: null, pdfPage: 1, pdfFit: 'width',
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
    /* Menu metadata. Both menus read these; nothing hand-maintains a
       second copy — see ADD_MENU_GROUPS. */
    menuGroup: 'organize',
    desc: 'One piece of work, with a deadline',
    keywords: 'task todo deadline priority due assignee work item',
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
    /* Menu metadata. Both menus read these; nothing hand-maintains a
       second copy — see ADD_MENU_GROUPS. */
    menuGroup: 'organize',
    desc: 'A dated index of this workspace',
    keywords: 'calendar dates month week agenda schedule deadlines events',
    /* 'c' — the only obvious letter left, and not near anything destructive. */
    key: 'c',
    resizable: 'both',
    rail: 'calendar',
    exportAs: ['*'],
    focusSelector: null,
    create: ({ id, x, y, w, h }) => ({
      id, type: 'calendar', x, y, w: w || 520, h: h || 420,
      name: '',
      view: 'month',
      /* Reads task deadlines by default, because that's the source that needs
         no configuration — a calendar that shows nothing until you set it up
         looks broken. Point it at a table's date column from the rail. */
      sources: [{ kind: 'tasks' }],
      events: [],
    }),
    dims: { w: 520, h: 420 },
    /* A FLOOR, not a default — see blockMinDims below.

       Phase 1's persistent 178px source-calendar sidebar eats into the grid, and
       a 7-column month needs real room in what's left. 178 + 1px border + ~300px
       of usable grid is where 480 comes from. Below that the grid stops being a
       month and starts being seven slivers.

       STATED AS A RECOMMENDATION, NOT A MEASUREMENT: nobody has yet looked at a
       7-column grid at 300px on a real screen. If it turns out to want more, this
       is the one number to change. */
    minDims: { w: 480, h: 300 },
    /* Only events typed directly in count as content. Everything else is a
       view of data that lives elsewhere and isn't lost with the block. */
    hasContent: b => (b.events?.length || 0) > 0,
    cloneFields: ['view', 'sources', 'events'],
  },

  database: {
    label: 'Database',
    icon: 'block-table',
    order: 9,
    /* IN THE SLASH MENU TOO, and this flag is the whole point of the
       unification: `database` used to be hand-typed into SlashMenu.COMMANDS as
       a second, independent declaration of a type this file already describes.
       They happened to agree; nothing enforced that they still would after the
       next edit to either. Now the slash menu derives its block-insertion rows
       from here.

       A FLAG RATHER THAN "all of ADD_ITEMS". The slash menu is a text-editing
       menu with nine formatting commands in it; pouring eleven block types into
       it would make inserting a heading harder in order to make inserting a
       calendar possible from a place nobody looks for one. Only the types that
       genuinely make sense mid-paragraph opt in. */
    inSlashMenu: true,
    /* Menu metadata. Both menus read these; nothing hand-maintains a
       second copy — see ADD_MENU_GROUPS. */
    menuGroup: 'data',
    desc: 'One set of rows, four ways to see it',
    keywords: 'database table board kanban calendar gallery cards notion crm rows properties collection',
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
      name: '',
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

  /* §8 — the attachment of last resort. Everything with a live block of its
     own (spreadsheet, pdf, image, markdown) is routed before this; a file
     block is what .docx, .zip, .mp4 and .pptx become. */
  /* §9 — the conversation.

     WHAT IS AND IS NOT IN `create`: a chat block carries an id, a name and
     nothing else. The messages live in `chat_messages` (migration 0009),
     keyed by this block's id, and they are deliberately NOT in the document.

     Three reasons, in the order they bite:
       · the document is pushed whole on every save. Words typed into a chat
         would rewrite the entire notebook per keystroke, which is the exact
         cost image and file blocks store an id to avoid.
       · a message has an author the server stamps. Anything inside `doc` is
         written by whoever pushed the document, so an in-document chat can be
         forged by anyone who can save the sheet.
       · a person you shared ONE SHEET with must be able to reply. They cannot
         write your document — 0008 sees to that — but they can write the
         thread, and those two facts can only coexist if the thread is not the
         document.

     So this entry is almost empty on purpose, and that emptiness is the
     feature. */
  chat: {
    label: 'Chat',
    icon: 'share-people',
    order: 11,
    /* Menu metadata. Both menus read these; nothing hand-maintains a
       second copy — see ADD_MENU_GROUPS. */
    menuGroup: 'collaborate',
    desc: 'A conversation about this sheet',
    keywords: 'chat message conversation comment discuss talk thread share',
    /* 'm' for message. 'c' is the calendar and the rest of the alphabet near
       it is spoken for. */
    key: 'm',
    resizable: 'both',
    rail: null,
    /* Excluded from every export. A conversation is not part of the artefact
       you hand somebody — exporting a sheet to PDF should not print the
       argument you had about it. */
    exportAs: [],
    focusSelector: '[data-chat-composer]',
    create: ({ id, x, y, w, h }) => ({
      id, type: 'chat', x, y, w: w || 340, h: h || 380, name: '',
    }),
    dims: { w: 340, h: 380 },
    /* A chat block is never "empty" in the sense the delete confirmation
       cares about: the thing worth losing is on the server, and this function
       cannot see it without a round trip. Answering `true` unconditionally
       means deleting one always asks — which is right, because deleting the
       block cascades the whole conversation away. */
    hasContent: () => true,
    /* NOTHING is cloned. Duplicating a chat block gives you a NEW empty
       thread, not a second view of the old one — copying the id would give
       two blocks one conversation, and copying the messages would forge
       everybody's words into a thread they never posted in. */
    cloneFields: [],
  },

  file: {
    label: 'File',
    icon: 'block-text',
    order: 10,
    /* Menu metadata. Both menus read these; nothing hand-maintains a
       second copy — see ADD_MENU_GROUPS. */
    menuGroup: 'media',
    desc: 'Any file, as an attachment chip',
    keywords: 'file attachment upload download zip docx attach',
    /* Not in the Add menu, and no single-key shortcut. An empty file block is
       not a placeholder you fill in later, it is a chip with no file —
       attachments arrive by drop or through the import picker. Offering a way
       to create an empty one only creates a way to be confused by one. */
    hiddenFromAddMenu: true,
    key: null,
    resizable: 'horizontal',
    rail: null,
    exportAs: ['*'],
    focusSelector: null,
    create: ({ id, x, y, w }) => ({
      /* An id, never bytes — same rule as image and pdf, and for the same
         reason: a 40MB attachment rewritten by the 600ms autosave is a frozen
         main thread. See lib/files.js. */
      id, type: 'file', x, y, w: w || 300, h: 74,
      name: '', fileId: null, size: 0, mime: '',
    }),
    dims: { w: 300, h: 74 },
    hasContent: b => !!b.fileId,
    /* fileId is SHARED on duplicate, not copied — the same decision pdf made.
       Two chips pointing at one blob is what you want, and pruneFiles only
       reclaims bytes once no block references them at all. */
    cloneFields: ['fileId', 'size', 'mime'],
  },

  countdown: {
    label: 'Countdown',
    /* A CLOCK FACE THAT ALREADY EXISTS, under a name earned by another job.
       'history-version' is a circle with two hands — see icon-paths.js — which
       is exactly the picture a countdown wants. The alternative was reusing
       'status-info', an info circle, which the calendar already borrows and
       which says nothing about time at all. icon-paths.js is GENERATED and its
       header says not to hand-edit it, so a purpose-named glyph means an SVG
       plus `node scripts/build-icons.mjs`. Worth doing eventually; not worth
       blocking a block type on. */
    icon: 'history-version',
    /* 12 was the last free slot — document took 13 — and in Organize it lands
       after calendar, which is where the other date-shaped thing already is. */
    order: 12,
    menuGroup: 'organize',
    desc: 'Time left until a date, ticking',
    keywords: 'countdown timer deadline clock date launch until remaining elapsed due',
    /* No single-key shortcut. n/t/k/s/d/i/a/c/m are taken, and nothing left in
       the alphabet is a mnemonic for "countdown" — a key you have to look up is
       worse than no key, because it occupies a letter the NEXT type might have
       had a real claim on. */
    key: null,
    /* NOT RESIZABLE, and that is the point rather than an omission.

       Width is a pure function of how many units are still on the clock: the
       block drops YR, then MO, then DAY as the date approaches (see
       CountdownBlock.js). A stored width could only ever disagree with its own
       contents, and dragging one would freeze the block at whatever size the
       longest form happened to need — a countdown showing MIN and SEC inside a
       box built for six units.

       NOTE: nothing reads this field today. The canvas decides resizability by
       whether a render branch includes <ResizeHandle>, which countdown's does
       not; this declaration is the registry telling the truth about the type,
       consistent with every other entry. */
    resizable: null,
    rail: null,
    exportAs: ['*'],
    focusSelector: 'input,button',
    create: ({ id, x, y, now }) => ({
      id, type: 'countdown', x, y, name: '',
      /* A WEEK OUT, not null and not now.

         A fresh block sitting at red 00 00 before you have touched it reads as
         broken rather than as empty, and an empty one would need a "no date
         yet" state that every countdown leaves within about ten seconds of
         being created. A date you will replace is a better starting point than
         a state you will never see again.

         Stored as an ISO string, so it survives JSON round-tripping through
         IndexedDB and the sync payload without a Date revival step anywhere.
         `now` comes from createBlock, which is what makes this testable. */
      target: new Date(now + 7 * 86_400_000).toISOString(),
    }),
    /* THE FALLBACK ONLY. Every countdown stores w/h as undefined, on purpose,
       so blockDims() answers with these — which is what the error boundary
       sizes to and what growSectionToFit reserves. The live block measures
       whatever its units need. */
    dims: { w: 260, h: 104 },
    /* Named countdowns confirm before deleting; unnamed ones don't — the same
       line task draws, for the same reason. `target` is NOT the test even
       though it is always set: it is a default nobody chose, and treating an
       untouched default as content would make every mis-click cost a dialog. */
    hasContent: b => !!b.name?.trim(),
    cloneFields: ['target'],
  },

  /* ── Builder Phase 1 (24 Sep 2026) ────────────────────────────────────
     Pipeline and Record are VIEWS of a Database block, not data of their
     own: `sourceId` names the database, and every edit goes back into that
     block's `db`. So deleting a Pipeline loses nothing, and one database can
     have several pipelines. See the "Builder — Full System Builder plan"
     doc and lib/database.js (stageSummary, moveRow, addActivity). */
  pipeline: {
    label: 'Pipeline',
    icon: 'block-kanban',
    order: 14,
    menuGroup: 'data',
    desc: 'Stages, cards and value per stage, from a database',
    keywords: 'pipeline crm stages deals clients leads funnel board sales builder',
    key: null,
    resizable: 'both',
    rail: null,
    exportAs: ['*'],
    focusSelector: 'button',
    /* sourceId/groupBy/valueProp are filled in by the canvas when the block
       is added: it points the pipeline at a database on the sheet, or makes
       a starter one (lib/builder.js). Null here = "not connected yet". */
    create: ({ id, x, y, w, h }) => ({
      id, type: 'pipeline', x, y, w: w || 880, h: h || 440,
      name: 'Pipeline', sourceId: null, groupBy: null, valueProp: null,
    }),
    dims: { w: 880, h: 440 },
    minDims: { w: 420, h: 240 },
    hasContent: () => false,          // the data lives in the database
    cloneFields: ['sourceId', 'groupBy', 'valueProp'],
  },

  record: {
    label: 'Record',
    icon: 'nav-notebook',
    order: 15,
    /* Not in the Add menu: a Record is opened FROM something (a pipeline
       card, the Ctrl/⌘K palette, a relationship chip), never made empty. */
    hiddenFromAddMenu: true,
    menuGroup: 'data',
    desc: 'One row of a database, as a page',
    keywords: 'record row profile crm',
    key: null,
    resizable: 'both',
    rail: null,
    exportAs: ['*'],
    focusSelector: 'input,button,textarea',
    create: ({ id, x, y, w, h }) => ({
      id, type: 'record', x, y, w: w || 400, h: h || 520,
      name: 'Record', sourceId: null, rowId: null, pipelineId: null,
    }),
    dims: { w: 400, h: 520 },
    minDims: { w: 320, h: 260 },
    hasContent: () => false,
    cloneFields: ['sourceId', 'rowId', 'pipelineId'],
  },
}

/* ── derived lookups ──────────────────────────────────────────────────── */

export const BLOCK_TYPE_IDS = Object.keys(BLOCK_TYPES)
  .sort((a, b) => BLOCK_TYPES[a].order - BLOCK_TYPES[b].order)

/** The Add menu, in declared order. */
/* Some types exist only as the RESULT of something — a file block comes from
   dropping a file, never from choosing "File" and then wondering what to do
   with the empty one. They stay out of the Add menu without leaving the
   registry, so everything else (dims, clone, export, the render branch) still
   works exactly as it does for every other type. */
/* ── MENU GROUPS ──────────────────────────────────────────────────────────
   Labels and ORDER, declared once, here, next to the list they group.

   Not inferred from `rail` and not guessed at inside the menu component —
   either of those would reintroduce the second hand-maintained list this whole
   arrangement exists to eliminate, just somewhere harder to find. Same
   philosophy this file already states for `order`: explicit, so a new type
   cannot reshuffle the menu by accident.

   Five groups with weights of roughly 1/6/2/3/1. Organize is intentionally the
   biggest bucket: kanban, task, calendar, section and columns are all "give my
   work shape" tools and belong together far more than they belong split across
   five single-item groups. A group of one is a heading with nothing to head. */
export const ADD_MENU_GROUPS = Object.freeze([
  { id: 'write',       label: 'Write' },
  { id: 'organize',    label: 'Organize' },
  { id: 'data',        label: 'Data' },
  { id: 'media',       label: 'Media' },
  { id: 'collaborate', label: 'Collaborate' },
])

/* Carries keywords, desc and menuGroup through now, not just type/label/icon.

   The search box needs more to match against than a label — nobody types
   "Kanban" when they are looking for a board — and the grouped view needs to
   know which bucket each entry is in. Both come off the registry entry, so
   adding a type means filling in its own fields and nothing else. */
export const ADD_ITEMS = BLOCK_TYPE_IDS
  .filter(type => !BLOCK_TYPES[type].hiddenFromAddMenu)
  .map(type => ({
  type,
  label: BLOCK_TYPES[type].label,
  icon: BLOCK_TYPES[type].icon,
  desc: BLOCK_TYPES[type].desc || '',
  keywords: BLOCK_TYPES[type].keywords || '',
  menuGroup: BLOCK_TYPES[type].menuGroup || 'organize',
}))

/** ADD_ITEMS bucketed and ordered for the grouped (empty-query) view. */
export const ADD_ITEMS_BY_GROUP = ADD_MENU_GROUPS
  .map(g => ({ ...g, items: ADD_ITEMS.filter(i => i.menuGroup === g.id) }))
  /* A group with nothing in it is not rendered. That matters as soon as a type
     is hidden from the menu or a group is added ahead of the type that will
     fill it — an empty heading reads as a bug. */
  .filter(g => g.items.length > 0)

/* The block-insertion rows the SLASH menu offers, derived rather than typed.

   Same objects as ADD_ITEMS so the label, icon, desc and keywords cannot drift
   between the two menus — which is the entire failure this replaces. `id` is
   aliased onto `type` because SlashMenu's command list is keyed by `id` and its
   nine formatting commands legitimately have no block type. */
export const SLASH_BLOCK_ITEMS = ADD_ITEMS
  .filter(i => BLOCK_TYPES[i.type].inSlashMenu)
  .map(i => ({ ...i, id: i.type }))

/** Match a menu item against a typed query. One implementation, both menus. */
export function matchesAddQuery(item, query) {
  const q = (query || '').toLowerCase().trim()
  if (!q) return true
  return `${item.label} ${item.keywords}`.toLowerCase().includes(q)
}

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

/* ── EFFECTIVE FOOTPRINT ──────────────────────────────────────────────────
   What a block ACTUALLY occupies on the canvas right now, which stopped being
   the same question as blockDims() the moment an image could render at three
   very different sizes while its STORED w/h stayed put.

   That storage choice is deliberate — collapsing an image to an icon must not
   lose the size you had it at — and it means anything that needs a block's
   current on-screen box has to resolve it from (block, displayMode) together
   rather than from stored dimensions alone.

   growSectionToFit above all. A section that believes a collapsed 24px icon
   still occupies 360×260 leaves a huge hole in its layout the first time
   somebody uses this, which is the sort of thing that reads as the feature
   being broken rather than as one function reading the wrong number.

   'full' images and every other block type read blockDims() unchanged, so this
   is a narrow addition rather than a new sizing system. */
export const ICON_FOOTPRINT = Object.freeze({ w: 200, h: 40 })
export const COMPACT_FOOTPRINT = Object.freeze({ w: 120, h: 90 })

export const DISPLAY_MODES = ['full', 'compact', 'icon']

/* THE ONE READER of displayMode. Absent, unrecognised, or on a type that has
   no such concept all resolve to 'full' — so no stored block needs migrating
   and a corrupted value can never produce a block that renders as nothing. */
export function displayModeOf(b) {
  if (b?.type !== 'image') return 'full'
  return DISPLAY_MODES.includes(b.displayMode) ? b.displayMode : 'full'
}

export function blockFootprint(b) {
  const mode = displayModeOf(b)
  if (mode === 'icon') return { ...ICON_FOOTPRINT }
  if (mode === 'compact') return { ...COMPACT_FOOTPRINT }
  return blockDims(b)
}

/* THE SMALLEST A BLOCK MAY BE RESIZED TO.

   The canvas used to clamp every type at one global 200×100. That was fine
   while every block degraded gracefully, and it stopped being fine when the
   calendar grew a fixed-width sidebar: at 200px wide the sidebar is 89% of the
   block and the month grid is seven 3px columns.

   ONE OPTIONAL FIELD, read through one helper, rather than a special case in
   the resize handler. A type that has a real floor declares `minDims`; every
   other type says nothing and keeps the canvas default, so this costs nothing
   for the eleven types that don't need it. The canvas passes its own global
   floor in as the fallback rather than this file duplicating those numbers —
   MIN_W/MIN_H are a canvas policy, not a registry fact. */
export function blockMinDims(b, fallback = { w: 200, h: 100 }) {
  const min = getType(b?.type).minDims
  return {
    w: Math.max(fallback.w, min?.w || 0),
    h: Math.max(fallback.h, min?.h || 0),
  }
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
export function clonepatch(b, { suffix = ' (copy)' } = {}) {
  const def = getType(b.type)
  const patch = {}
  if (b.w) patch.w = b.w
  if (b.h) patch.h = b.h
  /* THE SUFFIX IS A PARAMETER because provenance changes with the journey.

     A duplicate on your own canvas is "(copy)" and always has been. A block
     dragged out of a chat thread came from somebody ELSE's document, and
     "(copy)" throws away the only thing that distinguishes it from your own
     work a week later — so that path passes " (from Mara)" instead. Same deep-
     copy machinery either way; only the name differs, which is exactly the
     amount of special-casing the difference deserves.

     Default unchanged, so every existing caller behaves identically. */
  if (b.name) patch.name = b.name + suffix
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
