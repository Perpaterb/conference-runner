#!/usr/bin/env bash
#
# Smoke suite. Point it at any environment before that environment takes real traffic.
#
#   ./scripts/smoke.sh --target https://perpaterb.github.io/conference-runner/
#
# Scope, stated honestly: this verifies the deployed bundle is reachable, correctly built and
# wired to a Firebase project. It cannot sign in with Google, so it does NOT prove the auth,
# role or realtime paths work end to end. See docs/UserStories.md for what is and is not
# covered by automated tests.

set -uo pipefail

TARGET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$TARGET" ]; then
  echo "Usage: $0 --target <url>" >&2
  exit 2
fi

TARGET="${TARGET%/}/"
PASS=0
FAIL=0

check() {
  local name="$1"; shift
  printf '  %-52s' "$name"
  if "$@" >/dev/null 2>&1; then
    printf 'ok\n'; PASS=$((PASS + 1))
  else
    printf 'FAILED\n'; FAIL=$((FAIL + 1))
  fi
}

BODY="$(curl -fsSL --max-time 20 "$TARGET" 2>/dev/null)"
if [ -z "$BODY" ]; then
  echo "Could not fetch $TARGET"
  exit 1
fi

echo "Smoke testing $TARGET"
echo

check "index.html is served" test -n "$BODY"
check "page is the Conference Runner app" grep -qi "conference runner" <<<"$BODY"
check "module bundle is referenced" grep -q 'type="module"' <<<"$BODY"

ASSET_PATH="$(grep -o 'src="[^"]*assets/[^"]*\.js"' <<<"$BODY" | head -1 | sed 's/src="//; s/"//')"
if [ -n "$ASSET_PATH" ]; then
  case "$ASSET_PATH" in
    http*) ASSET_URL="$ASSET_PATH" ;;
    /*)    ASSET_URL="$(sed -E 's#(https?://[^/]+).*#\1#' <<<"$TARGET")$ASSET_PATH" ;;
    *)     ASSET_URL="$TARGET$ASSET_PATH" ;;
  esac
  check "JS bundle downloads" curl -fsSL --max-time 30 "$ASSET_URL"

  BUNDLE="$(curl -fsSL --max-time 30 "$ASSET_URL" 2>/dev/null)"
  # The build inlines the Firebase config. If it is absent, the deploy is missing its secrets
  # and every user would land on the setup screen.
  check "Firebase config was baked into the build" grep -q "firebaseapp.com" <<<"$BUNDLE"
  check "app talks to Firestore" grep -qi "firestore" <<<"$BUNDLE"
else
  echo "  could not locate the JS bundle in index.html"
  FAIL=$((FAIL + 1))
fi

check "deep link path serves the app (hash routing)" \
  bash -c "curl -fsSL --max-time 20 '${TARGET}#/e/abcdefghij' | grep -qi 'conference runner'"

echo
echo "passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
