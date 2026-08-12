/**
 * Timeline layout maths (US-052, US-054). Pure and epoch-based, so it is time zone independent.
 */

import type { SessionDoc } from './types'

export interface PlacedSession {
  session: SessionDoc
  /** 0-based column within its overlap cluster. */
  column: number
  /** How many columns the cluster needs, so widths can be `100 / columns`. */
  columns: number
}

/**
 * Assigns concurrent sessions to side-by-side columns.
 *
 * Sessions are grouped into clusters of transitively overlapping items; within a cluster each
 * session takes the first column whose last session has already finished. Every session in a
 * cluster reports the same `columns` count so their widths line up.
 */
export function layoutSessions(sessions: SessionDoc[]): PlacedSession[] {
  const ordered = [...sessions].sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt)
  const placed: PlacedSession[] = []

  let cluster: PlacedSession[] = []
  let clusterEnd = -Infinity
  let columnEnds: number[] = []

  const flush = () => {
    const columns = Math.max(columnEnds.length, 1)
    for (const item of cluster) placed.push({ ...item, columns })
    cluster = []
    columnEnds = []
    clusterEnd = -Infinity
  }

  for (const session of ordered) {
    // A new cluster starts once nothing already placed is still running.
    if (session.startAt >= clusterEnd && cluster.length > 0) flush()

    let column = columnEnds.findIndex((end) => end <= session.startAt)
    if (column === -1) {
      column = columnEnds.length
      columnEnds.push(session.endAt)
    } else {
      columnEnds[column] = session.endAt
    }

    cluster.push({ session, column, columns: 0 })
    clusterEnd = Math.max(clusterEnd, session.endAt)
  }
  if (cluster.length > 0) flush()

  return placed
}

export interface Gap {
  startAt: number
  endAt: number
}

/**
 * Stretches of the event with no session at all for this attendee. Used to render the
 * "nothing scheduled" background text.
 */
export function findGaps(sessions: SessionDoc[], eventStart: number, eventEnd: number): Gap[] {
  if (eventEnd <= eventStart) return []
  const ordered = [...sessions].sort((a, b) => a.startAt - b.startAt)
  const gaps: Gap[] = []
  let cursor = eventStart

  for (const session of ordered) {
    if (session.endAt <= cursor) continue
    if (session.startAt > cursor) {
      gaps.push({ startAt: cursor, endAt: Math.min(session.startAt, eventEnd) })
    }
    cursor = Math.max(cursor, session.endAt)
    if (cursor >= eventEnd) break
  }
  if (cursor < eventEnd) gaps.push({ startAt: cursor, endAt: eventEnd })

  return gaps.filter((g) => g.endAt > g.startAt)
}

/**
 * The timeline is a fixed pixels-per-minute strip, so an epoch maps to a vertical offset.
 * Kept here rather than in the component so it can be tested.
 */
export function offsetForEpoch(epoch: number, eventStart: number, pixelsPerMinute: number): number {
  return ((epoch - eventStart) / 60000) * pixelsPerMinute
}

export function heightForRange(
  startAt: number,
  endAt: number,
  pixelsPerMinute: number,
  minimum = 44,
): number {
  return Math.max(((endAt - startAt) / 60000) * pixelsPerMinute, minimum)
}

export type EventPhase = 'before' | 'during' | 'after'

export function eventPhase(now: number, eventStart: number, eventEnd: number): EventPhase {
  if (now < eventStart) return 'before'
  if (now > eventEnd) return 'after'
  return 'during'
}
