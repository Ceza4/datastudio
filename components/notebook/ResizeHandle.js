'use client'

/* Drag handle in the bottom-right corner of resizable blocks. */
export default function ResizeHandle({ onResizeStart, border }) {
  return (
    <div
      onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onResizeStart(e) }}
      style={{
        position: 'absolute',
        right: -4,
        bottom: -4,
        width: 14,
        height: 14,
        cursor: 'nwse-resize',
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRight: `2px solid ${border}`,
          borderBottom: `2px solid ${border}`,
          opacity: 0.5,
        }}
      />
    </div>
  )
}
