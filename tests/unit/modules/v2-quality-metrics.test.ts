/**
 * v2 Rich-Summary Quality Metrics — paper §6.2 (CP437).
 */

import {
  extractTitleTokens,
  computeM1,
  computeV2Quality,
} from '@/modules/metrics/v2-quality-metrics';

describe('extractTitleTokens — Korean particle stripping', () => {
  test('strips trailing 은/는/이/가/을/를 etc', () => {
    const t = extractTitleTokens('수능 출제자의 의도 파악');
    expect(t).toEqual(expect.arrayContaining(['수능', '출제자', '의도', '파악']));
    expect(t).not.toContain('의'); // particle removed, not a content token
  });

  test('handles English mixed lowercase', () => {
    const t = extractTitleTokens('Introducing Claude Code');
    expect(t).toEqual(expect.arrayContaining(['introducing', 'claude', 'code']));
  });

  test('drops single-char English tokens (KO single-char retained)', () => {
    // English: 'A', 'B' dropped (TITLE_MIN_TOKEN_LEN=2).
    // Korean: '가', '나' kept (TITLE_MIN_TOKEN_LEN_KO=1) — but '가' is in
    // STOPWORDS_KO so it's filtered. '나' was removed from stopwords for
    // ambiguity reasons (1인칭 vs particle), so it stays.
    const t = extractTitleTokens('A B 가 나');
    expect(t).toEqual(['나']);
  });

  test("'으로' and '로' both stripped (longest-suffix wins)", () => {
    const t = extractTitleTokens('어원으로 푸는 삼각함수');
    expect(t).toContain('어원');
    // '푸는' → strip 는 → '푸' (KO single-char, retained).
    // For M1 substring-match scoring this still hits '푸시', '푸른' etc;
    // the aggressive-strip residue noise is acceptable as the dominant
    // mode is 단음절 명사 ('돈', '책', '길') recall (CP437 RCA).
    expect(t).toContain('푸');
    expect(t).toContain('삼각함수');
  });

  test('decodes HTML entities (&#39; &quot; &amp;) before tokenizing', () => {
    const t = extractTitleTokens('&#39;나&#39;라는 것이 있나? &quot;사랑&quot; &amp; 행복');
    expect(t).toContain('나');
    expect(t).toContain('사랑');
    expect(t).toContain('행복');
    expect(t).not.toContain('39'); // entity numeric should not leak as token
    expect(t).not.toContain('quot');
    expect(t).not.toContain('amp');
  });

  test("Korean vertical bar 'ㅣ' splits as punctuation", () => {
    const t = extractTitleTokens('투자 전략ㅣ지식인초대석');
    expect(t).toContain('투자');
    expect(t).toContain('전략');
    expect(t).toContain('지식인초대석');
    expect(t).not.toContain('전략ㅣ지식인초대석');
  });

  test('Korean single-syllable nouns are kept (TITLE_MIN_TOKEN_LEN_KO=1)', () => {
    const t = extractTitleTokens('적은 돈을 큰 돈으로 불리는');
    // '돈을' → strip '을' → '돈' (KO single-syllable, kept) ← key recall win
    // '돈으로' → strip '으로' → '돈' (kept)
    // '큰' → length 1 KO content, kept
    // '적은' → strip '은' → '적' (kept; verb-adjective stem residue)
    // '불리는' → strip '는' → '불리' (kept)
    expect(t).toContain('돈');
    expect(t).toContain('큰');
    expect(t).toContain('적');
    expect(t).toContain('불리');
  });

  test('English single-char tokens still dropped (no false positives)', () => {
    const t = extractTitleTokens('A B C abc');
    expect(t).toEqual(['abc']);
  });
});

describe('computeM1 — title-word recall in atoms', () => {
  test('all title tokens hit → 1.0', () => {
    const m1 = computeM1({
      title: '영어 리스닝 4원칙',
      atoms: [{ text: '영어 리스닝 4원칙의 첫째' }, { text: '4원칙 - 발음 노출' }],
    });
    expect(m1).toBeCloseTo(1, 3); // 영어, 리스닝, 4원칙 → all literal hit
  });

  test('zero hits → 0', () => {
    const m1 = computeM1({
      title: '수능 출제자',
      atoms: [{ text: 'something completely different' }],
    });
    expect(m1).toBe(0);
  });

  test('empty atoms → 0', () => {
    const m1 = computeM1({ title: '시간 관리', atoms: [] });
    expect(m1).toBe(0);
  });

  test('partial recall — half tokens hit', () => {
    const m1 = computeM1({
      title: '시간 관리 우선순위 핵심',
      atoms: [{ text: '시간 관리에 대한 이야기 (우선순위 미언급)' }],
    });
    // tokens: [시간, 관리, 우선순위, 핵심] → 시간/관리/우선순위 hit, 핵심 miss → 3/4
    expect(m1).toBeCloseTo(0.75, 3);
  });
});

describe('computeV2Quality — full pipeline', () => {
  test('all_null when atoms array empty', () => {
    const r = computeV2Quality({ title: 't', atoms: [] });
    expect(r.M3_class).toBe('all_null');
    expect(r.M3_score).toBe(0);
    expect(r.S).toBe(0);
  });

  test('all_null when every timestamp_sec is null', () => {
    const r = computeV2Quality({
      title: '리스닝',
      atoms: [
        { text: 'a', timestamp_sec: null },
        { text: 'b', timestamp_sec: null },
        { text: 'c', timestamp_sec: null },
      ],
    });
    expect(r.M3_class).toBe('all_null');
    expect(r.M3_score).toBe(0);
  });

  test('uniform_fake when all atom texts identical', () => {
    const r = computeV2Quality({
      title: 't',
      atoms: [
        { text: 'placeholder', timestamp_sec: 10 },
        { text: 'placeholder', timestamp_sec: 20 },
        { text: 'placeholder', timestamp_sec: 30 },
      ],
    });
    expect(r.M3_class).toBe('uniform_fake');
    expect(r.M3_score).toBe(0);
  });

  test('insufficient when fewer than 3 atoms (with timestamps + varied text)', () => {
    const r = computeV2Quality({
      title: '시간 관리',
      atoms: [
        { text: '첫 원칙', timestamp_sec: 10 },
        { text: '둘째 원칙', timestamp_sec: 20 },
      ],
    });
    expect(r.M3_class).toBe('insufficient');
    expect(r.M3_score).toBe(0);
  });

  test('mixed when some atoms have null timestamp', () => {
    const r = computeV2Quality({
      title: '시간 관리',
      atoms: [
        { text: '원칙 A', timestamp_sec: 10 },
        { text: '원칙 B', timestamp_sec: null },
        { text: '원칙 C', timestamp_sec: 30 },
      ],
    });
    expect(r.M3_class).toBe('mixed');
    expect(r.M3_score).toBe(0.5);
  });

  test('real with 0 null_ratio → M3_score=1', () => {
    const r = computeV2Quality({
      title: '시간 관리',
      atoms: [
        { text: '원칙 A', timestamp_sec: 10 },
        { text: '원칙 B', timestamp_sec: 20 },
        { text: '원칙 C', timestamp_sec: 30 },
      ],
    });
    expect(r.M3_class).toBe('real');
    expect(r.M3_score).toBe(1);
  });

  test('S = 0.55 * M1 + 0.45 * M3_score', () => {
    const r = computeV2Quality({
      title: '리스닝 원칙',
      atoms: [
        { text: '리스닝 원칙 A', timestamp_sec: 10 },
        { text: '리스닝 원칙 B', timestamp_sec: 20 },
        { text: '리스닝 원칙 C', timestamp_sec: 30 },
      ],
    });
    expect(r.M1).toBeCloseTo(1, 3);
    expect(r.M3_score).toBe(1);
    expect(r.S).toBeCloseTo(1, 3);
  });

  test('meta diagnostic counts populated', () => {
    const r = computeV2Quality({
      title: '리스닝 원칙',
      atoms: [
        { text: 'A', timestamp_sec: 10 },
        { text: 'B', timestamp_sec: null },
      ],
    });
    expect(r.meta.atoms_total).toBe(2);
    expect(r.meta.atoms_with_ts).toBe(1);
    expect(r.meta.unique_text_count).toBe(2);
    expect(r.null_ratio).toBe(0.5);
  });
});
