import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CopilotKit } from '@copilotkit/react-core';
import { CopilotChat } from '@copilotkit/react-ui';
import '@copilotkit/react-ui/styles.css';
import { toast } from 'sonner';
import { useRichSummary } from '@/features/video-side-panel/model/useRichSummary';
import type { CopilotChatLabels } from '@copilotkit/react-ui';

interface ChatAssistantProps {
  videoId: string;
}

const CHAT_INSTRUCTIONS = `당신은 Insighta의 학습 어시스턴트입니다. 사용자가 시청 중인 YouTube 영상의 내용을 기반으로 학습을 돕습니다.

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
- 학습자의 이해도를 높이는 데 집중`;

function buildSuggestions(
  structured: { key_points?: string[]; core_argument?: string; actionables?: string[] } | null
) {
  if (!structured) return [];

  const suggestions: { title: string; message: string }[] = [];
  const { key_points, core_argument, actionables } = structured;

  if (key_points?.[0]) {
    suggestions.push({
      title: key_points[0].slice(0, 40),
      message: `${key_points[0]}을 실제로 적용하면 어떻게 해야 하나요?`,
    });
  }

  if (core_argument) {
    suggestions.push({
      title: core_argument.slice(0, 40),
      message: `"${core_argument}"에서 가장 중요한 핵심은 무엇인가요?`,
    });
  }

  if (actionables?.[0]) {
    suggestions.push({
      title: actionables[0].slice(0, 40),
      message: `${actionables[0]}의 한계나 주의할 점은 무엇인가요?`,
    });
  }

  return suggestions.slice(0, 3);
}

function ChatPanel({ videoId }: { videoId: string }) {
  const { t } = useTranslation();
  const { richSummary } = useRichSummary(videoId);
  const suggestions = buildSuggestions(richSummary?.structured ?? null);
  const wrapperRef = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={wrapperRef} className="copilotkit-chat-wrapper h-full">
      <CopilotChat
        className="h-full"
        labels={chatLabels}
        instructions={CHAT_INSTRUCTIONS}
        suggestions={suggestions.length > 0 ? suggestions : undefined}
        onThumbsUp={() => toast(t('learning.feedbackSaved'))}
        onThumbsDown={() => toast(t('learning.feedbackSaved'))}
      />
    </div>
  );
}

export function ChatAssistant({ videoId }: ChatAssistantProps) {
  return (
    <CopilotKit runtimeUrl="/api/v1/copilotkit" showDevConsole={false} enableInspector={false}>
      <ChatPanel videoId={videoId} />
    </CopilotKit>
  );
}
