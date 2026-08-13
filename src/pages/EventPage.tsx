/**
 * The event page. Everything after event creation happens here (US-020 to US-073).
 *
 * It resolves the viewer's role, then renders either the attendee experience or the team
 * console. Impersonation (US-061) works by swapping the member record the attendee view is
 * built from, so a team member sees precisely what that person sees.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { orderBy, where } from 'firebase/firestore'
import { useAuth } from '../lib/auth'
import { useLiveCollection, useLiveDoc, useNow } from '../lib/live'
import {
  paths,
  toEvent,
  toGroup,
  refreshMemberProfile,
  requestToJoin,
  toJoinRequest,
  toMember,
  toRequest,
  toSession,
} from '../lib/data'
import { emailKey } from '../lib/firebase'
import { isTeam, resolveRole, visibleSessions } from '../lib/roles'
import { ROLE_LABEL } from '../lib/types'
import type { EventDoc, MemberDoc } from '../lib/types'
import { CollapsingActions, ConnectionBadge } from '../components/ui'
import ConferenceStatus from '../components/ConferenceStatus'
import { ThemeToggle } from '../lib/theme'
import AttendeeView from '../components/AttendeeView'
import TeamConsole from '../components/TeamConsole'

export default function EventPage() {
  const { eventId = '' } = useParams()
  const { user, loading: authLoading, error: authError, signIn, signOutNow } = useAuth()

  const eventState = useLiveDoc(eventId ? paths.event(eventId) : null, toEvent)
  const event = eventState.data

  // Keeps the viewer's own profile fields current. It does not add them to the event: signing
  // in with the link is not membership (US-038).
  //
  // Failure here is deliberately not surfaced. The only consequence is that a display name is
  // not stored, there is nothing the viewer could do about it, and it used to greet people with
  // "could not register you on this event: missing or insufficient permissions" on a page that
  // was otherwise working perfectly.
  useEffect(() => {
    if (!user?.email || !eventId || !event) return
    refreshMemberProfile(eventId, {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
    }).catch((e: Error) => console.warn('Could not refresh profile fields:', e.message))
  }, [user?.uid, user?.email, user?.displayName, user?.photoURL, eventId, event])

  const myMemberPath =
    user?.email && eventId ? paths.member(eventId, user.email) : null
  const myMemberState = useLiveDoc(myMemberPath, toMember)

  const role = useMemo(
    () =>
      event
        ? resolveRole(event, myMemberState.data ?? undefined, user?.uid, user?.email ?? undefined)
        : 'loggedIn',
    [event, myMemberState.data, user?.uid, user?.email],
  )

  if (authLoading) {
    return (
      <div className="center">
        <p className="muted">Loading…</p>
      </div>
    )
  }

  // The signed-out check comes before waiting on the event document. The event is publicly
  // readable so the login page can show its branding, but if that read fails for any reason the
  // visitor still gets a usable sign-in button rather than an endless spinner.
  if (!user) {
    return (
      <EventLogin
        event={event}
        loading={eventState.status === 'connecting'}
        error={authError}
        onSignIn={() => void signIn()}
      />
    )
  }

  if (eventState.status === 'connecting') {
    return (
      <div className="center">
        <p className="muted">Loading…</p>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="center">
        <div className="card" style={{ maxWidth: 460 }}>
          <h2>Event not found</h2>
          <p className="muted">
            This link does not match an event. Check the link you were sent, including its last ten
            characters.
          </p>
          {eventState.error && <p className="error small">{eventState.error.message}</p>}
          <button onClick={() => void signOutNow()}>Sign out</button>
        </div>
      </div>
    )
  }

  // Absent is not the same as still loading, so wait for the read to settle before telling
  // somebody they are not on the list.
  const memberSettled = myMemberState.status !== 'connecting'
  const isOwner = role === 'owner'

  if (memberSettled && !myMemberState.data && !isOwner) {
    return <NotOnTheList event={event} />
  }

  return (
    <EventShell
      event={event}
      role={role}
      myMember={myMemberState.data ?? undefined}
    />
  )
}

/**
 * US-038: signed in, holds the link, but nobody has added them yet.
 *
 * The request is raised automatically. Holding the link is already the intent to attend, so
 * making somebody press a button to say so again adds nothing but a step to miss.
 */
function NotOnTheList({ event }: { event: EventDoc }) {
  const { user, signOutNow } = useAuth()
  const email = user?.email ?? ''
  const existing = useLiveDoc(email ? paths.joinRequest(event.id, email) : null, toJoinRequest)
  const [problem, setProblem] = useState<string | null>(null)
  const asked = useRef(false)

  useEffect(() => {
    if (!email || asked.current) return
    asked.current = true
    requestToJoin(event.id, {
      uid: user?.uid ?? '',
      email,
      displayName: user?.displayName,
    }).catch((e: Error) => setProblem(e.message))
  }, [event.id, email, user?.uid, user?.displayName])

  return (
    <>
      <div className="topbar">
        <span className="brand">{event.name}</span>
        <span className="spacer" />
        <CollapsingActions>
          <span className="muted small">{email}</span>
          <ThemeToggle />
          <button className="small ghost" onClick={() => void signOutNow()}>
            Sign out
          </button>
        </CollapsingActions>
      </div>

      <div className="page center" style={{ minHeight: '60vh' }}>
        <div className="card" style={{ maxWidth: 480, textAlign: 'center' }}>
          <h2>You are not on the attendee list</h2>
          <p className="muted">
            You are signed in as {email}, but nobody has added you to {event.name} yet.
          </p>

          {problem ? (
            <p className="error small">Could not tell the event team: {problem}</p>
          ) : (
            <p className="badge ok">
              {existing.data
                ? 'The event team has been asked to add you.'
                : 'Letting the event team know…'}
            </p>
          )}

          <p className="muted small" style={{ marginTop: '0.75rem' }}>
            This page updates by itself the moment you are added. No need to refresh.
          </p>
        </div>
      </div>
    </>
  )
}

function EventShell({
  event,
  role,
  myMember,
}: {
  event: EventDoc
  role: ReturnType<typeof resolveRole>
  myMember: MemberDoc | undefined
}) {
  const { user, signOutNow } = useAuth()
  const email = user?.email ?? ''
  const team = isTeam(role)

  /**
   * Who the attendee view is rendered as. A team member reaches it only by impersonating a
   * specific person: a separate "preview as a generic attendee" mode was the same screen with
   * no banner, which was just a way to lose track of whose view you were looking at.
   */
  const [impersonating, setImpersonating] = useState<MemberDoc | null>(null)

  const groups = useLiveCollection(paths.groups(event.id), toGroup)
  const sessions = useLiveCollection(paths.sessions(event.id), toSession, [orderBy('startAt')])

  // Team members and leaders read the whole roster; attendees are not permitted to and do not
  // need to. Passing null keeps the subscription closed rather than triggering a rules error.
  const canReadRoster = team || Boolean(myMember?.isLeader)
  const members = useLiveCollection(
    canReadRoster ? paths.members(event.id) : null,
    toMember,
  )

  // Only the event team may list these; a leader's subscription would be rejected by the rules.
  const joinRequests = useLiveCollection(
    team ? paths.joinRequests(event.id) : null,
    toJoinRequest,
  )

  // Attendees may only query their own requests; the rules reject anything broader.
  const requests = useLiveCollection(
    paths.requests(event.id),
    toRequest,
    canReadRoster ? [] : [where('recipientEmail', '==', emailKey(email))],
  )

  const viewingAs = impersonating ?? myMember
  const showAttendeeView = !team || impersonating !== null
  const now = useNow()

  // The status bar reports on whatever this viewer can actually see.
  const statusSessions = showAttendeeView
    ? visibleSessions(sessions.data, viewingAs)
    : sessions.data

  return (
    <>
      {impersonating && (
        <div className="impersonate-bar">
          <strong>Impersonating</strong>
          <span>{impersonating.email}</span>
          <span className="badge">{ROLE_LABEL[resolveRole(event, impersonating, undefined, impersonating.email)]}</span>
          <span className="muted small">Read only</span>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="small" onClick={() => setImpersonating(null)}>
            Exit impersonation
          </button>
        </div>
      )}

      <div className="topbar">
        <span className="brand">{event.name}</span>
        <span className="badge accent">{ROLE_LABEL[role]}</span>
        <ConferenceStatus event={event} sessions={statusSessions} now={now} />
        {/* Silent while healthy: a warning is only worth the space when something is wrong. */}
        {sessions.status !== 'live' && sessions.status !== 'connecting' && (
          <ConnectionBadge status={sessions.status} />
        )}
        <span className="spacer" />
        <CollapsingActions>
          {/* Only the owner has anything to go back to: nobody else can create events. */}
          {role === 'owner' && (
            <Link className="small ghost topbar-link" to="/" title="Create and manage your events">
              My events
            </Link>
          )}
          <span className="muted small">{email}</span>
          <ThemeToggle />
          <button className="small ghost" onClick={() => void signOutNow()}>
            Sign out
          </button>
        </CollapsingActions>
      </div>

      {showAttendeeView ? (
        <AttendeeView
          event={event}
          member={viewingAs}
          sessions={sessions.data}
          groups={groups.data}
          requests={requests.data}
          viewerEmail={impersonating ? impersonating.email : email}
          readOnly={impersonating !== null}
          showCoverage={team}
        />
      ) : (
        <TeamConsole
          event={event}
          role={role}
          myMember={myMember}
          members={members.data}
          groups={groups.data}
          sessions={sessions.data}
          requests={requests.data}
          joinRequests={joinRequests.data}
          onImpersonate={setImpersonating}
        />
      )}
    </>
  )
}

/** US-020: the customised login page anyone holding the link can use. */
function EventLogin({
  event,
  loading,
  error,
  onSignIn,
}: {
  event: EventDoc | null
  loading: boolean
  error: string | null
  onSignIn: () => void
}) {
  const background = event?.backgroundImageUrl
    ? `url(${event.backgroundImageUrl}) center/cover`
    : (event?.backgroundColor ?? 'var(--bg)')

  return (
    <div className="login-shell" style={{ background }}>
      <ThemeToggle floating />
      <div className="login-card">
        {event?.logoUrl && <img className="logo" src={event.logoUrl} alt="" />}
        <h1>{event?.name ?? (loading ? 'Loading event…' : 'Event')}</h1>
        <p className="muted small">
          Sign in with Google to see your schedule. Anyone with this link can sign in.
        </p>
        {error && <p className="error small">{error}</p>}
        <button className="google-btn" onClick={onSignIn}>
          Sign in with Google
        </button>
      </div>
    </div>
  )
}
