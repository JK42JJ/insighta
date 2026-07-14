/**
 * T9 — domain anchor for deficit-cell subgoal queries (matrix F6).
 *
 * The T5 subgoal queries went out as the raw cell topic ("청취 회화",
 * "모의고사", "시험 전략") with no domain context — on Korean YouTube those
 * strings are dominated by English-learning / 수능 content, which is how a
 * JLPT mandala harvested 20 English cards (R-judge-2, all judge-deboosted).
 *
 * The anchor is the center goal with its non-domain tokens stripped:
 * numbers/durations ("6개월", "4시간", "1년") and goal-action words
 * ("합격", "완주", "마스터", "키우기"). Examples:
 *   "일본어 JLPT N3 6개월 합격"      → "일본어 JLPT N3"
 *   "마라톤 풀코스 4시간 완주"        → "마라톤 풀코스"
 *   "퇴근 후 1시간으로 유튜브 채널 키우기" → "퇴근 후 유튜브 채널"
 * Query = "<anchor> <subgoal>" — still a natural phrase, unlike the retired
 * full-centerGoal concat that YouTube matched poorly.
 *
 * Default OFF (unset = raw-subgoal legacy). Rollback: flag flip.
 */

export function isSubgoalAnchorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env['DISCOVER_SUBGOAL_ANCHOR_ENABLED'] ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/** Numbers with/without Korean duration units, and bare digits: "6개월", "4시간", "1년", "3", "10kg". */
const NUMERIC_TOKEN_RE =
  /^\d+(개월|주일?|일|시간|분|년|kg|명|점|회|배|등급?)?(으로|까지|이내|안에|만에)?$/i;

/** Goal-action tokens that carry no searchable domain signal. */
const ACTION_TOKEN_RE =
  /^(합격|완주|달성|마스터|완성|입문|독학|시작|도전|성공|만들기|키우기|되기|하기|배우기|끝내기|정복)(하기)?$/;

/** Max anchor tokens — keep "<anchor> <subgoal>" a natural search phrase. */
const MAX_ANCHOR_TOKENS = 4;

/** Center goal → domain anchor. Empty string when nothing survives stripping. */
export function extractDomainAnchor(centerGoal: string): string {
  const tokens = centerGoal
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !NUMERIC_TOKEN_RE.test(t))
    .filter((t) => !ACTION_TOKEN_RE.test(t));
  return tokens.slice(0, MAX_ANCHOR_TOKENS).join(' ');
}

/** "<anchor> <subgoal>", falling back to the raw subgoal when no anchor survives. */
export function buildAnchoredSubgoalQuery(centerGoal: string, subGoal: string): string {
  const anchor = extractDomainAnchor(centerGoal);
  if (!anchor) return subGoal;
  // Avoid "마라톤 풀코스 마라톤 페이스" — skip anchor tokens already in the subgoal.
  const sgLower = subGoal.toLowerCase();
  const filtered = anchor
    .split(' ')
    .filter((t) => !sgLower.includes(t.toLowerCase()))
    .join(' ');
  return filtered ? `${filtered} ${subGoal}` : subGoal;
}
