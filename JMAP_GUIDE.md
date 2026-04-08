# Sending Email via JMAP — Explained

This guide breaks down how to send an email using the JMAP API and how to verify it worked.

---

## The Command

```bash
curl -s http://localhost:1080/jmap/ \
  -u 'jd:jd' \
  -H 'Content-Type: application/json' \
  -d '{ ... }'
```

| Part | What it does |
|------|--------------|
| `http://localhost:1080/jmap/` | The JMAP endpoint on your Stalwart server |
| `-u 'jd:jd'` | Authenticates as user `jd` with password `jd` (Basic Auth) |
| `-H 'Content-Type: application/json'` | Tells the server we're sending JSON |
| `-d '{ ... }'` | The JMAP request body (see below) |

---

## The Request Body — Step by Step

A single JMAP request contains **two method calls** that execute in order:

### Step 1: `Email/set` — Create the email draft

```json
["Email/set", {
  "accountId": "j",
  "create": {
    "draft1": {
      "mailboxIds": {"d": true},
      "from": [{"name": "JD", "email": "jd@codesphere.com"}],
      "to": [{"name": "Recipient", "email": "recipient@example.com"}],
      "subject": "Hello from Codesphere!",
      "textBody": [{"partId": "body", "type": "text/plain"}],
      "bodyValues": {
        "body": {
          "value": "This email was sent via JMAP from a Codesphere managed service!",
          "isEncodingProblem": false
        }
      }
    }
  }
}, "c1"]
```

| Field | Value | Meaning |
|-------|-------|---------|
| `accountId` | `"j"` | Your JMAP account ID (from service details) |
| `"draft1"` | — | A temporary client-side label for this email (you pick the name) |
| `mailboxIds` | `{"d": true}` | Put the email in the Drafts mailbox (`"d"` = your drafts mailbox ID) |
| `from` | `jd@codesphere.com` | The sender address |
| `to` | `recipient@example.com` | The recipient |
| `subject` | `"Hello from Codesphere!"` | Email subject line |
| `bodyValues.body.value` | `"This email was sent..."` | The plain text body |

> This only **creates** the email object. It doesn't send it yet.

### Step 2: `EmailSubmission/set` — Actually send it

```json
["EmailSubmission/set", {
  "accountId": "j",
  "create": {
    "sub1": {
      "identityId": "b",
      "emailId": "#draft1"
    }
  }
}, "c2"]
```

| Field | Value | Meaning |
|-------|-------|---------|
| `identityId` | `"b"` | Your sender identity ID (from service details) |
| `emailId` | `"#draft1"` | A back-reference — resolves to the email ID created in step 1 |

> The `#draft1` syntax is a JMAP **creation reference**. It automatically gets replaced with the actual email ID from the `Email/set` response. This is how the two steps are linked in a single request.

---

## The Response — What It Means

```json
{
  "methodResponses": [
    ["Email/set", {
      "accountId": "j",
      "oldState": "saa",
      "newState": "sam",
      "created": {
        "draft1": {
          "id": "eaaaaab",
          "threadId": "b",
          "blobId": "cagjaxd0mob...",
          "size": 383
        }
      }
    }, "c1"],
    ["EmailSubmission/set", {
      "accountId": "j",
      "newState": "saq",
      "created": {
        "sub1": {
          "id": "b"
        }
      }
    }, "c2"]
  ],
  "sessionState": "3e25b2a0"
}
```

### Reading the response

| Response Part | What it tells you |
|---------------|-------------------|
| `Email/set → created.draft1` | The email was successfully created. It got ID `eaaaaab`. |
| `EmailSubmission/set → created.sub1` | The email was successfully **submitted for delivery**. |
| No `"notCreated"` key | Nothing went wrong. If something fails, errors appear here. |

**If you see `"created"` in both responses → the email was sent.**

---

## How to Verify the Email Was Sent

### 1. Check the Sent mailbox via JMAP

Query for emails in your Sent folder:

```bash
curl -s http://localhost:1080/jmap/ \
  -u 'jd:jd' \
  -H 'Content-Type: application/json' \
  -d '{
    "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    "methodCalls": [
      ["Mailbox/get", {
        "accountId": "j",
        "properties": ["name", "role", "totalEmails"]
      }, "m1"]
    ]
  }' | python3 -m json.tool
```

Look for the mailbox with `"role": "sent"` — its `totalEmails` count tells you how many emails have been sent.

### 2. Fetch the actual sent email

Once you know the Sent mailbox ID (from the response above), list emails in it:

```bash
curl -s http://localhost:1080/jmap/ \
  -u 'jd:jd' \
  -H 'Content-Type: application/json' \
  -d '{
    "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    "methodCalls": [
      ["Email/query", {
        "accountId": "j",
        "filter": {"subject": "Hello from Codesphere!"},
        "sort": [{"property": "receivedAt", "isAscending": false}],
        "limit": 5
      }, "q1"],
      ["Email/get", {
        "accountId": "j",
        "#ids": {"resultOf": "q1", "name": "Email/query", "path": "/ids"},
        "properties": ["subject", "from", "to", "sentAt", "preview"]
      }, "g1"]
    ]
  }' | python3 -m json.tool
```

This searches for the email by subject and returns its details. You should see your sent email with the subject, sender, recipient, and a preview of the body.

### 3. Check via Webmail

Open http://localhost:1080/login in your browser, log in as `jd` / `jd`, and check the **Sent** folder.

### 4. Check Stalwart server logs

```bash
docker logs stalwart-mail 2>&1 | grep -i "queue\|deliver\|sent" | tail -20
```

This shows Stalwart's delivery queue activity. You'll see entries for outbound delivery attempts.

> **Note:** In local development, delivery to external addresses (like `recipient@example.com`) will fail because there's no real DNS or TLS. The email is still _sent_ from Stalwart's perspective — it just can't be _delivered_ to the outside world. To test end-to-end, send between two mailboxes on the same server (e.g. `jd@codesphere.com` → `alice@codesphere.com`).

---

## Quick Reference

| Value | Where it comes from | What it is |
|-------|-------------------|------------|
| `accountId: "j"` | `GET` service details → `jmap_account_id` | Your JMAP account |
| `identityId: "b"` | `GET` service details → `jmap_identity_id` | Your sender identity |
| `mailboxIds: {"d": true}` | `GET` service details → `jmap_drafts_mailbox_id` | Drafts folder |
| `#draft1` | You choose this label | Back-reference to email created in same request |

---

## Error Cases

| Symptom | Cause | Fix |
|---------|-------|-----|
| `401 Unauthorized` | Wrong username or password | Check `-u 'user:password'` |
| `"notCreated"` in Email/set | Invalid mailbox ID or account ID | Verify IDs from service details |
| `"notCreated"` in EmailSubmission/set | Invalid identity ID | Verify `identityId` from service details |
| Email created but not in Sent | Submission failed silently | Check for errors in the `EmailSubmission/set` response |
