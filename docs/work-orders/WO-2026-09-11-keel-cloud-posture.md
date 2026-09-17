---
id: WO-2026-09-11-keel-cloud-posture
status: verified
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
- [x] `tests/unit/keel/cloud-posture.test.ts` 7건 통과(CI 백엔드 잡, ts-jest 가 `scripts/keel` 타입 검사)
- [x] keel.yml 실행에서 `cloud-posture` 가 CI 역할로 7개 사실을 읽고 ok:false "alert topic has no confirmed subscription (pending 1)" 만 보고 — 2026-09-11 21:27 KST dispatch run 34598933706
- [ ] James 가 support@ 받은편지함에서 SNS 구독을 확인하면 다음 주기에 ok:true 로 전이

# james
SNS 구독 확인 메일(support@insighta.one) 클릭 — 이 검사가 초록이 되는 유일한 남은 조건.

# restated
기준선 7가지 사실을 30분마다 읽어 하나라도 어긋나면 이름을 붙여 알린다. 지금 어긋난 것은 알림 구독 미확인 하나뿐이다.

# 결과
2026-09-11 (자율 루프 2차)
- 머지 #1641(424e6d90, merge-green). `scripts/keel/check-cloud-posture.ts` + 테스트 7(로컬 7/7, CI 백엔드 잡 통과). 보안 문서 3곳(카탈로그 ICS-OBS-02 3/5 · 아키텍처 §7 검사표 · CI 역할 서술)을 구현 사실로 교정.
- 라이브(로컬 자격증명, 21:20 KST): trail logging · 알람 8 armed · EBS on · 비밀번호 14 · 감사 버킷 4/4 차단 · SNS confirmed 0 pending 1 → ok:false "alert topic has no confirmed subscription (pending 1)".
- CI 역할(OIDC `insighta-github-actions`)로도 동일: dispatch run 34598933706(21:27 KST) "cloud-posture: alert topic has no confirmed subscription (pending 1)" — 읽기 7종 전부 AccessDenied 없음. 남은 것 = James 의 SNS 구독 확인(QUESTIONS).
- prod 원장 실측(`scripts/ops/keel-ledger.sh cloud-posture`): 21:28 KST 행 "alert topic has no confirmed subscription (pending 1)" severity error. supply-chain 21:20 · 21:27 행도 npm audit 수치.
- 롤백: `ALL_CHECKS` 에서 `checkCloudPosture` 제거. 권한 변경 없음.
