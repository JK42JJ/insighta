/**
 * Entity Extraction Script — .md → ontology.nodes
 *
 * Parses memory/*.md files and inserts structured entries into ontology.nodes.
 * Uses rule-based extraction (Option B from #162): regex + markdown parsing.
 *
 * Usage: npx tsx scripts/ontology/extract-entities.ts [--dry-run]
 *
 * Issue: #162 (M10: Ontology Foundation)
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============================================================================
// Configuration
// ============================================================================

const MEMORY_DIR = process.env['MEMORY_DIR'] ??
  path.join(process.env['HOME'] ?? '', '.claude/projects/-Users-jeonhokim-cursor-insighta/memory');
const USER_ID = '0192fedf-85f4-47ab-a652-7fdd116e2b39'; // JK's user ID from credentials.md

interface ExtractedEntity {
  type: string;
  title: string;
  properties: Record<string, unknown>;
  sourceFile: string;
  sourceSection: string;
}

// ============================================================================
// Parsers
// ============================================================================

function extractFromTroubleshooting(content: string, filePath: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const sectionRegex = /^### (.+?)(?:\s*\((\d{4}-\d{2}-\d{2})\))?\s*(?:\[LEVEL-(\d+),\s*recurrence:\s*(\d+)\])?\s*$/gm;

  let match;
  while ((match = sectionRegex.exec(content)) !== null) {
    const title = match[1]!.trim();
    const date = match[2] ?? null;
    const level = match[3] ? parseInt(match[3]) : null;
    const recurrence = match[4] ? parseInt(match[4]) : null;

    // Extract the section body (until next ### or ##)
    const startIdx = match.index + match[0].length;
    const nextSection = content.indexOf('\n### ', startIdx);
    const nextCategory = content.indexOf('\n## ', startIdx);
    const endIdx = Math.min(
      nextSection > 0 ? nextSection : content.length,
      nextCategory > 0 ? nextCategory : content.length
    );
    const body = content.slice(startIdx, endIdx).trim();

    // Extract key fields from body
    const symptom = extractField(body, '증상');
    const cause = extractField(body, '원인');
    const solution = extractField(body, '해결');
    const lesson = extractField(body, '교훈');

    entities.push({
      type: 'problem',
      title,
      properties: {
        severity: level && level >= 2 ? 'high' : 'medium',
        status: 'resolved',
        date,
        level,
        recurrence,
        symptom,
        cause,
        solution,
        lesson,
      },
      sourceFile: path.basename(filePath),
      sourceSection: title,
    });
  }

  return entities;
}

function extractFromArchitecture(content: string, filePath: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];

  const sectionRegex = /^### (.+)$/gm;
  let match;

  while ((match = sectionRegex.exec(content)) !== null) {
    const title = match[1]!.trim();
    const startIdx = match.index + match[0].length;
    const nextSection = content.indexOf('\n### ', startIdx);
    const endIdx = nextSection > 0 ? nextSection : content.length;
    const body = content.slice(startIdx, endIdx).trim();

    // Skip very short sections (headers only)
    if (body.length < 50) continue;

    entities.push({
      type: 'decision',
      title: `Architecture: ${title}`,
      properties: {
        rationale: body.slice(0, 500),
        status: 'accepted',
      },
      sourceFile: path.basename(filePath),
      sourceSection: title,
    });
  }

  return entities;
}

function extractFromUxIssues(content: string, filePath: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const issueRegex = /^### (.+?)(?:\s*\((\d{4}-\d{2}-\d{2})\))?\s*(?:\[(.+?)\])?\s*$/gm;

  let match;
  while ((match = issueRegex.exec(content)) !== null) {
    const title = match[1]!.trim();
    const date = match[2] ?? null;
    const tags = match[3] ?? null;

    const startIdx = match.index + match[0].length;
    const nextSection = content.indexOf('\n### ', startIdx);
    const endIdx = nextSection > 0 ? nextSection : content.length;
    const body = content.slice(startIdx, endIdx).trim();

    if (body.length < 30) continue;

    const isResolved = body.toLowerCase().includes('resolved') || body.toLowerCase().includes('해결');

    entities.push({
      type: 'pattern',
      title: `UX: ${title}`,
      properties: {
        description: body.slice(0, 500),
        recurrence: 1,
        date,
        tags,
        resolved: isResolved,
      },
      sourceFile: path.basename(filePath),
      sourceSection: title,
    });
  }

  return entities;
}

// ============================================================================
// Helpers
// ============================================================================

function extractField(body: string, fieldName: string): string | null {
  const regex = new RegExp(`\\*\\*${fieldName}\\*\\*:\\s*(.+?)(?=\\n\\*\\*|$)`, 's');
  const match = body.match(regex);
  return match ? match[1]!.trim() : null;
}

function contentHash(entity: ExtractedEntity): string {
  const key = `${entity.sourceFile}:${entity.sourceSection}:${entity.type}`;
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient();

  try {
    await prisma.$connect();
    console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log(`Memory dir: ${MEMORY_DIR}`);
    console.log(`User ID: ${USER_ID}`);

    const allEntities: ExtractedEntity[] = [];

    // Parse troubleshooting.md
    const troubleshootingPath = path.join(MEMORY_DIR, 'troubleshooting.md');
    if (fs.existsSync(troubleshootingPath)) {
      const content = fs.readFileSync(troubleshootingPath, 'utf-8');
      const entities = extractFromTroubleshooting(content, troubleshootingPath);
      allEntities.push(...entities);
      console.log(`[troubleshooting.md] Extracted ${entities.length} problem entities`);
    }

    // Parse architecture.md
    const architecturePath = path.join(MEMORY_DIR, 'architecture.md');
    if (fs.existsSync(architecturePath)) {
      const content = fs.readFileSync(architecturePath, 'utf-8');
      const entities = extractFromArchitecture(content, architecturePath);
      allEntities.push(...entities);
      console.log(`[architecture.md] Extracted ${entities.length} decision entities`);
    }

    // Parse ux-issues.md
    const uxPath = path.join(MEMORY_DIR, 'ux-issues.md');
    if (fs.existsSync(uxPath)) {
      const content = fs.readFileSync(uxPath, 'utf-8');
      const entities = extractFromUxIssues(content, uxPath);
      allEntities.push(...entities);
      console.log(`[ux-issues.md] Extracted ${entities.length} pattern entities`);
    }

    console.log(`\nTotal entities: ${allEntities.length}`);

    if (isDryRun) {
      console.log('\n--- DRY RUN OUTPUT ---');
      for (const e of allEntities) {
        console.log(`  [${e.type}] ${e.title} (${e.sourceFile})`);
      }
      return;
    }

    // Insert into ontology.nodes (idempotent via content hash in properties)
    let inserted = 0;
    let skipped = 0;

    for (const entity of allEntities) {
      const hash = contentHash(entity);
      const properties = {
        ...entity.properties,
        _extract_hash: hash,
        _source_file: entity.sourceFile,
        _source_section: entity.sourceSection,
      };

      // Check if already exists (idempotent)
      const existing = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM ontology.nodes
        WHERE user_id = ${USER_ID}::uuid
          AND type = ${entity.type}
          AND properties->>'_extract_hash' = ${hash}
      `;

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      await prisma.$executeRaw`
        INSERT INTO ontology.nodes (user_id, type, title, properties)
        VALUES (
          ${USER_ID}::uuid,
          ${entity.type},
          ${entity.title},
          ${JSON.stringify(properties)}::jsonb
        )
      `;

      // Log action
      await prisma.$executeRaw`
        INSERT INTO ontology.action_log (user_id, action, entity_type, entity_id, after_data, metadata)
        SELECT
          ${USER_ID}::uuid,
          'CREATE_NODE',
          'node',
          id,
          ${JSON.stringify(properties)}::jsonb,
          '{"trigger": "extract-entities"}'::jsonb
        FROM ontology.nodes
        WHERE user_id = ${USER_ID}::uuid
          AND type = ${entity.type}
          AND properties->>'_extract_hash' = ${hash}
        LIMIT 1
      `;

      inserted++;
    }

    console.log(`\nResults: ${inserted} inserted, ${skipped} skipped (already exist)`);

    // Summary
    const stats = await prisma.$queryRaw<{ type: string; count: bigint }[]>`
      SELECT type, count(*) FROM ontology.nodes
      WHERE user_id = ${USER_ID}::uuid
      GROUP BY type ORDER BY count DESC
    `;
    console.log('\nNode counts by type:');
    for (const row of stats) {
      console.log(`  ${row.type}: ${row.count}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
