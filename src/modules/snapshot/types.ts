// ⑤ get-or-extract — shared figure types.

export const FIGURE_KINDS = ['chart', 'diagram', 'table', 'equation', 'keyframe'] as const;
export type FigureKind = (typeof FIGURE_KINDS)[number];

/**
 * One extracted figure at a video timestamp (⑤ contract). Payload by kind:
 *   chart | diagram | table → struct (numerize JSON, what slidegen renders)
 *   equation               → latex
 *   keyframe               → assetPath (binary pointer; deferred, may be null)
 */
export interface FigureRef {
  videoId: string;
  tsSec: number;
  kind: FigureKind;
  struct?: unknown;
  latex?: string;
  assetPath?: string;
  verificationStatus: string;
  source: string;
}
