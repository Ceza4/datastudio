'use client'
import { useState, useEffect, memo } from 'react'
import Icon from '../ui/Icon'
import { getFile, downloadFile, fileIcon, fileKind, formatSize } from '../../lib/files'

/*
  components/notebook/FileBlock.js
  --------------------------------------------------------------------------
  An attachment chip: icon, name, size, download.

  IT SAYS "DOWNLOAD", NOT "OPEN", AND THAT IS THE HONEST WORD.
  The thing this feature is modelled on — dropping a file into a OneNote page
  and clicking it to open it in the right application — is not available to a
  web page. A browser can download a file or preview a format it already
  understands. It cannot hand one to the operating system. Labelling the
  button "Open" would be a nicer word for the same download and a small lie
  every single time it is pressed.

  THE BYTES ARE READ ON MOUNT, NOT HELD IN THE BLOCK.
  The block carries a fileId; the blob lives in IndexedDB. So this component
  is one of the few in the canvas that does async work to render, and it has
  the three states that implies — loading, present, missing — rather than
  assuming the happy one. A chip whose bytes are gone says so; it does not
  render a Download button that will do nothing.
  -------------------------------------------------------------------------- */


/* memo, because this component is a child of NotebookCanvas and NotebookCanvas
   re-renders on every frame of a pan or a zoom. Without it, dragging the canvas
   re-rendered every block on screen sixty times a second; with it, React bails
   out at this boundary and the frame costs nothing but the transform.

   A plain shallow compare is enough because every prop it receives is stable by
   construction: `colors` is one of two frozen module objects (lib/theme.js),
   handlers are cached per block id by blockCb() in NotebookCanvas, and `block`
   only changes identity when the block actually changes. */
function FileBlockInner({ block, colors, dark, onUpdateBlock }) {
  const { surface, raised, border, text, text2, text3, accent, red } = colors
  const [record, setRecord] = useState(undefined)   // undefined = not looked yet
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    if (!block.fileId) { setRecord(null); return }
    getFile(block.fileId).then(r => { if (live) setRecord(r || null) })
    /* The cleanup is not ceremony. Deleting a block while its read is in
       flight resolves this promise against an unmounted component, and
       setState on an unmounted component is how a canvas full of attachments
       fills the console with warnings nobody then reads. */
    return () => { live = false }
  }, [block.fileId])

  const name = record?.name || block.name || 'File'
  const size = record?.size ?? block.size ?? 0
  const missing = record === null
  const loading = record === undefined

  async function download() {
    if (!record || busy) return
    setBusy(true)
    try { downloadFile(record) } finally { setBusy(false) }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      width: '100%', padding: '12px 14px',
      fontFamily: 'var(--ds-font-body)',
    }}>
      <div style={{
        width: 34, height: 34, flexShrink: 0, borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: missing ? `${red}1f` : raised,
        border: `1px solid ${missing ? red : border}`,
        color: missing ? red : text2,
      }}>
        <Icon name={missing ? 'action-delete' : fileIcon(name)} size={16} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Names are long and the middle of a filename is the least useful
            part of it, but truncating the END hides the extension — which is
            the one part that says what the thing IS. Ellipsis at the end plus
            the kind shown separately below keeps both. */}
        <div style={{
          fontSize: 13, fontWeight: 600, color: missing ? red : text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={name}>{name}</div>
        <div style={{ fontSize: 11, color: text3, marginTop: 1 }}>
          {loading ? 'Reading…'
            : missing ? 'Missing — the stored copy is gone'
              : `${fileKind(name)} · ${formatSize(size)}`}
        </div>
      </div>

      <button
        onClick={e => { e.stopPropagation(); download() }}
        onMouseDown={e => e.stopPropagation()}
        disabled={loading || missing || busy}
        title={missing ? 'The stored copy of this file is gone' : `Download ${name}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
          padding: '6px 12px', borderRadius: 8,
          border: `1px solid ${border}`, background: surface,
          color: loading || missing ? text3 : text2,
          cursor: loading || missing ? 'default' : 'pointer',
          fontFamily: 'var(--ds-font-body)', fontSize: 12,
          opacity: loading || missing ? 0.5 : 1,
        }}
        onMouseEnter={e => { if (!loading && !missing) { e.currentTarget.style.color = accent; e.currentTarget.style.borderColor = accent } }}
        onMouseLeave={e => { e.currentTarget.style.color = loading || missing ? text3 : text2; e.currentTarget.style.borderColor = border }}>
        <Icon name="action-export" size={12} />
        Download
      </button>
    </div>
  )
}

export default memo(FileBlockInner)
