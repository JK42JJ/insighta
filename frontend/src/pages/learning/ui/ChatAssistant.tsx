import { useMemo, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CopilotKit, useCopilotReadable } from '@copilotkit/react-core';
import { CopilotChat } from '@copilotkit/react-ui';
import '@copilotkit/react-ui/styles.css';
import { toast } from 'sonner';
import { useRichSummary } from '@/features/video-side-panel/model/useRichSummary';
import { apiClient } from '@/shared/lib/api-client';
import type { CopilotChatLabels } from '@copilotkit/react-ui';

interface ChatAssistantProps {
  videoId: string;
  onSeek?: (seconds: number) => void;
}

const TIMESTAMP_RE = /(\d{1,2}:\d{2}(?::\d{2})?)/g;

function parseTimestamp(ts: string): number {
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}

function linkifyTimestamps(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    const text = walker.currentNode as Text;
    if (
      TIMESTAMP_RE.test(text.textContent || '') &&
      !text.parentElement?.classList.contains('chat-ts')
    ) {
      textNodes.push(text);
    }
    TIMESTAMP_RE.lastIndex = 0;
  }

  for (const textNode of textNodes) {
    const content = textNode.textContent || '';
    TIMESTAMP_RE.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    while ((match = TIMESTAMP_RE.exec(content)) !== null) {
      if (match.index > lastIdx)
        fragment.appendChild(document.createTextNode(content.slice(lastIdx, match.index)));
      const btn = document.createElement('button');
      btn.className = 'chat-ts';
      btn.textContent = match[1];
      btn.dataset.seconds = String(parseTimestamp(match[1]));
      fragment.appendChild(btn);
      lastIdx = TIMESTAMP_RE.lastIndex;
    }
    if (lastIdx < content.length)
      fragment.appendChild(document.createTextNode(content.slice(lastIdx)));
    if (lastIdx > 0) textNode.parentNode?.replaceChild(fragment, textNode);
  }
}

function buildInstructions(
  videoId: string,
  richSummary: {
    title?: string;
    structured?: { key_points?: string[]; core_argument?: string; actionables?: string[] };
  } | null
): string {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  let context = `\n\n## 현재 영상\n- URL: ${videoUrl}`;
  if (richSummary?.title) context += `\n- 제목: ${richSummary.title}`;
  if (richSummary?.structured?.core_argument)
    context += `\n- 핵심 주장: ${richSummary.structured.core_argument}`;
  if (richSummary?.structured?.key_points?.length)
    context += `\n- 핵심 포인트:\n${richSummary.structured.key_points.map((p) => `  - ${p}`).join('\n')}`;
  if (richSummary?.structured?.actionables?.length)
    context += `\n- 실천 항목:\n${richSummary.structured.actionables.map((a) => `  - ${a}`).join('\n')}`;

  return `당신은 Insighta의 학습 어시스턴트입니다. 사용자가 시청 중인 YouTube 영상의 내용을 기반으로 학습을 돕습니다.

## 역할
- 영상 내용에 대한 질문에 정확하게 답변
- 핵심 개념을 쉽게 설명
- 실생활 적용 방안 제시
- 추가 학습 방향 추천

## 규칙
- 영상 내용 범위 내에서 답변. 확실하지 않으면 솔직하게 "영상에서 다루지 않은 내용입니다"라고 답변
- 한국어로 대화하되, 사용자가 영어로 질문하면 영어로 답변
- 답변은 간결하고 구조적으로 (bullet points, 번호 목록 활용)
- 전문 용어는 쉬운 설명을 함께 제공
- 학습자의 이해도를 높이는 데 집중
- 요약 시 timestamp를 포함하여 구간별로 정리
- "이 영상은 ~에 대한 내용을 다루고 있습니다" 같은 도입부/마무리 보일러플레이트 문장 사용 금지. 바로 핵심 내용으로 시작${context}`;
}

function buildSuggestions(
  t: (key: string) => string,
  structured: { key_points?: string[]; core_argument?: string; actionables?: string[] } | null
) {
  const defaults: { title: string; message: string }[] = [
    { title: t('learning.suggestSummarize'), message: t('learning.suggestSummarizeMsg') },
    { title: t('learning.suggestRelated'), message: t('learning.suggestRelatedMsg') },
    { title: t('learning.suggestQuiz'), message: t('learning.suggestQuizMsg') },
  ];

  if (!structured) return defaults;

  const contextual: { title: string; message: string }[] = [];
  const { key_points, core_argument, actionables } = structured;

  if (key_points?.[0]) {
    contextual.push({
      title: key_points[0].slice(0, 40),
      message: `${key_points[0]}을 실제로 적용하면 어떻게 해야 하나요?`,
    });
  }

  if (core_argument) {
    contextual.push({
      title: core_argument.slice(0, 40),
      message: `"${core_argument}"에서 가장 중요한 핵심은 무엇인가요?`,
    });
  }

  if (actionables?.[0]) {
    contextual.push({
      title: actionables[0].slice(0, 40),
      message: `${actionables[0]}의 한계나 주의할 점은 무엇인가요?`,
    });
  }

  return contextual.length > 0 ? contextual.slice(0, 3) : defaults;
}

function ChatPanel({ videoId, onSeek }: { videoId: string; onSeek?: (seconds: number) => void }) {
  const { t } = useTranslation();
  const { richSummary } = useRichSummary(videoId);
  const suggestions = buildSuggestions(t, richSummary?.structured ?? null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const instructions = useMemo(
    () => buildInstructions(videoId, richSummary ?? null),
    [videoId, richSummary]
  );

  useCopilotReadable({
    description: 'Current YouTube video context and assistant role instructions',
    value: instructions,
    convert: (v: string) => v,
  });

  const chatLabels: CopilotChatLabels = {
    title: t('learning.chatTitle'),
    initial: t('learning.chatInitial'),
    placeholder: t('learning.chatPlaceholder'),
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      wrapperRef.current?.querySelector<HTMLTextAreaElement>('.copilotKitInput textarea')?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const handleTsClick = useCallback(
    (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('chat-ts') && target.dataset.seconds) {
        e.preventDefault();
        onSeek?.(Number(target.dataset.seconds));
      }
    },
    [onSeek]
  );

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !onSeek) return;
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations)
        for (const node of m.addedNodes) if (node instanceof HTMLElement) linkifyTimestamps(node);
    });
    observer.observe(wrapper, { childList: true, subtree: true });
    linkifyTimestamps(wrapper);
    wrapper.addEventListener('click', handleTsClick);
    return () => {
      observer.disconnect();
      wrapper.removeEventListener('click', handleTsClick);
    };
  }, [onSeek, handleTsClick]);

  return (
    <div ref={wrapperRef} className="copilotkit-chat-wrapper h-full">
      <CopilotChat
        className="h-full"
        labels={chatLabels}
        instructions={instructions}
        suggestions={suggestions}
        onThumbsUp={() => toast(t('learning.feedbackSaved'))}
        onThumbsDown={() => toast(t('learning.feedbackSaved'))}
      />
    </div>
  );
}

export function ChatAssistant({ videoId, onSeek }: ChatAssistantProps) {
  const token = apiClient.getAccessToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  return (
    <CopilotKit
      runtimeUrl="/api/v1/chat"
      showDevConsole={false}
      enableInspector={false}
      headers={headers}
    >
      <ChatPanel videoId={videoId} onSeek={onSeek} />
    </CopilotKit>
  );
}
