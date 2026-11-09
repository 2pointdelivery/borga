'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Mail, Send } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Field } from './form-widgets';
import { ConfigDeepLinkButton } from './ConfigDeepLink';
import { sendCompanyEmail } from '@/lib/borga/send-mail-client';
import { fmtMoney, type BusinessDocumentEmailInput } from '@/lib/borga/email-core';
import { toast } from '@/lib/toast-bus';

export interface DocumentEmailTarget {
  to: string;
  subject: string;
  body: string;
  document: BusinessDocumentEmailInput;
}

const KIND_TITLE: Record<BusinessDocumentEmailInput['kind'], string> = {
  invoice: 'Invoice',
  quote: 'Quote',
  bill: 'Remittance / Bill',
  purchase_order: 'Purchase Order',
};

export function DocumentEmailDialog({
  open,
  onOpenChange,
  ws,
  target,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ws: string;
  target: DocumentEmailTarget | null;
  onSent?: (via: 'email' | 'mailto', to: string, subject: string, body: string) => void;
}) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'fallback'>('idle');
  const [errorNote, setErrorNote] = useState<string | null>(null);

  useEffect(() => {
    if (open && target) {
      setTo(target.to);
      setSubject(target.subject);
      setBody(target.body);
      setState('idle');
      setErrorNote(null);
    }
  }, [open, target]);

  if (!target) return null;
  const doc = target.document;
  const kindLabel = KIND_TITLE[doc.kind] ?? 'Document';
  const totalFormatted = fmtMoney(doc.totalAmount, doc.currency);

  const openMailtoFallback = () => {
    const mailto = `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(subject.trim())}&body=${encodeURIComponent(body.trim())}`;
    window.open(mailto, '_blank');
    setState('fallback');
    onSent?.('mailto', to.trim(), subject.trim(), body.trim());
  };

  const handleSend = async () => {
    if (!to.trim() || state === 'sending') return;
    setState('sending');
    setErrorNote(null);

    const res = await sendCompanyEmail({
      ws,
      to: to.trim(),
      subject: subject.trim(),
      body: body.trim(),
      document: {
        ...doc,
        message: body.trim(),
      },
    });

    if (res.ok) {
      setState('sent');
      toast({
        title: `${kindLabel} ${doc.documentNumber} emailed`,
        description: `Delivered to ${to.trim()} via ${res.via ?? 'mail server'}.`,
        variant: 'success',
      });
      onSent?.('email', to.trim(), subject.trim(), body.trim());
      window.setTimeout(() => onOpenChange(false), 700);
    } else {
      setState('idle');
      setErrorNote(res.note ?? 'Outgoing email (SMTP) is not configured.');
      toast({
        title: `${kindLabel} could not be emailed directly`,
        description: res.note ?? 'Configure SMTP under Integrations → Connections, or use the mail client fallback.',
        variant: 'warning',
        configTarget: 'smtp',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            Email {kindLabel.toLowerCase()} {doc.documentNumber}
          </DialogTitle>
          <DialogDescription>
            Sends a formatted HTML + plain-text {kindLabel.toLowerCase()} with line-item breakdown and totals.
          </DialogDescription>
        </DialogHeader>

        {/* Document Summary Preview Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/80 bg-muted/20 px-3.5 py-2.5 text-xs">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">{doc.recipientName}</span>
              <Badge variant="outline" className="font-mono text-[10px]">
                {doc.documentNumber}
              </Badge>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {doc.lines?.length ? `${doc.lines.length} line item${doc.lines.length === 1 ? '' : 's'} · ` : ''}
              {doc.dueOrValidDate ? `Due / Valid: ${doc.dueOrValidDate}` : doc.workspaceName}
            </p>
          </div>
          <div className="text-right">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">Total</span>
            <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
              {totalFormatted}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <Field label="Recipient email *">
            <Input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="billing@company.com"
            />
          </Field>
          <Field label="Subject">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="Cover note / message">
            <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>

          {errorNote && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700 dark:text-amber-300">
              <span>{errorNote}</span>
              <div className="flex items-center gap-1.5">
                <ConfigDeepLinkButton target="smtp" label="Configure SMTP" />
                <button
                  type="button"
                  onClick={openMailtoFallback}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted"
                >
                  <ExternalLink className="h-3 w-3" /> Open mail app
                </button>
              </div>
            </div>
          )}

          {state === 'sent' && (
            <p className="text-xs font-medium text-emerald-600">
              Sent — {kindLabel.toLowerCase()} delivered.
            </p>
          )}
        </div>

        <DialogFooter className="items-center">
          <button
            type="button"
            onClick={openMailtoFallback}
            className="mr-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            title="Open in default email client"
          >
            <ExternalLink className="h-3 w-3" /> Open in mail app
          </button>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => void handleSend()}
            disabled={!to.trim() || state === 'sending'}
          >
            <Send className="h-3.5 w-3.5" />
            {state === 'sending' ? 'Sending…' : `Send ${kindLabel.toLowerCase()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
