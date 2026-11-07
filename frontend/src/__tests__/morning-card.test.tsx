import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MorningCard, formatUploadDate } from '@/features/morning-cards/MorningCard';
import type { MorningCardDto } from '@/features/morning-cards/api';

const base: MorningCardDto = {
  video_id: 'dQw4w9WgXcQ',
  title: '엑셀 자동화',
  channel_name: '채널A',
  published_at: '2026-03-05T10:00:00.000Z',
  thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  reason: '업무 실무 관련 영상',
};

describe('MorningCard', () => {
  it('shows title, channel, upload date and reason', () => {
    render(<MorningCard card={base} />);
    expect(screen.getByText('엑셀 자동화')).toBeTruthy();
    expect(screen.getByText('채널A')).toBeTruthy();
    expect(screen.getByText('2026-03-05')).toBeTruthy();
    expect(screen.getByText('업무 실무 관련 영상')).toBeTruthy();
  });

  it('renders a <script> title as literal text without creating a script element', () => {
    const title = '<script>alert(1)</script>';
    const { container } = render(<MorningCard card={{ ...base, title }} />);
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText(title)).toBeTruthy();
  });

  it('shows an unknown label for a missing date and calls onPlay on tap', () => {
    expect(formatUploadDate(null)).toBe('업로드 날짜 미상');
    expect(formatUploadDate('garbage')).toBe('업로드 날짜 미상');
    const onPlay = vi.fn();
    render(<MorningCard card={base} onPlay={onPlay} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onPlay).toHaveBeenCalledWith(base);
  });
});
