/**
 * Brief chat system prompt (src/modules/chatbot-rag/brief-prompt.ts).
 *
 * No LLM call anywhere: the database client is mocked and the module only
 * builds text.
 */

const mockFindUnique = jest.fn();

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({ newsletter_issues: { findUnique: mockFindUnique } }),
}));

jest.mock('@/utils/logger', () => {
  const child = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: () => child,
  };
  return { logger: child };
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BRIEF_STORY_TEXT_MAX,
  buildBriefSystemContent,
  loadBriefIssue,
  parseBriefSlug,
} from '@/modules/chatbot-rag/brief-prompt';
import { PRODUCT_PERSONA_KO } from '@/modules/chatbot-rag/prompt-builder';

const SLUG = '2026-09-02-ai-tech';

// The live issue 1 document as stored (synced with production on 2026-09-16),
// so the fixture is schema-valid by construction rather than hand-built.
const ISSUE_1 = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../src/modules/newsletter/issues/2026-09-02-ai-tech.json'),
    'utf8'
  )
) as { stories: Array<Record<string, unknown>> } & Record<string, unknown>;

function doc(over: Record<string, unknown> = {}) {
  return { ...ISSUE_1, ...over };
}

function row(over: Record<string, unknown> = {}) {
  return {
    issue_no: 1,
    category_key: 'ai-tech',
    locale: 'ko',
    content_json: doc(),
    published_at: new Date('2026-09-02T16:57:18Z'),
    ...over,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('parseBriefSlug', () => {
  it('reads the slug from the marker the brief panel emits', () => {
    expect(parseBriefSlug(`[[brief:${SLUG}]]\n이 대화는 …`)).toBe(SLUG);
  });

  it('ignores content without a well-formed marker', () => {
    expect(parseBriefSlug('[Current video] abc')).toBeNull();
    expect(parseBriefSlug('[[brief:]]')).toBeNull();
    expect(parseBriefSlug('[[brief:Bad Slug]]')).toBeNull();
  });
});

describe('loadBriefIssue', () => {
  it('returns the published issue with story text, labels, picks and sources', async () => {
    mockFindUnique.mockResolvedValue(row());
    const issue = await loadBriefIssue(SLUG);
    expect(issue?.issueLabel).toBe('제1호');
    expect(issue?.stories).toHaveLength(4);
    expect(issue?.stories[0]?.navLabel).toBe('저장소 설정 파일의 숨은 명령');
    expect(issue?.stories[0]?.text.length).toBeGreaterThan(0);
    // HTML is stripped from story text.
    expect(issue?.stories.some((st) => /<[a-z]/i.test(st.text))).toBe(false);
    expect(issue?.picks).toHaveLength(5);
    expect(issue?.refs).toHaveLength(4);
  });

  it('keeps a story without a label unlabelled', async () => {
    const stories = ISSUE_1.stories.map((st, i) => (i === 1 ? { ...st, navLabel: undefined } : st));
    mockFindUnique.mockResolvedValue(row({ content_json: doc({ stories }) }));
    const issue = await loadBriefIssue(SLUG);
    expect(issue?.stories[1]?.navLabel).toBeUndefined();
    expect(issue?.stories[0]?.navLabel).toBe('저장소 설정 파일의 숨은 명령');
  });

  it('caps each story text', async () => {
    const long = 'a'.repeat(BRIEF_STORY_TEXT_MAX + 500);
    mockFindUnique.mockResolvedValue(
      row({
        content_json: doc({
          stories: [{ ...ISSUE_1.stories[0], blocks: [{ type: 'p', html: long }] }],
        }),
      })
    );
    const issue = await loadBriefIssue(SLUG);
    expect(issue?.stories[0]?.text).toHaveLength(BRIEF_STORY_TEXT_MAX);
  });

  it('returns null for a draft, an unknown slug, an invalid document, and a DB error', async () => {
    mockFindUnique.mockResolvedValueOnce(row({ published_at: null }));
    expect(await loadBriefIssue(SLUG)).toBeNull();
    mockFindUnique.mockResolvedValueOnce(null);
    expect(await loadBriefIssue(SLUG)).toBeNull();
    mockFindUnique.mockResolvedValueOnce(row({ content_json: { stories: 'nope' } }));
    expect(await loadBriefIssue(SLUG)).toBeNull();
    mockFindUnique.mockRejectedValueOnce(new Error('db down'));
    expect(await loadBriefIssue(SLUG)).toBeNull();
  });
});

describe('buildBriefSystemContent', () => {
  it('builds persona + issue + rules, keeping grade tags verbatim', async () => {
    mockFindUnique.mockResolvedValue(row());
    const out = await buildBriefSystemContent(`[[brief:${SLUG}]]`, 'ko');
    expect(out).not.toBeNull();
    expect(out!.startsWith(PRODUCT_PERSONA_KO)).toBe(true);
    expect(out).toContain('[이번 호 브리프]');
    expect(out).toContain(
      '## [신뢰 경계] Claude Code는 저장소 설정 파일에 든 명령을 사용자 확인 없이 실행했습니다 (목차: 저장소 설정 파일의 숨은 명령)'
    );
    // Issue 1 carries both grades in its story text; they reach the prompt as written.
    expect(out).toContain('[확인]');
    expect(out).toContain('[영상]');
    expect(out).toContain('[출처 목록]');
    expect(out).toContain('[브리프 답변 규칙]');
  });

  it('returns null without touching the database when there is no marker', async () => {
    expect(await buildBriefSystemContent('[Current video] abc', 'ko')).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it('returns null when the issue cannot be read, so the caller uses the ordinary prompt', async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await buildBriefSystemContent(`[[brief:${SLUG}]]`, 'ko')).toBeNull();
  });
});
