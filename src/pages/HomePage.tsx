/**
 * The event creation CMS (US-010 to US-013).
 *
 * Deliberately narrow in scope: sign in, create an event, customise its login page, and get the
 * link and QR code. Everything else happens on the event page.
 */

import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { useAuth } from '../lib/auth'
import { db } from '../lib/firebase'
import {
  createEvent,
  deleteEvent,
  isUsableImageUrl,
  paths,
  toEvent,
  updateEvent,
} from '../lib/data'
import {
  defaultEventWindow,
  deviceTimeZone,
  formatDate,
  supportedTimeZones,
  timeZoneLabel,
} from '../lib/time'
import type { EventDoc } from '../lib/types'
import { CopyableLink, Modal, QrCode } from '../components/ui'
import DateTimeField from '../components/DateTimeField'

function eventUrl(eventId: string): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}#/e/${eventId}`
}

export default function HomePage() {
  const { user, loading, error, signIn, signOutNow } = useAuth()
  const [events, setEvents] = useState<EventDoc[]>([])
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [customising, setCustomising] = useState<EventDoc | null>(null)
  const [deleting, setDeleting] = useState<EventDoc | null>(null)

  const reload = useMemo(
    () => async () => {
      if (!user?.uid) return
      setLoadError(null)
      try {
        const snap = await getDocs(
          query(collection(db(), paths.events), where('ownerUid', '==', user.uid)),
        )
        setEvents(
          snap.docs
            .map((d) => toEvent(d.id, d.data()))
            .sort((a, b) => b.createdAt - a.createdAt),
        )
      } catch (e) {
        setLoadError((e as Error).message)
      }
    },
    [user?.uid],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  if (loading) {
    return (
      <div className="center">
        <p className="muted">Loading…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="login-shell" style={{ background: 'var(--bg)' }}>
        <div className="login-card">
          <h1>Conference Runner</h1>
          <p className="muted">
            Create an event, then share its link and QR code with everyone attending.
          </p>
          {error && <p className="error small">{error}</p>}
          <button className="google-btn" onClick={() => void signIn()}>
            Sign in with Google
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="topbar">
        <span className="brand">Conference Runner</span>
        <span className="spacer" />
        <span className="muted small">{user.email}</span>
        <button className="small ghost" onClick={() => void signOutNow()}>
          Sign out
        </button>
      </div>

      <div className="page stack">
        <CreateEventForm
          busy={busy}
          onCreate={async (input) => {
            setBusy(true)
            setLoadError(null)
            try {
              await createEvent({
                ...input,
                ownerUid: user.uid,
                ownerEmail: user.email ?? '',
              })
              await reload()
            } catch (e) {
              setLoadError((e as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        />

        {loadError && <p className="error">{loadError}</p>}

        <div>
          <h2>Your events</h2>
          {events.length === 0 ? (
            <p className="muted">No events yet. Create one above.</p>
          ) : (
            <div className="grid">
              {events.map((ev) => (
                <div key={ev.id} className="card stack">
                  <div>
                    <h3>{ev.name}</h3>
                    <p className="muted small" style={{ margin: 0 }}>
                      {formatDate(ev.startAt, ev.timeZone)} to {formatDate(ev.endAt, ev.timeZone)}
                      <br />
                      {ev.timeZone} ({timeZoneLabel(ev.timeZone, ev.startAt)})
                    </p>
                  </div>
                  <CopyableLink url={eventUrl(ev.id)} />
                  <QrCode value={eventUrl(ev.id)} size={150} />
                  <div className="row">
                    <a className="badge accent" href={`#/e/${ev.id}`}>
                      Open event page
                    </a>
                    <button className="small" onClick={() => setCustomising(ev)}>
                      Customise login page
                    </button>
                    <button className="small danger" onClick={() => setDeleting(ev)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {deleting && (
        <DeleteEventModal
          event={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            await reload()
            setDeleting(null)
          }}
        />
      )}

      {customising && (
        <CustomiseModal
          event={customising}
          onClose={() => setCustomising(null)}
          onSaved={async () => {
            await reload()
            setCustomising(null)
          }}
        />
      )}
    </>
  )
}

function CreateEventForm({
  busy,
  onCreate,
}: {
  busy: boolean
  onCreate: (input: {
    name: string
    startAt: number
    endAt: number
    timeZone: string
  }) => Promise<void>
}) {
  const zones = useMemo(supportedTimeZones, [])
  const [name, setName] = useState('')
  const [timeZone, setTimeZone] = useState(deviceTimeZone())
  const initial = useMemo(() => defaultEventWindow(timeZone), [timeZone])
  const [startAt, setStartAt] = useState<number | null>(initial.startAt)
  const [endAt, setEndAt] = useState<number | null>(initial.endAt)
  const [edited, setEdited] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // Changing the time zone should move the untouched defaults with it, so "09:00" stays 09:00
  // in the newly chosen zone rather than shifting to whatever that instant now reads as.
  useEffect(() => {
    if (edited) return
    setStartAt(initial.startAt)
    setEndAt(initial.endAt)
  }, [initial, edited])

  const submit = async () => {
    setProblem(null)
    if (!name.trim()) return setProblem('Give the event a name.')
    if (startAt === null) return setProblem('Set a start date and time.')
    if (endAt === null) return setProblem('Set an end date and time.')
    if (endAt <= startAt) return setProblem('The end must be after the start.')
    await onCreate({ name: name.trim(), startAt, endAt, timeZone })
    setName('')
    setEdited(false)
    const next = defaultEventWindow(timeZone)
    setStartAt(next.startAt)
    setEndAt(next.endAt)
  }

  return (
    <div className="card">
      <h2>Create an event</h2>
      <div className="field">
        <label htmlFor="ev-name">Event name</label>
        <input
          id="ev-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="PI Planning, Q3"
        />
      </div>
      <div className="field">
        <label htmlFor="ev-tz">
          Event time zone (everyone sees these times, wherever they are)
        </label>
        <select id="ev-tz" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </div>
      <div className="fields-2">
        <DateTimeField
          id="ev-start"
          label="Starts"
          value={startAt}
          timeZone={timeZone}
          onChange={(v) => {
            setEdited(true)
            setStartAt(v)
          }}
        />
        <DateTimeField
          id="ev-end"
          label="Ends"
          value={endAt}
          timeZone={timeZone}
          onChange={(v) => {
            setEdited(true)
            setEndAt(v)
          }}
        />
      </div>
      {problem && <p className="error small">{problem}</p>}
      <button className="primary" disabled={busy} onClick={() => void submit()}>
        {busy ? 'Creating…' : 'Create event'}
      </button>
    </div>
  )
}

/**
 * Deleting an event destroys every session, group, member and request under it, and cannot be
 * undone. A two-click confirm is too easy to fire by accident for something that irreversible,
 * so the owner has to type the event's name.
 */
function DeleteEventModal({
  event,
  onClose,
  onDeleted,
}: {
  event: EventDoc
  onClose: () => void
  onDeleted: () => Promise<void>
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const matches = typed.trim().toLowerCase() === event.name.trim().toLowerCase()

  return (
    <Modal title="Delete this event" onClose={onClose}>
      <div className="stack">
        <p>
          This permanently deletes <strong>{event.name}</strong> along with all of its sessions,
          session content, groups, members and attendance requests.
        </p>
        <p className="muted small">
          Anyone holding the link will get "Event not found". This cannot be undone, so export
          your members and sessions from the event page first if you might want them back.
        </p>
        <div className="field">
          <label htmlFor="del-confirm">
            Type the event name to confirm: <strong>{event.name}</strong>
          </label>
          <input
            id="del-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={event.name}
            autoComplete="off"
          />
        </div>
        {problem && <p className="error small">{problem}</p>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>Cancel</button>
          <button
            className="danger"
            disabled={!matches || busy}
            onClick={async () => {
              setBusy(true)
              setProblem(null)
              try {
                await deleteEvent(event.id)
                await onDeleted()
              } catch (e) {
                setProblem((e as Error).message)
                setBusy(false)
              }
            }}
          >
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** US-012: logo, background image or colour, with a live preview of the login page. */
function CustomiseModal({
  event,
  onClose,
  onSaved,
}: {
  event: EventDoc
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [name, setName] = useState(event.name)
  const [color, setColor] = useState(event.backgroundColor ?? '#0f172a')
  const [logoUrl, setLogoUrl] = useState(event.logoUrl ?? '')
  const [bgUrl, setBgUrl] = useState(event.backgroundImageUrl ?? '')
  const [startAt, setStartAt] = useState<number | null>(event.startAt)
  const [endAt, setEndAt] = useState<number | null>(event.endAt)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const logoOk = isUsableImageUrl(logoUrl)
  const bgOk = isUsableImageUrl(bgUrl)

  const save = async () => {
    setBusy('save')
    setProblem(null)
    if (startAt === null || endAt === null || endAt <= startAt) {
      setBusy(null)
      return setProblem('Check the start and end times.')
    }
    if (logoUrl.trim() && !logoOk) {
      setBusy(null)
      return setProblem('The logo URL must be a full http:// or https:// address.')
    }
    if (bgUrl.trim() && !bgOk) {
      setBusy(null)
      return setProblem('The background URL must be a full http:// or https:// address.')
    }
    try {
      await updateEvent(event.id, {
        name: name.trim(),
        backgroundColor: color,
        logoUrl,
        backgroundImageUrl: bgUrl,
        startAt,
        endAt,
      })
      await onSaved()
    } catch (e) {
      setProblem((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal title="Customise the login page" onClose={onClose} wide>
      <div className="fields-2">
        <div>
          <div className="field">
            <label htmlFor="c-name">Event name shown on the login page</label>
            <input id="c-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="c-logo">Logo image URL (optional)</label>
            <input
              id="c-logo"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
            />
            {logoUrl.trim() && !logoOk && (
              <p className="error small">Needs to be a full http:// or https:// address.</p>
            )}
          </div>
          <div className="field">
            <label htmlFor="c-bg">Background image URL (optional)</label>
            <input
              id="c-bg"
              value={bgUrl}
              onChange={(e) => setBgUrl(e.target.value)}
              placeholder="https://example.com/background.jpg"
            />
            {bgUrl.trim() && !bgOk && (
              <p className="error small">Needs to be a full http:// or https:// address.</p>
            )}
            {bgUrl && (
              <button className="small ghost" onClick={() => setBgUrl('')}>
                Remove background image
              </button>
            )}
          </div>
          <p className="muted small">
            Images are linked, not uploaded, because Firebase Storage now needs the paid Blaze
            plan. Host the file anywhere public (your own site, a GitHub repo's raw URL, an image
            host) and paste the direct link to the image file.
          </p>
          <div className="field">
            <label htmlFor="c-color">Background colour</label>
            <input
              id="c-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>
          <DateTimeField
            id="c-start"
            label={`Starts (${event.timeZone})`}
            value={startAt}
            timeZone={event.timeZone}
            onChange={setStartAt}
          />
          <DateTimeField
            id="c-end"
            label={`Ends (${event.timeZone})`}
            value={endAt}
            timeZone={event.timeZone}
            onChange={setEndAt}
          />
        </div>

        <div>
          <label>Preview</label>
          <div
            className="login-shell"
            style={{
              minHeight: 320,
              borderRadius: 12,
              border: '1px solid var(--line)',
              background: bgOk ? `url(${bgUrl}) center/cover` : color,
            }}
          >
            <div className="login-card" style={{ width: '90%' }}>
              {logoOk ? (
                <img className="logo" src={logoUrl} alt="" />
              ) : (
                <div className="image-placeholder">Your logo here</div>
              )}
              <h2>{name || 'Event name'}</h2>
              <button className="google-btn" disabled>
                Sign in with Google
              </button>
            </div>
          </div>
          {!bgOk && (
            <p className="muted small" style={{ marginTop: '0.4rem' }}>
              No background image set, so the colour above is used.
            </p>
          )}
        </div>
      </div>

      {problem && <p className="error small">{problem}</p>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy !== null} onClick={() => void save()}>
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}
