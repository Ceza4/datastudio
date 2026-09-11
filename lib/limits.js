/*
  lib/limits.js
  --------------------------------------------------------------------------
  Quota metering. The hooks were placed before there was a backend; this is
  the version that reads real numbers and enforces them.

  TWO RULES THIS ENCODES, UNCHANGED SINCE THE HOOKS WENT IN

  1. The free tier limits CLOUD storage, never local. IndexedDB stays
     unlimited forever. You never stop someone working — only syncing. That
     keeps the "your data never leaves your machine" position intact for
     people who never sign in, and makes the paid tier about convenience
     rather than hostage-taking.

  2. Over quota means read-only sync, not deletion. Existing data keeps
     syncing DOWN; new pushes queue with a banner. Nothing is ever removed for
     non-payment. A thesis must not disappear because a card expired.

  THE THING THAT MAKES THIS SAFE TO ENFORCE: IT NEVER AWAITS THE NETWORK.

  checkQuota is called from putImage, putPdf and saveState — all of them on
  the local write path, all of them in front of a person who is typing. If
  this file did a round trip to read `usage`, every image drop would stall on
  a network request, and a slow connection would present as a slow app. So
  the account is a CACHE, refreshed by lib/sync.js as a side effect of work it
  is doing anyway, and read synchronously here. A stale number can let one
  extra write through. That is the correct failure: the alternative is a
  spinner on a feature whose whole promise is speed.
  -------------------------------------------------------------------------- */

const MB = 1024 * 1024
const GB = 1024 * MB

/* THE NUMBERS ARE NO LONGER AUTHORITATIVE HERE. THEY ARE A PREDICTION.

   Until migration 0004 this table WAS the quota: lib/limits.js ran in the
   browser and decided what a user could store. That is client-side
   JavaScript, so a modified client simply skipped it — the security
   checklist's own acceptance criterion, "a user cannot increase their own
   storage quota", failed. The tier was safe (RLS locked profiles.plan) while
   the LIMIT the tier implies was checked nowhere the user could not reach.

   The limits now live in a `plans` table that no client can write, and are
   enforced by triggers on `docs` and `assets`. Postgres refuses the write.

   So why keep numbers here at all? For SPEED, and only for speed. Dropping a
   file should say "that's too large for your plan" instantly, not after a
   round trip — and refusing to predict would mean uploading 200MB before
   finding out. These are overwritten by the real ones the moment
   refreshAccount() runs; they exist to be right on the first frame after a
   cold start, before the server has answered.

   WHEN THE TWO DISAGREE, THE SERVER WINS AND THE CLIENT IS THE BUG. Anything
   that reads these values must treat them as a hint, never as permission. */
export const PLANS = {
  free: { cloudBytes: 0,            assetBytes: 0,             maxFileBytes: 0,           cloud: false, notebooks: Infinity, label: 'Free' },
  pro:  { cloudBytes: 2147483648,   assetBytes: 53687091200,   maxFileBytes: 262144000,   cloud: true,  notebooks: Infinity, label: 'Pro'  },
  max:  { cloudBytes: 21474836480,  assetBytes: 268435456000,  maxFileBytes: 1073741824,  cloud: true,  notebooks: Infinity, label: 'Max'  },
}

/* FREE IS ZERO, NOT A SPECIAL CASE.

   A free account is local-only: nothing leaves the browser. Expressing that as
   `cloudBytes: 0` rather than as an `if (plan === 'free')` somewhere means the
   ordinary quota arithmetic already refuses the first cloud write, and there
   is no branch for a future feature to forget. The same choice is made in the
   `plans` table for the same reason. */

export const ENFORCE = true

export const LOCAL_UNLIMITED = true   // rule 1, made explicit and greppable

/* Older call sites meter images and PDFs separately (`imageBytes`,
   `pdfBytes`). Both are Storage bytes and both come out of one budget now, so
   they alias rather than being renamed at every call site — renaming them
   would be a wide diff through files that are otherwise untouched by this
   work, and a missed one would silently meter nothing. */
const ALIASES = { imageBytes: 'assetBytes', pdfBytes: 'assetBytes', images: 'assetBytes' }
const canonical = kind => ALIASES[kind] || kind

const EMPTY_USAGE = { cloudBytes: 0, assetBytes: 0, notebooks: 0 }

/* The cache. Module-level for the same reason persistence.js keeps
   observedSavedAt module-level: there is exactly one account per tab, and
   threading it through every call site would make every caller responsible
   for a rule that is not theirs to get wrong. */
let account = { signedIn: false, plan: 'free', label: 'Free', cloud: false, limits: { cloudBytes: 0, assetBytes: 0, maxFileBytes: 0 }, usage: { ...EMPTY_USAGE }, at: 0, stale: true }

/** How long a cached account is trusted before sync.js is asked to refresh. */
export const ACCOUNT_TTL_MS = 60_000

/**
 * Called by lib/sync.js whenever it has just learned something true — after a
 * pull, after a push, after auth changes. This is the ONLY writer.
 */
export function setAccount(next) {
  if (!next || next.signedIn === false) {
    account = { signedIn: false, plan: 'free', label: 'Free', cloud: false, limits: { cloudBytes: 0, assetBytes: 0, maxFileBytes: 0 }, usage: { ...EMPTY_USAGE }, at: Date.now(), stale: false }
    return account
  }
  const plan = PLANS[next.plan] ? next.plan : 'free'
  account = {
    signedIn: true,
    plan,
    label: next.label || PLANS[plan].label,
    /* Whether this tier syncs at all. Read from the SERVER's answer when there
       is one and only falling back to the local table when there is not — the
       whole point of 0004 is that this is the server's decision. */
    cloud: next.cloud ?? PLANS[plan].cloud,
    userId: next.userId ?? null,
    orgId: next.orgId ?? null,
    orgName: next.orgName ?? null,
    role: next.role ?? 'owner',
    email: next.email ?? null,
    name: next.name ?? null,
    avatar: next.avatar ?? null,
    subStatus: next.subStatus ?? 'active',
    periodEnd: next.periodEnd ?? null,
    limits: next.limits || {
      cloudBytes: PLANS[plan].cloudBytes,
      assetBytes: PLANS[plan].assetBytes,
      maxFileBytes: PLANS[plan].maxFileBytes,
    },
    usage: { ...EMPTY_USAGE, ...(next.usage || {}) },
    at: Date.now(),
    stale: false,
  }
  return account
}

/**
 * The largest single file this account may upload, in bytes.
 *
 * Zero on Free, which is not a bug: Free is local-only, so there is no cloud
 * file size because there are no cloud files. Callers that police a LOCAL
 * import must not use this — lib/files.js and lib/images.js have their own
 * caps, and those exist to keep the browser responsive rather than to sell a
 * subscription.
 */
export function maxUploadBytes() {
  const a = accountSnapshot()
  return a.limits?.maxFileBytes ?? 0
}

/** Does this account sync at all? False on Free, and on every signed-out state. */
export function cloudEnabled() {
  const a = accountSnapshot()
  return Boolean(a.signedIn && a.cloud)
}

/** Synchronous. Returns the cache as it stands, with an honest staleness flag. */
export function accountSnapshot() {
  return { ...account, stale: account.stale || Date.now() - account.at > ACCOUNT_TTL_MS }
}

/**
 * Kept async because every existing caller awaits it, and because a future
 * version may want to await a refresh. It does NOT hit the network today —
 * see the note at the top of this file about why that matters.
 */
export async function getAccount() {
  return accountSnapshot()
}

/**
 * Read `profiles.plan` and the `usage` row. Called by lib/sync.js, not from a
 * write path.
 *
 * The two reads are separate queries rather than a join because they have
 * different failure meanings: no profile row is a broken signup (the
 * on_auth_user_created trigger did not fire), while no usage row is simply an
 * account that has never pushed anything. Collapsing them into one join makes
 * both look like "no data".
 */
export async function refreshAccount(client, userId) {
  if (!client || !userId) return setAccount({ signedIn: false })
  try {
    /* ONE round trip, not four. `my_account()` is a security-definer function
       (migration 0004 §12) that returns the profile, the organisation, the
       role, the plan, its limits and current usage as a single jsonb object —
       and returns only what the caller is already entitled to read, because it
       filters on auth.uid() internally rather than taking an id from the
       caller. Four separate selects to render one circle and a plan name is
       four chances for a partial failure to produce a half-rendered panel. */
    const { data, error } = await client.rpc('my_account')
    if (error || !data) throw error || new Error('no account row')

    return setAccount({
      signedIn: true,
      /* The signed-in user's own id. `my_account()` has always returned it as
         `user_id`; nothing read it until block attribution needed to answer
         "was this change mine?" — a flag on every one of your own edits is
         noise, and the only thing that distinguishes them is this. */
      userId: data.user_id || null,
      plan: data.plan || 'free',
      label: data.plan_label || null,
      cloud: Boolean(data.cloud),
      orgId: data.org_id || null,
      orgName: data.org_name || null,
      role: data.role || 'owner',
      email: data.email || null,
      name: data.name || null,
      avatar: data.avatar || null,
      subStatus: data.status || 'active',
      periodEnd: data.period_end || null,
      limits: {
        cloudBytes:   Number(data.limits?.doc_bytes ?? 0),
        assetBytes:   Number(data.limits?.asset_bytes ?? 0),
        maxFileBytes: Number(data.limits?.max_file_bytes ?? 0),
      },
      usage: {
        cloudBytes: Number(data.usage?.doc_bytes ?? 0),
        assetBytes: Number(data.usage?.asset_bytes ?? 0),
        notebooks:  Number(data.usage?.notebooks ?? 0),
      },
    })
  } catch {
    /* Unreachable backend. Keep whatever we last knew rather than resetting to
       zero — resetting would read as "plenty of room" and let a large upload
       queue up that is going to be refused the moment the network returns. */
    account = { ...account, stale: true }
    return account
  }
}

/**
 * @param {'cloudBytes'|'assetBytes'|'imageBytes'|'pdfBytes'|'notebooks'} kind
 * @param {number} adding  bytes (or 1 for a count)
 * @returns {Promise<{ok:boolean, reason?:string, used?:number, limit?:number, plan?:string, headroom?:number}>}
 *
 * Never throws and never blocks a LOCAL write — callers use it to decide
 * whether to warn or to queue a cloud push, not whether to let someone type.
 */
export async function checkQuota(kind, adding = 0) {
  if (!ENFORCE) return { ok: true, enforced: false }

  const { signedIn, plan, usage } = accountSnapshot()
  if (!signedIn) return { ok: true, enforced: false }   // anonymous = local only = unlimited

  const key = canonical(kind)
  /* The server's number first. PLANS is the cold-start prediction; once
     refreshAccount has run, `limits` is what Postgres will actually enforce,
     and predicting something different is how a user gets told a file is fine
     and then watches the upload be refused. */
  const limit = accountSnapshot().limits?.[key] ?? PLANS[plan]?.[key]
  if (limit == null || limit === Infinity) return { ok: true }

  const next = (usage[key] || 0) + adding
  if (next > limit) {
    return { ok: false, reason: 'over-quota', used: usage[key] || 0, limit, plan, kind: key }
  }
  return { ok: true, headroom: limit - next }
}

/** Human-readable message for a failed check, so call sites don't invent copy. */
export function quotaMessage(result) {
  if (!result || result.ok) return null
  const pct = result.limit ? Math.round((result.used / result.limit) * 100) : 100
  const what = result.kind === 'assetBytes' ? 'Cloud storage for files' : 'Cloud storage'
  return `${what} is full (${pct}% of your ${result.plan} plan). ` +
    `Your work is still saved on this device and will sync once space is free.`
}

/** Test seam. */
export function _resetAccount() {
  account = { signedIn: false, plan: 'free', label: 'Free', cloud: false, limits: { cloudBytes: 0, assetBytes: 0, maxFileBytes: 0 }, usage: { ...EMPTY_USAGE }, at: 0, stale: true }
}
