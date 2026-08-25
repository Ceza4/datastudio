'use client'
import Icon from '../ui/Icon'
import {
  PRIORITIES, PRIORITY_LABEL, PRIORITY_COLOR, DEADLINE_COLOR,
  STATUS_LABEL, deadlineState, effectiveStatus, toDateInput,
} from '../../lib/tasks'
import { Z } from '../../lib/theme'

/*
  components/tools/TaskToolbar.js
  --------------------------------------------------------------------------
  Contextual rail for a selected task. Same slot and surface as the sheet, PDF
  and image rails.

  WHAT'S HERE AND WHAT ISN'T
  Priority, deadline and status — the three things that change often enough to
  deserve one click. Title and notes are edited in the block itself, where the
  text already is; putting them here would mean looking at one side of the
  screen while typing into the other.

  STATUS OFFERS THREE OPTIONS, NOT FOUR
  `blocked` is derived from the dependency graph and is deliberately absent.
  Offering it would let the stored value contradict the graph, and the stored
  one would win — so a task could claim to be blocked by nothing. The rail
  shows the derived state as a read-only line instead.
  -------------------------------------------------------------------------- */

const SETTABLE_STATUSES = ['todo', 'doing', 'done']

/* ONE CONTROL HEIGHT.
   The rail shipped with 22, 25, 26, 27 and 28px controls stacked down a 168px
   column — five heights, none of them a multiple of anything, so the right
   edge was ragged and no two rows lined up. That is the same fault
   TextBlockToolbar's own header calls out about its v2, and it's most of what
   made this read as thrown together rather than designed. Everything primary
   is now 28.

   The two group spacings are deliberate and different: 3px inside a group,
   14px between groups. A single uniform gap is what makes a stack of controls
   read as one undifferentiated list. */
const ROW_H = 28
const GROUP_GAP = 14

export default function TaskToolbar({ block, blocks, connections, dark, colors, onUpdateBlock, onAddSubtask }) {
  if (!block) return null
  const { surface, border, text2, text3, accent } = colors

  const status = effectiveStatus(block, blocks, connections) || 'todo'
  const dl = deadlineState(block)
  const set = patch => onUpdateBlock(block.id, patch)

  return (
    <div
      data-island-rail
      data-kbd-zone
      style={{
        position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)',
        zIndex: Z.rail, width: 168,
        display: 'flex', flexDirection: 'column', gap: 3, padding: 8,
        maxHeight: 'calc(100% - 120px)', overflowY: 'auto',
        background: `${surface}dd`,
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${border}`, borderRadius: 12,
        boxShadow: `0 4px 24px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.08)'}`,
        fontFamily: 'var(--ds-font-body)',
        animation: 'dsRailIn 0.18s cubic-bezier(.34,1.3,.64,1)',
      }}>

      <div title={block.title || 'Task'} style={{
        fontSize: 'var(--ds-fs-xs)', fontFamily: 'var(--ds-font-mono)', textTransform: 'uppercase',
        letterSpacing: 0.9, color: text3,
        padding: '2px 6px 7px', borderBottom: `1px solid ${border}`,
        marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {block.title || 'Task'}
      </div>

      {/* ── status ──
          ds-tbtn rather than a hand-rolled button: the class carries hover, the
          press nudge, the focus ring and the is-on treatment. Half this rail
          used it and half didn't, which is worse than none of it doing — the
          pointer got a response from Subtask and silence from everything
          above it. Nothing here sets `background` inline, because an inline
          background would beat the class's :hover rule and put us back. */}
      <Label colors={colors}>Status</Label>
      <div style={{ display: 'flex', gap: 3 }}>
        {SETTABLE_STATUSES.map(st => {
          const on = block.status === st
          return (
            <button key={st} onClick={() => set({ status: st })} aria-pressed={on}
              title={`Mark as ${STATUS_LABEL[st].toLowerCase()}`}
              className={`ds-tbtn${on ? ' is-on' : ''}`}
              style={{
                flex: 1, minWidth: 0, height: ROW_H, padding: 0,
                justifyContent: 'center', fontSize: 'var(--ds-fs-sm)',
              }}>
              {STATUS_LABEL[st]}
            </button>
          )
        })}
      </div>

      {status === 'blocked' && (
        /* Derived, so it's stated rather than offered. Filled rather than
           outlined — an amber hairline around amber text on glass is the
           weakest way to say the strongest thing in the rail. */
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 5,
          padding: '6px 8px', borderRadius: 'var(--ds-radius-md)',
          background: 'var(--ds-amber-bg)', color: 'var(--ds-amber)',
          fontSize: 'var(--ds-fs-sm)', lineHeight: 1.45,
        }}>
          <Icon name="state-lock" size={12} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Blocked by an unfinished task</span>
        </div>
      )}

      {/* ── priority ── */}
      <Label colors={colors} style={{ marginTop: GROUP_GAP }}>Priority</Label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {PRIORITIES.map(p => {
          const on = (block.priority || 'med') === p
          return (
            <button key={p} onClick={() => set({ priority: p })} aria-pressed={on}
              title={`${PRIORITY_LABEL[p]} priority`}
              className={`ds-tbtn${on ? ' is-on' : ''}`}
              style={{
                width: '100%', height: ROW_H, padding: '0 9px',
                justifyContent: 'flex-start', fontSize: 'var(--ds-fs-sm)',
              }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: PRIORITY_COLOR[p],
                /* Same halo the card gives urgent, so the two surfaces agree
                   about which one is different in kind. */
                boxShadow: p === 'urgent' ? `0 0 0 3px ${PRIORITY_COLOR.urgent}33` : 'none',
              }} />
              <span style={{ flex: 1, textAlign: 'left' }}>{PRIORITY_LABEL[p]}</span>
            </button>
          )
        })}
      </div>

      {/* ── deadline ──
          Clear moved into the label row as an icon. It used to be a
          full-width 22px button that appeared and disappeared under the input,
          which both broke the column's rhythm and made the rail jump height
          every time a date was set. */}
      <Label colors={colors} style={{ marginTop: GROUP_GAP, display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ flex: 1 }}>Deadline</span>
        {block.deadline && (
          <button onClick={() => set({ deadline: null })}
            title="Clear deadline" aria-label="Clear deadline"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 16, height: 16, padding: 0, borderRadius: 4,
              border: 'none', background: 'transparent', color: text3, cursor: 'pointer',
              transition: 'color var(--ds-transition)',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--ds-red)' }}
            onMouseLeave={e => { e.currentTarget.style.color = text3 }}>
            <Icon name="action-delete" size={11} />
          </button>
        )}
      </Label>
      <input
        type="date"
        value={toDateInput(block.deadline)}
        onChange={e => set({ deadline: e.target.value || null })}
        onKeyDown={e => e.stopPropagation()}
        style={{
          width: '100%', boxSizing: 'border-box', height: ROW_H,
          padding: '0 8px', borderRadius: 'var(--ds-radius-md)',
          border: `1px solid ${border}`, background: 'transparent',
          color: text2, outline: 'none',
          fontFamily: 'var(--ds-font-mono)', fontSize: 'var(--ds-fs-sm)',
          fontVariantNumeric: 'tabular-nums',
          colorScheme: dark ? 'dark' : 'light',
          transition: 'border-color var(--ds-transition)',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = accent }}
        onBlur={e => { e.currentTarget.style.borderColor = border }} />
      {dl.state !== 'none' && dl.state !== 'done' && (
        /* The same chip the card shows, so the rail and the block agree
           rather than stating the same fact two different ways. */
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
          marginTop: 5, padding: '2px 7px', borderRadius: 'var(--ds-radius-sm)',
          fontSize: 'var(--ds-fs-sm)', fontFamily: 'var(--ds-font-mono)',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: dl.state === 'overdue' ? 600 : 500, lineHeight: 1.4,
          color: DEADLINE_COLOR[dl.state],
          border: dl.state === 'later' ? '1px solid transparent' : `1px solid ${DEADLINE_COLOR[dl.state]}`,
          background: dl.state === 'overdue' ? 'var(--ds-red-bg)'
            : dl.state === 'soon' ? 'var(--ds-amber-bg)' : 'transparent',
        }}>
          <Icon name={dl.state === 'overdue' ? 'status-warning' : 'status-info'} size={11} />
          {dl.label}
        </div>
      )}

      {/* ── assignee ── */}
      <Label colors={colors} style={{ marginTop: GROUP_GAP }}>Assignee</Label>
      <input
        defaultValue={block.assignee || ''}
        onBlur={e => { e.currentTarget.style.borderColor = border; set({ assignee: e.target.value }) }}
        onFocus={e => { e.currentTarget.style.borderColor = accent }}
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur() }}
        placeholder="Nobody"
        style={{
          width: '100%', boxSizing: 'border-box', height: ROW_H,
          padding: '0 8px', borderRadius: 'var(--ds-radius-md)',
          border: `1px solid ${border}`, background: 'transparent',
          color: text2, outline: 'none',
          fontFamily: 'var(--ds-font-body)', fontSize: 'var(--ds-fs-sm)',
          transition: 'border-color var(--ds-transition)',
        }} />

      <button onClick={() => onAddSubtask?.(block)}
        title="Create a task below this one, already linked as a dependency"
        className="ds-tbtn"
        style={{
          width: '100%', height: ROW_H, marginTop: GROUP_GAP, padding: '0 9px',
          fontSize: 'var(--ds-fs-sm)', justifyContent: 'flex-start',
        }}>
        <Icon name="action-add" size={14} />
        <span style={{ flex: 1, textAlign: 'left' }}>Subtask</span>
      </button>

      <div style={{
        marginTop: 10, paddingTop: 8, borderTop: `1px solid ${border}`,
        fontSize: 'var(--ds-fs-xs)', lineHeight: 1.55, color: text2, display: 'flex', gap: 6,
      }}>
        <Icon name="status-info" size={12} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Drag a port to another task to link them, then right-click the line to say how.</span>
      </div>
    </div>
  )
}

function Label({ children, colors, style }) {
  return (
    <div style={{
      fontSize: 'var(--ds-fs-xs)', fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.9,
      textTransform: 'uppercase', color: colors.text3, padding: '0 2px 4px', ...style,
    }}>
      {children}
    </div>
  )
}
