/**
 * Top bar status: how long until things start, what is on now, and what is next (US-059).
 *
 * This replaced a permanent connection indicator. Knowing the socket is healthy is not useful
 * to anybody standing in a room trying to work out where to be; a warning only when the
 * connection is degraded is.
 */

import { conferenceStatus } from '../lib/status'
import { formatTime, humaniseMinutes } from '../lib/time'
import type { EventDoc, SessionDoc } from '../lib/types'

export default function ConferenceStatus({
  event,
  sessions,
  now,
}: {
  event: EventDoc
  /** Already filtered to what this viewer can see. */
  sessions: SessionDoc[]
  now: number
}) {
  const status = conferenceStatus(sessions, event.startAt, event.endAt, now)

  if (status.phase === 'before') {
    return (
      <span className="conf-status">
        <span className="badge accent">
          <span className="clip">Starts in {humaniseMinutes(status.minutesToStart)}</span>
        </span>
        {status.next && (
          <span className="muted small">
            First up: {status.next.title} at {formatTime(status.next.startAt, event.timeZone)}
          </span>
        )}
      </span>
    )
  }

  if (status.phase === 'after') {
    return (
      <span className="conf-status">
        <span className="badge">Event finished</span>
      </span>
    )
  }

  return (
    <span className="conf-status">
      {status.current.length > 0 ? (
        <span className="badge ok" title={status.current.map((s) => s.title).join(', ')}>
          <span className="clip">
            Now: {status.current[0].title}
            {status.current[0].location ? ` · ${status.current[0].location}` : ''}
            {status.current.length > 1 && ` +${status.current.length - 1}`}
          </span>
        </span>
      ) : (
        <span className="badge">Nothing on right now</span>
      )}

      {status.next && (
        <span className="muted small">
          Next: {status.next.title} at {formatTime(status.next.startAt, event.timeZone)}
          {status.minutesToNext <= 60 && ` (${humaniseMinutes(status.minutesToNext)})`}
        </span>
      )}
    </span>
  )
}
