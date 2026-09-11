# 질문 큐

에이전트가 막힌 지점. 채팅으로 되묻지 않고 여기 적고 다음 오더로 간다. James 는 하루 한 번 답한다. 답이 오면 해당 오더에 옮기고 이 줄은 지운다.

| 날짜 | 오더 | 질문 | 선택지 | 답 |
|---|---|---|---|---|
| 2026-09-11 | WO-2026-09-11-branch-worktree-cleanup | 30일 이상 미머지 원격 브랜치 28개 삭제? (미머지라 삭제는 되돌릴 수 없음) | (a) 전부 삭제 (b) 목록 중 일부 보존 지정 (c) 보류 | |
| 2026-09-11 | WO-2026-09-11-branch-worktree-cleanup | 미커밋 변경이 있는 워크트리 5개 처리 (primary 69 · loading-fouc 2 · chatbot-rollback 1 · note-toolset 1 · book-compression 1) | (a) 커밋해 PR (b) 버림 (c) 보류 | |
| 2026-09-11 | WO-2026-09-11-newsletter-v21-pr1 | DBOS Transact 도입(의존성 + Supabase 에 `dbos` 시스템 스키마). 풀러(pgbouncer 트랜잭션 모드) 경유 검증은 prod 자격증명이 필요 | (a) DBOS 진행, 풀러 실패 시 DIRECT_URL 전용 연결 (b) 리포에 이미 있는 pg-boss 로 같은 상태 기계 (c) 보류 | |

<details><summary>미머지 30일+ 브랜치 목록 (2026-09-11)</summary>

- `backup/learning-center-attempt1(70d)`
- `docs/g3-w1-embedding-backfill-design(71d)`
- `feat/curation-portrait(50d)`
- `feat/dial-native-motion(43d)`
- `feat/gate-embed-text-align(62d)`
- `feat/guest-share-fe(59d)`
- `feat/ko-mandala-en-title-drop(92d)`
- `feat/tier-limits-2026(50d)`
- `feat/topic-illustrations(44d)`
- `feat/trust-gate-observability(70d)`
- `feat/v2-translations(75d)`
- `feat/vocab-note-clean(58d)`
- `feat/wizard-inflow-shadow(70d)`
- `feat/wizard-raw-pool-ingest-cp489(106d)`
- `fix/book-spinner-low-quality(78d)`
- `fix/chatbot-runtime-info-retry(69d)`
- `fix/chatbot-self-managed-agent-cp477+17(111d)`
- `fix/cp438-unset-anthropic-key(134d)`
- `fix/dial-tagline-revert(58d)`
- `fix/embed-active-active(63d)`
- `fix/heart-idle-half-size(116d)`
- `fix/landscape-safearea(44d)`
- `fix/mobile-spec-v2-field(60d)`
- `fix/note-mode-bullet-toc-cp504(75d)`
- `fix/note-no-emoji(72d)`
- `fix/sidebar-mandala-full-name(72d)`
- `revert/restore-8key-search-rotation(64d)`
- `story/cp425-4layer-defense(140d)`

</details>
