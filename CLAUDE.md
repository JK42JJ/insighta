# Insighta — Project Rules

규칙은 한 줄씩. 근거 사고와 집행 장치는 `docs/ops/rules-ledger.md`(R01~R30). 작업 방식은 `docs/ops/working-method-2026-09-11.md`. 제품의 기록은 `docs/spec/README.md`. 작업 단위는 `docs/work-orders/`.

## 세션 시작

1. `docs/spec/README.md` 를 읽는다 (표면 · 상태 · 수용 기준).
2. `bash scripts/ops/work-orders.sh` 로 열린 오더를 본다. 오더 없는 코드 변경은 하지 않는다.
3. 참조가 필요할 때만 `memory/` 를 읽는다. 세션 역할: 이 리포 = insighta 서비스. career 리포 · 이력서는 다른 세션 소유(R24).

## 작업 방식

- 오더 = 목표 · 맥락 · 제약 · 검증 기준. 시작 전에 검증 기준을 `restated:` 에 내 말로 적는다. 비어 있으면 제안하고 `draft`.
- 되돌릴 수 있는 것(코드 · 문서 · 브랜치 · PR · 스테이징 · 읽기 조회 · 워크트리 정리)은 실행하고 다이제스트로 보고한다. 되돌릴 수 없는 것(발송 · 결제 · 삭제 · 비용 · 방향 · 시크릿 재발급)만 James 가 정한다(R14).
- 막히면 채팅으로 되묻지 않는다. `docs/work-orders/QUESTIONS.md` 에 적고 다음 오더로 간다(R16).
- 완료 = 오더 검증 기준 전부 실측 + PR 네 칸(Changed · Verified · Not verified · Spec) + prod 확인. 하나라도 비면 "진행 중"(R07). "완료" 라는 단어는 그 뒤에만.
- 독립 작업은 병렬(서브에이전트 · 워크트리). 세션 종료 시 워크트리 제거(R30).
- 저녁: `bash scripts/ops/digest.sh`. James 는 3줄(핵심 3 · 근거 · 반례)로 답한다.

## 절대 규칙 (집행 장치는 원장 참조)

- R01 LLM API(Anthropic · OpenRouter) 를 데이터셋 · 실험 · 테스트에 쓰지 않는다. 서비스 코드 경로만.
- R02 메일 · 알림 발송은 James 의 "보내" 후에만. 검수 사본도 발송이다.
- R03 시크릿 이름 · 값 추측 금지. `memory/credentials.md` 만.
- R04 EC2 · k3s 접근은 `scripts/ops/ssh.sh` 로만.
- R05 `.env*` 수정 · 교체 · 삭제 금지. prod 실행은 인라인 env.
- R06 DB 는 로컬 → prod. 새 테이블 · 컬럼은 Prisma + raw SQL DDL 동봉, 배포 후 `\d` 실측.
- R08 프론트엔드 변경은 `/verify` PASS 없이 push 금지.
- R09 새 함수 · 훅 · API 에 테스트 1, 버그 수정에 회귀 1. 기존 테스트 삭제 · skip 금지.
- R10 D&D 로직 · `DndContext` 위치(AppShell) 변경 금지.
- R11 CSS 색 literal · 매직 넘버 · env 직접 읽기 금지. `src/config/**` · 토큰. `hardcode-audit` baseline 은 감소만.
- R12 비밀 아닌 설정은 Secrets 에 두지 않는다.
- R13 추측 전 소스를 읽는다. 시각 보고는 className 실측부터. 수치 튜닝은 측정 증거. "신규" 전에 기존 존재 grep. 게이트 신호는 DB 실측.
- R15 코드 · prod 에서 확인 가능한 것을 James 에게 묻지 않는다.
- R17 prod 사실은 권위 출처(CloudTrail · `on:` · 정책 시뮬레이션)로 확인한다.
- R18 고칠 수 있는 결함에 "알려진 한계" 라벨 금지.
- R19 기술 문서는 기술 용어만. 의인화 · 서사 · 감정어 금지.
- R20 코드 작성 · 실행 전 롤백 자산과 좌표를 남긴다.
- R21 같은 파일 · 테스트를 다시 여는 항목은 한 PR.
- R22 진단 전 `grep -rli <서비스> memory/`. 지시 범위 밖 코드 금지.
- R23 보안에 돈 쓰지 않는다. 유료 서비스(무료 체험 후 과금 포함) 금지. 우회 · 오픈소스.
- R25 자막은 맥미니 yt-dlp + 프록시 경로만.
- R26 prod 데몬 · 인프라 무단 재시작 금지.
- R27 외부 API · 다운로드 임의 사용 금지. "이미 있나" 부터.
- R28 새 admin 라우트는 `authenticate + authenticateAdmin`, 머지 전 무인증 401.
- R29 커밋 · PR 본문은 영문(`grep -P "[가-힣]"` = empty). 파일 안 UI · 문서는 한글 가능.

## 리포 사실

- 두 리포: `~/cursor/insighta`(이 프로젝트) · `~/cursor/superbase`(self-hosted Supabase). 로컬 Edge Function 은 `superbase/volumes/functions/main/index.ts` 단일 디스패처(수정 시 두 곳 + `sync-edge-functions.sh` + 컨테이너 재시작).
- ALTER 직후 PostgREST 스키마 리로드(로컬 `NOTIFY pgrst`; prod 대시보드).
- 새 컬럼은 write path 전수 검토(`grep -n "\.from('<table>')"`).
- service 도메인(mandala · resource · note · insight) ≠ system 도메인(pattern · decision · problem). Bot 은 service 만.
- 삭제 금지: `scripts/agent-dashboard.sh` · `scripts/ops-dashboard.sh` · `.claude/**` · `prompt/**` · `docs/**/*.md` · `terraform/README.md` · `tests/README.md` · `tests/RESULTS_TEMPLATE.md` · `tests/manual/README.md`.
- 컨벤션 상세: `docs/CODING_CONVENTIONS.md`. 3단계 이상 상대 import 금지(`@/`). 컴포넌트 삭제 대신 `-legacy/` + `@deprecated`.
