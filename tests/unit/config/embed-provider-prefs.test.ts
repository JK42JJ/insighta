/**
 * OpenRouter embed provider-ignore prefs (P0 2026-07-11 DeepInfra hang).
 * Unset/empty = [] = no provider field in the request (exact legacy).
 */
import { getEmbedIgnoreProviders } from '@/config/embed-provider-prefs';

describe('getEmbedIgnoreProviders', () => {
  test('unset → [] (no-op)', () => {
    expect(getEmbedIgnoreProviders({})).toEqual([]);
  });

  test('empty / whitespace → []', () => {
    expect(getEmbedIgnoreProviders({ OPENROUTER_EMBED_IGNORE_PROVIDERS: '' })).toEqual([]);
    expect(getEmbedIgnoreProviders({ OPENROUTER_EMBED_IGNORE_PROVIDERS: '  ' })).toEqual([]);
  });

  test('single provider', () => {
    expect(getEmbedIgnoreProviders({ OPENROUTER_EMBED_IGNORE_PROVIDERS: 'DeepInfra' })).toEqual([
      'DeepInfra',
    ]);
  });

  test('comma-separated, trimmed, empty segments dropped', () => {
    expect(
      getEmbedIgnoreProviders({ OPENROUTER_EMBED_IGNORE_PROVIDERS: ' DeepInfra , Nebius ,, ' })
    ).toEqual(['DeepInfra', 'Nebius']);
  });
});
