/**
 * ElevenLabs TTS client (fetch-based, no extra deps).
 *
 * Uses the with-timestamps endpoint so the player can advance the focus-line
 * highlight per sentence against audio.currentTime (media timeline; unchanged
 * by client playbackRate).
 */

import { config } from '@/config/index';
import type { HostPreset } from './preset';

const API_BASE = 'https://api.elevenlabs.io/v1';
const OUTPUT_FORMAT = 'mp3_44100_128';

interface AlignmentPayload {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface TtsResult {
  audio: Buffer;
  /** Start time (s) of each requested char offset, media timeline at 1.0x. */
  charStartTimes: (offset: number) => number;
  durationSec: number;
}

function requireKey(): string {
  const key = config.narration.elevenLabsApiKey;
  if (!key) throw new Error('ELEVENLABS_API_KEY is not configured');
  return key;
}

export async function ttsWithTimestamps(preset: HostPreset, text: string): Promise<TtsResult> {
  const res = await fetch(
    `${API_BASE}/text-to-speech/${preset.voiceId}/with-timestamps?output_format=${OUTPUT_FORMAT}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': requireKey(), 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: preset.modelId,
        voice_settings: preset.voiceSettings,
      }),
    }
  );
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`ElevenLabs TTS HTTP ${res.status}: ${detail}`);
  }
  const json = (await res.json()) as { audio_base64: string; alignment: AlignmentPayload | null };
  const audio = Buffer.from(json.audio_base64, 'base64');
  const starts = json.alignment?.character_start_times_seconds ?? [];
  const ends = json.alignment?.character_end_times_seconds ?? [];
  const durationSec = ends.length ? (ends[ends.length - 1] ?? 0) : 0;
  return {
    audio,
    charStartTimes: (offset: number) => {
      if (!starts.length) return 0;
      const i = Math.max(0, Math.min(offset, starts.length - 1));
      return starts[i] ?? 0;
    },
    durationSec,
  };
}
