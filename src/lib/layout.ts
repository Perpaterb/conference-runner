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

// ---------------------------------------------------------------------------
// Non-linear time scale
// ---------------------------------------------------------------------------

/**
 * A fixed pixels-per-minute strip wastes enormous vertical space on the hours when nothing is
 * happening, and an overnight gap pushes the next day off the bottom of the screen entirely.
 *
 * So the scale is piecewise linear instead: stretches where this person has something on are
 * drawn at full size, and stretches where they have nothing are compressed to roughly an hour
 * per tick. Because the busy stretches depend on which sessions this person can see, the scale
 * differs from one attendee to the next, and the now-line has to be positioned through the same
 * mapping rather than by a fixed distance per hour.
 */

/** Full-size scale inside a busy stretch. */
export const BUSY_PIXELS_PER_MINUTE = 2
/** Compressed scale where nothing is scheduled. */
export const EMPTY_PIXELS_PER_HOUR = 22
/** A busy stretch never gets smaller than this, so a five-minute session stays readable. */
export const MIN_BUSY_SEGMENT_PX = 30
/** An empty stretch never grows past this, so an overnight gap cannot dominate the page. */
export const MAX_EMPTY_SEGMENT_PX = 190
/** ...nor shrink below this, so it stays visible as a break in the day. */
export const MIN_EMPTY_SEGMENT_PX = 16

export interface ScaleSegment {
  startAt: number
  endAt: number
  /** True when this person has at least one session running through it. */
  busy: boolean
  top: number
  height: number
}

export interface TimeScale {
  startAt: number
  endAt: number
  segments: ScaleSegment[]
  totalHeight: number
}

export interface Interval {
  startAt: number
  endAt: number
}

/** Overlapping and touching intervals collapse into one. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals]
    .filter((i) => i.endAt > i.startAt)
    .sort((a, b) => a.startAt - b.startAt)
  const merged: Interval[] = []
  for (const next of sorted) {
    const last = merged[merged.length - 1]
    if (last && next.startAt <= last.endAt) {
      last.endAt = Math.max(last.endAt, next.endAt)
    } else {
      merged.push({ ...next })
    }
  }
  return merged
}

export interface ScaleOptions {
  busyPixelsPerMinute?: number
  emptyPixelsPerHour?: number
  minBusySegmentPx?: number
  maxEmptySegmentPx?: number
  minEmptySegmentPx?: number
}

/**
 * Builds the scale for one person's schedule.
 *
 * The range is widened to cover any session falling outside the event's own start and end, so a
 * session scheduled slightly outside the window is still reachable rather than clipped off the
 * top or bottom.
 */
export function buildTimeScale(
  sessions: SessionDoc[],
  rangeStart: number,
  rangeEnd: number,
  options: ScaleOptions = {},
): TimeScale {
  const busyPpm = options.busyPixelsPerMinute ?? BUSY_PIXELS_PER_MINUTE
  const emptyPph = options.emptyPixelsPerHour ?? EMPTY_PIXELS_PER_HOUR
  const minBusy = options.minBusySegmentPx ?? MIN_BUSY_SEGMENT_PX
  const maxEmpty = options.maxEmptySegmentPx ?? MAX_EMPTY_SEGMENT_PX
  const minEmpty = options.minEmptySegmentPx ?? MIN_EMPTY_SEGMENT_PX

  const startAt = Math.min(rangeStart, ...sessions.map((s) => s.startAt))
  const endAt = Math.max(rangeEnd, ...sessions.map((s) => s.endAt))
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
    return { startAt: rangeStart, endAt: rangeEnd, segments: [], totalHeight: 0 }
  }

  const busy = mergeIntervals(sessions).map((i) => ({
    startAt: Math.max(i.startAt, startAt),
    endAt: Math.min(i.endAt, endAt),
  }))

  const segments: ScaleSegment[] = []
  let cursor = startAt
  const pushSegment = (from: number, to: number, isBusy: boolean) => {
    if (to <= from) return
    const minutes = (to - from) / 60000
    const height = isBusy
      ? Math.max(minutes * busyPpm, minBusy)
      : Math.min(Math.max((minutes / 60) * emptyPph, minEmpty), maxEmpty)
    segments.push({ startAt: from, endAt: to, busy: isBusy, top: 0, height })
  }

  for (const interval of busy) {
    if (interval.endAt <= cursor) continue
    pushSegment(cursor, interval.startAt, false)
    pushSegment(Math.max(cursor, interval.startAt), interval.endAt, true)
    cursor = Math.max(cursor, interval.endAt)
  }
  pushSegment(cursor, endAt, false)

  let top = 0
  for (const segment of segments) {
    segment.top = top
    top += segment.height
  }

  return { startAt, endAt, segments, totalHeight: top }
}

/** Vertical position of an instant, through the compressed scale. */
export function yForEpoch(scale: TimeScale, epoch: number): number {
  if (scale.segments.length === 0) return 0
  if (epoch <= scale.startAt) return 0
  if (epoch >= scale.endAt) return scale.totalHeight

  for (const segment of scale.segments) {
    if (epoch >= segment.startAt && epoch <= segment.endAt) {
      const span = segment.endAt - segment.startAt
      if (span <= 0) return segment.top
      return segment.top + ((epoch - segment.startAt) / span) * segment.height
    }
  }
  return scale.totalHeight
}

/** Height of a span measured through the scale, never smaller than `minimum`. */
export function spanHeight(
  scale: TimeScale,
  startAt: number,
  endAt: number,
  minimum = 26,
): number {
  return Math.max(yForEpoch(scale, endAt) - yForEpoch(scale, startAt), minimum)
}

export interface HourTick {
  epoch: number
  y: number
  /** Midnight: the component renders the date rather than just the time. */
  isDayStart: boolean
}

/** An hour mark is only worth drawing this close to a session. */
export const TICK_NEAR_SESSION_MS = 3 * 3_600_000

/**
 * Hour marks down the axis.
 *
 * Two filters apply. Marks more than `nearMs` from any session are dropped: hour lines through
 * the small hours tell nobody anything, and they clutter the compressed bands. Marks that would
 * land within `minGapPx` of the previous one are dropped too, so labels never collide where the
 * scale is compressed.
 *
 * Dates are handled separately, on their own axis, so a day boundary does not need a tick here.
 */
export function hourTicks(
  scale: TimeScale,
  sessions: SessionDoc[],
  options: { nearMs?: number; minGapPx?: number } = {},
): HourTick[] {
  if (scale.segments.length === 0) return []
  const nearMs = options.nearMs ?? TICK_NEAR_SESSION_MS
  const minGapPx = options.minGapPx ?? 18
  const HOUR = 3_600_000

  const nearASession = (epoch: number) =>
    sessions.some((s) => epoch >= s.startAt - nearMs && epoch <= s.endAt + nearMs)

  const ticks: HourTick[] = []
  let lastY = -Infinity

  const first = Math.ceil(scale.startAt / HOUR) * HOUR
  for (let epoch = first; epoch <= scale.endAt; epoch += HOUR) {
    if (!nearASession(epoch)) continue
    const y = yForEpoch(scale, epoch)
    if (y - lastY < minGapPx) continue
    ticks.push({ epoch, y, isDayStart: false })
    lastY = y
  }
  return ticks
}

export type EventPhase = 'before' | 'during' | 'after'

/**
 * The window the schedule actually occupies, widened to cover any session outside the event's
 * own start and end.
 *
 * The two can disagree: an event might be recorded as running 14:21 to 14:22 while its agenda
 * runs all day. Deciding "before / during / after" from the event document alone then reports
 * "starts in 2 hr" while lunch is on. Everything that asks the question uses this instead, so
 * the timeline, the now-line and the status bar cannot disagree with each other.
 */
export function effectiveEventRange(
  sessions: SessionDoc[],
  eventStartAt: number,
  eventEndAt: number,
): { startAt: number; endAt: number } {
  const startAt = Math.min(eventStartAt, ...sessions.map((s) => s.startAt))
  const endAt = Math.max(eventEndAt, ...sessions.map((s) => s.endAt))
  return {
    startAt: Number.isFinite(startAt) ? startAt : eventStartAt,
    endAt: Number.isFinite(endAt) ? endAt : eventEndAt,
  }
}

export function eventPhase(now: number, eventStart: number, eventEnd: number): EventPhase {
  if (now < eventStart) return 'before'
  if (now > eventEnd) return 'after'
  return 'during'
}
