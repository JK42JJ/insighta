# Insighta Cloud Security Standard v1 — 통제 카탈로그

기준일 2026-09-11. 설계 근거는 `cloud-security-architecture-2026-09-11.md`. 통제 1건 = 목표 · 구현 · 측정 · 시정 · 증거 5항목. 하나라도 비면 상태는 "미완".
상태: ● 운영 중 · ◐ 부분 · ○ 미구현. Stage 는 ROI 단계(설계 §5): S1 자격증명·감사 · S2 워크로드·복원·관측 · S3 규모 트리거. 비어 있으면 현행 유지. 기준 열은 CIS AWS v3.0 / CIS K8s / OWASP ASVS / OWASP LLM 항목.

## ACC — 계정·거버넌스

| ID | 통제 | 구현 | 측정 | 시정 | 증거 | 상태 | Stage | 기준 |
|---|---|---|---|---|---|---|---|---|
| ICS-ACC-01 | 모든 API 호출 기록 | CloudTrail 멀티리전 trail, S3 `insighta-audit-logs`, 무결성 검증 | Config `cloudtrail-enabled` | 알림 | trail ARN | ● | S1 | CIS 3.1 |
| ICS-ACC-02 | 구성 준수 상시 판정 | AWS Config recorder + 관리형 규칙 13 | Config 대시보드, Keel `cloud-posture` | 규칙별 remediation | recorder 이름 | ○ | S3 | CIS 3.3 |
| ICS-ACC-03 | CSPM 표준 점수 | Security Hub FSBP | 보안 점수, FAILED 수 | 알림 | hub ARN | ○ | S3 | — |
| ICS-ACC-04 | 위협 탐지 | GuardDuty 탐지기 | 심각도 ≥ 7 findings | 알림 | detector ID | ● | S1 | CIS 4.16 |
| ICS-ACC-05 | 외부 접근 분석 | IAM Access Analyzer | active findings | 알림 | analyzer ARN | ● | S1 | CIS 1.20 |
| ICS-ACC-06 | root 보호 | root MFA, 액세스 키 없음 | credential report, Config `root-account-mfa-enabled` | 알림 | 리포트 행 | ● | — | CIS 1.5 |
| ICS-ACC-07 | 비밀번호 정책 | 14자·복잡도·90일·재사용 24회 금지 | Config `iam-password-policy` | 알림 | 정책 JSON | ● | S1 | CIS 1.8–1.9 |
| ICS-ACC-08 | 보안 이벤트 알림 경로 | EventBridge → SNS → 이메일(+Slack) | 구독 상태 | — | 토픽 ARN | ◐ (구독 확인 대기) | S1 | CIS 4.x |
| ICS-ACC-09 | 비용 이상 감시 | Keel `aws-cost`(현행) | 일일 비용 | 알림 | `scripts/keel/checks.ts` | ● | — | — |

## IAM — 신원·특권 접근

| ID | 통제 | 구현 | 측정 | 시정 | 증거 | 상태 | Stage | 기준 |
|---|---|---|---|---|---|---|---|---|
| ICS-IAM-01 | CI 정적 자격증명 0 | GitHub OIDC provider + 역할 `insighta-github-actions` | Keel `iam-hygiene`(정적 키 수) | 키 비활성 | 역할 ARN, 워크플로 diff | ● | S1 | CIS 1.4 |
| ICS-IAM-02 | 콘솔 사용자 MFA 강제 | `RequireMFA` 정책 + 가상 MFA | Config `iam-user-mfa-enabled` | 알림 | 정책 ARN | ◐ (정책 생성, MFA 등록 대기) | S1 | CIS 1.10 |
| ICS-IAM-03 | 액세스 키 90일 회전 | 정책 + Config remediation | Config `access-keys-rotated` | 90일 초과 키 자동 비활성 | 규칙 이름 | ○ | S1(측정 S3) | CIS 1.14 |
| ICS-IAM-04 | 휴면 자격증명 제거 | 90일 미사용 비활성 | Config `iam-user-unused-credentials-check` | 자동 비활성 | 규칙 이름 | ● | S1 | CIS 1.12 |
| ICS-IAM-05 | CI 최소권한 정책 | 문장 단위 정책 3개, IAM 읽기만 | 정책 시뮬레이션 | PR 리뷰 | `terraform/global/iam-ci/main.tf` | ● | — | CIS 1.16 |
| ICS-IAM-06 | 노드 역할 최소권한 | `insighta-k3s-node`: CloudWatch + ECR pull + SSM 코어 + SSM 파라미터 경로 | 정책 시뮬레이션 | PR 리뷰 | 역할 ARN | ◐ | S3 | CIS 1.16 |
| ICS-IAM-07 | 특권 세션 감사 | 세션 로그(Tailscale SSH 세션 기록 또는 SSM → CloudWatch Logs) 90일 | 로그 그룹 존재, 세션 수 | — | 로그 그룹 이름 | ○ | S3 | — |
| ICS-IAM-08 | 이미지 pull 자격증명 없음 | 인스턴스 프로파일 + kubelet credential provider | `imagePullSecrets: []` | — | `scripts/ops/k3s-node-setup.sh:24-37` | ● | — | — |
| ICS-IAM-09 | CI 로그 식별자 마스킹 | `::add-mask::` 계정 ID·레지스트리 | 워크플로 로그 | — | `.github/workflows/deploy.yml:255-260` | ● | — | — |

## NET — 네트워크·엣지

| ID | 통제 | 구현 | 측정 | 시정 | 증거 | 상태 | Stage | 기준 |
|---|---|---|---|---|---|---|---|---|
| ICS-NET-01 | 인바운드 최소화 | SG 80/443 만 공개, 제어평면 자기 SG | Config `restricted-ssh` | 22 전체 공개 시 자동 revoke | SG ID | ● (22 목록 2건) | S1(정리) | CIS 5.2 |
| ICS-NET-02 | 인바운드 SSH 0 | 신원 기반 접근(Tailscale SSH 또는 SSM) 전환, SG 22 규칙 제거 | SG 22 규칙 수 | — | SG 규칙 diff | ○ | S3 | CIS 5.2 |
| ICS-NET-03 | default SG 폐쇄 | default SG 인바운드·아웃바운드 제거 | Config `vpc-default-security-group-closed` | 자동 | SG ID | ○ | S3 | CIS 5.4 |
| ICS-NET-04 | TLS 자동 발급·갱신 | cert-manager ClusterIssuer `letsencrypt` | Keel `public-surface`(만료 14일) | 알림 | `charts/insighta/environments/prod.yaml:143-152` | ● | — | ASVS 9.1 |
| ICS-NET-05 | HSTS·보안 헤더 | ingress-nginx `add-headers` | 응답 헤더 | — | `charts/bootstrap/ingress-nginx-config.yaml:37-70` | ● | — | ASVS 14.4 |
| ICS-NET-06 | 엣지 rate limit | 인그레스 `/api` 30 rps | 429 비율 | — | `charts/insighta/templates/ingress.yaml:73-127` | ● | — | ASVS 11.1 |
| ICS-NET-07 | 관리 콘솔 미노출 | ArgoCD·Grafana SSH/SSM 터널, `/keel` basic-auth | 공개 포트 스캔(Keel `public-surface`) | — | `scripts/ops/argocd-ui.sh` | ● | — | — |
| ICS-NET-08 | 인스턴스 메타데이터 보호 | IMDSv2 required, hop 2 | Config `ec2-imdsv2-check` | — | `terraform/modules/k3s-node/main.tf:76-80` | ● | S3(측정) | CIS 5.6 |
| ICS-NET-09 | 아웃바운드 제한 | 워크로드 단위 NetworkPolicy egress(§K8S) | netpol 수 | — | 매니페스트 | ○ | S3 | — |

## K8S — 클러스터·워크로드

| ID | 통제 | 구현 | 측정 | 시정 | 증거 | 상태 | Stage | 기준 |
|---|---|---|---|---|---|---|---|---|
| ICS-K8S-01 | Pod Security Admission | `insighta-prod` enforce=baseline → restricted | Keel `k8s-hardening` | 배포 거부 | ns 라벨 | ○ | S3 | CIS K8s 5.2 |
| ICS-K8S-02 | securityContext 표준 | non-root · no privesc · drop ALL · seccomp · RO rootfs | Keel `k8s-hardening`(non-root 비율) | 배포 거부(PSA) | `_helpers.tpl` | ○ | S2 | CIS K8s 5.2 |
| ICS-K8S-03 | 전용 ServiceAccount | 워크로드별 SA, automount off | `get pods -o custom-columns` | — | 매니페스트 | ◐ | S2 | CIS K8s 5.1 |
| ICS-K8S-04 | 워크로드 격리 | NetworkPolicy default-deny + 명시 허용 | 격리 테스트(frontend→redis 실패) | — | 매니페스트, 테스트 로그 | ○ | S3 | CIS K8s 5.3 |
| ICS-K8S-05 | 시크릿 원본을 etcd 밖에 | ESO + SSM Parameter Store SecureString | `ExternalSecret` READY | 재동기화 | 파라미터 경로 | ○ | S3 | CIS K8s 5.4 |
| ICS-K8S-06 | RBAC 최소권한 | AppProject 한정, 훅 RBAC resourceNames, 메트릭 읽기전용 | clusterrolebinding 검토 | PR 리뷰 | `charts/bootstrap/projects.yaml`, `keel-provision.yaml:40-60` | ● | — | CIS K8s 5.1 |
| ICS-K8S-07 | 이미지 무결성 | ECR IMMUTABLE + digest 핀 | ECR 설정, 차트 값 | — | terraform, `prod.yaml` | ○ | S3 | — |
| ICS-K8S-08 | 컨테이너 non-root 이미지 | `USER appuser`(1001) | Dockerfile | — | `Dockerfile:80`, `frontend/Dockerfile:85` | ● | — | CIS Docker 4.1 |
| ICS-K8S-09 | 리소스 상한 | requests/limits 전 워크로드 | `get pods` | — | `charts/insighta/values.yaml` | ● | — | CIS K8s 5.7 |
| ICS-K8S-10 | 노드 디스크 암호화 | EBS 기본 암호화 + 루트 볼륨 교체 | Config `encrypted-volumes` | — | 볼륨 ID | ◐ (기본값 on, 루트 볼륨 S3) | S1(기본값)·S3(교체) | CIS 2.2.1 |
| ICS-K8S-11 | kubeconfig 권한 | `write-kubeconfig-mode 0600` | 파일 모드 | — | 노드 설정 | ○ | S2 | CIS K8s 4.1 |
| ICS-K8S-12 | 호스트 패치 | unattended-upgrades | 서비스 상태 | — | 실측 | ● | — | — |
| ICS-K8S-13 | GitOps 경계 | prod selfHeal, prune off, 자동 sync 는 무트래픽 클러스터만 | ArgoCD 앱 상태 | — | `charts/bootstrap/applications.yaml` | ● | — | — |

## DATA — 데이터

| ID | 통제 | 구현 | 측정 | 시정 | 증거 | 상태 | Stage | 기준 |
|---|---|---|---|---|---|---|---|---|
| ICS-DATA-01 | 데이터 인벤토리·분류 | `data-inventory.md` | 분기 갱신 | — | 문서 | ○ | S3 | ASVS 8.3 |
| ICS-DATA-02 | RLS 커버리지 | 테이블별 RLS + CI 게이트 | `check-rls-coverage.sh` | CI FAIL | 스크립트, 게이트 로그 | ◐ | S3 | — |
| ICS-DATA-03 | 관측 경로 읽기전용 | `keel_read` role + 테이블별 RLS 정책, PreSync 훅 생성 | 훅 로그 | 회전 | `charts/insighta/files/keel-provision.js:190-229` | ● | — | — |
| ICS-DATA-04 | 사용자 비밀 저장 암호화 | LLM 키 AES-256-GCM, OAuth 토큰 `ENCRYPTION_SECRET` | 코드 | 회전 절차 | `src/modules/settings/llm-keys.ts` | ● | — | ASVS 6.2 |
| ICS-DATA-05 | 백업 | 일일 pg_dump → S3(SSE·버저닝·PAB·30일), 실패 이슈 | 워크플로 결과 | 이슈 | `.github/workflows/backup.yml` | ● | — | CIS 2.x |
| ICS-DATA-06 | 복원 리허설 | 분기 1회, 기록 | `restore-drills.md` | — | 기록 | ○ | S2 | — |
| ICS-DATA-07 | 저장소 공개 차단 | S3 PAB 4/4 + SSE | Config `s3-bucket-public-read-prohibited` | 자동 PAB | 버킷 설정 | ◐ (`insighta-cost-reports` BlockPublicPolicy off, `jk-commerce` PAB 없음) | S3 | CIS 2.1.4 |
| ICS-DATA-08 | 전송 암호화 | TLS 엣지, DB `sslmode=require`, Supabase SSL 강제 | 설정 | — | 차트, 대시보드 | ◐ | S2 | ASVS 9.1 |
| ICS-DATA-09 | DB 네트워크 제한 | Supabase network restrictions | 대시보드 | — | 설정 스크린샷 | ○ | S3 | — |
| ICS-DATA-10 | 사용자 데이터 삭제·export | 삭제 9 테이블(현행) + 서버측 전체 export + 계정 삭제 옵션 | 엔드포인트 테스트 | — | `src/api/routes/settings.ts` | ◐ | S3 | ASVS 8.3 |
| ICS-DATA-11 | 관리자 행위 감사 | `admin_audit_log` | 테이블 | — | `src/api/routes/admin/audit.ts` | ● | — | ASVS 7.1 |
| ICS-DATA-12 | 노출 이력 종결 | secret-scanning alert 4건 회전 대조·종결, push protection | `gh api` open 0 | 회전 | alert 번호 | ◐ (4건 중 1 종결, OAuth 재발급 대기) | S1 | — |

## SC — 공급망·CI/CD

| ID | 통제 | 구현 | 측정 | 시정 | 증거 | 상태 | Stage | 기준 |
|---|---|---|---|---|---|---|---|---|
| ICS-SC-01 | 이미지 취약점 게이트 | Trivy CI(CRITICAL fail) + ECR scanOnPush | Keel `supply-chain` | CI FAIL | 워크플로 | ◐ | S3 | — |
| ICS-SC-02 | 의존성 취약점 게이트 | Dependabot + `npm audit --audit-level=high`(기준선) | Keel `supply-chain` | CI FAIL | 워크플로 | ◐ (alerts on) | S3 | — |
| ICS-SC-03 | 액션 SHA 핀 | 서드파티 액션 commit SHA | grep | — | 워크플로 | ○ | S3 | — |
| ICS-SC-04 | 브랜치 보호 | 필수 체크 8, force-push 차단 | `gh api` | — | 설정 | ◐ | — | — |
| ICS-SC-05 | 시크릿 유출 방지 | secret scanning + push protection | `gh api` | 회전 | 설정 | ● (push protection on) | S1 | — |
| ICS-SC-06 | IaC 상태 보호 | S3 backend 버저닝·SSE + DynamoDB lock | 설정 | — | `versions.tf` | ● | — | — |
| ICS-SC-07 | IaC 변경 검토 | plan-in-PR, 일일 드리프트 검사 | 이슈 | — | `.github/workflows/terraform.yml` | ● | — | — |
| ICS-SC-08 | 하드코딩 감사 | `hardcode-audit`(7 규칙, 기준선 감소만) | CI | CI FAIL | `scripts/audit/hardcode-audit.ts` | ● | — | — |
| ICS-SC-09 | 배포 검증 | 스키마 push 후 테이블 존재 검증, 이미지 SHA 태그 | CI | 롤백 워크플로 | `.github/workflows/deploy.yml:338-374` | ● | — | — |

## APP — 애플리케이션 (ASVS)

| ID | 통제 | 구현 | 측정 | 시정 | 증거 | 상태 | Stage | 기준 |
|---|---|---|---|---|---|---|---|---|
| ICS-APP-01 | 토큰 검증 | JWT ES256/JWKS verify-only, 401 분류 | 401 테스트 73건 | — | `src/api/plugins/auth.ts` | ● | — | ASVS 3.5 |
| ICS-APP-02 | 관리자 경계 | `is_super_admin` 가드 101/102 | `tests/smoke/admin-api.test.ts` | — | `src/api/plugins/admin-auth.ts` | ● | — | ASVS 4.1 |
| ICS-APP-03 | 봇 권한 분리 | 1회용 승인 토큰, 전 요청 로그 | 테스트 | — | `src/api/plugins/bot-write-guard.ts` | ● | — | ASVS 4.2 |
| ICS-APP-04 | 입력 검증 | zod + JSON schema, 파라미터 바인딩 SQL | 테스트 | — | `src/api/schemas/` | ● | — | ASVS 5.1 |
| ICS-APP-05 | 토큰 로그 마스킹 | pino req serializer | 로그 | — | `src/api/utils/log-url-sanitizer.ts` | ● | — | ASVS 7.1 |
| ICS-APP-06 | 앱 rate limit | tier-1/2(현행) + tier-3 라우트별 배선 | 429 비율 | — | `src/api/plugins/rate-limit.ts` | ◐ | S2 | ASVS 11.1 |
| ICS-APP-07 | 공유 비밀 상수시간 비교 | `crypto.timingSafeEqual` | 코드 | — | `src/config/internal-auth.ts` | ○ | S2 | ASVS 6.2 |
| ICS-APP-08 | 프론트엔드 CSP | nginx CSP 헤더(nonce 또는 hash) | 응답 헤더 | — | `frontend/nginx/nginx.conf.template` | ○ | S3 | ASVS 14.4 |
| ICS-APP-09 | 요청 크기 상한 | Fastify `bodyLimit` 명시 + 엣지 10 MB | 설정 | — | `src/api/server.ts` | ◐ | S3 | ASVS 12.1 |

## AI — LLM 워크로드 (OWASP LLM)

| ID | 통제 | 구현 | 측정 | 시정 | 증거 | 상태 | Stage | 기준 |
|---|---|---|---|---|---|---|---|---|
| ICS-AI-01 | 비신뢰 콘텐츠 격리 | 구분자 템플릿 + 지시 무시 규칙 + 인젝션 휴리스틱 기록 | `error_events` 건수 | — | 모듈 경로 | ○ | S3 | LLM01 |
| ICS-AI-02 | 출력 가드 | 시스템 프롬프트 지문·키 패턴 마스킹 | 발화 수 | — | 모듈 경로 | ○ | S3 | LLM06 |
| ICS-AI-03 | 소비 통제 | 비용 게이트 L1–L5 + 크레딧 차단기 + 사용자별 10/min | Keel `llm-spend` | 차단 | `src/modules/llm/cost-gate.ts` | ◐ | S2 | LLM10 |
| ICS-AI-04 | 모델·프로바이더 allowlist | zod config | 부팅 검증 | 부팅 실패 | `src/config/` | ○ | S3 | LLM03 |
| ICS-AI-05 | 호출 원장 | `llm_call_logs` 44 지점 | 원장 | — | `src/modules/llm/call-logger.ts` | ● | — | — |
| ICS-AI-06 | 프롬프트 로그 PII 마스킹 | 로거 마스킹 | 로그 샘플 | — | 모듈 경로 | ○ | S3 | LLM06 |

## OBS — 관측·대응

| ID | 통제 | 구현 | 측정 | 시정 | 증거 | 상태 | Stage | 기준 |
|---|---|---|---|---|---|---|---|---|
| ICS-OBS-01 | 불변식 상시 검사 | Keel 8검사/30분, 원장, 전이 알림 | 원장 | — | `scripts/keel/checks.ts` | ● | — | — |
| ICS-OBS-02 | 보안 자세 검사 | Keel `cloud-posture` · `iam-hygiene` · `k8s-hardening` · `supply-chain` · `secret-exposure` | 원장 | — | 체크명 | ○ | S2(2종)·S3(3종) | — |
| ICS-OBS-03 | 보안 대시보드 | Grafana `/keel/` 보안 패널 6 | 패널 | — | 대시보드 JSON | ○ | S2 | — |
| ICS-OBS-04 | 자동 시정 검증 | 위반 주입 → 시정 → 원장 한 바퀴 | 기록 | — | 검증 로그 | ○ | S3 | — |
| ICS-OBS-05 | 알림 채널 | SNS 이메일(+Slack) | 구독 | — | 토픽 ARN | ◐ (구독 확인 대기) | S1 | — |

## 예외 등록부

| 대상 | 통제 | 사유 | 만료 |
|---|---|---|---|
| node-exporter hostPath `/proc` `/sys` `/` | ICS-K8S-01 restricted | 호스트 지표 수집에 필수. 읽기전용 마운트, 전용 SA | 분기 검토 |
| `INTERNAL_BATCH_TOKEN` (Mac Mini) | ICS-IAM-01 정적 자격증명 | 기기가 AWS 신원을 가질 수 없음. 상수시간 비교 + 회전 절차 | 분기 검토 |
| S3 SSE-S3 (KMS 미사용) | ICS-DATA-07 | 단일 계정·단일 운영자에서 KMS 키 정책이 주는 추가 경계가 없고 비용·복잡도만 증가 | 조직 확장 시 |
