import { esc, type RenderedMail } from './email-core';

/**
 * Advisor Call Booking — Cal.com API v2, RFC 5545 (.ics) Calendar Invites,
 * Google/Outlook Calendar Deep Links, and Transactional Invite/Cancel Emails.
 * Pure (no I/O) so every builder and template is unit-tested.
 */

export interface MeetingInviteInput {
  bookingId: string;
  topic: string;
  notes?: string;
  categoryLabel: string;
  scheduledAt: string;
  durationMin: number;
  meetingUrl: string;
  calComUrl?: string;
  calComBookingUid?: string;
  advisorName: string;
  advisorEmail: string;
  clientName: string;
  clientCompanyName: string;
  clientEmail: string;
  status?: 'scheduled' | 'canceled';
}

export interface BookingTimeWindow {
  startIso: string;
  endIso: string;
  startIcs: string;
  endIcs: string;
  humanLabel: string;
}

function toIcsTimestamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function parseBookingWindow(scheduledAt: string, durationMin = 45): BookingTimeWindow {
  const dur = Math.max(15, Math.min(240, Number(durationMin) || 45));
  let start = new Date(scheduledAt);
  if (Number.isNaN(start.getTime())) {
    // Fallback if a human-readable slot string was passed: schedule 24h out at 14:00 UTC
    const tomorrow = new Date(Date.now() + 86_400_000);
    tomorrow.setUTCHours(14, 0, 0, 0);
    start = tomorrow;
  }
  const end = new Date(start.getTime() + dur * 60_000);
  const humanLabel = `${start.toISOString().slice(0, 16).replace('T', ' ')} UTC (${dur} min)`;
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startIcs: toIcsTimestamp(start),
    endIcs: toIcsTimestamp(end),
    humanLabel,
  };
}

function escapeIcsText(raw: string): string {
  return String(raw ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Generates an RFC 5545 iCalendar (.ics) payload with METHOD:REQUEST (or METHOD:CANCEL)
 * so Gmail, Outlook, Apple Mail, and Fastmail render a native calendar invite card.
 */
export function buildMeetingIcs(input: MeetingInviteInput): string {
  const win = parseBookingWindow(input.scheduledAt, input.durationMin);
  const isCancel = input.status === 'canceled';
  const method = isCancel ? 'CANCEL' : 'REQUEST';
  const status = isCancel ? 'CANCELLED' : 'CONFIRMED';
  const summary = `${input.topic} — ${input.clientCompanyName} × ${input.advisorName}`;
  const description = [
    `Topic: ${input.topic}`,
    `Service: ${input.categoryLabel}`,
    `Client: ${input.clientCompanyName} (${input.clientEmail})`,
    `Advisor: ${input.advisorName} (${input.advisorEmail})`,
    ...(input.notes ? [`Notes: ${input.notes}`] : []),
    `Join Meeting: ${input.meetingUrl}`,
  ].join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Borga//Shared Services Calendar//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${input.bookingId}@borga.app`,
    `DTSTAMP:${win.startIcs}`,
    `DTSTART:${win.startIcs}`,
    `DTEND:${win.endIcs}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(input.meetingUrl)}`,
    `STATUS:${status}`,
    `SEQUENCE:${isCancel ? 1 : 0}`,
    `ORGANIZER;CN="${escapeIcsText(input.advisorName)}":mailto:${input.advisorEmail}`,
    `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN="${escapeIcsText(input.advisorName)}":mailto:${input.advisorEmail}`,
    ...(input.clientEmail
      ? [
          `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN="${escapeIcsText(input.clientCompanyName)}":mailto:${input.clientEmail}`,
        ]
      : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

export function buildIcsDataUrl(ics: string): string {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

export function buildGoogleCalendarUrl(input: MeetingInviteInput): string {
  const win = parseBookingWindow(input.scheduledAt, input.durationMin);
  const title = `${input.topic} (${input.clientCompanyName} × ${input.advisorName})`;
  const details = [
    `Advisor: ${input.advisorName} (${input.advisorEmail})`,
    `Client: ${input.clientCompanyName} (${input.clientEmail})`,
    ...(input.notes ? [`Notes: ${input.notes}`] : []),
    `Video Room: ${input.meetingUrl}`,
  ].join('\n');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${win.startIcs}/${win.endIcs}`,
    details,
    location: input.meetingUrl,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function buildOutlookCalendarUrl(input: MeetingInviteInput): string {
  const win = parseBookingWindow(input.scheduledAt, input.durationMin);
  const title = `${input.topic} (${input.clientCompanyName} × ${input.advisorName})`;
  const body = [
    `Advisor: ${input.advisorName} (${input.advisorEmail})`,
    `Client: ${input.clientCompanyName} (${input.clientEmail})`,
    ...(input.notes ? [`Notes: ${input.notes}`] : []),
    `Video Room: ${input.meetingUrl}`,
  ].join('\n');
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: title,
    startdt: win.startIso,
    enddt: win.endIso,
    body,
    location: input.meetingUrl,
  });
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}

// ── Cal.com Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────

export function normalizeCalComUrl(raw: string | undefined | null): string | undefined {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return undefined;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'https:') return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

export function buildCalComBookingPayload(input: {
  eventTypeId: number;
  scheduledAt: string;
  attendeeName: string;
  attendeeEmail: string;
  timeZone?: string;
  bookingId: string;
  topic: string;
  notes?: string;
}): Record<string, unknown> {
  const win = parseBookingWindow(input.scheduledAt, 45);
  return {
    start: win.startIso,
    eventTypeId: Math.round(Number(input.eventTypeId)),
    attendee: {
      name: input.attendeeName.trim() || 'Client',
      email: input.attendeeEmail.trim(),
      timeZone: input.timeZone || 'UTC',
      language: 'en',
    },
    metadata: {
      borgaBookingId: input.bookingId,
      topic: input.topic.slice(0, 200),
      ...(input.notes ? { notes: input.notes.slice(0, 500) } : {}),
    },
  };
}

export function parseCalComBookingResponse(raw: unknown): { uid?: string; meetingUrl?: string } {
  if (!raw || typeof raw !== 'object') return {};
  const data = ('data' in raw && raw.data && typeof raw.data === 'object' ? raw.data : raw) as Record<string, unknown>;
  const uid = typeof data.uid === 'string' ? data.uid : typeof data.id === 'string' ? data.id : undefined;
  const meetingUrl =
    typeof data.meetingUrl === 'string' && /^https?:\/\//i.test(data.meetingUrl)
      ? data.meetingUrl
      : typeof data.location === 'string' && /^https?:\/\//i.test(data.location)
        ? data.location
        : undefined;
  return { uid, meetingUrl };
}

// ── Editorial Meeting Invite & Cancellation Email Renderer ──────────────────────────────────────────────────────────

export function renderMeetingInviteEmail(
  input: MeetingInviteInput,
  recipientRole: 'advisor' | 'client',
): RenderedMail & { ics: string } {
  const win = parseBookingWindow(input.scheduledAt, input.durationMin);
  const isCancel = input.status === 'canceled';
  const ics = buildMeetingIcs(input);
  const googleUrl = buildGoogleCalendarUrl(input);
  const outlookUrl = buildOutlookCalendarUrl(input);

  const cleanTopic = input.topic.replace(/[\r\n]+/g, ' ').slice(0, 120);
  const subject = isCancel
    ? `Canceled: ${cleanTopic} (${input.clientCompanyName} × ${input.advisorName})`
    : `Meeting Invite: ${cleanTopic} (${input.clientCompanyName} × ${input.advisorName})`;

  const greetingName = recipientRole === 'advisor' ? input.advisorName : input.clientName || input.clientCompanyName;
  const intro = isCancel
    ? `The scheduled consultation between ${input.clientCompanyName} and ${input.advisorName} has been canceled.`
    : recipientRole === 'advisor'
      ? `${input.clientCompanyName} (${input.clientEmail}) booked a ${input.durationMin}-minute consultation with you on Borga Shared Services.`
      : `Your ${input.durationMin}-minute consultation with ${input.advisorName} (${input.advisorEmail}) is confirmed.`;

  const accent = isCancel ? '#e11d48' : '#0f172a';
  const badge = isCancel ? 'MEETING CANCELED' : 'MEETING INVITE';

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#f8fafc;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(intro)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-top:3px solid ${accent};border-radius:10px;overflow:hidden;">
<tr><td style="padding:18px 24px;border-bottom:1px solid #f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font-size:14px;font-weight:700;color:#0f172a;">Borga Shared Services</td>
    <td align="right"><span style="display:inline-block;padding:3px 8px;border-radius:4px;background:#f1f5f9;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;font-weight:600;color:${accent};">${badge}</span></td>
  </tr></table>
</td></tr>
<tr><td style="padding:24px;">
  <h1 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#0f172a;">Hi ${esc(greetingName)},</h1>
  <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#475569;">${esc(intro)}</p>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:18px;">
    <tr>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;">Topic</td>
      <td align="right" style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600;color:#0f172a;">${esc(input.topic)}</td>
    </tr>
    <tr>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;">When</td>
      <td align="right" style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:600;color:#0f172a;">${esc(win.humanLabel)}</td>
    </tr>
    <tr>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;">Advisor / Agency</td>
      <td align="right" style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a;">${esc(input.advisorName)} (${esc(input.advisorEmail)})</td>
    </tr>
    <tr>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;">Client Company</td>
      <td align="right" style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a;">${esc(input.clientCompanyName)} (${esc(input.clientEmail)})</td>
    </tr>
    <tr>
      <td style="padding:9px 12px;font-size:12px;color:#64748b;">Service Category</td>
      <td align="right" style="padding:9px 12px;font-size:13px;color:#0f172a;">${esc(input.categoryLabel)}</td>
    </tr>
  </table>

  ${input.notes ? `<p style="margin:0 0 18px;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;line-height:1.55;color:#334155;"><strong>Notes:</strong> ${esc(input.notes)}</p>` : ''}

  ${
    !isCancel
      ? `<p style="margin:20px 0 12px;">
          <a href="${esc(input.meetingUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;font-size:13px;padding:10px 18px;border-radius:6px;">Join Video Meeting &rarr;</a>
          ${input.calComUrl ? `<a href="${esc(input.calComUrl)}" style="display:inline-block;margin-left:8px;background:#f1f5f9;color:#0f172a;text-decoration:none;font-weight:600;font-size:13px;padding:10px 16px;border-radius:6px;border:1px solid #cbd5e1;">Cal.com Room</a>` : ''}
        </p>
        <p style="margin:12px 0 0;font-size:12px;color:#64748b;">
          Add to calendar:
          <a href="${esc(googleUrl)}" style="color:#0f172a;font-weight:600;text-decoration:underline;margin-left:6px;">Google Calendar</a>
          &middot;
          <a href="${esc(outlookUrl)}" style="color:#0f172a;font-weight:600;text-decoration:underline;margin-left:4px;">Outlook</a>
          (or open the attached <code>invite.ics</code> file)
        </p>`
      : ''
  }
</td></tr>
<tr><td style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.5;color:#64748b;">Sent via <strong>Borga Shared Services</strong> &middot; Reference ${esc(input.bookingId)}.</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `Borga Shared Services — ${badge}`,
    '',
    `Hi ${greetingName},`,
    intro,
    '',
    `Topic: ${input.topic}`,
    `When: ${win.humanLabel}`,
    `Advisor: ${input.advisorName} (${input.advisorEmail})`,
    `Client: ${input.clientCompanyName} (${input.clientEmail})`,
    `Category: ${input.categoryLabel}`,
    ...(input.notes ? [`Notes: ${input.notes}`] : []),
    ...(!isCancel
      ? [
          '',
          `Join Video Meeting: ${input.meetingUrl}`,
          ...(input.calComUrl ? [`Cal.com Link: ${input.calComUrl}`] : []),
          `Google Calendar: ${googleUrl}`,
          `Outlook Calendar: ${outlookUrl}`,
        ]
      : []),
  ].join('\n');

  return { subject, html, text, ics };
}
