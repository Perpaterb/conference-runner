/**
 * Security rules tests (US-003).
 *
 * These assume an attacker with a valid Google account, the event link, and a browser console.
 * Every "cannot" here is a thing the UI also prevents; the point is that the server prevents it
 * too, because the UI is not a security boundary.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import {
  DESIGN_MEMBER,
  EVENT_ID,
  LEADER,
  NEWCOMER,
  OTHER_EVENT_ID,
  OWNER,
  PLATFORM_MEMBER,
  TEAM,
  anonymous,
  as,
  makeTestEnv,
  requestPayload,
  seed,
  selfRegistration,
} from './helpers'

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await makeTestEnv()
})

afterAll(async () => {
  await env.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
  await seed(env)
})

// ---------------------------------------------------------------------------

describe('events', () => {
  it('lets anyone holding the link read the event, so the login page can render (US-020)', async () => {
    await assertSucceeds(getDoc(doc(anonymous(env), `events/${EVENT_ID}`)))
  })

  it('does not let anyone list the event catalogue', async () => {
    await assertFails(getDocs(collection(anonymous(env), 'events')))
    await assertFails(getDocs(collection(as(env, PLATFORM_MEMBER), 'events')))
  })

  it('lets an owner list their own events', async () => {
    await assertSucceeds(
      getDocs(query(collection(as(env, OWNER), 'events'), where('ownerUid', '==', OWNER.uid))),
    )
  })

  it('does not let a signed-in user list somebody else’s events', async () => {
    await assertFails(
      getDocs(query(collection(as(env, TEAM), 'events'), where('ownerUid', '==', 'uid-stranger'))),
    )
  })

  it('lets the owner update their event', async () => {
    await assertSucceeds(updateDoc(doc(as(env, OWNER), `events/${EVENT_ID}`), { name: 'Renamed' }))
  })

  it('does not let an event team member update the event itself', async () => {
    await assertFails(updateDoc(doc(as(env, TEAM), `events/${EVENT_ID}`), { name: 'Renamed' }))
  })

  it('does not let the owner hand ownership to somebody else', async () => {
    await assertFails(
      updateDoc(doc(as(env, OWNER), `events/${EVENT_ID}`), { ownerUid: 'uid-attacker' }),
    )
  })

  it('does not let an attendee delete the event', async () => {
    await assertFails(deleteDoc(doc(as(env, PLATFORM_MEMBER), `events/${EVENT_ID}`)))
  })

  it('lets the owner delete the event', async () => {
    await assertSucceeds(deleteDoc(doc(as(env, OWNER), `events/${EVENT_ID}`)))
  })

  it('does not let someone create an event owned by another person', async () => {
    await assertFails(
      setDoc(doc(as(env, TEAM), 'events/newevent01'), {
        name: 'Fake',
        ownerUid: OWNER.uid,
        ownerEmail: OWNER.email,
        startAt: 1,
        endAt: 2,
        timeZone: 'UTC',
        createdAt: 1,
      }),
    )
  })
})

// ---------------------------------------------------------------------------

describe('signing in is not membership (US-038)', () => {
  it('does NOT let a newcomer add themselves to the roster', async () => {
    // Holding the link gets you a sign-in, not a place on the attendee list.
    await assertFails(
      setDoc(
        doc(as(env, NEWCOMER), `events/${EVENT_ID}/members/${NEWCOMER.email}`),
        selfRegistration(NEWCOMER.email),
      ),
    )
  })

  it('does not let a newcomer create a record for somebody else either', async () => {
    await assertFails(
      setDoc(
        doc(as(env, NEWCOMER), `events/${EVENT_ID}/members/victim@example.com`),
        selfRegistration('victim@example.com'),
      ),
    )
  })

  it('lets a newcomer ask to be added', async () => {
    await assertSucceeds(
      setDoc(doc(as(env, NEWCOMER), `events/${EVENT_ID}/joinRequests/${NEWCOMER.email}`), {
        email: NEWCOMER.email,
        uid: NEWCOMER.uid,
        displayName: 'New Comer',
        requestedAt: 1_780_000_000_000,
      }),
    )
  })

  it('lets them ask twice without complaint', async () => {
    const db = as(env, NEWCOMER)
    const payload = { email: NEWCOMER.email, requestedAt: 1_780_000_000_000 }
    await assertSucceeds(setDoc(doc(db, `events/${EVENT_ID}/joinRequests/${NEWCOMER.email}`), payload))
    await assertSucceeds(setDoc(doc(db, `events/${EVENT_ID}/joinRequests/${NEWCOMER.email}`), payload))
  })

  it('does NOT let them ask on somebody else’s behalf', async () => {
    await assertFails(
      setDoc(doc(as(env, NEWCOMER), `events/${EVENT_ID}/joinRequests/victim@example.com`), {
        email: 'victim@example.com',
        requestedAt: 1_780_000_000_000,
      }),
    )
  })

  it('does not let an anonymous visitor ask', async () => {
    await assertFails(
      setDoc(doc(anonymous(env), `events/${EVENT_ID}/joinRequests/${NEWCOMER.email}`), {
        email: NEWCOMER.email,
        requestedAt: 1_780_000_000_000,
      }),
    )
  })

  it('lets them see their own request, and withdraw it', async () => {
    const db = as(env, NEWCOMER)
    await assertSucceeds(
      setDoc(doc(db, `events/${EVENT_ID}/joinRequests/${NEWCOMER.email}`), {
        email: NEWCOMER.email,
        requestedAt: 1_780_000_000_000,
      }),
    )
    await assertSucceeds(getDoc(doc(db, `events/${EVENT_ID}/joinRequests/${NEWCOMER.email}`)))
    await assertSucceeds(deleteDoc(doc(db, `events/${EVENT_ID}/joinRequests/${NEWCOMER.email}`)))
  })

  it('does not let one asker read another’s request', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(ctx.firestore().doc(`events/${EVENT_ID}/joinRequests/other@example.com`), {
        email: 'other@example.com',
        requestedAt: 1,
      })
    })
    await assertFails(
      getDoc(doc(as(env, NEWCOMER), `events/${EVENT_ID}/joinRequests/other@example.com`)),
    )
  })

  it('does not let an attendee list who is waiting', async () => {
    await assertFails(
      getDocs(collection(as(env, PLATFORM_MEMBER), `events/${EVENT_ID}/joinRequests`)),
    )
  })

  it('lets the event team list and clear them', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(ctx.firestore().doc(`events/${EVENT_ID}/joinRequests/${NEWCOMER.email}`), {
        email: NEWCOMER.email,
        requestedAt: 1,
      })
    })
    const db = as(env, TEAM)
    await assertSucceeds(getDocs(collection(db, `events/${EVENT_ID}/joinRequests`)))
    await assertSucceeds(deleteDoc(doc(db, `events/${EVENT_ID}/joinRequests/${NEWCOMER.email}`)))
  })

  it('lets the event team add the person to the roster', async () => {
    await assertSucceeds(
      setDoc(
        doc(as(env, TEAM), `events/${EVENT_ID}/members/${NEWCOMER.email}`),
        selfRegistration(NEWCOMER.email),
      ),
    )
  })
})

// ---------------------------------------------------------------------------

describe('the roster', () => {
  it('lets an attendee read their own record', async () => {
    await assertSucceeds(
      getDoc(doc(as(env, PLATFORM_MEMBER), `events/${EVENT_ID}/members/${PLATFORM_MEMBER.email}`)),
    )
  })

  it('does not let an attendee read somebody else’s record', async () => {
    await assertFails(
      getDoc(doc(as(env, PLATFORM_MEMBER), `events/${EVENT_ID}/members/${DESIGN_MEMBER.email}`)),
    )
  })

  it('does not let an attendee list the roster', async () => {
    await assertFails(getDocs(collection(as(env, PLATFORM_MEMBER), `events/${EVENT_ID}/members`)))
  })

  it('lets event team members and group leaders list the roster', async () => {
    await assertSucceeds(getDocs(collection(as(env, TEAM), `events/${EVENT_ID}/members`)))
    await assertSucceeds(getDocs(collection(as(env, LEADER), `events/${EVENT_ID}/members`)))
  })

  it('lets an attendee refresh their own profile fields', async () => {
    await assertSucceeds(
      updateDoc(doc(as(env, PLATFORM_MEMBER), `events/${EVENT_ID}/members/${PLATFORM_MEMBER.email}`), {
        displayName: 'Plat Member',
        photoURL: 'https://example.com/p.png',
        uid: PLATFORM_MEMBER.uid,
      }),
    )
  })

  it('does NOT let an attendee promote themselves to the event team', async () => {
    await assertFails(
      updateDoc(doc(as(env, PLATFORM_MEMBER), `events/${EVENT_ID}/members/${PLATFORM_MEMBER.email}`), {
        isTeamMember: true,
      }),
    )
  })

  it('does NOT let an attendee add themselves to a group', async () => {
    await assertFails(
      updateDoc(doc(as(env, PLATFORM_MEMBER), `events/${EVENT_ID}/members/${PLATFORM_MEMBER.email}`), {
        groups: { platform: { leader: false }, design: { leader: false } },
      }),
    )
  })

  it('does NOT let an attendee make themselves a leader of their own group', async () => {
    await assertFails(
      updateDoc(doc(as(env, PLATFORM_MEMBER), `events/${EVENT_ID}/members/${PLATFORM_MEMBER.email}`), {
        groups: { platform: { leader: true } },
        isLeader: true,
        ledGroupIds: ['platform'],
      }),
    )
  })

  it('does not let an attendee delete anyone, including themselves', async () => {
    await assertFails(
      deleteDoc(doc(as(env, PLATFORM_MEMBER), `events/${EVENT_ID}/members/${DESIGN_MEMBER.email}`)),
    )
  })

  it('lets an event team member remove somebody (US-040)', async () => {
    await assertSucceeds(
      deleteDoc(doc(as(env, TEAM), `events/${EVENT_ID}/members/${PLATFORM_MEMBER.email}`)),
    )
  })

  it('lets a team member clear the removed person’s attendance requests', async () => {
    await assertSucceeds(deleteDoc(doc(as(env, TEAM), `events/${EVENT_ID}/requests/r1`)))
  })

  it('does NOT let a group leader remove somebody', async () => {
    await assertFails(
      deleteDoc(doc(as(env, LEADER), `events/${EVENT_ID}/members/${PLATFORM_MEMBER.email}`)),
    )
  })

  it('does NOT let an attendee remove anybody, including themselves', async () => {
    const db = as(env, PLATFORM_MEMBER)
    await assertFails(
      deleteDoc(doc(db, `events/${EVENT_ID}/members/${DESIGN_MEMBER.email}`)),
    )
    await assertFails(
      deleteDoc(doc(db, `events/${EVENT_ID}/members/${PLATFORM_MEMBER.email}`)),
    )
  })

  it('lets an event team member change roles and memberships', async () => {
    const db = as(env, TEAM)
    await assertSucceeds(
      updateDoc(doc(db, `events/${EVENT_ID}/members/${PLATFORM_MEMBER.email}`), {
        isTeamMember: true,
      }),
    )
    await assertSucceeds(
      updateDoc(doc(db, `events/${EVENT_ID}/members/${DESIGN_MEMBER.email}`), {
        groups: { design: { leader: true } },
        ledGroupIds: ['design'],
        isLeader: true,
      }),
    )
  })
})

// ---------------------------------------------------------------------------

describe('group leader scoping (US-034)', () => {
  it('lets a leader manage membership of the group they lead', async () => {
    await assertSucceeds(
      updateDoc(doc(as(env, LEADER), `events/${EVENT_ID}/members/${DESIGN_MEMBER.email}`), {
        groups: { design: { leader: false }, platform: { leader: false } },
        ledGroupIds: [],
        isLeader: false,
      }),
    )
  })

  it('lets a leader promote someone to co-lead the group they lead', async () => {
    await assertSucceeds(
      updateDoc(doc(as(env, LEADER), `events/${EVENT_ID}/members/${PLATFORM_MEMBER.email}`), {
        groups: { platform: { leader: true } },
        ledGroupIds: ['platform'],
        isLeader: true,
      }),
    )
  })

  it('does NOT let a leader touch a group they are only a member of', async () => {
    // LEADER leads Platform but is merely a member of Design.
    await assertFails(
      updateDoc(doc(as(env, LEADER), `events/${EVENT_ID}/members/${DESIGN_MEMBER.email}`), {
        groups: {},
        ledGroupIds: [],
        isLeader: false,
      }),
    )
  })

  it('does NOT let a leader make someone an event team member', async () => {
    await assertFails(
      updateDoc(doc(as(env, LEADER), `events/${EVENT_ID}/members/${PLATFORM_MEMBER.email}`), {
        isTeamMember: true,
      }),
    )
  })

  it('does not let a leader delete a member', async () => {
    await assertFails(
      deleteDoc(doc(as(env, LEADER), `events/${EVENT_ID}/members/${PLATFORM_MEMBER.email}`)),
    )
  })

  it('does not let a leader create or rename groups', async () => {
    await assertFails(
      setDoc(doc(as(env, LEADER), `events/${EVENT_ID}/groups/newgroup`), { name: 'New' }),
    )
  })
})

// ---------------------------------------------------------------------------

describe('sessions and content', () => {
  it('lets any signed-in attendee read sessions and content', async () => {
    const db = as(env, PLATFORM_MEMBER)
    await assertSucceeds(getDocs(collection(db, `events/${EVENT_ID}/sessions`)))
    await assertSucceeds(getDocs(collection(db, `events/${EVENT_ID}/sessions/s1/content`)))
  })

  it('does not let an anonymous visitor read sessions', async () => {
    await assertFails(getDocs(collection(anonymous(env), `events/${EVENT_ID}/sessions`)))
  })

  it('does NOT let an attendee create, edit or delete a session', async () => {
    const db = as(env, PLATFORM_MEMBER)
    await assertFails(
      setDoc(doc(db, `events/${EVENT_ID}/sessions/hacked`), {
        title: 'Hacked',
        startAt: 1,
        endAt: 2,
        groupIds: [],
        allGroups: true,
      }),
    )
    await assertFails(updateDoc(doc(db, `events/${EVENT_ID}/sessions/s1`), { title: 'Hacked' }))
    await assertFails(deleteDoc(doc(db, `events/${EVENT_ID}/sessions/s1`)))
  })

  it('does NOT let a group leader edit sessions', async () => {
    await assertFails(
      updateDoc(doc(as(env, LEADER), `events/${EVENT_ID}/sessions/s1`), { title: 'Leader edit' }),
    )
  })

  it('lets an event team member manage sessions and content', async () => {
    const db = as(env, TEAM)
    await assertSucceeds(
      updateDoc(doc(db, `events/${EVENT_ID}/sessions/s1`), { title: 'Opening plenary v2' }),
    )
    await assertSucceeds(
      updateDoc(doc(db, `events/${EVENT_ID}/sessions/s1/content/c1`), { override: 'hidden' }),
    )
  })

  it('does NOT let an attendee reveal hidden content by flipping the override', async () => {
    await assertFails(
      updateDoc(doc(as(env, PLATFORM_MEMBER), `events/${EVENT_ID}/sessions/s1/content/c1`), {
        override: 'visible',
      }),
    )
  })
})

// ---------------------------------------------------------------------------

describe('attendance requests (US-070 to US-073)', () => {
  it('lets a recipient read their own request', async () => {
    await assertSucceeds(
      getDoc(doc(as(env, PLATFORM_MEMBER), `events/${EVENT_ID}/requests/r1`)),
    )
  })

  it('does not let another attendee read somebody else’s request', async () => {
    await assertFails(getDoc(doc(as(env, DESIGN_MEMBER), `events/${EVENT_ID}/requests/r1`)))
  })

  it('does not let an attendee list every request', async () => {
    await assertFails(getDocs(collection(as(env, PLATFORM_MEMBER), `events/${EVENT_ID}/requests`)))
  })

  it('lets an attendee list requests constrained to their own email', async () => {
    await assertSucceeds(
      getDocs(
        query(
          collection(as(env, PLATFORM_MEMBER), `events/${EVENT_ID}/requests`),
          where('recipientEmail', '==', PLATFORM_MEMBER.email),
        ),
      ),
    )
  })

  it('does not let an attendee query for somebody else’s requests', async () => {
    await assertFails(
      getDocs(
        query(
          collection(as(env, PLATFORM_MEMBER), `events/${EVENT_ID}/requests`),
          where('recipientEmail', '==', DESIGN_MEMBER.email),
        ),
      ),
    )
  })

  it('lets an event team member address anyone', async () => {
    await assertSucceeds(
      setDoc(
        doc(as(env, TEAM), `events/${EVENT_ID}/requests/new1`),
        requestPayload({ recipientEmail: DESIGN_MEMBER.email }),
      ),
    )
  })

  it('lets a leader address someone in the group they lead', async () => {
    await assertSucceeds(
      setDoc(
        doc(as(env, LEADER), `events/${EVENT_ID}/requests/new2`),
        requestPayload({
          createdByUid: LEADER.uid,
          createdByEmail: LEADER.email,
          recipientEmail: PLATFORM_MEMBER.email,
          viaGroupId: 'platform',
        }),
      ),
    )
  })

  it('does NOT let a leader address someone outside the group they lead', async () => {
    await assertFails(
      setDoc(
        doc(as(env, LEADER), `events/${EVENT_ID}/requests/new3`),
        requestPayload({
          createdByUid: LEADER.uid,
          createdByEmail: LEADER.email,
          recipientEmail: DESIGN_MEMBER.email,
          viaGroupId: 'platform',
        }),
      ),
    )
  })

  it('does NOT let a leader claim to act for a group they merely belong to', async () => {
    await assertFails(
      setDoc(
        doc(as(env, LEADER), `events/${EVENT_ID}/requests/new4`),
        requestPayload({
          createdByUid: LEADER.uid,
          createdByEmail: LEADER.email,
          recipientEmail: DESIGN_MEMBER.email,
          viaGroupId: 'design',
        }),
      ),
    )
  })

  it('does NOT let a plain attendee send a request', async () => {
    await assertFails(
      setDoc(
        doc(as(env, PLATFORM_MEMBER), `events/${EVENT_ID}/requests/new5`),
        requestPayload({
          createdByUid: PLATFORM_MEMBER.uid,
          createdByEmail: PLATFORM_MEMBER.email,
          recipientEmail: DESIGN_MEMBER.email,
          viaGroupId: 'platform',
        }),
      ),
    )
  })

  it('does not let a sender forge who the request came from', async () => {
    await assertFails(
      setDoc(
        doc(as(env, TEAM), `events/${EVENT_ID}/requests/new6`),
        requestPayload({ createdByEmail: OWNER.email }),
      ),
    )
  })

  it('lets the recipient acknowledge, and only acknowledge', async () => {
    const db = as(env, PLATFORM_MEMBER)
    await assertSucceeds(
      updateDoc(doc(db, `events/${EVENT_ID}/requests/r1`), { ackedAt: 1_780_020_000_000 }),
    )
    await assertFails(
      updateDoc(doc(db, `events/${EVENT_ID}/requests/r1`), { location: 'Somewhere else' }),
    )
    await assertFails(
      updateDoc(doc(db, `events/${EVENT_ID}/requests/r1`), { atTime: 1_780_030_000_000 }),
    )
  })

  it('does not let a non-recipient acknowledge on their behalf', async () => {
    await assertFails(
      updateDoc(doc(as(env, DESIGN_MEMBER), `events/${EVENT_ID}/requests/r1`), {
        ackedAt: 1_780_020_000_000,
      }),
    )
  })

  it('lets the sender or the team withdraw a request', async () => {
    await assertSucceeds(deleteDoc(doc(as(env, TEAM), `events/${EVENT_ID}/requests/r1`)))
  })

  it('does not let the recipient delete the request instead of answering it', async () => {
    await assertFails(deleteDoc(doc(as(env, PLATFORM_MEMBER), `events/${EVENT_ID}/requests/r1`)))
  })
})

// ---------------------------------------------------------------------------

describe('cross-event isolation', () => {
  it('does not let a team member of one event write to another event', async () => {
    await assertFails(
      setDoc(doc(as(env, TEAM), `events/${OTHER_EVENT_ID}/sessions/x`), {
        title: 'Injected',
        startAt: 1,
        endAt: 2,
        groupIds: [],
        allGroups: true,
      }),
    )
  })

  it('does not let a team member of one event read another event’s roster', async () => {
    await assertFails(getDocs(collection(as(env, TEAM), `events/${OTHER_EVENT_ID}/members`)))
  })
})

// ---------------------------------------------------------------------------

describe('the deny-by-default floor', () => {
  it('rejects writes to a path the rules never mention', async () => {
    await assertFails(setDoc(doc(as(env, TEAM), 'somewhereElse/doc1'), { x: 1 }))
    await assertFails(getDoc(doc(as(env, TEAM), 'somewhereElse/doc1')))
  })

  it('confirms the emulator is enforcing rules at all', async () => {
    // If this ever passes, the suite is running without rules and every other test is worthless.
    await assertFails(
      setDoc(doc(anonymous(env), `events/${EVENT_ID}/sessions/anon`), { title: 'anon' }),
    )
    expect(true).toBe(true)
  })
})
