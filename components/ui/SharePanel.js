'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
// Icon is not imported: this panel uses no glyphs. See the close button.
import { Z } from '../../lib/theme'
import {
  LEVEL_PROJECT, LEVEL_SHEET, LEVEL_BLOCK,
  ROLE_VIEWER, ROLE_EDITOR, VIS_ORG, VIS_PRIVATE,
  sharesFor, onShares, shareBlockedReason, roleLabel, levelNoun, visibilityLabel,
} from '../../lib/sharing'
import { listShares, createShare, revokeShare, setVisibility } from '../../lib/shares'

/*
  components/ui/SharePanel.js
  --------------------------------------------------------------------------
  WHO CAN SEE THIS, AND WHAT THEY CAN DO WITH IT.

  One panel for all three levels from migration 0008 — a project, a sheet, a
  block — because they are the same decision at three sizes and three separate
  dialogs would be three places to get the wording wrong.

  ── THE DESIGN DECISION WORTH DEFENDING ────────────────────────────────────

  THE LIST OF PEOPLE IS THE PRIVACY SETTING. There is no second "is this
  private" toggle sitting beside it that could disagree with it.

  Matas asked for "a setting that lets you choose whether to make it private or
  not", and the obvious build is a boolean column. It is the wrong build: a
  flag and a list of grants are two sources of truth for one question, and the
  first time they disagree — private is on, three people still have access —
  the UI is lying and nobody can tell which half is wrong. So the grants ARE
  the answer, and the one genuinely separate question gets its own control:

      Everyone in my workspace   ←→   Only me and people I invite

  That is `docs.visibility`, and it means something the grant list cannot say:
  whether COLLEAGUES who were never invited can see this at all. Two different
  questions, two controls, no overlap.

  ── WHAT THIS COMPONENT DOES NOT DO ────────────────────────────────────────

  It does not decide anything. Every list here is a cache of what the server
  said, every write is a request the server may refuse, and a refusal is shown
  as the sentence the database sent rather than swallowed. lib/sharing.js's
  header makes the same point at more length.

  PORTAL, for the reason components/ui/ConfirmDialog.js gives: `position:
  fixed` inside a CSS transform positions against the transform. This opens
  from inside the sidebar and from the canvas, so it renders to document.body.
  `npm run check:geom` enforces it.
  -------------------------------------------------------------------------- */

/**
 * @param {{
 *   open: boolean,
 *   docId: string,
 *   docName?: string,
 *   level?: 'doc'|'sheet'|'block',
 *   sheetId?: string,
 *   blockId?: string,
 *   subjectName?: string,
 *   visibility?: 'org'|'private',
 *   canManageVisibility?: boolean,
 *   sheetNames?: Record<string,string>,
 *   onClose: () => void,
 *   onVisibilityChange?: (next: string) => void,
 * }} props
 */
export default function SharePanel({
  open, docId, docName, level = LEVEL_PROJECT, sheetId, blockId, subjectName,
  visibility = VIS_ORG, canManageVisibility = true, sheetNames = {},
  onClose, onVisibilityChange,
}) {
  const cardRef = useRef(null)
  const openerRef = useRef(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState(ROLE_VIEWER)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [rows, setRows] = useState([])
  const [vis, setVis] = useState(visibility)

  useEffect(() => { setVis(visibility) }, [visibility])

  /* Read from the store rather than holding a second copy: a revoke made in
     another panel, or a pull that noticed a grant is gone, has to show up
     here too. lib/sharing.js rebuilds rather than merges for the same
     reason. */
  useEffect(() => {
    if (!open) return undefined
    setRows(sharesFor(docId))
    const off = onShares(() => setRows(sharesFor(docId)))
    listShares(docId).then(res => { if (!res.ok && res.reason !== 'unconfigured') setError(res.reason) })
    return off
  }, [open, docId])

  /* Focus in on open, and BACK to the opener on close. Skipping the return is
     the accessibility bug people notice without being able to name: the panel
     closes and the next Tab starts from the top of the document. */
  useEffect(() => {
    if (!open) return undefined
    openerRef.current = document.activeElement
    cardRef.current?.querySelector('input')?.focus()
    return () => { try { openerRef.current?.focus?.() } catch { /* the opener may be gone */ } }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError(null)
    const addr = email.trim()
    if (!addr) { setError('Enter an email address to share with.'); return }
    setBusy(true)
    const res = await createShare({ docId, level, sheetId, blockId, email: addr, role })
    setBusy(false)
    if (!res.ok) { setError(res.reason); return }
    setEmail('')
  }, [email, role, docId, level, sheetId, blockId])

  const drop = useCallback(async (id) => {
    setError(null)
    const res = await revokeShare(id, docId)
    if (!res.ok) setError(res.reason)
  }, [docId])

  const flipVisibility = useCallback(async () => {
    const next = vis === VIS_PRIVATE ? VIS_ORG : VIS_PRIVATE
    setError(null)
    /* Optimistic, then corrected. The alternative is a control that does
       nothing for 300ms, which reads as broken on exactly the setting people
       are most anxious about. */
    setVis(next)
    const res = await setVisibility(docId, next)
    if (!res.ok) { setVis(vis); setError(res.reason); return }
    onVisibilityChange?.(res.visibility)
  }, [vis, docId, onVisibilityChange])

  if (!open || typeof document === 'undefined') return null

  const blocked = shareBlockedReason()
  const live = rows.filter(r => !r.revoked_at)
  const what = level === LEVEL_PROJECT
    ? (docName || 'this project')
    : (subjectName || `this ${levelNoun(level)}`)

  return createPortal(
    <div
      data-ds-panel-scrim
      onPointerDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: Z.panel,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--ds-space-5)',
        background: 'rgba(26, 25, 23, 0.42)',
        backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
        animation: 'dsScrimIn 0.14s ease',
      }}>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Share ${what}`}
        data-kbd-zone
        style={{
          width: 'min(460px, 100%)',
          background: 'var(--ds-glass)',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid var(--ds-border)',
          borderRadius: 'var(--ds-radius-lg)',
          boxShadow: 'var(--ds-shadow-lg)',
          padding: 'var(--ds-space-5)',
          fontFamily: 'var(--ds-font-body)',
          animation: 'dsDialogIn 0.18s cubic-bezier(.34,1.2,.64,1)',
        }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--ds-space-3)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--ds-font-head)', fontSize: 'var(--ds-fs-xl)',
              fontWeight: 700, color: 'var(--ds-text)', lineHeight: 1.3,
            }}>Share {what}</div>
            <div style={{
              marginTop: 2, fontSize: 'var(--ds-fs-md)', color: 'var(--ds-text-3)',
            }}>
              {level === LEVEL_PROJECT
                ? 'Everything in it, including every sheet.'
                : level === LEVEL_SHEET
                  ? 'Just this sheet. The rest of the project stays yours.'
                  : 'Just this block.'}
            </div>
          </div>
          {/* A character, not an icon: the generated set has no close glyph
              (129 icons, none of them an ×), and hand-editing icon-paths.js to
              add one would break the rule that keeps the set honest. Same
              choice ExportPanel and CurveFitPanel already made. */}
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none', border: '1px solid transparent', cursor: 'pointer',
              color: 'var(--ds-text-3)', borderRadius: 'var(--ds-radius-md)',
              fontSize: 16, lineHeight: 1, padding: 2, flexShrink: 0,
            }}>×</button>
        </div>

        {blocked && (
          <div style={{
            marginTop: 'var(--ds-space-4)', padding: 'var(--ds-space-3)',
            border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius-md)',
            background: 'var(--ds-raised)', color: 'var(--ds-text-2)',
            fontSize: 'var(--ds-fs-md)', lineHeight: 1.5,
          }}>{blocked}</div>
        )}

        {!blocked && (
          <form onSubmit={submit} style={{
            marginTop: 'var(--ds-space-4)', display: 'flex', gap: 'var(--ds-space-2)',
          }}>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email address"
              autoComplete="off"
              style={{
                flex: 1, minWidth: 0,
                padding: 'var(--ds-btn-padding)',
                borderRadius: 'var(--ds-radius-md)',
                border: '1px solid var(--ds-border)',
                background: 'var(--ds-base)', color: 'var(--ds-text)',
                fontFamily: 'var(--ds-font-body)', fontSize: 'var(--ds-fs-lg)',
              }} />
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              aria-label="Access level"
              style={{
                padding: 'var(--ds-btn-padding)',
                borderRadius: 'var(--ds-radius-md)',
                border: '1px solid var(--ds-border)',
                background: 'var(--ds-raised)', color: 'var(--ds-text)',
                fontFamily: 'var(--ds-font-body)', fontSize: 'var(--ds-fs-md)',
                cursor: 'pointer',
              }}>
              <option value={ROLE_VIEWER}>{roleLabel(ROLE_VIEWER)}</option>
              <option value={ROLE_EDITOR}>{roleLabel(ROLE_EDITOR)}</option>
            </select>
            <button
              type="submit"
              disabled={busy}
              style={{
                padding: 'var(--ds-btn-padding)',
                borderRadius: 'var(--ds-radius-md)',
                border: '1px solid var(--ds-accent)',
                background: 'var(--ds-accent)', color: 'var(--ds-accent-text)',
                fontFamily: 'var(--ds-font-body)', fontSize: 'var(--ds-fs-lg)',
                fontWeight: 600, cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.6 : 1,
              }}>{busy ? 'Sharing…' : 'Share'}</button>
          </form>
        )}

        {error && (
          <div role="alert" style={{
            marginTop: 'var(--ds-space-3)', fontSize: 'var(--ds-fs-md)',
            color: 'var(--ds-red)', lineHeight: 1.5,
          }}>{error}</div>
        )}

        <div style={{ marginTop: 'var(--ds-space-4)' }}>
          {live.length === 0 ? (
            <div style={{ fontSize: 'var(--ds-fs-md)', color: 'var(--ds-text-3)' }}>
              Nobody else has access yet.
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {live.map(r => (
                <ShareRow key={r.id} row={r} sheetNames={sheetNames} onRevoke={drop} />
              ))}
            </ul>
          )}
        </div>

        {level === LEVEL_PROJECT && (
          <div style={{
            marginTop: 'var(--ds-space-5)', paddingTop: 'var(--ds-space-4)',
            borderTop: '1px solid var(--ds-border)',
          }}>
            <div style={{
              fontSize: 'var(--ds-fs-md)', fontWeight: 600, color: 'var(--ds-text-2)',
            }}>Who else can find it</div>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 'var(--ds-space-3)', marginTop: 'var(--ds-space-2)',
            }}>
              <div style={{ fontSize: 'var(--ds-fs-md)', color: 'var(--ds-text-3)', lineHeight: 1.5 }}>
                {visibilityLabel(vis)}
              </div>
              <button
                onClick={flipVisibility}
                disabled={!canManageVisibility}
                title={canManageVisibility ? undefined : 'Only the owner of a project can change this.'}
                style={{
                  padding: 'var(--ds-btn-padding)',
                  borderRadius: 'var(--ds-radius-md)',
                  border: '1px solid var(--ds-border)',
                  background: 'var(--ds-raised)', color: 'var(--ds-text)',
                  fontFamily: 'var(--ds-font-body)', fontSize: 'var(--ds-fs-md)',
                  fontWeight: 600, whiteSpace: 'nowrap',
                  cursor: canManageVisibility ? 'pointer' : 'default',
                  opacity: canManageVisibility ? 1 : 0.5,
                }}>
                {vis === VIS_PRIVATE ? 'Open to workspace' : 'Make private'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* Module scope, not declared inside SharePanel. A component created during
   render is a new type every render, so React tears the rows down and rebuilds
   them instead of updating — the note in ConfirmDialog.js is about the same
   bug remounting seventeen toolbar buttons on every drag frame. */
function ShareRow({ row, sheetNames, onRevoke }) {
  const what =
    row.subject_kind === LEVEL_PROJECT ? 'whole project'
  : row.subject_kind === LEVEL_SHEET   ? (sheetNames[row.sheet_id] || 'one sheet')
  : 'one block'

  return (
    <li style={{
      display: 'flex', alignItems: 'center', gap: 'var(--ds-space-2)',
      padding: '6px 0',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 'var(--ds-fs-md)', color: 'var(--ds-text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{row.grantee_email}</div>
        <div style={{ fontSize: 'var(--ds-fs-sm)', color: 'var(--ds-text-3)' }}>
          {what} · {roleLabel(row.role)}
        </div>
      </div>
      <button
        onClick={() => onRevoke(row.id)}
        style={{
          background: 'none', border: '1px solid transparent',
          color: 'var(--ds-text-3)', cursor: 'pointer',
          borderRadius: 'var(--ds-radius-md)',
          fontFamily: 'var(--ds-font-body)', fontSize: 'var(--ds-fs-sm)',
          padding: '4px 8px', flexShrink: 0,
        }}>Remove</button>
    </li>
  )
}
