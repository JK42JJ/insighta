import type { IssueDocument } from './issue-schema';
import { NAV_LABEL_MAX } from './issue-schema';

/**
 * Publish-time rule for the sidebar labels: every story carries a `navLabel`.
 * Drafts may omit it (the schema keeps it optional), but a published issue is
 * shown in the sidebar contents, where the label is what the reader sees.
 * Returns the first blocker as a sentence naming the story, or null.
 */
export function missingNavLabel(doc: Pick<IssueDocument, 'stories'>): string | null {
  const index = doc.stories.findIndex((s) => !s.navLabel);
  if (index === -1) return null;
  const story = doc.stories[index];
  return `cannot publish: story ${index + 1} ("${story?.kicker ?? ''}") has no navLabel (sidebar contents label, ${NAV_LABEL_MAX} characters or fewer)`;
}
