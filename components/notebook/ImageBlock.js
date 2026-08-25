'use client'
import { useState, useEffect, useRef, memo } from 'react'
import { imageUrl, releaseImageUrl } from '../../lib/images'

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

  useEffect(() => {
    let cancelled = false
    const id = block.imageId
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
        <span style={{ color: red, fontSize: 12, fontWeight: 600 }}>Image data not found</span>
        <span style={{ color: text2, fontSize: 11, lineHeight: 1.5 }}>
          The file is missing from local storage. It may have been cleared by the
          browser, or the notebook was opened on another device.
        </span>
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
            fontSize: 8.5, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.5,
            color: text2, background: `${raised}dd`, border: `1px solid ${border}`,
            borderRadius: 4, padding: '2px 5px', pointerEvents: 'auto',
          }}>
          NO ALT
        </span>
      )}
    </div>
  )
}

export default memo(ImageBlockInner)
