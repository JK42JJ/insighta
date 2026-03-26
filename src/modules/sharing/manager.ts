/**
 * Mandala Sharing Manager
 *
 * Handles share link creation, validation, and mandala cloning.
 */

import { getPrismaClient } from '../database';
import crypto from 'crypto';

const SHARE_CODE_LENGTH = 8;

interface ShareLink {
  id: string;
  shareCode: string;
  mode: string;
  expiresAt: string | null;
  createdAt: string;
}

interface SharedMandala {
  id: string;
  title: string;
  levels: Array<{
    levelKey: string;
    centerGoal: string;
    subjects: string[];
    parentLevelId: string | null;
  }>;
  cardCount: number;
}

function generateShareCode(): string {
  return crypto.randomBytes(SHARE_CODE_LENGTH / 2).toString('hex');
}

/**
 * Create a share link for a mandala.
 */
export async function createShareLink(
  mandalaId: string,
  userId: string,
  mode: 'view' | 'view_cards' | 'clone' = 'view',
  expiresInDays?: number
): Promise<ShareLink> {
  const prisma = getPrismaClient();

  // Verify ownership
  const mandala = await prisma.user_mandalas.findFirst({
    where: { id: mandalaId, user_id: userId },
  });
  if (!mandala) {
    throw new Error('MANDALA_NOT_FOUND');
  }

  const shareCode = generateShareCode();
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const share = await prisma.mandala_shares.create({
    data: {
      mandala_id: mandalaId,
      share_code: shareCode,
      mode,
      expires_at: expiresAt,
    },
  });

  return {
    id: share.id,
    shareCode: share.share_code,
    mode: share.mode,
    expiresAt: share.expires_at?.toISOString() ?? null,
    createdAt: share.created_at.toISOString(),
  };
}

/**
 * Get shared mandala by share code. Returns null if expired or not found.
 */
export async function getSharedMandala(
  shareCode: string
): Promise<{ share: ShareLink; mandala: SharedMandala } | null> {
  const prisma = getPrismaClient();

  const share = await prisma.mandala_shares.findUnique({
    where: { share_code: shareCode },
    include: {
      mandala: {
        include: {
          levels: {
            select: { level_key: true, center_goal: true, subjects: true, parent_level_id: true },
          },
          _count: { select: { localCards: true } },
        },
      },
    },
  });

  if (!share) return null;

  // Check expiry
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return null;
  }

  return {
    share: {
      id: share.id,
      shareCode: share.share_code,
      mode: share.mode,
      expiresAt: share.expires_at?.toISOString() ?? null,
      createdAt: share.created_at.toISOString(),
    },
    mandala: {
      id: share.mandala.id,
      title: share.mandala.title,
      levels: share.mandala.levels.map(
        (l: {
          level_key: string;
          center_goal: string;
          subjects: string[];
          parent_level_id: string | null;
        }) => ({
          levelKey: l.level_key,
          centerGoal: l.center_goal,
          subjects: l.subjects,
          parentLevelId: l.parent_level_id,
        })
      ),
      cardCount: share.mandala._count.localCards,
    },
  };
}

/**
 * Clone a shared mandala to another user's account.
 * Copies structure (levels) only. Cards and notes are NOT copied (personal data).
 */
export async function cloneSharedMandala(
  shareCode: string,
  targetUserId: string
): Promise<{ mandalaId: string; title: string }> {
  const prisma = getPrismaClient();

  const shared = await getSharedMandala(shareCode);
  if (!shared) {
    throw new Error('SHARE_NOT_FOUND');
  }
  if (shared.share.mode !== 'clone') {
    throw new Error('CLONE_NOT_ALLOWED');
  }

  // Create new mandala for target user
  const newMandala = await prisma.user_mandalas.create({
    data: {
      user_id: targetUserId,
      title: `${shared.mandala.title} (cloned)`,
      is_default: false,
      is_public: false,
    },
  });

  // Clone levels: map old parent IDs to new IDs
  const sourceLevels = await prisma.user_mandala_levels.findMany({
    where: { mandala_id: shared.mandala.id },
    orderBy: { level_key: 'asc' },
  });

  const idMap = new Map<string, string>();

  // First pass: create levels without parent references
  for (const level of sourceLevels) {
    const newLevel = await prisma.user_mandala_levels.create({
      data: {
        mandala_id: newMandala.id,
        level_key: level.level_key,
        center_goal: level.center_goal,
        subjects: level.subjects,
        depth: level.depth,
        color: level.color,
        position: level.position,
        parent_level_id: null, // set in second pass
      },
    });
    idMap.set(level.id, newLevel.id);
  }

  // Second pass: update parent references
  for (const level of sourceLevels) {
    if (level.parent_level_id && idMap.has(level.parent_level_id)) {
      const newId = idMap.get(level.id)!;
      const newParentId = idMap.get(level.parent_level_id)!;
      await prisma.user_mandala_levels.update({
        where: { id: newId },
        data: { parent_level_id: newParentId },
      });
    }
  }

  return {
    mandalaId: newMandala.id,
    title: newMandala.title,
  };
}

/**
 * List share links for a mandala.
 */
export async function listShareLinks(mandalaId: string, userId: string): Promise<ShareLink[]> {
  const prisma = getPrismaClient();

  // Verify ownership
  const mandala = await prisma.user_mandalas.findFirst({
    where: { id: mandalaId, user_id: userId },
  });
  if (!mandala) {
    throw new Error('MANDALA_NOT_FOUND');
  }

  const shares = await prisma.mandala_shares.findMany({
    where: { mandala_id: mandalaId },
    orderBy: { created_at: 'desc' },
  });

  return shares.map(
    (s: {
      id: string;
      share_code: string;
      mode: string;
      expires_at: Date | null;
      created_at: Date;
    }) => ({
      id: s.id,
      shareCode: s.share_code,
      mode: s.mode,
      expiresAt: s.expires_at?.toISOString() ?? null,
      createdAt: s.created_at.toISOString(),
    })
  );
}

/**
 * Delete a share link.
 */
export async function deleteShareLink(shareId: string, userId: string): Promise<void> {
  const prisma = getPrismaClient();

  const share = await prisma.mandala_shares.findUnique({
    where: { id: shareId },
    include: { mandala: { select: { user_id: true } } },
  });

  if (!share || share.mandala.user_id !== userId) {
    throw new Error('SHARE_NOT_FOUND');
  }

  await prisma.mandala_shares.delete({ where: { id: shareId } });
}
