// ─── Skill SSOT ───
//
// Single source of truth for FE skill type identifiers, mirroring the BE
// SkillRegistry exactly. Three groups:
//
//   USER_VISIBLE_SKILL_TYPES — toggleable in wizard + sidebar (6 items)
//   SYSTEM_SKILL_TYPES       — backend-only plugins, never shown to users
//                              (video_discover, trend_collector, iks_scorer)
//   SKILL_TYPES              — union of both = the type's runtime values
//
// Linked toggles: turning on certain user-visible skills also activates one
// or more system skills as a side-effect. See LINKED_SKILL_TOGGLES.

/** Skills the user sees and toggles directly. Wizard + sidebar share this list. */
export const USER_VISIBLE_SKILL_TYPES = [
  'newsletter',
  'report',
  'alert',
  'recommend',
  'script',
  'blog',
] as const;

/** Backend-only system plugins. Never rendered in user surfaces. */
export const SYSTEM_SKILL_TYPES = ['video_discover', 'trend_collector', 'iks_scorer'] as const;

export const SKILL_TYPES = [...USER_VISIBLE_SKILL_TYPES, ...SYSTEM_SKILL_TYPES] as const;
export type SkillType = (typeof SKILL_TYPES)[number];

/**
 * When the user toggles a visible skill, also toggle these linked system
 * skills as a side-effect. Example: "AI 추천" (recommend) is the only thing
 * the user sees, but enabling it also flips video_discover so the BE
 * recommendation pipeline starts producing data.
 *
 * Both wizard `setSkill` and sidebar `handleToggleSkill` honor this map.
 */
export const LINKED_SKILL_TOGGLES: Readonly<Record<string, readonly SkillType[]>> = {
  recommend: ['video_discover'],
};

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
  /** Short label shown in mini grid center cell (≤6 chars). Falls back to centerGoal. */
  centerLabel?: string | null;
  /** Full sub-goal text per cell (length 8) */
  subjects: string[];
  /** Short labels per cell (length 8). Used for grid cells; subjects are used for hover detail. */
  subLabels?: string[];
  /** depth=1 child levels (8 actions per subject), keyed by subject index */
  subDetails: Record<number, string[]>;
}

export interface MandalaSearchResult {
  mandala_id: string;
  template_mandala_id: string | null;
  center_goal: string;
  center_label: string | null;
  domain: string | null;
  language: string | null;
  similarity: number;
  sub_goals: string[];
  sub_labels: string[];
  /** depth=1 actions per sub_goal index (8 strings each, total 64) */
  sub_actions: Record<number, string[]>;
}

export interface GeneratedMandala {
  center_goal: string;
  center_label: string;
  language: string;
  domain: string;
  sub_goals: string[];
  sub_labels?: string[];
  actions: Record<string, string[]>;
}

export interface WizardState {
  currentStep: 1 | 2 | 3;
  selectedDomain: string | null;
  selectedTemplate: WizardTemplate | null;
  skills: Record<SkillType, boolean>;
  /** User-entered goal text for hybrid search+generation flow */
  goalInput: string;
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
