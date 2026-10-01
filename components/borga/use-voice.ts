'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useBorga } from '@/lib/borga/store';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// ElevenLabs voice names (as stored in ElevenLabsConfig.voice) → voice IDs.
// Mirrors the map in app/api/borga/elevenlabs/route.ts.
const ELEVEN_VOICE_IDS: Record<string, string> = {
  rachel: '21m00Tcm4TlvDq8ikWAM',
  domi: 'AZnzlk1XvdvUeBnXmlld',
  bella: 'EXAVITQu4vr4xnSDxMaL',
  antoni: 'ErXwobaYiN019PkySvjV',
  elli: 'MF3mGyEYCl7XYWbV9V6O',
  josh: 'TxGEqnHWrfWFTfGW9XjX',
  arnold: 'VR6AewLTigWG4xSOukaG',
  adam: 'pNInz6obpgDQGcFmaJgB',
  sam: 'yoZ06aMxZJJ28mfd3POQ',
  george: 'VR6AewLTigWG4xSOukaG',
};

function elevenVoiceId(name?: string): string | undefined {
  if (!name) return undefined;
  return ELEVEN_VOICE_IDS[name.toLowerCase()];
}

// Detect a deep male English voice for Borga.
function pickBorgaVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const score = (v: SpeechSynthesisVoice) => {
    let s = 0;
    const n = v.name.toLowerCase();
    if (n.includes('male') || n.includes('david') || n.includes('mark') || n.includes('daniel') || n.includes('guy')) s += 3;
    if (n.includes('deep') || n.includes('baritone')) s += 2;
    if (n.includes('en-') || v.lang.toLowerCase().startsWith('en')) s += 2;
    if (v.default) s += 1;
    return s;
  };
  const sorted = [...voices].sort((a, b) => score(b) - score(a));
  return sorted[0] ?? null;
}

const WAKE_RE = /\b(hey\s+|ok\s+|okay\s+)?borga\b[,:]?\s*/i;
const AWAKE_WINDOW_MS = 8000; // after the wake word, accept the next utterance without saying it again

// ---------------------------------------------------------------------------
// There is exactly one microphone for the whole app, so the recognition
// engine is a module-level singleton rather than per-hook-instance state.
// Any component calling useVoice() (the header mic button, the floating
// orb's panel, an app-wide "always listening" effect in DashboardShell)
// drives the SAME underlying SpeechRecognition session instead of each
// silently fighting over the mic. Reactive values (settings, elevenlabs
// config, etc.) are read through `latest`, refreshed every render, so the
// long-lived recognition object's event handlers never close over stale data.
// ---------------------------------------------------------------------------
interface VoiceEngineLatest {
  handleTranscriptEvent: (finalText: string, interimText: string) => void;
  onUnsupported: () => void;
  onPermissionDenied: () => void;
  wakeWordEnabled: boolean;
}
const engine: {
  rec: any;
  shouldListen: boolean;
  starting: boolean;
  busy: boolean; // true while thinking/speaking — mic is intentionally down
  awake: boolean;
  awakeTimer: ReturnType<typeof setTimeout> | null;
  restartTimer: ReturnType<typeof setTimeout> | null;
  latest: VoiceEngineLatest | null;
} = {
  rec: null,
  shouldListen: false,
  starting: false,
  busy: false,
  awake: false,
  awakeTimer: null,
  restartTimer: null,
  latest: null,
};

function clearAwakeTimer() {
  if (engine.awakeTimer) {
    clearTimeout(engine.awakeTimer);
    engine.awakeTimer = null;
  }
}

function clearRestartTimer() {
  if (engine.restartTimer) {
    clearTimeout(engine.restartTimer);
    engine.restartTimer = null;
  }
}

function startRecognitionNow(setVoice: (p: any) => void) {
  if (typeof window === 'undefined' || engine.starting) return;
  const w = window as any;
  const Rec = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Rec) {
    engine.shouldListen = false;
    setVoice({ listening: false });
    engine.latest?.onUnsupported();
    return;
  }

  if (engine.rec) {
    try { engine.rec.stop(); } catch { /* already stopped */ }
  }

  const rec = new Rec();
  rec.lang = 'en-US';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onresult = (e: any) => {
    let finalText = '';
    let interimText = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      const t = result[0]?.transcript ?? '';
      if (result.isFinal) finalText += t;
      else interimText += t;
    }
    if (finalText || interimText) engine.latest?.handleTranscriptEvent(finalText, interimText);
  };
  rec.onerror = (e: any) => {
    const err = e?.error;
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      engine.shouldListen = false;
      clearAwakeTimer();
      setVoice({ listening: false, awake: false });
      engine.latest?.onPermissionDenied();
    }
    // 'no-speech' / 'aborted' / 'network' — transient, onend decides whether to restart.
  };
  rec.onend = () => {
    engine.starting = false;
    if (engine.shouldListen && !engine.busy) {
      scheduleRestart(setVoice, 120);
    } else {
      setVoice({ listening: false });
    }
  };

  engine.rec = rec;
  engine.starting = true;
  try {
    rec.start();
    setVoice({ listening: true });
  } catch {
    // Already-started style errors — a session is already live, treat as success.
    engine.starting = false;
    setVoice({ listening: true });
  }
}

function scheduleRestart(setVoice: (p: any) => void, delay = 150) {
  clearRestartTimer();
  engine.restartTimer = setTimeout(() => {
    if (engine.shouldListen && !engine.busy) startRecognitionNow(setVoice);
  }, delay);
}

export function useVoice() {
  const { setVoice, log, userName, setUserName, llm, activeWorkspaceId, activeWorkspace, elevenlabs, settings } = useBorga();

  const historyRef = useRef<ChatMessage[]>([
    { role: 'system', content: 'System name Borga. Assistant is Borga.' },
  ]);

  const speech = useMemo(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    return window.speechSynthesis;
  }, []);

  const wakeWordEnabled = !!settings?.notifications?.voice;

  const goToSleep = useCallback(() => {
    engine.awake = false;
    clearAwakeTimer();
    setVoice({ awake: false });
  }, [setVoice]);

  const wake = useCallback(() => {
    engine.awake = true;
    setVoice({ awake: true });
    clearAwakeTimer();
    engine.awakeTimer = setTimeout(goToSleep, AWAKE_WINDOW_MS);
  }, [goToSleep, setVoice]);

  const resumeSoon = useCallback((delay = 150) => {
    engine.busy = false;
    if (engine.shouldListen) scheduleRestart(setVoice, delay);
  }, [setVoice]);

  // Tier 3: the single Audio element Borga is speaking through (if any), so a
  // new turn can interrupt it instead of talking over it.
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);

  // Tier 3: stop speaking immediately and listen. A new turn (typed,
  // push-to-talk, or open-mic) calls this first — Borga never talks over you.
  const interrupt = useCallback(() => {
    try { activeAudioRef.current?.pause(); } catch { /* ignore */ }
    activeAudioRef.current = null;
    try { speech?.cancel(); } catch { /* ignore */ }
    engine.busy = false;
  }, [speech]);

  const speak = useCallback(
    async (text: string, onend?: () => void) => {
      engine.busy = true;
      try { engine.rec?.stop(); } catch { /* ignore */ }
      // Don't listen to itself: mic stays down until finish()/interrupt().
      try { speech?.cancel(); } catch { /* ignore */ }

      const finish = () => {
        activeAudioRef.current = null;
        onend?.();
        resumeSoon();
      };

      // "thinking…" is cleared by the caller when the reply arrives; speaking
      // starts as early as possible (streamed TTS upstream, Tier 1 SSE ready).
      if (elevenlabs?.connected) {
        try {
          const res = await fetch('/api/borga/voice/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voiceId: elevenVoiceId(elevenlabs.voice) }),
          });
          if (res.ok && res.headers.get('content-type')?.startsWith('audio/')) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            activeAudioRef.current = audio;
            audio.onended = () => { URL.revokeObjectURL(url); finish(); };
            audio.onerror = () => { URL.revokeObjectURL(url); finish(); };
            audio.play().catch(() => finish());
            return;
          }
          // Fall through to browser TTS on any non-audio response.
        } catch {
          // Fall through to browser TTS.
        }
      }

      if (!speech) {
        finish();
        return;
      }
      speech.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 0.98;
      utter.pitch = 0.85; // deeper, more natural tone
      utter.voice = pickBorgaVoice() ?? utter.voice;
      utter.onend = finish;
      utter.onerror = finish;
      speech.speak(utter);
    },
    [speech, elevenlabs, resumeSoon],
  );

  const askBorga = useCallback(
    async (prompt: string) => {
      interrupt();
      engine.busy = true;
      try { engine.rec?.stop(); } catch { /* ignore */ }
      setVoice({ thinking: true });
      historyRef.current.push({ role: 'user', content: prompt });
      try {
        const res = await fetch('/api/borga/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
          body: JSON.stringify({
            providerId: llm.providerId,
            model: llm.model,
            messages: historyRef.current.filter((m) => m.role !== 'system'),
            ws: activeWorkspaceId,
            companyName: activeWorkspace()?.name,
          }),
        });
        const data = (await res.json()) as { reply?: string };
        const reply = data.reply ?? 'Borga is listening.';
        historyRef.current.push({ role: 'assistant', content: reply });
        setVoice({ thinking: false, lastReply: reply, transcript: '' });
        speak(reply);
        log({ agentId: 'a1', agentName: 'Borga', actor: 'agent', kind: 'voice', message: `Replied to: —${prompt.slice(0, 60)}…` });
        return reply;
      } catch {
        const reply = 'Borga had trouble reaching its model. Please try again.';
        setVoice({ thinking: false, lastReply: reply });
        speak(reply);
        return reply;
      }
    },
    [llm, log, setVoice, speak, interrupt, activeWorkspaceId, activeWorkspace],
  );

  const parseCommand = useCallback(
    (raw: string) => {
      const t = raw.toLowerCase();
      const setMyName = t.match(/(?:my name is|call me)\s+([a-z0-9]+)/i);
      if (setMyName) {
        const name = setMyName[1].replace(/^./, (c) => c.toUpperCase());
        setUserName(name);
        return `Nice to meet you, ${name}. I—ll remember that.`;
      }
      if (t.includes('theme') && t.includes('dark')) {
        document.documentElement.classList.add('dark');
        return 'Switching to dark mode.';
      }
      if (t.includes('theme') && t.includes('light')) {
        document.documentElement.classList.remove('dark');
        return 'Switching to light mode.';
      }
      if (t.includes('open planner') || t.includes('show planner')) return 'Opening the planner.';
      if (t.includes('hello') || t.includes('hi ') || t === 'hi') {
        return `Hello ${userName}. Everything is on track — three agents are active right now. What should we tackle?`;
      }
      if (t.includes('who are you') || t.includes('your name')) {
        return 'I am Borga, your command-center orchestrator. I coordinate the specialist agents and keep your business moving.';
      }
      if (t.includes('stop listening') || t.includes('go to sleep')) {
        return '__SLEEP__';
      }
      return null;
    },
    [setUserName, userName],
  );

  const handleFinalCommand = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      interrupt();
      goToSleep();
      setVoice({ transcript: trimmed, thinking: false });
      const local = parseCommand(trimmed);
      if (local === '__SLEEP__') {
        setVoice({ lastReply: 'Going quiet — say "Borga" to wake me.', transcript: '' });
        speak('Going quiet. Say Borga to wake me.');
        return;
      }
      if (local) {
        setVoice({ lastReply: local, transcript: '' });
        speak(local);
        log({ agentId: 'a1', agentName: 'Borga', actor: 'agent', kind: 'voice', message: `Replied to: —${trimmed.slice(0, 60)}…` });
        return;
      }
      void askBorga(trimmed);
    },
    [askBorga, goToSleep, interrupt, log, parseCommand, setVoice, speak],
  );

  const handleTranscriptEvent = useCallback(
    (finalText: string, interimText: string) => {
      if (interimText && !finalText) setVoice({ transcript: interimText });
      if (!finalText) return;
      const trimmed = finalText.trim();
      if (!trimmed) return;

      if (!wakeWordEnabled || engine.awake) {
        // Gating is off, or we're already in an awake window — this utterance
        // IS the command. Strip a leading wake word if present so "Hey Borga,
        // what's my pipeline" works as a single breath, not two turns.
        const stripped = trimmed.replace(WAKE_RE, '').trim();
        handleFinalCommand(stripped || trimmed);
        return;
      }

      // Idle — only the wake word can open a command window.
      if (WAKE_RE.test(trimmed)) {
        const after = trimmed.replace(WAKE_RE, '').trim();
        if (after.length > 2) {
          handleFinalCommand(after);
        } else {
          wake();
          setVoice({ transcript: '' });
        }
      } else {
        setVoice({ transcript: '' });
      }
    },
    [handleFinalCommand, setVoice, wake, wakeWordEnabled],
  );

  const onUnsupported = useCallback(() => {
    const msg = 'Voice recognition is not supported in this browser. Try Chrome or Edge.';
    setVoice({ lastReply: msg, thinking: false });
    speak(msg);
  }, [setVoice, speak]);

  const onPermissionDenied = useCallback(() => {
    setVoice({ lastReply: 'Microphone access was denied. Allow microphone access in your browser to use voice commands.' });
  }, [setVoice]);

  // Keep the singleton engine's callbacks pointed at this render's fresh
  // closures (which see the latest settings/llm/elevenlabs/etc.) without
  // ever recreating the underlying SpeechRecognition session.
  useEffect(() => {
    engine.latest = { handleTranscriptEvent, onUnsupported, onPermissionDenied, wakeWordEnabled };
  }, [handleTranscriptEvent, onUnsupported, onPermissionDenied, wakeWordEnabled]);

  const startListening = useCallback(() => {
    engine.shouldListen = true;
    startRecognitionNow(setVoice);
  }, [setVoice]);

  const stopListening = useCallback(() => {
    engine.shouldListen = false;
    engine.busy = false;
    clearAwakeTimer();
    clearRestartTimer();
    try { engine.rec?.stop(); } catch { /* ignore */ }
    setVoice({ listening: false, awake: false });
  }, [setVoice]);

  // Tier 3 push-to-talk: hold key -> MediaRecorder captures -> release ->
  // POST to the server STT seam (/api/borga/voice/stt, Deepgram) -> transcript
  // feeds the SAME handleFinalCommand/askBorga entrypoint as a typed turn.
  // The brain is untouched; only how the turn arrives changes.
  const pttRef = useRef<{ recorder: MediaRecorder | null; chunks: Blob[]; stream: MediaStream | null }>({
    recorder: null,
    chunks: [],
    stream: null,
  });

  const startPushTalk = useCallback(async () => {
    interrupt();
    try { engine.rec?.stop(); } catch { /* ignore */ }
    engine.busy = true;
    setVoice({ thinking: true, transcript: 'Listening… (release to send)' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      pttRef.current = { recorder, chunks: [], stream };
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) pttRef.current.chunks.push(e.data);
      };
      recorder.start();
    } catch {
      engine.busy = false;
      setVoice({ thinking: false, lastReply: 'Microphone access was denied. Allow microphone access to use push-to-talk.' });
      onPermissionDenied();
    }
  }, [interrupt, setVoice, onPermissionDenied]);

  const stopPushTalk = useCallback(() => {
    const { recorder, chunks, stream } = pttRef.current;
    if (!recorder || recorder.state === 'inactive') {
      engine.busy = false;
      setVoice({ thinking: false });
      resumeSoon();
      return;
    }
    setVoice({ transcript: 'Thinking…', thinking: true });
    recorder.onstop = async () => {
      try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
      pttRef.current = { recorder: null, chunks: [], stream: null };
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (!blob.size) {
        engine.busy = false;
        setVoice({ thinking: false, transcript: '' });
        resumeSoon();
        return;
      }
      try {
        const res = await fetch('/api/borga/voice/stt', {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'audio/webm' },
          body: blob,
        });
        if (res.ok) {
          const data = (await res.json()) as { transcript?: string };
          const text = (data.transcript ?? '').trim();
          if (text) {
            handleFinalCommand(text);
            return;
          }
          setVoice({ thinking: false, transcript: '', lastReply: 'I didn\u2019t catch that — try again.' });
        } else {
          // 501 = Deepgram not configured: user keeps open-mic/browser path.
          setVoice({ thinking: false, transcript: '', lastReply: 'Push-to-talk transcription isn\u2019t configured (add DEEPGRAM_API_KEY) — use open-mic or type instead.' });
        }
      } catch {
        setVoice({ thinking: false, transcript: '', lastReply: 'Transcription failed — use open-mic or type instead.' });
      } finally {
        engine.busy = false;
        resumeSoon();
      }
    };
    recorder.stop();
  }, [handleFinalCommand, setVoice, resumeSoon]);

  return {
    startListening,
    stopListening,
    speak,
    askBorga,
    interrupt,
    startPushTalk,
    stopPushTalk,
  };
}
