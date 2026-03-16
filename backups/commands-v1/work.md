---
name: work
description: 최적 작업 단위 선정 → 계획 → 실행. /boot ↔ /checkpoint 사이클의 핵심 실행 단계.
allowed-tools: Bash(gh:*), Bash(git:*), Bash(npm:*), Bash(npx:*), Bash(cd:*), Read, Write, Edit, Grep, Glob, Agent, Bash(tail:*), Bash(wc:*)
---

`/boot`에서 복원한 맥락을 바탕으로, 가장 효과적인 작업을 선정하고 계획을 세운 뒤 실행한다.

사용법: `/work [target?]`
- target 생략 시: 자동으로 최적 작업 단위 선정
- target 지정 시: `#68` (story), `pending` (미완료 작업), `eval:D2` (Eval 취약점 개선), `fix:XXX` (특정 버그)

## 핵심 원칙

> `/work`는 **가장 높은 ROI의 작업**을 선정하여 실행하는 것이 목표다.
> 작업 단위가 너무 크면 쪼개고, 너무 작으면 묶는다.
> 계획 없이 코드를 작성하지 않는다.

## 실행 순서

### Phase 1: 작업 후보 수집 (병렬)

아래 소스에서 작업 후보를 수집한다. `/boot` 실행 후라면 대부분 이미 맥락에 있다.

```bash
# 1a. GitHub 오픈 스토리 (우선순위/의존성 포함)
gh issue list --label story --state open --json number,title,labels,body --jq '.[] | "#\(.number): \(.title) [\(.labels | map(.name) | join(","))]"'

# 1b. Pending Work (checkpoint.md 마지막 항목)
tail -30 ~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/checkpoint.md

# 1c. 현재 브랜치의 미완료 작업
git status --short
git stash list
```

추가 Read (필요 시):
- `eval-scores.md` — 최약 Dimension 확인 (Eval 기반 개선 작업)
- `ux-issues.md` — 미해결 UX 버그
- `troubleshooting.md` — 미체크 항목

### Phase 2: 우선순위 평가 (Priority Scoring)

각 후보를 4가지 기준으로 평가 (각 1-5점):

| 기준 | 가중치 | 설명 |
|------|--------|------|
| **Impact** | 0.35 | 유저 가치, 프로젝트 진행에 미치는 영향 |
| **Urgency** | 0.25 | 시간 민감도, 블로커 여부, 미커밋 상태 |
| **Readiness** | 0.25 | 의존성 충족, 필요 정보/도구 준비 상태 |
| **Eval Alignment** | 0.15 | 최약 Eval Dimension 개선에 기여 여부 |

**Priority Score** = Impact×0.35 + Urgency×0.25 + Readiness×0.25 + Eval×0.15

**자동 부스트 조건**:
- 현재 브랜치에 미커밋 변경이 있으면 해당 작업 +2 Urgency
- `$ARGUMENTS`에 명시된 target은 자동 1순위
- Pending Work에 "커밋 + PR 필요"가 있으면 해당 작업 +2 Urgency
- Eval 최약 Dimension 관련 작업 +1 Eval Alignment

### Phase 3: 작업 단위 결정 (Work Unit)

Priority Score 최상위 작업을 선정한 뒤, 적정 크기로 조정한다.

**크기 판단 기준**:
| 크기 | 기준 | 판단 |
|------|------|------|
| Too Large | >20 파일 수정, >3시간 예상 | → 하위 작업으로 분할 |
| Just Right | 5-15 파일, 1-2시간 | → 그대로 진행 |
| Too Small | <3 파일, <15분 | → 관련 작업과 묶기 |

**분할 전략** (Too Large인 경우):
1. AC(Acceptance Criteria) 체크리스트 기반 분할
2. 각 하위 작업이 독립적으로 빌드/테스트 가능해야 함
3. 첫 번째 하위 작업만 이번 `/work` 세션에서 실행

### Phase 4: 실행 계획 생성 (Plan)

선정된 작업에 대해 구체적 실행 계획을 생성한다.

**계획 포맷**:
```
## Work Plan: {작업 제목}

**Source**: {Story #N / Pending Work / Eval:D{N} / User Request}
**Priority Score**: {점수} (I:{n} U:{n} R:{n} E:{n})
**Estimated Files**: {N}개 수정/생성

### Steps
1. {단계 1}: {파일 목록}
2. {단계 2}: {파일 목록}
...

### Verification
- [ ] `npx tsc --noEmit` 통과
- [ ] `npm run build` 통과
- [ ] {추가 검증 항목}

### Risks
- {리스크 1}: {완화 방안}
```

**계획 수립 시 필수 참조**:
- `project-structure.md` — 대상 디렉토리 확인 (v1/v2 혼동 방지)
- `architecture.md` — 기존 패턴 준수
- 해당 Story의 GitHub Issue body (AC, Technical Notes, Dependencies)

### Phase 5: 유저 확인

계획을 출력하고 유저 확인을 받는다.

```
## Work Selection

### 후보 목록 (상위 3개)
| # | 작업 | Priority | I | U | R | E |
|---|------|----------|---|---|---|---|
| 1 | {선정된 작업} | {점수} | {n} | {n} | {n} | {n} |
| 2 | {2순위} | {점수} | {n} | {n} | {n} | {n} |
| 3 | {3순위} | {점수} | {n} | {n} | {n} | {n} |

### Selected: {1순위 작업}
{계획 출력 — Phase 4 포맷}

진행할까요? (다른 작업 선택 시 번호 지정)
```

### Phase 6: 실행 (Execute)

유저 확인 후 계획대로 실행한다.

**실행 원칙**:
1. **단계별 진행**: 계획의 각 Step을 순서대로 실행
2. **검증 우선**: 각 Step 완료 후 빌드/타입체크 확인
3. **work-efficiency.md 준수**: 전용 도구 사용, Agent 위임, 병렬 실행
4. **project-structure.md 참조**: 파일 경로 확인 (v1/v2 혼동 방지)
5. **중간 저장**: 10개+ 파일 수정 시 중간에 git add + 현황 출력

**Agent 위임 판단**:
| 조건 | 위임 방식 |
|------|----------|
| 독립적인 UI 컴포넌트 2개+ | Agent 병렬 spawn |
| 테스트 작성 필요 | test-runner agent 위임 |
| API + Frontend 동시 수정 | backend-dev + frontend-dev 병렬 |
| 단일 파일 수정 | 직접 실행 (위임 오버헤드 > 이득) |

### Phase 7: 완료 보고

실행 완료 후 결과를 보고한다.

```
## Work Complete: {작업 제목}

### Results
- Files: {N}개 수정, {N}개 생성
- Build: {tsc + build 결과}
- Tests: {테스트 결과 (실행한 경우)}

### Verification Checklist
- [x] tsc --noEmit
- [x] npm run build
- {추가 검증}

### Next Steps
- [ ] `/checkpoint` 실행 권장
- [ ] {커밋/PR 필요 시 안내}
- {다음 작업 후보 1-2개 제안}
```

## 특수 모드

### `$ARGUMENTS` = `pending`
Pending Work 항목 중 최우선 작업을 선정. 미커밋 항목 자동 우선.

### `$ARGUMENTS` = `eval:D{N}`
Eval 최약 Dimension 개선에 집중하는 작업 선정.
- `eval:D1` → memory 파일 보강/정리
- `eval:D2` → troubleshooting 패턴 검토 + 방지책 강화
- `eval:D3` → 교훈 추출 깊이 개선 (checkpoint 템플릿 보완)
- `eval:D4` → memory 위생 점검 + stale 정보 정리
- `eval:D5` → work-efficiency.md 규칙 보강

### `$ARGUMENTS` = `#N` (Story 번호)
해당 Story를 직접 선택. Phase 2 스킵, Phase 3부터 시작.

### `$ARGUMENTS` = `fix:description`
버그 수정 모드. 설명 기반으로 관련 파일 탐색 → 수정 → 검증.

## 주의사항

- **계획 없이 코드 작성 금지**: Phase 4 완료 + Phase 5 유저 확인 후에만 실행
- **project-structure.md 필수 참조**: 프론트엔드 작업 시 v1/v2 확인
- **credentials.md 필수 참조**: 시크릿/API 키 관련 작업 시
- **빌드 실패 시 즉시 중단**: 다음 Step으로 넘어가지 않음
- **작업 범위 초과 금지**: 계획에 없는 "개선" 추가하지 않음
