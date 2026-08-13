#!/usr/bin/env bash
#
# Proves the security rules suite would catch a regression.
#
# The rules tests passed first time, which is only reassuring if the tests can fail at all. This
# deliberately weakens firestore.rules one hole at a time and asserts the suite goes red. Each
# mutation corresponds to a real mistake somebody could make while editing the rules.
#
# Usage: ./scripts/verify-rules-tests-fail.sh

set -uo pipefail
cd "$(dirname "$0")/.."

RULES=firestore.rules

cleanup() {
  [ -f "$RULES.orig" ] && mv "$RULES.orig" "$RULES"
}
trap cleanup EXIT

FAILURES=0
CHECKS=0

check() {
  local name="$1" from="$2" to="$3"
  CHECKS=$((CHECKS + 1))
  printf '  %-56s' "$name"

  cp "$RULES" "$RULES.orig"
  if ! python3 - "$RULES" "$from" "$to" <<'PY'
import sys
path, frm, to = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()
if frm not in text:
    sys.stderr.write(f"MUTATION TARGET NOT FOUND: {frm!r}\n")
    sys.exit(2)
open(path, 'w').write(text.replace(frm, to, 1))
PY
  then
    printf 'SKIPPED (target not found)\n'
    FAILURES=$((FAILURES + 1))
    mv "$RULES.orig" "$RULES"
    return
  fi

  if npm run test:rules >/dev/null 2>&1; then
    printf 'NOT CAUGHT\n'
    FAILURES=$((FAILURES + 1))
  else
    printf 'caught (red)\n'
  fi
  mv "$RULES.orig" "$RULES"
}

echo "Verifying the security rules tests actually catch holes."
echo

check "attendee can self-promote to event team" \
  "&& request.resource.data.isTeamMember == false" \
  "&& request.resource.data.isTeamMember == request.resource.data.isTeamMember"

check "any signed-in user can list the whole roster" \
  "allow list: if isTeam(eventId) || isAnyLeader(eventId);" \
  "allow list: if signedIn();"

check "leader can edit groups they only belong to" \
  ".hasOnly(myMember(eventId).ledGroupIds);" \
  ".hasOnly(myMember(eventId).groups.keys());"

check "leader can address anyone, not just their group" \
  "isLeaderOf(eventId, request.resource.data.viaGroupId)" \
  "isAnyLeader(eventId)"

check "any signed-in user can list every event" \
  "allow list: if signedIn() && resource.data.ownerUid == request.auth.uid;" \
  "allow list: if signedIn();"

check "attendees can edit sessions" \
  "match /sessions/{sessionId} {
        // Readable by any signed-in attendee; which sessions apply to them is filtered client
        // side. See the caveat in docs/UserStories.md.
        allow read: if signedIn();
        allow write: if isTeam(eventId);" \
  "match /sessions/{sessionId} {
        allow read: if signedIn();
        allow write: if signedIn();"

check "recipient can rewrite the request, not just acknowledge" \
  "&& changed().hasOnly(['ackedAt']);" \
  "&& true;"

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "FAIL: $FAILURES of $CHECKS holes were NOT caught by the rules tests."
  exit 1
fi
echo "PASS: all $CHECKS holes were caught."
