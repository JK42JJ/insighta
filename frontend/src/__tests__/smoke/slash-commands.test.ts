import { describe, it, expect } from 'vitest';
import {
  SLASH_COMMAND_REGISTRY,
  CATEGORY_LABELS,
  getAvailableCommands,
} from '@shared/lib/slash-commands';

describe('SLASH_COMMAND_REGISTRY', () => {
  it('contains 5 commands', () => {
    expect(SLASH_COMMAND_REGISTRY).toHaveLength(5);
  });

  it('all commands have required fields', () => {
    for (const cmd of SLASH_COMMAND_REGISTRY) {
      expect(cmd).toHaveProperty('id');
      expect(cmd).toHaveProperty('icon');
      expect(cmd).toHaveProperty('labelKey');
      expect(typeof cmd.enabled).toBe('boolean');
      expect(typeof cmd.requiresPlayer).toBe('boolean');
      expect(['media', 'content', 'ai']).toContain(cmd.category);
    }
  });

  it('has unique ids', () => {
    const ids = SLASH_COMMAND_REGISTRY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes timestamp command requiring player', () => {
    const ts = SLASH_COMMAND_REGISTRY.find((c) => c.id === 'timestamp');
    expect(ts).toBeDefined();
    expect(ts?.requiresPlayer).toBe(true);
    expect(ts?.enabled).toBe(true);
  });

  it('includes ai-summary not requiring player', () => {
    const ai = SLASH_COMMAND_REGISTRY.find((c) => c.id === 'ai-summary');
    expect(ai).toBeDefined();
    expect(ai?.requiresPlayer).toBe(false);
    expect(ai?.enabled).toBe(true);
  });
});

describe('CATEGORY_LABELS', () => {
  it('has labels for all categories', () => {
    expect(CATEGORY_LABELS.media).toBeDefined();
    expect(CATEGORY_LABELS.content).toBeDefined();
    expect(CATEGORY_LABELS.ai).toBeDefined();
  });
});

describe('getAvailableCommands', () => {
  it('returns all commands when player is available', () => {
    const cmds = getAvailableCommands(true);
    expect(cmds).toEqual(SLASH_COMMAND_REGISTRY);
  });

  it('filters out player-required commands when no player', () => {
    const cmds = getAvailableCommands(false);
    expect(cmds.every((c) => !c.requiresPlayer)).toBe(true);
  });

  it('returns fewer commands without player', () => {
    const withPlayer = getAvailableCommands(true);
    const withoutPlayer = getAvailableCommands(false);
    expect(withoutPlayer.length).toBeLessThan(withPlayer.length);
  });

  it('always includes ai-summary (no player required)', () => {
    const cmds = getAvailableCommands(false);
    expect(cmds.some((c) => c.id === 'ai-summary')).toBe(true);
  });

  it('excludes timestamp and capture without player', () => {
    const cmds = getAvailableCommands(false);
    expect(cmds.some((c) => c.id === 'timestamp')).toBe(false);
    expect(cmds.some((c) => c.id === 'capture')).toBe(false);
  });
});
