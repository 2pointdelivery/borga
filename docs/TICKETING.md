# Support Desk (tickets, SLA, linked mailbox)

Jira-service-desk style ticketing inside Borga: **Support Desk** in the sidebar (feature flag `tickets`).
Modelled on the ticket features of [devaslanphp/project-management](https://github.com/devaslanphp/project-management)
(statuses, priorities, types, assignment, time logging, project link, email notifications) with real SLA timers added.

## What it does

| Area | Behaviour |
|---|---|
| Tickets | Key `SUP-n` (prefix configurable), type (incident/request/bug/task/question), priority (critical/high/medium/low), assignee (HR directory), labels, project link, time logging, audit trail |
| Workflow | `open → in-progress → pending customer → resolved → closed`, validated server-side (`TRANSITIONS` in `lib/borga/tickets.ts`); reopening counts `reopenCount` |
| Views | List with filters/search, drag-and-drop board, detail sheet with threaded conversation |
| SLA | Policies with first-response + resolution targets per priority, business-hours or 24x7, UTC-offset working calendar. The clock **pauses while status = pending**. States: on track / at risk (75%) / breached / met / met late. Breach and at-risk crossings notify once (audit comment + in-app notice + optional escalation email) |
| Mailbox | Inbound: webhook **or** IMAP polling. Outbound: SMTP with `In-Reply-To`/`References` and `[SUP-n]` in the subject, so a customer's Reply lands back in the same ticket |
| Safety | Message-ID dedupe, bounce/auto-reply/list-mail filtering, own-address loop guard, per-sender new-ticket rate limit, subject-token matches only accepted from the requester or known participants, quoted history stripped, bodies rendered as text |

## Architecture

```
lib/borga/tickets.ts          pure model + SLA engine (shared by browser and server, unit-tested)
lib/borga/tickets-server.ts   storage, ingest, outbound mail, IMAP poll, SLA sweep
app/api/borga/tickets         session-authed JSON API (list/get/create/update/comment/settings/poll/sweep)
app/api/borga/tickets/inbound token-authed public endpoint for mail bridges (exempt from cookie auth in proxy.ts)
app/api/borga/cron            also polls IMAP + sweeps SLA for every workspace with tickets
components/borga/pages/SupportPage.tsx  + panels/TicketsTab, TicketSettingsTab, TicketDetailSheet, ticket-bits
```

Storage: one `borga_state` row per ticket under `t::<user>::<ws>::tk::<KEY>`. It is kept out of the `u::` keyspace so the
dashboard's bulk hydrate never loads tickets, and edits to different tickets cannot overwrite each other. Ticket numbers
are allocated with an atomic insert-if-absent. The server is the only writer; the UI polls every 20 s.

## Linking a mailbox

Support Desk → **SLA & Mailbox**. SMTP for replies is the existing one (Integrations → AI & Voice → `SMTP_*`, `EMAIL_FROM`).

**Option A: IMAP pull** (Gmail/Outlook/Zoho/any host; use an app password). Fill host/user/password, enable, *Save all*,
then *Check mailbox now*. The scheduler (`POST /api/borga/cron`, every 5 min) polls automatically. Unseen mails are
processed and marked seen (max 25 per poll).

**Option B: webhook push** (instant, nothing polling). POST to the *Inbound URL* shown in settings with
`Authorization: Bearer <token>`. Generic JSON: `{from, fromName, subject, text, html, messageId, inReplyTo, references[], headers{}}`.
Postmark inbound JSON and Mailgun routes (form-encoded) are also understood. A free option is Cloudflare Email Routing:

```js
// Cloudflare Email Worker (Email Routing -> "Send to a Worker")
import PostalMime from 'postal-mime';
export default {
  async email(message, env) {
    const m = await PostalMime.parse(message.raw);
    await fetch(env.BORGA_INBOUND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.BORGA_INBOUND_TOKEN}` },
      body: JSON.stringify({
        from: m.from.address, fromName: m.from.name, subject: m.subject, text: m.text, html: m.html,
        messageId: m.messageId, inReplyTo: m.inReplyTo, references: (m.references || '').split(/\s+/).filter(Boolean),
        headers: Object.fromEntries(m.headers.map((h) => [h.key, h.value])),
      }),
    });
  },
};
```

## Wiring plan (status)

1. ✅ Domain model + SLA engine + tests (`lib/tickets.test.ts`, 10 cases)
2. ✅ Persistence, API, inbound/outbound mail, IMAP, SLA sweep, cron hook
3. ✅ UI: list, board, detail, settings; nav entry; feature flag; command palette
4. ✅ Verified locally against MySQL: create, transitions, threading by token and by header, dedupe, loop/bounce guards, hijack guard, feature 404, auth
5. ✅ IMAP polling verified against a local IMAP server (unseen mail fetched, bounce ignored, marked seen, no re-fetch; bad password gives a readable error)
6. ✅ SMTP replies verified against a local SMTP sink (From/Reply-To, `[SUP-n]` subject token, In-Reply-To/References chain, `Auto-Submitted` on the auto-ack), and a customer reply to that email re-threads and reopens the ticket. Still worth one smoke test against your real provider (TLS, provider quirks)
7. ✅ Agent tools `list_tickets`, `create_ticket`, `update_ticket`, `draft_ticket_reply` in `lib/borga/tools.ts`. Agents cannot email customers: a reply is saved as an internal DRAFT note for a human to send
8. ⬜ Attachments (inbound parts are currently dropped), canned responses, customer CSAT, holiday calendars, per-agent roles
9. ⬜ Link tickets to Customers (`customerId` field exists, no UI yet) and surface SLA breaches on the Command Center
