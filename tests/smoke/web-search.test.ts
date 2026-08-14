/**
 * web-search module — routing/parsing/disabled-graceful unit tests
 * (2026-07-14 provider swap: Naver ko leg + OpenRouter web plugin global leg).
 */
import { loadWebSearchConfig } from '../../src/modules/web-search/config';
import {
  createWebSearchClient,
  hasHangul,
  stripNaverMarkup,
  parseOpenRouterAnnotations,
} from '../../src/modules/web-search/client';

describe('loadWebSearchConfig', () => {
  it('disabled when nothing is set', () => {
    const c = loadWebSearchConfig({} as NodeJS.ProcessEnv);
    expect(c.enabled).toBe(false);
    expect(c.naverEnabled).toBe(false);
    expect(c.globalEnabled).toBe(false);
  });

  it('naver leg needs BOTH id and secret', () => {
    const c = loadWebSearchConfig({ NAVER_CLIENT_ID: 'x' } as NodeJS.ProcessEnv);
    expect(c.naverEnabled).toBe(false);
    const c2 = loadWebSearchConfig({
      NAVER_CLIENT_ID: 'x',
      NAVER_CLIENT_SECRET: 'y',
    } as NodeJS.ProcessEnv);
    expect(c2.naverEnabled).toBe(true);
    expect(c2.enabled).toBe(true);
  });

  it('global leg rides OPENROUTER_API_KEY with a default carrier model', () => {
    const c = loadWebSearchConfig({ OPENROUTER_API_KEY: 'k' } as NodeJS.ProcessEnv);
    expect(c.globalEnabled).toBe(true);
    expect(c.openrouterWebModel).toBe('openai/gpt-4o-mini');
  });
});

describe('hasHangul routing predicate', () => {
  it.each([
    ['마라톤 풀코스 훈련', true],
    ['JLPT N2 공부 시간', true],
    ['JLPT N2 study hours', false],
    ['HSK 4级 词汇量', false],
    ['しまなみ海道 サイクリング', false],
  ])('%s → %s', (q, expected) => {
    expect(hasHangul(q)).toBe(expected);
  });
});

describe('stripNaverMarkup', () => {
  it('removes highlight tags and entities', () => {
    expect(stripNaverMarkup('<b>라떼 아트</b> &amp; 우유 &quot;스티밍&quot;')).toBe(
      '라떼 아트 & 우유 "스티밍"'
    );
  });
});

describe('parseOpenRouterAnnotations', () => {
  const body = {
    choices: [
      {
        message: {
          annotations: [
            {
              type: 'url_citation',
              url_citation: {
                url: 'https://example.com/a',
                title: 'A',
                content: 'a'.repeat(50),
              },
            },
            // dropped: garbled/empty snippet is not evidence
            { type: 'url_citation', url_citation: { url: 'https://example.com/b', content: 'e' } },
            {
              type: 'url_citation',
              url_citation: { url: 'https://example.com/c', content: 'c'.repeat(30) },
            },
          ],
        },
      },
    ],
  };

  it('extracts direct URLs, drops sub-minimum snippets, caps at num', () => {
    const items = parseOpenRouterAnnotations(body, 3);
    expect(items.map((i) => i.link)).toEqual(['https://example.com/a', 'https://example.com/c']);
    expect(items[0]?.displayLink).toBe('example.com');
    // title fallback = hostname when absent
    expect(items[1]?.title).toBe('example.com');
  });

  it('tolerates malformed bodies', () => {
    expect(parseOpenRouterAnnotations({}, 3)).toEqual([]);
    expect(parseOpenRouterAnnotations(null, 3)).toEqual([]);
  });
});

describe('createWebSearchClient routing (no network — unconfigured legs error out)', () => {
  it('Korean query without naver leg → error result, never throws', async () => {
    const client = createWebSearchClient(
      loadWebSearchConfig({ OPENROUTER_API_KEY: 'k' } as NodeJS.ProcessEnv)
    );
    const r = await client.searchWeb('마라톤 훈련');
    expect(r.items).toEqual([]);
    expect(r.error).toContain('naver leg not configured');
  });

  it('global query without openrouter leg → error result, never throws', async () => {
    const client = createWebSearchClient(
      loadWebSearchConfig({
        NAVER_CLIENT_ID: 'x',
        NAVER_CLIENT_SECRET: 'y',
      } as NodeJS.ProcessEnv)
    );
    const r = await client.searchWeb('JLPT N2 study hours');
    expect(r.items).toEqual([]);
    expect(r.error).toContain('global leg not configured');
  });
});
