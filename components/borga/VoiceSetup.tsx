'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Mic, Volume2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useBorga } from '@/lib/borga/store';
import { describeVoice, resolveVoiceRef, voiceInList } from '@/lib/borga/voice-ids';
import { ELEVENLABS_VOICES } from '@/lib/borga/data';
import { ConnectionPanel } from '@/components/borga/panels/ConnectionsTab';
import { useVoiceSetup, VOICE_CHANGED } from '@/components/borga/use-voice-setup';

interface Link { providerId: string; label: string; model: string; primary: boolean; activated: boolean }

const SAMPLE = "Hello, I'm Borga. I can read out your updates and take your commands.";
const SELECT = 'mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

/**
 * Everything that decides how the assistant sounds and thinks, in one place (onboarding and Settings share it):
 * the ElevenLabs key, the voice (from the voices the account really has), a real sample, and the model that answers spoken requests.
 */
export function VoiceSetup({ onChosen, showListening = true }: { onChosen?: () => void; showListening?: boolean }) {
  const { settings, setSettings, elevenlabs, setElevenlabs, activeWorkspaceId: ws, loadedWorkspaceId: loaded } = useBorga();
  const setup = useVoiceSetup();
  const [chain, setChain] = useState<Link[]>([]);
  const [playing, setPlaying] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [editKey, setEditKey] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const chosen = () => onChosen?.();

  useEffect(() => {
    if (!ws || loaded !== ws) return;
    let off = false;
    void fetch(`/api/borga/llm-fallback?ws=${encodeURIComponent(ws)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { ok?: boolean; chain?: Link[] }) => { if (!off && j.ok) setChain((j.chain ?? []).filter((c) => c.activated || c.primary)); })
      .catch(() => {});
    return () => { off = true; };
  }, [ws, loaded]);
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const configured = setup.configured;
  const liveVoices = setup.voices;
  // before the account's list loads (or without a key) show the premade names so the picker is never empty, marked as such
  const options = liveVoices.length
    ? liveVoices.map((v) => ({ id: v.id, label: v.name, detail: describeVoice(v) }))
    : ELEVENLABS_VOICES.map((v) => ({ id: resolveVoiceRef(v.id) ?? v.id, label: v.label, detail: v.tag }));
  const current = resolveVoiceRef(elevenlabs.voice) ?? '';
  const known = options.some((o) => o.id === current);
  const missing = configured && liveVoices.length > 0 && !voiceInList(elevenlabs.voice, liveVoices);

  const stop = () => { audioRef.current?.pause(); audioRef.current = null; if (canSpeak) window.speechSynthesis.cancel(); setPlaying(false); };
  const browserSample = () => {
    if (!canSpeak) { setNote('This browser cannot speak. Voice works best in Chrome, Edge or Safari.'); setPlaying(false); return; }
    const u = new SpeechSynthesisUtterance(SAMPLE);
    u.onend = () => setPlaying(false);
    u.onerror = () => setPlaying(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  };
  const hear = async () => {
    stop();
    setNote(null);
    setPlaying(true);
    if (!configured) { browserSample(); return; }
    try {
      const res = await fetch('/api/borga/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ text: SAMPLE, voiceId: resolveVoiceRef(elevenlabs.voice), ws }),
      });
      if (!res.ok || !res.headers.get('content-type')?.startsWith('audio/')) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setNote(`ElevenLabs could not speak the sample (${j.error ?? res.status}). The browser voice is used instead.`);
        browserSample();
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = audio.onerror = () => { URL.revokeObjectURL(url); setPlaying(false); };
      await audio.play();
    } catch {
      setNote('Could not play the sample. The browser voice is used instead.');
      browserSample();
    }
  };

  const voiceLlm = settings.voiceLlm;
  const llmValue = voiceLlm?.providerId && chain.some((c) => c.providerId === voiceLlm.providerId) ? voiceLlm.providerId : '';

  return (
    <div className="space-y-4">
      {showListening && (
        <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium"><Mic className="h-4 w-4 text-primary" /> Always listening</p>
            <p className="text-xs text-muted-foreground">The microphone stays on while Borga is open, and Borga only acts after you say &ldquo;Borga&rdquo;. The browser asks for permission first.</p>
          </div>
          <Switch checked={!!settings.notifications.voice} onCheckedChange={(v) => { setSettings({ notifications: { ...settings.notifications, voice: v } }); chosen(); }} aria-label="Always listening" />
        </div>
      )}

      <div className="rounded-lg border px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">ElevenLabs voice</p>
          {setup.loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            : configured ? <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Key verified{setup.source === 'shared' ? ' (shared by the administrator)' : ''}</span>
            : <span className="text-xs text-muted-foreground">Using the browser voice</span>}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {setup.keyInvalid ? 'ElevenLabs rejected the saved key. Paste it again below.' : 'Add your ElevenLabs API key for a natural agent voice. Without one, agents speak with your browser\'s voice.'}
        </p>
        {setup.error && !setup.keyInvalid && <p className="mt-1 flex items-center gap-1 text-xs text-amber-600"><AlertTriangle className="h-3.5 w-3.5" /> {setup.error}</p>}
        {configured && (
          <button type="button" onClick={() => setEditKey((v) => !v)} className="mt-1 text-xs text-primary underline-offset-2 hover:underline">{editKey ? 'Hide key' : 'Change key'}</button>
        )}
        {(!configured || editKey) && (
          <div className="mt-2"><ConnectionPanel providerId="elevenlabs" onChange={() => { window.dispatchEvent(new Event(VOICE_CHANGED)); chosen(); }} /></div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs text-muted-foreground">Agent voice</Label>
          <select
            value={known ? current : ''}
            onChange={(e) => { setElevenlabs({ voice: e.target.value }); chosen(); }}
            className={SELECT}
            disabled={!configured}
            aria-label="Agent voice"
          >
            {!known && <option value="">Choose a voice</option>}
            {options.map((o) => <option key={o.id} value={o.id}>{o.label} — {o.detail}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {!configured ? 'Voices appear once ElevenLabs is set up.'
              : missing ? 'The saved voice is not on your ElevenLabs account, so pick one from the list.'
              : `${liveVoices.length} voice${liveVoices.length === 1 ? '' : 's'} on your account.`}
          </p>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Answers spoken requests with</Label>
          <select
            value={llmValue}
            onChange={(e) => {
              const link = chain.find((c) => c.providerId === e.target.value);
              setSettings({ voiceLlm: link ? { providerId: link.providerId, model: link.model } : undefined });
              chosen();
            }}
            className={SELECT}
            aria-label="Voice model"
          >
            <option value="">Same model as chat</option>
            {chain.map((c) => <option key={c.providerId} value={c.providerId}>{c.label} — {c.model}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-muted-foreground">A fast model answers sooner out loud. If it fails, the next activated model takes over.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => (playing ? stop() : void hear())} disabled={!configured && !canSpeak}>
          {playing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />} {playing ? 'Stop' : 'Hear a sample'}
        </Button>
        <span className="text-xs text-muted-foreground">{configured ? 'Plays the chosen ElevenLabs voice.' : 'Plays the browser voice.'}</span>
      </div>
      {note && <p className="text-xs text-amber-600">{note}</p>}
      {!canSpeak && !configured && <p className="text-xs text-amber-600">This browser cannot speak. Voice works best in Chrome, Edge or Safari.</p>}
    </div>
  );
}
