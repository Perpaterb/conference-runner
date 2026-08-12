import { describe, expect, it } from 'vitest'
import {
  attendeeContent,
  canManageGroup,
  canRequestOf,
  contentState,
  dueRequestsFor,
  isTeam,
  ledGroupIds,
  resolveRole,
  visibleSessions,
} from './roles'
import type { ContentDoc, MemberDoc, SessionDoc } from './types'
import { computeLedGroupIds } from './types'

const event = { ownerUid: 'owner-uid', ownerEmail: 'owner@x.com' }

function member(partial: Partial<MemberDoc> & { email: string }): MemberDoc {
  const groups = partial.groups ?? {}
  return {
    id: partial.email,
    isTeamMember: false,
    groups,
    isLeader: computeLedGroupIds(groups).length > 0,
    ledGroupIds: computeLedGroupIds(groups),
    ...partial,
  }
}

describe('resolveRole (US-035)', () => {
  it('ranks owner above everything, by uid', () => {
    const m = member({ email: 'owner@x.com', isTeamMember: false })
    expect(resolveRole(event, m, 'owner-uid', 'owner@x.com')).toBe('owner')
  })

  it('recognises the owner by email even before their uid is recorded', () => {
    expect(resolveRole(event, undefined, 'other-uid', 'OWNER@x.com')).toBe('owner')
  })

  it('ranks event team member above group leader', () => {
    const m = member({
      email: 'a@x.com',
      isTeamMember: true,
      groups: { g1: { leader: true } },
    })
    expect(resolveRole(event, m, 'uid', 'a@x.com')).toBe('team')
  })

  it('ranks group leader above group member', () => {
    const m = member({
      email: 'a@x.com',
      groups: { g1: { leader: false }, g2: { leader: true } },
    })
    expect(resolveRole(event, m, 'uid', 'a@x.com')).toBe('leader')
  })

  it('returns member for a plain group member', () => {
    const m = member({ email: 'a@x.com', groups: { g1: { leader: false } } })
    expect(resolveRole(event, m, 'uid', 'a@x.com')).toBe('member')
  })

  it('returns loggedIn for someone in no groups (US-022)', () => {
    expect(resolveRole(event, member({ email: 'a@x.com' }), 'uid', 'a@x.com')).toBe('loggedIn')
  })

  it('returns loggedIn when no member record exists yet', () => {
    expect(resolveRole(event, undefined, 'uid', 'new@x.com')).toBe('loggedIn')
  })

  it('treats only owner and team as team', () => {
    expect(isTeam('owner')).toBe(true)
    expect(isTeam('team')).toBe(true)
    expect(isTeam('leader')).toBe(false)
    expect(isTeam('member')).toBe(false)
    expect(isTeam('loggedIn')).toBe(false)
  })
})

describe('group management scoping (US-033, US-034)', () => {
  const leader = member({
    email: 'lead@x.com',
    groups: { platform: { leader: true }, design: { leader: false } },
  })

  it('lists only the groups actually led', () => {
    expect(ledGroupIds(leader)).toEqual(['platform'])
  })

  it('lets a team member manage any group', () => {
    expect(canManageGroup('team', undefined, 'anything')).toBe(true)
    expect(canManageGroup('owner', undefined, 'anything')).toBe(true)
  })

  it('lets a leader manage the group they lead', () => {
    expect(canManageGroup('leader', leader, 'platform')).toBe(true)
  })

  it('does NOT let a leader manage a group they are merely a member of', () => {
    expect(canManageGroup('leader', leader, 'design')).toBe(false)
  })

  it('does not let a plain member manage anything', () => {
    const plain = member({ email: 'p@x.com', groups: { platform: { leader: false } } })
    expect(canManageGroup('member', plain, 'platform')).toBe(false)
  })
})

describe('request scoping (US-073)', () => {
  const leader = member({ email: 'lead@x.com', groups: { platform: { leader: true } } })
  const inGroup = member({ email: 'a@x.com', groups: { platform: { leader: false } } })
  const outOfGroup = member({ email: 'b@x.com', groups: { design: { leader: false } } })

  it('lets a team member address anyone', () => {
    expect(canRequestOf('team', undefined, outOfGroup)).toBe(true)
  })

  it('lets a leader address someone in their group', () => {
    expect(canRequestOf('leader', leader, inGroup)).toBe(true)
  })

  it('stops a leader addressing someone outside their group', () => {
    expect(canRequestOf('leader', leader, outOfGroup)).toBe(false)
  })

  it('stops a plain member addressing anyone', () => {
    expect(canRequestOf('member', inGroup, outOfGroup)).toBe(false)
  })
})

describe('visibleSessions (US-041)', () => {
  const sessions: SessionDoc[] = [
    { id: 'all', title: 'Plenary', description: '', location: '', startAt: 0, endAt: 1, groupIds: [], allGroups: true },
    { id: 'p', title: 'Platform', description: '', location: '', startAt: 0, endAt: 1, groupIds: ['platform'], allGroups: false },
    { id: 'd', title: 'Design', description: '', location: '', startAt: 0, endAt: 1, groupIds: ['design'], allGroups: false },
  ]

  it('shows all-groups sessions plus the attendee’s own groups', () => {
    const m = member({ email: 'a@x.com', groups: { platform: { leader: false } } })
    expect(visibleSessions(sessions, m).map((s) => s.id)).toEqual(['all', 'p'])
  })

  it('shows only all-groups sessions to someone with no groups', () => {
    expect(visibleSessions(sessions, member({ email: 'a@x.com' })).map((s) => s.id)).toEqual(['all'])
  })
})

describe('contentState (US-043)', () => {
  const base: ContentDoc = { id: 'c', type: 'note', title: 'n', order: 0, override: 'auto' }

  it('is visible by default when no window is set', () => {
    expect(contentState(base, 1000)).toBe('visible')
  })

  it('stays hidden until visibleFrom, then becomes visible', () => {
    const c = { ...base, visibleFrom: 100 }
    expect(contentState(c, 99)).toBe('hidden')
    expect(contentState(c, 100)).toBe('visible')
  })

  it('progresses visible, grey, hidden as the window passes', () => {
    const c = { ...base, visibleFrom: 100, greyFrom: 200, hiddenFrom: 300 }
    expect(contentState(c, 150)).toBe('visible')
    expect(contentState(c, 200)).toBe('grey')
    expect(contentState(c, 250)).toBe('grey')
    expect(contentState(c, 300)).toBe('hidden')
  })

  it('lets a manual override win over the schedule', () => {
    const c = { ...base, visibleFrom: 100, override: 'hidden' as const }
    expect(contentState(c, 500)).toBe('hidden')

    const forced = { ...base, hiddenFrom: 100, override: 'visible' as const }
    expect(contentState(forced, 500)).toBe('visible')
  })

  it('filters hidden items out of the attendee view and keeps order', () => {
    const items: ContentDoc[] = [
      { ...base, id: 'b', order: 2 },
      { ...base, id: 'a', order: 1 },
      { ...base, id: 'gone', order: 0, override: 'hidden' },
    ]
    expect(attendeeContent(items, 1000).map((c) => c.id)).toEqual(['a', 'b'])
  })
})

describe('dueRequestsFor (US-071)', () => {
  const req = (over: Partial<Parameters<typeof dueRequestsFor>[0][number]> = {}) => ({
    recipientEmail: 'a@x.com',
    sendAt: 100,
    ackedAt: null as number | null,
    atTime: 500,
    ...over,
  })

  it('shows a request once its send time has passed', () => {
    expect(dueRequestsFor([req()], 'a@x.com', 100)).toHaveLength(1)
  })

  it('hides a request scheduled for the future', () => {
    expect(dueRequestsFor([req({ sendAt: 200 })], 'a@x.com', 100)).toHaveLength(0)
  })

  it('hides requests addressed to someone else', () => {
    expect(dueRequestsFor([req()], 'other@x.com', 1000)).toHaveLength(0)
  })

  it('hides requests already acknowledged', () => {
    expect(dueRequestsFor([req({ ackedAt: 150 })], 'a@x.com', 1000)).toHaveLength(0)
  })

  it('is case insensitive about the viewer email', () => {
    expect(dueRequestsFor([req()], 'A@X.com', 1000)).toHaveLength(1)
  })

  it('orders by the time the attendee is needed', () => {
    const list = [req({ atTime: 900 }), req({ atTime: 300 })]
    expect(dueRequestsFor(list, 'a@x.com', 1000).map((r) => r.atTime)).toEqual([300, 900])
  })
})
