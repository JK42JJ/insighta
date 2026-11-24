---
id: WO-2026-11-04-launch-sprint-plan
status: running
owner: insighta-session
opened: 2026-11-04
---

# 목표
월요일(11-09) 초대 사용자 출시를 위한 스프린트 환경 구축안, P0~P2 과제 목록, 금요일 시험 운전 계획, 일요일 출시 체크리스트를 문서로 남긴다.

# 맥락
- 입력: James 2026-11-04 답변(S2 Codespaces, S3 Ultra, S6~S9, R32 유지, PR-B 월요일 이후, Q15~Q19, 출시 P0 5개).
- 산출: `docs/sprint/launch-2026-11-09/{README,environment-codespaces,tasks,friday-dry-run,sunday-launch-checklist,thursday-verify-run}.md` + `invite-fallback-email-magic-link.md` + `drafts/` 4개(목요일 실행 초안, 미실행).
- 2차 반영(2026-11-04 밤): 하네스 §0.1 최신판 수신, S2' = 4코어 + 예산 $20, verify 목요일 선실행, SCH-1 금~토 선머지, PR-B 조건부, INV-1 설정만, INV-4 pro 30일.
- 관련: #1766(R01), #1767(PRD v1.2), #1768(R02/R32), #1769(PR-A), #1770(스프린트 현행화), #1771(이슈 폼).

# 제약
- 문서만 바꾼다. 코드 · 설정 · 워크플로 · 저장소 · 토큰 · 코드스페이스를 만들지 않는다.
- 하네스 §0.1 은 받지 못했다. 반영한 척하지 않는다.
- 확인하지 못한 사실은 "미검증" 으로 표기한다. verify 명령은 이 세션에서 실행하지 못했음을 명시한다.
- 비밀 값 · 설문 원문 없음.

# 검증 기준
- [ ] `git diff origin/main --stat` → `docs/sprint/launch-2026-11-09/` 문서 6개 + `drafts/` 4개 + 이 오더만
- [ ] 비밀 패턴 검색(`xox`, `ghp_`, `postgres://`, `AKIA`, `sk-ant`) → 0건
- [ ] 인용한 워크플로 사실을 `origin/main` 과 대조: `terraform.yml:137` 의 `environment: production`, `deploy.yml` 에 `environment:` 없음, `e2e.yml:6` 은 입력 이름
- [ ] `tasks.md` 의 모든 과제 ID 가 `sunday-launch-checklist.md` 의 머지 순서 또는 `tasks.md` 컷 라인에 한 번 이상 나온다
- [ ] 12시간 수명 · 코어시간 · 환경 이름 대소문자 · 보호 규칙 범위의 출처(문서 조사)가 README 또는 환경 문서에 표기

# james
- 환경 문서 §3 의 S2'(코드스페이스 지출: 결제 수단 · 예산 상한 · 활성 구간 (a)/(b)/(c)).
- `tasks.md` INV-1(서버 가입 게이트 vs 설정만), INV-4(초대 시 등급).
- 이 문서들의 승인 전에는 코드스페이스 · repo · 토큰을 만들지 않는다.

# restated
James 의 결정을 반영해 출시 스프린트의 환경 · 과제 · 시험 · 출시 절차를 문서로 확정한다. 조사에서 나온 제약(코드스페이스 12시간 수명, 무료 코어시간 한도, PR-B 의 게이트 범위, 출시 DDL 머지가 곧 prod 마이그레이션)을 숨기지 않고 앞에 둔다.

# 결과
2026-11-04 실측:
- 문서 5개 + 오더. 비밀 패턴 검색 0건. 과제 ID 23개 전부 컷 라인 또는 일요일 머지 순서에 등장(INV-5 누락을 발견해 컷 라인에 추가).
- 워크플로 대조: `terraform.yml:137` 만 `environment:` 사용, `deploy.yml` 에 `environment:` 없음(잡 목록 확인), `e2e.yml:6` 은 `workflow_dispatch` 입력 이름.
- 출처: Codespaces 12시간 수명 · 유휴 상한 240분 · 코어시간 한도 · 환경 이름 대소문자 무시 · 보호 규칙은 해당 환경을 참조하는 잡에만 적용은 GitHub 공식 문서 조사(요약 도구 경유, 12시간 수명은 라이브 페이지 재확인 필요).
- 미검증: verify 명령 전부(이 머신은 메모리 압력으로 Jest 불가, 새 테스트 파일 없음) → 금요일 시험 운전 4단계에서 확정. 머신 RAM, 기본 토큰 범위, `NET_ADMIN`, 컨테이너 PostgreSQL + pgvector, Supabase 신규 가입 비활성화의 Google 효과, prod 의 `recommendation_feedback` 존재, Ultra 도움말 내용.
- 2차 반영 실측: 과제 ID 27개(INV-0, OPS-1~3 추가) 전부 컷 라인 또는 일요일 체크리스트에 등장. `user:password@` 형 URL 0건(초안의 로컬 DB 접속을 소켓 peer 인증으로 바꿈). `user_subscriptions` 에 만료 컬럼이 없음을 `prisma/schema.prisma` 에서 확인 → SCH-1 에 `tier_expires_at` 추가. 서비스 · 배포 설정에 `ANTHROPIC_API_KEY` 이름 없음(grep).
- 2차 미검증: `drafts/` 의 스크립트 · tsv · devcontainer 는 한 번도 실행하지 않았다(목요일에 James 가 실행). pgvector 패키지 이름, 4코어 RAM, Google 가입 차단이 설정만으로 되는지, 기존 계정과 Google 아이덴티티 연결.
- 3차 반영(밤): INV-1a prod 금요일 시험(시험 창 · 상태 기록 표), 5b-4 실패 대안 문서, S7b DB 테이블, INV-4a 수동 강등, (c) 연기, 비용 기록 표(README §13). **비용은 실측 전이라 추정과 빈 칸만 있다** — 주말 후 James 가 청구 화면 값으로 채운다.
- 롤백: PR 닫기 또는 revert. 문서만.
