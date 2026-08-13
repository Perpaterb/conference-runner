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

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  buildTimeScale,
  effectiveEventRange,
  eventPhase,
  hourTicks,
  layoutSessions,
  spanHeight,
  yForEpoch,
} from '../lib/layout'
import {
  endOfDayEpoch,
  formatDate,
  formatTime,
  humaniseMinutes,
  minutesUntil,
  startOfDayEpoch,
  timeZoneLabel,
} from '../lib/time'
import type { EventDoc, SessionDoc } from '../lib/types'

export default function Timeline({
  event,
  sessions,
  now,
  onOpenSession,
}: {
  event: EventDoc
  sessions: SessionDoc[]
  now: number
  onOpenSession: (s: SessionDoc) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  /**
   * While true the view keeps the now-line a quarter from the top (US-053). Any manual scroll
   * turns it off so the schedule never fights the user; the "Now" button turns it back on.
   */
  const [following, setFollowing] = useState(true)
  const programmatic = useRef(false)

  // The schedule runs whole days, midnight to midnight, so the morning before the event starts
  // is shown as quiet time rather than the day appearing to begin at 09:00.
  const dayStart = startOfDayEpoch(event.startAt, event.timeZone)
  const dayEnd = endOfDayEpoch(event.endAt, event.timeZone)
  const scale = buildTimeScale(sessions, dayStart, dayEnd)

  // Before / during / after follows the sessions as well as the event's own window, so the
  // countdown cannot claim the event has not started while a session is running.
  const range = effectiveEventRange(sessions, event.startAt, event.endAt)
  const phase = eventPhase(now, range.startAt, range.endAt)
  const placed = layoutSessions(sessions)
  const nowY = yForEpoch(scale, now)
  const nowInRange = now >= scale.startAt && now <= scale.endAt

  // Hour marks only where something is happening, and dates on their own axis so the two can
  // never overlap.
  const ticks = hourTicks(scale, sessions)

  const days = useMemo(() => {
    const bands: { key: number; top: number; height: number; label: string }[] = []
    if (scale.segments.length === 0) return bands
    let cursor = scale.startAt
    for (let guard = 0; guard < 40 && cursor < scale.endAt; guard++) {
      const boundary = Math.min(endOfDayEpoch(cursor, event.timeZone), scale.endAt)
      if (boundary <= cursor) break
      const top = yForEpoch(scale, cursor)
      bands.push({
        key: cursor,
        top,
        height: yForEpoch(scale, boundary) - top,
        label: formatDate(cursor, event.timeZone),
      })
      cursor = boundary
    }
    return bands
  }, [scale, event.timeZone])

  const multiDay = days.length > 1

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
            <strong>The event starts in {humaniseMinutes(minutesUntil(range.startAt, now))}</strong>
          </div>
        )}
      </div>

      <div className="timeline-scroll" ref={scrollRef} onScroll={onScroll}>
        {/*
          The axis is a real grid column rather than content pushed into a negative offset. A
          negatively positioned label inside a scrolling box is clipped and unreachable, which is
          how the times ended up off the left edge.
        */}
        <div
          className={`timeline-grid${multiDay ? ' with-dates' : ''}`}
          style={{ height: scale.totalHeight }}
        >
          {multiDay && (
            <div className="day-axis">
              {days.map((day) => (
                <div
                  key={day.key}
                  className="day-band"
                  style={{ top: day.top, height: day.height }}
                >
                  {day.height >= 60 && <span>{day.label}</span>}
                </div>
              ))}
            </div>
          )}

          <div className="axis">
            {ticks.map((tick) => (
              <span key={tick.epoch} className="hour-label" style={{ top: tick.y }}>
                {formatTime(tick.epoch, event.timeZone)}
              </span>
            ))}
          </div>

          <div className="lanes">
            {/* Compressed stretches are shaded, so it is obvious the scale is not uniform. */}
            {scale.segments
              .filter((seg) => !seg.busy)
              .map((seg) => (
                <div
                  key={`gap-${seg.startAt}`}
                  className="quiet-band"
                  style={{ top: seg.top, height: seg.height }}
                >
                  {seg.height >= 46 && <span>Nothing scheduled for you</span>}
                </div>
              ))}

            {ticks.map((tick) => (
              <div key={tick.epoch} className="hour-line" style={{ top: tick.y }} />
            ))}

            {placed.map(({ session, column, columns }) => {
              const top = yForEpoch(scale, session.startAt)
              const height = spanHeight(scale, session.startAt, session.endAt)
              const widthPct = 100 / columns
              // Short cards drop to two lines, then to one, rather than squeezing three lines
              // into space that cannot hold them.
              const density = height < 46 ? 'tiny' : height < 80 ? 'short' : 'full'
              const times = `${formatTime(session.startAt, event.timeZone)} to ${formatTime(
                session.endAt,
                event.timeZone,
              )}`
              return (
                <button
                  key={session.id}
                  className={`session-card ${density}`}
                  style={{
                    top,
                    height,
                    left: `calc(${column * widthPct}% + 2px)`,
                    width: `calc(${widthPct}% - 6px)`,
                  }}
                  onClick={() => onOpenSession(session)}
                  title={`${session.title} · ${times}${
                    session.location ? ` · ${session.location}` : ''
                  }`}
                >
                  {density === 'tiny' ? (
                    <div className="one-line">
                      <strong>{session.title}</strong>
                      <span className="meta">
                        {' '}
                        · {times}
                        {session.location ? ` · ${session.location}` : ''}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="t">{session.title}</div>
                      <div className="meta">
                        {times}
                        {session.location ? ` · ${session.location}` : ''}
                      </div>
                      {density === 'full' && session.description && (
                        <div className="desc">{session.description}</div>
                      )}
                    </>
                  )}
                </button>
              )
            })}
          </div>

          {/*
            US-053: the now-line, above everything, positioned through the same scale.
            Since the schedule runs midnight to midnight, "before the event" no longer means
            "off the top": at 11:45 on the day of a 14:00 start, the line belongs at 11:45.
            It only pins to the top when now really is outside the displayed range.
          */}
          {nowInRange ? (
            <div className="now-line" style={{ top: nowY }}>
              <span className="now-pill">
                {formatTime(now, event.timeZone)}
                {phase === 'before' &&
                  ` · starts in ${humaniseMinutes(minutesUntil(range.startAt, now))}`}
                {phase === 'after' && ' · finished'}
              </span>
            </div>
          ) : phase === 'before' ? (
            <div className="now-line pinned" style={{ top: 0 }}>
              <span className="now-pill">
                Starts in {humaniseMinutes(minutesUntil(range.startAt, now))}
              </span>
            </div>
          ) : null}
        </div>

        {phase === 'after' && !nowInRange && (
          <div className="now-line finished">
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
