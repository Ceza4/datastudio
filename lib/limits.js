/*
  lib/limits.js
  --------------------------------------------------------------------------
  Quota metering. Hooks now, enforcement later.

  Pricing isn't decided, so every check here returns ok:true today. The point
  is that the CALL SITES exist: when limits are chosen, this file changes and
  nothing else does. Retrofitting quota checks into a dozen write paths after
  the fact is how you end up with three that were missed.

  TWO RULES THIS ENCODES

  1. The free tier limits CLOUD storage, never local. IndexedDB stays
     unlimited forever. You never stop someone working — only syncing. That
     keeps the "your data never leaves your machine" position intact for
     people who never sign in, and makes the paid tier about convenience
     rather than hostage-taking.

  2. Over quota means read-only sync, not deletion. Existing data keeps
     syncing down; new pushes queue with a banner. Nothing is ever removed
     for non-payment. A thesis must not disappear because a card expired.
  -------------------------------------------------------------------------- */

const MB = 1024 * 1024
const GB = 1024 * MB

/* Placeholder shapes. Numbers are illustrative — nothing reads them for
   enforcement until ENFORCE flips to true. */
export const PLANS = {
  free: { cloudBytes: 100 * MB, imageBytes: 50 * MB,  pdfBytes: 50 * MB,  notebooks: Infinity, versionDays: 0,  sharing: false },
  pro:  { cloudBytes: 10 * GB,  imageBytes: 5 * GB,   pdfBytes: 5 * GB,   notebooks: Infinity, versionDays: 30, sharing: true  },
  team: { cloudBytes: 100 * GB, imageBytes: 50 * GB,  pdfBytes: 50 * GB,  notebooks: Infinity, versionDays: 90, sharing: true  },
}

/* The single switch. Flip when pricing is decided AND the backend reports
   real usage — enforcing against a stubbed account object would lock people
   out of an app that isn't metering anything. */
export const ENFORCE = false

export const LOCAL_UNLIMITED = true   // rule 1, made explicit and greppable

/**
 * Current account. Stubbed until auth exists; the shape is what
 * lib/sync.js will fill in from the `usage` table.
 */
export async function getAccount() {
  return {
    signedIn: false,
    plan: 'free',
    usage: { cloudBytes: 0, imageBytes: 0, notebooks: 0 },
  }
}

/**
 * @param {'cloudBytes'|'imageBytes'|'notebooks'} kind
 * @param {number} adding  bytes (or 1 for a count)
 * @returns {Promise<{ok:boolean, reason?:string, used?:number, limit?:number, plan?:string, headroom?:number}>}
 *
 * Never throws and never blocks a LOCAL write — callers use it to decide
 * whether to warn or to queue a cloud push, not whether to let someone type.
 */
export async function checkQuota(kind, adding = 0) {
  if (!ENFORCE) return { ok: true, enforced: false }

  const { signedIn, plan, usage } = await getAccount()
  if (!signedIn) return { ok: true, enforced: false }   // anonymous = local only = unlimited

  const limit = PLANS[plan]?.[kind]
  if (limit == null || limit === Infinity) return { ok: true }

  const next = (usage[kind] || 0) + adding
  if (next > limit) {
    return { ok: false, reason: 'over-quota', used: usage[kind], limit, plan }
  }
  return { ok: true, headroom: limit - next }
}

/** Human-readable message for a failed check, so call sites don't invent copy. */
export function quotaMessage(result) {
  if (!result || result.ok) return null
  const pct = result.limit ? Math.round((result.used / result.limit) * 100) : 100
  return `Cloud storage is full (${pct}% of your ${result.plan} plan). ` +
    `Your work is still saved on this device and will sync once space is free.`
}
