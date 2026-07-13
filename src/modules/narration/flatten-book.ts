/**
 * Book → beat sequence, mirroring the /mobile player's flatten() exactly
 * (frontend/public/mobile/index.html). Beat INDICES must match the player's,
 * because the audio manifest is keyed by (index, text-hash). Only narration
 * ('n') beats get TTS; chapter cards and clips are silent on the server side.
 * Change here ⇒ change the player flatten() + parity fixtures in the same PR.
 */

import { stripMd } from './sentences';

export interface BookAtom {
  vid?: string;
  ts?: number;
  text?: string;
  src?: string | null;
  seg_ref?: { from_sec: number; to_sec: number };
}

export interface BookSection {
  title?: string;
  narrative?: string;
  atoms?: BookAtom[];
}

export interface BookChapter {
  title?: string;
  intro?: string;
  sections?: BookSection[];
}

export interface BookJson {
  chapters?: BookChapter[];
}

export type Beat =
  | { t: 'ch'; num: number; title: string }
  | { t: 'n'; title?: string; text: string }
  | { t: 'c'; vid: string };

export function flattenBook(book: BookJson): Beat[] {
  const beats: Beat[] = [];
  const chs = book?.chapters ?? [];
  chs.forEach((ch, ci) => {
    beats.push({ t: 'ch', num: ci + 1, title: ch.title || `챕터 ${ci + 1}` });
    if (ch.intro && stripMd(ch.intro)) beats.push({ t: 'n', title: ch.title, text: ch.intro });
    (ch.sections ?? []).forEach((s) => {
      if (s.narrative && stripMd(s.narrative))
        beats.push({ t: 'n', title: s.title, text: s.narrative });
      (s.atoms ?? []).slice(0, 2).forEach((a) => {
        if (!a.vid) return;
        beats.push({ t: 'c', vid: a.vid });
      });
    });
  });
  return beats;
}
