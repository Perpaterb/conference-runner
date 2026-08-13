/**
 * Shared setup for the Firestore security rules tests (US-003).
 *
 * These run against a real Firestore emulator with the real `firestore.rules`, so they test what
 * the deployed rules actually do rather than what the UI believes about them.
 */

import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
  type RulesTestContext,
} from '@firebase/rules-unit-testing'
import { doc, setDoc, type Firestore } from 'firebase/firestore'

export const EVENT_ID = 'aB3dK9xQ2p'
export const OTHER_EVENT_ID = 'zZ9yY8xX7w'

export const OWNER = { uid: 'uid-owner', email: 'owner@example.com' }
export const TEAM = { uid: 'uid-team', email: 'team@example.com' }
/** Leads Platform, and is an ordinary member of Design. */
export const LEADER = { uid: 'uid-leader', email: 'leader@example.com' }
export const PLATFORM_MEMBER = { uid: 'uid-plat', email: 'plat@example.com' }
export const DESIGN_MEMBER = { uid: 'uid-design', email: 'design@example.com' }
/** Signed in, holds the link, but has no member record yet. */
export const NEWCOMER = { uid: 'uid-new', email: 'new@example.com' }

export async function makeTestEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: 'conference-runner-rules',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8085,
    },
  })
}

/**
 * A signed-in caller. The email claim is what every rule keys off.
 *
 * rules-unit-testing hands back a compat Firestore instance; the modular helpers accept it at
 * runtime, so the cast goes through `unknown` rather than pretending the types line up.
 */
export function as(env: RulesTestEnvironment, user: { uid: string; email: string }): Firestore {
  return env.authenticatedContext(user.uid, { email: user.email }).firestore() as unknown as Firestore
}

export function anonymous(env: RulesTestEnvironment): Firestore {
  return (env.unauthenticatedContext() as RulesTestContext).firestore() as unknown as Firestore
}

function memberDoc(
  email: string,
  opts: { isTeamMember?: boolean; groups?: Record<string, { leader: boolean }> } = {},
) {
  const groups = opts.groups ?? {}
  const ledGroupIds = Object.entries(groups)
    .filter(([, g]) => g.leader)
    .map(([id]) => id)
  return {
    email,
    isTeamMember: opts.isTeamMember ?? false,
    groups,
    ledGroupIds,
    isLeader: ledGroupIds.length > 0,
  }
}

/**
 * Writes the fixture with rules disabled, so a broken rule cannot quietly stop the seed and make
 * a later assertion pass for the wrong reason.
 */
export async function seed(env: RulesTestEnvironment): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()

    await setDoc(doc(db, `events/${EVENT_ID}`), {
      name: 'PI Planning',
      ownerUid: OWNER.uid,
      ownerEmail: OWNER.email,
      startAt: 1_780_000_000_000,
      endAt: 1_780_100_000_000,
      timeZone: 'Australia/Sydney',
      backgroundColor: '#0f172a',
      ownerOnboarded: true,
      createdAt: 1_770_000_000_000,
    })

    await setDoc(doc(db, `events/${OTHER_EVENT_ID}`), {
      name: 'Someone else’s event',
      ownerUid: 'uid-stranger',
      ownerEmail: 'stranger@example.com',
      startAt: 1_780_000_000_000,
      endAt: 1_780_100_000_000,
      timeZone: 'UTC',
      createdAt: 1_770_000_000_000,
    })

    await setDoc(doc(db, `events/${EVENT_ID}/groups/platform`), { name: 'Platform' })
    await setDoc(doc(db, `events/${EVENT_ID}/groups/design`), { name: 'Design' })

    await setDoc(
      doc(db, `events/${EVENT_ID}/members/${OWNER.email}`),
      memberDoc(OWNER.email, { isTeamMember: true }),
    )
    await setDoc(
      doc(db, `events/${EVENT_ID}/members/${TEAM.email}`),
      memberDoc(TEAM.email, { isTeamMember: true }),
    )
    await setDoc(
      doc(db, `events/${EVENT_ID}/members/${LEADER.email}`),
      memberDoc(LEADER.email, {
        groups: { platform: { leader: true }, design: { leader: false } },
      }),
    )
    await setDoc(
      doc(db, `events/${EVENT_ID}/members/${PLATFORM_MEMBER.email}`),
      memberDoc(PLATFORM_MEMBER.email, { groups: { platform: { leader: false } } }),
    )
    await setDoc(
      doc(db, `events/${EVENT_ID}/members/${DESIGN_MEMBER.email}`),
      memberDoc(DESIGN_MEMBER.email, { groups: { design: { leader: false } } }),
    )

    await setDoc(doc(db, `events/${EVENT_ID}/sessions/s1`), {
      title: 'Opening plenary',
      description: '',
      location: 'Main hall',
      startAt: 1_780_000_000_000,
      endAt: 1_780_003_600_000,
      groupIds: [],
      allGroups: true,
    })

    await setDoc(doc(db, `events/${EVENT_ID}/sessions/s1/content/c1`), {
      type: 'note',
      title: 'Agenda',
      order: 0,
      override: 'auto',
    })

    // Addressed to the platform member, already sent.
    await setDoc(doc(db, `events/${EVENT_ID}/requests/r1`), {
      batchId: 'batch1',
      createdByUid: TEAM.uid,
      createdByEmail: TEAM.email,
      recipientEmail: PLATFORM_MEMBER.email,
      location: 'Room 2',
      atTime: 1_780_010_000_000,
      info: 'Bring the board',
      sendAt: 1_770_000_000_000,
      createdAt: 1_770_000_000_000,
      ackedAt: null,
      viaGroupId: '',
    })
  })
}

/** A valid request document, so tests only vary the field under test. */
export function requestPayload(over: Record<string, unknown> = {}) {
  return {
    batchId: 'batch-new',
    createdByUid: TEAM.uid,
    createdByEmail: TEAM.email,
    recipientEmail: PLATFORM_MEMBER.email,
    location: 'Room 3',
    atTime: 1_780_020_000_000,
    info: '',
    sendAt: 1_780_015_000_000,
    createdAt: 1_780_014_000_000,
    ackedAt: null,
    viaGroupId: '',
    ...over,
  }
}

/** A valid self-registration document (US-021). */
export function selfRegistration(email: string, over: Record<string, unknown> = {}) {
  return {
    email,
    isTeamMember: false,
    groups: {},
    ledGroupIds: [],
    isLeader: false,
    uid: 'whatever',
    displayName: '',
    photoURL: '',
    firstSeenAt: 1_780_000_000_000,
    ...over,
  }
}
