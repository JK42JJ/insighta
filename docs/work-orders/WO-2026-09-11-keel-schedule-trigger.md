---
id: WO-2026-09-11-keel-schedule-trigger
status: open
owner: insighta-session
opened: 2026-09-11
---

# 목표
Keel 이 GitHub cron 지연과 무관하게 30분 안에 돈다. 비용 0.

# 맥락
`docs/spec/observability.md` §4 첫 행. 2026-09-11 실측: 예약(`schedule`) 발화 마지막 20:36 KST, 이후 22:00 까지 84분간 0회. 워크플로 상태는 `active`(비활성화 아님), 같은 시간 dispatch 3회는 정상 실행 → GitHub 측 cron 지연. `*/30` 은 "최대 30분" 이 아니라 "빨라야 30분" 이다. 보안 3검사(iam-hygiene · supply-chain · cloud-posture)와 배포 드리프트 검사가 이 주기에 얹혀 있다.

# 제약
- 비용 0. 새 서비스 없음. GitHub Actions 안에서 풀거나, 이미 있는 자산(맥미니 launchd · 클러스터 CronJob)만.
- 알림 전이 규칙(edge-triggered)과 원장 스키마는 그대로.

# 검증 기준
- [ ] 24시간 동안 `gh run list --workflow keel.yml --json event,createdAt` 에서 인접 실행 간격 최대값 ≤ 35분
- [ ] 대안 트리거가 실패해도 예약 트리거는 남아 있다(둘 다 제거 금지)
- [ ] `error_events` 의 `keel` 행 간격이 같은 24시간 동안 ≤ 35분 (`scripts/ops/keel-ledger.sh --sql`)

# 후보 (착수 시 하나 고르고 근거를 결과에 적는다)
1. 클러스터 CronJob 이 `gh workflow run keel.yml` 을 호출(토큰 = 읽기·actions:write 만 가진 fine-grained PAT, 시크릿은 ESO 미도입이라 etcd 평문 — 판단 필요).
2. 배포 워크플로 완료 후 `workflow_run` 트리거 추가 — 주기는 못 고치지만 배포 직후 검사는 보장. 1 과 병행 가능.
3. Keel 실행 자체를 클러스터 CronJob 으로 옮김(러너 = 클러스터, OIDC 대신 인스턴스 프로파일 읽기 권한 필요 → IAM 변경, 비용 0).

# james
없음(설계 결정은 되돌릴 수 있음). 1번의 PAT 보관 위치만 결정 필요할 수 있음.

# restated
GitHub cron 이 84분간 안 돌았다. 30분 약속을 GitHub 에만 맡기지 않도록 두 번째 트리거를 붙인다. 비용 0, 기존 트리거 유지.

# 결과
(착수 후 기록)
