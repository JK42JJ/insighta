/**
 * The checks an issue has to pass before it can be published.
 *
 * `findUngroundedClaims` already refuses a grade with no reference. It does not
 * check that the reference has a URL, or that a recommended video exists —
 * and issue 1 failed on exactly those two. Its five recommendations carry no
 * video ids and its seven sources carry no URLs, so nothing on the page can be
 * opened by a reader or re-checked by an editor.
 *
 * These gates are conditions, not advice. Each returns the specific failures so
 * the editor is told which line to fix rather than that something is wrong.
 *
 * What they cannot do: judge whether a sourced figure is the right figure. A
 * page citing a real article for a number the article does not contain passes
 * every check here. That stays a person's job — these gates exist so that
 * person is reading claims with sources attached rather than prose with numbers
 * in it.
 */

import type { IssueDocument } from './issue-schema';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'newsletter/publish-gates' });

export interface GateFailure {
  gate: 'video-id' | 'video-resolves' | 'source-url' | 'video-metadata';
  /** Where in the document — a pick title, a ref label. */
  where: string;
  detail: string;
}

/** YouTube ids are 11 characters of the url-safe alphabet. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Every recommendation must carry an id.
 *
 * Without one the reader cannot open the video and the editor cannot confirm
 * it exists. Issue 1 printed view counts of "10회" and "127회" for videos
 * nobody can look up.
 */
export function checkVideoIds(doc: IssueDocument): GateFailure[] {
  const out: GateFailure[] = [];
  for (const pick of doc.picks) {
    if (!pick.videoId) {
      out.push({
        gate: 'video-id',
        where: pick.title,
        detail: 'no videoId — a reader cannot open this and an editor cannot check it',
      });
      continue;
    }
    if (!VIDEO_ID.test(pick.videoId)) {
      out.push({
        gate: 'video-id',
        where: pick.title,
        detail: `videoId "${pick.videoId}" is not an 11-character YouTube id`,
      });
    }
  }
  return out;
}

/**
 * Every source a graded claim leans on must be openable.
 *
 * `RefSchema.url` is optional because a source can be named without being
 * linked — a broadcast, a conversation. That licence stops at the moment a
 * claim cites it for a grade: "VentureBeat" is not a source anyone can check,
 * and issue 1 has seven of those.
 *
 * Claims graded `unconfirmed` are exempt. That grade is itself the statement
 * that nothing held up.
 */
export function checkSourceUrls(doc: IssueDocument): GateFailure[] {
  const cited = new Set<number>();
  for (const row of doc.interest.ledger) {
    if (row.grade !== 'unconfirmed' && row.ref !== undefined) cited.add(row.ref);
  }

  const out: GateFailure[] = [];
  for (const refIndex of cited) {
    const ref = doc.refs[refIndex - 1];
    if (!ref) {
      out.push({
        gate: 'source-url',
        where: `ref[${refIndex}]`,
        detail: `cited by a graded claim but only ${doc.refs.length} refs exist`,
      });
      continue;
    }
    const linked = ref.sources.filter((s) => s.url);
    if (linked.length === 0) {
      out.push({
        gate: 'source-url',
        where: `ref[${refIndex}] ${ref.label}`,
        detail: `cited by a graded claim, and none of its ${ref.sources.length} source(s) has a URL`,
      });
    }
  }
  return out;
}

export interface ResolvedVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  viewCount: number | null;
}

/** Resolves ids against the API. Injected so the gate is testable without quota. */
export type VideoResolver = (ids: string[]) => Promise<Map<string, ResolvedVideo>>;

/**
 * Every recommendation resolves, and the metadata printed matches the API.
 *
 * A title typed into a draft is a claim like any other. Issue 1's picks carry
 * channel names and view counts that came from the draft rather than from a
 * response, and no reader can tell the difference.
 *
 * The check on the printed title is deliberately loose — an editor may shorten
 * one. What it catches is a pick whose title has nothing to do with the video
 * the id points at, which is what a transcription error looks like.
 */
export async function checkVideosResolve(
  doc: IssueDocument,
  resolve: VideoResolver
): Promise<GateFailure[]> {
  const ids = doc.picks.map((p) => p.videoId).filter((v): v is string => !!v && VIDEO_ID.test(v));
  if (ids.length === 0) return [];

  const found = await resolve(ids);
  const out: GateFailure[] = [];

  for (const pick of doc.picks) {
    if (!pick.videoId || !VIDEO_ID.test(pick.videoId)) continue;
    const v = found.get(pick.videoId);
    if (!v) {
      out.push({
        gate: 'video-resolves',
        where: pick.title,
        detail: `videoId ${pick.videoId} did not resolve — private, removed, or wrong`,
      });
      continue;
    }
    if (!pick.meta.includes(v.channelTitle)) {
      out.push({
        gate: 'video-metadata',
        where: pick.title,
        detail: `meta says "${pick.meta}" but the channel is "${v.channelTitle}"`,
      });
    }
  }
  return out;
}

export interface GateReport {
  passed: boolean;
  failures: GateFailure[];
  checked: { picks: number; gradedClaims: number; citedRefs: number };
}

/**
 * Run every gate. `resolve` is optional so the structural checks can run
 * without spending quota; skipping it leaves the resolution gate unrun, and
 * the report says so by counting zero picks checked.
 */
export async function runPublishGates(
  doc: IssueDocument,
  resolve?: VideoResolver
): Promise<GateReport> {
  const failures: GateFailure[] = [...checkVideoIds(doc), ...checkSourceUrls(doc)];
  if (resolve) failures.push(...(await checkVideosResolve(doc, resolve)));

  const gradedClaims = doc.interest.ledger.filter((r) => r.grade !== 'unconfirmed').length;
  const citedRefs = new Set(
    doc.interest.ledger.filter((r) => r.grade !== 'unconfirmed' && r.ref).map((r) => r.ref)
  ).size;

  const report: GateReport = {
    passed: failures.length === 0,
    failures,
    checked: { picks: resolve ? doc.picks.length : 0, gradedClaims, citedRefs },
  };

  log.info('publish gates', {
    slug: doc.slug,
    passed: report.passed,
    failures: failures.length,
  });
  return report;
}
