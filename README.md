# Conference Runner

Event management web app for PI planning. An event owner creates an event, sends out one link
and QR code, and everyone else does everything on the event page: schedules, session content,
group management and attendance requests, all updating live with no refresh.

Static site on GitHub Pages, with Firebase (Firestore + Google Auth) as the live backend. It runs
entirely on Firebase's free Spark plan.

---

## Setting it up

The app is a static bundle, so it needs a Firebase project of its own. This is a one-off, about
ten minutes. Until it is done the deployed site shows a setup screen rather than a blank page.

### 1. Create the Firebase project

At [console.firebase.google.com](https://console.firebase.google.com), create a project, then add
a **Web app** to it. Copy the config values it shows you.

### 2. Enable the two services

| Service | What to do |
| --- | --- |
| Authentication | Enable the **Google** sign-in provider |
| Firestore Database | Create it in **production mode**, then paste in [`firestore.rules`](firestore.rules) |

The rules file matters. The UI hides things, but the rules are what actually enforce roles.

**Storage is not needed.** Creating a bucket now requires the paid Blaze plan, so logo and
background images are linked by URL instead of uploaded. `storage.rules` is kept in the repo for
whenever uploads are wanted.

### 3. Authorise the domain

Under **Authentication, Settings, Authorized domains**, add `perpaterb.github.io` (and
`localhost` for local development). Google sign-in fails without this, and the failure is quiet.

### 4. Add the config

In GitHub, under **Settings, Secrets and variables, Actions**, add:

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

Then under **Settings, Pages**, set the source to **GitHub Actions**, and re-run the deploy
workflow.

For local development, copy `.env.example` to `.env.local` and fill in the same values.

> These keys are public by design and end up in the built JavaScript. That is normal for a
> Firebase web app: they identify the project, they do not grant access. Everything that matters
> is enforced in the rules files.

---

## Running it

```bash
npm install
npm run dev            # local dev server
npm run build          # production build
npm test               # unit and component tests
npm run typecheck
```

---

## How it fits together

```
src/lib/          pure logic, fully unit tested
  time.ts         event time zone conversion and DD MMM YYYY formatting
  csv.ts          CSV reader/writer, member and session import/export
  roles.ts        role precedence, group scoping, content visibility
  layout.ts       timeline positioning and side-by-side overlap columns
  data.ts         Firestore reads and writes
  live.ts         realtime subscriptions with a polling fallback
src/pages/        home (event CMS) and the event page
src/components/   attendee view, team console, editors
```

### Data model

```
events/{eventId}                              eventId is the 10-character link slug
  members/{email}                             roles and group memberships
  groups/{groupId}
  sessions/{sessionId}
    content/{contentId}                       schedule entries, notes, link buttons
  requests/{requestId}                        one document per recipient
```

### Some decisions worth knowing about

**Hash routing.** Event links look like `.../conference-runner/#/e/aB3dK9xQ2p`. GitHub Pages
cannot rewrite unknown paths to `index.html`, so a plain path would 404 on a hard refresh. The
hash makes deep links work with no redirect hack.

**The schedule's vertical scale is not uniform.** Stretches where you have something on are
drawn at full size; stretches where you have nothing are compressed to about an hour per tick, so
a two-day agenda with an overnight gap fits on one screen. The scale therefore differs per
attendee, and the now-line is positioned through the same mapping rather than by arithmetic.

**Times are stored as epoch milliseconds and displayed in the event's zone.** Positioning maths
is zone independent; only labels are formatted, always in the owner's chosen zone rather than the
device's. Date pickers show the event's wall clock for the same reason.

**Attendance requests are one document per recipient.** Security rules cannot iterate a list, so
a single multi-recipient document could not enforce "a group leader may only address their own
group members". Per-recipient documents can, and they make acknowledgement tracking trivial.

**Members carry denormalised `isLeader` and `ledGroupIds`.** Rules cannot iterate a map's values
either. These fields are the allow-list a leader's edits are checked against. Only team members
and leaders can write member documents, so an attendee cannot forge them.

**Dates are entered day / month-name / year.** A native `datetime-local` follows the browser's
locale and shows MM/DD/YYYY on a US machine, so `DateTimeField` replaces it everywhere.

**Live updates plus polling.** Firestore listeners are the primary transport. On top of them the
app forces a server read every 20 seconds, on tab focus, and on network reconnect. The indicator
is silent while healthy and appears only when the connection is degraded; the top bar otherwise
shows what is on now and what is next.

---

## Testing

```bash
npm test                     # 239 unit and component tests
npm run test:rules           # 57 security rules tests against a Firestore emulator
npm run test:verify-fails    # proves the suite catches broken logic
npm run story-coverage       # which user stories have automated coverage
./scripts/smoke.sh --target https://perpaterb.github.io/conference-runner/
```

`test:verify-fails` deliberately breaks seven pieces of core logic in turn (role precedence,
leader scoping, visibility windows, the scheduled-send filter, overlap columns, time zone
handling, email validation) and asserts the suite goes red each time. A check nobody has seen
fail is not a check.

`test:rules` needs Java and boots a Firestore emulator automatically. It loads the real
`firestore.rules` and exercises every role from anonymous visitor to owner.
`scripts/verify-rules-tests-fail.sh` proves that suite has teeth by opening seven deliberate
security holes and checking each one turns it red.

`story-coverage` reports honestly. At the time of writing it is **30 of 41 stories (73%)**. The
uncovered ones need a signed-in browser against a real Firebase project, which the unit suite
cannot reach, so they are listed as needing manual verification rather than quietly assumed to
work. `smoke.sh` verifies a deployment is reachable, built correctly and wired to Firebase; it
cannot sign in, so it does not prove the auth or realtime paths.

---

## Known limitations of this POC

1. **Scheduled requests are hidden by the app, not the server.** Without a Cloud Function the
   document exists from creation. Rules restrict reads to the recipient and the sender, so the
   worst case is a recipient finding their own not-yet-due request in the console.
2. **Session content is filtered client-side.** Rules let any signed-in attendee read session
   documents; which sessions and which content apply to them is decided in the UI. Enforcing this
   in rules costs a document read per session per query.
3. **Attendee emails are visible to event team members and group leaders**, which they need for
   the roster and for addressing requests. Plain attendees cannot list the roster.
4. **Logos and backgrounds are linked, not hosted.** If the URL you paste goes away, the image
   goes with it. Enabling Storage and deploying `storage.rules` would fix this.
