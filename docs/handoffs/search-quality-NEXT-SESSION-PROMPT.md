# 다음 세션 시작 프롬프트 (복붙용)

> 아래 블록을 다음 세션 첫 메시지로 붙여넣으면 맥락이 끊기지 않고 이어짐.

---

검색품질 트랙을 이어서 진행한다. 먼저 `docs/handoffs/search-quality-horizon0-results-2026-07-01.md`(지평 0 실측 결과 SSOT) + `docs/design/card-quality-search-overhaul-2026-07.md`(종합 리포트) + `~/Downloads/insighta-search-quality-master-plan-2026-07.md`(마스터플랜)를 읽고 시작해.

**컨텍스트 요약**: 카드 검색이 <50개 + 품질 저하(동일채널 도배·2~12년 outdated·중복). 원인을 measure-first로 파고들어 지평 0(M1~M4 read-only 실측)을 거의 완주했다. 결과:
- **M1(완료)**: 풀 40,074 중 67% TTL 만료. 회수 가능 서빙풀 = 활성 gold/silver 임베딩 4,460 (현 pool-serve 가시 1,177 → 소스확대 3.8×). 최대 레버 = 미임베딩 7,022 임베딩 백필(쿼타 0).
- **M2(미완 — 이번 세션 첫 작업)**: 커버리지 갭 맵. `mandala_embeddings` 셀 임베딩 vs 회수풀(4,460) cosine 매칭으로 코어만다라 셀별 후보 수 → 갭 목록. read-only pgvector.
- **M3(완료)**: volatile 도메인(K8s >6mo 93%/>2yr 82% 등) 심각 노후. volatility-aware 개입 필요. (user_mandalas.volatility 필드는 전부 NULL → 제목 휴리스틱 우회.)
- **M4(완료)**: 🔴 SEARCH 키 8개 슬롯 여전히 활성("7→1 통합" 미완 = ban 리스크 라이브). 라이브 쿼타 24/10000/day(헤드룸 거대, 단 quota_usage는 playlist-sync만 추적 = 위저드 search.list undercount, 정밀화 필요). 공급 batch-collector cron OFF.

**이번 세션 할 일 (우선순위)**:
1. **M2 커버리지 갭 맵 완주** (지평 0 마지막 조각).
2. **M4 위저드 search.list 쿼타 정밀 trace** (undercount 보정).
3. 지평 0 종합표 → James trace 확인 → **지평 1 스코프 확정**.

**불변 가드 (절대)**: Typesense=별도 리포 교차금지 / 100k·다중키 금지(ToS ban) / prod 직접조작 금지 / "≥50 관련 아니면 honest-partial"(쓰레기 50 금지, gc 분포로 증명) / center-goal=LLM쿼리(raw concat 금지) / gc 하한 55까지만 / flag-gated·unset=no-op·config-flip우선 / Done=James prod 실측+CC 자기검증 / 지평 0은 전부 read-only.

**주의**: 이모지 사용 금지(인사이타 룰). `.d2-blocking` 마커 있음(CP506 D2=0.45) → /init BLOCKING 대응. 현재 브랜치 `feat/v2-translations`는 검색품질과 별개(v2 번역 트랙). 실측은 `cat scratchpad/*.js | bash scripts/ssh-connect.sh "docker exec -i insighta-api node"` 패턴(prod DB read-only).

M2부터 플랜 제시하고 승인받은 뒤 진행해.

---
