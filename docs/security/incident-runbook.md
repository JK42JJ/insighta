# 사고 대응 런북 v1

대상: 운영자 1명 + CC. 원칙: **격리 → 조사 → 복구 → 기록** 순서. 조사보다 격리가 먼저다. 모든 단계의 시각과 명령을 `docs/security/incidents/<date>-<slug>.md` 에 남긴다. 값(키 · 토큰)은 어디에도 적지 않는다.

## 공통 도구

- 누가 · 언제 · 무엇을: `aws cloudtrail lookup-events --lookup-attributes AttributeKey=Username,AttributeValue=<user> --start-time <iso>` (Stage 1 이후). 트레일 이전 기간은 90일 이벤트 히스토리만.
- 키 비활성: `aws iam update-access-key --user-name <u> --access-key-id <id> --status Inactive` (삭제는 조사 후).
- 세션 무효화: 사용자 인라인 정책 `AWSRevokeOlderSessions`(`aws:TokenIssueTime` 조건 Deny) 부착.
- 클러스터: `scripts/ops/ssh.sh k3s "sudo k3s kubectl -n insighta-prod get pods -o wide"`.
- 원장: `error_events` (`subsystem='security'`) 에 사건 · 조치 기록.

## 시나리오 1 — AWS 자격증명 유출 의심 (secret-scanning alert · 낯선 리전 활동 · 요금 급증)

1. 격리: 해당 키 Inactive. CI 키면 워크플로가 멈추므로 곧바로 OIDC 역할로 대체(Stage 1 이후에는 정적 키가 없다).
2. 조사: `lookup-events` 로 해당 키의 최근 24시간 호출 목록. `RunInstances` · `CreateUser` · `CreateAccessKey` · `PutBucketPolicy` 가 있으면 생성물 삭제.
3. 복구: 새 키 발급(필요 시) → GitHub Secrets 갱신 → 배포 1회 확인.
4. 기록: 노출 경로 · 사용 흔적 유무 · 삭제한 리소스 · 소요 시간.

## 시나리오 2 — 알람: root 사용 · MFA 없는 콘솔 로그인 · AccessDenied 급증

1. root 사용: James 본인이 아니면 root 비밀번호 즉시 변경 · MFA 재등록 · 결제 정보 확인. 본인이면 사유를 기록하고 root 대신 admin 을 쓴다.
2. MFA 없는 로그인: 본인 로그인이면 MFA 등록을 완료한다(Stage 1). 아니면 비밀번호 변경 · 활성 세션 무효화 · `lookup-events` 로 그 세션의 호출 확인.
3. AccessDenied 급증: `lookup-events` 로 Username 확인. CI 러너의 권한 부족이면 정책을 고치고 알람 임계는 유지한다. 낯선 주체면 시나리오 1.

## 시나리오 3 — GuardDuty 심각도 ≥ 7

1. finding 유형 확인: `aws guardduty get-findings --detector-id <id> --finding-ids <id>`.
2. `UnauthorizedAccess:IAMUser/*` · `CredentialAccess` 류 → 시나리오 1. `CryptoCurrency` · `Backdoor` 류 → 해당 인스턴스 SG 를 인바운드 0 · 아웃바운드 0 인 격리 SG 로 교체 후 조사. 노드는 IaC 로 재생성한다(`enable_k3s_node` 재적용).
3. 오탐이면 finding 을 archive 하고 사유 기록.

## 시나리오 4 — GitHub secret-scanning 새 alert

1. 값이 현재 사용 중인지 해시로 대조(값을 출력하지 않는다): `git show <sha>:<path> | ... | sha256sum` vs 실행 환경의 `printf %s "$VAR" | sha256sum`.
2. 사용 중이면 회전: 발급처 → GitHub Secrets → 배포 → 옛 값 폐기 → alert `revoked`.
3. 사용 중이 아니면 발급처에서 폐기 여부 확인 후 alert `revoked`. 히스토리 재작성은 하지 않는다(기존 정책: 공개 리포 기존 노출 수용, 추가 금지).

## 시나리오 5 — Supabase 키 · Google OAuth secret 노출

1. Supabase service key: 대시보드에서 새 secret key 발급 → 백엔드 · Edge Function 시크릿 갱신 → 레거시 키 비활성. 사용자 세션에는 영향 없음.
2. Google OAuth client secret: GCP 콘솔에서 secret 재발급 → Supabase Auth Google provider 갱신 → Edge Function `youtube-auth` 시크릿 갱신 → 로그인 · YouTube 연동 E2E 1회.

## 시나리오 6 — 서비스 침해 의심 (비정상 트래픽 · 데이터 변조)

1. 격리: 인그레스에서 해당 경로 차단(rate-limit 인그레스 값 0 또는 `nginx.ingress.kubernetes.io/whitelist-source-range`).
2. 조사: 인그레스 액세스 로그(`$host` 포함) · `admin_audit_log` · `bot_usage_log` · `error_events`.
3. 복구: 최신 백업 복원(`reference_db_daily_backup.md` 절차) 또는 차트 태그 롤백.
4. 사용자 영향이 있으면 공지(`app_notices`).

## 사후

- 24시간 안에 사건 파일 작성, 카탈로그의 관련 통제 상태 갱신, 재발 방지 항목을 설계 §5 의 다음 단계에 등록.
