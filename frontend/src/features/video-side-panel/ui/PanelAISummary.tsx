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
import { useParams, Link } from 'react-router-dom';
import type { VideoSummary } from '@/entities/card/model/types';
import { getYouTubeVideoId } from '@/widgets/video-player/model/youtube-api';
import type {
  VideoRichSummaryAnalysis,
  VideoRichSummaryAtom,
  VideoRichSummaryCore,
  VideoRichSummaryLora,
  VideoRichSummarySegments,
} from '@/shared/lib/api-client';
import { useRichSummary } from '../model/useRichSummary';

export interface PanelAISummaryProps {
  videoSummary: VideoSummary | undefined;
  videoUrl?: string;
}

export function PanelAISummary({ videoSummary, videoUrl }: PanelAISummaryProps) {
  const { mandalaId } = useParams<{ mandalaId: string }>();
  const youtubeId = videoUrl ? getYouTubeVideoId(videoUrl) : null;
  const { richSummary, isLoading: isRichLoading } = useRichSummary(youtubeId);

  const short = videoSummary?.summary_ko || videoSummary?.summary_en || null;
  const tags = videoSummary?.tags ?? [];

  // CP438+1: prefer new layered v2 jsonb when present.
  const hasNewV2 = Boolean(richSummary?.core);
  const hasLegacyRich = !hasNewV2 && Boolean(richSummary?.structured);
  const hasShort = Boolean(short) || tags.length > 0;

  if (!hasNewV2 && !hasLegacyRich && !hasShort && !isRichLoading) {
    return (
      <p className="py-8 text-center text-[13px] text-[#4e4f5c]">
        아직 AI 요약이 생성되지 않았어요
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
      {hasLegacyRich && richSummary?.structured && (
        <RichSummaryBlock structured={richSummary.structured} />
      )}

      {hasShort && (
        <section className="space-y-4">
          {hasRich && (
            <h2 className="text-[10px] font-bold uppercase tracking-[0.7px] text-[#4e4f5c]">
              메타 요약
            </h2>
          )}
          {short && (
            <section>
              {!hasRich && (
                <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#4e4f5c]">
                  요약
                </h3>
              )}
              <p className="text-[13px] leading-[1.6] text-[rgba(237,237,240,0.78)]">{short}</p>
            </section>
          )}
          {tags.length > 0 && (
            <section>
              <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#4e4f5c]">
                키워드
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
  const tlDr = structured.tl_dr_ko || structured.tl_dr_en || null;
  const keyPoints = structured.key_points ?? [];
  const actionables = structured.actionables ?? [];
  const chapters = structured.chapters ?? [];

  return (
    <div className="space-y-4">
      {tlDr && (
        <section>
          <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#818cf8]">
            한 줄 요약
          </h3>
          <p className="text-[13px] leading-[1.6] text-[#ededf0]">{tlDr}</p>
        </section>
      )}

      {keyPoints.length > 0 && (
        <section>
          <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#818cf8]">
            핵심 포인트
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
            실행 아이템
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
            챕터
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
  const tlDr = structured.tl_dr_ko || structured.tl_dr_en || null;
  const sections = structured.sections ?? [];
  const entities = structured.entities ?? [];

  return (
    <div className="space-y-4">
      {tlDr && (
        <section>
          <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#4e4f5c]">
            핵심 요약
          </h3>
          <p className="rounded-r-[6px] border-l-2 border-[#818cf8] bg-[rgba(99,102,241,0.06)] px-[14px] py-[10px] text-[13px] leading-[1.65] text-[#ededf0]">
            {tlDr}
          </p>
        </section>
      )}

      {sections.length > 0 && (
        <section>
          <h3 className="mb-[8px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#4e4f5c]">
            구간별 분석
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
            주요 개념
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
          <p className="text-[12px] font-semibold leading-[1.35] text-[rgba(237,237,240,0.92)]">
            {section.title}
          </p>
          {section.summary && (
            <p className="mt-[2px] text-[11px] text-[#4e4f5c]">{section.summary}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-center gap-[1px]">
          <span className={`font-mono text-[12px] font-bold ${relevanceColor}`}>
            {section.relevance_pct}%
          </span>
          <span className="text-[7px] uppercase tracking-[0.05em] text-[#4e4f5c]">관련도</span>
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
  const oneLiner = core?.one_liner ?? null;
  const coreArg = analysis?.core_argument ?? null;
  const actionables = analysis?.actionables ?? [];
  const keyConcepts = analysis?.key_concepts ?? [];
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
      {oneLiner && (
        <section>
          <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#4e4f5c]">
            한 줄 요약
          </h3>
          <p className="rounded-r-[6px] border-l-2 border-[#818cf8] bg-[rgba(99,102,241,0.06)] px-[14px] py-[10px] text-[13px] leading-[1.65] text-[#ededf0]">
            {oneLiner}
          </p>
        </section>
      )}

      {coreArg && (
        <section>
          <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#4e4f5c]">
            핵심 주장
          </h3>
          <p className="text-[13px] leading-[1.6] text-[rgba(237,237,240,0.84)]">{coreArg}</p>
        </section>
      )}

      {(subjectivity === 'high' || hasAd) && (
        <div className="flex flex-wrap gap-1.5">
          {hasAd && (
            <span className="rounded-[4px] bg-[rgba(248,113,113,0.12)] px-[7px] py-[2px] text-[10px] font-semibold text-[#f87171]">
              광고 포함
            </span>
          )}
          {subjectivity === 'high' && (
            <span className="rounded-[4px] bg-[rgba(245,158,11,0.12)] px-[7px] py-[2px] text-[10px] font-semibold text-[#f59e0b]">
              주관성 높음
            </span>
          )}
        </div>
      )}

      {actionables.length > 0 && (
        <section>
          <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#818cf8]">
            실행 아이템
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
            주요 개념
          </h3>
          <ul className="space-y-2 text-[13px] leading-[1.5]">
            {keyConcepts.map((kc, idx) => (
              <li key={idx} className="rounded-[6px] bg-[rgba(255,255,255,0.02)] px-3 py-2">
                <p className="text-[12px] font-semibold text-[#818cf8]">{kc.term}</p>
                <p className="mt-[2px] text-[12px] text-[rgba(237,237,240,0.74)]">
                  {kc.definition}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sections.length > 0 && (
        <section>
          <h3 className="mb-[8px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#4e4f5c]">
            구간별 분석
          </h3>
          <div className="space-y-1">
            {sections.map((sec, idx) => (
              <div
                key={idx}
                className="rounded-[6px] px-3 py-[10px] transition-colors hover:bg-[rgba(255,255,255,0.02)]"
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[10px] text-[#818cf8] shrink-0">
                    {formatSeconds(sec.from_sec)} — {formatSeconds(sec.to_sec)}
                  </span>
                  <p className="text-[12px] font-semibold leading-[1.35] text-[rgba(237,237,240,0.92)]">
                    {sec.title}
                  </p>
                </div>
                {sec.summary && (
                  <p className="mt-[3px] pl-[88px] text-[11px] text-[rgba(237,237,240,0.66)]">
                    {sec.summary}
                  </p>
                )}
              </div>
            ))}
          </div>
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
  const typeColor =
    atom.type === 'fact'
      ? 'text-[#2dd4bf]'
      : atom.type === 'argument'
        ? 'text-[#f59e0b]'
        : atom.type === 'tip'
          ? 'text-[#818cf8]'
          : 'text-[#94a3b8]';
  const typeMark =
    atom.type === 'fact' ? '✓' : atom.type === 'argument' ? '!' : atom.type === 'tip' ? '★' : '·';

  return (
    <li className="flex items-start gap-2 text-[12px] leading-[1.5] text-[rgba(237,237,240,0.84)]">
      <span aria-hidden className={`mt-[2px] shrink-0 font-mono text-[11px] ${typeColor}`}>
        {typeMark}
      </span>
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
