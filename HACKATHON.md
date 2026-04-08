# 📬 Stalwart Mail Provider — Hackathon Guide

Welcome! This guide will help you understand, run, and extend the **Stalwart Mailbox Provider** — a Codesphere managed service that provisions email accounts on demand.

---

## What Does This Project Do?

It lets anyone create a **fully functional email account** (with IMAP, SMTP, JMAP, and webmail) by clicking a button in Codesphere. Under the hood, a Node.js REST backend talks to [Stalwart Mail Server](https://stalw.art/) to create users, fetch DNS records, and discover JMAP session details — all automatically.

---

## Architecture Overview

```mermaid
graph TB
    subgraph USER["👤 Hackathon Participant"]
        CS_UI["Codesphere Dashboard"]
        EMAIL_CLIENT["Email Client<br/>(Thunderbird, Apple Mail, Outlook)"]
        JMAP_APP["Your App<br/>(JMAP API calls)"]
    end

    subgraph CODESPHERE["☁️ Codesphere Platform"]
        RECONCILER["Reconciliation Loop<br/><i>polls every ~10s</i>"]
    end

    subgraph BACKEND["🔌 REST Backend <i>(Node.js / Express)</i>"]
        ADAPTER["Managed Service<br/>Adapter API<br/><b>POST / GET / PATCH / DELETE</b>"]
    end

    subgraph STALWART["📬 Stalwart Mail Server"]
        ADMIN_API["Admin API<br/>/api/principal<br/>/api/dns/records"]
        JMAP_EP["JMAP Endpoint<br/>/jmap/session<br/>/jmap/"]
        IMAP["IMAP Server<br/>:993 (TLS)"]
        SMTP["SMTP Server<br/>:587 (STARTTLS)"]
        WEBMAIL["Webmail UI<br/>/login"]
    end

    CS_UI -- "provision mailbox" --> RECONCILER
    RECONCILER -- "HTTP REST" --> ADAPTER
    ADAPTER -- "Create/Update/Delete users" --> ADMIN_API
    ADAPTER -- "Fetch JMAP IDs" --> JMAP_EP
    ADAPTER -- "Fetch DNS records" --> ADMIN_API

    EMAIL_CLIENT -- "IMAP (read mail)" --> IMAP
    EMAIL_CLIENT -- "SMTP (send mail)" --> SMTP
    JMAP_APP -- "JMAP (send/read)" --> JMAP_EP
    CS_UI -- "open webmail" --> WEBMAIL

    style USER fill:#e8f4fd,stroke:#2196F3,color:#000
    style CODESPHERE fill:#e8f5e9,stroke:#4CAF50,color:#000
    style BACKEND fill:#fff3e0,stroke:#FF9800,color:#000
    style STALWART fill:#fce4ec,stroke:#E91E63,color:#000
```

**How the pieces connect:**

| Component | Role | Tech |
|-----------|------|------|
| **Codesphere** | Orchestrates provisioning, shows UI to users | Platform |
| **REST Backend** | Translates Codesphere API calls → Stalwart API calls | Node.js + Express |
| **Stalwart** | Stores mailboxes, handles email protocols | Rust mail server |

---

## Quickstart Flowchart

```mermaid
flowchart TB
    START(["🏁 Start Here"])

    CLONE["1. Clone the repo<br/><code>git clone stalwart-provider</code>"]
    DOCKER["2. Start Stalwart<br/><code>docker compose -f docker-compose.local.yml up -d</code>"]
    BACKEND["3. Start REST Backend<br/><code>cd src/rest-backend && npm install && node server.js</code>"]
    CREATE["4. Create a mailbox<br/><code>curl -X POST localhost:9090/</code>"]
    GET["5. Get connection details<br/><code>curl localhost:9090/?id=...</code>"]

    CHOOSE{How will you<br/>send email?}

    JMAP_PATH["Use JMAP API<br/>accountId + identityId<br/>+ draftsMailboxId<br/>from details response"]
    SMTP_PATH["Use SMTP<br/>smtp_host + smtp_port<br/>+ username + password"]
    IMAP_PATH["Use IMAP<br/>imap_host + imap_port<br/>+ username + password"]
    WEBMAIL_PATH["Use Webmail<br/>Open webmail_url<br/>in browser"]

    DONE(["🎉 Sending & Receiving!"])

    START --> CLONE --> DOCKER --> BACKEND --> CREATE --> GET --> CHOOSE
    CHOOSE -- "Programmatic<br/>(recommended)" --> JMAP_PATH --> DONE
    CHOOSE -- "Traditional" --> SMTP_PATH --> DONE
    CHOOSE -- "Read mail" --> IMAP_PATH --> DONE
    CHOOSE -- "Quick test" --> WEBMAIL_PATH --> DONE

    style START fill:#4CAF50,stroke:#2E7D32,color:#fff
    style DONE fill:#4CAF50,stroke:#2E7D32,color:#fff
    style CHOOSE fill:#FFF9C4,stroke:#F9A825,color:#000
    style JMAP_PATH fill:#E8F5E9,stroke:#43A047,color:#000
    style SMTP_PATH fill:#E3F2FD,stroke:#1E88E5,color:#000
    style IMAP_PATH fill:#F3E5F5,stroke:#8E24AA,color:#000
    style WEBMAIL_PATH fill:#FFF3E0,stroke:#EF6C00,color:#000
```

---

## Step-by-Step Setup

### Prerequisites

- Docker and Docker Compose
- Node.js 18+
- `curl` (for testing)

### 1. Start Stalwart Mail Server

```bash
docker compose -f docker-compose.local.yml up -d
```

This gives you a local Stalwart instance:

```mermaid
graph LR
    subgraph DOCKER["🐳 Docker Compose (Local Dev)"]
        direction TB
        SW["stalwartlabs/stalwart:v0.13.2"]
        BE["REST Backend<br/>node server.js"]
    end

    subgraph PORTS["🔗 Exposed Ports"]
        direction TB
        P1080["1080 → HTTP Admin + JMAP + Webmail"]
        P1587["1587 → SMTP Submission"]
        P1993["1993 → IMAPS"]
        P9090["9090 → REST Backend API"]
    end

    subgraph STORAGE["💾 Persistence"]
        VOL["stalwart-data<br/>/opt/stalwart-mail"]
    end

    SW --> P1080
    SW --> P1587
    SW --> P1993
    BE --> P9090
    BE -- "STALWART_API_URL" --> SW
    SW --> VOL

    style DOCKER fill:#e3f2fd,stroke:#1565C0,color:#000
    style PORTS fill:#f3e5f5,stroke:#7B1FA2,color:#000
    style STORAGE fill:#fff8e1,stroke:#F57F17,color:#000
```

| Port | Service | What it's for |
|------|---------|---------------|
| `1080` | HTTP | Admin UI, Webmail, JMAP endpoint |
| `1587` | SMTP | Send emails (submission port) |
| `1993` | IMAPS | Read emails (TLS) |
| `9090` | REST Backend | Codesphere adapter API |

> **Admin login:** `admin` / `localdev123` at http://localhost:1080

### 2. Start the REST Backend

```bash
cd src/rest-backend
npm install

STALWART_API_URL=http://localhost:1080 \
STALWART_ADMIN_TOKEN="admin:localdev123" \
STALWART_IMAP_HOST=localhost \
STALWART_SMTP_HOST=localhost \
STALWART_IMAP_PORT=1993 \
STALWART_SMTP_PORT=1587 \
PORT=9090 \
node server.js
```

### 3. Create a Mailbox

```bash
curl -s -X POST http://localhost:9090/ \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    "plan": {"id": 0, "parameters": {}},
    "config": {
      "EMAIL_PREFIX": "alice",
      "MAIL_DOMAIN": "example.com",
      "DISPLAY_NAME": "Alice"
    },
    "secrets": {"MAIL_PASSWORD": "supersecret123"}
  }'
```

### 4. Get Connection Details

```bash
curl -s http://localhost:9090/?id=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee | python3 -m json.tool
```

You'll get back everything needed to connect:

```json
{
  "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee": {
    "plan": { "id": 0, "parameters": {} },
    "config": { "EMAIL_PREFIX": "alice", "MAIL_DOMAIN": "example.com", "DISPLAY_NAME": "Alice" },
    "details": {
      "email": "alice@example.com",
      "username": "alice",
      "mail_domain": "example.com",
      "imap_host": "localhost",
      "imap_port": 1993,
      "smtp_host": "localhost",
      "smtp_port": 1587,
      "jmap_url": "http://localhost:1080/jmap",
      "jmap_account_id": "h",
      "jmap_identity_id": "b",
      "jmap_drafts_mailbox_id": "d",
      "webmail_url": "http://localhost:1080/login",
      "dns_records": "MX example.com. 10 ...\nTXT example.com. v=spf1 ...",
      "ready": true
    }
  }
}
```

---

## How Provisioning Works

```mermaid
sequenceDiagram
    actor User as 👤 Participant
    participant CS as ☁️ Codesphere
    participant BE as 🔌 REST Backend
    participant ST as 📬 Stalwart

    Note over User,ST: 1️⃣ Provision a Mailbox
    User->>CS: Create managed service<br/>(EMAIL_PREFIX, MAIL_DOMAIN, PASSWORD)
    CS->>BE: POST / {id, config, secrets, plan}
    BE->>ST: POST /api/principal {type: "domain", name: "example.com"}
    ST-->>BE: 200 OK (or alreadyExists)
    BE->>ST: POST /api/principal {type: "individual", name: "alice", ...}
    ST-->>BE: 200 OK {data: principalId}

    Note over BE,ST: Fetch connection details in parallel
    par DNS Records
        BE->>ST: GET /api/dns/records/example.com
        ST-->>BE: [{type: "MX", ...}, {type: "TXT", ...}]
    and JMAP Discovery
        BE->>ST: GET /jmap/session (as alice)
        ST-->>BE: {primaryAccounts: {mail: "accountId"}}
        BE->>ST: POST /jmap/ Identity/get + Mailbox/get
        ST-->>BE: {identityId, draftsMailboxId}
    end

    BE-->>CS: 201 Created
    CS-->>User: ✅ Mailbox ready!

    Note over User,ST: 2️⃣ Codesphere polls details
    CS->>BE: GET /?id=<service-id>
    BE-->>CS: {plan, config, details: {email, imap_host, jmap_account_id, dns_records, ...}}
    CS-->>User: Show connection details
```

---

## REST Adapter API Reference

```mermaid
graph TB
    subgraph ADAPTER_API["🔌 REST Backend — Adapter API Contract"]
        direction TB
        POST["<b>POST /</b><br/>Create mailbox user<br/>→ 201 Created"]
        GET["<b>GET /?id=uuid</b><br/>Get service status + details<br/>→ 200 JSON"]
        PATCH["<b>PATCH /:id</b><br/>Update password, display name, quota<br/>→ 204 No Content"]
        DELETE["<b>DELETE /:id</b><br/>Remove mailbox user<br/>→ 204 No Content"]
    end

    subgraph REQUEST["📥 POST Request Body"]
        REQ_ID["id: UUID"]
        REQ_PLAN["plan: {id: 0, parameters: {}}"]
        REQ_CONFIG["config: {<br/>  EMAIL_PREFIX: 'alice',<br/>  MAIL_DOMAIN: 'example.com',<br/>  DISPLAY_NAME: 'Alice'<br/>}"]
        REQ_SECRETS["secrets: {MAIL_PASSWORD: '***'}"]
    end

    subgraph RESPONSE["📤 GET Response (details)"]
        RES_EMAIL["email: alice@example.com"]
        RES_IMAP["imap_host / imap_port"]
        RES_SMTP["smtp_host / smtp_port"]
        RES_JMAP["jmap_url / jmap_account_id<br/>jmap_identity_id<br/>jmap_drafts_mailbox_id"]
        RES_DNS["dns_records: SPF, DKIM, DMARC, MX"]
        RES_READY["ready: true"]
    end

    POST --- REQUEST
    GET --- RESPONSE

    style ADAPTER_API fill:#FFF3E0,stroke:#E65100,color:#000
    style REQUEST fill:#E8F5E9,stroke:#2E7D32,color:#000
    style RESPONSE fill:#E3F2FD,stroke:#1565C0,color:#000
```

| Endpoint | Method | Purpose | Response |
|----------|--------|---------|----------|
| `/` | `POST` | Create a new mailbox | `201` (empty body) |
| `/?id=<uuid>` | `GET` | Get mailbox status & connection details | `200` JSON |
| `/:id` | `PATCH` | Update display name, quota, or password | `204` |
| `/:id` | `DELETE` | Delete mailbox and Stalwart user | `204` |

### Config Fields

| Field | Type | Mutable | Description |
|-------|------|---------|-------------|
| `EMAIL_PREFIX` | string | ❌ immutable | Local part of the email (before `@`) |
| `MAIL_DOMAIN` | string | ❌ immutable | Email domain (auto-created in Stalwart) |
| `DISPLAY_NAME` | string | ✅ | Friendly name shown in email clients |
| `QUOTA_MB` | integer | ✅ | Storage quota in MB (0 = unlimited) |

### Secret Fields

| Field | Type | Description |
|-------|------|-------------|
| `MAIL_PASSWORD` | password | Mailbox login password |

---

## Sending Email via JMAP

JMAP is the modern replacement for SMTP. The managed service returns everything you need — no discovery step required.

```mermaid
sequenceDiagram
    actor App as 🚀 Your App
    participant ST as 📬 Stalwart JMAP

    Note over App,ST: Send an email via JMAP (using details from managed service)

    App->>ST: POST /jmap/<br/>Email/set (create draft in Drafts mailbox)
    Note right of App: accountId, draftsMailboxId<br/>from service details
    ST-->>App: {created: {draft1: {id: "emailId"}}}

    App->>ST: POST /jmap/<br/>EmailSubmission/set (send it)
    Note right of App: identityId from<br/>service details
    ST-->>App: {created: {sub1: {id: "..."}}}
    ST->>ST: Deliver via SMTP

    Note over App,ST: ✅ Email sent! No SMTP config needed.
```

### Copy-Paste Example

Replace the values from your `GET` response:

```bash
curl -s http://localhost:1080/jmap/ \
  -u 'alice:supersecret123' \
  -H 'Content-Type: application/json' \
  -d '{
    "using": [
      "urn:ietf:params:jmap:core",
      "urn:ietf:params:jmap:mail",
      "urn:ietf:params:jmap:submission"
    ],
    "methodCalls": [
      ["Email/set", {
        "accountId": "<jmap_account_id>",
        "create": {
          "draft1": {
            "mailboxIds": {"<jmap_drafts_mailbox_id>": true},
            "from": [{"name": "Alice", "email": "alice@example.com"}],
            "to": [{"name": "Bob", "email": "bob@example.com"}],
            "subject": "Hello from the hackathon!",
            "textBody": [{"partId": "body", "type": "text/plain"}],
            "bodyValues": {
              "body": {
                "value": "This email was sent programmatically via JMAP!",
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
  }'
```

> **Tip:** The `#draft1` reference automatically resolves to the email ID created in the first method call.

---

## File Structure

```
stalwart-provider/
├── config/
│   └── provider.yml             ← Provider definition (schemas, plans, backend URL)
├── src/
│   └── rest-backend/
│       ├── server.js            ← REST backend (the main code!)
│       └── package.json
├── docker-compose.local.yml     ← Local Stalwart for development
├── scripts/
│   ├── validate.sh              ← Validates provider.yml
│   └── register.sh              ← Registers provider with Codesphere
├── Makefile                     ← make validate / make register
├── STALWART_SETUP.md            ← Production deployment guide
└── HACKATHON.md                 ← You are here!
```

---

## Ideas for Extending

Here are some things you could build on top of this:

| Idea | Difficulty | Description |
|------|-----------|-------------|
| **Email-sending microservice** | ⭐ Easy | Build an app that provisions a mailbox and sends transactional emails via JMAP |
| **Newsletter platform** | ⭐⭐ Medium | Create a service that sends bulk emails using JMAP batch operations |
| **Multi-tenant SaaS email** | ⭐⭐ Medium | Let each customer bring their own domain, auto-configure DNS |
| **Email webhook bridge** | ⭐⭐ Medium | Poll JMAP for new emails and forward them to a webhook |
| **Persistent storage** | ⭐⭐ Medium | Replace the in-memory `Map()` with a database (SQLite, PostgreSQL) |
| **Mailing list manager** | ⭐⭐⭐ Hard | Use Stalwart's `list` principal type to manage mailing lists |

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `Connection refused` on port 1080 | Stalwart not running | `docker compose -f docker-compose.local.yml up -d` |
| `401 Unauthorized` from Stalwart | Wrong admin password | Check `STALWART_ADMIN_TOKEN` matches `admin:localdev123` |
| Domain creation fails | Stalwart IP-blocked you | `docker compose -f docker-compose.local.yml down -v && docker compose -f docker-compose.local.yml up -d` (wipes data!) |
| JMAP details are empty | User just created, needs a moment | JMAP session may take a second to initialize. Retry the GET. |
| Port 9090 in use | Old backend still running | `lsof -ti:9090 \| xargs kill` |
| Emails to Gmail rejected | Missing DNS/TLS (local only) | This is expected locally. See `STALWART_SETUP.md` for production DNS config. |

---

## Environment Variable Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STALWART_API_URL` | ✅ | — | Stalwart admin API base URL |
| `STALWART_ADMIN_TOKEN` | ✅ | — | `user:password` for Basic Auth or Bearer token |
| `STALWART_IMAP_HOST` | ✅ | — | Public IMAP hostname |
| `STALWART_SMTP_HOST` | ✅ | — | Public SMTP hostname |
| `STALWART_IMAP_PORT` | — | `993` | IMAP port |
| `STALWART_SMTP_PORT` | — | `587` | SMTP submission port |
| `STALWART_MAIL_DOMAIN` | — | — | Default domain (if not set per-service) |
| `PORT` | — | `8080` | Backend listen port |
| `AUTH_TOKEN` | — | — | Bearer token for securing the backend |
