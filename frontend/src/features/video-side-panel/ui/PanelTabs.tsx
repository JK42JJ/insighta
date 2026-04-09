/**
 * [메모] [AI 요약] tab bar.
 *
 * Design tokens: insighta-side-editor-mockup-v3.html
 */
import { cn } from '@/shared/lib/utils';

export interface PanelTabsProps {
  activeTab: 'notes' | 'ai-summary';
  onTabChange: (tab: 'notes' | 'ai-summary') => void;
}

const TABS: Array<{ key: 'notes' | 'ai-summary'; label: string }> = [
  { key: 'notes', label: '메모' },
  { key: 'ai-summary', label: 'AI 요약' },
];

export function PanelTabs({ activeTab, onTabChange }: PanelTabsProps) {
  return (
    <div className="flex shrink-0 border-b border-[rgba(255,255,255,0.04)] px-4" role="tablist">
      {TABS.map((tab) => {
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
            {tab.label}
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
