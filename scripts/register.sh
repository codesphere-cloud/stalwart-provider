#!/usr/bin/env bash
set -euo pipefail

PROVIDER_CONFIG="config/provider.yml"

echo "=== Registering Provider with Codesphere ==="
echo ""

# ── Check required env vars ────────────────────────────────────────
if [[ -z "${CODESPHERE_API_TOKEN:-}" ]]; then
  echo "ERROR: CODESPHERE_API_TOKEN is not set."
  echo ""
  echo "  export CODESPHERE_API_TOKEN=your-token-here"
  echo ""
  exit 1
fi

# ── Determine API base URL ─────────────────────────────────────────
CODESPHERE_URL="${CODESPHERE_URL:-https://codesphere.com}"
API_ENDPOINT="${CODESPHERE_URL}/api/managed-services/providers"

# ── Extract provider metadata ──────────────────────────────────────
if ! command -v yq &>/dev/null; then
  echo "ERROR: yq is required for registration."
  echo "  Install: brew install yq (macOS) or apt-get install yq (Linux)"
  exit 1
fi

PROVIDER_NAME=$(yq eval '.name' "$PROVIDER_CONFIG")
PROVIDER_VERSION=$(yq eval '.version' "$PROVIDER_CONFIG")

# ── Detect backend type ────────────────────────────────────────────
HAS_LANDSCAPE=$(yq eval '.backend.landscape.gitUrl // "absent"' "$PROVIDER_CONFIG" 2>/dev/null)
HAS_REST=$(yq eval '.backend.rest.url // "absent"' "$PROVIDER_CONFIG" 2>/dev/null)

if [[ "$HAS_LANDSCAPE" != "absent" ]]; then
  BACKEND_TYPE="landscape"
  GIT_URL="$HAS_LANDSCAPE"
elif [[ "$HAS_REST" != "absent" ]]; then
  BACKEND_TYPE="rest"
  REST_URL="$HAS_REST"
else
  echo "ERROR: No backend configured. Specify backend.landscape or backend.rest in $PROVIDER_CONFIG"
  exit 1
fi

# ── Determine Git URL (required for all backend types) ─────────────
if [[ -z "${GIT_URL:-}" ]]; then
  GIT_URL=$(git remote get-url origin 2>/dev/null || true)
  if [[ -z "$GIT_URL" ]]; then
    echo "ERROR: Could not determine Git URL. Set a git remote or use a landscape backend."
    exit 1
  fi
fi

echo "Provider:  $PROVIDER_NAME $PROVIDER_VERSION"
echo "Backend:   $BACKEND_TYPE"
echo "Git URL:   $GIT_URL"
if [[ "$BACKEND_TYPE" == "rest" ]]; then
  echo "REST URL:  $REST_URL"
fi
echo "API:       $API_ENDPOINT"

# ── Determine scope ────────────────────────────────────────────────
if [[ -n "${CODESPHERE_TEAM_ID:-}" ]]; then
  SCOPE_JSON='{"type": "team", "teamIds": ['"$CODESPHERE_TEAM_ID"']}'
  echo "Scope:     team ($CODESPHERE_TEAM_ID)"
else
  SCOPE_JSON='{"type": "global"}'
  echo "Scope:     global"
fi
echo ""

# ── Register provider ──────────────────────────────────────────────
echo "Registering provider..."

# ── Register provider (always via gitUrl) ──────────────────────────
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$API_ENDPOINT" \
  -H "Authorization: Bearer $CODESPHERE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"gitUrl": "'"$GIT_URL"'", "scope": '"$SCOPE_JSON"'}')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

case "$HTTP_CODE" in
  200|201)
    echo "SUCCESS: Provider '$PROVIDER_NAME' $PROVIDER_VERSION registered."
    echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
    ;;
  401)
    echo "ERROR: Authentication failed (HTTP 401)"
    echo "  Check your CODESPHERE_API_TOKEN"
    exit 1
    ;;
  409)
    echo "ERROR: Provider already exists (HTTP 409)"
    echo "  Bump the version in $PROVIDER_CONFIG or use a different name"
    exit 1
    ;;
  *)
    echo "ERROR: Registration failed (HTTP $HTTP_CODE)"
    echo "$BODY"
    exit 1
    ;;
esac
