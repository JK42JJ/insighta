---
name: run-tests
description: 테스트 실행 명령. /run-tests [type] 형태로 사용
---

테스트를 실행합니다.

사용법: /run-tests [unit|integration|e2e|all|coverage]

테스트 유형:
- unit: 단위 테스트만 실행
- integration: 통합 테스트만 실행
- e2e: E2E 테스트만 실행
- all: 모든 테스트 실행
- coverage: 커버리지 포함 전체 테스트

실행할 명령:
```bash
npx tsx scripts/test-runner.ts $ARGUMENTS
```

테스트 완료 후 결과를 요약해서 보여줘.
