'use client'
import { useState, useEffect, useRef, memo } from 'react'
import { imageUrl, releaseImageUrl } from '../../lib/images'
import Icon from '../ui/Icon'
import { displayModeOf } from './blockRegistry'

/* ImageBlock
   --------------------------------------------------------------------------
   Renders an image whose bytes live in IndexedDB, not in notebook state. The
   block carries only `imageId`, so autosave never rewrites pixels and loading
   a workspace doesn't deserialise megabytes to draw a text block.

   The URL is fetched asynchronously and cached per id by lib/images. The
   cache is what makes this safe to re-render freely — without it, every
   render would mint an object URL and leak it.

   `alt` is stored on the block and surfaced in the tools rail. It's not
   decoration: an image with no text alternative is invisible to a screen
   reader and unsearchable, and a research notebook full of unlabelled charts
   is a notebook you can't navigate.
   -------------------------------------------------------------------------- */


/* memo, because this component is a child of NotebookCanvas and NotebookCanvas
   re-renders on every frame of a pan or a zoom. Without it, dragging the canvas
   re-rendered every block on screen sixty times a second; with it, React bails
   out at this boundary and the frame costs nothing but the transform.

   A plain shallow compare is enough because every prop it receives is stable by
   construction: `colors` is one of two frozen module objects (lib/theme.js),
   handlers are cached per block id by blockCb() in NotebookCanvas, and `block`
   only changes identity when the block actually changes. */
function ImageBlockInner({ block, colors, maxHeight, onUpdateBlock }) {
  const { text2, text3, border, raised, red } = colors
  const [url, setUrl] = useState(null)
  const [state, setState] = useState('loading')   // loading | ready | missing
  const lastId = useRef(null)

  /* 'full' | 'compact' | 'icon'. Resolved through the registry so an absent or
     corrupted value can never render as nothing — see displayModeOf. */
  const mode = displayModeOf(block)

  useEffect(() => {
    let cancelled = false
    const id = block.imageId
    /* NOT skipped in icon mode, deliberately, even though no pixels are shown.

        An icon-mode image is still a real image block: the alt-text warning
        below, and the "the bytes are gone" state, are both things you need to
        know about a collapsed image as much as an expanded one. Silently not
        checking would mean collapsing an image hides the fact that it is
        broken, and the user finds out only when they expand it again.

        The URL is cached per id by lib/images, so this costs one map lookup on
        a re-render, not a fetch. */
    if (!id) { setState('missing'); return }

    // Release the previous image's URL when the block points somewhere new
    // (Replace), otherwise the old blob stays pinned for the session.
    if (lastId.current && lastId.current !== id) releaseImageUrl(lastId.current)
    lastId.current = id

    setState('loading')
    imageUrl(id)
      .then(u => {
        if (cancelled) return
        if (u) { setUrl(u); setState('ready') } else setState('missing')
      })
      .catch(() => { if (!cancelled) setState('missing') })

    return () => { cancelled = true }
  }, [block.imageId, block.rev])   // `rev` bumps after crop/rotate to force a refetch

  /* COMPACT NEEDS NO SPECIAL CASE HERE. It is the same <img> with real pixels
     in a smaller box, and the box comes from `maxHeight`, which the canvas
     derives from blockFootprint(). Compact is a size, icon is a different
     rendering — which is the whole reason they are separate values rather than
     two points on one density slider. */
  const boxStyle = {
    height: maxHeight,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', background: raised, position: 'relative',
  }

  if (state === 'loading') {
    return (
      <div style={boxStyle}>
        <div className="ds-spinner" aria-label="Loading image" />
      </div>
    )
  }

  if (state === 'missing') {
    return (
      <div style={{ ...boxStyle, flexDirection: 'column', gap: 6, padding: 16, textAlign: 'center' }}>
        <span style={{ color: red, fontSize: 13, fontWeight: 600 }}>Image data not found</span>
        <span style={{ color: text2, fontSize: 12, lineHeight: 1.5 }}>
          The file is missing from local storage. It may have been cleared by the
          browser, or the notebook was opened on another device.
        </span>
      </div>
    )
  }

  /* ── ICON MODE ──────────────────────────────────────────────────────────
     A GENERIC ICON, not a shrunk thumbnail. That is a real, deliberate reversal
     of the "always show real pixels" principle Compact mode protects — and it is
     fine here precisely because it is not Compact: Compact is a bulk, ambient
     density setting applied to a whole section, and this is a specific choice
     made about ONE image on purpose. You are not losing "the workspace stays
     open"; you are choosing to close one particular thing.

     Styled as the same chip .docx and .zip already render as (FileBlock's row),
     so a section mixing icon-mode images with real file blocks reads as one list
     rather than two conventions side by side. */
  if (mode === 'icon') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        height: 40, padding: '0 10px',
        background: raised, overflow: 'hidden',
      }}>
        <Icon name="format-image" size={16} style={{ color: text2, flexShrink: 0 }} />
        <span
          title={block.alt || block.name || 'Image'}
          style={{
            flex: 1, minWidth: 0, fontSize: 12, color: text2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
          {block.name || block.alt || 'Image'}
        </span>
        {/* Says WHY there are no pixels. Without this, a collapsed image and a
            failed one look identical, which is the worst possible ambiguity for
            a block whose content cannot be retyped from memory. */}
        <span style={{
          fontSize: 11, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.5,
          color: text3, border: `1px solid ${border}`, borderRadius: 4,
          padding: '2px 6px', flexShrink: 0,
        }}>ICON</span>
      </div>
    )
  }

  return (
    <div style={boxStyle}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={block.alt || ''}
        draggable={false}
        style={{
          maxWidth: '100%', maxHeight: '100%',
          objectFit: block.fit || 'contain',
          display: 'block', userSelect: 'none',
        }}
      />
      {!block.alt && (
        <span
          title="No alt text — add one in the Image tools so this is readable by screen readers and searchable"
          style={{
            position: 'absolute', bottom: 6, right: 6,
            fontSize: 11, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.5,
            color: text2, background: `${raised}dd`, border: `1px solid ${border}`,
            borderRadius: 4, padding: '2px 6px', pointerEvents: 'auto',
          }}>
          NO ALT
        </span>
      )}
    </div>
  )
}

export default memo(ImageBlockInner)
