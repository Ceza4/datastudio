/*
  tests/files.test.mjs
  --------------------------------------------------------------------------
  §8 attachments — the pure half.

  The storage half (putFile/getFile/pruneFiles) needs IndexedDB and belongs in
  tests/browser/. What is here is everything that decides what a file IS
  before any of it is written: the size gate, the id, the labels.

  THE ID TEST IS THE ONE THAT MATTERS. A file id is the ONLY key its bytes
  have — lose it or collide it and the blob is unreachable with no error
  anywhere. `file_${Date.now()}` was exactly that bug in the workbook
  importer: two files dropped together finished in the same millisecond and
  the second silently overwrote the first.
  -------------------------------------------------------------------------- */

import {
  MAX_FILE_BYTES, HANDLED_ELSEWHERE, extOf, fileKind, fileIcon,
  newFileId, processFile, formatSize,
} from '../lib/files.js'

let pass = 0, fail = 0
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) }

/* A stand-in for File. `slice` is the only method processFile uses, and
   returning a marker object is enough to prove it copied rather than kept the
   original handle. */
const fakeFile = (name, size, type) => ({
  name, size, type,
  slice: (a, b, t) => ({ __blob: true, from: name, type: t }),
})

console.log('\n extensions')
{
  ok(extOf('a.docx') === '.docx', 'a plain extension')
  ok(extOf('A.DOCX') === '.docx', 'lowercased, so routing is not case-sensitive')
  ok(extOf('archive.tar.gz') === '.gz', 'the LAST extension wins')
  ok(extOf('noext') === '', 'a file with no extension')
  ok(extOf('/some/path.d/file') === '', 'and a dot in a DIRECTORY name is not the file’s extension')
  ok(extOf(null) === '' && extOf(undefined) === '', 'null and undefined, without throwing')
}

console.log('\n labels')
{
  ok(fileKind('a.zip') === 'ZIP', 'a short extension is shouted')
  ok(fileKind('a.docx') === 'DOCX', 'four characters still counts as short')
  ok(fileKind('a.sketch') === 'Sketch', 'and a long one is not — SKETCH reads as an acronym it is not')
  ok(fileKind('noext') === 'File', 'no extension falls back to something sayable')
  ok(fileIcon('a.docx') === 'format-word' && fileIcon('a.zip') === 'nav-folder', 'families get their own icon')
  ok(fileIcon('a.wat') === 'block-text',
     'and an unknown format still gets ONE — a chip with no icon reads as broken, not as unknown')
}

console.log('\n sizes')
{
  ok(formatSize(0) === '0 B', 'zero')
  ok(formatSize(900) === '900 B', 'bytes')
  ok(formatSize(2048) === '2 KB', 'kilobytes, without a pointless decimal')
  ok(formatSize(5 * 1024 * 1024) === '5.0 MB', 'megabytes, with one')
  ok(formatSize(null) === '0 B' && formatSize('x') === '0 B', 'garbage does not become NaN B')
}

console.log('\n ids')
{
  const ids = new Set(Array.from({ length: 2000 }, newFileId))
  ok(ids.size === 2000,
     '2000 ids in a tight loop are all distinct — Date.now() alone is not, and a collision here loses a file with no error')
  ok(newFileId().startsWith('file_'), 'and they are recognisable on sight in a dump of IndexedDB keys')
}

console.log('\n processFile')
{
  const done = []
  const run = async (f, label, expect) => {
    try {
      const r = await processFile(f)
      done.push([label, expect === 'ok', r])
    } catch (err) {
      done.push([label, expect === 'throw', err])
    }
  }
  await run(fakeFile('a.docx', 1000, 'application/x'), 'a normal file', 'ok')
  await run(null, 'no file at all', 'throw')
  await run(fakeFile('empty.zip', 0, ''), 'an empty file', 'throw')
  await run(fakeFile('huge.mp4', MAX_FILE_BYTES + 1, ''), 'one over the cap', 'throw')
  for (const [label, good] of done) ok(good, label + ' is handled as expected')

  const r = await processFile(fakeFile('a.docx', 10, ''))
  ok(r.blob.__blob === true,
     'the bytes are COPIED into a blob — a File keeps a live handle to something on disk, and a renamed folder would empty the attachment')
  ok(r.type === 'application/octet-stream',
     'a missing MIME type becomes octet-stream rather than empty, so nothing downstream guesses')
  ok(r.ext === '.docx' && r.size === 10, 'and the metadata the chip renders from comes back with it')

  let msg = ''
  try { await processFile(fakeFile('huge.mp4', MAX_FILE_BYTES + 1, '')) } catch (e) { msg = e.message }
  ok(msg.includes('huge.mp4') && msg.includes('50MB'),
     'the size error names the file AND the limit — "too large" alone tells you nothing you can act on')
}

console.log('\n routing')
{
  ok(HANDLED_ELSEWHERE.has('.pdf') && HANDLED_ELSEWHERE.has('.xlsx') && HANDLED_ELSEWHERE.has('.md'),
     'formats with a live block of their own are listed, so burying one as a generic chip is detectable')
  ok(!HANDLED_ELSEWHERE.has('.docx') && !HANDLED_ELSEWHERE.has('.zip'),
     'and the ones this module exists for are not')
}

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
