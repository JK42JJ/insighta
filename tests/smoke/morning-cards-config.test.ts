import {
  getMorningCardsConfig,
  briefOwnerFor,
  isBriefReader,
  isExperimentUser,
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

  it('brief reader: any user while the flag is on; owner unset = own rows', () => {
    expect(isBriefReader('x', { MOBILE_MORNING_CARDS: 'true' })).toBe(true);
    expect(isBriefReader(null, { MOBILE_MORNING_CARDS: 'true' })).toBe(false);
    expect(isBriefReader('x', {})).toBe(false);
    expect(briefOwnerFor('v', {})).toBe('v');
    const o = '33333333-3333-4333-8333-333333333333';
    expect(briefOwnerFor('v', { MORNING_BRIEF_OWNER_ID: o })).toBe(o);
    expect(briefOwnerFor('v', { MORNING_BRIEF_OWNER_ID: '  ' })).toBe('v');
  });

  it('experiment user needs flag, test list and experiment list', () => {
    const env = {
      MOBILE_MORNING_CARDS: 'true',
      MORNING_CARDS_TEST_USER_IDS: 'u1,u2',
      MORNING_EXPERIMENT_USER_IDS: 'u1,u3',
    };
    expect(isExperimentUser('u1', env)).toBe(true);
    expect(isExperimentUser('u2', env)).toBe(false);
    expect(isExperimentUser('u3', env)).toBe(false);
    expect(isExperimentUser('u1', { ...env, MOBILE_MORNING_CARDS: 'false' })).toBe(false);
  });
});
