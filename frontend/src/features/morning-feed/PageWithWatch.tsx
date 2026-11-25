import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { flushSync } from 'react-dom';

import type { WatchVerdict, WatchVideo } from '@/features/morning-feed/watch-list';
import { MOTION, prefersReducedMotion } from '@/features/morning-feed/motion-tokens';
import { PageWatch, type PageWatchCards } from '@/features/morning-feed/PageWatch';
import { recordBriefEvent } from '@/features/morning-feed/brief-events';
import { usedParts, type SentenceSource } from '@/features/morning-feed/brief-sentences';
import type { PlayRange } from '@/features/morning-feed/play-range';
import type { SourcePlayerHandle } from '@/features/morning-feed/SourcePlayer';
import { SourceSheet, type SheetCloseHow } from '@/features/morning-feed/SourceSheet';
import { appBack, popIsNative, trackEdgeSwipe } from '@/features/morning-feed/use-screen-history';
import {
  SENTENCE_SELECTOR,
  WatchPage,
  type OpenFrom,
  type SourceTap,
  type WatchPageProps,
} from '@/features/morning-feed/WatchPage';
import './page-watch.css';

/*
 * A brief with its videos one tap away (decision 2026-11-14). A sentence opens its sources' sheet
 * over the article (James 2026-11-25, SourceSheet); a row of the evidence list, and the sheet's
 * "영상 전체 보기", open the video screen. Either one pushes one history entry (the sheet's entry
 * becomes the video screen's), so the browser's back (and Safari's edge swipe, which is a history
 * back) returns to the article, at the place it was read.
 * Motion (decision 2026-11-14 "앱처럼 반응", values in motion-tokens.ts): the video screen slides
 * in from the right while the brief moves 30 % left and darkens; going back is exactly the
 * reverse. The browser's own back (button, edge swipe) closes at once, so the screen never moves
 * twice. The back button goes through the history too (appBack), so the history stays one entry
 * deep. The brief stays mounted under the layer (scroll and note kept).
 */

/** What happened in the source sheet, for the usage record. */
export interface SheetUsage {
  kind: 'source_sheet_open' | 'source_sheet_watch' | 'source_sheet_full' | 'source_sheet_close';
  videoId: string;
  value?: string;
}

export interface PageWithWatchProps extends Omit<
  WatchPageProps,
  'onOpenVideo' | 'onOpenSource' | 'source' | 'scrollRef'
> {
  loadCards: () => Promise<PageWatchCards | null>;
  sound: boolean;
  onSound: (on: boolean) => void;
  onJudge: (video: WatchVideo, verdict: WatchVerdict, index: number) => void;
  /** A source link or an evidence row was opened (usage count). */
  onEvidence?: (videoId: string, from: OpenFrom) => void;
  /** The source sheet's own usage records. */
  onSheet?: (e: SheetUsage) => void;
}

const shownOf = (s: Sheet): SentenceSource => s.sources[s.at]!;

const WATCH_KEY = 'mfPageWatch';
const SHEET_KEY = 'mfSourceSheet';

/** The entry names the screen underneath, so the screens' own history sees no move. */
function layerState(key: string): Record<string, unknown> {
  const s = { ...((window.history.state as Record<string, unknown> | null) ?? {}) };
  delete s[SHEET_KEY];
  delete s[WATCH_KEY];
  return { ...s, [key]: true };
}

type BriefEvent = typeof recordBriefEvent;

interface Sheet {
  /** One per opening (a new player); `key` changes with every tap. */
  id: number;
  key: number;
  /** The tapped sentence's sources and which one is shown. */
  sources: SentenceSource[];
  at: number;
  ofParagraph: boolean;
  from: OpenFrom;
  sid: string;
  closing: boolean;
  /** Left for the video screen. */
  frozen: boolean;
}

export function PageWithWatch({
  loadCards,
  sound,
  onSound,
  onJudge,
  onEvidence,
  onSheet,
  ...page
}: PageWithWatchProps): JSX.Element {
  const [watch, setWatch] = useState<{ videoId: string; t: number; key: number } | null>(null);
  /** 'in' while sliding in, 'out' while sliding back; null at rest. */
  const [phase, setPhase] = useState<'in' | 'out' | null>(null);
  const [sheet, setSheetState] = useState<Sheet | null>(null);
  const [sheetH, setSheetH] = useState(0);
  /** The browser's own back closed the sheet: nothing of ours moves. */
  const [still, setStill] = useState(false);
  /** The layer our history entry stands for. */
  const pushed = useRef<'sheet' | 'watch' | null>(null);
  /** Our own back is on its way: an opening waits for it, so its entry is not taken away. */
  const backPending = useRef(false);
  const afterBack = useRef<(() => void) | null>(null);
  const seq = useRef(0);
  const under = useRef<HTMLDivElement>(null);
  const dim = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const anims = useRef<Animation[]>([]);
  const player = useRef<SourcePlayerHandle | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  /** The article's scroll position when a layer opened. */
  const kept = useRef<number | null>(null);
  /** The source link a layer was opened from. */
  const cite = useRef<HTMLElement | null>(null);
  const usage = useRef(onSheet);
  usage.current = onSheet;
  const where = { cell: page.page?.domain, seenDate: page.page?.seen_date ?? page.title?.seenDate };
  const event = useRef<BriefEvent>(() => undefined);
  event.current = (kind, data) => recordBriefEvent(kind, { ...where, ...data });

  const sheetRef = useRef<Sheet | null>(null);
  const setSheet = useCallback((s: Sheet | null): void => {
    sheetRef.current = s;
    setSheetState(s);
    if (!s) setSheetH(0);
  }, []);

  /** Slides, then draws the rested state (`rest`) before the animations are removed. */
  const slide = useCallback((dir: 'in' | 'out', rest: () => void): void => {
    anims.current.forEach((a) => a.cancel());
    anims.current = [];
    const { ms, ease, underShift, underDim } = MOTION.push;
    const o: KeyframeAnimationOptions = { duration: ms, easing: ease, fill: 'both' };
    const shift = `translate3d(${-underShift * 100}%,0,0)`;
    const run = (el: HTMLElement | null, kf: Keyframe[]): void => {
      if (el && typeof el.animate === 'function') anims.current.push(el.animate(kf, o));
    };
    const rev = <T,>(a: T[]): T[] => (dir === 'in' ? a : a.slice().reverse());
    if (prefersReducedMotion()) {
      run(layer.current, rev([{ opacity: 0 }, { opacity: 1 }]));
    } else {
      run(
        layer.current,
        rev([{ transform: 'translate3d(100%,0,0)' }, { transform: 'translate3d(0,0,0)' }])
      );
      run(under.current, rev([{ transform: 'translate3d(0,0,0)' }, { transform: shift }]));
      run(dim.current, rev([{ opacity: 0 }, { opacity: underDim }]));
    }
    const list = anims.current;
    void Promise.all(list.map((a) => a.finished.catch(() => undefined))).then(() => {
      // a newer slide or a close took over
      if (anims.current !== list) return;
      // removed first, the leaving video screen would cover the brief again for one frame
      flushSync(rest);
      list.forEach((a) => a.cancel());
    });
  }, []);

  const keepPlace = useCallback((): void => {
    kept.current = scroll.current?.scrollTop ?? null;
  }, []);
  /** Back at the place it was read, also when the browser moved it while it was covered. */
  const restorePlace = useCallback((): void => {
    const el = scroll.current;
    const top = kept.current;
    if (!el || top === null) return;
    const put = (): void => {
      if (el.scrollTop !== top) el.scrollTop = top;
    };
    put();
    // once more after the screen is drawn, unless the reader already moved on
    let touched = false;
    const onTouch = (): void => {
      touched = true;
    };
    el.addEventListener('pointerdown', onTouch, { once: true });
    el.addEventListener('wheel', onTouch, { once: true });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!touched) put();
        el.removeEventListener('pointerdown', onTouch);
        el.removeEventListener('wheel', onTouch);
      });
    });
  }, []);
  const focusBack = useCallback((): void => {
    cite.current?.focus({ preventScroll: true });
    cite.current = null;
  }, []);

  /** Our own history back for a layer that closes by itself (no popstate handling needed). */
  const dropEntry = useCallback((): void => {
    if (!pushed.current) return;
    pushed.current = null;
    backPending.current = true;
    window.history.back();
  }, []);

  const closeNow = useCallback(() => {
    anims.current.forEach((a) => a.cancel());
    anims.current = [];
    setPhase(null);
    setWatch(null);
    setSheet(null);
    restorePlace();
    focusBack();
  }, [setSheet, restorePlace, focusBack]);

  /** The video stops and the closing is recorded; once per sheet. */
  const endSheet = useCallback((how: SheetCloseHow): Sheet | null => {
    const s = sheetRef.current;
    if (!s || s.closing || s.frozen) return null;
    player.current?.stop();
    usage.current?.({ kind: 'source_sheet_close', videoId: shownOf(s).video_id, value: how });
    return s;
  }, []);

  const closeSheet = useCallback(
    (how: SheetCloseHow): void => {
      const s = endSheet(how);
      if (!s) return;
      setSheet({ ...s, closing: true });
      dropEntry();
      restorePlace();
      focusBack();
    },
    [endSheet, setSheet, dropEntry, restorePlace, focusBack]
  );

  useEffect(() => {
    const stopEdge = trackEdgeSwipe();
    const onPop = (e: PopStateEvent): void => {
      if (backPending.current) {
        backPending.current = false;
        const run = afterBack.current;
        afterBack.current = null;
        run?.();
        return;
      }
      const was = pushed.current;
      if (!was) {
        // the browser's forward onto the entry of a layer that is gone: straight back
        const st = e.state as Record<string, unknown> | null;
        if (st?.[SHEET_KEY] || st?.[WATCH_KEY]) {
          backPending.current = true;
          window.history.back();
        }
        return;
      }
      pushed.current = null;
      if (was === 'sheet') {
        popIsNative(e);
        endSheet('back');
        setStill(true);
        closeNow();
        return;
      }
      if (popIsNative(e)) {
        closeNow();
        return;
      }
      setPhase('out');
      restorePlace();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      stopEdge();
      window.removeEventListener('popstate', onPop);
      // leaving the brief while the layer is open: drop our history entry
      if (pushed.current) {
        pushed.current = null;
        window.history.back();
      }
    };
  }, [closeNow, endSheet, restorePlace]);

  // the slides run once the layer is drawn
  useLayoutEffect(() => {
    if (phase === 'in') {
      slide('in', () => {
        setPhase((p) => (p === 'in' ? null : p));
        // covered now: the sheet it came from goes, the article is at its place again
        setStill(true);
        setSheet(null);
      });
    } else if (phase === 'out') {
      slide('out', closeNow);
    }
  }, [phase, slide, setSheet, closeNow]);

  const open = useCallback(
    (videoId: string, t: number, from: OpenFrom): void => {
      if (backPending.current) {
        afterBack.current = () => open(videoId, t, from);
        return;
      }
      keepPlace();
      seq.current += 1;
      setWatch({ videoId, t, key: seq.current });
      setPhase('in');
      onEvidence?.(videoId, from);
      event.current('video_full', { videoId, value: from });
      if (!pushed.current) {
        window.history.pushState(layerState(WATCH_KEY), '');
        pushed.current = 'watch';
      }
    },
    [onEvidence, keepPlace]
  );
  const close = useCallback(() => {
    if (pushed.current) appBack();
    else closeNow();
  }, [closeNow]);

  const openSource = useCallback(
    (tap: SourceTap): void => {
      if (backPending.current) {
        afterBack.current = () => openSource(tap);
        return;
      }
      const cur = sheetRef.current;
      if (cur?.frozen) return;
      const { sources, sid, from } = tap;
      const first = sources[0];
      if (!first) return;
      const ofParagraph = tap.scope === 'paragraph';
      seq.current += 1;
      const key = seq.current;
      cite.current = tap.el;
      onEvidence?.(first.video_id, from);
      event.current('sentence_tap', { sentenceId: sid, videoId: first.video_id, value: from });
      if (cur && !cur.closing) {
        // the same sheet and player, another sentence's video
        setSheet({ ...cur, key, sources, at: 0, ofParagraph, from, sid });
        return;
      }
      keepPlace();
      setStill(false);
      setSheet({
        id: key,
        key,
        sources,
        at: 0,
        ofParagraph,
        from,
        sid,
        closing: false,
        frozen: false,
      });
      usage.current?.({ kind: 'source_sheet_open', videoId: first.video_id, value: from });
      window.history.pushState(layerState(SHEET_KEY), '');
      pushed.current = 'sheet';
    },
    [onEvidence, keepPlace, setSheet]
  );

  /** The next or previous source of the same sentence, in the same player. */
  const turn = useCallback(
    (to: number): void => {
      const s = sheetRef.current;
      const next = s?.sources[to];
      if (!s || !next || s.closing || s.frozen || to === s.at) return;
      seq.current += 1;
      onEvidence?.(next.video_id, s.from);
      setSheet({ ...s, key: seq.current, at: to });
    },
    [onEvidence, setSheet]
  );

  /** 영상 전체 보기: the video screen, from where the sheet's video is. */
  const openFull = useCallback((): void => {
    const s = sheetRef.current;
    if (!s || s.closing || s.frozen) return;
    const at = player.current?.position() ?? null;
    player.current?.stop();
    const { video_id: videoId, t } = shownOf(s);
    usage.current?.({ kind: 'source_sheet_full', videoId });
    event.current('video_full', { sentenceId: s.sid, videoId, value: 'sheet' });
    setSheet({ ...s, frozen: true });
    seq.current += 1;
    setWatch({ videoId, t: at === null ? t : Math.floor(at), key: seq.current });
    setPhase('in');
    // the sheet's entry becomes the video screen's: back returns to the article
    window.history.replaceState(layerState(WATCH_KEY), '');
    pushed.current = 'watch';
  }, [setSheet]);

  const onWatched = useCallback(
    (videoId: string, seconds: number): void =>
      usage.current?.({ kind: 'source_sheet_watch', videoId, value: String(seconds) }),
    []
  );
  // the sentence the part was played for: after a switch the sheet already shows the next one
  const onRange = useCallback(
    (r: PlayRange, sentenceId: string | undefined): void =>
      event.current('play_range', { ...r, sentenceId, value: 'sheet' }),
    []
  );
  const onFullRange = useCallback(
    (r: PlayRange): void => event.current('play_range', { ...r, value: 'full' }),
    []
  );
  const sheetGone = useCallback((): void => {
    if (sheetRef.current?.closing) setSheet(null);
  }, [setSheet]);

  const shown = sheet && !sheet.closing ? sheet : null;
  const source = useMemo(
    () => (shown ? { sid: shown.sid, sheetH } : null),
    // a tap on the same sentence, or its next source, is no new place in the text
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown?.sid, sheetH]
  );
  const target = useMemo(
    () =>
      sheet
        ? { videoId: shownOf(sheet).video_id, t: shownOf(sheet).t, key: sheet.key, sid: sheet.sid }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheet?.key]
  );
  const video = target ? page.page?.videos.find((v) => v.video_id === target.videoId) : undefined;
  const parts = useCallback(
    (videoId: string) => (page.page ? usedParts(page.page, videoId) : []),
    [page.page]
  );

  return (
    <div className="mf-pw-host" data-testid="mf-page-host" data-phase={phase ?? undefined}>
      <div
        ref={under}
        className="mf-pw-under"
        data-covered={watch && !phase ? '' : undefined}
        aria-hidden={watch ? true : undefined}
        style={
          {
            '--src-safe-top': page.frame.safeTop + 'px',
            '--src-safe-bottom': page.frame.safeBottom + 'px',
          } as CSSProperties
        }
      >
        {/* while the sheet is open a tap on another sentence switches it, any other tap closes it;
            the empty onClick makes plain text clickable on an iPhone */}
        <div
          className="mf-pw-article"
          data-behind={shown ? '' : undefined}
          data-still={still ? '' : undefined}
          onClick={NOTHING}
          onClickCapture={(e) => {
            if (!sheetRef.current || sheetRef.current.closing) return;
            if ((e.target as Element).closest(SENTENCE_SELECTOR)) return;
            e.preventDefault();
            e.stopPropagation();
            closeSheet('outside');
          }}
        >
          <WatchPage
            {...page}
            onOpenVideo={open}
            onOpenSource={openSource}
            source={source}
            scrollRef={scroll}
          />
        </div>
        {sheet && target ? (
          <SourceSheet
            key={sheet.id}
            target={target}
            channel={video?.channel ?? ''}
            title={video?.title ?? ''}
            at={sheet.at}
            count={sheet.sources.length}
            ofParagraph={sheet.ofParagraph}
            onTurn={turn}
            closing={sheet.closing}
            frozen={sheet.frozen}
            player={player}
            onClose={closeSheet}
            onGone={sheetGone}
            onFull={openFull}
            onWatched={onWatched}
            onRange={onRange}
            onHeight={setSheetH}
          />
        ) : null}
        <div ref={dim} className="mf-stack-dim" />
      </div>
      {watch ? (
        <div ref={layer} className="mf-pw" data-testid="mf-page-watch-layer">
          <PageWatch
            key={watch.key}
            frame={page.frame}
            goalTitle={page.domainTitle}
            load={loadCards}
            start={{ videoId: watch.videoId, t: watch.t }}
            parts={parts}
            onRange={onFullRange}
            sound={sound}
            onSound={onSound}
            onJudge={onJudge}
            onClose={close}
          />
        </div>
      ) : null}
    </div>
  );
}

const NOTHING = (): void => undefined;
