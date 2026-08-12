/**
 * People, groups and CSV (US-030 to US-035).
 *
 * Event team members manage everyone. Group leaders see the same table but can only act on the
 * groups they lead; anything else is disabled here and rejected by the security rules.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  MEMBER_TEMPLATE,
  buildMemberCsv,
  downloadText,
  groupIdFromName,
  parseMemberCsv,
  type RowError,
} from '../lib/csv'
import { applyMemberImport, deleteGroup, setGroupMembership, setTeamMember, upsertGroup } from '../lib/data'
import { canManageGroup, isTeam, ledGroupIds, membersInAnyGroup } from '../lib/roles'
import type { EventDoc, GroupDoc, MemberDoc, Role } from '../lib/types'
import { ConfirmButton, Modal } from './ui'

/**
 * Which group columns are hidden, remembered per event.
 *
 * Hidden ids are stored rather than shown ids, so a group added later shows up by default
 * instead of silently disappearing from everyone's table.
 */
function loadHiddenGroups(eventId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(`cr:hiddenGroups:${eventId}`)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function saveHiddenGroups(eventId: string, hidden: Set<string>) {
  try {
    window.localStorage.setItem(`cr:hiddenGroups:${eventId}`, JSON.stringify([...hidden]))
  } catch {
    // A full or blocked localStorage is not worth breaking the page over.
  }
}

export default function PeopleTab({
  event,
  role,
  myMember,
  members,
  groups,
}: {
  event: EventDoc
  role: Role
  myMember: MemberDoc | undefined
  members: MemberDoc[]
  groups: GroupDoc[]
}) {
  const team = isTeam(role)
  const led = ledGroupIds(myMember)
  const [importing, setImporting] = useState(false)
  const [filter, setFilter] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [newGroup, setNewGroup] = useState('')
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(() => loadHiddenGroups(event.id))
  const [onlyShownGroups, setOnlyShownGroups] = useState(false)

  useEffect(() => saveHiddenGroups(event.id, hiddenGroups), [event.id, hiddenGroups])

  const shownGroups = useMemo(
    () => groups.filter((g) => !hiddenGroups.has(g.id)),
    [groups, hiddenGroups],
  )
  const allShown = hiddenGroups.size === 0
  const noneShown = groups.length > 0 && shownGroups.length === 0

  const toggleGroup = (groupId: string) =>
    setHiddenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })

  // A leader only needs to see the people in the groups they lead.
  const visible = useMemo(() => {
    let base = team ? members : members.filter((m) => led.some((g) => g in m.groups))
    // Optionally narrow the rows to the same groups the columns are narrowed to, which is what
    // keeps the table short once there are hundreds of people.
    if (onlyShownGroups) {
      base = membersInAnyGroup(base, shownGroups.map((g) => g.id))
    }
    const needle = filter.trim().toLowerCase()
    return base
      .filter((m) => (needle ? m.email.includes(needle) : true))
      .sort((a, b) => a.email.localeCompare(b.email))
  }, [members, team, led, filter, onlyShownGroups, shownGroups])

  const act = async (fn: () => Promise<void>) => {
    setProblem(null)
    try {
      await fn()
    } catch (e) {
      setProblem((e as Error).message)
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>People and groups</h2>
          <div className="row">
            <button
              className="small"
              onClick={() => downloadText('conference-runner-members-template.csv', MEMBER_TEMPLATE)}
            >
              Download template
            </button>
            <button
              className="small"
              onClick={() =>
                downloadText(`${event.name || 'event'}-members.csv`, buildMemberCsv(members, groups))
              }
            >
              Export backup
            </button>
            {team && (
              <button className="small primary" onClick={() => setImporting(true)}>
                Import CSV
              </button>
            )}
          </div>
        </div>
        {!team && (
          <p className="muted small" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
            You are a group leader. You can manage membership and leader status for:{' '}
            {led.map((id) => groups.find((g) => g.id === id)?.name ?? id).join(', ') || 'no groups'}.
          </p>
        )}
      </div>

      {team && (
        <div className="card">
          <h3>Groups</h3>
          <div className="row">
            {groups.length === 0 && <span className="muted small">No groups yet.</span>}
            {groups.map((g) => (
              <span key={g.id} className="badge">
                {g.name}
                <ConfirmButton
                  label="×"
                  confirmLabel="Delete?"
                  className="ghost small"
                  onConfirm={() => void act(() => deleteGroup(event.id, g.id))}
                />
              </span>
            ))}
          </div>
          <div className="row" style={{ marginTop: '0.6rem' }}>
            <input
              style={{ maxWidth: 260 }}
              placeholder="New group name"
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
            />
            <button
              disabled={!newGroup.trim()}
              onClick={() =>
                void act(async () => {
                  await upsertGroup(event.id, newGroup)
                  setNewGroup('')
                })
              }
            >
              Add group
            </button>
          </div>
        </div>
      )}

      {problem && <p className="error small">{problem}</p>}

      {groups.length > 0 && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>
              Group columns shown: {shownGroups.length} of {groups.length}
            </h3>
            <div className="row">
              <button
                className="small"
                aria-pressed={allShown}
                disabled={allShown}
                onClick={() => setHiddenGroups(new Set())}
              >
                All
              </button>
              <button
                className="small"
                aria-pressed={noneShown}
                disabled={noneShown}
                onClick={() => setHiddenGroups(new Set(groups.map((g) => g.id)))}
              >
                None
              </button>
            </div>
          </div>

          <div className="chip-list">
            {groups.map((g) => {
              const shown = !hiddenGroups.has(g.id)
              return (
                <button
                  key={g.id}
                  className={`chip ${shown ? 'on' : ''}`}
                  aria-pressed={shown}
                  onClick={() => toggleGroup(g.id)}
                  title={shown ? `Hide the ${g.name} column` : `Show the ${g.name} column`}
                >
                  <span aria-hidden="true">{shown ? '\u2713' : '\u00d7'}</span> {g.name}
                </button>
              )
            })}
          </div>

          <label className="checkbox-row" style={{ marginTop: '0.6rem' }}>
            <input
              type="checkbox"
              checked={onlyShownGroups}
              onChange={(e) => setOnlyShownGroups(e.target.checked)}
            />
            <span className="small">
              Also hide people who are not in any of the shown groups
            </span>
          </label>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>
            {visible.length} {visible.length === 1 ? 'person' : 'people'}
            {onlyShownGroups && visible.length !== members.length && (
              <span className="muted small"> of {members.length}</span>
            )}
          </h3>
          <input
            style={{ maxWidth: 240 }}
            placeholder="Filter by email"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        {noneShown && (
          <p className="muted small">
            All group columns are hidden. Use <strong>All</strong> above to bring them back.
          </p>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Event team</th>
                {shownGroups.map((g) => (
                  <th key={g.id}>{g.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.email}
                    {m.email === event.ownerEmail && <span className="badge accent"> owner</span>}
                    {Object.keys(m.groups).length === 0 && !m.isTeamMember && (
                      <span className="badge warn"> no groups</span>
                    )}
                    {/* Without this the table would read as if they were in fewer groups. */}
                    {(() => {
                      const hidden = Object.keys(m.groups).filter((id) => hiddenGroups.has(id))
                      return hidden.length > 0 ? (
                        <span
                          className="badge"
                          title={`Also in hidden group(s): ${hidden
                            .map((id) => groups.find((g) => g.id === id)?.name ?? id)
                            .join(', ')}`}
                        >
                          {' '}
                          +{hidden.length} hidden
                        </span>
                      ) : null
                    })()}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={m.isTeamMember}
                      disabled={!team || m.email === event.ownerEmail}
                      title={
                        m.email === event.ownerEmail
                          ? 'The owner is always on the event team'
                          : undefined
                      }
                      onChange={(e) =>
                        void act(() => setTeamMember(event.id, m.email, e.target.checked))
                      }
                    />
                  </td>
                  {shownGroups.map((g) => {
                    const membership = m.groups[g.id]
                    const allowed = canManageGroup(role, myMember, g.id)
                    return (
                      <td key={g.id}>
                        <div className="row" style={{ gap: '0.35rem', flexWrap: 'nowrap' }}>
                          <label className="checkbox-row" style={{ margin: 0 }} title="Member">
                            <input
                              type="checkbox"
                              checked={Boolean(membership)}
                              disabled={!allowed}
                              onChange={(e) =>
                                void act(() =>
                                  setGroupMembership(
                                    event.id,
                                    m.email,
                                    g.id,
                                    e.target.checked ? { leader: false } : null,
                                  ),
                                )
                              }
                            />
                            <span className="small muted">in</span>
                          </label>
                          <label className="checkbox-row" style={{ margin: 0 }} title="Leader">
                            <input
                              type="checkbox"
                              checked={Boolean(membership?.leader)}
                              disabled={!allowed || !membership}
                              onChange={(e) =>
                                void act(() =>
                                  setGroupMembership(event.id, m.email, g.id, {
                                    leader: e.target.checked,
                                  }),
                                )
                              }
                            />
                            <span className="small muted">leads</span>
                          </label>
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={2 + shownGroups.length} className="muted">
                    Nobody to show yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {importing && (
        <ImportModal
          event={event}
          groups={groups}
          onClose={() => setImporting(false)}
        />
      )}
    </div>
  )
}

/** US-031: additive or wipe-and-replace, with per-row error reporting before anything is written. */
function ImportModal({
  event,
  groups,
  onClose,
}: {
  event: EventDoc
  groups: GroupDoc[]
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [errors, setErrors] = useState<RowError[]>([])
  const [summary, setSummary] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const parsed = useMemo(() => (text ? parseMemberCsv(text) : null), [text])
  const newGroupNames = useMemo(() => {
    if (!parsed) return []
    const existing = new Set(groups.map((g) => g.id))
    const seen = new Map<string, string>()
    for (const row of parsed.rows) {
      for (const g of row.groups) {
        const id = groupIdFromName(g.name)
        if (!existing.has(id)) seen.set(id, g.name)
      }
    }
    return [...seen.values()]
  }, [parsed, groups])

  const run = async (mode: 'additive' | 'wipe') => {
    if (!parsed) return
    setBusy(true)
    setSummary(null)
    try {
      const outcome = await applyMemberImport(event.id, parsed.rows, mode, event.ownerEmail)
      setSummary(
        `Applied ${outcome.membersWritten} row(s). ` +
          `${outcome.groupsCreated} group(s) created. ` +
          (mode === 'wipe'
            ? `${outcome.membersRemoved} person/people removed. `
            : 'Existing people and groups were kept. ') +
          (parsed.errors.length ? `${parsed.errors.length} row(s) were rejected.` : ''),
      )
    } catch (e) {
      setErrors([{ line: 0, message: (e as Error).message }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Import members CSV" onClose={onClose} wide>
      <div className="stack">
        <div className="field">
          <label htmlFor="csv-file">Choose a CSV file</label>
          <input
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              setFileName(file.name)
              setSummary(null)
              setErrors([])
              setText(await file.text())
            }}
          />
        </div>

        {parsed && (
          <>
            <div className="callout">
              <div>
                <strong>{fileName}</strong>
              </div>
              <div>
                {parsed.rows.length} valid row(s)
                {parsed.errors.length > 0 && `, ${parsed.errors.length} rejected`}
              </div>
              {newGroupNames.length > 0 && (
                <div className="small muted">
                  New groups that will be created: {newGroupNames.join(', ')}
                </div>
              )}
            </div>

            {parsed.errors.length > 0 && (
              <div className="scroll-list">
                <strong className="small">Rejected rows</strong>
                <ul className="small">
                  {parsed.errors.map((e, i) => (
                    <li key={i} className="error">
                      {e.line > 0 ? `Line ${e.line}: ` : ''}
                      {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {errors.length > 0 && (
              <p className="error small">{errors.map((e) => e.message).join(' ')}</p>
            )}
            {summary && <p className="badge ok">{summary}</p>}

            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button
                className="primary"
                disabled={busy || parsed.rows.length === 0}
                onClick={() => void run('additive')}
              >
                {busy ? 'Importing…' : 'Import (add and update)'}
              </button>
              <ConfirmButton
                label="Wipe and replace"
                confirmLabel="Delete everyone not in this file?"
                onConfirm={() => void run('wipe')}
              />
            </div>
            <p className="muted small">
              Wipe and replace removes anybody who is not in this file, except you as the owner.
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}
