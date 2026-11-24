import {
  getMorningCardsConfig,
  isMorningCardsEnabled,
  isMorningCardsTestUser,
} from '../../src/config/morning-cards';

describe('morning-cards config', () => {
  it('is off when the flag is unset', () => {
    expect(isMorningCardsEnabled({})).toBe(false);
    expect(getMorningCardsConfig({}).testUserIds).toEqual([]);
  });

  it('is off for false-like values', () => {
    expect(isMorningCardsEnabled({ MOBILE_MORNING_CARDS: 'false' })).toBe(false);
    expect(isMorningCardsEnabled({ MOBILE_MORNING_CARDS: '0' })).toBe(false);
  });

  it('allows a listed user and rejects an unlisted one', () => {
    const env = { MOBILE_MORNING_CARDS: 'true', MORNING_CARDS_TEST_USER_IDS: 'u1, u2' };
    expect(isMorningCardsTestUser('u1', env)).toBe(true);
    expect(isMorningCardsTestUser('u2', env)).toBe(true);
    expect(isMorningCardsTestUser('u3', env)).toBe(false);
    expect(isMorningCardsTestUser(null, env)).toBe(false);
  });

  it('rejects listed users when the flag is off', () => {
    expect(isMorningCardsTestUser('u1', { MORNING_CARDS_TEST_USER_IDS: 'u1' })).toBe(false);
  });
});
