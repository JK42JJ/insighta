import {
  saveJudgment,
  JudgmentValidationError,
  type JudgmentInput,
} from '../../src/modules/morning-cards/judgment-repo';

const base: JudgmentInput = {
  user_id: 'u1',
  video_id: 'abcdefghijk',
  domain: 'ai_tools',
  verdict: 'useful',
  shown_position: 2,
};

function mockDb() {
  const create = jest.fn().mockResolvedValue({});
  return { create, db: { morning_card_judgments: { create } } };
}

describe('morning-cards judgment repo', () => {
  it('writes exactly one row for a valid call', async () => {
    const { create, db } = mockDb();
    const row = await saveJudgment(db, { ...base, reason_tags: ['generic', 'generic'] });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toEqual(row);
    expect(row.reason_tags).toEqual(['generic']);
  });

  it.each([
    ['verdict', { verdict: 'maybe' }],
    ['reason tag', { reason_tags: ['boring'] }],
    ['domain', { domain: 'cooking' }],
    ['video id', { video_id: 'short' }],
    ['position', { shown_position: -1 }],
    ['position type', { shown_position: 1.5 }],
  ])('rejects an invalid %s and writes nothing', async (_n, patch) => {
    const { create, db } = mockDb();
    await expect(saveJudgment(db, { ...base, ...patch })).rejects.toBeInstanceOf(
      JudgmentValidationError
    );
    expect(create).not.toHaveBeenCalled();
  });
});
