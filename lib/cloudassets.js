/*
  lib/cloudassets.js
  --------------------------------------------------------------------------
  Bytes, in both directions. Images, PDFs and attachments — the three things
  that live in their own IndexedDB stores and, until now, never left the
  machine they were dropped on.

  THE ORDERING RULE, AND WHY IT IS ENFORCED IN POSTGRES

  Upload the object FIRST, insert the manifest row SECOND. Always.

  0002 tried to get this right with a fallback: read the true size from
  storage.objects, and trust the client's number if the object was not there
  yet, with a comment asking whoever built uploads to do them in that order.
  That is a rule nobody can be reminded of at 2am. 0003 removes the fallback —
  a manifest row whose object is missing is now REFUSED by the trigger — so
  getting the order wrong is a loud error at development time rather than a
  quietly under-reported quota in production.

  The asymmetry is deliberate. An object with no manifest row is garbage the
  collector sweeps up. A manifest row with no object is a broken image in
  someone's notebook, forever, with no way to tell it apart from a genuine
  one. Leak, don't break.

  WHAT IS AND IS NOT IMMUTABLE

  Objects never change. Cropping or rotating an image mints a NEW id and
  uploads a new object (backend plan §3) — which is what stops sync from ever
  having to reconcile two versions of the same bytes, and makes every object
  cacheable forever. The one mutable part of a PDF is its `edits` overlay, and
  that rides in the manifest row's `meta` column, never in the object.

  DEDUPE IS BY CONTENT, NOT BY ID

  The same logo dropped into six notebooks is six ids locally and one object
  in the cloud. sha256 of the bytes is checked against the owner's own
  manifest before uploading, so the second through sixth cost a round trip
  instead of a megabyte. Scoped to the owner on purpose: a cross-account
  dedupe would make "does this hash exist" an oracle that tells you whether
  another user holds a particular file.
  -------------------------------------------------------------------------- */

import { getSupabase } from './supabaseClient.js'
import { getImage, putImage } from './images.js'
import { getPdf, putPdf } from './pdfs.js'
import { getFile, putFile } from './files.js'
import { checkQuota, quotaMessage } from './limits.js'

export const BUCKET = 'ds-assets'

export const KIND_IMAGE = 'image'
export const KIND_PDF = 'pdf'
export const KIND_FILE = 'file'

/* An id carries its family in its prefix — that is why lib/ids.js prefixes at
   all, and why templatestore's per-store prune can treat an id from the wrong
   family as inert rather than wrong. Reading the kind off the id means a
   caller never has to pass one and get it wrong. */
export function kindOf(assetId) {
  const s = String(assetId || '')
  if (s.startsWith('img_')) return KIND_IMAGE
  if (s.startsWith('pdf_')) return KIND_PDF
  if (s.startsWith('file_')) return KIND_FILE
  return null
}

/**
 * `{org}/{kind}/{id}` — the TENANT first, because a storage policy can only
 * cheaply constrain the leading path segment (storage.foldername splits on
 * '/'), and that segment is the whole boundary between one workspace's bytes
 * and another's.
 *
 * IT USED TO BE `{owner_uuid}/…`, AND THAT IS WHY NOTHING UPLOADED.
 *
 * Migration 0004 moved the boundary from "is this your uuid" to "are you in
 * this organisation" and rewrote the bucket policies to match. This function
 * was not changed. `is_org_member('<a raw uuid>')` is false for everybody, so
 * from the moment 0004 was applied every single upload came back
 * `42501 new row violates row-level security policy` — and the pen test kept
 * passing, because it writes its own org-shaped path rather than calling this.
 *
 * Objects written before that live at the old shape. 0005 re-admits them for
 * READ and DELETE only, so they stay reachable and collectable while no new
 * ones can be created — see §3 of that migration.
 *
 * No file extension. An extension in the object name is a second, weaker
 * claim about the content type that can disagree with the mime recorded in
 * the manifest — and browsers sniff. The mime lives in one place.
 */
export const assetPath = (orgId, assetId) => `${orgId}/${kindOf(assetId) || 'file'}/${assetId}`

/* ── reading the local copy ───────────────────────────────────────────────

   Three stores, three record shapes, one answer. Kept here rather than in
   sync.js so the shape knowledge stays next to the upload that needs it. */
export async function localAsset(assetId) {
  const kind = kindOf(assetId)
  if (kind === KIND_IMAGE) {
    const rec = await getImage(assetId)
    if (!rec?.blob) return null
    return {
      kind, id: assetId, blob: rec.blob,
      name: rec.name || null, mime: rec.type || rec.blob.type || 'application/octet-stream',
      width: rec.width ?? null, height: rec.height ?? null,
      meta: {},
    }
  }
  if (kind === KIND_PDF) {
    const rec = await getPdf(assetId)
    if (!rec?.bytes) return null
    /* PDFs are stored as raw bytes, not a Blob — lib/pdfdoc.js hands pdf.js a
       Uint8Array and pdf-lib wants one back. Wrapped for upload only; the
       stored record is untouched. */
    return {
      kind, id: assetId, blob: new Blob([rec.bytes], { type: 'application/pdf' }),
      name: rec.name || null, mime: 'application/pdf',
      width: null, height: null,
      meta: { edits: rec.edits || [], editsRev: rec.editsRev || 0, pdfVersion: rec.pdfVersion || null },
    }
  }
  if (kind === KIND_FILE) {
    const rec = await getFile(assetId)
    if (!rec?.blob) return null
    return {
      kind, id: assetId, blob: rec.blob,
      name: rec.name || null, mime: rec.type || 'application/octet-stream',
      width: null, height: null,
      meta: {},
    }
  }
  return null
}

/** Write a downloaded asset into the store its family belongs to. */
export async function storeAsset(row, blob) {
  const kind = row.kind || kindOf(row.id)
  if (kind === KIND_IMAGE) {
    return putImage(row.id, {
      blob, width: row.width ?? null, height: row.height ?? null,
      type: row.mime || blob.type, name: row.name || null,
      originalBytes: row.bytes || blob.size,
    })
  }
  if (kind === KIND_PDF) {
    const buf = new Uint8Array(await blob.arrayBuffer())
    return putPdf(row.id, {
      bytes: buf, name: row.name || 'document.pdf', size: buf.length,
      pdfVersion: row.meta?.pdfVersion || null, encrypted: false,
      edits: row.meta?.edits || [], editsRev: row.meta?.editsRev || 0,
    })
  }
  if (kind === KIND_FILE) {
    return putFile(row.id, {
      blob, name: row.name || 'attachment', size: blob.size,
      type: row.mime || blob.type || 'application/octet-stream',
      ext: (row.name || '').includes('.') ? `.${row.name.split('.').pop().toLowerCase()}` : '',
    })
  }
  throw new Error(`cloudassets: unknown asset family for "${row.id}"`)
}

/* ── content hash ────────────────────────────────────────────────────────

   SubtleCrypto needs a secure context, same as crypto.randomUUID. On plain
   http (a phone hitting a laptop's dev server) it is simply absent, and the
   right answer is to skip dedupe rather than to invent a weaker hash: a hash
   that collides is worse than no hash, because it hands one file's bytes back
   for another file's id. */
export async function sha256(blob) {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null
    const buf = await blob.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buf)
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  } catch { return null }
}

/* ── upload ──────────────────────────────────────────────────────────────── */

/* The quota triggers raise with errcode `check_violation` (23514) and a message
   that starts `QUOTA:`. Matching on either is enough; matching on both is
   deliberate belt-and-braces, because supabase-js does not always surface
   `code` for a trigger-raised exception. */
const isQuotaError = err =>
  err?.code === '23514' || /(^|\W)QUOTA:/.test(err?.message || '')

/* Strip the machine prefix so the banner reads as a sentence. The server's
   wording is already user-facing — it names the plan and the limit — so this
   trims rather than rewrites. */
const quotaSentence = err =>
  String(err?.message || '').replace(/^.*?QUOTA:\s*/s, '').trim() || 'Storage is full.'

export const UP_OK = 'ok'
export const UP_ALREADY = 'already'      // manifest row already present
export const UP_DEDUPED = 'deduped'      // same bytes already uploaded under another id
export const UP_MISSING = 'missing'      // local bytes are gone
export const UP_QUOTA = 'quota'
export const UP_FAILED = 'failed'
export const UP_UNCONFIGURED = 'unconfigured'

/**
 * Push one asset's bytes and manifest row.
 *
 * @param {string} assetId
 * @param {{ownerId:string, orgId:string, docId?:string|null, client?:object}} ctx
 */
export async function uploadAsset(assetId, { ownerId, orgId, docId = null, client } = {}) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { status: UP_UNCONFIGURED }
  if (!ownerId) return { status: UP_FAILED, error: 'no owner' }
  /* No org means the account snapshot has not arrived yet. Refusing here is a
     retry; guessing a path is a 42501 that looks like a permissions bug. */
  if (!orgId) return { status: UP_FAILED, error: 'no organisation yet' }

  try {
    /* INSIDE the try. getImage() does not swallow an IndexedDB failure the way
       getFile() does, so in a private-browsing profile this line throws — and
       it used to throw out of this function entirely, past every caller that
       expects a status object back. A private window should degrade to "cannot
       sync", not produce an exception shaped like nothing else here. */
    const local = await localAsset(assetId)
    /* A missing local file is NOT an error. The prune in app/app/page.js
       collects bytes no block references any more, and an outbox entry can
       outlive the bytes it names — someone deletes an image while offline,
       comes back, and the queue still has the upload. Reporting this as a
       failure would retry it forever with backoff and light up the error
       state for something that is already resolved correctly. */
    if (!local) return { status: UP_MISSING }
    const { data: existing } = await c
      .from('assets').select('id, path, bytes, meta, doc_id').eq('id', assetId).maybeSingle()

    if (existing) {
      /* Already uploaded. The only thing that can still be stale is the
         mutable overlay, and only for PDFs. */
      if (local.kind === KIND_PDF) {
        const theirRev = existing.meta?.editsRev ?? -1
        const ourRev = local.meta.editsRev ?? 0
        if (ourRev > theirRev) {
          const { error } = await c.from('assets').update({ meta: local.meta }).eq('id', assetId)
          if (error) return { status: UP_FAILED, error: error.message }
        }
      }
      if (docId && !existing.doc_id) {
        await c.from('assets').update({ doc_id: docId }).eq('id', assetId)
      }
      return { status: UP_ALREADY, bytes: existing.bytes }
    }

    /* Quota is checked before the bytes go over the wire, not after — the
       point of a cap is to not pay the egress. It never blocks the local
       write, which already happened; over quota the asset stays queued and
       the banner explains why (limits.js rule 2). */
    const quota = await checkQuota('assetBytes', local.blob.size)
    if (!quota.ok) return { status: UP_QUOTA, message: quotaMessage(quota) }

    const hash = await sha256(local.blob)
    if (hash) {
      /* Scoped to the ORGANISATION, not the person. Two members of one shared
         workspace dropping the same PDF should upload it once; two strangers
         must never learn anything about each other's files, which is what a
         cross-account dedupe would turn "does this hash exist" into.

         (Until 0005 this branch could not succeed at all: `assets.path` was
         `unique`, so pointing a second row at the twin's object raised 23505
         every time and the push retried forever. Dropping the same image into
         a second notebook wedged that asset's sync permanently.) */
      const { data: twin } = await c
        .from('assets').select('id, path')
        .eq('org_id', orgId).eq('sha256', hash).is('deleted_at', null)
        .limit(1).maybeSingle()
      if (twin) {
        /* Same bytes, different id. Point the new manifest row at the object
           that is already there — one object, many rows. The collector below
           therefore must never delete an object while ANY row still names its
           path, which is why it counts paths rather than ids. */
        const { error } = await c.from('assets').insert({
          id: assetId, owner_id: ownerId, kind: local.kind, doc_id: docId,
          path: twin.path, name: local.name, mime: local.mime,
          width: local.width, height: local.height, sha256: hash, meta: local.meta,
        })
        if (error) return { status: UP_FAILED, error: error.message }
        return { status: UP_DEDUPED, path: twin.path }
      }
    }

    const path = assetPath(orgId, assetId)
    /* upsert:false so a second uploader racing on the same path loses loudly
       instead of overwriting bytes another row already points at. */
    const { error: upErr } = await c.storage.from(BUCKET).upload(path, local.blob, {
      contentType: local.mime,
      upsert: false,
      /* Objects are immutable, so the cache can hold one for as long as it
         likes. A year, in seconds. */
      cacheControl: '31536000',
    })
    if (upErr && !/already exists|duplicate/i.test(upErr.message || '')) {
      return { status: UP_FAILED, error: upErr.message }
    }

    const { error } = await c.from('assets').insert({
      id: assetId, owner_id: ownerId, kind: local.kind, doc_id: docId,
      path, name: local.name, mime: local.mime,
      width: local.width, height: local.height, sha256: hash, meta: local.meta,
    })
    if (error) {
      /* A QUOTA REFUSAL IS NOT A FAILURE, and it does not only come from the
         client-side pre-check above.

         The server has the last word — its trigger sees the real object size
         and the real running total, and it raises `QUOTA: …` as a
         check_violation. That arrived here as UP_FAILED, so pushAsset threw,
         drain classified it as SYNC_ERROR, and the user got a raw Postgres
         message in red where the design calls for the calm "queued, here is
         why" banner. Rule 2 in lib/limits.js: over quota means new work
         waits, never that anything is lost. */
      if (isQuotaError(error)) {
        return { status: UP_QUOTA, message: quotaSentence(error), orphanPath: path }
      }
      /* The object is up and the row is not. Left in place ON PURPOSE: the
         retry re-runs this function, finds no manifest row, and the upload
         short-circuits on "already exists" above. Deleting it here would turn
         a recoverable half-write into a re-upload of 25MB on a connection
         that has just proved it is unreliable.

         `orphanPath` is the caller's problem to remember. It used to be
         returned and dropped on the floor by pushAsset, which is how objects
         became permanently unreachable: nothing in this codebase enumerates
         the bucket, so an object with no manifest row is invisible to every
         sweeper there is. lib/sync.js now records it in the outbox entry. */
      return { status: UP_FAILED, error: error.message, orphanPath: path }
    }
    return { status: UP_OK, path, bytes: local.blob.size }
  } catch (err) {
    return { status: UP_FAILED, error: err?.message || String(err) }
  }
}

/* ── download ────────────────────────────────────────────────────────────── */

/* Above this, only the length is checked. Hashing is a full pass over the
   buffer on the main thread; at 64MB that is long enough to drop frames, and
   the marginal protection over "the length is exactly right, delivered over
   TLS" is small. Tunable in one place on purpose. */
export const VERIFY_HASH_MAX_BYTES = 64 * 1024 * 1024

export const DOWN_OK = 'ok'
export const DOWN_HAVE = 'have'
export const DOWN_GONE = 'gone'
export const DOWN_FAILED = 'failed'

/**
 * Fetch one asset's bytes into the local store, if they are not already here.
 *
 * LAZY BY DEFAULT. A pull brings down manifest ROWS, which are a few hundred
 * bytes each; the objects come when something actually asks to render them.
 * Eagerly downloading every asset on sign-in would mean a new machine sits on
 * a spinner pulling gigabytes before showing a single notebook — and most of
 * those bytes belong to notebooks nobody is going to open today.
 */
export async function downloadAsset(assetId, { client, row } = {}) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { status: DOWN_FAILED, error: 'unconfigured' }

  if (await localAsset(assetId)) return { status: DOWN_HAVE }

  try {
    let meta = row
    if (!meta) {
      const { data, error } = await c
        .from('assets')
        .select('id, kind, path, name, mime, width, height, bytes, sha256, meta, deleted_at')
        .eq('id', assetId).maybeSingle()
      if (error) return { status: DOWN_FAILED, error: error.message }
      meta = data
    }
    if (!meta || meta.deleted_at) return { status: DOWN_GONE }

    const { data: blob, error: dlErr } = await c.storage.from(BUCKET).download(meta.path)
    if (dlErr || !blob) return { status: DOWN_FAILED, error: dlErr?.message || 'no bytes' }

    /* CHECK THE BYTES BEFORE TRUSTING THEM.

       sha256 was computed on upload, stored in the manifest, and then never
       looked at again — it was not even in the SELECT above. That mattered
       more than it sounds, because of the short-circuit at the top of this
       function: once a blob is in IndexedDB, `localAsset` returns it and this
       function never runs again. A truncated or corrupted download therefore
       became the permanent local copy of that file, silently, with no way to
       tell it from a good one and no path back.

       Two checks, cheapest first. `bytes` is free and catches truncation,
       which is the realistic failure — a connection dropped mid-transfer. The
       hash catches the rest and costs a pass over the buffer, so it is skipped
       for large objects on the reasoning that a size match plus TLS is already
       strong, and re-hashing 200MB on every image load is not.

       On mismatch: DISCARD and report failure, so the caller retries. Storing
       it and hoping is what created the problem. */
    if (Number.isFinite(meta.bytes) && meta.bytes > 0 && blob.size !== meta.bytes) {
      return { status: DOWN_FAILED, error: `truncated: got ${blob.size} of ${meta.bytes} bytes` }
    }
    if (meta.sha256 && blob.size <= VERIFY_HASH_MAX_BYTES) {
      const got = await sha256(blob)
      /* A null hash means SubtleCrypto is unavailable — an insecure origin, an
         old browser. That is "could not check", not "failed the check", and
         refusing the file would break the app on those browsers entirely. */
      if (got && got !== meta.sha256) {
        return { status: DOWN_FAILED, error: 'checksum mismatch' }
      }
    }

    await storeAsset(meta, blob)
    return { status: DOWN_OK, bytes: blob.size }
  } catch (err) {
    return { status: DOWN_FAILED, error: err?.message || String(err) }
  }
}

/**
 * A short-lived signed URL, for the cases where handing the browser a URL
 * beats materialising a Blob — a large PDF the viewer streams, an <img> in an
 * export. Sixty seconds: long enough to load, short enough that a URL copied
 * out of devtools and pasted into a chat is dead before it arrives.
 */
export async function signedUrl(path, seconds = 60, client) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return null
  try {
    const { data, error } = await c.storage.from(BUCKET).createSignedUrl(path, seconds)
    return error ? null : (data?.signedUrl || null)
  } catch { return null }
}

/* ── retiring an asset ────────────────────────────────────────────────────

   THE HOLE THIS FILLS, WRITTEN DOWN BECAUSE IT WAS INVISIBLE FOR A WHILE.

   Deleting an image block did the local half correctly: the next autosave
   worked out which ids nothing referenced any more and dropped the blobs from
   IndexedDB. The cloud half did not exist. Nothing in the entire codebase ever
   wrote `assets.deleted_at`, which meant three things at once, none of them
   visible from the UI:

     · the bytes stayed in Storage forever
     · they kept counting against the account's quota forever, so a user could
       fill a paid plan with files they had already deleted and be told to buy
       more space for nothing
     · collectRemote, whose whole job is to sweep tombstones, always found
       zero rows — it was correct code guarding a door nobody ever opened

   WHY TOMBSTONE AND NOT DELETE. A delete here would be irreversible from a
   device whose view of the workspace might be incomplete — a failed hydration,
   a half-finished first sync, a pull that errored. The soft delete gives 30
   days in which a mistake is a restore rather than a loss, and migration 0003's
   `assets purge` policy makes that window a rule the server enforces rather
   than a promise this file keeps.

   WHY THE CALLER PASSES IDS. The tempting version is "tombstone everything in
   the cloud that is not in my local keep-set", which needs no plumbing and is
   the exact bug the paragraph above is trying to avoid: on a device that has
   not finished pulling, every notebook it has not seen yet looks like garbage.
   The ids handed in here have already been proven absent from the local
   workspace by the prune that deleted their bytes. */
export async function tombstoneAssets(ids, { client } = {}) {
  /* Filter BEFORE stringifying. `[null].map(String)` is `['null']` — a
     four-character id that survives filter(Boolean) and goes into the `in`
     clause. Nothing has that id today, so it matched nothing and the bug was
     invisible; it is still a client sending garbage to the server and exactly
     the shape of thing that becomes real the day an id can be user-chosen. */
  const list = [...new Set((ids || []).filter(Boolean).map(String).filter(Boolean))]
  if (!list.length) return { status: UP_OK, tombstoned: 0 }
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { status: UP_UNCONFIGURED, tombstoned: 0 }
  try {
    /* `is('deleted_at', null)` keeps this idempotent AND keeps the clock
       honest: without it, a device that prunes the same id on every save would
       push deleted_at forward each time and the 30-day window would never
       elapse. The row would be invisible and immortal. */
    const { data, error } = await c
      .from('assets')
      .update({ deleted_at: new Date().toISOString() })
      .in('id', list)
      .is('deleted_at', null)
      .select('id')
    if (error) return { status: UP_FAILED, error: error.message, tombstoned: 0 }
    return { status: UP_OK, tombstoned: data?.length || 0 }
  } catch (err) {
    return { status: UP_FAILED, error: err?.message || String(err), tombstoned: 0 }
  }
}

/**
 * Delete an object whose manifest row was never written.
 *
 * The only way back for bytes that nothing can name. `uploadAsset` returns
 * `orphanPath` when the object landed and the row did not; if the retry later
 * discovers the local bytes are gone — the block was deleted while the upload
 * was queued — there will never be another attempt, and no sweeper in this
 * system enumerates the bucket. Without this call those bytes are permanent,
 * unreferenced, billable, and they survive account deletion, because the
 * deletion route also lists paths from the manifest.
 */
export async function reclaimOrphan(path, { client } = {}) {
  if (!path) return { status: UP_OK }
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { status: UP_UNCONFIGURED }
  try {
    /* Refuse to touch a path some row does name — the orphan record could be
       stale, and this is a delete. */
    const { data: claimed, error } = await c.from('assets').select('id').eq('path', path).limit(1)
    if (error) return { status: UP_FAILED, error: error.message }
    if (claimed?.length) return { status: UP_OK, kept: true }

    const { error: rmErr } = await c.storage.from(BUCKET).remove([path])
    if (rmErr) return { status: UP_FAILED, error: rmErr.message }
    return { status: UP_OK, reclaimed: true }
  } catch (err) {
    return { status: UP_FAILED, error: err?.message || String(err) }
  }
}

/* ── the collector ───────────────────────────────────────────────────────── */

/**
 * Hard-delete manifest rows that have been soft-deleted for more than 30 days,
 * and the objects nothing points at any more.
 *
 * The 30 days is NOT enforced here. It is enforced by the `assets purge` RLS
 * policy in migration 0003, which refuses a delete against a row that is not
 * old enough. This function can therefore be wrong — a bug, a bad clock, a
 * future refactor — and still not destroy anything early. That is the point
 * of putting the window in the policy rather than in this file.
 */
export async function collectRemote({ client } = {}) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { status: UP_UNCONFIGURED, removed: 0 }
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: doomed, error } = await c
      .from('assets').select('id, path')
      .not('deleted_at', 'is', null).lt('deleted_at', cutoff).limit(200)
    /* A failed SELECT used to be reported as `{ status: UP_OK, removed: 0 }` —
       indistinguishable from "nothing to collect", which is the answer that
       makes a broken collector look like a working one forever. */
    if (error) return { status: UP_FAILED, error: error.message, removed: 0 }
    if (!doomed?.length) return { status: UP_OK, removed: 0 }

    /* OBJECTS FIRST, ROWS SECOND — the opposite of what this used to do, and
       the opposite of the upload order.

       The old comment claimed "an object with no row is a leak this same
       function collects next time". It cannot. `doomed` comes from a SELECT on
       `assets`; the paths are knowable ONLY from the rows. So deleting the
       rows and then failing to remove the objects — a closed tab, a dropped
       connection, a rate limit — left bytes in the bucket that nothing in this
       codebase could ever name again. The function created exactly the leak it
       said it repaired.

       Reversed, the worst case is a row whose object is already gone. That row
       is a 30-day-expired tombstone: nothing renders it, nothing downloads it,
       and the next sweep deletes it. Recoverable in the direction that costs
       nothing. */
    const ids = doomed.map(r => r.id)

    /* Only remove an object once NOTHING LIVE names its path. Deduped assets
       share one object between many rows, so deleting by the doomed row's path
       would blank the image in every other notebook that reused it. */
    const paths = [...new Set(doomed.map(r => r.path))]
    const { data: stillUsed, error: useErr } = await c
      .from('assets').select('path').in('path', paths).not('id', 'in', `(${ids.map(i => `"${i}"`).join(',')})`)
    if (useErr) return { status: UP_FAILED, error: useErr.message, removed: 0 }
    const keep = new Set((stillUsed || []).map(r => r.path))
    const free = paths.filter(p => !keep.has(p))

    let removedObjects = 0
    if (free.length) {
      const { error: rmErr } = await c.storage.from(BUCKET).remove(free)
      /* Checked, where it used to be fire-and-forget. If the bytes cannot go,
         the rows must stay — they are the only record of where the bytes are. */
      if (rmErr) return { status: UP_FAILED, error: rmErr.message, removed: 0 }
      removedObjects = free.length
    }

    const { error: delErr } = await c.from('assets').delete().in('id', ids)
    if (delErr) return { status: UP_FAILED, error: delErr.message, removed: 0, objects: removedObjects }

    return { status: UP_OK, removed: ids.length, objects: removedObjects }
  } catch (err) {
    return { status: UP_FAILED, error: err?.message || String(err), removed: 0 }
  }
}

/**
 * The same sweep for `docs`.
 *
 * Separate from collectRemote rather than folded into it because the failure
 * modes are unrelated — assets involve Storage objects and a sharing check,
 * documents are rows and nothing else — and because a Storage error must not
 * stop documents being collected, or vice versa.
 *
 * `docs` had the same gap as `assets` from the other end: deletes DID write a
 * tombstone (see pushDoc in lib/sync.js, where a delete is an update), the
 * `docs purge` policy DID permit a hard delete after 30 days, and no code ever
 * performed one. The tombstones simply accumulated. Each is small, so this was
 * never going to fill anything up; it was going to mean the row for a notebook
 * somebody deleted in March is still readable in the database next year, which
 * is a different and worse problem — you cannot honestly answer "is it gone?"
 * with "the policy would allow us to remove it".
 */
export async function collectRemoteDocs({ client } = {}) {
  const c = client === undefined ? await getSupabase() : client
  if (!c) return { status: UP_UNCONFIGURED, removed: 0 }
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await c
      .from('docs').delete()
      .not('deleted_at', 'is', null).lt('deleted_at', cutoff)
      .select('id')
    if (error) return { status: UP_FAILED, error: error.message, removed: 0 }
    return { status: UP_OK, removed: data?.length || 0 }
  } catch (err) {
    return { status: UP_FAILED, error: err?.message || String(err), removed: 0 }
  }
}
