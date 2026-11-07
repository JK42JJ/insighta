import { shouldLogRerankSample, rerankSample } from '../sources/llm-reranker';

describe('shouldLogRerankSample', () => {
  it('is true when parsing failed', () => {
    expect(shouldLogRerankSample('failed', 0, 10)).toBe(true);
  });
  it('is true when fewer than half parsed', () => {
    expect(shouldLogRerankSample('regex', 4, 10)).toBe(true);
  });
  it('is false for healthy json', () => {
    expect(shouldLogRerankSample('json', 10, 10)).toBe(false);
  });
  it('is false for regex at or above half', () => {
    expect(shouldLogRerankSample('regex', 5, 10)).toBe(false);
  });
});

describe('rerankSample', () => {
  it('returns short input unchanged', () => {
    expect(rerankSample('abc')).toBe('abc');
  });
  it('caps at 500 chars', () => {
    expect(rerankSample('x'.repeat(100000)).length).toBe(500);
  });
  it('returns empty string for empty or undefined', () => {
    expect(rerankSample('')).toBe('');
    expect(rerankSample(undefined)).toBe('');
  });
});
