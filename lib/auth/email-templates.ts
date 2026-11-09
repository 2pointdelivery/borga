import { renderTransactional, type RenderedMail } from '@/lib/borga/email-core';

/**
 * The account emails: password reset, password changed, welcome, invitation. Pure (no I/O) so each is unit-tested.
 * Names that come from people are plain text here: every value is HTML-escaped by the layout and line breaks are removed from
 * anything that ends up in a subject, so a hostile name cannot add headers or markup.
 */

const BRAND = 'Borga';
const ACCENT = '#6366f1';
const oneLine = (v: unknown, n = 60) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const hello = (name: string) => (oneLine(name) ? `Hi ${oneLine(name)},` : 'Hi,');

export function renderPasswordReset(o: { name: string; resetUrl: string; ttlMinutes?: number }): RenderedMail {
  const minutes = o.ttlMinutes ?? 60;
  const when = minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} minutes`;
  const r = renderTransactional({
    brand: BRAND, accent: ACCENT,
    preheader: `Choose a new password. The link works for ${when}.`,
    title: 'Reset your password',
    paragraphs: [`${hello(o.name)} we received a request to reset the password for your Borga account.`, `The link below works for ${when} and can be used once.`],
    cta: { label: 'Choose a new password', url: o.resetUrl },
    note: 'If you did not ask for this, ignore this email: your password stays as it is. If you keep getting these, someone may be typing your address by mistake.',
    reason: 'You are getting this because a password reset was requested for this email address on Borga.',
  });
  return { subject: 'Reset your Borga password', ...r };
}

export function renderPasswordChanged(o: { name: string; signInUrl: string }): RenderedMail {
  const r = renderTransactional({
    brand: BRAND, accent: ACCENT,
    preheader: 'Your password was changed and every device was signed out.',
    title: 'Your password was changed',
    paragraphs: [`${hello(o.name)} the password for your Borga account was just changed, and every device that was signed in has been signed out.`, 'If this was you, there is nothing more to do.'],
    cta: { label: 'Sign in', url: o.signInUrl },
    note: 'If this was not you, reset your password again right away from the sign-in page and tell your administrator.',
    reason: 'This is a security notice about your Borga account. It is sent whenever a password changes.',
  });
  return { subject: 'Your Borga password was changed', ...r };
}

export function renderWelcome(o: { name: string; companyName: string; appUrl: string }): RenderedMail {
  const company = oneLine(o.companyName, 80) || 'your company';
  const r = renderTransactional({
    brand: BRAND, accent: ACCENT,
    preheader: `${company} is ready. Here is where to start.`,
    title: 'Welcome to Borga',
    paragraphs: [`${hello(o.name)} your workspace for ${company} is ready.`, 'A good first ten minutes: finish the short company setup, connect the tools you already use under Integrations, and ask the assistant what needs attention.'],
    cta: { label: 'Open your workspace', url: o.appUrl },
    reason: 'You are getting this one-time message because you just created a Borga account.',
  });
  return { subject: `Welcome to Borga, ${oneLine(o.name, 40) || 'and thanks for joining'}`, ...r };
}

export function renderInvite(o: { inviteeEmail: string; inviterName?: string; signupUrl: string; expiresDays: number }): RenderedMail {
  const by = oneLine(o.inviterName ?? '') || 'The administrator';
  const r = renderTransactional({
    brand: BRAND, accent: ACCENT,
    preheader: `${by} invited you to Borga. The invitation works for ${o.expiresDays} days.`,
    title: 'You are invited to Borga',
    paragraphs: [`${by} invited ${oneLine(o.inviteeEmail, 100)} to create a Borga account.`, `The invitation can be used once and expires in ${o.expiresDays} days.`],
    cta: { label: 'Create your account', url: o.signupUrl },
    note: 'If you were not expecting this, you can ignore it. No account is created until you use the link.',
    reason: 'You are getting this because someone entered your email address to invite you to Borga.',
  });
  return { subject: 'You are invited to Borga', ...r };
}
