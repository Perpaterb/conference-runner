/**
 * The attendee experience (US-050 to US-057).
 *
 * This decides what one person can see and hands it to the Timeline, which owns the layout.
 * All positioning uses epoch milliseconds, which is time zone independent; only the labels are
 * formatted, always in the event's zone.
 */

import { useEffect, useState } from 'react'
import { eventPhase } from '../lib/layout'
import { dueRequestsFor, visibleSessions } from '../lib/roles'
import { useNow } from '../lib/live'
import { formatDateTime } from '../lib/time'
import { acknowledgeRequest } from '../lib/data'
import type { EventDoc, GroupDoc, MemberDoc, RequestDoc, SessionDoc } from '../lib/types'
import { Modal } from './ui'
import SessionDetail from './SessionDetail'
import Timeline from './Timeline'

export default function AttendeeView({
  event,
  member,
  sessions,
  groups,
  requests,
  viewerEmail,
  readOnly,
  showCoverage = false,
}: {
  event: EventDoc
  member: MemberDoc | undefined
  sessions: SessionDoc[]
  groups: GroupDoc[]
  requests: RequestDoc[]
  viewerEmail: string
  readOnly: boolean
  /** Team members previewing or impersonating see how much of the agenda this person gets. */
  showCoverage?: boolean
}) {
  const now = useNow(15_000)
  const [openSession, setOpenSession] = useState<SessionDoc | null>(null)

  const myGroups = Object.keys(member?.groups ?? {})
  const mine = visibleSessions(sessions, member)
  const phase = eventPhase(now, event.startAt, event.endAt)

  // US-022: someone who has signed in but is in no group sees nothing else.
  if (myGroups.length === 0 && !member?.isTeamMember) {
    return (
      <>
        <div className="page center" style={{ minHeight: '60vh' }}>
          <div className="card" style={{ maxWidth: 460, textAlign: 'center' }}>
            {showCoverage && (
              <p className="badge warn">Sees 0 of {sessions.length} sessions</p>
            )}
            <h2>You are not in any groups</h2>
            <p className="muted">
              You are signed in as {viewerEmail}. Once the event team adds you to a group, your
              schedule appears here automatically.
            </p>
          </div>
        </div>
        <RequestPopups
          event={event}
          requests={requests}
          viewerEmail={viewerEmail}
          now={now}
          readOnly={readOnly}
        />
      </>
    )
  }

  return (
    <>
      {showCoverage && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <span className={`badge ${mine.length === sessions.length ? 'ok' : 'warn'}`}>
            Sees {mine.length} of {sessions.length} sessions
          </span>{' '}
          <span className="muted small">
            {myGroups.length === 0
              ? 'This person is in no groups, so only all-group sessions reach them.'
              : `Group${myGroups.length === 1 ? '' : 's'}: ${myGroups
                  .map((id) => groups.find((g) => g.id === id)?.name ?? id)
                  .join(', ')}`}
          </span>
        </div>
      )}

      <Timeline
        event={event}
        sessions={mine}
        now={now}
        phase={phase}
        onOpenSession={setOpenSession}
      />

      {openSession && (
        <Modal title={openSession.title} onClose={() => setOpenSession(null)} wide>
          <SessionDetail event={event} session={openSession} groups={groups} now={now} />
        </Modal>
      )}

      <RequestPopups
        event={event}
        requests={requests}
        viewerEmail={viewerEmail}
        now={now}
        readOnly={readOnly}
      />
    </>
  )
}

/** US-072: a request pops up for its recipient the moment it becomes due. */
function RequestPopups({
  event,
  requests,
  viewerEmail,
  now,
  readOnly,
}: {
  event: EventDoc
  requests: RequestDoc[]
  viewerEmail: string
  now: number
  readOnly: boolean
}) {
  const due = dueRequestsFor(requests, viewerEmail, now)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // A newly arrived request should reappear even if an older one was dismissed.
  useEffect(() => {
    setDismissed((prev) => {
      const stillDue = new Set(due.map((r) => r.id))
      const next = new Set([...prev].filter((id) => stillDue.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [due])

  const current = due.find((r) => !dismissed.has(r.id))
  if (!current) return null

  return (
    <Modal
      title="You have been asked to attend"
      onClose={() => setDismissed((prev) => new Set(prev).add(current.id))}
    >
      <div className="stack">
        <div className="callout">
          <div>
            <strong>Where:</strong> {current.location || 'Not specified'}
          </div>
          <div>
            <strong>When:</strong> {formatDateTime(current.atTime, event.timeZone)} (
            {event.timeZone})
          </div>
        </div>
        {current.info && <p style={{ whiteSpace: 'pre-wrap' }}>{current.info}</p>}
        <p className="muted small">Sent by {current.createdByEmail}</p>
        {problem && <p className="error small">{problem}</p>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={() => setDismissed((prev) => new Set(prev).add(current.id))}>
            Dismiss
          </button>
          <button
            className="primary"
            disabled={busy || readOnly}
            title={readOnly ? 'Read only while impersonating' : undefined}
            onClick={async () => {
              setBusy(true)
              setProblem(null)
              try {
                await acknowledgeRequest(event.id, current.id)
              } catch (e) {
                setProblem((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Sending…' : "I'll be there"}
          </button>
        </div>
      </div>
    </Modal>
  )
}
