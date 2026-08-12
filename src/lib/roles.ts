/**
 * Role resolution (US-035) and content visibility (US-043).
 *
 * These are pure functions so they can be tested without Firebase, and so the security rules
 * in firestore.rules can mirror the same logic.
 */

import type { ContentDoc, EventDoc, MemberDoc, Role, SessionDoc, VisibilityState } from './types'

/**
 * Precedence: Owner > Event team member > Group leader > Group member > logged in.
 * `member` may be undefined for someone who has signed in but has no record yet.
 */
export function resolveRole(
  event: Pick<EventDoc, 'ownerUid' | 'ownerEmail'>,
  member: MemberDoc | undefined,
  uid: string | undefined,
  email: string | undefined,
): Role {
  const lower = email?.toLowerCase()
  if (uid && event.ownerUid === uid) return 'owner'
  if (lower && event.ownerEmail?.toLowerCase() === lower) return 'owner'
  if (!member) return 'loggedIn'
  if (member.isTeamMember) return 'team'
  const memberships = Object.values(member.groups ?? {})
  if (memberships.some((g) => g.leader)) return 'leader'
  if (memberships.length > 0) return 'member'
  return 'loggedIn'
}

export function isTeam(role: Role): boolean {
  return role === 'owner' || role === 'team'
}

/** Group ids the member leads. Owners and team members are handled by the caller. */
export function ledGroupIds(member: MemberDoc | undefined): string[] {
  if (!member) return []
  return Object.entries(member.groups ?? {})
    .filter(([, m]) => m.leader)
    .map(([id]) => id)
}

export function memberGroupIds(member: MemberDoc | undefined): string[] {
  return member ? Object.keys(member.groups ?? {}) : []
}

/** Can `actor` change membership or leader status for `groupId`? (US-033, US-034) */
export function canManageGroup(role: Role, member: MemberDoc | undefined, groupId: string): boolean {
  if (isTeam(role)) return true
  return ledGroupIds(member).includes(groupId)
}

/** Can `actor` send an attendance request to `target`? (US-073) */
export function canRequestOf(
  role: Role,
  actor: MemberDoc | undefined,
  target: MemberDoc,
): boolean {
  if (isTeam(role)) return true
  const led = ledGroupIds(actor)
  if (led.length === 0) return false
  return led.some((groupId) => groupId in (target.groups ?? {}))
}

/** People who belong to at least one of `groupIds`. Used to narrow the roster table. */
export function membersInAnyGroup(members: MemberDoc[], groupIds: string[]): MemberDoc[] {
  if (groupIds.length === 0) return []
  const wanted = new Set(groupIds)
  return members.filter((m) => Object.keys(m.groups ?? {}).some((id) => wanted.has(id)))
}

/** Sessions an attendee can see: those assigned to a group they belong to, or marked allGroups. */
export function visibleSessions(sessions: SessionDoc[], member: MemberDoc | undefined): SessionDoc[] {
  const groupIds = new Set(memberGroupIds(member))
  return sessions.filter((s) => s.allGroups || s.groupIds.some((id) => groupIds.has(id)))
}

/**
 * Current state of a content item.
 *
 * A manual override always wins. Otherwise the time window decides, evaluated latest-first so
 * the states progress hidden -> visible -> grey -> hidden as the configured times pass.
 */
export function contentState(content: ContentDoc, now: number): VisibilityState {
  if (content.override && content.override !== 'auto') return content.override

  const { visibleFrom, greyFrom, hiddenFrom } = content
  if (hiddenFrom !== undefined && now >= hiddenFrom) return 'hidden'
  if (greyFrom !== undefined && now >= greyFrom) return 'grey'
  if (visibleFrom !== undefined) return now >= visibleFrom ? 'visible' : 'hidden'
  return 'visible'
}

/** What a team member sees as the automatic state, ignoring any override. */
export function scheduledState(content: ContentDoc, now: number): VisibilityState {
  return contentState({ ...content, override: 'auto' }, now)
}

/** Attendee-facing filter: hidden items are not rendered at all. */
export function attendeeContent(items: ContentDoc[], now: number): ContentDoc[] {
  return items
    .filter((c) => contentState(c, now) !== 'hidden')
    .sort((a, b) => a.order - b.order)
}

/**
 * Requests due for this recipient right now (US-071).
 *
 * The sendAt filter is applied here, on the client. See the caveat in UserStories.md: without a
 * Cloud Function the document exists from creation, so a recipient could read their own
 * not-yet-due request directly. Security rules stop everyone else from seeing it.
 */
export function dueRequestsFor<
  T extends { recipientEmail: string; sendAt: number; ackedAt: number | null; atTime: number },
>(requests: T[], email: string | undefined, now: number): T[] {
  if (!email) return []
  const lower = email.toLowerCase()
  return requests
    .filter((r) => r.recipientEmail === lower && r.sendAt <= now && r.ackedAt === null)
    .sort((a, b) => a.atTime - b.atTime)
}
