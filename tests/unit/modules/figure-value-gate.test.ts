/**
 * figure-value-gate — value gate that drops generic filler figures.
 *
 * Locks:
 *   - equation: always KEEP (no LLM call)
 *   - chart:    always KEEP (no LLM call)
 *   - table:    KEEP only if struct has headers[] + ≥2 rows[]
 *   - diagram:  KEEP when judge returns keep:true; DROP when keep:false or error
 *   - conservative default: DROP on parse failure or LLM error
 *
 * OpenRouterGenerationProvider is MOCKED (LLM-API ban).
 */

const mockGenerate = jest.fn();
jest.mock('@/modules/llm/openrouter', () => ({
  OpenRouterGenerationProvider: jest.fn().mockImplementation(() => ({ generate: mockGenerate })),
}));
jest.mock('@/config/index', () => ({
  config: { paths: { logs: '/tmp' }, app: { isTest: true } },
}));

import {
  passesFigureValueGate,
  judgeDiagram,
  parseJudgeResponse,
  buildDiagramJudgePrompt,
  summarizeDiagramStruct,
} from '../../../src/modules/mandala-book/figure-value-gate';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECTION_TITLE = 'Backpropagation';
const SECTION_NARRATIVE =
  'Backpropagation applies the chain rule to propagate error gradients through layers.';

const SPECIFIC_DIAGRAM_STRUCT = {
  nodes: [
    { id: 'L1', label: 'Input layer' },
    { id: 'L2', label: 'Hidden layer (ReLU)' },
    { id: 'L3', label: 'Output layer (softmax)' },
  ],
  edges: [
    { from: 'L1', to: 'L2', label: '∂L/∂w1' },
    { from: 'L2', to: 'L3', label: '∂L/∂w2' },
  ],
};

const GENERIC_DIAGRAM_STRUCT = {
  nodes: [{ label: 'neurons' }, { label: 'connections' }],
  edges: [{ from: 'neurons', to: 'connections' }],
};

const TABLE_GOOD_STRUCT = {
  headers: ['Layer', 'Activation', 'Params'],
  rows: [
    ['Conv1', 'ReLU', '9.4k'],
    ['Conv2', 'ReLU', '73.7k'],
    ['FC', 'Softmax', '400k'],
  ],
};

const TABLE_SINGLE_ROW_STRUCT = {
  headers: ['Metric', 'Value'],
  rows: [['Accuracy', '95%']],
};

const TABLE_NO_HEADERS_STRUCT = {
  rows: [
    ['a', 'b'],
    ['c', 'd'],
  ],
};

beforeEach(() => mockGenerate.mockReset());

// ---------------------------------------------------------------------------
// passesFigureValueGate — equation
// ---------------------------------------------------------------------------

describe('passesFigureValueGate: equation', () => {
  it('always KEEP, no LLM call', async () => {
    const result = await passesFigureValueGate({
      kind: 'equation',
      struct: undefined,
      sectionTitle: SECTION_TITLE,
      sectionNarrative: SECTION_NARRATIVE,
    });
    expect(result).toBe(true);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// passesFigureValueGate — chart
// ---------------------------------------------------------------------------

describe('passesFigureValueGate: chart', () => {
  it('always KEEP (SVG presence proves non-flat variance), no LLM call', async () => {
    const result = await passesFigureValueGate({
      kind: 'chart',
      struct: { type: 'bar', data: [] },
      sectionTitle: SECTION_TITLE,
      sectionNarrative: SECTION_NARRATIVE,
    });
    expect(result).toBe(true);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// passesFigureValueGate — table
// ---------------------------------------------------------------------------

describe('passesFigureValueGate: table', () => {
  it('KEEP when struct has headers and ≥2 rows', async () => {
    const result = await passesFigureValueGate({
      kind: 'table',
      struct: TABLE_GOOD_STRUCT,
      sectionTitle: SECTION_TITLE,
      sectionNarrative: SECTION_NARRATIVE,
    });
    expect(result).toBe(true);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('DROP when struct has only 1 row', async () => {
    const result = await passesFigureValueGate({
      kind: 'table',
      struct: TABLE_SINGLE_ROW_STRUCT,
      sectionTitle: SECTION_TITLE,
      sectionNarrative: SECTION_NARRATIVE,
    });
    expect(result).toBe(false);
  });

  it('DROP when struct has no headers', async () => {
    const result = await passesFigureValueGate({
      kind: 'table',
      struct: TABLE_NO_HEADERS_STRUCT,
      sectionTitle: SECTION_TITLE,
      sectionNarrative: SECTION_NARRATIVE,
    });
    expect(result).toBe(false);
  });

  it('DROP when struct is undefined', async () => {
    const result = await passesFigureValueGate({
      kind: 'table',
      struct: undefined,
      sectionTitle: SECTION_TITLE,
      sectionNarrative: SECTION_NARRATIVE,
    });
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// passesFigureValueGate — diagram
// ---------------------------------------------------------------------------

describe('passesFigureValueGate: diagram', () => {
  it('KEEP when Haiku judge returns keep:true (specific structure)', async () => {
    mockGenerate.mockResolvedValueOnce(JSON.stringify({ keep: true, reason: 'Specific layers.' }));

    const result = await passesFigureValueGate({
      kind: 'diagram',
      struct: SPECIFIC_DIAGRAM_STRUCT,
      sectionTitle: SECTION_TITLE,
      sectionNarrative: SECTION_NARRATIVE,
    });
    expect(result).toBe(true);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it('DROP when Haiku judge returns keep:false (generic metaphor)', async () => {
    mockGenerate.mockResolvedValueOnce(
      JSON.stringify({ keep: false, reason: 'Generic neuron sketch.' })
    );

    const result = await passesFigureValueGate({
      kind: 'diagram',
      struct: GENERIC_DIAGRAM_STRUCT,
      sectionTitle: SECTION_TITLE,
      sectionNarrative: SECTION_NARRATIVE,
    });
    expect(result).toBe(false);
  });

  it('DROP (conservative) when LLM throws', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('provider failure'));

    const result = await passesFigureValueGate({
      kind: 'diagram',
      struct: SPECIFIC_DIAGRAM_STRUCT,
      sectionTitle: SECTION_TITLE,
      sectionNarrative: SECTION_NARRATIVE,
    });
    expect(result).toBe(false);
  });

  it('DROP (conservative) when LLM returns unparseable output', async () => {
    mockGenerate.mockResolvedValueOnce('not json at all');

    const result = await passesFigureValueGate({
      kind: 'diagram',
      struct: SPECIFIC_DIAGRAM_STRUCT,
      sectionTitle: SECTION_TITLE,
      sectionNarrative: SECTION_NARRATIVE,
    });
    expect(result).toBe(false);
  });

  it('DROP (conservative) when LLM returns JSON missing "keep" field', async () => {
    mockGenerate.mockResolvedValueOnce(JSON.stringify({ reason: 'I forgot the keep field.' }));

    const result = await passesFigureValueGate({
      kind: 'diagram',
      struct: SPECIFIC_DIAGRAM_STRUCT,
      sectionTitle: SECTION_TITLE,
      sectionNarrative: SECTION_NARRATIVE,
    });
    expect(result).toBe(false);
  });

  it('DROP when struct is undefined (no-struct path)', async () => {
    const result = await passesFigureValueGate({
      kind: 'diagram',
      struct: undefined,
      sectionTitle: SECTION_TITLE,
      sectionNarrative: SECTION_NARRATIVE,
    });
    expect(result).toBe(false);
    // No LLM call when struct is missing.
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// passesFigureValueGate — unknown kind
// ---------------------------------------------------------------------------

describe('passesFigureValueGate: unknown kind', () => {
  it('DROP for any unrecognised kind', async () => {
    const result = await passesFigureValueGate({
      kind: 'keyframe',
      struct: undefined,
      sectionTitle: SECTION_TITLE,
      sectionNarrative: SECTION_NARRATIVE,
    });
    expect(result).toBe(false);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// judgeDiagram — unit tests for the diagram judge directly
// ---------------------------------------------------------------------------

describe('judgeDiagram', () => {
  it('returns keep:true for a specific structural diagram (mock)', async () => {
    mockGenerate.mockResolvedValueOnce(
      JSON.stringify({ keep: true, reason: 'Annotated layer dimensions.' })
    );
    const result = await judgeDiagram(SPECIFIC_DIAGRAM_STRUCT, SECTION_TITLE, SECTION_NARRATIVE);
    expect(result.keep).toBe(true);
  });

  it('returns keep:false (conservative) on JSON parse failure', async () => {
    mockGenerate.mockResolvedValueOnce('{bad json');
    const result = await judgeDiagram(SPECIFIC_DIAGRAM_STRUCT, SECTION_TITLE, SECTION_NARRATIVE);
    expect(result.keep).toBe(false);
    expect(result.reason).toMatch(/parse-failure/);
  });

  it('returns keep:false (conservative) on LLM error', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('timeout'));
    const result = await judgeDiagram(SPECIFIC_DIAGRAM_STRUCT, SECTION_TITLE, SECTION_NARRATIVE);
    expect(result.keep).toBe(false);
    expect(result.reason).toMatch(/llm-error/);
  });

  it('uses the Haiku model (contains "haiku")', async () => {
    mockGenerate.mockResolvedValueOnce(JSON.stringify({ keep: true, reason: 'ok' }));
    const { OpenRouterGenerationProvider } = jest.requireMock('@/modules/llm/openrouter') as {
      OpenRouterGenerationProvider: jest.Mock;
    };
    OpenRouterGenerationProvider.mockClear();

    await judgeDiagram(SPECIFIC_DIAGRAM_STRUCT, SECTION_TITLE, SECTION_NARRATIVE);
    expect(OpenRouterGenerationProvider).toHaveBeenCalledWith(expect.stringMatching(/haiku/i));
  });
});

// ---------------------------------------------------------------------------
// parseJudgeResponse — pure parser
// ---------------------------------------------------------------------------

describe('parseJudgeResponse', () => {
  it('parses keep:true response', () => {
    const result = parseJudgeResponse(JSON.stringify({ keep: true, reason: 'Specific.' }));
    expect(result).toEqual({ keep: true, reason: 'Specific.' });
  });

  it('parses keep:false response', () => {
    const result = parseJudgeResponse(JSON.stringify({ keep: false, reason: 'Generic.' }));
    expect(result).toEqual({ keep: false, reason: 'Generic.' });
  });

  it('strips code fences before parsing', () => {
    const inner = JSON.stringify({ keep: true, reason: 'ok' });
    const result = parseJudgeResponse(`\`\`\`json\n${inner}\n\`\`\``);
    expect(result.keep).toBe(true);
  });

  it('returns keep:false on invalid JSON', () => {
    const result = parseJudgeResponse('not json');
    expect(result.keep).toBe(false);
    expect(result.reason).toMatch(/parse-failure/);
  });

  it('returns keep:false when "keep" field is missing', () => {
    const result = parseJudgeResponse(JSON.stringify({ reason: 'no keep field' }));
    expect(result.keep).toBe(false);
  });

  it('returns keep:false when JSON is a non-object value', () => {
    expect(parseJudgeResponse('"just a string"').keep).toBe(false);
    expect(parseJudgeResponse('42').keep).toBe(false);
    expect(parseJudgeResponse('null').keep).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildDiagramJudgePrompt — structural smoke tests
// ---------------------------------------------------------------------------

describe('buildDiagramJudgePrompt', () => {
  it('includes section title and narrative excerpt', () => {
    const prompt = buildDiagramJudgePrompt('nodes: [A, B]', SECTION_TITLE, SECTION_NARRATIVE);
    expect(prompt).toContain(SECTION_TITLE);
    expect(prompt).toContain(SECTION_NARRATIVE.slice(0, 50));
  });

  it('includes the struct summary', () => {
    const prompt = buildDiagramJudgePrompt('nodes: [A, B]', SECTION_TITLE, SECTION_NARRATIVE);
    expect(prompt).toContain('nodes: [A, B]');
  });

  it('mentions DROP and KEEP examples', () => {
    const prompt = buildDiagramJudgePrompt('nodes: [A]', SECTION_TITLE, SECTION_NARRATIVE);
    expect(prompt).toMatch(/DROP/);
    expect(prompt).toMatch(/KEEP/);
  });

  it('requests JSON output with keep field', () => {
    const prompt = buildDiagramJudgePrompt('nodes: [A]', SECTION_TITLE, SECTION_NARRATIVE);
    expect(prompt).toContain('"keep"');
  });
});

// ---------------------------------------------------------------------------
// summarizeDiagramStruct — pure struct → text
// ---------------------------------------------------------------------------

describe('summarizeDiagramStruct', () => {
  it('produces node and edge summary for standard graph struct', () => {
    const summary = summarizeDiagramStruct(SPECIFIC_DIAGRAM_STRUCT);
    expect(summary).toContain('nodes:');
    expect(summary).toContain('Input layer');
    expect(summary).toContain('edges:');
    expect(summary).toContain('→');
  });

  it('falls back to JSON snippet for unknown struct shapes', () => {
    const summary = summarizeDiagramStruct({ something: 'unusual', nested: { x: 1 } });
    expect(typeof summary).toBe('string');
    expect(summary.length).toBeGreaterThan(0);
  });

  it('handles empty nodes and edges arrays', () => {
    const summary = summarizeDiagramStruct({ nodes: [], edges: [] });
    expect(summary).toContain('nodes: []');
  });
});
