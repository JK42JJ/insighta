import { useState, type CSSProperties } from 'react';

import type { InsightView, WatchReaction } from '@/features/morning-feed/watch-design';
import type { Frame } from '@/features/morning-feed/watch-r3-layout';

/*
 * 입력 and 다 본 뒤 of design handoff "design_handoff_insighta_watch_v2" (수정 3, README §9 · §10).
 * Presentational only. The typed-goal row (input box + send button) is hidden until free-text
 * goals are decided (decision 2026-11-13); the chips start the feed directly.
 */

/** README §9: 본 순서 in the summary card and 이전 주제 only when the screen is this tall or more
 * (the handoff shows them without browser bars: app 844 − safe 81 = 763; with bars 642 they are cut). */
export const TALL_MIN_H = 700;

export interface R3StatView {
  k: string;
  v: number;
  u: string;
}

export interface R3SumRowView {
  key: string;
  title: string;
  tag: string;
  kind: WatchReaction;
}

export type R3InputState =
  | { kind: 'hero' }
  | {
      kind: 'done';
      goal: string;
      /** null while the summary is read: the card shows the goal only. */
      stats: R3StatView[] | null;
      rows: R3SumRowView[];
      onOpen: () => void;
    }
  | {
      kind: 'carry';
      goal: string;
      count: number;
      /** Today's thumbnails; empty = the row is not drawn. */
      thumbs: string[];
      onGo: () => void;
    };

export interface R3ChipView {
  key: string;
  title: string;
  done: boolean;
  disabled: boolean;
  /** Videos the chip opens now (tests). */
  count?: number;
  onPick: () => void;
}

export interface R3HistoryView {
  key: string;
  title: string;
  meta: string;
  onPick: () => void;
}

/** The signed-in account for the header avatar and the account sheet (README 수정 4 §6). */
export interface R3AccountView {
  name: string;
  email: string;
  /** Profile image; absent = the person icon. */
  avatarUrl?: string | null;
  onLogout: () => void;
}

function PersonIcon({ size }: { size: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="9" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

function Avatar({
  url,
  size,
  icon,
}: {
  url?: string | null;
  size: number;
  icon: number;
}): JSX.Element {
  return (
    <span className="mf-w3-avatar" style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" referrerPolicy="no-referrer" /> : <PersonIcon size={icon} />}
    </span>
  );
}

export interface WatchInputR3Props {
  frame: Frame;
  dateLabel: string;
  /** Absent = no avatar (fixture without an account). */
  account?: R3AccountView;
  state: R3InputState;
  chips: R3ChipView[];
  history: R3HistoryView[];
}

function safeVars(f: Frame): CSSProperties {
  return {
    '--w3-safe-top': f.safeTop + 'px',
    '--w3-safe-bottom': f.safeBottom + 'px',
  } as CSSProperties;
}

const HISTORY_MAX = 2;

export function WatchInputR3(p: WatchInputR3Props): JSX.Element {
  const tall = p.frame.vh - p.frame.safeTop - p.frame.safeBottom >= TALL_MIN_H;
  const s = p.state;
  const hero = s.kind === 'hero';
  const showHistory = p.history.length > 0 && (tall || hero);
  const [acct, setAcct] = useState(false);
  const account = p.account;
  return (
    <div className="mf-w3-root" data-testid="mf-w-input" style={safeVars(p.frame)}>
      <div className="mf-w3-input">
        <div className="mf-w3-input-col">
          <div className="mf-w3-input-head">
            <div className="mf-w3-brand">Insighta</div>
            <div className="mf-w3-date" data-testid="mf-w-date">
              {p.dateLabel}
            </div>
            {account ? (
              <button
                type="button"
                className="mf-w3-acct-btn"
                data-testid="mf-w3-acct-open"
                aria-label="계정"
                onClick={() => setAcct(true)}
              >
                <Avatar url={account.avatarUrl} size={32} icon={18} />
              </button>
            ) : null}
          </div>
          <div className="mf-w3-state">
            {s.kind === 'hero' ? (
              <div className="mf-w3-hero">
                <div className="mf-w3-char" aria-hidden="true">
                  <div className="mf-w3-eye" />
                  <div className="mf-w3-eye" />
                </div>
                <div className="mf-w3-hero-t" data-testid="mf-w-ask">
                  오늘은 뭘 알아볼까요?
                </div>
              </div>
            ) : null}
            {s.kind === 'carry' ? (
              <div className="mf-w3-navy-card" data-testid="mf-w-carry">
                <div className="mf-w3-navy-kick">어제에 이어서</div>
                <div className="mf-w3-carry-goal">{s.goal}</div>
                <div className="mf-w3-carry-body">
                  {'같은 목표로 오늘 ' + s.count + '편을 골라 두었습니다.'}
                </div>
                {s.thumbs.length > 0 ? (
                  <div className="mf-w3-carry-thumbs">
                    {s.thumbs.map((t, i) => (
                      <div key={i} className="mf-w3-carry-thumb">
                        <img src={t} alt="" draggable={false} />
                      </div>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  className="mf-w3-carry-btn"
                  data-testid="mf-w-carry-go"
                  onClick={s.onGo}
                >
                  이어서 보기
                </button>
              </div>
            ) : null}
            {s.kind === 'done' ? (
              <button
                type="button"
                className="mf-w3-navy-card"
                data-testid="mf-w-today-done"
                onClick={s.onOpen}
              >
                <div className="mf-w3-navy-top">
                  <div className="mf-w3-navy-kick">오늘 본 것</div>
                  <div className="mf-w3-navy-end">오늘은 끝</div>
                </div>
                <div className="mf-w3-navy-goal">{s.goal}</div>
                {s.stats ? (
                  <div className="mf-w3-sum-stats">
                    {s.stats.map((x) => (
                      <div key={x.k} className="mf-w3-sum-stat">
                        <div className="mf-w3-sum-stat-k">{x.k}</div>
                        <div className="mf-w3-sum-stat-v">
                          {x.v}
                          <span className="mf-w3-sum-stat-u">{x.u}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {tall && s.rows.length > 0 ? (
                  <div className="mf-w3-sum-rows">
                    {s.rows.map((r) => (
                      <div key={r.key} className="mf-w3-sum-row" data-kind={r.kind}>
                        <div className="mf-w3-sum-dot" />
                        <div className="mf-w3-sum-row-t">{r.title}</div>
                        <div className="mf-w3-sum-row-tag">{r.tag}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </button>
            ) : null}
          </div>
          {!hero ? (
            <div className="mf-w3-ask" data-testid="mf-w-ask">
              다른 걸 알아보고 싶다면
            </div>
          ) : null}
          {/* the typed-goal row (input box + send) is hidden until free-text goals are decided */}
          <div className="mf-w3-popular">요즘 많이 고르는 것</div>
          <div className="mf-w3-chips">
            {p.chips.map((c) => (
              <button
                key={c.key}
                type="button"
                className="mf-w3-chip"
                data-testid="mf-w-chip"
                data-state={c.done ? 'done' : undefined}
                data-count={c.count}
                disabled={c.disabled}
                onClick={c.onPick}
              >
                {c.title}
                {c.done ? <span className="mf-w3-chip-dot" /> : null}
              </button>
            ))}
          </div>
          {showHistory ? (
            <div className="mf-w3-history" data-testid="mf-w-history">
              <div className="mf-w3-history-k">이전 주제</div>
              {p.history.slice(0, HISTORY_MAX).map((h) => (
                <button
                  key={h.key}
                  type="button"
                  className="mf-w3-history-row"
                  data-testid="mf-w-history-row"
                  onClick={h.onPick}
                >
                  <span className="mf-w3-history-t">{h.title}</span>
                  <span className="mf-w3-history-m">{h.meta}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {acct && account ? (
        <>
          <div className="mf-w3-acct-scrim" onClick={() => setAcct(false)} />
          <div className="mf-w3-acct" data-testid="mf-w3-acct" role="dialog" aria-label="계정">
            <div className="mf-w3-acct-top">
              <button
                type="button"
                className="mf-w3-icon-btn"
                aria-label="닫기"
                onClick={() => setAcct(false)}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="mf-w3-acct-who">
              <Avatar url={account.avatarUrl} size={44} icon={24} />
              <div className="mf-w3-acct-text">
                <div className="mf-w3-acct-name">{account.name}</div>
                <div className="mf-w3-acct-email">{account.email}</div>
              </div>
            </div>
            <button
              type="button"
              className="mf-w3-logout"
              data-testid="mf-w3-logout"
              onClick={account.onLogout}
            >
              로그아웃
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function WatchDoneR3({
  frame,
  goalTitle,
  view,
  onClose,
}: {
  frame: Frame;
  goalTitle: string;
  /** null while loading or unreadable: the heading, the guide and the close bar only. */
  view: InsightView | null;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="mf-w3-root" data-testid="mf-w-insight" style={safeVars(frame)}>
      <div className="mf-w3-done">
        <div className="mf-w3-done-scroll">
          <div className="mf-w3-tick" />
          <div className="mf-w3-kick">오늘 본 것</div>
          <div className="mf-w3-done-goal" data-testid="mf-watch-insight-goal">
            {goalTitle}
          </div>
          {view ? (
            <div data-testid="mf-insight">
              <div className="mf-w3-done-text" data-testid="mf-w-insight-text">
                {view.paragraph}
              </div>
              <div className="mf-w3-stats">
                {view.stats.map((s) => (
                  <div key={s.k} className="mf-w3-stat" data-testid="mf-w-stat">
                    <div className="mf-w3-stat-k">{s.k}</div>
                    <div className="mf-w3-stat-v">
                      {s.v}
                      <span className="mf-w3-stat-u">{s.u}</span>
                    </div>
                  </div>
                ))}
              </div>
              {view.rows.length > 0 ? (
                <>
                  <div className="mf-w3-done-label">본 순서</div>
                  {view.rows.map((r) => (
                    <div
                      key={r.key}
                      className="mf-w3-row"
                      data-kind={r.kind}
                      data-testid="mf-insight-row"
                    >
                      <div className="mf-w3-row-dot" />
                      <div className="mf-w3-row-t">{r.title}</div>
                      <div className="mf-w3-row-tag">{r.tag}</div>
                    </div>
                  ))}
                </>
              ) : null}
              {view.bars.length > 0 ? (
                <>
                  <div className="mf-w3-done-label">어디에 시간을 썼나</div>
                  <div data-testid="mf-insight-cells">
                    {view.bars.map((b) => (
                      <div key={b.label}>
                        <div className="mf-w3-bar-head">
                          <span>{b.label}</span>
                          <span className="mf-w3-bar-min">{b.minText}</span>
                        </div>
                        <div className="mf-w3-bar-track">
                          <div className="mf-w3-bar-fill" style={{ width: b.pct + '%' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
          <div className="mf-w3-guide">
            내일도 같은 목표로 영상을 준비해 둡니다. 다른 걸 보고 싶으면 내일 첫 화면에 새로 적으면
            됩니다.
          </div>
        </div>
        <div className="mf-w3-done-foot">
          <button type="button" className="mf-w3-close" data-testid="mf-w-close" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
