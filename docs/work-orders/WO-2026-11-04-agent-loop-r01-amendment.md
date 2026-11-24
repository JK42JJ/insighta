---
id: WO-2026-11-04-agent-loop-r01-amendment
status: running
owner: insighta-session
opened: 2026-11-04
---

# 목표
상시 에이전트 루프(strategist · executor 등)가 LLM 을 호출할 수 있는 경로를 R01 에 명시하되, 지출이 한도 안에 묶이고 그 밖의 호출은 계속 금지되도록 규칙 문구를 개정한다.

# 맥락
- 결정: James 2026-11-04, PRD v1.1 Q8 = (a) R01 개정, Q9 = 월 $100 · 일일 카운터 $3 · 변경은 James 승인.
- 현행 R01: `docs/ops/rules-ledger.md` 7행, `CLAUDE.md` 22행.
- 설계: `docs/agent-loop/PRD-v1.1.md` §3.8 (트랙 B). 트랙 B 구현은 이 PR 이 머지된 뒤에만 시작한다.

# 제약
- **이 PR 은 James 가 머지한다.** 머지 전까지 현행 R01 이 유효하며 어떤 LLM 호출도 추가하지 않는다.
- 문서만 바꾼다. 코드 · CI · 워크플로 · 시크릿을 건드리지 않는다.
- 키 값 · 워크스페이스 ID 를 쓰지 않는다 (R03).
- 개정 문구는 현재 존재하는 집행 장치만 "있음" 으로 적는다. 아직 없는 장치는 "예정" 으로 구분한다 (R18).

# 검증 기준
- [ ] `git diff origin/main --stat` → 변경 파일은 `docs/ops/rules-ledger.md` · `CLAUDE.md` · 이 오더 3개뿐
- [ ] `grep -n "R01" docs/ops/rules-ledger.md CLAUDE.md` → 두 파일의 R01 문구가 서로 모순되지 않음
- [ ] `grep -n "llm-call-ledger" docs/ops/rules-ledger.md` → 삭제 근거를 적은 1건뿐 (존재하지 않는 장치를 "있음" 으로 적은 서술 제거)
- [ ] `git ls-files | grep -i llm-call-ledger` → 0건 (제거 근거)
- [ ] 커밋 훅(`commit-msg`) 통과, CI `done-gate` · `pr-body-english` 통과

# james
- 이 개정안의 머지 (개정 = 지출 허용 범위 변경이라 되돌릴 수 없는 결정으로 취급).
- 머지 후 James 가 Anthropic 콘솔에서 직접: `agent-loop` 워크스페이스 월 한도 $100 설정, 자동 충전 끔. 이 설정이 확인되기 전에는 키를 사용하지 않는다.
- 키 발급과 저장 위치 (CC 는 이름과 위치만 제안, 값은 James 가 넣는다).

# restated
R01 의 허용 경로를 "서비스 코드" 하나에서 "서비스 코드 + 에이전트 루프 전용 워크스페이스 키(월 $100 · 자동 충전 끔 · 일일 $3 초과 시 새 사이클 중지)" 둘로 늘린다. 데이터셋 · 실험 · 테스트 · 개발 세션의 임의 호출은 그대로 금지한다. 한도 변경은 James 승인. 존재하지 않는 `llm-call-ledger` 서술은 실제 집행 장치로 바로잡는다.

# 결과
2026-11-04 실측:
- 변경 파일 3개 (`CLAUDE.md` 1줄, `rules-ledger.md` +33/-2, 이 오더). 코드 · CI · 시크릿 변경 0.
- R01 문구: CLAUDE.md 22행과 원장 7행 · 39행이 같은 두 경로 · 같은 한도를 가리킨다.
- `llm-call-ledger`: `git ls-files` 0건, 트리 전체 `git grep` 0건 (원장의 삭제 근거 1건 제외).
- 미검증: 콘솔 워크스페이스 한도 · 자동 충전 설정 (James 작업), Keel 일일 카운터와 `hardcode-audit` Anthropic 규칙 (예정 이슈), "Max 포함" 크레딧의 정확한 범위 (James 표현 그대로 기재).
- 롤백: 머지 전이면 PR 닫기. 머지 후면 이 PR revert. 효과 범위는 문서뿐.
