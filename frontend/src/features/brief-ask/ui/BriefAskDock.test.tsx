import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { IssueDocument } from '@/features/newsletter-note/lib/issue-types';

vi.mock('./BriefAskPanel', () => ({
  BriefAskPanel: () => <div data-testid="brief-ask-panel">panel</div>,
}));

import { BriefAskDock } from './BriefAskDock';

const WIDE = '(min-width: 1440px)';
const RIGHT = '(min-width: 640px)';

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

beforeEach(() => {
  try {
    window.localStorage.removeItem('brief-ask-open');
  } catch {
    // no storage in this environment
  }
});
afterEach(() => vi.restoreAllMocks());

describe('BriefAskDock', () => {
  it('is closed by default: a button, no panel', () => {
    mockViewport([WIDE, RIGHT]);
    render(<BriefAskDock issue={issue} />);
    expect(screen.getByRole('button', { name: '이 호에 질문 열기' })).toBeTruthy();
    expect(screen.queryByTestId('brief-ask-panel')).toBeNull();
  });

  it('opens as a right column on a wide viewport and closes from its header', async () => {
    mockViewport([WIDE, RIGHT]);
    render(<BriefAskDock issue={issue} />);
    fireEvent.click(screen.getByRole('button', { name: '이 호에 질문 열기' }));
    const aside = screen.getByRole('complementary', { name: '이 호에 질문' });
    expect(aside.className).toContain('w-[400px]');
    // The panel is a lazy chunk; it resolves after the column is in place.
    expect(await screen.findByTestId('brief-ask-panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '이 호에 질문 닫기' }));
    expect(screen.queryByTestId('brief-ask-panel')).toBeNull();
  });

  it('opens as a sheet when the viewport cannot hold a third column', async () => {
    mockViewport([RIGHT]);
    render(<BriefAskDock issue={issue} />);
    fireEvent.click(screen.getByRole('button', { name: '이 호에 질문 열기' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(await screen.findByTestId('brief-ask-panel')).toBeTruthy();
  });
});
