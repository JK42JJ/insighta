export type ViewMode = 'mandala' | 'grid' | 'list' | 'dashboard';

export const VIEW_MODES: { mode: ViewMode; labelKey: string }[] = [
  { mode: 'mandala', labelKey: 'viewMode.mandala' },
  { mode: 'grid', labelKey: 'viewMode.grid' },
  { mode: 'list', labelKey: 'viewMode.list' },
  { mode: 'dashboard', labelKey: 'viewMode.dashboard' },
];

export const DEFAULT_VIEW_MODE: ViewMode = 'mandala';
