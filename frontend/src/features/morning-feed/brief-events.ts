/*
 * Stub with the agreed signature (order 2026-11-25 D1). The D1 change replaces this file with the
 * one that stores the events; until then nothing is sent.
 */

export interface BriefEventData {
  cell?: string;
  seenDate?: string;
  sentenceId?: string;
  videoId?: string;
  value?: string;
  from?: string;
  to?: string;
  startSec?: number;
  endSec?: number;
  paragraph?: number;
}

export function recordBriefEvent(_kind: string, _data: BriefEventData): void {
  // sent by the D1 change
}
