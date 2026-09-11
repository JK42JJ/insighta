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
7. **보안 지출 0 (James 규칙, 2026-09-11).** 유료 보안 서비스는 쓰지 않는다. "30일 무료 후 과금" 류도 금지. 비용이 붙는 통제는 우회 방법 또는 오픈소스로 대체한다. 상시 무료 구간(CloudTrail 첫 사본 · CloudWatch Logs 5 GB · 알람 10개 · SNS 이메일 · Access Analyzer · IAM/EBS 설정)만 쓴다.

## 3. 목표 아키텍처 (JD 영역별) — 장기 목표 상태

적용 순서는 §4–§5 의 ROI 단계를 따른다. 본 절은 각 영역의 목표 상태와 구현 방식을 정의한다.

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
| ~~AWS Config~~ → Prowler | 과금 서비스라 코드만 두고 off. 대체 = **Prowler**(오픈소스, CIS AWS 벤치마크 300+ 검사)를 Keel 워크플로에서 주간 실행, 결과를 `error_events` 원장과 Grafana 에. 규칙 13 참고용: `cloudtrail-enabled` · `root-account-mfa-enabled` · `iam-user-mfa-enabled` · `access-keys-rotated(90d)` · `iam-user-unused-credentials-check(90d)` · `iam-password-policy` · `restricted-ssh` · `vpc-default-security-group-closed` · `s3-bucket-public-read-prohibited` · `s3-bucket-server-side-encryption-enabled` · `encrypted-volumes` · `ec2-imdsv2-check` · `ecr-private-image-scanning-enabled` | 구성 항목 0.003 USD/건 + 규칙 평가 0.001 USD/건. 리소스 ~60개 기준 월 1–3 USD |
| ~~Security Hub~~ | 무료 구간이 있어도 규칙상 사용하지 않음. 점수·실패 목록은 Prowler 출력으로 대체 | 0 |
| ~~GuardDuty~~ | **적용 후 같은 날 제거**(30일 후 과금). 대체 = CloudTrail 지표 알람 8종(무료) + 오픈소스 CSPM(Prowler, Keel 주간) | 0 |
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
| `cloud-posture` | 트레일 IsLogging · 다중 리전 · 로그 검증 on, CIS 알람 8 존재 · 액션 활성, EBS 기본 암호화 on, 비밀번호 정책 최소 14, 감사 버킷 public access block 4/4, 알림 토픽 confirmed 구독 ≥ 1. 읽지 못한 사실 = 실패. (Security Hub · GuardDuty 는 비용 규칙으로 꺼져 있어 쓰지 않는다) | `cloudtrail get-trail-status` · `get-trail`, `cloudwatch describe-alarms`, `ec2 get-ebs-encryption-by-default`, `iam get-account-password-policy`, `s3api get-public-access-block`, `sns get-topic-attributes` — `scripts/keel/check-cloud-posture.ts` |
| `iam-hygiene` | MFA 없는 콘솔 사용자 0, 90일 초과 활성 키 0, 사용 이력 없는 키 0 | credential report |
| `k8s-hardening` | `insighta-prod` PSA 라벨 존재, NetworkPolicy ≥ 기준 수, non-root 파드 비율 100% | kube API(SSH 경유 또는 kube-state-metrics 지표) |
| `supply-chain` | 두 lockfile 의 npm audit critical 0 · high 0 (Dependabot API 는 워크플로 토큰으로 불가). ECR 이미지 스캔 집계는 미구현(S3) | `npm audit --json --package-lock-only` (root · frontend) |
| `secret-exposure` | GitHub secret-scanning open alerts 0 | `gh api` |

Grafana `/keel/` 에 보안 패널 6개(위 5 + 정적 자격증명 잔여 수). CI 러너는 배포 역할 `insighta-github-actions` 에 붙인 읽기 전용 정책(`terraform/global/iam-ci/security-read.tf`)으로 위 호출을 한다. 별도 역할은 두지 않았다 — 같은 러너가 배포와 관측을 하므로 역할 분리는 권한이 아니라 워크플로 단위에서만 의미가 있고, 그 분리는 S3 에서 검토한다.

## 4. 보안 운영 모델 — 큰 줄기와 성숙도

James 판정(2026-09-11): 플랫폼 크기와 관계없이 보안의 중요도와 접근 방식은 같다. 도구와 깊이는 규모에 따라 다르지만 큰 줄기·흐름·사상은 같다. 따라서 우선순위와 구조는 클라우드 보안의 큰 흐름에 맞춰 설계하고, 단계별로 발전시켜 갈 수 있는 지속적인 형태를 갖춘다. Insighta 는 이 구조로 "보안" 이라는 카테고리를 설명할 수 있어야 한다(→ `docs/security/README.md`).

### 4.1 큰 줄기: 6 기능 × 클라우드 보안 영역

기능은 NIST CSF 2.0 의 여섯 가지를 쓴다. 영역은 AWS Well-Architected 보안 필러와 JD 의 7영역을 합친 것이다. 규모가 바꾸는 것은 각 칸의 **도구와 깊이**이지 칸의 존재 여부가 아니다.

| 기능 | 뜻 | Insighta 에서의 구현 (영역) |
|---|---|---|
| Govern 거버넌스 | 정책·표준·책임 분담·위험 판정·증거 | 통제 카탈로그(ICS-*), 본 설계, 책임 공유 모델(§4.2), 분기 리뷰 |
| Identify 식별 | 자산·데이터·자격증명·노출면의 인벤토리와 측정 | §1 실측, 자격증명 인벤토리, 데이터 인벤토리, 노출 이력 대조 |
| Protect 보호 | 신원·접근(IAM/PAM·Zero Trust), 네트워크·엣지, 워크로드(Cloud Native), 데이터(DSPM), 공급망, 앱, AI | §3.3–3.7 |
| Detect 탐지 | 감사 로그, 위협 탐지, 구성 준수 판정, 불변식 검사 | CloudTrail·GuardDuty·CIS 알람·(Config·Security Hub)·Keel |
| Respond 대응 | 알림 경로, 런북, 자동 시정, 회전 절차 | SNS·Slack, `incident-runbook.md`, Config remediation |
| Recover 복구 | 백업, 복원 리허설, 롤백, 재구축 | 일일 백업, 복원 리허설, 롤백 3층, IaC·GitOps 재구축 |

원칙: **각 단계는 6 기능 전부에 최소선을 둔다.** 한 기능을 끝까지 파고 다른 기능을 비워 두지 않는다. 다음 단계는 각 기능을 한 칸씩 깊게 한다.

### 4.2 책임 공유 모델 (Insighta 가 설명해야 하는 것)

| 계층 | 제공자가 맡는 것 | Insighta 가 맡는 것 |
|---|---|---|
| AWS | 물리·하이퍼바이저·리전·관리형 서비스 자체의 보안 | 계정 설정(MFA·정책·감사), IAM, 네트워크(SG), 노드 OS·k3s, 암호화 설정, 워크로드 |
| Supabase Cloud | PostgreSQL·Auth 서비스 운영, 인프라 백업, 패치 | RLS·역할·키 관리, SSL 강제·네트워크 제한, 데이터 분류·보존, 자체 백업 |
| GitHub | 플랫폼·secret scanning 엔진·Actions 러너 | 브랜치 보호, 시크릿·변수 관리, 워크플로 권한, OIDC 신뢰 정책, 의존성 대응 |
| LLM 공급자(OpenRouter 등) | 모델 호스팅·API 보안 | 프롬프트 격리, 소비 통제, 데이터 최소화, 공급자·모델 allowlist |
| Mac Mini 수집기 | — | 기기 보안, 토큰 회전, 프록시 자격증명 |

### 4.3 성숙도 단계 — 지속 발전의 형태

| 단계 | 정의 | 6 기능의 최소선 | 진입 조건 |
|---|---|---|---|
| Stage 1 · Foundational | 규모와 무관하게 없으면 안 되는 것. 자격증명·감사·복원 | 카탈로그 · 자격증명 인벤토리 · MFA/OIDC · CloudTrail/GuardDuty/알람 · 런북 v1 · 복원 리허설 1회 | 즉시 |
| Stage 2 · Managed | 통제가 측정되고 되풀이됨. 워크로드·상시 관측 | 분기 리뷰 · 데이터 인벤토리 v1 · 워크로드 최소권한 · Keel 보안 검사 · 런북 v2 · 롤백 검증 | Stage 1 검증 완료 |
| Stage 3 · Optimized | 자동 준수·자동 시정·격리·데이터·AI 심화 | Config/Security Hub · NetworkPolicy/PSA · ESO · DSPM · AI 가드 · 자동 시정 검증 | §5 Stage 3 트리거 |

지속 루프: **측정**(Keel 30분 · CloudTrail 상시 · Config 24h) → **판정**(`error_events` 원장 · 알람) → **시정**(자동 시정 또는 런북) → **기록**(§8 증거표) → **분기 리뷰**(카탈로그 상태 갱신 · 트리거 재평가 · 다음 단계 항목 선정). 이 루프가 도는 것이 "지속적인 보안" 의 정의다.

### 4.4 우선순위 근거 — 이 규모의 위협 순위

규모(실측): 노드 1(t3.medium) · 파드 11 · 운영자 1 + 자동화 · 베타 규모 사용자 · LLM 지출 ≈ 0/일 · 공개 리포. 같은 단계 안에서의 순서는 막는 사고의 크기 × 확률 ÷ (구축 시간 + 비용 + 운영 마찰) 로 정한다.

| 순위 | 위협 | 근거 (실측) | 막는 비용 |
|---|---|---|---|
| 1 | 자격증명 유출·도용 → 계정 탈취(요금·데이터) | 공개 리포 노출 이력 4건 중 **Google OAuth client secret·ID 는 2026-03-04 노출값과 현재 로컬 값이 동일**(해시 대조). 정적 키 2개 189일. 콘솔 MFA 0/3 | 회전·OIDC·MFA — 1일, 비용 0 |
| 2 | 사고 조사 불가 | CloudTrail trail 0 | 무료 |
| 3 | 앱 취약점 → 컨테이너 → 단일 노드 전체 | 앱 파드 4종 root 가능 · capabilities 전부 | 차트 값 변경 |
| 4 | 백업 복원 미검증 | 복원 리허설 기록 0 | 1시간 |
| 5 | LLM 소비 남용 | 차단기 있음, 사용자별 리밋 미배선 | 30분 |
| 낮음 | 워크로드 간 횡이동 · etcd 시크릿 암호화 · 구성 준수 점수화 · WAF · NetworkPolicy · ESO · DSPM 심화 · AI 인젝션 | 단일 테넌트·단일 디스크·낮은 트래픽에서는 막는 사고의 크기가 작거나 이미 아는 사실을 다시 보고 | Stage 3 |

## 5. 단계 설계 — 6 기능 × 3 단계

### Stage 1 — Foundational (목표 1–2일, 월 0–3 USD)

| 기능 | 항목 | 작업 | 검증 |
|---|---|---|---|
| Govern | 표준·설명 | 통제 카탈로그 + 본 설계(PR #1625) · `docs/security/README.md`(보안 카테고리 설명) · `incident-runbook.md` v1 | 문서 머지 |
| Identify | 자격증명 인벤토리 · 노출 종결 | 정적 자격증명 목록(소유·용도·회전 주기) 을 카탈로그 부록으로. 노출 4건 해시 대조 완료: Supabase 서비스키·Google API 키 = prod 현재값과 불일치(교체됨), **Google OAuth client secret·ID = 현재값과 동일** | 목록 1건, alert 처리 상태 |
| Protect | 신원 | Google OAuth client secret 재발급(GCP 콘솔 James) → Supabase Auth · Edge Function 시크릿 · GitHub Secrets 갱신 · CI OIDC 역할(`insighta-github-actions`) + 워크플로 5개 전환 + 정적 키 삭제 · admin 가상 MFA 등록 + `RequireMFA` 정책(`mfa_required_users`) + CLI 36시간 MFA 세션(`scripts/ops/aws-mfa.sh`) · 휴면 키 삭제 · 비밀번호 정책 | credential report: MFA 1/1 · CI 활성 키 0, OIDC 워크플로 성공 1회, 로그인 E2E 1회 |
| Protect | 리포·노드 | push protection · Dependabot alerts · validity checks on · EBS 기본 암호화 · SG 22 누적 /32 정리(15 → 실사용) | 설정 확인, SG 22 규칙 ≤ 2 |
| Detect | 감사·탐지 | CloudTrail(S3 + CloudWatch Logs 90일) · CIS 알람 8(root 사용 · MFA 없는 콘솔 로그인 · AccessDenied 급증 · IAM 정책 변경 · 트레일 변경 · SG 구조·egress 변경 · 버킷 노출 변경 · 네트워크 변경). GuardDuty·Config·Security Hub 는 유료라 사용하지 않음(코드만, 플래그 off) | `IsLogging=true`, 알람 8 |
| Respond | 알림·런북 | SNS 이메일 구독 확인 · 런북 v1(자격증명 유출 · MFA 없는 로그인 · GuardDuty high · 새 secret alert) · 테스트 알림 1회 | 구독 Confirmed, 메일 수신 1회 |
| Recover | 복원 리허설 | 최신 백업을 별도 DB 에 복원, 테이블·행 수 대조, RTO 기록 `restore-drills.md` | 기록 1건 |

운영 마찰(James 결정): admin MFA 이후 CC 의 AWS CLI 는 36시간마다 James 의 MFA 코드 1회가 필요하다.
이력 문장: "CI·운영자 정적 자격증명을 OIDC·MFA 로 대체하고, 계정 감사·위협 탐지·알림·대응 절차와 복원 검증을 갖춘 보안 기반선을 IaC 로 선언·운영".

### Stage 2 — Managed (목표 1일, 월 0)

| 기능 | 항목 | 작업 | 검증 |
|---|---|---|---|
| Govern | 분기 리뷰 | `/harness-review` 에 보안 축 등록: 카탈로그 상태 갱신 · 트리거 재평가 · 증거표 | 첫 리뷰 기록 |
| Identify | 데이터 인벤토리 v1 | 테이블·버킷·시크릿 단위 등급(PII·자격증명·콘텐츠·텔레메트리) · 위치 · 접근 주체 · RLS 상태 · 보존 | 문서 1건 |
| Protect | 워크로드·앱 | api·worker·frontend·redis securityContext(runAsNonRoot · drop ALL · no privesc · seccomp) + automount off · kubeconfig 0600 · Supabase SSL 강제 · 챗봇 사용자별 리밋(tier-3 배선) · 공유 비밀 상수시간 비교 | 전 파드 non-root, 롤링 후 헬스, 테스트 |
| Detect | 상시 관측 · 오픈소스 CSPM | Keel `iam-hygiene`(MFA·키 나이·정적 키 수) · `secret-exposure`(secret-scanning · Dependabot critical) · **Prowler 주간 실행**(CIS AWS 벤치마크, OIDC 읽기 역할, 결과 → 원장·Grafana) | 원장 기록, 패널, Prowler 리포트 1회 |
| Respond | 런북 v2 · 채널 | 워크로드 침해·데이터 유출 절차 · Slack webhook 설정 | 문서, 알림 1회 |
| Recover | 롤백 검증 | `rollback.yml` 실제 실행 1회(현재 "미검증" 표기) | 실행 기록 |

이력 문장: "워크로드 최소권한 실행 표준, 데이터 인벤토리, 보안 자세 상시 관측(Keel), 롤백·대응 절차 검증".

### Stage 3 — Optimized (트리거 충족 시)

| 기능 | 항목 | 적용 트리거 | 준비 상태 |
|---|---|---|---|
| Detect·Respond | 자동 시정 3종(SG 22 공개 revoke · S3 공개 차단 · 90일 키 비활성) | 운영자 ≥2 · 리소스 ≥100 | Config 없이 구현: Prowler 결과 → Keel → SSM 없이 CLI 시정 스크립트. Config·Security Hub 코드는 과금이라 사용 안 함 |
| Protect | NetworkPolicy + PSA restricted | 노드 ≥2 또는 제3자 워크로드 | §3.5 |
| Protect | ESO + SSM Parameter Store | 팀 ≥2 또는 회전 주기 요구 | §3.5 |
| Protect | EBS 루트 볼륨 재암호화 | 다음 노드 재생성에 동반 | 기본 암호화는 Stage 1 |
| Protect | Trivy · npm audit 게이트 · digest 핀 · Actions SHA 핀 | Dependabot critical 월 1건 이상 또는 배포 빈도 증가 | §3.5 |
| Protect | WAF | 인그레스 로그 공격 패턴 · 429 급증 | — |
| Identify·Protect | DSPM 심화(RLS 게이트 · 전체 export · 네트워크 제한) | 프론트→DB 직접 접근 확대 · 개인정보 처리방침 갱신 | §3.6 |
| Protect | AI 인젝션 격리 · 출력 가드 · 모델 allowlist | 챗봇 tool-use 도입 또는 사용량 임계 | §3.7 |
| Protect | 운영자 접근 전환(Tailscale SSH / SSM) · IAM Identity Center | 운영자 ≥2 | §3.3 |
| Govern | 외부 기준 대조(CIS 벤치마크 점수 · 취약점 신고 창구 공개) | 고객 요청 또는 공개 트러스트 페이지 | README 기반 |

## 6. 비용·마찰·롤백

| Stage | 월 비용(추정) | 정지 | 마찰 | 롤백 |
|---|---|---|---|---|
| 1 | **0 USD** (GuardDuty 제거. 잔여 = CloudTrail S3 저장 수 MB, 첫해 무료 구간 뒤 월 1센트 미만) | 0 | CC CLI MFA 세션 36h · OAuth secret 회전 시 로그인 재검증 | 키 재발급 · 정책 detach · `enable_security_baseline=false` · OIDC 역할 destroy |
| 2 | 0 | 0 (롤링) | 없음 | ArgoCD 이전 리비전 |
| 3 | 항목별 | EBS 교체 시 10–15분 | — | 항목별 |

## 7. 이력 기술용 사실 구분

### 7.1 현재 시점에 사실인 것 (구현 전에도 인용 가능)

- 인그레스 TLS 자동 발급·갱신(cert-manager), HSTS preload, 보안 헤더 4종, `/api` 30 rps 리밋, 관리 콘솔(ArgoCD·Grafana) 인터넷 미노출.
- ECR pull 을 인스턴스 프로파일 + kubelet credential provider 로 처리해 이미지 pull 시크릿 0. IMDSv2 강제.
- CI IAM 정책을 문장 단위 최소권한으로 작성(IAM 은 읽기만, `s3:DeleteBucket` 제외), CI 로그 계정 ID 마스킹, terraform plan-in-PR + 일일 드리프트 검사.
- Supabase JWT ES256/JWKS 검증(verify-only), 관리자 경계 `is_super_admin` 101/102, 봇 쓰기 1회용 승인 토큰, 서비스 role 키 프론트엔드 0.
- 관측 경로는 읽기전용 DB role + 테이블별 RLS 정책을 PreSync 훅이 생성·회전(사람이 비밀번호를 타이핑하지 않음).
- 일일 DB 백업 → S3(SSE·버저닝·PAB·30일 보존), 실패 시 이슈 자동 생성. LLM 비용 게이트 L1–L5 + 크레딧 차단기 + 호출 원장.
- Keel: 8개 불변식 30분 주기 검사, `error_events` 원장, 전이 시 알림.

### 7.2 Stage 완료 시 추가되는 사실 (§8 증거와 함께)

- Stage 1: 노출 자격증명 종결, CI 정적 자격증명 0(OIDC), 콘솔 MFA 강제, CloudTrail·GuardDuty·알람 3종·알림 파이프라인을 IaC 로 선언, 대응 런북, 복원 리허설 기록, EBS 기본 암호화.
- Stage 2: 워크로드 최소권한 실행 표준, 데이터 인벤토리, Keel 보안 검사 2종, 롤백 검증, 분기 리뷰.
- Stage 3: 트리거 충족 항목만.

## 8. 증거표 (구현 시 채움)

| 통제 ID | Stage | 증거 유형 | 값 | 확인일 |
|---|---|---|---|---|
| ICS-ACC-01 | S1 | CloudTrail | trail `insighta-trail` 멀티리전, 무결성 검증, S3 `insighta-audit-logs` + CloudWatch Logs `/aws/cloudtrail/insighta-trail`(90일). `get-trail-status IsLogging=true`, 로그 스트림 수신 확인. `terraform/modules/security-baseline` (PR #1626, #1628) | 2026-09-11 |
| ICS-ACC-04 | S1 | 위협 탐지 | GuardDuty 는 적용 후 같은 날 제거(과금 금지 규칙). 대체 = CloudTrail 지표 알람 8종(`insighta-*`: root-account-use · console-login-without-mfa · unauthorized-api-calls · iam-policy-changes · cloudtrail-changes · security-group-structure-changes · s3-bucket-exposure-changes · network-changes), 무료 10개 구간 내. PR #1630 | 2026-09-11 |
| ICS-ACC-05 | S1 | Access Analyzer | `insighta-account` ACTIVE | 2026-09-11 |
| ICS-ACC-07 | S1 | 비밀번호 정책 | 최소 14자 · 복잡도 · 90일 · 재사용 24회 금지 | 2026-09-11 |
| ICS-ACC-08 · ICS-OBS-05 | S1 | 알림 경로 | SNS `insighta-security-alerts`, CIS 알람 3(`insighta-root-account-use` OK · `insighta-console-login-without-mfa` · `insighta-unauthorized-api-calls` OK). 이메일 구독 = **PendingConfirmation**(support@ 수신함에서 확인 필요) | 2026-09-11 |
| ICS-IAM-01 | S1 | CI 정적 자격증명 0 | OIDC provider + 역할 `insighta-github-actions`(정책 4: terraform-ci · ec2-modify · ecr · security-read), 워크플로 5개 `role-to-assume`(PR #1627). 검증 실행: keel `34566177836` · terraform drift `34566179623` · apply `34566778770`(No changes). 사용자 `github-actions-terraform` 키 Inactive, GitHub `TF_AWS_*` 시크릿 삭제 | 2026-09-11 |
| ICS-IAM-04 | S1 | 휴면 자격증명 | `slidegen-prh` 미사용 키 Inactive. credential report: 활성 키 = admin 1개만 | 2026-09-11 |
| ICS-IAM-02 | S1 | MFA 강제 | 정책 `insighta-require-mfa` 생성, 부착 0(`mfa_required_users=[]`). admin 가상 MFA 등록 후 부착 | 2026-09-11 (대기) |
| ICS-K8S-10 | S1 | EBS 기본 암호화 | `EbsEncryptionByDefault=true` (루트 볼륨 재암호화는 S3) | 2026-09-11 |
| ICS-NET-01 | S1 | SG 22 정리 | 누적 /32 16 → 2(현재 운영 기기 + VPC CIDR). SSH 정상 | 2026-09-11 |
| ICS-SC-05 | S1 | push protection | `secret_scanning_push_protection=enabled` | 2026-09-11 |
| ICS-SC-02 | S1 | Dependabot alerts | 활성(open: medium 1) | 2026-09-11 |
| ICS-DATA-12 | S1 | 노출 종결 | alert #4(Supabase 키) = 로컬 self-hosted 개발 키(`ref` 없음), prod 키와 해시 불일치 → resolved. #1(Google API 키) prod 미사용, GCP 삭제 대기. #2·#3(Google OAuth ID·secret) **prod·Supabase Auth 현재값과 일치 → 재발급 대기**(`scripts/ops/rotate-youtube-oauth-secret.sh`) | 2026-09-11 |
| ICS-DATA-06 | S1 | 복원 리허설 | **성공** — 108 테이블 행 수 0 mismatch, 1,482 MB, 복원 39초(전체 약 5분). 절차 결함 2건 발견·수정(`vector` 확장 선행, PG17 대상). `restore-drills.md`, `scripts/ops/restore-drill.sh` | 2026-09-11 |
| ICS-GOV | S1 | 런북·설명 | `README.md` · `incident-runbook.md` v1 (PR #1625) | 2026-09-11 |

## 9. 결정·액션 대기 (James)

Stage 1 중 CC 가 할 수 있는 항목은 2026-09-11 에 전부 적용됐다(§8). 남은 것은 James 의 계정·기기가 필요한 4건이다.

1. **admin 가상 MFA 등록**(AWS 콘솔 → IAM → 사용자 admin → 보안 자격 증명 → MFA 디바이스 할당). 등록 후 CC 가 `mfa_required_users=["admin"]` 을 머지해 정책을 부착한다. 이후 CC 의 CLI 는 `scripts/ops/aws-mfa.sh <코드>` 로 36시간 세션.
2. **Google OAuth client secret 재발급**(GCP 콘솔 "보안 비밀 추가") → 파일 저장 → CC 가 `scripts/ops/rotate-youtube-oauth-secret.sh` 실행 → James 가 Supabase Auth 와 로컬 `.env` 갱신 → 검증 후 옛 시크릿 Disable/Delete. 같은 화면에서 2025-12 경 발급된 API 키 삭제.
3. **SNS 구독 확인** — support@insighta.one 수신함의 "AWS Notification - Subscription Confirmation" 링크 클릭.

## 10. 실측 기록 (2026-09-11, 값 미기재)

- AWS: `sts get-caller-identity` · `cloudtrail describe-trails` · `guardduty list-detectors` · `configservice describe-configuration-recorder-status` · `securityhub describe-hub` · `accessanalyzer list-analyzers` · `iam get-account-summary` · `iam get-account-password-policy` · `iam list-users/list-mfa-devices/list-access-keys` · `iam get-credential-report` · `iam list-open-id-connect-providers` · `ec2 describe-instances`(IMDS·프로파일) · `ec2 describe-volumes` · `ec2 describe-security-groups` · `ec2 get-ebs-encryption-by-default` · `ecr describe-repositories` · `s3api get-public-access-block/get-bucket-encryption/get-bucket-versioning`.
- 클러스터(`scripts/ops/ssh.sh k3s`): `kubectl get ns --show-labels` · `get netpol -A` · `get ingress -A` · `get clusterissuer,certificate -A` · `get applications -A` · `get secrets -A` · `k3s secrets-encrypt status` · `get pods -A -o custom-columns=(securityContext·SA·automount)` · `get clusterrolebinding/rolebinding` · `/etc/rancher/k3s/config.yaml` · `ss -ltnp` · `sshd -T` · unattended-upgrades · ufw/fail2ban.
- GitHub(`gh api`): 리포 가시성 · 브랜치 보호 · `security_and_analysis` · secret-scanning alerts(유형·경로만) · Dependabot 상태 · code-scanning · environment `production` 보호 규칙 · 워크플로 자격증명 방식 grep.
- 코드: origin/main `00c5c302` 를 두 감사 에이전트가 파일 단위로 인용(§1.2 경로).
