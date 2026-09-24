'use client'
import { useState } from 'react'
import Icon from '../ui/Icon'
import { SHORTCUT_GROUPS } from '../../lib/shortcuts'
import { GRID_SIZES, IMAGE_DROP_MODES, shouldReduceMotion } from '../../lib/prefs'
import { CANVAS_PRESETS, CANVAS_BG_LIMITS, normalizeCanvasBg, resolveCanvasBg, isDefaultCanvasBg, dotContrast } from '../../lib/canvasbg'
import { SYNC_OFF, SYNC_SYNCED, SYNC_SYNCING, SYNC_QUEUED, SYNC_ERROR } from '../../lib/sync'

/*
  components/settings/SettingsPanel.js
  --------------------------------------------------------------------------
  Lifted out of app/app/page.js, where it had grown to ~180 lines inline and
  was about to grow further. Sections are declared in a fixed order —
  Appearance · Canvas · Keyboard · Storage — so adding one never
  reshuffles the others under someone who has learned where things are.

  The panel is a plain presentational component: every value comes in as a
  prop and every change goes out through a callback. It owns exactly one piece
  of state, whether the shortcut list is expanded, because nothing outside
  needs to know that.
  -------------------------------------------------------------------------- */

const mono = 'var(--ds-font-mono)'
const body = 'var(--ds-font-body)'

/* The four sync states, as one line under the account email.

   Each carries its own icon and its own remedy, because "error" on its own is
   a dead end: offline says the work is safe here, over-quota says what to do
   about it, and a real error shows the message verbatim rather than hiding a
   gap in the translation list behind "something went wrong" — the same rule
   lib/auth.js follows for auth errors. */
function SyncLine({ status }) {
  const state = status?.state || SYNC_OFF
  const pending = status?.pending || 0

  const map = {
    [SYNC_SYNCED]:  { icon: 'sync-synced',  color: 'var(--ds-green)',  text: pending ? `Synced · ${pending} waiting` : 'Synced to your account' },
    [SYNC_SYNCING]: { icon: 'sync-syncing', color: 'var(--ds-text-2)', text: 'Syncing…' },
    [SYNC_QUEUED]:  { icon: 'sync-offline', color: 'var(--ds-amber)',  text: pending ? `Waiting to sync · ${pending}` : 'Waiting to sync' },
    [SYNC_ERROR]:   { icon: 'sync-error',   color: 'var(--ds-red)',    text: 'Sync error' },
    [SYNC_OFF]:     { icon: 'sync-offline', color: 'var(--ds-text-3)', text: 'Signed in · not syncing yet' },
  }
  const v = map[state] || map[SYNC_OFF]

  return (
    <div style={{ marginTop: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: v.color }}>
        <Icon name={v.icon} size={12} />
        <span>{v.text}</span>
      </div>
      {status?.message && (
        <div style={{ fontSize: 11, color: 'var(--ds-text-3)', marginTop: 2, lineHeight: 1.45 }}>
          {status.message}
        </div>
      )}
    </div>
  )
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

/* A labelled on/off row. Used for anything that isn't a choice between
   several values — those get a segmented control instead, because a toggle
   that means "one of five" is a puzzle. */
function Toggle({ label, hint, icon, on, onChange }) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 10px', marginBottom: 6, borderRadius: 8, cursor: 'pointer',
        border: `1px solid ${on ? 'var(--ds-accent)' : 'var(--ds-border)'}`,
        background: on ? 'var(--ds-accent-dim)' : 'transparent',
        color: on ? 'var(--ds-accent)' : 'var(--ds-text-2)',
        fontFamily: body, textAlign: 'left',
      }}>
      {icon && <Icon name={icon} size={14} />}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13 }}>{label}</span>
        {hint && (
          <span style={{ display: 'block', fontSize: 11, color: 'var(--ds-text-3)', marginTop: 2, lineHeight: 1.4 }}>
            {hint}
          </span>
        )}
      </span>
      {/* A real track, not a tick. At a glance you can tell an off switch from
          a row that simply has no state. */}
      <span aria-hidden="true" style={{
        width: 26, height: 15, borderRadius: 8, flexShrink: 0, position: 'relative',
        background: on ? 'var(--ds-accent)' : 'var(--ds-border)',
        transition: 'background .16s ease',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: on ? 13 : 2,
          width: 11, height: 11, borderRadius: '50%', background: 'var(--ds-surface)',
          transition: 'left .16s cubic-bezier(.34,1.3,.64,1)',
        }} />
      </span>
    </button>
  )
}

/* ── Canvas background ───────────────────────────────────────────────────

   A slider with a typed box beside it. You drag for feel and type for an exact
   value. Both commit through the same normalise (lib/canvasbg.js), so neither
   can store a value the other could not show.

   The box keeps its own draft string while it has focus. Otherwise every
   keystroke would be normalised mid-word: typing "1.5" would pass "1." through
   the clamp and snap back. It commits on Enter or blur, and Escape drops the
   draft. */
function SliderRow({ label, readout, value, limits, unit, onChange }) {
  const [draft, setDraft] = useState(null)
  const decimals = limits.step < 1 ? 1 : 0
  const shown = draft ?? Number(value).toFixed(decimals)
  function commit() {
    if (draft === null) return
    const n = Number(draft.replace(',', '.'))
    if (Number.isFinite(n)) onChange(n)
    setDraft(null)
  }
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11, color: 'var(--ds-text-3)', marginBottom: 4 }}>
        <span style={{ flex: 1 }}>{label}</span>
        {readout}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="range" aria-label={label}
          min={limits.min} max={limits.max} step={limits.step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{ flex: 1, minWidth: 0, accentColor: 'var(--ds-accent)', margin: 0 }} />
        <label style={{
          display: 'flex', alignItems: 'center', gap: 2, width: 64, flexShrink: 0,
          padding: '4px 6px', borderRadius: 6, border: '1px solid var(--ds-border)',
          background: 'var(--ds-raised)', fontFamily: mono, fontSize: 11, color: 'var(--ds-text-3)',
        }}>
          <input type="text" inputMode="decimal" aria-label={`${label} value`}
            value={shown}
            onFocus={e => { setDraft(shown); e.target.select() }}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur() }
              else if (e.key === 'Escape') { e.stopPropagation(); setDraft(null); e.currentTarget.blur() }
              else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault()
                const dir = e.key === 'ArrowUp' ? 1 : -1
                const mult = e.shiftKey ? 10 : 1
                setDraft(null)
                onChange(Number(value) + dir * limits.step * mult)
              }
            }}
            style={{
              width: '100%', minWidth: 0, border: 0, outline: 'none', background: 'transparent',
              fontFamily: mono, fontSize: 11, color: 'var(--ds-text)', textAlign: 'right', padding: 0,
            }} />
          <span aria-hidden="true">{unit}</span>
        </label>
      </div>
    </div>
  )
}

/* Two-tone swatch: the preset's light ground on the left and its dark ground on
   the right, each with one dot in its own ink. The notebook is shared across
   themes, so a preset is picked for both of them at once. The swatch should
   show both. */
function PresetSwatch({ preset, size = 18 }) {
  const half = { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }
  const dot = ink => <span style={{ width: 3, height: 3, borderRadius: '50%', background: ink, opacity: 0.7 }} />
  return (
    <span aria-hidden="true" style={{
      display: 'flex', width: size, height: size, borderRadius: 4, overflow: 'hidden', flexShrink: 0,
      border: '1px solid var(--ds-border)',
    }}>
      <span style={{ ...half, background: preset.light.bg }}>{dot(preset.light.ink)}</span>
      <span style={{ ...half, background: preset.dark.bg }}>{dot(preset.dark.ink)}</span>
    </span>
  )
}

/* The preset picker. A dropdown rather than a segmented control: six options
   will not fit in 276px as buttons, and each one needs a swatch to mean
   anything. A button plus an ARIA listbox, not a native <select>, because
   an <option> cannot hold a swatch. */
function PresetDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const current = CANVAS_PRESETS.find(p => p.id === value) || CANVAS_PRESETS[0]
  function pick(id) { onChange(id); setOpen(false) }
  return (
    <div style={{ position: 'relative', marginBottom: 10 }}
      onKeyDown={e => {
        if (!open) return
        if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const i = CANVAS_PRESETS.findIndex(p => p.id === current.id)
          const n = (i + (e.key === 'ArrowDown' ? 1 : -1) + CANVAS_PRESETS.length) % CANVAS_PRESETS.length
          onChange(CANVAS_PRESETS[n].id)
        }
        if (e.key === 'Enter') { e.preventDefault(); setOpen(false) }
      }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox" aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 10px', borderRadius: 8, cursor: 'pointer', fontFamily: body, fontSize: 13,
          border: `1px solid ${open ? 'var(--ds-accent)' : 'var(--ds-border)'}`,
          background: 'transparent', color: 'var(--ds-text)', textAlign: 'left',
        }}>
        <PresetSwatch preset={current} />
        <span style={{ flex: 1 }}>{current.name}</span>
        <Icon name="nav-chevron-down" size={12} />
      </button>
      {open && (
        <div role="listbox" aria-label="Background colour"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 2,
            background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.22)', padding: 4,
          }}>
          {CANVAS_PRESETS.map(p => (
            <button key={p.id} type="button" role="option" aria-selected={p.id === current.id}
              onClick={() => pick(p.id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 8px', borderRadius: 6, cursor: 'pointer', border: 0,
                fontFamily: body, fontSize: 13, textAlign: 'left',
                background: p.id === current.id ? 'var(--ds-accent-dim)' : 'transparent',
                color: p.id === current.id ? 'var(--ds-accent)' : 'var(--ds-text-2)',
              }}>
              <PresetSwatch preset={p} />
              <span style={{ flex: 1 }}>{p.name}</span>
              {p.id === current.id && <Icon name="action-check" size={12} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CanvasBackground({ notebook, dark, onChange }) {
  if (!notebook) {
    return (
      <div style={{ fontSize: 11, color: 'var(--ds-text-3)', lineHeight: 1.5, marginBottom: 14 }}>
        Open a notebook to change its background.
      </div>
    )
  }
  const bg = normalizeCanvasBg(notebook.canvasBg)
  const resolved = resolveCanvasBg(bg, dark)
  const L = CANVAS_BG_LIMITS
  const opacityKey = dark ? 'opacityDark' : 'opacityLight'
  const ratio = dotContrast(resolved.ink, resolved.bg, resolved.alpha)
  /* Above 3:1 the dots meet the WCAG bar for MEANINGFUL graphics. A background
     texture should not. It is allowed, because this is a personal choice, but
     it says so instead of quietly letting the grid get louder than the work. */
  const loud = ratio >= 3
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11, color: 'var(--ds-text-3)', margin: '10px 0 6px' }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Background · <span style={{ color: 'var(--ds-text-2)' }}>{notebook.name || 'Untitled'}</span>
        </span>
        {!isDefaultCanvasBg(bg) && (
          <button type="button" onClick={() => onChange(null)}
            style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: body, fontSize: 11, color: 'var(--ds-accent)' }}>
            Reset
          </button>
        )}
      </div>
      <PresetDropdown value={bg.preset} onChange={id => onChange({ preset: id })} />
      <SliderRow label="Dot spacing" unit="px" value={bg.spacing} limits={L.spacing}
        onChange={v => onChange({ spacing: v })} />
      <SliderRow label="Dot radius" unit="px" value={bg.radius} limits={L.radius}
        onChange={v => onChange({ radius: v })} />
      <SliderRow label={`Dot opacity · ${dark ? 'dark' : 'light'} theme`} unit="%" value={bg[opacityKey]} limits={L.opacity}
        readout={
          <span title="Dot contrast against the background. Under 3:1 keeps it a texture."
            style={{ fontFamily: mono, color: loud ? 'var(--ds-amber)' : 'var(--ds-text-3)' }}>
            {ratio.toFixed(2)}:1{loud ? ' · loud' : ''}
          </span>
        }
        onChange={v => onChange({ [opacityKey]: v })} />
      <Toggle
        label="Ruler dots"
        hint="Every 5th dot larger and stronger"
        icon="view-grid"
        on={bg.ruler}
        onChange={v => onChange({ ruler: v })}
      />
      <div style={{ fontSize: 11, color: 'var(--ds-text-3)', lineHeight: 1.5 }}>
        Saved with this notebook. Everyone who opens it sees it.
      </div>
    </div>
  )
}

export default function SettingsPanel({
  dark, setDark,
  prefs, setPref,
  usage, persisted, formatBytes,
  onDeleteAllData,
  /* onSignOut moved to components/ui/AccountButton with the rest of the
     account, and it took its "also wipe this device?" question with it. */
  /* The live sync state, straight from lib/sync.js. Four states plus off, and
     "silence" is deliberately not one of them — a sync that quietly stops
     syncing is the same bug as a save that quietly stops saving, one layer
     out, and this app has already shipped that one once. */
  syncStatus,
  /* The plan decides what is TRUE in this section, not merely what is on
     offer. On Free the browser is the only copy of the work; on Pro and Max it
     is a cache in front of one. Those are different sentences, and printing
     the wrong one turns a storage section into either a false alarm or a false
     reassurance. */
  account,
  /* The notebook whose background the Canvas section edits (the active one),
     or null. onCanvasBgChange(patch) merges; onCanvasBgChange(null) resets. */
  canvasNotebook, onCanvasBgChange,
}) {
  const [showShortcuts, setShowShortcuts] = useState(false)

  /* THE ACCOUNT SECTION LEFT THIS PANEL.

     It used to read the session itself, render the email, and own the sign-out
     button. All three now live behind the Account button in the top-right, which is
     where people look for them — and two places to sign out is one too many,
     the same argument that moved the theme toggle in here in the first place.
     This component is purely presentational again: every value arrives as a
     prop and it makes no network calls of its own.

     What survives is the SYNC line, moved down into Storage, because "where
     does my work live" is a storage question rather than an identity one. */

  return (
    <div
      role="dialog"
      aria-label="Settings"
      data-kbd-zone
      style={{
        position: 'absolute', top: '100%', right: 0, marginTop: 8,
        width: 300, maxHeight: 'min(560px, 80vh)', overflowY: 'auto',
        background: 'var(--ds-surface)',
        border: '1px solid var(--ds-border)', borderRadius: 12,
        boxShadow: '0 12px 40px rgba(0,0,0,0.28)',
        padding: 12, fontFamily: body,
        animation: 'fadeUp 0.15s ease both',
      }}>

      {/* ── Appearance ─────────────────────────────────────────────── */}
      <SectionLabel>Appearance</SectionLabel>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {[['Light', false, 'theme-light'], ['Dark', true, 'theme-dark']].map(([lbl, val, ic]) => (
          <button key={lbl} onClick={() => setDark(val)}
            aria-pressed={dark === val}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '8px 0', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: body,
              border: `1.5px solid ${dark === val ? 'var(--ds-accent)' : 'var(--ds-border)'}`,
              background: dark === val ? 'var(--ds-accent-dim)' : 'transparent',
              color: dark === val ? 'var(--ds-accent)' : 'var(--ds-text-2)',
              fontWeight: dark === val ? 650 : 500,
            }}>
            <Icon name={ic} size={14} />
            {lbl}
          </button>
        ))}
      </div>

      {/* ── Canvas ─────────────────────────────────────────────────── */}
      <SectionLabel>Canvas</SectionLabel>
      <Toggle
        label="Always show the grid"
        hint="Otherwise it appears only while Snap is on"
        icon="view-grid"
        on={prefs.gridAlways}
        onChange={v => setPref('gridAlways', v)}
      />
      <Toggle
        label="Snap on by default"
        hint="Applies to canvases you open from now on"
        icon="tool-snap"
        on={prefs.snapDefault}
        onChange={v => setPref('snapDefault', v)}
      />
      {/* This preference existed in the stored payload, was normalised, was
          migrated — and had no toggle and no reader anywhere in the app. It is
          honoured now (providers.js stamps it on <html>), so it needed a way to
          be set. `null` means "follow the operating system", which is why the
          toggle reads the resolved value rather than the raw one. */}
      <Toggle
        label="Reduce motion"
        hint={prefs.reduceMotion === null ? 'Following your system setting' : 'Overrides your system setting'}
        icon="tool-snap"
        on={shouldReduceMotion(prefs)}
        onChange={v => setPref('reduceMotion', v)}
      />

      {/* LINE grid, not dots. gridSize is personal and is also the snap step.
          Dot spacing is the notebook's own (Background, below), so the two
          are named apart. */}
      <div style={{ fontSize: 11, color: 'var(--ds-text-3)', margin: '10px 0 6px' }}>Line grid size · also the snap step</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {GRID_SIZES.map(s => (
          <button key={s} onClick={() => setPref('gridSize', s)}
            aria-pressed={prefs.gridSize === s}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 6, cursor: 'pointer',
              fontFamily: mono, fontSize: 11,
              border: `1px solid ${prefs.gridSize === s ? 'var(--ds-accent)' : 'var(--ds-border)'}`,
              background: prefs.gridSize === s ? 'var(--ds-accent-dim)' : 'transparent',
              color: prefs.gridSize === s ? 'var(--ds-accent)' : 'var(--ds-text-2)',
            }}>
            {s}
          </button>
        ))}
      </div>

      <CanvasBackground notebook={canvasNotebook} dark={dark}
        onChange={patch => onCanvasBgChange && onCanvasBgChange(patch)} />

      {/* A SEGMENTED CONTROL, not a Toggle — matching Grid size above and this
          file's own rule that a Toggle is for on/off and a segmented control is
          for one of a few values. "Full or Icon" is the latter, and it is likely
          to grow a third option (Compact as a drop default) before it shrinks. */}
      <div style={{ fontSize: 11, color: 'var(--ds-text-3)', margin: '10px 0 6px' }}>New images drop as</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {IMAGE_DROP_MODES.map(m => (
          <button key={m} onClick={() => setPref('imageDropMode', m)}
            aria-pressed={prefs.imageDropMode === m}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 6, cursor: 'pointer',
              fontFamily: body, fontSize: 12, textTransform: 'capitalize',
              border: `1px solid ${prefs.imageDropMode === m ? 'var(--ds-accent)' : 'var(--ds-border)'}`,
              background: prefs.imageDropMode === m ? 'var(--ds-accent-dim)' : 'transparent',
              color: prefs.imageDropMode === m ? 'var(--ds-accent)' : 'var(--ds-text-2)',
            }}>
            {m}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--ds-text-3)', lineHeight: 1.5, marginBottom: 14 }}>
        Hold Shift while dropping to land that one batch as icons, whatever this
        is set to.
      </div>

      {/* ── Keyboard ───────────────────────────────────────────────── */}
      <SectionLabel>Keyboard</SectionLabel>
      {/* Same source as the ? overlay (lib/shortcuts.js), so the two can't
          drift apart. Anything bound elsewhere is invisible in both. */}
      <button onClick={() => setShowShortcuts(s => !s)}
        aria-expanded={showShortcuts}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 10px', marginBottom: showShortcuts ? 8 : 14,
          borderRadius: 8, cursor: 'pointer', fontFamily: body, fontSize: 13,
          border: `1px solid ${showShortcuts ? 'var(--ds-accent)' : 'var(--ds-border)'}`,
          background: showShortcuts ? 'var(--ds-accent-dim)' : 'transparent',
          color: showShortcuts ? 'var(--ds-accent)' : 'var(--ds-text-2)',
        }}>
        <span style={{ flex: 1, textAlign: 'left' }}>Shortcuts</span>
        {showShortcuts
          ? <Icon name="nav-chevron-down" size={12} style={{ opacity: 0.8 }} />
          : <span style={{ fontSize: 11, fontFamily: mono, opacity: 0.8 }}>?</span>}
      </button>

      {showShortcuts && (
        <div style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 14, paddingRight: 2 }}>
          {SHORTCUT_GROUPS.map(({ title, note, rows }) => (
            <div key={title} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontFamily: mono, letterSpacing: 0.7, textTransform: 'uppercase', color: 'var(--ds-text-3)', marginBottom: note ? 2 : 5 }}>{title}</div>
              {note && <div style={{ fontSize: 11, color: 'var(--ds-text-3)', marginBottom: 5, lineHeight: 1.4 }}>{note}</div>}
              {rows.map(([k, d]) => (
                <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0' }}>
                  <kbd style={{
                    fontFamily: mono, fontSize: 11, padding: '2px 6px', borderRadius: 4,
                    border: '1px solid var(--ds-border)', background: 'var(--ds-raised)',
                    color: 'var(--ds-text-2)', flexShrink: 0, whiteSpace: 'nowrap',
                  }}>{k}</kbd>
                  <span style={{ fontSize: 11, color: 'var(--ds-text-3)', lineHeight: 1.45 }}>{d}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── Storage ────────────────────────────────────────────────── */}
      <SectionLabel>Storage</SectionLabel>
      {/* WAS: "Everything is stored in this browser. Nothing is uploaded."
          True when it was written, false the day sync shipped — which makes it
          the worst kind of copy: a privacy claim the product no longer honours,
          sitting in the panel somebody opens precisely to check before
          trusting you with something. The identical claim was in the public
          landing page's FAQ too ("your files are never uploaded to a server");
          that page is now the wall in app/page.js and the claim went with it. */}
      <div style={{ fontSize: 12, color: 'var(--ds-text-2)', lineHeight: 1.6, marginBottom: 8 }}>
        {account?.cloud
          ? 'This browser holds a working copy. Your account holds the original.'
          : 'Everything is stored in this browser and never leaves it.'}
      </div>
      {account?.cloud && syncStatus && (
        <div style={{ marginBottom: 10 }}><SyncLine status={syncStatus} /></div>
      )}
      {usage && (
        <div style={{ fontSize: 12, color: 'var(--ds-text-2)', display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontFamily: mono }}>
          <span>{formatBytes(usage.usage)} used</span>
          <span style={{ color: 'var(--ds-text-3)' }}>of ~{formatBytes(usage.quota)}</span>
        </div>
      )}
      {/* Stated once, here, where someone came looking — not shouted from the
          sidebar. Same colour and same icon whatever the answer, because the
          amber warning triangle was doing the alarming, not the words. */}
      <div style={{
        display: 'flex', gap: 6, alignItems: 'flex-start',
        fontSize: 12, marginBottom: 10, lineHeight: 1.5,
        color: 'var(--ds-text-3)',
      }}>
        <Icon name="status-info" size={14} style={{ marginTop: 1 }} />
        {/* THE HONEST VERSION, AND WHY THE LINE IS NOT SIMPLY DELETED.

            Removing it was asked for on the grounds that we need to GUARANTEE
            the storage. We cannot. navigator.storage.persist() is a request;
            the browser grants or refuses it on engagement heuristics, and no
            code we write changes that. Deleting the sentence would not create
            a guarantee — it would only stop mentioning the risk.

            What actually changed is that the risk stopped mattering, for paid
            accounts. With a cloud original, eviction costs a re-download and
            nothing else, so raising it at all would be alarming somebody about
            a cache. On Free the browser genuinely is the only copy, and that
            is exactly the person who deserves to be told.

            So the guarantee now comes from the account rather than from the
            browser, and this text says which of those two worlds the reader is
            standing in. */}
        <span>
          {account?.cloud
            ? 'Your work is in your account, so clearing this browser clears only a copy — it downloads again next time you sign in.'
            : persisted === true
              ? 'This browser has agreed to keep your workspace, so it will not be cleared to reclaim disk space. It is still the only copy — upgrade to keep one in your account.'
              : 'This browser is the only place your work exists, and browsers can clear storage to reclaim disk space. Export anything you cannot lose, or upgrade to keep a copy in your account.'}
        </span>
      </div>

      <button onClick={onDeleteAllData}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          padding: '8px 0', borderRadius: 8, border: '1px solid var(--ds-border)',
          background: 'transparent', color: 'var(--ds-red)', fontSize: 12, fontWeight: 600,
          cursor: 'pointer', fontFamily: body,
        }}>
        <Icon name="action-delete" size={14} />
        Delete all local data
      </button>

      <div style={{ borderTop: '1px solid var(--ds-border)', marginTop: 14, paddingTop: 9, fontSize: 11, color: 'var(--ds-text-2)', lineHeight: 1.6, fontFamily: mono }}>
        DataStudio · local-first, cloud-backed
      </div>
    </div>
  )
}
