---
id: WO-2026-11-04-llm-response-diagnostics
status: running
owner: insighta-session
opened: 2026-11-04
---

# 목표

상세 요약(`summary_v2_full`)이 빈 본문으로 끝나는 원인을 **간접 추정이 아니라 응답 자체로** 확정한다. 확정 전에는 모델도 파라미터도 바꾸지 않는다.

# 맥락 (2026-11-04 실측)

- prod 9월: 29개 카드 전부 성공. 10/21 이후: 10개 카드 중 6개 실패(호출 25건 중 18건은 재시도 포함), 모두 사용자 1명의 호출. 실패한 카드는 9월 성공 카드와 겹치지 않고, 같은 영상이 성공과 실패를 오가기도 한다.
- 실패한 호출은 모두 출력이 정확히 8192토큰(상한)이다. 이것만으로 "추론이 예산을 소진했다"고 **추정**했으나 직접 확인한 적은 없다.
- `src/modules/llm/openrouter.ts` 는 본문이 비면 토큰 수와 오류 문구만 남긴다. `finish_reason`, 추론 토큰 수, 응답한 제공자와 모델 버전, 추론 텍스트 길이를 읽지도 남기지도 않는다. 그래서 지금 가진 로그로는 더 가를 수 없다.

# 변경

- `src/modules/llm/response-meta.ts`(신규, 설정 의존 없음): 응답에서 `model`, `provider`, `finish_reason`, `native_finish_reason`, `completion_tokens`, `reasoning_tokens`, 추론 텍스트 길이, 본문 길이를 뽑는 함수. 텍스트 자체는 저장하지 않는다.
- `openrouter.ts`: 모든 호출에서 위 값을 로그 한 줄(`[OpenRouter] meta {JSON}`, 이 파일의 기존 `console.info` 방식)로 남긴다. 처음에는 `logger` 를 import 했으나 설정을 대체하는 기존 테스트(`compute-card-relevance`)가 깨져 CI 가 잡았고, `console.info` 로 바꿨다. 동작 변경 없음, DB 스키마 변경 없음.
- 단위 테스트 4개.

# 검증 방법

1. CI 통과 후 머지 → stg 자동 배포.
2. stg 에서 100% 실패했던 카드 3장(`9n4jtXxjdc4`, `sy8ofKp3JYw`, `r-kfj2PVUy4`)의 요약 행을 지우고(백업 후, stg DB 전용) James 가 카드를 연다. 호출당 약 $0.003, stg 전용 키.
3. worker 로그의 `[OpenRouter] meta` 줄을 읽어 아래로 판정한다.

| 로그 | 결론 | 다음 |
|---|---|---|
| `finishReason=length` 이고 `reasoningTokens` ≈ 8192 | 추론이 예산을 소진 | 추론 제한 파라미터를 도입하고 같은 방식으로 효과 확인 |
| `finishReason=stop` 이고 본문이 비고 `reasoningChars` > 0 | 제공자가 본문을 추론 필드에 넣음 | 응답 해석 수정 |
| 성공과 실패 호출의 `provider` 또는 `responseModel` 이 다름 | 특정 제공자나 버전에서만 실패 | 제공자 또는 버전 고정 |
| 위 어느 것도 아님 | 원인 미확정 | 로그를 더 늘리지 않고 James 와 재논의 |

# 제약

- 모델·파라미터·프롬프트를 바꾸지 않는다. prod 동작은 변하지 않는다(로그 한 줄 추가).
- 이 변경은 main 머지 후 prod 에도 배포된다(R33 공백). 추가되는 것은 로그뿐이다.
- 로그에 요약 본문이나 추론 내용을 남기지 않는다(길이만).

# 롤백

PR revert. 이미지는 커밋 해시 핀이라 이전 핀으로 복귀 가능.
