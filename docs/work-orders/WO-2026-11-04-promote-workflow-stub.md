---
id: WO-2026-11-04-promote-workflow-stub
status: running
owner: insighta-session
opened: 2026-11-04
---

# 목표
prod 승급을 "main 머지"에서 "수동 dispatch + staging 증명 gate + Production 환경 승인"으로 옮기는 첫 단계로, 변경 잡이 없는 `promote.yml` 골격과 gate 스크립트를 main 에 넣는다.

# 맥락
- 결정: James 2026-11-04 (PRD v1.2 Q14, Q12). 구조는 `docs/agent-loop/PRD-v1.2.md` §3 의 PR-A.
- 선행 계획: `docs/work-orders/WO-2026-11-03-stg-to-prod-promotion.md` (draft).
- 이 PR 은 `deploy.yml` · `terraform.yml` · 차트를 바꾸지 않는다. prod 경로는 그대로이며 PR-E 에서 옮긴다.

# 제약
- 변경 잡(migrate · edge · pin-images)은 `echo` 스텁. 시크릿 · 체크아웃(prod 설정) · 클라우드 · 클러스터 접근 0.
- gate 를 우회하는 입력 없음.
- `deploy-production` concurrency 그룹을 쓰지 않는다 (Q16 미결).
- 입력은 `env:` 로만 스크립트에 전달한다.
- 이 PR 은 James 가 머지한다. 머지 전에는 `workflow_dispatch` 로 실행할 수 없다.

# 검증 기준
- [x] `scripts/ci/promote-gate.sh <초록 sha>` → exit 0
- [x] 같은 스크립트, staging 잡이 건너뛰어진 main sha → exit 1 과 한 줄 사유
- [x] 같은 스크립트, staging 잡이 없는 옛 실패 run 의 sha → exit 1
- [x] 같은 스크립트, 형식이 틀린 입력 · main 에 없는 커밋 · 없는 sha → exit 2 / 1 / 1
- [ ] `npx jest tests/smoke/promote-gate.test.ts` 통과 (gh 대역 + 워크플로 불변식)
- [x] actionlint 통과 (`rhysd/actionlint:latest` 로컬 이미지, exit 0, 출력 없음)
- [ ] CI 필수 체크 8개 통과

# james
- PR 머지 (가역: 변경 잡이 스텁이라 prod 효과 없음).
- PR-B: `Production` 환경 required reviewer 지정. 그 전에는 `approve` 가 즉시 통과한다 (스텁이라 무해).
- PR-D, PR-E 는 별도.

# restated
`promote.yml` 은 gate(해당 sha 의 deploy.yml push run 에서 `Staging smoke check` 와 `Staging E2E / Playwright E2E (staging)` 가 둘 다 success)를 통과해야 `Production` 환경 승인 대기로 가고, 그 뒤 잡은 echo 만 한다. 건너뜀 · 취소 · 진행 중 · 부재는 모두 실패다.

# 결과
2026-11-04 실측 (읽기 전용 `gh api`):
- 초록 `218c83f6dfe2cb5714aa24741e49e2847f6a5f6f` (deploy run 41684482971): exit 0, PASS.
- staging 잡 전부 skipped `19b837358ca2b37f4043d4df1649365c54e20733` (run 41828376717, 문서만 바꾼 머지): exit 1, "'Staging smoke check' is skipped, not success".
- 옛 실패 run `eb52d6c0dcc57c4a020b4ef8c00101e6226daa26` (run 35202163202, Database Schema Sync failure, staging 잡 없음): exit 1, "has no job 'Staging smoke check'".
- `691d9a54a6472850a376e7db3f85176eca70ab23`: push run 은 success, dispatch run 은 failure. 스크립트는 push run 만 보며 staging 잡이 skipped 라 exit 1.
- 입력 `zzzz` · `218c83f6` · 대문자 40자: exit 2. main 에 없는 커밋 `c72f0136c1b4…`: exit 1 "not an ancestor of origin/main". `0000…0`(40자): exit 1 "not in this checkout".
- gh 대역 + 임시 git 저장소로 같은 스크립트 실행(bash 하니스, 7건 모두 기대와 일치): green 0, E2E cancelled 1, E2E 진행 중(conclusion null) 1, 중복 E2E 중 하나 skipped 1, run 진행 중 1, run 없음 1, run 두 개면 최신 run(id 2)의 jobs 만 조회 0.
- 하니스가 찾은 결함: 스텁 `run: echo "STUB: would ..."` 의 평문 스칼라 안 `: ` 로 YAML 파싱 실패 → 블록 스칼라(`run: |`)로 수정. 수정 후 PyYAML 파싱 통과, 인라인 `${{` 0건, `secrets.` 참조 0건.
- `gh run list --commit` 는 이 머신의 gh 에 없는 플래그라 REST(`head_sha` · `event` 쿼리)로 구현.
- 미검증: Jest 파일(`tests/smoke/promote-gate.test.ts`)은 이 머신에서 실행하지 못했다. memory-guard 가 압력 2 (스왑 19.9GB/20GB)로 차단했고, 이 워크트리의 `node_modules` 링크 대상(메인 트리)도 정상 설치본이 아니다. 우회하지 않았다. CI 의 Test Backend & Build API 가 첫 실행이다.
- 미검증: `workflow_dispatch` 실행은 파일이 기본 브랜치에 있어야 가능해 머지 전 불가. `approve` 의 환경 대기와 `Production` 환경 reviewer 동작은 PR-B 이후 확인한다.
- 롤백: PR 닫기 또는 revert. 새 파일 3개 + 테스트 1개 + 오더 1개뿐이며 기존 워크플로 · 차트 변경 0.
