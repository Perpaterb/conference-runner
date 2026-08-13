/**
 * "What is happening right now" for the top bar (US-059).
 *
 * Computed from the sessions the viewer can actually see, so an attendee gets their own next
 * session rather than the event's.
 */

import { eventPhase, type EventPhase } from './layout'
import type { SessionDoc } from './types'

export interface ConferenceStatus {
  phase: EventPhase
  /** Sessions running right now, earliest first. */
  current: SessionDoc[]
  /** The next session that has not started yet, if any. */
  next: SessionDoc | null
  /** Minutes until the event starts; only meaningful before it does. */
  minutesToStart: number
  /** Minutes until `next` begins. */
  minutesToNext: number
}

export function conferenceStatus(
  sessions: SessionDoc[],
  eventStartAt: number,
  eventEndAt: number,
  now: number,
): ConferenceStatus {
  const current = sessions
    .filter((s) => s.startAt <= now && now < s.endAt)
    .sort((a, b) => a.startAt - b.startAt)

  const upcoming = sessions
    .filter((s) => s.startAt > now)
    .sort((a, b) => a.startAt - b.startAt)
  const next = upcoming[0] ?? null

  return {
    phase: eventPhase(now, eventStartAt, eventEndAt),
    current,
    next,
    minutesToStart: Math.max(0, Math.ceil((eventStartAt - now) / 60000)),
    minutesToNext: next ? Math.max(0, Math.ceil((next.startAt - now) / 60000)) : 0,
  }
}
