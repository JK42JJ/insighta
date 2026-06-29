/**
 * book-research (§4.5.1 loop-2-B STORM research, CP504).
 * OpenRouter (Haiku) + CSE are MOCKED — LLM-API ban enforced.
 * Gates locked:
 *   P-2B-REF    every ResearchFinding.reference.url is non-empty
 *   P-2B-NO-ARTICLE  result has only findings[], never chapters/outline
 *   P-2B-BORDER fact comes from CSE snippet, module does not invent
 *   parse       non-JSON / no gaps array / all invalid → ok:false; fence-strip; cap MAX_GAPS
 *   retrieval   CSE error or empty items → gap dropped; items → finding with reference
 */

const mockGenerate = jest.fn();
jest.mock('@/modules/llm/openrouter', () => ({
  OpenRouterGenerationProvider: jest.fn().mockImplementation(() => ({ generate: mockGenerate })),
}));
jest.mock('@/config/index', () => ({
  config: { paths: { logs: '/tmp' }, app: { isTest: true } },
}));
jest.mock('@/modules/google-cse', () => ({
  createGoogleCseClient: jest.fn().mockReturnValue({ searchWeb: jest.fn() }),
  loadGoogleCseConfig: jest.fn().mockReturnValue({ apiKey: '', cx: '', enabled: false }),
}));

import {
  parsePerspectiveResponse,
  gapsToQueries,
  retrieveForGaps,
  researchBookGaps,
  type ResearchChapterInput,
  type ResearchGap,
} from '../../../src/modules/mandala-book/book-research';

const mockCse = { searchWeb: jest.fn() };

beforeEach(() => {
  mockGenerate.mockReset();
  mockCse.searchWeb.mockReset();
});

// ─── parsePerspectiveResponse (pure — no LLM) ────────────────────────────────

describe('parsePerspectiveResponse (pure — no LLM)', () => {
  it('parses valid gaps JSON and returns perspectives', () => {
    const raw = JSON.stringify({
      gaps: [{ chapterTitle: '기초', perspective: 'missing context', query: 'context query' }],
    });
    const r = parsePerspectiveResponse(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.perspectives).toHaveLength(1);
      expect(r.perspectives[0]).toEqual({
        chapterTitle: '기초',
        perspective: 'missing context',
        query: 'context query',
      });
    }
  });

  it('strips code fences before parsing', () => {
    const raw =
      '```json\n{"gaps":[{"chapterTitle":"A","perspective":"p","query":"q"}]}\n```';
    const r = parsePerspectiveResponse(raw);
    expect(r.ok).toBe(true);
  });

  it('returns ok:false on non-JSON input', () => {
    expect(parsePerspectiveResponse('not json').ok).toBe(false);
  });

  it('returns ok:false when gaps is not an array', () => {
    expect(parsePerspectiveResponse('{"gaps":"wrong"}').ok).toBe(false);
  });

  it('drops entries with missing or empty required fields', () => {
    const raw = JSON.stringify({
      gaps: [
        { chapterTitle: '', perspective: 'x', query: 'q' }, // empty chapterTitle → drop
        { chapterTitle: 'A', perspective: 'p', query: 'q' }, // valid
      ],
    });
    const r = parsePerspectiveResponse(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.perspectives).toHaveLength(1);
  });

  it('returns ok:false when all gap entries are invalid', () => {
    const raw = JSON.stringify({ gaps: [{ chapterTitle: '', perspective: '', query: '' }] });
    expect(parsePerspectiveResponse(raw).ok).toBe(false);
  });

  it('caps at MAX_GAPS (6) entries even if LLM returns more', () => {
    const gaps = Array.from({ length: 10 }, (_, i) => ({
      chapterTitle: `Ch${i}`,
      perspective: `p${i}`,
      query: `q${i}`,
    }));
    const r = parsePerspectiveResponse(JSON.stringify({ gaps }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.perspectives.length).toBeLessThanOrEqual(6);
  });
});

// ─── gapsToQueries (pure) ────────────────────────────────────────────────────

describe('gapsToQueries (pure)', () => {
  it('extracts query strings from gaps', () => {
    const gaps: ResearchGap[] = [
      { chapterTitle: 'A', perspective: 'p1', query: 'foo search' },
      { chapterTitle: 'B', perspective: 'p2', query: 'bar search' },
    ];
    expect(gapsToQueries(gaps)).toEqual(['foo search', 'bar search']);
  });

  it('returns empty array for empty input', () => {
    expect(gapsToQueries([])).toEqual([]);
  });
});

// ─── retrieveForGaps ─────────────────────────────────────────────────────────

describe('retrieveForGaps', () => {
  const gap: ResearchGap = {
    chapterTitle: '기초 챕터',
    perspective: 'missing historical context',
    query: 'history context query',
  };

  it('P-2B-REF: every finding has a non-empty reference.url from CSE item.link', async () => {
    mockCse.searchWeb.mockResolvedValueOnce({
      items: [
        {
          title: 'Web Article',
          link: 'https://example.com/art',
          snippet: 'Key fact here.',
          displayLink: 'example.com',
        },
      ],
      totalResults: 1,
    });
    const findings = await retrieveForGaps([gap], mockCse);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.reference.url).toBe('https://example.com/art');
    expect(f.reference.url).not.toBe('');
  });

  it('P-2B-BORDER: fact is derived from CSE snippet, not invented', async () => {
    const snippet = 'This is a factual snippet from the web.';
    mockCse.searchWeb.mockResolvedValueOnce({
      items: [
        { title: 'T', link: 'https://src.com', snippet, displayLink: 'src.com' },
      ],
      totalResults: 1,
    });
    const findings = await retrieveForGaps([gap], mockCse);
    expect(findings[0]!.fact).toBe(snippet);
  });

  it('drops gap when CSE returns an error (no fabrication)', async () => {
    mockCse.searchWeb.mockResolvedValueOnce({
      items: [],
      totalResults: 0,
      error: 'CSE API HTTP 429',
    });
    const findings = await retrieveForGaps([gap], mockCse);
    expect(findings).toHaveLength(0);
  });

  it('drops gap when CSE returns empty items (no fabrication)', async () => {
    mockCse.searchWeb.mockResolvedValueOnce({ items: [], totalResults: 0 });
    const findings = await retrieveForGaps([gap], mockCse);
    expect(findings).toHaveLength(0);
  });

  it('fills findings for successful gaps, drops failed ones (partial)', async () => {
    const gap2: ResearchGap = { chapterTitle: 'B', perspective: 'p', query: 'q2' };
    mockCse.searchWeb
      .mockResolvedValueOnce({ items: [], totalResults: 0, error: 'fail' })
      .mockResolvedValueOnce({
        items: [
          {
            title: 'T2',
            link: 'https://b.com',
            snippet: 'B fact',
            displayLink: 'b.com',
          },
        ],
        totalResults: 1,
      });
    const findings = await retrieveForGaps([gap, gap2], mockCse);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.chapterTitle).toBe('B');
  });
});

// ─── researchBookGaps (integration — LLM + CSE both mocked) ──────────────────

describe('researchBookGaps', () => {
  const chapters: ResearchChapterInput[] = [
    { title: '기초', intro: '기초 소개', sectionSummaries: ['개요', '역사'] },
    { title: '실전', intro: '실전 응용', sectionSummaries: ['사례', '연습'] },
  ];

  const gapsJson = JSON.stringify({
    gaps: [{ chapterTitle: '기초', perspective: 'missing depth', query: 'deep dive query' }],
  });

  it('ok path: gaps → findings with references (P-2B-REF + P-2B-NO-ARTICLE)', async () => {
    mockGenerate.mockResolvedValueOnce(gapsJson);
    mockCse.searchWeb.mockResolvedValueOnce({
      items: [
        {
          title: 'Ref Title',
          link: 'https://ref.com',
          snippet: 'A real fact.',
          displayLink: 'ref.com',
        },
      ],
      totalResults: 1,
    });
    const r = await researchBookGaps(chapters, '목표', mockCse);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.findings.length).toBeGreaterThan(0);
      // P-2B-REF: every finding has non-empty url
      for (const f of r.findings) {
        expect(f.reference.url).not.toBe('');
      }
      // P-2B-NO-ARTICLE: result shape has only findings, no chapters/outline/sections
      expect(r).not.toHaveProperty('chapters');
      expect(r).not.toHaveProperty('outline');
      expect(r).not.toHaveProperty('sections');
    }
  });

  it('returns ok:false immediately on empty chapters — no LLM call', async () => {
    const r = await researchBookGaps([], '목표', mockCse);
    expect(r.ok).toBe(false);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('retries then hard-fails on provider error', async () => {
    mockGenerate.mockRejectedValue(new Error('network down'));
    const r = await researchBookGaps(chapters, '목표', mockCse);
    expect(r.ok).toBe(false);
    expect(mockGenerate).toHaveBeenCalledTimes(2); // RESEARCH_ATTEMPTS
  });

  it('retries then hard-fails on repeated parse failure', async () => {
    mockGenerate.mockResolvedValue('not json at all');
    const r = await researchBookGaps(chapters, '목표', mockCse);
    expect(r.ok).toBe(false);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it('returns ok:true with empty findings when all CSE gaps fail (no fabrication)', async () => {
    mockGenerate.mockResolvedValueOnce(gapsJson);
    mockCse.searchWeb.mockResolvedValueOnce({
      items: [],
      totalResults: 0,
      error: 'cse disabled',
    });
    const r = await researchBookGaps(chapters, '목표', mockCse);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.findings).toHaveLength(0);
  });
});
