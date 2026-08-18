'use client'
import { useState } from 'react'
import Icon from '../ui/Icon'
import { SHORTCUT_GROUPS } from '../../lib/shortcuts'
import { GRID_SIZES } from '../../lib/prefs'

/*
  components/settings/SettingsPanel.js
  --------------------------------------------------------------------------
  Lifted out of app/app/page.js, where it had grown to ~180 lines inline and
  was about to grow further. Sections are declared in a fixed order —
  Appearance · Canvas · Keyboard · Storage · Account — so adding one never
  reshuffles the others under someone who has learned where things are.

  The panel is a plain presentational component: every value comes in as a
  prop and every change goes out through a callback. It owns exactly one piece
  of state, whether the shortcut list is expanded, because nothing outside
  needs to know that.
  -------------------------------------------------------------------------- */

const mono = 'var(--ds-font-mono)'
const body = 'var(--ds-font-body)'

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 9, fontFamily: mono, letterSpacing: 0.9, textTransform: 'uppercase',
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
        width: '100%', display: 'flex', alignItems: 'center', gap: 9,
        padding: '8px 9px', marginBottom: 6, borderRadius: 8, cursor: 'pointer',
        border: `1px solid ${on ? 'var(--ds-accent)' : 'var(--ds-border)'}`,
        background: on ? 'var(--ds-accent-dim)' : 'transparent',
        color: on ? 'var(--ds-accent)' : 'var(--ds-text-2)',
        fontFamily: body, textAlign: 'left',
      }}>
      {icon && <Icon name={icon} size={14} />}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12 }}>{label}</span>
        {hint && (
          <span style={{ display: 'block', fontSize: 10, color: 'var(--ds-text-3)', marginTop: 2, lineHeight: 1.4 }}>
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

export default function SettingsPanel({
  dark, setDark,
  prefs, setPref,
  usage, persisted, formatBytes,
  onDeleteAllData,
}) {
  const [showShortcuts, setShowShortcuts] = useState(false)

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
      <div style={{ display: 'flex', gap: 5, marginBottom: 14 }}>
        {[['Light', false, 'theme-light'], ['Dark', true, 'theme-dark']].map(([lbl, val, ic]) => (
          <button key={lbl} onClick={() => setDark(val)}
            aria-pressed={dark === val}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '8px 0', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: body,
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

      <div style={{ fontSize: 10.5, color: 'var(--ds-text-3)', margin: '10px 0 6px' }}>Grid size</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {GRID_SIZES.map(s => (
          <button key={s} onClick={() => setPref('gridSize', s)}
            aria-pressed={prefs.gridSize === s}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 6, cursor: 'pointer',
              fontFamily: mono, fontSize: 10.5,
              border: `1px solid ${prefs.gridSize === s ? 'var(--ds-accent)' : 'var(--ds-border)'}`,
              background: prefs.gridSize === s ? 'var(--ds-accent-dim)' : 'transparent',
              color: prefs.gridSize === s ? 'var(--ds-accent)' : 'var(--ds-text-2)',
            }}>
            {s}
          </button>
        ))}
      </div>

      {/* ── Keyboard ───────────────────────────────────────────────── */}
      <SectionLabel>Keyboard</SectionLabel>
      {/* Same source as the ? overlay (lib/shortcuts.js), so the two can't
          drift apart. Anything bound elsewhere is invisible in both. */}
      <button onClick={() => setShowShortcuts(s => !s)}
        aria-expanded={showShortcuts}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 9px', marginBottom: showShortcuts ? 8 : 14,
          borderRadius: 8, cursor: 'pointer', fontFamily: body, fontSize: 12,
          border: `1px solid ${showShortcuts ? 'var(--ds-accent)' : 'var(--ds-border)'}`,
          background: showShortcuts ? 'var(--ds-accent-dim)' : 'transparent',
          color: showShortcuts ? 'var(--ds-accent)' : 'var(--ds-text-2)',
        }}>
        <span style={{ flex: 1, textAlign: 'left' }}>Shortcuts</span>
        {showShortcuts
          ? <Icon name="nav-chevron-down" size={11} style={{ opacity: 0.8 }} />
          : <span style={{ fontSize: 10, fontFamily: mono, opacity: 0.8 }}>?</span>}
      </button>

      {showShortcuts && (
        <div style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 14, paddingRight: 2 }}>
          {SHORTCUT_GROUPS.map(({ title, note, rows }) => (
            <div key={title} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 9, fontFamily: mono, letterSpacing: 0.7, textTransform: 'uppercase', color: 'var(--ds-text-3)', marginBottom: note ? 2 : 5 }}>{title}</div>
              {note && <div style={{ fontSize: 10, color: 'var(--ds-text-3)', marginBottom: 5, lineHeight: 1.4 }}>{note}</div>}
              {rows.map(([k, d]) => (
                <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0' }}>
                  <kbd style={{
                    fontFamily: mono, fontSize: 9.5, padding: '2px 5px', borderRadius: 4,
                    border: '1px solid var(--ds-border)', background: 'var(--ds-raised)',
                    color: 'var(--ds-text-2)', flexShrink: 0, whiteSpace: 'nowrap',
                  }}>{k}</kbd>
                  <span style={{ fontSize: 10.5, color: 'var(--ds-text-3)', lineHeight: 1.45 }}>{d}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── Storage ────────────────────────────────────────────────── */}
      <SectionLabel>Storage</SectionLabel>
      <div style={{ fontSize: 11.5, color: 'var(--ds-text-2)', lineHeight: 1.6, marginBottom: 8 }}>
        Everything is stored in this browser. Nothing is uploaded.
      </div>
      {usage && (
        <div style={{ fontSize: 11, color: 'var(--ds-text-2)', display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontFamily: mono }}>
          <span>{formatBytes(usage.usage)} used</span>
          <span style={{ color: 'var(--ds-text-3)' }}>of ~{formatBytes(usage.quota)}</span>
        </div>
      )}
      <div style={{
        display: 'flex', gap: 6, alignItems: 'flex-start',
        fontSize: 11, marginBottom: 10, lineHeight: 1.5,
        color: persisted === false ? 'var(--ds-amber)' : persisted === true ? 'var(--ds-accent)' : 'var(--ds-text-3)',
      }}>
        <Icon name={persisted === false ? 'status-warning' : persisted === true ? 'status-success' : 'status-info'} size={13} style={{ marginTop: 1 }} />
        <span>
          {persisted === true && 'Protected — the browser has agreed not to evict it.'}
          {persisted === false && 'Not protected. The browser may clear this if the disk fills up — export anything important.'}
          {persisted === null && 'Eviction protection is unavailable in this browser.'}
        </span>
      </div>

      <button onClick={onDeleteAllData}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          padding: '8px 0', borderRadius: 8, border: '1px solid var(--ds-border)',
          background: 'transparent', color: 'var(--ds-red)', fontSize: 11.5, fontWeight: 600,
          cursor: 'pointer', fontFamily: body,
        }}>
        <Icon name="action-delete" size={13} />
        Delete all local data
      </button>

      {/* ── Account ────────────────────────────────────────────────── */}
      {/* Declared now and honestly empty, rather than left out and inserted
          later above Storage — which would move Storage the day sync lands. */}
      <div style={{ marginTop: 16 }}>
        <SectionLabel>Account</SectionLabel>
        <div style={{
          display: 'flex', gap: 7, alignItems: 'flex-start',
          padding: '9px 10px', borderRadius: 8,
          border: '1px dashed var(--ds-border)',
          fontSize: 10.5, color: 'var(--ds-text-3)', lineHeight: 1.5,
        }}>
          <Icon name="auth-account" size={13} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>No account yet. This workspace lives in this browser only — sign-in and sync are not built.</span>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--ds-border)', marginTop: 14, paddingTop: 9, fontSize: 10, color: 'var(--ds-text-3)', lineHeight: 1.6, fontFamily: mono }}>
        DataStudio · local-first
      </div>
    </div>
  )
}
