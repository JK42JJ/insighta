# 워크 오더

작업 단위의 유일한 형식. 오더 없이 코드를 바꾸지 않는다. "이왕이면 이것도" 는 새 오더다.
설계 근거: `docs/ops/working-method-2026-09-11.md` §3.1.

## 규칙

- 한 파일 = 한 단위. 파일명 `WO-YYYY-MM-DD-slug.md`. 머리에 `status: open | running | verified | closed`.
- 네 요소가 다 있어야 `open` 이다: 목표 · 맥락 · 제약 · 검증 기준. 검증 기준이 비어 있으면 에이전트가 먼저 제안하고 `draft` 로 둔다.
- 되돌릴 수 없는 결정(발송 · 결제 · 삭제 · 비용 · 방향 · 시크릿 재발급)은 `james:` 항목으로 분리해 적는다. 그 외는 에이전트가 실행하고 결과에 기록한다.
- 에이전트는 시작 전에 검증 기준을 자기 말로 `restated:` 에 다시 적는다. 다르게 이해했으면 여기서 드러난다.
- 끝은 `verified` 다. 검증 기준 각 줄에 실측 결과가 붙어야 하고, 하나라도 비면 `running` 이다. "완료" 라는 단어는 `closed` 뒤에만 쓴다.
- 막히면 채팅으로 되묻지 않고 `QUESTIONS.md` 에 적고 다음 오더로 간다.
- 목록과 상태 확인: `bash scripts/ops/work-orders.sh` (`list` · `open` · `questions`).

## 흐름

아침: James 가 `draft` → `open` 으로 승인(오더 단위, 단계 단위 아님). 낮: 에이전트 실행. 저녁: `bash scripts/ops/digest.sh` 가 다이제스트를 만들고 James 가 3줄 결정을 남긴다. 그 3줄이 다음 오더의 초안이 된다.
