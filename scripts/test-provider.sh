#!/usr/bin/env bash
set -euo pipefail

PROVIDER_CONFIG="provider.yml"
CI_CONFIG="ci.stalwart-provider.yml"

echo "=== Testing Provider ==="
echo ""

# ── Check required env vars ────────────────────────────────────────
if [[ -z "${CODESPHERE_API_TOKEN:-}" ]]; then
  echo "ERROR: CODESPHERE_API_TOKEN is not set."
  exit 1
fi

if [[ -z "${CODESPHERE_TEAM_ID:-}" ]]; then
  echo "ERROR: CODESPHERE_TEAM_ID is not set."
  exit 1
fi

if ! command -v yq &>/dev/null; then
  echo "ERROR: yq is required. Install: brew install yq"
  exit 1
fi

# ── Extract metadata ──────────────────────────────────────────────
PROVIDER_NAME=$(yq eval '.provider.name' "$PROVIDER_CONFIG")
PLAN=$(yq eval '.provider.resources.plan' "$PROVIDER_CONFIG")
FIRST_PORT=$(yq eval '.provider.service.ports[0].port' "$PROVIDER_CONFIG")

echo "Provider: $PROVIDER_NAME"
echo "Plan:     $PLAN"
echo "Port:     $FIRST_PORT"
echo ""

echo "--- Test Summary ---"
echo ""
echo "To fully test this provider, deploy it on Codesphere:"
echo ""
echo "  1. Register:  make register"
echo "  2. Create a workspace using this provider in the Codesphere UI"
echo "  3. Verify the service starts and health checks pass"
echo ""
echo "Automated testing via CI will be available after registration."
echo "The test stage defined in ci.yml runs during the deployment pipeline."
