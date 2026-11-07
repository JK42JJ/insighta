---
id: WO-2026-11-04-rules-r02-allowlist-r32
status: running
owner: insighta-session
opened: 2026-11-04
---

# 목표
두 가지 결정을 규칙으로 기록한다. (1) Slack 인플레이스 승인이 노드 증설 규칙의 "명시 승인"을 충족한다. (2) 자동 알림은 수신자 James · 채널 두 개로 한정한다.

# 맥락
- 결정: James 2026-11-04 (PRD v1.2 Q20 · Q21).
- 노드 증설 규칙은 repo 에 없고 memory `feedback_node_expansion_needs_slack_approval` 에만 있다. 원장은 R31 에서 끝난다. 그래서 문구 수정이 아니라 R32 신설이다.
- 이 PR 은 R01 개정 PR(#1766) 위에 쌓았다. 같은 원장 · CLAUDE.md 의 인접 줄(R01/R02)을 바꾸므로 base 를 분리하면 충돌한다.

# 제약
- 문서만 바꾼다. 코드 · 훅 · 워크플로 · Slack 설정을 건드리지 않는다.
- 아직 없는 집행 장치를 "있음" 으로 적지 않는다 (R18). `Production` reviewer 는 설정 전이다.
- 허용 목록은 메일을 포함하지 않는다. `email-send-guard.sh` 는 건드리지 않는다.
- #1766 이 머지되기 전에는 이 PR 을 머지하지 않는다. `ci.yml` 이 main 대상 PR 에서만 돌므로 base 는 main 으로 두고, #1766 의 커밋이 diff 에 함께 보인다.

# 검증 기준
- [ ] `git diff docs/r01-agent-loop-amendment --stat` → `CLAUDE.md` · `docs/ops/rules-ledger.md` · 이 오더만
- [ ] `grep -n "^| R3[12]\|^| R02" docs/ops/rules-ledger.md` → R02 · R31 · R32 행이 존재하고 R32 가 표 안에 있다 (표 깨짐 없음)
- [ ] `grep -n "R02\|R32" CLAUDE.md` → 원장과 같은 허용 목록 · 같은 승인 정의
- [ ] `git grep -n "R01~R3" CLAUDE.md` → `R01~R32`
- [ ] 원장 R32 의 "승인 아님" 목록이 memory 원문("채팅 응답이나 침묵은 승인이 아니다")과 같은 의미

# james
- 머지 순서: #1766 → 이 PR. 규칙 변경이라 둘 다 James 머지.
- `Production` 환경 reviewer 지정(PR-B)은 James 설정. 그 전에는 R32 의 승인 기록이 생기지 않으므로 증설 불가가 유지된다.

# restated
Slack 에서 누른 승인이 GitHub `Production` 환경 승인 기록이므로 노드 증설의 명시 승인으로 인정한다. 자동 알림은 James 수신 · 두 채널만 허용하고 나머지는 재지시를 받는다.

# 결과
2026-11-04 실측:
- `git diff docs/r01-agent-loop-amendment --stat`: CLAUDE.md +5/-3 · rules-ledger.md +21/-1 (이 오더 제외). 코드 · 훅 · 워크플로 변경 0.
- 원장 표: R02 · R31 · R32 행이 한 표 안에 이어진다 (R01 7행 ~ R32 38행, 표 중간 비표 줄 없음).
- CLAUDE.md: `R01~R32`(3행), R02 허용 목록(23행), R32(48행). 원장과 같은 문구.
- 미검증: 노드 증설이 terraform apply 경로를 탄다는 점(추정), `Production` reviewer 미설정 상태(James 작업), 허용 목록의 코드 집행(없음, 원장에 그렇게 기재).
- 롤백: 머지 전이면 PR 닫기, 후면 revert. 문서만.
