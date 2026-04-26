/**
 * AI summary read-only view for the side panel.
 *
 * Renders two layers:
 *  1. Rich AI summary (CP425 / `video_rich_summaries`) — tl_dr, key_points,
 *     actionables, chapters. Fetched via `useRichSummary`. Empty-state on
 *     404 (not yet generated / quota exceeded).
 *  2. Short metadata summary (`videoSummary.summary_ko|en` + tags) —
 *     existing path, always renders when available.
 *
 * Design tokens: insighta-side-editor-mockup-v3.html
 */
import type { VideoSummary } from '@/entities/card/model/types';
import { getYouTubeVideoId } from '@/widgets/video-player/model/youtube-api';
import { useRichSummary } from '../model/useRichSummary';

export interface PanelAISummaryProps {
  videoSummary: VideoSummary | undefined;
  videoUrl?: string;
}

export function PanelAISummary({ videoSummary, videoUrl }: PanelAISummaryProps) {
  const youtubeId = videoUrl ? getYouTubeVideoId(videoUrl) : null;
  const { richSummary, isLoading: isRichLoading } = useRichSummary(youtubeId);

  const short = videoSummary?.summary_ko || videoSummary?.summary_en || null;
  const tags = videoSummary?.tags ?? [];

  const hasRich = Boolean(richSummary?.structured);
  const hasShort = Boolean(short) || tags.length > 0;

  if (!hasRich && !hasShort && !isRichLoading) {
    return (
      <p className="py-8 text-center text-[13px] text-[#4e4f5c]">
        아직 AI 요약이 생성되지 않았어요
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {hasRich && richSummary?.structured && (
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
