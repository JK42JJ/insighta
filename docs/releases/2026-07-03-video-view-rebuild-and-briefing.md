# 2026-07-03 — 영상 학습 화면 재구축 + AI 학습 브리핑

## 무엇이 좋아졌나요

**영상 보는 화면이 처음부터 다시 설계됐습니다.** 위쪽에 지금 어느 주제군의 영상을 보는지 항상 표시되고, [영상|노트] 전환 버튼이 한 자리에 고정됐습니다. 영상 아래에는 **챕터 목록**이 생겨 구간별 시간·제목·관련도를 한눈에 보고 클릭 한 번으로 그 장면으로 이동합니다. 지금 재생 중인 챕터는 자동으로 표시됩니다.

**관련도 히트맵.** 영상에 마우스를 올리면 유튜브 진행바 바로 위에 구간별 관련도가 색 봉우리(높음 초록·보통 골드·낮음 회색)로 나타납니다. 커서를 좌우로 움직이면 그 구간만 선명해지고, 클릭하면 바로 이동합니다. 유튜브 자체 메뉴는 그대로입니다.

**AI 요약이 "학습 브리핑"이 됐습니다.** 나열식 요약 대신 — 한 줄 에센스 → **내 목표와의 적합도와 이유** → 팁/사실/주장으로 정리된 핵심(장면 점프 포함) → 오늘 해볼 것 체크리스트 → 용어 사전 → 이해 점검 퀴즈 순서로 재구성. 챕터 탭과 겹치던 타임라인 나열과 '섹션 내용' 탭은 정리했습니다.

**여러 영상 사이 이동**은 상단의 동그란 썸네일 버튼으로 — 클릭하면 전체 썸네일 스트립이 펼쳐지고, 각 썸네일에 마우스를 올리면 큰 미리보기가 뜹니다. 창을 절반으로 줄여도 화면이 깨지지 않고 좌측 메뉴가 자동으로 접힙니다.

**중요 버그 수정**: '카드 더 찾기'에서 다른 만다라의 검색 결과가 섞여 저장되던 문제를 근본 수정했습니다. 이미 섞인 라운드는 해당 라운드의 초기화 버튼으로 지우면 재발하지 않습니다. 게시기간 필터에 '지난 2년/3년'이 추가됐고, 2년 검색이 "지난 1년"으로 잘못 표기되던 라벨도 고쳤습니다.

## 기술 상세 (7 PR)

- **#1072** feat(learning): STEP1 — center top bar (mode-toggle single home) + meta header (이후 제거)
- **#1077** feat(learning): STEPs 3-7 — chapters tab (relevance meters, click-to-seek, playing chip), floating thumbnail navigator (replaces hover VideoStrip), responsive sidebar auto-collapse (<1280px), right-panel context zone (measured 3-column alignment), + CLAUDE.md hard rule (no short-interval repeated server calls)
- **#1079** fix(add-cards): **CRITICAL** cross-mandala round leak — `shouldAppendRound` guard (result's requested mandala must equal the open mandala, idempotent per roundId) + 4 regression tests; publish-period 2yr/3yr presets
- **#1081** fix(add-cards): round-summary label dedup — single `published-bucket` mapping shared by filter chips & summary (was a divergent inline copy capping at 1yr) + boundary tests
- **#1086** feat(learning): relevance heatmap (approved mockup B) — 26px tier-colored mound strip above the native progress bar (measured 2026 embed UI: ~74px bottom, 28px insets, +8px breathing room), dark scrim, hover-vivid per segment, click-to-seek, renders only after playback engages, hidden when segment coverage <90% (BE data defect tracked in #1078)
- **#1088** fix(learning): top-bar breadcrumb follows the current video — book-atoms match → card cell-index → mandala subject labels (3-stage fallback)
- **#1089** feat(learning): AI summary as a learning briefing (essence / mandala-fit / typed takeaways / actionables / glossary / self-check — all existing v2 data, BE untouched) + '섹션 내용' tab retired

검증: PR별 CI 전체 green · vitest 481→491 · 배포는 머지 SHA 고정 런 감시 + prod 번들 마커 grep + health 3중 확인.
