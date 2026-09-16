import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { IssueDocument } from '@/features/newsletter-note/lib/issue-types';

vi.mock('./BriefAskPanel', () => ({
  BriefAskPanel: () => <div data-testid="brief-ask-panel">panel</div>,
}));

import { BriefAskDock } from './BriefAskDock';

const DESKTOP = '(min-width: 768px)';

function mockViewport(matching: string[]) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: matching.includes(query),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const issue = {
  slug: '2026-09-02-ai-tech',
  category: 'AI 엔지니어링',
  issueLabel: '제1호',
  stories: [],
} as unknown as IssueDocument;

afterEach(() => vi.restoreAllMocks());

describe('BriefAskDock', () => {
  it('is an always-open right column on desktop, like the learning page', async () => {
    // The learning page's AI 챗봇 panel is never behind a button; the brief's
    // was, and the reader did not find it. No open button on desktop.
    mockViewport([DESKTOP]);
    render(<BriefAskDock issue={issue} />);
    const aside = screen.getByRole('complementary', { name: 'AI 챗봇' });
    expect(aside.className).toContain('w-[400px]');
    expect(aside.className).toContain('border-l');
    expect(screen.queryByRole('button', { name: 'AI 챗봇 열기' })).toBeNull();
    expect(await screen.findByTestId('brief-ask-panel')).toBeTruthy();
  });

  it('names what the chat applies to in the context zone', () => {
    mockViewport([DESKTOP]);
    render(<BriefAskDock issue={issue} />);
    expect(screen.getByText('지금 읽는 브리프')).toBeTruthy();
    expect(screen.getByText('AI 엔지니어링 제1호')).toBeTruthy();
    expect(screen.getByText('챗봇은 실수할 수 있습니다. 답변을 다시 확인하세요.')).toBeTruthy();
  });

  it('is a bottom sheet behind a button on a phone', async () => {
    mockViewport([]);
    render(<BriefAskDock issue={issue} />);
    expect(screen.queryByRole('complementary')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'AI 챗봇 열기' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(await screen.findByTestId('brief-ask-panel')).toBeTruthy();
  });
});
