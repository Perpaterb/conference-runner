/**
 * The event team console (US-030 to US-046, US-060 to US-073).
 *
 * Group leaders get a reduced version: they can manage their own groups and send requests to
 * their own members, but not touch sessions.
 */

import { useState } from 'react'
import type { LiveStatus } from '../lib/live'
import { isTeam, ledGroupIds } from '../lib/roles'
import { updateEvent } from '../lib/data'
import { MEMBER_TEMPLATE, downloadText } from '../lib/csv'
import type { EventDoc, GroupDoc, MemberDoc, RequestDoc, Role, SessionDoc } from '../lib/types'
import PeopleTab from './PeopleTab'
import SessionsTab from './SessionsTab'
import RequestsTab from './RequestsTab'
import { ConnectionBadge, Modal } from './ui'

type Tab = 'sessions' | 'people' | 'requests' | 'viewAs'

export default function TeamConsole({
  event,
  role,
  myMember,
  members,
  groups,
  sessions,
  requests,
  membersStatus,
  onImpersonate,
}: {
  event: EventDoc
  role: Role
  myMember: MemberDoc | undefined
  members: MemberDoc[]
  groups: GroupDoc[]
  sessions: SessionDoc[]
  requests: RequestDoc[]
  membersStatus: LiveStatus
  onImpersonate: (m: MemberDoc | null) => void
}) {
  const team = isTeam(role)
  const [tab, setTab] = useState<Tab>(team ? 'sessions' : 'people')
  const [showOnboarding, setShowOnboarding] = useState(
    role === 'owner' && event.ownerOnboarded === false,
  )

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
        <span style={{ alignSelf: 'center' }}>
          <ConnectionBadge status={membersStatus} />
        </span>
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
            The columns are: email, isEventTeamMember, then a pair of columns per group (group
            name, and whether that person leads it). Add as many group pairs as you need. You can
            export the same shape at any time as a backup.
          </p>
          <div className="row">
            <button
              className="primary"
              onClick={() => downloadText('conference-runner-members-template.csv', MEMBER_TEMPLATE)}
            >
              Download CSV template
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
