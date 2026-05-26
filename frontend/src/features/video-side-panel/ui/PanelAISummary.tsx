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
import { useEffect, useRef } from 'react';
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
import { Info, Quote, Lightbulb, Dot } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';
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
  const { richSummary, isLoading: isRichLoading, isQualityLow } = useRichSummary(youtubeId);

  const short = videoSummary?.summary_ko || videoSummary?.summary_en || null;
  const tags = videoSummary?.tags ?? [];

  // CP438+1: prefer new layered v2 jsonb when present.
  const hasNewV2 = Boolean(richSummary?.core);
  const hasLegacyRich = !hasNewV2 && Boolean(richSummary?.structured);
  const hasRich = hasNewV2 || hasLegacyRich;
  const hasShort = Boolean(short) || tags.length > 0;

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
    // CP488+ — skip auto-enrich when the row is already marked qwen3_low.
    // Re-enriching with the same qwen3 model just re-stamps the same row;
    // the upcoming Sonnet 4.6 (B2) ship will handle regeneration globally.
    if (isQualityLow) return;
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
  }, [youtubeId, mandalaId, isRichLoading, hasSegments, isQualityLow, openStream]);

  // When the SSE stream terminates with `scored`, refetch the v2 row so
  // the segments block lands without a manual reload.
  useEffect(() => {
    if (!youtubeId) return;
    if (streamPhase === 'scored') {
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
  if (!hasNewV2 && !hasLegacyRich && !hasShort && !isRichLoading) {
    // CP488+ — qwen3_low row: surface as an in-progress (dot-animated)
    // message via the existing EnrichInProgressMessage component so the
    // visual matches the rest of the loading states and the user
    // understands this is awaiting regeneration, not a missing row.
    if (isQualityLow) {
      return <EnrichInProgressMessage label={t('learning.richSummaryQualityLowPendingRegen')} />;
    }
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
                    className="inline-block rounded-[4px] bg-[rgba(129,140,248,0.08)] px-[7px] py-[2px] text-[10px] font-semibold text-[#818cf8]"
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
          <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#818cf8]">
            {t('learning.oneLiner')}
          </h3>
          <p className="text-[13px] leading-[1.6] text-[#ededf0]">{tlDr}</p>
        </section>
      )}

      {keyPoints.length > 0 && (
        <section>
          <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#818cf8]">
            {t('learning.keyPoints')}
          </h3>
          <ul className="space-y-1.5 text-[13px] leading-[1.55] text-[rgba(237,237,240,0.84)]">
            {keyPoints.map((pt, idx) => (
              <li key={idx} className="flex gap-2">
                <span aria-hidden className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-[#818cf8]" />
                <span>{pt}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {actionables.length > 0 && (
        <section>
          <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#818cf8]">
            {t('learning.actionables')}
          </h3>
          <ul className="space-y-1.5 text-[13px] leading-[1.55] text-[rgba(237,237,240,0.84)]">
            {actionables.map((item, idx) => (
              <li key={idx} className="flex gap-2">
                <span
                  aria-hidden
                  className="mt-[2px] flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] border border-[#818cf8] text-[10px] text-[#818cf8]"
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
          <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#818cf8]">
            {t('learning.chapters')}
          </h3>
          <ul className="divide-y divide-[rgba(255,255,255,0.04)] rounded-[6px] bg-[rgba(255,255,255,0.02)]">
            {chapters.map((ch, idx) => (
              <li
                key={idx}
                className="flex gap-3 px-3 py-2 text-[12px] text-[rgba(237,237,240,0.84)]"
              >
                <span className="w-[46px] shrink-0 font-mono text-[11px] text-[#818cf8]">
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
          <p className="rounded-r-[6px] border-l-2 border-[#818cf8] bg-[rgba(99,102,241,0.06)] px-[14px] py-[10px] text-[13px] leading-[1.65] text-[#ededf0]">
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
                className="inline-block rounded-[4px] bg-[rgba(129,140,248,0.08)] px-[7px] py-[2px] text-[10px] font-semibold text-[#818cf8]"
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
          <span className="font-mono text-[10px] text-[#818cf8]">
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
  // entities feed the KG bridge; absent on rows authored before they shipped.
  const entities = analysis?.entities ?? [];
  const sections = segments?.sections ?? [];
  const atoms = segments?.atoms ?? [];
  const qaPairs = lora?.qa_pairs ?? [];
  const subjectivity = analysis?.bias_signals?.subjectivity_level ?? null;
  const hasAd = analysis?.bias_signals?.has_ad === true;

  // CP438+1: in-page seek via ?t=N param (LearningPage useEffect picks it up
  // and calls playerRef.current.seekTo). Falls back to null if mandalaId
  // missing (rare — side panel always renders inside Learning route).
  const tsUrl = (sec: number | undefined): string | null =>
    mandalaId && youtubeId && Number.isFinite(sec)
      ? `/learning/${mandalaId}/${youtubeId}?t=${Math.floor(sec ?? 0)}`
      : null;

  return (
    <div className="space-y-4">
      {/* coreArgument in the headline slot. */}
      {coreArg && (
        <section>
          <p className="rounded-[6px] bg-[rgba(99,102,241,0.06)] px-[14px] py-[10px] text-[13px] leading-[1.65] text-[#ededf0]">
            {coreArg}
          </p>
        </section>
      )}

      {sections.length > 0 && (
        <section>
          <div className="space-y-1">
            {sections.map((sec, idx) => {
              const jump = tsUrl(sec.from_sec);
              const inner = (
                <>
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-[10px] text-[#818cf8] shrink-0">
                      {formatSeconds(sec.from_sec)} — {formatSeconds(sec.to_sec)}
                    </span>
                    <p className="flex-1 text-[14px] font-semibold leading-[1.35] text-[rgba(237,237,240,0.92)]">
                      {sec.title}
                    </p>
                    {typeof sec.relevance_pct === 'number' && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className={[
                              'shrink-0 font-mono text-[11px] font-bold tabular-nums cursor-default',
                              sec.relevance_pct >= 75
                                ? 'text-[#2dd4bf]'
                                : sec.relevance_pct >= 50
                                  ? 'text-[#f59e0b]'
                                  : 'text-[#94a3b8]',
                            ].join(' ')}
                          >
                            {sec.relevance_pct}%
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-[12px]">
                          {t('learning.relevanceLabel')}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  {sec.summary && (
                    <p className="mt-[3px] pl-[88px] text-[13px] text-[rgba(237,237,240,0.66)]">
                      {sec.summary}
                    </p>
                  )}
                </>
              );
              const baseCls =
                'block rounded-[6px] px-3 py-[10px] transition-colors hover:bg-[rgba(129,140,248,0.06)]';
              return jump ? (
                <Link key={idx} to={jump} className={`${baseCls} cursor-pointer`}>
                  {inner}
                </Link>
              ) : (
                <div key={idx} className={baseCls}>
                  {inner}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {entities.length > 0 && (
        <section>
          <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#4e4f5c]">
            {t('learning.tags')}
          </h3>
          <div className="flex flex-wrap gap-x-1 gap-y-[3px]">
            {entities.map((ent) => (
              <Tooltip key={`${ent.type}:${ent.name}`}>
                <TooltipTrigger asChild>
                  <span className="inline-block rounded-[4px] bg-[rgba(129,140,248,0.08)] px-[7px] py-[2px] text-[10px] font-semibold text-[#818cf8] cursor-default">
                    {ent.name}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[12px]">
                  {ent.type}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </section>
      )}

      {(subjectivity === 'high' || hasAd) && (
        <div className="flex flex-wrap gap-1.5">
          {hasAd && (
            <span className="rounded-[4px] bg-[rgba(248,113,113,0.12)] px-[7px] py-[2px] text-[10px] font-semibold text-[#f87171]">
              {t('learning.containsAds')}
            </span>
          )}
          {subjectivity === 'high' && (
            <span className="rounded-[4px] bg-[rgba(245,158,11,0.12)] px-[7px] py-[2px] text-[10px] font-semibold text-[#f59e0b]">
              {t('learning.highSubjectivity')}
            </span>
          )}
        </div>
      )}

      {actionables.length > 0 && (
        <section>
          <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#818cf8]">
            {t('learning.actionables')}
          </h3>
          <ul className="space-y-1.5 text-[13px] leading-[1.55] text-[rgba(237,237,240,0.84)]">
            {actionables.map((item, idx) => (
              <li key={idx} className="flex gap-2">
                <span
                  aria-hidden
                  className="mt-[2px] flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] border border-[#818cf8] text-[10px] text-[#818cf8]"
                >
                  →
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {keyConcepts.length > 0 && (
        <section>
          <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#4e4f5c]">
            {t('learning.keyConcepts')}
          </h3>
          <ul className="space-y-2 text-[13px] leading-[1.5]">
            {keyConcepts.map((kc, idx) => (
              <li key={idx} className="rounded-[6px] bg-[rgba(255,255,255,0.02)] px-3 py-2">
                <p className="text-[14px] font-semibold text-[#818cf8]">{kc.term}</p>
                <p className="mt-[2px] text-[13px] text-[rgba(237,237,240,0.74)]">
                  {kc.definition}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {atoms.length > 0 && (
        <section>
          <h3 className="mb-[8px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#4e4f5c]">
            핵심 atoms
          </h3>
          <ul className="space-y-[6px]">
            {atoms.map((atom, idx) => (
              <AtomRow key={idx} atom={atom} jumpUrl={tsUrl(atom.timestamp_sec)} />
            ))}
          </ul>
        </section>
      )}

      {qaPairs.length > 0 && (
        <section>
          <details className="rounded-[6px] bg-[rgba(255,255,255,0.02)] px-3 py-2">
            <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.7px] text-[#4e4f5c]">
              자가점검 ({qaPairs.length})
            </summary>
            <ul className="mt-[8px] space-y-2 text-[12px]">
              {qaPairs.map((qa, idx) => (
                <li key={idx} className="border-l-2 border-[rgba(129,140,248,0.4)] pl-3">
                  <p className="font-semibold text-[#ededf0]">Q. {qa.q}</p>
                  <p className="mt-[2px] text-[rgba(237,237,240,0.66)]">A. {qa.a}</p>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </div>
  );
}

function AtomRow({ atom, jumpUrl }: { atom: VideoRichSummaryAtom; jumpUrl: string | null }) {
  const { t } = useTranslation();
  // Lucide icon per atom type. Meaning conveyed via hover tooltip (i18n).
  //   fact     → Info       (i in circle — neutral information / verifiable)
  //   argument → Quote      (quotation marks — speaker's claim / opinion)
  //   tip      → Lightbulb  (universal idea / actionable suggestion)
  //   other    → Dot        (subtle bullet)
  const TypeIcon =
    atom.type === 'fact'
      ? Info
      : atom.type === 'argument'
        ? Quote
        : atom.type === 'tip'
          ? Lightbulb
          : Dot;
  const tooltipKey =
    atom.type === 'fact'
      ? 'learning.atomFact'
      : atom.type === 'argument'
        ? 'learning.atomArgument'
        : atom.type === 'tip'
          ? 'learning.atomTip'
          : 'learning.atomOther';
  const tooltip = t(tooltipKey);

  return (
    <li className="flex items-start gap-2 text-[13px] leading-[1.5] text-[rgba(237,237,240,0.65)]">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="mt-[2px] inline-flex shrink-0 cursor-default">
            <TypeIcon aria-label={tooltip} className="h-3.5 w-3.5 text-white" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-[12px]">
          {tooltip}
        </TooltipContent>
      </Tooltip>
      <span className="flex-1">
        {atom.text}
        {jumpUrl && Number.isFinite(atom.timestamp_sec) && (
          <Link
            to={jumpUrl}
            className="ml-2 inline-flex items-center gap-0.5 rounded-[3px] bg-[rgba(129,140,248,0.1)] px-[5px] py-[1px] font-mono text-[10px] text-[#818cf8] hover:bg-[rgba(129,140,248,0.2)]"
          >
            ▶ {formatSeconds(atom.timestamp_sec ?? 0)}
          </Link>
        )}
      </span>
    </li>
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
