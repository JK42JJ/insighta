import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import type { MorningCardDto } from '@/features/morning-cards/api';

const mocks = vi.hoisted(() => ({ fetchMorningCards: vi.fn(), postJudgment: vi.fn() }));

vi.mock('@/features/morning-cards/api', async (orig) => {
  const actual = await orig<typeof import('@/features/morning-cards/api')>();
  return {
    ...actual,
    fetchMorningCards: mocks.fetchMorningCards,
    postJudgment: mocks.postJudgment,
  };
});

import { MorningCardsPage } from '@/features/morning-cards/MorningCardsPage';

const card = (id: string, title: string): MorningCardDto => ({
  video_id: id,
  title,
  channel_name: '채널',
  published_at: '2026-03-05T10:00:00.000Z',
  thumbnail_url: null,
  reason: '이유',
});

function swipe(area: HTMLElement, dx: number) {
  fireEvent.pointerDown(area, { clientX: 200 });
  fireEvent.pointerUp(area, { clientX: 200 + dx });
}

describe('MorningCardsPage', () => {
  beforeEach(() => {
    mocks.fetchMorningCards.mockReset();
    mocks.postJudgment.mockReset();
    mocks.postJudgment.mockResolvedValue(undefined);
    mocks.fetchMorningCards.mockResolvedValue({
      domain: 'work_practice',
      shortage: false,
      cards: [card('aaaaaaaaaaa', '첫째'), card('bbbbbbbbbbb', '둘째')],
    });
  });

  it('advances on one swipe and posts exactly one judgment with the shown position', async () => {
    render(<MorningCardsPage />);
    expect(await screen.findByText('첫째')).toBeTruthy();
    swipe(screen.getByTestId('morning-card-swipe-area'), 120);
    expect(await screen.findByText('둘째')).toBeTruthy();
    expect(mocks.postJudgment).toHaveBeenCalledTimes(1);
    expect(mocks.postJudgment).toHaveBeenCalledWith({
      video_id: 'aaaaaaaaaaa',
      domain: 'work_practice',
      verdict: 'useful',
      shown_position: 0,
    });
    swipe(screen.getByTestId('morning-card-swipe-area'), -120);
    await waitFor(() => expect(mocks.postJudgment).toHaveBeenCalledTimes(2));
    expect(mocks.postJudgment).toHaveBeenLastCalledWith(
      expect.objectContaining({ verdict: 'skip', shown_position: 1 })
    );
  });

  it('button click saves exactly one judgment, then shows the next card', async () => {
    render(<MorningCardsPage />);
    expect(await screen.findByText('첫째')).toBeTruthy();
    fireEvent.click(screen.getByTestId('verdict-useful'));
    expect(await screen.findByText('둘째')).toBeTruthy();
    expect(mocks.postJudgment).toHaveBeenCalledTimes(1);
    expect(mocks.postJudgment).toHaveBeenCalledWith({
      video_id: 'aaaaaaaaaaa',
      domain: 'work_practice',
      verdict: 'useful',
      shown_position: 0,
    });
    fireEvent.click(screen.getByTestId('verdict-skip'));
    await waitFor(() => expect(mocks.postJudgment).toHaveBeenCalledTimes(2));
    expect(mocks.postJudgment).toHaveBeenLastCalledWith(
      expect.objectContaining({ verdict: 'skip', shown_position: 1 })
    );
  });

  it('arrow keys judge: right = useful, left = skip', async () => {
    render(<MorningCardsPage />);
    expect(await screen.findByText('첫째')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(await screen.findByText('둘째')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await waitFor(() => expect(mocks.postJudgment).toHaveBeenCalledTimes(2));
    expect(mocks.postJudgment).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ verdict: 'useful' })
    );
    expect(mocks.postJudgment).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ verdict: 'skip' })
    );
  });

  it('a failed save keeps the same card and says so', async () => {
    mocks.postJudgment.mockRejectedValueOnce(new Error('500'));
    render(<MorningCardsPage />);
    expect(await screen.findByText('첫째')).toBeTruthy();
    fireEvent.click(screen.getByTestId('verdict-useful'));
    expect(await screen.findByTestId('verdict-save-failed')).toBeTruthy();
    expect(screen.getByText('첫째')).toBeTruthy();
    fireEvent.click(screen.getByTestId('verdict-useful'));
    expect(await screen.findByText('둘째')).toBeTruthy();
    expect(screen.queryByTestId('verdict-save-failed')).toBeNull();
  });

  it('shows the honest message and zero cards for an empty domain', async () => {
    mocks.fetchMorningCards.mockResolvedValue({
      domain: 'work_practice',
      shortage: true,
      cards: [],
    });
    render(<MorningCardsPage />);
    const msg = await screen.findByTestId('morning-cards-empty');
    expect(msg.textContent).toContain('올해 올라온 영상이 적습니다');
    expect(screen.queryByTestId('morning-card-swipe-area')).toBeNull();
    expect(mocks.postJudgment).not.toHaveBeenCalled();
  });

  it('opens the official youtube link on tap', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<MorningCardsPage />);
    await screen.findByText('첫째');
    const area = screen.getByTestId('morning-card-swipe-area');
    fireEvent.click(area.querySelector('button')!);
    expect(open).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=aaaaaaaaaaa',
      '_blank',
      'noopener,noreferrer'
    );
    expect(mocks.postJudgment).not.toHaveBeenCalled();
  });
});
