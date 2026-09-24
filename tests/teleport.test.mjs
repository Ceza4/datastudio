/*
  tests/teleport.test.mjs
  --------------------------------------------------------------------------
  Links between blocks.

  The risk here is different from the block registry's. A teleport link lives
  inside text the user wrote, and text gets edited, pasted, undone and copied
  between blocks. Every one of those operations runs the link through the
  browser's HTML normaliser, which reorders attributes, re-encodes entities
  and sometimes splits nodes. So the parsing has to survive markup that isn't
  byte-identical to what was written — which is what most of this file checks.
  -------------------------------------------------------------------------- */

import {
  LINK_ATTR, LINK_CLASS,
  makeAddress, serializeAddress, parseAddress, sameAddress,
  linkHtml, extractLinks,
  resolveTarget, isDangling, DANGLING_MESSAGE,
  blockLabel, findBacklinks, backlinkCount,
  fuzzyScore, searchBlocks,
} from '../lib/teleport.js'

let pass = 0, fail = 0
const ok = (c, m, extra = '') => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log(`  FAIL ${m}${extra ? '\n        ' + extra : ''}`)) }

/* A workspace: two notebooks, three sheets, several blocks, one link that
   crosses a notebook boundary and one that points at a deleted block. */
const WS = [
  {
    id: 'nb1', name: 'Research',
    sheets: [
      {
        id: 'sh1', name: 'Companies',
        blocks: [
          { id: 'b_acme', type: 'table', name: 'Acme Corp', headers: ['Name', 'Deal'], rows: [['a', 'b']] },
          { id: 'b_note', type: 'text', name: '', content: 'See <span data-ds-link="nb1/sh1/b_acme" class="ds-teleport">Acme Corp</span> for detail.' },
          { id: 'b_dead', type: 'text', name: 'Broken', content: 'Old <span data-ds-link="nb1/sh1/b_gone" class="ds-teleport">deleted thing</span>.' },
        ],
      },
      { id: 'sh2', name: 'Q3 Pipeline', blocks: [
        { id: 'b_pipe', type: 'kanban', name: 'Pipeline' },
        { id: 'b_x', type: 'text', name: 'Cross', content: 'To <span data-ds-link="nb2/sh3/b_far" class="ds-teleport">the other notebook</span>.' },
      ] },
    ],
  },
  {
    id: 'nb2', name: 'Personal',
    sheets: [{ id: 'sh3', name: 'Inbox', blocks: [{ id: 'b_far', type: 'text', name: 'Far away', content: 'hi' }] }],
  },
]

/* ── addresses ───────────────────────────────────────────────────────── */
console.log('\n addresses')
{
  const a = makeAddress('nb1', 'sh1', 'b_acme')
  ok(a.notebookId === 'nb1' && a.sheetId === 'sh1' && a.blockId === 'b_acme', 'makeAddress keeps all three parts')
  ok(makeAddress('nb1', 'sh1', null) === null, 'a partial address is rejected, not half-built')
  ok(makeAddress(null, null, 'b1') === null, 'a bare block id is not a valid address')

  ok(serializeAddress(a) === 'nb1/sh1/b_acme', 'serialises to a slash path')
  ok(sameAddress(parseAddress(serializeAddress(a)), a), 'round-trips exactly')
  ok(serializeAddress(null) === '', 'null serialises to empty rather than "null"')

  ok(JSON.stringify(parseAddress('a/b')) === JSON.stringify({ notebookId: 'a', sheetId: 'b' }), 'two segments = a sheet link (since 24 Sep 2026)')
  ok(JSON.stringify(parseAddress('a')) === JSON.stringify({ notebookId: 'a' }), 'one segment = a notebook link')
  ok(parseAddress('a/b/c/d') === null, 'four segments rejected')
  ok(parseAddress('') === null, 'empty string rejected')
  ok(parseAddress(null) === null, 'null rejected')
  ok(parseAddress(42) === null, 'non-string rejected')
  ok(parseAddress('a//c') === null, 'an empty middle segment is rejected, not treated as valid')
  ok(parseAddress('%E0%A4%A/b/c') === null, 'malformed percent-encoding returns null instead of throwing')

  /* Today's id generators can't emit a slash — but parsing that only works
     while that stays true is parsing waiting to break. */
  const weird = makeAddress('nb/with/slash', 'sh 1', 'b?&=#')
  ok(sameAddress(parseAddress(serializeAddress(weird)), weird), 'ids containing / ? & = # survive a round trip')
}

/* ── HTML ────────────────────────────────────────────────────────────── */
console.log('\n link HTML')
{
  const addr = makeAddress('nb1', 'sh1', 'b_acme')
  const html = linkHtml(addr, 'Acme Corp')
  ok(html.includes(`${LINK_ATTR}="nb1/sh1/b_acme"`), 'address written into the attribute')
  ok(html.includes(`class="${LINK_CLASS}"`), 'carries the styling class')
  ok(html.includes('&nbsp;'), 'trailing space, so typing after the link is not swallowed into it')
  ok(!html.includes('<a '), 'not an anchor — it must not look or behave like a web link')

  ok(linkHtml(addr, '<script>x</script>').includes('&lt;script&gt;'), 'the label is escaped')
  /* The escaped output still CONTAINS the substring "onerror=x" — as inert
     text, because the angle brackets became entities and it can no longer
     open a tag. Asserting on the substring rather than on the structure is the
     wrong test, and it fails on safe output. */
  const evil = linkHtml(addr, '<img onerror=x>')
  ok(!/<img/i.test(evil), 'markup in a label cannot open a tag')
  ok(evil.includes('&lt;img'), '…it is escaped to inert text instead')
  ok((evil.match(/</g) || []).length === 2, 'exactly two real tags in the output: the opening and closing span')
  ok(linkHtml(addr, 'A & B').includes('&amp;'), 'ampersand escaped')
  ok(linkHtml(null, 'text') === 'text', 'a bad address degrades to plain text, not a broken link')
  ok(linkHtml(addr, '').includes('Untitled block'), 'an empty label gets a readable fallback')
}

console.log('\n extractLinks — must survive browser-normalised markup')
{
  const one = extractLinks(WS[0].sheets[0].blocks[1].content)
  ok(one.length === 1, 'finds a single link')
  ok(one[0].addr.blockId === 'b_acme', 'reads the target')
  ok(one[0].label === 'Acme Corp', 'reads the label')

  // contenteditable freely reorders attributes; matching must not assume order.
  ok(extractLinks(`<span class="ds-teleport" ${LINK_ATTR}="nb1/sh1/b1">X</span>`).length === 1,
     'class BEFORE the data attribute still matches')
  ok(extractLinks(`<span ${LINK_ATTR}="nb1/sh1/b1" style="color:red" class="ds-teleport">X</span>`).length === 1,
     'extra attributes in between still match')
  ok(extractLinks(`<SPAN ${LINK_ATTR.toUpperCase()}="nb1/sh1/b1">X</SPAN>`).length === 1,
     'uppercase tag and attribute still match')

  ok(extractLinks('<span data-ds-link="nb1/sh1/b1"><b>Bold</b> label</span>')[0].label === 'Bold label',
     'nested formatting inside a label is flattened, not returned as markup')

  const two = extractLinks('<p><span data-ds-link="a/b/c">One</span> and <span data-ds-link="d/e/f">Two</span></p>')
  ok(two.length === 2 && two[0].label === 'One' && two[1].label === 'Two', 'two links on one line, in document order')

  ok(extractLinks('') .length === 0, 'empty content')
  ok(extractLinks(null).length === 0, 'null content does not throw')
  ok(extractLinks('<p>no links here</p>').length === 0, 'plain text yields nothing')
  ok(extractLinks('<span data-ds-link="a/b/c/d">X</span>').length === 0, 'a malformed address is skipped, not returned half-parsed (one segment is now a valid notebook link, so four is the malformed case)')
  ok(extractLinks('<span>no attr</span>').length === 0, 'a plain span is not mistaken for a link')
}

/* ── resolution ──────────────────────────────────────────────────────── */
console.log('\n resolveTarget')
{
  const good = resolveTarget(WS, makeAddress('nb1', 'sh1', 'b_acme'))
  ok(good.ok && good.block.id === 'b_acme', 'resolves a live target')
  ok(good.sheet.id === 'sh1' && good.notebook.id === 'nb1', 'returns the containing sheet and notebook too')

  ok(resolveTarget(WS, makeAddress('nb1', 'sh1', 'b_gone')).reason === 'block', 'missing block reported as "block"')
  ok(resolveTarget(WS, makeAddress('nb1', 'sh_gone', 'b_acme')).reason === 'sheet', 'missing sheet reported as "sheet"')
  ok(resolveTarget(WS, makeAddress('nb_gone', 'sh1', 'b_acme')).reason === 'notebook', 'missing notebook reported as "notebook"')
  ok(resolveTarget(WS, null).reason === 'invalid', 'null address reported as "invalid"')
  ok(resolveTarget([], makeAddress('a', 'b', 'c')).ok === false, 'empty workspace resolves nothing')
  ok(resolveTarget(null, makeAddress('a', 'b', 'c')).ok === false, 'null workspace does not throw')

  /* The reason drives the tooltip, so every branch needs wording — a link
     that says "undefined" is worse than one that says nothing. */
  for (const r of ['invalid', 'notebook', 'sheet', 'block']) {
    ok(typeof DANGLING_MESSAGE[r] === 'string' && DANGLING_MESSAGE[r].length > 0, `"${r}" has a human message`)
  }

  ok(isDangling(WS, makeAddress('nb1', 'sh1', 'b_gone')) === true, 'a deleted target is dangling')
  ok(isDangling(WS, makeAddress('nb1', 'sh1', 'b_acme')) === false, 'a live target is not')

  // The cross-notebook case is the whole reason addresses are three parts.
  ok(resolveTarget(WS, makeAddress('nb2', 'sh3', 'b_far')).ok, 'resolves into a different notebook entirely')
}

/* ── labels ──────────────────────────────────────────────────────────── */
console.log('\n blockLabel')
{
  ok(blockLabel({ type: 'text', name: 'Named' }) === 'Named', 'an explicit name wins')
  ok(blockLabel({ type: 'text', content: '<p>Some prose here</p>' }) === 'Some prose here', 'unnamed text falls back to its content')
  ok(blockLabel({ type: 'text', content: '<p>' + 'x'.repeat(80) + '</p>' }).endsWith('…'), 'long content is truncated')
  ok(blockLabel({ type: 'table', headers: ['A', 'B', 'C', 'D'] }) === 'A, B, C', 'a table falls back to its first three headers')
  ok(blockLabel({ type: 'kanban' }, 'Kanban Board') === 'Kanban Board', 'otherwise the type label')
  ok(blockLabel(null) === 'Untitled', 'null does not throw')
  ok(blockLabel({ type: 'text', content: '<p>   </p>' }, 'Text Block') === 'Text Block', 'whitespace-only content is not a label')
}

/* ── backlinks ───────────────────────────────────────────────────────── */
console.log('\n backlinks')
{
  const bl = findBacklinks(WS, 'b_acme')
  ok(bl.length === 1, 'finds the one block linking to Acme')
  ok(bl[0].from.blockId === 'b_note', 'records where it came from')
  ok(bl[0].label === 'Acme Corp', 'records the link text')
  ok(bl[0].sheetName === 'Companies' && bl[0].notebookName === 'Research', 'records the full path for display')

  ok(findBacklinks(WS, 'b_far').length === 1, 'finds a backlink that crosses a notebook boundary')
  ok(findBacklinks(WS, 'b_pipe').length === 0, 'a block nothing points at has no backlinks')
  ok(findBacklinks(WS, 'b_gone').length === 1, 'a DELETED block still reports who pointed at it — that is how you find the broken link')
  ok(findBacklinks(WS, null).length === 0, 'null id yields nothing')
  ok(findBacklinks(null, 'b_acme').length === 0, 'null workspace does not throw')
  ok(backlinkCount(WS, 'b_acme') === 1, 'backlinkCount agrees with findBacklinks')

  // A block that links to itself shouldn't report itself as a backlink.
  const selfy = [{ id: 'n', name: 'N', sheets: [{ id: 's', name: 'S', blocks: [
    { id: 'b_self', type: 'text', content: '<span data-ds-link="n/s/b_self">me</span>' },
  ] }] }]
  ok(findBacklinks(selfy, 'b_self').length === 0, 'a self-link is not counted as a backlink')

  // Two links from the same block to the same target are two backlinks.
  const twice = [{ id: 'n', name: 'N', sheets: [{ id: 's', name: 'S', blocks: [
    { id: 'tgt', type: 'text', content: 'x' },
    { id: 'src', type: 'text', content: '<span data-ds-link="n/s/tgt">a</span> and <span data-ds-link="n/s/tgt">b</span>' },
  ] }] }]
  ok(findBacklinks(twice, 'tgt').length === 2, 'two links from one block count twice')
}

/* ── search ──────────────────────────────────────────────────────────── */
console.log('\n fuzzyScore')
{
  ok(fuzzyScore('', 'anything') === 0, 'an empty query matches everything equally')
  ok(fuzzyScore('acme', 'Acme Corp') < fuzzyScore('acme', 'The Acme Corp'), 'a prefix match beats a mid-string match')
  ok(fuzzyScore('corp', 'Acme Corp') !== null, 'a mid-string match still matches')
  ok(fuzzyScore('ac', 'Acme') < fuzzyScore('ae', 'Acme'), 'contiguous beats scattered')
  ok(fuzzyScore('zzz', 'Acme') === null, 'no match returns null, not a large number')
  ok(fuzzyScore('a', '') === null, 'empty text never matches')
  ok(fuzzyScore('ACME', 'acme corp') !== null, 'case insensitive')
  ok(fuzzyScore('q3 d', 'Q3 Deal') !== null, 'spaces in the query are fine')
  // Regex metacharacters in a query must not blow up the word-boundary test.
  for (const q of ['a(', 'b[', 'c*', 'd+', 'e?', 'f\\', '.', '$']) {
    let threw = false
    try { fuzzyScore(q, 'sample text') } catch { threw = true }
    ok(!threw, `a query containing "${q}" does not throw`)
  }
}

console.log('\n searchBlocks')
{
  const all = searchBlocks(WS, '')
  ok(all.length === 6, 'an empty query lists every block in the workspace')
  ok(all.every(r => r.addr && r.addr.notebookId && r.addr.sheetId && r.addr.blockId), 'every result carries a full address')

  const acme = searchBlocks(WS, 'acme')
  ok(acme[0].block.id === 'b_acme', 'searching a block name ranks it first')

  ok(searchBlocks(WS, 'pipeline').some(r => r.block.id === 'b_pipe'), 'finds by block name')
  ok(searchBlocks(WS, 'q3').some(r => r.sheetName === 'Q3 Pipeline'), 'finds blocks by their SHEET name')
  ok(searchBlocks(WS, 'personal').some(r => r.notebookName === 'Personal'), 'finds blocks by their NOTEBOOK name')

  ok(searchBlocks(WS, '', { exclude: 'b_acme' }).every(r => r.block.id !== 'b_acme'),
     'the block being linked FROM is excluded — you cannot link a block to itself')

  ok(searchBlocks(WS, 'zzzzzz').length === 0, 'no matches returns empty')
  ok(searchBlocks(WS, '', { limit: 2 }).length === 2, 'limit respected')
  ok(searchBlocks(null, 'x').length === 0, 'null workspace does not throw')
  ok(searchBlocks([], '').length === 0, 'empty workspace')

  // Results must not reshuffle between identical queries, or rows move under
  // the cursor as you type and you click the wrong one.
  const a = searchBlocks(WS, 'e').map(r => r.block.id).join(',')
  const b = searchBlocks(WS, 'e').map(r => r.block.id).join(',')
  ok(a === b, 'ordering is stable for the same query')
}

console.log(`\n ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
