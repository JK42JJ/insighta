---
id: WO-2026-11-04-agent-loop-prd-v1.2
status: running
owner: insighta-session
opened: 2026-11-04
---

# 목표
상시 에이전트 루프의 현황 조사 · 차이 분석 · PRD v1.1 · v1.2 · Slack 승인 채널 설정 체크리스트를 repo 에 기록해, 이후 구현 PR 이 같은 근거를 가리키게 한다.

# 맥락
- 입력: James PRD v1.0 (2026-11-04), v1.1 검토 답변.
- 산출: `docs/agent-loop/{current-state,gap-analysis,PRD-v1.1,PRD-v1.2,slack-approval-setup}.md`.
- 관련: R01 개정 PR #1766, `WO-2026-11-03-stg-to-prod-promotion`.

# 제약
- 문서만 바꾼다. 코드 · CI · 워크플로 · 시크릿 변경 0.
- 현황의 모든 주장은 `origin/main` 또는 읽기 전용 `gh` 로 확인한 것이어야 하고, 확인하지 못한 것은 "미검증" 으로 표기한다.
- 존재하지 않는 장치를 있다고 적지 않는다 (R18).

# 검증 기준
- [ ] `git diff origin/main --stat` → `docs/agent-loop/` 5개 + 이 오더만
- [ ] `git grep -n "llm-call-ledger" -- docs/agent-loop` → 정정 표기 3건 외 "있음" 으로 서술한 곳 0
- [ ] `git ls-files | grep -i llm-call-ledger` → 0건
- [ ] v1.2 §3 의 파일 · 줄 인용(`deploy.yml` 226-251 · 393-445 · 447-615, `terraform.yml` 132-157)이 `git show origin/main:` 로 열어 본 내용과 일치

# james
- Slack 워크스페이스 생성, GitHub 앱 설치 · 연결, `Production` 환경 reviewer 설정은 `slack-approval-setup.md` D 절에 따라 James 가 직접 한다 (이 PR 은 절차 문서만).
- 이 PR 머지는 문서 변경이라 가역. v1.2 §6 의 질문은 다음 구현 PR 에서 필요할 때 묻는다.

# restated
조사와 결정 반영 문서를 repo 에 남긴다. 구현은 하지 않는다.

# 결과
2026-11-04 실측:
- 인용 줄 번호 대조: `deploy.yml` 226(edge) · 332(frontend build step) · 393(migrate) · 447(publish-tags), `terraform.yml` 132(apply) · 137(`environment: production`) · 156(`-auto-approve`) 모두 `git show origin/main:` 과 일치. `deploy-production` concurrency 는 `deploy.yml:34`.
- `llm-call-ledger`: 문서 안 언급은 전부 "존재하지 않음" 정정 표기. `git ls-files` 0건.
- 정정한 오류: 초안 `current-state.md` · `gap-analysis.md` · `PRD-v1.1.md` 가 원장 문구를 그대로 옮겨 이 CI 장치를 있는 것처럼 적었다. 4곳 수정.
- 미검증: 개인 계정 repo 룰셋의 우회 대상 지정 가능 범위, `Production`/`production` 대소문자 처리, Q1 답변(미수신).
- Slack 앱 명령어(`/github subscribe …`, `list features`) · 기능 이름 · 인플레이스 승인 동작은 GitHub 문서 기준 지식이며 실행해 확인하지 않았다. 체크리스트 H 절의 시험으로 확인하도록 했다.
- 롤백: PR 닫기 또는 revert. 문서만.
