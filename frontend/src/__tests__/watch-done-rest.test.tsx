import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WatchDoneR3, type R3ChipView } from '@/features/morning-feed/watch-r3-screens';

const FRAME = { vh: 844, safeTop: 47, safeBottom: 34, playerH: 219 };

const chip = (title: string, count: number, onPick = () => undefined): R3ChipView => ({
  key: title,
  title,
  done: false,
  disabled: false,
  count,
  onPick,
});

describe('다 본 뒤: chips of goals with videos left (device feedback 2026-11-14)', () => {
  it('shows the given goals in order with name and count; a chip opens its goal', () => {
    const onPick = vi.fn();
    render(
      <WatchDoneR3
        frame={FRAME}
        goalTitle="건강"
        view={null}
        rest={[chip('기술·개발', 5, onPick), chip('재테크', 3)]}
        onClose={() => undefined}
      />
    );
    const chips = screen.getAllByTestId('mf-w-done-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['기술·개발5편', '재테크3편']);
    fireEvent.click(chips[0]!);
    expect(onPick).toHaveBeenCalledTimes(1);
    // nothing is highlighted: every chip has the same look
    expect(chips.every((c) => c.className === 'mf-w3-chip' && !c.dataset.state)).toBe(true);
    expect(screen.getByTestId('mf-w-close').className).toBe('mf-w3-close-quiet');
  });

  it('no goal left: the chip area is hidden and 닫기 is the main bar', () => {
    const onClose = vi.fn();
    render(<WatchDoneR3 frame={FRAME} goalTitle="건강" view={null} onClose={onClose} />);
    expect(screen.queryByTestId('mf-w-done-rest')).toBeNull();
    const close = screen.getByTestId('mf-w-close');
    expect(close.className).toBe('mf-w3-close');
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
