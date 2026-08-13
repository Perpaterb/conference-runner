/**
 * Removing people from the event (US-040).
 *
 * Kept away from the roster table on purpose: that table is for everyday group juggling and is
 * full of checkboxes, which is the last place a destructive, irreversible action belongs.
 */

import { useMemo, useState } from 'react'
import { removeMember } from '../lib/data'
import { ledGroupIds } from '../lib/roles'
import type { EventDoc, GroupDoc, MemberDoc } from '../lib/types'
import { ConfirmButton } from './ui'

export default function RemoveAttendeesTab({
  event,
  members,
  groups,
}: {
  event: EventDoc
  members: MemberDoc[]
  groups: GroupDoc[]
}) {
  const [filter, setFilter] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [removed, setRemoved] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return members
      .filter((m) => (needle ? m.email.includes(needle) : true))
      .sort((a, b) => a.email.localeCompare(b.email))
  }, [members, filter])

  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? id

  const remove = async (email: string) => {
    setBusy(email)
    setProblem(null)
    setRemoved(null)
    try {
      await removeMember(event.id, email, event.ownerEmail)
      setRemoved(email)
    } catch (e) {
      setProblem((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <h2 style={{ margin: 0 }}>Remove attendees</h2>
        <p className="muted small" style={{ margin: '0.35rem 0 0' }}>
          Removing somebody takes them off the roster, out of every group, and deletes any
          attendance requests addressed to them. If they still hold the event link they can sign
          in again and will appear under Attendee requests.
        </p>
      </div>

      {problem && <p className="error small">{problem}</p>}
      {removed && <p className="badge ok">{removed} was removed from the event.</p>}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>
            {shown.length} {shown.length === 1 ? 'person' : 'people'}
          </h3>
          <input
            style={{ maxWidth: 240 }}
            placeholder="Filter by email"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role and groups</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => {
                const isOwner = m.email === event.ownerEmail
                const memberGroups = Object.keys(m.groups)
                return (
                  <tr key={m.id}>
                    <td>{m.email}</td>
                    <td>
                      <div className="row">
                        {isOwner && <span className="badge accent">Owner</span>}
                        {m.isTeamMember && !isOwner && (
                          <span className="badge accent">Event team</span>
                        )}
                        {ledGroupIds(m).length > 0 && <span className="badge">Leader</span>}
                        {memberGroups.length === 0 ? (
                          <span className="muted small">No groups</span>
                        ) : (
                          memberGroups.map((id) => (
                            <span key={id} className="badge">
                              {groupName(id)}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td>
                      {isOwner ? (
                        <span className="muted small" title="An event always has its owner">
                          Cannot be removed
                        </span>
                      ) : busy === m.email ? (
                        <span className="muted small">Removing…</span>
                      ) : (
                        <ConfirmButton
                          label="Remove"
                          confirmLabel={`Remove ${m.email}?`}
                          className="danger small"
                          onConfirm={() => void remove(m.email)}
                        />
                      )}
                    </td>
                  </tr>
                )
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    Nobody to show.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
