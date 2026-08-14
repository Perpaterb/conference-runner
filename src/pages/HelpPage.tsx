/**
 * Help and instructions (US-041).
 *
 * The user stories at the bottom are rendered from `docs/UserStories.md` itself, imported at
 * build time, so this page cannot quietly drift out of step with the source of truth.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import storiesSource from '../../docs/UserStories.md?raw'
import { countProgress, parseMarkdown, type Block, type Inline } from '../lib/markdown'
import { ThemeToggle } from '../lib/theme'
import { CollapsingActions } from '../components/ui'

function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'code') return <code key={i}>{part.text}</code>
        if (part.type === 'bold') return <strong key={i}>{part.text}</strong>
        if (part.type === 'link')
          return (
            <a key={i} href={part.href} target="_blank" rel="noreferrer noopener">
              {part.text}
            </a>
          )
        return <span key={i}>{part.text}</span>
      })}
    </>
  )
}

const CHECK_LABEL = { done: '✓', partial: '~', todo: '·' } as const

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'rule':
            return <hr key={i} className="md-rule" />
          case 'heading': {
            const Tag = `h${Math.min(block.level + 1, 6)}` as 'h2'
            return (
              <Tag key={i} className="md-heading">
                <Inlines parts={block.content} />
              </Tag>
            )
          }
          case 'paragraph':
            return (
              <p key={i}>
                <Inlines parts={block.content} />
              </p>
            )
          case 'quote':
            return (
              <blockquote key={i} className="callout">
                <Inlines parts={block.content} />
              </blockquote>
            )
          case 'list':
            return (
              <ul key={i} className="md-list list-reset">
                {block.items.map((item, j) => (
                  <li key={j} className={item.check ? `md-check ${item.check}` : undefined}>
                    {item.check && (
                      <span className="md-box" aria-label={item.check}>
                        {CHECK_LABEL[item.check]}
                      </span>
                    )}
                    <span>
                      <Inlines parts={item.content} />
                    </span>
                  </li>
                ))}
              </ul>
            )
          case 'table':
            return (
              <div key={i} className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {block.header.map((cell, j) => (
                        <th key={j}>
                          <Inlines parts={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, j) => (
                      <tr key={j}>
                        {row.map((cell, k) => (
                          <td key={k}>
                            <Inlines parts={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        }
      })}
    </>
  )
}

const ROLES: { role: string; can: string }[] = [
  {
    role: 'Owner',
    can: 'Everything an event team member can do, plus creating and deleting the event, changing its days and time zone, and customising the login page.',
  },
  {
    role: 'Event team member',
    can: 'Sessions and their content, the whole roster, groups, adding and removing people, approving attendee requests, attendance requests to anyone, and viewing as any attendee.',
  },
  {
    role: 'Group leader',
    can: 'Membership and leader status for the groups they lead, and attendance requests to people in those groups. Nothing to do with sessions.',
  },
  { role: 'Group member', can: 'Their own schedule, session content, and attendance requests addressed to them.' },
  {
    role: 'Logged in',
    can: 'On the attendee list but in no group: sees only the sessions open to everyone.',
  },
]

export default function HelpPage() {
  const blocks = useMemo(() => parseMarkdown(storiesSource), [])
  const progress = useMemo(() => countProgress(blocks), [blocks])
  const [showStories, setShowStories] = useState(false)

  return (
    <>
      <div className="topbar">
        <Link className="brand" to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
          Conference Runner
        </Link>
        <span className="badge accent">Help</span>
        <span className="spacer" />
        <CollapsingActions>
          <Link className="small ghost topbar-link" to="/">
            My events
          </Link>
          <ThemeToggle />
        </CollapsingActions>
      </div>

      <div className="page stack">
        <div className="card">
          <h1>Help and instructions</h1>
          <p className="muted">
            Conference Runner runs a PI planning event. One person creates the event and shares a
            single link; everything after that happens on the event page, live, for everyone at
            once.
          </p>
        </div>

        <div className="card">
          <h2>Setting up an event</h2>
          <ol className="stack" style={{ paddingLeft: '1.2rem', gap: '0.4rem' }}>
            <li>
              Sign in on the home page and <strong>create an event</strong>: a name, the day it
              starts, and the time zone. There is no finish date to set. The event grows to cover
              whatever sessions you add, so a two day agenda makes it a two day event by itself.
            </li>
            <li>
              The time zone matters more than it looks. <strong>Every attendee sees the times in
              the event's zone</strong>, wherever they are, so nobody has to convert anything.
            </li>
            <li>
              <strong>Customise the login page</strong>: event name, a background colour or an
              image URL, and a logo URL. Images are linked, not uploaded, so host them anywhere
              public and paste the direct link. Use <strong>Preview login page</strong> on the
              event page to see it as attendees do.
            </li>
            <li>
              Send out the <strong>link and QR code</strong> from the event card. Anyone with the
              link can sign in, but signing in does not put them on the attendee list.
            </li>
          </ol>
        </div>

        <div className="card">
          <h2>Getting people in</h2>
          <p>Three ways, and you can mix them freely:</p>
          <ul className="stack" style={{ paddingLeft: '1.2rem', gap: '0.4rem' }}>
            <li>
              <strong>Import a CSV.</strong> Download the example from People and groups: it is 20
              people across 5 groups showing leaders, people in several groups and people in none.
              Delete what you do not need. Import either adds to what is there, or wipes and
              replaces. Bad rows are reported line by line and nothing is silently dropped.
            </li>
            <li>
              <strong>Add on the spot.</strong> One field, an email address, no group needed. The
              record exists before they ever sign in, so you can group them in advance.
            </li>
            <li>
              <strong>Approve a request.</strong> Somebody who opens the link and signs in without
              being on the list asks automatically. They appear under{' '}
              <strong>Attendee requests</strong>, which carries a count on the tab.
            </li>
          </ul>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Export the roster at any time from the same tab. It is the same shape the importer
            reads, so an export is a working backup.
          </p>
        </div>

        <div className="card">
          <h2>Groups and roles</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>What they can do</th>
                </tr>
              </thead>
              <tbody>
                {ROLES.map((r) => (
                  <tr key={r.role}>
                    <td>
                      <strong>{r.role}</strong>
                    </td>
                    <td>{r.can}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: '0.6rem', marginBottom: 0 }}>
            Somebody can be a member or a leader of any number of groups. Leading one group does
            not give any power over another, even one they belong to.
          </p>
        </div>

        <div className="card">
          <h2>Building the schedule</h2>
          <ul className="stack" style={{ paddingLeft: '1.2rem', gap: '0.4rem' }}>
            <li>
              A <strong>session</strong> has a title, description, location, start and end, and the
              groups that can see it. "Add all groups" makes it open to everyone. A session with no
              groups is visible to nobody, and is flagged as such.
            </li>
            <li>
              Import a whole agenda from CSV. The example agenda is 15 sessions over two days with
              four concurrent breakouts, and its dates are generated from your event's own start
              day, so it lands on real dates.
            </li>
            <li>
              Inside a session, add <strong>content</strong>: schedule entries, notes, and link
              buttons to resources. Each item is <strong>visible</strong>, <strong>greyed out</strong>{' '}
              or <strong>hidden</strong>, either on a timer or by hand. The Show / Auto / Grey out /
              Hide buttons are spread to opposite ends of the row on purpose, so people working
              round one screen do not hit each other's control.
            </li>
          </ul>
        </div>

        <div className="card">
          <h2>Reading the schedule</h2>
          <p>
            The vertical scale is <strong>not uniform</strong>, and that surprises people. Stretches
            where you have something on are drawn at full size; stretches where you have nothing are
            squeezed to roughly an hour per mark and shaded with diagonal stripes. That is what
            keeps a two day agenda with a night in the middle on one screen.
          </p>
          <ul className="stack" style={{ paddingLeft: '1.2rem', gap: '0.4rem' }}>
            <li>
              Because it depends on <em>your</em> sessions, two people can see the same day at
              different scales. The red line is placed through the same mapping, so it is always in
              the right place.
            </li>
            <li>
              The day runs midnight to midnight. Hour marks only appear within three hours of a
              session, so the small hours stay quiet.
            </li>
            <li>
              The view follows the red line during the event and stops the moment you scroll. The{' '}
              <strong>Now</strong> button brings it back.
            </li>
            <li>Sessions running at the same time appear side by side.</li>
          </ul>
        </div>

        <div className="card">
          <h2>Running the event</h2>
          <ul className="stack" style={{ paddingLeft: '1.2rem', gap: '0.4rem' }}>
            <li>
              The top bar shows what is on now and what is next, for whoever is being viewed.
            </li>
            <li>
              <strong>View as attendee</strong> shows exactly what one person sees, read only, with
              a striped banner naming them. It also reports how many of the event's sessions reach
              them, so a thin schedule is obviously group filtering rather than a fault.
            </li>
            <li>
              <strong>Attendance requests</strong> ask named people to be somewhere at a time, with
              free text. Group leaders can only address their own group members. A request can be
              scheduled to appear later. Recipients see it pop up without refreshing and can
              acknowledge it.
            </li>
            <li>
              Everything is live. An edit on one screen appears on every other, with no refresh.
            </li>
          </ul>
        </div>

        <div className="card">
          <h2>When something looks wrong</h2>
          <dl className="stack" style={{ gap: '0.6rem', margin: 0 }}>
            <div>
              <dt>
                <strong>"You are not on the attendee list"</strong>
              </dt>
              <dd className="muted" style={{ margin: 0 }}>
                Signing in is not membership. The request is already sent; an event team member
                approves it under Attendee requests. The page updates itself the moment they do.
              </dd>
            </div>
            <div>
              <dt>
                <strong>"You are not in any groups yet"</strong>
              </dt>
              <dd className="muted" style={{ margin: 0 }}>
                You are on the list, so you see the sessions open to everyone. The event team can
                add you to a group for the rest.
              </dd>
            </div>
            <div>
              <dt>
                <strong>An amber "Polling" or red "Offline" badge</strong>
              </dt>
              <dd className="muted" style={{ margin: 0 }}>
                The app is serving from its local cache and what you are reading may be out of
                date. It disappears by itself when the connection recovers. No badge means live.
              </dd>
            </div>
            <div>
              <dt>
                <strong>"Missing or insufficient permissions"</strong>
              </dt>
              <dd className="muted" style={{ margin: 0 }}>
                Almost always the Firestore security rules in the Firebase project being older
                than the app. Re-publish <code>firestore.rules</code> from the repository.
              </dd>
            </div>
            <div>
              <dt>
                <strong>Google sign-in does nothing</strong>
              </dt>
              <dd className="muted" style={{ margin: 0 }}>
                The site's domain has to be listed under Firebase Authentication, Settings,
                Authorized domains, and the Google Cloud OAuth consent screen must be published
                rather than left in testing.
              </dd>
            </div>
          </dl>
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>User stories</h2>
            <button onClick={() => setShowStories((v) => !v)}>
              {showStories ? 'Hide' : 'Show'} user stories
            </button>
          </div>
          <p className="muted small" style={{ marginTop: '0.5rem' }}>
            What the product is meant to do, and how far along each part is. This is rendered from{' '}
            <code>docs/UserStories.md</code> in the repository, so it cannot drift out of date.{' '}
            <strong>{progress.done}</strong> criteria are done and covered by an automated test,{' '}
            <strong>{progress.partial}</strong> are built but need checking by hand, and{' '}
            <strong>{progress.todo}</strong> are not done.
          </p>
          {showStories && (
            <div className="markdown">
              <Blocks blocks={blocks} />
            </div>
          )}
        </div>
      </div>
    </>
  )
}
