// This module exports ChatContext type and computeChatLayer function for
// direct use by tests; React-refresh's only-export-components rule flags
// non-component exports in a component file, so we disable it here.
/* eslint-disable react-refresh/only-export-components */
import { useMemo, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CopilotKit, useCopilotReadable, useCopilotChat } from '@copilotkit/react-core';
import { CopilotChat } from '@copilotkit/react-ui';
import '@copilotkit/react-ui/styles.css';
import { toast } from 'sonner';
import { useRichSummary } from '@/features/video-side-panel/model/useRichSummary';
import { useCaptions } from '@/features/video-side-panel/model/useCaptions';
import type { VideoRichSummaryResponse } from '@/shared/lib/api-client';
import { useMandalaQuery } from '@/features/mandala';
import { useMandalaBook } from '@/features/mandala/model/useMandalaBook';
import { useLearningStore } from '@/pages/learning/model/useLearningStore';
import { appendToNote } from '@/pages/learning/model/noteEditorBridge';
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

// CP477+2 — match both the canonical M:SS / HH:MM:SS form AND the raw-seconds
// variants the LoRA occasionally emits (`380초`, `380~682초`). The middleware
// tightens the output contract via `appendTimestampFormatRule`, but the model
// still drifts on long answers; we want every form to be clickable.
//
// Exported (with parseTimestamp) so the regex + parser can be unit-tested
// without rendering the React tree.
export const TIMESTAMP_RE = /(\d{1,2}:\d{2}(?::\d{2})?|\d+\s*~\s*\d+\s*초|\d+\s*초)/g;

export function parseTimestamp(ts: string): number {
  // Raw-seconds variants — read the leading integer as a second count.
  // `380초` → 380, `380~682초` → 380 (range start, matching the UX of
  // M:SS-M:SS ranges where the button seeks to the FIRST value).
  if (/초/.test(ts)) {
    const m = /^(\d+)/.exec(ts);
    return m ? Number(m[1]) : 0;
  }
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

// CP477+9 — NotebookPen icon (lucide-react) inlined as SVG so the DOM
// injection path can write it without React rendering.
const ADD_TO_NOTE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/></svg>';

/**
 * CP477+9 — Inject "메모에 추가" button at the end of each assistant chat
 * bubble (`.copilotKitAssistantMessage`). Mirrors the timestamp-linkify
 * pattern: dedup per bubble, run from the same MutationObserver pass,
 * uses `data-*` payload + delegated click handler.
 *
 * Skipped when the bubble has no usable text content (e.g., still
 * streaming with only whitespace).
 */
function addAddToNoteButtons(root: Node, label: string) {
  const scope = root as Element & { querySelectorAll?: Element['querySelectorAll'] };
  if (!scope.querySelectorAll) return;
  const bubbles = scope.querySelectorAll('.copilotKitAssistantMessage');
  for (const bubble of Array.from(bubbles)) {
    if (bubble.querySelector(':scope > .chat-add-to-note')) continue;
    const text = (bubble.textContent ?? '').trim();
    if (!text) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-add-to-note';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.dataset.copy = text;
    btn.innerHTML = ADD_TO_NOTE_ICON_SVG;
    bubble.appendChild(btn);
  }
}

/**
 * Returns true when `richSummary` carries any usable content for the prompt
 * — across v2 layered fields (`core`/`analysis`, CP437) AND v1 (`structured`,
 * pre-CP437). PanelAISummary uses the same split (`hasNewV2`/`hasLegacyRich`).
 */
export function summaryHasUsableContent(rs: VideoRichSummaryResponse | null): boolean {
  if (!rs) return false;
  if (rs.core?.one_liner) return true;
  if (rs.analysis?.core_argument) return true;
  if (rs.analysis?.key_concepts && rs.analysis.key_concepts.length > 0) return true;
  if (rs.analysis?.actionables && rs.analysis.actionables.length > 0) return true;
  if (rs.oneLiner) return true;
  if (rs.structured?.core_argument) return true;
  if (rs.structured?.key_points && rs.structured.key_points.length > 0) return true;
  if (rs.structured?.actionables && rs.structured.actionables.length > 0) return true;
  return false;
}

export function buildInstructions(
  videoId: string,
  richSummary: VideoRichSummaryResponse | null,
  transcript: string | null,
  language: string
): string {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const hasContent = summaryHasUsableContent(richSummary);

  let videoSection: string;
  let noContentRule: string;
  let timestampRule: string;

  if (hasContent && richSummary) {
    // Prefer v2 layered fields, fall back to v1 `structured` field-by-field.
    const oneLiner = richSummary.core?.one_liner ?? richSummary.oneLiner ?? null;
    const coreArg =
      richSummary.analysis?.core_argument ?? richSummary.structured?.core_argument ?? null;
    const keyConcepts = richSummary.analysis?.key_concepts ?? [];
    const keyPoints = richSummary.structured?.key_points ?? [];
    const actionables =
      richSummary.analysis?.actionables ?? richSummary.structured?.actionables ?? [];
    const sections = richSummary.segments?.sections ?? richSummary.structured?.chapters ?? null;

    videoSection = `\n\n## Current Video\n- URL: ${videoUrl}`;
    if (oneLiner) videoSection += `\n- One-liner: ${oneLiner}`;
    if (coreArg) videoSection += `\n- Core argument: ${coreArg}`;
    if (keyPoints.length)
      videoSection += `\n- Key points:\n${keyPoints.map((p) => `  - ${p}`).join('\n')}`;
    if (keyConcepts.length)
      videoSection += `\n- Key concepts:\n${keyConcepts.map((c) => `  - ${c.term}: ${c.definition}`).join('\n')}`;
    if (actionables.length)
      videoSection += `\n- Actionable takeaways:\n${actionables.map((a) => `  - ${a}`).join('\n')}`;
    if (Array.isArray(sections) && sections.length)
      videoSection += `\n- Sections (with timestamps):\n${sections
        .map((s) => {
          const t =
            'from_sec' in s && typeof s.from_sec === 'number'
              ? ` (${Math.floor(s.from_sec / 60)}:${String(s.from_sec % 60).padStart(2, '0')})`
              : '';
          const title = 'title' in s ? s.title : '';
          return `  - ${title}${t}`;
        })
        .join('\n')}`;
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

// Chip rotation (CP474): expand the candidate pool so used chips can be filtered
// out as the conversation grows; pool combines all key_points + core_argument +
// all actionables (contextual) followed by the 3 generic defaults as fallback.
// `excludeMessages` carries the set of user messages already sent in this chat
// (from useCopilotChat visibleMessages) — those chips never re-appear.
export function buildSuggestions(
  t: (key: string) => string,
  structured: { key_points?: string[]; core_argument?: string; actionables?: string[] } | null,
  excludeMessages: Set<string> = new Set()
) {
  const defaults: { title: string; message: string }[] = [
    { title: t('learning.suggestSummarize'), message: t('learning.suggestSummarizeMsg') },
    { title: t('learning.suggestRelated'), message: t('learning.suggestRelatedMsg') },
    { title: t('learning.suggestQuiz'), message: t('learning.suggestQuizMsg') },
  ];

  if (!structured) {
    return defaults.filter((s) => !excludeMessages.has(s.message)).slice(0, 3);
  }

  const contextual: { title: string; message: string }[] = [];
  const { key_points, core_argument, actionables } = structured;

  if (key_points?.length) {
    for (const p of key_points) {
      contextual.push({
        title: p.slice(0, 40),
        message: `${p}을 실제로 적용하면 어떻게 해야 하나요?`,
      });
    }
  }

  if (core_argument) {
    contextual.push({
      title: core_argument.slice(0, 40),
      message: `"${core_argument}"에서 가장 중요한 핵심은 무엇인가요?`,
    });
  }

  if (actionables?.length) {
    for (const a of actionables) {
      contextual.push({
        title: a.slice(0, 40),
        message: `${a}의 한계나 주의할 점은 무엇인가요?`,
      });
    }
  }

  // Contextual first, defaults as tail fallback. Filter against the
  // already-sent set, then take 3.
  const pool = contextual.length > 0 ? [...contextual, ...defaults] : defaults;
  return pool.filter((s) => !excludeMessages.has(s.message)).slice(0, 3);
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
  // Transcript fallback: only fetched once rich-summary resolves AND has no
  // usable content (covers (a) row missing entirely and (b) row present but
  // empty across both v2 and v1 fields — e.g. quality_flag=low). Videos with
  // any usable rich-summary content never hit the captions endpoint.
  const { captions } = useCaptions(
    videoId,
    !richSummaryLoading && !summaryHasUsableContent(richSummary ?? null)
  );
  // Chip rotation (CP474): collect user messages already sent so buildSuggestions
  // can filter used chips out. visibleMessages is reactive — every new message
  // re-renders ChatPanel and refreshes the chip set.
  const { visibleMessages } = useCopilotChat();
  const sentUserMessages = useMemo(() => {
    const set = new Set<string>();
    // CopilotKit upgrade (≥ 1.57.x via PR #676 pin / general ecosystem
    // drift) made `visibleMessages` non-iterable before the chat is
    // initialised — it can be undefined / null / a non-array object on
    // first render. Guard with Array.isArray so the page doesn't crash.
    if (!Array.isArray(visibleMessages)) return set;
    for (const m of visibleMessages) {
      const msg = m as { type?: string; role?: string; content?: string };
      if (msg.type === 'TextMessage' && msg.role === 'user' && typeof msg.content === 'string') {
        set.add(msg.content);
      }
    }
    return set;
  }, [visibleMessages]);
  const suggestions = buildSuggestions(t, richSummary?.structured ?? null, sentUserMessages);
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

  // CP477+6 +2 — `/no_think` directive moved entirely to BE middleware
  // (appendNoThinkToLastUserMessage in qwen-prompt-middleware.ts). Keeping
  // it as a useCopilotReadable here placed `/no_think` in the system-side
  // context, which Qwen3 chat templates do NOT recognise as a reasoning
  // gate — instead the base model (notably OpenRouter Qwen3.5-9B) echoed
  // the directive back as if it were a user command ("/no_think 명령어는
  // 규칙에 없는 명령어입니다"). The user-message-end placement on the BE
  // is the only path that both gates reasoning AND avoids echo.

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

  // CP477+9 — Click delegation for the injected "메모에 추가" button.
  // Reads the bubble text from the button's data-copy attribute and calls
  // the module-level appendToNote bridge. Shows success/failure toast.
  const handleAddToNoteClick = useCallback(
    (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest?.(
        '.chat-add-to-note'
      ) as HTMLElement | null;
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      const text = (target.dataset['copy'] ?? '').trim();
      if (!text) {
        toast.error(t('learning.addToNoteFailed'));
        return;
      }
      const ok = appendToNote(text);
      if (ok) {
        toast.success(t('learning.addToNoteSuccess'));
      } else {
        toast.error(t('learning.addToNoteFailed'));
      }
    },
    [t]
  );

  const addToNoteLabel = t('learning.addToNote');

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    // CP475+5 — streaming chat messages mutate via characterData on the
    // existing textNode (Vercel SDK / CopilotKit incremental render),
    // NOT childList additions. Pre-fix the observer only watched
    // childList, so timestamps that arrived chunk-by-chunk (e.g. "0:",
    // then "56") were never re-walked and stayed as plain text. The
    // bug-report screenshot (2026-05-20) shows `(0:56-1:12)` rendered
    // as plain text with no click affordance.
    //
    // We now (a) also observe characterData, (b) debounce 200ms past the
    // last mutation so we only walk once React has finished settling a
    // streamed message — without this, each streaming chunk would trigger
    // a linkify pass that React's next reconciliation would immediately
    // overwrite (textNode replace cycle), so the user never sees a button
    // until streaming ends.
    //
    // CP477+9 — also drives the "메모에 추가" button injection per assistant
    // bubble. Same debounce window so it runs once per settled stream
    // (avoids per-chunk inject + dedup miss).
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const reLinkify = () => {
      if (debounce !== null) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        linkifyTimestamps(wrapper);
        addAddToNoteButtons(wrapper, addToNoteLabel);
      }, 200);
    };

    const observer = new MutationObserver(() => reLinkify());
    observer.observe(wrapper, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    linkifyTimestamps(wrapper);
    addAddToNoteButtons(wrapper, addToNoteLabel);
    wrapper.addEventListener('click', handleTsClick);
    wrapper.addEventListener('click', handleAddToNoteClick);
    return () => {
      observer.disconnect();
      if (debounce !== null) clearTimeout(debounce);
      wrapper.removeEventListener('click', handleTsClick);
      wrapper.removeEventListener('click', handleAddToNoteClick);
    };
  }, [handleTsClick, handleAddToNoteClick, addToNoteLabel]);

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
  // CP475+6 — Bug 2 fix: chat history preserved across tab switches (chatbot ↔
  // notes) within the same videoId.
  //
  // Pre-fix `headers` was a fresh `{ Authorization: ... }` object on every
  // render. RightPanel re-renders on every `activeTab` change → ChatAssistant
  // re-renders → new `headers` reference → CopilotKit Provider treats it as a
  // config change and re-creates its internal runtime → `useCopilotChat()`'s
  // visibleMessages reset to an empty array. User-reported symptom: "노트
  // 탭 갔다 챗봇 탭 돌아오면 대화 사라짐."
  //
  // `useMemo` keyed on the token string stabilises the reference for the
  // lifetime of a token. When the JWT rotates, headers _do_ change (correctly)
  // and the runtime rebuilds — but for ordinary tab navigation it stays put.
  const token = apiClient.getAccessToken();
  const headers = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);

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
