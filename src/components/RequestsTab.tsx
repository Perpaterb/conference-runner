/**
 * Attendance requests (US-070 to US-073).
 *
 * A request fans out to one document per recipient so the rules can check, per person, that a
 * group leader is entitled to address them. The sender's view regroups those documents by
 * batch id to show one row per request with its acknowledgements.
 */

import { useMemo, useState } from 'react'
import { createRequestBatch, deleteRequestBatch } from '../lib/data'
import { canRequestOf, isTeam, ledGroupIds } from '../lib/roles'
import { useNow } from '../lib/live'
import { formatDateTime, fromDateTimeLocalValue, toDateTimeLocalValue } from '../lib/time'
import { useAuth } from '../lib/auth'
import type { EventDoc, GroupDoc, MemberDoc, RequestDoc, Role } from '../lib/types'
import { ConfirmButton, Modal } from './ui'

export default function RequestsTab({
  event,
  role,
  myMember,
  members,
  groups,
  requests,
}: {
  event: EventDoc
  role: Role
  myMember: MemberDoc | undefined
  members: MemberDoc[]
  groups: GroupDoc[]
  requests: RequestDoc[]
}) {
  const now = useNow(15_000)
  const [composing, setComposing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // Group the per-recipient documents back into one row per send.
  const batches = useMemo(() => {
    const map = new Map<string, RequestDoc[]>()
    for (const r of requests) {
      const list = map.get(r.batchId)
      if (list) list.push(r)
      else map.set(r.batchId, [r])
    }
    return [...map.values()].sort((a, b) => b[0].createdAt - a[0].createdAt)
  }, [requests])

  return (
    <div className="stack">
      <div className="card row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0 }}>Attendance requests</h2>
          <p className="muted small" style={{ margin: 0 }}>
            {isTeam(role)
              ? 'You can request attendance from anyone at this event.'
              : 'As a group leader you can request attendance from people in the groups you lead.'}
          </p>
        </div>
        <button className="primary" onClick={() => setComposing(true)}>
          New request
        </button>
      </div>

      {problem && <p className="error small">{problem}</p>}

      {batches.length === 0 ? (
        <p className="muted">No requests sent yet.</p>
      ) : (
        <div className="stack">
          {batches.map((batch) => {
            const head = batch[0]
            const acked = batch.filter((r) => r.ackedAt !== null).length
            const pending = head.sendAt > now
            return (
              <div key={head.batchId} className="card tight">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <strong>{head.location || 'Location not specified'}</strong>{' '}
                    {pending ? (
                      <span className="badge warn">
                        Scheduled to send {formatDateTime(head.sendAt, event.timeZone)}
                      </span>
                    ) : (
                      <span className="badge ok">Sent</span>
                    )}
                    <div className="muted small">
                      Be there at {formatDateTime(head.atTime, event.timeZone)} ({event.timeZone})
                    </div>
                    {head.info && (
                      <div className="small" style={{ whiteSpace: 'pre-wrap', marginTop: '0.3rem' }}>
                        {head.info}
                      </div>
                    )}
                    <div className="muted small" style={{ marginTop: '0.3rem' }}>
                      Sent by {head.createdByEmail} to {batch.length}{' '}
                      {batch.length === 1 ? 'person' : 'people'} · {acked} acknowledged
                    </div>
                    <div className="row" style={{ marginTop: '0.3rem' }}>
                      {batch.map((r) => (
                        <span key={r.id} className={`badge ${r.ackedAt ? 'ok' : ''}`}>
                          {r.recipientEmail}
                          {r.ackedAt ? ' ✓' : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                  <ConfirmButton
                    label="Withdraw"
                    confirmLabel="Really withdraw?"
                    className="danger small"
                    onConfirm={() =>
                      void deleteRequestBatch(event.id, head.batchId).catch((e: Error) =>
                        setProblem(e.message),
                      )
                    }
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {composing && (
        <ComposeModal
          event={event}
          role={role}
          myMember={myMember}
          members={members}
          groups={groups}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  )
}

function ComposeModal({
  event,
  role,
  myMember,
  members,
  groups,
  onClose,
}: {
  event: EventDoc
  role: Role
  myMember: MemberDoc | undefined
  members: MemberDoc[]
  groups: GroupDoc[]
  onClose: () => void
}) {
  const { user } = useAuth()
  const team = isTeam(role)
  const led = ledGroupIds(myMember)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [location, setLocation] = useState('')
  const [atTime, setAtTime] = useState(toDateTimeLocalValue(Date.now() + 1_800_000, event.timeZone))
  const [info, setInfo] = useState('')
  const [scheduleSend, setScheduleSend] = useState(false)
  const [sendAtValue, setSendAtValue] = useState(
    toDateTimeLocalValue(Date.now() + 900_000, event.timeZone),
  )
  const [viaGroupId, setViaGroupId] = useState(led[0] ?? '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // A leader may only address people in the group they are acting through (US-073).
  const addressable = useMemo(() => {
    const base = members.filter((m) => (team ? true : canRequestOf(role, myMember, m)))
    const scoped = team || !viaGroupId ? base : base.filter((m) => viaGroupId in m.groups)
    const needle = filter.trim().toLowerCase()
    return scoped
      .filter((m) => (needle ? m.email.includes(needle) : true))
      .sort((a, b) => a.email.localeCompare(b.email))
  }, [members, team, role, myMember, viaGroupId, filter])

  const submit = async () => {
    setProblem(null)
    const at = fromDateTimeLocalValue(atTime, event.timeZone)
    if (selected.size === 0) return setProblem('Choose at least one person.')
    if (at === null) return setProblem('Set the time you need them there.')
    if (!team && !viaGroupId) return setProblem('Choose which of your groups you are acting for.')

    let sendAt = Date.now()
    if (scheduleSend) {
      const scheduled = fromDateTimeLocalValue(sendAtValue, event.timeZone)
      if (scheduled === null) return setProblem('Set a valid send time.')
      if (scheduled <= Date.now()) {
        return setProblem('The send time is in the past. Untick scheduling to send now.')
      }
      sendAt = scheduled
    }

    setBusy(true)
    try {
      await createRequestBatch(event.id, {
        recipientEmails: [...selected],
        location: location.trim(),
        atTime: at,
        info: info.trim(),
        sendAt,
        createdByUid: user?.uid ?? '',
        createdByEmail: user?.email ?? '',
        viaGroupId: team ? '' : viaGroupId,
      })
      onClose()
    } catch (e) {
      setProblem((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (email: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(email)) next.delete(email)
      else next.add(email)
      return next
    })

  return (
    <Modal title="Request attendance" onClose={onClose} wide>
      <div className="stack">
        {!team && (
          <div className="field">
            <label htmlFor="r-via">Acting as leader of</label>
            <select
              id="r-via"
              value={viaGroupId}
              onChange={(e) => {
                setViaGroupId(e.target.value)
                setSelected(new Set())
              }}
            >
              {led.map((id) => (
                <option key={id} value={id}>
                  {groups.find((g) => g.id === id)?.name ?? id}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label>
            Who ({selected.size} selected)
          </label>
          <input
            placeholder="Filter by email"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="row" style={{ margin: '0.4rem 0' }}>
            <button
              className="small"
              onClick={() => setSelected(new Set(addressable.map((m) => m.email)))}
            >
              Select all shown
            </button>
            <button className="small ghost" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
          <div className="scroll-list">
            {addressable.map((m) => (
              <label key={m.id} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={selected.has(m.email)}
                  onChange={() => toggle(m.email)}
                />
                <span>{m.email}</span>
              </label>
            ))}
            {addressable.length === 0 && (
              <p className="muted small" style={{ margin: 0 }}>
                Nobody available to address.
              </p>
            )}
          </div>
        </div>

        <div className="fields-2">
          <div className="field">
            <label htmlFor="r-loc">Where</label>
            <input
              id="r-loc"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Room 2"
            />
          </div>
          <div className="field">
            <label htmlFor="r-at">When they need to be there ({event.timeZone})</label>
            <input
              id="r-at"
              type="datetime-local"
              value={atTime}
              onChange={(e) => setAtTime(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="r-info">Anything else they should know</label>
          <textarea id="r-info" value={info} onChange={(e) => setInfo(e.target.value)} />
        </div>

        <div className="field">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={scheduleSend}
              onChange={(e) => setScheduleSend(e.target.checked)}
            />
            <span>Send later instead of now</span>
          </label>
          {scheduleSend && (
            <>
              <input
                type="datetime-local"
                value={sendAtValue}
                onChange={(e) => setSendAtValue(e.target.value)}
                style={{ marginTop: '0.4rem' }}
              />
              <p className="muted small" style={{ marginTop: '0.3rem' }}>
                The request stays hidden until then. Note that for this POC the hiding is done in
                the app, not on the server, so a determined recipient could find their own
                scheduled request early.
              </p>
            </>
          )}
        </div>

        {problem && <p className="error small">{problem}</p>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Sending…' : scheduleSend ? 'Schedule request' : 'Send request'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
