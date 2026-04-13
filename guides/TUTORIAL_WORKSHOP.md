# Workshop: Building a Managed Service Provider on Codesphere

> **Partner Days — Workshop 5: Managed Services**
>
> Duration: ~2 hours · Difficulty: Intermediate · Language: JavaScript / Node.js

---

## What You'll Build

By the end of this workshop you will have a **fully working managed service provider** registered in the Codesphere marketplace. Any Codesphere user on your instance can then open the service catalog, click "Stalwart Mailbox", fill in a few fields, and receive a complete, ready-to-use email account — with IMAP, SMTP, JMAP, webmail access, and the DNS records they need to configure their domain.

Under the hood you will:

1. Deploy a central **Stalwart Mail Server** instance on Codesphere using the included `ci.stalwart.yml`.
2. Implement a **custom REST backend** (Node.js/TypeScript + Express) that wraps Stalwart's admin API and exposes it as a Codesphere Managed Service Adapter.
3. Write a **`provider.yml`** that describes your service in the Codesphere marketplace (a reference `provider.yml` is included in the repo).
4. **Deploy** your provider backend and link it to the pre-registered marketplace entry.
5. **Book** a service instance through the Codesphere UI, verify it works, and iterate.

```
                                        YOUR WORK TODAY
                                  ┌───────────────────────────┐
                                  │                           │
┌─────────────┐   reconcile loop  │  ┌─────────────────────┐  │          ┌──────────────────────┐
│  Codesphere │ ◄────────────────►│  │  REST Backend        │  │ ────────►│  Stalwart Mail       │
│  Platform   │    HTTP REST      │  │  (your code)         │  │  Admin   │  Server              │
│             │                   │  │  POST/GET/PATCH/DEL  │  │  API     │  (shared instance)   │
│  • UI       │                   │  └─────────────────────┘  │          │                      │
│  • Public   │                   │                           │          │  One server, many     │
│    API      │                   │  ┌─────────────────────┐  │          │  "logical tenants"    │
│  • Catalog  │                   │  │  provider.yml        │  │          │  (mail accounts)     │
│             │                   │  │  (your definition)   │  │          └──────────────────────┘
└─────────────┘                   │  └─────────────────────┘  │
                                  │                           │
                                  └───────────────────────────┘
```

---

## Table of Contents

- [Part 0 — Understand the Architecture](#part-0--understand-the-architecture)
- [Part 1 — Set Up Your Environment](#part-1--set-up-your-environment)
- [Part 2 — Explore the Stalwart Admin API](#part-2--explore-the-stalwart-admin-api)
- [Part 3 — Implement the REST Backend](#part-3--implement-the-rest-backend)
- [Part 4 — Deploy the Backend on Codesphere](#part-4--deploy-the-backend-on-codesphere)
- [Part 5 — Write the provider.yml](#part-5--write-the-provideryml)
- [Part 6 — Book & Test a Service Instance](#part-6--book--test-a-service-instance)
- [Part 7 — Debug & Improve](#part-7--debug--improve)
- [Part 8 — Wrap-Up: What Users Get](#part-8--wrap-up-what-users-get)
- [Appendix A — Stalwart API Quick Reference](#appendix-a--stalwart-api-quick-reference)
- [Appendix B — Environment Variables](#appendix-b--environment-variables)
- [Appendix C — Gotchas & Troubleshooting](#appendix-c--gotchas--troubleshooting)
- [Appendix D — JMAP Email Sending](#appendix-d--jmap-email-sending)

---

## Part 0 — Understand the Architecture

### Why a Custom REST Backend?

Codesphere's managed services support two backend types:

| Type | How it works | Best for |
|------|-------------|----------|
| **Landscape-based** | Codesphere deploys a full landscape (containers, services) per booked instance | One deployment = one instance (e.g., a Mattermost server per customer) |
| **REST-based** | Codesphere calls your REST API; you decide what happens | One shared service, many logical tenants (e.g., one mail server, many mailboxes) |

Stalwart Mail Server is a **single service** that hosts many mail accounts. We don't want to spin up a separate mail server for every user who books the service — that would be wasteful. Instead, we want to:

- Run **one** Stalwart instance centrally.
- When a user "books" the service, create a **new mail account** (a "logical tenant") on that shared server.
- When they delete the service, remove the account.
- Expose connection details (IMAP host, SMTP host, JMAP endpoint, DNS records) back to the user.

This is exactly the pattern a **custom REST backend** is designed for.

### The Reconciliation Loop

Codesphere does **not** make a single fire-and-forget API call. Instead, it runs a **reconciliation loop** that continuously ensures reality matches the desired state:

```
User clicks "Create"
        │
        ▼
Codesphere stores desired state (plan, config, secrets)
        │
        ▼
Reconciler calls ──► POST /  (your backend creates the account)
        │
        ▼
Reconciler polls  ──► GET /?id=<uuid>  every ~10 seconds
                      Your backend returns { details: { ready: true, ... } }
        │
        ▼
Codesphere shows connection details to the user
```

If the user changes config → `PATCH /{id}`. If they delete → `DELETE /{id}`. Your backend is the **adapter** between Codesphere's generic managed-service lifecycle and Stalwart's specific admin API.

### The Four Endpoints You Must Implement

| Method | Path | When Codesphere calls it | Your backend should |
|--------|------|--------------------------|---------------------|
| `POST /` | User creates a new service instance | Create a mail account on Stalwart |
| `GET /?id=<uuid>` | Reconciler polls for status (~every 10s) | Return plan, config, and connection details |
| `PATCH /:id` | User updates config or secrets | Update the mail account on Stalwart |
| `DELETE /:id` | User deletes the service | Delete the mail account on Stalwart |

---

## Part 1 — Set Up Your Environment

### Prerequisites

| What | Why |
|------|-----|
| A Codesphere account on the workshop instance | Deploy workspaces, book managed services |
| Node.js 18+ (or use the Codesphere workspace) | Run the REST backend |

### Step 1.1 — Get the Repository

Everything lives in a single repository — the REST backend, the `provider.yml`, and the CI pipelines.

Create a new Codesphere workspace from this repo (you can import it directly via the Codesphere UI):

```
https://github.com/codesphere-cloud/stalwart-provider
```

### Step 1.2 — Familiarize Yourself with the Structure

```
stalwart-provider/
├── server.js                       # ← Reference implementation (your starting point)
├── package.json
├── ci.stalwart.yml                 # CI pipeline for the Stalwart Mail Server deployment
├── ci.stalwart-provider.yml        # CI pipeline for the REST provider backend
├── provider.yml                    # Service definition for the Codesphere marketplace
├── docker-compose.local.yml        # Local Stalwart for development (optional)
└── guides/
    └── TUTORIAL_WORKSHOP.md        # This file
```

### Step 1.3 — Verify the Stalwart Instance

For this workshop, a central Stalwart Mail Server is already deployed and accessible. Verify you can reach it:

```bash
# Replace with the actual workshop Stalwart URL and credentials
export STALWART_API_URL="https://<stalwart-host>"
export STALWART_ADMIN_TOKEN="admin:<password>"

# Test the admin API
curl -s "$STALWART_API_URL/api/principal" \
  -u "$STALWART_ADMIN_TOKEN" | python3 -m json.tool

# Expected: {"data": {"items": [...], "total": ...}}
```

> **💡 Tip:** A `docker-compose.local.yml` is included if you ever want to run Stalwart locally outside of the workshop.

---

## Part 2 — Explore the Stalwart Admin API

Before writing the adapter, let's understand the API we're wrapping. Stalwart manages everything through **principals** — entities like domains, users, groups, and mailing lists.

### 2.1 — Create a Domain

Every email address needs a domain. Domains are principals of type `"domain"`:

```bash
curl -s -X POST "$STALWART_API_URL/api/principal" \
  -u "$STALWART_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "domain",
    "name": "workshop.example.com",
    "description": "Workshop demo domain"
  }' | python3 -m json.tool

# Success: {"data": <numeric-id>}
```

### 2.2 — Create a User (Individual Principal)

Now create a mail account on that domain:

```bash
curl -s -X POST "$STALWART_API_URL/api/principal" \
  -u "$STALWART_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "individual",
    "name": "alice",
    "secrets": ["supersecret123"],
    "emails": ["alice@workshop.example.com"],
    "description": "Alice (Workshop)",
    "quota": 524288000,
    "roles": ["user"],
    "lists": [],
    "memberOf": [],
    "members": [],
    "enabledPermissions": [],
    "disabledPermissions": [],
    "urls": [],
    "externalMembers": []
  }' | python3 -m json.tool

# Success: {"data": <numeric-id>}
```

> **⚠️ Key gotcha:** Stalwart returns HTTP 200 even for errors! An error looks like:
> ```json
> {"error": "notFound", "item": "workshop.example.com"}
> ```
> You must always parse the response body and check for an `error` field.

### 2.3 — Update a User (PATCH with Action Array)

Stalwart uses a unique action-array format for updates — **not** a flat JSON object:

```bash
curl -s -X PATCH "$STALWART_API_URL/api/principal/alice" \
  -u "$STALWART_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[
    {"action": "set", "field": "description", "value": "Alice M. Doe"},
    {"action": "set", "field": "quota", "value": 1073741824}
  ]' | python3 -m json.tool
```

> **⚠️ Key gotcha:** Use the **username string** (`alice`) in the path, not the numeric ID returned by create.

### 2.4 — Delete a User

```bash
curl -s -X DELETE "$STALWART_API_URL/api/principal/alice" \
  -u "$STALWART_ADMIN_TOKEN" | python3 -m json.tool
```

### 2.5 — Fetch DNS Records for a Domain

Stalwart auto-generates the DNS records (MX, SPF, DKIM, DMARC) your users need to configure:

```bash
curl -s "$STALWART_API_URL/api/dns/records/workshop.example.com" \
  -u "$STALWART_ADMIN_TOKEN" | python3 -m json.tool

# Returns: {"data": [{"type": "MX", "name": "...", "content": "..."}, ...]}
```

### 2.6 — Discover JMAP Session Details

JMAP (JSON Meta Application Protocol) is the modern email API. After creating a user, you can discover their JMAP session:

```bash
# Get the JMAP session (provides accountId)
curl -s "$STALWART_API_URL/jmap/session" \
  -u "alice:supersecret123" | python3 -m json.tool

# The accountId is at: .primaryAccounts["urn:ietf:params:jmap:mail"]
```

> **Clean up** before moving on:
> ```bash
> curl -s -X DELETE "$STALWART_API_URL/api/principal/alice" -u "$STALWART_ADMIN_TOKEN"
> curl -s -X DELETE "$STALWART_API_URL/api/principal/workshop.example.com" -u "$STALWART_ADMIN_TOKEN"
> ```

---

## Part 3 — Implement the REST Backend

This is the core of the workshop. You will build a Node.js/Express application that implements the Codesphere Managed Service Adapter API and translates each call into the appropriate Stalwart admin API operations.

### 3.1 — Project Setup

```bash
npm install
```

The `package.json` already includes `express`.

### 3.2 — Architecture of Your Backend

Your backend needs to handle this flow for each operation:

```
Codesphere POST /                    Your Backend                         Stalwart
─────────────────                    ────────────                         ────────
{id, config, secrets, plan}  ──►  1. Validate input
                                  2. Ensure domain exists  ──────────►  POST /api/principal {type:"domain"}
                                  3. Create user           ──────────►  POST /api/principal {type:"individual"}
                                  4. Fetch DNS records     ──────────►  GET  /api/dns/records/{domain}
                                  5. Fetch JMAP details    ──────────►  GET  /jmap/session + POST /jmap/
                                  6. Store mapping (id → username)
                             ◄──  7. Return 201 Created
```

### 3.3 — Key Implementation Details

Here is what you need to implement, broken into logical pieces. The reference implementation in `server.js` is a working example — study it, then build your own version (or extend it).

#### A. Stalwart API Helper

Stalwart's error handling is unusual — always check the response body:

```typescript
async function stalwartRequest(method: string, path: string, body?: any) {
  const url = `${STALWART_API_URL}${path}`;
  const token = STALWART_ADMIN_TOKEN;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Auto-detect Basic vs Bearer auth
    'Authorization': token.includes(':')
      ? `Basic ${Buffer.from(token).toString('base64')}`
      : `Bearer ${token}`,
  };
  const resp = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return resp;
}

async function parseStalwartResponse(resp: Response) {
  if (!resp.ok) {
    return { ok: false, error: `HTTP ${resp.status}: ${await resp.text()}` };
  }
  const json = await resp.json();
  if (json.error) {
    return { ok: false, error: `${json.error}: ${json.details || json.item || ''}` };
  }
  return { ok: true, data: json.data };
}
```

#### B. Domain Management (Idempotent)

Domains must exist before users. Cache which domains you've already created:

```typescript
const ensuredDomains = new Set<string>();

async function ensureDomain(domain: string) {
  if (ensuredDomains.has(domain)) return;

  const resp = await stalwartRequest('POST', '/api/principal', {
    type: 'domain',
    name: domain,
    description: `Mail domain ${domain}`,
  });
  const result = await parseStalwartResponse(resp);

  if (result.ok || result.error?.includes('alreadyExists')) {
    ensuredDomains.add(domain);
  } else {
    throw new Error(`Failed to ensure domain: ${result.error}`);
  }
}
```

#### C. POST / — Create Service

```typescript
app.post('/', async (req, res) => {
  const { id, config, secrets, plan } = req.body;

  // 1. Validate
  if (!id || !isValidUUID(id)) return res.status(400).json({ error: 'Invalid id' });
  if (!config?.EMAIL_PREFIX) return res.status(400).json({ error: 'Missing EMAIL_PREFIX' });
  if (!secrets?.MAIL_PASSWORD) return res.status(400).json({ error: 'Missing MAIL_PASSWORD' });

  const domain = config.MAIL_DOMAIN || DEFAULT_DOMAIN;
  const username = config.EMAIL_PREFIX.toLowerCase();
  const email = `${username}@${domain}`;

  // 2. Ensure domain exists
  await ensureDomain(domain);

  // 3. Create user on Stalwart
  const resp = await stalwartRequest('POST', '/api/principal', {
    type: 'individual',
    name: username,
    secrets: [secrets.MAIL_PASSWORD],
    emails: [email],
    description: config.DISPLAY_NAME || username,
    quota: (config.QUOTA_MB || 0) * 1024 * 1024,
    roles: ['user'],
    // All array fields required even if empty:
    lists: [], memberOf: [], members: [],
    enabledPermissions: [], disabledPermissions: [],
    urls: [], externalMembers: [],
  });

  const result = await parseStalwartResponse(resp);
  if (!result.ok && !result.error?.includes('alreadyExists')) {
    return res.status(502).json({ error: 'Stalwart create failed', detail: result.error });
  }

  // 4. Fetch connection details (DNS + JMAP in parallel)
  const details = await buildDetails(username, email, domain, secrets.MAIL_PASSWORD);

  // 5. Store the mapping
  services.set(id, { username, email, domain, plan, config, details });

  res.status(201).end();
});
```

#### D. GET / — Status Polling

This is called frequently by the reconciler. Return what Codesphere needs:

```typescript
app.get('/', (req, res) => {
  let ids = req.query.id;

  // No IDs? Return list of all known service IDs
  if (!ids) return res.json(Array.from(services.keys()));

  if (!Array.isArray(ids)) ids = [ids];

  const result: Record<string, any> = {};
  for (const id of ids) {
    const svc = services.get(id as string);
    if (svc) {
      result[id as string] = {
        plan: svc.plan,
        config: svc.config,
        details: svc.details,  // ← This is what the user sees in Codesphere
      };
    }
  }
  res.json(result);
});
```

#### E. PATCH /:id — Update Service

Remember: Stalwart expects an **action array**, not a flat object:

```typescript
app.patch('/:id', async (req, res) => {
  const svc = services.get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Not found' });

  const { config, secrets } = req.body;
  const actions: Array<{action: string, field: string, value: any}> = [];

  if (config?.DISPLAY_NAME) {
    actions.push({ action: 'set', field: 'description', value: config.DISPLAY_NAME });
  }
  if (config?.QUOTA_MB !== undefined) {
    actions.push({ action: 'set', field: 'quota', value: config.QUOTA_MB * 1024 * 1024 });
  }
  if (secrets?.MAIL_PASSWORD) {
    actions.push({ action: 'set', field: 'secrets', value: [secrets.MAIL_PASSWORD] });
  }

  if (actions.length > 0) {
    // Use USERNAME in path, not numeric ID!
    const resp = await stalwartRequest('PATCH', `/api/principal/${svc.username}`, actions);
    const result = await parseStalwartResponse(resp);
    if (!result.ok) return res.status(502).json({ error: result.error });
  }

  res.status(204).end();
});
```

#### F. DELETE /:id — Delete Service

```typescript
app.delete('/:id', async (req, res) => {
  const svc = services.get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Not found' });

  await stalwartRequest('DELETE', `/api/principal/${svc.username}`);
  services.delete(req.params.id);

  res.status(204).end();
});
```

#### G. Build Details — DNS + JMAP Discovery

This assembles all the information the user sees in Codesphere:

```typescript
async function buildDetails(username: string, email: string, domain: string, password: string) {
  const [dnsRecords, jmapDetails] = await Promise.all([
    fetchDnsRecords(domain),
    fetchJmapDetails(username, password),
  ]);

  return {
    email,
    username,
    mail_domain: domain,
    imap_host: STALWART_IMAP_HOST,
    imap_port: STALWART_IMAP_PORT,
    smtp_host: STALWART_SMTP_HOST,
    smtp_port: STALWART_SMTP_PORT,
    jmap_url: STALWART_JMAP_URL,
    jmap_account_id: jmapDetails.accountId || '',
    jmap_identity_id: jmapDetails.identityId || '',
    jmap_drafts_mailbox_id: jmapDetails.draftsMailboxId || '',
    webmail_url: STALWART_WEBMAIL_URL,
    dns_records: formatDnsRecords(dnsRecords),
    ready: true,
  };
}
```

### 3.4 — Test Your Backend

Once deployed on Codesphere (see Part 4), you can test the full CRUD lifecycle against your workspace URL. The examples below use `localhost:3000` — replace with your actual workspace URL when testing on Codesphere:

```bash
# CREATE
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/ \
  -H "Content-Type: application/json" \
  -d '{
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "plan": {"id": 0, "parameters": {}},
    "config": {
      "EMAIL_PREFIX": "alice",
      "MAIL_DOMAIN": "workshop.example.com",
      "DISPLAY_NAME": "Alice Workshop",
      "QUOTA_MB": 500
    },
    "secrets": {"MAIL_PASSWORD": "supersecret123"}
  }'
# Expected: HTTP 201

# READ (what Codesphere's reconciler does)
curl -s "http://localhost:3000/?id=550e8400-e29b-41d4-a716-446655440000" | python3 -m json.tool
# Expected: details with email, IMAP/SMTP hosts, JMAP IDs, DNS records, ready: true

# UPDATE
curl -s -w "\nHTTP %{http_code}\n" -X PATCH \
  "http://localhost:3000/550e8400-e29b-41d4-a716-446655440000" \
  -H "Content-Type: application/json" \
  -d '{"config": {"DISPLAY_NAME": "Alice M. Workshop", "QUOTA_MB": 1000}}'
# Expected: HTTP 204

# DELETE
curl -s -w "\nHTTP %{http_code}\n" -X DELETE \
  "http://localhost:3000/550e8400-e29b-41d4-a716-446655440000"
# Expected: HTTP 204
```

✅ **Checkpoint:** All four CRUD operations return the correct HTTP status codes and the GET response includes `ready: true` with all connection details populated.

---

## Part 4 — Deploy the Backend on Codesphere

Now let's get your REST backend running on Codesphere so it's reachable by the platform's reconciler.

### 4.1 — Create a Workspace

1. Log into the workshop Codesphere instance.
2. Create a new workspace from the `stalwart-provider` repository.
3. Choose the **"Always On"** plan (so the reconciler can reach it 24/7).

### 4.2 — CI Pipeline

The repo includes a pre-configured `ci.stalwart-provider.yml` that installs dependencies and starts the backend. It already has the correct Stalwart host configured and reads the admin token from the Codesphere vault. Review it — no changes should be needed for the workshop.

The key environment variables are set in the CI file:

| Variable | Value | Description |
|----------|-------|-------------|
| `STALWART_API_URL` | `https://stalwart.csa.codesphere-demo.com` | Workshop Stalwart instance |
| `STALWART_ADMIN_TOKEN` | `${{ vault['stalwart-admin-token'] }}` | Admin credentials (from vault) |
| `STALWART_IMAP_HOST` | `stalwart.csa.codesphere-demo.com` | Public IMAP hostname |
| `STALWART_SMTP_HOST` | `stalwart.csa.codesphere-demo.com` | Public SMTP hostname |
| `PORT` | `3000` | Backend listen port |

### 4.3 — Deploy and Verify

Deploy the workspace, then verify the backend is reachable:

```bash
# Use your workspace's public URL
curl -s "https://<your-workspace-url>/"
# Should return [] (empty list of service IDs)
```

✅ **Checkpoint:** Your REST backend is live on Codesphere and responds to requests.

---

## Part 5 — The provider.yml

The `provider.yml` is the definition file that tells Codesphere everything about your service: what it's called, what users can configure, what secrets they need to provide, and what details they'll get back.

A reference `provider.yml` is already included in the repository root. Review it and adjust if needed:

```yaml
name: stalwart-mailbox
version: v2
author: Codesphere
displayName: Stalwart Mailbox
iconUrl: https://stalw.art/img/logo.svg
category: messaging
description: |
  Provision individual email accounts on a shared Stalwart Mail Server.
  Each service creates a new mailbox user with IMAP, SMTP, and JMAP access.

backend:
  api:
    endpoint: https://ms-provider-stalwart.csa.codesphere-demo.com

plans:
  - id: 0
    name: starter
    description: Basic mailbox with 500 MB storage
    parameters: {}
  - id: 1
    name: standard
    description: Standard mailbox with 2 GB storage
    parameters: {}
  - id: 2
    name: premium
    description: Premium mailbox with 10 GB storage
    parameters: {}

configSchema:
  type: object
  properties:
    EMAIL_PREFIX:
      type: string
      description: Local part of the email address (the part before @)
      x-update-constraint: immutable
    MAIL_DOMAIN:
      type: string
      description: Email domain (e.g. example.com). Created automatically if needed.
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
    mail_domain:
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
    jmap_account_id:
      type: string
      description: JMAP account ID for programmatic email access
    jmap_identity_id:
      type: string
      description: JMAP identity ID for EmailSubmission
    jmap_drafts_mailbox_id:
      type: string
      description: JMAP Drafts mailbox ID
    webmail_url:
      type: string
    dns_records:
      type: string
      description: DNS records to configure for your domain (SPF, DKIM, DMARC, MX)
    ready:
      type: boolean
```

### 5.2 — Understand the Schemas

| Schema | Purpose | Where it appears in the UI |
|--------|---------|---------------------------|
| **configSchema** | Values the user provides when creating the service. Passed to your backend in `config`. | "Configuration" section of the create dialog and service settings |
| **secretsSchema** | Sensitive values (passwords, tokens). Passed in `secrets`. Never displayed again after creation. | "Secrets" step of the create dialog |
| **detailsSchema** | Read-only values your backend returns. Shown after the service is running. | "Details" / "Overview" tab in service settings |

### 5.3 — Validation Rules to Remember

| Rule | Correct | Incorrect |
|------|---------|-----------|
| `name` format | `stalwart-mailbox` | `Stalwart Mailbox` |
| `version` format | `v1`, `v2` | `1.0.0`, `latest` |
| `plans[].id` | `0` (integer) | `"starter"` (string) |
| `plans[].parameters` | `{}` (object, even if empty) | *(missing)* |
| Secrets | `format: password` | Default values |

✅ **Checkpoint:** Your `provider.yml` follows the validation rules above.

---

## Part 6 — Book & Test a Service Instance

> **Note:** The Stalwart Mailbox provider has already been **pre-registered** in the workshop platform instance. Custom REST-backend providers must be configured in the platform's global `config.yaml` — they cannot be registered via the Public API (which only supports landscape-based providers). For details on how providers are configured, see the [Codesphere Private Cloud Install Guide](https://docs.codesphere.com/docs/Private_Cloud/install-guide).
>
> The pre-registered provider points to `https://ms-provider-stalwart.csa.codesphere-demo.com`. Once you deploy your backend and link this custom domain to your workspace, the marketplace entry will route traffic to your implementation.

### 6.1 — Create a Service Instance via the UI

1. Go to **Managed Services** → Click **"Stalwart Mailbox"** → **"Start Setup"**
2. Fill in the configuration:
   - **EMAIL_PREFIX:** `yourname`
   - **MAIL_DOMAIN:** `workshop.example.com` (or your assigned domain)
   - **DISPLAY_NAME:** `Your Name`
   - **QUOTA_MB:** `500`
3. Set secrets:
   - **MAIL_PASSWORD:** Choose a strong password
4. Select the **Starter** plan.
5. Click **"Create Service"**.

### 6.2 — Watch the Reconciliation

Switch to the Managed Services table. You'll see your service go through these states:

```
Creating  →  Synchronized
```

The reconciler is calling your backend's `POST /` to create the account and then polling `GET /?id=...` to check the status. Once your backend returns `ready: true` in the details, the service transitions to `Synchronized`.

### 6.3 — View the Connection Details

Click the gear icon on your service to open the details view. You should see:

| Field | Example Value |
|-------|---------------|
| **email** | `yourname@workshop.example.com` |
| **imap_host** | `mail.workshop.example.com` |
| **imap_port** | `993` |
| **smtp_host** | `mail.workshop.example.com` |
| **smtp_port** | `587` |
| **jmap_url** | `https://mail.workshop.example.com/jmap` |
| **jmap_account_id** | *(auto-discovered)* |
| **dns_records** | MX, SPF, DKIM, DMARC records |
| **ready** | `true` |

### 6.4 — Test the Mailbox

#### Option A: Webmail

Open the **webmail_url** in your browser and log in with your username and password.

#### Option B: JMAP (Programmatic — Send an Email)

Use the JMAP IDs from the service details to send an email programmatically:

```bash
curl -s "$STALWART_API_URL/jmap/" \
  -u 'yourname:your-password' \
  -H 'Content-Type: application/json' \
  -d '{
    "using": [
      "urn:ietf:params:jmap:core",
      "urn:ietf:params:jmap:mail",
      "urn:ietf:params:jmap:submission"
    ],
    "methodCalls": [
      ["Email/set", {
        "accountId": "<jmap_account_id from details>",
        "create": {
          "draft1": {
            "mailboxIds": {"<jmap_drafts_mailbox_id>": true},
            "from": [{"name": "Your Name", "email": "yourname@workshop.example.com"}],
            "to": [{"name": "Test", "email": "another-participant@workshop.example.com"}],
            "subject": "Hello from the Workshop!",
            "textBody": [{"partId": "body", "type": "text/plain"}],
            "bodyValues": {
              "body": {
                "value": "This email was sent via JMAP through the Codesphere managed service!",
                "isEncodingProblem": false
              }
            }
          }
        }
      }, "c1"],
      ["EmailSubmission/set", {
        "accountId": "<jmap_account_id>",
        "create": {
          "sub1": {
            "identityId": "<jmap_identity_id>",
            "emailId": "#draft1"
          }
        }
      }, "c2"]
    ]
  }' | python3 -m json.tool
```

If both method responses contain `"created"` → the email was sent! 🎉

### 6.5 — Test Update and Delete

**Update** the display name or quota via the Codesphere UI or API, and verify the change takes effect.

**Delete** the service instance and verify the Stalwart user is removed:

```bash
curl -s "$STALWART_API_URL/api/principal/yourname" \
  -u "$STALWART_ADMIN_TOKEN"
# Should return: {"error": "notFound", "item": "yourname"}
```

✅ **Checkpoint:** Full lifecycle works — create, read, update, delete. Emails can be sent.

---

## Part 7 — Debug & Improve

### Common Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Service stuck in "Creating" | Backend not reachable or returning errors | Check workspace logs; ensure the backend URL is correct and publicly accessible |
| `502` errors in backend logs | Stalwart API URL wrong or unreachable | Verify `STALWART_API_URL` and network connectivity |
| Domain creation fails with `notFound` | Not a bug — Stalwart returns this oddly | Ensure you're checking for `alreadyExists` in error handling |
| JMAP details empty | User just created, JMAP session needs a moment | Add a small delay or handle gracefully in GET |
| `401` from Stalwart | Wrong admin credentials | Double-check `STALWART_ADMIN_TOKEN` format (`user:password` or bearer token) |

### Ideas for Improvements

Once the basic lifecycle works, consider these enhancements:

**Infrastructure improvements:**

| Improvement | Difficulty | Description |
|-------------|-----------|-------------|
| **Persistent storage** | ⭐⭐ | Replace the in-memory `Map` with a database (e.g., Codesphere's managed PostgreSQL) so state survives backend restarts |
| **Input validation** | ⭐ | Validate EMAIL_PREFIX format, domain format, password strength |
| **Error details** | ⭐ | Return more descriptive error messages that Codesphere can show to the user |
| **Health endpoint** | ⭐ | Add `GET /health` that checks Stalwart connectivity |
| **Quota enforcement** | ⭐⭐ | Map plan IDs to actual quota values (Starter=500MB, Standard=2GB, Premium=10GB) |
| **Multi-domain isolation** | ⭐⭐⭐ | Currently every new instance re-uses or creates a domain without ownership checks — add validation so that a service instance creator actually belongs to the organization owning a domain |

**Build something on top of it:**

| Idea | Difficulty | Description |
|------|-----------|-------------|
| **Transactional email service** | ⭐ | Build an app that provisions a mailbox and sends transactional emails via JMAP |
| **Newsletter platform** | ⭐⭐ | Create a service that sends bulk emails using JMAP batch operations |
| **Email webhook bridge** | ⭐⭐ | Poll JMAP for new emails and forward them to a webhook URL |
| **Mailing list manager** | ⭐⭐⭐ | Use Stalwart's `list` principal type to manage mailing lists through the provider |

---

## Part 8 — Wrap-Up: What Users Get

When everything is wired up, here's the complete experience from a Codesphere user's perspective:

### 1. Browse the Catalog

They open **Managed Services** and see "Stalwart Mailbox" alongside PostgreSQL, S3, and other services.

### 2. Configure and Create

They fill in an email prefix, domain, display name, and password. Click create.

### 3. Get Connection Details

Within seconds, the service shows as "Synchronized" with complete connection details:

| What | Value |
|------|-------|
| **Email address** | `alice@theircompany.com` |
| **IMAP** | `mail.theircompany.com:993` (TLS) |
| **SMTP** | `mail.theircompany.com:587` (STARTTLS) |
| **JMAP endpoint** | `https://mail.theircompany.com/jmap` |
| **JMAP IDs** | Account ID, Identity ID, Drafts Mailbox ID — ready for API use |
| **Webmail** | `https://mail.theircompany.com/login` |
| **DNS records** | SPF, DKIM, DMARC, MX — copy-paste into DNS provider |

### 4. Integrate

They can:
- **Connect any email client** (Thunderbird, Apple Mail, Outlook) using IMAP/SMTP.
- **Send transactional emails** from their app via JMAP (modern, JSON-based — no SMTP library needed).
- **Configure DNS** so their emails are properly authenticated and delivered.

### What You've Built

You've turned a raw open-source mail server into a **self-service managed offering** on the Codesphere platform:

```
                 Before (manual)                    After (managed service)
          ─────────────────────────        ─────────────────────────────────
          1. Deploy Stalwart somehow       1. Click "Stalwart Mailbox" in catalog
          2. SSH in, create domain         2. Fill in 4 fields
          3. Create user via admin API     3. Click "Create"
          4. Figure out JMAP IDs           4. Connection details appear automatically
          5. Look up DNS record format     5. DNS records provided, ready to copy
          6. Write integration code        6. JMAP IDs ready for immediate API use
          7. Debug auth, discover IDs      7. Everything works
```

**That's the power of Codesphere managed services.**

---

## Appendix A — Stalwart API Quick Reference

| Operation | Method | Path | Body / Notes |
|-----------|--------|------|-------------|
| List principals | `GET` | `/api/principal?types=individual&limit=10` | |
| Create domain | `POST` | `/api/principal` | `{"type":"domain","name":"example.com"}` |
| Create user | `POST` | `/api/principal` | `{"type":"individual","name":"alice","secrets":["pass"],"emails":["alice@example.com"],...}` |
| Get user | `GET` | `/api/principal/alice` | Use username, not numeric ID |
| Update user | `PATCH` | `/api/principal/alice` | `[{"action":"set","field":"description","value":"..."}]` |
| Delete user | `DELETE` | `/api/principal/alice` | |
| DNS records | `GET` | `/api/dns/records/example.com` | Returns MX, SPF, DKIM, DMARC |
| JMAP session | `GET` | `/jmap/session` | Auth as the user, not admin |

> **Remember:** Stalwart returns HTTP 200 for errors. Always parse `json.error`.

---

## Appendix B — Environment Variables

These are the environment variables used by `server.js`. In the workshop, they are pre-configured in `ci.stalwart-provider.yml`.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STALWART_API_URL` | Yes | — | Stalwart admin API base URL |
| `STALWART_ADMIN_TOKEN` | Yes | — | `user:password` for Basic Auth, or a Bearer token |
| `STALWART_IMAP_HOST` | Yes | — | Public IMAP hostname (returned in service details) |
| `STALWART_SMTP_HOST` | Yes | — | Public SMTP hostname (returned in service details) |
| `STALWART_IMAP_PORT` | No | `993` | IMAP port |
| `STALWART_SMTP_PORT` | No | `587` | SMTP submission port |
| `STALWART_MAIL_DOMAIN` | No | — | Default domain if not set per-service |
| `STALWART_JMAP_URL` | No | `${STALWART_API_URL}/jmap` | Public JMAP endpoint |
| `STALWART_WEBMAIL_URL` | No | `${STALWART_API_URL}/login` | Public webmail URL |
| `PORT` | No | `8080` | Backend listen port |

---

## Appendix C — Gotchas & Troubleshooting

### Stalwart API Gotchas

| Gotcha | What happens | Solution |
|--------|-------------|----------|
| HTTP 200 for errors | `{"error":"notFound","item":"alice"}` with status 200 | Always check response body for `error` field |
| Domain must exist first | User creation fails if domain doesn't exist | Call `ensureDomain()` before creating users |
| PATCH format | Sending `{"description":"..."}` returns an error | Use `[{"action":"set","field":"description","value":"..."}]` |
| Use username not ID | `PATCH /api/principal/87` → notFound | `PATCH /api/principal/alice` |
| `alreadyExists` variants | Stalwart may return `alreadyExists` or `fieldAlreadyExists` | Check with `.includes('alreadyExists')` |
| Docker image name | `stalwartlabs/mail-server` is the old name | Use `stalwartlabs/stalwart:v0.13.2` |

### provider.yml Gotchas

| Gotcha | What happens | Solution |
|--------|-------------|----------|
| Plan ID is string | API rejects the provider | Use integer: `id: 0` not `id: "starter"` |
| Missing `parameters` in plan | Validation error | Always include `parameters: {}` even if empty |
| Version is semver | Registration fails | Use `v1`, `v2`, not `1.0.0` |
| Name has uppercase | Registration fails | Lowercase only: `stalwart-mailbox` |
| Wrong backend key | Provider not reachable | Use `backend.api.endpoint` for REST backends, not `backend.rest.url` |

---

## Appendix D — JMAP Email Sending

JMAP (RFC 8620/8621) is the modern replacement for IMAP+SMTP, using JSON over HTTP. The managed service auto-discovers all the IDs you need.

### How It Works

A single JMAP request sends an email in two steps (both in one HTTP call):

1. **`Email/set`** — Creates the email as a draft.
2. **`EmailSubmission/set`** — Submits it for delivery.

### Required IDs (All from Service Details)

| ID | Source | Purpose |
|----|--------|---------|
| `accountId` | `jmap_account_id` | Identifies your mailbox |
| `identityId` | `jmap_identity_id` | Your sender identity |
| `draftsMailboxId` | `jmap_drafts_mailbox_id` | Where to create the draft |

### Send an Email

```bash
curl -s "$STALWART_API_URL/jmap/" \
  -u "username:password" \
  -H "Content-Type: application/json" \
  -d '{
    "using": [
      "urn:ietf:params:jmap:core",
      "urn:ietf:params:jmap:mail",
      "urn:ietf:params:jmap:submission"
    ],
    "methodCalls": [
      ["Email/set", {
        "accountId": "ACCOUNT_ID",
        "create": {
          "draft1": {
            "mailboxIds": {"DRAFTS_MAILBOX_ID": true},
            "from": [{"name": "Alice", "email": "alice@example.com"}],
            "to": [{"name": "Bob", "email": "bob@example.com"}],
            "subject": "Hello!",
            "textBody": [{"partId": "body", "type": "text/plain"}],
            "bodyValues": {
              "body": {
                "value": "Sent via JMAP!",
                "isEncodingProblem": false
              }
            }
          }
        }
      }, "c1"],
      ["EmailSubmission/set", {
        "accountId": "ACCOUNT_ID",
        "create": {
          "sub1": {
            "identityId": "IDENTITY_ID",
            "emailId": "#draft1"
          }
        }
      }, "c2"]
    ]
  }'
```

### Understanding the Request

| Field | Value | Meaning |
|-------|-------|---------|
| `accountId` | From service details | Your JMAP account |
| `"draft1"` | You pick this label | A temporary client-side label for this email |
| `mailboxIds` | `{"DRAFTS_ID": true}` | Place the draft in the Drafts mailbox |
| `identityId` | From service details | Your sender identity |
| `emailId: "#draft1"` | Back-reference | JMAP resolves this to the email ID created by `Email/set` above |

> **Note:** `#draft1` is a JMAP **creation reference**. It automatically gets replaced with the actual email ID from the `Email/set` response. This is how the two steps are linked in a single request.

### Verify Success

If the response contains `"created"` in both method responses, the email was sent successfully. If you see `"notCreated"` instead, something went wrong.

You can also verify by querying the Sent mailbox:

```bash
curl -s "$STALWART_API_URL/jmap/" \
  -u "username:password" \
  -H "Content-Type: application/json" \
  -d '{
    "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    "methodCalls": [
      ["Email/query", {
        "accountId": "ACCOUNT_ID",
        "filter": {"subject": "Hello!"},
        "sort": [{"property": "receivedAt", "isAscending": false}],
        "limit": 5
      }, "q1"],
      ["Email/get", {
        "accountId": "ACCOUNT_ID",
        "#ids": {"resultOf": "q1", "name": "Email/query", "path": "/ids"},
        "properties": ["subject", "from", "to", "sentAt", "preview"]
      }, "g1"]
    ]
  }' | python3 -m json.tool
```

### JMAP Error Cases

| Symptom | Cause | Fix |
|---------|-------|-----|
| `401 Unauthorized` | Wrong username or password | Check `-u 'user:password'` |
| `"notCreated"` in Email/set | Invalid mailbox ID or account ID | Verify IDs from service details |
| `"notCreated"` in EmailSubmission/set | Invalid identity ID | Verify `identityId` from service details |
| Email created but not in Sent | Submission failed silently | Check for errors in the `EmailSubmission/set` response |

---

*Happy building! 🚀*
