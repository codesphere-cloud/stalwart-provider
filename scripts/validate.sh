#!/usr/bin/env bash
set -euo pipefail

PROVIDER_CONFIG="provider.yml"
CI_CONFIG="ci.stalwart-provider.yml"
ERRORS=0
BACKEND_TYPE=""

echo "=== Validating Provider Configuration ==="
echo ""

# ── Check files exist ──────────────────────────────────────────────
if [[ ! -f "$PROVIDER_CONFIG" ]]; then
  echo "ERROR: $PROVIDER_CONFIG not found."
  echo "  Hint: Copy config/provider.yml.example (landscape) or config/provider.rest.yml.example (REST) to config/provider.yml"
  exit 1
fi

# ── Detect backend type ────────────────────────────────────────────
if command -v yq &>/dev/null; then
  HAS_LANDSCAPE=$(yq eval '.backend.landscape.gitUrl // "absent"' "$PROVIDER_CONFIG" 2>/dev/null)
  HAS_REST=$(yq eval '.backend.rest.url // "absent"' "$PROVIDER_CONFIG" 2>/dev/null)

  if [[ "$HAS_LANDSCAPE" != "absent" && "$HAS_REST" != "absent" ]]; then
    echo "ERROR: Cannot specify both backend.landscape and backend.rest — pick one"
    exit 1
  elif [[ "$HAS_LANDSCAPE" != "absent" ]]; then
    BACKEND_TYPE="landscape"
  elif [[ "$HAS_REST" != "absent" ]]; then
    BACKEND_TYPE="rest"
  else
    echo "ERROR: backend section must specify either 'landscape' or 'rest'"
    exit 1
  fi
  echo "Backend type: $BACKEND_TYPE"
else
  # Without yq, assume landscape (original behavior)
  BACKEND_TYPE="landscape"
fi

# ci.yml is only required for landscape backends
if [[ "$BACKEND_TYPE" == "landscape" && ! -f "$CI_CONFIG" ]]; then
  echo "ERROR: $CI_CONFIG not found (required for landscape backends)."
  echo "  Hint: Copy config/ci.yml.example to config/ci.yml"
  exit 1
fi

# ── Check YAML syntax ─────────────────────────────────────────────
check_yaml_syntax() {
  local file="$1"
  if command -v yq &>/dev/null; then
    if ! yq eval '.' "$file" >/dev/null 2>&1; then
      echo "ERROR: Invalid YAML syntax in $file"
      ERRORS=$((ERRORS + 1))
      return 1
    fi
  elif command -v python3 &>/dev/null && python3 -c "import yaml" 2>/dev/null; then
    if ! python3 -c "import yaml; yaml.safe_load(open('$file'))" 2>/dev/null; then
      echo "ERROR: Invalid YAML syntax in $file"
      ERRORS=$((ERRORS + 1))
      return 1
    fi
  else
    echo "WARNING: No YAML validator found (install yq or python3 with PyYAML)"
  fi
  return 0
}

echo "Checking YAML syntax..."
check_yaml_syntax "$PROVIDER_CONFIG"
if [[ "$BACKEND_TYPE" == "landscape" ]]; then
  check_yaml_syntax "$CI_CONFIG"
fi

# ── Validate provider.yml fields ───────────────────────────────────
if command -v yq &>/dev/null; then
  echo ""
  echo "Checking provider.yml..."

  # name — must match ^[-a-z0-9_]+$
  NAME=$(yq eval '.name' "$PROVIDER_CONFIG" 2>/dev/null)
  if [[ -z "$NAME" || "$NAME" == "null" ]]; then
    echo "ERROR: name is required"
    ERRORS=$((ERRORS + 1))
  elif [[ ! "$NAME" =~ ^[-a-z0-9_]+$ ]]; then
    echo "ERROR: name must match ^[-a-z0-9_]+$ (lowercase, hyphens, underscores)"
    echo "  Got: $NAME"
    ERRORS=$((ERRORS + 1))
  else
    echo "  ✓ name: $NAME"
  fi

  # version — must match ^v[0-9]+$
  VERSION=$(yq eval '.version' "$PROVIDER_CONFIG" 2>/dev/null)
  if [[ -z "$VERSION" || "$VERSION" == "null" ]]; then
    echo "ERROR: version is required"
    ERRORS=$((ERRORS + 1))
  elif [[ ! "$VERSION" =~ ^v[0-9]+$ ]]; then
    echo "ERROR: version must be v1, v2, etc. (format: v[0-9]+) — NOT semver"
    echo "  Got: $VERSION"
    ERRORS=$((ERRORS + 1))
  else
    echo "  ✓ version: $VERSION"
  fi

  # displayName
  DISPLAY_NAME=$(yq eval '.displayName' "$PROVIDER_CONFIG" 2>/dev/null)
  if [[ -z "$DISPLAY_NAME" || "$DISPLAY_NAME" == "null" ]]; then
    echo "ERROR: displayName is required"
    ERRORS=$((ERRORS + 1))
  else
    echo "  ✓ displayName: $DISPLAY_NAME"
  fi

  # author
  AUTHOR=$(yq eval '.author' "$PROVIDER_CONFIG" 2>/dev/null)
  if [[ -z "$AUTHOR" || "$AUTHOR" == "null" ]]; then
    echo "ERROR: author is required"
    ERRORS=$((ERRORS + 1))
  else
    echo "  ✓ author: $AUTHOR"
  fi

  # category
  CATEGORY=$(yq eval '.category' "$PROVIDER_CONFIG" 2>/dev/null)
  if [[ -z "$CATEGORY" || "$CATEGORY" == "null" ]]; then
    echo "ERROR: category is required"
    ERRORS=$((ERRORS + 1))
  else
    echo "  ✓ category: $CATEGORY"
  fi

  # description
  DESCRIPTION=$(yq eval '.description' "$PROVIDER_CONFIG" 2>/dev/null)
  if [[ -z "$DESCRIPTION" || "$DESCRIPTION" == "null" ]]; then
    echo "ERROR: description is required"
    ERRORS=$((ERRORS + 1))
  else
    echo "  ✓ description: present"
  fi

  # backend — validate based on type
  if [[ "$BACKEND_TYPE" == "landscape" ]]; then
    # backend.landscape.gitUrl
    GIT_URL=$(yq eval '.backend.landscape.gitUrl' "$PROVIDER_CONFIG" 2>/dev/null)
    if [[ -z "$GIT_URL" || "$GIT_URL" == "null" ]]; then
      echo "ERROR: backend.landscape.gitUrl is required"
      ERRORS=$((ERRORS + 1))
    else
      echo "  ✓ backend.landscape.gitUrl: $GIT_URL"
    fi

    # backend.landscape.ciProfile
    CI_PROFILE=$(yq eval '.backend.landscape.ciProfile' "$PROVIDER_CONFIG" 2>/dev/null)
    if [[ -z "$CI_PROFILE" || "$CI_PROFILE" == "null" ]]; then
      echo "ERROR: backend.landscape.ciProfile is required"
      ERRORS=$((ERRORS + 1))
    else
      echo "  ✓ backend.landscape.ciProfile: $CI_PROFILE"
    fi
  elif [[ "$BACKEND_TYPE" == "rest" ]]; then
    # backend.rest.url
    REST_URL=$(yq eval '.backend.rest.url' "$PROVIDER_CONFIG" 2>/dev/null)
    if [[ -z "$REST_URL" || "$REST_URL" == "null" ]]; then
      echo "ERROR: backend.rest.url is required"
      ERRORS=$((ERRORS + 1))
    elif [[ ! "$REST_URL" =~ ^https?:// ]]; then
      echo "ERROR: backend.rest.url must be a valid HTTP(S) URL"
      echo "  Got: $REST_URL"
      ERRORS=$((ERRORS + 1))
    else
      echo "  ✓ backend.rest.url: $REST_URL"
    fi

    # backend.rest.authTokenEnv (optional)
    AUTH_TOKEN_ENV=$(yq eval '.backend.rest.authTokenEnv // "absent"' "$PROVIDER_CONFIG" 2>/dev/null)
    if [[ "$AUTH_TOKEN_ENV" != "absent" ]]; then
      if [[ ! "$AUTH_TOKEN_ENV" =~ ^[A-Z_][A-Z0-9_]*$ ]]; then
        echo "ERROR: backend.rest.authTokenEnv must be a valid env var name (UPPER_SNAKE_CASE)"
        echo "  Got: $AUTH_TOKEN_ENV"
        ERRORS=$((ERRORS + 1))
      else
        echo "  ✓ backend.rest.authTokenEnv: $AUTH_TOKEN_ENV"
      fi
    fi
  fi

  # configSchema — if present, must have type: object
  CONFIG_SCHEMA_TYPE=$(yq eval '.configSchema.type // "absent"' "$PROVIDER_CONFIG" 2>/dev/null)
  if [[ "$CONFIG_SCHEMA_TYPE" != "absent" && "$CONFIG_SCHEMA_TYPE" != "object" ]]; then
    echo "ERROR: configSchema.type must be 'object'"
    ERRORS=$((ERRORS + 1))
  elif [[ "$CONFIG_SCHEMA_TYPE" == "object" ]]; then
    echo "  ✓ configSchema: present (type: object)"
  fi

  # secretsSchema — if present, must have type: object
  SECRETS_SCHEMA_TYPE=$(yq eval '.secretsSchema.type // "absent"' "$PROVIDER_CONFIG" 2>/dev/null)
  if [[ "$SECRETS_SCHEMA_TYPE" != "absent" && "$SECRETS_SCHEMA_TYPE" != "object" ]]; then
    echo "ERROR: secretsSchema.type must be 'object'"
    ERRORS=$((ERRORS + 1))
  elif [[ "$SECRETS_SCHEMA_TYPE" == "object" ]]; then
    echo "  ✓ secretsSchema: present (type: object)"
  fi

  # detailsSchema — if present, must have type: object
  DETAILS_SCHEMA_TYPE=$(yq eval '.detailsSchema.type // "absent"' "$PROVIDER_CONFIG" 2>/dev/null)
  if [[ "$DETAILS_SCHEMA_TYPE" != "absent" && "$DETAILS_SCHEMA_TYPE" != "object" ]]; then
    echo "ERROR: detailsSchema.type must be 'object'"
    ERRORS=$((ERRORS + 1))
  elif [[ "$DETAILS_SCHEMA_TYPE" == "object" ]]; then
    echo "  ✓ detailsSchema: present (type: object)"
  fi

  # planSchema — if present, must have type: object (only for REST backends)
  PLAN_SCHEMA_TYPE=$(yq eval '.planSchema.type // "absent"' "$PROVIDER_CONFIG" 2>/dev/null)
  if [[ "$PLAN_SCHEMA_TYPE" != "absent" ]]; then
    if [[ "$BACKEND_TYPE" != "rest" ]]; then
      echo "WARNING: planSchema is only relevant for REST backend providers"
    fi
    if [[ "$PLAN_SCHEMA_TYPE" != "object" ]]; then
      echo "ERROR: planSchema.type must be 'object'"
      ERRORS=$((ERRORS + 1))
    else
      echo "  ✓ planSchema: present (type: object)"
    fi
  fi

  # ── Validate ci.yml (landscape backends only) ───────────────────
  if [[ "$BACKEND_TYPE" == "landscape" ]]; then
    echo ""
    echo "Checking ci.yml..."

    # schemaVersion — must be v0.2
    SCHEMA_VERSION=$(yq eval '.schemaVersion // "absent"' "$CI_CONFIG" 2>/dev/null)
    if [[ "$SCHEMA_VERSION" == "absent" || "$SCHEMA_VERSION" == "null" ]]; then
      echo "ERROR: schemaVersion is required (must be v0.2)"
      ERRORS=$((ERRORS + 1))
    elif [[ "$SCHEMA_VERSION" != "v0.2" ]]; then
      echo "ERROR: schemaVersion must be 'v0.2'"
      echo "  Got: $SCHEMA_VERSION"
      ERRORS=$((ERRORS + 1))
    else
      echo "  ✓ schemaVersion: $SCHEMA_VERSION"
    fi

    # run section — must exist with at least one service
    RUN_KEYS=$(yq eval '.run | keys | length' "$CI_CONFIG" 2>/dev/null || echo "0")
    if [[ "$RUN_KEYS" -eq 0 || "$RUN_KEYS" == "null" ]]; then
      echo "ERROR: ci.yml must have a 'run' section with at least one service"
      ERRORS=$((ERRORS + 1))
    else
      echo "  ✓ run: $RUN_KEYS service(s) defined"

      # Validate each service has steps or provider
      for SERVICE_NAME in $(yq eval '.run | keys | .[]' "$CI_CONFIG" 2>/dev/null); do
        HAS_STEPS=$(yq eval ".run[\"$SERVICE_NAME\"].steps | length" "$CI_CONFIG" 2>/dev/null || echo "0")
        HAS_PROVIDER=$(yq eval ".run[\"$SERVICE_NAME\"].provider.name // \"absent\"" "$CI_CONFIG" 2>/dev/null)

        if [[ "$HAS_STEPS" -eq 0 && "$HAS_PROVIDER" == "absent" ]]; then
          echo "  WARNING: service '$SERVICE_NAME' has neither steps nor provider"
        elif [[ "$HAS_PROVIDER" != "absent" ]]; then
          PROVIDER_VER=$(yq eval ".run[\"$SERVICE_NAME\"].provider.version // \"absent\"" "$CI_CONFIG" 2>/dev/null)
          if [[ "$PROVIDER_VER" == "absent" ]]; then
            echo "  ERROR: service '$SERVICE_NAME' provider is missing 'version'"
            ERRORS=$((ERRORS + 1))
          else
            echo "  ✓ service '$SERVICE_NAME': managed service ($HAS_PROVIDER $PROVIDER_VER)"
          fi
        else
          echo "  ✓ service '$SERVICE_NAME': $HAS_STEPS step(s)"
        fi
      done
    fi
  else
    echo ""
    echo "Skipping ci.yml validation (not required for REST backend providers)"
  fi

else
  echo "WARNING: yq not installed — skipping field validation (only YAML syntax checked)"
  echo "  Install: brew install yq (macOS) or apt-get install yq (Linux)"
fi

# ── Summary ────────────────────────────────────────────────────────
echo ""
if [[ $ERRORS -gt 0 ]]; then
  echo "VALIDATION FAILED — $ERRORS error(s) found"
  exit 1
else
  echo "VALIDATION PASSED ✓"
fi
