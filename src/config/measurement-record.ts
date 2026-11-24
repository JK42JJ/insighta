/**
 * Measurement record constants (SHADOW MODE — record only, never used for
 * ranking or filtering). The enable flag MEASUREMENT_RECORD_ENABLED lives in
 * the env schema of ./index (`config.measurementRecord.enabled`, default off).
 *
 * Tuning knobs, not secrets (CP392).
 */

/** Schema version stamped on each candidate_features row. */
export const MEASUREMENT_VERSION = 1;

/** Row retention; mirrors the `expires_at` default in the DDL. */
export const RECORD_TTL_DAYS = 30;

/** commentThreads.list maxResults, order=relevance. */
export const COMMENT_TOP_N = 20;

/** Channel uploads sampled for cadence / shorts ratio / median views. */
export const CHANNEL_RECENT_UPLOADS_N = 50;

/** Word-list hits counted per comment (counts only; text is never stored). */
export const POSITIVE_COMMENT_WORDS: readonly string[] = [
  '도움',
  '유익',
  '감사',
  '최고',
  '정리 잘',
  '명확',
  '이해가 잘',
  '쉽게',
  '알기 쉬',
  '좋은 강의',
  '좋은 영상',
  '추천',
  '꿀팁',
  '퀄리티',
  '덕분에',
];

export const NEGATIVE_COMMENT_WORDS: readonly string[] = [
  '광고',
  '별로',
  '시간낭비',
  '시간 낭비',
  '낚시',
  '거짓',
  '오류',
  '쓰레기',
  '실망',
  '허위',
  '틀렸',
  '엉터리',
  '재미없',
  '불필요',
  '도움 안',
];

/** Title exaggeration markers (lowercased substring match). */
export const TITLE_EXAGGERATION_WORDS: readonly string[] = [
  '충격',
  '대박',
  '난리',
  '경악',
  '레전드',
  '미쳤',
  '역대급',
  '무조건',
  '절대',
  '비밀',
  '폭로',
  '실화',
  '완전정복',
  '최초',
  '!!',
  'shocking',
  'insane',
  'secret',
  'must watch',
];

/** Title how-to / tutorial markers (lowercased substring match). */
export const TITLE_HOWTO_WORDS: readonly string[] = [
  '방법',
  '하는 법',
  '하는법',
  '가이드',
  '입문',
  '강의',
  '튜토리얼',
  '따라하기',
  '시작하기',
  '배우기',
  'how to',
  'how-to',
  'tutorial',
  'guide',
  'step by step',
];

/** Comments API HTTP reason code for disabled comments. */
export const COMMENTS_DISABLED_REASON = 'commentsDisabled';

/** YouTube Data API v3 base + per-call quota units (for units accounting). */
export const YT_API_BASE = 'https://www.googleapis.com/youtube/v3';
