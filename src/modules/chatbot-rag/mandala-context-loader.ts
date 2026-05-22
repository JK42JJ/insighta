/**
 * src/modules/chatbot-rag/mandala-context-loader.ts
 *
 * Block E source — current mandala's center goal + sub-cell labels.
 *
 * The mandala "context" the chatbot needs is the structural data the
 * user is currently navigating: the center goal (top-level objective)
 * and the 8 sub-cell labels (subjects[]) which the LeftPanel renders as
 * the navigable tree. This is per-mandala but per-user-scoped (the
 * `user_mandala_levels.mandala_id` belongs to a `user_mandalas` row
 * owned by the user).
 *
 * Returns center_goal + subjects (8-element string array) so prompt-
 * builder's `blockE` can render them. Also returns subjects raw for
 * mandala-cards-loader to resolve cell_name labels.
 *
 * Failures degrade silently to `null`.
 */

import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import type { MandalaContext } from './prompt-builder';

const log = logger.child({ module: 'chatbot-rag/mandala-context-loader' });

export interface LoadMandalaContextParams {
  mandalaId: string;
  /** Mandala title (already loaded by user-context-loader; passed in to avoid duplicate query). */
  mandalaName: string;
  /** 1..8 — when set, populates MandalaContext.cell_name + cell_index. */
  cellIndex?: number | null;
}

export interface MandalaContextLoadResult {
  /** Block E payload — emitted directly into the prompt. */
  context: MandalaContext;
  /** Raw subject labels (8 entries when present) — for downstream loaders
   *  to resolve cell_name on per-card listings. */
  subjects: string[];
  /** Short labels (subject_labels in DB) used in the sidebar; falls back
   *  to subjects[] when empty. */
  subjectLabels: string[];
}

/**
 * Loads the L1 (root) levels row for the mandala and surfaces:
 *   - center_goal: top-level objective string
 *   - subjects[]: the 8 sub-cell descriptions (LeftPanel rows)
 *   - subject_labels[]: short labels (UI prefers these)
 */
export async function loadMandalaContext(
  params: LoadMandalaContextParams
): Promise<MandalaContextLoadResult | null> {
  if (!params.mandalaId) return null;
  const prisma = getPrismaClient();

  try {
    // L1 = the root level row (the chart's outer ring with the 8 sub-cells).
    // schema.prisma:user_mandala_levels.level_key indicates depth — 'L1'
    // is the convention used by the wizard's create flow.
    const root = await prisma.user_mandala_levels.findFirst({
      where: {
        mandala_id: params.mandalaId,
        depth: 0,
      },
      select: {
        center_goal: true,
        subjects: true,
        subject_labels: true,
      },
    });

    if (!root) return null;

    const subjects = Array.isArray(root.subjects) ? root.subjects : [];
    const subjectLabels = Array.isArray(root.subject_labels) ? root.subject_labels : [];

    const cellIndex = params.cellIndex ?? null;
    const cellName =
      cellIndex !== null && cellIndex >= 1 && cellIndex <= 8
        ? subjectLabels[cellIndex - 1] || subjects[cellIndex - 1] || null
        : null;

    const context: MandalaContext = {
      mandala_name: params.mandalaName,
      center_goal: root.center_goal,
      cell_name: cellName ?? null,
      cell_index: cellIndex,
    };

    return {
      context,
      subjects,
      subjectLabels,
    };
  } catch (err) {
    log.warn('mandala-context-loader query failed', {
      mandalaId: params.mandalaId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
