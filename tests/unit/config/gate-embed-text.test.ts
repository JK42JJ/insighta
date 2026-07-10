/**
 * GATE_EMBED_TEXT mode gate (iv-A). Default `title` = current gate behavior
 * (no regression). `title_desc` = pool-aligned. Separate flag from the (B)
 * async-resort gate (supervisor condition 1).
 */
import { getGateEmbedTextMode } from '@/config/gate-embed-text';

describe('getGateEmbedTextMode', () => {
  test('unset → title (no-op, current behavior)', () => {
    expect(getGateEmbedTextMode({})).toBe('title');
  });

  test.each(['title_desc', 'TITLE_DESC', ' title_desc '])('%s → title_desc', (v) => {
    expect(getGateEmbedTextMode({ GATE_EMBED_TEXT: v })).toBe('title_desc');
  });

  test.each(['title', 'desc', 'both', '1', 'true', ''])(
    '%s → title (only exact title_desc opts in)',
    (v) => {
      expect(getGateEmbedTextMode({ GATE_EMBED_TEXT: v })).toBe('title');
    }
  );
});
