---
id: WO-2026-09-11-keel-security-checks
status: verified
owner: insighta-session
opened: 2026-09-11
---

# 목표
보안 자세가 되돌아가면(키 노화 · MFA 해제 · 새 취약점) 사람이 아니라 Keel 이 30분 안에 안다.

# 맥락
`docs/security/cloud-security-architecture-2026-09-11.md` §5 Stage 2 Detect · `docs/security/control-catalog.md` ICS-OBS-02. Keel 검사 계약 = `scripts/keel/lib.ts` `CheckResult`, 등록 = `scripts/keel/checks.ts` `ALL_CHECKS`. 러너는 OIDC 역할 `insighta-github-actions` 로 AWS 를 부른다.

# 제약
- 비용 0. 새 서비스 없음. AWS 는 credential report(무료), GitHub 는 Dependabot alerts API.
- CI 역할에는 읽기 권한만 추가(`terraform/global/iam-ci/security-read.tf`, 수동 apply).
- 알림은 기존 전이 규칙(edge-triggered) 그대로.

# 검증 기준
- [ ] `iam-hygiene`: 로컬 실행 시 현재 상태를 정확히 보고(콘솔 사용자 MFA 없음 1 = admin, 90일 초과 활성 키 1 = admin) → `ok:false` + detail 에 사용자명
- [ ] `supply-chain`: Dependabot open critical/high 를 세어 0 이 아니면 `ok:false`
- [ ] keel.yml 에서 두 검사가 실행되어 `error_events` 에 행이 남음(머지 후 1회 실행)
- [ ] CI 역할로 `aws iam get-credential-report` 가 AccessDenied 없이 됨

# james
없음.

# restated
credential report 와 Dependabot API 를 30분마다 읽어 MFA 없는 콘솔 사용자 · 90일 초과 키 · 미사용 키 · critical/high 취약점 수를 원장에 남기고, 기준을 넘으면 알린다. 비용 0, 읽기 권한만.

# 결과
2026-09-11 (자율 루프 2차)
- `scripts/keel/checks.ts` 에 `checkIamHygiene` · `checkSupplyChain` 추가, `ALL_CHECKS` 등록(8 → 10). `keel.yml` 에 `security-events: read` 와 `GH_TOKEN` 배선.
- CI 역할 읽기 권한 6종 추가(`security-read.tf`, 수동 apply). 정책 시뮬레이션: `iam:GenerateCredentialReport` · `iam:GetCredentialReport` = allowed.
- 로컬 실측: `iam-hygiene` → ok:false "console without MFA: admin · keys over 90d: admin:key1:189d" (현 상태와 일치) · `supply-chain` → ok:false "critical 7, high 103" (Dependabot 화면과 일치).
- 미검증: keel.yml 안에서의 실행(머지 후 다음 30분 주기에 `error_events` 행으로 확인). 나머지 3종(cloud-posture · k8s-hardening · secret-exposure)은 S3.
- 롤백: 두 함수 등록 해제. 권한은 읽기 전용이라 유지해도 무해.
