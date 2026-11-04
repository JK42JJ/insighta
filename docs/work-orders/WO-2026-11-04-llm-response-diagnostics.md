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

# 진단 결과 (2026-11-05, stg, 카드 `r-kfj2PVUy4`, 호출 2회 모두 동일)

| 항목 | 값 |
|---|---|
| `finishReason` / `nativeFinishReason` | `length` / `length` |
| `completionTokens` / `maxTokens` | 8192 / 8192 |
| `reasoningTokens` | **8192** (출력 전부가 추론) |
| `reasoningChars` / `contentChars` | 17,951·19,462 / **0** |
| `provider` / `responseModel` | `GMICloud` / `deepseek/deepseek-v4-flash` |

결론: 모델이 출력 예산 전부를 추론에 쓰고 본문을 쓰지 못한 채 `length` 로 잘린다. OpenRouter 문서(reasoning tokens)도 "대부분의 제공자에서 `max_tokens` 는 추론과 본문의 합이며, 추론이 예산을 다 쓰면 본문 없이 불완전 응답이 반환되고 추론 토큰은 과금된다"고 명시한다. 같은 영상은 재시도에서도 같은 결과라 재시도는 효과 없이 비용만 늘린다. 한 줄 요약(빠른 경로, haiku, Bedrock)은 추론 0토큰으로 정상.

# 다음 단계: 추론 강도를 설정으로 제한 (같은 오더의 후속)

- `RICH_SUMMARY_V2_REASONING_EFFORT`(미설정 = 현재 동작, prod 불변)를 v2 생성 호출에 `reasoning.effort` 로 전달. 잘못된 값은 무시(설정 전체가 폴백으로 떨어지지 않게).
- stg 에서만 `low` 로 켜고(`build-stg-secret.py` 의 `FIXED_VALUES`) 같은 카드를 열어 `reasoningTokens` 와 `contentChars` 로 효과를 직접 읽는다. 부족하면 `none`, 거부되면 그 오류가 로그에 남는다.
- 확인 못 한 것: 이 모델과 GMICloud 에서 `none` 이 허용되는지(추론 필수 모델은 거부), `low` 로 얼마나 줄어드는지.
- `apply-stg-secret.sh` 는 api 를 다시 올린 뒤에 worker 를 재시작한다(2026-11-04 동시 재시작이 ingress 를 4.5분 내린 사고).
- prod 반영은 stg 결과를 보고 James 승인 후 별도.
