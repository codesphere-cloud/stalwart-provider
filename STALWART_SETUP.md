# Stalwart Mail Server — Docker Setup Guide

This guide walks you through deploying Stalwart Mail Server with Docker and configuring it to work with the Codesphere managed service provider backend.

---

## Prerequisites

- A server (VPS or dedicated) with a **public IP address**
- Docker and Docker Compose installed
- A **domain name** you control (e.g. `example.com`)
- DNS access to create MX, A, SPF, DKIM, and DMARC records

---

## 1. DNS Configuration

Before starting Stalwart, set up these DNS records for your domain (replace `203.0.113.10` with your server IP and `example.com` with your domain):

| Type  | Name                     | Value                              | TTL  |
|-------|--------------------------|------------------------------------|------|
| A     | `mail.example.com`       | `203.0.113.10`                     | 3600 |
| MX    | `example.com`            | `10 mail.example.com`              | 3600 |
| TXT   | `example.com`            | `v=spf1 a mx ip4:203.0.113.10 -all` | 3600 |
| TXT   | `_dmarc.example.com`     | `v=DMARC1; p=reject; rua=mailto:postmaster@example.com` | 3600 |

> DKIM will be set up after Stalwart generates its keys (see step 4).

---

## 2. Docker Compose Setup

Create a project directory and the following files:

```bash
mkdir -p stalwart-mail && cd stalwart-mail
```

### `docker-compose.yml`

```yaml
services:
  stalwart:
    image: stalwartlabs/mail-server:latest
    container_name: stalwart-mail
    restart: unless-stopped
    ports:
      - "25:25"       # SMTP
      - "465:465"     # SMTP/TLS (implicit)
      - "587:587"     # SMTP/STARTTLS (submission)
      - "993:993"     # IMAPS
      - "4190:4190"   # ManageSieve
      - "443:443"     # HTTPS (webmail + JMAP + admin)
      - "8080:8080"   # HTTP (redirect or API)
    volumes:
      - ./data:/opt/stalwart-mail
    environment:
      # The admin password is set on first run only.
      # Change it via the web admin UI afterwards.
      - STALWART_ADMIN_PASSWORD=changeme-on-first-login
```

### Start the server

```bash
docker compose up -d
```

Stalwart will initialize its data directory on first boot. Give it a minute, then verify:

```bash
docker logs stalwart-mail
```

---

## 3. Initial Admin Setup

1. Open `https://mail.example.com` in your browser
2. Log in with:
   - **Username:** `admin`
   - **Password:** the value of `STALWART_ADMIN_PASSWORD` from docker-compose.yml
3. **Change the admin password immediately** via Settings → Account

### Generate an API Token

The REST backend needs an API token to manage accounts:

1. In the Stalwart web admin, go to **Settings → API Keys** (or **Management → API Access**)
2. Create a new API token with **full account management** permissions
3. Copy the token — you'll need it for the backend configuration

> If your Stalwart version uses Basic Auth for the management API instead of bearer tokens, you can base64-encode `admin:yourpassword` and use that as the token value instead. The backend sends it as a Bearer token.

---

## 4. Configure TLS

Stalwart supports automatic TLS via ACME (Let's Encrypt). In the Stalwart admin UI:

1. Go to **Settings → TLS / ACME**
2. Enable ACME with Let's Encrypt
3. Set the domain to `mail.example.com`
4. Stalwart will automatically obtain and renew certificates

Alternatively, mount your own certificates:

```yaml
# In docker-compose.yml volumes:
volumes:
  - ./data:/opt/stalwart-mail
  - /etc/letsencrypt/live/mail.example.com:/opt/stalwart-mail/certs:ro
```

---

## 5. DKIM Setup

After Stalwart starts, it generates DKIM keys. Retrieve your DKIM DNS record:

1. In the admin UI, go to **Settings → Domain → DKIM**
2. Copy the DNS TXT record value
3. Add it to your DNS:

| Type | Name                                | Value                              |
|------|-------------------------------------|------------------------------------|
| TXT  | `<selector>._domainkey.example.com` | *(the DKIM public key from admin)* |

---

## 6. Configure & Start the REST Backend

The REST backend bridges Codesphere and Stalwart. It needs the following environment variables:

### Required Environment Variables

| Variable              | Description                                              | Example                           |
|-----------------------|----------------------------------------------------------|-----------------------------------|
| `STALWART_API_URL`    | Stalwart admin API base URL                              | `https://mail.example.com`        |
| `STALWART_ADMIN_TOKEN`| API token from step 3                                    | `your-api-token-here`             |
| `STALWART_MAIL_DOMAIN`| Email domain for created accounts                        | `example.com`                     |
| `STALWART_IMAP_HOST`  | Public IMAP hostname                                     | `mail.example.com`                |
| `STALWART_SMTP_HOST`  | Public SMTP hostname                                     | `mail.example.com`                |
| `AUTH_TOKEN`          | Bearer token for Codesphere → backend auth               | `a-strong-random-secret`          |

### Optional Environment Variables

| Variable              | Default                            | Description                         |
|-----------------------|------------------------------------|-------------------------------------|
| `STALWART_IMAP_PORT`  | `993`                              | Public IMAP port                    |
| `STALWART_SMTP_PORT`  | `587`                              | Public SMTP submission port         |
| `STALWART_JMAP_URL`   | `${STALWART_API_URL}/jmap`         | Public JMAP endpoint                |
| `STALWART_WEBMAIL_URL` | `${STALWART_API_URL}/login`       | Public webmail URL                  |
| `PORT`                | `8080`                             | Backend listen port                 |

### Run with Docker

You can add the REST backend as a second service in the same docker-compose.yml or run it separately. Here's a standalone example:

```yaml
# docker-compose.backend.yml
services:
  stalwart-backend:
    build: .
    container_name: stalwart-backend
    restart: unless-stopped
    ports:
      - "9090:8080"
    environment:
      - STALWART_API_URL=https://mail.example.com
      - STALWART_ADMIN_TOKEN=your-api-token-here
      - STALWART_MAIL_DOMAIN=example.com
      - STALWART_IMAP_HOST=mail.example.com
      - STALWART_SMTP_HOST=mail.example.com
      - AUTH_TOKEN=a-strong-random-secret
```

Create a `Dockerfile` in `src/rest-backend/`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY server.js ./
EXPOSE 8080
USER node
CMD ["node", "server.js"]
```

Build and run:

```bash
cd src/rest-backend
docker build -t stalwart-backend .
docker compose -f docker-compose.backend.yml up -d
```

Or run directly with Node.js:

```bash
cd src/rest-backend
npm install
STALWART_API_URL=https://mail.example.com \
STALWART_ADMIN_TOKEN=your-api-token \
STALWART_MAIL_DOMAIN=example.com \
STALWART_IMAP_HOST=mail.example.com \
STALWART_SMTP_HOST=mail.example.com \
AUTH_TOKEN=your-secret \
npm start
```

---

## 7. Register the Provider on Codesphere

Once the backend is running and reachable, update `config/provider.yml`:

```yaml
backend:
  rest:
    url: https://your-stalwart-backend.example.com  # ← your backend URL
    authTokenEnv: BACKEND_AUTH_TOKEN
```

Then validate and register:

```bash
# Validate the provider definition
make validate

# Set required env vars
export CODESPHERE_API_TOKEN="your-codesphere-token"
export CODESPHERE_TEAM_ID="your-team-id"
export BACKEND_AUTH_TOKEN="a-strong-random-secret"  # must match AUTH_TOKEN on the backend

# Register
make register
```

---

## 8. What Users Get

When a user provisions a Stalwart mailbox through Codesphere, they receive:

| Field         | Example                              |
|---------------|--------------------------------------|
| **Email**     | `alice@example.com`                  |
| **Username**  | `alice`                              |
| **IMAP Host** | `mail.example.com`                   |
| **IMAP Port** | `993` (TLS)                          |
| **SMTP Host** | `mail.example.com`                   |
| **SMTP Port** | `587` (STARTTLS)                     |
| **JMAP URL**  | `https://mail.example.com/jmap`      |
| **Webmail**   | `https://mail.example.com/login`     |

They can use any standard email client (Thunderbird, Apple Mail, Outlook) with these settings.

---

## Security Checklist

- [ ] Changed default admin password
- [ ] TLS enabled (ACME or manual certificates)
- [ ] Firewall allows only necessary ports (25, 465, 587, 993, 443)
- [ ] REST backend behind HTTPS (use a reverse proxy like Caddy or nginx)
- [ ] `AUTH_TOKEN` set on both backend and Codesphere provider
- [ ] DKIM, SPF, and DMARC DNS records configured
- [ ] Stalwart admin API not directly exposed to the public internet (only backend can reach it)
