/**
 * Firestore reads/writes and document converters.
 *
 * Layout:
 *   events/{eventId}
 *   events/{eventId}/members/{emailKey}
 *   events/{eventId}/groups/{groupId}
 *   events/{eventId}/sessions/{sessionId}
 *   events/{eventId}/sessions/{sessionId}/content/{contentId}
 *   events/{eventId}/requests/{requestId}
 *
 * The event id is the 10-character slug from US-011, so the URL needs no lookup.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore'
import { db, emailKey } from './firebase'
import { groupIdFromName, type ParsedMemberRow, type ParsedSessionRow } from './csv'
import { leaderFields } from './types'
import type {
  ContentDoc,
  EventDoc,
  GroupDoc,
  MemberDoc,
  RequestDoc,
  SessionDoc,
  VisibilityOverride,
} from './types'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const paths = {
  events: 'events',
  event: (eventId: string) => `events/${eventId}`,
  members: (eventId: string) => `events/${eventId}/members`,
  member: (eventId: string, email: string) => `events/${eventId}/members/${emailKey(email)}`,
  groups: (eventId: string) => `events/${eventId}/groups`,
  group: (eventId: string, groupId: string) => `events/${eventId}/groups/${groupId}`,
  sessions: (eventId: string) => `events/${eventId}/sessions`,
  session: (eventId: string, sessionId: string) => `events/${eventId}/sessions/${sessionId}`,
  content: (eventId: string, sessionId: string) =>
    `events/${eventId}/sessions/${sessionId}/content`,
  contentItem: (eventId: string, sessionId: string, contentId: string) =>
    `events/${eventId}/sessions/${sessionId}/content/${contentId}`,
  requests: (eventId: string) => `events/${eventId}/requests`,
  request: (eventId: string, requestId: string) => `events/${eventId}/requests/${requestId}`,
}

// ---------------------------------------------------------------------------
// Converters
// ---------------------------------------------------------------------------

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback)
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)

export function toEvent(id: string, d: DocumentData): EventDoc {
  return {
    id,
    name: str(d.name),
    ownerUid: str(d.ownerUid),
    ownerEmail: str(d.ownerEmail),
    startAt: num(d.startAt),
    endAt: num(d.endAt),
    timeZone: str(d.timeZone, 'UTC'),
    logoUrl: d.logoUrl || undefined,
    backgroundImageUrl: d.backgroundImageUrl || undefined,
    backgroundColor: d.backgroundColor || undefined,
    ownerOnboarded: Boolean(d.ownerOnboarded),
    createdAt: num(d.createdAt),
  }
}

export function toMember(id: string, d: DocumentData): MemberDoc {
  const groups: MemberDoc['groups'] = {}
  if (d.groups && typeof d.groups === 'object') {
    for (const [groupId, value] of Object.entries(d.groups as Record<string, unknown>)) {
      groups[groupId] = { leader: Boolean((value as { leader?: unknown })?.leader) }
    }
  }
  return {
    id,
    email: str(d.email, id),
    isTeamMember: Boolean(d.isTeamMember),
    groups,
    // Recomputed rather than trusted, so a stale flag never changes what the UI shows.
    ...leaderFields(groups),
    uid: d.uid || undefined,
    displayName: d.displayName || undefined,
    photoURL: d.photoURL || undefined,
    firstSeenAt: typeof d.firstSeenAt === 'number' ? d.firstSeenAt : undefined,
  }
}

export function toGroup(id: string, d: DocumentData): GroupDoc {
  return { id, name: str(d.name, id) }
}

export function toSession(id: string, d: DocumentData): SessionDoc {
  return {
    id,
    title: str(d.title),
    description: str(d.description),
    location: str(d.location),
    startAt: num(d.startAt),
    endAt: num(d.endAt),
    groupIds: Array.isArray(d.groupIds) ? d.groupIds.filter((g) => typeof g === 'string') : [],
    allGroups: Boolean(d.allGroups),
  }
}

export function toContent(id: string, d: DocumentData): ContentDoc {
  return {
    id,
    type: d.type === 'note' || d.type === 'link' ? d.type : 'schedule',
    title: str(d.title),
    body: d.body || undefined,
    url: d.url || undefined,
    scheduleStartAt: typeof d.scheduleStartAt === 'number' ? d.scheduleStartAt : undefined,
    scheduleEndAt: typeof d.scheduleEndAt === 'number' ? d.scheduleEndAt : undefined,
    order: num(d.order),
    override: (['auto', 'visible', 'grey', 'hidden'] as const).includes(d.override)
      ? (d.override as VisibilityOverride)
      : 'auto',
    visibleFrom: typeof d.visibleFrom === 'number' ? d.visibleFrom : undefined,
    greyFrom: typeof d.greyFrom === 'number' ? d.greyFrom : undefined,
    hiddenFrom: typeof d.hiddenFrom === 'number' ? d.hiddenFrom : undefined,
  }
}

export function toRequest(id: string, d: DocumentData): RequestDoc {
  return {
    id,
    batchId: str(d.batchId, id),
    createdByUid: str(d.createdByUid),
    createdByEmail: str(d.createdByEmail),
    recipientEmail: str(d.recipientEmail).toLowerCase(),
    location: str(d.location),
    atTime: num(d.atTime),
    info: str(d.info),
    sendAt: num(d.sendAt),
    createdAt: num(d.createdAt),
    ackedAt: typeof d.ackedAt === 'number' ? d.ackedAt : null,
    viaGroupId: str(d.viaGroupId),
  }
}

// ---------------------------------------------------------------------------
// Events (US-010, US-011, US-012)
// ---------------------------------------------------------------------------

const SLUG_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** 10-character random slug, using a confusable-free alphabet so it survives being read aloud. */
export function generateSlug(length = 10): string {
  const bytes = new Uint32Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < length; i++) out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length]
  return out
}

export interface CreateEventInput {
  name: string
  startAt: number
  endAt: number
  timeZone: string
  ownerUid: string
  ownerEmail: string
}

export async function createEvent(input: CreateEventInput): Promise<string> {
  // Retry on the astronomically unlikely slug collision rather than overwriting an event.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = generateSlug()
    const existing = await getDoc(doc(db(), paths.event(id)))
    if (existing.exists()) continue

    await setDoc(doc(db(), paths.event(id)), {
      name: input.name,
      ownerUid: input.ownerUid,
      ownerEmail: input.ownerEmail.toLowerCase(),
      startAt: input.startAt,
      endAt: input.endAt,
      timeZone: input.timeZone,
      backgroundColor: '#0f172a',
      ownerOnboarded: false,
      createdAt: Date.now(),
      createdAtServer: serverTimestamp(),
    })

    // The owner is an event team member from the start, so the members list is never empty.
    await setDoc(doc(db(), paths.member(id, input.ownerEmail)), {
      email: input.ownerEmail.toLowerCase(),
      isTeamMember: true,
      groups: {},
      isLeader: false,
      ledGroupIds: [],
      uid: input.ownerUid,
      firstSeenAt: Date.now(),
    })
    return id
  }
  throw new Error('Could not allocate a unique event link. Please try again.')
}

export async function updateEvent(eventId: string, patch: Partial<EventDoc>): Promise<void> {
  await updateDoc(doc(db(), paths.event(eventId)), patch as DocumentData)
}

/**
 * Only http(s) images are accepted for the logo and background.
 *
 * Firebase Storage is not used: creating a bucket now requires the paid Blaze plan, so the POC
 * takes image URLs instead and falls back to a placeholder. See US-012.
 */
export function isUsableImageUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return false
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Members and groups (US-021, US-031 to US-034)
// ---------------------------------------------------------------------------

/** Creates the member record on first sign-in, and keeps profile fields current (US-021). */
export async function ensureMemberRecord(
  eventId: string,
  user: { uid: string; email: string; displayName?: string | null; photoURL?: string | null },
): Promise<void> {
  const memberRef = doc(db(), paths.member(eventId, user.email))
  const snap = await getDoc(memberRef)
  if (!snap.exists()) {
    await setDoc(memberRef, {
      email: user.email.toLowerCase(),
      isTeamMember: false,
      groups: {},
      isLeader: false,
      ledGroupIds: [],
      uid: user.uid,
      displayName: user.displayName ?? '',
      photoURL: user.photoURL ?? '',
      firstSeenAt: Date.now(),
    })
    return
  }
  // Rules allow the caller to refresh only their own profile fields, never their role.
  await updateDoc(memberRef, {
    uid: user.uid,
    displayName: user.displayName ?? '',
    photoURL: user.photoURL ?? '',
  })
}

export async function upsertGroup(eventId: string, name: string): Promise<string> {
  const id = groupIdFromName(name)
  await setDoc(doc(db(), paths.group(eventId, id)), { name: name.trim() }, { merge: true })
  return id
}

export async function deleteGroup(eventId: string, groupId: string): Promise<void> {
  const membersSnap = await getDocs(collection(db(), paths.members(eventId)))
  const batch = writeBatch(db())
  for (const m of membersSnap.docs) {
    const groups = (m.data().groups ?? {}) as Record<string, { leader: boolean }>
    if (groupId in groups) {
      const next = { ...groups }
      delete next[groupId]
      batch.update(m.ref, { groups: next, ...leaderFields(next) })
    }
  }
  batch.delete(doc(db(), paths.group(eventId, groupId)))
  await batch.commit()
}

export async function setGroupMembership(
  eventId: string,
  email: string,
  groupId: string,
  membership: { leader: boolean } | null,
): Promise<void> {
  const memberRef = doc(db(), paths.member(eventId, email))
  const snap = await getDoc(memberRef)
  const groups = { ...((snap.data()?.groups ?? {}) as Record<string, { leader: boolean }>) }
  if (membership === null) delete groups[groupId]
  else groups[groupId] = membership
  await setDoc(
    memberRef,
    { email: email.toLowerCase(), groups, ...leaderFields(groups) },
    { merge: true },
  )
}

export async function setTeamMember(
  eventId: string,
  email: string,
  isTeamMember: boolean,
): Promise<void> {
  await setDoc(
    doc(db(), paths.member(eventId, email)),
    { email: email.toLowerCase(), isTeamMember },
    { merge: true },
  )
}

export interface ApplyImportOutcome {
  membersWritten: number
  groupsCreated: number
  membersRemoved: number
}

/**
 * Applies a parsed member CSV.
 *
 * `mode` "wipe" deletes members not present in the file, except the owner, who would otherwise
 * lock themselves out of their own event.
 */
export async function applyMemberImport(
  eventId: string,
  rows: ParsedMemberRow[],
  mode: 'additive' | 'wipe',
  ownerEmail: string,
): Promise<ApplyImportOutcome> {
  const existingMembers = await getDocs(collection(db(), paths.members(eventId)))
  const existingGroups = await getDocs(collection(db(), paths.groups(eventId)))
  const existingGroupIds = new Set(existingGroups.docs.map((d) => d.id))

  const batch = writeBatch(db())
  let groupsCreated = 0
  const keepEmails = new Set<string>([ownerEmail.toLowerCase()])

  for (const row of rows) {
    keepEmails.add(row.email)
    const groups: Record<string, { leader: boolean }> = {}
    for (const g of row.groups) {
      const groupId = groupIdFromName(g.name)
      groups[groupId] = { leader: g.leader }
      if (!existingGroupIds.has(groupId)) {
        existingGroupIds.add(groupId)
        groupsCreated++
        batch.set(doc(db(), paths.group(eventId, groupId)), { name: g.name.trim() })
      }
    }

    const memberRef = doc(db(), paths.member(eventId, row.email))
    if (mode === 'wipe') {
      batch.set(memberRef, {
        email: row.email,
        isTeamMember: row.isTeamMember,
        groups,
        ...leaderFields(groups),
      })
    } else {
      // Additive: merge new group memberships over whatever is already there.
      const current = existingMembers.docs.find((d) => d.id === emailKey(row.email))
      const merged = {
        ...((current?.data().groups ?? {}) as Record<string, { leader: boolean }>),
        ...groups,
      }
      batch.set(
        memberRef,
        {
          email: row.email,
          isTeamMember: row.isTeamMember,
          groups: merged,
          ...leaderFields(merged),
        },
        { merge: true },
      )
    }
  }

  let membersRemoved = 0
  if (mode === 'wipe') {
    for (const existing of existingMembers.docs) {
      const email = (existing.data().email ?? existing.id) as string
      if (!keepEmails.has(email.toLowerCase())) {
        batch.delete(existing.ref)
        membersRemoved++
      }
    }
  }

  await batch.commit()
  return { membersWritten: rows.length, groupsCreated, membersRemoved }
}

// ---------------------------------------------------------------------------
// Sessions and content (US-040 to US-046)
// ---------------------------------------------------------------------------

export async function createSession(
  eventId: string,
  session: Omit<SessionDoc, 'id'>,
): Promise<string> {
  const created = await addDoc(collection(db(), paths.sessions(eventId)), session)
  return created.id
}

export async function updateSession(
  eventId: string,
  sessionId: string,
  patch: Partial<SessionDoc>,
): Promise<void> {
  await updateDoc(doc(db(), paths.session(eventId, sessionId)), patch as DocumentData)
}

export async function deleteSession(eventId: string, sessionId: string): Promise<void> {
  // Subcollections are not removed with the parent, so clear content first.
  const contentSnap = await getDocs(collection(db(), paths.content(eventId, sessionId)))
  const batch = writeBatch(db())
  for (const c of contentSnap.docs) batch.delete(c.ref)
  batch.delete(doc(db(), paths.session(eventId, sessionId)))
  await batch.commit()
}

export async function applySessionImport(
  eventId: string,
  rows: ParsedSessionRow[],
  mode: 'additive' | 'wipe',
): Promise<{ sessionsWritten: number; sessionsRemoved: number; groupsCreated: number }> {
  const existingGroups = await getDocs(collection(db(), paths.groups(eventId)))
  const idByName = new Map(
    existingGroups.docs.map((d) => [String(d.data().name ?? d.id).toLowerCase(), d.id]),
  )
  const existingGroupIds = new Set(existingGroups.docs.map((d) => d.id))

  let sessionsRemoved = 0
  if (mode === 'wipe') {
    const existingSessions = await getDocs(collection(db(), paths.sessions(eventId)))
    for (const s of existingSessions.docs) {
      await deleteSession(eventId, s.id)
      sessionsRemoved++
    }
  }

  const batch = writeBatch(db())
  let groupsCreated = 0
  for (const row of rows) {
    const groupIds: string[] = []
    for (const name of row.groupNames) {
      const groupId = idByName.get(name.toLowerCase()) ?? groupIdFromName(name)
      if (!existingGroupIds.has(groupId)) {
        existingGroupIds.add(groupId)
        groupsCreated++
        batch.set(doc(db(), paths.group(eventId, groupId)), { name: name.trim() })
      }
      groupIds.push(groupId)
    }
    batch.set(doc(collection(db(), paths.sessions(eventId))), {
      title: row.title,
      description: row.description,
      location: row.location,
      startAt: row.startAt,
      endAt: row.endAt,
      groupIds,
      allGroups: row.allGroups,
    })
  }
  await batch.commit()

  return { sessionsWritten: rows.length, sessionsRemoved, groupsCreated }
}

export async function createContent(
  eventId: string,
  sessionId: string,
  content: Omit<ContentDoc, 'id'>,
): Promise<string> {
  const created = await addDoc(collection(db(), paths.content(eventId, sessionId)), content)
  return created.id
}

export async function updateContent(
  eventId: string,
  sessionId: string,
  contentId: string,
  patch: Partial<ContentDoc>,
): Promise<void> {
  await updateDoc(doc(db(), paths.contentItem(eventId, sessionId, contentId)), patch as DocumentData)
}

export async function deleteContent(
  eventId: string,
  sessionId: string,
  contentId: string,
): Promise<void> {
  await deleteDoc(doc(db(), paths.contentItem(eventId, sessionId, contentId)))
}

// ---------------------------------------------------------------------------
// Attendance requests (US-070 to US-072)
// ---------------------------------------------------------------------------

export interface CreateRequestInput {
  recipientEmails: string[]
  location: string
  atTime: number
  info: string
  sendAt: number
  createdByUid: string
  createdByEmail: string
  /** Empty for event team members; the led group id for a group leader. */
  viaGroupId: string
}

/** Fans one request out to a document per recipient, all sharing a batch id (US-070). */
export async function createRequestBatch(
  eventId: string,
  input: CreateRequestInput,
): Promise<string> {
  const batchId = generateSlug(16)
  const batch = writeBatch(db())
  const createdAt = Date.now()
  for (const recipient of input.recipientEmails) {
    batch.set(doc(collection(db(), paths.requests(eventId))), {
      batchId,
      createdByUid: input.createdByUid,
      createdByEmail: input.createdByEmail.toLowerCase(),
      recipientEmail: recipient.toLowerCase(),
      location: input.location,
      atTime: input.atTime,
      info: input.info,
      sendAt: input.sendAt,
      createdAt,
      ackedAt: null,
      viaGroupId: input.viaGroupId,
    })
  }
  await batch.commit()
  return batchId
}

export async function acknowledgeRequest(eventId: string, requestId: string): Promise<void> {
  await updateDoc(doc(db(), paths.request(eventId, requestId)), { ackedAt: Date.now() })
}

/** Deletes every document in a batch, used when a sender withdraws a request. */
export async function deleteRequestBatch(eventId: string, batchId: string): Promise<void> {
  const snap = await getDocs(collection(db(), paths.requests(eventId)))
  const batch = writeBatch(db())
  for (const d of snap.docs) {
    if (d.data().batchId === batchId) batch.delete(d.ref)
  }
  await batch.commit()
}

export async function deleteRequest(eventId: string, requestId: string): Promise<void> {
  await deleteDoc(doc(db(), paths.request(eventId, requestId)))
}
