/*
  tests/cloudassets.test.mjs
  --------------------------------------------------------------------------
  Asset paths, families and the upload contract (lib/cloudassets.js).

  The byte transfer itself needs a browser (Blob, IndexedDB, SubtleCrypto) and
  belongs in tests/browser/. What is checked here is everything that decides
  WHERE bytes go and WHO can reach them — the storage path is the only thing a
  bucket policy can constrain, so getting its shape wrong is a security bug,
  not a filing inconvenience.
  -------------------------------------------------------------------------- */

import {
  BUCKET, KIND_IMAGE, KIND_PDF, KIND_FILE, kindOf, assetPath,
  uploadAsset, tombstoneAssets, collectRemoteDocs,
  UP_OK, UP_UNCONFIGURED, UP_FAILED,
} from '../lib/cloudassets.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}  (got ${JSON.stringify(a)})`)

console.log('\n  families are read off the id prefix')
{
  eq(kindOf('img_abc'), KIND_IMAGE, 'images')
  eq(kindOf('pdf_abc'), KIND_PDF, 'pdfs')
  eq(kindOf('file_abc'), KIND_FILE, 'attachments')
  eq(kindOf('nb_abc'), null, 'a document id is not an asset')
  eq(kindOf(null), null, 'and neither is nothing')
  /* This is why lib/ids.js prefixes at all: templatestore prunes per store by
     family, so an id from the wrong family lands as inert rather than wrong. */
  ok(kindOf('image_abc') === null, 'the prefix is exact — "image_" is not "img_"')
}

console.log('\n  the storage path')
{
  const p = assetPath('11111111-2222-3333-4444-555555555555', 'img_abc')
  eq(p, '11111111-2222-3333-4444-555555555555/image/img_abc', 'owner / kind / id')
  ok(p.split('/')[0] === '11111111-2222-3333-4444-555555555555',
     'THE OWNER IS THE FIRST SEGMENT — a storage policy can only cheaply constrain the leading segment, and that segment is the entire boundary between two accounts\' bytes')
  ok(!/\.(png|jpg|pdf)$/i.test(p),
     'no file extension: it would be a second, weaker claim about content type that can disagree with the mime in the manifest, and browsers sniff')
  eq(assetPath('owner', 'nb_x'), 'owner/file/nb_x', 'an unrecognised family still produces a path inside the owner\'s own prefix rather than at the bucket root')
  eq(BUCKET, 'ds-assets', 'one bucket for all three families')
}

console.log('\n  refusing to act without the things it needs')
{
  eq((await uploadAsset('img_1', { ownerId: 'u', client: null })).status, UP_UNCONFIGURED,
     'no Supabase project means "not configured", not a crash — local-only use must survive it')
  eq((await uploadAsset('img_1', { ownerId: null, client: {} })).status, UP_FAILED,
     'and no owner is a refusal rather than an upload to an unowned path')
}

console.log('\n  a browser with no IndexedDB degrades to a status, not an exception')
{
  /* Private-browsing Firefox. getImage() does not swallow the failure the way
     getFile() does, so this used to throw straight out of uploadAsset, past
     every caller that expects a status object back. */
  let threw = false
  let res = null
  try { res = await uploadAsset('img_1', { ownerId: 'u', client: { from: () => { throw new Error('x') } } }) }
  catch { threw = true }
  ok(!threw, 'it never throws into the drain loop')
  ok(res && typeof res.status === 'string', 'it always answers with a status')
}

/* ── retiring assets ──────────────────────────────────────────────────────

   A deliberately tiny fake rather than tests/fake-postgrest.mjs. That one
   treats .not() and .lt() as no-ops, which is harmless for the sync paths it
   was built for and completely wrong here: the whole point of these two
   functions is WHICH filters they apply, and a fake that ignores half of them
   would pass a version of the code that deletes rows it should not. This one
   records the chain and asserts on it. */
function fakeDb(rows = []) {
  const calls = []
  const q = (table, op) => {
    const rec = { table, op, filters: [], payload: null }
    calls.push(rec)
    const chain = {
      update(p) { rec.payload = p; return chain },
      delete() { rec.op = 'delete'; return chain },
      in(col, vals) { rec.filters.push(['in', col, vals]); return chain },
      is(col, val) { rec.filters.push(['is', col, val]); return chain },
      not(col, _o, val) { rec.filters.push(['not', col, val]); return chain },
      lt(col, val) { rec.filters.push(['lt', col, val]); return chain },
      select() { return Promise.resolve({ data: rows, error: null }) },
    }
    return chain
  }
  return {
    calls,
    from: table => ({
      update(p) { return q(table, 'update').update(p) },
      delete() { return q(table, 'delete').delete() },
      select() { return Promise.resolve({ data: [], error: null }) },
    }),
  }
}

console.log('\n  tombstoning an asset')
{
  const db = fakeDb([{ id: 'img_1' }, { id: 'pdf_2' }])
  const res = await tombstoneAssets(['img_1', 'pdf_2', 'img_1', '', null], { client: db })
  eq(res.status, UP_OK, 'it reports success')
  eq(res.tombstoned, 2, 'and how many rows it actually retired')

  const call = db.calls[0]
  eq(call.table, 'assets', 'it writes to the manifest')
  eq(call.op, 'update', 'IT IS AN UPDATE, NEVER A DELETE — the 30-day window is what turns a mistake made against an incomplete local view into a restore instead of a loss')
  ok(call.payload && typeof call.payload.deleted_at === 'string',
     'and what it writes is a timestamp')

  const inFilter = call.filters.find(f => f[0] === 'in')
  eq(inFilter[2], ['img_1', 'pdf_2'],
     'the ids are deduped and emptied of blanks — a duplicate would be harmless, a null would match every row with no deleted_at')

  const isFilter = call.filters.find(f => f[0] === 'is' && f[1] === 'deleted_at')
  ok(isFilter && isFilter[2] === null,
     'IT ONLY TOUCHES ROWS NOT ALREADY TOMBSTONED. Without this the prune, which runs on every save, would push deleted_at forward each time and the 30-day window would never elapse — the row would be invisible and immortal, and its bytes would bill forever')
}

console.log('\n  ...degrading rather than throwing')
{
  eq((await tombstoneAssets(['img_1'], { client: null })).status, UP_UNCONFIGURED,
     'a local-only account has no client and that is not an error')
  eq((await tombstoneAssets([], { client: null })).tombstoned, 0,
     'nothing to retire short-circuits before it even looks for a client')
  const res = await tombstoneAssets(['img_1'], { client: { from: () => { throw new Error('x') } } })
  eq(res.status, UP_FAILED, 'and a broken client is a status, not an exception into the save handler')
}

console.log('\n  collecting expired document tombstones')
{
  const db = fakeDb([{ id: 'nb_1' }])
  const res = await collectRemoteDocs({ client: db })
  eq(res.removed, 1, 'it reports what it swept')

  const call = db.calls[0]
  eq(call.table, 'docs', 'documents, not assets — the two sweeps are separate so a Storage outage cannot stop this one')
  eq(call.op, 'delete', 'THIS one is a hard delete, because the row has already served its 30 days as a tombstone')

  const notFilter = call.filters.find(f => f[0] === 'not')
  ok(notFilter && notFilter[1] === 'deleted_at',
     'only tombstoned rows are candidates')
  const ltFilter = call.filters.find(f => f[0] === 'lt')
  ok(ltFilter && ltFilter[1] === 'deleted_at',
     'and only ones older than the cutoff')
  const cutoff = new Date(ltFilter[2]).getTime()
  const age = Date.now() - cutoff
  ok(Math.abs(age - 30 * 24 * 3600 * 1000) < 60_000,
     'the cutoff is 30 days ago — though the real guarantee is the "docs purge" RLS policy, which refuses anything younger no matter what this file computes')
}

console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
