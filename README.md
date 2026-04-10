# Stalwart Managed Service Provider

A Codesphere managed service provider that wraps [Stalwart Mail Server](https://stalw.art/) as a self-service email offering. Users can provision individual mailboxes (with IMAP, SMTP, JMAP, and webmail access) through the Codesphere marketplace.

## How It Works

A single shared Stalwart instance hosts many mail accounts. When a user books the service through Codesphere, the REST backend creates a new mail account ("logical tenant") on that shared server. When they delete the service, the account is removed.

```
Codesphere Platform  ◄──► REST Backend (this repo)  ──► Stalwart Mail Server
  (reconcile loop)         POST/GET/PATCH/DELETE          (shared instance)
```

## Repository Structure

```
├── src/                        # REST backend (Node.js/Express)
│   ├── server.js               # Managed service adapter implementation
│   └── package.json
├── ci.stalwart-provider.yml    # CI pipeline for the REST backend
├── ci.stalwart.yml             # CI pipeline for the Stalwart Mail Server
├── provider.yml                # Marketplace service definition
├── docker-compose.local.yml    # Local Stalwart for development
├── examples/                   # Generic provider.yml / ci.yml examples
├── Makefile                    # validate, test, start-api-backend, send-mail
└── WORKSHOP_TUTORIAL.md        # Step-by-step workshop guide
```

## Quick Start

```bash
# Local development with Docker
docker compose -f docker-compose.local.yml up -d
make start-api-backend

# Validate provider.yml
make validate

# Send a test email via JMAP
make send-mail JMAP_TO_EMAIL=someone@example.com
```

## Workshop

See [WORKSHOP_TUTORIAL.md](WORKSHOP_TUTORIAL.md) for the full hands-on guide.
