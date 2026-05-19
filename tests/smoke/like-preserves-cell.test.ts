/**
 * Invariant: a Heart click must NEVER destroy a card's cell_index.
 * Source-level regression catch — the prod incident was a single SQL
 * line (`SET cell_index = EXCLUDED.cell_index`) silently demoting placed
 * cards to scratchpad (-1) when the FE omitted cellIndex. This test
 * fails if that line reappears, and the DB-level trigger migration
 * stays in place as the runtime safety net.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

describe('user_video_states cell_index protection', () => {
  const repoRoot = join(__dirname, '../..');
  const cardsRouteSource = readFileSync(join(repoRoot, 'src/api/routes/cards.ts'), 'utf-8');

  test('like ON CONFLICT must not unconditionally overwrite cell_index', () => {
    const likeBlock = cardsRouteSource.match(
      /INSERT INTO public\.user_video_states[\s\S]*?ON CONFLICT[\s\S]*?DO UPDATE[\s\S]*?\`/
    );
    expect(likeBlock).not.toBeNull();
    const onConflictBody = likeBlock![0];
    // The destructive pattern that caused the prod incident.
    expect(onConflictBody).not.toMatch(/cell_index\s*=\s*EXCLUDED\.cell_index\s*[,\n)]/);
  });

  test('DB trigger migration exists and raises on regression', () => {
    const triggerSql = readFileSync(
      join(
        repoRoot,
        'prisma/migrations/user-video-states-guards/001_protect_cell_index_regression.sql'
      ),
      'utf-8'
    );
    expect(triggerSql).toMatch(/CREATE OR REPLACE FUNCTION[\s\S]*protect_cell_index_regression/);
    expect(triggerSql).toMatch(/RAISE EXCEPTION/);
    expect(triggerSql).toMatch(/BEFORE UPDATE ON public\.user_video_states/);
  });

  test('FE useLikeCard.like accepts cellIndex in its args contract', () => {
    const hookSource = readFileSync(
      join(repoRoot, 'frontend/src/features/card-management/model/useLikeCard.ts'),
      'utf-8'
    );
    expect(hookSource).toMatch(/cellIndex\?:\s*number/);
  });

  test('FE InsightCardItemV2 forwards card.cellIndex on Heart click', () => {
    const cardSource = readFileSync(
      join(repoRoot, 'frontend/src/widgets/card-list/ui/InsightCardItemV2.tsx'),
      'utf-8'
    );
    // handleHeartClick should pass cellIndex (typed-number guard).
    expect(cardSource).toMatch(/cellIndex:\s*typeof card\.cellIndex === 'number'/);
  });
});
