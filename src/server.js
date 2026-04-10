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
const STALWART_DEFAULT_DOMAIN = process.env.STALWART_MAIL_DOMAIN || '';
const STALWART_IMAP_HOST = process.env.STALWART_IMAP_HOST;
const STALWART_SMTP_HOST = process.env.STALWART_SMTP_HOST;
const STALWART_IMAP_PORT = parseInt(process.env.STALWART_IMAP_PORT || '993', 10);
const STALWART_SMTP_PORT = parseInt(process.env.STALWART_SMTP_PORT || '587', 10);
const STALWART_JMAP_URL = process.env.STALWART_JMAP_URL || (STALWART_API_URL ? `${STALWART_API_URL}/jmap` : '');
const STALWART_WEBMAIL_URL = process.env.STALWART_WEBMAIL_URL || (STALWART_API_URL ? `${STALWART_API_URL}/login` : '');

if (!STALWART_API_URL || !STALWART_ADMIN_TOKEN || !STALWART_IMAP_HOST || !STALWART_SMTP_HOST) {
  console.error('Missing required environment variables. Need: STALWART_API_URL, STALWART_ADMIN_TOKEN, STALWART_IMAP_HOST, STALWART_SMTP_HOST');
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

// Ensure a mail domain exists as a Stalwart principal (idempotent, per-domain cache)
const ensuredDomains = new Set();
async function ensureDomain(domain) {
  if (ensuredDomains.has(domain)) return;
  const resp = await stalwartRequest('POST', '/api/principal', {
    type: 'domain',
    name: domain,
    description: `Mail domain ${domain}`,
  });
  const result = await parseStalwartResponse(resp);
  if (result.ok || (result.error && (result.error.includes('alreadyExists') || result.error.includes('AlreadyExists')))) {
    ensuredDomains.add(domain);
    console.log(`Domain ${domain} ensured.`);
  } else {
    console.error(`Failed to ensure domain ${domain}:`, result.error);
    throw new Error(`Failed to ensure domain: ${result.error}`);
  }
}

// Fetch required DNS records from Stalwart for a domain
async function fetchDnsRecords(domain) {
  try {
    const resp = await stalwartRequest('GET', `/api/dns/records/${encodeURIComponent(domain)}`);
    const result = await parseStalwartResponse(resp);
    if (!result.ok) {
      console.error(`Failed to fetch DNS records for ${domain}:`, result.error);
      return [];
    }
    return result.data || [];
  } catch (err) {
    console.error(`DNS record fetch error for ${domain}:`, err.message);
    return [];
  }
}

// Format DNS records into a human-readable string for details
function formatDnsRecords(records) {
  if (!records || records.length === 0) return 'No DNS records available';
  return records
    .map(r => `${r.type} ${r.name} ${r.content}`)
    .join('\n');
}

// Fetch JMAP session details for a user (accountId, identityId, mailbox IDs)
async function fetchJmapDetails(username, password) {
  try {
    const sessionResp = await fetch(`${STALWART_API_URL}/jmap/session`, {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      },
    });
    if (!sessionResp.ok) return {};
    const session = await sessionResp.json();
    const accountId = session.primaryAccounts?.['urn:ietf:params:jmap:mail'];
    if (!accountId) return {};

    // Fetch identityId and mailbox IDs
    const jmapResp = await fetch(`${STALWART_API_URL}/jmap/`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail', 'urn:ietf:params:jmap:submission'],
        methodCalls: [
          ['Identity/get', { accountId }, '0'],
          ['Mailbox/get', { accountId, properties: ['name', 'role'] }, '1'],
        ],
      }),
    });
    if (!jmapResp.ok) return { jmap_account_id: accountId };
    const jmap = await jmapResp.json();

    const identities = jmap.methodResponses?.[0]?.[1]?.list || [];
    const mailboxes = jmap.methodResponses?.[1]?.[1]?.list || [];
    const identityId = identities[0]?.id || '';
    const draftsId = mailboxes.find(m => m.role === 'drafts')?.id || '';

    return { jmap_account_id: accountId, jmap_identity_id: identityId, jmap_drafts_mailbox_id: draftsId };
  } catch (err) {
    console.error(`JMAP details fetch error for ${username}:`, err.message);
    return {};
  }
}

async function buildDetails(username, email, domain, password) {
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
    jmap_account_id: jmapDetails.jmap_account_id || '',
    jmap_identity_id: jmapDetails.jmap_identity_id || '',
    jmap_drafts_mailbox_id: jmapDetails.jmap_drafts_mailbox_id || '',
    webmail_url: STALWART_WEBMAIL_URL,
    dns_records: formatDnsRecords(dnsRecords),
    ready: true,
  };
}

// ── POST / — Create Mailbox ───────────────────────────────────────
app.post('/', async (req, res) => {
  const { id, config, secrets, plan } = req.body;

  if (!id || !isValidUUID(id)) {
    return res.status(400).json({ error: 'Missing or invalid service id (UUID required)' });
  }

  if (services.has(id)) {
    // Already tracked — idempotent success
    return res.status(201).end();
  }

  const emailPrefix = config?.EMAIL_PREFIX;
  if (!emailPrefix || !isValidEmailPrefix(emailPrefix)) {
    return res.status(400).json({ error: 'Missing or invalid EMAIL_PREFIX in config' });
  }

  const password = secrets?.MAIL_PASSWORD;
  if (!password) {
    return res.status(400).json({ error: 'Missing MAIL_PASSWORD in secrets' });
  }

  const mailDomain = (config?.MAIL_DOMAIN || STALWART_DEFAULT_DOMAIN || '').toLowerCase();
  if (!mailDomain) {
    return res.status(400).json({ error: 'Missing MAIL_DOMAIN in config and no default domain configured' });
  }

  const username = emailPrefix.toLowerCase();
  const email = `${username}@${mailDomain}`;
  const displayName = config?.DISPLAY_NAME || username;
  const quotaMB = config?.QUOTA_MB || 0; // 0 = unlimited

  try {
    await ensureDomain(mailDomain);

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
      // If user already exists in Stalwart (e.g. after backend restart), adopt it
      if (result.error && (result.error.includes('alreadyExists') || result.error.includes('AlreadyExists'))) {
        console.log(`User ${username} already exists in Stalwart, adopting for service ${id}`);
      } else {
        console.error(`Stalwart create failed: ${result.error}`);
        return res.status(502).json({ error: 'Failed to create mailbox on Stalwart', detail: result.error });
      }
    }

    const details = await buildDetails(username, email, mailDomain, password);

    services.set(id, {
      principalId: result.data,
      username,
      email,
      mailDomain,
      plan: plan || { id: 0, parameters: {} },
      config: config || {},
      details,
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
        plan: svc.plan || { id: 0, parameters: {} },
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

  const { config, secrets, plan } = req.body;

  // Stalwart PATCH uses an array of action objects:
  // [{"action": "set", "field": "...", "value": "..."}]
  const actions = [];

  // Update plan if provided
  if (plan) {
    svc.plan = plan;
  }

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
  console.log(`Mail domain: ${STALWART_DEFAULT_DOMAIN || '(per-service)'}`);
  if (AUTH_TOKEN) {
    console.log('Codesphere authentication enabled');
  } else {
    console.log('WARNING: No AUTH_TOKEN set — authentication disabled');
  }
});
