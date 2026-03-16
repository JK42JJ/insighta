# Insighta Development Workflow v2.0

> CLI-Anything 8대 프레임워크로 강화된 Agent-Native 개발 체계
> 기존 6단계 워크플로우(boot→work→checkpoint→tidy→ship→retrospective)에
> Agent-Native 원칙을 융합하여 지속적 품질 향상을 실현합니다.

---

## 워크플로우 전체 구조

```
/boot → /work → /checkpoint → /tidy → /validate → /ship → /retrospective
  │        │         │           │         │          │          │
  │        │         │           │         │          │          └─ 회고 → .md 축적
  │        │         │           │         │          └─ 커밋/푸시/머지/배포
  │        │         │           │         └─ Agent-Native 표준 검증 ⭐ NEW
  │        │         │           └─ 이슈 리스트 정리
  │        │         └─ 맥락 저장 + TEST.md 업데이트
  │        └─ 이슈 작업 (Agent-Native 원칙 적용)
  └─ 프로젝트 로드 + 갭 분석
```

---

## Phase 1: /boot — 프로젝트 로드 + Agent-Native 갭 분석

### 기존 역할
프로젝트 정보를 로드하고 현재 상태를 파악합니다.

### 강화 내용
부팅 시 Agent-Native 갭 분석을 함께 수행하여, 작업 시작 전에 개선이 필요한 영역을 식별합니다.

### 실행 절차

```markdown
# /boot — 프로젝트 부팅 및 Agent-Native 상태 점검

## 1단계: 프로젝트 컨텍스트 로드
- CLAUDE.md 읽기
- package.json 확인 (의존성, 스크립트)
- .env.example 확인 (필요한 환경변수)
- git status + 최근 커밋 5개 확인
- 현재 브랜치 및 미머지 PR 확인

## 2단계: Agent-Native 상태 스캔 (CLI-Anything Phase 1: Analyze)
- src/cli/ 스캔 → 현재 CLI 명령어 목록 추출
- api/ 스캔 → REST 엔드포인트 목록 추출
- --json 지원 현황 체크 (각 명령별)
- 에러 처리 표준화 현황 체크
- tests/ 스캔 → 테스트 커버리지 현황 파악
- tests/TEST.md 최신 여부 확인

## 3단계: 작업 대기열 구성
- GitHub Issues 중 open 상태 목록 가져오기 (gh issue list)
- 우선순위별 정렬 (agent-native 라벨 우선)
- 이전 /retrospective에서 식별된 개선 항목 확인
  → docs/retrospectives/ 디렉토리의 최신 파일 참조

## 출력
부팅 완료 후 아래 형식으로 현재 상태를 요약합니다:

### 프로젝트 상태 요약
- 브랜치: (현재 브랜치)
- 미커밋 변경: (있음/없음)
- CLI 명령 수: N개 (--json 지원: M개)
- API 엔드포인트 수: N개
- 테스트 현황: unit X개, e2e Y개, 커버리지 Z%
- 대기 이슈: N개 (agent-native: M개)
- 마지막 회고 인사이트: (1줄 요약)
```

---

## Phase 2: /work — 이슈 작업 (Agent-Native 원칙 적용)

### 기존 역할
GitHub Issues에서 작업할 이슈를 선택하고 구현합니다.

### 강화 내용
모든 코드 작성 시 Agent-Native 체크리스트를 자동 적용합니다.
CLI-Anything의 Phase 2(Design) + Phase 3(Implement) 원칙을 내재화합니다.

### 실행 절차

```markdown
# /work — 이슈 기반 작업 실행

## 1단계: 이슈 선택 및 분석
- gh issue list --state open 으로 목록 확인
- 작업할 이슈 선택 (번호 또는 키워드)
- gh issue view N 으로 상세 내용 확인
- 이슈의 완료 조건(Acceptance Criteria) 파악

## 2단계: 설계 (CLI-Anything Phase 2: Design)
코드 작성 전 설계를 먼저 수행합니다:
- 영향받는 파일 목록 식별
- 기존 코드 구조와의 일관성 확인
- 필요한 테스트 유형 결정 (unit/integration/e2e)

## 3단계: 구현 (CLI-Anything Phase 3: Implement)
코드 작성 시 아래 원칙을 항상 적용합니다:

### Agent-Native 코딩 체크리스트
CLI 관련 변경 시:
- [ ] --json 출력을 구현했는가?
  → 성공: { status: "success", command, data, timestamp }
  → 에러: { status: "error", code, message, details, timestamp }
- [ ] --help에 Agent Usage 예시를 포함했는가?
- [ ] AppError를 사용한 구조화된 에러 처리를 적용했는가?
- [ ] 적절한 exit code를 반환하는가? (0=성공, 1=사용자에러, 2=시스템에러)

API 관련 변경 시:
- [ ] 일관된 응답 형식을 사용하는가?
- [ ] Zod 스키마 검증이 적용되었는가?
- [ ] OpenAPI 스펙 업데이트가 필요한가?

모든 변경:
- [ ] 타입 안전성이 유지되는가? (npm run typecheck)
- [ ] 기존 테스트가 통과하는가? (npm test)
- [ ] 새 기능에 대한 테스트를 작성했는가?

## 4단계: 실시간 검증 (CLI-Anything Phase 7: Real Backend Verification)
구현 후 실제 동작을 검증합니다:
- exit 0만 믿지 말고 실제 데이터를 확인
- sync 후 DB에 실제 row가 존재하는지 확인
- API 호출 후 응답 구조가 표준에 맞는지 확인

## focus 사용법
특정 영역에 집중할 때:
- /work auth — 인증 관련 이슈만 작업
- /work cli — CLI 명령어 개선 작업
- /work test — 테스트 커버리지 확대 작업
```

---

## Phase 3: /checkpoint — 맥락 저장 + 테스트 기록

### 기존 역할
작업 진행 상황과 맥락을 저장합니다.

### 강화 내용
TEST.md를 자동 업데이트하고, 테스트 결과를 기록합니다.
CLI-Anything의 Phase 4(Plan Tests) + Phase 5(Write Tests) 원칙을 적용합니다.

### 실행 절차

```markdown
# /checkpoint — 맥락 저장 및 테스트 기록

## 1단계: 현재 작업 상태 기록
- 진행 중인 이슈 번호와 현재 진행률
- 변경된 파일 목록 (git diff --name-only)
- 미해결 문제나 블로커 메모
- 다음 세션에서 이어서 할 작업 명시

## 2단계: 테스트 실행 및 기록 (CLI-Anything Phase 5: Write Tests)
```bash
npm run typecheck
npm run lint
npm test -- --coverage
```
테스트 결과를 캡처합니다.

## 3단계: tests/TEST.md 업데이트 (CLI-Anything Phase 6: Document)
TEST.md의 해당 섹션을 업데이트합니다:
- 최신 테스트 결과 코드블록 갱신
- CLI 명령별 커버리지 매트릭스의 변경된 행 업데이트
- 새로 추가된 테스트가 있으면 카운트 갱신
- 마지막 업데이트 날짜 갱신

## 4단계: CLAUDE.md 맥락 메모
필요 시 CLAUDE.md의 "Last Session Notes" 섹션을 업데이트합니다:
- 현재 작업 중인 이슈
- 알려진 문제
- 다음 세션에서 참고할 사항

## 저장 형식
```markdown
### Checkpoint: YYYY-MM-DD HH:MM
- Issue: #N (제목)
- Progress: X% (완료된 항목 / 전체 항목)
- Changed: file1.ts, file2.ts, ...
- Tests: passed X, failed Y, coverage Z%
- Next: 다음에 이어서 할 작업 설명
- Blockers: 있으면 기록
```
```

---

## Phase 4: /tidy — 이슈 리스트 정리

### 기존 역할
GitHub Issues 리스트를 정리합니다.

### 강화 내용
정리 시 Agent-Native 갭을 기반으로 새 이슈를 자동 제안합니다.

### 실행 절차

```markdown
# /tidy — 이슈 리스트 정리 및 갭 기반 이슈 제안

## 1단계: 현재 이슈 상태 정리
- 완료된 이슈 확인 및 close 처리
  → 커밋 메시지에 "Closes #N"이 있으면 자동 close 확인
- stale 이슈 식별 (30일 이상 활동 없음)
- 라벨 정리 (agent-native, foundation, core, testing 등)

## 2단계: Agent-Native 갭 기반 새 이슈 제안
/boot에서 수행한 분석 결과를 기반으로:
- --json 미지원 CLI 명령 → 이슈 생성 제안
- 테스트 미달 모듈 → 테스트 이슈 생성 제안
- 에러 처리 미표준화 영역 → 이슈 생성 제안
- /retrospective에서 나온 개선 항목 → 이슈 생성 제안

## 3단계: 우선순위 재조정
이슈를 다음 기준으로 정렬:
1. 사용자 영향도 (높음 > 중간 > 낮음)
2. Agent-Native 표준 위반 여부
3. 의존성 관계 (차단 이슈 우선)
4. 추정 작업량 (작은 것 먼저 = quick wins)

## 출력
정리된 이슈 목록을 표 형식으로 출력합니다:
| # | 제목 | 라벨 | 우선순위 | 상태 |
```

---

## Phase 5: /validate — Agent-Native 표준 검증 ⭐ NEW

### 역할
ship 전에 Agent-Native 표준 충족 여부를 검증하는 **품질 게이트**입니다.
CLI-Anything의 `/cli-anything:validate` 명령에 대응합니다.

### 실행 절차

```markdown
# /validate — Agent-Native 표준 검증 (ship 전 필수)

## 검증 항목

### CLI 표준 (CLI-Anything Framework #2, #3, #4)
- [ ] 변경된 CLI 명령이 --json 플래그를 지원하는가?
- [ ] --help 텍스트가 최신이고 Agent Usage를 포함하는가?
- [ ] 에러 시 AppError + 구조화된 JSON 에러를 반환하는가?
- [ ] exit code가 올바른가? (0/1/2)

### 코드 품질
- [ ] npm run typecheck — 타입 에러 0개?
- [ ] npm run lint — 린트 에러 0개?
- [ ] npm test — 모든 테스트 통과?

### 테스트 표준 (CLI-Anything Framework #5)
- [ ] 변경된 코드에 대한 테스트가 존재하는가?
- [ ] 새 CLI 명령에 E2E 테스트가 있는가?
- [ ] tests/TEST.md가 최신 결과를 반영하는가?

### 백엔드 검증 (CLI-Anything Framework #7)
- [ ] 실제 API 호출 결과가 예상과 일치하는가?
- [ ] DB 변경이 있다면 마이그레이션이 준비되었는가?

### 문서 표준
- [ ] README.md CLI 섹션이 최신인가?
- [ ] CLAUDE.md 업데이트가 필요한가?
- [ ] 변경 내용이 커밋 메시지에 명확히 기술되는가?

## 검증 실행
```bash
# 자동 검증 가능한 항목
npm run typecheck && echo "✅ TypeCheck" || echo "❌ TypeCheck"
npm run lint && echo "✅ Lint" || echo "❌ Lint"  
npm test && echo "✅ Tests" || echo "❌ Tests"
```

## 출력
검증 결과를 표로 출력하고, 실패 항목에 대한 수정 제안을 제공합니다:

| 항목 | 상태 | 비고 |
|------|------|------|
| TypeCheck | ✅/❌ | (에러 내용) |
| Lint | ✅/❌ | (에러 내용) |
| Tests | ✅/❌ | passed X, failed Y |
| --json 지원 | ✅/❌ | (미지원 명령 목록) |
| TEST.md 최신 | ✅/❌ | (마지막 업데이트 날짜) |

## 게이트 규칙
- TypeCheck + Lint + Tests 중 하나라도 실패하면 /ship 불가
- 실패 시 수정 후 다시 /validate 실행
```

---

## Phase 6: /ship — 커밋, 푸시, 머지, 배포

### 기존 역할
변경사항을 커밋하고 푸시/머지/배포합니다.

### 강화 내용
/validate 통과를 전제 조건으로 하며, CI 파이프라인과 연동됩니다.
CLI-Anything의 Phase 7(Publish) 원칙을 적용합니다.

### 실행 절차

```markdown
# /ship — 배포 (validate 통과 필수)

## 전제 조건
⚠️ /validate가 모든 항목 통과 상태여야 합니다.
통과하지 않은 상태에서 /ship 시도 시 경고를 표시하고 /validate 먼저 실행을 권유합니다.

## 1단계: 커밋 준비
- git diff --staged로 변경 내용 확인
- 커밋 메시지 작성 (Conventional Commits 형식):
  → feat: 새 기능
  → fix: 버그 수정
  → refactor: 리팩토링
  → test: 테스트 추가/수정
  → docs: 문서 업데이트
  → chore: 기타
- 관련 이슈 번호 포함: "feat: add --json to playlist list (Closes #4)"

## 2단계: 푸시
```bash
git push origin <current-branch>
```

## 3단계: PR 생성 또는 직접 머지
- feature 브랜치: PR 생성 → CI 통과 확인 → 머지
- master 직접: 확인 후 푸시

## 4단계: 배포 확인 (해당되는 경우)
- Vercel 자동 배포 트리거 확인
- 배포 후 핵심 기능 스모크 테스트

## 5단계: 이슈 정리
- 관련 이슈에 완료 코멘트 추가
- 이슈 close (커밋 메시지에 Closes #N 포함 시 자동)
```

---

## Phase 7: /retrospective — 회고 및 지속적 개선

### 기존 역할
작업을 회고하고 .md 파일로 인사이트를 축적합니다.

### 강화 내용
CLI-Anything의 반복적 정제(refine) 루프와 HARNESS.md 교훈 축적 패턴을 적용하여,
프로젝트가 작업할수록 점점 나아지는 피드백 루프를 구축합니다.

### 실행 절차

```markdown
# /retrospective — 회고 및 지속적 개선 (CLI-Anything Framework #6, #8)

## 1단계: 작업 회고
이번 작업 세션에서 다음을 평가합니다:
- 완료한 이슈와 결과
- 예상보다 어려웠던 부분과 그 원인
- 잘 동작한 패턴과 반복할 가치가 있는 것
- Agent-Native 표준 적용 과정에서 발견한 개선점

## 2단계: 교훈 기록 (CLI-Anything HARNESS.md 패턴)
docs/retrospectives/YYYY-MM-DD.md 파일을 생성합니다:

```markdown
# Retrospective: YYYY-MM-DD

## 완료 항목
- Issue #N: (제목) — (결과 요약)

## 교훈 (Lessons Learned)
| 교훈 | 설명 | 액션 |
|------|------|------|
| (교훈 제목) | (구체적 상황과 원인) | (다음에 적용할 행동) |

## Agent-Native 진행 현황
- --json 지원 명령: X/Y개 (전체의 Z%)
- 테스트 커버리지: X% → Y%
- 표준화된 에러 처리: X/Y개 시나리오

## 다음 세션 권장 사항
1. (가장 높은 우선순위 작업)
2. (두 번째 우선순위)
3. (세 번째 우선순위)

## CLAUDE.md 업데이트 필요 여부
- [ ] 새로운 패턴/규칙을 CLAUDE.md에 추가해야 하는가?
- [ ] 기존 규칙 중 수정이 필요한 것이 있는가?
```

## 3단계: CLAUDE.md 피드백 루프
회고에서 발견한 반복적 패턴이나 새로운 규칙을 CLAUDE.md에 반영합니다.
이것이 CLI-Anything의 "HARNESS.md에 교훈을 축적하는" 패턴의 Insighta 버전입니다.

→ CLAUDE.md가 작업할수록 점점 정밀해지고,
→ Claude Code의 작업 품질이 세션마다 향상됩니다.

## 4단계: 메트릭 추적 (선택)
시간이 지남에 따른 프로젝트 품질 추이를 추적합니다:
- Agent-Native 완성도 (--json, 에러 표준화, 테스트)
- 이슈 처리 속도
- 테스트 커버리지 추이
- /validate 통과율 추이
```

---

## 일일 작업 루틴 요약

```
# 작업 시작
/boot                          # 프로젝트 로드 + 갭 분석

# 작업 루프 (반복)
/work                          # 이슈 선택 → 설계 → 구현
/checkpoint                    # 맥락 저장 + 테스트 기록
... (필요시 /work → /checkpoint 반복)

# 작업 정리
/tidy                          # 이슈 정리 + 새 이슈 제안

# 배포 준비
/validate                      # Agent-Native 표준 검증 ⭐
/ship                          # 커밋/푸시/머지/배포

# 회고
/retrospective                 # 교훈 축적 → CLAUDE.md 피드백
```

---

## CLI-Anything 8대 프레임워크 매핑 참조

| # | Framework | 적용 Phase | 핵심 내용 |
|---|-----------|-----------|----------|
| 1 | 7-phase pipeline | /boot~~/retrospective 전체 | 7단계 → 7페이즈로 1:1 매핑 |
| 2 | Agent-native JSON | /work | 모든 CLI에 --json + 표준 응답 형식 |
| 3 | Structured errors | /work | AppError + 에러코드 + exit code 0/1/2 |
| 4 | Self-describing --help | /work | Agent Usage 예시 포함 |
| 5 | Multi-layer testing | /checkpoint + /validate | Unit+E2E+subprocess + TEST.md |
| 6 | Iterative refinement | /retrospective → /boot | 회고 → 갭분석 → 개선 반복 루프 |
| 7 | Real backend verification | /work + /validate | exit 0만 믿지 말고 실제 데이터 검증 |
| 8 | CI quality gate | /validate + /ship | typecheck+lint+test 통과 필수 |

---

## Agent-Native 코딩 표준 (Quick Reference)

### JSON 응답 형식
```typescript
// 성공
{ status: "success", command: "sync", data: {...}, timestamp: "2026-03-15T..." }

// 에러
{ status: "error", code: "PLAYLIST_NOT_FOUND", message: "...", details: {...}, timestamp: "..." }
```

### Exit Code
```
0 = 성공
1 = 사용자 에러 (잘못된 입력, 인증 실패 등)
2 = 시스템 에러 (API 장애, DB 연결 실패 등)
```

### 에러 코드 체계
```
AUTH_*       인증 관련 (NOT_LOGGED_IN, TOKEN_EXPIRED, INVALID_CREDENTIALS)
PLAYLIST_*   플레이리스트 (NOT_FOUND, SYNC_FAILED, INVALID_URL)
VIDEO_*      비디오 (NOT_FOUND, CAPTION_UNAVAILABLE)
API_*        외부 API (QUOTA_EXCEEDED, RATE_LIMITED, NETWORK_ERROR)
DB_*         데이터베이스 (CONNECTION_FAILED, MIGRATION_NEEDED)
SYSTEM_*     시스템 (UNKNOWN, CONFIG_MISSING)
```
