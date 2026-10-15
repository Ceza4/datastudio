/*
  lib/kanban.js
  --------------------------------------------------------------------------
  Kanban geometry shared by the registry (the block's minimum size) and the
  board itself (lane widths), so the two can never disagree. 25 Sep 2026.

  Lanes share the block's width (flex) and never go below LANE_MIN, and the
  block's minimum width is exactly what its lanes need. So the board never
  scrolls sideways: it grows when a lane is added, cannot be resized below
  its lanes, and widening it widens every lane.
  -------------------------------------------------------------------------- */

export const LANE_MIN = 220
export const LANE_GAP = 10
export const BOARD_PAD = 12
export const ADD_LANE_W = 36
export const KANBAN_MIN_H = 300
const BORDER = 3   // the block frame's 1.5px on each side

/** The smallest the block may be for `laneCount` lanes. Never sized for
 *  fewer than two, so an empty board is still a board. */
export function kanbanMinDims(laneCount) {
  const n = Math.max(2, laneCount || 0)
  return {
    w: BOARD_PAD * 2 + n * LANE_MIN + n * LANE_GAP + ADD_LANE_W + BORDER,
    h: KANBAN_MIN_H,
  }
}
