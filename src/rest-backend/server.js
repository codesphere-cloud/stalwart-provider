/**
 * Stalwart Mailbox REST Backend
 *
 * Implements the Codesphere Managed Service Adapter API to provision
 * email accounts on a Stalwart Mail Server instance.
 *
 * Endpoints:
 *   POST   /           — Create a new mailbox user
 *   GET    /?id=...    — Get status of mailbox services
 *   PATCH  /:id        — Update an existing mailbox user
 *   DELETE /:id        — Delete a mailbox user
 *
 * Required environment variables:
 *   STALWART_API_URL    — Stalwart admin API base URL (e.g. https://mail.example.com)
 *   STALWART_ADMIN_TOKEN — Bearer token or base64-encoded admin credentials for Stalwart API
 *   STALWART_MAIL_DOMAIN — Email domain (e.g. example.com)
 *   STALWART_IMAP_HOST   — Public IMAP hostname
 *   STALWART_SMTP_HOST   — Public SMTP hostname
 *
 * Optional:
 *   STALWART_IMAP_PORT   — IMAP port (default: 993)
 *   STALWART_SMTP_PORT   — SMTP port (default: 587)
 *   STALWART_JMAP_URL    — Public JMAP URL (default: derived from API URL)
 *   STALWART_WEBMAIL_URL — Public webmail URL (default: derived from API URL)
 *   PORT                 — Server listen port (default: 8080)
 *   AUTH_TOKEN           — Bearer token for authenticating Codesphere requests
 */

const express = require('express');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

// ── Stalwart configuration ────────────────────────────────────────
const STALWART_API_URL = process.env.STALWART_API_URL;
const STALWART_ADMIN_TOKEN = process.env.STALWART_ADMIN_TOKEN;
const STALWART_MAIL_DOMAIN = process.env.STALWART_MAIL_DOMAIN;
const STALWART_IMAP_HOST = process.env.STALWART_IMAP_HOST;
const STALWART_SMTP_HOST = process.env.STALWART_SMTP_HOST;
const STALWART_IMAP_PORT = parseInt(process.env.STALWART_IMAP_PORT || '993', 10);
const STALWART_SMTP_PORT = parseInt(process.env.STALWART_SMTP_PORT || '587', 10);
const STALWART_JMAP_URL = process.env.STALWART_JMAP_URL || (STALWART_API_URL ? `${STALWART_API_URL}/jmap` : '');
const STALWART_WEBMAIL_URL = process.env.STALWART_WEBMAIL_URL || (STALWART_API_URL ? `${STALWART_API_URL}/login` : '');

if (!STALWART_API_URL || !STALWART_ADMIN_TOKEN || !STALWART_MAIL_DOMAIN || !STALWART_IMAP_HOST || !STALWART_SMTP_HOST) {
  console.error('Missing required environment variables. Need: STALWART_API_URL, STALWART_ADMIN_TOKEN, STALWART_MAIL_DOMAIN, STALWART_IMAP_HOST, STALWART_SMTP_HOST');
  process.exit(1);
}

// ── Auth middleware ────────────────────────────────────────────────
if (AUTH_TOKEN) {
  app.use((req, res, next) => {
    const header = req.headers.authorization;
    if (!header || header !== `Bearer ${AUTH_TOKEN}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });
}

// ── In-memory store (maps Codesphere service ID → Stalwart username) ─
const services = new Map();

// ── Helpers ───────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

const EMAIL_PREFIX_RE = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i;

function isValidEmailPrefix(prefix) {
  return typeof prefix === 'string' && prefix.length >= 1 && prefix.length <= 64 && EMAIL_PREFIX_RE.test(prefix);
}

async function stalwartRequest(method, path, body) {
  const url = `${STALWART_API_URL}${path}`;
  const options = {
    method,
    headers: {
      'Authorization': STALWART_ADMIN_TOKEN.includes(':')
        ? `Basic ${Buffer.from(STALWART_ADMIN_TOKEN).toString('base64')}`
        : `Bearer ${STALWART_ADMIN_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  return response;
}

/**
 * Parse a Stalwart API response. Stalwart returns HTTP 200 for everything,
 * including errors. Success → {"data": ...}, Error → {"error": "...", ...}
 */
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

// Ensure the mail domain exists as a Stalwart principal (idempotent)
let domainEnsured = false;
async function ensureDomain() {
  if (domainEnsured) return;
  const resp = await stalwartRequest('POST', '/api/principal', {
    type: 'domain',
    name: STALWART_MAIL_DOMAIN,
    description: `Mail domain ${STALWART_MAIL_DOMAIN}`,
  });
  const result = await parseStalwartResponse(resp);
  // "alreadyExists" is fine — means domain was previously created
  if (result.ok || result.error.startsWith('alreadyExists')) {
    domainEnsured = true;
  } else {
    console.error(`Failed to ensure domain ${STALWART_MAIL_DOMAIN}:`, result.error);
  }
}

function buildDetails(username, email) {
  return {
    email,
    username,
    imap_host: STALWART_IMAP_HOST,
    imap_port: STALWART_IMAP_PORT,
    smtp_host: STALWART_SMTP_HOST,
    smtp_port: STALWART_SMTP_PORT,
    jmap_url: STALWART_JMAP_URL,
    webmail_url: STALWART_WEBMAIL_URL,
    ready: true,
  };
}

// ── POST / — Create Mailbox ───────────────────────────────────────
app.post('/', async (req, res) => {
  const { id, config, secrets } = req.body;

  if (!id || !isValidUUID(id)) {
    return res.status(400).json({ error: 'Missing or invalid service id (UUID required)' });
  }

  if (services.has(id)) {
    return res.status(409).json({ error: 'Service already exists' });
  }

  const emailPrefix = config?.EMAIL_PREFIX;
  if (!emailPrefix || !isValidEmailPrefix(emailPrefix)) {
    return res.status(400).json({ error: 'Missing or invalid EMAIL_PREFIX in config' });
  }

  const password = secrets?.MAIL_PASSWORD;
  if (!password) {
    return res.status(400).json({ error: 'Missing MAIL_PASSWORD in secrets' });
  }

  const username = emailPrefix.toLowerCase();
  const email = `${username}@${STALWART_MAIL_DOMAIN}`;
  const displayName = config?.DISPLAY_NAME || username;
  const quotaMB = config?.QUOTA_MB || 0; // 0 = unlimited

  try {
    await ensureDomain();

    const response = await stalwartRequest('POST', '/api/principal', {
      type: 'individual',
      name: username,
      secrets: [password],
      emails: [email],
      description: displayName,
      quota: quotaMB > 0 ? quotaMB * 1024 * 1024 : 0,
      roles: ['user'],
      lists: [],
      memberOf: [],
      members: [],
      enabledPermissions: [],
      disabledPermissions: [],
      urls: [],
      externalMembers: [],
    });

    const result = await parseStalwartResponse(response);
    if (!result.ok) {
      console.error(`Stalwart create failed: ${result.error}`);
      return res.status(502).json({ error: 'Failed to create mailbox on Stalwart', detail: result.error });
    }

    services.set(id, {
      principalId: result.data,
      username,
      email,
      config: config || {},
      details: buildDetails(username, email),
      createdAt: new Date().toISOString(),
    });

    res.status(201).end();
  } catch (err) {
    console.error('Stalwart API error:', err.message);
    return res.status(502).json({ error: 'Cannot reach Stalwart API', detail: err.message });
  }
});

// ── GET / — Get Status ────────────────────────────────────────────
app.get('/', (req, res) => {
  let ids = req.query.id;

  if (!ids) {
    return res.json(Array.from(services.keys()));
  }

  if (!Array.isArray(ids)) {
    ids = [ids];
  }

  const result = {};
  for (const id of ids) {
    if (!isValidUUID(id)) continue;
    const svc = services.get(id);
    if (svc) {
      result[id] = {
        plan: {},
        config: svc.config,
        details: svc.details,
      };
    }
  }

  res.json(result);
});

// ── PATCH /:id — Update Mailbox ───────────────────────────────────
app.patch('/:id', async (req, res) => {
  const { id } = req.params;

  if (!isValidUUID(id)) {
    return res.status(400).json({ error: 'Invalid service id' });
  }

  const svc = services.get(id);
  if (!svc) {
    return res.status(404).json({ error: 'Service not found' });
  }

  const { config, secrets } = req.body;

  // Stalwart PATCH uses an array of action objects:
  // [{"action": "set", "field": "...", "value": "..."}]
  const actions = [];

  if (config?.DISPLAY_NAME) {
    actions.push({ action: 'set', field: 'description', value: config.DISPLAY_NAME });
    svc.config.DISPLAY_NAME = config.DISPLAY_NAME;
  }

  if (config?.QUOTA_MB !== undefined) {
    const quotaMB = config.QUOTA_MB;
    actions.push({ action: 'set', field: 'quota', value: quotaMB > 0 ? quotaMB * 1024 * 1024 : 0 });
    svc.config.QUOTA_MB = quotaMB;
  }

  if (secrets?.MAIL_PASSWORD) {
    actions.push({ action: 'set', field: 'secrets', value: [secrets.MAIL_PASSWORD] });
  }

  if (actions.length > 0) {
    try {
      const response = await stalwartRequest('PATCH', `/api/principal/${encodeURIComponent(svc.username)}`, actions);
      const result = await parseStalwartResponse(response);

      if (!result.ok) {
        console.error(`Stalwart update failed: ${result.error}`);
        return res.status(502).json({ error: 'Failed to update mailbox on Stalwart', detail: result.error });
      }
    } catch (err) {
      console.error('Stalwart API error:', err.message);
      return res.status(502).json({ error: 'Cannot reach Stalwart API', detail: err.message });
    }
  }

  res.status(204).end();
});

// ── DELETE /:id — Delete Mailbox ──────────────────────────────────
app.delete('/:id', async (req, res) => {
  const { id } = req.params;

  if (!isValidUUID(id)) {
    return res.status(400).json({ error: 'Invalid service id' });
  }

  const svc = services.get(id);
  if (!svc) {
    return res.status(404).json({ error: 'Service not found' });
  }

  try {
    const response = await stalwartRequest('DELETE', `/api/principal/${encodeURIComponent(svc.username)}`);
    const result = await parseStalwartResponse(response);

    if (!result.ok && !result.error.startsWith('notFound')) {
      console.error(`Stalwart delete failed: ${result.error}`);
      return res.status(502).json({ error: 'Failed to delete mailbox on Stalwart', detail: result.error });
    }
  } catch (err) {
    console.error('Stalwart API error:', err.message);
    return res.status(502).json({ error: 'Cannot reach Stalwart API', detail: err.message });
  }

  services.delete(id);
  res.status(204).end();
});

// ── Start server ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Stalwart mailbox backend listening on port ${PORT}`);
  console.log(`Stalwart API: ${STALWART_API_URL}`);
  console.log(`Mail domain: ${STALWART_MAIL_DOMAIN}`);
  if (AUTH_TOKEN) {
    console.log('Codesphere authentication enabled');
  } else {
    console.log('WARNING: No AUTH_TOKEN set — authentication disabled');
  }
});
