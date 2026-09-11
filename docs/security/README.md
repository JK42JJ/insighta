# Insighta 보안 (Security at Insighta)

Insighta 가 "보안" 을 어떻게 정의하고 운영하는지 한 장으로 설명하는 문서. 대상 = 사용자 · 파트너 · 채용 면접관 · 다음 세션의 운영자. 설계 근거와 실측은 `cloud-security-architecture-2026-09-11.md`, 통제 목록은 `control-catalog.md`, 사고 절차는 `incident-runbook.md`.

## 1. 원칙

1. **신원 중심.** 네트워크 위치나 공유 비밀이 아니라 신원 · 역할 · 시한 토큰으로 접근을 판정한다. 정적 자격증명은 목록으로 관리하고 0 을 향해 줄인다.
2. **선언 · 측정 · 시정.** 통제는 코드(IaC · 차트 · 워크플로)로 선언되고, 측정 경로(CloudTrail · GuardDuty · Keel)가 있고, 시정 경로(자동 또는 런북)가 있어야 존재하는 것으로 본다.
3. **최소권한 · 격리.** 사람 · CI · 워크로드 · 봇 각각이 필요한 만큼만 가진다.
4. **데이터 중심.** 어떤 데이터가 어디에 어떤 등급으로 있고 누가 읽는지를 문서와 코드로 유지한다.
5. **증거.** 모든 통제는 리소스 ID · 파일 · PR · 검사명으로 인용할 수 있어야 한다.
6. **지속.** 단계마다 여섯 기능(거버넌스 · 식별 · 보호 · 탐지 · 대응 · 복구) 전부에 최소선을 두고, 분기 리뷰로 다음 칸을 정한다. 규모가 바꾸는 것은 도구와 깊이이지 기능의 존재 여부가 아니다.

## 2. 책임 공유

| 계층 | 제공자 | Insighta |
|---|---|---|
| AWS (us-west-2) | 물리 · 하이퍼바이저 · 관리형 서비스 자체 | 계정 설정 · IAM · 네트워크 · 노드 OS · k3s · 암호화 설정 · 워크로드 |
| Supabase Cloud | PostgreSQL · Auth 서비스 운영 · 인프라 백업 | RLS · 역할 · 키 관리 · SSL 강제 · 데이터 분류 · 자체 백업 |
| GitHub | 플랫폼 · secret scanning · 러너 | 브랜치 보호 · 시크릿 관리 · 워크플로 권한 · OIDC 신뢰 · 의존성 대응 |
| LLM 공급자 | 모델 호스팅 · API | 프롬프트 격리 · 소비 통제 · 데이터 최소화 · 모델 allowlist |

## 3. 운영 모델

여섯 기능(NIST CSF 2.0) × 성숙도 3단계. 각 단계는 여섯 기능 전부를 포함한다.

| 기능 | 지금 있는 것 (2026-09-11 실측) | 다음 칸 |
|---|---|---|
| Govern | 통제 카탈로그 ICS-* (약 60 통제, CIS · ASVS · OWASP LLM 매핑), 본 문서, 설계, 사고 대응 런북 v1 | Stage 2: 분기 리뷰 |
| Identify | 계정 · 클러스터 · 리포 · 앱 전 계층 실측, 노출 이력 해시 대조(4건 판정), Dependabot alerts | Stage 2: 데이터 인벤토리 |
| Protect | CI 정적 자격증명 0(GitHub OIDC 역할, 2026-09-11) · 휴면 키 비활성 · 비밀번호 정책 · EBS 기본 암호화 · push protection · SSH 허용 목록 2건, TLS 자동 갱신 · HSTS · 보안 헤더 · rate limit, JWT 검증(verify-only) · 관리자 경계 · 봇 쓰기 승인 토큰, 이미지 pull 시크릿 0 · IMDSv2, CI 최소권한 정책, 사용자 키 AES-256-GCM, 관리 콘솔 미노출 | Stage 1 잔여: admin MFA 강제 · OAuth secret 회전 · Stage 2: 워크로드 최소권한 |
| Detect | CloudTrail(멀티리전, S3 + CloudWatch Logs) · CIS 알람 3(root 사용 · MFA 없는 로그인 · 권한 거부 급증) · GuardDuty · Access Analyzer, Keel 8 불변식(30분) · TLS 만료 · LLM 지출 · 공개면 | Stage 2: Keel 보안 검사 |
| Respond | SNS 알림 토픽(GuardDuty ≥7 · 알람 3) · 런북 v1, LLM 크레딧 차단기 · 비용 게이트 · 백업 실패 시 이슈 자동 생성 | Stage 1 잔여: 구독 확인 · Stage 2: Slack · 런북 v2 |
| Recover | 일일 DB 백업(S3 · SSE · 버저닝 · 30일) · 복원 리허설(`restore-drills.md`), 롤백 3층(차트 태그 · ArgoCD 리비전 · IaC 재구축) | Stage 2: 롤백 실행 검증 |

## 4. 지속 루프

측정(Keel 30분 · CloudTrail 상시) → 판정(`error_events` 원장 · 알람) → 시정(자동 시정 또는 런북) → 기록(설계 §8 증거표) → 분기 리뷰(카탈로그 상태 · 트리거 재평가 · 다음 단계 선정).

## 5. 데이터

- 저장 위치: Supabase Cloud(us-west-2) · S3 백업(us-west-2) · 클러스터 Redis(캐시) · Mac Mini(수집 임시).
- 개인정보: 이메일 · 이름 · 아바타(Google OAuth), 시청 상태 · 노트 · 만다라(사용자 콘텐츠), YouTube OAuth 토큰과 사용자 LLM 키(앱 계층 암호화).
- 사용자 권리: 설정에서 계정 데이터 삭제(9 테이블) · 노트 export. 전체 export 와 계정 자체 삭제는 로드맵.
- 전송 암호화: 엣지 TLS(HSTS), DB `sslmode=require`.

## 6. 취약점 신고

support@insighta.one. 접수 → 재현 · 영향 판정 → 수정 → 회신. 공개 히스토리에 남은 과거 자격증명은 회전 여부를 대조해 종결하며, 신규 노출은 push protection 이 차단한다.

## 7. 로드맵

Stage 1 Foundational(자격증명 · 감사 · 대응 · 복원) → Stage 2 Managed(워크로드 · 인벤토리 · 상시 관측) → Stage 3 Optimized(자동 준수 · 자동 시정 · 격리 · DSPM · AI). 각 단계의 항목 · 검증 · 트리거는 설계 §5.
