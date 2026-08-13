# Technical log

One entry per story ID: what was actually built, and the files added or changed.

---

## EP1: Platform

### US-001 Static SPA on GitHub Pages

Vite + React 18 + TypeScript, built and published by GitHub Actions on push to `main`. The
workflow typechecks and runs the tests before building, and uses a `pages` concurrency group with
`cancel-in-progress: false` so a second push queues rather than killing a running deploy.

`HashRouter` is deliberate: Pages cannot rewrite unknown paths to `index.html`, so `/e/<slug>`
would 404 on a hard refresh. Event URLs are `.../conference-runner/#/e/aB3dK9xQ2p`.

Files: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`,
`src/App.tsx`, `.github/workflows/deploy.yml`

### US-002 Firebase project wiring

Firebase initialises lazily from `VITE_FIREBASE_*`. `isFirebaseConfigured()` gates the whole app:
with no config it renders a setup screen listing the exact steps, rather than a blank page.

Files: `src/lib/firebase.ts`, `src/pages/SetupNeeded.tsx`, `src/vite-env.d.ts`, `.env.example`,
`README.md`, `src/App.test.tsx`

### US-003 Security rules

Rules resolve the caller's role by reading their own member document, then gate every collection
on it. Two constraints shaped the data model: rules cannot iterate a map's values, and cannot
iterate a list. Hence the denormalised `isLeader` / `ledGroupIds` fields on member documents, and
one request document per recipient.

**Verified by 57 tests against a real Firestore emulator** (`npm run test:rules`), covering every
role from anonymous visitor to owner, plus cross-event isolation and the deny-by-default floor.
The tests load the actual `firestore.rules` file, so they test the deployed rules rather than a
copy. Fixtures are written with rules disabled, so a broken rule cannot quietly skip the seed and
make a later assertion pass for the wrong reason.

They passed first time, which only means something if they can fail, so
`scripts/verify-rules-tests-fail.sh` opens seven deliberate holes in turn (self-promotion, roster
listing, leader scoping, request scoping, event listing, session writes, request rewriting) and
asserts the suite goes red for each. All seven are caught.

The rules job runs in CI with a Java 21 runtime and gates the deploy.

Files: `firestore.rules`, `storage.rules`, `src/lib/types.ts`, `firebase.json`,
`vitest.rules.config.ts`, `src/rules/helpers.ts`, `src/rules/firestore.rules.test.ts`,
`scripts/verify-rules-tests-fail.sh`, `.github/workflows/deploy.yml`

---

## EP2: Event creation

### US-010, US-011, US-013 Event CMS

Owner signs in, creates an event with a name, start, end and IANA time zone. The event id *is*
the 10-character slug, so the URL needs no lookup; the slug uses a confusable-free alphabet and
retries on collision rather than overwriting. The owner is written as an event team member at
creation so the roster is never empty. QR codes render locally via `qrcode`, no external service.

`deleteEvent` clears the subcollections before the event document, because Firestore does not
cascade: deleting the parent alone would orphan every member, session and request while leaving
them readable to anyone who kept the link. Batches are chunked at 400 to stay under the 500
operation limit. The confirmation asks the owner to type the event name, since a two-click
confirm is too easy to fire by accident for something irreversible.

Start and end prefill via `defaultEventWindow`: today 09:00 to tomorrow 17:00, as wall-clock
times in the event's zone. "Tomorrow" is found by probing from midday and adding 24 hours so a
daylight-saving shift cannot repeat or skip a date.

`LoginPreview` in the team console renders the signed-out login page on demand. Without it a team
member has no way to see their own branding, because the real login page only ever appears to
someone who is not signed in.

A "My events" link sits top right of the event page for the owner only, since nobody else can
create events. It is a real `Link`, not a button, so it middle-clicks and opens in a new tab like
any other navigation.

Files: `src/pages/HomePage.tsx`, `src/pages/EventPage.tsx`, `src/components/ui.tsx`,
`src/lib/data.ts`,
`src/components/TeamConsole.tsx`, `src/lib/time.ts`

### US-012 Login page customisation

Logo and background are **linked by URL**, not uploaded. Firebase Storage now requires the paid
Blaze plan to create a bucket, so the POC stays on the free Spark plan. `isUsableImageUrl()`
accepts only `http:` and `https:`, rejecting `javascript:`, `data:` and `file:` rather than
putting them in an `img` tag. When no logo is linked the preview shows a dashed "Your logo here"
placeholder.

`storage.rules` is retained but unused; the Storage SDK import was removed from `firebase.ts` so
the bundle no longer carries it.

Files: `src/pages/HomePage.tsx`, `src/lib/data.ts` (`isUsableImageUrl`), `src/lib/firebase.ts`,
`src/pages/SetupNeeded.tsx`, `src/styles.css`, `src/lib/data.test.ts`

### US-010, US-012 Date entry

`DateTimeField` replaces every `<input type="datetime-local">`. The native control renders in the
OS locale, so on a US-locale machine it shows MM/DD/YYYY, which the house style forbids. The
replacement is built from separate fields ordered day, month-by-name, year, and echoes the value
back as `28 Jun 2026, 09:00` so the format is unmistakable. Conversion happens in the event's zone
throughout, and impossible dates such as 31 Feb are rejected rather than rolled into March.

Files: `src/components/DateTimeField.tsx`, `src/components/DateTimeField.test.tsx`,
`src/styles.css`, `src/pages/HomePage.tsx`, `src/components/SessionsTab.tsx`,
`src/components/ContentEditor.tsx`, `src/components/RequestsTab.tsx`

### US-014 Light and dark theme

`ThemeProvider` holds three states: `light`, `dark`, or `system`, which follows
`prefers-color-scheme` and keeps following it while the page is open. The resolved value is
stamped on `<html>` as `data-theme`, and CSS defines the light palette as a complete override so
no colour falls back to a dark value on a light background. Colours that were hardcoded for dark
(danger text, accent chips, the impersonation banner) became variables with a value in each
palette. `colorScheme` is set too, so scrollbars and native controls match.

Files: `src/lib/theme.tsx`, `src/styles.css`, `src/App.tsx`, `src/pages/HomePage.tsx`,
`src/pages/EventPage.tsx`, `src/pages/SetupNeeded.tsx`

### US-036 Worked example data

The downloadable CSVs are worked examples rather than bare headers, so someone can see what the
format supports and delete what they do not need.

The member example is 20 people over Platform, Design, Data, QA and Leadership, and deliberately
includes the awkward cases: an event team member who also leads a group, someone leading one
group while merely belonging to another, one person in three groups, two leaders on a group, and
two people in no group at all so the "You are not in any groups" state is easy to demonstrate.

The agenda is **generated from the event's own start date** rather than being a fixed string, so
it imports onto real dates instead of landing in the past. It is 15 sessions over two days, with
four concurrent breakouts in separate rooms and a Leadership session overlapping a cross-team
one, which is what exercises the side-by-side timeline layout.

Files: `src/lib/csv.ts`, `src/lib/csv.test.ts`, `src/components/SessionsTab.tsx`,
`src/components/PeopleTab.tsx`, `src/components/TeamConsole.tsx`

---

## EP3: Event login and registration

### US-020, US-021, US-022

The login page renders the owner's customisation before sign-in, from linked image URLs. Popup
sign-in falls back to redirect when popups are blocked, and an unauthorised domain
produces a specific message naming the fix. First sign-in writes the member record; rules permit
that create only with zero privileges, which is what stops self-promotion.

Files: `src/lib/auth.tsx`, `src/pages/EventPage.tsx`, `src/components/AttendeeView.tsx`,
`src/lib/data.ts` (`ensureMemberRecord`)

---

## EP4: Roles, groups and CSV

### US-030 to US-035

CSV handling is hand-written rather than a library so failures can be reported per row. The reader
handles quoted fields, embedded commas and newlines, doubled quotes, CRLF, a UTF-8 BOM and blank
lines. The member format is variable-width: column pairs after the first two are (group name, is
leader), repeated.

Import runs in additive or wipe mode; wipe never deletes the owner. Group ids are slugs derived
from the name, so a CSV round-trip matches by name.

Role precedence lives in one pure function, `resolveRole`, mirrored by the rules.

The roster stays workable at scale through a group column filter. It stores **hidden** ids rather
than shown ids, so a group created later appears by default instead of silently vanishing from
everyone's table, and the set is persisted in `localStorage` per event. People in a hidden group
get a `+N hidden` badge, without which the table would read as though they were in fewer groups
than they are. `membersInAnyGroup` backs the optional row filter. The email column is
`position: sticky` so it stays readable while the group columns scroll sideways.

Files: `src/lib/csv.ts`, `src/lib/roles.ts`, `src/lib/data.ts`, `src/components/PeopleTab.tsx`,
`src/lib/csv.test.ts`, `src/lib/roles.test.ts`, `src/components/PeopleTab.test.tsx`,
`src/styles.css`

---

## EP5: Sessions and content

### US-040 to US-046

Sessions carry either explicit group ids or an `allGroups` flag. Content items are a subcollection
with an `order` field, and three optional timestamps (`visibleFrom`, `greyFrom`, `hiddenFrom`)
plus a manual `override` that wins over them. `contentState()` is the single source of truth,
shared by the attendee view and the editor.

US-044: the Show / Auto / Grey out / Hide controls are laid out with `justify-content:
space-between` and flexible spacers, pushing them to opposite ends of the row, with the
destructive Hide at the far end.

Session CSV uses `DD MMM YYYY HH:mm` read in the event's zone, with a `groups` column that is
semicolon separated or the literal `ALL`.

Files: `src/components/SessionsTab.tsx`, `src/components/ContentEditor.tsx`,
`src/components/SessionDetail.tsx`, `src/lib/roles.ts`, `src/lib/csv.ts`, `src/styles.css`

---

## EP6: Attendee timeline

### US-050 to US-055

The vertical scale is **piecewise linear, not uniform**. A fixed pixels-per-minute strip wasted
enormous space on quiet hours and pushed day two off the bottom of the screen. `buildTimeScale`
merges the sessions this person can see into busy intervals, draws those at 2px per minute, and
compresses everything else to about 22px per hour, capped so an overnight gap cannot dominate.
`yForEpoch` maps an instant through those segments, so the now-line lands correctly without any
arithmetic of its own; positioning it by a fixed distance per hour would put it in the wrong
place entirely. Because busy stretches come from *this person's* sessions, the scale differs
from one attendee to the next.

The range is widened to cover any session falling outside the event's own start and end. Before
that, such a session was positioned off the strip and never appeared, which is one explanation
for sessions seeming to go missing.

Position maths uses epoch milliseconds, so it is time zone independent; only labels are
formatted, always in the event's zone. `datetime-local` inputs are fed the event's wall clock
rather than the browser's, which is the subtle part of US-050.

Overlap layout groups sessions into clusters of transitively overlapping items and assigns each
the first free column; every session in a cluster reports the same column count so widths line up.

The now line is `position: absolute` with a high z-index. Before the event it pins to the top with
a countdown, during the event it tracks the current time, after it sits below the schedule.

The snap follows a `following` flag: on while the view tracks the now line at one quarter from the
top, off the moment the user scrolls, back on via the "Now" button. Smooth-scroll events are
ignored for 800ms so the programmatic scroll does not read as the user taking over. This is what
keeps the schedule scrollable.

### US-058 The axis

The timeline is a CSS grid with the axis as a real 86px column. It was previously absolutely
positioned into a negative offset inside the scrolling box, and a scroll container clips content
to the left of its origin, which is how the times ended up off the left edge and unreachable.

The scale runs midnight to midnight (`startOfDayEpoch` / `endOfDayEpoch`) rather than event start
to event end, so the morning before the event begins reads as quiet time instead of the day
appearing to start at 09:00.

`hourTicks` applies three rules, in order of importance. Marks more than three hours from any
session are dropped, since hour lines through the small hours tell nobody anything. Marks inside
a busy stretch are always kept: those are drawn at full size so there is room, and the hour a
session starts is the most useful label on the axis. Marks inside a compressed stretch are kept
on a stride derived from that stretch's own density.

The stride replaced a simple "drop anything within 18px of the last one" rule, which produced two
visible faults. Day one showed 06:00, 07:00, 08:00, 09:00 while day two showed only 06:00 and
08:00, because an overnight gap is compressed harder than a morning one and the rule had no
per-stretch memory. Worse, it dropped 09:00 on a day whose first session began at 09:00.

Dates moved to their own column on the far left, one band per day reading bottom to top
(`writing-mode: vertical-rl`), so a date can never collide with a time. The column only appears
on multi-day events. Time labels are centred on the line they name with `translateY(-50%)`
rather than sitting above it.

Because the schedule now runs midnight to midnight, "before the event" no longer implies "off the
top of the timeline": at 11:45 on the morning of a 14:00 start, the now-line belongs at 11:45. It
is positioned at the real time whenever now falls inside the displayed range, and only pins to
the top when it genuinely does not.

### US-051 Card density

Card content is chosen from the rendered height, not the duration, because the same duration
occupies different space depending on the compression around it. Under 52px a card gets one
clipped line; under 86px, title and times; above that, the description as well, clamped to two
lines. Short cards drop most of their vertical padding so the text gets the room.

### US-061 Coverage indicator

While previewing or impersonating, a team member sees "Sees N of M sessions" and the person's
groups. A short schedule is usually correct group filtering rather than a fault, and there was
previously no way to tell those apart from the inside.

Files: `src/lib/layout.ts`, `src/components/Timeline.tsx`, `src/lib/time.ts`,
`src/components/AttendeeView.tsx`,
`src/styles.css`, `src/lib/layout.test.ts`, `src/lib/time.test.ts`,
`src/components/AttendeeView.test.tsx`

### US-056, US-057 Live updates and polling

`useLiveCollection` / `useLiveDoc` wrap `onSnapshot` and add a 20 second forced server read plus
a refresh on tab focus and on `online`.

The status is derived from `snapshot.metadata.fromCache`, which is Firestore reporting whether it
answered from its backend or from the local cache. An earlier version flipped to "polling" after
45 seconds without a snapshot, which fired a few minutes after every page load: a healthy
listener sends nothing at all while nothing changes, so silence looks identical to a dead socket
if you only watch the clock. The listeners subscribe with `includeMetadataChanges` so a drop to
cached data is actually observed.

`deriveLiveStatus` is extracted and pure so the status ladder can be tested. It returns `error`
ahead of `connecting`: a read the rules reject never yields a snapshot, so a caller waiting for
the status to leave `connecting` would wait forever. That was the cause of signed-out visitors
seeing an endless spinner on the event page.

Files: `src/lib/live.ts`, `src/components/ui.tsx`, `src/lib/live.test.ts`

---

## EP7: Team views

### US-061 (US-060 withdrawn)

`EventShell` holds one piece of state, `impersonating`. It renders the same `AttendeeView` the
attendee gets with the member record swapped, so there is no second code path to drift.
Impersonation passes `readOnly`, which disables acknowledgement, and shows a striped banner.

The separate "live attendee view" toggle was removed. It rendered the identical screen with no
banner and no named subject, which made it easy to forget whose view was on screen, and it showed
the team member's own schedule, which is usually empty.

### US-010 Events are days, not clock times

An event's start and end used to be datetimes the owner guessed up front, which then contradicted
whatever the session import contained. Creation now asks only for the **day it starts**, stored
as midnight to midnight in the event's zone. There is no last day to set: `effectiveEventRange`
grows the event to cover whatever is scheduled, so a two day agenda makes it a two day event on
its own. The start day is also what seeds the session CSV template's dates.

The home page reads each event's sessions so its card shows the days actually covered rather than
the day originally chosen. That is one extra read per event, which is fine at this scale and
avoids storing a denormalised range that could drift.

Nothing has to reconcile a conflict, because there is no conflict to have: a session outside the
chosen days simply extends the schedule, via `effectiveEventRange`.

### US-038 Membership is granted, not taken

Signing in used to create a member record, so anyone with the link was on the attendee list.
Now `refreshMemberProfile` only updates an existing record, the security rules no longer permit
self-creation at all, and somebody with no record lands on a "You are not on the attendee list"
screen.

The request to be added is raised automatically rather than behind a button: holding the link is
already the intent to attend. It is keyed by email, so asking twice is a no-op. The event team
sees a "Waiting to be added" queue; approving writes the member and deletes the request in one
batch, so the queue cannot show a stale entry for somebody already added.

That change also removed a bug: the client used to try to create the member record on every
sign-in and report "could not register you on this event: missing or insufficient permissions"
when the write was refused, on a page that was otherwise working perfectly.

### US-039 Collapsing top bar

`CollapsingActions` renders its children inline above 860px and behind a burger below it. The
children are the same elements in both layouts, so there is no second copy to drift.

### US-037 Adding on the spot

`addMemberByEmail` creates a member record from an email alone, with no groups. That is the
"logged in" state, and it exists before the person ever signs in, so the team can place them in a
group and address them in advance. It refuses an email already on the event rather than silently
overwriting that person's groups and roles.

Email validation is `isValidEmail`, exported from the CSV module and shared with the importer, so
a person you can add by hand is exactly a person you can import.

### Effective event range

An event's recorded start and end can be narrower than its own agenda: a POC event was saved as
running 14:21 to 14:22 while its imported schedule covered the whole day. Deciding "before /
during / after" from the event document alone then reported "starts in 2 hr" while lunch was on,
and the timeline, the now-line and the status bar disagreed with each other.

`effectiveEventRange` widens the window to cover any session outside it, and every place that
asks the question uses it: the timeline scale, the phase, the countdown and the status bar. The
event document alone is never the answer.

### US-059 Conference status

The permanent connection indicator was replaced with what is actually happening: time to start,
what is on now including concurrent sessions, and what is next. It is computed from the sessions
the current viewer can see, so it follows impersonation.

There were three connection badges on screen at once (top bar, team console tabs, session
detail). There is now one, and it renders only when the connection is degraded. A healthy socket
is not news; a stale one is.

Files: `src/pages/EventPage.tsx`, `src/components/TeamConsole.tsx`, `src/styles.css`,
`src/lib/status.ts`, `src/components/ConferenceStatus.tsx`, `src/lib/status.test.ts`,
`src/components/SessionDetail.tsx`

---

## EP8: Attendance requests

### US-070 to US-073

One document per recipient, sharing a `batchId`. This is what makes US-073 enforceable: rules can
`get()` the single named recipient and check they are in the group the sender is acting through,
which is impossible for a list of recipients. The sender's view regroups by `batchId`.

Scheduled sends store `sendAt` and are filtered client-side by `dueRequestsFor`. Attendees
subscribe with a `where('recipientEmail', '==', ...)` constraint, which is required: the list rule
rejects any broader query.

Files: `src/components/RequestsTab.tsx`, `src/components/AttendeeView.tsx`, `src/lib/data.ts`,
`src/lib/roles.ts`, `firestore.rules`

---

## Testing

248 unit and component tests, plus 62 security rules tests across `time`, `csv`, `roles`, `layout`, `data`, the attendee view
and the unconfigured-app path.

`scripts/verify-tests-fail.sh` mutates seven pieces of core logic in turn and asserts the suite
goes red for each. All seven are caught. `scripts/story-coverage.mjs` reports which stories have
automated coverage (24 of 37) and lists the rest as needing manual verification.
`scripts/smoke.sh --target <url>` checks a deployment is reachable, built and wired to Firebase.

Files: `src/**/*.test.ts(x)`, `src/test/setup.ts`, `scripts/verify-tests-fail.sh`,
`scripts/story-coverage.mjs`, `scripts/smoke.sh`
