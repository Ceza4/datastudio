'use client'
import { useState, useMemo, useEffect, useRef, memo } from 'react'
import Icon from '../ui/Icon'
import {
  VIEWS, VIEW_LABEL, WEEK_START_MONDAY,
  monthGrid, weekGrid, weekdayLabels, addMonths, addDays,
  resolveEvents, bucketByDay, agendaGroups,
  monthTitle, weekTitle, dayKey, isToday, MONTH_NAMES,
  msUntilNextLocalMidnight,
} from '../../lib/calendar'

/*
  components/notebook/CalendarBlock.js
  --------------------------------------------------------------------------
  A calendar on the canvas.

  WHAT IT'S FOR
  "If I have a meeting with a client I can click on that calendar's meeting
  note and it jumps to the page where there is actual info about the client."

  So every event is a button, and clicking it teleports. The calendar is a
  dated index of the workspace, not a place data lives — which is why it owns
  nothing except events typed directly into it. Tasks stay tasks, table rows
  stay table rows.

  ON "LIKE APPLE'S CALENDAR, IDENTICAL"
  The behaviour is what was asked for and it's here: click through to the
  thing itself. The LOOK deliberately isn't a copy. Apple's calendar is
  someone else's trade dress, and more practically it would be the one surface
  in DataStudio that doesn't look like DataStudio. What's borrowed is the part
  that makes it feel calm: generous whitespace, rounded event pills, today
  marked by a filled accent circle rather than a heavy border, and no
  gridline-heavy chrome.
  -------------------------------------------------------------------------- */


/* memo, because this component is a child of NotebookCanvas and NotebookCanvas
   re-renders on every frame of a pan or a zoom. Without it, dragging the canvas
   re-rendered every block on screen sixty times a second; with it, React bails
   out at this boundary and the frame costs nothing but the transform.

   A plain shallow compare is enough because every prop it receives is stable by
   construction: `colors` is one of two frozen module objects (lib/theme.js),
   handlers are cached per block id by blockCb() in NotebookCanvas, and `block`
   only changes identity when the block actually changes. */
function CalendarBlockInner({ block, blocks, colors, dark, onUpdateBlock, onTeleport, address }) {
  const { surface, raised, border, text, text2, text3, accent, accentText, accentDim } = colors

  const [view, setView] = useState(block.view || 'month')
  /* The month being LOOKED at, which is not the same as today. Kept in state
     rather than on the block: where you scrolled to is a view, not a document
     property, and persisting it would mean reopening a workspace six months
     in the past because that's where you last were. */
  const [cursor, setCursor] = useState(() => new Date())

  const events = useMemo(
    () => resolveEvents(block, blocks, address || {}),
    [block, blocks, address]
  )
  const buckets = useMemo(() => bucketByDay(events), [events])
  const weekStart = WEEK_START_MONDAY

  /* Nothing else re-renders this block at midnight, so `isToday` below kept
     answering with yesterday: leave a tab open overnight and the filled accent
     circle stayed on the wrong date until an unrelated interaction happened to
     re-render. One timer for the whole block, not one per cell — 42 timers to
     move one dot is 42 too many.

     No dependency array on purpose. The effect re-arms after every render,
     always at the same absolute instant, so a re-render at 23:59 can't leave
     the tab holding a timer that already fired. A `[tick]` array would arm it
     once per tick, which is fewer setTimeouts and one more thing to be subtly
     wrong about; a setTimeout costs nothing. */
  const [, setDayTick] = useState(0)
  useEffect(() => {
    const id = setTimeout(() => setDayTick(n => n + 1), msUntilNextLocalMidnight())
    return () => clearTimeout(id)
  })

  const setView_ = v => { setView(v); onUpdateBlock?.(block.id, { view: v }) }
  const go = n => setCursor(c => (view === 'month' ? addMonths(c, n) : addDays(c, n * 7)))
  const today = () => setCursor(new Date())

  const title = view === 'month' ? monthTitle(cursor)
    : view === 'week' ? weekTitle(cursor, weekStart)
    : 'Upcoming'

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
      background: surface, fontFamily: 'var(--ds-font-body)',
    }}>

      {/* ── header ──
          Spaced by relationship rather than by one uniform gap. The old row put
          4px between every adjacent pair, so ‹ › Today · title · Month Week
          Agenda read as seven equally-related things; nothing grouped and
          nothing led. Now the chevrons touch, Today sits just off them, the
          title owns the middle, and the switcher is pinned right. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px',
        borderBottom: `1px solid ${border}`, flexShrink: 0,
      }}>
        {view !== 'agenda' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <NavBtn label="Previous month or week" onClick={() => go(-1)} colors={colors} flip />
            <NavBtn label="Next month or week" onClick={() => go(1)} colors={colors} />
            <button onClick={today} title="Jump back to today"
              style={{
                marginLeft: 4, height: 22, padding: '0 9px',
                borderRadius: 'var(--ds-radius-sm)', cursor: 'pointer',
                border: `1px solid ${border}`, background: 'transparent',
                color: text2, fontFamily: 'var(--ds-font-body)',
                fontSize: 'var(--ds-fs-sm)', lineHeight: 1,
                transition: 'background var(--ds-transition), color var(--ds-transition), border-color var(--ds-transition)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = text }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = text2 }}>
              Today
            </button>
          </div>
        )}

        {/* The one thing that says where you are, so it leads: a step up the
            scale, and in the mono face because it's a date. House convention —
            it's why the sheet's cell reference and the status bar read as
            considered and this row didn't. */}
        <span title={title} style={{
          flex: 1, minWidth: 0,
          fontFamily: 'var(--ds-font-mono)', fontSize: 'var(--ds-fs-lg)',
          fontWeight: 500, letterSpacing: 0.2, color: text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {title}
        </span>

        {/* A segmented control on its own track, not three floating words. The
            track is what makes the three read as one choice with three
            positions — which is what they are. */}
        <div style={{
          display: 'flex', gap: 2, flexShrink: 0, padding: 2,
          background: raised, border: `1px solid ${border}`,
          borderRadius: 'var(--ds-radius-md)',
        }}>
          {VIEWS.map(v => {
            const on = view === v
            return (
              <button key={v} onClick={() => setView_(v)} aria-pressed={on}
                title={`${VIEW_LABEL[v]} view`}
                style={{
                  height: 20, padding: '0 8px', cursor: 'pointer',
                  border: 'none', borderRadius: 'var(--ds-radius-sm)',
                  background: on ? accentDim : 'transparent',
                  color: on ? accent : text3,
                  fontFamily: 'var(--ds-font-body)', fontSize: 'var(--ds-fs-sm)',
                  fontWeight: on ? 600 : 500, lineHeight: 1,
                  transition: 'background var(--ds-transition), color var(--ds-transition)',
                }}
                onMouseEnter={e => { if (!on) e.currentTarget.style.color = text2 }}
                onMouseLeave={e => { if (!on) e.currentTarget.style.color = text3 }}>
                {VIEW_LABEL[v]}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── body ── */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {view === 'agenda'
          ? <Agenda events={events} colors={colors} onTeleport={onTeleport} />
          : <Grid
              weeks={view === 'month' ? monthGrid(cursor.getFullYear(), cursor.getMonth(), weekStart) : [weekGrid(cursor, weekStart)]}
              buckets={buckets} colors={colors} dark={dark}
              weekStart={weekStart} compact={view === 'month'}
              onTeleport={onTeleport}
            />}
      </div>

      {/* A month with no events is not an empty calendar — the month is still
          the content, so the grid stays and the guidance is a footer. Agenda
          IS empty in that case and gets a real empty state of its own below;
          rendering this as well stacked two "nothing here" messages. */}
      {events.length === 0 && view !== 'agenda' && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 7,
          padding: '8px 11px', borderTop: `1px solid ${border}`,
          background: raised, flexShrink: 0,
        }}>
          <Icon name="status-info" size={14} style={{ color: text2, flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 'var(--ds-fs-sm)', color: text2, lineHeight: 1.5 }}>
            Nothing dated yet. Give a task a deadline, or point this at a table’s
            date column in the rail.
          </span>
        </div>
      )}
    </div>
  )
}

/* ── grid ────────────────────────────────────────────────────────────── */

/* What one compact pill actually occupies: 10px text at 1.25 (13) + 1px
   padding either side + a 1px border either side = 17, plus the 2px gap
   before the next one. And what the date row above them costs: an 18px pill,
   the 2px gap under it, and the cell's 4/5 padding.

   These are measurements, not guesses, because the number they produce is how
   many events a cell claims it can show. `compact ? 3 : 8` claimed three at
   every size — in a default 520×420 calendar that's a 54px cell being asked
   to hold 29 + 3×19 = 86px, so two of the three were silently clipped and no
   "+N" appeared to say so. Under-claiming is recoverable — "+4" is visible and
   hoverable; over-claiming just loses events off the bottom edge. */
const PILL_STEP = 19
const DATE_ROW_H = 29

function Grid({ weeks, buckets, colors, dark, weekStart, compact, onTeleport }) {
  const { surface, base, raised, border, text2, text3, accent, accentText } = colors
  const labels = weekdayLabels(weekStart)

  /* DENSITY FOLLOWS THE BLOCK, NOT THE VIEW
     `compact ? 3 : 8` was derived from which view you were in, so a calendar
     dragged out to twice its default size showed the same three pills in a
     cell with room for ten, and a calendar squeezed short showed three in a
     cell with room for one — clipped, with no "+N" to say so. Measure the body
     once and divide: the number of rows is known, and the rows are 1fr.

     Null until the observer reports, so server render and first paint keep the
     old constants rather than flashing a different density. */
  const bodyRef = useRef(null)
  const [bodyH, setBodyH] = useState(null)
  useEffect(() => {
    const el = bodyRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setBodyH(el.clientHeight))
    ro.observe(el)
    setBodyH(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  const maxPills = bodyH
    ? Math.max(1, Math.min(14, Math.floor((bodyH / weeks.length - DATE_ROW_H) / PILL_STEP)))
    : (compact ? 3 : 8)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Weekday strip on its own ground, the way the sheet's column headers
          are. A bare row of grey letters over the same surface as the cells
          reads as the first row of the grid rather than as its head. */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
        background: raised, borderBottom: `1px solid ${border}`, flexShrink: 0,
      }}>
        {labels.map((l, i) => {
          const weekend = (weekStart + i) % 7 === 0 || (weekStart + i) % 7 === 6
          return (
            <div key={l} style={{
              padding: '6px 0', textAlign: 'center',
              fontSize: 'var(--ds-fs-xs)', fontFamily: 'var(--ds-font-mono)',
              letterSpacing: 0.8, textTransform: 'uppercase',
              /* Saturday and Sunday a step quieter. The week has a shape, and
                 a header row that ignores it is seven identical labels. */
              color: weekend ? text3 : text2,
              fontWeight: weekend ? 400 : 500,
            }}>
              {l}
            </div>
          )
        })}
      </div>

      <div ref={bodyRef} style={{
        flex: 1, minHeight: 0, display: 'grid',
        gridTemplateRows: `repeat(${weeks.length}, minmax(${compact ? 54 : 90}px, 1fr))`,
      }}>
        {weeks.map((days, wi) => (
          <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {days.map((day, di) => {
              const evs = buckets.get(day.key) || []
              const isNow = isToday(day.date)
              const weekend = day.weekday === 0 || day.weekday === 6
              /* Out-of-month recedes toward the page ground rather than being
                 washed with a literal rgba(0,0,0,…): --ds-base is lighter than
                 the surface in the light theme and darker in the dark one, so
                 one token moves it the right way in both. Today wins over it —
                 today can be a trailing day of the previous month.

                 The accent needs a touch more alpha in the dark theme: indigo
                 on near-black carries less apparent contrast than the light
                 theme's green on bone. */
              const bg = isNow ? `${accent}${dark ? '1f' : '14'}` : day.inMonth ? surface : base
              const hoverBg = isNow ? `${accent}2e` : raised
              const hidden = evs.length - maxPills

              return (
                <div key={day.key}
                  /* The whole grid used to ignore the pointer — 42 cells, none
                     of which acknowledged the cursor, which is most of why it
                     read as a printed table rather than a surface. */
                  onMouseEnter={e => { e.currentTarget.style.background = hoverBg }}
                  onMouseLeave={e => { e.currentTarget.style.background = bg }}
                  style={{
                    minWidth: 0, padding: '4px 4px 5px',
                    /* Right and bottom only, and suppressed on the last column
                       and last row: those two ran a hairline directly against
                       the block's own 1.5px border, doubling it on exactly two
                       edges and nowhere else. */
                    borderRight: di === 6 ? 'none' : `1px solid ${border}`,
                    borderBottom: wi === weeks.length - 1 ? 'none' : `1px solid ${border}`,
                    background: bg,
                    transition: 'background var(--ds-transition)',
                    display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden',
                  }}>
                  {/* The overflow count shares the date's row rather than
                      taking a line of its own. In a 54px cell a whole row is
                      an entire event, so spending one to say "+2" cost the
                      thing it was counting. */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <span style={{
                      minWidth: 18, height: 18, padding: '0 4px', borderRadius: 9,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 'var(--ds-fs-xs)', fontFamily: 'var(--ds-font-mono)',
                      fontVariantNumeric: 'tabular-nums',
                      /* Today is a filled pill. A heavy border on the cell
                         fights the grid; this sits inside it. */
                      background: isNow ? accent : 'transparent',
                      color: isNow ? '#fff' : (!day.inMonth || weekend) ? text3 : text2,
                      fontWeight: isNow ? 600 : 400,
                      flexShrink: 0,
                    }}>
                      {day.date.getDate()}
                    </span>
                    {hidden > 0 && (
                      /* Paired with the date, where it reads as "the 14th, and
                         two more". Tucked under the last pill it read as part
                         of that event's title. */
                      <span title={`${hidden} more on this day`} style={{
                        marginLeft: 'auto', minWidth: 0,
                        fontSize: 'var(--ds-fs-xs)', fontFamily: 'var(--ds-font-mono)',
                        fontVariantNumeric: 'tabular-nums', color: text3,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        +{hidden}
                      </span>
                    )}
                  </div>

                  {evs.slice(0, maxPills).map(e => (
                    <EventPill key={e.id} event={e} colors={colors} onTeleport={onTeleport} />
                  ))}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── agenda ──────────────────────────────────────────────────────────── */

function Agenda({ events, colors, onTeleport }) {
  const { border, text, text2, text3, accent, accentText, accentDim } = colors
  const groups = useMemo(() => agendaGroups(events), [events])

  /* Agenda genuinely IS empty here — unlike the month grid, which still has a
     month to show — so this is a real empty state and not a line of grey text.
     A muted glyph, a statement, and one line saying what to do about it. */
  if (!groups.length) {
    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 10, padding: '24px 28px',
      }}>
        <span style={{
          width: 38, height: 38, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: accentDim, color: accentText, flexShrink: 0,
        }}>
          <Icon name="status-empty" size={18} />
        </span>
        <span style={{ fontSize: 'var(--ds-fs-md)', fontWeight: 600, color: text, textAlign: 'center' }}>
          Nothing coming up
        </span>
        <span style={{ fontSize: 'var(--ds-fs-sm)', color: text2, lineHeight: 1.55, textAlign: 'center', maxWidth: 230 }}>
          The next two months are clear. Anything with a deadline shows up here
          the moment it has one.
        </span>
      </div>
    )
  }

  return (
    <div style={{ padding: '8px 10px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {groups.map(g => {
        const now = isToday(g.date)
        return (
          <div key={g.key}>
            {/* Three levels in one row instead of two flat spans at almost the
                same size: the day number leads in mono, the month is a quiet
                uppercase label beside it, and the year hangs right. */}
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 7, padding: '0 2px 6px',
              borderBottom: `1px solid ${border}`, marginBottom: 6,
            }}>
              <span style={{
                fontFamily: 'var(--ds-font-mono)', fontSize: 'var(--ds-fs-xl)',
                fontVariantNumeric: 'tabular-nums', fontWeight: 600, lineHeight: 1,
                color: now ? accent : text,
              }}>
                {g.date.getDate()}
              </span>
              <span style={{
                fontSize: 'var(--ds-fs-sm)', fontWeight: 600, letterSpacing: 0.6,
                textTransform: 'uppercase', color: text2,
              }}>
                {MONTH_NAMES[g.date.getMonth()].slice(0, 3)}
              </span>
              {now ? (
                <span style={{
                  marginLeft: 'auto', padding: '2px 7px', borderRadius: 'var(--ds-radius-sm)',
                  background: accentDim, color: accentText,
                  fontFamily: 'var(--ds-font-mono)', fontSize: 'var(--ds-fs-xs)',
                  fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase',
                }}>
                  Today
                </span>
              ) : (
                <span style={{
                  marginLeft: 'auto', fontFamily: 'var(--ds-font-mono)',
                  fontSize: 'var(--ds-fs-xs)', fontVariantNumeric: 'tabular-nums', color: text3,
                }}>
                  {g.date.getFullYear()}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {g.events.map(e => (
                <EventPill key={e.id} event={e} colors={colors} onTeleport={onTeleport} wide />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ── event ───────────────────────────────────────────────────────────── */

function EventPill({ event, colors, onTeleport, wide }) {
  const { text2, text3 } = colors
  const clickable = !!event.link?.blockId
  const rest = `${event.color}1f`
  const hover = `${event.color}33`

  return (
    <button
      onClick={e => { e.stopPropagation(); if (clickable) onTeleport?.(event.link) }}
      onMouseDown={e => e.stopPropagation()}
      disabled={!clickable}
      title={clickable ? `${event.title} — click to open` : event.title}
      style={{
        display: 'flex', alignItems: 'center', gap: 5, width: '100%',
        padding: wide ? '6px 9px' : '1px 5px',
        borderRadius: wide ? 'var(--ds-radius-sm)' : 4, textAlign: 'left',
        border: '1px solid transparent',
        /* The pill carries its SOURCE's colour, so a glance says whether this
           is a task, a table row or something typed here. */
        background: rest,
        color: event.overdue ? event.color : text2,
        /* Overdue is different in kind, not only in hue — which is also the
           only version of this that survives being colour-blind. */
        fontWeight: event.overdue ? 600 : 400,
        cursor: clickable ? 'pointer' : 'default',
        fontFamily: 'var(--ds-font-body)',
        fontSize: wide ? 'var(--ds-fs-md)' : 'var(--ds-fs-xs)',
        lineHeight: wide ? 1.35 : 1.25,
        overflow: 'hidden',
        textDecoration: event.done ? 'line-through' : 'none',
        opacity: event.done ? 0.55 : 1,
        /* Hover used to snap the border on with no transition, so a pointer
           crossing a full cell strobed. */
        transition: 'background var(--ds-transition), border-color var(--ds-transition)',
      }}
      onMouseEnter={e => {
        if (!clickable) return
        e.currentTarget.style.borderColor = event.color
        e.currentTarget.style.background = hover
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'transparent'
        e.currentTarget.style.background = rest
      }}>
      <span style={{
        width: wide ? 6 : 4, height: wide ? 6 : 4, borderRadius: '50%',
        background: event.color, flexShrink: 0,
      }} />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {event.title}
      </span>
      {wide && clickable && <Icon name="share-link" size={11} style={{ color: text3, flexShrink: 0 }} />}
    </button>
  )
}

/* Was a bare chevron on transparent with no border, no background and no
   hover — a 21px glyph that never acknowledged being pointed at. Now a real
   square target with the same hover treatment every other control in the app
   uses. */
function NavBtn({ label, onClick, colors, flip }) {
  const { raised, text, text2 } = colors
  return (
    <button onClick={onClick} title={label} aria-label={label}
      style={{
        width: 22, height: 22, padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 'var(--ds-radius-sm)', border: '1px solid transparent',
        background: 'transparent', color: text2, cursor: 'pointer',
        transition: 'background var(--ds-transition), color var(--ds-transition)',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = raised; e.currentTarget.style.color = text }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = text2 }}>
      <Icon name="nav-chevron-right" size={14} style={flip ? { transform: 'rotate(180deg)' } : undefined} />
    </button>
  )
}

export default memo(CalendarBlockInner)
