// CP447 — file-level disable: this module also exports ChatContext type
// and computeChatLayer function for direct use by tests + the qwen-lora
// path. Splitting them into a separate file is a bigger refactor; the
// fast-refresh impact is limited to rebuild scope on saves.
/* eslint-disable react-refresh/only-export-components */
import { useMemo, useEffect, useRef, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CopilotKit, useCopilotReadable } from '@copilotkit/react-core';
import { CopilotChat } from '@copilotkit/react-ui';
import '@copilotkit/react-ui/styles.css';
import { toast } from 'sonner';
import { useRichSummary } from '@/features/video-side-panel/model/useRichSummary';
import { useMandalaQuery } from '@/features/mandala';
import { useMandalaBook } from '@/features/mandala/model/useMandalaBook';
import { useLearningStore } from '@/pages/learning/model/useLearningStore';
import { apiClient } from '@/shared/lib/api-client';
import type { CopilotChatLabels } from '@copilotkit/react-ui';

export interface ChatContext {
  layer: 'note' | 'video-time' | 'video' | 'cell' | 'mandala' | 'global';
  mandala_id: string;
  mandala_name: string;
  cell_name: string | null;
  cell_index: number | null;
  video_id: string;
  current_section: string | null;
}

const REGION_AWARENESS_ENABLED = import.meta.env.VITE_CHATBOT_REGION_AWARENESS === 'true';

export function computeChatLayer(input: {
  regionAware: boolean;
  noteSelectionText: string | null;
  playerState: string;
  playerTimeSec: number;
  currentSection: string | null;
  selectedCellIndex: number | null;
  videoId: string;
  mandalaId: string;
}): ChatContext['layer'] {
  if (input.regionAware && input.noteSelectionText) return 'note';
  if (input.regionAware && input.playerState === 'playing' && input.playerTimeSec > 0)
    return 'video-time';
  if (input.currentSection !== null || input.selectedCellIndex !== null) return 'cell';
  if (input.videoId) return 'video';
  if (input.mandalaId) return 'mandala';
  return 'global';
}

interface ChatAssistantProps {
  mandalaId: string;
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

function ChatPanel({
  mandalaId,
  videoId,
  onSeek,
}: {
  mandalaId: string;
  videoId: string;
  onSeek?: (seconds: number) => void;
}) {
  const { t } = useTranslation();
  const { richSummary } = useRichSummary(videoId);
  const suggestions = buildSuggestions(t, richSummary?.structured ?? null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { mandalaLevels } = useMandalaQuery(mandalaId);
  const { book: bookResponse } = useMandalaBook(mandalaId);
  const selectedCellIndex = useLearningStore((s) => s.selectedCellIndex);
  const activeSectionRef = useLearningStore((s) => s.activeSectionRef);
  const activeRegion = useLearningStore((s) => s.activeRegion);
  const lastInteractionTs = useLearningStore((s) => s.lastInteractionTs);
  const playerTimeSec = useLearningStore((s) => s.playerTimeSec);
  const playerState = useLearningStore((s) => s.playerState);
  const playerDurationSec = useLearningStore((s) => s.playerDurationSec);
  const noteDraftExcerpt = useLearningStore((s) => s.noteDraftExcerpt);
  const noteSelectionText = useLearningStore((s) => s.noteSelectionText);

  const chatContext = useMemo<ChatContext>(() => {
    const mandalaName = mandalaLevels.root?.centerGoal ?? '';
    const subjects = mandalaLevels.root?.subjects ?? [];
    const cellName =
      selectedCellIndex !== null && selectedCellIndex >= 1 && selectedCellIndex <= 8
        ? (subjects[selectedCellIndex - 1] ?? null)
        : null;

    let currentSection: string | null = null;
    if (activeSectionRef && bookResponse?.book?.chapters) {
      const chapter = bookResponse.book.chapters.find((c) => c.ch === activeSectionRef.chapterIdx);
      const section = chapter?.sections?.[activeSectionRef.sectionIdx];
      if (chapter && section) currentSection = `${chapter.title} > ${section.title}`;
    }

    const layer = computeChatLayer({
      regionAware: REGION_AWARENESS_ENABLED,
      noteSelectionText,
      playerState,
      playerTimeSec,
      currentSection,
      selectedCellIndex,
      videoId,
      mandalaId,
    });

    return {
      layer,
      mandala_id: mandalaId,
      mandala_name: mandalaName,
      cell_name: cellName,
      cell_index: selectedCellIndex,
      video_id: videoId,
      current_section: currentSection,
    };
  }, [
    mandalaId,
    videoId,
    mandalaLevels,
    bookResponse,
    selectedCellIndex,
    activeSectionRef,
    playerState,
    playerTimeSec,
    noteSelectionText,
  ]);

  const instructions = useMemo(
    () => buildInstructions(videoId, richSummary ?? null),
    [videoId, richSummary]
  );

  useCopilotReadable({
    description: 'Current YouTube video context and assistant role instructions',
    value: instructions,
    convert: (v: string) => v,
  });

  useCopilotReadable({
    description: 'Structured learning context (mandala / cell / section / video hierarchy)',
    value: chatContext,
  });

  // Region awareness — gated behind VITE_CHATBOT_REGION_AWARENESS flag.
  // Default false. When off, the next 3 readables are skipped → prompt token
  // and LLM behavior identical to pre-CP446+1.
  useCopilotReadable({
    description: 'Active region of the learning page where the user last interacted',
    value: REGION_AWARENESS_ENABLED
      ? { active_region: activeRegion, last_interaction_ts: lastInteractionTs }
      : null,
  });

  useCopilotReadable({
    description: 'Current YouTube player state (playback time, paused state, duration)',
    value: REGION_AWARENESS_ENABLED
      ? {
          player_time_sec: playerTimeSec,
          player_state: playerState,
          duration_sec: playerDurationSec,
        }
      : null,
  });

  useCopilotReadable({
    description: 'User notes draft (last 200 chars + selected text if any)',
    value: REGION_AWARENESS_ENABLED
      ? { draft_excerpt: noteDraftExcerpt, selection_text: noteSelectionText }
      : null,
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

export function ChatAssistant({ mandalaId, videoId, onSeek }: ChatAssistantProps) {
  // CP447 — qwen-lora mode: bypass CopilotKit, call /api/v1/chat/qwen directly.
  // Read env inline (build-time constant; avoids react-refresh module-export
  // rule that flags top-level non-component consts in component files).
  const provider = (import.meta.env.VITE_CHATBOT_PROVIDER as string | undefined) ?? '';
  if (provider === 'qwen-lora') {
    return <QwenChatAssistant mandalaId={mandalaId} videoId={videoId} onSeek={onSeek} />;
  }

  const token = apiClient.getAccessToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  return (
    <CopilotKit
      runtimeUrl="/api/v1/chat"
      showDevConsole={false}
      enableInspector={false}
      headers={headers}
    >
      <ChatPanel mandalaId={mandalaId} videoId={videoId} onSeek={onSeek} />
    </CopilotKit>
  );
}

// ============================================================================
// CP447 — qwen-lora direct path (CopilotKit-free)
// ============================================================================

interface QwenMessage {
  role: 'user' | 'assistant';
  content: string;
}

function QwenChatAssistant({ mandalaId, videoId, onSeek }: ChatAssistantProps) {
  const { t } = useTranslation();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [messages, setMessages] = useState<QwenMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);

  // Reuse the same store fields as the CopilotKit path so the BE prompt
  // builder receives identical context regardless of provider. (BE
  // resolves cell_name from user_mandala_levels.root.subjects, so we
  // don't need useMandalaQuery here — only the IDs + region state.)
  const selectedCellIndex = useLearningStore((s) => s.selectedCellIndex);
  const activeRegion = useLearningStore((s) => s.activeRegion);
  const playerTimeSec = useLearningStore((s) => s.playerTimeSec);
  const playerState = useLearningStore((s) => s.playerState);
  const noteSelectionText = useLearningStore((s) => s.noteSelectionText);
  const activeSectionRef = useLearningStore((s) => s.activeSectionRef);
  const { book: bookResponse } = useMandalaBook(mandalaId);

  const layer = useMemo<ChatContext['layer']>(() => {
    let currentSection: string | null = null;
    if (activeSectionRef && bookResponse?.book?.chapters) {
      const ch = bookResponse.book.chapters.find((c) => c.ch === activeSectionRef.chapterIdx);
      const sec = ch?.sections?.[activeSectionRef.sectionIdx];
      if (ch && sec) currentSection = `${ch.title} > ${sec.title}`;
    }
    return computeChatLayer({
      regionAware: true,
      noteSelectionText,
      playerState,
      playerTimeSec,
      currentSection,
      selectedCellIndex,
      videoId,
      mandalaId,
    });
  }, [
    activeSectionRef,
    bookResponse,
    noteSelectionText,
    playerState,
    playerTimeSec,
    selectedCellIndex,
    videoId,
    mandalaId,
  ]);

  // Auto-scroll on new chunks.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streaming]);

  // Linkify timestamps in rendered messages (reuses page-level handler).
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !onSeek) return;
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations)
        for (const node of m.addedNodes) if (node instanceof HTMLElement) linkifyTimestamps(node);
    });
    observer.observe(wrapper, { childList: true, subtree: true });
    linkifyTimestamps(wrapper);
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('chat-ts') && target.dataset['seconds']) {
        e.preventDefault();
        onSeek(Number(target.dataset['seconds']));
      }
    };
    wrapper.addEventListener('click', handleClick);
    return () => {
      observer.disconnect();
      wrapper.removeEventListener('click', handleClick);
    };
  }, [onSeek]);

  // Cleanup in-flight request when the component unmounts.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    setInput('');
    setStreaming(true);
    const userMsg: QwenMessage = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '' }]);

    const token = apiClient.getAccessToken();
    const controller = new AbortController();
    abortRef.current = controller;

    let accumulated = '';
    try {
      const resp = await fetch('/api/v1/chat/qwen', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: trimmed,
          videoId,
          mandalaId,
          cellIndex: selectedCellIndex,
          layer,
          regionContext: {
            activeRegion: activeRegion ?? 'chat',
            layer,
            playerTimeSec,
            playerState,
            currentSection:
              activeSectionRef && bookResponse?.book?.chapters
                ? (() => {
                    const ch = bookResponse.book.chapters.find(
                      (c) => c.ch === activeSectionRef.chapterIdx
                    );
                    const sec = ch?.sections?.[activeSectionRef.sectionIdx];
                    return ch && sec ? `${ch.title} > ${sec.title}` : null;
                  })()
                : null,
            noteSelectionText,
          },
        }),
        signal: controller.signal,
      });

      if (!resp.ok || !resp.body) {
        const errBody = await resp.text().catch(() => '');
        toast.error(`chat error: ${resp.status}${errBody ? ' — ' + errBody.slice(0, 80) : ''}`);
        setStreaming(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // SSE frames are separated by \n\n
        const frames = buf.split('\n\n');
        buf = frames.pop() ?? '';
        for (const frame of frames) {
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          const payload = dataLine.slice(6).trim();
          if (payload === '[DONE]') {
            // server has flushed final marker — keep reading until reader.done
            continue;
          }
          try {
            const obj = JSON.parse(payload) as { content?: string; error?: string };
            if (obj.error) {
              toast.error(`chat upstream error: ${obj.error}`);
              continue;
            }
            if (obj.content) {
              accumulated += obj.content;
              setMessages((prev) => {
                const next = prev.slice();
                next[next.length - 1] = { role: 'assistant', content: accumulated };
                return next;
              });
            }
          } catch {
            // malformed frame — skip
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      toast.error(`chat failed: ${(err as Error).message}`);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [
    input,
    streaming,
    videoId,
    mandalaId,
    selectedCellIndex,
    layer,
    activeRegion,
    playerTimeSec,
    playerState,
    activeSectionRef,
    bookResponse,
    noteSelectionText,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send]
  );

  return (
    <div ref={wrapperRef} className="qwen-chat-wrapper flex h-full flex-col text-[14px]">
      <div className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="text-[12px] text-muted-foreground">
            {t(
              'learning.chatInitial',
              'Insighta 학습 도우미입니다. 영상에 대해 무엇이든 물어보세요.'
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === 'user'
                ? 'mb-2 ml-auto max-w-[85%] rounded-md bg-secondary/60 px-2 py-1.5'
                : 'mb-2 max-w-[95%] whitespace-pre-wrap leading-[1.6]'
            }
          >
            {m.content || (streaming && i === messages.length - 1 ? '…' : '')}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="border-t border-border p-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('learning.chatPlaceholder', '질문을 입력하세요')}
          disabled={streaming}
          rows={2}
          className="w-full resize-none rounded border border-border bg-input px-2 py-1.5 text-[14px] outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
    </div>
  );
}
