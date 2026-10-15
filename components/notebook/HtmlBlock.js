'use client'
import { memo, useState, useRef, useEffect, useCallback } from 'react'
import Icon from '../ui/Icon'
import { localPointFromEvent } from '../../lib/canvasgeom'
import {
  PREVIEW_PATH, SANDBOX, VIEWPORTS, MAX_HTML_BYTES, MAX_LOGS,
  withBridge, readLog, fitViewport, titleOf, byteLength,
} from '../../lib/htmlblock'

/* ── HTML PROTOTYPE BLOCK ─────────────────────────────────────────────────
   Code on the left, the running page on the right, its console underneath.
   lib/htmlblock.js explains the isolation; this file is the UI.

   The iframe only takes the pointer while the block is selected. Otherwise a
   canvas gesture that crosses the block (a pan, a marquee, a wheel) would
   vanish into the frame, which has no idea the canvas exists. */

const RUN_DELAY = 600

function HtmlBlockInner({ block, colors, active, onUpdateBlock, editingRef }) {
  const { border, borderDim, text, text2, text3, accent, accentText, accentDim, raised, surface, base } = colors
  const view = block.view || {}
  const mode = view.mode || 'split'
  const vpId = view.vp || 'fill'
  const split = typeof view.split === 'number' ? view.split : 45

  const [draft, setDraft] = useState(block.html ?? '')
  const [runHtml, setRunHtml] = useState(block.html ?? '')
  const [runKey, setRunKey] = useState(0)
  const [logs, setLogs] = useState([])
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [area, setArea] = useState({ w: 0, h: 0 })
  const [dragging, setDragging] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [auto, setAuto] = useState(view.auto !== false)
  const frameRef = useRef(null)
  const prevRef = useRef(null)
  const bodyRef = useRef(null)
  const taRef = useRef(null)
  const gutRef = useRef(null)
  const tokenRef = useRef('')
  const saveT = useRef(null)
  const dirty = useRef(false)

  const bytes = byteLength(draft)
  const tooBig = bytes > MAX_HTML_BYTES

  /* Someone else changed the code (sync, undo): take it, unless you are in
     the middle of typing, when your draft wins and is saved over it. */
  useEffect(() => {
    if (dirty.current) return
    const h = block.html ?? ''
    setDraft(h)
    setRunHtml(h)
    setRunKey(k => k + 1)
  }, [block.html])

  const setView = patch => onUpdateBlock({ view: { ...view, ...patch } })

  const run = useCallback((html = draft) => {
    setRunHtml(html)
    setRunKey(k => k + 1)
  }, [draft])

  /* Each run gets a new frame (the key) and a new token, so nothing from a
     previous run — a timer, a late console line — reaches this one. */
  useEffect(() => {
    tokenRef.current = Math.random().toString(36).slice(2) + Date.now().toString(36)
    setLogs([])
  }, [runKey])

  useEffect(() => {
    function onMessage(e) {
      const frame = frameRef.current
      if (!frame || e.source !== frame.contentWindow) return
      const d = e.data
      if (d && d.dsHtmlReady === 1) {
        frame.contentWindow.postMessage({ dsHtmlRun: 1, html: withBridge(runHtml, tokenRef.current) }, '*')
        return
      }
      const line = readLog(d, tokenRef.current)
      if (!line) return
      setLogs(list => {
        const next = [...list, line]
        return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next
      })
      if (line.kind === 'error') setConsoleOpen(true)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [runHtml, runKey])

  /* Save and (optionally) re-run a moment after typing stops. */
  function edit(value, { now = false } = {}) {
    setDraft(value)
    dirty.current = true
    clearTimeout(saveT.current)
    const commit = () => {
      dirty.current = false
      if (byteLength(value) > MAX_HTML_BYTES) return
      const patch = { html: value }
      const t = titleOf(value)
      if (t && (!block.name || block.name === 'HTML prototype')) patch.name = t
      onUpdateBlock(patch)
      if (auto) run(value)
    }
    if (now) commit(); else saveT.current = setTimeout(commit, RUN_DELAY)
  }
  useEffect(() => () => clearTimeout(saveT.current), [])

  useEffect(() => {
    const el = prevRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setArea({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [mode])

  const syncGutter = () => { if (gutRef.current && taRef.current) gutRef.current.scrollTop = taRef.current.scrollTop }
  const lines = draft.split('\n').length

  /* The divider, in the block's own untransformed space (lib/canvasgeom), so
     it tracks the cursor at every canvas zoom. */
  function startDivider(e) {
    e.preventDefault(); e.stopPropagation()
    const el = bodyRef.current
    setDragging(true)
    let last = split
    const move = ev => {
      const x = localPointFromEvent(el, ev).x
      last = Math.max(15, Math.min(85, (x / el.offsetWidth) * 100))
      el.style.setProperty('--ds-html-split', last + '%')
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(false)
      setView({ split: Math.round(last) })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function loadFile(file) {
    if (!file) return
    if (file.size > MAX_HTML_BYTES) { setLogs([{ kind: 'error', text: `${file.name} is ${Math.round(file.size / 1024)} KB — the limit is ${MAX_HTML_BYTES / 1024} KB.` }]); setConsoleOpen(true); return }
    const rd = new FileReader()
    rd.onload = () => {
      const value = String(rd.result || '')
      setDraft(value); dirty.current = false
      onUpdateBlock({ html: value, name: titleOf(value) || file.name.replace(/\.html?$/i, '') })
      run(value)
    }
    rd.readAsText(file)
  }

  const vp = VIEWPORTS.find(v => v.id === vpId) || VIEWPORTS[0]
  const fit = fitViewport(vp.w, area)
  const errors = logs.filter(l => l.kind === 'error').length
  const warns = logs.filter(l => l.kind === 'warn').length

  const seg = (items, cur, onPick, label) => (
    <div role="radiogroup" aria-label={label} style={{ display: 'inline-flex', border: `1px solid ${border}`, borderRadius: 6, overflow: 'hidden', height: 24, flexShrink: 0 }}>
      {items.map((it, i) => (
        <button key={it.id} role="radio" aria-checked={cur === it.id} onClick={() => onPick(it.id)}
          style={{
            border: 'none', borderLeft: i ? `1px solid ${border}` : 'none', padding: '0 9px', cursor: 'pointer',
            background: cur === it.id ? accentDim : surface, color: cur === it.id ? accentText : text2,
            fontFamily: 'var(--ds-font-body)', fontSize: 12, fontWeight: cur === it.id ? 600 : 400,
          }}>{it.label}</button>
      ))}
    </div>
  )

  return (
    <div
      onMouseDown={e => e.stopPropagation()}
      onDragOver={e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); e.stopPropagation(); setDropping(true) } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false) }}
      onDrop={e => {
        if (![...(e.dataTransfer?.types || [])].includes('Files')) return
        e.preventDefault(); e.stopPropagation(); setDropping(false)
        const f = [...e.dataTransfer.files].find(x => /\.html?$/i.test(x.name) || x.type === 'text/html')
        if (f) loadFile(f)
        else { setLogs([{ kind: 'warn', text: 'Drop an .html or .htm file.' }]); setConsoleOpen(true) }
      }}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', background: base }}>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, height: 34, padding: '0 8px', flexShrink: 0,
        borderBottom: `1px solid ${borderDim}`, background: raised, overflowX: 'auto', scrollbarWidth: 'none',
      }}>
        {seg([{ id: 'code', label: 'Code' }, { id: 'split', label: 'Split' }, { id: 'preview', label: 'Preview' }], mode, m => setView({ mode: m }), 'Layout')}
        {mode !== 'code' && seg(VIEWPORTS, vpId, v => setView({ vp: v }), 'Device width')}
        <span style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--ds-font-body)', fontSize: 12, color: text3, whiteSpace: 'nowrap', cursor: 'pointer' }}>
          <input type="checkbox" checked={auto} onChange={e => { setAuto(e.target.checked); setView({ auto: e.target.checked }) }} style={{ accentColor: accent, margin: 0 }} />
          Auto-run
        </label>
        <button onClick={() => { clearTimeout(saveT.current); edit(draft, { now: true }); run(draft) }}
          title="Run (Ctrl+Enter)"
          style={{
            display: 'flex', alignItems: 'center', gap: 5, height: 24, padding: '0 10px', flexShrink: 0,
            border: `1px solid ${border}`, borderRadius: 6, background: surface, color: text2, cursor: 'pointer',
            fontFamily: 'var(--ds-font-body)', fontSize: 12,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accentText }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = text2 }}>
          <Icon name="nav-chevron-right" size={12} />Run
        </button>
      </div>

      <div ref={bodyRef} style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative', '--ds-html-split': split + '%' }}>
        {mode !== 'preview' && (
          <div style={{ flex: mode === 'code' ? 1 : '0 0 var(--ds-html-split)', minWidth: 0, display: 'flex', background: base }}>
            <div ref={gutRef} aria-hidden="true" style={{
              flexShrink: 0, width: 40, padding: '10px 6px 10px 0', overflow: 'hidden', textAlign: 'right',
              fontFamily: 'var(--ds-font-code)', fontSize: 12, lineHeight: '18px', color: text3,
              background: surface, borderRight: `1px solid ${borderDim}`, whiteSpace: 'pre', userSelect: 'none',
            }}>{Array.from({ length: Math.min(lines, 20000) }, (_, i) => i + 1).join('\n')}</div>
            <textarea ref={taRef} data-ds-code-editor value={draft} spellCheck={false} aria-label="HTML source"
              placeholder="Paste HTML here, or drop an .html file on this block"
              onChange={e => edit(e.target.value)}
              onPaste={() => { clearTimeout(saveT.current); setTimeout(() => edit(taRef.current?.value ?? draft, { now: true }), 0) }}
              onScroll={syncGutter}
              onFocus={() => { if (editingRef) editingRef.current = true }}
              onBlur={() => { if (editingRef) editingRef.current = false }}
              onKeyDown={e => {
                if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault()
                  const el = e.currentTarget
                  el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end')
                  edit(el.value)
                }
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); clearTimeout(saveT.current); edit(e.currentTarget.value, { now: true }); run(e.currentTarget.value) }
              }}
              style={{
                flex: 1, minWidth: 0, border: 'none', outline: 'none', resize: 'none', background: 'transparent',
                color: text, padding: 10, whiteSpace: 'pre', overflow: 'auto', tabSize: 2,
                fontFamily: 'var(--ds-font-code)', fontSize: 12, lineHeight: '18px',
              }} />
          </div>
        )}

        {mode === 'split' && (
          <div role="separator" aria-orientation="vertical" aria-label="Resize code and preview"
            onPointerDown={startDivider}
            style={{ flexShrink: 0, width: 7, margin: '0 -3px', cursor: 'col-resize', zIndex: 2, position: 'relative', display: 'flex', justifyContent: 'center' }}>
            <span style={{ width: dragging ? 2 : 1, height: '100%', background: dragging ? accent : border }} />
          </div>
        )}

        {mode !== 'code' && (
          <div ref={prevRef} style={{
            flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden',
            background: vp.w ? `repeating-conic-gradient(${surface} 0 25%, ${base} 0 50%) 0 0 / 16px 16px` : '#fff',
          }}>
            <div style={{
              position: 'absolute', left: fit.left, top: fit.top, width: fit.w, height: fit.h,
              transform: fit.scale !== 1 ? `scale(${fit.scale})` : undefined, transformOrigin: '0 0',
              background: '#fff', boxShadow: vp.w ? 'var(--ds-shadow-md)' : 'none',
            }}>
              <iframe key={runKey} ref={frameRef} title={`${block.name || 'HTML prototype'} preview`}
                src={PREVIEW_PATH} sandbox={SANDBOX} referrerPolicy="no-referrer"
                style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: '#fff', pointerEvents: active && !dragging ? 'auto' : 'none' }} />
            </div>
            {vp.w && (
              <span style={{
                position: 'absolute', right: 8, bottom: 8, padding: '1px 6px', borderRadius: 4,
                background: surface, border: `1px solid ${border}`, color: text3,
                fontFamily: 'var(--ds-font-mono)', fontSize: 11, pointerEvents: 'none',
              }}>{vp.w} × {Math.round(fit.h)} · {Math.round(fit.scale * 100)}%</span>
            )}
            {!active && (
              <span style={{
                position: 'absolute', left: 8, bottom: 8, padding: '2px 7px', borderRadius: 4,
                background: `${surface}ee`, border: `1px solid ${border}`, color: text3,
                fontFamily: 'var(--ds-font-body)', fontSize: 11, pointerEvents: 'none',
              }}>Click the block to interact</span>
            )}
          </div>
        )}

        {dropping && (
          <div style={{
            position: 'absolute', inset: 8, zIndex: 3, display: 'grid', placeItems: 'center', pointerEvents: 'none',
            border: `2px dashed ${accent}`, borderRadius: 10, background: `${accentDim}e6`,
            color: accentText, fontFamily: 'var(--ds-font-body)', fontSize: 14, fontWeight: 600,
          }}>Drop the .html file to load it</div>
        )}
      </div>

      <div style={{ flexShrink: 0, borderTop: `1px solid ${borderDim}`, background: surface }}>
        <button onClick={() => setConsoleOpen(o => !o)} aria-expanded={consoleOpen}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 26, padding: '0 10px',
            background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
            fontFamily: 'var(--ds-font-body)', fontSize: 12, color: text2,
          }}>
          <Icon name="nav-chevron-down" size={12} style={{ transform: consoleOpen ? 'none' : 'rotate(-90deg)', transition: 'transform .15s ease' }} />
          Console
          <span style={{
            fontFamily: 'var(--ds-font-mono)', fontSize: 11, padding: '0 5px', borderRadius: 4,
            background: errors ? 'var(--ds-red-bg)' : warns ? 'var(--ds-amber-bg)' : raised,
            color: errors ? 'var(--ds-red)' : warns ? 'var(--ds-amber)' : text3,
          }}>{errors ? `${errors} error${errors > 1 ? 's' : ''}` : warns ? `${warns} warning${warns > 1 ? 's' : ''}` : logs.length}</span>
          <span style={{ flex: 1 }} />
          {tooBig
            ? <span style={{ color: 'var(--ds-red)', fontSize: 11 }}>{Math.round(bytes / 1024)} KB — over the {MAX_HTML_BYTES / 1024} KB limit, not saved</span>
            : <span title="The page runs in its own sandbox: it cannot read DataStudio, your session, cookies or storage."
                style={{ display: 'flex', alignItems: 'center', gap: 4, color: text3, fontSize: 11, whiteSpace: 'nowrap' }}>
                <Icon name="state-lock" size={12} />Sandboxed
              </span>}
        </button>
        {consoleOpen && (
          <div role="log" aria-live="polite" style={{
            maxHeight: 120, overflowY: 'auto', padding: '0 0 4px', userSelect: 'text',
            fontFamily: 'var(--ds-font-code)', fontSize: 12, lineHeight: '17px',
          }}>
            {logs.length === 0
              ? <div style={{ padding: '2px 10px 6px', color: text3 }}>Nothing logged yet.</div>
              : logs.map((l, i) => (
                <div key={i} style={{
                  padding: '2px 10px', borderTop: `1px solid ${borderDim}`, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  color: l.kind === 'error' ? 'var(--ds-red)' : l.kind === 'warn' ? 'var(--ds-amber)' : text2,
                  background: l.kind === 'error' ? 'var(--ds-red-bg)' : l.kind === 'warn' ? 'var(--ds-amber-bg)' : 'transparent',
                }}>{l.text}</div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(HtmlBlockInner, (a, b) =>
  a.block.html === b.block.html && a.block.view === b.block.view && a.block.name === b.block.name &&
  a.active === b.active && a.colors === b.colors)
