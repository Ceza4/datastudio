/*
  lib/builder.js
  --------------------------------------------------------------------------
  Builder Phase 1 helpers that are not the database model itself.
  See the "Builder — Full System Builder plan" doc for the architecture.
  -------------------------------------------------------------------------- */

import { createDatabase, createProperty, createOption, addProperty, addOption, createRow, addRow } from './database.js'

/**
 * The database a new Pipeline gets when there is none on the sheet to point
 * at: a small client list, with stages and a monthly value. Generic fields
 * only: a trainer, an agency or a sales team rename them and carry on.
 * `sample` adds three example rows so the pipeline does not open empty.
 */
export function starterPipelineDb({ sample = true } = {}) {
  let db = createDatabase({ name: 'Clients' })
  const stage = createProperty({ name: 'Stage', type: 'select' })
  const value = createProperty({ name: 'Value', type: 'number' })
  const email = createProperty({ name: 'Email', type: 'email' })
  const phone = createProperty({ name: 'Phone', type: 'text' })
  const next = createProperty({ name: 'Next session', type: 'date' })
  for (const p of [stage, value, email, phone, next]) db = addProperty(db, p)
  const opts = [['New lead', 'text-2'], ['Contacted', 'accent'], ['Trial booked', 'amber'], ['Active', 'green']]
    .map(([name, color]) => createOption({ name, color }))
  for (const o of opts) db = addOption(db, stage.id, o)
  if (sample) {
    const rows = [
      { name: 'Example: Jenna Cole', stage: 0, value: 150 },
      { name: 'Example: Priya Shah', stage: 1, value: 180 },
      { name: 'Example: Sofia Reyes', stage: 3, value: 220 },
    ]
    for (const r of rows) {
      db = addRow(db, createRow(db, { values: { [db.titlePropId]: r.name, [stage.id]: opts[r.stage].id, [value.id]: r.value } }))
    }
  }
  return { db, stageId: stage.id, valueId: value.id }
}

/** The Select property a pipeline should group by, or null. */
export const firstStageProp = db => db?.properties?.find(p => p.type === 'select')?.id || null
/** The Number property a pipeline should sum, or null. */
export const firstValueProp = db => db?.properties?.find(p => p.type === 'number')?.id || null

/** "3m ago", "2h ago", "5d ago", or a date past a month. */
export function relTime(at, now = Date.now()) {
  if (typeof at !== 'number') return ''
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24); if (d < 31) return `${d}d ago`
  return new Date(at).toLocaleDateString()
}
