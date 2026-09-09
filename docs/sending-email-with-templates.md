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
- [Newsletters (bulk send)](#newsletters-bulk-send)
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

Images are delivered as **hosted URLs** — at send time each template `<img>` is
rewritten to an absolute URL on the `/assets/t/<mailbox>/<assetId>` route that
the recipient's mail client fetches over HTTPS.

> **Prod setup — the image host must not require a Cloudflare Access login.**
> Two ways:
>
> 1. **Dedicated host (recommended).** Add a second Workers custom domain, e.g.
>    `img.example.com`, pointed at this Worker, and **do not** put it in any
>    Access application. Set `ASSET_URL` to `https://img.example.com`. The
>    Worker serves only `/assets/t/*` on that host (everything else 404s), so
>    the app/API is not exposed there.
> 2. **Bypass the path on the main host.** Add `/assets/t/*` as a **Bypass**
>    policy (a separate path-scoped Access application). Fiddly — the path must
>    be its own field and beat the main app's path specificity.
>
> Also set `PUBLIC_URL` to the deployment origin. Resolution order for image
> `<src>`: `ASSET_URL` → `PUBLIC_URL` → the request's origin (REST only; MCP
> sends have no request, so they need one of the vars set).

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
`<img src="<ASSET_URL|PUBLIC_URL>/assets/t/<mailbox>/<assetId>">`. An
`<img src="…/templates/assets/<id>">` URL (the in‑app, Access‑gated one used
for editor previews) is also recognized and rewritten. Images inside a
placeholder value that point at an **external** `https://` URL are left as‑is.

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
3. Rewrite template‑managed images (`data-asset-id` / in‑app asset URLs) to
   absolute `/assets/t/...` URLs.
4. Send. AI "draft verification" is **skipped** for template sends (it would
   flatten the HTML), so template markup and images are preserved exactly.

---

## Newsletters (bulk send)

Send a template (or a plain `{{token}}` message) to a CSV of recipients — now or
at a scheduled time. Sends run in a **background alarm loop** at
`NEWSLETTER_BATCH_SIZE` per `NEWSLETTER_INTERVAL_SECONDS` (default 20 / 60s ≈
1,200/hr), separate from the interactive send limit. Newsletter sends are **not**
written to the Sent folder — progress lives on the job.

### CSV

- Must have an **`email`** column (case-insensitive).
- If `template_id` is set, **every** placeholder (declared keys ∪ `{{tokens}}` in
  subject/body) must be a column. Extra columns are ignored.
- Missing a required column → the whole upload is rejected.
- Rows with a blank/invalid email are skipped; duplicate emails
  (case-insensitive) are de-duped. Both are reported.
- Max 20,000 recipients.

### Routes (`/api/v1/mailboxes/{mailboxId}`)

| Method | Path | |
|---|---|---|
| POST | `/newsletters/validate` | `{ csv, template_id? }` → dry-run summary (`missingKeys`, `validCount`, `skippedInvalid`, `duplicatesRemoved`, …) |
| POST | `/newsletters` | `{ name, csv, template_id?, subject?, body?, from_name?, reply_to?, scheduled_at? }` → creates a `draft` (`scheduled_at` is ISO; omit for "send on start") |
| POST | `/newsletters/{id}/start` | `draft`/`paused` → `sending` now, or `scheduled` if `scheduled_at` is in the future |
| POST | `/newsletters/{id}/pause` · `/resume` · `/cancel` | state transitions |
| GET | `/newsletters` · `/newsletters/{id}` | list / detail (`sent`, `failed`, `total`, `failedRecipients[]`) |
| DELETE | `/newsletters/{id}` | when not `sending` |

```bash
# validate
curl -s -X POST "$HOST/api/v1/mailboxes/team%40example.com/newsletters/validate" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "$(jq -Rs '{csv: ., template_id: "8f3c…"}' < recipients.csv)"

# create + start
NL=$(curl -s -X POST "$HOST/api/v1/mailboxes/team%40example.com/newsletters" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "$(jq -Rs '{name:"October", csv:., template_id:"8f3c…"}' < recipients.csv)")
ID=$(echo "$NL" | jq -r .newsletter.id)
curl -s -X POST "$HOST/api/v1/mailboxes/team%40example.com/newsletters/$ID/start" -H "$AUTH"
```

Per recipient the row's columns become the template's placeholder values, the
template renders, images are hosted (as above), and it's sent from the mailbox
(`from_name` / `reply_to` optional). Only `template_id` sends skip AI
verification.

### UI

**Send Newsletter** in the sidebar → upload CSV → validation summary → **Send
now** / **Schedule** → watch the progress meter and failed-recipient list.

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
