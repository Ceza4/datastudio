'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../ui/Icon'
import { safeLinkUrl } from '../../lib/urls'

/* TextBlockToolbar — docked formatting rail.
   --------------------------------------------------------------------------
   v3. v2 was a 176px island with text-labelled buttons on flex-wrap, so the
   rows reflowed into ragged, uneven columns and nothing lined up with anything
   — that's what made it look untidy rather than any single control.

   Now a fixed 4-column grid of 34px squares. Every control occupies exactly
   one cell, so the rail has a real vertical rhythm and the button positions
   never move between sessions (which is what makes a toolbar learnable).

   WHY B / I / U / S ARE STILL LETTERFORMS
   Not an oversight, and not a gap in the icon set. Bold-as-a-bold-B is the
   near-universal convention — Word, Docs, Pages, Notion, every rich-text
   surface a researcher has already used. A glyph for "bold" would be a novel
   symbol competing with thirty years of muscle memory, and it would lose.

   Font, Colour and Link stay labelled for a different reason: each opens a
   submenu rather than applying a format, and a bare icon doesn't signal
   "this asks you a question next".

   LINK IS A SUBMENU NOW, NOT A window.prompt
   Asking for a URL used to open a browser dialog, and two more explained that
   nothing had been selected or that the scheme was refused. Three modal boxes
   thrown up by a rail that is already an island floating a few pixels from the
   text — each one blocked the tab, threw away the visual selection, and looked
   like a different piece of software. They are all inline now, following the
   same `menu` pattern as Font and Colour.

   THE SELECTION HAS TO BE CARRIED BY HAND
   window.prompt got one thing for free: focus never left the text, so
   execCommand still had a selection to act on. An inline input takes focus,
   which drops it. So opening the link menu clones the Range, and committing
   re-focuses the editable and puts the Range back before calling createLink.
   Without that the link silently applies to nothing.
   -------------------------------------------------------------------------- */

const FONTS = [
  'Inter', 'DM Sans', 'Times New Roman', 'Georgia', 'Helvetica',
  'Arial', 'Courier New', 'Verdana',
]

const COLORS = [
  '#1A1917', '#5B5FE8', '#4ade80', '#E8B85B',
  '#f87171', '#a78bfa', '#38bdf8', '#ffffff',
]

/* One cell of the grid. `wide` spans two columns for the submenu openers.

   Module scope, NOT declared inside TextBlockToolbar. A component created
   during render is a brand-new type every render, so React tears down all
   seventeen buttons and their icon subtrees and builds them again rather than
   updating them. The rail is open whenever exactly one block is selected — and
   a block being dragged is selected — so that was happening on every frame of
   every drag. The symptom was visible, not just theoretical: the hover
   highlight below is written imperatively onto the node, and a remount drops
   it off the button the cursor is still sitting on. */
function Cell({ run, title, children, wide, mono, raised, text, text2 }) {
  return (
    <button
      onMouseDown={e => { e.preventDefault(); run(e) }}
      title={title}
      aria-label={title}
      style={{
        gridColumn: wide ? 'span 2' : undefined,
        height: 32,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: 7,
        color: text2,
        cursor: 'pointer',
        padding: 0,
        fontFamily: mono ? 'var(--ds-font-mono)' : 'var(--ds-font-body)',
        fontSize: wide ? 11 : 14,
        lineHeight: 1,
        transition: 'background .12s, color .12s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = text }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = text2 }}
    >
      {children}
    </button>
  )
}

export default function TextBlockToolbar({ colors, onClose }) {
  const { surface, raised, border, text, text2, text3, accent, accentDim } = colors
  const ref = useRef(null)
  const [menu, setMenu] = useState(null)   // null | 'font' | 'color' | 'link'
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState(null)
  /* Shown in the rail when Link is pressed with nothing selected. A hint, not
     an error: nothing has gone wrong, there is just a step missing. */
  const [hint, setHint] = useState(null)
  /* The text selection as it was when the link menu opened, because focusing
     the input below destroys it. */
  const savedRange = useRef(null)

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    function handleKeyDown(e) {
      if (e.key !== 'Escape') return
      // Esc closes the open submenu first, the rail second. Collapsing both at
      // once means one stray Esc while picking a colour loses the whole rail.
      if (menu) { setMenu(null); e.stopPropagation(); return }
      onClose()
    }
    const t = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }, 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, menu])

  function exec(cmd, value = null) {
    document.execCommand(cmd, false, value)
  }

  /* Opened through Cell, which acts on mousedown and calls preventDefault
     first. That is the rail's convention and the reason the other seventeen
     buttons work at all: execCommand acts on the document's selection, so
     focus has to stay in the text instead of moving to the button pressed.

     Link is the one control that then deliberately takes focus away, to the
     input below — which is exactly why the Range is cloned here and restored
     in commitLink. Deleting that restore makes the link apply to nothing at
     all, silently; tests/browser/run.mjs fails on it. */
  function openLinkMenu() {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setHint('Select some text first, then press Link.')
      return
    }
    savedRange.current = sel.getRangeAt(0).cloneRange()
    setLinkUrl('https://')
    setLinkError(null)
    setMenu('link')
  }

  function commitLink() {
    /* createLink took the prompt string verbatim, so `javascript:…` typed here
       became a live href that executes on ctrl-click — and, worse, persists
       into block content, so a shared template could carry one behind
       plausible link text. Allow the three schemes a document link can
       legitimately use and refuse the rest. A bare `example.com` is treated as
       https rather than rejected, because that is what people type. */
    const safe = safeLinkUrl(linkUrl)
    if (!safe) {
      setLinkError('Only http, https and mailto links can be added.')
      return
    }
    /* execCommand acts on the DOCUMENT's selection, and the input above owns
       it right now. Focus the editable FIRST and then restore the Range —
       a range restored into an unfocused element is not a selection
       execCommand will touch, and the link would apply to nothing at all. */
    const r = savedRange.current
    if (r) {
      const node = r.commonAncestorContainer
      const el = node?.nodeType === 1 ? node : node?.parentElement
      el?.closest?.('[data-ds-text]')?.focus?.()
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(r)
    }
    exec('createLink', safe)
    setMenu(null)
    setLinkError(null)
    setTimeout(() => {
      /* rel matters as much as target. `target="_blank"` alone hands the
         destination page a live `window.opener` pointing back at DataStudio,
         which is enough to redirect this tab to a lookalike while the user is
         reading the page they just opened. */
      document.querySelectorAll('[data-ds-text] a:not([target])').forEach(a => {
        a.setAttribute('target', '_blank')
        a.setAttribute('rel', 'noopener noreferrer')
      })
    }, 0)
  }

  /* The three tokens Cell used to close over, now handed to it explicitly.
     Spread at each call site so hoisting Cell out cost one token per button
     rather than three. */
  const cellColors = { raised, text, text2 }

  const groupLabel = {
    fontSize: 8.5, fontFamily: 'var(--ds-font-mono)', textTransform: 'uppercase',
    letterSpacing: 0.9, color: text3, padding: '4px 2px 2px',
  }
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3 }

  const toolbar = (
    <div
      ref={ref}
      onMouseDown={e => e.stopPropagation()}
      /* Capture, so it runs BEFORE the button that is about to set it. Any
         press anywhere in the rail clears the hint — by then you have either
         acted on it or moved on, and advice that outstays the moment it was
         given reads as an error nobody can dismiss. */
      onMouseDownCapture={() => setHint(null)}
      onClick={e => e.stopPropagation()}
      data-island-rail
      data-kbd-zone
      /* Docked on the right, matching the sheet and image rails, rather than
         popping up at the cursor: it never covers the text being formatted, it
         lands in the same place every time, and it stays reachable through the
         same Tab-to-toolbar path as every other rail. */
      style={{
        position: 'fixed', right: 16, top: '50%', transform: 'translateY(-50%)',
        zIndex: 99999, width: 168,
        background: `${surface}f2`,
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${border}`, borderRadius: 12,
        boxShadow: '0 6px 30px rgba(0,0,0,0.28)', padding: 8,
        fontFamily: 'var(--ds-font-body)',
        display: 'flex', flexDirection: 'column',
        animation: 'dsRailIn 0.18s cubic-bezier(.34,1.3,.64,1)',
      }}
    >
      <style>{`
        @keyframes dsRailIn {
          from { opacity: 0; transform: translateY(-50%) translateX(8px); }
          to   { opacity: 1; transform: translateY(-50%) translateX(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-island-rail] { animation: none !important; }
        }
      `}</style>

      <div style={{
        fontSize: 9, fontFamily: 'var(--ds-font-mono)', textTransform: 'uppercase',
        letterSpacing: 0.9, color: text3, padding: '0 2px 7px',
        borderBottom: `1px solid ${border}`, marginBottom: 2,
      }}>
        Format
      </div>

      <div style={groupLabel}>Style</div>
      <div style={grid}>
        <Cell {...cellColors} run={() => exec('bold')}          title="Bold"><b style={{ fontSize: 14 }}>B</b></Cell>
        <Cell {...cellColors} run={() => exec('italic')}        title="Italic"><i style={{ fontSize: 14, fontFamily: 'Georgia, serif' }}>I</i></Cell>
        <Cell {...cellColors} run={() => exec('underline')}     title="Underline"><u style={{ fontSize: 14 }}>U</u></Cell>
        <Cell {...cellColors} run={() => exec('strikeThrough')} title="Strikethrough"><s style={{ fontSize: 14 }}>S</s></Cell>
      </div>

      <div style={groupLabel}>Heading</div>
      <div style={grid}>
        <Cell {...cellColors} run={() => exec('formatBlock', 'h1')}  title="Heading 1"><Icon name="text-h1" size={17} /></Cell>
        <Cell {...cellColors} run={() => exec('formatBlock', 'h2')}  title="Heading 2"><Icon name="text-h2" size={17} /></Cell>
        <Cell {...cellColors} run={() => exec('formatBlock', 'h3')}  title="Heading 3"><Icon name="text-h3" size={17} /></Cell>
        <Cell {...cellColors} run={() => exec('formatBlock', 'div')} title="Normal paragraph"><Icon name="block-text" size={16} /></Cell>
      </div>

      <div style={groupLabel}>Lists</div>
      <div style={grid}>
        <Cell {...cellColors} run={() => exec('insertUnorderedList')} title="Bullet list"><Icon name="text-bullet-list" size={16} /></Cell>
        <Cell {...cellColors} run={() => exec('insertOrderedList')}   title="Numbered list"><Icon name="text-numbered-list" size={16} /></Cell>
        <Cell {...cellColors} title="Checklist" run={() => exec('insertHTML',
          '<div data-type="checklist" style="display:flex;align-items:flex-start;gap:8px;padding:3px 0;"><input type="checkbox" style="margin-top:5px;cursor:pointer;accent-color:#5B5FE8;width:15px;height:15px;flex-shrink:0;"><span></span></div>'
        )}><Icon name="text-checklist" size={16} /></Cell>
        <Cell {...cellColors} run={() => exec('formatBlock', 'blockquote')} title="Quote"><Icon name="text-quote" size={16} /></Cell>
      </div>

      <div style={groupLabel}>Insert</div>
      <div style={{ ...grid, position: 'relative' }}>
        <Cell {...cellColors} run={() => exec('insertHorizontalRule')} title="Divider"><Icon name="text-divider" size={16} /></Cell>
        <Cell {...cellColors} title="Code" run={() => exec('insertHTML',
          '<code style="font-family:var(--ds-font-mono);font-size:0.92em;background:rgba(127,127,127,0.14);padding:1px 5px;border-radius:4px;">code</code>&nbsp;'
        )}><Icon name="text-code" size={16} /></Cell>
        <Cell {...cellColors} run={openLinkMenu} title="Insert hyperlink" wide>Link</Cell>

        {/* Opens to the LEFT rather than upward like Font and Colour: the rail
            is docked at the right edge of the window, so there is room out
            there, and an upward panel would cover the Style and Heading rows
            the person is about to use next. */}
        {menu === 'link' && (
          <div style={{
            position: 'absolute', right: '100%', top: 0, marginRight: 8, width: 236,
            background: surface, border: `1px solid ${border}`, borderRadius: 8,
            padding: 8, boxShadow: 'var(--ds-shadow-md)', zIndex: 10,
          }}>
            <input
              autoFocus
              value={linkUrl}
              aria-label="Link address"
              placeholder="https://example.com"
              onChange={e => { setLinkUrl(e.target.value); setLinkError(null) }}
              /* Both keys are handled here and stopped here. React attaches at
                 the root container, so letting them bubble would hand Escape to
                 the rail's own document listener and Enter to the canvas
                 keymap — a newline in the block, or the rail closing under the
                 URL being typed into it. */
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitLink() }
                else if (e.key === 'Escape') { e.stopPropagation(); setMenu(null); setLinkError(null) }
              }}
              style={{
                width: '100%', background: 'transparent', border: 'none',
                borderBottom: `1px solid ${accent}`, color: text,
                fontFamily: 'var(--ds-font-body)', fontSize: 12,
                outline: 'none', padding: '3px 0', minWidth: 0,
              }}
            />
            {linkError ? (
              <div role="alert" style={{ marginTop: 6, fontSize: 10, lineHeight: 1.45, color: 'var(--ds-red)' }}>
                {linkError}
              </div>
            ) : (
              <div style={{ marginTop: 6, fontSize: 10, color: text3 }}>Enter to add · Esc to cancel</div>
            )}
          </div>
        )}
      </div>

      {hint && (
        <div role="status" style={{
          marginTop: 5, padding: '4px 6px', borderRadius: 6,
          fontSize: 10, lineHeight: 1.45, color: 'var(--ds-amber)',
        }}>{hint}</div>
      )}

      <div style={{ borderTop: `1px solid ${border}`, marginTop: 7, paddingTop: 5, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3, position: 'relative' }}>
        <Cell {...cellColors} run={() => setMenu(m => m === 'font' ? null : 'font')} title="Font family" wide>
          Font <Icon name="nav-chevron-down" size={10} />
        </Cell>
        <Cell {...cellColors} run={() => setMenu(m => m === 'color' ? null : 'color')} title="Text colour" wide>
          Colour <Icon name="nav-chevron-down" size={10} />
        </Cell>

        {menu === 'font' && (
          <div style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 6, background: surface, border: `1px solid ${border}`, borderRadius: 8, padding: 4, minWidth: 172, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', zIndex: 10 }}>
            {FONTS.map(font => (
              <button key={font} onMouseDown={e => { e.preventDefault(); exec('fontName', font); setMenu(null) }}
                style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderRadius: 6, color: text2, cursor: 'pointer', fontFamily: `'${font}', sans-serif`, fontSize: 13, padding: '7px 10px' }}
                onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = text }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = text2 }}>
                {font}
              </button>
            ))}
          </div>
        )}

        {menu === 'color' && (
          <div style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 6, background: surface, border: `1px solid ${border}`, borderRadius: 8, padding: 8, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', zIndex: 10 }}>
            {COLORS.map(c => (
              <button key={c} onMouseDown={e => { e.preventDefault(); exec('foreColor', c); setMenu(null) }} title={c} aria-label={`Text colour ${c}`}
                style={{ width: 24, height: 24, borderRadius: 5, background: c, border: `1.5px solid ${border}`, cursor: 'pointer', padding: 0, flexShrink: 0 }} />
            ))}
          </div>
        )}
      </div>

      <button onMouseDown={e => { e.preventDefault(); onClose() }}
        style={{ marginTop: 6, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, background: 'transparent', border: `1px solid ${border}`, borderRadius: 7, color: text3, cursor: 'pointer', fontFamily: 'var(--ds-font-body)', fontSize: 10.5 }}
        onMouseEnter={e => { e.currentTarget.style.color = text2 }}
        onMouseLeave={e => { e.currentTarget.style.color = text3 }}>
        <Icon name="draw-exit" size={11} /> Close · Esc
      </button>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(toolbar, document.body)
}
