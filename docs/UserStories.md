# Conference Runner: User Stories

Event management web app for PI planning. Static SPA on GitHub Pages, Firebase (Firestore +
Google Auth) as the live backend.

## Status key

| Mark | Meaning |
| --- | --- |
| `[x]` | Built, and verified by an automated test |
| `[~]` | Built, but **not** verified automatically. Needs manual checking against a live Firebase project |
| `[ ]` | Not built, or built but known unverified in a way that matters |

The distinction is deliberate. Most of the `[~]` items need a signed-in browser talking to a real
Firebase project, which the unit suite cannot reach. `npm run story-coverage` prints the same
split. Current automated story coverage: **24 of 37 (65%)**.

---

## EP1: Platform and deployment

### US-001 Static SPA on GitHub Pages
As a developer, I want the app to deploy to GitHub Pages so the POC has a public URL.

- [x] React + TypeScript + Vite app builds clean with `npm run build`
- [x] Base path works under `/conference-runner/` (confirmed in the build output)
- [x] Deployed by GitHub Actions on push to `main`, live at
      <https://perpaterb.github.io/conference-runner/>
- [x] Deep links to an event survive a hard refresh (hash routing, verified by `scripts/smoke.sh`
      against the live deployment)

### US-002 Firebase project wiring
As a developer, I want Firebase configured from build-time env so no secrets are hardcoded.

- [x] A Firebase project is attached: the config is baked into the deployed bundle, verified by
      `scripts/smoke.sh` passing all 7 checks against the live site
- [x] Firestore and Google Auth initialised from `VITE_FIREBASE_*` env vars
- [x] When config is absent, the app shows a setup screen instead of a blank page
- [x] The setup screen names every required variable and the authorized-domains step
- [x] README documents every setup step

### US-003 Security rules enforce every role
As an owner, I want roles enforced by the backend so nobody can bypass them with the browser
console.

- [~] `firestore.rules` restricts every collection by role
- [~] `storage.rules` restricts uploads to the event owner (unused: Storage is not enabled)
- [ ] **A non-team attendee cannot write sessions, edit membership, or self-promote.** The rules
      are written to prevent this and the equivalent client-side logic is unit tested, but the
      rules themselves are unverified: that needs a Firebase emulator test suite, which is not
      built. Treat this as the largest open risk in the POC.

---

## EP2: Event creation (CMS home page)

### US-010 Owner creates an event
- [~] Google sign-in on the home page
- [~] Create event with name, start datetime, end datetime and event time zone
- [x] Dates display as DD MMM YYYY, never US ordering
- [x] Date **entry** is Day / Month-name / Year regardless of browser locale, not a native
      `datetime-local` (which renders MM/DD/YYYY on a US-locale machine)
- [x] Impossible dates such as 31 Feb are rejected rather than rolled forward
- [x] Start and end prefill to today 09:00 and tomorrow 17:00 in the chosen zone, and follow the
      zone if it is changed before the owner edits them

### US-011 Event link and QR code
- [x] Every event gets a 10-character random URL slug, from a confusable-free alphabet
- [~] Owner sees a copyable shareable link
- [~] Owner sees a QR code and can download it as PNG

### US-012 Login page customisation
- [x] Logo linked by URL, with a "Your logo here" placeholder when unset
- [x] Only http(s) URLs are accepted; other schemes are rejected
- [~] Background image by URL, or a solid background colour
- [~] Event name text shown on the login page
- [~] Live preview of the login page while editing

> Changed from upload to link: Firebase Storage now requires the paid Blaze plan to create a
> bucket, so the POC stays on the free Spark plan. `storage.rules` is kept in the repo for
> whenever uploads are wanted.

### US-013 Owner event list
- [~] Owner sees all events they own and can reopen any
- [~] Each event has a Delete button, gated on typing the event name
- [~] Deleting removes the sessions, content, groups, members and requests underneath, not just
      the event document
- [~] A team member can preview the login page from the event page, since the real one only
      appears to signed-out visitors
- [x] The home page does nothing else; all other work happens on the event page

---

## EP3: Event login page

### US-020 Anyone with the link can sign in
- [x] A signed-out visitor reaches the sign-in button and is never left on a spinner
- [~] Login page renders the owner's logo, event name and background (needs the updated
      `firestore.rules` deployed, which makes a single event world-readable)
- [~] Google sign-in, open to any Google account holding the link
- [~] A blocked popup falls back to redirect sign-in
- [~] An unauthorised domain produces a readable error, not a silent failure

### US-021 First sign-in creates an attendee record
- [~] A member record keyed by lowercased email is created on first sign-in
- [~] Team members can see and address that person even if they were never in the CSV

### US-022 Ungrouped users see nothing but their email
- [x] A signed-in user with no group memberships sees their email
- [x] They see "You are not in any groups" and no schedule
- [x] They still receive attendance requests

---

## EP4: Roles, groups and member CSV

### US-030 Owner onboarding prompt
- [~] On the owner's first login to their event, they are prompted to download the CSV template
- [~] The prompt can be dismissed and does not return

### US-031 Member CSV import
- [x] Columns: `email, isEventTeamMember, group1Name, group1Leader, ...`
- [x] Variable column count; a person can be member or leader of any number of groups
- [x] Emails are lowercased so matching is case insensitive
- [x] Malformed rows are reported per row, not silently dropped
- [x] Duplicate emails, invalid emails and orphaned leader flags are each reported
- [~] Additive (merge) mode writes to Firestore
- [~] Wipe and replace mode, behind an explicit confirmation, never removes the owner
- [~] Import result states how many rows applied and how many were rejected

### US-032 Member CSV export
- [x] Exports the same column shape the importer reads
- [x] Round-trips: export then import preserves roles and memberships
- [x] Rows are padded so every record has the full column count

### US-033 Manual membership management
- [x] Permission logic for who may edit which group is unit tested
- [~] Any event team member can add or remove group membership
- [~] Any event team member can toggle leader status and event-team status
- [x] Group columns can be shown or hidden individually, with All and None
- [x] All is disabled when everything is shown, None when nothing is
- [x] Someone in a hidden group is flagged, so the table cannot be misread
- [x] The choice is remembered per event, and a newly created group appears by default
- [x] Optionally hides people who are in none of the shown groups
- [~] The person's email column stays put while the group columns scroll sideways

### US-034 Group leader scoped management
- [x] A leader can manage groups they lead
- [x] A leader **cannot** manage a group they are merely a member of
- [~] Enforced in security rules via the denormalised `ledGroupIds` allow-list (unverified, see
      US-003)

### US-035 Role resolution
- [x] Precedence: Owner > Event team member > Group leader > Group member > logged in
- [x] The owner is recognised by uid or by email, before their uid is recorded

---

## EP5: Sessions and session content

### US-040 Session CRUD
- [~] Event team member can create, edit and delete sessions
- [~] Session has title, description, location, start time and end time
- [~] Deleting a session also deletes its content subcollection

### US-041 Group assignment
- [x] Attendees see all-groups sessions plus sessions for their own groups, and nothing else
- [~] An "add all groups" action
- [~] A session with no groups is flagged as invisible to everyone

### US-042 Session content items
- [~] Schedule entries, notes and link buttons
- [~] Content can be reordered, edited and deleted

### US-043 Content visibility states
- [x] Visible, greyed out or hidden
- [x] Time driven: visible-from, grey-from, hidden-from
- [x] Manual override wins over the schedule
- [x] Hidden items are filtered out of the attendee view entirely

### US-044 Separated visibility controls
- [~] Every item shows its current state, and whether an override is in play
- [~] Show / Auto / Grey out / Hide are pushed to opposite ends of the row so co-located team
      members do not misclick. This is a layout property; it needs a human to confirm it works
      on the screens the team actually uses

### US-045 Session CSV import
- [x] Reads title, description, location, start, end and groups (semicolon separated, or ALL)
- [x] Times are read in the event time zone
- [x] Per row error reporting, including unreadable times and end-before-start
- [x] Missing required columns are named
- [~] Additive and wipe-and-replace modes write to Firestore

### US-046 Session CSV export
- [x] Exports the same shape, and round-trips through the importer

---

## EP6: Attendee experience

### US-050 Whole-event schedule in the event time zone
- [x] All times render in the owner's event time zone, never the device's
- [x] Conversion is correct across DST boundaries in both hemispheres
- [x] The time zone is stated on screen
- [~] The schedule runs from event start to event end

### US-051 Session cards
- [x] Cards show title, start and finish times and location
- [x] Times are shown in the event zone
- [~] Description appears on cards tall enough to fit it

### US-052 Concurrent sessions side by side
- [x] Overlapping sessions get separate columns
- [x] Every session in an overlap cluster reports the same column count, so widths line up
- [x] A column is reused once its previous session has finished
- [x] Back-to-back sessions are not treated as overlapping

### US-053 Current time line
- [x] Before the event: reads "The event starts in {n} min"
- [x] During the event: shows the current time
- [x] After the event: reads "The event has finished"
- [x] The line renders above the session cards (z-index in `styles.css`)
- [~] During the event the view snaps so the line sits one quarter from the top
- [~] Snapping stops the moment the user scrolls, and a "Now" button re-enables it

### US-054 Empty time text
- [x] Stretches with no session show "Nothing scheduled for you"
- [x] No such note appears when sessions cover the event

### US-055 Session detail
- [~] Tapping a session opens its content
- [~] Greyed content renders dimmed and non-interactive, hidden content does not render

### US-056 Live updates
- [~] A team member's edit appears on attendee devices with no refresh

### US-057 Polling fallback
- [~] Realtime listeners are the primary transport
- [~] A 20 second timer forces a server read as fallback
- [~] Refresh on tab focus and on network reconnect
- [~] A connection indicator shows live, polling or offline

---

## EP7: Team member views

### US-060 Live attendee view mode
- [~] A team member can toggle into the plain attendee experience, live

### US-061 Impersonate attendee mode
- [~] Pick any attendee and see their schedule, content and requests
- [x] Impersonation is read only: acknowledging a request is disabled
- [~] A persistent banner shows who is being impersonated and how to exit

---

## EP8: Attendance requests

### US-070 Create an attendance request
- [~] An event team member or group leader can select one or many people
- [~] Set location, time and free-text extra info
- [~] Sender view groups the per-recipient documents back into one row with acknowledgements

### US-071 Future send time
- [x] A request with a future send time is hidden from the recipient
- [x] It appears once the send time passes
- [~] The compose form warns that the hiding is client-side (see caveats)

### US-072 Recipient pop-up
- [x] The pop-up shows location, time, extra info and who sent it
- [x] It does not appear for someone else's request, or one already acknowledged
- [~] It appears without a refresh when the request arrives
- [~] The sender can see who has acknowledged

### US-073 Sender scoping
- [x] A group leader can only address people in groups they lead
- [x] An event team member can address anyone
- [~] Enforced per recipient in security rules (unverified, see US-003)

---

## Known caveats (accepted for POC)

1. **Security rules are unverified.** They are written and reviewed but there is no emulator test
   suite exercising them. This is the biggest gap. See US-003.
2. **Future-dated requests are hidden client-side.** Without a Cloud Function the request document
   exists from creation. Rules limit reads to the recipient and the sender, so the worst case is a
   recipient reading their own not-yet-due request via the console.
3. **Session content is filtered client-side.** Rules allow signed-in event users to read session
   documents; hidden state is applied in the UI. Enforcing per-group reads in rules would cost a
   document read per session per query.
4. **Firebase web config is public.** Normal for Firebase web apps. All enforcement lives in the
   rules files.
5. **Attendee emails are readable by team members and group leaders.** They need the roster to
   manage groups and address requests. Plain attendees cannot list it.
