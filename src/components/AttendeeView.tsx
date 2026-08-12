/**
 * The attendee experience (US-050 to US-057).
 *
 * The timeline is a fixed pixels-per-minute strip running from the event start to the event end,
 * so vertical position maps directly to time. All positioning uses epoch milliseconds, which is
 * time zone independent; only the labels are formatted in the event's zone.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  eventPhase,
  findGaps,
  heightForRange,
  layoutSessions,
  offsetForEpoch,
} from '../lib/layout'
import { dueRequestsFor, visibleSessions } from '../lib/roles'
import { useNow } from '../lib/live'
import {
  formatDate,
  formatDateTime,
  formatTime,
  humaniseMinutes,
  minutesUntil,
  timeZoneLabel,
} from '../lib/time'
import { acknowledgeRequest } from '../lib/data'
import type { EventDoc, GroupDoc, MemberDoc, RequestDoc, SessionDoc } from '../lib/types'
import { Modal } from './ui'
import SessionDetail from './SessionDetail'

const PIXELS_PER_MINUTE = 2
const HOUR_MS = 3_600_000

export default function AttendeeView({
  event,
  member,
  sessions,
  groups,
  requests,
  viewerEmail,
  readOnly,
}: {
  event: EventDoc
  member: MemberDoc | undefined
  sessions: SessionDoc[]
  groups: GroupDoc[]
  requests: RequestDoc[]
  viewerEmail: string
  readOnly: boolean
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

function Timeline({
  event,
  sessions,
  now,
  phase,
  onOpenSession,
}: {
  event: EventDoc
  sessions: SessionDoc[]
  now: number
  phase: 'before' | 'during' | 'after'
  onOpenSession: (s: SessionDoc) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  /**
   * While true, the view keeps the now line one quarter from the top (US-053). Any manual
   * scroll turns it off, so the schedule never fights the user; the "Now" button turns it back
   * on. This is how the snap coexists with a scrollable timeline.
   */
  const [following, setFollowing] = useState(true)
  const programmatic = useRef(false)

  const placed = layoutSessions(sessions)
  const gaps = findGaps(sessions, event.startAt, event.endAt)
  const totalHeight = heightForRange(event.startAt, event.endAt, PIXELS_PER_MINUTE, 200)
  const nowOffset = offsetForEpoch(now, event.startAt, PIXELS_PER_MINUTE)

  const snapToNow = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    programmatic.current = true
    el.scrollTo({ top: Math.max(0, nowOffset - el.clientHeight / 4), behavior: 'smooth' })
    // The smooth scroll emits scroll events for a while; ignore them so they do not read as
    // the user taking over.
    window.setTimeout(() => {
      programmatic.current = false
    }, 800)
  }, [nowOffset])

  useLayoutEffect(() => {
    if (phase === 'during' && following) snapToNow()
  }, [phase, following, snapToNow])

  const onScroll = () => {
    if (programmatic.current) return
    if (following) setFollowing(false)
  }

  // Hour gridlines across the whole event.
  const hours: number[] = []
  const firstHour = Math.ceil(event.startAt / HOUR_MS) * HOUR_MS
  for (let t = firstHour; t <= event.endAt; t += HOUR_MS) hours.push(t)

  return (
    <>
      <div className="page" style={{ paddingBottom: 0 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <strong>
              {formatDate(event.startAt, event.timeZone)} to {formatDate(event.endAt, event.timeZone)}
            </strong>
            <span className="muted small">
              {' '}
              All times in {event.timeZone} ({timeZoneLabel(event.timeZone, event.startAt)})
            </span>
          </div>
        </div>

        {phase === 'before' && (
          <div className="now-banner">
            <span className="now-pill">Now</span>
            <strong>
              The event starts in {humaniseMinutes(minutesUntil(event.startAt, now))}
            </strong>
          </div>
        )}
      </div>

      <div className="timeline-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="timeline" style={{ height: totalHeight }}>
          {hours.map((t) => (
            <div key={t} className="hour-line" style={{ top: offsetForEpoch(t, event.startAt, PIXELS_PER_MINUTE) }}>
              <span className="hour-label">{formatTime(t, event.timeZone)}</span>
            </div>
          ))}

          {/* US-054: nothing scheduled for this attendee in this stretch. */}
          {gaps.map((gap) => {
            const top = offsetForEpoch(gap.startAt, event.startAt, PIXELS_PER_MINUTE)
            const height = heightForRange(gap.startAt, gap.endAt, PIXELS_PER_MINUTE, 0)
            if (height < 28) return null
            return (
              <div key={`${gap.startAt}-${gap.endAt}`} className="gap-note" style={{ top, height }}>
                Nothing scheduled for you
              </div>
            )
          })}

          {placed.map(({ session, column, columns }) => {
            const top = offsetForEpoch(session.startAt, event.startAt, PIXELS_PER_MINUTE)
            const height = heightForRange(session.startAt, session.endAt, PIXELS_PER_MINUTE)
            const widthPct = 100 / columns
            return (
              <button
                key={session.id}
                className="session-card"
                style={{
                  top,
                  height,
                  left: `calc(${column * widthPct}% + 2px)`,
                  width: `calc(${widthPct}% - 6px)`,
                }}
                onClick={() => onOpenSession(session)}
              >
                <div className="t">{session.title}</div>
                <div className="meta">
                  {formatTime(session.startAt, event.timeZone)} to{' '}
                  {formatTime(session.endAt, event.timeZone)}
                  {session.location ? ` · ${session.location}` : ''}
                </div>
                {height > 70 && session.description && (
                  <div className="desc">{session.description}</div>
                )}
              </button>
            )
          })}

          {/* US-053: the now line, always above the cards. */}
          {phase === 'during' && (
            <div className="now-line" style={{ top: nowOffset }}>
              <span className="now-pill">{formatTime(now, event.timeZone)}</span>
            </div>
          )}
          {phase === 'before' && (
            <div className="now-line" style={{ top: 0 }}>
              <span className="now-pill">
                Starts in {humaniseMinutes(minutesUntil(event.startAt, now))}
              </span>
            </div>
          )}
        </div>

        {phase === 'after' && (
          <div className="now-line" style={{ position: 'relative', marginTop: '1rem' }}>
            <span className="now-pill">The event has finished</span>
          </div>
        )}
      </div>

      {phase === 'during' && !following && (
        <button
          className="primary now-button"
          onClick={() => {
            setFollowing(true)
            snapToNow()
          }}
        >
          Now
        </button>
      )}
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
