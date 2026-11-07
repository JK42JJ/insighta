import '@/features/morning-feed/fonts';

import { postFixtureJudgment, undoFixtureJudgment } from '@/features/morning-cards/api';
import fixture from '@/features/morning-feed/morning-feed.fixture.json';
import { MorningFeed, type FeedCard, type FeedCell } from '@/features/morning-feed/MorningFeed';

const CARDS = fixture.cards as FeedCard[];
const GRID = fixture.grid as FeedCell[];

/**
 * Test-hook mode (?fixture=1): the fixed card set from the design delivery. Judgments
 * go to a server sink that answers 2xx and writes nothing, so no real data is touched.
 */
export function MorningFeedFixture() {
  return (
    <MorningFeed
      cards={CARDS}
      grid={GRID}
      onJudge={(e) => {
        void postFixtureJudgment({
          verdict: e.verdict === 'pass' ? 'skip' : e.verdict,
          shown_position: e.shownPosition,
        }).catch(() => undefined);
      }}
      onUndo={() => {
        void undoFixtureJudgment().catch(() => undefined);
      }}
    />
  );
}
