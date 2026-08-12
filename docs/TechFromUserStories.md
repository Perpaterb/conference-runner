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

Not verified by an emulator suite. Recorded as the main open risk.

Files: `firestore.rules`, `storage.rules`, `src/lib/types.ts`

---

## EP2: Event creation

### US-010, US-011, US-013 Event CMS

Owner signs in, creates an event with a name, start, end and IANA time zone. The event id *is*
the 10-character slug, so the URL needs no lookup; the slug uses a confusable-free alphabet and
retries on collision rather than overwriting. The owner is written as an event team member at
creation so the roster is never empty. QR codes render locally via `qrcode`, no external service.

Files: `src/pages/HomePage.tsx`, `src/components/ui.tsx`, `src/lib/data.ts`

### US-012 Login page customisation

Logo and background upload to Firebase Storage under `events/{eventId}/`, with a live preview of
the login page beside the form.

Files: `src/pages/HomePage.tsx`, `src/lib/data.ts` (`uploadEventImage`), `storage.rules`

---

## EP3: Event login and registration

### US-020, US-021, US-022

The login page renders the owner's customisation before sign-in, which is why Storage reads are
public. Popup sign-in falls back to redirect when popups are blocked, and an unauthorised domain
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

Files: `src/lib/csv.ts`, `src/lib/roles.ts`, `src/lib/data.ts`, `src/components/PeopleTab.tsx`,
`src/lib/csv.test.ts`, `src/lib/roles.test.ts`

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

The timeline is a fixed pixels-per-minute strip from event start to event end. Position maths uses
epoch milliseconds, so it is time zone independent; only labels are formatted, always in the
event's zone. `datetime-local` inputs are fed the event's wall clock rather than the browser's,
which is the subtle part of US-050.

Overlap layout groups sessions into clusters of transitively overlapping items and assigns each
the first free column; every session in a cluster reports the same column count so widths line up.

The now line is `position: absolute` with a high z-index. Before the event it pins to the top with
a countdown, during the event it tracks the current time, after it sits below the schedule.

The snap follows a `following` flag: on while the view tracks the now line at one quarter from the
top, off the moment the user scrolls, back on via the "Now" button. Smooth-scroll events are
ignored for 800ms so the programmatic scroll does not read as the user taking over. This is what
keeps the schedule scrollable.

Files: `src/lib/layout.ts`, `src/lib/time.ts`, `src/components/AttendeeView.tsx`,
`src/styles.css`, `src/lib/layout.test.ts`, `src/lib/time.test.ts`,
`src/components/AttendeeView.test.tsx`

### US-056, US-057 Live updates and polling

`useLiveCollection` / `useLiveDoc` wrap `onSnapshot` and add a 20 second forced server read, a
refresh on tab focus and on `online`, and a status derived from how long it has been since the
last snapshot: live, polling, offline. Rendered by `ConnectionBadge`.

Files: `src/lib/live.ts`, `src/components/ui.tsx`

---

## EP7: Team views

### US-060, US-061

`EventShell` holds two pieces of state: `attendeePreview` (the team member watching the generic
attendee experience) and `impersonating` (a specific member). Both render the same `AttendeeView`
component the attendee gets, with the member record swapped, so there is no separate code path to
drift. Impersonation passes `readOnly`, which disables acknowledgement, and shows a striped
banner.

Files: `src/pages/EventPage.tsx`, `src/components/TeamConsole.tsx`, `src/styles.css`

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

106 unit and component tests across `time`, `csv`, `roles`, `layout`, the attendee view and the
unconfigured-app path.

`scripts/verify-tests-fail.sh` mutates seven pieces of core logic in turn and asserts the suite
goes red for each. All seven are caught. `scripts/story-coverage.mjs` reports which stories have
automated coverage (20 of 37) and lists the rest as needing manual verification.
`scripts/smoke.sh --target <url>` checks a deployment is reachable, built and wired to Firebase.

Files: `src/**/*.test.ts(x)`, `src/test/setup.ts`, `scripts/verify-tests-fail.sh`,
`scripts/story-coverage.mjs`, `scripts/smoke.sh`
