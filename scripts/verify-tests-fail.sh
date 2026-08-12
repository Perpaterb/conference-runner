#!/usr/bin/env bash
#
# A check you have not seen fail is not a check.
#
# This deliberately breaks core logic one mutation at a time and asserts the suite goes red each
# time. If any mutation still passes, the suite has a blind spot and this script exits non-zero.
#
# Usage: ./scripts/verify-tests-fail.sh

set -uo pipefail
cd "$(dirname "$0")/.."

RESTORE=()
cleanup() {
  for f in "${RESTORE[@]:-}"; do
    [ -f "$f.orig" ] && mv "$f.orig" "$f"
  done
}
trap cleanup EXIT

mutate() {
  local file="$1" from="$2" to="$3"
  cp "$file" "$file.orig"
  RESTORE+=("$file")
  # Use python so the search text is treated literally, not as a regex.
  python3 - "$file" "$from" "$to" <<'PY'
import sys
path, frm, to = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()
if frm not in text:
    sys.stderr.write(f"MUTATION TARGET NOT FOUND in {path}: {frm!r}\n")
    sys.exit(2)
open(path, 'w').write(text.replace(frm, to, 1))
PY
}

restore() {
  local file="$1"
  [ -f "$file.orig" ] && mv "$file.orig" "$file"
}

FAILURES=0
CHECKS=0

check() {
  local name="$1" file="$2" from="$3" to="$4"
  CHECKS=$((CHECKS + 1))
  printf '  %-58s' "$name"

  if ! mutate "$file" "$from" "$to"; then
    printf 'SKIPPED (target not found)\n'
    FAILURES=$((FAILURES + 1))
    return
  fi

  if npx vitest run >/dev/null 2>&1; then
    printf 'NOT CAUGHT\n'
    FAILURES=$((FAILURES + 1))
  else
    printf 'caught (red)\n'
  fi
  restore "$file"
}

echo "Verifying the test suite actually catches broken logic."
echo

check "role precedence: team no longer outranks leader" \
  src/lib/roles.ts \
  "if (member.isTeamMember) return 'team'" \
  "if (false) return 'team'"

check "leader scoping: any group counts as led" \
  src/lib/roles.ts \
  ".filter(([, m]) => m.leader)" \
  ".filter(() => true)"

check "visibility: grey window ignored" \
  src/lib/roles.ts \
  "if (greyFrom !== undefined && now >= greyFrom) return 'grey'" \
  "if (false) return 'grey'"

check "future requests: sendAt filter dropped" \
  src/lib/roles.ts \
  "r.sendAt <= now" \
  "true"

check "timeline: concurrent sessions no longer get separate columns" \
  src/lib/layout.ts \
  "columnEnds.findIndex((end) => end <= session.startAt)" \
  "0"

check "time zone: event zone replaced with UTC" \
  src/lib/time.ts \
  "const guess = Date.UTC(year, month - 1, day, hour, minute)" \
  "const guess = Date.UTC(year, month - 1, day, hour, minute) + 3600000"

check "CSV: invalid emails accepted silently" \
  src/lib/csv.ts \
  "if (!EMAIL_RE.test(email)) {" \
  "if (false) {"

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "FAIL: $FAILURES of $CHECKS mutations were not caught by the tests."
  exit 1
fi
echo "PASS: all $CHECKS mutations were caught."
