import { describe, it, expect } from 'vitest';
import { isValidCardForInsert } from '@shared/lib/card-validation';

describe('isValidCardForInsert', () => {
  it('rejects empty URL', () => {
    expect(isValidCardForInsert({ url: '' })).toEqual({
      valid: false,
      reason: 'URL is empty',
    });
  });

  it('rejects undefined URL', () => {
    expect(isValidCardForInsert({})).toEqual({
      valid: false,
      reason: 'URL is empty',
    });
  });

  it('blocks img.youtube.com thumbnail URLs', () => {
    const result = isValidCardForInsert({
      url: 'https://img.youtube.com/vi/W0MBC6in4Q4/mqdefault.jpg',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Blocked host');
  });

  it('blocks i.ytimg.com thumbnail URLs', () => {
    const result = isValidCardForInsert({
      url: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Blocked host');
  });

  it('accepts valid YouTube watch URLs', () => {
    expect(
      isValidCardForInsert({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Never Gonna Give You Up',
      })
    ).toEqual({ valid: true });
  });

  it('accepts valid non-YouTube URLs', () => {
    expect(
      isValidCardForInsert({
        url: 'https://example.com/article',
        title: 'Some Article',
      })
    ).toEqual({ valid: true });
  });

  it('rejects invalid URL format', () => {
    const result = isValidCardForInsert({ url: 'not-a-url' });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Invalid URL format');
  });
});
