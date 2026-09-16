import type { IssueDocument } from '@/features/newsletter-note/lib/issue-types';
import { tocShortLabel } from '@/pages/learning/lib/toc-label';

/** The shape CopilotChat's `suggestions` prop takes. */
export interface BriefSuggestion {
  title: string;
  message: string;
}

/** Story chips shown before the reader types; the sidebar shows the same labels. */
export const BRIEF_STORY_CHIP_MAX = 4;

const SUMMARY_CHIP: BriefSuggestion = {
  title: '이번 호를 세 문장으로',
  message: '이번 호를 세 문장으로 요약해 주세요.',
};

const SOURCES_CHIP: BriefSuggestion = {
  title: '출처 목록',
  message: '이번 호의 출처 목록을 등급과 함께 보여 주세요.',
};

/**
 * Chips for the "ask about this issue" panel: a summary, one chip per story
 * (up to four) asking for its evidence, and the source list. The story chip
 * shows the editor's sidebar label so the panel and the contents agree; the
 * message carries the full title, which is how the story is named in the
 * text the server hands the model.
 */
export function buildBriefSuggestions(doc: Pick<IssueDocument, 'stories'>): BriefSuggestion[] {
  const stories = doc.stories.slice(0, BRIEF_STORY_CHIP_MAX).map((story) => ({
    title: `'${story.navLabel ?? tocShortLabel(story.title)}' 근거는?`,
    message: `"${story.title}" 스토리의 근거와 출처 등급을 알려 주세요.`,
  }));
  return [SUMMARY_CHIP, ...stories, SOURCES_CHIP];
}
