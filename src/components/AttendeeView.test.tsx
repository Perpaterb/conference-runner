/**
 * Component tests for the attendee experience.
 *
 * These render the real component with real props, so they cover what an attendee actually sees.
 * They deliberately stop short of opening a session, which would subscribe to Firestore.
 */

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AttendeeView from './AttendeeView'
import { computeLedGroupIds } from '../lib/types'
import type { EventDoc, MemberDoc, RequestDoc, SessionDoc } from '../lib/types'
import { zonedTimeToEpoch } from '../lib/time'

const SYDNEY = 'Australia/Sydney'
const at = (h: number, m = 0) => zonedTimeToEpoch(2026, 6, 28, h, m, SYDNEY)

const event: EventDoc = {
  id: 'abcdefghij',
  name: 'PI Planning',
  ownerUid: 'owner-uid',
  ownerEmail: 'owner@x.com',
  startAt: at(9),
  endAt: at(17),
  timeZone: SYDNEY,
  createdAt: 0,
}

function member(groups: Record<string, { leader: boolean }> = {}): MemberDoc {
  return {
    id: 'a@x.com',
    email: 'a@x.com',
    isTeamMember: false,
    groups,
    isLeader: computeLedGroupIds(groups).length > 0,
    ledGroupIds: computeLedGroupIds(groups),
  }
}

function session(over: Partial<SessionDoc> & { id: string }): SessionDoc {
  return {
    title: over.id,
    description: '',
    location: '',
    startAt: at(10),
    endAt: at(11),
    groupIds: [],
    allGroups: true,
    ...over,
  }
}

const noRequests: RequestDoc[] = []

function renderView(props: Partial<Parameters<typeof AttendeeView>[0]> = {}) {
  return render(
    <AttendeeView
      event={event}
      member={member({ platform: { leader: false } })}
      sessions={[]}
      groups={[]}
      requests={noRequests}
      viewerEmail="a@x.com"
      readOnly={false}
      {...props}
    />,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('US-022: someone in no groups', () => {
  it('sees only their email and that they are in no groups', () => {
    vi.setSystemTime(at(10))
    renderView({ member: member(), sessions: [session({ id: 'plenary' })] })

    expect(screen.getByText('You are not in any groups')).toBeInTheDocument()
    expect(screen.getByText(/a@x\.com/)).toBeInTheDocument()
    expect(screen.queryByText('plenary')).not.toBeInTheDocument()
  })
})

describe('US-051: session cards', () => {
  it('shows title, times and location in the event time zone', () => {
    vi.setSystemTime(at(10))
    renderView({
      sessions: [
        session({
          id: 's1',
          title: 'Opening plenary',
          location: 'Main hall',
          startAt: at(9),
          endAt: at(10, 30),
        }),
      ],
    })

    expect(screen.getByText('Opening plenary')).toBeInTheDocument()
    expect(screen.getByText(/09:00 to 10:30/)).toBeInTheDocument()
    expect(screen.getByText(/Main hall/)).toBeInTheDocument()
  })

  it('renders times in the event zone even when the device is elsewhere', () => {
    // The card must read 09:00 because the event is in Sydney, whatever the device thinks.
    vi.setSystemTime(at(10))
    renderView({ sessions: [session({ id: 's1', startAt: at(9), endAt: at(10) })] })
    expect(screen.getByText(/09:00 to 10:00/)).toBeInTheDocument()
  })
})

describe('US-041: attendees only see their own sessions', () => {
  it('hides a session belonging to another group', () => {
    vi.setSystemTime(at(10))
    renderView({
      member: member({ platform: { leader: false } }),
      sessions: [
        session({ id: 'mine', title: 'Platform breakout', groupIds: ['platform'], allGroups: false }),
        session({ id: 'theirs', title: 'Design breakout', groupIds: ['design'], allGroups: false }),
      ],
    })

    expect(screen.getByText('Platform breakout')).toBeInTheDocument()
    expect(screen.queryByText('Design breakout')).not.toBeInTheDocument()
  })
})

describe('US-053: the current time line', () => {
  it('counts down before the event starts', () => {
    vi.setSystemTime(at(8, 30))
    renderView()
    expect(screen.getByText(/The event starts in 30 min/)).toBeInTheDocument()
  })

  it('shows the current time during the event', () => {
    vi.setSystemTime(at(11, 15))
    renderView()
    expect(screen.getByText('11:15')).toBeInTheDocument()
    expect(screen.queryByText(/The event starts in/)).not.toBeInTheDocument()
  })

  it('marks the line as finished later the same day', () => {
    vi.setSystemTime(at(18))
    renderView()
    // 18:00 is still on the displayed day, so the line stays where it belongs and says so.
    expect(screen.getByText(/18:00 · finished/)).toBeInTheDocument()
  })

  it('drops the line below the schedule once the day is over', () => {
    // Two days after the event: now is outside the displayed range entirely.
    vi.setSystemTime(at(10) + 2 * 86_400_000)
    renderView()
    expect(screen.getByText('The event has finished')).toBeInTheDocument()
  })

  it('shows the real current time before the event starts, not just a countdown', () => {
    // Regression: the line pinned to the top whenever the event had not started, so at 11:45 on
    // the morning of a 14:00 start it showed no time at all. Since the schedule now runs from
    // midnight, 11:45 is on screen and the line belongs there.
    vi.setSystemTime(at(11, 45))
    const laterEvent = { ...event, startAt: at(14), endAt: at(16) }
    render(
      <AttendeeView
        event={laterEvent}
        member={member({ platform: { leader: false } })}
        sessions={[session({ id: 's1', startAt: at(14), endAt: at(15) })]}
        groups={[]}
        requests={noRequests}
        viewerEmail="a@x.com"
        readOnly={false}
      />,
    )

    const pill = document.querySelector('.now-line .now-pill')!
    expect(pill.textContent).toContain('11:45')
    expect(pill.textContent).toContain('starts in 2 hr, 15 min')
  })
})

describe('US-054: empty stretches', () => {
  it('tells the attendee when nothing is scheduled for them', () => {
    vi.setSystemTime(at(10))
    renderView({ sessions: [session({ id: 's1', startAt: at(9), endAt: at(10) })] })
    expect(screen.getAllByText('Nothing scheduled for you').length).toBeGreaterThan(0)
  })

  it('shows no quiet band when sessions cover the whole day', () => {
    vi.setSystemTime(at(10))
    renderView({ sessions: [session({ id: 's1', startAt: at(0), endAt: at(24) })] })
    expect(screen.queryByText('Nothing scheduled for you')).not.toBeInTheDocument()
  })

  it('shows quiet time before the event starts, since the day runs from midnight', () => {
    vi.setSystemTime(at(10))
    renderView({ sessions: [session({ id: 's1', startAt: at(9), endAt: at(17) })] })
    // 00:00 to 09:00 and 17:00 to midnight are both quiet for this attendee.
    expect(screen.getAllByText('Nothing scheduled for you')).toHaveLength(2)
  })
})

describe('US-072: attendance request pop-up', () => {
  const request = (over: Partial<RequestDoc> = {}): RequestDoc => ({
    id: 'r1',
    batchId: 'b1',
    createdByUid: 'lead-uid',
    createdByEmail: 'lead@x.com',
    recipientEmail: 'a@x.com',
    location: 'Room 2',
    atTime: at(14),
    info: 'Bring the dependency board',
    sendAt: at(9),
    createdAt: at(9),
    ackedAt: null,
    viaGroupId: 'platform',
    ...over,
  })

  it('pops up with the location, time and extra information', () => {
    vi.setSystemTime(at(10))
    renderView({ requests: [request()] })

    expect(screen.getByText('You have been asked to attend')).toBeInTheDocument()
    expect(screen.getByText(/Room 2/)).toBeInTheDocument()
    expect(screen.getByText(/28 Jun 2026, 14:00/)).toBeInTheDocument()
    expect(screen.getByText('Bring the dependency board')).toBeInTheDocument()
    expect(screen.getByText(/lead@x\.com/)).toBeInTheDocument()
  })

  it('stays hidden until a scheduled send time arrives (US-071)', () => {
    vi.setSystemTime(at(10))
    renderView({ requests: [request({ sendAt: at(16) })] })
    expect(screen.queryByText('You have been asked to attend')).not.toBeInTheDocument()
  })

  it('does not pop up for a request addressed to someone else', () => {
    vi.setSystemTime(at(10))
    renderView({ requests: [request({ recipientEmail: 'other@x.com' })] })
    expect(screen.queryByText('You have been asked to attend')).not.toBeInTheDocument()
  })

  it('does not pop up once acknowledged', () => {
    vi.setSystemTime(at(10))
    renderView({ requests: [request({ ackedAt: at(9, 30) })] })
    expect(screen.queryByText('You have been asked to attend')).not.toBeInTheDocument()
  })

  it('reaches an attendee who is in no groups at all', () => {
    vi.setSystemTime(at(10))
    renderView({ member: member(), requests: [request()] })
    expect(screen.getByText('You have been asked to attend')).toBeInTheDocument()
  })

  it('disables acknowledgement while a team member is impersonating (US-061)', () => {
    vi.setSystemTime(at(10))
    renderView({ requests: [request()], readOnly: true })
    expect(screen.getByRole('button', { name: /I'll be there/ })).toBeDisabled()
  })
})

describe('US-061: what a team member sees while impersonating', () => {
  const sessions = [
    session({ id: 'plenary', title: 'Opening plenary', allGroups: true }),
    session({
      id: 'plat',
      title: 'Platform breakout',
      groupIds: ['platform'],
      allGroups: false,
      startAt: at(11),
      endAt: at(12),
    }),
    session({
      id: 'design',
      title: 'Design breakout',
      groupIds: ['design'],
      allGroups: false,
      startAt: at(13),
      endAt: at(14),
    }),
  ]

  it('reports how much of the agenda that person actually gets', () => {
    vi.setSystemTime(at(10))
    renderView({
      member: member({ platform: { leader: false } }),
      sessions,
      showCoverage: true,
    })

    expect(screen.getByText('Sees 2 of 3 sessions')).toBeInTheDocument()
    expect(screen.getByText(/Group: platform/)).toBeInTheDocument()
  })

  it('shows every session when the person is in every relevant group', () => {
    vi.setSystemTime(at(10))
    renderView({
      member: member({ platform: { leader: false }, design: { leader: false } }),
      sessions,
      showCoverage: true,
    })

    expect(screen.getByText('Sees 3 of 3 sessions')).toBeInTheDocument()
    expect(screen.getByText('Platform breakout')).toBeInTheDocument()
    expect(screen.getByText('Design breakout')).toBeInTheDocument()
  })

  it('explains an empty schedule rather than looking broken', () => {
    vi.setSystemTime(at(10))
    renderView({ member: member(), sessions, showCoverage: true })

    expect(screen.getByText('Sees 0 of 3 sessions')).toBeInTheDocument()
    expect(screen.getByText('You are not in any groups')).toBeInTheDocument()
  })

  it('says nothing about coverage for an ordinary attendee', () => {
    vi.setSystemTime(at(10))
    renderView({ member: member({ platform: { leader: false } }), sessions })
    expect(screen.queryByText(/Sees \d+ of/)).not.toBeInTheDocument()
  })
})

describe('sessions outside the event window', () => {
  it('still renders a session that starts before the event does', () => {
    // Previously the timeline ran strictly from event start to event end, so a session outside
    // that window was positioned off the strip and simply never appeared.
    vi.setSystemTime(at(10))
    renderView({
      sessions: [session({ id: 'early', title: 'Early setup', startAt: at(7), endAt: at(8) })],
    })
    expect(screen.getByText('Early setup')).toBeInTheDocument()
  })

  it('still renders a session that runs past the event end', () => {
    vi.setSystemTime(at(10))
    renderView({
      sessions: [session({ id: 'late', title: 'Late retro', startAt: at(18), endAt: at(19) })],
    })
    expect(screen.getByText('Late retro')).toBeInTheDocument()
  })
})

describe('the time axis', () => {
  it('runs hour labels down the side', () => {
    vi.setSystemTime(at(10))
    renderView({ sessions: [session({ id: 's1', startAt: at(9), endAt: at(12) })] })
    for (const label of ['10:00', '11:00', '12:00']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it('marks a quiet stretch instead of leaving dead space', () => {
    vi.setSystemTime(at(10))
    renderView({ sessions: [session({ id: 's1', startAt: at(9), endAt: at(10) })] })
    expect(screen.getAllByText('Nothing scheduled for you').length).toBeGreaterThan(0)
  })
})

describe('the day runs midnight to midnight', () => {
  it('shows the small hours as quiet time rather than starting the day at 09:00', () => {
    vi.setSystemTime(at(10))
    renderView({ sessions: [session({ id: 's1', startAt: at(9), endAt: at(10) })] })
    // A quiet band before the first session, and another after the last one.
    expect(screen.getAllByText('Nothing scheduled for you')).toHaveLength(2)
  })

  it('puts no hour marks through the small hours, where nothing is on', () => {
    vi.setSystemTime(at(10))
    renderView({ sessions: [session({ id: 's1', startAt: at(9), endAt: at(10) })] })

    // Marks appear around the session and nowhere else.
    expect(screen.getAllByText(/0[6-9]:00|1[0-3]:00/).length).toBeGreaterThan(0)
    expect(screen.queryByText('02:00')).not.toBeInTheDocument()
    expect(screen.queryByText('22:00')).not.toBeInTheDocument()
  })

  it('gives a multi-day event its own date axis', () => {
    vi.setSystemTime(at(10))
    const twoDay = { ...event, endAt: at(17) + 86_400_000 }
    render(
      <AttendeeView
        event={twoDay}
        member={member({ platform: { leader: false } })}
        sessions={[session({ id: 's1', startAt: at(9), endAt: at(10) })]}
        groups={[]}
        requests={noRequests}
        viewerEmail="a@x.com"
        readOnly={false}
      />,
    )
    const bands = document.querySelectorAll('.day-band')
    expect(bands.length).toBe(2)
    expect(bands[0].textContent).toBe('28 Jun 2026')
    expect(bands[1].textContent).toBe('29 Jun 2026')
  })
})

describe('card density', () => {
  const cardFor = (title: string) => screen.getByText(title).closest('button')!

  it('gives a 15 minute session a single clipped line', () => {
    vi.setSystemTime(at(10))
    renderView({
      sessions: [
        session({ id: 'a', title: 'Standup', startAt: at(9), endAt: at(9, 15), location: 'Room 1' }),
        session({ id: 'b', title: 'Filler', startAt: at(9, 15), endAt: at(12) }),
      ],
    })
    expect(cardFor('Standup').className).toContain('tiny')
  })

  it('gives a long session room for its description', () => {
    vi.setSystemTime(at(10))
    renderView({
      sessions: [
        session({
          id: 'a',
          title: 'Workshop',
          description: 'Bring the dependency board',
          startAt: at(9),
          endAt: at(12),
        }),
      ],
    })
    expect(cardFor('Workshop').className).toContain('full')
    expect(screen.getByText('Bring the dependency board')).toBeInTheDocument()
  })
})

describe('an event window narrower than its own agenda', () => {
  // The reported case: the event is recorded as one minute long, but the imported agenda runs
  // all day. The schedule must follow what is scheduled.
  const narrowEvent = { ...event, startAt: at(14, 21), endAt: at(14, 22) }
  const agenda = [
    session({ id: 'opening', title: 'Opening', startAt: at(9), endAt: at(10) }),
    session({ id: 'lunch', title: 'Lunch', startAt: at(12), endAt: at(13) }),
  ]

  const renderNarrow = () =>
    render(
      <AttendeeView
        event={narrowEvent}
        member={member({ platform: { leader: false } })}
        sessions={agenda}
        groups={[]}
        requests={noRequests}
        viewerEmail="a@x.com"
        readOnly={false}
      />,
    )

  it('does not claim the event is yet to start while a session is running', () => {
    vi.setSystemTime(at(12, 30))
    renderNarrow()

    expect(screen.queryByText(/The event starts in/)).not.toBeInTheDocument()
    const pill = document.querySelector('.now-line .now-pill')!
    expect(pill.textContent).toBe('12:30')
  })

  it('still counts down before the first session', () => {
    vi.setSystemTime(at(8))
    renderNarrow()
    expect(screen.getByText(/The event starts in 1 hr/)).toBeInTheDocument()
  })

  it('reports finished only after the last session', () => {
    vi.setSystemTime(at(16))
    renderNarrow()
    const pill = document.querySelector('.now-line .now-pill')!
    expect(pill.textContent).toContain('finished')
  })
})
