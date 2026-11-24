import { describe, expect, it } from 'vitest';

import {
  LAB_DEFAULT_VIDEOS,
  parseLabControls,
  parseLabVideos,
  stampText,
  stateName,
} from '@/features/morning-feed/player-lab';

describe('player lab helpers', () => {
  it('video ids: valid 11-char ids only, at most 5; none valid -> defaults', () => {
    expect(parseLabVideos('gNv7MXP6KVs,PxPyqLSa3Sw')).toEqual(['gNv7MXP6KVs', 'PxPyqLSa3Sw']);
    expect(parseLabVideos('bad,<script>,')).toEqual([...LAB_DEFAULT_VIDEOS]);
    expect(parseLabVideos(null)).toEqual([...LAB_DEFAULT_VIDEOS]);
    expect(parseLabVideos(Array(7).fill('aaaaaaaaaaa').join(','))).toHaveLength(5);
  });

  it('controls: only "0" turns them off', () => {
    expect(parseLabControls('0')).toBe(0);
    expect(parseLabControls('1')).toBe(1);
    expect(parseLabControls(null)).toBe(1);
    expect(parseLabControls('false')).toBe(1);
  });

  it('state names and time stamps for the log', () => {
    expect(stateName(1)).toBe('playing');
    expect(stateName(-1)).toBe('unstarted');
    expect(stateName(9)).toBe('state 9');
    expect(stampText(12345)).toBe('12.3s');
    expect(stampText(-5)).toBe('0.0s');
  });
});
