'use client';

import { useCallback, useState } from 'react';
import { Mic, MicOff, Phone, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useBorga } from '@/lib/borga/store';
import { useVoice } from './use-voice';
import { BorgaOrb } from './BorgaOrb';
import { toast } from '@/lib/toast-bus';
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
  'What are my top priorities today?',
  'Create a task to follow up with Atlas',
  'Switch to dark theme',
  'Give me a sales KPI summary',
];

export function VoiceAssistant({ expanded }: { expanded: boolean }) {
  const { voice, setVoice, userName, settings, setSettings, agents, placeCall: storePlaceCall } = useBorga();
  const { startListening, stopListening, askBorga } = useVoice();
  const wakeWordEnabled = !!settings.notifications.voice;

  const [callTo, setCallTo] = useState('');
  const [callMsg, setCallMsg] = useState('');
  const [calling, setCalling] = useState(false);

  const placeCall = useCallback(async () => {
    const to = callTo.trim();
    const message = callMsg.trim();
    if (!/^\+[1-9]\d{7,14}$/.test(to)) {
      toast({
        title: 'Invalid phone number',
        description: 'Use E.164 format, e.g. +14155550142.',
        variant: 'error',
      });
      return;
    }
    if (!message) {
      toast({ title: 'Message required', description: 'Enter what Borga should say.', variant: 'error' });
      return;
    }
    setCalling(true);
    try {
      // Route through the same store action the Calls tab uses, so this
      // widget gets the same real-Twilio-or-honest-simulated fallback and
      // shows up in the Calls log, instead of a second, weaker code path
      // that only toasted and dropped the call on the floor when Twilio
      // wasn't configured.
      const agent = agents[0];
      storePlaceCall({
        agentId: agent?.id ?? 'borga-assistant',
        agentName: agent?.name ?? 'Borga',
        contact: to,
        leadName: to,
        note: message,
      });
      toast({ title: 'Call queued', description: 'Check the Calls tab for live status.', variant: 'success' });
      setCallTo('');
      setCallMsg('');
    } finally {
      setCalling(false);
    }
  }, [callTo, callMsg]);

  const toggle = useCallback(() => {
    if (voice.listening) {
      stopListening();
    } else {
      startListening();
    }
  }, [voice.listening, startListening, stopListening]);

  return (
    <div
      className={cn(
        'flex h-full flex-col overflow-hidden transition-all duration-300',
        expanded ? 'w-full opacity-100' : 'w-0 opacity-0',
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold">Borga Assistant</span>
            <Badge variant="outline" className="gap-1 text-[11px]">
              <Sparkles className="h-3 w-3 text-primary" /> Voice + LLM
            </Badge>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Always listening
            <Switch
              checked={wakeWordEnabled}
              onCheckedChange={(v) => setSettings({ notifications: { ...settings.notifications, voice: v } })}
            />
          </label>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
          <BorgaOrb active={voice.listening} thinking={voice.thinking} size={150} />

          <div className="min-h-[64px] max-w-sm">
            {voice.thinking ? (
              <p className="text-sm text-muted-foreground">Borga is thinking—</p>
            ) : voice.listening && wakeWordEnabled && !voice.awake ? (
              <p className="text-sm text-muted-foreground">Always listening — say —Borga— to wake me.</p>
            ) : voice.listening ? (
              <p className="text-sm text-primary">Listening — speak now—</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {voice.lastReply ||
                  `Talk to ${userName}'s command center. Press the mic and speak a command or question.`}
              </p>
            )}
          </div>

          {voice.transcript && (
            <p className="max-w-sm rounded-lg bg-muted/60 px-3 py-1.5 text-xs italic text-muted-foreground">
              —{voice.transcript}—
            </p>
          )}

          <div className="flex flex-wrap items-center justify-center gap-2 px-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setVoice({ transcript: s });
                  void askBorga(s);
                }}
                className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                {s}
              </button>
            ))}
          </div>

          <div className="w-full max-w-sm space-y-2 px-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Place a call
            </p>
            <Input
              type="tel"
              placeholder="+14155550142"
              value={callTo}
              onChange={(e) => setCallTo(e.target.value)}
              className="h-9"
            />
            <Input
              placeholder="Message Borga should say on the call…"
              value={callMsg}
              onChange={(e) => setCallMsg(e.target.value)}
              className="h-9"
            />
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1.5"
              onClick={placeCall}
              disabled={calling}
            >
              <Phone className="h-4 w-4" />
              {calling ? 'Calling…' : 'Place call'}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-center gap-3 pb-6 pt-2">
          <Button
            size="lg"
            variant={voice.listening ? 'destructive' : 'default'}
            className={cn('relative h-14 w-14 rounded-full p-0', voice.listening && 'borga-glow')}
            onClick={toggle}
            aria-label={voice.listening ? 'Stop listening' : 'Start listening'}
          >
            {voice.listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
