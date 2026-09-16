/**
 * The marker is the whole contract between this panel and the server: the
 * prompt middleware answers from the published issue only when `[[brief:<slug>]]`
 * appears in the system content it receives.
 *
 * Passing it as the `instructions` prop is not enough. A request captured from
 * the live panel carried `context: []` and no `[[brief:` anywhere in the body,
 * so the server took the ordinary video path and answered from an unrelated
 * transcript. These tests fail if the marker stops travelling as a readable.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { IssueDocument } from '@/features/newsletter-note/lib/issue-types';

const readables: Array<{ description?: string; value: unknown }> = [];
const chatProps: Array<Record<string, unknown>> = [];

vi.mock('@copilotkit/react-core', () => ({
  CopilotKit: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useCopilotReadable: (arg: { description?: string; value: unknown }) => {
    readables.push(arg);
  },
}));

vi.mock('@copilotkit/react-ui', () => ({
  CopilotChat: (props: Record<string, unknown>) => {
    chatProps.push(props);
    return <div data-testid="copilot-chat" />;
  },
}));

vi.mock('@copilotkit/react-ui/styles.css', () => ({}));

vi.mock('@/shared/lib/api-client', () => ({
  apiClient: { getAccessToken: () => 'test-token' },
}));

import { BriefAskPanel, briefMarker } from './BriefAskPanel';

const issue = {
  slug: '2026-09-02-ai-tech',
  category: 'AI 엔지니어링',
  issueLabel: '제1호',
  stories: [],
} as unknown as IssueDocument;

afterEach(() => {
  readables.length = 0;
  chatProps.length = 0;
  vi.clearAllMocks();
});

describe('briefMarker', () => {
  it('is the exact shape the server parses', () => {
    // BRIEF_SLUG_REGEX in src/modules/chatbot-rag/brief-prompt.ts.
    expect(briefMarker('2026-09-02-ai-tech')).toBe('[[brief:2026-09-02-ai-tech]]');
    expect(/\[\[brief:([a-z0-9-]+)\]\]/.exec(briefMarker(issue.slug))?.[1]).toBe(issue.slug);
  });
});

describe('BriefAskPanel', () => {
  it('sends the marker as a readable, which is what reaches the server', () => {
    render(<BriefAskPanel issue={issue} />);
    const carrying = readables.filter(
      (r) => typeof r.value === 'string' && r.value.includes(briefMarker(issue.slug))
    );
    expect(carrying).toHaveLength(1);
  });

  it('keeps the marker on instructions too, so both paths carry it', () => {
    render(<BriefAskPanel issue={issue} />);
    expect(chatProps).toHaveLength(1);
    expect(String(chatProps[0].instructions)).toContain(briefMarker(issue.slug));
  });

  it('names the issue in the text around the marker', () => {
    // The server puts the issue text in the prompt; this line tells the model
    // what the conversation is, and shows in no UI, so it is only checked here.
    render(<BriefAskPanel issue={issue} />);
    const value = String(readables.find((r) => typeof r.value === 'string')?.value ?? '');
    expect(value).toContain('AI 엔지니어링');
    expect(value).toContain('제1호');
  });

  it('renders the chat inside the wrapper the learning page uses', () => {
    const { getByTestId } = render(<BriefAskPanel issue={issue} />);
    expect(getByTestId('brief-ask-panel').querySelector('.copilotkit-chat-wrapper')).not.toBeNull();
    expect(getByTestId('copilot-chat')).toBeTruthy();
  });
});
