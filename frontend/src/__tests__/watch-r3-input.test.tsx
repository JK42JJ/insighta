import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WatchInputR3 } from '@/features/morning-feed/watch-r3-screens';

const FRAME = { vh: 844, safeTop: 47, safeBottom: 34, playerH: 219 };

describe('watch 수정 4: input header account', () => {
  it('the avatar opens the account sheet with name and email; 로그아웃 signs out', () => {
    const onLogout = vi.fn();
    render(
      <WatchInputR3
        frame={FRAME}
        dateLabel="11월 13일 금요일"
        account={{ name: '홍길동', email: 'a@example.com', onLogout }}
        state={{ kind: 'hero' }}
        chips={[]}
        history={[]}
      />
    );
    expect(screen.queryByTestId('mf-w3-acct')).toBeNull();
    fireEvent.click(screen.getByLabelText('계정'));
    const sheet = screen.getByTestId('mf-w3-acct');
    expect(sheet.textContent).toContain('홍길동');
    expect(sheet.textContent).toContain('a@example.com');
    fireEvent.click(screen.getByTestId('mf-w3-logout'));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('the sheet closes with its X', () => {
    render(
      <WatchInputR3
        frame={FRAME}
        dateLabel="11월 13일 금요일"
        account={{ name: '', email: '', onLogout: () => undefined }}
        state={{ kind: 'hero' }}
        chips={[]}
        history={[]}
      />
    );
    fireEvent.click(screen.getByLabelText('계정'));
    fireEvent.click(screen.getByLabelText('닫기'));
    expect(screen.queryByTestId('mf-w3-acct')).toBeNull();
  });
});
