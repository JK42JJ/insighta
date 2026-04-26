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
