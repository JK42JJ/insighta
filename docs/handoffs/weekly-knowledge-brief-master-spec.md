<!--
  ORIGIN — 이 문서는 James 가 ChatGPT 와 함께 만든 초기 아이디에이션 산출물이다.
  2026-08-25 에 리포로 옮겼다. 그 전에도 전달된 적이 있으나 보관되지 않았고,
  그래서 같은 설계를 두 번 다시 만들었다. 아래가 그 재작업의 목록이다.

  이 문서가 상위 명세다. 아래 문서들은 이것의 하위 구현 계획으로 읽는다.
    docs/handoffs/weekly-brief-publication-design-2026-08-04.md
    docs/handoffs/ai-tech-weekly-design-2026-08-05.md
    docs/handoffs/newsletter-pipeline-design-2026-08-25.md

  놓쳐서 되돌아온 것 (2026-08-25 창간호 1차 시도에서 실측):

  1. Claim 모델 부재 (§4.3, §8, §9)
     구현 설계가 영상 단위로만 진행됐다. 주장 단위로 쪼개지 않으면
     supporting/contradicting 이 성립하지 않고, §16 Knowledge Diff 도 계산되지
     않는다. 지난 호와 비교할 대상 자체가 없다.

  2. 10개 주제를 두 번 잘못 짚음 (§23 Phase 3 에 목록이 있다)
     AI · 취업/커리어 · 영어 · 투자/경제 · 쇼핑 · 생산성 · 개발 · 건강 · 창업 · 뉴스/트렌드
     config/domains.ts 의 만다라 슬러그도, trend_signals 의 9축도 아니다.

  3. 첫 주제 (§19)
     취준생 대상 "AI 시대 취준생이 알아야 할 변화" 로 정해져 있다.
     2026-08-25 창간호는 AI·기술로 만들어졌다.

  4. §12 의 금지 조항이 그대로 위반됨
     "LLM이 하지 않아야 할 것 — 근거 없는 사실 생성, 출처 없는 숫자 생성"
     창간호가 블룸버그·앤트로픽 수치를 검색 없이 생성하고 '확인' 등급을 붙였다.
     사후 검증에서 2건이 오류로 확인됐다(보도일 8/23→8/16, 발표일 7/24→7/2,
     축소 수치 2,686단어→514단어 는 실제 800토큰→164토큰).

  5. Editorial Score 7항목 (§10)
     구현 설계는 3단 등급(확인/관측/미확인)까지만 만들었다. 이 문서의
     가중치 배분과 Must Know ~ Reject 5등급이 더 정교하다.

  6. 배포 3면 (§14 마지막)
     Web Report · YouTube Video · App Note Deep Dive.
     노트에 들어가는 것은 뉴스레터 전체가 아니라 Deep Dive 다.

  7. Editor 화면 명세 (§11)
     admin 설계를 "호수 목록 + 발송 버튼" 으로 잡았으나, 이 문서에는
     Claim/Sources/Supporting/Contradicting/Evidence/Score/AI추천/Human decision
     까지 정의돼 있다.

  본문은 원문 그대로다. 수정하지 않는다.
-->

# Insight A 주간 지식 브리핑 — 콘텐츠 설계·구현 기능 명세서

## 1. 문서 목적

이 문서는 Insight A의 핵심 경험을 **“콘텐츠를 요약하는 서비스”가 아니라 “정보 과잉 속에서 무엇을 볼지 선택할 수 있게 해주는 주간 지식 브리핑”**으로 정의하고, 이를 실제 제품 기능으로 구현하기 위한 설계 문서다.

초기 목표는 플랫폼 전체를 한 번에 완성하는 것이 아니라, **하나의 주제에 대해 매주 완결된 리포트를 발행할 수 있는 편집·리서치 파이프라인**을 만드는 것이다.

핵심 흐름:

> 대량 수집 → 후보 선별 → 중복/저품질 제거 → 핵심 주장 추출 → 교차검증 → 주제 구조화 → 편집 판단 → Weekly Report → 영상/Shorts/노트 재가공

---

## 2. 제품의 핵심 정의

### 2.1 문제

사용자는 정보가 부족해서 어려운 것이 아니라, 정보가 너무 많아서 어렵다.

특히 YouTube에서는:

- 같은 주제의 영상이 매우 많이 생성된다.
- 검색 결과의 품질 편차가 크다.
- 광고·홍보성 콘텐츠와 정보성 콘텐츠가 섞여 있다.
- 비슷한 내용이 반복된다.
- 최신 정보와 오래된 정보가 함께 노출된다.
- 무엇부터 봐야 하는지 사용자가 직접 판단해야 한다.
- 결국 검색 → 비교 → 시청 → 메모의 비용을 사용자가 부담한다.

### 2.2 해결책

Insight A는 매주 특정 주제의 공개 콘텐츠를 조사하고, **정보의 우선순위를 판단한 뒤 “이번 주에 알아야 할 것”을 하나의 완결된 브리핑으로 제공한다.**

따라서 핵심 산출물은 요약문이 아니라 다음이다.

1. 이번 주 무엇이 중요한가?
2. 왜 중요한가?
3. 무엇이 새롭게 바뀌었는가?
4. 어떤 주장들이 서로 일치하거나 충돌하는가?
5. 무엇을 더 봐야 하는가?
6. 무엇은 굳이 볼 필요가 없는가?

---

# 3. 초기 제품 형태

## 3.1 Weekly Report

각 주제별로 주간 리포트를 발행한다.

예:

- 취준생 Weekly
- AI Weekly
- 영어 스피킹 Weekly
- 커리어 Weekly
- 쇼핑 Intelligence Weekly
- 생활경제 Weekly

초기에는 10개 주제를 동시에 자동화하지 않고 **1~3개 주제에서 품질을 검증**한다.

## 3.2 한 호의 구조

### Cover

- 이번 호의 핵심 질문
- 조사 기간
- 분석한 콘텐츠 수
- 최종 선정 콘텐츠 수
- 예상 읽기/시청 시간

예:

> 이번 주 AI 취업 관련 콘텐츠 1,247개를 조사했습니다.  
> 중복·홍보성·근거 부족 콘텐츠를 제외하고 32개를 검토 대상으로 남겼습니다.  
> 그중 이번 주에 실제로 알아둘 가치가 있는 변화는 5가지였습니다.

### Section A — 이번 주 핵심 3~5개

각 항목:

- 한 줄 결론
- 왜 중요한가
- 무엇이 달라졌나
- 근거
- 관련 영상
- 더 깊게 보기

### Section B — 주제별 Deep Dive

하나의 핵심 아이템을 깊게 다룬다.

구조:

1. 질문
2. 배경
3. 현재 상황
4. 주요 주장
5. 서로 다른 의견
6. 근거 비교
7. 실제 사례
8. 사용자가 알아야 할 것
9. 추가 자료

### Section C — Must Watch

전체 영상이 아니라 **최소 시청 목록**을 제시한다.

- Must Watch: 1~3개
- Recommended: 3~7개
- Optional: 추가 자료

### Section D — 이번 주에 굳이 안 봐도 되는 것

중요한 차별화 요소다.

- 반복 콘텐츠
- 과장된 제목
- 근거가 부족한 콘텐츠
- 이미 다뤄진 내용
- 광고 목적이 강한 콘텐츠

를 제외한 이유를 내부적으로 기록한다.

### Section E — 다음 호 예고

현재 이슈에서 다음 주에 추적할 항목을 남긴다.

예:

> 이번 주에는 AI 면접 도구의 확산을 확인했다.  
> 다음 호에서는 실제 채용 과정에서 어떤 기업이 이를 사용하고 있는지 추적한다.

이 구조를 통해 Weekly가 단발성 콘텐츠가 아니라 **연속적인 지식 아카이브**가 된다.

---

# 4. 핵심 데이터 모델

## 4.1 Source

```text
Source
- id
- platform
- url
- title
- creator
- published_at
- duration
- view_count
- channel_subscriber_count
- description
- topic
- language
- collected_at
```

## 4.2 Content Analysis

```text
ContentAnalysis
- source_id
- relevance_score
- novelty_score
- evidence_score
- expertise_score
- commercial_bias_score
- redundancy_score
- freshness_score
- overall_score
- extracted_claims
```

## 4.3 Claim

서비스의 가장 중요한 내부 객체.

```text
Claim
- id
- statement
- source_ids[]
- claim_type
- confidence
- first_seen_at
- last_seen_at
- supporting_evidence[]
- contradicting_evidence[]
```

### Claim Type 예시

- Fact
- Opinion
- Prediction
- Recommendation
- Experience
- Marketing Claim
- Research Finding

이렇게 분리하면 단순히 “영상 A의 요약”을 만드는 것이 아니라, 여러 영상에서 반복되는 **주장 단위의 지식 구조**를 만들 수 있다.

---

# 5. 콘텐츠 처리 파이프라인

## Stage 1 — Collection

주제별로 후보 콘텐츠를 수집한다.

입력:

- 검색 결과
- 채널
- 관련 영상
- 추천 영상
- RSS/공개 피드 등 합법적으로 이용 가능한 데이터 소스

수집 메타데이터:

- 제목
- URL
- 채널
- 게시일
- 조회수
- 길이
- 설명
- 태그/카테고리

### 중요 원칙

YouTube 콘텐츠를 무단으로 대량 복제·다운로드하는 구조를 기본 아키텍처로 설계하지 않는다.

YouTube 약관은 콘텐츠의 무단 접근·복제·다운로드·배포 등을 제한하고 있으며, 자동화된 접근에도 제한을 둔다. 따라서 실제 구현에서는 공식 API, 허용된 데이터 접근 방식, 임베드, 공개 메타데이터 등 허용 범위를 우선 검토한다. citeturn0search0turn0search1

---

# 6. Stage 2 — Candidate Filtering

1차 필터는 LLM이 아니라 가능한 한 규칙 기반으로 처리한다.

### Filter

```text
Relevance
Freshness
Duration
Language
Duplicate
Channel quality
Commercial bias
Topic match
```

예:

```text
if topic_match < threshold:
    reject

if duplicate_similarity > threshold:
    merge

if commercial_bias > threshold:
    downgrade
```

---

# 7. Stage 3 — Semantic Deduplication

같은 내용을 제목만 바꿔 반복하는 콘텐츠를 묶는다.

예:

- “ChatGPT로 취업 준비하는 법”
- “취준생이 반드시 써야 할 ChatGPT”
- “AI로 취업 성공하는 방법”

세 영상이 사실상 같은 주장을 한다면:

```text
Topic Cluster #17
= AI를 활용한 자기소개서 작성
```

으로 묶는다.

구현:

- embedding
- vector database
- cosine similarity
- clustering

초기에는 PostgreSQL + pgvector로 충분하다.

---

# 8. Stage 4 — Claim Extraction

각 후보 콘텐츠에서 다음을 추출한다.

```text
주장
근거
사례
수치
추천
예측
경험담
```

중요한 것은 “영상 전체를 요약”하는 것이 아니다.

예:

> 이 영상의 요약

보다

> 이 영상은 “AI 면접에서 X가 중요하다”고 주장한다.

처럼 **주장 단위**로 변환한다.

---

# 9. Stage 5 — Cross Validation

하나의 콘텐츠만 보고 결론을 만들지 않는다.

예:

```text
Claim A
 ├─ Source 1: supporting
 ├─ Source 2: supporting
 ├─ Source 3: neutral
 └─ Source 4: contradicting
```

### Evidence Score

예시:

```text
Evidence Score =
  Source Quality
+ Independent Confirmation
+ Data Availability
+ Recency
- Contradiction
```

최종 점수는 0~100으로 정규화한다.

---

# 10. Stage 6 — Editorial Scoring

최종 발행 여부는 단일 LLM 판단에 맡기지 않는다.

추천 점수:

```text
Editorial Score =
  25% Relevance
+ 20% Novelty
+ 20% Evidence
+ 15% Source Quality
+ 10% Practical Value
+ 10% Timeliness
- Commercial Bias Penalty
- Redundancy Penalty
```

### 등급

| Score | 상태 |
|---|---|
| 90~100 | Must Know |
| 80~89 | Recommended |
| 70~79 | Watch / Read |
| 60~69 | Archive |
| <60 | Reject |

초기 운영에서는 사람이 점수를 검토하고, 충분한 데이터가 쌓인 뒤 자동화한다.

---

# 11. Stage 7 — Editorial Decision

AI가 최종 편집자가 되는 것이 아니라 **AI가 후보와 근거를 정리하고 사람이 발행을 승인**한다.

Editor 화면에는 다음을 보여준다.

```text
[Claim]
AI 면접에서 X의 중요성이 증가하고 있다.

[Sources]
A / B / C / D

[Supporting]
A, B, C

[Contradicting]
D

[Evidence]
...

[Score]
87

[AI recommendation]
Recommended

[Human decision]
Publish / Reject / Investigate
```

이 구조가 장기적으로 가장 중요한 내부 자산이 된다.

---

# 12. Stage 8 — Report Generation

편집자가 승인한 Claim을 기반으로 Weekly Report를 생성한다.

LLM의 역할:

- 문장 재구성
- 섹션 구성
- 쉬운 설명
- 요약
- 비교표 생성
- 영상 추천 이유 생성
- 다음 호 추적 항목 생성

LLM이 하지 않아야 할 것:

- 근거 없는 사실 생성
- 출처 없는 숫자 생성
- 하나의 영상을 전체 주제의 대표 의견으로 취급
- 원문을 장문 그대로 재생산

---

# 13. 저작권·콘텐츠 사용 원칙

## 13.1 기본 원칙

서비스의 핵심 산출물은 원본 콘텐츠의 복제물이 아니라 **독자적인 조사·분석·선별 결과**여야 한다.

권장:

- 원본 URL 연결
- 제목/채널/게시일 등 최소 메타데이터
- 자체 작성 요약
- 여러 출처의 비교
- 자체 평가
- 자체 구조화
- 원본 YouTube 임베드 활용

YouTube는 공식적으로 웹사이트나 블로그에 영상을 임베드할 수 있는 기능을 제공한다. citeturn0search5

주의:

- 전체 스크립트 저장
- 전체 자막 데이터베이스 구축
- 원본 영상 다운로드
- 원본 음성/화면의 대량 재배포
- 원문을 약간만 바꿔 재작성
- 원본을 대신 소비할 정도의 장문 요약

은 법률 검토 없이 사업의 기본 방식으로 채택하지 않는다.

특히 YouTube 약관 자체도 콘텐츠의 무단 복제·다운로드·배포 등을 제한한다. citeturn0search0turn0search1

> 이 문서는 법률 자문이 아니다. 상용 서비스 출시 전에는 한국 저작권법 및 플랫폼 약관을 기준으로 변호사/저작권 전문가의 검토를 별도로 받는다.

---

# 14. 기술 아키텍처

## MVP

```text
[Source Collector]
        ↓
[Metadata DB]
        ↓
[Candidate Filter]
        ↓
[Embedding]
        ↓
[Vector DB]
        ↓
[Claim Extraction]
        ↓
[Evidence Graph]
        ↓
[Editorial Scoring]
        ↓
[Human Editor]
        ↓
[Weekly Report]
        ↓
 ┌──────────────┬───────────────┬──────────────┐
 ↓              ↓               ↓
Web Report     YouTube         App Note
               Video           Deep Dive
```

## 추천 기술 스택

### Backend

- Python
- FastAPI
- PostgreSQL
- pgvector
- Redis
- Celery 또는 Temporal

### AI

- LLM API
- embedding model
- reranker
- structured output / JSON schema

### Search

초기:

- PostgreSQL full-text search
- pgvector

확장:

- OpenSearch 또는 Elasticsearch

### Frontend

- Next.js
- React
- Tailwind CSS

### Storage

- Object Storage
- PostgreSQL metadata
- Vector DB / pgvector

---

# 15. Knowledge Graph — Phase 2

초기부터 Neo4j를 반드시 도입할 필요는 없다.

먼저 PostgreSQL에서:

```text
Topic
Claim
Source
Person
Company
Product
Event
```

간의 관계를 저장한다.

데이터가 충분히 쌓이면:

```text
Topic
 ↓
Claim
 ↓
Source
 ↓
Person / Company / Product
 ↓
Previous Claim
```

구조로 확장한다.

이렇게 하면 “지난주와 이번 주에 무엇이 달라졌는가?”를 계산할 수 있다.

---

# 16. 가장 중요한 기능: Knowledge Diff

Weekly의 장기적인 경쟁력은 단순 요약이 아니라 **변화 감지**다.

예:

### 지난주

> AI 면접에서 생성형 AI 활용이 증가하고 있음.

### 이번주

> 실제 채용 공고에서 AI 활용 경험을 요구하는 사례가 증가.

시스템은 이를:

```text
OLD CLAIM
↓
NEW CLAIM
↓
CHANGE DETECTED
```

로 표현한다.

사용자에게는:

> **이번 주 새롭게 달라진 것**

으로 보여준다.

이 기능이 축적되면 매주 발행할 이유가 생긴다.

---

# 17. 사용자 경험

## Home

```text
이번 주 당신이 알아야 할 것

① 핵심 변화 3개
② 꼭 볼 영상 3개
③ 읽어볼 리포트 1개
④ 지난주 대비 달라진 것
```

사용자는 처음부터 모든 콘텐츠를 소비할 필요가 없다.

### 3단계 소비

```text
1. 3분 — 핵심 브리핑
        ↓
2. 15분 — 추천 영상
        ↓
3. 30~60분 — Deep Dive Note
```

즉:

> 발견 → 이해 → 학습

의 흐름을 만든다.

---

# 18. Weekly 발행 포맷

매주 동일한 포맷을 유지한다.

```text
[이번 주 한 줄]

[이번 주 핵심 3]
1.
2.
3.

[이번 주 꼭 봐야 할 영상]
1.
2.
3.

[Deep Dive]
이번 주 가장 중요한 주제 하나

[논쟁 중인 내용]
A vs B

[이번 주 제외한 콘텐츠]
왜 제외했는가

[지난주와 달라진 점]

[다음 주 추적]
```

이 포맷의 장점은 **사용자가 학습 방법을 다시 배울 필요가 없다는 것**이다.

---

# 19. 첫 번째 실험

초기에는 취준생을 대상으로 한다.

### Persona

20대 취업 준비생.

문제:

- 정보는 많이 검색한다.
- YouTube를 많이 본다.
- 하지만 무엇을 믿어야 할지 모른다.
- 여러 영상을 보지만 서로 비슷하다.
- 취업 준비에 직접 도움이 되는 것만 알고 싶다.

### 첫 번째 주제 후보

**“AI 시대 취준생이 알아야 할 변화”**

하위 아이템:

- AI 면접
- AI 자기소개서
- AI 포트폴리오
- 채용시장의 AI 활용
- AI 시대에 요구되는 역량
- 실제 채용 공고 변화

---

# 20. 창간호 제작 프로세스

## Day 1

- 주제 정의
- 검색 쿼리 설계
- 후보 콘텐츠 수집
- 1차 필터

## Day 2

- 중복 제거
- Claim 추출
- 출처 분류

## Day 3

- 교차검증
- Editorial Score 계산
- 핵심 3~5개 선정

## Day 4

- Deep Dive 작성
- 영상 추천 이유 작성
- 제외 콘텐츠 분석

## Day 5

- 편집자 검수
- 사실 검증
- 링크 검증
- 최종 발행

초기에는 속도보다 **완결성**을 우선한다.

---

# 21. 성공 지표

초기에는 가입자 수보다 다음을 본다.

### Content Quality

- 추천 콘텐츠 클릭률
- 추천 영상 실제 시청률
- Must Watch 만족도
- “정보가 도움이 됐다” 비율
- 오류 신고율

### Retention

- Weekly 재방문율
- 다음 호 대기/구독률
- 지난 호 재방문율
- Deep Dive 전환율

### Editorial Quality

- 인간 편집자와 AI 추천의 일치율
- 중복 콘텐츠 제거 정확도
- 사실 검증 오류율
- 발행 후 수정률

### 핵심 지표

> **“이번 주 위클리를 보고 사용자가 실제로 탐색 시간을 얼마나 줄였는가?”**

장기적으로는 이를 **Time Saved** 지표로 만든다.

---

# 22. 제품의 해자(Moat)

경쟁자가 쉽게 복제할 수 있는 것:

- 요약
- LLM 호출
- 영상 추천
- 웹페이지
- 검색

경쟁자가 따라오기 어려운 것:

1. 장기간 축적된 Claim 데이터
2. 출처별 신뢰도 데이터
3. 주제별 중복/반복 패턴
4. Editorial Score의 학습 데이터
5. 지난주→이번주 Knowledge Diff
6. 인간 편집자의 승인 데이터
7. 사용자 피드백
8. 주제별 Weekly Archive

따라서 장기 전략은 **AI 모델 자체가 아니라 “정보를 어떻게 선별하고 평가해왔는가”에 대한 데이터 자산**을 축적하는 것이다.

---

# 23. 단계별 로드맵

## Phase 0 — Manual Editorial MVP

목표:

> 사람이 1호를 완성할 수 있는가?

- 검색
- 수집
- 분석
- 검증
- 리포트 작성

자동화 최소화.

## Phase 1 — Assisted Editorial

- 자동 후보 수집
- 자동 중복 제거
- 자동 Claim 추출
- 자동 점수화
- 사람 승인

## Phase 2 — Weekly Engine

- 주제별 자동 수집
- 주간 변화 감지
- 자동 초안
- 편집자 검수
- 자동 발행

## Phase 3 — Multi-topic Platform

10개 주제로 확장.

```text
AI
취업/커리어
영어
투자/경제
쇼핑
생산성
개발
건강
창업
뉴스/트렌드
```

## Phase 4 — Personalized Intelligence

사용자가 관심 주제를 선택하면:

> “이번 주 당신에게 중요한 변화”

를 개인화한다.

---

# 24. 최종 제품 정의

Insight A가 만들어야 하는 것은 **YouTube 요약 서비스가 아니다.**

핵심은 다음이다.

> **정보를 직접 찾고 비교하는 데 드는 비용을 대신 부담하고, 매주 무엇이 중요한지 알려주는 지식 브리핑 시스템.**

그리고 내부적으로는:

> **Source → Claim → Evidence → Editorial Score → Knowledge Diff → Weekly**

라는 구조를 가진다.

사용자에게는 단순하게 보인다.

> **“이번 주, 이것만 알면 됩니다.”**

하지만 그 한 문장을 만들기 위해 뒤에서는 수많은 콘텐츠를 수집하고, 중복을 제거하고, 주장을 비교하고, 근거를 확인하고, 우선순위를 계산한다.

이 **복잡한 내부 과정과 단순한 외부 경험의 차이**가 Insight A의 핵심 제품 철학이다.

---

## 25. 1차 구현 우선순위

### 반드시 구현

- [ ] 주제 등록
- [ ] 콘텐츠 후보 수집
- [ ] 메타데이터 저장
- [ ] 중복 제거
- [ ] 관련도 점수
- [ ] Claim 추출
- [ ] 출처 연결
- [ ] Editorial Score
- [ ] 편집자 승인 화면
- [ ] Weekly Report 생성
- [ ] 원본 링크 연결
- [ ] Archive

### 2차 구현

- [ ] 자동 교차검증
- [ ] Knowledge Graph
- [ ] Knowledge Diff
- [ ] 개인화
- [ ] 사용자 피드백 학습
- [ ] 자동 YouTube/Shorts 대본 생성

### 나중에 구현

- [ ] 실시간 큐레이션
- [ ] 라이브 브리핑
- [ ] 완전 자동 발행
- [ ] 수천 개 주제 자동 확장

---

## 26. 가장 중요한 개발 원칙

**“AI가 콘텐츠를 만들게 하지 말고, AI가 편집자의 판단을 보조하게 한다.”**

초기에는 사람이 최종 발행권을 갖는다.

AI는:

- 찾고
- 묶고
- 비교하고
- 점수화하고
- 초안을 만들고
- 근거를 제시한다.

사람은:

- 중요한 질문을 선택하고
- 사실관계를 최종 확인하고
- 무엇을 버릴지 판단하고
- 이번 주의 핵심 메시지를 결정한다.

이 구조로 시작하면 서비스가 단순한 LLM wrapper가 아니라, 시간이 지날수록 데이터와 편집 판단이 축적되는 **주간 지식 인텔리전스 시스템**으로 발전할 수 있다.
