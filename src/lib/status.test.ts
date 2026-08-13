import { describe, expect, it } from 'vitest'
import { conferenceStatus } from './status'
import type { SessionDoc } from './types'

const MIN = 60_000
const START = 100 * MIN
const END = 200 * MIN

function session(id: string, startMin: number, endMin: number, location = ''): SessionDoc {
  return {
    id,
    title: id,
    description: '',
    location,
    startAt: startMin * MIN,
    endAt: endMin * MIN,
    groupIds: [],
    allGroups: true,
  }
}

describe('US-059: conference status', () => {
  const sessions = [
    session('opening', 100, 110, 'Main hall'),
    session('breakout-a', 120, 140, 'Room 1'),
    session('breakout-b', 120, 140, 'Room 2'),
    session('wrap', 180, 200, 'Main hall'),
  ]

  it('counts down before the event and names what is first', () => {
    const status = conferenceStatus(sessions, START, END, 70 * MIN)
    expect(status.phase).toBe('before')
    expect(status.minutesToStart).toBe(30)
    expect(status.next?.id).toBe('opening')
  })

  it('reports what is on now', () => {
    const status = conferenceStatus(sessions, START, END, 105 * MIN)
    expect(status.phase).toBe('during')
    expect(status.current.map((s) => s.id)).toEqual(['opening'])
  })

  it('reports every concurrent session, not just one', () => {
    const status = conferenceStatus(sessions, START, END, 130 * MIN)
    expect(status.current.map((s) => s.id)).toEqual(['breakout-a', 'breakout-b'])
  })

  it('reports nothing on during a gap, and what is next', () => {
    const status = conferenceStatus(sessions, START, END, 115 * MIN)
    expect(status.current).toEqual([])
    expect(status.next?.id).toBe('breakout-a')
    expect(status.minutesToNext).toBe(5)
  })

  it('treats a session as finished the moment it ends', () => {
    const status = conferenceStatus(sessions, START, END, 110 * MIN)
    expect(status.current).toEqual([])
    expect(status.next?.id).toBe('breakout-a')
  })

  it('has no next session once the last one has started', () => {
    const status = conferenceStatus(sessions, START, END, 185 * MIN)
    expect(status.current.map((s) => s.id)).toEqual(['wrap'])
    expect(status.next).toBeNull()
  })

  it('reports the event as finished afterwards', () => {
    const status = conferenceStatus(sessions, START, END, 250 * MIN)
    expect(status.phase).toBe('after')
    expect(status.current).toEqual([])
  })

  it('is computed from the sessions passed in, so it is per viewer', () => {
    // An attendee only in the Room 2 breakout should be told about that one, not Room 1.
    const theirs = [session('breakout-b', 120, 140, 'Room 2')]
    const status = conferenceStatus(theirs, START, END, 115 * MIN)
    expect(status.next?.location).toBe('Room 2')
  })

  it('copes with an attendee who has no sessions at all', () => {
    const status = conferenceStatus([], START, END, 130 * MIN)
    expect(status.current).toEqual([])
    expect(status.next).toBeNull()
    expect(status.phase).toBe('during')
  })

  it('never reports a negative countdown', () => {
    expect(conferenceStatus(sessions, START, END, 150 * MIN).minutesToStart).toBe(0)
  })
})

describe('when the event window disagrees with its own agenda', () => {
  // Exactly the reported case: an event recorded as running 14:21 to 14:22 while its imported
  // agenda covers the whole day. Judging the phase from the event document alone reported
  // "starts in 2 hr" while lunch was actually on.
  const NARROW_START = (14 * 60 + 21) * MIN
  const NARROW_END = (14 * 60 + 22) * MIN
  const agenda = [
    session('opening', 9 * 60, 10 * 60, 'Main hall'),
    session('lunch', 12 * 60, 13 * 60, 'Foyer'),
    session('wrap', 16 * 60, 17 * 60, 'Main hall'),
  ]

  it('reports the event as under way while a session is running', () => {
    const status = conferenceStatus(agenda, NARROW_START, NARROW_END, 12 * 60 * MIN + 30 * MIN)
    expect(status.phase).toBe('during')
    expect(status.current.map((s) => s.id)).toEqual(['lunch'])
  })

  it('does not claim the event is yet to start', () => {
    const status = conferenceStatus(agenda, NARROW_START, NARROW_END, 12 * 60 * MIN + 30 * MIN)
    expect(status.minutesToStart).toBe(0)
  })

  it('counts down to the first session, not to the recorded start', () => {
    const status = conferenceStatus(agenda, NARROW_START, NARROW_END, 8 * 60 * MIN)
    expect(status.phase).toBe('before')
    expect(status.minutesToStart).toBe(60)
  })

  it('is only finished once the last session has ended', () => {
    expect(conferenceStatus(agenda, NARROW_START, NARROW_END, 15 * 60 * MIN).phase).toBe('during')
    expect(conferenceStatus(agenda, NARROW_START, NARROW_END, 18 * 60 * MIN).phase).toBe('after')
  })

  it('falls back to the event window when there are no sessions', () => {
    const status = conferenceStatus([], NARROW_START, NARROW_END, 12 * 60 * MIN)
    expect(status.phase).toBe('before')
    expect(status.minutesToStart).toBe(141)
  })
})
