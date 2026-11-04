---
id: WO-2026-11-04-weekend-sprint-harness-v1.1
status: running
owner: insighta-session
opened: 2026-11-04
---

# 목표
James 의 "주말 48시간 스프린트 하네스" 제안서를 현재 코드베이스와 규칙(R01, main 머지 = prod, 노드 증설 규칙)에 맞게 현행화하고, 금요일 세팅 체크리스트와 결정 질문을 문서로 남긴다.

# 맥락
- 입력: James 가 대화에 붙여 넣은 제안서 본문(2026-11-04). `docs/sprint/weekend-sprint-harness.md` 는 작업 트리와 `origin/main` 에 없다.
- 산출: `docs/sprint/weekend-sprint-gap-analysis.md`, `docs/sprint/weekend-sprint-harness-v1.1.md`.
- 관련: R01 개정 PR #1766, 원장 R02/R32 PR #1768, PRD v1.2 PR #1767.

# 제약
- 문서만 바꾼다. 코드 · 설정 · 워크플로 · 토큰 · 브랜치(통합 브랜치 포함)를 만들지 않는다.
- 이니셔티브(S1) 내용은 다루지 않는다. James 가 따로 준다.
- 설문 응답 원문 등 개인 정보를 이 repo(public)에 쓰지 않는다.
- 확인하지 못한 사실은 "미검증" 으로 표기한다.

# 검증 기준
- [ ] `git diff origin/main --stat` → `docs/sprint/` 2개 + 이 오더만
- [ ] 분석 문서의 사실 F1~F17 각각에 근거(경로 또는 조사 출처)가 있다
- [ ] 워크플로 인용 확인: `ci.yml` 트리거가 `pull_request` + `branches: [main]` 인지 `git show origin/main:.github/workflows/ci.yml` 로 대조
- [ ] 샌드박스 키 3종 이름이 공식 문서 조사 결과와 일치
- [ ] 질문 S1~S9 와 금요일 체크리스트 A~E 가 v1.1 안에 존재

# james
없음 (문서 PR). 질문 S2 · S3 · S6 · S7 · S8 · S9 는 금요일 세팅 전에 답이 필요하다.

# restated
제안서의 전제를 repo 사실과 대조해 어긋난 곳을 찾고, 수정안과 금요일 준비 목록을 남긴다. 구현은 하지 않는다.

# 결과
2026-11-04 실측:
- 분석 문서: F1~F17 17행 모두 근거 열 있음. F2 는 `ci.yml` 15행 `branches: [main]` 로 재대조 완료. F3 은 이 세션의 보호 API 조회 결과(재조회는 메모리 가드가 막아 하지 못함).
- 샌드박스 키 3종: 공식 문서 조사 결과와 일치(`sandbox.failIfUnavailable`, `sandbox.allowUnsandboxedCommands`, `sandbox.network.strictAllowlist`).
- v1.1: 체크리스트 A~E, 질문 S1~S9 존재. 비밀 패턴 검색 0건.
- 미검증: 원본 파일 위치, Codespaces 무료 할당 · 사양 · 장시간 유지, 컨테이너 안 DB · headless 브라우저, Ultra 한도 수치, 세션의 자기 사용량 조회, `CLAUDE.local.md` 지원, GitHub 알림 기본값.
- 코드 · 설정 · 브랜치 · 토큰 변경 0. 롤백: PR 닫기 또는 revert.
