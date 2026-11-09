'use client';

import { ArrowUpRight, Settings2 } from 'lucide-react';
import {
  CONFIG_DEEP_LINKS,
  detectConfigTargetFromText,
  openConfigDeepLink,
  type ConfigTargetId,
} from '@/lib/borga/config-deeplink';
import { cn } from '@/lib/utils';

export function ConfigDeepLinkButton({
  target,
  label,
  className,
  variant = 'pill',
}: {
  target: ConfigTargetId;
  label?: string;
  className?: string;
  variant?: 'pill' | 'inline' | 'button';
}) {
  const def = CONFIG_DEEP_LINKS[target];
  const text = label ?? def?.label ?? 'Configure now';

  if (variant === 'inline') {
    return (
      <button
        type="button"
        onClick={() => openConfigDeepLink(target)}
        className={cn(
          'inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2 transition-colors hover:text-primary/80',
          className,
        )}
      >
        <span>{text}</span>
        <ArrowUpRight className="h-3 w-3 shrink-0" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => openConfigDeepLink(target)}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15',
        className,
      )}
    >
      <Settings2 className="h-3 w-3 shrink-0" />
      <span>{text}</span>
      <ArrowUpRight className="h-3 w-3 shrink-0" />
    </button>
  );
}

/**
 * Renders `text` and automatically appends a clickable configuration deep-link
 * button when `text` mentions an unconfigured service (SMTP, WhatsApp, AI, etc.).
 */
export function ConfigAutoLink({
  text,
  target,
  className,
}: {
  text: string;
  target?: ConfigTargetId;
  className?: string;
}) {
  const detected = target ? CONFIG_DEEP_LINKS[target] : detectConfigTargetFromText(text);
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
      <span>{text}</span>
      {detected && <ConfigDeepLinkButton target={detected.id} label={detected.label} />}
    </span>
  );
}
