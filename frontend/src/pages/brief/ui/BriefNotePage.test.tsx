/**
 * The reading column's scroll chrome.
 *
 * The column shipped with `overflow-y-auto` and no scrollbar class, so it drew
 * the operating system's default bar. Measured on the live page: 15px wide,
 * `scrollbar-width: auto`, next to a 6px bar in the chat panel beside it. The
 * learning page's centre column, which this page's own comment says it copies,
 * carries `scrollbar-pro`.
 *
 * jsdom applies no stylesheet, so the class name is the whole assertion here.
 * The width itself is checked in the browser after deploy.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { IssueDocument } from '@/features/newsletter-note/lib/issue-types';

const issue = {
  slug: '2026-09-02-ai-tech',
  categoryKey: 'ai-tech',
  category: 'AI 엔지니어링',
  issueLabel: '제1호',
  // An array, and the page joins it into the document title on mount. A
  // fixture without it throws before anything renders.
  headline: ['Claude Code에는 저장소를 열기만 해도 숨은 명령이 실행되는 취약점이 있었습니다'],
  stories: [],
} as unknown as IssueDocument;

vi.mock('@/features/newsletter-note/model/useBriefNote', () => ({
  useBriefNote: () => ({
    issue,
    doc: { type: 'doc', content: [] },
    loading: false,
    notFound: false,
    error: null,
  }),
}));

// The dock is covered by its own tests; here it would only pull CopilotKit in.
vi.mock('@/features/brief-ask/ui/BriefAskDock', () => ({
  BRIEF_ASK_ENABLED: true,
  BriefAskDock: () => <div data-testid="brief-ask-dock" />,
}));

vi.mock('@tiptap/react', () => ({
  useEditor: () => ({ commands: { setContent: () => undefined } }),
  EditorContent: () => <div data-testid="editor-content" />,
}));

vi.mock('@/pages/learning/ui/CenterPanel', () => ({ NOTE_PROSE_STYLE: '' }));

vi.mock('@/shared/lib/api-client', () => ({
  apiClient: {
    markBriefRead: vi.fn().mockResolvedValue(undefined),
    subscribeToBrief: vi.fn().mockResolvedValue(undefined),
    getAccessToken: () => null,
  },
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { BriefNotePage } from './BriefNotePage';

describe('BriefNotePage', () => {
  it('scrolls the reading column with the house scrollbar, not the browser default', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/brief/2026-09-02-ai-tech']}>
        <BriefNotePage />
      </MemoryRouter>
    );

    const column = container.querySelector('.overflow-y-auto');
    expect(column).not.toBeNull();
    expect(column?.className).toContain('scrollbar-pro');
  });

  it('keeps the width floor that collapses the sidebar before the text', () => {
    // Same guard, same element: a rewrite that drops the floor to add the
    // scrollbar class would pass the test above on its own.
    const { container } = render(
      <MemoryRouter initialEntries={['/brief/2026-09-02-ai-tech']}>
        <BriefNotePage />
      </MemoryRouter>
    );
    const column = container.querySelector('.overflow-y-auto');
    expect(column?.className).toContain('min-w-[380px]');
  });
});
