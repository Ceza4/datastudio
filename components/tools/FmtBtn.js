'use client'

/* Small toggle-style button used inside FormatBar.
   Pulled into its own file so the format bar's controls are easy to swap
   or upgrade without scrolling through helper definitions. */
export default function FmtBtn({ active, onClick, title, children, colors }) {
  const { accent, accentDim, border, text2 } = colors
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: '3px 9px',
        borderRadius: 5,
        border: `1px solid ${active ? accent : border}`,
        background: active ? accentDim : 'transparent',
        color: active ? accent : text2,
        fontFamily: "'DM Sans',sans-serif",
        fontSize: 12,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      {children}
    </button>
  )
}
