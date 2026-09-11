# Insighta 클라우드 보안 아키텍처 — 진단과 목표 설계

작성 2026-09-11. 실측 기준: AWS 계정 `424428551371` (us-west-2), k3s 클러스터, Supabase Cloud, GitHub `JK42JJ/insighta` (origin/main `00c5c302`).
측정 방법은 §9 에 명령 단위로 기록. 값은 전부 실측이며 추정치는 "추정" 으로 표기한다.

## 0. 목적과 범위

- 목적: Insighta 프로덕션의 보안 구조를 7개 영역(Cloud Security Architecture · CSPM/CNAPP · IAM/PAM · Zero Trust · Cloud Native Security · DSPM/Data Security · AI Security)으로 진단하고, 목표 아키텍처·기술 표준·구현 로드맵을 정의한다.
- 범위: AWS 계정, k3s 클러스터(1 노드), Supabase Cloud(DB·Auth), GitHub 리포·CI/CD, 애플리케이션(API·프론트엔드·Edge Function). Mac Mini 수집기는 제외(별도 문서).
- 산출물: 본 문서(설계) → Phase 별 PR(구현) → §7 증거표(리소스 ID·파일·PR·Keel 체크명). 증거표는 구현 시 갱신한다.

## 1. 현 구조 (2026-09-11 실측)

### 1.1 구조도

```
인터넷 ─443/80─▶ Elastic IP ─▶ ingress-nginx
                               TLS: cert-manager · Let's Encrypt (ClusterIssuer letsencrypt, 만료 감시 Keel)
                               HSTS 2년 preload · 보안 헤더 4종 · /api 30 rps · /keel basic-auth
                               │
        k3s v1.36.3 · 1 노드 t3.medium · IMDSv2 required · ns insighta-prod
        ├─ frontend ×3 (nginx)   ┐ ServiceAccount default · securityContext 없음
        ├─ api ×2 (Fastify)      │ NetworkPolicy 없음 · Pod Security Admission 없음
        ├─ worker ×1             │ 시크릿 4개 = etcd base64 (암호화 Disabled)
        ├─ redis (StatefulSet)   ┘
        └─ VictoriaMetrics · Grafana(non-root) · kube-state-metrics · node-exporter(hostPath /proc /sys /)
                 │ sslmode=require · 읽기전용 role keel_read (RLS 정책, PreSync 훅 생성)
        Supabase Cloud ── PostgreSQL(pooler) · Auth(Google OAuth + Email) · JWT ES256(JWKS)
        S3 ── insighta-backups(SSE-S3 · 버저닝 · PAB 4/4 · 30일) · insighta-terraform-state(버저닝 · SSE · DynamoDB lock)
        ECR ×3 ── scanOnPush(BASIC) · 태그 MUTABLE · 노드 인스턴스 프로파일로 pull(pull secret 없음)
             ▲
        GitHub Actions ── 정적 IAM 키(사용자 github-actions-terraform, 생성 2026-03-06) · OIDC 없음
        운영자 접근 ── SSH 22 allow-list(/32 ×15 + VPC CIDR) · kubectl/ArgoCD/Grafana = SSH 경유(인터넷 미노출)
계정 계층 ── CloudTrail trail 0 · GuardDuty 0 · AWS Config 0 · Security Hub 0 · Access Analyzer 0
             root MFA 활성 · IAM 사용자 3(MFA 0/3) · 비밀번호 정책 없음 · EBS 기본 암호화 off
```

### 1.2 계층별 통제 현황

표기: ● 있음 · ◐ 부분 · ○ 없음. 증거는 파일 경로(origin/main) 또는 실측 명령.

| 계층 | 통제 | 상태 | 실측 값 / 증거 |
|---|---|---|---|
| 계정 | API 감사 로그 (CloudTrail trail) | ○ | `describe-trails` = `[]`. 90일 이벤트 히스토리만 존재 |
| 계정 | 위협 탐지 (GuardDuty) | ○ | `list-detectors` = `[]` |
| 계정 | 구성 준수 판정 (AWS Config) | ○ | recorder 0 |
| 계정 | CSPM 표준 점수 (Security Hub) | ○ | 미구독 |
| 계정 | 외부 접근 분석 (Access Analyzer) | ○ | analyzer 0 |
| 계정 | root 보호 | ● | root MFA 활성, root 액세스 키 없음 (credential report) |
| 계정 | 비밀번호 정책 | ○ | `NoSuchEntity` |
| 계정 | EBS 기본 암호화 | ○ | `EbsEncryptionByDefault=false`, 루트 볼륨 20 GB `Encrypted=False` |
| IAM | 사람 계정 MFA | ○ | `admin`(AdministratorAccess, 콘솔 비밀번호) MFA 없음 |
| IAM | CI 자격증명 | ◐ | 정적 키 189일, OIDC provider 0, 워크플로 5개가 `TF_AWS_*` 사용. 정책은 최소권한으로 문장 단위 작성 (`terraform/global/iam-ci/main.tf:21-202`, IAM 은 Get/List 만) |
| IAM | 휴면 자격증명 | ○ | `slidegen-prh` 키 2026-06-11 생성, 사용 이력 없음 |
| IAM | 노드 역할 | ● | 인스턴스 프로파일 `insighta-k3s-node`, ECR pull 은 kubelet credential provider (`scripts/ops/k3s-node-setup.sh:24-37`), imagePullSecret 없음 |
| IAM | CI 로그 마스킹 | ● | 계정 ID·레지스트리 호스트 `::add-mask::` (`.github/workflows/deploy.yml:255-260`) |
| 네트워크 | 인바운드 | ◐ | 80/443 전체 공개, 22 는 /32 ×15 + `172.31.0.0/16`. 제어평면 6443/10250/8472 는 자기 SG 만. 22 목록은 스크립트가 누적(`terraform/modules/security/main.tf:1-21` 에 문서화된 concession) |
| 네트워크 | 아웃바운드 | ○ | 전체 허용(명시적, `terraform/modules/security/main.tf:54-60`) |
| 네트워크 | WAF / NACL 관리 | ○ | 없음. default VPC, default SG 존재 |
| 네트워크 | 운영 접근 | ◐ | SSH 키 인증만(`passwordauthentication no`), 이중 IP 검증 후 SG 동적 등록(`scripts/ops/ssh.sh:55-99`), Tailscale 폴백. 세션 감사 로그 없음 |
| 엣지 | TLS·HSTS·헤더 | ● | cert-manager ClusterIssuer `letsencrypt` READY, HSTS 63072000 preload + 4 헤더 (`charts/bootstrap/ingress-nginx-config.yaml:37-70`) |
| 엣지 | Rate limit | ◐ | 인그레스 `/api` 30 rps (`charts/insighta/templates/ingress.yaml:73-127`) + 앱 3 tier 중 tier-1/2 만 적용, tier-3 라우트별 리밋은 정의만 존재(`src/api/plugins/rate-limit.ts:46-59`, 사용처 0) |
| 엣지 | 관리 콘솔 노출 | ● | ArgoCD·Grafana 인터넷 미노출, SSH 2홉 (`scripts/ops/argocd-ui.sh`), `/keel` basic-auth |
| 클러스터 | Pod Security Admission | ○ | 전 네임스페이스 라벨 없음 |
| 클러스터 | NetworkPolicy | ○ | `insighta-prod` 0개 (argocd 5개는 차트 기본) |
| 클러스터 | 워크로드 securityContext | ○ | api·worker·frontend·redis 없음. Grafana 만 non-root. 컨테이너 이미지는 `USER appuser`(uid 1001, `Dockerfile:80`) |
| 클러스터 | ServiceAccount 분리 | ◐ | 앱 파드 = `default` SA, automount 미지정. 메트릭 스택은 전용 SA + 읽기전용 RBAC(`charts/insighta/templates/metrics.yaml:28-42`) |
| 클러스터 | 시크릿 저장 | ○ | `secrets-encrypt status = Disabled` (v1.36.3 에서 4회 실패 기록 `scripts/ops/k3s-node-setup.sh:184-205`), ESO 미배포 |
| 클러스터 | GitOps 경계 | ● | AppProject 별 네임스페이스 한정, `clusterResourceWhitelist: []` (`charts/bootstrap/projects.yaml`), prod `selfHeal=true, prune=false` |
| 클러스터 | 최소권한 훅 | ● | Keel PreSync 훅 RBAC 는 resourceNames 단위 (`charts/insighta/templates/keel-provision.yaml:40-60`) |
| 클러스터 | 호스트 | ◐ | unattended-upgrades 활성, sshd 키 전용. kubeconfig 모드 644, `permitrootlogin without-password` |
| 앱 인증 | 토큰 검증 | ● | Supabase JWT ES256/JWKS verify-only (`src/api/plugins/auth.ts:49-118`), 401 분류 3종, 토큰 로그 마스킹 (`src/api/utils/log-url-sanitizer.ts`) |
| 앱 인가 | 관리자 경계 | ● | `is_super_admin` 가드 101/102 핸들러 (`src/api/plugins/admin-auth.ts`), 예외 1건은 미등록 Stripe webhook |
| 앱 인가 | 봇 권한 분리 | ● | 봇 쓰기는 1회용 승인 토큰 필수 (`src/api/plugins/bot-write-guard.ts:29-99`), 전 요청 로그 |
| 앱 인가 | 서비스 role 키 경계 | ● | 백엔드 storage/deck 모듈·Edge Function 에만 존재, 프론트엔드 0 |
| 앱 입력 | 스키마 검증 | ● | zod 28 파일 + Fastify JSON schema 9 파일, 파라미터 바인딩 SQL |
| 앱 헤더 | CSP | ◐ | API 응답만 helmet CSP(`unsafe-inline`·`unsafe-eval` 허용, `src/api/server.ts:150-163`). 프론트엔드 CSP 없음 |
| 앱 시크릿 | 상수시간 비교 | ○ | `INTERNAL_BATCH_TOKEN`·봇 키 비교가 `===` (`src/api/routes/internal/snapshot.ts:32`) |
| 데이터 | RLS | ◐ | 정책 있는 테이블 5(ontology ×4, card_interactions) + deny-by-default 8. 백엔드는 `postgres` 로 접속해 RLS 우회(설계 문서화 `prisma/migrations/ontology/003_rls_policies.sql:64-69`). 커버리지 게이트 없음 |
| 데이터 | 저장 암호화 | ◐ | 사용자 LLM 키 AES-256-GCM(`src/modules/settings/llm-keys.ts`), OAuth 토큰 `ENCRYPTION_SECRET` 암호화. S3 SSE-S3. EBS 평문. Supabase 는 관리형 |
| 데이터 | 백업 | ● | 일일 pg_dump → S3, 내용 검증, 30일 보존, 실패 시 이슈 자동 생성 (`.github/workflows/backup.yml`). 복원 리허설 기록 없음 |
| 데이터 | 사용자 권리 | ◐ | 계정 데이터 삭제 9 테이블(`src/api/routes/settings.ts:105-133`), export 는 노트만 서버측·만다라는 클라이언트 100건 상한 |
| 데이터 | 인벤토리·분류 | ○ | PII 위치·등급·보존 문서 없음 |
| 데이터 | 관리자 행위 감사 | ● | `admin_audit_log` (users·content·promotions·redemption) |
| 공급망 | 이미지 스캔 | ◐ | ECR scanOnPush(BASIC) 이나 결과를 읽는 게이트 없음. 태그 MUTABLE, digest 핀 없음 |
| 공급망 | 의존성 취약점 | ○ | Dependabot 비활성, `npm audit` 없음(CI `--no-audit`), CodeQL 없음 |
| 공급망 | 시크릿 유출 방지 | ◐ | GitHub secret scanning 활성, push protection 비활성, **open alert 4건**(2025-12-19 Google API 키 · 2026-03-04 Supabase service key · Google OAuth client id/secret; 파일은 현재 gitignore 대상이나 히스토리 잔존). 리포 PUBLIC |
| 공급망 | 브랜치 보호 | ◐ | 필수 체크 8, force-push·삭제 차단. 리뷰 0, enforce_admins false |
| 공급망 | Actions 핀 | ○ | 서드파티 액션 태그 핀(`@v4`), SHA 핀 없음 |
| IaC | 상태·드리프트 | ● | S3 backend + DynamoDB lock + encrypt, plan-in-PR, 일일 드리프트 검사 → 이슈 (`.github/workflows/terraform.yml`) |
| IaC | apply 게이트 | ◐ | `push main` 에서 `-auto-approve`, environment `production` 에 required reviewer 없음 → **머지 = apply** |
| 관측 | 불변식 검사 | ● | Keel 8검사/30분, `error_events` 원장, TLS 만료, LLM 지출, 공개면 (`scripts/keel/checks.ts`) |
| 관측 | 보안 이벤트 소스 | ○ | 계정 계층 이벤트 없음(CloudTrail·GuardDuty 부재). Slack webhook 미설정 |
| AI | 비용 차단기 | ● | 크레딧 소진 차단기 + 비용 게이트 L1–L5 + 호출 원장 44 지점 (`src/modules/llm/cost-gate.ts`, `call-logger.ts`) |
| AI | 프롬프트 인젝션 격리 | ○ | 자막·노트·웹검색 결과를 비신뢰 입력으로 격리하는 템플릿·탐지 없음 |
| AI | 챗봇 사용자별 리밋 | ○ | `RATE_LIMITS.llm` 10/min 정의만 존재, 미적용 |

### 1.3 JD 7영역 대비 판정

| JD 영역 | 현 수준 | 격차 (핵심) |
|---|---|---|
| Cloud Security Architecture | 엣지·GitOps·IaC 는 설계됨. 통제 카탈로그·표준 문서 없음 | 표준 문서 + 통제 ID 체계 + 기준 매핑(CIS/OWASP) 부재 |
| CSPM / CNAPP | 계정 계층 0. 앱 불변식 감시(Keel)만 | 구성 준수 판정·위협 탐지·자동 시정 전무 |
| IAM / PAM | 최소권한 CI 정책, 역할 기반 ECR pull 은 있음 | 정적 키 2개(CI·admin), MFA 0/3, 휴면 키, 특권 세션 감사 없음 |
| Zero Trust | 사용자·봇·관측 경로는 신원 기반 | 운영자(SSH 포트 기반) · CI(정적 키) · 워크로드 간(격리 없음) 은 위치·비밀 기반 |
| Cloud Native Security | RBAC 최소권한 일부, non-root 이미지 | PSA·NetworkPolicy·securityContext·시크릿 암호화·digest 핀 없음 |
| DSPM / Data Security | 암호화·백업·삭제 경로 존재 | 인벤토리·분류·RLS 커버리지 게이트·복원 리허설·완전 export 없음 |
| AI Security | 비용 축은 완성 | 인젝션·유출·사용자별 소비 통제 없음 |

## 2. 설계 원칙 (JD 취지 → Insighta 적용)

1. **신원 중심 접근 (Zero Trust).** 네트워크 위치와 공유 비밀을 신뢰 근거로 쓰지 않는다. 사람·CI·워크로드·운영자 모두 신원 + 역할 + 시한 토큰. 정적 자격증명은 목록으로 관리하고 0 을 향해 줄인다.
2. **상시 판정·자동 시정 (CSPM).** 통제는 선언(IaC) · 측정(Config/Security Hub/Keel) · 시정(자동 또는 티켓) 3요소를 갖춰야 존재하는 것으로 본다. 측정 없는 통제는 문서일 뿐이다.
3. **최소권한·격리 (Cloud Native).** 워크로드별 ServiceAccount, 네임스페이스 default-deny, restricted 파드 프로파일, 시크릿은 etcd 밖.
4. **데이터 중심 (DSPM).** 어떤 데이터가 어디에 어떤 등급으로 있고 누가 어떤 경로로 읽는지가 문서와 코드(RLS 게이트)로 존재한다. 암호화·백업·복원은 실행 기록으로 증명한다.
5. **AI 워크로드는 신뢰 경계 밖 입력을 다룬다.** 자막·노트·검색 결과·사용자 메시지는 비신뢰 데이터로 격리하고, 소비량·유출·모델 공급망을 통제 대상에 넣는다.
6. **증거 가능성.** 모든 통제는 AWS 리소스 ID·파일 경로·PR 번호·Keel 체크명 중 하나로 인용 가능해야 한다.
7. **비용 상한.** 계정 규모(단일 노드, 리소스 수십 개) 기준 추가 비용 월 10 USD 이하(추정). 30일 후 Cost Explorer 로 실측해 유지 여부를 결정한다.

## 3. 목표 아키텍처 (JD 영역별)

### 3.1 Cloud Security Architecture — 기술 표준

- 표준 문서: `docs/security/control-catalog.md` (Phase 0). 통제 ID 체계 `ICS-<영역>-<번호>`: ACC(계정) · IAM · NET · K8S · DATA · SC(공급망) · OBS(관측) · AI.
- 통제 1건의 정의 = 목표 · 구현 위치 · 측정 방법 · 시정 방법 · 증거. 5 항목 중 하나라도 비면 "미완".
- 기준 매핑: CIS AWS Foundations Benchmark v3.0 (계정·IAM·로깅·모니터링·네트워크), CIS Kubernetes Benchmark (워크로드·RBAC·네트워크), OWASP ASVS L2 (앱), OWASP Top 10 for LLM Applications (AI).
- 아키텍처 결정 기록: 본 문서 §3 의 각 절이 ADR 역할. 변경 시 날짜와 사유를 절 끝에 추가한다.

### 3.2 CSPM / CNAPP — 상시 자세 점검·자동 시정

Terraform 모듈 `terraform/modules/security-baseline` 로 선언한다.

| 구성요소 | 설계 | 비용 (추정) |
|---|---|---|
| CloudTrail | 멀티리전 trail 1개 → S3 `insighta-audit-logs` (SSE-S3 · PAB 4/4 · 버저닝 · 365일 보존), 로그 파일 무결성 검증 on, 관리 이벤트 전체 | 첫 trail 관리 이벤트 무료. S3 저장 월 0.1 USD 미만 |
| AWS Config | recorder(전 리소스 유형) + 관리형 규칙 13: `cloudtrail-enabled` · `root-account-mfa-enabled` · `iam-user-mfa-enabled` · `access-keys-rotated(90d)` · `iam-user-unused-credentials-check(90d)` · `iam-password-policy` · `restricted-ssh` · `vpc-default-security-group-closed` · `s3-bucket-public-read-prohibited` · `s3-bucket-server-side-encryption-enabled` · `encrypted-volumes` · `ec2-imdsv2-check` · `ecr-private-image-scanning-enabled` | 구성 항목 0.003 USD/건 + 규칙 평가 0.001 USD/건. 리소스 ~60개 기준 월 1–3 USD |
| Security Hub | CSPM 활성, 표준 = AWS Foundational Security Best Practices. 보안 점수와 실패 통제 목록을 Keel 이 읽는다 | 월 10,000 검사까지 무료 → 0 USD 예상 |
| GuardDuty | 탐지기 활성(CloudTrail 관리 이벤트 + VPC Flow + DNS 분석) | 30일 무료 체험 후 이벤트량 기반. 이 규모 월 1–4 USD. 체험 종료 전 실측 후 유지 결정 |
| Access Analyzer | 계정 단위 외부 접근 분석기 | 무료 |
| 알림 | EventBridge 규칙(GuardDuty 심각도 ≥ 7, Security Hub FAILED, Config NON_COMPLIANT) → SNS 토픽 → 이메일. Slack webhook 은 설정 시 추가 | 무료 |
| 자동 시정 | Config remediation(SSM Automation) 3종: ① SG 22/tcp `0.0.0.0/0` → 즉시 revoke ② S3 public ACL/정책 → PAB 적용 ③ 90일 초과 액세스 키 → 비활성(삭제 아님). 판단이 필요한 항목은 시정하지 않고 SNS 로 보낸다. **초기 기본값**: ① 자동, ②③ 은 수동 트리거 — ② 는 계정 내 비-Insighta 버킷 `jk-commerce` 영향 검토 후, ③ 은 Phase 2 OIDC 전환 전에는 CI·admin 키(189일)가 대상이 되어 배포와 운영 CLI 를 끊으므로 전환 뒤 자동으로 올린다 | 무료 |

판정 주기: Config = 리소스 변경 즉시 + 24시간 주기. Keel `cloud-posture` = 30분(§3.8).
검증 방법(Phase 7): 의도적 위반 주입(테스트 SG 에 22 전체 공개) → Config NON_COMPLIANT → 자동 revoke → CloudTrail 에 시정 이벤트 → Keel 원장 기록. 이 한 바퀴가 관측되면 "자동 시정 운영" 으로 본다.

### 3.3 IAM / PAM — 신원과 특권 접근

| 대상 | 현재 | 목표 | 구현 |
|---|---|---|---|
| CI (GitHub Actions) | 정적 키 189일 | 정적 키 0 | IAM OIDC provider(`token.actions.githubusercontent.com`) + 역할 `insighta-github-actions`(trust: `repo:JK42JJ/insighta:ref:refs/heads/main`, `:environment:production`, `:pull_request`) 에 기존 정책 3개 부착. 워크플로 5개를 `aws-actions/configure-aws-credentials` `role-to-assume` 로 전환(`permissions: id-token: write`). 검증 후 사용자 `github-actions-terraform` 키 비활성 → 30일 후 삭제 |
| 사람 (`admin`) | AdministratorAccess, MFA 없음, 정적 키 189일 | MFA 없이는 아무 것도 못 함 | 비밀번호 정책(14자 · 복잡도 · 90일 · 재사용 24회 금지). 정책 `RequireMFA`(`aws:MultiFactorAuthPresent=false` 시 MFA 등록 외 전부 Deny). CLI 는 MFA 세션 토큰(`sts get-session-token`) 또는 역할 전환. James 액션 = 가상 MFA 등록(콘솔) |
| 휴면 (`slidegen-prh`) | 미사용 키 92일 | 휴면 0 | 비활성 → 30일 후 삭제. 이후 Config `iam-user-unused-credentials-check` 가 상시 판정 |
| 운영자 SSH | 22 인바운드, allow-list /32 ×15 | 인바운드 22 = 0, 신원 기반 접근, 세션 감사 | 두 옵션 중 James 선택(§8). **옵션 A Tailscale SSH**: 노드에 tailscaled 설치, Tailscale SSH(신원 = tailnet 계정, ACL 로 사용자·호스트 제한, 세션 기록 옵션), SG 22 규칙 전부 제거(오버레이 경유). 기존 `insighta-ec2-ts` 폴백 경로와 같은 방식이라 이식성 정책에 부합. **옵션 B SSM Session Manager**: 노드 역할에 `AmazonSSMManagedInstanceCore`, 세션 로그 → CloudWatch Logs. AWS 전용이라 `terraform/.../variables.tf` 의 `enable_ssm` 설명("portability design rejects it")에 기록된 정책의 예외 승인이 필요. 어느 쪽이든 `scripts/ops/ssh.sh` 에 새 경로를 추가하고 ArgoCD/Grafana 포트포워드도 그 경로로 옮긴다 |
| 노드 역할 | `insighta-k3s-node` (Terraform 관리 밖, 변수로 이름만 참조) | 최소권한 유지 | SSM Parameter Store `/insighta/prod/*` 읽기(§3.5) 추가, 옵션 B 선택 시 SSM 코어 추가. 역할을 Terraform 으로 import 한 뒤 정책 시뮬레이션으로 확인 |
| 호스트 | kubeconfig 644 | 600 | `write-kubeconfig-mode: "0600"` |

PAM 관점 정의: 특권 = 클러스터 admin(kubectl) · AWS admin · DB `postgres` role. 세 경로 모두 (a) MFA 또는 OIDC 신원 (b) 세션 로그 (c) 정적 비밀 없음을 만족해야 한다. DB `postgres` 접속은 CI 마이그레이션과 백업에만 남기고 Supabase 네트워크 제한(§3.6)으로 출처를 고정한다.

### 3.4 Zero Trust Architecture

접근 주체별 신뢰 근거를 "위치·비밀" 에서 "신원·역할·시한" 으로 옮긴다.

| 주체 | 현재 근거 | 목표 근거 | Phase |
|---|---|---|---|
| 최종 사용자 → API | Supabase JWT(ES256, 만료, JWKS 검증) | 유지. 라우트별 리밋 적용 | 6 |
| CI → AWS | 정적 키 | OIDC 단기 토큰(1시간), 브랜치·환경 조건 | 2 |
| 운영자 → 노드 | SSH 키 + 소스 IP | 신원 기반 SSH(옵션 A Tailscale SSH / 옵션 B SSM) + 인바운드 22 제거 + 세션 로그 | 2 |
| 워크로드 → 워크로드 | 네임스페이스 공유, 제한 없음 | NetworkPolicy default-deny + 명시 허용 | 3 |
| 워크로드 → K8s API | default SA 토큰 자동 마운트 | 전용 SA, 필요 없는 파드는 automount off | 3 |
| 워크로드 → 시크릿 | etcd base64 | ESO 가 SSM Parameter Store 에서 동기화, 노드 역할 경로 제한 | 3 |
| 관측 → DB | 읽기전용 role + RLS(현행) | 유지 | — |
| 봇 → API | 서비스 키 + 1회용 승인 토큰(현행) | 유지, 비교를 상수시간으로 | 6 |
| Mac Mini 수집기 → API | `INTERNAL_BATCH_TOKEN` | 유지(기기 특성상 정적), 상수시간 비교 + 회전 절차 문서화 | 6 |

정적 자격증명 잔여 목록(구현 후): `INTERNAL_BATCH_TOKEN`, `INSIGHTA_BOT_KEY`, Supabase service role(Edge Function·백엔드 storage 전용). 각각 회전 주기와 소유 경로를 카탈로그에 기록한다.

### 3.5 Cloud Native Security — 클러스터·워크로드

- **Pod Security Admission**: `insighta-prod` 에 `enforce=baseline`, `warn=restricted`, `audit=restricted` 라벨 → 앱 파드 정비 후 `enforce=restricted`.
- **securityContext 표준** (`charts/insighta/templates/_helpers.tpl` 공통 블록): `runAsNonRoot: true`, `runAsUser: 1001`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, `seccompProfile: RuntimeDefault`, `readOnlyRootFilesystem: true` (쓰기 경로는 `emptyDir` 로 `/tmp` 등 마운트). redis 는 데이터 볼륨만 쓰기. node-exporter 는 hostPath 가 필요하므로 별도 네임스페이스 또는 예외를 카탈로그에 명시.
- **ServiceAccount**: `insighta-api` · `insighta-worker` · `insighta-frontend` · `insighta-redis` 전용 SA, `automountServiceAccountToken: false`(K8s API 를 쓰지 않음).
- **NetworkPolicy** (`insighta-prod`): default-deny ingress+egress. 허용: ingress-nginx → frontend:8080, api:3000 · api/worker → redis:6379 · metrics → 각 파드 `/metrics` · 모든 파드 → kube-dns 53 · api/worker → 외부 443(Supabase·OpenRouter·YouTube·ECR·프록시) · frontend egress 없음 · redis egress 없음.
- **시크릿**: External Secrets Operator + AWS SSM Parameter Store(SecureString, 기본 KMS 키). 경로 `/insighta/prod/<key>`. `ExternalSecret` 이 기존 Secret 이름으로 동기화하므로 차트 참조 무변경. 노드 역할에 `ssm:GetParameter*` (경로 조건) 만 부여. 회전 = 파라미터 갱신 → `refreshInterval` 내 반영. 결과: etcd 에 남는 것은 동기화 사본이므로 SSM 이 원본, 감사는 CloudTrail(`ssm:GetParameter` 이벤트).
- **이미지**: ECR `IMMUTABLE` 태그, 차트는 `image@sha256:` digest 핀(CI 가 push 후 digest 를 기록). CI 에 Trivy 스캔(CRITICAL 이면 fail, 스캔 결과 artifact). GitHub Actions 는 SHA 핀.
- **노드**: EBS 기본 암호화 on(신규 볼륨). 현 루트 볼륨은 스냅샷 → 암호화 복사 → 볼륨 교체(노드 정지 약 10–15분, James 시점 결정). `write-kubeconfig-mode 0600`.

### 3.6 DSPM / Data Security

- **데이터 인벤토리** `docs/security/data-inventory.md`: 테이블·버킷·시크릿 단위로 등급(PII · 자격증명 · 사용자 콘텐츠 · 텔레메트리 · 공개), 저장 위치(Supabase us-west-2 / S3 / SSM / Redis), 전송·저장 암호화, 접근 주체(postgres · service role · keel_read · anon · authenticated), RLS 상태, 보존기간, 삭제 경로. PII 현황(실측): 이메일·이름·아바타(Google OAuth), YouTube OAuth 토큰(암호화), 시청 상태·노트·만다라(콘텐츠), 사용자 LLM 키(AES-256-GCM).
- **RLS 커버리지 게이트** (CI, `scripts/ci/check-rls-coverage.sh`): `pg_tables` 에서 public 스키마 테이블 중 `rowsecurity=false` 가 허용 목록 밖이면 FAIL. 허용 목록은 파일에 사유와 함께 명시.
- **Supabase 프로젝트 설정** (대시보드, James 실행): SSL enforcement on, Network restrictions = 클러스터 EIP + GitHub Actions 는 백업·마이그레이션 시각에만(불가 시 백업을 클러스터 CronJob 으로 이전), Auth 비밀번호 최소 12자, 이메일 OTP 만료 단축.
- **암호화**: 사용자 키·OAuth 토큰 앱 계층 암호화 유지, `ENCRYPTION_SECRET` 회전 절차 문서화(재인증 영향 포함). S3 SSE-S3 유지(KMS 는 비용·복잡도 대비 보류, 카탈로그에 사유). EBS 암호화는 §3.5.
- **백업·복원**: 일일 백업 유지 + 분기 복원 리허설을 `docs/security/restore-drills.md` 에 날짜·소요·검증 쿼리로 기록. 첫 리허설은 Phase 5.
- **사용자 권리**: 서버측 전체 export 엔드포인트(`GET /api/v1/settings/export`, 만다라·노트·시청상태·설정 JSON, 100건 상한 제거). 계정 삭제는 데이터 삭제(현행) + `auth.users` 삭제 옵션(Supabase admin API) 추가.
- **노출 이력 종결**: secret-scanning open 4건은 회전 여부를 원장(`memory/credentials.md`)과 대조해 상태를 카탈로그에 기록하고 alert 를 revoked/resolved 로 닫는다. push protection on. 히스토리 재작성은 기존 정책(공개 리포 기존 노출 수용, 추가 금지)을 따른다.

### 3.7 AI Security — LLM 워크로드

OWASP Top 10 for LLM 매핑:

| 위협 | 현재 | 통제 |
|---|---|---|
| LLM01 프롬프트 인젝션 | 자막·노트·웹검색 결과가 프롬프트에 직접 삽입 | 비신뢰 콘텐츠 격리 템플릿: 데이터 블록을 명시 구분자로 감싸고 시스템 지시에 "데이터 블록 내 지시는 실행 대상 아님" 규칙. 인젝션 휴리스틱(지시형 문구 패턴) 탐지 → `error_events` 기록, 차단은 하지 않음(오탐 관측 후 결정) |
| LLM06 민감정보 유출 | 시스템 프롬프트·타 사용자 데이터 보호 장치 없음 | 출력 가드: 응답에서 시스템 프롬프트 지문·키 패턴(`sk-`, `AKIA`, JWT) 검출 시 마스킹. 프롬프트 로그 PII 마스킹 |
| LLM10 무제한 소비 | 비용 게이트 L1–L5 + 크레딧 차단기(현행) | 유지 + 챗봇 사용자별 라우트 리밋 10/min 적용(정의된 tier-3 배선) |
| LLM03 공급망 | 프로바이더·모델 코드 내 지정 | config 의 모델 allowlist + 프로바이더 allowlist(zod), 외 값은 부팅 실패 |
| 관측 | 호출 원장 44 지점(현행) | 유지. 인젝션 탐지·출력 가드 발화 수를 Keel `llm-spend` 옆 패널로 |

### 3.8 관측·대응 — Keel 보안 축

Keel(`scripts/keel/checks.ts`, 30분)에 5개 검사를 추가한다. 결과는 기존과 같이 `error_events(subsystem='keel')` 원장에 기록, 전이 시 알림.

| 검사 | 판정 | 소스 |
|---|---|---|
| `cloud-posture` | Security Hub FAILED 통제 수 ≤ 기준선, GuardDuty 심각도 ≥ 7 findings = 0 | `securityhub get-findings`, `guardduty list-findings` |
| `iam-hygiene` | MFA 없는 콘솔 사용자 0, 90일 초과 활성 키 0, 사용 이력 없는 키 0 | credential report |
| `k8s-hardening` | `insighta-prod` PSA 라벨 존재, NetworkPolicy ≥ 기준 수, non-root 파드 비율 100% | kube API(SSH 경유 또는 kube-state-metrics 지표) |
| `supply-chain` | ECR CRITICAL 취약점 0, GitHub Dependabot open critical 0 | `ecr describe-image-scan-findings`, `gh api` |
| `secret-exposure` | GitHub secret-scanning open alerts 0 | `gh api` |

Grafana `/keel/` 에 보안 패널 6개(위 5 + 정적 자격증명 잔여 수). CI 러너에는 위 읽기 권한만 가진 OIDC 역할 `insighta-keel-reader` 를 별도로 둔다.

## 4. 로드맵 (단위 = PR)

각 PR 은 완료판정·롤백·다운타임을 PR 본문에 적는다. Phase 1 은 **머지 = terraform apply** 이므로 James 승인 뒤 머지한다.

| Phase | 내용 | 완료판정 | 롤백 | 다운타임 | James 액션 |
|---|---|---|---|---|---|
| 0 | 본 문서 + `control-catalog.md` | 문서 머지 | revert | 0 | 검토 |
| 1 계정 기준선 | `modules/security-baseline`: CloudTrail · Config 13 규칙 · Security Hub FSBP · GuardDuty · Access Analyzer · 비밀번호 정책 · EBS 기본 암호화 · SNS 알림 · 자동 시정 3종 | CloudTrail 로그 S3 도착, Config 평가 결과 존재, Security Hub 점수 표시, SNS 구독 확인 메일 수신 | `terraform destroy -target module.security_baseline` (감사 로그 버킷은 `prevent_destroy`) | 0 | 머지 승인, SNS 구독 확인, 30일 후 비용 확인 |
| 2 아이덴티티 | OIDC provider + 역할, 워크플로 5개 전환, `RequireMFA` 정책, 휴면 키 비활성, 운영자 접근 전환(옵션 A/B, §8) + `ssh.sh` 새 경로, SG 22 규칙 제거, kubeconfig 0600, 키 시정 자동화 on | 워크플로 OIDC 로 성공 실행 1회, CI 사용자 활성 키 0, 새 경로로 kubectl 1회 성공, SG 22 규칙 0, credential report MFA 1/1 | 키 재활성(즉시), 워크플로 revert, SG 22 규칙 재등록(`ssh.sh --update-sg`) | 0 | admin 가상 MFA 등록, 접근 옵션 선택 |
| 3 클러스터 | securityContext 표준 · 전용 SA · NetworkPolicy · PSA 라벨 · ESO+SSM Parameter Store | 전 파드 non-root, 격리 테스트(frontend 파드에서 redis 6379 접속 실패, api 에서 성공), `ExternalSecret` READY, PSA `restricted` enforce 후 배포 성공 | ArgoCD 이전 리비전 sync | 0 (롤링) | — |
| 4 공급망 | Trivy CI 게이트 · Dependabot · `npm audit --audit-level=high` 게이트(기준선) · ECR IMMUTABLE + digest 핀 · Actions SHA 핀 · push protection on | CI 통과, ECR 정책 확인, `gh api` push_protection enabled | 워크플로 revert | 0 | — |
| 5 데이터 | 인벤토리 문서 · RLS 커버리지 게이트 · 전체 export · 복원 리허설 1회 · secret alert 4건 종결 · Supabase 설정 · EBS 루트 암호화 | 게이트 PASS, 리허설 기록, alert open 0, `Encrypted=True` | 볼륨 교체 전 스냅샷으로 복귀 | EBS 교체 10–15분 | Supabase 대시보드 설정, 정지 시점 결정 |
| 6 AI | 라우트 리밋 배선 · 격리 템플릿 · 출력 가드 · 모델 allowlist · 상수시간 비교 | 단위 테스트 + 스테이징 챗 1회 | revert | 0 | — |
| 7 관측 | Keel 검사 5 · Grafana 패널 · 자동 시정 한 바퀴 검증 | 위반 주입 → 시정 → 원장 기록 관측 | 검사 제거 | 0 | — |

우선순위 근거: Phase 1→2→3 이 JD 의 핵심 3개(CSPM · IAM/PAM/Zero Trust · Cloud Native)를 다운타임 0 으로 만든다. Phase 5 의 EBS 교체만 정지가 필요하므로 뒤에 둔다.

## 5. 비용·다운타임·롤백 요약

| 항목 | 월 비용 (추정) | 다운타임 | 롤백 |
|---|---|---|---|
| CloudTrail + S3 | < 0.1 USD | 0 | trail 삭제, 버킷 보존 |
| AWS Config 13 규칙 | 1–3 USD | 0 | recorder 정지 |
| Security Hub FSBP | 0 USD (무료 구간) | 0 | 표준 비활성 |
| GuardDuty | 30일 무료 → 1–4 USD | 0 | 탐지기 삭제 |
| SSM Session Manager · Parameter Store · ESO · OIDC · Access Analyzer · Trivy · Dependabot | 0 USD | 0 | 각 Phase 표 |
| EBS 암호화 볼륨 | 0 USD (gp3 동일 단가) | 10–15분 | 스냅샷 복귀 |
| 합계 | 2–8 USD (상한 10 USD) | EBS 1회 | — |

## 6. 이력 기술용 사실 구분

### 6.1 현재 시점에 사실인 것 (구현 전에도 인용 가능)

- 인그레스 TLS 자동 발급·갱신(cert-manager), HSTS preload, 보안 헤더 4종, `/api` 30 rps 리밋, 관리 콘솔(ArgoCD·Grafana) 인터넷 미노출.
- ECR pull 을 인스턴스 프로파일 + kubelet credential provider 로 처리해 이미지 pull 시크릿 0. IMDSv2 강제.
- CI IAM 정책을 문장 단위 최소권한으로 작성(IAM 은 읽기만, `s3:DeleteBucket` 제외), CI 로그 계정 ID 마스킹, terraform plan-in-PR + 일일 드리프트 검사.
- Supabase JWT ES256/JWKS 검증(verify-only), 관리자 경계 `is_super_admin` 101/102, 봇 쓰기 1회용 승인 토큰, 서비스 role 키 프론트엔드 0.
- 관측 경로는 읽기전용 DB role + 테이블별 RLS 정책을 PreSync 훅이 생성·회전(사람이 비밀번호를 타이핑하지 않음).
- 일일 DB 백업 → S3(SSE·버저닝·PAB·30일 보존), 실패 시 이슈 자동 생성. LLM 비용 게이트 L1–L5 + 크레딧 차단기 + 호출 원장.
- Keel: 8개 불변식 30분 주기 검사(배포 드리프트·공개면·TLS 만료·LLM 지출·AWS 비용·파이프라인 신선도·스키마), `error_events` 원장, 전이 시 알림.

### 6.2 구현 후 추가되는 사실 (Phase 완료 시 §7 증거와 함께)

- Phase 1: AWS 계정 보안 기준선을 IaC 로 선언 — CloudTrail·Config 13 규칙·Security Hub·GuardDuty·Access Analyzer, 위반 3종 자동 시정, 알림 파이프라인.
- Phase 2: CI 정적 자격증명 0(OIDC), 콘솔 MFA 강제, 특권 접근을 SSM Session Manager 로 전환(인바운드 SSH 0, 세션 감사 로그).
- Phase 3: 워크로드 격리(NetworkPolicy default-deny, restricted PSA, 전용 SA), 시크릿을 etcd 밖(SSM Parameter Store + ESO)으로.
- Phase 4: 이미지 취약점 게이트, 의존성 취약점 게이트, digest 핀, push protection.
- Phase 5: 데이터 인벤토리·RLS 커버리지 게이트·복원 리허설·EBS 암호화.
- Phase 6: LLM 인젝션 격리·출력 가드·사용자별 리밋·모델 allowlist.
- Phase 7: 보안 자세를 Keel 5 검사 + Grafana 패널로 상시 관측, 자동 시정 한 바퀴 검증 기록.

## 7. 증거표 (구현 시 채움)

| 통제 ID | Phase | 증거 유형 | 값 | 확인일 |
|---|---|---|---|---|
| (Phase 1 머지 후 기입) | | | | |

## 8. 결정 대기 (James)

1. Phase 1 머지 승인 — 머지 즉시 `terraform apply`. 비용 추정 월 2–8 USD.
2. `admin` 사용자 MFA 등록(콘솔) — Phase 2 `RequireMFA` 정책 적용 전 필수. 등록 전 정책을 적용하면 콘솔 작업이 막힌다.
3. 운영자 접근 방식 — 옵션 A Tailscale SSH(이식성 정책 부합, 노드에 tailscaled 설치) / 옵션 B SSM Session Manager(AWS 전용, 기존 정책 예외 필요). 기본 제안 = A.
4. EBS 루트 볼륨 암호화 교체 시점(10–15분 정지) — Phase 5.
5. Supabase 대시보드 설정(SSL 강제·네트워크 제한) — Phase 5.
6. GuardDuty 30일 무료 종료 시 유지 여부 — Cost Explorer 실측 후.
7. S3 공개 차단 자동 시정을 자동으로 올릴지 — `jk-commerce` 버킷(비-Insighta, PAB 없음)의 용도 확인 후.

## 9. 실측 기록 (2026-09-11, 값 미기재)

- AWS: `sts get-caller-identity` · `cloudtrail describe-trails` · `guardduty list-detectors` · `configservice describe-configuration-recorder-status` · `securityhub describe-hub` · `accessanalyzer list-analyzers` · `iam get-account-summary` · `iam get-account-password-policy` · `iam list-users/list-mfa-devices/list-access-keys` · `iam get-credential-report` · `iam list-open-id-connect-providers` · `ec2 describe-instances`(IMDS·프로파일) · `ec2 describe-volumes` · `ec2 describe-security-groups` · `ec2 get-ebs-encryption-by-default` · `ecr describe-repositories` · `s3api get-public-access-block/get-bucket-encryption/get-bucket-versioning`.
- 클러스터(`scripts/ops/ssh.sh k3s`): `kubectl get ns --show-labels` · `get netpol -A` · `get ingress -A` · `get clusterissuer,certificate -A` · `get applications -A` · `get secrets -A` · `k3s secrets-encrypt status` · `get pods -A -o custom-columns=(securityContext·SA·automount)` · `get clusterrolebinding/rolebinding` · `/etc/rancher/k3s/config.yaml` · `ss -ltnp` · `sshd -T` · unattended-upgrades · ufw/fail2ban.
- GitHub(`gh api`): 리포 가시성 · 브랜치 보호 · `security_and_analysis` · secret-scanning alerts(유형·경로만) · Dependabot 상태 · code-scanning · environment `production` 보호 규칙 · 워크플로 자격증명 방식 grep.
- 코드: origin/main `00c5c302` 를 두 감사 에이전트가 파일 단위로 인용(§1.2 경로).
