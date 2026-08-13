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

  it('reports the event as finished afterwards', () => {
    vi.setSystemTime(at(18))
    renderView()
    expect(screen.getByText('The event has finished')).toBeInTheDocument()
  })
})

describe('US-054: empty stretches', () => {
  it('tells the attendee when nothing is scheduled for them', () => {
    vi.setSystemTime(at(10))
    renderView({ sessions: [session({ id: 's1', startAt: at(9), endAt: at(10) })] })
    expect(screen.getAllByText('Nothing scheduled for you').length).toBeGreaterThan(0)
  })

  it('shows no such note when sessions cover the whole event', () => {
    vi.setSystemTime(at(10))
    renderView({ sessions: [session({ id: 's1', startAt: at(9), endAt: at(17) })] })
    expect(screen.queryByText('Nothing scheduled for you')).not.toBeInTheDocument()
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
