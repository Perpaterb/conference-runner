/**
 * The attendee schedule (US-050 to US-054).
 *
 * The vertical scale is not uniform. Stretches where this person has something on are drawn at
 * full size; stretches where they have nothing are compressed to about an hour per tick. That
 * keeps a two-day agenda with an overnight gap on one screen, and it means the distance from the
 * top is not a fixed amount per hour, so the now-line is positioned through the same mapping
 * rather than by arithmetic. Since the busy stretches depend on which sessions this person can
 * see, the scale differs from one attendee to the next.
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import {
  buildTimeScale,
  eventPhase,
  hourTicks,
  layoutSessions,
  spanHeight,
  yForEpoch,
  type EventPhase,
} from '../lib/layout'
import {
  epochToZonedParts,
  formatDate,
  formatTime,
  humaniseMinutes,
  minutesUntil,
  timeZoneLabel,
} from '../lib/time'
import type { EventDoc, SessionDoc } from '../lib/types'

export default function Timeline({
  event,
  sessions,
  now,
  phase,
  onOpenSession,
}: {
  event: EventDoc
  sessions: SessionDoc[]
  now: number
  phase: EventPhase
  onOpenSession: (s: SessionDoc) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  /**
   * While true the view keeps the now-line a quarter from the top (US-053). Any manual scroll
   * turns it off so the schedule never fights the user; the "Now" button turns it back on.
   */
  const [following, setFollowing] = useState(true)
  const programmatic = useRef(false)

  const scale = buildTimeScale(sessions, event.startAt, event.endAt)
  const placed = layoutSessions(sessions)
  const nowY = yForEpoch(scale, now)

  const isMidnight = useCallback(
    (epoch: number) => {
      const p = epochToZonedParts(epoch, event.timeZone)
      return p.hour === 0 && p.minute === 0
    },
    [event.timeZone],
  )
  const ticks = hourTicks(scale, isMidnight)

  const snapToNow = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    programmatic.current = true
    el.scrollTo({ top: Math.max(0, nowY - el.clientHeight / 4), behavior: 'smooth' })
    // A smooth scroll emits scroll events for a while; ignoring them stops the animation
    // reading as the user taking over.
    window.setTimeout(() => {
      programmatic.current = false
    }, 800)
  }, [nowY])

  useLayoutEffect(() => {
    if (phase === 'during' && following) snapToNow()
  }, [phase, following, snapToNow])

  const onScroll = () => {
    if (programmatic.current) return
    if (following) setFollowing(false)
  }

  return (
    <>
      <div className="page" style={{ paddingBottom: 0 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <strong>
              {formatDate(event.startAt, event.timeZone)} to{' '}
              {formatDate(event.endAt, event.timeZone)}
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
            <strong>The event starts in {humaniseMinutes(minutesUntil(event.startAt, now))}</strong>
          </div>
        )}
      </div>

      <div className="timeline-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="timeline" style={{ height: scale.totalHeight }}>
          {/* Compressed stretches are shaded, so it is obvious the scale is not uniform. */}
          {scale.segments
            .filter((s) => !s.busy)
            .map((s) => (
              <div
                key={`gap-${s.startAt}`}
                className="quiet-band"
                style={{ top: s.top, height: s.height }}
              >
                {s.height >= 46 && <span>Nothing scheduled for you</span>}
              </div>
            ))}

          {/* The axis: date and time running down the side. */}
          {ticks.map((tick) => (
            <div
              key={tick.epoch}
              className={`hour-line${tick.isDayStart ? ' day-start' : ''}`}
              style={{ top: tick.y }}
            >
              <span className="hour-label">
                {tick.isDayStart ? (
                  <strong>{formatDate(tick.epoch, event.timeZone)}</strong>
                ) : (
                  formatTime(tick.epoch, event.timeZone)
                )}
              </span>
            </div>
          ))}

          {placed.map(({ session, column, columns }) => {
            const top = yForEpoch(scale, session.startAt)
            const height = spanHeight(scale, session.startAt, session.endAt)
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
                {height > 74 && session.description && (
                  <div className="desc">{session.description}</div>
                )}
              </button>
            )
          })}

          {/* US-053: the now-line, above everything, positioned through the same scale. */}
          {phase === 'during' && (
            <div className="now-line" style={{ top: nowY }}>
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

export { eventPhase }
