/*
  lib/pressable.js
  --------------------------------------------------------------------------
  Keyboard parity for something that is clicked but is not a <button>
  (audit DEF-038). Spread it onto the element:

      <span {...pressable(() => toggle(id))} aria-expanded={open}>…</span>

  Role "button", a tab stop, and Enter / Space doing what the click does. Put
  it on the NAME inside a row that also holds buttons — never on the row, or
  the row's own buttons become controls nested inside a control.
  -------------------------------------------------------------------------- */
export function pressable(onActivate) {
  return {
    role: 'button',
    tabIndex: 0,
    onKeyDown: e => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      if (e.target !== e.currentTarget) return   // a key inside a child is the child's
      e.preventDefault()
      e.stopPropagation()
      onActivate(e)
    },
  }
}
