// ─── Wizard Types ───

export const SKILL_TYPES = ['newsletter', 'alerts', 'bias_filter', 'report'] as const;
export type SkillType = (typeof SKILL_TYPES)[number];

export interface WizardDomain {
  id: string;
  name: string;
  icon: string; // Lucide icon name
}

export interface WizardTemplate {
  id: string;
  title: string;
  shareSlug: string | null;
  likeCount: number;
  centerGoal: string;
  subjects: string[];
  /** depth=1 child levels, keyed by subject index */
  subDetails: Record<number, string[]>;
}

export interface WizardState {
  currentStep: 1 | 2 | 3;
  selectedDomain: string | null;
  selectedTemplate: WizardTemplate | null;
  skills: Record<SkillType, boolean>;
}

// ─── Editor Types ───

export interface EditorBlock {
  name: string;
  isCenter: boolean;
  items: string[]; // length 8
}

export interface EditorState {
  currentBlockIndex: number; // 0-8
  blocks: EditorBlock[];
  isDirty: boolean;
}

// ─── Dashboard Types ───

export interface DashboardCell {
  label: string;
  videoCount: number;
  totalSlots: number;
  isActive: boolean;
}

export interface DashboardResumeVideo {
  videoId: string;
  videoTitle: string;
  cellLabel: string;
  duration: string;
  watchedAt: string;
  relevanceScore: number;
}

export interface DashboardRecommendation {
  videoId: string;
  title: string;
  cellLabel: string;
  score: number;
  duration: string;
}

export interface DashboardFilteredVideo {
  title: string;
  biasType: string;
}

export interface DashboardStats {
  filledCells: number;
  totalCells: number;
  totalVideos: number;
  streakDays: number;
  avgRelevance: number;
}

export interface DashboardResponse {
  mandala: {
    id: string;
    title: string;
    centerLabel: string;
    subLabels: string[];
  };
  resume: DashboardResumeVideo | null;
  cells: DashboardCell[];
  recommendations: DashboardRecommendation[];
  skills: Record<SkillType, boolean>;
  filteredVideos: DashboardFilteredVideo[];
  stats: DashboardStats;
}
