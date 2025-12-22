---
name: generate-tests
description: 소스 코드 분석 후 테스트 코드 자동 생성
---

소스 코드를 분석하여 테스트 코드를 자동으로 생성합니다.

## 사용법

```
/generate-tests [file-path] [--type unit|integration]
```

## 예시

```
/generate-tests src/services/sync.ts
/generate-tests src/adapters/youtube/ --type integration
/generate-tests src/utils/parser.ts --type unit
```

## 프로세스

1. **대상 파일 분석**
   - 함수, 클래스, 메서드 추출
   - export된 public API 식별
   - 의존성 분석

2. **기존 테스트 확인**
   - `tests/unit/` 및 `tests/integration/` 디렉토리 검색
   - 이미 존재하는 테스트 케이스 파악
   - 누락된 테스트 케이스 식별

3. **테스트 케이스 생성**
   - AAA 패턴 (Arrange-Act-Assert) 적용
   - 정상 케이스, 예외 케이스, 엣지 케이스 포함
   - 의존성 mock 자동 생성

4. **Fixtures 자동 생성**
   - 테스트 데이터 추출
   - `tests/fixtures/` 에 재사용 가능한 데이터 생성

## 테스트 생성 규칙

### 함수/메서드당 최소 테스트 케이스

| 항목 | 테스트 케이스 |
|------|--------------|
| 정상 입력 | should return expected result with valid input |
| 빈 입력 | should handle empty/null input |
| 잘못된 입력 | should throw error with invalid input |
| 경계값 | should handle boundary conditions |
| 에러 처리 | should handle errors gracefully |

### 클래스 테스트 구조

```typescript
describe('ClassName', () => {
  describe('constructor', () => {
    it('should initialize with default values', () => {});
    it('should accept configuration options', () => {});
  });

  describe('methodName', () => {
    it('should return expected result', () => {});
    it('should throw on invalid input', () => {});
  });
});
```

## 출력 위치

| 소스 경로 | 테스트 경로 |
|----------|------------|
| `src/services/sync.ts` | `tests/unit/sync.test.ts` |
| `src/adapters/youtube/YouTubeAdapter.ts` | `tests/integration/youtube-adapter.integration.test.ts` |
| `src/utils/parser.ts` | `tests/unit/parser.test.ts` |

## 생성 후 검증

```bash
# 생성된 테스트 실행
npm test -- --testPathPattern="<generated-test-file>"

# 타입 체크
npm run typecheck
```

테스트 생성 완료 후:
1. 생성된 테스트 파일 경로 출력
2. 테스트 실행 결과 요약
3. 추가 필요한 테스트 케이스 제안
