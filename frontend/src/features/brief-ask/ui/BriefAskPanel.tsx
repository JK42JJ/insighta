/**
 * The chat body of the brief's right panel: a conversation bound to one
 * published brief.
 *
 * It mounts the same CopilotKit runtime and the same chat wrapper the
 * learning page's AI 챗봇 tab uses, so the two look and behave alike. The
 * conversation is marked with `[[brief:<slug>]]` in the instructions; the
 * server reads that marker, puts the issue's text and sources in the system
 * prompt, and tells the model to answer only from them
 * (src/modules/chatbot-rag/brief-context-loader.ts). Nothing about the
 * issue's content is sent from here; the marker is the whole contract.
 *
 * Not the learning page's ChatAssistant: that component is bound to the
 * player, the mandala store and the note editor, none of which exist here.
 */

import { useMemo } from 'react';
import { CopilotKit, useCopilotReadable } from '@copilotkit/react-core';
import { CopilotChat } from '@copilotkit/react-ui';
import '@copilotkit/react-ui/styles.css';
import { toast } from 'sonner';

import type { IssueDocument } from '@/features/newsletter-note/lib/issue-types';
import { apiClient } from '@/shared/lib/api-client';
import { buildBriefSuggestions } from '../lib/suggestions';

/** The CopilotKit runtime endpoint, the same one the learning page's chat uses. */
const CHAT_RUNTIME_PATH = '/api/v1/chat';

/** The marker the prompt middleware parses (BRIEF_SLUG_REGEX on the server). */
export function briefMarker(slug: string): string {
  return `[[brief:${slug}]]`;
}

/** Same wording pattern as the learning page's labels (learning.chat*). */
const LABELS = {
  title: '브리프 어시스턴트',
  initial: '이 호에 대해 질문하세요',
  placeholder: '이번 호 내용에 대해 질문하세요...',
} as const;

const FEEDBACK_SAVED = '피드백 저장됨';

/**
 * The chat itself. Separate from the panel because `useCopilotReadable` only
 * works under the `CopilotKit` provider — the same split the learning page
 * uses (ChatAssistant renders the provider, ChatPanel holds the readables).
 */
function BriefChat({ issue }: { issue: IssueDocument }): JSX.Element {
  const instructions = useMemo(
    () =>
      `${briefMarker(issue.slug)}\n이 대화는 ${issue.category} ${issue.issueLabel} 브리프에 대한 질문입니다. 서버가 붙이는 이번 호 본문과 출처 안에서만 답합니다.`,
    [issue.slug, issue.category, issue.issueLabel]
  );
  const suggestions = useMemo(() => buildBriefSuggestions(issue), [issue]);

  // The marker has to travel as a readable, not only as `instructions`.
  // CopilotKit 1.55 keeps the `instructions` prop client-side: a request sent
  // from this panel carried `context: []` and no `[[brief:` anywhere in the
  // body, so `rewriteSystemContent` never saw the marker and the question was
  // answered from the ordinary video path instead of from the issue. A
  // readable is what reaches the server's system content, and it is the path
  // the learning page already relies on for the video context it needs.
  useCopilotReadable({
    description:
      'The published brief this conversation is about. The server answers only from this issue.',
    value: instructions,
    convert: (v: string) => v,
  });

  return (
    <CopilotChat
      className="h-full"
      labels={LABELS}
      instructions={instructions}
      suggestions={suggestions}
      onThumbsUp={() => toast(FEEDBACK_SAVED)}
      onThumbsDown={() => toast(FEEDBACK_SAVED)}
    />
  );
}

export function BriefAskPanel({ issue }: { issue: IssueDocument }): JSX.Element {
  // Memoised on the token string: a new object per render makes the provider
  // rebuild its runtime and drop the conversation (learning page, CP475+6).
  const token = apiClient.getAccessToken();
  const headers = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="brief-ask-panel">
      <div className="copilotkit-chat-wrapper min-h-0 flex-1">
        <CopilotKit
          runtimeUrl={CHAT_RUNTIME_PATH}
          showDevConsole={false}
          enableInspector={false}
          headers={headers}
        >
          <BriefChat issue={issue} />
        </CopilotKit>
      </div>
    </div>
  );
}
