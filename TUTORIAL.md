# Tutorial: Building a Custom REST Backend Provider for Codesphere

This tutorial walks you through creating a **REST backend managed service provider** for Codesphere — from scratch to a fully working local setup. We'll build a **Stalwart Mailbox** provider that provisions email accounts on a [Stalwart Mail Server](https://stalw.art/) instance.

By the end, you'll have:
- A Stalwart Mail Server running locally in Docker
- A REST backend that creates/updates/deletes mailbox accounts via Stalwart's admin API
- A `provider.yml` registered with your local Codesphere dev instance

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Step 1 — Start Stalwart Mail Server](#3-step-1--start-stalwart-mail-server)
4. [Step 2 — Write the provider.yml](#4-step-2--write-the-provideryml)
5. [Step 3 — Implement the REST Backend](#5-step-3--implement-the-rest-backend)
6. [Step 4 — Test Locally](#6-step-4--test-locally)
7. [Step 5 — Register with Codesphere](#7-step-5--register-with-codesphere)
8. [Gotchas & Lessons Learned](#8-gotchas--lessons-learned)
9. [Production Deployment](#9-production-deployment)

---

## 1. Architecture Overview

```
┌─────────────────────┐         ┌─────────────────────┐         ┌─────────────────────┐
│   Codesphere UI     │         │   REST Backend       │         │   Stalwart Mail      │
│   (marketplace)     │────────▶│   (Node.js/Express)  │────────▶│   Server (Docker)    │
│                     │  HTTP   │   localhost:9090      │  HTTPS  │   localhost:1443     │
│  POST / GET /       │         │                      │         │                      │
│  PATCH / DELETE     │         │  Adapter layer:      │         │  /api/principal      │
│                     │◀────────│  translates CS API   │◀────────│  create/update/      │
│  Shows details:     │  JSON   │  → Stalwart API      │  JSON   │  delete users        │
│  email, IMAP, SMTP  │         │                      │         │                      │
└─────────────────────┘         └─────────────────────┘         └─────────────────────┘
```

**How it works:**
1. A user requests a new Stalwart Mailbox in the Codesphere UI
2. Codesphere calls `POST /` on your REST backend with config + secrets
3. Your backend calls Stalwart's admin API to create the user
4. Codesphere polls `GET /?id=...` to get connection details (IMAP, SMTP, etc.)
5. The user sees their email credentials in the Codesphere dashboard

---

## 2. Prerequisites

- **Docker** (or Colima on macOS) for running Stalwart
- **Node.js 20+** for the REST backend
- A **Codesphere dev instance** (for registration/testing)
- `yq` — `brew install yq` (used by the validate script)

---

## 3. Step 1 — Start Stalwart Mail Server

Create a `docker-compose.local.yml`:

```yaml
services:
  stalwart:
    image: stalwartlabs/mail-server:v0.11
    container_name: stalwart-mail
    restart: unless-stopped
    ports:
      - "1443:443"     # HTTPS (admin UI + JMAP + webmail)
      - "1025:25"      # SMTP
      - "1587:587"     # SMTP submission
      - "1993:993"     # IMAPS
    volumes:
      - stalwart-data:/opt/stalwart-mail
    environment:
      - STALWART_ADMIN_PASSWORD=localdev123

volumes:
  stalwart-data:
```

Start it:

```bash
docker compose -f docker-compose.local.yml up -d
```

> **Note:** Don't use the `latest` tag — `stalwartlabs/mail-server:latest` doesn't exist. Pin a version like `v0.11`.

Verify it's running:

```bash
# Check admin API responds
curl -sk "https://localhost:1443/api/principal" \
  -H "Authorization: Basic $(echo -n admin:localdev123 | base64)"
# → {"data":{"items":[],"total":0}}
```

The admin UI is at `https://localhost:1443` (login: `admin` / `localdev123`).

---

## 4. Step 2 — Write the provider.yml

Create `provider.yml` at the **repo root** (Codesphere fetches it from root, not a subdirectory):

```yaml
name: stalwart-mailbox
version: v1
author: Codesphere
displayName: Stalwart Mailbox
iconUrl: https://stalw.art/img/logo.svg
category: messaging
description: |
  Provision individual email accounts on a shared Stalwart Mail Server instance.
  Each service creates a new mailbox user with IMAP, SMTP, and JMAP access.
  Backed by a REST API that communicates with the Stalwart admin API.

backend:
  rest:
    url: http://localhost:9090
    authTokenEnv: BACKEND_AUTH_TOKEN

plans:
  - id: 0
    name: starter
    displayName: Starter
    description: Basic mailbox with 500 MB storage
    parameters: {}
  - id: 1
    name: standard
    displayName: Standard
    description: Standard mailbox with 2 GB storage
    parameters: {}
  - id: 2
    name: premium
    displayName: Premium
    description: Premium mailbox with 10 GB storage
    parameters: {}

configSchema:
  type: object
  properties:
    EMAIL_PREFIX:
      type: string
      description: Local part of the email address (the part before @)
      x-update-constraint: immutable
    DISPLAY_NAME:
      type: string
      description: Display name shown in email clients
    QUOTA_MB:
      type: integer
      description: Mailbox storage quota in megabytes

secretsSchema:
  type: object
  properties:
    MAIL_PASSWORD:
      type: string
      format: password

detailsSchema:
  type: object
  properties:
    email:
      type: string
    username:
      type: string
    imap_host:
      type: string
    imap_port:
      type: integer
    smtp_host:
      type: string
    smtp_port:
      type: integer
    jmap_url:
      type: string
    webmail_url:
      type: string
    ready:
      type: boolean
```

### Key rules for provider.yml

| Field | Rule |
|-------|------|
| `name` | Lowercase, hyphens/underscores only. Pattern: `^[-a-z0-9_]+$` |
| `version` | Must be `v1`, `v2`, etc. — NOT semver |
| `plans[].id` | Must be a non-negative **integer** (0, 1, 2...), not a string |
| `plans[].name` | Required string identifier |
| `plans[].parameters` | Required object (can be empty `{}`) |
| `secretsSchema` | Use `format: password`. Never set default values |
| `backend` | Exactly one of `backend.landscape` or `backend.rest` |

---

## 5. Step 3 — Implement the REST Backend

Your backend must implement 4 endpoints — the **Codesphere Managed Service Adapter API**:

| Method | Path | Purpose |
|--------|------|---------|
| `POST /` | Create a new service |
| `GET /?id=...` | Get status (polled periodically) |
| `PATCH /:id` | Update config/secrets |
| `DELETE /:id` | Delete the service |

### Project setup

```bash
mkdir -p src/rest-backend && cd src/rest-backend
npm init -y
npm install express
```

### server.js — The complete implementation

The backend translates between Codesphere's adapter API and Stalwart's admin API. Here are the critical parts:

#### Stalwart API quirks you need to know

**1. Error responses use HTTP 200**

Stalwart returns `HTTP 200` for errors, with the error in the JSON body:
```json
{"error": "notFound", "item": "alice"}
```

You CANNOT just check `response.ok` — you must parse the body:

```js
async function parseStalwartResponse(response) {
  if (!response.ok) {
    const text = await response.text();
    return { ok: false, error: `HTTP ${response.status}: ${text}` };
  }
  const json = await response.json();
  if (json.error) {
    return { ok: false, error: `${json.error}: ${json.details || json.item || ''}` };
  }
  return { ok: true, data: json.data };
}
```

**2. Domains must exist before creating users**

Creating a user with email `alice@example.com` requires the domain `example.com` to already exist as a Stalwart principal. Otherwise you get `{"error": "notFound", "item": "example.com"}` (with HTTP 200!).

Solution — auto-create the domain on first request:

```js
let domainEnsured = false;
async function ensureDomain() {
  if (domainEnsured) return;
  const resp = await stalwartRequest('POST', '/api/principal', {
    type: 'domain',
    name: STALWART_MAIL_DOMAIN,
    description: `Mail domain ${STALWART_MAIL_DOMAIN}`,
  });
  const result = await parseStalwartResponse(resp);
  if (result.ok || result.error.startsWith('alreadyExists')) {
    domainEnsured = true;
  }
}
```

**3. PATCH uses an action-array format**

Stalwart's update endpoint does NOT accept a flat object. It expects an array of action objects:

```json
[
  {"action": "set", "field": "description", "value": "Alice M. Doe"},
  {"action": "set", "field": "quota", "value": 1048576000},
  {"action": "set", "field": "secrets", "value": ["newpassword"]}
]
```

Other actions include `addItem` and `removeItem` for array fields like `emails`.

**4. Use username (not numeric ID) for PATCH/DELETE paths**

`POST /api/principal` returns `{"data": 87}` (a numeric principal ID), but `PATCH` and `DELETE` expect the **username string** in the path:

```
PATCH /api/principal/alice     ✅ works
PATCH /api/principal/87        ❌ "notFound"
```

**5. Auth can be Basic or Bearer**

For local dev with username:password, use Basic auth. For API tokens, use Bearer. The backend auto-detects:

```js
headers: {
  'Authorization': STALWART_ADMIN_TOKEN.includes(':')
    ? `Basic ${Buffer.from(STALWART_ADMIN_TOKEN).toString('base64')}`
    : `Bearer ${STALWART_ADMIN_TOKEN}`,
}
```

**6. Create principal body**

Stalwart expects all array fields even if empty:

```js
{
  type: 'individual',
  name: username,
  secrets: [password],
  emails: [email],
  description: displayName,
  quota: quotaMB * 1024 * 1024,  // bytes
  roles: ['user'],
  lists: [],
  memberOf: [],
  members: [],
  enabledPermissions: [],
  disabledPermissions: [],
  urls: [],
  externalMembers: [],
}
```

### Full source

See `src/rest-backend/server.js` in this repository for the complete implementation.

---

## 6. Step 4 — Test Locally

### Start the backend

```bash
cd src/rest-backend && npm install

STALWART_API_URL=https://localhost:1443 \
STALWART_ADMIN_TOKEN=admin:localdev123 \
STALWART_MAIL_DOMAIN=localhost \
STALWART_IMAP_HOST=localhost \
STALWART_SMTP_HOST=localhost \
STALWART_IMAP_PORT=1993 \
STALWART_SMTP_PORT=1587 \
STALWART_JMAP_URL=https://localhost:1443/jmap \
STALWART_WEBMAIL_URL=https://localhost:1443/login \
NODE_TLS_REJECT_UNAUTHORIZED=0 \
PORT=9090 \
node server.js
```

### Run the CRUD tests

**Create:**
```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:9090/ \
  -H "Content-Type: application/json" \
  -d '{
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "config": { "EMAIL_PREFIX": "alice", "DISPLAY_NAME": "Alice Doe", "QUOTA_MB": 500 },
    "secrets": { "MAIL_PASSWORD": "supersecret123" }
  }'
# → HTTP 201
```

**Read:**
```bash
curl -s http://localhost:9090/?id=550e8400-e29b-41d4-a716-446655440000 | python3 -m json.tool
# → Shows email, IMAP/SMTP details, ready: true
```

**Verify in Stalwart directly:**
```bash
curl -sk "https://localhost:1443/api/principal?types=individual&limit=10" \
  -H "Authorization: Basic $(echo -n admin:localdev123 | base64)" | python3 -m json.tool
# → Shows alice with quota 524288000 (500 MB), role "user"
```

**Update:**
```bash
curl -s -w "\nHTTP %{http_code}\n" -X PATCH \
  http://localhost:9090/550e8400-e29b-41d4-a716-446655440000 \
  -H "Content-Type: application/json" \
  -d '{ "config": { "DISPLAY_NAME": "Alice M. Doe", "QUOTA_MB": 1000 } }'
# → HTTP 204
```

**Delete:**
```bash
curl -s -w "\nHTTP %{http_code}\n" -X DELETE \
  http://localhost:9090/550e8400-e29b-41d4-a716-446655440000
# → HTTP 204
```

---

## 7. Step 5 — Register with Codesphere

REST backend providers are registered through the **platform configuration**, not the git-based API endpoint.

### For Codesphere Private Cloud / Dev Instance

Add your provider to the `MANAGED_SERVICE_PROVIDERS` environment variable:

```json
{
  "name": "stalwart-mailbox",
  "version": "v1",
  "iconUrl": "https://stalw.art/img/logo.svg",
  "backend": {
    "api": {
      "endpoint": "http://localhost:9090"
    }
  }
}
```

Append it to the existing array in your Codesphere config, then restart the marketplace service.

> **Important:** The `POST /api/managed-services/providers` API endpoint only works for **landscape-based** providers (via `gitUrl`). REST backend providers must be registered through the platform config. The config additionally needs the schemas (`configSchema`, `secretsSchema`, `detailsSchema`) and `plans` — check your Codesphere admin docs for the exact config format.

### For landscape-based providers (alternative)

If you later want to use the git-based registration:

```bash
CODESPHERE_URL=http://localhost:8080 \
CODESPHERE_API_TOKEN=your-token \
CODESPHERE_TEAM_ID=your-team-id \
make register
```

This clones the repo and reads `provider.yml` from the **repo root** (not from `config/`).

---

## 8. Gotchas & Lessons Learned

These are real issues encountered during development — save yourself the debugging time:

### Stalwart API

| Gotcha | Detail |
|--------|--------|
| **HTTP 200 for errors** | Stalwart returns 200 with `{"error": "notFound"}`. Always parse the response body for an `error` field. |
| **Domain must exist first** | Creating `alice@example.com` fails if the `example.com` domain principal doesn't exist. Create it with `type: "domain"` first. |
| **PATCH is an action array** | Send `[{"action":"set","field":"...","value":"..."}]`, not a flat object. |
| **Use username, not ID** | `PATCH/DELETE /api/principal/{name}` — use the string username, not the numeric ID from create. |
| **No `latest` Docker tag** | `stalwartlabs/mail-server:latest` doesn't exist. Pin to `v0.11` or check Docker Hub. |

### provider.yml

| Gotcha | Detail |
|--------|--------|
| **Plan IDs are integers** | `id: 0`, not `id: "starter"`. The API rejects string IDs. |
| **Plans need `name`** | Each plan needs both `id` (integer) and `name` (string). |
| **Plans need `parameters`** | Even if empty, `parameters: {}` is required. |
| **File must be at repo root** | Codesphere fetches `provider.yml` from the repository root, not from `config/`. |

### Registration

| Gotcha | Detail |
|--------|--------|
| **REST ≠ gitUrl registration** | The `POST /providers` API only supports landscape backends. REST backends go in platform config. |
| **Global scope needs admin** | Creating global providers requires cluster admin permissions. Use team scope for testing. |
| **Repo must be accessible** | If using gitUrl, the repo must be public or Codesphere needs GitHub credentials. |

---

## 9. Production Deployment

For production, you'll need:

1. **A real domain** with DNS records (MX, SPF, DKIM, DMARC)
2. **TLS certificates** (Stalwart supports ACME/Let's Encrypt)
3. **The REST backend behind HTTPS** (use a reverse proxy like Caddy or nginx)
4. **Persistent storage** for the backend state (replace the in-memory `Map` with a database)
5. **Auth tokens** set on both the backend (`AUTH_TOKEN`) and in Codesphere (`BACKEND_AUTH_TOKEN`)

See `STALWART_SETUP.md` in this repository for the full production Docker setup guide.

### What end users receive

When a user provisions a Stalwart Mailbox through Codesphere, they get:

| Field | Example |
|-------|---------|
| **Email** | `alice@example.com` |
| **Username** | `alice` |
| **IMAP Host** | `mail.example.com:993` (TLS) |
| **SMTP Host** | `mail.example.com:587` (STARTTLS) |
| **JMAP URL** | `https://mail.example.com/jmap` |
| **Webmail** | `https://mail.example.com/login` |

They can plug these into any email client (Thunderbird, Apple Mail, Outlook, etc.).

---

## Quick Reference — File Layout

```
├── provider.yml                    # Provider definition (repo root — required by Codesphere)
├── config/
│   └── provider.yml                # Provider definition (working copy)
├── src/
│   └── rest-backend/
│       ├── server.js               # REST backend implementation
│       ├── package.json
│       └── Dockerfile              # For containerized deployment
├── docker-compose.local.yml        # Local Stalwart instance
├── STALWART_SETUP.md               # Production deployment guide
├── Makefile                        # validate / register / test commands
└── scripts/
    ├── validate.sh
    └── register.sh
```
