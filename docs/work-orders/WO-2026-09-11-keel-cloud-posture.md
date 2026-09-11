---
id: WO-2026-09-11-keel-cloud-posture
status: running
owner: insighta-session
opened: 2026-09-11
---

# 목표
계정 기준선(`terraform/modules/security-baseline`)이 되돌아가면 — 트레일 정지 · 알람 삭제/비활성 · EBS 기본 암호화 해제 · 비밀번호 정책 완화 · 감사 버킷 공개 · 알림 구독 미확인 — 사람이 아니라 Keel 이 30분 안에 안다.

# 맥락
`docs/security/cloud-security-architecture-2026-09-11.md` §5 Stage 2 Detect · `WO-2026-09-11-keel-security-checks` 결과의 "나머지 3종" 중 첫 번째. CI 역할 읽기 권한(`terraform/global/iam-ci/security-read.tf`)에 cloudtrail · cloudwatch · ec2 · iam · s3 · sns 읽기가 이미 있어 IAM 변경 없음. 로컬 실측(2026-09-11 21:20 KST): 트레일 IsLogging true · 다중 리전 · 검증 on, 알람 8 전부 ActionsEnabled, EBS 기본 암호화 true, 비밀번호 최소 14 · 재사용 24, 감사 버킷 4 플래그 true, SNS Confirmed 0 · Pending 1.

# 제약
- 비용 0. 읽기 호출 7개(`get-trail-status` · `get-trail` · `describe-alarms` · `get-ebs-encryption-by-default` · `get-account-password-policy` · `get-public-access-block` · `get-topic-attributes`)만.
- 판정은 순수 함수(`evaluatePosture`)로 분리해 AWS 없이 단위 테스트. 읽지 못한 사실 = 실패(미실행 = 실패 원칙).
- 알람 기대 목록은 모듈 `locals.trail_alarms` 의 키 8개와 같아야 한다. 모듈에 알람을 추가하면 이 목록도 같은 PR 에서.

# 검증 기준
- [ ] `tests/unit/keel/cloud-posture.test.ts` 7건 통과(CI 백엔드 잡, ts-jest 가 `scripts/keel` 타입 검사)
- [ ] 예약 실행에서 `cloud-posture` 행이 `error_events` 에 남고, 현재 상태에서는 ok:false "alert topic has no confirmed subscription (pending 1)" 만 보고
- [ ] James 가 support@ 받은편지함에서 SNS 구독을 확인하면 다음 주기에 ok:true 로 전이

# james
SNS 구독 확인 메일(support@insighta.one) 클릭 — 이 검사가 초록이 되는 유일한 남은 조건.

# restated
기준선 7가지 사실을 30분마다 읽어 하나라도 어긋나면 이름을 붙여 알린다. 지금 어긋난 것은 알림 구독 미확인 하나뿐이다.

# 결과
(머지 후 기록)
