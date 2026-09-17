---
id: WO-2026-09-11-newsletter-v21-pr4-gates
status: verified
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
- [x] 9건 각각을 재현한 픽스처 입력 → 결함 7건(A1~A6 · A9)은 등급 규칙 또는 hard gate 가 잡고, A7 · A8 은 자막 근거가 있는 정상 문장이라 관측 등급으로 통과하는 것이 정답 — `newsletter-v2-gates.test.ts` A1~A9 (2026-09-11, #1633)
- [x] 정상 문장 픽스처(verify-log §B) 는 통과(오탐 0) — `tests/unit/modules/newsletter-v2-normal-sentences.test.ts`: §B 11행(인용 5 · 숫자 9 · 고유명사 4)이 전부 관측 등급, 내용 hard 게이트 3종 통과(12 테스트, 2026-09-11). 고유명사는 설명문 근거가 함께 있어야 관측이 된다는 §D 규칙을 픽스처가 그대로 따른다
- [x] `nl_claim` 등급이 §3.4 표 4행을 모두 만족하는 단위 테스트 — 확인(§E fetched primary) · 관측(A6 · A7/A8) · 고유명사 자막 단독 불가(§D) · 불일치 → 미확인(A5)
- [x] 미실행 게이트가 있으면 발행 조건 false — 'a declared gate without an implementation fails, and an unrun block gate blocks publish'

# james
없음(코드와 테스트만).

# restated
창간호 verify-log §A 의 9건(판정 사유의 사실 승격 · 인용 누락 · 설명문 단독 숫자 · 자막과 다른 표현 · 숫자 불일치 · 자막 단독 근거의 확인 격상 · 마커 잔존)과 §C(자막 없는 영상) · §D(자막 단독 고유명사) · §E(미확인 [확인]) 각각을 픽스처로 재현해, 등급 규칙 또는 hard 게이트가 코드로 잡는 테스트를 만든다. 정상 문장은 통과해야 하고, 선언됐지만 구현·실행되지 않은 게이트는 실패로 센다.

# 결과
2026-09-11 (insighta 세션, 자율 루프 2차)
- `src/modules/newsletter/v2/grade.ts`: 숫자 정규화(구분자 · 배수어 · 근사어 5%) · 식별자(CVE 등)는 텍스트 비교 · 등급 계산(§3.4 4행: primary 2xx+fetched → 확인 / caption·description 일치 → 관측 / 고유명사 자막 단독 불가 / 불일치·단일 출처 → 미확인) · 자막 품질 강등(다중 화자 · 음악 · entity_recall < 0.6).
- `src/modules/newsletter/v2/gates.ts`: hard 8(fact-has-evidence · grade-rules-pass · story-no-captionless-evidence · confirmed-primary-2xx · no-raw-markers · no-editorial-vocab-emoji · picks-match-db · footnotes-contiguous) · soft 4(banned-phrases · title-shape · judgment-count · sentence-length-variance) · `runGates`(선언됐는데 미구현 = 실패) · `publishAllowed`(block 전부 실행+통과).
- `tests/unit/modules/newsletter-v2-gates.test.ts`: 16 테스트 전부 통과. §A 9건 중 A1·A2·A3·A4·A5 = 미확인 검출, A6 = 관측이며 [확인] 표기 시 차단, A7·A8 = 정상 통과(관측), A9 = 마커 차단. §C 차단, §D 미확인, §E 미fetched 차단·fetched 확인. 미구현 게이트·미실행 block 게이트 = 발행 불가.
- 미검증: 실제 DB 행(`nl_claim` 등)을 스냅샷으로 읽는 어댑터와 W7 실행 경로(PR 1 머지 후). 렌더 후 각주 검사는 렌더러(W9)가 있어야 실동작. soft 4종 중 어미 일관성 · 동사 반복 · 용어 풀이 · 이해 판정기는 형태소 분석(`kiwipiepy`)이 필요해 이번 PR 제외.
- 롤백: 새 파일 3개 삭제. 실행 경로에 아직 배선되지 않아 서비스 무영향.
- 2026-09-11 21:52 KST #1644: verify-log §B 정상 문장 11행 픽스처(12 테스트) — 오탐 0. 검증 기준 4/4 → verified. 남은 것(DB 어댑터 · W7 실행 경로 · 렌더 후 각주 검사)은 PR #1632 머지 뒤 별도 오더.
