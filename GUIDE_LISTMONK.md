# Listmonk als Landscape-based Managed Service auf Codesphere

## Idee

**[Listmonk](https://listmonk.app)** ist ein leichtgewichtiger, Open-Source Newsletter- und Mailing-List-Manager (Go, single binary). Er eignet sich perfekt, weil:

- **Einfach**: Single binary, konfigurierbar via Environment Variables
- **Braucht SMTP**: Nutzt den gerade gebauten **Stalwart Mailbox** Service zum Versenden
- **Braucht PostgreSQL**: Codesphere hat bereits `postgres/v1` als Managed Service
- **Zeigt Komposition**: Ein Landscape-Service, der zwei Managed Services konsumiert

### Architektur

```
┌─────────────────────────────────────────────────────┐
│  Codesphere Landscape (listmonk Provider)           │
│                                                     │
│  ┌──────────────┐                                   │
│  │  listmonk    │  Reactive Service (Go binary)     │
│  │  Port 9000   │──────────────────────┐            │
│  └──────┬───────┘                      │            │
│         │ SQL                    SMTP (Port 587)    │
│         ▼                              ▼            │
│  ┌──────────────┐           ┌──────────────────┐   │
│  │  db           │           │  mailbox          │   │
│  │  postgres/v1  │           │  stalwart-mailbox │   │
│  │  Managed Svc  │           │  Managed Service  │   │
│  └──────────────┘           └──────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## Schritt-für-Schritt Plan

### 1. Neues Repo anlegen

```bash
mkdir listmonk-provider && cd listmonk-provider
# ms-template als Basis kopieren oder neues Repo mit der Struktur:
#   config/provider.yml
#   config/ci.yml
#   src/          (optional, für custom scripts)
```

### 2. `config/provider.yml` erstellen

```yaml
name: listmonk
version: v1
author: Codesphere
displayName: Listmonk Newsletter
iconUrl: https://listmonk.app/static/images/logo.svg
category: messaging
description: |
  Self-hosted newsletter and mailing list manager.
  Powered by Listmonk with PostgreSQL storage and Stalwart SMTP delivery.

backend:
  landscape:
    gitUrl: https://github.com/codesphere-cloud/listmonk-provider
    ciProfile: default

plans:
  - id: 0
    name: starter
    displayName: Starter
    description: Small instance for up to 1,000 subscribers
    parameters: {}

configSchema:
  type: object
  properties:
    ADMIN_USER:
      type: string
      description: Admin username for the Listmonk web UI
    SITE_NAME:
      type: string
      description: Name shown in emails and the web UI

secretsSchema:
  type: object
  properties:
    ADMIN_PASSWORD:
      type: string
      format: password
    SMTP_PASSWORD:
      type: string
      format: password
      description: Password of the Stalwart mailbox used for sending

detailsSchema:
  type: object
  properties:
    url:
      type: string
    admin_user:
      type: string
    ready:
      type: boolean
```

### 3. `config/ci.yml` erstellen

```yaml
schemaVersion: v0.2

prepare:
  steps:
    - name: Download Listmonk
      command: |
        LISTMONK_VERSION=4.1.0
        wget -q "https://github.com/knadh/listmonk/releases/download/v${LISTMONK_VERSION}/listmonk_${LISTMONK_VERSION}_linux_amd64.tar.gz"
        tar xzf "listmonk_${LISTMONK_VERSION}_linux_amd64.tar.gz"
        chmod +x listmonk

    - name: Create config
      command: |
        cat > config.toml <<'EOF'
        [app]
        address = "0.0.0.0:9000"
        admin_username = "${LISTMONK_ADMIN_USER}"
        admin_password = "${LISTMONK_ADMIN_PASSWORD}"

        [db]
        host = "${DB_HOST}"
        port = 5432
        user = "${DB_USER}"
        password = "${DB_PASSWORD}"
        database = "${DB_NAME}"
        ssl_mode = "disable"
        EOF

run:
  # ── Managed Services ────────────────────────────────
  db:
    provider:
      name: postgres
      version: v1
    plan:
      id: 0

  mailbox:
    provider:
      name: stalwart-mailbox
      version: v1
    plan:
      id: 0

  # ── Listmonk Application ────────────────────────────
  app:
    plan: 0
    replicas: 1
    mountSubPath: listmonk
    healthEndpoint: http://localhost:9000/health
    steps:
      - name: Run DB migrations
        command: ./listmonk --install --idempotent --config config.toml

      - name: Configure SMTP via API
        command: |
          # Wait for listmonk to accept connections
          sleep 3
          # Add Stalwart as SMTP server via Listmonk API
          curl -s -u "${LISTMONK_ADMIN_USER}:${LISTMONK_ADMIN_PASSWORD}" \
            -X PUT http://localhost:9000/api/settings \
            -H 'Content-Type: application/json' \
            -d '{
              "smtp": [{
                "enabled": true,
                "host": "'${SMTP_HOST}'",
                "port": 587,
                "auth_protocol": "login",
                "username": "'${SMTP_USER}'",
                "password": "'${SMTP_PASSWORD}'",
                "tls_type": "STARTTLS",
                "max_conns": 5
              }]
            }' || true

      - name: Start Listmonk
        command: ./listmonk --config config.toml

    env:
      # PostgreSQL — kommt vom Managed Service "db"
      # Der Hostname folgt dem Schema: ms-postgres-v1-<teamId>-db
      DB_HOST: ms-postgres-v1-${{ team.id }}-db
      DB_PORT: "5432"
      DB_USER: listmonk
      DB_PASSWORD: ${{ vault.DB_PASSWORD }}
      DB_NAME: listmonk

      # Listmonk Admin
      LISTMONK_ADMIN_USER: ${{ workspace.env['ADMIN_USER'] }}
      LISTMONK_ADMIN_PASSWORD: ${{ vault.ADMIN_PASSWORD }}

      # SMTP — kommt vom Managed Service "mailbox" (Stalwart)
      # Der SMTP Host muss der echte Stalwart-Host sein, nicht der interne MS-Hostname
      SMTP_HOST: ${{ workspace.env['SMTP_HOST'] }}
      SMTP_USER: ${{ workspace.env['SMTP_USER'] }}
      SMTP_PASSWORD: ${{ vault.SMTP_PASSWORD }}

    network:
      ports:
        - port: 9000
          isPublic: false
      paths:
        - port: 9000
          path: /
```

### 4. Offene Fragen / Entscheidungen

| Thema | Optionen | Empfehlung |
|-------|----------|------------|
| **SMTP-Credentials** | Statisch in configSchema oder automatisch aus Stalwart MS Details? | Erstmal statisch über `configSchema` + `secretsSchema` — der User gibt die Mailbox-Credentials an, die er über den Stalwart-Service erstellt hat |
| **PostgreSQL Setup** | Eigene DB oder vom postgres/v1 MS automatisch? | `postgres/v1` als Managed Service im Landscape — Codesphere erstellt die DB automatisch |
| **Listmonk Config** | config.toml oder Environment Variables? | Listmonk unterstützt beides. `config.toml` ist expliziter und wird im prepare-Step generiert |
| **Listmonk Version** | Welche? | v4.1.0 (aktuell stabil). Im prepare-Step als Variable, einfach aktualisierbar |
| **TLS für SMTP** | STARTTLS oder Implicit TLS? | STARTTLS auf Port 587 (Standard für Submission) |

### 5. Ablauf aus User-Sicht

1. User geht ins Codesphere Marketplace
2. Erstellt zuerst einen **Stalwart Mailbox** Service → bekommt Email + SMTP-Credentials
3. Erstellt dann einen **Listmonk** Service:
   - Gibt `ADMIN_USER`, `SITE_NAME` an
   - Gibt `ADMIN_PASSWORD`, `SMTP_PASSWORD` (= Mailbox-Passwort) als Secrets an
4. Codesphere provisioniert automatisch PostgreSQL + startet Listmonk
5. User greift über die Landscape-URL auf das Listmonk Web-UI zu
6. Listmonk versendet Emails über den Stalwart SMTP-Server

### 6. Implementierungs-Reihenfolge

| Schritt | Was | Geschätzter Aufwand |
|---------|-----|---------------------|
| **A** | Repo erstellen, `provider.yml` + `ci.yml` schreiben | Gering |
| **B** | Lokal testen: Listmonk binary + lokale PostgreSQL + lokalen Stalwart | Mittel |
| **C** | `make validate` bestehen | Gering |
| **D** | Provider registrieren (`make register` oder gitUrl API) | Gering |
| **E** | End-to-End Test: Landscape deployen, Newsletter versenden | Mittel |
| **F** | Feinschliff: Health-Endpoint, Bounce-Handling, Templates | Optional |

### 7. Alternative Projekte (falls Listmonk nicht passt)

| Projekt | Sprache | Beschreibung | Komplexität |
|---------|---------|--------------|-------------|
| **[Listmonk](https://listmonk.app)** | Go | Newsletter/Mailing-Listen | ⭐ Niedrig |
| **[Mailtrain](https://mailtrain.org)** | Node.js | Newsletter-Manager (mehr Features, komplexer) | ⭐⭐ Mittel |
| **[Postal](https://docs.postalserver.io)** | Ruby | Mail Delivery Platform (MTA-Level) | ⭐⭐⭐ Hoch |
| **[Mautic](https://mautic.org)** | PHP | Marketing Automation + Email | ⭐⭐⭐ Hoch |
| **[Chatwoot](https://chatwoot.com)** | Ruby | Kundenkommunikation mit Email-Kanal | ⭐⭐⭐ Hoch |

**Empfehlung: Listmonk** — einfachstes Setup, single binary, perfekter Fit.

---

## Nächste Schritte

1. Bestätige ob Listmonk die richtige Wahl ist
2. Ich erstelle das komplette Repo mit `provider.yml`, `ci.yml` und Hilfsscripts
3. Wir testen lokal, dann registrieren wir den Provider auf Codesphere
