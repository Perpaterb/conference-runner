/**
 * Session content and its visibility states (US-042 to US-044).
 *
 * Each item shows both what the schedule would currently make it, and what it actually is once
 * any manual override is applied, so a team member can always tell why something is greyed out.
 */

import { useState } from 'react'
import { orderBy } from 'firebase/firestore'
import { useLiveCollection, useNow } from '../lib/live'
import { createContent, deleteContent, paths, toContent, updateContent } from '../lib/data'
import { contentState, scheduledState } from '../lib/roles'
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '../lib/time'
import type {
  ContentDoc,
  ContentType,
  EventDoc,
  SessionDoc,
  VisibilityOverride,
  VisibilityState,
} from '../lib/types'
import { ConfirmButton } from './ui'

const STATE_LABEL: Record<VisibilityState, string> = {
  visible: 'Visible',
  grey: 'Greyed out',
  hidden: 'Hidden',
}

const STATE_CLASS: Record<VisibilityState, string> = {
  visible: 'ok',
  grey: 'warn',
  hidden: 'bad',
}

export default function ContentEditor({
  event,
  session,
}: {
  event: EventDoc
  session: SessionDoc
}) {
  const now = useNow(10_000)
  const content = useLiveCollection(paths.content(event.id, session.id), toContent, [
    orderBy('order'),
  ])
  const [problem, setProblem] = useState<string | null>(null)
  const [adding, setAdding] = useState<ContentType | null>(null)

  const items = [...content.data].sort((a, b) => a.order - b.order)

  const act = async (fn: () => Promise<void>) => {
    setProblem(null)
    try {
      await fn()
    } catch (e) {
      setProblem((e as Error).message)
    }
  }

  const move = (item: ContentDoc, direction: -1 | 1) => {
    const index = items.findIndex((i) => i.id === item.id)
    const swapWith = items[index + direction]
    if (!swapWith) return
    void act(async () => {
      await updateContent(event.id, session.id, item.id, { order: swapWith.order })
      await updateContent(event.id, session.id, swapWith.id, { order: item.order })
    })
  }

  return (
    <div className="stack">
      <div className="row">
        <button className="small" onClick={() => setAdding('schedule')}>
          Add schedule entry
        </button>
        <button className="small" onClick={() => setAdding('note')}>
          Add note
        </button>
        <button className="small" onClick={() => setAdding('link')}>
          Add link button
        </button>
      </div>

      {problem && <p className="error small">{problem}</p>}

      {adding && (
        <ContentForm
          event={event}
          type={adding}
          onCancel={() => setAdding(null)}
          onSave={async (draft) => {
            await act(async () => {
              await createContent(event.id, session.id, {
                ...draft,
                order: items.length > 0 ? Math.max(...items.map((i) => i.order)) + 1 : 0,
              })
            })
            setAdding(null)
          }}
        />
      )}

      {items.length === 0 && !adding && (
        <p className="muted">No content in this session yet.</p>
      )}

      {items.map((item, index) => (
        <ContentRow
          key={item.id}
          event={event}
          item={item}
          now={now}
          isFirst={index === 0}
          isLast={index === items.length - 1}
          onMove={(d) => move(item, d)}
          onOverride={(override) =>
            void act(() => updateContent(event.id, session.id, item.id, { override }))
          }
          onEdit={(patch) => act(() => updateContent(event.id, session.id, item.id, patch))}
          onDelete={() => void act(() => deleteContent(event.id, session.id, item.id))}
        />
      ))}
    </div>
  )
}

function ContentRow({
  event,
  item,
  now,
  isFirst,
  isLast,
  onMove,
  onOverride,
  onEdit,
  onDelete,
}: {
  event: EventDoc
  item: ContentDoc
  now: number
  isFirst: boolean
  isLast: boolean
  onMove: (direction: -1 | 1) => void
  onOverride: (override: VisibilityOverride) => void
  onEdit: (patch: Partial<ContentDoc>) => Promise<void>
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const actual = contentState(item, now)
  const scheduled = scheduledState(item, now)
  const overridden = item.override !== 'auto'

  if (editing) {
    return (
      <ContentForm
        event={event}
        type={item.type}
        initial={item}
        onCancel={() => setEditing(false)}
        onSave={async (draft) => {
          await onEdit(draft)
          setEditing(false)
        }}
      />
    )
  }

  return (
    <div className={`content-item state-${actual === 'hidden' ? 'hidden' : actual}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <span className="badge">{item.type}</span> <strong>{item.title}</strong>
        </div>
        <div className="row">
          <button className="small ghost" disabled={isFirst} onClick={() => onMove(-1)}>
            ↑
          </button>
          <button className="small ghost" disabled={isLast} onClick={() => onMove(1)}>
            ↓
          </button>
          <button className="small" onClick={() => setEditing(true)}>
            Edit
          </button>
          <ConfirmButton
            label="Delete"
            confirmLabel="Really delete?"
            className="danger small"
            onConfirm={onDelete}
          />
        </div>
      </div>

      {item.body && (
        <p className="small" style={{ whiteSpace: 'pre-wrap', marginTop: '0.4rem' }}>
          {item.body}
        </p>
      )}
      {item.url && (
        <p className="small muted" style={{ marginTop: '0.3rem' }}>
          {item.url}
        </p>
      )}

      <div className="row small" style={{ marginTop: '0.4rem' }}>
        <span className={`badge ${STATE_CLASS[actual]}`}>
          Attendees see: {STATE_LABEL[actual]}
        </span>
        {overridden ? (
          <span className="badge accent">
            Manual override (schedule would say {STATE_LABEL[scheduled].toLowerCase()})
          </span>
        ) : (
          <span className="badge">Following its time window</span>
        )}
      </div>

      {/*
        US-044: the three state buttons are spread to opposite ends of the row, with the
        destructive "hide" at the far right, so people working shoulder to shoulder around one
        screen do not hit each other's control by accident.
      */}
      <div className="state-controls">
        <button
          className="small"
          aria-pressed={item.override === 'visible'}
          onClick={() => onOverride('visible')}
        >
          Show
        </button>
        <span className="spacer" />
        <button
          className="small"
          aria-pressed={item.override === 'auto'}
          onClick={() => onOverride('auto')}
          title="Let the configured time window decide"
        >
          Auto
        </button>
        <span className="spacer" />
        <button
          className="small"
          aria-pressed={item.override === 'grey'}
          onClick={() => onOverride('grey')}
        >
          Grey out
        </button>
        <span className="spacer" />
        <button
          className="small danger"
          aria-pressed={item.override === 'hidden'}
          onClick={() => onOverride('hidden')}
        >
          Hide
        </button>
      </div>
    </div>
  )
}

type Draft = Omit<ContentDoc, 'id' | 'order'>

function ContentForm({
  event,
  type,
  initial,
  onCancel,
  onSave,
}: {
  event: EventDoc
  type: ContentType
  initial?: ContentDoc
  onCancel: () => void
  onSave: (draft: Draft) => Promise<void>
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const [visibleFrom, setVisibleFrom] = useState(
    initial?.visibleFrom ? toDateTimeLocalValue(initial.visibleFrom, event.timeZone) : '',
  )
  const [greyFrom, setGreyFrom] = useState(
    initial?.greyFrom ? toDateTimeLocalValue(initial.greyFrom, event.timeZone) : '',
  )
  const [hiddenFrom, setHiddenFrom] = useState(
    initial?.hiddenFrom ? toDateTimeLocalValue(initial.hiddenFrom, event.timeZone) : '',
  )
  const [scheduleStart, setScheduleStart] = useState(
    initial?.scheduleStartAt ? toDateTimeLocalValue(initial.scheduleStartAt, event.timeZone) : '',
  )
  const [scheduleEnd, setScheduleEnd] = useState(
    initial?.scheduleEndAt ? toDateTimeLocalValue(initial.scheduleEndAt, event.timeZone) : '',
  )
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!title.trim()) return setProblem('Give this item a title.')
    if (type === 'link' && !url.trim()) return setProblem('A link button needs a URL.')

    const toEpoch = (v: string) => (v ? (fromDateTimeLocalValue(v, event.timeZone) ?? undefined) : undefined)
    const draft: Draft = {
      type,
      title: title.trim(),
      override: initial?.override ?? 'auto',
      visibleFrom: toEpoch(visibleFrom),
      greyFrom: toEpoch(greyFrom),
      hiddenFrom: toEpoch(hiddenFrom),
    }
    if (type === 'link') draft.url = url.trim()
    if (type !== 'link') draft.body = body
    if (type === 'schedule') {
      draft.scheduleStartAt = toEpoch(scheduleStart)
      draft.scheduleEndAt = toEpoch(scheduleEnd)
    }

    // Firestore rejects undefined values, so strip the keys that were left blank.
    for (const key of Object.keys(draft) as (keyof Draft)[]) {
      if (draft[key] === undefined) delete draft[key]
    }

    setBusy(true)
    setProblem(null)
    try {
      await onSave(draft)
    } catch (e) {
      setProblem((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card tight stack">
      <strong>{initial ? 'Edit' : 'New'} {type}</strong>
      <div className="field">
        <label htmlFor="c-title">Title</label>
        <input id="c-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      {type === 'link' ? (
        <div className="field">
          <label htmlFor="c-url">URL</label>
          <input
            id="c-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
          />
        </div>
      ) : (
        <div className="field">
          <label htmlFor="c-body">Text</label>
          <textarea id="c-body" value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
      )}

      {type === 'schedule' && (
        <div className="fields-2">
          <div className="field">
            <label htmlFor="c-ss">Entry starts</label>
            <input
              id="c-ss"
              type="datetime-local"
              value={scheduleStart}
              onChange={(e) => setScheduleStart(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="c-se">Entry ends</label>
            <input
              id="c-se"
              type="datetime-local"
              value={scheduleEnd}
              onChange={(e) => setScheduleEnd(e.target.value)}
            />
          </div>
        </div>
      )}

      <details>
        <summary className="muted small">
          Visibility time window (optional, all times in {event.timeZone})
        </summary>
        <div className="fields-2" style={{ marginTop: '0.5rem' }}>
          <div className="field">
            <label htmlFor="c-vf">Becomes visible at</label>
            <input
              id="c-vf"
              type="datetime-local"
              value={visibleFrom}
              onChange={(e) => setVisibleFrom(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="c-gf">Greys out at</label>
            <input
              id="c-gf"
              type="datetime-local"
              value={greyFrom}
              onChange={(e) => setGreyFrom(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="c-hf">Hides at</label>
            <input
              id="c-hf"
              type="datetime-local"
              value={hiddenFrom}
              onChange={(e) => setHiddenFrom(e.target.value)}
            />
          </div>
        </div>
        <p className="muted small">
          Leave these blank to control the item purely with the Show, Grey out and Hide buttons.
          Setting only "becomes visible at" keeps the item hidden until that moment.
        </p>
      </details>

      {problem && <p className="error small">{problem}</p>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
