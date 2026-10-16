/*
  lib/leave.js
  --------------------------------------------------------------------------
  "The user chose to leave this page" — shared by every deliberate exit (audit
  DEF-044 and its review): the stale banner's Reload, the sync chip's "new
  version" reload, sign out, sign out everywhere, account deletion, and the
  delete-everything flows. AppPage's beforeunload guard stands down for these;
  answering a button the user just pressed with "Leave site?" made it look
  broken, and where the prompt is suppressed the click simply did nothing.

  Module state rather than a React ref because the exits live in components
  that do not share one. Reset on pageshow, in case a page restored from the
  back/forward cache still carries the flag.
  -------------------------------------------------------------------------- */
let leaving = false

export function leaveOnPurpose(go) {
  leaving = true
  go?.()
}
export function isLeavingOnPurpose() { return leaving }

/* Local data is being wiped (delete everything, account deletion): nothing
   may write the in-memory workspace back — not a pending autosave, not the
   pagehide flush on the way out. Checked at write time by AppPage. */
let wiped = false
export function markWiped() { wiped = true }
export function isWiped() { return wiped }
export function _resetLeaving() { leaving = false }
