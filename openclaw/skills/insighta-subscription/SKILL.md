---
name: insighta-subscription
description: Check subscription graph updates and propagate new insights from subscribed mandalas.
user-invocable: true
metadata: {"bins": ["curl"]}
---

# Skill: insighta-subscription

## Description
구독 그래프의 새 인사이트를 조회하여 사용자에게 전달한다.
heartbeat 또는 사용자 요청 시 호출.

## Instructions

1. Insighta API에 GET 요청:
   ```bash
   INSIGHTA_API_URL="${INSIGHTA_API_URL:-http://localhost:3000}"
   curl -s "${INSIGHTA_API_URL}/api/v1/subscriptions/updates" \
     -H "Authorization: Bearer $INSIGHTA_BOT_KEY"
   ```

2. 새 인사이트가 있으면 구독자 이름과 만다라트 이름과 함께 전달

3. 예시 메시지:
   ```
   구독 업데이트가 있어요!

   [사용자A]님의 [영어학습] 만다라에 새 인사이트 2개:
   - "효과적인 섀도잉 방법" (영상 3개 기반)
   - "발음 교정 팁 모음" (메모 5개 기반)
   ```

4. 업데이트가 없으면 이 스킬은 조용히 건너뛴다 (메시지 안 보냄).

## Environment Variables
- `INSIGHTA_BOT_KEY` — Bot 인증 Bearer 토큰 (필수)
- `INSIGHTA_API_URL` — API base URL (기본값: `http://localhost:3000`, prod: `https://insighta.one`)

## API Response Format
```json
{
  "updates": [
    {
      "subscriberName": "사용자A",
      "mandalaName": "영어학습",
      "newInsights": [
        { "title": "효과적인 섀도잉 방법", "basedOn": "3 videos" }
      ]
    }
  ]
}
```
