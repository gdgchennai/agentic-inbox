# Sending email with templates (API & MCP)

Templates are reusable, per‑mailbox HTML email layouts with `{{placeholder}}`
tokens and inline images. This guide covers creating them and sending mail from
them over the REST API and MCP. For the UI, see **Templates** in the app sidebar.

- [Authentication](#authentication)
- [Template model](#template-model)
- [Managing templates](#managing-templates-rest)
- [Uploading images](#uploading-images)
- [Sending with a template](#sending-with-a-template-rest)
- [Replies and forwards](#replies-and-forwards)
- [How rendering works](#how-rendering-works)
- [MCP](#mcp)
- [Errors](#errors)

---

## Authentication

Templates use the same trust boundary as the rest of the app — **Cloudflare
Access**. In production every request needs a valid Access identity:

- **Service token** (for scripts / servers): send
  `CF-Access-Client-Id: <id>.access` and `CF-Access-Client-Secret: <secret>`
  headers, backed by a **Service Auth** policy on the Access application.
- **Local dev** (`npm run dev`): Access is bypassed — no headers needed.

There is no per‑mailbox authorization: any caller past Access can operate on any
mailbox by its address. Template bodies and placeholder values are treated as
trusted HTML (not server‑side sanitized).

All paths below are relative to your deployment host, e.g.
`https://mail.example.com`. `{mailboxId}` is the mailbox email address
(URL‑encode the `@` as `%40` if your client is strict).

---

## Template model

```jsonc
{
  "id": "8f3c…",                     // assigned on create
  "name": "Event announcement",       // required
  "subject": "{{event}} — you're invited",
  "body": "<h1>Hi {{first_name}}</h1><p>…</p>{{cta}}",
  "placeholders": [
    { "key": "first_name", "label": "First name", "type": "text", "default": "there" },
    { "key": "event",      "label": "Event",      "type": "text" },
    { "key": "cta",        "label": "CTA block",  "type": "html",
      "default": "<a href=\"https://example.com\">RSVP</a>" }
  ],
  "created_at": "2026-09-09T…",
  "updated_at": "2026-09-09T…"
}
```

Placeholder fields:

| field     | required | notes |
|-----------|----------|-------|
| `key`     | yes      | matches the `{{key}}` token in `subject` / `body` |
| `label`   | no       | shown in the composer UI |
| `type`    | no       | `text` (default) → HTML‑escaped on render; `html` → inserted verbatim (small fragments like `<p>`, `<a>`, `<img>`) |
| `default` | no       | used when the caller supplies no value for the key |

---

## Managing templates (REST)

| Method   | Path | |
|----------|------|-|
| `GET`    | `/api/v1/mailboxes/{mailboxId}/templates` | list |
| `POST`   | `/api/v1/mailboxes/{mailboxId}/templates` | create → `201` + template |
| `GET`    | `/api/v1/mailboxes/{mailboxId}/templates/{id}` | one |
| `PUT`    | `/api/v1/mailboxes/{mailboxId}/templates/{id}` | update (any subset of fields) |
| `DELETE` | `/api/v1/mailboxes/{mailboxId}/templates/{id}` | `204` — also deletes its images |

### Create

```bash
curl -s -X POST \
  "$HOST/api/v1/mailboxes/team%40example.com/templates" \
  -H "CF-Access-Client-Id: $CF_ID" -H "CF-Access-Client-Secret: $CF_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Event announcement",
    "subject": "{{event}} — you'\''re invited",
    "body": "<h1>Hi {{first_name}}</h1><p>Join us for {{event}}.</p>{{cta}}",
    "placeholders": [
      { "key": "first_name", "type": "text", "default": "there" },
      { "key": "event",      "type": "text" },
      { "key": "cta",        "type": "html", "default": "<a href=\"https://example.com\">RSVP</a>" }
    ]
  }'
```

`POST` body schema: `name` (required), `subject?`, `body?`, `placeholders?`,
`assetIds?` (string[] — link previously uploaded images). `PUT` accepts the same
fields, all optional.

---

## Uploading images

Images are delivered as **inline CID attachments** so they render in every mail
client with no external fetch (the app sits behind Access, so hosted image URLs
would not load for recipients).

**1. Upload the file** (base64, JSON body):

```bash
curl -s -X POST \
  "$HOST/api/v1/mailboxes/team%40example.com/templates/assets" \
  -H "CF-Access-Client-Id: $CF_ID" -H "CF-Access-Client-Secret: $CF_SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"$(base64 -w0 banner.png)\",\"filename\":\"banner.png\",\"type\":\"image/png\"}"
```

Response:

```json
{ "id": "1b2c…", "contentId": "tpl-1b2c…", "url": "/api/v1/mailboxes/team@example.com/templates/assets/1b2c…" }
```

**2. Reference it in the template body** by the asset `id`:

```html
<img data-asset-id="1b2c…" alt="Banner">
```

At send time the Worker replaces that `<img>` with
`<img src="cid:<assetId>@<mailbox-domain>">` and attaches the image inline
(`Content-ID: <<assetId>@<mailbox-domain>>`). An
`<img src="…/templates/assets/<id>">` URL is also recognized. Images inside a
placeholder value that point at an **external** `https://` URL are left as‑is
(hosted).

Other asset routes: `GET .../templates/assets/{assetId}` (raw bytes, for
previews), `DELETE .../templates/assets/{assetId}` (`204`).

---

## Sending with a template (REST)

`POST /api/v1/mailboxes/{mailboxId}/emails`

Add two optional fields to the normal send body:

| field          | type | notes |
|----------------|------|-------|
| `template_id`  | string | the template to render as the body |
| `placeholders` | object | `{ "<key>": "<value>" }` — values may be plain text or small HTML fragments |

```bash
curl -s -X POST \
  "$HOST/api/v1/mailboxes/team%40example.com/emails" \
  -H "CF-Access-Client-Id: $CF_ID" -H "CF-Access-Client-Secret: $CF_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "from": { "email": "team@example.com", "name": "Team" },
    "to": "sam@example.org",
    "template_id": "8f3c…",
    "placeholders": {
      "first_name": "Sam",
      "event": "DevFest 2026",
      "cta": "<a href=\"https://example.com/rsvp\">Reserve your seat</a>"
    }
  }'
```

- `from.email` **must equal** `{mailboxId}` and its domain must be a configured
  `DOMAINS` entry.
- `subject` is optional. If you send a non‑empty `subject` it **overrides** the
  template's rendered subject; otherwise the template subject is used.
- When `template_id` is set, any `html` / `text` you send is **ignored** for the
  body — the template owns it. `text` is derived automatically from the rendered
  HTML.
- `cc` / `bcc` (string or array), `in_reply_to`, `references`, `thread_id`, and
  request‑level `attachments` still work and are merged with the template's
  inline images.

Success: `202 { "id": "<messageId>", "status": "sent" }`. Delivery happens
asynchronously after the response. The rendered HTML is stored in the Sent
folder.

---

## Replies and forwards

Same `template_id` + `placeholders` fields on:

- `POST /api/v1/mailboxes/{mailboxId}/emails/{id}/reply`
- `POST /api/v1/mailboxes/{mailboxId}/emails/{id}/forward`

```bash
curl -s -X POST \
  "$HOST/api/v1/mailboxes/team%40example.com/emails/<originalId>/reply" \
  -H "CF-Access-Client-Id: $CF_ID" -H "CF-Access-Client-Secret: $CF_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "from": { "email": "team@example.com", "name": "Team" },
    "to": "sam@example.org",
    "template_id": "8f3c…",
    "placeholders": { "first_name": "Sam" }
  }'
```

Threading headers (`In-Reply-To`, `References`) are set from the original
message automatically. The REST reply path sends the rendered template as the
body without appending a quoted original.

---

## How rendering works

1. Load the template for `{mailboxId}`; `404` if it does not exist.
2. Substitute every `{{key}}` in `subject` and `body`:
   value = supplied `placeholders[key]` → placeholder `default` → `""`.
   `text` placeholders are HTML‑escaped; `html` placeholders inserted raw.
   Tokens with no matching placeholder definition are treated as `text`.
3. Inline template‑managed images (`data-asset-id` / asset URLs) as `cid:`
   attachments.
4. Send. AI "draft verification" is **skipped** for template sends (it would
   flatten the HTML), so template markup and images are preserved exactly.

---

## MCP

Connect to `/mcp` (same Access auth). Template tools:

| Tool | Args |
|------|------|
| `list_templates` | `mailboxId` |
| `get_template`   | `mailboxId`, `templateId` — returns body + placeholder defs |

`templateId` + `placeholders` are also accepted on the send / draft tools:
`send_email`, `send_reply`, `create_draft`, `draft_reply`. When set, `bodyHtml`
is ignored and draft verification is skipped.

```jsonc
// send_email
{
  "mailboxId": "team@example.com",
  "to": "sam@example.org",
  "subject": "",                       // empty → use template subject
  "templateId": "8f3c…",
  "placeholders": { "first_name": "Sam", "event": "DevFest 2026" }
}
```

The AI agent has the same `list_templates` / `get_template` tools and accepts
`templateId` + `placeholders` on `draft_email` / `draft_reply`.

---

## Errors

| Status | Meaning |
|--------|---------|
| `400`  | `from` doesn't match the mailbox, or invalid body |
| `403`  | missing / invalid Cloudflare Access identity |
| `404`  | mailbox or `template_id` not found |
| `429`  | mailbox send rate limit (20/hour, 100/day) |
