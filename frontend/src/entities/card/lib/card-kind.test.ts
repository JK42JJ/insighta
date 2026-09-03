/**
 * The kind guard, tested on the failure it exists to prevent: a brief issue
 * and a mandala card in the same list.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  briefCardId,
  briefSlugFromCardId,
  isBriefCard,
  keepKind,
  acceptsBriefOnly,
  acceptsUserCards,
} from './card-kind';
import { briefIssueToInsightCard } from './brief-card';
import type { InsightCard } from '../model/types';
import type { SubscribedBriefIssue } from '@/shared/lib/api-client';

function mandalaCard(id: string): InsightCard {
  return {
    id,
    videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: 'a video',
    thumbnail: '',
    userNote: '',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    cellIndex: 3,
    levelId: 'level-1',
    mandalaId: 'm-1',
    linkType: 'youtube',
  };
}

const issue: SubscribedBriefIssue = {
  slug: '2026-09-02-ai-tech',
  categoryKey: 'ai-tech',
  categoryLabel: 'AI 엔지니어링',
  issueNo: 1,
  publishedAt: '2026-09-02T00:00:00Z',
  headline: '에이전트가 읽은 것은 전부 명령이 될 수 있다',
  dek: '이번 주 재료에서 반복된 주제는 모델 점수가 아니라 권한이었다.',
  coverVideoId: 'abcdefghijk',
  issueLabel: '제1호',
  dateLabel: '2026년 9월 2일',
  read: false,
};

afterEach(() => vi.restoreAllMocks());

describe('brief card identity', () => {
  it('namespaces an issue id so it can never pass as a uuid', () => {
    const id = briefCardId('2026-09-02-ai-tech');
    expect(id).toBe('brief:2026-09-02-ai-tech');
    expect(id).not.toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('round-trips the slug', () => {
    expect(briefSlugFromCardId(briefCardId('x-1'))).toBe('x-1');
  });

  it('does not read a mandala card id as an issue', () => {
    expect(briefSlugFromCardId('9d4b2f1a-0000-4000-8000-000000000000')).toBeNull();
  });
});

describe('briefIssueToInsightCard', () => {
  const card = briefIssueToInsightCard(issue);

  it('states its kind', () => {
    expect(card.linkType).toBe('brief');
    expect(isBriefCard(card)).toBe(true);
  });

  it('belongs to no mandala and no cell', () => {
    expect(card.mandalaId).toBeNull();
    expect(card.cellIndex).toBe(-1);
  });

  it('points at the reader surface, not a video', () => {
    expect(card.videoUrl).toBe('/brief/2026-09-02-ai-tech');
  });

  it('covers itself with the lead pick and files itself by publication date', () => {
    expect(card.thumbnail).toBe('https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
    expect(card.publishedAt).toEqual(new Date('2026-09-02T00:00:00Z'));
  });

  it('leaves the cover empty rather than inventing one when there are no picks', () => {
    expect(briefIssueToInsightCard({ ...issue, coverVideoId: null }).thumbnail).toBe('');
  });
});

describe('keepKind', () => {
  it('drops an issue from the mandala grid and says so', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const kept = keepKind(
      [mandalaCard('a'), briefIssueToInsightCard(issue)],
      acceptsUserCards,
      '만다라 그리드'
    );
    expect(kept.map((c) => c.id)).toEqual(['a']);
    expect(error).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0][0])).toContain('만다라 그리드');
  });

  it('drops a mandala card from the brief grid and says so', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const kept = keepKind(
      [mandalaCard('a'), briefIssueToInsightCard(issue)],
      acceptsBriefOnly,
      '브리프 그리드'
    );
    expect(kept.map((c) => c.id)).toEqual(['brief:2026-09-02-ai-tech']);
    expect(error).toHaveBeenCalledOnce();
  });

  it('stays silent when nothing is mixed', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    keepKind([mandalaCard('a'), mandalaCard('b')], acceptsUserCards, '만다라 그리드');
    expect(error).not.toHaveBeenCalled();
  });

  it('logs once for a batch rather than once per card', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    keepKind(
      [briefIssueToInsightCard(issue), briefIssueToInsightCard({ ...issue, slug: 'b' })],
      acceptsUserCards,
      '만다라 그리드'
    );
    expect(error).toHaveBeenCalledOnce();
  });
});
