/**
 * Intent Router — lightweight request classification for multi-service dispatch
 *
 * MVP: keyword-based routing (fallback mode).
 * Future: FunctionGemma 270M model for neural intent classification.
 * Issue: #255 (MA-2: GraphDB Service Layer)
 */

import { chat } from './chat';
import { generateKnowledgeSummary } from './report';
import { logger } from '../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export type IntentType =
  | 'chat'
  | 'weekly_summary'
  | 'tag_memo'
  | 'summarize_video'
  | 'embed_text'
  | 'classify_card'
  | 'suggest_edges'
  | 'unknown';

export interface RouteRequest {
  query: string;
  conversationId?: string;
}

export interface RouteResult {
  intent: IntentType;
  confidence: number;
  params: Record<string, unknown>;
  result?: unknown;
  routed: boolean;
}

// ============================================================================
// Keyword-based Intent Classification (fallback mode)
// ============================================================================

interface IntentPattern {
  intent: IntentType;
  keywords: string[];
  weight: number;
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: 'weekly_summary',
    keywords: [
      '요약',
      'summary',
      '리포트',
      'report',
      '주간',
      'weekly',
      '이번 주',
      'this week',
      '월간',
      'monthly',
      '오늘',
      'today',
      '학습 현황',
      '진행 상황',
      'progress',
    ],
    weight: 1.5,
  },
  {
    intent: 'tag_memo',
    keywords: [
      '태그',
      'tag',
      '키워드',
      'keyword',
      '분류',
      'classify',
      '카테고리',
      'category',
      '메모',
      'memo',
      '라벨',
      'label',
    ],
    weight: 1.2,
  },
  {
    intent: 'summarize_video',
    keywords: [
      '영상 요약',
      'video summary',
      '동영상',
      'video',
      'youtube',
      '유튜브',
      '요약해',
      'summarize',
    ],
    weight: 1.3,
  },
  {
    intent: 'suggest_edges',
    keywords: [
      '연결',
      'connect',
      '관계',
      'relation',
      '추천',
      'suggest',
      '링크',
      'link',
      '관련',
      'related',
    ],
    weight: 1.1,
  },
  {
    intent: 'embed_text',
    keywords: ['임베딩', 'embed', 'vector', '벡터', '유사도', 'similarity'],
    weight: 1.0,
  },
  {
    intent: 'classify_card',
    keywords: ['카드 분류', 'classify card', '정리', 'organize', '분류해', 'sort'],
    weight: 1.0,
  },
];

function classifyIntent(query: string): { intent: IntentType; confidence: number } {
  const lower = query.toLowerCase();
  let bestIntent: IntentType = 'chat';
  let bestScore = 0;

  for (const pattern of INTENT_PATTERNS) {
    let matchCount = 0;
    for (const keyword of pattern.keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        matchCount++;
      }
    }
    if (matchCount > 0) {
      const score = (matchCount / pattern.keywords.length) * pattern.weight;
      if (score > bestScore) {
        bestScore = score;
        bestIntent = pattern.intent;
      }
    }
  }

  // Default to chat if no strong match
  const confidence = bestScore > 0 ? Math.min(bestScore, 1.0) : 0.5;
  return { intent: bestIntent, confidence };
}

// ============================================================================
// Router — classify + dispatch
// ============================================================================

export async function routeRequest(userId: string, request: RouteRequest): Promise<RouteResult> {
  const { query } = request;

  const { intent, confidence } = classifyIntent(query);

  logger.info('Intent classified', { userId, intent, confidence, query: query.slice(0, 100) });

  const result: RouteResult = {
    intent,
    confidence,
    params: {},
    routed: false,
  };

  // Dispatch to appropriate service
  switch (intent) {
    case 'chat': {
      const chatResult = await chat(userId, {
        query,
        conversationId: request.conversationId,
      });
      result.result = chatResult;
      result.routed = true;
      break;
    }

    case 'weekly_summary': {
      // Detect period from query
      let period: 'day' | 'week' | 'month' = 'week';
      const lower = query.toLowerCase();
      if (lower.includes('오늘') || lower.includes('today') || lower.includes('daily')) {
        period = 'day';
      } else if (lower.includes('월간') || lower.includes('monthly') || lower.includes('이번 달')) {
        period = 'month';
      }
      result.params = { period };
      const summaryResult = await generateKnowledgeSummary(userId, period);
      result.result = summaryResult;
      result.routed = true;
      break;
    }

    // These intents are classified but not yet dispatchable (P2)
    case 'tag_memo':
    case 'summarize_video':
    case 'embed_text':
    case 'classify_card':
    case 'suggest_edges': {
      result.params = { query };
      // Fallback: route to chat for now
      const fallback = await chat(userId, {
        query,
        conversationId: request.conversationId,
      });
      result.result = fallback;
      result.routed = true;
      break;
    }

    default: {
      const defaultResult = await chat(userId, {
        query,
        conversationId: request.conversationId,
      });
      result.result = defaultResult;
      result.routed = true;
    }
  }

  return result;
}
