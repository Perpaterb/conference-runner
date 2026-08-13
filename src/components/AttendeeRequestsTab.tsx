/**
 * People who signed in with the event link but are not on the attendee list (US-038).
 *
 * Signing in is not membership, so somebody on the event team has to let them in. Approving
 * writes the member record and clears the request together, so this queue can never show
 * somebody who is already on the roster.
 */

import { useState } from 'react'
import { approveJoinRequest, dismissJoinRequest } from '../lib/data'
import { formatDateTime } from '../lib/time'
import type { EventDoc, JoinRequestDoc } from '../lib/types'
import { ConfirmButton } from './ui'

export default function AttendeeRequestsTab({
  event,
  joinRequests,
}: {
  event: EventDoc
  joinRequests: JoinRequestDoc[]
}) {
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const act = async (email: string, fn: () => Promise<void>) => {
    setBusy(email)
    setProblem(null)
    try {
      await fn()
    } catch (e) {
      setProblem((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const ordered = [...joinRequests].sort((a, b) => a.requestedAt - b.requestedAt)

  return (
    <div className="stack">
      <div className="card">
        <h2 style={{ margin: 0 }}>Attendee requests</h2>
        <p className="muted small" style={{ margin: '0.35rem 0 0' }}>
          These people opened the event link and signed in, but nobody has added them yet. They
          are asked automatically; you decide whether they are in.
        </p>
      </div>

      {problem && <p className="error small">{problem}</p>}

      {ordered.length === 0 ? (
        <p className="muted">Nobody is waiting to be added.</p>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Asked</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ordered.map((r) => (
                  <tr key={r.id}>
                    <td>{r.email}</td>
                    <td className="muted">{r.displayName || '—'}</td>
                    <td className="muted small">
                      {r.requestedAt ? formatDateTime(r.requestedAt, event.timeZone) : '—'}
                    </td>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <button
                          className="primary small"
                          disabled={busy === r.email}
                          onClick={() =>
                            void act(r.email, () => approveJoinRequest(event.id, r.email))
                          }
                        >
                          {busy === r.email ? 'Adding…' : 'Add to event'}
                        </button>
                        <ConfirmButton
                          label="Dismiss"
                          confirmLabel="Really dismiss?"
                          className="danger small"
                          onConfirm={() =>
                            void act(r.email, () => dismissJoinRequest(event.id, r.email))
                          }
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginBottom: 0, marginTop: '0.6rem' }}>
            Added people land in no group, so they see only the sessions open to everyone until
            you place them under People and groups.
          </p>
        </div>
      )}
    </div>
  )
}
