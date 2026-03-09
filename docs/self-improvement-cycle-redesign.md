# AI 코딩 에이전트의 자기개선 사이클 재설계 — 데이터 기반 피드백 루프

> Claude Code를 개인 프로젝트에서 사용하면서, AI 에이전트가 세션 간 학습하고 스스로 개선되는 시스템을 만든 실험 기록.

## 배경

### 프로젝트 환경

- **도구**: Claude Code (Anthropic의 CLI 기반 AI 코딩 에이전트)
- **프로젝트**: Insighta — YouTube 플레이리스트 기반 지식 관리 웹앱
- **기간**: 약 5일간 60개 세션 (2026-03-04 ~ 03-08)
- **특징**: Claude Code의 persistent memory 파일 시스템을 활용한 세션 간 맥락 보존

### 초기 시스템 (v1)

5일간의 집중 개발을 거치면서 자연스럽게 세션 관리 사이클이 만들어졌다:

```
/boot (Read) → /work (Execute) → /checkpoint (Record + Eval) → /retrospective (Analyze)
```

각 단계는 Claude Code의 slash command로 구현했다:

- **`/boot`**: 세션 시작 시 프로젝트 컨텍스트를 memory 파일에서 로드
- **`/work`**: 우선순위 기반 작업 선정 → 실행
- **`/checkpoint`**: 세션 내용 기록 + 교훈 추출 + 5개 차원 정량 평가 (Eval)
- **`/retrospective`**: 패턴 분석 → 규칙 개선 제안

이 시스템의 핵심 아이디어는 **Deep Learning의 epoch 학습**에서 빌려왔다. 매 세션(epoch)마다 5개 차원으로 점수를 매기고, 반복할수록 1.0에 수렴하게 만들겠다는 것.

## 문제 진단

9 epoch 동안 시스템을 운영하면서 근본적인 설계 결함이 드러났다.

### 증상 → 근본 원인 매핑

| 증상 | 근본 원인 |
|------|----------|
| Eval 점수가 행동으로 이어지지 않음 | 주관 채점만 있고, 구체적 개선 행동(Action)이 없음 |
| D3(Lesson Yield)가 연속 N/A | 단순 세션에서 교훈 강제 추출은 무의미 → 차원 설계 문제 |
| checkpoint가 기록만 함 | "다음 세션에서 뭘 바꿀 것인가" 출력이 없음 |
| /retrospective 실행 0회 | checkpoint 데이터를 분석하는 연결이 끊김 |
| D1이 0.85에서 정체 | 코드 구조 확인을 위한 탐색을 감점하는 측정 기준이 현실과 안 맞음 |
| work-efficiency.md 242줄, 참조 빈도 0 | 이론적 참조용 문서가 실제 세션에서 활용되지 않음 |

### 핵심 문제 한 줄 요약

> 시스템의 존재 목적(노하우 축적 → 낭비 감소)은 맞지만, **측정(Eval)이 행동(Action)으로 이어지는 연결 고리**가 없었다.

점수를 매기고, 점수를 기록하고, 점수를 보여주는 것까지는 했다. 하지만 "그래서 다음에 뭘 다르게 할 것인가?"에 대한 답을 시스템이 강제하지 않았다.

## 해결 방향

### 1줄 요약

> checkpoint에서 **객관적 데이터**를 수집하고, retrospective에서 그 데이터를 **분석**하여 **구체적 개선 제안**을 출력하는 루프를 만든다.

### 재설계된 루프

```
/checkpoint: 세션 팩트 기록 + Improvement Target 도출
     ↓ (데이터 축적: session-log.md)
/boot: 이전 Target 리마인드 → 이번 세션에서 적용
     ↓ (적용)
/retrospective: N개 세션 데이터 분석 → 패턴 발견 → 규칙 개선 제안
     ↓ (유저 승인)
memory/규칙 파일 업데이트
```

**Before**: 점수 기록 → (끊김) → 다음 세션
**After**: 점수 기록 + Target 도출 → 다음 세션에서 리마인드 → 적용 여부 측정

## 구체적 설계

### 1. session-log.md — 정형 데이터 축적

checkpoint.md는 서술형 기록이라 분석이 어려웠다. 별도의 정형 데이터 테이블을 만들었다:

```markdown
| # | Date | Branch | Domain | Files | New | Errors | Lessons | Build | Key Action | Improvement Target |
|---|------|--------|--------|-------|-----|--------|---------|-------|------------|-------------------|
| 60 | 2026-03-08 | story/79 | frontend | 7M+3N | 3 | 0 | 0 | pass | SourceTypeBadge 통합 | — |
| 58 | 2026-03-08 | story/84 | frontend | 9 | 2 | 1 | 1 | pass | 이미지 프록시 | 프록시 URL 백엔드 의존성 검증 |
```

이 데이터가 있으면 retrospective에서 **팩트 기반 분석**이 가능하다:
- "최근 10 세션에서 에러 3회 중 2회가 frontend 도메인"
- "Improvement Target 적용률 60%"
- "세션당 평균 수정 파일 수 추이"

### 2. Improvement Target — 행동을 강제하는 장치

매 checkpoint 마지막에 **다음 세션에서 시도할 구체적 행동 1가지**를 필수 기록:

```
- **Improvement Target**: UI 컴포넌트 추가 시 브라우저에서 런타임 확인 후 커밋
```

이 Target은 다음 `/boot`의 Phase 6a-2에서 자동 리마인드된다:

```
### Improvement Target (Phase 6a-2)
- Previous target: UI 컴포넌트 추가 시 브라우저에서 런타임 확인 후 커밋
```

그리고 `/checkpoint`의 Eval에서 D3(Improvement Action)로 **적용 여부를 측정**한다.

### 3. Eval 차원 재설계

#### D3: Lesson Yield → Improvement Action

**Before** (수동적):
```
D3 Lesson Yield: "교훈을 추출했는가"
→ 문제: 단순 구현 세션에서는 교훈 자체가 없음 → 연속 N/A
```

**After** (능동적):
```
D3 Improvement Action: "이전 타겟을 적용했는가 + 새 개선점을 발견했는가"
  1.00 = 이전 타겟 적용 + 새 개선점 발견 + memory 반영
  0.85 = 이전 타겟 적용 OR 새 개선점 발견
  0.70 = 타겟 해당 없었으나 작업 방식 개선 시도
  0.50 = 타겟 있었으나 미적용
  N/A  = 첫 세션 AND 단순 작업
```

**핵심 차이**: "교훈이 있었느냐"(환경 의존) → "개선 행동을 했느냐"(의지 의존)

#### D1: 필수 코드 탐색을 감점에서 제외

**Before**:
```
보조 탐색 1건당 -0.15 → 항상 0.85 천장
```

**After**:
```
감점 대상: memory에 기록된 정보를 다시 탐색 (v1/v2 경로 재확인 등)
감점 아님: 구현에 필요한 코드 구조 확인 (import 패턴, 함수 시그니처 등)
```

구현 작업에서 기존 코드를 읽는 것은 당연한 행위인데, 이를 감점하면 측정 기준이 비현실적이 된다.

#### 소수점 정밀도: 6자리 → 2자리

`0.850000`과 `0.85`의 정보량 차이는 없다. 6자리는 정밀하게 보이지만 그 정밀도에 의미가 없었다.

### 4. /retrospective — 데이터 분석 엔진

기존: 템플릿만 있고 실행 0회.
변경: session-log.md를 분석하여 **3가지 유형의 구체적 제안**을 생성.

```markdown
## 분석 항목

### A. 에러 패턴 분석
- 도메인별 에러 빈도
- 에러 → 해결까지 세션 수
- troubleshooting.md 기존 패턴 재발 여부

### B. 효율 트렌드
- 에러 0 세션 비율
- Improvement Target 적용률

### C. 개선 제안 (3 유형)
- Type A: Memory 보강 — "frontend 에러 빈발 → troubleshooting 패턴 추가"
- Type B: 규칙 강화 — "Target 미적용 3회 연속 → boot 리마인드 강화"
- Type C: 규칙 폐지 — "OOO 규칙 10세션간 참조 0회 → 삭제 후보"
```

### 5. checkpoint.md 아카이빙

60개 checkpoint가 1047줄로 누적되어 Read 불가 상태였다.

```
Before: checkpoint.md 1047줄 (CP1-60, Read 시 32K 토큰)
After:  checkpoint.md 101줄 (CP41-60, Read 가능)
        checkpoint-archive.md 135줄 (CP1-40 요약)
```

20개 유지 정책: 초과 시 가장 오래된 10개를 아카이브로 이동.

### 6. work-efficiency.md 경량화

242줄 중 참조 빈도 0인 이론적 내용을 모두 제거:

| 제거 | 이유 |
|------|------|
| MCP 조합 패턴 4개 | 사용 실적 0 |
| Skills 상세 목록 | 별도 참조 가능 |
| 작업 유형별 최적 조합 5개 | 이론적, 참조 0 |
| Hooks 상세 8종 | 별도 참조 가능 |
| Plugins 9개 목록 | 별도 참조 가능 |

```
Before: 242줄 (이론 + 실증 혼재)
After:  54줄 (실증된 15개 규칙 + Agent 시스템 기본)
```

## 변경 총괄

| # | 파일 | Before | After | 변경 |
|---|------|--------|-------|------|
| 1 | `session-log.md` | — | 17줄 | 신규 (정형 세션 데이터) |
| 2 | `checkpoint-archive.md` | — | 135줄 | 신규 (CP1-40 아카이브) |
| 3 | `checkpoint.md` | 1047줄 | 101줄 | **90% 감소** |
| 4 | `eval-scores.md` | 117줄 | 91줄 | D1/D3 재정의, v2 |
| 5 | `work-efficiency.md` | 242줄 | 54줄 | **78% 감소** |
| 6 | `retrospective.md` | 220줄 | 51줄 | 구조 전면 전환 |
| 7 | `checkpoint.md` (cmd) | 181줄 | 171줄 | session-log + Target |
| 8 | `retrospective.md` (cmd) | 49줄 | 97줄 | 분석 엔진 재작성 |
| 9 | `boot.md` (cmd) | 230줄 | 242줄 | Target 리마인드 |
| 10 | `CLAUDE.md` | 81줄 | 82줄 | SSOT 테이블 |

## 기대 효과

| Before | After |
|--------|-------|
| Eval 점수만 기록, 행동 없음 | Improvement Target → 다음 세션 리마인드 → 적용 확인 |
| retrospective 미사용 (실행 0회) | session-log 데이터 분석 → 구체적 개선 제안 |
| D3 연속 N/A (단순 세션에서 교훈 강제) | D3가 "개선 행동 여부" 측정 → N/A 감소 |
| checkpoint.md Read 불가 (1047줄) | 20개 유지 + 아카이브 → 항상 Read 가능 |
| work-efficiency.md 참조 빈도 0 | 54줄 핵심만 → Boot에서 실제 참조 |

## 검증 계획

1. 변경 후 `/boot` 실행 — 정상 로드 + Improvement Target 리마인드 확인
2. `/checkpoint` 실행 — session-log 행 추가 + Improvement Target 출력 확인
3. `/retrospective` 실행 — session-log 분석 + 제안 출력 확인
4. 3세션 후 — Improvement Target 적용률 확인, D3 점수 변화 확인

## 교훈

### 1. 측정만으로는 개선되지 않는다

점수를 매기는 것은 쉽다. 어려운 것은 그 점수가 **다음 행동**으로 이어지게 만드는 것이다. Improvement Target은 그 연결 고리다.

### 2. 정형 데이터와 서술형 기록은 역할이 다르다

checkpoint.md(서술형)는 맥락 보존에 좋지만 분석에 부적합하다. session-log.md(정형)는 분석에 좋지만 맥락이 없다. 둘 다 필요하다.

### 3. 측정 기준은 현실에 맞춰야 한다

D1이 0.85에서 정체된 이유는 에이전트의 능력 부족이 아니라, "코드를 읽는 행위"를 감점하는 기준이 비현실적이었기 때문이다. 측정 기준이 현실을 반영하지 못하면 점수는 정보가 아니라 소음이 된다.

### 4. 사용되지 않는 규칙은 규칙이 아니다

work-efficiency.md의 242줄 중 대부분은 "있으면 좋겠지"하는 이론이었다. 실제로 참조된 적 없는 규칙은 컨텍스트만 소비하는 부채다. 54줄로 줄인 뒤가 더 유용하다.

### 5. AI 에이전트의 자기개선은 가능하지만, 시스템 설계가 핵심이다

Claude Code는 persistent memory를 통해 세션 간 학습이 가능하다. 하지만 memory 파일이 있다고 자동으로 개선되지는 않는다. **무엇을 기록하고, 무엇을 리마인드하고, 무엇을 측정할 것인가** — 이 시스템 설계가 실제 개선 여부를 결정한다.

---

*이 실험은 Claude Code (Opus 4.6)와 Insighta 프로젝트에서 진행되었습니다.*
*관련 코드: [github.com/JK42JJ/insighta](https://github.com/JK42JJ/insighta)*
