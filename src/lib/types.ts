/** Shared domain types. Timestamps are stored as epoch milliseconds (UTC). */

export type Role = 'owner' | 'team' | 'leader' | 'member' | 'loggedIn'

export const ROLE_ORDER: Role[] = ['owner', 'team', 'leader', 'member', 'loggedIn']

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  team: 'Event team member',
  leader: 'Group leader',
  member: 'Group member',
  loggedIn: 'Logged in',
}

export interface EventDoc {
  id: string
  name: string
  ownerUid: string
  ownerEmail: string
  startAt: number
  endAt: number
  timeZone: string
  logoUrl?: string
  backgroundImageUrl?: string
  backgroundColor?: string
  ownerOnboarded?: boolean
  createdAt: number
}

/** Membership of one group, keyed by group id in MemberDoc.groups. */
export interface GroupMembership {
  leader: boolean
}

export interface MemberDoc {
  /** Document id: the lowercased email. */
  id: string
  email: string
  isTeamMember: boolean
  /** groupId -> membership */
  groups: Record<string, GroupMembership>
  /**
   * Denormalised "leads at least one group". Security rules cannot iterate a map's values, so
   * this flag is what gates leader-only reads. Only team members and leaders can write member
   * documents, so it cannot be forged by an attendee.
   */
  isLeader: boolean
  /**
   * Denormalised ids of the groups this person leads.
   *
   * Rules use it as the allow-list of group keys a leader may edit. Without it, `groups.keys()`
   * would also cover groups they are merely a member of, letting a leader of one group edit
   * another group's membership.
   */
  ledGroupIds: string[]
  uid?: string
  displayName?: string
  photoURL?: string
  firstSeenAt?: number
}

/** Keeps {@link MemberDoc.ledGroupIds} in step with the groups map. */
export function computeLedGroupIds(groups: Record<string, GroupMembership>): string[] {
  return Object.entries(groups ?? {})
    .filter(([, m]) => m.leader)
    .map(([id]) => id)
    .sort()
}

/** Keeps {@link MemberDoc.isLeader} in step with the groups map. */
export function computeIsLeader(groups: Record<string, GroupMembership>): boolean {
  return computeLedGroupIds(groups).length > 0
}

/** The denormalised fields that must accompany every write of a member's groups map. */
export function leaderFields(groups: Record<string, GroupMembership>) {
  const ledGroupIds = computeLedGroupIds(groups)
  return { ledGroupIds, isLeader: ledGroupIds.length > 0 }
}

export interface GroupDoc {
  id: string
  name: string
}

export interface SessionDoc {
  id: string
  title: string
  description: string
  location: string
  startAt: number
  endAt: number
  /** Explicit group ids. Ignored when allGroups is true. */
  groupIds: string[]
  allGroups: boolean
}

export type ContentType = 'schedule' | 'note' | 'link'

/** Manual override; 'auto' defers to the time window. */
export type VisibilityOverride = 'auto' | 'visible' | 'grey' | 'hidden'

export type VisibilityState = 'visible' | 'grey' | 'hidden'

export interface ContentDoc {
  id: string
  type: ContentType
  title: string
  /** Body text for note and schedule items. */
  body?: string
  /** Target for link items. */
  url?: string
  /** Start/end for schedule items, shown as text inside the session. */
  scheduleStartAt?: number
  scheduleEndAt?: number
  order: number
  override: VisibilityOverride
  /** Time window driving the automatic state. */
  visibleFrom?: number
  greyFrom?: number
  hiddenFrom?: number
}

/**
 * Somebody who signed in with the link but is not on the attendee list, asking to be added
 * (US-038). Document id is their lowercased email.
 */
export interface JoinRequestDoc {
  id: string
  email: string
  uid?: string
  displayName?: string
  requestedAt: number
}

/**
 * One document per recipient, so security rules can verify that a group leader is allowed to
 * address this particular person. Rules have no way to iterate a list of recipients, so a single
 * multi-recipient document could not enforce US-073.
 *
 * Documents created together share a `batchId`, which is how the sender's view regroups them.
 */
export interface RequestDoc {
  id: string
  batchId: string
  createdByUid: string
  createdByEmail: string
  /** Lowercased single recipient. */
  recipientEmail: string
  location: string
  /** When the attendee is being asked to be there. */
  atTime: number
  info: string
  /** When the request becomes visible to the recipient. */
  sendAt: number
  createdAt: number
  /** Acknowledged-at epoch ms, or null while outstanding. */
  ackedAt: number | null
  /**
   * The group the sender is acting as leader of. Empty for event team members, who need no
   * group to justify the send.
   */
  viaGroupId: string
}
