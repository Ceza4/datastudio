'use client'
/*
  components/notebook/agent/ui.js
  --------------------------------------------------------------------------
  Small pieces both agent blocks use: the spark mark, buttons, segmented
  controls, the permission control, and a safe text renderer.

  The text renderer never uses innerHTML. Model output is data; it is turned
  into React elements for **bold**, `code`, "- " bullets and paragraphs, and
  everything else is shown as the characters it is.
  -------------------------------------------------------------------------- */
import { useSyncExternalStore } from 'react'
import { subscribe, getVersion } from '../../../lib/agent/session.js'

export const FONT = 'var(--ds-font-body)'
export const MONO = 'var(--ds-font-mono)'

/** Re-render when anything in the agent session changes. */
export function useAgentSession() {
  return useSyncExternalStore(subscribe, getVersion, getVersion)
}

export function Spark({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" style={{ flexShrink: 0, display: 'block' }}>
      <path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="8" cy="8" r="1.9" fill="var(--ds-surface)" stroke={color} strokeWidth="1.4" />
    </svg>
  )
}

export function Btn({ c, kind = 'default', size = 'md', children, style, ...rest }) {
  const h = size === 'sm' ? 26 : 30
  const base = {
    height: h, padding: size === 'sm' ? '0 10px' : '0 12px', borderRadius: 8, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
    fontFamily: FONT, fontSize: size === 'sm' ? 12 : 13, fontWeight: 500, flexShrink: 0,
  }
  const kinds = {
    default: { background: c.surface, color: c.text, border: `1.5px solid ${c.border}` },
    primary: { background: c.text, color: c.base, border: `1.5px solid ${c.text}` },
    ghost: { background: 'transparent', color: c.text2, border: '1.5px solid transparent' },
    danger: { background: c.redBg, color: c.red, border: `1.5px solid ${c.redBg}` },
  }
  return (
    <button type="button" {...rest} style={{ ...base, ...kinds[kind], ...(rest.disabled ? { opacity: 0.45, cursor: 'default' } : null), ...style }}>
      {children}
    </button>
  )
}

export function Seg({ c, value, options, onChange, size = 'md', label, tone = null }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 2, padding: 2, border: `1.5px solid ${c.borderDim}`, borderRadius: 8, background: c.base }}>
      {options.map(([v, text, disabled]) => {
        const on = value === v
        const t = on && tone ? tone(v) : null
        return (
          <button key={v} type="button" role="radio" aria-checked={on} disabled={!!disabled}
            onClick={() => !disabled && onChange(v)}
            style={{
              border: 'none', borderRadius: 6, cursor: disabled ? 'default' : 'pointer',
              padding: size === 'sm' ? '3px 8px' : '5px 11px', fontFamily: FONT, fontSize: 12,
              fontWeight: on ? 600 : 400, opacity: disabled ? 0.4 : 1,
              background: on ? (t?.bg || c.surface) : 'transparent', color: on ? (t?.fg || c.text) : c.text2,
              boxShadow: on && !t ? `0 1px 2px rgba(0,0,0,0.12), inset 0 0 0 1px ${c.borderDim}` : 'none',
            }}>{text}</button>
        )
      })}
    </div>
  )
}

export const permTone = c => v => (
  v === 'allow' ? { bg: c.greenBg, fg: c.green } : v === 'never' ? { bg: c.redBg, fg: c.red } : { bg: c.amberBg, fg: c.amber }
)

export function Label({ c, children, style }) {
  return <div style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: c.text3, ...style }}>{children}</div>
}

export function Note({ c, children, icon = null, tone = 'plain' }) {
  const bg = tone === 'warn' ? c.amberBg : tone === 'error' ? c.redBg : c.raised
  const fg = tone === 'warn' ? c.amber : tone === 'error' ? c.red : c.text2
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 8, background: bg, color: fg, fontFamily: FONT, fontSize: 12, lineHeight: 1.45 }}>
      {icon}<span style={{ minWidth: 0 }}>{children}</span>
    </div>
  )
}

export function Spinner({ c, size = 12 }) {
  return <span aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', border: `1.5px solid ${c.border}`, borderTopColor: c.accent, animation: 'spin 0.7s linear infinite', display: 'inline-block', flexShrink: 0 }} />
}

export function Pill({ c, tone = 'plain', children }) {
  const t = tone === 'run' ? { bg: c.accentDim, fg: c.accentText } : tone === 'ok' ? { bg: c.greenBg, fg: c.green } : tone === 'ask' ? { bg: c.amberBg, fg: c.amber } : tone === 'bad' ? { bg: c.redBg, fg: c.red } : { bg: c.raised, fg: c.text2 }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 6, background: t.bg, color: t.fg, fontFamily: FONT, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
      {tone === 'run' && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', animation: 'dsPresencePulse 1.2s ease-in-out infinite' }} />}
      {children}
    </span>
  )
}

/* ── safe rich text ──────────────────────────────────────────────────────── */

function inline(text, c, keyBase) {
  const out = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0, m, i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('**')) out.push(<strong key={`${keyBase}-${i++}`} style={{ fontWeight: 600 }}>{t.slice(2, -2)}</strong>)
    else out.push(<code key={`${keyBase}-${i++}`} style={{ fontFamily: MONO, fontSize: 12, background: c.raised, padding: '1px 4px', borderRadius: 4 }}>{t.slice(1, -1)}</code>)
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function RichText({ c, text, streaming = false }) {
  const blocks = String(text || '').split(/\n{2,}/)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: FONT, fontSize: 14, lineHeight: 1.55, color: c.text, overflowWrap: 'anywhere' }}>
      {blocks.map((b, bi) => {
        const lines = b.split('\n')
        const isList = lines.length > 0 && lines.every(l => /^\s*([-*•]|\d+\.)\s+/.test(l) || !l.trim())
        const last = bi === blocks.length - 1
        if (isList) {
          return (
            <ul key={bi} style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {lines.filter(l => l.trim()).map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ''), c, `${bi}-${li}`)}</li>)}
            </ul>
          )
        }
        return (
          <p key={bi} style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {inline(b, c, String(bi))}
            {streaming && last && <span aria-hidden="true" style={{ display: 'inline-block', width: 7, height: 14, marginLeft: 2, verticalAlign: -2, background: c.accent, animation: 'dsPresencePulse 0.9s ease-in-out infinite' }} />}
          </p>
        )
      })}
    </div>
  )
}

export const stop = e => e.stopPropagation()
