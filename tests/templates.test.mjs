/*
  tests/templates.test.mjs
  --------------------------------------------------------------------------
  §9.1 Builder — save a workspace as a template, duplicate it, and have the
  original stay untouched.

  THE FAILURE THIS FILE EXISTS TO CATCH is not a crash. It is a duplicate that
  looks perfect and is quietly wired to the wrong workspace.

  A notebook is a graph. The edges are ids, stored in four separate places:
  connections, a child's parentSectionId, a calendar block's sources, and
  teleporter addresses embedded INSIDE text HTML. A deep clone copies those ids
  along with everything else. The copy then renders exactly right — every block
  present, in the right position — while its links and connections point at the
  ORIGINAL's blocks. Nothing throws. Nothing is visibly wrong. Then you edit the
  copy and the original moves, or you delete the original and the copy dangles.

  So the assertions below are mostly of one shape: *no id from the original
  survives anywhere in the copy*, and every reference resolves inside the copy.
  -------------------------------------------------------------------------- */

import {
  templateFromNotebook, instantiateTemplate, remapLinksInHtml,
  collectAssetIds, validateTemplate, describeTemplate, TEMPLATE_VERSION,
} from '../lib/templates.js'
import { linkHtml, extractLinks } from '../lib/teleport.js'

let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }

/* Deterministic ids, so an assertion can name an exact value instead of
   pattern-matching and hoping. */
let n = 0
const newId = p => `${p}${++n}`
const reset = () => { n = 0 }

/* A workspace that uses every kind of internal reference at once. Anything
   simpler passes even when the remapping is broken. */
const makeNotebook = () => ({
  id: 'nb_src',
  name: 'CRM',
  activeSheetId: 's2',
  sheets: [
    {
      id: 's1',
      name: 'Companies',
      blocks: [
        { id: 'b_sec', type: 'section', name: 'Acme', x: 0, y: 0, w: 400, h: 300 },
        { id: 'b_txt', type: 'text', x: 10, y: 10, parentSectionId: 'b_sec',
          content: `<p>See ${linkHtml({ notebookId: 'nb_src', sheetId: 's2', blockId: 'b_task' }, 'the deal')}</p>` },
        { id: 'b_img', type: 'image', imageId: 'img_1', x: 20, y: 20 },
      ],
      connections: [
        { id: 'c1', fromBlockId: 'b_sec', toBlockId: 'b_txt', kind: 'depends' },
      ],
      drawings: [{ id: 'd1', points: [{ x: 1, y: 2 }] }],
    },
    {
      id: 's2',
      name: 'Deals',
      blocks: [
        { id: 'b_task', type: 'task', title: 'Close Acme', status: 'todo', deadline: '2026-09-01' },
        { id: 'b_cal', type: 'calendar', view: 'month', sources: [{ kind: 'tasks', blockId: 'b_task' }] },
        { id: 'b_pdf', type: 'pdf', pdfId: 'pdf_1' },
      ],
      connections: [],
    },
  ],
})

console.log('\n templateFromNotebook')
{
  reset()
  const nb = makeNotebook()
  const t = templateFromNotebook(nb, { name: 'CRM starter', description: 'A CRM', newId, now: 1000 })

  ok(t.version === TEMPLATE_VERSION, 'carries a version, so a future reader can refuse it')
  ok(t.name === 'CRM starter' && t.description === 'A CRM', 'name and description are kept')
  ok(t.sheets.length === 2 && t.blockCount === 6, 'every sheet and block is captured')
  ok(t.sourceNotebookId === 'nb_src', 'the source notebook id is recorded, so internal links can be recognised')
  ok(t.activeSheetId === undefined,
     'activeSheetId is NOT captured — it is where the author happened to be looking, not content')

  /* Half of "the original stays unchanged": a later edit to the live notebook
     must not reach into a template already saved. */
  nb.sheets[0].blocks[0].name = 'MUTATED'
  nb.sheets[0].blocks.push({ id: 'b_new', type: 'text' })
  ok(t.sheets[0].blocks[0].name === 'Acme', 'the snapshot is deep-cloned — editing the notebook cannot reach it')
  ok(t.sheets[0].blocks.length === 3, 'including additions')

  ok(templateFromNotebook({ id: 'x', sheets: [] }, { newId }).name === 'Untitled template',
     'an unnamed notebook still yields a usable template name')
  let threw = false
  try { templateFromNotebook(null) } catch { threw = true }
  ok(threw, 'a non-notebook throws rather than producing an empty template')
}

console.log('\n collectAssetIds')
{
  const a = collectAssetIds(makeNotebook())
  ok(a.images.length === 1 && a.images[0] === 'img_1', 'image ids are collected')
  ok(a.pdfs.length === 1 && a.pdfs[0] === 'pdf_1', 'pdf ids are collected')
  ok(collectAssetIds({ sheets: [] }).images.length === 0, 'an empty workspace needs no assets')
  ok(collectAssetIds(null).pdfs.length === 0, 'null does not throw')
  /* Without this list the caller cannot copy the bytes, and the template
     renders missing-asset boxes on any machine but the author's. */
  ok(templateFromNotebook(makeNotebook(), { newId }).assets.images[0] === 'img_1',
     'and the template carries them, so the caller knows what to copy')
}

console.log('\n instantiateTemplate — no original id may survive')
{
  reset()
  const nb = makeNotebook()
  const t = templateFromNotebook(nb, { newId, now: 1000 })
  const { notebook: copy, droppedLinks } = instantiateTemplate(t, { name: 'Acme CRM', newId })

  const serialised = JSON.stringify(copy)
  const originalIds = ['nb_src', 's1', 's2', 'b_sec', 'b_txt', 'b_img', 'b_task', 'b_cal', 'b_pdf', 'c1']
  for (const id of originalIds) {
    ok(!serialised.includes(`"${id}"`) && !serialised.includes(`/${id}`),
       `no trace of the original id "${id}" anywhere in the copy`)
  }

  ok(copy.name === 'Acme CRM', 'the copy takes the requested name')
  ok(copy.sheets.length === 2, 'both sheets came across')
  ok(copy.sheets[0].blocks.length === 3 && copy.sheets[1].blocks.length === 3, 'and every block')
  ok(copy.activeSheetId === copy.sheets[0].id, 'the copy opens on its own first sheet')
  ok(copy.fromTemplateId === t.id, 'provenance is recorded')
  ok(droppedLinks === 0, 'a fully internal workspace drops no links')
}

console.log('\n instantiateTemplate — every reference resolves INSIDE the copy')
{
  reset()
  const t = templateFromNotebook(makeNotebook(), { newId, now: 1000 })
  const { notebook: copy } = instantiateTemplate(t, { newId })

  const [s1, s2] = copy.sheets
  const ids = new Set(copy.sheets.flatMap(s => s.blocks.map(b => b.id)))

  const sec = s1.blocks.find(b => b.type === 'section')
  const txt = s1.blocks.find(b => b.type === 'text')
  ok(txt.parentSectionId === sec.id, 'a child points at the COPY of its section, not the original')

  const conn = s1.connections[0]
  ok(conn.fromBlockId === sec.id && conn.toBlockId === txt.id, 'a connection is rewired to the copies')
  ok(ids.has(conn.fromBlockId) && ids.has(conn.toBlockId), 'and both endpoints exist in the copy')
  ok(conn.id !== 'c1', 'the connection itself gets a new id')
  ok(conn.kind === 'depends', 'while keeping what it meant')

  const cal = s2.blocks.find(b => b.type === 'calendar')
  const task = s2.blocks.find(b => b.type === 'task')
  ok(cal.sources[0].blockId === task.id, 'a calendar source points at the copied task')

  /* The one stored inside HTML, which is the reference a deep clone is most
     likely to miss because it is not a field. */
  const links = extractLinks(txt.content)
  ok(links.length === 1, 'the teleporter link survived')
  ok(links[0].addr.blockId === task.id, 'and points at the COPY of its target block')
  ok(links[0].addr.sheetId === s2.id, 'with the copy\'s sheet id')
  ok(links[0].addr.notebookId === copy.id, 'and the copy\'s notebook id')
  ok(txt.content.includes('the deal'), 'the link label is untouched')

  ok(s1.drawings.length === 1 && s1.drawings[0].points[0].x === 1, 'drawings come across')
  ok(task.deadline === '2026-09-01' && task.title === 'Close Acme', 'block content is preserved verbatim')
  ok(s2.blocks.find(b => b.type === 'pdf').pdfId === 'pdf_1',
     'asset ids are NOT remapped — the bytes are shared, and the caller decides whether to copy them')
}

console.log('\n instantiateTemplate — the template is not modified, ever')
{
  reset()
  const t = templateFromNotebook(makeNotebook(), { newId, now: 1000 })
  const before = JSON.stringify(t)

  const { notebook: a } = instantiateTemplate(t, { newId })
  const { notebook: b } = instantiateTemplate(t, { newId })

  ok(JSON.stringify(t) === before, 'instantiating twice leaves the template byte-identical')

  /* Editing a copy must not reach the template or the sibling copy. */
  a.sheets[0].blocks[0].name = 'CHANGED'
  a.sheets[0].blocks.push({ id: 'extra', type: 'text' })
  ok(JSON.stringify(t) === before, 'editing a copy does not touch the template')
  ok(b.sheets[0].blocks[0].name === 'Acme', 'nor a sibling copy')
  ok(b.sheets[0].blocks.length === 3, 'nor its block count')

  ok(a.id !== b.id, 'two copies are distinct notebooks')
  ok(a.sheets[0].blocks[0].id !== b.sheets[0].blocks[0].id, 'down to every block id')
}

console.log('\n links that point OUTSIDE the template are dropped, not left dangling')
{
  reset()
  const nb = {
    id: 'nb_src', name: 'N', sheets: [{
      id: 's1', name: 'S', connections: [],
      blocks: [{
        id: 'b1', type: 'text',
        content: `<p>a ${linkHtml({ notebookId: 'other_nb', sheetId: 'other_s', blockId: 'other_b' }, 'elsewhere')} b</p>`,
      }],
    }],
  }
  const t = templateFromNotebook(nb, { newId })
  const { notebook: copy, droppedLinks } = instantiateTemplate(t, { newId })
  const content = copy.sheets[0].blocks[0].content

  ok(droppedLinks === 1, 'the outside link is counted')
  ok(!content.includes('other_b'), 'and does not survive pointing at a stranger\'s workspace')
  ok(!content.includes('data-ds-link'), 'the span is unwrapped entirely')
  ok(content.includes('elsewhere'), 'but its text is kept — silently deleting the words would be worse')
  ok(content.includes('a ') && content.includes(' b'), 'and the surrounding prose is intact')
}

console.log('\n partial templates degrade safely')
{
  reset()
  /* A connection to a block that is not in the template, and a child whose
     section is not in the template. Both are reachable if someone builds a
     template from a selection later. */
  const t = {
    id: 'tpl1', version: TEMPLATE_VERSION, name: 'Partial', sheets: [{
      id: 's1', name: 'S',
      blocks: [
        { id: 'b1', type: 'text', parentSectionId: 'missing_section' },
        { id: 'b2', type: 'text' },
      ],
      connections: [
        { id: 'c1', fromBlockId: 'b1', toBlockId: 'gone' },
        { id: 'c2', fromBlockId: 'b1', toBlockId: 'b2' },
      ],
    }],
  }
  const { notebook: copy } = instantiateTemplate(t, { newId })
  ok(copy.sheets[0].connections.length === 1, 'a connection with a missing endpoint is dropped')
  ok(copy.sheets[0].blocks[0].parentSectionId === undefined,
     'a child of a missing section becomes a free block — an unresolvable parent makes it invisible, which reads as data loss')

  let threw = false
  try { instantiateTemplate({ version: 1 }) } catch { threw = true }
  ok(threw, 'a template with no sheets throws rather than yielding an empty notebook')
}

console.log('\n remapLinksInHtml')
{
  const addr = { notebookId: 'n1', sheetId: 's1', blockId: 'b1' }
  const html = `<p>x ${linkHtml(addr, 'label')} y</p>`
  const out = remapLinksInHtml(html, () => ({ notebookId: 'N', sheetId: 'S', blockId: 'B' }))
  ok(extractLinks(out)[0].addr.blockId === 'B', 'an address is rewritten through the map')
  ok(out.includes('label'), 'the label is untouched')

  ok(remapLinksInHtml('<p>no links</p>', () => null) === '<p>no links</p>', 'text without links is returned as-is')
  ok(remapLinksInHtml('', () => null) === '' && remapLinksInHtml(null, () => null) === '', 'empty input is safe')

  /* Two links, one mappable and one not, in the same block. */
  const mixed = `<p>${linkHtml({ notebookId: 'n', sheetId: 's', blockId: 'keep' }, 'A')} and ${linkHtml({ notebookId: 'n', sheetId: 's', blockId: 'drop' }, 'B')}</p>`
  const res = remapLinksInHtml(mixed, a => (a.blockId === 'keep' ? { notebookId: 'N', sheetId: 'S', blockId: 'K' } : null))
  ok(extractLinks(res).length === 1, 'only the mappable link survives as a link')
  ok(res.includes('A') && res.includes('B'), 'both labels remain as text')
}

console.log('\n validateTemplate')
{
  const good = templateFromNotebook(makeNotebook(), { newId })
  ok(validateTemplate(good).ok, 'a template this build produced is accepted')
  ok(!validateTemplate(null).ok && !validateTemplate('x').ok, 'junk is refused')
  ok(!validateTemplate({ sheets: [] }).ok, 'a missing version is refused')
  ok(!validateTemplate({ version: 1, sheets: [] }).ok, 'no sheets is refused')
  ok(!validateTemplate({ version: 1, sheets: [{ id: 's' }] }).ok, 'a sheet with no blocks array is refused')

  /* Templates will arrive from other people — Matas's note says shareable. A
     newer file must be refused with a reason, not half-imported. */
  const future = validateTemplate({ version: TEMPLATE_VERSION + 1, sheets: [{ id: 's', blocks: [] }] })
  ok(!future.ok && /newer version/i.test(future.reason), 'a template from a newer build is refused, and says why')
}

console.log('\n describeTemplate')
{
  ok(describeTemplate(templateFromNotebook(makeNotebook(), { newId })) === '2 sheets · 6 blocks', 'summarises a template')
  ok(describeTemplate({ sheets: [{ blocks: [{}] }] }) === '1 sheet · 1 block', 'and singularises correctly')
}

console.log(`\n  ${pass} passed, ${fail} failed`)
export default { pass, fail }
