/**
 * VideoPicker — model-agnostic interface for the /add-cards v5 path.
 *
 * Replaces cosine + IKS scoring with LLM-driven cell↔video matching.
 * Swap implementations via registry without touching call sites.
 */

export interface PickCandidate {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string;
}

export interface PickInput {
  cellTopic: string;
  parentGoal: string;
  subGoals: string[];
  focusTags: string[];
  targetLevel: string;
  language: 'ko' | 'en';
  candidates: PickCandidate[];
  maxPicks: number;
}

export interface PickResult {
  videoId: string;
  score: number;
  reason: string;
}

export interface VideoPicker {
  readonly name: string;
  readonly model: string;
  pick(input: PickInput, signal?: AbortSignal): Promise<PickResult[]>;
}
