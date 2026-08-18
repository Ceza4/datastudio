/*
  tests/templatestore.test.mjs
  --------------------------------------------------------------------------
  §9.1 Builder — the store layer. What lib/templates.js is pure about, this
  file is responsible for: bytes, and failure.

  THREE FAILURES THIS EXISTS TO CATCH, none of which throws:

  1. A TEMPLATE THAT IS A SET OF REFERENCES, NOT A COPY.
     A block carries an image id, not an image. Save a template without
     copying the bytes and it looks perfect — same list row, same summary,
     same everything — until the source notebook's image block is deleted,
     at which point every template built from that workspace renders a
     missing-asset box. Nothing errors. The assertions below therefore delete
     the SOURCE asset and then read the template's copy.

  2. AN UPGRADE THAT DROPS A USER'S WORKSPACE.
     DB_VERSION went 2 → 3 for the templates store. The `if (!contains)` guard
     in onupgradeneeded is the entire safety story, and the way to be sure it
     is load bearing is to open a database that ALREADY has the v2 stores with
     data in them and read that data back afterwards. So the fake below
     persists across the version bump exactly as a real one does, and
     createObjectStore throws ConstraintError on a name that exists, exactly as
     a real one does.

  3. A FAILURE THAT REACHES THE UI AS AN EXCEPTION.
     lib/persistence.js exists in its current shape because a thrown save
     error became a console.warn nobody saw, and people worked for hours on a
     workspace that had stopped persisting. Every function here must hand back
     `{ status, error }` instead. The fake can be told to fail an operation, so
     that is asserted rather than assumed.

  WHY A FAKE INDEXEDDB AND NOT A BROWSER
  `npm test` has no dependencies and takes five seconds, and that is why it
  gets run. A suite that needs a Chromium download first is a suite that stops
  being run within a week. The DOM half of Builder is covered in
  tests/browser/run.mjs, against a REAL IndexedDB.
  -------------------------------------------------------------------------- */

let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }

/* ── the fake ────────────────────────────────────────────────────────────
   Faithful in the four ways that matter here: values are structured-cloned in
   and out (so an aliasing bug cannot hide), requests resolve asynchronously
   (so handler-assignment order is exercised), createObjectStore refuses a
   duplicate name, and the "disk" survives a version bump. */

const clone = v => (v === undefined ? undefined : structuredClone(v))

const disk = new Map()          // dbName -> { version, stores: Map<name, Map> }
const ctl = { failOps: 0, failWith: null, failOpen: false }

function makeTransaction(rec, mode) {
  const ops = []
  const t = { mode, error: null, oncomplete: null, onerror: null, onabort: null }
  t.objectStore = name => {
    const map = rec.stores.get(name)
    if (!map) {
      const e = new Error(`No objectStore named ${name} in this database`)
      e.name = 'NotFoundError'
      throw e
    }
    const wrap = fn => {
      const req = { result: undefined }
      ops.push(() => { req.result = fn(map) })
      return req
    }
    return {
      get: k => wrap(m => clone(m.get(k))),
      put: (v, k) => wrap(m => { m.set(k, clone(v)) }),
      delete: k => wrap(m => { m.delete(k) }),
      getAllKeys: () => wrap(m => [...m.keys()]),
      clear: () => wrap(m => { m.clear() }),
    }
  }
  /* A macrotask, so the handlers idb.js assigns on the line AFTER creating the
     transaction are certainly in place. Firing synchronously would test a
     database no browser ships. */
  setTimeout(() => {
    try {
      if (ctl.failOps > 0) {
        ctl.failOps--
        throw ctl.failWith || new Error('simulated IndexedDB failure')
      }
      ops.forEach(run => run())
      t.oncomplete?.()
    } catch (err) {
      t.error = err
      t.onerror?.()
    }
  }, 0)
  return t
}

function makeDb(rec) {
  return {
    onversionchange: null,
    objectStoreNames: { contains: n => rec.stores.has(n) },
    createObjectStore(n) {
      if (rec.stores.has(n)) {
        const e = new Error(`An object store with name '${n}' already exists`)
        e.name = 'ConstraintError'
        throw e
      }
      rec.stores.set(n, new Map())
    },
    transaction: (_names, mode) => makeTransaction(rec, mode),
    close() {},
  }
}

globalThis.indexedDB = {
  open(name, version) {
    const req = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null }
    setTimeout(() => {
      if (ctl.failOpen) {
        req.error = new Error('simulated open failure')
        req.onerror?.()
        return
      }
      let rec = disk.get(name)
      if (!rec) { rec = { version: 0, stores: new Map() }; disk.set(name, rec) }
      const db = makeDb(rec)
      req.result = db
      if (version > rec.version) {
        rec.version = version
        try {
          req.onupgradeneeded?.()
        } catch (err) {
          /* Exactly what a real upgrade does with a ConstraintError: the whole
             open fails, and the app has no database at all. */
          req.error = err
          req.onerror?.()
          return
        }
      }
      req.onsuccess?.()
    }, 0)
    return req
  },
}

/* A workspace already on disk at DB_VERSION 2, with rows in all three of the
   stores the upgrade must not touch. Seeded BEFORE lib/idb.js is imported so
   the very first call performs the 2 → 3 upgrade over real data. */
disk.set('datastudio', {
  version: 2,
  stores: new Map([
    ['state', new Map([['workspace', { version: 4, notebooks: [{ id: 'nb_old', name: 'Existing work' }], folders: [] }]])],
    ['images', new Map([['img_seed', { blob: { size: 11, tag: 'seed-image' }, width: 4, height: 4 }]])],
    ['pdfs', new Map([['pdf_seed', { bytes: [1, 2, 3], name: 'seed', edits: [] }]])],
  ]),
})

const { idbGet, idbSet, idbDelete, idbKeys, STORE_STATE, STORE_IMAGES, STORE_PDFS, STORE_TEMPLATES } =
  await import('../lib/idb.js')
const {
  saveTemplate, listTemplates, getTemplate, deleteTemplate, renameTemplate,
  restoreTemplate, instantiate, templateAssetIds,
  TPL_OK, TPL_MISSING, TPL_INVALID, TPL_FAILED, TPL_QUOTA,
} = await import('../lib/templatestore.js')
const { TEMPLATE_VERSION, describeTemplate } = await import('../lib/templates.js')
const { linkHtml, extractLinks } = await import('../lib/teleport.js')

/* Deterministic asset ids, so an assertion can name an exact value. */
let n = 0
const assetId = p => `${p}_copy${++n}`

const makeNotebook = () => ({
  id: 'nb_src',
  name: 'CRM',
  activeSheetId: 's2',
  sheets: [
    {
      id: 's1',
      name: 'Companies',
      blocks: [
        { id: 'b_sec', type: 'section', name: 'Acme', x: 0, y: 0 },
        { id: 'b_txt', type: 'text', parentSectionId: 'b_sec',
          content: `<p>See ${linkHtml({ notebookId: 'nb_src', sheetId: 's2', blockId: 'b_task' }, 'the deal')}</p>` },
        { id: 'b_img', type: 'image', imageId: 'img_live' },
      ],
      connections: [{ id: 'c1', fromBlockId: 'b_sec', toBlockId: 'b_txt' }],
      drawings: [],
    },
    {
      id: 's2',
      name: 'Deals',
      blocks: [
        { id: 'b_task', type: 'task', title: 'Close Acme' },
        { id: 'b_pdf', type: 'pdf', pdfId: 'pdf_live' },
      ],
      connections: [],
    },
  ],
})

const IMAGE_BYTES = { blob: { size: 1234, tag: 'live-pixels' }, width: 800, height: 600 }
const PDF_BYTES = { bytes: [37, 80, 68, 70], name: 'contract', edits: [], size: 4 }

const seedAssets = async () => {
  await idbSet(STORE_IMAGES, 'img_live', IMAGE_BYTES)
  await idbSet(STORE_PDFS, 'pdf_live', PDF_BYTES)
}
const wipeTemplates = async () => {
  for (const k of await idbKeys(STORE_TEMPLATES)) await idbDelete(STORE_TEMPLATES, k)
}

console.log('\n the DB_VERSION 2 → 3 upgrade must not cost anyone their work')
{
  /* This read is what performs the upgrade — openDB is lazy. */
  const state = await idbGet(STORE_STATE, 'workspace')
  ok(state?.notebooks?.[0]?.id === 'nb_old', 'a workspace stored under v2 is still there after the bump to v3')
  ok((await idbGet(STORE_IMAGES, 'img_seed'))?.blob?.tag === 'seed-image', 'and so are the image bytes')
  ok((await idbGet(STORE_PDFS, 'pdf_seed'))?.bytes?.length === 3, 'and the PDFs')

  const keys = await idbKeys(STORE_TEMPLATES)
  /* If the store had not been created this would have rejected with
     NotFoundError, which idbKeys does not catch. */
  ok(Array.isArray(keys) && keys.length === 0, 'the templates store exists and is empty')
}

console.log('\n saveTemplate — a template owns its own bytes')
{
  await seedAssets()
  const nb = makeNotebook()
  const res = await saveTemplate(nb, { name: 'CRM starter', description: 'A CRM', newAssetId: assetId })

  ok(res.status === TPL_OK, 'a save reports a status rather than resolving to nothing')
  ok(res.template.name === 'CRM starter' && res.template.description === 'A CRM', 'with the name and description asked for')
  ok(res.missingAssets === 0, 'and nothing missing')

  const listed = await listTemplates()
  ok(listed.status === TPL_OK && listed.templates.length === 1, 'and it is in the list')
  ok(describeTemplate(listed.templates[0]) === '2 sheets · 5 blocks', 'summarised for the card')

  const stored = listed.templates[0]
  const imgBlock = stored.sheets[0].blocks.find(b => b.type === 'image')
  const pdfBlock = stored.sheets[1].blocks.find(b => b.type === 'pdf')

  ok(imgBlock.imageId !== 'img_live', 'the image block points at a COPY, not at the notebook\'s own id')
  ok(pdfBlock.pdfId !== 'pdf_live', 'and so does the PDF block')
  ok(stored.assets.images[0] === imgBlock.imageId && stored.assets.pdfs[0] === pdfBlock.pdfId,
     'and the template\'s asset manifest names the copies, not the originals')

  ok((await idbGet(STORE_IMAGES, imgBlock.imageId))?.blob?.tag === 'live-pixels',
     'the copied record holds the same bytes')
  ok((await idbGet(STORE_PDFS, pdfBlock.pdfId))?.name === 'contract', 'for the PDF too')

  /* THE POINT OF THE WHOLE FILE. Delete the source image the way AppPage's
     prune would after the block is removed, and read the template again. */
  await idbDelete(STORE_IMAGES, 'img_live')
  await idbDelete(STORE_PDFS, 'pdf_live')
  const after = await getTemplate(stored.id)
  ok((await idbGet(STORE_IMAGES, after.template.sheets[0].blocks[2].imageId))?.blob?.tag === 'live-pixels',
     'deleting the SOURCE notebook\'s image leaves the template\'s copy intact — without this the template is a set of references, not a template')
  ok((await idbGet(STORE_PDFS, after.template.sheets[1].blocks[1].pdfId))?.name === 'contract',
     'and the same for its PDF')

  /* The other half of "the original stays unchanged". */
  nb.sheets[0].blocks[0].name = 'MUTATED'
  nb.sheets[0].blocks.push({ id: 'b_new', type: 'text' })
  const reread = await getTemplate(stored.id)
  ok(reread.template.sheets[0].blocks[0].name === 'Acme', 'editing the live notebook afterwards cannot reach the stored template')
  ok(reread.template.sheets[0].blocks.length === 3, 'including additions')
  /* The RETURNED handle, not just the stored row. IndexedDB structured-clones
     on the way in, so the stored copy is insulated whatever happens upstream —
     which means the assertion above passes even if templateFromNotebook stops
     cloning. This one does not: the panel holds this object, names it in a
     toast, and would show a name the template does not have. */
  ok(res.template.sheets[0].blocks[0].name === 'Acme',
     'and so is the object saveTemplate hands back, which is the one the panel is holding')
}

console.log('\n saveTemplate — an asset whose bytes are already gone is reported, not hidden')
{
  await wipeTemplates()
  const nb = {
    id: 'nb_g', name: 'Ghost', sheets: [{
      id: 's1', name: 'S', connections: [],
      blocks: [{ id: 'b1', type: 'image', imageId: 'img_ghost' }],
    }],
  }
  const res = await saveTemplate(nb, { name: 'Ghost', newAssetId: assetId })
  ok(res.status === TPL_OK, 'the save still succeeds — that block was already showing a missing-image box')
  ok(res.missingAssets === 1, 'but the count is reported, so the panel can say so instead of shipping a quietly broken template')
  ok(res.template.sheets[0].blocks[0].imageId !== 'img_ghost',
     'and the block still gets a fresh id — sharing the notebook\'s id would let a prune of that notebook reach the template')
}

console.log('\n instantiate — a new workspace, sharing nothing with the template')
{
  await wipeTemplates()
  await seedAssets()
  const saved = await saveTemplate(makeNotebook(), { name: 'CRM starter', newAssetId: assetId })
  const tplId = saved.template.id
  const tplJson = JSON.stringify((await getTemplate(tplId)).template)

  const res = await instantiate(tplId, { name: 'Acme CRM', newAssetId: assetId })
  ok(res.status === TPL_OK, 'it reports a status')
  ok(res.notebook.name === 'Acme CRM', 'the copy takes the requested name')
  ok(res.droppedLinks === 0, 'a fully internal template drops no links')

  const tplIds = new Set(saved.template.sheets.flatMap(s => s.blocks.map(b => b.id)))
  const copyIds = res.notebook.sheets.flatMap(s => s.blocks.map(b => b.id))
  ok(copyIds.length === 5 && copyIds.every(id => !tplIds.has(id)),
     'every block id in the new workspace is new — a shared id makes the copy edit the original')

  const copyImg = res.notebook.sheets[0].blocks[2].imageId
  const tplImg = saved.template.sheets[0].blocks[2].imageId
  ok(copyImg !== tplImg && copyImg !== 'img_live',
     'the asset is copied AGAIN — two workspaces sharing bytes means cropping one crops the other, because lib/images.js writes crops back')
  ok((await idbGet(STORE_IMAGES, copyImg))?.blob?.tag === 'live-pixels', 'and the new record holds the bytes')

  const second = await instantiate(tplId, { newAssetId: assetId })
  ok(second.notebook.sheets[0].blocks[2].imageId !== copyImg, 'two workspaces made from one template get an asset each')
  ok(second.notebook.id !== res.notebook.id, 'and are distinct notebooks')

  ok(JSON.stringify((await getTemplate(tplId)).template) === tplJson,
     'and instantiating twice leaves the stored template byte-identical')

  /* The reference that lives inside HTML rather than in a field — the one a
     shallow copy is most likely to miss. */
  const txt = res.notebook.sheets[0].blocks.find(b => b.type === 'text')
  const task = res.notebook.sheets[1].blocks.find(b => b.type === 'task')
  ok(extractLinks(txt.content)[0].addr.blockId === task.id, 'a teleporter link points at the COPY of its target')
}

console.log('\n instantiate — links that pointed outside the template are counted')
{
  await wipeTemplates()
  const nb = {
    id: 'nb_x', name: 'X', sheets: [{
      id: 's1', name: 'S', connections: [],
      blocks: [{
        id: 'b1', type: 'text',
        content: `<p>a ${linkHtml({ notebookId: 'other', sheetId: 'os', blockId: 'ob' }, 'elsewhere')} b</p>`,
      }],
    }],
  }
  const saved = await saveTemplate(nb, { name: 'Outward', newAssetId: assetId })
  const res = await instantiate(saved.template.id, { newAssetId: assetId })
  ok(res.droppedLinks === 1, 'the count reaches the caller, so the panel can say it plainly instead of dropping them silently')
  ok(res.notebook.sheets[0].blocks[0].content.includes('elsewhere'), 'and the words are kept')
}

console.log('\n every function answers instead of throwing')
{
  await wipeTemplates()
  ok((await getTemplate('nope')).status === TPL_MISSING, 'getTemplate on an unknown id is a result, not an exception')
  ok(!!(await getTemplate('nope')).error, 'and it carries something to show')
  ok((await instantiate('nope')).status === TPL_MISSING, 'and so is instantiate')
  ok((await deleteTemplate('nope')).status === TPL_MISSING, 'and delete')
  ok((await renameTemplate('nope', 'x')).status === TPL_MISSING, 'and rename')

  const bad = await saveTemplate(null, { name: 'x' })
  ok(bad.status === TPL_INVALID && !!bad.error, 'saving a non-notebook is refused with a reason rather than throwing')

  /* A record from a build that does not exist yet. Templates are meant to be
     shareable, so this is reachable without anyone doing anything wrong. */
  await idbSet(STORE_TEMPLATES, 'tpl_future', {
    id: 'tpl_future', version: TEMPLATE_VERSION + 1, name: 'From the future',
    sheets: [{ id: 's', name: 'S', blocks: [] }], createdAt: 1,
  })
  const future = await instantiate('tpl_future')
  ok(future.status === TPL_INVALID, 'a template from a newer build is refused')
  ok(/newer version/i.test(future.error), 'and says why, rather than half-importing it')
  await idbDelete(STORE_TEMPLATES, 'tpl_future')
}

console.log('\n a store that is failing says so')
{
  await wipeTemplates()
  ctl.failOps = 1
  const res = await saveTemplate(makeNotebook(), { name: 'Doomed', newAssetId: assetId })
  ok(res.status === TPL_FAILED, 'a failed write comes back as a status, never as a rejected promise')
  ok(!!res.error, 'with a message the panel can show')

  ctl.failOps = 1
  const listed = await listTemplates()
  ok(listed.status === TPL_FAILED && Array.isArray(listed.templates) && listed.templates.length === 0,
     'a failed list still hands back an array, so the panel renders empty rather than crashing')

  ctl.failOps = 1
  ctl.failWith = Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' })
  const full = await saveTemplate(makeNotebook(), { name: 'Too big', newAssetId: assetId })
  ok(full.status === TPL_QUOTA, 'a full disk is distinguished from a broken one — the two need different advice')
  ok(/storage/i.test(full.error), 'and the advice is about storage')
  ctl.failWith = null
  ctl.failOps = 0
}

console.log('\n rename')
{
  await wipeTemplates()
  const saved = await saveTemplate(makeNotebook(), { name: 'Before', newAssetId: assetId })
  const id = saved.template.id

  const res = await renameTemplate(id, '  After  ')
  ok(res.status === TPL_OK && res.template.name === 'After', 'a rename trims and applies')
  const reread = (await getTemplate(id)).template
  ok(reread.name === 'After', 'and is stored')
  ok(reread.sheets.length === 2 && reread.createdAt === saved.template.createdAt,
     'read-modify-write, so nothing else in the record is lost')

  ok((await renameTemplate(id, '   ')).status === TPL_INVALID, 'an all-whitespace name is refused')
  ok((await getTemplate(id)).template.name === 'After', 'and the old name survives the refusal')
}

console.log('\n delete offers a way back, and does not take the pictures with it')
{
  await wipeTemplates()
  await seedAssets()
  const saved = await saveTemplate(makeNotebook(), { name: 'Doomed', newAssetId: assetId })
  const id = saved.template.id
  const imgId = saved.template.sheets[0].blocks[2].imageId

  const res = await deleteTemplate(id)
  ok(res.status === TPL_OK, 'the delete happens — no confirm dialog, per components/ui/Toast.js')
  ok(res.template?.id === id, 'and hands the record back, which is what UNDO puts back')
  ok((await listTemplates()).templates.length === 0, 'the list no longer has it')

  /* The autosave prune runs 600ms later and the undo toast lasts seven
     seconds. If the keep-set dropped these the moment the record went, UNDO
     would restore a template whose images had already been collected. */
  const keep = await templateAssetIds()
  ok(keep.status === TPL_OK && keep.images.includes(imgId),
     'its asset ids stay in the prune keep-set while UNDO is still on offer')

  const back = await restoreTemplate(res.template)
  ok(back.status === TPL_OK, 'restoring reports a status too')
  const listed = await listTemplates()
  ok(listed.templates.length === 1 && listed.templates[0].name === 'Doomed', 'and the template is back')
  ok((await idbGet(STORE_IMAGES, imgId))?.blob?.tag === 'live-pixels', 'with its image still readable')
}

console.log('\n templateAssetIds — what AppPage must not prune')
{
  await wipeTemplates()
  await seedAssets()
  const a = await saveTemplate(makeNotebook(), { name: 'One', newAssetId: assetId })
  const b = await saveTemplate(makeNotebook(), { name: 'Two', newAssetId: assetId })

  const keep = await templateAssetIds()
  ok(keep.status === TPL_OK, 'it reports a status')
  ok(keep.images.includes(a.template.sheets[0].blocks[2].imageId) &&
     keep.images.includes(b.template.sheets[0].blocks[2].imageId),
     'every stored template\'s images are in the keep-set — the first autosave after a save would otherwise delete exactly the bytes that were just copied')
  ok(keep.pdfs.includes(a.template.sheets[1].blocks[1].pdfId), 'and its PDFs')
  ok(a.template.sheets[0].blocks[2].imageId !== b.template.sheets[0].blocks[2].imageId,
     'two templates of one notebook do not share an asset id')

  /* Deleting one leaves grace entries in memory, and THAT is what makes the
     next two assertions discriminating. Without a pending delete the
     in-memory half of the answer is empty, so a version that leaks whatever it
     is holding on a failure returns an empty list too and the test passes on
     both. It did, until this line was added. */
  const del = await deleteTemplate(b.template.id)
  const bImg = del.template.sheets[0].blocks[2].imageId
  ok((await templateAssetIds()).images.includes(bImg), 'a pending delete is held in memory, so there is something to leak')

  ctl.failOps = 1
  const broken = await templateAssetIds()
  ok(broken.status !== TPL_OK, 'a failed scan reports failure rather than a short answer')
  ok(!broken.images.includes(bImg) && broken.pdfs.length === 0,
     'and hands back nothing at all — half an answer that looks like a whole one is how a keep-set becomes a delete list')
  ctl.failOps = 0
}

console.log('\n the workspace seeded under v2 is STILL there at the end')
{
  /* Everything above has written, deleted and pruned. The one row that must
     never have been touched is the one that was there before Builder existed. */
  const state = await idbGet(STORE_STATE, 'workspace')
  ok(state?.notebooks?.[0]?.name === 'Existing work', 'the pre-existing workspace survived the whole suite')
}

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
