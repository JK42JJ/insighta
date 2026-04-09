/**
 * AI summary read-only view for the side panel.
 * Shows summary_ko (fallback summary_en) + tags.
 *
 * Design tokens: insighta-side-editor-mockup-v3.html
 */
import type { VideoSummary } from '@/entities/card/model/types';

export interface PanelAISummaryProps {
  videoSummary: VideoSummary | undefined;
}

export function PanelAISummary({ videoSummary }: PanelAISummaryProps) {
  if (!videoSummary) {
    return (
      <p className="py-8 text-center text-[13px] text-[#4e4f5c]">
        아직 AI 요약이 생성되지 않았어요
      </p>
    );
  }

  const summaryText = videoSummary.summary_ko || videoSummary.summary_en || null;
  const tags = videoSummary.tags ?? [];

  return (
    <div className="space-y-4">
      {/* Summary */}
      {summaryText && (
        <section>
          <h3 className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.7px] text-[#4e4f5c]">
            요약
          </h3>
          <p className="text-[13px] leading-[1.6] text-[rgba(237,237,240,0.78)]">{summaryText}</p>
        </section>
      )}

      {/* Tags */}
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
    </div>
  );
}
