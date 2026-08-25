'use client'
import { Component } from 'react'
import Icon from './../ui/Icon'

/*
  components/notebook/BlockErrorBoundary.js
  --------------------------------------------------------------------------
  One broken block must not take the canvas with it.

  Without a boundary, a render error anywhere inside a block unmounts the
  entire React tree — white screen, every other block gone, and because the
  workspace autosaves, the state that caused it is already on disk. Reloading
  reproduces it. The workspace is unrecoverable through the UI while the data
  is still perfectly fine.

  TWO THINGS THIS GOT WRONG FIRST TIME, BOTH ABOUT THE FALLBACK ITSELF

  1  IT NEEDS EXPLICIT DIMENSIONS.
     The card used `width: 100%; height: 100%`, which looks obviously right and
     isn't. The wrapper each block sits in is `position: absolute` with only
     `left` and `top` — no width — because every block type supplies its own
     sized inner element. When the boundary replaces that sized element, there
     is nothing for 100% to resolve against, the wrapper shrink-wraps, and the
     card collapses into a ~150px column with two words per line.

  2  IT MUST SHOW THE ERROR, NOT HIDE IT.
     The message was behind a "Details" toggle, on the theory that it's for
     reporting rather than reading. That's backwards: the one piece of
     information that makes the failure actionable was the one piece nobody
     could see. The message is now the second line of the card.

  Both are the same mistake in different clothes — designing the error state as
  though it were decoration rather than the most important screen in the app at
  the moment it appears.

  WHY A CLASS
  componentDidCatch has no hook equivalent. This is the only class component in
  the codebase, which is why it's isolated in its own file.
  -------------------------------------------------------------------------- */

export default class BlockErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null, showStack: false }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Loud in the console — this is a bug, not a user error. The block id is
    // included, because "some block crashed" is not a reportable fact.
    console.error(
      `[DataStudio] Block ${this.props.blockId} (${this.props.blockType}) failed to render.`,
      error, info?.componentStack
    )
    this.setState({ info })
    this.props.onError?.(error, info)
  }

  /* Reset when asked. If the underlying data is still bad it throws again
     immediately, which is honest — the button doesn't claim to have fixed
     anything, it re-attempts the render. */
  retry = () => this.setState({ error: null, info: null, showStack: false })

  copy = () => {
    const text = [
      `Block: ${this.props.blockId} (${this.props.blockType})`,
      `Error: ${this.state.error?.message || this.state.error}`,
      this.state.error?.stack || '',
      this.state.info?.componentStack || '',
    ].join('\n')
    navigator?.clipboard?.writeText?.(text).catch(() => {})
  }

  render() {
    const { error, info, showStack } = this.state
    if (!error) return this.props.children

    const { blockType, onDelete, width, height } = this.props
    const message = String(error?.message || error || 'Unknown error')

    return (
      <div
        role="alert"
        style={{
          /* Explicit pixels, and deliberately COMPACT.

             Two separate lessons here. It needs real pixels because the
             wrapper is position:absolute with no width, so a percentage has
             nothing to resolve against — that's note 1 above.

             But matching the block's size was also wrong. A failed PDF block
             is 520×620, and a notice with four buttons stretched to fill it is
             an enormous red rectangle for two sentences of content. The card's
             job is to say what happened and offer a way out; it should look
             like a small notice sitting where the block was, not like a
             replacement block. So it takes the block's width only as an upper
             bound, and its height from its own content. */
          width: Math.max(240, Math.min(width || 320, 360)),
          maxWidth: '100%',
          height: 'auto',
          maxHeight: height || undefined,
          display: 'flex', flexDirection: 'column', gap: 8,
          padding: 12, boxSizing: 'border-box', overflow: 'auto',
          background: 'var(--ds-red-bg)',
          border: '1px solid var(--ds-red)',
          borderRadius: 10,
          fontFamily: 'var(--ds-font-body)',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--ds-red)' }}>
          <Icon name="status-error" size={15} />
          <span style={{ fontSize: 12, fontWeight: 650, lineHeight: 1.3 }}>
            This {blockType || 'block'} block couldn’t be displayed
          </span>
        </div>

        {/* The message, in the open. Selectable, so it can be copied by hand
            as well as by the button. */}
        <div style={{
          padding: '8px 10px', borderRadius: 6,
          background: 'var(--ds-raised)', border: '1px solid var(--ds-border)',
          fontFamily: 'var(--ds-font-mono)', fontSize: 10, lineHeight: 1.45,
          color: 'var(--ds-text-2)', userSelect: 'text',
          wordBreak: 'break-word', maxHeight: 96, overflow: 'auto',
        }}>
          {message}
        </div>

        <div style={{ fontSize: 10.5, color: 'var(--ds-text-2)', lineHeight: 1.45 }}>
          Your data is still saved.
        </div>

        {/* No `marginTop: auto`. That pushed the buttons to the bottom of a
            stretched card; with an auto-height card they simply follow the
            content. */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          <button onClick={this.retry} style={btn('var(--ds-text-2)')}>
            <Icon name="draw-undo" size={12} /> Try again
          </button>
          {onDelete && (
            <button onClick={onDelete} style={btn('var(--ds-red)')}>
              <Icon name="action-delete" size={12} /> Delete block
            </button>
          )}
          <button onClick={this.copy} style={btn('var(--ds-text-3)')}>
            <Icon name="action-duplicate" size={12} /> Copy
          </button>
          {info?.componentStack && (
            <button onClick={() => this.setState(s => ({ showStack: !s.showStack }))}
              aria-expanded={showStack} style={btn('var(--ds-text-3)')}>
              <Icon name={showStack ? 'nav-chevron-down' : 'nav-chevron-right'} size={11} />
              Stack
            </button>
          )}
        </div>

        {showStack && (
          <pre style={{
            margin: 0, padding: 8, borderRadius: 6,
            background: 'var(--ds-raised)', border: '1px solid var(--ds-border)',
            fontFamily: 'var(--ds-font-mono)', fontSize: 9.5, lineHeight: 1.45,
            color: 'var(--ds-text-3)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            userSelect: 'text', maxHeight: 200, overflow: 'auto',
          }}>
            {info.componentStack.trim()}
          </pre>
        )}
      </div>
    )
  }
}

const btn = color => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
  background: 'transparent', border: '1px solid var(--ds-border)',
  color, fontFamily: 'var(--ds-font-body)', fontSize: 10.5,
  whiteSpace: 'nowrap', lineHeight: 1.2,
})
