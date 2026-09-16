/**
 * "Ask about this issue" — a chat bound to one published brief.
 *
 * The panel mounts the same CopilotKit runtime the learning page uses and
 * marks the conversation with `[[brief:<slug>]]` in the instructions. The
 * server reads that marker, replaces the instructions with the issue's text
 * and sources, and tells the model to answer only from them
 * (src/modules/chatbot-rag/brief-context-loader.ts). Nothing about the
 * issue's content is sent from here; the marker is the whole contract.
 *
 * Not the learning page's ChatAssistant: that component is bound to the
 * player, the mandala store and the note editor, none of which exist here.
 */

import { useEffect, useMemo, useState } from 'react';
import { CopilotKit } from '@copilotkit/react-core';
import { CopilotChat } from '@copilotkit/react-ui';
import '@copilotkit/react-ui/styles.css';

import type { IssueDocument } from '@/features/newsletter-note/lib/issue-types';
import { apiClient } from '@/shared/lib/api-client';
import { buildBriefSuggestions } from '../lib/suggestions';
import { CHAT_RUNTIME_PATH, observeChatResponses, type ChatRefusal } from '../lib/observe-chat';

/** The marker the prompt middleware parses (BRIEF_SLUG_REGEX on the server). */
export function briefMarker(slug: string): string {
  return `[[brief:${slug}]]`;
}

const LABELS = {
  title: '이 호에 질문',
  initial: '답변은 이번 호 본문과 출처에 한정됩니다.',
  placeholder: '이번 호에 대해 물어보세요',
};

const REFUSAL_TEXT: Record<ChatRefusal, string> = {
  unauthorized: '로그인이 만료됐습니다. 다시 로그인한 뒤 질문해 주세요.',
  rate_limited: '시간당 질문 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
};

const SECONDS_PER_MINUTE = 60;

function retryText(retryAfterSec: number | undefined): string {
  if (!retryAfterSec) return '';
  const minutes = Math.ceil(retryAfterSec / SECONDS_PER_MINUTE);
  return ` 약 ${minutes}분 뒤에 다시 열립니다.`;
}

interface Refusal {
  kind: ChatRefusal;
  retryAfterSec?: number;
}

export function BriefAskPanel({ issue }: { issue: IssueDocument }): JSX.Element {
  // Memoised on the token string: a new object per render makes the provider
  // rebuild its runtime and drop the conversation (the learning page learnt
  // this the hard way).
  const token = apiClient.getAccessToken();
  const headers = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);

  const [refusal, setRefusal] = useState<Refusal | null>(null);
  useEffect(
    () => observeChatResponses((kind, retryAfterSec) => setRefusal({ kind, retryAfterSec })),
    []
  );

  const instructions = useMemo(
    () =>
      `${briefMarker(issue.slug)}\n이 대화는 ${issue.category} ${issue.issueLabel} 브리프에 대한 질문입니다. 서버가 붙이는 이번 호 본문과 출처 안에서만 답합니다.`,
    [issue.slug, issue.category, issue.issueLabel]
  );
  const suggestions = useMemo(() => buildBriefSuggestions(issue), [issue]);

  if (!token) {
    return (
      <p className="px-4 py-6 text-[13px] text-muted-foreground" data-testid="brief-ask-panel">
        로그인한 뒤 이번 호에 대해 질문할 수 있습니다.
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="brief-ask-panel">
      {refusal && (
        <p
          role="status"
          className="border-b border-border/60 bg-muted/40 px-4 py-2 text-[12.5px] text-muted-foreground"
        >
          {REFUSAL_TEXT[refusal.kind]}
          {refusal.kind === 'rate_limited' ? retryText(refusal.retryAfterSec) : ''}
        </p>
      )}
      <div className="min-h-0 flex-1">
        <CopilotKit
          runtimeUrl={CHAT_RUNTIME_PATH}
          showDevConsole={false}
          enableInspector={false}
          headers={headers}
        >
          <CopilotChat
            className="h-full"
            labels={LABELS}
            instructions={instructions}
            suggestions={suggestions}
          />
        </CopilotKit>
      </div>
      <p className="border-t border-border/60 px-4 py-2 text-[11.5px] text-muted-foreground/70">
        답변은 이번 호 본문과 출처에 한정됩니다. 본문에 없는 내용은 없다고 말합니다.
      </p>
    </div>
  );
}
