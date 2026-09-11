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
- 비용 0. 새 서비스 없음. AWS 는 credential report(무료), 취약점은 두 lockfile 의 `npm audit --package-lock-only`(설치 · 토큰 없음). Dependabot alerts API 는 워크플로 토큰으로 거부되어(#1638) 쓰지 않는다.
- CI 역할에는 읽기 권한만 추가(`terraform/global/iam-ci/security-read.tf`, 수동 apply).
- 알림은 기존 전이 규칙(edge-triggered) 그대로.

# 검증 기준
- [x] `iam-hygiene`: 로컬 실행 시 현재 상태를 정확히 보고(콘솔 사용자 MFA 없음 1 = admin, 90일 초과 활성 키 1 = admin) → `ok:false` + detail 에 사용자명
- [x] `supply-chain`: 두 lockfile 의 npm audit critical/high 를 세어 0 이 아니면 `ok:false`
- [x] keel.yml 예약 실행에서 `iam-hygiene` 이 돌아 ok:false 를 남김 — 2026-09-11 20:47 KST, run 34595765253
- [x] keel.yml 실행에서 `supply-chain` 이 npm audit 수치를 남김 — 2026-09-11 21:20 KST dispatch run 34598333951: "backend critical 1 high 13 · frontend critical 2 high 16" (로컬 실측과 일치)
- [x] CI 역할로 `aws iam get-credential-report` 가 AccessDenied 없이 됨 — 위 예약 실행이 OIDC 역할로 보고서를 읽음

# james
없음.

# restated
credential report 와 Dependabot API 를 30분마다 읽어 MFA 없는 콘솔 사용자 · 90일 초과 키 · 미사용 키 · critical/high 취약점 수를 원장에 남기고, 기준을 넘으면 알린다. 비용 0, 읽기 권한만.

# 결과
2026-09-11 (자율 루프 2차)
- `scripts/keel/checks.ts` 에 `checkIamHygiene` · `checkSupplyChain` 추가, `ALL_CHECKS` 등록(8 → 10) — #1634. 이어 #1638: supply-chain 을 Dependabot API(워크플로 토큰이 거부)에서 npm audit 로 교체, `keel.yml` 의 `security-events` · `GH_TOKEN` 제거, TS4111 수정. #1634 는 백엔드 타입 검사가 실패한 채 머지됐다 — 머지 전에 검사 결과를 읽는다.
- CI 역할 읽기 권한 6종 추가(`security-read.tf`, 수동 apply). 정책 시뮬레이션: `iam:GenerateCredentialReport` · `iam:GetCredentialReport` = allowed.
- 로컬 실측: `iam-hygiene` → ok:false "console without MFA: admin · keys over 90d: admin:key1:189d" (현 상태와 일치) · `supply-chain` → ok:false "critical 7, high 103" (Dependabot 화면과 일치; npm audit 판 · #1636 이후 실측 = 백엔드 critical 1 · high 13, 프론트엔드 critical 2 · high 16).
- 예약 실행 확인: 2026-09-11 20:47 KST(run 34595765253) 에서 `iam-hygiene` 이 OIDC 역할로 credential report 를 읽어 ok:false 를 남김. `supply-chain` 은 그 시점 main 이 Dependabot API 판이라 "alerts unavailable"; #1638 머지 후 dispatch run 34598333951(21:20 KST)에서 npm audit 수치로 기록됨 → 검증 완료. `cloud-posture` 는 `WO-2026-09-11-keel-cloud-posture`(#1641). 나머지 2종(k8s-hardening · secret-exposure)은 S3.
- 롤백: 두 함수 등록 해제. 권한은 읽기 전용이라 유지해도 무해.
- 첫 CI 실행(#1634 머지 직후 dispatch, run 34595765253): `iam-hygiene` 원장 행 기록 ✔ ("console without MFA: admin · keys over 90d: admin:key1:189d"). `supply-chain` 은 Dependabot API 가 GITHUB_TOKEN 을 거부("Resource not accessible by integration") → package-lock audit(두 lockfile) 로 소스 교체(#1638). 같은 PR 에서 TS4111(scripts/ 는 tsc include 밖, ts-jest 만 검사) 수정 — #1634 를 failing 체크 상태로 머지한 실수의 교정.
