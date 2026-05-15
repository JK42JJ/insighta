// This module exports ChatContext type and computeChatLayer function for
// direct use by tests; React-refresh's only-export-components rule flags
// non-component exports in a component file, so we disable it here.
/* eslint-disable react-refresh/only-export-components */
import { useMemo, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CopilotKit, useCopilotReadable } from '@copilotkit/react-core';
import { CopilotChat } from '@copilotkit/react-ui';
import '@copilotkit/react-ui/styles.css';
import { toast } from 'sonner';
import { useRichSummary } from '@/features/video-side-panel/model/useRichSummary';
import { useCaptions } from '@/features/video-side-panel/model/useCaptions';
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

// Upper bound on raw transcript text injected into the chatbot prompt when
// no structured rich summary exists. Long enough to cover most videos
// substantially; bounded to keep prompt tokens and latency in check.
const TRANSCRIPT_PROMPT_MAX_CHARS = 20000;

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

export function buildInstructions(
  videoId: string,
  richSummary: {
    title?: string;
    structured?: { key_points?: string[]; core_argument?: string; actionables?: string[] };
  } | null,
  transcript: string | null,
  language: string
): string {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const hasContent =
    richSummary != null &&
    (richSummary.title ||
      richSummary.structured?.core_argument ||
      richSummary.structured?.key_points?.length ||
      richSummary.structured?.actionables?.length);

  let videoSection: string;
  let noContentRule: string;
  let timestampRule: string;

  if (hasContent) {
    videoSection = `\n\n## Current Video\n- URL: ${videoUrl}`;
    if (richSummary!.title) videoSection += `\n- Title: ${richSummary!.title}`;
    if (richSummary!.structured?.core_argument)
      videoSection += `\n- Core argument: ${richSummary!.structured.core_argument}`;
    if (richSummary!.structured?.key_points?.length)
      videoSection += `\n- Key points:\n${richSummary!.structured.key_points.map((p) => `  - ${p}`).join('\n')}`;
    if (richSummary!.structured?.actionables?.length)
      videoSection += `\n- Actionable takeaways:\n${richSummary!.structured.actionables.map((a) => `  - ${a}`).join('\n')}`;
    noContentRule = '';
    timestampRule =
      '\n- When summarizing or referencing the video, include timestamps (e.g. 0:47) tied to actual sections in the content above to help the user navigate.';
  } else if (transcript) {
    // Fallback: no structured rich summary yet, but the raw transcript is
    // available. Feed it so the model can still produce a real summary
    // instead of refusing — grounded strictly in the transcript text.
    const clipped = transcript.slice(0, TRANSCRIPT_PROMPT_MAX_CHARS);
    const truncatedNote =
      transcript.length > TRANSCRIPT_PROMPT_MAX_CHARS
        ? '\n\n[Transcript truncated for length — summarize what is available above.]'
        : '';
    videoSection = `\n\n## Current Video\n- URL: ${videoUrl}\n- Source: raw transcript (a structured AI analysis has not been generated yet)\n\n### Transcript\n${clipped}${truncatedNote}`;
    noContentRule =
      '\n- A structured AI summary is not available yet, but the raw video transcript is provided below. Base every answer strictly on that transcript. You MAY and SHOULD summarize the video from it when asked. Do NOT invent content, claims, or timestamps that are not present in the transcript.';
    timestampRule = '';
  } else {
    videoSection = `\n\n## Current Video\n- URL: ${videoUrl}\n- Content status: No transcript or AI analysis is available for this video yet.`;
    noContentRule = `\n- IMPORTANT: Neither an AI analysis nor a transcript is available for this video. Do NOT fabricate a summary. Do NOT invent timestamps. Do NOT guess or infer the video's topic or content from any other context (including the user's learning goal or mandala). When the user asks about the video, tell them warmly that the content could not be loaded yet, and offer to help in the meantime with general questions about their learning goal.`;
    timestampRule = '';
  }

  return `You are Insighta's learning assistant. You help users learn from the YouTube video they are currently watching.

## Language rule (highest priority)
- Always respond in the same language as the user's most recent message.
- The user's current UI language is: ${language}. Default to that language when the user's intent is ambiguous.
- Never override this rule based on the language of any other context (video content, system prompt, learning goal).

## Role
- Answer questions accurately based on available video content.
- Explain key concepts in plain, accessible language.
- Suggest practical applications and next learning steps.

## Rules
- Confine answers to what is actually available in the video content below. If something is not covered, say so plainly (e.g. "The video doesn't cover that").${noContentRule}
- Keep answers concise and structured — use bullet points or numbered lists.
- Explain technical jargon with simple definitions.
- IMPORTANT: The "mandala" / learning-goal context provided elsewhere describes the USER'S BROADER LEARNING OBJECTIVE — it is NOT the current video's content. Never confuse the user's goal title or cell names with the video's topic.
- Do not open or close with boilerplate phrases like "This video is about…" or "I hope this helps!". Start directly with the substance.${timestampRule}${videoSection}`;
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
  const { t, i18n } = useTranslation();
  const { richSummary, isLoading: richSummaryLoading } = useRichSummary(videoId);
  // Transcript fallback: only fetched once rich-summary resolves to "absent",
  // so videos that already have a structured summary never hit the captions
  // endpoint.
  const { captions } = useCaptions(videoId, !richSummaryLoading && !richSummary);
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
    () =>
      buildInstructions(videoId, richSummary ?? null, captions?.fullText ?? null, i18n.language),
    [videoId, richSummary, captions, i18n.language]
  );

  useCopilotReadable({
    description: 'Current YouTube video context and assistant role instructions',
    value: instructions,
    convert: (v: string) => v,
  });

  // Suppress Qwen3 chain-of-thought reasoning blocks. The `/no_think` flag
  // is honored by Qwen3 chat templates when present in the prompt; for
  // providers that ignore it (Gemini, OpenAI-router models) this is a
  // harmless extra line.
  useCopilotReadable({
    description: 'Output formatting directives for the underlying model',
    value: '/no_think',
    convert: (v: string) => v,
  });

  useCopilotReadable({
    description:
      "User's learning-goal hierarchy (mandala = the user's top-level learning objective; cell = a sub-topic the user is studying; section = a chapter/section within the learning book). These fields describe the USER'S GOAL and study structure — they are NOT the current video's title, topic, or content.",
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
