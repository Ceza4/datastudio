/*
  lib/shortcuts.js
  --------------------------------------------------------------------------
  Single source of truth for the keymap.

  Rendered in two places — the ? overlay on the canvas and the Settings menu —
  so it lives here rather than being typed out twice and drifting.

  DESIGN: one mode key, then everything is arrows and Enter.

  Press M and the app enters keyboard mode: the nearest block is selected and
  the camera centres on it. From there arrows move between blocks (the camera
  follows), Enter edits, Esc backs out. Tab jumps to the toolbar.

  Toolbar traversal was originally on hold-Shift, which was a mistake with an
  obvious symptom: Shift is a PREFIX, not a mode. Pressing Shift+F to fit a
  block fired the Shift keydown first, jumped to the toolbar, and the F never
  arrived — every Shift+<key> binding was dead. Tab is a discrete press, it
  already means "next control" everywhere else, and it leaves Shift free.

  The point is that no shortcut needs a modifier. Modifiers are where
  collisions live — Alt+arrows is browser Back/Forward on Windows and Linux,
  Alt alone opens the menu bar there, Option is the dead-key modifier on
  macOS, and Ctrl+arrows switches Spaces. Plain keys inside an explicit mode
  avoid all of it.
  -------------------------------------------------------------------------- */

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
export const MOD = IS_MAC ? '⌘' : 'Ctrl'

export const SHORTCUT_GROUPS = [
  {
    title: 'Keyboard mode',
    note: 'Everything below works without a mouse.',
    rows: [
      ['M', 'Enter keyboard mode — selects the nearest block and centres on it'],
      ['Arrows', 'Move to the block in that direction · the view follows'],
      ['Enter', 'Edit the selected block'],
      ['Esc', 'Step back out · again to leave keyboard mode'],
      ['Tab', 'Jump to the toolbar'],
    ],
  },
  {
    title: 'On the toolbar',
    rows: [
      ['Tab  or  ← →', 'Move between buttons — includes the side rails'],
      ['Enter', 'Use it, and return to your block'],
      ['Esc', 'Back to your block without doing anything'],
    ],
  },
  {
    title: 'Creating',
    rows: [
      ['N', 'Text block'],
      ['T', 'Table'],
      ['K', 'Kanban board'],
      ['S', 'Section'],
      ['I', 'Insert an image'],
    ],
  },
  {
    title: 'The selected block',
    rows: [
      ['G', 'Grab it — then arrows to move, Enter to place, Esc to cancel'],
      [`${MOD}+D`, 'Duplicate'],
      ['Delete', 'Delete'],
      ['Shift+F', 'Fit to screen'],
      ['Shift+R', 'Reset size'],
    ],
  },
  {
    title: 'Inside a sheet',
    rows: [
      ['Arrows / Tab / Enter', 'Move between cells'],
      [`${MOD}+arrows`, 'Jump to the edge of the data'],
      [`${MOD}+Z  /  ${MOD}+Y`, 'Undo / redo'],
      [`${MOD}+D`, 'Fill down'],
      [`${MOD}+C / X / V`, 'Copy, cut, paste as TSV'],
      ['Esc', 'Cancel the edit · again to collapse the selection · again to leave the sheet'],
    ],
  },
  {
    title: 'Anywhere',
    rows: [
      ['?', 'Show this list'],
      ['Right-drag', 'Pan the canvas'],
      ['Hold Alt while dragging', 'Suspend magnetic snapping'],
    ],
  },
]

/* Known conflicts, checked and deliberately avoided. Kept here so the next
   person to add a binding doesn't reintroduce one. */
export const RESERVED_COMBOS = [
  ['Alt + ← / →', 'Browser Back / Forward on Windows and Linux'],
  ['Alt (alone)', 'Activates the browser menu bar on Windows — even after preventDefault'],
  ['Alt + letter', 'Dead-key modifier on macOS (Option+n = ñ)'],
  ['Ctrl + ← / →', 'Switches Spaces on macOS, at OS level — cannot be prevented'],
  ['Cmd/Ctrl + W / T / N', 'Close tab, new tab, new window'],
]
