/**
 * The event page. Everything after event creation happens here (US-020 to US-073).
 *
 * It resolves the viewer's role, then renders either the attendee experience or the team
 * console. Impersonation (US-061) works by swapping the member record the attendee view is
 * built from, so a team member sees precisely what that person sees.
 */

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { orderBy, where } from 'firebase/firestore'
import { useAuth } from '../lib/auth'
import { useLiveCollection, useLiveDoc } from '../lib/live'
import {
  ensureMemberRecord,
  paths,
  toEvent,
  toGroup,
  toMember,
  toRequest,
  toSession,
} from '../lib/data'
import { emailKey } from '../lib/firebase'
import { isTeam, resolveRole } from '../lib/roles'
import { ROLE_LABEL } from '../lib/types'
import type { EventDoc, MemberDoc } from '../lib/types'
import { ConnectionBadge } from '../components/ui'
import AttendeeView from '../components/AttendeeView'
import TeamConsole from '../components/TeamConsole'

export default function EventPage() {
  const { eventId = '' } = useParams()
  const { user, loading: authLoading, error: authError, signIn, signOutNow } = useAuth()

  const eventState = useLiveDoc(eventId ? paths.event(eventId) : null, toEvent)
  const event = eventState.data

  // Registers the viewer on first sign-in so the team can see and address them (US-021).
  const [registerError, setRegisterError] = useState<string | null>(null)
  useEffect(() => {
    if (!user?.email || !eventId || !event) return
    ensureMemberRecord(eventId, {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
    }).catch((e: Error) => setRegisterError(e.message))
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

  return (
    <EventShell
      event={event}
      role={role}
      myMember={myMemberState.data ?? undefined}
      registerError={registerError}
    />
  )
}

function EventShell({
  event,
  role,
  myMember,
  registerError,
}: {
  event: EventDoc
  role: ReturnType<typeof resolveRole>
  myMember: MemberDoc | undefined
  registerError: string | null
}) {
  const { user, signOutNow } = useAuth()
  const email = user?.email ?? ''
  const team = isTeam(role)

  /** Who the attendee view is rendered as: normally the viewer, or the impersonated person. */
  const [impersonating, setImpersonating] = useState<MemberDoc | null>(null)
  /** US-060: a team member watching the plain attendee experience as themselves. */
  const [attendeePreview, setAttendeePreview] = useState(false)

  const groups = useLiveCollection(paths.groups(event.id), toGroup)
  const sessions = useLiveCollection(paths.sessions(event.id), toSession, [orderBy('startAt')])

  // Team members and leaders read the whole roster; attendees are not permitted to and do not
  // need to. Passing null keeps the subscription closed rather than triggering a rules error.
  const canReadRoster = team || Boolean(myMember?.isLeader)
  const members = useLiveCollection(
    canReadRoster ? paths.members(event.id) : null,
    toMember,
  )

  // Attendees may only query their own requests; the rules reject anything broader.
  const requests = useLiveCollection(
    paths.requests(event.id),
    toRequest,
    canReadRoster ? [] : [where('recipientEmail', '==', emailKey(email))],
  )

  const viewingAs = impersonating ?? myMember
  const showAttendeeView = !team || attendeePreview || impersonating !== null

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
        <ConnectionBadge status={sessions.status} />
        <span className="spacer" />
        {team && !impersonating && (
          <button className="small" onClick={() => setAttendeePreview((v) => !v)}>
            {attendeePreview ? 'Back to team console' : 'Live attendee view'}
          </button>
        )}
        <span className="muted small">{email}</span>
        <button className="small ghost" onClick={() => void signOutNow()}>
          Sign out
        </button>
      </div>

      {registerError && (
        <div className="page">
          <p className="error small">Could not register you on this event: {registerError}</p>
        </div>
      )}

      {showAttendeeView ? (
        <AttendeeView
          event={event}
          member={viewingAs}
          sessions={sessions.data}
          groups={groups.data}
          requests={requests.data}
          viewerEmail={impersonating ? impersonating.email : email}
          readOnly={impersonating !== null}
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
          membersStatus={members.status}
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
