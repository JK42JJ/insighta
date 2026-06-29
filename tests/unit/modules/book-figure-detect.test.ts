/**
 * book-figure-detect (CP505 [CV-NOTE-WIRE]) — Haiku-powered figure target detection.
 * OpenRouter Haiku is MOCKED (no live LLM — LLM-API ban).
 * Locks:
 *   - Cap enforcement: detectFigureTargets never returns more than 8 targets
 *   - Atom grounding: tsSec MUST be an atom ts for (videoId, section)
 *   - Empty book (no atoms): returns [] without calling LLM
 *   - LLM / parse failure → [] (never throws)
 */

const mockGenerate = jest.fn();
jest.mock('@/modules/llm/openrouter', () => ({
  OpenRouterGenerationProvider: jest.fn().mockImplementation(() => ({ generate: mockGenerate })),
}));
jest.mock('@/config/index', () => ({
  config: { paths: { logs: '/tmp' }, app: { isTest: true } },
}));

import {
  detectFigureTargets,
  parseFigureDetectResponse,
  buildFigureDetectPrompt,
} from '../../../src/modules/mandala-book/book-figure-detect';
import type { BookJson } from '../../../src/modules/mandala-book/book-schema';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VID_A = 'dQw4w9WgXcQ';
const VID_B = 'aBcDeFgHiJk';

const ATOMS_A = [
  { vid: VID_A, ts: 10, text: 'Gradient descent minimizes the loss function L = sum(errors^2).' },
  { vid: VID_A, ts: 45, text: 'Backpropagation applies the chain rule to compute ∂L/∂w.' },
  { vid: VID_A, ts: 90, text: 'The softmax activation: σ(z)_i = e^(z_i) / sum(e^(z_j)).' },
];

/** Minimal valid BookJson with one chapter, one section, and ATOMS_A. */
function makeBook(overrideAtoms?: typeof ATOMS_A): BookJson {
  return {
    schema_version: 2,
    mandala_id: '00000000-0000-0000-0000-000000000001',
    mandala_title: 'Deep Learning Fundamentals',
    generated_at: '2026-01-01T00:00:00.000Z',
    source_videos: 1,
    source_atoms: (overrideAtoms ?? ATOMS_A).length,
    chapters: [
      {
        ch: 0,
        title: 'Optimization Methods',
        intro: 'Introduction to gradient-based optimization.',
        sections: [
          {
            title: 'Gradient Descent',
            narrative: 'Gradient descent iteratively updates weights to minimize the loss.',
            atoms: overrideAtoms ?? ATOMS_A,
            qa: [],
            provenance: null,
            verification: null,
          },
        ],
      },
    ],
  };
}

/** Book with 2 chapters × 2 sections, each with 5 atoms from different videos. */
function makeLargeBook(): BookJson {
  const chapters = [0, 1].map((ci) => ({
    ch: ci,
    title: `Chapter ${ci}`,
    intro: 'Chapter intro.',
    sections: [0, 1].map((si) => ({
      title: `Section ${ci}.${si}`,
      narrative: 'Dense technical content.',
      atoms: [0, 1, 2, 3, 4].map((ai) => ({
        vid: `vid_${ci}_${si}`,
        ts: ai * 10,
        text: `Atom ${ai} technical text.`,
      })),
      qa: [] as [],
      provenance: null as null,
      verification: null as null,
    })),
  }));
  return {
    schema_version: 2,
    mandala_id: '00000000-0000-0000-0000-000000000002',
    mandala_title: 'AI Systems',
    generated_at: '2026-01-01T00:00:00.000Z',
    source_videos: 4,
    source_atoms: 20,
    chapters,
  };
}

/** Empty book with no sections. */
const EMPTY_BOOK: BookJson = {
  schema_version: 2,
  mandala_id: '00000000-0000-0000-0000-000000000003',
  mandala_title: 'Empty',
  generated_at: '2026-01-01T00:00:00.000Z',
  source_videos: 0,
  source_atoms: 0,
  chapters: [],
};

beforeEach(() => mockGenerate.mockReset());

// ---------------------------------------------------------------------------
// detectFigureTargets — high-level orchestrator (mocked LLM)
// ---------------------------------------------------------------------------

describe('detectFigureTargets', () => {
  it('returns valid grounded targets on well-formed LLM response', async () => {
    const response = JSON.stringify([
      { chapterIdx: 0, sectionIdx: 0, videoId: VID_A, tsSec: 90, reason: 'Softmax equation.' },
    ]);
    mockGenerate.mockResolvedValueOnce(response);

    const targets = await detectFigureTargets(makeBook(), { centerGoal: 'Deep Learning' });
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ videoId: VID_A, tsSec: 90, chapterIdx: 0, sectionIdx: 0 });
  });

  it('returns [] without calling LLM when book has no atoms', async () => {
    const targets = await detectFigureTargets(EMPTY_BOOK, { centerGoal: 'Empty' });
    expect(targets).toHaveLength(0);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('returns [] and does not throw when LLM throws', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('provider failure'));
    const targets = await detectFigureTargets(makeBook(), { centerGoal: 'Deep Learning' });
    expect(targets).toHaveLength(0);
  });

  it('returns [] when LLM returns non-JSON', async () => {
    mockGenerate.mockResolvedValueOnce('not json at all');
    const targets = await detectFigureTargets(makeBook(), { centerGoal: 'Deep Learning' });
    expect(targets).toHaveLength(0);
  });

  it('drops targets whose tsSec is not in section atoms', async () => {
    const response = JSON.stringify([
      { chapterIdx: 0, sectionIdx: 0, videoId: VID_A, tsSec: 999, reason: 'Invented timestamp.' },
      { chapterIdx: 0, sectionIdx: 0, videoId: VID_A, tsSec: 45, reason: 'Real timestamp.' },
    ]);
    mockGenerate.mockResolvedValueOnce(response);

    const targets = await detectFigureTargets(makeBook(), { centerGoal: 'Deep Learning' });
    expect(targets).toHaveLength(1);
    expect(targets[0]!.tsSec).toBe(45);
  });

  it('enforces hard cap of 8 regardless of LLM output length', async () => {
    const largeBook = makeLargeBook();
    // Build 10 valid items (all grounded in the large book's atoms).
    const items = [0, 1].flatMap((ci) =>
      [0, 1].flatMap((si) =>
        [0, 1, 2].map((ai) => ({
          chapterIdx: ci,
          sectionIdx: si,
          videoId: `vid_${ci}_${si}`,
          tsSec: ai * 10,
          reason: `Reason ${ci}.${si}.${ai}`,
        }))
      )
    );
    expect(items.length).toBeGreaterThan(8);
    mockGenerate.mockResolvedValueOnce(JSON.stringify(items));

    const targets = await detectFigureTargets(largeBook, { centerGoal: 'AI Systems' });
    expect(targets.length).toBeLessThanOrEqual(8);
  });

  it('uses the Haiku model (P-MODEL: contains "haiku")', async () => {
    mockGenerate.mockResolvedValueOnce(JSON.stringify([]));
    const { OpenRouterGenerationProvider } = jest.requireMock('@/modules/llm/openrouter') as {
      OpenRouterGenerationProvider: jest.Mock;
    };
    OpenRouterGenerationProvider.mockClear();

    await detectFigureTargets(makeBook(), { centerGoal: 'Deep Learning' });
    expect(OpenRouterGenerationProvider).toHaveBeenCalledWith(expect.stringMatching(/haiku/i));
  });
});

// ---------------------------------------------------------------------------
// parseFigureDetectResponse — pure parser (no mocks needed)
// ---------------------------------------------------------------------------

describe('parseFigureDetectResponse', () => {
  const book = makeBook();

  it('returns valid targets for a well-formed JSON array', () => {
    const raw = JSON.stringify([
      { chapterIdx: 0, sectionIdx: 0, videoId: VID_A, tsSec: 10, reason: 'Gradient descent.' },
    ]);
    const result = parseFigureDetectResponse(raw, book, 8);
    expect(result).toHaveLength(1);
    expect(result[0]!.tsSec).toBe(10);
  });

  it('strips code fences before parsing', () => {
    const inner = JSON.stringify([
      { chapterIdx: 0, sectionIdx: 0, videoId: VID_A, tsSec: 45, reason: 'Backprop.' },
    ]);
    const result = parseFigureDetectResponse(`\`\`\`json\n${inner}\n\`\`\``, book, 8);
    expect(result).toHaveLength(1);
  });

  it('returns [] on non-JSON input', () => {
    expect(parseFigureDetectResponse('not json', book, 8)).toHaveLength(0);
  });

  it('returns [] when JSON is an object (not array)', () => {
    expect(
      parseFigureDetectResponse('{"chapterIdx":0,"sectionIdx":0}', book, 8)
    ).toHaveLength(0);
  });

  it('drops items with tsSec not in section atoms (invented timestamp)', () => {
    const raw = JSON.stringify([
      { chapterIdx: 0, sectionIdx: 0, videoId: VID_A, tsSec: 999, reason: 'Fake.' },
    ]);
    expect(parseFigureDetectResponse(raw, book, 8)).toHaveLength(0);
  });

  it('drops items with videoId not matching any atom in that section', () => {
    const raw = JSON.stringify([
      { chapterIdx: 0, sectionIdx: 0, videoId: VID_B, tsSec: 10, reason: 'Wrong video.' },
    ]);
    expect(parseFigureDetectResponse(raw, book, 8)).toHaveLength(0);
  });

  it('drops items with out-of-bounds chapter index', () => {
    const raw = JSON.stringify([
      { chapterIdx: 99, sectionIdx: 0, videoId: VID_A, tsSec: 10, reason: 'Bad chapter.' },
    ]);
    expect(parseFigureDetectResponse(raw, book, 8)).toHaveLength(0);
  });

  it('drops items with out-of-bounds section index', () => {
    const raw = JSON.stringify([
      { chapterIdx: 0, sectionIdx: 99, videoId: VID_A, tsSec: 10, reason: 'Bad section.' },
    ]);
    expect(parseFigureDetectResponse(raw, book, 8)).toHaveLength(0);
  });

  it('enforces maxTargets cap — excess items are dropped', () => {
    const items = ATOMS_A.map((a) => ({
      chapterIdx: 0,
      sectionIdx: 0,
      videoId: a.vid,
      tsSec: a.ts,
      reason: 'Test.',
    }));
    // 3 valid items, cap at 2.
    const result = parseFigureDetectResponse(JSON.stringify(items), book, 2);
    expect(result).toHaveLength(2);
  });

  it('returns [] for empty JSON array', () => {
    expect(parseFigureDetectResponse('[]', book, 8)).toHaveLength(0);
  });

  it('drops items with negative or missing tsSec', () => {
    const raw = JSON.stringify([
      { chapterIdx: 0, sectionIdx: 0, videoId: VID_A, tsSec: -1, reason: 'Negative ts.' },
      { chapterIdx: 0, sectionIdx: 0, videoId: VID_A, reason: 'No tsSec.' },
    ]);
    expect(parseFigureDetectResponse(raw, book, 8)).toHaveLength(0);
  });

  it('drops items with empty reason string', () => {
    const raw = JSON.stringify([
      { chapterIdx: 0, sectionIdx: 0, videoId: VID_A, tsSec: 10, reason: '' },
    ]);
    expect(parseFigureDetectResponse(raw, book, 8)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildFigureDetectPrompt — pure builder (structural smoke test)
// ---------------------------------------------------------------------------

describe('buildFigureDetectPrompt', () => {
  it('includes the centerGoal in the prompt', () => {
    const prompt = buildFigureDetectPrompt(makeBook(), 'Neural Architecture Search', 8);
    expect(prompt).toContain('Neural Architecture Search');
  });

  it('includes section title and atom timestamps', () => {
    const prompt = buildFigureDetectPrompt(makeBook(), 'Deep Learning', 8);
    expect(prompt).toContain('Gradient Descent');
    expect(prompt).toContain('ts:10');
    expect(prompt).toContain('ts:90');
  });

  it('includes STEM-specific instructions (equations prioritized)', () => {
    const prompt = buildFigureDetectPrompt(makeBook(), 'Deep Learning', 8);
    expect(prompt).toMatch(/equation/i);
    expect(prompt).toMatch(/STEM/i);
  });

  it('includes the maxTargets value in the prompt', () => {
    const prompt = buildFigureDetectPrompt(makeBook(), 'Deep Learning', 5);
    expect(prompt).toContain('5');
  });

  it('handles empty chapters gracefully (no crash)', () => {
    expect(() => buildFigureDetectPrompt(EMPTY_BOOK, 'Empty', 8)).not.toThrow();
  });
});
