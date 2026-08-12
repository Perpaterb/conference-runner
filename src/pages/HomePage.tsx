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
import { createEvent, paths, toEvent, updateEvent, uploadEventImage } from '../lib/data'
import {
  deviceTimeZone,
  formatDate,
  fromDateTimeLocalValue,
  supportedTimeZones,
  timeZoneLabel,
  toDateTimeLocalValue,
} from '../lib/time'
import type { EventDoc } from '../lib/types'
import { CopyableLink, Modal, QrCode } from '../components/ui'

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
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const submit = async () => {
    setProblem(null)
    const startAt = fromDateTimeLocalValue(start, timeZone)
    const endAt = fromDateTimeLocalValue(end, timeZone)
    if (!name.trim()) return setProblem('Give the event a name.')
    if (startAt === null) return setProblem('Set a start date and time.')
    if (endAt === null) return setProblem('Set an end date and time.')
    if (endAt <= startAt) return setProblem('The end must be after the start.')
    await onCreate({ name: name.trim(), startAt, endAt, timeZone })
    setName('')
    setStart('')
    setEnd('')
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
        <div className="field">
          <label htmlFor="ev-start">Starts</label>
          <input
            id="ev-start"
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="ev-end">Ends</label>
          <input
            id="ev-end"
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </div>
      {problem && <p className="error small">{problem}</p>}
      <button className="primary" disabled={busy} onClick={() => void submit()}>
        {busy ? 'Creating…' : 'Create event'}
      </button>
    </div>
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
  const [startValue, setStartValue] = useState(toDateTimeLocalValue(event.startAt, event.timeZone))
  const [endValue, setEndValue] = useState(toDateTimeLocalValue(event.endAt, event.timeZone))
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const upload = async (kind: 'logo' | 'background', file: File) => {
    setBusy(kind)
    setProblem(null)
    try {
      const url = await uploadEventImage(event.id, kind, file)
      if (kind === 'logo') setLogoUrl(url)
      else setBgUrl(url)
    } catch (e) {
      setProblem(`Upload failed: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    setBusy('save')
    setProblem(null)
    const startAt = fromDateTimeLocalValue(startValue, event.timeZone)
    const endAt = fromDateTimeLocalValue(endValue, event.timeZone)
    if (startAt === null || endAt === null || endAt <= startAt) {
      setBusy(null)
      return setProblem('Check the start and end times.')
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
            <label htmlFor="c-logo">Logo</label>
            <input
              id="c-logo"
              type="file"
              accept="image/*"
              onChange={(e) => e.target.files?.[0] && void upload('logo', e.target.files[0])}
            />
            {busy === 'logo' && <p className="muted small">Uploading…</p>}
          </div>
          <div className="field">
            <label htmlFor="c-bg">Background image (optional)</label>
            <input
              id="c-bg"
              type="file"
              accept="image/*"
              onChange={(e) => e.target.files?.[0] && void upload('background', e.target.files[0])}
            />
            {busy === 'background' && <p className="muted small">Uploading…</p>}
            {bgUrl && (
              <button className="small ghost" onClick={() => setBgUrl('')}>
                Remove background image
              </button>
            )}
          </div>
          <div className="field">
            <label htmlFor="c-color">Background colour</label>
            <input
              id="c-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>
          <div className="fields-2">
            <div className="field">
              <label htmlFor="c-start">Starts ({event.timeZone})</label>
              <input
                id="c-start"
                type="datetime-local"
                value={startValue}
                onChange={(e) => setStartValue(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="c-end">Ends ({event.timeZone})</label>
              <input
                id="c-end"
                type="datetime-local"
                value={endValue}
                onChange={(e) => setEndValue(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div>
          <label>Preview</label>
          <div
            className="login-shell"
            style={{
              minHeight: 320,
              borderRadius: 12,
              border: '1px solid var(--line)',
              background: bgUrl ? `url(${bgUrl}) center/cover` : color,
            }}
          >
            <div className="login-card" style={{ width: '90%' }}>
              {logoUrl && <img className="logo" src={logoUrl} alt="" />}
              <h2>{name || 'Event name'}</h2>
              <button className="google-btn" disabled>
                Sign in with Google
              </button>
            </div>
          </div>
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
