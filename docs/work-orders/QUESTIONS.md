# 질문 큐

에이전트가 막힌 지점. 채팅으로 되묻지 않고 여기 적고 다음 오더로 간다. James 는 하루 한 번 답한다. 답이 오면 해당 오더에 옮기고 이 줄은 지운다.

| 날짜 | 오더 | 질문 | 선택지 | 답 |
|---|---|---|---|---|
| 2026-09-11 | WO-2026-09-11-branch-worktree-cleanup | 30일 이상 미머지 원격 브랜치 28개 삭제? (미머지라 삭제는 되돌릴 수 없음) | (a) 전부 삭제 (b) 목록 중 일부 보존 지정 (c) 보류 | |
| 2026-09-11 | WO-2026-09-11-keel-cloud-posture | SNS 보안 알림 구독 확인 — support@insighta.one 받은편지함의 AWS "Subscription Confirmation" 링크. `cloud-posture` 가 초록이 되는 유일한 남은 조건(현재 confirmed 0 · pending 1) | (a) 지금 확인 (b) 다른 수신 주소 지정 | |
| 2026-09-11 | 보안 Stage 1 (`docs/security/`) | admin 콘솔 사용자 MFA 등록 → `mfa_required_users=["admin"]` 적용, admin key1(189일) 교체. `iam-hygiene` 가 매 30분 빨강인 이유 | (a) MFA 등록 후 적용 (b) 보류(사유) | |
| 2026-09-11 | 보안 Stage 1 (`docs/security/`) | Google OAuth 클라이언트 시크릿 재발급(콘솔) 후 `scripts/ops/rotate-youtube-oauth-secret.sh` 실행 | (a) 실행 (b) 보류 | |
| 2026-09-11 | WO-2026-09-11-newsletter-v21-pr1 | PR #1632(nl_* 18 테이블 DDL + 지연 트리거) 머지 — prod DDL 은 CI migrate 경로, 머지 후 `\d nl_claim` 확인 | (a) 머지 (b) 보류 | |
| 2026-09-11 | WO-2026-09-11-newsletter-v21-pr1 | 실행 엔진: 설계(v2.1)는 DBOS, 리포에는 pg-boss 만 존재 | (a) pg-boss 유지(설계 §1 수정) (b) DBOS 도입(새 의존성) | |
| 2026-09-11 | 자막 수집(브리프 선행 조건, `docs/handoffs/keel-monitoring-2026-09-08.md`) | 맥미니 transcript-collector 47일 정지 — ① plist 의 프록시 계정이 전송량 소진 계정(402)을 가리킴: PlistBuddy 로 `.transcript-svc.env` 의 정상 계정으로 교체 후 unload/load ② launchd 잡 미로드, ssh 로 등록 불가(Aqua 세션 없음): 맥미니 GUI 로그인 1회 필요 | (a) ①② 지금 (b) 날짜 지정 | |
| 2026-09-11 | 관측 (Keel) | `SLACK_ALERT_WEBHOOK` 미설정 — 전이 알림이 원장에만 남고 사람에게 안 감 | (a) 웹훅 URL 을 GitHub Secret 으로 등록(James) (b) 이메일(SNS)로 대체 (c) 보류 | |
| 2026-09-11 | WO-2026-09-11-branch-worktree-cleanup | 미커밋 변경이 있는 워크트리 5개 처리 (primary 69 · loading-fouc 2 · chatbot-rollback 1 · note-toolset 1 · book-compression 1) | (a) 커밋해 PR (b) 버림 (c) 보류 | |

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
