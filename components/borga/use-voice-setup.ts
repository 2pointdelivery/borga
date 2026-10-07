'use client';

import { useCallback, useEffect, useState } from 'react';
import { useBorga } from '@/lib/borga/store';
import type { VoiceInfo } from '@/lib/borga/voice-ids';

export const VOICE_CHANGED = 'borga:voice-setup-changed';

interface VoicesAnswer {
  ok?: boolean;
  configured?: boolean;
  keyInvalid?: boolean;
  source?: 'company' | 'shared' | null;
  voices?: VoiceInfo[];
  error?: string;
}

/**
 * Whether this company can speak with ElevenLabs, and the voices its account has, asked of the server (which tries the key).
 * It also keeps the stored "connected" flag equal to that answer, so every screen that reads the flag tells the truth.
 */
export function useVoiceSetup(opts: { sync?: boolean } = {}) {
  const ws = useBorga((s) => s.activeWorkspaceId);
  const loaded = useBorga((s) => s.loadedWorkspaceId);
  const connected = useBorga((s) => s.elevenlabs.connected);
  const setElevenlabs = useBorga((s) => s.setElevenlabs);
  const [state, setState] = useState<{ loading: boolean; configured: boolean; keyInvalid: boolean; source: 'company' | 'shared' | null; voices: VoiceInfo[]; error?: string }>({
    loading: true, configured: false, keyInvalid: false, source: null, voices: [],
  });

  const refresh = useCallback(async (force = false) => {
    if (!ws || loaded !== ws) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const r = await fetch(`/api/borga/voices?ws=${encodeURIComponent(ws)}${force ? '&refresh=1' : ''}`, { cache: 'no-store' });
      const j = (await r.json()) as VoicesAnswer;
      if (!j.ok) { setState((s) => ({ ...s, loading: false, error: j.error })); return; }
      setState({ loading: false, configured: !!j.configured, keyInvalid: !!j.keyInvalid, source: j.source ?? null, voices: j.voices ?? [], error: j.error });
    } catch {
      setState((s) => ({ ...s, loading: false, error: 'Could not check ElevenLabs.' }));
    }
  }, [ws, loaded]);

  useEffect(() => { void refresh(); }, [refresh]);
  // another screen saved or changed the key: ask again
  useEffect(() => {
    const on = () => void refresh(true);
    window.addEventListener(VOICE_CHANGED, on);
    return () => window.removeEventListener(VOICE_CHANGED, on);
  }, [refresh]);

  const syncFlag = opts.sync !== false;
  useEffect(() => {
    if (!syncFlag || state.loading) return;
    if (state.configured !== connected) setElevenlabs({ connected: state.configured, lastSync: state.configured ? 'Key verified' : '…' });
  }, [syncFlag, state.loading, state.configured, connected, setElevenlabs]);

  return { ...state, refresh };
}
