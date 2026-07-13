/**
 * Narration pre-produce unit tests (2026-07-13).
 *
 * The critical contract is FE↔BE parity: the /mobile player looks up
 * pre-rendered audio by (beat index, sha256(joined sentences)), so
 * sentences()/flattenBook() here must behave exactly like the player's
 * copies in frontend/public/mobile/index.html. These fixtures pin that.
 */

import { sentences, stripMd, beatTextHash } from '@/modules/narration/sentences';
import { flattenBook } from '@/modules/narration/flatten-book';
import { classifyHost, HOSTS, NARRATION_TEMPO } from '@/modules/narration/preset';

describe('narration sentences (player parity)', () => {
  it('splits Korean sentence enders like the player', () => {
    expect(sentences('물의 양이 투명도를 결정합니다. 마르기 전에 칠하면 번지고요. 끝.')).toEqual([
      '물의 양이 투명도를 결정합니다.',
      '마르기 전에 칠하면 번지고요.',
      // '끝.' is a single-char sentence body; length filter keeps it (2 chars incl. dot)
      '끝.',
    ]);
  });

  it('strips markdown the way the player does', () => {
    expect(stripMd('## 제목\n**굵게** [링크](http://x)와 `코드`')).toBe('제목 굵게 링크와 코드');
  });

  it('filters fragments of length <= 1', () => {
    expect(sentences('가. 나머지는 유지됩니다.')).toEqual(['가.', '나머지는 유지됩니다.']);
    expect(sentences('.')).toEqual([]);
  });

  it('hashes are stable and 12 hex chars', () => {
    const h = beatTextHash(['한 문장.', '두 문장.']);
    expect(h).toMatch(/^[0-9a-f]{12}$/);
    expect(beatTextHash(['한 문장.', '두 문장.'])).toBe(h);
  });
});

describe('narration flattenBook (player parity)', () => {
  const book = {
    chapters: [
      {
        title: '1부',
        intro: '인트로 문장입니다.',
        sections: [
          {
            title: '섹션A',
            narrative: '섹션 내레이션입니다.',
            atoms: [
              { vid: 'v1', ts: 10 },
              { vid: 'v2', ts: 20 },
              { vid: 'v3', ts: 30 },
            ],
          },
          { title: '섹션B', narrative: '', atoms: [{ ts: 5 }] },
        ],
      },
      { title: '2부', intro: '', sections: [{ title: '섹션C', narrative: '마지막 내레이션.' }] },
    ],
  };

  it('produces the exact player beat order and indices', () => {
    const beats = flattenBook(book);
    expect(beats.map((b) => b.t)).toEqual([
      'ch', // 0: 1부
      'n', // 1: intro
      'n', // 2: 섹션A narrative
      'c', // 3: v1
      'c', // 4: v2  (atoms sliced to 2 — v3 dropped)
      'ch', // 5: 2부 (섹션B: empty narrative skipped, atom without vid skipped)
      'n', // 6: 섹션C narrative
    ]);
  });
});

describe('narration host assignment (2026-07-10 table)', () => {
  it('routes 기술/금융 to 준 by default', () => {
    expect(classifyHost('MCP 기반 AI 에이전트 개발')).toBe('jun');
    expect(classifyHost('ETF 투자 첫걸음')).toBe('jun');
  });

  it('routes 인문·언어·습관·라이프 to 세아', () => {
    expect(classifyHost('처음부터 시작하는 수채화')).toBe('seah');
    expect(classifyHost('영어 회화 100일')).toBe('seah');
    expect(classifyHost('아침 루틴 만들기')).toBe('seah');
  });

  it('presets carry the James-approved recipe', () => {
    for (const host of ['jun', 'seah'] as const) {
      expect(HOSTS[host].modelId).toBe('eleven_v3');
      expect(HOSTS[host].voiceSettings).toEqual({
        stability: 0.42,
        similarity_boost: 0.82,
        style: 0.55,
        use_speaker_boost: true,
      });
    }
    expect(NARRATION_TEMPO).toBe(1.06);
  });
});
