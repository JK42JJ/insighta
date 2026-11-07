import '@/features/morning-feed/fonts';

import { postJudgment, undoLastJudgment } from '@/features/morning-cards/api';
import fixture from '@/features/morning-feed/morning-feed.fixture.json';
import { MorningFeed, type FeedCard, type FeedCell } from '@/features/morning-feed/MorningFeed';

const CARDS = fixture.cards as FeedCard[];
const GRID = fixture.grid as FeedCell[];

/**
 * Test-hook mode (?fixture=1): the fixed card set from the design delivery. Judgments
 * are sent like real ones so the write path is exercised; failures are ignored here.
 */
export function MorningFeedFixture() {
  return (
    <MorningFeed
      cards={CARDS}
      grid={GRID}
      onJudge={(e) => {
        void postJudgment({
          video_id: 'fixture' + String(e.index).padStart(4, '0'),
          domain: 'work_practice',
          verdict: e.verdict,
          shown_position: e.shownPosition,
        }).catch(() => undefined);
      }}
      onUndo={() => {
        void undoLastJudgment().catch(() => undefined);
      }}
    />
  );
}
