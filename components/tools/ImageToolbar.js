'use client'
import Icon from '../ui/Icon'
import { useState, useRef } from 'react'
import { transformImage, cropImage, processImageFile, putImage, newImageId, IMAGE_EXTS, MAX_IMAGE_BYTES } from '../../lib/images'

/* ImageToolbar
   --------------------------------------------------------------------------
   Contextual rail for image blocks, mirroring SheetToolbar: same surface, same
   position, same control height, so the two read as one family.

   Every tool here rewrites the stored bytes rather than applying a display
   transform. A CSS rotation would be free and reversible, but it would also
   mean the exported file, the thumbnail and the on-screen image disagree —
   and "why is my export sideways" is a bug nobody enjoys. Committing pixels
   keeps one source of truth. The trade is that these operations are lossy and
   not undoable, which is why Crop asks for confirmation.

   Crop is a two-step: arm it, drag a rectangle on the block, apply. The
   overlay itself is rendered by NotebookCanvas because it needs canvas
   coordinates; this component owns the state machine.
   -------------------------------------------------------------------------- */

export default function ImageToolbar({
  block, dark, colors, onUpdateBlock, cropping, onStartCrop, onCancelCrop, pendingCrop,
}) {
  const { surface, border, text2, text3, accent, red } = colors
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [editingAlt, setEditingAlt] = useState(false)
  const [altDraft, setAltDraft] = useState('')
  const replaceRef = useRef(null)

  if (!block) return null

  async function run(label, fn) {
    setBusy(label); setError(null)
    try { await fn() } catch (e) { setError(e.message || 'That did not work.') } finally { setBusy(null) }
  }

  const rotate = deg => run('rotate', async () => {
    const { width, height } = await transformImage(block.imageId, { rotate: deg })
    // `rev` forces ImageBlock to refetch; the id hasn't changed but the bytes have.
    onUpdateBlock(block.id, { rev: (block.rev || 0) + 1, natW: width, natH: height })
  })

  const flip = axis => run('flip', async () => {
    await transformImage(block.imageId, axis === 'h' ? { flipH: true } : { flipV: true })
    onUpdateBlock(block.id, { rev: (block.rev || 0) + 1 })
  })

  const applyCrop = () => run('crop', async () => {
    if (!pendingCrop || !pendingCrop.w || !pendingCrop.h) return
    const { width, height } = await cropImage(block.imageId, pendingCrop)
    // Keep the block's aspect ratio in step with the new image, otherwise a
    // tall crop sits letterboxed inside the old wide box.
    const curW = block.w || 360
    onUpdateBlock(block.id, {
      rev: (block.rev || 0) + 1, natW: width, natH: height,
      h: Math.round((height / width) * curW) + 30,
    })
    onCancelCrop()
  })

  async function onReplace(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    await run('replace', async () => {
      const processed = await processImageFile(file)
      const id = newImageId()
      await putImage(id, {
        blob: processed.blob, width: processed.width, height: processed.height,
        type: processed.type, name: processed.name, addedAt: Date.now(),
      })
      onUpdateBlock(block.id, {
        imageId: id, rev: (block.rev || 0) + 1,
        natW: processed.width, natH: processed.height,
        name: processed.name,
      })
    })
  }

  const btn = {
    width: '100%', height: 30, padding: '0 9px', fontSize: 11.5,
    justifyContent: 'flex-start',
  }

  return (
    <div
      data-island-rail
      data-kbd-zone
      style={{
        position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)',
        zIndex: 96, width: 128,
        display: 'flex', flexDirection: 'column', gap: 3, padding: 8,
        background: `${surface}dd`,
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${border}`, borderRadius: 12,
        boxShadow: `0 4px 24px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.08)'}`,
        fontFamily: 'var(--ds-font-body)',
        animation: 'dsRailIn 0.18s cubic-bezier(.34,1.3,.64,1)',
      }}>
      <style>{`
        @keyframes dsRailIn {
          from { opacity: 0; transform: translateY(-50%) translateX(8px); }
          to   { opacity: 1; transform: translateY(-50%) translateX(0); }
        }
      `}</style>

      <div title={block.name || 'Image'} style={{
        fontSize: 9, fontFamily: 'var(--ds-font-mono)', textTransform: 'uppercase',
        letterSpacing: 0.9, color: text3, padding: '2px 6px 6px',
        borderBottom: `1px solid ${border}`, marginBottom: 3,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {block.name || 'Image'}
      </div>

      {cropping ? (
        <>
          <div style={{ fontSize: 10, color: text3, lineHeight: 1.45, padding: '2px 4px 6px' }}>
            Drag a rectangle on the image.
          </div>
          <button className="ds-tbtn is-on" style={btn}
            disabled={!pendingCrop || busy}
            onClick={applyCrop}>
            <Icon name={busy === 'crop' ? 'status-spinner' : 'action-check'} size={14} />
            {busy === 'crop' ? 'Cropping…' : 'Apply crop'}
          </button>
          <button className="ds-tbtn" style={btn} onClick={onCancelCrop}><Icon name="draw-exit" size={14} />Cancel</button>
        </>
      ) : (
        <>
          <button className="ds-tbtn" style={btn} disabled={!!busy}
            onClick={onStartCrop} title="Drag a rectangle, then apply"><Icon name="img-crop" size={14} />Crop</button>
          <button className="ds-tbtn" style={btn} disabled={!!busy}
            onClick={() => rotate(90)} title="Rotate 90° clockwise"><Icon name="img-rotate" size={14} />Rotate</button>
          <button className="ds-tbtn" style={btn} disabled={!!busy}
            onClick={() => flip('h')} title="Mirror horizontally"><Icon name="img-flip-h" size={14} />Flip H</button>
          <button className="ds-tbtn" style={btn} disabled={!!busy}
            onClick={() => flip('v')} title="Mirror vertically"><Icon name="img-flip-v" size={14} />Flip V</button>

          <div style={{ height: 1, background: border, margin: '3px 0' }} />

          <button className={`ds-tbtn${block.fit === 'cover' ? ' is-on' : ''}`} style={btn}
            onClick={() => onUpdateBlock(block.id, { fit: block.fit === 'cover' ? 'contain' : 'cover' })}
            title="Fit the whole image, or fill the block and crop the overflow">
            <Icon name={block.fit === 'cover' ? 'size-fill' : 'size-fit'} size={14} />
            {block.fit === 'cover' ? 'Fill' : 'Fit'}
          </button>

          <button className={`ds-tbtn${block.alt ? '' : ' is-accent'}`} style={btn}
            onClick={() => { setAltDraft(block.alt || ''); setEditingAlt(true) }}
            title={block.alt ? `Alt text: ${block.alt}` : 'No alt text set — screen readers will skip this image'}>
            <Icon name={block.alt ? 'img-alt-text' : 'img-no-alt'} size={14} />
            Alt text
          </button>

          <button className="ds-tbtn" style={btn} disabled={!!busy}
            onClick={() => replaceRef.current?.click()}
            title={`Swap in a different image (max ${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0)}MB)`}>
            <Icon name={busy === 'replace' ? 'status-spinner' : 'img-replace'} size={14} />
            {busy === 'replace' ? 'Loading…' : 'Replace'}
          </button>
          <input ref={replaceRef} type="file" accept={IMAGE_EXTS.join(',')}
            style={{ display: 'none' }} onChange={onReplace} />
        </>
      )}

      {editingAlt && (
        <div style={{ marginTop: 4 }}>
          <textarea
            autoFocus
            value={altDraft}
            onChange={e => setAltDraft(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Escape') setEditingAlt(false)
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                onUpdateBlock(block.id, { alt: altDraft.trim() }); setEditingAlt(false)
              }
            }}
            placeholder="Describe the image…"
            rows={3}
            style={{
              width: '100%', resize: 'none', padding: '5px 6px', borderRadius: 6,
              border: `1px solid ${accent}`, background: 'var(--ds-base)',
              color: 'var(--ds-text)', fontFamily: 'var(--ds-font-body)',
              fontSize: 11, lineHeight: 1.4, outline: 'none',
            }} />
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            <button className="ds-tbtn" style={{ flex: 1, height: 24, fontSize: 10.5, justifyContent: 'center' }}
              onClick={() => { onUpdateBlock(block.id, { alt: altDraft.trim() }); setEditingAlt(false) }}>
              Save
            </button>
            <button className="ds-tbtn" style={{ flex: 1, height: 24, fontSize: 10.5, justifyContent: 'center' }}
              onClick={() => setEditingAlt(false)}>Cancel</button>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" style={{
          marginTop: 5, padding: '5px 7px', borderRadius: 6,
          background: 'var(--ds-red-bg)', border: `1px solid ${red}`,
          color: red, fontSize: 10, lineHeight: 1.4,
        }}>{error}</div>
      )}
    </div>
  )
}
