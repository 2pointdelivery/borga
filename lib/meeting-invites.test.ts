import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCalComBookingPayload,
  buildGoogleCalendarUrl,
  buildMeetingIcs,
  buildOutlookCalendarUrl,
  normalizeCalComUrl,
  parseBookingWindow,
  parseCalComBookingResponse,
  renderMeetingInviteEmail,
  type MeetingInviteInput,
} from './borga/meeting-invites';

const sampleInvite: MeetingInviteInput = {
  bookingId: 'bk-101',
  topic: 'Q4 Tax & Bookkeeping Kickoff',
  notes: 'Please review Q3 trial balance beforehand.',
  categoryLabel: 'Accounting & Bookkeeping',
  scheduledAt: '2026-10-25T15:00:00Z',
  durationMin: 45,
  meetingUrl: 'https://meet.jit.si/borga-bk-101',
  calComUrl: 'https://cal.com/apex-cpa/45min',
  advisorName: 'Apex CPA',
  advisorEmail: 'cpa@apex.com',
  clientName: 'Ama Mensah',
  clientCompanyName: 'Lattis Labs',
  clientEmail: 'ama@lattis.io',
};

test('parseBookingWindow computes start and end timestamps in ISO and RFC 5545 ICS format', () => {
  const win = parseBookingWindow('2026-10-25T15:00:00Z', 45);
  assert.equal(win.startIso, '2026-10-25T15:00:00.000Z');
  assert.equal(win.endIso, '2026-10-25T15:45:00.000Z');
  assert.equal(win.startIcs, '20261025T150000Z');
  assert.equal(win.endIcs, '20261025T154500Z');
});

test('buildMeetingIcs produces valid RFC 5545 VCALENDAR with REQUEST and CANCEL methods', () => {
  const reqIcs = buildMeetingIcs(sampleInvite);
  assert.ok(reqIcs.includes('BEGIN:VCALENDAR'));
  assert.ok(reqIcs.includes('METHOD:REQUEST'));
  assert.ok(reqIcs.includes('STATUS:CONFIRMED'));
  assert.ok(reqIcs.includes('UID:bk-101@borga.app'));
  assert.ok(reqIcs.includes('mailto:cpa@apex.com'));
  assert.ok(reqIcs.includes('mailto:ama@lattis.io'));

  const cancelIcs = buildMeetingIcs({ ...sampleInvite, status: 'canceled' });
  assert.ok(cancelIcs.includes('METHOD:CANCEL'));
  assert.ok(cancelIcs.includes('STATUS:CANCELLED'));
});

test('renderMeetingInviteEmail renders HTML, text, Google/Outlook links, and escapes hostile input', () => {
  const advisorMail = renderMeetingInviteEmail(
    { ...sampleInvite, topic: 'Tax <script>alert(1)</script>' },
    'advisor',
  );
  assert.ok(advisorMail.subject.startsWith('Meeting Invite: Tax'));
  assert.ok(!advisorMail.html.includes('<script>'));
  assert.ok(advisorMail.html.includes('https://meet.jit.si/borga-bk-101'));
  assert.ok(advisorMail.html.includes('calendar.google.com'));
  assert.ok(advisorMail.html.includes('outlook.office.com'));
  assert.ok(advisorMail.text.includes('Join Video Meeting: https://meet.jit.si/borga-bk-101'));

  assert.ok(buildGoogleCalendarUrl(sampleInvite).startsWith('https://calendar.google.com/calendar/render?'));
  assert.ok(buildOutlookCalendarUrl(sampleInvite).startsWith('https://outlook.office.com/calendar/0/deeplink/compose?'));
});

test('Cal.com helpers normalize URLs, build v2 booking payloads, and parse responses', () => {
  assert.equal(normalizeCalComUrl('cal.com/apex-cpa/30min'), 'https://cal.com/apex-cpa/30min');
  assert.equal(normalizeCalComUrl('javascript:alert(1)'), undefined);

  const payload = buildCalComBookingPayload({
    eventTypeId: 12345,
    scheduledAt: '2026-10-25T15:00:00Z',
    attendeeName: 'Ama Mensah',
    attendeeEmail: 'ama@lattis.io',
    bookingId: 'bk-101',
    topic: 'Q4 Tax',
  });
  assert.equal(payload.eventTypeId, 12345);

  const parsed = parseCalComBookingResponse({
    status: 'success',
    data: { uid: 'cal-uid-99', meetingUrl: 'https://app.cal.com/video/cal-uid-99' },
  });
  assert.equal(parsed.uid, 'cal-uid-99');
  assert.equal(parsed.meetingUrl, 'https://app.cal.com/video/cal-uid-99');
});
