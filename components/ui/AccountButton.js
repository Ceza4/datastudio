'use client'
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { setDisplayName, exportEverything, deleteAccount } from '../../lib/account'
import {
  signOut, signOutEverywhere, listFactors, beginMfaEnrolment,
  confirmMfaEnrolment, disableMfa, updatePassword, changeEmail, AUTH,
} from '../../lib/auth'
import { clearState } from '../../lib/persistence'
import { idbClear, STORE_IMAGES, STORE_PDFS, STORE_FILES, STORE_TEMPLATES } from '../../lib/idb'

/*
  components/ui/AccountButton.js
  --------------------------------------------------------------------------
  The circle next to Settings, and everything behind it.

  IT WAS A CIRCULAR AVATAR AND IS NOW A LABELLED BUTTON.

  The argument for the circle was that an account is a person rather than a
  verb, so a portrait says so without a third word competing for the corner.
  That argument is fine in the abstract and wrong on this screen: beside two
  rectangular labels it read as a stray element rather than a third control,
  and the picture it displayed was of nothing, because nobody had uploaded one
  and nobody was going to.

  So: Builder · Settings · Account, three of a kind. The avatar upload went
  with it — a feature whose only job was to fill a shape that no longer
  exists.

  WHAT IS IN THE PANEL, AND WHY IT IS ONE PANEL
  Identity, plan, what you have used, two-factor, and the two irreversible
  operations. They are together because they answer one question — "what is my
  account?" — and splitting them across Settings and here is how you end up
  with users who never find data export.

  THE FREE TIER IS THE INTERESTING CASE. A free account is local-only: the sync
  engine does not run, nothing leaves the browser. That is a real product
  position and not a degraded one, so the copy says it plainly rather than
  nagging. But it also means the storage warning that Settings shows is
  materially true for free users and moot for paid ones, and this panel is
  where the difference gets explained.
  -------------------------------------------------------------------------- */

const bytes = n => {
  if (!Number.isFinite(n) || n <= 0) return '0 MB'
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(n < 10 * 1024 ** 3 ? 1 : 0)} GB`
}

function Meter({ label, used, limit, colors }) {
  /* A limit of zero is not "100% full", it is "this tier has no cloud". A bar
     pinned to the right with an amber warning would tell a free user their
     storage is full when in fact they simply have not bought any. */
  if (!limit) return null
  const pct = Math.min(1, used / limit)
  const tone = pct > 0.9 ? 'var(--ds-red)' : pct > 0.7 ? 'var(--ds-amber)' : colors.accent
  return (
    <div style={{ marginTop: 9 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', fontSize: 11,
        fontFamily: 'var(--ds-font-mono)', color: colors.text3, marginBottom: 4,
      }}>
        <span>{label}</span>
        <span style={{ color: colors.text2 }}>{bytes(used)} / {bytes(limit)}</span>
      </div>
      <div style={{ height: 5, borderRadius: 4, background: colors.raised, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 4, background: tone,
          width: `${Math.max(1, pct * 100)}%`, transition: 'width .4s ease',
        }} />
      </div>
    </div>
  )
}

/* One category's page. The label is not drawn here: the back row above
   already names the page, and a second copy right under it is noise. It is
   kept as a prop so every page says what it is where it is used. */
function Section({ children }) {
  return <div style={{ marginTop: 4 }}>{children}</div>
}

/* A row that is not built yet. Visible and honest rather than hidden: the
   category exists, and so does the thing, but it has nothing behind it yet.
   Disabled, so keyboard walking (islandButtons filters [disabled]) skips it. */
function SoonRow({ icon, label, row, text3 }) {
  return (
    <button disabled style={{ ...row, cursor: 'default', color: text3 }} title={`${label} · coming soon`}>
      <Icon name={icon} size={14} />
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ fontSize: 11, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.6, textTransform: 'uppercase' }}>Soon</span>
    </button>
  )
}

/* A row that opens a small form in place: change email, change password.
   In place rather than a modal, the same argument BuilderPanel makes for its
   save form. Enter submits, Escape closes the form (and only the form: it
   stops propagation, or the panel's own Escape listener would shut the whole
   panel).

   preventDefault on mousedown is the DOM trap BuilderPanel documents. Without
   it, autoFocus puts focus in the new input, then the click's default focus
   moves it back to the button. */
function InlineForm({ icon, label, fields, submitLabel, onSubmit, row, colors, busy }) {
  const { border, raised, text, accent } = colors
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState({})
  async function submit() {
    const ok = await onSubmit(values)
    if (ok) { setOpen(false); setValues({}) }
  }
  return (
    <div>
      <button style={row} onMouseDown={e => e.preventDefault()}
        onClick={() => { setOpen(o => !o); setValues({}) }} aria-expanded={open}>
        <Icon name={icon} size={14} />
        <span style={{ flex: 1 }}>{label}</span>
      </button>
      {open && (
        <div style={{ padding: '2px 10px 8px' }}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation?.(); setOpen(false) }
            if (e.key === 'Enter') { e.preventDefault(); submit() }
          }}>
          {fields.map((f, i) => (
            <input key={f.key} autoFocus={i === 0} type={f.type} autoComplete={f.autoComplete}
              aria-label={f.placeholder} placeholder={f.placeholder}
              value={values[f.key] || ''}
              onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
              style={{
                width: '100%', background: raised, border: `1px solid ${border}`,
                borderRadius: 6, padding: '6px 8px', fontSize: 12, color: text, marginBottom: 6,
                fontFamily: 'var(--ds-font-body)', outline: 'none', boxSizing: 'border-box',
              }} />
          ))}
          <div style={{ display: 'flex', gap: 6 }}>
            <button disabled={busy} onClick={submit}
              style={{ ...row, flex: 1, justifyContent: 'center', background: accent, color: '#fff', fontWeight: 600, fontSize: 12 }}>
              {submitLabel}
            </button>
            <button onClick={() => setOpen(false)}
              style={{ ...row, width: 'auto', justifyContent: 'center', border: `1px solid ${border}`, fontSize: 12, padding: '8px 12px' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AccountButton({ account, colors, dark, onChanged, onSignOut }) {
  const [open, setOpen] = useState(false)
  /* Which category page is open: null is the category list. Reset on close,
     so the panel always reopens on the list rather than deep in Security. */
  const [page, setPage] = useState(null)
  useEffect(() => { if (!open) setPage(null) }, [open])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [factors, setFactors] = useState(null)
  const [enrol, setEnrol] = useState(null)
  const [code, setCode] = useState('')
  const [confirmDelete, setConfirmDelete] = useState('')
  const [deleting, setDeleting] = useState(false)
  const rootRef = useRef(null)

  const { surface, border, text, text2, text3, raised, accent } = colors
  const name = account?.name || null
  const email = account?.email || null

  useEffect(() => {
    if (!open) return
    listFactors().then(r => setFactors(r.factors || []))
    /* Click-outside and Escape, both. A panel that only closes on one of them
       is a panel somebody gets stuck in — Escape is the reflex for keyboard
       users and clicking away is the reflex for everyone else. */
    const onDown = e => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function saveName() {
    setBusy(true)
    await setDisplayName(nameDraft)
    setBusy(false)
    setRenaming(false)
    onChanged?.()
  }

  async function doExport() {
    setBusy(true); setNotice(null)
    const res = await exportEverything()
    setBusy(false)
    if (!res.ok) { setNotice({ bad: true, text: res.message }); return }
    /* Handed over as a download rather than opened: an export is a file you
       keep, and rendering someone's entire workspace as JSON in a tab is a
       good way to have it end up in a screenshot. */
    const a = document.createElement('a')
    a.href = URL.createObjectURL(res.blob)
    a.download = `datastudio-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    setNotice({ text: 'Export downloaded.' })
  }

  async function doDelete() {
    if (confirmDelete !== email) return
    setDeleting(true)
    const res = await deleteAccount(confirmDelete)
    setDeleting(false)
    if (!res.ok) { setNotice({ bad: true, text: res.message }); return }

    /* THE LOCAL COPY IS THE DATA, NOT A CACHE OF IT.

       This used to navigate to '/' and stop. The cloud rows were gone and
       every document, image and PDF was still sitting in IndexedDB on the
       machine the request was made from — which, for a local-first app, is
       the copy the person was asking to have deleted. The session cookies
       stayed too, for a user that no longer exists, producing a confusing run
       of 401s at exactly the wrong moment. (The route now clears the cookies
       server-side as well; this is the half that has to happen in the tab.)

       Best-effort and in this order: sign out so no listener re-populates
       anything, then wipe. Each step is guarded — a failure here must not
       leave the user staring at a dialog after their account has already been
       destroyed, with no way forward. */
    try { await signOut() } catch { /* the account is gone; there is no session to end */ }
    try { await clearState() } catch { /* fall through to the store wipe */ }
    try {
      await Promise.all([
        idbClear(STORE_IMAGES), idbClear(STORE_PDFS),
        idbClear(STORE_FILES), idbClear(STORE_TEMPLATES),
      ])
    } catch { /* nothing left to do but leave */ }

    window.location.href = '/'
  }

  const row = {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
    padding: '8px 10px', borderRadius: 8, border: 'none', background: 'none',
    color: text2, fontSize: 13, fontFamily: 'var(--ds-font-body)',
    cursor: 'pointer', textAlign: 'left',
  }

  const cloud = Boolean(account?.cloud)
  const limits = account?.limits || {}
  const usage = account?.usage || {}

  return (
    <div ref={rootRef} data-kbd-zone style={{ position: 'relative' }}>
      {/* A ds-tbtn inside the top-right island (app/app/page.js), the same as
          Builder, People and Settings beside it. The island owns the glass. */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Account"
        aria-expanded={open}
        title={email || 'Account'}
        className={`ds-tbtn${open ? ' is-on' : ''}`}
      >
        <Icon name="auth-account" size={14} />
        Account
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 292,
          background: `${surface}f2`, backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          border: `1px solid ${border}`, borderRadius: 12,
          boxShadow: `0 4px 24px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.08)'}`,
          padding: 12, fontFamily: 'var(--ds-font-body)', zIndex: 50,
        }}>

          {/* ── identity ── */}
          <div style={{ minWidth: 0 }}>
            {renaming ? (
              <input
                autoFocus value={nameDraft} maxLength={60}
                onChange={e => setNameDraft(e.target.value)}
                onBlur={saveName}
                onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setRenaming(false) }}
                style={{
                  width: '100%', background: raised, border: `1px solid ${border}`,
                  borderRadius: 6, padding: '4px 8px', fontSize: 13, color: text,
                  fontFamily: 'var(--ds-font-body)', outline: 'none',
                }}
              />
            ) : (
              <button onClick={() => { setNameDraft(name || ''); setRenaming(true) }}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'text', color: text, fontSize: 13, fontWeight: 600, fontFamily: 'var(--ds-font-body)' }}>
                {name || 'Add your name'}
              </button>
            )}
            <div title={email || ''} style={{
              fontSize: 11, color: text3, marginTop: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{email}</div>
          </div>

          {/* ── categories ──
              A list of categories first, each opening its own page with a
              back row. Decided 24 Sep 2026 over one long scroll: Plan,
              Security and Privacy each hold forms (2FA, email, password,
              delete), and stacked they ran past the fold. */}
          {page === null ? (
            <div style={{ marginTop: 13, paddingTop: 8, borderTop: `1px solid ${border}` }}>
              {[
                { id: 'plan', icon: 'plan-upgrade', label: 'Plan', meta: account?.label || 'Free' },
                { id: 'security', icon: 'state-lock', label: 'Security', meta: factors === null ? '' : factors.length ? '2FA on' : '2FA off' },
                { id: 'privacy', icon: 'storage-drive', label: 'Privacy', meta: '' },
              ].map(c => (
                <button key={c.id} style={row} onClick={() => { setNotice(null); setPage(c.id) }}>
                  <Icon name={c.icon} size={14} />
                  <span style={{ flex: 1 }}>{c.label}</span>
                  {c.meta && <span style={{ fontSize: 11, color: text3 }}>{c.meta}</span>}
                  <Icon name="nav-chevron-right" size={12} style={{ color: text3 }} />
                </button>
              ))}
              {/* ── sign out ──
              On its own, last. It is not a security setting, just the way out. */}
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${border}` }}>
            {/* THE QUESTION COMES FIRST, and it came with the section from
                Settings. Asking "also remove this workspace from this device?"
                after the token is gone would be asking about something the
                person can no longer see; cancelling leaves them signed in,
                which is the only sensible reading of "cancel" here. */}
            <button style={row} onClick={async () => {
              if (onSignOut && !(await onSignOut())) return
              await signOut(); window.location.href = '/login'
            }}>
              <Icon name="auth-sign-out" size={14} />
              <span style={{ flex: 1 }}>Sign out</span>
            </button>
          </div>
            </div>
          ) : (
            <div style={{ marginTop: 13, paddingTop: 8, borderTop: `1px solid ${border}` }}>
              <button style={{ ...row, color: text, fontWeight: 600, paddingLeft: 6 }}
                onClick={() => { setNotice(null); setPage(null) }} aria-label="Back to account categories">
                <Icon name="nav-chevron-right" size={12} style={{ transform: 'rotate(180deg)', color: text3 }} />
                <span style={{ flex: 1 }}>{page === 'plan' ? 'Plan' : page === 'security' ? 'Security' : 'Privacy'}</span>
              </button>

          {page === 'plan' && (<>
          {/* ── plan ── */}
          <div style={{ marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: text2 }}>Current plan</span>
              <span style={{
                fontSize: 12, fontWeight: 600, color: cloud ? accent : text2,
                padding: '2px 8px', borderRadius: 16,
                border: `1px solid ${cloud ? accent : border}`,
              }}>{account?.label || 'Free'}</span>
            </div>

            {cloud ? (
              <>
                <Meter label="DOCUMENTS" used={usage.cloudBytes || 0} limit={limits.cloudBytes || 0} colors={colors} />
                <Meter label="FILES" used={usage.assetBytes || 0} limit={limits.assetBytes || 0} colors={colors} />
                {account?.subStatus === 'past_due' && (
                  /* Rule 2 from lib/limits.js, said out loud. Nothing is ever
                     deleted for non-payment and existing data keeps syncing
                     down — so the copy has to reassure, not threaten, or people
                     panic-export at exactly the wrong moment. */
                  <div style={{ marginTop: 9, fontSize: 11, color: 'var(--ds-amber)', lineHeight: 1.5 }}>
                    Payment didn&apos;t go through. Nothing has been deleted and everything
                    still syncs down — new changes are queued until it&apos;s sorted.
                  </div>
                )}
              </>
            ) : (
              <div style={{ marginTop: 8, fontSize: 12, color: text2, lineHeight: 1.6 }}>
                Everything is stored in this browser and never leaves it.
                <div style={{ color: text3, marginTop: 4 }}>
                  Clearing your browser data removes it, and it isn&apos;t on your other devices.
                  Upgrade to sync.
                </div>
              </div>
            )}

            <a href="/pricing" style={{
              ...row, marginTop: 10, justifyContent: 'center', textDecoration: 'none',
              border: `1px solid ${cloud ? border : accent}`,
              color: cloud ? text2 : accent, fontWeight: 600, fontSize: 12,
            }}>{cloud ? 'Manage subscription' : 'Upgrade'}</a>
          </div>
          </>)}

          {page === 'security' && (<>
          {/* ── security ──
              Categorised like SettingsPanel (Appearance · Canvas · Keyboard ·
              Storage): Plan · Security · Privacy, then Sign out on its own.
              Security is how you get in: email, password, second factor, and
              revoking every other session. */}
          <Section label="Security" border={border} text3={text3}>
            <InlineForm icon="auth-account" label="Change email" submitLabel="Send confirmation"
              row={row} colors={colors} busy={busy}
              fields={[{ key: 'email', type: 'email', autoComplete: 'email', placeholder: 'New email address' }]}
              onSubmit={async v => {
                setBusy(true); setNotice(null)
                const r = await changeEmail(v.email, email)
                setBusy(false)
                setNotice({ bad: r.status !== AUTH.OK, text: r.message })
                return r.status === AUTH.OK
              }} />
            <InlineForm icon="state-lock" label="Change password" submitLabel="Change password"
              row={row} colors={colors} busy={busy}
              fields={[
                { key: 'next', type: 'password', autoComplete: 'new-password', placeholder: 'New password' },
                { key: 'again', type: 'password', autoComplete: 'new-password', placeholder: 'Repeat new password' },
              ]}
              onSubmit={async v => {
                setNotice(null)
                /* Checked here, not in lib/auth: a mismatch is a typing
                   mistake, and it should never cost a round trip. */
                if ((v.next || '') !== (v.again || '')) { setNotice({ bad: true, text: 'The two passwords do not match.' }); return false }
                setBusy(true)
                const r = await updatePassword(v.next)
                setBusy(false)
                setNotice({ bad: r.status !== AUTH.OK, text: r.message })
                return r.status === AUTH.OK
              }} />

            {enrol ? (
              <div style={{ marginTop: 8 }}>
                {enrol.qr && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={enrol.qr} alt="Scan this with your authenticator app"
                    style={{ width: 132, height: 132, display: 'block', margin: '0 auto 8px', borderRadius: 8, background: '#fff' }} />
                )}
                {/* The secret in text, for anyone whose authenticator lives on
                    this same machine and therefore cannot photograph the
                    screen — i.e. most desktop password managers. */}
                <div style={{ fontSize: 11, fontFamily: 'var(--ds-font-mono)', color: text3, wordBreak: 'break-all', marginBottom: 8, textAlign: 'center' }}>
                  {enrol.secret}
                </div>
                <input value={code} inputMode="numeric" maxLength={6} placeholder="000000"
                  onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                  style={{
                    width: '100%', background: raised, border: `1px solid ${border}`, borderRadius: 6,
                    padding: '8px 10px', fontSize: 16, letterSpacing: 5, textAlign: 'center',
                    fontFamily: 'var(--ds-font-mono)', color: text, outline: 'none', boxSizing: 'border-box',
                  }} />
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button disabled={busy} onClick={async () => {
                    setBusy(true)
                    const r = await confirmMfaEnrolment(enrol.factorId, code)
                    setBusy(false)
                    if (r.status !== AUTH.OK) { setNotice({ bad: true, text: r.message }); return }
                    setEnrol(null); setCode('')
                    listFactors().then(x => setFactors(x.factors || []))
                    setNotice({ text: r.message })
                  }} style={{ ...row, flex: 1, justifyContent: 'center', background: accent, color: '#fff', fontWeight: 600, fontSize: 12 }}>
                    Turn on
                  </button>
                  <button onClick={() => { setEnrol(null); setCode('') }}
                    style={{ ...row, width: 'auto', justifyContent: 'center', border: `1px solid ${border}`, fontSize: 12, padding: '8px 12px' }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button disabled={busy} style={row} onClick={async () => {
                setNotice(null)
                if (factors?.length) {
                  setBusy(true)
                  const r = await disableMfa(factors[0].id)
                  setBusy(false)
                  listFactors().then(x => setFactors(x.factors || []))
                  setNotice({ text: r.message })
                  return
                }
                setBusy(true)
                const r = await beginMfaEnrolment()
                setBusy(false)
                if (r.status !== AUTH.OK) { setNotice({ bad: true, text: r.message }); return }
                setEnrol(r)
              }}>
                <Icon name="auth-account" size={14} />
                <span style={{ flex: 1 }}>Two-factor authentication</span>
                <span style={{ fontSize: 11, color: factors?.length ? 'var(--ds-green)' : text3 }}>
                  {factors === null ? '…' : factors.length ? 'On' : 'Off'}
                </span>
              </button>
            )}

            <button style={{ ...row, color: text3 }} onClick={async () => {
              if (onSignOut && !(await onSignOut())) return
              await signOutEverywhere(); window.location.href = '/login'
            }}>
              <Icon name="auth-sign-out" size={14} />
              <span style={{ flex: 1 }}>Sign out everywhere</span>
            </button>
          </Section>
          </>)}

          {page === 'privacy' && (<>
          {/* ── privacy ──
              Reserved as a category now, with the two things that already
              exist: getting your data out, and getting it deleted. The
              policies are real rows marked Soon. A row that exists and says
              "not yet" is easier to find later than one that appears
              without warning. */}
          <Section label="Privacy" border={border} text3={text3}>
            <button style={row} onClick={doExport} disabled={busy}>
              <Icon name="action-export" size={14} />
              <span style={{ flex: 1 }}>Export everything</span>
            </button>
            <SoonRow icon="status-info" label="Privacy policy" row={row} text3={text3} />
            <SoonRow icon="status-info" label="Terms of service" row={row} text3={text3} />
            <details>
                <summary style={{ ...row, color: 'var(--ds-red)', listStyle: 'none', cursor: 'pointer' }}>
                  <Icon name="action-delete" size={14} />
                  <span style={{ flex: 1 }}>Delete account</span>
                </summary>
                <div style={{ padding: '8px 2px 0' }}>
                  <p style={{ fontSize: 11, color: text2, lineHeight: 1.55, margin: '0 0 8px' }}>
                    Deletes your account, every document and every file, everywhere —
                    immediately and permanently. This is not the 30-day bin.
                    Export first if you want a copy.
                  </p>
                  {/* Typing the address, not clicking a red button. A click can
                      be a reflex; typing your own email cannot be done by
                      accident. Checked again on the server, because a dialog is
                      a courtesy and the request can be made without one. */}
                  <input
                    value={confirmDelete}
                    onChange={e => setConfirmDelete(e.target.value)}
                    placeholder={email || 'your email'}
                    style={{
                      width: '100%', background: raised, border: `1px solid ${border}`,
                      borderRadius: 6, padding: '6px 8px', fontSize: 12, color: text,
                      fontFamily: 'var(--ds-font-body)', outline: 'none', boxSizing: 'border-box',
                    }} />
                  <button
                    disabled={confirmDelete !== email || deleting}
                    onClick={doDelete}
                    style={{
                      ...row, marginTop: 8, justifyContent: 'center',
                      border: '1px solid var(--ds-red)',
                      color: confirmDelete === email ? '#fff' : text3,
                      background: confirmDelete === email ? 'var(--ds-red)' : 'transparent',
                      opacity: deleting ? 0.6 : 1, fontWeight: 600, fontSize: 12,
                    }}>
                    {deleting ? 'Deleting…' : 'Delete permanently'}
                  </button>
                </div>
            </details>
          </Section>
          </>)}
            </div>
          )}

          {notice && (
            <div role="status" style={{
              marginTop: 10, fontSize: 11, lineHeight: 1.5,
              color: notice.bad ? 'var(--ds-red)' : text3,
            }}>{notice.text}</div>
          )}
        </div>
      )}
    </div>
  )
}
