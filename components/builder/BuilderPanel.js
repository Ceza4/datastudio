'use client'
import { useCallback, useEffect, useState } from 'react'
import Icon from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { describeTemplate } from '../../lib/templates'
import {
  saveTemplate, listTemplates, deleteTemplate, renameTemplate, restoreTemplate,
  instantiate, TPL_OK,
} from '../../lib/templatestore'

/*
  components/builder/BuilderPanel.js
  --------------------------------------------------------------------------
  §9.1 Builder. The governing constraint, verbatim:

    "Users who never click Builder should continue using DataStudio exactly as
     they do now, with the same interface, blocks, canvas behaviour and
     overall visual language."

  So this file is a leaf. It renders next to the Settings island, it takes the
  active notebook in and hands a new notebook out, and it touches nothing else.
  Nothing in the canvas path imports it, and closing it changes no canvas
  state — there is no canvas state here to change.

  SCOPE, ALSO VERBATIM
    "Initially, keep Builder simple and focus on the foundation: allowing users
     to structure a workspace, customize its components, save it as a template
     and duplicate it."

  Save, list, duplicate, rename, delete. Databases, relationships and
  automations are "eventually" in the same note. There is no property editor
  here and there should not be one until there is a note asking for it.

  WHY THE SAVE FORM IS A SUBMENU AND NOT A MODAL
  Same reason the text rail's Link control stopped being a window.prompt: a
  modal blocks the tab, throws away what you were looking at, and looks like a
  different piece of software than the island it was opened from. The form
  opens inside the panel, two fields deep, Enter to commit and Esc to cancel.

  THE ONE DOM TRAP IN HERE
  Opening an input from a click needs preventDefault() on the opening
  pointerdown. Without it the sequence is: pointerdown → the input mounts and
  autoFocus takes focus → mousedown's DEFAULT focus behaviour moves focus to
  the button that was pressed → the input is blurred shut inside the same
  click. That shipped once in the PDF text editor and looked exactly like
  "clicking does nothing". tests/browser/run.mjs documents it and would catch
  it here.

  DELETES DO NOT ASK
  components/ui/Toast.js explains why at length. A confirmation is a tax every
  user pays every time to prevent a mistake almost none of them are about to
  make. Deleting a template is entirely reversible, so it deletes and offers
  the way back.
  -------------------------------------------------------------------------- */

const mono = 'var(--ds-font-mono)'
const body = 'var(--ds-font-body)'

/* Dates are shown as a plain locale date, not "3 days ago". A template is
   something you come back to in a month, and by then a relative date has
   stopped being information. */
const shownDate = ms => {
  const d = new Date(ms || 0)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, fontFamily: mono, letterSpacing: 0.9, textTransform: 'uppercase',
      color: 'var(--ds-text-3)', margin: '0 0 7px',
    }}>
      {children}
    </div>
  )
}

export default function BuilderPanel({ colors, dark, notebook, onUseTemplate, onClose, visualsOn, onToggleVisuals }) {
  const { surface, raised, border, text, text2, text3, accent, accentDim, red } = colors
  const toast = useToast()

  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  /* A store that is failing is shown, not swallowed. lib/persistence.js exists
     in its current shape because the opposite once let people work for hours on
     a workspace that had stopped saving. */
  const [storeError, setStoreError] = useState(null)
  /* One line of plain prose about what the last action actually did — dropped
     links, missing assets. It stays until the next action rather than fading
     like a toast, because it is usually something to act on. */
  const [notice, setNotice] = useState(null)

  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveDesc, setSaveDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [renamingId, setRenamingId] = useState(null)
  const [renameLabel, setRenameLabel] = useState('')

  /* The list is read in exactly one place, and anything that changes it asks
     for a re-read by bumping this rather than by calling a loader of its own.
     One fetch site means one place that can be stale, and the `alive` flag
     means closing the panel mid-read cannot write into a tree that has gone. */
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  useEffect(() => {
    let alive = true
    listTemplates().then(res => {
      if (!alive) return
      setTemplates(res.templates || [])
      setStoreError(res.status === TPL_OK ? null : res.error)
      setLoading(false)
    })
    return () => { alive = false }
  }, [reloadKey])

  /* Escape closes the save form first and the panel second. Collapsing both at
     once means one stray Esc while typing a name costs the whole panel — the
     same rule the text rail follows for its submenus. */
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return
      if (saveOpen) { setSaveOpen(false); e.stopPropagation(); return }
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, saveOpen])

  async function commitSave() {
    if (busy) return
    setBusy(true)
    const res = await saveTemplate(notebook, { name: saveName, description: saveDesc.trim() })
    setBusy(false)
    if (res.status !== TPL_OK) {
      setStoreError(res.error)
      return
    }
    setSaveOpen(false)
    setSaveName('')
    setSaveDesc('')
    setStoreError(null)
    /* An asset whose bytes were already gone would otherwise produce a
       template that renders a missing-image box with nothing to explain it. */
    setNotice(res.missingAssets > 0
      ? `Saved. ${res.missingAssets} ${res.missingAssets === 1 ? 'image or PDF was' : 'images or PDFs were'} already missing from this workspace and could not be included.`
      : null)
    toast(`Saved "${res.template.name}" as a template`, { tone: 'success' })
    reload()
  }

  async function duplicate(t) {
    if (busy) return
    setBusy(true)
    const res = await instantiate(t.id)
    setBusy(false)
    if (res.status !== TPL_OK) {
      setStoreError(res.error)
      return
    }
    /* Said plainly rather than dropped in silence. A link that pointed outside
       the template cannot be carried across — it would navigate into an
       unrelated workspace — but the user is entitled to know it happened. */
    const parts = []
    if (res.droppedLinks > 0) {
      parts.push(`${res.droppedLinks} ${res.droppedLinks === 1 ? 'link' : 'links'} pointed outside this template and ${res.droppedLinks === 1 ? 'was' : 'were'} removed.`)
    }
    if (res.missingAssets > 0) {
      parts.push(`${res.missingAssets} ${res.missingAssets === 1 ? 'asset was' : 'assets were'} missing from the template.`)
    }
    setNotice(parts.length ? parts.join(' ') : null)
    onUseTemplate(res.notebook)
    toast(`Opened "${res.notebook.name}"`, { tone: 'success' })
  }

  async function remove(t) {
    const res = await deleteTemplate(t.id)
    if (res.status !== TPL_OK) { setStoreError(res.error); return }
    setTemplates(list => list.filter(x => x.id !== t.id))
    setNotice(null)
    toast(`Deleted "${t.name}"`, {
      undo: async () => {
        const back = await restoreTemplate(res.template)
        if (back.status !== TPL_OK) { setStoreError(back.error); return }
        reload()
      },
    })
  }

  async function commitRename(t) {
    const next = renameLabel.trim()
    setRenamingId(null)
    if (!next || next === t.name) return
    const res = await renameTemplate(t.id, next)
    if (res.status !== TPL_OK) { setStoreError(res.error); return }
    setTemplates(list => list.map(x => (x.id === t.id ? res.template : x)))
  }

  /* Controls that REVEAL AN INPUT act on the press, like the format rail, and
     that is exactly why the preventDefault is here rather than as decoration.
     The input mounts and autoFocuses inside this handler; without it,
     mousedown's default focus behaviour then moves focus to the button that
     was pressed and the input is blurred shut inside the same click. That is
     the PDF text-editor bug verbatim, and removing this line makes
     tests/browser/run.mjs go red rather than making nothing happen.

     onClick is kept for keyboard activation ONLY. A click with `detail === 0`
     came from Enter or Space, where there was no pointerdown to handle it;
     anything else has already been dealt with above. */
  const press = run => ({
    onPointerDown: e => { e.preventDefault(); run() },
    onClick: e => { if (e.detail === 0) run() },
  })

  const rowBtn = (label, icon, onClick, tone) => (
    <button
      key={label}
      onClick={onClick}
      aria-label={`${label} template`}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
        border: `1px solid ${border}`, background: 'transparent',
        color: tone === 'danger' ? red : text3,
        fontFamily: body, fontSize: 11, lineHeight: 1,
      }}
      onMouseEnter={e => { e.currentTarget.style.color = tone === 'danger' ? red : accent; e.currentTarget.style.borderColor = tone === 'danger' ? red : accent }}
      onMouseLeave={e => { e.currentTarget.style.color = tone === 'danger' ? red : text3; e.currentTarget.style.borderColor = border }}
    >
      <Icon name={icon} size={12} /> {label}
    </button>
  )

  return (
    <div
      role="dialog"
      aria-label="Builder"
      data-ds-builder
      data-kbd-zone
      style={{
        /* Right-anchored, like the Settings panel it sits beside. The button
           is in the top-right corner, so a left-anchored 330px panel would
           hang off the edge of the window — visible in a screenshot, and
           unreachable at a narrow width. */
        position: 'absolute', top: '100%', right: 0, marginTop: 8,
        width: 330, maxHeight: 'min(560px, 80vh)', overflowY: 'auto',
        /* The house recipe: a frosted island, same as every rail. */
        background: `${surface}dd`,
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${border}`, borderRadius: 12,
        boxShadow: `0 4px 24px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.08)'}`,
        padding: 12, fontFamily: body,
        animation: 'fadeUp 0.15s ease both',
      }}>

      <SectionLabel>Builder</SectionLabel>

      {/* ── save ──────────────────────────────────────────────────── */}
      <button
        {...press(() => {
          setSaveOpen(o => {
            if (!o) { setSaveName(notebook?.name || ''); setSaveDesc(''); setNotice(null) }
            return !o
          })
        })}
        aria-expanded={saveOpen}
        data-ds-builder-save
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 10px', borderRadius: 8, cursor: 'pointer',
          border: `1px solid ${saveOpen ? accent : border}`,
          background: saveOpen ? accentDim : 'transparent',
          color: saveOpen ? accent : text2,
          fontFamily: body, fontSize: 13, textAlign: 'left',
        }}>
        <Icon name="action-add" size={14} />
        <span style={{ flex: 1 }}>Save this workspace as a template</span>
      </button>

      {saveOpen && (
        <div style={{
          marginTop: 7, padding: 9, borderRadius: 8,
          border: `1px solid ${border}`, background: raised,
        }}>
          <input
            autoFocus
            value={saveName}
            aria-label="Template name"
            placeholder="Template name"
            onChange={e => setSaveName(e.target.value)}
            /* Both keys are handled and stopped here. React attaches at the
               root, so letting them through would hand Escape to the panel's
               own listener and Enter to the canvas keymap. */
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitSave() }
              else if (e.key === 'Escape') { e.stopPropagation(); setSaveOpen(false) }
            }}
            style={{
              width: '100%', background: 'transparent', border: 'none',
              borderBottom: `1px solid ${accent}`, color: text,
              fontFamily: body, fontSize: 13, fontWeight: 600,
              outline: 'none', padding: '3px 0', minWidth: 0,
            }} />
          <input
            value={saveDesc}
            aria-label="Template description"
            placeholder="What is it for? (optional)"
            onChange={e => setSaveDesc(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitSave() }
              else if (e.key === 'Escape') { e.stopPropagation(); setSaveOpen(false) }
            }}
            style={{
              width: '100%', marginTop: 8, background: 'transparent', border: 'none',
              borderBottom: `1px solid ${border}`, color: text2,
              fontFamily: body, fontSize: 12,
              outline: 'none', padding: '3px 0', minWidth: 0,
            }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9 }}>
            {/* The shared class rather than an inline accent fill. Text on the
                accent has to be white in both themes — the dark accent is a
                mid indigo and near-black on it is about 3:1 — and there is no
                --ds-on-accent token yet, so the one place that colour is
                already written down is .ds-btn-primary in globals.css. Reusing
                it beats adding a seventh hardcoded '#fff'. */}
            <button className="ds-btn ds-btn-primary" onClick={commitSave} disabled={busy}>Save</button>
            <span style={{ fontSize: 11, color: text2 }}>Enter to save · Esc to cancel</span>
          </div>
        </div>
      )}

      {notice && (
        <div role="status" data-ds-builder-notice style={{
          marginTop: 8, padding: '8px 10px', borderRadius: 6,
          background: 'var(--ds-amber-bg)', border: '1px solid var(--ds-amber)',
          /* The sidebar's save-failure banner reaches for a hardcoded brown
             here. On the light amber ground the body text colour is both
             legible and already a token, and the amber icon beside it carries
             the tone — so no seventh hex enters the app for this. */
          color: dark ? 'var(--ds-amber)' : text,
          fontSize: 11, lineHeight: 1.45,
          display: 'flex', gap: 6,
        }}>
          <Icon name="status-warning" size={14} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>{notice}</span>
        </div>
      )}

      {storeError && (
        <div role="alert" style={{
          marginTop: 8, padding: '8px 10px', borderRadius: 6,
          background: 'var(--ds-red-bg)', border: `1px solid ${red}`, color: red,
          fontSize: 11, lineHeight: 1.45, display: 'flex', gap: 6,
        }}>
          <Icon name="status-error" size={14} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>{storeError}</span>
        </div>
      )}

      {/* ── visuals ───────────────────────────────────────────────── */}
      {/* Builder → Visuals (24 Sep 2026). Opens the Visuals bar at the bottom
          of the canvas: shapes, connectors, sticky notes, text, mind maps,
          the pen, and Link blocks (the block-to-block mode that used to be
          this row). Rows use the save button's shape above, so the panel
          keeps one row style. Only with a notebook open: no canvas otherwise. */}
      {notebook && onToggleVisuals && (
        <div style={{ marginTop: 14 }}>
          <SectionLabel>Visuals</SectionLabel>
          <button onClick={onToggleVisuals} aria-pressed={!!visualsOn}
            data-ds-builder-visuals
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 10px', borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${visualsOn ? accent : border}`,
              background: visualsOn ? accentDim : 'transparent',
              color: visualsOn ? accent : text2,
              fontFamily: body, fontSize: 13, textAlign: 'left',
            }}>
            <Icon name="tool-mindmap" size={14} />
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block' }}>{visualsOn ? 'Close Visuals' : 'Visuals'}</span>
              <span style={{ display: 'block', fontSize: 11, color: text3, marginTop: 2 }}>
                Shapes, connectors, sticky notes and mind maps, from a bar at the bottom of the canvas.
              </span>
            </span>
          </button>
        </div>
      )}

      {/* ── list ──────────────────────────────────────────────────── */}
      <div style={{ marginTop: 14 }}>
        <SectionLabel>Templates</SectionLabel>

        {!loading && templates.length === 0 && (
          <div data-ds-builder-empty style={{
            padding: '14px 12px', borderRadius: 8,
            border: `1px dashed ${border}`,
            fontSize: 12, color: text2, lineHeight: 1.6,
          }}>
            <Icon name="status-empty" size={16} style={{ color: text3, marginBottom: 6 }} />
            {/* One sentence, and it says what the thing DOES. "No templates
                yet" would be a label for an empty box, not an explanation. */}
            A template is a copy of a whole workspace — its sheets, blocks and
            layout — that you can start new workspaces from without touching
            this one.
          </div>
        )}

        {templates.map(t => (
          <div key={t.id} data-ds-template-row style={{
            padding: '10px 10px', marginBottom: 6, borderRadius: 8,
            border: `1px solid ${border}`, background: 'transparent',
          }}>
            {renamingId === t.id ? (
              <input
                autoFocus
                value={renameLabel}
                aria-label="Template name"
                onChange={e => setRenameLabel(e.target.value)}
                onBlur={() => commitRename(t)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur() }
                  else if (e.key === 'Escape') { e.stopPropagation(); setRenamingId(null) }
                }}
                style={{
                  width: '100%', background: 'transparent', border: 'none',
                  borderBottom: `1px solid ${accent}`, color: text,
                  fontFamily: body, fontSize: 13, fontWeight: 600,
                  outline: 'none', padding: '1px 0', minWidth: 0,
                }} />
            ) : (
              <div style={{ fontSize: 13, fontWeight: 600, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.name}
              </div>
            )}

            {t.description && (
              <div style={{ marginTop: 3, fontSize: 11, color: text2, lineHeight: 1.45 }}>{t.description}</div>
            )}

            <div style={{ marginTop: 4, fontSize: 11, fontFamily: mono, color: text3, display: 'flex', gap: 8 }}>
              <span>{describeTemplate(t)}</span>
              <span>{shownDate(t.createdAt)}</span>
            </div>

            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {rowBtn('Duplicate', 'action-duplicate', () => duplicate(t))}
              {/* Same press handling as the save opener, for the same reason:
                  this swaps the title for an autoFocus input. */}
              <button
                {...press(() => { setRenamingId(t.id); setRenameLabel(t.name) })}
                aria-label="Rename template"
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                  border: `1px solid ${border}`, background: 'transparent',
                  color: text3, fontFamily: body, fontSize: 11, lineHeight: 1,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = accent; e.currentTarget.style.borderColor = accent }}
                onMouseLeave={e => { e.currentTarget.style.color = text3; e.currentTarget.style.borderColor = border }}
              >
                <Icon name="action-rename" size={12} /> Rename
              </button>
              {rowBtn('Delete', 'action-delete', () => remove(t), 'danger')}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
