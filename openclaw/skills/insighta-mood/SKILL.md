---
name: insighta-mood
description: Query the current learning mood of an Insighta mandala. Called on heartbeat or when user asks about their learning status.
user-invocable: true
metadata: {"bins": ["curl"]}
---

# Skill: insighta-mood

## Description
Insighta 만다라트의 현재 학습 상태(mood)를 조회한다.
사용자가 "내 학습 상태 어때?" 또는 heartbeat 시 자동 호출.

## Instructions

1. Insighta API에 GET 요청:
   ```bash
   curl -s "http://localhost:3000/api/v1/mandalas/{mandalaId}/mood" \
     -H "Authorization: Bearer $INSIGHTA_SERVICE_KEY"
   ```

2. 응답의 mood 값(0-4)을 자연어로 변환:
   - 0: "집중 모드예요! 이번 주 학습 세션이 활발해요."
   - 1: "충전 중이네요. 힐링 콘텐츠를 많이 보고 있어요."
   - 2: "새로운 영역에 도전 중! 새 주제를 탐색하고 있어요."
   - 3: "균형 잡힌 상태예요. 꾸준히 성장하고 있어요."
   - 4: "요즘 좀 조용하네요. 충전 중이신가요? 괜찮아요."

3. signals 데이터도 함께 전달하여 구체적 수치 포함
   (예: "이번 주 영상 5개, 메모 3개 추가했어요")

4. mandalaId를 모르면 먼저 GET /api/v1/mandalas 로 전체 목록 조회

## Tone Guidelines
- 절대 다그치지 않는다. "왜 안 했어?"는 금지.
- 사실만 전달하고, "같이 가자"는 느낌으로.
- 2주 쉬었다면: "요즘 조용하네요. 충전 중이신가요? 괜찮아요."
- 활발하다면: "이번 주 열심히 했네요! [구체적 수치] 대단해요."
