---
id: WO-2026-09-11-newsletter-v21-pr4-gates
status: draft
owner: insighta-session
opened: 2026-09-11
---

# 목표
창간호에서 사람이 사후에 찾아낸 사실 결함 9건을 코드가 발행 전에 자동으로 잡는다.

# 맥락
v2.1 §3.4(등급 계산) · §4 W5·W7·W8 · §9 PR 4. 픽스처 = 핸드오프 zip `07-issue1-verify-log.md` §A 9건, `05-issue1-body-rewrite.md`, 코퍼스 274편 + 자막 197편. 선행 = WO-…-pr1.

# 제약
- 원자 주장 분해와 근거 추출의 LLM 호출은 테스트에서 고정 픽스처로 대체(LLM 호출 0).
- 게이트 목록은 코드가 아니라 `nl_gate_spec` 테이블에서 읽는다.

# 검증 기준
- [ ] 9건 각각을 재현한 픽스처 입력 → hard gate 또는 등급 규칙이 9/9 검출(테스트 9개)
- [ ] 정상 문장 픽스처(verify-log §B) 는 통과(오탐 0)
- [ ] `nl_claim` 등급이 §3.4 표 4행을 모두 만족하는 단위 테스트
- [ ] 미실행 게이트가 있으면 발행 조건 false

# james
없음(코드와 테스트만).

# restated

# 결과
