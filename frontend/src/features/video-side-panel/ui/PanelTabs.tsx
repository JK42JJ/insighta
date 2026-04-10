/**
 * Notes / AI Summary tab bar for the side panel.
 *
 * Design tokens: insighta-side-editor-mockup-v3.html
 */
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';

export interface PanelTabsProps {
  activeTab: 'notes' | 'ai-summary';
  onTabChange: (tab: 'notes' | 'ai-summary') => void;
}

const TAB_KEYS: Array<{ key: 'notes' | 'ai-summary'; i18nKey: string }> = [
  { key: 'notes', i18nKey: 'videoPlayer.panelTabNotes' },
  { key: 'ai-summary', i18nKey: 'videoPlayer.panelTabAiSummary' },
];

export function PanelTabs({ activeTab, onTabChange }: PanelTabsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 border-b border-[rgba(255,255,255,0.04)] px-4" role="tablist">
      {TAB_KEYS.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.key)}
            className={cn(
              'relative mr-4 py-2 text-[12px] font-medium transition-colors duration-150',
              isActive ? 'font-semibold text-[#ededf0]' : 'text-[#4e4f5c] hover:text-[#9394a0]'
            )}
          >
            {t(tab.i18nKey)}
            {/* Active indicator — 1.5px indigo bottom line */}
            {isActive && (
              <span
                className="absolute -bottom-px left-0 right-0 h-[1.5px] rounded-[1px] bg-[#818cf8]"
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
