/**
 * V4 Dataset Pipeline — Configuration (SSOT)
 *
 * All frame types, domains, tiers, and label mappings for the V4 pipeline.
 */

// ---------------------------------------------------------------------------
// Frame Types
// ---------------------------------------------------------------------------

export const FRAME_TYPES = [
  'comprehensive',
  'vision',
  'periodic',
  'sequential',
  'problem',
  'skill',
  'project',
  'lifestyle',
] as const;

export type FrameType = (typeof FRAME_TYPES)[number];

export interface FrameMetadata {
  id: FrameType;
  labelKo: string;
  labelEn: string;
  description: string;
  /** Prompt constraint injected during generation */
  constraint: string;
}

export const FRAME_METADATA: Record<FrameType, FrameMetadata> = {
  comprehensive: {
    id: 'comprehensive',
    labelKo: '교과서형',
    labelEn: 'A-Z Comprehensive',
    description: '주제의 모든 측면을 체계적으로 정리. 빈틈 없는 전체 지도.',
    constraint:
      '주제의 모든 측면을 빠짐없이 다루되, 카테고리 간 겹침 최소화',
  },
  vision: {
    id: 'vision',
    labelKo: '비전형',
    labelEn: 'Long-term Vision',
    description: '담대한 장기 목표 + 마일스톤. 1년~10년 단위.',
    constraint: '최종 비전에서 역산한 마일스톤, 시간축 포함',
  },
  periodic: {
    id: 'periodic',
    labelKo: '반복주기형',
    labelEn: 'Periodic Routine',
    description: '주기적으로 반복하는 루틴/사이클. 매일/매주/매월.',
    constraint: '반복 주기와 체크포인트 명시, 루틴화 가능한 action',
  },
  sequential: {
    id: 'sequential',
    labelKo: '단계실행형',
    labelEn: 'Step-by-step Roadmap',
    description:
      'Phase 1→2→3 순서대로 실행. 의존성 있는 단계별 계획.',
    constraint:
      'Phase/Step 순서 의존성 반영, 앞 단계 완료가 다음 단계 전제',
  },
  problem: {
    id: 'problem',
    labelKo: '문제해결형',
    labelEn: 'Problem-solving',
    description: '문제 진단 → 원인 분석 → 해결 전략 → 예방.',
    constraint: '문제 정의 → 원인 → 해결 → 예방 흐름',
  },
  skill: {
    id: 'skill',
    labelKo: '역량개발형',
    labelEn: 'Skill Building',
    description: '현재 수준에서 목표 수준까지 역량 성장 트리.',
    constraint:
      '현재 수준 → 중간 → 목표 수준, 측정 가능한 역량 지표',
  },
  project: {
    id: 'project',
    labelKo: '프로젝트형',
    labelEn: 'Project Completion',
    description: '구체적 산출물이 있는 프로젝트 시작→완료.',
    constraint: '산출물 중심, 데드라인 내포, 리소스 배분',
  },
  lifestyle: {
    id: 'lifestyle',
    labelKo: '생활통합형',
    labelEn: 'Lifestyle Integration',
    description: '목표를 일상 속에 녹여내는 구조. 습관화 중심.',
    constraint: '일상 습관으로 녹여내기, 최소 저항 경로',
  },
};

// ---------------------------------------------------------------------------
// Domains — re-exported from src/config/domains.ts (SSOT promotion at CP437)
// ---------------------------------------------------------------------------

import {
  DOMAINS,
  DOMAIN_LABEL_TO_SLUG,
  DOMAIN_SLUG_TO_LABEL_KO,
  DOMAIN_SLUG_TO_LABEL_EN,
  type DomainSlug,
} from '@/config/domains';

export {
  DOMAINS,
  DOMAIN_LABEL_TO_SLUG,
  DOMAIN_SLUG_TO_LABEL_KO,
  DOMAIN_SLUG_TO_LABEL_EN,
};
export type { DomainSlug };

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

export const TIERS = ['v3_legacy', 'tier1', 'tier2', 'tier3'] as const;

export type Tier = (typeof TIERS)[number];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const V4_VERSION = 'v4';

/** Total valid combinations: 9 domains × 8 frames = 72 */
export const VALID_COMBINATIONS = DOMAINS.length * FRAME_TYPES.length;

export const EXPECTED_SUB_GOALS = 8;
export const EXPECTED_ACTIONS_PER_GOAL = 8;

/**
 * sub_labels 규칙 (v2, 2026-04-14):
 * - 무의미 축약 절대 금지 (DecltrM, AttentTrn 등)
 * - 카멜케이스 금지, 띄어쓰기 사용
 * - KO: ~10자 soft limit (의미 보존 우선, 초과 허용)
 * - EN: ~15자 soft limit (의미 보존 우선, 초과 허용)
 * - 핵심어 추출 방식 (앞글자 절단 금지)
 */
export const SUB_LABEL_SOFT_LIMIT_KO = 10;
export const SUB_LABEL_SOFT_LIMIT_EN = 15;
