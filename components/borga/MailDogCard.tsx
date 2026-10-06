'use client';

import { ExternalLink, Mail } from 'lucide-react';
import { MAILDOG_HOST, MAILDOG_URL } from '@/lib/borga/maildog';

/**
 * A pointer for anyone without a mail server: MailDog gives a company its own email address and the SMTP details to send from it.
 * Shown where email is set up (Integrations, the company's mail server form, and the onboarding email step).
 */
export function MailDogCard({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Mail className="h-3.5 w-3.5" /></span>
        <div className="min-w-0">
          <p className="text-xs font-semibold">No email account or mail server yet? Get one with MailDog</p>
          {!compact && (
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              Create a MailDog account to get your own email address and its SMTP details (server {MAILDOG_HOST}, port 587, your user name and password), with a sending domain that is already set up. Then enter them under Integrations → Connections → Email, or here when you set up your company.
            </p>
          )}
        </div>
      </div>
      <a
        href={MAILDOG_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        Create a MailDog account <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
