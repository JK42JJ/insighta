---
id: WO-2026-09-15-unique-claim-gate
status: running
owner: insighta-session
opened: 2026-09-15
---

# 목표

학습 경로 카드에서 "이 영상만의 한 가지"(unique_claim)를 볼 수 있되, 자막에서 축어로 확인된 주장만 보인다.

# 맥락

- 평가 원장: `docs/qa/unique-claim-ab-ledger-2026-09-15.md` (스모크 5편 · 팔 A/B/B′/C · 게이트 파라미터와 근거)
- 프롬프트 SSOT: `src/modules/skills/rich-summary-v2-prompt.ts` · 저장 라우트: `src/api/routes/internal/transcript.ts` · 플래그: `src/config/rich-summary.ts`
- James 지시(2026-09-15): 게이트 = 축어 구간 일치(±60초), 미통과 drop, "근거 미확인" 표시 없음, 플래그 오프로 머지. 표면은 학습 경로 카드까지, 브리프 리드는 30편 평가 뒤 결정.

# 제약

- 기존 요약 필드·완성도 점수 무변경. unique_claim 은 추가 필드이고 optional.
- `RICH_SUMMARY_UNIQUE_CLAIM_ENABLED` 기본 false. off 이면 프롬프트가 요청하지 않고 라우트가 들어온 값을 버린다.
- B 팔 문장은 원문 그대로: "다른 유튜브에서 얘기하지 않는 가장 중요한 내용을 발췌해 줘".
- 최소 축어 길이: 한글 우세 12자 · 라틴 24자(정규화 후). 값은 원장에 기록하고 사후 조정하지 않는다.

# 검증 기준

- [ ] `npx jest tests/unit/skills/rich-summary-v2-unique-claim.test.ts` → 19 passed
- [ ] `npx jest tests/unit/api/prompt-build-v2.test.ts tests/unit/api/transcript-direct-upsert.test.ts tests/unit/skills` → all passed
- [ ] `npx tsc --noEmit -p tsconfig.json` → 0 errors
- [ ] flag off: `buildV2Prompt({...})` 출력에 `unique_claim` 없음 (테스트 `omitted / false`)
- [ ] flag on + 축어 12자 이상 ±60초 → `verifyUniqueClaim().pass === true`; 패러프레이즈 → false (테스트 `paraphrase inside the window`)
- [ ] prod: 머지 후 `curl -s https://insighta.one/health` 200, 요약 저장 경로 무회귀(22:00 수집기 실행 pass 건에 unique_claim 없음 = 플래그 off 증거)

# james

없음(플래그 켜는 시점과 브리프 리드 노출은 30편 평가 뒤 별도 결정).

# restated

플래그가 꺼진 채로 필드·게이트를 배선하고, 켜졌을 때는 자막 축어 구간이 타임스탬프 ±60초 안에 있는 주장만 남긴다. 나머지는 버린다.

# 결과

- PR #1662 머지(`51252f89`, 2026-09-15 23:38 KST, 검사 11/11 green, `merge-green.sh`). 플래그 off 로 머지되어 프로덕션 동작 무변경.
- 검증 기준 실측: `npx jest tests/unit/skills/rich-summary-v2-unique-claim.test.ts` 19 passed · 인접 스위트 포함 21 suites 144 passed · `tsc --noEmit` 0 errors · flag off 시 프롬프트에 `unique_claim` 없음(테스트 `omitted / false`) · 축어 12자 ±60초 통과 / 패러프레이즈 기각(테스트 `paraphrase inside the window`) · prod `/health` 200.
- 미검증: 플래그 on 상태의 라이브 실행 없음. 라우트 통합 테스트(fastify inject) 미작성. 첫 flag-on 실행은 `docs/qa/unique-claim-ab-ledger-2026-09-15.md` §10 의 U 팔 시험이며 프로덕션이 아니다.
- 롤백: 본 PR revert 또는 플래그 미설정 유지(off 상태에서 저장되는 요약은 이전과 바이트 동일).

# 후속

- 표면(학습 경로 카드 + 브리프 별도 항목)은 별도 PR. 브리프 측은 `nl_claim`/`nl_evidence` 가 origin/main 에 없어 **PR #1632(OPEN) 선행 필요**.
- 플래그를 켤지 여부는 §10 U 팔 시험 결과와 James 판정선 고정에 달려 있다. 2026-09-16 리드 점검(`docs/qa/unique-claim-ab-ledger-2026-09-15.md`)은 **리드 승격을 기각**했으나 v2 필드 값어치는 미판정이다.
