'use client'
import { useState, useRef, useEffect } from 'react'
import TextBlockContent from './TextBlockContent'
import ResizeHandle from './ResizeHandle'
import BlockHandle from './BlockHandle'
import KanbanBlock from './KanbanBlock'
import SheetGrid from './SheetGrid'
import ImageBlock from './ImageBlock'
import ExportPanel from '../tools/ExportPanel'
import SheetToolbar from '../tools/SheetToolbar'
import CurveFitPanel from '../tools/CurveFitPanel'
import ImageToolbar from '../tools/ImageToolbar'
import { SHORTCUT_GROUPS } from '../../lib/shortcuts'

/* The freeform infinite-canvas notebook view. Hosts text/table/kanban blocks
   that the user drags around on a dot-grid background. Right-click drag pans.

   POLISH UPDATES:
   - Active sheet name is now editable inline (double-click to rename)
   - Tables and kanban blocks now have resize handles in their bottom-right
   - Deleting a block with content asks for confirmation first
   - colors prop is forwarded to TextBlockContent for the right-click toolbar

   MAGNETIC SNAP (rewritten)
   -------------------------
   The old snap was binary: inside 9px it teleported the block onto the guide,
   outside it did nothing. That hard edge is what made it feel like the app was
   grabbing the block away from you.

   The model now has two zones, like Figma/Freeform:

     |<-- MAGNET_RANGE (30px) -->|<-- SNAP_RADIUS (11px) -->| target
              attraction only            locked

   Inside MAGNET_RANGE the block is *pulled* toward alignment by an eased
   fraction of the remaining distance, so you feel resistance before anything
   locks. Inside SNAP_RADIUS it locks exactly and the guide goes solid. The
   pull strength curve is cubic — nearly zero at the outer edge, so a block
   drifting past a guide isn't visibly deflected.

   Guides fade in rather than appearing, are keyed by axis+position so React
   keeps the same node alive across frames (letting the CSS animation run
   once), and carry the distance-derived opacity. The block you aligned
   against is outlined at the same time, so it's obvious *what* you snapped to.

   Targets are ranked: edge-to-edge beats centre alignment, closer beats
   further, and candidates whose perpendicular extent doesn't overlap the
   dragged block are dropped entirely — that removes the old behaviour where a
   block on the far side of the canvas could capture you.

   Hold Alt at any point to suspend snapping without toggling it off.
*/

/* Snap tuning — all in screen px, divided by zoom at use site so the feel is
   identical at every zoom level. */
/* Add-menu items. Labels only — the icon column was an empty string rendered
   into a 20px span (a hole in front of every label), and the T/B/K/S hints
   advertised shortcuts that were never bound to anything. */
const ADD_ITEMS = [
  { type: 'text',    label: 'Text Block' },
  { type: 'table',   label: 'Table Block' },
  { type: 'kanban',  label: 'Kanban Board' },
  { type: 'section', label: 'Section' },
  { type: 'image',   label: 'Image' },
]

const EMPTY_BLOCKS = []
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl'

const SNAP_RADIUS   = 14   // inside this, lock exactly
const MAGNET_RANGE  = 46   // inside this, attract proportionally
const OVERLAP_SLACK = 160  // perpendicular overlap needed to be a candidate
const SPACING_TOL   = 3    // equal-gap detection tolerance
/* Standard gutter between adjacent blocks. Flush edges look like a mistake,
   so alongside every edge-to-edge target we also offer one sitting this far
   clear of the neighbour — that's the "couple of pixels next to other blocks"
   position you actually want when laying blocks out side by side. */
const BLOCK_GAP     = 16
export default function NotebookCanvas({
  nb,
  dark,
  colors,
  onAddBlock,
  onUpdateBlock,
  onDeleteBlock,
  onRenameNotebook,
  onRenameSheet,
  onDropColumn,
  onOpenCrosscheck,
  onRemoveTableColumn,
  onAddConnection,
  onDeleteConnection,
  onAddDrawing,
  onDeleteDrawing,
  onClearDrawings,
  onPickImage,
}) {
  const { surface, raised, border, text, text2, text3, accent, accentDim, red, base, green, amber } = colors
  const containerRef = useRef(null)
  const [pan, setPan] = useState({ x: 60, y: 60 })
  const panRef = useRef({ x: 60, y: 60 })
  const [renamingNb, setRenamingNb] = useState(false)
  const [nbLabel, setNbLabel] = useState(nb.name)
  const [renamingSheet, setRenamingSheet] = useState(false)
  const [sheetLabel, setSheetLabel] = useState('')
  const editingRef = useRef(false)
  const [renamingBlockId, setRenamingBlockId] = useState(null)
  const suppressNextBgClickRef = useRef(false)
  const [nbZoom, setNbZoom] = useState(1)
  const nbZoomRef = useRef(1)
  const [snapLines, setSnapLines] = useState([])
  // Container size in CSS px, so guides can be drawn across the entire visible
  // workspace instead of just spanning the two blocks being aligned.
  const [viewSize, setViewSize] = useState({ w: 1200, h: 800 })
  // Signatures of the last committed guide/spacing state. The drag handler
  // fires on every mousemove; without these it would setState ~120×/second.
  const lastSnapSig = useRef('')
  const lastSpacingSig = useRef('')
  const [isPresentation, setIsPresentation] = useState(false)
  const outerRef = useRef(null)
const [selectedIds, setSelectedIds] = useState(new Set())
  const [ctxMenu, setCtxMenu] = useState(null)
  const [mindMapMode, setMindMapMode] = useState(false)
  const [mindMapMaster, setMindMapMaster] = useState(null)
  const [snapEnabled, setSnapEnabled] = useState(false)
  const snapRef = useRef(false)
  const [snapTargets, setSnapTargets] = useState([])   // block ids we aligned against
  const [spacingTags, setSpacingTags] = useState([])   // equal-gap badges
  const [draggingBlockId, setDraggingBlockId] = useState(null)
  // Viewport lock: while a block is selected the canvas must not pan or zoom.
  // Kept in a ref because the wheel listener is registered once, natively.
  const selectionLockRef = useRef(false)
  const [hoverSectionId, setHoverSectionId] = useState(null)
  const [hoveredConnId, setHoveredConnId] = useState(null)
  const [selectedConnId, setSelectedConnId] = useState(null)
  // Live link being dragged out of a port: { fromId, fromSide, x, y, overId }
  const [linking, setLinking] = useState(null)
  const linkingRef = useRef(null)
const [drawMode, setDrawMode] = useState(false)
const [drawColor, setDrawColor] = useState('#5B5FE8')
const [drawSize, setDrawSize] = useState(3)
const [showDrawPanel, setShowDrawPanel] = useState(false)
const [currentPath, setCurrentPath] = useState(null)
const isDrawing = useRef(false)
const drawPanelRef = useRef(null)
  const [hoveredBlockId, setHoveredBlockId] = useState(null)
  const [animatingBlockId, setAnimatingBlockId] = useState(null)
  const [deletingBlockId, setDeletingBlockId] = useState(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [sheetTool, setSheetTool] = useState(null)   // id of the open sheet tool
  const [cropping, setCropping] = useState(false)    // image crop armed
  const [pendingCrop, setPendingCrop] = useState(null)  // normalised {x,y,w,h}
  /* ── Keyboard mode ─────────────────────────────────────────────────────
     Press M and the app becomes drivable without a mouse.

       kbMode = null      normal, mouse-driven
              | 'nav'     a block is selected and centred; arrows move between
                          blocks, Enter edits, Esc leaves
              | 'toolbar' Shift is being held; arrows walk the island buttons,
                          Enter activates, releasing Shift returns to the block
              | 'grab'    G was pressed; arrows move the block itself

     Only one entry key, and after that everything is arrows and Enter. No
     modifier is claimed for navigation, which is the whole reason this works
     across platforms — see RESERVED_COMBOS in lib/shortcuts.js.

     'toolbar' is a *held* state rather than a toggle because that's what makes
     it feel like glancing away and back: your block stays selected the entire
     time and returns the instant you let go. */
  const [kbMode, setKbMode] = useState(null)
  const [toolbarIdx, setToolbarIdx] = useState(0)
  const grabOriginRef = useRef(null)
  const grabHoldRef = useRef(0)      // consecutive Shift-held arrow presses
  const topRowRef = useRef(null)

  // Releasing Shift resets the grab acceleration, so the next hold starts slow.
  useEffect(() => {
    function up(e) { if (e.key === 'Shift') grabHoldRef.current = 0 }
    document.addEventListener('keyup', up)
    return () => document.removeEventListener('keyup', up)
  }, [])

  /* Every button reachable in toolbar mode, sorted into visual order.
     Queried from the document rather than from a ref, because the sidebar and
     the Settings island live in AppPage, outside this component — which is
     exactly why Import, the folder/notebook buttons and Settings were all
     unreachable before. Any element marked data-kbd-zone joins the set. */
  function islandButtons() {
    if (typeof document === 'undefined') return []
    const zones = document.querySelectorAll('[data-kbd-zone]')
    const seen = new Set()
    const out = []
    zones.forEach(z => {
      z.querySelectorAll('button:not([disabled]),[role="button"]:not([aria-disabled="true"])').forEach(b => {
        if (seen.has(b)) return
        const r = b.getBoundingClientRect()
        if (r.width < 4 || r.height < 4) return       // hidden or collapsed
        seen.add(b)
        out.push({ el: b, x: r.left + r.width / 2, y: r.top + r.height / 2 })
      })
    })
    // Reading order, banded by row so a 6px height difference doesn't reorder
    // a toolbar.
    out.sort((a, b) => (Math.round(a.y / 24) - Math.round(b.y / 24)) || (a.x - b.x))
    return out
  }

  /** Nearest button in a direction — arrows jump spatially, not by index. */
  function buttonInDirection(list, from, dir) {
    if (!from) return null
    let best = null, bestScore = Infinity
    for (const c of list) {
      if (c.el === from.el) continue
      const dx = c.x - from.x, dy = c.y - from.y
      const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy
      if (along <= 1) continue
      const off = (dir === 'left' || dir === 'right') ? Math.abs(dy) : Math.abs(dx)
      if (off > along * 3 + 200) continue
      const score = along + off * 1.6
      if (score < bestScore) { bestScore = score; best = c }
    }
    return best
  }

  /** Block nearest the centre of the current view — the entry point for M. */
  function blockNearestCentre() {
    if (!blocks.length) return null
    const z = nbZoomRef.current
    const cx = (viewSize.w / 2 - panRef.current.x) / z
    const cy = (viewSize.h / 2 - panRef.current.y) / z
    let best = null, bd = Infinity
    for (const b of blocks) {
      if (b.type === 'section') continue
      const d = blockDims(b)
      const dist = Math.hypot(b.x + d.w / 2 - cx, b.y + d.h / 2 - cy)
      if (dist < bd) { bd = dist; best = b }
    }
    return best
  }

  function enterKeyboardMode() {
    const target = soleSelected || blockNearestCentre()
    if (!target) { setKbMode('nav'); containerRef.current?.focus({ preventScroll: true }); return }
    setKbMode('nav')
    selectAndReveal(target)
  }

  function exitKeyboardMode() {
    setKbMode(null)
    setSelectedIds(new Set())
    grabOriginRef.current = null
  }

  function startGrab(b) {
    if (!b) return
    grabOriginRef.current = { id: b.id, x: b.x, y: b.y }
    setKbMode('grab')
  }
  function endGrab(cancel) {
    const o = grabOriginRef.current
    if (cancel && o) onUpdateBlock(o.id, { x: o.x, y: o.y })
    grabOriginRef.current = null
    setKbMode('nav')
  }

  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [canvasFocused, setCanvasFocused] = useState(false)
  const [resizing, setResizing] = useState(null)     // { id, w, h } live measures
  const [marquee, setMarquee] = useState(null)       // rubber-band selection rect
  /* Painted rect of the image being cropped, in coordinates relative to its
     wrapper. The crop overlay is drawn against this rather than the wrapper,
     so the dimming and the selection box line up with the picture instead of
     with the letterboxing around it. */
  const cropWrapRef = useRef(null)
  const [cropHost, setCropHost] = useState(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const addMenuRef = useRef(null)
  const ctxMenuRef = useRef(null)

  useEffect(() => { setNbLabel(nb.name) }, [nb.name])
  useEffect(() => {
    function onFs() { if (!document.fullscreenElement) setIsPresentation(false) }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const activeSheet = nb.sheets?.find(s => s.id === nb.activeSheetId) || nb.sheets?.[0]
  // Stable empty-array fallback. `activeSheet?.blocks || []` minted a new
  // array on every render whenever the sheet was missing, which made any
  // effect depending on `blocks` re-run forever.
  const blocks = activeSheet?.blocks || EMPTY_BLOCKS
const drawings = activeSheet?.drawings || []
  /* Pressing on a block that's ALREADY part of a multi-selection must not
     collapse the selection — that's what broke lasso dragging. selectBlock
     ran on pointerdown and replaced the selection with the single block, so
     by the time startBlockDrag looked at selectedIds there was only ever one
     entry and the "move them all" branch could never fire.

     Standard behaviour instead: pointerdown on an already-selected block
     leaves the selection alone so the drag can carry all of it, and the
     collapse is deferred to mouseup — but only if you didn't actually drag.
     Click to isolate one block, drag to move the group. */
  const pendingCollapseRef = useRef(null)
  const didDragRef = useRef(false)

  function selectBlock(id, ctrl) {
    if (ctrl) {
      pendingCollapseRef.current = null
      setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
      return
    }
    if (selectedIds.has(id) && selectedIds.size > 1) {
      pendingCollapseRef.current = id      // resolved on mouseup
      return
    }
    pendingCollapseRef.current = null
    setSelectedIds(new Set([id]))
  }

  // A click that never became a drag isolates the block it landed on.
  useEffect(() => {
    function onUp() {
      const id = pendingCollapseRef.current
      pendingCollapseRef.current = null
      if (id && !didDragRef.current) setSelectedIds(new Set([id]))
      didDragRef.current = false
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])
  function handleBlockContextMenu(e, blockId) {
    e.preventDefault(); e.stopPropagation()
    if (!selectedIds.has(blockId)) setSelectedIds(new Set([blockId]))
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }
  /* Only ask when there's something to lose. Confirming the deletion of an
     empty block is pure friction — you just made it by mis-clicking. */
  function blockHasContent(b) {
    if (!b) return false
    if (b.type === 'text') return (b.content || '').replace(/<[^>]*>/g, '').trim().length > 0
    if (b.type === 'table') return !!b.rows?.some(row => row.some(c => c && String(c).trim()))
    if (b.type === 'kanban') return !!b.lanes?.some(l => l.cards?.length > 0)
    if (b.type === 'section') return blocks.some(x => x.parentSectionId === b.id)
    return false
  }
  function deleteSelected() {
    if (selectedIds.size === 0) return
    const doomed = [...selectedIds].map(id => blocks.find(b => b.id === id)).filter(Boolean)
    const withContent = doomed.filter(blockHasContent).length
    if (withContent > 0) {
      const n = selectedIds.size
      if (!window.confirm(`Delete ${n} block${n > 1 ? 's' : ''}? ${withContent} contain${withContent > 1 ? '' : 's'} data.`)) return
    }
    selectedIds.forEach(id => onDeleteBlock(id))
    setSelectedIds(new Set()); setCtxMenu(null)
  }
  function duplicateSelected() {
    selectedIds.forEach(id => {
      const b = blocks.find(bl => bl.id === id)
      if (!b) return
      const patch = {}
      if (b.w) patch.w = b.w
      if (b.h) patch.h = b.h
      if (b.name) patch.name = b.name + ' (copy)'
      if (b.type === 'text' && b.content) patch.content = b.content
      if (b.type === 'kanban' && b.lanes) patch.lanes = JSON.parse(JSON.stringify(b.lanes))
      onAddBlock(b.type, b.x + 30, b.y + 30,
        b.type === 'table' ? [...b.headers] : null,
        b.type === 'table' ? b.rows.map(r => [...r]) : null,
        b.w || null, b.h || null, patch)
    })
    setCtxMenu(null)
  }

  /* The single selected table block, or null. Sheet tools act on exactly one
     sheet — with two selected there'd be no way to tell which one a fit was
     reading from, so the toolbar simply doesn't appear. */
  const soleSelected = selectedIds.size === 1
    ? blocks.find(x => x.id === [...selectedIds][0]) || null
    : null
  const soleTableBlock = soleSelected?.type === 'table' ? soleSelected : null
  const soleImageBlock = soleSelected?.type === 'image' ? soleSelected : null

  /* Toolbar traversal is on TAB, not hold-Shift.
     ------------------------------------------------------------------
     Hold-Shift was wrong for a reason that only shows up in use: Shift is a
     prefix, not a mode. The moment you press Shift+F to fit a block, the
     Shift keydown fires first, the app jumps to the toolbar, and the F never
     reaches the canvas. Every Shift+<key> binding was dead on arrival.

     Tab has none of that problem — it's a discrete press, it's what "move to
     the next control" already means everywhere else, and it leaves the whole
     Shift+<key> space free for Shift+F, Shift+R and 10px grab steps.

     Tab enters the toolbar, Tab/arrows walk it, Esc or Enter returns. */
  function enterToolbar() {
    const btns = islandButtons()
    if (!btns.length) return false
    setKbMode('toolbar')
    setToolbarIdx(0)
    btns[0].el.focus()
    return true
  }
  function leaveToolbar() {
    setKbMode('nav')
    containerRef.current?.focus({ preventScroll: true })
    if (soleSelected) centerOnBlock(soleSelected)
  }

  // Losing the window while in toolbar mode shouldn't strand us there.
  useEffect(() => {
    if (kbMode !== 'toolbar') return
    function blur() { setKbMode('nav') }
    window.addEventListener('blur', blur)
    return () => window.removeEventListener('blur', blur)
  }, [kbMode])

  // Deselecting abandons a grab rather than leaving it armed against a block
  // you can no longer see.
  useEffect(() => {
    if (kbMode === 'grab' && !soleSelected) { grabOriginRef.current = null; setKbMode('nav') }
  }, [soleSelected, kbMode])

  // Leaving the image block cancels an armed crop, so it can't linger.
  useEffect(() => {
    if (!soleImageBlock && (cropping || pendingCrop)) { setCropping(false); setPendingCrop(null) }
  }, [soleImageBlock, cropping, pendingCrop])

  // Measure the painted image once crop is armed, and again if the block is
  // resized or the image itself changes underneath.
  useEffect(() => {
    if (!cropping) { setCropHost(null); return }
    function measure() {
      const wrap = cropWrapRef.current
      const img = wrap?.querySelector('img')
      if (!wrap || !img) { setCropHost(null); return }
      const w = wrap.getBoundingClientRect()
      const i = img.getBoundingClientRect()
      setCropHost({ left: i.left - w.left, top: i.top - w.top, width: i.width, height: i.height })
    }
    measure()
    // The image may still be decoding when crop is armed.
    const t = setTimeout(measure, 120)
    window.addEventListener('resize', measure)
    return () => { clearTimeout(t); window.removeEventListener('resize', measure) }
  }, [cropping, soleImageBlock?.id, soleImageBlock?.w, soleImageBlock?.h, soleImageBlock?.rev, nbZoom])

  // Close any open sheet tool as soon as its block stops being the selection.
  useEffect(() => {
    if (!soleTableBlock && sheetTool) setSheetTool(null)
  }, [soleTableBlock, sheetTool])

  // ── Mind map & snap helpers ──
  const connections = activeSheet?.connections || []
  function toggleMindMap() { setMindMapMode(m => !m); setMindMapMaster(null) }
  function toggleSnap() { const next = !snapEnabled; setSnapEnabled(next); snapRef.current = next }

  /* Grow a section so every child sits fully inside it, with padding. Without
     this a block dropped near an edge — or nudged after being captured — hangs
     half outside its own section, which is what the clipping used to (badly)
     hide. Only ever grows: shrinking on every move would fight the user while
     they're still arranging things. */
  const SECTION_PAD = 18
  const SECTION_HEAD = 38
  function growSectionToFit(sectionId, overrides = {}) {
    const section = blocks.find(b => b.id === sectionId)
    if (!section || section.type !== 'section') return
    const kids = blocks.filter(b => b.parentSectionId === sectionId)
    if (kids.length === 0) return

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    kids.forEach(k => {
      const pos = overrides[k.id] || k
      const { w, h } = blockDims(k)
      minX = Math.min(minX, pos.x); minY = Math.min(minY, pos.y)
      maxX = Math.max(maxX, pos.x + w); maxY = Math.max(maxY, pos.y + h)
    })

    const wantX = Math.min(section.x, minX - SECTION_PAD)
    const wantY = Math.min(section.y, minY - SECTION_PAD - SECTION_HEAD)
    const wantR = Math.max(section.x + blockDims(section).w, maxX + SECTION_PAD)
    const wantB = Math.max(section.y + blockDims(section).h, maxY + SECTION_PAD)

    const patch = {}
    if (wantX < section.x) patch.x = wantX
    if (wantY < section.y) patch.y = wantY
    const nw = wantR - (patch.x ?? section.x)
    const nh = wantB - (patch.y ?? section.y)
    if (nw > blockDims(section).w || patch.x !== undefined) patch.w = nw
    if (nh > blockDims(section).h || patch.y !== undefined) patch.h = nh
    if (Object.keys(patch).length) onUpdateBlock(sectionId, patch)
  }

  function blockDims(b) {
    const w = b.w || (b.type === 'kanban' ? 720 : b.type === 'table' ? 520 : b.type === 'section' ? 500 : 320)
    const h = b.h || (b.type === 'kanban' ? 280 : b.type === 'table' ? 260 : b.type === 'section' ? 350 : 150)
    return { w, h }
  }

  function pickPortSide(fromB, toB) {
    const fc = { x: fromB.x + blockDims(fromB).w/2, y: fromB.y + blockDims(fromB).h/2 }
    const tc = { x: toB.x + blockDims(toB).w/2, y: toB.y + blockDims(toB).h/2 }
    const dx = tc.x - fc.x, dy = tc.y - fc.y
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top')
  }

  function addConnection(fromId, toId) {
    if (fromId === toId) return
    if (connections.some(c => c.fromBlockId === fromId && c.toBlockId === toId)) return
    const from = blocks.find(b => b.id === fromId)
    const to = blocks.find(b => b.id === toId)
    if (!from || !to) return
    const conn = {
      id: `conn_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      fromBlockId: fromId, toBlockId: toId,
      fromSide: pickPortSide(from, to),
      toSide: pickPortSide(to, from),
    }
    if (onAddConnection) onAddConnection(conn)
  }

  function deleteConnection(connId) {
    if (onDeleteConnection) onDeleteConnection(connId)
  }

  function getBlockConnections(blockId) {
    return connections.filter(c => c.fromBlockId === blockId || c.toBlockId === blockId)
  }

  /* Wrap delete with content-aware confirmation. We don't ask if the
     block is empty (no point making the user confirm "delete nothing"),
     but we do ask if there's actual data they could lose. */
  function confirmDelete(block) {
    let hasContent = false
    if (block.type === 'text') {
      const stripped = (block.content || '').replace(/<[^>]*>/g, '').trim()
      hasContent = stripped.length > 0
    } else if (block.type === 'table') {
      hasContent = block.rows?.some(row => row.some(c => c && String(c).trim()))
    } else if (block.type === 'kanban') {
      hasContent = block.lanes?.some(l => l.cards?.length > 0)
    }
    if (hasContent) {
      const ok = window.confirm(`Delete this ${block.type} block? This cannot be undone.`)
      if (!ok) return
    }
    // Animate out, then remove
    setDeletingBlockId(block.id)
    setTimeout(() => {
      onDeleteBlock(block.id)
      setDeletingBlockId(null)
      if (selectedIds.has(block.id)) setSelectedIds(new Set())
    }, 200)
  }
function addBlockAnimated(type, x, y) {
    onAddBlock(type, x, y)
  }

  /* Which block is "new" was previously inferred as `bi === blocks.length - 1`
     while a timer was running, so adding a block would animate whichever block
     happened to be last in the array — often the wrong one, and on the section
     branch it animated a block that had just been re-parented rather than
     created. We now diff block ids across renders and animate exactly the ones
     that genuinely appeared. */
  const seenBlockIds = useRef(null)
  useEffect(() => {
    const ids = new Set(blocks.map(b => b.id))
    if (seenBlockIds.current === null) { seenBlockIds.current = ids; return }
    const fresh = [...ids].filter(id => !seenBlockIds.current.has(id))
    seenBlockIds.current = ids
    if (fresh.length === 0) return
    setAnimatingBlockId(fresh[fresh.length - 1])
    const t = setTimeout(() => setAnimatingBlockId(null), 400)
    return () => clearTimeout(t)
  }, [blocks])

  // Reset the id ledger when the sheet changes, so switching sheets doesn't
  // animate every block on arrival.
  useEffect(() => { seenBlockIds.current = null }, [activeSheet?.id])

  // Close add menu when clicking outside
  useEffect(() => {
    if (!addMenuOpen) return
    function handleClick(e) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target)) setAddMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [addMenuOpen])
  useEffect(() => {
    if (!showDrawPanel) return
    function handleClick(e) {
      if (drawPanelRef.current && !drawPanelRef.current.contains(e.target)) setShowDrawPanel(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showDrawPanel])

  useEffect(() => {
    if (!ctxMenu) return
    function h(e) { if (ctxMenuRef.current && ctxMenuRef.current.contains(e.target)) return; setCtxMenu(null) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [ctxMenu])

  useEffect(() => {
    if (!mindMapMode) return
    function onKey(e) { if (e.key === 'Escape') { setMindMapMode(false); setMindMapMaster(null) } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mindMapMode])

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setViewSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setViewSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  /* Top row geometry.
     ------------------------------------------------------------------
     Previous attempts positioned each island absolutely and computed a max
     width for the title island from the toolbar's measured width. That kept
     overlapping because the two were measured in different reference frames:
     the islands are absolutely positioned against AppPage's relative wrapper,
     while viewSize came from containerRef further down the tree. Any
     arithmetic built on mismatched origins is going to be wrong somewhere.

     The islands now live in one flex row instead. Flex items cannot overlap —
     the gap is enforced by the layout rather than calculated — so this holds
     at every width, in every locale, whatever the button labels say. The row
     is inset to clear the sidebar on the left and the profile island on the
     right; the toolbar sits between two equal spacers so it stays centred in
     whatever room is left, and the title island is the only thing that
     shrinks. */
  const ROW_LEFT = 284      // 16 sidebar inset + 252 sidebar + 16 gutter
  const ROW_RIGHT = 162     // profile island (~130) + its 16 inset + 16 gutter

  /* Keep the viewport-lock ref in step with the selection. A block being
     selected freezes pan and zoom — see handleWheel and startPan. */
  useEffect(() => {
    selectionLockRef.current = selectedIds.size > 0
  }, [selectedIds])

  /* ── Keyboard-only navigation ──────────────────────────────────────────
     Three focus levels, and Escape steps out one at a time:

       0  nothing selected            — canvas has focus, arrows do nothing
       1  block selected              — arrows move between blocks
       2  inside a block's content    — the block owns every key

     Level 2 is why the guard below is narrow rather than blanket: SheetGrid's
     scroller and the text block's contentEditable both already implement full
     keyboard models, and stealing their keys would break them. The canvas
     only acts when the event came from the canvas element itself (or from
     document.body, i.e. nothing focused).

     Spatial, not index order. `Tab` walks reading order, but arrows pick the
     nearest block in that actual direction — on a freeform canvas, "the next
     block in the array" is meaningless. */

  /** Nearest block in a direction, scored by distance with an off-axis penalty. */
  function blockInDirection(from, dir) {
    if (!from) return null
    const fd = blockDims(from)
    const fc = { x: from.x + fd.w / 2, y: from.y + fd.h / 2 }
    let best = null, bestScore = Infinity
    for (const b of blocks) {
      if (b.id === from.id || b.type === 'section') continue
      const bd = blockDims(b)
      const bc = { x: b.x + bd.w / 2, y: b.y + bd.h / 2 }
      const dx = bc.x - fc.x, dy = bc.y - fc.y
      const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy
      if (along <= 1) continue                       // wrong side
      const off = (dir === 'left' || dir === 'right') ? Math.abs(dy) : Math.abs(dx)
      if (off > along * 2.5 + 240) continue          // outside the cone
      const score = along + off * 2                  // prefer straight ahead
      if (score < bestScore) { bestScore = score; best = b }
    }
    return best
  }

  /* Centre the camera on a block.
     ------------------------------------------------------------------
     THE BLOCK DOES NOT MOVE. Only `pan` changes — the camera translates over
     a fixed world, so the block's x/y on the grid are untouched and its
     relationship to everything around it is preserved. (Moving the block to
     the middle of the screen instead would rearrange the canvas every time
     you looked at something, which is the opposite of what you want.)

     Centred within the USABLE area, not the raw viewport: the sidebar covers
     the left, the island row the top, and a contextual rail may cover the
     right. Centring on the whole window would park the block under the
     sidebar on a narrow screen. */
  const panAnimRef = useRef(null)
  function centerOnBlock(b, { animate = true } = {}) {
    if (!b || !viewSize.w) return
    const z = nbZoomRef.current
    const { w, h } = blockDims(b)

    const railW = (soleTableBlock || soleImageBlock) ? 160 : 16
    const usableL = ROW_LEFT, usableR = viewSize.w - railW
    const usableT = TOP_ROW_H, usableB = viewSize.h
    const cx = (usableL + usableR) / 2
    const cy = (usableT + usableB) / 2

    // Solve pan such that the block's centre lands on the usable centre.
    const target = {
      x: cx - (b.x + w / 2) * z,
      y: cy - (b.y + h / 2) * z,
    }

    if (panAnimRef.current) cancelAnimationFrame(panAnimRef.current)
    if (!animate) {
      panRef.current = target
      setPan({ ...target })
      return
    }

    const from = { ...panRef.current }
    const dist = Math.hypot(target.x - from.x, target.y - from.y)
    if (dist < 1) return
    // Short hops stay quick; long jumps get a little more time so the eye can
    // follow where it went rather than being teleported.
    const dur = Math.min(420, 140 + dist * 0.35)
    const start = performance.now()
    const ease = t => 1 - Math.pow(1 - t, 3)   // easeOutCubic

    function step(now) {
      const t = Math.min(1, (now - start) / dur)
      const k = ease(t)
      panRef.current = {
        x: from.x + (target.x - from.x) * k,
        y: from.y + (target.y - from.y) * k,
      }
      setPan({ ...panRef.current })
      if (t < 1) panAnimRef.current = requestAnimationFrame(step)
      else panAnimRef.current = null
    }
    panAnimRef.current = requestAnimationFrame(step)
  }

  // Any manual pan or zoom cancels an in-flight camera move, so the two can't
  // fight over panRef.
  function stopPanAnim() {
    if (panAnimRef.current) { cancelAnimationFrame(panAnimRef.current); panAnimRef.current = null }
  }
  useEffect(() => () => stopPanAnim(), [])

  function selectAndReveal(b) {
    if (!b) return
    setSelectedIds(new Set([b.id]))
    centerOnBlock(b)
    containerRef.current?.focus({ preventScroll: true })
  }

  /** Level 1 → 2. Hand focus to whatever inside the block owns the keyboard. */
  function enterBlock(b) {
    if (!b) return
    const host = containerRef.current?.querySelector(`[data-block-id="${b.id}"]`)
    if (!host) return
    if (b.type === 'table') {
      host.querySelector('[tabindex]')?.focus()          // SheetGrid scroller
    } else if (b.type === 'text') {
      const ed = host.querySelector('[contenteditable]')
      if (ed) {
        ed.focus()
        // Caret to the end, so typing appends rather than overwriting.
        const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false)
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r)
      }
    } else if (b.type === 'kanban') {
      host.querySelector('input,textarea,[contenteditable],button')?.focus()
    } else if (b.type === 'image') {
      setSheetTool(null)   // the tools rail is already showing; nothing to type into
    }
  }

  /** Create a block by keyboard: below the selection, or in view if there's none. */
  function createByKeyboard(type) {
    if (type === 'image') { onPickImage?.(); return }
    const z = nbZoomRef.current
    let x, y
    if (soleSelected) {
      const d = blockDims(soleSelected)
      x = soleSelected.x
      y = soleSelected.y + d.h + BLOCK_GAP
    } else {
      x = (ROW_LEFT + 60 - panRef.current.x) / z
      y = (TOP_ROW_H + 60 - panRef.current.y) / z
    }
    addBlockAnimated(type, x, y)
  }

  useEffect(() => {
    function onKey(e) {
      /* Never act on a key that belongs to something inside a block. Without
         this, pressing Delete with a table block selected while the cursor
         sits in a cell would run BOTH SheetGrid's clearSelection AND this
         handler's deleteSelected — clearing the cells and then deleting the
         whole block. Anything focusable (inputs, contentEditable, and the
         grid's tabIndex=0 scroll container) owns its own keys; the canvas
         only handles keys that arrive with nothing focused. */
      const t = e.target
      // The canvas element itself is focusable now, so "focus is on something
      // focusable" is no longer a reason to bail — it's the normal state for
      // keyboard navigation. Only content INSIDE a block owns its own keys.
      const onCanvas = t === containerRef.current || t === document.body

      /* Escape is handled BEFORE the focus guard, and unconditionally.
         Selecting a table block focuses SheetGrid's tabIndex=0 scroller, so
         the guard below swallowed Escape and the selection could never be
         released — the canvas stayed frozen with no way out. Escape is a
         universal "get me out of this" key; it must never be gated on where
         focus happens to be. It also blurs whatever is focused, so a second
         press isn't needed to leave a cell. */
      if (e.key === 'Escape') {
        // Innermost state first: cancel a grab and put the block back.
        if (kbMode === 'toolbar') { e.preventDefault(); leaveToolbar(); return }
        if (kbMode === 'grab') { e.preventDefault(); endGrab(true); return }
        if (selectedConnId) { setSelectedConnId(null); return }
        setCtxMenu(null)
        if (!onCanvas) {
          /* Level 2 → 1. Step out of the block's content but KEEP it selected,
             and put focus back on the canvas so the next arrow press navigates.
             Previously this cleared the selection outright, which meant one
             Escape threw away your place entirely. */
          if (typeof t?.blur === 'function') t.blur()
          containerRef.current?.focus({ preventScroll: true })
          return
        }
        // Level 1 → 0. In keyboard mode this also leaves the mode.
        if (kbMode) { exitKeyboardMode(); return }
        if (selectedIds.size > 0) setSelectedIds(new Set())
        return
      }

      /* Never act on any OTHER key that belongs to something inside a block.
         Without this, pressing Delete with a table block selected while the
         cursor sits in a cell would run BOTH SheetGrid's clearSelection AND
         this handler's deleteSelected — clearing the cells and then deleting
         the whole block. Anything focusable (inputs, contentEditable, and the
         grid's tabIndex=0 scroll container) owns its own keys. */
      /* ── toolbar mode ──
         MUST sit above the !onCanvas guard. In toolbar mode focus is on a
         BUTTON, so `onCanvas` is false and the guard below returned before
         this ever ran — which is why arrows did nothing. Tab appeared to work
         only because that was the browser's own tab order taking over, not
         this handler, which is also why it reached buttons islandButtons()
         doesn't know about. */
      if (kbMode === 'toolbar') {
        const btns = islandButtons()
        if (!btns.length) { leaveToolbar(); return }
        const idx = Math.min(toolbarIdx, btns.length - 1)
        const cur = btns[idx]

        const goTo = c => {
          if (!c) return
          const i = btns.indexOf(c)
          setToolbarIdx(i)
          c.el.focus()
        }
        // Tab is sequential (predictable, reaches everything); arrows are
        // spatial (fast — jump straight from the toolbar down to a rail).
        if (e.key === 'Tab') {
          e.preventDefault()
          goTo(btns[(idx + (e.shiftKey ? -1 : 1) + btns.length) % btns.length])
          return
        }
        const dir = { ArrowRight: 'right', ArrowLeft: 'left', ArrowUp: 'up', ArrowDown: 'down' }[e.key]
        if (dir) {
          e.preventDefault()
          const next = buttonInDirection(btns, cur, dir)
          // Nothing that way — fall back to sequential so you're never stuck.
          goTo(next || btns[(idx + (dir === 'right' || dir === 'down' ? 1 : -1) + btns.length) % btns.length])
          return
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          cur?.el.click()
          leaveToolbar()
          return
        }
        // Everything else drops through to the shared handlers below.
      }

      if (!onCanvas) return

      /* ── Level 0/1: canvas has focus ── */

      // Shortcuts reference. Keyboard navigation nobody can discover is
      // keyboard navigation nobody uses.
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault(); setShortcutsOpen(v => !v); return
      }

      const plain = !e.ctrlKey && !e.metaKey && !e.altKey


      // M enters keyboard mode. Pressing it again while in nav re-centres.
      if (plain && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        if (kbMode === 'nav' && soleSelected) { centerOnBlock(soleSelected); return }
        enterKeyboardMode()
        return
      }

      // G grabs the selected block so arrows move it.
      if (plain && e.key.toLowerCase() === 'g' && soleSelected && kbMode !== 'grab') {
        e.preventDefault(); startGrab(soleSelected); return
      }
      if (kbMode === 'grab' && e.key === 'Enter') { e.preventDefault(); endGrab(false); return }

      // Create. Suppressed while grabbing, so 'n' can't spawn a block mid-move.
      if (kbMode !== 'grab' && plain) {
        const make = { n: 'text', t: 'table', k: 'kanban', s: 'section', i: 'image' }[e.key.toLowerCase()]
        if (make) { e.preventDefault(); createByKeyboard(make); return }
      }

      /* Tab walks reading order — top-to-bottom, then left-to-right.
         Only while a block is selected. With nothing selected, Tab is left
         alone so it does what Tab is supposed to do and moves focus out of
         the canvas to the rest of the page. Cycling unconditionally trapped
         keyboard focus inside the canvas with no way out, which is a genuine
         accessibility failure, not just an annoyance. Escape to deselect,
         then Tab to leave. */
      /* Tab enters the toolbar while in keyboard mode. Outside it, Tab is left
         alone so focus can leave the canvas for the rest of the page —
         cycling unconditionally trapped keyboard focus with no way out. */
      if (e.key === 'Tab') {
        if (kbMode === 'nav' || kbMode === 'grab') {
          e.preventDefault()
          enterToolbar()
        }
        return
      }

      // Enter steps into the selected block's content (level 1 → 2).
      if (e.key === 'Enter' && soleSelected) {
        e.preventDefault(); enterBlock(soleSelected); return
      }

      // A picked connection is deletable with the same key as a block.
      if (selectedConnId && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        deleteConnection(selectedConnId)
        setSelectedConnId(null)
        return
      }
      if (selectedIds.size === 0) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelected()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        duplicateSelected()
        return
      }
      // Shift+F fits the selected block to the screen; Shift+R restores it.
      if (e.shiftKey && e.key.toLowerCase() === 'f' && soleSelected) {
        e.preventDefault(); fitBlockToScreen(soleSelected); return
      }
      if (e.shiftKey && e.key.toLowerCase() === 'r' && soleSelected) {
        e.preventDefault(); resetBlockSize(soleSelected); return
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        const dirName = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key]

        /* In move mode the arrows move the block; otherwise they navigate
           between blocks. Shift makes the step 10px. No modifier is overloaded,
           so nothing collides with the browser. */
        if (kbMode === 'grab' && soleSelected) {
          /* Hold Shift and the step accelerates the longer you hold it —
             1px taps for precision, ramping to 60px so crossing the canvas
             doesn't take a hundred presses. The counter resets on keyup
             (see the effect below), so each press starts slow again. */
          const step = e.shiftKey
            ? Math.min(60, 6 + Math.floor(grabHoldRef.current / 2) * 4)
            : 1
          if (e.shiftKey) grabHoldRef.current += 1
          const b = soleSelected
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
          onUpdateBlock(b.id, { x: b.x + dx, y: b.y + dy })
          if (b.parentSectionId) {
            const moved = { [b.id]: { x: b.x + dx, y: b.y + dy } }
            setTimeout(() => growSectionToFit(b.parentSectionId, moved), 0)
          }
          return
        }

        {
          if (!soleSelected) {
            // Nothing selected: enter from the top-left corner of the canvas.
            const first = blocks.filter(b => b.type !== 'section')
              .slice().sort((a, b) => (a.y - b.y) || (a.x - b.x))[0]
            selectAndReveal(first)
            return
          }
          const next = blockInDirection(soleSelected, dirName)
          if (next) selectAndReveal(next)
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, blocks, selectedConnId, soleSelected, viewSize, kbMode, toolbarIdx])
  /* Only create a text block when nothing is being edited */
  function handleBgClick(e) {
    if (e.target !== e.currentTarget) return
    if (drawMode) return

    if (suppressNextBgClickRef.current) {
      suppressNextBgClickRef.current = false
      return
    }

    if (editingRef.current) {
      editingRef.current = false
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur()
      }
      suppressNextBgClickRef.current = true
      return
    }

    setSelectedConnId(null)

    const rect = containerRef.current.getBoundingClientRect()
    const bzoom = window.visualViewport?.scale || 1
    const z = nbZoomRef.current
    const x = ((e.clientX - rect.left) / bzoom - panRef.current.x) / z
    const y = ((e.clientY - rect.top) / bzoom - panRef.current.y) / z
    setSelectedIds(new Set())
    addBlockAnimated('text', x - 140, y - 20)
  }

  function startBlockDrag(e, block) {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()

    const startMX = e.clientX
    const startMY = e.clientY
    const origX = block.x
    const origY = block.y
    const { w: bw, h: bh } = blockDims(block)
    let dragging = false
    let currentHoverSection = null

    // Eased follow: the pointer moves `target`, a rAF loop walks the block
    // toward it. EASE is high enough to feel connected, low enough to smooth.
    const EASE = 0.42
    const target = { x: origX, y: origY }
    const cur = { x: origX, y: origY }
    let raf = null
    let releasing = false

    /* Edge auto-pan.
       Dragging a block to the edge of the screen used to just stop — the
       canvas is infinite but the view wouldn't follow, so moving something
       any real distance meant drop, pan, pick up, repeat. While the pointer
       sits inside EDGE px of the viewport the camera scrolls that way, and
       the block keeps its position under the cursor because the drag maths
       reads panRef every frame. Speed ramps with how deep into the margin you
       are, so a nudge creeps and a shove flies. */
    const EDGE = 90, EDGE_MAX = 26
    const lastPointer = { current: { x: startMX, y: startMY } }
    let edgeRaf = null

    function edgeTick() {
      const el = containerRef.current
      if (!el || !dragging) { edgeRaf = null; return }
      const r = el.getBoundingClientRect()
      const p = lastPointer.current
      const push = (dist) => Math.min(1, Math.max(0, (EDGE - dist) / EDGE))
      let dx = 0, dy = 0
      if (p.x - r.left < EDGE) dx = push(p.x - r.left) * EDGE_MAX
      else if (r.right - p.x < EDGE) dx = -push(r.right - p.x) * EDGE_MAX
      if (p.y - r.top < EDGE) dy = push(p.y - r.top) * EDGE_MAX
      else if (r.bottom - p.y < EDGE) dy = -push(r.bottom - p.y) * EDGE_MAX

      if (dx || dy) {
        panRef.current = { x: panRef.current.x + dx, y: panRef.current.y + dy }
        setPan({ ...panRef.current })
        // The pointer hasn't moved, but the world under it has — recompute so
        // the block tracks the cursor instead of sliding away from it.
        const z = nbZoomRef.current
        target.x -= dx / z
        target.y -= dy / z
        startEase()
      }
      edgeRaf = requestAnimationFrame(edgeTick)
    }
    function startEdgePan() { if (edgeRaf == null) edgeRaf = requestAnimationFrame(edgeTick) }
    function stopEdgePan() { if (edgeRaf != null) { cancelAnimationFrame(edgeRaf); edgeRaf = null } }

    function tick() {
      const dx = target.x - cur.x
      const dy = target.y - cur.y
      if (Math.abs(dx) < 0.15 && Math.abs(dy) < 0.15) {
        cur.x = target.x; cur.y = target.y
        applyPos()
        raf = null
        return
      }
      cur.x += dx * EASE
      cur.y += dy * EASE
      applyPos()
      raf = requestAnimationFrame(tick)
    }
    function applyPos() {
      onUpdateBlock(block.id, { x: cur.x, y: cur.y })
      // Section children AND the rest of a multi-selection travel together.
      childOffsets.forEach(c => onUpdateBlock(c.id, { x: cur.x + c.dx, y: cur.y + c.dy }))
    }
    function startEase() { if (raf == null) raf = requestAnimationFrame(tick) }

    /* Everything that travels with this drag, captured up front as offsets
       from the dragged block's origin.

       Two groups:
       · a section's children, which have always followed their parent
       · the rest of a multi-selection — dragging one block of a lasso used to
         move only that block, leaving the other selected blocks behind, which
         made marquee selection useless for anything but delete and duplicate

       Sections already in the selection bring their own children, and the Set
       keeps a block from being moved twice if it's both. */
    const travellers = new Map()
    const addTraveller = c => {
      if (c.id === block.id || travellers.has(c.id)) return
      travellers.set(c.id, { id: c.id, dx: c.x - origX, dy: c.y - origY })
    }
    if (block.type === 'section') {
      blocks.filter(b => b.parentSectionId === block.id).forEach(addTraveller)
    }
    if (selectedIds.has(block.id) && selectedIds.size > 1) {
      blocks.forEach(b => {
        if (!selectedIds.has(b.id)) return
        addTraveller(b)
        if (b.type === 'section') {
          blocks.filter(c => c.parentSectionId === b.id).forEach(addTraveller)
        }
      })
    }
    const childOffsets = [...travellers.values()]

    function onMove(ev) {
      if (!dragging) {
        if (Math.abs(ev.clientX - startMX) < 5 && Math.abs(ev.clientY - startMY) < 5) return
        dragging = true
        didDragRef.current = true
        setDraggingBlockId(block.id)
      }
      lastPointer.current = { x: ev.clientX, y: ev.clientY }
      const z = nbZoomRef.current
      let nx = origX + (ev.clientX - startMX) / z
      let ny = origY + (ev.clientY - startMY) / z

      // Alt suspends snapping for as long as it's held — the standard escape
      // hatch, so you never have to reach for the toolbar mid-drag.
      if (snapRef.current && !ev.altKey) {
        const RAD = SNAP_RADIUS / z
        const MAG = MAGNET_RANGE / z
        const slack = OVERLAP_SLACK / z
        const GAP = BLOCK_GAP

        /* Attraction curve. 1 at the lock radius, easing to 0 at the outer
           edge of the magnet range. Quadratic rather than cubic: cubic was so
           flat across most of the range that the pull was imperceptible until
           you were almost on top of the guide, which is why it read as "not
           magnetic". Squared still leaves distant blocks alone but you can
           feel the block leaning in well before it locks. */
        function pull(d) {
          if (d <= RAD) return 1
          if (d >= MAG) return 0
          const t = 1 - (d - RAD) / (MAG - RAD)
          return t * t
        }

        const candX = []
        const candY = []
        const neighbours = []

        blocks.forEach(b => {
          if (b.id === block.id) return
          if (b.id === block.parentSectionId) return   // don't fight your own section
          const { w: ow, h: oh } = blockDims(b)
          neighbours.push({ id: b.id, x: b.x, y: b.y, w: ow, h: oh })

          // Only consider a block if it actually sits alongside us on the
          // other axis. Stops a block 4000px away from capturing the drag.
          const overlapY = ny < b.y + oh + slack && ny + bh > b.y - slack
          const overlapX = nx < b.x + ow + slack && nx + bw > b.x - slack

          if (overlapY) {
            /* [my edge, their edge, guide position, shift-to-apply, rank, gap]
               rank 0 = edge alignment (preferred), 1 = centre.
               The two GAP entries place the block a standard gutter clear of
               the neighbour rather than flush against it. */
            ;[
              [nx,          b.x,          b.x,          b.x,            0, 0],
              [nx,          b.x + ow,     b.x + ow,     b.x + ow,       0, 0],
              [nx + bw,     b.x,          b.x,          b.x - bw,       0, 0],
              [nx + bw,     b.x + ow,     b.x + ow,     b.x + ow - bw,  0, 0],
              [nx + bw / 2, b.x + ow / 2, b.x + ow / 2, b.x + ow / 2 - bw / 2, 1, 0],
              // sit to the RIGHT of b, one gutter clear
              [nx, b.x + ow + GAP, b.x + ow, b.x + ow + GAP, 0, GAP],
              // sit to the LEFT of b, one gutter clear
              [nx + bw, b.x - GAP, b.x, b.x - GAP - bw, 0, GAP],
            ].forEach(([mine, theirs, guide, shift, rank, gap]) => {
              const d = Math.abs(mine - theirs)
              if (d < MAG) candX.push({ d, rank, shift, guide, gap, id: b.id, a: b.y, b: b.y + oh })
            })
          }

          if (overlapX) {
            ;[
              [ny,          b.y,          b.y,          b.y,            0, 0],
              [ny,          b.y + oh,     b.y + oh,     b.y + oh,       0, 0],
              [ny + bh,     b.y,          b.y,          b.y - bh,       0, 0],
              [ny + bh,     b.y + oh,     b.y + oh,     b.y + oh - bh,  0, 0],
              [ny + bh / 2, b.y + oh / 2, b.y + oh / 2, b.y + oh / 2 - bh / 2, 1, 0],
              [ny, b.y + oh + GAP, b.y + oh, b.y + oh + GAP, 0, GAP],
              [ny + bh, b.y - GAP, b.y, b.y - GAP - bh, 0, GAP],
            ].forEach(([mine, theirs, guide, shift, rank, gap]) => {
              const d = Math.abs(mine - theirs)
              if (d < MAG) candY.push({ d, rank, shift, guide, gap, id: b.id, a: b.x, b: b.x + ow })
            })
          }
        })

        /* Rank by distance, with edge-to-edge given a small handicap rather
           than absolute priority. Sorting on rank first (as a naive
           implementation does) means an edge alignment 28px away beats a
           centre alignment 0.5px away — you'd be sitting dead-centre and get
           yanked sideways. The bonus only decides near-ties. */
        const EDGE_BONUS = 4 / z
        const score = p => p.d - (p.rank === 0 ? EDGE_BONUS : 0)
        const byRank = (p, q) => score(p) - score(q)
        candX.sort(byRank)
        candY.sort(byRank)

        const lines = []
        const hitIds = new Set()
        const bestX = candX[0]
        const bestY = candY[0]

        if (bestX) {
          const s = pull(bestX.d)
          if (s > 0) {
            nx = nx + (bestX.shift - nx) * s
            if (bestX.d <= RAD) { nx = bestX.shift; hitIds.add(bestX.id) }
            lines.push({
              key: `v${Math.round(bestX.guide)}`, t: 'v', p: bestX.guide,
              locked: bestX.d <= RAD, strength: s, gap: bestX.gap,
              // Where the gutter badge sits, when this is a gap target.
              gapAt: bestX.gap ? { from: Math.min(bestX.guide, nx + bw), to: Math.max(bestX.guide, nx), at: ny + bh / 2 } : null,
            })
          }
        }
        if (bestY) {
          const s = pull(bestY.d)
          if (s > 0) {
            ny = ny + (bestY.shift - ny) * s
            if (bestY.d <= RAD) { ny = bestY.shift; hitIds.add(bestY.id) }
            lines.push({
              key: `h${Math.round(bestY.guide)}`, t: 'h', p: bestY.guide,
              locked: bestY.d <= RAD, strength: s, gap: bestY.gap,
              gapAt: bestY.gap ? { from: Math.min(bestY.guide, ny + bh), to: Math.max(bestY.guide, ny), at: nx + bw / 2 } : null,
            })
          }
        }

        /* Equal-spacing detection. If the gap to the nearest block on the left
           matches the gap to the nearest on the right, badge both gaps — the
           cue Figma uses to tell you a row is evenly distributed. */
        const tags = []
        const tol = SPACING_TOL / z
        const midY = ny + bh / 2
        const rowMates = neighbours.filter(b => midY > b.y && midY < b.y + b.h)
        const leftOf = rowMates.filter(b => b.x + b.w <= nx).sort((p, q) => (nx - p.x - p.w) - (nx - q.x - q.w))[0]
        const rightOf = rowMates.filter(b => b.x >= nx + bw).sort((p, q) => (p.x - nx - bw) - (q.x - nx - bw))[0]
        if (leftOf && rightOf) {
          const gl = nx - (leftOf.x + leftOf.w)
          const gr = rightOf.x - (nx + bw)
          if (Math.abs(gl - gr) < tol && gl > 2) {
            tags.push({ key: 'sl', x: leftOf.x + leftOf.w, y: midY, w: gl, label: Math.round(gl) })
            tags.push({ key: 'sr', x: nx + bw, y: midY, w: gr, label: Math.round(gr) })
          }
        }

        // Only write state when something actually changed — this handler runs
        // on every mousemove and each setState here costs a full render.
        const sig = lines.map(l =>
          `${l.key}:${l.locked}:${l.strength.toFixed(2)}:${l.gapAt ? Math.round(l.gapAt.at) : ''}`
        ).join('|')
        if (sig !== lastSnapSig.current) {
          lastSnapSig.current = sig
          setSnapLines(lines)
          setSnapTargets([...hitIds])
        }
        const tsig = tags.map(t => `${t.key}:${t.label}`).join('|')
        if (tsig !== lastSpacingSig.current) {
          lastSpacingSig.current = tsig
          setSpacingTags(tags)
        }
      } else if (lastSnapSig.current !== '') {
        lastSnapSig.current = ''
        lastSpacingSig.current = ''
        setSnapLines([])
        setSnapTargets([])
        setSpacingTags([])
      }

      target.x = nx; target.y = ny
      startEase()
      startEdgePan()

      // Section containment only applies to a single non-section block; a
      // multi-selection shouldn't silently re-parent everything it passes over.
      if (block.type === 'section' || childOffsets.length > 0) {
        // travellers follow the eased parent, applied inside the ease loop
      } else {
        // Live containment detection based on CURSOR position (not block center)
        const rect = containerRef.current.getBoundingClientRect()
        const bzoom = window.visualViewport?.scale || 1
        const cx = ((ev.clientX - rect.left) / bzoom - panRef.current.x) / z
        const cy = ((ev.clientY - rect.top) / bzoom - panRef.current.y) / z
        let hit = null
        blocks.forEach(s => {
          if (s.type !== 'section' || s.id === block.id) return
          const { w: sw, h: sh } = blockDims(s)
          if (cx >= s.x && cx <= s.x + sw && cy >= s.y && cy <= s.y + sh) hit = s.id
        })
        if (hit !== currentHoverSection) {
          currentHoverSection = hit
          setHoverSectionId(hit)
        }
      }
    }
    function onUp(ev) {
      stopEdgePan()
      lastSnapSig.current = ''
      lastSpacingSig.current = ''
      setSnapLines([])
      setSnapTargets([])
      setSpacingTags([])
      setHoverSectionId(null)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)

      // Let the block settle onto its final position rather than stopping
      // dead, then drop the "lifted" styling once it's home.
      releasing = true
      startEase()
      const settle = setInterval(() => {
        if (raf == null) { clearInterval(settle); setDraggingBlockId(null) }
      }, 40)
      setTimeout(() => { clearInterval(settle); setDraggingBlockId(null) }, 600)

      if (dragging && block.type !== 'section') {
        const nextParent = currentHoverSection
        if (nextParent !== (block.parentSectionId || null)) {
          onUpdateBlock(block.id, { parentSectionId: nextParent })
        }
        // Resize the owning section around its children once the block has
        // landed. `target` holds the final position; `block` in this closure
        // still has the pre-drag one, so pass it through explicitly.
        const owner = nextParent || block.parentSectionId
        if (owner) {
          const landed = { [block.id]: { x: target.x, y: target.y } }
          setTimeout(() => growSectionToFit(owner, landed), 0)
        }
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /* Rubber-band selection. Press on empty canvas and drag a rectangle; every
     block it touches is selected on release. Shift adds to the existing
     selection instead of replacing it.

     Uses an intersection test rather than full containment — requiring a block
     to be entirely inside the box means you can't lasso a row of wide tables
     without scrolling out first, which is the thing you were trying to avoid. */
  const marqueeRef = useRef(null)
  function startMarquee(e) {
    if (e.button !== 0) return
    if (e.target !== e.currentTarget) return   // only on bare canvas
    if (drawMode || cropping || mindMapMode) return

    const origin = getCanvasPoint(e)
    const additive = e.shiftKey
    const base = additive ? new Set(selectedIds) : new Set()
    let live = false
    marqueeRef.current = { moved: false }

    function onMove(ev) {
      const p = getCanvasPoint(ev)
      if (!live) {
        // 4px dead zone so a plain click doesn't flash a marquee.
        if (Math.abs(ev.clientX - e.clientX) < 4 && Math.abs(ev.clientY - e.clientY) < 4) return
        live = true
        marqueeRef.current.moved = true
      }
      const rect = {
        x: Math.min(origin.x, p.x), y: Math.min(origin.y, p.y),
        w: Math.abs(p.x - origin.x), h: Math.abs(p.y - origin.y),
      }
      setMarquee(rect)

      const hit = new Set(base)
      blocks.forEach(b => {
        const { w, h } = blockDims(b)
        const overlaps = b.x < rect.x + rect.w && b.x + w > rect.x &&
                         b.y < rect.y + rect.h && b.y + h > rect.y
        if (overlaps) hit.add(b.id)
      })
      setSelectedIds(hit)
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setMarquee(null)
      // Tell handleBgClick to stand down, so a drag doesn't also create a block.
      if (marqueeRef.current?.moved) suppressNextBgClickRef.current = true
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function startPan(e) {
    if (e.button !== 2) return
    if (selectionLockRef.current) return   // frozen while a block is selected
    stopPanAnim()
    e.preventDefault()
    const startX = e.clientX - panRef.current.x
    const startY = e.clientY - panRef.current.y
    function onMove(ev) {
      const nx = ev.clientX - startX
      const ny = ev.clientY - startY
      panRef.current = { x: nx, y: ny }
      setPan({ x: nx, y: ny })
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const MIN_W = 200, MIN_H = 100

  /* Directional resize. `dir` is any combination of n/s/e/w.
     Dragging a north or west handle has to move x/y as well as w/h, otherwise
     the opposite edge walks across the canvas and the block appears to slide
     while you resize it. */
  function startResize(e, block, dir = 'se') {
    e.stopPropagation()
    e.preventDefault()

    const startX = e.clientX
    const startY = e.clientY
    const { w: baseW, h: baseH } = blockDims(block)
    const baseX = block.x, baseY = block.y

    function onMove(ev) {
      const z = nbZoomRef.current
      const dx = (ev.clientX - startX) / z
      const dy = (ev.clientY - startY) / z
      let w = baseW, h = baseH, x = baseX, y = baseY

      if (dir.includes('e')) w = Math.max(MIN_W, baseW + dx)
      if (dir.includes('s')) h = Math.max(MIN_H, baseH + dy)
      if (dir.includes('w')) { w = Math.max(MIN_W, baseW - dx); x = baseX + (baseW - w) }
      if (dir.includes('n')) { h = Math.max(MIN_H, baseH - dy); y = baseY + (baseH - h) }

      onUpdateBlock(block.id, { w, h, x, y })
      setResizing({ id: block.id, w: Math.round(w), h: Math.round(h) })
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setResizing(null)
      if (block.parentSectionId) setTimeout(() => growSectionToFit(block.parentSectionId), 0)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /* Fit to screen — size the block to the visible canvas.
     The available area is the container minus the sidebar, the top island row
     and, when a contextual rail is showing, its width. Converted into canvas
     coordinates so it lands correctly at any pan or zoom. */
  const TOP_ROW_H = 78
  function fitBlockToScreen(block) {
    if (!block) return
    const PAD = 22
    const z = nbZoomRef.current
    const railW = (soleTableBlock || soleImageBlock) ? 160 : 16
    const leftPx = ROW_LEFT + PAD
    const topPx = TOP_ROW_H + PAD
    const rightPx = viewSize.w - railW - PAD
    const bottomPx = viewSize.h - PAD

    onUpdateBlock(block.id, {
      x: (leftPx - panRef.current.x) / z,
      y: (topPx - panRef.current.y) / z,
      w: Math.max(MIN_W, (rightPx - leftPx) / z),
      h: Math.max(MIN_H, (bottomPx - topPx) / z),
    })
    setCtxMenu(null)
  }

  /** Shrink a block to its natural content size. The inverse of fit-to-screen. */
  function resetBlockSize(block) {
    if (!block) return
    const natural = {
      table: { w: 520, h: 260 }, kanban: { w: 720, h: 280 },
      section: { w: 500, h: 350 }, image: { w: 360, h: 260 }, text: { w: 320, h: 150 },
    }[block.type] || { w: 320, h: 150 }
    // An image knows its own aspect ratio, so honour it.
    if (block.type === 'image' && block.natW && block.natH) {
      const w = Math.min(480, block.natW)
      natural.w = w
      natural.h = Math.round((block.natH / block.natW) * w) + 30
    }
    onUpdateBlock(block.id, natural)
    setCtxMenu(null)
  }

  function startSheetRename() {
    if (!activeSheet) return
    setSheetLabel(activeSheet.name)
    setRenamingSheet(true)
  }
  /* Fullscreen the DOCUMENT, not just the canvas element. Fullscreening
     outerRef put the sidebar outside the fullscreen subtree, so it vanished
     and file-import clicks landed on a non-rendered element. */
  function togglePresentation() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().then(() => setIsPresentation(true)).catch(() => {})
    } else {
      document.exitFullscreen?.().then(() => setIsPresentation(false)).catch(() => {})
    }
  }
  function commitSheetRename() {
    if (activeSheet && onRenameSheet) {
      onRenameSheet(activeSheet.id, sheetLabel || activeSheet.name)
    }
    setRenamingSheet(false)
  }
  // Connection port dots on hovered/selected blocks
  /* Drag a link out of a port. This is what turns mind map from a visual
     trick into a working tool: the port dots used to be decorative, and the
     only way to connect anything was to enter a modal mode and click two
     blocks in the right order. Now you pull a wire, like Figma prototype
     links or Miro connectors — and the old mode still works alongside it. */
  function startLink(e, blockId, side) {
    e.preventDefault(); e.stopPropagation()
    const pt = getCanvasPoint(e)
    const state = { fromId: blockId, fromSide: side, x: pt.x, y: pt.y, overId: null }
    linkingRef.current = state
    setLinking(state)

    function resolveTarget(ev) {
      const el = document.elementFromPoint(ev.clientX, ev.clientY)
      const host = el?.closest?.('[data-block-id]')
      const id = host?.getAttribute('data-block-id')
      return id && id !== blockId ? id : null
    }
    function onMove(ev) {
      const p = getCanvasPoint(ev)
      const next = { ...linkingRef.current, x: p.x, y: p.y, overId: resolveTarget(ev) }
      linkingRef.current = next
      setLinking(next)
    }
    function onUp(ev) {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const targetId = resolveTarget(ev)
      if (targetId) addConnection(blockId, targetId)
      linkingRef.current = null
      setLinking(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function Ports({ show, blockId }) {
    if (!show) return null
    const p = (pos) => ({
      position: 'absolute', ...pos, width: 9, height: 9, borderRadius: '50%',
      background: surface, border: `2px solid ${accent}`, zIndex: 30,
      transition: 'transform 0.15s ease, background 0.15s ease, opacity 0.15s ease',
      opacity: 0.75, cursor: 'crosshair',
    })
    const hov = {
      onMouseEnter: e => { e.currentTarget.style.transform = 'scale(1.5)'; e.currentTarget.style.background = accent; e.currentTarget.style.opacity = '1' },
      onMouseLeave: e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = surface; e.currentTarget.style.opacity = '0.75' },
    }
    const sides = [
      ['top',    { top: -5, left: '50%', marginLeft: -4.5 }],
      ['bottom', { bottom: -5, left: '50%', marginLeft: -4.5 }],
      ['left',   { top: '50%', left: -5, marginTop: -4.5 }],
      ['right',  { top: '50%', right: -5, marginTop: -4.5 }],
    ]
    return (<>
      {sides.map(([side, pos]) => (
        <div key={side} style={p(pos)} {...hov} title="Drag to connect"
          onMouseDown={e => startLink(e, blockId, side)} />
      ))}
    </>)
  }
  /* Walks up from the wheel event target looking for an element that can
     actually scroll in the requested direction. Returns true if one exists,
     in which case the canvas must NOT preventDefault or pan. */
  function canScrollNatively(target, deltaY, deltaX) {
    let el = target
    while (el && el !== containerRef.current) {
      if (el.nodeType === 1) {
        const style = window.getComputedStyle(el)
        const oy = style.overflowY, ox = style.overflowX
        const scrollableY = (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1
        const scrollableX = (ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1
        if (scrollableY && deltaY !== 0) {
          const atTop = el.scrollTop <= 0
          const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
          if (!(deltaY < 0 && atTop) && !(deltaY > 0 && atBottom)) return true
        }
        if (scrollableX && deltaX !== 0) {
          const atLeft = el.scrollLeft <= 0
          const atRight = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
          if (!(deltaX < 0 && atLeft) && !(deltaX > 0 && atRight)) return true
        }
      }
      el = el.parentNode
    }
    return false
  }

// Scroll-wheel pans the notebook canvas
  // Scroll-wheel: pan + Ctrl+scroll: zoom (rAF-throttled)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let rafId = null
    function flush() {
      rafId = null
      setPan({ ...panRef.current })
      setNbZoom(nbZoomRef.current)
    }
    function schedule() { if (rafId == null) rafId = requestAnimationFrame(flush) }
    function handleWheel(e) {
      // Let a scrollable region inside a block (e.g. a table's overflow:auto
      // wrapper) consume the scroll before the canvas pans. Without this the
      // canvas swallowed every wheel event and tables could never scroll.
      if (!e.ctrlKey && !e.metaKey && canScrollNatively(e.target, e.deltaY, e.deltaX)) return
      // Viewport lock. While a block is selected the canvas is frozen: the
      // world around what you're working on must not drift, and a stray
      // trackpad gesture must not throw the block off screen. Deselect (Esc,
      // or click the background) to move the canvas again.
      if (selectionLockRef.current) return
      stopPanAnim()   // a manual gesture always wins over an in-flight camera move
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        const mx = e.clientX - rect.left, my = e.clientY - rect.top
        const oldZ = nbZoomRef.current
        const newZ = Math.min(3, Math.max(0.25, oldZ - e.deltaY * 0.002))
        const ratio = newZ / oldZ
        panRef.current = { x: mx - (mx - panRef.current.x) * ratio, y: my - (my - panRef.current.y) * ratio }
        nbZoomRef.current = newZ
      } else {
        panRef.current = { x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY }
      }
      schedule()
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => { el.removeEventListener('wheel', handleWheel); if (rafId) cancelAnimationFrame(rafId) }
  }, [])
  function getCanvasPoint(e) {
    const rect = containerRef.current.getBoundingClientRect()
    const bzoom = window.visualViewport?.scale || 1
    const z = nbZoomRef.current
    return {
      x: ((e.clientX - rect.left) / bzoom - panRef.current.x) / z,
      y: ((e.clientY - rect.top) / bzoom - panRef.current.y) / z,
    }
  }

  function handleDrawMouseDown(e) {
    if (!drawMode || e.button !== 0) return
    if (e.target.closest('button,input,textarea')) return
    e.stopPropagation()
    isDrawing.current = true
    const pt = getCanvasPoint(e)
    const newPath = {
      id: `draw_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      color: drawColor,
      size: drawSize,
      points: [pt],
    }
    setCurrentPath(newPath)
  }

  function handleDrawMouseMove(e) {
    if (!drawMode || !isDrawing.current || !currentPath) return
    const pt = getCanvasPoint(e)
    setCurrentPath(prev => prev ? { ...prev, points: [...prev.points, pt] } : null)
  }

  function handleDrawMouseUp() {
    if (!isDrawing.current) return
    isDrawing.current = false
    if (currentPath && currentPath.points.length > 1) {
      onAddDrawing(currentPath)
    }
    setCurrentPath(null)
  }

  function undoLastDrawing() {
    if (drawings.length === 0) return
    onDeleteDrawing(drawings[drawings.length - 1].id)
  }

  function clearAllDrawings() {
    if (drawings.length === 0) return
    if (window.confirm('Clear all drawings?')) onClearDrawings()
  }

  function pointsToPath(points) {
    if (!points || points.length < 2) return ''
    let d = `M ${points[0].x} ${points[0].y}`
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]
      const curr = points[i]
      const mx = (prev.x + curr.x) / 2
      const my = (prev.y + curr.y) / 2
      d += ` Q ${prev.x} ${prev.y} ${mx} ${my}`
    }
    d += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`
    return d
  }

  return (
    <div ref={outerRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'var(--ds-font-body)', background: dark ? '#131311' : '#E4E1D9' }}>
    {/* ── Floating Island ── */}
      {/* Title island — notebook identity plus the view controls.
          The overlap was arithmetic: with left:292 and maxWidth
          calc(50vw - 320px) this island's right edge landed at 50vw - 28,
          while the centred toolbar reaches ~270px LEFT of centre, so they
          were always going to collide — the Export button just made it
          visible. The max width now reserves half the toolbar plus a gutter,
          and the notebook name flexes and truncates instead of pushing the
          island wider. */}
      {/* Three equal-fraction columns spanning the full viewport, so the middle
          one sits at TRUE screen centre. The flex version centred the toolbar
          in the space left over after the title island, which drifted right as
          the notebook name got longer. Padding lives inside the outer cells, so
          it clears the sidebar and profile island without shifting the centre. */}
      <div ref={topRowRef} data-kbd-zone style={{ position: 'absolute', top: 16, left: 0, right: 0, zIndex: 100, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'start', pointerEvents: 'none' }}>
      <div style={{ minWidth: 0, paddingLeft: ROW_LEFT, paddingRight: 16, display: 'flex', justifyContent: 'flex-start', overflow: 'hidden' }}>

      <div style={{ flex: '0 1 auto', minWidth: 0, pointerEvents: 'auto', display: 'flex', gap: 2, height: 46, padding: '0 12px', overflow: 'hidden', background: `${surface}dd`, backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderRadius: 12, border: `1px solid ${border}`, boxShadow: `0 4px 24px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.08)'}`, fontFamily: 'var(--ds-font-body)', alignItems: 'center' }}>
        {renamingNb ? (
          <input autoFocus value={nbLabel} onChange={e => setNbLabel(e.target.value)} onBlur={() => { onRenameNotebook(nbLabel || nb.name); setRenamingNb(false) }} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }} maxLength={40} style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${accent}`, color: text, fontFamily: 'var(--ds-font-head)', fontSize: 13, fontWeight: 700, outline: 'none', minWidth: 100, maxWidth: 200 }} />
        ) : (
          <span onDoubleClick={() => setRenamingNb(true)} title={nb.name}
            style={{ fontFamily: 'var(--ds-font-head)', fontSize: 15, fontWeight: 700, color: text, cursor: 'text', marginRight: 6, flex: '1 1 auto', minWidth: 0, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nb.name}</span>
        )}
        {activeSheet && !renamingSheet && (
          <span onDoubleClick={() => { setSheetLabel(activeSheet.name); setRenamingSheet(true) }}
            title={`${activeSheet.name || 'Sheet 1'} · ${blocks.length} blocks`}
            style={{ fontSize: 11, color: text3, cursor: 'text', marginRight: 6, flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            · {activeSheet.name || 'Sheet 1'} · {blocks.length} block{blocks.length !== 1 ? 's' : ''}
          </span>
        )}
        {renamingSheet && (
          <input autoFocus value={sheetLabel} onChange={e => setSheetLabel(e.target.value)} onBlur={commitSheetRename} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }} style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${accent}`, color: text2, fontSize: 10, outline: 'none', minWidth: 60, marginRight: 4 }} />
        )}

        <div style={{ width: 1, height: 22, background: border, margin: '0 8px', flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: text3, fontFamily: 'var(--ds-font-body)', fontVariantNumeric: 'tabular-nums', padding: '0 4px', cursor: 'pointer', flexShrink: 0 }}
          onClick={() => { nbZoomRef.current = 1; setNbZoom(1); panRef.current = { x: 60, y: 60 }; setPan({ x: 60, y: 60 }) }}
          title="Click to reset the view">{Math.round(nbZoom * 100)}%</span>

        {/* Lock state. Text only — the padlock glyph is gone, but the state
            itself still needs saying, because pan and zoom really are frozen
            and there'd otherwise be nothing explaining why. */}
        {selectedIds.size > 0 && (
          <span title="Canvas is frozen while a block is selected — press Esc to release"
            style={{ fontSize: 9, color: accent, background: accentDim, padding: '3px 7px', borderRadius: 4, fontFamily: 'var(--ds-font-mono)', letterSpacing: 0.6, flexShrink: 0, marginLeft: 6, whiteSpace: 'nowrap' }}>
            LOCKED
          </span>
        )}

        <button onClick={togglePresentation} className="ds-tbtn" style={{ flexShrink: 0, marginLeft: 6 }}
          title={isPresentation ? 'Leave full screen' : 'Full screen'}>
          {isPresentation ? 'Exit' : 'Full Screen'}
        </button>
      </div>

      </div>

      {/* ── Floating Island Toolbar — centre column, so it's screen-centred ── */}
      <div style={{ pointerEvents: 'auto', display: 'flex', gap: 5, height: 46, padding: '0 10px', background: `${surface}ee`, backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderRadius: 12, border: `1px solid ${border}`, boxShadow: `0 4px 24px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.1)'}`, fontFamily: 'var(--ds-font-body)', alignItems: 'center' }}>
        {/* Add block dropdown */}
        <div ref={addMenuRef} style={{ position: 'relative' }}>
          <button onClick={() => setAddMenuOpen(!addMenuOpen)}
            className={`ds-tbtn${addMenuOpen ? ' is-on' : ''}`}>
            Add
          </button>
          {addMenuOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, background: surface, border: `1px solid ${border}`, borderRadius: 8, boxShadow: `0 8px 24px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.15)'}`, overflow: 'hidden', minWidth: 140, zIndex: 200 }}>
              {ADD_ITEMS.map(({ type, label }) => (
                <button key={type} onClick={() => {
                  setAddMenuOpen(false)
                  // Image goes straight to the file picker. Creating an empty
                  // image block first would leave a placeholder on the canvas
                  // that does nothing until you find another way to fill it.
                  if (type === 'image') { onPickImage?.(); return }
                  const z = nbZoomRef.current
                  addBlockAnimated(type, (200 - panRef.current.x) / z + Math.random() * 40, (120 - panRef.current.y) / z + Math.random() * 30)
                }}
                  style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '8px 12px', background: 'none', border: 'none', color: text2, fontSize: 12, fontFamily: 'var(--ds-font-body)', cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = text }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = text2 }}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ width: 1, height: 22, background: border, margin: '0 4px' }} />

        <button onClick={toggleSnap}
          title={snapEnabled ? 'Magnetic alignment: on · hold Alt while dragging to suspend' : 'Magnetic alignment: off'}
          className={`ds-tbtn${snapEnabled ? ' is-on' : ''}`}>
          Snap
        </button>

        {/* Crosscheck moved to the sheet rail. It only ever operates on table
            columns, so a global toolbar slot advertised it on canvases where
            it could do nothing — and it was the widest button in the row. */}

        <div style={{ width: 1, height: 22, background: border, margin: '0 4px' }} />

        <button onClick={toggleMindMap} className={`ds-tbtn${mindMapMode ? ' is-on' : ''}`}
          title={mindMapMode ? 'Exit mind map mode' : 'Click master then slave to connect'}>
          Mind map
        </button>

       <div style={{ width: 1, height: 22, background: border, margin: '0 4px' }} />

        <div ref={drawPanelRef} style={{ position: 'relative' }}
          onMouseEnter={() => setShowDrawPanel(true)}
          onMouseLeave={() => setShowDrawPanel(false)}>
          <button onClick={() => setDrawMode(v => !v)}
            className={`ds-tbtn${drawMode ? ' is-on' : ''}`}
            title={drawMode ? 'Turn drawing off' : 'Draw on the canvas · hover for options'}>
            Draw
          </button>
          {showDrawPanel && (
            <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, background: surface, border: `1px solid ${border}`, borderRadius: 10, padding: '10px 12px', boxShadow: `0 8px 24px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.15)'}`, zIndex: 200, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: 10, color: text3, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, fontWeight: 600 }}>Color</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['#5B5FE8', '#1D9E75', '#f87171', '#E8B85B', '#E8E6E1'].map(c => (
                    <div key={c} onClick={() => setDrawColor(c)}
                      style={{ width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer', border: drawColor === c ? `2px solid ${text}` : `2px solid transparent`, transition: 'border 0.1s', flexShrink: 0 }} />
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: text3, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, fontWeight: 600 }}>Size</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {[2, 4, 8].map(s => (
                    <div key={s} onClick={() => setDrawSize(s)}
                      style={{ width: 28, height: 28, borderRadius: 6, background: drawSize === s ? accentDim : raised, border: `1px solid ${drawSize === s ? accent : border}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: Math.min(s * 2.5, 20), height: s === 2 ? 1.5 : s === 4 ? 3 : 5, background: drawColor, borderRadius: 4 }} />
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, borderTop: `1px solid ${border}`, paddingTop: 8 }}>
                <button onClick={undoLastDrawing}
                  style={{ flex: 1, padding: '5px 0', background: raised, border: `1px solid ${border}`, borderRadius: 6, color: text2, fontSize: 11, cursor: 'pointer', fontFamily: 'var(--ds-font-body)' }}>
                  ↩ Undo
                </button>
                <button onClick={clearAllDrawings}
                  style={{ flex: 1, padding: '5px 0', background: raised, border: `1px solid ${border}`, borderRadius: 6, color: text2, fontSize: 11, cursor: 'pointer', fontFamily: 'var(--ds-font-body)' }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.borderColor = '#f87171' }}
                  onMouseLeave={e => { e.currentTarget.style.color = text2; e.currentTarget.style.borderColor = border }}>
                  🗑 Clear
                </button>
                <button onClick={() => { setDrawMode(false); setShowDrawPanel(false) }}
                  style={{ flex: 1, padding: '5px 0', background: raised, border: `1px solid ${border}`, borderRadius: 6, color: text2, fontSize: 11, cursor: 'pointer', fontFamily: 'var(--ds-font-body)' }}>
                  ✕ Exit
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={{ width: 1, height: 22, background: border, margin: '0 4px' }} />

        <button onClick={() => setExportOpen(true)} className="ds-tbtn"
          title="Export this sheet, or just the selected blocks">
          Export
        </button>

      </div>

      {/* Right column — empty, but it must exist and be the same fraction as
          the left one, or the centre column stops being centred. Padding
          reserves room for the profile island AppPage renders at right:16. */}
      <div style={{ minWidth: 0, paddingRight: ROW_RIGHT }} />
      </div>{/* end top row */}

      {/* Contextual sheet toolbar — only when exactly one table block is
          selected, so it can't be ambiguous which sheet a tool would act on. */}
      {soleTableBlock && !mindMapMode && !drawMode && (
        <SheetToolbar
          block={soleTableBlock}
          dark={dark}
          colors={colors}
          activeTool={sheetTool}
          onOpenTool={id => (id === 'crosscheck' ? onOpenCrosscheck?.() : setSheetTool(id))}
        />
      )}

      {soleImageBlock && !mindMapMode && !drawMode && (
        <ImageToolbar
          block={soleImageBlock}
          dark={dark}
          colors={colors}
          onUpdateBlock={onUpdateBlock}
          cropping={cropping}
          pendingCrop={pendingCrop}
          onStartCrop={() => { setCropping(true); setPendingCrop(null) }}
          onCancelCrop={() => { setCropping(false); setPendingCrop(null) }}
        />
      )}

      <ExportPanel
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        blocks={blocks}
        selectedIds={selectedIds}
        notebookName={nb.name}
        sheetName={activeSheet?.name}
        dark={dark}
        onUpdateBlock={onUpdateBlock}
      />

      <CurveFitPanel
        open={sheetTool === 'curvefit' && !!soleTableBlock}
        onClose={() => setSheetTool(null)}
        block={soleTableBlock}
        tables={blocks.filter(b => b.type === 'table')}
        onWriteToTable={(id, patch) => onUpdateBlock(id, patch)}
        onAddResultTable={({ headers, rows }) => {
          const src = soleTableBlock
          const { w } = blockDims(src)
          onAddBlock('table', src.x + w + 40, src.y, headers, rows, 380, 300, {
            name: `${src.name || 'Table'} — fit`,
          })
          setSheetTool(null)
        }}
      />

      {/* A mode that swallows the arrow keys without saying so is
          indistinguishable from the app being broken. */}
      {kbMode && (
        <div role="status" aria-live="polite" style={{
          position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)',
          zIndex: 150, display: 'flex', alignItems: 'center', gap: 10,
          padding: '7px 14px', borderRadius: 9,
          background: accentDim, border: `1px solid ${accent}`,
          color: accent, fontFamily: 'var(--ds-font-body)', fontSize: 12, fontWeight: 600,
          boxShadow: `0 4px 20px ${dark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.1)'}`,
        }}>
          <span>
            {kbMode === 'toolbar' ? 'Toolbar' : kbMode === 'grab' ? 'Moving block' : 'Keyboard'}
          </span>
          <span style={{ fontSize: 10.5, fontWeight: 400, opacity: 0.85, fontFamily: 'var(--ds-font-mono)' }}>
            {kbMode === 'toolbar'
              ? 'tab or ← → to choose · enter to use · esc to go back'
              : kbMode === 'grab'
              ? 'arrows to move · shift = 10px · enter to place · esc to cancel'
              : 'arrows to move between blocks · enter to edit · tab for the toolbar · esc to exit'}
          </span>
        </div>
      )}

      {shortcutsOpen && (
        <>
          <div onMouseDown={() => setShortcutsOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 940, background: 'rgba(0,0,0,0.35)' }} />
          <div role="dialog" aria-label="Keyboard shortcuts" className="ds-island"
            style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 950, width: 520, maxWidth: 'calc(100vw - 32px)', maxHeight: '80vh', overflowY: 'auto', padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontFamily: 'var(--ds-font-head)', fontSize: 14, fontWeight: 700, flex: 1 }}>Keyboard shortcuts</span>
              <button onClick={() => setShortcutsOpen(false)} aria-label="Close"
                style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 16, padding: 2 }}>×</button>
            </div>
            {SHORTCUT_GROUPS.map(({ title, note, rows }) => (
              <div key={title} style={{ marginBottom: 14 }}>
                <div className="ds-label" style={{ marginBottom: 4 }}>{title}</div>
                {note && <div style={{ fontSize: 10.5, color: text3, marginBottom: 6 }}>{note}</div>}
                {rows.map(([k, d]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '3px 0', fontSize: 12 }}>
                    <span style={{ flex: '0 0 148px', fontFamily: 'var(--ds-font-mono)', fontSize: 10.5, color: accent }}>{k}</span>
                    <span style={{ color: text2 }}>{d}</span>
                  </div>
                ))}
              </div>
            ))}
            <div style={{ fontSize: 10.5, color: text3, borderTop: `1px solid ${border}`, paddingTop: 9 }}>
              Press <b style={{ color: text2 }}>?</b> any time to reopen this.
            </div>
          </div>
        </>
      )}

      {mindMapMode && (
        <div style={{ position: 'absolute', top: 120, left: '50%', transform: 'translateX(-50%)', zIndex: 150, padding: '8px 16px', background: accentDim, border: `1px solid ${accent}`, borderRadius: 8, boxShadow: `0 4px 20px ${dark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.1)'}`, fontFamily: 'var(--ds-font-body)', fontSize: 12, color: accent, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>⟋</span>
          <span>{mindMapMaster ? 'Now click the target block · Esc to finish' : 'Click a source block — or just drag from any block’s port dot'}</span>
          <button onClick={() => { setMindMapMode(false); setMindMapMaster(null) }} style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1, opacity: 0.7 }}>✕</button>
        </div>
      )}
      {ctxMenu && (() => {
        const singleBlockId = selectedIds.size === 1 ? Array.from(selectedIds)[0] : null
        const singleConns = singleBlockId ? getBlockConnections(singleBlockId) : []
        return (
        <div ref={ctxMenuRef} style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 300, background: surface, border: `1px solid ${border}`, borderRadius: 8, boxShadow: `0 8px 24px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.15)'}`, overflow: 'hidden', minWidth: 170, fontFamily: 'var(--ds-font-body)' }}>
          {[
            // Sizing acts on one block; with a multi-selection there's no
            // sensible single target, so these drop out.
            ...(soleSelected ? [
              { label: 'Fit to screen', icon: '⤢', color: text2, action: () => fitBlockToScreen(soleSelected) },
              { label: 'Reset size', icon: '⤡', color: text2, action: () => resetBlockSize(soleSelected) },
            ] : []),
            { label: `Duplicate (${selectedIds.size})`, icon: '⊕', color: text2, action: duplicateSelected },
            { label: `Delete (${selectedIds.size})`, icon: '✕', color: red, action: deleteSelected },
          ].map((item, i) => (
            <button key={i} onClick={item.action}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', background: 'none', border: 'none', color: item.color, fontSize: 12, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--ds-font-body)' }}
              onMouseEnter={e => e.currentTarget.style.background = raised} onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              <span style={{ width: 16, textAlign: 'center' }}>{item.icon}</span>{item.label}
            </button>
          ))}
          {singleConns.length > 0 && (<>
            <div style={{ borderTop: `1px solid ${border}`, margin: '2px 0' }} />
            <div style={{ padding: '6px 12px 2px', fontSize: 10, color: text3, fontFamily: 'var(--ds-font-mono)', textTransform: 'uppercase', letterSpacing: 1 }}>Delete mind map</div>
            {singleConns.map(conn => {
              const otherId = conn.fromBlockId === singleBlockId ? conn.toBlockId : conn.fromBlockId
              const other = blocks.find(b => b.id === otherId)
              const label = other?.name || (other?.type === 'text' ? (other?.content || '').replace(/<[^>]*>/g,'').slice(0,24) : '') || other?.type || 'block'
              const arrow = conn.fromBlockId === singleBlockId ? '→' : '←'
              return (
                <button key={conn.id} onClick={() => { deleteConnection(conn.id); setCtxMenu(null) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 12px', background: 'none', border: 'none', color: text2, fontSize: 12, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--ds-font-body)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = red }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = text2 }}>
                  <span style={{ width: 16, textAlign: 'center', color: accent }}>{arrow}</span>{label}
                </button>
              )
            })}
          </>)}
        </div>
        )
      })()}
<style>{`
        @keyframes dsBlockAppear {
          0% { opacity: 0; transform: scale(0.92) translateY(6px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes dsBlockDelete {
          0% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(0.92); }
        }
        /* Guides fade in once, on mount. Because each guide is keyed by axis +
           rounded position, React keeps the same node alive while you slide
           along an alignment, so this doesn't restart every frame. */
        @keyframes dsGuideIn {
          from { opacity: 0; }
          to   { opacity: inherit; }
        }
        .ds-guide { animation: dsGuideIn 0.13s ease-out both; }
        .ds-guide line, .ds-guide text { transition: opacity 0.1s linear; }
      `}</style>
      <div ref={containerRef} onClick={handleBgClick}
        /* Focusable, so the canvas can be reached with Tab and can receive
           keys without anything being selected. aria-label rather than a
           visible one: this is the application surface, not a widget. */
        tabIndex={0}
        role="application"
        aria-label="Notebook canvas. Press question mark for keyboard shortcuts."
        onFocus={() => setCanvasFocused(true)}
        onBlur={() => setCanvasFocused(false)}
        onMouseDown={e => { handleDrawMouseDown(e); startPan(e); startMarquee(e) }}
        onMouseMove={handleDrawMouseMove}
        onMouseUp={handleDrawMouseUp}
        onMouseLeave={handleDrawMouseUp}
        onContextMenu={e => {
          e.preventDefault()
          // Right-clicking empty canvas releases the selection, so the pan
          // gesture is available again immediately rather than silently
          // doing nothing while the viewport lock is engaged.
          if (e.target === e.currentTarget && selectedIds.size > 0) {
            setSelectedIds(new Set())
            setSelectedConnId(null)
          }
        }}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault()
          if (!onDropColumn) return
          // Must use the same screen->canvas transform as getCanvasPoint().
          // Previously this skipped the zoom divisor, so at any zoom other
          // than 100% the new block landed nowhere near the cursor.
          const pt = getCanvasPoint(e)
          onDropColumn(pt.x, pt.y)
        }}
        style={{
          flex: 1, position: 'relative', overflow: 'hidden',
          background: dark ? '#131311' : '#E4E1D9',
          cursor: 'crosshair', userSelect: 'none',
          // Inset ring while the canvas holds focus — without it a keyboard
          // user has no idea the arrows are about to do anything.
          outline: 'none',
          boxShadow: canvasFocused ? `inset 0 0 0 2px ${accent}55` : 'none',
          transition: 'box-shadow .15s ease',
        }}>
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          <defs>
            <filter id="nb-dot-soft" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation={0.55 * nbZoom} />
            </filter>
            <pattern id="nb-dots" x={pan.x % (32 * nbZoom)} y={pan.y % (32 * nbZoom)} width={32 * nbZoom} height={32 * nbZoom} patternUnits="userSpaceOnUse">
              <circle cx={nbZoom} cy={nbZoom} r={nbZoom} fill={dark ? '#3a3835' : '#C0BCB2'} filter="url(#nb-dot-soft)" opacity={dark ? 0.45 : 0.4} />
            </pattern>
            {/* Faint alignment grid, shown only while snap is armed so the
                canvas stays clean the rest of the time. */}
            <pattern id="nb-grid" x={pan.x % (32 * nbZoom)} y={pan.y % (32 * nbZoom)} width={32 * nbZoom} height={32 * nbZoom} patternUnits="userSpaceOnUse">
              <path d={`M ${32 * nbZoom} 0 L 0 0 0 ${32 * nbZoom}`} fill="none"
                stroke={dark ? '#ffffff' : '#000000'} strokeWidth={1} opacity={dark ? 0.045 : 0.05} />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#nb-dots)" />
          <rect width="100%" height="100%" fill="url(#nb-grid)"
            style={{ opacity: snapEnabled ? 1 : 0, transition: 'opacity 0.25s ease' }} />
        </svg>
        <div style={{ position: 'absolute', top: 0, left: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${nbZoom})`, transformOrigin: '0 0' }}>
          {marquee && (
            <div style={{
              position: 'absolute', left: marquee.x, top: marquee.y,
              width: marquee.w, height: marquee.h,
              border: `1px solid ${accent}`, background: `${accent}1a`,
              borderRadius: 2, pointerEvents: 'none', zIndex: 45,
            }} />
          )}

          {/* Live measurements while resizing. Pinned to the block's
              bottom-right so it never covers the edge being dragged. */}
          {resizing && (() => {
            const b = blocks.find(x => x.id === resizing.id)
            if (!b) return null
            const { w, h } = blockDims(b)
            return (
              <div style={{
                position: 'absolute', left: b.x + w, top: b.y + h,
                transform: `scale(${1 / nbZoom})`, transformOrigin: '0 0',
                marginLeft: 8, marginTop: 6, zIndex: 60, pointerEvents: 'none',
                background: accent, color: '#fff', borderRadius: 5,
                padding: '3px 7px', fontSize: 10.5, fontWeight: 600,
                fontFamily: 'var(--ds-font-mono)', whiteSpace: 'nowrap',
                boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
              }}>
                {resizing.w} × {resizing.h}
              </div>
            )
          })()}

          {(snapLines.length > 0 || spacingTags.length > 0) && (
            <svg style={{ position:'absolute', top:-3000, left:-3000, width:9000, height:9000, pointerEvents:'none', zIndex:50, overflow:'visible' }}>
              {snapLines.map(l => {
                /* Guides run the full width/height of the visible workspace.
                   They used to span only the two blocks being aligned, which
                   made them read as stray dashes floating between blocks
                   rather than as an alignment axis — and when aligning several
                   blocks across the canvas the line stopped short of most of
                   them. Converted from screen space to canvas space so the
                   line covers exactly what you can see, at any pan or zoom. */
                const vx0 = (-pan.x) / nbZoom + 3000
                const vx1 = (-pan.x + viewSize.w) / nbZoom + 3000
                const vy0 = (-pan.y) / nbZoom + 3000
                const vy1 = (-pan.y + viewSize.h) / nbZoom + 3000
                const p = l.p + 3000
                // Opacity tracks how strongly the block is being attracted, so
                // the guide materialises as you approach instead of blinking on.
                const op = 0.25 + l.strength * 0.7
                const sw = (l.locked ? 1.5 : 1) / nbZoom
                const dash = l.locked ? 'none' : `${6 / nbZoom} ${5 / nbZoom}`
                return l.t === 'v'
                  ? <g key={l.key} className="ds-guide" opacity={op}>
                      <line x1={p} y1={vy0} x2={p} y2={vy1} stroke={accent} strokeWidth={sw} strokeDasharray={dash} />
                    </g>
                  : <g key={l.key} className="ds-guide" opacity={op}>
                      <line x1={vx0} y1={p} x2={vx1} y2={p} stroke={accent} strokeWidth={sw} strokeDasharray={dash} />
                    </g>
              })}
              {/* Gutter badge — shows the measured gap when snapping alongside
                  a neighbour rather than flush against it. */}
              {snapLines.filter(l => l.gapAt).map(l => {
                const g = l.gapAt
                const tick = 4 / nbZoom
                if (l.t === 'v') {
                  const y = g.at + 3000, x1 = g.from + 3000, x2 = g.to + 3000
                  return (
                    <g key={l.key + 'gap'} className="ds-guide" opacity={0.95}>
                      <line x1={x1} y1={y} x2={x2} y2={y} stroke={amber} strokeWidth={1.3 / nbZoom} />
                      <line x1={x1} y1={y - tick} x2={x1} y2={y + tick} stroke={amber} strokeWidth={1.3 / nbZoom} />
                      <line x1={x2} y1={y - tick} x2={x2} y2={y + tick} stroke={amber} strokeWidth={1.3 / nbZoom} />
                      <text x={(x1 + x2) / 2} y={y - 6 / nbZoom} fill={amber} textAnchor="middle"
                        style={{ fontSize: 10 / nbZoom, fontFamily: 'var(--ds-font-mono)' }}>{l.gap}</text>
                    </g>
                  )
                }
                const x = g.at + 3000, y1 = g.from + 3000, y2 = g.to + 3000
                return (
                  <g key={l.key + 'gap'} className="ds-guide" opacity={0.95}>
                    <line x1={x} y1={y1} x2={x} y2={y2} stroke={amber} strokeWidth={1.3 / nbZoom} />
                    <line x1={x - tick} y1={y1} x2={x + tick} y2={y1} stroke={amber} strokeWidth={1.3 / nbZoom} />
                    <line x1={x - tick} y1={y2} x2={x + tick} y2={y2} stroke={amber} strokeWidth={1.3 / nbZoom} />
                    <text x={x + 8 / nbZoom} y={(y1 + y2) / 2 + 3 / nbZoom} fill={amber}
                      style={{ fontSize: 10 / nbZoom, fontFamily: 'var(--ds-font-mono)' }}>{l.gap}</text>
                  </g>
                )
              })}
              {spacingTags.map(t => {
                const y = t.y + 3000
                const x1 = t.x + 3000
                const x2 = x1 + t.w
                const tick = 4 / nbZoom
                return (
                  <g key={t.key} className="ds-guide" opacity={0.9}>
                    <line x1={x1} y1={y} x2={x2} y2={y} stroke={amber} strokeWidth={1.2 / nbZoom} />
                    <line x1={x1} y1={y - tick} x2={x1} y2={y + tick} stroke={amber} strokeWidth={1.2 / nbZoom} />
                    <line x1={x2} y1={y - tick} x2={x2} y2={y + tick} stroke={amber} strokeWidth={1.2 / nbZoom} />
                    <text x={(x1 + x2) / 2} y={y - 5 / nbZoom} fill={amber} textAnchor="middle"
                      style={{ fontSize: 10 / nbZoom, fontFamily: 'var(--ds-font-mono)' }}>{t.label}</text>
                  </g>
                )
              })}
            </svg>
          )}
          {/* Connection lines layer — sits between sections (z=1) and blocks (z=10) */}
          <svg style={{ position: 'absolute', top: -3000, left: -3000, width: 9000, height: 9000, pointerEvents: 'none', zIndex: 5, overflow: 'visible' }}>
            <defs>
              <filter id="nb-line-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            {connections.map(conn => {
              const from = blocks.find(b => b.id === conn.fromBlockId)
              const to = blocks.find(b => b.id === conn.toBlockId)
              if (!from || !to) return null
              const { w: fw, h: fh } = blockDims(from)
              const { w: tw, h: th } = blockDims(to)
              const fc = { x: from.x + fw/2, y: from.y + fh/2 }
              const tc = { x: to.x + tw/2, y: to.y + th/2 }
              const dx = tc.x - fc.x, dy = tc.y - fc.y
              const fs = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top')
              const ts = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'left' : 'right') : (dy > 0 ? 'top' : 'bottom')
              const portPos = (b, side) => {
                const { w, h } = blockDims(b)
                if (side === 'top') return { x: b.x + w/2, y: b.y }
                if (side === 'bottom') return { x: b.x + w/2, y: b.y + h }
                if (side === 'left') return { x: b.x, y: b.y + h/2 }
                return { x: b.x + w, y: b.y + h/2 }
              }
              const p1 = portPos(from, fs)
              const p2 = portPos(to, ts)
              const cdx = p2.x - p1.x, cdy = p2.y - p1.y
              const curve = Math.min(120, Math.max(40, Math.hypot(cdx, cdy) * 0.4))
              const c1 = { x: p1.x + (fs === 'right' ? curve : fs === 'left' ? -curve : 0), y: p1.y + (fs === 'bottom' ? curve : fs === 'top' ? -curve : 0) }
              const c2 = { x: p2.x + (ts === 'right' ? curve : ts === 'left' ? -curve : 0), y: p2.y + (ts === 'bottom' ? curve : ts === 'top' ? -curve : 0) }
              const path = `M ${p1.x + 3000} ${p1.y + 3000} C ${c1.x + 3000} ${c1.y + 3000}, ${c2.x + 3000} ${c2.y + 3000}, ${p2.x + 3000} ${p2.y + 3000}`
              const isSel = selectedIds.has(conn.fromBlockId) || selectedIds.has(conn.toBlockId)
              const isHov = hoveredBlockId === conn.fromBlockId || hoveredBlockId === conn.toBlockId || hoveredConnId === conn.id
              const isPicked = selectedConnId === conn.id
              const highlight = isSel || isHov || isPicked
              // Midpoint of the cubic at t=0.5, for the delete affordance.
              const mid = {
                x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8 + 3000,
                y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8 + 3000,
              }
              return (
                <g key={conn.id}>
                  {/* Wide invisible hit-area: hover reveals, click selects. */}
                  <path d={path} fill="none" stroke="transparent" strokeWidth={16}
                    style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                    onMouseEnter={() => setHoveredConnId(conn.id)}
                    onMouseLeave={() => setHoveredConnId(null)}
                    onMouseDown={e => { e.stopPropagation() }}
                    onClick={e => { e.stopPropagation(); setSelectedConnId(isPicked ? null : conn.id); setSelectedIds(new Set()) }} />
                  <path d={path} fill="none" stroke={isPicked ? amber : accent}
                    strokeWidth={isPicked ? 2.6 : highlight ? 2.2 : 1.5}
                    strokeDasharray={highlight ? 'none' : '5 4'}
                    opacity={highlight ? 0.95 : 0.5}
                    filter={isSel || isPicked ? 'url(#nb-line-glow)' : undefined}
                    style={{ transition: 'opacity 0.2s, stroke-width 0.2s', pointerEvents: 'none' }} />
                  <circle r={highlight ? 3.5 : 3} fill={isPicked ? amber : accent} opacity={highlight ? 1 : 0.85}
                    filter={isSel ? 'url(#nb-line-glow)' : undefined} style={{ pointerEvents: 'none' }}>
                    <animateMotion dur={highlight ? '1.8s' : '2.4s'} repeatCount="indefinite" path={path} />
                  </circle>
                  {(isHov || isPicked) && (
                    <g style={{ cursor: 'pointer', pointerEvents: 'all' }}
                      onMouseEnter={() => setHoveredConnId(conn.id)}
                      onMouseDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); deleteConnection(conn.id); setSelectedConnId(null) }}>
                      <circle cx={mid.x} cy={mid.y} r={9} fill={surface} stroke={red} strokeWidth={1.4} />
                      <path d={`M ${mid.x - 3.2} ${mid.y - 3.2} L ${mid.x + 3.2} ${mid.y + 3.2} M ${mid.x + 3.2} ${mid.y - 3.2} L ${mid.x - 3.2} ${mid.y + 3.2}`}
                        stroke={red} strokeWidth={1.6} strokeLinecap="round" />
                    </g>
                  )}
                </g>
              )
            })}

            {/* Live wire being pulled out of a port */}
            {linking && (() => {
              const from = blocks.find(b => b.id === linking.fromId)
              if (!from) return null
              const { w, h } = blockDims(from)
              const s = linking.fromSide
              const p1 = s === 'top' ? { x: from.x + w / 2, y: from.y }
                : s === 'bottom' ? { x: from.x + w / 2, y: from.y + h }
                : s === 'left' ? { x: from.x, y: from.y + h / 2 }
                : { x: from.x + w, y: from.y + h / 2 }
              const curve = Math.min(120, Math.max(40, Math.hypot(linking.x - p1.x, linking.y - p1.y) * 0.4))
              const c1 = {
                x: p1.x + (s === 'right' ? curve : s === 'left' ? -curve : 0),
                y: p1.y + (s === 'bottom' ? curve : s === 'top' ? -curve : 0),
              }
              const d = `M ${p1.x + 3000} ${p1.y + 3000} C ${c1.x + 3000} ${c1.y + 3000}, ${linking.x + 3000} ${linking.y + 3000}, ${linking.x + 3000} ${linking.y + 3000}`
              return (
                <g style={{ pointerEvents: 'none' }}>
                  <path d={d} fill="none" stroke={accent} strokeWidth={2} strokeDasharray="6 4" opacity={0.9} />
                  <circle cx={linking.x + 3000} cy={linking.y + 3000} r={linking.overId ? 7 : 4}
                    fill={linking.overId ? accent : surface} stroke={accent} strokeWidth={2}
                    style={{ transition: 'r 0.12s ease' }} />
                </g>
              )
            })()}
          </svg>

          <svg style={{ position: 'absolute', top: -3000, left: -3000, width: 9000, height: 9000, pointerEvents: 'none', zIndex: 6, overflow: 'visible' }}>
            {drawings.map(drawing => (
              <path key={drawing.id}
                d={pointsToPath(drawing.points)}
                fill="none"
                stroke={drawing.color}
                strokeWidth={drawing.size}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.9}
                style={{ transform: 'translate(3000px, 3000px)' }}
              />
            ))}
            {currentPath && (
              <path
                d={pointsToPath(currentPath.points)}
                fill="none"
                stroke={currentPath.color}
                strokeWidth={currentPath.size}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.9}
                style={{ transform: 'translate(3000px, 3000px)' }}
              />
            )}
          </svg>

          {blocks.map((block, bi) => {
            const isSelected = selectedIds.has(block.id)
            const isHovered = hoveredBlockId === block.id
            const isDeleting = deletingBlockId === block.id
            const isNew = animatingBlockId === block.id
            const isActive = isSelected || isHovered
            return (
            <div key={block.id}
              data-block-id={block.id}
              onMouseEnter={() => setHoveredBlockId(block.id)}
              onMouseLeave={() => setHoveredBlockId(null)}
              onPointerDownCapture={e => {
                if (e.button === 2 && selectedIds.has(block.id)) return
                if (mindMapMode && e.button === 0) {
                  e.preventDefault(); e.stopPropagation()
                  if (!mindMapMaster) { setMindMapMaster(block.id) }
                  else if (mindMapMaster !== block.id) { addConnection(mindMapMaster, block.id) }
                  return
                }
                selectBlock(block.id, e.ctrlKey || e.metaKey)
              }}
onContextMenu={e => handleBlockContextMenu(e, block.id)}
              style={(() => {
                // A block being dragged lifts off the canvas: it scales up a
                // touch and casts a deeper shadow, then settles back on drop.
                // The transform transition handles both directions, so the
                // lift and the landing are animated for free.
                const isDragging = draggingBlockId === block.id
                const isSnapTarget = snapTargets.includes(block.id)
                const isLinkTarget = linking?.overId === block.id
                return {
                  position: 'absolute', left: block.x, top: block.y,
                  zIndex: block.type === 'section'
                    ? (isSelected ? 3 : 1)
                    : (isDragging ? 40 : isSelected ? 20 : isHovered ? 15 : 10),
                  transition: isDeleting
                    ? 'none'
                    : 'transform 0.22s cubic-bezier(0.22,1,0.36,1), box-shadow 0.22s ease, filter 0.22s ease, outline-color 0.15s ease, z-index 0s',
                  transformOrigin: 'center center',
                  /* Dropping into a section used to shrink the block to 60%,
                     which read as the block being destroyed. It now lifts
                     slightly less than a free drag, and the section itself
                     highlights — the containment cue lives on the container,
                     not on the thing being moved. */
                  transform: isDragging && hoverSectionId
                    ? 'scale(0.985)'
                    : isDragging
                    ? 'scale(1.022)'
                    : 'scale(1)',
                  filter: isDragging
                    ? `drop-shadow(0 18px 34px ${dark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.20)'})`
                    : 'none',
                  // Edge highlight: what we're aligning against, or the block a
                  // connection wire is currently hovering over.
                  outline: (kbMode === 'grab' && soleSelected?.id === block.id) ? `2px dashed ${accent}`
                    : isLinkTarget ? `2px solid ${accent}`
                    : isSnapTarget ? `1.5px solid ${accent}`
                    : '1.5px solid transparent',
                  outlineOffset: (isLinkTarget || (kbMode === 'grab' && soleSelected?.id === block.id)) ? 3 : 2,
                  borderRadius: 11,
                  cursor: isDragging ? 'grabbing' : undefined,
                  animation: isDeleting ? 'dsBlockDelete 0.2s ease forwards' : isNew ? 'dsBlockAppear 0.3s cubic-bezier(0.34,1.56,0.64,1)' : 'none',
                }
                /* The clip-path that used to live here is gone. It computed the
                   parent's size from `block.w || 320` — defaults that don't
                   match blockDims() (a table is 520 wide, not 320) — so the
                   inset was wrong for every block type except text. Once a
                   section was moved or resized the inset could exceed the
                   block's own size, clipping it to nothing: that's the
                   "blocks disappear" bug. Children now simply render; the
                   section is a grouping affordance, not a viewport. */
              })()}>

              {/* TEXT BLOCK */}
              {block.type === 'text' && (
                <div style={{
                  width: block.w || 320, minHeight: block.h || 150,
                  background: isSelected ? `linear-gradient(135deg, ${raised}, ${surface})` : surface,
                  border: `1.5px solid ${isSelected ? accent : isHovered ? border : dark ? '#252420' : '#D5D1C7'}`,
                  borderRadius: 10, overflow: 'hidden', position: 'relative',
                  boxShadow: isSelected
                    ? `0 0 0 2px ${dark ? 'rgba(91,95,232,0.12)' : 'rgba(29,158,117,0.12)'}, 0 8px 32px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.12)'}`
                    : isHovered
                    ? `0 4px 20px ${dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.08)'}`
                    : `0 2px 8px ${dark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.06)'}`,
                  transition: 'box-shadow 0.2s ease, border-color 0.2s ease, background 0.2s ease',
                }}>
                  {/* Accent bar */}
                  <div style={{ height: isSelected ? 3 : 0, background: accent, transition: 'height 0.2s ease', borderRadius: '10px 10px 0 0' }} />
                  <BlockHandle
                    notebookId={nb.id}
                    block={block}
                    label="text"
                    colors={colors}
                    renaming={renamingBlockId === block.id}
                    onStartRename={() => setRenamingBlockId(block.id)}
                    onStopRename={() => setRenamingBlockId(null)}
                    onRename={value => onUpdateBlock(block.id, { name: value })}
                    onDelete={() => confirmDelete(block)}
                    onHeaderDragStart={e => startBlockDrag(e, block)}
                  />
                  <TextBlockContent
                    showRail={isSelected && selectedIds.size === 1 && !mindMapMode && !drawMode}
                    blockId={block.id}
                    initialContent={block.content}
                    onSave={html => onUpdateBlock(block.id, { content: html })}
                    text={text}
                    colors={colors}
                    minHeight={Math.max(80, (block.h || 150) - 30)}
                    onEditStart={() => { editingRef.current = true }}
                    onEditEnd={() => {
                      editingRef.current = false
                      suppressNextBgClickRef.current = true
                    }}
                  />
                  <ResizeHandle border={border} accent={accent} show={isSelected}
                    onResizeStart={(e, dir) => startResize(e, block, dir)} />
                <Ports show={isSelected || isHovered || !!linking} blockId={block.id} />
                </div>
              )}
              {/* TABLE BLOCK — now resizable */}
             {block.type === 'table' && (
                <div style={{
                  width: block.w || 520, minHeight: block.h || 260,
                  background: isSelected ? `linear-gradient(135deg, ${raised}, ${surface})` : surface,
                  border: `1.5px solid ${isSelected ? accent : isHovered ? border : dark ? '#252420' : '#D5D1C7'}`,
                  borderRadius: 10, overflow: 'hidden', position: 'relative',
                  boxShadow: isSelected
                    ? `0 0 0 2px ${dark ? 'rgba(91,95,232,0.12)' : 'rgba(29,158,117,0.12)'}, 0 8px 32px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.12)'}`
                    : isHovered
                    ? `0 4px 20px ${dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.08)'}`
                    : `0 2px 8px ${dark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.06)'}`,
                  transition: 'box-shadow 0.2s ease, border-color 0.2s ease, background 0.2s ease',
                }}>
                  <div style={{ height: isSelected ? 3 : 0, background: accent, transition: 'height 0.2s ease', borderRadius: '10px 10px 0 0' }} />
                  <BlockHandle
                    notebookId={nb.id}
                    block={block}
                    label="table"
                    colors={colors}
                    renaming={renamingBlockId === block.id}
                    onStartRename={() => setRenamingBlockId(block.id)}
                    onStopRename={() => setRenamingBlockId(null)}
                    onRename={value => onUpdateBlock(block.id, { name: value })}
                    onDelete={() => confirmDelete(block)}
                    onHeaderDragStart={e => startBlockDrag(e, block)}
                  />
                  <SheetGrid
                    block={block}
                    colors={colors}
                    maxHeight={Math.max(120, (block.h || 260) - 30)}
                    onUpdateBlock={onUpdateBlock}
                    editingRef={editingRef}
                  />
                  <ResizeHandle border={border} accent={accent} show={isSelected}
                    onResizeStart={(e, dir) => startResize(e, block, dir)} />
                <Ports show={isSelected || isHovered || !!linking} blockId={block.id} />
                </div>
              )}
              {/* IMAGE BLOCK */}
              {block.type === 'image' && (
                <div style={{
                  width: block.w || 360, minHeight: block.h || 260,
                  background: isSelected ? `linear-gradient(135deg, ${raised}, ${surface})` : surface,
                  border: `1.5px solid ${isSelected ? accent : isHovered ? border : dark ? '#252420' : '#D5D1C7'}`,
                  borderRadius: 10, overflow: 'hidden', position: 'relative',
                  boxShadow: isSelected
                    ? `0 0 0 2px ${dark ? 'rgba(91,95,232,0.12)' : 'rgba(29,158,117,0.12)'}, 0 8px 32px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.12)'}`
                    : isHovered
                    ? `0 4px 20px ${dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.08)'}`
                    : `0 2px 8px ${dark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.06)'}`,
                  transition: 'box-shadow 0.2s ease, border-color 0.2s ease, background 0.2s ease',
                }}>
                  <div style={{ height: isSelected ? 3 : 0, background: accent, transition: 'height 0.2s ease', borderRadius: '10px 10px 0 0' }} />
                  <BlockHandle
                    notebookId={nb.id}
                    block={block}
                    label="image"
                    colors={colors}
                    renaming={renamingBlockId === block.id}
                    onStartRename={() => setRenamingBlockId(block.id)}
                    onStopRename={() => setRenamingBlockId(null)}
                    onRename={value => onUpdateBlock(block.id, { name: value })}
                    onDelete={() => confirmDelete(block)}
                    onHeaderDragStart={e => startBlockDrag(e, block)}
                  />
                  <div
                    ref={cropping && soleImageBlock?.id === block.id ? cropWrapRef : null}
                    onMouseDown={e => {
                      // Crop drag. Only active while armed, and only on the
                      // selected image, so it can't hijack a normal click.
                      if (!cropping || soleImageBlock?.id !== block.id || e.button !== 0) return
                      e.stopPropagation(); e.preventDefault()

                      /* Measure against the IMAGE, not its container.
                         The image is letterboxed inside the block (object-fit
                         keeps its aspect ratio), so the container has bars of
                         empty space above/below or left/right. Normalising
                         against the container meant every coordinate was
                         offset and scaled wrong — the crop never matched where
                         the pointer was, and dragging inside a bar produced a
                         rectangle outside the picture entirely.

                         With max-width/max-height:100% and object-fit:contain
                         the <img> element's own box IS the painted area, so
                         its rect is exactly the mapping we need. */
                      const imgEl = e.currentTarget.querySelector('img')
                      const host = (imgEl || e.currentTarget).getBoundingClientRect()
                      if (!host.width || !host.height) return

                      const clamp = v => Math.max(0, Math.min(1, v))
                      const nx = cx => clamp((cx - host.left) / host.width)
                      const ny = cy => clamp((cy - host.top) / host.height)
                      const x0 = nx(e.clientX)
                      const y0 = ny(e.clientY)

                      // Show the marquee immediately at the press point.
                      setPendingCrop({ x: x0, y: y0, w: 0, h: 0, host: null })

                      function onMove(ev) {
                        const x1 = nx(ev.clientX)
                        const y1 = ny(ev.clientY)
                        setPendingCrop({
                          x: Math.min(x0, x1), y: Math.min(y0, y1),
                          w: Math.abs(x1 - x0), h: Math.abs(y1 - y0),
                        })
                      }
                      function onUp() {
                        window.removeEventListener('mousemove', onMove)
                        window.removeEventListener('mouseup', onUp)
                        // Ignore a stray click that produced no real rectangle.
                        setPendingCrop(p => (p && p.w > 0.02 && p.h > 0.02 ? p : null))
                      }
                      window.addEventListener('mousemove', onMove)
                      window.addEventListener('mouseup', onUp)
                    }}
                    /* One style object. There were two, and the second silently
                       won — dropping `position: relative`, which the crop
                       overlay is absolutely positioned against. */
                    style={{
                      position: 'relative',
                      cursor: cropping && soleImageBlock?.id === block.id ? 'crosshair' : 'default',
                    }}>
                    <ImageBlock
                      block={block}
                      colors={colors}
                      maxHeight={Math.max(100, (block.h || 260) - 30)}
                      onUpdateBlock={onUpdateBlock}
                    />
                    {cropping && soleImageBlock?.id === block.id && (
                      /* Anchored to the painted image, not the block. */
                      <div style={{
                        position: 'absolute', pointerEvents: 'none',
                        left: cropHost ? cropHost.left : 0,
                        top: cropHost ? cropHost.top : 0,
                        width: cropHost ? cropHost.width : '100%',
                        height: cropHost ? cropHost.height : '100%',
                        overflow: 'hidden',
                      }}>
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
                        {pendingCrop && pendingCrop.w > 0 && pendingCrop.h > 0 && (
                          <>
                            {/* Punch the selection out of the dimming so the
                                kept area is shown at full brightness. */}
                            <div style={{
                              position: 'absolute',
                              left: `${pendingCrop.x * 100}%`, top: `${pendingCrop.y * 100}%`,
                              width: `${pendingCrop.w * 100}%`, height: `${pendingCrop.h * 100}%`,
                              boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
                              outline: `1.5px solid ${accent}`,
                              mixBlendMode: 'normal',
                            }} />
                            <div style={{
                              position: 'absolute',
                              left: `${pendingCrop.x * 100}%`,
                              top: `calc(${(pendingCrop.y + pendingCrop.h) * 100}% + 4px)`,
                              background: accent, color: '#fff', borderRadius: 4,
                              padding: '2px 6px', fontSize: 9.5, fontFamily: 'var(--ds-font-mono)',
                              whiteSpace: 'nowrap',
                            }}>
                              {Math.round(pendingCrop.w * (block.natW || 0))} × {Math.round(pendingCrop.h * (block.natH || 0))}
                            </div>
                          </>
                        )}
                        {(!pendingCrop || !pendingCrop.w) && (
                          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontFamily: 'var(--ds-font-body)' }}>
                            Drag to select an area
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <ResizeHandle border={border} accent={accent} show={isSelected}
                    onResizeStart={(e, dir) => startResize(e, block, dir)} />
                  <Ports show={isSelected || isHovered || !!linking} blockId={block.id} />
                </div>
              )}

              {/* SECTION BLOCK — always sits behind other blocks */}
              {block.type === 'section' && (
                <div style={{
                  width: block.w || 500, height: block.h || 350,
                  background: `${block.sectionColor || accent}08`,
                  border: `2px dashed ${hoverSectionId === block.id ? (block.sectionColor || accent) : `${block.sectionColor || accent}44`}`,
                  borderRadius: 12, overflow: 'hidden', position: 'relative',
                  boxShadow: hoverSectionId === block.id
                    ? `0 0 0 3px ${block.sectionColor || accent}22`
                    : isSelected
                    ? `0 0 0 2px ${block.sectionColor || accent}22, 0 4px 20px ${dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.08)'}`
                    : `0 2px 8px ${dark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)'}`,
                  transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', height: 38, background: `${block.sectionColor || accent}18`, borderBottom: `1px solid ${block.sectionColor || accent}22`, cursor: 'grab' }}
                    onMouseDown={e => startBlockDrag(e, block)}>
                    <div style={{ width: 4, height: 18, borderRadius: 2, background: block.sectionColor || accent }} />
                    {renamingBlockId === block.id ? (
                      <input autoFocus defaultValue={block.name || 'Section'} onBlur={e => { onUpdateBlock(block.id, { name: e.target.value || 'Section' }); setRenamingBlockId(null) }} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }} onMouseDown={e => e.stopPropagation()} maxLength={40}
                        style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: `1px solid ${block.sectionColor || accent}`, color: text, fontFamily: 'var(--ds-font-head)', fontSize: 13, fontWeight: 700, outline: 'none', minWidth: 0 }} />
                    ) : (
                      <span onDoubleClick={e => { e.stopPropagation(); setRenamingBlockId(block.id) }} style={{ flex: 1, color: text, fontFamily: 'var(--ds-font-head)', fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{block.name || 'Section'}</span>
                    )}
                    <div style={{ display: 'flex', gap: 3 }}>
                      {['#5B5FE8','#1D9E75','#E8B85B','#f87171','#a78bfa','#38bdf8','#fb923c'].map(hex => (
                        <div key={hex} onClick={e => { e.stopPropagation(); onUpdateBlock(block.id, { sectionColor: hex }) }} onMouseDown={e => e.stopPropagation()}
                          style={{ width: 9, height: 9, borderRadius: '50%', background: hex, cursor: 'pointer', border: hex === (block.sectionColor || accent) ? `2px solid ${text}` : '2px solid transparent' }} />
                      ))}
                    </div>
                    <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); confirmDelete(block) }} style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', fontSize: 13, padding: '2px 4px', opacity: 0.5 }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = red }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = text3 }}>✕</button>
                  </div>
                  {blocks.filter(b => b.parentSectionId === block.id).length === 0 && (
                    <div style={{ position: 'absolute', top: 38, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', color: `${block.sectionColor || accent}77`, fontSize: 11, fontStyle: 'italic', fontFamily: 'var(--ds-font-body)' }}>
                      Drag blocks here
                    </div>
                  )}
                  <ResizeHandle border={border} accent={accent} show={isSelected}
                    onResizeStart={(e, dir) => startResize(e, block, dir)} />
                </div>
              )}
              {block.type === 'kanban' && (
                <div style={{
                  width: block.w || 720, minHeight: block.h || 280,
                  background: isSelected ? `linear-gradient(135deg, ${raised}, ${surface})` : surface,
                  border: `1.5px solid ${isSelected ? accent : isHovered ? border : dark ? '#252420' : '#D5D1C7'}`,
                  borderRadius: 10, overflow: 'hidden', position: 'relative',
                  boxShadow: isSelected
                    ? `0 0 0 2px ${dark ? 'rgba(91,95,232,0.12)' : 'rgba(29,158,117,0.12)'}, 0 8px 32px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.12)'}`
                    : isHovered
                    ? `0 4px 20px ${dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.08)'}`
                    : `0 2px 8px ${dark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.06)'}`,
                  transition: 'box-shadow 0.2s ease, border-color 0.2s ease, background 0.2s ease',
                }}>
                  <div style={{ height: isSelected ? 3 : 0, background: accent, transition: 'height 0.2s ease', borderRadius: '10px 10px 0 0' }} />
                  <BlockHandle
                    notebookId={nb.id}
                    block={block}
                    label="kanban"
                    colors={colors}
                    renaming={renamingBlockId === block.id}
                    onStartRename={() => setRenamingBlockId(block.id)}
                    onStopRename={() => setRenamingBlockId(null)}
                    onRename={value => onUpdateBlock(block.id, { name: value })}
                    onDelete={() => confirmDelete(block)}
                    onHeaderDragStart={e => startBlockDrag(e, block)}
                  />
                  <div style={{ overflow: 'auto', maxHeight: Math.max(140, (block.h || 280) - 30) }}>
                    <KanbanBlock
                      block={block}
                      onUpdateBlock={onUpdateBlock}
                      colors={colors}
                      dark={dark}
                      editingRef={editingRef}
                    />
                  </div>
                  <ResizeHandle border={border} accent={accent} show={isSelected}
                    onResizeStart={(e, dir) => startResize(e, block, dir)} />
                 <Ports show={isSelected || isHovered || !!linking} blockId={block.id} />
                </div>
              )}
            </div>
            )
          })}
        </div>
        {blocks.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ textAlign: 'center', color: text3, fontFamily: 'var(--ds-font-body)' }}>
              <div style={{ fontSize: 36, marginBottom: 14 }}>📓</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: text2, fontFamily: 'var(--ds-font-head)', marginBottom: 8 }}>Click anywhere to write</div>
              <div style={{ fontSize: 12, lineHeight: 1.9 }}>Or pick a block type from <b style={{ color: text2, fontWeight: 600 }}>Add</b> in the toolbar<br />Drag a header to move · right-click drag to pan · Esc to deselect</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

