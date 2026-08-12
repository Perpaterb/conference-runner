/** Session management for event team members (US-040 to US-046). */

import { useMemo, useState } from 'react'
import {
  SESSION_TEMPLATE,
  buildSessionCsv,
  downloadText,
  parseSessionCsv,
  type ParsedSessionRow,
  type RowError,
} from '../lib/csv'
import {
  applySessionImport,
  createSession,
  deleteSession,
  updateSession,
} from '../lib/data'
import {
  formatDate,
  formatTime,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
} from '../lib/time'
import { useNow } from '../lib/live'
import type { EventDoc, GroupDoc, SessionDoc } from '../lib/types'
import { ConfirmButton, Modal } from './ui'
import ContentEditor from './ContentEditor'

export default function SessionsTab({
  event,
  sessions,
  groups,
}: {
  event: EventDoc
  sessions: SessionDoc[]
  groups: GroupDoc[]
}) {
  const now = useNow(30_000)
  const [editing, setEditing] = useState<SessionDoc | 'new' | null>(null)
  const [contentFor, setContentFor] = useState<SessionDoc | null>(null)
  const [importing, setImporting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const ordered = [...sessions].sort((a, b) => a.startAt - b.startAt)

  return (
    <div className="stack">
      <div className="card row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Sessions</h2>
        <div className="row">
          <button
            className="small"
            onClick={() => downloadText('conference-runner-sessions-template.csv', SESSION_TEMPLATE)}
          >
            Download template
          </button>
          <button
            className="small"
            onClick={() =>
              downloadText(
                `${event.name || 'event'}-sessions.csv`,
                buildSessionCsv(sessions, groups, event.timeZone),
              )
            }
          >
            Export sessions
          </button>
          <button className="small" onClick={() => setImporting(true)}>
            Import CSV
          </button>
          <button className="small primary" onClick={() => setEditing('new')}>
            New session
          </button>
        </div>
      </div>

      {problem && <p className="error small">{problem}</p>}

      {ordered.length === 0 ? (
        <p className="muted">No sessions yet. Create one, or import a schedule CSV.</p>
      ) : (
        <div className="stack">
          {ordered.map((s) => {
            const live = now >= s.startAt && now <= s.endAt
            return (
              <div key={s.id} className="card tight">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <strong>{s.title}</strong> {live && <span className="badge ok">on now</span>}
                    <div className="muted small">
                      {formatDate(s.startAt, event.timeZone)}, {formatTime(s.startAt, event.timeZone)}{' '}
                      to {formatTime(s.endAt, event.timeZone)}
                      {s.location ? ` · ${s.location}` : ''}
                    </div>
                    <div className="row" style={{ marginTop: '0.3rem' }}>
                      {s.allGroups ? (
                        <span className="badge accent">All groups</span>
                      ) : s.groupIds.length === 0 ? (
                        <span className="badge warn">No groups: nobody can see this</span>
                      ) : (
                        s.groupIds.map((id) => (
                          <span key={id} className="badge">
                            {groups.find((g) => g.id === id)?.name ?? id}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="row">
                    <button className="small" onClick={() => setContentFor(s)}>
                      Content
                    </button>
                    <button className="small" onClick={() => setEditing(s)}>
                      Edit
                    </button>
                    <ConfirmButton
                      label="Delete"
                      confirmLabel="Really delete?"
                      className="danger small"
                      onConfirm={() =>
                        void deleteSession(event.id, s.id).catch((e: Error) =>
                          setProblem(e.message),
                        )
                      }
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <SessionEditor
          event={event}
          groups={groups}
          session={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      {contentFor && (
        <Modal title={`Content: ${contentFor.title}`} onClose={() => setContentFor(null)} wide>
          <ContentEditor event={event} session={contentFor} />
        </Modal>
      )}

      {importing && <SessionImportModal event={event} onClose={() => setImporting(false)} />}
    </div>
  )
}

function SessionEditor({
  event,
  groups,
  session,
  onClose,
}: {
  event: EventDoc
  groups: GroupDoc[]
  session: SessionDoc | null
  onClose: () => void
}) {
  const [title, setTitle] = useState(session?.title ?? '')
  const [description, setDescription] = useState(session?.description ?? '')
  const [location, setLocation] = useState(session?.location ?? '')
  const [start, setStart] = useState(
    toDateTimeLocalValue(session?.startAt ?? event.startAt, event.timeZone),
  )
  const [end, setEnd] = useState(
    toDateTimeLocalValue(session?.endAt ?? event.startAt + 3_600_000, event.timeZone),
  )
  const [allGroups, setAllGroups] = useState(session?.allGroups ?? false)
  const [groupIds, setGroupIds] = useState<string[]>(session?.groupIds ?? [])
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setProblem(null)
    const startAt = fromDateTimeLocalValue(start, event.timeZone)
    const endAt = fromDateTimeLocalValue(end, event.timeZone)
    if (!title.trim()) return setProblem('Give the session a title.')
    if (startAt === null || endAt === null) return setProblem('Set the start and end times.')
    if (endAt <= startAt) return setProblem('The end must be after the start.')

    setBusy(true)
    const payload = {
      title: title.trim(),
      description: description.trim(),
      location: location.trim(),
      startAt,
      endAt,
      allGroups,
      groupIds: allGroups ? [] : groupIds,
    }
    try {
      if (session) await updateSession(event.id, session.id, payload)
      else await createSession(event.id, payload)
      onClose()
    } catch (e) {
      setProblem((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={session ? 'Edit session' : 'New session'} onClose={onClose}>
      <div className="field">
        <label htmlFor="s-title">Title</label>
        <input id="s-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="s-desc">Description</label>
        <textarea id="s-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="s-loc">Location</label>
        <input id="s-loc" value={location} onChange={(e) => setLocation(e.target.value)} />
      </div>
      <div className="fields-2">
        <div className="field">
          <label htmlFor="s-start">Starts ({event.timeZone})</label>
          <input
            id="s-start"
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="s-end">Ends ({event.timeZone})</label>
          <input
            id="s-end"
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label>Who can attend</label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={allGroups}
            onChange={(e) => setAllGroups(e.target.checked)}
          />
          <span>Add all groups</span>
        </label>
        {!allGroups && (
          <div className="scroll-list" style={{ marginTop: '0.4rem' }}>
            {groups.length === 0 && (
              <p className="muted small" style={{ margin: 0 }}>
                No groups exist yet. Import or create groups first.
              </p>
            )}
            {groups.map((g) => (
              <label key={g.id} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={groupIds.includes(g.id)}
                  onChange={(e) =>
                    setGroupIds((prev) =>
                      e.target.checked ? [...prev, g.id] : prev.filter((id) => id !== g.id),
                    )
                  }
                />
                <span>{g.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {problem && <p className="error small">{problem}</p>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save session'}
        </button>
      </div>
    </Modal>
  )
}

/** US-045: schedule import, same additive/wipe choice as the member import. */
function SessionImportModal({ event, onClose }: { event: EventDoc; onClose: () => void }) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [summary, setSummary] = useState<string | null>(null)
  const [failure, setFailure] = useState<RowError[]>([])
  const [busy, setBusy] = useState(false)

  const parsed = useMemo(
    () => (text ? parseSessionCsv(text, event.timeZone) : null),
    [text, event.timeZone],
  )

  const run = async (mode: 'additive' | 'wipe', rows: ParsedSessionRow[]) => {
    setBusy(true)
    setSummary(null)
    try {
      const outcome = await applySessionImport(event.id, rows, mode)
      setSummary(
        `Imported ${outcome.sessionsWritten} session(s). ` +
          `${outcome.groupsCreated} group(s) created. ` +
          (mode === 'wipe' ? `${outcome.sessionsRemoved} existing session(s) removed.` : ''),
      )
    } catch (e) {
      setFailure([{ line: 0, message: (e as Error).message }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Import sessions CSV" onClose={onClose} wide>
      <div className="stack">
        <p className="muted small">
          Columns: title, description, location, start, end, groups. Times are read in the event
          time zone ({event.timeZone}) as DD MMM YYYY HH:mm. The groups column is semicolon
          separated, or the word ALL.
        </p>
        <div className="field">
          <label htmlFor="s-csv">Choose a CSV file</label>
          <input
            id="s-csv"
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              setFileName(file.name)
              setSummary(null)
              setFailure([])
              setText(await file.text())
            }}
          />
        </div>

        {parsed && (
          <>
            <div className="callout">
              <strong>{fileName}</strong>
              <div>
                {parsed.rows.length} valid session(s)
                {parsed.errors.length > 0 && `, ${parsed.errors.length} rejected`}
              </div>
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

            {failure.length > 0 && (
              <p className="error small">{failure.map((e) => e.message).join(' ')}</p>
            )}
            {summary && <p className="badge ok">{summary}</p>}

            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button
                className="primary"
                disabled={busy || parsed.rows.length === 0}
                onClick={() => void run('additive', parsed.rows)}
              >
                {busy ? 'Importing…' : 'Import (add to existing)'}
              </button>
              <ConfirmButton
                label="Wipe and replace"
                confirmLabel="Delete all existing sessions?"
                onConfirm={() => void run('wipe', parsed.rows)}
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
