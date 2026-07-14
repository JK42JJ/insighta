/**
 * Narration presets — James-approved recipe + house hosts.
 *
 * Recipe SSOT: ~/Documents/insighta-manual-assets-20260703/narration-preset.json
 * (confirmed 2026-07-06, "nat-v3b-fast"). Do not change voice_settings without
 * a new James confirmation.
 *
 * House hosts (2026-07-10 decision): domain tone → default host, series keeps
 * its host. 준(male) = clear/plain explainer for tech·finance·practical.
 * 세아(female) = calm/warm guide for humanities·language·habit·life.
 *
 * Tempo: the approved recipe post-processes with ffmpeg atempo=1.06. The
 * service render keeps audio at 1.0x and ships `tempo` in the manifest —
 * the player applies playbackRate=1.06 with preservesPitch, which keeps
 * ElevenLabs character-alignment timestamps valid (media timeline unscaled).
 */

export type NarrationHost = 'jun' | 'seah';

export interface HostPreset {
  host: NarrationHost;
  /** ElevenLabs voice id (account voice; see credentials.md ElevenLabs section). */
  voiceId: string;
  voiceName: string;
  modelId: string;
  voiceSettings: {
    stability: number;
    similarity_boost: number;
    style: number;
    use_speaker_boost: boolean;
  };
}

/** Playback tempo the player applies (recipe: atempo=1.06, pitch kept). */
export const NARRATION_TEMPO = 1.06;

export const HOSTS: Record<NarrationHost, HostPreset> = {
  jun: {
    host: 'jun',
    voiceId: 'i4rvH83fgM9aBqIBZ5zH',
    voiceName: 'Jihu - Calm Korean Narrator (seoul male)',
    modelId: 'eleven_v3',
    voiceSettings: {
      stability: 0.42,
      similarity_boost: 0.82,
      style: 0.55,
      use_speaker_boost: true,
    },
  },
  seah: {
    host: 'seah',
    // Anna Kim - Tender, Calm and Clear (ko female) — matches the 세아 character
    // spec ("차분하고 따뜻한 안내자"). 15s candidate samples in ~/Downloads
    // (2026-07-13); swap here if James picks Yu Haon (B8rl62CpT9zOQ7RC3Mdl).
    voiceId: 'uyVNoMrnUku1dZyVEXwD',
    voiceName: 'Anna Kim - Tender, Calm and Clear (ko female)',
    modelId: 'eleven_v3',
    voiceSettings: {
      stability: 0.42,
      similarity_boost: 0.82,
      style: 0.55,
      use_speaker_boost: true,
    },
  },
};

/**
 * Domain keywords → 세아 (인문·언어·습관·라이프). Everything else defaults to
 * 준 (기술·금융·실무) per the 2026-07-10 assignment table. Checked against
 * the mandala title + domain column, lowercase substring match. v1 heuristic —
 * the upgrade path is a proper topic classifier, not more keywords.
 */
const SEAH_DOMAIN_KEYWORDS = [
  // 언어
  '영어',
  '언어',
  '회화',
  '스페인어',
  '일본어',
  '중국어',
  'hsk',
  '토익',
  '단어',
  // 인문
  '역사',
  '철학',
  '심리',
  '문학',
  '글쓰기',
  '독서',
  '인문',
  '예술',
  '미술',
  '음악',
  // 습관·라이프
  '습관',
  '루틴',
  '명상',
  '마음',
  '수면',
  '요리',
  '살림',
  '정리',
  '육아',
  '건강',
  '수채화',
  '그림',
  '여행',
  '행복',
];

export function classifyHost(title: string, domain?: string | null): NarrationHost {
  const hay = `${title} ${domain ?? ''}`.toLowerCase();
  return SEAH_DOMAIN_KEYWORDS.some((k) => hay.includes(k)) ? 'seah' : 'jun';
}
