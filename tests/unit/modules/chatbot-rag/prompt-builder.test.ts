/**
 * tests/unit/modules/chatbot-rag/prompt-builder.test.ts
 *
 * Unit tests for prompt-builder.ts CP474 extensions:
 *   - Backward compatibility: legacy params (no U/T/H) still produce the
 *     SFT-aligned format byte-for-byte (ROLE_AND_RULES_KO at the head).
 *   - includePersona toggle gates PRODUCT_PERSONA + EXTENDED_RULES.
 *   - Transcript fallback path engages LAYER_BLOCKS_FALLBACK when v2Data
 *     is absent but transcript present.
 *   - Block U / Block H format and skip rules.
 *   - EXTENDED_RULES appended only when any of {U, T, H} is in play.
 *
 * Pure functions — no mocks needed.
 */

import {
  buildQwenSystemPrompt,
  PRODUCT_PERSONA_KO,
  PRODUCT_PERSONA_EN,
  ROLE_AND_RULES_KO,
  ROLE_AND_RULES_EN,
  EXTENDED_RULES_KO,
  LAYER_BLOCKS,
  LAYER_BLOCKS_FALLBACK,
  type V2Summary,
  type MandalaContext,
  type RegionContext,
} from '@/modules/chatbot-rag/prompt-builder';
import type { UserContext, TranscriptContext, RAGContext } from '@/modules/chatbot-rag/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const V2: V2Summary = {
  title: '하프 1:30의 벽, 이것만 바꾸면 깨집니다',
  core: { one_liner: '속도/지구력/회복 균형이 1:30 벽을 깬다', domain: 'running' },
  analysis: {
    core_argument: '균형 잡힌 훈련',
    key_concepts: [
      { term: '인터벌', definition: '짧고 빠른 반복' },
      { term: 'LSD', definition: 'Long Slow Distance' },
    ],
    actionables: ['1km 인터벌 8-10세트 주 1회'],
  },
  segments: {
    sections: [{ idx: 0, title: '속도 훈련', from_sec: 103, to_sec: 201, summary: '인터벌 도입' }],
  },
};

const MANDALA: MandalaContext = {
  mandala_name: '마라톤 완주',
  center_goal: '하프 1:30',
};

const REGION: RegionContext = {
  active_region: 'player',
  layer: 'video-time',
  player_time_sec: 103,
  player_state: 'playing',
  current_section: '속도 훈련',
};

const USER: UserContext = {
  user_id: 'u-1',
  display_name: 'Jeonho',
  email: 'jeonho@example.com',
  tier: 'lifetime',
  join_date: '2026-01-15',
  days_active: 125,
  mandala_count: 3,
  mandala_titles: ['마라톤 완주', 'Python 풀스택', '프랑스어 B1'],
  current_mandala_name: '마라톤 완주',
  recent_card_count_7d: 12,
  preferred_language: 'ko',
};

const TRANSCRIPT: TranscriptContext = {
  full_text: '안녕하세요 하프 마라톤 훈련법을 소개합니다',
  source: 'mac-mini',
  language: 'ko',
  truncated: false,
  total_chars: 22,
};

const RAG: RAGContext = {
  query: '인터벌',
  retrieved_at: '2026-05-20T00:00:00.000Z',
  results: [
    {
      source_type: 'card',
      title: 'VO2 Max 5x5',
      excerpt: '1km 인터벌 VO2 Max 향상',
      mandala_name: '마라톤 완주',
      cell_name: '속도',
      date: '2026-04-22',
      similarity: 0.92,
    },
    {
      source_type: 'note',
      title: '5km TT 페이스 메모',
      excerpt: '5:10 → 4:55 목표',
      mandala_name: '마라톤 완주',
      date: '2026-05-02',
    },
  ],
};

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------

describe('buildQwenSystemPrompt — backward compatibility', () => {
  it('produces SFT-aligned format (no persona) when includePersona=false', () => {
    const out = buildQwenSystemPrompt({
      layer: 'video',
      language: 'ko',
      v2Data: V2,
      includePersona: false,
    });

    expect(out).not.toContain(PRODUCT_PERSONA_KO);
    expect(out).not.toContain(EXTENDED_RULES_KO);
    // ROLE_AND_RULES_KO must be the very first block — SFT distribution match.
    expect(out.startsWith(ROLE_AND_RULES_KO)).toBe(true);
  });

  it('legacy params produce no Block U / H / T headers', () => {
    const out = buildQwenSystemPrompt({
      layer: 'video',
      language: 'ko',
      v2Data: V2,
      includePersona: false,
    });

    expect(out).not.toContain('[사용자 컨텍스트]');
    expect(out).not.toContain('[관련 자료');
    expect(out).not.toContain('[원본 자막]');
  });
});

// ---------------------------------------------------------------------------
// Persona + extended rules (CP474)
// ---------------------------------------------------------------------------

describe('buildQwenSystemPrompt — persona + extended rules', () => {
  it('prepends PRODUCT_PERSONA_KO when includePersona=true (default)', () => {
    const out = buildQwenSystemPrompt({
      layer: 'video',
      language: 'ko',
      v2Data: V2,
    });

    expect(out.startsWith(PRODUCT_PERSONA_KO)).toBe(true);
    expect(out).toContain(ROLE_AND_RULES_KO);
  });

  it('uses EN persona for language="en"', () => {
    const out = buildQwenSystemPrompt({
      layer: 'video',
      language: 'en',
      v2Data: V2,
    });

    expect(out.startsWith(PRODUCT_PERSONA_EN)).toBe(true);
    expect(out).toContain(ROLE_AND_RULES_EN);
  });

  it('appends EXTENDED_RULES_KO only when a CP474 block (U/T/H) is present', () => {
    const withoutExt = buildQwenSystemPrompt({
      layer: 'video',
      language: 'ko',
      v2Data: V2,
    });
    expect(withoutExt).not.toContain(EXTENDED_RULES_KO);

    const withUser = buildQwenSystemPrompt({
      layer: 'video',
      language: 'ko',
      v2Data: V2,
      userContext: USER,
    });
    expect(withUser).toContain(EXTENDED_RULES_KO);
  });

  it('appends EXTENDED_RULES when transcript fallback engaged', () => {
    const out = buildQwenSystemPrompt({
      layer: 'video',
      language: 'ko',
      v2Data: null,
      transcript: TRANSCRIPT,
    });
    expect(out).toContain(EXTENDED_RULES_KO);
  });
});

// ---------------------------------------------------------------------------
// Block U — user context
// ---------------------------------------------------------------------------

describe('buildQwenSystemPrompt — Block U (user context)', () => {
  it('renders user context with tier, mandalas, current mandala, recent activity', () => {
    const out = buildQwenSystemPrompt({
      layer: 'video',
      language: 'ko',
      v2Data: V2,
      userContext: USER,
    });

    expect(out).toContain('[사용자 컨텍스트]');
    expect(out).toContain('사용자: Jeonho (jeonho@example.com)');
    expect(out).toContain('Tier: lifetime');
    expect(out).toContain('운영 중인 만다라: 3개');
    expect(out).toContain('현재 만다라: 마라톤 완주');
    expect(out).toContain('이번 주 학습 카드: 12개');
  });

  it('omits Block U entirely for a blank user (free tier, no mandalas, no email)', () => {
    const blankUser: UserContext = {
      user_id: 'u-empty',
      display_name: 'user',
      email: '',
      tier: 'free',
      join_date: '',
      days_active: 0,
      mandala_count: 0,
      mandala_titles: [],
      recent_card_count_7d: 0,
      preferred_language: 'ko',
    };

    const out = buildQwenSystemPrompt({
      layer: 'video',
      language: 'ko',
      v2Data: V2,
      userContext: blankUser,
    });

    expect(out).not.toContain('[사용자 컨텍스트]');
  });
});

// ---------------------------------------------------------------------------
// Block H — RAG context
// ---------------------------------------------------------------------------

describe('buildQwenSystemPrompt — Block H (RAG)', () => {
  it('renders RAG results with source attribution (card / note)', () => {
    const out = buildQwenSystemPrompt({
      layer: 'video',
      language: 'ko',
      v2Data: V2,
      ragContext: RAG,
    });

    expect(out).toContain('[관련 자료 (RAG)]');
    expect(out).toContain('저장 카드');
    expect(out).toContain('내 노트');
    expect(out).toContain('VO2 Max 5x5');
    expect(out).toContain('5km TT 페이스 메모');
    expect(out).toContain('(2026-04-22)');
    expect(out).toContain('(2026-05-02)');
  });

  it('omits Block H when ragContext has empty results', () => {
    const emptyRAG: RAGContext = {
      query: 'unrelated',
      retrieved_at: '2026-05-20T00:00:00.000Z',
      results: [],
    };

    const out = buildQwenSystemPrompt({
      layer: 'video',
      language: 'ko',
      v2Data: V2,
      ragContext: emptyRAG,
    });

    // Block-specific content (RAG result titles) MUST NOT appear. The
    // header '[관련 자료 (RAG)]' is also referenced inside EXTENDED_RULES_KO,
    // so we check unique result-row content instead of the header alone.
    expect(out).not.toContain('VO2 Max 5x5');
    expect(out).not.toContain('5km TT 페이스 메모');
    expect(out).not.toContain('저장 카드');
  });

  it('renders kg_node results with KG link annotations', () => {
    const kgRAG: RAGContext = {
      query: '인터벌',
      retrieved_at: '2026-05-20T00:00:00.000Z',
      results: [
        {
          source_type: 'kg_node',
          title: '인터벌 훈련',
          excerpt: 'VO2 Max 강화',
          kg_links: [
            { concept: 'VO2 Max', card_count: 8 },
            { concept: '젖산 임계점', card_count: 5 },
          ],
        },
      ],
    };

    const out = buildQwenSystemPrompt({
      layer: 'video',
      language: 'ko',
      v2Data: V2,
      ragContext: kgRAG,
    });

    expect(out).toContain('Knowledge Graph');
    expect(out).toContain('연결: VO2 Max (8 카드), 젖산 임계점 (5 카드)');
  });
});

// ---------------------------------------------------------------------------
// Block T — transcript fallback
// ---------------------------------------------------------------------------

describe('buildQwenSystemPrompt — Block T (transcript fallback)', () => {
  it('engages LAYER_BLOCKS_FALLBACK when v2Data absent and transcript present', () => {
    const out = buildQwenSystemPrompt({
      layer: 'video',
      language: 'ko',
      v2Data: null,
      transcript: TRANSCRIPT,
    });

    expect(out).toContain('출처: mac-mini');
    expect(out).toContain('안녕하세요 하프 마라톤');
    // v2-only block markers (NOT referenced in EXTENDED_RULES) must be absent.
    expect(out).not.toContain('[핵심 개념]');
    expect(out).not.toContain('[실행 아이템]');
    expect(out).not.toContain('[구간별 내용]');
    // V2-specific values must also be absent.
    expect(out).not.toContain('속도/지구력/회복 균형');
  });

  it('appends truncation note when transcript.truncated=true', () => {
    const truncated: TranscriptContext = { ...TRANSCRIPT, truncated: true };
    const out = buildQwenSystemPrompt({
      layer: 'video',
      language: 'ko',
      transcript: truncated,
    });

    expect(out).toContain('[자막 일부 잘림');
  });

  it('v2 wins over transcript when both supplied', () => {
    const out = buildQwenSystemPrompt({
      layer: 'video',
      language: 'ko',
      v2Data: V2,
      transcript: TRANSCRIPT,
    });

    // v2 specific value present
    expect(out).toContain('속도/지구력/회복 균형');
    // Transcript-unique content (the actual fulltext) must be absent — the
    // `[원본 자막]` header is also referenced inside EXTENDED_RULES_KO so we
    // assert against the transcript body itself.
    expect(out).not.toContain('안녕하세요 하프 마라톤');
    expect(out).not.toContain('출처: mac-mini');
  });
});

// ---------------------------------------------------------------------------
// Layer mapping sanity
// ---------------------------------------------------------------------------

describe('LAYER_BLOCKS shape', () => {
  it('includes U and H in every standard layer', () => {
    for (const blocks of Object.values(LAYER_BLOCKS)) {
      expect(blocks).toContain('U');
      expect(blocks).toContain('H');
    }
  });

  it('LAYER_BLOCKS_FALLBACK substitutes T for A-D blocks', () => {
    // CP477+15 (#742 b1ce8350): fallback layers gained structural blocks E/I/J/N
    // and block order is now U → mandala → book → cards → note → video
    // (prompt-builder.ts:239 LAYER_BLOCKS_FALLBACK).
    expect(LAYER_BLOCKS_FALLBACK.video).toEqual(['U', 'E', 'I', 'J', 'N', 'T', 'H']);
    expect(LAYER_BLOCKS_FALLBACK['video-time']).toEqual(['U', 'E', 'I', 'J', 'N', 'T', 'F', 'H']);
    for (const blocks of Object.values(LAYER_BLOCKS_FALLBACK)) {
      // Fallback layers must never carry the v2-grounded A-D blocks.
      expect(blocks).not.toContain('A');
      expect(blocks).not.toContain('B');
      expect(blocks).not.toContain('C');
      expect(blocks).not.toContain('D');
    }
  });
});

// ---------------------------------------------------------------------------
// End-to-end smoke: persona + user + v2 + mandala + region + RAG
// ---------------------------------------------------------------------------

describe('buildQwenSystemPrompt — full stack assembly', () => {
  it('assembles all blocks in the expected order for note layer', () => {
    const out = buildQwenSystemPrompt({
      layer: 'note',
      language: 'ko',
      v2Data: V2,
      mandalaContext: MANDALA,
      regionContext: { ...REGION, note_selection_text: '하이라이트' },
      userContext: USER,
      ragContext: RAG,
    });

    // Persona FIRST
    const idxPersona = out.indexOf(PRODUCT_PERSONA_KO);
    const idxRole = out.indexOf(ROLE_AND_RULES_KO);
    const idxExtended = out.indexOf(EXTENDED_RULES_KO);
    // The block-A header `[영상 정보]` is also mentioned inside EXTENDED_RULES_KO
    // for negative-case wording — use lastIndexOf to find the actual Block A
    // occurrence, which sits AFTER the rules block.
    const idxA = out.lastIndexOf('[영상 정보]');
    const idxE = out.indexOf('[만다라 컨텍스트]');
    const idxF = out.indexOf('[현재 상태]');
    const idxG = out.indexOf('[노트 컨텍스트]');
    const idxU = out.indexOf('[사용자 컨텍스트]');
    // Block H header `[관련 자료 (RAG)]` is also referenced inside EXTENDED_RULES_KO;
    // use lastIndexOf so we pick the actual Block H occurrence rather than the
    // rules-text mention.
    const idxH = out.lastIndexOf('[관련 자료 (RAG)]');

    expect(idxPersona).toBe(0);
    expect(idxRole).toBeGreaterThan(idxPersona);
    expect(idxExtended).toBeGreaterThan(idxRole);
    // CP477+15 (#742 b1ce8350): LAYER_BLOCKS.note =
    // ['U','E','I','J','N','A','B','C','D','F','G','H'] (prompt-builder.ts:230)
    // — E now attaches to every mandala-scoped layer, and blocks render in
    // user → mandala → video → state → note → RAG order.
    expect(idxU).toBeGreaterThan(idxExtended);
    expect(idxE).toBeGreaterThan(idxU);
    expect(idxA).toBeGreaterThan(idxE);
    expect(idxF).toBeGreaterThan(idxA);
    expect(idxG).toBeGreaterThan(idxF);
    expect(idxH).toBeGreaterThan(idxG);
  });
});
