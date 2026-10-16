'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../ui/Icon'
import { Z } from '../../lib/theme'
import { personHue } from '../../lib/attribution'
import {
  LEVEL_PROJECT, LEVEL_SHEET, LEVEL_BLOCK, ROLE_VIEWER, ROLE_EDITOR, sharesFor, onShares,
} from '../../lib/sharing'
import { listShares, createShare, revokeShare } from '../../lib/shares'
import {
  onThreads, threadList, loadThreads, startThread, addMembers, renameThread, leaveThread,
  markRead, othersIn, threadLabel, peopleWhoSharedWithMe, parseEmails,
} from '../../lib/dm'
import { postMessage } from '../../lib/chat'

/*
  components/ui/PeoplePanel.js
  --------------------------------------------------------------------------
  PEOPLE: WHO YOU WORK WITH, WHAT THEY CAN SEE, AND THE CONVERSATION WITH THEM.

  One list, three sources, merged by email address:
    · conversations  — direct and group threads (lib/dm.js, migration 0010)
    · this project's grants — who you have shared it with, at what level
    · people who shared with you
  A person's row says the one thing most worth knowing: an unread message,
  else the last one, else what they can see here, else that they shared with
  you. Click to talk. The ⋯ menu shares this sheet or the whole project,
  switches view / edit, or removes their access.

  ADD PERSON is the invite: an email (or several), optionally what to share
  and at which level, optionally a first message. Somebody without an account
  gets a pending grant and a pending conversation, both claimed when they
  sign up with that address (0008 §11, 0010 §6).

  NEW GROUP is Teams: a named conversation with several people. It does not
  share anything by itself — drag a block onto the group to hand it to
  everyone in it.

  PRIVATE BY CONSTRUCTION. Conversations are threads with members, not chat
  blocks inside a project: a colleague who can read the project cannot read
  your conversation with somebody else (0010's header has the history).

  Drag a block from the canvas onto a row: it is shared with that person (or
  everyone in that group) and dropped into the conversation. The canvas hit-
  tests `data-ds-person-row` on release; the host does the sharing.

  The message list itself is ChatBlock, rendered by the host through
  `renderChat(threadId)` — one chat surface in the app, not two.
  -------------------------------------------------------------------------- */

const PANEL_W = 300
const CHAT_W = 340
const ROW_H = 50

export default function PeoplePanel({
  open,
  colors,
  me,                    // { signedIn, email }
  project,               // { docId, name, sheetId, sheetName } | null
  activeThreadId,
  onOpenThread,          // (threadId | null)
  renderChat,            // (threadId) => node
  notify,                // (message, tone?) => void
  onClose,
}) {
  const { surface, raised, border, text, text2, text3, accent, accentText, accentDim } = colors
  const ref = useRef(null)
  /* Focus the search ONCE per opening (audit DEF-046 + review): the panel is
     portalled to the end of <body>, so Tab from the People button never
     reached it. Not `autoFocus` — that re-fired whenever the list view
     remounted (stealing focus from a conversation just opened) — and not on a
     touch screen, where it would pop the on-screen keyboard every time. */
  const searchRef = useRef(null)
  useEffect(() => {
    if (!open) return
    if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) return
    const t = requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(t)
  }, [open])
  const [, bump] = useState(0)
  const [view, setView] = useState('list')           // list | add | group | members
  const [query, setQuery] = useState('')
  const [menuFor, setMenuFor] = useState(null)       // email
  const [dropOn, setDropOn] = useState(null)
  const [sharers, setSharers] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [busy, setBusy] = useState(false)
  const signedIn = !!me?.signedIn
  const docId = project?.docId || null

  /* ── data ─────────────────────────────────────────────────────────── */
  useEffect(() => onThreads(() => bump(n => n + 1)), [])
  useEffect(() => onShares(() => bump(n => n + 1)), [])

  const refresh = useCallback(async () => {
    if (!signedIn) return
    setLoading(true)
    const [t] = await Promise.all([
      loadThreads(),
      docId ? listShares(docId) : Promise.resolve({ ok: true }),
      peopleWhoSharedWithMe().then(setSharers),
    ])
    setLoadError(t.ok ? null : t.reason)
    setLoading(false)
  }, [signedIn, docId])

  useEffect(() => { if (open) refresh() }, [open, refresh])
  useEffect(() => { if (!open) { setView('list'); setMenuFor(null); setQuery('') } }, [open])

  /* Reading a conversation clears its badge — also when a message arrives
     while it is open. */
  const threads = threadList()
  const activeThread = threads.find(t => t.id === activeThreadId) || null
  useEffect(() => {
    if (open && activeThread && activeThread.unread) markRead(activeThread.id)
  }, [open, activeThread])

  const grants = docId ? sharesFor(docId).filter(g => !g.revoked_at) : []

  const people = useMemo(() => {
    const byEmail = new Map()
    const touch = (email, patch) => {
      const e = String(email || '').toLowerCase()
      if (!e || e === String(me?.email || '').toLowerCase()) return
      byEmail.set(e, { email: e, grants: [], ...(byEmail.get(e) || {}), ...patch })
    }
    for (const t of threads) {
      if (t.kind !== 'direct') continue
      const other = othersIn(t)[0]
      if (!other?.email) continue
      touch(other.email, {
        name: other.name || byEmail.get(other.email)?.name || null,
        threadId: t.id, unread: t.unread || 0, last: t.last_body, lastSelf: t.last_author_self,
        lastAt: t.last_message_at || t.created_at, joined: !!other.joined,
      })
    }
    for (const g of grants) {
      const e = String(g.grantee_email || '').toLowerCase()
      if (!e) continue
      const cur = byEmail.get(e)
      touch(e, { grants: [...(cur?.grants || []), g] })
    }
    for (const s of sharers) touch(s.email, { name: byEmail.get(s.email)?.name || s.name, sharedWithMe: true })
    return [...byEmail.values()].sort((a, b) =>
      (b.unread || 0) - (a.unread || 0)
      || String(b.lastAt || '').localeCompare(String(a.lastAt || ''))
      || (a.name || a.email).localeCompare(b.name || b.email))
  }, [threads, grants, sharers, me?.email]) // eslint-disable-line react-hooks/exhaustive-deps

  const groups = threads.filter(t => t.kind === 'group')
  const q = query.trim().toLowerCase()
  const shownPeople = q ? people.filter(p => `${p.name || ''} ${p.email}`.toLowerCase().includes(q)) : people
  const shownGroups = q ? groups.filter(g => threadLabel(g).toLowerCase().includes(q)) : groups

  /* ── actions ──────────────────────────────────────────────────────── */
  const say = (msg, tone) => notify?.(msg, tone)

  const openPerson = async person => {
    setMenuFor(null)
    if (person.threadId) { onOpenThread?.(person.threadId); return }
    setBusy(true)
    const res = await startThread([person.email])
    setBusy(false)
    if (!res.ok) { say(res.reason || 'Could not start the conversation.', 'warn'); return }
    onOpenThread?.(res.id)
  }

  const shareWith = async (email, level, role) => {
    if (!docId) { say('Open a project first.', 'warn'); return false }
    const res = await createShare({
      docId, level, role, email,
      sheetId: level === LEVEL_SHEET ? project.sheetId : undefined,
    })
    if (!res.ok && !/already has access/i.test(res.reason || '')) {
      say(shareProblem(res.reason), 'warn')
      return false
    }
    await listShares(docId)
    return true
  }

  const setRole = async (person, grant, role) => {
    setBusy(true)
    const r = await revokeShare(grant.id, docId)
    if (r.ok) await shareWith(person.email, grant.subject_kind, role)
    else say(r.reason || 'Could not change access.', 'warn')
    setBusy(false)
  }

  const removeAccess = async person => {
    setBusy(true)
    let failed = null
    for (const g of person.grants || []) {
      const r = await revokeShare(g.id, docId)
      if (!r.ok) failed = r.reason
    }
    setBusy(false)
    say(failed ? failed : `${person.name || person.email} no longer has access to ${project?.name || 'this project'}.`, failed ? 'warn' : undefined)
  }

  /* Escape: close the innermost thing first. */
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key !== 'Escape') return
      e.preventDefault(); e.stopPropagation()
      if (menuFor) setMenuFor(null)
      else if (view !== 'list') setView('list')
      else if (activeThreadId) onOpenThread?.(null)
      else {
        /* Esc only (not an outside click): focus back to the People button
           (audit DEF-046). The panel is portalled to <body>, so closing it
           otherwise left focus nowhere. */
        const a = e.target
        onClose?.()
        if (!a || a === document.body || ref.current?.contains(a)) document.querySelector('[data-menu-toggle=people]')?.focus({ preventScroll: true })
      }
    }
    /* Close on a CLICK outside, not on a mousedown: dragging a block from the
       canvas onto a person starts with a mousedown outside this panel, and
       closing then made the drop target vanish mid-drag. A press that moves
       more than a few pixels is a drag and never closes the panel. */
    let down = null
    function onDown(e) {
      down = (e.target?.closest?.('[data-menu-toggle="people"]') || ref.current?.contains(e.target))
        ? null : { x: e.clientX, y: e.clientY }
    }
    function onUp(e) {
      const d = down
      down = null
      if (!d) return
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return
      if (ref.current && !ref.current.contains(e.target)) onClose?.()
    }
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onDown, true)
      document.addEventListener('mouseup', onUp, true)
      document.addEventListener('keydown', onKey, true)
    }, 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('mouseup', onUp, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, onClose, menuFor, view, activeThreadId, onOpenThread])

  if (!open || typeof document === 'undefined') return null

  const card = {
    background: surface, border: `1px solid ${border}`,
    borderRadius: 'var(--ds-radius-lg)', boxShadow: 'var(--ds-shadow-lg)',
    overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0,
    animation: 'dsToolbarIn var(--ds-motion-enter) var(--ds-ease-overshoot)',
  }
  const btn = (primary = false) => ({
    height: 28, padding: '0 10px', borderRadius: 6, cursor: 'pointer',
    border: `1px solid ${primary ? accent : border}`, background: primary ? accent : 'transparent',
    color: primary ? '#fff' : text2, fontFamily: 'var(--ds-font-body)', fontSize: 12, fontWeight: primary ? 600 : 400,
    whiteSpace: 'nowrap',
  })

  /* ── the conversation pane ───────────────────────────────────────── */
  const chatPane = activeThread && (
    /* The whole conversation is a drop target too: a block released over it
       goes to everyone in it (the canvas hit-tests this attribute). */
    <div data-ds-person-row={`grp:${activeThread.id}`} style={{ ...card, width: CHAT_W, maxWidth: '100%', height: 460 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, padding: '10px 12px', borderBottom: `1px solid ${border}` }}>
        {activeThread.kind === 'group'
          ? <GroupAvatar thread={activeThread} />
          : <Avatar seed={othersIn(activeThread)[0]?.email} label={othersIn(activeThread)[0]?.name || othersIn(activeThread)[0]?.email} />}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {threadLabel(activeThread)}
          </span>
          <span style={{ display: 'block', fontSize: 11, color: text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeThread.kind === 'group'
              ? `${othersIn(activeThread).length + 1} people`
              : (() => {
                const o = othersIn(activeThread)[0]
                if (!o) return ''
                if (!o.joined) return 'Invited · hasn’t joined yet'
                return o.name ? o.email : ''
              })()}
          </span>
        </span>
        {activeThread.kind === 'group' && (
          <button type="button" style={btn()} onClick={() => setView(v => (v === 'members' ? 'list' : 'members'))}
            aria-pressed={view === 'members'}>People</button>
        )}
        <button type="button" onClick={() => onOpenThread?.(null)} aria-label="Close conversation" title="Close"
          style={{ background: 'none', border: 'none', color: text3, cursor: 'pointer', padding: '0 2px' }}>
          <Icon name="draw-exit" size={12} />
        </button>
      </div>
      {view === 'members' && activeThread.kind === 'group'
        ? <GroupMembers thread={activeThread} colors={colors} btn={btn} say={say} onLeft={() => { setView('list'); onOpenThread?.(null) }} />
        : <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{renderChat?.(activeThread.id)}</div>}
    </div>
  )

  /* ── the list ─────────────────────────────────────────────────────── */
  const row = ({ key, rowId, avatar, title, sub, subAccent, unread, onClick, menu }) => {
    const dropping = dropOn === rowId
    const on = (activeThread && ((activeThread.kind === 'group' && rowId === `grp:${activeThread.id}`)
      || (activeThread.kind === 'direct' && rowId === othersIn(activeThread)[0]?.email)))
    return (
      <div key={key} style={{ position: 'relative' }}>
        <button type="button"
          data-ds-person-row={rowId}
          onClick={onClick}
          onDragOver={e => { e.preventDefault(); setDropOn(rowId) }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropOn(null) }}
          onDrop={e => { e.preventDefault(); setDropOn(null) }}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: ROW_H,
            padding: '0 34px 0 8px', textAlign: 'left',
            border: `1px solid ${dropping ? accent : 'transparent'}`, borderRadius: 'var(--ds-radius-md)',
            background: dropping ? accentDim : on ? raised : 'transparent',
            cursor: 'pointer', fontFamily: 'var(--ds-font-body)',
            transition: 'background var(--ds-transition), border-color var(--ds-transition)',
          }}
          onMouseEnter={e => { if (!on && !dropping) e.currentTarget.style.background = raised }}
          onMouseLeave={e => { if (!on && !dropping) e.currentTarget.style.background = 'transparent' }}>
          {avatar}
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: unread ? 650 : 500, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{title}</span>
              {unread > 0 && (
                <span aria-label={`${unread} unread`} style={{ flexShrink: 0, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: accent, color: '#fff', fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </span>
            <span style={{ display: 'block', fontSize: 11, marginTop: 1, color: subAccent ? accentText : text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: unread ? 600 : 400 }}>{sub}</span>
          </span>
        </button>
        {menu && (
          <button type="button" aria-label="More" title="Share, change access, remove"
            onClick={e => { e.stopPropagation(); setMenuFor(m => (m === key ? null : key)) }}
            style={{ position: 'absolute', right: 6, top: (ROW_H - 24) / 2, width: 24, height: 24, borderRadius: 6, border: 'none', background: menuFor === key ? raised : 'transparent', color: text3, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>
            ⋯
          </button>
        )}
        {menu && menuFor === key && menu}
      </div>
    )
  }

  const personMenu = person => {
    const projectGrant = person.grants.find(g => g.subject_kind === LEVEL_PROJECT)
    const sheetGrant = person.grants.find(g => g.subject_kind === LEVEL_SHEET && g.sheet_id === project?.sheetId)
    const item = (label, fn, extra = {}) => (
      <button type="button" key={label} disabled={busy || extra.disabled} onClick={async () => { setMenuFor(null); await fn() }}
        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', border: 'none', borderRadius: 6, background: 'transparent', color: extra.danger ? 'var(--ds-red)' : text2, fontSize: 12, fontFamily: 'var(--ds-font-body)', cursor: extra.disabled ? 'default' : 'pointer', opacity: extra.disabled ? 0.45 : 1 }}
        onMouseEnter={e => { e.currentTarget.style.background = raised }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
        {label}
      </button>
    )
    const noProject = !docId
    return (
      <div role="menu" style={{ position: 'absolute', right: 6, top: ROW_H - 4, zIndex: 3, width: 220, padding: 4, background: surface, border: `1px solid ${border}`, borderRadius: 8, boxShadow: 'var(--ds-shadow-md)' }}>
        {item('Message', () => openPerson(person))}
        <div style={{ height: 1, background: border, margin: '4px 0' }} />
        <div style={{ padding: '4px 10px', fontSize: 11, color: text3 }}>{project ? `In ${project.name || 'this project'}` : 'Open a project to share'}</div>
        {!projectGrant && !sheetGrant && item(`Share “${project?.sheetName || 'this sheet'}” — can view`, () => shareWith(person.email, LEVEL_SHEET, ROLE_VIEWER).then(ok => ok && say(`Shared “${project.sheetName}” with ${person.name || person.email}.`)), { disabled: noProject })}
        {!projectGrant && item('Share whole project — can view', () => shareWith(person.email, LEVEL_PROJECT, ROLE_VIEWER).then(ok => ok && say(`Shared ${project.name || 'the project'} with ${person.name || person.email}.`)), { disabled: noProject })}
        {!projectGrant && item('Share whole project — can edit', () => shareWith(person.email, LEVEL_PROJECT, ROLE_EDITOR).then(ok => ok && say(`${person.name || person.email} can now edit ${project.name || 'the project'}.`)), { disabled: noProject })}
        {projectGrant && item(projectGrant.role === ROLE_EDITOR ? 'Change project to can view' : 'Change project to can edit', () => setRole(person, projectGrant, projectGrant.role === ROLE_EDITOR ? ROLE_VIEWER : ROLE_EDITOR))}
        {sheetGrant && !projectGrant && item(sheetGrant.role === ROLE_EDITOR ? 'Change sheet to can view' : 'Change sheet to can edit', () => setRole(person, sheetGrant, sheetGrant.role === ROLE_EDITOR ? ROLE_VIEWER : ROLE_EDITOR))}
        {person.grants.length > 0 && item('Remove access to this project', () => removeAccess(person), { danger: true })}
        <div style={{ height: 1, background: border, margin: '4px 0' }} />
        {item('Copy email', () => copyText(person.email).then(ok => say(ok ? 'Email copied.' : person.email)))}
        {person.threadId && item('Hide conversation', async () => {
          const r = await leaveThread(person.threadId)
          if (!r.ok) { say(r.reason, 'warn'); return }
          if (activeThreadId === person.threadId) onOpenThread?.(null)
          say('Conversation hidden. Messaging them again brings it back.')
        })}
      </div>
    )
  }

  const listView = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, padding: '8px 8px 8px 12px', borderBottom: `1px solid ${border}` }}>
        <Icon name="nav-search" size={14} style={{ color: text3, flexShrink: 0 }} />
        {/* Focused on open by the effect at the top. Escape is let through to
            the panel's own handler. */}
        <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key !== 'Escape') e.stopPropagation() }}
          placeholder="Find someone…" aria-label="Find someone"
          style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: text, caretColor: accent, fontFamily: 'var(--ds-font-body)', fontSize: 13 }} />
        <button type="button" style={btn(true)} onClick={() => setView('add')} disabled={!signedIn} title="Invite someone by email">
          + Add
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 5 }}>
        {!signedIn && (
          <Note colors={colors}>Sign in to share with people and talk to them. Everything else keeps working locally.</Note>
        )}
        {signedIn && loadError && <Note colors={colors} warn>{loadError} <button type="button" onClick={refresh} style={{ ...btn(), height: 22, marginLeft: 4 }}>Retry</button></Note>}
        {signedIn && !loadError && !loading && people.length === 0 && groups.length === 0 && (
          <Note colors={colors}>
            Nobody here yet. <b style={{ color: text2 }}>+ Add</b> someone by email to share this project and talk — they don't need an account yet.
          </Note>
        )}
        {signedIn && (people.length || groups.length) > 0 && shownPeople.length === 0 && shownGroups.length === 0 && (
          <Note colors={colors}>Nobody matches “{query}”.</Note>
        )}

        {shownGroups.length > 0 && <Heading colors={colors}>Groups</Heading>}
        {shownGroups.map(g => row({
          key: `grp:${g.id}`, rowId: `grp:${g.id}`,
          avatar: <GroupAvatar thread={g} />,
          title: threadLabel(g),
          sub: g.last_body ? `${g.last_author_self ? 'You: ' : ''}${oneLine(g.last_body)}` : `${othersIn(g).length + 1} people`,
          unread: g.unread, onClick: () => { setMenuFor(null); onOpenThread?.(g.id) },
        }))}

        {shownGroups.length > 0 && shownPeople.length > 0 && <Heading colors={colors}>People</Heading>}
        {shownPeople.map(p => row({
          key: p.email, rowId: p.email,
          avatar: <Avatar seed={p.email} label={p.name || p.email} />,
          title: p.name || p.email,
          sub: personStatus(p, project),
          subAccent: !p.unread && !p.last && p.grants.length > 0,
          unread: p.unread, onClick: () => openPerson(p),
          menu: signedIn ? personMenu(p) : null,
        }))}
        {loading && people.length === 0 && <Note colors={colors}>Loading…</Note>}
      </div>
      <div style={{ flexShrink: 0, borderTop: `1px solid ${border}`, padding: 5, display: 'flex', gap: 4 }}>
        <FooterBtn icon="share-people" label="New group" disabled={!signedIn} onClick={() => setView('group')} colors={colors} />
      </div>
    </>
  )

  const listCard = (
    <div style={{ ...card, width: PANEL_W, maxWidth: '100%', height: 460 }}>
      {view === 'add' && <AddPerson colors={colors} btn={btn} me={me} project={project} say={say}
        onCancel={() => setView('list')}
        onDone={threadId => { setView('list'); if (threadId) onOpenThread?.(threadId) }} />}
      {view === 'group' && <NewGroup colors={colors} btn={btn} people={people} say={say}
        onCancel={() => setView('list')}
        onDone={threadId => { setView('list'); if (threadId) onOpenThread?.(threadId) }} />}
      {(view === 'list' || view === 'members') && listView}
    </div>
  )

  return createPortal(
    <div ref={ref} data-kbd-zone role="dialog" aria-label="People" onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed', right: 16, bottom: 72, zIndex: Z.panel,
        display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap-reverse', justifyContent: 'flex-end',
        fontFamily: 'var(--ds-font-body)', maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 72px - 84px)', overflowY: 'auto',
      }}>
      {chatPane}
      {listCard}
    </div>,
    document.body,
  )
}

/* ── pieces ────────────────────────────────────────────────────────────── */

function personStatus(p, project) {
  if (p.last) return `${p.lastSelf ? 'You: ' : ''}${oneLine(p.last)}`
  const g = p.grants || []
  const proj = g.find(x => x.subject_kind === LEVEL_PROJECT)
  const role = r => (r === ROLE_EDITOR ? 'can edit' : 'can view')
  if (proj) return `Project · ${role(proj.role)}${p.joined === false ? ' · invited' : ''}`
  const sheets = g.filter(x => x.subject_kind === LEVEL_SHEET)
  const here = sheets.find(x => x.sheet_id === project?.sheetId)
  if (here) return `This sheet · ${role(here.role)}${sheets.length > 1 ? ` · +${sheets.length - 1} more` : ''}`
  if (sheets.length) return `${sheets.length} sheet${sheets.length > 1 ? 's' : ''} shared`
  const blocks = g.filter(x => x.subject_kind === LEVEL_BLOCK).length
  if (blocks) return `${blocks} block${blocks > 1 ? 's' : ''} shared`
  if (p.sharedWithMe) return 'Shared something with you'
  if (p.threadId) return p.joined ? 'Say hello' : 'Invited · hasn’t joined yet'
  return 'Tap to talk'
}

const oneLine = s => String(s || '').replace(/\s+/g, ' ').trim()

function shareProblem(reason) {
  const r = String(reason || '')
  if (/no longer exists|foreign key|violates foreign key/i.test(r)) {
    return 'This project isn’t in the cloud yet, so it can’t be shared. Sharing needs cloud sync (Pro) — it syncs within a few seconds of your next edit.'
  }
  return r || 'Could not share.'
}

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true } catch { return false }
}

function Avatar({ seed, label }) {
  const initial = String(label || '?').trim().charAt(0).toUpperCase()
  return (
    <span aria-hidden="true" style={{
      width: 30, height: 30, borderRadius: '50%', flexShrink: 0, background: personHue(seed || '?'), color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, fontFamily: 'var(--ds-font-body)',
    }}>{initial}</span>
  )
}

function GroupAvatar({ thread }) {
  const o = othersIn(thread).slice(0, 2)
  return (
    <span aria-hidden="true" style={{ position: 'relative', width: 30, height: 30, flexShrink: 0 }}>
      {o.map((m, i) => (
        <span key={m.key} style={{
          position: 'absolute', left: i * 10, top: i * 8, width: 20, height: 20, borderRadius: '50%',
          background: personHue(m.email || m.key), color: '#fff', border: '2px solid var(--ds-surface)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600,
        }}>{String(m.name || m.email || '?').charAt(0).toUpperCase()}</span>
      ))}
    </span>
  )
}

function Heading({ children, colors }) {
  return <div style={{ padding: '8px 8px 4px', fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.text3, fontFamily: 'var(--ds-font-mono)' }}>{children}</div>
}

function Note({ children, colors, warn }) {
  return <div role={warn ? 'alert' : undefined} style={{ padding: '12px 10px', fontSize: 12, color: warn ? 'var(--ds-red)' : colors.text3, lineHeight: 1.55 }}>{children}</div>
}

function FooterBtn({ icon, label, onClick, disabled, colors }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{ display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 8px', flex: 1, border: 'none', borderRadius: 6, background: 'transparent', color: colors.text2, fontSize: 12, fontFamily: 'var(--ds-font-body)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1 }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = colors.raised }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
      <Icon name={icon} size={14} />
      {label}
    </button>
  )
}

const field = colors => ({
  width: '100%', boxSizing: 'border-box', height: 32, padding: '0 10px', borderRadius: 6,
  border: `1px solid ${colors.border}`, background: colors.raised, color: colors.text,
  fontFamily: 'var(--ds-font-body)', fontSize: 13, outline: 'none',
})

function Segmented({ value, options, onChange, colors, label, disabled }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'flex', gap: 4, opacity: disabled ? 0.45 : 1 }}>
      {options.map(o => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} disabled={disabled}
          onClick={() => onChange(o.id)}
          style={{
            flex: 1, height: 28, borderRadius: 6, cursor: disabled ? 'default' : 'pointer', fontSize: 12, fontFamily: 'var(--ds-font-body)',
            border: `1px solid ${value === o.id ? colors.accent : colors.border}`,
            background: value === o.id ? colors.accentDim : 'transparent',
            color: value === o.id ? colors.accentText : colors.text2, fontWeight: value === o.id ? 600 : 400,
          }}>{o.label}</button>
      ))}
    </div>
  )
}

function FormHead({ title, onBack, colors }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
      <button type="button" onClick={onBack} aria-label="Back" style={{ background: 'none', border: 'none', color: colors.text3, cursor: 'pointer', padding: 0, fontSize: 16, lineHeight: 1 }}>‹</button>
      <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{title}</span>
    </div>
  )
}

function Label({ children, colors }) {
  return <div style={{ fontSize: 11, color: colors.text3, margin: '12px 0 6px' }}>{children}</div>
}

/* ── add a person ─────────────────────────────────────────────────────── */
function AddPerson({ colors, btn, me, project, say, onCancel, onDone }) {
  const [emails, setEmails] = useState('')
  const [what, setWhat] = useState(project ? 'sheet' : 'none')
  const [role, setRole] = useState(ROLE_VIEWER)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const input = useRef(null)
  useEffect(() => { input.current?.focus() }, [])

  const parsed = parseEmails(emails)
  const mine = String(me?.email || '').toLowerCase()
  const targets = parsed.bad.length ? [] : parsed.good.filter(e => e !== mine)
  const selfOnly = parsed.good.length > 0 && parsed.good.every(e => e === mine)

  const submit = async () => {
    if (!targets.length || busy) return
    setBusy(true); setProblem(null)
    const failures = []
    let lastThread = null
    for (const email of targets) {
      if (what !== 'none' && project?.docId) {
        const res = await createShare({
          docId: project.docId, email, role,
          level: what === 'project' ? LEVEL_PROJECT : LEVEL_SHEET,
          sheetId: what === 'sheet' ? project.sheetId : undefined,
        })
        if (!res.ok && !/already has access/i.test(res.reason || '')) { failures.push(`${email}: ${shareProblem(res.reason)}`); continue }
      }
      const t = await startThread([email])
      if (!t.ok) { failures.push(`${email}: ${t.reason}`); continue }
      lastThread = t.id
      if (message.trim()) {
        await postMessage({ blockId: t.id, body: message.trim() })
      }
    }
    if (project?.docId) await listShares(project.docId)
    setBusy(false)
    if (failures.length) { setProblem(failures.join('\n')); return }
    say(targets.length === 1
      ? `${targets[0]} added${what !== 'none' ? ` — they can ${role === ROLE_EDITOR ? 'edit' : 'view'} ${what === 'project' ? 'the project' : `“${project?.sheetName}”`}` : ''}.`
      : `${targets.length} people added.`)
    onDone(targets.length === 1 ? lastThread : null)
  }

  return (
    <>
      <FormHead title="Add people" onBack={onCancel} colors={colors} />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 12px 12px' }}>
        <Label colors={colors}>Email addresses</Label>
        <input ref={input} value={emails} onChange={e => setEmails(e.target.value)}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); submit() } }}
          placeholder="name@company.com, …" aria-label="Email addresses" style={field(colors)} />
        {parsed.bad.length > 0 && <div style={{ fontSize: 11, color: 'var(--ds-red)', marginTop: 4 }}>Not an email: {parsed.bad.join(', ')}</div>}
        {selfOnly && <div style={{ fontSize: 11, color: 'var(--ds-red)', marginTop: 4 }}>That’s you.</div>}

        <Label colors={colors}>Also share{project ? '' : ' (open a project to share)'}</Label>
        <Segmented label="What to share" value={what} onChange={setWhat} colors={colors} disabled={!project}
          options={[{ id: 'none', label: 'Nothing' }, { id: 'sheet', label: 'This sheet' }, { id: 'project', label: 'Project' }]} />
        {what !== 'none' && project && (
          <div style={{ fontSize: 11, color: colors.text3, marginTop: 6 }}>
            {what === 'sheet' ? `“${project.sheetName}” in ${project.name}` : `All of ${project.name}, every sheet`}
          </div>
        )}
        <Label colors={colors}>They can</Label>
        <Segmented label="Access" value={role} onChange={setRole} colors={colors} disabled={what === 'none' || !project}
          options={[{ id: ROLE_VIEWER, label: 'View' }, { id: ROLE_EDITOR, label: 'Edit' }]} />

        <Label colors={colors}>Message (optional)</Label>
        <textarea value={message} onChange={e => setMessage(e.target.value.slice(0, 4000))} onKeyDown={e => e.stopPropagation()}
          rows={3} placeholder="Say what this is about…" aria-label="Message"
          style={{ ...field(colors), height: 'auto', padding: '8px 10px', resize: 'vertical', lineHeight: 1.4 }} />

        <div style={{ fontSize: 11, color: colors.text3, marginTop: 10, lineHeight: 1.5 }}>
          No account yet? They get access and the conversation when they sign up with this address.
        </div>
        {problem && <div role="alert" style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--ds-red)', marginTop: 10 }}>{problem}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: 10, borderTop: `1px solid ${colors.border}`, flexShrink: 0 }}>
        <button type="button" style={btn()} onClick={onCancel}>Cancel</button>
        <button type="button" style={{ ...btn(true), opacity: targets.length && !busy ? 1 : 0.5 }} disabled={!targets.length || busy} onClick={submit}>
          {busy ? 'Adding…' : targets.length > 1 ? `Add ${targets.length} people` : 'Add'}
        </button>
      </div>
    </>
  )
}

/* ── a new group ──────────────────────────────────────────────────────── */
function NewGroup({ colors, btn, people, say, onCancel, onDone }) {
  const [name, setName] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [extra, setExtra] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const parsed = parseEmails(extra)
  const all = [...new Set([...picked, ...parsed.good])]
  const toggle = e => setPicked(s => { const n = new Set(s); if (n.has(e)) n.delete(e); else n.add(e); return n })

  const submit = async () => {
    if (all.length < 1 || busy) return
    setBusy(true); setProblem(null)
    const res = await startThread(all, name.trim() || 'Group')
    setBusy(false)
    if (!res.ok) { setProblem(res.reason); return }
    say(`Group “${name.trim() || 'Group'}” started with ${all.length} ${all.length === 1 ? 'person' : 'people'}.`)
    onDone(res.id)
  }

  return (
    <>
      <FormHead title="New group" onBack={onCancel} colors={colors} />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 12px 12px' }}>
        <Label colors={colors}>Name</Label>
        <input autoFocus value={name} onChange={e => setName(e.target.value.slice(0, 80))} onKeyDown={e => e.stopPropagation()}
          placeholder="Launch crew" aria-label="Group name" style={field(colors)} />
        {people.length > 0 && <Label colors={colors}>People</Label>}
        {people.map(p => (
          <label key={p.email} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 2px', cursor: 'pointer', fontSize: 13, color: colors.text }}>
            <input type="checkbox" checked={picked.has(p.email)} onChange={() => toggle(p.email)} />
            <Avatar seed={p.email} label={p.name || p.email} />
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || p.email}</span>
          </label>
        ))}
        <Label colors={colors}>{people.length ? 'Or add by email' : 'Emails'}</Label>
        <input value={extra} onChange={e => setExtra(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') submit() }}
          placeholder="name@company.com, …" aria-label="More emails" style={field(colors)} />
        {parsed.bad.length > 0 && <div style={{ fontSize: 11, color: 'var(--ds-red)', marginTop: 4 }}>Not an email: {parsed.bad.join(', ')}</div>}
        <div style={{ fontSize: 11, color: colors.text3, marginTop: 10, lineHeight: 1.5 }}>
          A group is a conversation. To hand everyone a block, drag it onto the group.
        </div>
        {problem && <div role="alert" style={{ fontSize: 12, color: 'var(--ds-red)', marginTop: 10 }}>{problem}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: 10, borderTop: `1px solid ${colors.border}`, flexShrink: 0 }}>
        <button type="button" style={btn()} onClick={onCancel}>Cancel</button>
        <button type="button" style={{ ...btn(true), opacity: all.length && !busy ? 1 : 0.5 }} disabled={!all.length || busy} onClick={submit}>
          {busy ? 'Starting…' : `Start group${all.length ? ` (${all.length + 1})` : ''}`}
        </button>
      </div>
    </>
  )
}

/* ── a group's people ─────────────────────────────────────────────────── */
function GroupMembers({ thread, colors, btn, say, onLeft }) {
  const [title, setTitle] = useState(thread.title || '')
  const [add, setAdd] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const parsed = parseEmails(add)
  const members = (thread.members || []).filter(m => !m.left)

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 12px 12px' }}>
      <Label colors={colors}>Name</Label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={title} onChange={e => setTitle(e.target.value.slice(0, 80))} onKeyDown={e => e.stopPropagation()} aria-label="Group name" style={field(colors)} />
        <button type="button" style={btn()} disabled={busy || title.trim() === (thread.title || '')}
          onClick={async () => { setBusy(true); const r = await renameThread(thread.id, title); setBusy(false); say(r.ok ? 'Renamed.' : r.reason, r.ok ? undefined : 'warn') }}>Save</button>
      </div>
      <Label colors={colors}>{members.length} {members.length === 1 ? 'person' : 'people'}</Label>
      {members.map(m => (
        <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
          <Avatar seed={m.email || m.key} label={m.name || m.email} />
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontSize: 13, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.self ? 'You' : (m.name || m.email)}</span>
            {!m.self && (m.name || !m.joined) && <span style={{ display: 'block', fontSize: 11, color: colors.text3 }}>{!m.joined ? 'Invited · hasn’t joined yet' : m.email}</span>}
          </span>
        </div>
      ))}
      <Label colors={colors}>Add people</Label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={add} onChange={e => setAdd(e.target.value)} onKeyDown={e => e.stopPropagation()} placeholder="name@company.com" aria-label="Add by email" style={field(colors)} />
        <button type="button" style={btn(true)} disabled={busy || !parsed.good.length}
          onClick={async () => { setBusy(true); const r = await addMembers(thread.id, parsed.good); setBusy(false); if (r.ok) { setAdd(''); say(`Added ${r.data} ${r.data === 1 ? 'person' : 'people'}.`) } else say(r.reason, 'warn') }}>Add</button>
      </div>
      <div style={{ marginTop: 18 }}>
        {!confirmLeave
          ? <button type="button" style={{ ...btn(), color: 'var(--ds-red)', borderColor: 'var(--ds-red)' }} onClick={() => setConfirmLeave(true)}>Leave group</button>
          : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: colors.text2 }}>Leave? You’ll stop seeing new messages.</span>
              <button type="button" style={btn()} onClick={() => setConfirmLeave(false)}>Stay</button>
              <button type="button" style={{ ...btn(true), background: 'var(--ds-red)', borderColor: 'var(--ds-red)' }}
                onClick={async () => { const r = await leaveThread(thread.id); if (r.ok) onLeft(); else say(r.reason, 'warn') }}>Leave</button>
            </div>
          )}
      </div>
    </div>
  )
}
