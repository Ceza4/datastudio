/*
  lib/docauthor.js
  --------------------------------------------------------------------------
  Who is writing: the name and id stamped on comments and tracked changes.
  Read from the account cache (lib/limits.js, synchronous, no network), so
  the document works signed out too — as "You" on this device.
  -------------------------------------------------------------------------- */

import { accountSnapshot } from './limits.js'

const LOCAL_ID_KEY = 'ds-doc-author-id'

function localId() {
  try {
    let id = localStorage.getItem(LOCAL_ID_KEY)
    if (!id) { id = 'local_' + Math.random().toString(36).slice(2, 10); localStorage.setItem(LOCAL_ID_KEY, id) }
    return id
  } catch { return 'local' }
}

export function currentAuthor() {
  let acc = null
  try { acc = accountSnapshot() } catch { acc = null }
  const id = acc?.userId || localId()
  const fromEmail = acc?.email ? String(acc.email).split('@')[0] : ''
  const name = acc?.displayName || acc?.name || (fromEmail ? fromEmail.charAt(0).toUpperCase() + fromEmail.slice(1) : 'You')
  return { id, name }
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/)
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase()
}
