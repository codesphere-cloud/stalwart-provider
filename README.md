# Stalwart Managed Service Provider

A Codesphere managed service provider that wraps [Stalwart Mail Server](https://stalw.art/) as a self-service email offering. Users can provision individual mailboxes (with IMAP, SMTP, JMAP, and webmail access) through the Codesphere marketplace.

## How It Works

A single shared Stalwart instance hosts many mail accounts. When a user books the service through Codesphere, the REST backend creates a new mail account ("logical tenant") on that shared server. When they delete the service, the account is removed.

```
Codesphere Platform  <-->  REST Backend (this repo)  -->  Stalwart Mail Server
  (reconcile loop)         POST/GET/PATCH/DELETE           (shared instance)
```

## Repository Structure

```
├── server.js                       # REST backend (Node.js/Express)
├── package.json
├── ci.stalwart.yml                 # CI pipeline for the Stalwart Mail Server
├── ci.stalwart-provider.yml        # CI pipeline for the REST provider backend
├── provider.yml                    # Marketplace service definition
├── docker-compose.local.yml        # Local Stalwart for development (optional)
└── guides/
    └── TUTORIAL_WORKSHOP.md        # Step-by-step workshop guide
```

## Quick Start

1. Create a Codesphere workspace from this repository
2. The `ci.stalwart-provider.yml` pipeline handles install and startup automatically
3. Link the custom domain `ms-provider-stalwart.csa.codesphere-demo.com` to your workspace
4. Book a "Stalwart Mailbox" service through the Codesphere marketplace

## Workshop

See [guides/TUTORIAL_WORKSHOP.md](guides/TUTORIAL_WORKSHOP.md) for the full hands-on guide.
