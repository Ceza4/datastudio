/*
  lib/blocks.js
  --------------------------------------------------------------------------
  READING THE `blocks` PROJECTION (migration 0007).

  The network half of block attribution. The map, the "is this mine" rule and
  the formatting live in lib/attribution.js, which imports nothing that talks
  to a server — see the note there for why that split exists rather than being
  one convenient file.
  -------------------------------------------------------------------------- */

import { getSupabase } from './supabaseClient.js'
import { setAttribution, hasPerson, knownPerson } from './attribution.js'

/**
 * Load attribution for a set of documents.
 *
 * @param {string[]} docIds
 * @returns {Promise<{ok:boolean, count?:number, reason?:string}>}
 */
export async function fetchAttribution(docIds, { client } = {}) {
  const ids = [...new Set((docIds || []).filter(Boolean))]
  if (!ids.length) return { ok: true, count: 0 }

  const c = client === undefined ? await getSupabase() : client
  if (!c) return { ok: false, reason: 'unconfigured' }

  try {
    /* Chunked because PostgREST puts `in.(...)` in the QUERY STRING, and a
       workspace with a few hundred notebooks would produce a URL past the
       proxy's line limit — which fails as a 414 rather than as anything that
       reads like the real problem. */
    const CHUNK = 50
    const rows = []
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await c
        .from('blocks')
        .select('id, doc_id, edited_by, edited_at')
        .in('doc_id', ids.slice(i, i + CHUNK))
        .not('edited_by', 'is', null)
      if (error) return { ok: false, reason: error.message }
      rows.push(...(data || []))
    }

    const names = await resolvePeople(c, rows.map(r => r.edited_by))

    /* Rebuilt rather than merged. A block whose row has gone — the document
       was pruned, the block deleted elsewhere — must lose its flag, and a
       merge would leave it on screen forever. */
    const next = new Map()
    for (const r of rows) {
      next.set(r.id, {
        by: r.edited_by,
        at: r.edited_at,
        name: names.get(r.edited_by) ?? knownPerson(r.edited_by) ?? null,
      })
    }
    setAttribution(next, names)
    return { ok: true, count: rows.length }
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) }
  }
}

/**
 * uuid → display name, for the people who appear in these rows.
 *
 * `profiles` is readable only for members of your own organisations, so this
 * resolves exactly the colleagues it should and silently resolves nobody else
 * — which is the correct behaviour rather than a limitation. An unresolved id
 * renders as "Someone", not as a uuid.
 */
async function resolvePeople(c, uuids) {
  const found = new Map()
  const wanted = [...new Set(uuids.filter(u => u && !hasPerson(u)))]
  if (!wanted.length) return found
  try {
    const { data } = await c.from('profiles').select('id, display_name, email').in('id', wanted)
    for (const p of data || []) {
      /* Display name, else the local part of the email. Never the full address:
         a flag is glanceable chrome, and putting somebody's email on every
         block they touched is both noisy and more disclosure than the feature
         asked for. */
      found.set(p.id, p.display_name || String(p.email || '').split('@')[0] || null)
    }
    /* Remember the misses too, so an unresolvable id is not re-queried on every
       pull for the rest of the session. */
    for (const u of wanted) if (!found.has(u)) found.set(u, null)
  } catch { /* names are optional; the flag still works without one */ }
  return found
}

