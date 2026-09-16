/**
 * tests/unit/modules/chatbot-rag/brief-context-loader.test.ts
 *
 * Unit tests for the brief context loader (work order 2026-09-15 §2.1).
 *
 * Coverage:
 *   - Published issue → BriefContext: label from issue_no, category from the
 *     row, headline, stories flattened (HTML stripped, grade tags verbatim,
 *     table cells joined), navLabel read from the raw JSON when present,
 *     picks with capped v2 summaries, refs kept.
 *   - Story text capped at BRIEF_STORY_TEXT_MAX.
 *   - Pick summaries capped per pick and in total.
 *   - Draft (published_at null) → null, no video lookups.
 *   - Unknown slug → null.
 *   - Invalid content_json → null + warning.
 *   - Pick lookup rejection → pick kept without summary.
 *   - Video lookups never start a transcript fetch (skipTranscript: true).
 *
 * Mocks: Prisma client + video-context-loader. No DB, no network.
 */

const mockFindUnique = jest.fn();
const mockLoadVideoContext = jest.fn();
const mockWarn = jest.fn();

jest.mock('@/utils/logger', () => {
  type Logger = {
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    debug: jest.Mock;
    child: () => Logger;
  };
  const childLogger: Logger = {
    info: jest.fn(),
    warn: mockWarn,
    error: jest.fn(),
    debug: jest.fn(),
    child: () => childLogger,
  };
  return { logger: childLogger };
});

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    newsletter_issues: { findUnique: mockFindUnique },
  }),
}));

jest.mock('@/modules/chatbot-rag/video-context-loader', () => ({
  loadVideoContext: mockLoadVideoContext,
}));

import { loadBriefContext } from '@/modules/chatbot-rag/brief-context-loader';
import {
  BRIEF_PICK_SUMMARY_MAX,
  BRIEF_PICKS_TOTAL_MAX,
  BRIEF_STORY_TEXT_MAX,
} from '@/modules/chatbot-rag/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SLUG = 'ai-tech-2026-09-02';
const PUBLISHED_AT = new Date('2026-09-02T00:00:00.000Z');

/** Minimal document that passes IssueDocumentSchema. */
function makeIssueDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    slug: SLUG,
    category: 'AI 기술',
    categoryKey: 'ai-tech',
    // Editor-written label; the loader must print the row's issue_no instead.
    issueLabel: '제1호',
    dateLabel: '2026년 9월 2일',
    publishedAt: PUBLISHED_AT.toISOString(),
    headline: ['에이전트가 읽은 것은 전부 명령이 될 수 있다', '신뢰 경계는 부팅과 결제에 있었다'],
    dek: '<strong>데크</strong>',
    runline: '런라인',
    preview: '미리보기',
    interest: {
      intro: '인트로',
      ledgerCaption: '캡션',
      ledger: [{ name: 'CVE', grade: 'verified', ref: 1, desc: '설명', value: '1' }],
    },
    stories: [
      {
        kicker: '신뢰 경계',
        title: '부팅이 먼저다',
        navLabel: '부팅',
        blocks: [
          {
            type: 'lede',
            html: '설정 파일이 먼저 실행된다 (<code>1IbrFrdll4U</code>) <code>[영상]</code>.',
          },
          { type: 'p', html: 'Anthropic은 패치를 냈다 <code>[확인]</code>.' },
          { type: 'h3', text: '소제목' },
          { type: 'note', lead: '편집자 주', html: '주의 <em>강조</em>' },
          {
            type: 'table',
            head: ['항목', '값'],
            rows: [
              ['A', '1'],
              ['B', '2'],
            ],
          },
        ],
      },
      {
        kicker: '비용',
        title: '토큰 단가',
        blocks: [{ type: 'p', html: '단가가 내렸다.' }],
      },
    ],
    insight: { blocks: [{ type: 'p', html: '인사이트' }] },
    picks: [
      { title: 'Pick One', meta: '채널 · 1회', body: '첫 번째 추천', videoId: 'vid00000001' },
      { title: 'Pick Two', meta: '채널 · 2회', body: '두 번째 추천', videoId: 'vid00000002' },
      { title: 'Pick Three', meta: '채널 · 3회', body: '영상 없음' },
    ],
    next: { intro: '다음 호', checkpoints: [{ when: '9월 9일', title: '체크' }] },
    refs: [
      {
        label: 'CVE-2025-59536',
        sources: [
          { name: 'NVD', url: 'https://nvd.nist.gov/vuln/detail/CVE-2025-59536' },
          { name: 'Check Point Research' },
        ],
      },
    ],
    gradeNote: '등급 설명',
    editNote: '편집 노트',
    sign: '편집장',
    ...overrides,
  };
}

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issue_no: 7,
    category_key: 'ai-tech',
    locale: 'ko',
    content_json: makeIssueDoc(),
    published_at: PUBLISHED_AT,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindUnique.mockResolvedValue(makeRow());
  mockLoadVideoContext.mockImplementation(({ youtubeVideoId }: { youtubeVideoId: string }) =>
    Promise.resolve({
      v2Data: { core: { one_liner: `요약 ${youtubeVideoId}` }, analysis: null, segments: null },
      transcript: null,
    })
  );
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('loadBriefContext — published issue', () => {
  it('looks the issue up by slug', async () => {
    await loadBriefContext(SLUG);

    expect(mockFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: SLUG } }));
  });

  it('prints the label from issue_no, not the editor string in the document', async () => {
    const ctx = await loadBriefContext(SLUG);

    expect(ctx?.issueLabel).toBe('제7호');
    expect(ctx?.categoryKey).toBe('ai-tech');
    expect(ctx?.slug).toBe(SLUG);
  });

  it('uses the English label when the row locale is en', async () => {
    mockFindUnique.mockResolvedValueOnce(makeRow({ locale: 'en' }));

    const ctx = await loadBriefContext(SLUG);

    expect(ctx?.issueLabel).toBe('No. 7');
  });

  it('keeps the headline lines as written', async () => {
    const ctx = await loadBriefContext(SLUG);

    expect(ctx?.headline).toEqual([
      '에이전트가 읽은 것은 전부 명령이 될 수 있다',
      '신뢰 경계는 부팅과 결제에 있었다',
    ]);
  });

  it('flattens story blocks: HTML stripped, grade tags verbatim, table cells joined', async () => {
    const ctx = await loadBriefContext(SLUG);
    const story = ctx?.stories[0];

    expect(story?.kicker).toBe('신뢰 경계');
    expect(story?.title).toBe('부팅이 먼저다');
    expect(story?.text).toContain('설정 파일이 먼저 실행된다 (1IbrFrdll4U) [영상].');
    expect(story?.text).toContain('Anthropic은 패치를 냈다 [확인].');
    expect(story?.text).toContain('소제목');
    expect(story?.text).toContain('편집자 주: 주의 강조');
    expect(story?.text).toContain('항목 | 값\nA | 1\nB | 2');
    expect(story?.text).not.toContain('<code>');
    expect(story?.text).not.toContain('<em>');
  });

  it('passes navLabel through from the raw JSON when present, omits it otherwise', async () => {
    const ctx = await loadBriefContext(SLUG);

    expect(ctx?.stories[0]?.navLabel).toBe('부팅');
    expect(ctx?.stories[1]?.navLabel).toBeUndefined();
    expect(ctx?.stories[1]).not.toHaveProperty('navLabel');
  });

  it('caps story text at BRIEF_STORY_TEXT_MAX', async () => {
    const longStory = {
      kicker: '긴 스토리',
      title: '긴 제목',
      blocks: [{ type: 'p', html: 'x'.repeat(BRIEF_STORY_TEXT_MAX + 500) }],
    };
    mockFindUnique.mockResolvedValueOnce(
      makeRow({ content_json: makeIssueDoc({ stories: [longStory] }) })
    );

    const ctx = await loadBriefContext(SLUG);

    expect(ctx?.stories[0]?.text.length).toBe(BRIEF_STORY_TEXT_MAX);
  });

  it('keeps picks with the issue body and the v2 summary; no summary without a video', async () => {
    const ctx = await loadBriefContext(SLUG);

    expect(ctx?.picks).toEqual([
      {
        title: 'Pick One',
        body: '첫 번째 추천',
        videoId: 'vid00000001',
        summary: '요약 vid00000001',
      },
      {
        title: 'Pick Two',
        body: '두 번째 추천',
        videoId: 'vid00000002',
        summary: '요약 vid00000002',
      },
      { title: 'Pick Three', body: '영상 없음' },
    ]);
  });

  it('never starts a transcript fetch for a pick (skipTranscript: true)', async () => {
    await loadBriefContext(SLUG);

    expect(mockLoadVideoContext).toHaveBeenCalledTimes(2);
    for (const call of mockLoadVideoContext.mock.calls as Array<[{ skipTranscript?: boolean }]>) {
      expect(call[0].skipTranscript).toBe(true);
    }
  });

  it('joins one_liner and core_argument into the pick summary', async () => {
    mockLoadVideoContext.mockResolvedValue({
      v2Data: { core: { one_liner: '한 줄' }, analysis: { core_argument: '핵심 주장' } },
      transcript: null,
    });

    const ctx = await loadBriefContext(SLUG);

    expect(ctx?.picks[0]?.summary).toBe('한 줄 / 핵심 주장');
  });

  it('caps each pick summary at BRIEF_PICK_SUMMARY_MAX and the sum at BRIEF_PICKS_TOTAL_MAX', async () => {
    const picks = Array.from({ length: 5 }, (_, i) => ({
      title: `Pick ${i + 1}`,
      meta: '채널',
      body: '본문',
      videoId: `vid0000000${i + 1}`,
    }));
    mockFindUnique.mockResolvedValueOnce(makeRow({ content_json: makeIssueDoc({ picks }) }));
    mockLoadVideoContext.mockResolvedValue({
      v2Data: { core: { one_liner: 'y'.repeat(BRIEF_PICK_SUMMARY_MAX + 100) } },
      transcript: null,
    });

    const ctx = await loadBriefContext(SLUG);
    const lengths = ctx?.picks.map((p) => p.summary?.length);

    // 600 + 600 + 600 = 1800; the 4th gets the remaining 200; the 5th none.
    const remainder = BRIEF_PICKS_TOTAL_MAX - 3 * BRIEF_PICK_SUMMARY_MAX;
    expect(lengths).toEqual([
      BRIEF_PICK_SUMMARY_MAX,
      BRIEF_PICK_SUMMARY_MAX,
      BRIEF_PICK_SUMMARY_MAX,
      remainder,
      undefined,
    ]);
    const total = ctx?.picks.reduce((n, p) => n + (p.summary?.length ?? 0), 0);
    expect(total).toBe(BRIEF_PICKS_TOTAL_MAX);
  });

  it('keeps refs with label and sources (url appended when present)', async () => {
    const ctx = await loadBriefContext(SLUG);

    expect(ctx?.refs).toEqual([
      {
        label: 'CVE-2025-59536',
        sources: ['NVD (https://nvd.nist.gov/vuln/detail/CVE-2025-59536)', 'Check Point Research'],
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Null paths
// ---------------------------------------------------------------------------

describe('loadBriefContext — null paths', () => {
  it('returns null for a draft (published_at null) and loads no videos', async () => {
    mockFindUnique.mockResolvedValueOnce(makeRow({ published_at: null }));

    const ctx = await loadBriefContext(SLUG);

    expect(ctx).toBeNull();
    expect(mockLoadVideoContext).not.toHaveBeenCalled();
  });

  it('returns null for an unknown slug', async () => {
    mockFindUnique.mockResolvedValueOnce(null);

    const ctx = await loadBriefContext('no-such-issue');

    expect(ctx).toBeNull();
    expect(mockLoadVideoContext).not.toHaveBeenCalled();
  });

  it('returns null for an empty slug without touching the DB', async () => {
    const ctx = await loadBriefContext('');

    expect(ctx).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it('returns null and warns when content_json fails schema validation', async () => {
    mockFindUnique.mockResolvedValueOnce(makeRow({ content_json: { schemaVersion: 1 } }));

    const ctx = await loadBriefContext(SLUG);

    expect(ctx).toBeNull();
    expect(mockWarn).toHaveBeenCalledWith(
      'brief content_json failed schema validation',
      expect.objectContaining({ slug: SLUG })
    );
  });

  it('returns null when the DB lookup throws', async () => {
    mockFindUnique.mockRejectedValueOnce(new Error('db down'));

    const ctx = await loadBriefContext(SLUG);

    expect(ctx).toBeNull();
    expect(mockWarn).toHaveBeenCalledWith(
      'brief lookup failed',
      expect.objectContaining({ slug: SLUG })
    );
  });
});

// ---------------------------------------------------------------------------
// Pick loading is fail-safe
// ---------------------------------------------------------------------------

describe('loadBriefContext — pick failures', () => {
  it('keeps the pick without a summary when its video lookup rejects', async () => {
    mockLoadVideoContext.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({
      v2Data: { core: { one_liner: '두 번째 요약' } },
      transcript: null,
    });

    const ctx = await loadBriefContext(SLUG);

    expect(ctx).not.toBeNull();
    expect(ctx?.picks[0]).toEqual({
      title: 'Pick One',
      body: '첫 번째 추천',
      videoId: 'vid00000001',
    });
    expect(ctx?.picks[1]?.summary).toBe('두 번째 요약');
  });

  it('keeps the pick without a summary when no v2 row exists', async () => {
    mockLoadVideoContext.mockResolvedValue({ v2Data: null, transcript: null });

    const ctx = await loadBriefContext(SLUG);

    expect(ctx?.picks[0]?.summary).toBeUndefined();
    expect(ctx?.picks[0]?.body).toBe('첫 번째 추천');
  });
});
