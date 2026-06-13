# CC 핸드오프 — 횡단 관심사 정합 전수 감사 (구조 결함 인벤토리)

> **세션 성격**: 독립 워크스트림. 현 출시 안정화 트랙(#919 truncate / #918 캐너리 / 쇼츠 / 소급)과 **섞지 말 것.** 별도 세션에서 단독으로 시작.
> **단계**: **1단계 = CC 깊은 현황+분석 (read-only)** → **2단계 = Claude 종합·최종 설계** → James 출시 라인 결정. fix·거버넌스는 그 후 별도. (§1 참조)
> **작성 맥락**: CP500+ 2026-06-13. 메모 휘발 리그레션 진단 중 "이건 버그가 아니라 플랫폼 한계의 신호"라는 James 판단에서 파생.

> ## ⚠️ 먼저 읽을 것 — 이미 한 감사 ≠ 이 세션 완료
> 직전 세션에서 올린 **"카드 데이터 모델 + per-card 콘텐츠 정합 지도"는 이 핸드오프의 §6에 그대로 들어 있다.** 그건 횡단 **②(per-card 콘텐츠) 한 칸 + ①(카드 정체성)의 일부**일 뿐 — **이 세션의 출발점이지 완료가 아니다.** §6-bis(부록)에 직전 grep-level 부분 감사(①③④⑦)가 있으나 **전수 아님 — 출발점**. 반드시 full-file read로 검증·확장.
> - **하지 말 것**: "지도 이미 다 했는데?" 하고 per-card 콘텐츠만 더 깊이 파는 것. → 절반짜리 지도가 된다.
> - **할 것**: §6/§6-bis를 출발점으로 삼아 **나머지 횡단으로 확장.** 이번 세션 범위 = **①(카드 정체성 전체) · ②(완료분 포함) · ③(메타 ingest 경로 정합) · ⑦(행동 텔레메트리 = 페르소나 토대, map-only)**. ④는 우회 여부 확인만, ⑤⑥은 출시 후.
> - 오늘 LEVEL-2 3건(채널cap·쇼츠·메타ingest)이 정확히 ③④에 있다 — 그게 빠지면 "메모 한 건"만 본 것이고, James가 요구한 "구조 전수조사"가 안 된다.
> - **⑦은 north star(페르소나·능동비서) 토대 점검** — 구현이 아니라 "현 구조가 행동 누적을 받칠 수 있나 + ①정체성 결정이 이 미래를 봉쇄하지 않나" 확인. §6.5 참조.
> - **★전수 조사 (James 명시): 부분 읽기 금지·추측 금지★** — 각 횡단의 모든 경로를 `Read`(전문)로 확인. grep은 경로 발견용, 판정은 전문 읽기로. file:line 증거 없는 주장 금지.

---

## 0. 왜 이 세션이 필요한가 (배경)

오늘 하루에만 네 건의 결함이 나왔다 — 그런데 측정해 보니 **네 개의 다른 버그가 아니라, 같은 병이 네 군데서 난 것**이다:

| 발현 | 표면 증상 | 실제 병 |
|---|---|---|
| 채널 cap 소실 (#909) | 시리즈 연강·채널 과점 | 다양성 가드가 유입경로마다 복제, 단일 길목 없음 |
| 쇼츠 게이트 (#913) | 쇼츠가 카드로 유입 | 쇼츠 게이트가 경로마다 따로 |
| 메타 ingest (#917) | 아이디어스팟 v2 무한 스피너 | 새 유입경로가 ingest 가드 미복제 |
| 메모 휘발 (진단완료) | 수동 카드 메모 영구 유실 (138장/6users) | per-card 콘텐츠가 테이블마다 조인 재구현, read/write 비대칭 |

**병명**: 여러 기능에 공통으로 걸치는 일(횡단 관심사)에 **단일 정본 층(chokepoint)이 없어서**, 기능을 추가할 때마다 그 횡단을 손댄 자리에서 제멋대로 다시 구현한다. 기능이 늘수록 같은 횡단이 N갈래로 갈라지고, 그중 한 갈래가 어긋나면 데이터 유실·잠복 미작동으로 터진다. 이게 쌓이면 **"새 기능 하나가 N갈래를 다 건드려야 정합이 유지되는" 확장 한계**가 된다.

**왜 반복되나 (정직한 자기 진단)**: LLM(CC·Claude 공통)은 편집하는 파일의 **로컬 맥락만** 본다. 로컬에서 맞는 fix를 짜지만 전역 seam(이음매)을 놓친다. 세션마다 아키텍처 기억이 끊기고, 측정 전 확신으로 seam을 이해하기 전에 구현한다. → 게으름이 아니라 **구조적 locality 편향.** 그래서 처방은 "더 조심"이 아니라 **seam을 강제로 보게 만드는 장치(in-repo 강제)** 여야 한다.

이 세션의 목적: **리액티브 chokepoint 발견(터지면 고침)을 프로액티브 chokepoint 지도(미리 전수 점검)로 전환**한다. CC가 사실 지반을 깊게 파고(1단계), Claude가 그 위에 정본층·불변식 설계를 얹어(2단계), 이후 모든 구조 변경이 그 안에서 일어나는 **살아있는 그릇**으로 repo에 박는다.

---

## 1. 작업 구조 — 2단계 (조사 / 설계 분리)

이 작업은 **조사**(코드·DB·prod 직접 접근 필요)와 **설계**(전체 종합·전략 판단)를 분리한다. CC는 1단계, Claude(전략)는 2단계.

### 1단계 — CC: 깊은 현황+분석 보고 (read-only, 이 세션의 산출물)

얇은 지도가 아니라 **사실 지반을 깊고 정직하게** 판다. 각 횡단(§2 범위 ①②③⑦)마다:
- 실제 코드 경로·seam(이음매)·정본층 유무 — `file:line` 증거 (전문 읽기로 확인)
- read/write 대칭, 새 경로 가드 유무, **현 위반 + 증거**
- 블래스트 데이터(영향 범위 — measure 필요분은 표시, 측정은 James 승인 후)
- **★옵션은 펼치되 고르지 않음★** — "이렇게 고칠 수 있다 A/B" 까지, 어느 쪽이 정답인지 *결정 금지*
- 미해결 질문·불확실 지점 (정직하게 "여기는 추가 확인 필요")

**CC가 하지 말 것**: 정본층 아키텍처 *선택*, 불변식 *확정*, ① 결정. 그건 2단계. 로컬 맥락으로 설계를 잠그면 오늘 종일 본 locality 편향이 설계층에서 재발한다. CC는 **사실 + 옵션 + 질문**까지, 규범적 결정은 넘긴다.

산출물 = **현황+분석 보고서**(인벤토리 표 + 갭 분석 + 옵션 + 블래스트 + 미해결). fix 코드·마이그레이션·SQL·`ARCHITECTURE_INVARIANTS.md` 확정본 **생성 금지.**

### 2단계 — Claude(전략): 종합·검토·최종 설계

CC 보고 전부 수신 → **교차검증**(CC가 놓친 것·틀린 것 잡기 — 오늘 effectiveDuration·skip 가지처럼) → 종합 → **최종 설계**:
- 정본층 아키텍처 (작은/큰 안 구체화, 마이그레이션·블래스트)
- 불변식 카탈로그 (미래 거버넌스 — `docs/ARCHITECTURE_INVARIANTS.md` 확정본)
- ① 카드 정체성 결정을 **페르소나 토대 기준(⑦)으로 평가한** 옵션
- 트리아지 + **출시 라인 권고**

### James: 최종 설계 위에서 결정

출시 라인 + ① 범위(작은/큰) 확정. 그 후 4단 fix·5단 거버넌스 별도 세션.

---

## 2. 1단 — 횡단 인벤토리 (read-only)

per-card 콘텐츠에 이미 한 그 감사를 **횡단 전체로 확장**한다. "코드 전수조사"는 무한하지만 **"횡단 N개 감사"는 유한**하다. 알려진 횡단 + **이번 세션 상태**:

| # | 횡단 관심사 | 감사 질문 | 이번 세션 |
|---|---|---|---|
| ① | 카드 정체성 (uvs / ulc) | 두 테이블 키·병합 지점·id 네임스페이스 충돌. #911 증발과 한 줄기인가 | ★확장 — §6은 일부만, 전체 정합으로 |
| ② | per-card 사용자 콘텐츠 | 노트·하트·완료·시청위치·셀위치 — 각 read 경로 vs write 경로 | ✅ 감사 완료 (§6 입력) — 그대로 편입 |
| ③ | 영상 ingest / 메타 | 모든 카드유입 경로 × `ensureYoutubeVideoRow` 정합. #917 chokepoint가 전 경로를 실제로 커버하나 | ★신규 — 이번 세션 핵심 |
| ④ | 추천 게이트 (유입경로) | 유입경로 × 관련도게이트·쇼츠·다양성. executor 단일점이 진짜 정본인가, 아직 우회 경로 있나 | △ 우회 여부 **확인만** (대부분 executor로 수렴됨) |
| ⑤ | transcript / 요약 | truncate·skip·char-cap 경로 정합. 생성기 두 개·핸들러·standalone caller 간 | ⏸ 출시 후 (오늘 안 터짐) |
| ⑥ | auth / quota | 서버키 vs OAuth 토큰. video-discover·trend-collector 경로별 quota 출처 | ⏸ 출시 후 (오늘 안 터짐) |
| ⑦ | **행동 텔레메트리 → 페르소나 토대** | 진입·재생·반복 이벤트가 잡히나(이벤트 vs 상태) / 어디 떨어지나 / 만다라로 롤업되나 / ①정체성이 anchor하나 | ★map-only — 토대 봉쇄 여부 확인 (구현은 출시 후) |

> **범위 확정 (James)**: 이번 세션 = **①②③** (오늘 실제로 피 본 셋: 카드정체성·콘텐츠·ingest). ②는 §6으로 완료, **①(전체)·③(신규)** 가 실작업. ④는 executor 단일점 우회 여부만 확인. ⑤⑥은 같은 그릇으로 출시 후 확장. ⑤⑥까지 무리하게 우겨넣어 ①③을 얕게 끝내지 말 것.

각 횡단마다 같은 표 형식으로:
- **정본 층 유무**: 단일 접근 지점이 있나, 아니면 경로마다 재구현인가
- **read / write 대칭**: 읽기와 쓰기가 같은 경로를 보나 (메모는 read dual / write uvs-only = 비대칭이 유실 원인)
- **새 경로 가드**: 새 유입·소비 경로가 추가될 때 정합을 자동 보장하나, 수동 복제에 의존하나
- **현 위반 + `file:line`**: 지금 깨진 곳

> **핵심 요구**: §2는 "코드가 어떻게 생겼나"가 아니라 **"이 횡단에 단일 정본이 있나 / 없으면 몇 갈래로 갈라졌나"** 를 답해야 한다. 표면 묘사가 아니라 seam 지도.

---

## 3. 불변식 카탈로그 (CC = 사실 초안 / Claude = 확정)

횡단마다 **"항상 참이어야 하는 것"** 을 1줄로 명문화하고, 그 강제 수단과 현 위반을 적는다. **CC는 사실분(현 강제 수단·현 위반 증거)을 채운다. 불변식의 최종 문구·강제 방식 확정은 2단계(Claude).** 예시 형식:

```
[INV-CARD-CONTENT] 모든 카드의 사용자 콘텐츠는 정확히 하나의 정본을
  통해서만 read/write 된다.
  강제: ❌ 무방비 (기능마다 직접 테이블 접근)
  위반: 노트 write uvs-only (rich-note-service.ts:142) → ulc 카드 유실

[INV-VIDEO-META] 메타 없는 youtube_videos 행으로 v2 생성을 시도하지 않는다.
  강제: ⚠️ 관습 (#917 ensureYoutubeVideoRow, 핸들러 1곳)
  위반: (감사로 확인 — 모든 진입이 정말 이 핸들러 경유하나)
```

각 불변식: **코드로 강제 / 관습(주석·합의) / 무방비** 중 어디인가. "구조 결함"이라는 막연함을 **체크 가능한 목록**으로 바꾸는 게 이 단계의 목적.

---

## 4. 트리아지 (CC = 심각도·블래스트 데이터 / Claude = 권고선 / James = 확정)

발견된 위반을 분류한다. **전부 지금 고치는 게 아니다.** CC는 각 위반의 심각도·영향 범위(블래스트) 데이터를 댄다 → Claude가 라인을 권고 → **James가 출시 라인을 긋는다:**

| 등급 | 정의 | 처리 |
|---|---|---|
| **launch-blocking** | 데이터 유실 (메모류) | 출시 전 정본 층에서 수리 |
| **잠복** | 조용히 미작동 (완료·시청위치가 ulc 카드에서) | James 판단 — 데이터 유실 아니나 기능 거짓 |
| **단순 결함** | 정합 깨졌으나 영향 작음 | 보통 출시 후 |
| **출시후 부채** | 큰 안 필요 (카드 정체성 통합 등) | 별 트랙 설계 |

> 추측으로 등급 매기지 말 것. 영향 범위를 알아야 하는 위반은 **measure 필요분으로 표시**만 하고(SELECT 1방으로 확인 가능한 것), 측정 자체는 James 승인 후. (메모가 그랬다: 감사로 "비대칭"을 잡고, measure로 "138장/대부분 영구유실/사용자작성 4건"을 확정해 fix 설계가 갈렸다.)

---

## 5. 이후 — 구현·거버넌스 (최종 설계 후, 별도 세션)

Claude의 최종 설계(2단계) 위에서 James가 **출시 라인 + ① 범위(작은/큰)** 를 확정한 뒤:

- **fix — "층에서 고침, 자리에서 아님"**: launch-blocker를 증상 자리가 아니라 정본 층에서 수리. 메모 fix가 이 구조의 **첫 적용 사례** (per-content 단일 서비스 — 호출부마다 `if(uvs)else(ulc)` 흩뿌리기 금지, 그게 N번째 땜빵).
- **거버넌스 (in-repo)**: 정본 층+불변식을 `ARCHITECTURE_INVARIANTS.md`에 확정 → `/check` 게이트를 fitness function으로(횡단 건드리는 PR = 정본 층 경유 강제, 직접 접근 차단) → 구조 변경 시 ADR 의무. **in-repo 강제가 핵심**: LLM이 로컬 편집해도 seam이 코드/게이트로 강제되면 정본 층으로 끌려간다. 메모리 의존은 망각 보장.

이 doc이 곧 **"이후 설계가 그 안에서 추가·수정되는 그릇"** 이다 — 일회성 감사가 아니라 살아있는 층. 모든 구조 변경이 이 지도를 갱신하며 일어나고, 새 기능 PR은 "어느 횡단을 건드리나 → 그 정본 층 경유"가 체크리스트가 된다.

---

## 6. 이미 확보된 입력 (메모 진단 세션에서) — ②, 코드 검증 완료

§2-② per-card 콘텐츠 감사는 이미 끝났다. 그대로 인벤토리에 편입:

| 콘텐츠 | uvs 컬럼 | ulc 컬럼 | write | read | 정합 |
|---|---|---|---|---|---|
| 노트 | user_note_json | user_note | uvs only | dual | ❌ 비대칭 = 유실 (터짐) |
| 핀/하트 | pinned_at | pinned_at | dual-write | dual | ✅ |
| 관련도 (저장) | relevance_pct/at | relevance_pct/at | dual-table (CP498) | dual (local-cards.ts:183 / youtubeToInsightCard.ts:46) | ✅ 저장 대칭 |
| 관련도 (★채점 도달★) | (채점→write) | (채점→write) | trigger=discovery/wizard/pipeline 한정 | — | ❌ **수동-add ulc 미도달: ulc placed 82장 0 scored (prod 측정)** |
| 시청완료 | is_watched | (없음) | uvs only | uvs only | ⚠️ ulc 카드 미작동 (잠복) |
| 시청위치 | watch_position_seconds | (없음) | uvs only | uvs only | ⚠️ ulc 잠복 |
| 셀 위치 | cell_index | cell_index | 테이블별 | 테이블별 | △ 각자 자기 테이블 |

- **★두 정합 축 — 저장 대칭 / 도달 대칭 (James, CP500+ 일반화)★**: 관련도 트리아지가 드러낸 핵심 — per-card 콘텐츠 정합은 **두 축**이다. (1) **저장 대칭**: 양 테이블(uvs/ulc)에 컬럼이 있고 read/write가 양쪽을 보나. (2) **도달 대칭**: 그 컬럼을 실제로 **채우는/갱신하는 경로**(채점 trigger, save 핸들러, ingest)가 **모든 카드 유입 경로**(특히 수동-add ulc)에 도달하나. 관련도 = 저장 ✅ / 도달 ❌(ulc placed 0/82). 노트 = 저장 ❌(write uvs-only) — 더 깊은 단계. **감사 1단계 의무**: §6 표의 6개 콘텐츠(노트·핀·관련도·완료·시청위치·셀)를 **두 축 모두**로 재감사 — "저장은 양쪽인데 도달은 한쪽"인 잠복이 노트·관련도 외에 더 있나(완료·시청위치는 저장도 ulc 부재라 도달 이전 단계, 핀은 저장·도달 양쪽 dual로 보이나 *도달*도 정말 양쪽인지 확인). 단일 "정합" 칸으로 뭉뚱그리지 말 것 — 축 분리.
- **카드 조립 (공통 뿌리)**: `useMandalaCards`(frontend/src/pages/learning/model/useMandalaCards.ts:13-37)가 localCards(ulc)+syncedCards(uvs) 머지 → URL dedup(local 우선). `currentCard.id`가 ulc.id 또는 uvs.id, **둘 다 uuid라 구분 불가** → 소비자가 id만 받으면 어느 테이블인지 모름. 이게 모든 비대칭의 공통 뿌리.
- **메모 measure 결과**: ulc-only(uvs 없음) 138장 / 6users. 123 빈 문자열(영구유실) / 11 AI 자동주입("🤖 AI Summary", 사용자 메모 아님) / 4 사용자 작성(ulc 잔존, 편집 가능). James 케이스(xuUHWCT6gN4) = len 0, 영구 유실. → 복구 마이그레이션 불요, fix는 향후 방지 중심.
- **AI-autofill 오염 주의**: dual-read가 자동주입 11건을 "메모"로 표시 중 → 4단 fix 시 사용자 입력만 write, 소스 구분 필요.
- **#911 연결**: owned-exclude(src/modules/exclude/excluded-videos.ts)가 ulc.video_id + uvs를 union으로 처리(symmetric). 주석이 "wizard가 uvs에 써야 하나"를 미해결 아키 질문으로 명시 = 팀이 분할을 인지하나 정본 미정. #911 증발도 카드 정체성이 두 키로 쪼개진 ad-hoc 화해. ①의 한 줄기.

---

## 6-bis. 직전 grep-level 부분 감사 (①③④⑦) — ★출발점, 전수 아님★

> 메모 진단 세션에서 grep + 타겟 read 로 잡은 **부분** 결과. 전문(全文) 읽기 아님 → **이 세션이 full-file read로 검증·확장.** file:line 은 검증 대상.

### ★관련도(%) — 저장 vs 채점-도달 분리 (CP500+ 추가 관측, James prod)★
- **증상**: 그리드에서 자동(uvs) 카드는 관련도 % 있으나 수동(ulc) 카드는 없음 (유시민 xuUHWCT6gN4).
- **트리아지 (read-only, fix 금지)**: (a)채점 미도달 — **확정**. xuUHWCT6gN4 ulc.relevance_pct=null, **fleet ulc placed 82장 0 scored (100% null, prod 측정)**.
- **(b)/(c) 배제**: 채점 코드는 dual-table 능력 보유 — trigger가 ulc 행 enqueue (`relevance-backfill-trigger.ts:83`), FE가 `relevancePct` 매핑 (`local-cards.ts:183` / `youtubeToInsightCard.ts:46`). → 렌더 경로(b) 아님, 설계미채점(c) 아님.
- **갭**: `enqueueRelevanceBackfillForMandala` 발화 = discovery/wizard/pipeline 한정 (`mandalas.ts:2787` / `pipeline-runner.ts:275` / `wizard-precompute.ts:477`) — **수동-add(IdeaSpot D&D, local-cards EF) 경로엔 trigger 없음** → ulc placed 카드 미채점.
- **★구분 (James)★**: §6 "✅ dual-table"는 **저장 대칭**(맞음). **채점-도달(scoring-reach)은 별개 축** — 저장소가 양쪽이어도 *점수를 실제로 계산·write 하는 trigger가 ulc 유입 경로에 도달하나*는 다름. 노트의 read/write 비대칭과 같은 계열의 "능력은 있으나 경로 미도달".
- **needs full-read (감사 1단계)**: (1) trigger의 ulc 쿼리(:83) 필터가 placed ulc를 포함하나 — 0/82가 "trigger 미발화" 때문인지 "ulc enqueue→write 실패" 때문인지. (2) 수동-add 경로에 채점 trigger를 붙일 자리(정본 chokepoint) 후보. = 메타-ingest(③)·노트(②)와 동일한 "새 유입 경로가 횡단 가드 미복제" 패턴의 또 다른 인스턴스.

### ① 카드 정체성 (부분)
- 두 PK·키: uvs `@@unique(user_id, videoId=youtube_videos.id uuid)` (prisma:36 부근) / ulc `@@unique(user_id, url)`, video_id=youtube_id **문자열**(11) (prisma:680 부근) / card_interactions `@@unique(user_id, video_id 문자열, signal)` = **3번째 정체성 키** (prisma:744).
- id 출처: `convertToInsightCard` id=uvs.id (youtubeToInsightCard.ts:23) / `localCardToInsightCard` id=ulc.id (local-cards.ts:154) — 둘 다 uuid.
- ★discriminator 존재★: `InsightCard.sourceTable: 'user_local_cards'|'user_video_states'` (types.ts:49) + 양 컨버터 신뢰성 채움 (youtubeToInsightCard:40 / local-cards:180). **단 사용 불일치**: watch_position 은 `syncedCards.some` 으로 가드(ulc skip, useCardOrchestrator.ts:1453), rich-note 는 **무시**(RightPanel.tsx:71) → ulc 터짐. seam 도구는 있는데 강제 안 됨.
- **needs full-read**: card.id 를 단일 테이블로 소비하는 모든 지점 전수 (note/watch 외에 더 있나) — apiClient(cardId) 호출 전수 + 각 BE 라우트 findUnique 대상 테이블.

### ③ 영상 ingest / 메타 (부분)
- youtube_videos 생성 경로(다중, chokepoint 없음): cards.ts:362 (/like videoCacheHint) / VideoManager.upsertVideo·upsertVideos·fetchAndStoreVideos (video/manager.ts:44,75) / auto-add createMany (auto-add-recommendations.ts:265) / **ensureYoutubeVideoRow (#917, enrich 핸들러 1곳)** / local-cards EF ingest (source='user-d-and-d', **prod 0행=미작동**) / promote-from-* (video_pool).
- v2-gen 진입: enrich-rich-summary 핸들러(ensureYoutubeVideoRow 보유) / rich-summary-v2-cron.ts:242 (ensure 미호출, grep 0) / v2-quality-regen-cron.ts:190 (ensure 미호출) — cron 은 기존 youtube_videos SELECT 전제라 갭 아닐 수 있음.
- **needs full-read**: 위 생성 경로 각각이 어떤 필드를 채우나(부분 메타 vs 전체) + 각 카드유입이 메타 보장받는지 전수. local-cards EF ingest 가 왜 0행인지(조건 미충족 vs API 실패) = EF 본문 전문 + 런타임 로그.

### ④ 추천 게이트 우회 (확인분)
- add-cards→runV5Executor (add-cards.ts:322) / wizard→runV5ForWizard (wizard-precompute.ts:123) 모두 v5 수렴. shorts/diversity/duration 게이트 = `v5/executor` 단일점.
- 별개 placement 경로: wizard-precompute.ts:310 recommendation_cache 직접 INSERT + auto-add (recommendation_cache→uvs) = 게이트 통과 후 배치. **needs full-read**: 이 placement 가 게이트 산출물만 받는지(우회 아님) consumePrecompute 경로 전문.

### ⑦ 행동 텔레메트리 (부분, map-only)
- Gap A (이벤트 vs 상태): is_watched=boolean / watch_position=스칼라 (uvs, 최종 1장). card_interactions=`@@unique(user,video,signal)` = signal당 1행=dedup 상태. → 진입횟수·재생횟수·반복재생 적재 자리 없음.
- 이벤트성 테이블: `mandala_activity_log`(prisma:621, action/entity_type 범용 로그, write=manager.ts:1473) / `youtube_watch_history`(prisma:1104, source='manual'/import_id = 외부 YT 임포트). persona/profile/rollup 테이블 **부재**(grep NONE).
- **needs full-read**: `mandala_activity_log.action` 어휘 전수(재생 이벤트 일부 잡히나) + youtube_watch_history 실제 채워지는지 → 추측 금지, 전문 확인. ①정체성(3키)이 행동 anchor 가능한지 평가.

---

## 6.5 ⑦ 행동 텔레메트리 → 페르소나 토대 (map-only, James 발제)

**배경**: 사용자 행동(시청기록·진입횟수·반복재생)이 만다라별로 쌓이고 → 페르소나를 구성하면 → 맞춤 추천·선제 알림의 **능동 개인비서**(north star: 온톨로지 cards→sectors→mandalas→persona를 읽는 에이전트)가 된다. James 우려: **현 구조로는 불가.** 같은 병(SSOT 부재)의 한 층 깊은 얼굴 + 추가 결함.

**확인된 두 겹 (감사 §6 기반):**

- **Gap A — 상태 vs 이벤트**: 현 행동 컬럼은 `is_watched`(boolean = 봤다/안 봤다) + `watch_position_seconds`(스칼라 = 마지막 위치) 둘뿐. **최종 상태 한 장만 덮어쓴다.** "몇 번 진입 / 몇 번 재생 / 반복재생" = 빈도·반복·최근성 = **이벤트 흐름·카운트는 저장될 자리가 없다.** boolean으로 "3번 봤다"를 복원 불가. → 하필 페르소나 **최강 신호**(메모리 위계: 반복재생 > 완주율 > 북마크 > 클릭)가 들어갈 곳이 없음.
- **Gap B — split-table**: 그 빈약한 상태조차 `is_watched`·`watch_position`이 **uvs-only** → ulc 카드(수동·아이디어스팟)는 시청 추적 0 (§6 잠복분과 동일).

**겹친 결과**: 이벤트 안 쌓임(A) + 쌓여도 카드 절반만(B) → 카드별 행동이 만다라로 못 굴러올라감 → 페르소나 미구성 → 능동 비서 도달 불가. **현 구조로는 불가가 맞다.**

**이번 세션 작업 (map-only — 만들지 말 것):**
1. **오늘 텔레메트리 실태**: 진입·재생 이벤트가 어디든 기록되나, 아니면 `is_watched` 상태만인가? 이벤트 스트림 테이블 존재? (메모리: "재생시간/반복재생 계측 활성 여부 미확인" → 코드·스키마로 확정. 추측 금지.)
2. 어디 떨어지나 (uvs / 별도 / 안 잡힘).
3. 카드 → 만다라 → 페르소나 롤업 가능 경로 있나.
4. **①정체성 모델이 행동 누적을 anchor할 수 있나.**

**★①과의 커플링 (이게 핵심 — 토대가 미래를 봉쇄하지 않게)★**: §2-①(카드 정체성 SSOT) 결정을 **페르소나 미래 기준으로 평가**한다 — "이 정체성 모델이 만다라별 행동 누적을 받칠 수 있나". 출시 때 ①을 페르소나가 못 읽는 모델로 굳히면 나중에 비서 만들 때 **토대 재시공.** ①의 "큰 안"(카드 정체성 통합) 평가에 이 기준을 명시 포함. = James 원칙 "그 구조 안에서 이후 설계가 추가되는 그릇" — 토대 결정이 north star를 봉쇄하지 않게.

**스코프 경계**: ⑦은 **map-only** — (토대가 페르소나 받칠 수 있나) + (①이 봉쇄 안 하나) 확인까지. **이벤트 스토어·페르소나 구현은 출시 후 별 트랙.** ①②③ 깊이를 ⑦ 욕심으로 희석 금지.

---

## 7. 제약 (1단계 CC 공통)

- **read-only.** 이 세션은 코드·DB 변경 0. side-effect(merge/deploy/DDL/UPDATE/대량DELETE)는 James 명시 토큰(`[MERGE] #N` / `[GO] <대상>`)만 — 서술형 무효.
- **전수 조사 — 부분 읽기 금지·추측 금지.** 모든 진단은 코드·스키마·prod 쿼리·로그로. 경로 발견은 grep, **판정은 `Read`(전문)**. "헛다리"(코드 안 보고 추론) 금지. measure 필요분은 표시만, 측정은 James 승인 후.
- **코드 우선.** 이 핸드오프의 file:line·경로·필드명(§6-bis 포함)은 틀릴 수 있다 — 실제 코드베이스로 검증하고, 코드가 핸드오프보다 우선.
- **사실+옵션+질문까지, 설계 결정은 넘긴다.** CC는 정본층 선택·불변식 확정·① 결정을 *하지 않는다* — 2단계(Claude)·James 몫. "이렇게 고칠 수 있다 A/B"까지 펼치되 고르지 마.
- **얕게 끝내지 말 것.** 범위는 ①②③ + ⑦(map-only)로 고정 — ⑤⑥을 욕심내 ①(카드정체성)·③(메타ingest)을 표면만 훑지 말 것. ①③ 깊이가 이 세션의 값어치. ④는 executor 우회 여부 확인 1건이면 족함.

---

## 8. 결정 상태

1. **인벤토리 범위 = ①②③ + ⑦(map-only) 확정 (James)**. ②는 §6 완료, **①(전체)·③(신규)** 실작업, **⑦은 페르소나 토대 점검(map-only, §6.5)**, ④는 우회 확인만, ⑤⑥은 출시 후. (재논의 불요 — 시작.)
2. **출시 라인 = 트리아지 보고 후 확정**. 권고 입력: 데이터유실(launch-blocking) + 잠복(완료·시청위치 ulc 미작동)까지, 단순결함은 출시후. CC는 §4 트리아지를 등급별로 채워 올리고, James가 라인을 긋는다.

---

## 9. 이 세션과 섞지 말 것 (현 출시 트랙 — 별도)

- `#919` truncate+배지 — James 107분 카드(xuUHWCT6gN4) 화면 확인으로 ① Done 대기
- `#918` 캐너리 (RELEVANCE_RUBRIC_ENABLED=true ON, prune OFF) — James 신규 위저드 R4 점수 확인
- PR-B (genuine-skip terminal + churn0 — no_transcript throw 경로) — #919 검증 후
- 메모 휘발 PR-C (per-content 정본 fix + silent-swallow 제거) — **본 감사 2단계 설계 후** (땜빵 금지, 정본 층에서)
- sticky 그리드 헤더 (D&D droppable 보호영역, /test-dnd+/verify 동반) — SSOT fix 후
- 대기 [GO]: 쇼츠 잔존 4장 / 소급 C(캐너리 후)

이들은 이 감사 세션과 무관하게 굴러간다. 감사는 그 위/아래 층의 일.
