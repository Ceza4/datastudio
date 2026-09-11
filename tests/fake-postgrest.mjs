/*
  tests/fake-postgrest.mjs
  --------------------------------------------------------------------------
  A stand-in for the tiny slice of supabase-js that lib/sync.js uses.

  It is NOT a Postgres emulator and must not become one. It models exactly two
  behaviours that the sync logic depends on and that would otherwise be
  untestable outside a browser with a live project:

    1. an update whose filters match nothing returns { data: [] } and NO error
       — this is the compare-and-set, and treating an empty result as an error
       would make every conflict look like an outage;
    2. inserting a duplicate primary key returns an error whose message says
       "duplicate key" — the path taken when this device pushed a row and then
       lost its local bookkeeping.

  Everything else is a Map.
  -------------------------------------------------------------------------- */

class Query {
  constructor(store, op, payload) {
    this.store = store
    this.op = op
    this.payload = payload
    this.filters = []
    this.wantSingle = null
  }
  /* `select('id', { count: 'exact', head: true })` is how lib/sync.js asks
     "does this account have anything at all" before adopting a local
     workspace into it. Head requests return a COUNT and no rows, and the
     adoption guard reads only the count — so a fake that ignored the option
     would answer "empty" for every account and merge two people's work on a
     shared machine, which is precisely the case the guard exists for. */
  select(_cols, opts) { if (opts?.count || opts?.head) this.wantCount = true; return this }
  eq(col, val) { this.filters.push([col, val, 'eq']); return this }
  is(col, val) { this.filters.push([col, val, 'is']); return this }
  not() { return this }
  lt() { return this }
  gte() { return this }
  in(col, vals) { this.filters.push([col, vals, 'in']); return this }
  limit() { return this }
  order() { return this }
  maybeSingle() { this.wantSingle = 'maybe'; return this }
  single() { this.wantSingle = 'one'; return this }

  matches() {
    return [...this.store.rows.values()].filter(r => this.filters.every(([c, v, kind]) => {
      if (kind === 'is') return v === null ? r[c] == null : r[c] === v
      if (kind === 'in') return v.includes(r[c])
      return r[c] === v
    }))
  }

  run() {
    const s = this.store
    if (this.op === 'select') {
      const rows = this.matches()
      if (this.wantCount) return { data: null, count: rows.length, error: null }
      if (this.wantSingle === 'maybe') return { data: rows[0] || null, error: null }
      if (this.wantSingle === 'one') {
        return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'no rows' } }
      }
      return { data: rows, error: null }
    }
    if (this.op === 'insert') {
      const row = this.payload
      if (s.rows.has(row.id)) {
        return { data: null, error: { message: 'duplicate key value violates unique constraint "docs_pkey"', code: '23505' } }
      }
      /* The server computes these. A client that could choose its own rev
         could pick a large one and win every future conflict by default, so
         the fake refuses to take them from the payload for the same reason
         docs_before_write() does. */
      const stored = { ...row, rev: 1, updated_at: s.stamp(), bytes: JSON.stringify(row.doc || {}).length }
      s.rows.set(row.id, stored)
      const out = { ...stored }
      if (this.wantSingle) return { data: out, error: null }
      return { data: [out], error: null }
    }
    if (this.op === 'update') {
      const rows = this.matches()
      if (!rows.length) return { data: [], error: null }   // the compare-and-set losing
      const out = rows.map(r => {
        const next = { ...r, ...this.payload, rev: r.rev + 1, updated_at: s.stamp() }
        s.rows.set(r.id, next)
        return next
      })
      if (this.wantSingle) return { data: out[0], error: null }
      return { data: out, error: null }
    }
    if (this.op === 'delete') {
      const rows = this.matches()
      for (const r of rows) s.rows.delete(r.id)
      return { data: rows, error: null }
    }
    return { data: null, error: { message: `unsupported op ${this.op}` } }
  }

  then(resolve, reject) {
    try { resolve(this.run()) } catch (e) { reject(e) }
  }
}

class Table {
  constructor(name) { this.name = name; this.rows = new Map(); this.clock = 0 }
  stamp() { this.clock += 1000; return new Date(1_800_000_000_000 + this.clock).toISOString() }
  /* The options have to be forwarded here, not only on Query.select — this is
     the FIRST select in the chain (`from('docs').select(...)`), so a Table
     that dropped them would make every head/count request look like an
     ordinary row read. */
  select(cols, opts) { return new Query(this, 'select').select(cols, opts) }
  insert(payload) { return new Query(this, 'insert', payload) }
  update(payload) { return new Query(this, 'update', payload) }
  delete() { return new Query(this, 'delete') }
}

export function fakeClient() {
  const tables = new Map()
  const get = name => {
    if (!tables.has(name)) tables.set(name, new Table(name))
    return tables.get(name)
  }
  return {
    from: name => get(name),
    _table: get,
    channel: () => ({ on() { return this }, subscribe() { return this } }),
    removeChannel: () => {},
    storage: { from: () => ({ upload: async () => ({ error: null }), download: async () => ({ data: null, error: { message: 'no' } }), remove: async () => ({}) }) },
  }
}
