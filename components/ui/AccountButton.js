'use client'
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { setDisplayName, exportEverything, deleteAccount } from '../../lib/account'
import {
  signOut, signOutEverywhere, listFactors, beginMfaEnrolment,
  confirmMfaEnrolment, disableMfa, AUTH,
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

export default function AccountButton({ account, colors, dark, onChanged, onSignOut }) {
  const [open, setOpen] = useState(false)
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
      {/* Styled from the same values as Builder and Settings — same padding,
          radius, blur, border and type — so the three read as one row rather
          than two buttons and an ornament. */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Account"
        aria-expanded={open}
        title={email || 'Account'}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px', borderRadius: 10,
          background: `${surface}ee`,
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          border: `1px solid ${open ? accent : border}`,
          boxShadow: `0 4px 24px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.08)'}`,
          fontFamily: 'var(--ds-font-body)', fontSize: 13,
          color: open ? accent : text2, cursor: 'pointer',
        }}
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

          {/* ── plan ── */}
          <div style={{ marginTop: 13, paddingTop: 11, borderTop: `1px solid ${border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{
                fontSize: 11, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.9,
                textTransform: 'uppercase', color: text3,
              }}>Plan</span>
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

          {/* ── security ── */}
          <div style={{ marginTop: 12, paddingTop: 11, borderTop: `1px solid ${border}` }}>
            <span style={{
              fontSize: 11, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.9,
              textTransform: 'uppercase', color: text3,
            }}>Security</span>

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

            <button style={row} onClick={doExport} disabled={busy}>
              <Icon name="action-export" size={14} />
              <span style={{ flex: 1 }}>Export everything</span>
            </button>

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

            <button style={{ ...row, color: text3 }} onClick={async () => {
              if (onSignOut && !(await onSignOut())) return
              await signOutEverywhere(); window.location.href = '/login'
            }}>
              <Icon name="auth-sign-out" size={14} />
              <span style={{ flex: 1 }}>Sign out everywhere</span>
            </button>
          </div>

          {/* ── delete ── */}
          <div style={{ marginTop: 12, paddingTop: 11, borderTop: `1px solid ${border}` }}>
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
          </div>

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
