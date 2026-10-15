/*
  lib/docversions.js
  --------------------------------------------------------------------------
  VERSION HISTORY for a Document block, kept in this browser (IndexedDB).

  A version is saved automatically when you have been editing for a while
  (at most one every 5 minutes, only when the text changed) and whenever
  you press File → Save version. The last 40 per document are kept. Restoring
  one is an ordinary edit, so it can itself be undone.

  Local by design: the synced document is the one true copy, and pushing a
  stream of full snapshots through sync would multiply its storage for a
  feature most people open twice a year. Said in the panel, so nobody
  expects to find this device's history on another one.
  -------------------------------------------------------------------------- */

const DB = 'ds-doc-versions'
const STORE = 'versions'
const KEEP = 40
export const AUTO_MS = 5 * 60 * 1000

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('This browser cannot keep versions.')); return }
    const rq = indexedDB.open(DB, 1)
    rq.onupgradeneeded = () => {
      const s = rq.result.createObjectStore(STORE, { keyPath: 'key' })
      s.createIndex('doc', 'doc')
    }
    rq.onsuccess = () => resolve(rq.result)
    rq.onerror = () => reject(rq.error)
  })
}

export async function saveVersion(docId, content, label = '') {
  if (!docId || content == null) return null
  const db = await open()
  const list = await listVersions(docId, db)
  if (list[0] && list[0].content === content && !label) return list[0]
  const v = { key: `${docId}:${Date.now()}`, doc: docId, at: Date.now(), content, label, words: String(content).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length }
  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(v)
    for (const old of list.slice(KEEP - 1)) tx.objectStore(STORE).delete(old.key)
    tx.oncomplete = res; tx.onerror = () => rej(tx.error)
  })
  return v
}

export async function listVersions(docId, dbIn) {
  const db = dbIn || await open()
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly')
    const rq = tx.objectStore(STORE).index('doc').getAll(docId)
    rq.onsuccess = () => res((rq.result || []).sort((a, b) => b.at - a.at))
    rq.onerror = () => rej(rq.error)
  })
}
