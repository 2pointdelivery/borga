# Email updates (per-workspace transactional emails)

Settings → **Email updates** (feature flag `emailUpdates`). Each company workspace has its own recipients, event switches and digest schedule; companies on the same account never share them. **Nothing is sent until the company turns it on** (and SMTP is configured).

## Setup
1. Configure outgoing SMTP once for the deployment (Integrations → AI & Voice, or `SMTP_*` + `EMAIL_FROM` env). Mail goes out as `"<Company> via Borga" <EMAIL_FROM address>`, with Reply-To set to the company's email or the address you choose.
2. Settings → Email updates → switch on (the account owner is added as the first recipient), add teammates, press **Send test email**.
3. Set `APP_URL` (or save the settings once from the browser) so emails can link back to Borga and carry unsubscribe links.

## What is sent
| Email | Trigger | Raised by |
|---|---|---|
| Approval needed | An agent/automation holds an action for sign-off, or one is created in the UI | server (agents) and browser |
| Support SLA breached | A ticket misses a response/resolution target (one email per ticket per sweep) | server (cron/ticket list) |
| New support ticket by email | A customer email opens a ticket | server |
| Recurring invoices drafted / bills recorded | Scheduled billing ran | browser (when the dashboard is open) |
| Urgent agent alert | A scheduled agent check is flagged urgent | server (heartbeat) |
| Digest (daily or Mondays) | Company-local hour reached; skipped when nothing needs attention (optional) | cron, every 15 min check |

The digest lists pending approvals, overdue invoices, bills overdue or due within 7 days, support status (open / SLA breached / at risk / unassigned) and this month's recorded revenue and expenses.

## Guarantees
- **Per workspace**: recipients, switches, schedule, delivery log and duplicate-suppression are all scoped to one company.
- **No duplicates**: one email per approval id, per ticket+clock, per batch of recurring numbers, and one digest per company-local day/week. A failed send releases the claim so it is retried.
- **Rate cap**: at most 30 emails per workspace per hour.
- **Safe content**: every dynamic value is HTML-escaped; subjects cannot carry line breaks (no header injection); each message has a plain-text part.
- **Unsubscribe**: each recipient gets a signed link (and `List-Unsubscribe` / one-click headers). It removes that address from that company only. Invalid or altered links are rejected.
- **Never blocks work**: sending is fire-and-forget and non-throwing; a mail failure cannot break a ticket, approval or run.
- Emails are internal notifications for your team. They contain no secrets, and customer replies are not sent from here (ticket replies use the Support Desk).

## Limits (be aware)
- SMTP is one deployment-wide sender, not one mailbox per company (only the display name and Reply-To are per company). Use SPF/DKIM for your sending domain to stay out of spam folders.
- Browser-raised events (recurring billing, approvals created in the UI) only fire while someone has Borga open. Agent approvals, SLA breaches, new tickets and the digest are server-side and do not need a browser.
- There is no bounce processing yet; failures are visible in "Recent emails".

## Verification
Unit tests (`lib/email.test.ts`: escaping/injection, token tamper-proofing, digest model and timezone/period logic) and an end-to-end run against a local SMTP sink: defaults off, owner auto-added, test email headers, approval/recurring events, duplicate and muted-event suppression, browser cannot trigger server-only events, digest sections, scheduled digest once per day, quiet-day skip, new-ticket and SLA emails, unsubscribe (link, one-click, tampered), isolation between two companies, unauthenticated access. Not yet run through a real mail provider.
