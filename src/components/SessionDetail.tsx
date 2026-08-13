/** What an attendee sees inside a session (US-055): its content, filtered by visibility state. */

import { orderBy } from 'firebase/firestore'
import { useLiveCollection } from '../lib/live'
import { paths, toContent } from '../lib/data'
import { contentState } from '../lib/roles'
import { formatDateTime, formatTime } from '../lib/time'
import type { ContentDoc, EventDoc, GroupDoc, SessionDoc } from '../lib/types'

export default function SessionDetail({
  event,
  session,
  groups,
  now,
}: {
  event: EventDoc
  session: SessionDoc
  groups: GroupDoc[]
  now: number
}) {
  const content = useLiveCollection(paths.content(event.id, session.id), toContent, [
    orderBy('order'),
  ])

  const groupNames = session.allGroups
    ? ['Everyone']
    : session.groupIds.map((id) => groups.find((g) => g.id === id)?.name ?? id)

  // Hidden items are not rendered at all; greyed ones are shown dimmed and inert.
  const items = content.data
    .filter((c) => contentState(c, now) !== 'hidden')
    .sort((a, b) => a.order - b.order)

  return (
    <div className="stack">
      <div>
        <p className="muted small" style={{ margin: 0 }}>
          {formatDateTime(session.startAt, event.timeZone)} to{' '}
          {formatTime(session.endAt, event.timeZone)} ({event.timeZone})
          {session.location ? ` · ${session.location}` : ''}
        </p>
        {session.description && <p style={{ marginTop: '0.5rem' }}>{session.description}</p>}
        <div className="row">
          {groupNames.map((n) => (
            <span key={n} className="badge">
              {n}
            </span>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="muted">Nothing has been shared in this session yet.</p>
      ) : (
        <div className="stack">
          {items.map((item) => (
            <AttendeeContentItem key={item.id} item={item} event={event} now={now} />
          ))}
        </div>
      )}
    </div>
  )
}

function AttendeeContentItem({
  item,
  event,
  now,
}: {
  item: ContentDoc
  event: EventDoc
  now: number
}) {
  const state = contentState(item, now)
  return (
    <div className={`content-item state-${state}`} aria-disabled={state === 'grey'}>
      <strong>{item.title}</strong>
      {item.type === 'schedule' && item.scheduleStartAt !== undefined && (
        <div className="muted small">
          {formatTime(item.scheduleStartAt, event.timeZone)}
          {item.scheduleEndAt !== undefined
            ? ` to ${formatTime(item.scheduleEndAt, event.timeZone)}`
            : ''}
        </div>
      )}
      {item.body && <p style={{ whiteSpace: 'pre-wrap', marginTop: '0.35rem' }}>{item.body}</p>}
      {item.type === 'link' && item.url && (
        <p style={{ marginTop: '0.4rem', marginBottom: 0 }}>
          <a href={item.url} target="_blank" rel="noreferrer noopener">
            Open resource
          </a>
        </p>
      )}
    </div>
  )
}
