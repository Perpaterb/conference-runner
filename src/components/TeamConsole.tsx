/**
 * The event team console (US-030 to US-046, US-060 to US-073).
 *
 * Group leaders get a reduced version: they can manage their own groups and send requests to
 * their own members, but not touch sessions.
 */

import { useState } from 'react'
import { isTeam, ledGroupIds } from '../lib/roles'
import { updateEvent } from '../lib/data'
import { MEMBER_TEMPLATE, downloadText } from '../lib/csv'
import type {
  EventDoc,
  GroupDoc,
  JoinRequestDoc,
  MemberDoc,
  RequestDoc,
  Role,
  SessionDoc,
} from '../lib/types'
import PeopleTab from './PeopleTab'
import SessionsTab from './SessionsTab'
import RequestsTab from './RequestsTab'
import { Modal } from './ui'

type Tab = 'sessions' | 'people' | 'requests' | 'viewAs'

/**
 * The customised login page is only ever shown to someone who is signed out, so a team member
 * has no way to see their own branding without opening a private window. This renders exactly
 * what a visitor holding the link sees before they sign in.
 */
function LoginPreview({ event, onClose }: { event: EventDoc; onClose: () => void }) {
  const background = event.backgroundImageUrl
    ? `url(${event.backgroundImageUrl}) center/cover`
    : (event.backgroundColor ?? 'var(--bg)')

  return (
    <Modal title="Login page as attendees see it" onClose={onClose} wide>
      <div
        className="login-shell"
        style={{ background, minHeight: 340, borderRadius: 12, border: '1px solid var(--line)' }}
      >
        <div className="login-card">
          {event.logoUrl && <img className="logo" src={event.logoUrl} alt="" />}
          <h1>{event.name}</h1>
          <p className="muted small">
            Sign in with Google to see your schedule. Anyone with this link can sign in.
          </p>
          <button className="google-btn" disabled>
            Sign in with Google
          </button>
        </div>
      </div>
      <p className="muted small" style={{ marginTop: '0.75rem' }}>
        Edit the logo, background and event name on the Conference Runner home page, under
        "Customise login page". Attendees only see this screen while signed out.
      </p>
    </Modal>
  )
}

export default function TeamConsole({
  event,
  role,
  myMember,
  members,
  groups,
  sessions,
  requests,
  joinRequests,
  onImpersonate,
}: {
  event: EventDoc
  role: Role
  myMember: MemberDoc | undefined
  members: MemberDoc[]
  groups: GroupDoc[]
  sessions: SessionDoc[]
  requests: RequestDoc[]
  joinRequests: JoinRequestDoc[]
  onImpersonate: (m: MemberDoc | null) => void
}) {
  const team = isTeam(role)
  const [tab, setTab] = useState<Tab>(team ? 'sessions' : 'people')
  const [showOnboarding, setShowOnboarding] = useState(
    role === 'owner' && event.ownerOnboarded === false,
  )
  const [previewLogin, setPreviewLogin] = useState(false)

  const tabs: { id: Tab; label: string; teamOnly: boolean }[] = [
    { id: 'sessions', label: 'Sessions', teamOnly: true },
    { id: 'people', label: 'People and groups', teamOnly: false },
    { id: 'requests', label: 'Attendance requests', teamOnly: false },
    { id: 'viewAs', label: 'View as attendee', teamOnly: true },
  ]

  return (
    <div className="page">
      <div className="tabs" role="tablist">
        {tabs
          .filter((t) => team || !t.teamOnly)
          .map((t) => (
            <button
              key={t.id}
              className="tab"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        <span style={{ flex: 1 }} />
        {team && (
          <button className="small ghost" onClick={() => setPreviewLogin(true)}>
            Preview login page
          </button>
        )}
      </div>

      {tab === 'sessions' && team && (
        <SessionsTab event={event} sessions={sessions} groups={groups} />
      )}

      {tab === 'people' && (
        <PeopleTab
          event={event}
          role={role}
          myMember={myMember}
          members={members}
          groups={groups}
          joinRequests={joinRequests}
        />
      )}

      {tab === 'requests' && (
        <RequestsTab
          event={event}
          role={role}
          myMember={myMember}
          members={members}
          groups={groups}
          requests={requests}
        />
      )}

      {tab === 'viewAs' && team && (
        <ImpersonatePicker members={members} onImpersonate={onImpersonate} />
      )}

      {previewLogin && <LoginPreview event={event} onClose={() => setPreviewLogin(false)} />}

      {showOnboarding && (
        <Modal
          title="Get your attendees in"
          onClose={async () => {
            setShowOnboarding(false)
            await updateEvent(event.id, { ownerOnboarded: true }).catch(() => {
              // Not worth blocking the owner over; the prompt simply reappears next time.
            })
          }}
        >
          <p>
            There are no groups yet. The fastest way to set up is to download the CSV template,
            fill it in, and import it under <strong>People and groups</strong>.
          </p>
          <p className="muted small">
            The file is a worked example: 20 people across 5 groups, showing leaders, people in
            several groups at once, and people in none. Delete the rows you do not need and put
            your own in. The columns are: email, isEventTeamMember, then a pair of columns per
            group (group name, and whether that person leads it). You can export the same shape
            at any time as a backup.
          </p>
          <div className="row">
            <button
              className="primary"
              onClick={() => downloadText('conference-runner-members-example.csv', MEMBER_TEMPLATE)}
            >
              Download example CSV
            </button>
            <button
              onClick={async () => {
                setShowOnboarding(false)
                await updateEvent(event.id, { ownerOnboarded: true }).catch(() => {})
              }}
            >
              Not now
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/** US-061: pick anyone and see exactly their view. */
function ImpersonatePicker({
  members,
  onImpersonate,
}: {
  members: MemberDoc[]
  onImpersonate: (m: MemberDoc | null) => void
}) {
  const [filter, setFilter] = useState('')
  const shown = members
    .filter((m) => m.email.includes(filter.trim().toLowerCase()))
    .sort((a, b) => a.email.localeCompare(b.email))

  return (
    <div className="card stack">
      <div>
        <h2>View as an attendee</h2>
        <p className="muted small">
          Impersonation is read only. You will see their schedule, their session content and their
          attendance requests, exactly as they see them right now.
        </p>
      </div>
      <input
        placeholder="Filter by email"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="scroll-list">
        <ul className="list-reset">
          {shown.map((m) => (
            <li key={m.id} className="row" style={{ justifyContent: 'space-between', padding: '0.3rem 0.2rem' }}>
              <span>
                {m.email}{' '}
                {m.isTeamMember && <span className="badge accent">team</span>}{' '}
                {ledGroupIds(m).length > 0 && <span className="badge">leader</span>}
                {Object.keys(m.groups).length === 0 && (
                  <span className="badge warn">no groups</span>
                )}
              </span>
              <button className="small" onClick={() => onImpersonate(m)}>
                View as
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="muted small">No matching attendees.</li>}
        </ul>
      </div>
    </div>
  )
}
