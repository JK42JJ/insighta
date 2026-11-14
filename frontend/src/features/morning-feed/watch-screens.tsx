import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import {
  chapterStamp,
  WATCH_LEVELS,
  type InsightView,
  type WatchGoal,
  type WatchItemView,
  type WatchReaction,
} from '@/features/morning-feed/watch-design';
import { counterText, segmentStates } from '@/features/morning-feed/watch-list';
import { MOTION } from '@/features/morning-feed/motion-tokens';

const CHECK_MARK = '✓';

/*
 * The four screens of the watch flow as drawn in the design handoff ("Insighta Mobile.dc.html").
 * Presentational only: the live screen (MorningWatch) and the fixture (MorningWatchFixture) give
 * them data. Styles are classes in watch.css; values come from the handoff.
 */

/** Prototype componentDidUpdate: scroll to the new section after this long. */
const SECTION_SCROLL_MS = 60;
/** Prototype scrollInput(): the same scroll again after these delays (the section is rising). */
const SECTION_SCROLL_RETRY_MS = [120, 420] as const;

/** The scroll area has scroll-behavior: smooth, so this glides like the prototype. */
function scrollToBottom(el: HTMLDivElement | null): void {
  if (el) el.scrollTop = el.scrollHeight;
}

// ── icons (inline SVGs of the prototype) ──

function SendIcon(): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 10h12M11 5l5 5-5 5" />
    </svg>
  );
}

function BackIcon(): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4l-6 6 6 6" />
    </svg>
  );
}

export function PlayIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path className="mf-w-icon-navy" d="M6 3l12 7-12 7z" />
    </svg>
  );
}

export function PauseIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path className="mf-w-icon-navy" d="M5 3h4v14H5zM11 3h4v14h-4z" />
    </svg>
  );
}

// ── 01 온보딩 ──

/** A button's label, with a turning ring once the answer takes longer than the busy wait. */
function BusyLabel({ label }: { label: string }): JSX.Element {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setLate(true), MOTION.wait.busyAfterMs);
    return () => window.clearTimeout(t);
  }, []);
  return late ? (
    <span className="mf-busy" data-testid="mf-busy">
      <span className="mf-busy-ring" aria-hidden="true" /> {label}
    </span>
  ) : (
    <>{label}</>
  );
}

const ONB_STEPS: ReadonlyArray<readonly [string, string, string, string, string]> = [
  [
    '안녕하세요',
    '저는 인사이타입니다. 알고 싶은 걸 말해 주면, 볼 만한 영상을 매일 몇 편 골라 옵니다.',
    '유행하는 영상이 아니라 당신이 가려는 쪽에 맞는 영상을 찾습니다.',
    '다음',
    '',
  ],
  [
    '고르는 기준',
    '조회수로 고르지 않습니다.',
    '누가 말하는지, 근거를 밝히는지, 지금 수준에 맞는지를 봅니다. 왜 골랐는지는 영상마다 적어 둡니다.',
    '다음',
    '',
  ],
  [
    '시작하기',
    '다 보고 나면 오늘 무엇을 봤는지 짧게 정리해 드립니다.',
    '시작하려면 YouTube 계정을 연결해 주세요. 구독과 좋아요 목록은 이미 본 것을 다시 내놓지 않는 데 씁니다.',
    'YouTube 계정 연결',
    '나이나 직업은 묻지 않습니다.',
  ],
];
export const ONB_LAST_STEP = ONB_STEPS.length - 1;

export function WatchOnboarding({
  step,
  busy = false,
  onNext,
  onSkip,
}: {
  step: number;
  /** The last step's button is working (YouTube connection). */
  busy?: boolean;
  onNext: () => void;
  /** The last step: go on without connecting YouTube (decision 2026-11-14 user test). */
  onSkip?: () => void;
}): JSX.Element {
  const s = Math.min(Math.max(0, step), ONB_LAST_STEP);
  const [kick, title, body, cta, note] = ONB_STEPS[s];
  return (
    <div className="mf-w-screen mf-w-onb" data-testid="mf-w-onb" data-step={s}>
      <div className="mf-w-onb-dots">
        {ONB_STEPS.map((_x, i) => (
          <div key={i} className="mf-w-onb-dot" data-on={i <= s ? '' : undefined} />
        ))}
      </div>
      <div className="mf-w-onb-body">
        <div className="mf-w-char-lg" aria-hidden="true">
          <div className="mf-w-eye-lg" />
          <div className="mf-w-eye-lg" />
        </div>
        <div className="mf-w-onb-kicker">{kick}</div>
        <div className="mf-w-onb-title">{title}</div>
        <div className="mf-w-onb-text">{body}</div>
      </div>
      <button
        type="button"
        className="mf-w-onb-btn"
        data-press="fill"
        data-testid="mf-w-onb-next"
        disabled={busy}
        onClick={onNext}
      >
        {busy ? <BusyLabel label={cta} /> : cta}
      </button>
      {onSkip && s === ONB_LAST_STEP ? (
        <button
          type="button"
          className="mf-w-onb-skip"
          data-press="link"
          data-testid="mf-w-onb-skip"
          disabled={busy}
          onClick={onSkip}
        >
          건너뛰기
        </button>
      ) : null}
      <div className="mf-w-onb-note">{note}</div>
    </div>
  );
}

// ── 02 입력 ──

export interface WatchChipView {
  key: string;
  title: string;
  on: boolean;
  disabled?: boolean;
  /** 'done' = today's batch is answered (opens its insight); 'none' = no videos today. */
  state?: 'done' | 'none';
  /** Videos the CTA would hand out now (live), for tests. */
  count?: number;
  /** Small text under the title ('오늘은 끝' / '오늘 영상 없음'); absent = title only. */
  note?: string;
  onPick: () => void;
}

export interface WatchHistoryView {
  key: string;
  title: string;
  meta: string;
  onPick: () => void;
}

export interface WatchCarryView {
  title: string;
  count: number;
  onGo: () => void;
}

export interface WatchInputScreenProps {
  dateLabel: string;
  carry: WatchCarryView | null;
  askTitle: string;
  chips: WatchChipView[];
  onSubmitText: (text: string) => void;
  goal: WatchGoal | null;
  level: number | null;
  onLevel: (level: number) => void;
  /** The 갈래 section shows (a level is picked and the goal has branches). */
  showBranches: boolean;
  sel: readonly number[];
  onToggle: (branch: number) => void;
  history: WatchHistoryView[];
  /** CTA label; null = no CTA bar. */
  cta: string | null;
  onStart: () => void;
}

export function WatchInputScreen(p: WatchInputScreenProps): JSX.Element {
  const scroller = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const [text, setText] = useState('');

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  // prototype scrollInput(): after a goal or a level is picked
  const scrollInput = (): void =>
    SECTION_SCROLL_RETRY_MS.forEach((ms) => {
      timers.current.push(window.setTimeout(() => scrollToBottom(scroller.current), ms));
    });

  // prototype componentDidUpdate: a new goal or level -> the scroll area goes to the bottom
  const goalKey = p.goal?.key ?? null;
  const prev = useRef<{ goal: string | null; level: number | null } | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = { goal: goalKey, level: p.level };
    if (!before || (before.goal === goalKey && before.level === p.level)) return;
    timers.current.push(
      window.setTimeout(() => scrollToBottom(scroller.current), SECTION_SCROLL_MS)
    );
  }, [goalKey, p.level]);

  const submit = (): void => {
    const t = text.trim();
    if (!t) return;
    p.onSubmitText(t);
    scrollInput();
  };

  return (
    <div className="mf-w-screen" data-testid="mf-w-input">
      <div
        ref={scroller}
        className="mf-w-scroll mf-w-input-scroll"
        data-scroll="input"
        data-testid="mf-w-scroll"
      >
        <div className="mf-w-head">
          <div className="mf-w-brand">Insighta</div>
          <div className="mf-w-date" data-testid="mf-w-date">
            {p.dateLabel}
          </div>
        </div>

        {p.carry ? (
          <div className="mf-w-carry" data-testid="mf-w-carry">
            <div className="mf-w-carry-kicker">어제에 이어서</div>
            <div className="mf-w-carry-goal">{p.carry.title}</div>
            <div className="mf-w-carry-body">
              {'같은 목표로 오늘 ' + p.carry.count + '편을 골라 두었습니다.'}
            </div>
            <div className="mf-w-carry-row">
              <button
                type="button"
                className="mf-w-carry-btn"
                data-testid="mf-w-carry-go"
                onClick={p.carry.onGo}
              >
                이어서 보기
              </button>
            </div>
          </div>
        ) : null}

        <div className="mf-w-ask">
          <div className="mf-w-char-sm" aria-hidden="true">
            <div className="mf-w-eye-sm" />
            <div className="mf-w-eye-sm" />
          </div>
          <div className="mf-w-ask-title" data-testid="mf-w-ask">
            {p.askTitle}
          </div>
        </div>

        <div className="mf-w-entry">
          <input
            className="mf-w-text"
            data-testid="mf-w-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="예: 전세 계약할 때 확인할 것"
          />
          <button
            type="button"
            className="mf-w-send"
            data-testid="mf-w-send"
            aria-label="입력"
            onClick={submit}
          >
            <SendIcon />
          </button>
        </div>
        <div className="mf-w-popular">요즘 많이 고르는 것</div>
        <div className="mf-w-chips">
          {p.chips.map((c) => (
            <button
              key={c.key}
              type="button"
              className="mf-w-chip"
              data-testid="mf-w-chip"
              data-on={c.on ? '' : undefined}
              data-state={c.state}
              data-count={c.count}
              disabled={c.disabled}
              onClick={() => {
                c.onPick();
                scrollInput();
              }}
            >
              {c.title}
              {c.note ? (
                <span className="mf-w-chip-note" data-testid="mf-w-chip-note">
                  {c.note}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {p.goal ? (
          <div className="mf-w-section" data-testid="mf-w-level-section">
            <div className="mf-w-tick" />
            <div className="mf-w-step-title">지금 어느 정도 아세요?</div>
            <div className="mf-w-section-sub">같은 주제라도 수준에 따라 맞는 영상이 다릅니다.</div>
            <div className="mf-w-levels">
              {WATCH_LEVELS.map((t, i) => (
                <button
                  key={t}
                  type="button"
                  className="mf-w-level"
                  data-testid="mf-w-level"
                  data-on={p.level === i ? '' : undefined}
                  onClick={() => {
                    p.onLevel(i);
                    scrollInput();
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {p.goal && p.showBranches ? (
          <div className="mf-w-section" data-testid="mf-w-branch-section">
            <div className="mf-w-tick" />
            <div className="mf-w-step-title">어디부터 볼까요?</div>
            <div className="mf-w-section-sub" data-branch="">
              수준에 맞춰 먼저 골라 두었습니다. 빼거나 더해도 됩니다.
            </div>
            <div className="mf-w-goal-tag">{p.goal.title}</div>
            <div className="mf-w-tree">
              <div className="mf-w-tree-trunk" />
              <div className="mf-w-tree-list">
                {p.goal.branches.map((t, i) => {
                  const on = p.sel.includes(i);
                  return (
                    <div key={t + i} className="mf-w-twig" data-on={on ? '' : undefined}>
                      <div className="mf-w-twig-line" />
                      <div className="mf-w-twig-dot" />
                      <button
                        type="button"
                        className="mf-w-branch"
                        data-testid="mf-w-branch"
                        aria-pressed={on}
                        onClick={() => p.onToggle(i)}
                      >
                        <span>{t}</span>
                        {/* lang="" keeps the design's fallback glyph for ✓ (the app's lang="en" picks a narrower one); state is on aria-pressed. */}
                        <span className="mf-w-branch-mark" lang="" aria-hidden="true">
                          {on ? '✓' : '+'}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        {p.history.length > 0 ? (
          <div className="mf-w-history" data-testid="mf-w-history">
            <div className="mf-w-history-kicker">이전 주제</div>
            {p.history.map((h) => (
              <button
                key={h.key}
                type="button"
                className="mf-w-history-row"
                data-testid="mf-w-history-row"
                onClick={h.onPick}
              >
                <span className="mf-w-history-title">{h.title}</span>
                <span className="mf-w-history-meta">{h.meta}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {p.cta !== null ? (
        <div className="mf-w-cta-bar">
          <button type="button" className="mf-w-primary" data-testid="mf-w-cta" onClick={p.onStart}>
            {p.cta}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── 03 시청 ──

export interface WatchScreenProps {
  goalTitle: string;
  item: WatchItemView;
  index: number;
  total: number;
  exit: WatchReaction | null;
  onBack: () => void;
  onReact: (kind: WatchReaction) => void;
  /** The 16:9 player box's content (live: the YouTube player; fixture: the placeholder). */
  player: ReactNode;
  playerProps?: { 'data-fixture'?: string; onClick?: () => void };
  /** Drawn right under the player box (live: the playback-failed notice). */
  belowPlayer?: ReactNode;
}

export function WatchScreen(p: WatchScreenProps): JSX.Element {
  const scroller = useRef<HTMLDivElement>(null);
  // the next video starts at the top of the page (prototype scrollWatchTop: now and after 60ms)
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    el.scrollTop = 0;
    const t = window.setTimeout(() => {
      el.scrollTop = 0;
    }, SECTION_SCROLL_MS);
    return () => window.clearTimeout(t);
  }, [p.index]);

  const { item } = p;
  const hasReason = item.reasonLines.length > 0 || item.checks.length > 0;
  return (
    <div className="mf-w-screen" data-testid="mf-w-watch">
      <div className="mf-w-top">
        <div className="mf-w-top-row">
          <button
            type="button"
            className="mf-w-back"
            data-testid="mf-watch-back"
            aria-label="목표 화면으로"
            onClick={p.onBack}
          >
            <BackIcon />
          </button>
          <div className="mf-w-goal-name" data-testid="mf-watch-goal-name">
            {p.goalTitle}
          </div>
          <div className="mf-w-counter" data-testid="mf-watch-counter">
            {counterText(Math.min(p.index, p.total - 1), p.total)}
          </div>
        </div>
        <div className="mf-w-segs">
          {segmentStates(p.total, p.index).map((state, i) => (
            <div key={i} className="mf-w-seg" data-testid="mf-watch-seg" data-state={state} />
          ))}
        </div>
      </div>
      <div
        ref={scroller}
        className="mf-w-scroll mf-w-watch-scroll"
        data-scroll="watch"
        data-testid="mf-w-scroll"
      >
        <div className="mf-w-card" data-testid="mf-watch-content" data-exit={p.exit ?? undefined}>
          <div className="mf-w-player" data-testid="mf-watch-player" {...p.playerProps}>
            {p.player}
          </div>
          {p.belowPlayer}
          <div className="mf-w-title" data-testid="mf-watch-title">
            {item.title}
          </div>
          {item.meta ? (
            <div className="mf-w-meta" data-testid="mf-watch-meta">
              {item.meta}
            </div>
          ) : null}

          {item.summary ? (
            <div className="mf-w-sum" data-testid="mf-oneliner">
              <div className="mf-w-sum-kicker">한 줄 요약</div>
              <div className="mf-w-sum-text">{item.summary}</div>
            </div>
          ) : null}

          {hasReason ? (
            <div className="mf-w-box" data-testid="mf-reason">
              <div className="mf-w-box-label">이 영상을 고른 이유</div>
              {item.reasonLines.length > 0 ? (
                <div className="mf-w-why">
                  {item.reasonLines.map((line, k) => (
                    <div key={k}>{line}</div>
                  ))}
                </div>
              ) : null}
              {item.checks.length > 0 ? (
                <div className="mf-w-checks">
                  {item.checks.map((c, k) => (
                    <div key={k} className="mf-w-check" data-plain={c.ok ? undefined : ''}>
                      {c.text.startsWith(CHECK_MARK) ? (
                        <>
                          {/* Same glyph fallback as the design (see the branch mark). */}
                          <span lang="">{CHECK_MARK}</span>
                          {c.text.slice(CHECK_MARK.length)}
                        </>
                      ) : (
                        c.text
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {item.chapters.length > 0 ? (
            <div className="mf-w-box" data-testid="mf-chapters">
              <div className="mf-w-box-label">영상 설명란에서 추린 순서</div>
              <div className="mf-w-pts">
                {item.chapters.map((c, k) => (
                  <div key={k} className="mf-w-pt">
                    <span className="mf-w-pt-at">{chapterStamp(c.at)}</span>
                    <span>{c.title}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="mf-w-bar" data-testid="mf-watch-actions">
        <button
          type="button"
          className="mf-w-btn"
          data-kind="dislike"
          data-testid="mf-watch-skip"
          data-pop={p.exit === 'dislike' ? '' : undefined}
          aria-label="별로"
          title="별로"
          onClick={() => p.onReact('dislike')}
        >
          <svg
            width="24"
            height="24"
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
        <button
          type="button"
          className="mf-w-btn"
          data-kind="pass"
          data-testid="mf-watch-pass"
          data-pop={p.exit === 'pass' ? '' : undefined}
          aria-label="넘기기"
          title="넘기기"
          onClick={() => p.onReact('pass')}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 6l6 6-6 6M13 6l6 6-6 6" />
          </svg>
        </button>
        <button
          type="button"
          className="mf-w-btn"
          data-kind="like"
          data-testid="mf-watch-like"
          data-pop={p.exit === 'like' ? '' : undefined}
          aria-label="좋아"
          title="좋아"
          onClick={() => p.onReact('like')}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 20.5s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7.5 2.5c0 5.4-7.5 10-7.5 10z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── 04 인사이트 ──

export function WatchInsightScreen({
  goalTitle,
  view,
  onClose,
}: {
  goalTitle: string;
  /** null while loading or when it could not be read: only the heading and the closing part show. */
  view: InsightView | null;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="mf-w-screen" data-testid="mf-w-insight">
      <div className="mf-w-scroll mf-w-insight-scroll" data-testid="mf-w-scroll">
        <div className="mf-w-insight-body">
          <div className="mf-w-tick" />
          <div className="mf-w-insight-kicker">오늘 본 것</div>
          <div className="mf-w-insight-goal" data-testid="mf-watch-insight-goal">
            {goalTitle}
          </div>
          {view ? (
            <div data-testid="mf-insight">
              <div className="mf-w-insight-text" data-testid="mf-w-insight-text">
                {view.paragraph}
              </div>
              <div className="mf-w-stats">
                {view.stats.map((s) => (
                  <div key={s.k} className="mf-w-stat" data-testid="mf-w-stat">
                    <div className="mf-w-stat-k">{s.k}</div>
                    <div className="mf-w-stat-v">
                      {s.v}
                      <span className="mf-w-stat-u">{s.u}</span>
                    </div>
                  </div>
                ))}
              </div>
              {view.rows.length > 0 ? (
                <>
                  <div className="mf-w-insight-label">본 순서</div>
                  <div className="mf-w-rows">
                    {view.rows.map((r) => (
                      <div
                        key={r.key}
                        className="mf-w-row"
                        data-kind={r.kind}
                        data-testid="mf-insight-row"
                      >
                        <div className="mf-w-row-dot" />
                        <div className="mf-w-row-title">{r.title}</div>
                        <div className="mf-w-row-tag">{r.tag}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
              {view.bars.length > 0 ? (
                <>
                  <div className="mf-w-insight-label">어디에 시간을 썼나</div>
                  <div className="mf-w-bars" data-testid="mf-insight-cells">
                    {view.bars.map((b) => (
                      <div key={b.label}>
                        <div className="mf-w-bar-head">
                          <span>{b.label}</span>
                          <span className="mf-w-bar-min">{b.minText}</span>
                        </div>
                        <div className="mf-w-bar-track">
                          <div className="mf-w-bar-fill" style={{ width: b.pct + '%' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
          <div className="mf-w-guide">
            내일도 같은 목표로 영상을 준비해 둡니다. 다른 걸 보고 싶으면 내일 첫 화면에 새로 적으면
            됩니다.
          </div>
          <button
            type="button"
            className="mf-w-primary mf-w-close"
            data-testid="mf-w-close"
            onClick={onClose}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
