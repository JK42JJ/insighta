import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Sparkles, BookText } from 'lucide-react';
import { PanelVideoPlayer } from '@/features/video-side-panel/ui/PanelVideoPlayer';
import { PanelAISummary } from '@/features/video-side-panel/ui/PanelAISummary';
import { useMandalaBook } from '@/features/mandala/model/useMandalaBook';
import { useLearningStore } from '@/pages/learning/model/useLearningStore';
import { cn } from '@/shared/lib/utils';
import type { MandalaBookChapter, MandalaBookSection } from '@/shared/lib/api-client';
import type { YTPlayer } from '@/widgets/video-player/model/youtube-api';

interface CenterPanelProps {
  mandalaId: string;
  videoId: string;
  playerRef: React.MutableRefObject<YTPlayer | null>;
  shouldAutoplay?: boolean;
  onUserPlayed?: () => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
  startTime?: number;
}

type CenterTabId = 'summary' | 'section';

export function CenterPanel({
  mandalaId,
  videoId,
  playerRef,
  shouldAutoplay = false,
  onUserPlayed,
  onPlayStateChange,
  startTime,
}: CenterPanelProps) {
  const { t } = useTranslation();
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const centerTab = useLearningStore((s) => s.centerTab);
  const setCenterTab = useLearningStore((s) => s.setCenterTab);
  const activeSectionRef = useLearningStore((s) => s.activeSectionRef);
  const { book } = useMandalaBook(mandalaId);

  const activeSection = (() => {
    if (!activeSectionRef || !book?.book?.chapters) return null;
    const chapter = book.book.chapters.find((c) => c.ch === activeSectionRef.chapterIdx);
    if (!chapter) return null;
    const sec = chapter.sections?.[activeSectionRef.sectionIdx];
    if (!sec) return null;
    return { chapter, section: sec };
  })();

  const tabs: Array<{
    id: CenterTabId;
    labelKey: string;
    fallback: string;
    icon: typeof Sparkles;
  }> = [
    { id: 'summary', labelKey: 'learning.tabSummary', fallback: 'AI 요약', icon: Sparkles },
    { id: 'section', labelKey: 'learning.tabSection', fallback: '섹션 내용', icon: BookText },
  ];

  return (
    <div className="flex flex-1 min-w-0 flex-col overflow-hidden px-10 pt-[5px]">
      <div className="shrink-0">
        <PanelVideoPlayer
          videoUrl={videoUrl}
          playerRef={playerRef}
          shouldAutoplay={shouldAutoplay}
          onUserPlayed={onUserPlayed}
          onPlayStateChange={onPlayStateChange}
          startTime={startTime}
        />
      </div>

      <div className="flex shrink-0 px-4">
        {tabs.map(({ id, labelKey, fallback, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setCenterTab(id)}
            className={cn(
              'flex items-center gap-1.5 py-2.5 px-3 text-[12px] transition-colors border-b-2',
              centerTab === id
                ? 'border-primary text-foreground font-semibold'
                : 'border-transparent text-muted-foreground font-normal hover:text-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t(labelKey, fallback)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-pro p-4">
        {centerTab === 'summary' && <PanelAISummary videoSummary={undefined} videoUrl={videoUrl} />}
        {centerTab === 'section' &&
          (activeSection ? (
            <SectionContentView
              chapter={activeSection.chapter}
              section={activeSection.section}
              mandalaId={mandalaId}
            />
          ) : (
            <div className="text-[12px] text-muted-foreground">
              {t('learning.noActiveSection', '좌측 북인덱스에서 섹션을 선택하세요.')}
            </div>
          ))}
      </div>
    </div>
  );
}

function SectionContentView({
  chapter,
  section,
  mandalaId,
}: {
  chapter: MandalaBookChapter;
  section: MandalaBookSection;
  mandalaId: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {t('learning.chapterLabel', { n: chapter.ch + 1 })}
        </p>
        <h2 className="mt-1 text-[16px] font-semibold text-foreground">{chapter.title}</h2>
      </div>
      <div>
        <h3 className="text-[14px] font-semibold text-foreground">{section.title}</h3>
        {section.narrative && (
          <p className="mt-2 text-[13px] leading-[1.6] text-foreground/80">{section.narrative}</p>
        )}
      </div>
      {section.atoms && section.atoms.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t('learning.atomsLabel')}
          </p>
          <ul className="mt-2 space-y-1.5">
            {section.atoms.map((atom, idx) => (
              <li key={idx} className="text-[12px] leading-[1.5] text-foreground/75">
                <span className="text-muted-foreground/60 mr-1">·</span>
                {atom.text}
                {atom.vid && Number.isFinite(atom.ts) && (
                  <Link
                    to={`/learning/${mandalaId}/${atom.vid}?t=${Math.floor(atom.ts ?? 0)}`}
                    className="ml-1 inline-block rounded-[3px] bg-[rgba(129,140,248,0.15)] px-1 font-mono text-[10px] text-[#818cf8]"
                  >
                    {`▶ ${Math.floor((atom.ts ?? 0) / 60)}:${String(Math.floor((atom.ts ?? 0) % 60)).padStart(2, '0')}`}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {section.qa && section.qa.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t('learning.qaLabel')}
          </p>
          <ul className="mt-2 space-y-3">
            {section.qa.map((item, idx) => (
              <li key={idx} className="text-[12px] leading-[1.5]">
                <p className="font-semibold text-foreground">Q. {item.q}</p>
                <p className="mt-1 text-foreground/75">A. {item.a}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
