---
name: insighta-report
description: Generate weekly learning reports for Insighta mandalas. Called on weekly heartbeat or user request.
user-invocable: true
metadata: {"bins": ["curl"]}
---

# Skill: insighta-report

## Description
주간 학습 리포트를 생성한다.
heartbeat (주 1회 월요일) 또는 사용자 요청 시 호출.

## Instructions

1. Insighta API에 GET 요청:
   ```bash
   INSIGHTA_API_URL="${INSIGHTA_API_URL:-http://localhost:3000}"
   curl -s "${INSIGHTA_API_URL}/api/v1/analytics/weekly-report" \
     -H "Authorization: Bearer $INSIGHTA_BOT_KEY"
   ```

2. 만다라트별 활동 요약 생성

3. 톤: 다그치지 않고, 사실 기반, "같이 가자" 느낌

4. 예시 메시지:
   ```
   이번 주 리포트예요 :)

   AI/ML 전문가: 영상 5개, 메모 3개 추가. 집중 모드!
   영어 학습: 2주째 쉬고 있어요. 충전 중이신가요?

   구독한 분의 새 인사이트: 2개 있어요.
   ```

5. 활동이 전혀 없는 만다라트는 가볍게만 언급하고 넘어간다.

## Environment Variables
- `INSIGHTA_BOT_KEY` — Bot 인증 Bearer 토큰 (필수)
- `INSIGHTA_API_URL` — API base URL (기본값: `http://localhost:3000`, prod: `https://insighta.one`)

## API Response Format
```json
{
  "mandalas": [
    {
      "id": "uuid",
      "name": "AI/ML 전문가",
      "mood": 0,
      "sessions": 5,
      "notes": 3,
      "insights": 2
    }
  ]
}
```
