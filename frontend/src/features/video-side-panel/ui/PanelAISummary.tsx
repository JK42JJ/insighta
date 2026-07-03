/**
 * AI summary read-only view for the side panel.
 *
 * Renders three layers (in priority order — first non-empty wins for the
 * "rich" block):
 *  1. CP438+1 v2 layered jsonb (`core` + `analysis` + `segments` + `lora`)
 *     — full v2 schema with atom timestamps, key_concepts, qa_pairs.
 *  2. Legacy CP425 v2 / v1 (`structured` jsonb) — tl_dr, key_points,
 *     actionables, chapters. Fallback for rows authored before CP437.
 *  3. Short metadata summary (`videoSummary.summary_ko|en` + tags) —
 *     existing path, always renders when available.
 *
 * Design tokens: insighta-side-editor-mockup-v3.html
 */
import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { VideoSummary } from '@/entities/card/model/types';
import { getYouTubeVideoId } from '@/widgets/video-player/model/youtube-api';
import { queryKeys } from '@/shared/config/query-client';
import {
  apiClient,
  type VideoRichSummaryAnalysis,
  type VideoRichSummaryAtom,
  type VideoRichSummaryCore,
  type VideoRichSummaryLora,
  type VideoRichSummarySegments,
} from '@/shared/lib/api-client';
import { useRichSummary } from '../model/useRichSummary';
import { useEnrichStream } from '@/features/card-management/model/useEnrichStream';

export interface PanelAISummaryProps {
  videoSummary: VideoSummary | undefined;
  videoUrl?: string;
}

export function PanelAISummary({ videoSummary, videoUrl }: PanelAISummaryProps) {
  const { t } = useTranslation();
  const { mandalaId } = useParams<{ mandalaId: string }>();
  const queryClient = useQueryClient();
  const youtubeId = videoUrl ? getYouTubeVideoId(videoUrl) : null;
  // Cache-bust on every mount + videoId change so freshly-backfilled v2
  // rows surface immediately without a hard refresh.
  useEffect(() => {
    if (!youtubeId) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.video.richSummary(youtubeId) });
  }, [youtubeId, queryClient]);
  const { richSummary, isLoading: isRichLoading, isQualityWarning } = useRichSummary(youtubeId);

  const short = videoSummary?.summary_ko || videoSummary?.summary_en || null;
  const tags = videoSummary?.tags ?? [];

  // CP438+1: prefer new layered v2 jsonb when present.
  const hasNewV2 = Boolean(richSummary?.core);
  const hasLegacyRich = !hasNewV2 && Boolean(richSummary?.structured);
  const hasRich = hasNewV2 || hasLegacyRich;
  const hasShort = Boolean(short) || tags.length > 0;

  // CP500+ — `truncation` rides in core for long-video summaries generated from
  // the first N minutes (renders a "first N min of M min" badge).
  const truncation = richSummary?.core?.truncation;
  // CP500+ PR-B — terminal "skipped" row (no transcript / no metadata) ⇒ show an
  // "unavailable" message, not an eternal spinner. isQualityWarning(≠'pass')
  // already suppresses the auto-enrich re-trigger above, ending the churn.
  const isSkipped = richSummary?.qualityFlag === 'skipped';

  // CP475+ — background enrich + SSE wiring. Fire `/enrich-bg` once per
  // (videoId, mandalaId) when the segments block is missing; subscribe
  // to /enrich-stream so the UI flips to the completed state without a
  // manual refresh.
  const hasSegments =
    (richSummary?.segments?.atoms?.length ?? 0) > 0 ||
    (richSummary?.segments?.sections?.length ?? 0) > 0;
  const triggerKeyRef = useRef<string | null>(null);
  const { phase: streamPhase, isActive: isStreamActive, open: openStream } = useEnrichStream();
  useEffect(() => {
    if (!youtubeId || !mandalaId) return;
    if (isRichLoading) return;
    if (hasSegments) return;
    // CP488+ Phase 4 — skip auto-enrich for warning rows (Phase 3 worker
    // is processing them in the background; firing Heart-click enrich on
    // top of that would just queue a duplicate. The user still sees the
    // current content + auto-improving indicator below).
    if (isQualityWarning) return;
    const key = `${youtubeId}:${mandalaId}`;
    if (triggerKeyRef.current === key) return;
    triggerKeyRef.current = key;
    void (async () => {
      try {
        const res = await apiClient.enrichCardBackground(youtubeId, mandalaId);
        if (res.data.reason !== 'already_complete') {
          void openStream(youtubeId);
        }
      } catch {
        /* Silent — UI falls back to the "still being generated" message
           and the cron Track A2 retry will eventually land. */
      }
    })();
  }, [youtubeId, mandalaId, isRichLoading, hasSegments, isQualityWarning, openStream]);

  // When the SSE stream reaches a TERMINAL phase, refetch the v2 row so the
  // result lands without a manual reload. CP500+ PR-B-followup — `failed` /
  // `timeout` were missing: a no_transcript job throws NO_TRANSCRIPT → SSE
  // `failed`, and the PR-B skipped row written server-side was never fetched,
  // so the panel stayed spinning until a manual refresh. Refetching here also
  // makes isQualityWarning(≠'pass') true → the auto-enrich re-trigger guard
  // engages → churn stops.
  useEffect(() => {
    if (!youtubeId) return;
    if (streamPhase === 'scored' || streamPhase === 'failed' || streamPhase === 'timeout') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.video.richSummary(youtubeId) });
    }
  }, [streamPhase, youtubeId, queryClient]);

  const isEnrichInProgress =
    !hasSegments &&
    (isStreamActive ||
      streamPhase === 'fetching' ||
      streamPhase === 'analyzing' ||
      (triggerKeyRef.current !== null && streamPhase === 'idle'));

  // CP475+ — quick-pass closes the SSE stream long before the full path
  // lands, so the FE needs a fallback poll until `segments` appear. 5s
  // interval is gentle on the API and still feels live next to a Sonnet
  // generation that averages ~90s.
  useEffect(() => {
    if (!youtubeId) return;
    if (!isEnrichInProgress) return;
    const interval = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.video.richSummary(youtubeId) });
    }, 5000);
    return () => clearInterval(interval);
  }, [youtubeId, isEnrichInProgress, queryClient]);

  // Empty state: nothing to render. Distinguish "still being generated"
  // (background enrich in flight, or core present but segments missing)
  // from "no AI output at all" (truly empty row).
  //
  // CP488+ Phase 4 — quality-warning rows now fall through to the normal
  // render path (they have content, just at lower quality) + display a
  // subtle "auto-improving" indicator below. No more hide.
  // CP500+ PR-B — terminal "unavailable" (skipped) takes priority: a skipped
  // row carries core={skip_reason} which would otherwise trip hasNewV2 and
  // render a garbage block.
  if (isSkipped && !isRichLoading) {
    return <SummaryUnavailableMessage reason={richSummary?.core?.skip_reason} />;
  }

  if (!hasNewV2 && !hasLegacyRich && !hasShort && !isRichLoading) {
    if (isEnrichInProgress) {
      return <EnrichInProgressMessage label={t('learning.aiSummaryGenerating')} />;
    }
    return (
      <p className="py-8 text-center text-[13px] text-[#4e4f5c]">
        {t('learning.aiSummaryNotReady')}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {isQualityWarning && <AIQualityImprovingBadge />}
      {truncation?.truncated && (
        <TruncatedBadge coveredSec={truncation.coveredSec} fullSec={truncation.fullSec} />
      )}
      {hasNewV2 && richSummary && (
        <RichSummaryV2NewBlock
          core={richSummary.core ?? null}
          analysis={richSummary.analysis ?? null}
          segments={richSummary.segments ?? null}
          lora={richSummary.lora ?? null}
          youtubeId={youtubeId}
          mandalaId={mandalaId ?? null}
        />
      )}
      {hasNewV2 && !hasSegments && isEnrichInProgress && (
        <EnrichInProgressMessage label={t('learning.richSummaryGenerating')} />
      )}
      {hasLegacyRich && richSummary?.structured && (
        <RichSummaryBlock structured={richSummary.structured} />
      )}

      {hasShort && (
        <section className="space-y-4">
          {hasRich && (
            <h2 className="text-[10px] font-bold uppercase tracking-[0.7px] text-[#4e4f5c]">
              {t('learning.metaSummary')}
            </h2>
          )}
          {short && (
            <section>
              {!hasRich && (
                <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#4e4f5c]">
                  {t('learning.summaryLabel')}
                </h3>
              )}
              <p className="text-[13px] leading-[1.6] text-[rgba(237,237,240,0.78)]">{short}</p>
            </section>
          )}
          {tags.length > 0 && (
            <section>
              <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#4e4f5c]">
                {t('learning.keywordsLabel')}
              </h3>
              <div className="flex flex-wrap gap-x-1 gap-y-[3px]">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-block rounded-[4px] bg-primary/[0.08] px-[7px] py-[2px] text-[10px] font-semibold text-primary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </section>
          )}
        </section>
      )}
    </div>
  );
}

interface RichSummaryBlockProps {
  structured: NonNullable<import('@/shared/lib/api-client').VideoRichSummaryResponse['structured']>;
}

function RichSummaryBlock({ structured }: RichSummaryBlockProps) {
  const isV2 = Array.isArray(structured.sections) && structured.sections.length > 0;

  if (isV2) {
    return <RichSummaryV2Block structured={structured} />;
  }
  return <RichSummaryV1Block structured={structured} />;
}

function RichSummaryV1Block({ structured }: RichSummaryBlockProps) {
  const { t } = useTranslation();
  const tlDr = structured.tl_dr_ko || structured.tl_dr_en || null;
  const keyPoints = structured.key_points ?? [];
  const actionables = structured.actionables ?? [];
  const chapters = structured.chapters ?? [];

  return (
    <div className="space-y-4">
      {tlDr && (
        <section>
          <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-primary">
            {t('learning.oneLiner')}
          </h3>
          <p className="text-[13px] leading-[1.6] text-[#ededf0]">{tlDr}</p>
        </section>
      )}

      {keyPoints.length > 0 && (
        <section>
          <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-primary">
            {t('learning.keyPoints')}
          </h3>
          <ul className="space-y-1.5 text-[13px] leading-[1.55] text-[rgba(237,237,240,0.84)]">
            {keyPoints.map((pt, idx) => (
              <li key={idx} className="flex gap-2">
                <span aria-hidden className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-primary" />
                <span>{pt}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {actionables.length > 0 && (
        <section>
          <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-primary">
            {t('learning.actionables')}
          </h3>
          <ul className="space-y-1.5 text-[13px] leading-[1.55] text-[rgba(237,237,240,0.84)]">
            {actionables.map((item, idx) => (
              <li key={idx} className="flex gap-2">
                <span
                  aria-hidden
                  className="mt-[2px] flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] border border-primary text-[10px] text-primary"
                >
                  →
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {chapters.length > 0 && (
        <section>
          <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-primary">
            {t('learning.chapters')}
          </h3>
          <ul className="divide-y divide-[rgba(255,255,255,0.04)] rounded-[6px] bg-[rgba(255,255,255,0.02)]">
            {chapters.map((ch, idx) => (
              <li
                key={idx}
                className="flex gap-3 px-3 py-2 text-[12px] text-[rgba(237,237,240,0.84)]"
              >
                <span className="w-[46px] shrink-0 font-mono text-[11px] text-primary">
                  {formatSeconds(ch.start_sec)}
                </span>
                <span>{ch.title}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RichSummaryV2Block({ structured }: RichSummaryBlockProps) {
  const { t } = useTranslation();
  const tlDr = structured.tl_dr_ko || structured.tl_dr_en || null;
  const sections = structured.sections ?? [];
  const entities = structured.entities ?? [];

  return (
    <div className="space-y-4">
      {tlDr && (
        <section>
          <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#4e4f5c]">
            {t('learning.coreSummary')}
          </h3>
          <p className="rounded-r-[6px] border-l-2 border-primary bg-primary/[0.06] px-[14px] py-[10px] text-[13px] leading-[1.65] text-[#ededf0]">
            {tlDr}
          </p>
        </section>
      )}

      {sections.length > 0 && (
        <section>
          <h3 className="mb-[8px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#4e4f5c]">
            {t('learning.sectionAnalysis')}
          </h3>
          <div className="space-y-1">
            {sections.map((sec, idx) => (
              <SectionRow key={idx} section={sec} />
            ))}
          </div>
        </section>
      )}

      {entities.length > 0 && (
        <section>
          <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#4e4f5c]">
            {t('learning.keyConcepts')}
          </h3>
          <div className="flex flex-wrap gap-x-1 gap-y-[3px]">
            {entities.map((ent) => (
              <span
                key={ent.name}
                className="inline-block rounded-[4px] bg-primary/[0.08] px-[7px] py-[2px] text-[10px] font-semibold text-primary"
              >
                {ent.name}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

interface SectionData {
  from_sec: number;
  to_sec: number;
  title: string;
  summary?: string;
  relevance_pct: number;
  key_points?: Array<{ text: string; timestamp_sec?: number }>;
}

function SectionRow({ section }: { section: SectionData }) {
  const { t } = useTranslation();
  const relevanceColor =
    section.relevance_pct >= 75
      ? 'text-[#2dd4bf]'
      : section.relevance_pct >= 50
        ? 'text-[#f59e0b]'
        : 'text-[#94a3b8]';

  return (
    <div className="rounded-[6px] transition-colors hover:bg-[rgba(255,255,255,0.02)]">
      <div className="flex items-center gap-3 px-3 py-[10px]">
        <div className="w-[76px] shrink-0">
          <span className="font-mono text-[10px] text-primary">
            {formatSeconds(section.from_sec)} — {formatSeconds(section.to_sec)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-[1.35] text-[rgba(237,237,240,0.92)]">
            {section.title}
          </p>
          {section.summary && (
            <p className="mt-[2px] text-[13px] text-[#4e4f5c]">{section.summary}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-center gap-[1px]">
          <span className={`font-mono text-[12px] font-bold ${relevanceColor}`}>
            {section.relevance_pct}%
          </span>
          <span className="text-[7px] uppercase tracking-[0.05em] text-[#4e4f5c]">
            {t('learning.relevanceLabel')}
          </span>
        </div>
      </div>
      {section.key_points && section.key_points.length > 0 && (
        <div className="space-y-[5px] px-3 pb-[10px] pl-[90px]">
          {section.key_points.map((kp, i) => (
            <p key={i} className="text-[11px] leading-[1.5] text-[rgba(237,237,240,0.72)]">
              • {kp.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function formatSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * CP438+1: V2 layered jsonb renderer (CP437 schema).
 * Layout: core_argument hero → actionables → key_concepts →
 *         segments.sections (timeline) → segments.atoms (with timestamp
 *         jump links) → lora.qa_pairs (collapsible).
 * Atom timestamp click → opens YouTube tab at the moment via &t= param.
 */
interface RichSummaryV2NewBlockProps {
  core: VideoRichSummaryCore | null;
  analysis: VideoRichSummaryAnalysis | null;
  segments: VideoRichSummarySegments | null;
  lora: VideoRichSummaryLora | null;
  youtubeId: string | null;
  mandalaId: string | null;
}

function RichSummaryV2NewBlock({
  core,
  analysis,
  segments,
  lora,
  youtubeId,
  mandalaId,
}: RichSummaryV2NewBlockProps) {
  const { t } = useTranslation();
  const oneLiner = core?.one_liner ?? null;
  const coreArg = analysis?.core_argument ?? null;
  const actionables = analysis?.actionables ?? [];
  const keyConcepts = analysis?.key_concepts ?? [];
  const atoms = segments?.atoms ?? [];
  const qaPairs = lora?.qa_pairs ?? [];
  const subjectivity = analysis?.bias_signals?.subjectivity_level ?? null;
  const hasAd = analysis?.bias_signals?.has_ad === true;
  // Briefing-local UI state — takeaway cap + non-persistent action checks (v1).
  const [showAllTakes, setShowAllTakes] = useState(false);
  const [doneActions, setDoneActions] = useState<Set<number>>(() => new Set());

  // CP438+1: in-page seek via ?t=N param (LearningPage useEffect picks it up
  // and calls playerRef.current.seekTo). Falls back to null if mandalaId
  // missing (rare — side panel always renders inside Learning route).
  const tsUrl = (sec: number | undefined): string | null =>
    mandalaId && youtubeId && Number.isFinite(sec)
      ? `/learning/${mandalaId}/${youtubeId}?t=${Math.floor(sec ?? 0)}`
      : null;

  // [BRIEFING 2026-07-03, James-approved mockup 69f71c04] — the summary tab
  // is a LEARNING BRIEFING, ordered by user value: essence → my-goal fit →
  // takeaways → actions → glossary → self-check. The segment timeline that
  // used to fill half this tab is GONE — the chapters tab owns the time axis.
  const mandalaFit = analysis?.mandala_fit ?? null;
  const fitPct = mandalaFit?.mandala_relevance_pct;
  const fitWhy = mandalaFit?.relevance_rationale ?? null;
  const prerequisites = analysis?.prerequisites ?? null;
  const depthLevel = core?.depth_level ?? null;
  const targetAudience = core?.target_audience ?? null;

  // Takeaways: atoms re-ordered by value (tips → arguments → facts), capped.
  const TAKE_CAP = 6;
  const orderedAtoms = [
    ...atoms.filter((a) => a.type === 'tip'),
    ...atoms.filter((a) => a.type === 'argument'),
    ...atoms.filter((a) => a.type !== 'tip' && a.type !== 'argument'),
  ];
  const visibleAtoms = showAllTakes ? orderedAtoms : orderedAtoms.slice(0, TAKE_CAP);

  return (
    <div className="space-y-7">
      {/* ① Essence — one-liner headline + core argument. */}
      {(oneLiner || coreArg) && (
        <section className="border-l-[3px] border-[var(--lp-accent)] pl-4">
          {oneLiner && (
            <p className="text-[17px] font-bold leading-[1.5] tracking-[-0.015em] text-[var(--lp-strong)] [text-wrap:balance]">
              {oneLiner}
            </p>
          )}
          {coreArg && (
            <p className="mt-2 max-w-[62ch] text-[13px] leading-[1.65] text-[var(--lp-dim)]">
              {coreArg}
            </p>
          )}
        </section>
      )}

      {/* ② My-goal fit — the personalization this product uniquely has. */}
      {(typeof fitPct === 'number' || fitWhy) && (
        <section className="flex items-center gap-3 rounded-[10px] border border-[var(--lp-accent-border)] bg-[var(--lp-accent-tint)] px-3.5 py-2.5">
          {typeof fitPct === 'number' && (
            <span className="shrink-0 rounded-md bg-[var(--lp-accent)] px-2 py-[3px] text-[12px] font-extrabold text-[#15171c]">
              {t('learning.briefFit', '내 목표 적합')} {fitPct}%
            </span>
          )}
          {fitWhy && (
            <span className="text-[12.5px] leading-[1.55] text-[var(--lp-text)]">{fitWhy}</span>
          )}
        </section>
      )}

      {/* ③ Takeaways — typed atoms by value order, timestamp chip = scene jump. */}
      {orderedAtoms.length > 0 && (
        <section>
          <BriefHead en="Takeaways" ko={t('learning.briefTakeaways', '핵심 정리')} />
          <ul className="flex flex-col gap-2">
            {visibleAtoms.map((atom, idx) => (
              <TakeRow key={idx} atom={atom} jumpUrl={tsUrl(atom.timestamp_sec)} />
            ))}
          </ul>
          {orderedAtoms.length > TAKE_CAP && (
            <button
              type="button"
              onClick={() => setShowAllTakes((v) => !v)}
              className="mt-2 text-[12px] text-[var(--lp-faint)] transition-colors hover:text-[var(--lp-strong)]"
            >
              {showAllTakes
                ? t('learning.briefLess', '접기')
                : t('learning.briefMore', '{{count}}개 더 보기', {
                    count: orderedAtoms.length - TAKE_CAP,
                  })}
            </button>
          )}
        </section>
      )}

      {/* ④ Actions — try-today checklist (session-local, non-persistent v1). */}
      {actionables.length > 0 && (
        <section>
          <BriefHead en="Action" ko={t('learning.briefAction', '오늘 해볼 것')} />
          <ul className="flex flex-col gap-1.5">
            {actionables.map((item, idx) => (
              <li key={idx}>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-[var(--lp-line-6)] bg-[var(--lp-surface)] px-3 py-2.5 transition-colors hover:bg-[var(--lp-surface-2)]">
                  <input
                    type="checkbox"
                    checked={doneActions.has(idx)}
                    onChange={() =>
                      setDoneActions((prev) => {
                        const next = new Set(prev);
                        if (next.has(idx)) next.delete(idx);
                        else next.add(idx);
                        return next;
                      })
                    }
                    className="mt-[3px] accent-[var(--lp-accent)]"
                  />
                  <span
                    className={
                      doneActions.has(idx)
                        ? 'text-[13px] text-[var(--lp-mute)] line-through'
                        : 'text-[13px] text-[var(--lp-text)]'
                    }
                  >
                    {item}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ⑤ Glossary — key concepts, click to expand. */}
      {keyConcepts.length > 0 && (
        <section>
          <BriefHead
            en="Glossary"
            ko={t('learning.briefGlossary', '핵심 개념')}
            hint={t('learning.briefGlossaryHint', '클릭해서 펼치기')}
          />
          <div className="flex flex-wrap gap-2">
            {keyConcepts.map((kc, idx) => (
              <TermChip key={idx} term={kc.term} definition={kc.definition} />
            ))}
          </div>
        </section>
      )}

      {/* ⑥ Reference line — level / prerequisites / audience / bias flags. */}
      {(depthLevel || prerequisites || targetAudience || hasAd || subjectivity === 'high') && (
        <section className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-[var(--lp-line-6)] pt-3 text-[12px] text-[var(--lp-faint)]">
          {depthLevel && (
            <span>
              <b className="font-semibold text-[var(--lp-dim)]">
                {t('learning.briefDepth', '난이도')}
              </b>{' '}
              {depthLevel}
            </span>
          )}
          {prerequisites && (
            <span>
              <b className="font-semibold text-[var(--lp-dim)]">
                {t('learning.briefPrereq', '선수지식')}
              </b>{' '}
              {prerequisites}
            </span>
          )}
          {targetAudience && (
            <span>
              <b className="font-semibold text-[var(--lp-dim)]">
                {t('learning.briefAudience', '대상')}
              </b>{' '}
              {targetAudience}
            </span>
          )}
          {hasAd && <span className="text-[#d9a2a2]">⚠ {t('learning.containsAds')}</span>}
          {subjectivity === 'high' && (
            <span className="text-[#d9a2a2]">⚠ {t('learning.highSubjectivity')}</span>
          )}
        </section>
      )}

      {/* ⑦ Self-check — Q first, click reveals A. */}
      {qaPairs.length > 0 && (
        <section>
          <BriefHead
            en="Check"
            ko={t('learning.briefCheck', '이해했는지 점검')}
            hint={t('learning.briefCheckHint', '질문 클릭 → 답 확인')}
          />
          <div className="flex flex-col gap-2">
            {qaPairs.map((qa, idx) => (
              <QuizItem key={idx} q={qa.q} a={qa.a} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Briefing section header — small caps label + Korean title (+hint). */
function BriefHead({ en, ko, hint }: { en: string; ko: string; hint?: string }) {
  return (
    <div className="mb-2.5 flex items-baseline gap-2.5">
      <h3 className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--lp-mute)]">
        {en}
      </h3>
      <span className="text-[13.5px] font-bold text-[var(--lp-strong)]">{ko}</span>
      {hint && <span className="text-[11px] text-[var(--lp-faint)]">{hint}</span>}
    </div>
  );
}

const TAKE_TAG: Record<string, { labelKey: string; fallback: string; cls: string }> = {
  tip: { labelKey: 'learning.atomTip', fallback: '팁', cls: 'bg-[var(--lp-rel-mid)]' },
  argument: { labelKey: 'learning.atomArgument', fallback: '주장', cls: 'bg-[#b48ead]' },
  fact: { labelKey: 'learning.atomFact', fallback: '사실', cls: 'bg-[#8fa8c9]' },
};

function TakeRow({ atom, jumpUrl }: { atom: VideoRichSummaryAtom; jumpUrl: string | null }) {
  const { t } = useTranslation();
  const tag = TAKE_TAG[atom.type ?? ''] ?? TAKE_TAG['fact']!;
  return (
    <li className="flex items-start gap-3 rounded-[11px] border border-[var(--lp-line-6)] bg-[var(--lp-surface)] px-3.5 py-2.5">
      <span
        className={`mt-[2px] shrink-0 rounded-[5px] px-1.5 py-[2px] text-[10px] font-extrabold tracking-[0.05em] text-[#15171c] ${tag.cls}`}
      >
        {t(tag.labelKey, tag.fallback)}
      </span>
      <span className="flex-1 text-[13px] leading-[1.6] text-[var(--lp-text)]">
        {atom.text}
        {jumpUrl && Number.isFinite(atom.timestamp_sec) && (
          <Link
            to={jumpUrl}
            className="ml-2 inline-block whitespace-nowrap rounded-[5px] border border-[var(--lp-accent-border)] px-1.5 text-[11px] tabular-nums text-[var(--lp-accent)] transition-colors hover:bg-[var(--lp-accent-tint)]"
          >
            {formatSeconds(atom.timestamp_sec ?? 0)}
          </Link>
        )}
      </span>
    </li>
  );
}

function TermChip({ term, definition }: { term: string; definition: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="max-w-full rounded-[9px] border border-[var(--lp-line-8)] bg-[var(--lp-surface)] px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-[12.5px] font-bold text-[var(--lp-strong)]"
      >
        {term}
        <span aria-hidden className="font-normal text-[var(--lp-faint)]">
          {open ? '–' : '+'}
        </span>
      </button>
      {open && (
        <p className="mt-1.5 max-w-[58ch] text-[12.5px] leading-[1.6] text-[var(--lp-dim)]">
          {definition}
        </p>
      )}
    </div>
  );
}

function QuizItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      className="rounded-[11px] border border-[var(--lp-line-6)] bg-[var(--lp-surface)] px-4 py-3 text-left"
    >
      <span className="flex gap-2.5 text-[13px] font-semibold text-[var(--lp-strong)]">
        <span aria-hidden className="font-extrabold text-[var(--lp-accent)]">
          Q
        </span>
        {q}
      </span>
      {open && (
        <span className="ml-[21px] mt-2 block border-l-2 border-[var(--lp-accent-border)] pl-2.5 text-[13px] leading-[1.6] text-[var(--lp-dim)]">
          {a}
        </span>
      )}
    </button>
  );
}

/**
 * CP475+ — "still being generated" message with rolling ellipsis. Used
 * both for the all-empty case (quick path still in flight) and the
 * quick-done-full-pending case (segments block awaiting the SSE-tracked
 * background job).
 */
function EnrichInProgressMessage({ label }: { label: string }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-[1px] py-8 text-center text-[13px] text-[#4e4f5c]"
    >
      <span>{label}</span>
      <span aria-hidden className="ml-1 inline-flex">
        <span className="animate-[enrich-dot_1.4s_ease-in-out_infinite]">.</span>
        <span className="animate-[enrich-dot_1.4s_ease-in-out_0.2s_infinite]">.</span>
        <span className="animate-[enrich-dot_1.4s_ease-in-out_0.4s_infinite]">.</span>
      </span>
    </p>
  );
}

/**
 * CP488+ Phase 4 — subtle indicator surfaced when the v2 row's
 * `quality_flag !== 'pass'`. Per the user's "detection, not blocking"
 * spec (docs/design/v2-quality-audit-system-2026-05-27.md §2 + §7), the
 * content still renders normally and a small amber badge tells the user
 * a background regeneration is in flight. No hide, no early return —
 * users keep using whatever the current row contains; better content
 * lands on the next view once Phase 3 worker resolves the queue row.
 */
/**
 * CP500+ PR-B — terminal "summary unavailable" state for a
 * `quality_flag='skipped'` row (genuine cannot-generate: no transcript / no
 * metadata). Replaces the eternal "generating…" spinner; no re-enqueue (caller
 * already guards on quality_flag ≠ 'pass').
 */
function SummaryUnavailableMessage({ reason }: { reason?: string }) {
  const { t } = useTranslation();
  const reasonText =
    reason === 'no_transcript'
      ? t('learning.aiSummaryUnavailableNoTranscript')
      : reason === 'no_youtube_metadata'
        ? t('learning.aiSummaryUnavailableNoMetadata')
        : t('learning.aiSummaryUnavailableGeneric');
  return (
    <p className="py-8 text-center text-[13px] text-[#4e4f5c]" role="status" aria-live="polite">
      {t('learning.aiSummaryUnavailable')}
      <br />
      <span className="text-[12px] text-[#3e3f4a]">{reasonText}</span>
    </p>
  );
}

function AIQualityImprovingBadge() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-300"
      title={t('learning.aiQualityImprovingTooltip')}
    >
      <span aria-hidden className="text-amber-400">
        ●
      </span>
      <span>{t('learning.aiQualityImproving')}</span>
    </div>
  );
}

/**
 * CP500+ — badge shown on a v2 summary generated from only the first N minutes
 * of a video that exceeds the duration cap. Tells the user the summary covers a
 * partial window so a "the conclusion is…" line isn't mistaken for the whole video.
 */
function TruncatedBadge({ coveredSec, fullSec }: { coveredSec: number; fullSec: number }) {
  const { t } = useTranslation();
  const coveredMin = Math.round(coveredSec / 60);
  const fullMin = Math.round(fullSec / 60);
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[12px] text-sky-300"
    >
      <span aria-hidden className="text-sky-400">
        ⚠
      </span>
      <span>{t('learning.aiSummaryTruncated', { covered: coveredMin, full: fullMin })}</span>
    </div>
  );
}
